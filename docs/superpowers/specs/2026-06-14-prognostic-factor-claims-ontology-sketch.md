# Prognostic-factor claims — modeling expected outcome *without* interventions

**Status:** concept sketch / promotion candidate (not an ADR yet)
**Date:** 2026-06-14
**Against:** the claim-ontology direction (specs#303 — "claim ontology = the kernel's semantic theory"; guardrail *"semantic layer yes, storage model no"*)
**Relates:** ADR-127 (kernel substrate v1), ADR-154 (effect-declaration algebra), ADR-176 (kernel-minimality inclusion test), ADR-223 (in-process survival family), the §11 validation gate, `domains/scenario-lab` (the agnostic scenario engine)

## The question

> How do we model **expected outcome without interventions** — e.g. that a cancer-ill person would die untreated — and make it **subject-specific**?

## What works today

"Expected outcome without interventions" is **Y(0)** in potential-outcomes terms: the bare fitted baseline posterior with the **empty effect set**. Effects compose multiplicatively (`HR = exp(Σ logHR)`); with no interventions `Σ logHR = 0 → HR = 1 → S(t) = S_base(t)`. So:

- It is **not a special case** — it is the **baseline arm of every counterfactual** the engine already computes (the "no therapy" curve; the treatment effect is the contrast `Y(1) − Y(0)`).
- **Death untreated** = the baseline survival curve declining toward 0 → `P(dead by horizon) = 1 − S_base(horizon)`. Probabilistic, over time — a hazard/distribution, never a deterministic per-individual fate.
- The natural-course hazard is sourced from untreated-cohort data, literature/expert priors, or a *specified synthetic baseline* (the `scenario-lab` path).

**Population/stratum baseline works fully today** — the subject's risk mix enters through the *data* the baseline is fit from (e.g. `scenario-lab` injected the node-positive subgroup via cohort generation, not the plan-tree).

## The gap

To say "***this* patient's** untreated outcome, given *their* risk profile," we need **covariates / risk factors** that shift the baseline per-subject. The ontology *can* express them — they are `EffectDeclaration`s moving the indicator — **but nothing distinguishes a covariate (what the subject *is* → shifts the baseline) from an intervention (what you *do* → treatment effect).** Both are just effects on a node, and the kernel's nodes are *intervention* nodes (ADR-127). A risk factor and a treatment are today **indistinguishable in the storage model**.

Consequence: "expected outcome without interventions" cannot be queried as *"compose the prognosis, exclude the treatments"* — because the two are not typed apart.

## The proposed move (semantic layer, not storage)

Type the distinction in the **claim ontology**, riding the existing `EffectDeclaration` + composition — **no new storage primitive** (honors *"semantic layer yes, storage model no"*):

- **`treatment-effect` claim** — magnitude attributable to a *chosen action* (an intervention plan node). Modifiable by the care plan; the thing the §8 ladder claims.
- **`prognostic-factor` (risk-covariate) claim** — magnitude attributable to a *subject characteristic* (stage, markers, age, duty-cycle…). Not actionable; it conditions the baseline.

Then **expected outcome without interventions** is a clean query:

> compose the `prognostic-factor` claims onto the baseline fit; **exclude** the `treatment-effect` claims.

`Y(0)` becomes subject-specific without conflating "what the patient is" with "what we did." `Y(1) − Y(0)` (treatment benefit) stays the contrast over only the `treatment-effect` claims.

### Why the claim ontology is the right home
- It is the kernel's **semantic theory** — claim *types* are exactly its remit; the storage stays the ADR-154 effect-declaration algebra.
- `EffectDeclaration` already carries `basis` (provenance) and `indicatorId`/`magnitudePrior`; the claim-type is an orthogonal semantic tag, not a new column class.
- ADR-176 posture: **demand-driven promotion candidate.** Trigger = a *second* pack needing the split (oncology prognosis + a fitness baseline-risk profile would be two). Until then it is a documented candidate, not a build.

## Open edges (flagged, not solved here)

1. **Cure fraction.** Weibull/log-logistic decay `S(t) → 0` (uniformly-fatal natural course — clean for "untreated → death for all"). A natural course with a **cure fraction** (some survive untreated) needs a **mixture/cure inference family** — a new family under ADR-176 §3 (demand-driven), not a claim-ontology change.
2. **Competing risks.** All-cause vs disease-specific mortality; multi-state transitions. Out of scope for the single-event survival family; a future family.
3. **Validation of Y(0).** The no-intervention prediction is a model like any other — calibrate predicted *untreated* survival against observed untreated outcomes (the §11 gate / calibration panel already covers the baseline arm). A confidently-wrong prognosis is as dangerous as a wrong treatment effect.
4. **Where a prognostic-factor claim attaches.** Conceptually to the subject's *baseline state*, not an intervention node — but the kernel models intervention nodes only. Resolve whether prognostic claims hang on the root/state node, or are carried as subject-scoped declarations read alongside the tree. (Storage-shape question; defer to the promotion ADR.)

## Studio implication (the live thread)

- The **do-nothing baseline is the always-present reference curve** on the results dashboard — the counterfactual delta is meaningless without it.
- The authoring panel's effect-declaration serves **both** kinds; the UI difference is the **claim type** (and whether it hangs on the subject's baseline-state or a plan action). A profile decides which risk factors are offered.
- This keeps the wedge intact: a subject-specific *prognosis* (untreated expected outcome) that is itself **validated** and **reproducible**, not asserted.

## Next step

If greenlit: a formal claim-ontology amendment ADR (the `treatment-effect` vs `prognostic-factor` claim types + the "exclude-treatments" baseline query), cited against the claim-ontology §4.5 promotion test, with the cure-fraction family noted as a separate demand-driven family ADR. Until a second pack demands it, this sketch is the queued candidate.
