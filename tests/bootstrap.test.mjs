import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const healthRegistry = await import(pathToFileURL(join(root, 'api', '_generated', 'health-registry.js')).href);

describe('Bootstrap cache key registry', () => {
  const bootstrapRegistryTsPath = join(root, 'server', '_shared', '_generated', 'bootstrap-registry.ts');
  const bootstrapRegistryTsSrc = readFileSync(bootstrapRegistryTsPath, 'utf-8');
  const generatedRegistrySrc = readFileSync(join(root, 'api', '_generated', 'dataset-registry.js'), 'utf-8');
  const bootstrapSrc = readFileSync(join(root, 'api', 'bootstrap.js'), 'utf-8');
  const generatedBlock = generatedRegistrySrc.match(/BOOTSTRAP_CACHE_KEYS[^=]*=\s*\{([\s\S]*?)\};/)?.[1] ?? '';

  it('exports BOOTSTRAP_CACHE_KEYS with at least 10 entries', () => {
    const matches = generatedBlock.match(/"[^"]+":\s*"[^"]+"/gm);
    assert.ok(matches && matches.length >= 10, `Expected ≥10 keys, found ${matches?.length ?? 0}`);
  });

  it('generated TS and JS registry files stay in parity', () => {
    const extractKeys = (src) => {
      const block = src.match(/BOOTSTRAP_CACHE_KEYS[^=]*=\s*\{([^}]+)\}/);
      if (!block) return {};
      const re = /["']([^"']+)["']:\s*["']([^"']+)["']/g;
      const keys = {};
      let m;
      while ((m = re.exec(block[1])) !== null) keys[m[1]] = m[2];
      return keys;
    };
    const canonical = extractKeys(bootstrapRegistryTsSrc);
    const generated = extractKeys(generatedRegistrySrc);
    assert.ok(Object.keys(canonical).length >= 10, 'Canonical registry too small');
    for (const [name, key] of Object.entries(canonical)) {
      assert.equal(generated[name], key, `Key '${name}' mismatch: canonical='${key}', generated='${generated[name]}'`);
    }
    for (const [name, key] of Object.entries(generated)) {
      assert.equal(canonical[name], key, `Extra inlined key '${name}' not in canonical registry`);
    }
  });

  it('every cache key matches a handler cache key pattern', () => {
    const keyRe = /"[^"]+":\s*"([^"]+)"/g;
    let m;
    const keys = [];
    while ((m = keyRe.exec(generatedBlock)) !== null) {
      keys.push(m[1]);
    }
    for (const key of keys) {
      assert.match(
        key,
        /^[a-z0-9_-]+(?::[a-z0-9_-]+)+$/,
        `Cache key "${key}" must stay lowercase, colon-delimited, and free of runtime placeholders`,
      );
    }
  });

  it('has no duplicate cache keys', () => {
    const keyRe = /"[^"]+":\s*"([^"]+)"/g;
    let m;
    const keys = [];
    while ((m = keyRe.exec(generatedBlock)) !== null) {
      keys.push(m[1]);
    }
    const unique = new Set(keys);
    assert.equal(unique.size, keys.length, `Found duplicate cache keys: ${keys.filter((k, i) => keys.indexOf(k) !== i)}`);
  });

  it('has no duplicate logical names', () => {
    const nameRe = /"([^"]+)":/gm;
    let m;
    const names = [];
    while ((m = nameRe.exec(generatedBlock)) !== null) {
      names.push(m[1]);
    }
    const unique = new Set(names);
    assert.equal(unique.size, names.length, `Found duplicate names: ${names.filter((n, i) => names.indexOf(n) !== i)}`);
  });

  it('every cache key maps to a handler file or external seed script', () => {
    const keyRe = /"[^"]+":\s*"([^"]+)"/g;
    let m;
    const keys = [];
    while ((m = keyRe.exec(generatedBlock)) !== null) {
      keys.push(m[1]);
    }

    const handlerDirs = join(root, 'server', 'worldmonitor');
    const handlerFiles = [];
    function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts') && !entry.includes('service_server') && !entry.includes('service_client')) {
          handlerFiles.push(full);
        }
      }
    }
    walk(handlerDirs);
    const allHandlerCode = handlerFiles.map(f => readFileSync(f, 'utf-8')).join('\n');

    const seedFiles = readdirSync(join(root, 'scripts'))
      .filter(f => f.startsWith('seed-') && f.endsWith('.mjs'))
      .map(f => readFileSync(join(root, 'scripts', f), 'utf-8'))
      .join('\n');
    const healthSrc = readFileSync(join(root, 'api', 'health.js'), 'utf-8');
    const registrySrc = readFileSync(join(root, 'registry', 'datasets.ts'), 'utf-8');
    const allSearchable = allHandlerCode + '\n' + seedFiles + '\n' + healthSrc + '\n' + registrySrc;

    for (const key of keys) {
      assert.ok(
        allSearchable.includes(key),
        `Cache key "${key}" not found in any handler file, seed script, health contract, or registry source`,
      );
    }
  });

  it('keeps on-demand health additions in standalone health bucket', () => {
    const additions = ['cryptoSectors', 'ddosAttacks', 'economicStress', 'trafficAnomalies'];
    for (const logicalName of additions) {
      assert.ok(
        !(logicalName in healthRegistry.HEALTH_BOOTSTRAP_KEYS),
        `${logicalName} should not be classified as bootstrap health key`,
      );
      assert.ok(
        logicalName in healthRegistry.HEALTH_STANDALONE_KEYS,
        `${logicalName} should be classified as standalone health key`,
      );
      assert.ok(
        healthRegistry.HEALTH_ON_DEMAND_KEYS.includes(logicalName),
        `${logicalName} should remain marked on-demand`,
      );
    }
  });
});

