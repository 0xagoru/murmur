import sys, json, time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from murmur.config import ROOT, DATA
from murmur.chain import web3, manifest
from murmur.store import write, now, rows
from web3.logs import DISCARD

w = web3()
assert w.eth.chain_id == 56
key = json.loads((DATA / "operators.json").read_text())["pip"]
op = w.eth.account.from_key(key["private_key"])
launch = rows(
    "SELECT details FROM receipts WHERE agent_id='pip' AND kind='coin_launch'"
)[0]
token = json.loads(launch["details"])["token"]
f = w.eth.contract(
    address=manifest()["contracts"]["launchpad"],
    abi=json.loads((ROOT / "contracts/artifacts/MurmurLaunchpad.json").read_text())[
        "abi"
    ],
)
t = w.eth.contract(
    address=token,
    abi=json.loads((ROOT / "contracts/artifacts/MurmurCoin.json").read_text())["abi"],
)


def send(call, kind, value=0):
    tx = call.build_transaction(
        {
            "from": op.address,
            "nonce": w.eth.get_transaction_count(op.address, "pending"),
            "gasPrice": w.eth.gas_price,
            "chainId": 56,
            "value": value,
        }
    )
    tx.pop("gas", None)
    tx["gas"] = int(w.eth.estimate_gas(tx) * 1.35)
    assert tx["gas"] * tx["gasPrice"] < w.to_wei("0.00005", "ether")
    signed = op.sign_transaction(tx)
    h = w.to_hex(w.keccak(signed.raw_transaction))
    write("INSERT OR REPLACE INTO meta VALUES(?,?)", ("curve_validation_pending", h))
    w.eth.send_raw_transaction(signed.raw_transaction)
    r = w.eth.wait_for_transaction_receipt(h, timeout=120)
    assert r.status == 1
    write(
        "INSERT INTO receipts(agent_id,kind,tx_hash,amount,asset,created_at,details) VALUES(?,?,?,?,?,?,?)",
        (
            "pip",
            kind,
            h,
            str(value / 1e18),
            "BNB",
            now(),
            json.dumps(
                {
                    "token": token,
                    "validation": True,
                    "gas_wei": str(r.gasUsed * r.effectiveGasPrice),
                }
            ),
        ),
    )
    write("DELETE FROM meta WHERE key=?", ("curve_validation_pending",))
    print(kind, h)
    return r


if rows("SELECT id FROM receipts WHERE kind='curve_sell'"):
    print("already validated")
    sys.exit(0)
if not rows("SELECT id FROM receipts WHERE kind='curve_buy'"):
    amount = w.to_wei("0.00001", "ether")
    q = f.functions.quoteBuy(token, amount).call()
    send(
        f.functions.buy(token, q * 99 // 100, int(time.time()) + 120),
        "curve_buy",
        amount,
    )
units = t.functions.balanceOf(op.address).call()
assert units > 0
send(t.functions.approve(f.address, units), "curve_approval")
q = f.functions.quoteSell(token, units).call()
send(
    f.functions.sell(token, units, q * 99 // 100, int(time.time()) + 120), "curve_sell"
)
print("curve buy and sell confirmed")
