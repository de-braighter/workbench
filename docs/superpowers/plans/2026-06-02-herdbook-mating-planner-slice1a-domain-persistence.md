# Herdbook Mating Planner — Slice 1a (Domain + Persistence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend domain + persistence for the planned-matings registry: the `planned_mating` table, a read-only mating **evaluator** (predicted offspring inbreeding coefficient via the kernel `kinship` port + a per-tenant-threshold verdict + shared ancestors), and a **registry** (CRUD + offspring link + predicted-vs-actual) — all DB-tested. No HTTP layer (that's Slice 1b), no UI (Slice 2).

**Architecture:** Pack-native over the published kernel `LineageRepository` port. The evaluator consumes `getIndividual` (sex), `kinship(sire,dam)` (= predicted offspring F), `commonAncestors` (the why), and `inbreedingCoefficient` (offspring actual F). A new `planned_mating` pack table stores sire/dam as kernel-individual-id logical refs + a snapshot of predicted F + verdict. Offspring link via a nullable FK on `animal` (mirrors `litter_id`). Zero kernel change — a mating fails the ADR-176 inclusion test (one pack).

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Prisma (PostgreSQL, `multiSchema`, schema `herdbook`), raw SQL via `ScopedRunner.run(tenantPackId, tx => …)`, Vitest (fakeRunner shape-tests + `skipIf(!DB||!RLS)` integration), Postgres RLS via `app.tenant_pack_id`.

**Spec:** `docs/superpowers/specs/2026-06-02-herdbook-mating-planner-design.md`. **Repo:** `domains/herdbook` (branch off `main`). PR-gated.

---

## File Structure

**Modify:**
- `libs/herdbook-pack/prisma/schema.prisma` — `MatingVerdict` + `MatingStatus` enums, `PlannedMating` model, `Animal.fromPlannedMatingId` FK + `PlannedMating.offspring` back-relation.
- `libs/herdbook-pack/src/index.ts` — export the new port + view-models.

**Create:**
- `libs/herdbook-pack/prisma/migrations/0005_planned_mating/migration.sql` — table + enums + offspring column + RLS + GRANTs.
- `libs/herdbook-pack/src/application/planned-mating.view-models.ts` — domain types.
- `libs/herdbook-pack/src/application/planned-mating.port.ts` — `PlannedMatingRepository` + `SettingReader` interfaces.
- `libs/herdbook-pack/src/application/mating-verdict.ts` (+ `.spec.ts`) — pure verdict classifier.
- `libs/herdbook-pack/src/application/adapters/prisma-setting-read.adapter.ts` (+ `.spec.ts`) — `Setting` key read.
- `libs/herdbook-pack/src/application/mating-evaluator.service.ts` (+ `.spec.ts`) — the evaluator.
- `libs/herdbook-pack/src/application/adapters/prisma-planned-mating.adapter.ts` (+ `.spec.ts`) — the registry adapter.
- `libs/herdbook-pack/src/application/planned-mating-audit.service.ts` — audit emitter.
- `libs/herdbook-pack/src/application/planned-mating.service.ts` (+ `.spec.ts`) — the registry service.
- `libs/herdbook-pack/src/application/adapters/planned-mating-db.spec.ts` — DB-gated integration.

**Convention anchors (read to copy style):** `adapters/prisma-characteristic-definition.adapter.ts` (adapter + shape-test), `adapters/prisma-individual-read.adapter.ts` (`ScopedRunner`/`ScopedTx`), `prisma/migrations/0004_characteristic_metamodel/migration.sql` (table+RLS+GRANT), `adapters/characteristic-metamodel-db.spec.ts` (DB-gated pattern), `animal-audit.service.ts` (audit).

---

## Task 0: Branch and ground

- [ ] **Step 1: Branch**

```bash
cd domains/herdbook
git checkout main && git pull --ff-only
git checkout -b feat/mating-planner-slice1a-domain
```

- [ ] **Step 2: Confirm migration number + models you depend on**

```bash
ls libs/herdbook-pack/prisma/migrations/
# Expect 0001..0004 → next is 0005.
grep -nE "model (Animal|Setting) |kernel_individual_id" libs/herdbook-pack/prisma/schema.prisma | head
# Animal has id + kernel_individual_id + sex? (sex is NOT on animal — it's on core.individual). Confirm litter_id exists as the FK precedent.
```

Expected: migrations end at `0004`; `Animal` model present with `kernelIndividualId` + `litterId`; `Setting` model present.

---

## Task 1: Schema — enums + PlannedMating model + offspring FK

**Files:** Modify `libs/herdbook-pack/prisma/schema.prisma`

- [ ] **Step 1: Add the two enums** (beside the existing `enum AnimalPersonRoleKind`)

```prisma
enum MatingVerdict {
  green
  amber
  red

  @@schema("herdbook")
}

enum MatingStatus {
  planned
  mated
  offspring_registered
  cancelled

  @@schema("herdbook")
}
```

- [ ] **Step 2: Add the `PlannedMating` model**

```prisma
model PlannedMating {
  id                      String        @id @default(uuid())
  tenantPackId            String        @map("tenant_pack_id")
  sireKernelIndividualId  String        @map("sire_kernel_individual_id") // logical ref → core.individual.id
  damKernelIndividualId   String        @map("dam_kernel_individual_id")  // logical ref → core.individual.id
  predictedF              Decimal       @map("predicted_f") @db.Decimal(8, 6)
  predictedVerdict        MatingVerdict @map("predicted_verdict")
  status                  MatingStatus  @default(planned)
  plannedDate             DateTime      @map("planned_date") @db.Date
  notes                   String?
  createdAt               DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt               DateTime      @updatedAt @map("updated_at") @db.Timestamptz(6)
  createdByUserId         String        @map("created_by_user_id")
  updatedByUserId         String        @map("updated_by_user_id")

  offspring Animal[]

  @@index([tenantPackId])
  @@map("planned_mating")
  @@schema("herdbook")
}
```

- [ ] **Step 3: Add the offspring FK to `Animal`** (inside `model Animal { … }`)

