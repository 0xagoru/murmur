"""Confirmed launchpad history. RPC failures preserve the last observed data."""

import json
import os
import time
from decimal import Decimal
from typing import Any

import httpx
from hexbytes import HexBytes
from web3 import Web3

from . import store
from .chain import manifest, web3
from .config import ROOT

_last = 0.0
HISTORY_RPC = os.getenv("BNB_HISTORY_RPC", "https://rpc-bsc.48.club")
HISTORY_RANGE = max(1, min(int(os.getenv("BNB_HISTORY_RANGE", "5000")), 5000))
TOKEN_ABI = [
    {
        "type": "function",
        "name": n,
        "inputs": [],
        "outputs": [{"type": "string"}],
        "stateMutability": "view",
    }
    for n in ("name", "symbol")
]
TRANSFER = {
    "anonymous": False,
    "type": "event",
    "name": "Transfer",
    "inputs": [
        {"indexed": True, "name": "from", "type": "address"},
        {"indexed": True, "name": "to", "type": "address"},
        {"indexed": False, "name": "value", "type": "uint256"},
    ],
}


def sync() -> None:
    global _last
    if time.time() - _last < 90:
        return
    _last = time.time()
    w = web3()
    m = manifest()
    address = m.get("contracts", {}).get("launchpad")
    if not address:
        return
    abi = json.loads((ROOT / "contracts/artifacts/MurmurLaunchpad.json").read_text())[
        "abi"
    ]
    pad = w.eth.contract(address=address, abi=abi)
    if w.eth.chain_id != 56:
        raise RuntimeError("chain mismatch")
    tip = w.eth.block_number - 12
    # Discover coins directly; event logs then provide exact launch time and history.
    count = pad.functions.count().call()
    for index in range(min(count, 200)):
        a = pad.functions.coins(index).call()
        token = w.eth.contract(address=a, abi=TOKEN_ABI)
        sold, reserve, creator = pad.functions.markets(a).call()
        old = store.rows("SELECT address FROM coins WHERE address=?", (a,))
        if not old:
            store.write(
                "INSERT INTO coins(address,name,symbol,creator,sold,reserve) VALUES(?,?,?,?,?,?)",
                (
                    a,
                    token.functions.name().call(),
                    token.functions.symbol().call(),
                    creator,
                    str(sold),
                    str(reserve),
                ),
            )
        else:
            store.write(
                "UPDATE coins SET sold=?,reserve=? WHERE address=?",
                (str(sold), str(reserve), a),
            )
    cursor = store.rows("SELECT value FROM meta WHERE key='coin_cursor'")
    if cursor:
        start = int(cursor[0]["value"]) + 1
    else:
        # Deployment manifests retain transaction receipts/hashes, no secret material.
        entries = m.get("transactions", [])
        deployment = None
        for t in entries if isinstance(entries, list) else entries.values():
            if isinstance(t, dict) and t.get("kind") == "deployment" and t.get("hash"):
                receipt = w.eth.get_transaction_receipt(
                    "0x" + t["hash"].removeprefix("0x")
                )
                if (receipt.get("contractAddress") or "").lower() == address.lower():
                    deployment = receipt["blockNumber"]
                    break
            if isinstance(t, dict) and (
                t.get("name") == "launchpad" or t.get("contract") == "launchpad"
            ):
                deployment = t.get("blockNumber") or t.get("block_number")
                if not deployment and (t.get("hash") or t.get("tx_hash")):
                    deployment = w.eth.get_transaction_receipt(
                        t.get("hash") or t.get("tx_hash")
                    )["blockNumber"]
        if not deployment:
            # Binary search contract existence to find its actual creation block.
            lo, hi = 0, tip
            while lo < hi:
                mid = (lo + hi) // 2
                if w.eth.get_code(address, mid):
                    hi = mid
                else:
                    lo = mid + 1
            deployment = lo
        start = int(deployment)
    stop = min(tip, start + HISTORY_RANGE * 10 - 1)
    if stop < start:
        return
    timestamps: dict[int, str] = {}

    def stamp(block: int) -> str:
        from datetime import datetime, timezone

        if block not in timestamps:
            timestamps[block] = datetime.fromtimestamp(
                w.eth.get_block(block)["timestamp"], timezone.utc
            ).isoformat()
        return timestamps[block]

    tokens = store.rows("SELECT address FROM coins")
    addresses = [address] + [t["address"] for t in tokens]
    # History RPC ranges are bounded and batched. Advance
    # only when EVERY range succeeded; partial responses never become zero data.
    queries = [
        {
            "jsonrpc": "2.0",
            "id": i,
            "method": "eth_getLogs",
            "params": [
                {
                    "address": addresses,
                    "fromBlock": hex(b),
                    "toBlock": hex(min(b + HISTORY_RANGE - 1, stop)),
                }
            ],
        }
        for i, b in enumerate(range(start, stop + 1, HISTORY_RANGE))
    ]

    def fetch(
        client: httpx.Client, batch: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        for attempt in range(4):
            try:
                r = client.post(HISTORY_RPC, json=batch)
                r.raise_for_status()
                data = r.json()
                if not isinstance(data, list) or {x.get("id") for x in data} != {
                    q["id"] for q in batch
                }:
                    raise RuntimeError("incomplete history response")
                errors = [x["error"] for x in data if "error" in x]
                if errors:
                    raise RuntimeError(
                        "history RPC: "
                        + str(errors[0].get("code"))
                        + " "
                        + str(errors[0].get("message"))[:120]
                    )
                if any(not isinstance(x.get("result"), list) for x in data):
                    raise RuntimeError("incomplete history response")
                return [e for x in data for e in x["result"]]
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(2**attempt)
        return []

    batches = [queries[i : i + 10] for i in range(0, len(queries), 10)]
    with httpx.Client(timeout=25) as client:
        chain = client.post(
            HISTORY_RPC,
            json={"jsonrpc": "2.0", "id": -1, "method": "eth_chainId", "params": []},
        ).json()
        if int(chain.get("result", "0"), 16) != 56:
            raise RuntimeError("history RPC chain mismatch")
        raw = [e for batch in batches for e in fetch(client, batch)]
    launches = []
    trades = []
    transfers = []
    events = {
        Web3.to_hex(Web3.keccak(text=signature)): name
        for signature, name in [
            ("Launched(address,address,string,string)", "launch"),
            ("Exchanged(address,address,bool,uint256,uint256)", "trade"),
            ("Transfer(address,address,uint256)", "transfer"),
        ]
    }
    for e in raw:
        kind = events.get(e["topics"][0]) if e.get("topics") else None
        if not kind:
            continue
        if kind in ("launch", "trade") and e["address"].lower() != address.lower():
            continue
        log = {
            **e,
            "address": Web3.to_checksum_address(e["address"]),
            "topics": [HexBytes(t) for t in e["topics"]],
            "data": HexBytes(e["data"]),
            "transactionHash": HexBytes(e["transactionHash"]),
            "blockHash": HexBytes(e["blockHash"]),
        }
        for field in ("blockNumber", "transactionIndex", "logIndex"):
            log[field] = int(e[field], 16)
        block = w.eth.get_block(log["blockNumber"])
        if block["hash"] != log["blockHash"]:
            raise RuntimeError("history block differs from BNB RPC")
        if kind == "launch":
            launches.append(pad.events.Launched().process_log(log))
        elif kind == "trade":
            trades.append(pad.events.Exchanged().process_log(log))
        else:
            transfers.append(
                w.eth.contract(
                    address=Web3.to_checksum_address(e["address"]), abi=[TRANSFER]
                )
                .events.Transfer()
                .process_log(log)
            )
    with store.connection() as c:
        for e in launches:
            a = e["args"]
            c.execute(
                "UPDATE coins SET created_at=?,launch_tx=?,launch_block=? WHERE address=?",
                (
                    stamp(e["blockNumber"]),
                    Web3.to_hex(e["transactionHash"]),
                    e["blockNumber"],
                    a["token"],
                ),
            )
            resident = c.execute(
                "SELECT id FROM agents WHERE lower(wallet)=lower(?)", (a["creator"],)
            ).fetchone()
            if (
                resident
                and not c.execute(
                    "SELECT id FROM activity WHERE agent_id=? AND kind='launched coin' AND detail=?",
                    (resident["id"], a["symbol"]),
                ).fetchone()
            ):
                c.execute(
                    "INSERT INTO activity(agent_id,kind,detail,created_at) VALUES(?,?,?,?)",
                    (
                        resident["id"],
                        "launched coin",
                        a["symbol"],
                        stamp(e["blockNumber"]),
                    ),
                )
        for e in trades:
            a = e["args"]
            c.execute(
                "INSERT OR IGNORE INTO coin_trades(token,trader,buy,tokens,native,tx_hash,log_index,block_number,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (
                    a["token"],
                    a["trader"],
                    int(a["buy"]),
                    str(a["tokens"]),
                    str(a["nativeAmount"]),
                    Web3.to_hex(e["transactionHash"]),
                    e["logIndex"],
                    e["blockNumber"],
                    stamp(e["blockNumber"]),
                ),
            )
        for e in transfers:
            a = e["args"]
            c.execute(
                "INSERT OR IGNORE INTO coin_transfers(token,sender,recipient,amount,tx_hash,log_index,block_number) VALUES(?,?,?,?,?,?,?)",
                (
                    e["address"],
                    a["from"],
                    a["to"],
                    str(a["value"]),
                    Web3.to_hex(e["transactionHash"]),
                    e["logIndex"],
                    e["blockNumber"],
                ),
            )
        c.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", ("coin_cursor", str(stop)))
        c.execute(
            "UPDATE coins SET synced_at=?,synced_block=?,error=?",
            (store.now(), stop, "" if stop >= tip else "history syncing"),
        )


