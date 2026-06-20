# Design — T0/T2 foundry-workflow variants (parameterize the HOW pipeline per risk tier)

- **Date:** 2026-06-20
- **Scope:** `domains/foundry` (single consumer) — pack-level, ZERO kernel change
- **Status:** approved (brainstorm converged with the founder 2026-06-20)
- **Resolves:** ADR-263 OQ-3 / ADR-265 OQ-3 / ADR-266 OQ-2 / ADR-267 OQ-1 — the deferred "T0/T2 workflow variants" follow-up to the workflow-as-first-class ladder (Slices 1–5, ADR 263–267).
- **Companion ADR:** to be reserved (`scope: foundry`, `tier: design-local`) at S1 ratify and reconciled-to-code.

## 1. Problem

The workflow-as-first-class ladder (ADR-263 → ADR-267) promoted the foundry **WORKFLOW** (the HOW
pipeline: `intake → gate → build-path → conduct → ship`) to a single first-class `CascadeNodeSpec`
tree, `FOUNDRY_WORKFLOW`. The conductor walks it; the cockpit drives it. But there is exactly ONE
pipeline — the same stages run whether the product is a throwaway game (T0, e.g.
whales-and-bubbles) or a regulated Swiss medical device (T2, the oncology north-star).

The ladder ADRs deferred this on purpose. ADR-263 D1: *"Later slices add T0/T2 workflow VARIANTS … as
sibling `CascadeNodeSpec[]` instances."* The remaining design question is the SELECTOR (ADR-265
OQ-3): *how does the machine pick which variant to run — off `riskTier`, an explicit selector, or the
gate?* This design resolves that: **a lighter pipeline for T0, a heavier one for T2, selected off the
product's `riskTier`, as sibling `CascadeNodeSpec[]` reusing the existing ladder machinery, ZERO
kernel change.**

## 2. Decisions taken in the brainstorm

Two genuine forks were settled with the founder:

### 2.1 Cardinality — PER-PRODUCT workflow instances (not variant-keyed singletons)

Each product being built runs its **own** workflow instance, keyed `foundry-workflow:<productKey>`.
The product is registered FIRST (`foundry_bootstrap`, carrying its `riskTier`), then its workflow
instance is bootstrapped and the variant is **selected off the product's `riskTier`**. Many instances
run concurrently — the literal reading of "the product's `riskTier` picks its pipeline," and the only
shape that fits the multi-product machine (the superconductor fans many products out at once).

The rejected alternative — *variant-keyed singletons* (`foundry-workflow-t0`, one per tier, tier
declared at bootstrap, at most one T2 in flight) — is a smaller change but cannot model two T2
products being built at once, so it does not fit the machine.

Consequence: the S3 wiring generalizes the single `WORKFLOW_PRODUCT_KEY` literal into an instance-key
family. The frontier layer is already spec-injectable; the conductor/cockpit are not (§5).

### 2.2 Stage vocabularies — T0 light / T1 default / T2 heavy

Built entirely from the existing stage fields (`dependsOn` / `founderGated` / `metadata.action` /
`effects`). Governance is held fixed (§4).

| # | **T0_WORKFLOW** (light) | **T1 = `FOUNDRY_WORKFLOW`** (default, unchanged) | **T2_WORKFLOW** (heavy) |
|---|---|---|---|
| 1 | intake | intake | intake |
| 2 | **gate-greenlight** 🔒 *(reprioritize)* | **gate-greenlight** 🔒 *(reprioritize)* | opportunity-brief |
| 3 | build-path *(action)* | build-path *(action)* | **gate-greenlight** 🔒 *(reprioritize)* |
| 4 | ship | conduct | charter |
| 5 | | ship | build-path *(action)* |
| 6 | | | conduct |
| 7 | | | review |
| 8 | | | **compliance-gate** 🔒 |
| 9 | | | clinical-safety |
| 10 | | | ship |
| **stages** | 4 | 5 | 10 |
| **founder gates 🔒** | 1 | 1 | 2 |

- **T0's "light" = fewer automation/review stages, never fewer founder gates.** It drops
  `conduct` / `review` / `opportunity-brief` / `charter`; it KEEPS `gate-greenlight` founder-gated.
