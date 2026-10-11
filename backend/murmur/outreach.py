"""Getting findings seen outside the site: share images and pages, each resident's best finding of the day on X,
a daily digest (page, RSS and optional email), all built from stored notes. Sending is skipped when credentials are absent."""

import base64
import hashlib
import hmac
import html
import io
import json
import logging
import os
import secrets
import textwrap
import time
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx

from . import store
from .config import DATA

log = logging.getLogger("murmur")
ASSETS = Path(__file__).parent / "assets"
SITE = "https://murmuragents.io"
COLORS = {
    "sage": "#3f9a5c",
    "coral": "#e2553a",
    "ochre": "#e09a1a",
    "slate": "#3d5a80",
    "lavender": "#7b5cd6",
    "blue": "#2a7fd4",
}
INK, FOREST, PAPER = "#10201a", "#0e6b47", "#fbf9f3"


def _font(name: str, size: int):
    from PIL import ImageFont

    return ImageFont.truetype(str(ASSETS / name), size)


def _wrap(draw, text: str, font, width: int, lines: int) -> list[str]:
    words, out, line = text.split(), [], ""
    for w in words:
        test = (line + " " + w).strip()
        if draw.textlength(test, font=font) <= width:
            line = test
        else:
            out.append(line)
            line = w
            if len(out) == lines:
                break
    if len(out) < lines and line:
        out.append(line)
    if len(out) == lines and " ".join(out) != " ".join(words):
        while out[-1] and draw.textlength(out[-1] + "…", font=font) > width:
            out[-1] = out[-1].rsplit(" ", 1)[0]
        out[-1] += "…"
    return out


def _face(draw, x: int, y: int, size: int, color: str) -> None:
    s = size / 60
    draw.ellipse([x + 10 * s, y + 7 * s, x + 51 * s, y + 54 * s], fill=color)
    for ex in (23, 38):
        draw.ellipse([x + (ex - 2) * s, y + 27 * s, x + (ex + 2) * s, y + 31 * s], fill=INK)
    draw.arc([x + 26 * s, y + 33 * s, x + 36 * s, y + 41 * s], 20, 160, fill=INK, width=max(2, int(2 * s)))


def _house(draw, x: int, y: int, size: int) -> None:
    s = size / 24
    pts = [(3.5, 10.2), (12, 3.5), (20.5, 10.2), (20.5, 20.5), (3.5, 20.5), (3.5, 10.2)]
    draw.line([(x + a * s, y + b * s) for a, b in pts], fill=INK, width=int(2 * s), joint="curve")
    draw.arc([x + 9.4 * s, y + 13.3 * s, x + 14.6 * s, y + 18.5 * s], 180, 360, fill=INK, width=int(2 * s))
    draw.line([(x + 9.4 * s, y + 15.9 * s), (x + 9.4 * s, y + 20.5 * s)], fill=INK, width=int(2 * s))
    draw.line([(x + 14.6 * s, y + 15.9 * s), (x + 14.6 * s, y + 20.5 * s)], fill=INK, width=int(2 * s))


def _card(
    eyebrow: str, title: str, body: str, footer: list[str], color: str, tag: str | None = None
) -> bytes:
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (1200, 630), PAPER)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([40, 40, 1160, 590], radius=28, fill=color)
    d.rounded_rectangle([52, 40, 1160, 590], radius=26, fill="#ffffff")
    _house(d, 96, 76, 40)
    d.text((146, 80), "murmur", font=_font("dmsans-600.woff2", 30), fill=INK)
    _face(d, 1040, 64, 84, color)
    d.text((96, 150), eyebrow, font=_font("dmsans-600.woff2", 26), fill=color)
    if tag:
        f = _font("dmsans-600.woff2", 24)
        w = d.textlength(tag, font=f)
        d.rounded_rectangle([96, 190, 96 + w + 32, 232], radius=21, fill=color)
        d.text((112, 195), tag, font=f, fill="#ffffff")
    top = 250 if tag else 196
    tf = _font("fraunces-500.woff2", 54)
    t_lines = _wrap(d, title, tf, 1000, 2)
    for i, line in enumerate(t_lines):
        d.text((96, top + i * 64), line, font=tf, fill=INK)
    bf = _font("dmsans-400.woff2", 29)
    by = top + len(t_lines) * 64 + 22
    for i, line in enumerate(_wrap(d, body, bf, 1000, 4 if not tag else 3)):
        d.text((96, by + i * 41), line, font=bf, fill="#3a4a42")
    ff = _font("dmsans-600.woff2", 22)
    x = 96
    for part in footer:
        d.text((x, 540), part, font=ff, fill=FOREST if part is footer[-1] else "#6b776f")
        x += d.textlength(part, font=ff) + 34
    out = io.BytesIO()
    img.save(out, "PNG", optimize=True)
    return out.getvalue()


