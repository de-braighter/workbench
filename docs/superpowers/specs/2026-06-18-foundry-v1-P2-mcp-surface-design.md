# Foundry v1 P2 — MCP Surface Completeness

> Closes the extract→generate→compile pivot at the MCP boundary. After P2 a session can
> extract a blueprint from the log, generate a new product from it, and compile it to any
> registered target — all via MCP tool calls only. Zero kernel change; two new read-only
> tools, a pack-local compiler registry, and a shared Zod schema.

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`src/mcp/server.ts`, `src/mcp/tools.ts`,
  `src/compiler/registry.ts` (new), `src/metamodel/blueprint.ts`).
  `layers/specs` (ADR-252, status proposed).
- **Predecessors:** ADR-248 (blueprint extraction — Stage 3), ADR-249 (blueprint generation —
  Stage 4), ADR-250 (multi-target compiler — Stage 5), ADR-251 (yields-in-log — P1),
  ADR-242 (substance = derived, never stored), ADR-176 (kernel minimality inclusion test).

---

## 1. Problem — the pivot surface is incomplete at the MCP boundary

**Recon (verified against source):**

- `src/mcp/server.ts` registers 14 tools. `foundry_generate_from_blueprint` (lines 107-131)
  is the only pivot-related tool. No `foundry_extract_blueprint` and no
  `foundry_compile_blueprint` tool exist. A session can generate but cannot extract or
  compile via MCP.
- `extractBlueprint` (`src/metamodel/blueprint.ts:51`) and `specFromQueue`
  (`src/plan/tree-from-queue.ts:18`) are pack functions reachable only by direct import,
  not through the MCP surface.
- The two compiler targets `testHarnessTarget` (`src/compiler/target-test-harness.ts:118`,
  name `'test-harness'`) and `renderTreeTarget` (`src/compiler/target-render-tree.ts:45`,
  name `'render-tree'`) are un-centralized module exports. There is no `targetId → target`
  lookup and no `compile(blueprint, targetId)` entry function in any file under
  `src/compiler/`. `src/compiler/compile-target.ts` exports only the `CompileTarget<O>`
  interface.
- `ProductBlueprint` (`src/metamodel/blueprint.ts:35`) is a TypeScript `interface`. There
  is no Zod `ProductBlueprintSchema`. `server.ts` lines 110-128 contain a manually
  maintained inline Zod object for the blueprint wire-shape — a duplicate that will drift
  from the interface.
- `deriveSubstanceFromLog` (`src/metamodel/substance-log.ts:18`) is documented as
  "intended production caller is the forthcoming foundry_extract_blueprint MCP tool (P2)".
  It currently has no production caller.

---

## 2. Decision — add registry + schema + two read-only MCP tools

### What changes (thinnest additive extension)

**R1 — Shared `ProductBlueprintSchema` (Zod):** export a `ProductBlueprintSchema` from
`src/metamodel/blueprint.ts` that is structurally equivalent to the `ProductBlueprint`
interface. Reuse it in `server.ts` for `foundry_generate_from_blueprint`'s `inputSchema.blueprint`
(replacing the inline duplicate) and for the new `foundry_compile_blueprint` input.

Schema:

```ts
// src/metamodel/blueprint.ts
import { z } from 'zod';
import { PlanTreeSchema } from '@de-braighter/substrate-contracts/plan-tree';

export const ProductBlueprintSchema = z.object({
  productKey: z.string().min(1),
  process: PlanTreeSchema,
  done: z.array(z.string()),
});
```

If `PlanTreeSchema` is not exported from `substrate-contracts`, define a structurally
equivalent inline Zod object in `blueprint.ts` (the same approach `server.ts` uses today)
and derive the `ProductBlueprint` type from it with `z.infer<typeof ProductBlueprintSchema>`
— making the interface a type alias rather than a separate declaration. Either path removes
the duplicate in `server.ts`.

**R2 — CompileTarget registry:** add `src/compiler/registry.ts` exporting:

