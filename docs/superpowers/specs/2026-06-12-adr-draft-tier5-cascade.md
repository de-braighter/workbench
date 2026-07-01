---
artifact_id: adr-draft-tier5-cascade
artifact_kind: adr
artifact_level: technical
authority: technical
owner_role: technical-architect
title: "ADR-225: Tier-5 down-cascade — a typed allocation algebra for team-level counterfactuals cascading to per-member intervention assignments (AllocationRule, the down-dual of AggregationRule)"
status: ratified
tier: charter
scope: substrate
date: 2026-06-12
decision-makers: [stibe]
authors: [stibe]
applies-to: layers/substrate
relates-to:

- concepts/design/north-star-vision-capture-2026-05-17.md
- concepts/design/inference-port-contract.md
- adr/adr-127-kernel-substrate-v1.md
- adr/adr-149-amend-adr-127-subject-widening-and-api-versioned-reproducibility.md
- adr/adr-154-algebraic-effect-declarations-and-composition-operators.md
- adr/adr-165-inference-backbone-port-acid-test-demo-1-scoping.md
- adr/adr-176-substrate-kernel-minimality-inclusion-test.md
- adr/adr-198-amend-adr-127-149-aggregate-subject-widening-for-hierarchical-twins.md
- adr/adr-199-effect-composition-feedback-contracts-only-roll-up.md
- adr/adr-205-tenant-scope-on-inference-input-singleton-safe-evidence-reads.md
- adr/adr-213-generalize-subject-ontology-beyond-person.md
- adr/adr-218-north-star-critical-path-sequencing.md
- adr/adr-220-reproducibility-proof-minimal-run-manifest-and-distribution-catalog.md
- adr/adr-224-inference-side-distribution-aware-effect-consumption.md

---

<!--
  STAGING ARTIFACT (workbench). Founder review COMPLETE 2026-06-12 — all three open
  questions decided (§Open-question resolutions), status flipped to accepted.
  Knowledge metadata records this as `ratified`; the ADR body preserves the original
  staged-status wording until the Specs repo copy lands.
  Destination (next step — the specs PR landing this file):
  layers/specs/adr/adr-225-tier5-down-cascade-allocation-algebra.md
  (specs is PR-gated; this draft is parked here because the specs main clone is shared
  and currently sits on a stale branch). Lint gates to run on the specs PR:
  `bash tools/lint-md.sh <file>` + `node tools/validators/frontmatter-schema.mjs <file>`.
-->

# ADR-225: Tier-5 down-cascade — a typed allocation algebra for team-level counterfactuals cascading to per-member intervention assignments

## Status

**Accepted** (2026-06-12). Designer-first artifact, founder-reviewed and ratified
2026-06-12 with all three open questions decided in review
(§Open-question resolutions) — this ADR enters the corpus accepted. This is the
"own ADR" that [ADR-198](adr-198-amend-adr-127-149-aggregate-subject-widening-for-hierarchical-twins.md)
§"What stays OUT of this slice" explicitly deferred: *"Tier 5 — the team→player cascade
counterfactual … requires a downward-propagation algebra over the member subtrees that is
materially larger and should land as its own ADR."* It does **not** amend ADR-198 — it
completes its named deferral, the same closure pattern
[ADR-224](adr-224-inference-side-distribution-aware-effect-consumption.md) used for
ADR-199 D2.

Two founder-set scoping decisions (2026-06-12) frame this ADR; it designs within them,
it does not re-decide them:

1. **A full intervention algebra, not a surface-only breakdown.** A per-member posterior
   readout alone was explicitly rejected as insufficient. The cascade must carry a typed
   **allocation semantics** — what intervention each member *receives* — with ≥2 real
   rules, an identity element, a composition law, and registry extensibility.
