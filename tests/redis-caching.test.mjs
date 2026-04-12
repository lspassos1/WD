import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const REDIS_MODULE_URL = pathToFileURL(resolve(root, 'server/_shared/redis.ts')).href;

function jsonResponse(payload, ok = true) {
  return {
    ok,
    async json() {
      return payload;
    },
  };
}

function parseRedisCommand(url, init = {}) {
  const raw = String(url);
  if (raw.includes('/get/')) {
    return {
      verb: 'GET',
      key: decodeURIComponent(raw.split('/get/').pop() || ''),
      args: [],
    };
  }
  if (raw.includes('/set/')) {
    const parts = raw.split('/set/').pop()?.split('/') || [];
    return {
      verb: 'SET',
      key: decodeURIComponent(parts[0] || ''),
      args: [decodeURIComponent(parts[1] || ''), ...parts.slice(2)],
    };
  }

  try {
    const parsed = new URL(raw);
    if ((parsed.pathname === '/' || parsed.pathname === '') && typeof init.body === 'string') {
      const command = JSON.parse(String(init.body));
      if (Array.isArray(command) && command.length > 0) {
        const verb = String(command[0]).toUpperCase();
        if (verb === 'EVAL') {
          return {
            verb,
            key: String(command[3] || ''),
            args: command.slice(4),
          };
        }
        return {
          verb,
          key: typeof command[1] === 'string' ? command[1] : '',
          args: command.slice(2),
        };
      }
    }
  } catch {
    return null;
  }

  return null;
}

