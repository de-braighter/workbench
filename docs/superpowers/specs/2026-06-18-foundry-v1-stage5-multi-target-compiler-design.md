# Foundry v1 Stage 5 — Multi-Target Product COMPILER (Slice 5A, the crown)

> Casts a product **blueprint** to **≥2 targets** through one agnostic compiler — proving the
> product-compiler thesis end to end. Target A = a test-harness (foundry-internal, pure); Target B =
> a presentation render-tree (the ADR-240 two-trees binding, `RenderNode` from design-system).
> **Zero new kernel shapes; agnosticism enforced (ADR-243); presentation types in design-system, not
> substrate-contracts (ADR-240); internal-only.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`CompileTarget` interface + 2 targets + the agnosticism gate + the acid test); `layers/specs` (ADR-250). Foundry adds an `@de-braighter/design-system-core` *type* dependency for Target B.
- **Predecessors:** ADR-248 (blueprint extraction), ADR-249 (generation) — the blueprint is the compile SOURCE. ADR-239/240 (render-tree two-trees — the compiler stages). ADR-243 (agnosticism enforcement).

## 1. Problem — the blueprint is extractable + generatable but not yet *cast to targets*

Stages 3–4 made a product's blueprint (`{ process: PlanTree, done }`) extractable and re-generatable.
The crown of the product-compiler vision is **casting** a blueprint to multiple representations — the
"executable dossier" idea: one blueprint → a test-harness that proves the product, a web/static
presentation, a browser-runtime over the substrate model. Today nothing compiles a blueprint to any
target; this slice proves the thesis with the **two thinnest, most-falsifiable** targets.

**Recon facts that shape the design:**
- **Two-trees (ADR-239/240):** the substrate model tree (`PlanTree`, kernel, zero representation) is
  distinct from the presentation tree (`RenderNode<P>`, design-system-core, a derived view). The
  binding is a host-owned **projection** (`PlanNode → RenderNode`). `RenderNode` lives in
  `@de-braighter/design-system-core`, NOT `substrate-contracts` (ADR-240 D1).
- **Agnosticism (ADR-243):** enforced by (1) a structural import boundary (the engine imports only
  `@de-braighter/substrate-*` + relative, never a domain module), (2) a lexical ban-list, (3) a
  cross-domain golden regression. The scenario-lab `runScenario` is the proven "same engine → many
  outputs, zero domain vocabulary" precedent.
- **Board-kit** (the design-system tree renderer brick) already paints a `RenderNode` tree — so the
  render target only needs to PRODUCE the `RenderNode`; emission (SVG/HTML) is board-kit's job.

## 2. Decision — one agnostic compiler, two targets

### Slice 5A (build now)

**`CompileTarget<O>`** (foundry, `src/compiler/compile-target.ts`):
```ts
interface CompileTarget<O> {
  readonly name: string;                       // e.g. 'test-harness', 'render-tree'
  compile(blueprint: ProductBlueprint): O;     // pure, deterministic, domain-agnostic
}
```
Minimal — NO product-specific shape, NO `CompileRequest`/`CompileResult` wrapper.

**Target A — test-harness** (`src/compiler/target-test-harness.ts`, foundry-pure):
`compile(bp): TestHarnessReport` where `TestHarnessReport = { passed: boolean; checks: { name: string; ok: boolean; detail?: string }[] }`. Checks (all derived from the blueprint, domain-agnostic):
single-root, acyclic, unique node ids, every work-item `dependsOn` resolves to a node in the tree
(closure), and `blueprintSubstance(bp)` is derivable without error. A faithful "does this product model
hold together" harness. Imports only `substrate-contracts` + `./blueprint` + relative.

**Target B — presentation render-tree** (`src/compiler/target-render-tree.ts`):
`compile(bp): RenderNode` — an **agnostic** projection of `bp.process` (the `PlanTree`) into a
`RenderNode` tree (the ADR-240 binding, structure-to-structure: each `PlanNode` → a `RenderNode`
`{ id, kind, props: { title, … from metadata }, children }`, preserving the tree shape). `RenderNode`
is imported **as a type** from `@de-braighter/design-system-core` (ADR-240 — presentation type from
design-system, never re-declared in substrate-contracts). The output is a serializable static artifact;
board-kit renders it (deferred). The projection is generic — it maps the kernel tree to the
presentation tree without any product/domain knowledge.

