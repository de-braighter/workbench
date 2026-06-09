# B3-S1 — Survival Contracts + Pure-Math Doubles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **Build with the `substrate-coder-pro` agent** (substrate-repo conventions: `Promise<Result<T,Error>>` at ports, ESM `.js` imports, plain-Symbol DI). The math modules are pure TS (no NestJS).

**Goal:** Land the Ring-0 survival contracts (`InferenceFamilyRef`, `SurvivalObservation`, `SurvivalSummary`, the discriminated widen of `PosteriorHandle.summary` + `RunManifestRecord.posteriorSummary`) and the three pure-math survival modules (Weibull-AFT MLE, log-logistic-AFT MLE, Kaplan-Meier) — **no adapter/router wiring** — then publish `@de-braighter/substrate-{contracts,runtime}@1.2.0`.

**Architecture:** Contracts are additive + the summary becomes a discriminated union keyed `kind`. The math is deterministic in-process MLE (right-censored log-likelihood) + the non-parametric product-limit, proven by analytical-value oracles + a run-twice byte-identical determinism witness. The single hardest invariant — bit-identical MLE for WS-9 replay — is isolated here before any wiring.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Zod. Repo: `layers/substrate` (`@de-braighter/substrate-contracts` Ring 0 + `@de-braighter/substrate-runtime` Ring 1). Current published: **1.1.0** → this slice publishes **1.2.0**.

**Repo + branch:** from `layers/substrate`, branch off `origin/main`: `git fetch origin && git checkout -b feat/b3-s1-survival-contracts-math origin/main` (the stale-local-main gotcha — always cut off origin/main).

**Conventions:** Use the substrate repo's configured test runner (check `package.json` scripts — `npm test` / `npx vitest run <path>` for targeted; the DB-free gate is `npm run ci:local`). ESM imports carry explicit `.js`. `Result<T,E>` (the repo's `Result` helper) at any fallible boundary; the math fns here are pure + total (return a typed fit result, never throw on valid input). One commit per task; TDD (failing test first).

**Determinism discipline (NON-NEGOTIABLE — the WS-9 replay foundation):** every fit MUST be bit-identical across runs given the same inputs. Therefore: (1) **sort** observations by `(durationT asc, eventObserved asc, entryT asc)` before any accumulation; (2) **pinned** initial point (stated per family); (3) **fixed** convergence tolerance + iteration cap (stated per family) — never a wall-clock or random stop; (4) pure IEEE-754 arithmetic, **no `Map`/`Set` iteration order** in the numeric path, no `Math.random`. The determinism witness test (run the fit twice, `JSON.stringify` equal) guards this per family.

**Key current shapes (verbatim from the substrate-architect map — READ these files first):**
- `libs/substrate-contracts/src/inference/inference-types.ts` — `ConjugateHint` (`:39`, UNCHANGED), the branded primitives (`IndicatorKey`/`IsoDuration`/`AdapterId`, `:29-31` — `InferenceFamilyRef` joins as a sibling brand), `PosteriorSummary` (`:61-71`: `distributionRef`, `parameterValues`, `mean`, `p10`, `p50`, `p90`, `sd`), `PosteriorHandle` (`:79`, `summary: PosteriorSummary` → widen), `SampleSummary`/`SampleResult` (`:97-111`).
- `libs/substrate-contracts/src/inference/inference-zod.ts` (`:18` `ConjugateHintSchema` UNCHANGED) + the barrel `index.ts`.
- `libs/substrate-contracts/src/reproducibility/run-manifest-repository.port.ts` (`:93` `posteriorSummary: PosteriorSummary` → widen to the union too).
- `libs/substrate-contracts/src/plan-tree/distribution-spec.ts` (`:24-34` — the `z.discriminatedUnion('kind', …)` precedent to mirror; doc `:8-12` reject-unrecognised-kind).
- Runtime math siblings (the pure-fn style to mirror): `libs/substrate-runtime/src/inference/math/normal-normal.ts`, `…/beta-binomial.ts`.

---

## Task 1: Ring-0 survival contracts (`InferenceFamilyRef`, `SurvivalObservation`, `SurvivalSummary`, the discriminated widen)

