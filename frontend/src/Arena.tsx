import { useCallback, useEffect, useMemo, useState } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  parseAbi,
  parseEther,
} from "viem";
import { bsc } from "viem/chains";
import { ArrowUpRight, Check, Copy } from "lucide-react";
import { api, short } from "./api";
import type { Agent } from "./api";
import type { ArenaBoard, ArenaCall, Stake } from "./town-api";
import { ago, usd } from "./Research";
import { Face } from "./Town";
import "./arena.css";

type Hex = `0x${string}`;

const arenaAbi = parseAbi([
  "function back(uint256 id, bool agentRight) payable",
  "function claim(uint256 id)",
  "function quote(uint256 id, address backer) view returns (uint256 payout, uint256 fee, bool ready)",
  "function onRight(uint256, address) view returns (uint256)",
  "function onWrong(uint256, address) view returns (uint256)",
  "function claimed(uint256, address) view returns (bool)",
]);

export const chain = createPublicClient({
  chain: bsc,
  transport: http("https://bsc-dataseed.bnbchain.org"),
});

export const scan = (kind: "tx" | "address" | "token", value: string) =>
  "https://bscscan.com/" + kind + "/" + value;

export const bnb = (n: number) =>
  n.toLocaleString("en-US", {
    minimumFractionDigits: n > 0 && n < 0.01 ? 4 : 3,
    maximumFractionDigits: 4,
  });

const weiBnb = (wei: bigint | string) => Number(formatEther(BigInt(wei)));

// Countdown to a unix time: "2h 10m", "3d 4h", "12m".
export const span = (seconds: number) => {
  const m = Math.max(0, Math.round(seconds / 60));
  return m >= 1440
    ? Math.floor(m / 1440) + "d " + Math.floor((m % 1440) / 60) + "h"
    : m >= 60
      ? Math.floor(m / 60) + "h " + (m % 60) + "m"
      : m + "m";
};

// Wallet and contract errors in words a visitor can act on.
export function human(e: unknown): string {
  const reason =
    e instanceof BaseError
      ? (
          e.walk(
            (x) => x instanceof ContractFunctionRevertedError,
          ) as ContractFunctionRevertedError | null
        )?.reason
      : undefined;
  const raw =
    e instanceof BaseError
      ? [reason, e.shortMessage, e.details, e.message].join(" ")
      : e instanceof Error
        ? e.message
        : String(e);
  const m = raw.toLowerCase();
  if (/user rejected|user denied|rejected the request|user cancel|4001/.test(m))
    return "you rejected the request in your wallet.";
  if (/insufficient funds|exceeds the balance|insufficient balance/.test(m))
    return "not enough BNB in this wallet for the amount plus gas.";
  if (m.includes("backing closed")) return "backing on this call has closed.";
  if (m.includes("call not open")) return "this call is no longer open.";
  if (m.includes("stake out of range"))
    return "stakes are 0.001 to 0.5 BNB per wallet per call, counting what you already staked.";
  if (m.includes("nothing to claim"))
    return "nothing to claim for this wallet.";
  if (/'claimed'|reason: claimed|reverted with reason string 'claimed'/.test(m))
    return "already claimed.";
  if (m.includes("not a contract"))
    return "that address is not a contract on BNB Chain.";
  if (m.includes("not yet"))
    return "a refund opens 24 hours after the request.";
  if (m.includes("not open"))
    return "this request is already fulfilled or refunded.";
  if (/chain mismatch|switch.*chain|unsupported chain/.test(m))
    return "switch your wallet to BNB Chain and try again.";
  if (reason && !/reverted: 0x$|^execution reverted$/.test(reason))
    return reason + ".";
  if (reason || m.includes("reverted"))
    return "the contract rejected this transaction.";
  const first =
    (e instanceof BaseError ? e.shortMessage : raw).split("\n")[0] || raw;
  return first.slice(0, 180);
}

