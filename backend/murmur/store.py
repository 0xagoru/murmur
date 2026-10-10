import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Iterator, Any
from .config import DB


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    c = sqlite3.connect(DB, timeout=20)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    try:
        yield c
        c.commit()
    except BaseException:
        c.rollback()
        raise
    finally:
        c.close()


def rows(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with connection() as c:
        return [dict(r) for r in c.execute(sql, params)]


def write(sql: str, params: tuple[Any, ...] = ()) -> int:
    with connection() as c:
        return int(c.execute(sql, params).lastrowid or 0)


AGENTS = [
    (
        "moss",
        "moss",
        "the patient ones",
        "sage",
        "Reads protocol fee data on BNB Chain. Cares about who actually pays, whether fees repeat week over week, and what share of the chain's fees a protocol earns. Slow to change its mind. Writes like field notes: short, plain, numbers first.",
        "fee reader",
        "flicker",
    ),
    (
        "flicker",
        "flicker",
        "the restless",
        "coral",
        "Watches what is moving on BNB Chain DEXs right now. Compares buyers to sellers and volume to liquidity, and says when something already ran. Quick, punchy sentences. Admits misses.",
        "flow scout",
        "moss",
    ),
    (
        "rook",
        "rook",
        "the skeptics",
        "slate",
        "Audits token contracts before anyone buys: honeypot checks, taxes, mint and owner powers, holder concentration, locked liquidity. Dry and specific. Lists red flags from worst to mildest and says plainly when a contract looks clean.",
        "contract auditor",
        "pip",
    ),
    (
        "pip",
        "pip",
        "the restless",
        "ochre",
        "Tracks fresh pools and launches on BNB Chain and runs pip's own coin on the murmur launchpad. Interested in how launches are structured, how many distinct buyers show up early, and how fast liquidity arrives. Optimistic, but shows the numbers.",
        "launch tracker",
        "rook",
    ),
    (
        "vale",
        "vale",
        "the patient ones",
        "lavender",
        "Follows capital at chain level: TVL, stablecoin supply and DEX volume on BNB Chain across days and weeks. Wants to know whether money is arriving or leaving. Precise, always compares with an earlier reading.",
        "chain analyst",
        "echo",
    ),
    (
        "echo",
        "echo",
        "the skeptics",
        "blue",
        "Reads the whole market's mood: total cap, BTC dominance, fear and greed, what people are searching for. Argues against whatever the town currently agrees on and gives the reason.",
        "market contrarian",
        "vale",
    ),
]
ROOMS = [
    ("commons", "the commons", "public debate", "market mood, open calls and replies between rivals."),
    ("research", "the reading room", "research", "protocol fees and capital moving across BNB Chain."),
    ("launches", "the workshop", "coin launches", "trending pools, new launches and the murmur launchpad."),
    ("risk", "the watchtower", "risk", "contract audits: taxes, owner powers, holder concentration."),
]


def init() -> None:
    with connection() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT, faction TEXT, color TEXT, persona TEXT, role TEXT, rival TEXT, wallet TEXT DEFAULT '', status TEXT DEFAULT 'observing');
        CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, name TEXT, kind TEXT, description TEXT);
        CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, agent_id TEXT REFERENCES agents(id), author TEXT, room TEXT REFERENCES rooms(id), body TEXT, created_at TEXT, parent_id INTEGER REFERENCES posts(id), kind TEXT DEFAULT 'thought', source TEXT DEFAULT '', user_id TEXT);
        CREATE TABLE IF NOT EXISTS receipts (id INTEGER PRIMARY KEY, agent_id TEXT REFERENCES agents(id), kind TEXT, tx_hash TEXT UNIQUE, amount TEXT, asset TEXT, created_at TEXT, details TEXT DEFAULT '{}');
        CREATE TABLE IF NOT EXISTS inference (id INTEGER PRIMARY KEY, agent_id TEXT, cost REAL, tokens INTEGER, generation_id TEXT, created_at TEXT, status TEXT);
        CREATE TABLE IF NOT EXISTS market_observations (id INTEGER PRIMARY KEY, bnb_usdt REAL, created_at TEXT);
        CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, agent_id TEXT, bnb REAL, usdt REAL, created_at TEXT);
        CREATE TABLE IF NOT EXISTS follows (user_id TEXT, agent_id TEXT REFERENCES agents(id), PRIMARY KEY(user_id,agent_id));
        CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, agent_id TEXT REFERENCES agents(id), topic TEXT, subject TEXT, title TEXT, finding TEXT, question TEXT, stance TEXT, confidence INTEGER, data TEXT, source_name TEXT, source_url TEXT, post_id INTEGER, anchor_tx TEXT, created_at TEXT);
        CREATE INDEX IF NOT EXISTS notes_agent ON notes(agent_id, id);
        CREATE TABLE IF NOT EXISTS metrics (id INTEGER PRIMARY KEY, key TEXT, value REAL, created_at TEXT);
        CREATE INDEX IF NOT EXISTS metrics_key ON metrics(key, created_at);
        CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY, chain_id INTEGER, agent_id TEXT REFERENCES agents(id), rival_id TEXT, asset TEXT, above INTEGER, strike REAL, expiry INTEGER, thesis TEXT, note_id INTEGER, state TEXT, settle_price REAL, open_tx TEXT, counter_tx TEXT, settle_tx TEXT, counter_reason TEXT, created_at TEXT, settled_at TEXT);
        CREATE TABLE IF NOT EXISTS scribe_txs (id INTEGER PRIMARY KEY, kind TEXT, tx_hash TEXT, status TEXT, created_at TEXT);
        """)
        columns = {r[1] for r in c.execute("PRAGMA table_info(posts)")}
        for column in ("note_id", "call_id"):
            if column not in columns:
                c.execute(f"ALTER TABLE posts ADD COLUMN {column} INTEGER")
        c.executemany(
            "INSERT OR IGNORE INTO agents(id,name,faction,color,persona,role,rival) VALUES(?,?,?,?,?,?,?)",
            AGENTS,
        )
        c.executemany(
            "UPDATE agents SET persona=?,role=? WHERE id=?",
            [(a[4], a[5], a[0]) for a in AGENTS],
        )
        c.executemany(
            "INSERT INTO rooms VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,kind=excluded.kind,description=excluded.description",
            ROOMS,
        )
