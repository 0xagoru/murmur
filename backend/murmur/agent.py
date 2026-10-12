"""ERC-8004 identity for murmur's research desk: the registration file, an A2A agent card and endpoint,
the owner's registration claim, and reputation read back from the ERC-8004 Reputation Registry."""

import os
import re
import secrets
import time
from datetime import UTC
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from web3 import Web3

from . import desk, lending, reports, store
from .auth import user
from .chain import manifest, web3
from .town import meta

SITE = "https://murmuragents.io"
CARD = SITE + "/.well-known/agent-card.json"
REGISTRATION = SITE + "/.well-known/agent-registration.json"
A2A = SITE + "/api/a2a"
IDENTITY = Web3.to_checksum_address("0x8004A169FB4a3325136EB29fA0ceB6D2e539a432")
REPUTATION = Web3.to_checksum_address("0x8004BAa17C55a88189AE136b182e5fdA19dE9b63")
NAME = "murmur research desk"
CATEGORY = "risk monitoring"
PURPOSE = (
    "token security audits and lending health factor checks on BNB Chain. rook audits a token contract with GoPlus "
    "and pip reads its liquidity and holders from GeckoTerminal; the report is hashed and published onchain through "
    "MurmurDesk. the desk also reads Venus positions and alerts when a health factor drops below a chosen level."
)
REGISTERED = "0x" + Web3.keccak(
    text="Registered(uint256,string,address)"
).hex().removeprefix("0x")
_IDENTITY_ABI = [
    {
        "name": "ownerOf",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"type": "uint256"}],
        "outputs": [{"type": "address"}],
    },
    {
        "name": "tokenURI",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"type": "uint256"}],
        "outputs": [{"type": "string"}],
    },
]
_REPUTATION_ABI = [
    {
        "name": "getClients",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"type": "uint256"}],
        "outputs": [{"type": "address[]"}],
    },
    {
        "name": "getSummary",
        "type": "function",
        "stateMutability": "view",
        "inputs": [
            {"type": "uint256"},
            {"type": "address[]"},
            {"type": "string"},
            {"type": "string"},
        ],
        "outputs": [{"type": "uint64"}, {"type": "int128"}, {"type": "uint8"}],
    },
]

router = APIRouter()


def owner_wallet() -> str:
    raw = os.getenv("MURMUR_AGENT_OWNER", "")
    return Web3.to_checksum_address(raw) if Web3.is_address(raw) else ""


def identity() -> dict[str, Any]:
    ident = meta("erc8004_agent_id")
    return {
        "agent_id": int(ident) if ident else None,
        "owner": meta("erc8004_owner") or None,
        "tx": meta("erc8004_tx") or None,
        "registry": IDENTITY,
        "chain_id": 56,
        "agent_registry": f"eip155:56:{IDENTITY}",
    }


def _contracts() -> dict[str, str]:
    c = manifest().get("contracts", {})
    return {k: c[k] for k in ("desk", "ledger", "arena", "registry") if c.get(k)}


def registration() -> dict[str, Any]:
    i = identity()
    c = _contracts()
    fee = _fee()
    return {
        "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        "name": NAME,
        "description": PURPOSE
        + f" category: {CATEGORY}. a paid audit costs {fee} BNB through MurmurDesk {c.get('desk', '')}.",
        "image": SITE + "/apple-touch-icon.png",
        "services": [
            {"name": "web", "endpoint": SITE + "/#agent"},
            {"name": "A2A", "endpoint": CARD, "version": "0.3.0"},
            {"name": "MCP", "endpoint": SITE + "/api/mcp", "version": "2025-06-18"},
        ],
        "x402Support": False,
        "active": True,
        "registrations": [
            {"agentId": i["agent_id"], "agentRegistry": i["agent_registry"]}
        ]
        if i["agent_id"] is not None
        else [],
        "supportedTrust": ["reputation"],
        "category": CATEGORY,
        "contracts": {k: f"eip155:56:{v}" for k, v in c.items()},
    }


_fee_cache: dict[str, float] = {"at": 0.0, "value": 0.003}


def _fee() -> float:
    if time.time() - _fee_cache["at"] > 300:
        value = reports.fee_bnb()
        _fee_cache.update(at=time.time(), value=value if value else _fee_cache["value"])
    return _fee_cache["value"]


