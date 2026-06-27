# Agri E2.2 — Registry + Plan-Tree Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the agri-ecosystem-twin nested-subject registry (farm → field → plot) and the per-plot season plan trees (cover-crop arm A vs B, effect-declared leaves) to the kernel via the api, and expose read endpoints.

**Architecture:** Two kernel-mapping seams in `apps/agri-ecosystem-twin-api/`. (1) The **subject registry** maps onto the kernel `event_log` as append-only `SubjectRegistered` events; the plot→field→farm tree is *derived* on read by folding events through the spine's `buildSubjectForest` ("store generators, derive graphs"). (2) The **season plan trees** map onto `kernel.plan_node` via the kernel's `PrismaPlanTreeStore`; the minimal domain `EffectDeclaration` is widened to the rich kernel effect-declaration surface. Writes (the deterministic seed) run under the migrate/superuser connection (the `app` role has no DELETE grant that `PlanTreeStore.save`'s full-rewrite needs, and RLS is bypassed for the seed); reads (the api endpoints) run under the `app` role with the RLS GUC set via the existing singleton `GucPrismaRunner`.

**Tech Stack:** NestJS 10 (ESM, `.js` import suffixes), `@de-braighter/substrate-{contracts,runtime}@1.2.0`, `@de-braighter/agri-ecosystem-twin-{spine,pack}` (workspace), Prisma 6, Vitest 4, `node:crypto` (deterministic uuidv5, zero new deps).

**Why no kernel change (charter):** uses only existing kernel primitives (`event_log`, `plan_node`); vendoring the `PlanNode` Prisma model into the api schema is the ADR-206 §3 verbatim-vendor pattern E1 already used for `EventLog`/`Outbox` — it authors no kernel concept. The lineage repository is deliberately *not* used for subjects: its `RecordIndividualInput` forces `sex: 'm'|'f'` and `sire|dam|donor|recipient` edge roles onto farms/plots — an animal-pedigree overfit. "herdbook-style" means a nested-subject registry *like* herdbook's, not the animal port.

---

## Conventions (read once, apply to every task)

- **ESM imports:** every relative import ends in `.js` (e.g. `import { x } from './deterministic-id.js'`). Package subpaths: `@de-braighter/substrate-contracts/events`, `/plan-tree`, `/inference`.
- **Result at port boundaries:** substrate ports return `Promise<Result<T, E>>` (`{ ok: true, value }` | `{ ok: false, error }`). Plan-tree store + publisher throw/resolve directly (not Result) — match their signatures.
- **Tenant scope:** every read uses the constant `AGRI_ECOSYSTEM_TWIN_TENANT_PACK_ID` (from `src/config/tenants.ts`) — the same id the seed writes under. Do NOT use the guard-derived v5 id (the documented divergence trap).
- **Commit cadence:** one commit per task, conventional-commit subject `feat(E2.2): …`. Run `pnpm run typecheck && pnpm run lint && pnpm run test` (from the api package or repo root) before each commit.
- **Run unit tests:** from repo root `pnpm --filter @de-braighter/agri-ecosystem-twin-api run test` (or `pnpm -r run test`). Single file: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/<path>.spec.ts`.
- **Determinism / reproducibility:** all ids and the effect `declaredAt` come from fixed constants or pure uuidv5 — never `new Date()` / `crypto.randomUUID()` in fixtures or mappers (only the seed's run-stamp may use wall-clock, and it must not affect persisted ids).

## File structure (all under `apps/agri-ecosystem-twin-api/`)

```
prisma/schema.prisma                         MODIFY  + vendored kernel.PlanNode model
src/registry/deterministic-id.ts             NEW     pure uuidv5(namespace, name)
src/registry/deterministic-id.spec.ts        NEW
src/registry/subject-fixtures.ts             NEW     canonical demo farm/fields/plots (fixed UUIDs) + DEMO_PLOT_SUBJECT_ID
src/registry/subject-event.ts                NEW     pure: fixture⇄SubjectRegistered envelope; event-rows→SubjectNode[]
src/registry/subject-event.spec.ts           NEW
src/registry/subject-registry.service.ts     NEW     app-role READ: listSubjects() → forest
src/registry/subject-registry.service.spec.ts NEW
src/registry/registry.controller.ts          NEW     GET /subjects
src/plan/effect-mapping.ts                   NEW     pure: domain EffectDeclaration → kernel EffectDeclaration
src/plan/effect-mapping.spec.ts              NEW
src/plan/plan-mapping.ts                     NEW     pure: domain season PlanTreeNode → kernel PlanTree
src/plan/plan-mapping.spec.ts                NEW
src/plan/guc-scoped-plan-tree.client.ts      NEW     RLS-GUC adapter (PlanTreePrismaClient over GucPrismaRunner)
src/plan/plan.service.ts                     NEW     app-role READ: getPlan(arm) → PlanTree | null
src/plan/plan.service.spec.ts                NEW
src/plan/plan.controller.ts                  NEW     GET /plan/:arm
src/seed/persist-registry.ts                 NEW     write path: SubjectRegistered events (idempotent)
src/seed/persist-registry.spec.ts            NEW
src/seed/persist-plans.ts                    NEW     write path: PlanTreeStore.save per arm
src/seed/persist-plans.spec.ts               NEW
src/seed/seed.ts                             NEW     CLI: migrate-url client → persist subjects + plans
src/app/app.module.ts                        MODIFY  register RegistryService + PlanService + controllers
src/readout/readout.service.ts               MODIFY  DEMO_PLOT_SUBJECT_UUID → DEMO_PLOT_SUBJECT_ID (fixtures)
package.json                                 MODIFY  + "seed:domain" script
```

---

## Task 1: Vendor the `kernel.plan_node` Prisma model

The `PrismaPlanTreeStore` needs `prisma.planNode.{findMany,deleteMany,createMany}`. The table is created by `kernel-plan-tree.sql` in `db:setup`; we vendor the model so the generated client carries the delegate (ADR-206 §3, same as `EventLog`/`Outbox`).

**Files:**
- Modify: `apps/agri-ecosystem-twin-api/prisma/schema.prisma`

- [ ] **Step 1: Append the vendored model** (after the `Outbox` model)

```prisma
// ─── Vendored kernel.plan_node (ADR-206 §3) ──────────────────────────────────
// Verbatim field-shape projection of substrate's published kernel.plan_node
// (sql/kernel-plan-tree.sql). The TABLE is created by that SQL in db:setup;
// this model exists only so the generated client carries the `planNode`
// delegate PrismaPlanTreeStore reads/writes. Do NOT edit field shapes — refresh
// from the published kernel-plan-tree.sql if substrate changes them.
model PlanNode {
  id                 String    @id @db.Uuid
  tenantPackId       String    @map("tenant_pack_id") @db.Uuid
  treeRootId         String    @map("tree_root_id") @db.Uuid
  parentId           String?   @map("parent_id") @db.Uuid
  ordinal            Int       @default(0)
  depth              Int       @default(0)
  kind               String
  kindRef            String?   @map("kind_ref") @db.Uuid
  tier               String    @default("vendor")
  title              String
  description        String?
  importRef          Json?     @map("import_ref")
  conditions         Json?
  capabilities       Json?
  effects            Json?
  metadata           Json      @default("{}")
  catalogVersionHash String?   @map("catalog_version_hash")
  createdBy          String    @map("created_by") @db.Uuid
  createdAt          DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt          DateTime  @default(now()) @updatedAt @map("updated_at") @db.Timestamptz()
  deletedAt          DateTime? @map("deleted_at") @db.Timestamptz()

  @@index([tenantPackId, treeRootId, ordinal], map: "idx_plan_node_tree")
  @@index([parentId],                          map: "idx_plan_node_parent")
  @@index([tenantPackId, kind],                map: "idx_plan_node_kind")
  @@map("plan_node")
  @@schema("kernel")
}
```

- [ ] **Step 2: Regenerate the client + typecheck**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api run db:generate && pnpm --filter @de-braighter/agri-ecosystem-twin-api run typecheck`
Expected: prisma generate succeeds; typecheck PASS (no usages yet).

> NOTE: `PrismaPlanTreeStore.save` calls `planNode.createMany({ data })` where rows omit columns that have DB defaults (`description`, `importRef`, `createdAt`, `updatedAt`, `deletedAt`, etc.) — the `?`/`@default` above make those optional, so the store's `PlanNodeRecord` payload satisfies the generated `createMany` input. The store's `findMany` `where: { deletedAt: null }` requires the `deletedAt` field — present.

- [ ] **Step 3: Commit**

```bash
git add apps/agri-ecosystem-twin-api/prisma/schema.prisma
git commit -m "feat(E2.2): vendor kernel.plan_node Prisma model (ADR-206 §3)"
```

---

## Task 2: Deterministic uuidv5 helper

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/registry/deterministic-id.ts`
- Test: `apps/agri-ecosystem-twin-api/src/registry/deterministic-id.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { uuidv5, AGRI_ID_NAMESPACE } from './deterministic-id.js';

describe('uuidv5', () => {
  it('is a valid RFC-4122 v5 uuid (version nibble 5, variant 8|9|a|b)', () => {
    const id = uuidv5(AGRI_ID_NAMESPACE, 'farm:greenacre');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is deterministic — same namespace+name yields the same id', () => {
    expect(uuidv5(AGRI_ID_NAMESPACE, 'plot:p1')).toBe(uuidv5(AGRI_ID_NAMESPACE, 'plot:p1'));
  });

  it('is collision-resistant across distinct names', () => {
    expect(uuidv5(AGRI_ID_NAMESPACE, 'a')).not.toBe(uuidv5(AGRI_ID_NAMESPACE, 'b'));
  });

  it('matches the RFC-4122 worked example (DNS namespace, "www.example.com")', () => {
    // Canonical published vector — guards the bit-twiddling.
    const DNS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    expect(uuidv5(DNS, 'www.example.com')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/registry/deterministic-id.spec.ts`
Expected: FAIL — cannot resolve `./deterministic-id.js`.

- [ ] **Step 3: Write the implementation**

```ts
// Deterministic RFC-4122 v5 (SHA-1, name-based) UUIDs — zero deps (node:crypto).
// Used to mint stable kernel UUIDs from human-readable domain slugs so the seed
// is fully reproducible (same slug → same id on every run).
import { createHash } from 'node:crypto';

/** Stable namespace UUID for all agri-ecosystem-twin derived ids. */
export const AGRI_ID_NAMESPACE = 'b6c1f1e2-0a3d-5e4f-8a1b-2c3d4e5f6a7b';

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) throw new Error(`invalid namespace uuid: ${uuid}`);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** RFC-4122 §4.3 name-based UUID, version 5 (SHA-1). */
export function uuidv5(namespace: string, name: string): string {
  const hash = createHash('sha1')
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest();
  const bytes = new Uint8Array(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC-4122 variant
  return bytesToUuid(bytes);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/registry/deterministic-id.spec.ts`
Expected: PASS (4 tests). The RFC vector pins the algorithm exactly.

- [ ] **Step 5: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/registry/deterministic-id.ts apps/agri-ecosystem-twin-api/src/registry/deterministic-id.spec.ts
git commit -m "feat(E2.2): deterministic uuidv5 helper (node:crypto, zero deps)"
```

---

## Task 3: Canonical demo subject fixtures

The reproducible demo estate: 1 farm → 2 fields → 4 plots (2 per field). Each subject's kernel `aggregateId` is a deterministic uuidv5 of its handle. `DEMO_PLOT_SUBJECT_ID` is the plot the E1 readout repoints to.

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/registry/subject-fixtures.ts`

- [ ] **Step 1: Write the fixtures** (no test — pure data, exercised by Tasks 4–6)

```ts
// Canonical demo estate for the wedge — one farm → two fields → four plots.
// Reproducible: each kernel aggregateId is uuidv5(namespace, handle). Seed-only
// synthetic data (no live feed) per the charter `seed-data-only` obligation.
import { uuidv5, AGRI_ID_NAMESPACE } from './deterministic-id.js';
import type { SubjectLevel } from '@de-braighter/agri-ecosystem-twin-pack';

/** A demo subject fixture: a stable handle + display label + level + parent handle. */
export interface SubjectFixture {
  readonly handle: string;
  readonly level: SubjectLevel;
  readonly label: string;
  /** Parent's handle, or null for the farm root. */
  readonly parentHandle: string | null;
  /** Free domain attributes carried in the event payload (region, crop, hectares). */
  readonly attrs: Readonly<Record<string, string | number>>;
}

/** The kernel aggregateId (uuidv5) for a subject handle. */
export function subjectIdOf(handle: string): string {
  return uuidv5(AGRI_ID_NAMESPACE, handle);
}

export const SUBJECT_FIXTURES: readonly SubjectFixture[] = [
  { handle: 'farm:greenacre', level: 'farm', label: 'Greenacre Farm', parentHandle: null,
    attrs: { region: 'Mittelland', hectares: 48 } },
  { handle: 'field:north', level: 'field', label: 'North Field', parentHandle: 'farm:greenacre', attrs: {} },
  { handle: 'field:south', level: 'field', label: 'South Field', parentHandle: 'farm:greenacre', attrs: {} },
  { handle: 'plot:n1', level: 'plot', label: 'North Plot 1', parentHandle: 'field:north',
    attrs: { crop: 'wheat', hectares: 6 } },
  { handle: 'plot:n2', level: 'plot', label: 'North Plot 2', parentHandle: 'field:north',
    attrs: { crop: 'wheat', hectares: 6 } },
  { handle: 'plot:s1', level: 'plot', label: 'South Plot 1', parentHandle: 'field:south',
    attrs: { crop: 'barley', hectares: 5 } },
  { handle: 'plot:s2', level: 'plot', label: 'South Plot 2', parentHandle: 'field:south',
    attrs: { crop: 'barley', hectares: 5 } },
];

/** The season label the demo plan trees are built for. */
export const DEMO_SEASON = '2026' as const;

/** Handles of the plots that get season plan trees (the wedge runs on plots). */
export const PLOT_HANDLES: readonly string[] = SUBJECT_FIXTURES
  .filter((s) => s.level === 'plot')
  .map((s) => s.handle);

/** The single plot the E1 readout reads (replaces its hardcoded literal). */
export const DEMO_PLOT_SUBJECT_ID = subjectIdOf('plot:n1');
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/registry/subject-fixtures.ts
git commit -m "feat(E2.2): canonical demo subject fixtures (farm→2 fields→4 plots)"
```

---

## Task 4: Subject ⇄ event mappers + forest derivation

Pure functions: a fixture → a `SubjectRegistered` domain-event envelope; persisted event rows → `SubjectNode[]` → the spine forest view.

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/registry/subject-event.ts`
- Test: `apps/agri-ecosystem-twin-api/src/registry/subject-event.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { DomainEventEnvelopeSchema } from '@de-braighter/substrate-contracts/events';
import {
  SUBJECT_REGISTERED_EVENT_TYPE, SUBJECT_AGGREGATE_TYPE,
  toSubjectEnvelope, eventRowToSubjectNode, subjectForestFromRows,
} from './subject-event.js';
import { SUBJECT_FIXTURES, subjectIdOf } from './subject-fixtures.js';

const TPID = '10000000-0000-4001-8000-000000000001';

describe('toSubjectEnvelope', () => {
  it('maps a farm fixture to a schema-valid append-only envelope', () => {
    const farm = SUBJECT_FIXTURES.find((s) => s.level === 'farm')!;
    const env = toSubjectEnvelope(farm, TPID);
    expect(() => DomainEventEnvelopeSchema.parse(env)).not.toThrow();
    expect(env.aggregateType).toBe(SUBJECT_AGGREGATE_TYPE);
    expect(env.eventType).toBe(SUBJECT_REGISTERED_EVENT_TYPE);
    expect(env.aggregateId).toBe(subjectIdOf('farm:greenacre'));
    expect(env.payload).toMatchObject({ level: 'farm', parentId: null, handle: 'farm:greenacre' });
  });

  it('resolves a child fixture parentId to the parent uuid', () => {
    const plot = SUBJECT_FIXTURES.find((s) => s.handle === 'plot:n1')!;
    const env = toSubjectEnvelope(plot, TPID);
    expect(env.payload['parentId']).toBe(subjectIdOf('field:north'));
  });
});

describe('subjectForestFromRows', () => {
  it('folds event rows into the plot→field→farm forest', () => {
    const rows = SUBJECT_FIXTURES.map((f) => ({
      aggregateId: subjectIdOf(f.handle),
      payload: toSubjectEnvelope(f, TPID).payload,
    }));
    const forest = subjectForestFromRows(rows);
    expect(forest).toHaveLength(1);             // one farm root
    expect(forest[0]!.kind).toBe('farm');
    expect(forest[0]!.children).toHaveLength(2); // two fields
    expect(forest[0]!.children[0]!.children.length + forest[0]!.children[1]!.children.length).toBe(4);
  });

  it('eventRowToSubjectNode lifts id + kind + label + parentId', () => {
    const f = SUBJECT_FIXTURES.find((s) => s.handle === 'field:north')!;
    const node = eventRowToSubjectNode({ aggregateId: subjectIdOf(f.handle), payload: toSubjectEnvelope(f, TPID).payload });
    expect(node).toEqual({
      id: subjectIdOf('field:north'),
      kind: 'field',
      label: 'North Field',
      parentId: subjectIdOf('farm:greenacre'),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/registry/subject-event.spec.ts`
Expected: FAIL — cannot resolve `./subject-event.js`.

- [ ] **Step 3: Write the implementation**

```ts
// Kernel-mapping seam for the subject registry: domain subject ⇄ kernel
// event_log `SubjectRegistered` envelope, and the read-side fold into the
// spine's derived forest ("store generators, derive graphs" — the hierarchy is
// never stored, only the registration events are).
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { buildSubjectForest, type SubjectNode, type SubjectTreeNode } from '@de-braighter/agri-ecosystem-twin-spine';
import type { SubjectLevel } from '@de-braighter/agri-ecosystem-twin-pack';
import { PACK_ID } from '@de-braighter/agri-ecosystem-twin-pack';
import { type SubjectFixture, subjectIdOf } from './subject-fixtures.js';

export const SUBJECT_AGGREGATE_TYPE = 'agri.subject' as const;
export const SUBJECT_REGISTERED_EVENT_TYPE = 'agri-ecosystem-twin:SubjectRegistered.v1' as const;

/** Seed-pinned actor + occurredAt so the seed is byte-reproducible. */
const SEED_ACTOR = 'agri-ecosystem-twin:seed' as const;
export const SEED_OCCURRED_AT = '2026-01-01T00:00:00.000Z' as const;

/** The `SubjectRegistered` payload shape (pack-owned; kernel persists it opaquely). */
export interface SubjectRegisteredPayload {
  readonly level: SubjectLevel;
  readonly handle: string;
  readonly label: string;
  readonly parentId: string | null;
  readonly attrs: Readonly<Record<string, string | number>>;
}

/** Domain fixture → append-only kernel envelope (caller supplies the RLS scope). */
export function toSubjectEnvelope(fixture: SubjectFixture, tenantPackId: string): DomainEventEnvelope {
  const payload: SubjectRegisteredPayload = {
    level: fixture.level,
    handle: fixture.handle,
    label: fixture.label,
    parentId: fixture.parentHandle === null ? null : subjectIdOf(fixture.parentHandle),
    attrs: fixture.attrs,
  };
  return {
    tenantPackId,
    packId: PACK_ID,
    aggregateType: SUBJECT_AGGREGATE_TYPE,
    aggregateId: subjectIdOf(fixture.handle),
    eventType: SUBJECT_REGISTERED_EVENT_TYPE,
    eventVersion: 1,
    payload: payload as unknown as Record<string, unknown>,
    metadata: { actorRef: SEED_ACTOR },
    occurredAt: SEED_OCCURRED_AT,
  };
}

/** A persisted event row (the columns the read path selects). */
export interface SubjectEventRow {
  readonly aggregateId: string;
  readonly payload: Record<string, unknown>;
}

/** Event row → flat spine SubjectNode (the kernel uuid is the node id). */
export function eventRowToSubjectNode(row: SubjectEventRow): SubjectNode<SubjectLevel> {
  const p = row.payload as unknown as SubjectRegisteredPayload;
  return { id: row.aggregateId, kind: p.level, label: p.label, parentId: p.parentId };
}

/** Fold persisted event rows into the derived plot→field→farm forest. */
export function subjectForestFromRows(rows: readonly SubjectEventRow[]): readonly SubjectTreeNode<SubjectLevel>[] {
  return buildSubjectForest(rows.map(eventRowToSubjectNode));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/registry/subject-event.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/registry/subject-event.ts apps/agri-ecosystem-twin-api/src/registry/subject-event.spec.ts
git commit -m "feat(E2.2): subject⇄event mappers + derived-forest fold"
```

---

## Task 5: Effect-declaration mapping (domain → kernel)

Widen the minimal domain `EffectDeclaration{indicatorId, sign, magnitude, basis}` to the rich kernel `EffectDeclaration` (ADR-154). Pure + deterministic.

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/plan/effect-mapping.ts`
- Test: `apps/agri-ecosystem-twin-api/src/plan/effect-mapping.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { EffectDeclarationSchema } from '@de-braighter/substrate-contracts/plan-tree';
import { effect } from '@de-braighter/agri-ecosystem-twin-spine';
import { toKernelEffect } from './effect-mapping.js';

describe('toKernelEffect', () => {
  it('maps an increase to direction "+" with a normal prior centred on +magnitude', () => {
    const k = toKernelEffect(effect('soil-moisture', 'increase', 2.4, 'field-trial'), 'step:0:cover-vetch');
    expect(() => EffectDeclarationSchema.parse(k)).not.toThrow();
    expect(k.direction).toBe('+');
    expect(k.magnitudePrior).toMatchObject({ kind: 'normal', mean: 2.4 });
    expect(k.basis).toBe('literature');           // field-trial → empirical → literature
    expect(k.indicatorId).toBe('soil-moisture');
  });

  it('maps a decrease to direction "-" with a negative-mean prior', () => {
    const k = toKernelEffect(effect('pest-pressure', 'decrease', 0.06, 'field-trial'), 'step:0:cover-vetch');
    expect(k.direction).toBe('-');
    expect((k.magnitudePrior as { mean: number }).mean).toBeCloseTo(-0.06);
  });

  it('maps expert-estimate basis to "expert"', () => {
    const k = toKernelEffect(effect('yield', 'increase', 0.2, 'expert-estimate'), 'x');
    expect(k.basis).toBe('expert');
  });

  it('is deterministic — same effect+nodeRef yields the same declarationId', () => {
    const a = toKernelEffect(effect('yield', 'increase', 0.2, 'field-trial'), 'n');
    const b = toKernelEffect(effect('yield', 'increase', 0.2, 'field-trial'), 'n');
    expect(a.declarationId).toBe(b.declarationId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/plan/effect-mapping.spec.ts`
Expected: FAIL — cannot resolve `./effect-mapping.js`.

- [ ] **Step 3: Write the implementation**

```ts
// Kernel-mapping seam for effect declarations: the minimal domain effect
// (indicatorId, sign, magnitude, basis) widened to the rich kernel ADR-154
// EffectDeclaration. Seed-pinned scalars (confidence, horizon, declaredAt) keep
// the persisted plan tree reproducible; E3.1 may calibrate them later.
import type { EffectDeclaration as KernelEffect } from '@de-braighter/substrate-contracts/plan-tree';
import {
  type EffectDeclaration as DomainEffect, type EffectBasis, signedDelta,
} from '@de-braighter/agri-ecosystem-twin-spine';
import { uuidv5, AGRI_ID_NAMESPACE } from '../registry/deterministic-id.js';

/** Standard-deviation of the seed magnitude prior, as a fraction of |magnitude|
 *  (floored so a zero-magnitude effect still has a proper, non-degenerate prior). */
const PRIOR_SD_FRACTION = 0.5;
const PRIOR_SD_FLOOR = 0.05;
const SEED_CONFIDENCE = 0.7;
const SEED_HORIZON = 'P1Y' as const;              // one season (ISO-8601 duration)
const SEED_DECLARED_AT = '2026-01-01T00:00:00.000Z' as const;

const BASIS_MAP: Readonly<Record<EffectBasis, KernelEffect['basis']>> = {
  'field-trial': 'literature',          // empirical trial evidence
  'agronomic-literature': 'literature',
  'expert-estimate': 'expert',
};

/** Domain effect → kernel effect declaration. `nodeRef` makes declarationId stable per node. */
export function toKernelEffect(decl: DomainEffect, nodeRef: string): KernelEffect {
  const mean = signedDelta(decl);                 // increase → +mag, decrease → -mag
  const sd = Math.max(Math.abs(decl.magnitude) * PRIOR_SD_FRACTION, PRIOR_SD_FLOOR);
  return {
    declarationId: uuidv5(AGRI_ID_NAMESPACE, `effect:${nodeRef}:${decl.indicatorId}`),
    indicatorId: decl.indicatorId,
    direction: decl.sign === 'increase' ? '+' : '-',
    magnitudePrior: { kind: 'normal', mean, sd },
    confidence: SEED_CONFIDENCE,
    horizon: SEED_HORIZON,
    compositionOperator: 'sum',
    commutative: true,
    basis: BASIS_MAP[decl.basis],
    declaredAt: SEED_DECLARED_AT,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/plan/effect-mapping.spec.ts`
Expected: PASS (4 tests). The `EffectDeclarationSchema.parse` guards the mapping against contract drift.

- [ ] **Step 5: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/plan/effect-mapping.ts apps/agri-ecosystem-twin-api/src/plan/effect-mapping.spec.ts
git commit -m "feat(E2.2): domain→kernel effect-declaration mapping (ADR-154)"
```

---

## Task 6: Season plan-tree mapping (domain → kernel PlanTree)

Map a domain `PlanTreeNode<PlanNodePayload>` (from the pack's `buildSeasonPlan`) onto the kernel `PlanTree` contract: deterministic uuid node ids, `kind`/`kindRef`, sibling `ordinal`, and effect declarations on the intervention leaves.

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/plan/plan-mapping.ts`
- Test: `apps/agri-ecosystem-twin-api/src/plan/plan-mapping.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { PlanTreeSchema } from '@de-braighter/substrate-contracts/plan-tree';
import { buildSeasonPlan } from '@de-braighter/agri-ecosystem-twin-pack';
import { toKernelPlanTree, planTreeRootId } from './plan-mapping.js';

const TPID = '10000000-0000-4001-8000-000000000001';
const PLOT = '00000000-0001-4000-8000-000000000001';

describe('toKernelPlanTree', () => {
  const domain = buildSeasonPlan({ plotId: PLOT, season: '2026', sequence: ['cover-vetch'] });
  const tree = toKernelPlanTree(domain, TPID);

  it('produces a schema-valid kernel PlanTree', () => {
    expect(() => PlanTreeSchema.parse(tree)).not.toThrow();
  });

  it('roots the tree at the deterministic season root id', () => {
    expect(tree.treeRootId).toBe(planTreeRootId(PLOT, '2026'));
    expect(tree.tenantPackId).toBe(TPID);
    const root = tree.nodes.find((n) => n.id === tree.treeRootId)!;
    expect(root.parentId).toBeNull();
    expect(root.kind).toBe('agri.season');
  });

  it('carries the cover-crop effect declarations on the intervention leaf', () => {
    const leaf = tree.nodes.find((n) => n.kind === 'agri.intervention')!;
    expect(leaf.effectDeclarations).toBeDefined();
    expect(leaf.effectDeclarations!.map((e) => e.indicatorId).sort())
      .toEqual(['pest-pressure', 'soil-moisture', 'yield']);
    expect(leaf.parentId).toBe(tree.treeRootId);
    expect(leaf.ordinal).toBe(0);
  });

  it('childrenIds on the root reference the leaf', () => {
    const root = tree.nodes.find((n) => n.id === tree.treeRootId)!;
    const leaf = tree.nodes.find((n) => n.kind === 'agri.intervention')!;
    expect(root.childrenIds).toEqual([leaf.id]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/plan/plan-mapping.spec.ts`
Expected: FAIL — cannot resolve `./plan-mapping.js`.

- [ ] **Step 3: Write the implementation**

```ts
// Kernel-mapping seam for the season plan tree: domain PlanTreeNode (the pack's
// buildSeasonPlan output) → kernel PlanTree (ADR-176 "recurse the plan"). Node
// ids are deterministic uuid5s of the domain slug; effect declarations widen via
// toKernelEffect. childrenIds + ordinal are derived from the tree structure.
import {
  type PlanTree, type PlanNode as KernelPlanNode,
} from '@de-braighter/substrate-contracts/plan-tree';
import {
  flattenPlanTree, type PlanTreeNode, type PlanNode as DomainPlanNode,
} from '@de-braighter/agri-ecosystem-twin-spine';
import type { PlanNodePayload } from '@de-braighter/agri-ecosystem-twin-pack';
import { uuidv5, AGRI_ID_NAMESPACE } from '../registry/deterministic-id.js';
import { toKernelEffect } from './effect-mapping.js';

const SEASON_KIND = 'agri.season' as const;
const INTERVENTION_KIND = 'agri.intervention' as const;

/** Deterministic kernel uuid for a domain plan-node slug. */
function nodeId(slug: string): string {
  return uuidv5(AGRI_ID_NAMESPACE, `plan:${slug}`);
}

/** The deterministic kernel tree-root id for a plot's season plan. */
export function planTreeRootId(plotId: string, season: string): string {
  return nodeId(`season:${plotId}:${season}`);
}

/** Domain season plan tree → kernel PlanTree (caller supplies the RLS scope). */
export function toKernelPlanTree(root: PlanTreeNode<PlanNodePayload>, tenantPackId: string): PlanTree {
  const flat = flattenPlanTree(root); // root-first DFS, parents before children
  // Sibling ordinal = position among nodes sharing a parentId, in flatten order.
  const ordinalByParent = new Map<string | null, number>();
  const ordinalOf = (parentSlug: string | null): number => {
    const next = ordinalByParent.get(parentSlug) ?? 0;
    ordinalByParent.set(parentSlug, next + 1);
    return next;
  };

  const nodes: KernelPlanNode[] = flat.map((node: DomainPlanNode<PlanNodePayload>) => {
    const id = nodeId(node.id);
    const parentId = node.parentId === null ? null : nodeId(node.parentId);
    const childrenIds = flat.filter((n) => n.parentId === node.id).map((n) => nodeId(n.id));
    const ordinal = ordinalOf(node.parentId);
    const base = {
      id, parentId, treeRootId: nodeId(root.id),
      ordinal, metadata: { title: node.label } as Record<string, unknown>,
      childrenIds,
    };
    if (node.payload.kind === 'season') {
      return { ...base, kind: SEASON_KIND, kindRef: `${SEASON_KIND}:${node.payload.season}` };
    }
    return {
      ...base,
      kind: INTERVENTION_KIND,
      kindRef: `${INTERVENTION_KIND}:${node.payload.mixId}`,
      effectDeclarations: node.payload.effects.map((e) => toKernelEffect(e, node.id)),
    };
  });

  return { treeRootId: nodeId(root.id), tenantPackId, nodes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/plan/plan-mapping.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/plan/plan-mapping.ts apps/agri-ecosystem-twin-api/src/plan/plan-mapping.spec.ts
git commit -m "feat(E2.2): domain→kernel season-plan-tree mapping"
```

---

## Task 7: Write path — persist subjects (idempotent)

The seed's subject-write helper: emit one `SubjectRegistered` envelope per fixture, idempotently (skip if already present). Decoupled from Nest — takes a publisher + a tx-runner so it unit-tests against the in-memory double.

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/seed/persist-registry.ts`
- Test: `apps/agri-ecosystem-twin-api/src/seed/persist-registry.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryDomainEventPublisher } from '@de-braighter/substrate-runtime';
import { persistRegistry } from './persist-registry.js';
import { SUBJECT_FIXTURES } from '../registry/subject-fixtures.js';
import { SUBJECT_REGISTERED_EVENT_TYPE } from '../registry/subject-event.js';

const TPID = '10000000-0000-4001-8000-000000000001';

describe('persistRegistry', () => {
  it('publishes one SubjectRegistered event per fixture when none exist', async () => {
    const pub = new InMemoryDomainEventPublisher();
    const written = await persistRegistry({
      publisher: pub, tenantPackId: TPID,
      existingIds: async () => new Set<string>(),
      runInTx: async (fn) => fn({}),
    });
    expect(written).toBe(SUBJECT_FIXTURES.length);
    const events = pub.drain();
    expect(events).toHaveLength(SUBJECT_FIXTURES.length);
    expect(events.every((e) => e.eventType === SUBJECT_REGISTERED_EVENT_TYPE)).toBe(true);
  });

  it('is idempotent — skips fixtures whose subject id already exists', async () => {
    const pub = new InMemoryDomainEventPublisher();
    const all = new Set(SUBJECT_FIXTURES.map((_f, i) => i)); // sentinel; replaced below
    void all;
    const { subjectIdOf } = await import('../registry/subject-fixtures.js');
    const existing = new Set(SUBJECT_FIXTURES.map((f) => subjectIdOf(f.handle)));
    const written = await persistRegistry({
      publisher: pub, tenantPackId: TPID,
      existingIds: async () => existing,
      runInTx: async (fn) => fn({}),
    });
    expect(written).toBe(0);
    expect(pub.drain()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/seed/persist-registry.spec.ts`
Expected: FAIL — cannot resolve `./persist-registry.js`.

- [ ] **Step 3: Write the implementation**

```ts
// Seed write-path for the subject registry: append one SubjectRegistered event
// per fixture, idempotently. Pure of Nest + Prisma — the caller injects the
// publisher, the tenant scope, an existing-id probe, and a tx-runner, so this
// unit-tests against InMemoryDomainEventPublisher and runs live under the seed's
// migrate-url client.
import type { DomainEventPublisher, DomainEventTransaction } from '@de-braighter/substrate-contracts/events';
import { SUBJECT_FIXTURES, subjectIdOf } from '../registry/subject-fixtures.js';
import { toSubjectEnvelope } from '../registry/subject-event.js';

export interface PersistRegistryDeps {
  readonly publisher: DomainEventPublisher;
  readonly tenantPackId: string;
  /** Returns the set of subject aggregateIds already in the event log. */
  readonly existingIds: () => Promise<ReadonlySet<string>>;
  /** Runs `fn` inside one persistence transaction (RLS-scoped under the seed). */
  readonly runInTx: <T>(fn: (tx: DomainEventTransaction) => Promise<T>) => Promise<T>;
}

/** Persist all not-yet-registered subjects; returns how many were written. */
export async function persistRegistry(deps: PersistRegistryDeps): Promise<number> {
  const existing = await deps.existingIds();
  const pending = SUBJECT_FIXTURES.filter((f) => !existing.has(subjectIdOf(f.handle)));
  if (pending.length === 0) return 0;
  const envelopes = pending.map((f) => toSubjectEnvelope(f, deps.tenantPackId));
  await deps.runInTx((tx) => deps.publisher.publishAll(envelopes, tx));
  return pending.length;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/seed/persist-registry.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/seed/persist-registry.ts apps/agri-ecosystem-twin-api/src/seed/persist-registry.spec.ts
git commit -m "feat(E2.2): idempotent subject-registry write path"
```

---

## Task 8: Write path — persist plan trees

The seed's plan-write helper: build both arm plan trees per plot, map to kernel `PlanTree`, and `save` via a `PlanTreeStore`. Unit-tests against `InMemoryPlanTreeStore`.

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/seed/persist-plans.ts`
- Test: `apps/agri-ecosystem-twin-api/src/seed/persist-plans.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryPlanTreeStore } from '@de-braighter/substrate-runtime';
import { persistPlans } from './persist-plans.js';
import { PLOT_HANDLES, DEMO_SEASON, subjectIdOf } from '../registry/subject-fixtures.js';
import { planTreeRootId } from '../plan/plan-mapping.js';

const TPID = '10000000-0000-4001-8000-000000000001';

describe('persistPlans', () => {
  it('saves an A and a B season plan tree for every plot', async () => {
    const store = new InMemoryPlanTreeStore();
    const saved = await persistPlans({ store, tenantPackId: TPID });
    // 2 arms × every plot.
    expect(saved).toBe(PLOT_HANDLES.length * 2);
    for (const handle of PLOT_HANDLES) {
      const plotId = subjectIdOf(handle);
      const a = await store.load(planTreeRootId(`${plotId}:A`, DEMO_SEASON));
      const b = await store.load(planTreeRootId(`${plotId}:B`, DEMO_SEASON));
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a!.tenantPackId).toBe(TPID);
    }
  });

  it('is idempotent — re-running overwrites, not duplicates (same node count)', async () => {
    const store = new InMemoryPlanTreeStore();
    await persistPlans({ store, tenantPackId: TPID });
    await persistPlans({ store, tenantPackId: TPID });
    const plotId = subjectIdOf(PLOT_HANDLES[0]!);
    const a = await store.load(planTreeRootId(`${plotId}:A`, DEMO_SEASON));
    expect(a!.nodes).toHaveLength(2); // season root + one intervention leaf
  });
});
```

> NOTE on the `:A`/`:B` root suffix: each arm is its OWN single-root tree, so the two arms for one plot must not collide on `treeRootId`. `persistPlans` builds each arm with a plot id suffixed `:A` / `:B` so `planTreeRootId` mints distinct roots. The pack's `buildSeasonPlan` is called with that suffixed plot id.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/seed/persist-plans.spec.ts`
Expected: FAIL — cannot resolve `./persist-plans.js`.

- [ ] **Step 3: Write the implementation**

```ts
// Seed write-path for the season plan trees: for every demo plot, build the
// arm-A (vetch) and arm-B (phacelia) single-mix season plans, map to kernel
// PlanTrees, and save. Each arm is its own single-root tree (distinct treeRootId
// via the :A/:B plot-id suffix) so the two never collide. PlanTreeStore.save is
// a full rewrite, so re-running is idempotent. Pure of Nest — takes a store.
import type { PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
import { buildSeasonPlan } from '@de-braighter/agri-ecosystem-twin-pack';
import { PLOT_HANDLES, DEMO_SEASON, subjectIdOf } from '../registry/subject-fixtures.js';
import { toKernelPlanTree } from '../plan/plan-mapping.js';

export interface PersistPlansDeps {
  readonly store: PlanTreeStore;
  readonly tenantPackId: string;
}

const ARM_MIX = { A: 'cover-vetch', B: 'cover-phacelia' } as const;

/** Persist both arm plan trees for every demo plot; returns how many trees saved. */
export async function persistPlans(deps: PersistPlansDeps): Promise<number> {
  let saved = 0;
  for (const handle of PLOT_HANDLES) {
    const plotId = subjectIdOf(handle);
    for (const arm of ['A', 'B'] as const) {
      const domain = buildSeasonPlan({
        plotId: `${plotId}:${arm}`, season: DEMO_SEASON, sequence: [ARM_MIX[arm]],
      });
      await deps.store.save(toKernelPlanTree(domain, deps.tenantPackId));
      saved += 1;
    }
  }
  return saved;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/seed/persist-plans.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/seed/persist-plans.ts apps/agri-ecosystem-twin-api/src/seed/persist-plans.spec.ts
git commit -m "feat(E2.2): season-plan-tree write path (arms A/B per plot)"
```

---

## Task 9: RLS-GUC plan-tree client adapter

The read path runs under the `app` role, so `PrismaPlanTreeStore` must execute with the `app.tenant_pack_id` GUC set. Adapt the singleton `GucPrismaRunner` to the `PlanTreePrismaClient` surface the store needs.

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/plan/guc-scoped-plan-tree.client.ts`

- [ ] **Step 1: Write the adapter** (covered by Task 10's service test against a live-shaped fake; no standalone spec — it is thin glue)

```ts
// RLS-GUC adapter: presents a PlanTreePrismaClient whose every operation runs
// through GucPrismaRunner with app.tenant_pack_id set, so PrismaPlanTreeStore
// reads under the app role obey RLS. load() hits planNode.findMany at the top
// level; save() opens a $transaction — both are routed through runner.run.
import type { GucPrismaRunner } from '@de-braighter/substrate-runtime';
import type {
  PlanTreePrismaClient, PlanNodeDelegate, PlanNodeRecord,
} from '@de-braighter/substrate-runtime';

/** A real Prisma tx exposes planNode; PrismaLike (the runner callback arg) does not — widen. */
type TxWithPlanNode = { planNode: PlanNodeDelegate };

export class GucScopedPlanTreeClient implements PlanTreePrismaClient {
  constructor(
    private readonly runner: GucPrismaRunner,
    private readonly tenantPackId: string,
  ) {}

  get planNode(): PlanNodeDelegate {
    const run = <T>(fn: (d: PlanNodeDelegate) => Promise<T>): Promise<T> =>
      this.runner.run(this.tenantPackId, (tx) => fn((tx as unknown as TxWithPlanNode).planNode));
    return {
      findMany: (args) => run((d) => d.findMany(args)),
      deleteMany: (args) => run((d) => d.deleteMany(args)),
      createMany: (args: { data: readonly PlanNodeRecord[] }) => run((d) => d.createMany(args)),
    };
  }

  $transaction<T>(fn: (tx: PlanTreePrismaClient) => Promise<T>): Promise<T> {
    return this.runner.run(this.tenantPackId, (tx) => fn(tx as unknown as PlanTreePrismaClient));
  }
}
```

> NOTE: the inner tx passed to `$transaction`'s `fn` is the real Prisma tx (has `planNode`); the store only touches `tx.planNode` inside it, never a nested `$transaction`, so the cast is sound. `PlanNodeDelegate`, `PlanNodeRecord`, `PlanTreePrismaClient` are exported from `@de-braighter/substrate-runtime`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/plan/guc-scoped-plan-tree.client.ts
git commit -m "feat(E2.2): RLS-GUC plan-tree client adapter"
```

---

## Task 10: Plan read service + controller

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/plan/plan.service.ts`
- Create: `apps/agri-ecosystem-twin-api/src/plan/plan.controller.ts`
- Test: `apps/agri-ecosystem-twin-api/src/plan/plan.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { InMemoryPlanTreeStore } from '@de-braighter/substrate-runtime';
import { PlanService, type PlanArm } from './plan.service.js';
import { persistPlans } from '../seed/persist-plans.js';
import { PLOT_HANDLES, DEMO_SEASON, subjectIdOf } from '../registry/subject-fixtures.js';
import { planTreeRootId } from './plan-mapping.js';

const TPID = '10000000-0000-4001-8000-000000000001';

describe('PlanService', () => {
  it('returns the persisted plan tree for a plot + arm', async () => {
    const store = new InMemoryPlanTreeStore();
    await persistPlans({ store, tenantPackId: TPID });
    const svc = new PlanService(store);
    const plotId = subjectIdOf(PLOT_HANDLES[0]!);
    const tree = await svc.getPlan(plotId, 'A' as PlanArm);
    expect(tree).not.toBeNull();
    expect(tree!.treeRootId).toBe(planTreeRootId(`${plotId}:A`, DEMO_SEASON));
  });

  it('returns null for a plot with no persisted plan', async () => {
    const svc = new PlanService(new InMemoryPlanTreeStore());
    const tree = await svc.getPlan(subjectIdOf(PLOT_HANDLES[0]!), 'B' as PlanArm);
    expect(tree).toBeNull();
  });
});
```

> NOTE: this test injects `InMemoryPlanTreeStore` directly into `PlanService` — so the service must accept a `PlanTreeStore` (the production wiring in Task 12 passes a `PrismaPlanTreeStore` over the GUC adapter). Same store interface both ways, so the test proves the service logic.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/plan/plan.service.spec.ts`
Expected: FAIL — cannot resolve `./plan.service.js`.

- [ ] **Step 3: Write the service + controller**

`plan.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { PlanTree, PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
import { PLAN_TREE_STORE } from './plan.tokens.js';
import { DEMO_SEASON } from '../registry/subject-fixtures.js';
import { planTreeRootId } from './plan-mapping.js';

/** The two counterfactual arms. */
export type PlanArm = 'A' | 'B';

@Injectable()
export class PlanService {
  constructor(@Inject(PLAN_TREE_STORE) private readonly store: PlanTreeStore) {}

  /** The persisted season plan tree for a plot + arm, or null if none. */
  getPlan(plotId: string, arm: PlanArm): Promise<PlanTree | null> {
    return this.store.load(planTreeRootId(`${plotId}:${arm}`, DEMO_SEASON));
  }
}
```

`plan.tokens.ts` (create alongside — a pack-local `Symbol.for` token so DI identity is stable):

```ts
/** Pack-local DI token for the app-role-scoped PlanTreeStore (Symbol.for: stable across module instances). */
export const PLAN_TREE_STORE: unique symbol = Symbol.for('@de-braighter/agri-ecosystem-twin/PLAN_TREE_STORE');
```

`plan.controller.ts`:

```ts
import { Controller, Get, Param, Query, BadRequestException, NotFoundException } from '@nestjs/common';
import type { PlanTree } from '@de-braighter/substrate-contracts/plan-tree';
import { PlanService, type PlanArm } from './plan.service.js';

@Controller('plan')
export class PlanController {
  constructor(private readonly service: PlanService) {}

  /** GET /plan/:arm?plotId=<uuid> — the persisted season plan tree for a plot + arm. */
  @Get(':arm')
  async plan(@Param('arm') arm: string, @Query('plotId') plotId?: string): Promise<PlanTree> {
    if (arm !== 'A' && arm !== 'B') throw new BadRequestException(`arm must be 'A' or 'B', got '${arm}'`);
    if (!plotId) throw new BadRequestException('plotId query param is required');
    const tree = await this.service.getPlan(plotId, arm as PlanArm);
    if (tree === null) throw new NotFoundException(`no plan tree for plot ${plotId} arm ${arm}`);
    return tree;
  }
}
```

> The `Task 10 Step 1` test constructs `new PlanService(store)` positionally — Nest's `@Inject` decorator does not affect direct constructor calls, so the test passing the store as the first arg works.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/plan/plan.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/plan/plan.service.ts apps/agri-ecosystem-twin-api/src/plan/plan.tokens.ts apps/agri-ecosystem-twin-api/src/plan/plan.controller.ts apps/agri-ecosystem-twin-api/src/plan/plan.service.spec.ts
git commit -m "feat(E2.2): plan read service + GET /plan/:arm controller"
```

---

## Task 11: Subject read service + controller

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/registry/subject-registry.service.ts`
- Create: `apps/agri-ecosystem-twin-api/src/registry/registry.controller.ts`
- Test: `apps/agri-ecosystem-twin-api/src/registry/subject-registry.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { SubjectRegistryService, type EventLogReader } from './subject-registry.service.js';
import { SUBJECT_FIXTURES, subjectIdOf } from './subject-fixtures.js';
import { toSubjectEnvelope } from './subject-event.js';

const TPID = '10000000-0000-4001-8000-000000000001';

function fakeReader(): EventLogReader {
  const rows = SUBJECT_FIXTURES.map((f) => ({
    aggregateId: subjectIdOf(f.handle),
    payload: toSubjectEnvelope(f, TPID).payload,
  }));
  return { readSubjectRows: async () => rows };
}

describe('SubjectRegistryService', () => {
  it('reads the event rows and returns the derived farm→field→plot forest', async () => {
    const svc = new SubjectRegistryService(fakeReader());
    const forest = await svc.listSubjects();
    expect(forest).toHaveLength(1);
    expect(forest[0]!.kind).toBe('farm');
    expect(forest[0]!.children).toHaveLength(2);
  });

  it('returns an empty forest when no subjects are registered', async () => {
    const svc = new SubjectRegistryService({ readSubjectRows: async () => [] });
    expect(await svc.listSubjects()).toEqual([]);
  });
}
);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/registry/subject-registry.service.spec.ts`
Expected: FAIL — cannot resolve `./subject-registry.service.js`.

- [ ] **Step 3: Write the service + reader + controller**

`subject-registry.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { SubjectTreeNode } from '@de-braighter/agri-ecosystem-twin-spine';
import type { SubjectLevel } from '@de-braighter/agri-ecosystem-twin-pack';
import { subjectForestFromRows, type SubjectEventRow } from './subject-event.js';
import { EVENT_LOG_READER } from './registry.tokens.js';

/** Reads the persisted SubjectRegistered rows for the active tenant scope. */
export interface EventLogReader {
  readSubjectRows(): Promise<readonly SubjectEventRow[]>;
}

@Injectable()
export class SubjectRegistryService {
  constructor(@Inject(EVENT_LOG_READER) private readonly reader: EventLogReader) {}

  /** The derived plot→field→farm forest from the persisted registration events. */
  async listSubjects(): Promise<readonly SubjectTreeNode<SubjectLevel>[]> {
    return subjectForestFromRows(await this.reader.readSubjectRows());
  }
}
```

`registry.tokens.ts`:

```ts
/** Pack-local DI token for the EventLogReader binding (Symbol.for: stable across module instances). */
export const EVENT_LOG_READER: unique symbol = Symbol.for('@de-braighter/agri-ecosystem-twin/EVENT_LOG_READER');
```

`registry.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import type { SubjectTreeNode } from '@de-braighter/agri-ecosystem-twin-spine';
import type { SubjectLevel } from '@de-braighter/agri-ecosystem-twin-pack';
import { SubjectRegistryService } from './subject-registry.service.js';

@Controller('subjects')
export class RegistryController {
  constructor(private readonly service: SubjectRegistryService) {}

  /** GET /subjects — the persisted plot→field→farm registry as a derived forest. */
  @Get()
  subjects(): Promise<readonly SubjectTreeNode<SubjectLevel>[]> {
    return this.service.listSubjects();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/registry/subject-registry.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/registry/subject-registry.service.ts apps/agri-ecosystem-twin-api/src/registry/registry.tokens.ts apps/agri-ecosystem-twin-api/src/registry/registry.controller.ts apps/agri-ecosystem-twin-api/src/registry/subject-registry.service.spec.ts
git commit -m "feat(E2.2): subject read service + GET /subjects controller"
```

---

## Task 12: Wire the read providers + controllers into AppModule

Bind the two pack-local tokens to their app-role-scoped production adapters, register the services + controllers.

**Files:**
- Modify: `apps/agri-ecosystem-twin-api/src/app/app.module.ts`

- [ ] **Step 1: Add the production EventLogReader adapter** (new file `src/registry/prisma-event-log-reader.ts`)

```ts
// App-role EventLogReader: reads SubjectRegistered rows under the RLS GUC via the
// singleton GucPrismaRunner. Selects only the columns the forest fold needs.
import type { GucPrismaRunner } from '@de-braighter/substrate-runtime';
import type { EventLogReader } from './subject-registry.service.js';
import type { SubjectEventRow } from './subject-event.js';
import { SUBJECT_AGGREGATE_TYPE, SUBJECT_REGISTERED_EVENT_TYPE } from './subject-event.js';

type EventLogFindMany = {
  eventLog: {
    findMany(args: {
      where: { aggregateType: string; eventType: string };
      select: { aggregateId: true; payload: true };
      orderBy: { sequence: 'asc' };
    }): Promise<SubjectEventRow[]>;
  };
};

export class PrismaEventLogReader implements EventLogReader {
  constructor(
    private readonly runner: GucPrismaRunner,
    private readonly tenantPackId: string,
  ) {}

  readSubjectRows(): Promise<readonly SubjectEventRow[]> {
    return this.runner.run(this.tenantPackId, (tx) =>
      (tx as unknown as EventLogFindMany).eventLog.findMany({
        where: { aggregateType: SUBJECT_AGGREGATE_TYPE, eventType: SUBJECT_REGISTERED_EVENT_TYPE },
        select: { aggregateId: true, payload: true },
        orderBy: { sequence: 'asc' },
      }),
    );
  }
}
```

- [ ] **Step 2: Register providers + controllers in `app.module.ts`**

Add imports:

```ts
import { PrismaPlanTreeStore } from '@de-braighter/substrate-runtime';
import { SubjectRegistryService } from '../registry/subject-registry.service.js';
import { RegistryController } from '../registry/registry.controller.js';
import { EVENT_LOG_READER } from '../registry/registry.tokens.js';
import { PrismaEventLogReader } from '../registry/prisma-event-log-reader.js';
import { PlanService } from '../plan/plan.service.js';
import { PlanController } from '../plan/plan.controller.js';
import { PLAN_TREE_STORE } from '../plan/plan.tokens.js';
import { GucScopedPlanTreeClient } from '../plan/guc-scoped-plan-tree.client.js';
```

Add `RegistryController, PlanController` to the `controllers` array, and these to `providers`:

```ts
    SubjectRegistryService,
    PlanService,
    {
      provide: EVENT_LOG_READER,
      useFactory: (r: GucPrismaRunner) =>
        new PrismaEventLogReader(r, AGRI_ECOSYSTEM_TWIN_TENANT_PACK_ID),
      inject: [GucPrismaRunner],
    },
    {
      provide: PLAN_TREE_STORE,
      useFactory: (r: GucPrismaRunner) =>
        new PrismaPlanTreeStore(
          new GucScopedPlanTreeClient(r, AGRI_ECOSYSTEM_TWIN_TENANT_PACK_ID),
          { tenantPackId: AGRI_ECOSYSTEM_TWIN_TENANT_PACK_ID, userId: '00000000-0000-0000-0000-000000000000' },
        ),
      inject: [GucPrismaRunner],
    },
```

(Ensure `AGRI_ECOSYSTEM_TWIN_TENANT_PACK_ID` is imported — it already is via `../config/tenants.js`.)

- [ ] **Step 3: Typecheck + build + full test**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api run typecheck && pnpm --filter @de-braighter/agri-ecosystem-twin-api run build && pnpm --filter @de-braighter/agri-ecosystem-twin-api run test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/registry/prisma-event-log-reader.ts apps/agri-ecosystem-twin-api/src/app/app.module.ts
git commit -m "feat(E2.2): wire registry + plan read providers into AppModule"
```

---

## Task 13: Repoint the E1 readout at the registry plot

**Files:**
- Modify: `apps/agri-ecosystem-twin-api/src/readout/readout.service.ts`

- [ ] **Step 1: Replace the hardcoded subject literal**

Delete the `DEMO_PLOT_SUBJECT_UUID` const and import the fixtures constant:

```ts
import { DEMO_PLOT_SUBJECT_ID } from '../registry/subject-fixtures.js';
```

Replace every `DEMO_PLOT_SUBJECT_UUID` usage with `DEMO_PLOT_SUBJECT_ID` (the `subject.id`, and the three sentinel `subjectId:` returns).

- [ ] **Step 2: Run the readout test (unchanged behavior)**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api exec vitest run src/readout/readout.service.spec.ts`
Expected: PASS (3 tests — they assert mean/p10/p90, not the subject id, so they still pass).

- [ ] **Step 3: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/readout/readout.service.ts
git commit -m "feat(E2.2): readout reads the registry demo plot (drop hardcoded literal)"
```

---

## Task 14: Seed CLI entrypoint + npm script

The in-app seed (markets ingestion-adapter shape, NOT root `tools/db`): under the **migrate** connection (superuser, RLS bypassed, DELETE allowed for the plan-tree full-rewrite), persist subjects then plans.

**Files:**
- Create: `apps/agri-ecosystem-twin-api/src/seed/seed.ts`
- Modify: `apps/agri-ecosystem-twin-api/package.json`

- [ ] **Step 1: Write the seed entrypoint**

```ts
// In-app domain seed (E2.2): persist the canonical subject registry + season
// plan trees under the migrate/superuser connection. Idempotent — re-running
// skips already-registered subjects and overwrites plan trees in place.
//
// Run: pnpm --filter @de-braighter/agri-ecosystem-twin-api run seed:domain
// Requires DATABASE_URL_MIGRATE (the admin url db:setup uses).
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { PrismaOutboxWriter, PrismaPlanTreeStore } from '@de-braighter/substrate-runtime';
import { AGRI_ECOSYSTEM_TWIN_TENANT_PACK_ID } from '../config/tenants.js';
import { persistRegistry } from './persist-registry.js';
import { persistPlans } from './persist-plans.js';
import { SUBJECT_AGGREGATE_TYPE, SUBJECT_REGISTERED_EVENT_TYPE } from '../registry/subject-event.js';

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL_MIGRATE'] ?? process.env['DATABASE_URL'];
  if (!url) throw new Error('[seed:domain] DATABASE_URL_MIGRATE (or DATABASE_URL) is required');
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  const tpid = AGRI_ECOSYSTEM_TWIN_TENANT_PACK_ID;

  try {
    // ── Subjects → event_log (idempotent) ──
    const publisher = new PrismaOutboxWriter();
    const written = await persistRegistry({
      publisher,
      tenantPackId: tpid,
      existingIds: async () => {
        const rows = await prisma.eventLog.findMany({
          where: { tenantPackId: tpid, aggregateType: SUBJECT_AGGREGATE_TYPE, eventType: SUBJECT_REGISTERED_EVENT_TYPE },
          select: { aggregateId: true },
        });
        return new Set(rows.map((r) => r.aggregateId));
      },
      runInTx: (fn) => prisma.$transaction((tx) => fn(tx)),
    });
    console.log(`[seed:domain] subjects: ${written} registered (${written === 0 ? 'already present' : 'new'})`);

    // ── Plan trees → kernel.plan_node (full-rewrite, idempotent) ──
    const store = new PrismaPlanTreeStore(prisma, { tenantPackId: tpid, userId: '00000000-0000-0000-0000-000000000000' });
    const saved = await persistPlans({ store, tenantPackId: tpid });
    console.log(`[seed:domain] plan trees: ${saved} saved`);
    console.log('[seed:domain] OK');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((err) => {
  console.error(`[seed:domain] FAILED: ${err?.message ?? err}`);
  process.exitCode = 1;
});
```

> NOTE: `prisma` (a full `PrismaClient`) structurally satisfies both `PrismaOutboxWriter`'s `tx` (it has `eventLog`+`outbox`) and `PrismaPlanTreeStore`'s `PlanTreePrismaClient` (it has `planNode`+`$transaction`). Under the migrate/superuser url RLS is bypassed, so no GUC is needed and `save`'s `deleteMany` is permitted. Rows still carry the correct `tenant_pack_id` (the store stamps it from `ctx`; the publisher from the envelope).

- [ ] **Step 2: Add the npm script** to `apps/agri-ecosystem-twin-api/package.json` `scripts`:

```json
    "seed:domain": "node --import tsx src/seed/seed.ts",
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @de-braighter/agri-ecosystem-twin-api run typecheck`
Expected: PASS. (The seed is not in the unit-test gate — it needs a live DB; verify it compiles.)

- [ ] **Step 4: Commit**

```bash
git add apps/agri-ecosystem-twin-api/src/seed/seed.ts apps/agri-ecosystem-twin-api/package.json
git commit -m "feat(E2.2): in-app domain seed CLI (subjects + plan trees)"
```

---

## Task 15: Full gate + knip + live smoke (optional, if DB available)

**Files:** none (verification)

- [ ] **Step 1: Run the repo gate**

Run (from repo root): `pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run quality:knip:report`
Expected: all green. If `knip` flags an unused export, either it is consumed by a later E-item (add to `knip.ts` ignore with a comment) or genuinely dead (remove it). Tokens/services consumed only via DI may need a `knip` entry — check `knip.ts` for the existing pattern before editing.

- [ ] **Step 2 (only if a DB is reachable): live smoke**

```bash
pnpm run db:start && pnpm run db:generate && pnpm run db:setup
pnpm --filter @de-braighter/agri-ecosystem-twin-api run seed:domain
# start the api, then:
curl -s localhost:3500/subjects  -H 'x-tenant-id: 10000000-0000-4000-8000-000000000001' -H 'x-pack-id: agri-ecosystem-twin' -H 'x-user-id: 00000000-0000-0000-0000-000000000001' | jq '.[0].kind, (.[0].children|length)'
curl -s 'localhost:3500/plan/A?plotId='$(node -e "import('./apps/agri-ecosystem-twin-api/dist/registry/subject-fixtures.js').then(m=>console.log(m.DEMO_PLOT_SUBJECT_ID))") -H 'x-tenant-id: 10000000-0000-4000-8000-000000000001' -H 'x-pack-id: agri-ecosystem-twin' -H 'x-user-id: 00000000-0000-0000-0000-000000000001' | jq '.treeRootId'
```

Expected: `/subjects` → `"farm"` and `2`; `/plan/A` → a treeRootId uuid. (If no DB, skip — the unit suite + typecheck are the gate; live smoke is confirmation, matching E1's posture.)

- [ ] **Step 3: No commit** (verification only).

---

## Self-Review

**Spec coverage (build-path E2.2 + E2 acceptance):**
- "persist one farm → its fields → its plots" → Tasks 3, 4, 7 (event_log) + Task 14 (seed). ✓
- "a season plan tree per plot with mix A and mix B leaves carrying typed effect declarations" → Tasks 5, 6, 8 (mapping + write) + Task 14. ✓
- "to the kernel via the api" → read endpoints Tasks 10, 11; wiring Task 12. ✓
- "reproducible (versioned catalog + run manifest)" → deterministic uuidv5 ids + seed-pinned scalars (Tasks 2, 5, 6); the pack catalog (E2.1) is the versioned source. (A formal run-manifest emit is E3.1's reproducibility obligation; E2.2's reproducibility is the deterministic seed.) ✓
- readout "replaces the hardcoded subject with the persisted registry" → Task 13. ✓
- `no-kernel-change` → only event_log + plan_node used; PlanNode model is an ADR-206 §3 vendor (Task 1). ✓
- `seed-data-only` → all fixtures synthetic, no live feed. ✓
- `coverage-delta` → every pure mapper + service has a co-located spec (Tasks 2,4,5,6,7,8,10,11). ✓

**Type consistency:** `subjectIdOf`/`SUBJECT_FIXTURES`/`PLOT_HANDLES`/`DEMO_SEASON`/`DEMO_PLOT_SUBJECT_ID` (Task 3) used consistently in 4,7,8,10,11,13,14. `planTreeRootId`/`toKernelPlanTree` (Task 6) used in 8,10. `toKernelEffect` (Task 5) used in 6. `PLAN_TREE_STORE`/`EVENT_LOG_READER` tokens defined (10,11) and bound (12). `GucScopedPlanTreeClient` (9) used in 12. `EventLogReader` interface (11) implemented by `PrismaEventLogReader` (12). `persistRegistry`/`persistPlans` (7,8) used in 14. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Scope:** every path under `apps/agri-ecosystem-twin-api/` (the item `pathPrefix`). No root `tools/db`, no root `package.json`/lockfile, no `libs/` edits. ✓
