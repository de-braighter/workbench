# Tenant Management — Slice A3 (Request-Scoped Pack Data Plane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Cross-repo: A3a in `layers/substrate` (worktree off main), A3b in `domains/herdbook` (worktree off main).

**Goal:** Make herdbook genuinely multi-tenant at the data layer — route the per-request `tenantPackContext.tenantPackId` through both the pack data providers (herdbook) and the kernel lineage repo (substrate), so two real tenants' data are RLS-isolated end-to-end (the test that failed in A2 passes).

**Architecture:** Two slices on the ADR-210 (ratified, Option A) decision. **A3a (substrate):** extend `SubstrateModule.forRoot` to accept a **request-scoped** lineage binding — a factory `(tenantPackId) => LineageRepository` bound `Scope.REQUEST` reading `TENANT_PACK_CONTEXT`, so `core.individual`/`core.lineage_edge` writes use the per-request tpid. Additive, no contract change, cascade-safe (no kernel singleton injects `LINEAGE_REPOSITORY`). Published as a runtime minor bump. **A3b (herdbook):** make the 12 pack service providers `Scope.REQUEST` (inject `TENANT_PACK_CONTEXT`, feed `ctx.tenantPackId` to the service constructors that already take a `tenantPackId: string`; adapters + `GucPrismaRunner` stay singleton, taking `t` per call), and bind the lineage repo via the new A3a request-scoped option. Live-verify two-tenant isolation.

**Tech Stack:** NestJS DI scopes (`Scope.REQUEST`, `TENANT_PACK_CONTEXT`), `@de-braighter/substrate-runtime`, Prisma 6 RLS, Vitest, the herdbook `db:setup`/`test:db` harness (:5433), substrate test Postgres (:5544).

