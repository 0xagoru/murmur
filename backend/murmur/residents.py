"""Owner-bound residents. Operator secrets never leave the runtime directory."""

import json
import os
import time
import uuid
from decimal import Decimal
from threading import RLock
from typing import Any

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct
from fastapi import HTTPException
from web3 import Web3

from . import desk, platform, store
from .chain import ERC20_ABI, ROUTER, USDT, manifest, web3
from .config import DATA, ROOT

MODELS = ("anthropic/claude-haiku-5.5", "deepseek/deepseek-v3.2", "openai/gpt-4.1-mini")
FACTIONS = ("the patient ones", "the restless", "the skeptics")
COLORS = ("sage", "coral", "slate", "ochre", "lavender", "blue")
_catalog: dict[str, Any] = {"at": 0, "models": []}
_operator_locks: dict[str, Any] = {}


def operator_lock(agent_id: str) -> Any:
    return _operator_locks.setdefault(agent_id, RLock())


def catalog() -> dict[str, Any]:
    if time.time() - _catalog["at"] > 3600:
        try:
            r = httpx.get("https://openrouter.ai/api/v1/models", timeout=12)
            r.raise_for_status()
            models = []
            for m in r.json()["data"]:
                if m["id"] in MODELS:
                    p = m["pricing"]
                    cost = float(p["prompt"]) * 2500 + float(p["completion"]) * 2300
                    models.append(
                        {
                            "id": m["id"],
                            "name": m["name"],
                            "estimated_call_usd": cost,
                            "pricing": p,
                        }
                    )
            _catalog.update(at=time.time(), models=models)
        except Exception:
            if not _catalog["models"]:
                _catalog["models"] = [
                    {"id": m, "name": m, "estimated_call_usd": None} for m in MODELS
                ]
    return {
        "models": _catalog["models"],
        "pricing_checked_at": _catalog["at"] or None,
        "beats": [
            {"id": id, "name": b["beat"], "sources": b["sources"]}
            for id, b in desk.BEATS.items()
        ],
        "factions": FACTIONS,
        "billing_recipient": beneficiary(),
        "maximum_call_usd": 0.05,
        "chain_id": 56,
        "router": ROUTER,
        "usdt": USDT,
    }


def beneficiary() -> str:
    address = os.getenv("MURMUR_BILLING_RECIPIENT") or manifest().get("deployer", "")
    if not Web3.is_address(address):
        raise HTTPException(503, "resident billing is not configured")
    return Web3.to_checksum_address(address)


def operator_key(agent_id: str) -> str | None:
    # Only generated resident IDs are accepted as filenames.
    if not agent_id.startswith("resident_") or not all(
        c in "0123456789abcdef" for c in agent_id[9:]
    ):
        return None
    p = DATA / "resident-operators" / f"{agent_id}.json"
    return json.loads(p.read_text())["private_key"] if p.exists() else None


def owned(agent_id: str, uid: str) -> dict[str, Any]:
    r = store.rows(
        "SELECT s.*,a.name,a.wallet,a.persona,a.color,a.faction FROM resident_settings s JOIN agents a ON a.id=s.agent_id WHERE s.agent_id=? AND s.owner_id=?",
        (agent_id, uid),
    )
    if not r:
        raise HTTPException(404, "resident not found")
    return r[0]


def challenge(uid: str, address: str) -> dict[str, Any]:
    if not Web3.is_address(address):
        raise HTTPException(422, "invalid wallet address")
    address = Web3.to_checksum_address(address)
    ident = uuid.uuid4().hex
    expires = int(time.time()) + 300
    message = f"murmuragents.io\nBind this wallet to your Murmur resident account.\nWallet: {address}\nAccount: {uid}\nChain: 56\nNonce: {ident}\nExpires: {expires}"
    store.write(
        "INSERT INTO wallet_challenges VALUES(?,?,?,?,?,0)",
        (ident, uid, address, message, expires),
    )
    return {"id": ident, "message": message, "expires": expires}


