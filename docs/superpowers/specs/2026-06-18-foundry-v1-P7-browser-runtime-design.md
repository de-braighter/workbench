# Foundry v1 P7 — Live browser-runtime compile target (the crown)

> The CROWN of the multi-target compiler vision (ADR-250 deferred this explicitly): a THIRD
> CompileTarget casts a `ProductBlueprint` to a `BrowserRuntimeDescriptor` = a RUNNING browser
> app where **the website structure IS the substrate model** (the PlanTree, projected 1:1) and
> **a button-click IS an intervention/trigger** (bound to an EXISTING declared effect on a
> PlanNode). **Zero kernel change.** The "intervention" is ALREADY first-class kernel — a
> `PlanNode` carrying `effectDeclarations` (ADR-154 / ADR-194 D2); the button is a pack-authored
> presentation affordance REFERENCING that existing kernel data, never a new kernel contract.
> The kernel-risk the handoff flagged (an `InterventionDescriptor` in `substrate-contracts`) is
> **adjudicated and REJECTED** below (§2 — the ADR-176 gate).

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`src/compiler/target-browser-runtime.ts` (new),
  `src/compiler/registry.ts`, `src/compiler/materialize-html.ts` (new),
  `test/compiler-browser-runtime.acid.test.ts` (new), `test/browser-runtime-live.acid.test.ts`
  (new, gated)). `layers/specs` (ADR-259, status proposed). **No `@de-braighter/substrate-*`
  change.**
- **Predecessors:** [ADR-250](../../../layers/specs/adr/adr-250-foundry-multi-target-product-compiler.md)
  (the `CompileTarget<O>` interface + Target A test-harness + Target B render-tree; explicitly
  DEFERRED the live browser-runtime as "the most ambitious target; a later slice"),
  [ADR-252](../../../layers/specs/adr/adr-252-foundry-mcp-surface-completeness.md) (the
  `CompileTarget` registry in `src/compiler/registry.ts` — a new target registers HERE),
  [ADR-239](../../../layers/specs/adr/adr-239-generic-substrate-tree-renderer-board-kit-design-system-brick.md)
  / [ADR-240](../../../layers/specs/adr/adr-240-render-tree-contract-home-and-shape.md)
  (two-trees discipline + `RenderNode` lives in `@de-braighter/design-system-core`, NEVER
  `substrate-contracts`; the `EditIntent` binding ADR-240 D4 names the future runtime edit-op
  link),
  [ADR-243](../../../layers/specs/adr/adr-243-scenario-lab-engine-purity.md) (the agnosticism
  gate the new target must pass — the glob test auto-covers it),
  [ADR-154](../../../layers/specs/adr/adr-154-algebraic-effect-declarations-and-composition-operators.md)
  (the `EffectDeclaration` algebra — an intervention = a plan-node + a declared effect),
  [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)
  (the inclusion test — the kernel-risk gate §2),
  [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) (the four kernel concerns).

---

## 1. Problem — the compiler can validate + render a blueprint, but cannot RUN it

[ADR-250](../../../layers/specs/adr/adr-250-foundry-multi-target-product-compiler.md) shipped the
multi-target compiler: a minimal `CompileTarget<O>` interface (`src/compiler/compile-target.ts:7`)
and two targets — **Target A** `test-harness` (validates the `PlanTree` invariants) and **Target B**
`render-tree` (projects `PlanTree → RenderNode`, the ADR-240 two-trees binding). ADR-250 then
DEFERRED the third target VERBATIM (`adr-250…:154-157`):

> **Live browser-runtime** — interactive substrate model execution where a button-click becomes
> an intervention trigger; the edit-intent → kernel tree-edit-op binding per ADR-240 D4. The most
> ambitious target; a later slice. This slice produces the static render-tree, not the live runtime.

P7 is that later slice — the CROWN. It closes the compiler vision: extract (Stage 3) → generate
(Stage 4) → compile to a **running app** (Stage 5 / P7). The deliverable is a target that casts a
blueprint to a descriptor a browser can MATERIALIZE and RUN, where:

- the **website structure = the substrate model** — `descriptor.views` is the `PlanTree` projected
  1:1 (node-count + edges + ids preserved — the same faithful-projection discipline Target B holds),
  and
