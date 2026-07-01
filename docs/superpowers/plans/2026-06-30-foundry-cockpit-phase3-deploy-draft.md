# Foundry Cockpit Phase 3 — Deploy + Draft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **The design spec `docs/superpowers/specs/2026-06-30-foundry-cockpit-phase3-deploy-draft-design.md` is authoritative for all exact endpoint shapes, metadata keys, adapter code, and the validation/diff/clone logic — each task names its spec section.**

**Goal:** Complete the authoring pipeline inside the cockpit — Draft (author blueprints in a node-list editor) → Deploy (one-way-door versioned deployments) → Instantiate (from deployments) → Execute. All four pipeline tabs light up.

**Architecture:** A **blueprint is a draft plan tree** (`metadata.treeRole='blueprint'`) and a **deployment is a frozen versioned plan tree** (`metadata.treeRole='deployment'`) — both in the **Phase-2 `PlanTreeStore`** (Prisma keyed / `InMemoryPlanTreeStore` keyless). NO new store, NO new schema, ZERO kernel. The CRITICAL constraint: `extract`/`generate` round-trip through the strict `CharterContractSchema` which **strips `executionMode`/`scriptRef`/`title`** — so those are stored as **sibling `metadata` keys** and materialization uses a metadata-preserving `cloneTreeWithNewIds` helper (NOT `generate()`, which is reserved for seed templates only).

**Tech Stack:** Express 5, `@de-braighter/charter-runtime` (`extract`/`compile`/`generate`/`CharterRoleSchema`/`DECOMPOSABLE_ROLES`), Angular 21 (standalone, signals, OnPush), vitest.

## Global Constraints

- ZERO kernel change (ADR-176) — every new field (`treeRole`, `blueprintStatus`, `deployedFrom`, `deploymentVersion`, `deploymentStatus`, `sourceNodeId`, `executionMode`, `scriptRef`, `title`) is `metadata` JSONB. No `layers/substrate`, no `CharterContractSchema`, no charter-runtime impl change.
- NO new persistence: blueprints + deployments + instances share the Phase-2 `planTreeStore` + `instanceCatalog`. **NO `CockpitRouterDeps` change, NO `server.ts` change** (the store + catalog are already injected).
- **Authoring metadata is lossy through `CharterBlueprint`** (spec §1.3): store `executionMode`/`scriptRef`/`title` as SIBLING `metadata` keys; materialize deploys/instances with `cloneTreeWithNewIds` (preserves metadata); use `generate()` for SEED templates only; `extract`+`compile` for VALIDATION only.
- The one-way door is irreversible: deployments have no PUT/DELETE; corrections are new versions; only `deploymentStatus` flips active→superseded.
- Fail-soft: missing → 404; not-ready/non-compiling → 422; store error → 500; Angular client catches → `[]`/`null`.
- Cockpit endpoints: no auth (localhost single-founder), `tenantPackId` from `COCKPIT_TENANT_PACK_ID` (default `foundry-default`), `asyncHandler` for async routes.
- Existing endpoints (`/api/frontier`, `/api/action`, `/api/charter-status`, `/api/trees`, `/api/instances`, `/api/instance`, `/api/templates`) behave UNCHANGED except the documented additive changes (templates gains `deployment:*` rows; frontier `executionMode` read precedence).
- Angular: standalone, OnPush, signals; ESM `.js` extensions; pure adapters stay pure; WCAG 2.2 AA (native controls, focus-trap dialogs, keyboard-operable node editor — reorder via ▲▼ buttons, not drag).
- Backend keeps `npm run typecheck` + the dashboard/cockpit suites green; frontend keeps `apps/cockpit` `npm run build` green (strictTemplates).
- Interim defaults (spec §9 D1–D7, OQ-1…6) — proceed on these autonomously; none are kernel/business gates.
- All work in `domains/foundry` on branch `feat/cockpit-phase3-deploy-draft`.

---

## File Map