```prisma
  fromPlannedMatingId String? @map("from_planned_mating_id")
  fromPlannedMating   PlannedMating? @relation(fields: [fromPlannedMatingId], references: [id], onDelete: SetNull)
```

(and add `@@index([fromPlannedMatingId])` to the Animal indexes alongside the existing `@@index([litterId])`.)

- [ ] **Step 4: Validate + commit**

Run: `pnpm --filter herdbook-pack exec prisma validate --schema prisma/schema.prisma`
Expected: `valid`.

```bash
git add libs/herdbook-pack/prisma/schema.prisma
git commit -m "feat(herdbook): planned_mating schema models + offspring FK (mating planner)"
```

---

## Task 2: Migration 0005 — table + enums + RLS + GRANTs

**Files:** Create `libs/herdbook-pack/prisma/migrations/0005_planned_mating/migration.sql`

- [ ] **Step 1: Hand-author the migration** (matches the 0004 style)

```sql
-- 0005_planned_mating
CREATE TYPE "herdbook"."MatingVerdict" AS ENUM ('green', 'amber', 'red');
CREATE TYPE "herdbook"."MatingStatus" AS ENUM ('planned', 'mated', 'offspring_registered', 'cancelled');

CREATE TABLE "herdbook"."planned_mating" (
  "id"                         TEXT PRIMARY KEY,
  "tenant_pack_id"             TEXT NOT NULL,
  "sire_kernel_individual_id"  TEXT NOT NULL,
  "dam_kernel_individual_id"   TEXT NOT NULL,
  "predicted_f"                DECIMAL(8,6) NOT NULL,
  "predicted_verdict"          "herdbook"."MatingVerdict" NOT NULL,
  "status"                     "herdbook"."MatingStatus" NOT NULL DEFAULT 'planned',
  "planned_date"               DATE NOT NULL,
  "notes"                      TEXT,
  "created_at"                 TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"                 TIMESTAMPTZ(6) NOT NULL,
  "created_by_user_id"         TEXT NOT NULL,
  "updated_by_user_id"         TEXT NOT NULL
);
CREATE INDEX "planned_mating_tenant_idx" ON "herdbook"."planned_mating" ("tenant_pack_id");

ALTER TABLE "herdbook"."animal"
  ADD COLUMN "from_planned_mating_id" TEXT
  REFERENCES "herdbook"."planned_mating"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "animal_from_planned_mating_idx" ON "herdbook"."animal" ("from_planned_mating_id");

-- RLS (mirror 0002/0004)
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['planned_mating'] LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', 'herdbook', t);
    EXECUTE format('ALTER TABLE %I.%I FORCE  ROW LEVEL SECURITY', 'herdbook', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_pack_isolation ON %I.%I', 'herdbook', t);
    EXECUTE format(
      'CREATE POLICY tenant_pack_isolation ON %I.%I '
      || 'USING (tenant_pack_id = current_setting(''app.tenant_pack_id'', true)) '
      || 'WITH CHECK (tenant_pack_id = current_setting(''app.tenant_pack_id'', true))',
      'herdbook', t
    );
  END LOOP;
END$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON "herdbook"."planned_mating" TO "app";
```

- [ ] **Step 2: Apply + verify** (DB is live on :5433)

Run: `pnpm run db:generate && pnpm run db:setup`
Expected: `0005_planned_mating` applied. Verify:
```bash
docker exec -e PGPASSWORD=postgres herdbook-postgres psql -U postgres -d herdbook -tAc \
  "SELECT to_regclass('herdbook.planned_mating'), (SELECT count(*) FROM information_schema.columns WHERE table_schema='herdbook' AND table_name='animal' AND column_name='from_planned_mating_id');"
```
Expected: table non-null + `1` (the new animal column). (If 0005 fails partway: drop its objects + the `animal` column + its `_prisma_migrations` row, then re-run `db:setup` — Prisma 6 blocks `migrate reset`.)

- [ ] **Step 3: Commit**

```bash
git add libs/herdbook-pack/prisma/migrations/0005_planned_mating/migration.sql
git commit -m "feat(herdbook): planned_mating migration — table + enums + offspring FK + RLS + grants"
```

---

## Task 3: view-models + ports

**Files:** Create `libs/herdbook-pack/src/application/planned-mating.view-models.ts` + `planned-mating.port.ts`

- [ ] **Step 1: view-models**

```typescript
// planned-mating.view-models.ts
export type MatingVerdict = 'green' | 'amber' | 'red';
export type MatingStatus = 'planned' | 'mated' | 'offspring_registered' | 'cancelled';

export interface InbreedingThresholds {
  amber: number; // F at/above this → amber
  red: number;   // F at/above this → red
}

export interface SharedAncestor {
  ancestorKernelIndividualId: string;
  genViaSire: number; // generations back via the sire (CommonAncestorResult.genA)
  genViaDam: number;  // via the dam (genB)
}

export interface MatingEvaluation {
  sireKernelIndividualId: string;
  damKernelIndividualId: string;
  predictedF: number;    // [0,1]
  predictedFPct: number; // predictedF * 100
  verdict: MatingVerdict;
  thresholds: InbreedingThresholds;
  sharedAncestors: SharedAncestor[];
}

export interface CreatePlannedMatingInput {
  sireKernelIndividualId: string;
  damKernelIndividualId: string;
  plannedDate: string; // ISO yyyy-mm-dd
  notes?: string | null;
  actorUserId: string;
}

export interface PlannedMatingRow {
  id: string;
  sireKernelIndividualId: string;
  damKernelIndividualId: string;
  predictedF: number;
  predictedVerdict: MatingVerdict;
  status: MatingStatus;
  plannedDate: string; // ISO yyyy-mm-dd
  notes: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO
}

export interface OffspringActual {
  kernelIndividualId: string;
  actualF: number | null; // live inbreedingCoefficient, null if unavailable
}

export interface PlannedMatingDetail extends PlannedMatingRow {
  liveKinship: number | null; // current kinship(sire,dam) recompute (drift vs predictedF)
  offspring: OffspringActual[];
}
```

- [ ] **Step 2: ports**

