import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon } from "lucide-react";
import { api, short } from "./api";
import type { SearchResult } from "./town-api";
import { Face } from "./Town";

type Item = {
  key: string;
  label: string;
  detail: string;
  color?: string;
  go: () => void;
};

// ⌘K / Ctrl+K: residents, tokens, notes and audits in one box.
export function CommandSearch({
  onResident,
}: {
  onResident: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") setOpen(false);
    };
    const show = () => setOpen(true);
    addEventListener("keydown", key);
    addEventListener("murmur:search", show);
    return () => {
      removeEventListener("keydown", key);
      removeEventListener("murmur:search", show);
    };
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 20);
    else {
      setQ("");
      setResult(null);
    }
  }, [open]);
  useEffect(() => {
    if (!q.trim()) {
      setResult(null);
      return;
    }
    const t = setTimeout(() => {
      api<SearchResult>("/search?q=" + encodeURIComponent(q))
        .then((r) => {
          setResult(r);
          setActive(0);
        })
        .catch(() => setResult(null));
    }, 140);
    return () => clearTimeout(t);
  }, [q]);
  const close = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const items: Item[] = result
    ? [
        ...result.residents.map((r) => ({
          key: "a" + r.id,
          label: r.name,
          detail: "Resident · " + r.role,
          color: r.color,
          go: close(() => onResident(r.id)),
        })),
        ...result.tokens.map((t) => ({
          key: "t" + t.address,
          label: t.symbol || short(t.address),
          detail: "Token · " + short(t.address),
          go: close(() => (location.hash = "token/" + t.address)),
        })),
        ...result.notes.map((n) => ({
          key: "n" + n.id,
          label: n.title,
          detail: n.agent_id + " · " + n.topic,
          color: n.color,
          go: close(() => (location.hash = "note/" + n.id)),
        })),
        ...result.reports.map((r) => ({
          key: "r" + r.id,
          label: "Audit #" + r.id,
          detail: short(r.token) + " · " + r.state,
          go: close(() => (location.hash = "report/" + r.id)),
        })),
      ]
    : [];
  if (!open) return null;
  return (
    <div className="cmdk-backdrop" onClick={() => setOpen(false)}>
      <div
        className="cmdk panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search murmur"
        onClick={(e) => e.stopPropagation()}
      >
        <label className="cmdk-input">
          <SearchIcon size={16} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, items.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter" && items[active]) items[active].go();
            }}
            placeholder="Search residents, tokens, notes, audits or a 0x address"
            aria-label="Search"
          />
          <kbd>esc</kbd>
        </label>
        {q.trim() && (
          <ul className="cmdk-list" role="listbox">
            {items.length ? (
              items.map((it, i) => (
                <li key={it.key} role="option" aria-selected={i === active}>
                  <button
                    className={i === active ? "active" : ""}
                    onMouseEnter={() => setActive(i)}
                    onClick={it.go}
                  >
                    {it.color ? (
                      <Face color={it.color} size={20} />
                    ) : (
                      <span className="cmdk-dot" />
                    )}
                    <strong>{it.label}</strong>
                    <small>{it.detail}</small>
                  </button>
                </li>
              ))
            ) : result ? (
              <li className="cmdk-none">Nothing matches “{q}”.</li>
            ) : null}
          </ul>
        )}
      </div>
    </div>
  );
}
