# Markets Phase 3a — Inference Backend + GET /readout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the published `INFERENCE_BACKBONE` (Normal-Normal conjugate) over real `kernel.event_log` rows to compute a log-price posterior for BTC, ETH, and ADA, then expose the result at `GET /readout` with prices exponentiated back to USD.

**Architecture:** `markets-pack` gains an `inference/inference-catalog.ts` that registers the `markets.log_price` indicator with an `ObservationProjection` pointing to `logPriceUsd` in each `markets:PriceObservation.v1` payload. `AppModule` provides `InferenceBackboneRouter` (Normal-Normal fast-path) wired to `PrismaEvidenceLogRepository` for real DB reads. `ReadoutService` calls `posterior()` for each of the three assets in parallel, exponentiates `summary.mean/p10/p90` back to price space, and returns a structured JSON result.

**Precondition:** Phase 2b merged to main — `kernel.event_log`, `DOMAIN_EVENT_PUBLISHER`, `PrismaOutboxWriter`, `POST /ingest` all working. At least a few rows must exist in `kernel.event_log` for posteriors to differ meaningfully from the prior (run `POST /ingest` a couple of times after seeding).

**Tech Stack:** TypeScript 5.4 (NodeNext ESM), NestJS 10, `@de-braighter/substrate-contracts@^0.14.0` (inference at `/inference` subpath), `@de-braighter/substrate-runtime@^0.19.0`, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-06-03-markets-phase3-inference-readout-design.md`

**Repo:** `D:/development/projects/de-braighter/domains/markets/` (Phase 2b on main)

**Key import map (check these before writing code):**
```typescript
// DI tokens + types:
import { INFERENCE_BACKBONE, NUMPYRO_SIDECAR, asJsonPath, type ObservationProjection }
  from '@de-braighter/substrate-contracts/inference';
import { MEMBER_RESOLUTION_PORT, type MemberResolution }
  from '@de-braighter/substrate-contracts';
import {
  EVIDENCE_REPOSITORY, INFERENCE_CATALOG,
  InferenceBackboneRouter, InMemoryInferenceCatalog, PrismaEvidenceLogRepository,
  type EvidenceRepository, type InferenceCatalog,
} from '@de-braighter/substrate-runtime';

// PrismaEvidenceLogRepository constructor: (runner: GucPrismaRunner, catalog: InferenceCatalog)
// InferenceBackboneRouter constructor: (catalog, evidence, sidecar: null, members: MemberResolution)
// posterior() returns: Promise<Result<PosteriorHandle, InferenceError>>
//   Result._tag === 'Left' → error; _tag === 'Right' → r.right.summary has mean/p10/p90
```

**kernel.plan_node schema gotchas:**
- Column is `kind` (NOT `type`)
- Root node requires `tree_root_id = id` (enforced by CHECK constraint)
- Superuser bypasses FORCE RLS — seed INSERT works without setting GUC

---

## File Structure

```
libs/markets-pack/
  package.json                         ← modified: add @de-braighter/substrate-runtime dep
  src/
    observations.ts                    ← modified: add logPriceUsd = Math.log(priceUsd)
    observations.spec.ts               ← modified: add logPriceUsd assertion
    inference/
      inference-catalog.ts             ← new: MARKETS_LOG_PRICE_KEY + buildMarketsCatalog()
      inference-catalog.spec.ts        ← new: TDD for catalog shape
    index.ts                           ← modified: export inference catalog symbols

apps/markets-api/
  src/
    config/
      tenants.ts                       ← modified: add MARKETS_PLAN_ROOT_ID
    app/
      app.module.ts                    ← modified: inference providers + ReadoutController
    ingestion/
      price-ingestion.service.ts       ← modified: add lastResult getter
      price-ingestion.service.spec.ts  ← modified: test lastResult getter
    readout/
      readout.service.ts               ← new: ReadoutService (TDD)
      readout.service.spec.ts          ← new: 4 test cases
      readout.controller.ts            ← new: ReadoutController (TDD)
      readout.controller.spec.ts       ← new: 1 test case

tools/db/
  seed.sql                             ← new: INSERT kernel.plan_node root (idempotent)
  seed.mjs                             ← new: runs seed.sql via prisma db execute

root package.json                      ← modified: add db:seed script; update ci:local:db
```

---

## Task 1: Add `logPriceUsd` to `observations.ts` (TDD)

**Files:**
- Modify: `libs/markets-pack/src/observations.spec.ts`
- Modify: `libs/markets-pack/src/observations.ts`

- [ ] **Step 1: Add the failing assertion to the existing test**

In `libs/markets-pack/src/observations.spec.ts`, add inside the `'payload contains priceUsd and lastUpdatedAt'` test (or add a new test after it):

```typescript
  it('payload contains logPriceUsd = Math.log(priceUsd)', () => {
    const envelopes = toObservationEnvelopes(TENANT, FETCH_RESULT);
    const btc = envelopes.find(e => e.payload['assetId'] === 'bitcoin')!;
    expect(btc.payload['logPriceUsd']).toBeCloseTo(Math.log(67_000), 10);
  });
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm run test
```
Expected: FAIL — `expected undefined to be close to 11.112...`

- [ ] **Step 3: Add `logPriceUsd` to the payload in `observations.ts`**

In `libs/markets-pack/src/observations.ts`, update the `payload` object inside `envelopes.push(...)`:

```typescript
      payload: {
        assetId,
        priceUsd: entry.usd,
        logPriceUsd: Math.log(entry.usd),
        lastUpdatedAt: new Date(entry.last_updated_at * 1000).toISOString(),
      },
