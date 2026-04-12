# Distributed Cache-Fill Coordinator (Fork-first)

The fork uses a miss-only, allowlist-only distributed cache-fill coordinator in `server/_shared/redis.ts` to suppress cross-instance duplicate fetches after the dataset registry phase is stable.

This is phase two of the registry work, not an independent optimization track. The coordinator consumes generated `cacheFill` policy from `registry/datasets.ts` and only applies to keys that are explicitly emitted into `server/_shared/_generated/cache-fill-registry.ts`.

## Why this design is stricter than the original sketch

- The lock key is derived from the final prefixed Redis key, so preview and production environments do not collide.
- The reliable Redis publish path and the coordinator core can land in the same fork slice because both changes live in `server/_shared/redis.ts` and the same cache test surface.
- Token-safe unlock is part of the core implementation, not a later hardening pass.
- Generated policy presence is the enablement gate at runtime. The server artifact exports only enabled entries, so there is no second runtime `enabled` flag to drift.
- Redis coordination failures degrade to the legacy local singleflight path instead of changing handler correctness semantics.
- Structured JSON logs are mandatory before rollout so Vercel and Railway runtime logs can show leader, follower, timeout, hedge, and lock-error outcomes.

## Runtime contract

1. Read the Redis key normally.
2. Return immediately on value hit or negative sentinel hit.
3. Join the local `inflight` promise when the same process is already filling the key.
4. If generated policy exists, attempt `SET lockKey token NX PX leaseMs`.
5. If the lock is acquired, recheck the cache before any leader fetch.
6. Publish the fetched result or the negative sentinel through the body-based Redis command path.
7. Release the lock only if the stored token still matches.
8. If the lock is not acquired, poll the data key with jitter until value, sentinel, or timeout.
9. If timeout is reached:
   - `return_null` returns `null`
   - `throw` raises a cache-fill timeout error
   - `hedge` attempts the lock one more time before any fallback fetch

## Generated policy invariants

`registry/datasets.ts` is the authored source. `scripts/generate-dataset-registry.ts` enforces:

- `waitMs < leaseMs`
- `pollMinMs > 0`
- `pollMaxMs >= pollMinMs`
- `pollMaxMs < waitMs`
- enabled policy must include `leaseMs`, `waitMs`, `pollMinMs`, `pollMaxMs`, and `fallback`

Only enabled policies are emitted into `server/_shared/_generated/cache-fill-registry.ts`.

## First allowlist

The first rollout is intentionally narrow:

- `infra:service-statuses:v1` / `serviceStatuses`
  Shared operational digest with existing module-cache fallback.
- `risk:scores:sebuf:v1` / `riskScoresLive`
  Shared derived snapshot with existing stale/empty fallback semantics.

Initial policy values:

- `serviceStatuses`: `leaseMs=12000`, `waitMs=3000`, `pollMinMs=75`, `pollMaxMs=175`, `fallback='return_null'`
- `riskScoresLive`: `leaseMs=15000`, `waitMs=4000`, `pollMinMs=100`, `pollMaxMs=250`, `fallback='return_null'`

Excluded from the first rollout:

- `summarize-article` keys
- `tp:*` travel keys
- highly parameterized or user-scoped cache keys

## Observability

The coordinator emits flat JSON log events suitable for Vercel runtime logs and Railway log queries:

- `cache_hit`
- `cache_fill_leader`
- `cache_fill_follower_hit`
- `cache_fill_follower_timeout`
- `cache_fill_hedge`
- `cache_fill_lock_error`

Useful fields include:

- `logicalName`
- `key`
- `leaseMs`
- `waitMs`
- `pollMinMs`
- `pollMaxMs`
- `fallback`
- `elapsedMs`
- `phase`
- `operation`
- `hedged`
- `sentinel`
- `nullResult`

## Handler impact

No handler-level allowlist literals are used. Enablement stays in `registry/datasets.ts`.

The first two rollout keys keep their existing stale/local fallback behavior:

- `list-service-statuses` still falls back to `fallbackStatusesCache`
- `get-risk-scores` still falls back to stale cache or an empty response

Callers of `cachedFetchJsonWithMeta()` should treat distributed follower hits as `source: 'cache'`, because the winning value came from Redis rather than a local fetcher execution.

## Explicit follow-up

`server/worldmonitor/infrastructure/v1/list-temporal-anomalies.ts` still owns a handler-local Redis lock outside the shared coordinator. That endpoint is intentionally tracked as a separate follow-up so the first cache-fill rollout does not silently absorb unrelated locking behavior.

## Validation

Run these checks locally before opening a PR:

- `npm run registry:generate`
- `npm run registry:check`
- `node --test tests/redis-caching.test.mjs`
- `npm run typecheck`
- `npm run typecheck:api`
- `npm run test:data`

## Fork issue flow

- `#14` `Architecture: distributed cache-fill coordinator rollout in fork`
- `#15` `C1: cache-fill coordinator foundation in fork`
- `#16` `C2: enable coordinator for service statuses and risk scores`
- `#17` `C3: measure and tune cache-fill coordinator outcomes`
- `#18` `C4: migrate temporal anomalies off ad hoc Redis lock`
