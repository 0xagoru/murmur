import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Agent } from "./api";
const W = 820,
  H = 530;
const plots = [
  { x: 190, y: 150 },
  { x: 535, y: 118 },
  { x: 680, y: 262 },
  { x: 285, y: 340 },
  { x: 108, y: 385 },
  { x: 535, y: 410 },
];
const commons = { x: 392, y: 226 };
const roads = [
  "M-20 294Q210 210 346 213T840 345",
  "M373-20Q390 140 381 237T470 560",
  "M110 550Q200 355 350 320T688-20",
];
const signs = [
  { id: "research", name: "reading room", left: true, top: true },
  { id: "launches", name: "the workshop", left: false, top: true },
  { id: "risk", name: "watchtower", left: false, top: false },
];
const pond = { x: 748, y: 448, rx: 74, ry: 52 };
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
          (p) => x < p.x - 92 || x > p.x + 96 || y < p.y - 62 || y > p.y + 136,
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
      if (clear && rand() > 0.28)
        out.push({ x, y, big: rand() > 0.62, tone: Math.floor(rand() * 3) });
    }
  return out;
})();
// Trees grow outward from the commons.
const growOrder = trees
  .map((t, i) => ({ i, d: Math.hypot(t.x - commons.x, t.y - commons.y) }))
  .sort((l, r) => l.d - r.d)
  .reduce<number[]>((m, t, n) => ((m[t.i] = n), m), []);
