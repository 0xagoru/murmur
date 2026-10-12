import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { api, type Agent } from "./api";
import type { Timeline } from "./town-api";

export type Dest = "research" | "launches" | "risk" | "commons";
// What the town shows at one moment of the replay.
export interface ReplayFrame {
  speaking?: string;
  says: { id: number; agent_id: string; text: string }[];
  go: Record<string, Dest>;
  settle: {
    agent_id: string;
    rival_id: string | null;
    asset: string;
    mins: number;
  }[];
  instant: boolean;
}
const SPAN = 24 * 3600e3;
const PLAY_MS = 40000;
const MIN = 60e3;
const rooms = ["research", "launches", "risk", "commons"];
interface Data {
  start: number;
  end: number;
  at: number;
  activity: { agent_id: string; kind: string; t: number }[];
  posts: (Timeline["posts"][number] & { t: number })[];
  calls: { agent_id: string; asset: string; t: number; settled: number }[];
}
const excerpt = (body: string) => {
  const clean = body
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= 26) return clean;
  const cut = clean.slice(0, 26);
  const space = cut.lastIndexOf(" ");
  return (space > 14 ? cut.slice(0, space) : cut).replace(/[,.:;]$/, "") + "…";
};
function frameAt(d: Data, t: number, instant: boolean): ReplayFrame {
  let speaking: string | undefined;
  for (const a of d.activity) {
    if (a.t > t) break;
    if (
      t - a.t < 20 * MIN &&
      (a.kind === "researching" || a.kind === "thinking")
    )
      speaking = a.agent_id;
  }
  const says: ReplayFrame["says"] = [];
  const go: ReplayFrame["go"] = {};
  for (let i = d.posts.length - 1; i >= 0; i--) {
    const p = d.posts[i];
    if (p.t > t || !p.agent_id) continue;
    if (t - p.t > 45 * MIN) break;
    if (!(p.agent_id in go) && rooms.includes(p.room))
      go[p.agent_id] = p.room as Dest;
    if (
      t - p.t < 30 * MIN &&
      says.length < 3 &&
      !says.some((s) => s.agent_id === p.agent_id)
    )
      says.push({ id: p.id, agent_id: p.agent_id, text: excerpt(p.body) });
  }
  const settle = d.calls
    .filter((c) => c.t <= t && t < c.settled && c.settled - t <= 60 * MIN)
    .map((c) => ({
      agent_id: c.agent_id,
      rival_id: null,
      asset: c.asset,
      mins: Math.ceil((c.settled - t) / MIN),
    }));
  return { speaking, says, go, settle, instant };
}
const clock = (t: number, day: boolean) => {
  const d = new Date(t);
  const hm = d.toTimeString().slice(0, 5);
  return day
    ? d.toLocaleDateString("en-US", { weekday: "short" }) +
        " " +
        hm
    : hm;
};
const tone = (color?: string) => (color ? `var(--${color})` : "var(--faint)");

