import os
from tempfile import TemporaryDirectory

_temp = TemporaryDirectory()
os.environ["MURMUR_DATA"] = _temp.name
from fastapi.testclient import TestClient
from murmur.api import app
from murmur.auth import user
from murmur import store

store.init()
client = TestClient(app)


def test_public_config_never_exposes_secrets():
    r = client.get("/api/config")
    assert r.status_code == 200
    assert "secret" not in r.text.lower() and "private_key" not in r.text
    assert r.json()["chainId"] == 56


def test_message_requires_authentication():
    assert client.post("/api/posts", json={"body": "hello"}).status_code == 401


def test_room_and_reply_validation():
    app.dependency_overrides[user] = lambda: "test-user"
    assert (
        client.post("/api/posts", json={"body": "hello", "room": "missing"}).status_code
        == 404
    )
    assert (
        client.post("/api/posts", json={"body": "hello", "parent_id": 9999}).status_code
        == 404
    )
    assert client.post("/api/posts", json={"body": " "}).status_code == 422
    app.dependency_overrides.clear()


def test_durable_rate_limit():
    app.dependency_overrides[user] = lambda: "rate-test"
    for _ in range(3):
        assert client.post("/api/posts", json={"body": "hello"}).status_code == 201
    assert client.post("/api/posts", json={"body": "fourth"}).status_code == 429
    app.dependency_overrides.clear()


def test_unfunded_performance_not_invented():
    for agent in client.get("/api/agents").json():
        assert agent["realized_pnl_usdt"] is None
        assert agent["reputation"] == "unranked"


def test_matched_performance_includes_gas_and_ignores_funding():
    import json
    from murmur.trading import performance

    store.write(
        "INSERT INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
        ("moss", "funding", "fund", "1", "BNB", store.now(), "{}"),
    )
    buy = {
        "native_wei": str(10**15),
        "token_wei": str(10**18),
        "gas_wei": str(10**12),
        "bnb_usdt": 700,
        "validation": True,
    }
    sell = {
        "native_wei": str(11 * 10**14),
        "token_wei": str(10**18),
        "gas_wei": str(10**12),
        "bnb_usdt": 700,
        "validation": True,
    }
    for kind, detail in [("buy", buy), ("sell", sell)]:
        store.write(
            "INSERT INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
            ("moss", kind, kind, "0", "BNB", store.now(), json.dumps(detail)),
        )
    result = performance("moss")
    assert result["trades"] == 2 and result["settled_exits"] == 1
    assert abs(result["realized_pnl_bnb"] - 0.000098) < 1e-12
    assert abs(result["realized_pnl_usdt"] - 0.0686) < 1e-12
    assert result["reputation"] == "unranked"
