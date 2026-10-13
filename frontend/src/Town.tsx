import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type Agent } from "./api";
import type { Mood } from "./town-api";
import { Replay, type Dest, type ReplayFrame } from "./Replay";
import "./town-extras.css";
import { Resident, RESIDENT_IDS, Stitches, THREAD, pattern } from "./Stitch";

// The map is one old house drawn as an embroidered cutaway: attic lookout, three floors, three rooms each.
const W = 820,
  H = 640;
// Floor lines, where feet stand.
const GROUND = 572,
  FIRST = 448,
  SECOND = 324,
  ATTIC = 200;
const SOIL = 588;
const WALL_L = 90,
  WALL_R = 730;
const APEX: Pt = [410, 44];
const EAVE_L: Pt = [52, 206],
  EAVE_R: Pt = [768, 206];
// Underside of the roof, which is also the lookout's sloped ceiling.
const RAFTER_L: Pt = [WALL_L, ATTIC],
  RAFTER_R: Pt = [WALL_R, ATTIC],
  RIDGE: Pt = [410, 86];
type Pt = [number, number];
type Thread = { b: string; o: string; h: string; a: string };
const CELL = 3.4; // one stitch on the map, in viewBox units
const INK = "#2b2219";
const HOUSE_THREAD: Thread = {
  o: "#6c5137",
  b: "#b85c38",
  h: "#e2b056",
  a: "#5f8a3c",
};
const SAGE_FRAME = "#8ba16d";

interface Room {
  key: string;
  floor: number;
  x0: number;
  x1: number;
  home?: number;
  label?: string;
  labelX?: number;
}
const ceilingOf = (floor: number) =>
  floor === GROUND ? FIRST : floor === FIRST ? SECOND : ATTIC;
const ROOMS: Room[] = [
  { key: "rook", floor: SECOND, x0: WALL_L, x1: 295, home: 210 },
  { key: "flicker", floor: SECOND, x0: 295, x1: 525, home: 410, labelX: 362 },
  { key: "echo", floor: SECOND, x0: 525, x1: WALL_R, home: 646 },
  { key: "moss", floor: FIRST, x0: WALL_L, x1: 295, home: 200 },
  { key: "research", floor: FIRST, x0: 295, x1: 525, label: "Reading room" },
  { key: "vale", floor: FIRST, x0: 525, x1: WALL_R, home: 640 },
  { key: "pip", floor: GROUND, x0: WALL_L, x1: 275, home: 182 },
  { key: "commons", floor: GROUND, x0: 275, x1: 545, label: "Sitting room", labelX: 388 },
  { key: "launches", floor: GROUND, x0: 545, x1: WALL_R, label: "Workshop" },
];
// Rooms a new neighbourhood's residents move into, in order, when their name is not a room.
const MOVE_IN = ["rook", "flicker", "echo", "moss", "vale", "pip"];
// Stairs between floors, bottom then top; the last one is the ladder to the lookout.
const STAIRS: [Pt, Pt][] = [
  [
    [296, GROUND],
    [398, FIRST],
  ],
  [
    [420, FIRST],
    [510, SECOND],
  ],
  [
    [326, SECOND],
    [340, ATTIC],
  ],
];
// Where residents stand when they visit a shared room; the lookout doubles as the risk room.
const spots: Record<Dest, Pt[]> = {
  research: [
    [318, FIRST],
    [358, FIRST],
    [398, FIRST],
    [476, FIRST],
  ],
  commons: [
    [424, GROUND],
    [470, GROUND],
    [516, GROUND],
    [378, GROUND],
  ],
  launches: [
    [580, GROUND],
    [622, GROUND],
    [664, GROUND],
    [706, GROUND],
  ],
  risk: [
    [380, ATTIC],
    [426, ATTIC],
    [472, ATTIC],
    [518, ATTIC],
  ],
};
// Small stitched furniture, one character per stitch: o outline, b body, h light, a accent.
const GLYPH: Record<string, string[]> = {
  lamp: ["..hhh..", ".hhhhh.", "hhhhhhh", "...o...", "...o...", "...o...", "...o...", "...o...", "..ooo.."],
  desklamp: [".hhh.", "hhhhh", "..o..", "..o..", ".ooo."],
  desk: ["ooooooooooo", "o.........o", "o.........o", "o.........o", "o.........o"],
  seeds: ["a...a...a", "b.b.b.b.b", ".b..b..b.", "ooooooooo"],
  map: ["ooooooooo", "o..a....o", "o.aaa.h.o", "o..a..hho", "o.....h.o", "ooooooooo"],
  magnifier: [".ooo...", "o.h.o..", "o...o..", ".ooo...", "....o..", ".....o."],
  radio: [".....o..", "....o...", "oooooooo", "ohh.a.ao", "ohh....o", "oooooooo"],
  shelf: ["ooooooooooo", "bha.bab.hab", "ooooooooooo", "a.hbb.ahb.b", "ooooooooooo"],
  sofa: [".bbbbbbbbbbb.", "bbhhhhhhhhhbb", "bbbbbbbbbbbbb", "o...........o"],
  bench: ["ooooooooooooo", "o.....hh....o", "o...........o", "o...........o"],
  hammer: ["oooo", ".o..", ".o..", ".o.."],
  saw: ["ooooooo", "ooooo..", "o......"],
  frame: ["ooooo", "ohaho", "obhbo", "ooooo"],
  clock: [".ooo.", "o.h.o", "o.hho", "o...o", ".ooo."],
  crate: ["oooooo", "oh..ho", "o.hh.o", "oh..ho", "oooooo"],
  chest: [".oooooo.", "ohhhhhho", "oooaoooo", "obbbbbbo", "oooooooo"],
  telescope: ["......hh", "....hhh.", "..hhh...", "hh..o...", "...o.o..", "..o...o.", ".o.....o"],
};
interface Item {
  g: string;
  x: number;
  up?: number;
  lit?: boolean;
}
const FURNITURE: Record<string, Item[]> = {
  rook: [
    { g: "frame", x: 132, up: 58 },
    { g: "desk", x: 136 },
    { g: "magnifier", x: 132, up: 17 },
  ],
  flicker: [
    { g: "clock", x: 474, up: 58 },
    { g: "desk", x: 474 },
    { g: "desklamp", x: 482, up: 17, lit: true },
  ],
  echo: [
    { g: "frame", x: 580, up: 58 },
    { g: "desk", x: 580 },
    { g: "radio", x: 578, up: 17 },
    { g: "lamp", x: 706, lit: true },
  ],
  moss: [
    { g: "clock", x: 140, up: 58 },
    { g: "seeds", x: 138 },
    { g: "lamp", x: 264, lit: true },
  ],
  vale: [
    { g: "map", x: 580, up: 52 },
    { g: "desk", x: 696 },
    { g: "desklamp", x: 700, up: 17, lit: true },
  ],
  pip: [
    { g: "frame", x: 126, up: 58 },
    { g: "seeds", x: 126 },
    { g: "lamp", x: 246, lit: true },
  ],
  research: [{ g: "shelf", x: 352, up: 52 }],
  commons: [
    { g: "sofa", x: 476 },
    { g: "lamp", x: 528, lit: true },
  ],
  launches: [
    { g: "bench", x: 686 },
    { g: "crate", x: 590 },
    { g: "hammer", x: 600, up: 50 },
    { g: "saw", x: 626, up: 52 },
  ],
};
const WINDOWS = ROOMS.filter((r) => !r.label).map((r, i) => ({
  x: r.x1 - 42,
  y: ceilingOf(r.floor) + 22,
  curtain: i % 2 === 0,
}));
const roomFor = (agents: Agent[]) => {
  const taken = new Set<string>();
  const out = new Map<string, Room>();
  agents.forEach((a) => {
    const own = ROOMS.find((r) => r.key === a.id && r.home !== undefined);
    if (own && !taken.has(own.key)) {
      taken.add(own.key);
      out.set(a.id, own);
    }
  });
  agents.forEach((a) => {
    if (out.has(a.id)) return;
    const k = MOVE_IN.find((k) => !taken.has(k));
    if (!k) return;
    taken.add(k);
    out.set(a.id, ROOMS.find((r) => r.key === k)!);
  });
  return out;
};

