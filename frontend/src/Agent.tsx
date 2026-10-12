import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowUpRight } from "lucide-react";
import { parseAbi } from "viem";
import { api, short } from "./api";
import { authed, type ReportList, type ResearchRequest } from "./town-api";
import { chain, CopyButton, scan, TxLine, useTx, useWallet } from "./Arena";
import "./arena.css";
import "./agent.css";

type Hex = `0x${string}`;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const identityAbi = parseAbi([
  "function register(string agentURI) returns (uint256 agentId)",
]);
const reputationAbi = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
]);

interface AgentStatus {
  identity: {
    agent_id: number | null;
    owner: string | null;
    tx: string | null;
    registry: string;
    agent_registry: string;
  };
  owner_wallet: string | null;
  agent_uri: string;
  card: string;
  a2a: string;
  mcp: string;
  category: string;
  purpose: string;
  fee_bnb: number;
  contracts: Record<string, string>;
  hires: { requests: number; fulfilled: number; wallets: number };
  reputation: {
    ratings: number;
    average: number | null;
    clients: number;
  } | null;
  reputation_registry: string;
  uptime: { checks_24h: number; passed_pct: number } | null;
}
interface Market {
  market: string;
  supplied_usd: number;
  borrowed_usd: number;
}
interface Position {
  account: string;
  health_factor: number | null;
  state: string;
  supplied_usd: number;
  borrowed_usd: number;
  vai_debt: number;
  borrow_limit_usd: number;
  markets: Market[];
  block: number;
  source: string;
}
interface Watched {
  account: string;
  threshold: number;
  last_factor: number | null;
  last_state: string | null;
  last_checked: string | null;
}
const usd = (n: number) =>
  "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 });

function Register({
  status,
  onDone,
}: {
  status: AgentStatus;
  onDone: () => void;
}) {
  const { authenticated, login, address, signer } = useWallet();
  const tx = useTx();
  const owner = status.owner_wallet;
  const isOwner = !!owner && address?.toLowerCase() === owner.toLowerCase();
  if (status.identity.agent_id !== null) return null;
  return (
    <div className="agent-register">
      <h3>Register on ERC-8004</h3>
      <p>
        The agent is minted in the ERC-8004 identity registry on BNB Chain,
        with its registration file as the agentURI. Whichever wallet sends the
        transaction owns the agent.
      </p>
      {!owner ? (
        <p className="arena-fine">
          The server has no owner wallet set yet (MURMUR_AGENT_OWNER).
        </p>
      ) : !authenticated ? (
        <button className="primary" onClick={login}>
          Sign in with {short(owner)}
        </button>
      ) : !isOwner ? (
        <p className="arena-fine">
          Connected as {short(address || "")}. Registration has to come from{" "}
          {short(owner)}.
        </p>
      ) : (
        <button
          className="primary"
          disabled={tx.busy}
          onClick={() =>
            void tx.run(
              async () => {
                const w = await signer();
                const { request } = await chain.simulateContract({
                  address: status.identity.registry as Hex,
                  abi: identityAbi,
                  functionName: "register",
                  args: [status.agent_uri],
                  account: address,
                });
                return w.writeContract(request);
              },
              async (hash) => {
                const r = await api<AgentStatus["identity"]>("/agent/claim", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ tx_hash: hash }),
                });
                onDone();
                return "Registered as agent #" + r.agent_id + ".";
              },
            )
          }
        >
          Register the research desk
        </button>
      )}
      <TxLine state={tx.state} />
    </div>
  );
}

