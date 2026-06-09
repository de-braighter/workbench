# B3-S3.5 — Production Survival Read + Ring-0 Projection Arm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. **Build with the `substrate-coder-pro` agent.** Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the real production `kernel.event_log` read for the survival family — a Ring-0 `SurvivalEventLogObservationProjection` arm on the `ObservationProjection` union + a boolean JSON-path evaluator + the real Prisma `findSurvivalObservations` (replacing the `[]` stub), proven by a DB-gated RLS read test. This is the founder-pulled-forward half of the decomposition's S6 (decisions D1/D4 in the S3/S3.5 design delta).

**Architecture:** The survival read mirrors `findNormalObservations` exactly: resolve the indicator's `ObservationProjection`; if it is the new survival shape (`source:'event-log'`, `shape:'survival'`), read candidate `event_log` rows GUC-scoped (RLS), evaluate `durationPath`/`eventObservedPath`/optional `entryPath`/`timestampPath` per row → `SurvivalObservation[]`, asOf-filter + sort. The projection arm is an **additive Ring-0 widen** (a new union member; the existing `EventLogObservationProjection` is unchanged) — it **ships UNPUBLISHED** (D2): the only consumer is substrate intra-repo; the release defers to the coordinated S4/S5 bump.

**Tech Stack:** TypeScript (ESM `.js`), Vitest, Zod, Prisma (`kernel.event_log` read via `GucPrismaRunner`). Repo: `layers/substrate` (`@de-braighter/substrate-{contracts,runtime}`). Builds on S3 (merged to main, `6be1a1d`). Stays **1.2.0** (no publish).

**Repo + branch:** from `layers/substrate`, `git fetch origin && git checkout -b feat/b3-s35-survival-production-read origin/main` (S3 is on main; the stale-local-main gotcha — always cut off origin/main).

**Conventions:** ESM `.js` imports. Survival types via `@de-braighter/substrate-contracts/inference` SUBPATH. `Result<T,E>` at fallible boundaries; the read NEVER throws across the port (a missing/wrong-shape/`read-model` projection → `[]`, mirroring `findNormalObservations`). One commit per task; TDD. **No publish** (the contracts widen is additive + inert; ships unpublished — record under contracts `[Unreleased]`).

**READ FIRST (precedents — absolute paths):**
- `libs/substrate-contracts/src/inference/observation-projection.ts` — the `ObservationProjection` union + `EventLogObservationProjection` (`:48-60`, the moment arm — UNCHANGED) + `ObservationSource` (`:33`, the OPEN union — non-foreclosure ADR-203 §11) + the barrel re-export check in `index.ts`.
- `libs/substrate-contracts/src/inference/observation-projection-zod.ts` — `JsonPathSchema` (`:28`), `EventLogObservationProjectionSchema` (`:39`), `ReadModelObservationProjectionSchema` (`:48`), `ObservationProjectionSchema = z.discriminatedUnion('source', […])` (`:59`).
- `libs/substrate-contracts/src/inference/json-path.ts` — `JsonPath` type (`:32`), `evaluateJsonPath(path, value): Result<unknown, JsonPathEvalError>` (`:176` — returns the leaf value; the runtime helpers type-check it), `asJsonPath` (`:158`).
- `libs/substrate-runtime/src/inference/adapters/prisma-evidence-log.repository.ts` — `findNormalObservations` (`:203-256`, the EXACT mirror), `findSurvivalObservations` (`:271-278`, the `[]` STUB to replace + its misleading doc comment), `readCandidateRows` (`:383-407`, GUC-scoped event_log read — only reads `projection.eventTypes`), `projectRow` (`:415-451`), `evalNumber` (`:453-484`), `evalIsoString` (`:486-515`).
- `libs/substrate-runtime/src/inference/inference-backbone-router.posterior-event-log.integration.spec.ts` — THE DB-gated read precedent: `SessionGucRunner` (`:62-78`), `insertReading` (`:114-135`, `INSERT INTO kernel.event_log …`), `cleanTenant` (`:137-143`), `describe.skipIf(!DB_URL)` (`:145`), the RLS-isolation case (`:209+`, app-gated).
- The S3/S3.5 design delta `docs/superpowers/specs/2026-06-09-b3-s3-survival-adapters-catalog-design.md` §6 (the settled S3.5 design).
- `SurvivalObservation` (the Ring-0 contract, S1): `{ durationT: number; eventObserved: boolean; entryT?: number; recordedAtIso: string }` on the `/inference` subpath.

