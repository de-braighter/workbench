# Markets Phase 2b — DB Foundation + Ingestion Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Phase 2a's adapters + observations to a real Postgres database: stand up the substrate DB (port 5455), add `SubstrateModule.forRoot` + `GucPrismaRunner` + `DOMAIN_EVENT_PUBLISHER`, build `PriceIngestionService` (30-second auto-poll + `POST /ingest` manual trigger), and live-verify that `POST /ingest` writes three `markets:PriceObservation.v1` rows to `kernel.event_log`.

**Architecture:** NestJS `AppModule` is the composition root. `SubstrateModule.forRoot` with `prismaClient: appRoleClient` binds `DOMAIN_EVENT_PUBLISHER → PrismaOutboxWriter`. `GucPrismaRunner` is a value provider wrapping the same app-role client. `PriceIngestionService` calls `CoinGeckoAdapter.fetch()` → `toObservationEnvelopes()` → `runner.run(tenantPackId, tx => publisher.publishAll(envelopes, tx))`. A `@Interval(30_000)` decorator schedules automatic polling; `POST /ingest` is the manual override.

**Precondition:** Phase 2a merged (`captureProvenance`, `deriveHealth`, `capConfidence`, `CoinGeckoAdapter`, `FixtureAdapter`, `toObservationEnvelopes` all in `markets-pack` and `source-spine`).

**Tech Stack:** NestJS 10, `@nestjs/schedule` ^4.0, `@de-braighter/substrate-runtime` ^0.19.0, `@prisma/client` ^6, Prisma CLI ^6, Postgres 16 (Docker, port 5455), TypeScript 5.4 (NodeNext ESM), Vitest 1.6.1.

**Spec:** `docs/superpowers/specs/2026-06-03-markets-phase2-spine-ingestion-design.md`

**Repo:** `D:/development/projects/de-braighter/domains/markets/`

**DB env vars:**
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5455/markets          # admin/owner
DATABASE_URL_MIGRATE=postgresql://postgres:postgres@localhost:5455/markets  # same for setup
SUBSTRATE_APP_DATABASE_URL=postgresql://app:app@localhost:5455/markets     # RLS app role
MARKETS_TENANT_PACK_ID=10000000-0000-4001-8000-000000000001                 # demo tenant UUID
```

**Pattern reference:** `D:/development/projects/de-braighter/domains/herdbook/tools/db/setup.mjs` — markets mirrors this pattern (minus pedigree-schema, minus pack migrations, minus seed).

---

## File Structure

```
domains/markets/
├── docker-compose.yml                         ← new: Postgres 16 on port 5455
├── .env.example                               ← new: env var template
├── package.json                               ← modified: db:start, db:setup, ci:local:db scripts
├── tools/db/
│   ├── env.mjs                                ← new: .env loader (copied from herdbook pattern)
│   └── setup.mjs                              ← new: runs substrate SQL + notes no pack migrations
└── apps/markets-api/
    ├── package.json                           ← modified: add substrate-runtime, @nestjs/schedule, prisma deps
    ├── tsconfig.json                          ← modified: ensure reflect-metadata in types
    ├── prisma/
    │   └── schema.prisma                      ← new: minimal (connection only, no pack tables yet)
    └── src/
        ├── config/
        │   ├── tenants.ts                     ← new: MARKETS_TENANT_ID, MARKETS_TENANT_PACK_ID, MARKETS_TENANTS
        │   └── manifest.ts                    ← new: MARKETS_MANIFEST (PackManifest)
        ├── ingestion/
        │   ├── price-ingestion.service.ts     ← new: ingest() + @Interval(30_000) scheduledIngest()
        │   ├── price-ingestion.service.spec.ts← new: TDD with mocked deps
        │   ├── ingestion.controller.ts        ← new: POST /ingest
        │   └── ingestion.controller.spec.ts   ← new: TDD
        └── app/
            └── app.module.ts                  ← modified: add SubstrateModule, ScheduleModule, providers
