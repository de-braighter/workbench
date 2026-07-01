---
title: "Foundry Cockpit Phase 2 — Instances — Design Spec"
date: 2026-06-30
status: draft
authors: [designer]
adr: reserved
tags: [cockpit, foundry, instances, charter, plan-tree, execute, generate, zero-kernel]
supersedes-section: "2026-06-30-foundry-cockpit-design.md §7 (Instances Tab sketch)"
---

# Foundry Cockpit Phase 2 — Instances — Design Spec

This spec resolves the **Instances** phase of the Foundry Cockpit into something
buildable on **what exists today** — without the Phase-3 Deploy / durable
`BlueprintStore` layer. It replaces the 4-bullet sketch in
`2026-06-30-foundry-cockpit-design.md §7` and the `:deploymentId` reference that
pointed at the not-yet-built deploy pipeline.

**Context to read first:**
- `2026-06-30-foundry-cockpit-design.md` — the full cockpit design (esp. §2 routes, §4 Execute view, §10 Phasing — Phase 2 needs **only Phase 1, not Phase 3**).
- `2026-06-30-hydra-factory-vision.md` — the four verbs (Draft → Deploy → Instantiate → Execute), `treeRole` / `executionMode` conventions, the `execution` tree role (§4: "Live instances — one per tenant/customer/session").
- `2026-06-30-foundry-cockpit-phase1.md` — what Phase 1 shipped: cockpit app at `:4201`, `FoundryCockpitClient`, `LiveStatusService`, `ExecutePage` with route `tree/:treeId/execute/:instanceId` **already scaffolded**, the cockpit router (`/api/trees`, `/api/charter-status`, `/api/frontier/:treeRootId`, `/api/action/:nodeId`).

---

## 1. The Core Resolution — What an Instance Is

### 1.1 One-sentence definition

> **An instance is a fresh charter-bearing `PlanTree`, with its own `treeRootId`,
> generated from a template via charter-runtime `generate()`, persisted in the
> `PlanTreeStore`, and stamped with `metadata.treeRole = 'execution'` +
> `metadata.instanceOf = <templateId>` on its root node — at which point the
> already-shipped `/api/frontier/:treeRootId` + `/api/action/:nodeId` loop
> operates on it unchanged.**

There is no separate "instance" entity, no instance table, no instance row. An
instance **is** a plan tree. Its identity *is* its `treeRootId`. The only thing
distinguishing an instance tree from a draft tree (both live as `kernel.plan_node`
rows) is **metadata on the root node**:

| metadata key (on root node) | value | purpose |
|---|---|---|
| `treeRole` | `'execution'` | marks this root as a live instance (vs `sdlc`/`features` drafts) |
| `instanceOf` | `<templateId>` (e.g. `seed:sdlc-mini`) | lineage pointer to the template it was seeded from |
| `instanceName` | human label (optional) | display name in the Instances list |
| `contextTreeId` | `<treeId>` (optional) | the forest tree the founder created it under (the `:treeId` route param) |
| `instantiatedAt` | ISO timestamp | sort key / audit |

This honours **ZERO kernel change (ADR-176)**: all instance/template linkage is
`metadata` JSONB; the `PlanNode` schema is untouched. `generate()` already writes
only `metadata` (`_dependsOn` + `charter`); Phase 2 adds the five keys above on the
root node before `save()`.

### 1.2 Why this is the right model (and what it rejects)

The cockpit-design sketch (§7) and the hydra vision (§7.2) both described
*Instantiate* as "stamp blueprint version, assign rootNodeId, emit initial
`NodeDecomposed`" — *against a deployment*. That model assumes Phase 3 (a deployed
blueprint sitting in the substrate that instances point back into via
`metadata.blueprintNodeId`). Phase 3 is not built.

**Alternatives considered:**

