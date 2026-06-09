# B3-S3 — Log-Logistic + Kaplan-Meier Adapters + Catalog Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. **Build with the `substrate-coder-pro` agent** (substrate conventions: `Promise<Result<T,E>>` at ports, ESM `.js` imports, plain-Symbol DI, no throws across the port boundary). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the two remaining survival adapters (log-logistic-AFT + Kaplan-Meier) behind the router's `familyRef` dispatch, and register all three survival families as append-only `kernel.distribution_catalog` rows (in-memory seeds + a forward Prisma migration) with the fit recipe pinned in `parameterSchema` — proven by a byte-identical in-memory↔Prisma `catalogVersionHash` digest test + a fit-recipe-versioning test.

**Architecture:** The log-logistic adapter is a near-verbatim mirror of the S2 `WeibullAftAdapter` (fit → compose log-HR → `S_adj(t)=S_base(t)^HR` → `SurvivalSummary`). The Kaplan-Meier adapter is the one non-parametric case (a step function — no scale/shape; the `SurvivalSummary` carries cohort descriptors + step-lookup quantiles + a discrete hazard). The router gains two `familyRef` dispatch branches under a structural `SurvivalPosteriorAdapter` interface (the `kind:'survival'` dispatch arm is unchanged). The three catalog rows register `conjugateWith:[]` with an all-string `fit` recipe (so the JS↔JSONB hash round-trips byte-identically). **No production read, no projection widen, no contracts change, no publish** (those are S3.5).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, NestJS (runtime DI), Prisma (a hand-authored forward migration). Repo: `layers/substrate` (`@de-braighter/substrate-runtime`, `kernel.distribution_catalog`). Builds on S1 (math + contracts, merged) + S2 (Weibull adapter + router dispatch, merged). Current published: **1.2.0** (stays — S3 is runtime/schema-internal).

**Repo + branch:** from `layers/substrate`, branch off `origin/main`: `git fetch origin && git checkout -b feat/b3-s3-survival-adapters-catalog origin/main` (the stale-local-main gotcha — always cut off origin/main; substrate main carries S1+S2 at `4e493dc`+).

**Conventions:** ESM imports carry explicit `.js`. Survival types resolve via the `@de-braighter/substrate-contracts/inference` SUBPATH (the root index does NOT re-export the inference barrel — the S1 gotcha). `Result<T,E>` at every fallible boundary; the adapters return `Promise<Result<…, InferenceErrorPhase1>>` and NEVER throw across the port. One commit per task; TDD (failing test first). DB-free gate: `npm run ci:local`. DB-gated digest proof: `npm run ci:local:db` (or the explicit `SUBSTRATE_DATABASE_URL=… npx vitest run <path>` shown in Task 5).

**READ FIRST (the precedents — absolute paths):**
- `libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.ts` — THE adapter skeleton both new adapters mirror (`posterior` :119, the log-HR compose :169-178, `buildSurvivalSummary` :336-374, `buildManifest` :292-324, `materializeHandle`/`handleIdFor`/`stableSeed`/`sha256Hex` :266-398, the deferred Phase-1 methods :198-241, `WEIBULL_AFT_ADAPTER_ID` :76).
- `libs/substrate-runtime/src/inference/inference-backbone-router.ts` — `WEIBULL_AFT_FAMILY_NAME` :79, the `DispatchTarget` union :89-94, the adapter fields :125-129 + constructions :142-163, `posterior` dispatch :179-191, `sample` by-adapterId :201-223, `counterfactual` dispatch :237-255, `dispatchForFamilyRef` :368-382.
- `libs/substrate-runtime/src/inference/math/loglogistic-aft.ts` — `fitLogLogisticAft` :223, `loglogisticSurvival`/`loglogisticHazard`/`loglogisticQuantile`/`loglogisticMedian` :86-103, `LogLogisticFit {scale,shape,converged,iterations}` :74.
- `libs/substrate-runtime/src/inference/math/kaplan-meier.ts` — `kaplanMeier(observations): KmCurve` :38, `KmStep {t,survival,atRisk,events}` :25, `KmCurve {steps, survivalAt(t)}` :32.
- `libs/substrate-runtime/src/reproducibility/in-memory-distribution-catalog.ts` — `NORMAL_DISTRIBUTION_SEED` :30-40, the constructor default seed :50-52.
- `libs/substrate-runtime/src/reproducibility/distribution-catalog.contract.ts` — the shared digest contract (the byte-identity case :90-97, drift case :105-111).
- `libs/substrate-runtime/src/reproducibility/prisma-reproducibility.contract.spec.ts` — the DB-gated harness (`describe.skipIf(!DB_URL)` :44, the `PrismaDistributionCatalog` seeding :64-80).
- `prisma/migrations/20260607000000_kernel_ws9_reproducibility_surface/migration.sql` — the Normal-seed INSERT (the template) + the `app`-role GRANT pattern.
- `libs/substrate-contracts/src/reproducibility/distribution-catalog.port.ts` — `DistributionEntry {name, pdfRef, cdfRef, sampleRef, parameterSchema, conjugateWith}` :47-60.

---

## Task 1: `LogLogisticAftAdapter` — fit + compose log-HR → `SurvivalSummary`

**Files:**
- Create: `libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.ts`
- Test: `libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.spec.ts`

The adapter is a **near-verbatim copy** of `weibull-aft.adapter.ts`. Copy that file, then apply EXACTLY these substitutions (everything else — the `posterior` pipeline, the log-HR compose, `buildManifest`, `materializeHandle`, the deferred Phase-1 methods, `handleIdFor`/`stableSeed`/`sha256Hex` — is byte-identical):

1. **Imports** — replace the math import block with:
   ```typescript
   import {
     fitLogLogisticAft,
     loglogisticHazard,
     loglogisticQuantile,
     loglogisticSurvival,
     type LogLogisticFit,
   } from '../math/loglogistic-aft.js';
   ```
2. **Constants:**
   ```typescript
   export const LOGLOGISTIC_AFT_ADAPTER_ID = 'loglogistic-aft-v1' as AdapterId;
   const ENGINE_VERSION = 'substrate-runtime@loglogistic-aft-fast-path-0.1.0';
   ```
