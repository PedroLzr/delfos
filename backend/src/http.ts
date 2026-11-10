import { setTimeout as sleep } from 'node:timers/promises';
export interface JsonClient { get(url: URL): Promise<unknown>; }
export class PublicHttpClient implements JsonClient {
  async get(url: URL): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json', 'User-Agent': 'Delfos/1.0' } });
      } catch (error) {
        if (attempt === 2) throw error;
        await sleep(500 * 2 ** attempt);
        continue;
      }
      if (response.ok) return response.json();
      if ((response.status === 429 || response.status >= 500) && attempt < 2) {
        await response.body?.cancel();
        const retryAfter = Number(response.headers.get('retry-after'));
        await sleep(Math.min(10000, Math.max(500 * 2 ** attempt, Number.isFinite(retryAfter) ? retryAfter * 1000 : 0)));
        continue;
      }
      await response.body?.cancel();
      throw new Error(`API pública: HTTP ${response.status} (${url.hostname})`);
    }
    throw new Error('API pública agotó reintentos');
  }
}
