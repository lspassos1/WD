import { mkdirSync, writeFileSync } from 'node:fs';
import { DATASETS, type DatasetContract } from '../registry/datasets';

type HealthSeedMeta = { key: string; maxStaleMin: number };

function fail(msg: string): never {
  throw new Error(`[dataset-registry] ${msg}`);
}

function hasCurrentYearPlaceholder(key: string): boolean {
  return key.includes('{currentYear}');
}

function hasMatchingVersionTag(key: string, versionTag: `v${number}`): boolean {
  const matcher = new RegExp(`(?:^|[:\\-])${versionTag}(?:$|[:])`);
  return matcher.test(key);
}

function validateDataset(d: DatasetContract): void {
  if (!d.owner?.github) {
    fail(`Missing owner.github for ${d.id}`);
  }

  if (d.redis.versionTag && !hasMatchingVersionTag(d.redis.key, d.redis.versionTag)) {
    fail(`Dataset ${d.id} has key/version mismatch`);
  }

  if (d.bootstrap) {
    if (d.bootstrap.redisReadMode !== 'unprefixed') {
      fail(`Dataset ${d.id} has invalid bootstrap.redisReadMode`);
    }
    if (!d.health) {
      fail(`Dataset ${d.id} is bootstrap-enabled but missing health contract`);
    }
    if (hasCurrentYearPlaceholder(d.redis.key)) {
      fail(`Dataset ${d.id} uses a runtime key template and cannot be bootstrap-enabled`);
    }
  }

  if (d.health) {
    const hasSeedMeta = Boolean(d.health.seedMetaKey);
    const hasMaxStaleMin = typeof d.health.maxStaleMin === 'number';
    if (hasSeedMeta !== hasMaxStaleMin) {
      fail(`Dataset ${d.id} has incomplete health freshness metadata`);
    }
  }

  if (d.cacheFill?.enabled) {
    if (!d.cacheFill.leaseMs || !d.cacheFill.waitMs) {
      fail(`Dataset ${d.id} enables cacheFill but leaseMs/waitMs are incomplete`);
    }
    if (d.cacheFill.waitMs >= d.cacheFill.leaseMs) {
      fail(`Dataset ${d.id} has invalid cache-fill timing: waitMs must be < leaseMs`);
    }
  }
}

function validateGlobal(datasets: DatasetContract[]): void {
  const ids = new Set<string>();
  const redisKeys = new Set<string>();
  const aliases = new Set<string>();
  const cascadeGroups = new Map<string, string[]>();

  for (const d of datasets) {
    validateDataset(d);

    if (ids.has(d.id)) {
      fail(`Duplicate dataset id: ${d.id}`);
    }
    ids.add(d.id);

    if (redisKeys.has(d.redis.key)) {
      fail(`Duplicate redis key: ${d.redis.key}`);
    }
    redisKeys.add(d.redis.key);

    if (d.bootstrap) {
      if (aliases.has(d.bootstrap.alias)) {
        fail(`Duplicate bootstrap alias: ${d.bootstrap.alias}`);
      }
      aliases.add(d.bootstrap.alias);
    }

    if (d.health?.cascadeGroup) {
      const members = cascadeGroups.get(d.health.cascadeGroup) ?? [];
      members.push(d.displayName);
      cascadeGroups.set(d.health.cascadeGroup, members);
    }
  }

  for (const [group, members] of cascadeGroups) {
    if (members.length < 2) {
      fail(`Dataset cascade group ${group} must include at least two datasets`);
    }
  }
}

function stable<T>(items: T[], key: (item: T) => string): T[] {
  return [...items].sort((a, b) => key(a).localeCompare(key(b)));
}

function renderKeyExpression(key: string): string {
  if (hasCurrentYearPlaceholder(key)) {
    return `\`${key.replace('{currentYear}', '${new Date().getFullYear()}')}\``;
  }
  return JSON.stringify(key);
}

function formatMap(
  entries: Array<[string, string]>,
  formatValue: (value: string) => string = (value) => JSON.stringify(value),
): string {
  if (entries.length === 0) {
    return '{}';
  }

  return `{\n${entries
    .map(([name, value]) => `  ${JSON.stringify(name)}: ${formatValue(value)},`)
    .join('\n')}\n}`;
}

function formatSeedMetaMap(entries: Array<[string, HealthSeedMeta]>): string {
  if (entries.length === 0) {
    return '{}';
  }

  return `{\n${entries
    .map(
      ([name, value]) =>
        `  ${JSON.stringify(name)}: { key: ${JSON.stringify(value.key)}, maxStaleMin: ${value.maxStaleMin} },`,
    )
    .join('\n')}\n}`;
}

function formatStringArray(values: string[]): string {
  if (values.length === 0) {
    return '[]';
  }

  return `[\n${values.map((value) => `  ${JSON.stringify(value)},`).join('\n')}\n]`;
}

