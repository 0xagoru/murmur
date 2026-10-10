import { useEffect, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  parseEther,
  formatEther,
  parseAbi,
} from "viem";
import { bsc } from "viem/chains";
import type { Config } from "./api";
import { short } from "./api";
import { ArrowUpRight, Wallet } from "lucide-react";
const abi = parseAbi([
  "function launch(string name,string symbol) returns (address)",
  "function count() view returns (uint256)",
  "function coins(uint256) view returns (address)",
  "function quoteBuy(address token,uint256 nativeAmount) view returns (uint256)",
  "function quoteSell(address token,uint256 amount) view returns (uint256)",
  "function buy(address token,uint256 minimum,uint256 deadline) payable",
  "function sell(address token,uint256 amount,uint256 minimum,uint256 deadline)",
  "event Launched(address indexed token,address indexed creator,string name,string symbol)",
]);
const tokenAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns(uint256)",
  "function approve(address spender,uint256 amount) returns(bool)",
  "function transfer(address recipient,uint256 amount) returns(bool)",
]);
const client = createPublicClient({
  chain: bsc,
  transport: http("https://bsc-dataseed.bnbchain.org"),
});
type Coin = { address: `0x${string}`; name: string; symbol: string };
export default function Launch({ config }: { config: Config }) {
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [coins, setCoins] = useState<Coin[]>([]);
  const [coin, setCoin] = useState<Coin | null>(null);
  const [amount, setAmount] = useState("0.001");
  const [withdraw, setWithdraw] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawAsset, setWithdrawAsset] = useState("BNB");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [quote, setQuote] = useState<bigint | null>(null);
  const address = config.deployment.contracts.launchpad as
    | `0x${string}`
    | undefined;
  async function load() {
    if (!address) return;
    try {
      const n = await client.readContract({
        address,
        abi,
        functionName: "count",
      });
      const list = await Promise.all(
        Array.from({ length: Math.min(Number(n), 30) }, async (_, i) => {
          const a = await client.readContract({
            address,
            abi,
            functionName: "coins",
            args: [BigInt(i)],
          });
          const [n, s] = await Promise.all([
            client.readContract({
              address: a,
              abi: tokenAbi,
              functionName: "name",
            }),
            client.readContract({
              address: a,
              abi: tokenAbi,
              functionName: "symbol",
            }),
          ]);
          return { address: a, name: n, symbol: s };
        }),
      );
      setCoins(list);
    } catch {
      setStatus("the launch ledger is temporarily unavailable");
    }
  }
  useEffect(() => {
    void load();
  }, [address]);
  useEffect(() => {
    setQuote(null);
    if (!coin || !address) return;
    let current = true;
    try {
      const value = parseEther(amount);
      if (value <= 0n) return;
      void client
        .readContract({
          address,
          abi,
          functionName: side === "buy" ? "quoteBuy" : "quoteSell",
          args: [coin.address, value],
        })
        .then((q) => {
          if (current) setQuote(q);
        })
        .catch(() => {
          if (current) setQuote(null);
        });
    } catch {}
    return () => {
      current = false;
    };
  }, [coin, address, amount, side]);
  async function wallet() {
    if (!authenticated) {
      login();
      throw new Error("sign in, then try again");
    }
    const w = wallets[0];
    if (!w) throw new Error("connect a wallet first");
    await w.switchChain(56);
    const provider = await w.getEthereumProvider();
    return createWalletClient({
      account: w.address as `0x${string}`,
      chain: bsc,
      transport: custom(provider),
    });
  }
  async function execute(action: () => Promise<`0x${string}`>) {
    setBusy(true);
    setStatus("check the request in your wallet.");
    try {
      const hash = await action();
      setStatus("transaction sent: " + short(hash));
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("transaction reverted");
      setStatus("confirmed: " + hash);
      await load();
    } catch (e) {
      setStatus((e as Error).message.slice(0, 220));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="launch-panel panel">
      <h2>launch a coin</h2>
      <p>
        fixed 1 billion supply. 20% creator allocation, 80% BNB curve. inspect
        the field guide for the curve rules.
      </p>
      {address ? (
        <>
          <form
            className="launch-form"
            onSubmit={(e) => {
              e.preventDefault();
              void execute(async () => {
                const w = await wallet();
                return w.writeContract({
                  address,
                  abi,
                  functionName: "launch",
                  args: [name.trim(), symbol.trim()],
                });
              });
            }}
          >
            <input
              required
              maxLength={40}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="coin name"
              aria-label="coin name"
            />
            <input
              required
              maxLength={10}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="symbol"
              aria-label="coin symbol"
            />
            <button className="primary" disabled={busy}>
              {busy ? "waiting..." : "launch coin"}
              <ArrowUpRight size={14} />
            </button>
          </form>
          <div className="launch-coins">
            {coins.map((c) => (
              <button
                key={c.address}
                className="coin-chip"
                onClick={() => setCoin(c)}
              >
                {c.name} · {c.symbol}
                <ArrowUpRight size={12} />
              </button>
            ))}
          </div>
          {coin && (
            <div className="launch-state">
              <h3>
                {coin.name} · {coin.symbol}
              </h3>
              <p>
                <a
                  href={"https://bscscan.com/token/" + coin.address}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(coin.address)} ↗
                </a>
              </p>
              <div className="launch-form">
                <select
                  value={side}
                  onChange={(e) => setSide(e.target.value as "buy" | "sell")}
                  aria-label="trade side"
                >
                  <option value="buy">buy with BNB</option>
                  <option value="sell">sell tokens for BNB</option>
                </select>
                <input
                  value={amount}
                  type="number"
                  min="0.000001"
                  step="any"
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label={side === "buy" ? "BNB amount" : "token amount"}
                />
                <button
                  className="primary"
                  disabled={busy || !quote}
                  onClick={() =>
                    void execute(async () => {
                      const w = await wallet();
                      const value = parseEther(amount);
                      const fresh = await client.readContract({
                        address,
                        abi,
                        functionName: side === "buy" ? "quoteBuy" : "quoteSell",
                        args: [coin.address, value],
                      });
                      const minimum = (fresh * 99n) / 100n;
                      if (minimum <= 0n) throw new Error("amount too small");
                      const deadline = BigInt(
                        Math.floor(Date.now() / 1000) + 180,
                      );
                      if (side === "buy")
                        return w.writeContract({
                          address,
                          abi,
                          functionName: "buy",
                          args: [coin.address, minimum, deadline],
                          value,
                        });
                      const hash = await w.writeContract({
                        address: coin.address,
                        abi: tokenAbi,
                        functionName: "approve",
                        args: [address, value],
                      });
                      const approved = await client.waitForTransactionReceipt({
                        hash,
                      });
                      if (approved.status !== "success")
                        throw new Error("approval failed");
                      return w.writeContract({
                        address,
                        abi,
                        functionName: "sell",
                        args: [coin.address, value, minimum, deadline],
                      });
                    })
                  }
                >
                  review {side}
                </button>
              </div>
              <p>
                {quote
                  ? "estimated output " +
                    Number(formatEther(quote)).toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    }) +
                    " " +
                    (side === "buy" ? coin.symbol : "BNB") +
                    " · 1% slippage limit"
                  : "enter an amount for a quote"}
              </p>
            </div>
          )}
        </>
      ) : (
        <p>launchpad unavailable.</p>
      )}
      <div className="wallet-tools">
        <button onClick={() => setWithdraw(!withdraw)}>
          <Wallet size={13} />
          withdraw from your wallet
        </button>
      </div>
      {withdraw && (
        <div className="launch-form">
          <select
            aria-label="withdrawal asset"
            value={withdrawAsset}
            onChange={(e) => setWithdrawAsset(e.target.value)}
          >
            <option>BNB</option>
            <option>USDT</option>
          </select>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="recipient 0x..."
            aria-label="withdrawal recipient"
            pattern="0x[a-fA-F0-9]{40}"
          />
          <input
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder={withdrawAsset + " amount"}
            type="number"
            min="0"
            step="any"
            aria-label="withdrawal amount"
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                if (!/^0x[a-fA-F0-9]{40}$/.test(recipient))
                  throw new Error("enter a valid recipient");
                const value = parseEther(withdrawAmount);
                if (value <= 0n) throw new Error("enter a positive amount");
                const w = await wallet();
                return withdrawAsset === "BNB"
                  ? w.sendTransaction({ to: recipient as `0x${string}`, value })
                  : w.writeContract({
                      address: "0x55d398326f99059fF775485246999027B3197955",
                      abi: tokenAbi,
                      functionName: "transfer",
                      args: [recipient as `0x${string}`, value],
                    });
              })
            }
          >
            review withdrawal
          </button>
        </div>
      )}
      {status && (
        <p
          className="launch-state"
          role="status"
          style={{ overflowWrap: "anywhere" }}
        >
          {status}
        </p>
      )}
    </section>
  );
}