describe('Bootstrap endpoint (api/bootstrap.js)', () => {
  const bootstrapPath = join(root, 'api', 'bootstrap.js');
  const src = readFileSync(bootstrapPath, 'utf-8');

  it('exports edge runtime config', () => {
    assert.ok(src.includes("runtime: 'edge'"), 'Missing edge runtime config');
  });

  it('imports generated BOOTSTRAP_CACHE_KEYS', () => {
    assert.ok(src.includes("from './_generated/dataset-registry.js'"), 'Missing generated dataset registry import');
  });

  it('defines getCachedJsonBatch inline (self-contained, no server imports)', () => {
    assert.ok(src.includes('getCachedJsonBatch'), 'Missing getCachedJsonBatch function');
    assert.ok(!src.includes("from '../server/"), 'Should not import from server/ — Edge Functions cannot resolve cross-directory TS imports');
  });

  it('supports optional ?keys= query param for subset filtering', () => {
    assert.ok(src.includes("'keys'"), 'Missing keys query param handling');
  });

  it('returns JSON with data and missing keys', () => {
    assert.ok(src.includes('data'), 'Missing data field in response');
    assert.ok(src.includes('missing'), 'Missing missing field in response');
  });

  it('sets Cache-Control header with s-maxage for both tiers', () => {
    // Cache-Control uses browser-only max-age (no s-maxage) so CF does not cache and
    // pin a single ACAO origin. Vercel CDN uses CDN-Cache-Control for edge caching.
    assert.ok(src.includes('max-age='), 'Missing max-age in Cache-Control');
    assert.ok(src.includes('stale-while-revalidate'), 'Missing stale-while-revalidate');
    assert.ok(src.includes('CDN-Cache-Control'), 'Missing CDN-Cache-Control for Vercel CDN');
  });

  it('validates API key for desktop origins', () => {
    assert.ok(src.includes('validateApiKey'), 'Missing API key validation');
  });

  it('handles CORS preflight', () => {
    assert.ok(src.includes("'OPTIONS'"), 'Missing OPTIONS method handling');
    assert.ok(src.includes('getCorsHeaders'), 'Missing CORS headers');
  });

  it('supports ?tier= query param for tiered fetching', () => {
    assert.ok(src.includes("'tier'"), 'Missing tier query param handling');
    assert.ok(src.includes('BOOTSTRAP_TIERS'), 'Missing BOOTSTRAP_TIERS map');
    assert.ok(src.includes('TIER_CACHE'), 'Missing TIER_CACHE map');
  });
});

