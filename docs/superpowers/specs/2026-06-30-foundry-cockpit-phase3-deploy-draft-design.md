---
title: "Foundry Cockpit Phase 3 — Deploy + Draft — Design Spec"
date: 2026-06-30
status: draft
authors: [designer]
adr: reserved
tags: [cockpit, foundry, blueprint, deploy, draft, charter, plan-tree, generate, zero-kernel]
supersedes-section: "2026-06-30-foundry-cockpit-design.md §5 (Draft Tab) + §6 (Deploy Tab) sketches; §10 Phase-3 'needs S4 durable BlueprintStore' prerequisite"
relates-to:
  - 2026-06-30-foundry-cockpit-design.md
  - 2026-06-30-foundry-cockpit-phase2-instances-design.md
  - 2026-06-30-hydra-factory-vision.md
---

# Foundry Cockpit Phase 3 — Deploy + Draft — Design Spec

This spec resolves the **Draft** and **Deploy** phases of the Foundry Cockpit into
something buildable on **what exists today**. It replaces the §5 / §6 sketches of
`2026-06-30-foundry-cockpit-design.md` and, critically, **dissolves the stated
prerequisite** ("Phase 3 needs S4 durable `BlueprintStore`"). There is no durable
`BlueprintStore`, only charter-runtime's keyless `InMemoryBlueprintStore`. This
spec shows the durable store is **not needed**: a blueprint is a plan tree, so it
persists in the `PlanTreeStore` that Phase 2 already wired (Prisma keyed /
in-memory keyless) — ZERO new schema, ZERO kernel, ZERO new charter-runtime impl.

**Context to read first:**
- `2026-06-30-foundry-cockpit-design.md` — §2 routes, §5 Draft Tab, §6 Deploy Tab, §9 `executionMode`, §10 Phasing.
- `2026-06-30-foundry-cockpit-phase2-instances-design.md` — what Phase 2 shipped: instances = `generate()`d trees stamped `metadata.treeRole='execution'`; `InMemoryPlanTreeStore` (keyless, implements `PlanTreeStore` **and** `InstanceCatalogPort`); `resolveTemplate` with `seed:*` + `draft:*`; the §4.3 forward path: "`instanceOf` simply starts pointing at a `deploymentId` instead of a `seed:` id."
- `2026-06-30-hydra-factory-vision.md` — the four verbs (Draft → Deploy → Instantiate → Execute); `treeRole` / `executionMode` conventions.

**One-line orientation.** Three of the four verbs already share one substrate — the
`PlanTreeStore`. Phase 2 put `treeRole='execution'` trees in it. Phase 3 puts two
more `treeRole`s in the *same* store — `'blueprint'` (Draft) and `'deployment'`
(Deploy) — and bridges them with the charter-runtime functions that already exist
(`extract` / `compile` / `generate`) plus one small metadata-preserving clone helper.

---

## 1. The Core Resolution — Where Blueprints and Deployments Live

### 1.1 One-sentence definitions

> **A blueprint is a draft plan tree** in the `PlanTreeStore`, stamped
> `metadata.treeRole = 'blueprint'` on its root node; its identity *is* its
> `treeRootId`; `/api/blueprints` CRUD maps directly onto plan-tree persistence,
> with the editor wire model (`BlueprintDoc`) ↔ `PlanTree` bridged by two pure
> adapters (`docToTree` / `treeToDoc`).

> **A deployment is a frozen, versioned, immutable plan tree** in the *same*
> `PlanTreeStore`, stamped `metadata.treeRole = 'deployment'` +
> `metadata.deploymentVersion` + `metadata.deployedFrom = <blueprintTreeRootId>` on
> its root; it is produced by the one-way door (validate → clone-with-fresh-UUIDs →
> stamp → supersede prior) and is **never executed directly** — instances are
> generated *from* it (the `deployment:*` template source).

There is no `blueprint` table, no `deployment` table, no separate `BlueprintStore`
wiring. Blueprints, deployments, and instances are **the same kind of row**
(`kernel.plan_node` roots) distinguished only by `metadata.treeRole`. This is the
Phase-2 model extended by two more roles — the fleet from hydra-vision §4, all in
one store.

| `treeRole` (on root node) | Verb | Mutable? | Executed? | Phase |
|---|---|---|---|---|
| `blueprint` | Draft | yes (edit freely) | no | **3 (new)** |
| `deployment` | Deploy | content frozen; only `deploymentStatus` flips | no (it is a template) | **3 (new)** |
| `execution` | Instantiate / Execute | yes (lifecycle events) | yes | 2 (shipped) |

### 1.2 Why "blueprint = plan tree" and not a separate `BlueprintStore`