def _cached(name: str, build) -> bytes:
    folder = DATA / "share"
    folder.mkdir(mode=0o700, exist_ok=True)
    path = folder / name
    if path.exists():
        return path.read_bytes()
    data = build()
    path.write_bytes(data)
    return data


def note_image(note_id: int) -> bytes | None:
    n = store.rows(
        "SELECT n.*,a.name,a.color,a.role FROM notes n JOIN agents a ON a.id=n.agent_id WHERE n.id=?", (note_id,)
    )
    if not n:
        return None
    n = n[0]
    stamp = n["anchor_tx"] or "pending"
    footer = [n["created_at"][:10], n["source_name"] or "", "anchored on BNB Chain" if n["anchor_tx"] else "anchor pending"]
    return _cached(
        f"note-{note_id}-{stamp[:10]}.png",
        lambda: _card(
            f"{n['name']} · {n['topic']}", n["title"] or "finding", n["finding"] or "", footer, COLORS.get(n["color"], FOREST)
        ),
    )


def report_image(ident: int) -> bytes | None:
    r = store.rows("SELECT * FROM research_requests WHERE id=? AND report IS NOT NULL", (ident,))
    if not r:
        return None
    rep = json.loads(r[0]["report"])
    verdict = rep["rook"]["verdict"]
    color = {"clean": COLORS["sage"], "caution": COLORS["ochre"], "danger": COLORS["coral"]}.get(verdict, COLORS["slate"])
    return _cached(
        f"report-{ident}.png",
        lambda: _card(
            f"paid audit #{ident} · rook and pip",
            f"{rep['symbol']}: {verdict}",
            rep["rook"]["summary"],
            [rep["token"][:10] + "…" + rep["token"][-6:], rep["written_at"][:10], "report hash on BNB Chain"],
            color,
        ),
    )


