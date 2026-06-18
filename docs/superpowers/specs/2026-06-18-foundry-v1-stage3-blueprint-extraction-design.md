# Foundry v1 Stage 3 — Blueprint EXTRACTION (Slice 3A)

> Extracts a product's **blueprint** — its process plan tree + the derived substance + completeness —
> from the running foundry as serializable kernel data, and proves **round-trip reconstruction**
> generically (≥2 products, no product-specific code). The pivot between extraction (Stage 3) and
> generation (Stage 4). **Zero new kernel shapes; substance stays derived (ADR-242).**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`ProductBlueprint` type + `extractBlueprint` + derived views + round-trip acid test); `layers/specs` (ADR-248).
- **Predecessors:** ADR-242 (substance = derived ⋃ yields, never stored), ADR-244/246/247 (the plan tree + treeFromQueue), the v0 metamodel ("both faces, one recursive tree").

## 1. Problem — the blueprint is implicit, never extracted as data

The foundry's metamodel has two faces: the **process** face (the `Product→Capability→Feature→WorkItem`
plan tree, authored as a `CascadeNodeSpec`) and the **substance** face (`⋃ yields(done work-items)`,
derived per ADR-242). Today these exist only as: hand-authored specs (`WHALES_PRODUCT`,
`FOUNDRY_PRODUCT`) + pure derivations (`deriveSubstance`, `completeness` in `src/metamodel/substance.ts`).
There is **no extracted blueprint** — no self-contained, serializable representation of "what a product
IS and how it was built" that can be round-tripped, handed to a generator (Stage 4), or compiled
(Stage 5). The product-compiler vision needs the blueprint as a first-class **data artifact**.

**Recon facts that shape the design:**
- **Yields ride on the authored `CascadeNodeSpec` work-item metadata, NOT the event log.** A yield is a
  `SubstanceRef = { kind: 'pack'|'board'|'policy'|'indicator', id }`. The event log (`WorkItemQueued`,
  `MergeRecorded`) carries no yields.
- **Done-status IS in the log** (`MergeRecorded` per itemId). So the *landed* substance — which declared
  yields actually shipped — is a function of the live log state.
- **Real generated products (agri/oncology) have no yields** (shipped pre-metamodel). The round-trip
  acid test needs a **yield-bearing product** — `WHALES_PRODUCT` (shipped, has yields) + a fixture.

## 2. Decision — the blueprint is `{ process, done }`; substance is derived

### Slice 3A (build now)

**`ProductBlueprint`** (a pack-lib interface in `src/metamodel/blueprint.ts`):
```ts
interface ProductBlueprint {
  productKey: string;
  process: PlanTree;        // the full authored plan tree; work-item nodes carry yields in metadata
  done: string[];           // itemIds that are done per the live event log (MergeRecorded)
}
```
Substance + completeness are **derived views**, never stored in the blueprint (ADR-242):
```ts
blueprintSubstance(bp): SubstanceRef[]      // ⋃ yields of bp.process work-items whose itemId ∈ bp.done
blueprintCompleteness(bp): { landed; declared; pct }
```
The blueprint stores **generators** (the process tree + the done-set); the substance graph is derived.
This is exactly "store generators, derive graphs" (ADR-176 §4) applied to the product model.

**`extractBlueprint(spec: CascadeNodeSpec[], state: DerivedState, productKey): ProductBlueprint`:**
- `process = buildCascadeTree(spec)` — the authored plan tree (structure + yields).
- `done = [itemIds of spec work-items that are merged/done in the live `state` (log-derived)]` — the
  RUNNING foundry's progress, matched to spec work-items by `itemId`. (A spec item with no log merge is
  declared-but-not-landed.)

So the blueprint's **structure + declared yields** come from the product's authored declaration, and its
**progress (landed substance)** from the live event log — extracted "from the running foundry".

### Deferred (recorded)