- **T2's "heavy" = two founder gates + a clinical lane.** Adds `opportunity-brief`, `charter`,
  `review`, a SECOND founder gate `compliance-gate` (regulatory/clinical sign-off), and a
  `clinical-safety` stage — befitting a Class IIb medical device.
- **The default needs no rename.** Any tier not in the variant map (T1, or an unknown future tier)
  falls back to today's `FOUNDRY_WORKFLOW` — zero disruption to the shipped ladder.

## 3. Component architecture

A new pack module **`src/instances/workflow-variants.ts`**, mirroring the `CompileTarget` registry
(`src/compiler/registry.ts`) and the `ACTION_REGISTRY` (`src/workflow/actions.ts`):

```ts
// src/instances/workflow-variants.ts (new — pack code, ZERO kernel change)
import type { CascadeNodeSpec } from '../plan/cascade.js';
import type { RiskTier } from '../events.js';
import { FOUNDRY_WORKFLOW } from './foundry-workflow.js';

export const T0_WORKFLOW: CascadeNodeSpec[] = [ /* root foundry-workflow-t0 + 4 stages */ ];
export const T2_WORKFLOW: CascadeNodeSpec[] = [ /* root foundry-workflow-t2 + 10 stages */ ];

// Tier → variant. T1 deliberately ABSENT (it is the default).
export const WORKFLOW_VARIANTS: ReadonlyMap<RiskTier, CascadeNodeSpec[]> = new Map([
  ['T0', T0_WORKFLOW],
  ['T2', T2_WORKFLOW],
]);

// RESOLVE-OR-DEFAULT (not resolve-or-throw): an unknown / T1 tier falls back to today's
// pipeline, NEVER to "no workflow". This is the governance-safe shape — the default keeps
// the founder gate. (Contrast: compile()/actuate() throw on unknown; the selector must not,
// because "no pipeline" would silently skip every founder gate.)
export function selectWorkflowVariant(tier: RiskTier): CascadeNodeSpec[] {
  return WORKFLOW_VARIANTS.get(tier) ?? FOUNDRY_WORKFLOW;
}
```

Each variant spec is a flat fan-out under its own root (`foundry-workflow-t0` / `foundry-workflow-t2`),
stages following the existing `stage-*` convention, with `dependsOn` encoding the pipeline order
(siblings, never parent nesting — ADR-265 D2). Each `build-path` stage carries a tier-appropriate
`SAMPLE_BLUEPRINT` built by the existing `extractBlueprint` (the S1 demonstrator shape, mirroring
today's `FOUNDRY_WORKFLOW`). The greenlight gate of each variant carries a representative
`effects` declaration (the declaration ⊥ actuation proof, ADR-263 D4).

`FOUNDRY_WORKFLOW` (`src/instances/foundry-workflow.ts`) is untouched.

## 4. Governance & kernel-minimality posture (held fixed across all slices)

- **Zero kernel change, mechanically.** Variants are pack `CascadeNodeSpec[]`; the registry +
  selector are pack code; `riskTier` is the existing `ProductRegistered` field (`events.ts:59`,
  `RISK_TIERS = ['T0','T1','T2']`); S3 reuses the existing `claimAcquired` + `claimReleased(done)`
  bootstrap encoding — NO new event type. Both ADR-176 inclusion-test legs FAIL (not one of the four
  kernel concerns; single consumer `domains/foundry`) → pack territory. The **P7 precedent applied a
  fourth time** (after ADR-263/265/267).
- **The founder-gated invariant is structural, not configured.** T0 keeps `founderGated` on its
  greenlight stage; the conductor's halt logic (`conductWorkflowStep` returns `awaiting-founder`
  WITHOUT marking a gated stage done — only `authorizeWorkflowStage` passes it) is UNCHANGED — it
  reads `founderGated` off whichever spec it walks. Adding variants therefore cannot weaken
  governance: a lighter pipeline has FEWER non-gate stages, never an un-halted gate. A T0 that
  auto-greenlights would require an explicit founder opt-in and is a DEFERRED, separate decision —
  NOT part of this design, and NOT the default.
- **Derive-from-log preserved.** In S3 the conductor resolves the variant by reading the instance's
  product `riskTier` from the folded log (`state.products.get(productKey).riskTier`) →
  `selectWorkflowVariant`. The selection is reproducible from the log, never a stored pointer or a
  process-memory choice (ADR-265 D3).