- a **button-click = an intervention/trigger** — for every `PlanNode` that IS an intervention (it
  carries `effectDeclarations`), the descriptor emits a button affordance bound to
  `{ nodeId, effectDeclarationId }`, a REFERENCE to the declared effect. A node WITHOUT effects gets
  NO intervention-button (the negative control).

**Recon (verified against source):**

- The `CompileTarget<O>` interface is `{ readonly name: string; compile(blueprint: ProductBlueprint): O }`
  (`src/compiler/compile-target.ts:7-10`) — pure, no side effects, no domain vocabulary. A new
  target is a pure additive implementation; the interface does not change.
- The registry (`src/compiler/registry.ts:7`) is a static `ReadonlyMap<string, AnyTarget>` seeded
  inline from `testHarnessTarget` + `renderTreeTarget`. A third target registers by adding one
  entry; `compile(blueprint, targetId)` (`registry.ts:16`) + `listTargets()` (`registry.ts:12`)
  pick it up with no other change ([ADR-252](../../../layers/specs/adr/adr-252-foundry-mcp-surface-completeness.md)
  D2).
- Target B already proves the faithful `PlanTree → RenderNode` projection:
  `planTreeToRenderNode` (`src/compiler/target-render-tree.ts:38`) walks `treeRootId` →
  `childrenIds`, preserving node-count + edges + ids; the acid asserts `countNodes(render) ===
  bp.process.nodes.length`, `renderEdges === planEdges`, and ids 1:1 (`test/compiler.acid.test.ts:74-87`).
  P7's `views` REUSES this exact projection shape (composes `RenderNode`, type-only import).
- The "intervention" is ALREADY first-class kernel. `PlanNode.effectDeclarations?:
  EffectDeclaration[]` is a typed kernel field (`layers/substrate/libs/substrate-contracts/src/plan-tree/plan-tree-schemas.ts:50-55`),
  promoted out of `metadata` on demonstrated ≥2-pack need (football + devloop) per ADR-194 D2 /
  ADR-154. `EffectDeclaration.declarationId: z.string().uuid()`
  (`.../effect-declaration.ts:36-37`) is the stable, append-only reference target (a declaration is
  never rewritten in place — retiring stamps `retiredAt` and a fresh `declarationId` lands
  alongside). Foundry already maps an effect onto a node via `CascadeNodeSpec.effects →
  PlanNode.effectDeclarations` (`src/plan/cascade.ts:21, 44`), and `ARC_CASCADE`'s `pr:devloop-scaffold`
  node carries exactly one (`src/plan/cascade.ts:87-98`).
- `@de-braighter/design-system-core` exports `RenderNode<P>` (the presentation tree node) plus
  board-kit EDITOR types (`ToolSpec`, `EditIntent`, `Gesture`) — but it exports **NO `Action`,
  `Trigger`, or intervention-binding type** (verified against
  `node_modules/@de-braighter/design-system-core/src/public/board-kit/render-node.d.ts`). The
  board-kit `ToolSpec`/`EditIntent` types are for VISUAL board editing (a tap/drag produces a tree
  edit), not for binding a button to a substrate intervention. So the interaction-binding type is
  **pack-authored** — it does not exist anywhere upstream to import.

---

## 2. The kernel-risk gate — ADR-176 inclusion test (the load-bearing adjudication)

The handoff flagged that "button = intervention" MIGHT want an `InterventionDescriptor` KERNEL
contract in `@de-braighter/substrate-contracts`. **This is the required gate before building.** The
verdict is **PACK-LEVEL — a new kernel shape is REJECTED. Zero kernel change.**

### 2.1 The contract evidence (verified against source)

An "intervention" is NOT a missing concept the kernel needs to grow — it is ALREADY first-class
kernel data, expressed by two ratified contract fields:

| Kernel fact | Source | Role for P7 |
|---|---|---|
| `PlanNode.effectDeclarations?: EffectDeclaration[]` | `substrate-contracts/src/plan-tree/plan-tree-schemas.ts:50-55` | A `PlanNode` carrying ≥1 effect IS an intervention. Absence ⇒ not an intervention (the negative control). |
| `EffectDeclaration.declarationId: z.string().uuid()` | `substrate-contracts/src/plan-tree/effect-declaration.ts:36-37` | The stable, append-only id a button binds TO. |
| `PlanNode.id: z.string().uuid()` | `substrate-contracts/src/plan-tree/plan-tree-schemas.ts:42` | The stable node id the button binds TO. |

