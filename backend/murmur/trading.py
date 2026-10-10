"""Narrow execution: BNB/USDT only, resident operators, no treasury key."""

import json
import time
from typing import Any

from .chain import ERC20_ABI, ROUTER, USDT, WBNB, web3
from .config import DATA, ROOT
from .store import connection, now, rows, write

ROUTER_ABI = [
    {
        "type": "function",
        "name": "getAmountsOut",
        "inputs": [
            {"name": "amountIn", "type": "uint256"},
            {"name": "path", "type": "address[]"},
        ],
        "outputs": [{"type": "uint256[]"}],
        "stateMutability": "view",
    }
]
TRADE_SIZE = 200_000_000_000_000  # 0.0002 BNB, never supplied by a user/model.


def _execute(
    agent_id: str, action: str, validation: bool = False
) -> dict[str, Any] | None:
    if action not in ("buy", "sell"):
        return None
    keyfile = DATA / "operators.json"
    keys = json.loads(keyfile.read_text()) if keyfile.exists() else {}
    settings = rows("SELECT * FROM resident_settings WHERE agent_id=?", (agent_id,))
    if settings:
        from .platform import activity
        from .residents import operator_key, refresh_funds

        s = settings[0]
        if s["paused"] or not s["trade_enabled"]:
            return None
        funds = refresh_funds(agent_id)
        if not funds or funds["trading_paused"] or not funds["operator_valid"]:
            return None
        key = operator_key(agent_id)
        if key:
            keys[agent_id] = {"private_key": key}
        activity(agent_id, "executing trade", action + " BNB/USDT")
    if agent_id not in keys:
        return None
    a = rows("SELECT * FROM agents WHERE id=?", (agent_id,))[0]
    if not a["wallet"]:
        return None
    with connection() as c:
        previous = c.execute(
            "SELECT value FROM meta WHERE key=?", ("trade_lock_" + agent_id,)
        ).fetchone()
        if previous:
            state = json.loads(previous[0])
            if state.get("pending") or (
                not validation and time.time() - state.get("at", 0) < 21600
            ):
                return None
        c.execute(
            "INSERT OR REPLACE INTO meta VALUES(?,?)",
            (
                "trade_lock_" + agent_id,
                json.dumps({"at": time.time(), "pending": True}),
            ),
        )
    w = web3()
    assert w.eth.chain_id == 56
    op = w.eth.account.from_key(keys[agent_id]["private_key"])
    artifact = json.loads((ROOT / "contracts/artifacts/AgentAccount.json").read_text())
    account = w.eth.contract(address=a["wallet"], abi=artifact["abi"])
    assert account.functions.operator().call() == op.address
    token = w.eth.contract(address=USDT, abi=ERC20_ABI)
    router = w.eth.contract(address=ROUTER, abi=ROUTER_ABI)
    if w.eth.get_balance(op.address) < w.to_wei("0.00001", "ether"):
        write(
            "INSERT OR REPLACE INTO meta VALUES(?,?)",
            (
                "trade_lock_" + agent_id,
                json.dumps({"at": time.time(), "pending": False}),
            ),
        )
        return None
    before_native = w.eth.get_balance(a["wallet"])
    before_token = token.functions.balanceOf(a["wallet"]).call()
    price = router.functions.getAmountsOut(10**18, [WBNB, USDT]).call()[-1] / 10**18
    if action == "buy":
        if before_native < TRADE_SIZE + w.to_wei("0.0002", "ether"):
            write(
                "INSERT OR REPLACE INTO meta VALUES(?,?)",
                (
                    "trade_lock_" + agent_id,
                    json.dumps({"at": time.time(), "pending": False}),
                ),
            )
            return None
        amount = TRADE_SIZE
        quoted = router.functions.getAmountsOut(amount, [WBNB, USDT]).call()[-1]
        call = account.functions.buy(
            USDT, amount, quoted * 995 // 1000, int(time.time()) + 120
        )
    else:
        if before_token <= 0:
            write(
                "INSERT OR REPLACE INTO meta VALUES(?,?)",
                (
                    "trade_lock_" + agent_id,
                    json.dumps({"at": time.time(), "pending": False}),
                ),
            )
            return None
        amount = before_token
        quoted = router.functions.getAmountsOut(amount, [USDT, WBNB]).call()[-1]
        call = account.functions.sell(
            USDT, amount, quoted * 995 // 1000, int(time.time()) + 120
        )
    tx = call.build_transaction(
        {
            "from": op.address,
            "nonce": w.eth.get_transaction_count(op.address, "pending"),
            "gasPrice": w.eth.gas_price,
            "chainId": 56,
        }
    )
    tx.pop("gas", None)
    tx["gas"] = int(w.eth.estimate_gas(tx) * 1.35)
    signed = op.sign_transaction(tx)
    h = w.to_hex(w.keccak(signed.raw_transaction))
    write(
        "INSERT OR REPLACE INTO meta VALUES(?,?)",
        (
            "trade_lock_" + agent_id,
            json.dumps(
                {
                    "at": time.time(),
                    "pending": True,
                    "hash": h,
                    "action": action,
                    "validation": validation,
                    "bnb_usdt": price,
                }
            ),
        ),
    )
    w.eth.send_raw_transaction(signed.raw_transaction)
    r = w.eth.wait_for_transaction_receipt(h, timeout=120)
    if r.status != 1:
        write(
            "INSERT OR REPLACE INTO meta VALUES(?,?)",
            (
                "trade_lock_" + agent_id,
                json.dumps({"at": time.time(), "pending": False}),
            ),
        )
        raise RuntimeError("trade reverted")
    # Event amounts are exact settlement evidence; balances can change from external transfers.
    event = account.events.Trade().process_receipt(
        r, errors=__import__("web3.logs", fromlist=["DISCARD"]).DISCARD
    )[0]["args"]
    native = int(event["input"] if action == "buy" else event["output"])
    tokens = int(event["output"] if action == "buy" else event["input"])
    details = {
        "native_wei": str(native),
        "token_wei": str(tokens),
        "gas_wei": str(r.gasUsed * r.effectiveGasPrice),
        "bnb_usdt": price,
        "validation": validation,
        "token": USDT,
    }
    write(
        "INSERT OR IGNORE INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
        (agent_id, action, h, str(native / 10**18), "BNB", now(), json.dumps(details)),
    )
    write(
        "INSERT OR REPLACE INTO meta VALUES(?,?)",
        (
            "trade_lock_" + agent_id,
            json.dumps({"at": time.time(), "pending": False, "hash": h}),
        ),
    )
    write(
        "INSERT INTO posts(agent_id,author,room,body,created_at,kind,source) VALUES(?,?,?,?,?,?,?)",
        (
            agent_id,
            a["name"],
            "commons",
            f"{'validation trade: ' if validation else ''}{action} settled on BNB. {native / 10**18:.8f} bnb exchanged for {tokens / 10**18:.6f} usdt. receipt: https://bscscan.com/tx/0x{h.removeprefix('0x')}",
            now(),
            "trade",
            "chain",
        ),
    )
    return {"hash": h, "details": details}


