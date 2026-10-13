// The meadow behind every page, drawn as pixel art on one fixed canvas: a deep sky, white clouds drifting
// and resting on a hill of wildflowers, the little white house and the two chairs. Flowers sway in the wind,
// the cursor parts them and shakes petals loose. Fear on the fear and greed index turns the sky to dusk.

type RGB = [number, number, number];

const DAY: RGB[] = [
  [24, 66, 200],
  [36, 86, 218],
  [56, 112, 232],
  [92, 146, 242],
  [146, 186, 248],
  [204, 222, 252],
];
const DUSK: RGB[] = [
  [30, 26, 86],
  [54, 40, 122],
  [98, 60, 152],
  [160, 88, 164],
  [222, 128, 156],
  [250, 188, 168],
];
const GRASS: RGB[] = [
  [214, 236, 118],
  [170, 218, 86],
  [126, 194, 66],
  [92, 166, 52],
  [66, 136, 44],
  [48, 108, 38],
];
const FAR: RGB[] = [
  [150, 204, 150],
  [122, 184, 128],
];
const BLOOMS: RGB[] = [
  [255, 132, 186],
  [255, 132, 186],
  [236, 86, 156],
  [255, 214, 72],
  [255, 214, 72],
  [120, 146, 255],
  [190, 160, 255],
  [255, 255, 255],
  [255, 168, 120],
];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(
  (v) => (v + 0.5) / 16,
);

const pack = ([r, g, b]: RGB, a = 255) =>
  ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
function rng(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
// Pick between neighbouring palette steps with ordered dithering, so gradients read as pixel art.
function dither(pal: RGB[], t: number, x: number, y: number): RGB {
  const f = Math.max(0, Math.min(0.999, t || 0)) * (pal.length - 1);
  const i = Math.floor(f);
  return pal[
    Math.min(pal.length - 1, f - i > BAYER[(y & 3) * 4 + (x & 3)] ? i + 1 : i)
  ];
}

type Sprite = { w: number; h: number; px: Uint32Array };
type Cloud = { s: Sprite; x: number; y: number; v: number; low: boolean };
type Flower = {
  x: number;
  y: number;
  c: number;
  n: number;
  ph: number;
  big: boolean;
};
type Petal = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  c: number;
  life: number;
};

function cloudSprite(r: () => number, scale: number): Sprite {
  const puffs: [number, number, number][] = [];
  const n = 3 + Math.floor(r() * 4);
  let x = 0;
  for (let i = 0; i < n; i++) {
    const rad = (5 + r() * 9) * scale * (i === 0 || i === n - 1 ? 0.7 : 1);
    puffs.push([x + rad, -rad * (0.5 + r() * 0.5), rad]);
    x += rad * (0.9 + r() * 0.5);
  }
  const top = Math.min(...puffs.map((p) => p[1] - p[2]));
  const w = Math.ceil(x + puffs[n - 1][2] + 2);
  const h = Math.ceil(-top + 2);
  const inside = (px: number, py: number) => {
    if (py > h - 1 || py < 0 || px < 0 || px >= w) return false;
    const yy = py + top;
    if (yy > 0) return false;
    return puffs.some(
      ([cx, cy, rr]) => (px - cx) ** 2 + (yy - cy) ** 2 <= rr * rr,
    );
  };
  const out = new Uint32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let xx = 0; xx < w; xx++) {
      if (!inside(xx, y)) continue;
      let c: RGB = [244, 247, 255];
      if (!inside(xx - 1, y - 2)) c = [255, 255, 255];
      else if (!inside(xx, y + 2)) c = [200, 213, 242];
      else if (!inside(xx, y + 5)) c = [224, 233, 251];
      out[y * w + xx] = pack(c);
    }
  return { w, h, px: out };
}

const HOUSE = [
  "..rrr..",
  ".rrrrr.",
  "rrrrrrr",
  ".wwwww.",
  ".wdwkw.",
  ".wdwww.",
];
const CHAIR = [".www.", ".w.w.", ".www.", "wwwww", "w...w", "w...w"];

export type MeadowOptions = {
  width: () => number;
  height: () => number;
  px?: number;
  seed?: number;
  fear?: number;
  pointer?: boolean;
  frame?: number;
  // Hill height as [where it starts on the left, how much it rises to the right], as fractions of the height.
  hill?: [number, number];
  zones?: () => { left: number; top: number; right: number; bottom: number }[];
};