3. **Class name** → `LogLogisticAftAdapter`; **deps interface** → `LogLogisticAftDeps` (same three fields: `catalog`, `evidence`, `distributionCatalog`).
4. **The fit + `WEIBULL_AFT_ADAPTER_ID`** in `posterior`/`materializeHandle`: `fitWeibullAft` → `fitLogLogisticAft`; `WeibullFit` → `LogLogisticFit`; `WEIBULL_AFT_ADAPTER_ID` → `LOGLOGISTIC_AFT_ADAPTER_ID`.
5. **`requireSurvivalMetadata`** message: `WeibullAftAdapter requires…` → `LogLogisticAftAdapter requires…`.
6. **`buildSurvivalSummary`** — identical structure (the proportional-hazards inversion is the SAME relation), only the three math fns change: `weibullQuantile` → `loglogisticQuantile`, `weibullSurvival` → `loglogisticSurvival`, `weibullHazard` → `loglogisticHazard`. (The `adjustedQuantileTime(p) = loglogisticQuantile(1 - (1-p)^(1/hr), scale, shape)` form is unchanged — log-logistic's `quantile(p)` returns `t` where `S(t)=1-p`, exactly like Weibull's.)

- [ ] **Step 1: Write the failing test** (`loglogistic-aft.adapter.spec.ts`) — mirror the S2 Weibull adapter spec; construct against the in-memory doubles. **Heavy-censoring + the adversarial ignore-censoring assertion + ≥2-effect composition are MANDATORY (the S1/S2 wave lesson):**

```typescript
import { describe, expect, it } from 'vitest';

import { InMemoryDistributionCatalog } from '../../reproducibility/in-memory-distribution-catalog.js';
import {
  InMemoryInferenceCatalog,
  InMemoryEvidenceRepository,
} from '../in-memory-inference-catalog.js';
import type { IndicatorMetadata } from '../inference-catalog.port.js';
import type { InferenceFamilyRef, PosteriorInput, SurvivalObservation } from '@de-braighter/substrate-contracts/inference';
import { LogLogisticAftAdapter } from './loglogistic-aft.adapter.js';

const TENANT = 'tenant-a';
const TREE = 'tree-1';
const SUBJECT = 'subj-1';
const INDICATOR = 'onc.recurrence';
const FAMILY = 'survival.loglogistic-aft@1' as InferenceFamilyRef;

const obs = (durationT: number, eventObserved: boolean): SurvivalObservation => ({
  durationT,
  eventObserved,
  recordedAtIso: '2026-01-01T00:00:00Z',
});

// A ~40%-censored log-logistic(α=10, β=2) cohort drawn off a FIXED quantile grid
// (no RNG → a pinned oracle). Censor any t>20 at 20 (≈ the upper ~40%).
const cohort: SurvivalObservation[] = Array.from({ length: 300 }, (_v, i) => {
  const p = (i + 0.5) / 300;
  const draw = 10 * Math.pow(p / (1 - p), 1 / 2);
  const eventObserved = draw <= 20;
  return obs(eventObserved ? draw : 20, eventObserved);
});

function wire(opts: { effects?: number[] } = {}) {
  const meta: IndicatorMetadata = {
    indicatorKey: INDICATOR,
    conjugateHint: null,
    familyRef: FAMILY,
  } as IndicatorMetadata;
  const catalog = new InMemoryInferenceCatalog([meta]);
  const evidence = new InMemoryEvidenceRepository();
  evidence.registerSurvivalObservations(TENANT, SUBJECT, INDICATOR, cohort);
  // Each survival effect's magnitudePrior is a log-HR (the flat-scalar convention).
  for (const logHr of opts.effects ?? []) {
    evidence.registerTreeEffect(TENANT, TREE, INDICATOR, logHr); // see the S2 spec helper name; match the real API
  }
  const distributionCatalog = new InMemoryDistributionCatalog();
  const adapter = new LogLogisticAftAdapter({ catalog, evidence, distributionCatalog });
  const input: PosteriorInput = {
    tenantPackId: TENANT,
    treeRoot: TREE,
    subject: { kind: 'individual', id: SUBJECT },
    indicatorKey: INDICATOR,
  } as PosteriorInput;
  return { adapter, input };
}

describe('LogLogisticAftAdapter', () => {
  it('fits the cohort → SurvivalSummary(kind:survival) with α≈10,β≈2; HR=1 (no effects)', async () => {
    const { adapter, input } = wire();
    const res = await adapter.posterior(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = res.value.summary;
    expect(s.kind).toBe('survival');
    if (s.kind !== 'survival') return;
    expect(s.parameterValues.scale).toBeGreaterThan(9);
    expect(s.parameterValues.scale).toBeLessThan(11);
    expect(s.parameterValues.shape).toBeGreaterThan(1.8);
    expect(s.parameterValues.shape).toBeLessThan(2.2);
    expect(s.appliedHazardRatio).toBe(1);
    // monotone-decreasing survival across the horizon grid
    expect(s.survivalAtHorizons[0].s).toBeGreaterThan(s.survivalAtHorizons[1].s);
  });

  it('ADVERSARIAL: an ignore-censoring fit (treat all as events) lands OUT of the recovered band', () => {
    // Guards the censored log-likelihood: refit the SAME durations with eventObserved=true
    // everywhere and assert the naive scale is materially smaller (biased downward) — i.e.
    // the censoring term genuinely bites. (Pure-math assertion, no adapter.)
    const ignoreCensoring = cohort.map((o) => ({ ...o, eventObserved: true }));
    const honest = fitLogLogisticAftForTest(cohort);   // import fitLogLogisticAft directly
    const naive = fitLogLogisticAftForTest(ignoreCensoring);
    expect(naive.scale).toBeLessThan(9.0); // out of the [9,11] honest band
  });

  it('applies a composed hazard ratio from ≥2 effects: Σ log-HR then exp', async () => {
    // TWO protective effects ln(0.5)+ln(0.8) → HR ≈ 0.4 (NOT exp(first)=0.5).
    const { adapter, input } = wire({ effects: [Math.log(0.5), Math.log(0.8)] });
    const res = await adapter.posterior(input);
    expect(res.ok).toBe(true);
    if (!res.ok || res.value.summary.kind !== 'survival') return;
    expect(res.value.summary.appliedHazardRatio).toBeCloseTo(0.4, 6);
  });

  it('HARMFUL HR>1 drops the curve below baseline', async () => {
    const base = await wire().adapter.posterior(wire().input);
    const harmful = await wire({ effects: [Math.log(2)] }).adapter.posterior(wire({ effects: [Math.log(2)] }).input);
    expect(base.ok && harmful.ok).toBe(true);
    if (!base.ok || !harmful.ok) return;
    if (base.value.summary.kind !== 'survival' || harmful.value.summary.kind !== 'survival') return;
    expect(harmful.value.summary.appliedHazardRatio).toBeCloseTo(2, 6);
    // S_adj(t)=S_base(t)^2 < S_base(t) at the same horizon
    expect(harmful.value.summary.survivalAtHorizons[0].s).toBeLessThan(base.value.summary.survivalAtHorizons[0].s);
  });

  it('errors (not throws) on an all-censored cohort', async () => {
    const evidence = new InMemoryEvidenceRepository();
    evidence.registerSurvivalObservations(TENANT, SUBJECT, INDICATOR, cohort.map((o) => ({ ...o, eventObserved: false })));
    const meta = { indicatorKey: INDICATOR, conjugateHint: null, familyRef: FAMILY } as IndicatorMetadata;
    const adapter = new LogLogisticAftAdapter({
      catalog: new InMemoryInferenceCatalog([meta]),
      evidence,
      distributionCatalog: new InMemoryDistributionCatalog(),
    });
    const res = await adapter.posterior({ tenantPackId: TENANT, treeRoot: TREE, subject: { kind: 'individual', id: SUBJECT }, indicatorKey: INDICATOR } as PosteriorInput);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('cohort-too-small');
  });

  it('is reproducible — two posterior() calls produce a byte-identical SurvivalSummary', async () => {
    const a = await wire().adapter.posterior(wire().input);
    const b = await wire().adapter.posterior(wire().input);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.value.summary)).toBe(JSON.stringify(b.value.summary));
  });
});
```

