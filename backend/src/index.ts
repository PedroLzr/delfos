import { createServer } from 'node:http';
import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { Pool } from 'pg';
import { WebSocket, WebSocketServer } from 'ws';
import { readConfig } from './config.js';
import { Logger } from './logger.js';
import { Store } from './store.js';
import { Scanner } from './scanner.js';
import { PublicHttpClient } from './http.js';
import { PolymarketClient } from './polymarket.js';
import { EnrichmentWorker } from './enrichment.js';

async function main() {
  const config = readConfig();
  if (config.IPV4_ONLY === 'true') {
    setDefaultResultOrder('ipv4first');
    setDefaultAutoSelectFamily(false);
  }
  const log = new Logger(config.DELFOS_LOG_FORMAT);
  const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10, connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000, statement_timeout: 30000, application_name: 'delfos' });
  pool.on('error', error => log.error('Conexión PostgreSQL interrumpida', error));
  const store = new Store(pool);
  // A dedicated connection owns the singleton lease. Losing it stops this process.
  const lease = await pool.connect();
  const lock = await lease.query('SELECT pg_try_advisory_lock(137, 20261109) AS acquired');
  if (!lock.rows[0].acquired) throw new Error('Ya hay un indexador Delfos conectado a esta base de datos');
  lease.on('error', error => { log.error('Se perdió el bloqueo exclusivo del indexador', error); process.exit(1); });
  await store.migrate();

  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', 1);
  app.use(helmet());
  app.use('/api', rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
  const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 1024, perMessageDeflate: false });
  let notification: NodeJS.Timeout | undefined;
  const broadcast = () => {
    if (notification) return;
    notification = setTimeout(() => {
      notification = undefined;
      for (const ws of sockets.clients) {
        if (ws.bufferedAmount > 256 * 1024) ws.terminate();
        else if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'invalidate' }));
      }
    }, 300);
  };
  const scanner = new Scanner(config, store, log, broadcast);
  const api = new PolymarketClient(new PublicHttpClient(), config);
  const worker = new EnrichmentWorker(config, store, api, log, broadcast);
  app.get('/health/live', (_req, res) => res.json({ ok: true }));
  app.get('/health/ready', async (_req, res) => {
    await pool.query('SELECT 1');
    const fresh = scanner.state.lastSuccess && Date.now() - Date.parse(scanner.state.lastSuccess) < 180000;
    const ok = Boolean(fresh && scanner.state.phase !== 'retrying');
    res.status(ok ? 200 : 503).json({ ok, phase: scanner.state.phase });
  });
  app.get('/api/snapshot', async (req, res) => {
    const wallet = typeof req.query.wallet === 'string' ? req.query.wallet.toLowerCase() : null;
    if (wallet && !/^0x[0-9a-f]{40}$/.test(wallet)) { res.status(400).json({ error: 'Cuenta no válida' }); return; }
    const [latest, ranking, stats, walletGroups] = await Promise.all([store.list('latest', 200, wallet), store.list('ranking', 200, wallet), store.stats(), store.walletGroups()]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ latest, ranking, stats, walletGroups, scanner: scanner.state, settings: {
      confirmations: config.CONFIRMATIONS, whaleUsd: config.WHALE_USD, insiderUsd: config.INSIDER_USD,
      exchanges: config.EXCHANGE_ADDRESSES.split(','),
    }, serverTime: new Date().toISOString() });
  });
  app.get('/api/valuation', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const id = req.query.id;
    if (typeof id !== 'string' || !/^0x[0-9a-f]{64}:0x[0-9a-f]{40}:\d{1,78}$/.test(id)) {
      res.status(400).json({ error: 'Operación no válida' }); return;
    }
    const purchase = await store.alertPurchase(id);
    if (!purchase) { res.status(404).json({ error: 'Operación no disponible' }); return; }
    try {
      const valuation = await api.valuation(purchase);
      const canonical = await store.alertPurchase(id);
      if (canonical?.blockHash !== purchase.blockHash) { res.status(404).json({ error: 'La operación ha cambiado' }); return; }
      res.json(valuation);
    } catch {
      res.status(503).json({ error: 'No hay un libro de órdenes reciente disponible para estimar la venta.' });
    }
  });
  app.get('/api/wallets/:address', async (req, res) => {
    if (!/^0x[\da-fA-F]{40}$/.test(req.params.address)) { res.status(400).json({ error: 'Dirección no válida' }); return; }
    const result = await pool.query('SELECT * FROM wallets WHERE wallet=$1', [req.params.address.toLowerCase()]);
    res.json({ data: result.rows[0] ?? null, scope: 'Compras observadas desde el bloque inicial de Delfos; no es el historial completo de la cuenta.' });
  });
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    log.error('No se pudo atender la petición', error); res.status(503).json({ error: 'Servicio temporalmente no disponible' });
  });
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws' || request.headers.origin !== new URL(config.PUBLIC_ORIGIN).origin || sockets.clients.size >= 250) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws, request));
  });
  const alive = new WeakSet<WebSocket>();
  sockets.on('connection', ws => {
    alive.add(ws); ws.on('pong', () => alive.add(ws)); ws.on('error', () => ws.terminate());
    ws.send(JSON.stringify({ type: 'invalidate' }));
  });
  const heartbeat = setInterval(() => {
    for (const ws of sockets.clients) {
      if (!alive.has(ws)) { ws.terminate(); continue; }
      alive.delete(ws); ws.ping();
    }
  }, 30000);
  server.listen(config.PORT, '0.0.0.0', () => log.info('startup', 'API HTTP y WebSocket disponibles', { port: config.PORT, confirmations: config.CONFIRMATIONS, whaleUsd: config.WHALE_USD, insiderUsd: config.INSIDER_USD }));
  const scannerTask = scanner.run(); const workerTask = worker.run();
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return; stopping = true;
    log.info('save', 'Cierre ordenado: terminando trabajos en curso');
    const deadline = setTimeout(() => process.exit(1), 30000); deadline.unref();
    clearInterval(heartbeat); if (notification) clearTimeout(notification);
    scanner.stop(); worker.stop();
    server.close(); for (const ws of sockets.clients) ws.close(1001, 'Servidor reiniciándose'); sockets.close();
    await Promise.allSettled([scannerTask, workerTask]); scanner.destroy();
    await lease.query('SELECT pg_advisory_unlock(137,20261109)'); lease.release(); await pool.end();
    clearTimeout(deadline); process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown()); process.on('SIGINT', () => void shutdown());
}
main().catch(error => {
  new Logger().error('No se pudo iniciar Delfos', error); process.exit(1);
});
