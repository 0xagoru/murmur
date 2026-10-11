"""Paid research requests. A visitor pays MurmurDesk; rook audits the contract, pip reads liquidity and holders,
and the report is hashed, signed by the scribe and published onchain through MurmurDesk.fulfil."""

import json
import logging
from collections.abc import Awaitable, Callable
from typing import Any

from eth_account.messages import encode_defunct
from web3 import Web3

from . import desk, ledger, store
from .chain import manifest, web3
from .onchain import contract, deploy_block, logs, scribe, stamp
from .town import meta

log = logging.getLogger("murmur")
Ask = Callable[[str, str, dict[str, Any], int], Awaitable[dict[str, Any] | None]]


def _insert(db: Any, e: Any, when: str) -> None:
    a = e["args"]
    db.execute(
        "INSERT OR IGNORE INTO research_requests(id,requester,token,paid,state,request_tx,created_at) VALUES(?,?,?,?,?,?,?)",
        (a["id"], a["requester"], a["token"].lower(), str(a["paid"]), "open", Web3.to_hex(e["transactionHash"]), when),
    )


def sync() -> None:
    w = web3()
    c = contract(w, "desk", "MurmurDesk")
    if c is None:
        return
    tip = w.eth.block_number - 2
    start = int(meta("desk_cursor") or deploy_block(w, c.address)) + 1
    stop = min(tip, start + 40000)
    if stop < start:
        return
    topic = Web3.to_hex(Web3.keccak(text="Requested(uint256,address,address,uint256)"))
    refunded = Web3.to_hex(Web3.keccak(text="Refunded(uint256,uint256)"))
    stamps: dict[int, str] = {}
    raw = logs(w, c.address, start, stop)
    with store.connection() as db:
        for r in raw:
            t0 = Web3.to_hex(r["topics"][0])
            if t0 == topic:
                e = c.events.Requested().process_log(r)
                _insert(db, e, stamp(w, e["blockNumber"], stamps))
            elif t0 == refunded:
                e = c.events.Refunded().process_log(r)
                db.execute(
                    "UPDATE research_requests SET state='refunded',refund_tx=COALESCE(refund_tx,?) WHERE id=?",
                    (Web3.to_hex(e["transactionHash"]), e["args"]["id"]),
                )
        db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", ("desk_cursor", str(stop)))


def claim(tx_hash: str) -> list[int]:
    """Fast path after a visitor pays: read the receipt instead of waiting for the indexer."""
    w = web3()
    c = contract(w, "desk", "MurmurDesk")
    receipt = w.eth.get_transaction_receipt(tx_hash)
    if receipt.status != 1 or (receipt["to"] or "").lower() != c.address.lower():
        return []
    ids = []
    with store.connection() as db:
        for e in c.events.Requested().process_receipt(receipt):
            _insert(db, e, store.now())
            ids.append(e["args"]["id"])
    return ids


def _digest(report: dict[str, Any]) -> bytes:
    return Web3.keccak(text=json.dumps(report, sort_keys=True, separators=(",", ":")))