| Option | What it is | Verdict |
|---|---|---|
| **A — Instance = its own tree (chosen)** | `generate(template)` produces a self-contained tree; lineage to the template is a string in `metadata.instanceOf`. No reference into a shared deployment tree. | **Chosen.** Buildable today on the merged `FoundryPrismaPlanTreeStore` + `generate()`. Survives Phase 3 unchanged — `instanceOf` simply starts pointing at a `deploymentId` instead of a `seed:` id. |
| B — Instance = a subtree under one shared deployment tree | Instances are branches of a single big tree; `metadata.blueprintNodeId` cross-links each node back to the deployed blueprint node. | Rejected for Phase 2: requires the deployment tree (Phase 3) to exist first; multi-instance isolation under one `treeRootId` complicates the frontier (which is `treeRootId`-scoped). |
| C — Instance = a pure event-log construct (no tree copy) | Don't copy the tree; replay the template + an instance-id-scoped event log. | Rejected: `charterFrontier(tree, state)` and `/api/action` both load a concrete `PlanTree` from the store. No tree in the store → empty frontier (this is exactly the Phase-1 boundary). The store IS the instance substrate. |

Option A is the only one that lights up the existing loop with code that exists
today. It is also forward-compatible: when Phase 3 ships, a *deployment* becomes a
durable blueprint version, and "instantiate" changes only its **source resolver**
(`templateId` → `deploymentId`), not the instance model.

---

## 2. What Lights Up — Closing the Phase-1 Boundary

Phase 1 left a deliberate gap (cockpit-design plan, "Phase-1 boundary"):

- `/api/trees` reads the **in-memory** `buildCascadeTree(FOUNDRY_PRODUCT)`.
- `/api/frontier/:treeRootId` + `/api/action/:nodeId` read/write the
  **`planTreeStore`** (Prisma) + `CharterEventLog`.
- **The store has no charter-bearing trees in it**, so `planTreeStore.load(...)`
  returns `null`, so `/api/frontier` returns `{ frontier: [] }`, so the action
  loop is dead.

Instances is the natural place to **put real charter trees into the store**. The
moment `POST /api/instances` calls `planTreeStore.save(generatedTree)`:

1. `GET /api/frontier/:instanceId` → `planTreeStore.load(instanceId)` now returns
   the tree → `charterFrontier(tree, state, now)` surfaces every **leaf** node
   that is unresolved, unclaimed, and dependency-unblocked:
   - `DECOMPOSABLE_ROLES` (`product`/`epic`/`adr`/`experiment`) → `action: 'decompose'`
   - `CLAIMABLE_ROLES` (`task`/`gate`/`review`) → `action: 'claim'`
2. `POST /api/action/:nodeId` with `{ treeRootId: instanceId, action }` now finds
   the tree → `dispatchCharterAction` runs the `ACTION_REGISTRY` handler → emits a
   `CharterEvent` → the next 5s `LiveStatusService` poll reflects the new status.

No new frontier/action code is required — Phase 1 already built it correctly; it
was just operating on an empty store. **Instances is the data that makes the
Phase-1 machine run.**

### 2.1 The store dependency, and the keyless-dev gap

The store wired into the cockpit router today is **mode-dependent** (`server.ts`):

```text
hasStudioKeys (STUDIO_JWT_PRIVATE_KEY + STUDIO_JWT_PUBLIC_KEY present)
  ├─ prisma != null  → planTreeStore = FoundryPrismaPlanTreeStore (durable Postgres, RLS)
  │                     charterEventLog = FileCharterEventLog (data/charter-events.jsonl)
  └─ prisma == null  → planTreeStore = NULL-STUB { load: ()=>null, save: ()=>{} }  ← no-op
                        charterEventLog = InMemoryCharterEventLog (ephemeral)
```

In **keyless mode** (the default local-dev posture — no Postgres, no JWT), the
plan-tree store is a **no-op null-stub**: `save()` discards the tree and `load()`
always returns `null`. So even after `POST /api/instances`, the frontier stays
empty. Phase 2's headline value ("the action loop lights up") would then require a
founder to stand up Postgres + JWT keys — a high bar for the dogfooding inner loop.

**Decision: add an `InMemoryPlanTreeStore` fallback for keyless mode** (see §6,
Task B2). It is small, it is **symmetric with the `InMemoryCharterEventLog`
already used in keyless mode**, and it converts the dead null-stub into a working
(ephemeral) store. Result:

| Mode | plan-tree store | event log | instances | action loop |
|---|---|---|---|---|
| keyed (`STUDIO_JWT_*` set) | `FoundryPrismaPlanTreeStore` | `FileCharterEventLog` | durable | works, survives restart |
| keyless (default) | **`InMemoryPlanTreeStore`** (new) | `InMemoryCharterEventLog` | ephemeral (lost on restart) | **works** |