---

## Task 1: Ring-0 `SurvivalEventLogObservationProjection` arm + Zod + barrel

**Files:**
- Modify: `libs/substrate-contracts/src/inference/observation-projection.ts`
- Modify: `libs/substrate-contracts/src/inference/observation-projection-zod.ts`
- Modify: `libs/substrate-contracts/src/inference/index.ts` (barrel — only if it names the arms individually; the union export may already cover it)
- Test: `libs/substrate-contracts/src/inference/observation-projection.survival.spec.ts` (new)

- [ ] **Step 1: Write the failing test** (`observation-projection.survival.spec.ts`):

```typescript
import { describe, expect, it } from 'vitest';
import { ObservationProjectionSchema } from './observation-projection-zod.js';
import type { ObservationProjection, SurvivalEventLogObservationProjection } from './observation-projection.js';

const survival: SurvivalEventLogObservationProjection = {
  indicatorKey: 'onc.recurrence',
  source: 'event-log',
  shape: 'survival',
  eventTypes: ['onc.recurrence.observed'],
  durationPath: 'payload.daysToEvent' as never,
  eventObservedPath: 'payload.eventObserved' as never,
  entryPath: 'payload.daysToEntry' as never,
  timestampPath: 'payload.recordedAt' as never,
};

const moment: ObservationProjection = {
  indicatorKey: 'football.pass_completion',
  source: 'event-log',
  eventTypes: ['drill.reading'],
  numeratorPath: 'payload.numerator' as never,
  timestampPath: 'payload.recordedAt' as never,
};

describe('SurvivalEventLogObservationProjection (B3-S3.5)', () => {
  it('parses a well-formed survival projection (source event-log + shape survival)', () => {
    expect(ObservationProjectionSchema.safeParse(survival).success).toBe(true);
  });

  it('still parses a moment event-log projection (no shape) — the existing arm is unchanged', () => {
    expect(ObservationProjectionSchema.safeParse(moment).success).toBe(true);
  });

  it('rejects a survival projection missing eventObservedPath', () => {
    const { eventObservedPath: _drop, ...rest } = survival;
    expect(ObservationProjectionSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a survival projection with a malformed JsonPath', () => {
    expect(ObservationProjectionSchema.safeParse({ ...survival, durationPath: 'payload..bad' }).success).toBe(false);
  });

  it('entryPath is optional', () => {
    const { entryPath: _drop, ...rest } = survival;
    expect(ObservationProjectionSchema.safeParse(rest).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`SurvivalEventLogObservationProjection` not exported). Run: `npx vitest run libs/substrate-contracts/src/inference/observation-projection.survival.spec.ts`.

- [ ] **Step 3: Implement the type** — in `observation-projection.ts`, add the arm (beside `EventLogObservationProjection`) + extend the union:

```typescript
/**
 * The survival `event-log` arm (ADR-223 B3-S3.5): derive right-censored
 * time-to-event readings (`SurvivalObservation`) by evaluating JSONB paths over
 * the matching `kernel.event_log` rows. Distinguished from the moment/count
 * {@link EventLogObservationProjection} by `shape: 'survival'` — the kernel reads
 * a duration + a censoring boolean (+ an optional left-truncation entry), never a
 * numerator/denominator. Additive: the existing moment arm is unchanged.
 */
export interface SurvivalEventLogObservationProjection {
  /** Registry key, e.g. `onc.recurrence`. */
  readonly indicatorKey: string;
  readonly source: 'event-log';
  /** Sub-discriminant distinguishing this from the moment/count event-log arm. */
  readonly shape: 'survival';
  /** `event_type` discriminators this indicator draws survival evidence from. */
  readonly eventTypes: readonly string[];
  /** JSONB path yielding the time-on-study `durationT` (number, > 0). */
  readonly durationPath: JsonPath;
  /** JSONB path yielding the censoring flag `eventObserved` (boolean; true = event at durationT). */
  readonly eventObservedPath: JsonPath;
  /** Optional JSONB path yielding the left-truncation entry time `entryT`. */
  readonly entryPath?: JsonPath;
  /** JSONB path yielding the observation instant (ISO 8601) → `recordedAtIso`. */
  readonly timestampPath: JsonPath;
}