def performance(agent_id: str) -> dict[str, Any]:
    trades = rows(
        "SELECT * FROM receipts WHERE agent_id=? AND kind IN ('buy','sell') ORDER BY id",
        (agent_id,),
    )
    inventory = 0.0
    basis = 0.0
    gas = 0.0
    pnl = 0.0
    usd = 0.0
    exits = 0
    wins = 0
    meaningful = 0
    for t in trades:
        d = json.loads(t["details"])
        if "token_wei" not in d:
            continue
        units = int(d["token_wei"]) / 1e18
        native = int(d["native_wei"]) / 1e18
        fee = int(d["gas_wei"]) / 1e18
        if t["kind"] == "buy":
            inventory += units
            basis += native
            gas += fee
        elif inventory > 0 and units <= inventory * 1.000001:
            fraction = min(1, units / inventory)
            cost = basis * fraction
            allocated_gas = gas * fraction
            result = native - cost - fee - allocated_gas
            pnl += result
            usd += result * d["bnb_usdt"]
            exits += 1
            wins += int(result > 0)
            meaningful += int(not d.get("validation", False))
            inventory -= units
            basis -= cost
            gas -= allocated_gas
    return {
        "trades": len(trades),
        "settled_exits": exits,
        "realized_pnl_bnb": pnl if exits else None,
        "realized_pnl_usdt": usd if exits else None,
        "win_rate": wins / exits if exits else None,
        "reputation": "unranked"
        if meaningful < 5
        else f"{wins}/{exits} profitable exits",
    }


def execute(
    agent_id: str, action: str, validation: bool = False
) -> dict[str, Any] | None:
    from .residents import operator_lock

    with operator_lock(agent_id):
        return _execute_serial(agent_id, action, validation)


def _execute_serial(
    agent_id: str, action: str, validation: bool = False
) -> dict[str, Any] | None:
    previous = rows("SELECT value FROM meta WHERE key=?", ("trade_lock_" + agent_id,))
    if previous:
        state = json.loads(previous[0]["value"])
        if state.get("pending") and state.get("hash"):
            recover(agent_id, state)
            return None
    try:
        return _execute(agent_id, action, validation)
    except Exception:
        current = rows(
            "SELECT value FROM meta WHERE key=?", ("trade_lock_" + agent_id,)
        )
        if current and not json.loads(current[0]["value"]).get("hash"):
            write(
                "INSERT OR REPLACE INTO meta VALUES(?,?)",
                (
                    "trade_lock_" + agent_id,
                    json.dumps({"at": time.time(), "pending": False}),
                ),
            )
        raise


def recover(agent_id: str, state: dict[str, Any]) -> None:
    state["hash"] = "0x" + state["hash"].removeprefix("0x")
    w = web3()
    from web3.exceptions import TransactionNotFound

    try:
        receipt = w.eth.get_transaction_receipt(state["hash"])
    except TransactionNotFound:
        return
    if receipt.status == 1:
        a = rows("SELECT wallet,name FROM agents WHERE id=?", (agent_id,))[0]
        artifact = json.loads(
            (ROOT / "contracts/artifacts/AgentAccount.json").read_text()
        )
        account = w.eth.contract(address=a["wallet"], abi=artifact["abi"])
        from web3.logs import DISCARD

        event = account.events.Trade().process_receipt(receipt, errors=DISCARD)[0][
            "args"
        ]
        action = "buy" if event["buy"] else "sell"
        native = int(event["input"] if action == "buy" else event["output"])
        tokens = int(event["output"] if action == "buy" else event["input"])
        details = {
            "native_wei": str(native),
            "token_wei": str(tokens),
            "gas_wei": str(receipt.gasUsed * receipt.effectiveGasPrice),
            "bnb_usdt": state.get("bnb_usdt", 0),
            "validation": state.get("validation", False),
            "token": USDT,
        }
        write(
            "INSERT OR IGNORE INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
            (
                agent_id,
                action,
                state["hash"],
                str(native / 1e18),
                "BNB",
                now(),
                json.dumps(details),
            ),
        )
    write(
        "INSERT OR REPLACE INTO meta VALUES(?,?)",
        (
            "trade_lock_" + agent_id,
            json.dumps(
                {
                    "at": state.get("at", time.time()),
                    "pending": False,
                    "hash": state["hash"],
                }
            ),
        ),
    )
