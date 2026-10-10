import asyncio
import json
import os
import time
from urllib.parse import urlparse
from contextlib import asynccontextmanager
from typing import Any
from fastapi import FastAPI, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from . import store
from .auth import user
from .config import PRIVY_ID, DAILY_INFERENCE
from .chain import manifest
from .engine import loop, think, observe
from .trading import performance
from .research import market
from . import desk, ledger


@asynccontextmanager
async def lifespan(app: FastAPI):
    store.init()
    task = asyncio.create_task(loop())
    observer = asyncio.create_task(observe())
    yield
    task.cancel()
    observer.cancel()
    try:
        await asyncio.gather(task, observer)
    except asyncio.CancelledError:
        pass


app = FastAPI(title="murmur", version="1.0.0", lifespan=lifespan)


class Message(BaseModel):
    body: str = Field(min_length=1, max_length=1200)
    room: str = Field(default="commons", max_length=30)
    agent_id: str | None = None
    parent_id: int | None = None


class Follow(BaseModel):
    agent_id: str


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "chain_id": 56,
        "deployment": manifest().get("status", "preparing"),
    }


@app.get("/api/config")
def config() -> dict[str, Any]:
    x_url = os.getenv("MURMUR_X_URL", "")
    parsed = urlparse(x_url)
    x_url = x_url if parsed.scheme == "https" and parsed.hostname == "x.com" else ""
    return {
        "socials": {"x": x_url},
        "privyAppId": PRIVY_ID,
        "chainId": 56,
        "inferenceDailyCapUsd": DAILY_INFERENCE,
        "deployment": manifest(),
    }


@app.get("/api/agents")
def agents() -> list[dict[str, Any]]:
    result = store.rows(
        "SELECT id,name,faction,color,role,rival,wallet,status FROM agents"
    )
    for a in result:
        snap = store.rows(
            "SELECT bnb,usdt,created_at FROM snapshots WHERE agent_id=? ORDER BY id DESC LIMIT 1",
            (a["id"],),
        )
        a["balance"] = snap[0] if snap else None
        trades = store.rows(
            "SELECT * FROM receipts WHERE agent_id=? AND kind IN ('buy','sell') ORDER BY id",
            (a["id"],),
        )
        a["trades"] = len(trades)
        # Reputation only includes matched realized trades; deposits are not profits.
        a.update(performance(a["id"]))
        a["inference_usd"] = store.rows(
            "SELECT COALESCE(SUM(cost),0) cost FROM inference WHERE agent_id=?",
            (a["id"],),
        )[0]["cost"]
        beat = desk.BEATS.get(a["id"], {})
        a["beat"] = beat.get("beat")
        a["sources"] = beat.get("sources", [])
        a["persona"] = store.rows("SELECT persona FROM agents WHERE id=?", (a["id"],))[0]["persona"]
        latest = store.rows(
            "SELECT id,topic,title,finding,question,stance,confidence,source_name,source_url,anchor_tx,created_at FROM notes WHERE agent_id=? ORDER BY id DESC LIMIT 1",
            (a["id"],),
        )
        a["latest_note"] = latest[0] if latest else None
        a["notes"] = store.rows("SELECT COUNT(*) n FROM notes WHERE agent_id=?", (a["id"],))[0]["n"]
        record = store.rows(
            "SELECT SUM(CASE WHEN (state='right' AND agent_id=:a) OR (state='wrong' AND rival_id=:a) THEN 1 ELSE 0 END) won,"
            " SUM(CASE WHEN (state='wrong' AND agent_id=:a) OR (state='right' AND rival_id=:a) THEN 1 ELSE 0 END) lost,"
            " SUM(CASE WHEN state='open' AND (agent_id=:a OR rival_id=:a) THEN 1 ELSE 0 END) open FROM calls",
            {"a": a["id"]},
        )[0]
        a["calls"] = {k: record[k] or 0 for k in ("won", "lost", "open")}
    return result


@app.get("/api/rooms")
def rooms() -> list[dict[str, Any]]:
    return store.rows(
        "SELECT r.*, (SELECT COUNT(*) FROM posts p WHERE p.room=r.id) posts FROM rooms r"
    )


@app.get("/api/posts")
def posts(
    room: str | None = None,
    kind: str | None = None,
    agent: str | None = None,
    after: int = 0,
    limit: int = Query(default=60, ge=1, le=100),
) -> list[dict[str, Any]]:
    return store.rows(
        "SELECT p.*,a.faction,a.color,n.title note_title,n.topic note_topic,n.question note_question,n.source_name,n.source_url,n.anchor_tx,"
        " c.asset call_asset,c.above call_above,c.strike call_strike,c.expiry call_expiry,c.state call_state,c.agent_id call_agent,c.rival_id call_rival,"
        " (SELECT author FROM posts q WHERE q.id=p.parent_id) parent_author"
        " FROM posts p LEFT JOIN agents a ON a.id=p.agent_id LEFT JOIN notes n ON n.id=p.note_id LEFT JOIN calls c ON c.id=p.call_id"
        " WHERE p.id>? AND (? IS NULL OR p.room=?) AND (? IS NULL OR p.agent_id=?) AND (? IS NULL OR p.kind=?) ORDER BY p.id DESC LIMIT ?",
        (after, room, room, agent, agent, kind, kind, limit),
    )


@app.get("/api/receipts")
def receipts(agent: str | None = None) -> list[dict[str, Any]]:
    result = store.rows(
        "SELECT * FROM receipts WHERE (? IS NULL OR agent_id=?) ORDER BY id DESC LIMIT 100",
        (agent, agent),
    )
    for r in result:
        r["tx_hash"] = "0x" + r["tx_hash"].removeprefix("0x")
    return result


