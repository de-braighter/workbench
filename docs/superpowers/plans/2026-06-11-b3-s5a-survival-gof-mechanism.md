# B3-S5a — Survival goodness-of-fit mechanism Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a production goodness-of-fit signal to the survival family — every parametric `SurvivalSummary` self-reports `fitDivergence` (KS-style parametric-vs-KM sup distance) + a `fitMisfitFlag` — and land the deferred survival `counterfactual()` + survival dispatch in `InMemoryInferenceBackbone`.

**Architecture:** A pure `math/survival-gof.ts` helper (sup divergence + sample-size-aware KS threshold) is consumed by the parametric adapters (Weibull, log-logistic) to populate two new additive `SurvivalSummary` fields; the KM adapter reports `0/false` (it IS the model-free reference). Survival `counterfactual()` returns baseline-vs-HR-adjusted handles sharing one `RunManifest`. The test double gains `familyRef`→adapter dispatch.

**Tech Stack:** TypeScript (ESM, explicit `.js` imports), vitest, NestJS-free pure math + adapters, `@de-braighter/substrate-{contracts,runtime}` (staged 2.0.0, unpublished).

**Repo:** `layers/substrate`. **Branch:** cut `feat/b3-s5a-survival-gof` off fresh `origin/main` (substrate is at staged 2.0.0; do NOT bump versions — package.json already says 2.0.0). **Gate:** `npm run ci:local` (DB-free) for every task; `npm run ci:local:db` only where a task is DB-gated (none in S5a). **No publish** in this slice.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `libs/substrate-runtime/src/inference/math/survival-gof.ts` (create) | Pure `kmSupDivergence` + `ksThreshold` | 1 |
| `libs/substrate-runtime/src/inference/math/survival-gof.spec.ts` (create) | Oracle tests for the helper | 1 |
| `libs/substrate-contracts/src/inference/inference-types.ts` (modify ~104-116) | `SurvivalSummary` += `fitDivergence`/`fitMisfitFlag` | 2 |
| `libs/substrate-contracts/src/inference/inference-zod.ts` (modify ~73-82) | `SurvivalSummarySchema` += the two fields | 2 |
| `libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.ts` (modify) | Compute + populate GoF in `buildSurvivalSummary` | 3 |
| `libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.ts` (modify) | Mirror Task 3 (log-logistic baseline `S(t)`) | 4 |
| `libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.ts` (modify) | `fitDivergence:0, fitMisfitFlag:false` (reference) | 5 |
| `…/adapters/{weibull-aft,loglogistic-aft,kaplan-meier}.adapter.ts` + the router + `SurvivalPosteriorAdapter` iface | Implement survival `counterfactual()` | 6 |
| `libs/substrate-runtime/src/inference/testing/in-memory-inference-backbone.ts` (modify) | `familyRef`→survival dispatch (posterior/sample/counterfactual) | 7 |

---

## Task 1: Pure GoF math — `survival-gof.ts`

