import { useEffect, useRef } from 'react';
import { Check, ChevronDown, ListFilter } from 'lucide-react';
const options = [['all', 'Todas las señales'], ['whale', 'Ballenas'], ['insider', 'Posibles insiders'], ['unknown', 'Historial desconocido']] as const;
export function SignalFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false; };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return <details ref={ref} className="relative" onKeyDown={e => { if (e.key === 'Escape' && ref.current) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); } }}>
    <summary aria-label="Filtrar señales" className="flex cursor-pointer list-none items-center gap-2 rounded border border-line bg-panel px-3 py-2.5 text-xs text-stone-200 [&::-webkit-details-marker]:hidden"><ListFilter size={13} className="text-muted" />{options.find(([id]) => id === value)?.[1]}<ChevronDown size={12} /></summary>
    <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-md border border-line bg-panel p-1 shadow-xl" aria-label="Tipos de señal">
      {options.map(([id, title]) => <button key={id} aria-pressed={id === value} className="flex w-full items-center justify-between rounded px-3 py-2.5 text-left text-xs text-stone-200 hover:bg-white/10 focus-visible:bg-white/10" onClick={() => { onChange(id); if (ref.current) ref.current.open = false; }}>{title}{id === value && <Check size={12} className="text-sage" />}</button>)}
    </div>
  </details>;
}