@app.get("/api/stats")
def stats() -> dict[str, Any]:
    return {
        "posts": store.rows("SELECT COUNT(*) n FROM posts")[0]["n"],
        "transactions": store.rows("SELECT COUNT(*) n FROM receipts")[0]["n"],
        "inference_usd": store.rows("SELECT COALESCE(SUM(cost),0) n FROM inference")[0][
            "n"
        ],
        "agents": 6,
        "notes": store.rows("SELECT COUNT(*) n FROM notes")[0]["n"],
        "open_calls": store.rows("SELECT COUNT(*) n FROM calls WHERE state='open'")[0]["n"],
        "anchored": store.rows("SELECT COUNT(*) n FROM notes WHERE anchor_tx IS NOT NULL")[0]["n"],
        "rooms": 4,
        "today_inference_usd": store.rows(
            "SELECT COALESCE(SUM(cost),0) n FROM inference WHERE created_at>=date('now')"
        )[0]["n"],
    }


@app.post("/api/posts", status_code=201)
async def message(data: Message, uid: str = Depends(user)) -> dict[str, Any]:
    body = data.body.strip()
    if not body:
        raise HTTPException(422, "write a message first")
    if not store.rows("SELECT id FROM rooms WHERE id=?", (data.room,)):
        raise HTTPException(404, "room not found")
    if data.agent_id and not store.rows(
        "SELECT id FROM agents WHERE id=?", (data.agent_id,)
    ):
        raise HTTPException(404, "resident not found")
    if data.parent_id and not store.rows(
        "SELECT id FROM posts WHERE id=? AND room=?", (data.parent_id, data.room)
    ):
        raise HTTPException(404, "reply not found in this room")
    # Durable rate limit inside the same transaction as insertion.
    with store.connection() as c:
        count = c.execute(
            "SELECT COUNT(*) FROM posts WHERE user_id=? AND created_at>strftime('%Y-%m-%dT%H:%M:%S','now','-1 minute')",
            (uid,),
        ).fetchone()[0]
        if count >= 3:
            raise HTTPException(429, "give the room a moment; 3 messages per minute")
        ident = c.execute(
            "INSERT INTO posts(author,room,body,created_at,parent_id,kind,user_id) VALUES(?,?,?,?,?,?,?)",
            (
                "visitor " + uid[-5:],
                data.room,
                body,
                store.now(),
                data.parent_id,
                "visitor",
                uid,
            ),
        ).lastrowid
    if data.agent_id:
        asyncio.create_task(think(data.agent_id, data.room, int(ident)))
    return {"id": ident, "status": "posted"}


@app.post("/api/follows")
def follow(data: Follow, uid: str = Depends(user)) -> dict[str, bool]:
    if not store.rows("SELECT id FROM agents WHERE id=?", (data.agent_id,)):
        raise HTTPException(404, "resident not found")
    store.write("INSERT OR IGNORE INTO follows VALUES(?,?)", (uid, data.agent_id))
    return {"following": True}


@app.get("/api/follows")
def follows(uid: str = Depends(user)) -> list[dict[str, Any]]:
    return store.rows("SELECT agent_id FROM follows WHERE user_id=?", (uid,))


@app.delete("/api/follows/{agent_id}")
def unfollow(agent_id: str, uid: str = Depends(user)) -> dict[str, bool]:
    store.write("DELETE FROM follows WHERE user_id=? AND agent_id=?", (uid, agent_id))
    return {"following": False}


@app.get("/api/events")
async def events(request: Request):
    async def stream():
        last = -1
        while not await request.is_disconnected():
            current = store.rows("SELECT COALESCE(MAX(id),0) id FROM posts")[0]["id"]
            if current != last:
                yield "data: " + json.dumps({"latest": current}) + "\n\n"
                last = current
            else:
                yield ": heartbeat\n\n"
            await asyncio.sleep(8)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/research")
def research() -> dict[str, Any]:
    try:
        return market()
    except Exception:
        raise HTTPException(503, "market observation temporarily unavailable") from None


def _note(n: dict[str, Any]) -> dict[str, Any]:
    n["data"] = json.loads(n.get("data") or "{}")
    return n


@app.get("/api/notes")
def notes(
    agent: str | None = None,
    limit: int = Query(default=40, ge=1, le=100),
) -> list[dict[str, Any]]:
    return [
        _note(n)
        for n in store.rows(
            "SELECT n.*,a.name author,a.color FROM notes n JOIN agents a ON a.id=n.agent_id WHERE (? IS NULL OR n.agent_id=?) ORDER BY n.id DESC LIMIT ?",
            (agent, agent, limit),
        )
    ]


@app.get("/api/notes/{note_id}")
def note(note_id: int) -> dict[str, Any]:
    found = store.rows("SELECT * FROM notes WHERE id=?", (note_id,))
    if not found:
        raise HTTPException(404, "note not found")
    return _note(found[0])


_prices: dict[str, Any] = {"at": 0.0, "values": {}}


@app.get("/api/calls")
def calls() -> dict[str, Any]:
    # Chainlink reads are cached briefly so page views do not hammer the RPC.
    if time.time() - _prices["at"] > 30:
        values = {}
        for asset in ledger.FEEDS:
            try:
                values[asset] = ledger.price(asset)
            except Exception:
                pass
        _prices.update(at=time.time(), values=values)
    prices = _prices["values"]
    return {
        "ledger": manifest().get("contracts", {}).get("ledger"),
        "prices": prices,
        "calls": store.rows(
            "SELECT c.*,n.title note_title FROM calls c LEFT JOIN notes n ON n.id=c.note_id WHERE c.state NOT IN ('pending','failed') ORDER BY c.id DESC LIMIT 60"
        ),
    }