```

- [ ] **Step 4: Run all markets-pack tests — must all PASS**

```bash
pnpm run test
```
Expected: all 22 tests passed (was 21, now +1).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add libs/markets-pack/src/observations.ts libs/markets-pack/src/observations.spec.ts
git commit -m "feat(markets-pack): add logPriceUsd to observation payload for inference numeratorPath

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: DB foundation — `kernel.plan_node` + seed

**Files:**
- Create: `tools/db/seed.sql`
- Create: `tools/db/seed.mjs`
- Modify: `tools/db/setup.mjs` (add kernel-plan-tree.sql step)
- Modify: `apps/markets-api/src/config/tenants.ts` (add MARKETS_PLAN_ROOT_ID)
- Modify: root `package.json` (add db:seed, update ci:local:db)

- [ ] **Step 1: Write `tools/db/seed.sql`**

`D:/development/projects/de-braighter/domains/markets/tools/db/seed.sql`:
```sql
-- Idempotent seed for the markets domain plan tree root.
--
-- kernel.plan_node schema notes:
--   - Column is `kind` (not `type`)
--   - Root node requires tree_root_id = id (CHECK constraint)
--   - Superuser bypasses FORCE RLS — no GUC needed for this INSERT
INSERT INTO kernel.plan_node (id, tenant_pack_id, tree_root_id, parent_id, kind, ordinal, effects)
VALUES (
  '20000000-0000-4000-8000-000000000001'::uuid,  -- MARKETS_PLAN_ROOT_ID
  '10000000-0000-4001-8000-000000000001'::uuid,  -- MARKETS_TENANT_PACK_ID
  '20000000-0000-4000-8000-000000000001'::uuid,  -- tree_root_id = id (required for root)
  NULL,                                            -- root: no parent
  'markets.world',                                 -- pack-namespaced kind
  0,                                               -- ordinal
  '[]'::jsonb                                      -- empty effects
)
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Write `tools/db/seed.mjs`**

`D:/development/projects/de-braighter/domains/markets/tools/db/seed.mjs`:
```javascript
// DB seed for the markets domain.
// Inserts the degenerate plan tree root into kernel.plan_node.
// Idempotent — ON CONFLICT (id) DO NOTHING.
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnv, REPO_ROOT } from './env.mjs';

const env = loadEnv();
const migrateUrl = env['DATABASE_URL_MIGRATE'] ?? process.env['DATABASE_URL_MIGRATE'];

if (!migrateUrl) {
  console.error('[db:seed] DATABASE_URL_MIGRATE not set (.env missing or incomplete).');
  process.exit(1);
}

const apiDir = resolve(REPO_ROOT, 'apps', 'markets-api');
const seedFile = resolve(REPO_ROOT, 'tools', 'db', 'seed.sql');
const childEnv = { ...process.env, DATABASE_URL: migrateUrl };

try {
  const cmd = `pnpm exec prisma db execute --url "${migrateUrl}" --file "${seedFile}"`;
  console.log('[db:seed] inserting markets plan tree root...');
  execSync(cmd, { cwd: apiDir, env: childEnv, stdio: 'inherit', shell: true });
  console.log('\n[db:seed] OK — kernel.plan_node root seeded.');
} catch (err) {
  console.error(`\n[db:seed] FAILED: ${err?.message ?? err}`);
  process.exit(1);
}
```

- [ ] **Step 3: Update `tools/db/setup.mjs` — add `kernel-plan-tree.sql` as step 4**

In the `try` block of `setup.mjs`, add the line after `kernel-event-log`:
```javascript
  execFile('kernel-plan-tree', 'kernel-plan-tree.sql');
```

Full updated `try` block:
```javascript
try {
  execFile('app-roles',         'app-roles.sql');
  execFile('core-schema',       'core-schema.sql');
  execFile('kernel-event-log',  'kernel-event-log.sql');
  execFile('kernel-plan-tree',  'kernel-plan-tree.sql');
  console.log('\n[db:setup] OK — app role + core schema + kernel event_log + plan_tree provisioned.');
} catch (err) {
  console.error(`\n[db:setup] FAILED: ${err?.message ?? err}`);
  process.exit(1);
}
```

- [ ] **Step 4: Add `MARKETS_PLAN_ROOT_ID` to `apps/markets-api/src/config/tenants.ts`**

Add after `MARKETS_TENANT_PACK_ID`:
```typescript
/** Stable UUID for the degenerate plan tree root used by INFERENCE_BACKBONE.posterior(). */
export const MARKETS_PLAN_ROOT_ID = '20000000-0000-4000-8000-000000000001' as const;
```

- [ ] **Step 5: Update root `package.json` scripts**

