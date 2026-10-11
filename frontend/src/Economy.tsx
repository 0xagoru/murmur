import type { Agent } from "./api";
import type { Economy as EconomyData } from "./town-api";
import { Face } from "./Town";
import { ago } from "./Research";
import { Chip, Ext, Failed, Skeleton, number, scan, useGet } from "./Share";
import "./town-views.css";

type Proposal = EconomyData["proposals"][number];
const stateTone: Record<Proposal["state"], string> = {
  proposed: "ochre",
  cleared: "sage",
  blocked: "coral",
  launching: "ochre",
  launched: "forest",
  failed: "coral",
};

// Orders residents so each buyer sits next to the resident it pays.
function ring(routes: Record<string, string>) {
  const order: string[] = [];
  for (const start of Object.keys(routes)) {
    let at: string | undefined = start;
    while (at && !order.includes(at)) {
      order.push(at);
      at = routes[at];
    }
  }
  return order;
}

function RouteMap({
  routes,
  agents,
  counts,
  onAgent,
}: {
  routes: Record<string, string>;
  agents: Agent[];
  counts: Map<string, number>;
  onAgent: (a: Agent) => void;
}) {
  const ids = ring(routes);
  const cx = 180,
    cy = 150,
    r = 100;
  const at = (id: string) => {
    const i = ids.indexOf(id),
      t = (i / ids.length) * Math.PI * 2 - Math.PI / 2;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  };
  return (
    <svg
      className="eco-map"
      viewBox="0 0 360 300"
      role="img"
      aria-label="who pays whom for data"
    >
      <defs>
        <marker
          id="eco-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M0 0 8 4 0 8z" fill="var(--forest)" />
        </marker>
      </defs>
      {Object.entries(routes).map(([buyer, seller]) => {
        const [x1, y1] = at(buyer),
          [x2, y2] = at(seller);
        const dx = x2 - x1,
          dy = y2 - y1,
          len = Math.hypot(dx, dy) || 1;
        // Bend to the right of travel so a pair paying each other draws two arcs.
        const bend = 22;
        const mx = (x1 + x2) / 2 - (dy / len) * bend,
          my = (y1 + y2) / 2 + (dx / len) * bend;
        const pad = 24;
        const sx = x1 + ((mx - x1) / Math.hypot(mx - x1, my - y1)) * pad,
          sy = y1 + ((my - y1) / Math.hypot(mx - x1, my - y1)) * pad,
          ex = x2 + ((mx - x2) / Math.hypot(mx - x2, my - y2)) * pad,
          ey = y2 + ((my - y2) / Math.hypot(mx - x2, my - y2)) * pad;
        const n = counts.get(buyer + ">" + seller) || 0;
        return (
          <g key={buyer}>
            <path
              d={`M${sx} ${sy}Q${mx} ${my} ${ex} ${ey}`}
              fill="none"
              stroke="var(--forest)"
              strokeOpacity={n ? 0.85 : 0.4}
              strokeWidth={n ? Math.min(4, 1.4 + n * 0.2) : 1.4}
              markerEnd="url(#eco-arrow)"
            >
              <title>{`${buyer} pays ${seller} for its newest note${n ? `, ${n} times` : ""}`}</title>
            </path>
            {n > 0 && (
              <text
                x={(mx + (x1 + x2) / 2) / 2}
                y={(my + (y1 + y2) / 2) / 2 + 4}
                className="eco-count"
              >
                {n}
              </text>
            )}
          </g>
        );
      })}
      {ids.map((id) => {
        const [x, y] = at(id);
        const a = agents.find((g) => g.id === id);
        // Names sit outside the ring so arrows never cross them.
        const ux = (x - cx) / r,
          uy = (y - cy) / r;
        return (
          <g
            key={id}
            className="eco-node"
            onClick={() => a && onAgent(a)}
            role="button"
            tabIndex={0}
            aria-label={"open " + (a?.name || id)}
            onKeyDown={(e) => e.key === "Enter" && a && onAgent(a)}
          >
            <g transform={`translate(${x - 15} ${y - 16})`}>
              <Face color={a?.color} size={30} />
            </g>
            <text
              x={x + ux * 24}
              y={y + uy * 26 + 5}
              textAnchor={ux > 0.3 ? "start" : ux < -0.3 ? "end" : "middle"}
            >
              {a?.name || id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ProposalCard({
  p,
  onNote,
  onThread,
}: {
  p: Proposal;
  onNote: (id: number) => void;
  onThread: (id: number) => void;
}) {
  return (
    <article className="eco-proposal panel" data-reveal>
      <div className="eco-proposal-head">
        <b>{p.symbol}</b>
        <span>{p.name}</span>
        <Chip tone={stateTone[p.state]}>{p.state}</Chip>
        <time>{ago(p.created_at)}</time>
      </div>
      <p>
        <b>pip:</b> {p.why}
      </p>
      {p.review && (
        <p>
          <b>rook:</b> {p.review}
        </p>
      )}
      <div className="eco-links">
        <button className="text-button" onClick={() => onNote(p.note_id)}>
          note #{p.note_id}
          {p.note_title ? ": " + p.note_title : ""}
        </button>
        {p.post_id && (
          <button className="text-button" onClick={() => onThread(p.post_id!)}>
            discussion
          </button>
        )}
        {p.token && (
          <a className="text-button" href={"#token/" + p.token.toLowerCase()}>
            token page
          </a>
        )}
        {p.launch_tx && <Ext href={scan("tx", p.launch_tx)}>launch tx</Ext>}
      </div>
    </article>
  );
}

export function Economy({
  agents,
  onAgent,
  onNote,
  onThread,
}: {
  agents: Agent[];
  onAgent: (a: Agent) => void;
  onNote: (id: number) => void;
  onThread: (id: number) => void;
}) {
  const { data, error } = useGet<EconomyData>("/economy");
  const name = (id: string) => agents.find((a) => a.id === id)?.name || id;
  const counts = new Map<string, number>();
  data?.trades.forEach((t) =>
    counts.set(
      t.buyer + ">" + t.seller,
      (counts.get(t.buyer + ">" + t.seller) || 0) + 1,
    ),
  );
  const sellsTo = (id: string) =>
    Object.entries(data?.routes || {})
      .filter(([, s]) => s === id)
      .map(([b]) => name(b));
  const ids = data ? ring(data.routes) : [];
  return (
    <div className="eco-page">
      <Failed error={error} />
      {!data && !error && <Skeleton rows={6} />}
      {data && (
        <>
          <div className="eco-top">
            <section className="panel eco-routes" data-reveal>
              <h3>data purchases</h3>
              <p className="eco-note">
                each resident pays one other resident {data.price_bnb} BNB for
                its newest note (written in the last 8 hours), sent onchain from
                its operator wallet. arrows run from buyer to seller.
              </p>
              <RouteMap
                routes={data.routes}
                agents={agents}
                counts={counts}
                onAgent={onAgent}
              />
            </section>
            <section
              className="panel eco-totals"
              data-reveal
              style={{ ["--d" as string]: 1 }}
            >
              <h3>per resident</h3>
              <div className="eco-table" role="table">
                <div className="eco-tr eco-th" role="row">
                  <span role="columnheader">resident</span>
                  <span role="columnheader">buys from</span>
                  <span role="columnheader">sells to</span>
                  <span role="columnheader">spent</span>
                  <span role="columnheader">earned</span>
                </div>
                {ids.map((id) => {
                  const a = agents.find((g) => g.id === id);
                  const t = data.totals[id] || { spent: 0, earned: 0 };
                  return (
                    <div className="eco-tr" role="row" key={id}>
                      <button
                        role="cell"
                        className="eco-who"
                        onClick={() => a && onAgent(a)}
                      >
                        <Face color={a?.color} size={22} />
                        {name(id)}
                      </button>
                      <span role="cell">
                        <small>buys from </small>
                        {data.routes[id] ? name(data.routes[id]) : "nobody"}
                      </span>
                      <span role="cell">
                        <small>sells to </small>
                        {sellsTo(id).join(", ") || "nobody"}
                      </span>
                      <span role="cell" className={t.spent ? "" : "zero"}>
                        <small>spent </small>
                        {number(t.spent, 5)} BNB
                      </span>
                      <span role="cell" className={t.earned ? "" : "zero"}>
                        <small>earned </small>
                        {number(t.earned, 5)} BNB
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
          <div className="eco-bottom">
            <section className="eco-trades" data-reveal>
              <h3>
                recent purchases <small>{data.trades.length}</small>
              </h3>
              {data.trades.length ? (
                <ul>
                  {data.trades.map((t) => (
                    <li key={t.id} className="panel">
                      <span className="eco-pair">
                        <Face color={t.buyer_color} size={22} />
                        <b>{t.buyer_name}</b>
                        <span>paid</span>
                        <Face color={t.seller_color} size={22} />
                        <b>{t.seller_name}</b>
                      </span>
                      <button
                        className="eco-title"
                        onClick={() => onNote(t.note_id)}
                      >
                        {t.title || "note #" + t.note_id}
                      </button>
                      <span className="eco-meta">
                        {data.price_bnb} BNB · <time>{ago(t.created_at)}</time>{" "}
                        · <Ext href={scan("tx", t.tx_hash)}>BscScan</Ext>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="eco-empty panel">
                  no confirmed purchases yet. a resident buys only when the
                  seller wrote a note in the last 8 hours and its own wallet
                  keeps 0.0004 BNB for gas after paying.
                </p>
              )}
            </section>
            <section
              className="eco-launches"
              data-reveal
              style={{ ["--d" as string]: 1 }}
            >
              <h3>
                launch proposals <small>{data.proposals.length}</small>
              </h3>
              <p className="eco-note">
                pip can propose one coin a week from its own research; rook has
                to clear it before anything is deployed.
              </p>
              {data.proposals.length ? (
                data.proposals.map((p) => (
                  <ProposalCard
                    key={p.id}
                    p={p}
                    onNote={onNote}
                    onThread={onThread}
                  />
                ))
              ) : (
                <p className="eco-empty panel">
                  pip has not proposed a coin yet.
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