export type ObservationProjection =
  | EventLogObservationProjection            // moment/count (no `shape`)
  | SurvivalEventLogObservationProjection    // survival (shape: 'survival')
  | ReadModelObservationProjection;
```

- [ ] **Step 4: Implement the Zod arm** — in `observation-projection-zod.ts`. NOTE: `z.discriminatedUnion('source', …)` CANNOT hold two `source:'event-log'` arms. Add the survival arm as a first-tried `z.union` wrapper around the EXISTING discriminated union (so the moment+read-model arms keep their discriminated-union error quality, and a survival projection — which has `shape:'survival'` + `durationPath`/`eventObservedPath` and NO `numeratorPath` — matches the survival schema first):

```typescript
const SurvivalEventLogObservationProjectionSchema = z.object({
  indicatorKey: z.string().min(1),
  source: z.literal('event-log'),
  shape: z.literal('survival'),
  eventTypes: z.array(z.string().min(1)).min(1),
  durationPath: JsonPathSchema,
  eventObservedPath: JsonPathSchema,
  entryPath: JsonPathSchema.optional(),
  timestampPath: JsonPathSchema,
});

/**
 * Discriminated-union schema for {@link ObservationProjection}. The survival
 * event-log arm shares `source:'event-log'` with the moment arm, so it cannot
 * live in the same `discriminatedUnion('source')`; it is tried FIRST as a union
 * arm (its `shape:'survival'` literal + required durationPath/eventObservedPath
 * make it disjoint from the moment arm, which requires numeratorPath and has no
 * shape). Moment + read-model keep their discriminated-union (good errors).
 */
