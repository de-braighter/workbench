---
title: "Foundry Cockpit — Design Spec"
date: 2026-06-30
status: draft
authors: [founder]
adr: reserved
tags: [cockpit, foundry, plan-tree, charter, execute, blueprint, svg-board]
---

# Foundry Cockpit — Design Spec

The foundry cockpit is the foundry domain's own face: a unified Angular application where founders draft blueprints, deploy them to the substrate, instantiate live runs, and drive execution. It is the hydra head that runs itself — the foundry modelling and executing its own SDLC on the same substrate it builds.

**Context:** `docs/superpowers/specs/2026-06-30-hydra-factory-vision.md` — the working paper this spec implements.

---

## 1. What We Are Building

A new Angular application at `domains/foundry/apps/cockpit`, served alongside the existing foundry Express server (`:4555`). Not a panel inside `domains/studio` — the studio is the generic head-designer for authoring any domain's plan trees; the cockpit is specifically the foundry's own execution surface.

**Two navigation levels:**

- **Level 1 — Project home** (`/`): the forest. Shows all plan trees for the foundry domain with aggregated health status. The founder's landing screen.
- **Level 2 — Pipeline** (`/tree/:treeId/*`): four-tab lifecycle view (Draft → Deploy → Instances → Execute) for one specific plan tree. Reached by clicking a tree card on the project home.

**The unit flowing through the pipeline:** Blueprint (designed) → Deployed Tree (in `kernel.plan_node`) → Instance (live run) → Active Execution (frontier + event log).

---

## 2. App Architecture

### 2.1 Repository Location

```
domains/foundry/
  apps/
    cockpit/                    ← new Nx Angular app
      src/app/
        shell/
          cockpit-shell.component.ts
        project/
          project.page.ts       ← Level 1: forest home
        draft/
          draft.page.ts         ← blueprint list + node-list editor
        deploy/
          deploy.page.ts        ← deployment history + one-way door
        instances/
          instances.page.ts     ← live instances list + instantiate
        execute/
          execute.page.ts       ← SVG board + frontier + node detail
        shared/
          foundry.client.ts     ← all HTTP to :4555
          plan-tree-recipe.ts   ← planTreeToRecipe() pure adapter
          live-status.service.ts ← 5s poll (component-provided)
```

Standalone components, Angular signals throughout. Same Nx + Angular stack as `domains/studio/apps/studio-ui`. Packages imported via npm — no code forked from studio.

### 2.2 Routes

```
/                              → ProjectPage          (home, default)
/tree/:treeId/draft            → DraftPage
/tree/:treeId/deploy           → DeployPage
/tree/:treeId/instances        → InstancesPage
/tree/:treeId/execute          → ExecutePage          (active instance)
/tree/:treeId/execute/:id      → ExecutePage          (specific instance)
/tree/new/draft                → DraftPage            (new blueprint, treeRole pre-set)
```

### 2.3 Shell Behaviour

At Level 1: cockpit header only, no pipeline tabs.

At Level 2: a breadcrumb appears (`Project › SDLC Tree`) and four pipeline tabs slide in below the header. Back arrow returns to project home.

```
┌─────────────────────────────────────────────────────┐
│  🐉 Foundry Cockpit           [Project › SDLC Tree] │
│  [ Draft ]  [ Deploy ]  [ Instances ]  [ Execute ]  │
│─────────────────────────────────────────────────────│
│                  <router-outlet>                     │
└─────────────────────────────────────────────────────┘
```

### 2.4 Dev Setup

Cockpit served at `:4201`. Foundry Express server stays at `:4555`. Cockpit talks directly to `:4555` — no proxy.

### 2.5 Shared Services

**`FoundryCockpitClient`** — single Angular injectable. All HTTP to `:4555`. Typed request/response shapes. Fail-soft (catch → `null`, caller handles).

**`LiveStatusService`** — component-provided (scoped to Execute page lifecycle). `setInterval(5000)` → `GET /api/item-status` → `statuses` signal. Immediate first poll on `ngOnInit`, cleared on `ngOnDestroy`.