A "button → intervention" is therefore a UI affordance bound to an **existing** `{ PlanNode.id,
EffectDeclaration.declarationId }` pair — a **reference into kernel data, not a new kernel shape.**

### 2.2 The inclusion test on a hypothetical `InterventionDescriptor` contract

Applying [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)
§2 — BOTH legs must hold for a thing to be kernel:

- **(a) Is "a button affordance bound to a declared effect" one of the four kernel concerns?**
  **No.** The four concerns are recurse the plan, flat the observation, inference, reproducibility
  ([ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) §1). The *intervention
  itself* (plan-node + declared effect) is ALREADY covered by concern #1 ("recurse the plan") — the
  kernel already validates and versions it via `PlanTreeSchema.parse`. A **button** that fires it is
  PRESENTATION / ACTUATION — none of the four concerns. There is nothing for the kernel to gain.
- **(b) Is it needed by ≥2 packs as shared infrastructure the kernel must validate / query /
  version?** **No.** The button-binding is a foundry-pack presentation affordance. No second pack
  needs the kernel to validate a `{ nodeId, effectDeclarationId }` button binding, and the kernel
  must NOT validate/version a presentation type — that is exactly the
  [ADR-240](../../../layers/specs/adr/adr-240-render-tree-contract-home-and-shape.md) D1 line
  (presentation types live in `design-system-core`, never `substrate-contracts`).

**Both legs FAIL → pack territory.** A new `InterventionDescriptor` in `substrate-contracts` is
REJECTED on two independent grounds: it passes neither leg of the inclusion test, AND it would
violate ADR-240 D1 by moving a presentation/actuation type into kernel-contracts. The recon
assessment (pack-level) is **CONFIRMED with contract evidence.**

### 2.3 Where the binding type lives instead

The interaction-binding type is **authored in the foundry pack** (`src/compiler/target-browser-runtime.ts`).
It COMPOSES the kernel/presentation data it references but is itself pack/presentation:

- the `views` tree REUSES `RenderNode` from `@de-braighter/design-system-core` (TYPE-only import,
  ADR-240 D1 — same dep Target B already carries);
- the `{ nodeId, effectDeclarationId }` binding REFERENCES kernel data (`PlanNode.id` +
  `EffectDeclaration.declarationId`) but the binding SHAPE is pack-local — it is NOT in
  `substrate-contracts` and NOT in `design-system-core` (which exports no such type).

This is the same posture as Target B: consume the kernel `PlanNode`/`PlanTree` types + the
design-system `RenderNode` type, author the pack-local projection, never extend a contract.

> **Conclusion of the gate.** P7 is a Design-local foundry ADR with NO kernel change and NO
> `substrate-contracts` / `design-system-core` change. It does not need the AUTONOMY(1) kernel path
> (a kernel ADR + founder/charter COHERENT gate). Charter-checker remains the governance gate.

---

## 3. The design — `BrowserRuntimeDescriptor` (Target C)

### 3.1 The descriptor shape

`compile(blueprint) → BrowserRuntimeDescriptor`, where:

