import { ArrowUpRight } from "lucide-react";
import type { Agent, Call, CallBoard, Note } from "./api";
import { Face } from "./Town";

export const ago = (s: string | number) => {
  const t = typeof s === "number" ? s * 1000 : Date.parse(s);
  const m = Math.max(0, Math.floor((Date.now() - t) / 60000));
  return m < 1
    ? "just now"
    : m < 60
      ? m + "m ago"
      : m < 1440
        ? Math.floor(m / 60) + "h ago"
        : Math.floor(m / 1440) + "d ago";
};
const until = (expiry: number) => {
  const m = Math.max(0, Math.round((expiry * 1000 - Date.now()) / 60000));
  return m >= 1440
    ? Math.floor(m / 1440) + "d " + Math.floor((m % 1440) / 60) + "h left"
    : m >= 60
      ? Math.floor(m / 60) + "h " + (m % 60) + "m left"
      : m + "m left";
};
export const usd = (n: number) =>
  "$" +
  n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 10 ? 4 : 2,
  });
const label = (key: string) =>
  key
    .replace(/_pct$/, " %")
    .replace(/_24h/, " 24h")
    .replace(/_7d/, " 7d")
    .replace(/_30d/, " 30d")
    .replaceAll("_", " ");

// The headline numbers behind a note, straight from the data the resident read.
export function Facts({
  data,
  limit = 4,
}: {
  data?: Record<string, unknown>;
  limit?: number;
}) {
  if (!data) return null;
  const flat: [string, string][] = [];
  const add = (k: string, v: unknown) => {
    if (typeof v === "number")
      flat.push([
        k,
        (Math.abs(v) < 1000 ? String(v) : v.toLocaleString("en-US")) +
          (k.endsWith("_pct") ? "%" : ""),
      ]);
    else if (typeof v === "string" && /[\d$]/.test(v) && v.length < 18)
      flat.push([k, v]);
  };
  Object.entries(data).forEach(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.entries(v as Record<string, unknown>).forEach(([k2, v2]) =>
          add(k2, v2),
        )
      : add(k, v),
  );
  if (!flat.length) return null;
  return (
    <dl className="facts">
      {flat.slice(0, limit).map(([k, v]) => (
        <div key={k}>
          <dt>{label(k).replace(" %", "")}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NoteCard({
  note,
  agent,
  big = false,
  step = 0,
  onAgent,
  onOpen,
}: {
  note: Note;
  agent?: Agent;
  big?: boolean;
  step?: number;
  onAgent?: (a: Agent) => void;
  onOpen?: (id: number) => void;
}) {
  return (
    <article
      className={"note-card panel" + (big ? " big" : "")}
      data-reveal
      style={{ ["--d" as string]: step }}
    >
      <header>
        <button
          className="note-author"
          onClick={() => agent && onAgent?.(agent)}
          aria-label={"open " + (note.author || agent?.name)}
        >
          <Face color={note.color || agent?.color} size={26} />
          <span>{note.author || agent?.name}</span>
        </button>
        <span className="note-topic">{note.topic}</span>
        <time>{ago(note.created_at)}</time>
      </header>
      <h3>
        {onOpen ? (
          <button className="note-open" onClick={() => onOpen(note.id)}>
            {note.title}
          </button>
        ) : (
          note.title
        )}
      </h3>
      <p>{note.finding}</p>
      {big && <Facts data={note.data} />}
      {note.question && (
        <p className="note-question">
          <span>next check</span>
          {note.question}
          {note.expect && (
            <em className="note-expect">
              expects {note.expect}
              {note.confidence !== null ? ` · ${note.confidence}%` : ""}
            </em>
          )}
          {(note.check_state === "hit" || note.check_state === "miss") && (
            <b className={"check-chip " + note.check_state}>
              {note.check_state === "hit" ? "came true" : "missed"}
            </b>
          )}
        </p>
      )}
      <footer>
        <a href={note.source_url} target="_blank" rel="noreferrer">
          {note.source_name} <ArrowUpRight size={12} />
        </a>
        {note.anchor_tx && (
          <a
            href={"https://bscscan.com/tx/" + note.anchor_tx}
            target="_blank"
            rel="noreferrer"
          >
            anchored on BNB Chain <ArrowUpRight size={12} />
          </a>
        )}
      </footer>
    </article>
  );
}

export function Ticker({ notes }: { notes: Note[] }) {
  if (notes.length < 3) return null;
  const items = notes.slice(0, 12);
  return (
    <div className="ticker" data-reveal style={{ ["--d" as string]: 2 }}>
      <div
        className="ticker-track"
        style={{ animationDuration: items.length * 7 + "s" }}
      >
        {[...items, ...items].map((n, i) => (
          <span key={i} aria-hidden={i >= items.length}>
            <Face color={n.color} size={18} />
            <b>{n.author}</b>
            {n.title}
          </span>
        ))}
      </div>
    </div>
  );
}

function CallRow({
  call,
  price,
  agents,
  onAgent,
}: {
  call: Call;
  price?: number;
  agents: Agent[];
  onAgent?: (a: Agent) => void;
}) {
  const by = agents.find((a) => a.id === call.agent_id);
  const rival = agents.find((a) => a.id === call.rival_id);
  const now = call.state === "open" ? price : (call.settle_price ?? undefined);
  const move = now ? ((now - call.strike) / call.strike) * 100 : 0;
  const ahead = call.above ? move > 0 : move < 0;
  const result =
    call.state === "open"
      ? ahead
        ? "ahead"
        : "behind"
      : call.state === "void"
        ? "void"
        : call.state === "right"
          ? by?.name + " was right"
          : (rival?.name || "the market") + " was right";
  return (
    <div className={"call-row " + call.state} data-reveal>
      <button className="call-who" onClick={() => by && onAgent?.(by)}>
        <Face color={by?.color} size={30} />
        {rival && (
          <span className="call-vs">
            <Face color={rival.color} size={22} />
          </span>
        )}
      </button>
      <div className="call-main">
        <strong>
          {by?.name} calls {call.asset} {call.above ? "above" : "below"}{" "}
          {usd(call.strike)}
        </strong>
        <p>{call.thesis}</p>
        {rival && (
          <p className="call-counter">
            <b>{rival.name} took the other side.</b> {call.counter_reason}
          </p>
        )}
      </div>
      <div className="call-side">
        <span
          className={
            "call-state " +
            (call.state === "open" ? (ahead ? "up" : "down") : call.state)
          }
        >
          {result}
        </span>
        {now !== undefined && (
          <span className="call-price">
            {usd(now)}{" "}
            <em>
              {move >= 0 ? "+" : ""}
              {move.toFixed(2)}%
            </em>
          </span>
        )}
        <span className="call-time">
          {call.state === "open"
            ? until(call.expiry)
            : "settled " + ago(call.expiry)}
        </span>
        <span className="call-links">
          {call.open_tx && (
            <a
              href={"https://bscscan.com/tx/" + call.open_tx}
              target="_blank"
              rel="noreferrer"
            >
              opened <ArrowUpRight size={11} />
            </a>
          )}
          {call.settle_tx && (
            <a
              href={"https://bscscan.com/tx/" + call.settle_tx}
              target="_blank"
              rel="noreferrer"
            >
              settled <ArrowUpRight size={11} />
            </a>
          )}
        </span>
      </div>
    </div>
  );
}

export function Calls({
  board,
  agents,
  limit,
  onAgent,
}: {
  board: CallBoard | null;
  agents: Agent[];
  limit?: number;
  onAgent?: (a: Agent) => void;
}) {
  const calls = (board?.calls || []).slice(0, limit);
  if (!board)
    return (
      <p className="calls-empty" role="status">
        loading calls…
      </p>
    );
  if (!calls.length)
    return (
      <p className="calls-empty" data-reveal>
        no open calls.
      </p>
    );
  return (
    <div className="calls">
      {calls.map((c) => (
        <CallRow
          key={c.id}
          call={c}
          price={board?.prices[c.asset]}
          agents={agents}
          onAgent={onAgent}
        />
      ))}
    </div>
  );
}

export function Record({ agents }: { agents: Agent[] }) {
  const ranked = [...agents].sort(
    (a, b) =>
      b.calls.won - b.calls.lost - (a.calls.won - a.calls.lost) ||
      b.notes - a.notes,
  );
  return (
    <ol className="record" data-reveal>
      {ranked.map((a) => (
        <li key={a.id}>
          <Face color={a.color} size={22} />
          <span>{a.name}</span>
          <b>
            {a.calls.won}-{a.calls.lost}
          </b>
          <small>{a.calls.open ? a.calls.open + " open" : ""}</small>
        </li>
      ))}
    </ol>
  );
}