export const ObservationProjectionSchema = z.union([
  SurvivalEventLogObservationProjectionSchema,
  z.discriminatedUnion('source', [
    EventLogObservationProjectionSchema,
    ReadModelObservationProjectionSchema,
  ]),
]);
```

- [ ] **Step 5: Barrel** — confirm `index.ts` re-exports the new type. If it re-exports the union/individual arms by name, add `SurvivalEventLogObservationProjection`; if it does `export * from './observation-projection.js'` the type is already covered (verify). Survival types resolve via the `/inference` subpath.

- [ ] **Step 6: Run — expect PASS** (all 5). Then `npx vitest run libs/substrate-contracts` to confirm no contracts regression (the widen is additive; the existing `observation-projection` zod spec must stay green — the moment + read-model arms parse exactly as before).

- [ ] **Step 7: Commit** `feat(substrate-contracts): SurvivalEventLogObservationProjection arm (B3-S3.5; unpublished)`.

---

## Task 2: `evalBoolean` + the real Prisma `findSurvivalObservations`

**Files:**
- Modify: `libs/substrate-runtime/src/inference/adapters/prisma-evidence-log.repository.ts`

- [ ] **Step 1: Implement** (no separate unit test here — the production read is exercised by the DB-gated integration test in Task 3, exactly as `findNormalObservations` is; the in-memory double's `findSurvivalObservations` already covers the unit contract). Three edits:

**(a)** Import the survival projection type (beside `EventLogObservationProjection` in the contracts import):
```typescript
import {
  evaluateJsonPath,
  type EventLogObservationProjection,
  type SurvivalEventLogObservationProjection,
  type SurvivalObservation,
} from '@de-braighter/substrate-contracts/inference';
```

**(b)** Widen `readCandidateRows`'s param type so the survival projection (which also carries `eventTypes`) can reuse it. Change its signature from `projection: EventLogObservationProjection` to a structural type that both arms satisfy:
```typescript
private async readCandidateRows(
  tenantPackId: string,
  projection: { readonly eventTypes: readonly string[] },
  subjectId: string,
): Promise<RawEventLogRow[]> {
```
(The body only reads `projection.eventTypes` — verify; no other field is used. The existing callers pass an `EventLogObservationProjection` which still satisfies `{ eventTypes }`.)

**(c)** Replace the `findSurvivalObservations` stub (`:271-278`) with the real read (mirror `findNormalObservations` + fix the doc comment to point at S3.5/S6):
```typescript
/**
 * findSurvivalObservations (ADR-223 B3-S3.5) — the right-censored time-to-event
 * evidence stream the survival adapters consume, read from `kernel.event_log`
 * through the GUC runner (tenant RLS, ADR-205 — tenant first arg). Resolves the
 * indicator's `ObservationProjection`; serves ONLY the survival event-log shape
 * (`source:'event-log'`, `shape:'survival'`) — a missing / `read-model` / moment
 * projection returns `[]` (the same total-port, no-throw posture as
 * {@link findNormalObservations}). `durationPath` → `durationT`,
 * `eventObservedPath` → `eventObserved` (boolean), optional `entryPath` →
 * `entryT`, `timestampPath` → `recordedAtIso`. A row whose paths don't resolve to
 * the right types is skipped (pack payload is opaque to the kernel). The live
 * production read awaits S6 seeding real survival events into `kernel.event_log`;
 * this method is exercised by the DB-gated integration spec + the in-memory double.
 */
async findSurvivalObservations(
  tenantPackId: string,
  subjectId: string,
  indicatorKey: string,
  asOfIso?: string,
): Promise<readonly SurvivalObservation[]> {
  const indicator = await this.catalog.findIndicator(indicatorKey);
  const projection = indicator?.observationProjection;
  if (!projection) return [];
  if (projection.source === 'read-model') {
    this.logger.warn({
      event: 'evidence.read_model_arm_not_supported',
      indicatorKey,
      readModel: projection.readModel,
    });
    return [];
  }
  // Only the survival event-log shape serves this read; a moment projection
  // (no `shape`) is for findObservations/findNormalObservations, not here.
  if (!('shape' in projection) || projection.shape !== 'survival') return [];
  const survivalProjection = projection as SurvivalEventLogObservationProjection;

  const rows = await this.readCandidateRows(tenantPackId, survivalProjection, subjectId);

  const readings: SurvivalObservation[] = [];
  for (const row of rows) {
    const durationT = this.evalNumber(
      survivalProjection.durationPath, row.payload, indicatorKey, row.event_type, 'durationPath',
    );
    if (durationT === null) continue;
    const eventObserved = this.evalBoolean(
      survivalProjection.eventObservedPath, row.payload, indicatorKey, row.event_type, 'eventObservedPath',
    );
    if (eventObserved === null) continue;
    const recordedAtIso = this.evalIsoString(
      survivalProjection.timestampPath, row.payload, indicatorKey, row.event_type,
    );
    if (recordedAtIso === null) continue;
    if (asOfIso !== undefined && recordedAtIso > asOfIso) continue;
    const reading: SurvivalObservation = { durationT, eventObserved, recordedAtIso };
    if (survivalProjection.entryPath !== undefined) {
      const entryT = this.evalNumber(
        survivalProjection.entryPath, row.payload, indicatorKey, row.event_type, 'entryPath',
      );
      if (entryT !== null) (reading as { entryT?: number }).entryT = entryT;
    }
    readings.push(reading);
  }

  readings.sort((a, b) =>
    a.recordedAtIso < b.recordedAtIso ? -1 : a.recordedAtIso > b.recordedAtIso ? 1 : 0,
  );
  return readings;
}
```

**(d)** Add the `evalBoolean` helper (beside `evalNumber`/`evalIsoString`, mirroring their shape):
```typescript
private evalBoolean(
  path: string,
  payload: unknown,
  indicatorKey: string,
  eventType: string,
  which: string,
): boolean | null {
  const res = evaluateJsonPath(path, payload);
  if (!res.ok) {
    this.logger.debug({
      event: 'evidence.path_unresolved',
      indicatorKey, eventType, which, path, reason: res.error.kind,
    });
    return null;
  }
  const v = res.value;
  if (typeof v !== 'boolean') {
    this.logger.debug({
      event: 'evidence.path_not_a_boolean',
      indicatorKey, eventType, which, path,
    });
    return null;
  }
  return v;
}
```

- [ ] **Step 2: Build + typecheck** — `npx nx build substrate-runtime` (the survival projection import resolves; the `readCandidateRows` widening compiles for all callers). Run the existing inference unit suite `npx vitest run libs/substrate-runtime/src/inference` — no regression (the in-memory double's `findSurvivalObservations` + the adapter specs unchanged).
- [ ] **Step 3: Commit** `feat(substrate-runtime): real Prisma findSurvivalObservations over the survival event-log projection + evalBoolean (B3-S3.5)`.

---

## Task 3: DB-gated survival event_log read integration test

**Files:**
- Create: `libs/substrate-runtime/src/inference/prisma-evidence-log.find-survival-observations.integration.spec.ts`

Mirror `inference-backbone-router.posterior-event-log.integration.spec.ts` (the same `SessionGucRunner` + `insertSurvivalEvent` + `cleanTenant` + `describe.skipIf(!DB_URL)` shape).

- [ ] **Step 1: Write the test:**

```typescript
// Hexagonal: scope:out-adapter (ADR-110). DB-gated (SUBSTRATE_DATABASE_URL).
// Proves the production survival read over kernel.event_log: durations + censoring
// flags read through the survival ObservationProjection, GUC-scoped (RLS), asOf-
// filtered. Mirrors inference-backbone-router.posterior-event-log.integration.spec.ts.
//   SUBSTRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/substrate \
//     npx vitest run libs/substrate-runtime/src/inference/prisma-evidence-log.find-survival-observations.integration.spec.ts

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { asJsonPath, type JsonPath } from '@de-braighter/substrate-contracts/inference';
import { InMemoryInferenceCatalog } from './in-memory-inference-catalog.js';
import { PrismaEvidenceLogRepository } from './adapters/prisma-evidence-log.repository.js';

const DB_URL = process.env['SUBSTRATE_DATABASE_URL'];
const APP_URL = process.env['SUBSTRATE_APP_DATABASE_URL'];
const TENANT = '00000000-0000-0000-0000-0000000000a1';
const OTHER_TENANT = '00000000-0000-0000-0000-0000000000a2';
const SUBJECT = '00000000-0000-0000-0000-0000000000b1';
const INDICATOR = 'onc.recurrence';
const EVENT_TYPE = 'onc.recurrence.observed';

function jp(raw: string): JsonPath {
  const r = asJsonPath(raw);
  if (!r.ok) throw new Error(`bad JsonPath: ${raw}`);
  return r.value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;

class SessionGucRunner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly p: any) {}
  async run<T>(tenantPackId: string, fn: (tx: { $queryRawUnsafe<R = unknown>(sql: string, ...v: unknown[]): Promise<R> }) => Promise<T>): Promise<T> {
    await this.p.$queryRawUnsafe(`SELECT set_config('app.tenant_pack_id', $1, false)`, tenantPackId);
    return fn(this.p);
  }
}

