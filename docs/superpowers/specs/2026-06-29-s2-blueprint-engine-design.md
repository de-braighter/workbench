# S2 — Charter Blueprint Engine Design

- **Date:** 2026-06-29
- **Status:** Draft for founder review
- **Scope:** `layers/charter-runtime` (additive only — no change to `layers/substrate`)
- **ADR:** ADR-286 (reserved)
- **Part of:** Recursive Charter Runtime Program (`docs/superpowers/specs/2026-06-27-recursive-charter-runtime-program-design.md` §10, S2)
- **Builds on:** S0 (charter-node schema + inheritance validator), S1 (uniform lifecycle runtime, ADR-285)
- **Kernel-Untouched Invariant:** zero diff to substrate production files — certified by boundary acid (Acid 9)

## 1. Purpose

S2 delivers the **blueprint engine**: the machinery for capturing, validating, and instantiating charter tree designs as portable, execution-state-free snapshots. A blueprint is the *design-time form* of a charter tree — a validated snapshot of roles + contracts + dependency edges, divorced from any runtime events or lifecycle state.

Four operations:

| Operation | Signature | What it does |
|---|---|---|
| `extract` | `(tree: PlanTree, blueprintId: string, opts?) → CharterBlueprint` | Walk a live PlanTree → emit a CharterBlueprint (strips execution state, captures structure + contracts) |
| `compile` | `(bp: CharterBlueprint) → CompileResult` | Validate end-to-end: parent refs, dep refs, acyclicity, inheritance; collect all errors |
| `generate` | `(bp, opts: { newId, tenantPackId, treeRootId? }) → PlanTree` | Blueprint → new PlanTree skeleton with fresh UUIDs, ready for `conductCharterStep` |
| `store/load` | `BlueprintStore` port + `InMemoryBlueprintStore` | Persist and retrieve blueprints; in-memory adapter first, same port pattern as `CharterEventLog` |

**Consumers S2 unlocks:**
- Studio saving/loading draft tree designs (S4)
- Foundry migrating its buildCascadeTree product trees into the charter-runtime (S3 dogfood)
- Any domain bootstrapping a charter tree from a shared template

## 2. Approach

**Pure functions everywhere.** All four operations are synchronous, pure functions (modulo injected `newId` calls in `generate`). `extract` takes an already-loaded `PlanTree`; `generate` returns a `PlanTree` the caller saves. The `BlueprintStore` is a separate port injected by consumers. This is consistent with every S0/S1 function (`readCharter`, `validateInheritance`, `charterFrontier` are all pure; `conductCharterStep` is the only async one and only because it touches stores directly). Callers compose the I/O steps around these pure functions.

**Why not async extract?** Async `extract(treeRootId, planTreeStore)` couples I/O into the function, breaking testability (requires store mocks for the core logic) and the pure-function discipline established across S0/S1. The caller-loads pattern is deliberate S1 discipline: `conductCharterStep` loads first, then passes the tree as a value.

## 3. Data model

```ts
// src/blueprint.ts

export interface CharterBlueprintNode {
  id: string;              // source PlanNode.id (UUID) — stable reference key within this blueprint
  parentId: string | null; // null = root node
  role: CharterRole;
  contract: CharterContract;
  ordinal: number;         // sibling ordering preserved from source tree
  dependsOn: string[];     // IDs of other nodes within this blueprint
  label?: string;          // optional human display name
}

export interface CharterBlueprint {
  id: string;              // blueprint identity (caller-supplied UUID)
  name?: string;           // human-readable name
  sourceTreeRootId?: string; // if extracted from a live tree
  createdAt: string;       // ISO timestamp
  nodes: CharterBlueprintNode[];
}
```

**Node identity — UUID-as-key + optional label (Decision D1):**
- Blueprint nodes keep their source PlanNode UUIDs as keys. This preserves `dependsOn` edge references exactly — no key-remapping needed inside `compile`. Only `generate` remaps them.
- `label` is intentionally optional: machine-extracted blueprints need not synthesise display names; the studio or human author adds labels when authoring.
- `sourceTreeRootId` is an audit link ("this blueprint was snapshotted from tree X"). Purely informational — not used by `compile` or `generate`.

