# Foundry Cockpit Phase 2B — Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. **The design spec `docs/superpowers/specs/2026-06-30-foundry-cockpit-phase2-instances-design.md` is authoritative for all exact endpoint shapes, metadata keys, seed structure, and handler code — each task names its spec section.**

**Goal:** Make the cockpit's Execute loop actually run — let the founder instantiate charter trees from templates, persist them in the plan-tree store (with an in-memory fallback for keyless dev), and execute (claim/release/gate/decompose) on them. This closes the Phase-1 boundary (`/api/frontier` + `/api/action` go from empty to functional).

**Architecture:** An **instance = a fresh `generate()`d charter PlanTree** (identity = `treeRootId`), stamped `metadata.treeRole='execution'` + `metadata.instanceOf=<templateId>`, saved to the store. No new entity, no kernel change (ADR-176) — all linkage in `metadata` JSONB. Backend adds 4 endpoints + 2 seed templates + an `InMemoryPlanTreeStore` (keyless) + an `InstanceCatalogPort` (listing without widening `PlanTreeStore`). Frontend adds the Instances tab/page + a new-instance dialog + an instance picker, and scopes the Execute view to `:instanceId`.

**Tech Stack:** Express 5, `@de-braighter/charter-runtime` (`generate`/`compile`/`extract`/`charterFrontier`/`foldCharterLifecycleState`/`readCharter`), Prisma (keyed), Angular 21 (standalone, signals, OnPush), vitest.

## Global Constraints

- ZERO kernel change (ADR-176) — no `layers/substrate` touch; all instance/template linkage in `metadata` JSONB on the root node. `InstanceCatalogPort` is a foundry-side layer port, NOT a substrate-contract change.
- All charter-runtime calls already exist — NO charter-runtime change.
- Fail-soft everywhere: unknown template → 404; malformed seed → 422; store error → 500; Angular client catches → `[]`/`null`.
- Complete audit trail: every instantiation appends ≥1 `charter:NodeDecomposed.v1` to the `CharterEventLog` (do NOT route through `dispatchCharterAction('decompose-node')` — the tree already has children; append the event directly).
- One identity: `instanceId === treeRootId === root node id` (the `generate()` invariant).
- Cockpit endpoints: no auth (single-founder localhost), `tenantPackId` from `COCKPIT_TENANT_PACK_ID` (default `'foundry-default'`).
- Angular: standalone, OnPush, signal `input()`/`output()`; ESM `.js` extensions; pure adapters stay pure; WCAG 2.2 AA on interactive elements.
- Must not break Phase-1 / Phase-2A: the existing `/api/frontier`, `/api/action`, `/api/charter-status`, `/api/trees` endpoints are UNCHANGED in behavior (they already operate on any `treeRootId`).
- Every component change keeps `apps/cockpit` `npm run build` green (strictTemplates is the wiring gate); backend changes keep `npm run typecheck` + the dashboard suite green.
- All work in `domains/foundry` on branch `feat/cockpit-phase2b-instances`.

## Interim defaults (from spec §8 — proceed on these autonomously)
- D3: keyless dev uses `InMemoryPlanTreeStore` (ephemeral instances OK).
- OQ-2: `:treeId` is the forest/context tree → `contextTreeId` groups instances.
- OQ-3: single shared tenant (`foundry-default`) pre-Phase-3.
- OQ-4: no instance retirement endpoint in Phase 2B (defer).
- OQ-5: no auto-select — explicit pick with an empty-state prompt.

---

## File Map

**Backend (`domains/foundry/src/cockpit/`):**
- Create: `seed-templates.ts` — `SEED_TEMPLATES` + `resolveTemplate()` (B1) — spec §3
- Create: `in-memory-plan-tree.store.ts` — `InMemoryPlanTreeStore` (PlanTreeStore + InstanceCatalogPort) (B2) — spec §4.5, §6
- Create: `instance-catalog.ts` — `InstanceCatalogPort` interface + `PrismaInstanceCatalog` (B3) — spec §4.5
- Modify: `cockpit.router.ts` — `GET /api/templates`, `GET /api/instances`, `POST /api/instances`, `GET /api/instance/:instanceId`; `instanceCatalog` in `CockpitRouterDeps` (B4–B7) — spec §4
- Modify: `../dashboard/server.ts` — mode-appropriate store + catalog (replace null-stub) (B8) — spec §6/B8