def listing() -> list[dict[str, Any]]:
    pad = manifest().get("contracts", {}).get("launchpad", "")
    result = []
    for coin in store.rows("SELECT * FROM coins ORDER BY launch_block DESC,address"):
        sold = Decimal(coin["sold"] or 0) / 10**18
        reserve = Decimal(coin["reserve"] or 0) / 10**18
        coin.update(
            reserve_bnb=float(reserve),
            sold_tokens=float(sold),
            supply=1_000_000_000,
            creator_allocation=200_000_000,
            curve_inventory=float(800_000_000 - sold),
            price_bnb=float((1 + reserve) / (800_000_000 - sold)),
            launchpad=pad,
        )
        a = store.rows(
            "SELECT id,name FROM agents WHERE lower(wallet)=lower(?)",
            (coin["creator"],),
        )
        coin["resident"] = a[0] if a else None
        if not a:
            for receipt in store.rows(
                "SELECT r.agent_id,a.name,r.details FROM receipts r JOIN agents a ON a.id=r.agent_id WHERE r.kind='coin_launch'"
            ):
                if (
                    json.loads(receipt["details"] or "{}").get("token", "").lower()
                    == coin["address"].lower()
                ):
                    coin["resident"] = {
                        "id": receipt["agent_id"],
                        "name": receipt["name"],
                    }
                    break
        coin["discussions"] = store.rows(
            "SELECT count(*) n FROM posts WHERE lower(token)=lower(?) AND parent_id IS NULL",
            (coin["address"],),
        )[0]["n"]
        result.append(coin)
    return result


