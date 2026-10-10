import sys, os, json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from murmur.config import ROOT, DATA
from murmur.chain import web3
from murmur.ledger import FEEDS

# Resumable: creates the scribe key once, deploys MurmurLedger once, tops the scribe up to its gas allowance.
w = web3()
assert w.eth.chain_id == 56
owner = w.eth.account.from_key(os.environ["DEV_PRIVATE_KEY"])
manifest_path = ROOT / "contracts/deployment.json"
state = json.loads(manifest_path.read_text())
assert owner.address == state["deployer"]
scribe_path = DATA / "scribe.json"
if not scribe_path.exists():
    account = w.eth.account.create()
    scribe_path.write_text(
        json.dumps({"address": account.address, "key": account.key.hex()})
    )
    os.chmod(scribe_path, 0o600)
scribe = json.loads(scribe_path.read_text())["address"]
SCRIBE_GAS = w.to_wei("0.01", "ether")
start = w.eth.get_balance(owner.address)
CAP = w.to_wei("0.02", "ether")


def send(tx, kind):
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
    state["transactions"].append(
        {"hash": h.removeprefix("0x"), "kind": kind, "agent": None, "status": "pending"}
    )
    manifest_path.write_text(json.dumps(state, indent=2))
    w.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w.eth.wait_for_transaction_receipt(h, timeout=180)
    assert receipt.status == 1, kind
    state["transactions"][-1]["status"] = "confirmed"
    manifest_path.write_text(json.dumps(state, indent=2))
    print(kind, h)
    return receipt


if "ledger" not in state["contracts"]:
    art = json.loads((ROOT / "contracts/artifacts/MurmurLedger.json").read_text())
    factory = w.eth.contract(abi=art["abi"], bytecode=art["bytecode"])
    tx = factory.constructor(
        owner.address, scribe, [f["address"] for f in FEEDS.values()]
    ).build_transaction({"from": owner.address})
    receipt = send(tx, "deployment")
    state["contracts"]["ledger"] = receipt.contractAddress
    state["contracts"]["scribe"] = scribe
    manifest_path.write_text(json.dumps(state, indent=2))
balance = w.eth.get_balance(scribe)
if balance < SCRIBE_GAS // 2:
    send({"to": scribe, "value": SCRIBE_GAS - balance}, "scribe_gas")
print("ledger", state["contracts"]["ledger"], "scribe", scribe, w.eth.get_balance(scribe) / 1e18)