**Files:**
- Create: `libs/substrate-runtime/src/inference/math/survival-gof.ts`
- Test: `libs/substrate-runtime/src/inference/math/survival-gof.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { kmSupDivergence, ksThreshold } from './survival-gof.js';
import { kaplanMeier } from './kaplan-meier.js';
import { weibullSurvival } from './weibull-aft.js';
import type { SurvivalObservation } from '@de-braighter/substrate-contracts/inference';

const obs = (durationT: number, eventObserved: boolean): SurvivalObservation => ({
  durationT, eventObserved, recordedAtIso: '2026-01-01T00:00:00Z',
});

describe('kmSupDivergence', () => {
  it('is ~0 when the parametric curve passes through the KM steps', () => {
    // A 4-event cohort; compare KM against a step-faithful parametric proxy =
    // the KM curve itself → divergence is exactly 0 (curve == reference).
    const cohort = [obs(1, true), obs(2, true), obs(3, true), obs(4, true)];
    const km = kaplanMeier(cohort);
    expect(kmSupDivergence((t) => km.survivalAt(t), km)).toBe(0);
  });

  it('equals the largest pre- or post-step vertical gap (hand oracle)', () => {
    // KM of [1,2] both events, n=2: step at t=1 → S=0.5, at t=2 → S=0.
    // Constant parametric S(t)=0.8: gaps at t=1 are |0.8-1|=0.2 (pre) and
    // |0.8-0.5|=0.3 (post); at t=2 |0.8-0.5|=0.3 (pre) and |0.8-0|=0.8 (post).
    // sup = 0.8.
    const km = kaplanMeier([obs(1, true), obs(2, true)]);
    expect(kmSupDivergence(() => 0.8, km)).toBeCloseTo(0.8, 12);
  });

  it('flags a misspecified shape: a Weibull(λ=10,k=3) curve vs a KM from exponential-like data diverges materially', () => {
    // KM from a near-exponential cohort (many early events) vs a steep Weibull → large sup.
    const cohort = Array.from({ length: 50 }, (_v, i) => obs(0.1 * (i + 1), true));
    const km = kaplanMeier(cohort);
    const d = kmSupDivergence((t) => weibullSurvival(t, 10, 3), km);
    expect(d).toBeGreaterThan(0.5);
  });
});

describe('ksThreshold', () => {
  it('is the KS alpha=0.05 critical value 1.36/sqrt(nEvents)', () => {
    expect(ksThreshold(100)).toBeCloseTo(0.136, 12);
    expect(ksThreshold(1)).toBeCloseTo(1.36, 12);
  });
  it('returns +Infinity for nEvents<=0 (never flag without events)', () => {
    expect(ksThreshold(0)).toBe(Infinity);
    expect(ksThreshold(-3)).toBe(Infinity);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd libs/substrate-runtime && npx vitest run src/inference/math/survival-gof.spec.ts`