def card() -> dict[str, Any]:
    return {
        "protocolVersion": "0.3.0",
        "name": NAME,
        "description": PURPOSE,
        "url": A2A,
        "preferredTransport": "JSONRPC",
        "version": "1.0.0",
        "provider": {"organization": "murmur", "url": SITE},
        "iconUrl": SITE + "/apple-touch-icon.png",
        "documentationUrl": SITE + "/#field%20guide",
        "capabilities": {
            "streaming": False,
            "pushNotifications": False,
            "stateTransitionHistory": False,
        },
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["application/json", "text/plain"],
        "skills": [
            {
                "id": "token-audit",
                "name": "token security audit",
                "description": f"send a BNB Chain token address. returns murmur's existing reports and GoPlus flags for it, and how to pay MurmurDesk ({_fee()} BNB) for a full signed report.",
                "tags": ["security", "audit", "bnb chain", "goplus"],
                "examples": ["audit 0x55d398326f99059fF775485246999027B3197955"],
            },
            {
                "id": "lending-health",
                "name": "Venus health factor",
                "description": "send a wallet address with the word health. returns the Venus Core Pool health factor, debt, borrow limit and each market.",
                "tags": ["lending", "health factor", "venus", "liquidation"],
                "examples": ["health 0x36d023d3bb82b3ee3bca30701f2c61329572b688"],
            },
            {
                "id": "report",
                "name": "audit report",
                "description": "send report and a number. returns that paid report with its onchain hash and scribe signature.",
                "tags": ["report"],
                "examples": ["report 1"],
            },
        ],
        "erc8004": identity(),
    }


ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")
_tasks: dict[str, dict[str, Any]] = {}


def answer(text: str) -> tuple[str, Any]:
    low = text.lower()
    found = ADDRESS.search(text)
    num = re.search(r"report\s*#?(\d+)", low)
    if num:
        r = reports.get(int(num.group(1)))
        return ("report", r or {"error": "no report with that number"})
    if found and any(
        w in low for w in ("health", "venus", "lending", "liquidat", "borrow")
    ):
        return ("lending-health", lending.position(found.group(0)))
    if found:
        address = found.group(0).lower()
        prior = store.rows(
            "SELECT id,state,created_at,done_at,fulfil_tx FROM research_requests WHERE token=? ORDER BY id DESC LIMIT 5",
            (address,),
        )
        return (
            "token-audit",
            {
                "token": address,
                "goplus": desk.audit(address),
                "reports": prior,
                "full_report": {
                    "pay": f"call request({address}) on MurmurDesk {_contracts().get('desk')} with {_fee()} BNB on BNB Chain",
                    "delivery": "rook and pip write the report, the scribe signs it and MurmurDesk.fulfil records its hash. "
                    "unfinished requests are refunded.",
                    "page": SITE + "/#audits",
                },
            },
        )
    return (
        "help",
        {"skills": [s["examples"][0] for s in card()["skills"]], "card": CARD},
    )


def _message_text(params: dict[str, Any]) -> str:
    parts = ((params or {}).get("message") or {}).get("parts") or []
    return " ".join(str(p.get("text", "")) for p in parts if isinstance(p, dict))[:2000]


@router.get("/.well-known/agent-card.json")
def well_known_card() -> JSONResponse:
    return JSONResponse(
        card(),
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=300"},
    )


@router.get("/.well-known/agent-registration.json")
def well_known_registration() -> JSONResponse:
    return JSONResponse(
        registration(),
        headers={"Access-Control-Allow-Origin": "*", "Cache-Control": "max-age=300"},
    )


@router.post("/api/a2a")
async def a2a(request: Request) -> JSONResponse:
    try:
        msg = await request.json()
    except Exception:
        return JSONResponse(
            {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": "parse error"},
            }
        )
    ident, method, params = (
        msg.get("id"),
        msg.get("method", ""),
        msg.get("params") or {},
    )
    if method == "tasks/get":
        task = _tasks.get(str(params.get("id", "")))
        if not task:
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": ident,
                    "error": {"code": -32001, "message": "task not found"},
                }
            )
        return JSONResponse({"jsonrpc": "2.0", "id": ident, "result": task})
    if method != "message/send":
        return JSONResponse(
            {
                "jsonrpc": "2.0",
                "id": ident,
                "error": {"code": -32601, "message": "method not found"},
            }
        )
    text = _message_text(params)
    try:
        import asyncio

        skill, data = await asyncio.to_thread(answer, text)
        state, err = "completed", None
    except HTTPException as e:
        skill, data, state, err = "error", {"error": e.detail}, "failed", e.detail
    except Exception as e:
        skill, data, state, err = (
            "error",
            {"error": type(e).__name__},
            "failed",
            type(e).__name__,
        )
    task_id = secrets.token_hex(8)
    task = {
        "kind": "task",
        "id": task_id,
        "contextId": ((params.get("message") or {}).get("contextId")) or task_id,
        "status": {"state": state, "timestamp": store.now()},
        "artifacts": [
            {
                "artifactId": skill,
                "name": skill,
                "parts": [{"kind": "data", "data": data}],
            }
        ],
        "metadata": {"skill": skill, "error": err},
    }
    _tasks[task_id] = task
    while len(_tasks) > 500:
        _tasks.pop(next(iter(_tasks)))
    return JSONResponse({"jsonrpc": "2.0", "id": ident, "result": task})


class Claim(BaseModel):
    tx_hash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")


