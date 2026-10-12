import { useEffect, useRef } from "react";
import { api } from "./api";
import type { Mood } from "./town-api";
import { startMeadow } from "./meadow-engine";

// The meadow behind every page: one fixed pixel-art canvas. Clouds ghost behind anything marked data-clear.
export function Meadow() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const m = startMeadow(ref.current!, {
      width: () => innerWidth,
      height: () => innerHeight,
      zones: () => [...document.querySelectorAll("[data-clear]")].map((el) => el.getBoundingClientRect()),
    });
    const read = () =>
      api<Mood>("/mood")
        .then((x) => {
          const v = x.fear_greed?.value;
          m.setFear(v == null ? 0 : Math.max(0, Math.min(1, (50 - v) / 30)));
        })
        .catch(() => {});
    read();
    const t = setInterval(read, 300000);
    return () => {
      clearInterval(t);
      m.destroy();
    };
  }, []);
  return <canvas ref={ref} className="meadow" aria-hidden="true" />;
}
