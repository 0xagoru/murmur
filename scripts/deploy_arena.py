"""Resumable: deploys MurmurArena and MurmurDesk, then tops up scribe, operator and account gas from the dev wallet."""

import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from murmur.config import ROOT, DATA
from murmur.chain import web3

w = web3()
assert w.eth.chain_id == 56
owner = w.eth.account.from_key(os.environ["DEV_PRIVATE_KEY"])
manifest_path = ROOT / "contracts/deployment.json"
state = json.loads(manifest_path.read_text())
assert owner.address == state["deployer"]
start = w.eth.get_balance(owner.address)
# Hard ceiling for one run of this script.
CAP = w.to_wei("0.12", "ether")
DESK_FEE = w.to_wei("0.003", "ether")
SCRIBE_TARGET = w.to_wei("0.03", "ether")
OPERATOR_TARGET = w.to_wei("0.002", "ether")
ACCOUNT_TARGET = w.to_wei("0.01", "ether")


def save():
    manifest_path.write_text(json.dumps(state, indent=2))


def send(tx, kind, agent=None):
    tx.pop("maxFeePerGas", None)
    tx.pop("maxPriorityFeePerGas", None)
    tx.update(
        {
            "from": owner.address,
            "nonce": w.eth.get_transaction_count(owner.address, "pending"),
            "chainId": 56,
            "gasPrice": w.eth.gas_price,
        }
    )
    tx["gas"] = int(w.eth.estimate_gas(tx) * 1.2)
    spent = start - w.eth.get_balance(owner.address)
    assert spent + tx["gas"] * tx["gasPrice"] + tx.get("value", 0) < CAP, "session cap"
    signed = owner.sign_transaction(tx)
    h = w.to_hex(w.keccak(signed.raw_transaction))
    entry = {"hash": h.removeprefix("0x"), "kind": kind, "agent": agent, "status": "pending"}
    if tx.get("value"):
        entry["amount"] = str(w.from_wei(tx["value"], "ether"))
    state["transactions"].append(entry)
    save()
    w.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w.eth.wait_for_transaction_receipt(h, timeout=180)
    assert receipt.status == 1, kind
    entry["status"] = "confirmed"
    save()
    print(kind, agent or "", h)
    return receipt


def deploy(name, *args):
    if name.lower().removeprefix("murmur") in state["contracts"]:
        return
    art = json.loads((ROOT / f"contracts/artifacts/{name}.json").read_text())
    factory = w.eth.contract(abi=art["abi"], bytecode=art["bytecode"])
    receipt = send(factory.constructor(*args).build_transaction({"from": owner.address}), "deployment")
    state["contracts"][name.lower().removeprefix("murmur")] = receipt.contractAddress
    save()


scribe = state["contracts"]["scribe"]
deploy("MurmurArena", owner.address, state["contracts"]["ledger"])
deploy("MurmurDesk", owner.address, scribe, DESK_FEE)


def top_up(address, target, kind, agent=None):
    balance = w.eth.get_balance(address)
    if balance < target * 0.8:
        send({"to": address, "value": target - balance}, kind, agent)


top_up(scribe, SCRIBE_TARGET, "scribe_gas")
operators = json.loads((DATA / "operators.json").read_text())
for ident, op in operators.items():
    top_up(w.eth.account.from_key(op["private_key"]).address, OPERATOR_TARGET, "operator_gas", ident)
    top_up(state["contracts"]["agent_" + ident], ACCOUNT_TARGET, "funding", ident)
print("arena", state["contracts"]["arena"], "desk", state["contracts"]["desk"])
print("spent", (start - w.eth.get_balance(owner.address)) / 1e18, "BNB")
