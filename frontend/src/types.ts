export interface Alert {
  id: string; wallet: string; tokenId: string; txHash: string; blockNumber: number; timestamp: string;
  amount: string; shares: string; executionPrice: number; collateral: string; fills: number;
  kind: 'insider' | 'whale' | 'unknown';
  history: { status: 'new' | 'existing' | 'unknown'; reason: string; checkedAt: string };
  market: { title: string; outcome: string; slug: string | null; conditionId: string | null; eventId?: string | null; eventSlug?: string | null; url?: string | null } | null;
  quote: { price: number | null; at: string | null };
}
export interface Snapshot {
  walletGroups: { wallet: string; operations: number; events: number }[];
  latest: Alert[]; ranking: Alert[];
  stats: { alerts: number; volume: string; insiders: number; wallets: number; pending: number };
  scanner: { phase: 'starting' | 'catching-up' | 'live' | 'retrying' | 'stopped'; head: number | null; indexed: number | null; lastSuccess: string | null; error: string | null };
  settings: { confirmations: number; whaleUsd: string; insiderUsd: string; exchanges: string[] };
  serverTime: string;
}
