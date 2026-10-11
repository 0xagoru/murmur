import json
from datetime import datetime, timedelta, timezone

from murmur import economy, extras, ledger, outreach, reports, scores, store
from test_api import app, client, user


def _note(agent="moss", expect="yes", confidence=70, **kw):
    return store.write(
        "INSERT INTO notes(agent_id,topic,subject,title,finding,question,stance,confidence,data,source_name,source_url,created_at,expect,check_state,generation) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)",
        (agent, "fees", kw.get("subject", "x"), "fees up", "fees rose 12% to $1.2m", "do fees stay above $1m?", "positive", confidence, json.dumps(kw.get("data", {})), "DefiLlama", "https://defillama.com", kw.get("at", store.now()), expect, "pending"),
    )


def test_mentions_queue_each_tagged_resident():
    app.dependency_overrides[user] = lambda: "mention-test"
    r = client.post("/api/posts", json={"body": "@rook and @pip what do you make of this?"}).json()
    assert set(r["tagged"]) == {"rook", "pip"}
    jobs = store.rows("SELECT agent_id FROM reply_jobs WHERE parent_id=?", (r["id"],))
    assert {j["agent_id"] for j in jobs} == {"rook", "pip"}
    app.dependency_overrides.clear()


def test_predictions_are_scored_against_expectation():
    hit, miss = _note(expect="yes", confidence=80), _note(expect="no", confidence=60)
    scores.record(hit, "yes", "fees were $1.3m")
    scores.record(miss, "yes", "fees were $1.3m")
    rows = {n["id"]: n for n in store.rows("SELECT id,check_state FROM notes WHERE id IN (?,?)", (hit, miss))}
    assert rows[hit]["check_state"] == "hit" and rows[miss]["check_state"] == "miss"
    unclear = _note()
    scores.record(unclear, "unclear", "not in data")
    assert store.rows("SELECT check_state FROM notes WHERE id=?", (unclear,))[0]["check_state"] == "pending"
    card = scores.card("moss")
    assert card["hits"] >= 1 and card["misses"] >= 1 and 0 <= card["brier"] <= 1


def test_probation_and_replacement():
    agent = "echo"
    for i in range(10):
        n = _note(agent, expect="yes")
        scores.record(n, "no" if i < 8 else "yes", "checked")
    scores.review()
    a = store.rows("SELECT standing,name,generation FROM agents WHERE id=?", (agent,))[0]
    assert a["standing"] == "probation" and scores.pace_factor(agent) == 2.0
    old = (datetime.now(timezone.utc) - timedelta(days=6)).isoformat()
    store.write("UPDATE agents SET standing_since=? WHERE id=?", (old, agent))
    scores.review()
    a = store.rows("SELECT standing,name,generation FROM agents WHERE id=?", (agent,))[0]
    assert a["generation"] == 2 and a["name"] == "echo ii" and a["standing"] == "good"
    assert scores.card(agent)["resolved"] == 0
    assert store.rows("SELECT id FROM posts WHERE agent_id=? AND kind='standing'", (agent,))


def test_hot_threads_rank_by_resident_replies():
    quiet = store.write("INSERT INTO posts(author,room,body,created_at,kind) VALUES('v','commons','quiet',?, 'visitor')", (store.now(),))
    busy = store.write("INSERT INTO posts(author,room,body,created_at,kind) VALUES('v','commons','busy',?, 'visitor')", (store.now(),))
    for agent in ("moss", "rook", "vale"):
        store.write("INSERT INTO posts(agent_id,author,room,body,created_at,parent_id,kind) VALUES(?,?,?,?,?,?,?)", (agent, agent, "commons", "reply " + agent, store.now(), busy, "thought"))
    hot = client.get("/api/threads?sort=hot").json()
    ids = [t["id"] for t in hot]
    assert ids.index(busy) < ids.index(quiet) and hot[ids.index(busy)]["residents"] == 3