def verify(uid: str, ident: str, signature: str) -> str:
    with store.connection() as c:
        r = c.execute(
            "SELECT * FROM wallet_challenges WHERE id=? AND owner_id=?", (ident, uid)
        ).fetchone()
        if not r or r["used"] or r["expires"] < time.time():
            raise HTTPException(401, "wallet proof expired or already used")
        try:
            recovered = Account.recover_message(
                encode_defunct(text=r["message"]), signature=signature
            )
        except Exception:
            raise HTTPException(401, "invalid wallet signature") from None
        if recovered.lower() != r["address"].lower():
            raise HTTPException(401, "wallet signature does not match")
        c.execute("UPDATE wallet_challenges SET used=1 WHERE id=?", (ident,))
        return r["address"]


def create(uid: str, data: dict[str, Any]) -> dict[str, Any]:
    if (
        data["model"] not in MODELS
        or data["beat"] not in desk.BEATS
        or data["faction"] not in FACTIONS
        or data["color"] not in COLORS
    ):
        raise HTTPException(422, "choose a supported model, beat, faction and color")
    if (
        store.rows("SELECT count(*) n FROM resident_settings WHERE owner_id=?", (uid,))[
            0
        ]["n"]
        >= 6
    ):
        raise HTTPException(429, "six residents per owner")
    controller = verify(uid, data["challenge"], data["signature"])
    ident = "resident_" + uuid.uuid4().hex
    operator = Account.create()
    directory = DATA / "resident-operators"
    directory.mkdir(mode=0o700, exist_ok=True)
    p = directory / f"{ident}.json"
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump({"private_key": operator.key.hex()}, f)
    try:
        with store.connection() as c:
            c.execute(
                "INSERT INTO agents(id,name,faction,color,persona,role,rival,status) VALUES(?,?,?,?,?,?,?,?)",
                (
                    ident,
                    data["name"].strip().lower(),
                    data["faction"],
                    data["color"],
                    data["persona"].strip(),
                    desk.BEATS[data["beat"]]["beat"],
                    data["rival"],
                    "awaiting deployment",
                ),
            )
            c.execute(
                "INSERT INTO resident_settings(agent_id,owner_id,controller,operator,model,beat,interests,cottage,trade_limit,inference_limit,pace,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    ident,
                    uid,
                    controller,
                    operator.address,
                    data["model"],
                    data["beat"],
                    data["interests"],
                    data["cottage"],
                    str(data["trade_limit"]),
                    str(data["inference_limit"]),
                    data["pace"],
                    store.now(),
                ),
            )
        platform.save_memory(ident, data.get("memory", ""))
    except BaseException:
        p.unlink(missing_ok=True)
        raise
    return mine_one(ident, uid)


def deployment(s: dict[str, Any]) -> dict[str, Any]:
    artifact = json.loads(
        (ROOT / "contracts/artifacts/MurmurResident.json").read_text()
    )
    args = [
        s["controller"],
        s["operator"],
        ROUTER,
        USDT,
        beneficiary(),
        int(Decimal(s["trade_limit"]) * 10**18),
        int(Decimal(s["inference_limit"]) * 10**18),
    ]
    return {
        "abi": artifact["abi"],
        "bytecode": artifact["bytecode"],
        "args": args,
        "data": web3()
        .eth.contract(abi=artifact["abi"], bytecode=artifact["bytecode"])
        .constructor(*args)
        .data_in_transaction,
        "beneficiary": beneficiary(),
    }


def mine_one(agent_id: str, uid: str) -> dict[str, Any]:
    s = owned(agent_id, uid)
    s.pop("owner_id")
    s["memory"] = platform.remember(agent_id)
    s["deployment"] = deployment(s) if not s["wallet"] else None
    s["history"] = store.rows(
        "SELECT kind,detail,created_at FROM activity WHERE agent_id=? ORDER BY id DESC LIMIT 30",
        (agent_id,),
    )
    s["memory_history"] = store.rows(
        "SELECT body,created_at FROM memory_history WHERE agent_id=? ORDER BY id DESC LIMIT 10",
        (agent_id,),
    )
    s["invoices"] = store.rows(
        "SELECT invoice,cost,status,reserve_tx,settle_tx,created_at FROM credit_invoices WHERE agent_id=? ORDER BY inference_id DESC LIMIT 20",
        (agent_id,),
    )
    cached = store.rows(
        "SELECT value FROM meta WHERE key=?", ("resident_balance_" + agent_id,)
    )
    s["funds"] = json.loads(cached[0]["value"]) if cached else None
    s["billing_recipient"] = beneficiary()
    return s


