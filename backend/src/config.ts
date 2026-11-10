import { z } from 'zod';

const int = (fallback: number, min: number, max: number) => z.coerce.number().int().min(min).max(max).default(fallback);
const schema = z.object({
  PORT: int(3001, 1, 65535),
  DATABASE_URL: z.string().min(1),
  POLYGON_RPC_URL: z.url().default('https://polygon-bor-rpc.publicnode.com'),
  CLOB_API_URL: z.url().default('https://clob.polymarket.com'),
  GAMMA_API_URL: z.url().default('https://gamma-api.polymarket.com'),
  DATA_API_URL: z.url().default('https://data-api.polymarket.com'),
  CONFIRMATIONS: int(20, 2, 1000),
  POLL_INTERVAL_MS: int(4000, 1000, 60000),
  BLOCK_BATCH_SIZE: int(30, 1, 1000),
  INITIAL_LOOKBACK_BLOCKS: int(300, 1, 100000),
  START_BLOCK: z.preprocess(v => v === '' ? undefined : v, z.coerce.number().int().min(1).optional()),
  WHALE_USD: z.string().regex(/^\d+(\.\d{1,6})?$/).default('10000'),
  INSIDER_USD: z.string().regex(/^\d+(\.\d{1,6})?$/).default('10000'),
  DELFOS_LOG_FORMAT: z.enum(['text', 'json']).default('text'),
  IPV4_ONLY: z.enum(['true', 'false']).default('true'),
  PUBLIC_ORIGIN: z.string().default('http://localhost:8080'),
  EXCHANGE_ADDRESSES: z.string().default('0xe111180000d2663c0091e4f400237545b87b996b,0xe2222d279d744050d28e00520010520000310f59,0xe3333700ca9d93003f00f0f71f8515005f6c00aa'),
});
export type Config = z.infer<typeof schema>;
export function readConfig(): Config {
  const config = schema.parse(process.env);
  if (Number(config.INSIDER_USD) <= 0 || Number(config.WHALE_USD) < Number(config.INSIDER_USD)) throw new Error('Umbrales no válidos');
  for (const address of config.EXCHANGE_ADDRESSES.split(',')) {
    if (!/^0x[\da-fA-F]{40}$/.test(address.trim())) throw new Error('EXCHANGE_ADDRESSES contiene una dirección no válida');
  }
  new URL(config.PUBLIC_ORIGIN);
  return config;
}