The durability gap in keyless mode is **identical to the charter event log's
existing keyless posture** — it introduces no new inconsistency, and it is the
right trade for a single-founder dogfooding tool.

---

## 3. Template / Seed Source — Where Instances Come From

Without Phase 3 Deploy, the founder needs *something* to instantiate. The minimum
viable source is **built-in seed templates**, expressed as `CharterBlueprint`
constants, plus an optional **instantiate-from-draft** bridge to the S4 drafts API.

### 3.1 Built-in seed templates

Defined as `CharterBlueprint` objects (the charter-runtime type — `id`, `nodes[]`
of `{ id, parentId, role, contract, ordinal, dependsOn }`) in a new foundry source
module `src/cockpit/seed-templates.ts`. Two seeds cover both frontier actions:

**`seed:sdlc-mini`** — exercises the **claim / gate / release** loop. A `product`
root decomposed into leaf children so the frontier is non-empty *immediately*:

```text
product  "Ship a feature"           (root — decomposed, structural)
  ├─ task   "Design"                (leaf → frontier action: claim)
  ├─ task   "Implement"             (leaf → claim; dependsOn: Design)
  ├─ gate   "Review"                (leaf → claim; dependsOn: Implement)
  └─ task   "Deploy"               (leaf → claim; dependsOn: Review)
```

**`seed:decompose-demo`** — exercises the **decompose** action. An `epic` root with
**no children** → surfaces on the frontier as `action: 'decompose'`:

```text
epic     "Build the thing"          (root — leaf, decomposable → frontier action: decompose)
```

Each blueprint node's `contract` is a valid `CharterContract`
(`{ role, mission: { objective, outcome }, scope: { allowedPathPrefixes } }`) —
child scopes must satisfy `validateInheritance` against the parent (subset path
prefixes), or `generate()`'s downstream `claim`/`decompose` will reject them.

### 3.2 Instantiate-from-draft (keyed mode only)

S4 shipped a drafts API (`/api/drafts`, `createDraftsRouter`) backed by the same
`FoundryPrismaPlanTreeStore`. When keyed, a founder may have authored a draft tree.
Allow `templateId = 'draft:<treeRootId>'`:

```text
resolveTemplate('draft:<rootId>'):
  tree = planTreeStore.load(rootId)        // the saved draft
  blueprint = extract(tree, newId())        // charter-runtime extract() → CharterBlueprint
  return blueprint
```

This bridges *authored draft → live instance* **without waiting for Phase 3
Deploy**. (`extract()` silently skips non-charter nodes, so only charter-bearing
drafts produce a usable blueprint.)

### 3.3 Template resolver

```typescript
// src/cockpit/seed-templates.ts
export const SEED_TEMPLATES: Record<string, CharterBlueprint> = {
  'seed:sdlc-mini':      { /* ... */ },
  'seed:decompose-demo': { /* ... */ },
};

// in the instances router:
async function resolveTemplate(templateId: string): Promise<CharterBlueprint> {
  if (templateId.startsWith('seed:')) {
    const bp = SEED_TEMPLATES[templateId];
    if (!bp) throw new TemplateNotFoundError(templateId);
    return bp;
  }
  if (templateId.startsWith('draft:')) {
    const rootId = templateId.slice('draft:'.length);
    const tree = await planTreeStore.load(rootId);
    if (!tree) throw new TemplateNotFoundError(templateId);
    return extract(tree, newId());
  }
  throw new TemplateNotFoundError(templateId);
}
```

**Note on blueprint id collisions:** `SEED_TEMPLATES` blueprints have stable node
ids, but `generate()` **remaps every node id to a fresh UUID** (`opts.newId()`),
so two instances of `seed:sdlc-mini` get fully disjoint node id sets and disjoint
`treeRootId`s. Re-instantiating the same seed is always safe.

---

## 4. Endpoints

Four new endpoints on the cockpit router (`src/cockpit/cockpit.router.ts`). The
existing `frontier` + `action` + `charter-status` endpoints are **unchanged** —
they already operate on any `treeRootId` in the store, including instance trees.

All cockpit endpoints follow the Phase-1 posture: **no auth** (single-founder,
localhost-bound `:4555`), `tenantPackId` from `COCKPIT_TENANT_PACK_ID`
(default `'foundry-default'`), fail-soft (`{ ok: false, error }` + appropriate
status; the Angular client catches → `[]`/`null`).

