// Run inside the backend container via stdin; see README.
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Store } from './dist/store.js';
import { Scanner } from './dist/scanner.js';
import { Logger } from './dist/logger.js';
import { readConfig } from './dist/config.js';
import { EnrichmentWorker } from './dist/enrichment.js';
const connection = new URL(process.env.DATABASE_URL);
connection.pathname = '/delfos_test';
const pool = new Pool({ connectionString: connection.toString() });
const store = new Store(pool);
const p = { id: 'fixture-1', wallet: '0x1111111111111111111111111111111111111111', tokenId: '123', txHash: 'fixture-tx',
  blockNumber: 101, blockHash: 'hash101', txIndex: 0, logIndex: 1, timestamp: 1700000000,
  amountRaw: 25000000000n, sharesRaw: 50000000000n, collateral: 'pUSD', fills: 2 };
try {
  await store.migrate();
  await pool.query('TRUNCATE purchases,checkpoints,chain_cursor CASCADE');
  await store.initialize(100, 'hash100');
  await store.commit([p], 101, 'hash101', 10000000000n);
  await store.commit([p], 101, 'hash101', 10000000000n);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM purchases')).rows[0].n, 1);
  assert.equal((await store.pending()).length, 1);
  assert.equal((await store.cursor()).blockNumber, 101);
  console.log('PASS atomic cursor and idempotent replay');

  const invalid = { ...p, id: 'fixture-invalid', blockNumber: 102, sharesRaw: -1n };
  await assert.rejects(store.commit([invalid], 102, 'hash102', 10000000000n));
  assert.equal((await store.cursor()).blockNumber, 101);
  console.log('PASS failed insertion does not advance cursor');

  const next = { ...p, id: 'fixture-2', txHash: 'fixture-next', blockNumber: 102, blockHash: 'hash102' };
  assert.equal(await store.hasPrior(p), false);
  assert.equal(await store.hasPrior(next), true);
  let notifications = 0;
  const worker = new EnrichmentWorker(readConfig(), store, {
    history: async () => ({ status: 'existing', reason: 'Integration fixture', checkedAt: new Date().toISOString() }),
    market: async () => ({ title: 'Isolated test market', outcome: 'SÍ', slug: null, conditionId: 'fixture' }),
    quote: async () => ({ price: 0.6, at: new Date().toISOString() }),
  }, new Logger(), () => { notifications++; });
  await worker.step();
  assert.equal((await store.list())[0].kind, 'whale');
  assert.equal((await store.list())[0].executionPrice, 0.5);
  assert.ok(notifications > 0);
  const saved = (await store.list())[0];
  await store.saveEnrichment(p, { ...saved, market: null }, true, 0);
  assert.equal((await store.list())[0].market.title, 'Isolated test market');
  console.log('PASS persistent job becomes enriched alert and notifies frontend');
  const alert = { id: p.id, kind: 'whale', wallet: p.wallet, quote: { price: null, at: null } };
  assert.equal(await store.saveEnrichment(p, alert, false, 0), true);
  assert.equal((await store.list()).length, 1);
  assert.equal((await store.stats()).wallets, 1);
  console.log('PASS wallet history, enrichment and ranking');

  const second = { ...p, id: 'fixture-other-event', txHash: 'different-tx', blockNumber: 102, blockHash: 'hash102' };
  await store.commit([second], 102, 'hash102', 10000000000n);
  await store.saveEnrichment(p, { ...alert, market: { eventId: 'event-a' } }, false, 0);
  await store.saveEnrichment(second, { ...alert, id: second.id, market: { eventId: 'event-a' } }, false, 0);
  assert.equal((await store.walletGroups()).length, 0);
  await store.saveEnrichment(second, { ...alert, id: second.id, market: { eventId: 'event-b' } }, false, 0);
  const groups = await store.walletGroups();
  assert.equal(groups.length, 1); assert.equal(groups[0].wallet, p.wallet); assert.equal(groups[0].events, 2);
  assert.equal((await store.list('latest', 200, p.wallet)).length, 2);
  assert.equal((await store.list('latest', 200, '0x2222222222222222222222222222222222222222')).length, 0);
  await store.rollback(101, 'hash101');
  assert.equal((await store.walletGroups()).length, 0);
  console.log('PASS exact-wallet grouping requires different events and is removed after a reorg');

  const scanner = new Scanner(readConfig(), store, new Logger(), () => {});
  scanner.provider.getBlockNumber = async () => 122;
  scanner.provider.getBlock = async number => ({ number, hash: `hash${number}`, parentHash: `hash${number-1}`, timestamp: 1700000000 });
  scanner.provider.getLogs = async () => { throw new Error('RPC timeout'); };
  await assert.rejects(scanner.step(), /timeout/);
  assert.equal((await store.cursor()).blockNumber, 101);
  console.log('PASS RPC failure preserves durable cursor');

  scanner.provider.getBlock = async number => ({ number, hash: number === 101 ? 'replacement101' : `hash${number}`, parentHash: `hash${number-1}`, timestamp: 1700000000 });
  await scanner.step();
  assert.equal((await store.cursor()).blockNumber, 100);
  assert.equal((await store.list()).length, 0);
  assert.equal((await store.pending()).length, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM wallets')).rows[0].n, 0);
  assert.equal(await store.saveEnrichment(p, alert, false, 0), false);
  console.log('PASS reorg rolls back purchases, wallet history, alerts and jobs; stale worker cannot resurrect them');

  scanner.provider.getBlock = async number => ({ number, hash: `hash${number}`, parentHash: `hash${number-1}`, timestamp: 1700000000 });
  scanner.provider.getLogs = async () => [];
  await scanner.step();
  assert.equal((await store.cursor()).blockNumber, 102);
  assert.equal(scanner.state.phase, 'live');
  console.log('PASS replay resumes and advances through empty blocks');
  scanner.destroy();
} finally {
  await pool.end();
}
