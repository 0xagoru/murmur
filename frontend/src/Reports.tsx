import { useCallback, useEffect, useState } from "react";
import { keccak256, parseAbi, recoverMessageAddress, toHex } from "viem";
import { ArrowUpRight } from "lucide-react";
import { api, short } from "./api";
import type { ReportList, ResearchRequest, Report } from "./town-api";
import { ago } from "./Research";
import {
  bnb,
  chain,
  CopyButton,
  scan,
  span,
  TxLine,
  useTx,
  useWallet,
} from "./Arena";
import "./arena.css";

type Hex = `0x${string}`;

const deskAbi = parseAbi([
  "function request(address token) payable returns (uint256)",
  "function fee() view returns (uint256)",
  "function refund(uint256 id)",
  "event Requested(uint256 indexed id, address indexed requester, address indexed token, uint256 paid)",
]);

type Verdict = Report["rook"]["verdict"];
const tone: Record<Verdict, string> = {
  clean: "sage",
  caution: "ochre",
  danger: "coral",
};

export function VerdictChip({ verdict }: { verdict?: string }) {
  if (!verdict) return null;
  return (
    <span className={"audit-verdict " + (tone[verdict as Verdict] || "")}>
      {verdict}
    </span>
  );
}

const pending = (state: ResearchRequest["state"]) =>
  state === "open" || state === "working";
const since = (iso: string) =>
  Math.max(0, (Date.now() - Date.parse(iso)) / 1000);