### 4.1 `GET /api/templates` — list instantiable templates

For the "New instance" picker.

**Response:**
```jsonc
{
  "ok": true,
  "templates": [
    { "id": "seed:sdlc-mini",      "name": "SDLC (mini)",     "source": "seed",  "nodeCount": 4 },
    { "id": "seed:decompose-demo", "name": "Decompose demo",  "source": "seed",  "nodeCount": 1 },
    { "id": "draft:9c1f…",         "name": "My football tree", "source": "draft", "nodeCount": 12 }
  ]
}
```

`source: 'seed'` rows come from `SEED_TEMPLATES`. `source: 'draft'` rows are
included **only in keyed mode** (mirrors the drafts list query:
`planNode.findMany({ where: { tenantPackId, parentId: null, deletedAt: null } })`,
filtered to charter-bearing roots). Keyless mode returns seeds only.

### 4.2 `GET /api/instances` — list instances

Optional `?contextTreeId=<treeId>` filter (the forest tree the Instances tab is
scoped to). Without it, returns all instance trees for the tenant.

**Response:**
```jsonc
{
  "ok": true,
  "instances": [
    {
      "instanceId":   "f3a2…",     // === treeRootId === root node id
      "treeRootId":   "f3a2…",
      "name":         "Ship login",
      "instanceOf":   "seed:sdlc-mini",
      "contextTreeId": "foundry-sdlc",
      "createdAt":    "2026-06-30T14:22:00Z",
      "nodeCount":    4,
      "statusCounts": { "done": 1, "claimed": 1, "blocked": 0, "queued": 2, "gatePending": 0 },
      "progress":     0.25         // done / nodeCount
    }
  ]
}
```

**Server logic:** list root nodes whose `metadata.treeRole === 'execution'`
(see §4.5 `InstanceCatalogPort`); for each, load the tree (`nodeCount`), fold its
charter event log (`foldCharterLifecycleState` → `statusCounts`, reusing the exact
`charter-status` derivation). Fail-soft: a tree whose log is unreadable contributes
zero counts, never a 500.

### 4.3 `POST /api/instances` — instantiate

Reconciles the sketch's `POST /api/instances/:deploymentId`: since deployments do
not exist yet, the **create source is an explicit `templateId` in the body**.
`:deploymentId` is the Phase-3 evolution (when a deployment exists, the body field
becomes `deploymentId`, resolving to a deployed blueprint version instead of a
seed; the rest of this handler is unchanged).

**Request:**
```jsonc
{
  "templateId":   "seed:sdlc-mini",   // required — 'seed:*' or 'draft:*'
  "name":         "Ship login",        // optional — metadata.instanceName
  "contextTreeId": "foundry-sdlc"       // optional — metadata.contextTreeId (from the :treeId route)
}
```

**Step-by-step (the handler):**

```typescript
// 1. Resolve the template → CharterBlueprint (404 TemplateNotFound if unknown)
const blueprint = await resolveTemplate(body.templateId);

// 2. (defensive) compile — surfaces malformed seeds before they hit the store
const verdict = compile(blueprint);
if (!verdict.ok) { res.status(422).json({ ok: false, error: 'template invalid', errors: verdict.errors }); return; }

// 3. generate → fresh PlanTree with remapped UUIDs; treeRootId === fresh root node id
const tree = generate(blueprint, { newId: randomUUID, tenantPackId });

// 4. Stamp instance metadata on the ROOT node (parentId === null) — ZERO kernel change
const root = tree.nodes.find(n => n.parentId === null)!;
const stampedRoot = { ...root, metadata: {
  ...root.metadata,
  treeRole:       'execution',
  instanceOf:     body.templateId,
  instanceName:   body.name ?? blueprint.name ?? body.templateId,
  contextTreeId:  body.contextTreeId ?? null,
  instantiatedAt: now(),
  // optional display polish: title ?? mission.objective for the board/frontier label
  title:          root.metadata['title'] ?? readCharter(root)?.mission.objective,
}};
const stampedTree = { ...tree, nodes: tree.nodes.map(n => n.id === root.id ? stampedRoot : n) };

// 5. Persist — THIS is what lights up the frontier/action loop
await planTreeStore.save(stampedTree);

// 6. Emit the initial audit event(s): for the root and every decomposable
//    parent that generate() already materialised with children, append a
//    charter:NodeDecomposed.v1 recording its childIds. This keeps the folded
//    lifecycle state faithful to the tree generate() produced.
for (const n of stampedTree.nodes) {
  if (n.childrenIds.length > 0) {
    charterEventLog.append(tree.treeRootId, {
      type: 'charter:NodeDecomposed.v1',
      nodeId: n.id,
      payload: { childIds: n.childrenIds },
      occurredAt: now(),
    });
  }
}

// 7. Respond
res.json({ ok: true, instanceId: tree.treeRootId, treeRootId: tree.treeRootId, rootNodeId: tree.treeRootId });
```

