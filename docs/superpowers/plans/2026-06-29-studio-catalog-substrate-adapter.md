# Plan: Studio Catalog Substrate Adapter + Plan-Tree Panel

**Date:** 2026-06-29  
**Status:** ready-to-execute  
**Context:** the foundry SDLC cascade tree (31 nodes) is now persisted to `kernel.plan_node`
(treeRootId `1242e9ed-a7cb-503f-9140-95056781545d`). These two sequential tasks wire it into
the studio: first expose it via HTTP from the foundry server, then replace the studio's
localStorage `CatalogPersistencePort` with an adapter that reads from that endpoint and add a
live plan-tree panel.

---

## Global Constraints (bind both tasks)

- **ZERO kernel change** — no `kernel.*` schema mutations, no new substrate-contracts version
- **ZERO design-system change** — no new bricks, no DS tokens added
- **ADR-176 compliant** — studio writes no kernel concept; read-only via HTTP
- **`CatalogPersistencePort` seam** — consuming surfaces (`InMemoryCatalogStore`,
  `PersistentCatalogStore`, the shell) never change; the adapter swaps in via the DI token
- TypeScript strict, Vitest passing — typecheck + test must be clean after each task
- Foundry server remains MCP-compatible — existing `/api/*` routes are NOT broken

---

## Repos + entry points

| Repo | Local path |
|---|---|
| `de-braighter/foundry` | `D:/development/projects/de-braighter/domains/foundry` |
| `de-braighter/studio` | `D:/development/projects/de-braighter/domains/studio` |

---

## Task 1 — Foundry: add `GET /api/catalog` and `GET /api/plan-tree` endpoints

**Repo:** `domains/foundry`  
**Branch:** `feat/foundry-studio-catalog-endpoints` from `main`  
**Record base SHA before starting.**

### Context

`domains/foundry/src/dashboard/server.ts` is a plain Node `http.createServer` with manual
`if (req.method === 'GET' && req.url === '/foo')` routing. `buildCascadeTree(FOUNDRY_PRODUCT)`
is already imported and its result (`models.foundry`) is available at startup. The `deps`
parameter passed to `startDashboardServer` is `ops.FoundryDeps`; the store lives at
`deps.store` (optional: `PlanTreeStore | undefined`).

### Files to touch

| File | Change |
|---|---|
| `src/dashboard/server.ts` | add two new GET routes (after existing routes, before the 404 fallback) |
| `src/dashboard/catalog-mapper.ts` | NEW — `mapNodesToCatalog(nodes: PlanNode[]): Catalog` pure function |
| `src/dashboard/catalog-mapper.spec.ts` | NEW — unit tests for the mapper |

**Do NOT touch** `src/mcp/`, `src/plan/cascade.ts`, `src/instances/`, or any other file.

### `GET /api/catalog`

1. Try to read the live cascade tree from the DB:
   ```
   treeRootId = buildCascadeTree(FOUNDRY_PRODUCT).treeRootId
   // (deterministic — same as the persisted tree)
   
   let nodes: PlanNode[]
   if (deps.store) {
     const tree = await deps.store.load(treeRootId)  // or equivalent read method
     nodes = tree?.nodes ?? []
   } else {
     nodes = []
   }
   ```
   If the store is unavailable or loading fails, fall back to `nodes = []` (no throw —
   the studio treats an empty catalog as a first-run seed).

   > **Implementer note:** inspect `PlanTreeStore` (from `@de-braighter/substrate-contracts`)
   > to find the correct read method signature — it may be `.load(treeRootId)` or `.findByRoot(treeRootId)`.
   > If there is no read method on the store (PrismaPlanTreeStore is write-only in Phase 7),
   > read directly via `prisma.planNode.findMany({ where: { treeRootId } })` using the same
   > lazy Prisma import pattern already in `server.ts`. Check the imports at the top of
   > `server.ts` to see what's already lazy-imported.