// The signed-in visitor's first wallet, switched to BNB Chain on demand.
export function useWallet() {
  const { authenticated, login, ready } = usePrivy();
  const { wallets } = useWallets();
  const w = authenticated ? wallets[0] : undefined;
  const address = w?.address as Hex | undefined;
  const signer = useCallback(async () => {
    if (!w) throw new Error("connect a wallet first");
    await w.switchChain(56);
    const provider = await w.getEthereumProvider();
    return createWalletClient({
      account: w.address as Hex,
      chain: bsc,
      transport: custom(provider),
    });
  }, [w]);
  return { authenticated, ready, login, address, signer };
}

export type TxState = {
  tone: "wait" | "ok" | "error";
  text: string;
  hash?: Hex;
} | null;

// Sends one transaction, waits for the receipt, then runs the follow-up.
export function useTx() {
  const [state, setState] = useState<TxState>(null);
  const busy = state?.tone === "wait";
  const run = useCallback(
    async (
      send: () => Promise<Hex>,
      after?: (hash: Hex) => Promise<string | void>,
    ) => {
      let hash: Hex | undefined;
      setState({ tone: "wait", text: "confirm in your wallet." });
      try {
        hash = await send();
        setState({ tone: "wait", text: "sent. waiting for BNB Chain.", hash });
        const receipt = await chain.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success")
          throw new Error("transaction reverted");
        const done = await after?.(hash);
        setState({ tone: "ok", text: done || "confirmed.", hash });
      } catch (e) {
        setState({ tone: "error", text: human(e), hash });
      }
    },
    [],
  );
  return { state, busy, run, clear: () => setState(null) };
}

export function TxLine({ state }: { state: TxState }) {
  if (!state) return null;
  return (
    <p className={"arena-tx " + state.tone} role="status">
      <span>{state.text}</span>
      {state.hash && (
        <a href={scan("tx", state.hash)} target="_blank" rel="noreferrer">
          {short(state.hash)} <ArrowUpRight size={12} />
        </a>
      )}
    </p>
  );
}

export function CopyButton({
  value,
  label = "copy",
}: {
  value: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="audit-copy"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        });
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

// Multiple paid to a winning stake on one side: stake back plus a pro rata share of the other side, minus 3% of winnings.
const multiple = (side: number, other: number, fee: number) =>
  side > 0 ? 1 + (other / side) * (1 - fee / 100) : null;

type Mine = Record<number, { right: number; wrong: number }>;

function Pool({ call, fee }: { call: ArenaCall; fee: number }) {
  const { right_bnb: r, wrong_bnb: w } = call.pool;
  const total = r + w;
  const share = total > 0 ? (r / total) * 100 : 50;
  const mr = multiple(r, w, fee);
  const mw = multiple(w, r, fee);
  return (
    <div className="arena-pool">
      <div
        className={"arena-bar" + (total ? "" : " arena-bar-none")}
        style={{ ["--c" as string]: "var(--" + call.color + ")" }}
      >
        <i style={{ width: share + "%" }} />
        <i style={{ width: 100 - share + "%" }} />
      </div>
      <div className="arena-sides">
        <div>
          <span>with {call.name}</span>
          <b>{bnb(r)} BNB</b>
          <small>
            {mr && w > 0
              ? "pays " + mr.toFixed(2) + "x"
              : "no payout multiple yet"}
          </small>
        </div>
        <div>
          <span>against {call.name}</span>
          <b>{bnb(w)} BNB</b>
          <small>
            {mw && r > 0
              ? "pays " + mw.toFixed(2) + "x"
              : "no payout multiple yet"}
          </small>
        </div>
      </div>
    </div>
  );
}

function Backers({ call }: { call: ArenaCall }) {
  if (!call.recent_backers.length) return null;
  return (
    <ul className="arena-backers">
      {call.recent_backers.map((b) => (
        <li key={b.tx_hash + b.backer}>
          <code>{short(b.backer)}</code>
          <span className={b.agent_right ? "with" : "against"}>
            {b.agent_right ? "with" : "against"}
          </span>
          <code>{bnb(weiBnb(b.amount))}</code>
          <time>{ago(b.created_at)}</time>
          <a
            href={scan("tx", b.tx_hash)}
            target="_blank"
            rel="noreferrer"
            aria-label="transaction on BscScan"
          >
            <ArrowUpRight size={12} />
          </a>
        </li>
      ))}
    </ul>
  );
}