**Files:**
- Modify: `libs/substrate-contracts/src/inference/inference-types.ts`
- Modify: `libs/substrate-contracts/src/inference/inference-zod.ts`
- Modify: `libs/substrate-contracts/src/reproducibility/run-manifest-repository.port.ts`
- Modify: `libs/substrate-contracts/src/inference/index.ts` (barrel exports)
- Test: `libs/substrate-contracts/src/inference/survival-contracts.spec.ts` (new)

- [ ] **Step 1: Write the failing test** (`survival-contracts.spec.ts`):

```typescript
import { describe, expect, it } from 'vitest';
import {
  SurvivalSummarySchema,
  PosteriorSummaryOrSurvivalSchema,
  type InferenceFamilyRef,
  type SurvivalSummary,
} from './inference-zod.js';

describe('SurvivalSummary contract', () => {
  const valid: SurvivalSummary = {
    kind: 'survival',
    familyRef: 'survival.weibull-aft@1' as InferenceFamilyRef,
    parameterValues: { scale: 10, shape: 2 },
    survivalAtHorizons: [{ t: 5, s: 0.7788 }, { t: 10, s: 0.3679 }],
    medianSurvival: 8.3255,
    quantiles: [{ p: 0.25, t: 5.367 }, { p: 0.75, t: 11.774 }],
    hazardAtHorizon: { t: 10, h: 0.2 },
    appliedHazardRatio: 1,
  };

  it('accepts a well-formed survival summary', () => {
    expect(SurvivalSummarySchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a summary missing the survival discriminant', () => {
    const { kind: _drop, ...rest } = valid;
    expect(SurvivalSummarySchema.safeParse(rest).success).toBe(false);
  });

  it('the union accepts BOTH a moment PosteriorSummary and a SurvivalSummary, keyed by kind', () => {
    const moment = {
      distributionRef: 'normal@1',
      parameterValues: { mean: 0, sd: 1 },
      mean: 0, p10: -1.28, p50: 0, p90: 1.28, sd: 1,
    };
    expect(PosteriorSummaryOrSurvivalSchema.safeParse(moment).success).toBe(true);
    expect(PosteriorSummaryOrSurvivalSchema.safeParse(valid).success).toBe(true);
  });

  it('the union REJECTS an unrecognised kind (forward-compat: never mis-read)', () => {
    expect(PosteriorSummaryOrSurvivalSchema.safeParse({ kind: 'martingale', foo: 1 }).success).toBe(false);
  });

  it('InferenceFamilyRef enforces the name@version brand shape', () => {
    // a runtime validator (below) rejects an unversioned ref
    expect(SurvivalSummarySchema.safeParse({ ...valid, familyRef: 'survival.weibull-aft' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`SurvivalSummarySchema`/`PosteriorSummaryOrSurvivalSchema` not exported).

Run: targeted vitest on `survival-contracts.spec.ts`. Expected: FAIL (unresolved exports).

- [ ] **Step 3: Implement the types** — in `inference-types.ts` add (beside the existing brands + summary):

```typescript
/** A pinned `name@version` ref to a kernel.distribution_catalog family row (e.g. 'survival.weibull-aft@1'). */
export type InferenceFamilyRef = string & { readonly __brand: 'InferenceFamilyRef' };

/**
 * A right-censored time-to-event observation. `durationT` is time-on-study to the
 * event (eventObserved=true) or to censoring (eventObserved=false); `entryT` is an
 * optional late-entry / left-truncation start. Distinct from ObservationReading
 * (numerator/denominator) + NormalObservationReading (value): it carries a duration
 * + a censoring flag. NOTE: the runtime-side EvidenceRepository reading shape lives
 * in the runtime port (S2); this Ring-0 type is the family's canonical observation.
 */
export interface SurvivalObservation {
  readonly durationT: number;       // > 0
  readonly eventObserved: boolean;  // true = event at durationT; false = right-censored
  readonly entryT?: number;         // optional left-truncation entry time, 0 <= entryT < durationT
  readonly recordedAtIso: string;
}

/** The fitted survival output — admitted as a discriminated widen of PosteriorHandle.summary. */
export interface SurvivalSummary {
  readonly kind: 'survival';
  readonly familyRef: InferenceFamilyRef;
  readonly parameterValues: Readonly<Record<string, number>>; // e.g. { scale, shape }
  readonly survivalAtHorizons: ReadonlyArray<{ readonly t: number; readonly s: number }>;
  readonly medianSurvival: number;
  readonly quantiles: ReadonlyArray<{ readonly p: number; readonly t: number }>;
  readonly hazardAtHorizon: { readonly t: number; readonly h: number };
  readonly appliedHazardRatio: number; // exp(Σ log-HR); 1.0 = baseline
}

