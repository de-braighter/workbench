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
> over a `workflowTree()` PROJECTION of `FOUNDRY_WORKFLOW`'s stages into work-item leaves; stage
> completion is the EXISTING done-event (`ClaimReleased` outcome `done` / `MergeRecorded`, the encoding
> P3/ADR-254's bootstrap already uses); and advancing the workflow is pure RE-DERIVATION poked by
> scheduled-wake — NO callback, NO stored next-pointer. The workflow stays ISOLATED from product-facing
> work by THREE mechanisms (the wave fix-up `34e9fce` made the isolation REAL — non-registration alone
> was not enough once the stages live in `s.items`): (a) NON-REGISTRATION — `bootstrapWorkflow` queues
> the stage work-items but emits NO `ProductRegistered`, so the workflow key is never in `s.products` and
> `planFrontierAll` (which iterates ALL `s.products.keys()` with NO exclusion) cannot pick it up; (b) a
> `productKey === WORKFLOW_PRODUCT_KEY` FILTER excluding the stages from the product-facing `s.items`
> derivations (the dashboard KPIs/pulse/in-flight in `render.ts`, the ACTIVE CLAIMS/STALE/BUILT board
> sections in `status.ts`); (c) excluding workflow-stage items from the cross-product scope-disjointness
> scan in `claimableItems` (`state.ts`), so a stage neither blocks nor is blocked by a real product
> sharing its repo (the disjoint `WORKFLOW_STAGE_REPO` scope is now belt-and-suspenders, NOT the
> claim-check guarantee). The operator trigger is the `foundry_bootstrap_workflow` MCP tool (mirrors
> `foundry_bootstrap`); `wake` returns the workflow frontier alongside `planFrontierAll`. **Zero kernel
> change** — the workflow tree is the existing plan-tree primitive, `dependsOn` is existing, `planFrontier`
> is existing, the done-event is existing (ADR-176 NOT triggered, both legs fail → pack territory).

- **Date:** 2026-06-20
- **Scope (as SHIPPED — branch `feat-workflow-advance`, HEAD `34e9fce`; derivation core in `418f566`,
  the isolation made REAL in the wave fix-up `34e9fce`):** `domains/foundry` — extend the Slice-1/2
  workflow module:
  - `src/instances/foundry-workflow.ts` (extend) — the existing stage nodes gain `meta.dependsOn`
    (the pipeline ORDER, between SIBLING stages: `gate-greenlight dependsOn intake`, `build-path
    dependsOn gate-greenlight`, `conduct dependsOn build-path`, `ship dependsOn conduct`; the shipped
    stage keys are `stage-intake`, `stage-gate-greenlight`, `stage-build-path`, `stage-conduct`,
    `stage-ship`), keeping the FLAT single-parent topology from Slice 1 (`foundry-workflow.ts:49-121`).
    `WORKFLOW_PRODUCT_KEY` (`'foundry-workflow'`) + `WORKFLOW_STAGE_REPO` (`'de-braighter/foundry-workflow'`,
    a disjoint repo) are DEFINED in the new import-free `src/instances/workflow-keys.ts` leaf and
    RE-EXPORTED from `foundry-workflow.ts` for the existing call sites.
  - `src/instances/workflow-keys.ts` (new, import-free leaf) — holds `WORKFLOW_PRODUCT_KEY` +
    `WORKFLOW_STAGE_REPO` with ZERO imports, so `state.ts` (the fold + the `claimableItems` scope scan) and
    `foundry-workflow.ts` (which imports `state.ts`'s fold at module load) can both read them WITHOUT a
    `state.ts ↔ foundry-workflow.ts` module-load cycle.
  - `src/plan/workflow-frontier.ts` (new) — holds three pure functions: `workflowTree()` projects
    `FOUNDRY_WORKFLOW`'s stages into a work-item `PlanTree` (root carries the `productKey`; each stage →
    a `kind: 'work-item'` leaf whose `itemId` IS the stage key, carrying the authored `dependsOn` + the
    `WORKFLOW_STAGE_REPO` scope); `workflowFrontier(state, now): ItemState[]` is a THIN wrapper —
    `planFrontier(workflowTree(), state, now)`, returning the ready stage(s), NO new fold, NO second
    claimability rule; `workflowBootstrapEvents(state, ts)` emits ONLY a `WorkItemQueued` (the EXISTING
    `itemQueued` event) per stage — NO `ProductRegistered`.
  - `src/state.ts` (extend) — `isWorkflowStage(i) = i.productKey === WORKFLOW_PRODUCT_KEY` (`state.ts:499`)
    and `claimableItems` (`state.ts:512`) EXCLUDES workflow-stage items from the cross-product
    scope-disjointness scan: a stage is dropped from `actives` (so it never BLOCKS a real product) AND its
    own `scopesDisjoint` test is skipped (`isWorkflowStage(i) || actives.every(...)`, so it is never
    BLOCKED). The workflow's OWN `dependsOn` gating (`depsSatisfied`) is untouched — only the CROSS-product
    coupling is removed (FIX B). This is what makes the isolation REAL.
  - `src/dashboard/render.ts` + `src/status.ts` (extend) — the product-facing `s.items` derivations gain a
    `productKey === WORKFLOW_PRODUCT_KEY` filter (FIX A): in `render.ts` the KPIs / pulse / in-flight pill
    walk a filtered `allItems` (`render.ts:114`, with `stale`/`inFlight`/`merges` likewise filtered); in
    `status.ts` the `isProductItem` predicate (`status.ts:13`) keeps the stages out of the ACTIVE CLAIMS /
    STALE / BUILT board sections. Without these a stage would surface as product work with no matching
    product row.
  - `src/ops.ts` (extend) — `bootstrapWorkflow(deps)` (`ops.ts:576-590`) appends the
    `workflowBootstrapEvents` (idempotent; queues each stage so its done-status is FOLDABLE — claim/
    release need `s.items.get(itemId)`). And `wake` (`ops.ts:497-518`) ALSO returns the workflow frontier
    (`{ fired, frontier, workflowFrontier }`, the raw `ItemState[]` — the workflow product is not in
    `s.products`, so `toNextItem` can't map it), so P6's external clock POKES the re-derivation. No new
    write machinery — `wake` already appends `WakeFired` + re-projects; this adds one read.
  - `src/mcp/tools.ts` + `src/mcp/server.ts` (extend) — the `foundry_bootstrap_workflow` MCP tool
    (`tools.ts:99`, registered `server.ts:45`) — the OPERATOR trigger that calls `ops.bootstrapWorkflow`
    to queue the stages into the log so `wake().workflowFrontier` has a feed. Mirrors `foundry_bootstrap`.
  - `src/plan/plan-frontier-all.ts` is **UNTOUCHED** — there is NO `CONDUCTOR_EXCLUDED` set; isolation for
    the conductor ITERATION is by NON-REGISTRATION (the workflow key is never in `s.products`, which
    `planFrontierAll` iterates), so ZERO lines are added to the sole conductor driver.
  - `test/workflow-advance.acid.test.ts` (new) — the five acids below, every one against a TEMP log.
  - It REUSES `planFrontier` (`src/plan/frontier.ts`), `claimableItems` / `depsSatisfied` /
    `itemDone` (`src/state.ts:512,405,125`), `buildCascadeTree` (`src/plan/cascade.ts`), the
    `ClaimReleased` done-event / `MergeRecorded`, `projectTreeState`'s ProductState synthesis for an
    un-registered product (`src/plan/frontier.ts`), the `itemQueued` event (`src/events.ts`), and
    the P6 `wake` op (`src/ops.ts:497`). **No `@de-braighter/substrate-*` change. No
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
  (`treeFromQueue` + `planFrontierAll` universal — iterating ALL `s.products.keys()` with NO exclusion;
  ONE claimability encoding the workflow frontier reuses. NOTE: ADR-247's "vestigial" point was the
  removed `source:'plan'` parameter, NOT a FOUNDRY_PRODUCT conductor exclusion — and P3/ADR-254 made
  FOUNDRY_PRODUCT a real conductor-driven product, so there is no carve-out to copy; the workflow stays
  isolated by NON-REGISTRATION instead),
  [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) (the
  inclusion test — §6, both legs fail → pack territory),
  [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) (the four kernel concerns; the
  plan tree is §1.1, reproducibility §1.4 — the reason advancement must be DERIVED not callback).
- **Provenance.** Recon-confirmed against the live foundry source (HEAD `34e9fce`): the frontier
  composition (`planFrontier(tree, s, nowMs) = claimableItems(projectTreeState(tree, s), nowMs)` filtered
  to the tree's `productKey`, `src/plan/frontier.ts`); the claimability rule (`claimableItems`,
  `src/state.ts:512` — `itemStatus === 'queued' ∧ depsSatisfied ∧ (isWorkflowStage ∨ scope-disjoint)`);
  the workflow-stage predicate `isWorkflowStage(i) = i.productKey === WORKFLOW_PRODUCT_KEY`
  (`src/state.ts:499`) that EXCLUDES stages from the cross-product scope scan (FIX B); `depsSatisfied`
  (`src/state.ts:405` — `dependsOn.every(d => itemDone(dep))`, the EXACT deps-done reachability rule,
  UNTOUCHED so the workflow's own ordering is intact); `itemDone` (`src/state.ts:125` — `merged != null ∨
  claims.some(c => c.released?.outcome === 'done')`, the done-event encoding); the `projectTreeState`
  leaf filter + ProductState synthesis (`src/plan/frontier.ts` — only `kind === 'work-item'` leaves become
  foldable items; an un-registered product's `ProductState` is SYNTHESIZED from the tree root, the
  load-bearing fact that lets the workflow advance WITHOUT a `ProductRegistered`); the product-facing
  `productKey` filters (FIX A — `src/dashboard/render.ts:114` for the KPIs/pulse/in-flight, `isProductItem`
  at `src/status.ts:13` for the ACTIVE CLAIMS / STALE / BUILT board sections); the bootstrap done-pair
  encoding (`instances/foundry-bootstrap.ts` — `claimAcquired` + `claimReleased(outcome:'done')` makes
  `itemDone()` true from the log alone); `planFrontierAll`'s product iteration with NO exclusion
  (`src/plan/plan-frontier-all.ts` — `for (const productKey of s.products.keys())`, untouched by this
  slice); the `foundry_bootstrap_workflow` MCP tool (`src/mcp/tools.ts:99`, registered `src/mcp/server.ts:45`);
  the import-free `WORKFLOW_PRODUCT_KEY`/`WORKFLOW_STAGE_REPO` leaf (`src/instances/workflow-keys.ts`).
  CRITICAL CORRECTION (vs the original draft): there is NO `CONDUCTOR_EXCLUDED` set in `planFrontierAll`,
  and FOUNDRY_PRODUCT is NOT excluded from the conductor (P3/ADR-254 made it a real, conductor-driven
  product). The isolation story is THREE mechanisms, NOT non-registration alone: (a) non-registration
  keeps the workflow out of `planFrontierAll`'s iteration; (b) a `productKey` filter keeps it out of the
  product-facing `s.items` views (dashboard/status); (c) the `claimableItems` scope-scan exclusion makes a
  stage scope-INERT in the cross-product claim check. The disjoint `WORKFLOW_STAGE_REPO` scope is now
  belt-and-suspenders, NOT the claim-check guarantee (mechanism (c) is).

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
| **Ready set** | `planFrontier(treeFromQueue(p), state, now)` — claimable = queued ∧ deps-done ∧ scope-disjoint (`frontier.ts:96`, `state.ts:498`). | Slice 3: `workflowFrontier = planFrontier(workflowTree(), state, now)` — the SAME fold over a work-item projection of the stages. |
| **Completion** | `MergeRecorded` OR `ClaimReleased(outcome:'done')` → `itemDone()` true (`state.ts:124`). | Slice 3: the SAME `ClaimReleased(outcome:'done')` done-event (the bootstrap encoding). |
| **Advance** | Re-derive the frontier over the log (deterministic, idempotent); poked by scheduled-wake (P6). | Slice 3: re-derive `workflowFrontier` over the log; poked by the SAME scheduled-wake. |

The crux ADR-263 D4 already settled: advancement is **DERIVATION**, never a callback. When intake's
completion event lands, NOTHING is called — the next `wake` (or any read) RE-DERIVES the frontier and
gate is now ready, because `depsSatisfied(gate)` is now true. A callback (`onIntakeDone → openGate`)
would be ephemeral and invisible to replay/reproducibility (ADR-127 §1.4), the twin, and the
derive-from-log cockpit (ADR-261). P6 (ADR-256) made exactly this call for the conductor's own wake:
the clock is EXTERNAL, the due-set is DERIVED. The workflow advances on the same principle.

---

## 2. OQ-1 RESOLVED — reuse `planFrontier`, isolated BY NON-REGISTRATION

ADR-263 OQ-1, verbatim: *"Does the workflow's own frontier reuse `planFrontier(buildCascadeTree(
FOUNDRY_WORKFLOW), state, now)` directly, or does it need a distinct fold (the workflow nodes are
pipeline STAGES, not claimable work-items)?"*

**Verdict: REUSE `planFrontier`. No distinct fold, no second claimability rule.** The resolution has
two parts — the rule, and the foldability mechanism the rule needs. (This section was reconciled from an
original draft that prescribed a *register-as-product + `CONDUCTOR_EXCLUDED` carve-out* — the implementer's
recon found that needless against the live code; see §2.2.)

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
// src/plan/workflow-frontier.ts (new) — NO new fold. ONE-encoding (ADR-247 M1).
// workflowTree() projects FOUNDRY_WORKFLOW's stages into a work-item PlanTree (root
// carries the productKey; each stage → a work-item leaf whose itemId is the stage key,
// carrying the authored dependsOn + the disjoint WORKFLOW_STAGE_REPO scope) so
// planFrontier reads STRUCTURE from the tree and STATUS from the log-derived state.

/** The READY workflow stage(s): the stage whose dependsOn are all done and which is
 *  not itself done. REUSES planFrontier over the projected workflow tree — the SAME
 *  fold the product frontier uses (ADR-247 M1: one claimability encoding, no second rule). */
export function workflowFrontier(state: DerivedState, nowMs: number): ItemState[] {
  return planFrontier(workflowTree(), state, nowMs);
}
```

### 2.2 The foldability mechanism — build-from-spec + foldable-done, ISOLATED BY NON-REGISTRATION

`planFrontier` reads STATUS (`claims`, `merged`, `dependsOn`) from `DerivedState.items`, and
`projectTreeState` only turns `kind === 'work-item'` leaves into foldable items
(`if (n.kind !== 'work-item') continue`). So for `planFrontier` to evaluate stage reachability, the
stages must be FOLDABLE — tracked in `state.items` with a status that can become "done". But the stages
being live in `s.items` is exactly why non-registration ALONE is not enough: the reviewer proved the
stages would otherwise leak into every derivation that walks `s.items`. The shipped mechanism makes the
stages foldable with the LEAST new surface AND isolates them by THREE mechanisms:

**SHIPPED — build the frontier from the authored spec; make stage-done foldable by queuing ONLY
work-items (NO `ProductRegistered`); isolate by non-registration + a productKey-filter + a scope-scan
exclusion.** Concretely:

1. **STRUCTURE comes from the spec; the projection makes stages foldable.** `workflowTree()`
   (`src/plan/workflow-frontier.ts`) reads which stages exist + their `dependsOn` from the authored
   `FOUNDRY_WORKFLOW` spec and projects each into a `kind: 'work-item'` leaf whose `itemId` IS the stage
   key, carrying the authored `dependsOn` (the SIBLING order) + the disjoint `WORKFLOW_STAGE_REPO` scope.
   `projectTreeState` takes the gating edges FROM THE TREE — dropping a `dependsOn` edge in the spec
   ungates a downstream stage prematurely (acid (c) bite). The FLAT single-parent topology stays (Slice
   1); the ordering is the `dependsOn`, NOT tree depth (ADR-263 D1).
2. **A bootstrap write path queues the stages — NO `ProductRegistered`.** A pure
   `workflowBootstrapEvents(state, ts)` (and its op `bootstrapWorkflow`, `ops.ts:576-590`) emits ONLY one
   `WorkItemQueued` per stage (carrying `dependsOn`, under `WORKFLOW_PRODUCT_KEY`), reusing the EXISTING
   `itemQueued` event + the `foundryBootstrapEvents` shape. A stage is foldable only once it is QUEUED
   (claim/release need `s.items.get(itemId)`). Crucially there is **NO `ProductRegistered`** — the
   workflow key never enters `s.products`. The operator triggers this via the `foundry_bootstrap_workflow`
   MCP tool (`src/mcp/tools.ts` + `server.ts`, mirroring `foundry_bootstrap`).
3. **Stage completion is the EXISTING done-event.** A stage is marked done by the EXISTING
   `claimAcquired` + `claimReleased(outcome:'done')` pair (or `MergeRecorded`), making `itemDone()` true
   from the log alone. NO new event type.
4. **Isolation is THREE mechanisms — non-registration (iteration) + a productKey-filter (product-facing
   views) + a scope-scan exclusion (cross-product claims).**
   - **(a) Non-registration for ITERATION.** `planFrontierAll` iterates `s.products.keys()`
     (`plan-frontier-all.ts`) with **NO exclusion of any kind** — there is no `CONDUCTOR_EXCLUDED` set in
     the code. Because the workflow product is NEVER registered in `s.products` (step 2 queued only
     work-items), `planFrontierAll` cannot iterate it: the product conductor is unaffected BY
     CONSTRUCTION, ZERO lines added. `projectTreeState` SYNTHESIZES the workflow `ProductState` from the
     tree root (the "never queue-registered" path) so `workflowFrontier` resolves priority/repo without a
     product registration. The frontier is read EXPLICITLY via `workflowFrontier` (scoped to
     `WORKFLOW_PRODUCT_KEY`).
   - **(b) productKey-FILTER for product-facing `s.items` derivations (FIX A).** Every derivation that
     surfaces `s.items` as product work EXCLUDES `productKey === WORKFLOW_PRODUCT_KEY`: the dashboard
     KPIs/pulse/in-flight (`render.ts`) and the ACTIVE CLAIMS / STALE / BUILT board sections
     (`isProductItem`, `status.ts`). Without this a stage would show as e.g. `0/6` with no matching
     product row.
   - **(c) Scope-scan EXCLUSION in `claimableItems` (FIX B).** Workflow-stage items are EXCLUDED from the
     cross-product scope-disjointness scan (`state.ts:512`, `isWorkflowStage`) — a stage is scope-INERT
     (out of `actives` as a blocker AND its own `scopesDisjoint` test skipped), so a real product whose
     item scopes the workflow repo stays claimable while a stage holds its claim, and a stage stays
     claimable regardless of a real product's active claim. The workflow's OWN `dependsOn` gating is
     untouched. The disjoint `WORKFLOW_STAGE_REPO` scope is now belt-and-suspenders, NOT the claim-check
     guarantee — mechanism (c) is.

This **maximally reuses the existing fold** (no new fold, no new event, no second claimability rule),
adds the **least new surface** (one thin projection + frontier wrapper + one bootstrap that queues
work-items + the `dependsOn` on the existing stage nodes + the productKey filters / scope-scan exclusion
— and ZERO lines to `planFrontierAll`), and keeps the **workflow frontier isolated** from product-facing
work until Slice 4.

### 2.3 The rejected alternatives

Two alternatives were rejected. The shipped path (§2.2) reads STRUCTURE from the spec (`workflowTree()`)
but queues stage WORK-ITEMS so STATUS folds via the EXISTING `itemDone` — keeping ONE claimability
encoding while isolating the workflow by non-registration.

| | SHIPPED: build-from-spec + foldable work-items, non-registered | Rejected A: register-as-product + `CONDUCTOR_EXCLUDED` | Rejected B: build-from-spec + a lightweight done-signal |
|---|---|---|---|
| **Fold** | REUSES `claimableItems` / `depsSatisfied` / `itemDone` verbatim. | REUSES the same fold — but as a registered product. | Needs a SECOND status source (a new `WorkflowStageDone` event + a new fold map, OR an out-of-band `Set`). |
| **Encoding** | ONE claimability encoding (ADR-247 M1). | ONE encoding. | TWO encodings of "done" → drift risk (the exact M1 lesson). |
| **New surface** | A projection + a bootstrap (queues work-items) + the `dependsOn` on the stages. ZERO conductor-driver lines. | A bootstrap that ALSO registers the product + an explicit `CONDUCTOR_EXCLUDED` set inside `planFrontierAll`. | A new event type + a new fold case + a new derive path. |
| **Isolation from conductor** | THREE mechanisms: (a) the workflow key never enters `s.products`, so `planFrontierAll` (iterating `s.products.keys()`) cannot pick it up — no exclusion code; (b) a `productKey` filter keeps the stages out of the dashboard/status product views; (c) `claimableItems` excludes stages from the cross-product scope scan. | An explicit opt-out list that must stay in sync, with NO FOUNDRY_PRODUCT carve-out precedent (ADR-254 made FOUNDRY_PRODUCT conductor-driven). | Free (never registered), but at the cost of the second status source. |

**Rejected A** (the originally-drafted prescription) is worse because it needs an EXPLICIT exclusion list
in `planFrontierAll` — new conductor-driver code, a set to keep in sync, a leak risk if an exclusion is
ever forgotten — and the FOUNDRY_PRODUCT "carve-out" it claimed to reuse does NOT exist (P3/ADR-254 made
FOUNDRY_PRODUCT a real, conductor-driven product). **Rejected B** is worse because it needs a SECOND
status source: a spec-only path that does not queue the stages cannot use `itemDone`, so it must invent a
parallel done-tracking — a second encoding of "done" the M1 principle forbids. The shipped path pays a
tiny bootstrap cost to keep ONE encoding AND isolates by non-registration with ZERO conductor-driver
lines. **Shipped path chosen.**

---

## 3. The five key decisions

### KD-1 — The workflow ADVANCES by DERIVATION (the SAME fold), ONE claimability encoding

The workflow frontier is `planFrontier(workflowTree(), state, now)` — the SAME fold
the product frontier uses (`frontier.ts:96`), the SAME `claimableItems` rule (`state.ts:498`), the SAME
`depsSatisfied` reachability (`state.ts:404`); `workflowTree()` projects `FOUNDRY_WORKFLOW`'s stages into
work-item leaves so the fold can read them. There is NO new fold and NO second claimability rule
(ADR-247 M1). Advancing the workflow is RE-DERIVING this frontier over the log — deterministic
(same `(state, now)` → same frontier) and idempotent (re-deriving never mutates). A `workflowFrontier`
wrapper (§2.1) is the only new frontier function; it computes, it does not store.

### KD-2 — `dependsOn` encodes the pipeline ORDER between SIBLING stages, NOT parent nesting

The pipeline order (`intake → gate-greenlight → build-path → conduct → ship`) is encoded as `dependsOn`
edges BETWEEN SIBLING stages — `stage-gate-greenlight dependsOn stage-intake`, `stage-build-path dependsOn
stage-gate-greenlight`, `stage-conduct dependsOn stage-build-path`, `stage-ship dependsOn stage-conduct`
(the shipped stage keys). The stages STAY a flat fan-out under one root (each stage's single parent is the
workflow root, Slice 1's topology, `foundry-workflow.ts:48-120`). This is exactly the "ordering is a
derived `dependsOn`, not tree depth" note Slice 1 left (`foundry-workflow.ts:1-16`; ADR-263 D1). Tree depth expresses DECOMPOSITION (a stage belongs to the
workflow); `dependsOn` expresses SEQUENCING (a stage runs after another) — two different relations, per
ADR-244 §Context ("Parentage expresses decomposition; the `dependsOn` DAG expresses sequencing"). The
sequence is NEVER a parent chain.

### KD-3 — Control flow is DERIVED, NOT callbacks (ADR-263 D4)

Stage completion is an EVENT (`ClaimReleased` outcome `done` / `MergeRecorded`); the next stage's
reachability is DERIVED (`depsSatisfied` becomes true once the predecessor is done); advancing is
RE-DERIVATION over the log, POKED by scheduled-wake (P6's external clock, `dueWakes` / `wake`,
`wake.ts:22` / `ops.ts:497`). There is **no registered in-memory continuation, no callback, no stored
next-pointer.** Why not a callback — the ADR-263 D4 reasons, applied here:

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

### KD-4 — The workflow frontier is ISOLATED from product-facing work by THREE mechanisms until Slice 4

The stages live in `s.items` (so their done-status folds), so isolation is THREE mechanisms — the wave
fix-up made it REAL after the reviewer proved non-registration ALONE leaks the stages:

- **(a) Non-registration for ITERATION.** `bootstrapWorkflow` queues the stage work-items but emits NO
  `ProductRegistered`, so the workflow key is NEVER in `s.products`, and `planFrontierAll` (which iterates
  ALL `s.products.keys()` with NO exclusion) structurally cannot pick it up. There is NO `CONDUCTOR_EXCLUDED`
  set — `planFrontierAll` is UNTOUCHED. The conductor's `nextItems` / `foundry_next` therefore NEVER
  surfaces a workflow stage as a claimable product work-item. `projectTreeState` synthesizes the workflow's
  `ProductState` from the tree root, so `workflowFrontier` still resolves priority/repo.
- **(b) productKey-FILTER for product-facing `s.items` derivations (FIX A).** The dashboard KPIs / pulse /
  in-flight (`render.ts`) and the ACTIVE CLAIMS / STALE / BUILT board sections (`isProductItem`,
  `status.ts`) EXCLUDE `productKey === WORKFLOW_PRODUCT_KEY`, so a stage never appears as product work with
  no matching product row.
- **(c) Scope-scan EXCLUSION in `claimableItems` (FIX B).** Workflow stages are excluded from the
  cross-product scope-disjointness scan (`state.ts`), so a stage neither blocks nor is blocked by a real
  product sharing its repo. The disjoint `WORKFLOW_STAGE_REPO` scope is belt-and-suspenders, NOT the
  claim-check guarantee.

The workflow frontier is read ONLY through `workflowFrontier` (an explicit, separate read). P6's `wake` is
extended to return it ALONGSIDE the product frontier — `{ fired, frontier, workflowFrontier }` (the raw
`ItemState[]`, since the workflow product is not in `s.products`) — so the external clock POKES the
re-derivation, but the two frontiers stay SEPARATE channels. The operator trigger that seeds the stages is
the `foundry_bootstrap_workflow` MCP tool (mirrors `foundry_bootstrap`). Slice 4 is where the conductor
deliberately walks the workflow frontier and `actuate`s each ready stage's `metadata.action` (Slice 1's
mechanism). Until then, advancement is observable (via `wake` / a direct read) but not conductor-driven.

### KD-5 — ADR-176 PACK-LEVEL: pure REUSE, zero kernel change, (ideally) no new event type

The workflow tree is the EXISTING plan-tree primitive (`buildCascadeTree`); `dependsOn` is EXISTING
(`projectTreeState` already reads `metadata.dependsOn`, `frontier.ts:60`); `planFrontier` is EXISTING
(`frontier.ts:96`); stage-done REUSES the EXISTING `ClaimReleased(outcome:'done')` / `MergeRecorded` event
— **no new event type**. `workflowTree` + `workflowFrontier` + `workflowBootstrapEvents` /
`bootstrapWorkflow` are pack code; `planFrontierAll` is UNTOUCHED. Both ADR-176 inclusion-test legs fail
(the workflow frontier is not a
new kernel concern — it is the existing plan-tree-frontier derivation; single consumer
`domains/foundry`) → pack territory. **Zero kernel change.** (§6.)

---

## 4. The mechanism — `workflowTree` + `workflowFrontier` + `bootstrapWorkflow` + the wake extension

### 4.1 The stage spec gains `dependsOn` (the pipeline order, flat topology preserved)

```ts
// src/instances/foundry-workflow.ts (extend) — flat fan-out preserved; ORDER = dependsOn.
// Each stage: single parent = the workflow root (Slice 1); kind = 'stage'. The dependsOn names the
// prior stage's KEY, which becomes that stage's work-item itemId in the workflowTree() projection (§4.2).
//   stage-intake          : dependsOn []
//   stage-gate-greenlight : dependsOn ['stage-intake']
//   stage-build-path      : dependsOn ['stage-gate-greenlight']
//   stage-conduct         : dependsOn ['stage-build-path']
//   stage-ship            : dependsOn ['stage-conduct']
// meta.action / effects from Slice 1/2 ride alongside, UNTOUCHED (declaration ⊥ actuation ⊥ ordering).
// WORKFLOW_PRODUCT_KEY = 'foundry-workflow'; WORKFLOW_STAGE_REPO = 'de-braighter/foundry-workflow' (disjoint).
```

### 4.2 The projection + the bootstrap — `workflowTree()` makes stages foldable; the bootstrap queues them (NO `ProductRegistered`)

```ts
// src/plan/workflow-frontier.ts (new). workflowTree() projects FOUNDRY_WORKFLOW's stages into a
// work-item PlanTree (root carries the productKey; each stage → a work-item leaf whose itemId IS the
// stage key, carrying scope = WORKFLOW_STAGE_REPO + the authored dependsOn). planFrontier reads the
// gating edges FROM THE TREE; STATUS folds from the log.
export function workflowTree(): PlanTree { /* root product node + one work-item leaf per stage */ }

// The bootstrap write path that makes stage-status FOLDABLE: emit ONLY WorkItemQueued per stage —
// NO ProductRegistered. So the workflow key never enters s.products (isolation by construction).
// IDEMPOTENT: a stage already in state emits nothing.
export function workflowBootstrapEvents(state: DerivedState, ts: string): DomainEventEnvelope[] {
  // for each stage leaf not in state: emit itemQueued({ itemId, productKey: WORKFLOW_PRODUCT_KEY,
  //   scope: { repo: WORKFLOW_STAGE_REPO }, dependsOn, … }). NO productRegistered.
}
```

### 4.3 Isolation — `planFrontierAll` UNTOUCHED (non-registration) + a productKey-filter + a scope-scan exclusion

```ts
// src/plan/plan-frontier-all.ts — UNCHANGED by this slice. It iterates ALL s.products.keys() with NO
// exclusion. Because bootstrapWorkflow emits NO ProductRegistered, the workflow key is never in
// s.products, so planFrontierAll structurally cannot iterate it — ZERO exclusion code needed (FIX: the
// ITERATION mechanism).
export function planFrontierAll(s: DerivedState, nowMs: number): ItemState[] {
  const items: ItemState[] = [];
  for (const productKey of s.products.keys()) {          // workflow key is NEVER here
    const frontier = planFrontier(treeFromQueue(productKey, s), s, nowMs);
    items.push(...frontier);
  }
  // …existing global sort, unchanged…
}

// src/state.ts — the stages DO live in s.items, so claimableItems EXCLUDES them from the cross-product
// scope scan (FIX B): a workflow stage is scope-INERT — out of `actives` (never a blocker) AND its own
// scopesDisjoint test skipped (never blocked). Its OWN dependsOn gating (depsSatisfied) is untouched.
const isWorkflowStage = (i: ItemState): boolean => i.productKey === WORKFLOW_PRODUCT_KEY;
export function claimableItems(s: DerivedState, nowMs: number): ItemState[] {
  const actives = [...s.items.values()].filter((i) => !itemDone(i) && activeClaim(i, nowMs) && !isWorkflowStage(i));
  const claimable = [...s.items.values()].filter((i) =>
    itemStatus(i, nowMs) === 'queued'
    && depsSatisfied(s, i)
    && (isWorkflowStage(i) || actives.every((a) => scopesDisjoint(i.scope, a.scope))));
  // …existing priority/queue-order sort, unchanged…
}

// src/dashboard/render.ts + src/status.ts — the product-facing s.items walks filter the stages out by
// productKey (FIX A), so they never surface as product work with no matching product row.
const allItems = [...state.items.values()].filter((i) => i.productKey !== WORKFLOW_PRODUCT_KEY);     // render.ts
const isProductItem = (i: ItemState): boolean => i.productKey !== WORKFLOW_PRODUCT_KEY;               // status.ts

// The bootstrap op (src/ops.ts) — appends workflowBootstrapEvents so the stages become foldable.
// Triggered by the foundry_bootstrap_workflow MCP tool (src/mcp/tools.ts + server.ts).
export function bootstrapWorkflow(deps: FoundryDeps): { queued: string[] } { /* append; return queued */ }
```

### 4.4 `wake` ALSO returns the workflow frontier (P6's external clock pokes the re-derivation)

```ts
// src/ops.ts (extend wake, ops.ts:497-518) — return the workflow frontier ALONGSIDE the product frontier.
// workflowFrontier is the RAW ItemState[]: the workflow product is not in s.products, so toNextItem
// can't map it (no synthesized NextItem). The two frontiers stay SEPARATE channels.
export function wake(deps, input = {}): { fired: DueWake[]; frontier: NextItem[]; workflowFrontier: ItemState[] } {
  return withStoreLock(deps.dataDir, () => {
    // …existing: append WakeFired per due tick; frontier = planFrontierAll(s, nowMs).map(toNextItem)…
    const workflowReady = workflowFrontier(s, nowMs);    // pure re-derivation, poked by this wake
    return { fired: due, frontier, workflowFrontier: workflowReady };
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
| 1 | `src/instances/foundry-workflow.ts` (extend) | The 5 stage nodes gain `meta.dependsOn` (the SIBLING pipeline order, §4.1); they stay `kind: 'stage'` (the projection re-keys them to work-items). Flat single-parent topology preserved (Slice 1). `meta.action` / `effects` ride alongside untouched. RE-EXPORTS `WORKFLOW_PRODUCT_KEY` + `WORKFLOW_STAGE_REPO` (from the leaf below). |
| 2 | `src/instances/workflow-keys.ts` (new) | Import-free leaf holding `WORKFLOW_PRODUCT_KEY` + `WORKFLOW_STAGE_REPO` — so `state.ts` reads them without a `state.ts ↔ foundry-workflow.ts` module-load cycle. |
| 3 | `src/plan/workflow-frontier.ts` (new) | `workflowTree()` projects the stages into a work-item `PlanTree`; `workflowFrontier(state, now)` = `planFrontier(workflowTree(), state, now)`, NO new fold; `workflowBootstrapEvents(state, ts)` queues each stage as a `WorkItemQueued` — NO `ProductRegistered`. |
| 4 | `src/state.ts` (extend) | `isWorkflowStage` predicate + `claimableItems` (`state.ts:512`) EXCLUDES workflow stages from the cross-product scope scan (FIX B): scope-INERT (neither blocks nor blocked). `depsSatisfied` untouched. |
| 5 | `src/dashboard/render.ts` + `src/status.ts` (extend) | A `productKey === WORKFLOW_PRODUCT_KEY` filter (FIX A) keeps the stages out of the dashboard KPIs/pulse/in-flight (`render.ts:114`) and the ACTIVE CLAIMS/STALE/BUILT board sections (`isProductItem`, `status.ts:13`). |
| 6 | `src/ops.ts` (extend) | `bootstrapWorkflow(deps)` (`ops.ts:576-590`) appends `workflowBootstrapEvents` (idempotent — the foldability write path). |
| 7 | `src/mcp/tools.ts` + `src/mcp/server.ts` (extend) | The `foundry_bootstrap_workflow` MCP tool (`tools.ts:99`, registered `server.ts:45`) — the operator trigger that calls `ops.bootstrapWorkflow`. Mirrors `foundry_bootstrap`. |
| 8 | `src/plan/plan-frontier-all.ts` | **UNTOUCHED** — isolation for the conductor ITERATION is by non-registration (the workflow key is never in `s.products`); NO `CONDUCTOR_EXCLUDED` set. |
| 9 | `src/ops.ts` (extend `wake`) | `wake` returns `{ fired, frontier, workflowFrontier }` (`ops.ts:497-518`; `workflowFrontier` is the raw `ItemState[]`). The external clock pokes the re-derivation. |
| 10 | `test/workflow-advance.acid.test.ts` (new) | The acid battery (§5.2), every acid against a TEMP log. |

The kernel, `substrate-contracts`, `planFrontierAll`, the conductor's claim/launch flow, and the dashboard
are UNTOUCHED in Slice 3 (the conductor wiring is Slice 4).

### 5.2 Acid battery — each must BITE

Committed + deterministic, run unconditionally in `ci:local`. Every acid runs against a TEMP log —
NEVER the live one. `now` is pinned via `FoundryDeps.now`.

**(a) Initial state → only the first stage is ready.** Bootstrap the workflow into a temp log
(`bootstrapWorkflow` queues all 5 stages as work-items — NO product registration — NONE done).
`workflowFrontier(state, now)` returns EXACTLY the first stage (`stage-intake`, `dependsOn []`); all
downstream stages are GATED (gate-greenlight/build-path/conduct/ship absent from the frontier — their
`dependsOn` are not done). **MUTATION → RED:** give `stage-intake` a phantom `dependsOn
['stage-gate-greenlight']` → `depsSatisfied(stage-intake)` is false → the frontier is EMPTY → the
"intake is ready" assertion fails. (The reachability gate bites.)

**(b) Record intake-done → re-derive → the frontier ADVANCES; a FRESH fold reproduces it.** Append the
done-pair for `stage-intake` (`claimAcquired` + `claimReleased(outcome:'done')`, the bootstrap encoding)
→ re-`fold` the temp log → `workflowFrontier(state, now)` now returns `stage-gate-greenlight` (its sole
`dependsOn`, `stage-intake`, is done) and intake is gone (done items are not claimable). Downstream
(build-path/conduct/ship) STAY gated. **BITE (the no-callback proof):** `fold` the temp log FROM SCRATCH
(a fresh `fold(readEnvelopes(logPath))`, no prior in-memory state) → assert the fresh-fold
`workflowFrontier` DEEP-EQUALS the advanced frontier (`stage-gate-greenlight`). If advancement were a
callback or a stored next-pointer, a fold-from-scratch would NOT advance (the pointer would be absent /
the closure not in the log) → the fresh-fold-equals-advanced assertion fails → RED. Advancement is pure
re-derivation over the log.

**(c) Walk the WHOLE pipeline in order; out-of-order completion does NOT ungate.** Mark
intake → gate-greenlight → build-path → conduct done in order, re-deriving after each → the frontier
advances stage-by-stage (`stage-gate-greenlight`, then `stage-build-path`, then `stage-conduct`, then
`stage-ship`), ending at `stage-ship` after conduct is done. SEPARATELY: from the initial state, mark
`stage-build-path` done WITHOUT marking gate done → `workflowFrontier` STILL returns only `stage-intake`
(build-path's `dependsOn ['stage-gate-greenlight']` is unsatisfied, so marking build-path done does not
ungate `stage-conduct`, and build-path itself was never ready). **BITE:** DROP the `dependsOn
['stage-gate-greenlight']` edge from the `stage-build-path` stage → with intake done, `build-path` is now
exposed PREMATURELY (it has no unmet dep) → it appears in the frontier alongside/before
`stage-gate-greenlight` → the "out-of-order does not ungate" assertion fails → RED. (The dependency edge
is load-bearing; dropping it exposes a downstream stage early.)

**(d) Poked by the external re-check, not a callback — `wake`'s workflow frontier === a direct
re-derivation.** After (b)'s intake-done, schedule a wake (`scheduleWake`) and call `wake(deps)` at a
due `now` → assert `wake(deps).workflowFrontier` DEEP-EQUALS `workflowFrontier(fold(readEnvelopes(
logPath)), now)` (both raw `ItemState[]` — the workflow product is not in `s.products`, so `wake` returns
the unmapped frontier) — the SAME advanced stage (`stage-gate-greenlight`), computed two independent ways
(through the wake op and through a direct re-derivation). Call `wake` TWICE at the same `now` → the
`workflowFrontier` is IDENTICAL across calls (deterministic, idempotent — no in-memory continuation
accumulates). **BITE:** if `wake` returned a stale cached frontier (a stored continuation rather than a
fresh re-derivation), the wake-vs-direct deep-equal would diverge after intake-done → RED. (The wake is
a poke that triggers re-derivation, not a callback that fires.)

**(e) ONE encoding — `workflowFrontier` reuses `planFrontier`/`claimableItems`; no second rule
(ADR-247 retirement-guard style).** A source-scan acid asserting `src/plan/workflow-frontier.ts` calls
`planFrontier` (and does NOT re-implement `claimableItems` / `depsSatisfied` / a bespoke "deps-done"
loop) — the ADR-247 §Acid-test #3b retirement-guard pattern (a source-level check that no second
claimability encoding was introduced). PLUS a behavioral assertion: for a hand-authored multi-stage
state, `workflowFrontier(state, now)` ⊆ `claimableItems(projectTreeState(workflowTree(), state), now)`
filtered to `WORKFLOW_PRODUCT_KEY` — i.e. it IS `planFrontier(workflowTree(), …)`, byte for byte (the
wrapper adds nothing). **BITE:** replace the `workflowFrontier` body with a hand-rolled
`state.items.filter(deps-done ∧ not-done)` loop (a second encoding) → the source-scan guard fails
(`planFrontier` no longer called) AND a divergence between the hand-rolled set and `planFrontier`
(e.g. on a scope-conflict the hand-rolled loop ignores) flips the ⊆ assertion → RED.

### 5.3 What Slice 3 deliberately does NOT do

- It does NOT wire the conductor to WALK the workflow frontier and `actuate` ready stages (Slice 4) —
  the workflow frontier is read by the acid / `wake`, proving the derivation; the conductor's
  `nextItems` never surfaces it because the workflow is not in `s.products` (KD-4).
- It does NOT add a new event type — stage-done reuses the EXISTING `ClaimReleased(outcome:'done')` /
  `MergeRecorded`.
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
  EXISTING; the done-event is EXISTING. `workflowTree`/`workflowFrontier` are pack-level THIN wrappers,
  the bootstrap is pack code reusing the existing `itemQueued` event, and `planFrontierAll` is untouched.
  Nothing new is added to the kernel.
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
| **3 (this)** | The workflow tree ADVANCES itself by derivation, not callbacks. | Stages gain `dependsOn` (sibling order); `workflowFrontier = planFrontier(workflowTree(), …)` (ONE encoding, ADR-247 M1); stage-done is the EXISTING `ClaimReleased(done)` / `MergeRecorded`; advancing is re-derivation poked by scheduled-wake (ADR-256), never a callback (ADR-263 D4). Isolated by NON-REGISTRATION (the bootstrap queues stage work-items, emits NO `ProductRegistered`, so the workflow key never enters `s.products`). Resolves ADR-263 **OQ-1**. |
| **4 (next)** | The conductor WALKS the workflow tree. | The conductor pulls `workflowFrontier` (Slice 3) and, for each ready stage with a `metadata.action`, calls `actuate` (Slice 1) — advancing the pipeline autonomously. Either a dedicated workflow-conductor loop (preserving the Slice-3 non-registration), or the workflow is deliberately registered so it enters `planFrontierAll`. |
| **5** | T0/T2 variants + the cockpit drives the workflow. | Sibling `FOUNDRY_WORKFLOW` variants; the dashboard (ADR-261/262) surfaces the ready stage + its action as a confirm-gated button. |

Slice 4 (the conductor walks the workflow tree) is the natural next rung: once the workflow can SPAWN
(Slice 2) and ADVANCE (Slice 3), the conductor can DRIVE it — pulling the ready stage and actuating its
action, the HOW now autonomous the way the WHAT already is.

---

## 8. What does NOT change

- **No kernel contract.** `@de-braighter/substrate-contracts` is byte-unchanged — the workflow tree is
  the EXISTING plan-tree primitive, `dependsOn` rides the EXISTING `metadata` (read by
  `projectTreeState`, `frontier.ts:60`), `planFrontier` is EXISTING, and stage-done reuses the EXISTING
  `ClaimReleased` / `MergeRecorded` event (no new event type).
- **No design-system change.** Slice 3 has no UI; `workflowTree` + `workflowFrontier` + the bootstrap are
  pure pack code.
- **No second claimability encoding.** `workflowFrontier` is a thin wrapper over `planFrontier` (ADR-247
  M1; the source-scan acid (e) guards it).
- **`planFrontierAll` is untouched.** Isolation for the conductor ITERATION is by non-registration — the
  workflow key is never in `s.products`, so `nextItems` / `foundry_next` never surfaces a stage; the
  workflow frontier is a separate read (`workflowFrontier` / `wake`'s new field) until Slice 4 wires the
  conductor. NO `CONDUCTOR_EXCLUDED` set exists. (The two further isolation mechanisms — the `productKey`
  filter in `render.ts`/`status.ts` and the scope-scan exclusion in `claimableItems` — DO touch those
  files; they are additive guards, not changes to the frontier rule.)

---

## 9. Slice scope

- **foundry (as SHIPPED, branch `feat-workflow-advance` HEAD `34e9fce`; derivation core `418f566`, the
  isolation made REAL in the wave fix-up `34e9fce`):** extend `src/instances/foundry-workflow.ts` (the 5
  stage nodes gain `meta.dependsOn` — the SIBLING pipeline order; flat topology preserved; re-export
  `WORKFLOW_PRODUCT_KEY` + `WORKFLOW_STAGE_REPO`), add the import-free `src/instances/workflow-keys.ts`
  leaf (holds the two keys so `state.ts` reads them without a module-load cycle), add
  `src/plan/workflow-frontier.ts` (`workflowTree()` projection + `workflowFrontier` = `planFrontier` over
  it — NO new fold + `workflowBootstrapEvents` — queues the stages, NO `ProductRegistered`), extend
  `src/state.ts` (the `isWorkflowStage` predicate + the `claimableItems` scope-scan exclusion, FIX B),
  extend `src/dashboard/render.ts` + `src/status.ts` (the `productKey` filter keeping stages out of the
  product-facing views, FIX A), extend `src/ops.ts` with `bootstrapWorkflow` (appends
  `workflowBootstrapEvents`) and `wake` (return `workflowFrontier` alongside `frontier`), add the
  `foundry_bootstrap_workflow` MCP tool (`src/mcp/tools.ts` + `server.ts`, the operator trigger), and add
  the acids in `test/workflow-advance.acid.test.ts` (initial-only-first-stage-ready ·
  record-done-advances-and-fresh-fold-reproduces · walk-the-whole-pipeline-out-of-order-does-not-ungate ·
  wake-workflow-frontier-equals-direct-rederivation · one-encoding-reuses-planFrontier). `planFrontierAll`
  is UNTOUCHED (isolation for the conductor iteration is by non-registration). It REUSES `planFrontier`
  (`frontier.ts`), `claimableItems` / `depsSatisfied` / `itemDone` (`state.ts:512,405,125`),
  `buildCascadeTree` (`cascade.ts`), the `ClaimReleased(done)` / `MergeRecorded` event, `projectTreeState`'s
  ProductState synthesis (`frontier.ts`), the `itemQueued` event, and the P6 `wake` op (`ops.ts:497`).
  **No `@de-braighter/*` change.**
- **specs:** ADR-265 — codifies the five key decisions: (KD-1) the workflow advances by DERIVATION
  (the SAME `planFrontier` fold over a `workflowTree()` projection, ONE claimability encoding — no second
  rule, no new fold); (KD-2) `dependsOn` encodes the pipeline order between SIBLING stages, NOT parent
  nesting; (KD-3) control flow is DERIVED not callbacks (completion is an event, reachability is derived,
  advancing is re-derivation poked by scheduled-wake, ADR-263 D4 + ADR-256); (KD-4) the workflow frontier
  is ISOLATED from product-facing work by THREE mechanisms — (a) NON-REGISTRATION (the bootstrap emits no
  `ProductRegistered`, so the key never enters `s.products`; `planFrontierAll` untouched), (b) a
  `productKey` filter excluding the stages from the dashboard/status product views, and (c) a scope-scan
  exclusion in `claimableItems` — until Slice 4; (KD-5) ADR-176 PACK-LEVEL, pure REUSE, zero kernel
  change, no new event type. The operator trigger is the `foundry_bootstrap_workflow` MCP tool. Resolves
  ADR-263 **OQ-1**.

This slice depends only on the existing plan-tree frontier (`planFrontier`), the existing
`dependsOn`/`itemDone` machinery, the existing `ClaimReleased(done)` / `MergeRecorded` event, the existing
`itemQueued` bootstrap pattern, and the P6 `wake` op. It is the realization of ADR-263 D4 — the workflow
tree advancing itself by derivation, the SAME fold as the product frontier, poked by the same external
clock, never a callback.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