```typescript
// planned-mating.port.ts
import type {
  CreatePlannedMatingInput,
  MatingStatus,
  MatingVerdict,
  PlannedMatingRow,
} from './planned-mating.view-models.js';

/** Read one tenant setting value by key (for the per-tenant inbreeding thresholds). */
export interface SettingReader {
  getByKey(tenantPackId: string, key: string): Promise<string | null>;
}

export interface InsertPlannedMatingInput extends CreatePlannedMatingInput {
  predictedF: number;
  predictedVerdict: MatingVerdict;
}

export interface PlannedMatingRepository {
  insert(tenantPackId: string, input: InsertPlannedMatingInput): Promise<string>;
  list(tenantPackId: string): Promise<PlannedMatingRow[]>;
  findById(tenantPackId: string, id: string): Promise<PlannedMatingRow | null>;
  updateStatus(tenantPackId: string, id: string, status: MatingStatus, actorUserId: string): Promise<void>;
  updateNotes(tenantPackId: string, id: string, notes: string | null, actorUserId: string): Promise<void>;
  /** Set `from_planned_mating_id` on the offspring's animal row (resolved by kernel_individual_id). */
  linkOffspring(tenantPackId: string, id: string, offspringKernelIndividualId: string): Promise<void>;
  unlinkOffspring(tenantPackId: string, id: string, offspringKernelIndividualId: string): Promise<void>;
  listOffspringKernelIds(tenantPackId: string, id: string): Promise<string[]>;
}
```

- [ ] **Step 3: typecheck + commit**

Run: `pnpm --filter herdbook-pack run typecheck`
Expected: clean.
```bash
git add libs/herdbook-pack/src/application/planned-mating.view-models.ts libs/herdbook-pack/src/application/planned-mating.port.ts
git commit -m "feat(herdbook): planned-mating port + view-models"
```

---

## Task 4: Verdict classifier (pure)

**Files:** Create `libs/herdbook-pack/src/application/mating-verdict.ts` + `.spec.ts`

- [ ] **Step 1: Failing test**

```typescript
// mating-verdict.spec.ts
import { describe, expect, it } from 'vitest';
import { classifyVerdict, DEFAULT_THRESHOLDS, parseThresholds } from './mating-verdict.js';

describe('classifyVerdict', () => {
  const t = { amber: 0.03125, red: 0.0625 };
  it('green below amber', () => expect(classifyVerdict(0.0, t)).toBe('green'));
  it('green just under amber', () => expect(classifyVerdict(0.03, t)).toBe('green'));
  it('amber at the amber threshold (inclusive)', () => expect(classifyVerdict(0.03125, t)).toBe('amber'));
  it('amber between thresholds', () => expect(classifyVerdict(0.05, t)).toBe('amber'));
  it('red at the red threshold (inclusive)', () => expect(classifyVerdict(0.0625, t)).toBe('red'));
  it('red above', () => expect(classifyVerdict(0.25, t)).toBe('red'));
});

describe('parseThresholds', () => {
  it('uses defaults when both values are null', () => {
    expect(parseThresholds(null, null)).toEqual(DEFAULT_THRESHOLDS);
  });
  it('parses provided numeric strings', () => {
    expect(parseThresholds('0.01', '0.10')).toEqual({ amber: 0.01, red: 0.1 });
  });
  it('falls back per-field on unparseable input', () => {
    expect(parseThresholds('nope', '0.10')).toEqual({ amber: DEFAULT_THRESHOLDS.amber, red: 0.1 });
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter herdbook-pack exec vitest run src/application/mating-verdict.spec.ts` (not defined).

- [ ] **Step 3: Implement**

```typescript
// mating-verdict.ts
import type { InbreedingThresholds, MatingVerdict } from './planned-mating.view-models.js';

/** Conventional defaults: amber >= 1/32 (half-cousins), red >= 1/16 (first cousins). */
export const DEFAULT_THRESHOLDS: InbreedingThresholds = { amber: 0.03125, red: 0.0625 };

export const SETTING_KEY_AMBER = 'mating.inbreeding.amberThreshold';
export const SETTING_KEY_RED = 'mating.inbreeding.redThreshold';

export function classifyVerdict(f: number, t: InbreedingThresholds): MatingVerdict {
  if (f >= t.red) return 'red';
  if (f >= t.amber) return 'amber';
  return 'green';
}

function parseOne(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function parseThresholds(amberRaw: string | null, redRaw: string | null): InbreedingThresholds {
  return {
    amber: parseOne(amberRaw, DEFAULT_THRESHOLDS.amber),
    red: parseOne(redRaw, DEFAULT_THRESHOLDS.red),
  };
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add … && git commit -m "feat(herdbook): mating verdict classifier + threshold parsing"`

---

## Task 5: Setting read adapter

**Files:** Create `libs/herdbook-pack/src/application/adapters/prisma-setting-read.adapter.ts` + `.spec.ts`

- [ ] **Step 1: Failing shape test**

```typescript
// prisma-setting-read.adapter.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { PrismaSettingReadAdapter } from './prisma-setting-read.adapter.js';

function fakeRunner(rows: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = { $queryRawUnsafe: vi.fn(async (sql: string, ...p: unknown[]) => { calls.push({ sql, params: p }); return rows; }) };
  return { runner: { run: async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) }, calls };
}
const T = 'herdbook-tpid-0001';

describe('PrismaSettingReadAdapter', () => {
  it('selects herdbook.setting value by key and returns it', async () => {
    const { runner, calls } = fakeRunner([{ value: '0.05' }]);
    const out = await new PrismaSettingReadAdapter(runner as never).getByKey(T, 'mating.inbreeding.amberThreshold');
    expect(out).toBe('0.05');
    expect(calls[0]?.sql).toMatch(/herdbook.*setting/s);
    expect(calls[0]?.params).toContain('mating.inbreeding.amberThreshold');
  });
  it('returns null when the key is absent', async () => {
    const { runner } = fakeRunner([]);
    expect(await new PrismaSettingReadAdapter(runner as never).getByKey(T, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```typescript
// prisma-setting-read.adapter.ts
import type { SettingReader } from '../planned-mating.port.js';
import type { ScopedRunner } from './prisma-individual-read.adapter.js';

