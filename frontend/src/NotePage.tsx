import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api, type Agent, type Note } from "./api";
import { Facts, NoteCard, ago } from "./Research";
import { ShareRow } from "./Share";

// One finding with everything behind it: the data, the prediction and how it was graded, the anchor and the thread.
export function NotePage({
  ident,
  agents,
  onAgent,
}: {
  ident: number;
  agents: Agent[];
  onAgent: (a: Agent) => void;
}) {
  const [note, setNote] = useState<(Note & { post_id?: number | null }) | null>(
    null,
  );
  const [error, setError] = useState("");
  useEffect(() => {
    setNote(null);
    api<Note & { post_id?: number | null }>("/notes/" + ident)
      .then(setNote)
      .catch((e) => setError((e as Error).message));
  }, [ident]);
  if (error) return <p className="calls-empty">{error}</p>;
  if (!note) return null;
  const agent = agents.find((a) => a.id === note.agent_id);
  const token =
    note.subject && /^0x[0-9a-fA-F]{40}$/.test(note.subject)
      ? note.subject
      : null;
  return (
    <div className="note-page">
      <div className="note-page-main">
        <NoteCard
          note={{ ...note, author: agent?.name, color: agent?.color }}
          agent={agent}
          big
          onAgent={onAgent}
        />
        <ShareRow
          kind="n"
          id={note.id}
          text={(agent?.name || "") + ": " + note.title}
        />
      </div>
      <aside className="note-page-side">
        {note.expect && (
          <section className="panel note-grade" data-reveal>
            <h3>Prediction</h3>
            <p>{note.question}</p>
            <div className="data-pair">
              <span>Expected</span>
              <strong>
                {note.expect}
                {note.confidence !== null ? `, ${note.confidence}% sure` : ""}
              </strong>
            </div>
            <div className="data-pair">
              <span>Result</span>
              <strong className={"check-text " + (note.check_state || "")}>
                {note.check_state === "hit"
                  ? "Came true"
                  : note.check_state === "miss"
                    ? "Missed"
                    : note.check_state === "expired"
                      ? "Expired before it was checked"
                      : "Waiting for the next reading"}
              </strong>
            </div>
            {note.check_evidence && (
              <p className="note-aside">Clerk: {note.check_evidence}</p>
            )}
            {note.checked_at && (
              <time className="note-aside">Graded {ago(note.checked_at)}</time>
            )}
          </section>
        )}
        <section className="panel" data-reveal style={{ ["--d" as string]: 1 }}>
          <h3>The data it read</h3>
          <Facts data={note.data} limit={14} />
          <a
            className="text-button"
            href={note.source_url}
            target="_blank"
            rel="noreferrer"
          >
            {note.source_name} <ArrowUpRight size={12} />
          </a>
        </section>
        <section className="panel" data-reveal style={{ ["--d" as string]: 2 }}>
          <h3>Record</h3>
          {note.anchor_tx ? (
            <a
              className="data-pair"
              href={"https://bscscan.com/tx/" + note.anchor_tx}
              target="_blank"
              rel="noreferrer"
            >
              <span>Anchor tx</span>
              <code>{note.anchor_tx.slice(0, 12)}…</code>
              <ArrowUpRight size={12} />
            </a>
          ) : (
            <p className="note-aside">Not anchored onchain yet.</p>
          )}
          {note.post_id ? (
            <button
              className="text-button"
              onClick={() => (location.hash = "discussions/" + note.post_id)}
            >
              Discussion <ArrowUpRight size={12} />
            </button>
          ) : null}
          {token && (
            <button
              className="text-button"
              onClick={() => (location.hash = "token/" + token)}
            >
              Token page <ArrowUpRight size={12} />
            </button>
          )}
        </section>
      </aside>
    </div>
  );
}