function dist(a: Pt, b: Pt) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
// Walkable graph: every floor is a line, the stairs join them.
const graph = (() => {
  const nodes: Pt[] = [];
  const at = (p: Pt) => {
    const i = nodes.findIndex((n) => dist(n, p) < 0.5);
    if (i >= 0) return i;
    nodes.push(p);
    return nodes.length - 1;
  };
  ROOMS.forEach((r) => r.home !== undefined && at([r.home, r.floor]));
  Object.values(spots).flat().forEach(at);
  STAIRS.flat().forEach(at);
  const edges: [number, number][] = [];
  [GROUND, FIRST, SECOND, ATTIC].forEach((y) => {
    const row = nodes
      .map((p, i) => ({ p, i }))
      .filter((n) => n.p[1] === y)
      .sort((l, r) => l.p[0] - r.p[0]);
    row.forEach((n, k) => k && edges.push([row[k - 1].i, n.i]));
  });
  STAIRS.forEach(([a, b]) => edges.push([at(a), at(b)]));
  return { nodes, edges };
})();
// Where a point sits on the walk, as the nearest edge and the spot on it.
function attach(p: Pt) {
  let best = { d: Infinity, a: 0, b: 0, q: p };
  for (const [a, b] of graph.edges) {
    const A = graph.nodes[a],
      B = graph.nodes[b];
    const dx = B[0] - A[0],
      dy = B[1] - A[1];
    const t = Math.max(
      0,
      Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dy) / (dx * dx + dy * dy || 1)),
    );
    const q: Pt = [A[0] + dx * t, A[1] + dy * t];
    const d = dist(p, q);
    if (d < best.d) best = { d, a, b, q };
  }
  return best;
}
// Shortest walk along floors and stairs.
function route(from: Pt, to: Pt): Pt[] {
  const s0 = attach(from),
    e0 = attach(to);
  if (s0.a === e0.a && s0.b === e0.b) return [from, s0.q, e0.q, to];
  const nodes = [...graph.nodes, s0.q, e0.q];
  const s = nodes.length - 2,
    e = nodes.length - 1;
  const links = nodes.map((): number[] => []);
  const join = (a: number, b: number) => (links[a].push(b), links[b].push(a));
  graph.edges.forEach(([a, b]) => join(a, b));
  join(s, s0.a);
  join(s, s0.b);
  join(e, e0.a);
  join(e, e0.b);
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
  return [from, ...out, to].filter((p, i, all) => !i || dist(p, all[i - 1]) > 0.5);
}
// Deterministic scatter for stones, grass and flowers.
const rng = (seed: number) => () =>
  ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const stones = (() => {
  const rand = rng(11);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  const band = (x0: number, x1: number, y0: number, y1: number, rows: number) => {
    const rh = (y1 - y0) / rows;
    for (let r = 0; r < rows; r++) {
      let x = x0 + (r % 2 ? -rand() * 8 : 0);
      while (x < x1 - 4) {
        const w = Math.min(x1 - x, 14 + rand() * 18);
        if (w > 5)
          out.push({ x: Math.max(x0, x) + 1, y: y0 + r * rh + 1, w: w - 2, h: rh - 2 });
        x += w;
      }
    }
  };
  band(72, WALL_L, ATTIC + 6, SOIL, 29);
  band(WALL_R, 748, ATTIC + 6, SOIL, 29);
  band(72, 748, GROUND + 1, SOIL, 1);
  band(556, 588, 84, 132, 4);
  return out;
})();
const meadow = (() => {
  const rand = rng(5);
  const grass: { x: number; y: number; h: number; lean: number }[] = [];
  const knots: { x: number; y: number; c: string }[] = [];
  for (let x = 22; x < W - 18; x += 9 + rand() * 12) {
    const y = SOIL + 4 + rand() * 40;
    if (y > H - 46 && (x < 300 || x > 520)) continue;
    grass.push({ x, y, h: 5 + rand() * 6, lean: rand() * 4 - 2 });
  }
  const tones = ["#cf7a52", "#e2b056", "#a585aa", "#efd08d", "#c9604a"];
  [
    [30, 70],
    [752, 800],
    [300, 520],
  ].forEach(([a, b], n) => {
    for (let k = 0; k < (n === 2 ? 5 : 7); k++)
      knots.push({
        x: a + rand() * (b - a),
        y: n === 2 ? SOIL + 8 + rand() * 8 : SOIL - 6 - rand() * 46,
        c: tones[Math.floor(rand() * tones.length)],
      });
  });
  return { grass, knots };
})();
const delay = (s: number) => ({ ["--d" as string]: s.toFixed(2) + "s" });
const BY_COLOR: Record<string, string> = {
  sage: "moss",
  coral: "flicker",
  slate: "rook",
  ochre: "pip",
  lavender: "vale",
  blue: "echo",
};
const who = (id: string, color: string) =>
  RESIDENT_IDS.includes(id) ? id : (BY_COLOR[color] ?? "moss");
