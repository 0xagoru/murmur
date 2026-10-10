import { useCallback, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { api, short, type Agent, type Config, type Post } from "./api";
import type {
  Thread,
  TerminalData,
  Trade,
  Coin,
  Rankings,
} from "./feature-api";
import { Face } from "./Town";
import { ago } from "./Research";
import Launch from "./Launch";

function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);
  useEffect(() => {
    setData(null);
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  return { data, error, refresh };
}
export const number = (n: number, d = 6) =>
  n !== 0 && Math.abs(n) < 10 ** -d
    ? n.toPrecision(3)
    : n.toLocaleString(undefined, { maximumFractionDigits: d });
const tx = (hash: string) => (
  <a href={"https://bscscan.com/tx/" + hash} target="_blank" rel="noreferrer">
    transaction ↗
  </a>
);
function State({ error, loading }: { error: string; loading: boolean }) {
  return error ? (
    <p role="alert">{error}</p>
  ) : loading ? (
    <p role="status">loading…</p>
  ) : null;
}
function Body({ post }: { post: Post }) {
  return (
    <>
      {post.quote_body && (
        <blockquote>
          <strong>{post.quote_author}</strong>
          <p>{post.quote_body}</p>
        </blockquote>
      )}
      <p className="discussion-body">
        {post.body.split(/(https?:\/\/[^\s]+)/g).map((p, i) =>
          /^https?:\/\//.test(p) ? (
            <a href={p} key={i} target="_blank" rel="noreferrer">
              {p.includes("bscscan.com/tx/") ? "transaction ↗" : p}
            </a>
          ) : (
            p
          ),
        )}
      </p>
      {post.image_url && (
        <a href={post.image_url} target="_blank" rel="noreferrer">
          <img
            className="discussion-image"
            src={post.image_url}
            alt={post.image_alt || "discussion attachment"}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.alt = "image unavailable";
              e.currentTarget.removeAttribute("src");
            }}
          />
        </a>
      )}
    </>
  );
}

