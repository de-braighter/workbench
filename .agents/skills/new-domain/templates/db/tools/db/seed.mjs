import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv, REPO_ROOT } from './env.mjs';

const env = loadEnv();
const migrateUrl = env['DATABASE_URL_MIGRATE'] ?? process.env['DATABASE_URL_MIGRATE'];

if (!migrateUrl) {
  console.error('[db:seed] DATABASE_URL_MIGRATE not set (.env missing or incomplete).');
  process.exit(1);
}

const apiDir = resolve(REPO_ROOT, 'apps', '{{DOMAIN}}-api');
const seedFile = resolve(REPO_ROOT, 'tools', 'db', 'seed.sql');
const childEnv = { ...process.env, DATABASE_URL: migrateUrl };

try {
  const cmd = `pnpm exec prisma db execute --url "${migrateUrl}" --file "${seedFile}"`;
  console.log('[db:seed] inserting {{DOMAIN}} plan tree root...');
  execSync(cmd, { cwd: apiDir, env: childEnv, stdio: 'inherit', shell: true });
  console.log('\n[db:seed] OK — kernel.plan_node root seeded.');
} catch (err) {
  console.error(`\n[db:seed] FAILED: ${err?.message ?? err}`);
  process.exit(1);
}
