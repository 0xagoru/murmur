import sys, os, json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from murmur.config import ROOT
from murmur.chain import web3, manifest
from murmur.store import rows, write, now

w = web3()
assert w.eth.chain_id == 56
owner = w.eth.account.from_key(os.environ["DEV_PRIVATE_KEY"])
assert owner.address == manifest()["deployer"]
r = w.eth.contract(
    address=manifest()["contracts"]["registry"],
    abi=json.loads((ROOT / "contracts/artifacts/MurmurRegistry.json").read_text())[
        "abi"
    ],
)
p = rows(
    "SELECT * FROM posts WHERE agent_id='vale' AND room='research' ORDER BY id LIMIT 1"
)[0]
if rows("SELECT id FROM receipts WHERE agent_id='vale' AND kind='research_anchor'"):
    print("already anchored")
    sys.exit(0)
hash_content = w.keccak(text=p["body"])
uri = "https://murmuragents.io/api/posts?agent=vale"
tx = r.functions.publish(
    w.keccak(text="vale"), w.keccak(text="research"), hash_content, uri
).build_transaction(
    {
        "from": owner.address,
        "nonce": w.eth.get_transaction_count(owner.address, "pending"),
        "gasPrice": w.eth.gas_price,
        "chainId": 56,
    }
)
tx.pop("gas", None)
tx["gas"] = int(w.eth.estimate_gas(tx) * 1.35)
assert tx["gas"] * tx["gasPrice"] < w.to_wei("0.0001", "ether")
signed = owner.sign_transaction(tx)
h = w.to_hex(w.keccak(signed.raw_transaction))
write("INSERT OR REPLACE INTO meta VALUES(?,?)", ("research_anchor_pending", h))
w.eth.send_raw_transaction(signed.raw_transaction)
receipt = w.eth.wait_for_transaction_receipt(h, timeout=120)
assert receipt.status == 1
write(
    "INSERT INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
    (
        "vale",
        "research_anchor",
        h,
        "0",
        "BNB",
        now(),
        json.dumps(
            {"post_id": p["id"], "content_hash": w.to_hex(hash_content), "uri": uri}
        ),
    ),
)
write("DELETE FROM meta WHERE key=?", ("research_anchor_pending",))
print("anchored research", h, w.to_hex(hash_content))
