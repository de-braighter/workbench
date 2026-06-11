# B3-S5b — §11 synthetic-cohort validation gate suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The charter §11 regulatory gate — a consolidated, addressable validation suite proving (across all three survival families, in-memory and Prisma byte-identically) that the family recovers well-specified cohorts cleanly and **detects** misspecification, including a two-arm non-PH cohort, before any real-PHI fit.

**Architecture:** Fabricated cohort fixtures (fixed quantile grids, no RNG) drive two detection layers — the per-fit `fitDivergence`/`fitMisfitFlag` from S5a (single-arm) and a two-arm PH residual computed in the suite via `counterfactual()` + `kmSupDivergence`. A DB-gated arm proves the same fabricated cohort yields a byte-identical fit through the in-memory and Prisma evidence adapters.

**Tech Stack:** TypeScript (ESM), vitest (DB-free + DB-gated `vitest.db.config.ts` tiers), the S5a `survival-gof.ts` + `kaplan-meier.ts` math, the three survival adapters, `InMemoryInferenceBackbone`.

**Repo:** `layers/substrate`. **Branch:** cut `feat/b3-s5b-validation-gate` off `origin/main` AFTER S5a merges (depends on the `fitDivergence`/`fitMisfitFlag` fields + survival `counterfactual()`). **No version bump, no publish.** **Test-only** — zero production-source changes; if a task needs a production change, STOP: it belongs in S5a.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `libs/substrate-runtime/src/inference/validation/synthetic-cohorts.ts` (create) | Fabricated cohort fixtures (pure, RNG-free) | 1 |
| `libs/substrate-runtime/src/inference/validation/synthetic-cohorts.spec.ts` (create) | Guards the fixtures themselves (censoring %, non-PH crossing) | 1 |
| `libs/substrate-runtime/src/inference/validation/survival-validation-gate.spec.ts` (create) | The DB-free §11 gate (Layers 1+2, determinism) | 2-4 |
| `libs/substrate-runtime/src/inference/validation/survival-validation-gate.db.spec.ts` (create) | Cross-evidence-adapter byte-identical equivalence (DB-gated) | 5 |

---

## Task 1: Fabricated cohort fixtures

**Files:**
- Create: `libs/substrate-runtime/src/inference/validation/synthetic-cohorts.ts`
- Test: `libs/substrate-runtime/src/inference/validation/synthetic-cohorts.spec.ts`

The fixtures are deterministic (fixed quantile grids, the S1 convention — NO RNG). Provide:
- `wellSpecifiedWeibull(): SurvivalObservation[]` — inverse-CDF Weibull(λ=10,k=1.5) on a 200-point grid, light right-censor at t=20.
- `wellSpecifiedLogLogistic(): SurvivalObservation[]` — inverse-CDF log-logistic(α=10,β=2) grid.
- `misspecified(): SurvivalObservation[]` — a cohort whose empirical hazard NO parametric AFT family matches: a 50/50 mixture of an early event cluster (t≈1) and a late cluster (t≈15), producing a plateau-then-drop (bathtub-ish) KM that Weibull/log-logistic cannot follow.
- `twoArmProportional(): { baseline: SurvivalObservation[]; treatment: SurvivalObservation[]; logHr: number }` — treatment is a TRUE constant-HR transform of baseline (HR=0.6): draw baseline from Weibull(10,1.5); the treatment arm is Weibull with the SAME shape and a scale satisfying the proportional-hazards relation, so `S_treat(t) = S_base(t)^0.6` holds at the population level. `logHr = Math.log(0.6)`.
- `twoArmNonProportional(): { baseline; treatment; logHr }` — treatment CROSSES baseline (early protection, late harm): a time-varying HR no single constant HR reproduces. `logHr` is the best-fit average (still declared as one effect), against which the residual must spike.

- [ ] **Step 1: Write the fixture-guard test**

```ts
import { describe, expect, it } from 'vitest';
import * as fx from './synthetic-cohorts.js';
import { kaplanMeier } from '../math/kaplan-meier.js';

describe('synthetic cohort fixtures', () => {
  it('wellSpecifiedWeibull is mostly-observed (a clean fit target)', () => {
    const c = fx.wellSpecifiedWeibull();
    expect(c.length).toBe(200);
    expect(c.filter((o) => o.eventObserved).length / c.length).toBeGreaterThan(0.8);
  });
  it('twoArmNonProportional curves actually CROSS (the non-PH signature)', () => {
    const { baseline, treatment } = fx.twoArmNonProportional();
    const kb = kaplanMeier(baseline), kt = kaplanMeier(treatment);
    // early: treatment above baseline; late: treatment below baseline
    expect(kt.survivalAt(2)).toBeGreaterThan(kb.survivalAt(2));
    expect(kt.survivalAt(12)).toBeLessThan(kb.survivalAt(12));
  });
  it('twoArmProportional curves do NOT cross (S_treat ≈ S_base^0.6)', () => {
    const { baseline, treatment } = fx.twoArmProportional();
    const kb = kaplanMeier(baseline), kt = kaplanMeier(treatment);
    expect(kt.survivalAt(5)).toBeGreaterThan(kb.survivalAt(5)); // protective everywhere
    expect(kt.survivalAt(12)).toBeGreaterThan(kb.survivalAt(12));
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run src/inference/validation/synthetic-cohorts.spec.ts`).
- [ ] **Step 3: Implement** the fixtures (pure inverse-CDF on fixed grids; `recordedAtIso: '2026-01-01T00:00:00Z'` on every observation — the asOf filter silently drops rows without it, the S4b gotcha).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `test(substrate): B3-S5b — fabricated survival cohort fixtures (well-specified, misspecified, two-arm PH/non-PH)`.