```ts
// src/compiler/target-browser-runtime.ts — PACK-AUTHORED (NOT substrate-contracts, NOT design-system-core)
import type { RenderNode } from '@de-braighter/design-system-core'; // TYPE-only (ADR-240 D1)
import type { PlanNode, PlanTree } from '@de-braighter/substrate-contracts/plan-tree'; // TYPE-only
import type { CompileTarget } from './compile-target.js';
import type { ProductBlueprint } from '../metamodel/blueprint.js';

/** Per-view-node props — mirrors Target B's PlanNodeProps (derived from metadata). */
export interface BrowserViewProps {
  metadata: Record<string, unknown>;
}

/**
 * A button affordance bound to an EXISTING declared effect on a PlanNode.
 * REFERENCES kernel data ({PlanNode.id} + {EffectDeclaration.declarationId}); the SHAPE
 * is pack/presentation — NEVER in substrate-contracts (ADR-176 §2 verdict / ADR-240 D1).
 * One InteractionBinding per (node, declared effect): a node with N effects → N bindings.
 */
export interface InteractionBinding {
  nodeId: string;              // a PlanNode.id (substrate-contracts/plan-tree-schemas.ts:42)
  effectDeclarationId: string; // an EffectDeclaration.declarationId on THAT node (effect-declaration.ts:37)
  indicatorId: string;         // carried for the button LABEL — the declared effect's indicator
  direction: '+' | '-' | '?';  // carried for the button LABEL — the declared direction
}

export interface BrowserRuntimeDescriptor {
  /** The website structure = the substrate model: PlanTree projected 1:1 (Target B discipline). */
  views: RenderNode<BrowserViewProps>;
  /** One button per declared effect on an intervention node. Empty for an effect-less blueprint. */
  interactions: readonly InteractionBinding[];
}
```

### 3.2 `views` — the faithful PlanTree projection (the website = the model)

`views` is the `PlanTree` projected to a `RenderNode` tree, FAITHFUL 1:1 — the SAME discipline and
the SAME projection shape as Target B (`src/compiler/target-render-tree.ts:38`). Node-count, edges,
and ids are preserved; `props.metadata` is a shallow clone of the source `PlanNode.metadata` (so the
descriptor never aliases the source). The recursion roots at `tree.treeRootId` and follows
`childrenIds`; a missing root is a hard throw (mirroring Target B `target-render-tree.ts:41`).

This is what makes "the website IS the substrate model" literal: the rendered page tree is
node-for-node the plan tree. The faithful-projection acid (§5 acid 1) bites exactly as Target B's
does.

> **Reuse note.** P7 SHOULD factor Target B's `planTreeToRenderNode` into a shared
> `src/compiler/plan-tree-to-render-node.ts` helper that both Target B and Target C import — the
> projection is identical, and a single source of truth keeps the two faithful-projection acids
> measuring the same code. This is a refactor of EXISTING foundry code (no behaviour change); the
> agnosticism gate covers the new file automatically (it lives under `src/compiler/`).

### 3.3 `interactions` — the button → intervention binding (button-click = trigger)

For each `PlanNode` in `bp.process.nodes` that carries `effectDeclarations`, emit ONE
`InteractionBinding` PER declared effect:

```ts
function bindingsFor(node: PlanNode): InteractionBinding[] {
  // No effects → NO intervention-button. This is the NEGATIVE CONTROL.
  if (node.effectDeclarations == null || node.effectDeclarations.length === 0) return [];
  return node.effectDeclarations.map((eff) => ({
    nodeId: node.id,
    effectDeclarationId: eff.declarationId, // a REFERENCE to the EXISTING declared effect
    indicatorId: eff.indicatorId,
    direction: eff.direction,
  }));
}

export const browserRuntimeTarget: CompileTarget<BrowserRuntimeDescriptor> = {
  name: 'browser-runtime',
  compile(blueprint: ProductBlueprint): BrowserRuntimeDescriptor {
    const views = planTreeToRenderNode(blueprint.process); // faithful 1:1 (Target B discipline)
    const interactions = blueprint.process.nodes.flatMap(bindingsFor);
    return { views, interactions };
  },
};
```

The binding is a pure REFERENCE: `effectDeclarationId` is an id that MUST exist on the node's
`effectDeclarations` array — the compiler never invents an effect, never mutates one, never closes
the discriminated `DistributionSpec`/`CompositionOperator` unions. A button-click in the
materialized app FIRES that intervention by emitting the structured `{ nodeId, effectDeclarationId }`
pair — the genuine "button-click = intervention/trigger."

**The negative control is structural:** a node with no `effectDeclarations` contributes zero
bindings (`bindingsFor` returns `[]`), so it gets NO button. This is what makes the acid bite — see
§5 acid 2.

### 3.4 Registration (ADR-252 registry)

Target C registers in `src/compiler/registry.ts` by adding ONE entry to the static `TARGETS` map
(`registry.ts:7`):

