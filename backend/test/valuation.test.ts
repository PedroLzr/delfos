import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateSale } from '../src/valuation.js';
import { units } from '../src/domain.js';
const now = 1794259020501;
const book = { asset_id: '123', market: 'condition', timestamp: String(now), min_order_size: '5',
  bids: [{ price: '0.4', size: '100' }, { price: '0.6', size: '50' }], asks: [{ price: '0.7', size: '10' }] };
test('sale walks bids best-first and weights actual depth rather than using midpoint', () => {
  const result = estimateSale(book, '123', units('100'), units('40'), now);
  assert.equal(result.status, 'complete');
  assert.equal(result.grossProceeds, '50.0');
  assert.equal(result.grossPnl, '10.0');
  assert.equal(result.averageSellPrice, 0.5);
  assert.equal(result.currentPrice, 0.65);
});
test('insufficient depth never reports a profit or proceeds for a full sale', () => {
  const result = estimateSale(book, '123', units('200'), units('100'), now);
  assert.equal(result.status, 'insufficient-liquidity');
  assert.equal(result.filledShares, '150.0');
  assert.equal(result.grossPnl, null); assert.equal(result.grossProceeds, null);
});
test('negative results remain negative; costs use exact decimals', () => {
  const result = estimateSale(book, '123', units('100'), units('60.000001'), now);
  assert.equal(result.grossPnl, '-10.000001');
});
test('minimum size, absent bids, stale book and wrong asset fail safely', () => {
  assert.equal(estimateSale(book, '123', units('1'), units('1'), now).status, 'below-minimum');
  assert.equal(estimateSale({ ...book, bids: [] }, '123', units('100'), units('40'), now).grossPnl, null);
  assert.throws(() => estimateSale(book, '123', units('100'), units('40'), now + 61000), /desactualizado/);
  assert.throws(() => estimateSale(book, '456', units('100'), units('40'), now), /otro resultado/);
});
test('crossed or malformed books cannot generate a plausible but invalid profit', () => {
  assert.throws(() => estimateSale({ ...book, asks: [{ price: '0.5', size: '1' }] }, '123', units('100'), units('40'), now), /cruzado/);
  assert.throws(() => estimateSale({ ...book, bids: [{ price: '1.1', size: '10' }] }, '123', units('100'), units('40'), now), /no válido/);
});
