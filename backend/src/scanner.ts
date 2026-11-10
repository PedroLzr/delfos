import { FetchRequest, JsonRpcProvider } from 'ethers';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Config } from './config.js';
import { decodePurchases, fillTopic, units } from './domain.js';
import type { Logger } from './logger.js';
import type { Store } from './store.js';

export interface ScannerState { phase: 'starting' | 'catching-up' | 'live' | 'retrying' | 'stopped'; head: number | null; indexed: number | null; lastSuccess: string | null; error: string | null; }
export class Scanner {
  readonly state: ScannerState = { phase: 'starting', head: null, indexed: null, lastSuccess: null, error: null };
  readonly provider: JsonRpcProvider;
  private readonly exchanges: Set<string>;
  private summaryAt = Date.now();
  private summary = { blocks: 0, events: 0, purchases: 0, candidates: 0 };
  private readonly controller = new AbortController();
  constructor(private readonly config: Config, private readonly store: Store, private readonly log: Logger, private readonly notify: () => void) {
    const request = new FetchRequest(config.POLYGON_RPC_URL); request.timeout = 15000;
    this.provider = new JsonRpcProvider(request, 137, { batchMaxCount: 1, cacheTimeout: -1 });
    this.exchanges = new Set(config.EXCHANGE_ADDRESSES.split(',').map(a => a.trim().toLowerCase()));
  }
  async run() {
    let failures = 0;
    while (!this.controller.signal.aborted) {
      try {
        const network = await this.provider.getNetwork();
        if (network.chainId !== 137n) throw new Error('El RPC no pertenece a Polygon (137)');
        await this.step(); failures = 0;
      } catch (error) {
        failures++; this.state.phase = 'retrying'; this.state.error = 'No se pudo completar la lectura de Polygon. Reintentando.';
        this.log.error('El cursor permanece en el último bloque confirmado', error); this.notify();
      }
      const catchingUp = this.state.phase === 'catching-up';
      await sleep(failures ? Math.min(60000, 1000 * 2 ** Math.min(failures, 6)) : catchingUp ? 100 : this.config.POLL_INTERVAL_MS,
        undefined, { signal: this.controller.signal }).catch(() => {});
    }
    this.state.phase = 'stopped';
  }
  private async block(number: number) {
    const block = await this.provider.getBlock(number);
    if (!block?.hash) throw new Error(`Bloque ${number} no disponible`);
    return block;
  }
  async step() {
    const head = await this.provider.getBlockNumber(); this.state.head = head;
    const safe = head - this.config.CONFIRMATIONS;
    let cursor = await this.store.cursor();
    if (!cursor) {
      for (const address of this.exchanges) if (await this.provider.getCode(address) === '0x') throw new Error(`Exchange sin bytecode: ${address}`);
      const start = this.config.START_BLOCK ?? Math.max(1, safe - this.config.INITIAL_LOOKBACK_BLOCKS + 1);
      if (start > safe) throw new Error('START_BLOCK aún no tiene suficientes confirmaciones');
      const anchor = await this.block(start - 1);
      await this.store.initialize(anchor.number, anchor.hash!); cursor = (await this.store.cursor())!;
      this.log.info('startup', 'Cursor inicial creado', { startBlock: start, confirmations: this.config.CONFIRMATIONS, exchanges: [...this.exchanges] });
    }
    const canonical = await this.block(cursor.blockNumber);
    if (canonical.hash !== cursor.blockHash) {
      for (const point of await this.store.checkpoints()) {
        if (point.number > safe) continue;
        if ((await this.block(point.number)).hash === point.hash) {
          await this.store.rollback(point.number, point.hash);
          this.log.warn('reorg', 'Rama huérfana retirada; se reprocesará desde el checkpoint', { block: point.number });
          this.notify(); return;
        }
      }
      throw new Error('Reorganización anterior al ancla inicial: requiere revisión del operador');
    }
    this.state.indexed = cursor.blockNumber;
    if (cursor.blockNumber < safe) {
      const end = Math.min(safe, cursor.blockNumber + this.config.BLOCK_BATCH_SIZE);
      const logs = await this.provider.getLogs({ address: [...this.exchanges], topics: [fillTopic], fromBlock: cursor.blockNumber + 1, toBlock: end });
      // Verify all headers and parent links; never mix logs from two branches.
      const timestamps = new Map<number, number>(); const hashes = new Map<number, string>();
      let previous = cursor.blockHash;
      for (let n = cursor.blockNumber + 1; n <= end; n++) {
        const block = await this.block(n);
        if (block.parentHash !== previous) throw new Error('La cadena cambió durante la lectura');
        previous = block.hash!; timestamps.set(n, block.timestamp); hashes.set(n, block.hash!);
      }
      for (const log of logs) if (hashes.get(log.blockNumber) !== log.blockHash) throw new Error('Logs de una rama no canónica');
      if ((await this.block(end)).hash !== previous) throw new Error('Reorganización durante el procesamiento');
      const purchases = decodePurchases(logs, timestamps, this.exchanges);
      await this.store.commit(purchases, end, previous, units(this.config.INSIDER_USD));
      this.state.indexed = end;
      this.summary.blocks += end - cursor.blockNumber;
      this.summary.events += logs.length;
      this.summary.purchases += purchases.length;
      this.summary.candidates += purchases.filter(p => p.amountRaw > units(this.config.INSIDER_USD)).length;
    }
    this.state.phase = this.state.indexed! < safe ? 'catching-up' : 'live';
    if (Date.now() - this.summaryAt >= 60000) {
      this.log.info('scanner', 'Resumen de actividad', { ...this.summary, indexed: this.state.indexed,
        head, lag: Math.max(0, safe - this.state.indexed!), status: this.state.phase,
        intervalSeconds: Math.round((Date.now() - this.summaryAt) / 1000) });
      this.summaryAt = Date.now();
      this.summary = { blocks: 0, events: 0, purchases: 0, candidates: 0 };
    }
    this.state.lastSuccess = new Date().toISOString(); this.state.error = null; this.notify();
  }
  stop() { this.controller.abort(); }
  destroy() { this.provider.destroy(); }
}
