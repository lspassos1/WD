import { CACHE_FILL_REGISTRY, type CacheFillRegistryEntry } from './_generated/cache-fill-registry.ts';
import { sha256Hex } from './hash.ts';

const REDIS_OP_TIMEOUT_MS = 1_500;
const REDIS_PIPELINE_TIMEOUT_MS = 5_000;
const FILL_LOCK_KEY_PREFIX = 'lock:fill:v1:';

export type RedisPipelineCommand = Array<string | number>;

type CacheSource = 'cache' | 'fresh';
type CacheFillEvent =
  | 'cache_hit'
  | 'cache_fill_leader'
  | 'cache_fill_follower_hit'
  | 'cache_fill_follower_timeout'
  | 'cache_fill_hedge'
  | 'cache_fill_lock_error';

interface CacheFetchResult<T> {
  data: T | null;
  source: CacheSource;
}

interface RedisCommandOptions {
  raw?: boolean;
  prefixKeyIndexes?: number[];
  timeoutMs?: number;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Environment-based key prefix to avoid collisions when multiple deployments
 * share the same Upstash Redis instance (M-6 fix).
 */
function getKeyPrefix(): string {
  const env = process.env.VERCEL_ENV; // 'production' | 'preview' | 'development'
  if (!env || env === 'production') return '';
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) || 'dev';
  return `${env}:${sha}:`;
}

let cachedPrefix: string | undefined;
function prefixKey(key: string): string {
  if (cachedPrefix === undefined) cachedPrefix = getKeyPrefix();
  if (!cachedPrefix) return key;
  return `${cachedPrefix}${key}`;
}

/**
 * Like getCachedJson but throws on Redis/network failures instead of returning null.
 * Always uses the raw (unprefixed) key — callers that write via seed scripts (which bypass
 * the prefix system) must use this to read the same key they wrote.
 */
export async function getRawJson(key: string): Promise<unknown | null> {
  if (process.env.LOCAL_API_MODE === 'tauri-sidecar') {
    const { sidecarCacheGet } = await import('./sidecar-cache');
    return sidecarCacheGet(key);
  }
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis credentials not configured');
  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REDIS_OP_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Redis HTTP ${resp.status}`);
  const data = (await resp.json()) as { result?: string };
  return data.result ? JSON.parse(data.result) : null;
}

export async function getCachedJson(key: string, raw = false): Promise<unknown | null> {
  if (process.env.LOCAL_API_MODE === 'tauri-sidecar') {
    const { sidecarCacheGet } = await import('./sidecar-cache');
    return sidecarCacheGet(key);
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  try {
    const finalKey = raw ? key : prefixKey(key);
    const resp = await fetch(`${url}/get/${encodeURIComponent(finalKey)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REDIS_OP_TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { result?: string };
    return data.result ? JSON.parse(data.result) : null;
  } catch (err) {
    console.warn('[redis] getCachedJson failed:', errMsg(err));
    return null;
  }
}

function normalizeRedisCommand(
  command: RedisPipelineCommand,
  raw: boolean,
  prefixKeyIndexes: number[] = [1],
): RedisPipelineCommand {
  const normalized = [...command];
  if (raw) return normalized;

  for (const index of prefixKeyIndexes) {
    const value = normalized[index];
    if (typeof value === 'string') {
      normalized[index] = prefixKey(value);
    }
  }
  return normalized;
}

