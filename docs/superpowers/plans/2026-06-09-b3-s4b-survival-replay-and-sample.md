# B3-S4b — Survival Replay Proof + `sample()` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the survival family replays bit-for-bit through the *real* S4a production persist path, and implement the three deferred survival `sample()` impls (Weibull / log-logistic parametric inverse-CDF + Kaplan-Meier empirical-inverse), seed-pinned for reproducibility.

**Architecture:** S4b consumes the S4a mechanism — it adds **no kernel contract** (ADR-223 §6: "no new contract"), **no publish** (stays `1.2.0` unpublished). Two concerns: (1) a **test-only replay proof** mirroring `run-manifest-persistence.proof.spec.ts` for survival — the survival adapters already build a replayable `RunManifest` and the S4a recorder fires family-agnostically at the router choke point, so the survival posterior already flows router → adapter (fits MLE) → recorder (persists `run_manifest` `kind:'survival'`) → `ReplayService.replay()` (re-fits, bit-identical); (2) the **`sample()` production code** — currently Phase-1 `err` envelopes on all three survival adapters — replaced with forward event-time simulation by inverse-CDF, seed-pinned via `makeRng(`${seed}::${handleId}`)` exactly as the Normal sample path.

**Tech Stack:** TypeScript (ESM, explicit `.js` imports), NestJS runtime (`@de-braighter/substrate-runtime`), Vitest (vitest4 executor — run via `npx vitest run <file>`, NOT `nx test`), the existing survival math (`weibull-aft.ts` / `loglogistic-aft.ts` / `kaplan-meier.ts`), `makeRng` (`inference/math/beta-binomial.ts`).

**Repo:** `layers/substrate` (kernel). Cut the branch off **`origin/main`** (stale-local-main recurs — `git fetch` first). FREEZE-MERGE: gate = local `npm run ci:local` (DB-free) + the new specs; `--admin`-merge; twin ritual after merge.

---

## Background the engineer needs (read before starting)

**What S4a already wired (do NOT rebuild):**

- `InferenceBackboneRouter.posterior()` (`libs/substrate-runtime/src/inference/inference-backbone-router.ts:209-231`): on `result.ok && opts?.manifest === 'event' && result.value.manifest !== undefined` it calls `this.recorder.record(handle, input)`. **The survival adapters ALWAYS build a manifest in `posterior()`**, so a survival `posterior(input, {manifest:'event'})` always records. The recorder is TOTAL (never alters the returned Result).
- `EventSourcedInferenceRunRecorder` (`libs/substrate-runtime/src/reproducibility/inference-run-recorder.ts`): builds the F1 `kernel.InferenceRunCompleted.v1` envelope + persists the derived `kernel.run_manifest` index via `recordFrom(handle, input, seq)`. The payload schema reuses `PosteriorSummaryOrSurvival`, so a `kind:'survival'` summary validates free.
- `ReplayService.replay(tenant, id)` (`libs/substrate-runtime/src/reproducibility/replay.service.ts`): family-agnostic — loads the pinned run (RLS-scoped), recomputes via `INFERENCE_BACKBONE.posterior(pinnedRefs, {requestId})`, asserts the recomputed composite `catalogVersionHash` equals the pinned one (`catalog-drifted`), then asserts canonical-JSON bit-identity (`replay-divergence`). The survival MLE is deterministic (no RNG), so it bit-replays by pinning inputs.
- The survival adapters (`weibull-aft.adapter.ts`, `loglogistic-aft.adapter.ts`, `kaplan-meier.adapter.ts`) each: read `findSurvivalObservations`, fit, compose `appliedHazardRatio = exp(Σ logHR)` from `findEffectsForTree`, build a `SurvivalSummary` + a `RunManifest` carrying the **composite** `catalogVersionHash` (via `compositeCatalogVersionHash` — identical to the Normal adapter), store `{handle, summary}` in their own `handles` map, return the handle. **`sample()` / `counterfactual()` are Phase-1 `err` envelopes.**

**The router `sample()` dispatch** (`inference-backbone-router.ts:281-315`) routes by `handle.adapterId`; the three survival arms currently call the no-arg `adapter.sample()` and **cast the `err`** to `SampleResult`. Tasks 2-4 replace each arm with the real `adapter.sample(handle, sampleOpts, runOpts)`.

**Exact signatures (use verbatim):**

- `weibullQuantile(p, scale, shape): number` → `scale * (-ln(1-p))^(1/shape)` (`math/weibull-aft.ts:76`).
- `loglogisticQuantile(p, scale, shape): number` → `scale * (p/(1-p))^(1/shape)` (`math/loglogistic-aft.ts:97`).
- `kaplanMeier(observations): KmCurve` with `steps: readonly {t, survival, atRisk, events}[]` + `survivalAt(t): number` (`math/kaplan-meier.ts`).
- `makeRng(seedStr: string): () => number` — deterministic U(0,1) stream (`math/beta-binomial.ts:248`).
- `registerSurvivalObservations(tenant, subject, indicator, readings)` — **tenant FIRST** (`in-memory-inference-catalog.ts:132`).
- `registerEffects(treeRoot, indicator, effects, tenant?)` — trailing-optional tenant DEFAULTS to `DEFAULT_TEST_TENANT_PACK_ID`; **pass the real tenant** or read 0 effects (`in-memory-inference-catalog.ts:151`). `EffectDeclaration` = `{ planNodeId, ordinal, indicatorKey, magnitudePrior }` (a flat-scalar `magnitudePrior` = a log-HR for survival).
- `SurvivalObservation` = `{ durationT: number /* >0 */, eventObserved: boolean, entryT?: number }`.
- `SampleOpts` = `{ replicas: number, horizon: string /* ISO-8601 duration, e.g. 'P4W' */, seed: string }`; validate with `SampleOptsSchema`.
- `SampleResult` = `{ handleId, trajectories: number[][], summary: {mean,p10,p50,p90,sd}, manifest }`.
- `parseIsoDurationToDays(horizon): number` (`math/iso-duration.ts`) — used by the Normal sample path to bound the horizon.

**Survival `sample()` design (the one genuine choice — settled here, do not relitigate):**

Forward event-time simulation by **inverse-CDF from the HR-adjusted curve**:

- For each of `replicas` draws, take `u = rng()` ∈ (0,1) interpreted as the **adjusted survival probability** `S_adj(T) = u`. Under proportional hazards `S_adj(t) = S_base(t)^HR`, so `S_base(T) = u^(1/HR)` and `F_base(T) = 1 − u^(1/HR)`.
  - Weibull: `T = weibullQuantile(1 − u^(1/HR), scale, shape)`.
  - log-logistic: `T = loglogisticQuantile(1 − u^(1/HR), scale, shape)`.
  - KM (empirical-inverse): the smallest step time `t` whose `S_KM(t) ≤ u^(1/HR)`; if no step crosses, the **largest event time** (the same finite non-crossing floor `buildKmSurvivalSummary` uses — NEVER `Infinity`).