Replace `"scripts"` block in `D:/development/projects/de-braighter/domains/markets/package.json`:
```json
"scripts": {
  "build":       "pnpm -r run build",
  "test":        "pnpm -r run test",
  "typecheck":   "pnpm -r run typecheck",
  "ci:local":    "pnpm run build && pnpm run typecheck && pnpm run test",
  "db:start":    "docker compose up -d markets-db",
  "db:setup":    "node tools/db/setup.mjs",
  "db:seed":     "node tools/db/seed.mjs",
  "ci:local:db": "pnpm run db:start && pnpm run db:setup && pnpm run db:seed && pnpm run ci:local"
}
```

- [ ] **Step 6: Run db:setup + db:seed to provision and seed**

DB must be running (from Phase 2 setup):
```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm run db:setup
pnpm run db:seed
```
Expected:
```
[db:setup] app-roles: app-roles.sql
[db:setup] core-schema: core-schema.sql
[db:setup] kernel-event-log: kernel-event-log.sql
[db:setup] kernel-plan-tree: kernel-plan-tree.sql
[db:setup] OK — app role + core schema + kernel event_log + plan_tree provisioned.

[db:seed] inserting markets plan tree root...
[db:seed] OK — kernel.plan_node root seeded.
```

- [ ] **Step 7: Verify the root node exists**

```bash
docker exec markets-markets-db-1 psql -U postgres -d markets \
  -c "SELECT id, tenant_pack_id, kind, ordinal FROM kernel.plan_node WHERE id = '20000000-0000-4000-8000-000000000001';"
```
Expected: 1 row with `kind = markets.world`.

- [ ] **Step 8: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add tools/db/seed.sql tools/db/seed.mjs tools/db/setup.mjs \
        apps/markets-api/src/config/tenants.ts package.json
git commit -m "feat(db): provision kernel.plan_node + seed degenerate plan tree root for inference

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: `InferenceCatalog` in `markets-pack` (TDD)

**Files:**
- Modify: `libs/markets-pack/package.json` (add substrate-runtime dep)
- Create: `libs/markets-pack/src/inference/inference-catalog.spec.ts`
- Create: `libs/markets-pack/src/inference/inference-catalog.ts`
- Modify: `libs/markets-pack/src/index.ts`

- [ ] **Step 1: Add `@de-braighter/substrate-runtime` to markets-pack dependencies**

Edit `libs/markets-pack/package.json` — add to `"dependencies"`:
```json
"@de-braighter/substrate-runtime": "^0.19.0"
```

Full `"dependencies"` block:
```json
"dependencies": {
  "@de-braighter/markets-source-spine": "workspace:*",
  "@de-braighter/substrate-contracts": "^0.14.0",
  "@de-braighter/substrate-runtime": "^0.19.0"
}
```

Install:
```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm install
```

- [ ] **Step 2: Write the failing test**

`libs/markets-pack/src/inference/inference-catalog.spec.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import {
  buildMarketsCatalog,
  MARKETS_LOG_PRICE_KEY,
  MARKETS_LOG_PRICE_PROJECTION,
} from './inference-catalog.js';

describe('buildMarketsCatalog', () => {
  it('MARKETS_LOG_PRICE_KEY is the correct indicator key', () => {
    expect(MARKETS_LOG_PRICE_KEY).toBe('markets.log_price');
  });

  it('MARKETS_LOG_PRICE_PROJECTION uses the event-log source and correct eventType', () => {
    expect(MARKETS_LOG_PRICE_PROJECTION.source).toBe('event-log');
    expect(MARKETS_LOG_PRICE_PROJECTION.eventTypes).toContain('markets:PriceObservation.v1');
    expect(MARKETS_LOG_PRICE_PROJECTION.indicatorKey).toBe('markets.log_price');
  });

  it('MARKETS_LOG_PRICE_PROJECTION numeratorPath references logPriceUsd', () => {
    expect(String(MARKETS_LOG_PRICE_PROJECTION.numeratorPath)).toBe('logPriceUsd');
  });

  it('MARKETS_LOG_PRICE_PROJECTION timestampPath references lastUpdatedAt', () => {
    expect(String(MARKETS_LOG_PRICE_PROJECTION.timestampPath)).toBe('lastUpdatedAt');
  });

  it('buildMarketsCatalog() returns a catalog that finds markets.log_price', async () => {
    const catalog = buildMarketsCatalog();
    const indicator = await catalog.findIndicator(MARKETS_LOG_PRICE_KEY);
    expect(indicator).not.toBeNull();
    expect(indicator?.conjugateHint).toBe('normal');
    expect(indicator?.priorMean).toBe(4);
    expect(indicator?.priorSd).toBe(5);
    expect(indicator?.observationSd).toBe(2);
  });

  it('buildMarketsCatalog() returns null for unknown indicators', async () => {
    const catalog = buildMarketsCatalog();
    const indicator = await catalog.findIndicator('unknown.indicator');
    expect(indicator).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm run test
```
Expected: FAIL with `Cannot find module './inference-catalog.js'`

- [ ] **Step 4: Write `inference-catalog.ts`**

