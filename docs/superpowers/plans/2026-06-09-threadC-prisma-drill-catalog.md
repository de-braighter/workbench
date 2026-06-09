# Thread C — Prisma-Backed Drill Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist TENANT-tier drill-catalog writes (`createDrill`/`createTemplate`/`forkTemplate`/`updateDrillDiagram`) to Postgres behind the `PACK_FOOTBALL_PACK_CRUD_DB` flag — the next pack-CRUD-DB rung after squad + lineup. Vendor-tier rows stay in the in-memory manifest; the Prisma adapter unions vendor-from-manifest + tenant-from-DB on reads, writes tenant-to-DB. Plus carry `skin` in the `DrillCatalogUpdated` event.

**Architecture:** Mirror the `PrismaSquadRepository`/`PrismaLineupRepository` precedent exactly: a structural `TenantScopedInterventionCatalogEntryDelegate` on the `TenantScopedClient` union; a `PrismaInterventionCatalogRepository` injecting `TENANT_RUNNER` (every query/mutation inside `runner.run(tx => …)`, RLS via the `app.tenant_pack_id` GUC); a shared `interventionCatalogRepositoryContract(label, makeRepo)` run against the in-memory adapter (always, in CI) and the Prisma adapter (DB-gated `skipIf(!SUBSTRATE_APP_DATABASE_URL)`); a flag-gated provider swap in `pack-football.module.ts`.

**Tech Stack:** TypeScript, NestJS, Prisma 6 + PostgreSQL (multi-schema `football`/`kernel`, RLS via GUC), Vitest, Nx 22.

**Repo:** `domains/exercir`. Branch `feat/threadC-prisma-drill-catalog` (HEAD already has the schema + migration from prisma-pro, `96d755a`).

**Already done (prisma-pro, `96d755a`):** `prisma/packs/football.prisma` has `model InterventionCatalogEntry` (`id`, `tenant_pack_id`, `key`, `kind`, `sub_catalog`, `metadata` Json, `effects` Json, timestamps, `@@unique([tenantPackId,key])`, `@@index([tenantPackId,subCatalog])`, `@@schema("football")`). Migration `20260609120000_add_intervention_catalog/migration.sql` (CREATE TABLE + ENABLE/FORCE RLS + 3 policies on `current_setting('app.tenant_pack_id', true)` + GRANT to `app`). `prisma validate`+`generate` pass. **Do NOT re-author these.**

