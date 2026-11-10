import test from 'node:test';
import assert from 'node:assert/strict';
import { PolymarketClient } from '../src/polymarket.js';
import type { Purchase } from '../src/domain.js';

const config = { DATA_API_URL: 'https://data-api.polymarket.com', CLOB_API_URL: 'https://clob.polymarket.com', GAMMA_API_URL: 'https://gamma-api.polymarket.com' };
const p: Purchase = { id: 'test', wallet: '0x1111111111111111111111111111111111111111', txHash: '0xabc', tokenId: '123', blockNumber: 100,
  blockHash: '0x123', txIndex: 0, logIndex: 0, timestamp: 1700000000, amountRaw: 11000000000n, sharesRaw: 22000000000n, collateral: 'pUSD', fills: 1 };
const row = (hash = p.txHash, timestamp = p.timestamp) => ({ proxy_wallet: p.wallet, timestamp, transaction_hash: hash, type: 'TRADE' });
const page = (rows: unknown[], hasMore = false, cursor: string | null = null) => ({ data: rows, pagination: { has_more: hasMore, next_cursor: cursor } });
test('checks the full earliest history including makers, not a limited recent trades page', async () => {
  const api = new PolymarketClient({ get: async url => {
    assert.equal(url.pathname, '/v2/activity'); assert.equal(url.searchParams.get('start'), '1');
    assert.equal(url.searchParams.get('type'), 'TRADE'); assert.equal(url.searchParams.get('sort_direction'), 'ASC');
    assert.equal(url.searchParams.get('side'), null);
    return page([row()]);
  } }, config);
  assert.equal((await api.history(p)).status, 'new');
});
test('empty or unindexed history is unknown, never new', async () => {
  const api = new PolymarketClient({ get: async () => page([]) }, config);
  assert.equal((await api.history(p)).status, 'unknown');
});
test('an older trade makes the account existing', async () => {
  const api = new PolymarketClient({ get: async () => page([row('0xolder', p.timestamp - 500)]) }, config);
  assert.equal((await api.history(p)).status, 'existing');
});
test('other activity in the same second is conservatively existing', async () => {
  const api = new PolymarketClient({ get: async () => page([row(), row('0xother')]) }, config);
  assert.equal((await api.history(p)).status, 'existing');
});
test('follows next_cursor before declaring no prior activity', async () => {
  let calls = 0;
  const api = new PolymarketClient({ get: async url => {
    calls++; return url.searchParams.has('cursor') ? page([row('0xolder', p.timestamp - 1)]) : page([row()], true, 'next');
  } }, config);
  assert.equal((await api.history(p)).status, 'existing'); assert.equal(calls, 2);
});
test('invalid pagination and API errors are not interpreted as empty history', async () => {
  const api = new PolymarketClient({ get: async () => page([row()], true) }, config);
  await assert.rejects(api.history(p), /incompleta/);
  const unavailable = new PolymarketClient({ get: async () => { throw new Error('HTTP 429'); } }, config);
  await assert.rejects(unavailable.history(p), /429/);
});
test('ignoring wallet filters is rejected', async () => {
  const api = new PolymarketClient({ get: async () => page([{ ...row(), proxy_wallet: '0xother' }]) }, config);
  await assert.rejects(api.history(p), /filtros/);
});
test('maps Token ID through CLOB to Gamma and distinguishes NO', async () => {
  const api = new PolymarketClient({ get: async url => url.hostname.startsWith('clob')
    ? { condition_id: '0xcondition', primary_token_id: '122', secondary_token_id: '123' }
    : [{ question: '¿Ocurrirá?', conditionId: '0xcondition', slug: 'ocurrira', outcomes: '["Yes","No"]', clobTokenIds: '["122","123"]', events: [{ id: '9', slug: 'parent-event' }] }] }, config);
  const market = await api.market('123'); assert.equal(market.outcome, 'NO'); assert.equal(market.title, '¿Ocurrirá?');
  assert.equal(market.eventId, '9');
  assert.equal(market.url, 'https://polymarket.com/event/parent-event/ocurrira');
});
test('preserves named sports outcomes instead of inventing a YES/NO label', async () => {
  const api = new PolymarketClient({ get: async url => url.hostname.startsWith('clob')
    ? { condition_id: '0xcondition', primary_token_id: '122', secondary_token_id: '123' }
    : [{ question: 'Equipo A vs Equipo B', conditionId: '0xcondition', outcomes: '["Equipo A","Equipo B"]', positionIds: ['122','123'] }] }, config);
  assert.equal((await api.market('123')).outcome, 'Equipo B');
});
test('a different token mapping and invalid midpoint are rejected', async () => {
  const api = new PolymarketClient({ get: async () => ({ condition_id: '0xcondition', primary_token_id: '5', secondary_token_id: '6' }) }, config);
  await assert.rejects(api.market('123'), /distinto/);
  await assert.rejects(new PolymarketClient({ get: async () => ({ mid: '1.5' }) }, config).quote('123'), /válido/);
});
