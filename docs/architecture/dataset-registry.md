# Dataset Registry (Fork-first)

The fork now uses `registry/datasets.ts` as the single authored source of truth for bootstrap and health dataset contracts.

## Workflow

1. Edit `registry/datasets.ts`.
2. Run `npm run registry:generate`.
3. Commit the source file plus all generated runtime artifacts:
   - `server/_shared/_generated/bootstrap-registry.ts`
   - `api/_generated/dataset-registry.js`
   - `api/_generated/health-registry.js`
4. Do not hand-edit generated files. CI treats drift as a build-breaking defect.

## Validation

Run these checks locally before opening a PR:

- `npm run registry:check`
- `node --test tests/bootstrap.test.mjs`
- `node --test tests/edge-functions.test.mjs`
- `npm run test:data`
- `npm run typecheck`
- `npm run typecheck:api`

`registry:check` now runs in the local pre-push hook and in `.github/workflows/typecheck.yml`.

## Generated artifacts

- `api/_generated/dataset-registry.js`
  Edge-safe bootstrap alias map and bootstrap tier map.
- `api/_generated/health-registry.js`
  Edge-safe health bootstrap keys, standalone keys, seed metadata, on-demand keys, empty-ok keys, and cascade groups.
- `server/_shared/_generated/bootstrap-registry.ts`
  Server-safe canonical bootstrap registry export.

## Contribution path

New datasets must be added through `registry/datasets.ts` only. The registry generator is responsible for projecting that source into Edge-safe and server-safe outputs. Manual runtime registration in `api/bootstrap.js`, `api/health.js`, or `server/_shared/cache-keys.ts` is no longer the supported path.

## Fork-first issue and PR lineage

Use the fork as the proving ground before proposing anything upstream.

- R0: tracking issue for the full rollout, invariants, and upstream-readiness criteria.
- R1: bootstrap parity and registry foundation stabilization.
- R2: generated health parity and `api/health.js` migration.
- R3: CI and pre-push freshness enforcement.
- R4: docs and contributor workflow updates.

Recommended PR sequence:

- `chore(registry): stabilize dataset contract foundation and bootstrap parity`
- `refactor(health): load generated health registry in fork`
- `ci(registry): enforce generated registry freshness in fork`
- `docs(registry): document full dataset workflow`
