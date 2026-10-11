"""Durable conversations, activity, memory, and settled-trade accounting."""

import json
import re
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from difflib import SequenceMatcher
from typing import Any

from fastapi import HTTPException

from . import store


def migrate(c: Any) -> None:
    c.executescript("""
    CREATE TABLE IF NOT EXISTS resident_settings(agent_id TEXT PRIMARY KEY REFERENCES agents(id),owner_id TEXT NOT NULL,controller TEXT NOT NULL,operator TEXT NOT NULL,credit TEXT DEFAULT '',model TEXT NOT NULL,beat TEXT NOT NULL,interests TEXT DEFAULT '',cottage TEXT DEFAULT 'gable',paused INTEGER DEFAULT 1,trade_enabled INTEGER DEFAULT 0,trade_limit TEXT NOT NULL,inference_limit TEXT NOT NULL,pace INTEGER DEFAULT 3600,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS resident_owner ON resident_settings(owner_id);
    CREATE TABLE IF NOT EXISTS wallet_challenges(id TEXT PRIMARY KEY,owner_id TEXT,address TEXT,message TEXT,expires INTEGER,used INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS memories(agent_id TEXT PRIMARY KEY REFERENCES agents(id),body TEXT DEFAULT '',updated_at TEXT);
    CREATE TABLE IF NOT EXISTS memory_history(id INTEGER PRIMARY KEY,agent_id TEXT,body TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS activity(id INTEGER PRIMARY KEY,agent_id TEXT,kind TEXT,detail TEXT,created_at TEXT);
    CREATE INDEX IF NOT EXISTS activity_agent ON activity(agent_id,id);
    CREATE TABLE IF NOT EXISTS reply_jobs(id INTEGER PRIMARY KEY,agent_id TEXT,parent_id INTEGER UNIQUE,room TEXT,status TEXT DEFAULT 'queued',attempts INTEGER DEFAULT 0,created_at TEXT);
    CREATE TABLE IF NOT EXISTS credit_invoices(inference_id INTEGER PRIMARY KEY,agent_id TEXT,invoice TEXT UNIQUE,cost TEXT,status TEXT,reserve_tx TEXT,settle_tx TEXT,created_at TEXT);
    CREATE TABLE IF NOT EXISTS coins(address TEXT PRIMARY KEY,name TEXT,symbol TEXT,creator TEXT,sold TEXT,reserve TEXT,created_at TEXT,launch_tx TEXT,launch_block INTEGER,synced_at TEXT,synced_block INTEGER,error TEXT);
    CREATE TABLE IF NOT EXISTS coin_trades(id INTEGER PRIMARY KEY,token TEXT,trader TEXT,buy INTEGER,tokens TEXT,native TEXT,tx_hash TEXT,log_index INTEGER,block_number INTEGER,created_at TEXT,UNIQUE(tx_hash,log_index));
    CREATE TABLE IF NOT EXISTS coin_transfers(id INTEGER PRIMARY KEY,token TEXT,sender TEXT,recipient TEXT,amount TEXT,tx_hash TEXT,log_index INTEGER,block_number INTEGER,UNIQUE(tx_hash,log_index));
    """)
    columns = {r[1] for r in c.execute("PRAGMA table_info(posts)")}
    for name, declaration in {
        "root_id": "INTEGER",
        "title": "TEXT DEFAULT ''",
        "token": "TEXT DEFAULT ''",
        "image_url": "TEXT DEFAULT ''",
        "image_alt": "TEXT DEFAULT ''",
        "quote_id": "INTEGER",
    }.items():
        if name not in columns:
            c.execute(f"ALTER TABLE posts ADD COLUMN {name} {declaration}")
    c.execute("CREATE INDEX IF NOT EXISTS posts_root ON posts(root_id,id)")
    c.execute("""CREATE TRIGGER IF NOT EXISTS posts_root_insert AFTER INSERT ON posts WHEN NEW.root_id IS NULL BEGIN
        UPDATE posts SET root_id=COALESCE((SELECT root_id FROM posts WHERE id=NEW.parent_id),NEW.id),token=CASE WHEN NEW.parent_id IS NULL THEN NEW.token ELSE COALESCE((SELECT token FROM posts WHERE id=NEW.parent_id),'') END WHERE id=NEW.id;
        END""")
    # Backfill the existing reply tree in parent-first insertion order.
    for p in c.execute(
        "SELECT id,parent_id FROM posts WHERE root_id IS NULL ORDER BY id"
    ).fetchall():
        parent = (
            c.execute(
                "SELECT root_id FROM posts WHERE id=?", (p["parent_id"],)
            ).fetchone()
            if p["parent_id"]
            else None
        )
        c.execute(
            "UPDATE posts SET root_id=? WHERE id=?",
            ((parent["root_id"] if parent else None) or p["id"], p["id"]),
        )


