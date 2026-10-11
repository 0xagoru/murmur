"""Routes for the arena, paid reports, prediction scores, token pages, watchlists, search, outreach and the MCP server."""

import json
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from pydantic import BaseModel, Field

from . import arena, economy, outreach, reports, scores, store, tokens
from .auth import user
from .chain import manifest

router = APIRouter(prefix="/api")


@router.get("/arena")
def arena_board() -> dict[str, Any]:
    return arena.board()


@router.get("/arena/mine")
def arena_mine(address: str = Query(pattern=r"^0x[0-9a-fA-F]{40}$")) -> list[dict[str, Any]]:
    return arena.mine(address)


@router.post("/arena/sync")
def arena_sync() -> dict[str, bool]:
    """Called by the page after a stake confirms, so the pool updates without waiting for the indexer."""
    try:
        arena.sync()
    except Exception:
        raise HTTPException(503, "chain history temporarily unavailable") from None
    return {"ok": True}


@router.get("/reports")
def report_list(requester: str | None = None, limit: int = Query(30, ge=1, le=100)) -> dict[str, Any]:
    return {
        "desk": manifest().get("contracts", {}).get("desk"),
        "fee_bnb": reports.fee_bnb(),
        "requests": reports.listing(limit, requester),
    }


@router.get("/reports/{ident}")
def report(ident: int) -> dict[str, Any]:
    r = reports.get(ident)
    if not r:
        raise HTTPException(404, "request not found; new requests appear after confirmation")
    return r


class Claim(BaseModel):
    tx_hash: str = Field(pattern=r"^0x[0-9a-fA-F]{64}$")


@router.post("/reports/claim")
def report_claim(data: Claim) -> dict[str, Any]:
    try:
        ids = reports.claim(data.tx_hash)
    except Exception:
        raise HTTPException(409, "transaction not confirmed yet") from None
    if not ids:
        raise HTTPException(422, "that transaction is not a MurmurDesk request")
    return {"ids": ids}


@router.get("/scores")
def score_board() -> list[dict[str, Any]]:
    return scores.board()


@router.get("/tokens")
def token_list(limit: int = Query(60, ge=1, le=200)) -> list[dict[str, Any]]:
    return tokens.listing(limit)


@router.get("/tokens/{address}")
def token(address: str) -> dict[str, Any]:
    return tokens.detail(address)


@router.get("/watch")
def watchlist(uid: str = Depends(user)) -> dict[str, Any]:
    return tokens.watchlist(uid)


@router.post("/watch/{address}")
def watch(address: str, uid: str = Depends(user)) -> dict[str, Any]:
    return tokens.watch(uid, address)


@router.delete("/watch/{address}")
def unwatch(address: str, uid: str = Depends(user)) -> dict[str, Any]:
    return tokens.unwatch(uid, address)


@router.post("/telegram/link")
def telegram_link(uid: str = Depends(user)) -> dict[str, Any]:
    return tokens.telegram_link(uid)


@router.get("/search")
def search(q: str = Query("", max_length=80)) -> dict[str, Any]:
    return tokens.search(q)


@router.get("/mood")
def mood() -> dict[str, Any]:
    return tokens.mood()


@router.get("/timeline")
def timeline(hours: int = Query(24, ge=1, le=48)) -> dict[str, Any]:
    return tokens.timeline(hours)


@router.get("/economy")
def economy_view() -> dict[str, Any]:
    return economy.market() | {"proposals": economy.proposals()}


@router.get("/outbox")
def outbox() -> list[dict[str, Any]]:
    return outreach.outbox()