> **CONFIRM points (read the S2 Weibull spec `weibull-aft.adapter.spec.ts` for the EXACT shapes — do not guess):** (a) the real `InMemoryEvidenceRepository` survival-observation register method name (`registerSurvivalObservations`) + the **tree-effect register method** (the S2 spec seeds tree effects to drive `findEffectsForTree` — match its exact name + signature; `registerTreeEffect`/`registerEffect` is a placeholder above); (b) the `IndicatorMetadata` required fields (the cast `as IndicatorMetadata` covers optional fields, but match the S2 spec's construction); (c) import `fitLogLogisticAft` directly for the adversarial pure-math assertion (rename the local alias `fitLogLogisticAftForTest` → the real `fitLogLogisticAft`). The behavior + oracles above are the correctness pins; the wiring mirrors the S2 spec exactly.

- [ ] **Step 2: Run — expect FAIL** (adapter not created). Run: `npx vitest run libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.spec.ts`.
- [ ] **Step 3: Implement** `loglogistic-aft.adapter.ts` by copying `weibull-aft.adapter.ts` + applying the six substitutions above. Verify the `buildSurvivalSummary` uses `loglogisticQuantile`/`loglogisticSurvival`/`loglogisticHazard`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(substrate-runtime): LogLogisticAftAdapter (fit + log-HR compose → SurvivalSummary) (B3-S3)`.

---

## Task 2: `KaplanMeierAdapter` — non-parametric `SurvivalSummary` over the product-limit curve

**Files:**
- Create: `libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.ts`
- Test: `libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.spec.ts`

The adapter is the SAME skeleton as `weibull-aft.adapter.ts` for everything EXCEPT the fit + the summary build (KM is non-parametric). Copy the skeleton; the `posterior` pipeline is identical (`findSurvivalObservations` + `findEffectsForTree` + the composite `catalogVersionHash`), then:

- **Constants:** `export const KAPLAN_MEIER_ADAPTER_ID = 'kaplan-meier-v1' as AdapterId;` and `const ENGINE_VERSION = 'substrate-runtime@kaplan-meier-0.1.0';`.
- **Fit:** `const km = kaplanMeier(observations);` — if `km.steps.length === 0` (no events) → `err({ kind: 'cohort-too-small', cohortSize: 0, minRequired: 1 })` (mirrors the Weibull non-convergence branch).
- **`buildSurvivalSummary`** is REPLACED with the KM-specific builder below (the novel part).
- Import: `import { kaplanMeier, type KmCurve, type KmStep } from '../math/kaplan-meier.js';`
- The metadata-require + `materializeHandle` use `KAPLAN_MEIER_ADAPTER_ID`; the `requireSurvivalMetadata` message says `KaplanMeierAdapter requires…`.

The KM summary builder (full code — this is the non-mechanical part):

```typescript
// ─── KM survival summary construction (module-private, pure) ────────────────

const SUMMARY_QUANTILES = [0.25, 0.75] as const;

/**
 * Build the SurvivalSummary from a fitted KM curve + a composed proportional-
 * hazards multiplier. KM is non-parametric: parameterValues carry cohort
 * descriptors (n/events/censored), not distributional params. Under proportional
 * hazards S_adj(t)=S_KM(t)^HR; a quantile p is the smallest STEP time t whose
 * S_adj(t) <= 1-p, i.e. S_KM(t) <= (1-p)^(1/HR). If the curve never crosses the
 * target, report the largest observed event time as a conservative LOWER BOUND
 * (NEVER Infinity/NaN — they serialize to null under JSON.stringify and would
 * break the byte-identical determinism witness).
 */
function buildKmSurvivalSummary(args: {
  familyRef: InferenceFamilyRef;
  km: KmCurve;
  n: number;
  events: number;
  appliedHazardRatio: number;
}): SurvivalSummary {
  const { familyRef, km, n, events, appliedHazardRatio: hr } = args;
  const steps = km.steps;
  const lastEventTime = steps[steps.length - 1]!.t; // steps non-empty (caller guards)

  // Smallest step time whose adjusted survival S_KM(t)^HR <= 1-p; else the
  // last event time (lower bound). target = (1-p)^(1/HR).
  const adjustedQuantileTime = (p: number): number => {
    const target = Math.pow(1 - p, 1 / hr);
    for (const step of steps) if (step.survival <= target) return step.t;
    return lastEventTime;
  };

  const medianSurvival = adjustedQuantileTime(0.5);
  const quantiles = SUMMARY_QUANTILES.map((p) => ({ p, t: adjustedQuantileTime(p) }));

  // Horizon grid mirrors the parametric adapters: [median, 2*median]; S = S_KM(t)^HR.
  const horizonGrid = [medianSurvival, 2 * medianSurvival];
  const survivalAtHorizons = horizonGrid.map((t) => ({
    t,
    s: Math.pow(km.survivalAt(t), hr),
  }));

  // Discrete KM hazard d_i/n_i at the largest step <= the median horizon, scaled
  // by HR (proportional hazards). No step at/before the horizon ⇒ hazard 0.
  const hazardT = medianSurvival;
  let stepHazard = 0;
  for (const step of steps) {
    if (step.t <= hazardT) stepHazard = step.events / step.atRisk;
    else break;
  }
  const hazardAtHorizon = { t: hazardT, h: stepHazard * hr };

  return {
    kind: 'survival',
    familyRef,
    parameterValues: { n, events, censored: n - events },
    survivalAtHorizons,
    medianSurvival,
    quantiles,
    hazardAtHorizon,
    appliedHazardRatio: hr,
  };
}
```

And in `posterior`, after the fit guard + the HR compose:
```typescript
const n = observations.length;
const events = observations.filter((o) => o.eventObserved).length;
const summary = buildKmSurvivalSummary({ familyRef, km, n, events, appliedHazardRatio });
```

- [ ] **Step 1: Write the failing test** (`kaplan-meier.adapter.spec.ts`) with a hand-computable KM oracle:

```typescript
import { describe, expect, it } from 'vitest';

import { InMemoryDistributionCatalog } from '../../reproducibility/in-memory-distribution-catalog.js';
import {
  InMemoryInferenceCatalog,
  InMemoryEvidenceRepository,
} from '../in-memory-inference-catalog.js';
import type { IndicatorMetadata } from '../inference-catalog.port.js';
import type { InferenceFamilyRef, PosteriorInput, SurvivalObservation } from '@de-braighter/substrate-contracts/inference';
import { KaplanMeierAdapter } from './kaplan-meier.adapter.js';

const TENANT = 'tenant-a', TREE = 'tree-1', SUBJECT = 'subj-1', INDICATOR = 'onc.km';
const FAMILY = 'survival.kaplan-meier@1' as InferenceFamilyRef;
const obs = (durationT: number, eventObserved: boolean): SurvivalObservation =>
  ({ durationT, eventObserved, recordedAtIso: '2026-01-01T00:00:00Z' });

// Klein/Moeschberger-style small set: events 2,3,5; censored 4,6. n=5.
// S: t=2→0.8, t=3→0.6, t=5→0.3. (events-before-censors tiebreak.)
const cohort = [obs(2, true), obs(3, true), obs(4, false), obs(5, true), obs(6, false)];

function wire(effects: number[] = []) {
  const meta = { indicatorKey: INDICATOR, conjugateHint: null, familyRef: FAMILY } as IndicatorMetadata;
  const evidence = new InMemoryEvidenceRepository();
  evidence.registerSurvivalObservations(TENANT, SUBJECT, INDICATOR, cohort);
  for (const logHr of effects) evidence.registerTreeEffect(TENANT, TREE, INDICATOR, logHr); // match the real API (see S2 spec)
  const adapter = new KaplanMeierAdapter({
    catalog: new InMemoryInferenceCatalog([meta]),
    evidence,
    distributionCatalog: new InMemoryDistributionCatalog(),
  });
  const input = { tenantPackId: TENANT, treeRoot: TREE, subject: { kind: 'individual', id: SUBJECT }, indicatorKey: INDICATOR } as PosteriorInput;
  return { adapter, input };
}

describe('KaplanMeierAdapter', () => {
  it('returns a SurvivalSummary(kind:survival) with cohort descriptors + the KM median (HR=1)', async () => {
    const { adapter, input } = wire();
    const res = await adapter.posterior(input);
    expect(res.ok).toBe(true);
    if (!res.ok || res.value.summary.kind !== 'survival') return;
    const s = res.value.summary;
    expect(s.parameterValues).toEqual({ n: 5, events: 3, censored: 2 });
    expect(s.appliedHazardRatio).toBe(1);
    // S crosses 0.5 first at the t=5 step (S=0.3<=0.5) → median 5; S(2)=0.8 first step <=0.75 is t=3 (0.6).
    expect(s.medianSurvival).toBe(5);
    expect(s.quantiles.find((q) => q.p === 0.25)!.t).toBe(3); // S<=0.75 first at t=3
  });

  it('applies a composed HR from ≥2 effects (Σ log-HR, exp) and lifts the curve when protective', async () => {
    const { adapter, input } = wire([Math.log(0.5), Math.log(0.8)]); // HR≈0.4
    const res = await adapter.posterior(input);
    expect(res.ok).toBe(true);
    if (!res.ok || res.value.summary.kind !== 'survival') return;
    expect(res.value.summary.appliedHazardRatio).toBeCloseTo(0.4, 6);
    // S_adj(5)=0.3^0.4 ≈ 0.618 > the raw 0.3
    expect(res.value.summary.survivalAtHorizons.some((h) => h.s > 0.3)).toBe(true);
  });

  it('errors (not throws) on an all-censored cohort (no events → empty KM curve)', async () => {
    const evidence = new InMemoryEvidenceRepository();
    evidence.registerSurvivalObservations(TENANT, SUBJECT, INDICATOR, cohort.map((o) => ({ ...o, eventObserved: false })));
    const adapter = new KaplanMeierAdapter({
      catalog: new InMemoryInferenceCatalog([{ indicatorKey: INDICATOR, conjugateHint: null, familyRef: FAMILY } as IndicatorMetadata]),
      evidence,
      distributionCatalog: new InMemoryDistributionCatalog(),
    });
    const res = await adapter.posterior({ tenantPackId: TENANT, treeRoot: TREE, subject: { kind: 'individual', id: SUBJECT }, indicatorKey: INDICATOR } as PosteriorInput);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.kind).toBe('cohort-too-small');
  });

  it('is reproducible — byte-identical SurvivalSummary across two runs', async () => {
    const a = await wire().adapter.posterior(wire().input);
    const b = await wire().adapter.posterior(wire().input);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(a.value.summary)).toBe(JSON.stringify(b.value.summary));
  });
});
```

> **CONFIRM:** the same wiring shapes as Task 1 (the survival-observation + tree-effect register API — match the S2 spec exactly). The median/quantile expected values above follow from the KM curve `S: t2=0.8, t3=0.6, t5=0.3` with the "first step whose `S <= target`" rule (median target 0.5 → first `S<=0.5` is t5; p=0.25 target 0.75 → first `S<=0.75` is t3). Re-derive if the curve differs.

- [ ] **Step 2: Run — expect FAIL.** Run: `npx vitest run libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.spec.ts`.
- [ ] **Step 3: Implement** `kaplan-meier.adapter.ts` per the skeleton + the KM builder above.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `feat(substrate-runtime): KaplanMeierAdapter (non-parametric product-limit → SurvivalSummary) (B3-S3)`.

---

## Task 3: Router dispatch for the two new survival families

**Files:**
- Modify: `libs/substrate-runtime/src/inference/inference-backbone-router.ts`
- Test: `libs/substrate-runtime/src/inference/inference-backbone-router.survival-families.spec.ts` (new)

The three survival adapters share an identical method surface, so the `kind:'survival'` DispatchTarget arm becomes a structural interface (the `posterior`/`counterfactual` dispatch switches stay byte-unchanged; only `dispatchForFamilyRef` grows two branches + `sample` grows two by-adapterId cases).

- [ ] **Step 1: Write the failing test:**

```typescript
import { describe, expect, it } from 'vitest';
// Build a router (or reuse the S2 router-survival spec's harness) with three indicators:
//   onc.weib  → familyRef survival.weibull-aft@1
//   onc.logl  → familyRef survival.loglogistic-aft@1
//   onc.km    → familyRef survival.kaplan-meier@1
// each with a registered survival cohort; assert posterior() routes to the right family.