// Same encoding as python's json.dumps(sort_keys=True, separators=(",", ":")): sorted keys, no spaces, ASCII escapes.
function pyJson(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NaN";
  if (typeof v === "string")
    return JSON.stringify(v).replace(
      /[\u007f-￿]/g,
      (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
    );
  if (Array.isArray(v)) return "[" + v.map(pyJson).join(",") + "]";
  const o = v as Record<string, unknown>;
  return (
    "{" +
    Object.keys(o)
      .sort()
      .map((k) => pyJson(k) + ":" + pyJson(o[k]))
      .join(",") +
    "}"
  );
}

const yesNo = (v: unknown) =>
  v === true ? "yes" : v === false ? "no" : "not available";
const pct = (v: unknown) => (typeof v === "number" ? v + "%" : "not available");
const text = (v: unknown) =>
  v === null || v === undefined || v === ""
    ? "not available"
    : typeof v === "number"
      ? v.toLocaleString("en-US")
      : String(v);

type PoolRow = {
  pool?: string;
  liquidity?: string;
  volume_24h?: string;
  url?: string;
};

function DataTable({ report }: { report: Report }) {
  const g = report.data.goplus || {};
  const m = report.data.geckoterminal || {};
  const powers = (
    [
      ["owner_can_change_balance", "change balances"],
      ["hidden_owner", "hidden owner"],
      ["can_take_back_ownership", "reclaim ownership"],
      ["blacklist", "blacklist"],
      ["trading_cooldown", "trading cooldown"],
      ["proxy", "upgradeable proxy"],
    ] as const
  )
    .filter(([k]) => g[k] === true)
    .map(([, label]) => label);
  const known = (
    [
      "owner_can_change_balance",
      "hidden_owner",
      "can_take_back_ownership",
    ] as const
  ).some((k) => typeof g[k] === "boolean");
  const contract: [string, string][] = [
    ["buy / sell tax", pct(g.buy_tax_pct) + " / " + pct(g.sell_tax_pct)],
    ["honeypot", yesNo(g.honeypot)],
    ["mintable", yesNo(g.mintable)],
    [
      "owner powers",
      powers.length
        ? powers.join(", ")
        : known
          ? "none found"
          : "not available",
    ],
    [
      "owner",
      typeof g.owner_address === "string" && g.owner_address
        ? short(g.owner_address)
        : "none listed",
    ],
    ["source verified", yesNo(g.open_source)],
    ["holders", text(g.holder_count)],
    ["top 10 holders", pct(g.top_10_holders_pct)],
    ["creator holds", pct(g.creator_pct)],
    ["LP locked", pct(g.lp_locked_pct)],
  ];
  const market: [string, string][] = [
    [
      "price",
      typeof m.price_usd === "number"
        ? "$" + m.price_usd.toPrecision(4)
        : "not available",
    ],
    ["liquidity", text(m.total_liquidity)],
    ["volume 24h", text(m.volume_24h)],
    ["market cap", text(m.market_cap)],
    ["fdv", text(m.fdv)],
  ];
  const pools = (Array.isArray(m.pools) ? m.pools : []) as PoolRow[];
  return (
    <div className="audit-data">
      <div>
        <h4>contract, GoPlus</h4>
        <dl>
          {contract.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <h4>market, GeckoTerminal</h4>
        {m.known === false ? (
          <p className="arena-fine">
            GeckoTerminal has no pools for this token.
          </p>
        ) : (
          <dl>
            {market.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {pools.length > 0 && (
          <ul className="audit-pools">
            {pools.map((p, i) => (
              <li key={(p.url || "") + i}>
                {p.url ? (
                  <a href={p.url} target="_blank" rel="noreferrer">
                    {p.pool || "pool"} <ArrowUpRight size={11} />
                  </a>
                ) : (
                  <span>{p.pool || "pool"}</span>
                )}
                <code>{p.liquidity || "?"}</code>
                <code>{p.volume_24h ? p.volume_24h + " 24h" : ""}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Verify({ r }: { r: ResearchRequest }) {
  const [hashOk, setHashOk] = useState(false);
  const [recovered, setRecovered] = useState<string | null>(null);
  const signature = r.signature
    ? ((r.signature.startsWith("0x") ? r.signature : "0x" + r.signature) as Hex)
    : null;
  useEffect(() => {
    if (!r.report || !r.report_hash) return;
    try {
      setHashOk(
        keccak256(toHex(pyJson(r.report))).toLowerCase() ===
          r.report_hash.toLowerCase(),
      );
    } catch {
      setHashOk(false);
    }
    if (signature)
      void recoverMessageAddress({
        message: { raw: r.report_hash as Hex },
        signature,
      })
        .then(setRecovered)
        .catch(() => setRecovered(null));
  }, [r.report_hash, signature]);
  const signerOk =
    !!recovered &&
    !!r.signer &&
    recovered.toLowerCase() === r.signer.toLowerCase();
  return (
    <section className="audit-verify">
      <h3>verification</h3>
      <dl>
        <div>
          <dt>report hash</dt>
          <dd>
            <code>
              {r.report_hash ? short(r.report_hash) : "not computed yet"}
            </code>
            {r.report_hash && (
              <CopyButton value={r.report_hash} label="copy report hash" />
            )}
            {hashOk && (
              <span className="audit-ok">
                recomputed in your browser, matches
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>scribe signer</dt>
          <dd>
            {r.signer ? (
              <a
                href={scan("address", r.signer)}
                target="_blank"
                rel="noreferrer"
              >
                {short(r.signer)} <ArrowUpRight size={12} />
              </a>
            ) : (
              "not listed"
            )}
          </dd>
        </div>
        <div>
          <dt>signature</dt>
          <dd>
            <code>
              {signature
                ? signature.slice(0, 12) + "…" + signature.slice(-8)
                : "none"}
            </code>
            {signature && (
              <CopyButton value={signature} label="copy signature" />
            )}
            {signerOk && (
              <span className="audit-ok">recovers to the scribe</span>
            )}
            {recovered && r.signer && !signerOk && (
              <span className="audit-bad">recovers to {short(recovered)}</span>
            )}
          </dd>
        </div>
        <div>
          <dt>MurmurDesk</dt>
          <dd>
            {r.fulfil_tx ? (
              <a
                href={scan("tx", r.fulfil_tx)}
                target="_blank"
                rel="noreferrer"
              >
                fulfil tx {short(r.fulfil_tx)} <ArrowUpRight size={12} />
              </a>
            ) : r.desk ? (
              <a
                href={scan("address", r.desk)}
                target="_blank"
                rel="noreferrer"
              >
                {short(r.desk)}, fulfil tx not sent yet{" "}
                <ArrowUpRight size={12} />
              </a>
            ) : (
              "not deployed"
            )}
          </dd>
        </div>
      </dl>
      <p className="arena-fine">
        recompute keccak256 of the report JSON (sorted keys, no spaces) and
        compare with the Fulfilled event.
      </p>
    </section>
  );
}

function Share({ r }: { r: ResearchRequest }) {
  const url = "https://murmuragents.io/r/" + r.id;
  const words = r.report
    ? r.report.symbol +
      " audit on murmur: " +
      r.report.rook.verdict +
      ". hashed and published on BNB Chain."
    : "murmur report #" + r.id;
  return (
    <section className="audit-share">
      <img
        src={"/api/share/report/" + r.id + ".png"}
        alt={"share card for report " + r.id}
        loading="lazy"
        onError={(e) => (e.currentTarget.style.visibility = "hidden")}
      />
      <div>
        <h3>share</h3>
        <p className="audit-url">
          <code>{url.replace("https://", "")}</code>
          <CopyButton value={url} label="copy link" />
        </p>
        <a
          className="text-button"
          href={
            "https://x.com/intent/post?text=" +
            encodeURIComponent(words) +
            "&url=" +
            encodeURIComponent(url)
          }
          target="_blank"
          rel="noreferrer"
        >
          post on X <ArrowUpRight size={13} />
        </a>
      </div>
    </section>
  );
}

function ReportPage({
  ident,
  onToken,
  onThread,
}: {
  ident: number;
  onToken?: (address: string) => void;
  onThread?: (id: number) => void;
}) {
  const [r, setR] = useState<ResearchRequest | null>(null);
  const [error, setError] = useState("");
  const [, tick] = useState(0);
  const { address, authenticated, login, signer } = useWallet();
  const tx = useTx();
  const load = useCallback(async () => {
    try {
      setR(await api<ResearchRequest>("/reports/" + ident));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [ident]);
  useEffect(() => {
    setR(null);
    void load();
  }, [load]);
  const working = !r || pending(r.state);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => {
      void load();
      tick((n) => n + 1);
    }, 10000);
    return () => clearInterval(t);
  }, [working, load]);

  if (!r)
    return (
      <section className="audit-page">
        <a className="text-button" href="#audits">
          all reports
        </a>
        {error && <p className="arena-tx error">{error}</p>}
      </section>
    );
  const rep = r.report;
  const mineToRefund =
    pending(r.state) &&
    since(r.created_at) > 86400 &&
    !!address &&
    address.toLowerCase() === r.requester.toLowerCase();
  const flags = rep?.rook.flags || [];
  return (
    <section className="audit-page">
      <a className="text-button" href="#audits">
        all reports
      </a>
      <div className="audit-title" data-reveal>
        <div>
          <h2>
            {rep ? rep.symbol : "report"} <span>#{r.id}</span>
          </h2>
          <p>
            <button
              className="text-button"
              onClick={() => onToken?.(r.token)}
              disabled={!onToken}
            >
              <code>{short(r.token)}</code>
            </button>
            <CopyButton value={r.token} label="copy token address" />
            <span>
              requested by <code>{short(r.requester)}</code> · paid{" "}
              {bnb(r.paid_bnb)} BNB · {ago(r.created_at)}
            </span>
            {r.request_tx && (
              <a
                href={scan("tx", r.request_tx)}
                target="_blank"
                rel="noreferrer"
              >
                request tx <ArrowUpRight size={12} />
              </a>
            )}
          </p>
        </div>
        {rep && <VerdictChip verdict={rep.rook.verdict} />}
      </div>

      {pending(r.state) && (
        <div className="audit-progress panel" data-reveal>
          <div className="audit-steps">
            <span className="done">paid</span>
            <span className={r.state === "working" ? "now" : ""}>
              rook and pip reading
            </span>
            <span>signed and published</span>
          </div>
          <p>
            rook and pip are working on it. {span(since(r.created_at))} since
            the request.
            {r.error ? " last attempt: " + r.error + "." : ""}
          </p>
          {mineToRefund && (
            <p>
              no report after 24 hours. you can refund {bnb(r.paid_bnb)} BNB
              yourself.{" "}
              <button
                className="primary small"
                disabled={tx.busy}
                onClick={() => {
                  if (!authenticated) return login();
                  if (!r.desk) return;
                  void tx.run(
                    async () => {
                      const w = await signer();
                      const { request } = await chain.simulateContract({
                        address: r.desk as Hex,
                        abi: deskAbi,
                        functionName: "refund",
                        args: [BigInt(r.id)],
                        account: address,
                      });
                      return w.writeContract(request);
                    },
                    async () => {
                      await load();
                      return "refunded. the page updates once the indexer reads the event.";
                    },
                  );
                }}
              >
                refund
              </button>
            </p>
          )}
          <TxLine state={tx.state} />
        </div>
      )}

      {(r.state === "refunded" || r.state === "failed") && (
        <div className="audit-progress panel">
          <p>
            {r.state === "refunded" ? "refunded" : "failed"}
            {r.error ? ": " + r.error : ""}.
          </p>
          {r.refund_tx && (
            <a
              className="text-button"
              href={scan("tx", r.refund_tx)}
              target="_blank"
              rel="noreferrer"
            >
              refund tx {short(r.refund_tx)} <ArrowUpRight size={12} />
            </a>
          )}
        </div>
      )}

      {rep && (
        <div className="audit-body">
          <div className="audit-read">
            <section data-reveal>
              <h3>rook, contract</h3>
              {flags.length > 0 && (
                <ol className="audit-flags">
                  {flags.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ol>
              )}
              <p>{rep.rook.summary}</p>
            </section>
            <section data-reveal style={{ ["--d" as string]: 1 }}>
              <h3>pip, liquidity and holders</h3>
              <p>{rep.pip.summary}</p>
              {rep.pip.watch && (
                <p className="audit-watch">
                  <b>watch</b> {rep.pip.watch}
                </p>
              )}
            </section>
            <section data-reveal style={{ ["--d" as string]: 2 }}>
              <DataTable report={rep} />
              <p className="audit-sources">
                {rep.sources.filter(Boolean).map((s) => (
                  <a key={s} href={s} target="_blank" rel="noreferrer">
                    {new URL(s).hostname.replace("www.", "")}{" "}
                    <ArrowUpRight size={11} />
                  </a>
                ))}
                {r.post_id != null && onThread && (
                  <button
                    className="text-button"
                    onClick={() => onThread(r.post_id as number)}
                  >
                    discussion <ArrowUpRight size={12} />
                  </button>
                )}
              </p>
            </section>
          </div>
          <aside
            className="audit-aside"
            data-reveal
            style={{ ["--d" as string]: 2 }}
          >
            <Verify r={r} />
            {r.state === "done" && <Share r={r} />}
          </aside>
        </div>
      )}
    </section>
  );
}

function Desk({ onToken }: { onToken?: (address: string) => void }) {
  const [list, setList] = useState<ReportList | null>(null);
  const [fee, setFee] = useState<bigint | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const { authenticated, login, signer, address } = useWallet();
  const tx = useTx();
  const valid = /^0x[0-9a-fA-F]{40}$/.test(token.trim());
  const load = useCallback(async () => {
    try {
      setList(await api<ReportList>("/reports"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 30000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!list?.desk) return;
    void chain
      .readContract({
        address: list.desk as Hex,
        abi: deskAbi,
        functionName: "fee",
      })
      .then(setFee)
      .catch(() => undefined);
  }, [list?.desk]);
  const feeBnb = fee !== null ? Number(fee) / 1e18 : (list?.fee_bnb ?? null);

  function submit() {
    if (!authenticated) return login();
    if (!list?.desk || fee === null || !valid) return;
    const desk = list.desk as Hex;
    const target = token.trim() as Hex;
    void tx.run(
      async () => {
        const code = await chain.getCode({ address: target });
        if (!code || code === "0x") throw new Error("not a contract");
        const w = await signer();
        const { request } = await chain.simulateContract({
          address: desk,
          abi: deskAbi,
          functionName: "request",
          args: [target],
          value: fee,
          account: address,
        });
        return w.writeContract(request);
      },
      async (hash) => {
        for (let i = 0; i < 6; i++) {
          try {
            const { ids } = await api<{ ids: number[] }>("/reports/claim", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tx_hash: hash }),
            });
            if (ids.length) {
              location.hash = "report/" + ids[0];
              return "request #" + ids[0] + " confirmed.";
            }
          } catch {
            await new Promise((ok) => setTimeout(ok, 2500));
          }
        }
        return "paid. the request shows in the list below within a minute.";
      },
    );
  }

  const requests = list?.requests || [];
  return (
    <section className="audit-page">
      <div className="audit-desk">
        <div className="audit-ask" data-reveal>
          <h2>token reports</h2>
          <p>
            rook audits the contract with GoPlus data, pip reads liquidity and
            holders from GeckoTerminal. the report is hashed, signed and
            published to MurmurDesk on BNB Chain. if no report is written within
            a day you can refund yourself.
          </p>
          <form
            className="audit-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="token contract 0x…"
              aria-label="token contract address"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              className="primary"
              disabled={tx.busy || (authenticated && (!valid || fee === null))}
            >
              {authenticated
                ? "pay " + (feeBnb !== null ? feeBnb : "…") + " BNB and request"
                : "sign in to request"}
            </button>
          </form>
          {token && !valid && (
            <p className="arena-fine">
              a BNB Chain contract address is 0x followed by 40 hex characters.
            </p>
          )}
          <TxLine state={tx.state} />
          {list && (
            <p className="arena-fine">
              MurmurDesk{" "}
              {list.desk ? (
                <a
                  href={scan("address", list.desk)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(list.desk)} <ArrowUpRight size={11} />
                </a>
              ) : (
                "not deployed"
              )}{" "}
              · fee {feeBnb ?? "?"} BNB, read from the contract ·{" "}
              {requests.filter((q) => q.state === "done").length} published
            </p>
          )}
          {error && <p className="arena-tx error">{error}</p>}
        </div>
        <div
          className="audit-list"
          data-reveal
          style={{ ["--d" as string]: 1 }}
        >
          <h3>recent requests</h3>
          {list && !requests.length && (
            <p className="calls-empty">
              no requests yet. the first report will show here.
            </p>
          )}
          <ul>
            {requests.map((q) => (
              <li key={q.id}>
                <a href={"#report/" + q.id}>
                  <span className="audit-sym">
                    {q.report?.symbol || "#" + q.id}
                  </span>
                  <VerdictChip verdict={q.report?.rook.verdict} />
                  {!q.report && (
                    <span className={"audit-state " + q.state}>{q.state}</span>
                  )}
                  <code>{short(q.token)}</code>
                  <time>{ago(q.created_at)}</time>
                </a>
                {onToken && (
                  <button
                    className="audit-copy"
                    aria-label="open token page"
                    onClick={() => onToken(q.token)}
                  >
                    <ArrowUpRight size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Audits({
  ident,
  onToken,
  onThread,
}: {
  ident?: number;
  onToken?: (address: string) => void;
  onThread?: (id: number) => void;
}) {
  return ident !== undefined && Number.isFinite(ident) ? (
    <ReportPage ident={ident} onToken={onToken} onThread={onThread} />
  ) : (
    <Desk onToken={onToken} />
  );
}

export default Audits;
