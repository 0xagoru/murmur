"""Full resident funding/billing/trading/withdrawal test on local Anvil only."""

import json
import os
import sys
import tempfile
from pathlib import Path

from web3 import Web3

os.environ["MURMUR_DATA"] = tempfile.mkdtemp(prefix="murmur-resident-test-")
os.environ["OPENROUTER_API_KEY"] = ""
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from murmur import platform, residents, store, trading
from murmur.config import ROOT

w = Web3(Web3.HTTPProvider("http://127.0.0.1:28545"))
assert w.eth.chain_id == 56
owner = w.eth.accounts[0]
beneficiary = w.eth.accounts[1]
os.environ["MURMUR_BILLING_RECIPIENT"] = beneficiary
residents.web3 = lambda: w
trading.web3 = lambda: w
store.init()


def send(fn, sender=owner, value=0):
    r = w.eth.wait_for_transaction_receipt(
        fn.transact({"from": sender, "value": value})
    )
    assert r.status == 1
    return r


def deploy(path, args):
    a = json.loads((ROOT / path).read_text())
    bytecode = a["bytecode"]
    bytecode = bytecode["object"] if isinstance(bytecode, dict) else bytecode
    r = send(w.eth.contract(abi=a["abi"], bytecode=bytecode).constructor(*args))
    return w.eth.contract(address=r.contractAddress, abi=a["abi"])


router = deploy("contracts/forge-out/Murmur.t.sol/MockRouter.json", [])
token = deploy(
    "contracts/artifacts/MurmurCoin.json", ["USDT", "USDT", 1000 * 10**18, owner]
)
# Trading uses the router's token; inference uses a separately funded token vault.
trade_token = router.functions.token().call()
residents.USDT = trade_token
residents.ROUTER = router.address
trading.USDT = trade_token
trading.ROUTER = router.address
trade_abi = json.loads((ROOT / "contracts/artifacts/MurmurCoin.json").read_text())[
    "abi"
]
t = w.eth.contract(address=trade_token, abi=trade_abi)
# Anvil can impersonate its local mock router to allocate test credits.
w.provider.make_request("anvil_impersonateAccount", [router.address])
w.provider.make_request("anvil_setBalance", [router.address, hex(10**20)])
send(t.functions.transfer(owner, 10 * 10**18), router.address)
proof = residents.challenge("local-owner", owner)
# eth_sign semantics differ across clients; use Anvil's standard first test key
# through its unlocked account's personal_sign, never a production credential.
signature = w.provider.make_request(
    "personal_sign", [Web3.to_hex(proof["message"].encode()), owner]
)["result"]
data = {
    "name": "local resident",
    "persona": "checks fees and preserves sources, never invents trades",
    "model": residents.MODELS[0],
    "beat": "moss",
    "faction": residents.FACTIONS[0],
    "color": "sage",
    "interests": "fees",
    "cottage": "round",
    "rival": "flicker",
    "trade_limit": 0.001,
    "inference_limit": 0.25,
    "pace": 3600,
    "challenge": proof["id"],
    "signature": signature,
    "memory": "check fees first",
}
s = residents.create("local-owner", data)
ident = s["agent_id"]
r = w.eth.wait_for_transaction_receipt(
    w.eth.send_transaction({"from": owner, "data": s["deployment"]["data"]})
)
assert r.status == 1
w.provider.make_request("anvil_mine", ["0x3"])
s = residents.attach(ident, "local-owner", Web3.to_hex(r.transactionHash))
send(t.functions.transfer(s["credit"], 10**18))
w.eth.send_transaction({"from": owner, "to": s["wallet"], "value": 10**16})
w.eth.send_transaction({"from": owner, "to": s["operator"], "value": 10**16})
store.write(
    "UPDATE resident_settings SET paused=0,trade_enabled=1 WHERE agent_id=?", (ident,)
)
assert residents.readiness(ident)
invoice = store.write(
    "INSERT INTO inference(agent_id,cost,status,created_at) VALUES(?,?,?,?)",
    (ident, 0.05, "reserved", store.now()),
)
residents.reserve_credit(ident, invoice)
funds = residents.refresh_funds(ident)
assert (
    abs(funds["available_usdt"] - 0.95) < 1e-12
    and abs(funds["reserved_usdt"] - 0.05) < 1e-12
)
store.write("UPDATE inference SET cost=.002,status='complete' WHERE id=?", (invoice,))
residents.settle_credit(ident, invoice, 0.002)
assert t.functions.balanceOf(beneficiary).call() == 2 * 10**15
assert abs(residents.refresh_funds(ident)["available_usdt"] - 0.998) < 1e-12
buy = trading.execute(ident, "buy")
assert buy
store.write("DELETE FROM meta WHERE key=?", ("trade_lock_" + ident,))
sell = trading.execute(ident, "sell")
assert sell
records, _ = platform.trade_records()
assert records[-1]["pnl_bnb"] is not None
credit = w.eth.contract(
    address=s["credit"],
    abi=json.loads((ROOT / "contracts/artifacts/InferenceCredit.json").read_text())[
        "abi"
    ],
)
send(credit.functions.withdraw(credit.functions.available().call()))
account = w.eth.contract(
    address=s["wallet"],
    abi=json.loads((ROOT / "contracts/artifacts/AgentAccount.json").read_text())["abi"],
)
send(account.functions.setPolicy(0, True))
send(account.functions.withdraw("0x" + "0" * 40, owner, w.eth.get_balance(s["wallet"])))
assert w.eth.get_balance(s["wallet"]) == 0 and credit.functions.available().call() == 0
store.write("UPDATE resident_settings SET paused=1 WHERE agent_id=?", (ident,))
assert not residents.readiness(ident)
print(
    "local full flow passed: owner signature, verified deployment, separated deposits, reservation, actual-cost billing, trade round trip, pause and withdrawals"
)
