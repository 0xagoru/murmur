import type { ReactNode } from "react";

// One pane of the desk: a frosted panel with its name and live counts along the bottom edge.
export function Pane({
  tab,
  note,
  counts = [],
  className = "",
  d = 0,
  onTab,
  children,
}: {
  tab: string;
  note?: string;
  counts?: ReactNode[];
  className?: string;
  d?: number;
  onTab?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className={"pane " + className}
      data-reveal
      style={{ ["--d" as string]: d }}
    >
      <div className="pane-body">{children}</div>
      <div className="pane-tab">
        {onTab ? (
          <button className="pane-name" onClick={onTab}>
            {tab}
          </button>
        ) : (
          <span className="pane-name">{tab}</span>
        )}
        {note && <span className="pane-note">{note}</span>}
        {counts.map((c, i) => (
          <span className="pane-count" key={i}>
            {c}
          </span>
        ))}
      </div>
    </section>
  );
}
