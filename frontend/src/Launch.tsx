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
export default function Launch({
  config,
  selectedAddress,
}: {
  config: Config;
  selectedAddress?: string;
}) {
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
      if (selectedAddress) {
        const match = list.find(
          (c) => c.address.toLowerCase() === selectedAddress.toLowerCase(),
        );
        if (match) setCoin(match);
        else {
          const a = selectedAddress as `0x${string}`;
          const [name, symbol] = await Promise.all([
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
          setCoin({ address: a, name, symbol });
        }
      }
    } catch {
      setStatus("The launchpad contract could not be read right now. Try again shortly.");
    }
  }
  useEffect(() => {
    void load();
  }, [address, selectedAddress]);
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
      throw new Error("Sign in, then try again.");
    }
    const w = wallets[0];
    if (!w) throw new Error("Connect a wallet first.");
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
    setStatus("Confirm the request in your wallet.");
    try {
      const hash = await action();
      setStatus("Transaction sent: " + short(hash));
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted.");
      setStatus("Confirmed: " + hash);
      await load();
    } catch (e) {
      setStatus((e as Error).message.slice(0, 220));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="launch-panel panel">
      <h2>{selectedAddress ? "Trade" : "Launch a coin"}</h2>
      {!selectedAddress && (
        <p>
          Every coin has a fixed supply of 1 billion. The creator gets 20% and
          the other 80% sits on a BNB curve. The field guide has the curve
          rules.
        </p>
      )}
      {address ? (
        <>
          {!selectedAddress && (
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
                placeholder="Coin name"
                aria-label="Coin name"
              />
              <input
                required
                maxLength={10}
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                placeholder="Symbol"
                aria-label="Coin symbol"
              />
              <button className="primary" disabled={busy}>
                {busy ? "Waiting…" : "Launch coin"}
                <ArrowUpRight size={14} />
              </button>
            </form>
          )}
          {!selectedAddress && (
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
          )}
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
                  aria-label="Trade side"
                >
                  <option value="buy">Buy with BNB</option>
                  <option value="sell">Sell tokens for BNB</option>
                </select>
                <input
                  value={amount}
                  type="number"
                  min="0.000001"
                  step="any"
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label={side === "buy" ? "BNB amount" : "Token amount"}
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
                      if (minimum <= 0n) throw new Error("That amount is too small.");
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
                        throw new Error("The approval failed.");
                      return w.writeContract({
                        address,
                        abi,
                        functionName: "sell",
                        args: [coin.address, value, minimum, deadline],
                      });
                    })
                  }
                >
                  {side === "buy" ? "Review buy" : "Review sell"}
                </button>
              </div>
              <p>
                {quote
                  ? "Estimated output " +
                    Number(formatEther(quote)).toLocaleString(undefined, {
                      maximumFractionDigits: 6,
                    }) +
                    " " +
                    (side === "buy" ? coin.symbol : "BNB") +
                    ", with a 1% slippage limit"
                  : "Enter an amount to get a quote."}
              </p>
            </div>
          )}
        </>
      ) : (
        <p>No launchpad contract is set for this deployment.</p>
      )}
      <div className="wallet-tools">
        <button onClick={() => setWithdraw(!withdraw)}>
          <Wallet size={13} />
          Withdraw from your wallet
        </button>
      </div>
      {withdraw && (
        <div className="launch-form">
          <select
            aria-label="Withdrawal asset"
            value={withdrawAsset}
            onChange={(e) => setWithdrawAsset(e.target.value)}
          >
            <option>BNB</option>
            <option>USDT</option>
          </select>
          <input
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Recipient 0x…"
            aria-label="Withdrawal recipient"
            pattern="0x[a-fA-F0-9]{40}"
          />
          <input
            value={withdrawAmount}
            onChange={(e) => setWithdrawAmount(e.target.value)}
            placeholder={withdrawAsset + " amount"}
            type="number"
            min="0"
            step="any"
            aria-label="Withdrawal amount"
          />
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              void execute(async () => {
                if (!/^0x[a-fA-F0-9]{40}$/.test(recipient))
                  throw new Error("Enter a valid recipient address.");
                const value = parseEther(withdrawAmount);
                if (value <= 0n) throw new Error("Enter an amount above zero.");
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
            Review withdrawal
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