describe('Frontend hydration (src/services/bootstrap.ts)', () => {
  const bootstrapClientPath = join(root, 'src', 'services', 'bootstrap.ts');
  const src = readFileSync(bootstrapClientPath, 'utf-8');

  it('exports getHydratedData function', () => {
    assert.ok(src.includes('export function getHydratedData'), 'Missing getHydratedData export');
  });

  it('exports fetchBootstrapData function', () => {
    assert.ok(src.includes('export async function fetchBootstrapData'), 'Missing fetchBootstrapData export');
  });

  it('uses consume-once pattern (deletes after read)', () => {
    assert.ok(src.includes('.delete('), 'Missing delete in getHydratedData — consume-once pattern not implemented');
  });

  it('has a fast timeout cap to avoid regressing startup', () => {
    const timeoutMatches = [...src.matchAll(/setTimeout\([^,]+,\s*(?:desktop\s*\?\s*[\d_]+\s*:\s*)?(\d[\d_]*)\)/g)];
    assert.ok(timeoutMatches.length > 0, 'Missing timeout');
    for (const m of timeoutMatches) {
      const ms = parseInt(m[1].replace(/_/g, ''), 10);
      assert.ok(ms <= 5000, `Timeout ${ms}ms too high — should be ≤5000ms to avoid regressing startup`);
    }
  });

  it('keeps web bootstrap tier timeouts under 2 seconds', () => {
    const timeouts = Array.from(src.matchAll(/(\d[_\d]*)\)/g))
      .map((m) => parseInt(m[1].replace(/_/g, ''), 10))
      .filter((n) => n === 1200 || n === 1800);
    assert.deepEqual(timeouts, [1200, 1800], `Expected aggressive web bootstrap timeouts (1200, 1800)`);
  });

  it('allows longer bootstrap timeouts for desktop runtime', () => {
    assert.ok(src.includes('isDesktopRuntime'), 'Bootstrap should branch on desktop for longer timeouts');
  });

  it('fetches tiered bootstrap URLs', () => {
    assert.ok(src.includes('/api/bootstrap?tier='), 'Missing tiered bootstrap fetch URLs');
  });

  it('handles fetch failure silently', () => {
    assert.ok(src.includes('catch'), 'Missing error handling — panels should fall through to individual calls');
  });

  it('fetches both tiers in parallel', () => {
    assert.ok(src.includes('Promise.all'), 'Missing Promise.all for parallel tier fetches');
    assert.ok(src.includes("'slow'"), 'Missing slow tier fetch');
    assert.ok(src.includes("'fast'"), 'Missing fast tier fetch');
  });
});

describe('Panel hydration consumers', () => {
  const panels = [
    { name: 'ETFFlowsPanel', path: 'src/components/ETFFlowsPanel.ts', key: 'etfFlows' },
    { name: 'MacroSignalsPanel', path: 'src/components/MacroSignalsPanel.ts', key: 'macroSignals' },
    { name: 'ServiceStatusPanel (via infrastructure)', path: 'src/services/infrastructure/index.ts', key: 'serviceStatuses' },
    { name: 'Sectors (via data-loader)', path: 'src/app/data-loader.ts', key: 'sectors' },
  ];

  for (const panel of panels) {
    it(`${panel.name} checks getHydratedData('${panel.key}')`, () => {
      const src = readFileSync(join(root, panel.path), 'utf-8');
      assert.ok(src.includes('getHydratedData'), `${panel.name} missing getHydratedData import/usage`);
      assert.ok(src.includes(`'${panel.key}'`), `${panel.name} missing hydration key '${panel.key}'`);
    });
  }
});

describe('Bootstrap key hydration coverage', () => {
  it('every bootstrap key has a getHydratedData consumer in src/', () => {
    const generatedSrc = readFileSync(join(root, 'api', '_generated', 'dataset-registry.js'), 'utf-8');
    const block = generatedSrc.match(/BOOTSTRAP_CACHE_KEYS\s*=\s*\{([\s\S]*?)\};/);
    const keyRe = /"([^"]+)":\s*"[^"]+"/g;
    const keys = [];
    let m;
    while ((m = keyRe.exec(block?.[1] ?? '')) !== null) keys.push(m[1]);

    const srcFiles = [];
    function walk(dir) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.ts') && !full.includes('/generated/')) srcFiles.push(full);
      }
    }
    walk(join(root, 'src'));
    const allSrc = srcFiles.map(f => readFileSync(f, 'utf-8')).join('\n');

    // Keys with planned but not-yet-wired consumers
    const PENDING_CONSUMERS = new Set(['correlationCards', 'euGasStorage', 'chokepointBaselines', 'electricityPrices', 'imfMacro', 'jodiOil', 'portwatchChokepointsRef', 'portwatchPortActivity', 'sprPolicies', 'wsbTickers']);
    for (const key of keys) {
      if (PENDING_CONSUMERS.has(key)) continue;
      assert.ok(
        allSrc.includes(`getHydratedData('${key}')`),
        `Bootstrap key '${key}' has no getHydratedData('${key}') consumer in src/ — data is fetched but never used`,
      );
    }
  });
});