---

## 3. Project View (Level 1 — Forest Home)

The landing screen. Two zones:

### 3.1 Attention Bar

Horizontal strip at the top. Aggregated counts across ALL trees for the foundry domain:

```
⊙ 2 gates pending   ● 5 nodes claimed   ✕ 1 blocked   ✓ 34 done this week
```

Each badge is a link — navigates directly to the relevant tree's Execute tab filtered to that state. Clicking "2 gates pending" opens the tree with the gate + scrolls frontier to gate nodes.

Derived from `GET /api/trees` response (status counts pre-aggregated server-side).

### 3.2 Tree Cards Grid

One card per plan tree root in `kernel.plan_node` for the foundry domain (`metadata.treeRole` present on root node). Layout: responsive grid, 2–3 columns.

**Card anatomy:**

```
┌─────────────────────────────┐
│ [sdlc]          SDLC Tree   │
│ 31 nodes                    │
│ ████████░░  68% done        │
│ 2 claimed · 1 gate ⊙        │
│ Last activity: 4m ago       │
└─────────────────────────────┘
```

- `treeRole` badge (colour-coded: sdlc=blue, features=violet, knowledge=amber, ops=red, roadmap=green, governance=grey)
- Progress bar: done / total nodes
- Status chips: claimed count, gate count (pulsing `⊙` if any gate pending)
- Last event timestamp from `CharterEventLog`

**Click behaviour:**
- Active execution (any claimed node) → `/tree/:id/execute`
- Gate pending → `/tree/:id/execute` (frontier pre-filtered to gates)
- No active execution → `/tree/:id/deploy`
- Ghost card (no tree for this role yet) → `/tree/new/draft?treeRole=<role>`

**Ghost cards** — shown for roles with no tree yet (`knowledge`, `ops`, `roadmap`, `governance` for the foundry domain). Renders as a dashed-border card with "+ Create blueprint" label.

**"+ New Blueprint" button** — top-right of grid. Opens `/tree/new/draft`.

### 3.3 New Backend Endpoint

`GET /api/trees` — returns all root `PlanNode`s for the foundry domain with pre-aggregated status:

```typescript
{
  ok: true,
  trees: Array<{
    node: PlanNode,           // root node (parentId: null)
    treeRole: string,         // from metadata.treeRole
    nodeCount: number,
    statusCounts: {
      done: number,
      claimed: number,
      blocked: number,
      queued: number,
      gatePending: number
    },
    lastActivityAt: string    // ISO timestamp of most recent CharterEvent
  }>
}
```

Server-side: `buildCascadeTree(FOUNDRY_PRODUCT)` already builds the tree; `buildStatusByItemId` already folds the log. This endpoint wraps both with a `treeRole` group and count aggregation.

---

## 4. Execute View (Level 2 — Power Panel)

The primary work surface. Three zones:

```
┌──────────────────┬────────────────────────────────────┬──────────────────┐
│   FRONTIER       │           SVG BOARD                │   NODE DETAIL    │
│   280px fixed    │           flex-grow                │   320px slide-in │
└──────────────────┴────────────────────────────────────┴──────────────────┘
```

**Instance picker** — slim bar above the three zones. If multiple instances exist: segmented control to switch between them. "+ New Instance" button on the right.

### 4.1 Frontier Panel (left, 280px)

Lists nodes from `charterFrontier` for the active instance. Refreshes every 5s via `LiveStatusService`.

Each entry:
- `executionMode` icon (⚙/✦/⊙) — left-aligned
- Node title — truncated to one line
- Kind badge — right-aligned
- Human gate nodes (`executionMode: 'human'`) float to the top

Clicking an entry: selects the node (highlights in SVG board, opens detail panel).

Empty state: "No actionable nodes — all items done or waiting on upstream dependencies."

### 4.2 SVG Board (centre, flex-grow)

`planTreeToRecipe(nodes, liveStatus, selectedId)` → `EditorRecipe` → `ds-board-kit` tree-renderer.