**Backend create:** `src/cockpit/blueprint-doc.ts` (B1), `src/cockpit/clone-tree.ts` (B2), `src/cockpit/deployment-diff.ts` (B3).
**Backend modify:** `src/cockpit/cockpit.router.ts` (B4–B10 endpoints + executionMode fix + instances branch + templates rows), `src/cockpit/seed-templates.ts` (`resolveTemplate` gains `deployment:`).
**Frontend create:** `apps/cockpit/src/app/draft/draft.page.ts` (+ node-editor child + preview-board modal), `apps/cockpit/src/app/deploy/deploy.page.ts` (+ deploy-new-version dialog).
**Frontend modify:** `apps/cockpit/src/app/app.routes.ts` (draft/deploy routes, drop StubPage), `shell/cockpit-shell.component.ts` (Draft+Deploy tabs), `shared/foundry-cockpit.client.ts` + `shared/cockpit-types.ts`.

---

## Backend

### Task B1: `blueprint-doc.ts` — editor model + adapters + validation (spec §3.2)
Create `src/cockpit/blueprint-doc.ts` (+ spec). Pure module.
- **Produces:** `BlueprintDoc`/`BlueprintNodeDoc`/`CharterRole`/`ExecutionMode` types; `docToTree(doc, tenantPackId): PlanTree` (stamps `treeRole='blueprint'`, writes `metadata = { title, charter:{role,mission,scope}, executionMode, scriptRef?, _dependsOn }` per node + root `systemName`/`blueprintStatus`/`updatedAt`; `childrenIds` from `parentId` sorted by `ordinal`); `treeToDoc(tree): BlueprintDoc` (inverse); `validateBlueprint(doc): { status:'ready'|'draft'; reasons:string[] }` (the §3.2 ready rule: ≥1 node + exactly one root; every node non-empty kind+title; no deterministic node with empty scriptRef; every mission.objective/outcome non-empty).
- [ ] TDD: `docToTree∘treeToDoc` identity on a valid doc; `validateBlueprint` flags empty title / empty deterministic scriptRef / multi-root / blank mission → impl → `npm test -- blueprint-doc` + typecheck → commit `feat(foundry): blueprint-doc adapters (docToTree/treeToDoc/validateBlueprint)`.

### Task B2: `clone-tree.ts` — metadata-preserving materializer (spec §3.3)
Create `src/cockpit/clone-tree.ts` (+ spec). Pure.
- **Produces:** `cloneTreeWithNewIds(source, {newId, tenantPackId}): { tree: PlanTree; idMap: Map<string,string> }` — remaps every id/parentId/childrenIds/treeRootId/_dependsOn to fresh UUIDs, copies ALL node metadata verbatim. Returns `idMap` (sourceId→freshId).
- [ ] TDD: clone has disjoint ids, identical structure, per-node metadata byte-identical except ids, `_dependsOn` remapped → impl → `npm test -- clone-tree` + typecheck → commit `feat(foundry): cloneTreeWithNewIds metadata-preserving materializer`.

### Task B3: `deployment-diff.ts` — node-diff (spec §5.2)
Create `src/cockpit/deployment-diff.ts` (+ spec). Pure.
- **Produces:** `computeNodeDiff(candidateBlueprintTree, previousDeploymentTree | null): NodeDiff` — correlates candidate node ids ↔ previous deployment `metadata.sourceNodeId`; added/removed/changed (compares title, kind, executionMode, scriptRef, mission.objective/outcome, scope.allowedPathPrefixes; `fields[]` names changes); `previous===null` → all added.
- [ ] TDD: added/removed/changed by sourceNodeId; null previous → all added; precise `fields[]` → impl → `npm test -- deployment-diff` + typecheck → commit `feat(foundry): computeNodeDiff for deployment versioning`.

