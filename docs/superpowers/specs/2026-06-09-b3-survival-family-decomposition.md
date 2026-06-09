# B3 — Survival Inference Family: Implementation Decomposition

> **Status:** approved (brainstorming) — implementation decomposition of the **ratified** ADR-223. The kernel-side design is settled and NOT relitigated here; this records the slice ladder, the resolved implementation-home decisions, the publish strategy, and the risk register. Each slice gets its own spec→plan→build→merge cycle.
> **Date:** 2026-06-09
> **Ratified design (do not relitigate):** `layers/specs/adr/adr-223-survival-inference-family.md` + `layers/specs/concepts/design/2026-06-07-b3-survival-inference-family-design.md`.
> **Program context:** [[second-brick-oncology-direction]] — B3 = the in-process survival/time-to-event family, the only net-new kernel modeling in the oncology program. Repo: `layers/substrate` (kernel). Current published versions: contracts/runtime **1.1.0** → B3 is an additive minor → **1.2.0**.

## 1. Goal

Implement ADR-223 — add the survival/time-to-event inference family **registry-extensibly beside** the conjugate fast-paths (NOT by widening `ConjugateHint`), with in-process Weibull-AFT / log-logistic-AFT / Kaplan-Meier adapters, three append-only `kernel.distribution_catalog` rows, hazard-ratio composition on the unchanged effect algebra (log-HR), and bit-for-bit WS-9 replay — validated against synthetic cohorts before any real-PHI fit (charter §11).

## 2. First-arc scope (founder-confirmed)

**S1–S5** (S6 deferred). The first arc delivers the complete kernel-side ratified surface + the PCCP-replay foundation + the synthetic-cohort regulatory gate. The live `kernel.event_log` read (S6) is a second arc, triggered by a real cohort.

## 3. The slice ladder

Each slice is independently shippable + green; the conjugate paths stay regression-proven throughout; the in-memory↔Prisma shared-contract pattern + the byte-identical `catalogVersionHash` digest proof are reused from WS-9.

- **S1 — Ring-0 contracts + pure-math doubles.** `InferenceFamilyRef` brand + `SurvivalObservation` + `SurvivalSummary` (keyed `kind:'survival'`) + the discriminated widen of `PosteriorHandle.summary` (and `RunManifestRecord.posteriorSummary`) to `PosteriorSummary | SurvivalSummary` + Zod mirrors; **and** the pure math: `math/weibull-aft.ts`, `math/loglogistic-aft.ts`, `math/kaplan-meier.ts` (MLE fit over the right-censored log-likelihood, `S(t)`, hazard, quantiles, KM product-limit) — pure functions, no adapter/router wiring. Publish contracts@1.2.0 at slice end.
- **S2 — Weibull adapter + router family-ref dispatch (in-memory).** `WeibullAftAdapter` (mirrors `NormalNormalFastPathAdapter`) consuming `SurvivalObservation[]` + composed log-HR → `SurvivalSummary`; the router `familyRef`-precedence branch (`familyRef` present → registered-family; else `conjugateHint`; both absent → sidecar); `EvidenceRepository.findSurvivalObservations` + in-memory `registerSurvivalObservations`; add `familyRef` to `InMemoryInferenceCatalog.catalogVersionHash()` projection.
- **S3 — log-logistic + KM adapters + the 3 catalog rows.** The other two adapters; three append-only `DistributionEntry` seeds (`conjugate_with='[]'`, fit recipe in `parameterSchema`) in the in-memory catalog; the forward `kernel.distribution_catalog` migration (the WS-9 INSERT template). KM is the model-free reference the parametric fits validate against.
- **S4 — WS-9 replay extension.** Survival fits persist to `kernel.run_manifest`; `replay()` reconstructs a `SurvivalSummary` bit-identically (the posterior recompute path, unchanged mechanism); negative path "re-register a survival row with tighter `tol` → `catalog-drifted`"; survival `sample()` seed-pinned via `makeRng`. The PCCP audit-trail foundation; cross-tenant RLS proven on the fitted-model manifest.
- **S5 — Synthetic-cohort validation (charter §11 gate).** Fabricated-cohort fixtures + a validation suite proving fit recovery, censoring/hazard semantics, and determinism across runs + across in-memory↔Prisma evidence adapters — **including the non-proportional cohort** that confirms the family *detects* (does not silently absorb) PH violation. Test-only; the regulatory gate, not a feature.
- **S6 — DEFERRED (second arc).** Live `kernel.event_log` `findSurvivalObservations` over RLS; surfaces an `ObservationProjection` widen (duration + event-observed boolean vs the current numerator/denominator/timestamp paths). The in-memory double (S2) carries the contract; the live read awaits a real cohort.

**Build order:** S1 → S2 → S3 → S4 → S5 (strict; each depends on the prior).

## 4. Resolved implementation decisions (beyond the ADR)

