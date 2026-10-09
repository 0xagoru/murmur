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
