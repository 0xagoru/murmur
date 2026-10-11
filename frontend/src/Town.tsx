import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type Agent } from "./api";
import type { Mood } from "./town-api";
import { Replay, type Dest, type ReplayFrame } from "./Replay";
import "./town-extras.css";
const W = 820,
  H = 470;
const plots = [
  { x: 170, y: 120 },
  { x: 560, y: 104 },
  { x: 706, y: 236 },
  { x: 300, y: 300 },
  { x: 104, y: 340 },
  { x: 548, y: 362 },
];
const commons = { x: 400, y: 210 };
const roads = [
  "M-20 252Q210 186 352 196T840 312",
  "M384-20Q398 120 390 214T468 500",
  "M96 500Q200 326 352 294T690-20",
];
const signs = [
  { id: "research", name: "reading room", left: true, top: true },
  { id: "launches", name: "the workshop", left: false, top: true },
  { id: "risk", name: "watchtower", left: false, top: false },
];
const pond = { x: 760, y: 392, rx: 62, ry: 42 };
type Pt = [number, number];
const sample = (d: string) => {
  const [x0, y0, cx, cy, x1, y1, x2, y2] = d.match(/-?\d+/g)!.map(Number);
  const q = (a: Pt, c: Pt, b: Pt) =>
    Array.from({ length: 41 }, (_, i): Pt => {
      const t = i / 40,
        u = 1 - t;
      return [
        u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
        u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
      ];
    });
  return [
    ...q([x0, y0], [cx, cy], [x1, y1]),
    ...q([x1, y1], [2 * x1 - cx, 2 * y1 - cy], [x2, y2]),
  ];
};
const roadPoints = roads.flatMap(sample);
// Where residents stand when they visit a room; the watchtower doubles as the risk room.
const spots: Record<Dest, Pt[]> = {
  research: [
    [100, 96],
    [76, 102],
    [52, 96],
    [118, 104],
  ],
  launches: [
    [700, 96],
    [724, 102],
    [676, 102],
    [748, 96],
  ],
  risk: [
    [652, 352],
    [676, 357],
    [630, 346],
    [700, 346],
  ],
  commons: [
    [446, 224],
    [354, 226],
    [424, 246],
    [376, 248],
  ],
};
const homeAt = (i: number): Pt => [plots[i].x + 55, plots[i].y + 41];
// Footpaths off the roads, so nobody cuts through a cottage on the way to a room.
const paths: Pt[] = [
  [634, 318],
  [636, 340],
  [330, 62],
  [236, 64],
  [160, 72],
  [676, 56],
];
const graph = (() => {
  const nodes: Pt[] = [];
  const edges: [number, number][] = [];
  const road: number[] = [];
  roads.forEach((d, r) => {
    const pts = sample(d);
    pts.forEach((p, i) => {
      nodes.push(p);
      road.push(r);
      if (i) edges.push([nodes.length - 2, nodes.length - 1]);
    });
  });
  const onRoad = nodes.length;
  for (let i = 0; i < onRoad; i++)
    for (let j = i + 1; j < onRoad; j++)
      if (road[i] !== road[j] && dist(nodes[i], nodes[j]) < 14)
        edges.push([i, j]);
  const extra = [
    ...paths,
    ...Object.values(spots).flat(),
    ...plots.map((_, i) => homeAt(i)),
  ];
  extra.forEach((p) => nodes.push(p));
  const links = nodes.map((): number[] => []);
  edges.forEach(([a, b]) => (links[a].push(b), links[b].push(a)));
  for (let i = onRoad; i < nodes.length; i++) link(i);
  function link(i: number) {
    let best = -1;
    for (let j = 0; j < onRoad; j++)
      if (
        onMap(nodes[j]) &&
        (best < 0 || dist(nodes[i], nodes[j]) < dist(nodes[i], nodes[best]))
      )
        best = j;
    const add = (j: number) => {
      if (j === i || links[i].includes(j)) return;
      links[i].push(j);
      links[j].push(i);
    };
    add(best);
    for (let j = onRoad; j < nodes.length; j++)
      if (dist(nodes[i], nodes[j]) < 90) add(j);
  }
  return { nodes, links, onRoad };
})();
function dist(a: Pt, b: Pt) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
function onMap(p: Pt) {
  return p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H;
}
// Shortest walk between two points over roads and footpaths.
function route(from: Pt, to: Pt): Pt[] {
  if (dist(from, to) < 40) return [from, to];
  const nodes = [...graph.nodes, from, to];
  const links = graph.links.map((l) => [...l]);
  links.push([], []);
  const s = nodes.length - 2,
    e = nodes.length - 1;
  for (const i of [s, e]) {
    let best = -1;
    for (let j = 0; j < graph.nodes.length; j++)
      if (
        onMap(nodes[j]) &&
        (best < 0 || dist(nodes[i], nodes[j]) < dist(nodes[i], nodes[best]))
      )
        best = j;
    const near = graph.nodes
      .map((_, j) => j)
      .filter(
        (j) =>
          j === best || (j >= graph.onRoad && dist(nodes[i], nodes[j]) < 90),
      );
    near.forEach((j) => (links[i].push(j), links[j].push(i)));
  }
  if (dist(from, to) < 90) (links[s].push(e), links[e].push(s));
  const cost = nodes.map(() => Infinity),
    prev = nodes.map(() => -1),
    done = nodes.map(() => false);
  cost[s] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++)
      if (!done[i] && cost[i] < Infinity && (u < 0 || cost[i] < cost[u])) u = i;
    if (u < 0 || u === e) break;
    done[u] = true;
    for (const v of links[u]) {
      const c = cost[u] + dist(nodes[u], nodes[v]);
      if (c < cost[v]) ((cost[v] = c), (prev[v] = u));
    }
  }
  if (prev[e] < 0) return [from, to];
  const out: Pt[] = [];
  for (let i = e; i >= 0; i = prev[i]) out.unshift(nodes[i]);
  return out.filter((p, i) => !i || dist(p, out[i - 1]) > 0.5);
}
// Trees are placed once, deterministically, clear of roads, cottages, signs and water.
const trees = (() => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const out: { x: number; y: number; big: boolean; tone: number }[] = [];
  for (let gy = 0; gy < H + 30; gy += 44)
    for (let gx = 0; gx < W + 30; gx += 44) {
      const x = gx + rand() * 30 - 15,
        y = gy + rand() * 30 - 15;
      const clear =
        x > 10 &&
        x < W - 10 &&
        y > 40 &&
        y < H - 6 &&
        roadPoints.every(([rx, ry]) => Math.hypot(rx - x, ry - y) > 30) &&
        plots.every(
          (p) => x < p.x - 74 || x > p.x + 86 || y < p.y - 60 || y > p.y + 96,
        ) &&
        Math.hypot(x - commons.x, y - commons.y) > 80 &&
        signs.every(
          (s) =>
            (s.left ? x > 190 : x < W - 190) || (s.top ? y > 90 : y < H - 70),
        ) &&
        ((x - pond.x) / (pond.rx + 22)) ** 2 +
          ((y - pond.y) / (pond.ry + 30)) ** 2 >
          1 &&
        out.every((t) => Math.hypot(t.x - x, t.y - y) > 34);
      if (clear && rand() > 0.42)
        out.push({ x, y, big: rand() > 0.62, tone: Math.floor(rand() * 3) });
    }
  return out;
})();
// Trees grow outward from the commons.
const growOrder = trees
  .map((t, i) => ({ i, d: Math.hypot(t.x - commons.x, t.y - commons.y) }))
  .sort((l, r) => l.d - r.d)
  .reduce<number[]>((m, t, n) => ((m[t.i] = n), m), []);