- **Clamp every `T` to `horizonDays`** (`T_clamped = min(T, horizonDays)`): an event beyond the horizon is censored-at-horizon. This makes the draw **intrinsically finite** — `canonicalJsonStringify` THROWS on `Infinity`/`NaN`, and `weibullQuantile(p→1)→∞`, so the clamp is load-bearing, not cosmetic.
- `trajectories[r] = [T_clamped]` (one event-time draw per replica; the day dimension is length-1 — the honest survival analog of the Normal path's iid filler). `summary` = the moment summary of the simulated event-time distribution (reuse a `summarizeTrajectories`-style helper). **Cross-check the design:** `summary.p50 ≈ summary's analytic medianSurvival` (when the median < horizon), and a harmful HR>1 → a SMALLER simulated p50.
- RNG keying: `makeRng(`${sampleOpts.seed}::${handle.id}`)` — byte-identical to the Normal adapter (ADR-223 §6 item 2 "exactly as the Normal sample path does"). Same `(seed, handle)` → byte-identical trajectories.

**Wave lessons from S1-S3 that MUST be honored in the tests (the waves caught a real miss every slice):**

- Survival cohorts in fixtures use **heavy censoring (~40%)**, not light — a light cohort doesn't exercise the censored likelihood. (The replay proof only needs a *converging* fit, but use a realistic censored cohort so the fixture is reusable + honest.)
- Any HR test uses **≥2 effects** (a 1-effect test can't distinguish `exp(Σ)` from `exp(first)`) AND tests the **harmful HR>1 direction** (curve drops / simulated survival shortens).
- KM comparisons are at a **SHARED fixed horizon** (each curve's own median is ~0.5 by construction, not comparable across HRs); test the **non-crossing finite floor** explicitly.
- Determinism witness everywhere: same seed → **byte-identical** `canonicalJsonStringify` of the result; the finite-clamp is what keeps that from throwing.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `libs/substrate-runtime/src/reproducibility/survival-replay.proof.spec.ts` | **CREATE** — the survival replay proof (router + real recorder + ReplayService, DB-free), mirroring `run-manifest-persistence.proof.spec.ts` | 1 |
| `libs/substrate-runtime/src/inference/adapters/survival-sample.ts` | **CREATE** — shared pure helpers: `adjustedEventTime(...)`, `summarizeEventTimes(...)`, the per-replica draw loop (DRY across the 3 adapters) | 2 |
| `libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.ts` | **MODIFY** — real `sample(handle, opts, runOpts)` via `weibullQuantile` inverse-CDF | 2 |
| `libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.sample.spec.ts` | **CREATE** — Weibull sample TDD | 2 |
| `libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.ts` | **MODIFY** — real `sample(...)` via `loglogisticQuantile` | 3 |
| `libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.sample.spec.ts` | **CREATE** — log-logistic sample TDD | 3 |
| `libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.ts` | **MODIFY** — cache `KmCurve` at posterior-time + real empirical-inverse `sample(...)` | 4 |
| `libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.sample.spec.ts` | **CREATE** — KM sample TDD | 4 |
| `libs/substrate-runtime/src/inference/inference-backbone-router.ts:281-315` | **MODIFY** — the three survival `sample()` arms call the real adapter sig (drop the `err` casts); update `SurvivalPosteriorAdapter.sample` signature | 2,3,4 |
| `libs/substrate-runtime/src/inference/inference-backbone-router.sample-survival.spec.ts` | **CREATE** — router routes a survival handle's `sample()` to the right adapter | 5 |

---

## Task 1: Survival replay proof (test-only; exercises the real S4a path)

**Files:**
- Create: `libs/substrate-runtime/src/reproducibility/survival-replay.proof.spec.ts`
- (No production change expected. If a survival snag surfaces in `recordFrom`/`persist`/replay, fix it minimally and note it — that is the proof's job.)

**Why test-only:** the survival posterior already builds a replayable manifest + the recorder fires family-agnostically. This task asserts that end-to-end for survival, mirroring `run-manifest-persistence.proof.spec.ts` (read it first — copy its `FixedSeqResolver`, `TRIVIAL_RUNNER`, harness shape).

- [ ] **Step 1: Write the failing proof spec**

Create `survival-replay.proof.spec.ts`. Mirror the Normal proof's harness but swap the indicator to a survival `familyRef` + seed survival observations. Use a ~40%-censored Weibull-recoverable cohort.

```typescript
/**
 * B3-S4b SURVIVAL REPLAY PROOF — the PCCP audit-trail foundation (ADR-223 §6).
 *
 * Proves a survival posterior(input, {manifest:'event'}) flows through the REAL
 * S4a path — InferenceBackboneRouter → survival adapter (fits MLE) →
 * EventSourcedInferenceRunRecorder (emits F1 + persists run_manifest kind:'survival')
 * — and ReplayService.replay() recomputes the MLE BIT-IDENTICALLY. The survival
 * MLE is deterministic (no RNG), so it bit-replays by pinning the inputs, exactly
 * as the Normal closed-form posterior does. DB-free over the in-memory doubles;
 * every collaborator is the REAL production class except the four recorder doubles.
 *
 * Mirrors run-manifest-persistence.proof.spec.ts (the S4a Normal proof) — same
 * harness, survival indicator.
 */

import { describe, expect, it } from 'vitest';

import type {
  PosteriorInput,
  SurvivalObservation,
  SurvivalSummary,
} from '@de-braighter/substrate-contracts/inference';
import {
  INFERENCE_RUN_COMPLETED_EVENT_TYPE,
  InferenceRunCompletedPayloadSchema,
} from '@de-braighter/substrate-contracts';

import { InMemoryDomainEventPublisher } from '../events/in-memory-domain-event-publisher.js';
import {
  InMemoryEvidenceRepository,
  InMemoryInferenceCatalog,
} from '../inference/in-memory-inference-catalog.js';
import { InferenceBackboneRouter } from '../inference/inference-backbone-router.js';
import { InMemoryMemberResolution } from '../inference/testing/in-memory-member-resolution.js';
import {
  EventSourcedInferenceRunRecorder,
  type GucRunnerLike,
  type SeqResolver,
} from './inference-run-recorder.js';
import { InMemoryDistributionCatalog } from './in-memory-distribution-catalog.js';
import { InMemoryRunManifestRepository } from './in-memory-run-manifest-repository.js';
import { ReplayService } from './replay.service.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTHER_TENANT = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PATIENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TREE_ROOT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const INDICATOR = 'oncology.recurrence_free_survival';
const FIXED_SEQ = 7n;

// ~40%-censored time-to-recurrence cohort (event=recurrence, censor=alive at
// last follow-up) — heavy enough to exercise the censored likelihood (S1 wave
// lesson) yet Weibull-identifiable (>=1 event).
const SURVIVAL_OBSERVATIONS: SurvivalObservation[] = [
  { durationT: 4.2, eventObserved: true },
  { durationT: 6.8, eventObserved: true },
  { durationT: 9.1, eventObserved: true },
  { durationT: 12.0, eventObserved: false }, // censored
  { durationT: 13.5, eventObserved: true },
  { durationT: 15.0, eventObserved: false }, // censored
  { durationT: 18.4, eventObserved: true },
  { durationT: 20.0, eventObserved: false }, // censored
  { durationT: 22.3, eventObserved: true },
  { durationT: 24.0, eventObserved: false }, // censored
];

const POSTERIOR_INPUT: PosteriorInput = {
  tenantPackId: TENANT,
  treeRoot: TREE_ROOT,
  subject: { kind: 'individual', id: PATIENT, role: 'oncology.patient' },
  indicatorKey: INDICATOR,
  asOf: '2026-06-09T00:00:00.000Z',
};

class FixedSeqResolver implements SeqResolver {
  constructor(private readonly seq: bigint) {}
  async resolve(): Promise<bigint> {
    return this.seq;
  }
}
const TRIVIAL_RUNNER: GucRunnerLike = {
  async run(_tenantPackId, fn) {
    return fn(undefined as never);
  },
};

/** Assemble the survival S4a loop over the in-memory doubles. `familyRef` selects
 *  the survival family; `effects` are optional survival log-HRs on the tree. */
function makeHarness(opts: {
  familyRef: string;
  effects?: readonly { planNodeId: string; ordinal: number; indicatorKey: string; magnitudePrior: number }[];
}) {
  const catalog = new InMemoryInferenceCatalog([
    { indicatorKey: INDICATOR as never, familyRef: opts.familyRef as never },
  ]);
  const evidence = new InMemoryEvidenceRepository();
  evidence.registerSurvivalObservations(TENANT, PATIENT, INDICATOR, SURVIVAL_OBSERVATIONS);
  if (opts.effects) {
    evidence.registerEffects(TREE_ROOT, INDICATOR, opts.effects, TENANT);
  }
  const distributionCatalog = new InMemoryDistributionCatalog(); // Normal + 3 survival rows (S3)

  const publisher = new InMemoryDomainEventPublisher();
  const runManifestRepo = new InMemoryRunManifestRepository();
  const recorder = new EventSourcedInferenceRunRecorder(
    publisher,
    runManifestRepo,
    new FixedSeqResolver(FIXED_SEQ),
    TRIVIAL_RUNNER,
  );
  const router = new InferenceBackboneRouter(
    catalog,
    evidence,
    null,
    new InMemoryMemberResolution(),
    distributionCatalog,
    recorder,
  );
  const replayService = new ReplayService(runManifestRepo, router);
  return { router, publisher, runManifestRepo, replayService, distributionCatalog };
}

describe('B3-S4b survival replay proof — F1 emit + persist + bit-identical MLE replay', () => {
  it('Weibull: posterior(event) emits F1 (kind:survival), persists the index, replays bit-identical', async () => {
    const { router, publisher, runManifestRepo, replayService } = makeHarness({
      familyRef: 'survival.weibull-aft@1',
    });

    const res = await router.posterior(POSTERIOR_INPUT, { manifest: 'event' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const requestId = res.value.manifest.requestId;
    expect((res.value.summary as SurvivalSummary).kind).toBe('survival');

    // F1 event drained, validates against the contract schema (survival summary free).
    const drained = publisher.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.eventType).toBe(INFERENCE_RUN_COMPLETED_EVENT_TYPE);
    const payload = InferenceRunCompletedPayloadSchema.parse(drained[0]!.payload);
    expect(payload.id).toBe(requestId);
    expect((payload.posteriorSummary as SurvivalSummary).kind).toBe('survival');

    // Index persisted with the survival summary.
    const got = await runManifestRepo.getById(TENANT, requestId);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.posteriorSummary).toEqual(res.value.summary);

    // Replay re-fits the MLE bit-identically.
    const replayed = await replayService.replay(TENANT, requestId);
    expect(replayed.ok).toBe(true);
    if (!replayed.ok) return;
    expect(replayed.value.recomputed).toEqual(got.value.posteriorSummary);
    expect(replayed.value.recomputedManifest.catalogVersionHash).toBe(
      got.value.manifest.catalogVersionHash,
    );
  });

  it('log-logistic: replays bit-identical', async () => {
    const { router, runManifestRepo, replayService } = makeHarness({
      familyRef: 'survival.loglogistic-aft@1',
    });
    const res = await router.posterior(POSTERIOR_INPUT, { manifest: 'event' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const replayed = await replayService.replay(TENANT, res.value.manifest.requestId);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.value.recomputed).toEqual(res.value.summary);
  });

  it('Kaplan-Meier: replays bit-identical (non-parametric, deterministic)', async () => {
    const { router, runManifestRepo, replayService } = makeHarness({
      familyRef: 'survival.kaplan-meier@1',
    });
    const res = await router.posterior(POSTERIOR_INPUT, { manifest: 'event' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const replayed = await replayService.replay(TENANT, res.value.manifest.requestId);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.value.recomputed).toEqual(res.value.summary);
  });

  it('with >=2 survival log-HR effects (protective): the HR-applied summary persists + replays bit-identical', async () => {
    const { router, runManifestRepo, replayService } = makeHarness({
      familyRef: 'survival.weibull-aft@1',
      effects: [
        { planNodeId: TREE_ROOT, ordinal: 0, indicatorKey: INDICATOR, magnitudePrior: Math.log(0.7) },
        { planNodeId: TREE_ROOT, ordinal: 1, indicatorKey: INDICATOR, magnitudePrior: Math.log(0.8) },
      ],
    });
    const res = await router.posterior(POSTERIOR_INPUT, { manifest: 'event' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const summary = res.value.summary as SurvivalSummary;
    // HR = 0.7 * 0.8 = 0.56 (protective; the >=2-effect product, not exp(first)).
    expect(summary.appliedHazardRatio).toBeCloseTo(0.56, 6);

    const replayed = await replayService.replay(TENANT, res.value.manifest.requestId);
    expect(replayed.ok).toBe(true);
    if (replayed.ok) expect(replayed.value.recomputed).toEqual(summary);
  });

  it('NEGATIVE — catalog drift: re-registering a survival row with a tighter fit.tol refuses to replay', async () => {
    const { router, runManifestRepo, replayService, distributionCatalog } = makeHarness({
      familyRef: 'survival.weibull-aft@1',
    });
    const res = await router.posterior(POSTERIOR_INPUT, { manifest: 'event' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // Drift the catalog AFTER the run — append/re-register any row so the
    // composite hash moves (the recipe-versioning lever: a tighter fit.tol on a
    // survival row is the production form; any catalog mutation trips the guard).
    await distributionCatalog.register({
      name: 'survival.weibull-aft',
      pdfRef: 'kernel.dist.survival.weibull-aft.pdf',
      cdfRef: 'kernel.dist.survival.weibull-aft.cdf',
      sampleRef: 'kernel.dist.survival.weibull-aft.sample',
      // tighter tol → a different parameterSchema → a different catalogVersionHash.
      parameterSchema: { scale: { type: 'number', minimum: 0 }, shape: { type: 'number', minimum: 0 }, fit: { method: 'profile-newton', tol: '1e-12', maxIter: '100' } },
      conjugateWith: [],
    });

    const replayed = await replayService.replay(TENANT, res.value.manifest.requestId);
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) expect(replayed.error.kind).toBe('catalog-drifted');
  });

  it('NEGATIVE — cross-tenant: getById + replay under another tenant are not-found (RLS boundary)', async () => {
    const { router, runManifestRepo, replayService } = makeHarness({
      familyRef: 'survival.weibull-aft@1',
    });
    const res = await router.posterior(POSTERIOR_INPUT, { manifest: 'event' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const requestId = res.value.manifest.requestId;

    expect((await runManifestRepo.getById(TENANT, requestId)).ok).toBe(true);
    expect((await runManifestRepo.getById(OTHER_TENANT, requestId)).ok).toBe(false);

    const replayed = await replayService.replay(OTHER_TENANT, requestId);
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) expect(replayed.error.kind).toBe('manifest-not-found');
  });

  it('determinism: a second replay is byte-identical to the first', async () => {
    const { router, replayService } = makeHarness({ familyRef: 'survival.weibull-aft@1' });
    const res = await router.posterior(POSTERIOR_INPUT, { manifest: 'event' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const a = await replayService.replay(TENANT, res.value.manifest.requestId);
    const b = await replayService.replay(TENANT, res.value.manifest.requestId);
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(a.value.recomputed).toEqual(b.value.recomputed);
  });
});
```

- [ ] **Step 2: Run the proof spec**

Run: `npx vitest run libs/substrate-runtime/src/reproducibility/survival-replay.proof.spec.ts`
Expected: **PASS** (the survival posterior rides the existing path). If a test fails, read the failure precisely:
- A `register(...)` shape mismatch → check `InMemoryDistributionCatalog.register` / `DistributionEntry` (the catalog-drift test's row literal must match the real `DistributionEntry` shape; copy a sibling from S3's seeds if the literal above drifts).
- A `recordFrom`/`persist` type error on the survival summary → that IS a real S4a gap on the survival path; fix it minimally (the `prisma-run-manifest-repository.ts:99` cast was the known one — S4a already fixed it; an in-memory analog would be similar) and note it in the commit.
- The catalog-drift `register` literal: if `InMemoryDistributionCatalog.register` upserts by `name`, re-registering `survival.weibull-aft` REPLACES the row (drift); if it appends, you get a duplicate (still drift). Either trips `catalog-drifted`. Confirm by reading `in-memory-distribution-catalog.ts`.

- [ ] **Step 3: Commit**

```bash
git add libs/substrate-runtime/src/reproducibility/survival-replay.proof.spec.ts
git commit -m "test(substrate): B3-S4b survival replay proof — bit-identical MLE replay over the real S4a path"
```

---

## Task 2: Weibull `sample()` — parametric inverse-CDF, seed-pinned

**Files:**
- Create: `libs/substrate-runtime/src/inference/adapters/survival-sample.ts` (shared pure helpers)
- Modify: `libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.ts` (replace the no-arg `sample()` envelope)
- Modify: `libs/substrate-runtime/src/inference/inference-backbone-router.ts:295-301` (the Weibull arm) + the `SurvivalPosteriorAdapter` interface `sample` signature
- Create: `libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.sample.spec.ts`

- [ ] **Step 1: Write the shared sampling helpers (pure, DRY across the 3 adapters)**

Create `survival-sample.ts`:

```typescript
/**
 * Shared pure helpers for survival forward sampling (B3-S4b, ADR-223 §6 item 2).
 *
 * Forward event-time simulation by inverse-CDF from the HR-ADJUSTED curve: a draw
 * u ∈ (0,1) is the adjusted survival probability S_adj(T)=u; under proportional
 * hazards S_adj(t)=S_base(t)^HR, so S_base(T)=u^(1/HR) and the event time inverts
 * the BASE curve at F_base = 1 − u^(1/HR). Every draw is CLAMPED to the horizon
 * (an event beyond it is censored-at-horizon) so the result is intrinsically
 * finite — canonicalJsonStringify THROWS on Infinity/NaN, and a parametric
 * quantile diverges as u→0.
 */

import type { SampleSummary } from '@de-braighter/substrate-contracts/inference';

/** S_base(T) target = u^(1/HR) for an adjusted survival probability u. */
export function baseSurvivalTarget(u: number, hr: number): number {
  return Math.pow(u, 1 / hr);
}

/** Draw `replicas` event times via `quantileOfBaseF` (the BASE-curve inverse-CDF
 *  at F_base = 1 − u^(1/HR)), clamped to `horizonDays`, seed-pinned by `rng`. */
export function drawEventTimes(args: {
  replicas: number;
  horizonDays: number;
  hr: number;
  rng: () => number;
  /** Maps a base-curve CDF probability F_base ∈ (0,1) to an event time. */
  quantileOfBaseF: (fBase: number) => number;
}): number[][] {
  const { replicas, horizonDays, hr, rng, quantileOfBaseF } = args;
  const trajectories: number[][] = new Array(replicas);
  for (let r = 0; r < replicas; r++) {
    const u = clampUnit(rng());
    const fBase = 1 - baseSurvivalTarget(u, hr);
    const t = quantileOfBaseF(fBase);
    const clamped = Number.isFinite(t) ? Math.min(Math.max(t, 0), horizonDays) : horizonDays;
    trajectories[r] = [clamped];
  }
  return trajectories;
}

/** Keep u strictly inside (0,1) so the quantile inversions never hit ±∞. */
function clampUnit(u: number): number {
  const EPS = 1e-12;
  if (!Number.isFinite(u)) return 0.5;
  return Math.min(1 - EPS, Math.max(EPS, u));
}

/** Moment summary over the flattened event-time draws (mirrors the Normal path). */
export function summarizeEventTimes(trajectories: number[][]): SampleSummary {
  let total = 0;
  for (const row of trajectories) total += row.length;
  const flat = new Float64Array(total);
  let i = 0;
  for (const row of trajectories) for (const v of row) flat[i++] = v;
  flat.sort();
  const n = flat.length;
  let sum = 0;
  for (const v of flat) sum += v;
  const mean = sum / Math.max(1, n);
  let sq = 0;
  for (const v of flat) sq += (v - mean) ** 2;
  return {
    mean,
    p10: quantileF64(flat, 0.1),
    p50: quantileF64(flat, 0.5),
    p90: quantileF64(flat, 0.9),
    sd: Math.sqrt(sq / Math.max(1, n)),
  };
}

function quantileF64(sortedAsc: Float64Array, q: number): number {
  if (sortedAsc.length === 0) return Number.NaN;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(q * (sortedAsc.length - 1))));
  const v = sortedAsc[idx];
  return v === undefined ? Number.NaN : v;
}
```

- [ ] **Step 2: Write the failing Weibull sample spec**

Create `weibull-aft.adapter.sample.spec.ts`. Drive a posterior first (to mint a handle), then sample.

```typescript
import { describe, expect, it } from 'vitest';

import type { PosteriorInput, SampleOpts } from '@de-braighter/substrate-contracts/inference';

import {
  InMemoryEvidenceRepository,
  InMemoryInferenceCatalog,
} from '../in-memory-inference-catalog.js';
import { InMemoryDistributionCatalog } from '../../reproducibility/in-memory-distribution-catalog.js';
import { canonicalJsonStringify } from '../../domain/canonical-json.js';
import { WeibullAftAdapter } from './weibull-aft.adapter.js';
import type { SurvivalObservation } from '@de-braighter/substrate-contracts/inference';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PATIENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TREE_ROOT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const INDICATOR = 'oncology.rfs';

const COHORT: SurvivalObservation[] = [
  { durationT: 4.2, eventObserved: true },
  { durationT: 6.8, eventObserved: true },
  { durationT: 9.1, eventObserved: true },
  { durationT: 12.0, eventObserved: false },
  { durationT: 13.5, eventObserved: true },
  { durationT: 18.4, eventObserved: true },
  { durationT: 20.0, eventObserved: false },
  { durationT: 22.3, eventObserved: true },
];

function makeAdapter(effects?: { planNodeId: string; ordinal: number; indicatorKey: string; magnitudePrior: number }[]) {
  const catalog = new InMemoryInferenceCatalog([
    { indicatorKey: INDICATOR as never, familyRef: 'survival.weibull-aft@1' as never },
  ]);
  const evidence = new InMemoryEvidenceRepository();
  evidence.registerSurvivalObservations(TENANT, PATIENT, INDICATOR, COHORT);
  if (effects) evidence.registerEffects(TREE_ROOT, INDICATOR, effects, TENANT);
  return new WeibullAftAdapter({ catalog, evidence, distributionCatalog: new InMemoryDistributionCatalog() });
}

const INPUT: PosteriorInput = {
  tenantPackId: TENANT,
  treeRoot: TREE_ROOT,
  subject: { kind: 'individual', id: PATIENT, role: 'oncology.patient' },
  indicatorKey: INDICATOR,
};
const OPTS: SampleOpts = { replicas: 2000, horizon: 'P200D', seed: 'seed-abc' };

describe('WeibullAftAdapter.sample — forward event-time simulation (B3-S4b)', () => {
  it('returns a finite SampleResult of seed-pinned event-time draws', async () => {
    const a = makeAdapter();
    const post = await a.posterior(INPUT);
    expect(post.ok).toBe(true);
    if (!post.ok) return;

    const s = await a.sample(post.value, OPTS);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.value.trajectories).toHaveLength(2000);
    // Every draw finite + within [0, horizon] — canonicalJsonStringify must not throw.
    for (const row of s.value.trajectories) {
      expect(row).toHaveLength(1);
      expect(Number.isFinite(row[0])).toBe(true);
      expect(row[0]).toBeGreaterThanOrEqual(0);
    }
    expect(() => canonicalJsonStringify(s.value)).not.toThrow();
    expect(Number.isFinite(s.value.summary.p50)).toBe(true);
  });

  it('same seed → byte-identical; different seed → different', async () => {
    const a = makeAdapter();
    const post = await a.posterior(INPUT);
    if (!post.ok) throw new Error('posterior failed');
    const s1 = await a.sample(post.value, OPTS);
    const s2 = await a.sample(post.value, OPTS);
    const s3 = await a.sample(post.value, { ...OPTS, seed: 'different' });
    if (!s1.ok || !s2.ok || !s3.ok) throw new Error('sample failed');
    expect(canonicalJsonStringify(s1.value.trajectories)).toBe(canonicalJsonStringify(s2.value.trajectories));
    expect(canonicalJsonStringify(s1.value.trajectories)).not.toBe(canonicalJsonStringify(s3.value.trajectories));
  });

  it('sampled median ~ the analytic medianSurvival (baseline, HR=1)', async () => {
    const a = makeAdapter();
    const post = await a.posterior(INPUT);
    if (!post.ok) throw new Error('posterior failed');
    const summary = post.value.summary as { medianSurvival: number };
    const s = await a.sample(post.value, OPTS);
    if (!s.ok) throw new Error('sample failed');
    // MC estimate of the median within a generous tolerance (median < horizon).
    expect(s.value.summary.p50).toBeCloseTo(summary.medianSurvival, 0);
  });

  it('a harmful HR>1 (>=2 effects) shortens the simulated survival vs baseline', async () => {
    const baseline = makeAdapter();
    const harmful = makeAdapter([
      { planNodeId: TREE_ROOT, ordinal: 0, indicatorKey: INDICATOR, magnitudePrior: Math.log(1.5) },
      { planNodeId: TREE_ROOT, ordinal: 1, indicatorKey: INDICATOR, magnitudePrior: Math.log(1.4) },
    ]);
    const pb = await baseline.posterior(INPUT);
    const ph = await harmful.posterior(INPUT);
    if (!pb.ok || !ph.ok) throw new Error('posterior failed');
    const sb = await baseline.sample(pb.value, OPTS);
    const sh = await harmful.sample(ph.value, OPTS);
    if (!sb.ok || !sh.ok) throw new Error('sample failed');
    // HR = 1.5*1.4 = 2.1 > 1 → recurrence sooner → smaller median survival time.
    expect(sh.value.summary.p50).toBeLessThan(sb.value.summary.p50);
  });

  it('an expired handle → handle-expired', async () => {
    const a = makeAdapter();
    const post = await a.posterior(INPUT);
    if (!post.ok) throw new Error('posterior failed');
    const s = await a.sample({ ...post.value, id: 'unknown-handle' as never }, OPTS);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error.kind).toBe('handle-expired');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.sample.spec.ts`
Expected: FAIL — `a.sample(post.value, OPTS)` is the no-arg envelope (a TS compile error on the extra args, or a returned `not-implemented-phase-1` err).

- [ ] **Step 4: Implement the real Weibull `sample()`**

In `weibull-aft.adapter.ts`: add the imports, replace the no-arg `sample()` envelope (lines ~198-205) with the real impl. Reuse `buildManifest` (already on the class) for the sample manifest; the cached `{handle, summary}` carries `parameterValues.{scale,shape}` + `appliedHazardRatio`.

```typescript
// add to the existing inference-contracts import block:
//   type SampleOpts, type SampleResult, SampleOptsSchema
// add imports:
import { parseIsoDurationToDays } from '../math/iso-duration.js';
import { makeRng } from '../math/beta-binomial.js';
import { drawEventTimes, summarizeEventTimes } from './survival-sample.js';

// replace `async sample(): Promise<Result<unknown, InferenceErrorPhase1>>` with:
async sample(
  handle: PosteriorHandle,
  sampleOpts: SampleOpts,
  runOpts?: RunOptions,
): Promise<Result<SampleResult, InferenceErrorPhase1>> {
  const validation = SampleOptsSchema.safeParse(sampleOpts);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return err({
      kind: 'validation-failed',
      field: issue?.path.join('.') ?? '<root>',
      message: issue?.message ?? 'invalid sample opts',
    });
  }
  const cached = this.handles.get(handle.id);
  if (!cached) return err({ kind: 'handle-expired', handleId: handle.id });

  let horizonDays: number;
  try {
    horizonDays = parseIsoDurationToDays(sampleOpts.horizon);
  } catch (e) {
    return err({
      kind: 'validation-failed',
      field: 'horizon',
      message: e instanceof Error ? e.message : 'unparseable horizon',
    });
  }

  const { scale, shape } = cached.summary.parameterValues as { scale: number; shape: number };
  const hr = cached.summary.appliedHazardRatio;
  const startedAt = new Date().toISOString();
  const rng = makeRng(`${sampleOpts.seed}::${handle.id}`);
  // Forward event-time simulation: the BASE-curve inverse-CDF at F_base, clamped
  // to the horizon. The HR adjustment lives inside `drawEventTimes` (S_base = u^(1/HR)).
  const trajectories = drawEventTimes({
    replicas: sampleOpts.replicas,
    horizonDays,
    hr,
    rng,
    quantileOfBaseF: (fBase) => weibullQuantile(fBase, scale, shape),
  });
  const summary = summarizeEventTimes(trajectories);
  const catalogVersionHash = await this.resolveCatalogVersionHash();
  const manifest = this.buildManifest({
    input: { handleId: handle.id, sampleOpts },
    opts: runOpts,
    catalogVersionHash,
    observations: undefined,
    startedAt,
    completedAt: new Date().toISOString(),
  });
  return ok({ handleId: handle.id, trajectories, summary, manifest });
}
```

- [ ] **Step 5: Wire the router Weibull `sample()` arm**

In `inference-backbone-router.ts`: update the `SurvivalPosteriorAdapter` interface's `sample` member to the real signature, and the Weibull arm in the router `sample()` switch (lines ~295-301).

```typescript
// SurvivalPosteriorAdapter interface (lines ~103-107) — change `sample(): ...` to:
  sample(
    handle: PosteriorHandle,
    sampleOpts: SampleOpts,
    runOpts?: RunOptions,
  ): Promise<Result<SampleResult, InferenceErrorPhase1>>;

// in router.sample()'s switch, the WEIBULL_AFT_ADAPTER_ID arm — replace the
// no-arg cast with the real call:
    case WEIBULL_AFT_ADAPTER_ID:
      return this.weibullAft.sample(handle, sampleOpts, runOpts);
```

- [ ] **Step 6: Run the Weibull sample spec + the router compile**

Run: `npx vitest run libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.sample.spec.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 7: Commit**

```bash
git add libs/substrate-runtime/src/inference/adapters/survival-sample.ts \
        libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.ts \
        libs/substrate-runtime/src/inference/adapters/weibull-aft.adapter.sample.spec.ts \
        libs/substrate-runtime/src/inference/inference-backbone-router.ts
git commit -m "feat(substrate): B3-S4b Weibull survival sample() — seed-pinned inverse-CDF event-time simulation"
```

---

## Task 3: log-logistic `sample()` — parametric inverse-CDF

**Files:**
- Modify: `libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.ts`
- Modify: `libs/substrate-runtime/src/inference/inference-backbone-router.ts:302` (the log-logistic arm)
- Create: `libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.sample.spec.ts`

- [ ] **Step 1: Write the failing log-logistic sample spec**

Create `loglogistic-aft.adapter.sample.spec.ts` — identical structure to the Weibull spec (Task 2 Step 2) but import `LogLogisticAftAdapter` and `familyRef: 'survival.loglogistic-aft@1'`. Repeat the same 5 tests verbatim (finite + seed-pinned, same-seed-byte-identical, sampled-median≈analytic, harmful-HR-shortens with ≥2 effects, handle-expired). Use `INDICATOR = 'oncology.rfs.ll'` to avoid any cross-test collision.

```typescript
// header identical to weibull-aft.adapter.sample.spec.ts EXCEPT:
import { LogLogisticAftAdapter } from './loglogistic-aft.adapter.js';
// ... and makeAdapter constructs:
//   new LogLogisticAftAdapter({ catalog, evidence, distributionCatalog: new InMemoryDistributionCatalog() })
//   with the catalog indicator familyRef: 'survival.loglogistic-aft@1'
// The five it(...) blocks are the same assertions as the Weibull spec.
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.sample.spec.ts`
Expected: FAIL (the no-arg envelope).

- [ ] **Step 3: Implement the real log-logistic `sample()`**

In `loglogistic-aft.adapter.ts`: same edit as the Weibull adapter (Task 2 Step 4), but the `quantileOfBaseF` uses `loglogisticQuantile`. Add the imports (`SampleOpts`, `SampleResult`, `SampleOptsSchema`, `parseIsoDurationToDays`, `makeRng`, `drawEventTimes`, `summarizeEventTimes`, and `loglogisticQuantile` if not already imported).

```typescript
// the only line that differs from the Weibull sample() body:
  const trajectories = drawEventTimes({
    replicas: sampleOpts.replicas,
    horizonDays,
    hr,
    rng,
    quantileOfBaseF: (fBase) => loglogisticQuantile(fBase, scale, shape),
  });
// (everything else — validation, handle lookup, horizon parse, summarize,
//  buildManifest, ok(...) — is byte-identical to the Weibull sample().)
```

- [ ] **Step 4: Wire the router log-logistic `sample()` arm**

```typescript
// inference-backbone-router.ts, the LOGLOGISTIC_AFT_ADAPTER_ID arm (line ~302):
    case LOGLOGISTIC_AFT_ADAPTER_ID:
      return this.logLogisticAft.sample(handle, sampleOpts, runOpts);
```

- [ ] **Step 5: Run the log-logistic sample spec**

Run: `npx vitest run libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.sample.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.ts \
        libs/substrate-runtime/src/inference/adapters/loglogistic-aft.adapter.sample.spec.ts \
        libs/substrate-runtime/src/inference/inference-backbone-router.ts
git commit -m "feat(substrate): B3-S4b log-logistic survival sample() — seed-pinned inverse-CDF"
```

---

## Task 4: Kaplan-Meier `sample()` — empirical-inverse (needs curve caching)

**Files:**
- Modify: `libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.ts` (cache the `KmCurve` at posterior-time + real empirical-inverse `sample()`)
- Modify: `libs/substrate-runtime/src/inference/inference-backbone-router.ts:304` (the KM arm)
- Create: `libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.sample.spec.ts`

**Why this differs from Tasks 2-3:** the KM `SurvivalSummary.parameterValues` carries only `{n, events, censored}` — NOT the step curve. The `KmCurve` is computed in `posterior()` and discarded. Empirical-inverse sampling needs the steps, so cache the curve (mirroring how the Normal adapter caches its `posterior` object).

- [ ] **Step 1: Write the failing KM sample spec**

Create `kaplan-meier.adapter.sample.spec.ts`. Same 5-test structure as Weibull, but:
- KM `parameterValues` has no `scale`/`shape`; the sampled-median cross-check compares to `summary.medianSurvival` (the step-curve median) at HR=1.
- The harmful-HR test asserts at the level of the simulated median (shorter), same as Weibull.
- Add a 6th test: **non-crossing finite floor** — a heavily-censored cohort whose curve never reaches S≤(u^(1/HR)) for some draws still yields a finite event time (the largest event time), and `canonicalJsonStringify` does not throw.

```typescript
import { describe, expect, it } from 'vitest';

import type { PosteriorInput, SampleOpts, SurvivalObservation } from '@de-braighter/substrate-contracts/inference';

import { InMemoryEvidenceRepository, InMemoryInferenceCatalog } from '../in-memory-inference-catalog.js';
import { InMemoryDistributionCatalog } from '../../reproducibility/in-memory-distribution-catalog.js';
import { canonicalJsonStringify } from '../../domain/canonical-json.js';
import { KaplanMeierAdapter } from './kaplan-meier.adapter.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PATIENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TREE_ROOT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const INDICATOR = 'oncology.rfs.km';

const COHORT: SurvivalObservation[] = [
  { durationT: 4.2, eventObserved: true },
  { durationT: 6.8, eventObserved: true },
  { durationT: 9.1, eventObserved: true },
  { durationT: 12.0, eventObserved: false },
  { durationT: 13.5, eventObserved: true },
  { durationT: 18.4, eventObserved: true },
  { durationT: 22.3, eventObserved: true },
];

function makeAdapter(effects?: { planNodeId: string; ordinal: number; indicatorKey: string; magnitudePrior: number }[]) {
  const catalog = new InMemoryInferenceCatalog([
    { indicatorKey: INDICATOR as never, familyRef: 'survival.kaplan-meier@1' as never },
  ]);
  const evidence = new InMemoryEvidenceRepository();
  evidence.registerSurvivalObservations(TENANT, PATIENT, INDICATOR, COHORT);
  if (effects) evidence.registerEffects(TREE_ROOT, INDICATOR, effects, TENANT);
  return new KaplanMeierAdapter({ catalog, evidence, distributionCatalog: new InMemoryDistributionCatalog() });
}

const INPUT: PosteriorInput = {
  tenantPackId: TENANT,
  treeRoot: TREE_ROOT,
  subject: { kind: 'individual', id: PATIENT, role: 'oncology.patient' },
  indicatorKey: INDICATOR,
};
const OPTS: SampleOpts = { replicas: 2000, horizon: 'P200D', seed: 'seed-km' };

describe('KaplanMeierAdapter.sample — empirical-inverse simulation (B3-S4b)', () => {
  it('returns a finite, seed-pinned SampleResult', async () => {
    const a = makeAdapter();
    const post = await a.posterior(INPUT);
    expect(post.ok).toBe(true);
    if (!post.ok) return;
    const s = await a.sample(post.value, OPTS);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.value.trajectories).toHaveLength(2000);
    for (const row of s.value.trajectories) expect(Number.isFinite(row[0])).toBe(true);
    expect(() => canonicalJsonStringify(s.value)).not.toThrow();
  });

  it('same seed → byte-identical', async () => {
    const a = makeAdapter();
    const post = await a.posterior(INPUT);
    if (!post.ok) throw new Error('posterior failed');
    const s1 = await a.sample(post.value, OPTS);
    const s2 = await a.sample(post.value, OPTS);
    if (!s1.ok || !s2.ok) throw new Error('sample failed');
    expect(canonicalJsonStringify(s1.value.trajectories)).toBe(canonicalJsonStringify(s2.value.trajectories));
  });

  it('all draws fall on actual step times or the horizon (empirical support)', async () => {
    const a = makeAdapter();
    const post = await a.posterior(INPUT);
    if (!post.ok) throw new Error('posterior failed');
    const s = await a.sample(post.value, OPTS);
    if (!s.ok) throw new Error('sample failed');
    const eventTimes = new Set(COHORT.filter((o) => o.eventObserved).map((o) => o.durationT));
    for (const row of s.value.trajectories) {
      // every draw is an event time or the clamped horizon (200) — never interpolated.
      expect(eventTimes.has(row[0]) || row[0] === 200).toBe(true);
    }
  });

  it('a harmful HR>1 (>=2 effects) shortens the simulated survival', async () => {
    const baseline = makeAdapter();
    const harmful = makeAdapter([
      { planNodeId: TREE_ROOT, ordinal: 0, indicatorKey: INDICATOR, magnitudePrior: Math.log(1.6) },
      { planNodeId: TREE_ROOT, ordinal: 1, indicatorKey: INDICATOR, magnitudePrior: Math.log(1.5) },
    ]);
    const pb = await baseline.posterior(INPUT);
    const ph = await harmful.posterior(INPUT);
    if (!pb.ok || !ph.ok) throw new Error('posterior failed');
    const sb = await baseline.sample(pb.value, OPTS);
    const sh = await harmful.sample(ph.value, OPTS);
    if (!sb.ok || !sh.ok) throw new Error('sample failed');
    expect(sh.value.summary.p50).toBeLessThanOrEqual(sb.value.summary.p50);
  });

  it('handle-expired on an unknown handle', async () => {
    const a = makeAdapter();
    const post = await a.posterior(INPUT);
    if (!post.ok) throw new Error('posterior failed');
    const s = await a.sample({ ...post.value, id: 'nope' as never }, OPTS);
    expect(s.ok).toBe(false);
    if (!s.ok) expect(s.error.kind).toBe('handle-expired');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.sample.spec.ts`
Expected: FAIL (no-arg envelope).

- [ ] **Step 3: Cache the `KmCurve` + implement empirical-inverse `sample()`**

In `kaplan-meier.adapter.ts`:

1. Widen the handles cache to carry the curve:

```typescript
// the handles field (line ~95) — add `curve`:
private readonly handles = new Map<
  string,
  { handle: PosteriorHandle; summary: SurvivalSummary; curve: KmCurve }
>();

// in posterior(), at the store (line ~193) — cache the curve:
this.handles.set(handle.id, { handle, summary, curve: km });
```

2. Add imports + replace the no-arg `sample()`:

```typescript
// add to the inference-contracts import block: type SampleOpts, type SampleResult, SampleOptsSchema
import { parseIsoDurationToDays } from '../math/iso-duration.js';
import { makeRng } from '../math/beta-binomial.js';
import { summarizeEventTimes } from './survival-sample.js';

async sample(
  handle: PosteriorHandle,
  sampleOpts: SampleOpts,
  runOpts?: RunOptions,
): Promise<Result<SampleResult, InferenceErrorPhase1>> {
  const validation = SampleOptsSchema.safeParse(sampleOpts);
  if (!validation.success) {
    const issue = validation.error.issues[0];
    return err({
      kind: 'validation-failed',
      field: issue?.path.join('.') ?? '<root>',
      message: issue?.message ?? 'invalid sample opts',
    });
  }
  const cached = this.handles.get(handle.id);
  if (!cached) return err({ kind: 'handle-expired', handleId: handle.id });

  let horizonDays: number;
  try {
    horizonDays = parseIsoDurationToDays(sampleOpts.horizon);
  } catch (e) {
    return err({
      kind: 'validation-failed',
      field: 'horizon',
      message: e instanceof Error ? e.message : 'unparseable horizon',
    });
  }

  const steps = cached.curve.steps;
  const hr = cached.summary.appliedHazardRatio;
  const lastEventTime = steps.length > 0 ? steps[steps.length - 1]!.t : horizonDays;
  const startedAt = new Date().toISOString();
  const rng = makeRng(`${sampleOpts.seed}::${handle.id}`);

  // Empirical-inverse: a draw u ∈ (0,1) is the adjusted survival S_adj(T)=u;
  // S_KM(T) = u^(1/HR). The event time is the smallest STEP time whose survival
  // crosses that target; if no step crosses, the largest event time (finite
  // non-crossing floor — never Infinity). Clamp to the horizon.
  const trajectories: number[][] = new Array(sampleOpts.replicas);
  for (let r = 0; r < sampleOpts.replicas; r++) {
    const u = Math.min(1 - 1e-12, Math.max(1e-12, rng()));
    const target = Math.pow(u, 1 / hr);
    let t = lastEventTime;
    for (const step of steps) {
      if (step.survival <= target) {
        t = step.t;
        break;
      }
    }
    trajectories[r] = [Math.min(t, horizonDays)];
  }
  const summary = summarizeEventTimes(trajectories);
  const catalogVersionHash = await this.resolveCatalogVersionHash();
  const manifest = this.buildManifest({
    input: { handleId: handle.id, sampleOpts },
    opts: runOpts,
    catalogVersionHash,
    observations: undefined,
    startedAt,
    completedAt: new Date().toISOString(),
  });
  return ok({ handleId: handle.id, trajectories, summary, manifest });
}
```

- [ ] **Step 4: Wire the router KM `sample()` arm**

```typescript
// inference-backbone-router.ts, the KAPLAN_MEIER_ADAPTER_ID arm (line ~304):
    case KAPLAN_MEIER_ADAPTER_ID:
      return this.kaplanMeier.sample(handle, sampleOpts, runOpts);
```

- [ ] **Step 5: Run the KM sample spec + confirm the existing KM posterior spec still passes (the cache-shape change)**

Run: `npx vitest run libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.spec.ts libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.sample.spec.ts`
Expected: PASS (both — the curve-caching change is additive; the existing posterior spec must stay green).

- [ ] **Step 6: Commit**

```bash
git add libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.ts \
        libs/substrate-runtime/src/inference/adapters/kaplan-meier.adapter.sample.spec.ts \
        libs/substrate-runtime/src/inference/inference-backbone-router.ts
git commit -m "feat(substrate): B3-S4b Kaplan-Meier survival sample() — empirical-inverse over the cached step curve"
```

---

## Task 5: Router survival-sample dispatch test + full gate

**Files:**
- Create: `libs/substrate-runtime/src/inference/inference-backbone-router.sample-survival.spec.ts`

- [ ] **Step 1: Write the router survival-sample dispatch spec**

Construct the production router with the three survival families, run a survival posterior to mint a handle, then assert `router.sample(handle, opts)` routes to the right adapter and returns a real `SampleResult` (not the old `not-implemented-phase-1` err). Reuse the harness shape from `inference-backbone-router.run-recording.spec.ts` (the 6-arg `InferenceBackboneRouter` constructor + a spy/no-op recorder).

```typescript
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';

import type { PosteriorInput, SampleOpts, SurvivalObservation } from '@de-braighter/substrate-contracts/inference';

import { InMemoryEvidenceRepository, InMemoryInferenceCatalog } from './in-memory-inference-catalog.js';
import { InferenceBackboneRouter } from './inference-backbone-router.js';
import { InMemoryDistributionCatalog } from '../reproducibility/in-memory-distribution-catalog.js';
import { InMemoryMemberResolution } from './testing/in-memory-member-resolution.js';
import { WEIBULL_AFT_ADAPTER_ID } from './adapters/weibull-aft.adapter.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PATIENT = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TREE_ROOT = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const INDICATOR = 'oncology.rfs';
const NOOP_RECORDER = { record: async () => {} };

const COHORT: SurvivalObservation[] = [
  { durationT: 4, eventObserved: true },
  { durationT: 8, eventObserved: true },
  { durationT: 10, eventObserved: false },
  { durationT: 13, eventObserved: true },
  { durationT: 18, eventObserved: true },
];

function buildRouter() {
  const catalog = new InMemoryInferenceCatalog([
    { indicatorKey: INDICATOR as never, familyRef: 'survival.weibull-aft@1' as never },
  ]);
  const evidence = new InMemoryEvidenceRepository();
  evidence.registerSurvivalObservations(TENANT, PATIENT, INDICATOR, COHORT);
  return new InferenceBackboneRouter(
    catalog,
    evidence,
    null,
    new InMemoryMemberResolution(),
    new InMemoryDistributionCatalog(),
    NOOP_RECORDER,
  );
}

const INPUT: PosteriorInput = {
  tenantPackId: TENANT,
  treeRoot: TREE_ROOT,
  subject: { kind: 'individual', id: PATIENT, role: 'oncology.patient' },
  indicatorKey: INDICATOR,
};

describe('InferenceBackboneRouter.sample — survival dispatch (B3-S4b)', () => {
  it('routes a Weibull handle to the real survival sample (not the phase-1 envelope)', async () => {
    const router = buildRouter();
    const post = await router.posterior(INPUT);
    expect(post.ok).toBe(true);
    if (!post.ok) return;
    expect(post.value.adapterId).toBe(WEIBULL_AFT_ADAPTER_ID);

    const opts: SampleOpts = { replicas: 100, horizon: 'P100D', seed: 's' };
    const s = await router.sample(post.value, opts);
    expect(s.ok).toBe(true); // was a cast err before S4b
    if (s.ok) expect(s.value.trajectories).toHaveLength(100);
  });
});
```

- [ ] **Step 2: Run the router sample spec**

Run: `npx vitest run libs/substrate-runtime/src/inference/inference-backbone-router.sample-survival.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run the full DB-free local gate**

Run: `npm run ci:local`
Expected: GREEN — the existing survival adapter/router specs stay green (the cache-shape + dispatch changes are additive), the 4 new specs pass. Note the pass/skip counts (the DB-gated specs deterministically skip in `ci:local`).

- [ ] **Step 4: Commit**

```bash
git add libs/substrate-runtime/src/inference/inference-backbone-router.sample-survival.spec.ts
git commit -m "test(substrate): B3-S4b router routes survival handle sample() to the family adapter"
```

---

## Task 6: Verifier wave + merge + twin ritual

- [ ] **Step 1: Open the PR (before the wave, so findings harvest)**

```bash
git push -u origin <branch>
gh pr create --repo de-braighter/substrate --title "feat(substrate): B3-S4b survival replay proof + sample()" --body "<body — see below>"
```

PR body MUST carry the twin-ritual lines (CLAUDE.md):

```
Producer: orchestrator/claude-fable-5 [subagent-driven-development]
Effort: deep
Effect: cycle-time 0.008±0.005 expert
Effect: findings 2±2 expert

B3-S4b (ADR-223 §6): the survival family replays bit-for-bit through the real S4a
persist path, and the three deferred survival sample() impls land (Weibull /
log-logistic inverse-CDF + Kaplan-Meier empirical-inverse), seed-pinned. No contract
change, no publish (stays 1.2.0). Closes the survival-replay + sampling items of the
B3 first arc; NEXT = S5 synthetic-cohort PH-violation gate.
```

- [ ] **Step 2: Run the verifier wave (parallel, worktree-isolated)**

Dispatch `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` in parallel, each `isolation: "worktree"`, on the PR head. (exercir-charter-checker N/A — this is `layers/substrate`, not `domains/exercir`.)

- [ ] **Step 3: Address findings, post-findings, drain, merge**

Per the ritual: write the wave findings to a temp JSON, `npm run dev -- post-findings substrate#<pr> findings.json` (from `domains/devloop`), `npm run dev -- drain substrate#<pr>`. Fix any MUST-FIX, re-gate. Then `--admin`-merge (freeze-merge policy; the gh token has admin).

- [ ] **Step 4: Post-merge twin ritual**

```bash
# from domains/devloop:
npm run dev -- backfill de-braighter/substrate
npm run ritual:post-merge   # reviews + resolve-findings
npm run dev -- reconcile substrate#<pr>
```

- [ ] **Step 5: Update the memory file**

Append a "🎉 B3-S4b DONE" section to `second-brick-oncology-direction.md` (replay proof rides the existing path; the 3 sample() impls seed-pinned; KM needed curve-caching; NEXT = S5). Update the `description:` frontmatter + the MEMORY.md one-liner.

---

## Out of scope (named, deferred — do NOT add)

- **No contract change / no publish.** The deferred contracts widens (`policy.strategy:'survival-fast-path'`, an `'unknown-family'` error code, the S3.5 `SurvivalEventLogObservationProjection` arm, the S4a `InferenceRunCompleted.v1` schema) keep accumulating UNPUBLISHED for a later coordinated bump. S4b touches runtime only.
- **`counterfactual()` for survival** stays a Phase-1 envelope (deferred; not an S4b concern — the replay proof exercises `posterior()` replay).
- **Extending `InMemoryInferenceBackbone` for survival** is NOT needed (the replay proof uses the production router; the sample tests hit the adapters + router directly). Defer to S5 if the synthetic-cohort suite wants a survival-capable double.
- **The async population re-fit job**, the R3-atomic single-tx persist, the always-on persist default — all named-trigger deferrals from S4a, untouched here.
- **S5 (synthetic-cohort PH-violation gate)** is the next slice — its own plan→build→merge.

---

## Self-review notes (verified against ADR-223 §6 + the S4 design note §7)

- **Spec coverage:** §6 item 1 (deterministic-MLE bit replay) → Task 1; `catalog-drifted` lever → Task 1 negative; cross-tenant RLS → Task 1 negative. §6 item 2 (seed-pinned `sample()` for all three families) → Tasks 2/3/4; "keyed on manifest seed + handle id, exactly as the Normal sample path" → `makeRng(`${seed}::${handle.id}`)` (the Normal path's exact keying). The design note §7 S4b's two concerns map to Task 1 (replay proof) + Tasks 2-4 (sample).
- **Type consistency:** `drawEventTimes` / `summarizeEventTimes` (Task 2) are imported by Tasks 3 (both) + 4 (`summarizeEventTimes` only — KM has its own step-scan loop). `SampleResult`/`SampleOpts`/`SampleOptsSchema` used uniformly. The KM handles-cache widen (`+ curve: KmCurve`) is the only struct change and is local to Task 4.
- **Wave lessons baked in:** ~40% censoring in fixtures; ≥2-effect HR tests + harmful HR>1 direction; KM shared-horizon + non-crossing finite floor; same-seed-byte-identical determinism witness on every sampler; finite-clamp guarding `canonicalJsonStringify`.