**The agnosticism gate (ADR-243):** the `src/compiler/` files import ONLY
`@de-braighter/substrate-contracts/*`, `@de-braighter/design-system-core` (the `RenderNode` type, Target
B only), `./blueprint`, and relative `./compiler/*` — NEVER a domain/product instance module
(`instances/*`, a specific productKey). Enforced by (a) a structural import-boundary TEST that scans
`src/compiler/*.ts` imports against the allow-list, and (b) the cross-blueprint genericity test below.

### Deferred (recorded)

- **Live browser-runtime** (interactive execution of a substrate model: button-click = intervention/
  trigger; the edit-intent → kernel tree-edit-op binding per ADR-240 D4) — the most ambitious target;
  a later slice. This slice produces the static render-tree, not the live runtime.
- **SVG/HTML emission** — board-kit already paints a `RenderNode`; not re-implemented here.
- **android / PDF / additional targets** — the `CompileTarget` interface makes them additive.

## 3. Architecture & mechanism

```text
                                   ┌─ Target A: compile(bp) → TestHarnessReport   (foundry, pure)
ProductBlueprint bp ──┐            │     validate PlanTree invariants + deps closure + substance
{ process: PlanTree } ─┼─ COMPILER ┤
                       │  (agnostic)│─ Target B: compile(bp) → RenderNode          (PlanTree → RenderNode
                       │            │     agnostic projection; RenderNode type ∈ design-system-core)
                       └────────────┘     (ADR-240 two-trees binding; board-kit paints it, deferred)
```

- One blueprint, two `CompileTarget` implementations, two genuinely different artifacts (a validation
  report vs a presentation tree). The compiler is domain-blind (agnosticism gate).
- Target B exercises the two-trees discipline: kernel `PlanTree` (the model) ≠ design-system
  `RenderNode` (the presentation); the projection is the binding.

## 4. Acid test — must BITE (the crown's kill-criterion)

For the SAME blueprint (WHALES — real, yield-bearing) AND an independently-authored fixture:

1. **≥2 targets, both faithful:** `harness = testHarnessTarget.compile(bp)`; `render = renderTreeTarget.compile(bp)`.
   Assert `harness.passed === true` for a well-formed blueprint AND its checks reflect the real
   structure (e.g. the work-item count matches); assert `render` is a `RenderNode` tree that PRESERVES
   `bp.process`'s structure — same node count, same parent→child relationships, every PlanNode id
   mapped 1:1 to a RenderNode id. (Structure round-trip: walking `render` reconstructs the same
   parent/child graph as `bp.process`.)
2. **Agnosticism (the kill-criterion):** the SAME generic `compile` handles WHALES + the fixture with
   NO product-specific branch (cross-blueprint test: both produce their own faithful artifacts; the
   render trees differ by data, not by code path). PLUS a structural import-boundary test asserting no
   `src/compiler/*.ts` imports a domain/instance module.
3. **Mutation → RED:** corrupt the blueprint (introduce a `dependsOn` to a non-existent node, or drop a
   node) → Target A's harness reports `passed: false` with the specific violation AND Target B's
   render-tree reflects the change (different node set). Both targets bite.
4. **Two-trees held (ADR-240):** `RenderNode` is imported from `@de-braighter/design-system-core`
   (a test/structural assertion that the presentation type is NOT defined in foundry or
   substrate-contracts).
5. **Determinism:** each `compile` twice → deep-equal.

## 5. Reversibility

Purely additive: a new `src/compiler/` module + a test + one type dependency. Nothing existing changes.
Reverting = delete `src/compiler/` + the dep. Zero risk to the conductor/extraction/generation paths.

## 6. Governance — ADR-250, zero kernel change

- **ADR-250** records: the multi-target product compiler — a `CompileTarget<O>` interface + ≥2 targets
  casting a blueprint; the two-trees binding (`PlanTree → RenderNode`); the agnosticism gate. Completes
  the extract → generate → **compile** vision. Status `proposed` until charter-checker COHERENT.
- **ADR-176 inclusion test — NOT triggered.** The compiler + targets are pack-level; they consume the
  ratified `PlanTree` + the design-system `RenderNode` (presentation, per ADR-240) + the foundry
  `ProductBlueprint`. NO new kernel shape, NO presentation type in substrate-contracts. Single consumer.
- **External positioning — N/A.** Internal-only; built, not marketed (the compiler/"product compiler"
  thesis is not surfaced externally).

## 7. Scope boundaries (YAGNI)

- NO live browser-runtime execution / button=intervention binding (deferred).
- NO SVG/HTML emission (board-kit does it from the RenderNode).
- NO android / PDF / extra targets (the interface makes them additive).
- NO new kernel shapes; NO presentation type in substrate-contracts (ADR-240).
- NO product-specific or domain code in `src/compiler/` (ADR-243).
