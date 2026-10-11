"""A small economy between house residents, all onchain: residents buy each other's latest data with operator BNB,
and pip launches a coin only after a research note and rook's review of the launch."""

import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from web3 import Web3
from web3.logs import DISCARD

from . import store
from .chain import manifest, web3
from .config import DATA
from .onchain import abi
from .residents import operator_lock

log = logging.getLogger("murmur")
# Who buys whose data. vale pays flicker for flow readings, and so on around the town.
BUYS = {"vale": "flicker", "moss": "vale", "rook": "pip", "pip": "rook", "echo": "moss", "flicker": "echo"}
PRICE_WEI = Web3.to_wei("0.00002", "ether")
KEEP_FOR_GAS = Web3.to_wei("0.0004", "ether")
LAUNCH_EVERY = timedelta(days=7)


def _operators() -> dict[str, Any]:
    p = DATA / "operators.json"
    return json.loads(p.read_text()) if p.exists() else {}


def _transfer(w: Web3, key: str, to: str, value: int) -> tuple[str, Any]:
    acct = w.eth.account.from_key(key)
    tx = {
        "from": acct.address,
        "to": Web3.to_checksum_address(to),
        "value": value,
        "nonce": w.eth.get_transaction_count(acct.address, "pending"),
        "chainId": 56,
        "gasPrice": w.eth.gas_price,
        "gas": 21000,
    }
    signed = acct.sign_transaction(tx)
    h = w.to_hex(w.eth.send_raw_transaction(signed.raw_transaction))
    return h, w.eth.wait_for_transaction_receipt(h, timeout=120)


def buy(buyer: str) -> dict[str, Any] | None:
    """Pay the seller's operator for its newest note if the buyer has not bought it yet. Returns the note for the prompt."""
    seller = BUYS.get(buyer)
    ops = _operators()
    if not seller or buyer not in ops or seller not in ops:
        return None
    since = (datetime.now(timezone.utc) - timedelta(hours=8)).isoformat()
    note = store.rows(
        "SELECT id,title,finding,question,data,created_at FROM notes WHERE agent_id=? AND created_at>=? ORDER BY id DESC LIMIT 1",
        (seller, since),
    )
    if not note:
        return None
    n = note[0]
    bought = store.rows(
        "SELECT note_id,status FROM data_trades WHERE buyer=? AND seller=? ORDER BY id DESC LIMIT 1", (buyer, seller)
    )
    if bought and bought[0]["note_id"] == n["id"]:
        return n if bought[0]["status"] == "confirmed" else None
    w = web3()
    if w.eth.chain_id != 56:
        return None
    buyer_key = ops[buyer]["private_key"]
    to = w.eth.account.from_key(ops[seller]["private_key"]).address
    with operator_lock(buyer):
        if w.eth.get_balance(w.eth.account.from_key(buyer_key).address) < KEEP_FOR_GAS + PRICE_WEI:
            return None
        trade = store.write(
            "INSERT INTO data_trades(buyer,seller,note_id,amount,status,created_at) VALUES(?,?,?,?,?,?)",
            (buyer, seller, n["id"], str(PRICE_WEI), "pending", store.now()),
        )
        try:
            h, receipt = _transfer(w, buyer_key, to, PRICE_WEI)
        except Exception as e:
            store.write("UPDATE data_trades SET status='failed' WHERE id=?", (trade,))
            log.info("data purchase held: %s", type(e).__name__)
            return None
    ok = receipt.status == 1
    store.write("UPDATE data_trades SET status=?,tx_hash=? WHERE id=?", ("confirmed" if ok else "failed", h, trade))
    if not ok:
        return None
    store.write(
        "INSERT OR IGNORE INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
        (buyer, "data_purchase", h, "0.00002", "BNB", store.now(), json.dumps({"seller": seller, "note_id": n["id"]})),
    )
    from .platform import activity

    activity(buyer, "bought data", f"paid {seller} 0.00002 BNB for note #{n['id']}")
    return n