def detail(address: str) -> dict[str, Any] | None:
    coin = next((c for c in listing() if c["address"].lower() == address.lower()), None)
    if not coin:
        return None
    trades = store.rows(
        "SELECT * FROM coin_trades WHERE token=? ORDER BY block_number DESC,log_index DESC LIMIT 200",
        (coin["address"],),
    )
    for t in trades:
        t.update(
            tokens=float(Decimal(t["tokens"]) / 10**18),
            native=float(Decimal(t["native"]) / 10**18),
        )
    chart = []
    for t in reversed(trades):
        if t["tokens"] > 0:
            chart.append(
                {
                    "time": t["created_at"],
                    "price_bnb": t["native"] / t["tokens"],
                    "tx_hash": t["tx_hash"],
                }
            )
    holders: dict[str, int] = {}
    for t in store.rows(
        "SELECT * FROM coin_transfers WHERE lower(token)=lower(?) ORDER BY block_number,log_index",
        (coin["address"],),
    ):
        holders[t["sender"]] = holders.get(t["sender"], 0) - int(t["amount"])
        holders[t["recipient"]] = holders.get(t["recipient"], 0) + int(t["amount"])
    excluded = {coin["launchpad"].lower(), "0x" + "0" * 40}
    actual = [
        {"address": a, "tokens": v / 1e18, "supply_pct": v / 1e27 * 100}
        for a, v in holders.items()
        if v > 0 and a.lower() not in excluded
    ]
    actual.sort(key=lambda h: h["tokens"], reverse=True)
    coin.update(
        trades=trades,
        chart=chart,
        holders=actual[:50],
        holder_count=len(actual),
        holders_complete=bool(coin["launch_block"]) and not coin["error"],
        top_10_supply_pct=sum(h["supply_pct"] for h in actual[:10]),
    )
    return coin
