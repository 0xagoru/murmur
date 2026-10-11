"""Small helpers for contracts added after the original deployment."""

import json
from functools import lru_cache
from typing import Any

from web3 import Web3

from .chain import manifest
from .coins import HISTORY_RPC
from .config import DATA, ROOT


@lru_cache(maxsize=8)
def abi(name: str) -> list[dict[str, Any]]:
    return json.loads((ROOT / f"contracts/artifacts/{name}.json").read_text())["abi"]


def contract(w: Web3, key: str, name: str):
    address = manifest().get("contracts", {}).get(key)
    if not address:
        return None
    return w.eth.contract(address=Web3.to_checksum_address(address), abi=abi(name))


def deploy_block(w: Web3, address: str) -> int:
    for t in manifest().get("transactions", []):
        if t.get("kind") == "deployment" and t.get("hash"):
            r = w.eth.get_transaction_receipt("0x" + t["hash"].removeprefix("0x"))
            if (r.get("contractAddress") or "").lower() == address.lower():
                return r["blockNumber"]
    return w.eth.block_number - 1000


def scribe(w: Web3):
    path = DATA / "scribe.json"
    return w.eth.account.from_key(json.loads(path.read_text())["key"]) if path.exists() else None


def logs(w: Web3, address: str, start: int, stop: int, step: int = 5000) -> list[Any]:
    # Public dataseed nodes reject log queries; the read-only history endpoint serves them.
    h = Web3(Web3.HTTPProvider(HISTORY_RPC, request_kwargs={"timeout": 20}))
    out = []
    for b in range(start, stop + 1, step):
        out += h.eth.get_logs(
            {"address": Web3.to_checksum_address(address), "fromBlock": b, "toBlock": min(b + step - 1, stop)}
        )
    return out


def stamp(w: Web3, block: int, cache: dict[int, str]) -> str:
    from datetime import datetime, timezone

    if block not in cache:
        cache[block] = datetime.fromtimestamp(w.eth.get_block(block)["timestamp"], timezone.utc).isoformat()
    return cache[block]
