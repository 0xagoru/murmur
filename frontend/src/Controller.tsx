import { useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseAbi,
  parseEther,
  zeroAddress,
} from "viem";
import { bsc } from "viem/chains";
import type { Agent, Config } from "./api";
const abi = parseAbi([
  "function owner() view returns(address)",
  "function dailyLimit() view returns(uint256)",
  "function paused() view returns(bool)",
  "function setPolicy(uint256 limit,bool stop)",
  "function withdraw(address asset,address recipient,uint256 amount)",
]);
const client = createPublicClient({
  chain: bsc,
  transport: http("https://bsc-dataseed.bnbchain.org"),
});
export default function Controller({
  agent,
  config,
}: {
  agent: Agent;
  config: Config;
}) {
  const { wallets } = useWallets();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("BNB");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const wallet = wallets.find(
    (w) =>
      w.address.toLowerCase() === config.deployment.deployer?.toLowerCase(),
  );
  if (!wallet) return null;
  const address = agent.wallet as `0x${string}`;
  async function act(action: "pause" | "resume" | "withdraw") {
    setBusy(true);
    try {
      const w = wallet!;
      const owner = await client.readContract({
        address,
        abi,
        functionName: "owner",
      });
      if (owner.toLowerCase() !== w.address.toLowerCase())
        throw new Error("this wallet does not control the account");
      await w.switchChain(56);
      const wc = createWalletClient({
        chain: bsc,
        account: w.address as `0x${string}`,
        transport: custom(await w.getEthereumProvider()),
      });
      let hash: `0x${string}`;
      if (action === "withdraw") {
        if (!/^0x[a-fA-F0-9]{40}$/.test(recipient) || parseEther(amount) <= 0n)
          throw new Error("enter a valid recipient and positive amount");
        hash = await wc.writeContract({
          address,
          abi,
          functionName: "withdraw",
          args: [
            asset === "BNB"
              ? zeroAddress
              : "0x55d398326f99059fF775485246999027B3197955",
            recipient as `0x${string}`,
            parseEther(amount),
          ],
        });
      } else {
        const limit = await client.readContract({
          address,
          abi,
          functionName: "dailyLimit",
        });
        hash = await wc.writeContract({
          address,
          abi,
          functionName: "setPolicy",
          args: [limit, action === "pause"],
        });
      }
      setStatus("waiting for confirmation");
      const r = await client.waitForTransactionReceipt({ hash });
      setStatus(
        r.status === "success" ? "confirmed: " + hash : "transaction reverted",
      );
    } catch (e) {
      setStatus((e as Error).message.slice(0, 200));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="controller">
      <span className="eyebrow">account controller</span>
      <div className="wallet-tools">
        <button disabled={busy} onClick={() => void act("pause")}>
          pause trading
        </button>
        <button disabled={busy} onClick={() => void act("resume")}>
          resume trading
        </button>
      </div>
      <div className="launch-form">
        <select
          aria-label="resident withdrawal asset"
          value={asset}
          onChange={(e) => setAsset(e.target.value)}
        >
          <option>BNB</option>
          <option>USDT</option>
        </select>
        <input
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="recipient 0x..."
          aria-label="resident withdrawal recipient"
        />
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="amount"
          type="number"
          min="0"
          step="any"
          aria-label="resident withdrawal amount"
        />
        <button
          className="primary"
          disabled={busy}
          onClick={() => void act("withdraw")}
        >
          review withdrawal
        </button>
      </div>
      {status && (
        <p className="tiny" role="status" style={{ overflowWrap: "anywhere" }}>
          {status}
        </p>
      )}
    </section>
  );
}