- **Store generators, derive graphs (ADR-176 §4) upheld.** The workflow structure + completion
  events live in the log; the frontier stays a derived view; the variant choice is re-derived from
  the product's tier on read.

## 5. The slice ladder (one slice at a time, founder-gated merges)

### S1 — DEFINE the variant specs (build first)

`src/instances/workflow-variants.ts` with `T0_WORKFLOW` + `T2_WORKFLOW` + `WORKFLOW_VARIANTS`
(the map; `selectWorkflowVariant` may land here in S1 or S2 — see note). **Nothing is wired** — the
conductor, cockpit, frontier defaults, `planFrontierAll`, and the kernel are untouched. Falsifiable
in isolation: each spec builds to a valid single-parent `PlanTree` and projects to a `workflowTree`
whose `workflowFrontier` advances in `dependsOn` order.

> Note: the frontier functions already accept an injectable `spec` (`workflowTree(spec =
> FOUNDRY_WORKFLOW)`, `workflowFrontier`/`workflowBootstrapEvents` similarly), so S1 can exercise
> each variant's frontier with ZERO production wiring — just `workflowFrontier(state, now,
> T2_WORKFLOW)`-style calls in the acids. **This is the foresight from S3 paying off.**

### S2 — the SELECTOR (resolves ADR-265 OQ-3)

`selectWorkflowVariant(tier)` — pure, resolve-or-default. Acid-tested in isolation: `T0→T0_WORKFLOW`,
`T2→T2_WORKFLOW`, `T1`/unknown → `FOUNDRY_WORKFLOW`. (If trivial, S1 and S2 may land in one PR; kept
as named slices so the OQ-3 resolution is explicit.)

### S3 — per-product wiring + cardinality (resolves the fork)

Thread an **instance key** `foundry-workflow:<productKey>` through the machinery:

1. `workflowTree(spec, instanceKey)` / `workflowFrontier(state, now, spec, instanceKey)` /
   `workflowBootstrapEvents(state, ts, spec, instanceKey)` — itemIds namespaced
   `<instanceKey>/<stageKey>` so two products' instances never collide; `dependsOn` rewritten to the
   namespaced ids; the synthesized `ProductState` root carries `instanceKey`. (Defaults preserve the
   current single-workflow back-compat.)
2. **Generalize `isWorkflowStage`** from `productKey === WORKFLOW_PRODUCT_KEY` to "is any
   workflow-instance key" (a helper `isWorkflowKey(productKey)` matching the `foundry-workflow`
   family). Update the three isolation filter sites — `claimableItems` scope-scan (`state.ts`),
   dashboard KPIs/pulse/in-flight (`render.ts`), the ACTIVE/STALE/BUILT board (`status.ts`). The
   non-registration discipline (queue stage work-items, emit NO `ProductRegistered`) is followed by
   EVERY instance so none leaks into `planFrontierAll` (ADR-265 OQ-3's named requirement).
3. **`conductWorkflowStep(deps, instanceKey)` / `authorizeWorkflowStage(deps, instanceKey, stage)`**
   resolve the spec from the instance's product tier:
   `selectWorkflowVariant(state.products.get(productKeyOf(instanceKey)).riskTier)`, then walk the
   SAME `conductWorkflowStep` logic over the selected spec (`stageNode` reads the resolved spec, not
   the hardcoded `FOUNDRY_WORKFLOW`). The two-gate governance invariant generalizes for free: T2's
   bounded walk halts at gate 1, then (after authorize) at gate 2.
4. **Cockpit** renders one WORKFLOW panel per active instance; the authorize/conduct routes take the
   instance key. `foundry_bootstrap_workflow { productKey }` reads the product's tier, selects the
   variant, queues the namespaced stages.

S3 gets its OWN ADR (the conductor/cockpit generalization is non-trivial) reconciled-to-code.

## 6. Acid tests (S1 — must BITE)

Committed + deterministic, run unconditionally in `ci:local`, every one against TEMP state (the live
canonical log untouched), mirroring `test/workflow-advance.acid.test.ts`:

1. **Each variant is a valid single-parent `PlanTree`.** `buildCascadeTree(T0_WORKFLOW)` and
   `buildCascadeTree(T2_WORKFLOW)` are accepted by `PlanTreeSchema.parse`; exactly one root
   (`parentId === null`), every stage a single non-null `parentId` (flat fan-out, siblings under the
   root). **MUTATION → RED:** give a stage a second parent → single-parent assertion fails.
2. **Governance shape: gate counts are exact.** T0 has exactly ONE `founderGated` stage; T2 has
   exactly TWO. **MUTATION → RED:** drop `founderGated` from T0's greenlight → the count-is-1 (and
   "T0 keeps its gate") assertion fails.
3. **T2 advances in `dependsOn` order over all 10 stages; out-of-order done does not ungate.**
   `workflowFrontier(state, now, T2_WORKFLOW)` from a fresh bootstrap returns only the first stage;
   marking stages done in order walks it to `ship`; marking a downstream stage done WITHOUT its
   predecessor does NOT expose it. **MUTATION → RED:** drop a `dependsOn` edge → a downstream stage
   appears prematurely → the out-of-order assertion fails. (The reachability gate from ADR-265 acid 3
   applied to the heavy variant.)
4. **`build-path` actuation rides each variant.** The `build-path` stage of each variant carries
   `metadata.action === 'build-path'` and survives `buildCascadeTree` (round-trips through
   `metadata`). **MUTATION → RED:** drop the action from the spec → `metadata.action` absent on the
   built node → fails.
5. **The variant map + selector.** `WORKFLOW_VARIANTS` has exactly `{T0, T2}`;
   `selectWorkflowVariant('T0') === T0_WORKFLOW`, `('T2') === T2_WORKFLOW`,
   `('T1') === FOUNDRY_WORKFLOW`, and an unknown tier → `FOUNDRY_WORKFLOW`. **MUTATION → RED:**
   change the default to `throw` (resolve-or-throw) → the T1-falls-back-to-default assertion fails
   (and the governance note: "no tier ever resolves to no-workflow"). (If `selectWorkflowVariant` is
   an S2 deliverable, this acid splits: S1 asserts the map membership, S2 asserts the resolution.)

## 7. Reversibility

Purely additive: a new `src/instances/workflow-variants.ts` + new acids. `FOUNDRY_WORKFLOW`, the
conductor, the cockpit, the frontier, `planFrontierAll`, the kernel, and `substrate-contracts` are
untouched in S1. Reverting S1 = delete the new module + its acids; nothing else references them until
S2/S3 wire them in. No new event type, no new dependency, no `package.json` change.

## 8. Open questions (named, not blocking S1)

- **OQ-A (auto-greenlight T0).** Should a founder be able to explicitly configure a T0 variant whose
  greenlight is NOT founder-gated (true throwaway, no halt)? Out of scope here; the default keeps the
  gate. If wanted, it is its own opt-in decision + ADR.
- **OQ-B (T1 explicit variant).** T1 currently falls back to `FOUNDRY_WORKFLOW`. If T1 ever needs a
  distinct shape, add it to the map; the default path is unaffected.
- **OQ-C (S3 instance-key format).** `foundry-workflow:<productKey>` vs a derived id; pinned when S3
  is built (the namespacing must keep `WORKFLOW_STAGE_REPO` scope-disjoint and the `productKeyOf`
  inverse unambiguous).
- **OQ-D (build-path in the per-product model).** Today's demonstrator `build-path` SPAWNS a sample
  product; in the per-product model the product pre-exists. Whether build-path then "advances the
  registered product" vs "spawns a sub-tree" is an S3 semantics question; S1 keeps the demonstrator
  spawn shape so each variant builds to a valid, self-contained tree.

## 9. References

- ADR-263 (Slice 1 — `FOUNDRY_WORKFLOW` first-class + action registry; D1 names the variant
  follow-up; OQ-3 the selector).
- ADR-265 (Slice 3 — derived advancement; OQ-3 names per-variant isolation-by-non-registration).
- ADR-266 (Slice 4 — conductor walk; OQ-2 names the variants).
- ADR-267 (Slice 5 — cockpit; OQ-1 = "T0/T2 variants … selecting the variant off `riskTier` or an
  explicit selector … its own slice + ADR").
- ADR-176 (kernel minimality + the inclusion test — both legs fail → pack territory).
- `src/instances/foundry-workflow.ts`, `src/plan/workflow-frontier.ts`,
  `src/plan/workflow-conductor.ts`, `src/compiler/registry.ts`, `src/workflow/actions.ts`,
  `src/events.ts` (`RISK_TIERS`).