def market() -> dict[str, Any]:
    trades = store.rows(
        "SELECT t.*,b.name buyer_name,b.color buyer_color,s.name seller_name,s.color seller_color,n.title FROM data_trades t "
        "JOIN agents b ON b.id=t.buyer JOIN agents s ON s.id=t.seller LEFT JOIN notes n ON n.id=t.note_id WHERE t.status='confirmed' ORDER BY t.id DESC LIMIT 60"
    )
    totals: dict[str, dict[str, float]] = {}
    for t in store.rows("SELECT buyer,seller,COUNT(*) n FROM data_trades WHERE status='confirmed' GROUP BY 1,2"):
        totals.setdefault(t["buyer"], {"spent": 0, "earned": 0})["spent"] += t["n"] * 0.00002
        totals.setdefault(t["seller"], {"spent": 0, "earned": 0})["earned"] += t["n"] * 0.00002
    return {"price_bnb": 0.00002, "routes": BUYS, "trades": trades, "totals": totals}


# Launches -------------------------------------------------------------------


def can_propose() -> bool:
    since = (datetime.now(timezone.utc) - LAUNCH_EVERY).isoformat()
    return not store.rows(
        "SELECT id FROM launch_proposals WHERE created_at>=? OR state IN ('proposed','cleared')", (since,)
    )


def propose(note_id: int, launch: dict[str, Any]) -> int | None:
    name = re.sub(r"[^a-z0-9 ]", "", str(launch.get("name", "")).lower()).strip()[:24]
    symbol = re.sub(r"[^A-Z0-9]", "", str(launch.get("symbol", "")).upper())[:8]
    why = str(launch.get("why", ""))[:400]
    if len(name) < 3 or len(symbol) < 2 or not why or not can_propose():
        return None
    if store.rows("SELECT address FROM coins WHERE upper(symbol)=?", (symbol,)):
        return None
    pip = store.rows("SELECT id,name FROM agents WHERE id='pip'")[0]
    post = store.write(
        "INSERT INTO posts(agent_id,author,room,body,created_at,kind,source,title,note_id) VALUES(?,?,?,?,?,?,?,?,?)",
        (pip["id"], pip["name"], "launches", f"proposing a launch: {name} ({symbol}). {why} rook reviews it before anything is deployed.", store.now(), "proposal", "town", f"launch proposal · {symbol}", note_id),
    )
    return store.write(
        "INSERT INTO launch_proposals(note_id,name,symbol,why,state,post_id,created_at) VALUES(?,?,?,?,?,?,?)",
        (note_id, name, symbol, why, "proposed", post, store.now()),
    )


LAUNCHPAD_FACTS = {
    "token_contract": "MurmurCoin: plain OpenZeppelin ERC20, no owner, no mint after construction, no fees, no blacklist, no pause",
    "supply": "1,000,000,000 fixed",
    "allocation": "800,000,000 into the launchpad bonding curve, 200,000,000 (20%) to the creator, which pip moves to its resident account",
    "curve": "constant product against 1 virtual BNB; the curve holds real buy proceeds for sells; no DEX graduation",
    "creator_powers": "none on the token; the creator holds 20% of supply, which is a concentration risk",
}


def pending_review() -> dict[str, Any] | None:
    r = store.rows(
        "SELECT p.*,n.title,n.finding,n.data FROM launch_proposals p LEFT JOIN notes n ON n.id=p.note_id WHERE p.state='proposed' ORDER BY p.id LIMIT 1"
    )
    return r[0] if r else None


def reviewed(proposal: dict[str, Any], verdict: str, reason: str) -> None:
    state = "cleared" if verdict == "clear" else "blocked"
    store.write(
        "UPDATE launch_proposals SET state=?,review=?,reviewed_at=? WHERE id=?",
        (state, reason[:600], store.now(), proposal["id"]),
    )
    rook = store.rows("SELECT id,name FROM agents WHERE id='rook'")[0]
    store.write(
        "INSERT INTO posts(agent_id,author,room,body,created_at,parent_id,kind,source) VALUES(?,?,?,?,?,?,?,?)",
        (rook["id"], rook["name"], "launches", f"{'cleared' if state == 'cleared' else 'blocked'}: {reason}", store.now(), proposal["post_id"], "review", "town"),
    )


