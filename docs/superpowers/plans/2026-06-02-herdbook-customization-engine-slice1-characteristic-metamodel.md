# Herdbook Customization Engine — Slice 1.1 (Characteristic Metamodel Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the foundational definition/instance metamodel to the `herdbook` pack — `characteristic_definition` (versioned, generalizes `trait_catalog`) and `characteristic_value` (typed-by-value-type, generalizes `assessment_trait`) — with RLS, a typed-value CHECK + match trigger, a draft→publish lifecycle, and a port + Prisma adapters + tests. Everything else in Phase 1 (assessment templates, measurement protocols, identity schemes, derived-field views) builds on this slice.

**Architecture:** Hybrid spine + variable layer (see spec `docs/superpowers/specs/2026-06-02-herdbook-multi-species-customization-design.md`). This slice is the variable layer's atomic recordable unit. Definitions are first-class versioned rows (immutable once published; edits fork a new version). Values are stored typed-by-value-type (one column per type, never a stringly `value`), bound to the exact definition version row, scoped per `tenant_pack_id` with RLS. Adapters follow the pack's `ScopedRunner.run(tenantPackId, tx => …)` raw-SQL convention.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), Prisma (PostgreSQL, `multiSchema`, schema `herdbook`), raw SQL via `$queryRawUnsafe`/`$executeRawUnsafe`, NestJS DI (structural `ScopedRunner`), Vitest (shape-tests + `skipIf(!DB||!RLS)` integration), Postgres RLS via `app.tenant_pack_id` GUC.

**Naming decision (confirm before starting):** The spec calls this `attribute_*`. This plan implements it as **`characteristic_*`** to avoid colliding with the existing E7 "Attributes" feature (aptitude/award/subsidy/interest). If you prefer the spec name, find-replace `characteristic` → `attribute` throughout this plan and the table/file names.

**Repo:** `domains/herdbook` (separate repo; this plan lives in the workbench). Branch off `main` (@ `df5f0a2`). PR-gated; verifier wave on the PR.

---

## File Structure

**Modify:**
- `libs/herdbook-pack/prisma/schema.prisma` — add `CharacteristicValueType` + `DefinitionStatus` enums, `CharacteristicDefinition` + `CharacteristicValue` models, and back-relation fields on `CodeList`, `CodeValue`, `Animal`.

