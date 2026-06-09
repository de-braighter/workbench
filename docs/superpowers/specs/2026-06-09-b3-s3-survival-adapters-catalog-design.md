# B3-S3 / S3.5 — Survival Adapters + Catalog Rows + Production Read: Design Delta

> **Status:** approved (brainstorming) — a focused design delta over the **ratified** ADR-223 and the
> **approved** B3 decomposition. It records (a) the genuinely-new S3 implementation details not pinned by the
> ADR (the catalog-row fit recipe, the Kaplan-Meier non-parametric adapter shape), and (b) two founder
> decisions that **deviate from the decomposition's slice ladder** — pulling S6's production survival read
> forward into a new **S3.5** sub-slice, and the projection-widen shape that enables it.
> **Date:** 2026-06-09
> **Ratified base (do NOT relitigate):** `layers/specs/adr/adr-223-survival-inference-family.md` +
> `docs/superpowers/specs/2026-06-09-b3-survival-family-decomposition.md` + ADR-220 (the WS-9
> `distribution_catalog` / `run_manifest` / `replay()` surface this rides).
> **Program context:** [[second-brick-oncology-direction]] — B3 is the in-process survival/time-to-event
> family, the only net-new kernel modeling in the oncology program. Repo: `layers/substrate` (kernel).
> S1 + S2 shipped (substrate 1.2.0, in-memory family dispatch end-to-end). Current published: **1.2.0**.

## 1. What this delta covers (and what it does not)

ADR-223 + the decomposition already settle the family's *shape* — the `FamilyKind` discriminant, the
`SurvivalObservation`/`SurvivalSummary` contracts, the log-HR-on-the-unchanged-algebra composition, the three
append-only catalog rows with `conjugate_with='[]'`, the fit-recipe-in-`parameterSchema` versioning trick, and
the WS-9 replay extension. **None of that is relitigated here.** This delta records only:

1. **The catalog-row fit-recipe JSON** (§3) — the exact `parameterSchema.fit` shape, mirrored to the S1 math.
2. **The Kaplan-Meier non-parametric adapter shape** (§4) — the one place ADR-223's parametric framing needs a
   concrete decision (KM has no scale/shape; how does it fill a `SurvivalSummary`?).
3. **The S3 / S3.5 slice split + the projection-widen shape** (§5–§6) — the founder decisions that pull the
   decomposition's S6 production read forward and shape the Ring-0 `ObservationProjection` arm that enables it.

## 2. Founder decisions (2026-06-09, this session)

