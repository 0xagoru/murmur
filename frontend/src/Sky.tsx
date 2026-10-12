import { useEffect, useState } from "react";
import type { Agent } from "./api";
import { pattern, RESIDENT_IDS } from "./Stitch";

// A resident as a glowing silhouette: the stitch pattern, every stitch filled with light.
function Glow({ id, step }: { id: string; step: number }) {
  const rows = pattern(id, step);
  return (
    <svg viewBox="-1 -1 15 16" width="100%" height="100%" aria-hidden="true">
      {rows.flatMap((r, y) =>
        [...r].map((ch, x) =>
          ch === "." ? null : (
            <rect
              key={x + "-" + y}
              x={x}
              y={y}
              width="1.04"
              height="1.04"
              fill={ch === "e" ? "rgba(70,60,140,.55)" : "#fff"}
            />
          ),
        ),
      )}
    </svg>
  );
}

// Residents wander the flower field in the hero. Each keeps its own pace and turns at the edges.
export function Wanderers({
  agents,
  onAgent,
}: {
  agents: Agent[];
  onAgent: (a: Agent) => void;
}) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setStep((s) => s + 1), 420);
    return () => clearInterval(t);
  }, []);
  const house = agents.filter((a) => RESIDENT_IDS.includes(a.id)).slice(0, 6);
  return (
    <div className="wanderers">
      {house.map((a, i) => (
        <button
          key={a.id}
          className={"wanderer " + a.color}
          style={
            {
              "--i": i,
              "--x0": `${8 + i * 15}%`,
              "--dur": `${48 + ((i * 17) % 30)}s`,
              "--lane": i % 3,
            } as React.CSSProperties
          }
          onClick={() => onAgent(a)}
          aria-label={a.name + ", " + (a.beat ?? a.role)}
        >
          <span className="wanderer-body">
            <Glow id={a.id} step={(step + i) % 2} />
          </span>
          <span className="wanderer-name">{a.name}</span>
        </button>
      ))}
    </div>
  );
}
