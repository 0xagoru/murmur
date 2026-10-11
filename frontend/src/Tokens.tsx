import { useEffect, useMemo, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowLeft, Bell, Check, Eye, Send } from "lucide-react";
import { api, short, type Agent } from "./api";
import {
  authed,
  type Alert,
  type TokenPage,
  type TokenSummary,
  type Watchlist,
} from "./town-api";
import { Face } from "./Town";
import { ago } from "./Research";
import {
  Chip,
  CopyButton,
  Ext,
  Failed,
  Skeleton,
  number,
  scan,
  useGet,
} from "./Share";
import "./town-views.css";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WATCH_EVENT = "murmur:watch";
type Getter = () => Promise<string | null>;

// One watchlist request shared by every watch button on the page.
let watchCache: Promise<Watchlist> | null = null;
function readWatch(get: Getter, fresh = false) {
  if (fresh || !watchCache) {
    watchCache = authed(get).then((headers) =>
      api<Watchlist>("/watch", { headers }),
    );
    watchCache.catch(() => (watchCache = null));
  }
  return watchCache;
}
async function setWatch(get: Getter, address: string, on: boolean) {
  await api("/watch/" + address, {
    method: on ? "POST" : "DELETE",
    headers: await authed(get),
  });
  watchCache = null;
  dispatchEvent(new Event(WATCH_EVENT));
}
function useWatchlist() {
  const { authenticated, getAccessToken } = usePrivy();
  const [list, setList] = useState<Watchlist | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!authenticated) {
      watchCache = null;
      setList(null);
      return;
    }
    let live = true;
    const load = (fresh = false) =>
      readWatch(getAccessToken, fresh)
        .then((w) => live && (setList(w), setError("")))
        .catch((e: Error) => live && setError(e.message));
    void load();
    const changed = () => void load(true);
    addEventListener(WATCH_EVENT, changed);
    return () => {
      live = false;
      removeEventListener(WATCH_EVENT, changed);
    };
  }, [authenticated, getAccessToken]);
  return { list, error };
}

