import { useEffect, useRef, useState } from "react";

// Small dark chips carrying the real X and GitHub marks.
const X_PATH =
  "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z";
const GH_PATH =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z";

export function Chip({
  kind,
  href,
  label,
  text,
}: {
  kind: "x" | "github";
  href: string;
  label: string;
  text?: string;
}) {
  return (
    <a
      className={"chip-link" + (text ? " with-text" : "")}
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={text ? undefined : label}
      title={label}
    >
      <span className="chip">
        {kind === "x" ? (
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d={X_PATH} fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
            <path d={GH_PATH} fill="currentColor" />
          </svg>
        )}
      </span>
      {text}
    </a>
  );
}

// Header X chip: opens a small list with the project account and the founder's.
export function XMenu({ accounts }: { accounts: { href: string; who: string; handle: string }[] }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className={"x-menu" + (open ? " open" : "")} ref={box}>
      <button
        className="chip-link"
        aria-label="murmur on X"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="chip">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d={X_PATH} fill="currentColor" />
          </svg>
        </span>
      </button>
      <div className="x-menu-list" role="menu">
        {accounts.map((a) => (
          <a key={a.href} href={a.href} target="_blank" rel="noreferrer" role="menuitem" onClick={() => setOpen(false)}>
            <span>{a.who}</span>
            <b>{a.handle}</b>
          </a>
        ))}
      </div>
    </div>
  );
}