/** The widened summary union: a moment PosteriorSummary (no `kind`) OR a SurvivalSummary (kind:'survival'). */
export type PosteriorSummaryOrSurvival = PosteriorSummary | SurvivalSummary;
```

Change `PosteriorHandle.summary` (`:79`) to `summary: PosteriorSummaryOrSurvival`.

- [ ] **Step 4: Implement the Zod mirrors** — in `inference-zod.ts`:

```typescript
import { z } from 'zod';
// existing PosteriorSummarySchema stays unchanged.

const FAMILY_REF_RE = /^[a-z][a-z0-9.-]*@\d+$/;
export const InferenceFamilyRefSchema = z
  .string()
  .regex(FAMILY_REF_RE, 'familyRef must be name@version, e.g. survival.weibull-aft@1');

export const SurvivalObservationSchema = z.object({
  durationT: z.number().positive(),
  eventObserved: z.boolean(),
  entryT: z.number().nonnegative().optional(),
  recordedAtIso: z.string(),
}).refine((o) => o.entryT === undefined || o.entryT < o.durationT, {
  message: 'entryT must be < durationT (left-truncation)',
});

export const SurvivalSummarySchema = z.object({
  kind: z.literal('survival'),
  familyRef: InferenceFamilyRefSchema,
  parameterValues: z.record(z.string(), z.number()),
  survivalAtHorizons: z.array(z.object({ t: z.number(), s: z.number() })),
  medianSurvival: z.number(),
  quantiles: z.array(z.object({ p: z.number(), t: z.number() })),
  hazardAtHorizon: z.object({ t: z.number(), h: z.number() }),
  appliedHazardRatio: z.number(),
});

/** The widened union. A moment summary has no `kind`; survival is keyed `kind:'survival'`. An unknown kind is rejected. */
export const PosteriorSummaryOrSurvivalSchema = z.union([
  PosteriorSummarySchema,    // the existing moment summary (no `kind` field)
  SurvivalSummarySchema,
]).refine(
  (v) => !('kind' in (v as object)) || (v as { kind?: unknown }).kind === 'survival',
  { message: 'unrecognised summary kind' },
);
```

> Note: `PosteriorSummary` has no `kind` field, so `z.union` tries the moment schema first; an object with `kind:'survival'` fails the moment schema (extra key is fine under default Zod, but it has no `mean` etc.) then matches survival. The `.refine` rejects an object carrying an unrecognised `kind` (e.g. `'martingale'`) that might otherwise loosely match. If `PosteriorSummarySchema` is `.strict()`, the union already rejects unknown-kind; verify and keep the refine as belt-and-braces.

Re-export `InferenceFamilyRef`, `SurvivalObservation`, `SurvivalSummary`, `PosteriorSummaryOrSurvival` (types) + the new schemas from `index.ts`.

- [ ] **Step 5: Widen the run-manifest record** — in `run-manifest-repository.port.ts:93`, change `posteriorSummary: PosteriorSummary` → `posteriorSummary: PosteriorSummaryOrSurvival` (import it). This is the second discriminated-widen site (so a fitted survival model's summary persists + replays).

- [ ] **Step 6: Run — expect PASS** (all 5 contract tests). Then `npm run ci:local` (DB-free) to confirm no contracts regression (the widen is additive; existing consumers compile).

- [ ] **Step 7: Commit**

```bash
git add libs/substrate-contracts/src/inference/inference-types.ts libs/substrate-contracts/src/inference/inference-zod.ts libs/substrate-contracts/src/inference/index.ts libs/substrate-contracts/src/reproducibility/run-manifest-repository.port.ts libs/substrate-contracts/src/inference/survival-contracts.spec.ts
git commit -m "feat(substrate-contracts): survival family contracts + discriminated summary widen (B3-S1)"
```

---

## Task 2: Kaplan-Meier product-limit estimator (pure, closed-form)

**Files:**
- Create: `libs/substrate-runtime/src/inference/math/kaplan-meier.ts`
- Test: `libs/substrate-runtime/src/inference/math/kaplan-meier.spec.ts`

KM is the deterministic, model-free reference curve. The product-limit estimator: at each distinct event time `t_(i)` with `d_i` events and `n_i` at risk (subjects with `durationT >= t_(i)`, adjusted for left-truncation entry), `S(t) = Π_{t_(i) <= t} (1 - d_i / n_i)`. Censored times do not drop `S` but reduce the at-risk set for later times.

- [ ] **Step 1: Write the failing test** with a hand-computable oracle:

```typescript
import { describe, expect, it } from 'vitest';
import { kaplanMeier, type KmCurve } from './kaplan-meier.js';
import type { SurvivalObservation } from '@de-braighter/substrate-contracts';