```

---

## Task 1: `docker-compose.yml` + `.env.example`

**Files:**
- Create: `docker-compose.yml` (at repo root `domains/markets/`)
- Create: `.env.example`

- [ ] **Step 1: Write `docker-compose.yml`**

`D:/development/projects/de-braighter/domains/markets/docker-compose.yml`:
```yaml
services:
  markets-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: markets
    ports:
      - "5455:5432"
    volumes:
      - markets-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  markets-db-data:
```

- [ ] **Step 2: Write `.env.example`**

`D:/development/projects/de-braighter/domains/markets/.env.example`:
```
# Copy to .env and fill in values. .env is gitignored.

# Admin/owner URL (used by db:setup to run DDL as postgres superuser)
DATABASE_URL_MIGRATE=postgresql://postgres:postgres@localhost:5455/markets

# Runtime URL for the Prisma client (admin — used by NestJS on startup for now)
DATABASE_URL=postgresql://postgres:postgres@localhost:5455/markets

# RLS-scoped non-superuser role (used by GucPrismaRunner for all event writes)
SUBSTRATE_APP_DATABASE_URL=postgresql://app:app@localhost:5455/markets

# Demo tenant+pack identity (UUID used as GUC + DomainEventEnvelope.tenantPackId)
MARKETS_TENANT_PACK_ID=10000000-0000-4001-8000-000000000001
```

- [ ] **Step 3: Verify .env.example is not gitignored**

Check `D:/development/projects/de-braighter/domains/markets/.gitignore`. It should contain `.env.local` and `.env.*.local` but NOT `.env.example` (that's the allowed exception). Confirm the exception is in place.

- [ ] **Step 4: Copy `.env.example` to `.env` locally**

```bash
cd D:/development/projects/de-braighter/domains/markets
cp .env.example .env
```
`.env` is gitignored — never commit it.

- [ ] **Step 5: Start the DB and verify it's healthy**

```bash
cd D:/development/projects/de-braighter/domains/markets
docker compose up -d markets-db
docker compose ps
```
Expected: `markets-db` shows `healthy` (or `running` if healthcheck not yet triggered). Wait ~10s if needed.

- [ ] **Step 6: Commit docker-compose + .env.example**

```bash
git add docker-compose.yml .env.example
git commit -m "chore(db): docker-compose (postgres:16 on :5455) + .env.example

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: DB setup scripts

**Files:**
- Create: `tools/db/env.mjs`
- Create: `tools/db/setup.mjs`
- Modify: `package.json` (root workspace)

- [ ] **Step 1: Write `tools/db/env.mjs`**

`D:/development/projects/de-braighter/domains/markets/tools/db/env.mjs`:
```javascript
// Minimal .env loader — reads KEY=VALUE lines, no external deps.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');

export function loadEnv(path = resolve(REPO_ROOT, '.env')) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}
```

- [ ] **Step 2: Write `tools/db/setup.mjs`**

`D:/development/projects/de-braighter/domains/markets/tools/db/setup.mjs`:
```javascript
// DB setup for the markets domain.
//
// Runs (in order) against DATABASE_URL_MIGRATE (admin/superuser):
//   1. app-roles.sql       — CREATE ROLE app (idempotent)
//   2. core-schema.sql     — core.pack_role_assignment + core.consent_receipt + grants
//   3. kernel-event-log.sql— kernel.event_log + kernel.outbox + RLS + append-only grants
//
// No pack migrations in Phase 2 (markets has no pack-specific tables yet).
// No seed in Phase 2 (just write events via POST /ingest).
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

// substrate-runtime is a dep of markets-api (apps/markets-api), so anchor resolution there.
const require = createRequire(resolve(REPO_ROOT, 'apps', 'markets-api', 'package.json'));

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

const apiDir = resolve(REPO_ROOT, 'apps', 'markets-api');
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
  console.log('\n[db:setup] OK — app role + core schema + kernel event_log provisioned.');
} catch (err) {
  console.error(`\n[db:setup] FAILED: ${err?.message ?? err}`);
  process.exit(1);
}
```