```ts
// src/compiler/registry.ts
import type { ProductBlueprint } from '../metamodel/blueprint.js';
import { testHarnessTarget } from './target-test-harness.js';
import { renderTreeTarget } from './target-render-tree.js';

const TARGETS: ReadonlyMap<string, { compile(bp: ProductBlueprint): unknown }> = new Map([
  [testHarnessTarget.name, testHarnessTarget],
  [renderTreeTarget.name, renderTreeTarget],
]);

export function listTargets(): string[] {
  return [...TARGETS.keys()].sort();
}

export function compile(blueprint: ProductBlueprint, targetId: string): unknown {
  const target = TARGETS.get(targetId);
  if (target == null) {
    throw new Error(`unknown compile target: "${targetId}". Available: ${listTargets().join(', ')}`);
  }
  return target.compile(blueprint);
}
```

This is the named-target lookup that ADR-250 implied but did not deliver. The registry
imports both targets; future targets (P7 browser-runtime, etc.) register here. The registry
does not generalize the return type — `compile` returns `unknown` and callers serialize to
JSON, which is all an MCP tool needs.

**R3 — `foundry_extract_blueprint` MCP tool — READ-ONLY:** no event emitted; no write to
the store. Handler:

1. Folds state from the canonical log (`fold(readEnvelopes(deps.logPath))`).
2. Derives the spec via `specFromQueue(productKey, state)`.
3. Calls `extractBlueprint(spec, state, productKey)` — existing function, unmodified.
4. Calls `deriveSubstanceFromLog(state, productKey)` — its first production caller
   (closes the "forthcoming P2" note in `substance-log.ts`).
5. Returns `{ blueprint, substance }`.

Throws (surfaced as `isError: true`) when `productKey` is not in `state.products`.

Input schema:

```ts
{ productKey: z.string().min(1) }
```

Output shape:

```ts
{
  blueprint: ProductBlueprint;   // serialized — caller can pass to foundry_compile_blueprint
  substance: SubstanceRef[];     // derived ⋃ yields of DONE items (ADR-242)
}
```

**R4 — `foundry_compile_blueprint` MCP tool — READ-ONLY:** no event emitted; no store
access. Handler:

1. Parses `blueprint` via `ProductBlueprintSchema` (shared schema from R1).
2. Calls `compile(blueprint, targetId)` from the registry (R2).
3. Returns the target output serialized as JSON.

Throws (surfaced as `isError: true`) on unknown `targetId` (registry throws; `guard` wraps
it). Passes Zod validation errors through the existing `fail()` path in `tools.ts`
(`isError: true` + field-level message).

Input schema:

```ts
{
  blueprint: ProductBlueprintSchema,   // R1 shared schema
  targetId: z.string().min(1),
}
```

**R5 — `server.ts` dedup:** replace the inline Zod object at lines 110-128 with a reference
to `ProductBlueprintSchema` (R1). The shared schema tightens node-id validation to UUID
format (inherited from PlanTreeSchema, consistent with the kernel PlanTree contract);
all blueprints produced by `buildCascadeTree` carry valid UUIDs, so no real caller is
affected.

**R6 — `tools.ts` additions:** add two handlers to `makeTools()` following the existing
`guard()` pattern:

```ts
foundry_extract_blueprint: guard((a: { productKey: string }) => {
  const state = fold(readEnvelopes(deps.logPath));
  if (!state.products.has(a.productKey)) throw new Error(`unknown product: ${a.productKey}`);
  const spec = specFromQueue(a.productKey, state);
  const blueprint = extractBlueprint(spec, state, a.productKey);
  const substance = deriveSubstanceFromLog(state, a.productKey);
  return { blueprint, substance };
}),
foundry_compile_blueprint: guard((a: { blueprint: ProductBlueprint; targetId: string }) => {
  return compile(a.blueprint, a.targetId);
}),
```

The blueprint argument to `foundry_compile_blueprint` is typed as `ProductBlueprint`; the
MCP layer parses it via `ProductBlueprintSchema` in `server.ts` before the handler is
called (same pattern as `foundry_generate_from_blueprint`).

### What does NOT change

- `extractBlueprint`, `blueprintSubstance`, `blueprintCompleteness` in `blueprint.ts` —
  signatures and bodies unchanged.
- `specFromQueue`, `treeFromQueue` in `tree-from-queue.ts` — unchanged.
- `deriveSubstanceFromLog` in `substance-log.ts` — unchanged (R3 is its first caller).
- `testHarnessTarget`, `renderTreeTarget` — unchanged; registry merely wraps them.
- `CompileTarget<O>` interface — unchanged.
- No new event types. No state mutation. No kernel contract change.

---

## 3. Architecture