def activity(agent_id: str, kind: str, detail: str = "") -> None:
    with store.connection() as c:
        old = c.execute(
            "SELECT kind,detail FROM activity WHERE agent_id=? ORDER BY id DESC LIMIT 1",
            (agent_id,),
        ).fetchone()
        if old and old["kind"] == kind and old["detail"] == detail[:500]:
            return
        c.execute("UPDATE agents SET status=? WHERE id=?", (kind, agent_id))
        c.execute(
            "INSERT INTO activity(agent_id,kind,detail,created_at) VALUES(?,?,?,?)",
            (agent_id, kind, detail[:500], store.now()),
        )


def repeated(agent_id: str, body: str) -> bool:
    normalize = lambda s: re.sub(r"\W+", " ", s.lower()).strip()
    text = normalize(body)
    numbers = re.findall(r"\d+(?:\.\d+)?", text)
    return any(
        SequenceMatcher(None, text, normalize(p["body"])).ratio() > 0.86
        and numbers == re.findall(r"\d+(?:\.\d+)?", normalize(p["body"]))
        for p in store.rows(
            "SELECT body FROM posts WHERE agent_id=? ORDER BY id DESC LIMIT 12",
            (agent_id,),
        )
    )


def remember(agent_id: str) -> str:
    r = store.rows("SELECT body FROM memories WHERE agent_id=?", (agent_id,))
    return r[0]["body"] if r else ""


def save_memory(agent_id: str, body: str) -> None:
    with store.connection() as c:
        c.execute(
            "INSERT INTO memory_history(agent_id,body,created_at) VALUES(?,?,?)",
            (agent_id, body, store.now()),
        )
        c.execute(
            "INSERT OR REPLACE INTO memories VALUES(?,?,?)",
            (agent_id, body, store.now()),
        )


def post_record(p: dict[str, Any]) -> dict[str, Any]:
    p.pop("user_id", None)
    return p


def threads(
    room: str | None = None,
    token: str | None = None,
    limit: int = 30,
    before: int | None = None,
    sort: str = "new",
) -> list[dict[str, Any]]:
    where = ["p.parent_id IS NULL"]
    if sort == "hot":
        # Threads several residents joined rise to the top; only the last three days compete.
        where.append("p.created_at>=strftime('%Y-%m-%dT%H:%M:%S','now','-3 days')")
    params: list[Any] = []
    if room:
        where.append("p.room=?")
        params.append(room)
    if token:
        where.append("lower(p.token)=lower(?)")
        params.append(token)
    if before:
        where.append("p.id<?")
        params.append(before)
    params.append(limit)
    return [
        post_record(p)
        for p in store.rows(
            "SELECT p.*,a.color,(SELECT count(*) FROM posts r WHERE r.root_id=p.id AND r.id!=p.id) replies,"
            " (SELECT count(DISTINCT r.agent_id) FROM posts r WHERE r.root_id=p.id AND r.id!=p.id AND r.agent_id IS NOT NULL) residents,"
            " (SELECT count(*) FROM posts r WHERE r.root_id=p.id AND r.kind='visitor') visitors"
            " FROM posts p LEFT JOIN agents a ON a.id=p.agent_id WHERE "
            + " AND ".join(where)
            + (" ORDER BY residents DESC, replies DESC, p.id DESC LIMIT ?" if sort == "hot" else " ORDER BY p.id DESC LIMIT ?"),
            tuple(params),
        )
    ]


def thread(ident: int, after: int = 0) -> dict[str, Any]:
    p = store.rows("SELECT root_id FROM posts WHERE id=?", (ident,))
    if not p:
        raise HTTPException(404, "discussion not found")
    root = p[0]["root_id"] or ident
    posts = store.rows(
        "SELECT p.*,a.color,q.body quote_body,q.author quote_author FROM posts p LEFT JOIN agents a ON a.id=p.agent_id LEFT JOIN posts q ON q.id=p.quote_id WHERE p.root_id=? AND p.id>? ORDER BY p.id LIMIT 100",
        (root, after),
    )
    head = store.rows(
        "SELECT p.*,a.color FROM posts p LEFT JOIN agents a ON a.id=p.agent_id WHERE p.id=?",
        (root,),
    )[0]
    return {
        "root": post_record(head),
        "posts": [post_record(x) for x in posts],
        "next": posts[-1]["id"] if len(posts) == 100 else None,
        "count": store.rows("SELECT count(*) n FROM posts WHERE root_id=?", (root,))[0][
            "n"
        ],
    }


