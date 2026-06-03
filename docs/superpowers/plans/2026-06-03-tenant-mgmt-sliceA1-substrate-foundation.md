# Tenant Management — Slice A1 (Substrate Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Work in a git worktree off `layers/substrate` `main` (superpowers:using-git-worktrees).

**Goal:** Persist tenants in the substrate as real `core.tenant` + `core.tenant_pack` rows and serve them through a DB-backed `PrismaTenantRegistry`, replacing the hardcoded in-memory registry as the production path — published as a `@de-braighter/substrate-runtime` minor bump.

**Architecture:** Two new *auth-scoped* (global, non-RLS) tables in the `core` governance schema. `core.tenant` is the org root; `core.tenant_pack` owns the `tenant_pack_id` (the RLS scope key, `@db.Uuid`) for each `(tenant, pack)` activation. A new `PrismaTenantRegistry implements TenantRegistry` reads these tables via raw SQL with **no `app.tenant_pack_id` GUC** (resolving the GUC value is its job). `resolveTenantPackId` returns the **stored** value. The published `sql/core-schema.sql` artifact + its drift guard are extended to recognize the auth-scoped table category. No auth change, no consumer migration — herdbook adoption is a separate plan (A2).

**Tech Stack:** TypeScript (ESM, explicit `.js` imports), NestJS DI (`SubstrateModule.forRoot`), Prisma 6 multiSchema (hand-written SQL migrations), Vitest 4 (unit + `describe.skipIf` DB-gated), PostgreSQL 16 RLS, GitHub Packages publish.

**Spec:** `docs/superpowers/specs/2026-06-03-tenant-management-design.md` (§3.1, §3.3, §4 Slice A, §6.1).

---

## Repos & paths

- **substrate** (`D:\development\projects\de-braighter\layers\substrate`) — all code here.
- **specs** (`D:\development\projects\de-braighter\layers\specs`) — Task 1 ADR only.
- Test command: `npx nx test substrate-runtime` (Vitest via Nx). Single file:
  `npx vitest run --config libs/substrate-runtime/vitest.config.ts <relative-spec-path>`.
- DB-gated tests gate on `process.env['SUBSTRATE_DATABASE_URL']` (owner/superuser) and
  `process.env['SUBSTRATE_APP_DATABASE_URL']` (the `app` NOBYPASSRLS role). Apply the new
  migration to the test DB before running them (`prisma migrate deploy` against the owner URL).
- Publish: from `libs/substrate-runtime`, `npm publish` to `https://npm.pkg.github.com`
  (`npm whoami --registry=https://npm.pkg.github.com` → `stibos`). **Check `npm view
  @de-braighter/substrate-runtime version` with EXACT equality before bumping** (never
  substring-grep — the error text echoes the version).

---

## File Structure

**Create:**
- `prisma/migrations/<timestamp>_core_tenant/migration.sql` — DDL for `core.tenant` + `core.tenant_pack` (auth-scoped).
- `libs/substrate-runtime/src/tenant-registry/tenant-registry.contract.ts` — shared contract suite `runTenantRegistryContract(factory, label)`.
- `libs/substrate-runtime/src/tenant-registry/prisma-tenant.registry.ts` — `PrismaTenantRegistry`.
- `libs/substrate-runtime/src/tenant-registry/prisma-tenant.registry.contract.spec.ts` — DB-gated contract spec + auth-scoped-read assertions.
- `libs/substrate-runtime/src/tenant-registry/provision-tenant.ts` — `provisionTenant()` write helper.
- `libs/substrate-runtime/src/tenant-registry/provision-tenant.spec.ts` — DB-gated.

**Modify:**
- `prisma/schema/core.prisma` — add `Tenant` + `TenantPack` Prisma models.
- `libs/substrate-runtime/sql/core-schema.sql` — append the two tables (idempotent).
- `libs/substrate-runtime/src/published-sql/core-schema-drift.spec.ts` — extend for auth-scoped tables.
- `libs/substrate-runtime/src/tenant-registry/in-memory-tenant.registry.spec.ts` — refactor onto the shared contract suite.
- `libs/substrate-runtime/src/composition-root/substrate.module.ts` — add the `tenantRegistry` forRoot option + binding precedence.
- `libs/substrate-runtime/src/index.ts` (public barrel) — export `PrismaTenantRegistry`, `runTenantRegistryContract`, `provisionTenant`.
- `libs/substrate-runtime/package.json` — version bump (`0.19.0` → `0.20.0`).

---

## Task 1: ADR — persisted tenants + auth-scoped core tables

**Agent:** `substrate-architect`. **Repo:** `layers/specs` (PR-gated; worktree off `origin/main`).

**Files:**
- Create: `layers/specs/adr/adr-<next>-persisted-tenants-and-dbtenantregistry.md`
- Modify: `layers/specs/adr/README.md` (consume the `next-free-adr` frontmatter number; bump it).

- [ ] **Step 1: Allocate the number.** Read `layers/specs/adr/README.md` frontmatter
  `next-free-adr` (the prose body lags — trust the frontmatter). Use that number; set
  `next-free-adr` to +1.