const tones = ["#5fa463", "#7cb86f", "#4f9459"];
const pill = (name: string) => name.length * 7.3 + 34;
const delay = (s: number) => ({ ["--d" as string]: s.toFixed(2) + "s" });
export function Face({
  color = "sage",
  size = 36,
}: {
  color?: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 60 60"
      className={"face " + color}
      aria-hidden="true"
    >
      <path
        d="M10 33C10 13 19 7 30 7s21 7 21 26c0 15-9 21-21 21S10 48 10 33"
        fill="currentColor"
      />
      <path
        d="M19 8l-2-5m22 5 3-5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="23" cy="29" r="2" fill="#10201a" />
      <circle cx="38" cy="29" r="2" fill="#10201a" />
      <path
        d="M27 38q4 3 8 0"
        stroke="#10201a"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <ellipse cx="17" cy="35" rx="4" ry="2" fill="#ffffff" opacity=".45" />
    </svg>
  );
}
// Same outline as the logo: a pitched roof in the resident's color and an arched door.
function Cottage({ a }: { a: Agent }) {
  const tall = a.cottage === "tall";
  return (
    <>
      <ellipse cx="4" cy="42" rx="58" ry="10" fill="#2f6b3a" opacity=".16" />
      {tall && (
        <rect x="18" y="-38" width="11" height="22" rx="1.5" fill="#10201a" />
      )}
      <path
        d="M-38 40V-2L0-33 38-2v42z"
        fill="#fffdf7"
        stroke="#10201a"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
      <path
        d="M-46 2 0-37 46 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M-10 40V23a10 10 0 0 1 20 0v17z" fill="currentColor" />
      <rect
        x="-29"
        y="8"
        width="11"
        height="11"
        rx="2"
        fill="#cfe9f3"
        stroke="#10201a"
        strokeWidth="1.6"
      />
      <rect
        x="18"
        y="8"
        width="11"
        height="11"
        rx="2"
        fill="#cfe9f3"
        stroke="#10201a"
        strokeWidth="1.6"
      />
    </>
  );
}
// Light follows the fear and greed index: dusk when scared, golden afternoon when greedy.
const ramp = (stops: [number, number][], v: number) => {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i],
      [x0, y0] = stops[i - 1];
    if (v <= x1) return y0 + ((y1 - y0) * (v - x0)) / (x1 - x0);
  }
  return stops[stops.length - 1][1];
};
const lightFor = (v: number | null) => {
  if (v === null)
    return { cool: 0, grey: 0, dusk: 0, warm: 0, sun: 0, hot: 0, lamps: 0 };
  return {
    cool: ramp(
      [
        [0, 0.46],
        [25, 0.32],
        [45, 0.1],
        [50, 0],
      ],
      v,
    ),
    grey: ramp(
      [
        [0, 0.2],
        [25, 0.26],
        [45, 0.2],
        [56, 0],
      ],
      v,
    ),
    dusk: ramp(
      [
        [0, 0.55],
        [25, 0.32],
        [40, 0],
      ],
      v,
    ),
    warm: ramp(
      [
        [50, 0],
        [56, 0.07],
        [75, 0.17],
        [100, 0.26],
      ],
      v,
    ),
    sun: ramp(
      [
        [55, 0],
        [75, 0.35],
        [100, 0.65],
      ],
      v,
    ),
    hot: ramp(
      [
        [72, 0],
        [100, 0.22],
      ],
      v,
    ),
    lamps: ramp(
      [
        [20, 1],
        [32, 0],
      ],
      v,
    ),
  };
};
const ago = (expiry: number, at: number) => {
  const m = Math.ceil((expiry * 1000 - at) / 60000);
  return m > 0 ? `settles in ${m}m` : "settling";
};
const ease = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;
interface Goer {
  pos: Pt;
  goal: Pt;
  path: Pt[];
  lens: number[];
  t0: number;
  dur: number;
  moving: boolean;
  left: boolean;
}
// Walks residents between their cottage and wherever they are needed, one frame at a time.
function useGoers(
  homes: Agent[],
  goals: Record<string, Pt>,
  speed: number,
  instant: boolean,
) {
  const figs = useRef(new Map<string, SVGGElement>());
  const says = useRef(new Map<string, SVGGElement>());
  const goers = useRef(new Map<string, Goer>());
  const frame = useRef(0);
  const [away, setAway] = useState<string[]>([]);
  const awayKey = useRef("");
  const paint = (id: string, g: Goer) => {
    const [x, y] = g.pos;
    const fig = figs.current.get(id),
      say = says.current.get(id);
    fig?.setAttribute(
      "transform",
      `translate(${x.toFixed(1)},${y.toFixed(1)})`,
    );
    if (say) {
      // Bubbles slide to stay inside the map.
      const [x0, y0, x1, y1] = (say.dataset.box ?? "0,0,0,0")
        .split(",")
        .map(Number);
      const sx = Math.min(Math.max(x, 4 - x0), W - 4 - x1),
        sy = Math.min(Math.max(y, 4 - y0), H - 4 - y1);
      say.setAttribute(
        "transform",
        `translate(${sx.toFixed(1)},${sy.toFixed(1)})`,
      );
    }
    if (fig) {
      fig.toggleAttribute("data-moving", g.moving);
      fig.toggleAttribute("data-left", g.left);
    }
  };
  const crew = useRef(homes);
  crew.current = homes;
  const sync = () => {
    const homes = crew.current;
    const out = homes
      .filter((a, i) => {
        const g = goers.current.get(a.id);
        return g && (g.moving || dist(g.pos, homeAt(i)) > 1);
      })
      .map((a) => a.id);
    homes.forEach((a) =>
      figs.current.get(a.id)?.toggleAttribute("data-away", out.includes(a.id)),
    );
    const key = out.join();
    if (key !== awayKey.current) {
      awayKey.current = key;
      setAway(out);
    }
  };
  const tick = (now: number) => {
    let moving = false;
    goers.current.forEach((g, id) => {
      if (!g.moving) return;
      const e = Math.min(1, (now - g.t0) / g.dur);
      let d = ease(e) * g.lens[g.lens.length - 1],
        k = 1;
      while (k < g.path.length - 1 && g.lens[k] < d) k++;
      const a = g.path[k - 1],
        b = g.path[k],
        seg = g.lens[k] - g.lens[k - 1] || 1,
        f = Math.min(1, Math.max(0, (d - g.lens[k - 1]) / seg));
      const next: Pt = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      if (Math.abs(b[0] - a[0]) > 2) g.left = b[0] < a[0];
      g.pos = next;
      if (e >= 1) {
        g.pos = g.goal;
        g.moving = false;
      } else moving = true;
      paint(id, g);
      if (!g.moving) sync();
    });
    frame.current = moving ? requestAnimationFrame(tick) : 0;
  };
  const key = homes.map((a) => a.id + ":" + (goals[a.id] ?? "")).join("|");
  useLayoutEffect(() => {
    const now = performance.now();
    homes.forEach((a, i) => {
      const goal = goals[a.id] ?? homeAt(i);
      let g = goers.current.get(a.id);
      if (!g) {
        g = {
          pos: homeAt(i),
          goal: homeAt(i),
          path: [],
          lens: [0],
          t0: now,
          dur: 1,
          moving: false,
          left: false,
        };
        goers.current.set(a.id, g);
      }
      if (dist(goal, g.goal) < 0.5 && (g.moving || dist(g.pos, goal) < 0.5))
        return paint(a.id, g);
      g.goal = goal;
      if (instant) {
        g.pos = goal;
        g.moving = false;
        return paint(a.id, g);
      }
      const path = route(g.pos, goal);
      g.path = path;
      g.lens = path.reduce<number[]>(
        (l, p, n) => (l.push(n ? l[n - 1] + dist(path[n - 1], p) : 0), l),
        [],
      );
      g.t0 = now;
      g.dur = (g.lens[g.lens.length - 1] / speed) * 1000 + 500;
      g.moving = true;
      paint(a.id, g);
    });
    sync();
    if (!frame.current) frame.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, instant]);
  useLayoutEffect(() => goers.current.forEach((g, id) => paint(id, g)));
  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );
  const ref = (map: typeof figs, id: string) => (el: SVGGElement | null) => {
    if (el) map.current.set(id, el);
    else map.current.delete(id);
  };
  return {
    away,
    pos: (id: string) => goers.current.get(id)?.pos,
    fig: (id: string) => ref(figs, id),
    say: (id: string) => ref(says, id),
  };
}
const sayWidth = (text: string) => text.length * 6.7 + 20;
export function Town({
  agents,
  live = true,
  speaking,
  onAgent,
  onRoom,
  replay = null,
}: {
  agents: Agent[];
  live?: boolean;
  speaking?: string;
  onAgent: (a: Agent) => void;
  onRoom: (id: string) => void;
  replay?: ReplayFrame | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);
  // Labels keep a readable on-screen size when the map is drawn small.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () =>
      setScale(Math.min(1.8, Math.max(1, 680 / (el.clientWidth || W))));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!agents.length || !live || ready) return;
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [agents.length, live, ready]);
  const [mood, setMood] = useState<Mood | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api<Mood>("/mood")
        .then((m) => alive && setMood(m))
        .catch(() => {});
    load();
    const poll = setInterval(load, 120000),
      clock = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(clock);
    };
  }, []);
  const homes = agents.slice(0, plots.length);
  const ids = new Set(homes.map((a) => a.id));
  // Where everyone should be: the replayed moment, or live calls about to settle.
  const dest: Record<string, Dest> = { ...(replay?.go ?? {}) };
  const due = replay
    ? replay.settle.map((c) => ({
        ...c,
        when: c.mins > 0 ? `settles in ${c.mins}m` : "settling",
      }))
    : (mood?.settling ?? []).map((c) => ({ ...c, when: ago(c.expiry, now) }));
  due.forEach((c) =>
    [c.agent_id, c.rival_id].forEach(
      (id) => id && ids.has(id) && (dest[id] = "risk"),
    ),
  );
  const goals: Record<string, Pt> = {};
  if (ready && live) {
    const filled: Record<string, number> = {};
    homes.forEach((a) => {
      const d = dest[a.id];
      if (!d) return;
      const n = (filled[d] = (filled[d] ?? -1) + 1),
        [x, y] = spots[d][n % spots[d].length];
      goals[a.id] = [
        x + Math.floor(n / spots[d].length) * 10,
        y + Math.floor(n / spots[d].length) * 6,
      ];
    });
  }
  const walk = useGoers(homes, goals, replay ? 240 : 40, !!replay?.instant);
  const lit = lightFor(mood?.fear_greed?.value ?? null);
  // Each excerpt stays up long enough to read, even while the replay runs fast.
  const [talk, setTalk] = useState(
    new Map<string, { id: number; text: string; until: number }>(),
  );
  const said = useRef(new Map<string, { id: number; text: string }>());
  const says = replay?.says;
  useEffect(() => {
    const step = () =>
      setTalk((cur) => {
        const t = performance.now(),
          next = new Map([...cur].filter(([, v]) => v.until > t));
        (says ?? []).forEach((s) => {
          const v = next.get(s.agent_id);
          if (v?.id === s.id) return;
          if ((!v || v.until - t < 1200) && (next.size < 3 || v))
            next.set(s.agent_id, { id: s.id, text: s.text, until: t + 2600 });
        });
        const same =
          next.size === cur.size &&
          [...next].every(([k, v]) => cur.get(k) === v);
        return same ? cur : next;
      });
    if (!says) return setTalk((cur) => (cur.size ? new Map() : cur));
    step();
    const id = setInterval(step, 200);
    return () => clearInterval(id);
  }, [says]);
  talk.forEach((t, id) => said.current.set(id, t));
  const speaker = replay ? replay.speaking : speaking;
  const fg = mood?.fear_greed;
  const fgText = fg ? `fear & greed ${fg.value} · ${fg.label}` : "";
  const dueText = due.length
    ? `${due[0].asset.toLowerCase()} call ${due[0].when}` +
      (due.length > 1 ? ` · ${due.length - 1} more` : "")
    : "";
  const tagScale = Math.min(scale, 1.6);
  const scene = [
    ...trees.map((t, i) => ({ y: t.y + 15, tree: t, i })),
    ...homes.map((a, i) => ({ y: plots[i].y + 50, home: a, i })),
  ].sort((l, r) => l.y - r.y);
  return (
    <div ref={box} className={"town-scene" + (ready ? " is-ready" : "")}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="murmur town map, six resident cottages and three rooms"
      >
        <defs>
          <pattern
            id="grain"
            width="9"
            height="9"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r=".55" fill="#2f6b3a" opacity=".10" />
          </pattern>
          <pattern
            id="roof"
            width="12"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 7h12M6 0v7"
              stroke="#10201a"
              strokeWidth=".8"
              opacity=".2"
            />
          </pattern>
          {roads.map((d, i) => (
            <path key={i} id={"road-" + i} d={d} />
          ))}
          <radialGradient id="light-sun" cx="88%" cy="-8%" r="95%">
            <stop offset="0" stopColor="#ffe3a3" />
            <stop offset=".55" stopColor="#ffc56a" stopOpacity=".35" />
            <stop offset="1" stopColor="#ffb04a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="light-dusk" cx="50%" cy="45%" r="75%">
            <stop offset=".45" stopColor="#1b2740" stopOpacity="0" />
            <stop offset="1" stopColor="#1b2740" stopOpacity=".55" />
          </radialGradient>
          <radialGradient id="light-lamp">
            <stop offset="0" stopColor="#ffd56b" stopOpacity=".7" />
            <stop offset="1" stopColor="#ffd56b" stopOpacity="0" />
          </radialGradient>
        </defs>
        <rect width={W} height={H} fill="#e2efd3" />
        <rect width={W} height={H} fill="url(#grain)" />
        <g className="roads">
          {roads.map((d, i) => (
            <path
              key={"edge" + i}
              d={d}
              pathLength={1}
              stroke="#c9dbb8"
              strokeWidth="34"
              fill="none"
              style={delay(i * 0.16)}
            />
          ))}
          {roads.map((d, i) => (
            <path
              key={"lane" + i}
              d={d}
              pathLength={1}
              stroke="#fbf9f3"
              strokeWidth="26"
              fill="none"
              style={delay(i * 0.16)}
            />
          ))}
        </g>
        <g className="pop" style={delay(0.5)}>
          <ellipse
            cx={pond.x}
            cy={pond.y}
            rx={pond.rx}
            ry={pond.ry}
            fill="#a9daea"
            stroke="#7fc0d6"
          />
          <path
            className="ripples"
            d="M726 380q18-6 34 0m-22 22q20-6 36 0"
            stroke="#6fb3cb"
            fill="none"
          />
        </g>
        <g transform={`translate(${commons.x},${commons.y})`}>
          <g className="pop" style={delay(0.45)}>
            <ellipse cy="12" rx="44" ry="21" fill="#c9dbb8" />
            <ellipse
              rx="36"
              ry="20"
              fill="#fbf9f3"
              stroke="#10201a"
              strokeWidth="1.6"
            />
            <ellipse
              cy="-6"
              rx="21"
              ry="11"
              fill="#a9daea"
              stroke="#10201a"
              strokeWidth="1.4"
            />
            <path
              d="M0-8v-30m-8 9q8-8 16 0"
              stroke="#10201a"
              fill="none"
              strokeWidth="2.4"
            />
            <circle className="drop" cx="-8" cy="-29" r="1.6" fill="#5fb3d0" />
            <circle
              className="drop late"
              cx="8"
              cy="-29"
              r="1.6"
              fill="#5fb3d0"
            />
          </g>
        </g>
        {scene.map((s) => {
          if ("tree" in s) {
            const { tree: t, i } = s;
            return (
              <g
                key={"t" + i}
                transform={`translate(${t.x.toFixed(1)},${t.y.toFixed(1)})`}
              >
                <g
                  className="tree"
                  style={{
                    ...delay(0.3 + growOrder[i] * 0.022),
                    ["--sway" as string]: 6 + (i % 5) * 0.9 + "s",
                    ["--phase" as string]: -(i % 7) * 0.9 + "s",
                  }}
                >
                  <g className={t.big ? "sway" : undefined}>
                    <path d="M0 15V-5" stroke="#3f6b45" strokeWidth="2" />
                    <ellipse
                      cy="-12"
                      rx={t.big ? 16 : 11}
                      ry={t.big ? 23 : 15}
                      fill={tones[t.tone]}
                    />
                    <path
                      d={
                        t.big
                          ? "M0 4v-30m0 14 6-7m-6 12-5-7"
                          : "M0 2v-22m0 10 5-6m-5 10-4-6"
                      }
                      stroke="#ffffff"
                      strokeOpacity=".35"
                      strokeWidth="1"
                      fill="none"
                    />
                  </g>
                </g>
              </g>
            );
          }
          const { home: a, i } = s;
          const p = plots[i],
            w = pill(a.name);
          return (
            <g
              key={a.id}
              transform={`translate(${p.x},${p.y})`}
              className={"cottage " + a.color}
              data-i={i}
              role="button"
              tabIndex={0}
              aria-label={`visit ${a.name}`}
              onClick={() => onAgent(a)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onAgent(a);
                }
              }}
            >
              <g className="pop" style={delay(0.75 + i * 0.12)}>
                <g className="lift">
                  <Cottage a={a} />
                  <g
                    transform="translate(44,41)"
                    className={
                      "at-home" + (walk.away.includes(a.id) ? " out" : "")
                    }
                  >
                    <g
                      className="resident"
                      style={{ ["--phase" as string]: -i * 0.7 + "s" }}
                    >
                      <path d="M0 0q-3-26 11-26T23 0Z" fill="currentColor" />
                      <g className="eyes">
                        <circle cx="7" cy="-12" r="1.5" fill="#10201a" />
                        <circle cx="15" cy="-12" r="1.5" fill="#10201a" />
                      </g>
                    </g>
                  </g>
                  <g transform="translate(62,-30)">
                    <g
                      className={
                        "bubble" +
                        (speaker === a.id &&
                        !walk.away.includes(a.id) &&
                        !talk.has(a.id)
                          ? " on"
                          : "")
                      }
                    >
                      <path
                        d="M-18-12h36a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H-1l-8 7v-7h-9a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6z"
                        fill="#ffffff"
                        stroke="#10201a"
                      />
                      {[-9, 0, 9].map((x, n) => (
                        <circle
                          key={x}
                          cx={x}
                          cy="-2"
                          r="2.1"
                          fill="#10201a"
                          style={{ ["--n" as string]: n * 0.2 + "s" }}
                        />
                      ))}
                    </g>
                  </g>
                </g>
              </g>
              <g transform={`translate(4,64) scale(${scale})`}>
                <g className="tag" style={delay(1.15 + i * 0.12)}>
                  <rect
                    x={-w / 2}
                    y="-12"
                    width={w}
                    height="24"
                    rx="12"
                    fill="#ffffff"
                    stroke="#10201a"
                    strokeOpacity=".18"
                  />
                  <text x={-w / 2 + 13} y="4" className="map-label">
                    {a.name}
                  </text>
                  <circle
                    cx={w / 2 - 12}
                    cy="0"
                    r="3"
                    fill={speaker === a.id ? "#e2553a" : "#1fa45a"}
                    className="tag-dot"
                  />
                </g>
              </g>
            </g>
          );
        })}
        <g className="goers">
          {homes.map((a) => (
            <g key={a.id} ref={walk.fig(a.id)} className={"goer " + a.color}>
              <g className="goer-face">
                <g className="goer-bob">
                  <ellipse cy="1" rx="10" ry="3" fill="#2f6b3a" opacity=".18" />
                  <path d="M-11 0q-3-26 11-26T12 0Z" fill="currentColor" />
                  <circle cx="-4" cy="-12" r="1.5" fill="#10201a" />
                  <circle cx="4" cy="-12" r="1.5" fill="#10201a" />
                </g>
              </g>
            </g>
          ))}
        </g>
        <g className="light" pointerEvents="none">
          <rect
            width={W}
            height={H}
            fill="#5f7aa6"
            className="light-multiply"
            style={{ opacity: lit.cool }}
          />
          <rect
            width={W}
            height={H}
            fill="#a3a9ad"
            className="light-multiply"
            style={{ opacity: lit.grey }}
          />
          <rect
            width={W}
            height={H}
            fill="url(#light-dusk)"
            style={{ opacity: lit.dusk }}
          />
          <rect
            width={W}
            height={H}
            fill="#ffcf7a"
            className="light-multiply"
            style={{ opacity: lit.warm }}
          />
          <rect
            width={W}
            height={H}
            fill="#ff8f3a"
            className="light-soft"
            style={{ opacity: lit.hot }}
          />
          <rect
            width={W}
            height={H}
            fill="url(#light-sun)"
            className="light-screen"
            style={{ opacity: lit.sun }}
          />
          {homes.map((a, i) => (
            <g
              key={a.id}
              transform={`translate(${plots[i].x},${plots[i].y})`}
              className="lamps"
              data-i={i}
              style={{ opacity: ready ? lit.lamps : 0 }}
            >
              <g className="lamp-lift">
                {[-23.5, 23.5].map((x) => (
                  <g key={x}>
                    <circle cx={x} cy="13.5" r="16" fill="url(#light-lamp)" />
                    <rect
                      x={x - 5.5}
                      y="8"
                      width="11"
                      height="11"
                      rx="2"
                      fill="#ffd86e"
                      stroke="#10201a"
                      strokeWidth="1.6"
                    />
                  </g>
                ))}
              </g>
            </g>
          ))}
        </g>
        <g
          transform={`translate(${commons.x},${commons.y + 44}) scale(${scale})`}
        >
          <g className="tag" style={delay(1)}>
            <text textAnchor="middle" y="4" className="map-label soft">
              the commons
            </text>
          </g>
        </g>
        {signs.map((r, n) => {
          const w = pill(r.name) + 6;
          return (
            <g
              key={r.id}
              transform={`translate(${r.left ? 14 : W - 14},${r.top ? 14 : H - 14}) scale(${scale})`}
              role="button"
              tabIndex={0}
              aria-label={"open the " + r.name}
              className="map-sign"
              onClick={() => onRoom(r.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onRoom(r.id);
                }
              }}
            >
              <g className="tag" style={delay(1.5 + n * 0.1)}>
                <rect
                  x={r.left ? 0 : -w}
                  y={r.top ? 0 : -27}
                  width={w}
                  height="27"
                  rx="3"
                  fill="#ffffff"
                  stroke="#10201a"
                  strokeOpacity=".25"
                />
                <text
                  x={r.left ? 11 : -w + 11}
                  y={r.top ? 18 : -9}
                  className="map-label"
                >
                  {r.name}
                </text>
                <path
                  d={`M${r.left ? w - 19 : -19} ${r.top ? 17 : -10}l6-6m-4 0h4v4`}
                  stroke="#10201a"
                  strokeWidth="1.2"
                  fill="none"
                  strokeLinecap="round"
                />
              </g>
            </g>
          );
        })}
        {fgText && (
          <g
            transform={`translate(14,${H - 12 - 22 * tagScale}) scale(${tagScale})`}
            className="map-note"
          >
            <g className="tag" style={delay(1.7)}>
              <rect
                width={sayWidth(fgText)}
                height="22"
                rx="11"
                fill="#ffffff"
                fillOpacity=".86"
              />
              <text
                x={sayWidth(fgText) / 2}
                y="15"
                textAnchor="middle"
                className="map-label small"
              >
                {fgText}
              </text>
            </g>
          </g>
        )}
        <g
          transform={`translate(${W - 14},${H - 20 - 27 * scale}) scale(${tagScale})`}
          className={"map-note due" + (dueText && ready ? " on" : "")}
        >
          <rect
            x={-sayWidth(dueText)}
            y="-22"
            width={sayWidth(dueText)}
            height="22"
            rx="11"
            fill="#10201a"
          />
          <text
            x={-sayWidth(dueText) / 2}
            y="-7"
            textAnchor="middle"
            className="map-label small light"
          >
            {dueText}
          </text>
        </g>
        <g className="says">
          {homes.map((a, i) => {
            const at = walk.pos(a.id) ?? homeAt(i),
              below = at[1] < 150,
              left = at[0] > W * 0.55,
              // Stack bubbles of residents standing close together.
              slot = homes
                .slice(0, i)
                .filter(
                  (b, j) =>
                    (talk.has(b.id) || speaker === b.id) &&
                    dist(walk.pos(b.id) ?? homeAt(j), at) < 120,
                ).length,
              t = said.current.get(a.id),
              dots =
                !talk.has(a.id) && speaker === a.id && walk.away.includes(a.id),
              w = dots ? 44 : t ? sayWidth(t.text) : 0,
              y = below ? 10 + slot * 30 : -58 - slot * 30,
              tip = left ? w - 16 : 16,
              lean = left ? 6 : -6,
              bx = left ? 6 - w : -6,
              box = w
                ? [bx, y - 8, bx + w, y + 32].map((n) => n * tagScale).join()
                : "0,0,0,0";
            return (
              <g key={a.id} ref={walk.say(a.id)} data-box={box}>
                <g transform={`scale(${tagScale})`}>
                  <g
                    className={"say" + (talk.has(a.id) || dots ? " on" : "")}
                    style={{
                      transformOrigin: `${left ? "100%" : "0"} ${below ? "0" : "100%"}`,
                    }}
                  >
                    {(t || dots) && (
                      <g
                        key={dots ? "dots" : t!.id}
                        transform={`translate(${bx},${y})`}
                      >
                        <rect
                          width={w}
                          height="24"
                          rx="8"
                          fill="#ffffff"
                          stroke="#10201a"
                        />
                        <path
                          d={
                            below
                              ? `M${tip} .5l${lean} -7 1 7`
                              : `M${tip} 23.5l${lean} 7 1-7`
                          }
                          fill="#ffffff"
                          stroke="#10201a"
                          strokeLinejoin="round"
                        />
                        {dots ? (
                          [13, 22, 31].map((x, n) => (
                            <circle
                              key={x}
                              cx={x}
                              cy="12"
                              r="2.1"
                              fill="#10201a"
                              className="say-dot"
                              style={{ ["--n" as string]: n * 0.2 + "s" }}
                            />
                          ))
                        ) : (
                          <text
                            x={w / 2}
                            y="16"
                            textAnchor="middle"
                            className="map-label small"
                          >
                            {t!.text}
                          </text>
                        )}
                      </g>
                    )}
                  </g>
                </g>
              </g>
            );
          })}
        </g>
      </svg>
      {
        <svg className="walkers" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {homes
            .filter(
              (a) =>
                !replay &&
                !walk.away.includes(a.id) &&
                (["researching", "thinking", "executing trade"].includes(
                  a.status,
                ) ||
                  (a.activity?.kind === "launched coin" &&
                    Date.now() - Date.parse(a.activity.created_at) < 1800000)),
            )
            .slice(0, 3)
            .map((a, i) => (
              <path
                key={a.id}
                className={"walker " + a.color}
                d="M-5 0q-1-12 5-12t5 12z"
                fill="currentColor"
                stroke="#10201a"
                strokeWidth=".8"
                style={{
                  offsetPath: `path("${roads[i]}")`,
                  animationDuration: [68, 82, 74][i] + "s",
                  animationDelay: [2.6, 9, 17][i] + "s",
                  animationDirection: i === 1 ? "reverse" : "normal",
                }}
              />
            ))}
        </svg>
      }
    </div>
  );
}

// The town plus a 24 hour replay bar; what the home page renders.
export function TownStage(props: {
  agents: Agent[];
  live: boolean;
  speaking?: string;
  onAgent: (a: Agent) => void;
  onRoom: (id: string) => void;
}) {
  const [frame, setFrame] = useState<ReplayFrame | null>(null);
  return (
    <>
      <Town {...props} replay={frame} />
      <Replay agents={props.agents} onFrame={setFrame} />
    </>
  );
}