function formatCascadeMap(entries: Array<[string, string[]]>): string {
  if (entries.length === 0) {
    return '{}';
  }

  return `{\n${entries
    .map(
      ([name, members]) =>
        `  ${JSON.stringify(name)}: ${formatStringArray(members).replace(/\n/g, '\n  ').trimStart()},`,
    )
    .join('\n')}\n}`;
}

function emit(): void {
  validateGlobal(DATASETS);

  const bootstrapDatasets = stable(
    DATASETS.filter((dataset) => dataset.bootstrap),
    (dataset) => dataset.bootstrap!.alias,
  );
  const healthDatasets = stable(
    DATASETS.filter((dataset) => dataset.health),
    (dataset) => dataset.displayName,
  );

  const bootstrapCacheKeys = bootstrapDatasets.map((dataset) => [dataset.bootstrap!.alias, dataset.redis.key] as const);
  const bootstrapTiers = bootstrapDatasets.map((dataset) => [dataset.bootstrap!.alias, dataset.bootstrap!.tier] as const);
  const healthBootstrapKeys = healthDatasets
    .filter((dataset) => dataset.health!.bucket === 'bootstrap')
    .map((dataset) => [dataset.displayName, dataset.redis.key] as const);
  const healthStandaloneKeys = healthDatasets
    .filter((dataset) => dataset.health!.bucket === 'standalone')
    .map((dataset) => [dataset.displayName, dataset.redis.key] as const);
  const healthSeedMeta = healthDatasets
    .filter(
      (dataset) =>
        dataset.health?.seedMetaKey && typeof dataset.health.maxStaleMin === 'number',
    )
    .map(
      (dataset) =>
        [
          dataset.displayName,
          {
            key: dataset.health!.seedMetaKey!,
            maxStaleMin: dataset.health!.maxStaleMin!,
          },
        ] as const,
    );
  const healthOnDemand = healthDatasets
    .filter((dataset) => dataset.health?.onDemand)
    .map((dataset) => dataset.displayName);
  const healthEmptyOk = healthDatasets
    .filter((dataset) => dataset.health?.emptyOk)
    .map((dataset) => dataset.displayName);

  const groupsByName = new Map<string, string[]>();
  for (const dataset of healthDatasets) {
    const cascadeGroup = dataset.health?.cascadeGroup;
    if (!cascadeGroup) {
      continue;
    }
    const members = groupsByName.get(cascadeGroup) ?? [];
    members.push(dataset.displayName);
    groupsByName.set(cascadeGroup, members);
  }

  const healthCascadeGroups = stable(
    [...groupsByName.values()].flatMap((members) => {
      const sortedMembers = [...members].sort((a, b) => a.localeCompare(b));
      return sortedMembers.map((name) => [name, sortedMembers] as const);
    }),
    ([name]) => name,
  );

  mkdirSync('server/_shared/_generated', { recursive: true });
  mkdirSync('api/_generated', { recursive: true });

  writeFileSync(
    'server/_shared/_generated/bootstrap-registry.ts',
    [
      '/* AUTO-GENERATED by scripts/generate-dataset-registry.ts. DO NOT EDIT. */',
      `export const BOOTSTRAP_CACHE_KEYS: Record<string, string> = ${formatMap(bootstrapCacheKeys, renderKeyExpression)};`,
      `export const BOOTSTRAP_TIERS: Record<string, 'slow' | 'fast'> = ${formatMap(bootstrapTiers)};`,
      '',
    ].join('\n'),
  );

  writeFileSync(
    'api/_generated/dataset-registry.js',
    [
      '/* AUTO-GENERATED by scripts/generate-dataset-registry.ts. DO NOT EDIT. */',
      `export const BOOTSTRAP_CACHE_KEYS = ${formatMap(bootstrapCacheKeys, renderKeyExpression)};`,
      `export const BOOTSTRAP_TIERS = ${formatMap(bootstrapTiers)};`,
      '',
    ].join('\n'),
  );

  writeFileSync(
    'api/_generated/health-registry.js',
    [
      '/* AUTO-GENERATED by scripts/generate-dataset-registry.ts. DO NOT EDIT. */',
      `export const HEALTH_BOOTSTRAP_KEYS = ${formatMap(healthBootstrapKeys, renderKeyExpression)};`,
      `export const HEALTH_STANDALONE_KEYS = ${formatMap(healthStandaloneKeys, renderKeyExpression)};`,
      `export const HEALTH_SEED_META = ${formatSeedMetaMap(healthSeedMeta)};`,
      `export const HEALTH_ON_DEMAND_KEYS = ${formatStringArray([...healthOnDemand].sort())};`,
      `export const HEALTH_EMPTY_OK_KEYS = ${formatStringArray([...healthEmptyOk].sort())};`,
      `export const HEALTH_CASCADE_GROUPS = ${formatCascadeMap(healthCascadeGroups)};`,
      '',
    ].join('\n'),
  );
}

emit();