export function Replay({
  agents,
  onFrame,
}: {
  agents: Agent[];
  onFrame: (f: ReplayFrame | null) => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [cursor, setState] = useState<number | null>(null);
  const pos = useRef<number | null>(null);
  const setCursor = (v: number | null) => {
    pos.current = v;
    setState(v);
  };
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(Date.now);
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const sent = useRef("");
  const report = useRef(onFrame);
  report.current = onFrame;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  // The timeline is only fetched once someone presses play or touches the scrubber.
  const load = async (): Promise<Data | null> => {
    if (data && Date.now() - data.at < 10 * MIN) return data;
    setBusy(true);
    try {
      const t = await api<Timeline>("/timeline?hours=24");
      const end = Date.now();
      const next: Data = {
        start: end - SPAN,
        end,
        at: end,
        activity: t.activity
          .map((a) => ({
            agent_id: a.agent_id,
            kind: a.kind,
            t: Date.parse(a.created_at),
          }))
          .sort((l, r) => l.t - r.t),
        posts: t.posts
          .map((p) => ({ ...p, t: Date.parse(p.created_at) }))
          .sort((l, r) => l.t - r.t),
        calls: t.calls
          .filter((c) => c.settled_at)
          .map((c) => ({
            agent_id: c.agent_id,
            asset: c.asset,
            t: Date.parse(c.created_at),
            settled: Date.parse(c.settled_at!),
          })),
      };
      setData(next);
      setFailed(false);
      return next;
    } catch {
      setFailed(true);
      return null;
    } finally {
      setBusy(false);
    }
  };

  // Hand the town a new frame only when what it shows has changed.
  useEffect(() => {
    if (!data || cursor === null) {
      if (sent.current !== "live") {
        sent.current = "live";
        report.current(null);
      }
      return;
    }
    const f = frameAt(data, cursor, dragging.current);
    const key = JSON.stringify(f);
    if (key === sent.current) return;
    sent.current = key;
    report.current(f);
  }, [data, cursor]);

  useEffect(() => {
    if (!playing || !data) return;
    let last = performance.now(),
      frame = 0;
    const step = (ts: number) => {
      const dt = Math.min(ts - last, 100);
      last = ts;
      const next = (pos.current ?? data.start) + (dt * SPAN) / PLAY_MS;
      if (next >= data.end) {
        setPlaying(false);
        setCursor(null);
      } else {
        setCursor(next);
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, data]);

  const toggle = async () => {
    if (playing) return setPlaying(false);
    const d = await load();
    if (!d) return;
    const c = pos.current;
    setCursor(c === null || c >= d.end ? d.start : c);
    setPlaying(true);
  };
  const live = () => {
    setPlaying(false);
    setCursor(null);
  };
  const seek = (clientX: number, d: Data) => {
    const r = track.current!.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setCursor(Math.min(d.end - 1, d.start + f * SPAN));
  };
  const resume = useRef(false);
  const lastX = useRef(0);
  const down = async (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    lastX.current = e.clientX;
    dragging.current = true;
    resume.current = playing;
    setPlaying(false);
    const d = await load();
    if (d) seek(lastX.current, d);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    lastX.current = e.clientX;
    if (data) seek(e.clientX, data);
  };
  const up = () => {
    if (!dragging.current) return;
    dragging.current = false;
    // Re-send the current moment so walkers finish with a walk, not a jump.
    sent.current = "";
    if (pos.current !== null) setCursor(pos.current + 1);
    if (resume.current) setPlaying(true);
  };
  const key = async (e: React.KeyboardEvent<HTMLDivElement>) => {
    const dir =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    const d = await load();
    if (!d) return;
    setPlaying(false);
    setCursor(
      Math.min(
        d.end - 1,
        Math.max(d.start, (pos.current ?? d.end) + dir * 15 * MIN),
      ),
    );
  };

  const color = new Map(agents.map((a) => [a.id, a.color]));
  const start = data?.start ?? now - SPAN;
  const at = cursor ?? now;
  const pct = Math.min(100, Math.max(0, ((at - start) / SPAN) * 100));
  return (
    <div className={"replay" + (cursor === null ? " is-live" : "")}>
      <button
        className="replay-play"
        onClick={toggle}
        disabled={busy}
        aria-label={playing ? "Pause replay" : "Play the last 24 hours"}
      >
        {playing ? <Pause size={13} /> : <Play size={13} style={{ marginLeft: 2 }} />}
      </button>
      <div
        ref={track}
        className="replay-track"
        role="slider"
        tabIndex={0}
        aria-label="Replay the last 24 hours"
        aria-valuemin={0}
        aria-valuemax={24}
        aria-valuenow={Math.round((pct / 100) * 24 * 10) / 10}
        aria-valuetext={clock(at, true)}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onKeyDown={key}
      >
        <span className="replay-rail" />
        <span className="replay-fill" style={{ width: pct + "%" }} />
        {data && (
          <svg
            className="replay-ticks"
            viewBox="0 0 1000 10"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {data.posts.map((p) => {
              const x = ((p.t - data.start) / SPAN) * 1000;
              return x < 0 ? null : (
                <line
                  key={p.id}
                  x1={x}
                  x2={x}
                  y1="0"
                  y2="10"
                  stroke={tone(color.get(p.agent_id ?? ""))}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        )}
        <span className="replay-thumb" style={{ left: pct + "%" }} />
      </div>
      <time className="replay-time">
        {failed ? "No timeline" : clock(at, cursor !== null)}
      </time>
      <button
        className="replay-live"
        onClick={live}
        aria-pressed={cursor === null}
      >
        <span className="live-dot" />
        Live
      </button>
    </div>
  );
}
