import { useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, Copy, Image } from "lucide-react";
import { api } from "./api";
import "./town-views.css";

// Fetches one endpoint and re-reads it every minute while the view is open.
export function useGet<T>(path: string | null, every = 60000) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!path) return;
    let live = true;
    setData(null);
    setError("");
    const load = () =>
      api<T>(path)
        .then((d) => {
          if (!live) return;
          setData(d);
          setError("");
        })
        .catch((e: Error) => live && setError(e.message));
    void load();
    const timer = every ? setInterval(() => void load(), every) : undefined;
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [path, every]);
  return { data, error, setData };
}

export const number = (n: number, d = 6) =>
  n !== 0 && Math.abs(n) < 10 ** -d
    ? n.toPrecision(3)
    : n.toLocaleString("en-US", { maximumFractionDigits: d });

export const scan = (kind: "tx" | "token" | "address", value: string) =>
  "https://bscscan.com/" + kind + "/" + value;

export function Ext({
  href,
  children,
  className = "",
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      className={"share-ext " + className}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <ArrowUpRight size={12} />
    </a>
  );
}

export function Chip({
  tone = "",
  children,
}: {
  tone?: string;
  children: ReactNode;
}) {
  return <span className={"share-chip " + tone}>{children}</span>;
}

export function CopyButton({
  text,
  label,
  children,
}: {
  text: string;
  label: string;
  children?: ReactNode;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="share-copy"
      aria-label={label}
      title={label}
      onClick={() =>
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1600);
          })
          .catch(() => undefined)
      }
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {children}
    </button>
  );
}

// Grey placeholder blocks while a view loads. No text.
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="share-skel" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <i key={i} style={{ width: 92 - ((i * 17) % 40) + "%" }} />
      ))}
    </div>
  );
}

export function Failed({ error }: { error: string }) {
  return error ? (
    <p className="share-error" role="alert">
      {error}
    </p>
  ) : null;
}

export function ShareRow({
  kind,
  id,
  text,
}: {
  kind: "n" | "r";
  id: number;
  text: string;
}) {
  const link = "https://murmuragents.io/" + kind + "/" + id;
  return (
    <span className="share-row">
      <CopyButton text={link} label="copy link">
        link
      </CopyButton>
      <a
        href={
          "https://x.com/intent/post?text=" +
          encodeURIComponent(text) +
          "&url=" +
          encodeURIComponent(link)
        }
        target="_blank"
        rel="noreferrer"
        aria-label="post to X"
        title="post to X"
      >
        <img src="/x.svg" width="11" height="11" alt="" />
        post
      </a>
      <a
        href={
          "/api/share/" + (kind === "n" ? "note" : "report") + "/" + id + ".png"
        }
        target="_blank"
        rel="noreferrer"
        title="share image"
      >
        <Image size={13} />
        image
      </a>
    </span>
  );
}
