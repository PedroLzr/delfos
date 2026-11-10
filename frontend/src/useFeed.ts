import { useEffect, useRef, useState } from 'react';
import type { Snapshot } from './types';

export function useFeed(wallet: string | null = null) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    setSnapshot(null);
    let disposed = false; let socket: WebSocket | undefined; let timer: ReturnType<typeof setTimeout>;
    let attempts = 0; let loading = false; let queued = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (disposed) return;
      if (loading) { queued = true; return; }
      loading = true;
      try {
        const response = await fetch(`/api/snapshot${wallet ? '?wallet=' + encodeURIComponent(wallet) : ''}`,  { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), cache: 'no-store' });
        if (!response.ok) throw new Error('No se pudo sincronizar el historial. Reintentando automáticamente.');
        const data = await response.json() as Snapshot;
        if (!Array.isArray(data.latest) || !Array.isArray(data.ranking) || !data.scanner || !data.settings || !data.stats) throw new Error('Respuesta del servidor no válida.');
        if (!disposed) { setSnapshot(data); setError(null); setUpdatedAt(new Date()); }
      } catch (cause) {
        if (!disposed) setError(cause instanceof Error && cause.name !== 'TimeoutError' ? cause.message : 'El servidor no ha respondido a tiempo.');
      } finally {
        loading = false;
        if (queued && !disposed) { queued = false; void refresh(); }
      }
    };
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      socket.onopen = () => { attempts = 0; setConnected(true); void refresh(); };
      socket.onmessage = event => {
        try { if (JSON.parse(String(event.data)).type === 'invalidate') void refresh(); } catch { /* Ignore unsupported messages. */ }
      };
      socket.onclose = () => {
        if (disposed) return;
        setConnected(false);
        timer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)) + Math.random() * 500);
      };
      socket.onerror = () => socket?.close();
    };
    refreshRef.current = () => { void refresh(); };
    void refresh(); connect();
    const fallback = setInterval(() => void refresh(), 15000);
    return () => { disposed = true; controller.abort(); clearTimeout(timer); clearInterval(fallback); socket?.close(); };
  }, [wallet]);
  return { snapshot, connected, error, updatedAt, refresh: () => refreshRef.current() };
}