**Caller-owned identity for `extract` (Decision D2):**
`extract` receives an explicit `blueprintId: string` from the caller. The caller generates it (e.g. via `deps.newId()`). This keeps `extract` pure and follows the foundry's pattern (`extractBlueprint(spec, state, productKey)` — identity is always caller-owned).

**Non-charter nodes silently skipped (Decision D3):**
`extract` calls `readCharter(node)` on each tree node; nodes returning `null` are skipped. A tree may contain non-charter scaffolding nodes; the blueprint is agnostic to them.

## 4. Function specifications

### 4.1 `extract`

```ts
export function extract(
  tree: PlanTree,
  blueprintId: string,
  opts?: { name?: string; createdAt?: string },
): CharterBlueprint
```

Pure, synchronous. Steps:
1. Walk `tree.nodes`; call `readCharter(node)` on each — skip nodes where result is `null`.
2. For each charter node, build a `CharterBlueprintNode`:
   - `id`: `node.id`
   - `parentId`: `node.parentId`
   - `role`: `charter.role`
   - `contract`: `charter` (the full `CharterContract`)
   - `ordinal`: `node.ordinal`
   - `dependsOn`: `(node.metadata['_dependsOn'] as string[] | undefined) ?? []`
   - `label`: `charter.mission.objective` (used as a sensible default display name)
3. Return `{ id: blueprintId, name: opts?.name, sourceTreeRootId: tree.treeRootId, createdAt: opts?.createdAt ?? new Date().toISOString(), nodes }`.

Note: `new Date().toISOString()` is acceptable here — `extract` is not a fold function and is never replayed. No determinism requirement applies.

### 4.2 `compile`

```ts
export function compile(bp: CharterBlueprint): CompileResult
```

Pure, synchronous. Collects **all errors** in one pass (no fail-fast — a design tool needs the full picture). Returns `{ ok: true }` or `{ ok: false; errors: CompileError[] }`.

**Error types:**

```ts
export type CompileError =
  | { kind: 'no-root' }
  | { kind: 'multiple-roots'; nodeIds: string[] }
  | { kind: 'orphan-parent'; nodeId: string; missingParentId: string }
  | { kind: 'orphan-dependency'; nodeId: string; missingDepId: string }
  | { kind: 'parent-cycle'; nodeIds: string[] }
  | { kind: 'dependency-cycle'; nodeIds: string[] }
  | { kind: 'inheritance-violation'; nodeId: string; reason: string };

export type CompileResult = { ok: true } | { ok: false; errors: CompileError[] };
```

**Validation steps (in order):**

1. **Root check** — exactly one node with `parentId === null`. Errors: `no-root` or `multiple-roots`.
2. **Parent ref integrity** — every non-root `parentId` exists in the node ID set. Error: `orphan-parent` per violation.
3. **Dependency ref integrity** — every `dependsOn` ID exists in the node ID set. Error: `orphan-dependency` per violation.
4. **Tree acyclicity** — walk parent chains to detect cycles (a node that is its own ancestor). Error: `parent-cycle` with the cycle's node IDs.
5. **Dependency acyclicity** — Kahn's algorithm on `dependsOn` edges. Error: `dependency-cycle` with the cycle's node IDs.
6. **Inheritance** — for each non-root node, call `validateInheritance(parentContract, nodeContract)` from `inheritance.ts`. Error: `inheritance-violation` carrying the `reason` from `InheritanceViolation`.

Steps 1–5 run regardless of each other; step 6 is skipped for nodes whose `parentId` is missing (already flagged as `orphan-parent`) to avoid misleading errors.

**Why collect-all?** The studio author needs to see all problems at once, not fix one, resubmit, find the next. The same discipline as TypeScript's type-checker vs a halt-on-first parser.

### 4.3 `generate`