2. Map nodes → Catalog via `mapNodesToCatalog(nodes)` (see mapper below).

3. Return JSON:
   ```json
   { "ok": true, "catalog": { "systems": [...], ... } }
   ```
   With CORS header `Access-Control-Allow-Origin: http://localhost:4200` (same pattern as
   existing routes in server.ts).

### `GET /api/plan-tree`

Returns the raw plan nodes for the studio panel viewer:
```json
{ "ok": true, "treeRootId": "1242e9ed-...", "nodes": [ ... ] }
```
Same DB-read logic as above. If no DB or empty tree: `{ "ok": true, "treeRootId": null, "nodes": [] }`.

### `catalog-mapper.ts` — `mapNodesToCatalog`

**Catalog shape** (from `domains/studio/apps/studio-ui/src/app/metamodel/item-shapes.ts`):
```typescript
interface Catalog {
  systems: SystemItem[];
  subjects: SubjectItem[];
  phases: PhaseItem[];
  capabilities: CapabilityItem[];
  traits: TraitItem[];
  interventions: InterventionItem[];
  resources: ResourceItem[];
  actions: ActionItem[];
}
```

**Mapping rule** (by `PlanNode.kind`):

| `kind` | target library | catalog item type |
|---|---|---|
| `'product'` | `systems` | `SystemItem` |
| `'capability'` | `capabilities` | `CapabilityItem` |
| `'feature'` | `phases` | `PhaseItem` |
| `'work-item'` | `interventions` | `InterventionItem` |
| anything else | ignored | — |

**`CatalogItemBase` fields** (`id`, `name`, `domain`, `desc`, `visibility`):
- `id` → `node.id`
- `name` → `node.title`
- `domain` → `'foundry'`
- `desc` → `(node.metadata as any)?.description ?? ''` (safe cast — metadata is JSONB)
- `visibility` → `'private'`

**Extra fields per type** (use empty/stub defaults — the catalog renders fine):
- `SystemItem.root` → stub: `{ id: node.id, kind: 'epic', title: node.title, children: [], effectDeclarations: [] }` (the SystemNode shape — read `item-shapes.ts` for the exact interface)
- `CapabilityItem.inputs` → `[]`; `CapabilityItem.usedIn` → `[]`
- `PhaseItem.meta` → `''`; `PhaseItem.usedIn` → `[]`; `PhaseItem.conditions` → `[]`
- `InterventionItem.changes` → `[]`; `InterventionItem.needs` → `[]`; `InterventionItem.usedIn` → `[]`

The mapper must NOT import from `domains/studio/` — define the Catalog type inline in
`catalog-mapper.ts` (a local structural twin of the four item shapes needed), OR accept and
return plain `Record<string, unknown[]>` and let the server cast. The studio's Catalog type
lives in a different repo and cannot be imported here.

**Simplest approach:** define minimal local interfaces that structurally match what the studio
expects for the four mapped libraries, return as `{ systems, subjects, phases, capabilities,
traits, interventions, resources, actions }` with empty arrays for unmapped libraries.

### Tests for catalog-mapper.spec.ts

1. **Empty nodes → empty catalog** — all eight arrays are empty
2. **Mixed nodes → correct buckets** — feed 1 product node + 2 capability nodes + 1 feature
   node + 3 work-item nodes → `systems.length === 1`, `capabilities.length === 2`,
   `phases.length === 1`, `interventions.length === 3`
3. **Unknown kind is ignored** — a node with `kind: 'gate'` does not appear in any library
4. **Name/domain/desc mapping** — verify `systems[0].name === node.title`, `domain === 'foundry'`

### Commit message

```
feat(studio-catalog-endpoints): add GET /api/catalog and /api/plan-tree to foundry dashboard server
```

---

## Task 2 — Studio: `SubstrateCatalogPersistence` + `/plan-tree` panel

