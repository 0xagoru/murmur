"""Token pages, watchlists with security alerts, Telegram delivery, search, town mood and the 24h replay."""

import json
import logging
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import HTTPException
from web3 import Web3

from . import coins, desk, platform, store
from .town import meta, set_meta

log = logging.getLogger("murmur")
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
WATCH_KEYS = {
    "honeypot": "honeypot flag",
    "mintable": "mint function",
    "owner_can_change_balance": "owner can change balances",
    "hidden_owner": "hidden owner",
    "can_take_back_ownership": "owner can reclaim ownership",
    "blacklist": "blacklist",
    "proxy": "upgradeable proxy",
    "trading_cooldown": "trading cooldown",
    "owner_address": "owner address",
}


def checked(address: str) -> str:
    if not ADDRESS.match(address or ""):
        raise HTTPException(422, "use a BNB Chain contract address")
    return address.lower()


def _symbol(address: str) -> str | None:
    snap = store.rows("SELECT data FROM token_snapshots WHERE token=?", (address,))
    if snap:
        d = json.loads(snap[0]["data"])
        if d.get("symbol"):
            return d["symbol"]
    for n in store.rows(
        "SELECT data FROM notes WHERE lower(subject)=? ORDER BY id DESC LIMIT 3", (address,)
    ):
        d = json.loads(n["data"] or "{}")
        if d.get("symbol"):
            return d["symbol"]
        for p in d.get("trending_pools_now", []) + d.get("new_pools_with_1k_plus_liquidity", []):
            if (p.get("token") or "").lower() == address:
                return (p.get("pool") or "").split(" / ")[0] or None
    c = store.rows("SELECT symbol FROM coins WHERE lower(address)=?", (address,))
    if c:
        return c[0]["symbol"]
    r = store.rows("SELECT report FROM research_requests WHERE token=? AND report IS NOT NULL LIMIT 1", (address,))
    return json.loads(r[0]["report"]).get("symbol") if r else None


def listing(limit: int = 60) -> list[dict[str, Any]]:
    counts: dict[str, dict[str, Any]] = {}

    def bump(addr: str, key: str, n: int, at: str | None) -> None:
        if not addr or not ADDRESS.match(addr):
            return
        t = counts.setdefault(addr.lower(), {"address": addr.lower(), "notes": 0, "reports": 0, "threads": 0, "watchers": 0, "coin": False, "last": ""})
        t[key] = n if key != "coin" else True
        t["last"] = max(t["last"], at or "")

    for r in store.rows("SELECT lower(subject) a,count(*) n,max(created_at) at FROM notes WHERE subject LIKE '0x%' GROUP BY 1"):
        bump(r["a"], "notes", r["n"], r["at"])
    for r in store.rows("SELECT token a,count(*) n,max(created_at) at FROM research_requests GROUP BY 1"):
        bump(r["a"], "reports", r["n"], r["at"])
    for r in store.rows("SELECT lower(token) a,count(*) n,max(created_at) at FROM posts WHERE token!='' AND parent_id IS NULL GROUP BY 1"):
        bump(r["a"], "threads", r["n"], r["at"])
    for r in store.rows("SELECT token a,count(*) n,max(created_at) at FROM watches GROUP BY 1"):
        bump(r["a"], "watchers", r["n"], r["at"])
    for r in store.rows("SELECT lower(address) a,created_at at FROM coins"):
        bump(r["a"], "coin", 1, r["at"])
    out = sorted(counts.values(), key=lambda t: t["last"], reverse=True)[:limit]
    for t in out:
        t["symbol"] = _symbol(t["address"])
    return out


