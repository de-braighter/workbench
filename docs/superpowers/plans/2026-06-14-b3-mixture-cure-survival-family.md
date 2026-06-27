# Implementation plan — B3 cure-fraction (mixture-cure) survival family (ADR-231)

**ADR:** ADR-231 (specs PR #310, `status: proposed`, founder-greenlit 2026-06-14).
**Repo:** `layers/substrate`, branch `b3-mixture-cure-family` (off `origin/main`).
**Outcome:** a `survival.mixture-cure-weibull@1` family that lets the untreated baseline plateau above 0, riding the existing ADR-223 + ADR-220 surfaces with one additive optional contract field.

Mirrors the proven B3-S1…S5 build pattern: deterministic in-process MLE, log-space HR on the
susceptible hazard (byte-unchanged effect algebra), catalog-row-per-family, WS-9 replay, §11 GoF gate.

## Model (ADR-231 D1/D2/D3)

```text
S(t)      = π + (1 − π) · S₀(t)                       # mixture survival; plateau lim_{t→∞} = π
S₀(t)     = weibullSurvival(t, λ, k)                  # susceptible-subpopulation Weibull (decays to 0)
S_adj(t)  = π + (1 − π) · S₀(t)^HR                    # HR moves ONLY the susceptible hazard (D3)
HR        = exp(Σ logHR over treatment-effect declarations)   # existing composeEffects fold, unchanged
```

Params: `{ cureFraction π ∈ [0,1], susceptible shape k, susceptible scale λ }`.

## Tasks (subagent-driven, per-task RED→GREEN; controller commits)

### T1 — Contracts: `SurvivalSummary.cureFraction?` + Zod + version bump
- `libs/substrate-contracts/src/inference/inference-types.ts` — add `readonly cureFraction?: number; // ∈[0,1]; present iff a cure-mixture family` to `SurvivalSummary` (after `fitMisfitFlag`), with a doc comment (honest-typing: absent = no cure component vs present-small = estimated zero).
- `libs/substrate-contracts/src/inference/inference-zod.ts` — add `cureFraction: z.number().min(0).max(1).optional()` to `SurvivalSummarySchema`.
- Bump `libs/substrate-contracts/package.json` and `libs/substrate-runtime/package.json` `2.1.0 → 2.2.0` (and the runtime's dep on contracts if it pins an exact/`^` range — verify). Additive minor.
- **RED→GREEN:** a unit spec asserting `SurvivalSummarySchema` parses a summary WITH and WITHOUT `cureFraction`, and that the `PosteriorSummaryOrSurvivalSchema` union still discriminates correctly. Run `nx build substrate-contracts` (the real tsc) — the field must compile in.

### T2 — Math: `inference/math/mixture-cure-weibull.ts` (the crux)
Reuse `weibullSurvival`/`weibullDensity`/`weibullHazard`/`weibullQuantile` from `weibull-aft.ts` for S₀.
Export:
- `mixtureCureSurvival(t, π, λ, k)` = `π + (1−π)·weibullSurvival(t,λ,k)`.
- `mixtureCureDensity(t, π, λ, k)` = `(1−π)·weibullDensity(t,λ,k)`.
- `interface MixtureCureWeibullFit { cureFraction, scale, shape, converged, iterations }`.
- `fitMixtureCureWeibull(observations): MixtureCureWeibullFit` — deterministic **EM** (Boag/Berkson–Gage):
  - **Determinism:** sort observations by `(durationT asc, eventObserved asc, entryT asc)` first (same key as `fitWeibullAft`); pinned init; no `Math.random`; pure IEEE-754.
  - **Init (pinned, documented):** `(k₀, λ₀)` = `fitWeibullAft(observations)`; `π₀ = clamp(censoredFraction, 0.01, 0.99)` where `censoredFraction = (#censored)/n`. If no events → unidentifiable → `{cureFraction:NaN, scale:NaN, shape:NaN, converged:false, iterations:0}`.
  - **E-step:** for each subject, `w_i = P(cured | data)`: event (`eventObserved`) → `0`; censored at t → `π·1 / (π + (1−π)·S₀(t))` (the cured-posterior; with left-truncation use the conditional, but v1 may treat entryT in the M-step weighting only — document the simplification). Susceptible weight `g_i = 1 − w_i`.
  - **M-step π:** `π = mean(w_i)`.
  - **M-step (k,λ):** a **weighted** right-censored Weibull profile MLE with weights `g_i` (events `g=1`):
    - profile scale `λ(k)^k = (Σ_all g_i·(t_i^k − e_i^k)) / d` where `d = #events`, `e_i = entryT` (left-trunc subtraction as in `fitWeibullAft`);
    - profile score `g(k) = 1/k + (Σ_events ln t_i)/d − (Σ_all g_i·B_i)/(Σ_all g_i·A_i)` with `A_i = t_i^k − e_i^k`, `B_i = t_i^k ln t_i − e_i^k ln e_i`; Newton with derivative analogous to `fitWeibullAft` (add the `C_i` term, all g-weighted). **Write this weighted profile inline in this module — do NOT modify `weibull-aft.ts`.**
  - **Convergence:** iterate until `|Δπ| + |Δk| ≤ TOL` (e.g. 1e-8) or `MAX_ITER` (e.g. 500); `converged` reflects it.
- **RED→GREEN tests (`mixture-cure-weibull.spec.ts`):**
  1. **Recovery on a heavily-censored cure cohort:** fabricate (deterministic quantile-grid, NO RNG) a cohort from known `(π=0.3, λ=10, k=1.5)`: susceptible event times on a quantile grid + a cured block censored at a large `tMax`. Assert `fitMixtureCureWeibull` recovers π, λ, k within tolerance.
  2. **Adversarial ignore-cure (the B3 censored-likelihood lesson):** a plain `fitWeibullAft` on the SAME cure cohort lands OUT of band (it cannot represent the plateau) — assert the mixture fit is materially better (lower `kmSupDivergence` vs the cohort KM).
  3. **Identifiability caveat:** a cohort with NO censoring past the plateau → π under-identified; assert `converged===false` OR a high `kmSupDivergence` (document which the algorithm yields).
  4. **Determinism witness:** run-twice + shuffled-input byte-identical `JSON.stringify(fit)`.
  5. Closed-form spot-checks: `mixtureCureSurvival(∞-ish, …) ≈ π`; `mixtureCureSurvival(0,…)=1`.

### T3 — Adapter: `inference/adapters/mixture-cure-weibull.adapter.ts`
Mirror `WeibullAftAdapter` exactly (same deps shape, `resolveCatalogVersionHash`, manifest building, `extractLogHrOrErr` copied verbatim — the 4th survival copy; keep the in-sync comment).
- `MIXTURE_CURE_WEIBULL_ADAPTER_ID = 'mixture-cure-weibull-v1'`.
- `posterior`: fit via `fitMixtureCureWeibull`; not-converged → `cohort-too-small`. GoF: `kmSupDivergence((t)=>mixtureCureSurvival(t, π, λ, k), km, tMax)` vs the cohort KM (the **fitted mixture** curve, pre-HR — so a good mixture fit on a cure cohort scores LOW, while a plain Weibull would score ≈π high). HR via `extractLogHrOrErr` (point → log-HR; random → `effect-not-conjugable` deferral, same as Weibull).
- `buildMixtureCureSurvivalSummary({familyRef, fit, appliedHazardRatio, fitDivergence, fitMisfitFlag, maxEventTime})`:
  - `S_adj(t) = π + (1−π)·weibullSurvival(t,λ,k)^HR`.
  - **Quantile inversion with plateau fallback (JSON-safety — the load-bearing gotcha):** target `S_adj(t)=1−p`. Reachable iff `1−p ≥ π` (since `S_adj` decreases 1→π). If reachable: `S₀(t) = ((1−p−π)/(1−π))^(1/HR)` → `t = weibullQuantile(1 − S₀target, λ, k)`. If **unreachable** (`1−p < π`, e.g. median when π≥0.5): fall back to `maxEventTime` (the largest event `durationT`) — **never Infinity/NaN** (mirrors the `KaplanMeierAdapter` non-crossing fallback; `canonicalJsonStringify` throws on non-finite).
  - `parameterValues: { scale, shape }` (susceptible); **`cureFraction: π`** as the top-level optional field.
  - `survivalAtHorizons` at `[median, 2×median]` using `S_adj`; `hazardAtHorizon` = population hazard `f_adj(median)/S_adj(median)` where `f_adj(t)=(1−π)·HR·weibullSurvival(t,λ,k)^HR·weibullHazard(t,λ,k)` (guard divide-by-zero/non-finite → fall back to a finite value).
- `counterfactual`: mirror Weibull — fit once, GoF once, two summaries differing only in HR; cureFraction identical on both (π is baseline, HR-independent — the D3 invariant; assert this in tests).
- `sample`: cure-aware forward simulation. Add `drawMixtureCureEventTimes({replicas, horizonDays, π, hr, rng, quantileOfBaseF})` to `survival-sample.ts` (ADDITIVE — leave `drawEventTimes` unchanged): per replica draw `u_cure=rng()`; if `u_cure < π` → cured → event time = `horizonDays` (censored-at-horizon); else susceptible → existing inverse-CDF draw (second `rng()`), clamped. Two deterministic draws per replica.
- `condition`/`cohortMarginal`/`identify`: the same Phase-1 deferral stubs.
- **RED→GREEN (`mixture-cure-weibull.adapter.spec.ts`):** posterior produces a SurvivalSummary with `cureFraction≈π` + plateau in `survivalAtHorizons`; median fallback works when π≥0.5 (finite, = maxEventTime); HR>1 drops the curve toward π (not below); counterfactual cureFraction identical on both arms; sample respects π (≈π fraction censored at horizon); ≥2-effect log-HR sum tested + harmful-HR direction.

### T4 — Catalog row + forward migration
- `reproducibility/in-memory-distribution-catalog.ts` — add `MIXTURE_CURE_WEIBULL_DISTRIBUTION_SEED` (`name:'survival.mixture-cure-weibull@1'`, `conjugate_with:[]`, `parameterSchema` with `cureFraction`/`scale`/`shape` `{type:'number',minimum:0}` + a `fit` recipe with **STRING tokens** — `method:'em-mixture-cure'`, `init:{...}`, `tol:'1e-8'`, `maxIter:'500'`, `order:'durationT asc, eventObserved asc, entryT asc'`). Default catalog becomes 5 rows (normal + 4 survival); update any hard-coded default-digest assertions.
- Forward migration (`migrations/<ts>_seed_mixture_cure_weibull_family/migration.sql`) — INSERT-only, `ON CONFLICT DO NOTHING`, no DDL. The JSONB literal must byte-equal `JSON.stringify(seed.parameterSchema)` (derive it that way; the B3-S3 JSONB-float discipline).
- **RED→GREEN:** in-memory `resolve('survival.mixture-cure-weibull@1')` returns the row; `catalogVersionHash()` deterministic; recipe-versioning (tighten `fit.tol` → hash changes).

### T5 — Router dispatch + InMemoryInferenceBackbone
- `inference/inference-backbone-router.ts` — `MIXTURE_CURE_WEIBULL_FAMILY_NAME='survival.mixture-cure-weibull'`; construct the adapter inside the router (no composition-root change); add the dispatch branch in `resolveTarget`/`dispatchForFamilyRef` (posterior+counterfactual) and the `sample` by-`adapterId` case; the adapter implements the existing `SurvivalPosteriorAdapter` interface. Unknown family stays `validation-failed`.
- `InMemoryInferenceBackbone` — add the familyRef→mixture-cure dispatch (posterior/counterfactual/sample, route to the real adapter).
- **RED→GREEN:** an indicator carrying `familyRef:'survival.mixture-cure-weibull@1'` dispatches end-to-end (in-memory cohort → posterior → SurvivalSummary with cureFraction); existing router specs stay green; unknown family → `validation-failed`.

### T6 — §11 validation gate (test-only)
- `inference/validation/synthetic-cohorts.ts` — add `wellSpecifiedMixtureCure()` (deterministic, heavily censored past the plateau, known π) + `underCensoredMixtureCure()` (no censoring past plateau).
- `inference/validation/survival-validation-gate.spec.ts` (or a sibling) — Layer-1: a **plain Weibull fit on the cure cohort DETECTS the plateau misfit** (`fitMisfitFlag===true`, divergence ≈ π); the **mixture-cure fit on the same cohort is clean** (`fitMisfitFlag===false`); the under-censored cohort surfaces the under-identification (high divergence / non-converged). Determinism across in-memory↔(Prisma in T8).

### T7 — Replay / determinism proof (test-only)
- Extend `reproducibility/survival-replay.proof.spec.ts` (or a sibling proof) — mixture-cure `posterior(input,{manifest:'event'})` → F1 emit + `run_manifest` persist (`kind:'survival'`, `cureFraction` present) → `replay()` bit-identical (including `cureFraction`); catalog-drift refusal (append a `survival.mixture-cure-weibull@2` sibling with tighter `fit.tol` → `catalog-drifted`); double-replay determinism. **Zero production change — rides S4a's path.**

### T8 — DB-gated catalog + equivalence proof
- A `*.db.spec.ts` (under `vitest.db.config.ts`) — run the forward migration, read the row back through Prisma, assert byte-identical to the in-memory seed (JSONB-float round-trip discipline); cross-evidence-adapter byte-identical `SurvivalSummary` (in-memory ↔ Prisma evidence repo) for a mixture-cure fit. Use the `app` NOSUPERUSER role where the suite asserts RLS (seeding may need superuser — state which).

### T9 — Mutation-t2 + final gates
- Ensure the Stryker (foundation/test-kit `defineStrykerConfig` t2) config covers `mixture-cure-weibull.ts` + the adapter; harden tests to clear the t2 threshold.
- Full `ci:local` (DB-free) green + `ci:local:db` green. `grep "kind: 'survival'"` for any fixture missing required fields (the S5a cascade lesson). Verify with `--skip-nx-cache` / `npx vitest` (the nx-cache-masks-failures lesson).

## Gotchas (carried from the B3 arc — see second-brick-oncology memory)
- **nx cache masks test failures** — verify greens with `--skip-nx-cache` or `npx vitest` directly; `nx build` is the authoritative tsc.
- **A required-field widen cascades to every fixture** — `cureFraction` is OPTIONAL, so it should NOT cascade; still grep all `kind: 'survival'` fixtures.
- **JSONB float round-trip** — fit-recipe scalars are STRING tokens; migration JSONB byte-equals `JSON.stringify(parameterSchema)`.
- **canonicalJsonStringify throws on Inf/NaN** — the plateau quantile fallback (T3) is load-bearing.
- **Survival types resolve via the `@de-braighter/substrate-contracts/inference` subpath** only.
- **branch off `origin/main`**, publish collision-check via `npm view … versions --json` membership.
- **controller pushes** — subagents edit + test only; the controller commits + pushes before any merge.
```
