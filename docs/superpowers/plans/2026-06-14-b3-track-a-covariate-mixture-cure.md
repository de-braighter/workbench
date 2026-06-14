# Implementation plan — B3 Track A: the covariate mixture-cure survival family (subject-specific Y(0))

> **Spec:** `layers/specs/adr/adr-233-covariate-mixture-cure-survival-family.md` (ADR-233, `status: proposed`,
> founder-greenlit). **Repo:** `layers/substrate` (branch `b3-track-a-covariate-mixture-cure` off `origin/main`).
> **Family:** `survival.mixture-cure-weibull-covariate@1`. **Standard:** Rolls-Royce / premium; subagent-driven,
> per-task TDD; opus on the crux (CR2 math). **Mirrors the shipped ADR-232 competing-risks CR1–CR6 pipeline.**

## What ships (ADR-233 recorded verdicts)

- **Contract (Ring 0, additive minor → 2.5.0):** `SurvivalObservation.covariates?: Record<string, number>` (the
  fit's design-matrix carrier; the ADR-232 `eventType?` precedent) + the projection read-path `covariatePaths?`.
  The π-logit **compose** channel + the channel discriminator add **zero field** (semantic-derive, D4).
- **Runtime (Ring 1 — where the real work is):** the **covariate-EM** (IRLS logistic M-step on π) + the new
  adapter (π-logit channel + susceptible log-HR channel + Y(0)-vs-treated partition by claim type + semantic
  channel-derive) + the 8th catalog row + router/backbone branch + the production read + the §11 per-stratum gate.
- **No new kernel table.** β rides `kernel.run_manifest`; the subject-conditioned π rides the shipped
  `SurvivalSummary.cureFraction?`.

## The model (ADR-233 D1/D2/D3)

```text
logit(π_i)  = β₀ + Σ_j β_j·x_ij                     # per-subject cure fraction (the covariate-EM fits β)
S_i(t)      = π_i + (1 − π_i)·S₀(t)                  # mixture survival; S₀ = susceptible Weibull (unchanged)

# Inference-time conditioning (compose channels, partitioned by ADR-230 claim type):
S₀_i(t)        = S_base(t) ^ exp(Σ prognostic logHR)            # susceptible log-HR channel (existing)
logit(π_i^Y0)  = β₀ + Σβ_j x_ij + Σ prognostic Δlogit          # π logit-channel (NEW compose target)
S_i^Y0(t)      = expit(logit(π_i^Y0)) + (1−…)·S₀_i(t)          # Y(0): prognostic-only, both channels
logit(π_i^Y1)  = logit(π_i^Y0) + Σ treatment Δlogit            # Y(1): + treatment Δlogit on π
S_i^Y1(t)      = expit(logit(π_i^Y1)) + (1−…)·S_base(t)^exp(Σ prognostic+treatment logHR)
```

The Δlogit composes on the **existing** `composeEffects` sum-over-normals fold (byte-unchanged; `compositionOperator:'sum'`),
a **second compose target** (π via `expit`) beside the susceptible hazard (via `exp`). No new operator.

## Determinism contract (the WS-9 / B3 replay foundation — every task preserves it)

- Observations sorted by the exact ADR-231 key `(durationT asc, eventObserved asc, entryT asc)` before any accumulation.
- **Design-matrix column order = the sorted covariate-key set** (a deterministic function of the data; never a
  `Map`/`Set` iteration order). Pin it in the catalog `fit` recipe.
- Pinned init (`β = 0`, susceptible `λ₀,k₀ = fitWeibullAft`), tolerances, iteration caps for the outer EM, the
  inner profile-Newton, AND the inner IRLS. Pure IEEE-754; no `Math.random`. Bit-identical across runs + shuffled inputs.

---

## Tasks (each: RED failing test → GREEN impl → adversarial review; opus where noted)

### CR1 — Contract: `SurvivalObservation.covariates?` + the projection read-path (substrate-contracts)
- `libs/substrate-contracts/src/inference/inference-types.ts`: add `readonly covariates?: Record<string, number>`
  to `SurvivalObservation` (additive OPTIONAL; absent = the existing-family default; doc-comment the ADR-232
  `eventType?` honest-typing precedent + that existing families ignore it).
- `libs/substrate-contracts/src/inference/observation-projection-zod.ts`: add `covariatePaths?: Record<string, JsonPath>`
  to the survival arm (mirror `eventTypePath?`; the raw-input superRefine survival-strict gate must still hold —
  the ADR-223 S3.5 Zod two-arm gotcha; do NOT `.strict()` the moment arm).
- **TDD:** Zod spec — a survival projection with `covariatePaths` parses; existing survival/moment projections
  still parse unchanged (non-breaking); the field is optional. Grep `kind: 'survival'`/`SurvivalObservation`
  fixtures for required-field cascades (none expected — it's optional — but verify, per the S5a cascade lesson).
- **Cascade guard:** `npx nx build substrate-contracts` (the real tsc) green; no consumer break.

### CR2 — The covariate-EM math (THE CRUX — opus implementer + adversarial review)
- New module `libs/substrate-runtime/src/inference/math/mixture-cure-weibull-covariate.ts`. Generalizes
  `mixture-cure-weibull.ts`: the E-step uses the **per-subject** `π_i = expit(β₀ + Σβ_j x_ij)`; the **M-step π
  becomes a deterministic weighted IRLS logistic regression** of the cure-status weights `w_i` on the per-subject
  covariate rows → the coefficient vector `β`. The **g-weighted susceptible AFT M-step is UNCHANGED** (reuse the
  exact profile-Newton from `mixture-cure-weibull.ts`). Export `fitCovariateMixtureCureWeibull(observations, X)`
  where `X` is the deterministically-ordered design matrix (incl. the intercept column), returning
  `{ beta: number[], scale, shape, converged, iterations }`. Pure + total (no throws); unidentifiable cohort
  (no events / singular design) → a typed non-convergence (`converged:false`), the `cohort-too-small` analog.
- **TDD (the deterministic battery — no Stryker in substrate; rely on this):**
  - **β recovery:** synthetic cohort with KNOWN `β` (logit(π_i)=β₀+Σβ_j x_ij), correct cure mechanism (cure ~
    Bernoulli(π_i); cured → censored past the plateau; susceptible → Weibull latency). Recover `β` (+ λ,k) within tol.
  - **Determinism witness:** run-twice + shuffled-input byte-identical `{β,λ,k}` (the design-matrix column order
    must be data-determined). This is the WS-9 replay guard.
  - **EDGE REGIMES (the ADR-232 k<1 CIF-singularity lesson — span the regimes or the test cannot catch the bug):**
    extreme covariate values (large |x| → π_i near 0 and near 1; expit saturation → IRLS weight `π(1−π)→0`,
    guard the singular-weight / separation case deterministically); a sparse covariate (a stratum with few
    events → under-identified `β_j`, must degrade gracefully not NaN); the `J=0` degenerate (reduces to ADR-231's
    `π=mean(w)` — assert it matches `fitMixtureCureWeibull` to tolerance); perfect-separation (a covariate that
    perfectly predicts cure → bounded β via the iteration cap, not divergence).
  - **Susceptible M-step unchanged:** assert the g-weighted profile-Newton path matches the ADR-231 module on a
    `J=0` cohort.

### CR3 — The adapter (substrate-runtime; opus — the compose-channel logic is load-bearing)
- New `libs/substrate-runtime/src/inference/adapters/mixture-cure-weibull-covariate.adapter.ts`, mirroring
  `mixture-cure-weibull.adapter.ts`. Adds:
  - **Fit** via `fitCovariateMixtureCureWeibull` (CR2): read the cohort observations (incl. `covariates`),
    assemble the deterministic design matrix, fit `β,λ,k`.
  - **Two compose channels:** susceptible log-HR (existing `extractLogHrOrErr` → `S₀^HR`) **+** the π-logit
    channel (a parallel `extractLogitOrErr` → `Δlogit`; `logit(π_i)=β₀+Σβ_j x_ij + Δlogit`, `π_i=expit(…)`).
    Both ride the existing fold; the only new thing is the `expit` target.
  - **Channel discriminator (semantic-derive, D4):** route an effect to the π-channel vs the hazard-channel from
    the indicator binding (a `cure-fraction` channel marker in the indicator metadata) — NO new EffectDeclaration field.
  - **Y(0)-vs-treated partition (ADR-230 D2 on the π-channel):** `posterior()`/`counterfactual()` partition the
    composed effects by claim type — prognostic → both-channel baseline (Y(0)); treatment → the contrast (Y(1)).
  - **Summary:** `SurvivalSummary` with the **subject-conditioned** `cureFraction: π_i` (the shipped field), the
    susceptible `{scale,shape}` in `parameterValues`, the JSON-safety plateau-quantile fallback (reuse the
    `adjQuantileTime` pattern: `1−p ≤ π_i → maxEventTime`, never Inf/NaN — `canonicalJsonStringify` throws on
    non-finite **under the conditioned π_i**, so test π_i≥0.5 → median fallback).
  - **Replay manifest:** identical structure to the mixture-cure adapter (seed/engineVersion/catalogVersionHash/
    inputHash/observationsHash). β rides the manifest (recomputed on replay).
- **TDD:** posterior over a covariate cohort → subject-conditioned summary; ≥2-effect log-fold on BOTH channels
  (the S2 lesson: ≥2 effects to distinguish `exp(Σ)`/`expit(Σ)` from `first`); harmful + beneficial directions;
  counterfactual baseline-vs-treated (π identical on both ONLY when no treatment-on-π; treatment-on-π → Y(1) plateau
  ≠ Y(0)); the GoF reuse (`kmSupDivergence` on the fitted-mixture vs cohort KM); JSON-safety under π_i≥0.5.

### CR4 — Catalog row + migration (substrate-runtime; standard implementer)
- `libs/substrate-runtime/src/reproducibility/in-memory-distribution-catalog.ts`: add the **8th** seed
  `MIXTURE_CURE_WEIBULL_COVARIATE_DISTRIBUTION_SEED` (`name: 'survival.mixture-cure-weibull-covariate@1'`,
  `conjugateWith: []`, every fit scalar a STRING token: `method:'em-mixture-cure-covariate'`, IRLS `irlsTol`/
  `irlsMaxIter`, outer `tol`/`maxIter`, inner profile `innerTol`/`innerMaxIter`, the `covariateOrder:'sorted-keys'`
  determinism rule, `order:'durationT asc, eventObserved asc, entryT asc'`). Add it to the default 7→8 seed list.
- **Migration:** `prisma/migrations/2026061403xxxx_kernel_b3_covariate_mixture_cure_weibull_catalog_row/migration.sql`
  — INSERT-only `ON CONFLICT DO NOTHING`; the JSONB literal MUST byte-equal `JSON.stringify(parameterSchema)` of
  the seed (derive it that way; the B3-S3 JSONB-float gotcha).
- **TDD / digest:** the default `catalogVersionHash` ripples 7→8 rows — **recompute the new digest LIVE** (run the
  hash, never guess) and update every pinned-digest / row-count test (`prisma-survival-catalog.contract.spec.ts`
  etc.). Recipe-versioning test: tightening a fit scalar changes the hash.

### CR5 — Router + in-memory backbone dispatch (substrate-runtime; standard implementer)
- `libs/substrate-runtime/src/inference/inference-backbone-router.ts`: one `*_FAMILY_NAME` constant + one
  familyRef branch `survival.mixture-cure-weibull-covariate` → the new adapter (posterior/counterfactual/sample);
  unknown family stays `validation-failed` (no silent fallthrough). Construct the adapter inside the router (no
  composition-root change), mirroring the six existing survival families.
- `libs/substrate-runtime/src/inference/testing/in-memory-inference-backbone.ts`: the familyRef→survival dispatch
  gains the covariate family (route to its REAL adapter sample, not a stub).
- **TDD:** router dispatch spec (the new family resolves to the new adapter; the 6 existing families unchanged;
  unknown→validation-failed); backbone posterior/counterfactual/sample over the new family.

### CR6 — Production read (covariates) + DB equivalence + §11 validation gate
- **Production read:** `prisma-evidence-log.repository.ts` `findSurvivalObservations` — when the projection
  carries `covariatePaths`, read each covariate via `evalNumber` per path into `covariates` (mirror the
  `eventTypePath` read, lines ~375-405). Value-invariant guard: a non-finite covariate skips+logs the row (the
  trust-boundary discipline — a poisoned covariate must not reach the IRLS `Math.exp`).
- **DB equivalence:** a DB-gated spec — cross-evidence-adapter byte-identical `SurvivalSummary` (in-memory ↔
  Prisma) on a covariate cohort, under the `app` NOSUPERUSER role (`assertNonSuperuser`; FORCE RLS bites).
- **§11 validation gate** (the founder's named rigor; ADR-233 D7 MUST-list; test-only, mirror the
  competing-risks `survival-validation-gate.spec.ts`): synthetic cohorts asserting (1) β recovery, (2) distinct
  profiles → distinct plateaus + curves, (3) predicted-vs-observed-untreated calibration on the plateau, (4) a
  treatment-on-π contrast (Δlogit>0 → Y(1) plateau strictly > Y(0)), (5) per-stratum identifiability — a stratum
  with no censoring past its plateau is flagged misfit, not confidently-wrong. Plus replay: posterior(`manifest:'event'`)
  → F1 emit + run_manifest persist → `replay()` bit-identical `{β,λ,k}` + per-subject π.

---

## Gates (after all CRs green)
- `npm run ci:local` (DB-free) + `npm run ci:local:db` (DB up) green.
- Verifier wave: charter-checker (registry-extensible + semantic-derive-no-storage per ADR-230 §5; the one
  `covariates?` field is the minimal honest fit-input carrier, the ADR-232 `eventType?` precedent, NOT kernel
  creep) · reviewer (the IRLS math + JSON-safety + determinism) · qa.
- **PR-first ritual:** open the PR BEFORE the wave with `Producer:`/`Effort:`/`Effect:` lines; post-findings before
  merge. Bump substrate **contracts + runtime → 2.5.0** (a field was added → contracts bumps too). Merge + publish
  (contracts FIRST, runtime deps `^2.5.0`) + twin ritual (drain/backfill/post-findings/reviews/reconcile/retro).

## Gotchas (carried from b3-mixture-cure + competing-risks)
- `git -C <abs>` for EVERY git op (parallel Bash shares cwd). `git fetch origin` before any ff/diff/publish
  (stale-main trap). origin/main MOVES during long builds → re-fetch + merge, keep the higher version bump.
- The catalog digest ripples when a row is added — recompute LIVE, never guess; migration JSONB must byte-equal
  `JSON.stringify(parameterSchema)`; all fit scalars STRING tokens.
- `npx vitest` (transpile-only) for per-task RED/GREEN; `nx build` (tsc -b) for the authoritative typecheck. Verify
  green with `--skip-nx-cache` (the nx-cache-masks-failures lesson). Run the FULL affected-package tier (cache off)
  before declaring a contract widen done (the required-field-cascade lesson — though `covariates?` is optional).
- DB tier runs via `--config libs/substrate-runtime/vitest.db.config.ts` (loads `.env`); DB suites use the `app`
  role (NOSUPERUSER+NOBYPASSRLS). substrate has NO Stryker — skip mutation-t2, rely on the deterministic battery.