**Response:**
```jsonc
{ "ok": true, "instanceId": "f3a2…", "treeRootId": "f3a2…", "rootNodeId": "f3a2…" }
```
(`instanceId === treeRootId === rootNodeId` — the `generate()` invariant
*"treeRootId === root node id"*. One identity, three names for caller convenience.)

**On the `NodeDecomposed` event (step 6):** the frontier does **not** require it —
`charterFrontier` reads the tree structure directly, so a leaf seeded with
materialised children is claimable immediately. The event is the **audit record**
that instantiation decomposed the root, keeping the event log a complete history
(Invariant §7.3). Do **not** route this through `dispatchCharterAction('decompose-node')`
— that handler expects a *childless* parent and adds children; the tree already has
them. Append the event directly.

**Error / fail-soft:**

| Condition | Status | Body |
|---|---|---|
| unknown `templateId` | 404 | `{ ok: false, error: 'unknown template: <id>' }` |
| malformed seed (compile fails) | 422 | `{ ok: false, error: 'template invalid', errors: [...] }` |
| store/save failure | 500 | `{ ok: false, error: <message> }` |
| keyless **without** the §6/B2 fallback | 200 but inert | save is a no-op; frontier stays empty. **This is the gap the fallback closes.** |

### 4.4 `GET /api/instance/:instanceId` — load instance tree (for the board)

The Execute board needs the instance's **full node set** (not just the frontier).
Phase 1's frontier endpoint returns only frontier entries; this endpoint returns
the whole tree.

**Response:**
```jsonc
{ "ok": true, "treeRootId": "f3a2…", "nodes": [ /* PlanNode[] from planTreeStore.load() */ ] }
```
Returns `{ ok: true, treeRootId, nodes: [] }` (not 404) when the tree is absent, so
the board renders an empty state rather than erroring.

### 4.5 `InstanceCatalogPort` — listing without coupling to Prisma

`PlanTreeStore` (the substrate contract) is intentionally `load`/`save`/`applyEdit`
only — **no `list`**. Rather than widen that contract, inject a thin
listing port alongside it (keeps the router store-agnostic + unit-testable, and
keeps the substrate contract untouched):

```typescript
export interface InstanceCatalogPort {
  /** Root nodes (parentId === null) for the tenant, with their metadata. */
  listRoots(tenantPackId: string): Promise<Array<{ treeRootId: string; metadata: Record<string, unknown> }>>;
}
```

- **Keyed impl** (`PrismaInstanceCatalog`): mirrors the drafts list query —
  `prisma.planNode.findMany({ where: { tenantPackId, parentId: null, deletedAt: null }, select: { treeRootId: true, metadata: true } })`.
- **Keyless impl** (`InMemoryInstanceCatalog`): reads the roots out of the
  `InMemoryPlanTreeStore`'s map (§6/B2). One object can implement both
  `PlanTreeStore` and `InstanceCatalogPort` in the in-memory case.

`GET /api/instances` and the draft rows of `GET /api/templates` consume `listRoots`
and post-filter in JS (`metadata.treeRole === 'execution'` for instances; charter
roots for draft templates) — avoiding JSONB-path WHERE clauses.

---

## 5. Frontend

New/changed Angular surfaces in `domains/foundry/apps/cockpit`. Standalone
components, signals, `OnPush` — same conventions as Phase 1.

### 5.1 Shell — add the "Instances" pipeline tab

Phase 1's shell rendered only the **Execute** tab at Level 2. Add **Instances**
(cockpit-design §2.3 shows four tabs; Phase 2 lights up two of them):

```text
[ Instances ]  [ Execute ]      ← Draft / Deploy are Phase 3 (rendered disabled/ghost)
```