def attach(agent_id: str, uid: str, tx_hash: str) -> dict[str, Any]:
    s = owned(agent_id, uid)
    if s["wallet"]:
        raise HTTPException(409, "resident already has an account")
    w = web3()
    try:
        tx = w.eth.get_transaction(tx_hash)
        receipt = w.eth.get_transaction_receipt(tx_hash)
    except Exception:
        raise HTTPException(
            422, "deployment transaction is not confirmed on BNB"
        ) from None
    if (
        w.eth.chain_id != 56
        or tx["from"].lower() != s["controller"].lower()
        or tx.get("to")
        or receipt["status"] != 1
        or w.eth.block_number - receipt["blockNumber"] < 2
    ):
        raise HTTPException(
            422, "wait for three confirmations of your wallet deployment"
        )
    expected = deployment(s)
    if Web3.to_hex(tx["input"]).lower() != expected["data"].lower():
        raise HTTPException(
            422, "deployment does not match this resident and its spending caps"
        )
    wallet = receipt["contractAddress"]
    account = w.eth.contract(address=wallet, abi=expected["abi"])
    credit = account.functions.credit().call()
    if (
        account.functions.owner().call().lower() != s["controller"].lower()
        or account.functions.operator().call() != s["operator"]
    ):
        raise HTTPException(422, "account ownership mismatch")
    with store.connection() as c:
        c.execute(
            "UPDATE agents SET wallet=?,status=? WHERE id=?",
            (wallet, "paused", agent_id),
        )
        c.execute(
            "UPDATE resident_settings SET credit=? WHERE agent_id=?", (credit, agent_id)
        )
    platform.activity(agent_id, "paused", "owner account deployed")
    refresh_funds(agent_id)
    return mine_one(agent_id, uid)


def refresh_funds(agent_id: str) -> dict[str, Any] | None:
    rs = store.rows(
        "SELECT s.*,a.wallet FROM resident_settings s JOIN agents a ON a.id=s.agent_id WHERE s.agent_id=?",
        (agent_id,),
    )
    if not rs or not rs[0]["wallet"]:
        return None
    s = rs[0]
    w = web3()
    token = w.eth.contract(address=USDT, abi=ERC20_ABI)
    abi = json.loads((ROOT / "contracts/artifacts/InferenceCredit.json").read_text())[
        "abi"
    ]
    credit = w.eth.contract(address=s["credit"], abi=abi)
    account = w.eth.contract(
        address=s["wallet"],
        abi=json.loads((ROOT / "contracts/artifacts/AgentAccount.json").read_text())[
            "abi"
        ],
    )
    data = {
        "trading_bnb": w.eth.get_balance(s["wallet"]) / 1e18,
        "trading_usdt": token.functions.balanceOf(s["wallet"]).call() / 1e18,
        "operator_bnb": w.eth.get_balance(s["operator"]) / 1e18,
        "inference_usdt": token.functions.balanceOf(s["credit"]).call() / 1e18,
        "available_usdt": credit.functions.available().call() / 1e18,
        "reserved_usdt": credit.functions.reserved().call() / 1e18,
        "credit_paused": credit.functions.paused().call(),
        "trading_paused": account.functions.paused().call(),
        "trade_limit": account.functions.dailyLimit().call() / 1e18,
        "inference_limit": credit.functions.dailyLimit().call() / 1e18,
        "inference_daily_remaining": max(
            0,
            credit.functions.dailyLimit().call()
            - (
                credit.functions.spent().call()
                if credit.functions.day().call() == int(time.time()) // 86400
                else 0
            ),
        )
        / 1e18,
        "operator_valid": account.functions.operator().call() == s["operator"]
        and credit.functions.worker().call() == s["operator"],
        "checked_at": store.now(),
    }
    store.write(
        "INSERT OR REPLACE INTO meta VALUES(?,?)",
        ("resident_balance_" + agent_id, json.dumps(data)),
    )
    return data


