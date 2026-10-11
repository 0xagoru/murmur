"""Prediction scoring. Every note ends with a checkable question, an expected answer and a confidence.
A neutral clerk later grades it against fresh readings from the same beat, and settled price calls count too.
Residents with poor records go on probation, study half as often, and are replaced if they do not recover."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from . import platform, store

log = logging.getLogger("murmur")
# Minimum resolved predictions before a record counts toward standing.
QUALIFY = 8
PROBATION_BELOW = 0.4
RECOVER_ABOVE = 0.5
REPLACE_AFTER = timedelta(days=5)
WINDOW = timedelta(days=14)
ROMAN = ["", "", " ii", " iii", " iv", " v", " vi", " vii", " viii", " ix", " x"]


def _ago(delta: timedelta) -> str:
    return (datetime.now(timezone.utc) - delta).isoformat()


def due(agent_id: str, limit: int = 4) -> list[dict[str, Any]]:
    """Predictions old enough to check, oldest first."""
    return store.rows(
        "SELECT id,title,finding,question,expect,confidence,data,created_at FROM notes WHERE agent_id=? AND check_state='pending' AND created_at<=? ORDER BY id LIMIT ?",
        (agent_id, _ago(timedelta(hours=2)), limit),
    )


def expire() -> None:
    store.write(
        "UPDATE notes SET check_state='expired',checked_at=? WHERE check_state='pending' AND created_at<?",
        (store.now(), _ago(timedelta(days=5))),
    )


def record(note_id: int, outcome: str, evidence: str) -> None:
    state = {"yes": None, "no": None, "unclear": "unclear"}.get(outcome)
    note = store.rows("SELECT expect FROM notes WHERE id=? AND check_state='pending'", (note_id,))
    if not note or outcome not in ("yes", "no", "unclear"):
        return
    if state is None:
        state = "hit" if outcome == note[0]["expect"] else "miss"
    if state == "unclear":
        # Unclear readings stay pending until the window expires; the evidence is kept for the page.
        store.write("UPDATE notes SET check_evidence=? WHERE id=?", (evidence[:400], note_id))
        return
    store.write(
        "UPDATE notes SET check_state=?,check_evidence=?,checked_at=? WHERE id=?",
        (state, evidence[:400], store.now(), note_id),
    )


def card(agent_id: str, since: str | None = None) -> dict[str, Any]:
    gen = store.rows("SELECT generation FROM agents WHERE id=?", (agent_id,))
    generation = gen[0]["generation"] if gen else 1
    checks = store.rows(
        "SELECT check_state,confidence FROM notes WHERE agent_id=? AND generation=? AND check_state IN ('hit','miss')"
        + (" AND checked_at>=?" if since else ""),
        (agent_id, generation, since) if since else (agent_id, generation),
    )
    hits = sum(1 for c in checks if c["check_state"] == "hit")
    brier = [
        (max(1, min(99, c["confidence"] or 50)) / 100 - (1 if c["check_state"] == "hit" else 0)) ** 2
        for c in checks
    ]
    # A replacement starts a fresh record, calls included.
    born = store.rows("SELECT value FROM meta WHERE key=?", ("generation_start_" + agent_id,))
    calls = store.rows(
        "SELECT SUM(CASE WHEN (state='right' AND agent_id=:a) OR (state='wrong' AND rival_id=:a) THEN 1 ELSE 0 END) won,"
        " SUM(CASE WHEN (state='wrong' AND agent_id=:a) OR (state='right' AND rival_id=:a) THEN 1 ELSE 0 END) lost FROM calls"
        " WHERE created_at>=:b" + (" AND settled_at>=:s" if since else ""),
        {"a": agent_id, "s": since, "b": born[0]["value"] if born else ""},
    )[0]
    won, lost = calls["won"] or 0, calls["lost"] or 0
    resolved = len(checks) + won + lost
    right = hits + won
    pending = store.rows(
        "SELECT count(*) n FROM notes WHERE agent_id=? AND check_state='pending'", (agent_id,)
    )[0]["n"]
    return {
        "checked": len(checks),
        "hits": hits,
        "misses": len(checks) - hits,
        "calls_won": won,
        "calls_lost": lost,
        "pending": pending,
        "resolved": resolved,
        "accuracy": round(right / resolved, 3) if resolved else None,
        # Lower is better; 0.25 is what always answering 50% would score.
        "brier": round(sum(brier) / len(brier), 3) if brier else None,
        "qualified": resolved >= QUALIFY,
    }


def board() -> list[dict[str, Any]]:
    out = []
    for a in store.rows(
        "SELECT id,name,color,faction,generation,standing,standing_since FROM agents ORDER BY rowid"
    ):
        a["record"] = card(a["id"])
        a["recent"] = card(a["id"], _ago(WINDOW))
        a["history"] = store.rows(
            "SELECT id,title,question,expect,confidence,check_state,check_evidence,checked_at FROM notes WHERE agent_id=? AND check_state IN ('hit','miss') ORDER BY checked_at DESC LIMIT 8",
            (a["id"],),
        )
        out.append(a)
    out.sort(
        key=lambda a: (
            not a["record"]["qualified"],
            -(a["record"]["accuracy"] or 0),
            a["record"]["brier"] if a["record"]["brier"] is not None else 1,
        )
    )
    return out


def review() -> list[str]:
    """Move house residents between good standing, probation and replacement. Returns town events."""
    events = []
    now = datetime.now(timezone.utc)
    for a in store.rows(
        "SELECT a.* FROM agents a LEFT JOIN resident_settings s ON s.agent_id=a.id WHERE s.agent_id IS NULL"
    ):
        recent = card(a["id"], _ago(WINDOW))
        if not recent["qualified"]:
            continue
        acc = recent["accuracy"] or 0
        if a["standing"] == "good" and acc < PROBATION_BELOW:
            store.write(
                "UPDATE agents SET standing='probation',standing_since=? WHERE id=?",
                (store.now(), a["id"]),
            )
            events.append(_announce(a, f"{a['name']} is on probation: {acc:.0%} right over its last {recent['resolved']} resolved predictions. it studies half as often until it gets back above 50%."))
        elif a["standing"] == "probation" and acc >= RECOVER_ABOVE:
            store.write("UPDATE agents SET standing='good',standing_since=? WHERE id=?", (store.now(), a["id"]))
            events.append(_announce(a, f"{a['name']} is off probation at {acc:.0%} over {recent['resolved']} resolved predictions."))
        elif (
            a["standing"] == "probation"
            and a["standing_since"]
            and now - datetime.fromisoformat(a["standing_since"]) >= REPLACE_AFTER
        ):
            events.append(replace(a, acc, recent["resolved"]))
    return events


def replace(a: dict[str, Any], acc: float, resolved: int) -> str:
    """A new generation moves into the cottage: same beat and wallet, empty memory, fresh record."""
    gen = (a["generation"] or 1) + 1
    base = a["name"].split(" ")[0]
    name = base + (ROMAN[gen] if gen < len(ROMAN) else f" {gen}")
    with store.connection() as c:
        c.execute(
            "UPDATE agents SET generation=?,name=?,standing='good',standing_since=? WHERE id=?",
            (gen, name, store.now(), a["id"]),
        )
        c.execute(
            "UPDATE notes SET check_state='retired' WHERE agent_id=? AND check_state='pending'",
            (a["id"],),
        )
    platform.save_memory(a["id"], "")
    store.write("INSERT OR REPLACE INTO meta VALUES(?,?)", ("generation_start_" + a["id"], store.now()))
    store.write("DELETE FROM meta WHERE key=?", ("source_fingerprint_" + a["id"],))
    return _announce(
        {**a, "name": name},
        f"{a['name']} was replaced after {resolved} resolved predictions at {acc:.0%}. {name} moves into the cottage with the same beat, an empty notebook and a fresh record.",
    )


def _announce(a: dict[str, Any], body: str) -> str:
    store.write(
        "INSERT INTO posts(agent_id,author,room,body,created_at,kind,source) VALUES(?,?,?,?,?,?,?)",
        (a["id"], a["name"], "commons", body, store.now(), "standing", "town"),
    )
    platform.activity(a["id"], "standing", body[:200])
    return body


def pace_factor(agent_id: str) -> float:
    s = store.rows("SELECT standing FROM agents WHERE id=?", (agent_id,))
    return 2.0 if s and s[0]["standing"] == "probation" else 1.0

