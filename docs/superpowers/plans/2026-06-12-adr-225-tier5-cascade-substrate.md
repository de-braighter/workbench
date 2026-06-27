# ADR-225 Tier-5 Down-Cascade — Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Implementer agent type: **substrate-coder-pro**.

**Goal:** Implement ADR-225 (ratified 2026-06-12) in `layers/substrate`: the typed `AllocationRule` algebra, the cascade result shape on aggregate handles, the shared counterfactual manifest (discharging ADR-165 Inv-5), the two prerequisite defect fixes, and the seven Check-3 evidence specs — shipped as additive contracts 2.1.0 + runtime 2.1.0.

**NORMATIVE SOURCE:** `layers/specs/adr/adr-225-tier5-down-cascade-allocation-algebra.md` (in-tree, ratified). Every task names its governing Commitment — the implementer MUST read that section before coding; where this plan and the ADR disagree, **the ADR wins** (and the disagreement is reported, not silently resolved). This is the ADR-224 landing lesson: per-task reviewers receive the RATIFIED ADR as contract.

**Architecture:** Pure Ring-0 allocation fold in contracts (`allocateEffect`), propagated through `composeEffects` under an agreement law; the EB-hierarchical Beta-Binomial adapter is the only wired consumer — allocation-aware member composition, corrected per-member shrink baselines, `cascade` on every aggregate handle, one shared manifest per counterfactual pair.

**Tech Stack:** TypeScript ESM (`.js` import extensions), zod, vitest, `Promise<Result<T, E>>` at boundaries (no throws), plain-Symbol DI. NestJS only in runtime composition (untouched here).

---

## Environment & ground rules (every subagent MUST follow)

- **Workspace:** ALL work in the worktree `D:\development\projects\de-braighter\layers\substrate-wt-adr225` (branch `feat/adr-225-tier5-cascade`, off `origin/main` = `8cf254e`). NEVER run git against `D:\development\projects\de-braighter\layers\substrate` (the main clone) or any other repo.
- **Setup is done by the orchestrator** (worktree + install). Discover the package manager from the lockfile in the worktree (`pnpm-lock.yaml` ⇒ pnpm, else npm) and use it consistently.
- **Test quirk:** `nx test` has an exit-1 executor mismatch on this box (vitest4) — run specs via `npx vitest run --config <project vitest config> <filter>` (locate configs with Glob first; substrate projects keep them per-lib). Build-verify: `npx nx build substrate-contracts && npx nx build substrate-runtime`. Lint: `npx nx lint substrate-contracts substrate-runtime` (build/test do NOT run eslint).
- **Substrate conventions (hard):** ESM imports with explicit `.js`; `Result<T, E>` returns (`ok()`/`err()` from `primitives/error-envelope.js`) — no throws across module boundaries; error-union widens are additive variants; deterministic everywhere (no wall-clock in fixtures; seeds via the existing `makeRng`/`stableSeed` helpers).
- **Commit per task**, conventional messages ending `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Never push (orchestrator pushes).
- ADR-225's worked fixtures are FIXED oracles: `w = {1, 1, 2}`, `δ = 0.5` ⇒ `δᵢ = {0.125, 0.125, 0.25}`, `Σ = 0.5` exactly (binary-exact, assert with `toBe`, never `toBeCloseTo`). If a live computation disagrees with an ADR oracle, STOP and report BLOCKED.

### File map (locked decomposition)

| File | Status | Owner task |
|---|---|---|
| `libs/substrate-contracts/src/plan-tree/allocation-rule.ts` | NEW | 1 |
| `libs/substrate-contracts/src/plan-tree/effect-declaration.ts` | widen (`allocation?`) | 1 |
| `libs/substrate-contracts/src/plan-tree/effect-composition.ts` | widen (`ComposedEffect.allocation?`, `allocation-disagreement`, agreement law) | 1 |
| `libs/substrate-contracts/src/plan-tree/effect-allocation.ts` + `.spec.ts` | NEW (pure fold + evidence spec 1) | 2 |
| `libs/substrate-contracts/src/primitives/error-envelope.ts` | widen (`effect-not-allocatable`) | 3 |
| `libs/substrate-contracts/src/inference/inference-types.ts` | widen (`MemberAssignment`, `CascadeDetail`, `PosteriorHandle.cascade?`) | 3 |
| contracts barrels (`index.ts`, plan-tree/inference subpath exports) | widen | 1–3 |
| `libs/substrate-runtime/src/inference/eb-hierarchical-beta.ts` | shrink-baseline plumbing if needed (contract says baseline already parameterized) | 4 |
| `libs/substrate-runtime/src/inference/adapters/eb-hierarchical-beta-binomial.adapter.ts` | baseline fix; allocation-aware composition; cascade; shared manifest; per-arm handle ids; `@deprecated shrunkMembers` | 4–6 |
| `…/adapters/eb-hierarchical-beta-binomial.adapter.spec.ts` | migrate Inv-5 pinning test (evidence 4); baseline regression (evidence 7) | 4, 6 |
| `…/adapters/eb-hierarchical-cascade.oracle.spec.ts` | NEW (evidence 2: O1 scoped + O3) | 7 |
| `…/adapters/eb-hierarchical-cascade.coupling.spec.ts` | NEW (evidence 3: O4 + evidence 5 determinism + evidence 6 walls) | 8 |
| `libs/substrate-contracts/package.json`, `libs/substrate-runtime/package.json`, CHANGELOGs | 2.1.0 | 9 |

---

### Task 1: Contracts — `AllocationStrategy` + declaration/composition widen (Commitments 1 & 2)

**Normative:** ADR-225 Commitment 1 (the union + laws) and Commitment 2 items 1–2 (placement + agreement law). Read both sections fully first.

- [ ] **Step 1:** Create `libs/substrate-contracts/src/plan-tree/allocation-rule.ts` exactly per Commitment 1's code block:

```ts
import { z } from 'zod';

