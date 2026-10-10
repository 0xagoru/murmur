import json
import logging
import time
from datetime import datetime, timezone
from typing import Any
from web3 import Web3
from .config import ROOT, DATA
from .chain import web3, manifest
from .store import rows, write, now

log = logging.getLogger("murmur")
FEEDS = {
    "BNB": {"address": "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE", "decimals": 8},
    "BTC": {"address": "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf", "decimals": 8},
    "ETH": {"address": "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e", "decimals": 8},
    "CAKE": {"address": "0xB6064eD41d4f67e353768aA239cA86f4F73665a1", "decimals": 8},
}
STATES = ["open", "right", "wrong", "void"]
# Scribe transactions are tiny; this keeps a runaway loop from draining its gas.
DAILY_SCRIBE_TX = 400


def agent_key(agent_id: str) -> bytes:
    return Web3.keccak(text=agent_id)


def _contract(w: Web3):
    address = manifest().get("contracts", {}).get("ledger")
    if not address:
        return None
    abi = json.loads((ROOT / "contracts/artifacts/MurmurLedger.json").read_text())[
        "abi"
    ]
    return w.eth.contract(address=Web3.to_checksum_address(address), abi=abi)


def _scribe(w: Web3):
    path = DATA / "scribe.json"
    if not path.exists():
        return None
    return w.eth.account.from_key(json.loads(path.read_text())["key"])


def enabled() -> bool:
    return bool(manifest().get("contracts", {}).get("ledger")) and (
        DATA / "scribe.json"
    ).exists()


def price(asset: str) -> float:
    w = web3()
    feed = FEEDS[asset]
    abi = [
        {
            "name": "latestRoundData",
            "type": "function",
            "inputs": [],
            "outputs": [{"type": "uint80"}, {"type": "int256"}, {"type": "uint256"}, {"type": "uint256"}, {"type": "uint80"}],
            "stateMutability": "view",
        }
    ]
    c = w.eth.contract(address=Web3.to_checksum_address(feed["address"]), abi=abi)
    return c.functions.latestRoundData().call()[1] / 10 ** feed["decimals"]


def _send(kind: str, build) -> tuple[str, Any] | None:
    """Sign as the scribe, record the hash before broadcast, and wait for the receipt."""
    w = web3()
    if w.eth.chain_id != 56:
        raise RuntimeError("chain mismatch")
    contract, scribe = _contract(w), _scribe(w)
    if contract is None or scribe is None:
        return None
    day = datetime.now(timezone.utc).date().isoformat()
    if (
        rows("SELECT COUNT(*) n FROM scribe_txs WHERE created_at>=?", (day,))[0]["n"]
        >= DAILY_SCRIBE_TX
    ):
        raise RuntimeError("scribe daily limit")
    if rows("SELECT id FROM scribe_txs WHERE status='pending'"):
        reconcile()
        if rows("SELECT id FROM scribe_txs WHERE status='pending'"):
            raise RuntimeError("scribe has an unresolved broadcast")
    tx = build(contract).build_transaction(
        {
            "from": scribe.address,
            "nonce": w.eth.get_transaction_count(scribe.address, "pending"),
            "chainId": 56,
            "gasPrice": w.eth.gas_price,
        }
    )
    tx["gas"] = int(w.eth.estimate_gas(tx) * 1.25)
    signed = scribe.sign_transaction(tx)
    tx_hash = w.to_hex(w.keccak(signed.raw_transaction))
    ident = write(
        "INSERT INTO scribe_txs(kind,tx_hash,status,created_at) VALUES(?,?,?,?)",
        (kind, tx_hash, "pending", now()),
    )
    w.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
    status = "confirmed" if receipt.status == 1 else "failed"
    write("UPDATE scribe_txs SET status=? WHERE id=?", (status, ident))
    if receipt.status != 1:
        raise RuntimeError(kind + " reverted")
    return tx_hash, (contract, receipt)