function withEnv(overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

async function importRedisFresh() {
  return import(`${REDIS_MODULE_URL}?t=${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

async function importPatchedTsModule(relPath, replacements) {
  const tempDir = mkdtempSync(join(tmpdir(), 'wm-ts-module-'));
  const materialized = new Map();

  function resolveRelativeModule(fromPath, specifier) {
    const base = resolve(dirname(fromPath), specifier);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.js`,
      `${base}.mjs`,
      join(base, 'index.ts'),
      join(base, 'index.js'),
      join(base, 'index.mjs'),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  function rewriteSpecifier(sourcePath, specifier) {
    const replacement = replacements[specifier];
    if (replacement) {
      return pathToFileURL(materializeModule(replacement)).href;
    }
    if (!specifier.startsWith('.')) {
      return null;
    }
    const resolved = resolveRelativeModule(sourcePath, specifier);
    if (!resolved) {
      return null;
    }
    return pathToFileURL(materializeModule(resolved)).href;
  }

  function rewriteSource(sourcePath, source) {
    return source
      .replace(/from\s+['"]([^'"]+)['"]/g, (full, specifier) => {
        const rewritten = rewriteSpecifier(sourcePath, specifier);
        return rewritten ? full.replace(specifier, rewritten) : full;
      })
      .replace(/import\(\s*['"]([^'"]+)['"]\s*\)/g, (full, specifier) => {
        const rewritten = rewriteSpecifier(sourcePath, specifier);
        return rewritten ? full.replace(specifier, rewritten) : full;
      })
      .replace(/from\s+(['"][^'"]+\.json['"])(?!\s+with\s+\{)/g, 'from $1 with { type: \'json\' }');
  }

  function materializeModule(sourcePath) {
    const cached = materialized.get(sourcePath);
    if (cached) return cached;

    const relOutPath = sourcePath.startsWith(root) ? sourcePath.slice(root.length + 1) : basename(sourcePath);
    const tempPath = join(tempDir, relOutPath);
    materialized.set(sourcePath, tempPath);

    const source = rewriteSource(sourcePath, readFileSync(sourcePath, 'utf-8'));
    mkdirSync(dirname(tempPath), { recursive: true });
    writeFileSync(tempPath, source);
    return tempPath;
  }

  const tempPath = materializeModule(resolve(root, relPath));
  const module = await import(`${pathToFileURL(tempPath).href}?t=${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return {
    module,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function buildCacheFillRegistryModule(entries) {
  return [
    "export type CacheFillFallback = 'return_null' | 'hedge' | 'throw';",
    'export interface CacheFillRegistryEntry {',
    '  logicalName: string;',
    '  leaseMs: number;',
    '  waitMs: number;',
    '  pollMinMs: number;',
    '  pollMaxMs: number;',
    '  fallback: CacheFillFallback;',
    '}',
    `export const CACHE_FILL_REGISTRY: Record<string, CacheFillRegistryEntry> = ${JSON.stringify(entries, null, 2)};`,
    '',
  ].join('\n');
}

async function importRedisWithRegistry(entries) {
  const tempDir = mkdtempSync(join(tmpdir(), 'wm-cache-fill-registry-'));
  const registryPath = join(tempDir, 'cache-fill-registry.ts');
  writeFileSync(registryPath, buildCacheFillRegistryModule(entries));

  const imported = await importPatchedTsModule('server/_shared/redis.ts', {
    './_generated/cache-fill-registry.ts': registryPath,
    './hash.ts': resolve(root, 'server/_shared/hash.ts'),
  });

  return {
    ...imported,
    cleanup() {
      imported.cleanup();
      rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

function createRedisCommandHarness() {
  const store = new Map();
  const expirations = new Map();
  const commandLog = [];

  const purgeExpired = (key) => {
    const expiresAt = expirations.get(key);
    if (expiresAt != null && expiresAt <= Date.now()) {
      store.delete(key);
      expirations.delete(key);
    }
  };

  const read = (key) => {
    purgeExpired(key);
    return store.get(key) ?? undefined;
  };

  const write = (key, value, args = []) => {
    purgeExpired(key);
    const flags = args.map((item) => String(item).toUpperCase());
    if (flags.includes('NX') && store.has(key)) {
      return { result: null };
    }

    store.set(key, value);
    expirations.delete(key);

    const exIndex = flags.indexOf('EX');
    if (exIndex !== -1) {
      expirations.set(key, Date.now() + Number(args[exIndex + 1] ?? 0) * 1000);
    }
    const pxIndex = flags.indexOf('PX');
    if (pxIndex !== -1) {
      expirations.set(key, Date.now() + Number(args[pxIndex + 1] ?? 0));
    }
    return { result: 'OK' };
  };

  const del = (key) => {
    purgeExpired(key);
    const existed = store.delete(key);
    expirations.delete(key);
    return { result: existed ? 1 : 0 };
  };

  return {
    store,
    commandLog,
    setRaw(key, value) {
      store.set(key, value);
    },
    fetch: async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (command?.verb) {
        commandLog.push({ verb: command.verb, key: command.key, args: [...command.args] });
      }

      if (raw.includes('/get/')) {
        const key = command?.key || decodeURIComponent(raw.split('/get/').pop() || '');
        return jsonResponse({ result: read(key) });
      }

      if (command?.verb === 'SET') {
        return jsonResponse(write(command.key, String(command.args[0] ?? ''), command.args.slice(1)));
      }

      if (command?.verb === 'DEL') {
        return jsonResponse(del(command.key));
      }

      if (command?.verb === 'EVAL') {
        const token = String(command.args[0] ?? '');
        if (read(command.key) === token) {
          return jsonResponse(del(command.key));
        }
        return jsonResponse({ result: 0 });
      }

      if (raw.includes('/pipeline')) {
        const commands = JSON.parse(String(init.body || '[]'));
        return jsonResponse(commands.map((entry) => {
          const [verb, key] = entry;
          if (String(verb).toUpperCase() === 'GET') {
            return { result: read(String(key)) };
          }
          throw new Error(`Unexpected pipeline command: ${verb}`);
        }));
      }

      throw new Error(`Unexpected fetch URL: ${raw}`);
    },
  };
}

async function deriveLockKeyForTest(key) {
  const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hex = Array.from(new Uint8Array(buffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  return `lock:fill:v1:${hex.slice(0, 24)}`;
}

describe('redis caching behavior', { concurrency: 1 }, () => {
  it('coalesces concurrent misses into one upstream fetcher execution', async () => {
    const redis = await importRedisFresh();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    let getCalls = 0;
    let setCalls = 0;
    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) {
        getCalls += 1;
        return jsonResponse({ result: undefined });
      }
      if (command?.verb === 'SET') {
        setCalls += 1;
        return jsonResponse({ result: 'OK' });
      }
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      let fetcherCalls = 0;
      const fetcher = async () => {
        fetcherCalls += 1;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
        return { value: 42 };
      };

      const [a, b, c] = await Promise.all([
        redis.cachedFetchJson('military:test:key', 60, fetcher),
        redis.cachedFetchJson('military:test:key', 60, fetcher),
        redis.cachedFetchJson('military:test:key', 60, fetcher),
      ]);

      assert.equal(fetcherCalls, 1, 'concurrent callers should share a single miss fetch');
      assert.deepEqual(a, { value: 42 });
      assert.deepEqual(b, { value: 42 });
      assert.deepEqual(c, { value: 42 });
      assert.equal(getCalls, 3, 'each caller should still attempt one cache read');
      assert.ok(setCalls >= 1, 'at least one cache write should happen after coalesced fetch (data + optional seed-meta)');
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('parses pipeline results and skips malformed entries', async () => {
    const redis = await importRedisFresh();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    let pipelineCalls = 0;
    globalThis.fetch = async (_url, init = {}) => {
      pipelineCalls += 1;
      const pipeline = JSON.parse(String(init.body));
      assert.equal(pipeline.length, 3);
      assert.deepEqual(pipeline.map((cmd) => cmd[0]), ['GET', 'GET', 'GET']);
      return jsonResponse([
        { result: JSON.stringify({ details: { id: 'a1' } }) },
        { result: '{ malformed json' },
        { result: JSON.stringify({ details: { id: 'c3' } }) },
      ]);
    };

    try {
      const map = await redis.getCachedJsonBatch(['k1', 'k2', 'k3']);
      assert.equal(pipelineCalls, 1, 'batch lookup should use one pipeline round-trip');
      assert.deepEqual(map.get('k1'), { details: { id: 'a1' } });
      assert.equal(map.has('k2'), false, 'malformed JSON entry should be skipped');
      assert.deepEqual(map.get('k3'), { details: { id: 'c3' } });
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});

describe('cachedFetchJsonWithMeta source labeling', { concurrency: 1 }, () => {
  it('reports source=cache on Redis hit', async () => {
    const redis = await importRedisFresh();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) {
        return jsonResponse({ result: JSON.stringify({ value: 'cached-data' }) });
      }
      if (command?.verb === 'SET') {
        return jsonResponse({ result: 'OK' });
      }
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      let fetcherCalled = false;
      const { data, source } = await redis.cachedFetchJsonWithMeta('meta:test:hit', 60, async () => {
        fetcherCalled = true;
        return { value: 'fresh-data' };
      });

      assert.equal(source, 'cache', 'should report source=cache on Redis hit');
      assert.deepEqual(data, { value: 'cached-data' });
      assert.equal(fetcherCalled, false, 'fetcher should not run on cache hit');
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('reports source=fresh on cache miss', async () => {
    const redis = await importRedisFresh();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) return jsonResponse({ result: undefined });
      if (command?.verb === 'SET') return jsonResponse({ result: 'OK' });
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      const { data, source } = await redis.cachedFetchJsonWithMeta('meta:test:miss', 60, async () => {
        return { value: 'fresh-data' };
      });

      assert.equal(source, 'fresh', 'should report source=fresh on cache miss');
      assert.deepEqual(data, { value: 'fresh-data' });
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('reports source=fresh for ALL coalesced concurrent callers', async () => {
    const redis = await importRedisFresh();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) return jsonResponse({ result: undefined });
      if (command?.verb === 'SET') return jsonResponse({ result: 'OK' });
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      let fetcherCalls = 0;
      const fetcher = async () => {
        fetcherCalls += 1;
        await new Promise((r) => setTimeout(r, 10));
        return { value: 'coalesced' };
      };

      const [a, b, c] = await Promise.all([
        redis.cachedFetchJsonWithMeta('meta:test:coalesce', 60, fetcher),
        redis.cachedFetchJsonWithMeta('meta:test:coalesce', 60, fetcher),
        redis.cachedFetchJsonWithMeta('meta:test:coalesce', 60, fetcher),
      ]);

      assert.equal(fetcherCalls, 1, 'only one fetcher should run');
      assert.equal(a.source, 'fresh', 'leader should report fresh');
      assert.equal(b.source, 'fresh', 'follower 1 should report fresh (not cache)');
      assert.equal(c.source, 'fresh', 'follower 2 should report fresh (not cache)');
      assert.deepEqual(a.data, { value: 'coalesced' });
      assert.deepEqual(b.data, { value: 'coalesced' });
      assert.deepEqual(c.data, { value: 'coalesced' });
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('TOCTOU: reports cache when Redis is populated between concurrent reads', async () => {
    const redis = await importRedisFresh();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    // First call: cache miss. Second call (from a "different instance"): cache hit.
    let getCalls = 0;
    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) {
        getCalls += 1;
        if (getCalls === 1) return jsonResponse({ result: undefined });
        // Simulate another instance populating cache between calls
        return jsonResponse({ result: JSON.stringify({ value: 'from-other-instance' }) });
      }
      if (command?.verb === 'SET') return jsonResponse({ result: 'OK' });
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      // First call: miss → fetcher runs → fresh
      const first = await redis.cachedFetchJsonWithMeta('meta:test:toctou', 60, async () => {
        return { value: 'fetched' };
      });
      assert.equal(first.source, 'fresh');
      assert.deepEqual(first.data, { value: 'fetched' });

      // Second call (fresh module import to clear inflight map): cache hit from other instance
      const redis2 = await importRedisFresh();
      const second = await redis2.cachedFetchJsonWithMeta('meta:test:toctou', 60, async () => {
        throw new Error('fetcher should not run on cache hit');
      });
      assert.equal(second.source, 'cache', 'should report cache when Redis has data');
      assert.deepEqual(second.data, { value: 'from-other-instance' });
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});

describe('negative-result caching', { concurrency: 1 }, () => {
  it('caches sentinel on null fetcher result and suppresses subsequent upstream calls', async () => {
    const redis = await importRedisFresh();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    const store = new Map();
    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) {
        const key = decodeURIComponent(raw.split('/get/').pop() || '');
        const val = store.get(key);
        return jsonResponse({ result: val ?? undefined });
      }
      if (command?.verb === 'SET') {
        store.set(command.key, String(command.args[0] ?? ''));
        return jsonResponse({ result: 'OK' });
      }
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      let fetcherCalls = 0;
      const fetcher = async () => {
        fetcherCalls += 1;
        return null;
      };

      const first = await redis.cachedFetchJson('neg:test:suppress', 300, fetcher);
      assert.equal(first, null, 'first call should return null');
      assert.equal(fetcherCalls, 1, 'fetcher should run on first call');

      const redis2 = await importRedisFresh();
      const second = await redis2.cachedFetchJson('neg:test:suppress', 300, fetcher);
      assert.equal(second, null, 'second call should return null from sentinel');
      assert.equal(fetcherCalls, 1, 'fetcher should NOT run again — sentinel suppresses');
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('cachedFetchJsonWithMeta returns data:null source:cache on sentinel hit', async () => {
    const redis = await importRedisFresh();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    const store = new Map();
    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) {
        const key = decodeURIComponent(raw.split('/get/').pop() || '');
        const val = store.get(key);
        return jsonResponse({ result: val ?? undefined });
      }
      if (command?.verb === 'SET') {
        store.set(command.key, String(command.args[0] ?? ''));
        return jsonResponse({ result: 'OK' });
      }
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      const first = await redis.cachedFetchJsonWithMeta('neg:meta:sentinel', 300, async () => null);
      assert.equal(first.data, null);
      assert.equal(first.source, 'fresh', 'first null result is fresh');

      const redis2 = await importRedisFresh();
      const second = await redis2.cachedFetchJsonWithMeta('neg:meta:sentinel', 300, async () => {
        throw new Error('fetcher should not run on sentinel hit');
      });
      assert.equal(second.data, null, 'sentinel should resolve to null data, not the sentinel string');
      assert.equal(second.source, 'cache', 'sentinel hit should report source=cache');
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('does not cache sentinel when fetcher throws', async () => {
    const redis = await importRedisFresh();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    let setCalls = 0;
    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) return jsonResponse({ result: undefined });
      if (command?.verb === 'SET') {
        setCalls += 1;
        return jsonResponse({ result: 'OK' });
      }
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      let fetcherCalls = 0;
      const throwingFetcher = async () => {
        fetcherCalls += 1;
        throw new Error('upstream ETIMEDOUT');
      };

      await assert.rejects(() => redis.cachedFetchJson('neg:test:throw', 300, throwingFetcher));
      assert.equal(fetcherCalls, 1);
      assert.equal(setCalls, 0, 'no sentinel should be cached when fetcher throws');

      const redis2 = await importRedisFresh();
      await assert.rejects(() => redis2.cachedFetchJson('neg:test:throw', 300, throwingFetcher));
      assert.equal(fetcherCalls, 2, 'fetcher should run again after a thrown error (no sentinel)');
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});

describe('theater posture caching behavior', { concurrency: 1 }, () => {
  async function importTheaterPosture() {
    return importPatchedTsModule('server/worldmonitor/military/v1/get-theater-posture.ts', {
      './_shared': resolve(root, 'server/worldmonitor/military/v1/_shared.ts'),
      '../../../_shared/constants': resolve(root, 'server/_shared/constants.ts'),
      '../../../_shared/redis': resolve(root, 'server/_shared/redis.ts'),
    });
  }

  function mockOpenSkyResponse() {
    return jsonResponse({
      states: [
        ['ae1234', 'RCH001', null, null, null, 50.0, 36.0, 30000, false, 400, 90],
        ['ae5678', 'DUKE02', null, null, null, 51.0, 35.0, 25000, false, 350, 180],
      ],
    });
  }

  it('reads live data from Redis without making upstream calls', async () => {
    const { module, cleanup } = await importTheaterPosture();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
    });
    const originalFetch = globalThis.fetch;

    const liveData = { theaters: [{ theater: 'live-test', postureLevel: 'elevated', activeFlights: 5, trackedVessels: 0, activeOperations: [], assessedAt: Date.now() }] };
    let openskyFetchCount = 0;
    globalThis.fetch = async (url) => {
      const raw = String(url);
      if (raw.includes('/get/')) {
        const key = decodeURIComponent(raw.split('/get/').pop() || '');
        if (key === 'theater-posture:sebuf:v1') {
          return jsonResponse({ result: JSON.stringify(liveData) });
        }
        return jsonResponse({ result: undefined });
      }
      if (raw.includes('opensky-network.org') || raw.includes('wingbits.com')) {
        openskyFetchCount += 1;
      }
      return jsonResponse({}, false);
    };

    try {
      const result = await module.getTheaterPosture({}, {});
      assert.equal(openskyFetchCount, 0, 'must not call upstream APIs (Redis-read-only)');
      assert.deepEqual(result, liveData, 'should return live Redis data');
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('falls back to stale/backup when both upstreams are down', async () => {
    const { module, cleanup } = await importTheaterPosture();
    const restoreEnv = withEnv({
      LOCAL_API_MODE: 'sidecar',
      WS_RELAY_URL: undefined,
      WINGBITS_API_KEY: undefined,
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    const staleData = { theaters: [{ theater: 'stale-test', postureLevel: 'normal', activeFlights: 1, trackedVessels: 0, activeOperations: [], assessedAt: 1 }] };

    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) {
        const key = decodeURIComponent(raw.split('/get/').pop() || '');
        if (key === 'theater-posture:sebuf:v1') {
          return jsonResponse({ result: undefined });
        }
        if (key === 'theater_posture:sebuf:stale:v1') {
          return jsonResponse({ result: JSON.stringify(staleData) });
        }
        return jsonResponse({ result: undefined });
      }
      if (command?.verb === 'SET') {
        return jsonResponse({ result: 'OK' });
      }
      if (raw.includes('opensky-network.org')) {
        throw new Error('OpenSky down');
      }
      return jsonResponse({}, false);
    };

    try {
      const result = await module.getTheaterPosture({}, {});
      assert.deepEqual(result, staleData, 'should return stale cache when upstreams fail');
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('returns empty theaters when all tiers exhausted', async () => {
    const { module, cleanup } = await importTheaterPosture();
    const restoreEnv = withEnv({
      LOCAL_API_MODE: 'sidecar',
      WS_RELAY_URL: undefined,
      WINGBITS_API_KEY: undefined,
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) {
        return jsonResponse({ result: undefined });
      }
      if (command?.verb === 'SET') {
        return jsonResponse({ result: 'OK' });
      }
      if (raw.includes('opensky-network.org')) {
        throw new Error('OpenSky down');
      }
      return jsonResponse({}, false);
    };

    try {
      const result = await module.getTheaterPosture({}, {});
      assert.deepEqual(result, { theaters: [] }, 'should return empty when all tiers exhausted');
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('does not write to Redis (read-only handler)', async () => {
    const { module, cleanup } = await importTheaterPosture();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
    });
    const originalFetch = globalThis.fetch;

    const cacheWrites = [];
    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) {
        return jsonResponse({ result: undefined });
      }
      if (command?.verb === 'SET' || raw.includes('/pipeline')) {
        cacheWrites.push(raw);
        return jsonResponse({ result: 'OK' });
      }
      return jsonResponse({}, false);
    };

    try {
      await module.getTheaterPosture({}, {});
      assert.equal(cacheWrites.length, 0, 'handler must not write to Redis (read-only)');
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});

describe('country intel brief caching behavior', { concurrency: 1 }, () => {
  async function importCountryIntelBrief() {
    return importPatchedTsModule('server/worldmonitor/intelligence/v1/get-country-intel-brief.ts', {
      './_shared': resolve(root, 'server/worldmonitor/intelligence/v1/_shared.ts'),
      '../../../_shared/constants': resolve(root, 'server/_shared/constants.ts'),
      '../../../_shared/redis': resolve(root, 'server/_shared/redis.ts'),
      '../../../_shared/llm-health': resolve(root, 'tests/helpers/llm-health-stub.ts'),
      '../../../_shared/llm': resolve(root, 'server/_shared/llm.ts'),
      '../../../_shared/hash': resolve(root, 'server/_shared/hash.ts'),
      '../../../_shared/premium-check': resolve(root, 'tests/helpers/premium-check-stub.ts'),
      '../../../_shared/llm-sanitize.js': resolve(root, 'server/_shared/llm-sanitize.js'),
      '../../../_shared/cache-keys': resolve(root, 'server/_shared/cache-keys.ts'),
    });
  }

  function parseRedisKey(rawUrl, op, init = {}) {
    const command = parseRedisCommand(rawUrl, init);
    if (command?.verb === op.toUpperCase()) return command.key;
    const marker = `/${op}/`;
    const idx = String(rawUrl).indexOf(marker);
    if (idx === -1) return '';
    return decodeURIComponent(String(rawUrl).slice(idx + marker.length).split('/')[0] || '');
  }

  function makeCtx(url) {
    return { request: new Request(url) };
  }

  it('uses distinct cache keys for distinct context snapshots', async () => {
    const { module, cleanup } = await importCountryIntelBrief();
    const restoreEnv = withEnv({
      GROQ_API_KEY: 'test-key',
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    const store = new Map();
    const setKeys = [];
    const userPrompts = [];
    let groqCalls = 0;

    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      if (raw === 'https://api.groq.com') {
        return jsonResponse({});
      }
      if (raw.includes('/get/')) {
        const key = parseRedisKey(raw, 'get', init);
        return jsonResponse({ result: store.get(key) });
      }
      const command = parseRedisCommand(url, init);
      if (command?.verb === 'SET') {
        const key = parseRedisKey(raw, 'set', init);
        store.set(key, String(command.args[0] ?? ''));
        if (!key.startsWith('seed-meta:')) setKeys.push(key);
        return jsonResponse({ result: 'OK' });
      }
      if (raw.includes('api.groq.com/openai/v1/chat/completions')) {
        groqCalls += 1;
        const body = JSON.parse(String(init.body || '{}'));
        userPrompts.push(body.messages?.[1]?.content || '');
        return jsonResponse({ choices: [{ message: { content: `brief-${groqCalls}` } }] });
      }
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      const req = { countryCode: 'IL' };
      const alpha = await module.getCountryIntelBrief(makeCtx('https://example.com/api/intelligence/v1/get-country-intel-brief?country_code=IL&context=alpha'), req);
      const beta = await module.getCountryIntelBrief(makeCtx('https://example.com/api/intelligence/v1/get-country-intel-brief?country_code=IL&context=beta'), req);
      const alphaCached = await module.getCountryIntelBrief(makeCtx('https://example.com/api/intelligence/v1/get-country-intel-brief?country_code=IL&context=alpha'), req);

      assert.equal(groqCalls, 2, 'different contexts should not share one cache entry');
      assert.equal(setKeys.length, 2, 'one cache write per unique context');
      assert.notEqual(setKeys[0], setKeys[1], 'context hash should differentiate cache keys');
      assert.ok(setKeys[0]?.startsWith('ci-sebuf:v3:IL:'), 'cache key should use v3 country-intel namespace');
      assert.ok(setKeys[1]?.startsWith('ci-sebuf:v3:IL:'), 'cache key should use v3 country-intel namespace');
      assert.equal(alpha.brief, 'brief-1');
      assert.equal(beta.brief, 'brief-2');
      assert.equal(alphaCached.brief, 'brief-1', 'same context should hit cache');
      assert.match(userPrompts[0], /Context snapshot:\s*alpha/);
      assert.match(userPrompts[1], /Context snapshot:\s*beta/);
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('uses base cache key and prompt when context is missing or blank', async () => {
    const { module, cleanup } = await importCountryIntelBrief();
    const restoreEnv = withEnv({
      GROQ_API_KEY: 'test-key',
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    const store = new Map();
    const setKeys = [];
    const userPrompts = [];
    let groqCalls = 0;

    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      if (raw === 'https://api.groq.com') {
        return jsonResponse({});
      }
      if (raw.includes('/get/')) {
        const key = parseRedisKey(raw, 'get', init);
        return jsonResponse({ result: store.get(key) });
      }
      const command = parseRedisCommand(url, init);
      if (command?.verb === 'SET') {
        const key = parseRedisKey(raw, 'set', init);
        store.set(key, String(command.args[0] ?? ''));
        if (!key.startsWith('seed-meta:')) setKeys.push(key);
        return jsonResponse({ result: 'OK' });
      }
      if (raw.includes('api.groq.com/openai/v1/chat/completions')) {
        groqCalls += 1;
        const body = JSON.parse(String(init.body || '{}'));
        userPrompts.push(body.messages?.[1]?.content || '');
        return jsonResponse({ choices: [{ message: { content: 'base-brief' } }] });
      }
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      const req = { countryCode: 'US' };
      const first = await module.getCountryIntelBrief(makeCtx('https://example.com/api/intelligence/v1/get-country-intel-brief?country_code=US'), req);
      const second = await module.getCountryIntelBrief(makeCtx('https://example.com/api/intelligence/v1/get-country-intel-brief?country_code=US&context=%20%20%20'), req);

      assert.equal(groqCalls, 1, 'blank context should reuse base cache entry');
      assert.equal(setKeys.length, 1);
      assert.ok(setKeys[0]?.endsWith(':base'), 'missing context should use :base cache suffix');
      assert.ok(!userPrompts[0]?.includes('Context snapshot:'), 'prompt should omit context block when absent');
      assert.equal(first.brief, 'base-brief');
      assert.equal(second.brief, 'base-brief');
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});

describe('military flights bbox behavior', { concurrency: 1 }, () => {
  async function importListMilitaryFlights() {
    return importPatchedTsModule('server/worldmonitor/military/v1/list-military-flights.ts', {
      './_shared': resolve(root, 'server/worldmonitor/military/v1/_shared.ts'),
      '../../../_shared/constants': resolve(root, 'server/_shared/constants.ts'),
      '../../../_shared/redis': resolve(root, 'server/_shared/redis.ts'),
      '../../../_shared/relay': resolve(root, 'server/_shared/relay.ts'),
      '../../../_shared/response-headers': resolve(root, 'server/_shared/response-headers.ts'),
    });
  }

  const request = {
    swLat: 10,
    swLon: 10,
    neLat: 11,
    neLon: 11,
  };

  it('fetches expanded quantized bbox but returns only flights inside the requested bbox', async () => {
    const { module, cleanup } = await importListMilitaryFlights();
    const restoreEnv = withEnv({
      LOCAL_API_MODE: 'sidecar',
      WS_RELAY_URL: undefined,
      UPSTASH_REDIS_REST_URL: undefined,
      UPSTASH_REDIS_REST_TOKEN: undefined,
    });
    const originalFetch = globalThis.fetch;

    const fetchUrls = [];
    globalThis.fetch = async (url) => {
      const raw = String(url);
      fetchUrls.push(raw);
      if (!raw.includes('opensky-network.org/api/states/all')) {
        throw new Error(`Unexpected fetch URL: ${raw}`);
      }
      return jsonResponse({
        states: [
          ['in-bounds', 'RCH123', null, null, null, 10.5, 10.5, 20000, false, 300, 90],
          ['south-out', 'RCH124', null, null, null, 10.4, 9.7, 22000, false, 280, 95],
          ['east-out', 'RCH125', null, null, null, 11.3, 10.6, 21000, false, 290, 92],
        ],
      });
    };

    try {
      const result = await module.listMilitaryFlights({}, request);
      assert.deepEqual(
        result.flights.map((flight) => flight.id),
        ['in-bounds'],
        'response should not include out-of-viewport flights',
      );

      assert.equal(fetchUrls.length, 1);
      const params = new URL(fetchUrls[0]).searchParams;
      assert.equal(params.get('lamin'), '9.5');
      assert.equal(params.get('lamax'), '11.5');
      assert.equal(params.get('lomin'), '9.5');
      assert.equal(params.get('lomax'), '11.5');
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('filters cached quantized-cell results back to the requested bbox', async () => {
    const { module, cleanup } = await importListMilitaryFlights();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      LOCAL_API_MODE: undefined,
      WS_RELAY_URL: undefined,
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    let openskyCalls = 0;
    let redisGetCalls = 0;
    globalThis.fetch = async (url) => {
      const raw = String(url);
      if (raw.includes('/get/')) {
        redisGetCalls += 1;
        return jsonResponse({
          result: JSON.stringify({
            flights: [
              { id: 'cache-in', location: { latitude: 10.2, longitude: 10.2 } },
              { id: 'cache-out', location: { latitude: 9.8, longitude: 10.2 } },
            ],
            clusters: [],
          }),
        });
      }
      if (raw.includes('opensky-network.org/api/states/all')) {
        openskyCalls += 1;
      }
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      const result = await module.listMilitaryFlights({}, request);
      assert.equal(redisGetCalls, 1, 'handler should read quantized cache first');
      assert.equal(openskyCalls, 0, 'cache hit should avoid upstream fetch');
      assert.deepEqual(
        result.flights.map((flight) => flight.id),
        ['cache-in'],
        'cached quantized-cell payload must be re-filtered to request bbox',
      );
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});

describe('distributed cache-fill coordinator', { concurrency: 1 }, () => {
  const KEY = 'risk:scores:sebuf:v1';

  function coordinatorRegistry(overrides = {}) {
    return {
      [KEY]: {
        logicalName: 'riskScoresLive',
        leaseMs: 200,
        waitMs: 100,
        pollMinMs: 5,
        pollMaxMs: 10,
        fallback: 'return_null',
        ...overrides,
      },
    };
  }

  it('collapses cross-instance cold misses into one leader fetch', async () => {
    const redisA = await importRedisWithRegistry(coordinatorRegistry());
    const redisB = await importRedisWithRegistry(coordinatorRegistry());
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const harness = createRedisCommandHarness();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = harness.fetch;

    let fetcherCalls = 0;
    try {
      const [leader, follower] = await Promise.all([
        redisA.module.cachedFetchJson(KEY, 60, async () => {
          fetcherCalls += 1;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
          return { value: 'leader' };
        }),
        redisB.module.cachedFetchJson(KEY, 60, async () => {
          fetcherCalls += 1;
          return { value: 'should-not-run' };
        }),
      ]);

      assert.equal(fetcherCalls, 1, 'only one instance should execute the upstream fetcher');
      assert.deepEqual(leader, { value: 'leader' });
      assert.deepEqual(follower, { value: 'leader' });
    } finally {
      redisA.cleanup();
      redisB.cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('rechecks cache after lock acquisition before running the fetcher', async () => {
    const redis = await importRedisWithRegistry(coordinatorRegistry());
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const harness = createRedisCommandHarness();
    const originalFetch = globalThis.fetch;

    let injected = false;
    globalThis.fetch = async (url, init = {}) => {
      const command = parseRedisCommand(url, init);
      if (!injected && command?.verb === 'SET' && command.key.startsWith('lock:fill:v1:')) {
        injected = true;
        harness.setRaw(KEY, JSON.stringify({ value: 'published-between-miss-and-lock' }));
      }
      return harness.fetch(url, init);
    };

    try {
      let fetcherCalls = 0;
      const result = await redis.module.cachedFetchJson(KEY, 60, async () => {
        fetcherCalls += 1;
        return { value: 'should-not-run' };
      });

      assert.equal(fetcherCalls, 0, 'mandatory recheck should suppress stale leader fetches');
      assert.deepEqual(result, { value: 'published-between-miss-and-lock' });
    } finally {
      redis.cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('returns null to followers when the leader publishes the negative sentinel', async () => {
    const redisA = await importRedisWithRegistry(coordinatorRegistry());
    const redisB = await importRedisWithRegistry(coordinatorRegistry());
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const harness = createRedisCommandHarness();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = harness.fetch;

    let fetcherCalls = 0;
    try {
      const [leader, follower] = await Promise.all([
        redisA.module.cachedFetchJson(KEY, 60, async () => {
          fetcherCalls += 1;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
          return null;
        }),
        redisB.module.cachedFetchJson(KEY, 60, async () => {
          fetcherCalls += 1;
          return { value: 'should-not-run' };
        }),
      ]);

      assert.equal(fetcherCalls, 1, 'follower should observe the sentinel instead of hedging');
      assert.equal(leader, null);
      assert.equal(follower, null);
    } finally {
      redisA.cleanup();
      redisB.cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('returns null after follower timeout when fallback=return_null', async () => {
    const redis = await importRedisWithRegistry(coordinatorRegistry({ waitMs: 20, leaseMs: 80 }));
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const harness = createRedisCommandHarness();
    const originalFetch = globalThis.fetch;
    const lockKey = await deriveLockKeyForTest(KEY);
    harness.setRaw(lockKey, 'other-owner');
    globalThis.fetch = harness.fetch;

    try {
      let fetcherCalls = 0;
      const result = await redis.module.cachedFetchJson(KEY, 60, async () => {
        fetcherCalls += 1;
        return { value: 'should-not-run' };
      });

      assert.equal(fetcherCalls, 0, 'return_null timeout should not call the fetcher');
      assert.equal(result, null);
    } finally {
      redis.cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('retries lock acquisition before hedging', async () => {
    const redis = await importRedisWithRegistry(coordinatorRegistry({
      waitMs: 20,
      leaseMs: 80,
      fallback: 'hedge',
    }));
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const harness = createRedisCommandHarness();
    const originalFetch = globalThis.fetch;
    const lockKey = await deriveLockKeyForTest(KEY);
    harness.setRaw(lockKey, 'other-owner');
    globalThis.fetch = harness.fetch;

    try {
      let fetcherCalls = 0;
      const result = await redis.module.cachedFetchJson(KEY, 60, async () => {
        fetcherCalls += 1;
        return { value: 'should-not-run' };
      });

      const lockAttempts = harness.commandLog.filter((entry) => entry.verb === 'SET' && entry.key === lockKey).length;
      assert.equal(fetcherCalls, 0, 'hedge must not bypass the second lock attempt');
      assert.equal(lockAttempts, 2, 'hedge fallback should attempt the lock twice');
      assert.equal(result, null);
    } finally {
      redis.cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('throws on invalid cache-fill timing invariants before coordination starts', async () => {
    const redis = await importRedisWithRegistry(coordinatorRegistry({ waitMs: 50, leaseMs: 50 }));
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const harness = createRedisCommandHarness();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = harness.fetch;

    try {
      await assert.rejects(
        () => redis.module.cachedFetchJson(KEY, 60, async () => ({ value: 'never' })),
        /waitMs must be < leaseMs/,
      );
      const lockAttempts = harness.commandLog.filter((entry) => entry.verb === 'SET' && entry.key.startsWith('lock:fill:v1:')).length;
      assert.equal(lockAttempts, 0, 'no lock commands should run after invariant failure');
    } finally {
      redis.cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('keeps the local inflight entry until publish finishes', async () => {
    const redis = await importRedisFresh();
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const originalFetch = globalThis.fetch;

    let fetcherCalls = 0;
    globalThis.fetch = async (url, init = {}) => {
      const raw = String(url);
      const command = parseRedisCommand(url, init);
      if (raw.includes('/get/')) {
        return jsonResponse({ result: undefined });
      }
      if (command?.verb === 'SET') {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
        return jsonResponse({ result: 'OK' });
      }
      throw new Error(`Unexpected fetch URL: ${raw}`);
    };

    try {
      const first = redis.cachedFetchJson('unlisted:publish-order:v1', 60, async () => {
        fetcherCalls += 1;
        return { value: 'payload' };
      });
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
      const second = redis.cachedFetchJson('unlisted:publish-order:v1', 60, async () => {
        fetcherCalls += 1;
        return { value: 'should-not-run' };
      });

      const [a, b] = await Promise.all([first, second]);
      assert.equal(fetcherCalls, 1, 'late local callers should join until publish completes');
      assert.deepEqual(a, { value: 'payload' });
      assert.deepEqual(b, { value: 'payload' });
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('does not delete a lock that was replaced by another owner before release', async () => {
    const redis = await importRedisWithRegistry(coordinatorRegistry());
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const harness = createRedisCommandHarness();
    const originalFetch = globalThis.fetch;
    const lockKey = await deriveLockKeyForTest(KEY);

    globalThis.fetch = async (url, init = {}) => {
      const command = parseRedisCommand(url, init);
      const response = await harness.fetch(url, init);
      if (command?.verb === 'SET' && command.key === KEY) {
        harness.setRaw(lockKey, 'new-owner-token');
      }
      return response;
    };

    try {
      const result = await redis.module.cachedFetchJson(KEY, 60, async () => ({ value: 'published' }));
      assert.deepEqual(result, { value: 'published' });
      assert.equal(harness.store.get(lockKey), 'new-owner-token', 'safe unlock must preserve a newer owner lock');
    } finally {
      redis.cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('preserves legacy behavior when no cache-fill policy exists', async () => {
    const redisA = await importRedisWithRegistry({});
    const redisB = await importRedisWithRegistry({});
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const harness = createRedisCommandHarness();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = harness.fetch;

    let fetcherCalls = 0;
    try {
      await Promise.all([
        redisA.module.cachedFetchJson('unlisted:legacy:v1', 60, async () => {
          fetcherCalls += 1;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 15));
          return { value: 'a' };
        }),
        redisB.module.cachedFetchJson('unlisted:legacy:v1', 60, async () => {
          fetcherCalls += 1;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 15));
          return { value: 'b' };
        }),
      ]);

      assert.equal(fetcherCalls, 2, 'unlisted keys should keep single-instance behavior only');
    } finally {
      redisA.cleanup();
      redisB.cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});

describe('coordinator-enabled handler fallbacks', { concurrency: 1 }, () => {
  it('list-service-statuses falls back to the module cache after coordinator timeout', async () => {
    const { module, cleanup } = await importPatchedTsModule(
      'server/worldmonitor/infrastructure/v1/list-service-statuses.ts',
      {},
    );
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const harness = createRedisCommandHarness();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = harness.fetch;

    const statuses = [
      { name: 'Example Service', status: 'SERVICE_OPERATIONAL_STATUS_OPERATIONAL' },
    ];

    try {
      harness.setRaw('infra:service-statuses:v1', JSON.stringify(statuses));
      const warm = await module.listServiceStatuses({}, {});
      assert.deepEqual(warm.statuses, statuses, 'warm path should seed the module fallback cache');

      harness.store.delete('infra:service-statuses:v1');
      harness.setRaw(await deriveLockKeyForTest('infra:service-statuses:v1'), 'other-owner');

      const fallback = await module.listServiceStatuses({}, {});
      assert.deepEqual(fallback.statuses, statuses, 'timeout/null path should return the in-memory fallback cache');
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  it('get-risk-scores falls back to stale data after coordinator timeout', async () => {
    const { module, cleanup } = await importPatchedTsModule(
      'server/worldmonitor/intelligence/v1/get-risk-scores.ts',
      {},
    );
    const restoreEnv = withEnv({
      UPSTASH_REDIS_REST_URL: 'https://redis.test',
      UPSTASH_REDIS_REST_TOKEN: 'token',
      VERCEL_ENV: undefined,
      VERCEL_GIT_COMMIT_SHA: undefined,
    });
    const harness = createRedisCommandHarness();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = harness.fetch;

    const seeded = { ciiScores: [], strategicRisks: [] };

    try {
      harness.setRaw('risk:scores:sebuf:v1', JSON.stringify(seeded));
      const warm = await module.getRiskScores({}, {});
      assert.deepEqual(warm, seeded, 'warm path should populate stale fallback data');

      harness.store.delete('risk:scores:sebuf:v1');
      harness.setRaw(await deriveLockKeyForTest('risk:scores:sebuf:v1'), 'other-owner');

      const fallback = await module.getRiskScores({}, {});
      assert.deepEqual(fallback, seeded, 'timeout/null path should return the stale cache entry');
    } finally {
      cleanup();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});