export class PrismaSettingReadAdapter implements SettingReader {
  constructor(private readonly runner: ScopedRunner) {}

  getByKey(t: string, key: string): Promise<string | null> {
    return this.runner.run(t, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `SELECT value FROM "herdbook"."setting" WHERE key = $2 LIMIT 1`,
        t,
        key,
      )) as { value: string | null }[];
      return rows[0]?.value ?? null;
    });
  }
}
```

- [ ] **Step 4: Run → PASS. Step 5: Commit** — `"feat(herdbook): setting read adapter (per-tenant key lookup)"`

---

## Task 6: Mating evaluator service

**Files:** Create `libs/herdbook-pack/src/application/mating-evaluator.service.ts` + `.spec.ts`

- [ ] **Step 1: Failing test** (fakes for `lineage` + `settings`)

```typescript
// mating-evaluator.service.spec.ts
import { describe, expect, it } from 'vitest';
import { MatingEvaluatorService } from './mating-evaluator.service.js';

const ok = <T>(value: T) => ({ ok: true as const, value });
const indiv = (id: string, sex: 'm' | 'f') => ok({ kernelIndividualId: id, tvdNr: null, marking: null, name: id, sex, birthDate: null, birthDateCertain: null });

function fakeLineage(over: Record<string, unknown> = {}) {
  return {
    getIndividual: async (id: string) => (id === 'sire' ? indiv('sire', 'm') : indiv('dam', 'f')),
    kinship: async () => ok(0.05),
    commonAncestors: async () => ok([{ ancestorId: 'gp', genA: 2, genB: 2 }]),
    inbreedingCoefficient: async () => ok(0),
    ...over,
  };
}
const noSettings = { getByKey: async () => null };
const T = 'herdbook-tpid-0001';

