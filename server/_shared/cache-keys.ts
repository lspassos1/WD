// ── Story persistence tracking keys (E3) ─────────────────────────────────────
// Hash: firstSeen, lastSeen, mentionCount, sourceCount, currentScore, peakScore, title, link, severity, lang
export const STORY_TRACK_KEY_PREFIX = 'story:track:v1:';
// Set: unique feed names that have mentioned this story
export const STORY_SOURCES_KEY_PREFIX = 'story:sources:v1:';
// Sorted set: single member "peak" with score = highest importanceScore seen
export const STORY_PEAK_KEY_PREFIX = 'story:peak:v1:';
// Sorted set: accumulator for digest mode notifications (score = pubDate epoch ms)
export const DIGEST_ACCUMULATOR_KEY_PREFIX = 'digest:accumulator:v1:';
// TTL for all story tracking keys (48 hours)
export const STORY_TRACKING_TTL_S = 172800;

/**
 * Story tracking keys — written by list-feed-digest.ts, read by digest cron (E2).
 * All keys use 32-char SHA-256 hex prefix of the normalised title as ${titleHash}.
 *
 *   story:track:v1:${titleHash}     Hash   firstSeen/lastSeen/title/link/severity/mentionCount/currentScore/lang
 *   story:sources:v1:${titleHash}   Set    feed IDs (SADD per appearance)
 *   story:peak:v1:${titleHash}      ZSet   single member "peak", score = highest importanceScore (ZADD GT)
 *   digest:accumulator:v1:${variant}:${lang} ZSet  member=titleHash, score=lastSeen_ms (updated every appearance)
 *
 * TTL for all: 172800s (48h), refreshed each digest cycle.
 * Shadow scoring key (written by notification-relay.cjs):
 *   shadow:score-log:v1            ZSet   score=epoch_ms, member=JSON{importanceScore,severity,title,wouldNotify}
 */
export const STORY_TRACK_KEY = (titleHash: string) => `story:track:v1:${titleHash}`;
export const STORY_SOURCES_KEY = (titleHash: string) => `story:sources:v1:${titleHash}`;
export const STORY_PEAK_KEY = (titleHash: string) => `story:peak:v1:${titleHash}`;
export const DIGEST_ACCUMULATOR_KEY = (variant: string, lang = 'en') => `digest:accumulator:v1:${variant}:${lang}`;
export const DIGEST_LAST_SENT_KEY = (userId: string, variant: string) => `digest:last-sent:v1:${userId}:${variant}`;
export const SHADOW_SCORE_LOG_KEY = 'shadow:score-log:v1';
export const STORY_TTL = 604800;           // 7 days — enough for sustained multi-day stories
export const DIGEST_ACCUMULATOR_TTL = 172800; // 48h — lookback window for digest content

/**
 * Shared Redis pointer keys for simulation artifacts.
 * Defined here so TypeScript handlers and seed scripts agree on the exact string.
 * The MJS seed script keeps its own copy (cannot import TS source directly).
 */
export const SIMULATION_OUTCOME_LATEST_KEY = 'forecast:simulation-outcome:latest';
export const SIMULATION_PACKAGE_LATEST_KEY = 'forecast:simulation-package:latest';
export const REGULATORY_ACTIONS_KEY = 'regulatory:actions:v1';
export const CLIMATE_ANOMALIES_KEY = 'climate:anomalies:v2';
export const CLIMATE_AIR_QUALITY_KEY = 'climate:air-quality:v1';
export const CLIMATE_ZONE_NORMALS_KEY = 'climate:zone-normals:v1';
export const CLIMATE_CO2_MONITORING_KEY = 'climate:co2-monitoring:v1';
export const CLIMATE_OCEAN_ICE_KEY = 'climate:ocean-ice:v1';
export const CLIMATE_NEWS_KEY = 'climate:news-intelligence:v1';
export const HEALTH_AIR_QUALITY_KEY = 'health:air-quality:v1';

export const ENERGY_MIX_KEY_PREFIX = 'energy:mix:v1:';
export const ENERGY_EXPOSURE_INDEX_KEY = 'energy:exposure:v1:index';
export const GAS_STORAGE_KEY_PREFIX = 'energy:gas-storage:v1:';
export const GAS_STORAGE_COUNTRIES_KEY = 'energy:gas-storage:v1:_countries';
export const ELECTRICITY_KEY_PREFIX = 'energy:electricity:v1:';
export const ELECTRICITY_INDEX_KEY = 'energy:electricity:v1:index';
export const ENERGY_INTELLIGENCE_KEY = 'energy:intelligence:v1:feed';
export const CHOKEPOINT_FLOWS_KEY = 'energy:chokepoint-flows:v1';
export const ENERGY_SPINE_KEY_PREFIX = 'energy:spine:v1:';
export const ENERGY_SPINE_COUNTRIES_KEY = 'energy:spine:v1:_countries';
export const EMBER_ELECTRICITY_KEY_PREFIX = 'energy:ember:v1:';
export const EMBER_ELECTRICITY_ALL_KEY = 'energy:ember:v1:_all';
export const SPR_KEY = 'economic:spr:v1';
export const SPR_POLICIES_KEY = 'energy:spr-policies:v1';
export const REFINERY_UTIL_KEY = 'economic:refinery-util:v1';

/**
 * Per-country chokepoint exposure index. Request-varying — excluded from bootstrap.
 * Key: supply-chain:exposure:{iso2}:{hs2}:v1
 */
export const CHOKEPOINT_EXPOSURE_KEY = (iso2: string, hs2: string) =>
  `supply-chain:exposure:${iso2}:${hs2}:v1`;
export const CHOKEPOINT_EXPOSURE_SEED_META_KEY = 'seed-meta:supply_chain:chokepoint-exposure';

/**
 * Per-country + per-chokepoint cost shock cache.
 * NOT in bootstrap — request-varying, PRO-gated.
 */
export const COST_SHOCK_KEY = (iso2: string, chokepointId: string) =>
  `supply-chain:cost-shock:${iso2}:${chokepointId}:v1` as const;

/**
 * Per-country + per-HS2 sector dependency cache.
 * NOT in bootstrap — request-varying, PRO-gated.
 */
export const SECTOR_DEPENDENCY_KEY = (iso2: string, hs2: string) =>
  `supply-chain:sector-dep:${iso2}:${hs2}:v1` as const;

/**
 * Shared chokepoint status cache key — written by get-chokepoint-status, read by bypass-options and cost-shock handlers.
 */
export const CHOKEPOINT_STATUS_KEY = 'supply_chain:chokepoints:v4' as const;

/**
 * Static cache keys for the bootstrap endpoint.
 * Only keys with NO request-varying suffixes are included.
 */
export { BOOTSTRAP_CACHE_KEYS, BOOTSTRAP_TIERS } from './_generated/bootstrap-registry';

export const PORTWATCH_PORT_ACTIVITY_KEY_PREFIX = 'supply_chain:portwatch-ports:v1:';
export const PORTWATCH_PORT_ACTIVITY_COUNTRIES_KEY = 'supply_chain:portwatch-ports:v1:_countries';
export const PORTWATCH_CHOKEPOINTS_REF_KEY = 'portwatch:chokepoints:ref:v1';