`cockpit-shell.component.ts`: add the `routerLink` for
`['/tree', treeId(), 'instances']`.

### 5.2 Instances page — `instances/instances.page.ts`

Route `/tree/:treeId/instances` (already present in cockpit-design §2.2).

- **On init:** `client.getInstances(treeId)` → table rows
  (`instanceId` short, template name, started, progress bar, status chips —
  reuses the `statusCounts` → chip mapping from the project card, cockpit-design §3.2).
- **"+ New instance" button** → opens a small dialog:
  - template picker populated by `client.getTemplates()`
  - optional name field
  - on confirm: `client.createInstance({ templateId, name, contextTreeId: treeId })`
    → on `{ ok: true, instanceId }` → `router.navigate(['/tree', treeId, 'execute', instanceId])`.
- **Row click** → `/tree/:treeId/execute/:instanceId`.
- **Empty state:** "No instances yet — create one from a template to start
  executing." with the New-instance button inline.

### 5.3 Instance picker in the Execute view

The slim bar above the three Execute zones (cockpit-design §4, "Instance picker"):

- Segmented control listing instances for the current `treeId`
  (`client.getInstances(treeId)`), the active one highlighted.
- "+ New Instance" on the right → same dialog as §5.2.
- Selecting an instance → `router.navigate(['/tree', treeId, 'execute', instanceId])`.

### 5.4 Execute page scoping — the key change