def readiness(agent_id: str) -> bool:
    rs = store.rows(
        "SELECT s.*,a.wallet FROM resident_settings s JOIN agents a ON a.id=s.agent_id WHERE s.agent_id=?",
        (agent_id,),
    )
    if not rs:
        return True
    s = rs[0]
    if s["paused"]:
        platform.activity(agent_id, "paused")
        return False
    if not s["wallet"]:
        platform.activity(agent_id, "awaiting deployment")
        return False
    pending = store.rows(
        "SELECT inference_id FROM credit_invoices WHERE agent_id=? AND status NOT IN ('settled','released')",
        (agent_id,),
    )
    if pending:
        platform.activity(agent_id, "settling invoice")
        return False
    funds = refresh_funds(agent_id)
    if not funds or not funds["operator_valid"] or funds["credit_paused"]:
        platform.activity(agent_id, "paused")
        return False
    if funds["available_usdt"] < 0.05:
        platform.activity(agent_id, "waiting for credit")
        return False
    if funds["inference_daily_remaining"] < 0.05:
        platform.activity(agent_id, "waiting for budget", "owner inference cap reached")
        return False
    if funds["operator_bnb"] < 0.00002:
        platform.activity(agent_id, "waiting for gas")
        return False
    return True


def _send(agent_id: str, fn: Any, invoice_id: int, column: str) -> str:
    with operator_lock(agent_id):
        return _send_unlocked(agent_id, fn, invoice_id, column)


def _send_unlocked(agent_id: str, fn: Any, invoice_id: int, column: str) -> str:
    key = operator_key(agent_id)
    if not key:
        raise RuntimeError("operator unavailable")
    w = web3()
    op = Account.from_key(key)
    if w.eth.chain_id != 56:
        raise RuntimeError("chain mismatch")
    tx = fn.build_transaction(
        {
            "from": op.address,
            "nonce": w.eth.get_transaction_count(op.address, "pending"),
            "gasPrice": w.eth.gas_price,
            "chainId": 56,
        }
    )
    signed = op.sign_transaction(tx)
    h = Web3.to_hex(Web3.keccak(signed.raw_transaction))
    store.write(
        f"UPDATE credit_invoices SET {column}=? WHERE inference_id=?", (h, invoice_id)
    )
    w.eth.send_raw_transaction(signed.raw_transaction)
    r = w.eth.wait_for_transaction_receipt(h, timeout=90)
    if r.status != 1:
        raise RuntimeError("invoice transaction reverted")
    return h


def reserve_credit(agent_id: str, inference_id: int) -> bool:
    s = store.rows("SELECT * FROM resident_settings WHERE agent_id=?", (agent_id,))
    if not s:
        return True
    invoice = Web3.to_hex(Web3.keccak(text=f"murmur:56:{agent_id}:{inference_id}"))
    store.write(
        "INSERT INTO credit_invoices(inference_id,agent_id,invoice,cost,status,created_at) VALUES(?,?,?,?,?,?)",
        (inference_id, agent_id, invoice, "0", "reserving", store.now()),
    )
    credit = web3().eth.contract(
        address=s[0]["credit"],
        abi=json.loads((ROOT / "contracts/artifacts/InferenceCredit.json").read_text())[
            "abi"
        ],
    )
    try:
        _send(
            agent_id,
            credit.functions.reserve(invoice, 5 * 10**16),
            inference_id,
            "reserve_tx",
        )
    except Exception:
        pending = store.rows(
            "SELECT reserve_tx FROM credit_invoices WHERE inference_id=?",
            (inference_id,),
        )[0]
        if not pending["reserve_tx"]:
            store.write(
                "UPDATE credit_invoices SET status='released' WHERE inference_id=?",
                (inference_id,),
            )
            store.write(
                "UPDATE inference SET status='credit failed',cost=0 WHERE id=?",
                (inference_id,),
            )
        raise
    store.write(
        "UPDATE credit_invoices SET status=? WHERE inference_id=?",
        ("reserved", inference_id),
    )
    return True


