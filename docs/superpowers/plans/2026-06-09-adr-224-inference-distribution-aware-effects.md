# ADR-224 — Inference-side distribution-aware consumption of composed plan-tree effects

## Goal

Make the substrate inference side **stop reducing plan-tree effects to a central
scalar and stop composing them ad-hoc**. Instead, the evidence-side effect input
carries the full `DistributionSpec` of the **composed** effect — produced at
inference read-time by the shipped Ring-0 `composeEffects` honoring the declared
`compositionOperator` — and each conjugate adapter folds that composed prior into
its posterior by a **closed-form deterministic update** where one exists, returning
a **typed `deferred` envelope** where it does not. This closes audit finding I5
(the divergence between the plan-side distribution-preserving algebra and the
inference-side lossy, operator-blind, order-dependent scalar reduction), per
[ADR-224](../../../layers/specs/adr/adr-224-inference-side-distribution-aware-effect-consumption.md).

Concretely, after this plan:

- `EvidenceRepository.findEffectsForTree(...)` returns **`ComposedEffect[]`** (one
  per indicator, carrying `magnitude: DistributionSpec`, `operator`, `direction`,
  `contributingDeclarationIds`) — not the flat-scalar runtime-internal
  `EffectDeclaration[]` (`magnitudePrior: number`, `ordinal`). The per-node
  `ordinal` disappears from the inference surface; ordering is consumed **inside**
  `composeEffects` (`sequential-with-decay` only) and never re-exposed, which
  retires the order-dependent adapter loops.
- `effect-subtree.ts`'s `reduceMagnitude` is **demoted** from the central-scalar
  collapse that gated composition to a degenerate `point` moment-extraction helper.
  Composition is derived at read-time via `composeEffects`.
- The Normal-Normal closed form gains **σ_E² variance propagation** (the
  `composeNormalPosterior` fix). The Beta-Binomial point-effect closed form moves
  from proportion-multiplicative to **log-odds additive** (`logit(p₀)+δ`). The
  Weibull-AFT point-effect closed form is re-stated as a **log-HR shift**.
- Every non-conjugate `(composed-prior-kind × likelihood)` cell returns a typed
  `effect-not-conjugable` envelope — **never** an approximated number.
- `composeEffects` errors that now surface on the inference read path map to a
  dedicated `effect-composition-failed` `InferenceError` variant (OQ-2 resolved).

## Architecture

The tractability matrix (ADR-224 Commitment 1a) is the contract. After
`composeEffects` folds the per-node declarations under their shared operator, the
inference receives a single `DistributionSpec` per `(treeRoot, indicatorKey)`,
keyed on **the composed prior's `kind` + the conjugate likelihood column**:

| composed-prior `kind` | Normal-Normal | Beta-Binomial | Survival (Weibull-AFT) |
|---|:---:|:---:|:---:|
| `point` (degenerate σ_E²=0) | ✓ mean-shift, no added variance (1b-i) | ✓ log-odds shift of pseudo-counts (1b-ii) | ✓ log-HR shift (1b-iii) |
| `normal` (from `sum`/`overlay`/`mult`/`seq`, or normal `replace`/`max`) | ✓ convolution mean-shift **with σ_E² propagation** (1b-i) | `deferred` | `deferred` |
| `beta` (only via `max`/`replace`) | `n/a` | ✓ conjugate Beta-prior reshaping (1b-iv) | `deferred` |
| `lognormal` (only via `max`/`replace`) | `deferred` | `deferred` | `deferred` (OQ-4: stays deferred) |

The honest closed-form surface in v1 is the **left `point` column** (all three
likelihoods) **plus the diagonal**: every `point`, `normal`→Normal-Normal, and
`beta`→Beta-Binomial. Everything else is the typed `effect-not-conjugable` defer.

Two key invariants this plan preserves:

- **Read-time composition (Commitment 3 / ADR-176 §4 store-generators-derive-graphs).**
  `composeEffects` runs **at inference read-time** over the RLS-scoped live
  declarations the `EvidenceRepository` reads — never persisted as a composed
  parent effect. No schema migration; `kernel.plan_node.effects` (ADR-200) is
  unchanged. The counterfactual stays trivially correct: a what-if is
  "read the substituted subtree's declarations and re-derive the composition".
- **Determinism (Commitment 5).** Every closed-form cell is pure arithmetic + the
  existing deterministic inverse-CDF moment helpers — no `Date.now`, no `random`
  in the fold or the conjugate update. Bit-reproducible from
  `(seed, engineVersion, catalogVersionHash, inputHash, observationsHash)`. The
  derived `ComposedEffect` is a pure function of already-hashed inputs;
  `catalogVersionHash` is unchanged by this ADR.

**Versioning (Commitment 2.3).**

- `@de-braighter/substrate-contracts` — **MINOR** bump (1.2.0 → 1.3.0). No published
  contract *type* changes; `ComposedEffect` / `DistributionSpec` / `composeEffects`
  already ship (ADR-199 D1). The change is two additive `InferenceError` widens
  (`effect-not-conjugable` + `effect-composition-failed`) — add-a-variant is minor.
- `@de-braighter/substrate-runtime` — **MAJOR** bump (1.2.0 → 2.0.0). The
  runtime-internal `EvidenceRepository.findEffectsForTree` return shape changes;
  every adapter binding + test double moves in lockstep (ADR-110 invariant 4
  substitutability). Pack apps that bind `EVIDENCE_REPOSITORY` re-publish against
  the new runtime major.

**Order of work (keeps the repo green at every commit).** Contracts widen first
(additive, no consumer breaks) → the runtime port + the shared derivation
(`effect-subtree`) → per-cell math (each closed form independently) → the three
adapters + the two test doubles in lockstep → reproducibility/replay → the DB
integration proof. The breaking `findEffectsForTree` shape change lands as a single
atomic commit across the port + both adapters + the in-memory double + every
call-site, so no intermediate commit leaves the port half-migrated.

## Tech Stack

- TypeScript (NodeNext / Node16 module resolution — **all relative imports carry
  explicit `.js` extensions**), Zod (contracts runtime dep), NestJS (runtime only).