### Task B4: `GET /api/kinds` (spec §4.1)
Modify `cockpit.router.ts`. Curated `CharterRole` list: `CharterRoleSchema.options.map(k => ({ kind:k, decomposable: DECOMPOSABLE_ROLES.has(k), advances: DECOMPOSABLE_ROLES.has(k)?'decompose':'claim' }))`. NOT a generation-layer call.
- [ ] Test: returns the 7 roles with correct decomposable/advances → impl → `npm test -- cockpit.router` + typecheck → commit `feat(foundry): GET /api/kinds (curated charter roles)`.

### Task B5: `GET /api/blueprints` + `GET /api/blueprints/:id` (spec §4.2)
Modify `cockpit.router.ts`. List: `instanceCatalog.listRoots` filter `treeRole==='blueprint'` → `{id,name:systemName,status:blueprintStatus,nodeCount,updatedAt}` (fail-soft nodeCount via load). Load: `planTreeStore.load(id)`; missing or root `treeRole!=='blueprint'` → 404; else `treeToDoc(tree)`.
- [ ] Test: list filters to blueprints; load returns doc; absent/wrong-role → 404 → impl → typecheck → commit `feat(foundry): GET /api/blueprints (+ :id)`.

### Task B6: `POST /api/blueprints` + `PUT /api/blueprints/:id` (spec §4.3)
Modify `cockpit.router.ts`. POST: assign `treeRootId=randomUUID()`, UUID any missing node ids; PUT: keep `:id`. Both: `validateBlueprint` (server-authoritative status; ignore request status) → `docToTree` → `planTreeStore.save` → return canonical doc. Malformed → 400; save error → 500.
- [ ] Integration test: POST → GET round-trips; PUT preserves treeRootId + node ids; status reflects validation → impl → typecheck → commit `feat(foundry): POST/PUT /api/blueprints (validate + persist)`.

### Task B7: `POST /api/deployments/preview` — dry-run diff (spec §4.4)
Modify `cockpit.router.ts`. Load blueprint → `validateBlueprint(treeToDoc)`; not ready → `{ok:true,ready:false,reasons}`. Else `extract→compile` (errors → ready:false). Compute `nextVersion` + `computeNodeDiff` vs current active deployment for `(deployedFrom===blueprintId, contextTreeId)`. No write.
- [ ] Test: first preview → all-added, nextVersion:1; second (after a deploy) → diff vs v1 → impl → typecheck → commit `feat(foundry): POST /api/deployments/preview (node-diff dry run)`.

### Task B8: `POST /api/deployments` — the one-way door (spec §4.5)
Modify `cockpit.router.ts`. Implement the §4.5 handler verbatim: load+gate ready (422 if not) → `extract`+`compile` (422 if not) → `cloneTreeWithNewIds` (NOT generate) → compute nextVersion → stamp deployment root metadata + `sourceNodeId` on every node (from idMap) → supersede prior active (metadata flip via re-save) → `planTreeStore.save` → `{ok,deploymentId,version,nodeCount}`. NO CharterEvent. 404/422/500 per spec.
- [ ] Integration test: deploy ready blueprint → `GET /api/deployments` v1 active; re-deploy → v2 active + v1 superseded; deployed node preserves executionMode/scriptRef → impl → typecheck → commit `feat(foundry): POST /api/deployments one-way door (versioned immutable deploy)`.

### Task B9: Instantiate-from-deployment + templates rows (spec §3.4, §4.6)
Modify `seed-templates.ts` (`resolveTemplate` gains `deployment:` → `planTreeStore.load(deploymentId)`) + `cockpit.router.ts` (`POST /api/instances` branches: `seed:` → generate; `draft:`/`deployment:` → `cloneTreeWithNewIds`; then existing stamp `treeRole='execution'`+`instanceOf`(+`deployedFrom`)→save→NodeDecomposed). `GET /api/templates` appends active `deployment:*` rows (`{id:'deployment:<id>',name:'<systemName> v<n>',source:'deployment',nodeCount}`).
- [ ] Integration test: deploy → `POST /api/instances {templateId:'deployment:<id>'}` → `GET /api/frontier/<instanceId>` non-empty; instance root `instanceOf:'deployment:<id>'`; deterministic node keeps `scriptRef` → impl → typecheck → commit `feat(foundry): instantiate from deployment (clone path preserves authoring metadata) + templates deployment rows`.