def settle_credit(agent_id: str, inference_id: int, cost: float) -> None:
    with operator_lock(agent_id):
        _settle_credit(agent_id, inference_id, cost)


def _settle_credit(agent_id: str, inference_id: int, cost: float) -> None:
    invoices = store.rows(
        "SELECT * FROM credit_invoices WHERE inference_id=?", (inference_id,)
    )
    if not invoices:
        return
    amount = int(Decimal(str(cost)) * 10**18)
    if not 0 <= amount <= 5 * 10**16:
        raise RuntimeError("invoice exceeds reservation")
    store.write(
        "UPDATE credit_invoices SET cost=?,status=? WHERE inference_id=?",
        (str(amount), "settling", inference_id),
    )
    s = store.rows(
        "SELECT credit FROM resident_settings WHERE agent_id=?", (agent_id,)
    )[0]
    credit = web3().eth.contract(
        address=s["credit"],
        abi=json.loads((ROOT / "contracts/artifacts/InferenceCredit.json").read_text())[
            "abi"
        ],
    )
    if credit.functions.invoices(invoices[0]["invoice"]).call()[2]:
        store.write(
            "UPDATE credit_invoices SET status='settled' WHERE inference_id=?",
            (inference_id,),
        )
        return
    _send(
        agent_id,
        credit.functions.settle(invoices[0]["invoice"], amount),
        inference_id,
        "settle_tx",
    )
    store.write(
        "UPDATE credit_invoices SET status=? WHERE inference_id=?",
        ("settled", inference_id),
    )


def recover_invoices() -> None:
    w = web3()
    for i in store.rows(
        "SELECT i.*,s.credit FROM credit_invoices i JOIN resident_settings s ON s.agent_id=i.agent_id WHERE i.status NOT IN ('settled','released') ORDER BY inference_id LIMIT 12"
    ):
        c = w.eth.contract(
            address=i["credit"],
            abi=json.loads(
                (ROOT / "contracts/artifacts/InferenceCredit.json").read_text()
            )["abi"],
        )
        amount, opened, settled = c.functions.invoices(i["invoice"]).call()
        if settled:
            store.write(
                "UPDATE credit_invoices SET status=? WHERE inference_id=?",
                ("settled" if i["settle_tx"] else "released", i["inference_id"]),
            )
            continue
        inference = store.rows(
            "SELECT * FROM inference WHERE id=?", (i["inference_id"],)
        )
        if opened and inference and inference[0]["status"] == "complete":
            if i["settle_tx"]:
                try:
                    receipt = w.eth.get_transaction_receipt(i["settle_tx"])
                    if receipt.status != 1:
                        store.write(
                            "UPDATE credit_invoices SET settle_tx=NULL WHERE inference_id=?",
                            (i["inference_id"],),
                        )
                except Exception:
                    continue
            settle_credit(i["agent_id"], i["inference_id"], inference[0]["cost"])
        elif (
            opened
            and inference
            and inference[0]["status"] == "reserved"
            and time.time()
            - __import__("datetime")
            .datetime.fromisoformat(inference[0]["created_at"])
            .timestamp()
            > 600
        ):
            # A restart before the provider request leaves credit reserved. Record
            # the ambiguity instead of issuing a duplicate request or payment.
            store.write(
                "UPDATE inference SET status='uncertain' WHERE id=?",
                (i["inference_id"],),
            )
        elif not opened and i["reserve_tx"]:
            try:
                r = w.eth.get_transaction_receipt(i["reserve_tx"])
            except Exception:
                continue
            if r.status != 1:
                store.write(
                    "UPDATE credit_invoices SET status=? WHERE inference_id=?",
                    ("released", i["inference_id"]),
                )
                store.write(
                    "UPDATE inference SET cost=0,status='credit failed' WHERE id=?",
                    (i["inference_id"],),
                )