describe('router survival familyRef dispatch (B3-S3)', () => {
  it('routes survival.loglogistic-aft@1 → a SurvivalSummary', async () => {
    // router.posterior(input for onc.logl) → ok; handle.summary.kind === 'survival';
    // handle.adapterId === 'loglogistic-aft-v1'.
  });
  it('routes survival.kaplan-meier@1 → a SurvivalSummary', async () => {
    // → ok; summary.kind === 'survival'; adapterId === 'kaplan-meier-v1';
    // parameterValues has n/events/censored (KM descriptors, no scale/shape).
  });
  it('still routes survival.weibull-aft@1 → the Weibull adapter (no regression)', async () => {
    // → ok; adapterId === 'weibull-aft-v1'; parameterValues has scale/shape.
  });
  it('an UNKNOWN survival family → typed validation-failed (no silent fallthrough)', async () => {
    // familyRef 'survival.gamma-aft@1' → err.kind === 'validation-failed', field 'familyRef'.
  });
  it('a conjugateHint indicator (no familyRef) still routes to the conjugate fast-path', async () => {
    // beta indicator → moment PosteriorSummary (no kind). Regression guard.
  });
});
```

> **CONFIRM:** read `inference-backbone-router.survival.spec.ts` (the S2 router-survival spec) for the EXACT router-construction harness (the router needs `INFERENCE_CATALOG`, `EVIDENCE_REPOSITORY`, `NUMPYRO_SIDECAR`=null, `MEMBER_RESOLUTION_PORT`, `DISTRIBUTION_CATALOG` — the S2 spec already constructs all of these; copy its `makeRouter(...)` helper + extend the catalog with the two new indicators).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — five precise edits to `inference-backbone-router.ts`:

  **(a) Imports** (beside the Weibull import :70):
  ```typescript
  import { LogLogisticAftAdapter, LOGLOGISTIC_AFT_ADAPTER_ID } from './adapters/loglogistic-aft.adapter.js';
  import { KaplanMeierAdapter, KAPLAN_MEIER_ADAPTER_ID } from './adapters/kaplan-meier.adapter.js';
  ```

  **(b) Family-name constants** (beside `WEIBULL_AFT_FAMILY_NAME` :79):
  ```typescript
  const LOGLOGISTIC_AFT_FAMILY_NAME = 'survival.loglogistic-aft';
  const KAPLAN_MEIER_FAMILY_NAME = 'survival.kaplan-meier';
  ```

  **(c) A structural survival-adapter type + the `DispatchTarget` arm** — replace the `{ kind: 'survival'; adapter: WeibullAftAdapter }` member (:90) so the arm holds any of the three (they share the surface the router calls). Add above the union:
  ```typescript
  /** The method surface the router invokes on ANY survival family adapter
   *  (Weibull / log-logistic / Kaplan-Meier all satisfy it structurally). */
  interface SurvivalPosteriorAdapter {
    posterior(input: PosteriorInput, opts?: RunOptions): Promise<Result<PosteriorHandle, InferenceErrorPhase1>>;
    counterfactual(): Promise<Result<unknown, InferenceErrorPhase1>>;
    sample(): Promise<Result<unknown, InferenceErrorPhase1>>;
  }
  ```
  and change the union member to:
  ```typescript
    | { kind: 'survival'; adapter: SurvivalPosteriorAdapter }
  ```
  (The `posterior` dispatch `case 'survival': return t.adapter.posterior(input, opts)` :180-181 and the `counterfactual` `case 'survival': return t.adapter.counterfactual() as …` :238-245 are UNCHANGED — the interface carries both methods.)

  **(d) The adapter fields + constructions** — beside `weibullAft` (field :129, construction :159-163):
  ```typescript
  // field declarations
  private readonly logLogisticAft: LogLogisticAftAdapter;
  private readonly kaplanMeier: KaplanMeierAdapter;
  // in the constructor body (same deps as weibullAft)
  this.logLogisticAft = new LogLogisticAftAdapter({
    catalog: this.catalog, evidence: this.evidence, distributionCatalog: this.distributionCatalog,
  });
  this.kaplanMeier = new KaplanMeierAdapter({
    catalog: this.catalog, evidence: this.evidence, distributionCatalog: this.distributionCatalog,
  });
  ```

  **(e) `dispatchForFamilyRef` branches** (:374, before the unknown-family `err`):
  ```typescript
  if (familyName === LOGLOGISTIC_AFT_FAMILY_NAME) {
    return { ok: true, value: { kind: 'survival', adapter: this.logLogisticAft } };
  }
  if (familyName === KAPLAN_MEIER_FAMILY_NAME) {
    return { ok: true, value: { kind: 'survival', adapter: this.kaplanMeier } };
  }
  ```

  **(f) `sample` by-adapterId cases** (:208, beside the `WEIBULL_AFT_ADAPTER_ID` case — survival forward sampling is a Phase-1 envelope `err`, so the cast is safe):
  ```typescript
  case LOGLOGISTIC_AFT_ADAPTER_ID:
    return this.logLogisticAft.sample() as Promise<Result<SampleResult, InferenceErrorPhase1>>;
  case KAPLAN_MEIER_ADAPTER_ID:
    return this.kaplanMeier.sample() as Promise<Result<SampleResult, InferenceErrorPhase1>>;
  ```

- [ ] **Step 4: Run — expect PASS** (incl. the conjugate-no-regression case + the unknown-family typed error). Then run the FULL inference suite to confirm no S2 regression: `npx vitest run libs/substrate-runtime/src/inference`.
- [ ] **Step 5: Commit** `feat(substrate-runtime): router familyRef dispatch for log-logistic + Kaplan-Meier survival families (B3-S3)`.

---

## Task 4: The three catalog seeds + in-memory default + the DB-free digest & recipe-versioning tests

**Files:**
- Modify: `libs/substrate-runtime/src/reproducibility/in-memory-distribution-catalog.ts`
- Test: `libs/substrate-runtime/src/reproducibility/survival-distribution-seeds.spec.ts` (new, DB-free)

- [ ] **Step 1: Write the failing test** (`survival-distribution-seeds.spec.ts`):

```typescript
import { describe, expect, it } from 'vitest';

