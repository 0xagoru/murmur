import json
from typing import Any
from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
from .config import ROOT, RPC
from .store import rows, write, now

USDT = Web3.to_checksum_address("0x55d398326f99059fF775485246999027B3197955")
WBNB = Web3.to_checksum_address("0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c")
ROUTER = Web3.to_checksum_address("0x10ED43C718714eb63d5aA57B78B54704E256024E")
ERC20_ABI = [
    {
        "type": "function",
        "name": "balanceOf",
        "inputs": [{"name": "account", "type": "address"}],
        "outputs": [{"type": "uint256"}],
        "stateMutability": "view",
    }
]


def web3() -> Web3:
    w = Web3(Web3.HTTPProvider(RPC, request_kwargs={"timeout": 15}))
    w.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)
    return w


def manifest() -> dict[str, Any]:
    p = ROOT / "contracts/deployment.json"
    return (
        json.loads(p.read_text())
        if p.exists()
        else {"chainId": 56, "contracts": {}, "status": "preparing"}
    )


def refresh() -> None:
    w = web3()
    if w.eth.chain_id != 56:
        raise RuntimeError("BNB chain mismatch")
    token = w.eth.contract(address=USDT, abi=ERC20_ABI)
    for a in rows('SELECT id,wallet FROM agents WHERE wallet != ""'):
        bnb = float(w.from_wei(w.eth.get_balance(a["wallet"]), "ether"))
        usdt = float(w.from_wei(token.functions.balanceOf(a["wallet"]).call(), "ether"))
        write(
            "INSERT INTO snapshots(agent_id,bnb,usdt,created_at) VALUES(?,?,?,?)",
            (a["id"], bnb, usdt, now()),
        )