**Frontend (`domains/foundry/apps/cockpit/src/app/`):**
- Modify: `shared/cockpit-types.ts` + `shared/foundry-cockpit.client.ts` — instance/template types + 4 methods (F1) — spec §5.5
- Modify: `shell/cockpit-shell.component.ts` — Instances pipeline tab (F2) — spec §5.1
- Create: `instances/instances.page.ts` — list table + empty state (F3) — spec §5.2
- Create: `instances/new-instance-dialog.component.ts` — template picker + create + navigate (F4) — spec §5.2
- Create: `execute/instance-picker/instance-picker.component.ts` — segmented instance bar (F5) — spec §5.3
- Modify: `execute/execute.page.ts` — scope to `:instanceId` + no-instance state (F6) — spec §5.4
- Modify: `app.routes.ts` — `tree/:treeId/instances` route (F3)

**Capstone:**
- Create: `src/cockpit/instances-e2e.spec.ts` — instantiate → frontier → claim → release → progress (C1) — spec §6 C1

---

## Backend

### Task B1: Seed templates module

**Files:** Create `src/cockpit/seed-templates.ts` + `src/cockpit/seed-templates.spec.ts`. Detail: **spec §3**.

**Interfaces:**
- Produces: `SEED_TEMPLATES: Record<string, CharterBlueprint>` (`seed:sdlc-mini` = product→[task Design, task Implement, gate Review, task Deploy]; `seed:decompose-demo` = a single childless `epic`); `resolveTemplate(templateId, deps): Promise<CharterBlueprint>` (handles `seed:*` directly, `draft:*` via `extract(planTreeStore.load(rootId), newId())`, throws a `TemplateNotFoundError` otherwise).
- Consumes: `CharterBlueprint`, `CharterContract`, `extract` from `@de-braighter/charter-runtime`.

- [ ] **Step 1: Write failing tests** — each seed `compile()`s clean (`compile(SEED_TEMPLATES['seed:sdlc-mini']).ok === true`); `generate(seed, {newId, tenantPackId})` yields a tree whose root `parentId === null` and a distinct `treeRootId` per call; child scopes satisfy `validateInheritance` (subset path prefixes — see spec §3.1). Run to verify fail.
- [ ] **Step 2: Implement** the two blueprints (valid `CharterContract` per node: `{ role, mission:{objective,outcome}, scope:{allowedPathPrefixes} }`, child prefixes ⊆ parent) + `resolveTemplate()`. Per spec §3.3.
- [ ] **Step 3: Run tests green; typecheck.** `cd domains/foundry && npm test -- seed-templates && npm run typecheck`
- [ ] **Step 4: Commit** — `feat(foundry): cockpit seed templates (sdlc-mini + decompose-demo) + resolveTemplate`

### Task B2: `InMemoryPlanTreeStore` (keyless fallback)

**Files:** Create `src/cockpit/in-memory-plan-tree.store.ts` + spec file. Detail: **spec §2.1, §4.5, §6/B2**.