const obs = (durationT: number, eventObserved: boolean): SurvivalObservation =>
  ({ durationT, eventObserved, recordedAtIso: '2026-01-01T00:00:00Z' });

describe('kaplanMeier', () => {
  // Classic small set: events at 2,3,5; censored at 4 (Klein/Moeschberger-style).
  // n=5. t=2: n=5,d=1 → S=0.8. t=3: n=4,d=1 → S=0.8*0.75=0.6. censor@4 drops at-risk.
  // t=5: n=2,d=1 → S=0.6*0.5=0.3.
  const data = [obs(2, true), obs(3, true), obs(4, false), obs(5, true), obs(6, false)];

  it('computes the product-limit step function', () => {
    const km: KmCurve = kaplanMeier(data);
    expect(km.steps.map((s) => [s.t, Number(s.survival.toFixed(4))])).toEqual([
      [2, 0.8], [3, 0.6], [5, 0.3],
    ]);
  });

  it('survivalAt is right-continuous step lookup (S before first event = 1)', () => {
    const km = kaplanMeier(data);
    expect(km.survivalAt(1)).toBe(1);
    expect(km.survivalAt(2)).toBeCloseTo(0.8, 10);
    expect(km.survivalAt(4)).toBeCloseTo(0.6, 10); // between event times holds prior value
    expect(km.survivalAt(100)).toBeCloseTo(0.3, 10);
  });

  it('is deterministic — identical output across two runs over shuffled input', () => {
    const shuffled = [data[3], data[0], data[4], data[1], data[2]];
    expect(JSON.stringify(kaplanMeier(shuffled))).toBe(JSON.stringify(kaplanMeier(data)));
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `kaplan-meier.ts`:

```typescript
import type { SurvivalObservation } from '@de-braighter/substrate-contracts';

export interface KmStep { readonly t: number; readonly survival: number; readonly atRisk: number; readonly events: number; }
export interface KmCurve {
  readonly steps: readonly KmStep[];
  /** Right-continuous step lookup: S(t) = product over event times <= t. */
  survivalAt(t: number): number;
}

export function kaplanMeier(observations: readonly SurvivalObservation[]): KmCurve {
  // Deterministic order: sort by (t asc, event-before-censor).
  const sorted = [...observations].sort(
    (a, b) => a.durationT - b.durationT || Number(b.eventObserved) - Number(a.eventObserved),
  );
  const eventTimes = [...new Set(sorted.filter((o) => o.eventObserved).map((o) => o.durationT))].sort((a, b) => a - b);
  const steps: KmStep[] = [];
  let s = 1;
  for (const t of eventTimes) {
    const atRisk = sorted.filter((o) => o.durationT >= t && (o.entryT ?? 0) < t).length;
    const events = sorted.filter((o) => o.eventObserved && o.durationT === t).length;
    if (atRisk === 0) continue;
    s *= 1 - events / atRisk;
    steps.push({ t, survival: s, atRisk, events });
  }
  const survivalAt = (t: number): number => {
    let cur = 1;
    for (const step of steps) { if (step.t <= t) cur = step.survival; else break; }
    return cur;
  };
  return { steps, survivalAt };
}
```

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit** `feat(substrate-runtime): Kaplan-Meier product-limit estimator (B3-S1)`.

---

## Task 3: Weibull-AFT MLE (right-censored, 1-D profile on shape)

**Files:**
- Create: `libs/substrate-runtime/src/inference/math/weibull-aft.ts`
- Test: `libs/substrate-runtime/src/inference/math/weibull-aft.spec.ts`

Weibull: `S(t)=exp(-(t/λ)^k)`, hazard `h(t)=(k/λ)(t/λ)^(k-1)`, pdf `f(t)=(k/λ)(t/λ)^(k-1)·S(t)`, quantile `t_p = λ·(-ln(1-p))^(1/k)` (so `S(t_p)=1-p`), median `=λ·(ln2)^(1/k)`. Right-censored MLE profiles out the scale: given shape `k`, `λ̂(k)^k = (Σ_all t_i^k)/d` where the sum is over ALL observations and `d` = event count. The shape `k` solves the 1-D score equation `g(k)=0`:

```
g(k) = 1/k + (Σ_events ln t_i)/d − (Σ_all t_i^k ln t_i)/(Σ_all t_i^k)
g'(k) = −1/k² − [ (Σ_all t_i^k (ln t_i)²)(Σ_all t_i^k) − (Σ_all t_i^k ln t_i)² ] / (Σ_all t_i^k)²
```

Newton-Raphson on `g`, **pinned init `k₀ = 1`** (exponential), **tol `1e-10` on |Δk|**, **maxIter 100**; clamp `k > 0`. Left-truncation (`entryT`): subtract the entry contribution — replace `t_i^k` accumulations with `t_i^k − entryT_i^k` in the scale/score sums (an observation conditioned on survival past `entryT`). Sort observations first (determinism).

- [ ] **Step 1: Write the failing test** with analytical + recovery + determinism oracles:

```typescript
import { describe, expect, it } from 'vitest';
import { fitWeibullAft, weibullSurvival, weibullHazard, weibullQuantile, type WeibullFit } from './weibull-aft.js';
import type { SurvivalObservation } from '@de-braighter/substrate-contracts';

describe('Weibull closed forms', () => {
  it('S(t), hazard, quantile match the analytical values (λ=10, k=2)', () => {
    expect(weibullSurvival(10, 10, 2)).toBeCloseTo(Math.exp(-1), 10); // 0.367879
    expect(weibullSurvival(5, 10, 2)).toBeCloseTo(Math.exp(-0.25), 10); // 0.778801
    expect(weibullHazard(10, 10, 2)).toBeCloseTo(0.2, 10);
    expect(weibullQuantile(0.5, 10, 2)).toBeCloseTo(10 * Math.sqrt(Math.LN2), 8); // median 8.3255
  });
});

describe('fitWeibullAft (right-censored MLE)', () => {
  // Deterministic synthetic cohort: inverse-CDF draw from Weibull(λ=10,k=1.5) on a fixed grid,
  // right-censor any t>20 at 20. Built without RNG (a fixed quantile grid) for a pinned oracle.
  const cohort: SurvivalObservation[] = Array.from({ length: 200 }, (_v, i) => {
    const p = (i + 0.5) / 200;                 // fixed quantile grid → no RNG
    const draw = 10 * Math.pow(-Math.log(1 - p), 1 / 1.5);
    const eventObserved = draw <= 20;
    return { durationT: eventObserved ? draw : 20, eventObserved, recordedAtIso: '2026-01-01T00:00:00Z' };
  });

  it('recovers the generating parameters within tolerance', () => {
    const fit = fitWeibullAft(cohort);
    expect(fit.scale).toBeGreaterThan(9.0);
    expect(fit.scale).toBeLessThan(11.0);
    expect(fit.shape).toBeGreaterThan(1.35);
    expect(fit.shape).toBeLessThan(1.65);
    expect(fit.converged).toBe(true);
    expect(fit.iterations).toBeLessThanOrEqual(100);
  });

  it('is bit-identical across two runs and over shuffled input (the WS-9 determinism witness)', () => {
    const shuffled = [...cohort].reverse();
    expect(JSON.stringify(fitWeibullAft(cohort))).toBe(JSON.stringify(fitWeibullAft(cohort)));
    expect(JSON.stringify(fitWeibullAft(shuffled))).toBe(JSON.stringify(fitWeibullAft(cohort)));
  });

  it('all-censored input returns converged:false (no events to fit)', () => {
    const allCensored = cohort.map((o) => ({ ...o, eventObserved: false }));
    expect(fitWeibullAft(allCensored).converged).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `weibull-aft.ts` — the closed forms + the 1-D profile Newton per the equations above. `WeibullFit = { scale: number; shape: number; converged: boolean; iterations: number }`. Sort observations by `(durationT, eventObserved)` first; accumulate `Σ_all t^k`, `Σ_all t^k ln t`, `Σ_all t^k (ln t)²`, `Σ_events ln t`, `d` (with the `entryT` subtraction when present); Newton from `k₀=1`, tol `1e-10`, maxIter `100`; `λ = ((Σ_all t^k)/d)^(1/k)`. If `d === 0` (no events) return `{ scale: NaN, shape: NaN, converged: false, iterations: 0 }` — total, never throws.

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit** `feat(substrate-runtime): Weibull-AFT right-censored MLE (B3-S1)`.

---

## Task 4: Log-logistic-AFT MLE (right-censored, 2-D Newton)

**Files:**
- Create: `libs/substrate-runtime/src/inference/math/loglogistic-aft.ts`
- Test: `libs/substrate-runtime/src/inference/math/loglogistic-aft.spec.ts`

Log-logistic: `S(t)=1/(1+(t/α)^β)`, hazard `h(t)=(β/α)(t/α)^(β-1)/(1+(t/α)^β)` (non-monotone for β>1: rises then falls), quantile `t_p = α·(p/(1−p))^(1/β)` (so `S(t_p)=1−p`), median `=α`. Fit on the **logistic location-scale** form: `y_i = ln t_i`, `μ = ln α`, `s = 1/β`; let `z_i = (y_i − μ)/s`. Event contributes `ln f = −ln s + z − 2·ln(1+e^z)` (the standard logistic density in log-time minus the `ln t` Jacobian, which is constant in (μ,s) so droppable for the MLE); right-censored contributes `ln S = −ln(1+e^z)`. Maximize over `(μ, s)` by **2-D Newton-Raphson** with the analytic gradient/Hessian (standard logistic-AFT; derive from the above), **pinned init `μ₀ = mean(ln t over events)`, `s₀ = 1`**, **tol `1e-10` on the max-abs gradient**, **maxIter `100`**; clamp `s > 0`. Sort first. (If the 2-D Hessian is non-PD at a step, fall back to a damped/gradient step with a fixed halving schedule — deterministic.)

- [ ] **Step 1: Write the failing test** (analytical + recovery + determinism):

```typescript
import { describe, expect, it } from 'vitest';
import { fitLogLogisticAft, loglogisticSurvival, loglogisticQuantile } from './loglogistic-aft.js';
import type { SurvivalObservation } from '@de-braighter/substrate-contracts';

describe('Log-logistic closed forms', () => {
  it('S(t), quantile match analytical values (α=10, β=2)', () => {
    expect(loglogisticSurvival(10, 10, 2)).toBeCloseTo(0.5, 10);  // median = α
    expect(loglogisticSurvival(20, 10, 2)).toBeCloseTo(0.2, 10);  // 1/(1+4)
    expect(loglogisticQuantile(0.5, 10, 2)).toBeCloseTo(10, 8);
    expect(loglogisticQuantile(0.75, 10, 2)).toBeCloseTo(10 * Math.sqrt(3), 6); // (0.75/0.25)^(1/2)
  });
});

describe('fitLogLogisticAft (right-censored MLE)', () => {
  const cohort: SurvivalObservation[] = Array.from({ length: 300 }, (_v, i) => {
    const p = (i + 0.5) / 300;
    const draw = 10 * Math.pow(p / (1 - p), 1 / 2);   // log-logistic α=10,β=2, fixed grid
    const eventObserved = draw <= 40;
    return { durationT: eventObserved ? draw : 40, eventObserved, recordedAtIso: '2026-01-01T00:00:00Z' };
  });

  it('recovers the generating parameters within tolerance', () => {
    const fit = fitLogLogisticAft(cohort);
    expect(fit.scale).toBeGreaterThan(9.0);
    expect(fit.scale).toBeLessThan(11.0);
    expect(fit.shape).toBeGreaterThan(1.8);
    expect(fit.shape).toBeLessThan(2.2);
    expect(fit.converged).toBe(true);
  });

  it('is bit-identical across two runs + shuffled input (determinism witness)', () => {
    const shuffled = [...cohort].reverse();
    expect(JSON.stringify(fitLogLogisticAft(cohort))).toBe(JSON.stringify(fitLogLogisticAft(cohort)));
    expect(JSON.stringify(fitLogLogisticAft(shuffled))).toBe(JSON.stringify(fitLogLogisticAft(cohort)));
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** `loglogistic-aft.ts` — the closed forms + the 2-D Newton per above. `LogLogisticFit = { scale: number; shape: number; converged: boolean; iterations: number }` (`scale=α=exp(μ)`, `shape=β=1/s`). Sort first; pinned init; tol `1e-10` on max-abs-gradient; maxIter `100`; deterministic damped fallback. `d===0` → `converged:false`, total.

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit** `feat(substrate-runtime): log-logistic-AFT right-censored MLE (B3-S1)`.

---

## Task 5: Publish 1.2.0 + full gate + PR

**Files:** `libs/substrate-contracts/package.json`, `libs/substrate-runtime/package.json` (version bump).

- [ ] **Step 1: Bump versions** — both `package.json` to `1.2.0`; the runtime's dep on `@de-braighter/substrate-contracts` to `^1.2.0`. Confirm no other version refs need updating (grep for `1.1.0`).
- [ ] **Step 2: Full gate** — `npm run ci:local` (DB-free) green in BOTH libs (contracts + runtime build, lint, the new specs + the full existing suites — the discriminated widen must not break any existing inference/replay spec). Report counts.
- [ ] **Step 3: Publish** — per the memory's recipe: `GITHUB_TOKEN=$(gh auth token)` then `npm run publish:contracts` + `npm run publish:runtime`. **Collision-check the version with exact-equality, NOT substring-grep** (the documented gotcha): confirm `1.2.0` is absent via `npm view @de-braighter/substrate-contracts versions --json` membership before publishing. Publish contracts first, then runtime (dep order).
- [ ] **Step 4: PR** — push + open. Body: `Tech design:` the B3 decomposition spec + ADR-223; note it's B3-S1 (Ring-0 contracts + pure math, no wiring); the discriminated widen is additive (consumers exhaustive-switching handle `kind:'survival'`); 1.2.0 published. `Producer:`/`Effect:` lines. "Part of B3 (ADR-223) / the oncology program."
- [ ] **Step 5: Verifier wave** — `local-ci` + `reviewer` + `charter-checker` (kernel minimality — confirm `ConjugateHint` UNCHANGED, the widen is additive + minimal, no new concern/table; the ADR-176 verdict in ADR-223 holds) + `qa-engineer`. Auto-merge on green; twin ritual (`drain`/`backfill de-braighter/substrate`/`reconcile`).

---

## Self-Review (plan author)

**Spec coverage (decomposition §3 S1 + §4):** Ring-0 contracts (InferenceFamilyRef + SurvivalObservation + SurvivalSummary + the discriminated widen of PosteriorHandle.summary AND RunManifestRecord.posteriorSummary) → Task 1; pure math weibull/loglogistic/KM → Tasks 3/4/2; the determinism witness (the §5 risk-1 mitigation) → the bit-identical tests in Tasks 2/3/4; publish 1.2.0 (§4 decision #4) → Task 5. The Ring-0-vs-runtime home (§4.1): `SurvivalSummary`+`InferenceFamilyRef` Ring-0 (Task 1); `SurvivalObservation` is defined Ring-0 here as the canonical family observation BUT the runtime EvidenceRepository reading shape is S2 (noted in the type doc) — consistent with §4.1 (the metadata `familyRef` field + the evidence-reading wiring are S2, not S1). `ConjugateHint` untouched (stated). No adapter/router/catalog wiring (those are S2/S3) — correct S1 boundary.

**Placeholder scan:** no TBD/TODO. The contracts (Task 1) + KM (Task 2) ship full code. Weibull (Task 3) + log-logistic (Task 4) give the exact closed forms + the exact score/gradient equations + the pinned init/tol/maxIter + full TEST oracles with analytical expected values (the correctness guarantee) — the implementer writes the Newton loop to satisfy the analytical + recovery + determinism tests. This is deliberate: the tests pin correctness; the formulas guide the impl. The log-logistic Hessian is described (derive-from-the-density) rather than transcribed — flagged as the one derivation the implementer (substrate-coder-pro) does, guarded by the analytical + recovery tests.

**Type consistency:** `InferenceFamilyRef`/`SurvivalObservation`/`SurvivalSummary`/`PosteriorSummaryOrSurvival` defined Task 1, imported in Tasks 2/3/4 (KM/Weibull/log-logistic consume `SurvivalObservation`). Fit results: `WeibullFit`/`LogLogisticFit` `{scale,shape,converged,iterations}` (parallel shapes). `weibullSurvival/Hazard/Quantile` + `loglogisticSurvival/Quantile` + `kaplanMeier`/`KmCurve` consistent across their definitions + tests. `PosteriorSummaryOrSurvivalSchema` (Task 1) is the union both widen sites use.
