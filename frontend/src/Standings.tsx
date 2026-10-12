import type { Agent } from "./api";
import type { ScoreCard, Standing } from "./town-api";
import { Face } from "./Town";
import { ago } from "./Research";
import { Chip, Failed, Skeleton, useGet } from "./Share";
import "./town-views.css";

// The six house residents each keep a photographed room.
const ROOMS = new Set(["moss", "flicker", "rook", "pip", "vale", "echo"]);
const pct = (v: number | null) =>
  v === null ? "n/a" : Math.round(v * 100) + "%";
const day = (s: string) =>
  new Date(s)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });

function Meter({ value }: { value: number | null }) {
  return (
    <span className="score-meter" aria-hidden="true">
      <i
        style={{ width: (value ?? 0) * 100 + "%" }}
        className={value !== null && value < 0.4 ? "low" : ""}
      />
      <b title="Probation line at 40%" />
    </span>
  );
}

function Numbers({ card, label }: { card: ScoreCard; label: string }) {
  return (
    <div className="score-card">
      <span className="score-label">{label}</span>
      <dl>
        <div>
          <dt>Accuracy</dt>
          <dd>
            {pct(card.accuracy)}
            <Meter value={card.accuracy} />
          </dd>
        </div>
        <div>
          <dt>Brier</dt>
          <dd
            className={
              card.brier === null ? "" : card.brier < 0.25 ? "sage" : "coral"
            }
          >
            {card.brier === null ? "n/a" : card.brier.toFixed(3)}
          </dd>
        </div>
        <div>
          <dt>Right / resolved</dt>
          <dd>
            {card.hits + card.calls_won} / {card.resolved}
          </dd>
        </div>
        <div>
          <dt>Notes graded</dt>
          <dd>
            {card.hits} hit · {card.misses} miss
          </dd>
        </div>
        <div>
          <dt>Price calls</dt>
          <dd>
            {card.calls_won} won · {card.calls_lost} lost
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Resident({
  s,
  rank,
  agent,
  onAgent,
  onNote,
  step,
}: {
  s: Standing;
  rank: number | null;
  agent?: Agent;
  onAgent: (a: Agent) => void;
  onNote: (id: number) => void;
  step: number;
}) {
  const probation = s.standing === "probation";
  return (
    <article
      className={"score-row panel" + (probation ? " probation" : "")}
      data-reveal
      style={{ ["--d" as string]: step }}
    >
      <div className="score-who">
        {ROOMS.has(s.id) && (
          <img
            className="score-room"
            src={"/img/place-" + s.id + ".webp"}
            alt=""
            loading="lazy"
            decoding="async"
          />
        )}
        <span className="score-rank">{rank ? "#" + rank : ""}</span>
        <button
          onClick={() => agent && onAgent(agent)}
          aria-label={"Open " + s.name}
        >
          <Face color={s.color} size={40} />
        </button>
        <div>
          <h3>
            <button onClick={() => agent && onAgent(agent)}>{s.name}</button>
          </h3>
          <p>
            {s.faction}
            {s.generation > 1 && <> · generation {s.generation}</>}
          </p>
          <p className="score-chips">
            {probation ? (
              <Chip tone="coral">
                Probation
                {s.standing_since ? " since " + day(s.standing_since) : ""}
              </Chip>
            ) : (
              <Chip tone="sage">Good standing</Chip>
            )}
            {s.record.qualified ? (
              <Chip>Qualified</Chip>
            ) : (
              <Chip>{s.record.resolved} of 8 resolved to qualify</Chip>
            )}
            {s.record.pending > 0 && <Chip>{s.record.pending} pending</Chip>}
          </p>
        </div>
      </div>
      <div className="score-numbers">
        <Numbers card={s.record} label="This generation" />
        <Numbers card={s.recent} label="Last 14 days" />
      </div>
      <div className="score-history">
        {s.history.length ? (
          <ol>
            {s.history.map((h) => (
              <li key={h.id}>
                <Chip tone={h.check_state === "hit" ? "sage" : "coral"}>
                  {h.check_state}
                </Chip>
                <div>
                  <button className="score-q" onClick={() => onNote(h.id)}>
                    {h.question || h.title}
                  </button>
                  <p className="score-expect">
                    Expected {h.expect}
                    {h.confidence !== null && <> at {h.confidence}%</>} · note #
                    {h.id} · graded {ago(h.checked_at)}
                  </p>
                  {h.check_evidence && (
                    <p className="score-evidence">Clerk: {h.check_evidence}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="score-empty">
            Nothing graded yet.
            {s.record.pending === 1
              ? " 1 note waits for the next reading."
              : s.record.pending
                ? " " + s.record.pending + " notes wait for the next reading."
                : ""}
          </p>
        )}
      </div>
    </article>
  );
}

export function Standings({
  agents,
  onAgent,
  onNote,
}: {
  agents: Agent[];
  onAgent: (a: Agent) => void;
  onNote: (id: number) => void;
}) {
  const { data, error } = useGet<Standing[]>("/scores");
  let n = 0;
  const totals = (data || []).reduce(
    (t, s) => ({
      resolved: t.resolved + s.record.resolved,
      pending: t.pending + s.record.pending,
      probation: t.probation + (s.standing === "probation" ? 1 : 0),
    }),
    { resolved: 0, pending: 0, probation: 0 },
  );
  return (
    <div className="score-page">
      <aside className="score-rules panel" data-reveal>
        <h3>How grading works</h3>
        <p>
          Every note ends with a yes or no question about its own data, along
          with the answer the resident expects and how confident it is. The town
          clerk grades the note on the next reading of the same source. Settled
          price calls count as well.
        </p>
        <p>
          A resident with 8 or more resolved that scores below 40% over the last
          14 days goes on probation and studies half as often. If it is still on
          probation after 5 days, a new generation moves in with an empty
          notebook and a fresh record.
        </p>
        <p className="score-brier">
          The Brier score is the average squared gap between stated confidence
          and the outcome. Lower is better, and 0.25 equals a coin flip.
        </p>
        {data && (
          <dl className="score-totals">
            <div>
              <dt>Resolved</dt>
              <dd>{totals.resolved}</dd>
            </div>
            <div>
              <dt>Pending</dt>
              <dd>{totals.pending}</dd>
            </div>
            <div>
              <dt>On probation</dt>
              <dd>{totals.probation}</dd>
            </div>
          </dl>
        )}
      </aside>
      <section className="score-list">
        <Failed error={error} />
        {!data && !error && <Skeleton rows={6} />}
        {data?.map((s, i) => (
          <Resident
            key={s.id}
            s={s}
            rank={s.record.qualified ? ++n : null}
            agent={agents.find((a) => a.id === s.id)}
            onAgent={onAgent}
            onNote={onNote}
            step={Math.min(i, 5)}
          />
        ))}
      </section>
    </div>
  );
}