- Vitest 4 (`nx run-many -t test --parallel=1`); DB-integration tier via
  `npm run test:db` (`tools/db/test.mjs`), gated on `SUBSTRATE_DATABASE_URL` +
  `SUBSTRATE_APP_DATABASE_URL`, now part of the default gate `ci:local:full`
  (`ci:local` unit tier → `ci:local:db` integration tier).
- Analytical-oracle math specs (closed-form expected values computed by hand in the
  test, asserted via `toBeCloseTo(expected, 12)`) — the repo convention in
  `math/normal-normal.spec.ts`, `math/beta-binomial.spec.ts`, `math/weibull-aft.spec.ts`.
- Shared contract suites (`*.contract.ts`) parameterised by a `seed(...)` fixture,
  run against both the in-memory double and the Prisma adapter (ADR-110 inv 4).

**REQUIRED SUB-SKILL: subagent-driven-development** — every task below is executed
by dispatching `subagent-driven-development`; never run inline. Each task is a
strict TDD micro-loop: write the failing test → run it and observe the expected
failure → minimal implementation → run to green → commit.

---

## Steps

### Phase A — Contracts widen (MINOR; additive, no consumer break)

- [ ] **Task A1 — Add the two `InferenceError` envelope variants (contracts).**
  - **Test first.** New spec
    `libs/substrate-contracts/src/primitives/error-envelope.spec.ts` (create if
    absent) with two exhaustiveness/shape cases:
    1. A value of kind `'effect-not-conjugable'` carrying
       `{ indicatorKey: string; composedPriorKind: DistributionSpec['kind'];
       operator: CompositionOperator; conjugateFamily: ConjugateHint | InferenceFamilyRef;
       deferTrigger: 'numpyro-sidecar-binding' | 'numerical-quadrature-engine';
       deferredAdrPointer: string }` is assignable to `InferenceError`, and a
       `switch (e.kind)` narrows each field to its declared type (assert via a
       type-level `satisfies` plus a runtime `expect(e.composedPriorKind).toBe('normal')`).
    2. A value of kind `'effect-composition-failed'` carrying
       `{ indicatorKey: string; compositionError: CompositionError }` is assignable
       to `InferenceError`, and the nested `compositionError.kind` narrows.
    Run → **fails to compile** (variants don't exist).
  - **Minimal impl.** In
    `libs/substrate-contracts/src/primitives/error-envelope.ts`, extend the
    `InferenceError` union with exactly these two arms (append after `internal`):
    ```typescript
    | {
        kind: 'effect-not-conjugable';
        indicatorKey: string;
        composedPriorKind: DistributionSpec['kind'];
        operator: CompositionOperator;
        conjugateFamily: ConjugateHint | InferenceFamilyRef;
        deferTrigger: 'numpyro-sidecar-binding' | 'numerical-quadrature-engine';
        deferredAdrPointer: string;
      }
    | {
        kind: 'effect-composition-failed';
        indicatorKey: string;
        compositionError: CompositionError;
      }
    ```
    Add the needed imports at the top of `error-envelope.ts` (all with `.js`):
    `import type { DistributionSpec } from '../plan-tree/distribution-spec.js';`,
    `import type { CompositionOperator } from '../plan-tree/composition-operator.js';`,
    `import type { CompositionError } from '../plan-tree/effect-composition.js';`,
    and `import type { ConjugateHint, InferenceFamilyRef } from '../inference/inference-types.js';`.
    **Guard against a circular import:** `inference/inference-types.ts` already
    imports `Result` + `InferenceError` from `error-envelope.js`. Importing
    `ConjugateHint`/`InferenceFamilyRef` *back* from `inference-types.js` into
    `error-envelope.ts` re-introduces the exact cycle that file's header comment
    documents avoiding. If `tsc`/the bundler trips the cycle, **inline the two
    string-literal types locally** in `error-envelope.ts`
    (`type ConjugateHintLike = 'beta' | 'normal' | 'lognormal'`;
    `conjugateFamily: ConjugateHintLike | string`) and note the duplication in a
    comment — DO NOT introduce the back-edge import. (Flagged: see Planning
    assumptions §2.)
  - Run → **green**. Commit:
    `feat(contracts): add effect-not-conjugable + effect-composition-failed InferenceError variants (ADR-224 C2/C4, OQ-2)`.

- [ ] **Task A2 — CHANGELOG + version bump (contracts MINOR).**
  - No test. Edit `libs/substrate-contracts/package.json` `version` → `1.3.0`.
  - Move the `[Unreleased]` B3-S3.5 survival-projection entry under a new
    `## [1.3.0]` heading in `libs/substrate-contracts/CHANGELOG.md` together with a
    new `### Added (ADR-224 — distribution-aware effect consumption)` block:
    list `effect-not-conjugable` (the typed-deferral envelope for a non-conjugate
    matrix cell) + `effect-composition-failed` (carries the `CompositionError`
    payload when read-time `composeEffects` fails during `posterior()`/`counterfactual()`),
    both **additive** (add-a-variant = minor per the `InferenceError` posture).
    Note `ComposedEffect`/`DistributionSpec`/`composeEffects` are **unchanged** —
    they already ship (ADR-199 D1); this release only makes the inference side
    *consume* them.
  - Commit: `chore(contracts): bump to 1.3.0 — ADR-224 InferenceError widens`.

### Phase B — Runtime port + shared derivation (still on the OLD adapters; no behavior change yet)

- [ ] **Task B1 — Demote `reduceMagnitude` to a degenerate `point` moment extractor; add `composedEffectMoments`.**
  - **Test first.** Extend `libs/substrate-runtime/src/inference/effect-subtree.spec.ts`:
    1. New `describe('composedEffectMoments')`: a `ComposedEffect` whose
       `magnitude` is `{ kind:'point', value: 0.4 }` → `{ mean: 0.4, variance: 0 }`;
       `{ kind:'normal', mean: 1.2, sd: 0.5 }` → `{ mean: 1.2, variance: 0.25 }`;
       `{ kind:'beta', alpha:3, beta:1 }` → `{ mean: 0.75, variance: 3*1/((4*4)*5) }`;
       `{ kind:'lognormal', meanLog:0, sdLog:1 }` → mean `exp(0.5)`, variance
       `(exp(1)-1)*exp(1)`. Assert `toBeCloseTo(expected, 12)`.
    Run → **fails** (`composedEffectMoments` undefined).
  - **Minimal impl.** In `libs/substrate-runtime/src/inference/effect-subtree.ts`:
    - Add a pure exported helper
      `export function composedEffectMoments(spec: DistributionSpec): { mean: number; variance: number }`
      that mirrors the `priorMean`/`priorVariance` switch already living **inside**
      `effect-composition.ts` (re-state it here over the structural
      `DistributionSpec` so the runtime keeps zero dependency on contracts-private
      helpers; the math is the source-of-truth duplicate of ADR-199's per-kind
      moments). Import `type { DistributionSpec } from '@de-braighter/substrate-contracts/plan-tree';`.
    - Keep `reduceMagnitude` **only** as the degenerate `point` extractor used by
      the legacy keyed path during migration; update its doc-comment to say it is
      retired from the composition path (it no longer gates composition) and will
      be deleted once the legacy `registerEffects` keyed map is removed. DO NOT
      delete it in this task — the legacy in-memory `registerEffects` fallback
      still calls it until Task C3 lands the new shape.
  - Run → **green**. Commit:
    `refactor(inference): add composedEffectMoments; demote reduceMagnitude off the composition path (ADR-224 C2)`.

- [ ] **Task B2 — Widen `findEffectsForTree` to `ComposedEffect[]` across the port + BOTH adapters + the in-memory double, in one atomic commit (the runtime breaking change).**
  - **Test first — the contract suite is the failing test.** Rewrite
    `libs/substrate-runtime/src/inference/evidence-repository.find-effects-for-tree.contract.ts`
    so the suite asserts through a **`ComposedEffect[]`** return:
    - Drop the per-node `EffectDeclaration { planNodeId, ordinal, magnitudePrior:number }`
      assertions. The new public surface is one `ComposedEffect` per indicator with
      `magnitude: DistributionSpec`, `operator`, `direction`,
      `contributingDeclarationIds`.
    - `SeedEffect` gains the fields `composeEffects` needs to fold a real
      declaration: extend it to carry the full ADR-154 `EffectDeclaration` shape
      the JSONB stores (`declarationId`, `direction`, `compositionOperator`,
      `confidence`, `horizon`, `declaredAt`, optional `decayFactor`/`retiredAt`),
      so the Prisma fixture writes a real `kernel.plan_node.effects` entry and the
      in-memory double stores the same.
    - Rewrite the cases:
      - **E1 (compose under `sum`):** ROOT/A/A1/B each declare a `point` effect
        for `FE_INDICATOR_A` with `compositionOperator:'sum'`; assert the result is
        a single `ComposedEffect` whose `magnitude` is
        `{ kind:'point', value: 1.1+1.2+1.3+0.9 }` (point+point+point+point under
        `sum` stays `point`), `operator:'sum'`,
        `contributingDeclarationIds` lists all four.
      - **E2 (subtree):** query at A → composed over A + A1 only (ROOT, B excluded).
      - **E2b (other tree excluded):** FE_SIBLING never contributes.
      - **E3 (sequential-with-decay ordering is consumed inside compose):** declare
        `sequential-with-decay` with `decayFactor` on each node + assert the
        composed mean equals `Σ αⁱ·meanᵢ` in **pre-order** — proving ordering is
        folded inside `composeEffects` and the per-node `ordinal` is gone from the
        surface.
      - **E4 (filter):** only the queried `indicatorId` composes.
      - **E5 (variance preserved):** a `normal`-effect group under `sum` →
        composed `{ kind:'normal', mean: Σmeanᵢ, sd: √Σsdᵢ² }` (the variance is
        carried, NOT dropped).
      - **E6/E7 (empty):** unknown root / no matching indicator → `[]`.
      - **E8 (tenant scope):** unchanged in intent (each tenant composes its own tree).
    - Update the `expectedMagnitude` oracle to a `expectedComposed(...)` helper that
      folds the seed effects with the same per-operator math (or, simpler, imports
      `composeEffects` from `@de-braighter/substrate-contracts/plan-tree` and asserts
      against it — the suite's oracle *is* the ratified algebra, which is the point).
    Run the in-memory spec
    (`in-memory-evidence-repository.find-effects-for-tree.contract.spec.ts`) →
    **fails** (port still returns the old scalar shape).
  - **Minimal impl (the atomic breaking change — port + 3 surfaces together).**
    1. `inference-catalog.port.ts`: change `findEffectsForTree`'s return type to
       `Promise<ComposedEffect[]>` (import
       `type { ComposedEffect } from '@de-braighter/substrate-contracts/plan-tree';`).
       Delete the runtime-internal `EffectDeclaration` interface **and its export**
       (it was never a ratified contract — ADR-224 Commitment 2.1). Update the
       method doc-comment to describe the read-time `composeEffects` derivation.
    2. `effect-subtree.ts`: add a new pure
       `export function deriveComposedEffectsForSubtree(rows, treeRoot, indicatorKey):
       Result<ComposedEffect[], CompositionError>` that walks the subtree in
       pre-order (reuse the existing parent/ordinal walk), collects the **full**
       `EffectDeclaration`s (not reduced) for `indicatorKey` in pre-order, and calls
       `composeEffects(declarations)`. Keep `deriveEffectsForSubtree`
       (old, scalar) deleted or marked deprecated and removed in this commit since
       no caller remains after step 4/5. `StoredEffect` widens to carry the full
       declaration JSONB (not just `indicatorId` + `magnitudePrior`).
    3. `in-memory-inference-catalog.ts` (`InMemoryEvidenceRepository`):
       `findEffectsForTree` now returns `ComposedEffect[]` via
       `deriveComposedEffectsForSubtree`. The legacy `registerEffects` keyed path
       (which stored already-reduced scalar declarations) is **removed**; migrate
       its callers (the fast-path counterfactual specs + the `InMemoryInferenceBackbone`
       double) to `registerTree` with full declarations. If `composeEffects` returns
       `err`, the double **throws** (the in-memory double is a test fixture, not a
       port boundary; a malformed seed is a test bug — the adapter-side error
       mapping is the Prisma/router concern, tested separately). Actually return the
       `err` upward only if the port signature is `Result`-typed; keep the port
       signature returning `Promise<ComposedEffect[]>` and let composition errors
       surface at the **adapter** read-site (step in Phase D), so here the double
       resolves the `ok` value or throws on `err` with a clear test-fixture message.
    4. `prisma-evidence-log.repository.ts`: `findEffectsForTree` maps rows →
       full `EffectDeclaration`s (extend `parseStoredEffects` to forward the whole
       validated JSONB declaration, not just `indicatorId`+`magnitudePrior`) and
       calls `deriveComposedEffectsForSubtree`; on `err`, **throw a typed internal
       error** that the router/adapter read-site converts to
       `effect-composition-failed` (Phase D wires the conversion). Returns
       `ComposedEffect[]` on `ok`.
    5. Update the three adapters' call-sites (`beta-binomial`, `normal-normal`,
       `weibull-aft`) so they compile against the new return type. In THIS commit,
       keep them behaviorally faithful by mapping each `ComposedEffect` back to the
       scalar the old math still expects via `composedEffectMoments(ce.magnitude).mean`
       (Beta: keep the old `magnitudePrior`-style multiplicative loop fed the mean;
       Normal: feed the mean as the additive shift; survival: feed the mean as the
       log-HR). This is a **mechanical compile-bridge** that preserves today's
       numbers exactly — the real per-cell closed forms land in Phase C/D. Add a
       `// ADR-224 BRIDGE` comment at each site marking it for replacement.
  - Run the full inference suite → **green** (numbers unchanged; only the shape
    moved). Commit:
    `feat(runtime)!: findEffectsForTree returns ComposedEffect[] (ADR-224 C2 — breaking port shape)`.
  - Note the `!` (breaking) in the commit subject; the runtime major bump lands in
    Phase E.

### Phase C — Per-cell closed-form math (each independently testable, no adapter wiring yet)

- [ ] **Task C1 — Normal-Normal convolution with σ_E² propagation (1b-i) — the `composeNormalPosterior` fix.**
  - **Test first.** Extend `libs/substrate-runtime/src/inference/math/normal-normal.spec.ts`
    with a new `describe('composeNormalPosterior — composed-effect variance propagation')`:
    1. **Backward-compat oracle (point effect = today's behavior, exact).** Prior
       `N(0,1²)`, obsSD 1, one obs `x=4`, a single composed effect
       `{ kind:'point', value: 1 }`. The shifted prior is `N(1, 1²)` (variance
       unchanged for a point). Closed form: precision `= 1/1 + 1/1 = 2`;
       mean `= (1/1 + 4/1)/2 = 2.5`; var `= 0.5`. Assert `toBeCloseTo(2.5,12)` +
       `toBeCloseTo(0.5,12)`. This is the **migration safety oracle**: a `point`
       effect reproduces the pre-ADR-224 mean-shift exactly.
    2. **Variance now propagates (the fix).** Same prior/obs, a `normal` composed
       effect `{ kind:'normal', mean: 1, sd: 1 }` (σ_E² = 1). Shifted prior is
       `N(0+1, 1+1) = N(1, 2)`. Closed form: precision `= 1/2 + 1/1 = 1.5`;
       mean `= (1/2 + 4/1)/1.5 = (0.5+4)/1.5 = 3`; var `= 1/1.5 = 0.666…`. Assert
       `toBeCloseTo(3,12)` + `toBeCloseTo(2/3,12)`. Contrast: under the OLD code the
       variance would be `1/2` (σ_E² dropped) — assert the NEW variance is strictly
       larger than that, proving propagation.
    3. **No effects → posterior equals prior** (unchanged existing case still passes).
    Run → **fails** (signature still takes the scalar `effects` + drops σ_E²).
  - **Minimal impl.** In `libs/substrate-runtime/src/inference/math/normal-normal.ts`,
    change `composeNormalPosterior` to accept
    `composedEffects: readonly { mean: number; variance: number }[]` (moments
    extracted by the caller via `composedEffectMoments`) instead of the scalar
    `effects`. Fold:
    ```typescript
    let shiftedMean = args.priorMean;
    let shiftedVar = args.priorSd * args.priorSd;
    for (const e of args.composedEffects) {
      shiftedMean += e.mean;
      shiftedVar += e.variance; // σ_E² propagation — THE FIX (1b-i)
    }
    const obsVariance = args.observationSd * args.observationSd;
    const n = args.observations.length;
    let sumX = 0; for (const o of args.observations) sumX += o.value;
    const priorPrecision = 1 / shiftedVar;
    const precision = priorPrecision + n / obsVariance;
    const mean = (shiftedMean * priorPrecision + sumX / obsVariance) / precision;
    const variance = 1 / precision;
    return { mean, variance, sd: Math.sqrt(variance) };
    ```
    Remove the `EffectDeclaration` import (now takes pre-extracted moments).
  - Run → **green**. Commit:
    `fix(inference): Normal-Normal closed form propagates composed-effect variance σ_E² (ADR-224 1b-i)`.

- [ ] **Task C2 — Beta-Binomial point-effect as a log-odds shift (1b-ii) — the OQ-1 behavior change.**
  - **Test first.** Extend `libs/substrate-runtime/src/inference/math/beta-binomial.spec.ts`
    with `describe('composeBetaPosterior — log-odds point-effect shift (ADR-224 1b-ii)')`:
    1. **Identity is now `0` (log-odds), not `1.0` (proportion).** Prior
       `Beta(2,2)` (p₀ = 0.5), a single `point` composed effect value `δ=0`. The
       log-odds shift is `logit(0.5)+0 = 0` → p' = 0.5 → α'=1, β'=1 over total
       weight 2... wait, total weight α₀+β₀=4 → α'=0.5·4=2, β'=2. Identity
       preserves the prior exactly: assert `{ alpha:2, beta:2 }` (`toBeCloseTo`).
    2. **A positive δ shifts toward success in log-odds.** Prior `Beta(1,1)`
       (p₀=0.5, total weight 2), `δ = ln(3)` (odds ×3). `logit(0.5)=0`;
       `logit(p') = ln(3)` → `p' = 3/(1+3) = 0.75`. α' = 0.75·2 = 1.5, β' = 0.5.
       Then accumulate observations `{numerator:8, denominator:10}` (8 succ, 2 fail):
       α_post = 1.5+8 = 9.5; β_post = 0.5+2 = 2.5. Assert `toBeCloseTo` both.
    3. **Stays in (0,1) for an extreme δ** (the property log-odds buys over
       proportion-multiplication): prior `Beta(1,1)`, `δ = 100` → p' ≈ 1 but
       strictly < 1; α'+β' = total weight exactly preserved (assert
       `α'+β' === α₀+β₀` within 1e-9). The old proportion-multiplicative form
       (`successProp × 100`) would leave (0,1) and clamp; the new form does not.
    4. **Golden-vector / backward-incompat note covered by a regression case:** an
       existing football catalog magnitude expressed in the OLD proportion scale,
       re-expressed in log-odds, yields the documented golden value (pin one
       concrete `(α₀,β₀,δ_logodds)` → `(α',β')` triple as the migration golden).
    Run → **fails** (current code does `successProp × magnitudePrior`).
  - **Minimal impl.** In `libs/substrate-runtime/src/inference/math/beta-binomial.ts`,
    replace the effect loop with the single log-odds shift over the **one** composed
    `point` value (`composeEffects` already folded the subtree into one composed
    prior, so there is no ordinal loop):
    ```typescript
    // composedPointEffect?: number  — the δ on the log-odds scale, or undefined for no effect
    if (args.composedPointEffect !== undefined) {
      const total = alpha + beta;
      const p0 = alpha / total;
      const logit0 = Math.log(p0 / (1 - p0));
      const pPrime = 1 / (1 + Math.exp(-(logit0 + args.composedPointEffect)));
      alpha = pPrime * total;        // total weight preserved
      beta = (1 - pPrime) * total;
    }
    ```
    Delete `InvalidMagnitudePriorError` and the proportion-multiplicative loop +
    `clamp01`'s use on the multiplicative product (keep `clamp01` only if still
    referenced for numeric safety on p'). The Beta closed form now consumes a
    single composed `point` δ, not a list of scalars; a `normal`/`beta`/`lognormal`
    composed prior is **not** handled here — that routing decision (closed-form vs
    `deferred`) lives in the adapter (Phase D).
  - Run → **green**. Commit:
    `feat(inference): Beta-Binomial point-effect is a log-odds shift (ADR-224 1b-ii, OQ-1)`.

- [ ] **Task C3 — `beta` composed prior → Beta-Binomial conjugate reshaping (1b-iv).**
  - **Test first.** Extend `beta-binomial.spec.ts`:
    a `beta` composed effect prior `Beta(α_E=4, β_E=2)` (arising via `max`/`replace`
    selecting a beta declaration) is used **as the conjugate prior directly**, then
    accumulates observations `{numerator:3, denominator:5}` (3 succ, 2 fail):
    α_post = 4+3 = 7; β_post = 2+2 = 4. Assert `toBeCloseTo`. Also assert it is
    **independent of the indicator's own `priorAlpha`/`priorBeta`** (the selected
    beta replaces them). Run → **fails** (no `composedBetaPrior` path).
  - **Minimal impl.** Add an optional
    `composedBetaPrior?: { alpha: number; beta: number }` arg; when present, it
    seeds `(alpha, beta)` directly (ignoring the indicator prior) before observation
    accumulation, and `composedPointEffect` is ignored (a beta composed prior and a
    point shift are mutually exclusive — `composeEffects` produces one or the other).
  - Run → **green**. Commit:
    `feat(inference): beta composed prior used as conjugate Beta prior directly (ADR-224 1b-iv)`.

- [ ] **Task C4 — Survival point-effect log-HR shift (1b-iii) — re-statement of ADR-223.**
  - **Test first.** Extend `libs/substrate-runtime/src/inference/math/weibull-aft.spec.ts`
    (or add a small pure helper spec): a single `point` composed effect value
    `δ = ln(0.5)` (protective, HR 0.5) → `appliedHazardRatio = exp(ln(0.5)) = 0.5`;
    no composed effect → HR 1.0. Assert exact. Then assert the protective HR **lifts**
    the survival curve (`S_adj(t) = S_base(t)^0.5 > S_base(t)` for `S∈(0,1)`).
    Run → **fails** (the adapter currently sums `effects.map(e => e.magnitudePrior)`
    over the old scalar shape).
  - **Minimal impl.** Add a pure helper
    `export function appliedHazardRatioFromComposedPoint(delta: number | undefined): number`
    in `weibull-aft.ts` (or inline in the adapter in Phase D) returning
    `delta === undefined ? 1 : Math.exp(delta)`. This is the principled re-statement
    of ADR-223's `exp(Σ log-HR)` in the Commitment-1 frame: one composed `point` δ
    read as a log-HR.
  - Run → **green**. Commit:
    `feat(inference): survival point-effect is a log-HR shift over the composed effect (ADR-224 1b-iii)`.

### Phase D — Adapter wiring: closed-form cells + the typed deferred envelope

- [ ] **Task D1 — Normal-Normal adapter: consume `ComposedEffect`, propagate variance, defer non-`point`/`normal`.**
  - **Test first.** Extend
    `libs/substrate-runtime/src/inference/adapters/normal-normal-fast-path.adapter.spec.ts`:
    1. **point composed effect → today's posterior exactly** (the backward-compat
       oracle at the adapter level — seed a `point` declaration, assert the
       `PosteriorSummary.mean`/`sd` match the pre-ADR-224 golden).
    2. **normal composed effect → wider posterior** (variance propagates;
       `sd` strictly larger than the point case for the same mean).
    3. **deferred guard:** seed a declaration whose composed prior is `lognormal`
       (via a `replace` of a lognormal declaration) on a `normal` indicator →
       `posterior()` returns `err` with `kind:'effect-not-conjugable'`,
       `composedPriorKind:'lognormal'`, `conjugateFamily:'normal'`,
       `deferTrigger:'numerical-quadrature-engine'`, a non-empty `deferredAdrPointer`.
    4. **composition-error mapping:** seed two declarations for the same indicator
       with **disagreeing** operators → `composeEffects` errors → `posterior()`
       returns `err` `kind:'effect-composition-failed'` carrying the
       `operator-disagreement` `CompositionError`.
    Run → **fails**.
  - **Minimal impl.** In `normal-normal-fast-path.adapter.ts`, replace the
    `// ADR-224 BRIDGE` site: the evidence read now yields `ComposedEffect[]` (≤1 per
    indicator). For the single composed effect (if any):
    - On `ComposedEffect.magnitude.kind === 'point' | 'normal'`: extract
      `{ mean, variance }` via `composedEffectMoments` and pass as
      `composedEffects: [{ mean, variance }]` to the fixed `composeNormalPosterior`.
    - On `'beta' | 'lognormal'`: return `err({ kind:'effect-not-conjugable', … })`
      (`deferTrigger:'numerical-quadrature-engine'`,
      `deferredAdrPointer:'adr/adr-224-…#OQ-3'`).
    - Wrap the evidence read so a `composeEffects` failure surfaced by the adapter's
      read-site (Phase B left the Prisma adapter throwing a typed internal on
      compose `err`; the in-memory double throws too) is caught and mapped to
      `err({ kind:'effect-composition-failed', indicatorKey, compositionError })`.
      Concretely: change the evidence port read-site so `findEffectsForTree` returns
      `Result<ComposedEffect[], CompositionError>` **at the adapter boundary** — OR
      keep the port returning `ComposedEffect[]` and have the adapter call a thin
      `safeFindEffects(...)` wrapper that catches the typed compose error. Choose the
      wrapper (keeps the port total + no throw across the port boundary). (Flagged:
      Planning assumption §3 — the ADR says compose errors "map to a typed variant"
      but does not pin whether the port return type becomes `Result`; the wrapper
      keeps the port shape simple and the mapping at the consuming adapter.)
  - Run → **green**. Commit:
    `feat(runtime): Normal-Normal adapter consumes ComposedEffect + defers non-conjugate cells (ADR-224 D)`.