function buildCatalog(): InMemoryInferenceCatalog {
  const catalog = new InMemoryInferenceCatalog();
  catalog.register({
    indicatorKey: INDICATOR as never,
    conjugateHint: null,
    observationProjection: {
      indicatorKey: INDICATOR,
      source: 'event-log',
      shape: 'survival',
      eventTypes: [EVENT_TYPE],
      durationPath: jp('durationT'),
      eventObservedPath: jp('eventObserved'),
      timestampPath: jp('recordedAt'),
    },
  } as never);
  return catalog;
}

async function setGuc(t: string): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT set_config('app.tenant_pack_id', $1, false)`, t);
}
async function insertSurvivalEvent(tenant: string, subject: string, durationT: number, eventObserved: boolean, recordedAtIso: string): Promise<void> {
  await setGuc(tenant);
  await prisma.$executeRawUnsafe(
    `INSERT INTO kernel.event_log (id, tenant_pack_id, aggregate_type, aggregate_id, event_type, payload, metadata, occurred_at, recorded_at)
     VALUES ($1::uuid, $2::uuid, 'Subject', $3::uuid, $4, $5::jsonb, '{}'::jsonb, $6::timestamptz, $6::timestamptz)`,
    randomUUID(), tenant, subject, EVENT_TYPE,
    JSON.stringify({ durationT, eventObserved, recordedAt: recordedAtIso }), recordedAtIso,
  );
}
async function cleanTenant(t: string): Promise<void> {
  await setGuc(t);
  await prisma.$executeRawUnsafe(`DELETE FROM kernel.event_log WHERE tenant_pack_id = $1::uuid`, t);
}

describe.skipIf(!DB_URL)('PrismaEvidenceLogRepository.findSurvivalObservations — real event_log (B3-S3.5)', () => {
  let evidence: PrismaEvidenceLogRepository;
  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
    const runner = new SessionGucRunner(prisma);
    evidence = new PrismaEvidenceLogRepository(
      runner as unknown as ConstructorParameters<typeof PrismaEvidenceLogRepository>[0],
      buildCatalog(),
    );
    await cleanTenant(TENANT);
    await cleanTenant(OTHER_TENANT);
  }, 60_000);
  afterAll(async () => {
    if (!prisma) return;
    try { await cleanTenant(TENANT); await cleanTenant(OTHER_TENANT);
      await prisma.$executeRawUnsafe(`SELECT set_config('app.tenant_pack_id', '00000000-0000-0000-0000-000000000000', false)`);
    } catch { /* ignore */ }
    await prisma.$disconnect();
  });

  it('reads durations + censoring flags back, sorted by recordedAt', async () => {
    await insertSurvivalEvent(TENANT, SUBJECT, 5, true, '2026-05-01T10:00:00.000Z');
    await insertSurvivalEvent(TENANT, SUBJECT, 8, false, '2026-05-02T10:00:00.000Z');
    const got = await evidence.findSurvivalObservations(TENANT, SUBJECT, INDICATOR);
    expect(got.map((o) => [o.durationT, o.eventObserved])).toEqual([[5, true], [8, false]]);
    expect(got.every((o) => typeof o.recordedAtIso === 'string')).toBe(true);
  }, 30_000);

  it('respects asOf (excludes readings after the cutoff)', async () => {
    const got = await evidence.findSurvivalObservations(TENANT, SUBJECT, INDICATOR, '2026-05-01T12:00:00.000Z');
    expect(got.map((o) => o.durationT)).toEqual([5]);
  }, 30_000);

  // The TRUE RLS guarantee — app-role only (the superuser DB_URL is BYPASSRLS).
  it.skipIf(!APP_URL)('on the app role, another tenant reads NONE of those rows (RLS gate)', async () => {
    const got = await evidence.findSurvivalObservations(OTHER_TENANT, SUBJECT, INDICATOR);
    expect(got).toEqual([]);
  }, 30_000);
});
```