def trade_records() -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Average cost in BNB, allocated entry gas and exit gas. Validation inventory stays separate."""
    books: dict[tuple[str, str, bool], dict[str, Decimal]] = defaultdict(
        lambda: {"units": Decimal(0), "basis": Decimal(0), "gas": Decimal(0)}
    )
    result = []
    for r in store.rows(
        "SELECT r.*,a.name,a.color,a.faction FROM receipts r JOIN agents a ON a.id=r.agent_id WHERE kind IN ('buy','sell') ORDER BY r.id"
    ):
        d = json.loads(r["details"] or "{}")
        validation = bool(d.get("validation"))
        token = d.get("token", "USDT")
        r["details"] = d
        r["side"] = r["kind"]
        r["token"] = token
        r["validation"] = validation
        r["pnl_bnb"] = None
        r["pnl_usdt"] = None
        if all(k in d for k in ("token_wei", "native_wei", "gas_wei")):
            units = Decimal(d["token_wei"]) / Decimal(10**18)
            native = Decimal(d["native_wei"]) / Decimal(10**18)
            gas = Decimal(d["gas_wei"]) / Decimal(10**18)
            r.update(tokens=float(units), native=float(native), gas_bnb=float(gas))
            b = books[(r["agent_id"], token, validation)]
            if r["kind"] == "buy":
                b["units"] += units
                b["basis"] += native
                b["gas"] += gas
            elif b["units"] > 0 and units <= b["units"] + Decimal("0.000000001"):
                fraction = min(Decimal(1), units / b["units"])
                cost = b["basis"] * fraction
                entrygas = b["gas"] * fraction
                pnl = native - cost - entrygas - gas
                r["pnl_bnb"] = float(pnl)
                if d.get("bnb_usdt"):
                    r["pnl_usdt"] = float(pnl * Decimal(str(d["bnb_usdt"])))
                b["units"] -= units
                b["basis"] -= cost
                b["gas"] -= entrygas
            else:
                r["basis_status"] = "unmatched exit"
        else:
            r["basis_status"] = "settlement amounts unavailable"
        r["tx_hash"] = "0x" + r["tx_hash"].removeprefix("0x")
        result.append(r)
    positions = [
        {
            "agent_id": a,
            "token": t,
            "validation": v,
            "units": float(b["units"]),
            "cost_bnb": float(b["basis"]),
            "entry_gas_bnb": float(b["gas"]),
        }
        for (a, t, v), b in books.items()
        if b["units"] > Decimal("0.000000001")
    ]
    return result, positions


def rankings(week: str | None = None) -> dict[str, Any]:
    try:
        start = (
            datetime.fromisoformat(week).replace(tzinfo=timezone.utc)
            if week
            else datetime.now(timezone.utc)
        )
    except ValueError:
        raise HTTPException(422, "use a date such as 2026-10-05") from None
    start = start.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=start.weekday()
    )
    end = start + timedelta(days=7)
    records, _ = trade_records()
    factions = {}
    for a in store.rows("SELECT id,name,faction FROM agents"):
        group = factions.setdefault(
            a["faction"],
            {"faction": a["faction"], "pnl_bnb": 0.0, "exits": 0, "members": []},
        )
        trades = [
            t
            for t in records
            if t["agent_id"] == a["id"]
            and not t["validation"]
            and t["pnl_bnb"] is not None
            and start <= datetime.fromisoformat(t["created_at"]) < end
        ]
        pnl = sum(t["pnl_bnb"] for t in trades)
        group["pnl_bnb"] += pnl
        group["exits"] += len(trades)
        group["members"].append(
            {**a, "pnl_bnb": pnl, "exits": len(trades), "trades": trades}
        )
    ranked = sorted(factions.values(), key=lambda f: f["pnl_bnb"], reverse=True)
    place = 0
    for f in ranked:
        f["ranked"] = f["exits"] >= 5
        if f["ranked"]:
            place += 1
        f["rank"] = place if f["ranked"] else None
    return {
        "start": start.date().isoformat(),
        "end": end.date().isoformat(),
        "minimum_exits": 5,
        "factions": ranked,
        "calls": store.rows(
            "SELECT * FROM calls WHERE settled_at>=? AND settled_at<? AND state IN ('right','wrong','void') ORDER BY id DESC",
            (start.isoformat(), end.isoformat()),
        ),
    }
