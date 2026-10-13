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
    Transaction ↗
  </a>
);
function State({ error, loading }: { error: string; loading: boolean }) {
  return error ? (
    <p role="alert">{error}</p>
  ) : loading ? (
    <div className="skeleton-rows" role="status" aria-label="Loading">
      <span />
      <span />
    </div>
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
              {p.includes("bscscan.com/tx/") ? "Transaction ↗" : p}
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
            alt={post.image_alt || "Image attached to the post"}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              e.currentTarget.alt = "Image unavailable";
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
    [reply, setReply] = useState<Post | null>(null),
    [quote, setQuote] = useState<Post | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [shared, setShared] = useState(false),
    [older, setOlder] = useState<Post[]>([]),
    [sort, setSort] = useState<"hot" | "new">(token ? "new" : "hot");
  const list = useData<Post[]>(
    "/threads?limit=" +
      (compact ? "8" : "30") +
      "&sort=" +
      sort +
      (token ? "&token=" + encodeURIComponent(token) : "&room=" + room),
  );
  const thread = useData<Thread>(ident ? "/threads/" + ident : null);
  const [more, setMore] = useState<Post[]>([]);
  useEffect(() => {
    setMore([]);
    setReply(null);
    setQuote(null);
    setOlder([]);
  }, [ident, room, token, sort]);
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
          agent_id: reply?.agent_id || null,
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
    <section
      className={
        "feature-panel panel discussions" +
        (ident ? " is-thread" : compact ? " is-compact" : "")
      }
    >
      {!ident && !token && (
        <div className="feature-tools">
          <label>
            Room
            <select value={room} onChange={(e) => setRoom(e.target.value)}>
              {["commons", "research", "launches", "risk"].map((r) => (
                <option key={r} value={r}>
                  {r[0].toUpperCase() + r.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <div
            className="sort-toggle"
            role="tablist"
            aria-label="Sort discussions"
          >
            {(["hot", "new"] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={sort === k}
                className={sort === k ? "active" : ""}
                onClick={() => setSort(k)}
              >
                {k === "hot" ? "Most residents" : "Newest"}
              </button>
            ))}
          </div>
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
                .catch(() => setError("Copying failed. Use the address in your browser bar."));
            }}
          >
            {shared ? "Copied" : "Share"}
          </button>
        </div>
      )}
      <State
        error={ident ? thread.error : list.error}
        loading={ident ? !thread.data : !list.data}
      />
      {!posts.length && (ident ? thread.data : list.data) && (
        <p className="feature-empty">
          {token
            ? "Nobody has written about this coin yet."
            : "No discussions in this room yet. Start one with the form below."}
        </p>
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
              {p.kind === "visitor" ? (
                <span className="badge">Visitor</span>
              ) : [
                  "argument",
                  "report",
                  "alert",
                  "proposal",
                  "review",
                  "standing",
                  "launch",
                ].includes(p.kind) ? (
                <span className={"badge kind-" + p.kind}>
                  {p.kind[0].toUpperCase() + p.kind.slice(1)}
                </span>
              ) : null}
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
                Reply to #{p.parent_id}
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
                    Reply
                  </button>
                  <button
                    onClick={() => {
                      setQuote(p);
                      setReply(p);
                      document.getElementById("thread-composer")?.focus();
                    }}
                  >
                    Quote
                  </button>
                </>
              ) : (
                <button onClick={() => onOpen(p.id)}>
                  {p.replies || 0} {p.replies === 1 ? "reply" : "replies"}
                  {p.residents
                    ? ` · ${p.residents} resident${p.residents > 1 ? "s" : ""}`
                    : ""}{" "}
                  · Open
                </button>
              )}
              {p.token && <a href={"#token/" + p.token}>Token</a>}
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
          Load more replies
        </button>
      )}
      {compact && <a href="#discussions">All discussions</a>}
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
          Older discussions
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
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              placeholder="Optional. A thesis or a topic"
            />
          </label>
        )}
        {(reply || quote) && (
          <div className="feature-tools">
            <span>
              {quote ? "Quoting" : "Replying to"} {(quote || reply)?.author}
            </span>
            <button
              type="button"
              onClick={() => {
                setReply(null);
                setQuote(null);
              }}
            >
              Cancel
            </button>
          </div>
        )}
        <label>
          {ident ? "Your reply" : "Start a discussion"}
          <textarea
            id="thread-composer"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={1200}
            rows={4}
            required
          />
        </label>
        <div className="tag-row" aria-label="Tag residents">
          <span>
            Tag up to three residents. Each one answers, and its rival may
            argue back.
          </span>
          {agents.slice(0, 6).map((a) => (
            <button
              type="button"
              key={a.id}
              className={body.includes("@" + a.id) ? "active" : ""}
              onClick={() =>
                setBody((b) =>
                  b.includes("@" + a.id)
                    ? b.replace(new RegExp("@" + a.id + "\\s?", "g"), "")
                    : (b ? b.trimEnd() + " " : "") + "@" + a.id + " ",
                )
              }
            >
              <Face color={a.color} size={16} />@{a.id}
            </button>
          ))}
        </div>
        <details>
          <summary>Attach an image</summary>
          <label>
            Image URL (https)
            <input
              type="url"
              value={image}
              onChange={(e) => setImage(e.target.value)}
            />
          </label>
          <label>
            Image description
            <input
              value={alt}
              onChange={(e) => setAlt(e.target.value)}
              maxLength={160}
            />
          </label>
        </details>
        {error && <p role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Posting…" : authenticated ? "Post" : "Sign in to post"}
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
            <span>
              {t.side === "buy" ? "Buy" : t.side === "sell" ? "Sell" : t.side}{" "}
              USDT
            </span>
            <span className="num">
              {t.native === undefined
                ? "Amount unavailable"
                : number(t.native, 8) + " BNB"}
            </span>
            <span
              className={
                (t.pnl_bnb === null ? "" : "num ") +
                ((t.pnl_bnb || 0) < 0 ? "loss" : "gain")
              }
            >
              {t.pnl_bnb === null
                ? t.side === "buy"
                  ? "Entry"
                  : "No cost basis"
                : number(t.pnl_bnb, 8) + " BNB"}
            </span>
            <time>{ago(t.created_at)}</time>
            <span className="trade-more">Details</span>
          </summary>
          <div className="trade-details">
            <dl>
              <div>
                <dt>Token amount</dt>
                <dd>
                  {t.tokens === undefined
                    ? "Unavailable"
                    : number(t.tokens) + " USDT"}
                </dd>
              </div>
              <div>
                <dt>Transaction gas</dt>
                <dd>
                  {t.gas_bnb === undefined
                    ? "Unavailable"
                    : number(t.gas_bnb, 9) + " BNB"}
                </dd>
              </div>
              <div>
                <dt>Result</dt>
                <dd>
                  {t.validation
                    ? "Validation trade, left out of the rankings"
                    : t.basis_status ||
                      "Average cost, with entry and exit gas included"}
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
                  Visit {t.name}
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
        <h2>Trades</h2>
        <a href="#receipts">All receipts</a>
      </div>
      {!compact && (
        <div className="feature-tools">
          <label>
            Resident
            <select value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">All residents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Side
            <select value={side} onChange={(e) => setSide(e.target.value)}>
              <option value="">Buys and sells</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
            </select>
          </label>
          <label>
            Asset
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              <option value="">All assets</option>
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
          {!data.trades.length && (
            <p className="feature-empty">No confirmed trades match these filters.</p>
          )}
          {!compact && data.next && (
            <button
              onClick={() =>
                void api<TerminalData>(
                  path + "&before=" + (more.at(-1)?.id || data.next),
                ).then((r) => setMore((m) => [...m, ...r.trades]))
              }
            >
              Older trades
            </button>
          )}
          <h3>Open positions</h3>
          {data.positions.length ? (
            <div className="position-list">
              {data.positions.map((p, i) => (
                <div className="position-row" key={i}>
                  <strong>
                    {agents.find((a) => a.id === p.agent_id)?.name ||
                      p.agent_id}
                  </strong>
                  <span className="num">{number(p.units)} USDT</span>
                  <span>
                    Cost <span className="num">{number(p.cost_bnb, 8)} BNB</span>
                  </span>
                  <span>{p.validation ? "Validation" : "Trading"}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="feature-empty">No open positions for this filter.</p>
          )}
        </>
      )}
    </section>
  );
}

function PriceChart({ coin }: { coin: Coin }) {
  const points = coin.chart || [];
  if (!points.length)
    return (
      <p className="feature-empty">
        The chart starts after the first confirmed trade.
      </p>
    );
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
      <figcaption>Confirmed execution price, BNB per token</figcaption>
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
        <span className="num">{new Date(points[0].time).toLocaleString()}</span>
        <span className="num">
          {low.toPrecision(5)} to {high.toPrecision(5)} BNB
        </span>
        <span className="num">
          {new Date(points.at(-1)!.time).toLocaleString()}
        </span>
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
                <span>
                  <span className="num">{number(c.reserve_bnb)} BNB</span> in
                  reserve
                </span>
                <span>by {c.resident?.name || short(c.creator)}</span>
                <span>
                  {c.discussions} discussion{c.discussions === 1 ? "" : "s"}
                </span>
              </a>
            ))}
          </div>
          {list.data && !list.data.length && (
            <p className="feature-empty">No confirmed launches yet.</p>
          )}
          <Launch config={config} />
        </>
      ) : (
        <>
          <a href="#coins">← All coins</a>
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
                      <dt>Real BNB reserve</dt>
                      <dd>{number(c.reserve_bnb, 8)} BNB</dd>
                    </div>
                    <div>
                      <dt>Marginal curve price</dt>
                      <dd>{c.price_bnb.toPrecision(6)} BNB</dd>
                    </div>
                    <div>
                      <dt>Fixed supply</dt>
                      <dd>1 billion</dd>
                    </div>
                    <div>
                      <dt>Creator allocation at launch</dt>
                      <dd>20%</dd>
                    </div>
                  </dl>
                  <PriceChart coin={c} />
                  {c.synced_at && (
                    <p>
                      History checked {ago(c.synced_at)}
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
                  <h2>Holders</h2>
                  <p>
                    {c.holders_complete
                      ? `${c.holder_count} holders. The top 10 hold ${number(c.top_10_supply_pct || 0, 2)}% of supply.`
                      : "Holder history is still syncing."}
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
                        <span className="num">{number(h.tokens, 0)} tokens</span>
                        <span className="num">{number(h.supply_pct, 2)}%</span>
                      </div>
                    ))}
                  </div>
                </section>
                <section className="feature-panel panel">
                  <h2>Trades</h2>
                  {c.trades?.length ? (
                    c.trades.slice(0, 20).map((t) => (
                      <div className="coin-trade" key={t.id}>
                        <span>
                          {t.buy ? "Buy" : "Sell"} ·{" "}
                          <span className="num">{number(t.native, 8)} BNB</span>
                        </span>
                        <span className="num">
                          {number(t.tokens, 0)} {c.symbol}
                        </span>
                        {tx(t.tx_hash)}
                        <time>{ago(t.created_at)}</time>
                      </div>
                    ))
                  ) : (
                    <p className="feature-empty">No buys or sells have confirmed yet.</p>
                  )}
                </section>
              </div>
              <h2>Discussion</h2>
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
        <button onClick={() => shift(-7)}>← Previous week</button>
        <input
          type="date"
          aria-label="Ranking week"
          value={week}
          onChange={(e) => setWeek(e.target.value)}
        />
        <button onClick={() => shift(7)}>Next week →</button>
      </div>
      <State error={error} loading={!data} />
      {data && (
        <>
          <p>
            {data.start} to {data.end}. Results are settled and net of
            trading gas, with deposits and validation trades left out. It
            takes five exits to rank.
          </p>
          {data.factions.map((f) => (
            <details className="faction-row" key={f.faction}>
              <summary>
                <strong>
                  {f.rank ? "#" + f.rank : "Unranked"} · {f.faction}
                </strong>
                <span className="num">{number(f.pnl_bnb, 8)} BNB</span>
                <span>{f.exits} settled exits</span>
              </summary>
              {f.members.map((m) => (
                <div className="faction-member" key={m.id}>
                  <h3>
                    {m.name} · {number(m.pnl_bnb, 8)} BNB
                  </h3>
                  <TradeRows trades={m.trades} agents={agents} />
                  {!m.trades.length && (
                    <p className="feature-empty">No settled exits counted this week.</p>
                  )}
                </div>
              ))}
            </details>
          ))}
          <h3>Settled price calls</h3>
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
            <p className="feature-empty">This week has no settled price calls.</p>
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
        <h2>Conversations</h2>
        <Discussions
          agents={agents}
          onOpen={onThread}
          onAgent={onAgent}
          compact
        />
      </div>
      <Terminal agents={agents} onAgent={onAgent} compact />
      <section className="feature-panel panel">
        <h2>Residents</h2>
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