**Spec:** ADR-210 (ratified, specs#256) Option A; ADR-209; ADR-197 (scope-cascade discipline); ADR-202 (TenantRunner seam); umbrella §Slice A. **Predecessors:** A1 (`substrate-runtime@0.20.0`), A2 (herdbook#30). Consumer tracking: herdbook#31.

---

## Part A3a — Substrate: request-scoped lineage binding

**Repo:** `layers/substrate` (worktree off main). **Agent:** `substrate-coder-pro`.

**Context:** `SubstrateModule.forRoot` (`libs/substrate-runtime/src/composition-root/substrate.module.ts`, ~line 378 the `lineageRepository?` option, ~line 701 the default resolution, ~line 788 the `LINEAGE_REPOSITORY` provider binding) today binds `LINEAGE_REPOSITORY` SINGLETON from `options.lineageRepository ?? InMemoryLineageRepository`. `PostgresLineageRepository(runner, tenantPackId)` bakes a constant tpid. ADR-210 Option A: add an alternative **request-scoped** binding.

### Task A3a.1: Add the `requestScopedLineageRepository` forRoot option + binding

**Files:** Modify `libs/substrate-runtime/src/composition-root/substrate.module.ts`. Test: `libs/substrate-runtime/src/composition-root/request-scoped-lineage-binding.spec.ts` (create).

- [ ] **Step 1: Write the failing test.** Prove that when `requestScopedLineageRepository` is supplied, `LINEAGE_REPOSITORY` is bound `Scope.REQUEST` and resolves a repo built from the request's `tenantPackContext.tenantPackId`.

```ts
import { describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { REQUEST } from '@nestjs/core';
import { SubstrateModule } from './substrate.module.js';
import { LINEAGE_REPOSITORY } from '@de-braighter/substrate-contracts';
import type { LineageRepository } from '@de-braighter/substrate-contracts';

// A trivial LineageRepository stand-in that records the tpid it was built with.
function fakeLineageFor(tpid: string): LineageRepository {
  // Only the marker matters for this test; cast through unknown.
  return { __tpid: tpid } as unknown as LineageRepository;
}

describe('forRoot requestScopedLineageRepository', () => {
  it('binds LINEAGE_REPOSITORY request-scoped, built from the per-request tenantPackId', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        SubstrateModule.forRoot({
          manifests: [],
          requestScopedLineageRepository: (tpid: string) => fakeLineageFor(tpid),
        }),
      ],
    })
      // Provide a fake request carrying tenantPackContext for the request-scoped resolution.
      .overrideProvider(REQUEST)
      .useValue({ tenantPackContext: { tenantPackId: 'tpid-AAA', tenantId: 't', packId: 'p', userId: 'u', requestId: 'r' } })
      .compile();

    const repo = await moduleRef.resolve<LineageRepository>(LINEAGE_REPOSITORY);
    expect((repo as unknown as { __tpid: string }).__tpid).toBe('tpid-AAA');
  });
});
```
> Mirror an existing `substrate.module*.spec.ts` for the minimal valid `forRoot({...})` options + the request-override mechanics (read one first; `moduleRef.resolve` is required for request-scoped providers, not `.get`).

- [ ] **Step 2: Run → fail** (`option not recognized` / binding singleton).
  Run: `npx vitest run --config libs/substrate-runtime/vitest.config.ts src/composition-root/request-scoped-lineage-binding.spec.ts` → FAIL.

- [ ] **Step 3: Add the option to `SubstrateModuleOptions`** (near the existing `lineageRepository?` at ~line 378), documented:
```ts
  /**
   * Request-scoped alternative to `lineageRepository` (ADR-210 Option A). When
   * supplied, `LINEAGE_REPOSITORY` binds `Scope.REQUEST`: per request the factory
   * is called with the request's `tenantPackContext.tenantPackId`, so the lineage
   * repo (core.individual / core.lineage_edge writes) is tenant-correct per request
   * rather than carrying a composition-time constant. Mutually exclusive with
   * `lineageRepository` (supply one or the other). Cascade-safe: no kernel singleton
   * injects LINEAGE_REPOSITORY (ADR-210 §Context), so the request scope propagates
   * nowhere dangerous (ADR-197 invariant preserved).
   */
  requestScopedLineageRepository?: (tenantPackId: string) => LineageRepository;
```

- [ ] **Step 4: Bind it.** At the `LINEAGE_REPOSITORY` provider (~line 788), branch: if `options.requestScopedLineageRepository` is set, emit a request-scoped provider instead of the singleton one:
```ts
      options.requestScopedLineageRepository
        ? {
            provide: LINEAGE_REPOSITORY,
            scope: Scope.REQUEST,
            inject: [TENANT_PACK_CONTEXT],
            useFactory: (ctx: TenantPackContext): LineageRepository =>
              options.requestScopedLineageRepository!(ctx.tenantPackId),
          }
        : {
            provide: LINEAGE_REPOSITORY,
            useFactory: () => resolveLineage(options.lineageRepository), // existing path
          },
```
(Use the existing default-resolution helper for the singleton branch; import `Scope` from `@nestjs/common`, `TENANT_PACK_CONTEXT` + `TenantPackContext` from the context-guards module — both already imported or add them. If both options are set, throw a clear config error at forRoot.)

- [ ] **Step 5: Run → pass.** Same command → PASS. Then full unit suite `npx nx test substrate-runtime` → green (DB-gated skip without env).

- [ ] **Step 6: Build + commit.** `npx tsc -b libs/substrate-runtime` clean.
  `git commit -m "feat(composition-root): requestScopedLineageRepository forRoot option (ADR-210 Option A)"`

### Task A3a.2: Version bump + publish

- [ ] **Step 1:** `npm view @de-braighter/substrate-runtime version` (exact) → expect `0.20.0`. Set `libs/substrate-runtime/package.json` → `0.21.0` (additive minor). If `0.21.0` is taken (parallel session), pick next free by exact equality.
- [ ] **Step 2:** Full gate: `npx nx test substrate-runtime` green; `npx tsc -b libs/substrate-runtime` clean. Verifier wave (`reviewer` + `charter-checker` + `qa-engineer`) on the diff — charter-checker confirms ADR-210 Option A stays kernel-simple (additive binding, no new concept).
- [ ] **Step 3:** Commit the bump; open the substrate PR (body: `Producer: substrate-coder-pro/claude-opus-4-8 [subagent-driven-development]` + `Effect: cycle-time 0.01±0.02 expert` + `Effect: findings 2±2 expert`; Tech design: ADR-210). After merge: `cd libs/substrate-runtime && npm publish`; verify `npm view … version` == `0.21.0`. Twin ritual.

---

## Part A3b — Herdbook: request-scoped pack data + adopt the lineage binding

**Repo:** `domains/herdbook` (worktree off main). **Agent:** `implementer`. **Precondition:** `substrate-runtime@0.21.0` published.

**Context:** `apps/api/src/app/app.module.ts:52-95` calls `dbBackedAuthForRootOptions(appRoleClient, HERDBOOK_TENANT_PACK_ID)` + ~11 `*Providers(appRoleClient, HERDBOOK_TENANT_PACK_ID)`. Each `*Providers` builds singleton adapters over a singleton `GucPrismaRunner` and a SERVICE provider whose `useFactory` passes the constant `tenantPackId` to the service constructor; the service calls `adapter.method(this.tenantPackId, …)` and the adapter calls `runner.run(t, fn)`. A3b makes the SERVICE providers request-scoped so `this.tenantPackId` becomes the per-request value; adapters + runner are untouched (they already take `t` per call).

### Task A3b.1: Bump dep to 0.21.0

- [ ] In `apps/api/package.json` + `libs/herdbook-pack/package.json` set `@de-braighter/substrate-runtime` → `^0.21.0`; `pnpm install --ignore-scripts`. Verify `node -e "console.log(require('@de-braighter/substrate-runtime/package.json').version)"` → `0.21.0`. Commit `chore(deps): substrate-runtime ^0.21.0 (request-scoped lineage)`.

### Task A3b.2: Make the 12 pack service providers request-scoped

**Files:** the ~11 `*.wiring.ts` files (animal-registry, person-registry, pedigree, import, assessment, weighing, attribute, dashboard, photo, planned-mating — under `apps/api/src/app/`) + `apps/api/src/app/app.module.ts`.

**The transform (apply per wiring file, per SERVICE provider).** Today:
```ts
export function animalRegistryProviders(appRoleClient, tenantPackId: string): Provider[] {
  const runner = buildRunner(appRoleClient);
  const attrs = new PrismaAnimalAttrsAdapter(runner);      // singleton — keep
  return [{
    provide: ANIMAL_REGISTRY_SERVICE,
    inject: [LINEAGE_REPOSITORY, AuditService],
    useFactory: (lineage, audit) => new AnimalRegistryService(lineage, …, attrs, …, tenantPackId),
  }, …];
}
```
After:
```ts
import { Scope } from '@nestjs/common';
import { TENANT_PACK_CONTEXT, type TenantPackContext } from '@de-braighter/substrate-runtime';

export function animalRegistryProviders(appRoleClient): Provider[] {   // drop tenantPackId param
  const runner = buildRunner(appRoleClient);
  const attrs = new PrismaAnimalAttrsAdapter(runner);                  // still singleton
  return [{
    provide: ANIMAL_REGISTRY_SERVICE,
    scope: Scope.REQUEST,                                              // <-- per request
    inject: [LINEAGE_REPOSITORY, AuditService, TENANT_PACK_CONTEXT],   // <-- + context
    useFactory: (lineage, audit, ctx: TenantPackContext) =>
      new AnimalRegistryService(lineage, …, attrs, …, ctx.tenantPackId), // <-- per-request tpid
  }, …];
}
```
- [ ] **Step 1:** Apply the transform to EVERY service provider across all ~11 wiring files: add `scope: Scope.REQUEST`, add `TENANT_PACK_CONTEXT` to `inject`, replace the captured constant `tenantPackId` with `ctx.tenantPackId`. Adapters/runner constructed in the function body stay as-is (singletons). Drop the `tenantPackId` param from each wiring function signature.
- [ ] **Step 2:** In `app.module.ts`, drop the `HERDBOOK_TENANT_PACK_ID` argument from all ~11 `*Providers(appRoleClient)` calls.
- [ ] **Step 3:** `pnpm run typecheck` + `npx nx build api` → green (catches any provider that still references the dropped param). Commit `feat(app): request-scoped pack service providers (per-request tenant_pack_id)`.

### Task A3b.3: Bind the lineage repo request-scoped

**Files:** `apps/api/src/app/db-backed-auth-wiring.ts`, `app.module.ts`.

- [ ] **Step 1:** In `dbBackedAuthForRootOptions`, replace the constant lineage binding with the A3a request-scoped option (drop the `tenantPackId` param):
```ts
export function dbBackedAuthForRootOptions(appRoleClient: PrismaClient) {  // drop tenantPackId
  const runner = new GucPrismaRunner(appRoleClient);
  return {
    prismaClient: appRoleClient,
    tenantRegistry: new PrismaTenantRegistry(appRoleClient),
    packRoleAssignmentRepository: new PrismaPackRoleAssignmentRepository(runner),
    consentReceiptRepository: new PrismaConsentReceiptRepository(runner),
    requestScopedLineageRepository: (tpid: string) =>
      new PostgresLineageRepository(runner, tpid),   // per-request tpid (was the constant)
  };
}
```
(Remove the old `lineageRepository: new PostgresLineageRepository(runner, tenantPackId)`.)
- [ ] **Step 2:** In `app.module.ts`, change the call to `dbBackedAuthForRootOptions(appRoleClient)` (drop the constant). `HERDBOOK_TENANT_PACK_ID` now has NO runtime consumer — it stays in `tenants.ts` only for seeds/tests (note this in its comment).
- [ ] **Step 3:** `pnpm run typecheck` + `npx nx build api` → green. Commit `feat(app): request-scoped lineage repo (core.individual/lineage per request)`.

### Task A3b.4: Live-verify two-tenant isolation (the A2 test that must now pass)

- [ ] **Step 1:** Spin herdbook-postgres (:5433) if down; fresh `pnpm run db:setup`.
- [ ] **Step 2:** Provision a SECOND tenant (`provisionTenant` for a fresh tenantId + pack 'herdbook') + seed it a registrar grant under its derived tpid. Start the API with DB-auth env.
- [ ] **Step 3: The isolation proof.** Create one animal under tenant A's headers and one under tenant B's headers. Assert via `psql`:
  - `herdbook.animal`: A's animal has tenant_pack_id = A's tpid; B's has B's tpid (NOT both A's).
  - `core.individual`: same — each individual under its own tenant's tpid (the kernel-lineage fix).
  - `GET /animals` as tenant A returns ONLY A's animal; as tenant B returns ONLY B's. (A2 returned both — this is the regression-to-fix.)
- [ ] **Step 4:** `pnpm run test:db` → the existing suites stay green (pack + api). Confirm no spec regressed from the scope change. (Watch for any spec that constructed a service directly with a constant tpid — those bypass DI and are unaffected; the change is DI-wiring only.)
- [ ] **Step 5:** Commit any fix; document the live-verify outputs.

### Task A3b.5: PR + merge + twin ritual

- [ ] Push `feat/tenant-mgmt-sliceA3b-request-scoped-data`; open the herdbook PR (body: `Producer: implementer/claude-opus-4-8 [subagent-driven-development]` + `Effect: cycle-time 0.01±0.02 expert` + `Effect: findings 3±2 expert`; "Closes #31"; Tech design ADR-210). Verifier wave. Merge (verify state). Twin ritual (`drain`/`backfill de-braighter/herdbook`/`reconcile`).

---

## Done = (A3)

Two real tenants are RLS-isolated end-to-end across BOTH the pack data plane (`herdbook.*`) and the kernel lineage plane (`core.individual`/`core.lineage_edge`): an animal created under tenant B is invisible to tenant A and stored under B's `tenant_pack_id` everywhere. `substrate-runtime@0.21.0` ships the additive request-scoped lineage binding (ADR-210 Option A, kernel-simple — no new concept). herdbook#31 closed. **Slice A (persisted, isolated multi-tenancy) is truly complete** — the platform console (C) can now onboard a second real tenant whose data is genuinely isolated.

---

## Self-review (author)

- **Spec coverage:** ADR-210 Option A → A3a.1 (the request-scoped binding) + A3a.2 (publish). herdbook#31 (pack + lineage data plane per-request) → A3b.2 (pack services) + A3b.3 (lineage) + A3b.4 (the isolation proof). The umbrella Slice-A two-tenant live-verify → A3b.4.
- **Cascade safety:** confirmed (ADR-210 §Context) no kernel singleton injects LINEAGE_REPOSITORY; herdbook's request-scoped services are consumed only by already-request-scoped controllers — no new singleton→request promotion of a protected engine.
- **Type consistency:** `requestScopedLineageRepository: (tenantPackId: string) => LineageRepository` identical in A3a.1, A3a binding, and A3b.3; the herdbook service constructors keep their existing `tenantPackId: string` param (now fed `ctx.tenantPackId`); adapters' `run(t, fn)` unchanged.
- **Risk:** any wiring file with a non-service provider that captured the constant tpid (rare) — A3b.2 Step 3's build catches it. The `HERDBOOK_TENANT_PACK_ID` constant survives for seeds/tests only.