---

## Task 2: Layer-1 detection — per-fit `fitMisfitFlag` across all three families

**Files:**
- Create: `libs/substrate-runtime/src/inference/validation/survival-validation-gate.spec.ts`

- [ ] **Step 1: Write the test** (drive each family's adapter via `InMemoryInferenceBackbone` from S5a)

```ts
describe('§11 gate — Layer 1: per-fit goodness-of-fit detection', () => {
  it('Weibull: clean on the well-specified cohort (divergence <= τ/2, flag false)', async () => {
    const s = await fitSummary('survival.weibull-aft@1', fx.wellSpecifiedWeibull());
    expect(s.fitMisfitFlag).toBe(false);
    expect(s.fitDivergence).toBeLessThanOrEqual(ksThreshold(nEvents(fx.wellSpecifiedWeibull())) / 2);
  });
  it('Weibull: DETECTS the misspecified cohort (divergence >= 2τ, flag true)', async () => {
    const cohort = fx.misspecified();
    const s = await fitSummary('survival.weibull-aft@1', cohort);
    expect(s.fitMisfitFlag).toBe(true);
    expect(s.fitDivergence).toBeGreaterThanOrEqual(2 * ksThreshold(nEvents(cohort)));
  });
  it('log-logistic: clean on well-specified, DETECTS misspecified', async () => { /* mirror */ });
  it('Kaplan-Meier: ALWAYS clean (0/false) — the model-free reference never misfits', async () => {
    const s = await fitSummary('survival.kaplan-meier@1', fx.misspecified());
    expect(s.fitDivergence).toBe(0);
    expect(s.fitMisfitFlag).toBe(false);
  });
});
```

Use a `fitSummary(familyRef, cohort)` helper: register the indicator with that `familyRef` + seed the cohort via `withSurvivalObservations`, run `posterior`, return `handle.summary as SurvivalSummary`. `nEvents`/`ksThreshold` imported from the S5a math.

- [ ] **Step 2: Run → FAIL** (helper/asserts not yet present), then **Step 3: implement** the helper + cases, **Step 4: Run → PASS**, **Step 5: Commit** — `test(substrate): B3-S5b — §11 Layer-1 per-fit misfit detection (3 families)`.

> **Margin, not knife-edge (spec risk 1):** assert well-specified ≤ τ/2 and misspecified ≥ 2τ. If a fixture lands in the dead band, RE-TUNE THE FIXTURE (sharper separation), never the threshold.

---

## Task 3: Layer-2 detection — two-arm PH residual via `counterfactual()`

**Files:**
- Modify: `survival-validation-gate.spec.ts`

- [ ] **Step 1: Write the test**

```ts
describe('§11 gate — Layer 2: two-arm proportional-hazards residual', () => {
  // residual(arm) = sup |S_base(t)^HR - S_treatKM(t)| over treatment event times,
  // where S_base^HR is the counterfactual (intervention) curve from the baseline fit.
  it('proportional two-arm cohort: residual is SMALL (the constant-HR model fits both arms)', async () => {
    const { baseline, treatment, logHr } = fx.twoArmProportional();
    const r = await phResidual('survival.weibull-aft@1', baseline, treatment, logHr);
    expect(r).toBeLessThan(0.1);
  });
  it('non-PH two-arm cohort: residual SPIKES (constant HR cannot reproduce a crossing curve)', async () => {
    const { baseline, treatment, logHr } = fx.twoArmNonProportional();
    const r = await phResidual('survival.weibull-aft@1', baseline, treatment, logHr);
    expect(r).toBeGreaterThan(0.25);
  });
});
```

`phResidual(familyRef, baseline, treatment, logHr)`: register the indicator + seed the BASELINE arm; declare ONE survival effect `magnitudePrior = logHr` on the tree; run `counterfactual()` → take the `counterfactual` (intervention) handle; reconstruct the adjusted curve `S_adj(t) = S_base(t)^HR` from its `parameterValues` + `appliedHazardRatio` (or sample its `survivalAtHorizons`); build the treatment KM with `kaplanMeier(treatment)`; return `kmSupDivergence(t => S_adj(t), kaplanMeier(treatment))`.

- [ ] **Step 2: Run → FAIL**, **Step 3: implement** `phResidual`, **Step 4: Run → PASS**, **Step 5: Commit** — `test(substrate): B3-S5b — §11 Layer-2 two-arm PH residual detection`.

---

## Task 4: GoF determinism witness

**Files:**
- Modify: `survival-validation-gate.spec.ts`

- [ ] **Step 1: Write the test**

```ts
it('the GoF fields are bit-identical across runs and over an interleaved permutation (WS-9 witness)', async () => {
  const cohort = fx.misspecified();
  const a = await fitSummary('survival.weibull-aft@1', cohort);
  const b = await fitSummary('survival.weibull-aft@1', interleave(cohort)); // hand-zipped shuffle, not reverse
  expect(JSON.stringify({ d: a.fitDivergence, f: a.fitMisfitFlag }))
    .toBe(JSON.stringify({ d: b.fitDivergence, f: b.fitMisfitFlag }));
});
```

(`interleave` = the split-and-zip permutation from `weibull-aft.spec.ts` — exercises the sort tiebreak, not mere order.)

- [ ] **Step 2-4:** Run → it should PASS immediately (the math is order-independent); if it does not, that is a real determinism bug in S5a — STOP and fix in S5a, do not paper over it here.
- [ ] **Step 5: Commit** — `test(substrate): B3-S5b — §11 GoF determinism witness`. Then `npm run ci:local` (DB-free, green).

---

## Task 5: Cross-evidence-adapter equivalence (DB-gated)

**Files:**
- Create: `libs/substrate-runtime/src/inference/validation/survival-validation-gate.db.spec.ts`

**Harness to mirror:** `libs/substrate-runtime/src/inference/prisma-evidence-log.find-survival-observations.integration.spec.ts` (S3.5) — how it seeds survival events into the Prisma `event_log` under the NOBYPASSRLS `app` role + resolves the survival `ObservationProjection`. Runs via `--config libs/substrate-runtime/vitest.db.config.ts` (loads `.env`; `SUBSTRATE_APP_DATABASE_URL=app:app@localhost:5544`). DB up via `npm run db:setup`.

- [ ] **Step 1: Write the test**

```ts
it('the SAME fabricated cohort yields a byte-identical SurvivalSummary through in-memory AND Prisma evidence', async () => {
  const cohort = fx.wellSpecifiedWeibull();
  // (a) in-memory evidence path
  const inMem = await fitViaInMemory('survival.weibull-aft@1', cohort);
  // (b) Prisma event_log path: seed the SAME cohort as survival events under the app role,
  //     resolve the survival projection, run posterior through the Prisma EvidenceRepository
  const prisma = await fitViaPrisma('survival.weibull-aft@1', cohort);
  expect(canonicalJsonStringify(stripVolatile(prisma)))
    .toBe(canonicalJsonStringify(stripVolatile(inMem)));
});
```

`stripVolatile` drops the run-volatile manifest fields (`requestId`, `startedAt`, `completedAt`) and compares the SUMMARY (incl. `fitDivergence`/`fitMisfitFlag`) + the stable manifest fields (`seed`, `catalogVersionHash`, `inputHash`, `observationsHash`). The fit + GoF must be identical because the observations are identical; this proves the Prisma read path serves the same cohort the in-memory double does.

- [ ] **Step 2: Run → FAIL** (`npm run ci:local:db` after `npm run db:setup`).
- [ ] **Step 3: Implement** the two fit paths + the seeding (mirror the S3.5 integration spec; the survival projection arm + `findSurvivalObservations` landed in S3.5). Cross-tenant RLS already proven in S3.5 — here the focus is byte-identical equivalence, single tenant.
- [ ] **Step 4: Run → PASS** under the app role (FORCE RLS genuinely bites; superuser would false-pass).
- [ ] **Step 5: Commit** — `test(substrate): B3-S5b — §11 cross-evidence-adapter byte-identical equivalence (DB-gated)`.

---

## Task 6: Full gate + push (first arc complete)

- [ ] **Step 1:** `npm run ci:local` (DB-free) green.
- [ ] **Step 2:** `npm run ci:local:db` (DB up) green — the DB-gated equivalence + the existing survival replay/read tiers.
- [ ] **Step 3:** push `feat/b3-s5b-validation-gate`, open the PR (`Producer:`/`Effort:`/`Effect:`), verifier wave, twin ritual. The PR body states: **closes the B3 survival first arc (S1→S5)** — charter §11 gate satisfied; real-PHI fits now unblocked (behind the gate).

---

## Self-review notes (author)
- **Spec coverage:** §4.1 Layer-1 → Task 2; §4.2 Layer-2 → Task 3; §4.3 cross-adapter → Task 5; §4.4 determinism → Task 4; fixtures → Task 1.
- **Test-only invariant:** no production-source file appears in any S5b task. If a determinism or detection failure surfaces a production bug, it is fixed in S5a (the suite must not paper over it).
- **Margins:** Layer-1 uses ≤τ/2 and ≥2τ; Layer-2 uses <0.1 and >0.25 — both two-sided with a dead band, re-tune fixtures not thresholds.
- **DB role:** the equivalence runs under `app` (NOBYPASSRLS), the S3.5/S4a convention; superuser would BYPASSRLS and false-pass.