- [ ] **Step 3: Add `db:start` and `db:setup` scripts to root `package.json`**

Edit `D:/development/projects/de-braighter/domains/markets/package.json`. Replace the `"scripts"` block:
```json
"scripts": {
  "build":       "pnpm -r run build",
  "test":        "pnpm -r run test",
  "typecheck":   "pnpm -r run typecheck",
  "ci:local":    "pnpm run build && pnpm run typecheck && pnpm run test",
  "db:start":    "docker compose up -d markets-db",
  "db:setup":    "node tools/db/setup.mjs",
  "ci:local:db": "pnpm run db:start && pnpm run db:setup && pnpm run ci:local"
}
```

- [ ] **Step 4: Run `db:setup` to provision the DB**

```bash
cd D:/development/projects/de-braighter/domains/markets
```

First, `markets-api` must be installed so prisma CLI is available:
```bash
pnpm install
```

Then run setup (DB must be running from Task 1):
```bash
pnpm run db:setup
```
Expected output:
```
[db:setup] app-roles: app-roles.sql
[db:setup] core-schema: core-schema.sql
[db:setup] kernel-event-log: kernel-event-log.sql

[db:setup] OK — app role + core schema + kernel event_log provisioned.
```

If it fails with "could not locate substrate-runtime/sql", ensure `pnpm install` was run in `apps/markets-api/` first (the dep must be installed there).

- [ ] **Step 5: Verify tables exist**

```bash
docker exec markets-markets-db-1 psql -U postgres -d markets -c "\dt kernel.*"
```
Expected: `kernel.event_log`, `kernel.outbox` listed.

- [ ] **Step 6: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add tools/ package.json
git commit -m "chore(db): setup script — provisions app-role + core + kernel event_log from substrate-runtime/sql

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Add Phase 2b deps to `markets-api/package.json` + Prisma schema

**Files:**
- Modify: `apps/markets-api/package.json`
- Create: `apps/markets-api/prisma/schema.prisma`
- Modify: `apps/markets-api/tsconfig.json` (verify reflect-metadata)

- [ ] **Step 1: Update `apps/markets-api/package.json`**

Replace the `"dependencies"` and `"devDependencies"` blocks:
```json
{
  "name": "@de-braighter/markets-api",
  "version": "0.0.0",
  "private": true,
  "description": "Markets NestJS host. Phase 1: GET /health. Phase 2: POST /ingest with @Interval scheduler. Phase 3 adds GET /readout.",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "start": "node --import tsx src/main.ts",
    "db:generate": "prisma generate --schema prisma/schema.prisma"
  },
  "dependencies": {
    "@de-braighter/markets-pack": "workspace:*",
    "@de-braighter/substrate-contracts": "^0.14.0",
    "@de-braighter/substrate-runtime": "^0.19.0",
    "@nestjs/common": "^10.4.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-express": "^10.4.0",
    "@nestjs/schedule": "^4.0.0",
    "@prisma/client": "^6.0.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/testing": "^10.4.0",
    "prisma": "^6.0.0",
    "tsx": "^4.7.0"
  }
}
```

- [ ] **Step 2: Write `apps/markets-api/prisma/schema.prisma`**

Phase 2 has no pack-specific tables — all observations go to `kernel.event_log` via the substrate runtime. The schema only declares the connection:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

- [ ] **Step 3: Install deps and generate Prisma client**

```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm install
cd apps/markets-api
pnpm run db:generate
```
Expected: Prisma client generated under `node_modules/@prisma/client`.

- [ ] **Step 4: Verify `tsconfig.json` has `reflect-metadata` in types**