### Task B10: frontier `executionMode` read fix (spec §1.3, §4.6)
Modify `cockpit.router.ts` (the frontier enrich, ~line 282): read `(meta['executionMode'] as string) ?? charter?.['executionMode'] ?? 'ai'`. Confirm new routes registered. (Small — may already be touched by B5/B9; ensure present.)
- [ ] Test: a node with `metadata.executionMode='human'` surfaces `'human'` on the frontier → impl → typecheck → commit `fix(foundry): frontier reads metadata.executionMode (sibling key) first`.

---

## Frontend

### Task F1: Client + types (spec §6.5)
Modify `shared/cockpit-types.ts` + `foundry-cockpit.client.ts`. Types: `KindInfo`, `BlueprintSummary`, `BlueprintDoc`, `BlueprintNodeDoc`, `DeploymentSummary`, `DeployPreview`, `NodeDiff`. Methods (fail-soft): `getKinds`, `getBlueprints`, `getBlueprint(id)`, `saveBlueprint(doc)` (POST if no treeRootId else PUT), `getDeployments(treeId?)`, `previewDeployment(req)`, `deploy(req)`.
- [ ] "is defined" spec → impl → `npm test -- foundry-cockpit` + `npm run build` → commit `feat(cockpit): blueprint/deployment client methods + types`.

### Task F2: Shell tabs + routes (spec §6.1)
Modify `shell/cockpit-shell.component.ts` (add Draft + Deploy tabs before Instances → `[ Draft ][ Deploy ][ Instances ][ Execute ]`, keep aria-current pattern) + `app.routes.ts` (add `tree/:treeId/draft`, `tree/new/draft`, `tree/:treeId/deploy` lazy routes; **drop StubPage**).
- [ ] Build resolves the new lazy routes → `npm run build` + `npm test -- shell` → commit `feat(cockpit): Draft + Deploy pipeline tabs + routes (all four tabs live)`.

### Task F3: Draft list panel (spec §6.2 left)
Create `apps/cockpit/src/app/draft/draft.page.ts` (the page shell + left list). `getBlueprints()` → cards (name, status badge draft/ready, nodeCount, updatedAt); "+ New Blueprint" → new empty doc (one `product` root) selected; select → `getBlueprint(id)` into editor signal; "Deploy →" (enabled iff status==='ready') → navigate `/tree/:treeId/deploy?blueprintId=`. OnPush, signals, a11y (native buttons).
- [ ] "is defined" spec → impl → `npm run build` + `npm test -- draft` → commit `feat(cockpit): Draft page + blueprint list panel`.

### Task F4: Node-list editor (spec §6.2 right) — the complex one
Create the node-editor child component (under `apps/cockpit/src/app/draft/`). Indented list (depth from parentId); per node: `kind` `<select>` (from `getKinds()`), `title` `<input>`, `executionMode` `<select>`, `scriptRef` `<input>` shown only when deterministic, collapsible contract (`mission.objective`/`mission.outcome` `<textarea>`, `scope.allowedPathPrefixes` `<input>` comma-split); row controls **+ Add child / Delete / ▲ ▼** (keyboard buttons, no drag); live `validateBlueprint` banner (client-side) with per-node reasons; **Save** → `saveBlueprint(doc)` → reflect server status. WCAG 2.2 AA: labelled controls, keyboard-operable reorder.
- [ ] "is defined" + a focused validation-banner spec → impl → `npm run build` + `npm test -- node-editor` → commit `feat(cockpit): blueprint node-list editor (kind/mode/scriptRef/contract, reorder, live validation)`.