```ts
import { browserRuntimeTarget } from './target-browser-runtime.js';
// ...
const TARGETS = new Map<string, AnyTarget>([
  [testHarnessTarget.name, testHarnessTarget as AnyTarget],
  [renderTreeTarget.name, renderTreeTarget as AnyTarget],
  [browserRuntimeTarget.name, browserRuntimeTarget as AnyTarget], // P7
]);
```

`compile(blueprint, 'browser-runtime')` and `listTargets()` pick it up with no further change. The
`foundry_compile_blueprint` MCP tool ([ADR-252](../../../layers/specs/adr/adr-252-foundry-mcp-surface-completeness.md)
D1) dispatches to it through the registry — no new tool needed.

### 3.5 The HTML materializer + the live proof (the crown bite)

The descriptor is data; the CROWN is that a browser can RUN it. P7 ships a minimal AGNOSTIC HTML
materializer:

```ts
// src/compiler/materialize-html.ts — AGNOSTIC (no instances/, no productKey literal)
export function materializeHtml(descriptor: BrowserRuntimeDescriptor): string { /* … */ }
```

`materializeHtml`:

- Renders `descriptor.views` as a nested DOM tree (one element per `RenderNode`, `data-node-id` =
  the node id, nesting = `children`) — so the page DOM is the PlanTree, node-for-node and
  edge-for-edge.
- Renders, for each `InteractionBinding`, a `<button data-node-id data-effect-declaration-id>` whose
  click handler emits a STRUCTURED event carrying `{ nodeId, effectDeclarationId }` (e.g.
  `window.__firedInterventions.push(...)` + a `CustomEvent('foundry:intervention-fired', { detail })`).
  This is the genuine actuation: clicking the button FIRES the intervention.
- Is self-contained (inline script, no network) so it loads from a `file://` URL with no server.
- Is AGNOSTIC: it consumes only the descriptor shape; it contains no `instances/` import and no
  `productKey` literal, so the ADR-243 glob test auto-covers it (it lives under `src/compiler/`).

The LIVE proof is a browser-automation acid (§5 acid 4): load the emitted HTML in a real browser,
assert the rendered DOM node-count + edges + ids match the PlanTree 1:1, click an intervention
button, and assert it FIRES `{ nodeId, effectDeclarationId }` with an id that EXISTS on that node's
declared effects. Because browser automation can be non-deterministic in CI, this live acid is
GATED + flaky-tolerant (the `FOUNDRY_TEARING_STRESS` precedent — `test/concurrent-writer.acid.test.ts:321`
gates a platform-dependent negative control behind an env flag). The **deterministic core acid is
the descriptor mapping** (§5 acids 1–3), which runs unconditionally and is the real kill-criterion;
the live browser click is the crown demonstration on top.

### 3.6 Architecture diagram

```text
                                   ┌─ Target A: compile(bp) → TestHarnessReport     (ADR-250)
ProductBlueprint bp ──┐            │
{ process: PlanTree } ─┤─ COMPILER ┤─ Target B: compile(bp) → RenderNode            (ADR-250, two-trees)
{ done: string[] }    │  (agnostic,│
                      │   ADR-243) │─ Target C: compile(bp) → BrowserRuntimeDescriptor   (P7, the crown)
                      └────────────┘        views        = PlanTree projected 1:1 (Target B discipline)
                                            interactions = button per DECLARED EFFECT on each node
                                                             { nodeId, effectDeclarationId }  ← REFERENCE
                                                             (no effects on a node → NO button = neg. control)
                                                  │
                                   materializeHtml(descriptor) → self-contained HTML
                                                  │   button-click → fires { nodeId, effectDeclarationId }
                                            ┌──────┴──────┐
                                            ▼             ▼
                                    LIVE browser acid (gated): load HTML, click button,
                                    assert intervention FIRES + DOM == PlanTree 1:1
```

---

## 4. Agnosticism analysis (ADR-243)

The new files live under `src/compiler/` and MUST pass the ADR-243 agnosticism gate. The gate is the
auto-discovering glob test (`test/compiler.acid.test.ts:338-393`): it reads EVERY `.ts` under
`src/compiler/` and asserts none imports `instances/`, none contains a `productKey` literal
(`'whales-and-bubbles'` / `'foundry'`), and every import resolves to `@de-braighter/substrate-contracts`,
`@de-braighter/design-system-core`, or a relative path. Because the test auto-discovers files
(`readdirSync(compilerDir).filter(f => f.endsWith('.ts'))`, `compiler.acid.test.ts:345`), the new
`target-browser-runtime.ts`, `materialize-html.ts`, and the refactored `plan-tree-to-render-node.ts`
are covered with ZERO test change — adding the files is enough.