// A resident's stitched portrait. House residents are recognised by color, so callers only pass the color.
export function Face({
  color = "sage",
  size = 36,
  id,
}: {
  color?: string;
  size?: number;
  id?: string;
}) {
  const who = id && RESIDENT_IDS.includes(id) ? id : (BY_COLOR[color] ?? "moss");
  return <Resident id={who} color={color} size={size} className={"face " + color} />;
}
// A cross-stitch glyph drawn with an explicit thread set.
function Cross({ rows, t }: { rows: string[]; t: Thread }) {
  return (
    <g transform={`scale(${CELL})`} strokeWidth={0.34} strokeLinecap="round">
      {rows.flatMap((r, y) =>
        [...r].map((ch, x) =>
          ch === "." ? null : (
            <path
              key={x + "-" + y}
              d={`M${x + 0.16} ${y + 0.16}L${x + 0.84} ${y + 0.84}M${x + 0.84} ${y + 0.16}L${x + 0.16} ${y + 0.84}`}
              stroke={t[ch as keyof Thread] ?? INK}
            />
          ),
        ),
      )}
    </g>
  );
}
function Glyph({ item, floor, t }: { item: Item; floor: number; t: Thread }) {
  const rows = GLYPH[item.g];
  const w = rows[0].length * CELL,
    h = rows.length * CELL;
  return (
    <g transform={`translate(${item.x - w / 2},${floor - (item.up ?? 0) - h})`}>
      <Cross rows={rows} t={t} />
    </g>
  );
}
// A room name in the serif; shared rooms get a small stitched arrow because they open a page.
function Label({
  x,
  y,
  scale,
  text,
  shared,
  arrow = true,
  color,
}: {
  x: number;
  y: number;
  scale: number;
  text: string;
  shared?: boolean;
  arrow?: boolean;
  color?: string;
}) {
  const ref = useRef<SVGTextElement>(null);
  const [w, setW] = useState(text.length * 8);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.getComputedTextLength());
    measure();
    document.fonts?.ready.then(measure);
  }, [text]);
  return (
    <g transform={`translate(${x},${y}) scale(${scale})`}>
      <text
        ref={ref}
        className={"map-label " + (shared ? "room-label" : "room-name")}
        style={color ? { fill: color } : undefined}
      >
        {text}
      </text>
      {shared && arrow && (
        <path
          d={`M${w + 5} -2.5l6.5-6.5m-4.5 0h4.5v4.5`}
          stroke="#6c5f50"
          strokeWidth="1.2"
          fill="none"
          strokeLinecap="round"
        />
      )}
    </g>
  );
}
// A run of stitches along a path: running stitch is dashed, backstitch nearly solid.
const RUN = { strokeDasharray: "5 4", strokeLinecap: "round" as const };
const BACK = { strokeDasharray: "7 1.4", strokeLinecap: "round" as const };
function Stairs({ a, b, ladder }: { a: Pt; b: Pt; ladder?: boolean }) {
  const n = ladder ? 7 : 8;
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  if (ladder)
    return (
      <g stroke="#7a5a3a" strokeWidth="1.6" fill="none" {...BACK}>
        <path d={`M${a[0] - 9} ${a[1]}L${b[0] - 9} ${b[1]}M${a[0] + 9} ${a[1]}L${b[0] + 9} ${b[1]}`} />
        {Array.from({ length: n }, (_, k) => {
          const f = (k + 0.6) / n;
          const x = a[0] + dx * f,
            y = a[1] + dy * f;
          return <path key={k} d={`M${x - 9} ${y}h18`} strokeDasharray="none" />;
        })}
      </g>
    );
  const dir = Math.sign(dx);
  const step = Math.abs(dx) / n,
    rise = dy / n;
  let d = `M${a[0]} ${a[1]}`;
  for (let k = 0; k < n; k++) d += `v${rise}h${dir * step}`;
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d={`M${a[0]} ${a[1]}L${b[0]} ${b[1]}`} stroke="#7a5a3a" strokeWidth="1.4" {...RUN} />
      <path d={d} stroke="#7a5a3a" strokeWidth="1.6" {...BACK} />
    </g>
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
  step: number;
}
// Walks residents between their room and wherever they are needed, one frame at a time.
function useGoers(
  homes: Agent[],
  homeOf: (id: string) => Pt,
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
  const home = useRef(homeOf);
  home.current = homeOf;
  const paint = (id: string, g: Goer) => {
    const [x, y] = g.pos;
    const fig = figs.current.get(id),
      say = says.current.get(id);
    fig?.setAttribute("transform", `translate(${x.toFixed(1)},${y.toFixed(1)})`);
    if (say) {
      // Bubbles slide to stay inside the map.
      const [x0, y0, x1, y1] = (say.dataset.box ?? "0,0,0,0").split(",").map(Number);
      const sx = Math.min(Math.max(x, 4 - x0), W - 4 - x1),
        sy = Math.min(Math.max(y, 4 - y0), H - 4 - y1);
      say.setAttribute("transform", `translate(${sx.toFixed(1)},${sy.toFixed(1)})`);
    }
    if (fig) {
      fig.toggleAttribute("data-moving", g.moving);
      fig.toggleAttribute("data-left", g.left);
      fig.setAttribute("data-step", String(g.moving ? g.step : 0));
    }
  };
  const crew = useRef(homes);
  crew.current = homes;
  const sync = () => {
    const out = crew.current
      .filter((a) => {
        const g = goers.current.get(a.id);
        return g && (g.moving || dist(g.pos, home.current(a.id)) > 1);
      })
      .map((a) => a.id);
    crew.current.forEach((a) =>
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
      const d = ease(e) * g.lens[g.lens.length - 1];
      let k = 1;
      while (k < g.path.length - 1 && g.lens[k] < d) k++;
      const a = g.path[k - 1],
        b = g.path[k],
        seg = g.lens[k] - g.lens[k - 1] || 1,
        f = Math.min(1, Math.max(0, (d - g.lens[k - 1]) / seg));
      g.pos = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
      if (Math.abs(b[0] - a[0]) > 4) g.left = b[0] < a[0];
      // One step frame per 7 units walked, so feet keep pace with the floor.
      g.step = Math.floor(d / 7) % 2;
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
    homes.forEach((a) => {
      const start = homeOf(a.id);
      const goal = goals[a.id] ?? start;
      let g = goers.current.get(a.id);
      if (!g) {
        g = {
          pos: start,
          goal: start,
          path: [],
          lens: [0],
          t0: now,
          dur: 1,
          moving: false,
          left: false,
          step: 0,
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
      if (path.length < 2) {
        g.pos = goal;
        g.moving = false;
        return paint(a.id, g);
      }
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
const sayWidth = (text: string) => text.length * 6.6 + 22;
const press = (fn: () => void) => ({
  role: "button",
  tabIndex: 0,
  onClick: fn,
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  },
});
// The roof slope at x, for the lookout ceiling and the roof band.
const slope = (a: Pt, b: Pt, x: number) => a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0]);
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
  const [narrow, setNarrow] = useState(false);
  const [ready, setReady] = useState(false);
  // Labels keep a readable on-screen size when the map is drawn small.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const w = el.clientWidth || W;
      setScale(Math.min(1.9, Math.max(1, 680 / w)));
      setNarrow(w < 480);
    };
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
  const homes = agents.slice(0, 6);
  const rooms = roomFor(homes);
  const occupant = new Map([...rooms].map(([id, r]) => [r.key, homes.find((a) => a.id === id)!]));
  const homeOf = (id: string): Pt => {
    const r = rooms.get(id);
    return r ? [r.home!, r.floor] : [456, GROUND];
  };
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
    [c.agent_id, c.rival_id].forEach((id) => id && ids.has(id) && (dest[id] = "risk")),
  );
  const goals: Record<string, Pt> = {};
  if (ready && live) {
    const filled: Record<string, number> = {};
    homes.forEach((a) => {
      const d = dest[a.id];
      if (!d) return;
      const n = (filled[d] = (filled[d] ?? -1) + 1),
        [x, y] = spots[d][n % spots[d].length];
      goals[a.id] = [x + Math.floor(n / spots[d].length) * 14, y];
    });
  }
  const walk = useGoers(homes, homeOf, goals, replay ? 240 : 40, !!replay?.instant);
  const lit = lightFor(mood?.fear_greed?.value ?? null);
  // Each excerpt stays up long enough to read, even while the replay runs fast.
  const [talk, setTalk] = useState(new Map<string, { id: number; text: string; until: number }>());
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
        const same = next.size === cur.size && [...next].every(([k, v]) => cur.get(k) === v);
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
  const fgText = fg ? `Fear and greed ${fg.value}, ${fg.label.toLowerCase()}` : "";
  const dueText = due.length
    ? `${due[0].asset.toUpperCase()} call ${due[0].when}` +
      (due.length > 1 ? `, ${due.length - 1} more` : "")
    : "";
  const tagScale = Math.min(scale, 1.6);
  const labelScale = Math.min(scale, narrow ? 1.75 : 1.5);
  const cross = !narrow;
  // Residents are drawn a little larger on phones so their faces still read.
  const big = narrow ? 1.25 : 1;
  const vx = narrow ? 44 : 0,
    vw = narrow ? 732 : W;
  const threadOf = (a?: Agent): Thread =>
    a ? (THREAD[a.color] ?? THREAD.sage) : { o: "#cdbfa8", b: "#ddd0bb", h: "#ebe2d2", a: "#cdbfa8" };
  const roof = `M${EAVE_L[0]} ${EAVE_L[1]}L${APEX[0]} ${APEX[1]}L${EAVE_R[0]} ${EAVE_R[1]}L${RAFTER_R[0] + 18} ${ATTIC + 6}L${RIDGE[0]} ${RIDGE[1]}L${RAFTER_L[0] - 18} ${ATTIC + 6}Z`;
  const shell = `M${EAVE_L[0]} ${EAVE_L[1]}L${APEX[0]} ${APEX[1]}L${EAVE_R[0]} ${EAVE_R[1]}L748 ${EAVE_R[1]}V${SOIL}H72V${EAVE_L[1]}Z`;
  const attic = `M${RAFTER_L[0]} ${ATTIC}L${RIDGE[0]} ${RIDGE[1]}L${RAFTER_R[0]} ${ATTIC}Z`;
  const chimneyBase = slope(APEX, EAVE_R, 588);
  return (
    <div ref={box} className={"town-scene house-map" + (ready ? " is-ready" : "")}>
      <svg
        viewBox={`${vx} 0 ${vw} ${H}`}
        role="img"
        aria-label="murmur house map: six resident rooms, the reading room, the workshop, the sitting room and the lookout"
      >
        <defs>
          <pattern id="h-weave" width="4" height="4" patternUnits="userSpaceOnUse">
            <path d="M0 1.2h4" stroke="#6c5f50" strokeWidth=".7" opacity=".09" />
            <path d="M2.8 0v4" stroke="#6c5f50" strokeWidth=".6" opacity=".07" />
          </pattern>
          <pattern id="h-slub" width="53" height="31" patternUnits="userSpaceOnUse">
            <path d="M4 7h9M31 19h12M18 27h6M44 3h5" stroke="#6c5f50" strokeWidth=".9" opacity=".08" strokeLinecap="round" />
            <path d="M12 14v7M38 25v5" stroke="#fbf7ef" strokeWidth="1" opacity=".5" strokeLinecap="round" />
          </pattern>
          <pattern id="h-tiles" width="12" height="10" patternUnits="userSpaceOnUse">
            <g strokeWidth="1.15" strokeLinecap="round">
              <path d="M1.2 1.2l3.6 3.6M4.8 1.2l-3.6 3.6" stroke="#b85c38" />
              <path d="M7.2 1.2l3.6 3.6M10.8 1.2l-3.6 3.6" stroke="#c46a43" />
              <path d="M4.2 6.2l3.6 3.6M7.8 6.2l-3.6 3.6" stroke="#a4502f" />
              <path d="M10.2 6.2l3.6 3.6M13.8 6.2l-3.6 3.6M-1.8 6.2l3.6 3.6M1.8 6.2l-3.6 3.6" stroke="#b85c38" />
            </g>
          </pattern>
          <radialGradient id="h-lamp">
            <stop offset="0" stopColor="#e2b056" stopOpacity=".55" />
            <stop offset="1" stopColor="#e2b056" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="h-sun" cx="86%" cy="6%" r="80%">
            <stop offset="0" stopColor="#f3cf86" stopOpacity=".9" />
            <stop offset=".6" stopColor="#e2b056" stopOpacity=".25" />
            <stop offset="1" stopColor="#e2b056" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="h-dusk" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2e3a57" stopOpacity=".85" />
            <stop offset="1" stopColor="#4a5a7a" stopOpacity=".2" />
          </linearGradient>
          <clipPath id="h-outside">
            <path d={`M0 0H${W}V${H}H0Z${shell}`} clipRule="evenodd" />
          </clipPath>
        </defs>
        {/* Linen, sky and the stitched frame. */}
        <rect x="0" width={W} height={H} style={{ fill: "var(--linen)" }} />
        <rect width={W} height={SOIL} fill="#d9e0d8" opacity=".38" />
        <rect width={W} height={H} fill="url(#h-weave)" />
        <rect width={W} height={H} fill="url(#h-slub)" />
        <rect width={W} height={SOIL} fill="url(#h-dusk)" style={{ opacity: lit.dusk + lit.cool * 0.5 }} className="h-fade" />
        <rect width={W} height={SOIL} fill="url(#h-sun)" style={{ opacity: lit.sun }} className="h-fade" />
        <g className="h-in" style={delay(0.1)}>
          {lit.dusk > 0.05 ? (
            <g className="h-stars" style={{ opacity: Math.min(1, lit.dusk * 2) }}>
              {[
                [96, 58],
                [168, 112],
                [640, 40],
                [716, 96],
                [250, 34],
                [778, 150],
                [40, 150],
              ].map(([x, y], n) => (
                <circle key={n} cx={x} cy={y} r="1.6" fill="#efd08d" style={{ ["--n" as string]: n * 0.7 + "s" }} />
              ))}
              <path d="M128 62a16 16 0 1 0 16 22a12 12 0 1 1-16-22z" fill="none" stroke="#efd08d" strokeWidth="1.4" {...RUN} />
            </g>
          ) : (
            <g className="h-sunmark" style={{ opacity: 0.45 + lit.sun * 0.8 }}>
              <circle cx="716" cy="72" r="20" fill="none" stroke="#dcab4a" strokeWidth="1.6" {...RUN} />
              <circle cx="716" cy="72" r="2" fill="#dcab4a" />
              {Array.from({ length: 10 }, (_, k) => {
                const t = (k / 10) * Math.PI * 2;
                return (
                  <path
                    key={k}
                    d={`M${716 + Math.cos(t) * 26} ${72 + Math.sin(t) * 26}L${716 + Math.cos(t) * 33} ${72 + Math.sin(t) * 33}`}
                    stroke="#dcab4a"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                );
              })}
            </g>
          )}
          <g className="h-cloud">
            <path d="M70 120q4-14 18-10q6-12 20-6q12-4 16 8q12 2 8 10z" fill="none" stroke="#a9b8c7" strokeWidth="1.4" {...RUN} />
          </g>
        </g>
        <rect
          x="10"
          y="10"
          width={W - 20}
          height={H - 20}
          rx="20"
          fill="none"
          stroke="#cdbfa8"
          strokeWidth="1.6"
          {...RUN}
          className="h-frame"
        />
        {/* Ground, grass stitches and french knots. */}
        <g className="h-in" style={delay(0)}>
          <path d={`M22 ${SOIL}H${W - 22}`} stroke="#4c5e34" strokeWidth="1.8" {...BACK} />
          {meadow.grass.map((g, n) => (
            <path
              key={n}
              d={`M${g.x - 2} ${g.y}l${g.lean - 1} -${g.h}M${g.x + 2} ${g.y}l${g.lean + 1.5} -${g.h * 0.8}`}
              stroke={n % 3 ? "#8ba16d" : "#5f8a3c"}
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          ))}
          {[22, 34, 46, 58, 772, 784, 796].map((x, n) => (
            <path
              key={"tall" + n}
              d={`M${x} ${SOIL}q${n % 2 ? 3 : -3} -${16 + (n % 3) * 9} ${n % 2 ? 1 : -1} -${30 + (n % 3) * 12}`}
              stroke="#8ba16d"
              strokeWidth="1.3"
              fill="none"
              {...RUN}
              className="h-stem"
              style={{ ["--n" as string]: -n * 0.8 + "s" }}
            />
          ))}
          {meadow.knots.map((k, n) => (
            <circle key={n} cx={k.x} cy={k.y} r="2.4" fill={k.c} />
          ))}
        </g>
        {/* The house shell: stone walls, plaster rooms, floors, roof and chimney. */}
        <g className="h-in" style={delay(0.2)}>
          <rect x={WALL_L} y={ATTIC} width={WALL_R - WALL_L} height={GROUND - ATTIC} style={{ fill: "var(--card)" }} opacity=".82" />
          <path d={attic} style={{ fill: "var(--card)" }} opacity=".82" />
          {stones.map((s, n) => (
            <rect
              key={n}
              x={s.x}
              y={s.y}
              width={s.w}
              height={s.h}
              rx="3"
              fill={n % 4 ? "#e3d8c4" : "#d8cab2"}
              stroke="#8f7c63"
              strokeWidth="1"
              strokeDasharray="4 1.2"
            />
          ))}
          <path
            d={`M72 ${SOIL}V${ATTIC + 6}M748 ${SOIL}V${ATTIC + 6}M${WALL_L} ${GROUND}V${ATTIC}M${WALL_R} ${GROUND}V${ATTIC}`}
            stroke="#6c5137"
            strokeWidth="1.6"
            {...BACK}
          />
          {[FIRST, SECOND, ATTIC].map((y) => (
            <path key={y} d={`M${WALL_L} ${y}H${WALL_R}`} stroke="#6c5137" strokeWidth={y === ATTIC ? 2.2 : 1.8} />
          ))}
          <path d={`M${WALL_L} ${GROUND}H${WALL_R}`} stroke="#6c5137" strokeWidth="1.8" />
        </g>
        <g className="h-in" style={delay(0.35)}>
          <path d={`M556 ${slope(APEX, EAVE_R, 556) + 2}V82H588V${chimneyBase + 2}`} stroke="#6c5137" strokeWidth="1.6" fill="none" {...BACK} />
          <path d="M552 80h40" stroke="#6c5137" strokeWidth="2" strokeLinecap="round" />
          <g className="h-smoke" fill="none" stroke="#a9a091" strokeWidth="1.4" {...RUN}>
            <path d="M570 70q-8-10 2-18t0-18" />
            <path d="M578 66q8-12-2-20t2-16" style={{ animationDelay: "-2.4s" }} />
          </g>
          <path d={roof} fill="url(#h-tiles)" />
          <path d={roof} fill="#b85c38" opacity=".08" />
          <path
            d={`M${EAVE_L[0]} ${EAVE_L[1]}L${APEX[0]} ${APEX[1]}L${EAVE_R[0]} ${EAVE_R[1]}`}
            stroke="#8a4127"
            strokeWidth="2"
            fill="none"
            strokeLinejoin="round"
            {...BACK}
          />
          <path
            d={`M${RAFTER_L[0] - 18} ${ATTIC + 6}L${RIDGE[0]} ${RIDGE[1]}L${RAFTER_R[0] + 18} ${ATTIC + 6}`}
            stroke="#8a4127"
            strokeWidth="1.4"
            fill="none"
            {...RUN}
          />
          <path d={`M${EAVE_L[0]} ${EAVE_L[1]}L${RAFTER_L[0] - 18} ${ATTIC + 6}M${EAVE_R[0]} ${EAVE_R[1]}L${RAFTER_R[0] + 18} ${ATTIC + 6}`} stroke="#8a4127" strokeWidth="1.6" strokeLinecap="round" />
        </g>
        {/* Rooms: running stitch outlines, windows, furniture, labels. */}
        <g className="h-in" style={delay(0.45)}>
          {STAIRS.map(([a, b], n) => (
            <Stairs key={n} a={a} b={b} ladder={n === 2} />
          ))}
        </g>
        {ROOMS.map((r, i) => {
          const top = ceilingOf(r.floor);
          const a = occupant.get(r.key);
          const t = r.label ? HOUSE_THREAD : threadOf(a);
          const act = r.label
            ? press(() => onRoom(r.key))
            : a
              ? press(() => onAgent(a))
              : {};
          const name = r.label ?? a?.name;
          return (
            <g
              key={r.key}
              className={"h-room" + (r.label ? " shared" : a ? " lived" : " empty")}
              data-i={a ? homes.indexOf(a) : undefined}
              aria-label={r.label ? "Open the " + r.label.toLowerCase() : a ? "Visit " + a.name : undefined}
              {...act}
            >
              <g className="h-in" style={delay(0.55 + i * 0.06)}>
                <rect
                  className="h-room-glow"
                  x={r.x0 + 4}
                  y={top + 4}
                  width={r.x1 - r.x0 - 8}
                  height={r.floor - top - 6}
                  rx="6"
                />
                <rect
                  x={r.x0 + 7}
                  y={top + 7}
                  width={r.x1 - r.x0 - 14}
                  height={r.floor - top - 12}
                  rx="5"
                  fill="none"
                  stroke={r.label ? "#b9a88f" : t.h}
                  strokeWidth="1.4"
                  {...RUN}
                />
                {!narrow &&
                  (FURNITURE[r.key] ?? []).map((it, n) => (
                    <g key={n} className={"h-furniture" + (it.lit ? " lamp" : "")}>
                      <Glyph item={it} floor={r.floor} t={t} />
                    </g>
                  ))}
                {r.key === "commons" && (
                  <ellipse cx="468" cy={r.floor - 4} rx="62" ry="6" fill="none" stroke="#e2b056" strokeWidth="1.6" {...RUN} />
                )}
                {a && r.home !== undefined && (
                  <ellipse
                    cx={r.home}
                    cy={r.floor - 4}
                    rx="34"
                    ry="5"
                    fill="none"
                    stroke={t.h}
                    strokeWidth="1.6"
                    {...RUN}
                  />
                )}
                {name && (
                  <Label
                    x={r.labelX ?? r.x0 + 17}
                    y={top + 24}
                    scale={labelScale}
                    text={name}
                    shared={!!r.label}
                    arrow={!narrow}
                    color={r.label ? undefined : t.o}
                  />
                )}
              </g>
            </g>
          );
        })}
        {/* The lookout under the roof, with its round window. */}
        <g className="h-room shared" {...press(() => onRoom("risk"))} aria-label="Open the lookout">
          <g className="h-in" style={delay(0.5)}>
            <path className="h-room-glow" d={attic} />
            <path
              d={`M${RAFTER_L[0] + 22} ${ATTIC - 6}L${RIDGE[0]} ${RIDGE[1] + 12}L${RAFTER_R[0] - 22} ${ATTIC - 6}Z`}
              fill="none"
              stroke="#b9a88f"
              strokeWidth="1.4"
              strokeLinejoin="round"
              {...RUN}
            />
            <circle cx="410" cy="132" r="19" fill="#d9e0d8" className="h-pane" />
            <circle cx="410" cy="132" r="19" fill="#e2b056" style={{ opacity: lit.lamps * 0.85 }} className="h-fade" />
            <g stroke={SAGE_FRAME} strokeWidth="1.6" fill="none" strokeLinecap="round">
              <circle cx="410" cy="132" r="19" {...BACK} />
              <path d="M391 132h38M410 113v38" />
            </g>
            {!narrow && (
              <g className="h-furniture">
                <Glyph item={{ g: "telescope", x: 262 }} floor={ATTIC} t={HOUSE_THREAD} />
                <Glyph item={{ g: "chest", x: 572 }} floor={ATTIC} t={HOUSE_THREAD} />
              </g>
            )}
            <Label x={446} y={ATTIC - 54} scale={labelScale} text="Lookout" shared arrow={!narrow} />
          </g>
        </g>
        {/* Back-wall windows; sky by day, honey when the lamps are on. */}
        <g className="h-in" style={delay(0.7)} pointerEvents="none">
          {WINDOWS.map((w, n) => (
            <g key={n} transform={`translate(${w.x},${w.y})`}>
              <rect x="-13" y="0" width="26" height="30" rx="2" fill="#d9e0d8" className="h-pane" />
              <rect x="-13" y="0" width="26" height="30" rx="2" fill="url(#h-dusk)" style={{ opacity: lit.dusk + lit.cool * 0.4 }} className="h-fade" />
              <rect x="-13" y="0" width="26" height="30" rx="2" fill="#e2b056" style={{ opacity: lit.lamps * 0.9 }} className="h-fade" />
              <g stroke={SAGE_FRAME} strokeWidth="1.5" fill="none" strokeLinecap="round">
                <rect x="-13" y="0" width="26" height="30" rx="2" {...BACK} />
                <path d="M0 0v30M-13 15h26" />
                <path d="M-19 0v30M19 0v30" strokeWidth="2.4" strokeDasharray="3 2" />
              </g>
              {w.curtain && (
                <path
                  className="h-curtain"
                  d="M-10 1q4 7 0 14t1 14"
                  stroke="#e9ab89"
                  strokeWidth="1.6"
                  fill="none"
                  {...RUN}
                  style={{ ["--n" as string]: -n * 1.3 + "s" }}
                />
              )}
            </g>
          ))}
        </g>
        <g className="goers">
          {homes.map((a, i) => {
            const id = who(a.id, a.color);
            return (
              <g
                key={a.id}
                ref={walk.fig(a.id)}
                className="goer"
                data-i={i}
                aria-label={"Visit " + a.name}
                {...press(() => onAgent(a))}
              >
                <g className="h-in" style={delay(0.9 + i * 0.08)}>
                  <g className="goer-lift">
                    <g className="goer-face">
                      <g className="goer-bob" style={{ ["--phase" as string]: -i * 0.7 + "s" }}>
                        <ellipse cy="0" rx="13" ry="2.4" fill="#6c5137" opacity=".16" />
                        <rect x="-22" y={-50 * big} width="44" height={52 * big} fill="transparent" />
                        <g transform={`translate(${-6.5 * CELL * big},${-14 * CELL * big}) scale(${CELL * big})`}>
                          <g className="step-0">
                            <Stitches rows={pattern(id, 0)} color={a.color} cross={cross} />
                          </g>
                          <g className="step-1">
                            <Stitches rows={pattern(id, 1)} color={a.color} cross={cross} />
                          </g>
                        </g>
                      </g>
                    </g>
                  </g>
                </g>
              </g>
            );
          })}
        </g>
        {/* Mood light over the whole cloth. */}
        <g className="light" pointerEvents="none">
          <g clipPath="url(#h-outside)">
            <rect width={W} height={H} fill="#5f7aa6" className="light-multiply" style={{ opacity: lit.cool * 0.6 }} />
            <rect width={W} height={H} fill="#a3a9ad" className="light-multiply" style={{ opacity: lit.grey * 0.6 }} />
          </g>
          <rect width={W} height={H} fill="#5f7aa6" className="light-multiply" style={{ opacity: lit.cool * 0.22 }} />
          <path d={shell} fill="#e9b25c" className="light-multiply" style={{ opacity: lit.lamps * 0.16 }} />
          <rect width={W} height={H} fill="#ffcf7a" className="light-multiply" style={{ opacity: lit.warm * 0.8 }} />
          <rect width={W} height={H} fill="#e8893a" className="light-soft" style={{ opacity: lit.hot }} />
          {ROOMS.flatMap((r) =>
            (FURNITURE[r.key] ?? [])
              .filter((it) => it.lit)
              .map((it, n) => (
                <circle
                  key={r.key + n}
                  className="h-lampglow"
                  cx={it.x}
                  cy={r.floor - (it.up ?? 0) - GLYPH[it.g].length * CELL + 4}
                  r="46"
                  fill="url(#h-lamp)"
                  style={{
                    opacity: ready ? 0.18 + lit.lamps * 0.82 : 0,
                    ["--n" as string]: -(r.floor + it.x) * 0.013 + "s",
                  }}
                />
              )),
          )}
        </g>
        {fgText && (
          <g transform={`translate(${vx + 22},${H - 18 - 22 * tagScale}) scale(${tagScale})`} className="map-note">
            <g className="h-in" style={delay(1.3)}>
              <rect width={sayWidth(fgText)} height="22" rx="11" style={{ fill: "var(--card)" }} stroke="#cdbfa8" />
              <text x={sayWidth(fgText) / 2} y="15" textAnchor="middle" className="map-label small note">
                {fgText}
              </text>
            </g>
          </g>
        )}
        <g
          transform={`translate(${vx + vw - 22},${H - 18}) scale(${tagScale})`}
          className={"map-note due" + (dueText && ready ? " on" : "")}
        >
          <rect x={-sayWidth(dueText)} y="-22" width={sayWidth(dueText)} height="22" rx="11" style={{ fill: "var(--ink)" }} />
          <text x={-sayWidth(dueText) / 2} y="-7" textAnchor="middle" className="map-label small note light">
            {dueText}
          </text>
        </g>
        <g className="says">
          {homes.map((a, i) => {
            const at = walk.pos(a.id) ?? homeOf(a.id),
              left = at[0] > W * 0.55,
              // Stack bubbles of residents standing close together.
              slot = homes
                .slice(0, i)
                .filter(
                  (b) =>
                    (talk.has(b.id) || speaker === b.id) &&
                    dist(walk.pos(b.id) ?? homeOf(b.id), at) < 120,
                ).length,
              t = said.current.get(a.id),
              dots = !talk.has(a.id) && speaker === a.id,
              w = dots ? 44 : t ? sayWidth(t.text) : 0,
              y = -76 - slot * 30,
              tip = left ? w - 16 : 16,
              lean = left ? 6 : -6,
              bx = left ? 10 - w : -10,
              box = w ? [bx, y - 8, bx + w, y + 32].map((n) => n * tagScale).join() : "0,0,0,0";
            return (
              <g key={a.id} ref={walk.say(a.id)} data-box={box}>
                <g transform={`scale(${tagScale})`}>
                  <g
                    className={"say" + (talk.has(a.id) || dots ? " on" : "")}
                    style={{ transformOrigin: `${left ? "100%" : "0"} 100%` }}
                  >
                    {(t || dots) && (
                      <g key={dots ? "dots" : t!.id} transform={`translate(${bx},${y})`}>
                        <rect width={w} height="24" rx="9" style={{ fill: "var(--card)" }} stroke="#6c5f50" strokeWidth="1" />
                        <path
                          d={`M${tip} 23.5l${lean} 7 1-7`}
                          style={{ fill: "var(--card)" }}
                          stroke="#6c5f50"
                          strokeWidth="1"
                          strokeLinejoin="round"
                        />
                        <path d={`M${tip - 0.5} 23.3h7`} style={{ stroke: "var(--card)" }} strokeWidth="1.6" />
                        {dots ? (
                          [13, 22, 31].map((x, n) => (
                            <circle
                              key={x}
                              cx={x}
                              cy="12"
                              r="2.2"
                              fill={INK}
                              className="say-dot"
                              style={{ ["--n" as string]: n * 0.2 + "s" }}
                            />
                          ))
                        ) : (
                          <text x={w / 2} y="16.5" textAnchor="middle" className="map-label small quote">
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
    </div>
  );
}

// The house plus a 24 hour replay bar; what the home page renders.
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