2. **At north-star demo-3's smallest credible scope.** One indicator family
   (Beta-Binomial — the ADR-198 EB-hierarchical adapter's), one team, one
   counterfactual ([north-star §13](../concepts/design/north-star-vision-capture-2026-05-17.md)
   demonstration 3, line 601: "Smallest credible scope: one Indicator, one team, one
   counterfactual"). No need-based optimization, no targeting predicates — those are
   named deferrals with triggers, not silent gaps.

## Context

### The driver — north-star demo 3, second half; thesis-test Check 3

[north-star §13](../concepts/design/north-star-vision-capture-2026-05-17.md)
demonstration 3 (line 601) has two halves:

> Exercir computes a team-level twin … by partial-pooling per-player posteriors, **AND
> can pose a team-level counterfactual that cascades to per-player intervention
> assignments.**

ADR-198 shipped the first half (the partial-pooled aggregate posterior, Tiers 1–4) and
deferred the second. The second half is now **gated work on the ratified critical
path**: per the founder-ratified 2026-06-12 amendment to
[ADR-218](adr-218-north-star-critical-path-sequencing.md) §"The thesis-test gate",
**Check 3 — nested-twin down-cascade** gates ADR-218 step 2's (WS-9 ‖ inference-depth)
completion claim, with the verdict recorded on the de-braighter/specs#298 ledger
(in-tree regression specs preferred over session artifacts). The PASS criterion, quoted
from the gate table: *"A team/cohort-level what-if produces per-member assignments and a
correctly-aggregated posterior (EB-hierarchical 'Tier 5'); this is where the deferred
`condition()` / re-conditioning half of Check 2 must become real."* This ADR is the
design that makes that criterion implementable and falsifiable.

### What ships today, precisely

The shipped EB-hierarchical adapter
(`libs/substrate-runtime/src/inference/adapters/eb-hierarchical-beta-binomial.adapter.ts`)
is three known steps short of the cascade:

1. **Broadcast-identical effects, not an assignment.** `composeMembers` (lines 397–436)
   calls `findEffectsForTree(tenantPackId, treeRoot, indicatorKey)` with identical
   arguments for every member and applies the **same** composed prior to each member's
   posterior. Every player receives the whole team-level effect, unconditionally. That
   is a defensible default (a tactic instruction *is* non-rival) but it is not an
   allocation semantics — there is no typed way to declare "this team-level training
   load is a budget split across players."
2. **Per-member shrunk posteriors are computed but internal.** The adapter computes the
   partial-pooled member posteriors and parks them behind the `shrunkMembers()` audit
   accessor (lines 320–327), whose own comment defers surfacing them "until a result
   shape (the cascade counterfactual, Tier 5) carries it."
3. **Paired counterfactual handles do not share a manifest.** `counterfactual()` runs
   two independent `posterior()` calls; the `// KNOWN-GAP(ADR-165 Inv-5)` comment (line
   305) and the deliberate pinning test
   (`eb-hierarchical-beta-binomial.adapter.spec.ts:493–511`) record that each arm mints
   its own `requestId`/manifest — to be fixed "when the EB counterfactual is promoted to
   a first-class surface." This ADR is that promotion. The conjugate fast-path already
   implements the correct convention
   (`beta-binomial-fast-path.adapter.ts:250–253`: one shared `requestId`, one
   `inputHash` over the canonical JSON of the full `CounterfactualInput` pair, the
   shared manifest stamped on both handles), and the contract comment on
   `PosteriorHandle.manifest` (`inference-types.ts:141–142`) already states "Shared
   across paired counterfactual handles per ADR-165 Invariant 5."

### The missing concept — the third axis of the cascade duality

The kernel already has two directional algebras; this ADR adds the third and last:

| Algebra | Direction | Over | Ratified by |
|---|---|---|---|
| `compositionOperator` / `composeEffects` | **down the PLAN tree** | declared effects (children → parent) | [ADR-154](adr-154-algebraic-effect-declarations-and-composition-operators.md) C3–C5, [ADR-199](adr-199-effect-composition-feedback-contracts-only-roll-up.md) D1 |
| `AggregationRule` | **up the SUBJECT hierarchy** | indicator values / posteriors (members → aggregate) | [ADR-198](adr-198-amend-adr-127-149-aggregate-subject-widening-for-hierarchical-twins.md) Tier 3 |
| **`AllocationRule` (this ADR)** | **down the SUBJECT hierarchy** | a composed team-level effect → per-member allocated effects | — |

ADR-198's own inclusion-test argument framed `AggregationRule` as "the value-side dual
of ADR-154's effect algebra" (ADR-198 §inclusion test, limb (a)). `AllocationRule` is
the symmetric **down-dual of `AggregationRule`**: aggregation says how member values
pool upward; allocation says how a declared aggregate-level dose apportions downward.
With it, the cascade question becomes fully typed: *what does each member receive (the
assignment), what does it do to each member's posterior, and how does the team posterior
aggregate from the assigned members — with tree substitution re-conditioning all of it.*

### What the cascade consumes (fixed, not re-litigated)

- **The composed effect is a `DistributionSpec`** produced at inference read-time by the
  plan-side `composeEffects` (ADR-224 Commitments 1–3). The EB adapter's tractability
  dispatch (`extractComposedPriorOrErr`, adapter lines 342–395) accepts `point`
  (log-odds additive, identity `0` per ADR-224 OQ-1) and `beta` (conjugate prior
  reshape); `normal`/`lognormal` are typed `effect-not-conjugable` deferrals. The
  allocation algebra composes **on top of** this dispatch — it never reinterprets the
  operator or the kind.
- **Members + weights come from the ADR-198 Tier-2 `MemberResolution` out-port**
  (`member-resolution.port.ts:30–47`): `AggregateMember { subject, weight ≥ 0 }`,
  temporally resolvable via `asOf`. Rosters stay in the pack; the kernel never stores
  them.
- **The subject model is post-WS-8** ([ADR-213](adr-213-generalize-subject-ontology-beyond-person.md)):
  `aggregate` is a structural kind with an opaque pack-namespaced `role`
  (`subject-ref.ts:40–44`); nothing here branches on a domain literal.

## The ADR-176 inclusion test (applied explicitly)

[ADR-176 §1](adr-176-substrate-kernel-minimality-inclusion-test.md) requires both limbs.

**Limb (a) — is it one of the four concerns? YES.** The cascade sits at the same
intersection ADR-224 Commitment 6 ratified: concern #1 (recurse the plan — the declared
effect algebra) feeding concern #3 (inference — plan + observations → posteriors), now
extended across the subject hierarchy that ADR-198 already admitted into concern #3.
`AllocationRule` is not a fifth concern: it is the missing direction of the existing
plan→inference coupling, exactly as `AggregationRule` was its up-direction (ADR-198
limb-(a) verdict). The result shape (per-member assignments on the counterfactual)
is concern #3's output; the shared `RunManifest` across the pair is concern #4
(reproducibility) doing its existing job over a paired result.

**Limb (b) — needed by ≥2 packs as shared infra the kernel must validate / query /
version? YES.**

- **pack-football (exercir) — the demand we can name TODAY.** The live Check-3 work: a
  team-level what-if (the shipped team-twin endpoint + `compareMulti` lane) must produce
  per-player assignments and a correctly-aggregated team posterior. This is the same
  first consumer ADR-198 named for Tiers 1–4.
- **conservation (region → sites).** A region-level intervention with a finite budget
  (habitat-restoration effort, culling/translocation quotas) is a *divisible dose*
  apportioned across sites by area/exposure weight — `weight-proportional` — while a
  region-wide regulation change is non-rival — `broadcast`. Same two rules, different
  `role` strings.
- **pack-care (ward → patients).** A ward-level staffing or protocol change cascades to
  per-patient intervention intensity; ward capacity is a divisible budget, a protocol
  switch is a broadcast. (Named as the third shape, consistent with ADR-198's limb-(b)
  list; not yet built.)

The kernel must **validate** (allocation × composed-prior-kind tractability; agreement
across contributing declarations; weight preconditions), **query** (the allocation fold
feeds the per-member conjugate updates and the hyperprior re-estimation in the inference
read path), and **version** (the `AllocationRule` shape, the cascade result shape, and
the shared manifest are published contract surface). This is computation the kernel
performs, not opaque storage — the ADR-176 §1(b) trigger.

**What does NOT pass — and stays out:**

- **Targeting policy** ("give extra dose to the weakest three", need-based optimization,
  eligibility predicates) ships nothing in this slice: no consumer demands it yet. Its
  eventual landing *shape* IS decided — kernel allocation strategies that read member
  posteriors, per the OQ-3 founder resolution (§Open-question resolutions), a recorded
  ADR-176 exception gated by its own ADR — but no targeting strategy enters here.
- **The roster** remains pack territory (ADR-198 Tier 2 verdict unchanged).
- **Multi-level recursion** (region → sites → plots) has exactly one named prospective
  consumer; deferred (§What this ADR does NOT do).

**Verdict:** the allocation algebra, its placement on the effect-declaration surface,
and the cascade result shape are **kernel**; rosters and recursion are **not**, and
targeting ships nothing in this slice (its eventual landing shape — kernel allocation
strategies — is fixed by the OQ-3 founder resolution, gated by its own ADR). Both limbs
argued; the kernel grows by one typed rule and one optional result field, both
demand-backed.

## Decision

> Add a typed, registry-extensible **`AllocationRule`** to the effect-declaration
> surface — the down-dual of `AggregationRule` — with exactly two wired strategies:
> **`broadcast`** (identity; reproduces today's behaviour byte-compatibly) and
> **`weight-proportional`** (a conserved dose split over member weights, defined over
> `point` log-odds composed effects). Propagate it through `composeEffects` under an
> agreement law. Surface the cascade on the result shape: `PosteriorHandle` gains an
> optional **`cascade`** detail carrying per-member `(subject, weight, allocated effect,
> shrunk-posterior summary)`; `counterfactual()` mints **one shared `RunManifest`**
> across the pair (discharging the ADR-165 Inv-5 known gap). Re-conditioning happens by
> **tree substitution + hierarchical re-estimation** — the `condition()` verb stays
> deferred and is not required. Ship as **additive minor** bumps
> (`substrate-contracts` 2.1.0, `substrate-runtime` 2.1.0); no DB migration;
> `apiVersion` stays `'v1'`.

Seven commitments fix this. Each is load-bearing.

### Commitment 1 — `AllocationRule`: the typed allocation algebra

```ts
// libs/substrate-contracts/src/plan-tree/allocation-rule.ts (NEW)
// Registry-extensible string-literal union — widen via minor bump
// (ADR-127 invariant 4; the AggregationRule precedent, aggregation-rule.ts).
export const AllocationStrategySchema = z.enum(['broadcast', 'weight-proportional']);
export type AllocationStrategy = z.infer<typeof AllocationStrategySchema>;
```

Semantics, stated precisely. Let the composed team-level effect for the indicator be a
`point` composed prior with value `δ` on the log-odds scale (ADR-224 1b-ii / ADR-224's
own OQ-1; identity `0`), and let the resolved members carry weights `wᵢ ≥ 0` with `W = Σ wᵢ`:

- **`broadcast` (the identity rule; DEFAULT when the field is absent).**
  `δᵢ = δ` for every member. The declared effect is **non-rival** (a tactic
  instruction, a rule change, a protocol switch): every member receives the full dose.
  This is **exactly today's behaviour** (`composeMembers` applies the same composed
  prior to every member), so an absent/`broadcast` allocation is byte-compatible with
  the shipped path — the algebra's identity element is the shipped default, not a new
  behaviour. `broadcast` is defined over **every** composed-prior kind the adapter's
  tractability dispatch accepts (`point` and `beta`): broadcasting a `beta` composed
  prior is today's per-member conjugate prior replacement, unchanged.
- **`weight-proportional` (the first non-trivial rule).**
  `δᵢ = δ · wᵢ / W`, requiring `W > 0`. The declared effect is a **divisible team-total
  dose** (a training-load budget, a restoration budget) apportioned by the ADR-198
  pooling weights (roster minutes, exposure, area). Defined in v1 **only over `point`
  composed priors**: apportioning a `beta`-kind prior replacement by weights has no
  principled meaning (a Beta distribution is not a dose), so
  `weight-proportional × beta` returns the typed `effect-not-allocatable` deferral
  (Commitment 3) — never an approximation, mirroring the ADR-224 Commitment-4 posture.

**Algebraic laws (the "full algebra" the founder required, at demo-3 scope):**

1. **Identity coherence.** `δ = 0 ⇒ δᵢ = 0` for all `i`, under both rules (log-odds
   identity `0`, ADR-224 OQ-1). A zero composed effect cascades to a no-op for every
   member; the cascade result equals the no-effect path.
2. **Conservation (`weight-proportional`).** `Σᵢ δᵢ = δ · (Σ wᵢ)/W = δ` — the declared
   team-total log-odds dose is conserved exactly across the assignment. This is the
   hand-derivable correctness oracle (Commitment 5, O2).
3. **Totality (`broadcast`).** Each member's dose equals the declared magnitude;
   `broadcast` deliberately does **not** conserve a summed dose. The two rules encode
   two different dose semantics — non-rival vs divisible — and the **declarer chooses**
   (Commitment 2). Neither is derivable from the other; that is why the rule must be
   declared, not inferred.
4. **Order-invariance.** Both rules are per-member maps over an unordered member set;
   the cascade result is invariant under member enumeration order (and the result shape
   is canonically sorted, Commitment 4).
5. **Weight-channel reuse (unconditional).** The allocation weight IS the ADR-198
   pooling weight from `MemberResolution` — one channel serves both pooling and
   dose-share (minutes = exposure for pooling AND dose share). No second dose-weight
   channel exists or is planned: per the OQ-3 founder resolution, future targeting
   derives dose shares kernel-side from member posteriors (new allocation strategies),
   so the channel split a pack-side-weights design would have required never arises.
   Stated here so the coupling is a recorded decision, not an accident.

**Deferred rules (named, with triggers — never silently grown):**

- `'need-based'` (allocate inversely to member posterior mean — targeting weak members).
  Lands as a **kernel allocation strategy** that reads member posteriors to derive dose
  shares — the OQ-3 founder resolution (§Open-question resolutions). Trigger: the first
  pack that needs targeting; gate: its own ADR widening this strategy union (minor
  bump).
- `'top-k'` / member-selection predicates. Same landing shape, trigger, and gate.
- `'custom:<key>'` pack extension. **Deliberately NOT accepted at the runtime
  boundary** — unlike ADR-154 C3's operator fallback-to-`'overlay'`, an unknown
  allocation string does **not** fall back to `broadcast`: silently broadcasting a dose
  that the declarer meant to split (or vice versa) is a dose misinterpretation, a safety
  hazard on a medical-grade path. Unknown strategies **reject at validation** — the
  `DistributionSpec`-kind posture (ADR-154 C2 "reject rather than silently
  misinterpret"), not the operator-fallback posture. New strategies enter by
  minor-version widen only.

### Commitment 2 — Where the rule lives: on the `EffectDeclaration`, propagated through `composeEffects`

The allocation rule is a property of the **intervention's declared effect** — the
declarer knows whether their team-level claim is non-rival or a divisible budget. It is
NOT a property of the indicator (two interventions on the same indicator can allocate
differently: a team talk broadcasts; a load budget splits), and NOT a per-call choice
(reproducibility requires the assignment semantics to be derivable from the plan tree,
not from caller whim). Three placements were weighed:

| Option | Verdict |
|---|---|
| **(a) Optional field on `EffectDeclaration` (CHOSEN)** | Mirrors ADR-154's own placement argument for `compositionOperator` ("living on the declaration, not on the node, is load-bearing: a single node may declare two effects with different operators" — ADR-154 C1). Symmetrically, a node may declare two effects with different allocations. JSONB-additive; soft-immutability preserved (new declarations carry the field, old ones default `broadcast`). |
| (b) On `IndicatorMetadata` / `AggregationRule` (value-side) | Forecloses per-intervention dose semantics; conflates how an indicator *pools* with how a specific intervention *doses*. ADR-198 Tier 3 placed aggregation on the indicator because pooling is indicator-intrinsic; allocation is intervention-intrinsic. **Rejected.** |
| (c) On the plan node / `metadata`, or on the inference call input | Node-level loses per-declaration granularity (same argument ADR-154 C1 already won); call-input-level breaks "the plan tree IS the program" — the assignment would not be reproducible from the declared tree, and two callers could get different cascades from the same tree. **Rejected.** |

Concretely (all additive):

1. **`EffectDeclaration` gains `allocation?: AllocationStrategy`** (absent ⇒
   `'broadcast'`). A schema widen of `EffectDeclarationSchema`
   (`effect-declaration.ts:33–58`) — the JSONB on `kernel.plan_node.effects` (ADR-153 /
   ADR-200) accommodates the optional field with **no DB migration**. Readers on
   contracts 2.0.0 (strict schema) reject a declaration carrying the new field at
   validation time — the intended forward-compat behaviour per ADR-154 C2's extension
   story ("existing readers reject … rather than silently accepting"); writers emit the
   field only after the 2.1.0 consumer upgrade, the standard minor-widen rollout.
   Validation of `allocation × magnitudePrior-kind` is **not** done at write time (the
   composed kind is only known post-composition); it is the inference-time typed error
   of Commitment 3.
2. **`composeEffects` propagates it under an agreement law.** Within an `indicatorId`
   group, all contributing declarations must agree on the (defaulted) allocation —
   exactly the existing operator-agreement posture (ADR-154 C4 rule 2). Disagreement is
   a new `CompositionError` variant `allocation-disagreement` (adding a variant is a
   minor widen per the stated posture, `effect-composition.ts:74–78`). The composed
   output carries it: **`ComposedEffect` gains `allocation?: AllocationStrategy`**
   (absent ⇒ `'broadcast'`), so the inference side receives the rule with the composed
   prior — no re-reading of raw declarations, preserving the surface ADR-224
   Commitment 2 closed.
3. **The allocation fold is a Ring-0 pure function** (the `composeEffects` precedent,
   ADR-199 D1; ADR-152 classifies effect-algebra as domain logic, not an out-port):

   ```ts
   // libs/substrate-contracts/src/plan-tree/effect-allocation.ts (NEW)
   export interface AllocatedEffect {
     subject: SubjectRef;
     weight: number;
     magnitude: DistributionSpec;   // the member's allocated composed prior
   }
   export type AllocationError =
     | { kind: 'allocation-not-applicable'; allocation: AllocationStrategy;
         composedPriorKind: DistributionSpec['kind'] }
     | { kind: 'zero-total-weight'; allocation: AllocationStrategy };
   export function allocateEffect(
     composed: ComposedEffect,
     members: readonly AggregateMember[],
   ): Result<AllocatedEffect[], AllocationError>;
   ```

   Pure, deterministic, O(members), no I/O — packs and eyecatchers can reproduce and
   display an assignment without the runtime, and the conservation oracle tests the
   function directly. The EB adapter is the only wired consumer this slice.

### Commitment 3 — Allocation over the tractability matrix (typed walls, no silent fallback)

The allocation composes with — never bypasses — the ADR-224 dispatch. Per composed-prior
kind reaching the EB-hierarchical Beta-Binomial column:

| composed-prior kind | `broadcast` | `weight-proportional` |
|---|---|---|
| `point` (log-odds δ) | **✓** `δᵢ = δ`; per-member ADR-224 1b-ii logit shift with `δᵢ`, then own observations | **✓** `δᵢ = δ·wᵢ/W`; same per-member 1b-ii update with `δᵢ` |
| `beta` (conjugate prior reshape) | **✓** every member's prior replaced by `Beta(α_E, β_E)` — today's behaviour | **typed `effect-not-allocatable`** (a Beta prior is not a divisible dose) |
| `normal` / `lognormal` | already `effect-not-conjugable` upstream (ADR-224 matrix) — allocation is never reached | same |

The new typed error is an `InferenceError` widen (minor; sibling of
`effect-not-conjugable`, ADR-224 Commitment 4):

```ts
// substrate-contracts/src/primitives/error-envelope.ts — InferenceError widen (×1)
| {
    kind: 'effect-not-allocatable';
    indicatorKey: string;
    allocation: AllocationStrategy;
    composedPriorKind: DistributionSpec['kind'];
    reason: 'non-point-composed-prior' | 'zero-total-weight';
    deferredAdrPointer: string;   // → this ADR's deferred-rule entry (Commitment 1)
  }
```

After allocation, the hierarchy is unchanged ADR-198 math, now over **post-assignment**
member posteriors: each member's raw posterior composes under its own allocated prior
(`composeBetaPosterior` reuse), the hyperprior `(A, B)` re-estimates by weighted
method-of-moments over those raw posteriors (`estimateHyperprior`,
`eb-hierarchical-beta.ts:67–123`), and each member shrinks toward `(A, B)`
(`shrinkMember`, lines 149–160).

**Correctness prerequisite — the shrink baseline must be the member's post-allocation
effective prior.** Today's adapter passes the raw indicator prior as the shrink baseline
(`baseline = { priorAlpha: meta.priorAlpha ?? 1, priorBeta: meta.priorBeta ?? 1 }`,
adapter lines 201–210). When a composed effect was applied, the member was actually
composed under the *shifted* prior `(αᵢ', βᵢ')` (logit-shifted for `point`; replaced for
`beta`), so subtracting the unshifted `(α₀, β₀)` misattributes `(αᵢ' − α₀)` as evidence
and under/over-shrinks. Harmless today only because shrunk members are internal and the
shift is uniform; **under per-member allocation the baselines differ per member and the
error becomes surface-visible.** The Tier-5 implementation MUST thread each member's
effective composed prior as its `MemberPriorBaseline` (the `shrinkMember` contract,
`eb-hierarchical-beta.ts:125–147`, already says the baseline is "the prior the member
was composed under" — the call site just doesn't honour it under effects). Pinned by a
named regression (Commitment 5 / evidence plan item 7): a zero-observation member under
any allocated effect shrinks **fully** to `(A, B)`.

### Commitment 4 — The cascade result shape + the shared manifest (discharging ADR-165 Inv-5)

**Result shape (additive TS widen on the published handle):**

```ts
// substrate-contracts/src/inference/inference-types.ts — additive widen
export interface MemberAssignment {
  subject: SubjectRef;
  weight: number;
  /** The member's allocated composed prior; null when the tree declares no effect
   *  on this indicator. */
  allocatedEffect: DistributionSpec | null;
  /** The member's partial-pooled (shrunk) posterior under the assignment. */
  summary: PosteriorSummary;
}
export interface CascadeDetail {
  /** The rule in force for this indicator ('broadcast' when defaulted). */
  allocation: AllocationStrategy;
  /** Sorted by subject id ascending — canonical, enumeration-order-independent. */
  members: readonly MemberAssignment[];
}
export interface PosteriorHandle {
  // … existing fields unchanged …
  /** Tier-5 cascade detail. Present iff the handle's subject is an `aggregate`
   *  served by a hierarchical adapter; absent for individual/cohort handles. */
  cascade?: CascadeDetail;
}
```

- `CounterfactualResult` (`inference-types.ts:198–201`) is **unchanged**: it already
  carries `baseline` + `counterfactual` handles, so with `cascade` on each handle the
  pair carries per-member assignments + shrunk posteriors for **both arms**, and each
  handle's `summary` is the pooled team posterior for its arm — the exact result the
  founder constraint and the Check-3 PASS criterion require. The
  `InferenceBackbone` method signatures are untouched (the ADR-224 "does NOT" posture).
- **Uniform placement (OQ-2 resolution).** Every aggregate handle a hierarchical
  adapter serves carries `cascade` — plain `posterior()` and both `counterfactual()`
  arms identically; there is no counterfactual-only mode.
- Payload is bounded by roster size (≈ 11–30 for the named consumers) and carries
  summaries only — no raw observation streams. The member **raw** (pre-shrink)
  posteriors stay internal; the `shrunkMembers()` audit accessor's reason to exist is
  retired by the uniform `cascade` surface (OQ-2 resolution) — deprecated at runtime
  2.1.0, its removal rides the next runtime major.
- **One shared `RunManifest` across the pair.** `counterfactual()` mints one
  `requestId` and one `inputHash` over the canonical JSON of the full
  `CounterfactualInput`, stamped on both handles — adopting the fast-path convention
  verbatim (`beta-binomial-fast-path.adapter.ts:250–253, 316–330`) and honouring the
  existing contract comment (`inference-types.ts:141–142`). This **discharges the
  ADR-165 Inv-5 known gap**; the deliberate pinning test
  (`eb-hierarchical-beta-binomial.adapter.spec.ts:493–511`) was written to "fail loudly
  and force an intentional migration" — the implementation migrates it to assert the
  shared `requestId` (evidence plan item 4).
- **Named implementation hazard — handle-id derivation.** The EB adapter's
  `handleIdFor` currently keys on `manifest.inputHash` in place of the tree root
  (adapter lines 503–508). Under a shared manifest both arms would derive **the same
  handle id** (identical seed/inputHash/indicator/subject) and the second arm would
  overwrite the first in the handle cache. The implementation MUST key the handle id on
  the per-arm `treeRoot` (as the fast-path does); pinned by the shared-manifest spec
  (distinct ids, shared manifest).

### Commitment 5 — Correctness oracles + the differentiated-claim invariant

Four properties, each checkable **without tolerance-padding** (exact comparisons on
binary-exact fixtures; strict inequalities for directional claims):

- **O1 — Broadcast identity (byte-compatibility).** Under absent/`broadcast`
  allocation, the cascade path produces the identical aggregate `(A, B)`, identical
  member raw and shrunk posteriors, and identical `summary` as the pre-Tier-5 shipped
  path (golden vectors unchanged), and `allocatedEffect ≡` the composed prior for every
  member. Today's behaviour is the algebra's identity element, proven not asserted.
- **O2 — Conservation (the hand-derivable oracle).** Under `weight-proportional` over a
  `point` composed effect `δ`: `δᵢ = δ·wᵢ/W` and `Σᵢ δᵢ = δ` — exact in real
  arithmetic. The regression uses binary-exact weight fixtures (e.g. `w = {1, 1, 2}`,
  `δ = 0.5` ⇒ `δᵢ = {0.125, 0.125, 0.25}`, sum exactly `0.5`) so the assertion is
  strict equality (`toBe`), not `toBeCloseTo`. A zero-weight member receives exactly
  `δᵢ = 0`; `W = 0` is the typed `zero-total-weight` error, never `NaN`.
- **O3 — Pooled-posterior monotonicity.** For `δ > 0` with direction `'+'` on the
  clean estimation path (no `estimateHyperprior` fallback warnings — the over-dispersed
  and boundary fallbacks at `eb-hierarchical-beta.ts:87–108` would decouple the pooled
  mean from the members, so fixtures must avoid them): every dosed member's raw
  posterior mean strictly exceeds its `δ = 0` value (the logit shift is strictly
  increasing and concentration-preserving; observations held fixed), hence the weighted
  member mean `m` and the pooled hyperprior mean `A/(A+B) = m` strictly increase.
  Strict `>` assertions, no tolerance. Deliberately NOT claimed: that the pooled mean
  shifts by `δ` in log-odds — the method-of-moments pool is nonlinear in member means,
  so the team-level dose-response has no closed-form identity. Conservation lives at
  the allocation layer (O2), where it is exact; claiming it at the pooled layer would
  be invented math (the ADR-224 "no invented math" rule).
- **O4 — The differentiated-claim (coupling) invariant.** Let trees `T0`, `T1` differ
  in one team-scoped subtree, and construct a member `z` whose allocated dose is
  identical across the arms (`wᵤ = 0` under `weight-proportional` ⇒ `δᵤ = 0` in both).
  Then `z`'s **raw** posterior is exactly arm-invariant, but `z`'s **shrunk** posterior
  differs across arms — the re-estimated hyperprior `(A, B)` over the *other* members'
  shifted posteriors is the only channel. This is the coupling N independent
  per-player `posterior()`/`counterfactual()` calls cannot express: an individual-subject
  call for `z` either applies the whole team dose to `z` (wrong: ignores allocation) or
  shows zero delta (wrong: misses the hyperprior coupling). The invariant MUST be
  pinned as a regression with the explicit contrast (cascade delta ≠ 0 ∧ raw delta = 0
  ∧ independent-call delta = 0), exact `(α, β)` comparisons. This is the in-tree
  evidence that the team counterfactual is a *hierarchical* re-conditioning, not N
  independent ones — the substance of Check 3.

### Commitment 6 — Re-conditioning is tree substitution + hierarchy; `condition()` stays deferred

Stated explicitly, because the specs#298 ledger adjudicates Check-2 criterion-2's doubt
here: **the Tier-5 cascade re-conditions via tree substitution plus the hierarchical
structure, and does NOT require the `condition()` verb.** A cascade counterfactual is,
end to end: swap the subtree (`baselineTree` vs `counterfactualTree`, the existing
`CounterfactualInput`), re-read the substituted tree's declarations under the same
tenant scope (ADR-205), re-derive the composition (ADR-224 Commitment 3 read-time
fold), re-allocate per member (Commitment 1), re-compose every member's raw posterior,
re-estimate the hyperprior, re-shrink every member, and re-pool the team posterior.
Every quantity in the result — every member's assignment, every member's posterior, and
the team posterior — is re-conditioned by the substitution. `condition()` /
`cohortMarginal()` / `identify()` remain typed `not-implemented-phase-1` deferrals
(ADR-165 Invariant 6; `inference-types.ts:210–238`) — they address *evidence-side*
hypotheticals ("condition on facts that were not observed"), which the cascade does not
need: its intervention surface is the **plan side**, the §9.3 twin-as-counterfactual
mechanism (a subtree substitution *is* the do-operation at the granularity the plan
tree models). If Check 3's ledger entry finds a residual re-conditioning need the
substitution cannot express, that is a FAIL-path finding for the Option-B deferral ADR
per amended ADR-218 — not a silent scope creep into `condition()` here.

### Commitment 7 — Versioning / release impact (additive; no migration)

| Surface | Change | Bump |
|---|---|---|
| `@de-braighter/substrate-contracts` | `AllocationStrategy` schema (new file); `EffectDeclaration.allocation?` (optional); `ComposedEffect.allocation?` (optional); `allocateEffect` pure fn (new file); `CompositionError` + `allocation-disagreement`; `InferenceError` + `effect-not-allocatable`; `PosteriorHandle.cascade?` + `CascadeDetail`/`MemberAssignment` | **2.1.0 (minor)** — all additive: optional fields, new files, error-variant widens (add = minor per the stated envelope posture) |
| `@de-braighter/substrate-runtime` | EB-hierarchical adapter: allocation-aware member composition; per-member shrink baselines (Commitment 3); `cascade` on aggregate handles; shared counterfactual manifest + per-arm handle ids (Commitment 4); `shrunkMembers()` retained but deprecated (OQ-2 resolution: retired; removal at next runtime major) | **2.1.0 (minor)** — no published port shape changes (`EvidenceRepository`, `MemberResolution`, `InferenceBackbone` untouched); the shared-manifest change is a fix **toward** the documented Inv-5 contract, with its pinning test intentionally migrated |
| `kernel.plan_node.effects` JSONB | optional `allocation` field inside the existing JSONB | **No DB migration** (ADR-153/200 column unchanged) |
| `apiVersion` | unchanged | stays `'v1'` (ADR-149 Amendment 2; same posture as ADR-198 — new in-process behaviour under the same versioned surface; the full hierarchical-Bayes / NumPyro path remains the `'v2'` event) |

If a reviewer concludes any of the above is not truly additive, the named fallback cost
is: moving `cascade` off `PosteriorHandle` into a new method would be the breaking
alternative (a port-surface change ⇒ runtime major + consumer sweep) — rejected
precisely because the optional-field widen achieves the same result shape without it.

## What this ADR does NOT do

- **Does NOT add a `DistributionSpec` kind, a `CompositionOperator`, or an
  `AggregationRule` strategy.** ADR-154 C2/C3 and ADR-198 Tier 3 are unchanged; the
  allocation algebra composes with them, it does not modify them.
- **Does NOT do optimization or targeting.** The algebra *apportions a declared dose*;
  it does not *choose* one. Need-based/top-k targeting (deferred rules, Commitment 1 —
  landing shape decided, §Open-question resolutions OQ-3) and the reverse-planner (B6)
  are out of scope.
- **Does NOT model per-member heterogeneous susceptibility.** Every member responds to
  its allocated `δᵢ` on the same log-odds scale; member-specific effect modifiers are a
  future, pack-declared concern (no named demand today).
- **Does NOT cascade beyond one level.** Members must be `individual` (the shipped
  adapter's gate, lines 173–185). Nested-aggregate recursion (region → sites → plots)
  is deferred with the trigger "first consumer with a ≥3-level hierarchy"
  (conservation is the named prospect). Note: the shipped adapter's error message says
  nested recursion "is deferred to Tier 5" — this ADR **narrows Tier 5** to the
  one-level cascade per demo-3 smallest-credible-scope; the implementation updates that
  message to point at the new deferral.
- **Does NOT extend the cascade to other likelihood families.** The only hierarchical
  adapter is Beta-Binomial (ADR-198 Tier 4); there is no EB-hierarchical Normal path,
  so a Normal-indicator team cascade does not exist yet — honestly out of scope, not
  hidden. The allocation algebra itself is family-agnostic by construction (it acts on
  the composed `DistributionSpec` before the conjugate update), so a future
  hierarchical-Normal adapter consumes it unchanged.
- **Does NOT implement `condition()` / `cohortMarginal()` / `identify()`**
  (Commitment 6 — explicitly not required).
- **Does NOT touch cross-pack composition / `ConflictSignal`** (ADR-154 C6 Ring-3
  territory) and does NOT let one pack allocate another pack's effects.
- **Does NOT change the reproducibility tuple.** The allocation is a pure function of
  already-hashed inputs (declarations + resolved members under `asOf`); replay (ADR-220)
  re-derives the same cascade byte-for-byte; `catalogVersionHash` unchanged.
- **Does NOT amend ADR-198, ADR-154, ADR-165, or ADR-224.** It completes ADR-198's
  named Tier-5 deferral and the Inv-5 known gap both the code comment and the pinning
  test booked for exactly this promotion.

## Check-3 evidence plan (the regression specs the implementation must ship)

Per amended ADR-218 §"The thesis-test gate" ledger discipline (in-tree regression specs
preferred over session artifacts), the implementation arc ships these named specs; the
specs#298 Check-3 verdict cites them:

1. **The allocation oracle** — `substrate-contracts/src/plan-tree/effect-allocation.spec.ts`:
   O1 identity (`broadcast` ⇒ `allocatedEffect ≡` composed, every member); O2
   conservation on binary-exact fixtures (strict `toBe`); zero-weight member ⇒ exact
   `0`; `W = 0` ⇒ `zero-total-weight`; `weight-proportional × beta` ⇒
   `allocation-not-applicable`; identity coherence (`δ = 0` ⇒ all-zero assignment);
   the `composeEffects` agreement law (`allocation-disagreement` on mixed groups;
   absent-field defaults compose with explicit `'broadcast'`).
2. **Broadcast byte-compatibility** —
   `substrate-runtime/src/inference/adapters/eb-hierarchical-cascade.oracle.spec.ts`:
   the cascade path under absent/`broadcast` allocation reproduces the pre-Tier-5
   golden vectors exactly (aggregate `(A, B)`, member raw + shrunk posteriors,
   `summary`); plus O3 monotonicity on clean-path fixtures (strict `>`, no fallback
   warnings present).
3. **The coupling / differentiated-claim spec** —
   `…/eb-hierarchical-cascade.coupling.spec.ts`: O4 as specified — zero-dose member:
   raw posterior exactly arm-invariant, shrunk posterior differs across arms, and the
   independent individual-subject contrast shows zero delta; exact `(α, β)`
   comparisons.
4. **The shared-manifest spec** — migrate the deliberate Inv-5 pinning test
   (`eb-hierarchical-beta-binomial.adapter.spec.ts:493–511`) to assert: one
   `requestId`/manifest shared across the pair, `inputHash` over the canonical
   `CounterfactualInput`, and **distinct per-arm handle ids** (the Commitment-4
   hazard).
5. **Determinism / replay** — same `CounterfactualInput` twice ⇒ deep-equal cascade on
   both arms (member ordering canonical by subject id; manifest seed/inputHash stable);
   consistent with the ADR-220 replay posture (no new catalog, no new hash input).
6. **Typed walls** — `weight-proportional` over a `beta` composed prior ⇒
   `effect-not-allocatable` with all named fields; unknown allocation string rejects at
   validation (no broadcast fallback).
7. **Shrink-baseline regression** — a zero-observation member under any allocated
   effect shrinks **fully** to `(A, B)` (the Commitment-3 correctness prerequisite;
   fails against today's raw-indicator-prior baseline call site).

Pack-side wiring (the exercir team what-if surfacing the cascade in the coach UI) is the
Check-3 *demonstration*, tracked in the exercir arc — substrate-only here.

## Alternatives considered

| Option | Why not chosen |
|---|---|
| **Surface-only per-member breakdown** (expose `shrunkMembers()` on the result; no allocation semantics) | Explicitly rejected by the founder. It answers "what is each member's posterior" but not "what does each member *receive*" — the assignment half of demo 3. Broadcast stays the only implicit semantics, untyped and undeclarable. |
| **Allocation on `IndicatorMetadata` / `AggregationRule`** | Conflates indicator-intrinsic pooling with intervention-intrinsic dosing; forecloses two interventions on one indicator allocating differently (Commitment 2 table, option b). |
| **Allocation chosen per inference call** (a `CounterfactualInput` field) | Breaks "the plan tree IS the program" and reproducibility-from-the-tree; two callers could derive different assignments from one declared plan (Commitment 2, option c). |
| **Per-member effect declarations instead of allocation** (the pack writes N child declarations, one per player) | Forces the pack to materialize the cascade by hand at authoring time: roster churn invalidates the plan, the team-level claim disappears as a declared object, and the counterfactual can no longer substitute one team subtree. Relocates the algebra to every consumer — the ADR-176 Alternative-2 failure mode. |
| **A new `cascadeCounterfactual()` port method + result type** | A required interface method is a breaking implementor change (runtime major + every adapter/double/pack binding); the optional-field widen on `PosteriorHandle` carries the identical information additively. Rejected under the additive constraint; recorded as the fallback if a reviewer rejects the optional field. |
| **Fall back to `broadcast` on unknown allocation strings** (the ADR-154 C3 operator-fallback posture) | A silent dose misinterpretation on a medical-grade path: broadcasting a budget (or splitting a non-rival instruction) changes every member's assignment without anyone declaring it. Unknown strategies reject loudly (Commitment 1). |
| **Full hierarchical-Bayes joint cascade now (NumPyro)** | Violates in-process-first (standing constraint; ADR-198 Tier-4 rationale; ADR-224 founder decision 2). The EB cascade is the closed-form, deterministic, request-path-safe slice; full HB is the `apiVersion: 'v2'` upgrade. |

## Consequences

### Positive

- **North-star demo 3 completes.** Both halves — partial-pooled team posterior (ADR-198)
  and team counterfactual cascading to per-member assignments (this ADR) — exist as
  typed, reproducible kernel surface; the nested-hierarchy universality claim becomes
  checkable in-tree (Check 3 / specs#298).
- **The cascade duality closes.** Plan-tree down (ADR-154), subject-hierarchy up
  (ADR-198), subject-hierarchy down (this ADR) — three directional algebras, each
  typed, each with an identity and a composition law, no generic-graph primitive
  anywhere (ADR-176 Alternative-2 honoured).
- **ADR-165 Inv-5 is discharged for the EB path** — the pair is traceable as a single
  causal comparison unit under one manifest, as the fast-path already is.
- **The coupling claim is falsifiable.** O4 pins, in-tree, exactly what N independent
  per-player calls cannot express — the strongest available evidence that the
  hierarchical twin is load-bearing rather than decorative.
- **Byte-compatible adoption.** Absent/`broadcast` allocation reproduces today's
  behaviour exactly (O1); no consumer re-authors anything to upgrade.

### Negative / Watch-items

- **EB hyperprior under-propagation now reaches the surface.** The point-estimate
  `(A, B)` treats the aggregate as known when shrinking members (ADR-198 §Negative; the
  standing manifest warning, adapter lines 218–223). With Tier 5, the **per-member**
  summaries and the **cross-arm member deltas** inherit that approximation: the O4
  coupling is real, but its *magnitude* is computed under a hyperprior treated as
  known — full hierarchical Bayes would propagate hyperprior posterior uncertainty into
  every member delta, generally widening them. The existing manifest warning is
  extended to name the cascade explicitly; the `'v2'` NumPyro path remains the upgrade.
  Not hidden.
- **No team-level dose-response identity.** The algebra conserves the dose at the
  allocation layer (O2); it deliberately does NOT claim the pooled posterior shifts by
  `δ` (Commitment 5, O3 note). Consumers wanting "team moves by exactly X" are asking
  for invented math; the honest answer is monotonicity + the member-level assignment.
- **Two new typed walls.** `weight-proportional × beta` and `weight-proportional` over
  any future non-point composed kind return `effect-not-allocatable`; unknown
  strategies reject. Documented, typed, never silent — but walls.
- **One indicator family.** The cascade exists only where a hierarchical adapter exists
  (Beta-Binomial). A Normal-indicator team cascade waits for a hierarchical-Normal
  path; the algebra is ready for it, the runtime is not.
- **Handle payload grows** by a roster-sized summary array on aggregate handles.
  Bounded (≈ 11–30 members for the named consumers) and summary-only; if a consumer
  with very large aggregates arrives, a `cascade`-elision option is a future additive
  flag, not a reshape.
- **The strategy union is kept open.** Closing it later is a major concern with
  adversarial review (non-foreclosure is load-bearing, ADR-127 invariant 4).

### Invariants that must hold

- The kernel never stores a roster (ADR-198 Tier 2; unchanged).
- The cascade is **derived, never stored** — assignments, member posteriors, and the
  pooled posterior are read-time computations over the generators (declarations + the
  resolution port + weights); no cascade row, no persisted assignment (ADR-176 §4).
- Absent allocation ≡ `'broadcast'` ≡ today's behaviour, byte-for-byte (O1).
- `Σᵢ δᵢ = δ` under `weight-proportional` over `point` composed effects (O2), exactly.
- Paired counterfactual handles share one `RunManifest` and carry distinct handle ids
  (Commitment 4).
- Tree substitution re-conditions every member's assignment and posterior AND the
  pooled posterior through the re-estimated hyperprior (O4); `condition()` is not
  invoked anywhere on this path (Commitment 6).
- The plan-tree spine stays strictly single-parent; nothing here adds a cross-link or a
  second parent (ADR-176 §4 corollary).

## Strategic alignment

- **Check-3 / ADR-218 gate work, on the ratified path.** This is the design half of the
  gate on step 2's completion claim; PASS/FAIL routes per the amended ADR-218 (a FAIL
  or cost blow-up produces the Option-B deferral ADR, never silent continuation).
- **Option A held.** Nothing here is platform marketing; the cascade is pulled by a
  named product surface (the exercir team what-if) and two named prospective pack
  shapes — demand-backed per ADR-176 §3.
- **In-process-first held.** The cascade is closed-form, deterministic, request-path
  safe (pure allocation fold + conjugate updates + MoM pooling); no sampler, no
  sidecar, no `apiVersion` change.
- **2-person feasibility.** One contracts minor (schema widens + one pure function),
  one runtime minor (one adapter's member loop + manifest fix), seven named specs — a
  single focused implementer arc.

## Open-question resolutions (founder, 2026-06-12)

All three open questions were decided in founder review on 2026-06-12. The commitments
above are stated unconditionally in their resolved form; the rejected alternatives are
condensed here so the reasoning trail survives.

### OQ-1 — Dose-unit semantics of `weight-proportional` → **team-total** (as recommended)

**Decision.** The declared magnitude is the **team's total** log-odds dose:
`δᵢ = δ·wᵢ/W`, conservation `Σᵢ δᵢ = δ` — the exact, hand-derivable oracle. Commitment 1
and the O2 regression are unconditional in this form; no alternative oracle form
remains.

**Rejected alternative (condensed).** Per-capita intensity — the declared magnitude as
the *typical member's* dose, `δᵢ = δ·N·wᵢ/W` (weighted mean preserved at `δ` under
uniform weights). Defensible, and the oracle would have adapted mechanically, but it
trades the simple exact conservation law for a roster-size-coupled one and changes how
pack authors write team-level magnitudes (per-player intensity instead of a declared
total). Decided before any catalog carries the field, so no migration arises.

### OQ-2 — Cascade placement → **every aggregate handle** (as recommended)

**Decision.** `cascade` populates uniformly on every aggregate `PosteriorHandle` a
hierarchical adapter serves — plain `posterior()` and both `counterfactual()` arms
identically (Commitment 4). The `shrunkMembers()` audit accessor's reason to exist is
retired: deprecated at runtime 2.1.0, removal rides the next runtime major
(Commitments 4, 7).

**Rejected alternative (condensed).** Counterfactual-arms-only placement — smaller
steady-state payload, but it makes the plain team-posterior call second-class and keeps
the audit accessor alive as the only route to member posteriors outside a
counterfactual. Payload stays bounded and summary-only either way (Commitment 4); the
`cascade`-elision flag remains the future additive lever if a very-large-aggregate
consumer arrives.

### OQ-3 — Targeting's landing shape → **kernel allocation strategies** (founder call, AGAINST the drafted recommendation)

**Decision.** When targeting (`'need-based'` / `'top-k'`) arrives, it lands as **kernel
allocation strategies that read the member posteriors to derive dose shares** — NOT as
pack-computed targeting weights. The `AllocationStrategy` union is the extension
vehicle; each targeting strategy lands via **its own ADR** as the gate. Consequence,
already folded into Commitment 1 law 5: the dose-weight channel split the pack-side
alternative would have required is **not needed** — the ADR-198 pooling weight remains
the only weight channel on the contract surface.

**Founder rationale (recorded faithfully).**

1. **Coherence — only the kernel sees fresh posteriors.** The allocation fold executes
   inside the adapter, where the shrunken member posteriors live. Pack-side targeting
   weights would force the pack to pre-compute dose shares from *previous* posteriors —
   a staleness loop in which the assignment is always conditioned on an outdated read
   of the very quantities the cascade is about to recompute. Posterior-reading
   targeting can therefore only be coherent kernel-side.
2. **A deliberate, recorded ADR-176 exception.** The decision is recorded ahead of
   ≥2-pack demand — ADR-176 §1 limb (b) is not yet satisfied for targeting, and the
   tension is acknowledged, not waved through — as a founder exception with two
   controls: the strategy union as the extension vehicle (minor-version widen;
   reject-unknown posture unchanged) and a dedicated ADR per strategy as the landing
   gate. Nothing ships here; the exception fixes the landing *shape*, not the timing.

**Rejected alternative (condensed — the drafted recommendation).** Pack-side targeting:
the pack computes targeting weights from whatever domain policy it likes and the kernel
allocates `weight-proportional` over them. It honours ADR-176 §1(b) ("targeting is
domain policy until ≥2 packs share a shape") but requires splitting a dose-weight
channel off the ADR-198 pooling weight (new contract surface, Commitment 1 law 5's
original hedge) and inherits the staleness loop of rationale (1). Recorded as the road
not taken; revisiting it is a re-open of this resolution, not a silent drift.

## References

- [ADR-198](adr-198-amend-adr-127-149-aggregate-subject-widening-for-hierarchical-twins.md) —
  the Tier framework; `aggregate` subject (Tier 1), `MemberResolution` (Tier 2),
  `AggregationRule` (Tier 3), the EB-hierarchical path (Tier 4); the explicit Tier-5
  deferral this ADR completes; the inclusion-test argumentation pattern followed here.
- [ADR-154](adr-154-algebraic-effect-declarations-and-composition-operators.md) — the
  effect algebra this extends: `EffectDeclaration` (C1; the `compositionOperator`
  placement precedent and the `decayFactor` superRefine precedent), `DistributionSpec`
  (C2; the reject-unknown extension posture), operators (C3), composition rule (C4).
- [ADR-224](adr-224-inference-side-distribution-aware-effect-consumption.md) — the
  composed-effect consumption path the allocation composes with: the tractability
  matrix (C1; log-odds `point`, identity 0, ADR-224's own OQ-1), `ComposedEffect` on
  the evidence
  surface (C2), read-time derivation (C3), the typed-deferral posture (C4) mirrored by
  `effect-not-allocatable`.
- [ADR-165](adr-165-inference-backbone-port-acid-test-demo-1-scoping.md) — Invariant 5
  (shared paired manifest — the known gap discharged in Commitment 4); Invariant 6 (the
  typed-deferral pattern; `condition()` deferral).
- [ADR-176](adr-176-substrate-kernel-minimality-inclusion-test.md) — the inclusion test
  (applied above), §3 promotion rule (the deferred allocation rules), §4 store
  generators / derive graphs (the cascade is derived, never stored).
- [ADR-218](adr-218-north-star-critical-path-sequencing.md) **as amended 2026-06-12**
  (§"The thesis-test gate") — Check 3 gates step 2; ledger discipline on
  de-braighter/specs#298; the Option-B fallback on FAIL.
- [ADR-199](adr-199-effect-composition-feedback-contracts-only-roll-up.md) — D1
  (`composeEffects` as a Ring-0 pure function — the precedent for `allocateEffect`).
- [ADR-213](adr-213-generalize-subject-ontology-beyond-person.md) — structural subject
  kinds + opaque `role` (the post-WS-8 model the cascade is stated against).
- [ADR-205](adr-205-tenant-scope-on-inference-input-singleton-safe-evidence-reads.md) /
  [ADR-220](adr-220-reproducibility-proof-minimal-run-manifest-and-distribution-catalog.md) —
  tenant-scoped evidence reads + replay discipline, both preserved unchanged.
- [north-star §13](../concepts/design/north-star-vision-capture-2026-05-17.md)
  demonstration 3 (lines 595–605; the driver and the smallest-credible-scope clause);
  §7.2 (inter-Subject nesting); §9.3 (twin-as-counterfactual — the plan-side
  do-operation Commitment 6 leans on).
- Code surfaces cited:
  `libs/substrate-runtime/src/inference/adapters/eb-hierarchical-beta-binomial.adapter.ts`
  (broadcast `composeMembers` 397–436; `shrunkMembers()` 320–327; Inv-5 KNOWN-GAP 305;
  shrink-baseline call site 201–210; handle-id derivation 503–508),
  `…/eb-hierarchical-beta-binomial.adapter.spec.ts:493–511` (the deliberate Inv-5
  pinning test), `…/beta-binomial-fast-path.adapter.ts:250–253, 316–330` (the shared
  manifest convention adopted), `libs/substrate-runtime/src/inference/math/eb-hierarchical-beta.ts`
  (`estimateHyperprior` 67–123, `shrinkMember` 149–160),
  `libs/substrate-contracts/src/inference/inference-types.ts` (`PosteriorHandle`
  134–145, `CounterfactualResult` 198–201),
  `libs/substrate-contracts/src/out-ports/member-resolution.port.ts:30–47`
  (`AggregateMember`), `libs/substrate-contracts/src/plan-tree/effect-composition.ts:61–78`
  (`ComposedEffect`, `CompositionError` widen posture),
  `libs/substrate-contracts/src/plan-tree/effect-declaration.ts:33–90` (the schema +
  superRefine precedent), `libs/substrate-contracts/src/primitives/aggregation-rule.ts`
  (the Tier-3 dual), `libs/substrate-contracts/src/primitives/subject-ref.ts:40–44`.