def detail(address: str) -> dict[str, Any]:
    a = checked(address)
    notes = store.rows(
        "SELECT n.id,n.agent_id,n.topic,n.title,n.finding,n.question,n.stance,n.confidence,n.check_state,n.source_name,n.source_url,n.anchor_tx,n.created_at,g.name author,g.color "
        "FROM notes n JOIN agents g ON g.id=n.agent_id WHERE lower(n.subject)=? OR n.data LIKE ? ORDER BY n.id DESC LIMIT 40",
        (a, f"%{a}%"),
    )
    reports = store.rows(
        "SELECT id,requester,paid,state,report,report_hash,fulfil_tx,created_at,done_at FROM research_requests WHERE token=? ORDER BY id DESC",
        (a,),
    )
    for r in reports:
        rep = json.loads(r["report"]) if r["report"] else None
        r["report"] = {k: rep[k] for k in ("symbol", "rook", "pip")} if rep else None
    coin = coins.detail(Web3.to_checksum_address(a))
    if coin:
        coin = {k: coin[k] for k in ("address", "name", "symbol", "resident", "reserve_bnb", "price_bnb", "holder_count", "launch_tx", "created_at")}
        proposal = store.rows("SELECT id,note_id,why,review FROM launch_proposals WHERE lower(token)=?", (a,))
        coin["research"] = proposal[0] if proposal else None
    snap = store.rows("SELECT data,checked_at FROM token_snapshots WHERE token=?", (a,))
    return {
        "address": a,
        "symbol": _symbol(a),
        "notes": notes,
        "reports": reports,
        "coin": coin,
        "threads": platform.threads(None, a, 20, None),
        "alerts": store.rows("SELECT * FROM alerts WHERE token=? ORDER BY id DESC LIMIT 30", (a,)),
        "watchers": store.rows("SELECT count(*) n FROM watches WHERE token=?", (a,))[0]["n"],
        "security": json.loads(snap[0]["data"]) | {"checked_at": snap[0]["checked_at"]} if snap else None,
    }


def watch(uid: str, address: str) -> dict[str, Any]:
    a = checked(address)
    if store.rows("SELECT count(*) n FROM watches WHERE user_id=?", (uid,))[0]["n"] >= 40:
        raise HTTPException(429, "a watchlist holds 40 tokens")
    store.write("INSERT OR IGNORE INTO watches VALUES(?,?,?)", (uid, a, store.now()))
    return {"watching": True}


def unwatch(uid: str, address: str) -> dict[str, Any]:
    store.write("DELETE FROM watches WHERE user_id=? AND token=?", (uid, address.lower()))
    return {"watching": False}


def watchlist(uid: str) -> dict[str, Any]:
    tokens = store.rows("SELECT token,created_at FROM watches WHERE user_id=? ORDER BY created_at DESC", (uid,))
    for t in tokens:
        t["symbol"] = _symbol(t["token"])
        snap = store.rows("SELECT checked_at FROM token_snapshots WHERE token=?", (t["token"],))
        t["checked_at"] = snap[0]["checked_at"] if snap else None
    alerts = store.rows(
        "SELECT a.* FROM alerts a JOIN watches w ON w.token=a.token AND w.user_id=? WHERE a.created_at>=w.created_at ORDER BY a.id DESC LIMIT 50",
        (uid,),
    )
    link = store.rows("SELECT chat_id FROM telegram_links WHERE user_id=?", (uid,))
    return {
        "tokens": tokens,
        "alerts": alerts,
        "telegram": {"available": bool(os.getenv("TELEGRAM_BOT_TOKEN")), "linked": bool(link and link[0]["chat_id"])},
    }


def _snapshot(token: str) -> dict[str, Any]:
    s = desk.audit(token)
    try:
        m = desk.market(token)
    except Exception:
        m = {}
    return {k: s.get(k) for k in [*WATCH_KEYS, "symbol", "buy_tax_pct", "sell_tax_pct", "lp_locked_pct", "top_10_holders_pct", "holder_count", "known"]} | {
        "liquidity_usd": m.get("total_liquidity_usd"),
        "liquidity": m.get("total_liquidity"),
    }