async function runRedisCommand(
  command: RedisPipelineCommand,
  options: RedisCommandOptions = {},
): Promise<{ result?: unknown } | null> {
  if (process.env.LOCAL_API_MODE === 'tauri-sidecar') return null;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const normalized = normalizeRedisCommand(
    command,
    options.raw ?? false,
    options.prefixKeyIndexes ?? [1],
  );

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(normalized),
      signal: AbortSignal.timeout(options.timeoutMs ?? REDIS_OP_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[redis] runRedisCommand HTTP ${response.status}`);
      return null;
    }
    return await response.json() as { result?: unknown };
  } catch (err) {
    console.warn('[redis] runRedisCommand failed:', errMsg(err));
    return null;
  }
}

export async function setCachedJson(key: string, value: unknown, ttlSeconds: number, raw = false): Promise<void> {
  if (process.env.LOCAL_API_MODE === 'tauri-sidecar') {
    const { sidecarCacheSet } = await import('./sidecar-cache');
    sidecarCacheSet(key, value, ttlSeconds);
    return;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;
  try {
    const response = await runRedisCommand(['SET', key, JSON.stringify(value), 'EX', ttlSeconds], { raw });
    if (!response) {
      console.warn('[redis] setCachedJson skipped: command did not complete');
    }
  } catch (err) {
    console.warn('[redis] setCachedJson failed:', errMsg(err));
  }
}

const NEG_SENTINEL = '__WM_NEG__';

/**
 * Batch GET using Upstash pipeline API — single HTTP round-trip for N keys.
 * Returns a Map of key → parsed JSON value (missing/failed/sentinel keys omitted).
 */
export async function getCachedJsonBatch(keys: string[]): Promise<Map<string, unknown>> {
  const result = new Map<string, unknown>();
  if (keys.length === 0) return result;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return result;

  try {
    const pipeline = keys.map((k) => ['GET', prefixKey(k)]);
    const resp = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(REDIS_PIPELINE_TIMEOUT_MS),
    });
    if (!resp.ok) return result;

    const data = (await resp.json()) as Array<{ result?: string }>;
    for (let i = 0; i < keys.length; i++) {
      const raw = data[i]?.result;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed !== NEG_SENTINEL) result.set(keys[i]!, parsed);
        } catch { /* skip malformed */ }
      }
    }
  } catch (err) {
    console.warn('[redis] getCachedJsonBatch failed:', errMsg(err));
  }
  return result;
}

function normalizePipelineCommand(command: RedisPipelineCommand, raw: boolean): RedisPipelineCommand {
  return normalizeRedisCommand(command, raw, [1]);
}

export async function runRedisPipeline(
  commands: RedisPipelineCommand[],
  raw = false,
): Promise<Array<{ result?: unknown }>> {
  if (process.env.LOCAL_API_MODE === 'tauri-sidecar') return [];
  if (commands.length === 0) return [];

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return [];

  try {
    const response = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(commands.map((command) => normalizePipelineCommand(command, raw))),
      signal: AbortSignal.timeout(REDIS_PIPELINE_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.warn(`[redis] runRedisPipeline HTTP ${response.status}`);
      return [];
    }
    return await response.json() as Array<{ result?: unknown }>;
  } catch (err) {
    console.warn('[redis] runRedisPipeline failed:', errMsg(err));
    return [];
  }
}

/**
 * In-flight request coalescing map.
 * When multiple concurrent requests hit the same cache key during a miss,
 * only the first triggers the upstream fetch — others await the same promise.
 * This eliminates duplicate upstream API calls within a single Edge Function invocation.
 */
const inflight = new Map<string, Promise<CacheFetchResult<unknown>>>();

function shouldUseDistributedCoordinator(): boolean {
  return process.env.LOCAL_API_MODE !== 'tauri-sidecar'
    && Boolean(process.env.UPSTASH_REDIS_REST_URL)
    && Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(minMs: number, maxMs: number): number {
  if (maxMs <= minMs) return minMs;
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

async function deriveLockKey(finalRedisKey: string): Promise<string> {
  return `${FILL_LOCK_KEY_PREFIX}${(await sha256Hex(finalRedisKey)).slice(0, 24)}`;
}

function logCacheFillEvent(
  event: CacheFillEvent,
  policy: CacheFillRegistryEntry,
  key: string,
  extra: Record<string, unknown> = {},
): void {
  console.info(JSON.stringify({
    scope: 'cache-fill',
    event,
    logicalName: policy.logicalName,
    key,
    leaseMs: policy.leaseMs,
    waitMs: policy.waitMs,
    pollMinMs: policy.pollMinMs,
    pollMaxMs: policy.pollMaxMs,
    fallback: policy.fallback,
    ...extra,
  }));
}

async function tryAcquireFillLock(
  lockKey: string,
  token: string,
  leaseMs: number,
  policy: CacheFillRegistryEntry,
  key: string,
): Promise<boolean | null> {
  const response = await runRedisCommand(['SET', lockKey, token, 'NX', 'PX', leaseMs]);
  if (!response) {
    logCacheFillEvent('cache_fill_lock_error', policy, key, { operation: 'acquire', lockKey });
    return null;
  }
  return response.result === 'OK';
}

async function releaseFillLockIfOwner(
  lockKey: string,
  token: string,
  policy: CacheFillRegistryEntry,
  key: string,
): Promise<void> {
  const script = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
  const response = await runRedisCommand(['EVAL', script, 1, lockKey, token], {
    prefixKeyIndexes: [3],
  });
  if (!response) {
    logCacheFillEvent('cache_fill_lock_error', policy, key, { operation: 'release', lockKey });
  }
}

async function fetchWithoutDistributedCoordination<T extends object>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T | null>,
  negativeTtlSeconds: number,
): Promise<CacheFetchResult<T>> {
  const result = await fetcher();
  if (result != null) {
    await setCachedJson(key, result, ttlSeconds);
  } else {
    await setCachedJson(key, NEG_SENTINEL, negativeTtlSeconds);
  }
  return { data: result, source: 'fresh' };
}

async function resolveCacheMiss<T extends object>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T | null>,
  negativeTtlSeconds: number,
  policy?: CacheFillRegistryEntry,
): Promise<CacheFetchResult<T>> {
  if (!policy || !shouldUseDistributedCoordinator()) {
    return fetchWithoutDistributedCoordination(key, ttlSeconds, fetcher, negativeTtlSeconds);
  }

  if (policy.waitMs >= policy.leaseMs) {
    throw new Error(`cache-fill invariant violated for ${key}: waitMs must be < leaseMs`);
  }

  const startedAt = Date.now();
  const finalKey = prefixKey(key);
  const lockKey = await deriveLockKey(finalKey);
  const token = crypto.randomUUID();
  const gotLock = await tryAcquireFillLock(lockKey, token, policy.leaseMs, policy, key);

  if (gotLock === null) {
    return fetchWithoutDistributedCoordination(key, ttlSeconds, fetcher, negativeTtlSeconds);
  }

  if (gotLock) {
    try {
      const recheck = await getCachedJson(key);
      if (recheck === NEG_SENTINEL) {
        logCacheFillEvent('cache_hit', policy, key, {
          phase: 'leader-recheck',
          sentinel: true,
          elapsedMs: Date.now() - startedAt,
        });
        return { data: null, source: 'cache' };
      }
      if (recheck !== null) {
        logCacheFillEvent('cache_hit', policy, key, {
          phase: 'leader-recheck',
          elapsedMs: Date.now() - startedAt,
        });
        return { data: recheck as T, source: 'cache' };
      }

      const result = await fetcher();
      if (result != null) {
        await setCachedJson(key, result, ttlSeconds);
      } else {
        await setCachedJson(key, NEG_SENTINEL, negativeTtlSeconds);
      }
      logCacheFillEvent('cache_fill_leader', policy, key, {
        elapsedMs: Date.now() - startedAt,
        nullResult: result == null,
      });
      return { data: result, source: 'fresh' };
    } finally {
      await releaseFillLockIfOwner(lockKey, token, policy, key);
    }
  }

  const deadline = startedAt + policy.waitMs;
  while (Date.now() < deadline) {
    const observed = await getCachedJson(key);
    if (observed === NEG_SENTINEL) {
      logCacheFillEvent('cache_fill_follower_hit', policy, key, {
        elapsedMs: Date.now() - startedAt,
        sentinel: true,
      });
      return { data: null, source: 'cache' };
    }
    if (observed !== null) {
      logCacheFillEvent('cache_fill_follower_hit', policy, key, {
        elapsedMs: Date.now() - startedAt,
      });
      return { data: observed as T, source: 'cache' };
    }
    await sleep(jitter(policy.pollMinMs, policy.pollMaxMs));
  }

  logCacheFillEvent('cache_fill_follower_timeout', policy, key, {
    elapsedMs: Date.now() - startedAt,
  });

  if (policy.fallback === 'throw') {
    throw new Error(`cache-fill timeout for ${key}`);
  }

  if (policy.fallback === 'hedge') {
    logCacheFillEvent('cache_fill_hedge', policy, key, {
      elapsedMs: Date.now() - startedAt,
    });

    const retryToken = crypto.randomUUID();
    const retryLock = await tryAcquireFillLock(lockKey, retryToken, policy.leaseMs, policy, key);
    if (retryLock === null) {
      return fetchWithoutDistributedCoordination(key, ttlSeconds, fetcher, negativeTtlSeconds);
    }

    if (retryLock) {
      try {
        const recheck = await getCachedJson(key);
        if (recheck === NEG_SENTINEL) return { data: null, source: 'cache' };
        if (recheck !== null) return { data: recheck as T, source: 'cache' };

        const result = await fetcher();
        if (result != null) {
          await setCachedJson(key, result, ttlSeconds);
        } else {
          await setCachedJson(key, NEG_SENTINEL, negativeTtlSeconds);
        }
        logCacheFillEvent('cache_fill_leader', policy, key, {
          elapsedMs: Date.now() - startedAt,
          nullResult: result == null,
          hedged: true,
        });
        return { data: result, source: 'fresh' };
      } finally {
        await releaseFillLockIfOwner(lockKey, retryToken, policy, key);
      }
    }
  }

  return { data: null, source: 'cache' };
}

async function cachedFetchJsonInternal<T extends object>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T | null>,
  negativeTtlSeconds: number,
): Promise<CacheFetchResult<T>> {
  const policy = Object.prototype.hasOwnProperty.call(CACHE_FILL_REGISTRY, key)
    ? CACHE_FILL_REGISTRY[key]
    : undefined;
  const cached = await getCachedJson(key);
  if (cached === NEG_SENTINEL) {
    if (policy) {
      logCacheFillEvent('cache_hit', policy, key, { sentinel: true });
    }
    return { data: null, source: 'cache' };
  }
  if (cached !== null) {
    if (policy) {
      logCacheFillEvent('cache_hit', policy, key);
    }
    return { data: cached as T, source: 'cache' };
  }

  const existing = inflight.get(key);
  if (existing) {
    const shared = await existing;
    return { data: shared.data as T | null, source: 'fresh' };
  }

  const promise = resolveCacheMiss(key, ttlSeconds, fetcher, negativeTtlSeconds, policy)
    .catch((err: unknown) => {
      console.warn(`[redis] cachedFetchJsonInternal failed for "${key}":`, errMsg(err));
      throw err;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise as Promise<CacheFetchResult<unknown>>);
  return await promise;
}

/**
 * Check cache, then fetch with coalescing on miss.
 * Concurrent callers for the same key share a single upstream fetch + Redis write.
 * When fetcher returns null, a sentinel is cached for negativeTtlSeconds to prevent request storms.
 */
export async function cachedFetchJson<T extends object>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T | null>,
  negativeTtlSeconds = 120,
): Promise<T | null> {
  const result = await cachedFetchJsonInternal(key, ttlSeconds, fetcher, negativeTtlSeconds);
  return result.data;
}

/**
 * Like cachedFetchJson but reports the data source.
 * Use when callers need to distinguish cache hits from fresh fetches
 * (e.g. to set provider/cached metadata on responses).
 *
 * Returns { data, source } where source is:
 *   'cache'  — served from Redis
 *   'fresh'  — fetcher ran (leader) or joined an in-flight fetch (follower)
 */
export async function cachedFetchJsonWithMeta<T extends object>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T | null>,
  negativeTtlSeconds = 120,
): Promise<{ data: T | null; source: 'cache' | 'fresh' }> {
  return await cachedFetchJsonInternal(key, ttlSeconds, fetcher, negativeTtlSeconds);
}

export async function geoSearchByBox(
  key: string, lon: number, lat: number,
  widthKm: number, heightKm: number, count: number, raw = false,
): Promise<string[]> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return [];
  try {
    const finalKey = raw ? key : prefixKey(key);
    const pipeline = [
      ['GEOSEARCH', finalKey, 'FROMLONLAT', String(lon), String(lat),
       'BYBOX', String(widthKm), String(heightKm), 'km', 'ASC', 'COUNT', String(count)],
    ];
    const resp = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(REDIS_PIPELINE_TIMEOUT_MS),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as Array<{ result?: string[] }>;
    return data[0]?.result ?? [];
  } catch (err) {
    console.warn('[redis] geoSearchByBox failed:', errMsg(err));
    return [];
  }
}

export async function getHashFieldsBatch(
  key: string, fields: string[], raw = false,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (fields.length === 0) return result;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return result;
  try {
    const finalKey = raw ? key : prefixKey(key);
    const pipeline = [['HMGET', finalKey, ...fields]];
    const resp = await fetch(`${url}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pipeline),
      signal: AbortSignal.timeout(REDIS_PIPELINE_TIMEOUT_MS),
    });
    if (!resp.ok) return result;
    const data = (await resp.json()) as Array<{ result?: (string | null)[] }>;
    const values = data[0]?.result;
    if (values) {
      for (let i = 0; i < fields.length; i++) {
        if (values[i]) result.set(fields[i]!, values[i]!);
      }
    }
  } catch (err) {
    console.warn('[redis] getHashFieldsBatch failed:', errMsg(err));
  }
  return result;
}

/**
 * Deletes a single Redis key via Upstash REST API.
 *
 * @param key - The key to delete
 * @param raw - When true, skips the environment prefix (use for global keys like entitlements)
 */
export async function deleteRedisKey(key: string, raw = false): Promise<void> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return;

  try {
    const finalKey = raw ? key : prefixKey(key);
    await fetch(`${url}/del/${encodeURIComponent(finalKey)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(REDIS_OP_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('[redis] deleteRedisKey failed:', errMsg(err));
  }
}