@router.post("/api/agent/claim")
def claim(data: Claim) -> dict[str, Any]:
    """Records the ERC-8004 registration once the configured owner wallet has sent it."""
    owner = owner_wallet()
    if not owner:
        raise HTTPException(503, "MURMUR_AGENT_OWNER is not set on the server")
    w = web3()
    r = w.eth.get_transaction_receipt(data.tx_hash)
    if r.status != 1:
        raise HTTPException(422, "that transaction failed")
    for lg in r["logs"]:
        if (
            lg["address"].lower() != IDENTITY.lower()
            or Web3.to_hex(lg["topics"][0]) != REGISTERED
        ):
            continue
        agent_id = int.from_bytes(bytes(lg["topics"][1]), "big")
        holder = Web3.to_checksum_address(bytes(lg["topics"][2])[-20:])
        if holder != owner:
            raise HTTPException(
                403, "this agent is owned by a different wallet than MURMUR_AGENT_OWNER"
            )
        uri = (
            w.eth.contract(address=IDENTITY, abi=_IDENTITY_ABI)
            .functions.tokenURI(agent_id)
            .call()
        )
        if uri != REGISTRATION:
            raise HTTPException(422, f"agentURI must be {REGISTRATION}")
        for k, v in (
            ("erc8004_agent_id", str(agent_id)),
            ("erc8004_owner", holder),
            ("erc8004_tx", data.tx_hash.lower()),
        ):
            store.write("INSERT OR REPLACE INTO meta VALUES(?,?)", (k, v))
        return identity()
    raise HTTPException(422, "no ERC-8004 Registered event in that transaction")


_rep: dict[str, Any] = {"at": 0.0, "value": None}


def reputation() -> dict[str, Any] | None:
    i = identity()
    if i["agent_id"] is None:
        return None
    if time.time() - _rep["at"] < 120 and _rep["value"] is not None:
        return _rep["value"]
    rep = web3().eth.contract(address=REPUTATION, abi=_REPUTATION_ABI)
    clients = rep.functions.getClients(i["agent_id"]).call()
    count, value, decimals = (
        rep.functions.getSummary(i["agent_id"], clients, "", "").call()
        if clients
        else (0, 0, 0)
    )
    out = {
        "ratings": count,
        "average": value / 10**decimals if count else None,
        "clients": len(clients),
        "registry": REPUTATION,
    }
    _rep.update(at=time.time(), value=out)
    return out


def uptime() -> dict[str, Any] | None:
    """Share of watchdog checks that passed in the last 24 hours (one check every two minutes)."""
    from datetime import datetime, timedelta

    from .config import DATA

    path = DATA / "watchdog.log"
    if not path.exists():
        return None
    since = datetime.now(UTC) - timedelta(hours=24)
    rows = []
    for line in path.read_text().splitlines()[-800:]:
        stamp, _, ok = line.partition(" ")
        try:
            if datetime.fromisoformat(stamp.replace("Z", "+00:00")) >= since:
                rows.append(ok.strip() == "1")
        except ValueError:
            continue
    if not rows:
        return None
    return {
        "checks_24h": len(rows),
        "passed_pct": round(100 * sum(rows) / len(rows), 2),
        "last": path.read_text().splitlines()[-1],
    }


@router.get("/api/agent")
def status() -> dict[str, Any]:
    hires = store.rows(
        "SELECT COUNT(*) n, SUM(state='done') done, COUNT(DISTINCT requester) wallets FROM research_requests"
    )[0]
    try:
        rep = reputation()
    except Exception:
        rep = None
    return {
        "identity": identity(),
        "owner_wallet": owner_wallet() or None,
        "agent_uri": REGISTRATION,
        "card": CARD,
        "a2a": A2A,
        "mcp": SITE + "/api/mcp",
        "category": CATEGORY,
        "purpose": PURPOSE,
        "fee_bnb": _fee(),
        "contracts": _contracts(),
        "hires": {
            "requests": hires["n"],
            "fulfilled": hires["done"] or 0,
            "wallets": hires["wallets"],
        },
        "reputation": rep,
        "reputation_registry": REPUTATION,
        "uptime": uptime(),
    }


class LendingWatch(BaseModel):
    threshold: float = Field(1.2, gt=1.0, le=3.0)


@router.get("/api/lending/{address}")
def lending_position(address: str) -> dict[str, Any]:
    return lending.position(address)


@router.get("/api/lending")
def lending_mine(uid: str = Depends(user)) -> list[dict[str, Any]]:
    return lending.mine(uid)


@router.post("/api/lending/watch/{address}")
def lending_watch(
    address: str, data: LendingWatch, uid: str = Depends(user)
) -> dict[str, Any]:
    return lending.watch(uid, address, data.threshold)


@router.delete("/api/lending/watch/{address}")
def lending_unwatch(address: str, uid: str = Depends(user)) -> dict[str, Any]:
    return lending.unwatch(uid, address)