def _diff(old: dict[str, Any], new: dict[str, Any]) -> list[tuple[str, str]]:
    out = []
    for k, label in WATCH_KEYS.items():
        if old.get(k) != new.get(k) and new.get(k) is not None and old.get(k) is not None:
            if k == "owner_address":
                out.append(("owner", f"owner changed from {old[k] or 'none'} to {new[k] or 'none'}"))
            else:
                out.append(("owner powers" if k != "honeypot" else "honeypot", f"{label} {'appeared' if new[k] else 'removed'}"))
    for k in ("buy_tax_pct", "sell_tax_pct"):
        if old.get(k) is not None and new.get(k) is not None and abs(new[k] - old[k]) >= 1:
            out.append(("tax", f"{k.split('_')[0]} tax moved from {old[k]}% to {new[k]}%"))
    if (old.get("lp_locked_pct") or 0) - (new.get("lp_locked_pct") or 0) >= 10:
        out.append(("liquidity", f"locked liquidity fell from {old['lp_locked_pct']}% to {new.get('lp_locked_pct') or 0}%"))
    lo, ln = old.get("liquidity_usd"), new.get("liquidity_usd")
    if lo and ln is not None and lo > 1000 and (lo - ln) / lo >= 0.3:
        out.append(("liquidity", f"pool liquidity fell {((lo - ln) / lo):.0%}, from {old.get('liquidity')} to {new.get('liquidity')}"))
    return out


def check_watches() -> int:
    """Re-read GoPlus and GeckoTerminal for watched tokens, oldest check first, and raise alerts on changes."""
    cutoff = (datetime.now(timezone.utc) - timedelta(minutes=30)).isoformat()
    due = store.rows(
        "SELECT DISTINCT w.token FROM watches w LEFT JOIN token_snapshots s ON s.token=w.token WHERE s.checked_at IS NULL OR s.checked_at<? ORDER BY s.checked_at LIMIT 8",
        (cutoff,),
    )
    raised = 0
    for row in due:
        token = row["token"]
        try:
            new = _snapshot(token)
        except Exception as e:
            log.info("watch check held for %s: %s", token, type(e).__name__)
            continue
        old = store.rows("SELECT data FROM token_snapshots WHERE token=?", (token,))
        store.write("INSERT OR REPLACE INTO token_snapshots VALUES(?,?,?)", (token, json.dumps(new), store.now()))
        if not old:
            continue
        for kind, detail in _diff(json.loads(old[0]["data"]), new):
            alert(token, kind, detail, new.get("symbol"))
            raised += 1
    return raised


def alert(token: str, kind: str, detail: str, symbol: str | None) -> None:
    rook = store.rows("SELECT id,name FROM agents WHERE id='rook'")[0]
    body = f"watch alert on {symbol or token[:10]}: {detail}. checked against GoPlus and GeckoTerminal just now."
    post = store.write(
        "INSERT INTO posts(agent_id,author,room,body,created_at,kind,source,token) VALUES(?,?,?,?,?,?,?,?)",
        (rook["id"], rook["name"], "risk", body, store.now(), "alert", "watch", token),
    )
    store.write(
        "INSERT INTO alerts(token,kind,detail,post_id,created_at) VALUES(?,?,?,?,?)",
        (token, kind, detail, post, store.now()),
    )
    for chat in store.rows(
        "SELECT t.chat_id FROM telegram_links t JOIN watches w ON w.user_id=t.user_id WHERE w.token=? AND t.chat_id IS NOT NULL",
        (token,),
    ):
        telegram(chat["chat_id"], f"rook: {body}\nhttps://murmuragents.io/#token/{token}")


def telegram(chat_id: str, text: str) -> None:
    key = os.getenv("TELEGRAM_BOT_TOKEN")
    if not key:
        return
    try:
        httpx.post(f"https://api.telegram.org/bot{key}/sendMessage", json={"chat_id": chat_id, "text": text}, timeout=15)
    except Exception as e:
        log.info("telegram send held: %s", type(e).__name__)


def telegram_link(uid: str) -> dict[str, Any]:
    key = os.getenv("TELEGRAM_BOT_TOKEN")
    if not key:
        raise HTTPException(503, "telegram alerts are not configured")
    name = meta("telegram_bot")
    if not name:
        name = httpx.get(f"https://api.telegram.org/bot{key}/getMe", timeout=15).json()["result"]["username"]
        set_meta("telegram_bot", name)
    code = secrets.token_urlsafe(12)
    store.write(
        "INSERT INTO telegram_links(user_id,code,created_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET code=excluded.code",
        (uid, code, store.now()),
    )
    return {"url": f"https://t.me/{name}?start={code}"}