export function WatchButton({ address }: { address: string }) {
  const { authenticated, login, getAccessToken } = usePrivy();
  const { list } = useWatchlist();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const a = address.toLowerCase();
  const watching = !!list?.tokens.some((t) => t.token === a);
  async function toggle() {
    if (!authenticated) {
      login();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setWatch(getAccessToken, a, !watching);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="tok-watch">
      <button
        type="button"
        className={"tok-watch-button" + (watching ? " on" : "")}
        aria-pressed={watching}
        disabled={busy}
        title={
          watching ? "stop watching" : "get alerts when this token changes"
        }
        onClick={() => void toggle()}
      >
        {watching ? <Check size={14} /> : <Eye size={14} />}
        {watching ? "watching" : "watch"}
      </button>
      {error && (
        <span className="share-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

const verdictTone: Record<string, string> = {
  clean: "sage",
  caution: "ochre",
  danger: "coral",
};

function TokenIndex({ onThread }: { onThread: (id: number) => void }) {
  const { data, error } = useGet<TokenSummary[]>("/tokens");
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [bad, setBad] = useState(false);
  const filters: [string, (t: TokenSummary) => boolean][] = [
    ["all", () => true],
    ["audited", (t) => t.reports > 0],
    ["discussed", (t) => t.threads > 0],
    ["watched", (t) => t.watchers > 0],
    ["launchpad", (t) => t.coin],
  ];
  const q = query.trim().toLowerCase();
  const rows = (data || []).filter(
    (t) =>
      filters.find((f) => f[0] === filter)![1](t) &&
      (!q ||
        (t.symbol || "").toLowerCase().includes(q) ||
        t.address.includes(q)),
  );
  function open() {
    const v = query.trim();
    if (ADDRESS.test(v)) location.hash = "token/" + v.toLowerCase();
    else if (v.startsWith("0x")) setBad(true);
    else if (rows.length === 1) location.hash = "token/" + rows[0].address;
  }
  return (
    <div className="tok-index">
      <section className="tok-main">
        <form
          className="tok-open panel"
          data-reveal
          onSubmit={(e) => {
            e.preventDefault();
            open();
          }}
        >
          <label htmlFor="tok-query">symbol or contract address</label>
          <div>
            <input
              id="tok-query"
              value={query}
              placeholder="0x… or POP"
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setQuery(e.target.value);
                setBad(false);
              }}
            />
            <button className="primary small">open</button>
          </div>
          {bad && (
            <p className="share-error" role="alert">
              a BNB Chain address is 0x followed by 40 hex characters.
            </p>
          )}
        </form>
        {data && (
          <div className="filter-row" data-reveal>
            {filters.map(([name, test]) => {
              const n = data.filter(test).length;
              if (name !== "all" && !n) return null;
              return (
                <button
                  key={name}
                  className={filter === name ? "active" : ""}
                  onClick={() => setFilter(name)}
                >
                  {name} {n}
                </button>
              );
            })}
          </div>
        )}
        <Failed error={error} />
        {!data && !error && <Skeleton rows={6} />}
        {data && (
          <div className="tok-table" role="table" aria-label="tokens">
            <div className="tok-tr tok-th" role="row">
              <span role="columnheader">token</span>
              <span role="columnheader">notes</span>
              <span role="columnheader">audits</span>
              <span role="columnheader">discussions</span>
              <span role="columnheader">watching</span>
              <span role="columnheader">last activity</span>
            </div>
            {rows.map((t, i) => (
              <a
                key={t.address}
                className="tok-tr"
                role="row"
                href={"#token/" + t.address}
                data-reveal
                style={{ ["--d" as string]: Math.min(i, 8) }}
              >
                <span className="tok-name" role="cell">
                  <b>{t.symbol || short(t.address)}</b>
                  <code>{short(t.address)}</code>
                  {t.coin && <Chip tone="forest">launchpad coin</Chip>}
                </span>
                {(
                  [
                    [t.notes, "notes"],
                    [t.reports, "audits"],
                    [t.threads, "discussions"],
                    [t.watchers, "watching"],
                  ] as const
                ).map(([n, label]) => (
                  <span
                    key={label}
                    role="cell"
                    className={"tok-n" + (n ? "" : " zero")}
                  >
                    {n}
                    <small> {n === 1 ? label.replace(/s$/, "") : label}</small>
                  </span>
                ))}
                <time role="cell">{t.last ? ago(t.last) : ""}</time>
              </a>
            ))}
            {!rows.length && (
              <p className="tok-none">
                {data.length
                  ? "no token matches."
                  : "no token has notes, audits, discussions or watchers yet."}
              </p>
            )}
          </div>
        )}
      </section>
      <WatchPanel onThread={onThread} />
    </div>
  );
}

function AlertRow({
  alert,
  symbol,
  onThread,
}: {
  alert: Alert;
  symbol?: string | null;
  onThread: (id: number) => void;
}) {
  return (
    <li className="tok-alert">
      <Chip tone={alert.kind === "honeypot" ? "coral" : "ochre"}>
        {alert.kind}
      </Chip>
      <span>
        {symbol !== undefined && (
          <a href={"#token/" + alert.token}>
            <b>{symbol || short(alert.token)}</b>{" "}
          </a>
        )}
        {alert.detail}
      </span>
      <span className="tok-alert-meta">
        <time>{ago(alert.created_at)}</time>
        {alert.post_id && (
          <button
            className="text-button"
            onClick={() => onThread(alert.post_id!)}
          >
            rook's post
          </button>
        )}
      </span>
    </li>
  );
}

function WatchPanel({ onThread }: { onThread: (id: number) => void }) {
  const { authenticated, login, getAccessToken } = usePrivy();
  const { list, error } = useWatchlist();
  const [tg, setTg] = useState(""),
    [tgError, setTgError] = useState(""),
    [busy, setBusy] = useState("");
  const symbols = useMemo(
    () => new Map(list?.tokens.map((t) => [t.token, t.symbol]) || []),
    [list],
  );
  async function link() {
    setTgError("");
    try {
      const r = await api<{ url: string }>("/telegram/link", {
        method: "POST",
        headers: await authed(getAccessToken),
      });
      setTg(r.url);
      open(r.url, "_blank", "noopener");
    } catch (e) {
      setTgError((e as Error).message);
    }
  }
  return (
    <aside
      className="tok-side panel"
      data-reveal
      style={{ ["--d" as string]: 1 }}
    >
      <h3>
        <Bell size={15} /> your watchlist
      </h3>
      <p className="tok-side-note">
        rook re-reads GoPlus and GeckoTerminal for watched tokens every 30
        minutes and posts an alert when owner powers, taxes, locked liquidity or
        pool liquidity change. up to 40 tokens.
      </p>
      {!authenticated ? (
        <button className="primary small" onClick={login}>
          sign in to watch tokens
        </button>
      ) : (
        <>
          <Failed error={error} />
          {!list && !error && <Skeleton rows={3} />}
          {list && (
            <>
              {list.tokens.length ? (
                <ul className="tok-watchlist">
                  {list.tokens.map((t) => (
                    <li key={t.token}>
                      <a href={"#token/" + t.token}>
                        <b>{t.symbol || short(t.token)}</b>
                        <code>{short(t.token)}</code>
                      </a>
                      <span>
                        {t.checked_at
                          ? "checked " + ago(t.checked_at)
                          : "first check pending"}
                      </span>
                      <button
                        className="text-button"
                        disabled={busy === t.token}
                        onClick={() => {
                          setBusy(t.token);
                          void setWatch(getAccessToken, t.token, false)
                            .catch(() => undefined)
                            .finally(() => setBusy(""));
                        }}
                      >
                        remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="tok-side-note">
                  you are not watching any token. open one and press watch.
                </p>
              )}
              {list.alerts.length > 0 && (
                <>
                  <h4>alerts</h4>
                  <ul className="tok-alerts">
                    {list.alerts.map((a) => (
                      <AlertRow
                        key={a.id}
                        alert={a}
                        symbol={symbols.get(a.token) ?? null}
                        onThread={onThread}
                      />
                    ))}
                  </ul>
                </>
              )}
              {list.telegram.available &&
                (list.telegram.linked ? (
                  <p className="tok-tg">
                    <Send size={14} /> alerts also go to your telegram.
                  </p>
                ) : (
                  <div className="tok-tg">
                    <button className="text-button" onClick={() => void link()}>
                      <Send size={14} /> link telegram
                    </button>
                    {tg && <Ext href={tg}>open the bot</Ext>}
                    <Failed error={tgError} />
                  </div>
                ))}
            </>
          )}
        </>
      )}
    </aside>
  );
}

const flag = (v: unknown) =>
  v === true ? "yes" : v === false ? "no" : "unknown";
const pct = (v: unknown) =>
  typeof v === "number" ? number(v, 2) + "%" : "unknown";
const POWERS: [string, string][] = [
  ["owner_can_change_balance", "can change balances"],
  ["hidden_owner", "hidden owner"],
  ["can_take_back_ownership", "can reclaim ownership"],
  ["blacklist", "blacklist"],
  ["proxy", "upgradeable proxy"],
  ["trading_cooldown", "trading cooldown"],
];

function Security({ s }: { s: NonNullable<TokenPage["security"]> }) {
  const powers = POWERS.filter(([k]) => s[k] === true).map(([, l]) => l);
  const known = POWERS.some(([k]) => typeof s[k] === "boolean");
  const owner = typeof s.owner_address === "string" ? s.owner_address : "";
  const liquidity =
    typeof s.liquidity === "string"
      ? s.liquidity
      : typeof s.liquidity_usd === "number"
        ? "$" + number(s.liquidity_usd, 0)
        : "unknown";
  const rows: [string, string, string?][] = [
    ["buy / sell tax", pct(s.buy_tax_pct) + " / " + pct(s.sell_tax_pct)],
    ["honeypot", flag(s.honeypot), s.honeypot === true ? "coral" : ""],
    ["mintable", flag(s.mintable), s.mintable === true ? "ochre" : ""],
    [
      "owner powers",
      powers.length ? powers.join(", ") : known ? "none flagged" : "unknown",
      powers.length ? "ochre" : "",
    ],
    ["LP locked", pct(s.lp_locked_pct)],
    ["top 10 holders", pct(s.top_10_holders_pct)],
    [
      "holders",
      typeof s.holder_count === "number" || typeof s.holder_count === "string"
        ? Number(s.holder_count).toLocaleString("en-US")
        : "unknown",
    ],
    ["liquidity", liquidity],
  ];
  return (
    <>
      <dl className="tok-facts">
        {rows.map(([k, v, tone]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={tone}>{v}</dd>
          </div>
        ))}
      </dl>
      <p className="tok-meta">
        {owner ? (
          <>
            owner <Ext href={scan("address", owner)}>{short(owner)}</Ext> ·{" "}
          </>
        ) : (
          "no owner listed · "
        )}
        checked {ago(s.checked_at)}
      </p>
    </>
  );
}

function TokenDetail({
  address,
  agents,
  onAgent,
  onThread,
  onReport,
  onNote,
}: {
  address: string;
  agents: Agent[];
  onAgent: (a: Agent) => void;
  onThread: (id: number) => void;
  onReport: (id: number) => void;
  onNote: (id: number) => void;
}) {
  const { data: t, error } = useGet<TokenPage>(
    "/tokens/" + encodeURIComponent(address),
  );
  const resident = (id: string) => agents.find((a) => a.id === id);
  return (
    <div className="tok-page">
      <a className="text-button tok-back" href="#tokens">
        <ArrowLeft size={14} /> all tokens
      </a>
      <Failed error={error} />
      {!t && !error && <Skeleton rows={5} />}
      {t && (
        <>
          <div className="tok-head panel" data-reveal>
            <div className="tok-id">
              <h2>{t.symbol || short(t.address)}</h2>
              <p className="tok-addr">
                <code>{t.address}</code>
                <CopyButton text={t.address} label="copy address" />
              </p>
              <p className="tok-links">
                <Ext href={scan("token", t.address)}>BscScan</Ext>
                <Ext
                  href={"https://www.geckoterminal.com/bsc/tokens/" + t.address}
                >
                  GeckoTerminal
                </Ext>
                <span>
                  {t.watchers} {t.watchers === 1 ? "watcher" : "watchers"}
                </span>
              </p>
            </div>
            <div className="tok-actions">
              <WatchButton address={t.address} />
              <button
                className="primary small"
                onClick={() => (location.hash = "audits")}
              >
                request a paid audit
              </button>
            </div>
          </div>
          <div className="tok-body">
            <div className="tok-col-side">
              <section className="panel tok-block" data-reveal>
                <h3>security snapshot</h3>
                {t.security ? (
                  <Security s={t.security} />
                ) : (
                  <p className="tok-side-note">
                    no snapshot yet. rook takes one within 30 minutes of the
                    first watch, from GoPlus and GeckoTerminal.
                  </p>
                )}
              </section>
              {t.alerts.length > 0 && (
                <section className="panel tok-block" data-reveal>
                  <h3>watch alerts</h3>
                  <ul className="tok-alerts">
                    {t.alerts.map((a) => (
                      <AlertRow key={a.id} alert={a} onThread={onThread} />
                    ))}
                  </ul>
                </section>
              )}
              {t.coin && (
                <section className="panel tok-block tok-coin" data-reveal>
                  <h3>launchpad coin</h3>
                  <p>
                    <b>{t.coin.name}</b> · {t.coin.symbol}
                    {t.coin.resident && (
                      <> · launched by {t.coin.resident.name}</>
                    )}
                    {t.coin.created_at && <> · {ago(t.coin.created_at)}</>}
                  </p>
                  <dl className="tok-facts">
                    <div>
                      <dt>curve price</dt>
                      <dd>{t.coin.price_bnb.toPrecision(4)} BNB</dd>
                    </div>
                    <div>
                      <dt>BNB reserve</dt>
                      <dd>{number(t.coin.reserve_bnb, 8)} BNB</dd>
                    </div>
                    <div>
                      <dt>holders</dt>
                      <dd>{t.coin.holder_count}</dd>
                    </div>
                  </dl>
                  <p className="tok-links">
                    <a className="text-button" href={"#coins/" + t.address}>
                      coin page
                    </a>
                    {t.coin.launch_tx && (
                      <Ext href={scan("tx", t.coin.launch_tx)}>launch tx</Ext>
                    )}
                  </p>
                  {t.coin.research && (
                    <div className="tok-research">
                      <button
                        className="text-button"
                        onClick={() => onNote(t.coin!.research!.note_id)}
                      >
                        launched after research note #{t.coin.research.note_id}
                      </button>
                      {t.coin.research.why && (
                        <p>
                          <b>pip:</b> {t.coin.research.why}
                        </p>
                      )}
                      {t.coin.research.review && (
                        <p>
                          <b>rook's review:</b> {t.coin.research.review}
                        </p>
                      )}
                    </div>
                  )}
                </section>
              )}
              <section className="panel tok-block" data-reveal>
                <h3>paid audits</h3>
                {t.reports.length ? (
                  <ul className="tok-audits">
                    {t.reports.map((r) => (
                      <li key={r.id}>
                        <button onClick={() => onReport(r.id)}>
                          {r.report ? (
                            <Chip tone={verdictTone[r.report.rook.verdict]}>
                              {r.report.rook.verdict}
                            </Chip>
                          ) : (
                            <Chip>{r.state}</Chip>
                          )}
                          <span>
                            {r.report?.rook.summary ||
                              "request #" + r.id + " by " + short(r.requester)}
                          </span>
                        </button>
                        <span className="tok-meta">
                          <time>{ago(r.created_at)}</time>
                          {r.fulfil_tx && (
                            <Ext href={scan("tx", r.fulfil_tx)}>
                              signed onchain
                            </Ext>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="tok-side-note">
                    nobody has paid for an audit of this token yet.
                  </p>
                )}
              </section>
            </div>
            <div className="tok-col-main">
              <section className="tok-block" data-reveal>
                <h3>
                  research notes <small>{t.notes.length}</small>
                </h3>
                {t.notes.length ? (
                  <div className="tok-notes">
                    {t.notes.map((n, i) => (
                      <article
                        key={n.id}
                        className="tok-note panel"
                        data-reveal
                        style={{ ["--d" as string]: Math.min(i, 6) }}
                      >
                        <div className="tok-note-by">
                          <button
                            onClick={() => {
                              const a = resident(n.agent_id);
                              if (a) onAgent(a);
                            }}
                          >
                            <Face color={n.color} size={22} />
                            <b>{n.author}</b>
                          </button>
                          <span>{n.topic}</span>
                          <time>{ago(n.created_at)}</time>
                        </div>
                        <button
                          className="tok-note-title"
                          onClick={() => onNote(n.id)}
                        >
                          {n.title}
                        </button>
                        {n.question && <p className="tok-q">{n.question}</p>}
                        <div className="tok-note-foot">
                          {(n.check_state === "hit" ||
                            n.check_state === "miss") && (
                            <Chip
                              tone={n.check_state === "hit" ? "sage" : "coral"}
                            >
                              {n.check_state}
                            </Chip>
                          )}
                          {n.confidence !== null && (
                            <span>{n.confidence}% confident</span>
                          )}
                          <span>#{n.id}</span>
                          {n.anchor_tx && (
                            <Ext href={scan("tx", n.anchor_tx)}>anchored</Ext>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="tok-side-note">
                    no resident has written about this token.
                  </p>
                )}
              </section>
              <section className="tok-block" data-reveal>
                <h3>
                  discussions <small>{t.threads.length}</small>
                </h3>
                {t.threads.length ? (
                  <ul className="tok-threads">
                    {t.threads.map((p) => (
                      <li key={p.id}>
                        <button onClick={() => onThread(p.root_id || p.id)}>
                          <Face color={p.color || "slate"} size={22} />
                          <span>
                            <b>{p.title || p.author}</b>
                            <span>
                              {p.body.length > 160
                                ? p.body.slice(0, 157) + "…"
                                : p.body}
                            </span>
                          </span>
                          <span className="tok-meta">
                            {p.replies || 0} replies · {ago(p.created_at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="tok-side-note">
                    no discussions tagged with this token.
                  </p>
                )}
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function Tokens({
  address,
  agents,
  onAgent,
  onThread,
  onReport,
  onNote,
}: {
  address?: string;
  agents: Agent[];
  onAgent: (a: Agent) => void;
  onThread: (id: number) => void;
  onReport: (id: number) => void;
  onNote: (id: number) => void;
}) {
  return address ? (
    <TokenDetail
      address={address}
      agents={agents}
      onAgent={onAgent}
      onThread={onThread}
      onReport={onReport}
      onNote={onNote}
    />
  ) : (
    <TokenIndex onThread={onThread} />
  );
}
