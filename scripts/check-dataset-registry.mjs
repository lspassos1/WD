import { execSync } from 'node:child_process';

execSync('npx tsx scripts/generate-dataset-registry.ts', { stdio: 'inherit' });

try {
  execSync('git diff --exit-code -- registry/datasets.ts api/_generated/dataset-registry.js api/_generated/health-registry.js server/_shared/_generated/bootstrap-registry.ts', { stdio: 'pipe' });
} catch {
  console.error('[dataset-registry] generated artifacts are out of date. Run: npm run registry:generate');
  process.exit(1);
}