Read `apps/markets-api/tsconfig.json`. Ensure `"types": ["node", "reflect-metadata"]` is present. It was set in Phase 1 — confirm it's still there.

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add apps/markets-api/package.json apps/markets-api/prisma/schema.prisma pnpm-lock.yaml
git commit -m "chore(markets-api): add substrate-runtime + @nestjs/schedule + prisma deps

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Config — `tenants.ts` + `manifest.ts`

**Files:**
- Create: `apps/markets-api/src/config/tenants.ts`
- Create: `apps/markets-api/src/config/manifest.ts`

No tests needed — pure config constants.

- [ ] **Step 1: Write `tenants.ts`**

`apps/markets-api/src/config/tenants.ts`:
```typescript
import type { TenantDescriptor } from '@de-braighter/substrate-runtime';
import { PACK_ID } from '@de-braighter/markets-pack';

/** Stable tenant identity for the de-braighter/markets demo. */
export const MARKETS_TENANT_ID = '10000000-0000-4000-8000-000000000001' as const;

/**
 * The tenant_pack_id set as the RLS GUC by GucPrismaRunner.
 * Also the value in every DomainEventEnvelope.tenantPackId written by this app.
 * Must be a valid UUID string (the kernel.event_log RLS policy compares it
 * against current_setting('app.tenant_pack_id', true)).
 */
export const MARKETS_TENANT_PACK_ID: string =
  process.env['MARKETS_TENANT_PACK_ID'] ?? '10000000-0000-4001-8000-000000000001';

export const MARKETS_TENANTS: readonly TenantDescriptor[] = Object.freeze([
  Object.freeze({
    tenantId: MARKETS_TENANT_ID,
    displayName: 'Markets demo tenant',
    registeredPacks: Object.freeze([PACK_ID]),
  }),
]);
```

- [ ] **Step 2: Write `manifest.ts`**

`apps/markets-api/src/config/manifest.ts`:
```typescript
import type { PackManifest } from '@de-braighter/substrate-contracts';
import { PACK_ID } from '@de-braighter/markets-pack';

export const MARKETS_MANIFEST: PackManifest = {
  packId: PACK_ID,
  roles: [],
  permissions: [],
  consentPurposes: [],
};
```

- [ ] **Step 3: Typecheck config files**

```bash
cd D:/development/projects/de-braighter/domains/markets/apps/markets-api
pnpm run typecheck
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add apps/markets-api/src/config/
git commit -m "feat(markets-api): tenant + manifest config for SubstrateModule.forRoot

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `PriceIngestionService` (TDD)

**Files:**
- Create: `apps/markets-api/src/ingestion/price-ingestion.service.spec.ts`
- Create: `apps/markets-api/src/ingestion/price-ingestion.service.ts`

**Note:** Build `markets-pack` first so imports resolve: `cd D:/development/projects/de-braighter/domains/markets && pnpm run build`

- [ ] **Step 1: Write the failing test**

`apps/markets-api/src/ingestion/price-ingestion.service.spec.ts`:
```typescript
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { PriceIngestionService } from './price-ingestion.service.js';
import { DOMAIN_EVENT_PUBLISHER } from '@de-braighter/substrate-contracts';
import { GucPrismaRunner } from '@de-braighter/substrate-runtime';
import { CoinGeckoAdapter } from '@de-braighter/markets-pack';
import type { SourceResult } from '@de-braighter/markets-source-spine';
import type { CoinGeckoPricePayload } from '@de-braighter/markets-pack';

const RECENT_UNIX = Math.floor(Date.now() / 1000) - 10;

const OK_RESULT: SourceResult<CoinGeckoPricePayload> = {
  ok: true,
  value: {
    payload: {
      bitcoin:  { usd: 67_000, last_updated_at: RECENT_UNIX },
      ethereum: { usd: 3_500,  last_updated_at: RECENT_UNIX },
      cardano:  { usd: 0.45,   last_updated_at: RECENT_UNIX },
    },
    provenance: {
      sourceId: 'coingecko',
      fetchedAt: new Date().toISOString(),
      payloadHash: 'abc123',
    },
  },
};