export function startMeadow(canvas: HTMLCanvasElement, opts: MeadowOptions) {
  const px = opts.px ?? 3;
  const ctx = canvas.getContext("2d")!;
  let W = 0;
  let H = 0;
  let img: ImageData;
  let frame: Uint32Array;
  let sky: Uint32Array;
  let hill: Uint32Array;
  let ridge: Float32Array;
  let clouds: Cloud[] = [];
  let flowers: Flower[] = [];
  let stars: [number, number, number][] = [];
  const petals: Petal[] = [];
  let fear = opts.fear ?? 0;
  let shown = fear;
  const pointer = { x: -999, y: -999, vx: 0, vy: 0, at: 0 };

  const paintSky = () => {
    const pal = DAY.map((c, i) => mix(c, DUSK[i], shown));
    const horizon = H * 0.86;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        sky[y * W + x] = pack(dither(pal, Math.pow(y / horizon, 1.35), x, y));
  };

  const build = () => {
    W = Math.ceil(opts.width() / px);
    H = Math.ceil(opts.height() / px);
    canvas.width = W;
    canvas.height = H;
    img = ctx.createImageData(W, H);
    frame = new Uint32Array(img.data.buffer);
    sky = new Uint32Array(W * H);
    hill = new Uint32Array(W * H);
    ridge = new Float32Array(W);
    const r = rng(opts.seed ?? 20261012);
    const tall = H > W;
    const base = opts.hill?.[0] ?? (tall ? 0.74 : 0.7);
    const rise = opts.hill?.[1] ?? (tall ? 0.16 : 0.26);
    for (let x = 0; x < W; x++) {
      const u = x / W;
      ridge[x] =
        H * (base - rise * (u * u * (3 - 2 * u))) +
        Math.sin(x * 0.045) * 2.2 +
        Math.sin(x * 0.013 + 1.3) * 3.5;
    }
    // A far, hazy hill on the left, then the main hill rising to the right.
    const far = (x: number) =>
      H * (base - 0.05) + Math.sin(x * 0.02 + 0.4) * 5 - (x / W) * H * 0.02;
    for (let x = 0; x < W; x++) {
      const f = far(x);
      for (let y = Math.max(0, Math.floor(f)); y < H; y++) {
        const t = (y - f) / 18;
        hill[y * W + x] = pack(dither(FAR, t, x, y));
      }
    }
    for (let x = 0; x < W; x++) {
      const top = ridge[x];
      for (let y = Math.max(0, Math.floor(top)); y < H; y++) {
        const d = Math.max(0, y - top) / Math.max(1, H - top);
        const n =
          Math.sin(x * 0.31 + y * 0.17) * 0.06 +
          Math.sin(x * 0.07 - y * 0.23) * 0.05;
        let c = dither(
          GRASS,
          Math.pow(d, 0.7) + n + (y - top < 1.5 ? -0.3 : 0),
          x,
          y,
        );
        if (r() < 0.05) c = mix(c, [40, 92, 34], 0.45);
        hill[y * W + x] = pack(c);
      }
    }
    // The little house on the far hill and two chairs on the near one.
    const stamp = (
      rows: string[],
      x0: number,
      y0: number,
      colors: Record<string, RGB>,
    ) =>
      rows.forEach((row, j) =>
        [...row].forEach((ch, i) => {
          const x = x0 + i;
          const y = y0 + j;
          if (ch !== "." && x >= 0 && x < W && y >= 0 && y < H)
            hill[y * W + x] = pack(colors[ch]);
        }),
      );
    const hx = Math.floor(W * (tall ? 0.12 : 0.1));
    stamp(HOUSE, hx, Math.floor(far(hx)) - 5, {
      r: [150, 156, 176],
      w: [250, 250, 246],
      d: [120, 110, 120],
      k: [255, 214, 120],
    });
    const cx = Math.floor(W * (tall ? 0.7 : 0.78));
    for (const k of [0, 7])
      stamp(CHAIR, cx + k, Math.floor(ridge[cx + k] + 7) - 5, {
        w: [255, 255, 255],
      });

    clouds = [];
    const k = Math.min(1, W / 380);
    const count = Math.max(4, Math.round(W / 70));
    for (let i = 0; i < count; i++) {
      const s = cloudSprite(r, (0.8 + r() * 1.1) * k);
      clouds.push({
        s,
        x: r() * (W + s.w) - s.w,
        y: H * (0.04 + r() * (base - 0.3)),
        v: 0.6 + r() * 1.2,
        low: false,
      });
    }
    // Clouds that sit low on the hillside.
    for (let i = 0; i < 3; i++) {
      const s = cloudSprite(r, (0.75 + r() * 0.4) * k);
      const x = W * (0.3 + i * 0.22 + r() * 0.08);
      clouds.push({
        s,
        x,
        y:
          ridge[Math.min(W - 1, Math.max(0, Math.floor(x + s.w / 2)))] -
          s.h * 0.6,
        v: 0.25 + r() * 0.2,
        low: true,
      });
    }

    flowers = [];
    for (let x = 0; x < W; x++)
      for (let y = Math.ceil(ridge[x]) + 1; y < H; y++) {
        const d = (y - ridge[x]) / Math.max(1, H - ridge[x]);
        if (r() < 0.05 + d * 0.11)
          flowers.push({
            x,
            y,
            c: Math.floor(r() * BLOOMS.length),
            n: d,
            ph: r() * 6.28,
            big: d > 0.55 && r() < 0.35,
          });
      }
    stars = Array.from({ length: Math.round(W * 0.25) }, () => [
      r() * W,
      r() * H * 0.5,
      r() * 6.28,
    ]);
    paintSky();
  };

  let zones: [number, number, number, number][] = [];
  let zonesAt = 0;
  const readZones = () => {
    zones = (opts.zones?.() ?? []).map((b) => [
      (b.left - 16) / px,
      (b.top - 12) / px,
      (b.right + 16) / px,
      (b.bottom + 12) / px,
    ]);
  };
  // Cloud at opacity a over whatever is underneath.
  const over = (d: number, v: number, a: number) => {
    const r = (d & 255) * (1 - a) + (v & 255) * a;
    const g = ((d >> 8) & 255) * (1 - a) + ((v >> 8) & 255) * a;
    const b = ((d >> 16) & 255) * (1 - a) + ((v >> 16) & 255) * a;
    return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
  };
  const FEATHER = 8;
  const blit = (s: Sprite, ox: number, oy: number) => {
    const x0 = Math.round(ox);
    const y0 = Math.round(oy);
    const hit = zones.filter(
      ([a, b, c, d]) =>
        x0 < c + FEATHER &&
        x0 + s.w > a - FEATHER &&
        y0 < d + FEATHER &&
        y0 + s.h > b - FEATHER,
    );
    for (let j = 0; j < s.h; j++) {
      const y = y0 + j;
      if (y < 0 || y >= H) continue;
      for (let i = 0; i < s.w; i++) {
        const x = x0 + i;
        const v = s.px[j * s.w + i];
        if (!v || x < 0 || x >= W) continue;
        const o = y * W + x;
        if (!hit.length) {
          frame[o] = v;
          continue;
        }
        // How far inside the nearest text zone this pixel sits; clouds fade to 20% across the feather.
        let k = -FEATHER;
        for (const [a, b, c, d] of hit)
          k = Math.max(k, Math.min(x - a, c - x, y - b, d - y));
        const f = Math.max(0, Math.min(1, (k + FEATHER) / (2 * FEATHER)));
        frame[o] = f ? over(frame[o], v, 1 - 0.8 * f) : v;
      }
    }
  };
  const dot = (x: number, y: number, c: number) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x >= 0 && x < W && y >= 0 && y < H) frame[y * W + x] = c;
  };
  const bloomPx = BLOOMS.map((c) => pack(c));
  const centre = pack([255, 226, 110]);
  const stem = pack([58, 120, 40]);

  let last = 0;
  let t = 0;
  let raf = 0;
  const draw = (now: number) => {
    raf = requestAnimationFrame(draw);
    if (now - last < (opts.frame ?? 33)) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    if (Math.abs(shown - fear) > 0.01) {
      shown += (fear - shown) * 0.05;
      paintSky();
    }
    if (now - zonesAt > 250) {
      zonesAt = now;
      readZones();
    }
    frame.set(sky);
    if (shown > 0.05)
      for (const [x, y, ph] of stars)
        if (Math.sin(t * 2 + ph) > 0.2 - shown)
          dot(x, y, pack([255, 250, 230], 255));
    for (const c of clouds) {
      c.x += c.v * dt;
      if (c.x > W) c.x = -c.s.w;
      if (!c.low) blit(c.s, c.x, c.y + Math.sin(t * 0.2 + c.v * 9) * 0.6);
    }
    for (let i = 0; i < frame.length; i++) if (hill[i]) frame[i] = hill[i];
    for (const c of clouds) if (c.low) blit(c.s, c.x, c.y);

    const pmoved = now - pointer.at < 600;
    for (const f of flowers) {
      const gust = Math.pow(Math.max(0, Math.sin(t * 0.45 - f.x * 0.012)), 3);
      let dx = Math.sin(t * 1.3 + f.ph) * f.n * 1.2 + gust * (0.5 + f.n * 2.2);
      if (pmoved) {
        const ax = f.x - pointer.x;
        const ay = f.y - pointer.y;
        const dd = ax * ax + ay * ay;
        if (dd < 160) dx += (ax >= 0 ? 1 : -1) * (1 - dd / 160) * 4;
      }
      const x = f.x + dx;
      if (f.big) {
        dot(f.x, f.y + 1, stem);
        dot(f.x + dx * 0.5, f.y, stem);
        const c = bloomPx[f.c];
        dot(x, f.y - 2, c);
        dot(x - 1, f.y - 1, c);
        dot(x + 1, f.y - 1, c);
        dot(x, f.y, c);
        dot(x, f.y - 1, centre);
      } else dot(x, f.y, bloomPx[f.c]);
    }
    for (let i = petals.length - 1; i >= 0; i--) {
      const p = petals[i];
      p.life -= dt;
      if (p.life <= 0) {
        petals.splice(i, 1);
        continue;
      }
      p.vx += Math.sin(t * 3 + i) * 0.6 * dt;
      p.vy += 2.2 * dt;
      p.x += p.vx * dt * 10;
      p.y += p.vy * dt * 10;
      dot(p.x, p.y, bloomPx[p.c]);
    }
    // Two white butterflies working the hill.
    for (let b = 0; b < 2; b++) {
      const bx =
        W * (0.25 + b * 0.45) +
        Math.sin(t * 0.31 + b * 2) * W * 0.12 +
        Math.sin(t * 1.7 + b) * 4;
      const by =
        ridge[Math.max(0, Math.min(W - 1, Math.round(bx)))] +
        8 +
        Math.sin(t * 0.9 + b * 3) * 6;
      const up = Math.sin(t * 14 + b) > 0;
      const c = b ? pack([255, 236, 140]) : pack([255, 255, 255]);
      dot(bx, by, pack([60, 50, 70]));
      dot(bx - 1, by - (up ? 1 : 0), c);
      dot(bx + 1, by - (up ? 1 : 0), c);
    }
    ctx.putImageData(img, 0, 0);
  };

  const onMove = (e: PointerEvent) => {
    const x = e.clientX / px;
    const y = e.clientY / px;
    const now = performance.now();
    const speed = Math.hypot(x - pointer.x, y - pointer.y);
    pointer.x = x;
    pointer.y = y;
    pointer.at = now;
    if (
      speed > 1.5 &&
      speed < 40 &&
      x >= 0 &&
      x < W &&
      y > ridge[Math.floor(x)] &&
      petals.length < 160
    ) {
      const n = Math.min(3, Math.floor(speed / 3) + 1);
      for (let i = 0; i < n; i++)
        petals.push({
          x: x + (Math.random() - 0.5) * 6,
          y: y + (Math.random() - 0.5) * 4,
          vx: (Math.random() - 0.5) * 3,
          vy: -2 - Math.random() * 3,
          c: Math.floor(Math.random() * BLOOMS.length),
          life: 1.2 + Math.random() * 1.4,
        });
    }
  };

  let resizeT = 0;
  const onResize = () => {
    clearTimeout(resizeT);
    resizeT = window.setTimeout(() => {
      const w = Math.ceil(opts.width() / px);
      const h = Math.ceil(opts.height() / px);
      // Mobile browsers resize the viewport while the address bar slides; only rebuild on real changes.
      if (w !== W || Math.abs(h - H) > 40) build();
    }, 150);
  };

  build();
  raf = requestAnimationFrame(draw);
  if (opts.pointer !== false)
    addEventListener("pointermove", onMove, { passive: true });
  addEventListener("resize", onResize);
  return {
    setFear: (v: number) => {
      fear = v;
    },
    rebuild: build,
    destroy: () => {
      cancelAnimationFrame(raf);
      clearTimeout(resizeT);
      removeEventListener("pointermove", onMove);
      removeEventListener("resize", onResize);
    },
  };
}