/**
 * AllocationRule — the down-dual of AggregationRule (ADR-225): how a team-level
 * declared effect apportions over an aggregate's members. Registry-extensible
 * string-literal union — widen via minor bump (ADR-127 invariant 4; the
 * AggregationRule precedent in aggregation-rule.ts).
 *   - 'broadcast' (identity; DEFAULT when absent): every member receives the
 *     full dose (non-rival claim) — δᵢ = δ.
 *   - 'weight-proportional': divisible team-total dose, δᵢ = δ·wᵢ/W over the
 *     ADR-198 pooling weights; conservation Σδᵢ = δ (ADR-225 O2). Defined over
 *     point composed priors only (Commitment 3).
 * Unknown strategies REJECT at validation — never fall back (a dose
 * misinterpretation is a safety hazard; ADR-225 Commitment 1, deferred rules).
 */
export const AllocationStrategySchema = z.enum(['broadcast', 'weight-proportional']);
export type AllocationStrategy = z.infer<typeof AllocationStrategySchema>;
```

- [ ] **Step 2 (TDD):** Extend the existing effect-declaration spec (find it beside `effect-declaration.ts`) with failing cases: (a) a declaration WITH `allocation: 'weight-proportional'` parses; (b) absent `allocation` parses (back-compat); (c) `allocation: 'bogus'` REJECTS. Run → fail.
- [ ] **Step 3:** Widen `EffectDeclarationSchema` in `effect-declaration.ts` with `allocation: AllocationStrategySchema.optional()` (doc comment: absent ⇒ `'broadcast'`; intervention-intrinsic, NOT indicator-intrinsic — cite ADR-225 Commitment 2 table). Run → green.
- [ ] **Step 4 (TDD):** Extend the composition spec (beside `effect-composition.ts`) with failing cases per Commitment 2 item 2: (a) within one `indicatorId` group, two declarations both `'weight-proportional'` compose and `ComposedEffect.allocation === 'weight-proportional'`; (b) one absent + one explicit `'broadcast'` compose (defaulted agreement) with composed allocation `'broadcast'`/absent-normalized; (c) `'broadcast'` mixed with `'weight-proportional'` in one group → `CompositionError` kind `'allocation-disagreement'` (carrying the indicatorId + the two strategies — mirror the existing operator-disagreement variant's field style); (d) groups for DIFFERENT indicators may use different allocations.
- [ ] **Step 5:** Implement in `effect-composition.ts`: add the `allocation-disagreement` variant to `CompositionError` (additive); add `allocation?: AllocationStrategy` to `ComposedEffect`; in `composeEffects`, resolve each declaration's effective allocation (absent ⇒ `'broadcast'`), enforce group agreement exactly like the ADR-154 C4 operator-agreement rule, stamp the composed output. Run → green; run the FULL contracts suite.
- [ ] **Step 6:** Barrel exports (plan-tree subpath + root index, matching existing export style). Build + lint green. Commit: `feat(contracts): AllocationStrategy + EffectDeclaration/ComposedEffect allocation widen with agreement law (ADR-225 C1/C2)`.

### Task 2: Contracts — `allocateEffect` pure fold + evidence spec 1 (Commitment 2 item 3)

**Normative:** ADR-225 Commitment 2 item 3 (the exact interface) + Commitment 1 laws + evidence plan item 1.

- [ ] **Step 1 (TDD):** Create `libs/substrate-contracts/src/plan-tree/effect-allocation.spec.ts` — evidence spec 1, ALL cases:
  - O1 identity: `broadcast` ⇒ `allocatedEffect` deep-equals the composed magnitude for every member, weights echoed.
  - O2 conservation, binary-exact: members with weights `{1, 1, 2}` (`W=4`), composed point `δ = 0.5` under `'weight-proportional'` ⇒ magnitudes `{kind:'point', value: 0.125}/{0.125}/{0.25}` and `expect(d1 + d2 + d3).toBe(0.5)` — strict `toBe` throughout.
  - Zero-weight member ⇒ exactly `{kind:'point', value: 0}`.
  - All-zero weights (`W = 0`) ⇒ `err({ kind: 'zero-total-weight', allocation: 'weight-proportional' })`.
  - `weight-proportional` × `beta` composed prior ⇒ `err({ kind: 'allocation-not-applicable', allocation: 'weight-proportional', composedPriorKind: 'beta' })`.
  - Identity coherence: `δ = 0` ⇒ every allocated value exactly `0` under BOTH rules.
  - Order-invariance: permuting the members array yields the same per-subject assignments.
  Run → fail (module missing).
- [ ] **Step 2:** Create `effect-allocation.ts` per the ADR's interface verbatim:

```ts
import type { AggregateMember } from '../out-ports/member-resolution.port.js'; // verify actual path
import type { SubjectRef } from '../primitives/subject-ref.js';
import { err, ok, type Result } from '../primitives/error-envelope.js';
import type { DistributionSpec } from './distribution-spec.js'; // verify actual path
import type { ComposedEffect } from './effect-composition.js';
import type { AllocationStrategy } from './allocation-rule.js';

