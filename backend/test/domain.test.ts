import test from 'node:test';
import assert from 'node:assert/strict';
import { type Log, ZeroHash } from 'ethers';
import { classify, decodePurchases, exchangeInterface, units } from '../src/domain.js';

const exchange = '0xe111180000d2663c0091e4f400237545b87b996b';
const wallet = '0x1111111111111111111111111111111111111111';
const other = '0x2222222222222222222222222222222222222222';
const tx = `0x${'ab'.repeat(32)}`;
const exchanges = new Set([exchange]);
const timestamps = new Map([[100, 1700000000]]);
function log(index: number, side = 0, amount = '12000', shares = '24000', maker = wallet, tokenId = 123n): Log {
  const encoded = exchangeInterface.encodeEventLog(exchangeInterface.getEvent('OrderFilled')!, [ZeroHash, maker, other, side, tokenId, units(amount), units(shares), 0n, ZeroHash, ZeroHash]);
  return { ...encoded, address: exchange, index, transactionHash: tx, blockNumber: 100, blockHash: ZeroHash, transactionIndex: 0, removed: false } as Log;
}
test('BUY is attributed to the order owner, never synthesized for its counterparty', () => {
  const purchases = decodePurchases([log(1)], timestamps, exchanges);
  assert.equal(purchases.length, 1); assert.equal(purchases[0]!.wallet, wallet);
  assert.equal(purchases[0]!.amountRaw, 12000000000n);
});
test('SELL and unrelated collateral transfers cannot become bets', () => {
  assert.equal(decodePurchases([log(1, 1), { ...log(2), topics: [ZeroHash] } as Log], timestamps, exchanges).length, 0);
});
test('partial fills in one transaction accumulate before threshold evaluation', () => {
  const [p] = decodePurchases([log(1), log(2, 0, '9000', '18000')], timestamps, exchanges);
  assert.equal(p!.amountRaw, units('21000')); assert.equal(p!.fills, 2);
  assert.equal(classify(p!.amountRaw, 'existing', units('20000'), units('10000')), 'whale');
});
test('different outcomes or wallets are not combined', () => {
  assert.equal(decodePurchases([log(1), log(2, 0, '12000', '24000', wallet, 124n), log(3, 0, '12000', '24000', other)], timestamps, exchanges).length, 3);
});
test('duplicate logs are counted once', () => {
  assert.equal(decodePurchases([log(1), log(1)], timestamps, exchanges)[0]!.fills, 1);
});
test('orphan logs and protocol accounts are excluded', () => {
  assert.equal(decodePurchases([{ ...log(1), removed: true } as Log, log(2, 0, '12000', '24000', exchange)], timestamps, exchanges).length, 0);
});
test('unknown exchange cannot spoof OrderFilled', () => {
  assert.equal(decodePurchases([{ ...log(1), address: other } as Log], timestamps, exchanges).length, 0);
});
test('thresholds are strictly greater, using exact six-decimal arithmetic', () => {
  const whale = units('20000'); const insider = units('10000');
  assert.equal(classify(insider, 'new', whale, insider), null);
  assert.equal(classify(insider + 1n, 'new', whale, insider), 'insider');
  assert.equal(classify(whale, 'existing', whale, insider), null);
  assert.equal(classify(whale + 1n, 'existing', whale, insider), 'whale');
  assert.equal(classify(whale + 1n, 'unknown', whale, insider), 'unknown');
  assert.equal(classify(whale + 1n, 'new', whale, insider), 'insider');
});
test('missing block timestamp prevents committing an incomplete range', () => {
  assert.throws(() => decodePurchases([log(1)], new Map(), exchanges), /cabecera/);
});
