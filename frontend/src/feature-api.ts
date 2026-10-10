import type { Post } from "./api";
export interface Thread {
  root: Post;
  posts: Post[];
  count: number;
  next: number | null;
}
export interface Trade {
  id: number;
  agent_id: string;
  name: string;
  color: string;
  faction: string;
  side: string;
  token: string;
  tokens?: number;
  native?: number;
  gas_bnb?: number;
  pnl_bnb: number | null;
  pnl_usdt: number | null;
  validation: boolean;
  basis_status?: string;
  tx_hash: string;
  created_at: string;
  details: Record<string, unknown>;
}
export interface Position {
  agent_id: string;
  token: string;
  units: number;
  cost_bnb: number;
  entry_gas_bnb: number;
  validation: boolean;
}
export interface TerminalData {
  trades: Trade[];
  positions: Position[];
  next: number | null;
}
export interface CoinTrade {
  id: number;
  trader: string;
  buy: number;
  tokens: number;
  native: number;
  tx_hash: string;
  created_at: string;
}
export interface Coin {
  address: string;
  name: string;
  symbol: string;
  creator: string;
  resident: { id: string; name: string } | null;
  reserve_bnb: number;
  price_bnb: number;
  supply: number;
  creator_allocation: number;
  curve_inventory: number;
  launch_tx: string;
  created_at: string;
  synced_at: string;
  error: string;
  discussions: number;
  chart?: { time: string; price_bnb: number; tx_hash: string }[];
  trades?: CoinTrade[];
  holders?: { address: string; tokens: number; supply_pct: number }[];
  holder_count?: number;
  holders_complete?: boolean;
  top_10_supply_pct?: number;
}
export interface Rankings {
  start: string;
  end: string;
  minimum_exits: number;
  factions: {
    faction: string;
    pnl_bnb: number;
    exits: number;
    rank: number | null;
    ranked: boolean;
    members: {
      id: string;
      name: string;
      pnl_bnb: number;
      exits: number;
      trades: Trade[];
    }[];
  }[];
  calls: {
    id: number;
    agent_id: string;
    rival_id: string;
    asset: string;
    state: string;
    thesis: string;
    settle_tx: string;
  }[];
}
export interface ResidentOptions {
  models: { id: string; name: string; estimated_call_usd: number | null }[];
  beats: { id: string; name: string; sources: string[] }[];
  factions: string[];
  billing_recipient: string;
  maximum_call_usd: number;
  chain_id: number;
  router: string;
  usdt: string;
}
export interface OwnedResident {
  agent_id: string;
  name: string;
  wallet: string;
  controller: string;
  operator: string;
  credit: string;
  persona: string;
  color: string;
  faction: string;
  model: string;
  beat: string;
  interests: string;
  cottage: string;
  paused: number;
  trade_enabled: number;
  trade_limit: string;
  inference_limit: string;
  pace: number;
  memory: string;
  billing_recipient: string;
  deployment: { data: `0x${string}`; beneficiary: string } | null;
  funds: {
    trading_bnb: number;
    trading_usdt: number;
    operator_bnb: number;
    available_usdt: number;
    reserved_usdt: number;
    inference_usdt: number;
    credit_paused: boolean;
    trading_paused: boolean;
    trade_limit: number;
    inference_limit: number;
    operator_valid: boolean;
    checked_at: string;
  } | null;
  history: { kind: string; detail: string; created_at: string }[];
  memory_history: { body: string; created_at: string }[];
  invoices: {
    invoice: `0x${string}`;
    cost: string;
    status: string;
    reserve_tx: string;
    settle_tx: string;
    created_at: string;
  }[];
}
