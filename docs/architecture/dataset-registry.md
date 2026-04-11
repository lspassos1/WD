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
- `node --test tests/market-breadth.test.mjs`
- `node --test tests/customs-revenue.test.mjs`
- `node --test tests/resilience-static-seed.test.mjs`
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

## Fork-first issue and PR flow

Use the fork as the proving ground before proposing anything upstream.

- Track the rollout in one detailed issue: `#5`.
- Prefer several small PRs over one combined migration PR.
- Keep each PR narrow enough that the validation list is obvious from the diff.

Current stacked sequence in the fork:

- `#10` `chore(registry): stabilize dataset contract foundation and bootstrap parity`
- `#11` `refactor(health): load generated health registry in fork`
- `#12` `ci(registry): enforce generated registry freshness in fork`
- docs PR: update the contribution path and validation guidance after the code slices land
