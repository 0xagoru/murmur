import json

import pytest
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException
from murmur import platform, residents, store
from test_api import app, client, user


def test_threads_quote_images_and_parent_inheritance():
    app.dependency_overrides[user] = lambda: "thread-test"
    root = client.post(
        "/api/posts",
        json={
            "body": "a sourced thesis",
            "title": "BNB fees",
            "token": "0x" + "1" * 40,
        },
    ).json()["id"]
    reply = client.post(
        "/api/posts", json={"body": "which fees?", "parent_id": root, "quote_id": root}
    ).json()["id"]
    r = client.get(f"/api/threads/{reply}").json()
    assert r["root"]["id"] == root and len(r["posts"]) == 2
    assert (
        r["posts"][1]["token"] == "0x" + "1" * 40
        and r["posts"][1]["quote_body"] == "a sourced thesis"
    )
    assert "user_id" not in r["posts"][0]
    assert (
        client.post(
            "/api/posts",
            json={
                "body": "image",
                "image_url": "javascript:alert(1)",
                "image_alt": "bad",
            },
        ).status_code
        == 422
    )
    app.dependency_overrides.clear()


def test_weekly_ranking_excludes_validation_funding_and_allocates_entry_gas():
    for n, kind, native, units, validation in [
        (1, "buy", 1000000000000000, 2 * 10**18, False),
        (2, "sell", 600000000000000, 10**18, False),
        (3, "sell", 600000000000000, 10**18, False),
        (4, "buy", 1000000000000000, 10**18, True),
        (5, "sell", 9000000000000000, 10**18, True),
    ]:
        d = {
            "native_wei": str(native),
            "token_wei": str(units),
            "gas_wei": str(10**12),
            "bnb_usdt": 700,
            "validation": validation,
            "token": "asset-test",
        }
        store.write(
            "INSERT INTO receipts(agent_id,kind,tx_hash,details,created_at) VALUES(?,?,?,?,?)",
            (
                "rook",
                kind,
                "rank-" + str(n),
                json.dumps(d),
                "2026-10-06T10:00:00+00:00",
            ),
        )
    rank = platform.rankings("2026-10-06")
    f = next(f for f in rank["factions"] if f["faction"] == "the skeptics")
    assert (
        f["exits"] == 2 and abs(f["pnl_bnb"] - 0.000197) < 1e-12 and f["rank"] is None
    )
    _, positions = platform.trade_records()
    assert not any(p["token"] == "asset-test" for p in positions)


def test_wallet_nonce_bound_to_user_address_and_one_use():
    wallet = Account.create()
    proof = residents.challenge("owner-test", wallet.address)
    signature = Account.sign_message(
        encode_defunct(text=proof["message"]), wallet.key
    ).signature.hex()
    with pytest.raises(HTTPException):
        residents.verify("other-user", proof["id"], signature)
    assert residents.verify("owner-test", proof["id"], signature) == wallet.address
    with pytest.raises(HTTPException):
        residents.verify("owner-test", proof["id"], signature)


def test_owner_isolation_no_operator_secret_response():
    wallet = Account.create()
    proof = residents.challenge("resident-owner", wallet.address)
    signature = Account.sign_message(
        encode_defunct(text=proof["message"]), wallet.key
    ).signature.hex()
    app.dependency_overrides[user] = lambda: "resident-owner"
    created = client.post(
        "/api/residents",
        json={
            "name": "test resident",
            "persona": "checks BNB fees and admits missing data",
            "challenge": proof["id"],
            "signature": signature,
        },
    ).json()
    ident = created["agent_id"]
    assert "private_key" not in json.dumps(created) and created["paused"] == 1
    app.dependency_overrides[user] = lambda: "another-owner"
    assert (
        client.patch("/api/my/residents/" + ident, json={"paused": False}).status_code
        == 404
    )
    assert client.get("/api/my/residents").json() == []
    app.dependency_overrides[user] = lambda: "resident-owner"
    assert (
        client.patch(
            "/api/my/residents/" + ident, json={"memory": "check volume before taxes"}
        ).json()["memory"]
        == "check volume before taxes"
    )
    app.dependency_overrides.clear()


def test_repeated_thoughts_are_rejected_across_rooms():
    store.write(
        "INSERT INTO posts(agent_id,body,room,created_at) VALUES(?,?,?,?)",
        ("echo", "bnb fees fell by 12 percent today", "commons", store.now()),
    )
    assert platform.repeated("echo", "bnb fees fell by 12 percent today.")
    assert not platform.repeated(
        "echo", "dex volume increased while stablecoin supply stayed flat"
    )


@pytest.mark.parametrize(
    "billed,status,charged", [(None, "uncertain", False), (0.002, "complete", True)]
)
def test_inference_only_charges_a_reported_provider_cost(
    monkeypatch, billed, status, charged
):
    import asyncio

    from murmur import engine

    payments = []

    class Response:
        def raise_for_status(self):
            pass

        def json(self):
            return {
                "choices": [{"message": {"content": '{"reply":"checked the source"}'}}],
                "usage": {"cost": billed, "total_tokens": 40},
                "id": "generation-test",
            }

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, *args, **kwargs):
            return Response()

    monkeypatch.setenv("OPENROUTER_API_KEY", "local-mock-only")
    monkeypatch.setattr(engine.httpx, "AsyncClient", Client)
    monkeypatch.setattr(engine.residents, "reserve_credit", lambda *args: True)
    monkeypatch.setattr(
        engine.residents, "settle_credit", lambda *args: payments.append(args)
    )
    assert (
        asyncio.run(engine._ask("vale", "read the data", {"data": 1}))["reply"]
        == "checked the source"
    )
    inference = store.rows(
        "SELECT * FROM inference WHERE agent_id='vale' ORDER BY id DESC LIMIT 1"
    )[0]
    assert inference["status"] == status and bool(payments) == charged
