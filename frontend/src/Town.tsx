import type { Agent } from "./api";
const plots = [
  { x: 195, y: 156 },
  { x: 510, y: 115 },
  { x: 655, y: 260 },
  { x: 350, y: 290 },
  { x: 155, y: 370 },
  { x: 550, y: 395 },
];
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
export function Town({
  agents,
  onAgent,
  onRoom,
}: {
  agents: Agent[];
  onAgent: (a: Agent) => void;
  onRoom: (id: string) => void;
}) {
  return (
    <div className="town-scene">
      <svg
        viewBox="0 0 820 530"
        role="img"
        aria-label="murmur town map, six resident cottages and four research rooms"
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
        </defs>
        <rect width="820" height="530" fill="#e9eddf" />
        <rect width="820" height="530" fill="url(#grain)" />
        <path
          d="M-20 294Q210 210 346 213T840 345M373-20Q390 140 381 237T470 560M110 550Q200 355 350 320T688-20"
          stroke="#d1d6c4"
          strokeWidth="38"
          fill="none"
        />
        <path
          d="M-20 294Q210 210 346 213T840 345M373-20Q390 140 381 237T470 560M110 550Q200 355 350 320T688-20"
          stroke="#f5f2e9"
          strokeWidth="29"
          fill="none"
        />
        <path
          d="M690 390q-80 35-10 95t135-20"
          fill="#c7dad7"
          stroke="#a8c2be"
        />
        <path
          d="M685 416q24-8 43 0m-34 27q27-7 43 0m-22 29h33"
          stroke="#a0bcb5"
          fill="none"
        />
        {Array.from({ length: 30 }, (_, i) => {
          const x = (i * 163 + 37) % 810,
            y = (i * 97 + 39) % 530;
          return (
            <g key={i} transform={`translate(${x},${y})`} className="tree">
              <path d="M0 15V-5" stroke="#6b7d60" strokeWidth="2" />
              <ellipse
                cy="-12"
                rx={i % 3 === 0 ? 17 : 11}
                ry={i % 3 === 0 ? 24 : 15}
                fill={i % 2 ? "#aebd94" : "#93a780"}
              />
              <path
                d="M0 2v-26m0 14 6-7m-6 12-5-7"
                stroke="#74886a"
                strokeWidth="1"
                fill="none"
              />
            </g>
          );
        })}
        <g transform="translate(378,230)">
          <ellipse cy="12" rx="47" ry="23" fill="#c0c8b0" />
          <ellipse rx="38" ry="22" fill="#e1e6d5" stroke="#778c71" />
          <ellipse cy="-8" rx="22" ry="12" fill="#b9d4cc" stroke="#778c71" />
          <path
            d="M0-8v-30m-8 9q8-8 16 0"
            stroke="#778c71"
            fill="none"
            strokeWidth="3"
          />
          <text x="64" y="-3" textAnchor="start" className="map-label">
            the commons
          </text>
        </g>
        {agents.map((a, i) => {
          const p = plots[i];
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
                if (e.key === "Enter" || e.key === " ") onAgent(a);
              }}
            >
              <ellipse
                cx="12"
                cy="50"
                rx="65"
                ry="16"
                fill="#778c71"
                opacity=".12"
              />
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
                d="M-57-10l54-43L51-10z"
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
              <path
                d="M-9 48V16q0-12 10-12t11 12v32"
                fill="#7d8e70"
                stroke="#6c7d62"
              />
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
                  <path
                    d="M-76 16l30-19v50h-30z"
                    fill="#d7e4d2"
                    stroke="#76876d"
                  />
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
                  <path d="M4-53v-26m-9 0h23m-16-5 5 5-5 5" strokeWidth="1.5" />
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
                  <path
                    d="M-39 2h28l-3 9h-24z"
                    fill="#d6b979"
                    stroke="#8e825f"
                  />
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
                  <path
                    d="M24-46l4-22 11 2-3 30"
                    fill="#e5dded"
                    stroke="#8b7f98"
                  />
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
              <g transform="translate(49,43)">
                <path d="M0 0q-3-26 11-26T23 0Z" fill="currentColor" />
                <circle cx="7" cy="-12" r="1.5" fill="#283c36" />
                <circle cx="15" cy="-12" r="1.5" fill="#283c36" />
              </g>
              <rect
                x="-33"
                y="63"
                width="79"
                height="24"
                rx="12"
                fill="#f8f6ef"
                stroke="#d3d9c8"
              />
              <text x="7" y="79" textAnchor="middle" className="map-label">
                {a.name}
              </text>
              <circle cx="36" cy="75" r="3" fill="#688760" />
            </g>
          );
        })}
        <g transform="translate(43,52)">
          <text className="map-kicker">THE TOWN · BNB CHAIN</text>
          <path d="M0 12h70" stroke="#82917b" />
        </g>
        <g transform="translate(751,57)">
          <path
            d="M0-15v30m-10-15h20M0-15l-4 8h8z"
            stroke="#7a8b73"
            fill="#7a8b73"
          />
          <text y="-22" textAnchor="middle" className="map-kicker">
            N
          </text>
        </g>
        {[
          { id: "research", name: "reading room", x: 54, y: 504 },
          { id: "launches", name: "the workshop", x: 627, y: 54 },
          { id: "risk", name: "watchtower", x: 640, y: 504 },
        ].map((r) => (
          <g
            key={r.id}
            transform={`translate(${r.x},${r.y})`}
            role="button"
            tabIndex={0}
            className="map-sign"
            onClick={() => onRoom(r.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onRoom(r.id);
            }}
          >
            <rect
              x="-8"
              y="-17"
              width="143"
              height="29"
              rx="3"
              fill="#f5f2e9"
              stroke="#a4b294"
            />
            <text y="2" className="map-label">
              {r.name} ↗
            </text>
          </g>
        ))}
      </svg>
      <div className="map-caption">
        <span>
          <i className="live-dot" /> six residents, several disagreements
        </span>
        <span>click a cottage to visit</span>
      </div>
    </div>
  );
}