- [ ] **Task D2 — Beta-Binomial adapter: log-odds point shift, beta-prior reshaping, defer `normal`/`lognormal`.**
  - **Test first.** Extend `beta-binomial-fast-path.adapter.spec.ts`:
    1. **point composed effect → log-odds posterior** (assert the 1b-ii golden at
       the adapter level; the OBSERVABLE numeric change from the old
       proportion-multiplicative path — gated behind OQ-1 sign-off, recorded here
       as the new golden vector).
    2. **beta composed prior (via `replace`) → conjugate reshaping** (1b-iv golden).
    3. **deferred guard:** a `normal` composed effect on a beta indicator →
       `err` `kind:'effect-not-conjugable'`, `composedPriorKind:'normal'`,
       `conjugateFamily:'beta'`, `deferTrigger:'numerical-quadrature-engine'`.
    4. **composition-error mapping** (as D1, `effect-composition-failed`).
    5. **counterfactual still correct:** baseline vs cf subtree differ only in
       declarations → two distinct posteriors over the composed program; assert the
       paired handles share one manifest (ADR-165 inv 5) and differ in `mean`.
    Run → **fails**.
  - **Minimal impl.** Replace the `// ADR-224 BRIDGE` site in
    `beta-binomial-fast-path.adapter.ts`: dispatch on the single composed effect's
    `magnitude.kind` — `point` → `composedPointEffect: value`; `beta` →
    `composedBetaPrior: { alpha, beta }`; `normal`/`lognormal` →
    `err({ kind:'effect-not-conjugable', … })`. Remove the
    `InvalidMagnitudePriorError` try/catch (the multiplicative validation is gone).
    Add the same `safeFindEffects` compose-error mapping as D1. Apply to **both**
    `posterior()` and `counterfactual()`.
  - Run → **green**. Commit:
    `feat(runtime): Beta-Binomial adapter — log-odds point shift + beta-prior reshape + deferred cells (ADR-224 D)`.