**Repo:** `domains/studio`  
**Branch:** `feat/studio-catalog-substrate` from `main`  
**Prerequisite:** Task 1 merged; foundry server running at `localhost:4555`.  
**Record base SHA before starting.**

### Part A — `SubstrateCatalogPersistence`

**New file:** `apps/studio-ui/src/app/metamodel/substrate-catalog-persistence.ts`

```typescript
import { Injectable } from '@angular/core';
import type { CatalogPersistencePort } from './catalog-persistence';
import type { Catalog } from './catalog';

@Injectable()
export class SubstrateCatalogPersistence implements CatalogPersistencePort {
  private readonly baseUrl = 'http://localhost:4555';

  async load(): Promise<Catalog | null> {
    try {
      const r = await fetch(`${this.baseUrl}/api/catalog`);
      if (!r.ok) return null;
      const body = (await r.json()) as { ok: boolean; catalog?: Catalog };
      return body.ok && body.catalog ? body.catalog : null;
    } catch {
      return null;
    }
  }

  // Phase 1: read-only — no write-back to substrate yet (catalog is authored in studio,
  // then explicitly persisted via gen_persist_sdlc_tree from the cockpit).
  async save(_catalog: Catalog): Promise<void> {}

  async clear(): Promise<void> {}
}
```

**Export it** from `apps/studio-ui/src/app/metamodel/index.ts` (find the barrel file and add
the export alongside `LocalStorageCatalogPersistence`).

**Wire it in `apps/studio-ui/src/app/app.config.ts`** — replace the `LocalStorageCatalogPersistence`
provider with `SubstrateCatalogPersistence`:

```typescript
// Before:
{ provide: CATALOG_PERSISTENCE, useFactory: () => new LocalStorageCatalogPersistence() },

// After:
{ provide: CATALOG_PERSISTENCE, useFactory: () => new SubstrateCatalogPersistence() },
```

The comment above this line in `app.config.ts` already says "A future HTTP/SubstrateClient
adapter swaps in here with no consuming-surface change." — this is exactly that swap.

**Keep `LocalStorageCatalogPersistence` in the codebase** — it is used in tests and may be
re-enabled. Do NOT delete it.

### Part A — Tests

New file: `apps/studio-ui/src/app/metamodel/substrate-catalog-persistence.spec.ts`

Use `vi.stubGlobal('fetch', vi.fn(...))` (or equivalent Vitest fetch mock) to mock
`window.fetch`.

1. **load() — success path**: mock fetch returns `{ ok: true, catalog: { systems: [...], ... } }`
   → `load()` resolves to the catalog
2. **load() — HTTP error (4xx/5xx)**: mock fetch returns `Response` with `ok: false`
   → `load()` resolves to `null`
3. **load() — network error**: mock fetch throws → `load()` resolves to `null` (never throws)
4. **save() — no-op**: `save(catalog)` resolves `undefined` without calling fetch
5. **clear() — no-op**: `clear()` resolves `undefined` without calling fetch

### Part B — `/plan-tree` panel

**New files:**
- `apps/studio-ui/src/app/plan-tree/plan-tree-panel.component.ts`
- `apps/studio-ui/src/app/plan-tree/plan-tree-panel.component.html`
- `apps/studio-ui/src/app/plan-tree/plan-tree-panel.component.spec.ts`

**Route:** add to `apps/studio-ui/src/app/app.routes.ts`:
```typescript
{ path: 'plan-tree', loadComponent: () => import('./plan-tree/plan-tree-panel.component').then(m => m.PlanTreePanelComponent) }
```

**Nav link:** add a "Plan tree" link to the main navigation (read the current nav component —
grep for the `/operate` or `/model` links to find it — and add a sibling link to `/plan-tree`).