**Interfaces:**
- Produces: `InMemoryPlanTreeStore` — a `Map<treeRootId, PlanTree>` implementing BOTH `PlanTreeStore` (`load`/`save`/`applyEdit`) AND `InstanceCatalogPort` (`listRoots(tenantPackId)` returns each saved tree's root `{treeRootId, metadata}`).
- Consumes: `PlanTree`, `PlanTreeStore`, `PlanTreeEdit` from `@de-braighter/substrate-contracts/plan-tree`; `InstanceCatalogPort` (Task B3).

- [ ] **Step 1: Write failing tests** — `save(tree)` then `load(tree.treeRootId)` returns the tree; `load(unknown)` → `null`; `listRoots(tenant)` returns the saved roots' `{treeRootId, metadata}`; `applyEdit` updates then returns the tree. Run to verify fail.
- [ ] **Step 2: Implement** the Map-backed store. `save` keys by `tree.treeRootId`; `listRoots` filters by the root node's `tenantPackId` if present (else returns all — keyless is single-tenant).
- [ ] **Step 3: Tests green; typecheck.** `npm test -- in-memory-plan-tree && npm run typecheck`
- [ ] **Step 4: Commit** — `feat(foundry): InMemoryPlanTreeStore keyless fallback (PlanTreeStore + InstanceCatalogPort)`

### Task B3: `InstanceCatalogPort` + `PrismaInstanceCatalog`

**Files:** Create `src/cockpit/instance-catalog.ts` + spec file. Detail: **spec §4.5**.

**Interfaces:**
- Produces: `interface InstanceCatalogPort { listRoots(tenantPackId: string): Promise<Array<{ treeRootId: string; metadata: Record<string, unknown> }>> }`; `PrismaInstanceCatalog implements InstanceCatalogPort` (wraps `prisma.planNode.findMany({ where: { tenantPackId, parentId: null, deletedAt: null }, select: { treeRootId: true, metadata: true } })`).
- Consumes: `PrismaClient`.

- [ ] **Step 1: Write a unit test** for `PrismaInstanceCatalog.listRoots` with a mock `PrismaClient` asserting the `findMany` where-clause (`parentId: null, deletedAt: null, tenantPackId`) and the mapped result shape. (DB-integration test optional — mirror `foundry-prisma-plan-tree.store` patterns if a testcontainer is wired; otherwise the mock-prisma unit test is the gate.) Run to verify fail.
- [ ] **Step 2: Implement** the interface + `PrismaInstanceCatalog`.
- [ ] **Step 3: Tests green; typecheck.**
- [ ] **Step 4: Commit** — `feat(foundry): InstanceCatalogPort + PrismaInstanceCatalog (keyed listing)`

### Task B4: `GET /api/templates`

**Files:** Modify `src/cockpit/cockpit.router.ts`. Detail: **spec §4.1**. Add `instanceCatalog?: InstanceCatalogPort` to `CockpitRouterDeps`.

**Interfaces:**
- Produces: `GET /api/templates` → `{ ok, templates: Array<{id, name, source:'seed'|'draft', nodeCount}> }`. Seeds always (from `SEED_TEMPLATES`, `nodeCount = blueprint.nodes.length`); draft rows only when `instanceCatalog` present (charter-bearing roots — those whose metadata indicates a charter, or simply non-execution roots; per spec §4.1 mirror the drafts query and post-filter in JS).

- [ ] **Step 1: Write a router test** (supertest-style or the existing dashboard acid harness) — keyless: returns the 2 seeds only; with a catalog stub returning a charter root: includes a `source:'draft'` row. Run to verify fail.
- [ ] **Step 2: Implement** the handler (asyncHandler, fail-soft).
- [ ] **Step 3: Tests green; typecheck.**
- [ ] **Step 4: Commit** — `feat(foundry): GET /api/templates (seeds + keyed draft rows)`

### Task B5: `GET /api/instances`

**Files:** Modify `cockpit.router.ts`. Detail: **spec §4.2**.

**Interfaces:**
- Produces: `GET /api/instances?contextTreeId=<id>` → `{ ok, instances: InstanceSummary[] }`. Logic: `instanceCatalog.listRoots(tenant)` → filter `metadata.treeRole === 'execution'` (+ optional `contextTreeId` match) → per tree `planTreeStore.load` (nodeCount) + `foldCharterLifecycleState(charterEventLog.read(treeRootId))` → `statusCounts` (reuse the exact `/api/charter-status` derivation) + `progress = done/nodeCount`. Fail-soft: an unreadable tree contributes zero counts, never a 500.

- [ ] **Step 1: Write a router test** — with a catalog + store + event log seeded with one `execution` root: returns 1 instance with correct `nodeCount`/`statusCounts`/`progress`; a non-execution root is excluded; `?contextTreeId` filters. Run to verify fail.
- [ ] **Step 2: Implement.** Extract the status-counts helper shared with `/api/charter-status` so the derivation isn't duplicated.
- [ ] **Step 3: Tests green; typecheck.**
- [ ] **Step 4: Commit** — `feat(foundry): GET /api/instances (list execution-role trees + status/progress)`

### Task B6: `POST /api/instances` — instantiate (the lights-up task)

**Files:** Modify `cockpit.router.ts`. Detail: **spec §4.3 (the full handler code is there — implement it verbatim)**.

**Interfaces:**
- Consumes: `resolveTemplate` (B1), `compile`/`generate`/`readCharter` (charter-runtime), `planTreeStore.save`, `charterEventLog.append`.
- Produces: `POST /api/instances` body `{ templateId, name?, contextTreeId? }` → resolve → `compile` (422 on fail) → `generate({newId: randomUUID, tenantPackId})` → stamp root `metadata` (`treeRole:'execution', instanceOf, instanceName, contextTreeId, instantiatedAt, title`) → `planTreeStore.save` → append one `charter:NodeDecomposed.v1` per node with children → `{ ok, instanceId, treeRootId, rootNodeId }` (all equal). Errors per spec §4.3 table (404 unknown template, 422 malformed, 500 store).

- [ ] **Step 1: Write the integration test (the acceptance gate)** — POST `{templateId:'seed:sdlc-mini'}` against a router wired with `InMemoryPlanTreeStore` + `InMemoryCharterEventLog` → returns an `instanceId`; THEN `GET /api/frontier/<instanceId>` returns ≥1 entry with `action:'claim'` (the claimable leaf tasks). Also: unknown templateId → 404. Run to verify fail.
- [ ] **Step 2: Implement** the §4.3 handler exactly (note the warnings: append `NodeDecomposed` directly, NOT via `dispatchCharterAction`; stamp only the root node's metadata; preserve `generate()`'s `treeRootId === root id`).
- [ ] **Step 3: Tests green; typecheck.**
- [ ] **Step 4: Commit** — `feat(foundry): POST /api/instances — instantiate template into the store (lights up frontier/action)`

### Task B7: `GET /api/instance/:instanceId`

**Files:** Modify `cockpit.router.ts`. Detail: **spec §4.4**.

**Interfaces:**
- Produces: `GET /api/instance/:instanceId` → `{ ok, treeRootId, nodes: PlanNode[] }` from `planTreeStore.load`; absent tree → `{ ok:true, treeRootId, nodes: [] }` (NOT 404 — board renders empty state).

- [ ] **Step 1: Write a router test** — instance present → nodes returned; absent → `{ok:true, nodes:[]}`. Run to verify fail.
- [ ] **Step 2: Implement.**
- [ ] **Step 3: Tests green; typecheck.**
- [ ] **Step 4: Commit** — `feat(foundry): GET /api/instance/:instanceId (load tree nodes for the board)`

### Task B8: Wire stores into `server.ts`

**Files:** Modify `src/dashboard/server.ts`. Detail: **spec §6/B8**. Replace the null-stub: keyless → `InMemoryPlanTreeStore` (used as BOTH `planTreeStore` and `instanceCatalog`); keyed → `FoundryPrismaPlanTreeStore` + `PrismaInstanceCatalog`. Pass `instanceCatalog` into `createCockpitRouter`. The Phase-2A `storeIsLive` flag: keyless is now a REAL (in-memory) store, so `storeIsLive` should reflect "a functional store exists" — set it `true` for the in-memory fallback too (the action loop now works), OR keep it `!!prisma` to mean "durable"; pick one and update the warn message to match (warn now means "ephemeral in-memory store — instances lost on restart", not "no-op").

**Interfaces:**
- Consumes: `InMemoryPlanTreeStore` (B2), `PrismaInstanceCatalog` (B3).
- Produces: cockpit router wired with a functional store + catalog in BOTH modes.

- [ ] **Step 1: Implement the wiring** — keyless branch constructs one `InMemoryPlanTreeStore` and passes it as `planTreeStore` + `instanceCatalog`; keyed branch passes the Prisma store + `new PrismaInstanceCatalog(prisma)`. Update the §2A warn to the ephemeral-store wording.
- [ ] **Step 2: Typecheck + full dashboard suite** — `npm run typecheck && npm test -- dashboard` (must stay green; the existing endpoints unchanged).
- [ ] **Step 3: Manual smoke (best-effort)** — start `npm run dashboard:serve` (background, keyless), `curl -s -X POST :4555/api/instances -H 'content-type: application/json' -d '{"templateId":"seed:sdlc-mini"}'` → expect `{ok:true,instanceId}`; then `curl :4555/api/frontier/<instanceId>` → ≥1 claimable entry; kill the server. If the server can't start in-sandbox, document the commands and rely on the B6 integration test.
- [ ] **Step 4: Commit** — `feat(foundry): wire in-memory/prisma plan-tree store + instance catalog into cockpit router`

---

## Frontend

### Task F1: Client + types

**Files:** Modify `apps/cockpit/src/app/shared/cockpit-types.ts` + `foundry-cockpit.client.ts`. Detail: **spec §5.5**.

**Interfaces:**
- Produces: types `TemplateSummary { id; name; source:'seed'|'draft'; nodeCount }`, `InstanceSummary { instanceId; treeRootId; name; instanceOf; contextTreeId; createdAt; nodeCount; statusCounts; progress }`; client methods `getTemplates()`, `getInstances(contextTreeId?)`, `createInstance({templateId,name?,contextTreeId?})`, `getInstanceTree(instanceId)` — all fail-soft (catch → `[]`/`null`).

- [ ] **Step 1: Add a "is defined" client spec.** **Step 2:** add types + methods. **Step 3:** `npm test -- foundry-cockpit && npm run build` (apps/cockpit). **Step 4:** commit — `feat(cockpit): instance/template client methods + types`

### Task F2: Shell Instances tab

**Files:** Modify `apps/cockpit/src/app/shell/cockpit-shell.component.ts`. Detail: **spec §5.1**.

**Interfaces:** add an `Instances` tab (`[routerLink]="['/tree', treeId(), 'instances']"`) before Execute; keep `aria-current` active pattern from Phase-2A; Draft/Deploy stay absent (Phase 3).

- [ ] **Step 1:** add the tab link. **Step 2:** `npm run build` + `npm test -- shell`. **Step 3:** commit — `feat(cockpit): shell Instances pipeline tab`

### Task F3: Instances page + route

**Files:** Create `apps/cockpit/src/app/instances/instances.page.ts` (+ spec); modify `app.routes.ts` (add `{ path: 'tree/:treeId/instances', loadComponent: ... InstancesPage }`). Detail: **spec §5.2**.

**Interfaces:** on init `client.getInstances(treeId)` → table rows (short id, template name, started, progress bar with `role=progressbar`, status chips reusing the project-card mapping); row click → `/tree/:treeId/execute/:instanceId`; "+ New instance" opens the F4 dialog; empty state with inline new-instance prompt. OnPush, signals, a11y (native buttons, progressbar aria).

- [ ] **Step 1:** "is defined" spec. **Step 2:** implement page + route. **Step 3:** `npm run build` (resolves the lazy route) + `npm test -- instances.page`. **Step 4:** commit — `feat(cockpit): Instances page (list + progress + empty state) + route`

### Task F4: New-instance dialog

**Files:** Create `apps/cockpit/src/app/instances/new-instance-dialog.component.ts` (+ spec). Detail: **spec §5.2**.

**Interfaces:** `templates = input.required<TemplateSummary[]>()` (or fetches via client); a template `<select>`/list + optional name field; `created = output<{ templateId; name }>()` / `cancelled = output<void>()`; the host (page/picker) calls `createInstance` and navigates on `{ok,instanceId}`. Reactive form or simple signal model; a11y: labelled controls, focus trap not required for Phase 2 (inline dialog), but the dialog must be keyboard-operable (native `<button>`/`<select>`, Escape → cancel).

- [ ] **Step 1:** "is defined" spec. **Step 2:** implement. **Step 3:** `npm run build` + `npm test -- new-instance`. **Step 4:** commit — `feat(cockpit): new-instance dialog (template picker + create)`

### Task F5: Instance picker bar

**Files:** Create `apps/cockpit/src/app/execute/instance-picker/instance-picker.component.ts` (+ spec). Detail: **spec §5.3**.

**Interfaces:** `instances = input.required<InstanceSummary[]>()`, `activeInstanceId = input<string|null>(null)`; `instanceSelected = output<string>()`, `newRequested = output<void>()`. A segmented control of native `<button>`s (`aria-pressed` for active) + a "+ New Instance" button. OnPush.

- [ ] **Step 1:** "is defined" spec. **Step 2:** implement. **Step 3:** `npm run build` + `npm test -- instance-picker`. **Step 4:** commit — `feat(cockpit): Execute instance-picker bar`

### Task F6: Execute scoping to `:instanceId`

**Files:** Modify `apps/cockpit/src/app/execute/execute.page.ts`. Detail: **spec §5.4** (the source-of-truth table).

**Interfaces:** read BOTH `:treeId` and `:instanceId` from the route. When `:instanceId` present: `liveStatus.start(instanceId)`, board nodes from `client.getInstanceTree(instanceId)`, frontier from `client.getFrontier(instanceId)`, actions POST `{ treeRootId: instanceId }`. Render the F5 picker bar above the three zones (populated by `client.getInstances(treeId)`); selecting an instance navigates to `…/execute/:instanceId`. When NO `:instanceId`: show the picker + "Pick or create an instance to execute" empty state (no auto-select — OQ-5). Keep the Phase-1 selection/statusMap wiring (`string|null`).

- [ ] **Step 1:** update the "is defined" spec if needed. **Step 2:** implement the scoping + picker integration. **Step 3:** `npm run build` (strictTemplates validates every binding) + `npm test -- execute.page`. **Step 4:** commit — `feat(cockpit): Execute view scoped to :instanceId + picker + no-instance state`

---

## Capstone

### Task C1: End-to-end loop test

**Files:** Create `src/cockpit/instances-e2e.spec.ts`. Detail: **spec §6 C1 + §9 acceptance**.

**Interfaces:** wire a router (or call the handlers) with `InMemoryPlanTreeStore` + `InMemoryCharterEventLog`. Assert the closed loop: POST instantiate `seed:sdlc-mini` → `GET /api/frontier/:instanceId` ≥1 claimable → `POST /api/action/:leafNodeId {treeRootId, action:'claim'}` → `{ok, events:[NodeClaimed.v1]}` → `GET /api/charter-status/:instanceId` shows that node `claimed` → release `done` → `GET /api/instances` `progress` advanced.

- [ ] **Step 1:** write the e2e test. **Step 2:** run it green (`npm test -- instances-e2e`). **Step 3:** commit — `test(foundry): instances end-to-end claim/release loop capstone`

---

## Self-Review

**Spec coverage:** B1 §3 · B2 §2.1/§4.5 · B3 §4.5 · B4 §4.1 · B5 §4.2 · B6 §4.3 · B7 §4.4 · B8 §6 · F1 §5.5 · F2 §5.1 · F3 §5.2 · F4 §5.2 · F5 §5.3 · F6 §5.4 · C1 §9. All spec sections mapped.

**Placeholder scan:** the plan delegates exact code to the spec sections (the spec carries the verbatim handler/seed code). Each task names its section + the TDD structure + interfaces. Implementers MUST read the named spec section for the exact code.

**Type consistency:** `InstanceCatalogPort` defined in B3, consumed by B2 (in-memory impl), B4/B5 (router), B8 (wiring). `InstanceSummary`/`TemplateSummary` defined in F1, consumed by F3/F4/F5/F6. `CockpitRouterDeps` extended once (add `instanceCatalog`) and consumed by B4–B8.

**Ordering:** B1→B8 before F1→F6 (frontend needs the endpoints live); B6 depends on B1+B2; B8 depends on B2+B3; F6 depends on F5. C1 after B-series.

**Lights-up gate:** B6's integration test + C1 are the explicit "the loop runs" assertions (spec §9 acceptance).
