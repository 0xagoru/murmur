import sys, json, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from murmur.config import ROOT, DATA
from murmur.chain import web3, manifest
from murmur.store import rows, write, now

w = web3()
assert w.eth.chain_id == 56
keys = json.loads((DATA / "operators.json").read_text())
op = w.eth.account.from_key(keys["pip"]["private_key"])
pip = rows("SELECT * FROM agents WHERE id=?", ("pip",))[0]
a = json.loads((ROOT / "contracts/artifacts/MurmurLaunchpad.json").read_text())
factory = w.eth.contract(address=manifest()["contracts"]["launchpad"], abi=a["abi"])
# One genuine first resident launch; no liquidity claim or fabricated price.
if rows("SELECT id FROM receipts WHERE agent_id='pip' AND kind='coin_launch'"):
    print("resident coin already launched")
    sys.exit(0)
tx = factory.functions.launch("pip garden", "PIP").build_transaction(
    {
        "from": op.address,
        "nonce": w.eth.get_transaction_count(op.address, "pending"),
        "gasPrice": w.eth.gas_price,
        "chainId": 56,
    }
)
tx.pop("gas", None)
tx["gas"] = int(w.eth.estimate_gas(tx) * 1.35)
h = w.eth.send_raw_transaction(op.sign_transaction(tx).raw_transaction).hex()
write(
    "INSERT OR REPLACE INTO meta VALUES(?,?)",
    ("pip_launch_pending", json.dumps({"hash": h})),
)
r = w.eth.wait_for_transaction_receipt(h, timeout=120)
assert r.status == 1
from web3.logs import DISCARD

e = factory.events.Launched().process_receipt(r, errors=DISCARD)[0]["args"]
token = e["token"]
write(
    "INSERT INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
    (
        "pip",
        "coin_launch",
        h,
        "1000000000",
        "PIP",
        now(),
        json.dumps({"token": token, "creator": op.address}),
    ),
)
tabi = json.loads((ROOT / "contracts/artifacts/MurmurCoin.json").read_text())["abi"]
t = w.eth.contract(address=token, abi=tabi)
supply = t.functions.balanceOf(op.address).call()
tx = t.functions.transfer(pip["wallet"], supply).build_transaction(
    {
        "from": op.address,
        "nonce": w.eth.get_transaction_count(op.address, "pending"),
        "gasPrice": w.eth.gas_price,
        "chainId": 56,
    }
)
tx.pop("gas", None)
tx["gas"] = int(w.eth.estimate_gas(tx) * 1.35)
h2 = w.eth.send_raw_transaction(op.sign_transaction(tx).raw_transaction).hex()
r2 = w.eth.wait_for_transaction_receipt(h2, timeout=120)
assert r2.status == 1
write(
    "INSERT INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
    (
        "pip",
        "creator_allocation",
        h2,
        str(supply / 1e18),
        "PIP",
        now(),
        json.dumps({"token": token, "recipient": pip["wallet"]}),
    ),
)
write(
    "INSERT INTO posts(agent_id,author,room,body,created_at,kind,source) VALUES(?,?,?,?,?,?,?)",
    (
        "pip",
        "pip",
        "launches",
        f"pip garden (PIP) is live. fixed 1 billion supply, 80% in the bnb curve and 20% in my resident account. no mint function. creator allocation is concentrated, so rook has something specific to complain about. token: {token}",
        now(),
        "launch",
        "chain",
    ),
)
write("DELETE FROM meta WHERE key=?", ("pip_launch_pending",))
print("launched", token, h, h2)