**Component logic:**
```typescript
@Component({ standalone: true, ... })
export class PlanTreePanelComponent {
  protected nodes = signal<PlanNode[]>([]);
  protected loading = signal(true);
  protected error = signal<string | null>(null);

  constructor() {
    void fetch('http://localhost:4555/api/plan-tree')
      .then(r => r.json())
      .then((body: { ok: boolean; nodes?: PlanNode[] }) => {
        this.nodes.set(body.nodes ?? []);
      })
      .catch(() => this.error.set('Could not reach foundry server'))
      .finally(() => this.loading.set(false));
  }
}
```

**Component template** — render a nested tree list. Do NOT use `<ds-board-kit>` (the board-kit
tree renderer is designed for board-game surfaces; a simple Angular `@for` tree fits better
here). Render:

```html
@if (loading()) {
  <p>Loading plan tree…</p>
} @else if (error()) {
  <p class="error">{{ error() }}</p>
} @else {
  <ul class="plan-tree">
    @for (node of nodes(); track node.id) {
      <li [attr.data-kind]="node.kind">
        <span class="node-kind">{{ node.kind }}</span>
        <span class="node-title">{{ node.title }}</span>
        @if (node.parentId) {
          <span class="node-parent">↑ {{ node.parentId | slice:0:8 }}</span>
        }
      </li>
    }
  </ul>
}
```

Style with existing CSS design tokens — no new tokens. Use `--ink-1`, `--bg-1`, existing
spacing variables (check `apps/studio-ui/src/` for the current global stylesheet to see what
tokens are available).

**PlanNode type** — import from `@de-braighter/substrate-contracts` (already a dep in the
studio; check `apps/studio-ui/package.json` or `domains/studio/package.json`). If not a direct
dep, define a local minimal interface:
```typescript
interface PlanNode { id: string; parentId: string | null; treeRootId: string; kind: string; title: string; }
```

### Part B — Tests

`plan-tree-panel.component.spec.ts` with `TestBed`:
1. **Loading state** — before fetch resolves, template shows "Loading plan tree…"
2. **Success** — mock fetch resolves with `{ ok: true, nodes: [{ id: '1', ... }] }` → node list renders
3. **Error** — mock fetch rejects → error message shows

### Commit message

```
feat(studio-catalog-substrate): SubstrateCatalogPersistence adapter + plan-tree panel
```

---

## Known gotchas

- **`PlanTreeStore.load`** — `PrismaPlanTreeStore` in Phase 7 only had `save()` and `findAll()`
  (or similar). If there's no `load(treeRootId)` method, use `prisma.planNode.findMany` directly
  with the lazy-import pattern already in `server.ts` (look for `const { PrismaClient }` or
  similar lazy import). The treeRootId is deterministic: `buildCascadeTree(FOUNDRY_PRODUCT).treeRootId`.

- **`SystemNode` stub** — `SystemItem.root` is the complex `SystemNode` type. Read `item-shapes.ts`
  for its full shape before writing the mapper. A minimal stub is enough for Phase 1 — the studio
  will render the item name/domain in the library rail even with an empty root.

- **Catalog barrel** — before adding the export, check if `apps/studio-ui/src/app/metamodel/index.ts`
  re-exports everything with `export * from './...'` or explicit named exports. Add to match the
  existing pattern.

- **fetch mock in Vitest** — Angular apps using `happy-dom` or `jsdom` may not have `fetch` in the
  test environment. Check the existing test setup (look for how other spec files mock network calls)
  and follow the same pattern. `vi.stubGlobal('fetch', vi.fn())` is the standard Vitest approach.

- **CORS** — `localhost:4555` already sets `Access-Control-Allow-Origin: http://localhost:4200`
  (see Task 1 constraints). Task 2 does not need to touch CORS.

---

## Execution order

Run these tasks sequentially:
1. Task 1 (foundry) → PR → merge → ritual
2. Task 2 (studio) → PR → merge → ritual

Both tasks are mechanical (bounded files, known patterns). Use haiku-tier implementer for Task 1
(pure server route + mapper), sonnet-tier for Task 2 (Angular signals + routing).