- [ ] **Step 2: Write the ADR** from the project's ADR template. It MUST cover:
  - **Decision:** persist tenants as `core.tenant` + `core.tenant_pack`; `core.tenant_pack`
    owns `tenant_pack_id`; `PrismaTenantRegistry` becomes the production `TenantRegistry`
    (InMemory/Permissive retained for tests/dev).
  - **Operationalizes ADR-027 Invariant 2** ("Tenants activate packs" — the `TenantPack`
    binding now a real row, not a derived value). Cite ADR-027.
  - **The auth-scoped core-table category (the load-bearing call):** these tables are global
    (above any single tenant) and read with **no `app.tenant_pack_id` GUC**, so they are NOT
    per-tenant RLS-scoped. No `tenant_pack_isolation` policy; `GRANT SELECT … TO app` (reads),
    writes reserved to the migrate/owner role (A1) and the platform role (slice C). Contrast
    with `core.pack_role_assignment`/`core.consent_receipt` which stay tenant-scoped. Justify
    against ADR-027 §6 (RLS applies to *tenant-scoped* rows; identity/tenant tables are above
    that boundary — the `core.prisma` header already anticipates "BYPASSRLS for the
    pre-context auth lookup"). Note the charter-checker governance-ring precedent.
  - **`tenant_pack_id` ownership + continuity:** `resolveTenantPackId` returns the stored
    value; seed stores `deriveTenantPackId(tenantId, packKey)` so existing derivation is
    preserved; the string-stub vs derived-UUID herdbook inconsistency (spec §3.3) is named and
    deferred to A2.
  - **ADR-176 inclusion test:** tenant/tenant_pack pass leg (b) (≥2 packs need them) — kernel
    governance ring, not pack territory.
  - **Non-goals:** no write HTTP API (slice C), no users/auth (slice B), no herdbook migration
    (A2).

- [ ] **Step 3: Run the doc verifier gates locally.** `tools/lint-md.sh` (body) + the
  `frontmatter-schema.mjs` check (per the specs repo's verifier wave). Fix until green.

- [ ] **Step 4: Commit + PR** (specs repo, PR-gated). Body carries `Producer:` +
  `Effect: cycle-time …`/`findings …` lines per the workbench convention.

```bash
git add adr/adr-<next>-persisted-tenants-and-dbtenantregistry.md adr/README.md
git commit -m "docs: ADR-<next> — persisted tenants + DbTenantRegistry + auth-scoped core tables"
```

---

## Task 2: Prisma models + migration for `core.tenant` + `core.tenant_pack`

**Agent:** `prisma-pro` (or `substrate-coder-pro`). **Repo:** `layers/substrate`.

**Files:**
- Modify: `prisma/schema/core.prisma`
- Create: `prisma/migrations/<timestamp>_core_tenant/migration.sql`

- [ ] **Step 1: Add the Prisma models** to `prisma/schema/core.prisma` (after the
  `ConsentReceipt` model). Mirror the existing `@map`/`@db` conventions. `core.tenant` has NO
  `tenant_pack_id`; `core.tenant_pack` owns it as `@db.Uuid @unique`.

```prisma
/// Auth-scoped (GLOBAL, NOT per-tenant RLS). The org/tenant root — a breed
/// registry association in herdbook terms. Read by PrismaTenantRegistry with NO
/// app.tenant_pack_id GUC set (resolving that GUC value is the registry's job),
/// so a tenant_pack_isolation policy cannot apply. Protected at the app layer
/// (only substrate auth/platform services touch it) + `app` gets SELECT only;
/// writes are the migrate/owner role (A1 seed) or the platform role (slice C).
/// See ADR-<next> + tenant-management spec §3.1/§6.1.
model Tenant {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug        String    @unique
  displayName String    @map("display_name")
  status      String    @default("active") // active | suspended | archived
  metadata    Json      @default("{}") @db.JsonB
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  archivedAt  DateTime? @map("archived_at") @db.Timestamptz()

  @@map("tenant")
  @@schema("core")
}

/// Auth-scoped. The (tenant, pack) activation binding; OWNS `tenant_pack_id`
/// (the RLS scope key written to every tenant-scoped row). One active binding
/// per (tenant_id, pack_key). `deactivated_at IS NULL` = active.
model TenantPack {
  id            String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId      String    @map("tenant_id") @db.Uuid
  packKey       String    @map("pack_key")
  tenantPackId  String    @unique @map("tenant_pack_id") @db.Uuid
  activatedAt   DateTime  @default(now()) @map("activated_at") @db.Timestamptz()
  deactivatedAt DateTime? @map("deactivated_at") @db.Timestamptz()

  @@unique([tenantId, packKey])
  @@map("tenant_pack")
  @@schema("core")
}
```

- [ ] **Step 2: Create the migration SQL.** Use a timestamp newer than the latest existing
  migration directory (`ls prisma/migrations` → pick a `YYYYMMDDHHMMSS` greater than the max).
  Write `prisma/migrations/<timestamp>_core_tenant/migration.sql`. **Auth-scoped posture:** NO
  `ENABLE/FORCE ROW LEVEL SECURITY`, NO `tenant_pack_isolation` policy, `GRANT SELECT` to `app`
  only. The leading marker comment `-- AUTH-SCOPED` is read by the drift guard (Task 4).

```sql
-- Persisted tenants (tenant-management slice A1, ADR-<next>).
-- AUTH-SCOPED core tables: GLOBAL (above any single tenant), read with NO
-- app.tenant_pack_id GUC, so NO tenant_pack_isolation RLS policy. `app` gets
-- SELECT only (PrismaTenantRegistry reads); writes are the migrate/owner role
-- (A1 seed) or the platform role (slice C). See tenant-management spec §6.1.

-- ─── core.tenant ────────────────────────────────────────────────────────────
CREATE TABLE "core"."tenant" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug"         TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'active',
    "metadata"     JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "archived_at"  TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX "uq_tenant_slug" ON "core"."tenant" ("slug");

-- ─── core.tenant_pack ───────────────────────────────────────────────────────
CREATE TABLE "core"."tenant_pack" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL,
    "pack_key"       TEXT NOT NULL,
    "tenant_pack_id" UUID NOT NULL,
    "activated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deactivated_at" TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX "uq_tenant_pack_tenant_id_pack_key" ON "core"."tenant_pack" ("tenant_id", "pack_key");
CREATE UNIQUE INDEX "uq_tenant_pack_tenant_pack_id"     ON "core"."tenant_pack" ("tenant_pack_id");

-- Auth-scoped: registry reads only. NO RLS, NO isolation policy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT ON "core"."tenant"      TO app;
    GRANT SELECT ON "core"."tenant_pack" TO app;
  END IF;
END$$;
```

- [ ] **Step 3: Validate the schema.** Run: `npx prisma validate --schema prisma/schema`
  Expected: "The schema at prisma/schema is valid 🚀".

- [ ] **Step 4: Apply to the local test DB** (if running): `prisma migrate deploy` against the
  owner URL. Expected: the migration applies; `\dt core.*` shows `tenant` + `tenant_pack`.

- [ ] **Step 5: Commit.**

```bash
git add prisma/schema/core.prisma prisma/migrations/<timestamp>_core_tenant/migration.sql
git commit -m "feat(core): core.tenant + core.tenant_pack tables (auth-scoped, ADR-<next>)"
```

---

## Task 3: Mirror the tables into the published `core-schema.sql` artifact

**Agent:** `substrate-coder-pro`. **Repo:** `layers/substrate`.

**Files:**
- Modify: `libs/substrate-runtime/sql/core-schema.sql`

- [ ] **Step 1: Append the idempotent DDL** to `libs/substrate-runtime/sql/core-schema.sql`
  (after the `core.consent_receipt` block). Idempotent guards mirror the existing tables; the
  `-- AUTH-SCOPED` marker mirrors the migration so the drift guard's per-table grant rule
  applies the SELECT-only expectation.

```sql
-- ─── core.tenant (AUTH-SCOPED — global, NO per-tenant RLS) ───────────────────
-- Persisted tenant root. Read by PrismaTenantRegistry with NO app.tenant_pack_id
-- GUC, so NO tenant_pack_isolation policy; `app` gets SELECT only.
CREATE TABLE IF NOT EXISTS "core"."tenant" (
    "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "slug"         TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'active',
    "metadata"     JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "archived_at"  TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_slug" ON "core"."tenant" ("slug");

-- ─── core.tenant_pack (AUTH-SCOPED — owns tenant_pack_id) ────────────────────
CREATE TABLE IF NOT EXISTS "core"."tenant_pack" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL,
    "pack_key"       TEXT NOT NULL,
    "tenant_pack_id" UUID NOT NULL,
    "activated_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "deactivated_at" TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_pack_tenant_id_pack_key" ON "core"."tenant_pack" ("tenant_id", "pack_key");
CREATE UNIQUE INDEX IF NOT EXISTS "uq_tenant_pack_tenant_pack_id"     ON "core"."tenant_pack" ("tenant_pack_id");

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    GRANT SELECT ON "core"."tenant"      TO app;
    GRANT SELECT ON "core"."tenant_pack" TO app;
  END IF;
END$$;
```

- [ ] **Step 2: Verify identifier parity by eye** — every quoted identifier in the migration
  (`tenant`, `tenant_pack`, `slug`, `display_name`, `status`, `metadata`, `created_at`,
  `archived_at`, `tenant_id`, `pack_key`, `tenant_pack_id`, `activated_at`, `deactivated_at`,
  `uq_tenant_slug`, `uq_tenant_pack_tenant_id_pack_key`, `uq_tenant_pack_tenant_pack_id`)
  appears verbatim in the artifact. (The drift guard checks this in Task 4.)

- [ ] **Step 3: Commit.**

```bash
git add libs/substrate-runtime/sql/core-schema.sql
git commit -m "feat(core): mirror tenant + tenant_pack into published core-schema.sql artifact"
```

---

## Task 4: Extend the drift guard to recognize auth-scoped core tables

**Agent:** `substrate-coder-pro`. **Repo:** `layers/substrate`.

**Files:**
- Modify: `libs/substrate-runtime/src/published-sql/core-schema-drift.spec.ts`

**Context:** The current `'carries the RLS policy + GUC + per-table app grants'` test
hard-requires, for EVERY `CREATE TABLE "core"."<t>"`, that the artifact contains
`GRANT SELECT, INSERT, UPDATE ON "core"."<t>" TO app`. Auth-scoped tables grant SELECT only,
so this test must branch on the per-table marker. The marker = the table block (in either the
migration or the artifact) is preceded/annotated by `AUTH-SCOPED`.

- [ ] **Step 1: Run the drift guard to see it fail** (proves the gate bites before the fix):

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/published-sql/core-schema-drift.spec.ts`
Expected: FAIL on `'carries the RLS policy + GUC + per-table app grants'` — the artifact lacks
`GRANT SELECT, INSERT, UPDATE ON "core"."tenant" TO app` (correct — it's SELECT-only).

- [ ] **Step 2: Classify tables as tenant-scoped vs auth-scoped** and assert the right grant
  per class. Replace the body of the `'carries the RLS policy + GUC + per-table app grants'`
  `it(...)` so that, per discovered `CREATE TABLE "core"."<t>"`, it derives whether `<t>` is
  auth-scoped (the artifact's table block carries `AUTH-SCOPED`, OR the table has no
  `tenant_pack_id` column / no `tenant_pack_isolation` policy referencing it) and asserts:
  - auth-scoped → artifact contains `GRANT SELECT ON "core"."<t>" TO app` (no INSERT/UPDATE
    required), and does NOT require a `tenant_pack_isolation` policy on that table;
  - tenant-scoped → unchanged: artifact contains `GRANT SELECT, INSERT, UPDATE ON
    "core"."<t>" TO app` and the table participates in the `tenant_pack_isolation` policy.

```ts
  it('carries the RLS policy + GUC + per-table app grants', () => {
    // Auth-scoped core tables (global, no per-tenant RLS) are marked AUTH-SCOPED
    // in both the migration and the artifact: they get SELECT-only and no
    // isolation policy. Tenant-scoped tables keep the full S/I/U + isolation.
    const isAuthScoped = (table: string): boolean => {
      // The artifact annotates the table block with AUTH-SCOPED on the header line.
      const re = new RegExp(`AUTH-SCOPED[\\s\\S]*?"core"\\."${table}"`, 'i');
      return re.test(CONSOLIDATED);
    };
    for (const { sql } of CORE_MIGRATIONS) {
      for (const table of sql.matchAll(/CREATE TABLE[^"]*"core"\."([a-z_]+)"/g)) {
        const t = table[1];
        if (!t) continue;
        expect(CONSOLIDATED).toContain(`"core"."${t}"`);
        if (isAuthScoped(t)) {
          expect(CONSOLIDATED).toContain(`GRANT SELECT ON "core"."${t}" TO app`);
        } else {
          expect(CONSOLIDATED).toContain(
            `GRANT SELECT, INSERT, UPDATE ON "core"."${t}" TO app`,
          );
        }
      }
    }
    // Artifact-level invariants (satisfied by the tenant-scoped tables) — unchanged.
    expect(CONSOLIDATED).toContain('tenant_pack_isolation');
    expect(CONSOLIDATED).toContain("current_setting('app.tenant_pack_id', true)");
    expect(CONSOLIDATED).toContain('ENABLE ROW LEVEL SECURITY');
    expect(CONSOLIDATED).toContain('FORCE  ROW LEVEL SECURITY');
  });
```

- [ ] **Step 3: Confirm the per-migration grant-key test already passes** for the new
  migration. That test (`'every GRANT <verbs> ON "core".<t> TO app (verb-exact) is present in
  the artifact'`) checks migration→artifact direction: the migration's `GRANT SELECT ON
  "core"."tenant" TO app` must appear in the artifact (it does, from Task 3). No change needed;
  just verify it's green.

- [ ] **Step 4: Run the drift guard — all green.**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/published-sql/core-schema-drift.spec.ts`
Expected: PASS (auto-discovery count now ≥ 4; per-table grants pass for both classes).

- [ ] **Step 5: Commit.**

```bash
git add libs/substrate-runtime/src/published-sql/core-schema-drift.spec.ts
git commit -m "test(core): drift guard recognizes auth-scoped core tables (SELECT-only, no isolation policy)"
```

---

## Task 5: Shared `TenantRegistry` contract suite

**Agent:** `substrate-coder-pro`. **Repo:** `layers/substrate`.

**Files:**
- Create: `libs/substrate-runtime/src/tenant-registry/tenant-registry.contract.ts`
- Modify: `libs/substrate-runtime/src/tenant-registry/in-memory-tenant.registry.spec.ts`

**Context:** Per ADR-202 test-double parity, InMemory + Prisma registries must pass ONE shared
suite. The suite is parameterized by a factory that, given a set of tenant descriptors, returns
a ready `TenantRegistry` (the Prisma variant seeds the DB; the InMemory variant constructs).

- [ ] **Step 1: Write the contract suite.** It exercises all four `TenantRegistry` methods
  against a known fixture. The factory receives descriptors AND must guarantee the registry
  resolves `tenant_pack_id` to `deriveTenantPackId(tenantId, packKey)` for enabled packs (the
  continuity guarantee — both adapters agree on this value).

```ts
import { describe, expect, it } from 'vitest';

import { deriveTenantPackId } from './tenant-registry.js';
import type { TenantDescriptor, TenantRegistry } from './tenant-registry.js';

export const T_ALPHA: TenantDescriptor = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  displayName: 'Alpha Registry',
  registeredPacks: ['herdbook'],
};
export const T_BETA: TenantDescriptor = {
  tenantId: '22222222-2222-4222-8222-222222222222',
  displayName: 'Beta Registry',
  registeredPacks: ['herdbook', 'conservation'],
};
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

export interface TenantRegistryFixture {
  readonly registry: TenantRegistry;
}

/**
 * Shared contract suite — both InMemoryTenantRegistry and PrismaTenantRegistry
 * MUST pass it (ADR-202 test-double parity). `factory(descriptors)` returns a
 * registry pre-loaded with exactly those tenants.
 */
export function runTenantRegistryContract(
  factory: (
    descriptors: readonly TenantDescriptor[],
  ) => TenantRegistryFixture | Promise<TenantRegistryFixture>,
  label: string,
): void {
  describe(label, () => {
    const make = () => factory([T_ALPHA, T_BETA]);

    it('C1 isTenantRegistered — true for known, false for unknown', async () => {
      const { registry } = await make();
      await expect(registry.isTenantRegistered(T_ALPHA.tenantId)).resolves.toBe(true);
      await expect(registry.isTenantRegistered(UNKNOWN)).resolves.toBe(false);
    });

    it('C2 isPackEnabledForTenant — gates on the tenant pack set', async () => {
      const { registry } = await make();
      await expect(registry.isPackEnabledForTenant(T_ALPHA.tenantId, 'herdbook')).resolves.toBe(true);
      await expect(registry.isPackEnabledForTenant(T_ALPHA.tenantId, 'conservation')).resolves.toBe(false);
      await expect(registry.isPackEnabledForTenant(T_BETA.tenantId, 'conservation')).resolves.toBe(true);
      await expect(registry.isPackEnabledForTenant(UNKNOWN, 'herdbook')).resolves.toBe(false);
    });

    it('C3 getDescriptor — returns the descriptor or null', async () => {
      const { registry } = await make();
      const d = await registry.getDescriptor(T_ALPHA.tenantId);
      expect(d?.tenantId).toBe(T_ALPHA.tenantId);
      expect(d?.displayName).toBe(T_ALPHA.displayName);
      expect([...(d?.registeredPacks ?? [])]).toContain('herdbook');
      await expect(registry.getDescriptor(UNKNOWN)).resolves.toBeNull();
    });

    it('C4 resolveTenantPackId — derived value for enabled, null for disabled/unknown', async () => {
      const { registry } = await make();
      await expect(registry.resolveTenantPackId(T_ALPHA.tenantId, 'herdbook')).resolves.toBe(
        deriveTenantPackId(T_ALPHA.tenantId, 'herdbook'),
      );
      await expect(registry.resolveTenantPackId(T_ALPHA.tenantId, 'conservation')).resolves.toBeNull();
      await expect(registry.resolveTenantPackId(UNKNOWN, 'herdbook')).resolves.toBeNull();
    });
  });
}
```

- [ ] **Step 2: Refactor the existing InMemory spec onto the suite.** Replace the body of
  `in-memory-tenant.registry.spec.ts` so it calls the shared suite (keep any InMemory-only
  edge cases as extra `it`s if present).

```ts
import { runTenantRegistryContract, T_ALPHA, T_BETA } from './tenant-registry.contract.js';
import { InMemoryTenantRegistry } from './in-memory-tenant.registry.js';

runTenantRegistryContract(
  (descriptors) => ({ registry: new InMemoryTenantRegistry(descriptors) }),
  'InMemoryTenantRegistry',
);
```

- [ ] **Step 3: Run — green.**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/tenant-registry/in-memory-tenant.registry.spec.ts`
Expected: PASS (C1–C4 for InMemoryTenantRegistry).

- [ ] **Step 4: Commit.**

```bash
git add libs/substrate-runtime/src/tenant-registry/tenant-registry.contract.ts \
        libs/substrate-runtime/src/tenant-registry/in-memory-tenant.registry.spec.ts
git commit -m "test(tenant-registry): shared contract suite; InMemory adopts it"
```

---

## Task 6: `PrismaTenantRegistry` (DB-backed, auth-scoped reads)

**Agent:** `substrate-coder-pro`. **Repo:** `layers/substrate`.

**Files:**
- Create: `libs/substrate-runtime/src/tenant-registry/prisma-tenant.registry.ts`
- Create: `libs/substrate-runtime/src/tenant-registry/prisma-tenant.registry.contract.spec.ts`

**Context:** Reads `core.tenant` + `core.tenant_pack` via raw SQL with **no GUC** (the tables
are non-RLS). Constructed with a plain Prisma-like client (like `PrismaPackRoleAssignmentRepository`
takes a runner, but here no runner/GUC is needed — a direct client). `resolveTenantPackId`
returns the **stored** `tenant_pack_id` from `core.tenant_pack` (active binding only). A
tenant is "registered" iff a `core.tenant` row exists with `status <> 'archived'` and
`archived_at IS NULL`. `getDescriptor.registeredPacks` = active `tenant_pack.pack_key`s.

- [ ] **Step 1: Write the DB-gated contract spec FIRST** (it will fail to import until Step 2
  defines the class). It seeds via the owner URL, reads via the `app` URL to prove auth-scoped
  reads work with NO GUC, and runs the shared contract suite.

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deriveTenantPackId } from './tenant-registry.js';
import { PrismaTenantRegistry } from './prisma-tenant.registry.js';
import { provisionTenant } from './provision-tenant.js';
import {
  runTenantRegistryContract,
  T_ALPHA,
  T_BETA,
} from './tenant-registry.contract.js';

const OWNER = process.env['SUBSTRATE_DATABASE_URL'];      // migrate/owner role
const APP = process.env['SUBSTRATE_APP_DATABASE_URL'] ?? OWNER; // app NOBYPASSRLS

describe.skipIf(!OWNER)('PrismaTenantRegistry — DB-gated', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ownerClient: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let appClient: any;

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    ownerClient = new PrismaClient({ datasources: { db: { url: OWNER } } });
    appClient = new PrismaClient({ datasources: { db: { url: APP } } });
    // Clean slate for the two contract tenants.
    for (const t of [T_ALPHA, T_BETA]) {
      await ownerClient.$executeRawUnsafe(
        `DELETE FROM "core"."tenant_pack" WHERE "tenant_id" = $1::uuid`, t.tenantId,
      );
      await ownerClient.$executeRawUnsafe(
        `DELETE FROM "core"."tenant" WHERE "id" = $1::uuid`, t.tenantId,
      );
    }
  }, 60_000);

  afterAll(async () => {
    await ownerClient?.$disconnect();
    await appClient?.$disconnect();
  });

  // Shared parity suite — the Prisma factory provisions the descriptors, then
  // reads through the APP client (no GUC) to prove the auth-scoped posture.
  runTenantRegistryContract(async (descriptors) => {
    for (const d of descriptors) {
      await provisionTenant(ownerClient, {
        tenantId: d.tenantId,
        slug: d.displayName.toLowerCase().replace(/\s+/g, '-'),
        displayName: d.displayName,
        packKeys: [...d.registeredPacks],
      });
    }
    return { registry: new PrismaTenantRegistry(appClient) };
  }, 'PrismaTenantRegistry');

  it('reads tenants as the app role with NO app.tenant_pack_id GUC set', async () => {
    await provisionTenant(ownerClient, {
      tenantId: T_ALPHA.tenantId,
      slug: 'alpha-registry',
      displayName: T_ALPHA.displayName,
      packKeys: ['herdbook'],
    });
    const reg = new PrismaTenantRegistry(appClient);
    // No set_config call anywhere — proves the tables are not RLS-gated.
    await expect(reg.isTenantRegistered(T_ALPHA.tenantId)).resolves.toBe(true);
    await expect(reg.resolveTenantPackId(T_ALPHA.tenantId, 'herdbook')).resolves.toBe(
      deriveTenantPackId(T_ALPHA.tenantId, 'herdbook'),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails** (import error / red):

Run: `SUBSTRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/substrate npx vitest run --config libs/substrate-runtime/vitest.config.ts src/tenant-registry/prisma-tenant.registry.contract.spec.ts`
Expected: FAIL — `PrismaTenantRegistry` / `provisionTenant` not found. (If `SUBSTRATE_DATABASE_URL`
is unset the suite SKIPS — set it; spin the substrate test Postgres first if needed.)

- [ ] **Step 3: Implement `PrismaTenantRegistry`.** Raw SQL, no GUC, `Promise`-returning,
  matches the `TenantRegistry` interface exactly.

```ts
import { Injectable } from '@nestjs/common';

import type { TenantDescriptor, TenantRegistry } from './tenant-registry.js';

/** Minimal surface PrismaTenantRegistry needs (a plain, non-request-scoped client). */
export interface RawSqlClient {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
}

interface TenantRow { display_name: string }
interface PackRow { pack_key: string }
interface TpidRow { tenant_pack_id: string }

@Injectable()
export class PrismaTenantRegistry implements TenantRegistry {
  constructor(private readonly db: RawSqlClient) {}

  async isTenantRegistered(tenantId: string): Promise<boolean> {
    const rows = await this.db.$queryRawUnsafe<TenantRow[]>(
      `SELECT "display_name" FROM "core"."tenant"
         WHERE "id" = $1::uuid AND "archived_at" IS NULL AND "status" <> 'archived'`,
      tenantId,
    );
    return rows.length > 0;
  }

  async isPackEnabledForTenant(tenantId: string, packId: string): Promise<boolean> {
    if (!(await this.isTenantRegistered(tenantId))) return false;
    const rows = await this.db.$queryRawUnsafe<TpidRow[]>(
      `SELECT "tenant_pack_id" FROM "core"."tenant_pack"
         WHERE "tenant_id" = $1::uuid AND "pack_key" = $2 AND "deactivated_at" IS NULL`,
      tenantId, packId,
    );
    return rows.length > 0;
  }

  async getDescriptor(tenantId: string): Promise<TenantDescriptor | null> {
    const tenant = await this.db.$queryRawUnsafe<TenantRow[]>(
      `SELECT "display_name" FROM "core"."tenant"
         WHERE "id" = $1::uuid AND "archived_at" IS NULL AND "status" <> 'archived'`,
      tenantId,
    );
    const first = tenant[0];
    if (!first) return null;
    const packs = await this.db.$queryRawUnsafe<PackRow[]>(
      `SELECT "pack_key" FROM "core"."tenant_pack"
         WHERE "tenant_id" = $1::uuid AND "deactivated_at" IS NULL ORDER BY "pack_key"`,
      tenantId,
    );
    return {
      tenantId,
      displayName: first.display_name,
      registeredPacks: Object.freeze(packs.map((p) => p.pack_key)),
    };
  }

  async resolveTenantPackId(tenantId: string, packId: string): Promise<string | null> {
    if (!(await this.isTenantRegistered(tenantId))) return null;
    const rows = await this.db.$queryRawUnsafe<TpidRow[]>(
      `SELECT "tenant_pack_id" FROM "core"."tenant_pack"
         WHERE "tenant_id" = $1::uuid AND "pack_key" = $2 AND "deactivated_at" IS NULL
         LIMIT 1`,
      tenantId, packId,
    );
    return rows[0]?.tenant_pack_id ?? null;
  }
}
```

- [ ] **Step 4: Run the DB-gated spec — green** (after Task 7's `provisionTenant` exists; if
  running Task 6 before 7, stub `provisionTenant` import will fail — do Task 7 first or together).

Run: `SUBSTRATE_DATABASE_URL=… SUBSTRATE_APP_DATABASE_URL=… npx vitest run --config libs/substrate-runtime/vitest.config.ts src/tenant-registry/prisma-tenant.registry.contract.spec.ts`
Expected: PASS — C1–C4 + the no-GUC read assertion.

- [ ] **Step 5: Commit.**

```bash
git add libs/substrate-runtime/src/tenant-registry/prisma-tenant.registry.ts \
        libs/substrate-runtime/src/tenant-registry/prisma-tenant.registry.contract.spec.ts
git commit -m "feat(tenant-registry): PrismaTenantRegistry (auth-scoped DB-backed reads)"
```

> **Sequencing note:** Task 7 (`provisionTenant`) is imported by this spec. Implement Task 7
> before running Step 4 here (the subagent may interleave 6 & 7; commit each unit separately).

---

## Task 7: `provisionTenant` write helper

**Agent:** `substrate-coder-pro`. **Repo:** `layers/substrate`.

**Files:**
- Create: `libs/substrate-runtime/src/tenant-registry/provision-tenant.ts`
- Create: `libs/substrate-runtime/src/tenant-registry/provision-tenant.spec.ts`

**Context:** Writes a `core.tenant` row + one `core.tenant_pack` row per pack, computing
`tenant_pack_id = deriveTenantPackId(tenantId, packKey)` (the continuity guarantee). Idempotent
(re-running for the same tenant/pack is a no-op via `ON CONFLICT DO NOTHING`). Runs as the
owner/migrate client (writes — `app` has SELECT only). Used by seeds, the A2 herdbook flip, and
later the slice-C platform API.

- [ ] **Step 1: Write the DB-gated spec FIRST.**

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { deriveTenantPackId } from './tenant-registry.js';
import { provisionTenant } from './provision-tenant.js';

const OWNER = process.env['SUBSTRATE_DATABASE_URL'];

describe.skipIf(!OWNER)('provisionTenant — DB-gated', () => {
  const TID = '33333333-3333-4333-8333-333333333333';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;

  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    db = new PrismaClient({ datasources: { db: { url: OWNER } } });
    await db.$executeRawUnsafe(`DELETE FROM "core"."tenant_pack" WHERE "tenant_id" = $1::uuid`, TID);
    await db.$executeRawUnsafe(`DELETE FROM "core"."tenant" WHERE "id" = $1::uuid`, TID);
  }, 60_000);

  afterAll(async () => { await db?.$disconnect(); });

  it('inserts the tenant + a tenant_pack per pack with the derived tenant_pack_id', async () => {
    await provisionTenant(db, {
      tenantId: TID, slug: 'gamma', displayName: 'Gamma Registry', packKeys: ['herdbook'],
    });
    const tp = await db.$queryRawUnsafe(
      `SELECT "tenant_pack_id" FROM "core"."tenant_pack" WHERE "tenant_id" = $1::uuid AND "pack_key" = 'herdbook'`,
      TID,
    );
    expect(tp[0].tenant_pack_id).toBe(deriveTenantPackId(TID, 'herdbook'));
  });

  it('is idempotent — re-running does not throw or duplicate', async () => {
    await provisionTenant(db, {
      tenantId: TID, slug: 'gamma', displayName: 'Gamma Registry', packKeys: ['herdbook'],
    });
    const cnt = await db.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "core"."tenant_pack" WHERE "tenant_id" = $1::uuid`, TID,
    );
    expect(cnt[0].n).toBe(1);
  });
});
```

- [ ] **Step 2: Run to confirm it fails** (import error).

Run: `SUBSTRATE_DATABASE_URL=… npx vitest run --config libs/substrate-runtime/vitest.config.ts src/tenant-registry/provision-tenant.spec.ts`
Expected: FAIL — `provisionTenant` not found.

- [ ] **Step 3: Implement `provisionTenant`.**

```ts
import { deriveTenantPackId } from './tenant-registry.js';

export interface RawSqlWriteClient {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
}

export interface ProvisionTenantInput {
  readonly tenantId: string;   // caller-chosen UUID (deterministic for seeds)
  readonly slug: string;       // url-safe unique key
  readonly displayName: string;
  readonly packKeys: readonly string[];
}

/**
 * Idempotently persist a tenant + its pack activations. tenant_pack_id is the
 * derived RFC-4122 v5 value (continuity with the in-memory registry). Owner/
 * migrate client only (app has SELECT). Safe to re-run (ON CONFLICT DO NOTHING).
 */
export async function provisionTenant(
  db: RawSqlWriteClient,
  input: ProvisionTenantInput,
): Promise<void> {
  await db.$executeRawUnsafe(
    `INSERT INTO "core"."tenant" ("id", "slug", "display_name")
       VALUES ($1::uuid, $2, $3)
       ON CONFLICT ("id") DO NOTHING`,
    input.tenantId, input.slug, input.displayName,
  );
  for (const packKey of input.packKeys) {
    await db.$executeRawUnsafe(
      `INSERT INTO "core"."tenant_pack" ("tenant_id", "pack_key", "tenant_pack_id")
         VALUES ($1::uuid, $2, $3::uuid)
         ON CONFLICT ("tenant_id", "pack_key") DO NOTHING`,
      input.tenantId, packKey, deriveTenantPackId(input.tenantId, packKey),
    );
  }
}
```

- [ ] **Step 4: Run — green.**

Run: `SUBSTRATE_DATABASE_URL=… npx vitest run --config libs/substrate-runtime/vitest.config.ts src/tenant-registry/provision-tenant.spec.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit.**

```bash
git add libs/substrate-runtime/src/tenant-registry/provision-tenant.ts \
        libs/substrate-runtime/src/tenant-registry/provision-tenant.spec.ts
git commit -m "feat(tenant-registry): provisionTenant write helper (idempotent, derived tenant_pack_id)"
```

---

## Task 8: Wire the `tenantRegistry` forRoot option + exports

**Agent:** `substrate-coder-pro`. **Repo:** `layers/substrate`.

**Files:**
- Modify: `libs/substrate-runtime/src/composition-root/substrate.module.ts`
- Modify: `libs/substrate-runtime/src/index.ts` (public barrel — confirm exact path)

**Context:** Today `TENANT_REGISTRY` binds via `useFactory`: `tenantsOption ? new
InMemoryTenantRegistry(tenantsOption) : new PermissiveTenantRegistry()`. Add a `tenantRegistry?:
TenantRegistry` option (a constructed instance, like the DB-auth repos) that takes precedence —
so a consumer passes `new PrismaTenantRegistry(prismaClient)`. Precedence: explicit
`tenantRegistry` → `tenants` (InMemory) → Permissive.

- [ ] **Step 1: Write a unit test for binding precedence** (no DB — uses a fake registry).

Create `libs/substrate-runtime/src/composition-root/tenant-registry-binding.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { Test } from '@nestjs/testing';

import { SubstrateModule } from './substrate.module.js';
import { TENANT_REGISTRY } from '../tenant-registry/tenant-registry.js';
import type { TenantRegistry } from '../tenant-registry/tenant-registry.js';

const FAKE: TenantRegistry = {
  isTenantRegistered: async () => true,
  isPackEnabledForTenant: async () => true,
  getDescriptor: async () => null,
  resolveTenantPackId: async () => 'fake-tpid',
};

describe('SubstrateModule.forRoot tenantRegistry option', () => {
  it('binds the explicit tenantRegistry instance when provided', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SubstrateModule.forRoot({ manifests: [], tenantRegistry: FAKE })],
    }).compile();
    const bound = moduleRef.get<TenantRegistry>(TENANT_REGISTRY);
    expect(await bound.resolveTenantPackId('x', 'y')).toBe('fake-tpid');
  });
});
```

> If `forRoot({ manifests: [] })` requires other mandatory options, mirror an existing
> `substrate.module.spec.ts` minimal-options fixture (read it first; reuse its shape).

- [ ] **Step 2: Run to confirm it fails** (the option isn't honored yet).

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/composition-root/tenant-registry-binding.spec.ts`
Expected: FAIL — bound registry is Permissive/InMemory, not FAKE.

- [ ] **Step 3: Add the option + precedence.** In `SubstrateModuleOptions` add
  `tenantRegistry?: TenantRegistry;` (document: takes precedence over `tenants`). In the
  `TENANT_REGISTRY` factory provider, prefer it:

```ts
{
  provide: TENANT_REGISTRY,
  useFactory: (): TenantRegistry =>
    tenantRegistryOption
      ? tenantRegistryOption
      : tenantsOption
        ? new InMemoryTenantRegistry(tenantsOption)
        : new PermissiveTenantRegistry(),
},
```

(destructure `tenantRegistry: tenantRegistryOption` from options alongside the existing
`tenants: tenantsOption`.)

- [ ] **Step 4: Export the new public symbols.** In the runtime barrel, add:
  `export { PrismaTenantRegistry } from './tenant-registry/prisma-tenant.registry.js';`
  `export { provisionTenant } from './tenant-registry/provision-tenant.js';`
  `export type { ProvisionTenantInput } from './tenant-registry/provision-tenant.js';`
  `export { runTenantRegistryContract } from './tenant-registry/tenant-registry.contract.js';`
  (Confirm the barrel file path — likely `libs/substrate-runtime/src/index.ts`. If
  `runTenantRegistryContract` belongs in a test-only entrypoint, follow the existing pattern for
  exporting contract suites — e.g. a `/testing` subpath; mirror how
  `runPackRoleAssignmentRepositoryContract` is exported.)

- [ ] **Step 5: Run — green.**

Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/composition-root/tenant-registry-binding.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add libs/substrate-runtime/src/composition-root/substrate.module.ts \
        libs/substrate-runtime/src/composition-root/tenant-registry-binding.spec.ts \
        libs/substrate-runtime/src/index.ts
git commit -m "feat(composition-root): forRoot tenantRegistry option (PrismaTenantRegistry as prod path)"
```

---

## Task 9: Full gate, version bump, publish

**Agent:** `substrate-coder-pro` + verifier wave. **Repo:** `layers/substrate`.

**Files:**
- Modify: `libs/substrate-runtime/package.json` (version)

- [ ] **Step 1: Full unit suite green.**

Run: `npx nx test substrate-runtime`
Expected: PASS (incl. the drift guard + the new binding test; DB-gated specs SKIP without env).

- [ ] **Step 2: DB-gated suite green** against a real Postgres with the `app` role + the new
  migration applied.

Run (apply migration, then):
`SUBSTRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/substrate SUBSTRATE_APP_DATABASE_URL=postgresql://app:app@localhost:5544/substrate npx nx test substrate-runtime`
Expected: PASS — PrismaTenantRegistry + provisionTenant DB-gated specs now RUN and pass.

- [ ] **Step 3: Build green.**

Run: `npx tsc -b libs/substrate-runtime` (nx has pnpm-install friction — `tsc -b` is the
reliable path per the publish recipe). Expected: no errors; `dist/` emitted.

- [ ] **Step 4: Verifier wave** — dispatch `local-ci` + `reviewer` + `charter-checker` +
  `qa-engineer` in parallel (worktree-isolated). The `charter-checker` MUST confirm the
  auth-scoped core tables stay inside the sanctioned governance ring (no new kernel concept;
  ADR-176 inclusion-test verdict matches the ADR). Address blocking findings.

- [ ] **Step 5: Check current published version with EXACT equality, then bump.**

Run: `npm view @de-braighter/substrate-runtime version`
Expected: prints `0.19.0` (the current). If a parallel session already published `0.20.0`,
pick the next free (`0.21.0`) — verify by exact equality, never substring-grep.
Set `libs/substrate-runtime/package.json` `version` to `0.20.0`.

- [ ] **Step 6: Commit the bump + open the PR.**

```bash
git add libs/substrate-runtime/package.json
git commit -m "chore(substrate-runtime): 0.20.0 — persisted tenants + PrismaTenantRegistry"
```
Open the PR (substrate is PR-gated). Body MUST carry:
- `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`
- `Effect: cycle-time <est>±<sd> expert` and `Effect: findings <est>±<sd> expert`
(declare only `cycle-time`/`findings` — cross-repo, no per-merge Sonar scan).

- [ ] **Step 7: After merge — publish + twin ritual.**
  - `cd libs/substrate-runtime && npm publish` (verify `npm view @de-braighter/substrate-runtime version` now equals `0.20.0`).
  - Twin ritual (from `domains/devloop`, MANDATORY): `npm run dev -- drain substrate#<pr>`
    (after the wave), then post-merge `… backfill substrate#<pr>` + `… reconcile substrate#<pr>`.

---

## Done = (A1)

`@de-braighter/substrate-runtime@0.20.0` published, carrying `core.tenant` + `core.tenant_pack`
(in the migration AND the `core-schema.sql` artifact, drift-guard green), a `PrismaTenantRegistry`
proven by DB-gated parity + no-GUC auth-scoped reads, the `forRoot({ tenantRegistry })` option,
and the `provisionTenant` helper. No consumer touched. The ADR is merged in specs. **Next:** the
A2 herdbook-adopt plan (flip onto PrismaTenantRegistry; reconcile the string-vs-UUID
`tenant_pack_id` across ~14 tables + ~140 test usages; seed the herdbook tenant rows; live-verify).

---

## Self-review notes (author)

- **Spec coverage:** §4 Slice A (substrate-side) tasks 2–9; §3.1 two-scope model → auth-scoped
  posture (tasks 2–4); §3.3 continuity → `provisionTenant` derives tenant_pack_id + the A2
  deferral (Done block); §6.1 RLS posture → auth-scoped tables (tasks 2/4 + ADR). The console
  write path (§4 Slice C) is explicitly out (provisionTenant is owner-role only here).
- **Type consistency:** `TenantRegistry` 4-method interface used verbatim in tasks 5/6/8;
  `deriveTenantPackId` reused in tasks 5/6/7; `provisionTenant(db, {tenantId, slug, displayName,
  packKeys})` shape identical in tasks 6 & 7.
- **Open assumptions the executor must verify against the real files (flagged inline):** the
  runtime barrel path for exports (Task 8 Step 4); whether `runTenantRegistryContract` exports
  via a `/testing` subpath like the existing contract suites; `forRoot` minimal-options fixture
  shape (Task 8 Step 1); the substrate test-Postgres port/roles (`:5544`, `app:app`) — mirror
  the existing `prisma-pack-role-assignment.repository.contract.spec.ts` env.
```