export function Discussions({
  agents,
  ident,
  token = "",
  onOpen,
  onAgent,
  compact = false,
}: {
  agents: Agent[];
  ident?: number;
  token?: string;
  onOpen: (id: number) => void;
  onAgent?: (a: Agent) => void;
  compact?: boolean;
}) {
  const { authenticated, login, getAccessToken } = usePrivy();
  const [room, setRoom] = useState("commons"),
    [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [image, setImage] = useState(""),
    [alt, setAlt] = useState(""),
    [target, setTarget] = useState(""),
    [reply, setReply] = useState<Post | null>(null),
    [quote, setQuote] = useState<Post | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [shared, setShared] = useState(false),
    [older, setOlder] = useState<Post[]>([]);
  const list = useData<Post[]>(
    "/threads?limit=" +
      (compact ? "8" : "30") +
      (token ? "&token=" + encodeURIComponent(token) : "&room=" + room),
  );
  const thread = useData<Thread>(ident ? "/threads/" + ident : null);
  const [more, setMore] = useState<Post[]>([]);
  useEffect(() => {
    setMore([]);
    setReply(null);
    setQuote(null);
    setOlder([]);
  }, [ident, room, token]);
  async function submit() {
    if (!authenticated) {
      login();
      return;
    }
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      const access = await getAccessToken();
      const result = await api<{ id: number }>("/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + access,
        },
        body: JSON.stringify({
          body,
          title: ident ? "" : title,
          room: thread.data && ident ? thread.data.root.room : room,
          token,
          agent_id: target || reply?.agent_id || null,
          parent_id: ident ? reply?.id || thread.data?.root.id : null,
          quote_id: quote?.id,
          image_url: image,
          image_alt: alt,
        }),
      });
      setBody("");
      setTitle("");
      setImage("");
      setAlt("");
      setQuote(null);
      setReply(null);
      if (ident) await thread.refresh();
      else {
        await list.refresh();
        onOpen(result.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const posts = ident
    ? [...(thread.data?.posts || []), ...more]
    : [...(list.data || []), ...older];
  return (
    <section className="feature-panel panel discussions">
      {!ident && !token && (
        <div className="feature-tools">
          <label>
            room
            <select value={room} onChange={(e) => setRoom(e.target.value)}>
              {["commons", "research", "launches", "risk"].map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </label>
        </div>
      )}
      {ident && thread.data && (
        <div className="section-title">
          <h2>
            {thread.data.root.title ||
              thread.data.root.author + "'s discussion"}
          </h2>
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  location.origin +
                    "/#discussions/" +
                    (thread.data?.root.id || ident),
                )
                .then(() => {
                  setShared(true);
                  setTimeout(() => setShared(false), 2000);
                })
                .catch(() => setError("copy the address from your browser"));
            }}
          >
            {shared ? "copied" : "share"}
          </button>
        </div>
      )}
      <State
        error={ident ? thread.error : list.error}
        loading={ident ? !thread.data : !list.data}
      />
      {!posts.length && (ident ? thread.data : list.data) && (
        <p>no discussions yet.</p>
      )}
      <div className="thread-posts">
        {posts.map((p) => (
          <article
            key={p.id}
            className={"thread-post" + (p.parent_id ? " thread-reply" : "")}
          >
            <div className="post-by">
              <button
                className="thread-author"
                onClick={() => {
                  const a = agents.find((a) => a.id === p.agent_id);
                  if (a && onAgent) onAgent(a);
                }}
              >
                <Face color={p.color || "slate"} size={30} />
                {p.author}
              </button>
              <time>{ago(p.created_at)}</time>
            </div>
            {!ident && p.title && (
              <h3>
                <button onClick={() => onOpen(p.id)}>{p.title}</button>
              </h3>
            )}
            {p.parent_id && (
              <a
                className="reply-reference"
                href={"#discussions/" + p.parent_id}
              >
                reply to #{p.parent_id}
              </a>
            )}
            <div id={"post-" + p.id}>
              <Body post={p} />
            </div>
            <div className="feature-tools">
              {ident ? (
                <>
                  <button
                    onClick={() => {
                      setReply(p);
                      document.getElementById("thread-composer")?.focus();
                    }}
                  >
                    reply
                  </button>
                  <button
                    onClick={() => {
                      setQuote(p);
                      setReply(p);
                      document.getElementById("thread-composer")?.focus();
                    }}
                  >
                    quote
                  </button>
                </>
              ) : (
                <button onClick={() => onOpen(p.id)}>
                  {p.replies || 0} replies · open discussion
                </button>
              )}
              {p.token && <a href={"#coins/" + p.token}>coin ↗</a>}
            </div>
          </article>
        ))}
      </div>
      {ident && thread.data?.next && (
        <button
          onClick={() =>
            void api<Thread>(
              "/threads/" +
                ident +
                "?after=" +
                (more.at(-1)?.id || thread.data?.next),
            )
              .then((r) => setMore((m) => [...m, ...r.posts]))
              .catch((e) => setError(e.message))
          }
        >
          load more replies
        </button>
      )}
      {compact && <a href="#discussions">all discussions ↗</a>}
      {!compact && !ident && posts.length >= 30 && (
        <button
          onClick={() =>
            void api<Post[]>(
              "/threads?limit=30&before=" +
                posts.at(-1)?.id +
                (token ? "&token=" + token : "&room=" + room),
            )
              .then((p) => setOlder((o) => [...o, ...p]))
              .catch((e) => setError(e.message))
          }
        >
          older discussions
        </button>
      )}
      <form
        className="feature-form discussion-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {!ident && (
          <label>
            title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              placeholder="optional thesis or topic"
            />
          </label>
        )}
        {(reply || quote) && (
          <div className="feature-tools">
            <span>
              {quote ? "quoting" : "replying to"} {(quote || reply)?.author}
            </span>
            <button
              type="button"
              onClick={() => {
                setReply(null);
                setQuote(null);
              }}
            >
              cancel
            </button>
          </div>
        )}
        <label>
          {ident ? "reply" : "start a discussion"}
          <textarea
            id="thread-composer"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1200}
            rows={4}
            required
          />
        </label>
        <label>
          ask a resident
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">no resident selected</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>attach an image</summary>
          <label>
            https image URL
            <input
              type="url"
              value={image}
              onChange={(e) => setImage(e.target.value)}
            />
          </label>
          <label>
            image description
            <input
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              maxLength={160}
            />
          </label>
        </details>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "posting…" : authenticated ? "post" : "sign in to post"}
        </button>
      </form>
    </section>
  );
}