const ERR_RESULT: SourceResult<CoinGeckoPricePayload> = {
  ok: false,
  error: { kind: 'unreachable', detail: 'network error' },
};

describe('PriceIngestionService', () => {
  let publishAll: ReturnType<typeof vi.fn>;
  let runnerRun: ReturnType<typeof vi.fn>;
  let adapterFetch: ReturnType<typeof vi.fn>;

  async function buildService(
    fetchResult: SourceResult<CoinGeckoPricePayload>,
  ): Promise<PriceIngestionService> {
    publishAll = vi.fn().mockResolvedValue(undefined);
    runnerRun = vi.fn().mockImplementation(
      async (_tenantPackId: string, callback: (tx: object) => Promise<void>) => {
        await callback({});
      },
    );
    adapterFetch = vi.fn().mockResolvedValue(fetchResult);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PriceIngestionService,
        { provide: DOMAIN_EVENT_PUBLISHER, useValue: { publishAll } },
        { provide: GucPrismaRunner, useValue: { run: runnerRun } },
        {
          provide: CoinGeckoAdapter,
          useValue: {
            fetch: adapterFetch,
            descriptor: { latencyBudgetMs: 120_000, required: true },
          },
        },
      ],
    }).compile();

    return moduleRef.get(PriceIngestionService);
  }

  it('returns observed:3, health:online, confidence:1 on successful fetch', async () => {
    const service = await buildService(OK_RESULT);
    const result = await service.ingest();

    expect(result.observed).toBe(3);
    expect(result.health).toBe('online');
    expect(result.confidence).toBe(1);
    expect(result.error).toBeUndefined();
  });

  it('calls publishAll with exactly 3 envelopes of type markets:PriceObservation.v1', async () => {
    const service = await buildService(OK_RESULT);
    await service.ingest();

    expect(publishAll).toHaveBeenCalledOnce();
    const [envelopes] = publishAll.mock.calls[0] as [Array<unknown>];
    expect(envelopes).toHaveLength(3);
    for (const env of envelopes) {
      expect((env as Record<string, unknown>)['eventType']).toBe('markets:PriceObservation.v1');
    }
  });

  it('calls runner.run with the demo tenantPackId', async () => {
    const service = await buildService(OK_RESULT);
    await service.ingest();

    expect(runnerRun).toHaveBeenCalledOnce();
    const [calledTenantPackId] = runnerRun.mock.calls[0] as [string];
    // Must be a non-empty string UUID
    expect(calledTenantPackId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns observed:0, confidence:0 and does NOT call publishAll on adapter failure', async () => {
    const service = await buildService(ERR_RESULT);
    const result = await service.ingest();

    expect(result.observed).toBe(0);
    expect(result.confidence).toBe(0);
    expect(result.error).toEqual({ kind: 'unreachable', detail: 'network error' });
    expect(publishAll).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm run build  # ensure markets-pack dist is current
cd apps/markets-api
pnpm run test
```
Expected: FAIL with `Cannot find module './price-ingestion.service.js'`

- [ ] **Step 3: Write `price-ingestion.service.ts`**

`apps/markets-api/src/ingestion/price-ingestion.service.ts`:
```typescript
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '@de-braighter/substrate-contracts';
import { GucPrismaRunner } from '@de-braighter/substrate-runtime';
import {
  CoinGeckoAdapter,
  toObservationEnvelopes,
} from '@de-braighter/markets-pack';
import {
  capConfidence,
  deriveHealth,
  type SourceHealthStatus,
} from '@de-braighter/markets-source-spine';
import { MARKETS_TENANT_PACK_ID } from '../config/tenants.js';

export interface IngestionResult {
  readonly observed: number;
  readonly health: SourceHealthStatus;
  readonly confidence: number;
  readonly error?: { readonly kind: string; readonly detail: string };
}

@Injectable()
export class PriceIngestionService {
  private readonly logger = new Logger(PriceIngestionService.name);

  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly publisher: DomainEventPublisher,
    private readonly runner: GucPrismaRunner,
    private readonly adapter: CoinGeckoAdapter,
  ) {}

  async ingest(): Promise<IngestionResult> {
    const fetchResult = await this.adapter.fetch();
    const now = new Date().toISOString();

    if (!fetchResult.ok) {
      return { observed: 0, health: 'offline', confidence: 0, error: fetchResult.error };
    }

    const health = deriveHealth(
      fetchResult.value.provenance.fetchedAt,
      now,
      this.adapter.descriptor.latencyBudgetMs,
    );
    const confidence = capConfidence(1.0, health, this.adapter.descriptor.required);
    const envelopes = toObservationEnvelopes(MARKETS_TENANT_PACK_ID, fetchResult.value);

    await this.runner.run(
      MARKETS_TENANT_PACK_ID,
      (tx) => this.publisher.publishAll(envelopes, tx),
    );

    return { observed: envelopes.length, health, confidence };
  }

  @Interval(30_000)
  async scheduledIngest(): Promise<void> {
    try {
      const result = await this.ingest();
      this.logger.log({ event: 'ingestion.tick', ...result });
    } catch (err) {
      this.logger.error({ event: 'ingestion.tick.error', err });
    }
  }
}
```

- [ ] **Step 4: Run the test — must PASS**

```bash
cd D:/development/projects/de-braighter/domains/markets/apps/markets-api
pnpm run test
```
Expected: 4 PriceIngestionService tests passed (plus 1 HealthController = 5 total).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add apps/markets-api/src/ingestion/price-ingestion.service.ts apps/markets-api/src/ingestion/price-ingestion.service.spec.ts
git commit -m "feat(markets-api): PriceIngestionService — fetch→observe→publish with 30s auto-poll

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: `IngestionController` (TDD)

**Files:**
- Create: `apps/markets-api/src/ingestion/ingestion.controller.spec.ts`
- Create: `apps/markets-api/src/ingestion/ingestion.controller.ts`

- [ ] **Step 1: Write the failing test**

`apps/markets-api/src/ingestion/ingestion.controller.spec.ts`:
```typescript
import 'reflect-metadata';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { IngestionController } from './ingestion.controller.js';
import { PriceIngestionService } from './price-ingestion.service.js';

describe('IngestionController', () => {
  let controller: IngestionController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [IngestionController],
      providers: [
        {
          provide: PriceIngestionService,
          useValue: {
            ingest: vi.fn().mockResolvedValue({
              observed: 3,
              health: 'online',
              confidence: 1,
            }),
          },
        },
      ],
    }).compile();
    controller = moduleRef.get(IngestionController);
  });

  it('POST /ingest delegates to service.ingest() and returns the result', async () => {
    const result = await controller.ingest();
    expect(result).toEqual({ observed: 3, health: 'online', confidence: 1 });
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/apps/markets-api
pnpm run test
```
Expected: FAIL with `Cannot find module './ingestion.controller.js'`

- [ ] **Step 3: Write `ingestion.controller.ts`**

`apps/markets-api/src/ingestion/ingestion.controller.ts`:
```typescript
import { Controller, Post } from '@nestjs/common';
import {
  PriceIngestionService,
  type IngestionResult,
} from './price-ingestion.service.js';

@Controller('ingest')
export class IngestionController {
  constructor(private readonly service: PriceIngestionService) {}

  @Post()
  ingest(): Promise<IngestionResult> {
    return this.service.ingest();
  }
}
```

- [ ] **Step 4: Run all markets-api tests — must all PASS**

```bash
cd D:/development/projects/de-braighter/domains/markets/apps/markets-api
pnpm run test
```
Expected: 6 tests passed (1 HealthController + 4 PriceIngestionService + 1 IngestionController).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add apps/markets-api/src/ingestion/ingestion.controller.ts apps/markets-api/src/ingestion/ingestion.controller.spec.ts
git commit -m "feat(markets-api): IngestionController — POST /ingest manual trigger

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Update `AppModule` — wire SubstrateModule + scheduler + providers

**Files:**
- Modify: `apps/markets-api/src/app/app.module.ts`

- [ ] **Step 1: Replace `app.module.ts`**

`apps/markets-api/src/app/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  GucPrismaRunner,
  InMemoryConsentReceiptRepository,
  InMemoryPackRoleAssignmentRepository,
  SubstrateModule,
} from '@de-braighter/substrate-runtime';
import { PrismaClient } from '@prisma/client';
import { CoinGeckoAdapter } from '@de-braighter/markets-pack';
import { MARKETS_MANIFEST } from '../config/manifest.js';
import { MARKETS_TENANTS } from '../config/tenants.js';
import { HealthController } from './health.controller.js';
import { IngestionController } from '../ingestion/ingestion.controller.js';
import { PriceIngestionService } from '../ingestion/price-ingestion.service.js';

/**
 * The RLS-scoped non-superuser Prisma client. All event writes go through this
 * role under a GUC-scoped transaction set by GucPrismaRunner. Using `prismaClient`
 * in SubstrateModule.forRoot binds DOMAIN_EVENT_PUBLISHER → PrismaOutboxWriter;
 * omitting it would default to InMemoryDomainEventPublisher and observations
 * would never reach kernel.event_log.
 */
const appRoleClient = new PrismaClient({
  datasources: { db: { url: process.env['SUBSTRATE_APP_DATABASE_URL'] } },
});

@Module({
  imports: [
    SubstrateModule.forRoot({
      tenants: MARKETS_TENANTS,
      manifests: [MARKETS_MANIFEST],
      prismaClient: appRoleClient,
      packRoleAssignmentRepository: InMemoryPackRoleAssignmentRepository,
      consentReceiptRepository: InMemoryConsentReceiptRepository,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [HealthController, IngestionController],
  providers: [
    PriceIngestionService,
    { provide: CoinGeckoAdapter, useValue: new CoinGeckoAdapter() },
    { provide: GucPrismaRunner, useValue: new GucPrismaRunner(appRoleClient) },
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Typecheck the app**

```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm run build
```
Expected: all 3 packages build without errors.

- [ ] **Step 3: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add apps/markets-api/src/app/app.module.ts
git commit -m "feat(markets-api): wire SubstrateModule.forRoot + ScheduleModule + ingestion providers

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Live-verify — `POST /ingest` → rows in `kernel.event_log`

This task has no source code to write — it's the proof that the full stack works end-to-end.

- [ ] **Step 1: Ensure DB is running and set up**

```bash
cd D:/development/projects/de-braighter/domains/markets
docker compose up -d markets-db
pnpm run db:setup
```

- [ ] **Step 2: Start the API**

In a separate terminal (or background):
```bash
cd D:/development/projects/de-braighter/domains/markets/apps/markets-api
node --import tsx/esm src/main.ts
```
Expected: `markets-api listening on http://localhost:3300`

If `tsx/esm` fails, try: `node --loader tsx/esm src/main.ts`

- [ ] **Step 3: Hit `POST /ingest`**

```bash
curl -s -X POST http://localhost:3300/ingest | jq .
```
Expected:
```json
{ "observed": 3, "health": "online", "confidence": 1 }
```

If `health` is not `'online'`, the CoinGecko response may be stale or the fetch failed. Check the `error` field in the response.

- [ ] **Step 4: Verify rows in `kernel.event_log`**

```bash
docker exec markets-markets-db-1 psql -U postgres -d markets \
  -c "SELECT aggregate_id, payload->>'assetId' AS asset, payload->>'priceUsd' AS price_usd, occurred_at FROM kernel.event_log WHERE event_type = 'markets:PriceObservation.v1' ORDER BY occurred_at DESC LIMIT 6;"
```
Expected: 3 rows (bitcoin, ethereum, cardano), each with a `price_usd` and recent `occurred_at`.

- [ ] **Step 5: Hit `POST /ingest` again — 3 more rows should be appended**

```bash
curl -s -X POST http://localhost:3300/ingest | jq .
```
Then re-run the SELECT — should now show 6 rows. The event_log is append-only (INSERT only, no UPDATE/DELETE per ADR-030).

- [ ] **Step 6: Verify the scheduler fires automatically**

Wait ~35 seconds without hitting the endpoint. Re-run the SELECT — the row count should increase by 3 automatically (the `@Interval(30_000)` scheduler fired).

- [ ] **Step 7: Stop the API and commit the live-verify note**

Stop the server (Ctrl+C or kill the process). No code changes needed — the live-verify is complete.

```bash
cd D:/development/projects/de-braighter/domains/markets
git log --oneline -8
```
Confirm all Phase 2b commits are on `main` (or the working branch).

---

## Task 9: Full workspace gate + PR

- [ ] **Step 1: Run the full workspace gate**

```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm run ci:local
```
Expected: build + typecheck + test all pass across all 3 packages (6 tests in markets-api, 20 in markets-pack, 20 in source-spine).

- [ ] **Step 2: Verify git status is clean**

```bash
git status --short
```
Expected: clean working tree (no `dist/`, `node_modules/`, `coverage/` tracking).

- [ ] **Step 3: Push to `de-braighter/markets` main**

```bash
git push origin main
```

- [ ] **Step 4: Open the workbench registration PR update (optional)**

The workbench `projects/markets/project.yaml` has `status: bootstrapping`. Update it to reflect Phase 2 complete if desired — or leave for Phase 3.

- [ ] **Step 5: Run the twin ritual**

From `D:/development/projects/de-braighter/domains/devloop`:
```bash
npm run dev -- drain markets#<PR_NUMBER>
npm run dev -- backfill
npm run dev -- reconcile
```

---

## Self-Review

**Spec coverage:**
- `docker-compose.yml` (Postgres :5455) → Task 1 ✓
- `db/app-roles.sql` pattern (via substrate-runtime/sql) → Task 2 ✓
- `core-schema.sql` + `kernel-event-log.sql` → Task 2 ✓
- `prisma/schema.prisma` (minimal, no pack tables) → Task 3 ✓
- `.env.example` + env vars → Task 1 ✓
- `MARKETS_TENANTS` / `MARKETS_MANIFEST` → Task 4 ✓
- `PriceIngestionService.ingest()` → Task 5 ✓
- `@Interval(30_000) scheduledIngest()` → Task 5 ✓ (wired in AppModule Task 7)
- `POST /ingest` endpoint → Task 6 ✓
- `SubstrateModule.forRoot({ prismaClient })` → Task 7 ✓
- `prismaClient` is required note (binds real publisher) → Task 7 comment ✓
- `GucPrismaRunner` value provider → Task 7 ✓
- Live-verify: `POST /ingest` → 3 rows in `kernel.event_log` → Task 8 ✓
- `scheduledIngest()` never throws → Task 5 implementation ✓

**Placeholder scan:** None found.

**Type consistency:**
- `IngestionResult` defined in Task 5 (`price-ingestion.service.ts`), imported in Task 6 ✓
- `MARKETS_TENANT_PACK_ID` defined in Task 4 (`tenants.ts`), imported in Task 5 ✓
- `MARKETS_TENANTS` / `MARKETS_MANIFEST` defined in Task 4, imported in Task 7 ✓
- `CoinGeckoAdapter` from `@de-braighter/markets-pack` — consistent in Tasks 5, 7 ✓
- `GucPrismaRunner` from `@de-braighter/substrate-runtime` — consistent in Tasks 5, 7 ✓
- `DOMAIN_EVENT_PUBLISHER` / `DomainEventPublisher` from `@de-braighter/substrate-contracts` — consistent in Tasks 5, 7 ✓
