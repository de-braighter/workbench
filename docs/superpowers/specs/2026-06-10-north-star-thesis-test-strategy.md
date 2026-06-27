# North-star thesis-test strategy — running the five falsifiable checks step by step

- **Date:** 2026-06-10
- **Relates to:** specs#298 (the challenge), `concepts/design/north-star-vision-capture-2026-05-17.md`, `adr/adr-218-north-star-critical-path-sequencing.md`
- **In-flight hooks:** ADR-224 (inference-effect composition — Check 2 precondition), B3-S4b (survival replay — Check 5)
- **Status:** proposed strategy, for founder review

---

## 1 — Goal and principle

specs#298 produced five falsifiable checks that would convert *"the build is consistent with the north-star"* into *"the build proves we're on a path to it."* This doc is the **strategy to run them** — and to use their results to make the explicit A/B decision the issue forces:

- **(A)** amend ADR-218 to schedule a thesis-test, or
- **(B)** consciously accept commodity-first and write down that we are deferring falsification of our own central claim.

**Principle: gated, fail-fast, learn-cheap.** The five checks are NOT a checklist to grind through. They differ by ~10× in cost and differ sharply in *disconfirming power* (how much a result moves our belief). Run them as a **decision tree**: cheapest + most-discriminating first, so a negative result kills our complacency for the least spend. Each phase is a gate; a failure at a gate changes the plan rather than feeding the next build.

We are testing a claim, not pursuing the star. The point of the strategy is to spend the *minimum* to know whether the star is reachable — not to build toward it on faith.

---

## 2 — The grading (cost × disconfirming power)

| Check | What it tests | Cost | Disconfirming power | Note |
|---|---|---|---|---|
| **1. Kill-the-kernel (herdbook)** | Is the kernel load-bearing for a domain that shipped around it? | **~1 day** (audit) | High (negative-only) | Cheapest possible "emperor's clothes" test |
| **2. §4.2 collapse on ONE indicator** | Does the plan-tree-as-program ever actually matter? | **High** (finish ADR-224 + build a query) | **Highest** | THE thesis test; partly in flight as ADR-224 |
| **3. Nested twin with down-cascade** | The differentiated claim (cascade + counterfactual at any level) | Med-high (finish EB "Tier 5") | High | Shares host + machinery with Check 2 |
| **4. Flywheel super-linearity (n=2)** | The actual moat (cross-tenant compounding) | Med, high design-risk | High | Fuzziest; most Option-A-deferred |
| **5. Reproducibility that bites (B3-S4b)** | Concern #4 end-to-end (bit-identical replay + drift refusal) | **Low** (in flight) | Medium | Real evidence, but least-contested concern |

Two facts that shape the sequence:

- **Check 2 is partly built.** ADR-224 (branch `feat/adr-224-inference-effects`, 5/15) is replacing the flat-multiply `KNOWN-GAP(ADR-154)` with real `ComposedEffect[]` composition — that *is* the first half of Check 2. The decisive test is reachable by finishing in-flight work + constructing one discriminating query, not from zero.
- **Checks 2 and 3 share a host.** Both are cleanest in **exercir** (it already has the plan tree + effect declarations + a what-if endpoint + the EB-hierarchical/members machinery for FF9). Doing them in the same domain compounds the machinery — Check 3's down-cascade reuses Check 2's real-composition adapter.

---

## 3 — The gated sequence

```
Phase 0  (days, pure analysis)          Phase 1  (the decisive gate)
┌─────────────────────────────┐         ┌──────────────────────────────────┐
│ Check 1: kill-the-kernel     │  GATE   │ Check 2: §4.2 collapse on ONE     │
│  (+ load-bearingness         │ ──────▶ │  indicator in exercir            │
│   scorecard across domains)  │         │  (finish ADR-224 → discriminating │
└─────────────────────────────┘         │   query → tree-substitution CF)   │
        │                                └──────────────────────────────────┘
        │ also runs anytime, independent          │  PASS │ FAIL
        ▼                                          ▼       ▼
┌─────────────────────────────┐         Phase 2          Option B:
│ Check 5: B3-S4b replay       │         ┌─────────────┐  write down we're
│  (finish in-flight; cheap    │         │ Check 3:    │  deferring the thesis,
│   differentiated win)        │         │ nested twin │  set a re-test trigger,
└─────────────────────────────┘         │ down-cascade│  stop building on faith
                                         └─────────────┘
                                                │ PASS
                                                ▼  Phase 3
                                         ┌─────────────────────────┐
                                         │ Check 4: flywheel toy    │
                                         │  (last — fuzziest moat)  │
                                         └─────────────────────────┘
```