Computed signal — re-runs on every `LiveStatusService` tick. Board component receives the recipe signal as `@Input()`.

Features: pan, zoom, click to select node. Read-only in MVP (no drag-drop, no inline edit).

See §6 for the full adapter specification.

### 4.3 Node Detail Panel (right, 320px, slide-in)

Appears when a node is selected. Hidden by default.

**Content:**
- Title, kind, `treeRole` badge
- `executionMode` badge (labelled: "Script ⚙" / "AI ✦" / "Human ⊙" / "Hybrid ⚙✦")
- `scriptRef` field — read-only, shown only for `deterministic` mode
- Charter contract section (collapsible): mission, scope, autonomy, quality
- Status + last event timestamp
- `metadata` fields via `toDetailFields()` (reuse the pattern from studio#131)

**Action buttons — context-sensitive:**

| Node state | Buttons shown |
|---|---|
| `queued` | **[ Claim ]** |
| `claimed` | **[ Release ]** · **[ Request Gate ]** |
| `gate-pending` | **[ Approve ]** · **[ Reject ]** |
| `done` | — (read-only, shows resolution + timestamp) |
| `blocked` | — (read-only, shows block reason) |

Phase 1 treats the cockpit as a single-founder tool — no multi-user claim ownership distinction. Any claimed node shows Release. Multi-user claim identity is a Phase 3+ concern.

All actions call `POST /api/action/:nodeId` with `{ action, decision? }`.

### 4.4 New Backend Endpoints

`GET /api/frontier/:instanceId` — returns `charterFrontier` nodes (calls `charterFrontier(state)` with the folded log state).

`POST /api/action/:nodeId` — unified action endpoint:
```typescript
body: { action: 'claim' | 'release' | 'request-gate' | 'decide-gate', decision?: 'approved' | 'rejected' }
response: { ok: boolean, event: CharterEvent }
```
Calls `conductCharterStep` server-side, persists event to `FileCharterEventLog` (S3), responds with the emitted event.

---

## 5. Draft Tab

### 5.1 Blueprint List (left panel)

Cards for each blueprint in `BlueprintStore`:
- Name, version, status (`draft` / `ready`), node count, last modified
- "Preview in Board" → renders `planTreeToRecipe()` on draft nodes, opens a modal with the SVG board (read-only, no live status)
- "Deploy →" button — appears only when status is `ready`, navigates to Deploy tab with this blueprint pre-selected

"+ New Blueprint" button at top — creates empty blueprint, selects it for editing.

### 5.2 Blueprint Editor (right panel)

Structured node-list editor. No drag-drop in MVP — indented list with up/down reorder arrows.

Per node:
- `kind` dropdown (all registered kinds from `GET /api/kinds` — wraps `gen_list_kinds` logic server-side)
- Title text field
- `executionMode` dropdown: `deterministic | ai | human | hybrid`
- `scriptRef` text field (visible only when `deterministic`)
- Charter contract (collapsible): mission textarea, scope text, autonomy level dropdown (advisory / bounded / autonomous), quality text
- "+ Add child" button · "Delete" button

**Validation:** a blueprint is `ready` when all nodes have a kind + title and no `deterministic` node has an empty `scriptRef`.

### 5.3 New Endpoints

`GET /api/kinds` — returns registered generation kinds (wraps the `gen_list_kinds` + `gen_list_coregen_kinds` logic). Used by the Draft editor kind dropdown.

`GET /api/blueprints` · `POST /api/blueprints` · `PUT /api/blueprints/:id` — CRUD on `BlueprintStore`.

---

## 6. Deploy Tab

Table of deployments for the selected tree:

| Version | Deployed | Nodes | Status |
|---|---|---|---|
| v3 | 2026-06-30 14:22 | 31 | active |
| v2 | 2026-06-28 09:11 | 28 | superseded |

**"Deploy New Version" button** — top-right:
1. Select blueprint (picker from `BlueprintStore`)
2. Confirmation dialog — shows node diff vs previous deployment (added/removed/changed nodes)
3. On confirm: `compile(blueprint) → generate(compiled) → PlanTreeStore.save()`
4. Deployment is immutable — no edit, only new version

"Create Instance →" button per row — navigates to Instances tab with this deployment pre-selected.

### New Endpoints

`POST /api/deploy` — body: `{ blueprintId }` → calls `compile` → `generate` → `store.save()` → returns new deployment record.

---

## 7. Instances Tab

Table of instances for the selected tree:

| Instance | Blueprint | Started | Progress | Status |
|---|---|---|---|---|
| `abc12` | v3 | 2026-06-30 | ████░░  68% | active |
| `def45` | v2 | 2026-06-28 | ██████ 100% | done |

**"+ New Instance" button** — top-right:
1. Select deployment (defaults to latest)
2. On confirm: stamps blueprint version, assigns `rootNodeId`, emits initial `NodeDecomposed` events for root node → navigates to `/tree/:id/execute/:instanceId`

Clicking any row → `/tree/:id/execute/:instanceId`.

### New Endpoints

`GET /api/instances/:treeId` — list instances for a tree.
`POST /api/instances/:deploymentId` — instantiate: returns `{ instanceId, rootNodeId }`.

---

## 8. `planTreeToRecipe()` Adapter

**Location:** `apps/cockpit/src/app/shared/plan-tree-recipe.ts`

**Signature:**
```typescript
export function planTreeToRecipe(
  nodes: PlanNode[],
  liveStatus: Record<string, ItemStatus> = {},
  selectedId?: string
): EditorRecipe
```

Pure function. No side effects. No Angular dependencies. Unit-testable with snapshot assertions — no DOM, no browser.

**Layout algorithm (MVP):** level-based.
1. BFS from root node to assign `depth` to each node
2. Group nodes by depth
3. `y = depth * Y_STEP` (e.g., 120px)
4. `x = columnIndex * X_STEP` centred within depth group (e.g., 160px)

Upgrade path: dagre layout in a follow-on PR when trees grow wide.

**Node kind → recipe shape:**

| Kind pattern | Shape | Size |
|---|---|---|
| `product` / `system` | Large rounded rect (header) | 200×60 |
| `capability` / `feature` | Rounded rect | 160×48 |
| `work-item` / `intervention` | Compact pill | 140×36 |
| `gate.*` | Diamond | 80×80 |
| `knowledge.*` | Folded-corner rect | 140×40 |
| `ops.*` | Hexagon | 80×80 |
| _fallback_ | Rounded rect | 140×40 |

**Fill colour from `liveStatus[node.id]`:**

| Status | Fill | Border |
|---|---|---|
| `done` | `--color-success-fill` | none |
| `claimed` | `--color-info-fill` | pulsing `--color-info` |
| `blocked` | `--color-danger-fill` | none |
| `gate-pending` | `--color-warning-fill` | pulsing `--color-warning` |
| `queued` | `--color-neutral-fill` | none |
| `retired` | `--color-neutral-fill` dimmed | none |
| absent | `--color-neutral-fill` | none |

**`executionMode` icon overlay** — bottom-right corner, 16×16px:
- `deterministic` → ⚙ · `ai` → ✦ · `human` → ⊙ · `hybrid` → ⚙✦ · absent → nothing

**Connectors:**
- `node.parentId` → solid connector (structural tree edge, `--color-neutral-border`)
- `node.metadata.relatedNodeId` → dashed connector (cross-tree reference, `--color-info` dashed)

**Selected node** (`selectedId === node.id`) → 3px highlight ring in `--color-primary`.

**Usage in Execute page:**
```typescript
readonly recipe = computed(() =>
  planTreeToRecipe(
    this.nodes(),
    this.liveStatus.statuses(),
    this.selectedNodeId()
  )
);
```

---

## 9. `executionMode` — Cockpit Perspective

The cockpit consumes `executionMode` for display and routing of action buttons. The runtime routing (how `conductCharterStep` dispatches based on mode) is a `charter-runtime` concern — specified in a separate charter-runtime addendum (Phase 4 spec).

**Field location:** `PlanNode.metadata.charter.executionMode: 'deterministic' | 'ai' | 'human' | 'hybrid'`

**Cockpit rendering:**
- SVG board: `executionMode` icon overlay on each node (§8)
- Frontier panel: icon left of each entry title
- Node detail: labelled badge + `scriptRef` field when `deterministic`
- Action buttons: mode-appropriate set (§4.3 table)
- Draft editor: `executionMode` dropdown + conditional `scriptRef` field per node (§5.2)

**Blueprint authoring — default:** when `executionMode` is absent on a node, the cockpit treats it as `ai` (matching the current foundry behaviour). Authors must explicitly set `deterministic` to opt into script execution.

---

## 10. Phasing

### Phase 1 — Foundation + Execute _(no S4 dependency)_

- New Nx Angular app scaffold at `domains/foundry/apps/cockpit`
- Shell + two-level routing
- Project view: `GET /api/trees` endpoint + attention bar + tree cards grid
- Execute view: `planTreeToRecipe()` adapter + `ds-board-kit` SVG board + frontier panel + node detail panel + action buttons
- `POST /api/action/:nodeId` unified action endpoint
- `LiveStatusService` (5s poll)

Deliverable: **visual execution dashboard** — the founder can see the full plan tree as an SVG diagram, see what's claimable, claim/release/gate nodes from the UI.

### Phase 2 — Instances

- Instances tab: list + create instance + instance-scoped execute
- `GET /api/instances/:treeId` · `POST /api/instances/:deploymentId`
- Instance picker in Execute view
- Initial `NodeDecomposed` event emission on instantiation

Deliverable: **multi-instance management** — manage parallel execution runs.

### Phase 3 — Deploy + Draft _(needs S4 durable `BlueprintStore`)_

Prerequisite: S4 (`BlueprintStore` Postgres adapter + JWT auth on foundry server).

- Deploy tab: deployment table + one-way door (`compile → generate → store.save()`)
- Draft tab: blueprint node-list editor + "Preview in Board"
- Blueprint CRUD endpoints

Deliverable: **full authoring pipeline** — design → deploy → instantiate → execute entirely within the cockpit.

### Phase 4 — `executionMode` + `ScriptWorker` _(charter-runtime track)_

Separate charter-runtime addendum spec. Runs in parallel with Phase 2.

- `executionMode` field in `CharterNode` schema
- `ScriptWorker` registry pattern in `charter-runtime`
- `ACTION_REGISTRY` routing update in `conductCharterStep`
- Cockpit already renders icons and mode-appropriate buttons (§9) — no cockpit change needed in this phase

Deliverable: **deterministic execution** — script-backed nodes execute without spawning Claude workers.

### Prerequisite Chain

```
Phase 1 (standalone — no external prereqs)
  └─ Phase 2 (needs Phase 1 app)
       └─ Phase 3 (needs S4 durable store + Phase 2)
Phase 4 (independent — charter-runtime track, parallel with Phase 2)
```

---

## 11. Invariants

- **ZERO kernel change.** `executionMode`, `treeRole`, `scriptRef` all live in `metadata.JSONB`. `PlanNode` schema is untouched.
- **Cockpit is read-only on the kernel directly.** All reads/writes go through the foundry Express server (`:4555`) which owns the `CharterEventLog` and `PlanTreeStore` connections.
- **Audit trail preserved.** Every cockpit action emits a `CharterEvent` — no silent fast-paths. The `ScriptWorker` adapter holds a proper claim/release lifecycle even for deterministic steps.
- **`planTreeToRecipe()` is pure.** No side effects, no Angular dependencies. Can be tested with vitest without a DOM.
- **Phase 1 ships without S4.** The cockpit reads and drives execution on trees already in the substrate. Draft/Deploy tabs and durable blueprints are Phase 3.
