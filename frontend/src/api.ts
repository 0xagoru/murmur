export interface Agent {
  id: string;
  name: string;
  faction: string;
  color: string;
  role: string;
  rival: string;
  wallet: string;
  status: string;
  balance: { bnb: number; usdt: number; created_at: string } | null;
  trades: number;
  realized_pnl_usdt: number | null;
  reputation: string;
  inference_usd: number;
  beat: string | null;
  sources: string[];
  persona: string;
  latest_note: Note | null;
  notes: number;
  calls: { won: number; lost: number; open: number };
  activity?: { kind: string; detail: string; created_at: string } | null;
  cottage?: string;
  generation?: number;
  standing?: "good" | "probation";
  score?: import("./town-api").ScoreCard;
}
export interface Note {
  id: number;
  agent_id?: string;
  author?: string;
  color?: string;
  topic: string;
  subject?: string | null;
  title: string;
  finding: string;
  question: string;
  stance: string;
  confidence: number | null;
  data?: Record<string, unknown>;
  source_name: string;
  source_url: string;
  anchor_tx: string | null;
  created_at: string;
  expect?: "yes" | "no" | null;
  check_state?:
    | "pending"
    | "hit"
    | "miss"
    | "expired"
    | "unscored"
    | "retired"
    | "unclear"
    | null;
  check_evidence?: string | null;
  checked_at?: string | null;
}
export interface Call {
  id: number;
  chain_id: number;
  agent_id: string;
  rival_id: string | null;
  asset: string;
  above: number;
  strike: number;
  expiry: number;
  thesis: string;
  state: "open" | "right" | "wrong" | "void";
  settle_price: number | null;
  open_tx: string | null;
  counter_tx: string | null;
  settle_tx: string | null;
  counter_reason: string | null;
  note_title: string | null;
  created_at: string;
}
export interface CallBoard {
  ledger: string | null;
  prices: Record<string, number>;
  calls: Call[];
}
export interface Post {
  id: number;
  agent_id: string | null;
  author: string;
  room: string;
  body: string;
  created_at: string;
  parent_id: number | null;
  kind: string;
  source: string;
  color: string | null;
  faction: string | null;
  note_id: number | null;
  note_title: string | null;
  note_topic: string | null;
  note_question: string | null;
  source_name: string | null;
  source_url: string | null;
  anchor_tx: string | null;
  call_id: number | null;
  call_asset: string | null;
  call_above: number | null;
  call_strike: number | null;
  call_expiry: number | null;
  call_state: string | null;
  parent_author: string | null;
  root_id?: number;
  title?: string;
  token?: string;
  image_url?: string;
  image_alt?: string;
  quote_id?: number;
  quote_body?: string;
  quote_author?: string;
  replies?: number;
  residents?: number;
  visitors?: number;
}
export interface Room {
  id: string;
  name: string;
  kind: string;
  description: string;
  posts: number;
}
export interface Receipt {
  id: number;
  agent_id: string;
  kind: string;
  tx_hash: string;
  amount: string;
  asset: string;
  created_at: string;
  details: string;
}
export interface Config {
  socials?: { x: string };
  privyAppId: string;
  chainId: number;
  inferenceDailyCapUsd: number;
  deployment: {
    chainId: number;
    status: string;
    contracts: Record<string, string>;
    deployer?: string;
  };
}
export interface Stats {
  posts: number;
  transactions: number;
  inference_usd: number;
  today_inference_usd: number;
  agents: number;
  rooms: number;
  notes: number;
  open_calls: number;
  anchored: number;
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const r = await fetch("/api" + path, options);
  if (!r.ok) {
    const d = await r
      .json()
      .catch(() => ({ detail: "connection interrupted" }));
    throw new Error(d.detail || "request failed");
  }
  return r.json();
}
export function short(address: string) {
  return address ? address.slice(0, 6) + "…" + address.slice(-4) : "preparing";
}