**Conventions:** ESM `.js` imports. `npx nx test pack-football` (the core pack — Node, NOT the UI lib; targeted `--include` is fine). `npx nx build pack-football pack-football-api`. The DB-gated specs only run with `SUBSTRATE_APP_DATABASE_URL` set (CI without it skips them — that's expected; the in-memory contract still runs). Do NOT use `preview_*`. TDD; one commit per task.

**Key shapes (verbatim — read the files):**
- Out-port `InterventionCatalogRepository` (`pack-football/src/out-ports/intervention-catalog.repository.ts`): `listDrills(filter?)`, `listInterventionsBySubCatalog(subCatalog)`, `findInterventionById(id)`, `findInterventionByKey(key)`, `listRehaSubtreeLibraries()`, `createTemplate(input): Promise<TemplateMutationResult>`, `forkTemplate(sourceKey): Promise<TemplateMutationResult>`, `createDrill(input): Promise<Intervention>`, `updateDrillDiagram(drillKey, diagram, skin?): Promise<DrillDiagramUpdateResult>`.
- In-memory adapter `ManifestInterventionCatalogRepository` (same dir, `manifest-intervention-catalog.repository.ts`) — mirror its LOGIC: `FOOTBALL_INTERVENTION_MANIFEST` (vendor, frozen) + `tenantTier: Map`, `tenantTierKeys: Set`, `diagramOverrides`/`skinOverrides` maps; `withDiagramOverride` folds diagram+skin into `metadata`; `updateDrillDiagram` enforces the ADR-033 tier gate (reject `forbidden-vendor-tier` if the key isn't a tenant-tier key). The Prisma adapter persists the tenant-tier deltas the in-memory one keeps in maps.
- `Intervention` (`manifest/intervention.types.ts`): `{ id, key, kind, subCatalog, metadata: { tier, requirements?, diagram?, skin?, ... }, effects: EffectDeclaration[] }`.
- `TenantRunner`/`TENANT_RUNNER` + `TenantScopedClient` + the `TenantScoped<Model>Delegate` pattern (`out-ports/tenant-runner.port.ts`, lines ~381-404). The precedent: `PrismaSquadRepository` + `squad-repository.spec.ts` + `squad-repository.contract.ts` (read all three — they ARE the template).
- The flag: `isPackCrudDbFlagEnabled()` + `squadRepositoryProviders(useDb)` in `pack-football.module.ts` (mirror for `interventionCatalogRepositoryProviders`).

---

## Task 1: TenantScoped delegate + union member

**Files:**
- Modify: `libs/pack-football/src/out-ports/tenant-runner.port.ts`

- [ ] **Step 1** — read the existing `TenantScopedPlayerRow`/`TenantScopedPlayerDelegate` + the `TenantScopedClient` union. Add, mirroring that style:

```typescript
export interface TenantScopedInterventionCatalogEntryRow {
  id: string;
  tenantPackId: string;
  key: string;
  kind: string;
  subCatalog: string;
  metadata: unknown;   // JSONB — the Intervention.metadata shape
  effects: unknown;    // JSONB — EffectDeclaration[]
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantScopedInterventionCatalogEntryDelegate {
  findMany(args: {
    where?: { subCatalog?: string };
    orderBy?: { key: 'asc' | 'desc' };
  }): Promise<readonly TenantScopedInterventionCatalogEntryRow[]>;
  findFirst(args: {
    where: { key: string } | { id: string };
  }): Promise<TenantScopedInterventionCatalogEntryRow | null>;
  create(args: {
    data: Omit<TenantScopedInterventionCatalogEntryRow, 'createdAt' | 'updatedAt'>;
  }): Promise<TenantScopedInterventionCatalogEntryRow>;
  update(args: {
    where: { id: string };
    data: Partial<Pick<TenantScopedInterventionCatalogEntryRow, 'metadata' | 'effects'>>;
  }): Promise<TenantScopedInterventionCatalogEntryRow>;
}
```

Add `readonly interventionCatalogEntry: TenantScopedInterventionCatalogEntryDelegate;` to the `TenantScopedClient` interface. (Match the EXACT method-arg shapes the real Prisma delegate exposes — if `findMany`'s `where`/`orderBy` differ from the precedent, adjust to compile against the generated client used by `GucPrismaRunner`.)

- [ ] **Step 2** — `npx nx build pack-football` (the union must compile). Commit: `feat(pack-football): TenantScoped intervention-catalog delegate (Thread C)`.

---

## Task 2: Shared out-port contract + in-memory harness

**Files:**
- Create: `libs/pack-football/src/out-ports/intervention-catalog-repository.contract.ts`
- Modify: `libs/pack-football/src/out-ports/manifest-intervention-catalog.repository.spec.ts` (route its assertions through the contract)

- [ ] **Step 1** — read `squad-repository.contract.ts` + `manifest-intervention-catalog.repository.spec.ts`. Extract the adapter-agnostic assertions into `interventionCatalogRepositoryContract(label: string, makeRepo: () => InterventionCatalogRepository | Promise<InterventionCatalogRepository>)`:
  - `listDrills()` returns the vendor drills (the manifest's atomic drills) + any tenant-tier drills;
  - `findInterventionByKey` resolves a vendor key + a created tenant key;
  - `createDrill` then `listDrills` surfaces the new drill;
  - `createTemplate` success + `duplicate-key`;
  - `forkTemplate` success + `source-not-found`;
  - `updateDrillDiagram`: `forbidden-vendor-tier` (a vendor key), `drill-not-found`, success on a forked/created tenant drill, and the **skin** round-trips (set skin → `findInterventionByKey` shows `metadata.skin`).
  Keep assertions that are genuinely adapter-agnostic; leave the in-memory-only cross-instance-isolation test in the spec file (it's implementation-specific).

- [ ] **Step 2** — in the spec, invoke `interventionCatalogRepositoryContract('ManifestInterventionCatalogRepository', () => new ManifestInterventionCatalogRepository())`. Keep the existing in-memory-specific tests.

- [ ] **Step 3** — `npx nx test pack-football --include="**/manifest-intervention-catalog.repository.spec.ts"` → green (the contract + the kept specs). Commit: `test(pack-football): shared intervention-catalog repository contract (Thread C)`.

---

## Task 3: PrismaInterventionCatalogRepository + DB-gated contract

**Files:**
- Create: `libs/pack-football/src/out-ports/prisma-intervention-catalog.repository.ts`
- Create: `libs/pack-football/src/out-ports/intervention-catalog-repository.spec.ts` (the DB-gated harness)

- [ ] **Step 1** — read `prisma-squad.repository.ts` + `prisma-lineup.repository.ts` (the write-heavy precedent) + `squad-repository.spec.ts` (the `GucPrismaRunner` + `describe.skipIf` harness). Implement `PrismaInterventionCatalogRepository implements InterventionCatalogRepository`, constructor `(private readonly runner: TenantRunner)`:
  - **Reads union vendor + tenant.** Vendor = the frozen manifest (`FOOTBALL_INTERVENTION_MANIFEST`, imported like the in-memory adapter); tenant = `runner.run(tx => tx.interventionCatalogEntry.findMany(...))` mapped to `Intervention` (parse `metadata`/`effects` JSONB). `listDrills` = manifest drills + tenant drills (subCatalog='drill'); `findInterventionByKey` checks tenant (DB) first then the manifest; etc. Mirror `ManifestInterventionCatalogRepository`'s read semantics exactly (incl. `withDiagramOverride`-equivalent: the persisted row's `metadata` already carries diagram+skin, so no override map needed — the DB row IS the override).
  - **Writes go to the DB tenant table.** `createDrill`/`createTemplate`/`forkTemplate` → `tx.interventionCatalogEntry.create({ data: { id, tenantPackId: <from GUC/runner>, key, kind, subCatalog, metadata, effects } })`. (The tenantPackId: the runner sets the GUC; the row's `tenant_pack_id` must be written too — source it the SAME way the Prisma squad/lineup repos source the tenant id for writes; READ the precedent for whether it comes from the runner, a passed actor, or a `current_setting` read.) Duplicate key → catch the unique violation (P2002 / SQLSTATE 23505 — duck-type both per the raw-unsafe gotcha) → return `'duplicate-key'`.
  - **`updateDrillDiagram`**: tier-gate — only a tenant-tier (DB) key is updatable; a vendor (manifest) key → `'forbidden-vendor-tier'`; a missing key → `'drill-not-found'`; a non-drill → `'not-a-drill'`. On success, `tx.interventionCatalogEntry.update({ where:{id}, data:{ metadata: {...existing, diagram, ...(skin?{skin}:{})} } })` and return the updated `Intervention`.
  - **ADR-030 TX boundary:** verify how `PrismaLineupRepository` + its application service keep the entity-write + event-outbox in one transaction. If the catalog write must share the outbox TX, follow that precedent (the write happens inside the same `runner.run`/`withDomainEvent` TX the service opens). If the precedent writes entity + outbox separately, mirror that. Report which.
- [ ] **Step 2** — DB-gated spec: `describe.skipIf(!process.env['SUBSTRATE_APP_DATABASE_URL'])`, build a `PrismaInterventionCatalogRepository` via a `GucPrismaRunner` scoped to a spec-OWNED tenant-pack id (distinct namespace, per the squad spec's concurrency-isolation note), run `interventionCatalogRepositoryContract('PrismaInterventionCatalogRepository', …)`, plus an RLS-isolation assertion (two tenants don't see each other's tenant-tier drills). Seed idempotently (DELETE+INSERT under the spec's tenant) like the squad spec.
- [ ] **Step 3** — `npx nx test pack-football --include="**/intervention-catalog-repository.spec.ts"` (skips the DB block without the env var — that's fine; confirm it doesn't error). `npx nx build pack-football`. Commit: `feat(pack-football): PrismaInterventionCatalogRepository (vendor-manifest + tenant-DB union) (Thread C)`.

---

## Task 4: Composition swap (flag-gated)

**Files:**
- Modify: `libs/pack-football/src/pack-football.module.ts`

- [ ] **Step 1** — read `squadRepositoryProviders(useDb)` + `buildProviders()` + where `INTERVENTION_CATALOG_REPOSITORY` is currently bound (`useExisting: ManifestInterventionCatalogRepository`). Add:

```typescript
function interventionCatalogRepositoryProviders(useDb: boolean): Provider[] {
  if (useDb) {
    return [
      { provide: PrismaInterventionCatalogRepository, useFactory: (runner: TenantRunner) => new PrismaInterventionCatalogRepository(runner), inject: [TENANT_RUNNER] },
      { provide: INTERVENTION_CATALOG_REPOSITORY, useExisting: PrismaInterventionCatalogRepository },
    ];
  }
  return [
    ManifestInterventionCatalogRepository,
    { provide: INTERVENTION_CATALOG_REPOSITORY, useExisting: ManifestInterventionCatalogRepository },
  ];
}
```

(Match the EXACT provider shape `squadRepositoryProviders` uses — useClass/useFactory/inject — don't invent a different style.) Replace the current static binding with `...interventionCatalogRepositoryProviders(isPackCrudDbFlagEnabled())` in `buildProviders()`. Export the helper for module unit tests.

- [ ] **Step 2** — `npx nx test pack-football --include="**/pack-football.module.spec.ts"` (if one exists — confirm the flag-off path still binds the in-memory adapter; add a flag-on assertion that it binds the Prisma one, mirroring the squad module test). `npx nx build pack-football pack-football-api`. Commit: `feat(pack-football): flag-gate the drill catalog repo (in-memory ↔ Prisma) (Thread C)`.

---

## Task 5: Carry `skin` in the DrillCatalogUpdated event

**Files:**
- `libs/pack-football/src/events/schemas/` (the event schema) + `libs/pack-football/src/application/update-drill-diagram.service.ts` (the emit).

- [ ] **Step 1** — read `update-drill-diagram.service.ts` (the `DrillCatalogUpdated.v1` emit: payload `{drillKey, diagram, updatedAt, updatedBy}`) + `football-drill-catalog-updated.v1.schema.json` + how event types are registered (grep the kernel event-type catalog / ADR-161 reference). **Decide + report:** (a) a true `.v2` (new schema file + register in the kernel event-type catalog — a SPECS change) OR (b) add `skin` as an OPTIONAL field on the existing `.v1` (backward-compatible, no version bump, no specs change). **Default to (b) if a true `.v2` requires a cross-repo specs change** — an optional additive field is backward-compatible and keeps Thread C exercir-only; note the `.v2`-when-the-catalog-is-event-sourced follow-up. If (a) is cheap (the registration is exercir-local), do (a).
- [ ] **Step 2** — add `skin` (optional) to the event payload + schema; emit it from `updateDrillDiagram` (the service already has the skin — it's passed to `catalog.updateDrillDiagram(drillKey, diagram, skin)`). Update the emit + any payload type + a test asserting the event carries the skin.
- [ ] **Step 3** — `npx nx test pack-football --include="**/update-drill-diagram*"`. `npx nx build pack-football`. Commit: `feat(pack-football): DrillCatalogUpdated carries skin (S2 follow-up, Thread C)`.

---

## Task 6: Full-gate + PR

- [ ] **Step 1** — `npx nx build pack-football pack-football-api` ; `npx nx test pack-football` (full core-pack suite — the DB-gated specs skip without the env var; everything else green) ; `npx nx lint pack-football`. All green.
- [ ] **Step 2** — push + PR. Body: `Tech design:` this plan + the recon; `Producer:`/`Effect:` lines; the migration is a forward-only **Prisma-extension hybrid** (model in DSL + hand-authored RLS SQL); flag-gated (`PACK_FOOTBALL_PACK_CRUD_DB`), demo default stays in-memory. No `Closes` (no leaf story) — "Part of the pack-CRUD-DB fan-out (#142)".
- [ ] **Step 3** — full verifier wave (reviewer + charter + exercir-charter + qa — this is a schema/migration/RLS slice; scrutinize the migration safety, RLS policy correctness, vendor/tenant union, TX boundary). Auto-merge on green; twin ritual.

---

## Self-Review (plan author)

**Spec coverage (recon §F minimal shape):** schema+migration (done, `96d755a`) → delegate/union (Task 1) → contract+in-memory (Task 2) → Prisma adapter w/ vendor-manifest+tenant-DB union + tier-gate + DB-gated RLS contract (Task 3) → flag-gated composition (Task 4) → skin in event (Task 5) → gate (Task 6). RLS posture mirrors the player precedent (done in migration). Vendor-stays-in-manifest (Task 3 union). Skin in metadata JSONB (schema, Task 3 update).

**Placeholder scan:** Task 1 + Task 4 ship concrete code. Tasks 2/3/5 are recipe-over-precedent (the implementer reads `squad-repository.contract.ts` / `prisma-squad.repository.ts` / `update-drill-diagram.service.ts` — concrete templates that exist) with the exact semantics + decision points named (the tenantPackId write-source, the duplicate-key duck-type, the ADR-030 TX boundary, the .v2-vs-additive call). This is deliberate: a from-scratch transcription of large precedent files would be error-prone vs "mirror this exact file." Each names the precedent file + the exact behavior to replicate. Two CONFIRM points flagged (tenantPackId write-source; TX boundary) for the implementer to verify against the lineup precedent.

**Type consistency:** `TenantScopedInterventionCatalogEntryDelegate` (Task 1) consumed by `PrismaInterventionCatalogRepository` (Task 3) + the `TenantScopedClient` union. `interventionCatalogRepositoryContract` (Task 2) run by both adapters (Tasks 2+3). `interventionCatalogRepositoryProviders` (Task 4) binds `INTERVENTION_CATALOG_REPOSITORY` to either adapter. `Intervention`/`InterventionCatalogRepository`/`DrillDiagramUpdateResult`/`TemplateMutationResult` (existing) reused throughout. `isPackCrudDbFlagEnabled` (existing) gates Task 4.