| # | Decision | Rationale / deviation note |
|---|---|---|
| D1 | **Wire the real Prisma `findSurvivalObservations` read** (don't keep the `[]` stub) | Deviates from the decomposition (which deferred the live `event_log` read to **S6**). Pulled forward so S4's replay can be proven on the production data path, not only the in-memory double. |
| D2 | **No publish at S3/S3.5** — stays `1.2.0` | S3 touches only runtime internals + a DB migration. S3.5's Ring-0 projection widen **ships unpublished** (only substrate consumes it intra-repo; the widen is additive + inert for `^1.2.0` consumers). The release defers to the coordinated bump after S4/S5. "No publish" = *make the change, defer the release*. |
| D3 | **Projection widen = a new Ring-0 discriminated arm** | A `SurvivalEventLogObservationProjection` arm on the published `ObservationProjection` union — honest typing in the projection's natural home (mirrors the `SurvivalSummary` discriminated-widen posture), not a runtime-only fork. |
| D4 | **Split into S3 + S3.5** | S3 = the original ratified scope (catalog/adapters/digest — a tight, adversarially-reviewable PR). S3.5 = the projection arm + production read + DB-gated read test. Each independently shippable + green. S6 then shrinks to "a real cohort arrives + seed real events." |

These deviate from the ratified decomposition's slice ladder but **not** from ADR-223's kernel-side surface:
the family, the catalog rows, the replay extension, and the `ObservationProjection` non-foreclosure (ADR-203
§11, which explicitly anticipates additive arms) are all unchanged in spirit. The deviation is *sequencing*
(S6 work pulled into S3.5) + *one additive Ring-0 arm that lands unpublished*.

## 3. The three catalog rows + the pinned fit recipe (S3)

Each row is a `DistributionEntry` (`reproducibility/distribution-catalog.port.ts`) with
`conjugateWith: []` (the honest "no conjugate partner" declaration — contrast the Normal seed's `['normal']`),
seeded into both the in-memory catalog (`in-memory-distribution-catalog.ts`, beside `NORMAL_DISTRIBUTION_SEED`)
and the Prisma `kernel.distribution_catalog` (a forward migration; §3.2). The **fit recipe is pinned inside
`parameterSchema`** so the existing `distributionCatalogVersionHash` (which canonical-JSON-SHA-256s
`parameterSchema` whole) covers it **with no hash-helper change** — a recipe change ⇒ a hash change ⇒ a past
run correctly fails replay with `catalog-drifted` (ADR-223 §5 point 2). The recipe values **mirror the S1 math
verbatim** so a row describes the algorithm that actually runs (Weibull: profile-Newton on shape, init
`shape=1`, tol `1e-10`, maxIter `100`; log-logistic: 2-D Newton on logistic location-scale, init `s=1` /
location-seed `mean(ln t over events)`, tol `1e-10`, maxIter `100`; KM: product-limit, events-before-censors
tie-break).

### 3.1 The `parameterSchema` JSON (the exact seed shapes)

```jsonc
// survival.weibull-aft@1   — conjugateWith: []
{ "scale": { "type": "number", "minimum": 0 },
  "shape": { "type": "number", "minimum": 0 },
  "fit": { "method": "newton-raphson-profile-shape", "init": { "shape": "1" },
           "tol": "1e-10", "maxIter": "100", "order": "durationT asc, eventObserved asc, entryT asc" } }

// survival.loglogistic-aft@1   — conjugateWith: []
{ "scale": { "type": "number", "minimum": 0 },
  "shape": { "type": "number", "minimum": 0 },
  "fit": { "method": "newton-raphson-2d-logistic",
           "init": { "locationSeed": "mean-ln-t-over-events", "s": "1" },
           "tol": "1e-10", "maxIter": "100", "order": "durationT asc, eventObserved asc, entryT asc" } }

// survival.kaplan-meier@1   — conjugateWith: []   (non-parametric: the "recipe" is the estimator + tie-break)
{ "estimator": { "const": "product-limit" },
  "fit": { "method": "product-limit", "tieBreaking": "events-before-censors",
           "order": "durationT asc, eventObserved desc" } }
```

> **Every `fit`-block scalar is a STRING token** (`"tol": "1e-10"`, `"maxIter": "100"`, `"init.shape": "1"`),
> NOT a JSON number. Rationale: the digest proof (§5.6) asserts the in-memory seed objects and the
> Prisma-read migration rows hash byte-identically, but a JSON float (`1e-10`) can round-trip through Postgres
> JSONB as `0.0000000001` — a different canonical-JSON → a *false* hash divergence that would break replay.
> String tokens round-trip identically through both paths. The param-shape `{ "type":"number","minimum":0 }`
> keeps integer `0` (it already round-trips — it is byte-identical to the proven Normal seed). This is a
> correctness refinement discovered in planning; it does not change the design intent (the recipe is pinned +
> hashed) — it makes the hashing deterministic across the JS↔JSONB boundary.

`pdfRef`/`cdfRef`/`sampleRef` follow the Normal seed convention (`kernel.dist.<family>` / `.cdf` / `.sample`),
e.g. `kernel.dist.survival.weibull-aft`. KM (no pdf) sets `pdfRef` to `kernel.dist.survival.kaplan-meier.step`
(the empirical step function) — a stable ref, never evaluated by the kernel.

### 3.2 The forward migration

A hand-authored `prisma/migrations/<ts>_kernel_b3_survival_catalog_rows/migration.sql` that `INSERT … ON
CONFLICT (name) DO NOTHING`s the three rows — using the WS-9 Normal-seed `INSERT` (in
`20260607000000_kernel_ws9_reproducibility_surface/migration.sql`) as the verbatim template
(`conjugate_with='[]'::jsonb`, `registered_by='kernel'`). Append-only, idempotent, no schema change (the
`distribution_catalog` table already exists). Applied via the existing `ci:local:db` / `db:setup` path.

## 4. The Kaplan-Meier adapter — non-parametric `SurvivalSummary` mapping

KM is the **model-free reference curve** the parametric fits validate against (decomposition §3; the S5 gate).
It is also a dispatched `familyRef` family (`survival.kaplan-meier@1`), so `posterior()` over a KM indicator
must return a `SurvivalSummary` — but KM is a step function with no scale/shape. The mapping (founder-approved):

- **`parameterValues`** → `{ n, events, censored }` — the empirical curve's honest descriptors (the field is
  required; KM has no distributional params).
- **`survivalAtHorizons` / `medianSurvival` / `quantiles`** → KM step-function lookups via `survivalAt(t)`
  (the S1 `kaplanMeier(...)` `KmCurve`). `medianSurvival` = smallest event time `t` with `S(t) ≤ 0.5`.
  **If the curve never crosses 0.5** (median not reached), report the **largest observed event time** as a
  conservative lower bound — explicitly **NOT** `Infinity`/`NaN`, which serialize to `null` under
  `JSON.stringify` and would silently break the byte-identical determinism witness. A non-crossing curve is
  reported (with a lower-bound median), never errored. Unreachable quantiles follow the same lower-bound rule.
- **`hazardAtHorizon`** → the **discrete KM hazard** `d_i / n_i` at the largest event time `≤ horizon`
  (× `appliedHazardRatio`). KM gives no smooth instantaneous hazard; this is the honest discrete analogue
  (the Nelson-Aalen increment).
- **`appliedHazardRatio` + HR application** → KM **still applies the HR** (`S_adj(t) = S_KM(t)^HR`) so the
  router/counterfactual path is uniform across all three families. Its *primary* role stays the model-free
  reference (baseline, `HR = 1`, is the common case). Quantiles under HR invert the step curve:
  `S_adj(t) = 1 - p` ⇒ `S_KM(t) = (1 - p)^(1/HR)` ⇒ the smallest step `t` whose `S_KM(t) ≤ (1 - p)^(1/HR)`.

All three families therefore return the **same `SurvivalSummary` shape** — the router, the manifest, and the
counterfactual path stay uniform. KM's non-convergence path: an all-censored cohort yields an empty curve
(no event times) → the adapter returns its `cohort-too-small`-style typed error, mirroring the Weibull adapter
(never throws across the port).

## 5. S3 scope (this slice — the tight catalog/adapters PR)

1. **`LogLogisticAftAdapter`** — a near-verbatim mirror of `WeibullAftAdapter` (S2): fit via S1
   `fitLogLogisticAft` → `{scale, shape}`, compose the log-HR sum → `appliedHazardRatio`, apply
   `S_adj(t) = S_base(t)^HR`, materialize the `SurvivalSummary`, build the manifest.
   `medianSurvival = loglogisticQuantile(1 − 0.5^(1/HR), …)`. Nothing novel.
2. **`KaplanMeierAdapter`** — per §4 (the one non-mechanical adapter).
3. **Router dispatch** — extend `dispatchForFamilyRef` (`inference-backbone-router.ts`) with
   `survival.loglogistic-aft` + `survival.kaplan-meier` family names → the new `DispatchTarget` arms;
   construct both adapters inside the router (mirroring `weibullAft`); the unknown-familyRef typed error stays.
4. **Three in-memory catalog seeds** (§3.1) + the constructor default extended to seed all four rows
   (Normal + the three survival rows).
5. **Forward Prisma migration** (§3.2) — the three `INSERT` rows.
6. **In-memory↔Prisma digest proof** — extend the WS-9 `distribution-catalog.contract.ts` suite: seed all
   three survival rows into both catalogs, assert byte-identical `catalogVersionHash()` (the Prisma side is
   DB-gated, `ci:local:db`).
7. **Fit-recipe-versioning test** — register a survival row, snapshot the hash, re-register with `fit.tol`
   tightened → assert the hash **changes** (proves recipe-versioning rides the hash → S4's `catalog-drifted`).

**Not in S3:** the projection widen, the production read, any contracts change, any publish.

## 6. S3.5 scope (its own plan after S3 merges — the production read)

1. **Ring-0 `SurvivalEventLogObservationProjection` arm** on the `ObservationProjection` union
   (`substrate-contracts/.../observation-projection.ts`) + its Zod mirror
   (`observation-projection-zod.ts`) + barrel export:

   ```typescript
   export interface SurvivalEventLogObservationProjection {
     readonly indicatorKey: string;
     readonly source: 'event-log';
     readonly shape: 'survival';            // sub-discriminant beside the moment/count arm
     readonly eventTypes: readonly string[];
     readonly durationPath: JsonPath;       // → durationT (number, > 0)
     readonly eventObservedPath: JsonPath;  // → eventObserved (boolean)
     readonly entryPath?: JsonPath;         // → entryT (left-truncation, optional)
     readonly timestampPath: JsonPath;      // → recordedAtIso
   }
   export type ObservationProjection =
     | EventLogObservationProjection            // moment/count (no `shape`)
     | SurvivalEventLogObservationProjection
     | ReadModelObservationProjection;
   ```

   The existing `EventLogObservationProjection` is **unchanged** (it has no `shape` field; the survival arm is
   distinguished by `shape: 'survival'`). Additive + inert for existing consumers. **Ships unpublished** (D2).
2. **`evalBoolean` JSON-path evaluator** — a boolean projection of `evaluateJsonPath` for `eventObservedPath`
   (the existing helpers cover number + ISO-string; boolean is the one new evaluator).
3. **Real Prisma `findSurvivalObservations`** (`prisma-evidence-log.repository.ts`) — mirrors
   `findNormalObservations`: resolve the indicator's projection; if absent / `read-model` / not the survival
   `shape` → `[]` (total port, no throw); else `readCandidateRows(tenantPackId, projection, subjectId)`
   (GUC-scoped → RLS), eval `durationPath`/`eventObservedPath`/`entryPath`/`timestampPath` per row, skip rows
   whose paths don't resolve, apply the `asOf` filter against the derived `recordedAtIso`, sort deterministically.
   Replace the `[]` stub; **fix the misleading S2 doc comment** that claims the read "lands with the B3-S3
   DB/catalog/migration story" → point it at S3.5 (the read) + S6 (a real cohort).
4. **DB-gated read test** (`ci:local:db`) — seed survival `event_log` rows under a tenant GUC, register a
   survival-shaped projection indicator, assert `findSurvivalObservations` reads them back (durations +
   censoring flags), respects `asOf`, and is **RLS-isolated** (a second tenant reads `[]`).

## 7. Build order + gate

S3 → S3.5 (strict; S3.5 depends on S3's families being dispatched). Each: TDD via
`superpowers:subagent-driven-development` with the **`substrate-coder-pro`** agent; one commit per task; the
full verifier wave (`reviewer` + `charter-checker` + `qa-engineer`, + `local-ci`/`ci:local`); automerge on
green (`gh pr merge --squash --admin`, the freeze-merge policy); the twin ritual after each merge
(`drain` / `backfill de-braighter/substrate` / `reconcile`); memory updated after each slice. Gate is local
(remote GHA billing-frozen): `npm run ci:local` (DB-free) + `npm run ci:local:db` (DB up; `substrate-postgres`
:5544) for the Prisma digest proof (S3) + the production-read test (S3.5).

## 8. Load-bearing lessons carried from S1/S2 (the wave caught a subtle miss both times)

- **Survival recovery tests need heavy censoring (~40%) + an adversarial "ignore-censoring fit lands OUT of
  band" assertion**, or they don't guard the censored likelihood. Applies to the loglogistic adapter test +
  the S5 cohorts (KM's product-limit handles censoring structurally, but the parametric adapters must be
  guarded).
- **Multi-effect log-HR composition must be tested with ≥2 effects** (a 1-effect test can't distinguish
  `exp(Σ)` from `exp(first)`); test the harmful `HR > 1` direction too (curve drops). Applies to both new
  adapters.
- **Determinism = run-twice (and shuffled-input) byte-identical** — the WS-9 replay foundation. The KM curve +
  both parametric fits already pass this in S1; the adapters must preserve it through the
  summary/manifest materialization.
- **Branch off `origin/main`** (`git fetch` first — stale-local-main recurs). **Survival types import from the
  `@de-braighter/substrate-contracts/inference` SUBPATH** (the root index doesn't re-export the inference
  barrel).

## 9. Non-goals (this delta)

- S4 (WS-9 replay extension) + S5 (synthetic-cohort validation gate) — their own slices, unchanged by this
  delta beyond S3.5 now providing a production read S4 can exercise.
- S6 (a real cohort + seeding real survival events) — shrunk by D1/D4 to "a real cohort arrives"; the read
  machinery + projection arm now land in S3.5.
- The async population-refit job; the NumPyro sidecar; real-PHI fits (gated behind S5 + charter §11).
- Any `composeEffects`/`DistributionSpec` change — the v1 flat-scalar log-HR convention rides the existing
  `sum`-over-normals algebra (decomposition §4.2), unchanged.
