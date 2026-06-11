# B3-S5 — Synthetic-cohort validation + production goodness-of-fit (design)

> **Status:** approved (brainstorming) — the last slice of the B3 survival first arc (S1→S5). Implements the charter §11 regulatory validation gate AND completes decomposition §6 acceptance (survival `counterfactual()`). Two build plans (S5a mechanism, S5b gate suite).
> **Date:** 2026-06-11
> **Ratified design (do not relitigate):** `layers/specs/adr/adr-223-survival-inference-family.md`; decomposition `docs/superpowers/specs/2026-06-09-b3-survival-family-decomposition.md` (§3 S5, §5 risk 4, §6 acceptance).
> **Program context:** [[second-brick-oncology-direction]] — B3 is the in-process survival/time-to-event family, the only net-new kernel modeling in the oncology program. Repo: `layers/substrate` (kernel). Versions: substrate `main` is staged at **2.0.0 (unpublished)**; S5 rides it (no new bump).

## 1. Goal

Validate the survival family against fabricated cohorts **before any real-PHI fit** (charter §11), and — per the founder's scope decision (2026-06-11) — surface goodness-of-fit as a **production signal** the model self-reports at inference time, not merely an offline test. This makes the device auditable: it flags when its parametric model does not fit the data (PCCP-relevant). The slice also lands the deferred survival `counterfactual()`, closing decomposition §6 acceptance for the first arc.

## 2. Founder decisions (2026-06-11 brainstorming)

1. **PH-violation detection → production GoF signal** (not test-only). A goodness-of-fit field on `SurvivalSummary` the adapters populate at inference time; the §11 suite exercises it. **Sanctioned deviation** from the decomposition's "S5 is test-only; the regulatory gate, not a feature" framing — recorded here.
2. **Both detection layers.** A per-fit single-arm parametric GoF on every `SurvivalSummary` **and** a two-arm PH residual exercised via `counterfactual()` + the suite.
3. **`InMemoryInferenceBackbone` gains survival dispatch** — mirror the production router's `familyRef`→adapter dispatch in the test double so survival runs end-to-end through the canonical double.
4. **Naming (recommended, confirm at spec-review):** the single-arm field is `fitMisfitFlag`, not `phViolationFlag` — it fires on *any* shape misspecification, of which PH violation is the headline instance. Honesty over a regulated audit trail.
5. **Build split:** S5a (production mechanism) → S5b (test-only §11 gate suite). Mirrors the proven S4a/S4b mechanism-then-proof pattern.

## 3. Architecture — two detection layers + shared pure math

### 3.1 Shared pure math — `math/survival-gof.ts`

Pure, deterministic, no DI; reused by the adapters (Layer 1) and the suite (Layer 2):

- `kmSupDivergence(parametricS: (t: number) => number, km: KmCurve) → number` — the Kolmogorov-Smirnov-style **supremum distance** `sup_t |S_parametric(t) − S_KM(t)|` over the cohort's distinct event times. Range `[0, 1]`. Evaluated only at event times (KM is a right-continuous step function changing only at events; the sup is attained there).
- `ksThreshold(nEvents: number) → number` — the sample-size-aware critical value `τ(n) = 1.36 / √nEvents` (Kolmogorov–Smirnov α=0.05). Citable, not a magic constant. `nEvents = 0 → τ = +∞` (no events ⇒ never flag; the all-censored path already returns `converged:false`).

Both are pinned by unit tests with hand-computed oracles; both are referenced by `distributionCatalogVersionHash` indirectly only if the recipe changes (the divergence is derived at read-time, not a catalog parameter — no hash impact).

### 3.2 Layer 1 — per-fit parametric goodness-of-fit (production, on every `SurvivalSummary`)

- **Contract (Ring-0, additive, rides 2.0.0):** `SurvivalSummary` gains
  - `readonly fitDivergence: number` — the `kmSupDivergence` of the fitted parametric `S(t)` against the cohort's **own** empirical KM (built internally from the same observations).
  - `readonly fitMisfitFlag: boolean` — `fitDivergence > ksThreshold(nEvents)`. Deterministic given the cohort, so replay stays bit-identical.
  - Mirrored into `SurvivalSummarySchema` (Zod) — additive; the `PosteriorSummaryOrSurvival` union and the raw-input superRefine gate (S3.5) are unaffected.
- **Adapters:** `WeibullAftAdapter` + `LogLogisticAftAdapter` already fit; they additionally build the internal KM (existing `math/kaplan-meier.ts`) and call `kmSupDivergence`. **Precision (load-bearing):** the comparison is the fitted **baseline** `S(t)` (the pre-HR MLE curve over the cohort that produced it) against that **same cohort's** KM — NOT the HR-*adjusted* `survivalAtHorizons` curve the summary reports. The cohort is the baseline evidence the MLE consumed; comparing the HR-shifted curve to the baseline KM would be a category error. `KaplanMeierAdapter` reports `fitDivergence: 0`, `fitMisfitFlag: false` — it **is** the model-free reference, so it never misfits by this measure (documented invariant).
- **Replay/manifest:** the two fields are part of the summary → already persisted/replayed by the unchanged S4a/S4b mechanism; the replay-bit-identical proof now covers them.

### 3.3 Layer 2 — two-arm PH residual (the literal PH-violation check)