```ts
export function generate(
  bp: CharterBlueprint,
  opts: { newId: () => string; tenantPackId: string; treeRootId?: string },
): PlanTree
```

Pure, synchronous (modulo `newId` calls). Does **not** call `compile` first — callers that care validate ahead of time; `generate` trusts a valid blueprint (same discipline as `writeCharter` trusting the caller).

Steps:
1. Build an ID map: call `opts.newId()` once per blueprint node → `Map<blueprintNodeId, freshUUID>`.
2. Determine `treeRootId`: `opts.treeRootId ?? idMap.get(rootNode.id)!` (root node = the one with `parentId: null`).
3. Build `childrenIds` lookup: group nodes by `parentId`, map through `idMap`.
4. For each blueprint node, construct a `PlanNode`:
   - `id` = `idMap.get(node.id)!`
   - `parentId` = `node.parentId != null ? idMap.get(node.parentId)! : null`
   - `treeRootId` = from step 2
   - `kind` = `node.role`, `kindRef` = `` `charter:${node.role}` ``
   - `ordinal` = `node.ordinal`
   - `childrenIds` = from step 3
   - `metadata` = `{ _dependsOn: node.dependsOn.map(id => idMap.get(id)!), charter: node.contract }`
   - Written via `writeCharter(planNode, node.contract)`
5. Return `{ treeRootId, nodes: allPlanNodes }`.

The generated tree has no events and no lifecycle state — it is ready for `conductCharterStep` immediately.

**`childrenIds` are derived, not stored in the blueprint** — consistent with "store generators, derive graphs" (ADR-176 §4 / north-star §20). The blueprint only stores the `parentId` direction; `generate` derives `childrenIds` in one pass.

### 4.4 `BlueprintStore` port

```ts
// src/blueprint-store.port.ts

export interface BlueprintStore {
  save(blueprint: CharterBlueprint): Promise<void>;
  load(id: string): Promise<CharterBlueprint | null>;
}

export class InMemoryBlueprintStore implements BlueprintStore {
  private readonly store = new Map<string, CharterBlueprint>();

  async save(bp: CharterBlueprint): Promise<void> {
    this.store.set(bp.id, { ...bp, nodes: [...bp.nodes] });
  }

  async load(id: string): Promise<CharterBlueprint | null> {
    return this.store.get(id) ?? null;
  }
}
```

Same structure as `CharterEventLog`: a minimal port + an in-memory default implementation. No `list()` in S2 — the studio will need it in S4; add then.

## 5. Public surface (`src/index.ts`)

Appended as a new `// ── S2 ──` block, consistent with S1:

```ts
// ── S2 ──────────────────────────────────────────────────────────────────────
export type { CharterBlueprint, CharterBlueprintNode, CompileResult, CompileError } from './blueprint.js';
export { extract, compile, generate } from './blueprint.js';
export type { BlueprintStore } from './blueprint-store.port.js';
export { InMemoryBlueprintStore } from './blueprint-store.port.js';
```

No changes to any S0/S1 file. S2 is purely additive.

## 6. Tests

### Unit tests (`src/blueprint.spec.ts`)

| Test | Assertion |
|---|---|
| `extract` skips non-charter nodes | Tree with 2 charter + 1 non-charter node → blueprint has 2 nodes |
| `extract` preserves structure | `parentId`, `ordinal`, `dependsOn`, `role`, `contract` round-trip faithfully |
| `extract → generate` identity | Generated tree has same role/contract/ordinal/dependency structure; all IDs are fresh UUIDs (no overlap with source) |
| `compile` clean → ok | 2-node parent→task blueprint with valid inheritance → `{ ok: true }` |
| `compile` no-root | All nodes have a `parentId` → `no-root` |
| `compile` multiple-roots | Two nodes with `parentId: null` → `multiple-roots` |
| `compile` orphan-parent | Node references a `parentId` not in the set → `orphan-parent` |
| `compile` orphan-dependency | `dependsOn` references a missing ID → `orphan-dependency` |
| `compile` parent-cycle | A → parent B → parent A → `parent-cycle` |
| `compile` dependency-cycle | A depends-on B depends-on A → `dependency-cycle` |
| `compile` inheritance-violation | Child scope wider than parent → `inheritance-violation` with reason |
| `compile` collects all errors | Blueprint with 3 distinct errors → `errors.length === 3` |
| `generate` maps dependsOn | Blueprint A depends-on B → generated A has `_dependsOn: [freshUUID-of-B]` |
| `generate` derives childrenIds | Parent node has `childrenIds` populated from child `parentId` mappings |