def reconcile() -> None:
    w = web3()
    for tx in rows("SELECT id,tx_hash FROM scribe_txs WHERE status='pending'"):
        try:
            receipt = w.eth.get_transaction_receipt(tx["tx_hash"])
        except Exception:
            # Dropped from the mempool for over ten minutes means it never landed.
            created = rows("SELECT created_at FROM scribe_txs WHERE id=?", (tx["id"],))
            age = time.time() - datetime.fromisoformat(created[0]["created_at"]).timestamp()
            if age > 600:
                write("UPDATE scribe_txs SET status='dropped' WHERE id=?", (tx["id"],))
            continue
        write(
            "UPDATE scribe_txs SET status=? WHERE id=?",
            ("confirmed" if receipt.status == 1 else "failed", tx["id"]),
        )


def anchor(note_id: int) -> str | None:
    note = rows("SELECT * FROM notes WHERE id=?", (note_id,))
    if not note or note[0]["anchor_tx"]:
        return None
    n = note[0]
    digest = Web3.keccak(
        text=json.dumps(
            {"title": n["title"], "finding": n["finding"], "data": n["data"]},
            sort_keys=True,
        )
    )
    sent = _send(
        "anchor",
        lambda c: c.functions.anchor(
            agent_key(n["agent_id"]),
            Web3.keccak(text=n["topic"]),
            digest,
            f"https://murmuragents.io/api/notes/{note_id}",
        ),
    )
    if sent:
        write("UPDATE notes SET anchor_tx=? WHERE id=?", (sent[0], note_id))
        return sent[0]
    return None


def open_call(agent_id: str, asset: str, above: bool, hours: int, note_id: int | None, thesis: str) -> int | None:
    if asset not in FEEDS or not 6 <= hours <= 168:
        return None
    if rows("SELECT id FROM calls WHERE agent_id=? AND state IN ('pending','open')", (agent_id,)):
        return None
    expiry = int(time.time()) + hours * 3600
    local = write(
        "INSERT INTO calls(agent_id,asset,above,expiry,thesis,note_id,state,created_at) VALUES(?,?,?,?,?,?,?,?)",
        (agent_id, asset, int(above), expiry, thesis[:280], note_id, "pending", now()),
    )
    try:
        sent = _send(
            "call",
            lambda c: c.functions.open(
                agent_key(agent_id),
                Web3.to_checksum_address(FEEDS[asset]["address"]),
                above,
                expiry,
                Web3.keccak(text=thesis),
            ),
        )
    except Exception:
        write("UPDATE calls SET state='failed' WHERE id=?", (local,))
        raise
    if not sent:
        write("UPDATE calls SET state='failed' WHERE id=?", (local,))
        return None
    contract, receipt = sent[1]
    event = contract.events.CallOpened().process_receipt(receipt)[0]["args"]
    write(
        "UPDATE calls SET chain_id=?,strike=?,state='open',open_tx=? WHERE id=?",
        (
            int(event["id"]),
            event["strike"] / 10 ** FEEDS[asset]["decimals"],
            sent[0],
            local,
        ),
    )
    return local


def counter(call_id: int, rival_id: str) -> str | None:
    call = rows("SELECT * FROM calls WHERE id=? AND state='open' AND rival_id IS NULL", (call_id,))
    if not call or call[0]["expiry"] <= time.time() + 60:
        return None
    sent = _send(
        "counter",
        lambda c: c.functions.counter(call[0]["chain_id"], agent_key(rival_id)),
    )
    if sent:
        write("UPDATE calls SET rival_id=?,counter_tx=? WHERE id=?", (rival_id, sent[0], call_id))
        return sent[0]
    return None


def settle_due() -> None:
    if not enabled():
        return
    for call in rows("SELECT * FROM calls WHERE state='open' AND expiry<=?", (int(time.time()) - 30,)):
        try:
            w = web3()
            c = _contract(w)
            state = c.functions.calls(call["chain_id"]).call()
            if state[4] == 0:
                sent = _send("settle", lambda c: c.functions.settle(call["chain_id"]))
                if not sent:
                    continue
                state = c.functions.calls(call["chain_id"]).call()
                tx = sent[0]
            else:
                tx = None
            write(
                "UPDATE calls SET state=?,settle_price=?,settle_tx=COALESCE(?,settle_tx),settled_at=? WHERE id=?",
                (
                    STATES[state[4]],
                    state[8] / 10 ** FEEDS[call["asset"]]["decimals"],
                    tx,
                    now(),
                    call["id"],
                ),
            )
        except Exception as error:
            # Usually the first Chainlink round after expiry has not landed yet.
            log.info("settle waiting for call %s: %s", call["id"], type(error).__name__)