- **Phase 0 — analysis, do now.** Check 1 + a one-page "kernel load-bearingness scorecard" across all domains (mostly already known from the specs#298 audit). Independently, finish **Check 5** (B3-S4b) — it's in flight, cheap, and the one differentiated concern already on the critical path. Neither gates anything; both inform.
- **Phase 1 — the gate that matters.** Check 2. This is the single test worth running even if we do nothing else. **A FAIL here is the strongest possible signal to take Option B** — if we cannot make even one query genuinely need the tree-as-program, the §4.2 collapse is a diagram and we should stop pretending otherwise.
- **Phase 2 — only if Phase 1 passes.** Check 3 (down-cascade), reusing Check 2's real-composition adapter in the same host (exercir / FF9).
- **Phase 3 — the moat, most deferrable.** Check 4. Last because it is the fuzziest and because a flywheel over a per-tenant twin that *isn't real* is nothing — it only makes sense once 2+3 prove the per-tenant twin is real.

---

## 4 — Per-check playbook

### Check 1 — Kill-the-kernel (herdbook) · Phase 0 · ~1 day · read-only
- **Do:** enumerate every kernel concern herdbook imports (known: `LineageRepository`, `AuditService`, `PackManifest` — zero plan tree / inference / reproducibility). For each, ask: *if deleted, could herdbook cheaply rebuild it as a plain library?*
- **Constructive inverse (the valuable half):** is there a herdbook capability that is *currently pack-side* but is a kernel inference query in disguise? Prime candidate: **mating-pair recommendation under uncertainty** — is that a twin/counterfactual query? If yes, herdbook becomes a Check-2 candidate.
- **Pass:** at least one concern is load-bearing (deleting it costs a capability). **Fail:** "none" — confirms the worry; herdbook is a domain on a shared library, and we note it as evidence for Option B.
- **Output:** verdict + the load-bearingness scorecard across all six domains.

#### RESULT (run 2026-06-10) — FAIL (points to Option B), with caveat

**herdbook uses zero of the four kernel concerns.** It imports from substrate only `LineageRepository`, `AuditService`, and `PackManifest`. No `INFERENCE_BACKBONE`, no plan tree / `EffectDeclaration`, no observation event-log write, no `RunManifest`. Deleting all four concerns costs herdbook nothing.

The kernel *is* load-bearing for herdbook — but only via **lineage + `computeKinship`/`computeInbreeding`** (promoted to the kernel under ADR-201 because conservation **and** herdbook need it — the ADR-176 ≥2-pack test working correctly), plus commodity audit + RLS. Lineage is **not one of the four concerns**, and `kinship` is the `pedigree-tabular` method (Wright/Malécot — a closed-form classical algorithm herdbook could rebuild as a plain library in days). Shared *convenience*, not a moat.

**Constructive inverse — the sharpest finding:** herdbook's mating recommendation, its single most twin-shaped decision (north-star §8 *"twin projects outcome under plan X"*), is a deterministic threshold classifier: `predictedF = lineage.kinship(sire,dam)`, then `classifyVerdict` = `f>=0.0625 ? 'red' : f>=0.03125 ? 'amber' : 'green'`. No posterior, no uncertainty, no observation evidence, no counterfactual. The reverse-planner (B6) is *latent* here, but realizing it needs a trait-observation log + a breeding-value inference family herdbook lacks — circular: you'd build the unproven machinery to prove herdbook needs it.

**Load-bearingness scorecard (all six domains):**

| Domain | Plan tree | Obs. event-log | Inference | Reproducibility | 4-concern verdict |
|---|:--:|:--:|:--:|:--:|---|
| exercir | ✅ container | ⚠️ in-mem fixtures | ✅ Beta/Normal + what-if | ⚠️ partial | Load-bearing — the easy ~60%; what-if = arm-comparison |
| gridiron | ⚠️ degenerate | ✅ real event_log | ✅ Normal-Normal | ⚠️ ETL | conjugate update only; NFL math pack-side |
| conservation | ⚠️ forked | ⚠️ forked | ✅ shared port only | ⚠️ | declined to reuse tree/log — collapse didn't generalize |
| herdbook | ❌ | ❌ | ❌ | ❌ | **zero of four**; mating = threshold classifier |
| devloop | ❌ | pattern only (JSONL) | ❌ own MC | pattern only | routes around the kernel entirely |
| markets / agri | ❌ | ❌ | ❌ | ❌ | scaffolds |

**Aggregate:** zero domains exercise all four; one (exercir) exercises three partially; the differentiated layer (effect algebra, nested-twin cascade, flywheel, §4.2 collapse) is exercised by **zero**.

**Caveat (fair):** herdbook was *scoped* as a registry/system-of-record, not an inference consumer (its CLAUDE.md lists shared-kernel epics as identity/pedigree/code-list/audit — inference deliberately absent). **Reframe (the real finding):** that's the portfolio problem — the two most-built non-sports domains (herdbook, conservation) are scoped so they don't need the differentiated kernel, and the one with a free hand forked it. The portfolio is selecting for domains that don't test the thesis. **Burden now shifts squarely to Check 2.**

### Check 2 — §4.2 collapse on ONE indicator (exercir) · Phase 1 · the gate
- **Precondition:** finish **ADR-224** (real `ComposedEffect[]` composition replacing the flat-multiply gap). This is the first half — without it, every composition operator still collapses to one behaviour and the test is unwinnable by construction.
- **Build the discriminating query:** in exercir, an indicator (e.g. `football.indicator.pass_completion`) where two plan-tree drills both declare an effect, and the **choice of composition operator** (sum vs max vs sequential-with-decay) **changes the projected posterior enough to flip a decision.** If the operator never changes the answer, the algebra is decorative and the test fails.
- **Build the tree-substitution counterfactual:** a what-if that **substitutes a subtree and re-conditions**, not one that compares two pre-built arms. Show the posterior moves *because the tree changed*, resolved by the kernel — not by football code.
- **Pass:** both hold — the tree-as-program demonstrably matters. **Fail:** we cannot construct a query where composition or substitution changes the answer → **Option B**, with this result as the evidence.

#### STATUS (2026-06-10) — precondition is ratified + branch-ready but UNLANDED; criteria sharpened

Investigating the precondition revealed it is far more advanced than assumed, and corrected an overstatement in specs#298:

- **The algebra exists on the plan side.** `composeEffects` (ADR-199 D1) already honors the operator + preserves the full `DistributionSpec` (shipped `contracts@0.10.0`). The `KNOWN-GAP(ADR-154)` flat-multiply was the **inference-side consumption path only**, not the algebra.
- **ADR-224 (ratified 2026-06-09, charter-tier)** closes the inference-side gap: inference consumes mean+variance and honors the operator via a tractability matrix (closed-form cells ✓ + typed `deferred`, no silent fallback). Closed-form covers every live consumer (`point`/all likelihoods, `normal`-on-`normal` with variance propagation, `beta`-on-`beta`).
- **Branch `feat/adr-224-inference-effects`:** 6 commits ahead, +1410/−831 across 29 files, all 6 adapters migrated, KNOWN-GAP "closed." **But no PR, greenness unverified → not landed.**

**Sharpened pass criteria** (operator-sensitivity is now trivially satisfiable once ADR-224 lands, so it is no longer the gate):
1. **Decision-relevance** — one exercir query where the distribution-aware composed posterior (operator + variance) changes a *coach-facing decision*, not just a number, vs the flat-scalar model.
2. **Re-conditioning honesty** — `counterfactual` is wired but `condition`/`cohortMarginal`/`identify` stay deferred, so it is tree-substitution **without** shared-latent re-conditioning. Name precisely what that leaves missing for full §4.2.

**Immediate next step:** land ADR-224 (open PR → verifier wave → merge; breaking port-shape, design ratified) → then build the exercir decision-query.

#### RESULT (spike run 2026-06-10, against the unlanded branch) — PARTIAL PASS

Spike spec: `libs/substrate-runtime/src/inference/adr224-thesis-gate.spike.spec.ts` (in the `substrate-wt-adr224` worktree). Numbers matched hand-computation exactly (rules out test-theater).

**Criterion 1 (decision-relevance): PASS.** The POINT condition *is* the pre-ADR-224 flat-scalar model (adapter guarantees "backward-compat exact for all-point inputs"). Same mean-shift (+2.0), decision flips on variance-awareness alone:

| condition | post.sd | P(≥1.0) | decision |
|---|---|---|---|
| POINT (= old kernel) | 1.000 | 0.841 | commit |
| NORMAL (ADR-224 honest variance) | 2.345 | 0.665 | **don't commit** |

The flat-scalar path structurally cannot produce this (it reduces every effect to its mean). So the effect algebra is **load-bearing**, not decorative, and moves the decision in the correctly-cautious direction.

**Criterion 2 (re-conditioning counterfactual): UNMET.** `counterfactual()` = two independently composed posteriors sharing one RunManifest (tree-substitution-and-recompute, not re-conditioning). `condition`/`cohortMarginal`/`identify` all return `not-implemented-phase-1`. No shared-latent state across the swap.

**Net: §4.2 partially substantiated** — "the plan tree carries distribution-shaped effects that change decisions" ✓; "counterfactuals are re-conditioning over one joint program" ✗ (deferred).

**Caveats (keep honest):** (1) shallow tree — one node, two effects, one family; no recursion / operator-switching exercised. (2) synthetic decision rule on the in-memory adapter, not exercir's real coach surface.

**Check 2.5 (exercir effect-declaration shapes) — RESULT: the variance is already declared, just discarded.** exercir's `interventions.ts` / `drill-subtrees-seed.ts` declare distribution-shaped effects throughout: `{kind:'normal', mean, sd}`, `{kind:'lognormal', meanLog, sdLog}`, `{kind:'beta', alpha, beta}` — never bare `point`. The seed comments confirm the magnitudes were authored "to match how the substrate's `reduceMagnitude` extracts the centre" — i.e. exercir wrote honest variance into every drill and the **pre-ADR-224 `reduceMagnitude` path discards it**. So the POINT→NORMAL flip is *not* hypothetical: landing ADR-224 makes exercir's existing drills propagate their declared uncertainty live, with no re-authoring. **Downgraded caveat:** the magnitudes are flagged SYNTHETIC POC values, so the variance is structurally real but not empirically grounded.

**Implication for A/B:** first PASS-ish signal — argues *against* pure Option B (the kernel now does something a flat library can't, decision-relevantly). But it's shallow/synthetic/unlanded and the deeper half is deferred, so it does NOT prove the §4.2 collapse. Remaining doubt is now concentrated on criterion 2 (re-conditioning = `condition()`), which is exactly where **Check 3** (nested twin / cascade) lives.

### Check 3 — Nested twin with real down-cascade (exercir / FF9) · Phase 2
- **Precondition:** Check 2 passed (real composition adapter exists).
- **Do:** finish the EB-hierarchical adapter's deferred **"Tier 5"** — a team-level counterfactual that **cascades to per-member assignments and aggregates back**, with per-member detail **surfaced on the result shape** (today it's "computed + tested but kept internal"). Smallest credible scope per north-star §13 demo 3: one indicator, one team, one counterfactual.
- **Pass:** a team-level what-if produces per-player assignments and a correctly-aggregated team posterior. **Fail / too costly:** record that the most-differentiated claim is not yet reachable; revisit Option B.

### Check 4 — Flywheel super-linearity at n=2 tenants · Phase 3
- **Precondition:** Checks 2+3 passed (the per-tenant twin is real).
- **Do:** two tenants, one indicator. Tenant A has many observations feeding a **shared vendor-tier catalog prior**; tenant B is cold-start. Show B's posterior is **measurably sharper *and correctly calibrated*** with the shared prior than a B-only model — and that the sharpening is something a per-tenant model structurally cannot get.
- **Design risk (the hard part):** keep it **non-circular** — the shared prior must be genuinely informative, not B's own data relabeled, and not merely overconfident.
- **Pass:** a real, calibrated super-linear effect. **Fail / only-in-toy:** the moat is hypothetical at our scale — a critical input to the A/B decision and to Option A's overall viability.

### Check 5 — Reproducibility that bites (B3-S4b) · Phase 0, parallel
- **Do:** finish the in-flight B3-S4b (branch cut, plan written): one provable **bit-identical survival replay across a real catalog version bump** + one correct **`catalog-drifted` refusal** + the three seed-pinned `sample()` impls.
- **Pass:** both demonstrated. **Caveat:** this proves the *least-contested* concern — finish it as the cheap differentiated win, but do **not** mistake it for a thesis test. It strengthens "consistent with" without touching the §4.2 / flywheel doubts.

---

## 5 — The decision this drives, and cadence

- **After Phase 0:** if Check 1 returns "none" load-bearing AND the scorecard shows every domain on the commodity layer, that is the first formal data point for **Option B**. Re-read at the ADR-218 amendment.
- **After Phase 1 (the gate):** Check 2 PASS → proceed to Phase 2 and propose **Option A** (amend ADR-218 to keep a thesis-test on the path). Check 2 FAIL → adopt **Option B**: write the deferral down in an ADR with an explicit re-test trigger (e.g. "first domain whose value proposition requires the collapse"), and stop building platform machinery on faith.
- **Cadence:** treat each phase as a gate reviewed before the next spend. Do not batch — the entire value of the strategy is that a cheap negative result stops an expensive build.

This strategy is itself Option-A-disciplined: every check is hosted by a *product* (exercir, herdbook, oncology) pulling on the substrate, never a substrate-only feature built speculatively.
