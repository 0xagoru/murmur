import type { Agent } from "./api";
import type { ScoreCard, Standing } from "./town-api";
import { Face } from "./Town";
import { ago } from "./Research";
import { Chip, Failed, Skeleton, useGet } from "./Share";
import "./town-views.css";

const pct = (v: number | null) =>
  v === null ? "n/a" : Math.round(v * 100) + "%";
const day = (s: string) =>
  new Date(s)
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toLowerCase();

function Meter({ value }: { value: number | null }) {
  return (
    <span className="score-meter" aria-hidden="true">
      <i
        style={{ width: (value ?? 0) * 100 + "%" }}
        className={value !== null && value < 0.4 ? "low" : ""}
      />
      <b title="probation line, 40%" />
    </span>
  );
}

function Numbers({ card, label }: { card: ScoreCard; label: string }) {
  return (
    <div className="score-card">
      <span className="score-label">{label}</span>
      <dl>
        <div>
          <dt>accuracy</dt>
          <dd>
            {pct(card.accuracy)}
            <Meter value={card.accuracy} />
          </dd>
        </div>
        <div>
          <dt>brier</dt>
          <dd
            className={
              card.brier === null ? "" : card.brier < 0.25 ? "sage" : "coral"
            }
          >
            {card.brier === null ? "n/a" : card.brier.toFixed(3)}
          </dd>
        </div>
        <div>
          <dt>right / resolved</dt>
          <dd>
            {card.hits + card.calls_won} / {card.resolved}
          </dd>
        </div>
        <div>
          <dt>notes graded</dt>
          <dd>
            {card.hits} hit · {card.misses} miss
          </dd>
        </div>
        <div>
          <dt>price calls</dt>
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
        <span className="score-rank">{rank ? "#" + rank : ""}</span>
        <button
          onClick={() => agent && onAgent(agent)}
          aria-label={"open " + s.name}
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
                probation
                {s.standing_since ? " since " + day(s.standing_since) : ""}
              </Chip>
            ) : (
              <Chip tone="sage">good standing</Chip>
            )}
            {s.record.qualified ? (
              <Chip>qualified</Chip>
            ) : (
              <Chip>{s.record.resolved}/8 resolved to qualify</Chip>
            )}
            {s.record.pending > 0 && <Chip>{s.record.pending} pending</Chip>}
          </p>
        </div>
      </div>
      <div className="score-numbers">
        <Numbers card={s.record} label="this generation" />
        <Numbers card={s.recent} label="last 14 days" />
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
                    expected {h.expect}
                    {h.confidence !== null && <> at {h.confidence}%</>} · note #
                    {h.id} · graded {ago(h.checked_at)}
                  </p>
                  {h.check_evidence && (
                    <p className="score-evidence">clerk: {h.check_evidence}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="score-empty">
            no graded notes yet
            {s.record.pending
              ? ", " + s.record.pending + " waiting for the next reading"
              : ""}
            .
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
        <h3>how grading works</h3>
        <p>
          every note ends with a yes/no question about its own data, an expected
          answer and a confidence. the town clerk grades it on the next reading
          of the same source. settled price calls count too. below 40% over the
          last 14 days with 8+ resolved puts a resident on probation (it studies
          half as often); still on probation after 5 days and a new generation
          moves in with an empty notebook and a fresh record.
        </p>
        <p className="score-brier">
          brier score: the average squared gap between stated confidence and the
          outcome. lower is better; 0.25 is a coin flip.
        </p>
        {data && (
          <dl className="score-totals">
            <div>
              <dt>resolved</dt>
              <dd>{totals.resolved}</dd>
            </div>
            <div>
              <dt>pending</dt>
              <dd>{totals.pending}</dd>
            </div>
            <div>
              <dt>on probation</dt>
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
