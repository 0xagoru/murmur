// The murmur mark: a lowercase m drawn in dots whose last stroke lifts off like starlings.
const BODY: [number, number][] = [
  [4.6, 27.4], [4.6, 24.8], [4.6, 22.2], [4.6, 19.6], [4.6, 17], [4.6, 14.4],
  [5.27, 11.9], [7.1, 10.07], [9.6, 9.4], [12.1, 10.07], [14.6, 11.9],
  [14.6, 14.4], [14.6, 17], [14.6, 19.6], [14.6, 22.2], [14.6, 24.8], [14.6, 27.4], [17.1, 10.07], [19.6, 9.4], [22.1, 10.07], [23.93, 11.9], [24.6, 14.4],
];
const FLOCK: [number, number, number][] = [
  [26.6, 11.4, 1.05],
  [28, 8.4, 0.85],
  [26.8, 5.6, 0.68],
  [29.2, 5, 0.5],
];

export function Mark({ size = 24, bird }: { size?: number; bird?: string }) {
  return (
    <svg className="mark" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      {BODY.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.25" fill="currentColor" />
      ))}
      {FLOCK.map(([x, y, r], i) => (
        <circle
          key={"f" + i}
          className="mark-bird"
          style={{ ["--i" as string]: i }}
          cx={x}
          cy={y}
          r={r}
          fill={bird ?? "var(--pink)"}
        />
      ))}
    </svg>
  );
}

export function Wordmark() {
  return (
    <>
      <Mark />
      <span>murmur</span>
    </>
  );
}