P7's targets honour this by construction:

- `target-browser-runtime.ts` imports ONLY `@de-braighter/design-system-core` (RenderNode, type),
  `@de-braighter/substrate-contracts/plan-tree` (PlanNode/PlanTree, type), `./compile-target.js`,
  and `../metamodel/blueprint.js` (the foundry-local ProductBlueprint shape — a relative path,
  already imported by both existing targets). No `instances/`, no productKey literal.
- `materialize-html.ts` imports ONLY the relative descriptor type. No domain vocabulary.

**The agnosticism BITES:** the same generic `browser-runtime` compile handles WHALES + FOUNDRY
blueprints; the descriptors differ by DATA (node counts, ids, which nodes carry effects), not by
code path (§5 acid 3).

---

## 5. Acid battery — must BITE

The deterministic core (acids 1–3) runs unconditionally in `ci:local`. The live browser proof
(acid 4) is gated + flaky-tolerant. Acid 5 is the agnosticism gate (auto-covered).

1. **Faithful projection (views 1:1 with the PlanTree).** For WHALES (real, yield-bearing) AND an
   independently-authored fixture: `descriptor = browserRuntimeTarget.compile(bp)`. Assert
   `countNodes(descriptor.views) === bp.process.nodes.length`, `renderEdges(descriptor.views) ===
   planEdges(bp.process)`, and the view ids === the PlanNode ids 1:1 (sorted) — the SAME assertions
   Target B passes (`compiler.acid.test.ts:74-87`). **MUTATION → RED:** drop a node from
   `bp.process.nodes` (leaving a dangling `childrenIds`) → `countNodes(descriptor.views)` shrinks by
   one → the count/edges assertion flips RED (mirrors `compiler.acid.test.ts:151-181`).

2. **Button = declared intervention (the binding bites) + negative control.** Use the `ARC_CASCADE`
   fixture (`src/plan/cascade.ts:76-100`): the `pr:devloop-scaffold` node carries exactly one
   `EffectDeclaration` (`indicatorId: 'coverage'`, `direction: '+'`), every other node carries NONE.
   - **Positive:** `descriptor.interactions` contains EXACTLY one binding for the
     `pr:devloop-scaffold` node, and `binding.effectDeclarationId` EXISTS in that node's
     `effectDeclarations.map(e => e.declarationId)`. The binding count equals the total
     `effectDeclarations` across all nodes.
   - **Negative control:** every node WITHOUT `effectDeclarations` contributes ZERO bindings — assert
     no `InteractionBinding.nodeId` references an effect-less node.
   - **MUTATION → RED (break the binding):** (i) reference a non-existent `effectDeclarationId` — the
     acid asserts every binding's `effectDeclarationId` exists on its node's declared effects, so a
     fabricated id flips RED; (ii) bind a button to an effect-less node — the acid asserts the
     binding set's `nodeId`s are exactly the nodes WITH effects, so a spurious binding on an
     effect-less node flips RED. Both mutations bite.

3. **Agnosticism (the kill-criterion).** The SAME generic `browser-runtime` compile handles WHALES +
   FOUNDRY with NO product-specific branch: both produce faithful descriptors; the descriptors
   differ by data (different `views` node counts, different `interactions` sets), not by code path.
   Assert `countNodes(whalesDescriptor.views) !== countNodes(foundryDescriptor.views)` and each
   mirrors its own blueprint (mirrors `compiler.acid.test.ts:89-110`).