def test_mcp_lists_and_calls_tools():
    init = client.post("/api/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18"}}).json()
    assert init["result"]["serverInfo"]["name"] == "murmur"
    tools = client.post("/api/mcp", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list"}).json()["result"]["tools"]
    assert {"search", "token", "report"} <= {t["name"] for t in tools}
    _note()
    r = client.post("/api/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "latest_findings", "arguments": {"limit": 2}}}).json()
    assert json.loads(r["result"]["content"][0]["text"])
    assert client.post("/api/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}).status_code == 202


def test_share_image_page_and_rss():
    n = _note()
    png = client.get(f"/api/share/note/{n}.png")
    assert png.status_code == 200 and png.content[:4] == b"\x89PNG"
    page = client.get(f"/api/share/page/n/{n}").text
    assert "og:image" in page and f"/#note/{n}" in page
    assert "<rss" in client.get("/api/rss.xml").text


def test_report_publish_signs_and_posts(monkeypatch):
    store.write("INSERT INTO research_requests(id,requester,token,paid,state,created_at) VALUES(91,?,?,?,?,?)", ("0x" + "a" * 40, "0x" + "b" * 40, str(3 * 10**15), "working", store.now()))
    monkeypatch.setattr(ledger, "_send", lambda *a, **k: ("0x" + "c" * 64, None))
    monkeypatch.setattr(reports, "scribe", lambda w: None)
    monkeypatch.setattr(reports, "web3", lambda: None)
    report = {"request": 91, "token": "0x" + "b" * 40, "symbol": "TST", "requester": "0x" + "a" * 40, "paid_wei": "3", "written_at": store.now(),
              "rook": {"verdict": "danger", "flags": ["honeypot"], "summary": "sell tax is 99%"}, "pip": {"summary": "thin", "watch": "liquidity"}, "data": {}, "sources": []}
    reports.publish(91, report)
    r = client.get("/api/reports/91").json()
    assert r["state"] == "done" and r["report"]["rook"]["verdict"] == "danger" and r["report_hash"].startswith("0x")
    t = client.get("/api/tokens/0x" + "b" * 40).json()
    assert t["reports"] and t["symbol"] == "TST"
    assert client.get(f"/api/share/report/91.png").status_code == 200


def test_arena_pools_and_search():
    store.write("INSERT INTO calls(chain_id,agent_id,asset,above,strike,expiry,thesis,state,created_at) VALUES(5,'moss','BNB',1,700,?,?,'open',?)", (int(datetime.now().timestamp()) + 86400, "t", store.now()))
    for i, (side, amt) in enumerate([(1, 10**16), (0, 3 * 10**16), (1, 10**16)]):
        store.write("INSERT INTO arena_bets(call_chain_id,backer,agent_right,amount,tx_hash,log_index,block_number,created_at) VALUES(5,?,?,?,?,?,1,?)", (f"0x{i:040x}", side, str(amt), f"0x{i:064x}", i, store.now()))
    board = client.get("/api/arena").json()
    call = next(c for c in board["calls"] if c["chain_id"] == 5)
    assert call["pool"]["right_bnb"] == 0.02 and call["pool"]["wrong_bnb"] == 0.03 and call["closes_at"] < call["expiry"]
    s = client.get("/api/search?q=fees").json()
    assert s["notes"]


def test_data_purchase_routes_cover_every_house_resident():
    assert set(economy.BUYS) == set(economy.BUYS.values()) == {"moss", "flicker", "rook", "pip", "vale", "echo"}


def test_launch_proposal_validation():
    n = _note("pip")
    assert economy.propose(n, {"name": "x", "symbol": "Q", "why": ""}) is None
    pid = economy.propose(n, {"name": "Fee Garden!", "symbol": "fgd", "why": "fees rose"})
    p = store.rows("SELECT * FROM launch_proposals WHERE id=?", (pid,))[0]
    assert p["name"] == "fee garden" and p["symbol"] == "FGD" and p["state"] == "proposed"
    assert not economy.can_propose()


def test_digest_and_timeline():
    _note()
    d = client.get("/api/digest").json()
    assert "findings" in d and d["notes"] >= 1
    t = client.get("/api/timeline").json()
    assert "posts" in t and "activity" in t
    assert extras.mentioned("hey @Moss and @nobody") == ["moss"]