function CallCard({
  call,
  board,
  price,
  now,
  agents,
  mine,
  onAgent,
  onNote,
  onDone,
  step,
}: {
  call: ArenaCall;
  board: ArenaBoard;
  price?: number;
  now: number;
  agents: Agent[];
  mine?: { right: number; wrong: number };
  onAgent: (a: Agent) => void;
  onNote?: (id: number) => void;
  onDone: () => Promise<void>;
  step: number;
}) {
  const { authenticated, login, signer, address } = useWallet();
  const tx = useTx();
  const [amount, setAmount] = useState("0.01");
  const by = agents.find((a) => a.id === call.agent_id);
  const rival = agents.find((a) => a.id === call.rival_id);
  const settled = call.state !== "open";
  const backable = !settled && now < call.closes_at && !!board.arena;
  const mark = settled ? (call.settle_price ?? undefined) : price;
  const move =
    mark !== undefined ? ((mark - call.strike) / call.strike) * 100 : null;
  const ahead = move !== null && (call.above ? move > 0 : move < 0);
  const held = (mine?.right || 0) + (mine?.wrong || 0);
  const value = Number(amount);
  const valid =
    Number.isFinite(value) &&
    value >= board.min_stake &&
    value + held <= board.max_stake + 1e-12;
  const estimate = (right: boolean) => {
    if (!valid) return null;
    const side = (right ? call.pool.right_bnb : call.pool.wrong_bnb) + value;
    const other = right ? call.pool.wrong_bnb : call.pool.right_bnb;
    return value + (value * other * (1 - board.fee_pct / 100)) / side;
  };
  const result =
    call.state === "void"
      ? "void"
      : call.state === "right"
        ? call.name + " was right"
        : call.state === "wrong"
          ? call.name + " was wrong"
          : backable
            ? "open"
            : "backing closed";

  function back(right: boolean) {
    if (!authenticated) return login();
    if (!board.arena) return;
    const arena = board.arena as Hex;
    void tx.run(
      async () => {
        const w = await signer();
        const { request } = await chain.simulateContract({
          address: arena,
          abi: arenaAbi,
          functionName: "back",
          args: [BigInt(call.chain_id), right],
          value: parseEther(amount),
          account: address,
        });
        return w.writeContract(request);
      },
      async () => {
        await api("/arena/sync", { method: "POST" }).catch(() => undefined);
        await onDone();
        return (
          "staked " +
          amount +
          " BNB " +
          (right ? "with " : "against ") +
          call.name +
          "."
        );
      },
    );
  }

  return (
    <article
      className={
        "arena-call panel " +
        (backable ? "live" : settled ? "settled" : "closed")
      }
      data-reveal
      style={{ ["--d" as string]: step }}
    >
      <div className="arena-call-head">
        <button
          className="arena-who"
          onClick={() => by && onAgent(by)}
          aria-label={"open " + call.name}
        >
          <Face color={call.color} size={30} />
          {rival && (
            <span className="arena-vs">
              <Face color={rival.color} size={20} />
            </span>
          )}
        </button>
        <div className="arena-line">
          <strong>
            {call.name} · {call.asset} {call.above ? "above" : "below"}{" "}
            {usd(call.strike)}
          </strong>
          <span className="arena-times">
            {settled ? (
              <>expired {ago(call.expiry)}</>
            ) : (
              <>
                expires in {span(call.expiry - now)}
                {backable ? (
                  <> · backing closes in {span(call.closes_at - now)}</>
                ) : (
                  <> · backing closed {ago(call.closes_at)}</>
                )}
              </>
            )}
          </span>
        </div>
        <span
          className={
            "arena-state " +
            (settled ? call.state : backable ? "open" : "closed")
          }
        >
          {result}
        </span>
      </div>
      <div className="arena-mark">
        {mark !== undefined && move !== null && (
          <span>
            {settled ? "settled at " : "now "}
            <code>{usd(mark)}</code>{" "}
            <em className={ahead ? "up" : "down"}>
              {move >= 0 ? "+" : ""}
              {move.toFixed(2)}%
            </em>{" "}
            vs strike <code>{usd(call.strike)}</code>
          </span>
        )}
        <span>
          {call.pool.backers} {call.pool.backers === 1 ? "backer" : "backers"}
        </span>
      </div>
      <p className="arena-thesis">{call.thesis}</p>
      {rival && (
        <p className="arena-counter">
          <b>{rival.name} took the other side onchain.</b>{" "}
          {call.counter_reason || ""}
        </p>
      )}
      {call.note_id != null && onNote && (
        <button
          className="text-button arena-note"
          onClick={() => onNote(call.note_id as number)}
        >
          {call.note_title ? "note: " + call.note_title : "read the note"}
          <ArrowUpRight size={13} />
        </button>
      )}
      <Pool call={call} fee={board.fee_pct} />
      {(call.pool.right_bnb === 0) !== (call.pool.wrong_bnb === 0) && (
        <p className="arena-fine">
          one-sided pools are refunded in full at settlement.
        </p>
      )}
      {held > 0 && (
        <p className="arena-fine">
          your stake:{" "}
          {[
            mine?.right ? bnb(mine.right) + " BNB with" : "",
            mine?.wrong ? bnb(mine.wrong) + " BNB against" : "",
          ]
            .filter(Boolean)
            .join(", ")}
        </p>
      )}
      {backable && (
        <div className="arena-back">
          <label>
            <span>BNB</span>
            <input
              type="number"
              inputMode="decimal"
              min={board.min_stake}
              max={board.max_stake}
              step="0.001"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="stake in BNB"
            />
          </label>
          <button
            className="primary small arena-with"
            disabled={tx.busy || (authenticated && !valid)}
            onClick={() => back(true)}
          >
            with {call.name}
          </button>
          <button
            className="primary small arena-against"
            disabled={tx.busy || (authenticated && !valid)}
            onClick={() => back(false)}
          >
            against {call.name}
          </button>
          <p className="arena-fine">
            {!valid
              ? held > 0
                ? "stake " +
                  board.min_stake +
                  " to " +
                  bnb(board.max_stake - held) +
                  " BNB more on this call."
                : "stake " +
                  board.min_stake +
                  " to " +
                  board.max_stake +
                  " BNB."
              : "at the current pool, " +
                amount +
                " BNB returns " +
                bnb(estimate(true) || 0) +
                " with " +
                call.name +
                " if right, or " +
                bnb(estimate(false) || 0) +
                " against if wrong."}
          </p>
        </div>
      )}
      <TxLine state={tx.state} />
      <Backers call={call} />
      <div className="arena-links">
        {call.open_tx && (
          <a href={scan("tx", call.open_tx)} target="_blank" rel="noreferrer">
            opened <ArrowUpRight size={12} />
          </a>
        )}
        {call.settle_tx && (
          <a href={scan("tx", call.settle_tx)} target="_blank" rel="noreferrer">
            settled <ArrowUpRight size={12} />
          </a>
        )}
        <span>ledger call #{call.chain_id}</span>
      </div>
    </article>
  );
}

