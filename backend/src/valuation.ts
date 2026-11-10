import { z } from 'zod';
import { dollars, units } from './domain.js';

const decimal = z.string().regex(/^\d+(?:\.\d{1,6})?$/);
const level = z.object({ price: decimal, size: decimal });
const bookSchema = z.object({ asset_id: z.string(), market: z.string(), timestamp: z.string().regex(/^\d+$/),
  bids: z.array(level), asks: z.array(level), min_order_size: decimal });

export function estimateSale(raw: unknown, tokenId: string, shares: bigint, cost: bigint, now = Date.now()) {
  const book = bookSchema.parse(raw);
  if (book.asset_id !== tokenId) throw new Error('Libro de órdenes de otro resultado');
  const timestamp = Number(book.timestamp);
  const at = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  if (!Number.isSafeInteger(at) || now - at > 60000 || at - now > 5000) throw new Error('Libro de órdenes desactualizado');
  if (shares <= 0n || cost <= 0n) throw new Error('Importe de compra no válido');
  const normalize = (levels: z.infer<typeof level>[]) => levels.map(l => {
    const price = units(l.price); const size = units(l.size);
    if (price > 1000000n || price <= 0n || size < 0n) throw new Error('Nivel de precio no válido');
    return { price, size };
  }).filter(l => l.size > 0n);
  const bids = normalize(book.bids).sort((a, b) => a.price > b.price ? -1 : a.price < b.price ? 1 : 0);
  const asks = normalize(book.asks).sort((a, b) => a.price < b.price ? -1 : a.price > b.price ? 1 : 0);
  if (bids[0] && asks[0] && bids[0].price >= asks[0].price) throw new Error('Libro cruzado; no se puede estimar la venta');
  let remaining = shares; let proceedsScaled = 0n;
  for (const bid of bids) {
    const filled = remaining < bid.size ? remaining : bid.size;
    proceedsScaled += filled * bid.price; remaining -= filled;
    if (remaining === 0n) break;
  }
  const filled = shares - remaining;
  const proceeds = proceedsScaled / 1000000n;
  const belowMinimum = shares < units(book.min_order_size);
  const complete = remaining === 0n && !belowMinimum;
  return {
    status: belowMinimum ? 'below-minimum' : complete ? 'complete' : 'insufficient-liquidity',
    at: new Date(at).toISOString(), requestedShares: dollars(shares), filledShares: dollars(filled),
    currentPrice: bids[0] && asks[0] ? Number(bids[0].price + asks[0].price) / 2000000 : null,
    averageSellPrice: complete ? Number(proceedsScaled) / Number(shares) / 1000000 : null,
    grossProceeds: complete ? dollars(proceeds) : null,
    grossPnl: complete ? dollars(proceeds - cost) : null,
  };
}