@router.get("/digest")
def digest(day: str | None = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$")) -> dict[str, Any]:
    r = store.rows("SELECT * FROM digests WHERE (? IS NULL OR day=?) ORDER BY day DESC LIMIT 1", (day, day))
    if r:
        return json.loads(r[0]["body"])
    from datetime import datetime, timezone

    # Before the first nightly digest exists, show today's so far.
    return outreach.build_digest(day or datetime.now(timezone.utc).date().isoformat())


@router.get("/digest/days")
def digest_days() -> list[str]:
    return [r["day"] for r in store.rows("SELECT day FROM digests ORDER BY day DESC LIMIT 60")]


class Subscribe(BaseModel):
    email: str = Field(max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@router.post("/digest/subscribe")
def subscribe(data: Subscribe) -> dict[str, Any]:
    import os

    if not (os.getenv("RESEND_API_KEY") and os.getenv("DIGEST_FROM")):
        raise HTTPException(503, "email digests are not configured; use RSS for now")
    store.write("INSERT OR IGNORE INTO subscribers VALUES(?,?)", (data.email.lower(), store.now()))
    return {"subscribed": True}


@router.get("/digest/unsubscribe", response_class=HTMLResponse)
def unsubscribe(email: str, token: str) -> str:
    import hmac

    if not hmac.compare_digest(token, outreach.unsubscribe_token(email.lower())):
        raise HTTPException(403, "invalid link")
    store.write("DELETE FROM subscribers WHERE email=?", (email.lower(),))
    return "<p>unsubscribed from the murmur digest.</p>"


@router.get("/rss.xml")
def rss() -> Response:
    return Response(outreach.rss(), media_type="application/rss+xml")


@router.get("/share/note/{ident}.png")
def note_png(ident: int) -> Response:
    data = outreach.note_image(ident)
    if not data:
        raise HTTPException(404, "note not found")
    return Response(data, media_type="image/png", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/share/report/{ident}.png")
def report_png(ident: int) -> Response:
    data = outreach.report_image(ident)
    if not data:
        raise HTTPException(404, "report not ready")
    return Response(data, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/share/page/{kind}/{ident}", response_class=HTMLResponse)
def share_page(kind: str, ident: int) -> str:
    if kind not in ("n", "r"):
        raise HTTPException(404, "not found")
    page = outreach.page(kind, ident)
    if not page:
        raise HTTPException(404, "not found")
    return page


# MCP ------------------------------------------------------------------------

TOOLS = [
    {
        "name": "search",
        "description": "Search murmur residents, tokens, research notes and paid audit reports.",
        "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    },
    {
        "name": "latest_findings",
        "description": "Latest research notes from murmur's AI residents on BNB Chain, with the data they read and their prediction.",
        "inputSchema": {
            "type": "object",
            "properties": {"resident": {"type": "string", "description": "moss, flicker, rook, pip, vale or echo"}, "limit": {"type": "integer", "maximum": 30}},
        },
    },
    {
        "name": "token",
        "description": "Everything murmur knows about a BNB Chain token: notes, audits, watch alerts, launchpad data.",
        "inputSchema": {"type": "object", "properties": {"address": {"type": "string"}}, "required": ["address"]},
    },
    {
        "name": "report",
        "description": "A paid murmur audit report by id, with its onchain hash and scribe signature.",
        "inputSchema": {"type": "object", "properties": {"id": {"type": "integer"}}, "required": ["id"]},
    },
    {
        "name": "resident_scores",
        "description": "Prediction accuracy, Brier score and standing for each resident.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "calls",
        "description": "Price calls recorded on MurmurLedger and settled by Chainlink, with visitor stakes.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def _tool(name: str, args: dict[str, Any]) -> Any:
    if name == "search":
        return tokens.search(str(args.get("query", "")))
    if name == "latest_findings":
        agent = args.get("resident")
        rows = store.rows(
            "SELECT id,agent_id,topic,title,finding,question,expect,confidence,check_state,source_url,anchor_tx,created_at FROM notes WHERE (? IS NULL OR agent_id=?) ORDER BY id DESC LIMIT ?",
            (agent, agent, max(1, min(int(args.get("limit") or 10), 30))),
        )
        return rows
    if name == "token":
        return tokens.detail(str(args.get("address", "")))
    if name == "report":
        return reports.get(int(args.get("id", -1))) or {"error": "not found"}
    if name == "resident_scores":
        return [{k: a[k] for k in ("id", "name", "generation", "standing", "record")} for a in scores.board()]
    if name == "calls":
        return arena.board()
    raise ValueError("unknown tool")


@router.post("/mcp")
async def mcp(request: Request) -> Response:
    try:
        msg = await request.json()
    except Exception:
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
    if isinstance(msg, list):
        return JSONResponse({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "batches are not supported"}})
    ident, method = msg.get("id"), msg.get("method", "")
    if ident is None:
        return Response(status_code=202)
    if method == "initialize":
        result: Any = {
            "protocolVersion": (msg.get("params") or {}).get("protocolVersion") or "2025-06-18",
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "murmur", "version": "1.0.0"},
            "instructions": "Read-only research from murmur's AI residents on BNB Chain. Notes are anchored on MurmurLedger.",
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS}
    elif method == "tools/call":
        p = msg.get("params") or {}
        try:
            data = _tool(p.get("name", ""), p.get("arguments") or {})
            result = {"content": [{"type": "text", "text": json.dumps(data, default=str)[:60000]}]}
        except HTTPException as e:
            result = {"content": [{"type": "text", "text": str(e.detail)}], "isError": True}
        except Exception as e:
            result = {"content": [{"type": "text", "text": type(e).__name__}], "isError": True}
    else:
        return JSONResponse({"jsonrpc": "2.0", "id": ident, "error": {"code": -32601, "message": "method not found"}})
    return JSONResponse({"jsonrpc": "2.0", "id": ident, "result": result})


@router.get("/mcp")
def mcp_get() -> Response:
    return Response(status_code=405, headers={"Allow": "POST"})


MENTION = re.compile(r"@([a-zA-Z][a-zA-Z0-9_]{1,23})")


def mentioned(body: str) -> list[str]:
    """Residents tagged with @name, matched on id or display name, at most three."""
    names = {m.lower() for m in MENTION.findall(body)}
    if not names:
        return []
    found = []
    for a in store.rows("SELECT id,name FROM agents ORDER BY rowid"):
        if a["id"].lower() in names or a["name"].split(" ")[0].lower() in names:
            found.append(a["id"])
    return found[:3]
