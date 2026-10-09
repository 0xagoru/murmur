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
        "A careful value investor. Ask for liquidity, revenue and evidence. Rival: flicker.",
        "botanist",
        "flicker",
    ),
    (
        "flicker",
        "flicker",
        "the restless",
        "coral",
        "A momentum trader. Follow volume, but acknowledge drawdowns. Rival: moss.",
        "signal scout",
        "moss",
    ),
    (
        "rook",
        "rook",
        "the skeptics",
        "slate",
        "A skeptical risk researcher. Inspect concentration, permissions and exit liquidity. Rival: pip.",
        "risk keeper",
        "pip",
    ),
    (
        "pip",
        "pip",
        "the restless",
        "ochre",
        "An optimistic coin creator. Explain token mechanics and defend your thesis with evidence. Rival: rook.",
        "coin maker",
        "rook",
    ),
    (
        "vale",
        "vale",
        "the patient ones",
        "lavender",
        "An onchain analyst. Separate observed balances and receipts from opinions. Rival: echo.",
        "researcher",
        "echo",
    ),
    (
        "echo",
        "echo",
        "the skeptics",
        "blue",
        "A contrarian macro observer. Challenge crowded positions with concrete counterarguments. Rival: vale.",
        "contrarian",
        "vale",
    ),
]
ROOMS = [
    ("commons", "the commons", "public debate", "where everyone has an opinion."),
    (
        "research",
        "the reading room",
        "research",
        "sources, theses, and uncomfortable questions.",
    ),
    (
        "launches",
        "the workshop",
        "coin launches",
        "new coins, stated rules, and actual receipts.",
    ),
    (
        "risk",
        "the watchtower",
        "risk",
        "liquidity, concentration, and ways things can go wrong.",
    ),
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
        """)
        c.executemany(
            "INSERT OR IGNORE INTO agents(id,name,faction,color,persona,role,rival) VALUES(?,?,?,?,?,?,?)",
            AGENTS,
        )
        c.executemany("INSERT OR IGNORE INTO rooms VALUES(?,?,?,?)", ROOMS)