function Rate({ status }: { status: AgentStatus }) {
  const { address } = useWallet();
  const [mine, setMine] = useState<ResearchRequest[]>([]);
  const [score, setScore] = useState<Record<number, number>>({});
  const agentId = status.identity.agent_id;
  useEffect(() => {
    if (!address) return;
    void api<ReportList>("/reports?requester=" + address)
      .then((r) => setMine(r.requests.filter((q) => q.state === "done")))
      .catch(() => undefined);
  }, [address]);
  if (agentId === null || !address || !mine.length) return null;
  return (
    <div className="agent-rate">
      <h3>Rate your audits</h3>
      <p>
        Your wallet writes the rating to the ERC-8004 reputation registry,
        tagged with the report hash.
      </p>
      <ul>
        {mine.map((q) => (
          <li key={q.id}>
            <a href={"#report/" + q.id}>
              {q.report?.symbol || "#" + q.id} <ArrowUpRight size={11} />
            </a>
            <span className="agent-stars">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  className={(score[q.id] || 0) >= n ? "on" : ""}
                  onClick={() => setScore((s) => ({ ...s, [q.id]: n }))}
                  aria-label={n + " out of 5"}
                >
                  {n}
                </button>
              ))}
            </span>
            <SendRating
              agentId={agentId}
              request={q}
              value={(score[q.id] || 0) * 20}
              registry={status.reputation_registry}
              endpoint={status.a2a}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function SendRating({
  agentId,
  request,
  value,
  registry,
  endpoint,
}: {
  agentId: number;
  request: ResearchRequest;
  value: number;
  registry: string;
  endpoint: string;
}) {
  const { address, signer } = useWallet();
  const tx = useTx();
  return (
    <>
      <button
        className="primary small"
        disabled={!value || tx.busy}
        onClick={() =>
          void tx.run(
            async () => {
              const w = await signer();
              const { request: call } = await chain.simulateContract({
                address: registry as Hex,
                abi: reputationAbi,
                functionName: "giveFeedback",
                args: [
                  BigInt(agentId),
                  BigInt(value),
                  0,
                  "audit",
                  request.report?.rook.verdict || "",
                  endpoint,
                  "https://murmuragents.io/#report/" + request.id,
                  (request.report_hash ||
                    "0x0000000000000000000000000000000000000000000000000000000000000000") as Hex,
                ],
                account: address,
              });
              return w.writeContract(call);
            },
            async () => "Rating recorded onchain.",
          )
        }
      >
        Send rating
      </button>
      <TxLine state={tx.state} />
    </>
  );
}

function Lending({ initial }: { initial?: string }) {
  const { authenticated, login, getAccessToken } = usePrivy();
  const [input, setInput] = useState(initial || "");
  const [pos, setPos] = useState<Position | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [threshold, setThreshold] = useState("1.2");
  const [watched, setWatched] = useState<Watched[]>([]);
  const valid = ADDRESS.test(input.trim());
  const loadWatched = useCallback(async () => {
    if (!authenticated) return setWatched([]);
    try {
      setWatched(
        await api<Watched[]>("/lending", {
          headers: await authed(getAccessToken),
        }),
      );
    } catch {
      setWatched([]);
    }
  }, [authenticated, getAccessToken]);
  useEffect(() => void loadWatched(), [loadWatched]);
  const read = useCallback(async (a: string) => {
    setBusy(true);
    setError("");
    try {
      setPos(await api<Position>("/lending/" + a));
      history.replaceState(null, "", "#lending/" + a);
    } catch (e) {
      setPos(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (initial && ADDRESS.test(initial)) {
      setInput(initial);
      void read(initial);
    }
  }, [initial, read]);
  async function watch() {
    if (!authenticated) return login();
    if (!pos) return;
    try {
      await api("/lending/watch/" + pos.account, {
        method: "POST",
        headers: {
          ...(await authed(getAccessToken)),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ threshold: Number(threshold) }),
      });
      await loadWatched();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function unwatch(a: string) {
    await api("/lending/watch/" + a, {
      method: "DELETE",
      headers: await authed(getAccessToken),
    });
    await loadWatched();
  }
  const f = pos?.health_factor;
  return (
    <section
      className="agent-lending panel"
      data-reveal
      style={{ ["--d" as string]: 2 }}
    >
      <h2>Venus health factor</h2>
      <p>
        This reads a wallet's Venus Core Pool position straight from the
        Comptroller. Collateral is weighted by each market's collateral factor,
        then divided by debt with VAI included. Below 1.0 the position can be
        liquidated.
      </p>
      <form
        className="audit-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) void read(input.trim());
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Wallet 0x…"
          aria-label="Wallet address"
          spellCheck={false}
          autoComplete="off"
        />
        <button className="primary" disabled={!valid || busy}>
          {busy ? "Reading" : "Read position"}
        </button>
      </form>
      {error && <p className="arena-tx error">{error}</p>}
      {pos && (
        <div className="agent-position">
          <div className={"agent-hf " + pos.state.replace(" ", "-")}>
            <span>Health factor</span>
            <strong>{f == null ? "No debt" : f.toFixed(3)}</strong>
            <small>{pos.state}</small>
          </div>
          <dl>
            <div>
              <dt>Supplied</dt>
              <dd>{usd(pos.supplied_usd)}</dd>
            </div>
            <div>
              <dt>Borrowed</dt>
              <dd>{usd(pos.borrowed_usd + pos.vai_debt)}</dd>
            </div>
            <div>
              <dt>Borrow limit</dt>
              <dd>{usd(pos.borrow_limit_usd)}</dd>
            </div>
            <div>
              <dt>Block</dt>
              <dd>{pos.block.toLocaleString("en-US")}</dd>
            </div>
          </dl>
          {pos.markets.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>Market</th>
                  <th>Supplied</th>
                  <th>Borrowed</th>
                </tr>
              </thead>
              <tbody>
                {pos.markets.map((m) => (
                  <tr key={m.market}>
                    <td>{m.market}</td>
                    <td>{usd(m.supplied_usd)}</td>
                    <td>{usd(m.borrowed_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="agent-watch">
            <label>
              Alert below
              <input
                type="number"
                step="0.05"
                min="1.05"
                max="3"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </label>
            <button className="primary small" onClick={() => void watch()}>
              {authenticated ? "Watch this position" : "Sign in to watch"}
            </button>
            <a
              href={pos.source}
              target="_blank"
              rel="noreferrer"
              className="text-button"
            >
              Comptroller <ArrowUpRight size={12} />
            </a>
          </div>
          <p className="arena-fine">
            Watched positions are checked every ten minutes. Alerts go to the
            Telegram chat linked on the tokens page.
          </p>
        </div>
      )}
      {watched.length > 0 && (
        <div className="agent-watched">
          <h3>Your watched positions</h3>
          <ul>
            {watched.map((w) => (
              <li key={w.account}>
                <button
                  className="text-button"
                  onClick={() => {
                    setInput(w.account);
                    void read(w.account);
                  }}
                >
                  {short(w.account)}
                </button>
                <span>
                  {w.last_factor === null
                    ? "Not checked yet"
                    : w.last_factor.toFixed(3)}
                </span>
                <span>Alert below {w.threshold.toFixed(2)}</span>
                <button
                  className="audit-copy"
                  onClick={() => void unwatch(w.account)}
                  aria-label="Stop watching"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function Agent({ route }: { route: string }) {
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(
    () =>
      api<AgentStatus>("/agent")
        .then(setStatus)
        .catch((e) => setError((e as Error).message)),
    [],
  );
  useEffect(() => void load(), [load]);
  const lendingAddress = route.startsWith("lending/")
    ? route.split("/")[1]
    : undefined;
  if (error) return <p className="arena-tx error">{error}</p>;
  if (!status)
    return (
      <div className="skeleton-rows" role="status" aria-label="Loading">
        <span />
        <span />
        <span />
      </div>
    );
  const id = status.identity;
  const links: [string, string][] = [
    ["Agent card (A2A)", status.card],
    ["Registration file", status.agent_uri],
    ["A2A endpoint", status.a2a],
    ["MCP endpoint", status.mcp],
  ];
  return (
    <div className="agent-page">
      <section className="agent-id panel" data-reveal>
        <h2>
          {id.agent_id !== null
            ? "Agent #" + id.agent_id
            : "Not registered yet"}
        </h2>
        <p>{status.purpose}</p>
        <dl className="agent-facts">
          <div>
            <dt>Category</dt>
            <dd>{status.category}</dd>
          </div>
          <div>
            <dt>Registry</dt>
            <dd>
              <a
                href={scan("address", id.registry)}
                target="_blank"
                rel="noreferrer"
              >
                ERC-8004 {short(id.registry)} <ArrowUpRight size={11} />
              </a>
            </dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>
              {id.owner ? (
                <a
                  href={scan("address", id.owner)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(id.owner)} <ArrowUpRight size={11} />
                </a>
              ) : (
                "Pending"
              )}
            </dd>
          </div>
          {id.tx && (
            <div>
              <dt>Registered in</dt>
              <dd>
                <a href={scan("tx", id.tx)} target="_blank" rel="noreferrer">
                  {short(id.tx)} <ArrowUpRight size={11} />
                </a>
              </dd>
            </div>
          )}
        </dl>
        <Register status={status} onDone={() => void load()} />
      </section>
      <section
        className="agent-hire panel"
        data-reveal
        style={{ ["--d" as string]: 1 }}
      >
        <h2>Hire the desk</h2>
        <p>
          Pay {status.fee_bnb} BNB to MurmurDesk along with a token address. rook
          audits the contract and pip reads its liquidity and holders. The
          report hash is then published onchain. If no report is written within
          a day, you can refund yourself.
        </p>
        <a className="primary" href="#audits">
          Request an audit
        </a>
        <dl className="agent-facts">
          <div>
            <dt>Hires</dt>
            <dd className="num">{status.hires.requests}</dd>
          </div>
          <div>
            <dt>Delivered</dt>
            <dd className="num">{status.hires.fulfilled}</dd>
          </div>
          <div>
            <dt>Distinct wallets</dt>
            <dd className="num">{status.hires.wallets}</dd>
          </div>
          <div>
            <dt>Rating</dt>
            <dd>
              {status.reputation?.ratings
                ? (status.reputation.average ?? 0).toFixed(0) +
                  "/100 from " +
                  status.reputation.ratings
                : "None yet"}
            </dd>
          </div>
          <div>
            <dt>Uptime, 24h</dt>
            <dd>
              {status.uptime ? status.uptime.passed_pct + "%" : "Starting"}
            </dd>
          </div>
        </dl>
        <ul className="agent-links">
          {links.map(([label, url]) => (
            <li key={label}>
              <span>{label}</span>
              <code>{url.replace("https://", "")}</code>
              <CopyButton value={url} label={"Copy " + label} />
            </li>
          ))}
        </ul>
        <Rate status={status} />
      </section>
      <Lending initial={lendingAddress} />
    </div>
  );
}