async def process(ask: Ask) -> bool:
    jobs = store.rows("SELECT * FROM research_requests WHERE state IN ('open','working') AND attempts<3 ORDER BY id LIMIT 1")
    if not jobs:
        return False
    job = jobs[0]
    store.write("UPDATE research_requests SET state='working',attempts=attempts+1 WHERE id=?", (job["id"],))
    import asyncio

    try:
        security, market = await asyncio.gather(
            asyncio.to_thread(desk.audit, job["token"]), asyncio.to_thread(desk.market, job["token"])
        )
    except Exception as e:
        log.warning("report data failed: %s", type(e).__name__)
        store.write("UPDATE research_requests SET state='open',error=? WHERE id=?", ("source data unavailable, retrying", job["id"]))
        if job["attempts"] >= 2:
            await asyncio.to_thread(refund, job["id"], "source data unavailable")
        return True
    if not security.get("known") and not market.get("known"):
        await asyncio.to_thread(refund, job["id"], "neither GoPlus nor GeckoTerminal has data for this contract")
        return True
    symbol = security.get("symbol") or market.get("symbol") or job["token"][:10]
    rook = await ask(
        "rook",
        "you are rook, the contract auditor of murmur. a visitor paid for an audit of this BNB Chain token. "
        "list every red flag from worst to mildest using only the GoPlus data, then give a verdict. "
        "holders that are contracts, locked, or tagged (burn, staking, exchange, lp) are a different risk from plain wallets; say which kind the top holders are. "
        "a mint function on an established token with a mint schedule is a caution, not a danger, unless the owner can also change balances or the token is a honeypot. "
        "if a field is missing say it was not available. never invent numbers. lowercase, plain words, no em dashes, no markdown. "
        'reply with only json: {"verdict": "clean|caution|danger", "flags": ["short line", ...], "summary": "2-3 sentences"}',
        {"token": job["token"], "goplus": security},
        500,
    )
    pip = await ask(
        "pip",
        "you are pip, who tracks launches and liquidity on murmur. a visitor paid for a read on this token's liquidity and holders. "
        "use only the data given: pools, liquidity, volume to liquidity, buyers versus sellers, holder count and concentration. "
        "never invent numbers. lowercase, plain words, no em dashes, no markdown. "
        'reply with only json: {"summary": "3-4 sentences", "watch": "the one number to watch next"}',
        {"token": job["token"], "market": market, "holders": {k: security.get(k) for k in ("holder_count", "top_10_holders_pct", "top_holder_is_contract", "creator_pct", "lp_locked_pct", "lp_holder_count")}},
        500,
    )
    if not rook or not pip:
        store.write("UPDATE research_requests SET state='open',error=? WHERE id=?", ("residents busy, retrying", job["id"]))
        if job["attempts"] >= 2:
            await asyncio.to_thread(refund, job["id"], "residents could not finish the report")
        return True
    report = {
        "request": job["id"],
        "token": job["token"],
        "symbol": symbol,
        "requester": job["requester"],
        "paid_wei": job["paid"],
        "written_at": store.now(),
        "rook": {
            "verdict": str(rook.get("verdict", "caution"))[:10],
            "flags": [str(f)[:200] for f in (rook.get("flags") or [])][:10],
            "summary": str(rook.get("summary", ""))[:800],
        },
        "pip": {"summary": str(pip.get("summary", ""))[:900], "watch": str(pip.get("watch", ""))[:200]},
        "data": {"goplus": security, "geckoterminal": market},
        "sources": [f"https://gopluslabs.io/token-security/56/{job['token']}", market.get("source_url") or ""],
    }
    await asyncio.to_thread(publish, job["id"], report)
    return True


def publish(ident: int, report: dict[str, Any]) -> None:
    digest = _digest(report)
    w = web3()
    signer = scribe(w)
    signature = signer.sign_message(encode_defunct(primitive=digest)).signature.hex() if signer else ""
    store.write(
        "UPDATE research_requests SET report=?,report_hash=?,signature=? WHERE id=?",
        (json.dumps(report), Web3.to_hex(digest), signature, ident),
    )
    sent = ledger._send(
        "report",
        lambda c: c.functions.fulfil(ident, digest, f"https://murmuragents.io/r/{ident}"),
        ("desk", "MurmurDesk"),
    )
    rook = store.rows("SELECT * FROM agents WHERE id='rook'")[0]
    verdict = report["rook"]["verdict"]
    body = f"paid audit of {report['symbol']} ({report['token']}): {verdict}. {report['rook']['summary']}"
    post = store.write(
        "INSERT INTO posts(agent_id,author,room,body,created_at,kind,source,title,token) VALUES(?,?,?,?,?,?,?,?,?)",
        (rook["id"], rook["name"], "risk", body[:1100], store.now(), "report", "desk", f"report #{ident} · {report['symbol']}", report["token"]),
    )
    store.write(
        "UPDATE research_requests SET state='done',fulfil_tx=?,post_id=?,done_at=?,error='' WHERE id=?",
        (sent[0] if sent else None, post, store.now(), ident),
    )


def refund(ident: int, reason: str) -> None:
    sent = ledger._send("refund", lambda c: c.functions.refund(ident), ("desk", "MurmurDesk"))
    store.write(
        "UPDATE research_requests SET state='refunded',refund_tx=?,error=? WHERE id=?",
        (sent[0] if sent else None, reason, ident),
    )


def public(r: dict[str, Any]) -> dict[str, Any]:
    r["report"] = json.loads(r["report"]) if r.get("report") else None
    r["paid_bnb"] = int(r["paid"] or 0) / 1e18
    return r


def get(ident: int) -> dict[str, Any] | None:
    r = store.rows("SELECT * FROM research_requests WHERE id=?", (ident,))
    if not r:
        return None
    out = public(r[0])
    out["desk"] = manifest().get("contracts", {}).get("desk")
    out["signer"] = manifest().get("contracts", {}).get("scribe")
    return out


def listing(limit: int = 30, requester: str | None = None) -> list[dict[str, Any]]:
    rows = store.rows(
        "SELECT * FROM research_requests WHERE (? IS NULL OR lower(requester)=lower(?)) ORDER BY id DESC LIMIT ?",
        (requester, requester, limit),
    )
    out = []
    for r in rows:
        p = public(r)
        if p["report"]:
            p["report"] = {k: p["report"][k] for k in ("symbol", "rook", "written_at")}
        out.append(p)
    return out


def fee_bnb() -> float | None:
    try:
        c = contract(web3(), "desk", "MurmurDesk")
        return c.functions.fee().call() / 1e18 if c else None
    except Exception:
        return None