1. **Implementation homes (the ADR's "Ring 0" wording vs the code's actual layout).** `conjugateHint`, `IndicatorMetadata`, `ObservationReading`, `NormalObservationReading` all live in the **runtime port** (`substrate-runtime/.../inference-catalog.port.ts`), not `@de-braighter/substrate-contracts`. Therefore: **`SurvivalSummary` + `InferenceFamilyRef` → Ring-0 contracts** (they ride the published `PosteriorHandle`/`InferenceBackbone` surface); **`SurvivalObservation` + the `familyRef` indicator-metadata field → the runtime port** (beside their siblings). This keeps the contract change minimal + honest; it is a deviation from the ADR's literal "Ring 0" accounting, recorded here.
2. **Effect algebra — v1 flat-scalar convention.** The log-HR composes via the existing `sum`-over-normals path (`{kind:'normal', mean: ln(HR), sd}`, `compositionOperator:'sum'`) — **no `composeEffects` change** (confirmed against `ARITHMETIC_FAMILIES`). v1 uses the runtime's **flat-scalar `magnitudePrior`** convention (a summed log-HR mean applied additively, then exponentiated to `appliedHazardRatio`, applied as `S_adj(t)=S_base(t)^HR`), exactly the Normal-Normal posture — NOT the contracts-level `composeEffects` over `DistributionSpec`. Richer variance propagation through `composeEffects` is a future promotion, not v1.
3. **catalogVersionHash covers the fit recipe for free.** `distributionCatalogVersionHash` already hashes `parameterSchema` whole, so pinning the MLE method/initial-point/tolerance/iteration-cap in `parameterSchema.fit` makes a recipe change a hash change → a past run correctly fails replay with `catalog-drifted`. No hash-helper change; S3 locks it with a regression test (tighten `tol` → hash changes).
4. **Publish train.** Publish `@de-braighter/substrate-{contracts,runtime}@1.2.0` at the end of **S1** — the discriminated widen is additive + inert until a `familyRef` indicator exists, so early downstream adoption is safe (consumers that exhaustive-switch on the summary handle the new `kind`; a non-exhaustive switch still compiles).
5. **Async population-refit deferred.** ADR-223 §3 splits per-subject posterior (request-path) from population re-fit (async job + read-model). v1 first arc ships the **request-path** family + replay only; the async cohort-refit (and its open question — own read-model table vs latest `run_manifest`) is a later slice.
6. **`InferenceBackbone` port signatures unchanged** — `posterior()`/`counterfactual()`/`sample()` ride verbatim; survival is dispatched inside the router. No new port, no new published method.

## 5. Risk register (mitigations baked into the ladder)

1. **MLE numerical determinism for bit-identical replay (highest).** Newton-Raphson/IRLS must converge byte-identically from a pinned init over a *sorted, frozen* observation set in pure IEEE-754 (no `Map`-order / accumulation-order nondeterminism). **Mitigation:** S1's run-twice-byte-identical determinism witness isolates it before any wiring; the fit recipe is pinned in `parameterSchema` + covered by `catalogVersionHash`.
2. **Discriminated-widen consumer impact (two sites: `PosteriorHandle.summary` + `RunManifestRecord.posteriorSummary`).** A consumer reaching for `.mean` on a survival summary is a category error if unguarded. **Mitigation:** the `distribution-spec.ts` reject-unrecognised-`kind` precedent; the publish-at-S1 timing (decision #4) gives downstream early adoption.
3. **catalogVersionHash over the fit recipe** — only works because the hash projects `parameterSchema` whole; a future refactor that projects only some recipe fields would replay silently. **Mitigation:** S3's fit-recipe-versioning regression test.
4. **Censored-likelihood correctness** — events contribute `log f(t)`, censored contribute `log S(t)`; left-truncation (`entryT`) adds a conditioning term; a wrong censoring term silently biases the fit. **Mitigation:** S5 synthetic cohorts generated under the exact v1 censoring model recover generating params within tolerance; the non-PH cohort proves misfit detection.
5. **RLS on the fitted-model `run_manifest`** — fitted models are tenant-private/RLS-FORCE; catalog rows are vendor-scoped/no-RLS; crossing the two breaks the security posture + PCCP isolation. **Mitigation:** S4 cross-tenant `manifest-not-found` test; the migration reuses the proven WS-9 RLS policy verbatim.
6. **`ObservationProjection` gap for survival (S6 only)** — the current projection has no duration + event-observed-boolean place. **Mitigation:** S6 is deferred; the in-memory path carries the contract; the projection widen is an S6 sub-decision when a real cohort triggers it.

## 6. Acceptance (first arc)

The kernel models time-to-event: `posterior()` over a `familyRef` indicator returns a `SurvivalSummary`; `counterfactual()` produces baseline-vs-HR-intervention survival curves sharing one `RunManifest`; all three families are catalog-registered with byte-identical in-memory↔Prisma digests; a fitted Weibull model is a bit-replayable `kernel.run_manifest` row (the PCCP foundation); the family is validated against synthetic cohorts (incl. PH-violation detection) before any real-PHI fit; `ConjugateHint` unchanged, zero new tables, contracts@1.2.0 published. S6 (live event-log read) deferred.

## 7. Non-goals (this arc)
- The breast-survivorship pathway plan-tree (pack/product territory, sub-project #2 — ADR-223 scope boundary).
- The NumPyro/JAX sidecar (full Bayesian posterior — standing in-process-first deferral; only `sample()` needs RNG and it seed-pins).
- The async population-refit job (decision #5).
- The live `kernel.event_log` survival read + `ObservationProjection` widen (S6, second arc).
- Real-PHI fits (gated behind S5 synthetic validation + the charter §11 gate).
