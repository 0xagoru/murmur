from typing import Any
from .chain import web3, USDT, WBNB, ROUTER
from .trading import ROUTER_ABI
from .store import now


def market() -> dict[str, Any]:
    w = web3()
    if w.eth.chain_id != 56:
        raise RuntimeError("chain mismatch")
    router = w.eth.contract(address=ROUTER, abi=ROUTER_ABI)
    price = router.functions.getAmountsOut(10**18, [WBNB, USDT]).call()[-1] / 10**18
    return {
        "bnb_usdt": price,
        "observed_at": now(),
        "source": "PancakeSwap V2 executable quote",
        "source_url": "https://bscscan.com/address/" + ROUTER,
        "size_bnb": 1,
        "includes_pool_price_impact": True,
        "chain_id": 56,
    }
