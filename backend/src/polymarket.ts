import { z } from 'zod';
import { estimateSale } from './valuation.js';
import type { Config } from './config.js';
import type { History, MarketInfo, Purchase, Quote } from './domain.js';
import type { JsonClient } from './http.js';

const activitySchema = z.object({ data: z.array(z.object({
  proxy_wallet: z.string(), timestamp: z.number().int(), transaction_hash: z.string(), type: z.string(),
})), pagination: z.object({ has_more: z.boolean(), next_cursor: z.string().nullable().optional() }) });
const tokenSchema = z.object({ condition_id: z.string(), primary_token_id: z.string(), secondary_token_id: z.string() });
const encodedArray = z.union([z.string(), z.array(z.string())]).nullable().optional();
const gammaSchema = z.array(z.object({ question: z.string(), slug: z.string().optional(), conditionId: z.string().optional(),
  outcomes: encodedArray, clobTokenIds: encodedArray, positionIds: encodedArray,
  events: z.array(z.object({ id: z.union([z.string(), z.number()]), slug: z.string() })).optional(),
}));
function array(value: string | string[] | null | undefined): string[] {
  return z.array(z.string()).parse(typeof value === 'string' ? JSON.parse(value) : value ?? []);
}

export class PolymarketClient {
  private readonly cache = new Map<string, { value: MarketInfo; expires: number }>();
  constructor(private readonly http: JsonClient, private readonly config: Pick<Config, 'DATA_API_URL' | 'CLOB_API_URL' | 'GAMMA_API_URL'>) {}
  async history(purchase: Purchase): Promise<History> {
    const checkedAt = new Date().toISOString();
    let cursor: string | undefined;
    let currentSeen = false;
    const cursors = new Set<string>();
    // ASC + start=1 avoids recent-page bias and the API's default three-year floor.
    for (let page = 0; page < 10; page++) {
      const url = new URL('/v2/activity', this.config.DATA_API_URL);
      url.search = new URLSearchParams({ user: purchase.wallet, type: 'TRADE', start: '1',
        end: String(purchase.timestamp), sort_by: 'TIMESTAMP', sort_direction: 'ASC', limit: '100',
        ...(cursor ? { cursor } : {}) }).toString();
      const result = activitySchema.parse(await this.http.get(url));
      for (const row of result.data) {
        if (row.proxy_wallet.toLowerCase() !== purchase.wallet || row.type !== 'TRADE' || row.timestamp > purchase.timestamp) {
          throw new Error('La API no respetó los filtros del historial');
        }
        if (row.transaction_hash.toLowerCase() === purchase.txHash) currentSeen = true;
        else if (row.timestamp <= purchase.timestamp) return { status: 'existing', reason: 'Existe actividad anterior o en otra transacción del mismo segundo.', checkedAt };
      }
      if (!result.pagination.has_more) return currentSeen
        ? { status: 'new', reason: 'La primera actividad pública indexada corresponde a esta transacción; no demuestra la edad de la cuenta.', checkedAt }
        : { status: 'unknown', reason: 'La API todavía no confirma esta transacción en el historial.', checkedAt };
      cursor = result.pagination.next_cursor ?? undefined;
      if (!cursor || cursors.has(cursor)) throw new Error('Paginación de historial incompleta');
      cursors.add(cursor);
    }
    return { status: 'unknown', reason: 'No se ha podido completar la verificación del historial.', checkedAt };
  }
  async market(tokenId: string): Promise<MarketInfo> {
    const cached = this.cache.get(tokenId);
    if (cached && cached.expires > Date.now()) return cached.value;
    const mapping = tokenSchema.parse(await this.http.get(new URL(`/markets-by-token/${tokenId}`, this.config.CLOB_API_URL)));
    if (![mapping.primary_token_id, mapping.secondary_token_id].includes(tokenId)) throw new Error('CLOB devolvió un Token ID distinto');
    const url = new URL('/markets', this.config.GAMMA_API_URL);
    url.search = new URLSearchParams({ condition_ids: mapping.condition_id, limit: '1', include_archived: 'true' }).toString();
    const market = gammaSchema.parse(await this.http.get(url)).find(m => m.conditionId?.toLowerCase() === mapping.condition_id.toLowerCase());
    if (!market) throw new Error('Gamma todavía no resuelve el mercado');
    const ids = [array(market.clobTokenIds), array(market.positionIds)].find(values => values.includes(tokenId));
    const label = ids ? array(market.outcomes)[ids.indexOf(tokenId)] : undefined;
    if (!label) throw new Error('Gamma no identifica la etiqueta del resultado');
    // Sports outcomes can be team names, not Yes/No. Preserve their actual label.
    const outcome = /^yes$/i.test(label) ? 'SÍ' : /^no$/i.test(label) ? 'NO' : label;
    const event = market.events?.length === 1 ? market.events[0] : undefined;
    const value: MarketInfo = { title: market.question, outcome, slug: market.slug ?? null, conditionId: mapping.condition_id, eventId: event ? String(event.id) : null, eventSlug: event?.slug ?? null,
      url: event && market.slug ? `https://polymarket.com/event/${encodeURIComponent(event.slug)}/${encodeURIComponent(market.slug)}` : null };
    if (this.cache.size >= 2000) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(tokenId, { value, expires: Date.now() + 3600000 });
    return value;
  }
  async valuation(p: Purchase) {
    const url = new URL('/book', this.config.CLOB_API_URL);
    url.searchParams.set('token_id', p.tokenId);
    return estimateSale(await this.http.get(url), p.tokenId, p.sharesRaw, p.amountRaw);
  }
  async quote(tokenId: string): Promise<Quote> {
    const url = new URL('/midpoint', this.config.CLOB_API_URL);
    url.searchParams.set('token_id', tokenId);
    const data = z.object({ mid: z.union([z.string(), z.number()]) }).parse(await this.http.get(url));
    const price = Number(data.mid);
    if (!Number.isFinite(price) || price < 0 || price > 1) throw new Error('Midpoint no válido');
    return { price, at: new Date().toISOString() };
  }
}
