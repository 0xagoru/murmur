import { useEffect, useRef, useState, type ElementType } from "react";

// Reveals every [data-reveal] element once it scrolls into view, including ones rendered later.
export function useReveal(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const seen = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          e.target.classList.add("in");
          seen.unobserve(e.target);
        }),
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    const scan = () =>
      document
        .querySelectorAll("[data-reveal]:not(.in)")
        .forEach((el) => seen.observe(el));
    scan();
    const added = new MutationObserver(scan);
    added.observe(document.body, { childList: true, subtree: true });
    return () => {
      seen.disconnect();
      added.disconnect();
    };
  }, [active]);
}

// Splits a heading into words that ink in one after another.
export function Words({
  text,
  as: Tag = "h2",
  className = "",
  step = 0,
}: {
  text: string;
  as?: ElementType;
  className?: string;
  step?: number;
}) {
  return (
    <Tag
      className={"words " + className}
      data-reveal
      style={{ ["--d" as string]: step }}
      aria-label={text}
    >
      {text.split(" ").map((w, i) => (
        <span key={i} aria-hidden="true" style={{ ["--i" as string]: i }}>
          {w}{" "}
        </span>
      ))}
    </Tag>
  );
}

// Counts up to a value the first time it is shown, then follows live changes.
export function Count({
  value,
  digits = 0,
  prefix = "",
}: {
  value: number;
  digits?: number;
  prefix?: string;
}) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now(),
      begin = from.current;
    let frame = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 1100),
        eased = 1 - Math.pow(1 - k, 4);
      const next = begin + (value - begin) * eased;
      setShown(next);
      from.current = next;
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <>
      {prefix}
      {shown.toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}
    </>
  );
}