export interface AllocatedEffect {
  subject: SubjectRef;
  weight: number;
  /** The member's allocated composed prior. */
  magnitude: DistributionSpec;
}
export type AllocationError =
  | { kind: 'allocation-not-applicable'; allocation: AllocationStrategy;
      composedPriorKind: DistributionSpec['kind'] }
  | { kind: 'zero-total-weight'; allocation: AllocationStrategy };

/** Ring-0 pure allocation fold (ADR-225 Commitment 2.3): deterministic,
 *  O(members), no I/O. broadcast ⇒ magnitude per member ≡ composed; weight-
 *  proportional ⇒ point value δ·wᵢ/W (point composed priors only). */
export function allocateEffect(
  composed: ComposedEffect,
  members: readonly AggregateMember[],
): Result<AllocatedEffect[], AllocationError> { /* implement per the laws */ }
```

  (Adjust import paths to the real module layout — read the neighbouring files first; the SHAPES are fixed.) Implement: effective allocation = `composed.allocation ?? 'broadcast'`; broadcast maps every member to the composed magnitude; weight-proportional guards `composed.magnitude.kind === 'point'` (else `allocation-not-applicable`), computes `W` (`<= 0` ⇒ `zero-total-weight`), maps `value: composed.magnitude.value * (m.weight / W)`.
- [ ] **Step 3:** Run evidence spec 1 → green; full contracts suite green; barrel export; build + lint. Commit: `feat(contracts): allocateEffect pure fold + allocation oracle spec (ADR-225 C2.3, evidence 1)`.

### Task 3: Contracts — error + result-shape widens (Commitments 3 & 4)

**Normative:** ADR-225 Commitment 3 (the `effect-not-allocatable` block, verbatim fields) + Commitment 4 (the `MemberAssignment`/`CascadeDetail`/`PosteriorHandle.cascade?` block, verbatim).

- [ ] **Step 1 (TDD):** Extend the error-envelope spec: an `effect-not-allocatable` object with all named fields (`indicatorKey`, `allocation`, `composedPriorKind`, `reason: 'non-point-composed-prior' | 'zero-total-weight'`, `deferredAdrPointer`) typechecks as `InferenceError`; extend the inference-types spec (or add type-level assertions in the existing style): a `PosteriorHandle` WITHOUT `cascade` remains valid (additive), one WITH a sorted `members: MemberAssignment[]` carrying `allocatedEffect: DistributionSpec | null` typechecks.
- [ ] **Step 2:** Apply both widens exactly per the ADR blocks (Commitment 3 error variant; Commitment 4 interfaces incl. doc comments: cascade "Present iff the handle's subject is an `aggregate` served by a hierarchical adapter"; members "Sorted by subject id ascending"). Barrel exports.
- [ ] **Step 3:** Full contracts suite + build + lint green. Commit: `feat(contracts): effect-not-allocatable widen + cascade result shape (ADR-225 C3/C4)`.

### Task 4: Runtime — shrink-baseline fix + evidence spec 7 (Commitment 3 prerequisite)

**Normative:** ADR-225 Commitment 3 §"Correctness prerequisite" — read it verbatim; it cites the defect at `eb-hierarchical-beta-binomial.adapter.ts:201–210` and the already-correct `shrinkMember` contract at `eb-hierarchical-beta.ts:125–147`.

- [ ] **Step 1 (TDD, evidence spec 7):** In the adapter spec, add the regression: an aggregate with one zero-observation member under a tree carrying ANY composed effect (use a `point` log-odds effect via the existing seeding helpers) — the zero-observation member's shrunk posterior must equal the hyperprior `(A, B)` EXACTLY (full shrinkage: it contributed no evidence). Run → MUST FAIL against today's raw-indicator-prior baseline call site (if it passes, the fixture is wrong — investigate, don't proceed).
- [ ] **Step 2:** Fix the call site: thread each member's **effective composed prior** (the prior the member was actually composed under — logit-shifted for `point`, replaced for `beta`) as that member's shrink baseline, replacing the uniform `{ priorAlpha: meta.priorAlpha ?? 1, priorBeta: meta.priorBeta ?? 1 }`. The member-composition path must therefore expose the effective prior alongside the raw posterior (extend the internal composed-member shape).
- [ ] **Step 3:** Run the full runtime EB suite — pre-existing shrunk-member assertions that pinned the DEFECTIVE baselines under effects must be updated to the corrected oracles (recompute by hand from the fixtures; document the correction in the assertion comments — these are exactly the "named delta" of O1's effect-bearing scope). Aggregate `(A,B)`, raw posteriors, summaries must be UNTOUCHED — if any of those move, STOP (the fix leaked).
- [ ] **Step 4:** Build + lint + full runtime suite green. Commit: `fix(runtime): per-member effective-prior shrink baselines + full-shrinkage regression (ADR-225 C3 prerequisite, evidence 7)`.

### Task 5: Runtime — allocation-aware composition + cascade on every aggregate handle (Commitments 3 & 4)

**Normative:** ADR-225 Commitment 3 (tractability table + adapter-side error mapping, verbatim) + Commitment 4 (uniform placement; canonical sort; payload bounds; `shrunkMembers` deprecation).

- [ ] **Step 1 (TDD):** Adapter-spec additions: (a) an aggregate posterior under a `weight-proportional` point effect with weights `{1, 1, 2}` and team δ — each member's raw posterior reflects ITS δᵢ (verify via the cascade members' differing summaries; pick a fixture where the three differ measurably); (b) every aggregate handle (plain `posterior()` AND both `counterfactual()` arms) carries `cascade` with `allocation` echoed and members sorted by subject id ascending; (c) `allocatedEffect` is `null` on an effect-free tree; (d) `weight-proportional` over a `beta` composed prior ⇒ `effect-not-allocatable` with `reason: 'non-point-composed-prior'`; all-zero weights ⇒ `reason: 'zero-total-weight'` (the Commitment-3 mapping). Run → fail.
- [ ] **Step 2:** Implement in the adapter: call `allocateEffect(composedEffect, members)` once per posterior; compose each member with ITS allocated prior (the existing per-member `composeBetaPosterior` path, now fed per-member magnitudes — the ADR-224 1b-ii logit shift with δᵢ); map `AllocationError → effect-not-allocatable` per the explicit mapping; populate `cascade: { allocation, members }` on the minted handle (shrunk summaries via the existing summary helper; sort canonical); mark `shrunkMembers()` with `@deprecated` JSDoc pointing at `PosteriorHandle.cascade` (do NOT remove — Commitment 7).
- [ ] **Step 3:** Also update the adapter's nested-aggregate rejection message ("deferred to Tier 5" → point at ADR-225 §does-NOT-do's ≥3-level-hierarchy deferral) — the ADR explicitly instructs this.
- [ ] **Step 4:** Full runtime suite + build + lint green. Commit: `feat(runtime): allocation-aware EB composition + cascade detail on aggregate handles (ADR-225 C3/C4)`.

### Task 6: Runtime — shared counterfactual manifest + per-arm handle ids + evidence spec 4 (Commitment 4)

**Normative:** ADR-225 Commitment 4 final bullet (fast-path convention verbatim, `beta-binomial-fast-path.adapter.ts:250–253, 316–330`) + the Commitment-4 handle-id hazard (`handleIdFor` keying on `manifest.inputHash` at adapter:503–508).

- [ ] **Step 1 (TDD, evidence spec 4):** MIGRATE the deliberate Inv-5 pinning test (`eb-hierarchical-beta-binomial.adapter.spec.ts:493–511` — it currently asserts `requestId).not.toBe(...)` and says it exists to "fail loudly and force an intentional migration"): rewrite to assert (a) ONE shared `requestId` + manifest across the pair; (b) `inputHash` computed over the canonical JSON of the full `CounterfactualInput` (mirror how the fast-path asserts it); (c) **distinct per-arm handle ids**. Run → fail.
- [ ] **Step 2:** Implement: `counterfactual()` builds the pair manifest ONCE (fast-path convention) and threads it to both arms' handle minting; fix `handleIdFor` to key on the per-arm `treeRoot` (the fast-path's approach) so shared manifests can't collide handle ids; the internal `posterior()` reuse must accept an injected manifest (refactor minimally — e.g. private `posteriorWithManifest`).
- [ ] **Step 3:** Full runtime suite green (the old pinning assertions are GONE — replaced, not duplicated). Build + lint. Commit: `feat(runtime): shared counterfactual manifest + per-arm handle ids — ADR-165 Inv-5 discharged (ADR-225 C4, evidence 4)`.

### Task 7: Evidence spec 2 — the cascade oracle spec (O1 scoped + O3)

**Normative:** ADR-225 Commitment 5 O1 (the SCOPED two-case wording — read it exactly) + O3 (incl. the clean-path fixture constraint: avoid the `estimateHyperprior` fallback branches at `eb-hierarchical-beta.ts:87–108`), evidence plan item 2.

- [ ] **Step 1:** Create `…/adapters/eb-hierarchical-cascade.oracle.spec.ts`:
  - **Effect-free fixtures:** capture the pre-Tier-5 golden vectors (hand-derive from the fixtures OR pin from a base-commit run — document which) and assert the cascade-path run reproduces aggregate `(A, B)`, member raw + shrunk posteriors, and `summary` byte-identically under absent AND explicit `'broadcast'`.
  - **Effect-bearing broadcast fixtures:** identical aggregate `(A, B)`, member raw posteriors, and `summary` vs the pre-fix expectations; member SHRUNK posteriors asserted against the corrected Commitment-3 baselines (hand-derived; comment the derivation), cross-referencing evidence 7.
  - **O3 monotonicity:** `δ > 0`, direction `'+'`, clean-path fixtures (assert NO fallback warnings on the manifest): every dosed member's raw posterior mean strictly exceeds its `δ = 0` value, and the pooled mean `A/(A+B)` strictly increases — strict `>`, no tolerances. Do NOT assert the pooled shift equals δ (the ADR forbids that claim — method-of-moments is nonlinear).
- [ ] **Step 2:** Green; commit: `test(runtime): cascade oracle spec — scoped broadcast identity + pooled monotonicity (ADR-225 evidence 2)`.

### Task 8: Evidence specs 3 + 5 + 6 — coupling (O4), determinism, typed walls

**Normative:** ADR-225 Commitment 5 O4 (verbatim — the headline regression) + evidence items 3/5/6.

- [ ] **Step 1:** Create `…/adapters/eb-hierarchical-cascade.coupling.spec.ts`:
  - **O4 (the differentiated claim):** trees `T0`/`T1` differing in one team-scoped subtree, `weight-proportional`; member `z` with `w_z = 0` (⇒ `δ_z = 0` in BOTH arms). Assert with exact `(α, β)` comparisons: (i) `z`'s RAW posterior is identical across arms; (ii) `z`'s SHRUNK posterior DIFFERS across arms (the re-estimated hyperprior is the only channel); (iii) the independent-call contrast: an `individual`-subject `counterfactual()` for `z` alone over the same trees shows zero delta. Comment block naming this the Check-3 in-tree evidence (cascade Δ ≠ 0 ∧ raw Δ = 0 ∧ independent Δ = 0).
  - **Evidence 5 (determinism):** the same `CounterfactualInput` run twice ⇒ deep-equal `cascade` on both arms; member ordering canonical; manifest seed/inputHash stable.
  - **Evidence 6 (typed walls):** `weight-proportional × beta` ⇒ `effect-not-allocatable` with ALL named fields populated; a declaration with an unknown allocation string REJECTS at schema validation (no broadcast fallback) — assert at the contracts boundary the adapter consumes.
- [ ] **Step 2:** Green; full runtime suite; commit: `test(runtime): coupling/determinism/walls — the Check-3 differentiated-claim regression (ADR-225 evidence 3/5/6, O4)`.

### Task 9: Version bumps + changelogs + full gates (Commitment 7)

- [ ] **Step 1:** `libs/substrate-contracts/package.json` + `libs/substrate-runtime/package.json` → `2.1.0` (verify current published versions FIRST: `npm view @de-braighter/substrate-contracts versions --json` tail — the bump must be vs the registry, not just the file). Runtime's dependency range on contracts widens to `^2.1.0` if it pins.
- [ ] **Step 2:** CHANGELOG entries (both packages, matching their existing format): the ADR-225 additions, the Inv-5 discharge, the shrink-baseline fix (called out as behaviour-visible for shrunk members under effects), the `shrunkMembers()` deprecation.
- [ ] **Step 3:** Full repo gate: `npm run ci:local` (or the pnpm equivalent — whatever the repo defines) → green. Fix fallout; commit `chore(release): stage substrate-contracts 2.1.0 + substrate-runtime 2.1.0 (ADR-225)`.

---

## Orchestrator-level finish (NOT subagent tasks)

1. **Story issue** on de-braighter/substrate: "Story: ADR-225 Tier-5 down-cascade — allocation algebra + cascade result shape (Check 3)"; standalone; links ADR-225 + specs#298.
2. **Push + PR-first** with `Closes #<story>`, `Producer: orchestrator/claude-fable-5 [brainstorming, writing-plans, subagent-driven-development]`, `Effort: deep` (wave + designer-first ADR), `Effect: cycle-time 0.01±0.01 expert`, `Effect: findings 4±2 expert`.
3. **Full code wave** (parallel, read-only-git discipline): local-ci + reviewer + charter-checker + qa-engineer. Reviewers receive ADR-225 (the ratified contract), ADR-198, ADR-224, ADR-165 Inv-5 context. Reviewer hunt-list: allocation math vs the laws; the shrink-baseline fix's blast radius (aggregate/raw/summary must be unchanged); shared-manifest reproducibility; additive-only claim (no breaking shape change); determinism (no wall-clock).
4. **Findings → post-findings BEFORE merge; drain; merge; backfill/reconcile/reviews/resolve-findings.**
5. **Publish 2.1.0** (both packages, GitHub Packages — follow the repo's release flow used for 2.0.0; verify with `npm view … versions`).
6. Tee up the **exercir consumer arc** (separate plan): team what-if over the cascade + endpoint + the Check-3 ledger verdict on specs#298.
