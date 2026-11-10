import { Interface, formatUnits, parseUnits, type Log } from 'ethers';

// CTF Exchange domain v2 and PositionManager Exchange domain v3 share this event.
export const exchangeInterface = new Interface([
  'event OrderFilled(bytes32 indexed orderHash,address indexed maker,address indexed taker,uint8 side,uint256 tokenId,uint256 makerAmountFilled,uint256 takerAmountFilled,uint256 fee,bytes32 builder,bytes32 metadata)',
]);
export const fillTopic = exchangeInterface.getEvent('OrderFilled')!.topicHash;
export type HistoryStatus = 'new' | 'existing' | 'unknown';
export type AlertKind = 'insider' | 'whale' | 'unknown';
export interface Purchase {
  id: string; wallet: string; tokenId: string; txHash: string; blockNumber: number;
  blockHash: string; txIndex: number; logIndex: number; timestamp: number;
  amountRaw: bigint; sharesRaw: bigint; collateral: string; fills: number;
}
export interface MarketInfo { title: string; outcome: string; slug: string | null; conditionId: string | null; eventId?: string | null; eventSlug?: string | null; url?: string | null; }
export interface Quote { price: number | null; at: string | null; }
export interface History { status: HistoryStatus; reason: string; checkedAt: string; }
export interface Alert {
  id: string; wallet: string; tokenId: string; txHash: string; blockNumber: number;
  timestamp: string; amount: string; shares: string; executionPrice: number;
  collateral: string; fills: number; kind: AlertKind; history: History;
  market: MarketInfo | null; quote: Quote;
}
export function classify(amount: bigint, history: HistoryStatus, whale: bigint, insider: bigint): AlertKind | null {
  if (amount > insider && history === 'new') return 'insider';
  if (amount > whale) return history === 'existing' ? 'whale' : 'unknown';
  if (amount > insider && history === 'unknown') return 'unknown';
  return null;
}
export const units = (value: string) => parseUnits(value, 6);
export const dollars = (value: bigint) => formatUnits(value, 6);

export function decodePurchases(logs: readonly Log[], timestamps: Map<number, number>, exchanges: Set<string>): Purchase[] {
  const groups = new Map<string, Purchase>();
  const seen = new Set<string>();
  for (const log of logs) {
    if (log.removed || !exchanges.has(log.address.toLowerCase()) || log.topics[0] !== fillTopic) continue;
    const eventKey = `${log.transactionHash}:${log.index}`;
    if (seen.has(eventKey)) continue;
    seen.add(eventKey);
    const event = exchangeInterface.parseLog(log);
    if (!event) throw new Error('No se pudo decodificar OrderFilled');
    const a = event.args;
    if (a.side !== 0n) continue;
    const wallet = String(a.maker).toLowerCase();
    if (exchanges.has(wallet)) continue;
    const amountRaw = BigInt(a.makerAmountFilled);
    const sharesRaw = BigInt(a.takerAmountFilled);
    if (amountRaw <= 0n || sharesRaw <= 0n) continue;
    const tokenId = String(a.tokenId);
    const id = `${log.transactionHash.toLowerCase()}:${wallet}:${tokenId}`;
    const timestamp = timestamps.get(log.blockNumber);
    if (timestamp === undefined) throw new Error('Falta la cabecera del bloque');
    const existing = groups.get(id);
    if (existing) {
      existing.amountRaw += amountRaw; existing.sharesRaw += sharesRaw; existing.fills++;
      existing.logIndex = Math.min(existing.logIndex, log.index);
    } else groups.set(id, { id, wallet, tokenId, txHash: log.transactionHash.toLowerCase(),
      blockNumber: log.blockNumber, blockHash: log.blockHash, txIndex: log.transactionIndex,
      logIndex: log.index, timestamp, amountRaw, sharesRaw, collateral: 'pUSD', fills: 1 });
  }
  return [...groups.values()].sort((a, b) => a.blockNumber - b.blockNumber || a.txIndex - b.txIndex || a.logIndex - b.logIndex);
}
