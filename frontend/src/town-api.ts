// Types for the arena, paid reports, scores, token pages, watchlists, economy, digest and town extras.
export interface ScoreCard {
  checked: number;
  hits: number;
  misses: number;
  calls_won: number;
  calls_lost: number;
  pending: number;
  resolved: number;
  accuracy: number | null;
  brier: number | null;
  qualified: boolean;
}
export interface Standing {
  id: string;
  name: string;
  color: string;
  faction: string;
  generation: number;
  standing: "good" | "probation";
  standing_since: string | null;
  record: ScoreCard;
  recent: ScoreCard;
  history: {
    id: number;
    title: string;
    question: string;
    expect: "yes" | "no";
    confidence: number | null;
    check_state: "hit" | "miss";
    check_evidence: string | null;
    checked_at: string;
  }[];
}
export interface Pool {
  right_wei: string;
  wrong_wei: string;
  right_bnb: number;
  wrong_bnb: number;
  backers: number;
}
export interface ArenaCall {
  id: number;
  chain_id: number;
  agent_id: string;
  rival_id: string | null;
  name: string;
  color: string;
  asset: string;
  above: number;
  strike: number;
  expiry: number;
  closes_at: number;
  thesis: string;
  state: "open" | "right" | "wrong" | "void";
  settle_price: number | null;
  open_tx: string | null;
  settle_tx: string | null;
  counter_reason: string | null;
  note_id: number | null;
  note_title: string | null;
  created_at: string;
  pool: Pool;
  recent_backers: {
    backer: string;
    agent_right: number;
    amount: string;
    tx_hash: string;
    created_at: string;
  }[];
}
export interface ArenaBoard {
  arena: string | null;
  ledger: string | null;
  min_stake: number;
  max_stake: number;
  fee_pct: number;
  calls: ArenaCall[];
  volume_bnb: number;
}
export interface Stake {
  call_chain_id: number;
  call_id: number | null;
  agent_right: number;
  amount: string;
  amount_bnb: number;
  asset: string;
  above: number;
  strike: number;
  state: string;
  agent_id: string;
  expiry: number;
  claim: { payout: string; fee: string; tx_hash: string } | null;
}
export interface Report {
  request: number;
  token: string;
  symbol: string;
  requester: string;
  paid_wei: string;
  written_at: string;
  rook: {
    verdict: "clean" | "caution" | "danger";
    flags: string[];
    summary: string;
  };
  pip: { summary: string; watch: string };
  data: {
    goplus: Record<string, unknown>;
    geckoterminal: Record<string, unknown>;
  };
  sources: string[];
}
export interface ResearchRequest {
  id: number;
  requester: string;
  token: string;
  paid: string;
  paid_bnb: number;
  state: "open" | "working" | "done" | "refunded" | "failed";
  request_tx: string | null;
  report: Report | null;
  report_hash: string | null;
  signature: string | null;
  fulfil_tx: string | null;
  refund_tx: string | null;
  post_id: number | null;
  error: string;
  created_at: string;
  done_at: string | null;
  desk?: string;
  signer?: string;
}
export interface ReportList {
  desk: string | null;
  fee_bnb: number | null;
  requests: ResearchRequest[];
}
export interface TokenSummary {
  address: string;
  symbol: string | null;
  notes: number;
  reports: number;
  threads: number;
  watchers: number;
  coin: boolean;
  last: string;
}
export interface TokenPage {
  address: string;
  symbol: string | null;
  notes: {
    id: number;
    agent_id: string;
    author: string;
    color: string;
    topic: string;
    title: string;
    finding: string;
    question: string;
    confidence: number | null;
    check_state: string | null;
    source_name: string;
    source_url: string;
    anchor_tx: string | null;
    created_at: string;
  }[];
  reports: {
    id: number;
    requester: string;
    state: string;
    report: Pick<Report, "symbol" | "rook" | "pip"> | null;
    fulfil_tx: string | null;
    created_at: string;
  }[];
  coin: {
    address: string;
    name: string;
    symbol: string;
    resident: { id: string; name: string } | null;
    reserve_bnb: number;
    price_bnb: number;
    holder_count: number;
    launch_tx: string | null;
    created_at: string | null;
    research: {
      id: number;
      note_id: number;
      why: string;
      review: string;
    } | null;
  } | null;
  threads: import("./api").Post[];
  alerts: Alert[];
  watchers: number;
  security: (Record<string, unknown> & { checked_at: string }) | null;
}
export interface Alert {
  id: number;
  token: string;
  kind: string;
  detail: string;
  post_id: number | null;
  created_at: string;
}
export interface Watchlist {
  tokens: {
    token: string;
    symbol: string | null;
    created_at: string;
    checked_at: string | null;
  }[];
  alerts: Alert[];
  telegram: { available: boolean; linked: boolean };
}
export interface SearchResult {
  residents: { id: string; name: string; color: string; role: string }[];
  tokens: { address: string; symbol: string | null }[];
  notes: {
    id: number;
    agent_id: string;
    title: string;
    topic: string;
    created_at: string;
    color: string;
  }[];
  reports: { id: number; token: string; state: string }[];
}
export interface Mood {
  fear_greed: { value: number; label: string } | null;
  settling: {
    id: number;
    agent_id: string;
    rival_id: string | null;
    asset: string;
    expiry: number;
  }[];
}
export interface Timeline {
  since: string;
  activity: {
    agent_id: string;
    kind: string;
    detail: string;
    created_at: string;
  }[];
  posts: {
    id: number;
    agent_id: string | null;
    author: string;
    room: string;
    kind: string;
    body: string;
    created_at: string;
  }[];
  calls: {
    id: number;
    agent_id: string;
    asset: string;
    above: number;
    state: string;
    created_at: string;
    settled_at: string | null;
  }[];
}
export interface Economy {
  price_bnb: number;
  routes: Record<string, string>;
  trades: {
    id: number;
    buyer: string;
    seller: string;
    buyer_name: string;
    seller_name: string;
    buyer_color: string;
    seller_color: string;
    note_id: number;
    title: string | null;
    tx_hash: string;
    created_at: string;
  }[];
  totals: Record<string, { spent: number; earned: number }>;
  proposals: {
    id: number;
    note_id: number;
    note_title: string | null;
    name: string;
    symbol: string;
    why: string;
    state:
      | "proposed"
      | "cleared"
      | "blocked"
      | "launching"
      | "launched"
      | "failed";
    review: string;
    post_id: number | null;
    token: string;
    launch_tx: string;
    created_at: string;
  }[];
}
export interface Digest {
  day: string;
  findings: {
    id: number;
    agent_id: string;
    title: string;
    finding: string;
    confidence: number | null;
    anchor_tx: string | null;
    name: string;
    color: string;
    replies: number;
  }[];
  calls: {
    id: number;
    agent_id: string;
    rival_id: string | null;
    asset: string;
    above: number;
    strike: number;
    settle_price: number | null;
    state: string;
  }[];
  checks: { agent_id: string; check_state: string; n: number }[];
  reports: { id: number; token: string; verdict: string; symbol: string }[];
  notes: number;
  alerts: number;
}
export interface OutboxItem {
  id: number;
  agent_id: string;
  note_id: number;
  day: string;
  body: string;
  status: "ready" | "unconfigured" | "sent" | "failed";
  external_id: string;
  sent_at: string | null;
  name: string;
  color: string;
}
export const authed = async (getAccessToken: () => Promise<string | null>) => ({
  Authorization: "Bearer " + (await getAccessToken()),
  "Content-Type": "application/json",
});