import {
  InMemoryDistributionCatalog,
  NORMAL_DISTRIBUTION_SEED,
  WEIBULL_AFT_DISTRIBUTION_SEED,
  LOGLOGISTIC_AFT_DISTRIBUTION_SEED,
  KAPLAN_MEIER_DISTRIBUTION_SEED,
} from './in-memory-distribution-catalog.js';
import { distributionCatalogVersionHash } from './distribution-catalog-hash.js';

describe('survival distribution seeds (B3-S3)', () => {
  const ALL = [
    NORMAL_DISTRIBUTION_SEED,
    WEIBULL_AFT_DISTRIBUTION_SEED,
    LOGLOGISTIC_AFT_DISTRIBUTION_SEED,
    KAPLAN_MEIER_DISTRIBUTION_SEED,
  ];

  it('all three survival rows declare conjugateWith: [] (honest non-conjugate typing)', () => {
    for (const seed of [WEIBULL_AFT_DISTRIBUTION_SEED, LOGLOGISTIC_AFT_DISTRIBUTION_SEED, KAPLAN_MEIER_DISTRIBUTION_SEED]) {
      expect(seed.conjugateWith).toEqual([]);
    }
  });

  it('the survival row names are the pinned name@version refs', () => {
    expect(WEIBULL_AFT_DISTRIBUTION_SEED.name).toBe('survival.weibull-aft@1');
    expect(LOGLOGISTIC_AFT_DISTRIBUTION_SEED.name).toBe('survival.loglogistic-aft@1');
    expect(KAPLAN_MEIER_DISTRIBUTION_SEED.name).toBe('survival.kaplan-meier@1');
  });

  it('every fit-recipe scalar is a STRING (JSONB round-trip safety — no JSON float)', () => {
    const fit = (WEIBULL_AFT_DISTRIBUTION_SEED.parameterSchema as { fit: Record<string, unknown> }).fit;
    expect(typeof fit['tol']).toBe('string');
    expect(typeof fit['maxIter']).toBe('string');
  });

  it('the in-memory DEFAULT seed now carries normal + all three survival rows', async () => {
    const cat = new InMemoryDistributionCatalog(); // default
    expect((await cat.resolve('survival.weibull-aft@1')).ok).toBe(true);
    expect((await cat.resolve('survival.loglogistic-aft@1')).ok).toBe(true);
    expect((await cat.resolve('survival.kaplan-meier@1')).ok).toBe(true);
    expect((await cat.resolve('normal')).ok).toBe(true);
  });

  it('DIGEST: the default catalog hash == the pure helper over the four rows', async () => {
    const cat = new InMemoryDistributionCatalog();
    expect(await cat.catalogVersionHash()).toBe(distributionCatalogVersionHash(ALL));
  });

  it('RECIPE-VERSIONING: tightening fit.tol changes the catalogVersionHash (replay drift lever)', async () => {
    const base = await new InMemoryDistributionCatalog([WEIBULL_AFT_DISTRIBUTION_SEED]).catalogVersionHash();
    const tightened = {
      ...WEIBULL_AFT_DISTRIBUTION_SEED,
      parameterSchema: {
        ...WEIBULL_AFT_DISTRIBUTION_SEED.parameterSchema,
        fit: {
          ...(WEIBULL_AFT_DISTRIBUTION_SEED.parameterSchema as { fit: Record<string, unknown> }).fit,
          tol: '1e-12', // was 1e-10
        },
      },
    };
    const after = await new InMemoryDistributionCatalog([tightened]).catalogVersionHash();
    expect(after).not.toBe(base);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (seeds not exported).

- [ ] **Step 3: Implement** — in `in-memory-distribution-catalog.ts`, add the three seeds (beside `NORMAL_DISTRIBUTION_SEED`) and extend the constructor default. **Every `fit` scalar is a string** (§ JSONB round-trip safety):

```typescript
export const WEIBULL_AFT_DISTRIBUTION_SEED: DistributionEntry = {
  name: 'survival.weibull-aft@1',
  pdfRef: 'kernel.dist.survival.weibull-aft',
  cdfRef: 'kernel.dist.survival.weibull-aft.cdf',
  sampleRef: 'kernel.dist.survival.weibull-aft.sample',
  parameterSchema: {
    scale: { type: 'number', minimum: 0 },
    shape: { type: 'number', minimum: 0 },
    fit: {
      method: 'newton-raphson-profile-shape',
      init: { shape: '1' },
      tol: '1e-10',
      maxIter: '100',
      order: 'durationT asc, eventObserved asc, entryT asc',
    },
  },
  conjugateWith: [],
};

export const LOGLOGISTIC_AFT_DISTRIBUTION_SEED: DistributionEntry = {
  name: 'survival.loglogistic-aft@1',
  pdfRef: 'kernel.dist.survival.loglogistic-aft',
  cdfRef: 'kernel.dist.survival.loglogistic-aft.cdf',
  sampleRef: 'kernel.dist.survival.loglogistic-aft.sample',
  parameterSchema: {
    scale: { type: 'number', minimum: 0 },
    shape: { type: 'number', minimum: 0 },
    fit: {
      method: 'newton-raphson-2d-logistic',
      init: { locationSeed: 'mean-ln-t-over-events', s: '1' },
      tol: '1e-10',
      maxIter: '100',
      order: 'durationT asc, eventObserved asc, entryT asc',
    },
  },
  conjugateWith: [],
};

export const KAPLAN_MEIER_DISTRIBUTION_SEED: DistributionEntry = {
  name: 'survival.kaplan-meier@1',
  pdfRef: 'kernel.dist.survival.kaplan-meier.step',
  cdfRef: 'kernel.dist.survival.kaplan-meier.cdf',
  sampleRef: 'kernel.dist.survival.kaplan-meier.sample',
  parameterSchema: {
    estimator: { const: 'product-limit' },
    fit: {
      method: 'product-limit',
      tieBreaking: 'events-before-censors',
      order: 'durationT asc, eventObserved desc',
    },
  },
  conjugateWith: [],
};
```

Change the constructor default (`:50`) to seed all four:
```typescript
constructor(
  initial: readonly DistributionEntry[] = [
    NORMAL_DISTRIBUTION_SEED,
    WEIBULL_AFT_DISTRIBUTION_SEED,
    LOGLOGISTIC_AFT_DISTRIBUTION_SEED,
    KAPLAN_MEIER_DISTRIBUTION_SEED,
  ],
) {
  for (const e of initial) this.entries.set(e.name, e);
}
```

- [ ] **Step 4: Run — expect PASS.** Then run the FULL reproducibility + inference suites to catch any pinned-hash regression from the default-seed change: `npx vitest run libs/substrate-runtime/src/reproducibility libs/substrate-runtime/src/inference`. (S2 reproducibility tests assert run-to-run determinism, not pinned literals, so they should pass — but CONFIRM none assert a literal `catalogVersionHash`; if one does, it was pinned to the Normal-only state and must update.)
- [ ] **Step 5: Commit** `feat(substrate-runtime): three survival distribution_catalog seeds + in-memory default + digest/recipe tests (B3-S3)`.

---

## Task 5: Forward Prisma migration + the DB-gated in-memory↔Prisma digest proof

**Files:**
- Create: `prisma/migrations/20260609000000_kernel_b3_survival_catalog_rows/migration.sql`
- Test: `libs/substrate-runtime/src/reproducibility/prisma-survival-catalog.contract.spec.ts` (new, DB-gated)

> **Migration-JSON-matches-seed-object discipline (load-bearing):** the `parameter_schema` JSONB literal in each INSERT must be the EXACT canonical JSON of the corresponding seed object's `parameterSchema` (same keys, same string values). Derive it by `JSON.stringify`-ing the seed object (keys sorted is fine — the hash canonicalizes), then transcribe. The DB digest test below CATCHES any divergence (different JSON → different hash → fail).

- [ ] **Step 1: Write the migration** `migration.sql` (mirrors the WS-9 Normal INSERT; append-only, idempotent; NO schema change — the table + the `app` GRANT already exist from WS-9):

```sql
-- B3-S3 (ADR-223): register the three survival/time-to-event families as
-- append-only kernel.distribution_catalog rows. conjugate_with='[]' — survival
-- is explicitly NON-conjugate (the router never mistakes it for a fast-path).
-- The fit recipe is pinned in parameter_schema (all-STRING scalars so the JS↔JSONB
-- catalogVersionHash round-trips byte-identically). Idempotent (ON CONFLICT DO
-- NOTHING) so re-applying / re-seeding is safe. No schema bump — registry INSERTs
-- (ADR-127 invariant 4), same posture as the WS-9 Normal seed.
INSERT INTO "kernel"."distribution_catalog"
  ("name", "pdf_ref", "cdf_ref", "sample_ref", "parameter_schema", "conjugate_with", "registered_by")
VALUES
  ('survival.weibull-aft@1',
   'kernel.dist.survival.weibull-aft', 'kernel.dist.survival.weibull-aft.cdf', 'kernel.dist.survival.weibull-aft.sample',
   '{"scale":{"type":"number","minimum":0},"shape":{"type":"number","minimum":0},"fit":{"method":"newton-raphson-profile-shape","init":{"shape":"1"},"tol":"1e-10","maxIter":"100","order":"durationT asc, eventObserved asc, entryT asc"}}'::jsonb,
   '[]'::jsonb, 'kernel'),
  ('survival.loglogistic-aft@1',
   'kernel.dist.survival.loglogistic-aft', 'kernel.dist.survival.loglogistic-aft.cdf', 'kernel.dist.survival.loglogistic-aft.sample',
   '{"scale":{"type":"number","minimum":0},"shape":{"type":"number","minimum":0},"fit":{"method":"newton-raphson-2d-logistic","init":{"locationSeed":"mean-ln-t-over-events","s":"1"},"tol":"1e-10","maxIter":"100","order":"durationT asc, eventObserved asc, entryT asc"}}'::jsonb,
   '[]'::jsonb, 'kernel'),
  ('survival.kaplan-meier@1',
   'kernel.dist.survival.kaplan-meier.step', 'kernel.dist.survival.kaplan-meier.cdf', 'kernel.dist.survival.kaplan-meier.sample',
   '{"estimator":{"const":"product-limit"},"fit":{"method":"product-limit","tieBreaking":"events-before-censors","order":"durationT asc, eventObserved desc"}}'::jsonb,
   '[]'::jsonb, 'kernel')
ON CONFLICT ("name") DO NOTHING;
```

> **CONFIRM the migration applies:** the table + the `app` GRANT (`GRANT SELECT, INSERT … TO app`) are already in the WS-9 migration, so this migration is INSERTs only. If `db:setup` does NOT auto-discover hand-authored migrations, add the folder to wherever the migration list is registered (check `tools/db/setup.mjs` — the WS-9 migration is hand-authored, so the path is already supported). The folder timestamp `20260609000000` sorts AFTER the WS-9 `20260607000000`.

- [ ] **Step 2: Write the DB-gated digest-proof test** (`prisma-survival-catalog.contract.spec.ts`):

```typescript
// Hexagonal layer: scope:out-adapter (ADR-110). DB-gated (SUBSTRATE_DATABASE_URL),
// mirrors prisma-reproducibility.contract.spec.ts. Proves the three survival rows
// hash BYTE-IDENTICALLY across the in-memory seed objects and the Prisma adapter
// (WS-9 A-3 substitutability over the survival corpus).
//
//   SUBSTRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/substrate \
//     npx vitest run libs/substrate-runtime/src/reproducibility/prisma-survival-catalog.contract.spec.ts

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  InMemoryDistributionCatalog,
  NORMAL_DISTRIBUTION_SEED,
  WEIBULL_AFT_DISTRIBUTION_SEED,
  LOGLOGISTIC_AFT_DISTRIBUTION_SEED,
  KAPLAN_MEIER_DISTRIBUTION_SEED,
} from './in-memory-distribution-catalog.js';
import { distributionCatalogVersionHash } from './distribution-catalog-hash.js';
import {
  PrismaDistributionCatalog,
  type DistributionCatalogPrismaLike,
} from './prisma-distribution-catalog.js';

const DB_URL = process.env['SUBSTRATE_DATABASE_URL'];
const ALL = [
  NORMAL_DISTRIBUTION_SEED,
  WEIBULL_AFT_DISTRIBUTION_SEED,
  LOGLOGISTIC_AFT_DISTRIBUTION_SEED,
  KAPLAN_MEIER_DISTRIBUTION_SEED,
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let prisma: any;

describe.skipIf(!DB_URL)('PrismaDistributionCatalog — survival rows digest (B3-S3)', () => {
  beforeAll(async () => {
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
    try {
      await prisma.$executeRawUnsafe("DELETE FROM kernel.distribution_catalog WHERE name <> 'normal'");
    } catch { /* ignore */ }
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Seed EXACTLY the four rows via the adapter (proves the Prisma adapter
    // round-trips the seed OBJECTS byte-identically — the digest property).
    await prisma.$executeRawUnsafe('TRUNCATE kernel.distribution_catalog');
    const cat = new PrismaDistributionCatalog(prisma as DistributionCatalogPrismaLike);
    for (const e of ALL) await cat.register(e);
  });

  it('Prisma catalogVersionHash == in-memory default == pure helper (byte-identical)', async () => {
    const prismaCat = new PrismaDistributionCatalog(prisma as DistributionCatalogPrismaLike);
    const prismaHash = await prismaCat.catalogVersionHash();
    expect(prismaHash).toBe(await new InMemoryDistributionCatalog().catalogVersionHash());
    expect(prismaHash).toBe(distributionCatalogVersionHash(ALL));
  });

  it('the migration seeds all three survival rows (presence check)', async () => {
    // After db:setup applies the migration, the names exist. (This case re-seeds
    // via beforeEach; the presence assertion guards the migration is discoverable
    // + the names match the contract.)
    const prismaCat = new PrismaDistributionCatalog(prisma as DistributionCatalogPrismaLike);
    for (const name of ['survival.weibull-aft@1', 'survival.loglogistic-aft@1', 'survival.kaplan-meier@1']) {
      expect((await prismaCat.resolve(name)).ok).toBe(true);
    }
  });
});
```

- [ ] **Step 3: Run the DB gate.** Bring the DB up + apply migrations, then run the DB-gated spec:
  ```bash
  npm run db:setup   # applies migrations incl. the new survival-rows migration
  SUBSTRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/substrate \
    npx vitest run libs/substrate-runtime/src/reproducibility/prisma-survival-catalog.contract.spec.ts
  ```
  Expected: PASS (byte-identical hash). If the digest FAILS, the migration JSONB diverged from the seed object — diff the canonical JSON of each (the most likely culprit is a stray JSON number where a string is required, or a key typo).
- [ ] **Step 4: Commit** `feat(substrate): forward migration for the three survival distribution_catalog rows + DB-gated digest proof (B3-S3)`.

---

## Task 6: Full gate + PR + verifier wave

- [ ] **Step 1: Full DB-free gate** — `npm run ci:local` green (build + lint + the full test suite across both libs — confirm NO conjugate/replay/router regression from the default-seed change + the router edits). Report counts.
- [ ] **Step 2: Full DB gate** — `npm run ci:local:db` (or the explicit Task-5 command) green — the survival digest proof + the existing WS-9 Prisma contract specs.
- [ ] **Step 3: PR** — push + open. Body:
  - `Tech design:` the S3/S3.5 design delta (`docs/superpowers/specs/2026-06-09-b3-s3-survival-adapters-catalog-design.md`) + ADR-223 + the decomposition + this plan.
  - Scope: S3 = log-logistic + KM adapters + router dispatch + three `distribution_catalog` rows (in-memory seeds + forward migration, `conjugate_with='[]'`, string-token fit recipe) + the byte-identical in-memory↔Prisma digest proof + the fit-recipe-versioning test. **No production read / no projection widen / no contracts change / no publish** (that's S3.5; the family is end-to-end usable post-S4/S5). The conjugate + Weibull paths are regression-proven.
  - `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`
  - `Effort: deep` (wave + a designer-first spec — the S3/S3.5 design delta; per the workbench `CLAUDE.md` effort table).
  - `Effect: cycle-time 0.01±0.02 expert` · `Effect: findings 2±2 expert` (self-observing; declare only these on a substrate cross-repo PR — Sonar metrics need a per-merge scan).
  - "Part of B3 (ADR-223) / the oncology program."
- [ ] **Step 4: Verifier wave** — `local-ci` (or my `ci:local` evidence) + `reviewer` + `charter-checker` (kernel minimality — confirm: zero new tables, three append-only rows, `ConjugateHint` unchanged, the router gains a dispatch branch + two adapters, the family is the *menu* growing not the *concern set*; the ADR-176 verdict in ADR-223 holds) + `qa-engineer` (the KM non-parametric mapping correctness, the log-HR ≥2-effect composition, the string-token JSONB round-trip → byte-identical digest, the conjugate/Weibull no-regression). Auto-merge on green (`gh pr merge --squash --admin`, freeze-merge policy). Twin ritual after merge: `drain substrate#<pr>` → `backfill de-braighter/substrate` → `reconcile substrate#<pr>`. Update the oncology memory with the S3 shipped state + the S3.5 pickup.

---

## Self-Review (plan author)

**Spec coverage (design delta §5 — the S3 scope):** LogLogisticAftAdapter → Task 1; KaplanMeierAdapter (the §4 non-parametric mapping) → Task 2; router familyRef dispatch for both → Task 3; the three in-memory seeds + default extension → Task 4; the forward migration → Task 5; the in-memory↔Prisma digest proof → Tasks 4 (DB-free) + 5 (DB-gated); the fit-recipe-versioning test (tighten tol → hash changes) → Task 4. The §3.1 all-string fit recipe (JSONB round-trip safety) → Tasks 4 + 5 (the seeds + the migration JSONB + the typeof-string test). **Out of scope (S3.5), correctly absent:** the projection widen, the real Prisma read, any contracts change, any publish.

**Placeholder scan:** Tasks 2–5 ship concrete code (the KM builder, the router edits, the seeds, the migration SQL, the DB test). Task 1 is recipe-over-precedent (copy `weibull-aft.adapter.ts` + six exact substitutions) — the FULL test (the correctness pin, incl. the mandatory heavy-censoring + adversarial-ignore-censoring + ≥2-effect assertions) is concrete. The three CONFIRM points (the in-memory evidence register API names; the router-construction harness; whether `db:setup` auto-discovers the migration) are explicit reads of the S2 specs / `tools/db/setup.mjs`, NOT placeholders — they pin where to copy from rather than risk transcribing a signature blind.

**Type consistency:** `LOGLOGISTIC_AFT_ADAPTER_ID` (Task 1) + `KAPLAN_MEIER_ADAPTER_ID` (Task 2) imported by the router (Task 3 sample cases). `LogLogisticAftAdapter`/`KaplanMeierAdapter` (Tasks 1/2) constructed + dispatched by the router (Task 3) under the `SurvivalPosteriorAdapter` interface (all three adapters' `posterior`/`counterfactual`/`sample` satisfy it). The three `*_DISTRIBUTION_SEED` constants (Task 4) consumed by the DB digest test (Task 5) + the in-memory default. `DistributionEntry {name,pdfRef,cdfRef,sampleRef,parameterSchema,conjugateWith}` shape used in every seed. `SurvivalSummary {kind,familyRef,parameterValues,survivalAtHorizons,medianSurvival,quantiles,hazardAtHorizon,appliedHazardRatio}` returned by both new adapters (Tasks 1/2) — KM fills `parameterValues` with `{n,events,censored}`, the parametric adapters with `{scale,shape}`. `fitLogLogisticAft`/`loglogisticQuantile`/`loglogisticSurvival`/`loglogisticHazard` (S1) in Task 1; `kaplanMeier`/`KmCurve`/`KmStep` (S1) in Task 2.