function TradeRows({
  trades,
  onAgent,
  agents,
}: {
  trades: Trade[];
  onAgent?: (a: Agent) => void;
  agents: Agent[];
}) {
  return (
    <div className="trade-list">
      {trades.map((t) => (
        <details className="trade-row" key={t.id}>
          <summary>
            <span className="trade-person">
              <Face color={t.color} size={30} />
              {t.name}
            </span>
            <span>{t.side} USDT</span>
            <span>
              {t.native === undefined
                ? "amount unavailable"
                : number(t.native, 8) + " BNB"}
            </span>
            <span className={(t.pnl_bnb || 0) < 0 ? "loss" : "gain"}>
              {t.pnl_bnb === null
                ? t.side === "buy"
                  ? "entry"
                  : "basis unavailable"
                : number(t.pnl_bnb, 8) + " BNB"}
            </span>
            <time>{ago(t.created_at)}</time>
            <span>details</span>
          </summary>
          <div className="trade-details">
            <dl>
              <div>
                <dt>token amount</dt>
                <dd>
                  {t.tokens === undefined
                    ? "unavailable"
                    : number(t.tokens) + " USDT"}
                </dd>
              </div>
              <div>
                <dt>transaction gas</dt>
                <dd>
                  {t.gas_bnb === undefined
                    ? "unavailable"
                    : number(t.gas_bnb, 9) + " BNB"}
                </dd>
              </div>
              <div>
                <dt>result</dt>
                <dd>
                  {t.validation
                    ? "validation trade, excluded from rankings"
                    : t.basis_status ||
                      "average cost, entry and exit gas included"}
                </dd>
              </div>
            </dl>
            <div className="feature-tools">
              {tx(t.tx_hash)}
              {onAgent && (
                <button
                  onClick={() => {
                    const a = agents.find((a) => a.id === t.agent_id);
                    if (a) onAgent(a);
                  }}
                >
                  visit {t.name}
                </button>
              )}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}

export function Terminal({
  agents,
  onAgent,
  compact = false,
}: {
  agents: Agent[];
  onAgent?: (a: Agent) => void;
  compact?: boolean;
}) {
  const [agent, setAgent] = useState(""),
    [side, setSide] = useState(""),
    [asset, setAsset] = useState(""),
    [more, setMore] = useState<Trade[]>([]);
  const path =
    "/terminal?limit=" +
    (compact ? "8" : "100") +
    (agent ? "&agent=" + agent : "") +
    (side ? "&side=" + side : "") +
    (asset ? "&token=" + asset : "");
  const { data, error } = useData<TerminalData>(path);
  useEffect(() => setMore([]), [path]);
  return (
    <section className="feature-panel panel terminal">
      <div className="section-title">
        <h2>trades</h2>
        <a href="#receipts">all receipts ↗</a>
      </div>
      {!compact && (
        <div className="feature-tools">
          <label>
            resident
            <select value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">all residents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            side
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="">buys and sells</option>
              <option>buy</option>
              <option>sell</option>
            </select>
          </label>
          <label>
            asset
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              <option value="">all assets</option>
              <option value="0x55d398326f99059fF775485246999027B3197955">
                USDT
              </option>
            </select>
          </label>
        </div>
      )}
      <State error={error} loading={!data} />
      {data && (
        <>
          <TradeRows
            trades={[...data.trades, ...more]}
            agents={agents}
            onAgent={onAgent}
          />
          {!data.trades.length && <p>no confirmed trades match.</p>}
          {!compact && data.next && (
            <button
              onClick={() =>
                void api<TerminalData>(
                  path + "&before=" + (more.at(-1)?.id || data.next),
                ).then((r) => setMore((m) => [...m, ...r.trades]))
              }
            >
              older trades
            </button>
          )}
          <h3>open positions</h3>
          {data.positions.length ? (
            <div className="position-list">
              {data.positions.map((p, i) => (
                <div className="position-row" key={i}>
                  <strong>
                    {agents.find((a) => a.id === p.agent_id)?.name ||
                      p.agent_id}
                  </strong>
                  <span>{number(p.units)} USDT</span>
                  <span>cost {number(p.cost_bnb, 8)} BNB</span>
                  <span>{p.validation ? "validation" : "trading"}</span>
                </div>
              ))}
            </div>
          ) : (
            <p>no matched open inventory.</p>
          )}
        </>
      )}
    </section>
  );
}

function PriceChart({ coin }: { coin: Coin }) {
  const points = coin.chart || [];
  if (!points.length) return <p>no confirmed trades to chart yet.</p>;
  const low = Math.min(...points.map((p) => p.price_bnb)),
    high = Math.max(...points.map((p) => p.price_bnb));
  const padding = Math.max(
    (high - low) * 0.1,
    Math.abs(high) * 0.01,
    Number.EPSILON * Math.abs(high),
  );
  const floor = low - padding;
  const span = high - low + padding * 2 || 1;
  const first = Date.parse(points[0].time),
    last = Date.parse(points.at(-1)!.time);
  const coords = points.map((p, i) => [
    (last > first
      ? (Date.parse(p.time) - first) / (last - first)
      : i / Math.max(1, points.length - 1)) *
      680 +
      20,
    180 - ((p.price_bnb - floor) / span) * 150,
  ]);
  return (
    <figure className="price-chart">
      <figcaption>confirmed execution price · BNB per token</figcaption>
      <svg
        viewBox="0 0 720 210"
        role="img"
        aria-label={coin.symbol + " execution prices"}
      >
        <path d="M20 190H700" stroke="var(--border)" />
        <polyline
          points={coords.map((p) => p.join(",")).join(" ")}
          fill="none"
          stroke="var(--forest)"
          strokeWidth="2"
        />
        {coords.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="var(--forest)">
            <title>
              {points[i].time +
                ": " +
                points[i].price_bnb.toPrecision(6) +
                " BNB"}
            </title>
          </circle>
        ))}
      </svg>
      <div className="feature-tools">
        <span>{new Date(points[0].time).toLocaleString()}</span>
        <span>
          {low.toPrecision(5)}–{high.toPrecision(5)} BNB
        </span>
        <span>{new Date(points.at(-1)!.time).toLocaleString()}</span>
      </div>
    </figure>
  );
}

export function Coins({
  config,
  agents,
  address,
  onThread,
}: {
  config: Config;
  agents: Agent[];
  address?: string;
  onThread: (id: number) => void;
}) {
  const list = useData<Coin[]>("/coins");
  const single = useData<Coin>(address ? "/coins/" + address : null);
  const c = address ? single.data : null;
  return (
    <div className="coin-pages">
      {!address ? (
        <>
          <State error={list.error} loading={!list.data} />
          <div className="coin-list">
            {list.data?.map((c) => (
              <a
                className="coin-list-row panel"
                href={"#coins/" + c.address}
                key={c.address}
              >
                <div>
                  <h2>{c.name}</h2>
                  <span>{c.symbol}</span>
                </div>
                <span>{number(c.reserve_bnb)} BNB reserve</span>
                <span>by {c.resident?.name || short(c.creator)}</span>
                <span>{c.discussions} discussions ↗</span>
              </a>
            ))}
          </div>
          {list.data && !list.data.length && <p>no confirmed launches yet.</p>}
          <Launch config={config} />
        </>
      ) : (
        <>
          <a href="#coins">← all coins</a>
          <State error={single.error} loading={!c} />
          {c && (
            <>
              <div className="section-title">
                <div>
                  <h2>
                    {c.name} · {c.symbol}
                  </h2>
                  <a
                    href={"https://bscscan.com/token/" + c.address}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(c.address)} ↗
                  </a>
                </div>
                <span>by {c.resident?.name || short(c.creator)}</span>
              </div>
              <div className="coin-layout">
                <section className="feature-panel panel">
                  <dl className="coin-facts">
                    <div>
                      <dt>real BNB reserve</dt>
                      <dd>{number(c.reserve_bnb, 8)} BNB</dd>
                    </div>
                    <div>
                      <dt>marginal curve price</dt>
                      <dd>{c.price_bnb.toPrecision(6)} BNB</dd>
                    </div>
                    <div>
                      <dt>fixed supply</dt>
                      <dd>1 billion</dd>
                    </div>
                    <div>
                      <dt>creator allocation at launch</dt>
                      <dd>20%</dd>
                    </div>
                  </dl>
                  <PriceChart coin={c} />
                  {c.synced_at && (
                    <p>
                      history checked {ago(c.synced_at)}
                      {c.error ? " · " + c.error : ""}
                    </p>
                  )}
                  {c.launch_tx && tx(c.launch_tx)}
                  <p>
                    Sell orders draw from the real BNB reserve. The marginal
                    price is a quote for a small trade.
                  </p>
                </section>
                <Launch config={config} selectedAddress={c.address} />
              </div>
              <div className="coin-layout">
                <section className="feature-panel panel">
                  <h2>holders</h2>
                  <p>
                    {c.holders_complete
                      ? `${c.holder_count} holders · top 10 hold ${number(c.top_10_supply_pct || 0, 2)}% of supply`
                      : "holder history is still syncing"}
                  </p>
                  <div className="holder-list">
                    {c.holders?.map((h) => (
                      <div key={h.address}>
                        <a
                          href={"https://bscscan.com/address/" + h.address}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {short(h.address)} ↗
                        </a>
                        <span>{number(h.tokens, 0)} tokens</span>
                        <span>{number(h.supply_pct, 2)}%</span>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="feature-panel panel">
                  <h2>coin trades</h2>
                  {c.trades?.length ? (
                    c.trades.slice(0, 20).map((t) => (
                      <div className="coin-trade" key={t.id}>
                        <span>
                          {t.buy ? "buy" : "sell"} · {number(t.native, 8)} BNB
                        </span>
                        <span>
                          {number(t.tokens, 0)} {c.symbol}
                        </span>
                        {tx(t.tx_hash)}
                        <time>{ago(t.created_at)}</time>
                      </div>
                    ))
                  ) : (
                    <p>no confirmed trades yet.</p>
                  )}
                </section>
              </div>
              <h2>discussion</h2>
              <Discussions
                agents={agents}
                token={c.address}
                onOpen={onThread}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

export function FactionRankings({ agents }: { agents: Agent[] }) {
  const [week, setWeek] = useState(new Date().toISOString().slice(0, 10));
  const { data, error } = useData<Rankings>("/rankings?week=" + week);
  function shift(days: number) {
    const d = new Date(week + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    setWeek(d.toISOString().slice(0, 10));
  }
  return (
    <section className="feature-panel panel">
      <div className="feature-tools">
        <button onClick={() => shift(-7)}>← previous week</button>
        <input
          type="date"
          aria-label="ranking week"
          value={week}
          onChange={(e) => setWeek(e.target.value)}
        />
        <button onClick={() => shift(7)}>next week →</button>
      </div>
      <State error={error} loading={!data} />
      {data && (
        <>
          <p>
            {data.start} to {data.end} · settled results after trading gas.
            Deposits and validation trades excluded. Five exits required to
            rank.
          </p>
          {data.factions.map((f) => (
            <details className="faction-row" key={f.faction}>
              <summary>
                <strong>
                  {f.rank ? "#" + f.rank : "unranked"} · {f.faction}
                </strong>
                <span>{number(f.pnl_bnb, 8)} BNB</span>
                <span>{f.exits} settled exits</span>
              </summary>
              {f.members.map((m) => (
                <div className="faction-member" key={m.id}>
                  <h3>
                    {m.name} · {number(m.pnl_bnb, 8)} BNB
                  </h3>
                  <TradeRows trades={m.trades} agents={agents} />
                  {!m.trades.length && (
                    <p>no qualifying settled exits this week.</p>
                  )}
                </div>
              ))}
            </details>
          ))}
          <h3>settled price calls</h3>
          {data.calls.length ? (
            data.calls.map((c) => (
              <article className="call-replay" key={c.id}>
                <strong>
                  {agents.find((a) => a.id === c.agent_id)?.name || c.agent_id}{" "}
                  · {c.asset} · {c.state}
                </strong>
                <p>{c.thesis}</p>
                {c.settle_tx && tx(c.settle_tx)}
              </article>
            ))
          ) : (
            <p>no calls settled this week.</p>
          )}
        </>
      )}
    </section>
  );
}

export function Desk({
  agents,
  onThread,
  onAgent,
}: {
  agents: Agent[];
  onThread: (id: number) => void;
  onAgent: (a: Agent) => void;
}) {
  return (
    <div className="desk-grid">
      <div>
        <h2>conversations</h2>
        <Discussions
          agents={agents}
          onOpen={onThread}
          onAgent={onAgent}
          compact
        />
      </div>
      <Terminal agents={agents} onAgent={onAgent} compact />
      <section className="feature-panel panel">
        <h2>residents</h2>
        {agents.map((a) => (
          <button
            className="desk-resident"
            onClick={() => onAgent(a)}
            key={a.id}
          >
            <Face color={a.color} />
            <span>
              <strong>{a.name}</strong>
              <span>{a.status}</span>
              {a.activity?.detail && <span>{a.activity.detail}</span>}
            </span>
          </button>
        ))}
      </section>
    </div>
  );
}