### Task F5: "Preview in Board" modal (spec §6.2)
Add a read-only board-preview modal to the Draft page: `planTreeToRecipe(docToBoardNodes(doc))` rendered in `CockpitBoardComponent` (reuse Phase-1 board; no live status). Focus-trap + Esc-close.
- [ ] "is defined" spec → impl → `npm run build` + `npm test -- draft` → commit `feat(cockpit): Draft "Preview in Board" read-only modal`.

### Task F6: Deploy page (spec §6.3)
Create `apps/cockpit/src/app/deploy/deploy.page.ts`. `getDeployments(treeId)` → table (Version, Deployed, Nodes, Status active/superseded, version-desc). "Create Instance →" per row → navigate `/tree/:treeId/instances` (deployment pre-listed via templates rows). OnPush, a11y (progress/table semantics).
- [ ] "is defined" spec → impl → `npm run build` + `npm test -- deploy` → commit `feat(cockpit): Deploy page + deployment table`.

### Task F7: Deploy New Version flow (spec §6.3)
Add the "Deploy New Version" dialog to the Deploy page: blueprint picker (`getBlueprints()` filtered status==='ready', pre-select from `?blueprintId`) → `previewDeployment` node-diff (added green / removed red / changed amber+fields, nextVersion, one-way-door warning; Confirm disabled if ready:false) → Confirm → `deploy(req)` → refresh table. Focus-trap + Esc; irreversibility copy.
- [ ] "is defined" + a focused diff-render spec → impl → `npm run build` + `npm test -- deploy` → commit `feat(cockpit): Deploy New Version flow (picker → node-diff → one-way door)`.

---

## Capstone

### Task C1: Full-pipeline e2e (spec §10 acceptance)
Create `src/cockpit/deploy-pipeline-e2e.spec.ts`. Wire a router with `InMemoryPlanTreeStore` + `InMemoryCharterEventLog`. Assert: POST blueprint (product root + 1 deterministic task w/ scriptRef) → status ready → `POST /api/deployments` v1 active → re-deploy v2 active + v1 superseded + preview `changed[]` precise → `POST /api/instances {templateId:'deployment:<id>'}` → frontier non-empty → the instance's deterministic node still carries `executionMode:'deterministic'` + `scriptRef`. Closes Draft→Deploy→Instantiate→Execute.
- [ ] Write + green → `npm test -- deploy-pipeline-e2e` → commit `test(foundry): full Draft->Deploy->Instantiate->Execute e2e capstone`.

---

## Execution batches
- **Batch A (backend pure):** B1, B2, B3 — independent pure modules → review.
- **Batch B (backend endpoints):** B4–B10 — cockpit.router + seed-templates → review (the one-way door + instantiate branch are the critical pieces).
- **Batch C (frontend):** F1–F7 → review (F4 node editor is the complex one).
- **Capstone:** C1 (can fold into Batch B review or run after).
- Then final whole-branch review → merge → ritual.

## Self-Review
**Spec coverage:** B1 §3.2 · B2 §3.3 · B3 §5.2 · B4 §4.1 · B5 §4.2 · B6 §4.3 · B7 §4.4 · B8 §4.5 · B9 §3.4/§4.6 · B10 §1.3/§4.6 · F1 §6.5 · F2 §6.1 · F3 §6.2 · F4 §6.2 · F5 §6.2 · F6 §6.3 · F7 §6.3 · C1 §10. All mapped.
**Type consistency:** `BlueprintDoc`/`BlueprintNodeDoc` (B1) consumed by B5/B6/F1/F3/F4; `cloneTreeWithNewIds` (B2) by B8/B9; `computeNodeDiff`/`NodeDiff` (B3) by B7/F7; no `CockpitRouterDeps`/`server.ts` change (reuse Phase-2 store+catalog).
**Critical invariant:** materialization via `cloneTreeWithNewIds` not `generate()` (preserves executionMode/scriptRef) — B8 + B9; `generate()` stays for seeds only.
