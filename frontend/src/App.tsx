import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleHelp, Copy, ExternalLink, Layers3, Radio, RefreshCw, Search, Trophy, Waves, X } from 'lucide-react';
import type { Alert } from './types';
import { useFeed } from './useFeed';
import { SignalFilter } from './SignalFilter';
import { SaleEstimate } from './SaleEstimate';

const money = (value: string | number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
const number = (value: number) => new Intl.NumberFormat('es-ES').format(value);
const price = (value: number | null) => value === null ? '—' : `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)} pUSD`;
const time = (value: string) => new Date(value).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const labels = { insider: 'Posible Insider', whale: 'Ballena', unknown: 'Historial desconocido' };
const phases = { starting: 'Iniciando indexador', 'catching-up': 'Recuperando bloques', live: 'Indexador al día', retrying: 'Reconectando a Polygon', stopped: 'Indexador detenido' };

function Badge({ kind }: { kind: Alert['kind'] }) {
  return <span className={`inline-flex whitespace-nowrap items-center gap-1.5 rounded border px-2 py-1 text-[10px] ${kind === 'insider' ? 'border-amber-200/15 bg-amber-200/5 text-amber-200/80' : kind === 'whale' ? 'border-sage/20 bg-sage/5 text-sage' : 'border-line text-muted'}`}>
    {kind === 'insider' ? <Search size={10} /> : kind === 'whale' ? <Waves size={11} /> : <CircleHelp size={10} />}{labels[kind]}
  </span>;
}

export default function App() {
  const [walletFilter, setWalletFilter] = useState<string | null>(null);
  const { snapshot, connected, error, updatedAt, refresh } = useFeed(walletFilter);
  const [tab, setTab] = useState<'latest' | 'ranking'>('latest');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [selected, setSelected] = useState<Alert | null>(null);
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(1);
  const [clock, setClock] = useState(new Date());
  const opener = useRef<HTMLElement | null>(null);
  const modal = useRef<HTMLDivElement>(null);
  useEffect(() => { const tick = setInterval(() => setClock(new Date()), 1000); return () => clearInterval(tick); }, []);
  useEffect(() => { setPage(1); }, [query, kind, tab, walletFilter]);
  useEffect(() => {
    if (!selected) return;
    opener.current = document.activeElement as HTMLElement;
    document.body.style.overflow = 'hidden';
    modal.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelected(null); }
      if (event.key === 'Tab' && modal.current) {
        const focusable = modal.current.querySelectorAll<HTMLElement>('button, a[href], [tabindex="0"]');
        const first = focusable[0]; const last = focusable[focusable.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === modal.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => { window.removeEventListener('keydown', keydown); document.body.style.overflow = ''; opener.current?.focus(); };
  }, [Boolean(selected)]);

  const rows = useMemo(() => (snapshot?.[tab] ?? []).filter(row =>
    (kind === 'all' || row.kind === kind) && `${row.market?.title ?? ''} ${row.wallet} ${row.txHash}`.toLowerCase().includes(query.toLowerCase())
  ), [snapshot, tab, query, kind]);
  const pageCount = Math.max(1, Math.ceil(rows.length / 15));
  const activePage = Math.min(page, pageCount);
  const visible = rows.slice((activePage - 1) * 15, activePage * 15);
  const lag = snapshot?.scanner.head !== null && snapshot?.scanner.indexed !== null && snapshot
    ? Math.max(0, snapshot.scanner.head! - snapshot.scanner.indexed! - snapshot.settings.confirmations) : null;
  const stale = !updatedAt || clock.getTime() - updatedAt.getTime() > 30000;
  const groups = new Map((snapshot?.walletGroups ?? []).map(group => [group.wallet, group]));
  const inspected = selected && (snapshot?.latest.find(a => a.id === selected.id) ?? snapshot?.ranking.find(a => a.id === selected.id) ?? selected);
  const open = (row: Alert) => { setCopied(false); setSelected(row); };

  return <div className="min-h-screen">
    <div>
      <header className="flex h-[76px] items-center justify-between border-b border-line px-5 md:px-9">
        <div className="flex items-center gap-4"><span className="text-xl font-semibold tracking-[-0.05em]">delfos<span className="text-sage">.</span></span><span className="hidden h-4 w-px bg-line sm:block" /><span className="eyebrow hidden sm:block">Inteligencia de mercados</span></div>
        <div className="flex items-center gap-5 text-xs"><span className="hidden font-mono text-muted md:block">{clock.toLocaleTimeString('es-ES', { timeZone: 'UTC', hour12: false })} UTC</span></div>
      </header>

      <main className="mx-auto max-w-[1600px] px-5 pb-8 pt-9 md:px-9">
        {(error || snapshot?.scanner.error) && <div role="status" className="mb-5 flex items-center gap-3 rounded border border-amber-200/15 bg-amber-200/5 p-4 text-xs text-amber-100/80"><CircleHelp size={15} />{error ?? snapshot?.scanner.error}<button onClick={refresh} className="ml-auto underline">Reintentar</button></div>}

        <section className="overflow-hidden rounded-md border border-line bg-panel" aria-label="Operaciones detectadas">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5">
            <div className="flex gap-7" role="tablist" aria-label="Orden de operaciones">
              <button role="tab" aria-selected={tab === 'latest'} onClick={() => setTab('latest')} className={`flex items-center gap-2 border-b-2 py-5 text-xs ${tab === 'latest' ? 'border-sage text-stone-100' : 'border-transparent text-muted'}`}><Radio size={14} />Actividad reciente</button>
              <button role="tab" aria-selected={tab === 'ranking'} onClick={() => setTab('ranking')} className={`flex items-center gap-2 border-b-2 py-5 text-xs ${tab === 'ranking' ? 'border-sage text-stone-100' : 'border-transparent text-muted'}`}><Trophy size={14} />Mayores apuestas</button>
            </div>
            <span className="flex items-center gap-2 pb-3 font-mono text-[10px] text-muted sm:pb-0"><span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-sage' : 'bg-stone-500'}`} />{connected ? 'En línea' : 'Reconectando…'}</span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
            <label className="flex w-full items-center gap-2.5 rounded border border-line bg-ink/50 px-3 py-2.5 sm:w-80"><Search size={14} className="shrink-0 text-muted" /><input aria-label="Buscar evento, billetera o transacción" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar evento, billetera o hash…" className="w-full bg-transparent text-xs placeholder:text-muted" /></label>
            <div className="flex items-center gap-2"><SignalFilter value={kind} onChange={setKind} /><button className="quiet-button h-9" aria-label="Actualizar datos" onClick={refresh}><RefreshCw size={13} /></button></div>
          </div>

          {walletFilter && <div className="flex items-center gap-3 border-b border-line px-5 py-3 text-xs text-muted"><span>Cuenta {walletFilter.slice(0, 8)}…{walletFilter.slice(-6)}</span><button className="quiet-button" onClick={() => setWalletFilter(null)}>Ver todas las cuentas <X size={12} /></button></div>}
          <div className="min-h-[340px] overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-ink/25 font-mono text-[10px] uppercase tracking-wider text-muted"><tr><th className="px-5 py-3">Hora</th><th className="px-3 py-3">Evento</th><th className="px-3 py-3 text-right">Importe</th><th className="px-3 py-3">Señal</th><th className="px-3 py-3 text-right" title="Precio medio pagado por cada participación">Precio pagado</th><th className="px-3 py-3 text-right" title="Precio de referencia por participación en el libro de órdenes">Precio actual</th><th className="px-5 py-3"><span className="sr-only">Información</span></th></tr></thead>
              <tbody>{visible.map(row => <tr key={row.id} className="animate-fade-in border-t border-line/70 transition-colors hover:bg-white/[0.025] motion-reduce:animate-none">
                <td className="px-5 py-5 font-mono text-stone-200" title={new Date(row.timestamp).toLocaleString('es-ES')}>{time(row.timestamp)}</td>
                <td className="max-w-[310px] px-3 py-5"><div className="max-w-[300px] truncate text-[13px] text-stone-200" title={row.market?.title}>{row.market?.title ?? 'Resolviendo evento…'}</div><div className="mt-2 text-[11px] text-muted">Apuesta: <span className="font-medium text-sage">{row.market?.outcome ?? 'Pendiente'}</span></div>{groups.has(row.wallet) && <button onClick={() => { setQuery(''); setKind('all'); setWalletFilter(row.wallet); }} title={`Misma dirección: ${row.wallet}. ${groups.get(row.wallet)!.events} eventos distintos en las alertas guardadas.`} className="mt-2 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-muted hover:border-sage/40 hover:text-sage">Cuenta {row.wallet.slice(2, 8)}…{row.wallet.slice(-4)} · {groups.get(row.wallet)!.events} eventos</button>}</td>
                <td className="px-3 py-5 text-right"><div className="font-mono text-sm text-stone-100">{money(row.amount)}</div><div className="mt-2 text-[10px] text-muted">{row.collateral}</div></td>
                <td className="px-3 py-5"><Badge kind={row.kind} /></td>
                <td className="whitespace-nowrap px-3 py-5 text-right font-mono">{price(row.executionPrice)}</td>
                <td className="whitespace-nowrap px-3 py-5 text-right font-mono text-muted" title={row.quote.at ? `Precio de referencia consultado: ${new Date(row.quote.at).toLocaleString('es-ES')}` : 'Sin precio disponible'}>{row.quote.at && clock.getTime() - Date.parse(row.quote.at) < 180000 ? price(row.quote.price) : '—'}</td>
                <td className="px-5 py-5 text-right"><button onClick={() => open(row)} className="quiet-button whitespace-nowrap">Más info</button></td>
              </tr>)}</tbody>
            </table>
            {!visible.length && <div className="flex flex-col items-center px-6 py-16 text-center"><div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full border border-line text-muted"><Waves size={22} strokeWidth={1} /></div><h2 className="text-sm font-medium">{!snapshot ? 'Conectando con el observatorio' : query || kind !== 'all' ? 'No hay señales con estos filtros' : 'A la espera de la próxima gran posición'}</h2><p className="mt-2 max-w-md text-xs leading-6 text-muted">{!snapshot ? 'El dashboard mostrará las operaciones confirmadas en cuanto el backend responda.' : query || kind !== 'all' ? 'Prueba otro mercado, billetera o tipo de señal.' : `Las compras superiores a ${money(snapshot.settings.insiderUsd)} se evalúan automáticamente. Aquí aparecerán las señales verificadas y las pendientes de historial.`}</p>{(query || kind !== 'all') && <button className="quiet-button mt-4" onClick={() => { setKind('all'); setQuery(''); }}>Limpiar filtros</button>}</div>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3.5 text-[10px] text-muted"><span>{number(rows.length)} señales en esta vista · hasta 200 {tab === 'latest' ? 'recientes' : 'mayores'}</span><div className="flex items-center gap-4"><button disabled={activePage === 1} onClick={() => setPage(activePage - 1)} className="hover:text-stone-100">Anterior</button><span className="font-mono">{activePage} / {pageCount}</span><button disabled={activePage >= pageCount} onClick={() => setPage(activePage + 1)} className="hover:text-stone-100">Siguiente</button></div></div>
        </section>

        <section className="mt-6">
          <div className="rounded border border-line p-5"><div className="mb-3 flex items-center justify-between"><span className="eyebrow">Estado del observatorio</span><Layers3 size={14} className="text-muted" /></div><div className="flex justify-between text-xs"><span className="text-muted">{snapshot ? phases[snapshot.scanner.phase] : 'Esperando al backend'}</span><span className="font-mono">{snapshot?.scanner.indexed ? `#${number(snapshot.scanner.indexed)}` : '—'}</span></div><div className="mt-2 flex justify-between text-[11px] text-muted"><span>{snapshot ? `${snapshot.settings.confirmations} confirmaciones · ${snapshot.stats.pending} pendientes` : 'Sin datos todavía'}</span><span>{lag !== null ? `${number(lag)} bloques de retraso` : '—'}</span></div></div>
        </section>
        <footer className="mt-7 flex flex-wrap items-center justify-between gap-3 text-[10px] text-muted"><span>{updatedAt ? `Última sincronización ${updatedAt.toLocaleTimeString('es-ES')}${stale ? ' · datos desactualizados' : ''}` : 'Sincronización pendiente'}</span></footer>
      </main>
    </div>

    {inspected && <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4" onClick={() => { setSelected(null); }}><div ref={modal} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="dialog-title" onClick={e => e.stopPropagation()} className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border border-line bg-panel p-6 shadow-2xl"><div className="mb-6 flex items-center justify-between"><span className="eyebrow">Detalle de la operación</span><button aria-label="Cerrar detalle" onClick={() => { setSelected(null); }} className="rounded p-1 text-muted hover:text-white"><X size={18} /></button></div>
      {inspected && <><h2 id="dialog-title" className="mb-4 text-xl leading-7 tracking-tight">{inspected.market?.title ?? 'Mercado pendiente de resolución'}</h2><div className="flex flex-wrap items-center gap-3"><span className="rounded border border-sage/25 bg-sage/5 px-3 py-2 text-sm">Apuesta: <strong className="text-sage">{inspected.market?.outcome ?? 'Pendiente'}</strong></span><Badge kind={inspected.kind} /></div><div className="my-6 grid grid-cols-2 gap-y-5 border-y border-line py-5"><div><div className="eyebrow mb-2">Importe apostado</div><div className="font-mono text-2xl">{money(inspected.amount)}</div></div><div><div className="eyebrow mb-2">Precio pagado por participación</div><div className="font-mono text-2xl">{price(inspected.executionPrice)}</div></div><div><div className="eyebrow mb-2">Participaciones</div><div className="font-mono text-sm">{number(Number(inspected.shares))}</div></div><div><div className="eyebrow mb-2">Bloque</div><div className="font-mono text-sm">#{number(inspected.blockNumber)}</div></div></div><SaleEstimate key={inspected.id} id={inspected.id} reference={inspected.quote} /><p className="mb-5 text-sm leading-6 text-muted">{inspected.history.reason}</p><div className="eyebrow mb-2">Billetera de la orden</div><div className="flex items-center gap-2"><code className="break-all text-xs text-stone-300">{inspected.wallet}</code><button aria-label="Copiar billetera" className="rounded p-2 text-muted" onClick={async () => { try { await navigator.clipboard.writeText(inspected.wallet); setCopied(true); } catch { setCopied(false); } }}>{copied ? <Check size={15} /> : <Copy size={15} />}</button></div><div className="eyebrow mb-2 mt-5">Token / Position ID</div><code className="block break-all text-[11px] leading-5 text-muted">{inspected.tokenId}</code><div className="mt-6 flex flex-wrap gap-3"><a className="quiet-button" target="_blank" rel="noreferrer" href={`https://polygonscan.com/tx/${inspected.txHash}`}>Ver transacción <ExternalLink size={12} /></a>{inspected.market?.url && <a className="quiet-button" target="_blank" rel="noreferrer" href={inspected.market.url}>Ver mercado <ExternalLink size={12} /></a>}</div><p className="mt-5 text-[10px] text-muted">{new Date(inspected.timestamp).toLocaleString('es-ES')} · {inspected.collateral} · sin comisiones</p></>}
    </div></div>}
  </div>;
}
