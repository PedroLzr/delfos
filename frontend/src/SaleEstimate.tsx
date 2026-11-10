import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
interface Valuation {
  status: 'complete' | 'insufficient-liquidity' | 'below-minimum'; at: string;
  requestedShares: string; filledShares: string; currentPrice: number | null;
  averageSellPrice: number | null; grossProceeds: string | null; grossPnl: string | null;
}
const amount = (value: string | number) => `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))} pUSD`;
const price = (value: number | null) => value === null ? '—' : `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(value)} pUSD`;
export function SaleEstimate({ id, reference }: { id: string; reference: { price: number | null; at: string | null } }) {
  const [data, setData] = useState<Valuation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setLoading(true); setError(null); setData(null);
    fetch(`/api/valuation?id=${encodeURIComponent(id)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(28000)]), cache: 'no-store' })
      .then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error ?? 'Estimación no disponible'); return value as Valuation; })
      .then(value => { if (active) setData(value); })
      .catch(() => { if (active) setError('Estimación no disponible: no hay un libro de órdenes reciente.'); })
      .finally(() => { if (active) setLoading(false); });
    const timer = setInterval(() => setRevision(value => value + 1), 30000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [id, revision]);
  const fresh = data && now - Date.parse(data.at) <= 60000;
  const current = fresh ? data.currentPrice : reference.at && now - Date.parse(reference.at) <= 180000 ? reference.price : null;
  return <section className="mb-6 rounded border border-line p-4" aria-label="Valoración actual">
    <div className="mb-4 flex items-center justify-between"><div><div className="eyebrow mb-2">Precio actual por participación</div><div className="font-mono text-lg">{price(current)}</div></div><button className="quiet-button" aria-label="Actualizar estimación de venta" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={13} /></button></div>
    <div className="eyebrow mb-2">Resultado bruto estimado si vende</div>
    {loading ? <p className="text-sm text-muted">Consultando ofertas de compra…</p> : error ? <p className="text-xs text-muted">{error}</p> : !fresh ? <p className="text-xs text-muted">Estimación caducada. Actualizando…</p> : data.status !== 'complete' ? <p className="text-xs leading-5 text-muted">{data.status === 'below-minimum' ? 'Cantidad inferior al mínimo de venta.' : `Liquidez insuficiente: hay ofertas para ${Number(data.filledShares).toLocaleString('es-ES')} de ${Number(data.requestedShares).toLocaleString('es-ES')} participaciones.`}</p> : <><div className={`font-mono text-xl ${Number(data.grossPnl) >= 0 ? 'text-sage' : 'text-rose-300/80'}`}>{Number(data.grossPnl) > 0 ? '+' : ''}{amount(data.grossPnl!)}</div><p className="mt-2 text-xs text-muted">Venta estimada: {amount(data.grossProceeds!)} · Precio medio: {price(data.averageSellPrice)}</p></>}
    <p className="mt-3 text-[11px] leading-5 text-muted">Simulación de venta de las participaciones de esta compra, según la liquidez disponible y antes de comisiones. No confirma que la cuenta aún las conserve ni garantiza ese precio.</p>
    {fresh && <p className="mt-2 text-[10px] text-muted">Libro consultado: {new Date(data.at).toLocaleTimeString('es-ES')}</p>}
  </section>;
}