> **CONFIRM:** the `InMemoryInferenceCatalog.register` shape + the `PrismaEvidenceLogRepository` ctor arg order against the precedent (`…posterior-event-log.integration.spec.ts:88-160`). The catalog `register` cast `as never` mirrors how the precedent registers a projection-bearing indicator. Match the precedent's `APP_URL` env-var name if it differs.

- [ ] **Step 2: Run the DB gate:**
  ```bash
  npm run db:setup   # ensure DB up + migrations applied
  SUBSTRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/substrate \
    npx vitest run libs/substrate-runtime/src/inference/prisma-evidence-log.find-survival-observations.integration.spec.ts
  ```
  Expected: the read + asOf cases PASS (the RLS case skips without `SUBSTRATE_APP_DATABASE_URL` — note that honestly). If the DB cannot come up, report DONE_WITH_CONCERNS (don't fake it) — the read logic is a faithful mirror of the DB-proven `findNormalObservations`, so the unit-level confidence is high; the integration proof needs the DB.
- [ ] **Step 3: Commit** `test(substrate-runtime): DB-gated survival event_log read (durations + censoring + asOf + RLS) (B3-S3.5)`.

---

## Task 4: Changelog + full gate + PR + verifier wave

- [ ] **Step 1: Changelog** — add a B3-S3.5 entry to BOTH `libs/substrate-contracts/CHANGELOG.md` `[Unreleased]` (the additive `SurvivalEventLogObservationProjection` arm — **unpublished**; release deferred to the coordinated S4/S5 bump) and `libs/substrate-runtime/CHANGELOG.md` `[Unreleased]` (the real `findSurvivalObservations` read + `evalBoolean`). Match the B3-S3 entry format.
- [ ] **Step 2: Full DB-free gate** — `npm run ci:local` green (build + lint + all tests; the new contracts spec + the inference suite; confirm NO regression — the projection widen is additive, the read mirrors findNormalObservations). Report counts.
- [ ] **Step 3: Full DB gate** — `npm run db:setup` + the Task-3 integration spec (the read + asOf cases) + the existing WS-9/survival DB specs.
- [ ] **Step 4: PR** — push + open via `gh pr create --body-file -` (NOT `--body @-` — the S3 gotcha). Body:
  - Scope: S3.5 = the Ring-0 `SurvivalEventLogObservationProjection` arm (additive, **UNPUBLISHED** — stays 1.2.0) + `evalBoolean` + the real Prisma `findSurvivalObservations` (replaces the `[]` stub) + the DB-gated RLS read test. The founder pulled this forward from S6 (D1/D4). The moment + read-model projection arms are unchanged; `findObservations`/`findNormalObservations` untouched.
  - Kernel-minimality: additive union arm, no new table, no new port method (the `findSurvivalObservations` method already existed as a stub). The ADR-203 §11 non-foreclosure (the projection union is OPEN) sanctions the additive arm.
  - `Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]` · `Effort: deep` · `Effect: cycle-time 0.01±0.02 expert` · `Effect: findings 1±2 expert`.
  - `Tech design:` the S3/S3.5 design delta §6 + ADR-223. "Part of B3 (ADR-223)."
- [ ] **Step 5: Verifier wave** — `reviewer` + `charter-checker` (the additive Ring-0 arm + the non-foreclosure; no concern-set growth; no new port method) + `qa-engineer` (the read correctness mirror, the `evalBoolean` type-guard, the asOf + RLS coverage, the Zod-union disjointness), all `isolation: worktree`; + my `ci:local` as local-ci evidence. Automerge on green (`gh pr merge --squash --admin`). Twin ritual (`drain`/`backfill de-braighter/substrate`/`reconcile`). Update the oncology memory (S3.5 shipped → S4 next).

---

## Self-Review (plan author)

**Spec coverage (design delta §6):** the Ring-0 `SurvivalEventLogObservationProjection` arm + Zod + barrel → Task 1; `evalBoolean` → Task 2 (d); the real Prisma `findSurvivalObservations` mirroring `findNormalObservations` + the stale-comment fix → Task 2 (c); the DB-gated RLS read test → Task 3; unpublished (no publish, contracts `[Unreleased]` note) → Task 4. All §6 items covered.

**Placeholder scan:** Task 1 (full type + Zod + tests), Task 2 (full read + evalBoolean + the readCandidateRows widening), Task 3 (full DB test mirroring the precedent) all ship concrete code. The two CONFIRM points (the barrel re-export style; the catalog `register` + ctor shapes vs the precedent) are explicit reads, not placeholders.

**Type consistency:** `SurvivalEventLogObservationProjection` (Task 1, contracts) consumed by `findSurvivalObservations` (Task 2, runtime) + the integration test's catalog (Task 3). `evalBoolean` (Task 2) returns `boolean | null` matching `SurvivalObservation.eventObserved`. `readCandidateRows`'s widened `{ eventTypes }` param satisfied by both `EventLogObservationProjection` (existing callers) + `SurvivalEventLogObservationProjection` (new caller). `SurvivalObservation {durationT, eventObserved, entryT?, recordedAtIso}` (S1 contract) is the read's output. The Zod `ObservationProjectionSchema` union (Task 1) parses all three arms.

**Zod-union correctness note:** the survival arm is tried FIRST in the `z.union`; it is disjoint from the moment arm (requires `shape:'survival'` + `durationPath`/`eventObservedPath`; the moment arm requires `numeratorPath` + has no `shape`), so a survival projection matches survival and a moment projection falls through to the inner `discriminatedUnion('source')`. The existing moment + read-model error quality is preserved.