4. **LIVE browser-click proof (the crown — gated, flaky-tolerant).** `materializeHtml(descriptor)`
   → a self-contained HTML string; load it in a real browser (playwright or chrome-devtools MCP from
   a `file://` URL). Assert: (a) the rendered DOM node-count (elements carrying `data-node-id`) +
   nesting edges + ids match the PlanTree 1:1 (the "website IS the model" is VISIBLE); (b) clicking
   the `pr:devloop-scaffold` intervention button FIRES a structured `{ nodeId, effectDeclarationId }`
   whose `effectDeclarationId` EXISTS on that node's declared effects (the genuine "button-click =
   intervention"); (c) an effect-less node has NO button to click. **GATED** behind an env flag
   (the `FOUNDRY_TEARING_STRESS=1` precedent, `test/concurrent-writer.acid.test.ts:321-324`) and
   flaky-tolerant, because browser automation is non-deterministic in CI. The deterministic descriptor
   mapping (acids 1–3) is the real kill-criterion; this is the crown demonstration on top.

5. **Agnosticism gate holds (auto-covered).** The existing ADR-243 glob test
   (`compiler.acid.test.ts:338-393`) passes with the three new `src/compiler/*.ts` files present —
   no `instances/` import, no productKey literal, all imports on the allow-list. Zero test change
   (auto-discovery).

6. **Determinism.** `browserRuntimeTarget.compile(bp)` called twice on the same blueprint →
   deep-equal output; `materializeHtml(descriptor)` is a pure string function (deep-equal on the same
   descriptor). Mirrors `compiler.acid.test.ts:209-219`.

7. **Builds green.** Full foundry suite stays green; Target A + Target B + the registry + the MCP
   compile tool are untouched in behaviour (the registry gains one additive entry; the shared
   `plan-tree-to-render-node.ts` refactor is behaviour-preserving — Target B's existing acid still
   passes).

---

## 6. AUTONOMY(2) — internal-only, never marketed

The browser-runtime is INTERNAL infrastructure — a compile target that proves the substrate model
can be RUN, not a product positioned externally. Per the north-star Option A framing (§9) and the
ADR-250 precedent ("the compiler and the 'product-compiler' thesis are built, not marketed"), P7 is
built, not marketed. No "live app generator" / "no-code substrate runtime" external positioning. This
is AUTONOMY(2): the slice can ship autonomously precisely because it stays internal — the moment it
were positioned externally, that would be a founder-gated product decision, not a build slice.

---

## 7. Alternatives considered

### A. `InterventionDescriptor` in `@de-braighter/substrate-contracts` — REJECTED (the kernel-risk)