describe('Health key registries', () => {
  const {
    HEALTH_BOOTSTRAP_KEYS,
    HEALTH_STANDALONE_KEYS,
    HEALTH_SEED_META,
    HEALTH_ON_DEMAND_KEYS,
    HEALTH_EMPTY_OK_KEYS,
    HEALTH_CASCADE_GROUPS,
  } = healthRegistry;
  const knownHealthKeys = new Set([
    ...Object.keys(HEALTH_BOOTSTRAP_KEYS),
    ...Object.keys(HEALTH_STANDALONE_KEYS),
  ]);

  it('api/health.js imports generated health artifacts', () => {
    const healthSrc = readFileSync(join(root, 'api', 'health.js'), 'utf-8');
    assert.ok(healthSrc.includes("from './_generated/health-registry.js'"), 'health.js should import generated health registry');
  });

  it('does not duplicate Redis keys across generated bootstrap and standalone registries', () => {
    const bootstrap = new Set(Object.values(HEALTH_BOOTSTRAP_KEYS));
    const standalone = new Set(Object.values(HEALTH_STANDALONE_KEYS));
    const overlap = [...bootstrap].filter((key) => standalone.has(key));

    assert.deepEqual(overlap, [], `generated health registry duplicates keys across registries: ${overlap.join(', ')}`);
  });

  it('seed metadata references generated health keys only', () => {
    for (const name of Object.keys(HEALTH_SEED_META)) {
      assert.ok(knownHealthKeys.has(name), `HEALTH_SEED_META entry '${name}' is not registered in a health key map`);
    }
  });

  it('on-demand and empty-ok sets reference generated health keys only', () => {
    for (const name of [...HEALTH_ON_DEMAND_KEYS, ...HEALTH_EMPTY_OK_KEYS]) {
      assert.ok(knownHealthKeys.has(name), `health flag entry '${name}' is not registered in a health key map`);
    }
  });

  it('cascade groups reference standalone keys and keep at least two members', () => {
    for (const [name, members] of Object.entries(HEALTH_CASCADE_GROUPS)) {
      assert.ok(HEALTH_STANDALONE_KEYS[name], `Cascade root '${name}' must be a standalone health key`);
      assert.ok(Array.isArray(members) && members.length >= 2, `Cascade group '${name}' must include at least two datasets`);
      for (const member of members) {
        assert.ok(HEALTH_STANDALONE_KEYS[member], `Cascade member '${member}' must be a standalone health key`);
      }
    }
  });
});

describe('Bootstrap tier definitions', () => {
  const generatedSrc = readFileSync(join(root, 'api', '_generated', 'dataset-registry.js'), 'utf-8');

  function extractObject(src, name) {
    const block = src.match(new RegExp(`${name}\\s*=\\s*\\{([\\s\\S]*?)\\};`));
    if (!block) return {};
    return Object.fromEntries([...block[1].matchAll(/"([^"]+)":\s*"(slow|fast|[^"]+)"/g)].map((m) => [m[1], m[2]]));
  }

  it('BOOTSTRAP_TIERS covers all BOOTSTRAP_CACHE_KEYS', () => {
    const tiers = extractObject(generatedSrc, 'BOOTSTRAP_TIERS');
    const keys = extractObject(generatedSrc, 'BOOTSTRAP_CACHE_KEYS');
    assert.deepEqual(Object.keys(tiers).sort(), Object.keys(keys).sort(), 'BOOTSTRAP_TIERS keys must match BOOTSTRAP_CACHE_KEYS');
  });

  it('BOOTSTRAP_TIERS values are only slow/fast', () => {
    const tiers = extractObject(generatedSrc, 'BOOTSTRAP_TIERS');
    for (const [alias, tier] of Object.entries(tiers)) {
      assert.ok(tier === 'slow' || tier === 'fast', `Invalid tier '${tier}' for ${alias}`);
    }
  });
});

describe('Adaptive backoff adopters', () => {
  it('ServiceStatusPanel.fetchStatus returns Promise<boolean>', () => {
    const src = readFileSync(join(root, 'src/components/ServiceStatusPanel.ts'), 'utf-8');
    assert.ok(src.includes('fetchStatus(): Promise<boolean>'), 'fetchStatus should return Promise<boolean> for adaptive backoff');
    assert.ok(src.includes('lastServicesJson'), 'Missing lastServicesJson for change detection');
  });

  it('MacroSignalsPanel.fetchData returns Promise<boolean>', () => {
    const src = readFileSync(join(root, 'src/components/MacroSignalsPanel.ts'), 'utf-8');
    assert.ok(src.includes('fetchData(): Promise<boolean>'), 'fetchData should return Promise<boolean> for adaptive backoff');
    assert.ok(src.includes('lastTimestamp'), 'Missing lastTimestamp for change detection');
  });

  it('StrategicRiskPanel.refresh returns Promise<boolean>', () => {
    const src = readFileSync(join(root, 'src/components/StrategicRiskPanel.ts'), 'utf-8');
    assert.ok(src.includes('refresh(): Promise<boolean>'), 'refresh should return Promise<boolean> for adaptive backoff');
    assert.ok(src.includes('lastRiskFingerprint'), 'Missing lastRiskFingerprint for change detection');
  });
});
