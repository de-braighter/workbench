# B3-S2 — Weibull Adapter + Router Family-Ref Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Build with the `substrate-coder-pro` agent. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Wire the survival family into the inference request path (in-memory only): a `WeibullAftAdapter` that fits a survival cohort + applies the composed hazard ratio → a `SurvivalSummary`, dispatched by a new `familyRef`-precedence branch in the router, fed by a new `EvidenceRepository.findSurvivalObservations`. `posterior()` over a `familyRef` indicator returns a `SurvivalSummary` end-to-end; conjugate paths stay regression-proven.

**Architecture:** Mirror the `NormalNormalFastPathAdapter` skeleton exactly (constructor-injected `DistributionCatalog`, `resolveCatalogVersionHash`, `buildManifest`, `materializeHandle`, `handleIdFor`/`stableSeed`/`sha256Hex`). The router resolves a `familyRef` (present on indicator metadata) BEFORE `conjugateHint`; both absent → the unchanged sidecar deferral. Survival effects compose via the existing `sum`-over-normals log-HR path (no `composeEffects` change). No DB/catalog-row/migration (S3) — uses the in-memory evidence double + the S1 math (`fitWeibullAft` + `weibullSurvival/Hazard/Quantile`).

**Tech Stack:** TypeScript (ESM `.js`), Vitest, NestJS (runtime DI). Repo: `layers/substrate` (`@de-braighter/substrate-runtime`). Builds on S1 (contracts + math, merged to main, substrate 1.2.0).

**Repo + branch:** from `layers/substrate`, `git fetch origin && git checkout -b feat/b3-s2-weibull-adapter-router origin/main` (S1 is on main; the survival contracts + math are available).