`libs/markets-pack/src/inference/inference-catalog.ts`:
```typescript
import {
  asJsonPath,
  type ObservationProjection,
  type IndicatorKey,
} from '@de-braighter/substrate-contracts/inference';
import { InMemoryInferenceCatalog } from '@de-braighter/substrate-runtime';

export const MARKETS_LOG_PRICE_KEY = 'markets.log_price' as IndicatorKey;

/**
 * ObservationProjection that maps markets:PriceObservation.v1 payloads to the
 * Normal-Normal evidence stream. numeratorPath points to logPriceUsd (added in
 * Phase 3a to each observation payload alongside priceUsd).
 */
export const MARKETS_LOG_PRICE_PROJECTION: ObservationProjection = {
  indicatorKey: MARKETS_LOG_PRICE_KEY,
  source: 'event-log',
  eventTypes: ['markets:PriceObservation.v1'],
  numeratorPath: asJsonPath('logPriceUsd'),
  timestampPath: asJsonPath('lastUpdatedAt'),
};

/**
 * Build the markets InferenceCatalog.
 *
 * One indicator: markets.log_price (Normal-Normal conjugate).
 * Prior: priorMean=4, priorSd=5 — effectively flat in log-price space
 * (covers prices from ~$0.002 to ~$1.2M). All three assets (BTC, ETH, ADA)
 * share this indicator; the per-asset posterior is selected by subject.id
 * (= ASSET_IDS[assetId] from observations.ts).
 */
export function buildMarketsCatalog(): InMemoryInferenceCatalog {
  return new InMemoryInferenceCatalog([
    {
      indicatorKey: MARKETS_LOG_PRICE_KEY,
      conjugateHint: 'normal',
      priorMean: 4,      // e^4 ≈ $54 — broad centre in log-price space
      priorSd: 5,        // covers log prices from -6 to +14 → $0.002–$1.2M
      observationSd: 2,  // broad noise model; posterior dominated by observations
      observationProjection: MARKETS_LOG_PRICE_PROJECTION,
    },
  ]);
}
```

- [ ] **Step 5: Run the test — must PASS**

```bash
cd D:/development/projects/de-braighter/domains/markets/libs/markets-pack
pnpm run test
```
Expected: all tests passed (22 + 6 = 28 total).

- [ ] **Step 6: Update `index.ts` to export the inference catalog**

Add to `libs/markets-pack/src/index.ts`:
```typescript
export {
  buildMarketsCatalog,
  MARKETS_LOG_PRICE_KEY,
  MARKETS_LOG_PRICE_PROJECTION,
} from './inference/inference-catalog.js';
```

Full updated `libs/markets-pack/src/index.ts`:
```typescript
export type { SourcePort, SourceDescriptor, SourceResult } from '@de-braighter/markets-source-spine';
export { PACK_ID, ASSET_IDS, type AssetKey } from './constants.js';
export { CoinGeckoAdapter, type CoinGeckoPricePayload } from './sources/coingecko.adapter.js';
export { FixtureAdapter } from './sources/fixture.adapter.js';
export { toObservationEnvelopes } from './observations.js';
export {
  buildMarketsCatalog,
  MARKETS_LOG_PRICE_KEY,
  MARKETS_LOG_PRICE_PROJECTION,
} from './inference/inference-catalog.js';
```

- [ ] **Step 7: Build and typecheck**

```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm run build
```
Expected: all 3 packages build cleanly.

- [ ] **Step 8: Commit**

```bash
git add libs/markets-pack/package.json libs/markets-pack/src/inference/ \
        libs/markets-pack/src/index.ts pnpm-lock.yaml
git commit -m "feat(markets-pack): InferenceCatalog — markets.log_price Normal-Normal indicator

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Add `lastResult` getter to `PriceIngestionService` (TDD)

**Files:**
- Modify: `apps/markets-api/src/ingestion/price-ingestion.service.spec.ts`
- Modify: `apps/markets-api/src/ingestion/price-ingestion.service.ts`

`ReadoutService` needs the last health/confidence without re-fetching CoinGecko.

- [ ] **Step 1: Add the failing test to the existing spec**

In `apps/markets-api/src/ingestion/price-ingestion.service.spec.ts`, add inside `describe('PriceIngestionService', ...)`:

```typescript
  it('lastResult is null before any ingest() call', async () => {
    const service = await buildService(OK_RESULT);
    expect(service.lastResult).toBeNull();
  });

  it('lastResult reflects the most recent ingest() outcome', async () => {
    const service = await buildService(OK_RESULT);
    await service.ingest();
    expect(service.lastResult).not.toBeNull();
    expect(service.lastResult?.health).toBe('online');
    expect(service.lastResult?.observed).toBe(3);
  });
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/apps/markets-api
pnpm run test
```
Expected: FAIL — `service.lastResult is not a function` or similar (property doesn't exist).

- [ ] **Step 3: Add `lastResult` to `price-ingestion.service.ts`**

Add a private backing field and a public getter. Edit `price-ingestion.service.ts`:

```typescript
// Add after the class opening brace, before constructor:
private _lastResult: IngestionResult | null = null;

get lastResult(): IngestionResult | null {
  return this._lastResult;
}
```

At the end of `ingest()`, before the `return` statement, update `_lastResult`:

```typescript
    const result: IngestionResult = { observed: envelopes.length, health, confidence };
    this._lastResult = result;
    return result;