Expected: FAIL — `Cannot find module './survival-gof.js'`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Survival goodness-of-fit primitives (B3-S5). Pure, deterministic, no DI —
 * reused by the parametric adapters (per-fit production signal) and the §11
 * validation gate suite (two-arm PH residual). NOT a catalog parameter: the
 * divergence is derived at read-time from the fitted curve + the cohort KM, so
 * it has no `distributionCatalogVersionHash` impact (ADR-223 decomposition #3).
 */
import type { KmCurve } from './kaplan-meier.js';

/**
 * The Kolmogorov-Smirnov-style supremum distance between a (smooth) parametric
 * survival function and an empirical KM step curve, evaluated at the KM event
 * times against BOTH the pre-drop and post-drop step levels (the sup of a smooth
 * curve vs a right-continuous step function is attained there). Range [0,1];
 * order-independent (steps are pre-sorted ascending). S=1 before the first event.
 */
export function kmSupDivergence(
  parametricSurvival: (t: number) => number,
  km: KmCurve,
): number {
  let sup = 0;
  let prevKm = 1; // S = 1 before the first event
  for (const step of km.steps) {
    const p = parametricSurvival(step.t);
    sup = Math.max(sup, Math.abs(p - prevKm), Math.abs(p - step.survival));
    prevKm = step.survival;
  }
  return sup;
}

/**
 * The sample-size-aware misfit threshold: the KS alpha=0.05 critical value
 * `1.36 / sqrt(nEvents)`. nEvents <= 0 ⇒ +Infinity (no events ⇒ never flag; the
 * adapters already return `cohort-too-small` for the no-event case, so a finite
 * fit always has nEvents >= 1 here). The threshold is applied at flag time, not
 * stored — `fitDivergence` (finite, [0,1]) is what lands on the summary.
 */
export function ksThreshold(nEvents: number): number {
  if (nEvents <= 0) return Infinity;
  return 1.36 / Math.sqrt(nEvents);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd libs/substrate-runtime && npx vitest run src/inference/math/survival-gof.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src/inference/math/survival-gof.ts libs/substrate-runtime/src/inference/math/survival-gof.spec.ts
git commit -m "feat(substrate): B3-S5a — pure survival goodness-of-fit math (KS sup divergence + threshold)"
```

---

## Task 2: Contracts widen — `SurvivalSummary` GoF fields

**Files:**
- Modify: `libs/substrate-contracts/src/inference/inference-types.ts` (the `SurvivalSummary` interface, ~104-116)
- Modify: `libs/substrate-contracts/src/inference/inference-zod.ts` (`SurvivalSummarySchema`, ~73-82)
- Test: `libs/substrate-contracts/src/inference/survival-contracts.spec.ts` (existing — add cases)

- [ ] **Step 1: Write the failing test** (append to `survival-contracts.spec.ts`)

```ts
import { SurvivalSummarySchema } from './inference-zod.js';

describe('SurvivalSummary GoF fields (B3-S5a)', () => {
  const base = {
    kind: 'survival' as const,
    familyRef: 'survival.weibull-aft@1',
    parameterValues: { scale: 10, shape: 1.5 },
    survivalAtHorizons: [{ t: 8, s: 0.5 }],
    medianSurvival: 8,
    quantiles: [{ p: 0.5, t: 8 }],
    hazardAtHorizon: { t: 8, h: 0.2 },
    appliedHazardRatio: 1,
  };
  it('accepts a summary carrying fitDivergence + fitMisfitFlag', () => {
    const r = SurvivalSummarySchema.safeParse({ ...base, fitDivergence: 0.07, fitMisfitFlag: false });
    expect(r.success).toBe(true);
  });
  it('rejects a summary missing the GoF fields', () => {
    const r = SurvivalSummarySchema.safeParse(base);
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd libs/substrate-contracts && npx vitest run src/inference/survival-contracts.spec.ts`
Expected: FAIL — the first case fails (schema strips unknown keys but the assertion that the *required* fields exist fails) / the second passes accidentally. Confirm RED on the "accepts" → after impl it must require them.

- [ ] **Step 3: Implement — interface (`inference-types.ts`)**

Add to the `SurvivalSummary` interface after `appliedHazardRatio`:

```ts
  readonly appliedHazardRatio: number; // exp(Σ log-HR); 1.0 = baseline
  /**
   * B3-S5a goodness-of-fit (production self-report). The KS-style supremum
   * distance between the fitted BASELINE parametric S(t) and the cohort's own
   * empirical KM (pre-HR). 0 for the Kaplan-Meier adapter (it IS the model-free
   * reference). Range [0,1].
   */
  readonly fitDivergence: number;
  /**
   * `fitDivergence > 1.36/sqrt(nEvents)` (KS alpha=0.05). Flags parametric
   * MISFIT — PH violation is the headline trigger, NOT the only one. Always
   * false for the Kaplan-Meier reference.
   */
  readonly fitMisfitFlag: boolean;
```

- [ ] **Step 4: Implement — Zod (`inference-zod.ts`)**

Add to `SurvivalSummarySchema` (`z.object({...})`) after `appliedHazardRatio: z.number(),`:

```ts
  appliedHazardRatio: z.number(),
  fitDivergence: z.number(),
  fitMisfitFlag: z.boolean(),
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd libs/substrate-contracts && npx vitest run src/inference/survival-contracts.spec.ts`
Expected: PASS. Then `npm run ci:local` at the contracts package root to confirm the widen compiles across consumers (TS exhaustive-switch sites still compile — additive).

- [ ] **Step 6: Commit**

```bash
git add libs/substrate-contracts/src/inference/inference-types.ts libs/substrate-contracts/src/inference/inference-zod.ts libs/substrate-contracts/src/inference/survival-contracts.spec.ts
git commit -m "feat(substrate-contracts): B3-S5a — SurvivalSummary fitDivergence + fitMisfitFlag (rides 2.0.0)"
```

> **NOTE for Task 3+:** Adding the fields makes EVERY `SurvivalSummary` constructor a compile error until it supplies them. Tasks 3-5 fix the three adapters; run the runtime build only after Task 5.

---

## Task 3: Weibull adapter — compute + populate the GoF

**Files:**
- Modify: `libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.ts`
- Test: `libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.spec.ts` (existing — add a describe block)

- [ ] **Step 1: Write the failing test**

```ts
// Drive posterior() with a well-specified Weibull cohort → low divergence, flag false.
// Then a misspecified cohort (events crammed early, a bathtub-ish shape Weibull can't
// match) → high divergence, flag true. Use the existing spec's harness for building a
// survival indicator + InMemory evidence; assert on (handle.summary as SurvivalSummary).
it('reports low fitDivergence + fitMisfitFlag=false for a well-specified Weibull cohort', async () => {
  // ...register survival indicator (familyRef survival.weibull-aft@1), seed a
  // Weibull(10,1.5) inverse-CDF grid cohort, run posterior...
  const s = handle.summary as SurvivalSummary;
  expect(s.fitDivergence).toBeLessThan(0.136); // ~ ksThreshold for a ~100-event cohort
  expect(s.fitMisfitFlag).toBe(false);
});

it('reports high fitDivergence + fitMisfitFlag=true for a misspecified cohort', async () => {
  // Seed a cohort whose hazard shape Weibull cannot match (e.g. two well-separated
  // event clusters → a crossing/bathtub empirical curve).
  const s = handle.summary as SurvivalSummary;
  expect(s.fitMisfitFlag).toBe(true);
  expect(s.fitDivergence).toBeGreaterThan(ksThreshold(s /* nEvents from cohort */));
});
```

(The executing engineer fills the harness from the existing `weibull-aft.adapter.spec.ts` setup — same indicator registration + `InMemoryEvidenceRepository.registerSurvivalObservations`. Pin cohorts with fixed quantile grids, no RNG, per the S1 convention.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd libs/substrate-runtime && npx vitest run src/inference/adapters/weibull-aft.adapter.spec.ts`
Expected: FAIL — `fitDivergence`/`fitMisfitFlag` undefined on the summary (and TS error: the field is required).

- [ ] **Step 3: Implement**

In `weibull-aft.adapter.ts`:

1. Add imports:
```ts
import { kaplanMeier } from '../math/kaplan-meier.js';
import { kmSupDivergence, ksThreshold } from '../math/survival-gof.js';
```
2. In `posterior()`, after `const fit = fitWeibullAft(observations);` and the converged guard, compute the GoF against the BASELINE curve (pre-HR) and the cohort's own KM:
```ts
const km = kaplanMeier(observations);
const nEvents = observations.filter((o) => o.eventObserved).length;
const fitDivergence = kmSupDivergence(
  (t) => weibullSurvival(t, fit.scale, fit.shape),
  km,
);
const fitMisfitFlag = fitDivergence > ksThreshold(nEvents);
```
3. Pass them into `buildSurvivalSummary`:
```ts
const summary = buildSurvivalSummary({ familyRef, fit, appliedHazardRatio, fitDivergence, fitMisfitFlag });
```
4. Widen `buildSurvivalSummary`'s args + returned object:
```ts
function buildSurvivalSummary(args: {
  familyRef: InferenceFamilyRef; fit: WeibullFit; appliedHazardRatio: number;
  fitDivergence: number; fitMisfitFlag: boolean;
}): SurvivalSummary {
  // ...unchanged body...
  return {
    kind: 'survival', familyRef, parameterValues: { scale, shape },
    survivalAtHorizons, medianSurvival, quantiles, hazardAtHorizon,
    appliedHazardRatio: hr,
    fitDivergence: args.fitDivergence,
    fitMisfitFlag: args.fitMisfitFlag,
  };
}
```

> **Precision (load-bearing):** the divergence uses `weibullSurvival(t, fit.scale, fit.shape)` — the **baseline** MLE curve over the cohort that produced it — NOT the HR-adjusted `survivalAtHorizons`. Comparing the HR-shifted curve to the baseline KM would be a category error.

- [ ] **Step 4: Run to verify it passes**

Run: `cd libs/substrate-runtime && npx vitest run src/inference/adapters/weibull-aft.adapter.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.ts libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.spec.ts
git commit -m "feat(substrate): B3-S5a — Weibull adapter self-reports fitDivergence/fitMisfitFlag"
```

---

## Task 4: log-logistic adapter — mirror Task 3

**Files:**
- Modify: `libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.ts`
- Test: `libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.spec.ts`

- [ ] **Step 1: Write the failing test** — mirror Task 3's two cases against the log-logistic adapter (well-specified log-logistic cohort → low/clean; misspecified → high/flag). Read the existing spec for the harness.
- [ ] **Step 2: Run → FAIL** (`npx vitest run …loglogistic-aft.adapter.spec.ts`).
- [ ] **Step 3: Implement** — identical shape to Task 3, but the parametric baseline survival is the log-logistic `S(t)` (read the module — it exports a `loglogisticSurvival`-equivalent the adapter already uses for `survivalAtHorizons`; reuse the SAME baseline function with the fitted params, pre-HR). Add the `kaplanMeier`/`kmSupDivergence`/`ksThreshold` imports + the same 4-line compute block + widen its `buildSurvivalSummary`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(substrate): B3-S5a — log-logistic adapter self-reports goodness-of-fit`.

---

## Task 5: KM adapter — the reference reports 0 / false

**Files:**
- Modify: `libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.ts` (`buildKmSurvivalSummary`)
- Test: `libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('the KM reference always reports fitDivergence:0 + fitMisfitFlag:false (it cannot misfit itself)', async () => {
  // even on the misspecified cohort that makes Weibull flag, KM stays clean
  const s = handle.summary as SurvivalSummary;
  expect(s.fitDivergence).toBe(0);
  expect(s.fitMisfitFlag).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — in `buildKmSurvivalSummary`'s returned object, add:
```ts
    appliedHazardRatio: hr,
    fitDivergence: 0,
    fitMisfitFlag: false,
```
(No helper call — KM is the model-free reference; the divergence of KM against itself is 0 by definition. Document the invariant in the function's JSDoc.)
- [ ] **Step 4: Run → PASS.** Then `npm run ci:local` (the full DB-free runtime tier compiles + green now that all three summary constructors supply the fields).
- [ ] **Step 5: Commit** — `feat(substrate): B3-S5a — KM adapter reports 0/false GoF (model-free reference invariant)`.

---

## Task 6: Survival `counterfactual()` — baseline-vs-HR handles sharing one manifest

**Files:**
- Modify: `libs/substrate-runtime/src/inference/inference-backbone-router.ts` (the `SurvivalPosteriorAdapter` interface ~98-110 + the `case 'survival':` counterfactual arm ~329-334)
- Modify: the three survival adapters (`counterfactual()` method — currently a `not-implemented` stub)
- Test: `libs/substrate-runtime/src/inference/inference-backbone-router.survival.spec.ts` (existing — add a counterfactual describe)

**Pattern to mirror:** read `libs/substrate-runtime/src/inference/adapters/normal-normal-fast-path.adapter.ts` `counterfactual()` — how it builds the paired `{ baseline, counterfactual }` handles sharing ONE `RunManifest` (PosteriorHandle.summary comment at inference-types.ts:128 documents the shared-manifest invariant).

- [ ] **Step 1: Write the failing test**

```ts
it('survival counterfactual() returns baseline (HR=1) + intervention (composed HR) sharing one RunManifest', async () => {
  // register a survival indicator + a protective survival effect (magnitudePrior = ln(0.6))
  // run backbone.counterfactual({...})
  expect(res.ok).toBe(true);
  const { baseline, counterfactual } = res.value;
  const b = baseline.summary as SurvivalSummary;
  const c = counterfactual.summary as SurvivalSummary;
  expect(b.appliedHazardRatio).toBeCloseTo(1, 12);          // baseline: no intervention
  expect(c.appliedHazardRatio).toBeCloseTo(0.6, 12);         // intervention HR
  expect(c.medianSurvival).toBeGreaterThan(b.medianSurvival); // protective lifts survival
  expect(counterfactual.manifest.requestId).toBe(baseline.manifest.requestId); // ONE manifest
});
```

- [ ] **Step 2: Run → FAIL** (currently `not-implemented-phase-1`).
- [ ] **Step 3: Implement**
  1. Widen the `SurvivalPosteriorAdapter` interface in the router from `counterfactual(): Promise<Result<unknown, …>>` to `counterfactual(input: CounterfactualInput, opts?: RunOptions): Promise<Result<CounterfactualResult, InferenceErrorPhase1>>`.
  2. Replace the router's survival counterfactual arm (the `as Promise<…>` stub cast at ~329-334) with a direct `return t.adapter.counterfactual(input, opts);`.
  3. In each survival adapter, implement `counterfactual(input, opts)`: fit the baseline ONCE (reuse the `posterior()` read+fit), build the baseline summary with HR=1 and the intervention summary with the composed HR (the existing `buildSurvivalSummary`/`buildKmSurvivalSummary` already take `appliedHazardRatio` — call it twice, HR=1 and HR=exp(Σ logHR)); compute the GoF ONCE (it is HR-independent — same baseline fit + same cohort KM) and pass the SAME `fitDivergence`/`fitMisfitFlag` into both summaries; build ONE `RunManifest` (the existing `buildManifest`) and put it on BOTH handles; return `ok({ baseline, counterfactual })`. Mirror the Normal adapter's handle-id derivation (distinct ids for baseline vs cf — e.g. suffix the handle-id seed string with `'::cf'`).

> **GoF on counterfactual handles:** `fitDivergence` measures the BASELINE fit vs the cohort KM and is therefore identical on both handles (the HR does not change the baseline fit). Do NOT recompute it against the HR-adjusted curve.

- [ ] **Step 4: Run → PASS.** Then `npm run ci:local`.
- [ ] **Step 5: Commit** — `feat(substrate): B3-S5a — survival counterfactual() (baseline-vs-HR, shared manifest; closes §6 acceptance)`.

---

## Task 7: `InMemoryInferenceBackbone` — survival dispatch

**Files:**
- Modify: `libs/substrate-runtime/src/inference/testing/in-memory-inference-backbone.ts`
- Test: `libs/substrate-runtime/src/inference/testing/in-memory-inference-backbone.survival.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
it('drives a survival posterior end-to-end through the test double (familyRef dispatch)', async () => {
  const backbone = new InMemoryInferenceBackbone({ /* survival indicator + distributionCatalog */ });
  backbone.withSurvivalObservations(/* subject, indicator, cohort */);
  const res = await backbone.posterior({ /* … */ });
  expect(res.ok).toBe(true);
  expect((res.value.summary as SurvivalSummary).kind).toBe('survival');
});
it('counterfactual + sample also dispatch for survival families', async () => { /* … */ });
```

- [ ] **Step 2: Run → FAIL** (currently falls through to `not-implemented-phase-1`).
- [ ] **Step 3: Implement** — construct the three survival adapters in the backbone ctor (they need `{ catalog, evidence, distributionCatalog }`, all already present). Add a `familyRef`-precedence branch to `posterior()` + `counterfactual()` mirroring the production router (`if (meta.familyRef) → resolve by family name → the matching adapter`, BEFORE the `conjugateHint` branches). For `sample()`, mirror the router's survival sample dispatch (read `inference-backbone-router.ts` `sample()` + `inference/adapters/survival-sample.ts` — survival sampling is keyed by adapterId, not the adapter's stub `sample()`); add the survival adapterId cases. Add a `withSurvivalObservations(...)` fluent helper delegating to `evidence.registerSurvivalObservations`.
- [ ] **Step 4: Run → PASS.** Then `npm run ci:local`.
- [ ] **Step 5: Commit** — `feat(substrate): B3-S5a — InMemoryInferenceBackbone survival dispatch (posterior/counterfactual/sample)`.

---

## Task 8: Full gate + push

- [ ] **Step 1:** `npm run ci:local` (DB-free, full) → green (expect ~+15-20 new tests over the prior count; the 190ish DB-gated specs skip — correct).
- [ ] **Step 2:** `npm run ci:local:db` (DB up via `npm run db:setup`) → green — confirms the GoF widen didn't disturb the DB-gated survival replay/read tiers (no new DB surface in S5a, but the summary widen rides the persisted manifest).
- [ ] **Step 3:** push `feat/b3-s5a-survival-gof`, open the PR (body carries `Producer:`/`Effort:`/`Effect:` per policy), run the verifier wave, then the twin ritual.

---

## Self-review notes (author)
- **Spec coverage:** §3.1 → Task 1; §3.2 contract → Task 2, adapters → Tasks 3-5; §3.3 counterfactual → Task 6; §3.4 backbone → Task 7. (§4 suite is S5b.)
- **Type consistency:** `fitDivergence: number` + `fitMisfitFlag: boolean` used identically in the interface (Task 2), Zod (Task 2), all three `build*SurvivalSummary` (Tasks 3-5), and both counterfactual handles (Task 6).
- **No silent KM helper:** KM sets `0/false` literally (Task 5) — it is the reference, never calls `kmSupDivergence` against itself.