A kernel contract type describing "a triggerable intervention" (the handoff's flagged risk).

- **Pro:** a single canonical intervention-binding shape every pack could import.
- **Con:** FAILS both legs of the ADR-176 inclusion test (§2.2) — a button affordance is not one of
  the four kernel concerns, and no second pack needs the kernel to validate/version a button binding.
  The intervention ITSELF is already kernel (`PlanNode` + `EffectDeclaration`); a NEW descriptor would
  duplicate existing kernel data behind a presentation type, AND violate ADR-240 D1 (presentation
  types live in `design-system-core`, never `substrate-contracts`). **Rejected: this is the exact
  kernel-bloat the inclusion test exists to stop.** The binding references existing kernel ids; it
  does not need a kernel contract.

### B. An `Action`/`Trigger` type in `@de-braighter/design-system-core` — REJECTED

Author the button-binding type in design-system-core alongside `RenderNode`.

- **Pro:** co-located with the presentation `RenderNode`.
- **Con:** design-system-core exports no such type today (verified §1 recon), and the binding is
  foundry-SPECIFIC (it references a substrate `EffectDeclaration.declarationId` — a substrate concept
  design-system has no business knowing). Adding a substrate-aware binding type to design-system-core
  would couple the design-system layer to substrate semantics. **Rejected: the binding is a foundry
  COMPOSITION of two upstream types (RenderNode + the effect-declaration reference), so it is authored
  in the foundry pack** — the same place Target B's `PlanNodeProps` lives
  (`target-render-tree.ts:11`).

### C. Bind the button to a kernel tree-edit op (ADR-240 D4 EditIntent) NOW — DEFERRED

ADR-240 D4 names the `EditIntent` → kernel `TreeEditSchema` verb binding as the future runtime
edit-op link. P7 could wire a button-click to an actual kernel `metadata-patch` / `subtree-insertion`
edit.

- **Pro:** a button that EDITS the live plan tree, not just fires a marker.
- **Con:** that is a SECOND, heavier concern (mutating the kernel tree through the runtime) — it
  pulls in the runtime edit engine, RLS scope, and persistence. P7's crown claim is "button-click =
  intervention TRIGGER" (fire the declared effect), which the `{ nodeId, effectDeclarationId }` emit
  satisfies WITHOUT any kernel mutation. **Deferred, demand-driven per ADR-176 §3:** wire the
  EditIntent → tree-edit-op binding when a consumer needs the live runtime to MUTATE the tree, not
  just signal an intervention. The thinnest crown fires the declared effect; it does not edit the
  plan.

---

## 8. Slice scope

- **foundry:** add `browserRuntimeTarget` + the `BrowserRuntimeDescriptor` /
  `InteractionBinding` / `BrowserViewProps` types (`src/compiler/target-browser-runtime.ts`, new);
  factor Target B's faithful projection into a shared `src/compiler/plan-tree-to-render-node.ts`
  (behaviour-preserving refactor; Target B imports it); register the target in
  `src/compiler/registry.ts` (one additive entry); add the agnostic `materializeHtml`
  (`src/compiler/materialize-html.ts`, new); add the deterministic acid battery
  (`test/compiler-browser-runtime.acid.test.ts`, new — faithful-projection + button-binding +
  negative-control + agnosticism + determinism); add the GATED live browser acid
  (`test/browser-runtime-live.acid.test.ts`, new — load HTML, click, assert fire; gated behind an
  env flag, flaky-tolerant). **No `@de-braighter/substrate-*` change. No `@de-braighter/design-system-core`
  change.**
- **specs:** ADR-259 (proposed) — codifies the ADR-176 inclusion-test verdict (pack-level, no kernel
  change; `InterventionDescriptor` REJECTED) + the `BrowserRuntimeDescriptor` target design + the
  agnosticism gate + the AUTONOMY(2) internal-only note.

P7 stands on ADR-250 (the `CompileTarget` interface it implements as Target C; ADR-250 named this
exact slice as deferred), ADR-252 (the registry it registers into), and ADR-240 (the two-trees
binding + the RenderNode home it composes). It depends on none of P1/P3/P4/P5/P6 — the browser-runtime
target is orthogonal to yields-in-log, self-event-sourcing, concurrent-writer safety, the hierarchy,
and the scheduled wake.

---

## 9. What does NOT change

- **No kernel contract.** `@de-braighter/substrate-contracts` is BYTE-UNCHANGED — no
  `InterventionDescriptor`, no new field. The intervention is the existing `PlanNode` +
  `EffectDeclaration`; the button binding references them (§2).
- **No design-system change.** `@de-braighter/design-system-core` is unchanged — `RenderNode` is
  imported as a type (ADR-240 D1); no `Action`/`Trigger` type is added there (Alternative B).
- **`CompileTarget<O>` interface — unchanged.** Target C is a pure additive implementation; the
  interface (`compile-target.ts:7`) does not change (the ADR-250 non-foreclosure promise).
- **Target A + Target B behaviour — unchanged.** The registry gains one entry; the shared-projection
  refactor preserves Target B's output (its existing acid still passes).
- **No live plan-tree mutation.** A button fires the declared effect (`{ nodeId, effectDeclarationId }`);
  it does NOT edit the kernel tree (the ADR-240 D4 EditIntent binding is deferred, Alternative C).

---

## 10. Deferred

- **EditIntent → kernel tree-edit-op binding (ADR-240 D4)** — a button that MUTATES the live plan
  tree (Alternative C). Demand-driven per ADR-176 §3.
- **A real interaction effect beyond the fired marker** — the materialized button fires a structured
  `{ nodeId, effectDeclarationId }`; wiring that to a live inference re-run / counterfactual in the
  browser is a later arc (the descriptor carries enough to do it; the runtime wiring is deferred).
- **Richer presentation** (styling, layout strategy, board-kit `RenderDefinition` integration) — the
  materializer is minimal (the crown is "it RUNS + the button FIRES", not "it is pretty"). Board-kit
  painting of the `views` tree is the ADR-250 OQ-2 presentation arc.
- **android / PDF / further targets** — the `CompileTarget` interface keeps them additive (ADR-250).
