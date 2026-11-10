import type { Pool, PoolClient } from 'pg';
import { dollars, type Alert, type Purchase } from './domain.js';

export const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS chain_cursor(id integer PRIMARY KEY CHECK(id=1), block_number bigint NOT NULL, block_hash text NOT NULL, start_block bigint NOT NULL);
CREATE TABLE IF NOT EXISTS checkpoints(block_number bigint PRIMARY KEY, block_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS purchases(
 id text PRIMARY KEY, wallet text NOT NULL, token_id text NOT NULL, tx_hash text NOT NULL,
 block_number bigint NOT NULL, block_hash text NOT NULL, tx_index integer NOT NULL, log_index integer NOT NULL,
 timestamp bigint NOT NULL, amount_raw numeric(78,0) NOT NULL CHECK(amount_raw>0),
 shares_raw numeric(78,0) NOT NULL CHECK(shares_raw>0), collateral text NOT NULL, fills integer NOT NULL
);
CREATE INDEX IF NOT EXISTS purchases_wallet_order ON purchases(wallet,block_number,tx_index);
CREATE INDEX IF NOT EXISTS purchases_block ON purchases(block_number);
CREATE TABLE IF NOT EXISTS enrichment_jobs(
 purchase_id text PRIMARY KEY REFERENCES purchases(id) ON DELETE CASCADE,
 attempts integer NOT NULL DEFAULT 0, next_attempt timestamptz NOT NULL DEFAULT now(), done boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS jobs_due ON enrichment_jobs(next_attempt) WHERE NOT done;
CREATE TABLE IF NOT EXISTS alerts(
 id text PRIMARY KEY REFERENCES purchases(id) ON DELETE CASCADE,
 amount numeric(78,6) NOT NULL, payload jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alerts_amount ON alerts(amount DESC);
CREATE OR REPLACE VIEW wallets AS SELECT wallet, min(timestamp) AS first_observed, max(timestamp) AS last_observed,
 count(*) AS observed_purchases, sum(amount_raw)/1000000 AS observed_volume FROM purchases GROUP BY wallet;
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
`;
export interface Cursor { blockNumber: number; blockHash: string; startBlock: number; }
interface PurchaseRow {
  id: string; wallet: string; token_id: string; tx_hash: string; block_number: string; block_hash: string;
  tx_index: number; log_index: number; timestamp: string; amount_raw: string; shares_raw: string; collateral: string; fills: number;
}
export function purchaseFromRow(r: PurchaseRow): Purchase {
  return { id: r.id, wallet: r.wallet, tokenId: r.token_id, txHash: r.tx_hash, blockNumber: Number(r.block_number),
    blockHash: r.block_hash, txIndex: r.tx_index, logIndex: r.log_index, timestamp: Number(r.timestamp),
    amountRaw: BigInt(r.amount_raw), sharesRaw: BigInt(r.shares_raw), collateral: r.collateral, fills: r.fills };
}
export class Store {
  constructor(readonly pool: Pool) {}
  async migrate() { await this.transaction(async c => { await c.query(schema); }); }
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async cursor(): Promise<Cursor | null> {
    const { rows } = await this.pool.query('SELECT * FROM chain_cursor WHERE id=1');
    const r = rows[0];
    return r ? { blockNumber: Number(r.block_number), blockHash: r.block_hash, startBlock: Number(r.start_block) } : null;
  }
  async initialize(blockNumber: number, hash: string) {
    await this.transaction(async c => {
      await c.query('INSERT INTO chain_cursor VALUES(1,$1,$2,$3) ON CONFLICT DO NOTHING', [blockNumber, hash, blockNumber + 1]);
      await c.query('INSERT INTO checkpoints VALUES($1,$2) ON CONFLICT DO NOTHING', [blockNumber, hash]);
    });
  }
  async commit(purchases: Purchase[], end: number, hash: string, threshold: bigint) {
    await this.transaction(async c => {
      for (const p of purchases) {
        const inserted = await c.query(`INSERT INTO purchases VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING RETURNING id`,
          [p.id, p.wallet, p.tokenId, p.txHash, p.blockNumber, p.blockHash, p.txIndex, p.logIndex, p.timestamp, p.amountRaw.toString(), p.sharesRaw.toString(), p.collateral, p.fills]);
        if (inserted.rowCount && p.amountRaw > threshold) await c.query('INSERT INTO enrichment_jobs(purchase_id) VALUES($1) ON CONFLICT DO NOTHING', [p.id]);
      }
      await c.query('INSERT INTO checkpoints VALUES($1,$2) ON CONFLICT DO NOTHING', [end, hash]);
      await c.query('UPDATE chain_cursor SET block_number=$1,block_hash=$2 WHERE id=1', [end, hash]);
      // Retain a bounded reorg window plus the initial anchor.
      await c.query('DELETE FROM checkpoints WHERE block_number < $1 AND block_number <> (SELECT start_block-1 FROM chain_cursor WHERE id=1)', [end - 10000]);
    });
  }
  async checkpoints(): Promise<{ number: number; hash: string }[]> {
    const { rows } = await this.pool.query('SELECT * FROM checkpoints ORDER BY block_number DESC');
    return rows.map(r => ({ number: Number(r.block_number), hash: r.block_hash }));
  }
  async rollback(number: number, hash: string) {
    await this.transaction(async c => {
      await c.query('DELETE FROM purchases WHERE block_number>$1', [number]);
      await c.query('DELETE FROM checkpoints WHERE block_number>$1', [number]);
      await c.query('UPDATE chain_cursor SET block_number=$1,block_hash=$2 WHERE id=1', [number, hash]);
    });
  }
  async pending(): Promise<{ purchase: Purchase; attempts: number }[]> {
    const { rows } = await this.pool.query(`SELECT p.*,j.attempts FROM enrichment_jobs j JOIN purchases p ON p.id=j.purchase_id
      WHERE NOT j.done AND j.next_attempt<=now() ORDER BY j.next_attempt,p.block_number,p.tx_index LIMIT 12`);
    return rows.map(r => ({ purchase: purchaseFromRow(r), attempts: r.attempts }));
  }
  async hasPrior(p: Purchase): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM purchases WHERE wallet=$1 AND tx_hash<>$2
      AND (block_number,tx_index)<($3,$4) LIMIT 1`, [p.wallet, p.txHash, p.blockNumber, p.txIndex]);
    return rows.length > 0;
  }
  async saveEnrichment(p: Purchase, alert: Alert | null, retry: boolean, attempts: number): Promise<boolean> {
    return this.transaction(async c => {
      // Lock the purchase, so an in-flight reorg cannot resurrect an orphan alert.
      const present = await c.query('SELECT id FROM purchases WHERE id=$1 AND block_hash=$2 FOR UPDATE', [p.id, p.blockHash]);
      if (!present.rowCount) return false;
      if (alert) await c.query(`INSERT INTO alerts(id,amount,payload) VALUES($1,$2,$3) ON CONFLICT(id)
        DO UPDATE SET payload=CASE WHEN EXCLUDED.payload->'market'='null'::jsonb
          THEN jsonb_set(EXCLUDED.payload,'{market}',coalesce(alerts.payload->'market','null'::jsonb))
          ELSE EXCLUDED.payload END,amount=EXCLUDED.amount,updated_at=now()`, [p.id, dollars(p.amountRaw), JSON.stringify(alert)]);
      else await c.query('DELETE FROM alerts WHERE id=$1', [p.id]);
      const delaySeconds = Math.min(3600, 15 * 2 ** Math.min(attempts, 8));
      await c.query(`UPDATE enrichment_jobs SET done=$2,attempts=attempts+1,next_attempt=now()+$3*interval '1 second' WHERE purchase_id=$1`, [p.id, !retry, delaySeconds]);
      return true;
    });
  }
  async list(order: 'latest' | 'ranking' = 'latest', limit = 200, wallet: string | null = null): Promise<Alert[]> {
    const { rows } = await this.pool.query(`SELECT a.payload FROM alerts a JOIN purchases p ON p.id=a.id
      WHERE ($2::text IS NULL OR p.wallet=$2)
      ORDER BY ${order === 'ranking' ? 'a.amount DESC,' : ''} p.block_number DESC,p.tx_index DESC,p.log_index DESC LIMIT $1`, [limit, wallet]);
    return rows.map(r => r.payload as Alert);
  }
  async alertPurchase(id: string): Promise<Purchase | null> {
    const { rows } = await this.pool.query('SELECT p.* FROM purchases p JOIN alerts a ON a.id=p.id WHERE p.id=$1', [id]);
    return rows[0] ? purchaseFromRow(rows[0]) : null;
  }
  async walletGroups() {
    const { rows } = await this.pool.query(`SELECT p.wallet, count(*)::int AS operations,
      count(DISTINCT a.payload#>>'{market,eventId}')::int AS events
      FROM alerts a JOIN purchases p ON p.id=a.id
      WHERE a.payload#>>'{market,eventId}' IS NOT NULL GROUP BY p.wallet
      HAVING count(DISTINCT a.payload#>>'{market,eventId}')>1 AND count(DISTINCT p.tx_hash)>1`);
    return rows;
  }
  async stats() {
    const { rows } = await this.pool.query(`SELECT count(*)::int AS alerts,coalesce(sum(amount),0)::text AS volume,
      count(*) FILTER(WHERE payload->>'kind'='insider')::int AS insiders,
      count(DISTINCT payload->>'wallet')::int AS wallets FROM alerts`);
    const jobs = await this.pool.query('SELECT count(*)::int AS pending FROM enrichment_jobs WHERE NOT done');
    return { ...rows[0], pending: jobs.rows[0].pending };
  }
  async updateQuote(id: string, quote: Alert['quote']) {
    await this.pool.query(`UPDATE alerts SET payload=jsonb_set(payload,'{quote}',$2::jsonb),updated_at=now() WHERE id=$1`, [id, JSON.stringify(quote)]);
  }
}