- [ ] **Task D3 — Weibull-AFT adapter: composed point log-HR, defer random effects.**
  - **Test first.** Extend `weibull-aft.adapter.spec.ts`:
    1. **point composed effect → log-HR** (assert `appliedHazardRatio` and the lifted
       survival curve for a protective δ; no-effect → HR 1.0 — the 1b-iii golden).
    2. **deferred guard:** a `normal`/`lognormal` composed effect on the survival
       indicator → `err` `kind:'effect-not-conjugable'`,
       `conjugateFamily` = the survival `familyRef`,
       `deferTrigger:'numpyro-sidecar-binding'` (random log-HR is not closed-form
       AFT). `lognormal` stays deferred per OQ-4.
    3. **composition-error mapping** (`effect-composition-failed`).
    Run → **fails**.
  - **Minimal impl.** Replace the `// ADR-224 BRIDGE` reduce-over-scalars in
    `weibull-aft.adapter.ts`: read the single composed effect; on `point` →
    `appliedHazardRatio = exp(δ)`; no composed effect → HR 1.0; on
    `normal`/`lognormal` → `err({ kind:'effect-not-conjugable', … })`. Add the same
    `safeFindEffects` mapping.
  - Run → **green**. Commit:
    `feat(runtime): Weibull-AFT adapter folds composed point log-HR + defers random effects (ADR-224 D)`.

