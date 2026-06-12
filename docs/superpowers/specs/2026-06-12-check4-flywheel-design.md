# Check 4 — flywheel super-linearity: framing decision + pre-registered design

**Date:** 2026-06-12 (founder-present framing session) ·
**Status:** pre-registration — **binding once merged**; any change to a frozen
dial after the fixture is built voids the run and requires re-pre-registration
(new PR + ledger note).
**Governs:** the last open check on the de-braighter/specs#298 ledger, per the
amended ADR-218 §The thesis-test gate — Check 4 gates the step-3 vendor-only
registry's moat justification ("a real, calibrated super-linear (cross-tenant /
reuse) effect at our scale"); FAIL or cost-explosion → Option-B deferral ADR
with an explicit re-test trigger, registry waits.

---

## 1 — The four framing decisions (founder-ratified this session)

### D1 — Operationalization: devloop real-data pooling (candidate b)

The flywheel claim is tested as **cross-unit empirical-Bayes pooling on
devloop's real longitudinal delivery data**: does a prior pooled from other
repos measurably improve a cold-start repo's predictive distribution, judged by
a proper score?

Why the other candidates fell:

- **(a) synthetic cross-tenant EB toy** — EB pooling across synthetic tenants
  drawn from a shared hyper-distribution improves expected proper score **by
  mathematical construction** (Stein shrinkage); the toy can only fail if
  mis-implemented, so it is not a check. The strategy doc's own FAIL wording
  ("only-in-toy") classifies a synthetic-only PASS as FAIL-equivalent. No two
  real tenants exist in any vertical, so (a) instantiated honestly **is** (b).
- **(c) subtree-reuse cold-start** — closest to the registry's value
  proposition, but presupposes registry-shaped plumbing (circular with what the
  check gates) and needs a second domain with semantically transferable
  subtrees, which does not exist.

Devloop's event log is the only real multi-unit longitudinal dataset in the
cluster (at framing time: 882 `PrMerged.v1` events across 15 repos; 8 repos
clear an n ≥ 20 floor). Pooling is genuinely falsifiable here: repo
heterogeneity is documented (devloop's own Simpson's-paradox finding — docs
repos vs code repos), so shrinkage can genuinely lose to per-repo fits.

### D2 — Verdict semantics: PASS-with-caveats (Check-3 precedent)

A passing run = **Check-4 PASS, gate discharged, with named carried caveats**
(§6). ADR-218's Option-A discipline (no substrate-only feature without a
consumer pulling) remains the standing brake on actually building the registry
— the gate is necessary-not-sufficient by construction. A FAIL = Option-B
deferral ADR per the amendment.

### D3 — Run now (deferral considered first-class, declined)