### Port contract test (`src/blueprint-store.port.spec.ts`)

Same pattern as `event-log.port.spec.ts`: save → load round-trip; load missing → null; second save overwrites.

### New integration acid (added to `src/acids.spec.ts`)

`extract → compile → generate → conductCharterStep` end-to-end:

1. Build a 2-node tree (product → task) with valid contracts via existing `fixtures.ts`.
2. `extract` → `compile` → assert `{ ok: true }`.
3. `generate` with fresh IDs → a new `PlanTree` skeleton (no events).
4. Save to `InMemoryPlanTreeStore`, create `InMemoryCharterEventLog`.
5. `conductCharterStep` on the generated tree → asserts `{ status: 'advanced' }`.

**Existing acids untouched.** Boundary acid (Acid 9, recursive substrate scan) still passes at 0 hits — S2 adds no substrate vocabulary.

**Target test count:** 74 (current) + ~15 unit + 3 port + 1 acid = **~93 tests**.

## 7. ADR-286

One ADR ratifying S2. Key decisions to record:

- **D1** — UUID-as-key + optional label: blueprint nodes keep source PlanNode UUIDs as reference keys; `label` is optional and human-supplied.
- **D2** — Caller-owned blueprint identity: `extract` takes an explicit `blueprintId`; identity is never generated inside a pure function.
- **D3** — Non-charter nodes silently skipped by `extract`.
- **D4** — `compile` collects all errors (no fail-fast) — design-tool discipline.
- **D5** — `generate` trusts a valid blueprint (does not call `compile`); callers validate when needed.
- **D6** — `childrenIds` derived in `generate`, not stored in blueprint ("store generators, derive graphs").
- **D7** — `BlueprintStore` port mirrors `CharterEventLog`; `list()` deferred to S4.
- **D8** — Kernel-Untouched Invariant holds: zero diff to substrate production files.

## 8. File layout

**New files:**
```
layers/charter-runtime/src/
  blueprint.ts                ← types + extract, compile, generate
  blueprint-store.port.ts     ← BlueprintStore port + InMemoryBlueprintStore
  blueprint.spec.ts           ← unit tests
  blueprint-store.port.spec.ts ← port contract tests
```

**Modified files:**
```
layers/charter-runtime/src/
  index.ts          ← S2 export block appended
  acids.spec.ts     ← one new acid added
```

**Branch:** `feat/s2-blueprint-engine` on `de-braighter/charter-runtime`

## 9. Kernel-Untouched Invariant

S2 adds no substrate vocabulary. The four enforced checks remain green:

1. **Zero-diff guard** — `plan-tree-schemas.ts`, `plan-tree-store.port.ts`, `prisma-plan-tree.store.ts`, and the `kernel.plan_node` migration are unchanged.
2. **Import-boundary acid** — no charter vocabulary under `layers/substrate/**`. Acid 9 passes at 0 hits.
3. **`charter-checker` agent** — S2 PR passes the constitutional review.

## 10. Out of scope

- `BlueprintStore.list()` — deferred to S4 (studio needs it; no S2 consumer does).
- `BlueprintBuilder` fluent authoring API — deferred to S4 (studio template authoring).
- Persistence-backed `BlueprintStore` adapters — deferred to S3/S4 (consumers provide them).
- Changes to `CharterContract` fields — S2 works with the S0/S1 contract (role + mission + scope); field additions are S0-territory.
- Autonomy / quality / acceptance contract fields — later slices.
