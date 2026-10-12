// Residents and the house mark are cross-stitch patterns: one character per stitch.
// . empty, o outline, b body, h light, e eye, c cheek, a accent, k ink
export const THREAD: Record<string, { b: string; o: string; h: string; a: string }> = {
  sage: { b: "#8ba16d", o: "#4c5e34", h: "#b7c79c", a: "#5f8a3c" },
  coral: { b: "#cf7a52", o: "#8a4127", h: "#e9ab89", a: "#e2b056" },
  ochre: { b: "#dcab4a", o: "#94671a", h: "#efd08d", a: "#8a5a2b" },
  slate: { b: "#7b8ea2", o: "#3d4c5d", h: "#a9b8c7", a: "#e2b056" },
  lavender: { b: "#a585aa", o: "#5d4464", h: "#cbb2cd", a: "#c9604a" },
  blue: { b: "#77a3a6", o: "#3a6064", h: "#a9cacb", a: "#dcab4a" },
};
const INK = "#2b2219";
const CHEEK = "#e59a8a";

const BODY = [
  ".............",
  ".............",
  ".............",
  "....ooooo....",
  "...obhhbbo...",
  "..obhbbbbbo..",
  "..obbbbbbbo..",
  "..obebbbebo..",
  "..obcbbbcbo..",
  "..obbbbbbbo..",
  "..obbbbbbbo..",
  "...obbbbbo...",
];
const STEP = [
  ["....o...o....", "...oo...oo..."],
  [".....o.o.....", "....oo.oo...."],
];
// Rows 0-3 and a few body rows change per resident.
const TOPS: Record<string, Record<number, string>> = {
  moss: {
    0: "...aa...aa...",
    1: "....aa.aa....",
    2: "......a......",
    3: "....ooaoo....",
  },
  flicker: {
    0: "......a......",
    1: ".....aa.a....",
    2: "....aaaaa....",
    3: "....oaaao....",
  },
  rook: {
    0: "......o......",
    1: ".....obo.....",
    2: "....obhbo....",
    3: "...obhbbbo...",
    4: "..obhbbbbbo..",
  },
  pip: {
    1: ".....aaa.....",
    2: "....aaaaa....",
    3: "...aaaaaaa...",
  },
  vale: {
    9: "..oaaaaaaao..",
    10: "..obbbbbaao..",
    11: "...obbbbbaa..",
  },
  echo: {
    1: "..oo.....oo..",
    2: ".obho...ohbo.",
    3: ".obboooooobo.",
  },
};
export const RESIDENT_IDS = Object.keys(TOPS);

export function pattern(id: string, step = 0) {
  const top = TOPS[id] ?? {};
  return [...BODY.map((r, i) => top[i] ?? r), ...STEP[step % 2]];
}

function fill(ch: string, t: (typeof THREAD)[string]) {
  if (ch === "o") return t.o;
  if (ch === "b") return t.b;
  if (ch === "h") return t.h;
  if (ch === "a") return t.a;
  if (ch === "c") return CHEEK;
  return INK;
}

// Each cell becomes either a soft square (small sizes) or an X stitch (large sizes).
export function Stitches({
  rows,
  color,
  cross,
}: {
  rows: string[];
  color: string;
  cross: boolean;
}) {
  const t = THREAD[color] ?? THREAD.sage;
  const out: React.ReactNode[] = [];
  rows.forEach((r, y) =>
    [...r].forEach((ch, x) => {
      if (ch === ".") return;
      const c = fill(ch, t);
      // Eyes and cheeks are french knots, so faces stay alive at stitch size.
      const knot = cross && (ch === "e" || ch === "c");
      out.push(
        knot ? (
          <circle key={x + "-" + y} cx={x + 0.5} cy={y + 0.5} r={ch === "e" ? 0.36 : 0.3} fill={c} />
        ) : cross ? (
          <g key={x + "-" + y} stroke={c}>
            <path d={`M${x + 0.16} ${y + 0.16}L${x + 0.84} ${y + 0.84}`} />
            <path d={`M${x + 0.84} ${y + 0.16}L${x + 0.16} ${y + 0.84}`} />
          </g>
        ) : (
          <rect key={x + "-" + y} x={x} y={y} width="1.02" height="1.02" fill={c} />
        ),
      );
    }),
  );
  return (
    <g
      strokeWidth={cross ? 0.34 : undefined}
      strokeLinecap="round"
      shapeRendering={cross ? undefined : "crispEdges"}
    >
      {out}
    </g>
  );
}

export function Resident({
  id,
  color,
  size = 32,
  cross,
  step = 0,
  className,
}: {
  id: string;
  color: string;
  size?: number;
  cross?: boolean;
  step?: number;
  className?: string;
}) {
  return (
    <svg
      className={"resident-stitch " + (className ?? "")}
      width={size}
      height={(size * 14) / 13}
      viewBox="0 0 13 14"
      aria-hidden="true"
    >
      <Stitches rows={pattern(id, step)} color={color} cross={cross ?? size >= 72} />
    </svg>
  );
}

// The house mark: an X-stitched roof, walls, and one warm lit window.
const HOUSE = [
  "...r...",
  "..rrr..",
  ".rrrrr.",
  "rrrrrrr",
  ".kkkkk.",
  ".kwkkk.",
  ".kkk.k.",
  ".kkk.k.",
];
export function HouseMark({ size = 26, cross = true }: { size?: number; cross?: boolean }) {
  const colors: Record<string, string> = { r: "#b85c38", k: INK, w: "#e2b056" };
  return (
    <svg
      className="mark"
      width={size}
      height={(size * 8) / 7}
      viewBox="-0.2 -0.2 7.4 8.4"
      aria-hidden="true"
    >
      <g strokeWidth={0.36} strokeLinecap="round">
        {HOUSE.flatMap((r, y) =>
          [...r].map((ch, x) => {
            if (ch === ".") return null;
            const c = colors[ch];
            return cross ? (
              <g key={x + "-" + y} stroke={c}>
                <path d={`M${x + 0.14} ${y + 0.14}L${x + 0.86} ${y + 0.86}`} />
                <path d={`M${x + 0.86} ${y + 0.14}L${x + 0.14} ${y + 0.86}`} />
              </g>
            ) : (
              <rect key={x + "-" + y} x={x + 0.08} y={y + 0.08} width=".84" height=".84" rx=".18" fill={c} />
            );
          }),
        )}
      </g>
    </svg>
  );
}