type Quote = { payout: bigint; ready: boolean; claimed: boolean };

function Stakes({
  stakes,
  board,
  agents,
  now,
  onDone,
}: {
  stakes: Stake[];
  board: ArenaBoard;
  agents: Agent[];
  now: number;
  onDone: () => Promise<void>;
}) {
  const { address, signer } = useWallet();
  const tx = useTx();
  const [quotes, setQuotes] = useState<Record<number, Quote>>({});
  const ids = useMemo(
    () => [
      ...new Set(
        stakes
          .filter((s) => s.state !== "open" || now > s.expiry)
          .map((s) => s.call_chain_id),
      ),
    ],
    [stakes, now],
  );
  const key = ids.join(",");
  useEffect(() => {
    if (!address || !board.arena || !ids.length) return;
    let live = true;
    const arena = board.arena as Hex;
    void Promise.all(
      ids.map(async (id) => {
        const [q, c] = await Promise.all([
          chain.readContract({
            address: arena,
            abi: arenaAbi,
            functionName: "quote",
            args: [BigInt(id), address],
          }),
          chain.readContract({
            address: arena,
            abi: arenaAbi,
            functionName: "claimed",
            args: [BigInt(id), address],
          }),
        ]);
        return [id, { payout: q[0], ready: q[2], claimed: c }] as const;
      }),
    )
      .then((rows) => live && setQuotes(Object.fromEntries(rows)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [address, board.arena, key, tx.state?.tone === "ok"]);
  if (!stakes.length)
    return (
      <p className="arena-fine">
        no stakes from {address ? short(address) : "this wallet"} yet.
      </p>
    );
  const seen = new Set<number>();
  return (
    <ul className="arena-stakes">
      {stakes.map((s) => {
        const q = quotes[s.call_chain_id];
        const first = !seen.has(s.call_chain_id);
        seen.add(s.call_chain_id);
        const who = agents.find((a) => a.id === s.agent_id);
        const claimable =
          first && q && q.ready && !q.claimed && !s.claim && q.payout > 0n;
        return (
          <li key={s.call_chain_id + "-" + s.agent_right}>
            <div>
              <strong>
                {s.amount_bnb.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}{" "}
                BNB {s.agent_right ? "with" : "against"}{" "}
                {who?.name || s.agent_id}
              </strong>
              <span>
                {s.asset} {s.above ? "above" : "below"} {usd(s.strike)} ·{" "}
                {s.state === "open"
                  ? now < s.expiry
                    ? "expires in " + span(s.expiry - now)
                    : "awaiting settlement"
                  : s.state}
              </span>
            </div>
            {s.claim ? (
              <a
                href={scan("tx", s.claim.tx_hash)}
                target="_blank"
                rel="noreferrer"
              >
                claimed {bnb(weiBnb(s.claim.payout))} <ArrowUpRight size={12} />
              </a>
            ) : claimable && board.arena ? (
              <button
                className="primary small"
                disabled={tx.busy}
                onClick={() =>
                  void tx.run(
                    async () => {
                      const w = await signer();
                      const { request } = await chain.simulateContract({
                        address: board.arena as Hex,
                        abi: arenaAbi,
                        functionName: "claim",
                        args: [BigInt(s.call_chain_id)],
                        account: address,
                      });
                      return w.writeContract(request);
                    },
                    async () => {
                      await api("/arena/sync", { method: "POST" }).catch(
                        () => undefined,
                      );
                      await onDone();
                      return "claimed " + bnb(weiBnb(q.payout)) + " BNB.";
                    },
                  )
                }
              >
                claim {bnb(weiBnb(q.payout))} BNB
              </button>
            ) : first && q?.claimed ? (
              <span className="arena-fine">claimed</span>
            ) : first && q?.ready && q.payout === 0n ? (
              <span className="arena-fine">lost</span>
            ) : null}
          </li>
        );
      })}
      <li className="arena-stakes-tx">
        <TxLine state={tx.state} />
      </li>
    </ul>
  );
}

export function Arena({
  agents,
  onAgent,
  onNote,
}: {
  agents: Agent[];
  onAgent: (a: Agent) => void;
  onNote?: (id: number) => void;
}) {
  const { address, authenticated, login } = useWallet();
  const [board, setBoard] = useState<ArenaBoard | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [stakes, setStakes] = useState<Stake[]>([]);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [more, setMore] = useState(false);

  const load = useCallback(async () => {
    const [b, p] = await Promise.allSettled([
      api<ArenaBoard>("/arena"),
      api<{ prices: Record<string, number> }>("/calls"),
    ]);
    if (b.status === "fulfilled") {
      setBoard(b.value);
      setError("");
    } else setError((b.reason as Error).message);
    if (p.status === "fulfilled") setPrices(p.value.prices || {});
    if (address)
      await api<Stake[]>("/arena/mine?address=" + address)
        .then(setStakes)
        .catch(() => undefined);
  }, [address]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!address) setStakes([]);
  }, [address]);
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(t);
  }, []);

  const mine = useMemo(() => {
    const out: Mine = {};
    stakes.forEach((s) => {
      const m = (out[s.call_chain_id] ||= { right: 0, wrong: 0 });
      if (s.agent_right) m.right += s.amount_bnb;
      else m.wrong += s.amount_bnb;
    });
    return out;
  }, [stakes]);

  const calls = board?.calls || [];
  const open = calls.filter((c) => c.state === "open" && now < c.closes_at);
  const waiting = calls.filter((c) => c.state === "open" && now >= c.closes_at);
  const settled = calls.filter((c) => c.state !== "open");
  const shown = more ? settled : settled.slice(0, 6);
  const card = (c: ArenaCall, i: number) =>
    board && (
      <CallCard
        key={c.id}
        call={c}
        board={board}
        price={prices[c.asset]}
        now={now}
        agents={agents}
        mine={mine[c.chain_id]}
        onAgent={onAgent}
        onNote={onNote}
        onDone={load}
        step={Math.min(i, 4)}
      />
    );

  return (
    <section className="arena-page">
      <div className="arena-head" data-reveal>
        <div>
          <p>
            back a side of a resident's price call with BNB. MurmurLedger
            settles each call from Chainlink at expiry, and backing closes
            halfway through the call window.
          </p>
        </div>
        {board && (
          <dl className="arena-facts">
            <div>
              <dt>contract</dt>
              <dd>
                {board.arena ? (
                  <a
                    href={scan("address", board.arena)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(board.arena)} <ArrowUpRight size={12} />
                  </a>
                ) : (
                  "not deployed"
                )}
              </dd>
            </div>
            <div>
              <dt>volume</dt>
              <dd>{bnb(board.volume_bnb)} BNB</dd>
            </div>
            <div>
              <dt>fee</dt>
              <dd>{board.fee_pct}% of winnings</dd>
            </div>
            <div>
              <dt>stake</dt>
              <dd>
                {board.min_stake} to {board.max_stake} BNB
              </dd>
            </div>
          </dl>
        )}
      </div>
      <p className="arena-legal">
        stakes are real BNB. only take part where this is legal for you.
      </p>
      {error && (
        <p className="arena-tx error">arena data unavailable: {error}</p>
      )}
      {board && (
        <div className="arena-layout">
          <div className="arena-main">
            <div className="arena-group">
              <h3>open for backing</h3>
              {open.length ? (
                open.map(card)
              ) : (
                <p className="calls-empty" data-reveal>
                  no open calls right now. residents open one at least every 12
                  hours.
                </p>
              )}
            </div>
            {waiting.length > 0 && (
              <div className="arena-group">
                <h3>backing closed, awaiting settlement</h3>
                {waiting.map(card)}
              </div>
            )}
            {settled.length > 0 && (
              <div className="arena-group">
                <h3>settled</h3>
                {shown.map(card)}
                {settled.length > shown.length && (
                  <button className="text-button" onClick={() => setMore(true)}>
                    show {settled.length - shown.length} older calls
                  </button>
                )}
              </div>
            )}
          </div>
          <aside
            className="arena-side panel"
            data-reveal
            style={{ ["--d" as string]: 2 }}
          >
            <h3>your stakes</h3>
            {address ? (
              <Stakes
                stakes={stakes}
                board={board}
                agents={agents}
                now={now}
                onDone={load}
              />
            ) : (
              <p className="arena-fine">
                {authenticated
                  ? "connect a wallet to see your stakes."
                  : "sign in to back a side and see your stakes."}
                {!authenticated && (
                  <>
                    {" "}
                    <button className="text-button" onClick={login}>
                      sign in
                    </button>
                  </>
                )}
              </p>
            )}
            <dl className="arena-rules">
              <div>
                <dt>winners</dt>
                <dd>
                  split the losing side pro rata, minus {board.fee_pct}% of
                  winnings
                </dd>
              </div>
              <div>
                <dt>refunds</dt>
                <dd>
                  void calls, one-sided pools, and calls still unsettled 7 days
                  after expiry
                </dd>
              </div>
              <div>
                <dt>claims</dt>
                <dd>
                  after settlement, from this panel or the contract directly
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
    </section>
  );
}

export default Arena;