Deferral's premise ("no honest test exists at our scale") fell at D1: an
honest, cheap, falsifiable test exists. Decisive considerations: an Option-B
deferral ADR costs roughly the same session as running the check; the
information value is asymmetric (the FAIL branch — pooling measurably *not*
helping on our best real data — is the single most decision-relevant fact
available about the thesis's only moat); a verdict closes the five-check
ladder.

### D4 — PASS bar: stricter sign rule (founder tightened from ≥6/8)

The founder chose the **all-but-at-most-one-fold** sign rule (≥7/8 at the
expected fold count) over a Δ-magnitude margin: the tightening is purely
combinatorial (≈ 3.5% under a no-effect null at F = 8) with no arbitrary
magnitude constant, and an honest small-but-consistent effect still passes.

---

## 2 — Claim under test

> Cross-unit pooling — the flywheel's mechanism — measurably improves a
> cold-start unit's predictive distribution on real heterogeneous data at our
> scale, judged by a strictly proper score that punishes overconfidence.

---

## 3 — Pre-registered protocol (all dials frozen here)

### 3.1 Data and fixture

- Source: devloop `data/events.jsonl`, event type `devloop:PrMerged.v1`;
  fields extracted per row: `payload.repo`, `payload.pr`, `occurredAt`,
  `payload.cycleHours`.
- Exclusions at fixture build: `cycleHours` missing, non-finite, or ≤ 0.
- The fixture is a **frozen snapshot committed in-tree** in the devloop repo
  (own public-repo delivery metadata only; the Swiss-Post validation log is a
  separate file and is excluded by construction — nothing from it may enter
  the fixture).
- Snapshot moment: at fixture-build time in the implementation PR, after this
  doc merges. The fixture file is thereafter authoritative and immutable for
  this check.

### 3.2 Units and folds

- Fold units: repos with **≥ 20 rows after exclusions** at snapshot. Expected
  F = 8 (specs 235 · exercir 161 · workbench 122 · design-system 117 ·
  substrate 110 · devloop 58 · herdbook 28 · conservation 20, counts as of
  framing); the fixture pins the authoritative set.
- **Leave-one-repo-out cold-start:** each qualifying repo takes one turn as
  the cold unit. Conditioning data = its chronologically **first k = 5** rows
  (by `occurredAt`, ties by PR number). Held-out = all its remaining rows.

### 3.3 Model — shared likelihood, two priors

Observation: `y = ln(cycleHours)`. Likelihood (both arms): `y ~ Normal(μ_r,
σ_r²)` per repo, conjugate **Normal-Inverse-Gamma** `NIG(μ₀, κ₀, α₀, β₀)` in
the convention `p(μ, σ²) = Normal(μ | μ₀, σ²/κ₀) · InvGamma(σ² | shape α₀,
rate β₀)`; posterior predictive = Student-t with `df = 2α_n`, location `μ_n`,
scale² `= β_n(κ_n + 1)/(α_n κ_n)` after the standard conjugate update. Both
arms receive the identical k = 5 conditioning update; they differ **only in
the prior**:

- **Unpooled arm (the honest per-tenant baseline):**
  `μ₀ = ȳ_k` (mean of the fold's own k conditioning values — unit-information
  location), `κ₀ = 1`, `α₀ = 1`, `β₀ = 1`.
  Deliberately competent, not a strawman: the location prior uses the unit's
  own k-shot data, as a per-tenant-only product would.
- **Pooled arm (the flywheel):** hyperprior estimated from the **other F−1
  repos' full fixture rows** by one-way random-effects method of moments
  (hand-derivable, closed-form). With per-repo sample means `ȳ_j`, sample
  variances `s_j²` (n−1 divisor), counts `n_j` (j ≠ fold), and `Var_j(·)`
  likewise the sample variance over the F−1 per-repo means:
  - `μ₀ = mean_j(ȳ_j)` (unweighted),
  - `τ̂² = max(0, Var_j(ȳ_j) − mean_j(s_j²/n_j))`,
  - `σ̂_w² = mean_j(s_j²)`,
  - `κ₀ = min(σ̂_w²/τ̂², 25)` (prior weight in pseudo-observations, capped at
    25; `τ̂² = 0 → κ₀ = 25`),
  - `α₀ = 1`, `β₀ = σ̂_w²`.

  Scale-prior **weight** is identical to the unpooled arm (one pseudo-unit);
  only its **center** is informed (cross-repo `σ̂_w²` vs the default 1). That
  asymmetry of information is precisely the claim under test.

Everything is closed-form — no sampling, no seed; the verdict is a
deterministic function of the frozen fixture.

### 3.4 Score

Per fold r with held-out set `H_r`:
`Δ_r = (1/|H_r|) · Σ_{i∈H_r} [ ln p_pooled(y_i) − ln p_unpooled(y_i) ]`
(mean log-predictive-density difference, nats per held-out PR). Primary
aggregate = **unweighted mean of Δ_r across folds** (each cold-start unit
counts equally; large repos must not dominate).

### 3.5 PASS rule (binding)

PASS requires **all three**:

1. mean over folds of `Δ_r` **> 0**;
2. `Δ_r > 0` in **all but at most one fold** (≥ 7 of the expected 8; under a
   no-effect null at F = 8 this occurs by chance with probability 9/256
   ≈ 3.5% — stated as a pre-named decision rule, not a p-value claim);
3. the pooled arm's aggregate empirical coverage of the central 80% predictive
   interval, over **all** held-out points pooled across folds, is **≥ 0.60**
   — the "not merely overconfident" backstop (the log-score already punishes
   overconfidence; this floor catches only egregious interval failure).

**FAIL = any criterion missed.** Consequence per amended ADR-218: Option-B
deferral ADR with an explicit re-test trigger; the registry waits; the moat
claim is demoted in strategy framing until re-tested.

Reported as non-gating diagnostics: per-fold `Δ_r`, both arms' coverage,
per-fold hyperprior values (`μ₀, τ̂², κ₀`).

### 3.6 Process discipline

- This doc merges **before** the fixture is built or any score is computed. At
  framing time only per-repo event **counts** had been observed — no outcome
  scores.
- Implementation is TDD'd against **hand-derivable synthetic oracles** first
  (tiny cohorts where the conjugate updates and MoM hyperprior are checked by
  hand); the real-fixture computation runs once the module is review-clean.
- The real-fixture verdict is pinned as an **in-tree regression spec**
  (deterministic: frozen fixture + closed-form math) — the Check-2/3 evidence
  standard. The ledger comment quotes it.
- No tolerance-padding: k, the repo floor, the sign rule, the coverage floor,
  both priors, and the estimators are frozen above. Changing any of them after
  fixture build voids the run.

---

## 4 — What this check does and does not test

It **does** test: whether the pooling effect the registry would monetize is
real, measurable, and calibration-preserving on the only real multi-unit
longitudinal data at our scale — with a baseline a competent per-tenant
product would actually ship.

It does **not** test: commercial tenant boundaries, the substrate's
cross-tenant plumbing (RLS-walled by design; the kernel's EB machinery was
separately proven at production depth in Check 3), subtree/template reuse, or
any registry mechanics.

---

## 5 — Deliverables

1. **This doc** — workbench PR (the pre-registration; merges first).
2. **One devloop PR** — pure pooling/scoring module (TDD, synthetic oracles),
   frozen fixture, in-tree regression pinning the verdict computation.
   In-process (devloop's engine posture, no substrate dependency added).
3. **Ledger comment on de-braighter/specs#298** — the verdict (PASS with §6
   caveats, or FAIL → Option-B deferral ADR), with the in-tree evidence
   linked.
4. Standard block: verifier wave on the devloop PR, twin ritual,
   Producer/Effort/Effect lines.

## 6 — Carried caveats on a PASS (named now, per ledger discipline)

1. **Repo ≠ commercial tenant** — units are this cluster's own repos; no
   tenant boundary is crossed.
2. **One vertical** — our own SDLC data; transfer to other verticals untested.
3. **Statistical claim, not plumbing** — in-process engine; registry/catalog
   mechanics untouched.
4. **One indicator** — cycle-time only (the only data-rich stream).
5. **Shared model family** — Normal-on-log is knowingly misspecified
   (multimodal autonomous-vs-human mix); both arms share it, so the comparison
   is apples-to-apples, but absolute calibration readings inherit the misfit.
6. **Point-estimate hyperprior** — MoM EB under-propagates hyperprior
   uncertainty (same as Check-3 carried caveat 1); the proper score penalizes
   any resulting overconfidence, so the check partially stress-tests this
   caveat rather than hiding it.

## 7 — FAIL-branch plan

Option-B deferral ADR in `layers/specs/adr/` (PR-gated; next-free number —
check `adr/README.md`, known stale; ADR-225 exists so ≥ 226), with re-test
trigger: **"first second tenant in one vertical, or first pack requesting a
published subtree."** The specs#298 ledger records the FAIL verdict + the
deferral ADR link.

## 8 — References

- Amended ADR-218 §The thesis-test gate (specs#299) — the gate this check
  discharges.
- Strategy doc
  `docs/superpowers/specs/2026-06-10-north-star-thesis-test-strategy.md` §4
  Check 4 — the original playbook (non-circularity warning, "only-in-toy"
  FAIL).
- specs#298 — the canonical check ledger (C1 FAIL · C2 CLOSED · C2.5
  pro-thesis · C3 PASS w/ 5 caveats · C5 PASS · C4 = this).
- Session runbook
  `docs/superpowers/runbooks/2026-06-13-check4-flywheel-framing-session-prompt.md`.