const tones = ["#93a780", "#aebd94", "#a3b48a"];
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
      <circle cx="23" cy="29" r="2" fill="#283c36" />
      <circle cx="38" cy="29" r="2" fill="#283c36" />
      <path
        d="M27 38q4 3 8 0"
        stroke="#283c36"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <ellipse cx="17" cy="35" rx="4" ry="2" fill="#f5f2e9" opacity=".4" />
    </svg>
  );
}
function Cottage({ a }: { a: Agent }) {
  return (
    <>
      <ellipse cx="10" cy="50" rx="66" ry="14" fill="#778c71" opacity=".14" />
      <path
        d="M-46-10h87v58h-87z"
        fill="#f6f0df"
        stroke="#6c7d62"
        strokeWidth="1.5"
      />
      <path
        d="M41-10l22-12v57L41 48"
        fill="#dce0cc"
        stroke="#6c7d62"
        strokeWidth="1.5"
      />
      <path
        d={
          a.cottage === "round"
            ? "M-57-10Q-3-80 51-10Z"
            : a.cottage === "tall"
              ? "M-57-10l54-63L51-10z"
              : "M-57-10l54-43L51-10z"
        }
        fill="currentColor"
        stroke="#6c7d62"
        strokeWidth="1.5"
      />
      <path
        d="M-3-53l26-14 52 45-24 12z"
        fill="currentColor"
        stroke="#6c7d62"
      />
      <path d="M-57-10l54-43L51-10z" fill="url(#roof)" />
      <path d="M-9 48V16q0-12 10-12t11 12v32" fill="#7d8e70" stroke="#6c7d62" />
      <rect
        x="-32"
        y="5"
        width="14"
        height="17"
        rx="2"
        fill="#d4dfcc"
        stroke="#6c7d62"
      />
      <path d="M-25 5v17m-7-9h14" stroke="#6c7d62" />
      <rect
        x="22"
        y="5"
        width="12"
        height="17"
        rx="2"
        fill="#d4dfcc"
        stroke="#6c7d62"
      />
      <path d="M28 5v17m-6-9h12" stroke="#6c7d62" />
      {a.id === "moss" && (
        <g>
          <path d="M-76 16l30-19v50h-30z" fill="#d7e4d2" stroke="#76876d" />
          <path
            d="M-61 7v40m-15-15h30m-15-25 15 25"
            fill="none"
            stroke="#8a9a81"
          />
          <path
            d="M-70 44q5-22 10 0m4 0q5-18 9 0"
            fill="none"
            stroke="#829c72"
            strokeWidth="3"
          />
        </g>
      )}
      {a.id === "flicker" && (
        <g stroke="#687961" fill="none">
          <path d="M4-53v-26m-9 0h23" strokeWidth="1.5" />
          <path className="vane" d="M10-84l5 5-5 5" strokeWidth="1.5" />
          <path d="M54 5q9-10 16 0m-14 7q6-6 10 0" />
          <circle cx="61" cy="19" r="2" fill="#687961" />
        </g>
      )}
      {a.id === "rook" && (
        <g>
          <path d="M-33-30v-38h18v24" fill="#b6bdb2" stroke="#687961" />
          <path d="M-35-68h22m-18 11h16m-16 11h16" stroke="#687961" />
          <path
            d="M-49 33h9m-6 8h12m58-8h11"
            stroke="#a4ac98"
            strokeWidth="2"
          />
        </g>
      )}
      {a.id === "pip" && (
        <g>
          <path d="M-39 2h28l-3 9h-24z" fill="#d6b979" stroke="#8e825f" />
          <path
            d="M-32 2l-1 9m7-9-1 9m7-9-1 9"
            stroke="#f5f2e9"
            strokeWidth="3"
          />
          <path d="M51 24h23v24H51z" fill="#d8ccb0" stroke="#8e825f" />
          <path d="M51 31h23m-12-7v24" stroke="#8e825f" />
        </g>
      )}
      {a.id === "vale" && (
        <g>
          <path
            d="M-59 38h16v5h-16zM-56 32h16v6h-16zM-60 27h18v5h-18z"
            fill="#b8adc6"
            stroke="#7f7889"
          />
          <path d="M-62 46h26" stroke="#7f7889" />
          <path d="M24-46l4-22 11 2-3 30" fill="#e5dded" stroke="#8b7f98" />
        </g>
      )}
      {a.id === "echo" && (
        <g stroke="#718697">
          <path d="M52-17l19-11 4 7-19 11z" fill="#a4becb" />
          <path d="M64-12v30m0-15-8 15m8-15 8 15" fill="none" />
          <path d="M-30-29l7-17 5 3-7 20" fill="#a4becb" />
        </g>
      )}
      <path
        d="M-38 43q-12-22-14-2m90 2q14-24 16-3"
        stroke="#839c73"
        strokeWidth="4"
        fill="none"
      />
    </>
  );
}
export function Town({
  agents,
  live = true,
  speaking,
  onAgent,
  onRoom,
}: {
  agents: Agent[];
  live?: boolean;
  speaking?: string;
  onAgent: (a: Agent) => void;
  onRoom: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [ready, setReady] = useState(false);
  const [calm] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
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
  const homes = agents.slice(0, plots.length);
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
            <circle cx="2" cy="2" r=".55" fill="#758468" opacity=".13" />
          </pattern>
          <pattern
            id="roof"
            width="12"
            height="8"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M0 7h12M6 0v7"
              stroke="#294c3f"
              strokeWidth=".8"
              opacity=".28"
            />
          </pattern>
          {roads.map((d, i) => (
            <path key={i} id={"road-" + i} d={d} />
          ))}
        </defs>
        <rect width={W} height={H} fill="#e9eddf" />
        <rect width={W} height={H} fill="url(#grain)" />
        <g className="roads">
          {roads.map((d, i) => (
            <path
              key={"edge" + i}
              d={d}
              pathLength={1}
              stroke="#d1d6c4"
              strokeWidth="38"
              fill="none"
              style={delay(i * 0.16)}
            />
          ))}
          {roads.map((d, i) => (
            <path
              key={"lane" + i}
              d={d}
              pathLength={1}
              stroke="#f5f2e9"
              strokeWidth="29"
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
            fill="#c7dad7"
            stroke="#a8c2be"
          />
          <path
            className="ripples"
            d="M712 432q20-7 38 0m-26 26q24-7 40 0m-16 24h28"
            stroke="#a0bcb5"
            fill="none"
          />
        </g>
        <g transform={`translate(${commons.x},${commons.y})`}>
          <g className="pop" style={delay(0.45)}>
            <ellipse cy="12" rx="47" ry="23" fill="#c0c8b0" />
            <ellipse rx="38" ry="22" fill="#e1e6d5" stroke="#778c71" />
            <ellipse cy="-8" rx="22" ry="12" fill="#b9d4cc" stroke="#778c71" />
            <path
              d="M0-8v-30m-8 9q8-8 16 0"
              stroke="#778c71"
              fill="none"
              strokeWidth="3"
            />
            <circle className="drop" cx="-8" cy="-29" r="1.6" fill="#9fc2b8" />
            <circle
              className="drop late"
              cx="8"
              cy="-29"
              r="1.6"
              fill="#9fc2b8"
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
                    <path d="M0 15V-5" stroke="#6b7d60" strokeWidth="2" />
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
                      stroke="#74886a"
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
                  <g transform="translate(49,43)">
                    <g
                      className="resident"
                      style={{ ["--phase" as string]: -i * 0.7 + "s" }}
                    >
                      <path d="M0 0q-3-26 11-26T23 0Z" fill="currentColor" />
                      <g className="eyes">
                        <circle cx="7" cy="-12" r="1.5" fill="#283c36" />
                        <circle cx="15" cy="-12" r="1.5" fill="#283c36" />
                      </g>
                    </g>
                  </g>
                  <g transform="translate(68,-34)">
                    <g className={"bubble" + (speaking === a.id ? " on" : "")}>
                      <path
                        d="M-18-12h36a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H-1l-8 7v-7h-9a6 6 0 0 1-6-6v-8a6 6 0 0 1 6-6z"
                        fill="#fbfaf4"
                        stroke="#a9b59c"
                      />
                      {[-9, 0, 9].map((x, n) => (
                        <circle
                          key={x}
                          cx={x}
                          cy="-2"
                          r="2.1"
                          fill="#6d8064"
                          style={{ ["--n" as string]: n * 0.2 + "s" }}
                        />
                      ))}
                    </g>
                  </g>
                </g>
              </g>
              <g transform={`translate(8,76) scale(${scale})`}>
                <g className="tag" style={delay(1.15 + i * 0.12)}>
                  <rect
                    x={-w / 2}
                    y="-12"
                    width={w}
                    height="24"
                    rx="12"
                    fill="#f8f6ef"
                    stroke="#d3d9c8"
                  />
                  <text x={-w / 2 + 13} y="4" className="map-label">
                    {a.name}
                  </text>
                  <circle
                    cx={w / 2 - 12}
                    cy="0"
                    r="3"
                    fill={speaking === a.id ? "#bb705c" : "#688760"}
                    className="tag-dot"
                  />
                </g>
              </g>
            </g>
          );
        })}
        <g
          transform={`translate(${commons.x},${commons.y + 50}) scale(${scale})`}
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
                  fill="#f5f2e9"
                  stroke="#a4b294"
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
                  stroke="#354a3e"
                  strokeWidth="1.2"
                  fill="none"
                  strokeLinecap="round"
                />
              </g>
            </g>
          );
        })}
      </svg>
      {!calm && (
        <svg className="walkers" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {homes
            .filter(
              (a) =>
                ["researching", "thinking", "executing trade"].includes(
                  a.status,
                ) ||
                (a.activity?.kind === "launched coin" &&
                  Date.now() - Date.parse(a.activity.created_at) < 1800000),
            )
            .slice(0, 3)
            .map((a, i) => (
              <path
                key={a.id}
                className={"walker " + a.color}
                d="M-5 0q-1-12 5-12t5 12z"
                fill="currentColor"
                stroke="#6c7d62"
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
      )}
    </div>
  );
}
