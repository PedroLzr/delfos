import { setTimeout as sleep } from 'node:timers/promises';
import { classify, dollars, units, type Alert, type History, type MarketInfo, type Quote } from './domain.js';
import type { Config } from './config.js';
import type { Store } from './store.js';
import type { PolymarketClient } from './polymarket.js';
import type { Logger } from './logger.js';

export class EnrichmentWorker {
  private readonly controller = new AbortController();
  private quoteAt = 0;
  constructor(private readonly config: Config, private readonly store: Store, private readonly api: PolymarketClient, private readonly log: Logger, private readonly notify: () => void) {}
  async run() {
    while (!this.controller.signal.aborted) {
      try { await this.step(); } catch (error) { this.log.error('Error en la cola de enriquecimiento', error); }
      await sleep(2000, undefined, { signal: this.controller.signal }).catch(() => {});
    }
  }
  async step() {
    for (const { purchase: p, attempts } of await this.store.pending()) {
      if (this.controller.signal.aborted) return;
      let history: History = { status: 'unknown', reason: 'No se pudo verificar el historial público.', checkedAt: new Date().toISOString() };
      let market: MarketInfo | null = null;
      let quote: Quote = { price: null, at: null };
      try {
        history = await this.store.hasPrior(p)
          ? { status: 'existing', reason: 'Delfos ha registrado una compra anterior en la cadena canónica.', checkedAt: new Date().toISOString() }
          : await this.api.history(p);
      } catch (error) { this.log.error('Historial desconocido; se volverá a consultar', error); }
      try { market = await this.api.market(p.tokenId); } catch (error) { this.log.error('Metadatos pendientes; conservamos la compra', error); }
      try { quote = await this.api.quote(p.tokenId); } catch (error) { this.log.error('Sin cotización actual disponible', error); }
      const kind = classify(p.amountRaw, history.status, units(this.config.WHALE_USD), units(this.config.INSIDER_USD));
      const alert: Alert | null = kind ? { id: p.id, wallet: p.wallet, tokenId: p.tokenId, txHash: p.txHash, blockNumber: p.blockNumber,
        timestamp: new Date(p.timestamp * 1000).toISOString(), amount: dollars(p.amountRaw), shares: dollars(p.sharesRaw),
        executionPrice: Number(p.amountRaw) / Number(p.sharesRaw), collateral: p.collateral, fills: p.fills, kind, history, market, quote } : null;
      const retry = history.status === 'unknown' || (kind !== null && market === null);
      if (await this.store.saveEnrichment(p, alert, retry, attempts)) {
        if (alert) this.log.info('alert', attempts ? 'Alerta actualizada' : 'Nueva alerta', {
          kind, amount: alert.amount, collateral: p.collateral, market: market?.title ?? null,
          outcome: market?.outcome ?? null, paidPrice: alert.executionPrice, wallet: p.wallet,
          txHash: p.txHash, block: p.blockNumber, history: history.status, pending: retry,
        });
        this.notify();
      }
    }
    if (Date.now() - this.quoteAt >= 60000) {
      this.quoteAt = Date.now();
      const alerts = [...new Map([...(await this.store.list('latest', 100)), ...(await this.store.list('ranking', 100))].map(a => [a.id, a])).values()];
      const quotes = new Map<string, Quote>();
      for (const alert of alerts) {
        if (this.controller.signal.aborted) return;
        if (!quotes.has(alert.tokenId)) {
          try { quotes.set(alert.tokenId, await this.api.quote(alert.tokenId)); }
          catch { quotes.set(alert.tokenId, { price: null, at: null }); }
        }
        await this.store.updateQuote(alert.id, quotes.get(alert.tokenId)!);
      }
      if (alerts.length) this.notify();
    }
  }
  stop() { this.controller.abort(); }
}