```

Also update the `catch` block to store the error result:
```typescript
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      const errorResult: IngestionResult = { observed: 0, health: 'offline', confidence: 0, error: { kind: 'db-error', detail } };
      this._lastResult = errorResult;
      return errorResult;
    }
```

And for the adapter-failure early return:
```typescript
    if (!fetchResult.ok) {
      const r: IngestionResult = { observed: 0, health: 'offline', confidence: 0, error: fetchResult.error };
      this._lastResult = r;
      return r;
    }
```

- [ ] **Step 4: Run all markets-api tests — must all PASS**

```bash
pnpm run test
```
Expected: 8 tests passed (was 6, now +2).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add apps/markets-api/src/ingestion/price-ingestion.service.ts \
        apps/markets-api/src/ingestion/price-ingestion.service.spec.ts
git commit -m "feat(markets-api): PriceIngestionService.lastResult getter for ReadoutService

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: `ReadoutService` (TDD)

**Files:**
- Create: `apps/markets-api/src/readout/readout.service.spec.ts`
- Create: `apps/markets-api/src/readout/readout.service.ts`

- [ ] **Step 1: Write the failing test**

`apps/markets-api/src/readout/readout.service.spec.ts`:
```typescript
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import { ReadoutService } from './readout.service.js';
import { INFERENCE_BACKBONE } from '@de-braighter/substrate-contracts/inference';
import { PriceIngestionService } from '../ingestion/price-ingestion.service.js';
import type { IngestionResult } from '../ingestion/price-ingestion.service.js';

// Known log-price values for assertions:
// log(67000) ≈ 11.112, exp(11.112) ≈ 67000
// log(1853)  ≈ 7.524,  exp(7.524)  ≈ 1853
// log(0.21)  ≈ -1.561, exp(-1.561) ≈ 0.21

const makePosterior = (mean: number, p10: number, p90: number) => ({
  ok: true as const,
  _tag: 'Right' as const,
  right: {
    summary: { mean, p10, p50: mean, p90, sd: 0.2, parameterValues: {}, distributionRef: 'normal' },
    id: 'test-handle-id',
    treeRoot: '20000000-0000-4000-8000-000000000001',
    subject: { kind: 'person' as const, id: '00000000-0001-4000-8000-000000000001' },
    indicatorKey: 'markets.log_price',
    asOfIso: new Date().toISOString(),
    manifest: { runId: 'test', catalogVersionHash: 'test' },
    adapterId: 'normal-normal-v1',
  },
});

const BTC_POSTERIOR  = makePosterior(Math.log(67_000), Math.log(60_000), Math.log(74_000));
const ETH_POSTERIOR  = makePosterior(Math.log(1_853),  Math.log(1_600),  Math.log(2_100));
const ADA_POSTERIOR  = makePosterior(Math.log(0.21),   Math.log(0.18),   Math.log(0.24));

const MOCK_LAST_RESULT: IngestionResult = {
  observed: 3,
  health: 'online',
  confidence: 1,
};