```
MCP client
   │
   ├─ foundry_extract_blueprint(productKey)     [READ-ONLY]
   │      │
   │      ▼
   │   fold(readEnvelopes(logPath))
   │      │
   │      ├─ specFromQueue(productKey, state)  → CascadeNodeSpec[]
   │      │      │
   │      │      ▼
   │      │   extractBlueprint(spec, state, productKey)  → ProductBlueprint
   │      │
   │      └─ deriveSubstanceFromLog(state, productKey)   → SubstanceRef[]
   │              (first production caller — closes P1 review note)
   │
   ├─ foundry_generate_from_blueprint(blueprint, newKey)  [existing — emits events]
   │
   └─ foundry_compile_blueprint(blueprint, targetId)      [READ-ONLY]
          │
          ▼
       ProductBlueprintSchema.parse(blueprint)
          │
          ▼
       registry.compile(blueprint, targetId)
          │
          ├─ 'test-harness' → testHarnessTarget.compile(bp) → TestHarnessReport
          └─ 'render-tree'  → renderTreeTarget.compile(bp)  → RenderNode<PlanNodeProps>
```

```
src/compiler/
  compile-target.ts    ← unchanged (CompileTarget<O> interface)
  target-test-harness.ts  ← unchanged
  target-render-tree.ts   ← unchanged
  registry.ts          ← NEW (R2): Map + compile() + listTargets()
```

---

## 4. Acid test — must BITE

Test file: `test/mcp-surface.acid.test.ts`. All fixtures are inline; no
production builder output is used to derive expected values.

### Fixture

```ts
const FIXTURE_SPEC: CascadeNodeSpec[] = [
  { key: 'p2-product', kind: 'product', parent: null,
    meta: { name: 'P2 Test', repo: 'test/p2', riskTier: 'T0' as const } },
  { key: 'p2-wi-a', kind: 'work-item', parent: 'p2-product',
    meta: { itemId: 'p2-product/wi-a', title: 'Alpha', scope: { repo: 'test/p2' },
            dependsOn: [], yields: [{ kind: 'pack' as const, id: 'p2-pack' }] } },
  { key: 'p2-wi-b', kind: 'work-item', parent: 'p2-product',
    meta: { itemId: 'p2-product/wi-b', title: 'Beta', scope: { repo: 'test/p2' },
            dependsOn: [], yields: [{ kind: 'board' as const, id: 'p2-board' }] } },
];
// EXPECTED substance — computed INDEPENDENTLY (hand-derived):
const EXPECTED_SUBSTANCE: SubstanceRef[] = [
  { kind: 'pack', id: 'p2-pack' },
  { kind: 'board', id: 'p2-board' },
];
```

### T1 — extract returns NON-EMPTY substance equal to independent expected literal

Setup: push `FIXTURE_SPEC` via `foundry_generate_from_blueprint`, drive BOTH items to DONE
via `foundry_claim` → `foundry_release({ outcome: 'built' })` → `foundry_record_merge`.

```
foundry_extract_blueprint('p2-product')
  → assert result.isError is falsy
  → assert result.substance deep-equals EXPECTED_SUBSTANCE (sorted by kind+id)
```

Substance must match the INDEPENDENTLY computed literal — not a re-call of
`deriveSubstanceFromLog`.

### T2 — compile(blueprint, 'test-harness') passes; mutation flips RED

```
foundry_compile_blueprint(blueprint, 'test-harness')
  → assert report.passed === true
```

Mutate: duplicate a node id in `blueprint.process.nodes`. Call again:

```
foundry_compile_blueprint(corruptBlueprint, 'test-harness')
  → assert report.passed === false
  → assert checks.find(c => c.name === 'unique-ids').ok === false
```

RED bite: the mutation flips `passed` from true to false.

### T3 — compile(blueprint, 'render-tree') node count is faithful; drop flips count

```
foundry_compile_blueprint(blueprint, 'render-tree')
  → renderNode: count all nodes recursively
  → assert count === blueprint.process.nodes.length
```

Drop one work-item node from `blueprint.process.nodes` (also remove it from its parent's
`childrenIds` to avoid the dangling-children path):

```
foundry_compile_blueprint(thinnerBlueprint, 'render-tree')
  → assert countNodes(renderNode) === blueprint.process.nodes.length - 1
```

RED bite: dropping a node reduces the count by exactly 1.

### T4 — unknown targetId → isError true

