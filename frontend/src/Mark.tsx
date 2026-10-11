// The murmur house: one outline, an arched door.
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M3.5 10.2 12 3.5l8.5 6.7V20.5h-17z" />
      <path d="M9.4 20.5v-4.6a2.6 2.6 0 0 1 5.2 0v4.6" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <>
      <Mark />
      murmur
    </>
  );
}