describe('MatingEvaluatorService', () => {
  it('computes predicted F, verdict (amber for 0.05 default), and shared ancestors', async () => {
    const svc = new MatingEvaluatorService(fakeLineage() as never, noSettings, T);
    const r = await svc.evaluate('sire', 'dam');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.predictedF).toBeCloseTo(0.05);
    expect(r.value.predictedFPct).toBeCloseTo(5);
    expect(r.value.verdict).toBe('amber'); // 0.03125 <= 0.05 < 0.0625
    expect(r.value.sharedAncestors).toEqual([{ ancestorKernelIndividualId: 'gp', genViaSire: 2, genViaDam: 2 }]);
  });
  it('rejects a non-male sire', async () => {
    const lineage = fakeLineage({ getIndividual: async () => indiv('x', 'f') });
    const r = await new MatingEvaluatorService(lineage as never, noSettings, T).evaluate('sire', 'dam');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.kind).toBe('invalid-pairing');
  });
  it('rejects sire === dam', async () => {
    const r = await new MatingEvaluatorService(fakeLineage() as never, noSettings, T).evaluate('sire', 'sire');
    expect(r.ok).toBe(false);
  });
  it('honors per-tenant thresholds (0.05 becomes green when amber raised to 0.06)', async () => {
    const settings = { getByKey: async (_t: string, k: string) => (k.includes('amber') ? '0.06' : '0.12') };
    const r = await new MatingEvaluatorService(fakeLineage() as never, settings, T).evaluate('sire', 'dam');
    expect(r.ok && r.value.verdict).toBe('green');
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```typescript
// mating-evaluator.service.ts
import type { LineageRepository, IndividualId } from '@de-braighter/substrate-contracts';
import { classifyVerdict, parseThresholds, SETTING_KEY_AMBER, SETTING_KEY_RED } from './mating-verdict.js';
import type { SettingReader } from './planned-mating.port.js';
import type { MatingEvaluation } from './planned-mating.view-models.js';

export type MatingEvaluationError =
  | { kind: 'invalid-pairing'; message: string }
  | { kind: 'lineage-failure'; message: string };

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export class MatingEvaluatorService {
  constructor(
    private readonly lineage: LineageRepository,
    private readonly settings: SettingReader,
    private readonly tenantPackId: string,
  ) {}

  async evaluate(
    sireKernelId: string,
    damKernelId: string,
  ): Promise<Result<MatingEvaluation, MatingEvaluationError>> {
    if (sireKernelId === damKernelId) {
      return err({ kind: 'invalid-pairing', message: 'sire and dam must be different animals' });
    }
    const [sireRes, damRes] = await Promise.all([
      this.lineage.getIndividual(sireKernelId as IndividualId),
      this.lineage.getIndividual(damKernelId as IndividualId),
    ]);
    if (!sireRes.ok || !damRes.ok) {
      return err({ kind: 'lineage-failure', message: 'failed to read individuals' });
    }
    if (sireRes.value === null || damRes.value === null) {
      return err({ kind: 'invalid-pairing', message: 'sire or dam not found' });
    }
    if (sireRes.value.sex !== 'm') {
      return err({ kind: 'invalid-pairing', message: 'sire must be male' });
    }
    if (damRes.value.sex !== 'f') {
      return err({ kind: 'invalid-pairing', message: 'dam must be female' });
    }

    const kinRes = await this.lineage.kinship(sireKernelId as IndividualId, damKernelId as IndividualId);
    if (!kinRes.ok) {
      return err({ kind: 'lineage-failure', message: 'kinship computation failed' });
    }
    const predictedF = Number(kinRes.value);

    const caRes = await this.lineage.commonAncestors(sireKernelId as IndividualId, damKernelId as IndividualId);
    const sharedAncestors = caRes.ok
      ? caRes.value.map((c) => ({
          ancestorKernelIndividualId: c.ancestorId as string,
          genViaSire: c.genA,
          genViaDam: c.genB,
        }))
      : [];

    const [amberRaw, redRaw] = await Promise.all([
      this.settings.getByKey(this.tenantPackId, SETTING_KEY_AMBER),
      this.settings.getByKey(this.tenantPackId, SETTING_KEY_RED),
    ]);
    const thresholds = parseThresholds(amberRaw, redRaw);

    return ok({
      sireKernelIndividualId: sireKernelId,
      damKernelIndividualId: damKernelId,
      predictedF,
      predictedFPct: predictedF * 100,
      verdict: classifyVerdict(predictedF, thresholds),
      thresholds,
      sharedAncestors,
    });
  }
}
```

- [ ] **Step 4: Run → PASS (4 tests). Step 5: Commit** — `"feat(herdbook): mating evaluator (kinship + verdict + shared ancestors)"`

---

## Task 7: PlannedMating Prisma adapter

**Files:** Create `libs/herdbook-pack/src/application/adapters/prisma-planned-mating.adapter.ts` + `.spec.ts`

- [ ] **Step 1: Failing shape test**

```typescript
// prisma-planned-mating.adapter.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { PrismaPlannedMatingAdapter } from './prisma-planned-mating.adapter.js';

function fakeRunner(queryRows: unknown[] = []) {
  const calls: { method: string; sql: string; params: unknown[] }[] = [];
  const tx = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...p: unknown[]) => { calls.push({ method: 'query', sql, params: p }); return queryRows; }),
    $executeRawUnsafe: vi.fn(async (sql: string, ...p: unknown[]) => { calls.push({ method: 'execute', sql, params: p }); return 1; }),
  };
  return { runner: { run: async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) }, calls };
}
const T = 'herdbook-tpid-0001';

describe('PrismaPlannedMatingAdapter', () => {
  it('insert writes planned_mating with the snapshot F + verdict, returns a uuid', async () => {
    const { runner, calls } = fakeRunner();
    const id = await new PrismaPlannedMatingAdapter(runner as never).insert(T, {
      sireKernelIndividualId: 's', damKernelIndividualId: 'd', plannedDate: '2026-06-02',
      notes: null, actorUserId: 'u', predictedF: 0.05, predictedVerdict: 'amber',
    });
    expect(typeof id).toBe('string');
    const ins = calls.find((c) => c.method === 'execute' && c.sql.includes('INSERT'));
    expect(ins?.sql).toMatch(/herdbook.*planned_mating/s);
    expect(ins?.params).toContain(0.05);
    expect(ins?.params).toContain('amber');
  });
  it('linkOffspring updates the animal row by kernel_individual_id', async () => {
    const { runner, calls } = fakeRunner();
    await new PrismaPlannedMatingAdapter(runner as never).linkOffspring(T, 'm1', 'k1');
    const upd = calls.find((c) => c.method === 'execute');
    expect(upd?.sql).toMatch(/UPDATE.*animal.*from_planned_mating_id/s);
    expect(upd?.sql).toMatch(/kernel_individual_id/);
  });
  it('findById casts enums to text and maps the row', async () => {
    const row = {
      id: 'm1', sire_kernel_individual_id: 's', dam_kernel_individual_id: 'd',
      predicted_f: '0.050000', predicted_verdict: 'amber', status: 'planned',
      planned_date: '2026-06-02T00:00:00.000Z', notes: null,
      created_at: '2026-06-02T00:00:00.000Z', updated_at: '2026-06-02T00:00:00.000Z',
    };
    const { runner, calls } = fakeRunner([row]);
    const out = await new PrismaPlannedMatingAdapter(runner as never).findById(T, 'm1');
    expect(out?.predictedF).toBeCloseTo(0.05);
    expect(out?.predictedVerdict).toBe('amber');
    expect(out?.plannedDate).toBe('2026-06-02');
    expect(calls.find((c) => c.method === 'query')?.sql).toContain('predicted_verdict::text');
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement**

```typescript
// prisma-planned-mating.adapter.ts
import { randomUUID } from 'node:crypto';
import type { InsertPlannedMatingInput, PlannedMatingRepository } from '../planned-mating.port.js';
import type { MatingStatus, PlannedMatingRow } from '../planned-mating.view-models.js';
import type { ScopedRunner } from './prisma-individual-read.adapter.js';

interface Raw {
  id: string;
  sire_kernel_individual_id: string;
  dam_kernel_individual_id: string;
  predicted_f: string | number;
  predicted_verdict: string;
  status: string;
  planned_date: Date | string;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const BASE = `SELECT id, sire_kernel_individual_id, dam_kernel_individual_id, predicted_f,
                     predicted_verdict::text, status::text, planned_date, notes, created_at, updated_at
              FROM "herdbook"."planned_mating"`;

function toRow(r: Raw): PlannedMatingRow {
  return {
    id: r.id,
    sireKernelIndividualId: r.sire_kernel_individual_id,
    damKernelIndividualId: r.dam_kernel_individual_id,
    predictedF: Number(r.predicted_f),
    predictedVerdict: r.predicted_verdict as PlannedMatingRow['predictedVerdict'],
    status: r.status as MatingStatus,
    plannedDate: new Date(r.planned_date as string).toISOString().slice(0, 10),
    notes: r.notes,
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
  };
}

export class PrismaPlannedMatingAdapter implements PlannedMatingRepository {
  constructor(private readonly runner: ScopedRunner) {}

  insert(t: string, input: InsertPlannedMatingInput): Promise<string> {
    return this.runner.run(t, async (tx) => {
      const id = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "herdbook"."planned_mating"
           (id, tenant_pack_id, sire_kernel_individual_id, dam_kernel_individual_id,
            predicted_f, predicted_verdict, status, planned_date, notes,
            created_by_user_id, updated_by_user_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6::"herdbook"."MatingVerdict", 'planned', $7::date, $8, $9, $9, now())`,
        id, t, input.sireKernelIndividualId, input.damKernelIndividualId,
        input.predictedF, input.predictedVerdict, input.plannedDate, input.notes ?? null, input.actorUserId,
      );
      return id;
    });
  }

  list(t: string): Promise<PlannedMatingRow[]> {
    return this.runner.run(t, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(`${BASE} ORDER BY planned_date DESC, created_at DESC`, t)) as Raw[];
      return rows.map(toRow);
    });
  }

  findById(t: string, id: string): Promise<PlannedMatingRow | null> {
    return this.runner.run(t, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(`${BASE} WHERE id = $2 LIMIT 1`, t, id)) as Raw[];
      return rows[0] ? toRow(rows[0]) : null;
    });
  }

  updateStatus(t: string, id: string, status: MatingStatus, actorUserId: string): Promise<void> {
    return this.runner.run(t, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "herdbook"."planned_mating"
            SET status = $3::"herdbook"."MatingStatus", updated_by_user_id = $4, updated_at = now()
          WHERE id = $2`,
        t, id, status, actorUserId,
      );
    });
  }

  updateNotes(t: string, id: string, notes: string | null, actorUserId: string): Promise<void> {
    return this.runner.run(t, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "herdbook"."planned_mating"
            SET notes = $3, updated_by_user_id = $4, updated_at = now()
          WHERE id = $2`,
        t, id, notes, actorUserId,
      );
    });
  }

  linkOffspring(t: string, id: string, offspringKernelIndividualId: string): Promise<void> {
    return this.runner.run(t, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "herdbook"."animal"
            SET from_planned_mating_id = $2, updated_at = now()
          WHERE kernel_individual_id = $3`,
        t, id, offspringKernelIndividualId,
      );
    });
  }

  unlinkOffspring(t: string, id: string, offspringKernelIndividualId: string): Promise<void> {
    return this.runner.run(t, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "herdbook"."animal"
            SET from_planned_mating_id = NULL, updated_at = now()
          WHERE kernel_individual_id = $3 AND from_planned_mating_id = $2`,
        t, id, offspringKernelIndividualId,
      );
    });
  }

  listOffspringKernelIds(t: string, id: string): Promise<string[]> {
    return this.runner.run(t, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `SELECT kernel_individual_id FROM "herdbook"."animal" WHERE from_planned_mating_id = $2`,
        t, id,
      )) as { kernel_individual_id: string }[];
      return rows.map((r) => r.kernel_individual_id);
    });
  }
}
```

- [ ] **Step 4: Run → PASS (3 tests). Step 5: Commit** — `"feat(herdbook): planned-mating adapter + shape tests"`

---

## Task 8: PlannedMating registry service + audit

**Files:** Create `libs/herdbook-pack/src/application/planned-mating-audit.service.ts` + `planned-mating.service.ts` + `planned-mating.service.spec.ts`

- [ ] **Step 1: Audit service** (mirror `animal-audit.service.ts`)

```typescript
// planned-mating-audit.service.ts
import type { AuditService } from '@de-braighter/substrate-runtime';

export interface PlannedMatingAuditInput {
  readonly tenantPackId: string;
  readonly actorUserId: string;
  readonly plannedMatingId: string;
}

export class PlannedMatingAuditService {
  constructor(private readonly audit: AuditService) {}

  recordPlanned(i: PlannedMatingAuditInput) { return this.emit('mating.plan', 'C', i); }
  recordUpdated(i: PlannedMatingAuditInput) { return this.emit('mating.update', 'U', i); }

  private emit(eventType: string, action: 'C' | 'U' | 'D', i: PlannedMatingAuditInput) {
    return this.audit.record({
      tenantPackId: i.tenantPackId,
      eventType,
      action,
      outcome: 'success',
      occurredAt: new Date(),
      agent: [{ role: 'actor', userId: i.actorUserId }],
      entity: [{ role: 'target', what: i.plannedMatingId }],
    });
  }
}
```

- [ ] **Step 2: Failing service test**

```typescript
// planned-mating.service.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { PlannedMatingService } from './planned-mating.service.js';

const ok = <T>(v: T) => ({ ok: true as const, value: v });
function deps(over: Record<string, unknown> = {}) {
  const repo = {
    insert: vi.fn(async () => 'm1'),
    findById: vi.fn(async () => ({ id: 'm1', sireKernelIndividualId: 's', damKernelIndividualId: 'd', predictedF: 0.05, predictedVerdict: 'amber', status: 'planned', plannedDate: '2026-06-02', notes: null, createdAt: 'x', updatedAt: 'x' })),
    listOffspringKernelIds: vi.fn(async () => ['o1']),
    list: vi.fn(async () => []), updateStatus: vi.fn(), updateNotes: vi.fn(), linkOffspring: vi.fn(), unlinkOffspring: vi.fn(),
  };
  const evaluator = { evaluate: vi.fn(async () => ok({ predictedF: 0.05, predictedFPct: 5, verdict: 'amber', sireKernelIndividualId: 's', damKernelIndividualId: 'd', thresholds: { amber: 0.03125, red: 0.0625 }, sharedAncestors: [] })) };
  const lineage = { kinship: async () => ok(0.05), inbreedingCoefficient: async () => ok(0.02) };
  const audit = { recordPlanned: vi.fn(async () => ok(undefined)), recordUpdated: vi.fn(async () => ok(undefined)) };
  return { repo, evaluator, lineage, audit, ...over };
}
const T = 'herdbook-tpid-0001';

describe('PlannedMatingService', () => {
  it('create evaluates first, snapshots F+verdict into insert, and audits', async () => {
    const d = deps();
    const svc = new PlannedMatingService(d.repo as never, d.evaluator as never, d.lineage as never, d.audit as never, T);
    const r = await svc.create({ sireKernelIndividualId: 's', damKernelIndividualId: 'd', plannedDate: '2026-06-02', notes: null, actorUserId: 'u' });
    expect(r.ok).toBe(true);
    expect(d.evaluator.evaluate).toHaveBeenCalledWith('s', 'd');
    expect(d.repo.insert).toHaveBeenCalledWith(T, expect.objectContaining({ predictedF: 0.05, predictedVerdict: 'amber' }));
    expect(d.audit.recordPlanned).toHaveBeenCalled();
  });
  it('create surfaces an invalid pairing from the evaluator without inserting', async () => {
    const d = deps();
    d.evaluator.evaluate = vi.fn(async () => ({ ok: false, error: { kind: 'invalid-pairing', message: 'sire must be male' } }));
    const svc = new PlannedMatingService(d.repo as never, d.evaluator as never, d.lineage as never, d.audit as never, T);
    const r = await svc.create({ sireKernelIndividualId: 's', damKernelIndividualId: 'd', plannedDate: '2026-06-02', notes: null, actorUserId: 'u' });
    expect(r.ok).toBe(false);
    expect(d.repo.insert).not.toHaveBeenCalled();
  });
  it('getDetail adds live kinship recompute + each offspring actual F', async () => {
    const d = deps();
    const svc = new PlannedMatingService(d.repo as never, d.evaluator as never, d.lineage as never, d.audit as never, T);
    const r = await svc.getDetail('m1');
    expect(r.ok && r.value?.liveKinship).toBeCloseTo(0.05);
    expect(r.ok && r.value?.offspring).toEqual([{ kernelIndividualId: 'o1', actualF: 0.02 }]);
  });
});
```

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement**

```typescript
// planned-mating.service.ts
import type { LineageRepository, IndividualId } from '@de-braighter/substrate-contracts';
import type { MatingEvaluatorService } from './mating-evaluator.service.js';
import type { PlannedMatingAuditService } from './planned-mating-audit.service.js';
import type { PlannedMatingRepository } from './planned-mating.port.js';
import type {
  CreatePlannedMatingInput,
  MatingStatus,
  PlannedMatingDetail,
  PlannedMatingRow,
} from './planned-mating.view-models.js';

export type PlannedMatingError =
  | { kind: 'invalid-pairing'; message: string }
  | { kind: 'not-found'; id: string }
  | { kind: 'lineage-failure'; message: string };

type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };
const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export class PlannedMatingService {
  constructor(
    private readonly repo: PlannedMatingRepository,
    private readonly evaluator: MatingEvaluatorService,
    private readonly lineage: LineageRepository,
    private readonly audit: PlannedMatingAuditService,
    private readonly tenantPackId: string,
  ) {}

  async create(input: CreatePlannedMatingInput): Promise<Result<{ id: string }, PlannedMatingError>> {
    const evalRes = await this.evaluator.evaluate(input.sireKernelIndividualId, input.damKernelIndividualId);
    if (!evalRes.ok) return err(evalRes.error);
    const id = await this.repo.insert(this.tenantPackId, {
      ...input,
      predictedF: evalRes.value.predictedF,
      predictedVerdict: evalRes.value.verdict,
    });
    await this.audit.recordPlanned({ tenantPackId: this.tenantPackId, actorUserId: input.actorUserId, plannedMatingId: id });
    return ok({ id });
  }

  list(): Promise<PlannedMatingRow[]> {
    return this.repo.list(this.tenantPackId);
  }

  async getDetail(id: string): Promise<Result<PlannedMatingDetail | null, PlannedMatingError>> {
    const row = await this.repo.findById(this.tenantPackId, id);
    if (!row) return ok(null);

    const kinRes = await this.lineage.kinship(row.sireKernelIndividualId as IndividualId, row.damKernelIndividualId as IndividualId);
    const liveKinship = kinRes.ok ? Number(kinRes.value) : null;

    const offspringIds = await this.repo.listOffspringKernelIds(this.tenantPackId, id);
    const offspring = await Promise.all(
      offspringIds.map(async (kid) => {
        const fRes = await this.lineage.inbreedingCoefficient(kid as IndividualId);
        return { kernelIndividualId: kid, actualF: fRes.ok ? Number(fRes.value) : null };
      }),
    );
    return ok({ ...row, liveKinship, offspring });
  }

  async updateStatus(id: string, status: MatingStatus, actorUserId: string): Promise<Result<void, PlannedMatingError>> {
    const row = await this.repo.findById(this.tenantPackId, id);
    if (!row) return err({ kind: 'not-found', id });
    await this.repo.updateStatus(this.tenantPackId, id, status, actorUserId);
    await this.audit.recordUpdated({ tenantPackId: this.tenantPackId, actorUserId, plannedMatingId: id });
    return ok(undefined);
  }

  async linkOffspring(id: string, offspringKernelId: string, actorUserId: string): Promise<Result<void, PlannedMatingError>> {
    const row = await this.repo.findById(this.tenantPackId, id);
    if (!row) return err({ kind: 'not-found', id });
    await this.repo.linkOffspring(this.tenantPackId, id, offspringKernelId);
    await this.audit.recordUpdated({ tenantPackId: this.tenantPackId, actorUserId, plannedMatingId: id });
    return ok(undefined);
  }

  async unlinkOffspring(id: string, offspringKernelId: string, actorUserId: string): Promise<Result<void, PlannedMatingError>> {
    await this.repo.unlinkOffspring(this.tenantPackId, id, offspringKernelId);
    await this.audit.recordUpdated({ tenantPackId: this.tenantPackId, actorUserId, plannedMatingId: id });
    return ok(undefined);
  }
}
```

- [ ] **Step 5: Run → PASS (3 tests). Step 6: Commit** — `"feat(herdbook): planned-mating registry service + audit"`

---

## Task 9: DB-gated integration spec

**Files:** Create `libs/herdbook-pack/src/application/adapters/planned-mating-db.spec.ts`

This proves RLS + the create→evaluate→persist→read→offspring-link→predicted-vs-actual flow against live Postgres. Runs under `pnpm run test:db`.

- [ ] **Step 1: Write the spec**

```typescript
// planned-mating-db.spec.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaPlannedMatingAdapter } from './prisma-planned-mating.adapter.js';

const DB = process.env['SUBSTRATE_APP_DATABASE_URL'];
const RLS = process.env['SUBSTRATE_RLS_ENABLED'] === 'true';

function realRunner(prisma: PrismaClient) {
  return {
    async run<T>(t: string, fn: (tx: any) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_pack_id', $1, true)`, t);
        return fn(tx);
      });
    },
  };
}