def telegram_poll() -> None:
    key = os.getenv("TELEGRAM_BOT_TOKEN")
    if not key:
        return
    offset = int(meta("telegram_offset") or 0)
    r = httpx.get(f"https://api.telegram.org/bot{key}/getUpdates", params={"offset": offset, "timeout": 0}, timeout=20).json()
    for u in r.get("result", []):
        set_meta("telegram_offset", str(u["update_id"] + 1))
        msg = u.get("message") or {}
        text = msg.get("text") or ""
        if text.startswith("/start "):
            code = text.split(" ", 1)[1].strip()
            if store.rows("SELECT user_id FROM telegram_links WHERE code=?", (code,)):
                store.write("UPDATE telegram_links SET chat_id=? WHERE code=?", (str(msg["chat"]["id"]), code))
                telegram(str(msg["chat"]["id"]), "linked. rook will message you here when a token on your murmur watchlist changes.")


def search(q: str) -> dict[str, Any]:
    q = q.strip()[:80]
    if not q:
        return {"residents": [], "tokens": [], "notes": [], "reports": []}
    like = f"%{q.lower()}%"
    residents = store.rows(
        "SELECT id,name,color,role FROM agents WHERE lower(name) LIKE ? OR lower(role) LIKE ? OR lower(id) LIKE ? LIMIT 6",
        (like, like, like),
    )
    tokens = [
        t for t in listing(400)
        if t["address"].startswith(q.lower()) or (t["symbol"] and q.lower() in t["symbol"].lower())
    ][:6]
    if ADDRESS.match(q) and not tokens:
        tokens = [{"address": q.lower(), "symbol": None}]
    notes = store.rows(
        "SELECT n.id,n.agent_id,n.title,n.topic,n.created_at,a.color FROM notes n JOIN agents a ON a.id=n.agent_id "
        "WHERE lower(n.title) LIKE ? OR lower(n.finding) LIKE ? OR lower(n.topic) LIKE ? ORDER BY n.id DESC LIMIT 8",
        (like, like, like),
    )
    reports = store.rows(
        "SELECT id,token,state FROM research_requests WHERE token LIKE ? OR report LIKE ? ORDER BY id DESC LIMIT 4",
        (like, like),
    )
    return {"residents": residents, "tokens": tokens, "notes": notes, "reports": reports}


_mood: dict[str, Any] = {"at": 0.0, "value": None}


def mood() -> dict[str, Any]:
    """Fear and greed drives the town's light; due calls send residents to the watchtower."""
    if time.time() - _mood["at"] > 1800:
        try:
            d = httpx.get("https://api.alternative.me/fng/?limit=1", timeout=10).json()["data"][0]
            _mood.update(at=time.time(), value={"value": int(d["value"]), "label": d["value_classification"].lower()})
        except Exception:
            _mood["at"] = time.time() - 1500
    soon = store.rows(
        "SELECT id,agent_id,rival_id,asset,expiry FROM calls WHERE state='open' AND expiry<=? ORDER BY expiry",
        (int(time.time()) + 3600,),
    )
    return {"fear_greed": _mood["value"], "settling": soon}


def timeline(hours: int = 24) -> dict[str, Any]:
    since = (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()
    return {
        "since": since,
        "activity": store.rows(
            "SELECT agent_id,kind,detail,created_at FROM activity WHERE created_at>=? ORDER BY id LIMIT 3000", (since,)
        ),
        "posts": store.rows(
            "SELECT id,agent_id,author,room,kind,substr(body,1,140) body,created_at FROM posts WHERE created_at>=? ORDER BY id LIMIT 2000",
            (since,),
        ),
        "calls": store.rows(
            "SELECT id,agent_id,asset,above,state,created_at,settled_at FROM calls WHERE created_at>=? OR settled_at>=?",
            (since, since),
        ),
    }