describe('ReadoutService', () => {
  let service: ReadoutService;
  let posteriorFn: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Returns posteriors in order: bitcoin, ethereum, cardano
    let call = 0;
    const posteriors = [BTC_POSTERIOR, ETH_POSTERIOR, ADA_POSTERIOR];
    posteriorFn = vi.fn().mockImplementation(() =>
      Promise.resolve(posteriors[call++ % 3]),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReadoutService,
        { provide: INFERENCE_BACKBONE, useValue: { posterior: posteriorFn } },
        {
          provide: PriceIngestionService,
          useValue: { lastResult: MOCK_LAST_RESULT },
        },
      ],
    }).compile();
    service = moduleRef.get(ReadoutService);
  });

  it('readout() returns 3 assets', async () => {
    const result = await service.readout();
    expect(result.assets).toHaveLength(3);
  });

  it('meanPriceUsd for bitcoin ≈ exp(log(67000)) = 67000', async () => {
    const result = await service.readout();
    const btc = result.assets.find(a => a.assetId === 'bitcoin')!;
    expect(btc.meanPriceUsd).toBeCloseTo(67_000, 0);
  });

  it('p10/p90 are exponentiated from the posterior log-price bounds', async () => {
    const result = await service.readout();
    const btc = result.assets.find(a => a.assetId === 'bitcoin')!;
    expect(btc.p10PriceUsd).toBeCloseTo(60_000, 0);
    expect(btc.p90PriceUsd).toBeCloseTo(74_000, 0);
  });

  it('health and confidence come from PriceIngestionService.lastResult', async () => {
    const result = await service.readout();
    for (const asset of result.assets) {
      expect(asset.health).toBe('online');
      expect(asset.confidence).toBe(1);
    }
  });

  it('calls posterior() exactly 3 times (once per asset)', async () => {
    await service.readout();
    expect(posteriorFn).toHaveBeenCalledTimes(3);
  });

  it('readoutAt is an ISO 8601 string', async () => {
    const result = await service.readout();
    expect(result.readoutAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm run build
cd apps/markets-api
pnpm run test
```
Expected: FAIL with `Cannot find module './readout.service.js'`

- [ ] **Step 3: Write `readout.service.ts`**

`apps/markets-api/src/readout/readout.service.ts`:
```typescript
import { Inject, Injectable } from '@nestjs/common';
import {
  INFERENCE_BACKBONE,
  type InferenceBackbone,
} from '@de-braighter/substrate-contracts/inference';
import { ASSET_IDS, MARKETS_LOG_PRICE_KEY, type AssetKey } from '@de-braighter/markets-pack';
import type { SourceHealthStatus } from '@de-braighter/markets-source-spine';
import { MARKETS_PLAN_ROOT_ID, MARKETS_TENANT_PACK_ID } from '../config/tenants.js';
import { PriceIngestionService } from '../ingestion/price-ingestion.service.js';

export interface AssetReadout {
  readonly assetId: string;
  readonly meanPriceUsd: number;
  readonly p10PriceUsd: number;
  readonly p90PriceUsd: number;
  readonly health: SourceHealthStatus;
  readonly confidence: number;
  readonly error?: string;
}

export interface ReadoutResult {
  readonly assets: readonly AssetReadout[];
  readonly readoutAt: string;
}

const ASSET_KEYS = Object.keys(ASSET_IDS) as AssetKey[];

@Injectable()
export class ReadoutService {
  constructor(
    @Inject(INFERENCE_BACKBONE)
    private readonly backbone: InferenceBackbone,
    private readonly ingestionService: PriceIngestionService,
  ) {}

  async readout(): Promise<ReadoutResult> {
    const last = this.ingestionService.lastResult;
    const health: SourceHealthStatus = last?.health ?? 'offline';
    const confidence = last?.confidence ?? 0;

    const assets = await Promise.all(
      ASSET_KEYS.map(async (assetId): Promise<AssetReadout> => {
        const r = await this.backbone.posterior({
          tenantPackId: MARKETS_TENANT_PACK_ID,
          treeRoot: MARKETS_PLAN_ROOT_ID,
          // kind:'person' is the v1 fast-path workaround — the Normal-Normal adapter
          // rejects non-person subjects. The backbone uses subject.id for the
          // aggregate_id filter against kernel.event_log; kind is validated only.
          subject: { kind: 'person', id: ASSET_IDS[assetId] },
          indicatorKey: MARKETS_LOG_PRICE_KEY,
        });

        if (r._tag === 'Left') {
          return { assetId, meanPriceUsd: 0, p10PriceUsd: 0, p90PriceUsd: 0, health: 'offline', confidence: 0, error: String(r.left) };
        }

        const s = r.right.summary;
        return {
          assetId,
          meanPriceUsd: Math.exp(s.mean),
          p10PriceUsd:  Math.exp(s.p10),
          p90PriceUsd:  Math.exp(s.p90),
          health,
          confidence,
        };
      }),
    );

    return { assets, readoutAt: new Date().toISOString() };
  }
}
```

- [ ] **Step 4: Run all markets-api tests — must all PASS**

```bash
cd D:/development/projects/de-braighter/domains/markets/apps/markets-api
pnpm run test
```
Expected: all 14 tests passed (8 existing + 6 new ReadoutService).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add apps/markets-api/src/readout/readout.service.ts \
        apps/markets-api/src/readout/readout.service.spec.ts
git commit -m "feat(markets-api): ReadoutService — log-posterior → price-space via exp()

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: `ReadoutController` (TDD)

**Files:**
- Create: `apps/markets-api/src/readout/readout.controller.spec.ts`
- Create: `apps/markets-api/src/readout/readout.controller.ts`

- [ ] **Step 1: Write the failing test**

`apps/markets-api/src/readout/readout.controller.spec.ts`:
```typescript
import 'reflect-metadata';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { ReadoutController } from './readout.controller.js';
import { ReadoutService } from './readout.service.js';

describe('ReadoutController', () => {
  let controller: ReadoutController;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ReadoutController],
      providers: [
        {
          provide: ReadoutService,
          useValue: {
            readout: vi.fn().mockResolvedValue({
              assets: [{ assetId: 'bitcoin', meanPriceUsd: 67000, p10PriceUsd: 60000, p90PriceUsd: 74000, health: 'online', confidence: 1 }],
              readoutAt: '2026-06-03T00:00:00.000Z',
            }),
          },
        },
      ],
    }).compile();
    controller = moduleRef.get(ReadoutController);
  });

  it('GET /readout delegates to service.readout() and returns the result', async () => {
    const result = await controller.readout();
    expect(result.assets).toHaveLength(1);
    expect(result.assets[0]!.assetId).toBe('bitcoin');
    expect(result.readoutAt).toBe('2026-06-03T00:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run the test — must FAIL**

```bash
cd D:/development/projects/de-braighter/domains/markets/apps/markets-api
pnpm run test
```
Expected: FAIL with `Cannot find module './readout.controller.js'`

- [ ] **Step 3: Write `readout.controller.ts`**

`apps/markets-api/src/readout/readout.controller.ts`:
```typescript
import { Controller, Get } from '@nestjs/common';
import { ReadoutService, type ReadoutResult } from './readout.service.js';

@Controller('readout')
export class ReadoutController {
  constructor(private readonly service: ReadoutService) {}

  @Get()
  readout(): Promise<ReadoutResult> {
    return this.service.readout();
  }
}
```

- [ ] **Step 4: Run all markets-api tests — must all PASS**

```bash
pnpm run test
```
Expected: 15 tests passed (14 + 1 new ReadoutController).

- [ ] **Step 5: Commit**

```bash
cd D:/development/projects/de-braighter/domains/markets
git add apps/markets-api/src/readout/readout.controller.ts \
        apps/markets-api/src/readout/readout.controller.spec.ts
git commit -m "feat(markets-api): ReadoutController — GET /readout

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: AppModule — wire `INFERENCE_BACKBONE` + `ReadoutController`

**Files:**
- Modify: `apps/markets-api/src/app/app.module.ts`

- [ ] **Step 1: Read the current `app.module.ts` to understand existing providers**

Read `D:/development/projects/de-braighter/domains/markets/apps/markets-api/src/app/app.module.ts` before editing.

- [ ] **Step 2: Replace `app.module.ts` with the fully-wired version**

```typescript
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import {
  GucPrismaRunner,
  InMemoryConsentReceiptRepository,
  InMemoryPackRoleAssignmentRepository,
  PrismaOutboxWriter,
  PrismaEvidenceLogRepository,
  SubstrateModule,
  EVIDENCE_REPOSITORY,
  INFERENCE_CATALOG,
  InferenceBackboneRouter,
} from '@de-braighter/substrate-runtime';
import {
  DOMAIN_EVENT_PUBLISHER,
  MEMBER_RESOLUTION_PORT,
  type MemberResolution,
} from '@de-braighter/substrate-contracts';
import {
  INFERENCE_BACKBONE,
  NUMPYRO_SIDECAR,
} from '@de-braighter/substrate-contracts/inference';
import { PrismaClient } from '@prisma/client';
import {
  buildMarketsCatalog,
  CoinGeckoAdapter,
} from '@de-braighter/markets-pack';
import { MARKETS_MANIFEST } from '../config/manifest.js';
import { MARKETS_TENANTS } from '../config/tenants.js';
import { HealthController } from './health.controller.js';
import { IngestionController } from '../ingestion/ingestion.controller.js';
import { PriceIngestionService } from '../ingestion/price-ingestion.service.js';
import { ReadoutController } from '../readout/readout.controller.js';
import { ReadoutService } from '../readout/readout.service.js';

const appRoleUrl = process.env['SUBSTRATE_APP_DATABASE_URL'];
if (!appRoleUrl) {
  throw new Error(
    '[markets-api] SUBSTRATE_APP_DATABASE_URL is required — ' +
    'without it PrismaClient falls back to the admin URL and bypasses RLS.',
  );
}

const appRoleClient = new PrismaClient({
  datasources: { db: { url: appRoleUrl } },
});

const runner = new GucPrismaRunner(appRoleClient);
const catalog = buildMarketsCatalog();

/**
 * MemberResolution no-op — markets pack uses only `person` subjects, never
 * `aggregate`. The InferenceBackboneRouter only calls resolveMembers for
 * aggregate subjects; this implementation is never reached.
 */
const NULL_MEMBER_RESOLUTION: MemberResolution = {
  resolveMembers(): never {
    throw new Error('markets: MemberResolution.resolveMembers should not be called — no aggregate subjects');
  },
};

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
  controllers: [HealthController, IngestionController, ReadoutController],
  providers: [
    PriceIngestionService,
    ReadoutService,
    { provide: CoinGeckoAdapter,        useValue: new CoinGeckoAdapter() },
    { provide: GucPrismaRunner,          useValue: runner },
    { provide: DOMAIN_EVENT_PUBLISHER,   useValue: new PrismaOutboxWriter() },
    // ── Inference backbone ────────────────────────────────────────────────
    { provide: INFERENCE_CATALOG,        useValue: catalog },
    { provide: EVIDENCE_REPOSITORY,      useValue: new PrismaEvidenceLogRepository(runner, catalog) },
    { provide: NUMPYRO_SIDECAR,          useValue: null },
    { provide: MEMBER_RESOLUTION_PORT,   useValue: NULL_MEMBER_RESOLUTION },
    {
      provide: INFERENCE_BACKBONE,
      useFactory: (
        cat: ReturnType<typeof buildMarketsCatalog>,
        evidence: InstanceType<typeof PrismaEvidenceLogRepository>,
        sidecar: null,
        members: MemberResolution,
      ) => new InferenceBackboneRouter(cat, evidence, sidecar, members),
      inject: [INFERENCE_CATALOG, EVIDENCE_REPOSITORY, NUMPYRO_SIDECAR, MEMBER_RESOLUTION_PORT],
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Build the full workspace**

```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm run build
```
Expected: all 3 packages build without errors.

- [ ] **Step 4: Run tests — must all PASS**

```bash
pnpm run ci:local
```
Expected: 57 tests passed across 3 packages (source-spine 20 + markets-pack 28 + markets-api 15). Numbers may vary slightly if count differs.

- [ ] **Step 5: Commit**

```bash
git add apps/markets-api/src/app/app.module.ts
git commit -m "feat(markets-api): wire INFERENCE_BACKBONE + ReadoutService + ReadoutController in AppModule

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Live-verify `GET /readout` → three posteriors

No source code changes — this is the end-to-end proof.

- [ ] **Step 1: Ensure DB is running and set up + seeded**

```bash
cd D:/development/projects/de-braighter/domains/markets
docker compose up -d markets-db
pnpm run db:setup
pnpm run db:seed
```

- [ ] **Step 2: Run `POST /ingest` several times to populate observations**

Start the API in background:
```bash
cd D:/development/projects/de-braighter/domains/markets/apps/markets-api
node --import tsx/esm src/main.ts &
sleep 5
```

Ingest a few batches (each call writes 3 rows):
```bash
curl -s -X POST http://localhost:3300/ingest | jq .
sleep 2
curl -s -X POST http://localhost:3300/ingest | jq .
sleep 2
curl -s -X POST http://localhost:3300/ingest | jq .
```
Expected each time: `{"observed":3,"health":"online","confidence":1}`

- [ ] **Step 3: Call `GET /readout`**

```bash
curl -s http://localhost:3300/readout | jq .
```
Expected structure:
```json
{
  "assets": [
    {
      "assetId": "bitcoin",
      "meanPriceUsd": <~67000>,
      "p10PriceUsd": <some value>,
      "p90PriceUsd": <some value>,
      "health": "online",
      "confidence": 1
    },
    { "assetId": "ethereum", ... },
    { "assetId": "cardano", ... }
  ],
  "readoutAt": "..."
}
```

If you get `error` fields in assets, the inference failed. Common causes:
- No observations in `kernel.event_log` yet (run `POST /ingest` first)
- `kernel.plan_node` root not seeded (run `db:seed`)
- Wrong tenant scope (check `MARKETS_TENANT_PACK_ID` matches what was used for ingestion)

- [ ] **Step 4: Verify `meanPriceUsd` is in the right ballpark**

BTC should be ~$60K–$80K, ETH ~$1K–$4K, ADA ~$0.10–$0.50. With only a few observations, the posterior will be pulled toward the prior (log-space mean ≈ e^4 = $54), so ETH/ADA will look more accurate than BTC initially.

- [ ] **Step 5: Stop the server**

Kill the background server:
```bash
# Bash:
kill %1
# Or PowerShell:
(Get-NetTCPConnection -LocalPort 3300 -State Listen -ErrorAction SilentlyContinue).OwningProcess | % { Stop-Process -Id $_ -Force }
```

---

## Task 9: Full workspace gate + PR

- [ ] **Step 1: Run the full workspace gate**

```bash
cd D:/development/projects/de-braighter/domains/markets
pnpm run ci:local
```
Expected: build + typecheck + test all pass.

- [ ] **Step 2: Verify git status is clean**

```bash
git status --short
```
Expected: clean (no dist/, node_modules/, .env tracking).

- [ ] **Step 3: Verify git log shows all Phase 3a commits**

```bash
git log --oneline feat/phase-3a-inference-backend ^main 2>/dev/null || git log --oneline -8
```

- [ ] **Step 4: Push and open PR to `de-braighter/markets`**

Push the Phase 3a feature branch and open a PR targeting `main`.

---

## Self-Review

**Spec coverage:**
- `logPriceUsd` in observations payload → Task 1 ✓
- `kernel-plan-tree.sql` in `db:setup` → Task 2 ✓
- `tools/db/seed.mjs` + `seed.sql` → Task 2 ✓
- `MARKETS_PLAN_ROOT_ID` in tenants.ts → Task 2 ✓
- `db:seed` script in package.json → Task 2 ✓
- `InferenceCatalog` (`markets.log_price`, Normal-Normal) → Task 3 ✓
- `buildMarketsCatalog()` exported from markets-pack → Task 3 ✓
- `PriceIngestionService.lastResult` getter → Task 4 ✓
- `ReadoutService.readout()` with `Math.exp()` back-transform → Task 5 ✓
- `GET /readout` endpoint → Task 6 ✓
- `INFERENCE_BACKBONE` providers in AppModule → Task 7 ✓
- `PrismaEvidenceLogRepository` for real DB evidence reads → Task 7 ✓
- `MEMBER_RESOLUTION_PORT` no-op → Task 7 ✓
- Live-verify: 3 posteriors with sensible price ranges → Task 8 ✓

**Placeholder scan:** None.

**Type consistency:**
- `AssetReadout`, `ReadoutResult` defined in Task 5, imported in Task 6 ✓
- `MARKETS_PLAN_ROOT_ID` defined in Task 2, imported in Task 5 via tenants.ts ✓
- `MARKETS_LOG_PRICE_KEY` defined in Task 3, imported in Task 5 via markets-pack ✓
- `asJsonPath` used in Task 3 inference-catalog.ts ✓ (NOT `path()`)
- `kind: 'person'` subject workaround documented in Task 5 and Task 7 ✓
- `tree_root_id = id` in seed.sql ✓ (`kind` column, not `type`) ✓
