"""Read-only health factor for Venus Core Pool positions on BNB Chain, plus watched positions.

Health factor = collateral weighted by each market's collateral factor / debt. Venus reports the
weighted surplus or shortfall through Comptroller.getAccountLiquidity, so the weighted collateral is
debt + liquidity - shortfall. Debt includes VAI minted against the account. Below 1.0 the account can
be liquidated."""

import time
from typing import Any

from fastapi import HTTPException
from web3 import Web3

from . import store
from .chain import web3

COMPTROLLER = Web3.to_checksum_address("0xfD36E2c2a6789Db23113685031d7F16329158384")
ALERT = 1.2
_COMPTROLLER_ABI = [
    {
        "name": "getAccountLiquidity",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}] * 3,
    },
    {
        "name": "getAssetsIn",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "address[]"}],
    },
    {
        "name": "oracle",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "address"}],
    },
    {
        "name": "mintedVAIs",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    },
]
_VTOKEN_ABI = [
    {
        "name": "getAccountSnapshot",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}] * 4,
    },
    {
        "name": "symbol",
        "type": "function",
        "stateMutability": "view",
        "inputs": [],
        "outputs": [{"type": "string"}],
    },
]
_ORACLE_ABI = [
    {
        "name": "getUnderlyingPrice",
        "type": "function",
        "stateMutability": "view",
        "inputs": [{"type": "address"}],
        "outputs": [{"type": "uint256"}],
    }
]
_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_symbols: dict[str, str] = {}


def _address(raw: str) -> str:
    if not Web3.is_address(raw or ""):
        raise HTTPException(422, "not a BNB Chain address")
    return Web3.to_checksum_address(raw)


def position(raw: str) -> dict[str, Any]:
    account = _address(raw)
    hit = _cache.get(account)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    w = web3()
    c = w.eth.contract(address=COMPTROLLER, abi=_COMPTROLLER_ABI)
    oracle = w.eth.contract(address=c.functions.oracle().call(), abi=_ORACLE_ABI)
    err, liquidity, shortfall = c.functions.getAccountLiquidity(account).call()
    if err:
        raise HTTPException(502, "Venus returned an error for this account")
    vai = c.functions.mintedVAIs(account).call() / 1e18
    markets, supplied, borrowed = [], 0.0, 0.0
    for m in c.functions.getAssetsIn(account).call():
        v = w.eth.contract(address=m, abi=_VTOKEN_ABI)
        _, balance, debt, rate = v.functions.getAccountSnapshot(account).call()
        if not balance and not debt:
            continue
        price = oracle.functions.getUnderlyingPrice(m).call()
        if m not in _symbols:
            _symbols[m] = v.functions.symbol().call()
        s, b = balance * rate / 1e18 * price / 1e36, debt * price / 1e36
        supplied, borrowed = supplied + s, borrowed + b
        if s < 1 and b < 1:
            continue
        markets.append(
            {
                "market": _symbols[m],
                "address": m,
                "supplied_usd": round(s, 2),
                "borrowed_usd": round(b, 2),
            }
        )
    debt = borrowed + vai
    weighted = debt + liquidity / 1e18 - shortfall / 1e18
    factor = round(weighted / debt, 4) if debt > 0.01 else None
    out = {
        "account": account,
        "protocol": "Venus Core Pool",
        "comptroller": COMPTROLLER,
        "health_factor": factor,
        "state": "no debt"
        if factor is None
        else "liquidatable"
        if factor < 1
        else "at risk"
        if factor < ALERT
        else "healthy",
        "supplied_usd": round(supplied, 2),
        "borrowed_usd": round(borrowed, 2),
        "vai_debt": round(vai, 2),
        "borrow_limit_usd": round(weighted, 2),
        "liquidity_usd": round(liquidity / 1e18, 2),
        "shortfall_usd": round(shortfall / 1e18, 2),
        "markets": sorted(
            markets, key=lambda x: -(x["supplied_usd"] + x["borrowed_usd"])
        ),
        "block": w.eth.block_number,
        "read_at": store.now(),
        "source": f"https://bscscan.com/address/{COMPTROLLER}#readProxyContract",
    }
    _cache[account] = (time.time(), out)
    return out


def watch(uid: str, raw: str, threshold: float) -> dict[str, Any]:
    account = _address(raw)
    if not 1.0 < threshold <= 3.0:
        raise HTTPException(422, "threshold must be above 1.0 and at most 3.0")
    if (
        store.rows("SELECT COUNT(*) n FROM lending_watches WHERE user_id=?", (uid,))[0][
            "n"
        ]
        >= 10
    ):
        raise HTTPException(429, "watch up to 10 positions")
    store.write(
        "INSERT INTO lending_watches(user_id,account,threshold,created_at) VALUES(?,?,?,?) "
        "ON CONFLICT(user_id,account) DO UPDATE SET threshold=excluded.threshold",
        (uid, account, threshold, store.now()),
    )
    return {"account": account, "threshold": threshold}


def unwatch(uid: str, raw: str) -> dict[str, Any]:
    store.write(
        "DELETE FROM lending_watches WHERE user_id=? AND account=?",
        (uid, _address(raw)),
    )
    return {"ok": True}


def mine(uid: str) -> list[dict[str, Any]]:
    return store.rows(
        "SELECT account,threshold,last_factor,last_state,last_checked,alerted_at FROM lending_watches WHERE user_id=? ORDER BY created_at DESC",
        (uid,),
    )


def notify(uid: str, text: str) -> None:
    from .tokens import telegram

    for chat in store.rows(
        "SELECT chat_id FROM telegram_links WHERE user_id=? AND chat_id IS NOT NULL",
        (uid,),
    ):
        telegram(chat["chat_id"], text)


_last = {"at": 0.0}


def check() -> int:
    """Every ten minutes, refresh each watched position; alert once when one drops below its threshold."""
    if time.time() - _last["at"] < 600:
        return 0
    _last["at"] = time.time()
    sent = 0
    for row in store.rows("SELECT DISTINCT account FROM lending_watches"):
        try:
            p = position(row["account"])
        except Exception:
            continue
        f = p["health_factor"]
        for wr in store.rows(
            "SELECT * FROM lending_watches WHERE account=?", (row["account"],)
        ):
            below = f is not None and f < wr["threshold"]
            if below and not wr["alerted_at"]:
                notify(
                    wr["user_id"],
                    f"rook: Venus health factor for {p['account'][:6]}…{p['account'][-4:]} is {f:.3f}, below your {wr['threshold']:.2f} alert. "
                    f"debt ${p['borrowed_usd'] + p['vai_debt']:,.0f}, borrow limit ${p['borrow_limit_usd']:,.0f}. "
                    f"https://murmuragents.io/#lending/{p['account']}",
                )
                sent += 1
            store.write(
                "UPDATE lending_watches SET last_factor=?,last_state=?,last_checked=?,alerted_at=? WHERE id=?",
                (
                    f,
                    p["state"],
                    store.now(),
                    (wr["alerted_at"] or store.now()) if below else None,
                    wr["id"],
                ),
            )
    return sent