```
foundry_compile_blueprint(blueprint, 'no-such-target')
  → assert result.isError === true
  → assert result.content[0].text matches /unknown compile target/
```

### T5 — unknown productKey in extract → isError true

```
foundry_extract_blueprint('nonexistent-product-xyz')
  → assert result.isError === true
  → assert result.content[0].text matches /unknown product/
```

### T6 — full pivot via MCP (extract-A → generate-B → extract-B → compile-B passes)

This is the end-to-end proof that the surface is complete:

1. Seed product A (`p2-product`) via `foundry_generate_from_blueprint` (blueprint built with
   `buildCascadeTree`; state seeded via direct `extract`/`fold` calls). Drive items to DONE.
2. `foundry_extract_blueprint('p2-product')` → `{ blueprint: bpA, substance: sA }`.
   Assert `sA` is non-empty.
3. `foundry_generate_from_blueprint(bpA, 'p2-product-clone')`. Assert `productRegistered`.
4. Drive ALL items of `p2-product-clone` to DONE.
5. `foundry_extract_blueprint('p2-product-clone')` → `{ blueprint: bpB, substance: sB }`.
   Assert `sB` is non-empty and structurally equals `sA` (same yields inherited from blueprint).
6. `foundry_compile_blueprint(bpB, 'test-harness')` → assert `report.passed === true`.

All six steps use only MCP tool calls through `makeTools()`. No direct function calls for
the pivot steps. This proves the MCP surface is complete end-to-end.

### T7 — ProductBlueprintSchema is the single source of truth (no inline duplicate)

Structural test (static + runtime): parse a well-formed `ProductBlueprint` object via
`ProductBlueprintSchema.parse(...)` and assert it round-trips cleanly. Separately, assert
`server.ts` source does NOT contain the literal `z.object({ treeRootId:` (the old inline
shape) — the file-level string check guards against re-introducing the duplicate.

---

## 5. ADR-176 analysis — NOT triggered

P2 is pack-level on all counts:

- (a) `ProductBlueprintSchema` is a Zod schema for a foundry pack type; it is not a kernel
  contract. `@de-braighter/substrate-contracts` is not modified.
- (b) `src/compiler/registry.ts` is a pack-local lookup over pack-local targets. The
  `CompileTarget<O>` interface is a foundry abstraction, not a kernel primitive. The registry
  is needed by one pack (foundry) not ≥2 packs sharing kernel infrastructure.
- (c) `foundry_extract_blueprint` and `foundry_compile_blueprint` are read-only MCP tools
  on the foundry integration surface. They emit zero events and mutate no state. No new
  kernel aggregate type, no new kernel event, no new kernel contract.
- `deriveSubstanceFromLog` gaining its first production caller is a wire-up, not a kernel
  change — the function lives in `src/metamodel/substance-log.ts`.

ZERO changes to `@de-braighter/substrate-contracts` or `@de-braighter/substrate-runtime`.
Charter-checker must confirm COHERENT.

---

## 6. Reversibility

All changes are additive:

- Removing `foundry_extract_blueprint` and `foundry_compile_blueprint` from `server.ts` and
  `tools.ts` reverts to today's surface. No log or schema migration.
- Removing `registry.ts` reverts to today's un-centralized targets. No breaking change to
  the two existing target files.
- Replacing `ProductBlueprintSchema` with the inline duplicate in `server.ts` reverts R1.
  The `ProductBlueprint` interface can remain as-is or be re-separated.
- No event log migration is required for any revert path.

---

## 7. Deferred

- **P3 — foundry self-event-sourcing:** will USE `foundry_extract_blueprint`; that
  dependency is the reason P2 is a prerequisite for P3.
- **P7 — live browser-runtime compile target:** a third `CompileTarget` that renders a
  live Angular component tree. Registers in `registry.ts` when built. May require a
  kernel/design-system interaction that trips ADR-176 — scoped out of P2; separate arc.
- **`listTargets` as an MCP tool:** `foundry_list_targets()` could expose
  `registry.listTargets()` to sessions. Low priority; deferred until a session-driven need
  is demonstrated.
- **P5 — hierarchical ↔ flat tree reconciliation:** `specFromQueue` produces a flat
  product → work-item tree (no capability/feature levels). The extract path inherits this
  flatness. Reconciling with 4-level authored specs is a separate concern; out of P2.
