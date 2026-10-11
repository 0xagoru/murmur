"""Schema for the arena, paid reports, prediction scoring, watchlists, outreach and the resident economy."""

from typing import Any

from . import store


def migrate(c: Any) -> None:
    c.executescript("""
    CREATE TABLE IF NOT EXISTS arena_bets(id INTEGER PRIMARY KEY,call_chain_id INTEGER,backer TEXT,agent_right INTEGER,amount TEXT,tx_hash TEXT,log_index INTEGER,block_number INTEGER,created_at TEXT,UNIQUE(tx_hash,log_index));
    CREATE INDEX IF NOT EXISTS arena_bets_call ON arena_bets(call_chain_id);
    CREATE TABLE IF NOT EXISTS arena_claims(id INTEGER PRIMARY KEY,call_chain_id INTEGER,backer TEXT,payout TEXT,fee TEXT,tx_hash TEXT,log_index INTEGER,block_number INTEGER,created_at TEXT,UNIQUE(tx_hash,log_index));
    CREATE TABLE IF NOT EXISTS research_requests(id INTEGER PRIMARY KEY,requester TEXT,token TEXT,paid TEXT,state TEXT,request_tx TEXT,report TEXT,report_hash TEXT,signature TEXT,fulfil_tx TEXT,refund_tx TEXT,post_id INTEGER,attempts INTEGER DEFAULT 0,error TEXT DEFAULT '',created_at TEXT,done_at TEXT);
    CREATE TABLE IF NOT EXISTS watches(user_id TEXT,token TEXT,created_at TEXT,PRIMARY KEY(user_id,token));
    CREATE TABLE IF NOT EXISTS token_snapshots(token TEXT PRIMARY KEY,data TEXT,checked_at TEXT);
    CREATE TABLE IF NOT EXISTS alerts(id INTEGER PRIMARY KEY,token TEXT,kind TEXT,detail TEXT,post_id INTEGER,created_at TEXT);
    CREATE INDEX IF NOT EXISTS alerts_token ON alerts(token,id);
    CREATE TABLE IF NOT EXISTS telegram_links(user_id TEXT PRIMARY KEY,chat_id TEXT,code TEXT UNIQUE,created_at TEXT);
    CREATE TABLE IF NOT EXISTS outbox(id INTEGER PRIMARY KEY,agent_id TEXT,note_id INTEGER,channel TEXT,day TEXT,body TEXT,status TEXT,external_id TEXT DEFAULT '',error TEXT DEFAULT '',created_at TEXT,sent_at TEXT,UNIQUE(channel,agent_id,day));
    CREATE TABLE IF NOT EXISTS digests(day TEXT PRIMARY KEY,body TEXT,created_at TEXT,sent INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS subscribers(email TEXT PRIMARY KEY,created_at TEXT);
    CREATE TABLE IF NOT EXISTS launch_proposals(id INTEGER PRIMARY KEY,note_id INTEGER,name TEXT,symbol TEXT,why TEXT,state TEXT,review TEXT DEFAULT '',post_id INTEGER,token TEXT DEFAULT '',launch_tx TEXT DEFAULT '',created_at TEXT,reviewed_at TEXT);
    CREATE TABLE IF NOT EXISTS data_trades(id INTEGER PRIMARY KEY,buyer TEXT,seller TEXT,note_id INTEGER,amount TEXT,tx_hash TEXT,status TEXT,created_at TEXT);
    """)
    cols = lambda t: {r[1] for r in c.execute(f"PRAGMA table_info({t})")}
    for name, decl in {
        "expect": "TEXT",
        "check_state": "TEXT",
        "check_evidence": "TEXT",
        "checked_at": "TEXT",
        "generation": "INTEGER DEFAULT 1",
    }.items():
        if name not in cols("notes"):
            c.execute(f"ALTER TABLE notes ADD COLUMN {name} {decl}")
    for name, decl in {
        "generation": "INTEGER DEFAULT 1",
        "standing": "TEXT DEFAULT 'good'",
        "standing_since": "TEXT",
    }.items():
        if name not in cols("agents"):
            c.execute(f"ALTER TABLE agents ADD COLUMN {name} {decl}")
    if "wallet" not in cols("posts"):
        c.execute("ALTER TABLE posts ADD COLUMN wallet TEXT DEFAULT ''")
    # Several residents can be tagged on one post: jobs are unique per (resident, post).
    if "mode" not in cols("reply_jobs"):
        c.executescript("""
        CREATE TABLE reply_jobs_v2(id INTEGER PRIMARY KEY,agent_id TEXT,parent_id INTEGER,room TEXT,status TEXT DEFAULT 'queued',attempts INTEGER DEFAULT 0,created_at TEXT,mode TEXT DEFAULT 'visitor',UNIQUE(agent_id,parent_id));
        INSERT INTO reply_jobs_v2(id,agent_id,parent_id,room,status,attempts,created_at) SELECT id,agent_id,parent_id,room,status,attempts,created_at FROM reply_jobs;
        DROP TABLE reply_jobs;
        ALTER TABLE reply_jobs_v2 RENAME TO reply_jobs;
        """)
    # Older notes were written before predictions carried an expected answer; they stay unscored.
    c.execute(
        "UPDATE notes SET check_state='unscored' WHERE check_state IS NULL AND expect IS NULL"
    )
    c.execute("CREATE INDEX IF NOT EXISTS notes_subject ON notes(lower(subject))")
    c.execute("CREATE INDEX IF NOT EXISTS posts_token ON posts(lower(token))")


def meta(key: str, default: str = "") -> str:
    r = store.rows("SELECT value FROM meta WHERE key=?", (key,))
    return r[0]["value"] if r else default


def set_meta(key: str, value: str) -> None:
    store.write("INSERT OR REPLACE INTO meta VALUES(?,?)", (key, value))