- **Survival `counterfactual()` implemented** (closes the S2-deferred envelope + decomposition §6 acceptance): returns `{ baseline, counterfactual }` — the baseline fit handle + the HR-adjusted handle — **sharing one `RunManifest`** (mirror `NormalNormalFastPathAdapter.counterfactual`; the EB-hierarchical paired-manifest gap (ADR-165 Inv-5) does NOT apply to the survival fast path). No change to the shared `CounterfactualResult` shape.
- **The PH residual is a §11-suite assertion** (test-only): the suite fabricates a two-arm cohort, computes the treatment arm's KM, obtains the constant-HR-adjusted baseline curve via `counterfactual()`, and measures `sup |S_base(t)^HR − S_treatKM(t)|` with the same `kmSupDivergence` helper. Non-PH (crossing / time-varying HR) ⇒ residual spikes (detected); proportional ⇒ small. No new production field on `CounterfactualResult`.

### 3.4 `InMemoryInferenceBackbone` survival dispatch

`posterior()`/`sample()`/`counterfactual()` gain a `familyRef`→survival-adapter branch mirroring the production router (precedence: `familyRef` before `conjugateHint`). Reuses the same adapter instances; closes the silent `not-implemented-phase-1` fall-through for survival indicators. The §11 suite + future health-product tests drive survival through the canonical double exactly as production dispatches.

## 4. S5b — the §11 gate suite (fabricated cohorts, test-only)

A consolidated, addressable validation suite (the regulatory artifact). It cross-references the existing per-family recovery/censoring/left-truncation/determinism proofs (S1 math specs) rather than duplicating them, and **adds** the family-level + cross-family assertions:

1. **Layer-1 detection:** for all three families, `fitDivergence`/`fitMisfitFlag` **spikes** on the non-PH (misspecified) cohort and stays **clean** on the well-specified cohort.
2. **Layer-2 detection:** the two-arm PH residual via `counterfactual()` spikes on the non-PH cohort, small on the proportional cohort.
3. **Cross-evidence-adapter equivalence (DB-gated):** the same fabricated cohort served through **in-memory** `registerSurvivalObservations` and **Prisma** `findSurvivalObservations` yields a **byte-identical** fit + summary (incl. the new GoF fields). Runs under the NOBYPASSRLS `app` role via `--config libs/substrate-runtime/vitest.db.config.ts` (the S3.5/S4a convention; superuser would BYPASSRLS and false-pass).
4. **GoF determinism:** the new fields are bit-identical across two runs + a non-trivial interleaved permutation (the WS-9 witness, extended to the GoF fields).

**Fabricated cohorts (no RNG — fixed quantile grids, the S1 convention):**
- *Well-specified:* Weibull(λ,k) and log-logistic(α,β) cohorts at the generating shape (clean fit, low divergence).
- *Misspecified / non-PH:* a cohort whose hazard shape the parametric family cannot match (e.g. a bathtub/crossing-hazard mixture), and a **two-arm** cohort with a deliberately **time-varying** HR (crossing survival curves) — the constant-HR proportional model cannot reproduce both arms.

## 5. Risk register (deltas over the decomposition's)

1. **GoF threshold calibration.** `τ(n) = 1.36/√n` must cleanly separate the well-specified (below) from the misspecified (above) cohorts at the chosen cohort sizes. **Mitigation:** the suite asserts a *margin* on both sides (well-specified divergence ≤ τ/2; misspecified ≥ 2τ), not a knife-edge; the cohort sizes are fixed so `τ` is fixed.
2. **`fitDivergence` must not break replay determinism.** It is derived from the fitted `S(t)` + the cohort KM, both already deterministic; the sup-scan is order-independent over the sorted event times. **Mitigation:** the GoF-determinism assertion (S5b item 4) + the field rides the existing bit-identical replay proof.
3. **Honest naming under audit.** A field named for PH violation that fires on general misfit misleads a notified body. **Mitigation:** `fitMisfitFlag` + a documented "PH violation is the headline trigger, not the only one"; the literal PH check is the Layer-2 two-arm residual.
4. **Counterfactual manifest sharing.** Survival `counterfactual()` must share one `RunManifest` across the paired handles (§6). **Mitigation:** mirror the Normal fast-path counterfactual verbatim; a suite assertion that both handles carry the same manifest id.

## 6. Acceptance (first arc complete)

`SurvivalSummary` carries a self-reported `fitDivergence`/`fitMisfitFlag` on every parametric fit (KM = 0/clean reference); survival `counterfactual()` returns baseline-vs-HR curves sharing one `RunManifest`; the §11 suite proves — across all three families, in-memory and Prisma byte-identically — that the family recovers well-specified cohorts cleanly and **detects** (does not silently absorb) misspecification, including a two-arm non-PH cohort; the GoF fields replay bit-identically; `ConjugateHint` unchanged; zero new tables; the widen rides the staged 2.0.0. This closes the B3 first arc (S1→S5).

## 7. Non-goals (unchanged from the decomposition)

- Exercising the live `kernel.event_log` survival read against **real seeded events** — the read machinery + projection arm landed in S3.5; S6 (second arc) is "a real cohort arrives + seed events," triggered by real data.
- The async population-refit job.
- The NumPyro/JAX sidecar (full Bayesian posterior).
- Real-PHI fits (gated behind this §11 gate).
- A production *auto-block* on `fitMisfitFlag` (the device flags; gating an inference on the flag is a later policy decision, not this slice).

## 8. Publish

Rides the staged **2.0.0** (the `SurvivalSummary` widen is additive on the already-unpublished major — no new bump). The accumulated first-arc contracts widens (`policy.strategy:'survival-fast-path'`, the `'unknown-family'` code, the S3.5 projection arm, the S4a event schema, the trajectories-semantics doc, and now the GoF fields) publish together in the coordinated 2.0.0 release per `docs/migration-substrate-2.0.md`.