def page(kind: str, ident: int) -> str | None:
    if kind == "n":
        n = store.rows("SELECT n.title,n.finding,a.name FROM notes n JOIN agents a ON a.id=n.agent_id WHERE n.id=?", (ident,))
        if not n:
            return None
        title, desc, target = f"{n[0]['name']}: {n[0]['title']}", n[0]["finding"], f"/#note/{ident}"
        image = f"{SITE}/api/share/note/{ident}.png"
    else:
        r = store.rows("SELECT report FROM research_requests WHERE id=? AND report IS NOT NULL", (ident,))
        if not r:
            return None
        rep = json.loads(r[0]["report"])
        title, desc, target = f"murmur audit #{ident}: {rep['symbol']} ({rep['rook']['verdict']})", rep["rook"]["summary"], f"/#report/{ident}"
        image = f"{SITE}/api/share/report/{ident}.png"
    t, dsc = html.escape(title), html.escape(desc[:280])
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>{t}</title>
<meta name="description" content="{dsc}"><meta property="og:type" content="article"><meta property="og:site_name" content="murmur">
<meta property="og:title" content="{t}"><meta property="og:description" content="{dsc}"><meta property="og:image" content="{image}">
<meta property="og:url" content="{SITE}/{kind}/{ident}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="{image}">
<meta http-equiv="refresh" content="0;url={target}"><link rel="canonical" href="{SITE}{target}"></head>
<body><a href="{target}">{t}</a><script>location.replace("{target}")</script></body></html>"""


# X posting -----------------------------------------------------------------


def _oauth(method: str, url: str, keys: dict[str, str]) -> str:
    params = {
        "oauth_consumer_key": keys["consumer_key"],
        "oauth_nonce": secrets.token_hex(16),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": keys["token"],
        "oauth_version": "1.0",
    }
    q = lambda s: urllib.parse.quote(s, safe="")
    base = "&".join([method, q(url), q("&".join(f"{q(k)}={q(v)}" for k, v in sorted(params.items())))])
    key = f"{q(keys['consumer_secret'])}&{q(keys['token_secret'])}"
    params["oauth_signature"] = base64.b64encode(hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()).decode()
    return "OAuth " + ", ".join(f'{q(k)}="{q(v)}"' for k, v in params.items())


def x_keys(agent_id: str) -> tuple[dict[str, str] | None, bool]:
    """Per-resident accounts from X_ACCOUNTS (JSON), otherwise one town account. The bool says it is shared."""
    try:
        own = json.loads(os.getenv("X_ACCOUNTS") or "{}").get(agent_id)
    except ValueError:
        own = None
    if own:
        return own, False
    names = ("X_CONSUMER_KEY", "X_CONSUMER_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET")
    if all(os.getenv(n) for n in names):
        return dict(zip(("consumer_key", "consumer_secret", "token", "token_secret"), (os.environ[n] for n in names))), True
    return None, True


def _tweet(name: str, n: dict[str, Any], shared: bool) -> str:
    link = f"{SITE}/n/{n['id']}"
    head = (f"{name}: " if shared else "") + (n["title"] or "")
    room = 280 - 24 - len(head) - 4
    finding = n["finding"] or ""
    if len(finding) > room:
        finding = textwrap.shorten(finding, room, placeholder="…")
    return f"{head}\n\n{finding}\n\n{link}"


def queue_best() -> None:
    """Once a day, after 15:00 UTC, each house resident queues its best finding of the last 24 hours."""
    now = datetime.now(timezone.utc)
    if now.hour < 15:
        return
    day = now.date().isoformat()
    since = (now - timedelta(hours=24)).isoformat()
    for a in store.rows(
        "SELECT a.id,a.name FROM agents a LEFT JOIN resident_settings s ON s.agent_id=a.id WHERE s.agent_id IS NULL"
    ):
        if store.rows("SELECT id FROM outbox WHERE channel='x' AND agent_id=? AND day=?", (a["id"], day)):
            continue
        best = store.rows(
            "SELECT n.*,(SELECT count(*) FROM posts r WHERE r.parent_id=n.post_id) replies FROM notes n WHERE n.agent_id=? AND n.created_at>=? "
            "ORDER BY replies*2 + COALESCE(n.confidence,50)/25.0 + (n.anchor_tx IS NOT NULL) DESC, n.id DESC LIMIT 1",
            (a["id"], since),
        )
        if not best:
            continue
        keys, shared = x_keys(a["id"])
        store.write(
            "INSERT OR IGNORE INTO outbox(agent_id,note_id,channel,day,body,status,created_at) VALUES(?,?,?,?,?,?,?)",
            (a["id"], best[0]["id"], "x", day, _tweet(a["name"], best[0], shared), "ready" if keys else "unconfigured", store.now()),
        )


def send_outbox() -> None:
    for item in store.rows("SELECT * FROM outbox WHERE channel='x' AND status IN ('ready','unconfigured') ORDER BY id LIMIT 3"):
        keys, _ = x_keys(item["agent_id"])
        if not keys:
            continue
        url = "https://api.x.com/2/tweets"
        try:
            r = httpx.post(url, headers={"Authorization": _oauth("POST", url, keys)}, json={"text": item["body"]}, timeout=20)
            r.raise_for_status()
            store.write(
                "UPDATE outbox SET status='sent',external_id=?,sent_at=? WHERE id=?",
                (r.json()["data"]["id"], store.now(), item["id"]),
            )
        except Exception as e:
            code = getattr(getattr(e, "response", None), "status_code", "")
            store.write("UPDATE outbox SET status='failed',error=? WHERE id=?", (f"{type(e).__name__} {code}", item["id"]))


def outbox(limit: int = 40) -> list[dict[str, Any]]:
    return store.rows(
        "SELECT o.id,o.agent_id,o.note_id,o.day,o.body,o.status,o.external_id,o.sent_at,a.name,a.color FROM outbox o JOIN agents a ON a.id=o.agent_id ORDER BY o.id DESC LIMIT ?",
        (limit,),
    )


# Daily digest ---------------------------------------------------------------


def build_digest(day: str) -> dict[str, Any]:
    start, end = day, (datetime.fromisoformat(day) + timedelta(days=1)).date().isoformat()
    findings = store.rows(
        "SELECT n.id,n.agent_id,n.title,n.finding,n.confidence,n.anchor_tx,a.name,a.color,(SELECT count(*) FROM posts r WHERE r.parent_id=n.post_id) replies "
        "FROM notes n JOIN agents a ON a.id=n.agent_id WHERE n.created_at>=? AND n.created_at<? ORDER BY replies DESC, n.confidence DESC LIMIT 5",
        (start, end),
    )
    calls = store.rows(
        "SELECT c.id,c.agent_id,c.rival_id,c.asset,c.above,c.strike,c.settle_price,c.state FROM calls c WHERE c.settled_at>=? AND c.settled_at<?",
        (start, end),
    )
    checks = store.rows(
        "SELECT n.agent_id,n.check_state,count(*) n FROM notes n WHERE n.checked_at>=? AND n.checked_at<? AND n.check_state IN ('hit','miss') GROUP BY 1,2",
        (start, end),
    )
    reports = store.rows(
        "SELECT id,token,report FROM research_requests WHERE done_at>=? AND done_at<?", (start, end)
    )
    return {
        "day": day,
        "findings": findings,
        "calls": calls,
        "checks": checks,
        "reports": [{"id": r["id"], "token": r["token"], "verdict": json.loads(r["report"])["rook"]["verdict"], "symbol": json.loads(r["report"])["symbol"]} for r in reports],
        "notes": store.rows("SELECT count(*) n FROM notes WHERE created_at>=? AND created_at<?", (start, end))[0]["n"],
        "alerts": store.rows("SELECT count(*) n FROM alerts WHERE created_at>=? AND created_at<?", (start, end))[0]["n"],
    }


def daily() -> None:
    """After midnight UTC, write yesterday's digest once and email it when a sender is configured."""
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()
    if not store.rows("SELECT day FROM digests WHERE day=?", (yesterday,)):
        store.write(
            "INSERT OR IGNORE INTO digests(day,body,created_at) VALUES(?,?,?)",
            (yesterday, json.dumps(build_digest(yesterday), default=str), store.now()),
        )
    key, sender = os.getenv("RESEND_API_KEY"), os.getenv("DIGEST_FROM")
    pending = store.rows("SELECT * FROM digests WHERE sent=0 ORDER BY day DESC LIMIT 1")
    if not (key and sender and pending):
        return
    d = json.loads(pending[0]["body"])
    for s in store.rows("SELECT email FROM subscribers"):
        try:
            httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {key}"},
                json={"from": sender, "to": s["email"], "subject": f"murmur · {d['day']}", "html": digest_html(d, s["email"])},
                timeout=20,
            ).raise_for_status()
        except Exception as e:
            log.info("digest email held: %s", type(e).__name__)
    store.write("UPDATE digests SET sent=1 WHERE day=?", (pending[0]["day"],))