- **Yields-in-log** — emitting yields onto `WorkItemQueued` (a pack event payload extension,
  backward-compatible) so the blueprint is extractable from the LOG ALONE (no spec input), enabling
  substance for *generated* products. A later slice (Stage 3B / pre-Stage-4) when generation needs it.
- **Hierarchical vs flat process** — `treeFromQueue` (log) is flat; the authored spec is 4-level. The
  blueprint uses the authored 4-level `buildCascadeTree(spec)` (the richer model). Reconciling the two
  tree sources is out of scope here.

## 3. Architecture & mechanism

```
authored CascadeNodeSpec[]  ──buildCascadeTree──▶  process: PlanTree ─┐
   (structure + yields)                                              ├─▶ ProductBlueprint { productKey, process, done }
live DerivedState (event log) ──merged itemIds──▶  done: string[]  ──┘            │
                                                                                   ▼  (derived views, not stored)
                                                  blueprintSubstance(bp) = ⋃ yields(work-items ∈ done)
                                                  blueprintCompleteness(bp)
```

- `extractBlueprint` is a pure composition of existing pieces (`buildCascadeTree`, the spec's yields,
  the log's done-set). No new event type, no new kernel shape.
- `ProductBlueprint` is plain JSON-serializable data (a `PlanTree` + a `string[]` + a key).

## 4. Acid test — must BITE (round-trip + genericity)

For **≥2 products** — `WHALES_PRODUCT` (shipped, yields authored) AND an **independently-authored
fixture-product** with a MIXED done-set (some items done, some not, so completeness is non-trivial):

1. **Round-trip losslessness:** `bp = extractBlueprint(spec, state, p)`; `bp2 = JSON.parse(JSON.stringify(bp))`
   (proves plain data); assert `blueprintSubstance(bp2)` deep-equals `deriveSubstance` computed directly
   over the same done-set, and `bp2.process` deep-equals `buildCascadeTree(spec)`. The blueprint
   losslessly reconstructs the product's process + substance.
2. **Genericity (the kill-criterion):** the SAME generic `extractBlueprint` + derivations handle both
   products with NO product-specific branch. (An assertion that the code path is identical — e.g. both
   run through one function with only the spec/state/key differing.)
3. **Mutation → RED:** drop a yield from a done work-item in `bp.process` (or remove an itemId from
   `bp.done`); `blueprintSubstance` changes; the round-trip equality assertion goes RED.
4. **Negative control:** a yield-less product (or a fixture with zero done items) → empty substance;
   completeness `pct` handled (declared=0 → pct 0, no divide-by-zero).
5. **Determinism:** `extractBlueprint` twice → deep-equal; substance dedup is order-independent set
   equality (by `(kind,id)`).

## 5. Reversibility

Purely additive: a new type + a new extractor + derived views + a test. Nothing existing changes
(`deriveSubstance`/`completeness` stay). Reverting = delete the new files. Zero risk to live behavior.

## 6. Governance — ADR-248, zero kernel change

- **ADR-248** records: a product **blueprint** is a serializable `{ process: PlanTree, done: itemId[] }`
  extracted from the running foundry (authored process + log-derived done-set); substance + completeness
  are DERIVED projections of it (ADR-242 upheld — substance never stored). It is the extract/generate/
  compile pivot. Status `proposed` until charter-checker COHERENT.
- **ADR-176 inclusion test — NOT triggered.** `ProductBlueprint` is a pack-lib interface composed from
  the ratified `PlanTree` (ADR-127/194) + a `string[]`; `extractBlueprint` is a pack-level derivation.
  Single consumer (foundry). No new kernel shape, no kernel code. charter-checker runs regardless.

## 7. Scope boundaries (YAGNI)

- NO yields-in-log event extension (deferred — only matters for generated-product substance / log-only extraction).
- NO blueprint GENERATION (Stage 4) and NO compilation (Stage 5).
- NO reconciling the flat `treeFromQueue` vs the 4-level authored tree (blueprint uses the authored tree).
- NO new kernel shapes; substance stays a derived view.