**Conventions:** ESM `.js` imports; survival types via the `@de-braighter/substrate-contracts/inference` SUBPATH (the S1 gotcha — root index doesn't re-export the inference barrel); `Result<T,E>` at the port boundary (the router/adapter return `Promise<Result<…, InferenceErrorPhase1>>`); plain-Symbol DI. The DB-gated specs skip in `ci:local` (no DB surface in S2). One commit per task; TDD. Do NOT bump the version or publish (S2–S4 are runtime-internal until the family is end-to-end usable; a coordinated publish lands after S4/S5).

**READ FIRST (the precedents to mirror — absolute paths):**
- `libs/substrate-runtime/src/inference/adapters/normal-normal-fast-path.adapter.ts` — THE adapter skeleton (`resolveCatalogVersionHash` ~:110, `buildManifest` ~:449, `materializeHandle` ~:414, `handleIdFor`/`stableSeed`/`sha256Hex` ~:481, the constructor injecting `DistributionCatalog` ~:103, the `makeRng(seed::handleId)` sample path ~:210).
- `libs/substrate-runtime/src/inference/inference-backbone-router.ts` — `resolveTarget` (~:253, reads `meta.conjugateHint` ~:280), `dispatchForHint` (~:286), the `DispatchTarget` union (~:74), `CachedHint` (~:80), the `hintCache` key `${indicatorKey}::${catalogVersionHash}` (~:263), the constructor injecting adapters + `DistributionCatalog` (~:103).
- `libs/substrate-runtime/src/inference/inference-catalog.port.ts` — `IndicatorMetadata` (~:29-67, where `conjugateHint` lives → `familyRef` joins beside it), `EvidenceRepository` (`findObservations` ~:143, `findNormalObservations` ~:157, `findEffectsForTree` ~:168 → `findSurvivalObservations` joins), `ObservationReading`/`NormalObservationReading` (~:83-100 → the runtime `SurvivalObservation` reading sits beside; reuse the S1 contract type), `EffectDeclaration.magnitudePrior` (~:107-132, the flat-scalar magnitude).
- `libs/substrate-runtime/src/inference/in-memory-inference-catalog.ts` — `InMemoryEvidenceRepository` (`registerNormalObservations` ~:106, `findNormalObservations` ~:183 → add survival analogues), `InMemoryInferenceCatalog.catalogVersionHash()` (~:42-56 — add `familyRef` to the hashed projection).
- S1 outputs (on main): `math/weibull-aft.ts` (`fitWeibullAft`, `weibullSurvival`, `weibullHazard`, `weibullQuantile`, `weibullMedian`), the contracts `SurvivalObservation`/`SurvivalSummary`/`InferenceFamilyRef` on the `/inference` subpath.

---

## Task 1: `familyRef` on `IndicatorMetadata` + `findSurvivalObservations` on the EvidenceRepository (+ in-memory)

**Files:**
- Modify: `libs/substrate-runtime/src/inference/inference-catalog.port.ts`
- Modify: `libs/substrate-runtime/src/inference/in-memory-inference-catalog.ts`
- Test: `libs/substrate-runtime/src/inference/in-memory-inference-catalog.survival.spec.ts` (new)

- [ ] **Step 1: Write the failing test** — register survival observations + an indicator carrying a `familyRef`, read them back, and assert `catalogVersionHash` changes when `familyRef` changes:

```typescript
import { describe, expect, it } from 'vitest';
import { InMemoryInferenceCatalog, InMemoryEvidenceRepository } from './in-memory-inference-catalog.js';
import type { InferenceFamilyRef, SurvivalObservation } from '@de-braighter/substrate-contracts/inference';

const TENANT = 'tenant-a';
const obs = (durationT: number, eventObserved: boolean): SurvivalObservation =>
  ({ durationT, eventObserved, recordedAtIso: '2026-01-01T00:00:00Z' });

describe('InMemoryEvidenceRepository survival observations', () => {
  it('registers + reads back survival observations scoped by (tenant, subject, indicator)', async () => {
    const repo = new InMemoryEvidenceRepository();
    repo.registerSurvivalObservations(TENANT, 'subj-1', 'onc.recurrence', [obs(5, true), obs(8, false)]);
    const got = await repo.findSurvivalObservations(TENANT, 'subj-1', 'onc.recurrence');
    expect(got.map((o) => [o.durationT, o.eventObserved])).toEqual([[5, true], [8, false]]);
  });

  it('returns empty for an unregistered (tenant, subject, indicator)', async () => {
    const repo = new InMemoryEvidenceRepository();
    expect(await repo.findSurvivalObservations(TENANT, 'nobody', 'onc.recurrence')).toEqual([]);
  });
});

describe('InMemoryInferenceCatalog.catalogVersionHash includes familyRef', () => {
  it('changes the hash when an indicator gains a familyRef (so router dispatch busts the cache)', () => {
    const base = new InMemoryInferenceCatalog([
      { indicatorKey: 'onc.recurrence', /* …minimal metadata, no familyRef… */ } as never,
    ]);
    const withFamily = new InMemoryInferenceCatalog([
      { indicatorKey: 'onc.recurrence', familyRef: 'survival.weibull-aft@1' as InferenceFamilyRef } as never,
    ]);
    expect(withFamily.catalogVersionHash()).not.toBe(base.catalogVersionHash());
  });
});
```

(Adjust the minimal-metadata shape to the real `IndicatorMetadata` required fields — read the port.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — in `inference-catalog.port.ts`: add `readonly familyRef?: InferenceFamilyRef;` to `IndicatorMetadata` (beside `conjugateHint`, import from the `/inference` subpath); add to `EvidenceRepository`:

```typescript
/** Right-censored time-to-event observations for a survival-family indicator (ADR-223 B3). Tenant-first per ADR-205. */
findSurvivalObservations(
  tenantPackId: string,
  subjectId: string,
  indicatorKey: string,
  asOfIso?: string,
): Promise<readonly SurvivalObservation[]>;
```

In `in-memory-inference-catalog.ts`: mirror `registerNormalObservations`/`findNormalObservations` for survival (a `Map` keyed `${tenant}::${subject}::${indicator}`, asOf filter on `recordedAtIso` like the normal path); add `familyRef` to the `catalogVersionHash()` hashed projection (so a familyRef change invalidates the router's `hintCache`).

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit** `feat(substrate-runtime): familyRef metadata + findSurvivalObservations (in-memory) (B3-S2)`.

---

## Task 2: `WeibullAftAdapter` — fit + compose log-HR → `SurvivalSummary`

**Files:**
- Create: `libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.ts`
- Test: `libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.spec.ts`

The adapter mirrors `NormalNormalFastPathAdapter`: constructor `(catalog: DistributionCatalog, evidence: EvidenceRepository, ...)` per the normal adapter's deps; a `posterior(input, meta, opts)`-shaped method the router calls. Behavior:
1. `findSurvivalObservations(tenantPackId, subject, indicatorKey, asOf)` → `SurvivalObservation[]`.
2. `fitWeibullAft(observations)` → `{scale, shape, converged}` (S1 math). If `!converged` → `Result.err` with an `InferenceErrorPhase1` `'insufficient-evidence'`-style code (match the normal adapter's error vocabulary).
3. **Compose the hazard ratio** from the tree's survival effects: read the `EffectDeclaration`s for the tree (`findEffectsForTree`), each survival effect's `magnitudePrior` is a **log-HR** (the flat-scalar runtime convention — a `normal`-mean in log-space); **sum the log-HRs** (the existing `sum`-over-normals semantics — just add the scalar means for the request-path point estimate), `appliedHazardRatio = exp(Σ logHR)`. Baseline (no survival effects) → `appliedHazardRatio = 1`.
4. **Apply the HR** as a hazard multiplier on the fitted baseline: `S_adj(t) = S_base(t)^appliedHazardRatio` (the proportional-hazards relation). Build the `SurvivalSummary`: `familyRef` (from meta), `parameterValues:{scale,shape}`, `survivalAtHorizons` (S_adj at a small set of horizons — use the indicator metadata's horizons if present, else a default like the fitted median + 2×median), `medianSurvival` (the t where S_adj=0.5 — solve via `weibullQuantile` adjusted for HR: `S_adj(t)=0.5` ⇒ `S_base(t)=0.5^(1/HR)` ⇒ `t = weibullQuantile(1 − 0.5^(1/HR), scale, shape)`), `quantiles` (p25/p75 similarly), `hazardAtHorizon` (`weibullHazard × HR` at a horizon), `appliedHazardRatio`.
5. `materializeHandle` + `buildManifest` exactly as the normal adapter (the `RunManifest` pins seed/engineVersion/catalogVersionHash/inputHash/observationsHash). The `summary` on the handle is the `SurvivalSummary` (the S1 widen).

- [ ] **Step 1: Write the failing test** (against the in-memory evidence double + an in-memory catalog):

```typescript
import { describe, expect, it } from 'vitest';
// construct: InMemoryEvidenceRepository with a Weibull-ish survival cohort under (tenant, subject, indicator);
// an InMemoryDistributionCatalog; a WeibullAftAdapter; call posterior(...) for the indicator.

describe('WeibullAftAdapter', () => {
  it('fits the cohort + returns a SurvivalSummary (kind:survival) with the fitted params', async () => {
    // seed a Weibull(10,1.5)-ish censored cohort; posterior() → ok; summary.kind === 'survival';
    // summary.parameterValues.scale ∈ (9,11); summary.survivalAtHorizons monotone-decreasing; appliedHazardRatio === 1 (no effects).
  });

  it('applies a composed hazard ratio: a protective log-HR (<0) raises S(t) vs baseline', async () => {
    // same cohort + a tree survival effect magnitudePrior = ln(0.5) (HR 0.5, protective);
    // assert appliedHazardRatio ≈ 0.5 and S_adj(median_base) > 0.5 (curve lifted) — S_adj(t)=S_base(t)^0.5.
  });

  it('errors (not throws) when the fit does not converge (all-censored)', async () => {
    // all-censored cohort → Result.err with the adapter's non-convergence code.
  });

  it('is reproducible — same inputs produce a byte-identical SurvivalSummary + the same RunManifest catalogVersionHash', async () => {
    // two posterior() calls → identical canonical-JSON summary (the determinism rides S1's bit-identical fit).
  });
});
```

(Flesh out against the real adapter/router call shape — read `normal-normal-fast-path.adapter.ts` for the exact `posterior` signature + how the router invokes it.)

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** `weibull-aft.adapter.ts` per the behavior above (mirror the normal adapter's structure verbatim; the survival-specific part is the fit + the log-HR composition + the `S(t)^HR` application + the `SurvivalSummary` materialization).
- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit** `feat(substrate-runtime): WeibullAftAdapter (fit + log-HR compose → SurvivalSummary) (B3-S2)`.

---

## Task 3: Router `familyRef`-precedence dispatch

**Files:**
- Modify: `libs/substrate-runtime/src/inference/inference-backbone-router.ts`
- Test: `libs/substrate-runtime/src/inference/inference-backbone-router.survival.spec.ts` (new)

- [ ] **Step 1: Write the failing test:**

```typescript
describe('router familyRef dispatch precedence', () => {
  it('routes an indicator with familyRef to the survival adapter (returns a SurvivalSummary)', async () => {
    // catalog: indicator 'onc.recurrence' with familyRef 'survival.weibull-aft@1'; evidence: survival cohort.
    // router.posterior(...) → ok; handle.summary.kind === 'survival'.
  });
  it('still routes a conjugateHint indicator to the conjugate fast-path (no regression)', async () => {
    // an indicator with conjugateHint 'beta' + NO familyRef → moment PosteriorSummary (no kind). 
  });
  it('familyRef wins when BOTH are present (precedence)', async () => {
    // indicator with both familyRef AND conjugateHint → survival adapter (familyRef precedence).
  });
  it('both absent → the unchanged sidecar deferral path (unchanged error/behavior)', async () => {
    // neither → the existing both-absent path; assert it is unchanged.
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — in `resolveTarget` (before the `meta.conjugateHint` read ~:280): if `meta.familyRef` is present, resolve to a new `DispatchTarget` member `{ kind: 'survival'; adapter: WeibullAftAdapter }` (the `familyRef` selects the family — for S2 only `survival.weibull-aft@*` exists; an unknown familyRef → a typed error, NOT a silent fallthrough). Add the survival case to `dispatchForHint` (or the equivalent dispatch site). Inject the `WeibullAftAdapter` into the router constructor (mirror how `normalNormal` is injected ~:103-126). The `hintCache` key already includes `catalogVersionHash` (Task 1 added `familyRef` to it) so a familyRef change busts the cache. Keep the conjugate + both-absent paths byte-unchanged.
- [ ] **Step 4: Run — expect PASS** (incl. the conjugate-no-regression case). **Step 5: Commit** `feat(substrate-runtime): router familyRef-precedence dispatch to the survival adapter (B3-S2)`.

---

## Task 4: Composition-root wiring + full gate + PR

**Files:**
- Modify: `libs/substrate-runtime/src/composition-root/substrate.module.ts` (only if the router's new adapter dep needs a module-level construction — per the architect map the survival adapters are constructed INSIDE the router like `normalNormal`, so this may be a no-op; verify).

- [ ] **Step 1:** Verify the `WeibullAftAdapter` is constructed inside `InferenceBackboneRouter` (mirroring `normalNormal` at ~:115) — if so, NO module change needed (it just needs the `DistributionCatalog` + `EvidenceRepository` the router already has). If a module binding is needed, add it mirroring the existing inference bindings.
- [ ] **Step 2: Full gate** — `npm run ci:local` (DB-free) green (the new survival specs + the router-dispatch specs + the full existing suite — confirm NO conjugate/replay regression from the router change). Report counts.
- [ ] **Step 3: PR** — push + open. Body: `Tech design:` the decomposition + ADR-223 + the S1/S2 plans; note S2 = adapter + router dispatch (in-memory; no DB/catalog/migration — S3; no publish — runtime-internal until the family is end-to-end usable post-S4/S5); the conjugate paths are regression-proven. `Producer:`/`Effect:`. "Part of B3 (ADR-223)."
- [ ] **Step 4: Verifier wave** — `local-ci` (or my `ci:local`) + `reviewer` + `charter-checker` (kernel minimality — the router gains a dispatch branch + the adapter, no new concern/table; the family is the menu growing) + `qa-engineer` (the log-HR composition correctness, the `S(t)^HR` application, the reproducibility, the conjugate-no-regression). Auto-merge on green; twin ritual (`drain`/`backfill de-braighter/substrate`/`reconcile`).

---

## Self-Review (plan author)

**Spec coverage (decomposition §3 S2):** `WeibullAftAdapter` consuming `SurvivalObservation[]` + composed log-HR → `SurvivalSummary` → Task 2; router familyRef-precedence branch → Task 3; `findSurvivalObservations` + in-memory register → Task 1; `familyRef` in `catalogVersionHash` projection → Task 1; the `familyRef`-on-IndicatorMetadata runtime field (decomposition §4.1 — runtime port, not Ring-0) → Task 1. The log-HR via the existing `sum`-over-normals flat-scalar convention (decomposition §4.2, no `composeEffects` change) → Task 2 step 3. No DB/catalog/migration (S3), no publish (deferred) — stated.

**Placeholder scan:** Tasks 1 + 3 ship concrete code/recipes with exact insertion points (the architect's line refs). Task 2 (the adapter) is recipe-over-precedent ("mirror normal-normal-fast-path.adapter.ts") with the FULL survival-specific behavior spelled out (the fit, the log-HR sum → exp → `appliedHazardRatio`, the `S_adj(t)=S_base(t)^HR` relation, the `medianSurvival = weibullQuantile(1−0.5^(1/HR),…)` derivation, the SurvivalSummary fields) + the test oracles (fitted params in band, HR lifts the curve, non-convergence errors, reproducible). The test bodies are sketched against "the real adapter/router call shape — read the precedent" because the exact `posterior` signature must match `normal-normal-fast-path.adapter.ts` verbatim (transcribing it blind would risk drift); the behavior + oracles are explicit. Two CONFIRM points: the exact adapter `posterior` signature + whether the module needs a binding (Task 4 step 1).

**Type consistency:** `findSurvivalObservations` (Task 1) consumed by the adapter (Task 2). `familyRef` on `IndicatorMetadata` (Task 1) read by the router (Task 3). `WeibullAftAdapter` (Task 2) injected into the router (Task 3) + constructed per the normal-normal precedent (Task 4). `SurvivalObservation`/`SurvivalSummary`/`InferenceFamilyRef` from the `/inference` subpath (S1). `fitWeibullAft`/`weibullSurvival`/`weibullHazard`/`weibullQuantile` from S1 math.