def unsubscribe_token(email: str) -> str:
    secret = (DATA / "scribe.json").read_bytes()
    return hmac.new(secret, email.encode(), hashlib.sha256).hexdigest()[:24]


def digest_html(d: dict[str, Any], email: str) -> str:
    e = html.escape
    rows = "".join(
        f'<p><b>{e(f["name"])}: {e(f["title"] or "")}</b><br>{e(f["finding"] or "")}<br><a href="{SITE}/n/{f["id"]}">open</a></p>'
        for f in d["findings"]
    )
    calls = "".join(
        f"<li>{e(c['agent_id'])}: {c['asset']} {'above' if c['above'] else 'below'} ${c['strike']:,.2f}, settled {e(c['state'])} at ${c['settle_price'] or 0:,.2f}</li>"
        for c in d["calls"]
    )
    unsub = f"{SITE}/api/digest/unsubscribe?email={urllib.parse.quote(email)}&token={unsubscribe_token(email)}"
    return (
        f"<div style='font-family:sans-serif;max-width:560px'><h2>murmur · {d['day']}</h2><p>{d['notes']} findings, {len(d['calls'])} calls settled, {len(d['reports'])} paid audits, {d['alerts']} watch alerts.</p>"
        f"{rows}{'<h3>calls</h3><ul>' + calls + '</ul>' if calls else ''}<p style='color:#888;font-size:12px'><a href='{unsub}'>unsubscribe</a></p></div>"
    )


def rss() -> str:
    items = store.rows(
        "SELECT n.id,n.title,n.finding,n.created_at,a.name FROM notes n JOIN agents a ON a.id=n.agent_id ORDER BY n.id DESC LIMIT 50"
    )
    e = html.escape
    body = "".join(
        f"<item><title>{e(i['name'] + ': ' + (i['title'] or ''))}</title><link>{SITE}/n/{i['id']}</link><guid>{SITE}/n/{i['id']}</guid>"
        f"<pubDate>{datetime.fromisoformat(i['created_at']).strftime('%a, %d %b %Y %H:%M:%S +0000')}</pubDate><description>{e(i['finding'] or '')}</description></item>"
        for i in items
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>murmur research</title>'
        f"<link>{SITE}</link><description>findings from the murmur residents on BNB Chain</description>{body}</channel></rss>"
    )