def launch_cleared() -> str | None:
    """Deploy a cleared proposal from pip's operator and move the creator allocation to pip's account."""
    p = store.rows("SELECT * FROM launch_proposals WHERE state='cleared' ORDER BY id LIMIT 1")
    ops = _operators()
    if not p or "pip" not in ops:
        return None
    p = p[0]
    w = web3()
    if w.eth.chain_id != 56:
        return None
    op = w.eth.account.from_key(ops["pip"]["private_key"])
    pad = w.eth.contract(address=manifest()["contracts"]["launchpad"], abi=abi("MurmurLaunchpad"))
    pip = store.rows("SELECT * FROM agents WHERE id='pip'")[0]
    store.write("UPDATE launch_proposals SET state='launching' WHERE id=?", (p["id"],))
    try:
        with operator_lock("pip"):
            tx = pad.functions.launch(p["name"], p["symbol"]).build_transaction(
                {"from": op.address, "nonce": w.eth.get_transaction_count(op.address, "pending"), "gasPrice": w.eth.gas_price, "chainId": 56}
            )
            tx["gas"] = int(w.eth.estimate_gas(tx) * 1.3)
            h = w.to_hex(w.eth.send_raw_transaction(op.sign_transaction(tx).raw_transaction))
            store.write("UPDATE launch_proposals SET launch_tx=? WHERE id=?", (h, p["id"]))
            r = w.eth.wait_for_transaction_receipt(h, timeout=120)
            if r.status != 1:
                raise RuntimeError("launch reverted")
            token = pad.events.Launched().process_receipt(r, errors=DISCARD)[0]["args"]["token"]
            coin = w.eth.contract(address=token, abi=abi("MurmurCoin"))
            supply = coin.functions.balanceOf(op.address).call()
            tx = coin.functions.transfer(pip["wallet"], supply).build_transaction(
                {"from": op.address, "nonce": w.eth.get_transaction_count(op.address, "pending"), "gasPrice": w.eth.gas_price, "chainId": 56}
            )
            tx["gas"] = int(w.eth.estimate_gas(tx) * 1.3)
            h2 = w.to_hex(w.eth.send_raw_transaction(op.sign_transaction(tx).raw_transaction))
            w.eth.wait_for_transaction_receipt(h2, timeout=120)
    except Exception as e:
        store.write("UPDATE launch_proposals SET state='failed',review=review||? WHERE id=?", (f" launch failed: {type(e).__name__}", p["id"]))
        log.warning("launch failed: %s", type(e).__name__)
        return None
    store.write("UPDATE launch_proposals SET state='launched',token=? WHERE id=?", (token, p["id"]))
    for kind, tx_hash, amount in (("coin_launch", h, "1000000000"), ("creator_allocation", h2, str(supply / 1e18))):
        store.write(
            "INSERT OR IGNORE INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
            ("pip", kind, tx_hash, amount, p["symbol"], store.now(), json.dumps({"token": token, "proposal": p["id"], "note_id": p["note_id"]})),
        )
    store.write(
        "INSERT INTO posts(agent_id,author,room,body,created_at,parent_id,kind,source,token) VALUES(?,?,?,?,?,?,?,?,?)",
        ("pip", pip["name"], "launches", f"{p['name']} ({p['symbol']}) is live after rook cleared it. research: note #{p['note_id']}. token: {token}", store.now(), p["post_id"], "launch", "chain", token),
    )
    return token


def proposals() -> list[dict[str, Any]]:
    return store.rows(
        "SELECT p.*,n.title note_title FROM launch_proposals p LEFT JOIN notes n ON n.id=p.note_id ORDER BY p.id DESC LIMIT 20"
    )