- [ ] **Task D4 — Exhaustive `deferred`-cell proof: an unlisted cell returns the typed envelope, never a number.**
  - **Test first.** New spec
    `libs/substrate-runtime/src/inference/adapters/composed-effect-tractability.matrix.spec.ts`.
    Table-drive every `(composedPriorKind ∈ {point,normal,beta,lognormal}) ×
    (likelihood ∈ {normal,beta,survival})` cell. For each cell, seed an indicator +
    a declaration producing that composed-prior kind, run `posterior()` through the
    router, and assert:
    - **closed-form cells** (the ✓ matrix entries) → `ok` with a finite numeric
      summary.
    - **every other cell** → `err` with `kind:'effect-not-conjugable'` and the
      correct `composedPriorKind`/`conjugateFamily`/`deferTrigger`. Crucially assert
      the result is `ok === false` (no approximated number escapes a deferred cell).
    - `n/a` cells (a `beta` effect on a `normal` indicator) → `validation-failed`
      (modeling error) — assert it is NOT silently composed.
    Run → **fails** for any cell whose adapter still falls through to a number.
  - **Minimal impl.** Only fixes/additions surfaced by the table (most cells already
    handled by D1–D3); this task's value is the exhaustive proof, not new code. If a
    cell leaks a number, add the missing `effect-not-conjugable` branch.
  - Run → **green**. Commit:
    `test(runtime): exhaustive tractability-matrix proof — deferred cells return the typed envelope (ADR-224 C4)`.