**Create:**
- `libs/herdbook-pack/prisma/migrations/0004_characteristic_metamodel/migration.sql` — tables + indexes + FKs + RLS + CHECK + value-type-match trigger + GRANTs (hand-authored, matching the 0002 RLS style).
- `libs/herdbook-pack/src/application/characteristic.view-models.ts` — domain types (inputs, rows, value-type union).
- `libs/herdbook-pack/src/application/characteristic.port.ts` — `CharacteristicDefinitionRepository` + `CharacteristicValueRepository` interfaces.
- `libs/herdbook-pack/src/application/characteristic-value-routing.ts` — pure helper mapping `valueType` → the populated column + app-layer validation (the unit-testable core of rule #1).
- `libs/herdbook-pack/src/application/characteristic-value-routing.spec.ts` — shape/unit tests for the router (no DB).
- `libs/herdbook-pack/src/application/adapters/prisma-characteristic-definition.adapter.ts` — definition CRUD/lifecycle adapter.
- `libs/herdbook-pack/src/application/adapters/prisma-characteristic-definition.adapter.spec.ts` — shape tests (fakeRunner).
- `libs/herdbook-pack/src/application/adapters/prisma-characteristic-value.adapter.ts` — value record/read adapter.
- `libs/herdbook-pack/src/application/adapters/prisma-characteristic-value.adapter.spec.ts` — shape tests (fakeRunner).
- `libs/herdbook-pack/src/application/adapters/characteristic-metamodel-db.spec.ts` — DB-gated integration (RLS, CHECK, trigger, lifecycle, round-trip).

**Convention anchors (read these existing files to copy style):**
- `libs/herdbook-pack/src/application/adapters/prisma-individual-read.adapter.ts` — the `ScopedRunner`/`ScopedTx` structural interfaces (lines 1–40).
- `libs/herdbook-pack/src/application/adapters/prisma-person.adapter.ts` — write+read raw-SQL adapter (`insert`/`update` pattern, `randomUUID()`, `$N::date` casts).
- `libs/herdbook-pack/src/application/adapters/prisma-person.adapter.spec.ts` — the `fakeRunner()` shape-test pattern.
- `libs/herdbook-pack/src/application/adapters/prisma-trait-catalog.adapter.ts` — read adapter + `enum::text` cast + `$N::text[]` array.
- `libs/herdbook-pack/prisma/migrations/0002_herdbook_rls/migration.sql` — the RLS DO-loop policy pattern.

---

## Task 0: Branch and ground yourself

**Files:** none (setup only)

- [ ] **Step 1: Create the feature branch off current main**

```bash
cd domains/herdbook
git checkout main && git pull --ff-only
git checkout -b feat/customization-engine-slice1-characteristic-metamodel
```

- [ ] **Step 2: Confirm the migration number and that the models you reference exist**

```bash
ls libs/herdbook-pack/prisma/migrations/
# Expect: 0001_herdbook_schema  0002_herdbook_rls  0003_animal_photo_inline  migration_lock.toml
# → the next migration is 0004.
grep -nE "model (Animal|CodeList|CodeValue) " libs/herdbook-pack/prisma/schema.prisma
# Expect: Animal, CodeList, CodeValue all present (you will add back-relations to these).
```

Expected: three existing migration folders (next = `0004`), and the three models present. If the numbers differ, use the actual next sequential number throughout.

---

## Task 1: Schema models + enums + back-relations

**Files:**
- Modify: `libs/herdbook-pack/prisma/schema.prisma`

- [ ] **Step 1: Add the two enums** (place beside the existing `enum TraitCategory { … }`)

```prisma
enum CharacteristicValueType {
  number
  text
  boolean
  date
  code
  computed

  @@schema("herdbook")
}

enum DefinitionStatus {
  draft
  published
  retired

  @@schema("herdbook")
}
```

- [ ] **Step 2: Add the two models** (place after the `AssessmentTrait` model)

```prisma
model CharacteristicDefinition {
  id           String                  @id @default(uuid())
  tenantPackId String                  @map("tenant_pack_id")
  key          String // stable machine key, e.g. "wool_density"
  version      Int                     @default(1)
  status       DefinitionStatus        @default(draft)
  valueType    CharacteristicValueType @map("value_type")
  unit         String? // e.g. "kg", "cm"; null for non-numeric
  codeListId   String?                 @map("code_list_id") // required when valueType = code
  validation   Json? // { required?: bool, min?: number, max?: number, regex?: string }
  supersedesId String?                 @map("supersedes_id") // prior version row in the fork chain
  createdAt    DateTime                @default(now()) @map("created_at") @db.Timestamptz(6)

  codeList CodeList?            @relation(fields: [codeListId], references: [id], onDelete: Restrict)
  values   CharacteristicValue[]

  @@unique([tenantPackId, key, version])
  @@index([tenantPackId])
  @@index([codeListId])
  @@map("characteristic_definition")
  @@schema("herdbook")
}

model CharacteristicValue {
  id               String   @id @default(uuid())
  tenantPackId     String   @map("tenant_pack_id")
  animalId         String   @map("animal_id") // pack subject (herdbook.animal.id)
  definitionId     String   @map("definition_id") // the exact immutable version row
  valueNum         Decimal? @map("value_num") @db.Decimal(12, 4)
  valueText        String?  @map("value_text")
  valueBool        Boolean? @map("value_bool")
  valueDate        DateTime? @map("value_date") @db.Date
  valueCodeValueId String?  @map("value_code_value_id") // FK to code_value when valueType = code
  observedAt       DateTime @default(now()) @map("observed_at") @db.Timestamptz(6)
  createdByUserId  String   @map("created_by_user_id")

  definition CharacteristicDefinition @relation(fields: [definitionId], references: [id], onDelete: Restrict)
  animal     Animal                   @relation(fields: [animalId], references: [id], onDelete: Cascade)
  codeValue  CodeValue?               @relation(fields: [valueCodeValueId], references: [id], onDelete: Restrict)

  @@index([tenantPackId])
  @@index([animalId])
  @@index([definitionId])
  @@map("characteristic_value")
  @@schema("herdbook")
}
```

Note on versioning: each `(tenantPackId, key, version)` is a distinct immutable row with its own `id`. A `CharacteristicValue` binds to that version row via `definitionId`, so the version is recoverable by join — we do **not** duplicate the version integer onto the value (DRY; the referenced row is immutable). This satisfies spec §3.3 rule #2 (instances bind to the version they were recorded against).

- [ ] **Step 3: Add the back-relation fields to the three existing models**

In `model CodeList { … }` add:

```prisma
  characteristicDefinitions CharacteristicDefinition[]
```

In `model CodeValue { … }` add:

```prisma
  characteristicValues CharacteristicValue[]
```

In `model Animal { … }` add:

```prisma
  characteristicValues CharacteristicValue[]
```

- [ ] **Step 4: Validate the schema**

Run: `pnpm --filter herdbook-pack exec prisma validate --schema libs/herdbook-pack/prisma/schema.prisma`
Expected: `The schema at … is valid 🚀`

- [ ] **Step 5: Commit**

```bash
git add libs/herdbook-pack/prisma/schema.prisma
git commit -m "feat(herdbook): characteristic metamodel schema models (slice 1.1)"
```

---

## Task 2: Migration SQL — tables, RLS, CHECK, GRANTs

**Files:**
- Create: `libs/herdbook-pack/prisma/migrations/0004_characteristic_metamodel/migration.sql`

- [ ] **Step 1: Hand-author the migration** (matches the 0002 RLS style; the pack uses sequential numeric migration folders)

```sql
-- 0004_characteristic_metamodel
-- Definition/instance metamodel core: characteristic_definition + characteristic_value.

-- ── enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "herdbook"."CharacteristicValueType" AS ENUM
  ('number', 'text', 'boolean', 'date', 'code', 'computed');
CREATE TYPE "herdbook"."DefinitionStatus" AS ENUM
  ('draft', 'published', 'retired');

-- ── characteristic_definition ────────────────────────────────────────────────
CREATE TABLE "herdbook"."characteristic_definition" (
  "id"             TEXT PRIMARY KEY,
  "tenant_pack_id" TEXT NOT NULL,
  "key"            TEXT NOT NULL,
  "version"        INTEGER NOT NULL DEFAULT 1,
  "status"         "herdbook"."DefinitionStatus" NOT NULL DEFAULT 'draft',
  "value_type"     "herdbook"."CharacteristicValueType" NOT NULL,
  "unit"           TEXT,
  "code_list_id"   TEXT REFERENCES "herdbook"."code_list"("id") ON DELETE RESTRICT,
  "validation"     JSONB,
  "supersedes_id"  TEXT,
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "characteristic_definition_tenant_key_version_uq"
    UNIQUE ("tenant_pack_id", "key", "version"),
  -- value_type = 'code' must carry a code_list; non-code must not.
  CONSTRAINT "characteristic_definition_code_list_consistency"
    CHECK (("value_type" = 'code') = ("code_list_id" IS NOT NULL))
);
CREATE INDEX "characteristic_definition_tenant_idx"
  ON "herdbook"."characteristic_definition" ("tenant_pack_id");
CREATE INDEX "characteristic_definition_code_list_idx"
  ON "herdbook"."characteristic_definition" ("code_list_id");

-- ── characteristic_value ─────────────────────────────────────────────────────
CREATE TABLE "herdbook"."characteristic_value" (
  "id"                  TEXT PRIMARY KEY,
  "tenant_pack_id"      TEXT NOT NULL,
  "animal_id"           TEXT NOT NULL REFERENCES "herdbook"."animal"("id") ON DELETE CASCADE,
  "definition_id"       TEXT NOT NULL REFERENCES "herdbook"."characteristic_definition"("id") ON DELETE RESTRICT,
  "value_num"           DECIMAL(12,4),
  "value_text"          TEXT,
  "value_bool"          BOOLEAN,
  "value_date"          DATE,
  "value_code_value_id" TEXT REFERENCES "herdbook"."code_value"("id") ON DELETE RESTRICT,
  "observed_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "created_by_user_id"  TEXT NOT NULL,
  -- Rule #1 (column-local half): at most one typed value column is populated.
  CONSTRAINT "characteristic_value_single_value"
    CHECK (
      ( (CASE WHEN "value_num"           IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN "value_text"          IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN "value_bool"          IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN "value_date"          IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN "value_code_value_id" IS NOT NULL THEN 1 ELSE 0 END) ) <= 1
    )
);
CREATE INDEX "characteristic_value_tenant_idx"
  ON "herdbook"."characteristic_value" ("tenant_pack_id");
CREATE INDEX "characteristic_value_animal_idx"
  ON "herdbook"."characteristic_value" ("animal_id");
CREATE INDEX "characteristic_value_definition_idx"
  ON "herdbook"."characteristic_value" ("definition_id");

-- ── RLS (mirror 0002 pattern) ────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['characteristic_definition', 'characteristic_value'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
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

-- ── grants to the app role (setup.mjs also grants schema-wide; explicit for safety) ──
GRANT SELECT, INSERT, UPDATE, DELETE ON "herdbook"."characteristic_definition" TO "app";
GRANT SELECT, INSERT, UPDATE, DELETE ON "herdbook"."characteristic_value" TO "app";
```

- [ ] **Step 2: Verify schema/migration agree (no drift on the table shapes)**

Run:
```bash
pnpm --filter herdbook-pack exec prisma migrate diff \
  --from-migrations libs/herdbook-pack/prisma/migrations \
  --to-schema-datamodel libs/herdbook-pack/prisma/schema.prisma \
  --script
```
Expected: empty (no statements) for the table/column/enum shapes. The RLS, CHECK, trigger, and GRANTs are intentionally migration-only (not derivable from the Prisma schema), exactly like `0002_herdbook_rls` — so they will not appear in a drift diff.

- [ ] **Step 3: Apply against a local test DB and sanity-check**

Run: `pnpm run db:generate && pnpm run db:setup`
Expected: `prisma migrate deploy` reports `0004_characteristic_metamodel` applied; no errors.

- [ ] **Step 4: Commit**

```bash
git add libs/herdbook-pack/prisma/migrations/0004_characteristic_metamodel/migration.sql
git commit -m "feat(herdbook): characteristic metamodel migration — tables + RLS + CHECK + grants"
```

---

## Task 3: Domain types (view-models) + port

**Files:**
- Create: `libs/herdbook-pack/src/application/characteristic.view-models.ts`
- Create: `libs/herdbook-pack/src/application/characteristic.port.ts`

- [ ] **Step 1: Write the view-models**

```typescript
// characteristic.view-models.ts — domain types for the characteristic metamodel.

export type CharacteristicValueType =
  | 'number'
  | 'text'
  | 'boolean'
  | 'date'
  | 'code'
  | 'computed';

export type DefinitionStatus = 'draft' | 'published' | 'retired';

export interface DefinitionValidation {
  required?: boolean;
  min?: number;
  max?: number;
  regex?: string;
}

export interface CreateDefinitionInput {
  key: string;
  valueType: CharacteristicValueType;
  unit?: string | null;
  codeListId?: string | null; // required iff valueType === 'code'
  validation?: DefinitionValidation | null;
}

export interface CharacteristicDefinitionRow {
  id: string;
  tenantPackId: string;
  key: string;
  version: number;
  status: DefinitionStatus;
  valueType: CharacteristicValueType;
  unit: string | null;
  codeListId: string | null;
  validation: DefinitionValidation | null;
  supersedesId: string | null;
  createdAt: string; // ISO
}

export interface RecordValueInput {
  animalId: string;
  definitionId: string;
  actorUserId: string;
  // exactly one of these, matching the definition's valueType:
  num?: number;
  text?: string;
  bool?: boolean;
  date?: string; // ISO yyyy-mm-dd
  codeValueId?: string;
}

export interface CharacteristicValueRow {
  id: string;
  animalId: string;
  definitionId: string;
  num: number | null;
  text: string | null;
  bool: boolean | null;
  date: string | null; // ISO yyyy-mm-dd
  codeValueId: string | null;
  observedAt: string; // ISO
}
```

- [ ] **Step 2: Write the port**

```typescript
// characteristic.port.ts
import type {
  CharacteristicDefinitionRow,
  CharacteristicValueRow,
  CreateDefinitionInput,
  RecordValueInput,
} from './characteristic.view-models.js';

export interface CharacteristicDefinitionRepository {
  /** Create a new draft definition at version 1 (or version+1 if `key` already exists), returning its id + version. */
  createDraft(
    tenantPackId: string,
    input: CreateDefinitionInput,
  ): Promise<{ id: string; version: number }>;

  /** Transition a draft → published. Idempotent on an already-published row. */
  publish(tenantPackId: string, definitionId: string): Promise<void>;

  /** The current published definition for a key, or null. */
  findPublishedByKey(
    tenantPackId: string,
    key: string,
  ): Promise<CharacteristicDefinitionRow | null>;

  /** A single definition row by id (any status), or null. */
  findById(
    tenantPackId: string,
    definitionId: string,
  ): Promise<CharacteristicDefinitionRow | null>;

  /** All published definitions for the tenant, ordered by key. */
  listPublished(tenantPackId: string): Promise<CharacteristicDefinitionRow[]>;
}

export interface CharacteristicValueRepository {
  /** Record a value against an animal for a definition. Returns the new value id. */
  record(tenantPackId: string, input: RecordValueInput): Promise<string>;

  /** All values recorded for an animal, newest first. */
  listForAnimal(
    tenantPackId: string,
    animalId: string,
  ): Promise<CharacteristicValueRow[]>;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter herdbook-pack exec tsc --noEmit -p libs/herdbook-pack/tsconfig.lib.json`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add libs/herdbook-pack/src/application/characteristic.view-models.ts libs/herdbook-pack/src/application/characteristic.port.ts
git commit -m "feat(herdbook): characteristic metamodel port + view-models"
```

---

## Task 4: Value-type routing helper (rule #1, app-layer half)

**Files:**
- Create: `libs/herdbook-pack/src/application/characteristic-value-routing.ts`
- Test: `libs/herdbook-pack/src/application/characteristic-value-routing.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// characteristic-value-routing.spec.ts
import { describe, expect, it } from 'vitest';
import { routeValue } from './characteristic-value-routing.js';
import type { RecordValueInput } from './characteristic.view-models.js';

const base: Omit<RecordValueInput, 'num' | 'text' | 'bool' | 'date' | 'codeValueId'> = {
  animalId: 'a1',
  definitionId: 'd1',
  actorUserId: 'u1',
};

describe('routeValue', () => {
  it('maps number → value_num column and leaves others null', () => {
    const r = routeValue('number', { ...base, num: 3.5 });
    expect(r).toEqual({
      valueNum: 3.5, valueText: null, valueBool: null, valueDate: null, valueCodeValueId: null,
    });
  });

  it('maps code → value_code_value_id', () => {
    const r = routeValue('code', { ...base, codeValueId: 'cv-9' });
    expect(r.valueCodeValueId).toBe('cv-9');
    expect(r.valueNum).toBeNull();
  });

  it('throws when the provided field does not match the declared valueType', () => {
    expect(() => routeValue('number', { ...base, text: 'oops' })).toThrow(
      /expected num for value type number/i,
    );
  });

  it('throws when more than one value field is provided', () => {
    expect(() => routeValue('number', { ...base, num: 1, text: 'x' })).toThrow(
      /exactly one/i,
    );
  });

  it('throws for computed (values are derived, never recorded)', () => {
    expect(() => routeValue('computed', { ...base, num: 1 })).toThrow(/computed/i);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter herdbook-pack exec vitest run src/application/characteristic-value-routing.spec.ts`
Expected: FAIL — `routeValue` is not defined.

- [ ] **Step 3: Implement the router**

```typescript
// characteristic-value-routing.ts — rule #1 (app-layer): valueType → typed column.
import type { CharacteristicValueType, RecordValueInput } from './characteristic.view-models.js';

export interface RoutedValue {
  valueNum: number | null;
  valueText: string | null;
  valueBool: boolean | null;
  valueDate: string | null;
  valueCodeValueId: string | null;
}

const EMPTY: RoutedValue = {
  valueNum: null, valueText: null, valueBool: null, valueDate: null, valueCodeValueId: null,
};

export function routeValue(
  valueType: CharacteristicValueType,
  input: RecordValueInput,
): RoutedValue {
  if (valueType === 'computed') {
    throw new Error('computed characteristics are derived, not recorded');
  }

  const provided = (['num', 'text', 'bool', 'date', 'codeValueId'] as const).filter(
    (k) => input[k] !== undefined && input[k] !== null,
  );
  if (provided.length !== 1) {
    throw new Error(`exactly one value field must be provided (got ${provided.length})`);
  }

  switch (valueType) {
    case 'number':
      if (input.num === undefined || input.num === null) {
        throw new Error('expected num for value type number');
      }
      return { ...EMPTY, valueNum: input.num };
    case 'text':
      if (input.text === undefined || input.text === null) {
        throw new Error('expected text for value type text');
      }
      return { ...EMPTY, valueText: input.text };
    case 'boolean':
      if (input.bool === undefined || input.bool === null) {
        throw new Error('expected bool for value type boolean');
      }
      return { ...EMPTY, valueBool: input.bool };
    case 'date':
      if (input.date === undefined || input.date === null) {
        throw new Error('expected date for value type date');
      }
      return { ...EMPTY, valueDate: input.date };
    case 'code':
      if (input.codeValueId === undefined || input.codeValueId === null) {
        throw new Error('expected codeValueId for value type code');
      }
      return { ...EMPTY, valueCodeValueId: input.codeValueId };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter herdbook-pack exec vitest run src/application/characteristic-value-routing.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/herdbook-pack/src/application/characteristic-value-routing.ts libs/herdbook-pack/src/application/characteristic-value-routing.spec.ts
git commit -m "feat(herdbook): characteristic value-type routing (rule #1 app-layer) + tests"
```

---

## Task 5: Definition adapter + shape tests

**Files:**
- Create: `libs/herdbook-pack/src/application/adapters/prisma-characteristic-definition.adapter.ts`
- Test: `libs/herdbook-pack/src/application/adapters/prisma-characteristic-definition.adapter.spec.ts`

- [ ] **Step 1: Write the failing shape test**

```typescript
// prisma-characteristic-definition.adapter.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { PrismaCharacteristicDefinitionAdapter } from './prisma-characteristic-definition.adapter.js';

function fakeRunner(queryRows: unknown[] = []) {
  const calls: { method: string; sql: string; params: unknown[] }[] = [];
  const tx = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...p: unknown[]) => {
      calls.push({ method: 'query', sql, params: p });
      return queryRows;
    }),
    $executeRawUnsafe: vi.fn(async (sql: string, ...p: unknown[]) => {
      calls.push({ method: 'execute', sql, params: p });
      return 1;
    }),
  };
  const runner = { run: async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) };
  return { runner, calls };
}

const T = 'herdbook-tpid-0001';

describe('PrismaCharacteristicDefinitionAdapter', () => {
  it('createDraft computes version = max(version)+1 then inserts a draft row', async () => {
    // First query returns the current max version (0 → none), then the INSERT runs.
    const { runner, calls } = fakeRunner([{ next_version: 1 }]);
    const adapter = new PrismaCharacteristicDefinitionAdapter(runner as never);
    const out = await adapter.createDraft(T, { key: 'wool_density', valueType: 'number' });
    expect(out.version).toBe(1);
    expect(typeof out.id).toBe('string');
    const insert = calls.find((c) => c.method === 'execute' && c.sql.includes('INSERT'));
    expect(insert?.sql).toMatch(/herdbook.*characteristic_definition/s);
    expect(insert?.sql).toContain('value_type');
  });

  it('publish issues an UPDATE … SET status = \'published\'', async () => {
    const { runner, calls } = fakeRunner();
    const adapter = new PrismaCharacteristicDefinitionAdapter(runner as never);
    await adapter.publish(T, 'def-1');
    const upd = calls.find((c) => c.method === 'execute');
    expect(upd?.sql).toMatch(/UPDATE.*characteristic_definition/s);
    expect(upd?.sql).toContain("'published'");
  });

  it('findPublishedByKey casts enums to text and maps the row', async () => {
    const row = {
      id: 'd1', tenant_pack_id: T, key: 'wool_density', version: 1,
      status: 'published', value_type: 'number', unit: 'g/cm2',
      code_list_id: null, validation: { min: 0, max: 9 }, supersedes_id: null,
      created_at: '2026-06-02T00:00:00.000Z',
    };
    const { runner, calls } = fakeRunner([row]);
    const adapter = new PrismaCharacteristicDefinitionAdapter(runner as never);
    const out = await adapter.findPublishedByKey(T, 'wool_density');
    expect(out?.valueType).toBe('number');
    expect(out?.validation).toEqual({ min: 0, max: 9 });
    const q = calls.find((c) => c.method === 'query');
    expect(q?.sql).toContain('value_type::text');
    expect(q?.sql).toContain("status = 'published'");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter herdbook-pack exec vitest run src/application/adapters/prisma-characteristic-definition.adapter.spec.ts`
Expected: FAIL — adapter not defined.

- [ ] **Step 3: Implement the adapter**

```typescript
// prisma-characteristic-definition.adapter.ts
import { randomUUID } from 'node:crypto';
import type { CharacteristicDefinitionRepository } from '../characteristic.port.js';
import type {
  CharacteristicDefinitionRow,
  CreateDefinitionInput,
  DefinitionValidation,
} from '../characteristic.view-models.js';
import type { ScopedRunner } from './prisma-individual-read.adapter.js';

interface DefRow {
  id: string;
  tenant_pack_id: string;
  key: string;
  version: number;
  status: string;
  value_type: string;
  unit: string | null;
  code_list_id: string | null;
  validation: DefinitionValidation | null;
  supersedes_id: string | null;
  created_at: Date | string;
}

const BASE_SELECT = `SELECT id, tenant_pack_id, key, version, status::text,
                            value_type::text, unit, code_list_id, validation, supersedes_id, created_at
                     FROM "herdbook"."characteristic_definition"`;

function toRow(r: DefRow): CharacteristicDefinitionRow {
  return {
    id: r.id,
    tenantPackId: r.tenant_pack_id,
    key: r.key,
    version: Number(r.version),
    status: r.status as CharacteristicDefinitionRow['status'],
    valueType: r.value_type as CharacteristicDefinitionRow['valueType'],
    unit: r.unit,
    codeListId: r.code_list_id,
    validation: r.validation,
    supersedesId: r.supersedes_id,
    createdAt: new Date(r.created_at as string).toISOString(),
  };
}

export class PrismaCharacteristicDefinitionAdapter implements CharacteristicDefinitionRepository {
  constructor(private readonly runner: ScopedRunner) {}

  createDraft(
    t: string,
    input: CreateDefinitionInput,
  ): Promise<{ id: string; version: number }> {
    return this.runner.run(t, async (tx) => {
      const verRows = (await tx.$queryRawUnsafe(
        `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
           FROM "herdbook"."characteristic_definition"
          WHERE key = $2`,
        t,
        input.key,
      )) as { next_version: number }[];
      const version = Number(verRows[0]?.next_version ?? 1);
      const id = randomUUID();
      const supersedesRows =
        version > 1
          ? ((await tx.$queryRawUnsafe(
              `SELECT id FROM "herdbook"."characteristic_definition"
                WHERE key = $2 AND version = $3`,
              t,
              input.key,
              version - 1,
            )) as { id: string }[])
          : [];
      await tx.$executeRawUnsafe(
        `INSERT INTO "herdbook"."characteristic_definition"
           (id, tenant_pack_id, key, version, status, value_type, unit,
            code_list_id, validation, supersedes_id)
         VALUES ($1, $2, $3, $4, 'draft', $5::"herdbook"."CharacteristicValueType",
                 $6, $7, $8::jsonb, $9)`,
        id,
        t,
        input.key,
        version,
        input.valueType,
        input.unit ?? null,
        input.codeListId ?? null,
        input.validation ? JSON.stringify(input.validation) : null,
        supersedesRows[0]?.id ?? null,
      );
      return { id, version };
    });
  }

  publish(t: string, definitionId: string): Promise<void> {
    return this.runner.run(t, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE "herdbook"."characteristic_definition"
            SET status = 'published'
          WHERE id = $2 AND status = 'draft'`,
        t,
        definitionId,
      );
    });
  }

  findPublishedByKey(t: string, key: string): Promise<CharacteristicDefinitionRow | null> {
    return this.runner.run(t, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `${BASE_SELECT}
          WHERE key = $2 AND status = 'published'
          ORDER BY version DESC
          LIMIT 1`,
        t,
        key,
      )) as DefRow[];
      return rows[0] ? toRow(rows[0]) : null;
    });
  }

  findById(t: string, definitionId: string): Promise<CharacteristicDefinitionRow | null> {
    return this.runner.run(t, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `${BASE_SELECT} WHERE id = $2 LIMIT 1`,
        t,
        definitionId,
      )) as DefRow[];
      return rows[0] ? toRow(rows[0]) : null;
    });
  }

  listPublished(t: string): Promise<CharacteristicDefinitionRow[]> {
    return this.runner.run(t, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `${BASE_SELECT} WHERE status = 'published' ORDER BY key, version DESC`,
        t,
      )) as DefRow[];
      return rows.map(toRow);
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter herdbook-pack exec vitest run src/application/adapters/prisma-characteristic-definition.adapter.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/herdbook-pack/src/application/adapters/prisma-characteristic-definition.adapter.ts libs/herdbook-pack/src/application/adapters/prisma-characteristic-definition.adapter.spec.ts
git commit -m "feat(herdbook): characteristic definition adapter + shape tests"
```

---

## Task 6: Value adapter + shape tests

**Files:**
- Create: `libs/herdbook-pack/src/application/adapters/prisma-characteristic-value.adapter.ts`
- Test: `libs/herdbook-pack/src/application/adapters/prisma-characteristic-value.adapter.spec.ts`

- [ ] **Step 1: Write the failing shape test**

```typescript
// prisma-characteristic-value.adapter.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { PrismaCharacteristicValueAdapter } from './prisma-characteristic-value.adapter.js';

function fakeRunner(defRow: unknown, queryRows: unknown[] = []) {
  const calls: { method: string; sql: string; params: unknown[] }[] = [];
  let q = 0;
  const tx = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...p: unknown[]) => {
      calls.push({ method: 'query', sql, params: p });
      q += 1;
      // first query in record() looks up the definition's value_type
      if (sql.includes('value_type')) return [defRow];
      return queryRows;
    }),
    $executeRawUnsafe: vi.fn(async (sql: string, ...p: unknown[]) => {
      calls.push({ method: 'execute', sql, params: p });
      return 1;
    }),
  };
  const runner = { run: async (_t: string, fn: (t: typeof tx) => unknown) => fn(tx) };
  return { runner, calls };
}

const T = 'herdbook-tpid-0001';

describe('PrismaCharacteristicValueAdapter', () => {
  it('record looks up the definition value_type, routes the value, inserts into value_num', async () => {
    const { runner, calls } = fakeRunner({ value_type: 'number' });
    const adapter = new PrismaCharacteristicValueAdapter(runner as never);
    const id = await adapter.record(T, {
      animalId: 'a1', definitionId: 'd1', actorUserId: 'u1', num: 4.2,
    });
    expect(typeof id).toBe('string');
    const insert = calls.find((c) => c.method === 'execute');
    expect(insert?.sql).toMatch(/INSERT.*characteristic_value/s);
    // value_num is param position carrying 4.2:
    expect(insert?.params).toContain(4.2);
  });

  it('record rejects a value that does not match the definition value_type', async () => {
    const { runner } = fakeRunner({ value_type: 'number' });
    const adapter = new PrismaCharacteristicValueAdapter(runner as never);
    await expect(
      adapter.record(T, { animalId: 'a1', definitionId: 'd1', actorUserId: 'u1', text: 'x' }),
    ).rejects.toThrow(/expected num/i);
  });

  it('record throws when the definition is not found', async () => {
    const { runner } = fakeRunner(undefined, []);
    const adapter = new PrismaCharacteristicValueAdapter(runner as never);
    await expect(
      adapter.record(T, { animalId: 'a1', definitionId: 'missing', actorUserId: 'u1', num: 1 }),
    ).rejects.toThrow(/definition .* not found/i);
  });

  it('listForAnimal maps typed columns back to the row shape', async () => {
    const valueRow = {
      id: 'v1', animal_id: 'a1', definition_id: 'd1',
      value_num: '4.2000', value_text: null, value_bool: null,
      value_date: null, value_code_value_id: null,
      observed_at: '2026-06-02T00:00:00.000Z',
    };
    const { runner } = fakeRunner({ value_type: 'number' }, [valueRow]);
    const adapter = new PrismaCharacteristicValueAdapter(runner as never);
    const rows = await adapter.listForAnimal(T, 'a1');
    expect(rows[0].num).toBe(4.2);
    expect(rows[0].text).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter herdbook-pack exec vitest run src/application/adapters/prisma-characteristic-value.adapter.spec.ts`
Expected: FAIL — adapter not defined.

- [ ] **Step 3: Implement the adapter** (reuses `routeValue` from Task 4)

```typescript
// prisma-characteristic-value.adapter.ts
import { randomUUID } from 'node:crypto';
import { routeValue } from '../characteristic-value-routing.js';
import type { CharacteristicValueRepository } from '../characteristic.port.js';
import type {
  CharacteristicValueRow,
  CharacteristicValueType,
  RecordValueInput,
} from '../characteristic.view-models.js';
import type { ScopedRunner } from './prisma-individual-read.adapter.js';

interface ValRow {
  id: string;
  animal_id: string;
  definition_id: string;
  value_num: string | number | null;
  value_text: string | null;
  value_bool: boolean | null;
  value_date: Date | string | null;
  value_code_value_id: string | null;
  observed_at: Date | string;
}

function toRow(r: ValRow): CharacteristicValueRow {
  return {
    id: r.id,
    animalId: r.animal_id,
    definitionId: r.definition_id,
    num: r.value_num === null ? null : Number(r.value_num),
    text: r.value_text,
    bool: r.value_bool,
    date: r.value_date ? new Date(r.value_date as string).toISOString().slice(0, 10) : null,
    codeValueId: r.value_code_value_id,
    observedAt: new Date(r.observed_at as string).toISOString(),
  };
}

export class PrismaCharacteristicValueAdapter implements CharacteristicValueRepository {
  constructor(private readonly runner: ScopedRunner) {}

  record(t: string, input: RecordValueInput): Promise<string> {
    return this.runner.run(t, async (tx) => {
      const defRows = (await tx.$queryRawUnsafe(
        `SELECT value_type::text FROM "herdbook"."characteristic_definition" WHERE id = $2`,
        t,
        input.definitionId,
      )) as { value_type: string }[];
      const def = defRows[0];
      if (!def) {
        throw new Error(`characteristic definition ${input.definitionId} not found`);
      }
      const v = routeValue(def.value_type as CharacteristicValueType, input);
      const id = randomUUID();
      await tx.$executeRawUnsafe(
        `INSERT INTO "herdbook"."characteristic_value"
           (id, tenant_pack_id, animal_id, definition_id,
            value_num, value_text, value_bool, value_date, value_code_value_id,
            created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10)`,
        id,
        t,
        input.animalId,
        input.definitionId,
        v.valueNum,
        v.valueText,
        v.valueBool,
        v.valueDate,
        v.valueCodeValueId,
        input.actorUserId,
      );
      return id;
    });
  }

  listForAnimal(t: string, animalId: string): Promise<CharacteristicValueRow[]> {
    return this.runner.run(t, async (tx) => {
      const rows = (await tx.$queryRawUnsafe(
        `SELECT id, animal_id, definition_id, value_num, value_text, value_bool,
                value_date, value_code_value_id, observed_at
           FROM "herdbook"."characteristic_value"
          WHERE animal_id = $2
          ORDER BY observed_at DESC`,
        t,
        animalId,
      )) as ValRow[];
      return rows.map(toRow);
    });
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter herdbook-pack exec vitest run src/application/adapters/prisma-characteristic-value.adapter.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/herdbook-pack/src/application/adapters/prisma-characteristic-value.adapter.ts libs/herdbook-pack/src/application/adapters/prisma-characteristic-value.adapter.spec.ts
git commit -m "feat(herdbook): characteristic value adapter + shape tests"
```

---

## Task 7: Value-type-match DB trigger (rule #1, defense-in-depth)

The column-local CHECK (Task 2) only enforces "≤1 value column set." This trigger enforces the *match* to the definition's `value_type` and the "exactly one for non-computed" half — at the database, so a buggy or future writer cannot bypass it.

**Files:**
- Modify: `libs/herdbook-pack/prisma/migrations/0004_characteristic_metamodel/migration.sql` (append the trigger)
- Test: `libs/herdbook-pack/src/application/adapters/characteristic-metamodel-db.spec.ts` (added in Task 8 will cover it; this task adds the SQL + a focused assertion)

- [ ] **Step 1: Append the trigger to the 0004 migration**

```sql
-- ── rule #1 (DB half): the populated column must match the definition value_type ──
CREATE OR REPLACE FUNCTION "herdbook"."characteristic_value_type_match"()
RETURNS TRIGGER AS $$
DECLARE
  vt text;
  n_set int;
BEGIN
  SELECT value_type::text INTO vt
    FROM "herdbook"."characteristic_definition" WHERE id = NEW."definition_id";
  IF vt IS NULL THEN
    RAISE EXCEPTION 'characteristic_value: definition % not found', NEW."definition_id";
  END IF;

  n_set := (CASE WHEN NEW."value_num"           IS NOT NULL THEN 1 ELSE 0 END)
         + (CASE WHEN NEW."value_text"          IS NOT NULL THEN 1 ELSE 0 END)
         + (CASE WHEN NEW."value_bool"          IS NOT NULL THEN 1 ELSE 0 END)
         + (CASE WHEN NEW."value_date"          IS NOT NULL THEN 1 ELSE 0 END)
         + (CASE WHEN NEW."value_code_value_id" IS NOT NULL THEN 1 ELSE 0 END);

  IF vt = 'computed' THEN
    RAISE EXCEPTION 'characteristic_value: computed definitions cannot carry recorded values';
  END IF;
  IF n_set <> 1 THEN
    RAISE EXCEPTION 'characteristic_value: exactly one value column required (got %)', n_set;
  END IF;
  IF (vt = 'number'  AND NEW."value_num"           IS NULL)
  OR (vt = 'text'    AND NEW."value_text"          IS NULL)
  OR (vt = 'boolean' AND NEW."value_bool"          IS NULL)
  OR (vt = 'date'    AND NEW."value_date"          IS NULL)
  OR (vt = 'code'    AND NEW."value_code_value_id" IS NULL) THEN
    RAISE EXCEPTION 'characteristic_value: populated column does not match value_type %', vt;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS characteristic_value_type_match_trg ON "herdbook"."characteristic_value";
CREATE TRIGGER characteristic_value_type_match_trg
  BEFORE INSERT OR UPDATE ON "herdbook"."characteristic_value"
  FOR EACH ROW EXECUTE FUNCTION "herdbook"."characteristic_value_type_match"();
```

- [ ] **Step 2: Re-apply the migration on the test DB**

Because `0004` was already applied in Task 2, reset the local test DB and re-run setup so the appended trigger lands:

Run: `pnpm run db:setup`
Expected: migration re-applies cleanly (if `migrate deploy` reports "already applied", drop the dev DB per the team's reset script — see `tools/db/setup.mjs` — and re-run; the trigger must exist for Task 8).

Verify the trigger exists:
```bash
psql "$DATABASE_URL_MIGRATE" -c "\\df herdbook.characteristic_value_type_match"
```
Expected: one function listed.

- [ ] **Step 3: Commit**

```bash
git add libs/herdbook-pack/prisma/migrations/0004_characteristic_metamodel/migration.sql
git commit -m "feat(herdbook): characteristic_value value-type-match trigger (rule #1 DB half)"
```

---

## Task 8: DB-gated integration spec (RLS, CHECK, trigger, lifecycle, round-trip)

**Files:**
- Create: `libs/herdbook-pack/src/application/adapters/characteristic-metamodel-db.spec.ts`

This runs only under `pnpm run test:db` (live Postgres, `app` role, RLS enforced). It proves the security-critical invariants the shape tests cannot.

- [ ] **Step 1: Write the integration spec**

```typescript
// characteristic-metamodel-db.spec.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaCharacteristicDefinitionAdapter } from './prisma-characteristic-definition.adapter.js';
import { PrismaCharacteristicValueAdapter } from './prisma-characteristic-value.adapter.js';

const DB = process.env['SUBSTRATE_APP_DATABASE_URL'];
const RLS = process.env['SUBSTRATE_RLS_ENABLED'] === 'true';

// A minimal ScopedRunner over a real PrismaClient that sets the GUC per tx.
function realRunner(prisma: PrismaClient) {
  return {
    async run<T>(tenantPackId: string, fn: (tx: any) => Promise<T>): Promise<T> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_pack_id', $1, true)`, tenantPackId);
        return fn(tx);
      });
    },
  };
}

describe.skipIf(!DB || !RLS)('characteristic metamodel (DB)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: DB } } });
  const runner = realRunner(prisma);
  const defs = new PrismaCharacteristicDefinitionAdapter(runner as never);
  const vals = new PrismaCharacteristicValueAdapter(runner as never);

  const TA = `tpid-A-${randomUUID()}`;
  const TB = `tpid-B-${randomUUID()}`;
  let animalA = '';

  beforeAll(async () => {
    // Seed one animal under tenant A directly (kernel individual link omitted for this slice's scope).
    animalA = randomUUID();
    await runner.run(TA, async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "herdbook"."animal" (id, tenant_pack_id, sex) VALUES ($1, $2, 'f')`,
        animalA, TA,
      );
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('publishes a definition and records + reads a typed value', async () => {
    const { id } = await defs.createDraft(TA, { key: 'wool_density', valueType: 'number', unit: 'g/cm2' });
    await defs.publish(TA, id);
    const pub = await defs.findPublishedByKey(TA, 'wool_density');
    expect(pub?.status).toBe('published');

    await vals.record(TA, { animalId: animalA, definitionId: id, actorUserId: 'u1', num: 4.2 });
    const rows = await vals.listForAnimal(TA, animalA);
    expect(rows).toHaveLength(1);
    expect(rows[0].num).toBe(4.2);
  });

  it('RLS hides tenant A definitions from tenant B', async () => {
    await defs.createDraft(TA, { key: 'secret_trait', valueType: 'text' });
    const seenByB = await defs.findPublishedByKey(TB, 'secret_trait');
    expect(seenByB).toBeNull();
    const listB = await defs.listPublished(TB);
    expect(listB.find((d) => d.key === 'secret_trait')).toBeUndefined();
  });

  it('the value-type-match trigger rejects a mismatched column', async () => {
    const { id } = await defs.createDraft(TA, { key: 'num_only', valueType: 'number' });
    await defs.publish(TA, id);
    // Bypass the adapter router and write a text value directly → trigger must reject.
    await expect(
      runner.run(TA, async (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "herdbook"."characteristic_value"
             (id, tenant_pack_id, animal_id, definition_id, value_text, created_by_user_id)
           VALUES ($1, $2, $3, $4, 'nope', 'u1')`,
          randomUUID(), TA, animalA, id,
        ),
      ),
    ).rejects.toThrow(/does not match value_type/i);
  });

  it('the single-value CHECK rejects two populated columns', async () => {
    const { id } = await defs.createDraft(TA, { key: 'two_vals', valueType: 'number' });
    await defs.publish(TA, id);
    await expect(
      runner.run(TA, async (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "herdbook"."characteristic_value"
             (id, tenant_pack_id, animal_id, definition_id, value_num, value_text, created_by_user_id)
           VALUES ($1, $2, $3, $4, 1, 'x', 'u1')`,
          randomUUID(), TA, animalA, id,
        ),
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the DB-gated suite**

Run: `pnpm run ci:local:db`
Expected: setup applies migrations, then `test:db` runs with RLS on; the four integration tests PASS. (Without a DB, `describe.skipIf` skips them — confirm they are reported as skipped under a plain `pnpm test`, not failed.)

- [ ] **Step 3: Commit**

```bash
git add libs/herdbook-pack/src/application/adapters/characteristic-metamodel-db.spec.ts
git commit -m "test(herdbook): DB-gated characteristic metamodel — RLS + CHECK + trigger + round-trip"
```

---

## Task 9: Export the public surface + green the gate

**Files:**
- Modify: `libs/herdbook-pack/src/index.ts` (export the new port + view-models so apps can wire adapters)

- [ ] **Step 1: Add exports**

```typescript
export * from './application/characteristic.view-models.js';
export * from './application/characteristic.port.js';
```

(Adapters are wired by the app composition root, not re-exported from the pack barrel — follow whatever the existing barrel does for `prisma-person.adapter`; if it is not exported there, do not export the new adapters either.)

- [ ] **Step 2: Run the full local gate**

Run: `pnpm run ci:local`
Expected: build + typecheck + all shape/unit tests PASS (DB-gated specs skipped). Then `pnpm run ci:local:db` for the full DB run.

- [ ] **Step 3: Commit + open PR**

```bash
git add libs/herdbook-pack/src/index.ts
git commit -m "feat(herdbook): export characteristic metamodel port + view-models"
git push -u origin feat/customization-engine-slice1-characteristic-metamodel
gh pr create --title "feat(herdbook): characteristic metamodel core (customization engine slice 1.1)" \
  --body "Implements slice 1.1 of the customization-engine spec (docs/superpowers/specs/2026-06-02-herdbook-multi-species-customization-design.md): characteristic_definition + characteristic_value, RLS, typed-value CHECK + match trigger, draft→publish lifecycle, port + Prisma adapters + tests.

Producer: implementer/claude-opus-4-8 [executing-plans]
Effect: cycle-time 0.01±0.02 expert
Effect: findings 2±2 expert"
```

---

## Self-Review (completed by plan author)

- **Spec coverage (this slice):** definition layer atom (`attribute_definition`→`characteristic_definition`) ✅ Task 1/5; instance layer atom (`attribute_value`→`characteristic_value`) ✅ Task 1/6; rule #1 typed-by-value-type ✅ Task 4 (app) + Task 2 CHECK + Task 7 trigger (DB); rule #2 versioning/append-only ✅ `(tenant,key,version)` immutable rows + `supersedes_id` + bind-to-version-row (Task 1/5); rule #4 code_value FK ✅ Task 1; rule #5 tenant + RLS ✅ Task 2/8; rule #6 definitions-only-writable (spine untouched) ✅ (no spine tables modified). Deferred to later slices (correctly out of this plan): assessment templates, measurement protocols, identity schemes, reproduction model, derived-field views (rule #3), the builder UI, profiles/clone-on-adopt, the Phase-5 kernel gamete-role change.
- **Placeholder scan:** none — every step carries real SQL/TS/commands.
- **Type consistency:** `routeValue` signature, `RoutedValue` fields, `CharacteristicValueRow`/`CharacteristicDefinitionRow` shapes, and the adapter method names match the port (`createDraft`/`publish`/`findPublishedByKey`/`findById`/`listPublished`; `record`/`listForAnimal`) across Tasks 3–8.

---

## Remaining Phase-1 slices (roadmap — separate plans)

| Slice | Builds | Depends on |
|-------|--------|------------|
| **1.2** | `assessment_template` + `assessment_template_field` + `assessment_instance` (its field values are `characteristic_value` rows grouped by `assessment_instance_id`) + `derived_field` as **views** (rule #3, fixed aggregation menu) | 1.1 |
| **1.3** | `measurement_protocol` + `measurement_protocol_step` + `measurement` (separate time-series instance type) | 1.1 |
| **1.4** | `identity_scheme` + `identity_value` (per-scheme uniqueness; absorbs TVD) | 1.1 |
| **1.5** | `reproduction_model` (roles, cardinality, `tree_slot_roles`, `gamete_roles`, flags) — pack-side validation before kernel `recordEdge`; generalize `pedigree.service` to read `tree_slot_roles` | 1.1 |

Phase 2 (migrate the live Swiss-sheep tenant onto a seeded profile, expand/contract) begins once 1.1–1.5 land.