describe.skipIf(!DB || !RLS)('planned_mating (DB)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: DB } } });
  const runner = realRunner(prisma);
  const repo = new PrismaPlannedMatingAdapter(runner as never);
  const TA = `tpid-A-${randomUUID()}`;
  const TB = `tpid-B-${randomUUID()}`;
  let offspringKernelId = '';
  let animalId = '';

  beforeAll(async () => {
    // Seed one offspring animal under TA (kernel_individual_id is a logical ref; no enforced FK).
    offspringKernelId = randomUUID();
    animalId = randomUUID();
    await runner.run(TA, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "herdbook"."animal" (id, tenant_pack_id, kernel_individual_id, updated_at)
         VALUES ($1, $2, $3, now())`,
        animalId, TA, offspringKernelId,
      );
    });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('inserts + reads a planned mating', async () => {
    const id = await repo.insert(TA, {
      sireKernelIndividualId: 'sire-k', damKernelIndividualId: 'dam-k', plannedDate: '2026-06-02',
      notes: 'spring plan', actorUserId: 'u1', predictedF: 0.05, predictedVerdict: 'amber',
    });
    const row = await repo.findById(TA, id);
    expect(row?.predictedVerdict).toBe('amber');
    expect(row?.predictedF).toBeCloseTo(0.05);
    expect(row?.status).toBe('planned');
  });

  it('RLS hides tenant A matings from tenant B', async () => {
    await repo.insert(TA, { sireKernelIndividualId: 's', damKernelIndividualId: 'd', plannedDate: '2026-06-02', notes: null, actorUserId: 'u1', predictedF: 0.01, predictedVerdict: 'green' });
    expect(await repo.list(TB)).toHaveLength(0);
  });

  it('links + unlinks an offspring animal and lists it', async () => {
    const id = await repo.insert(TA, { sireKernelIndividualId: 's', damKernelIndividualId: 'd', plannedDate: '2026-06-02', notes: null, actorUserId: 'u1', predictedF: 0.0, predictedVerdict: 'green' });
    await repo.linkOffspring(TA, id, offspringKernelId);
    expect(await repo.listOffspringKernelIds(TA, id)).toContain(offspringKernelId);
    await repo.unlinkOffspring(TA, id, offspringKernelId);
    expect(await repo.listOffspringKernelIds(TA, id)).toHaveLength(0);
  });

  it('advances status', async () => {
    const id = await repo.insert(TA, { sireKernelIndividualId: 's', damKernelIndividualId: 'd', plannedDate: '2026-06-02', notes: null, actorUserId: 'u1', predictedF: 0.0, predictedVerdict: 'green' });
    await repo.updateStatus(TA, id, 'mated', 'u1');
    expect((await repo.findById(TA, id))?.status).toBe('mated');
  });
});
```

- [ ] **Step 2: Run** — `pnpm run ci:local:db` (or set the DB env + `vitest run` the one file). Expected: the 4 tests RUN + PASS against live Postgres (RLS on); SKIP without DB env.

- [ ] **Step 3: Commit** — `"test(herdbook): DB-gated planned_mating — RLS + CRUD + offspring link"`

---

## Task 10: Export public surface + green the gate

**Files:** Modify `libs/herdbook-pack/src/index.ts`

- [ ] **Step 1: Exports** (follow the per-epic barrel convention — ports + view-models + adapters + services)

```typescript
// Mating planner (slice 1a): planned-matings registry + evaluator
export * from './application/planned-mating.view-models.js';
export * from './application/planned-mating.port.js';
export * from './application/mating-verdict.js';
export { MatingEvaluatorService } from './application/mating-evaluator.service.js';
export { PlannedMatingService } from './application/planned-mating.service.js';
export { PlannedMatingAuditService } from './application/planned-mating-audit.service.js';
export { PrismaPlannedMatingAdapter } from './application/adapters/prisma-planned-mating.adapter.js';
export { PrismaSettingReadAdapter } from './application/adapters/prisma-setting-read.adapter.js';
```

- [ ] **Step 2: Gate** — `pnpm run ci:local` (libs/herdbook-pack: build + typecheck + tests green; DB-gated specs skip). Then `pnpm run ci:local:db` for the full DB run. (The `apps/web` vitest worker has a pre-existing intermittent native crash — unrelated; treat libs/herdbook-pack green as the gate for this slice.)

- [ ] **Step 3: Commit** — `"feat(herdbook): export mating-planner domain surface (slice 1a)"`

---

## Self-Review (completed by plan author)

- **Spec coverage (Slice 1a):** data model §2.1 (planned_mating) ✅ Task 1/2; offspring FK §2.2 ✅ Task 1/2/7; thresholds in Setting §2.3 ✅ Task 5 + verdict §3 ✅ Task 4; evaluator §3 (kinship + commonAncestors + sex via getIndividual + verdict) ✅ Task 6; registry + lifecycle + predicted-vs-actual §4 ✅ Task 7/8; RLS §6.1 ✅ Task 2/9. Deferred (correctly out of 1a): API + permissions §5 (Slice 1b), UI §6 (Slice 2), the mate recommender + register-offspring shortcut §8.
- **Placeholder scan:** none — full SQL/TS/commands throughout.
- **Type consistency:** `MatingEvaluation`/`PlannedMatingRow`/`InsertPlannedMatingInput`/`PlannedMatingDetail` shapes, `classifyVerdict`/`parseThresholds`/`SETTING_KEY_*`, and the repo/service/evaluator method names align across Tasks 3–9. The evaluator returns `Result<MatingEvaluation, MatingEvaluationError>`; the service consumes `.ok`/`.value`/`.error` consistently.

---

## Remaining slices (roadmap — separate plans)

| Slice | Builds | Depends on |
|-------|--------|------------|
| **1b — HTTP** | manifest permissions (`herdbook.mating.read`/`plan`/`update`) + registrar grant + audit subtypes; `MatingController` (`POST /matings/evaluate`, `POST/GET /matings`, `GET /matings/:id`, `PATCH /matings/:id`, `POST/DELETE …/offspring`); `plannedMatingProviders` wiring + `HERDBOOK_CONTROLLERS` registration; DB-gated API test | 1a |
| **2 — UI** | Angular "Matings" nav: planner (sire/dam pickers → live evaluation card → save), list, detail (lifecycle + offspring predicted-vs-actual); animal-detail entry; a11y verdict (glyph + sr-word) | 1b |
| (later) | mate recommender (rank candidates); register-offspring create shortcut; threshold-editing UI; the per-tenant threshold `db:setup` seed | 1b/2 |