| Option | What it is | Verdict |
|---|---|---|
| **A — Blueprint = a draft plan tree in `PlanTreeStore` (chosen)** | Persist via the *already-wired* store (Prisma keyed / `InMemoryPlanTreeStore` keyless). `extract()` bridges tree → `CharterBlueprint` for validation; the editor model bridges via two pure functions. | **Chosen.** Zero new schema, zero new store wiring, zero kernel. Reuses the exact persistence + listing (`InstanceCatalogPort.listRoots`) Phase 2 already built. The `draft:*` template path **already** reads blueprints this way. |
| B — Build a durable Prisma `BlueprintStore` (new `blueprint` table) implementing the charter-runtime port | A second persistence substrate alongside `PlanTreeStore`, storing `CharterBlueprint` JSON rows. | Rejected. Duplicates plan-tree persistence; needs a migration + a keyless `InMemoryBlueprintStore` *and* a keyed Prisma one (two stores, two catalogs); and `CharterBlueprint` is **lossy** (strips `executionMode`/`scriptRef`/`title` — §1.3), so it would be a *worse* store than the tree it came from. |
| C — Keep blueprints purely in `InMemoryBlueprintStore` (charter-runtime's existing impl) | The only impl that exists; ephemeral; no Prisma. | Rejected as the *primary* model: ephemeral-only kills durable authoring in keyed mode, and it forks the listing path (it has no `listRoots`). Option A gives ephemeral-keyless **and** durable-keyed from one store. |

Option A is the only model that (a) requires no new persistence, (b) reuses the
Phase-2 keyless fallback verbatim, and (c) keeps the deploy pipeline lossless. The
charter-runtime `BlueprintStore` port + `InMemoryBlueprintStore` are **not deleted**
— they remain a valid runtime abstraction — but Phase 3 does **not** persist through
them. Persistence is plan-tree-shaped; `CharterBlueprint` is used only as the
**transient validation/generation form** inside the deploy handler.

### 1.3 The one non-obvious bridge — authoring metadata is lossy through `CharterBlueprint`

`extract()` emits `CharterBlueprintNode = { id, parentId, role, contract, ordinal, dependsOn, label }`.
`generate()` emits `PlanNode` with `metadata = { _dependsOn, charter }`. **Neither
carries `executionMode`, `scriptRef`, or a free `title`** — and `readCharter()`
parses through the strict `CharterContractSchema` (`role`/`mission`/`scope` only),
which **silently strips** any extra key. Verified live: `cockpit.router.ts:282`
reads `charter?.executionMode`, which is *always* `undefined` on a generated tree,
so the frontier already defaults every node to `'ai'`. The §9 storage location
`metadata.charter.executionMode` is therefore **aspirational** — it cannot survive a
single `extract`/`generate` hop.

**Resolution (two parts):**

1. **Store authoring fields as sibling metadata keys, not inside `charter`:**
   `metadata.executionMode`, `metadata.scriptRef`, `metadata.title` live *next to*
   `metadata.charter`, exactly as `metadata.treeRole` / `metadata.instanceOf` do.
   ZERO charter-runtime change. (This supersedes cockpit-design §9's
   `metadata.charter.executionMode`; when a future Phase-4 charter-runtime spec
   formalizes `executionMode` *into* `CharterContractSchema`, the storage location
   migrates — out of scope here.)
2. **Materialize deployments/instances by a metadata-preserving clone, not by
   `generate()`:** introduce one foundry-side pure helper
   `cloneTreeWithNewIds(tree, { newId, tenantPackId })` (§3.3) — the metadata-faithful
   analogue of `generate()`. It remaps every `id`/`parentId`/`childrenIds`/`_dependsOn`/
   `treeRootId` to fresh UUIDs while copying **all** node metadata verbatim. `extract`
   + `compile` are retained for **validation** (the one-way-door gate); `generate()`
   is retained for **seed templates only** (`CharterBlueprint` constants, which carry
   no authoring metadata to lose).

So the frontier/board must read `metadata.executionMode` first, falling back to
`metadata.charter.executionMode`, then `'ai'` (one-line change, §4.6).

---

## 2. Reconciliation with Phase 2 (what changes, what does not)

| Surface | Phase 2 state | Phase 3 change |
|---|---|---|
| `PlanTreeStore` (Prisma / in-memory) | holds `execution` roots | **unchanged store**; now also holds `blueprint` + `deployment` roots |
| `InstanceCatalogPort.listRoots` | lists roots for `/api/instances` + draft `/api/templates` | **reused as-is** — `/api/blueprints` and `/api/deployments` filter the same `listRoots` by `treeRole` |
| `resolveTemplate(templateId)` | `seed:*` → const; `draft:*` → `extract(load(rootId))` | **add `deployment:*`** (resolves to the deployment tree for cloning, §3.4); `draft:*` rerouted to the clone path so authoring metadata survives (§3.4) |
| `POST /api/instances` | `generate(blueprint)` for all sources | **branch**: tree-sourced (`deployment:`/`draft:`) → `cloneTreeWithNewIds`; `seed:` → `generate()` (unchanged) |
| `GET /api/templates` | seeds + draft rows | **add `deployment:*` rows** (`source:'deployment'`) so the existing New-Instance dialog lists deployments — no dialog change (honours design §4.3 forward path) |
| `metadata.instanceOf` | `seed:*` / `draft:*` | may now be `deployment:<id>` — the §4.3 promise, realized |
| frontier `executionMode` read | `charter?.executionMode ?? 'ai'` (always `'ai'`) | read `metadata.executionMode ?? charter?.executionMode ?? 'ai'` (§4.6) |
| Shell tabs | Instances + Execute live; Draft/Deploy ghost | **all four live** |

No Phase-2 endpoint is removed. The `frontier` / `action` / `charter-status` loop is
untouched (it operates on `execution` trees exactly as before).

---

## 3. The Model — Adapters, Helpers, Metadata Keys

### 3.1 Metadata keys (exhaustive — all `metadata` JSONB, ZERO kernel)

**Blueprint root node:**

| key | value | purpose |
|---|---|---|
| `treeRole` | `'blueprint'` | marks this root as an editable blueprint |
| `systemName` | string | display name (mirrors the drafts convention) |
| `blueprintStatus` | `'draft'` \| `'ready'` | server-derived validation status (§3.2) |
| `updatedAt` | ISO timestamp | sort / "last modified" |

**Blueprint *and* deployment node (every node):**

| key | value | purpose |
|---|---|---|
| `title` | string | node display label (free text, distinct from `mission.objective`) |
| `charter` | `CharterContract` | `{ role, mission, scope }` (the strict contract) |
| `executionMode` | `'deterministic'` \| `'ai'` \| `'human'` \| `'hybrid'` | authored mode (sibling key, §1.3) |
| `scriptRef` | string (optional) | present when `executionMode === 'deterministic'` |
| `_dependsOn` | `string[]` | dependency edges (the existing convention `generate()` writes) |

**Deployment root node (adds to the node keys above):**

| key | value | purpose |
|---|---|---|
| `treeRole` | `'deployment'` | marks this root as a frozen deployment |
| `deployedFrom` | `<blueprintTreeRootId>` | lineage pointer to the source blueprint |
| `deploymentVersion` | integer (1, 2, 3, …) | monotonic per `(deployedFrom, contextTreeId)` lineage |
| `deploymentStatus` | `'active'` \| `'superseded'` | only this flips after creation (§5.3) |
| `contextTreeId` | string \| null | the forest tree this deployment belongs to (the `:treeId` route param) |
| `deployedAt` | ISO timestamp | audit / sort |
| `systemName` | string | carried from the blueprint |

**Deployment node (adds to the node keys above):**

| key | value | purpose |
|---|---|---|
| `sourceNodeId` | `<blueprintNodeId>` | stable correlation key for the cross-version node-diff (§5.2) |

**Execution (instance) root** — Phase-2 keys unchanged; `instanceOf` may now be
`deployment:<id>`, and `deployedFrom` (optional) records the deployment lineage.

### 3.2 `BlueprintDoc` — the editor wire model + `docToTree` / `treeToDoc` / `validateBlueprint`

New pure module `src/cockpit/blueprint-doc.ts`. The wire model is editor-shaped
(a flat node list); the persistence is plan-tree-shaped. Two pure adapters bridge.

```typescript
export type CharterRole = 'product' | 'task' | 'epic' | 'gate' | 'review' | 'adr' | 'experiment';
export type ExecutionMode = 'deterministic' | 'ai' | 'human' | 'hybrid';

export interface BlueprintNodeDoc {
  id: string;                 // stable node id (client-provided UUID; preserved across PUTs)
  parentId: string | null;    // null = root
  kind: CharterRole;          // becomes PlanNode.kind + kindRef 'charter:<kind>'
  title: string;
  executionMode: ExecutionMode;
  scriptRef?: string;
  mission: { objective: string; outcome: string };
  scope: { allowedPathPrefixes: string[] };
  dependsOn: string[];        // ids of sibling/earlier nodes
  ordinal: number;
}

export interface BlueprintDoc {
  treeRootId: string;         // === root node id === blueprint identity
  name: string;
  status: 'draft' | 'ready';  // SERVER-derived (validateBlueprint); request value ignored
  nodes: BlueprintNodeDoc[];
  updatedAt: string;
}

/** Pure. doc → PlanTree (stamps treeRole='blueprint', writes charter + sibling metadata). */
export function docToTree(doc: BlueprintDoc, tenantPackId: string): PlanTree;

/** Pure. PlanTree (treeRole='blueprint') → doc (reverse of docToTree). */
export function treeToDoc(tree: PlanTree): BlueprintDoc;

/** Pure. The §5.2 'ready' rule, plus structural sanity. Returns 'ready' | 'draft' + reasons. */
export function validateBlueprint(doc: BlueprintDoc):
  { status: 'ready' | 'draft'; reasons: string[] };
```

**`validateBlueprint` — the `ready` rule (design §5.2, made precise):** status is
`'ready'` iff **all** of:
- ≥1 node and **exactly one** root (`parentId === null`);
- every node has a non-empty `kind` (a valid `CharterRole`) **and** a non-empty `title`;
- no node with `executionMode === 'deterministic'` has an empty/absent `scriptRef`;
- every `mission.objective` and `mission.outcome` is non-empty (required by
  `CharterContractSchema` — a blank one makes the tree un-`extract`able at deploy).

Otherwise `'draft'`, with `reasons[]` naming each failing node (for inline UI hints).
`docToTree` writes `blueprintStatus = validateBlueprint(doc).status` onto the root so
the list view can show status without re-validating.

`docToTree` per node: `kind = doc.kind`, `kindRef = 'charter:' + doc.kind`,
`metadata = { title, charter: { role: kind, mission, scope }, executionMode, scriptRef?, _dependsOn: dependsOn }`;
`childrenIds` derived from `parentId` edges (sorted by `ordinal`); root metadata adds
`treeRole`, `systemName`, `blueprintStatus`, `updatedAt`.

### 3.3 `cloneTreeWithNewIds` — the metadata-preserving materializer

New pure helper `src/cockpit/clone-tree.ts`. The metadata-faithful analogue of
charter-runtime `generate()` (§1.3). Used by **deploy** and **deployment-instantiate**.

```typescript
/** Pure. Remap every id/parentId/childrenIds/treeRootId/_dependsOn to fresh UUIDs,
 *  preserving ALL node metadata verbatim (title, charter, executionMode, scriptRef, …).
 *  Mirrors generate()'s id-remap (blueprint.ts L229–270) but copies metadata 1:1. */
export function cloneTreeWithNewIds(
  source: PlanTree,
  opts: { newId: () => string; tenantPackId: string },
): { tree: PlanTree; idMap: Map<string, string> };   // idMap: sourceId → freshId
```

It returns `idMap` so the deploy step can stamp `sourceNodeId` (§5.2) without
re-deriving the correspondence. Unit-test: a clone has disjoint ids, identical
structure, and byte-identical per-node metadata except ids.

### 3.4 `resolveTemplate` extension + the instantiate branch

`resolveTemplate` (Phase 2, `seed-templates.ts`) gains a `deployment:` arm and a
companion that returns a **tree** (for the clone path) rather than a blueprint:

```typescript
// seed:*      → CharterBlueprint constant            → handler uses generate()
// draft:*     → planTreeStore.load(rootId)            → handler uses cloneTreeWithNewIds()
// deployment:* → planTreeStore.load(deploymentId)     → handler uses cloneTreeWithNewIds()
```

`POST /api/instances` (the Phase-2 handler) branches on prefix:

- **`seed:`** — unchanged: `resolveTemplate` → `CharterBlueprint` → `compile` →
  `generate(bp, { newId, tenantPackId })`.
- **`draft:` / `deployment:`** — load the source tree → `cloneTreeWithNewIds` →
  (metadata preserved, including authored `executionMode`/`scriptRef`).

Then the existing steps run unchanged: stamp `treeRole='execution'` + `instanceOf`
(+ `deployedFrom` for `deployment:`) on the root, `save()`, append one
`charter:NodeDecomposed.v1` per node with children, respond `{ instanceId, … }`.

> Rerouting `draft:` from `extract→generate` to `cloneTreeWithNewIds` is a behaviour
> *improvement* (authoring metadata now survives) and is structurally equivalent for
> charter-only drafts. It is a small, in-place change to the Phase-2 branch — flagged
> as task **B9**.

---

## 4. Endpoints

All on the cockpit router (`src/cockpit/cockpit.router.ts`), same posture as Phase
1/2: **no auth** (single-founder, localhost `:4555`), `tenantPackId` from
`COCKPIT_TENANT_PACK_ID` (default `'foundry-default'`), fail-soft (`{ ok:false, error }`
+ status; the Angular client catches → `[]`/`null`). All consume the **already-injected**
`planTreeStore` + `instanceCatalog` — **no new dependency in `CockpitRouterDeps`,
no new wiring in `server.ts`** (blueprints/deployments share the Phase-2 store).

### 4.1 `GET /api/kinds` — charter roles for the node-kind dropdown

**Resolution: a curated, static list derived from charter-runtime's exported
`CharterRoleSchema` + `DECOMPOSABLE_ROLES` / `CLAIMABLE_ROLES` — NOT a live
generation-layer call.** Rationale: the blueprint node `kind` *is* a `CharterRole`
(it becomes `PlanNode.kind`); the MCP `gen_list_kinds` / `gen_list_coregen_kinds`
return **code-generation** kinds (`angular-feature`, `service-method`, `pack-scaffold`,
`knowledge`) — a *different axis* (what `gen_generate` emits, relevant only to a
`deterministic` node's `scriptRef`, a Phase-4 concern). Wiring the Express router to
the MCP/SDK generation layer for Phase 3 is unnecessary coupling. `scriptRef` is a
free-text field in Phase 3 (design §5.2), so codegen kinds are not needed here.

```jsonc
// GET /api/kinds
{
  "ok": true,
  "kinds": [
    { "kind": "product",    "decomposable": true,  "advances": "decompose" },
    { "kind": "epic",       "decomposable": true,  "advances": "decompose" },
    { "kind": "adr",        "decomposable": true,  "advances": "decompose" },
    { "kind": "experiment", "decomposable": true,  "advances": "decompose" },
    { "kind": "task",       "decomposable": false, "advances": "claim" },
    { "kind": "gate",       "decomposable": false, "advances": "claim" },
    { "kind": "review",     "decomposable": false, "advances": "claim" }
  ]
}
```

Server: `CharterRoleSchema.options.map(k => ({ kind: k, decomposable: DECOMPOSABLE_ROLES.has(k), advances: DECOMPOSABLE_ROLES.has(k) ? 'decompose' : 'claim' }))`.
(Forward note: a future `coregenKinds` field can wrap `listKinds()` for the
`scriptRef` picker when `executionMode==='deterministic'` — deferred to Phase 4.)

### 4.2 `GET /api/blueprints` / `GET /api/blueprints/:id`

List filters the shared catalog by `treeRole`; load returns the editor doc.

```jsonc
// GET /api/blueprints
{
  "ok": true,
  "blueprints": [
    { "id": "b1a2…", "name": "SDLC tree", "status": "ready", "nodeCount": 5, "updatedAt": "2026-06-30T14:00:00Z" }
  ]
}
// GET /api/blueprints/:id  → { "ok": true, "blueprint": <BlueprintDoc> }   (404 if absent / not treeRole='blueprint')
```

Server (list): `instanceCatalog.listRoots(tenantPackId)` → keep
`metadata.treeRole === 'blueprint'` → per root, `name = metadata.systemName`,
`status = metadata.blueprintStatus`, `nodeCount` from `planTreeStore.load(id)`
(fail-soft: unloadable → `nodeCount:0`, never dropped). When `instanceCatalog` is
absent (defensive) → `{ ok:true, blueprints:[] }`.
Server (load): `planTreeStore.load(id)`; if missing or root `treeRole !== 'blueprint'`
→ 404; else `treeToDoc(tree)`.

### 4.3 `POST /api/blueprints` / `PUT /api/blueprints/:id`

```jsonc
// POST /api/blueprints   body: { name, nodes: BlueprintNodeDoc[] }   (treeRootId server-assigned)
// PUT  /api/blueprints/:id   body: BlueprintDoc                       (treeRootId === :id, preserved)
// → { "ok": true, "blueprint": <BlueprintDoc with server-derived status> }
```

Handler: build/normalize a `BlueprintDoc` (POST: assign `treeRootId = randomUUID()`,
trust client node ids or assign UUIDs to any missing; PUT: keep `:id`), run
`validateBlueprint` (server-authoritative `status`; the request's `status` is
ignored), `docToTree(doc, tenantPackId)`, `planTreeStore.save(tree)` (full-tree
upsert — the store does delete-all+insert-all), respond with the canonical doc
(`status` reflects validation). Fail-soft: malformed body → 400; save error → 500.
A blueprint is editable any number of times — no immutability (contrast deployments).

### 4.4 `POST /api/deployments/preview` — dry-run node-diff (no write)

Powers the §6 confirmation dialog *before* the one-way door.

```jsonc
// POST /api/deployments/preview   body: { blueprintId, contextTreeId? }
{
  "ok": true,
  "ready": true,                       // false ⇒ blueprint not deployable; reasons[] populated
  "reasons": [],
  "nextVersion": 3,
  "previousDeploymentId": "d2b9…",     // current active deployment for this lineage, or null
  "diff": {
    "added":   [ { "sourceNodeId": "n7", "title": "Canary verify", "kind": "task" } ],
    "removed": [ { "sourceNodeId": "n3", "title": "Old gate",      "kind": "gate" } ],
    "changed": [ { "sourceNodeId": "n2", "title": "Implement", "kind": "task",
                   "fields": ["title", "executionMode"] } ]
  }
}
```

Server: load blueprint tree → `validateBlueprint(treeToDoc(tree))`; if not `ready`,
return `{ ok:true, ready:false, reasons }` (the dialog disables Confirm). Else
`extract(tree) → compile(bp)`; compile errors → `ready:false` + reasons. Compute
`nextVersion` and the diff against the **current active deployment** for
`(deployedFrom===blueprintId, contextTreeId)` via `computeNodeDiff` (§5.2). No write.

### 4.5 `POST /api/deployments` — the one-way door (irreversible)

```jsonc
// POST /api/deployments   body: { blueprintId, contextTreeId? }
// → { "ok": true, "deploymentId": "d3c4…", "version": 3, "nodeCount": 5 }
```

**Step-by-step (the handler) — design §6 ➍ "compile → generate → store.save", made
metadata-faithful:**

```typescript
// 1. Load + gate. Blueprint must exist and be 'ready'.
const bpTree = await planTreeStore.load(blueprintId);
if (!bpTree || rootMeta(bpTree).treeRole !== 'blueprint') { 404; return; }
const v = validateBlueprint(treeToDoc(bpTree));
if (v.status !== 'ready') { 422 { error:'blueprint not ready', reasons:v.reasons }; return; }

// 2. Structural validation via the charter-runtime pipeline (the design's compile()).
const bp = extract(bpTree, randomUUID());
const verdict = compile(bp);
if (!verdict.ok) { 422 { error:'blueprint does not compile', errors:verdict.errors }; return; }

// 3. Materialize — clone with fresh UUIDs, PRESERVING authoring metadata (§3.3).
//    (NOT generate(): generate would strip executionMode/scriptRef/title — §1.3.)
const { tree: deployTree, idMap } = cloneTreeWithNewIds(bpTree, { newId: randomUUID, tenantPackId });

// 4. Compute the next version for this lineage; stamp deployment metadata on the root,
//    and stamp sourceNodeId (= the blueprint node id) on every node for cross-version diff.
const nextVersion = (await currentActiveVersion(blueprintId, contextTreeId)) + 1;
const stamped = stampDeployment(deployTree, idMap, {
  treeRole: 'deployment', deployedFrom: blueprintId, deploymentVersion: nextVersion,
  deploymentStatus: 'active', contextTreeId: contextTreeId ?? null,
  deployedAt: now(), systemName: rootMeta(bpTree).systemName,
});

// 5. Supersede the prior active deployment of this lineage (metadata-only flip).
const prior = await activeDeployment(blueprintId, contextTreeId);
if (prior) { await planTreeStore.save(withRootStatus(prior, 'superseded')); }

// 6. Persist the new deployment — THIS is the one-way door. Immutable thereafter.
await planTreeStore.save(stamped);

// 7. Respond. (No CharterEvent — a deployment is a template, not a lifecycle subject; §6 Invariants.)
res.json({ ok:true, deploymentId: stamped.treeRootId, version: nextVersion, nodeCount: stamped.nodes.length });
```

Fail-soft: blueprint missing → 404; not ready / does not compile → 422; save error
→ 500. **Irreversibility:** there is no `PUT`/`DELETE` for deployments. A correction
is a *new version* (re-deploy), never an edit. Only `deploymentStatus` (active →
superseded) transitions, as a current-pointer marker; node content is frozen.

### 4.6 `GET /api/deployments?treeId=` + `executionMode` read fix + templates rows

```jsonc
// GET /api/deployments?treeId=<contextTreeId>   (treeId optional → all deployments)
{
  "ok": true,
  "deployments": [
    { "deploymentId": "d3c4…", "version": 3, "deployedFrom": "b1a2…", "status": "active",
      "contextTreeId": "foundry-sdlc", "deployedAt": "2026-06-30T14:22:00Z", "nodeCount": 5 }
  ]
}
```

Server: `listRoots` → keep `treeRole==='deployment'` (+ `contextTreeId===treeId` when
given) → map root metadata. Sort by `deploymentVersion` desc.

Two small companion changes:
- **`GET /api/templates`** also appends `deployment:*` rows
  (`{ id:'deployment:<id>', name:'<systemName> v<n>', source:'deployment', nodeCount }`),
  filtered to `deploymentStatus==='active'` by default — so the existing New-Instance
  dialog lists deployments with no dialog change (design §4.3 forward path).
- **frontier `executionMode`** (`cockpit.router.ts:282`) reads
  `(meta['executionMode'] as string) ?? charter?.['executionMode'] ?? 'ai'` — so the
  authored mode now surfaces on the board/frontier (§1.3).

---

## 5. Deployment Versioning + Node-Diff

### 5.1 Versioning

`deploymentVersion` is monotonic **per `(deployedFrom, contextTreeId)` lineage**.
`currentActiveVersion(blueprintId, contextTreeId)` = max `deploymentVersion` among
roots with `treeRole==='deployment'`, `deployedFrom===blueprintId`,
`contextTreeId===contextTreeId` (0 if none). Re-deploying the same blueprint yields
v1, v2, v3, … with the latest `active` and all prior `superseded`. Nothing is
deleted → full version history is queryable (event-sourcing-adjacent).

### 5.2 `computeNodeDiff` — pure, correlates by `sourceNodeId`

New pure module `src/cockpit/deployment-diff.ts`.

```typescript
export interface NodeDiff {
  added:   Array<{ sourceNodeId: string; title: string; kind: string }>;
  removed: Array<{ sourceNodeId: string; title: string; kind: string }>;
  changed: Array<{ sourceNodeId: string; title: string; kind: string; fields: string[] }>;
}
/** Pure. candidate = the blueprint tree (keyed by its own node ids = future sourceNodeId);
 *  previous = the current active deployment tree (keyed by metadata.sourceNodeId), or null. */
export function computeNodeDiff(candidateBlueprintTree: PlanTree, previousDeploymentTree: PlanTree | null): NodeDiff;
```

- **Correlation key.** Blueprint node ids are stable across edits (the editor
  preserves ids on PUT). At deploy, each deployment node carries
  `metadata.sourceNodeId = <blueprintNodeId>`. So a candidate node's own id matches a
  previous deployment node's `sourceNodeId` — a stable cross-version join.
- **added** = candidate ids absent from previous `sourceNodeId`s.
- **removed** = previous `sourceNodeId`s absent from candidate ids.
- **changed** = ids in both whose comparable fields differ: `title`, `kind`,
  `executionMode`, `scriptRef`, `mission.objective`, `mission.outcome`,
  `scope.allowedPathPrefixes`. `fields[]` names which changed (UI shows them).
- `previous === null` (first deploy) → everything is `added`.

### 5.3 Supersession is a marker flip, not a mutation

When vN+1 is deployed, vN's root `deploymentStatus` flips `active → superseded`
(a single metadata write via full-tree re-save). This is the *only* post-creation
change to a deployment; node content (kinds, contracts, structure, authoring
metadata) is frozen. "Immutable deployment" means immutable **content**; the
active/superseded marker is a current-pointer, like a moving tag.

---

## 6. Frontend

New/changed Angular surfaces in `domains/foundry/apps/cockpit`. Standalone, signals,
`OnPush` — same conventions as Phase 1/2. WCAG 2.2 AA throughout: native `<select>`,
`<button>`, `<input>`, `<textarea>`; dialogs trap focus + close on `Esc`; the
node-list editor is **fully keyboard-operable** (reorder via up/down buttons, not
drag-drop — design §5.2); tab `aria-current` already handled by the shell.

### 6.1 Shell + routes — all four tabs light up

`cockpit-shell.component.ts`: add **Draft** + **Deploy** tabs (before Instances), so
the Level-2 nav is `[ Draft ] [ Deploy ] [ Instances ] [ Execute ]`.
`app.routes.ts`:

```typescript
{ path: 'tree/:treeId/draft',  loadComponent: () => import('./draft/draft.page.js').then(m => m.DraftPage) },
{ path: 'tree/new/draft',      loadComponent: () => import('./draft/draft.page.js').then(m => m.DraftPage) },  // replaces StubPage
{ path: 'tree/:treeId/deploy', loadComponent: () => import('./deploy/deploy.page.js').then(m => m.DeployPage) },
```

(`tree/new/draft` opens the editor with no blueprint selected → "+ New Blueprint"
pre-armed; `?treeRole=` query, if present, seeds the root kind.)

### 6.2 Draft page — `draft/draft.page.ts`

Two panels (design §5.1 / §5.2).

- **Left — blueprint list:** `client.getBlueprints()` → cards (name, `status` badge
  `draft`/`ready`, nodeCount, updatedAt). "+ New Blueprint" creates an empty doc
  (one `product` root) and selects it. Selecting a card loads
  `client.getBlueprint(id)` into the editor. "Deploy →" (enabled only when
  `status==='ready'`) → `router.navigate(['/tree', treeId, 'deploy'], { queryParams:{ blueprintId } })`.
- **Right — node-list editor:** indented list (depth from `parentId`), per node:
  - `kind` `<select>` populated by `client.getKinds()`;
  - `title` `<input>`;
  - `executionMode` `<select>` (`deterministic`/`ai`/`human`/`hybrid`);
  - `scriptRef` `<input>` shown only when `executionMode==='deterministic'`;
  - collapsible charter contract: `mission.objective` / `mission.outcome`
    `<textarea>`, `scope.allowedPathPrefixes` `<input>` (comma-split);
  - row controls: **+ Add child**, **Delete**, **▲ / ▼** reorder (keyboard buttons).
  - Live validation banner: computes `validateBlueprint` client-side for instant
    `ready/draft` + per-node reason hints; **Save** (`POST`/`PUT`) persists and the
    server's authoritative `status` is reflected back.
- **"Preview in Board"** (design §5.1): renders `planTreeToRecipe(docToBoardNodes(doc))`
  in a read-only modal SVG board (reuses the Phase-1 board component; no live status).

### 6.3 Deploy page — `deploy/deploy.page.ts`

Design §6.

- **Deployment table:** `client.getDeployments(treeId)` → rows
  (Version, Deployed, Nodes, Status `active`/`superseded`). Sorted version-desc.
- **"Deploy New Version"** (top-right): opens a dialog:
  1. **Blueprint picker** — `client.getBlueprints()` filtered to `status==='ready'`
     (pre-selected if arriving with `?blueprintId`).
  2. **Node-diff confirmation** — `client.previewDeployment({ blueprintId, contextTreeId: treeId })`
     → shows `added` (green) / `removed` (red) / `changed` (amber, with `fields`),
     `nextVersion`, and a one-way-door warning. Confirm disabled if `ready:false`
     (shows `reasons`).
  3. **Confirm** → `client.deploy({ blueprintId, contextTreeId: treeId })` → on
     `{ ok:true }` refresh the table. Irreversible (copy says so).
- **"Create Instance →"** per row → `router.navigate(['/tree', treeId, 'instances'])`
  with the deployment pre-selected (the Instances dialog already lists it via the
  `deployment:*` template rows, §4.6).

### 6.4 Instances — deployments appear in the New-Instance picker

No new dialog. Because `GET /api/templates` now emits `deployment:*` rows (§4.6), the
Phase-2 New-Instance dialog lists active deployments alongside seeds/drafts. Selecting
one → `createInstance({ templateId:'deployment:<id>', contextTreeId })` →
`instanceOf='deployment:<id>'` — the §4.3 promise realized.

### 6.5 Client + types — `foundry-cockpit.client.ts` / `cockpit-types.ts`

```typescript
getKinds(): Promise<KindInfo[]>                                   // GET /api/kinds
getBlueprints(): Promise<BlueprintSummary[]>                      // GET /api/blueprints
getBlueprint(id: string): Promise<BlueprintDoc | null>           // GET /api/blueprints/:id
saveBlueprint(doc: Partial<BlueprintDoc>): Promise<BlueprintDoc | null>  // POST or PUT
getDeployments(treeId?: string): Promise<DeploymentSummary[]>    // GET /api/deployments[?treeId=]
previewDeployment(req: { blueprintId: string; contextTreeId?: string }): Promise<DeployPreview | null>  // POST /api/deployments/preview
deploy(req: { blueprintId: string; contextTreeId?: string }): Promise<{ deploymentId: string; version: number } | null>  // POST /api/deployments
```

Fail-soft like the existing methods (catch → `[]`/`null`). New types
(`KindInfo`, `BlueprintSummary`, `BlueprintDoc`, `BlueprintNodeDoc`,
`DeploymentSummary`, `DeployPreview`, `NodeDiff`) added to `cockpit-types.ts`.

---

## 7. Phasing / Task Shape

~15 tasks, backend before frontend, TDD-shaped (failing test → impl → typecheck →
commit), matching the Phase-1/2 rhythm. Backend B1–B10 land before any frontend;
F1–F7 depend on B2–B10 being deployed at `:4555`.

### Backend (pure adapters first, then endpoints)

- **B1 — `blueprint-doc.ts`.** `BlueprintDoc`/`BlueprintNodeDoc` + `docToTree` +
  `treeToDoc` + `validateBlueprint`. Pure. Unit test: round-trip `docToTree∘treeToDoc`
  is identity on a valid doc; `validateBlueprint` flags empty title, empty
  `scriptRef` on a deterministic node, multi-root, blank mission.
- **B2 — `clone-tree.ts`.** `cloneTreeWithNewIds` + `idMap`. Pure. Unit test:
  disjoint ids, identical structure, per-node metadata byte-identical except ids;
  `_dependsOn` remapped.
- **B3 — `deployment-diff.ts`.** `computeNodeDiff`. Pure. Unit test: added/removed/
  changed by `sourceNodeId`; `previous===null` → all added; `fields[]` precise.
- **B4 — `GET /api/kinds`.** Curated `CharterRole` list from charter-runtime exports.
- **B5 — `GET /api/blueprints` + `GET /api/blueprints/:id`.** `listRoots` filter
  `treeRole==='blueprint'`; load → `treeToDoc`; 404 on absent/wrong-role.
- **B6 — `POST /api/blueprints` + `PUT /api/blueprints/:id`.** Normalize doc →
  `validateBlueprint` → `docToTree` → `save`; return canonical doc. Integration test:
  POST → GET round-trips; PUT preserves `treeRootId` + node ids.
- **B7 — `POST /api/deployments/preview`.** Load + validate + `extract`/`compile` +
  `computeNodeDiff` + `nextVersion`; no write. Test: first preview → all-added,
  `nextVersion:1`; second → diff vs v1.
- **B8 — `POST /api/deployments`** (the one-way door). §4.5 steps: gate ready →
  compile → `cloneTreeWithNewIds` → stamp deployment + `sourceNodeId` → supersede
  prior → save. Integration test: deploy a ready blueprint → `GET /api/deployments`
  shows v1 active; re-deploy → v2 active, v1 superseded; deployed node metadata
  preserves `executionMode`/`scriptRef`.
- **B9 — Instantiate from deployment.** Extend `resolveTemplate` (`deployment:`) +
  the `POST /api/instances` branch (tree-sourced → `cloneTreeWithNewIds`; reroute
  `draft:` to the same path). `GET /api/templates` appends active `deployment:*` rows.
  Integration test: deploy → `POST /api/instances {templateId:'deployment:<id>'}` →
  `GET /api/frontier/<instanceId>` non-empty; the instance root has
  `instanceOf:'deployment:<id>'`; a deterministic node keeps its `scriptRef`.
- **B10 — frontier `executionMode` read fix** (`metadata.executionMode` precedence)
  + register the new routes. (Small; may fold into B5/B9.)

### Frontend

- **F1 — Client + types.** §6.5 methods + new types.
- **F2 — Shell tabs + routes.** Draft + Deploy tabs; `draft`/`deploy`/`tree/new/draft`
  routes (replace `StubPage`).
- **F3 — Draft list panel** (§6.2 left): cards + status badge + "+ New Blueprint" +
  "Deploy →".
- **F4 — Node-list editor** (§6.2 right): per-node controls, conditional `scriptRef`,
  collapsible contract, add-child/delete/reorder, live `ready` banner, Save. a11y.
- **F5 — "Preview in Board"** modal (reuse Phase-1 board, read-only).
- **F6 — Deploy page** (§6.3): table + "Create Instance →".
- **F7 — Deploy New Version flow** (§6.3): blueprint picker → preview node-diff dialog
  → one-way-door confirm → POST → refresh. a11y (focus trap, Esc).

### Capstone (optional)

- **C1 — e2e.** Draft a blueprint (set one node `deterministic` + `scriptRef`) → Save
  → mark `ready` → Deploy v1 → instantiate from `deployment:<id>` → frontier non-empty
  → assert the instance node still carries `executionMode:'deterministic'` +
  `scriptRef`. Closes the full Draft→Deploy→Instantiate→Execute loop.

**Total: 15 tasks (+1 capstone).**

---

## 8. Invariants

### 8.1 ZERO kernel change (ADR-176)
Blueprint, deployment, and instance are all `kernel.plan_node` roots distinguished by
`metadata.treeRole`. Every new field (`treeRole`, `blueprintStatus`, `deployedFrom`,
`deploymentVersion`, `deploymentStatus`, `sourceNodeId`, `executionMode`, `scriptRef`,
`title`) is `metadata` JSONB. `PlanNode` schema, `PlanTreeStore` contract,
`CharterContractSchema`, and `kernel.plan_node` are untouched. No new charter-runtime
impl; `cloneTreeWithNewIds` / `blueprint-doc` / `deployment-diff` are **foundry-side**
pure modules.

### 8.2 No new persistence substrate
Blueprints + deployments + instances share the one `PlanTreeStore` already injected
in Phase 2 (`FoundryPrismaPlanTreeStore` keyed / `InMemoryPlanTreeStore` keyless) and
the one `InstanceCatalogPort`. `CockpitRouterDeps` and `server.ts` gain **no new
store/catalog**. The keyless in-memory fallback (Phase 2 §2.1) carries blueprints +
deployments too — keyless authoring works, ephemerally (OQ-1).

### 8.3 The one-way door is irreversible
Deployments have no `PUT`/`DELETE`. Corrections are new versions. Only the root
`deploymentStatus` flips (active → superseded) as a current-pointer marker; node
content is frozen (§5.3). A deployment is a **template**, never executed directly —
instances are cloned *from* it.

### 8.4 Authoring metadata survives the pipeline
`executionMode` / `scriptRef` / `title` are sibling metadata keys and are preserved
through deploy and instantiate by `cloneTreeWithNewIds` (never lost to the lossy
`extract`/`generate` contract round-trip, §1.3). The frontier/board read
`metadata.executionMode` with a `charter.executionMode → 'ai'` fallback.

### 8.5 Fail-soft everywhere
Missing blueprint → 404; not-ready / non-compiling → 422; store error → 500; the
Angular client catches every call → `[]`/`null`. The cockpit never crashes on a bad
blueprint or a failed deploy.

### 8.6 Audit posture
A deployment emits **no `CharterEvent`** (it is a template, not a lifecycle subject;
folding its log would be meaningless). The audit record *is* the immutable, versioned,
timestamped deployment tree in the store (`deployedFrom` + `deploymentVersion` +
`deployedAt`, with prior versions retained as `superseded`). Instance lifecycle audit
is unchanged from Phase 2 (`NodeDecomposed.v1` on instantiate, then per-action events).

### 8.7 Cockpit stays read-only on the kernel directly
All reads/writes go through `:4555`. The Angular app never touches Postgres or the
event log directly.

---

## 9. Decisions Made (interim) + Open Questions for the Founder

Resolved as interim defaults — all are local architecture choices with a defensible
default (none are charter/business gates needing a `type/decision` issue):

| # | Decision | Default taken | Rationale |
|---|---|---|---|
| D1 | Blueprint persistence | A draft plan tree (`treeRole='blueprint'`) in the existing `PlanTreeStore` | Zero new schema/store; reuses Phase-2 keyless fallback + `listRoots`; `draft:*` already reads blueprints this way (§1.2) |
| D2 | Separate `BlueprintStore`? | **No** — keep charter-runtime's port unused for persistence | A durable Prisma `BlueprintStore` duplicates plan-tree persistence and is *lossy* (strips `executionMode`/`scriptRef`); §1.2 option B |
| D3 | "deployment" model | Frozen, versioned, immutable plan tree (`treeRole='deployment'`), a template instances clone from | Honors design §6 one-way door + §4.3 forward path; all in `metadata` (§3.1) |
| D4 | Deploy materialization | `cloneTreeWithNewIds` (metadata-preserving), with `extract`/`compile` for validation; `generate()` for seeds only | Preserves authored `executionMode`/`scriptRef` that `generate()` would strip (§1.3) |
| D5 | `GET /api/kinds` source | Curated `CharterRole` list from charter-runtime exports — **not** a live generation-layer call | Node `kind` *is* a `CharterRole`; `gen_list_kinds` is a different axis (codegen, Phase-4 `scriptRef`); avoids MCP coupling (§4.1) |
| D6 | Deploy emits a `CharterEvent`? | **No** — the versioned immutable tree is the record | A deployment is a template, not a lifecycle subject (§8.6) |
| D7 | `executionMode` storage | Sibling `metadata.executionMode`, not inside `metadata.charter` | `CharterContractSchema` strips unknown keys; supersedes design §9 (§1.3) |

**Genuine open questions (founder input would sharpen the build):**

- **OQ-1 (durability of authored blueprints).** In keyless mode, blueprints +
  deployments are ephemeral (lost on restart), identical to Phase-2 instances. Is
  that acceptable for the dogfooding inner loop, or should Draft/Deploy *require*
  Postgres + JWT so authored artifacts always persist? *Interim: ephemeral keyless
  fallback on (consistent with Phase-2 OQ-1).*
- **OQ-2 (`contextTreeId` lineage semantics).** Is `deploymentVersion` scoped per
  `(blueprint, contextTreeId)` (one version line per forest tree) or globally per
  blueprint? This decides whether deploying the same blueprint under two trees yields
  independent v-lines. *Interim: per `(blueprint, contextTreeId)`.*
- **OQ-3 (blueprint deletion / archival).** No `DELETE /api/blueprints/:id` in Phase 3
  — blueprints accumulate (same as Phase-2 instances, OQ-4). Add a retire/archive verb
  now or defer? *Interim: defer.*
- **OQ-4 (instances of a superseded deployment).** When a deployment is superseded,
  its live instances keep running (they are independent clones). Should the cockpit
  surface a "running on a superseded deployment" hint, or is silent drift fine?
  *Interim: silent (instances are self-contained, Phase-2 §7.5).*
- **OQ-5 (deploy/ops event stream for cross-tree inference).** The hydra-vision §9
  cross-tree inference wants deploy events in a unified log. Phase 3 records
  deployments as store rows, not events. Add a `foundry:Deployed.v1` audit stream when
  the inference arc starts? *Interim: defer to the inference arc (D6).*
- **OQ-6 (tenant scoping for cockpit-authored blueprints).** Cockpit blueprints use
  `COCKPIT_TENANT_PACK_ID`; studio drafts use the JWT tenant. In keyed mode these may
  differ, so a studio-authored draft may not appear as a cockpit blueprint. Unify on a
  single cockpit tenant, or bridge? *Interim: single `COCKPIT_TENANT_PACK_ID` (Phase-2
  OQ-3).*

---

## 10. Hand-off Notes for the Implementer

- **Read first:** ADR-176 (kernel minimality — why everything is `metadata`); the
  Phase-2 spec (`2026-06-30-foundry-cockpit-phase2-instances-design.md`) for the store
  / catalog / `resolveTemplate` patterns this extends; design §5/§6/§9.
- **Files to create (backend):** `src/cockpit/blueprint-doc.ts`,
  `src/cockpit/clone-tree.ts`, `src/cockpit/deployment-diff.ts`.
- **Files to modify (backend):** `src/cockpit/cockpit.router.ts` (the new endpoints +
  the `executionMode` read fix + the `POST /api/instances` deployment branch +
  `GET /api/templates` deployment rows), `src/cockpit/seed-templates.ts`
  (`resolveTemplate` gains `deployment:`). **No `server.ts` change** — the store +
  catalog are already injected; deployments/blueprints reuse them.
- **Files to create (frontend):** `apps/cockpit/src/app/draft/draft.page.ts` (+ a
  node-editor child component + the preview-board modal), `apps/cockpit/src/app/deploy/deploy.page.ts`
  (+ the deploy-new-version dialog).
- **Files to modify (frontend):** `apps/cockpit/src/app/app.routes.ts` (draft/deploy
  routes; drop `StubPage`), `shell/cockpit-shell.component.ts` (Draft + Deploy tabs),
  `shared/foundry-cockpit.client.ts` + `shared/cockpit-types.ts` (§6.5).
- **charter-runtime calls used (all already exported):** `extract`, `compile`,
  `generate` (seeds), `readCharter`, `writeCharter`, `CharterRoleSchema`,
  `DECOMPOSABLE_ROLES`, `CLAIMABLE_ROLES`, `foldCharterLifecycleState`,
  `charterFrontier`, `dispatchCharterAction`, `CharterBlueprint`/`PlanTree` types.
  **No charter-runtime change required.**
- **Acceptance (the full-pipeline gate, keyless):**
  1. `POST /api/blueprints {name, nodes:[product root + 1 deterministic task w/ scriptRef]}`
     → `{ ok:true, blueprint:{ status:'ready' } }`.
  2. `POST /api/deployments {blueprintId}` → `{ ok:true, deploymentId, version:1 }`;
     `GET /api/deployments` shows v1 `active`.
  3. Re-deploy → `version:2 active`, v1 `superseded`; `POST /api/deployments/preview`
     between edits returns a non-empty `changed[]` with precise `fields`.
  4. `POST /api/instances {templateId:'deployment:<deploymentId>'}` → `instanceId`;
     `GET /api/frontier/<instanceId>` ≥1 claimable entry; the deterministic node's
     `metadata.executionMode==='deterministic'` and `scriptRef` are intact.
- **Out of scope (later phases):** `ScriptWorker` runtime routing on `executionMode`
  (Phase 4 / charter-runtime track); blueprint deletion/archival; deploy event stream;
  multi-tenant cockpit isolation; dagre board layout.