### Phase E — Reproducibility, runtime version bump, and the DB end-to-end proof

- [ ] **Task E1 — Determinism: same composed input → bit-identical posterior; no Date.now/random in the path.**
  - **Test first.** New spec
    `libs/substrate-runtime/src/inference/composed-effect-determinism.spec.ts`:
    1. Run `posterior()` twice with the **same** `(tenantPackId, treeRoot, subject,
       indicatorKey, asOf)` + the same seeded declarations, with a **fixed
       `opts.requestId`** so the manifest is stable. Assert the two
       `PosteriorSummary.parameterValues` + `mean`/`sd` are **bit-identical**
       (`===`, not `toBeCloseTo`) and the two `manifest.inputHash` +
       `manifest.observationsHash` match. Cover Normal, Beta, and survival.
    2. **No non-determinism in the fold.** A static-source assertion: a test that
       reads the source of `effect-subtree.ts`, `normal-normal.ts`,
       `beta-binomial.ts`, `weibull-aft.ts` (the math + derivation modules — NOT the
       adapters, which legitimately use `randomUUID` for fallback requestIds +
       `new Date()` for manifest timestamps) and asserts they contain no
       `Date.now`, no `Math.random`, no `randomUUID`. (Mirrors the spirit of the
       existing reproducibility guards; keep the file list narrow to the pure fold
       path so it doesn't false-positive on the adapter manifest plumbing.)
    Run → **fails** if any non-determinism leaks into the fold.
  - **Minimal impl.** None expected (the fold is already pure); if the static guard
    trips, move the offending call out of the pure module into the adapter.
  - Run → **green**. Commit:
    `test(runtime): composed-effect fold is deterministic + sampler-free (ADR-224 C5)`.

- [ ] **Task E2 — Runtime CHANGELOG + MAJOR version bump + migration note.**
  - No test. Edit `libs/substrate-runtime/package.json` `version` → `2.0.0`.
  - In `libs/substrate-runtime/CHANGELOG.md`, add a `## [2.0.0]` heading with:
    - **BREAKING:** `EvidenceRepository.findEffectsForTree` returns
      `ComposedEffect[]` (was the runtime-internal scalar `EffectDeclaration[]`);
      the runtime-internal `EffectDeclaration` type + its export are removed. Both
      adapters + the in-memory double migrate in lockstep (ADR-110 inv 4). Pack apps
      binding `EVIDENCE_REPOSITORY` re-publish against runtime 2.0.0.
    - **Migration note (Beta magnitudes re-expressed; point effects unchanged):**
      `point` effects reproduce the pre-2.0 posterior exactly (mean-preserving,
      σ_E²=0). `normal` effects now propagate σ_E² into the prior (wider, correct
      posterior). **The one observable numeric change** is Beta-Binomial:
      point-effect magnitudes move from proportion-multiplicative
      (`successProp × m`, identity `1.0`) to a **log-odds additive** shift
      (`logit(p₀)+δ`, identity `0`) — **every seeded `beta`-indicator
      `magnitudePrior` must be re-expressed** from proportion to log-odds (state the
      conversion: a multiplicative factor `m` on the proportion has no exact
      log-odds equivalent independent of `p₀`; re-author each magnitude as the
      intended `δ = logit(p_target) − logit(p₀)`). Pin the golden-vector change here.
    - New typed `deferred` surface: non-conjugate cells return
      `effect-not-conjugable`; read-time compose failures return
      `effect-composition-failed` (both via contracts 1.3.0).
  - Commit: `chore(runtime): bump to 2.0.0 — ADR-224 ComposedEffect port (BREAKING) + Beta log-odds migration note`.

- [ ] **Task E3 — DB-integration proof of the composed-effect path end-to-end (gated like the run-manifest spec, now in the default gate per #152).**
  - **Test first.** New spec
    `libs/substrate-runtime/src/inference/inference-backbone-router.composed-effect.integration.spec.ts`,
    modelled on `inference-backbone-router.posterior-event-log.integration.spec.ts`:
    - `describe.skipIf(!process.env['SUBSTRATE_DATABASE_URL'])` for the positive
      path; the cross-tenant case gated additionally on
      `SUBSTRATE_APP_DATABASE_URL` (`app` non-superuser role).
    - Seed real `kernel.plan_node` rows whose JSONB `effects` carry full ADR-154
      `EffectDeclaration`s under `compositionOperator:'sum'` for a Beta indicator
      (`pass_completion`) + real `kernel.event_log` observation rows, under one
      `tenant_pack_id`. Drive `router.posterior(input)` over the production
      `PrismaEvidenceLogRepository` (GUC-scoped via `input.tenantPackId`).
    - Assert the posterior reflects the **composed** (log-odds) effect — compare to
      the analytical oracle computed by reading the same declarations through
      `composeEffects` + `composeBetaPosterior` in-test (proving the Prisma
      `findEffectsForTree` read-time composition matches the in-memory algebra
      byte-for-byte).
    - Assert a `normal`-effect declaration on the Beta indicator yields
      `effect-not-conjugable` end-to-end through the real DB tier.
    - Assert tenant isolation: a declaration seeded under tenant B never composes
      into tenant A's posterior (RLS via `GucPrismaRunner`).
  - **Minimal impl.** None beyond fixtures expected (the production path is wired in
    Phase B/D); fix any seam the live read exposes.
  - Run via `npm run test:db` (or the targeted vitest command in the spec header) →
    **green** against the substrate-postgres dev container. Commit:
    `test(runtime): DB-integration proof of the composed-effect path end-to-end under RLS (ADR-224)`.

- [ ] **Task E4 — Composition-root + barrel sanity sweep (keep the gate green).**
  - **Test first.** Run the existing `composition-root/substrate.module.spec.ts` +
    the full `nx run-many -t build lint test --parallel=1`. Confirm the
    `EVIDENCE_REPOSITORY` binding (constructed singleton over `GucPrismaRunner`) +
    every barrel re-export (`inference/index.ts` no longer exports the removed
    runtime `EffectDeclaration`) compile.
  - **Minimal impl.** Fix any dangling export of the removed runtime
    `EffectDeclaration` type in `libs/substrate-runtime/src/inference/index.ts` and
    any consumer import (verify with a repo-wide grep for the removed symbol). No
    `new PrismaClient()` introduced anywhere (audit invariant). No NestJS import
    leaked into `substrate-contracts`. Every relative ESM import carries `.js`.
  - Run → **green** (full default gate `ci:local`; DB tier `ci:local:db` from E3).
    Commit: `chore(runtime): barrel + composition-root sweep for the ComposedEffect port (ADR-224)`.

---

## Cross-cutting invariants every task must honor

- **No throws across the port boundary.** Adapters catch the typed `CompositionError`
  from the read-time `composeEffects` and return `effect-composition-failed`; a
  non-conjugate cell returns `effect-not-conjugable`. The contracts package stays
  **NestJS-free** (the two new envelope variants are plain TypeScript unions). No
  `new PrismaClient()` — `ScopedPrismaService`/`GucPrismaRunner` only. Every relative
  ESM import carries an explicit `.js` extension.
- **Store generators, derive graphs.** No composed parent effect is persisted; the
  composition is derived at read-time. `kernel.plan_node.effects` (ADR-200) +
  `EffectDeclarationAdded.v1` / `EffectDeclarationRetired.v1` are unchanged — the
  divergence was purely on the read/consume side. `catalogVersionHash` is unchanged.
- **Repo green at every commit.** Phase A is additive (contracts compile + publish-safe
  at 1.3.0). Phase B's breaking port shape lands as ONE atomic commit (port + both
  adapters + in-memory double + call-sites) using the mechanical
  `composedEffectMoments(...).mean` bridge so numbers don't move until Phase C/D
  replace each bridge. The runtime stays at 1.2.0 through Phase B–D and bumps to
  2.0.0 only at E2, after every adapter consumes `ComposedEffect`.

## Planning assumptions (flag for orchestrator verification against ADR-224)

1. **Two error variants, not one.** ADR-224 Commitment 4's code block names the
   deferred-cell variant **`effect-not-conjugable`**, while OQ-2 + the
   Negative/Watch-items prose name **`effect-composition-failed`** for surfacing a
   `composeEffects` `CompositionError` at inference time. These are **distinct
   concerns** (an intractable matrix cell vs. a read-time composition failure). The
   brief (OQ-2 RESOLVED) asks specifically for `effect-composition-failed`; the
   matrix (Commitment 4) needs `effect-not-conjugable`. This plan adds **both**.
   The brief's task-1 wording ("add `effect-composition-failed`") is satisfied; the
   matrix's deferred-cell envelope is also satisfied. **Verify** the orchestrator
   wants both variants (the most faithful reading of the ADR) rather than collapsing
   them — if a single variant is desired, fold the deferred-cell case into
   `effect-composition-failed` with an added `composedPriorKind` discriminant.
2. **Circular-import avoidance in `error-envelope.ts`.** Importing
   `ConjugateHint`/`InferenceFamilyRef` from `inference/inference-types.ts` back into
   `primitives/error-envelope.ts` re-creates the cycle that file's header
   deliberately avoids (inference-types → error-envelope today). The plan falls back
   to a locally-inlined string-literal type for `conjugateFamily` if `tsc`/the
   bundler trips. **Verify** the ADR's envelope field `conjugateFamily:
   ConjugateHint | InferenceFamilyRef` is acceptable as a structurally-equivalent
   local type rather than the imported branded one.
3. **Where compose errors surface (port return type).** ADR-224 says read-time
   compose failures "map to a typed variant on the `InferenceError` envelope" but
   does not pin whether `findEffectsForTree`'s return becomes `Result<ComposedEffect[],
   CompositionError>` or stays `Promise<ComposedEffect[]>` with the error caught at
   the adapter via a thin wrapper. The plan keeps the port return as
   `Promise<ComposedEffect[]>` and catches the typed compose error at the consuming
   adapter (`safeFindEffects`), preserving a total, no-throw port. **Verify** this
   matches the intended seam (vs. widening the port itself to `Result`).
4. **OQ-1 sign-off is a gate, not a default.** The Beta log-odds switch (Task C2/D2)
   is the one OQ-1-flagged observable behavior change. The brief states OQ-1 RESOLVED
   (log-odds chosen) + asks to plan the proportion→log-odds catalog migration; this
   plan bakes that in (Task E2 migration note). **Verify** the founder sign-off
   referenced in ADR-224 OQ-1 is recorded before Task C2 executes — the golden
   vectors shift once at the runtime major.
5. **`n/a` cells.** A `beta`-effect declaration on a `normal` indicator is a modeling
   error (ADR-224 marks the cell `n/a`). The plan routes it to `validation-failed`
   (Task D4), not `effect-not-conjugable`. **Verify** the ADR intends `n/a` ≠ a
   deferral (it is documented as "not a gap", i.e. an input error, which
   `validation-failed` models).

---

Prerequisite: ADR-224 PR #296 must be merged (accepted-status gate) before executing.
