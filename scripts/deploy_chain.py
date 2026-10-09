import sys, os, json, secrets, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from murmur.config import ROOT, DATA
from murmur.chain import web3, USDT, ROUTER
from murmur.store import init, rows, write, now
from web3 import Web3

w = web3()
assert w.eth.chain_id == 56
owner = w.eth.account.from_key(os.environ["DEV_PRIVATE_KEY"])
expected = "0x5D8245Bb247965b922F3E82148f5758CF5Da1a8A"
assert owner.address == expected
init()
p = ROOT / "contracts/deployment.json"
state = (
    json.loads(p.read_text())
    if p.exists()
    else {
        "chainId": 56,
        "deployer": owner.address,
        "status": "deploying",
        "contracts": {},
        "transactions": [],
    }
)


def save():
    p.write_text(json.dumps(state, indent=2))


def artifact(name):
    return json.loads((ROOT / f"contracts/artifacts/{name}.json").read_text())


initial = w.eth.get_balance(owner.address)
MAX_SPEND = w.to_wei("0.06", "ether")


def send(tx, agent=None, kind="deployment", amount="0", asset="BNB"):
    spent = initial - w.eth.get_balance(owner.address)
    assert spent + tx.get("value", 0) < MAX_SPEND, "deployment session cap"
    nonce = w.eth.get_transaction_count(owner.address, "pending")
    tx.update(
        {
            "from": owner.address,
            "nonce": nonce,
            "chainId": 56,
            "gasPrice": w.eth.gas_price,
        }
    )
    tx["gas"] = int(w.eth.estimate_gas(tx) * 1.2)
    assert tx["gas"] * tx["gasPrice"] + tx.get("value", 0) + spent < MAX_SPEND
    signed = owner.sign_transaction(tx)
    h = w.eth.send_raw_transaction(signed.raw_transaction).hex()
    # Persist broadcast hash before waiting; no automatic resend after an ambiguous response.
    state["transactions"].append(
        {"hash": h, "kind": kind, "agent": agent, "status": "pending"}
    )
    save()
    receipt = w.eth.wait_for_transaction_receipt(h, timeout=180)
    assert receipt.status == 1, f"transaction reverted {h}"
    state["transactions"][-1]["status"] = "confirmed"
    save()
    write(
        "INSERT OR IGNORE INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
        (
            agent,
            kind,
            h,
            amount,
            asset,
            now(),
            json.dumps(
                {"gas_used": receipt.gasUsed, "gas_price": receipt.effectiveGasPrice}
            ),
        ),
    )
    print(kind, agent or "", h)
    return receipt


# Refuse to continue if a previous broadcast remains unresolved.
for t in state["transactions"]:
    if t["status"] == "pending":
        r = w.eth.get_transaction_receipt(t["hash"])
        assert r.status == 1
        t["status"] = "confirmed"
        save()


def deploy(name, args, key):
    if key in state["contracts"]:
        assert len(w.eth.get_code(state["contracts"][key])) > 0
        return w.eth.contract(
            address=state["contracts"][key], abi=artifact(name)["abi"]
        )
    a = artifact(name)
    c = w.eth.contract(abi=a["abi"], bytecode=a["bytecode"])
    r = send(
        c.constructor(*args).build_transaction(
            {
                "from": owner.address,
                "nonce": w.eth.get_transaction_count(owner.address),
                "gasPrice": w.eth.gas_price,
            }
        )
    )
    state["contracts"][key] = r.contractAddress
    save()
    return w.eth.contract(address=r.contractAddress, abi=a["abi"])


registry = deploy("MurmurRegistry", [owner.address], "registry")
launchpad = deploy("MurmurLaunchpad", [], "launchpad")
keyfile = DATA / "operators.json"
keys = json.loads(keyfile.read_text()) if keyfile.exists() else {}
for a in rows("SELECT * FROM agents"):
    ident = a["id"]
    if ident not in keys:
        op = w.eth.account.create()
        keys[ident] = {"private_key": op.key.hex(), "address": op.address}
        keyfile.write_text(json.dumps(keys))
        keyfile.chmod(0o600)
    op = keys[ident]
    account = deploy(
        "AgentAccount",
        [owner.address, op["address"], ROUTER, w.to_wei("0.001", "ether")],
        "agent_" + ident,
    )
    write(
        "UPDATE agents SET wallet=?,status=? WHERE id=?",
        (account.address, "resident", ident),
    )
    if not account.functions.allowedTokens(USDT).call():
        send(
            account.functions.allowToken(USDT, True).build_transaction(
                {"from": owner.address, "gasPrice": w.eth.gas_price}
            ),
            ident,
            "policy",
        )
    reg = registry.functions.residents(w.keccak(text=ident)).call()
    if reg[0] == "0x0000000000000000000000000000000000000000":
        send(
            registry.functions.register(
                w.keccak(text=ident),
                account.address,
                w.keccak(text=a["faction"]),
                f"https://murmuragents.io/api/agents#{ident}",
            ).build_transaction({"from": owner.address, "gasPrice": w.eth.gas_price}),
            ident,
            "registration",
        )
    if not rows(
        "SELECT id FROM receipts WHERE agent_id=? AND kind='funding'", (ident,)
    ):
        send(
            {"to": account.address, "value": w.to_wei("0.004", "ether")},
            ident,
            "funding",
            "0.004",
        )
    if not rows(
        "SELECT id FROM receipts WHERE agent_id=? AND kind='operator_gas'", (ident,)
    ):
        send(
            {"to": op["address"], "value": w.to_wei("0.0002", "ether")},
            ident,
            "operator_gas",
            "0.0002",
        )
state["status"] = "live"
save()
print("DEPLOYED", json.dumps(state["contracts"]))
