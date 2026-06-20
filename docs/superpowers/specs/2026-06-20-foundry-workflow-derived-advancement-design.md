# Derived workflow advancement — the `FOUNDRY_WORKFLOW` tree drives ITSELF

> Slice 1 ([ADR-263](../../../layers/specs/adr/adr-263-foundry-workflow-first-class-actions.md))
> promoted the foundry WORKFLOW to a first-class plan tree (`FOUNDRY_WORKFLOW`) — a FLAT fan-out of
> pipeline-stage nodes (`intake → gate → build-path → conduct → ship`) under one root — and gave its
> interventions a substrate-correct way to ACTUATE (a kind-keyed action registry). Slice 2
> ([ADR-264](../../../layers/specs/adr/adr-264-foundry-workflow-build-path-cross-tree.md)) let a stage
> SPAWN a product tree across trees. But the workflow tree is **static** today: nothing makes it
> ADVANCE from one stage to the next on its own. ADR-263 **D4** ruled how it MUST advance — completion
> is an EVENT, the next stage's reachability is a DERIVED dependency evaluated by the SAME frontier
> fold, poked by an external re-check (scheduled-wake, P6), **never a callback** — and ADR-263 **OQ-1**
> left ONE sub-question open: does the workflow's own frontier REUSE `planFrontier`, or need a distinct
> fold? **Slice 3 resolves OQ-1 (reuse `planFrontier`) and builds the advancement.** Stages gain
> `dependsOn` edges (the pipeline ORDER, as dependencies between SIBLING stages — never tree nesting); a
> `workflowFrontier(state, now)` derives the READY stage by REUSING the EXISTING `planFrontier` fold
> over `buildCascadeTree(FOUNDRY_WORKFLOW)`; stage completion is the EXISTING done-event
> (`ClaimReleased` outcome `done`, the encoding P3/ADR-254's bootstrap already uses); and advancing the
> workflow is pure RE-DERIVATION poked by scheduled-wake — NO callback, NO stored next-pointer. **Zero
> kernel change** — the workflow tree is the existing plan-tree primitive, `dependsOn` is existing,
> `planFrontier` is existing, the done-event is existing (ADR-176 NOT triggered, both legs fail → pack
> territory).

- **Date:** 2026-06-20
- **Scope:** `domains/foundry` — extend the Slice-1/2 workflow module:
  - `src/instances/foundry-workflow.ts` (extend) — the existing stage nodes gain `meta.dependsOn`
    (the pipeline ORDER, between SIBLING stages: `gate dependsOn intake`, `build-path dependsOn gate`,
    `conduct dependsOn build-path`, `ship dependsOn conduct`) and `meta.itemId` (so each stage is a
    foldable work-item leaf; see OQ-1 §2.2), keeping the FLAT single-parent topology from Slice 1
    (`foundry-workflow.ts:40-105`). The workflow becomes a **product-of-stages** with a stable
    `productKey` (`'foundry-workflow'`, already on the root meta, `foundry-workflow.ts:45`).
  - `src/workflow/frontier.ts` (new) — `workflowFrontier(state, now): ItemState[]`, a THIN wrapper:
    `planFrontier(buildCascadeTree(FOUNDRY_WORKFLOW), state, now)` (`plan/frontier.ts:96`), returning the
    ready stage(s). NO new fold, NO second claimability rule.
  - `src/instances/foundry-workflow-bootstrap.ts` (new — OR extend `foundry-bootstrap.ts`) — a pure
    `foundryWorkflowBootstrapEvents(state, ts)` that REGISTERS the workflow product + queues each stage
    as a `WorkItemQueued` (carrying its `dependsOn`), mirroring `foundryBootstrapEvents`
    (`instances/foundry-bootstrap.ts:26-95`) exactly. This is the write path that makes stage-status
    FOLDABLE.
  - `src/plan/plan-frontier-all.ts` (extend) — EXCLUDE the workflow product from the conductor-driving
    union (a `CONDUCTOR_EXCLUDED` set, the FOUNDRY_PRODUCT "vestigial-but-kept, outside `foundry_next`"
    carve-out per [ADR-247](../../../layers/specs/adr/adr-247-foundry-doing-side-unified-queue-shadow-retired.md)),
    so the workflow frontier stays ISOLATED from the product conductor until Slice 4 deliberately wires
    it (`plan-frontier-all.ts:24-26`).
  - `src/ops.ts` (extend) — `wake` (`ops.ts:489-506`) ALSO returns the workflow frontier
    (`{ fired, frontier, workflowFrontier }`), so P6's external clock POKES the re-derivation. No new
    write machinery — `wake` already appends `WakeFired` + re-projects; this adds one read.
  - `test/workflow-advance.acid.test.ts` (new) — the five acids below, every one against a TEMP log.
  - It REUSES `planFrontier` (`src/plan/frontier.ts:96`), `claimableItems` / `depsSatisfied` /
    `itemDone` (`src/state.ts:498,404,124`), `buildCascadeTree` (`src/plan/cascade.ts:24`), the
    `ClaimReleased` done-event (`src/events.ts`, folded at `state.ts:233-244`), `planFrontierAll`
    (`src/plan/plan-frontier-all.ts:24`), the bootstrap pattern (`instances/foundry-bootstrap.ts:26`),
    and the P6 `wake` op (`src/ops.ts:489`). **No `@de-braighter/substrate-*` change. No
    `@de-braighter/design-system-*` change.**
- **Predecessors / boundary:**
  [ADR-263](../../../layers/specs/adr/adr-263-foundry-workflow-first-class-actions.md) (Slice 1 — D4
  derived-not-callback + OQ-1, the sub-question this slice resolves),
  [ADR-264](../../../layers/specs/adr/adr-264-foundry-workflow-build-path-cross-tree.md) (Slice 2 — the
  workflow can now SPAWN; Slice 3 makes it ADVANCE),
  [ADR-256](../../../layers/specs/adr/adr-256-foundry-scheduled-wake-actuation.md) (P6 scheduled-wake —
  the EXTERNAL clock; `dueWakes` / `wake` re-checks `planFrontierAll`; this slice extends `wake` to ALSO
  return the workflow frontier),
  [ADR-244](../../../layers/specs/adr/adr-244-foundry-conductor-drives-plan-tree-frontier.md)
  (`planFrontier = claimableItems ∘ projectTreeState` — the M1 ONE-encoding principle the workflow
  frontier reuses),
  [ADR-246](../../../layers/specs/adr/adr-246-foundry-queue-events-are-plan-node-declarations.md) /
  [ADR-247](../../../layers/specs/adr/adr-247-foundry-doing-side-unified-queue-shadow-retired.md)
  (`treeFromQueue` + `planFrontierAll` universal; ONE claimability encoding; the FOUNDRY_PRODUCT
  vestigial-but-kept exclusion from the conductor set — the exclusion pattern this slice copies),
  [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) (the
  inclusion test — §6, both legs fail → pack territory),
  [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) (the four kernel concerns; the
  plan tree is §1.1, reproducibility §1.4 — the reason advancement must be DERIVED not callback).
- **Provenance.** Recon-confirmed against the live foundry source: the frontier composition
  (`planFrontier(tree, s, nowMs) = claimableItems(projectTreeState(tree, s), nowMs)` filtered to the
  tree's `productKey`, `src/plan/frontier.ts:96-99`); the claimability rule
  (`claimableItems`, `src/state.ts:498-510` — `itemStatus === 'queued' ∧ depsSatisfied ∧
  scope-disjoint`); `depsSatisfied` (`src/state.ts:404-408` — `dependsOn.every(d => itemDone(dep))`,
  the EXACT deps-done reachability rule); `itemDone` (`src/state.ts:124-126` — `merged != null ∨
  claims.some(c => c.released?.outcome === 'done')`, the done-event encoding); the `projectTreeState`
  leaf filter (`src/plan/frontier.ts:44` — only `kind === 'work-item'` leaves become foldable items —
  the load-bearing OQ-1 §2.2 fact); the bootstrap done-pair encoding
  (`instances/foundry-bootstrap.ts:87-91` — `claimAcquired` + `claimReleased(outcome:'done')` makes
  `itemDone()` true from the log alone, NO `MergeRecorded`); `planFrontierAll`'s product iteration
  (`src/plan/plan-frontier-all.ts:24-26` — `for (const productKey of s.products.keys())`); the P6
  `wake` op (`src/ops.ts:489-506` — appends `WakeFired`, returns `{ fired, frontier }` where
  `frontier = planFrontierAll(s, nowMs).map(toNextItem)`); the FOUNDRY_PRODUCT vestigial-but-kept
  carve-out (ADR-247 §"What becomes vestigial" — orchestrator-driven, outside `foundry_next`).

---

## 1. The static workflow — and why "advance" must be DERIVED

After Slice 2, `FOUNDRY_WORKFLOW` is a real plan tree that can ACTUATE (Slice 1) and SPAWN (Slice 2).
But it does not MOVE. There is no node, no event, no function that says "intake is done, so gate is now
the ready stage". The pipeline order lives only in the ARROW NOTATION of the spec comment
(`foundry-workflow.ts:1-6` — "The tree does NOT encode stage ordering: sequencing will come from
derived `dependsOn` edges in a LATER slice"). This is that later slice.

The product tree already advances this way — and the workflow is the SAME plan-tree primitive, so it
advances the SAME way:

| | The product tree (the WHAT) | The workflow tree (the HOW) |
|---|---|---|
| **Order** | `dependsOn` between work-items (a leaf depends on another leaf). | TODAY: nowhere (the arrows are a comment). Slice 3: `dependsOn` between SIBLING stages. |
| **Ready set** | `planFrontier(treeFromQueue(p), state, now)` — claimable = queued ∧ deps-done ∧ scope-disjoint (`frontier.ts:96`, `state.ts:498`). | Slice 3: `workflowFrontier = planFrontier(buildCascadeTree(FOUNDRY_WORKFLOW), state, now)` — the SAME fold. |
| **Completion** | `MergeRecorded` OR `ClaimReleased(outcome:'done')` → `itemDone()` true (`state.ts:124`). | Slice 3: the SAME `ClaimReleased(outcome:'done')` done-event (the bootstrap encoding). |
| **Advance** | Re-derive the frontier over the log (deterministic, idempotent); poked by scheduled-wake (P6). | Slice 3: re-derive `workflowFrontier` over the log; poked by the SAME scheduled-wake. |

The crux ADR-263 D4 already settled: advancement is **DERIVATION**, never a callback. When intake's
completion event lands, NOTHING is called — the next `wake` (or any read) RE-DERIVES the frontier and
gate is now ready, because `depsSatisfied(gate)` is now true. A callback (`onIntakeDone → openGate`)
would be ephemeral and invisible to replay/reproducibility (ADR-127 §1.4), the twin, and the
derive-from-log cockpit (ADR-261). P6 (ADR-256) made exactly this call for the conductor's own wake:
the clock is EXTERNAL, the due-set is DERIVED. The workflow advances on the same principle.

---

## 2. OQ-1 RESOLVED — reuse `planFrontier`, via a registered-but-excluded product-of-stages

ADR-263 OQ-1, verbatim: *"Does the workflow's own frontier reuse `planFrontier(buildCascadeTree(
FOUNDRY_WORKFLOW), state, now)` directly, or does it need a distinct fold (the workflow nodes are
pipeline STAGES, not claimable work-items)?"*

**Verdict: REUSE `planFrontier`. No distinct fold, no second claimability rule.** The resolution has
two parts — the rule, and the foldability mechanism the rule needs.

### 2.1 The rule is ALREADY the right rule — reuse it (the ADR-247 one-encoding principle)

`planFrontier` computes exactly the workflow's reachability semantics already. A stage is READY iff its
`dependsOn` are all DONE and it is not itself done. `claimableItems` (`state.ts:498-510`) is:

```text
queued(i)  ∧  depsSatisfied(s, i)  ∧  scope-disjoint(i, every active claim)
```

and `depsSatisfied(s, i) = i.dependsOn.every(d => itemDone(s.items.get(d)))` (`state.ts:404-408`). That
IS "deps-done ∧ not-done" — the workflow-stage reachability rule, already encoded, already tested.
Reusing it honors ADR-247's M1 principle: **there is exactly ONE claimability encoding** — the
tree-driven frontier can never silently re-encode the rule. Authoring a second `workflowFrontier` fold
would be a second encoding to drift (the exact M1 review lesson). So `workflowFrontier` is a THIN
wrapper, not a fold:

```ts
// src/workflow/frontier.ts (new) — NO new fold. ONE-encoding (ADR-247 M1).
import { buildCascadeTree } from '../plan/cascade.js';
import { planFrontier } from '../plan/frontier.js';
import { FOUNDRY_WORKFLOW } from '../instances/foundry-workflow.js';
import type { DerivedState, ItemState } from '../state.js';

/** The READY workflow stage(s): the stage whose dependsOn are all done and which is
 *  not itself done. REUSES planFrontier over the workflow tree — the SAME fold the
 *  product frontier uses (ADR-247 M1: one claimability encoding, no second rule). */
export function workflowFrontier(state: DerivedState, nowMs: number): ItemState[] {
  return planFrontier(buildCascadeTree(FOUNDRY_WORKFLOW), state, nowMs);
}
```

### 2.2 The foldability mechanism — register the workflow as a product-of-stages, EXCLUDE it from the conductor

`planFrontier` reads STATUS (`claims`, `merged`, `dependsOn`) from `DerivedState.items`, and
`projectTreeState` only turns `kind === 'work-item'` leaves into foldable items
(`frontier.ts:44` — `if (n.kind !== 'work-item') continue`). So for `planFrontier` to evaluate
stage reachability, the stages must be FOLDABLE — tracked in `state.items` with a status that can become
"done". The cleanest way to make that true, with the LEAST new surface, is the mechanism the foundry
ALREADY uses for its own meta-product:

**RECOMMENDATION — register `FOUNDRY_WORKFLOW` as a product-of-stages (stages = work-items carrying
`dependsOn`) in the log, EXCLUDED from `planFrontierAll`'s conductor-driving set.** Concretely:

1. **Stages become work-item leaves.** Each stage node carries `meta.itemId` (e.g.
   `foundry-workflow/intake`) and `meta.dependsOn` (the pipeline order between SIBLINGS). The
   `kind` stays the same single-parent FLAT topology from Slice 1 (the stages hang off the one root); the
   ordering is the `dependsOn`, NOT tree depth (ADR-263 D1 — "stage ORDERING comes from a derived
   `dependsOn`, never from tree depth"). For `projectTreeState` to fold them, the leaf `kind` is
   `'work-item'` (or `projectTreeState`'s filter is widened to include `'stage'` — but reusing the
   existing `'work-item'` filter is the smaller diff, so the stage spec leaves carry
   `kind: 'work-item'` with their stage identity preserved in `meta`).
2. **A bootstrap write path registers the product + queues the stages.** A pure
   `foundryWorkflowBootstrapEvents(state, ts)` mirrors `foundryBootstrapEvents`
   (`instances/foundry-bootstrap.ts:26-95`): it emits one `ProductRegistered({ productKey:
   'foundry-workflow', … })` + one `WorkItemQueued` per stage (carrying `dependsOn`). This makes
   stage-status FOLD via the NORMAL machinery — no new event, no new fold case.
3. **Stage completion is the EXISTING done-event.** A stage is marked done exactly as the bootstrap
   already marks a done item — a `claimAcquired` + `claimReleased(outcome:'done')` pair
   (`foundry-bootstrap.ts:87-91`), making `itemDone()` true from the log alone (no `MergeRecorded`
   needed). NO new event type.
4. **The workflow product is EXCLUDED from the conductor's all-product union.** `planFrontierAll`
   iterates `s.products.keys()` (`plan-frontier-all.ts:24-26`), so a naively-registered workflow product
   would IMMEDIATELY enter the conductor's frontier — wrong: the conductor must not claim workflow
   stages as if they were product work-items until Slice 4 deliberately wires it. So `planFrontierAll`
   skips a `CONDUCTOR_EXCLUDED` set containing `'foundry-workflow'` — exactly the FOUNDRY_PRODUCT
   "vestigial-but-kept, orchestrator-driven, outside `foundry_next`" carve-out (ADR-247
   §"What becomes vestigial"). The workflow frontier is read EXPLICITLY via `workflowFrontier` (which
   calls `planFrontier` scoped to the workflow `productKey`), and stays ISOLATED from the product
   conductor.

This **maximally reuses the existing fold** (no new fold, no new event, no second claimability rule),
adds the **least new surface** (one thin wrapper + one bootstrap + one exclusion-set entry + the
`dependsOn`/`itemId` on the existing stage nodes), and keeps the **workflow frontier isolated** from the
product conductor until Slice 4.

### 2.3 The rejected alternative — build-from-spec + a lightweight done-signal

The alternative is to NOT register the workflow in the log, and instead compute the frontier purely
from the static `FOUNDRY_WORKFLOW` spec plus a SEPARATE done-signal (e.g. a small `Set<stageKey>` of
completed stages, or a bespoke `WorkflowStageDone` event the fold tracks in its OWN map).

| | Recommended: registered-but-excluded product-of-stages | Rejected: build-from-spec + lightweight done-signal |
|---|---|---|
| **Fold** | REUSES `claimableItems` / `depsSatisfied` / `itemDone` verbatim. | Needs a SECOND status source (a new `WorkflowStageDone` event + a new fold map, OR an out-of-band `Set`). |
| **Encoding** | ONE claimability encoding (ADR-247 M1). | TWO encodings of "done" — `itemDone` for products, a bespoke one for stages → drift risk (the exact M1 lesson). |
| **New surface** | A bootstrap (mirrors the existing one) + one exclusion-set entry. | A new event type + a new fold case + a new derive path. |
| **Isolation from conductor** | The exclusion-set carve-out (proven pattern, ADR-247). | Free (never registered), but at the cost of the second status source. |

The rejected path is **worse on the decisive axis**: it needs a **second status source**. `planFrontier`
reads status from `state.items` via `itemDone`; a build-from-spec path that does not register the
stages cannot use `itemDone`, so it must invent a parallel done-tracking — a second encoding of "done",
which ADR-244/247's M1 principle exists to forbid. The registered-but-excluded path pays a tiny
bootstrap cost to keep ONE encoding. **Recommended path chosen.**

---

## 3. The five key decisions

### KD-1 — The workflow ADVANCES by DERIVATION (the SAME fold), ONE claimability encoding

The workflow frontier is `planFrontier(buildCascadeTree(FOUNDRY_WORKFLOW), state, now)` — the SAME fold
the product frontier uses (`frontier.ts:96`), the SAME `claimableItems` rule (`state.ts:498`), the SAME
`depsSatisfied` reachability (`state.ts:404`). There is NO new fold and NO second claimability rule
(ADR-247 M1). Advancing the workflow is RE-DERIVING this frontier over the log — deterministic
(same `(state, now)` → same frontier) and idempotent (re-deriving never mutates). A `workflowFrontier`
wrapper (§2.1) is the only new function; it computes, it does not store.

### KD-2 — `dependsOn` encodes the pipeline ORDER between SIBLING stages, NOT parent nesting

The pipeline order (`intake → gate → build-path → conduct → ship`) is encoded as `dependsOn` edges
BETWEEN SIBLING stages — `gate dependsOn intake`, `build-path dependsOn gate`, `conduct dependsOn
build-path`, `ship dependsOn conduct`. The stages STAY a flat fan-out under one root (each stage's
single parent is the workflow root, Slice 1's topology, `foundry-workflow.ts:48-104`). This is exactly
the "ordering is a derived `dependsOn`, not tree depth" note Slice 1 left
(`foundry-workflow.ts:4-6`; ADR-263 D1). Tree depth expresses DECOMPOSITION (a stage belongs to the
workflow); `dependsOn` expresses SEQUENCING (a stage runs after another) — two different relations, per
ADR-244 §Context ("Parentage expresses decomposition; the `dependsOn` DAG expresses sequencing"). The
sequence is NEVER a parent chain.

### KD-3 — Control flow is DERIVED, NOT callbacks (ADR-263 D4)

Stage completion is an EVENT (`ClaimReleased` outcome `done`); the next stage's reachability is DERIVED
(`depsSatisfied` becomes true once the predecessor is done); advancing is RE-DERIVATION over the log,
POKED by scheduled-wake (P6's external clock, `dueWakes` / `wake`, `wake.ts:22` / `ops.ts:489`). There
is **no registered in-memory continuation, no callback, no stored next-pointer.** Why not a callback —
the ADR-263 D4 reasons, applied here:

- **Invisible to replay / reproducibility** (a kernel concern, ADR-127 §1.4). A callback is a live
  closure not in the log; a replay cannot reconstruct "gate was scheduled to open when intake finished".
  The derived form IS in the log (the completion event + the `dependsOn` structure), so replay
  reproduces the advanced frontier EXACTLY — the acid (b) bite.
- **Invisible to the twin** (which reasons over the plan tree + the log). A `dependsOn` edge is
  structure the twin sees; a callback is not.
- **Invisible to the cockpit** (ADR-261 derives everything from the log). "Which stage is next" must be
  derivable from the log, not held in a process's memory — else a restart loses it and the dashboard
  cannot show it.
- **P6 already made this call** (ADR-256 D1): the clock stays EXTERNAL, the due-set DERIVED, precisely
  to avoid an in-process timer / continuation. This slice extends the SAME `wake` to ALSO return the
  workflow frontier (KD-4 below).

### KD-4 — The workflow frontier is ISOLATED from the product conductor until Slice 4

The workflow product is EXCLUDED from `planFrontierAll`'s conductor-driving union (a `CONDUCTOR_EXCLUDED`
set, the FOUNDRY_PRODUCT vestigial-but-kept carve-out, ADR-247). The conductor's `nextItems` /
`foundry_next` therefore NEVER surfaces a workflow stage as a claimable product work-item. The workflow
frontier is read ONLY through `workflowFrontier` (an explicit, separate read). P6's `wake` is extended
to return it ALONGSIDE the product frontier — `{ fired, frontier, workflowFrontier }` — so the external
clock POKES the re-derivation, but the two frontiers stay SEPARATE channels. Slice 4 is where the
conductor deliberately walks the workflow frontier and `actuate`s each ready stage's `metadata.action`
(Slice 1's mechanism). Until then, advancement is observable (via `wake` / a direct read) but not
conductor-driven.

### KD-5 — ADR-176 PACK-LEVEL: pure REUSE, zero kernel change, (ideally) no new event type

The workflow tree is the EXISTING plan-tree primitive (`buildCascadeTree`); `dependsOn` is EXISTING
(`projectTreeState` already reads `metadata.dependsOn`, `frontier.ts:60`); `planFrontier` is EXISTING
(`frontier.ts:96`); stage-done REUSES the EXISTING `ClaimReleased(outcome:'done')` event (the bootstrap
encoding, `foundry-bootstrap.ts:90`) — **no new event type**. `workflowFrontier` + the bootstrap + the
exclusion-set entry are pack code. Both ADR-176 inclusion-test legs fail (the workflow frontier is not a
new kernel concern — it is the existing plan-tree-frontier derivation; single consumer
`domains/foundry`) → pack territory. **Zero kernel change.** (§6.)

---

## 4. The mechanism — `workflowFrontier` + the bootstrap + the exclusion + the wake extension

### 4.1 The stage spec gains `dependsOn` + `itemId` (the pipeline order, flat topology preserved)

```ts
// src/instances/foundry-workflow.ts (extend) — flat fan-out preserved; ORDER = dependsOn.
// Each stage: single parent = the workflow root (Slice 1); kind = 'work-item' so projectTreeState
// folds it (frontier.ts:44); meta.itemId binds the foldable item; meta.dependsOn = the SIBLING order.
//   stage-intake      : itemId 'foundry-workflow/intake'     , dependsOn []
//   stage-gate        : itemId 'foundry-workflow/gate'       , dependsOn ['foundry-workflow/intake']
//   stage-build-path  : itemId 'foundry-workflow/build-path' , dependsOn ['foundry-workflow/gate']
//   stage-conduct     : itemId 'foundry-workflow/conduct'    , dependsOn ['foundry-workflow/build-path']
//   stage-ship        : itemId 'foundry-workflow/ship'       , dependsOn ['foundry-workflow/conduct']
// meta.action / effects from Slice 1/2 ride alongside, UNTOUCHED (declaration ⊥ actuation ⊥ ordering).
```

### 4.2 The bootstrap registers the product + queues the stages (mirrors `foundryBootstrapEvents`)

```ts
// src/instances/foundry-workflow-bootstrap.ts (new) — mirrors foundry-bootstrap.ts:26-95.
// IDEMPOTENT: re-running against a state that already has these events emits []. Registers
// ProductRegistered({ productKey: 'foundry-workflow', … }) + one WorkItemQueued per stage
// (carrying dependsOn). This is the write path that makes stage-status FOLDABLE.
export function foundryWorkflowBootstrapEvents(state: DerivedState, ts: string): DomainEventEnvelope[] {
  // …same shape as foundryBootstrapEvents: register product if absent; for each stage leaf not in
  // state, emit itemQueued({ itemId, productKey: 'foundry-workflow', dependsOn, scope, … }).
}
```

### 4.3 The exclusion keeps the workflow OUT of the conductor union

```ts
// src/plan/plan-frontier-all.ts (extend) — the workflow product is conductor-EXCLUDED (ADR-247 carve-out).
const CONDUCTOR_EXCLUDED: ReadonlySet<string> = new Set(['foundry-workflow']);

export function planFrontierAll(s: DerivedState, nowMs: number): ItemState[] {
  const items: ItemState[] = [];
  for (const productKey of s.products.keys()) {
    if (CONDUCTOR_EXCLUDED.has(productKey)) continue; // workflow frontier is read via workflowFrontier
    const frontier = planFrontier(treeFromQueue(productKey, s), s, nowMs);
    items.push(...frontier);
  }
  // …existing global sort, unchanged…
}
```

### 4.4 `wake` ALSO returns the workflow frontier (P6's external clock pokes the re-derivation)

```ts
// src/ops.ts (extend wake, ops.ts:489-506) — return the workflow frontier ALONGSIDE the product frontier.
export function wake(deps, input = {}): { fired: DueWake[]; frontier: NextItem[]; workflowFrontier: NextItem[] } {
  return withStoreLock(deps.dataDir, () => {
    // …existing: append WakeFired per due tick; frontier = planFrontierAll(s, nowMs).map(toNextItem)…
    const workflowFrontier = workflowFrontier_(s, nowMs).map((i) => toNextItem(s, i));
    return { fired: due, frontier, workflowFrontier };
  });
}
```

`wake` already RE-PROJECTS the frontier from the (claimability-unchanged) state after appending
`WakeFired` (ADR-256 D6). Adding the workflow frontier is ONE more read of the same state — no new write
machinery, and the workflow frontier === a direct `workflowFrontier` re-derivation at the same `now`
(acid (d)).

---

## 5. Slice 3 — "the workflow tree advances itself by derivation, not callbacks"

The thinnest falsifiable slice: stages gain `dependsOn`, `workflowFrontier` reuses `planFrontier`,
stage completion is the existing done-event, and advancing is re-derivation poked by scheduled-wake.

### 5.1 Mechanism + file:line touch-points

| # | Touch-point | What |
|---|---|---|
| 1 | `src/instances/foundry-workflow.ts` (extend) | The 5 stage nodes gain `meta.itemId` + `meta.dependsOn` (the SIBLING pipeline order, §4.1); `kind: 'work-item'` so `projectTreeState` folds them (`frontier.ts:44`). Flat single-parent topology preserved (Slice 1). `meta.action` / `effects` ride alongside untouched. |
| 2 | `src/workflow/frontier.ts` (new) | `workflowFrontier(state, now)` = `planFrontier(buildCascadeTree(FOUNDRY_WORKFLOW), state, now)` (`frontier.ts:96`). NO new fold. |
| 3 | `src/instances/foundry-workflow-bootstrap.ts` (new) | `foundryWorkflowBootstrapEvents(state, ts)` — registers the product + queues each stage (mirrors `foundry-bootstrap.ts:26-95`). Idempotent. The foldability write path. |
| 4 | `src/plan/plan-frontier-all.ts` (extend) | `CONDUCTOR_EXCLUDED = new Set(['foundry-workflow'])`; `planFrontierAll` skips it (`plan-frontier-all.ts:24-26`). The ADR-247 carve-out. |
| 5 | `src/ops.ts` (extend `wake`) | `wake` returns `{ fired, frontier, workflowFrontier }` (`ops.ts:489-506`). The external clock pokes the re-derivation. |
| 6 | `test/workflow-advance.acid.test.ts` (new) | The acid battery (§5.2), every acid against a TEMP log. |

The kernel, `substrate-contracts`, the conductor's claim/launch flow, and the dashboard are UNTOUCHED in
Slice 3 (the conductor wiring is Slice 4).

### 5.2 Acid battery — each must BITE

Committed + deterministic, run unconditionally in `ci:local`. Every acid runs against a TEMP log —
NEVER the live one. `now` is pinned via `FoundryDeps.now`.

**(a) Initial state → only the first stage is ready.** Bootstrap the workflow into a temp log (register
the product + queue all 5 stages, NONE done). `workflowFrontier(state, now)` returns EXACTLY the first
stage (`foundry-workflow/intake`, `dependsOn []`); all downstream stages are GATED (gate/build-path/
conduct/ship absent from the frontier — their `dependsOn` are not done). **MUTATION → RED:** give
`intake` a phantom `dependsOn ['foundry-workflow/gate']` → `depsSatisfied(intake)` is false → the
frontier is EMPTY → the "intake is ready" assertion fails. (The reachability gate bites.)

**(b) Record intake-done → re-derive → the frontier ADVANCES; a FRESH fold reproduces it.** Append the
done-pair for `intake` (`claimAcquired` + `claimReleased(outcome:'done')`, the bootstrap encoding) →
re-`fold` the temp log → `workflowFrontier(state, now)` now returns `gate` (its sole `dependsOn`,
`intake`, is done) and intake is gone (done items are not claimable). Downstream (build-path/conduct/
ship) STAY gated. **BITE (the no-callback proof):** `fold` the temp log FROM SCRATCH (a fresh
`fold(readEnvelopes(logPath))`, no prior in-memory state) → assert the fresh-fold `workflowFrontier`
DEEP-EQUALS the advanced frontier (`gate`). If advancement were a callback or a stored next-pointer, a
fold-from-scratch would NOT advance (the pointer would be absent / the closure not in the log) → the
fresh-fold-equals-advanced assertion fails → RED. Advancement is pure re-derivation over the log.

**(c) Walk the WHOLE pipeline in order; out-of-order completion does NOT ungate.** Mark
intake → gate → build-path → conduct done in order, re-deriving after each → the frontier advances
stage-by-stage (`gate`, then `build-path`, then `conduct`, then `ship`), ending at `ship` after conduct
is done. SEPARATELY: from the initial state, mark `build-path` done WITHOUT marking gate done →
`workflowFrontier` STILL returns only `intake` (build-path's `dependsOn ['…/gate']` is unsatisfied, so
marking build-path done does not ungate `conduct`, and build-path itself was never ready). **BITE:**
DROP the `dependsOn ['foundry-workflow/gate']` edge from the `build-path` stage → with intake done,
`build-path` is now exposed PREMATURELY (it has no unmet dep) → it appears in the frontier alongside/
before `gate` → the "out-of-order does not ungate" assertion fails → RED. (The dependency edge is
load-bearing; dropping it exposes a downstream stage early.)

**(d) Poked by the external re-check, not a callback — `wake`'s workflow frontier === a direct
re-derivation.** After (b)'s intake-done, schedule a wake (`scheduleWake`) and call `wake(deps)` at a
due `now` → assert `wake(deps).workflowFrontier` DEEP-EQUALS `workflowFrontier(fold(readEnvelopes(
logPath)), now).map(toNextItem)` — the SAME advanced stage (`gate`), computed two independent ways
(through the wake op and through a direct re-derivation). Call `wake` TWICE at the same `now` → the
`workflowFrontier` is IDENTICAL across calls (deterministic, idempotent — no in-memory continuation
accumulates). **BITE:** if `wake` returned a stale cached frontier (a stored continuation rather than a
fresh re-derivation), the wake-vs-direct deep-equal would diverge after intake-done → RED. (The wake is
a poke that triggers re-derivation, not a callback that fires.)

**(e) ONE encoding — `workflowFrontier` reuses `planFrontier`/`claimableItems`; no second rule
(ADR-247 retirement-guard style).** A source-scan acid asserting `src/workflow/frontier.ts` calls
`planFrontier` (and does NOT re-implement `claimableItems` / `depsSatisfied` / a bespoke "deps-done"
loop) — the ADR-247 §Acid-test #3b retirement-guard pattern (a source-level check that no second
claimability encoding was introduced). PLUS a behavioral assertion: for a hand-authored multi-stage
state, `workflowFrontier(state, now)` ⊆ `claimableItems(projectTreeState(buildCascadeTree(
FOUNDRY_WORKFLOW), state), now)` filtered to the workflow productKey — i.e. it IS `planFrontier`, byte
for byte (the wrapper adds nothing). **BITE:** replace the `workflowFrontier` body with a hand-rolled
`state.items.filter(deps-done ∧ not-done)` loop (a second encoding) → the source-scan guard fails
(`planFrontier` no longer called) AND a divergence between the hand-rolled set and `planFrontier`
(e.g. on a scope-conflict the hand-rolled loop ignores) flips the ⊆ assertion → RED.

### 5.3 What Slice 3 deliberately does NOT do

- It does NOT wire the conductor to WALK the workflow frontier and `actuate` ready stages (Slice 4) —
  the workflow frontier is read by the acid / `wake`, proving the derivation; the conductor's
  `nextItems` still excludes it (KD-4).
- It does NOT add a new event type — stage-done reuses the EXISTING `ClaimReleased(outcome:'done')`.
- It does NOT add a kernel shape — `dependsOn` / `planFrontier` / the done-event are all existing.
- It does NOT surface the workflow frontier on the dashboard (a later rung, reusing ADR-261).

---

## 6. ADR-176 inclusion test — NOT triggered (pack-level)

Applying the inclusion test
([ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) §2 — BOTH
legs must hold for a thing to be kernel):

- **(a) Is "derived workflow advancement" one of the four kernel concerns?** No new kernel shape. The
  plan tree IS a kernel concern (recurse the plan, ADR-127 §1.1), but the workflow tree is the EXISTING
  plan-tree primitive; `dependsOn` is EXISTING (`projectTreeState` already reads it); `planFrontier` is
  EXISTING; the done-event is EXISTING. `workflowFrontier` is a pack-level THIN wrapper, the bootstrap
  is pack code mirroring an existing one, the exclusion-set is pack code. Nothing new is added to the
  kernel.
- **(b) Is the workflow frontier / its advancement needed by ≥2 packs as shared infrastructure the
  kernel must validate / query / version?** No. Single consumer (`domains/foundry`), over foundry's own
  pipeline. No second pack needs the foundry workflow frontier; the kernel must not validate/version a
  pack's advancement wrapper.

**Both legs FAIL → pack territory.** **"Store generators, derive graphs" is UPHELD** (ADR-176 §4): the
workflow STRUCTURE + the stage-completion events live in the log (the generators); the frontier is a
DERIVED view (re-computed on every read, never stored); advancement is re-derivation, never a stored
next-pointer or a live continuation. **Zero kernel change; zero design-system change.**

---

## 7. The ladder — where this sits

| Slice | What | Mechanism |
|---|---|---|
| **1 (shipped)** | A workflow intervention actuates a real action. | `FOUNDRY_WORKFLOW` tree + `actuate`/`actuateNode` + the `ACTION_REGISTRY`. |
| **2 (shipped)** | A workflow intervention SPAWNS a product tree across trees. | `build-path` handler reusing the ADR-249 generate path; cross-link a DERIVED `PlanNodeId` reference. Resolves ADR-263 OQ-2. |
| **3 (this)** | The workflow tree ADVANCES itself by derivation, not callbacks. | Stages gain `dependsOn` (sibling order); `workflowFrontier = planFrontier(buildCascadeTree(FOUNDRY_WORKFLOW), …)` (ONE encoding, ADR-247 M1); stage-done is the EXISTING `ClaimReleased(done)`; advancing is re-derivation poked by scheduled-wake (ADR-256), never a callback (ADR-263 D4). Registered-but-EXCLUDED product-of-stages (the FOUNDRY_PRODUCT carve-out). Resolves ADR-263 **OQ-1**. |
| **4 (next)** | The conductor WALKS the workflow tree. | The conductor pulls `workflowFrontier` (Slice 3) and, for each ready stage with a `metadata.action`, calls `actuate` (Slice 1) — advancing the pipeline autonomously. The `CONDUCTOR_EXCLUDED` carve-out is deliberately LIFTED (or a dedicated workflow-conductor loop is added) so the workflow frontier drives. |
| **5** | T0/T2 variants + the cockpit drives the workflow. | Sibling `FOUNDRY_WORKFLOW` variants; the dashboard (ADR-261/262) surfaces the ready stage + its action as a confirm-gated button. |

Slice 4 (the conductor walks the workflow tree) is the natural next rung: once the workflow can SPAWN
(Slice 2) and ADVANCE (Slice 3), the conductor can DRIVE it — pulling the ready stage and actuating its
action, the HOW now autonomous the way the WHAT already is.

---

## 8. What does NOT change

- **No kernel contract.** `@de-braighter/substrate-contracts` is byte-unchanged — the workflow tree is
  the EXISTING plan-tree primitive, `dependsOn` rides the EXISTING `metadata` (read by
  `projectTreeState`, `frontier.ts:60`), `planFrontier` is EXISTING, and stage-done reuses the EXISTING
  `ClaimReleased` event (no new event type).
- **No design-system change.** Slice 3 has no UI; `workflowFrontier` + the bootstrap + the exclusion are
  pure pack code.
- **No second claimability encoding.** `workflowFrontier` is a thin wrapper over `planFrontier` (ADR-247
  M1; the source-scan acid (e) guards it).
- **The conductor's claim/launch flow is untouched in Slice 3.** `planFrontierAll` EXCLUDES the workflow
  product, so `nextItems` / `foundry_next` never surfaces a stage; the workflow frontier is a separate
  read (`workflowFrontier` / `wake`'s new field) until Slice 4 wires the conductor.

---

## 9. Slice scope

- **foundry:** extend `src/instances/foundry-workflow.ts` (the 5 stage nodes gain `meta.itemId` +
  `meta.dependsOn` — the SIBLING pipeline order; `kind: 'work-item'` for foldability; flat topology
  preserved), add `src/workflow/frontier.ts` (`workflowFrontier` = `planFrontier` over the workflow
  tree — NO new fold), add `src/instances/foundry-workflow-bootstrap.ts`
  (`foundryWorkflowBootstrapEvents` — registers the product + queues the stages, mirrors
  `foundry-bootstrap.ts:26`), extend `src/plan/plan-frontier-all.ts` (the `CONDUCTOR_EXCLUDED` carve-out
  skipping `'foundry-workflow'`), extend `src/ops.ts` `wake` (return `workflowFrontier` alongside
  `frontier`), and add the acids in `test/workflow-advance.acid.test.ts`
  (initial-only-first-stage-ready · record-done-advances-and-fresh-fold-reproduces ·
  walk-the-whole-pipeline-out-of-order-does-not-ungate · wake-workflow-frontier-equals-direct-rederivation ·
  one-encoding-reuses-planFrontier). It REUSES `planFrontier` (`frontier.ts:96`), `claimableItems` /
  `depsSatisfied` / `itemDone` (`state.ts:498,404,124`), `buildCascadeTree` (`cascade.ts:24`), the
  `ClaimReleased(done)` event (the bootstrap encoding, `foundry-bootstrap.ts:90`), `planFrontierAll`
  (`plan-frontier-all.ts:24`), and the P6 `wake` op (`ops.ts:489`). **No `@de-braighter/*` change.**
- **specs:** ADR-265 — codifies the five key decisions: (KD-1) the workflow advances by DERIVATION
  (the SAME `planFrontier` fold, ONE claimability encoding — no second rule, no new fold); (KD-2)
  `dependsOn` encodes the pipeline order between SIBLING stages, NOT parent nesting; (KD-3) control flow
  is DERIVED not callbacks (completion is an event, reachability is derived, advancing is re-derivation
  poked by scheduled-wake, ADR-263 D4 + ADR-256); (KD-4) the workflow frontier is ISOLATED from the
  product conductor (the FOUNDRY_PRODUCT carve-out, ADR-247) until Slice 4; (KD-5) ADR-176 PACK-LEVEL,
  pure REUSE, zero kernel change, no new event type. Resolves ADR-263 **OQ-1**.

This slice depends only on the existing plan-tree frontier (`planFrontier`), the existing
`dependsOn`/`itemDone` machinery, the existing `ClaimReleased(done)` event, the existing bootstrap
pattern, and the P6 `wake` op. It is the realization of ADR-263 D4 — the workflow tree advancing itself
by derivation, the SAME fold as the product frontier, poked by the same external clock, never a
callback.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
