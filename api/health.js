import { jsonResponse } from './_json-response.js';
import {
  HEALTH_BOOTSTRAP_KEYS as BOOTSTRAP_KEYS,
  HEALTH_STANDALONE_KEYS as STANDALONE_KEYS,
  HEALTH_SEED_META as SEED_META,
  HEALTH_ON_DEMAND_KEYS,
  HEALTH_EMPTY_OK_KEYS,
  HEALTH_CASCADE_GROUPS as CASCADE_GROUPS,
} from './_generated/health-registry.js';
// @ts-expect-error — JS module, no declaration file
import { redisPipeline, getRedisCredentials } from './_upstash-json.js';

export const config = { runtime: 'edge' };
const ON_DEMAND_KEYS = new Set(HEALTH_ON_DEMAND_KEYS);
const EMPTY_DATA_OK_KEYS = new Set(HEALTH_EMPTY_OK_KEYS);

const NEG_SENTINEL = '__WM_NEG__';


function parseRedisValue(raw) {
  if (!raw || raw === NEG_SENTINEL) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}


export default async function handler(req) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store, max-age=0',
    'CDN-Cache-Control': 'no-store',
    'CF-Cache-Status': 'BYPASS',
    'Access-Control-Allow-Origin': '*',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  const now = Date.now();

  const allDataKeys = [
    ...Object.values(BOOTSTRAP_KEYS),
    ...Object.values(STANDALONE_KEYS),
  ];
  const allMetaKeys = Object.values(SEED_META).map(s => s.key);

  // STRLEN for data keys avoids loading large blobs into memory (OOM prevention).
  // NEG_SENTINEL ('__WM_NEG__') is 10 bytes — any real data is >10 bytes.
  const NEG_SENTINEL_LEN = NEG_SENTINEL.length;
  let results;
  try {
    const commands = [
      ...allDataKeys.map(k => ['STRLEN', k]),
      ...allMetaKeys.map(k => ['GET', k]),
    ];
    if (!getRedisCredentials()) throw new Error('Redis not configured');
    results = await redisPipeline(commands, 8_000);
    if (!results) throw new Error('Redis request failed');
  } catch (err) {
    return jsonResponse({
      status: 'REDIS_DOWN',
      error: err.message,
      checkedAt: new Date(now).toISOString(),
    }, 200, headers);
  }

  // keyStrens: byte length per data key (0 = missing/empty/sentinel)
  const keyStrens = new Map();
  for (let i = 0; i < allDataKeys.length; i++) {
    keyStrens.set(allDataKeys[i], results[i]?.result ?? 0);
  }
  // keyMetaValues: parsed seed-meta objects (GET, small payloads)
  const keyMetaValues = new Map();
  for (let i = 0; i < allMetaKeys.length; i++) {
    keyMetaValues.set(allMetaKeys[i], results[allDataKeys.length + i]?.result ?? null);
  }

  const checks = {};
  let totalChecks = 0;
  let okCount = 0;
  let warnCount = 0;
  let critCount = 0;

  for (const [name, redisKey] of Object.entries(BOOTSTRAP_KEYS)) {
    totalChecks++;
    const strlen = keyStrens.get(redisKey) ?? 0;
    const hasData = strlen > NEG_SENTINEL_LEN;
    const seedCfg = SEED_META[name];

    let seedAge = null;
    let seedStale = null;
    let seedError = false;
    let metaCount = null;
    if (seedCfg) {
      const metaRaw = keyMetaValues.get(seedCfg.key);
      const meta = parseRedisValue(metaRaw);
      if (meta?.status === 'error') {
        seedStale = true;
        seedError = true;
      } else if (meta?.fetchedAt) {
        seedAge = Math.round((now - meta.fetchedAt) / 60_000);
        seedStale = seedAge > seedCfg.maxStaleMin;
      } else {
        seedStale = true;
      }
      if (meta?.count != null) metaCount = meta.count;
      else if (meta?.recordCount != null) metaCount = meta.recordCount;
    }

    const size = metaCount ?? (hasData ? 1 : 0);

    let status;
    if (seedError === true) {
      status = 'SEED_ERROR';
      warnCount++;
    } else if (!hasData) {
      if (EMPTY_DATA_OK_KEYS.has(name)) {
        if (seedStale === true) {
          status = 'STALE_SEED';
          warnCount++;
        } else {
          status = 'OK';
          okCount++;
        }
      } else {
        status = 'EMPTY';
        critCount++;
      }
    } else if (size === 0) {
      if (EMPTY_DATA_OK_KEYS.has(name)) {
        if (seedStale === true) {
          status = 'STALE_SEED';
          warnCount++;
        } else {
          status = 'OK';
          okCount++;
        }
      } else {
        status = 'EMPTY_DATA';
        critCount++;
      }
    } else if (seedStale === true) {
      status = 'STALE_SEED';
      warnCount++;
    } else {
      status = 'OK';
      okCount++;
    }

    const entry = { status, records: size };
    if (seedAge !== null) entry.seedAgeMin = seedAge;
    if (seedCfg) entry.maxStaleMin = seedCfg.maxStaleMin;
    checks[name] = entry;
  }

  for (const [name, redisKey] of Object.entries(STANDALONE_KEYS)) {
    totalChecks++;
    const strlen = keyStrens.get(redisKey) ?? 0;
    const hasData = strlen > NEG_SENTINEL_LEN;
    const isOnDemand = ON_DEMAND_KEYS.has(name);
    const seedCfg = SEED_META[name];

    // Freshness tracking for standalone keys (same logic as bootstrap keys)
    let seedAge = null;
    let seedStale = null;
    let seedError = false;
    let metaCount = null;
    if (seedCfg) {
      const metaRaw = keyMetaValues.get(seedCfg.key);
      const meta = parseRedisValue(metaRaw);
      if (meta?.status === 'error') {
        seedStale = true;
        seedError = true;
      } else if (meta?.fetchedAt) {
        seedAge = Math.round((now - meta.fetchedAt) / 60_000);
        seedStale = seedAge > seedCfg.maxStaleMin;
      } else {
        // No seed-meta → data exists but freshness is unknown → stale
        seedStale = true;
      }
      if (meta?.count != null) metaCount = meta.count;
      else if (meta?.recordCount != null) metaCount = meta.recordCount;
    }

    const size = metaCount ?? (hasData ? 1 : 0);

    // Cascade: if this key is empty but a sibling in the cascade group has data, it's OK.
    const cascadeSiblings = CASCADE_GROUPS[name];
    let cascadeCovered = false;
    if (cascadeSiblings && !hasData) {
      for (const sibling of cascadeSiblings) {
        if (sibling === name) continue;
        const sibKey = STANDALONE_KEYS[sibling];
        if (!sibKey) continue;
        if ((keyStrens.get(sibKey) ?? 0) > NEG_SENTINEL_LEN) {
          cascadeCovered = true;
          break;
        }
      }
    }

    let status;
    if (seedError === true) {
      status = 'SEED_ERROR';
      warnCount++;
    } else if (!hasData) {
      if (cascadeCovered) {
        status = 'OK_CASCADE';
        okCount++;
      } else if (EMPTY_DATA_OK_KEYS.has(name)) {
        if (seedStale === true) {
          status = 'STALE_SEED';
          warnCount++;
        } else {
          status = 'OK';
          okCount++;
        }
      } else if (isOnDemand) {
        status = 'EMPTY_ON_DEMAND';
        warnCount++;
      } else {
        status = 'EMPTY';
        critCount++;
      }
    } else if (size === 0) {
      if (cascadeCovered) {
        status = 'OK_CASCADE';
        okCount++;
      } else if (EMPTY_DATA_OK_KEYS.has(name)) {
        if (seedStale === true) {
          status = 'STALE_SEED';
          warnCount++;
        } else {
          status = 'OK';
          okCount++;
        }
      } else if (isOnDemand) {
        status = 'EMPTY_ON_DEMAND';
        warnCount++;
      } else {
        status = 'EMPTY_DATA';
        critCount++;
      }
    } else if (seedStale === true) {
      status = 'STALE_SEED';
      warnCount++;
    } else {
      status = 'OK';
      okCount++;
    }

    const entry = { status, records: size };
    if (seedAge !== null) entry.seedAgeMin = seedAge;
    if (seedCfg) entry.maxStaleMin = seedCfg.maxStaleMin;
    checks[name] = entry;
  }

  // On-demand keys that simply haven't been requested yet should not affect overall status.
  const onDemandWarnCount = Object.values(checks).filter(c => c.status === 'EMPTY_ON_DEMAND').length;
  const realWarnCount = warnCount - onDemandWarnCount;

  let overall;
  if (critCount === 0 && realWarnCount === 0) overall = 'HEALTHY';
  else if (critCount === 0) overall = 'WARNING';
  else if (critCount <= 3) overall = 'DEGRADED';
  else overall = 'UNHEALTHY';

  const httpStatus = 200;

  if (overall !== 'HEALTHY' && overall !== 'WARNING') {
    const problemKeys = Object.entries(checks)
      .filter(([, c]) => c.status === 'EMPTY' || c.status === 'EMPTY_DATA' || c.status === 'STALE_SEED' || c.status === 'SEED_ERROR')
      .map(([k, c]) => `${k}:${c.status}${c.seedAgeMin != null ? `(${c.seedAgeMin}min)` : ''}`);
    console.log('[health] %s crits=[%s]', overall, problemKeys.join(', '));
    // Persist last failure snapshot to Redis (TTL 24h) for post-mortem inspection.
    // Fire-and-forget — must not block or add latency to the health response.
    void redisPipeline([['SET', 'health:last-failure', JSON.stringify({
      at: new Date(now).toISOString(),
      status: overall,
      critCount,
      crits: problemKeys,
    }), 'EX', 86400]]).catch(() => {});
  }

  const url = new URL(req.url);
  const compact = url.searchParams.get('compact') === '1';

  const body = {
    status: overall,
    summary: {
      total: totalChecks,
      ok: okCount,
      warn: warnCount,
      crit: critCount,
    },
    checkedAt: new Date(now).toISOString(),
  };

  if (!compact) {
    body.checks = checks;
  } else {
    const problems = {};
    for (const [name, check] of Object.entries(checks)) {
      if (check.status !== 'OK' && check.status !== 'OK_CASCADE') problems[name] = check;
    }
    if (Object.keys(problems).length > 0) body.problems = problems;
  }

  return new Response(JSON.stringify(body, null, compact ? 0 : 2), {
    status: httpStatus,
    headers,
  });
}
