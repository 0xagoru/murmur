"""Visitor stakes on resident price calls. MurmurArena reads MurmurLedger's Chainlink result; this module only indexes it."""

from datetime import datetime
from typing import Any

from web3 import Web3

from . import store
from .chain import manifest, web3
from .onchain import contract, deploy_block, logs, stamp
from .town import meta

_cache: dict[str, Any] = {"at": 0.0, "pools": {}}


def sync() -> None:
    w = web3()
    c = contract(w, "arena", "MurmurArena")
    if c is None:
        return
    tip = w.eth.block_number - 3
    start = int(meta("arena_cursor") or deploy_block(w, c.address)) + 1
    stop = min(tip, start + 40000)
    if stop < start:
        return
    stamps: dict[int, str] = {}
    backed = c.events.Backed()
    claimed = c.events.Claimed()
    topics = {
        Web3.to_hex(Web3.keccak(text="Backed(uint256,address,bool,uint256)")): backed,
        Web3.to_hex(Web3.keccak(text="Claimed(uint256,address,uint256,uint256)")): claimed,
    }
    with_rows = []
    for raw in logs(w, c.address, start, stop):
        event = topics.get(Web3.to_hex(raw["topics"][0]))
        if event is None:
            continue
        with_rows.append((event, event.process_log(raw)))
    with store.connection() as db:
        for event, e in with_rows:
            a = e["args"]
            when = stamp(w, e["blockNumber"], stamps)
            if event is backed:
                db.execute(
                    "INSERT OR IGNORE INTO arena_bets(call_chain_id,backer,agent_right,amount,tx_hash,log_index,block_number,created_at) VALUES(?,?,?,?,?,?,?,?)",
                    (a["id"], a["backer"], int(a["agentRight"]), str(a["amount"]), Web3.to_hex(e["transactionHash"]), e["logIndex"], e["blockNumber"], when),
                )
            else:
                db.execute(
                    "INSERT OR IGNORE INTO arena_claims(call_chain_id,backer,payout,fee,tx_hash,log_index,block_number,created_at) VALUES(?,?,?,?,?,?,?,?)",
                    (a["id"], a["backer"], str(a["payout"]), str(a["fee"]), Web3.to_hex(e["transactionHash"]), e["logIndex"], e["blockNumber"], when),
                )
        db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", ("arena_cursor", str(stop)))
    _cache["at"] = 0.0


def pools() -> dict[int, dict[str, Any]]:
    """Totals per ledger call id from indexed stakes. Wei strings avoid float rounding."""
    out: dict[int, dict[str, Any]] = {}
    for r in store.rows(
        "SELECT call_chain_id id,agent_right,SUM(CAST(amount AS INTEGER)) total,COUNT(DISTINCT backer) backers FROM arena_bets GROUP BY 1,2"
    ):
        p = out.setdefault(r["id"], {"right_wei": "0", "wrong_wei": "0", "backers": 0})
        p["right_wei" if r["agent_right"] else "wrong_wei"] = str(r["total"])
        p["backers"] += r["backers"]
    for p in out.values():
        p["right_bnb"] = int(p["right_wei"]) / 1e18
        p["wrong_bnb"] = int(p["wrong_wei"]) / 1e18
    return out


def board() -> dict[str, Any]:
    p = pools()
    calls = store.rows(
        "SELECT c.*,a.name,a.color,n.title note_title FROM calls c JOIN agents a ON a.id=c.agent_id LEFT JOIN notes n ON n.id=c.note_id "
        "WHERE c.state NOT IN ('pending','failed') ORDER BY c.id DESC LIMIT 60"
    )
    calls = [c for c in calls if c["expiry"] and c["chain_id"] is not None]
    for c in calls:
        opened = int(datetime.fromisoformat(c["created_at"]).timestamp())
        c["closes_at"] = opened + (c["expiry"] - opened) // 2
        c["pool"] = p.get(c["chain_id"], {"right_wei": "0", "wrong_wei": "0", "right_bnb": 0, "wrong_bnb": 0, "backers": 0})
        c["recent_backers"] = store.rows(
            "SELECT backer,agent_right,amount,tx_hash,created_at FROM arena_bets WHERE call_chain_id=? ORDER BY id DESC LIMIT 8",
            (c["chain_id"],),
        )
    return {
        "arena": manifest().get("contracts", {}).get("arena"),
        "ledger": manifest().get("contracts", {}).get("ledger"),
        "min_stake": 0.001,
        "max_stake": 0.5,
        "fee_pct": 3,
        "calls": calls,
        "volume_bnb": sum(x["right_bnb"] + x["wrong_bnb"] for x in p.values()),
    }


def mine(address: str) -> list[dict[str, Any]]:
    stakes = store.rows(
        "SELECT b.call_chain_id,b.agent_right,SUM(CAST(b.amount AS INTEGER)) amount,c.id call_id,c.asset,c.above,c.strike,c.state,c.agent_id,c.expiry "
        "FROM arena_bets b LEFT JOIN calls c ON c.chain_id=b.call_chain_id WHERE lower(b.backer)=lower(?) GROUP BY 1,2 ORDER BY 1 DESC",
        (address,),
    )
    claims = {r["call_chain_id"]: r for r in store.rows("SELECT * FROM arena_claims WHERE lower(backer)=lower(?)", (address,))}
    for s in stakes:
        s["amount_bnb"] = int(s["amount"]) / 1e18
        s["amount"] = str(s["amount"])
        s["claim"] = claims.get(s["call_chain_id"])
    return stakes