Phase 1's `ExecutePage` scoped the board/frontier to `:treeId` (the cascade tree).
**Phase 2 scopes everything to `:instanceId`** (the instance's `treeRootId`), which
the route already carries (`tree/:treeId/execute/:instanceId`):

| Surface | Phase 1 source | Phase 2 source |
|---|---|---|
| `LiveStatusService.start(...)` | `treeId` | **`instanceId`** (`GET /api/charter-status/:instanceId`) |
| Board nodes | cascade tree | **`GET /api/instance/:instanceId` → `nodes`** |
| Frontier | `GET /api/frontier/:treeId` | **`GET /api/frontier/:instanceId`** |
| Node detail | selected cascade node | selected instance node |
| Actions | `POST /api/action/:nodeId` `{ treeRootId: treeId }` | `{ treeRootId: instanceId }` |

`planTreeToRecipe(instanceNodes, liveStatus, selectedId)` is unchanged (it is the
pure adapter from cockpit-design §8 — it takes any `PlanNode[]`).

**No-instance state:** route `/tree/:treeId/execute` (no `:instanceId`) →
ExecutePage shows "Pick or create an instance to execute" and renders the picker
only. Optionally auto-select the most-recent instance (sort by `instantiatedAt`) —
flagged as OQ-5.

### 5.5 Client additions — `foundry-cockpit.client.ts`

```typescript
getTemplates(): Promise<TemplateSummary[]>                          // GET /api/templates
getInstances(contextTreeId?: string): Promise<InstanceSummary[]>   // GET /api/instances[?contextTreeId=]
createInstance(req: { templateId: string; name?: string; contextTreeId?: string })
  : Promise<{ instanceId: string } | null>                         // POST /api/instances
getInstanceTree(instanceId: string): Promise<CockpitPlanNode[]>    // GET /api/instance/:instanceId
```
Fail-soft like the existing client methods (catch → `[]` / `null`). New types
(`TemplateSummary`, `InstanceSummary`) added to `shared/cockpit-types.ts`.

---

## 6. Phasing / Task Shape

~14 tasks, backend before frontend. Each is TDD-shaped (failing test → impl →
typecheck → commit), matching the Phase-1 plan's task rhythm.

### Backend (charter trees into the store, endpoints, seeds)

- **B1 — Seed templates module.** `src/cockpit/seed-templates.ts`: `SEED_TEMPLATES`
  (`seed:sdlc-mini`, `seed:decompose-demo`) as `CharterBlueprint` constants +
  `resolveTemplate()`. Unit test: each seed `compile()`s clean; `generate()`
  produces a tree with a distinct `treeRootId`.
- **B2 — `InMemoryPlanTreeStore` + `InMemoryInstanceCatalog` (keyless fallback).**
  `src/cockpit/in-memory-plan-tree.store.ts`: a `Map<treeRootId, PlanTree>`
  implementing `PlanTreeStore` (`load`/`save`/`applyEdit`) **and**
  `InstanceCatalogPort` (`listRoots`). Unit test: save → load round-trip; listRoots
  returns saved roots.
- **B3 — `PrismaInstanceCatalog` (keyed).** Wraps the drafts-style
  `findMany(parentId: null)` query as `listRoots`. Unit/db test mirrors
  `foundry-prisma-plan-tree.store.db.spec.ts`.
- **B4 — `GET /api/templates`.** Seeds always; draft rows when a catalog is present.
- **B5 — `GET /api/instances`** (+ `?contextTreeId`): `listRoots` →
  filter `treeRole === 'execution'` → per-tree fold for `statusCounts` + `progress`.
- **B6 — `POST /api/instances`.** The §4.3 handler (resolve → compile → generate →
  stamp metadata → save → emit `NodeDecomposed`). Integration test: POST `seed:sdlc-mini`
  → `GET /api/frontier/:instanceId` returns the claimable leaves (the lights-up assertion).
- **B7 — `GET /api/instance/:instanceId`** (load tree nodes for the board).
- **B8 — Wire into `server.ts`.** Replace the null-stub: keyless →
  `InMemoryPlanTreeStore` + `InMemoryInstanceCatalog`; keyed →
  `FoundryPrismaPlanTreeStore` + `PrismaInstanceCatalog`. Extend `CockpitRouterDeps`
  with `instanceCatalog`. Existing `frontier`/`action` now non-empty in both modes.

### Frontend (Instances page, picker, Execute scoping)

- **F1 — Client + types.** §5.5 methods + `TemplateSummary`/`InstanceSummary`.
- **F2 — Shell tab.** Add the Instances pipeline tab (§5.1).
- **F3 — Instances page.** List table + progress/status chips + empty state (§5.2).
- **F4 — New-instance dialog.** Template picker + name + create + navigate (§5.2).
- **F5 — Instance picker bar** in Execute (§5.3).
- **F6 — Execute scoping to `:instanceId`** (§5.4) + no-instance empty state.

### Capstone (optional)

- **C1 — End-to-end test.** Instantiate `seed:sdlc-mini` → frontier non-empty →
  claim a `task` → release `done` → `GET /api/instances` `progress` advances.
  Asserts the closed loop across both new + Phase-1 endpoints.

**Total: 14 tasks (+1 capstone).** Backend B1–B8 can land before any frontend; F1–F6
depend only on B4–B8 being deployed at `:4555`.

---

## 7. Invariants

### 7.1 ZERO kernel change (ADR-176)
All instance/template linkage is `metadata` JSONB on the root node
(`treeRole`, `instanceOf`, `instanceName`, `contextTreeId`, `instantiatedAt`).
`generate()` writes only metadata. `PlanNode` schema, `PlanTreeStore` contract, and
`kernel.plan_node` are untouched. The new `InstanceCatalogPort` is a **layer port**
(foundry-side), not a kernel/substrate-contract change.

### 7.2 Fail-soft everywhere
Unknown template → 404; malformed seed → 422; store error → 500; the Angular client
catches every call → `[]`/`null`. The cockpit never crashes on a bad instance.

### 7.3 Complete audit trail
Every instantiation appends ≥1 `charter:NodeDecomposed.v1` to the `CharterEventLog`
(one per materialised decomposable node). Every subsequent action emits its
`CharterEvent` through `dispatchCharterAction`. No tree enters the store without a
corresponding event-log record of how it was decomposed — no silent creation.

### 7.4 One identity
`instanceId === treeRootId === root node id` (the `generate()` invariant). The
Instances list, the Execute route param, the frontier `treeRootId`, and the action
`treeRootId` are all the same string.

### 7.5 Instances are copies, not references
`generate()` remaps every node id to a fresh UUID and copies the contract. An
instance does not point into a shared template/deployment tree (Option A, §1.2).
Editing or deleting a seed template never mutates a live instance. Re-instantiating
is always disjoint and safe.

### 7.6 Cockpit stays read-only on the kernel directly
All reads/writes go through `:4555`. The cockpit Angular app never touches Postgres
or the event log directly.

---

## 8. Decisions Made (interim) + Open Questions for the Founder

Resolved as interim defaults (none are charter/business gates requiring a
`type/decision` issue — all are local architecture choices with a defensible
default; revisit if dogfooding signals otherwise):

| # | Decision | Default taken | Rationale |
|---|---|---|---|
| D1 | What an instance *is* | A fresh `generate()`d tree, identity = `treeRootId` (Option A) | Only model buildable on merged code; Phase-3-compatible (§1.2) |
| D2 | Create source (no Phase 3) | Explicit `templateId` (`seed:*` / `draft:*`), not `:deploymentId` | Deployments don't exist; `:deploymentId` is the Phase-3 evolution (§4.3) |
| D3 | Keyless-dev store | **Add `InMemoryPlanTreeStore` fallback** | Symmetric with the existing `InMemoryCharterEventLog`; without it the action loop never lights up in default local dev (§2.1) |
| D4 | Seed content | `seed:sdlc-mini` (claim/gate loop) + `seed:decompose-demo` (decompose action) | Two seeds exercise both frontier action types |

**Genuine open questions (founder input would sharpen the build):**

- **OQ-1 (durability posture).** Confirm the in-memory keyless fallback (D3) is the
  intended default — i.e. ephemeral instances are acceptable for the dogfooding inner
  loop — vs requiring Postgres + JWT so instances are always durable. *Interim: fallback on.*
- **OQ-2 (`:treeId` semantics).** In `/tree/:treeId/instances`, is `:treeId` the SDLC
  cascade/forest tree (so `contextTreeId` groups instances under the forest tree the
  founder is in), or a placeholder for a Phase-3 deployment lineage? Affects whether the
  `?contextTreeId` filter is load-bearing now or cosmetic. *Interim: forest/context tree.*
- **OQ-3 (tenant identity).** All keyless instances share
  `COCKPIT_TENANT_PACK_ID='foundry-default'`. Confirm no per-instance tenant isolation is
  needed pre-Phase-3. *Interim: single shared tenant.*
- **OQ-4 (retirement).** No `DELETE /api/instances/:id` in Phase 2 — instances accumulate.
  Defer a retire/archive verb to a follow-on, or include it now? *Interim: defer.*
- **OQ-5 (auto-select).** On `/tree/:treeId/execute` with no `:instanceId`, auto-select
  the most-recent instance, or always force an explicit pick? *Interim: explicit pick with
  an empty-state prompt.*

---

## 9. Hand-off Notes for the Implementer

- **Read first:** ADR-176 (kernel minimality — why everything is `metadata`), the
  Phase-1 plan (`2026-06-30-foundry-cockpit-phase1.md`) for the cockpit router /
  client / `LiveStatusService` patterns this builds on.
- **Files to create:** `src/cockpit/seed-templates.ts`,
  `src/cockpit/in-memory-plan-tree.store.ts`, `src/cockpit/instance-catalog.ts`
  (`InstanceCatalogPort` + `PrismaInstanceCatalog`); cockpit app
  `instances/instances.page.ts`, the new-instance dialog, the Execute picker bar.
- **Files to modify:** `src/cockpit/cockpit.router.ts` (4 new endpoints +
  `instanceCatalog` in `CockpitRouterDeps`), `src/dashboard/server.ts` (replace the
  null-stub with the mode-appropriate store + catalog), cockpit app
  `app.routes.ts`/shell (Instances tab), `execute/execute.page.ts` (scope to
  `:instanceId`), `shared/foundry-cockpit.client.ts` + `shared/cockpit-types.ts`.
- **charter-runtime calls used (all already exported):** `generate`, `compile`,
  `extract`, `foldCharterLifecycleState`, `charterFrontier`, `readCharter`,
  `CharterEvent`/`CharterBlueprint` types. No charter-runtime change required.
- **Acceptance (the lights-up gate):** with the server running keyless,
  `POST /api/instances {templateId:'seed:sdlc-mini'}` returns an `instanceId`;
  `GET /api/frontier/<instanceId>` returns ≥1 claimable entry; `POST /api/action/<leafNodeId>`
  `{treeRootId:<instanceId>,action:'claim'}` returns `{ok:true, events:[NodeClaimed.v1]}`;
  the next `GET /api/charter-status/<instanceId>` shows that node `claimed`.
- **Out of scope (Phase 3):** Deploy tab, durable `BlueprintStore`, deployment
  versioning, `:deploymentId` create source, instance retirement, multi-tenant
  instance isolation.
```
