// DB setup for the {{DOMAIN}} domain.
//
// Runs (in order) against DATABASE_URL_MIGRATE (admin/superuser):
//   1. app-roles.sql       — CREATE ROLE app (idempotent)
//   2. core-schema.sql     — core.pack_role_assignment + core.consent_receipt + grants
//   3. kernel-event-log.sql— kernel.event_log + kernel.outbox + RLS + append-only grants
//   4. kernel-plan-tree.sql— kernel.plan_node tree (only needed when inference tier is present)
//
// SQL scripts are shipped in @de-braighter/substrate-runtime/sql/ — this script
// resolves them by walking up from the package's main entry (same pattern as
// D:/development/projects/de-braighter/domains/herdbook/tools/db/setup.mjs).
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { loadEnv, REPO_ROOT } from './env.mjs';

const env = loadEnv();
const migrateUrl = env['DATABASE_URL_MIGRATE'] ?? process.env['DATABASE_URL_MIGRATE'];

if (!migrateUrl) {
  console.error('[db:setup] DATABASE_URL_MIGRATE not set (.env missing or incomplete).');
  process.exit(1);
}

// substrate-runtime is a dep of {{DOMAIN}}-api (apps/{{DOMAIN}}-api), so anchor resolution there.
const require = createRequire(resolve(REPO_ROOT, 'apps', '{{DOMAIN}}-api', 'package.json'));

function resolveSqlDir() {
  const entry = require.resolve('@de-braighter/substrate-runtime');
  let dir = dirname(entry);
  for (let i = 0; i < 8; i++) {
    if (existsSync(resolve(dir, 'sql', 'app-roles.sql'))) return resolve(dir, 'sql');
    dir = dirname(dir);
  }
  throw new Error('[db:setup] could not locate @de-braighter/substrate-runtime/sql');
}
const sqlDir = resolveSqlDir();

const apiDir = resolve(REPO_ROOT, 'apps', '{{DOMAIN}}-api');
const childEnv = { ...process.env, DATABASE_URL: migrateUrl };

function execFile(label, file) {
  const full = resolve(sqlDir, file);
  const cmd = `pnpm exec prisma db execute --url "${migrateUrl}" --file "${full}"`;
  console.log(`[db:setup] ${label}: ${file}`);
  execSync(cmd, { cwd: apiDir, env: childEnv, stdio: 'inherit', shell: true });
}

try {
  execFile('app-roles',         'app-roles.sql');
  execFile('core-schema',       'core-schema.sql');
  execFile('kernel-event-log',  'kernel-event-log.sql');
  // NOTE: kernel-plan-tree.sql is only needed when the inference tier is present.
  execFile('kernel-plan-tree',  'kernel-plan-tree.sql');
  console.log('\n[db:setup] OK — app role + core schema + kernel event_log + plan_tree provisioned.');
} catch (err) {
  console.error(`\n[db:setup] FAILED: ${err?.message ?? err}`);
  process.exit(1);
}
