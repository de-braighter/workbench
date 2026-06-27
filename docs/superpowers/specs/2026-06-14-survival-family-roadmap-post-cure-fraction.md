---
title: "Survival-family roadmap (post cure-fraction): the four remaining deferrals + NumPyro (Track D) — demand-gated, tracked, sequenced; NumPyro designed-but-deferred"
status: planning
created: 2026-06-14
last_updated: 2026-06-14
authors: [stibe]
relates-to:
  - layers/specs/adr/adr-231-mixture-cure-survival-family.md
  - layers/specs/adr/adr-230-prognostic-factor-claims.md
  - layers/specs/adr/adr-223-survival-inference-family.md
  - layers/specs/adr/adr-220-reproducibility-proof-minimal-run-manifest-and-distribution-catalog.md
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
  - layers/specs/adr/adr-154-algebraic-effect-declarations-and-composition-operators.md
  - layers/specs/adr/adr-127-kernel-substrate-v1.md
  - layers/specs/adr/adr-121-projection-state-schema-and-versioning.md
  - layers/specs/adr/adr-122-projector-implementation-contract.md
  - layers/specs/adr/adr-213-generalize-subject-ontology-beyond-person.md
ratified-by: []
---

# Survival-family roadmap (post cure-fraction): the four remaining deferrals

> **What this is.** A planning document, not a spec and not an ADR. It maps the four survival-family
> deferrals that survive the cure-fraction land (ADR-231 + ADR-230 §7), applies the ADR-176 inclusion
> test to each with teeth, clusters them into tracks, and recommends a sequence. **The founder uses it to
> greenlight which tracks to build.** Nothing here is decided; the recommended verdicts are inputs to a
> decision, and the most important judgment in the document is *"which of these has genuine ≥2-pack demand
> today, and which stays deferred."*
>
> **NumPyro is now DESIGNED (Track D), but deferred-not-built.** Originally excluded by construction; the
> founder asked for it to be designed too (2026-06-14), so it is now **Track D** with a full companion design
> (`concepts/design/2026-06-14-numpyro-bayesian-sidecar-design-deferred.md`). The verdict is unchanged in
> substance — it stays the standing in-process-first deferral (ADR-223 Alt-3, re-confirmed by ADR-231 Alt-3)
> — but the architecture + the load-bearing reproducibility-contract resolution are now worked out so it is
> ready when its trigger fires. **Designed ≠ greenlit-to-build.** See [§7](#7-track-d--numpyro-bayesian-sidecar-designed-deferred-until-the-trigger).

## 0. The just-shipped baseline (what is now true)

The cure-fraction family **landed** 2026-06-14:

- **ADR-231 ratified** (`adr/adr-231-mixture-cure-survival-family.md`), shipped as substrate#174
  (`survival.mixture-cure-weibull@1`, contracts 2.2.0) + substrate#176 (the log-logistic-susceptible
  sibling, 2.3.0). The EM lives at
  `layers/substrate/libs/substrate-runtime/src/inference/math/mixture-cure-weibull.ts`.
- **ADR-230 proposed** (`adr/adr-230-prognostic-factor-claims.md`) — the semantic split typing
  `treatment-effect` vs `prognostic-factor` claims over the existing `EffectDeclaration`. **Zero new
  storage.** Y(0) is now a clean, subject-specific query: `compose the prognostic-factor claims onto the
  baseline; exclude the treatment-effect claims` (ADR-230 D2).
- The contract surface is settled: `SurvivalSummary` carries an **optional** `cureFraction?` field
  (`layers/substrate/libs/substrate-contracts/src/inference/inference-types.ts:139`); the HR composes on
  the **susceptible** hazard via the unchanged log-space `composeEffects` fold (ADR-231 D3); reproducibility
  rides `kernel.run_manifest` + `replay()` unchanged (ADR-231 D6).

The cure-fraction land is deliberately minimal, and it deferred five things by name (ADR-231 §"Open items").
Stripping out (i) the log-logistic-susceptible sibling — **already shipped** in substrate#176 — and (ii)
NumPyro — **excluded** — leaves exactly the four deferrals this roadmap plans:

| # | Deferral | Source |
|---|---|---|
| 1 | **Treatment-on-π** (logistic-link effect on the cure fraction) | ADR-231 D3 + §Open items; ADR-230 §7.1 lineage |
| 2 | **Competing-risks / multi-state** (cause-specific hazards, CIF) | ADR-231 §Open items; ADR-230 §7.2; ADR-223 open item (interval/competing) |
| 3 | **π / prognostic-factor STORAGE attachment** (where a subject-characteristic claim physically hangs) | ADR-230 §7.3; ADR-231 §Open items |
| 4 | **Async population re-fit read-model** (off the synchronous request path) | ADR-223 §Decision 3 + §3 + §Open items; ADR-231 §Open items |

The standing kernel discipline governs all four (`adr/adr-176-...`): **(a) one of the four concerns, and
(b) ≥2-pack demand the kernel must validate/query/version. Both yes → kernel; either no → pack territory.
Promotion is demand-driven, never speculative.** This roadmap applies it adversarially per item — the bar
is *named demanders that exist today*, not plausible future ones.

---

## 1. Treatment-on-π — moving the plateau, not just the susceptible hazard

### What & why

Today (ADR-231 D3) a treatment composes a hazard ratio on the **susceptible** component only:
`S_adj(t) = π + (1 − π)·S₀(t)^HR`. The cured floor `π` is untouched by treatment. This deferral is the
capability to declare a treatment that **moves π itself** — a therapy that *cures more patients* (raises the
long-term-survivor plateau), e.g. adjuvant therapy that converts would-be-recurrers into long-term
disease-free survivors. The model is a second composition target: a **logistic-link covariate model on the
cure fraction**, `logit(π_adj) = logit(π_base) + Σ logOR(treatment)`.

The named driver is **oncology**: an adjuvant-therapy effect that genuinely shifts the cure fraction is the
clinically real shape of "this therapy doesn't just slow recurrence, it prevents it." It is the cure
analog of the treatment HR.

### The ADR-176 demand check (adversarial)

**Verdict: STAYS DEFERRED. No defensible ≥2-pack demand today — and a load-bearing identifiability gap on
top of the demand gap.**

ADR-231 D3 already pre-named the trigger precisely: *"the first consumer with a defensible treatment-on-π
effect AND the evidence to calibrate it."* Walking the test honestly:

- **Demander 1 (oncology):** plausible *eventually*, but **not nameable today** in the demanding sense.
  Treatment-on-π requires a calibratable log-odds effect of a specific therapy on the cure fraction —
  which requires (i) a fitted mixture-cure baseline with an **identified** π (ADR-231 D2: π is only pinned
  by heavy censoring past the plateau), and (ii) treated-arm cure-fraction evidence to estimate the
  log-OR against. The oncology product has neither a calibrated π nor a treated-arm cure-shift estimate
  yet — it has *just* acquired the family that can express π at all, and the §11 gate that validates it has
  not fired on real PHI. **Demand that depends on a not-yet-validated upstream is speculative by ADR-176 §3.**
- **Demander 2 (the agnostic studio baseline-risk profiles):** the ADR-231 / ADR-230 second consumer
  (fitness duty-cycle baselines, churn-with-permanent-retention) establishes a ≥2 demand for the **mixture
  family** and for the **prognostic-on-π conditioning**. It does **not** establish demand for a *treatment*
  that moves the plateau — a coach's training intervention moving the *susceptible* injury hazard is the HR
  story (already shipped); "a training intervention that moves the share of athletes who never get injured"
  is not a demand anyone has voiced. **So the second leg has one weak demander and one absent one — leg (b)
  fails.**

This is the cleanest "do not manufacture demand" case in the set. The capability is real and the design is
known (below), but ADR-176 §3 forbids building kernel surface ahead of a named, calibratable multi-pack
need, and there is exactly one (and even it is gated on an upstream that has not validated). **Recommend:
keep deferred; revisit when oncology has a fitted-and-§11-gated π AND a defensible treated-arm cure-shift to
calibrate against.**

### Design approach (for when the trigger fires — so the door is not foreclosed)

The shape matters because Track-1 clustering depends on it (see [§5](#5-synthesis-tracks-sequence-decisions)).

- **A second composition channel — the π logit-channel.** Today the engine has one composition channel:
  log-HR → `composeEffects` `sum` → `appliedHazardRatio` → applied to `S₀` (ADR-231 D3; ADR-154 Commitment
  5). Treatment-on-π adds a **second channel**: a **log-odds** magnitude composed by the *same* `sum`-over-
  normals fold, then `expit`-applied to the baseline π. Critically this rides the **existing**
  `composeEffects` algebra by the same trick ADR-223 §Decision 4 used for the HR — choose the
  representation (log-odds in log-odds-space, `compositionOperator: 'sum'`) so no new operator and no
  algebra change is needed. The new thing is **which baseline parameter the composed result targets**.
- **The discriminator: the EffectDeclaration needs to say which channel it targets.** This is the key
  design fork. Two options, recorded here, decided at trigger-time:
  - **Option A — derive the channel from the magnitude semantics + indicator binding** (the ADR-230
    posture, extended). ADR-230 typed `treatment-effect` vs `prognostic-factor` as a *semantic projection*
    over fields the `EffectDeclaration` shape already carries (`basis`, `conditions`, attachment), **with
    zero new field** (ADR-230 D1; the shipped shape at
    `layers/substrate/libs/substrate-contracts/src/plan-tree/effect-declaration.ts`). The analogous move
    here is to derive "targets the hazard (log-HR)" vs "targets π (log-odds)" from the indicator binding /
    a magnitude convention, **not** a new field. This keeps the ADR-176 surface at zero.
  - **Option B — a typed `target: 'hazard' | 'cure-fraction'` discriminant on the survival
    EffectDeclaration.** Honest and explicit, but it is a **storage promotion** (a new contract field) and
    must pass the inclusion test on its own demand — exactly the bar ADR-230 §5 declined for `claimType`.
  - **Recommendation when built: Option A first** (semantic-yes / storage-no, mirroring ADR-230's verdict),
    promote to Option B only if a pack demonstrates the kernel must *validate/version* the channel as a
    first-class column. This is the same two-verdict pattern ADR-230 §5 ran.
- **The covariate-EM extension.** The EM (`mixture-cure-weibull.ts`) M-step for π is currently
  `π = (Σ w_i)/n` — an unconditional mean. Treatment-on-π makes the M-step π a **weighted logistic
  regression** of the cure-status weights `w_i` on the per-subject treatment covariates:
  `logit(π_i) = β₀ + Σ β_j x_ij`, fit by IRLS inside the M-step (deterministic, the existing
  determinism discipline). The susceptible (λ, k) M-step is unchanged. **This is a new math module / a
  meaningful extension of the existing EM** — not a one-row catalog append.
- **The unification with prognostic-on-π.** This is the synthesis prior to validate: the **same logit-
  channel** carries both a *treatment* log-OR on π and a *prognostic* log-OR on π — exactly as the
  log-HR channel carries both treatment HRs and ADR-230's prognostic-conditioned-baseline HRs. The
  covariate mixture-cure model *is* subject-specific Y(0) on the plateau: prognostic factors condition
  π per subject (ADR-231 D3 already says prognostic claims condition π "conceptually"); treatment factors
  shift it under the counterfactual contrast. The channel is one mechanism; the claim-type partition
  (ADR-230 D2) decides which subset enters the baseline arm vs the treated arm. **So treatment-on-π and the
  π-side of #3 are the same new mechanism viewed from two claim types.** (Validated in §5.)

### Kernel-surface impact + inclusion-test sketch

- **Contracts (Ring 0):** Option A → zero new field (a derived channel reading). Option B → one additive
  discriminant. The new family registers as **one append-only catalog row**
  (`survival.mixture-cure-weibull-covariate@1` or a parameterization of the existing row's `fit` recipe).
- **Runtime (Ring 1):** the covariate-EM (IRLS M-step) — a real new math module + adapter branch.
- **Schema (kernel):** zero new tables; one catalog row; fitted models ride `kernel.run_manifest` unchanged.
- **Inclusion-test sketch:** leg (a) **yes** (inference, concern #3 — registry-menu growth, the ADR-231
  path). Leg (b) **NO TODAY** — one gated demander, one absent. **Net: fails the test today → stays
  pack-territory-or-deferred, not kernel surface.** When the trigger fires it is registry-menu growth (one
  row + an adapter), *not* new kernel surface — the same minimal posture as ADR-231, **plus** the
  channel-discriminator fork above.

### ADR(s) needed + scope + dependencies

- **ADR needed (at trigger-time):** one — "treatment-on-π: the cure-fraction logit-channel." Cites ADR-231
  D3 (the named trigger), ADR-230 D1/D2 (the claim-type channel sharing), ADR-154 Commitment 5 (the reused
  fold). **Status now: do not write.**
- **Scope: M** (covariate-EM IRLS M-step + the channel discriminator + a §11 gate extension for the cure-
  shift). Larger than ADR-231's one-row append because the EM genuinely changes.
- **Dependencies:** soft-depends on #3 (the π-side prognostic conditioning shares the channel — building #3
  first de-risks the channel design). Independent of #2 and #4.

---

## 2. Competing-risks / multi-state — cause-specific hazards and cumulative incidence

### What & why

Every survival family shipped so far (Weibull, log-logistic, KM, mixture-cure) is **single-event**:
`eventObserved` is a boolean, the output is one survival curve. Competing-risks modeling handles the case
where a subject can fail from **one of several mutually-exclusive causes** — recurrence vs death-from-other-
cause vs second primary — where the occurrence of one **precludes** the others. The reference quantities
are **cause-specific hazards** and the **cumulative incidence function (CIF)** per cause; the model-free
reference is the **Aalen-Johansen estimator** (the KM analog for competing risks / the empirical CIF).
Multi-state modeling (transitions among states: disease-free → recurrence → death, with back-transitions)
is a further generalization.

The named driver is **oncology**: breast-cancer survivorship genuinely has competing risks — an older
survivorship cohort dies of cardiovascular or other causes at a rate that competes with recurrence, and
all-cause vs disease-specific mortality is a real clinical distinction (ADR-230 §7.2 named exactly this).
A single-event survival curve that ignores competing death **over-states recurrence-free survival** because
it censors competing deaths as if the subject could still recur.

### The ADR-176 demand check (adversarial)

**Verdict: STAYS DEFERRED — single demander today, and it is the largest surface in the set. Demand-gate it
hard.**

- **Demander 1 (oncology):** real and clinically motivated, but **not yet operationally demanded**. The
  product has not surfaced a competing-risks outcome in build — it has just acquired single-event survival
  + the cure fraction, and the §11 gate has not fired on real PHI. Competing risks becomes a *need* when a
  real survivorship cohort shows competing mortality material enough that the single-event curve mis-states
  prognosis — a regulated-operations event, not a build step. **Plausible soon; not nameable as a demanding
  consumer today.**
- **Demander 2:** **absent.** ADR-223's second-consumer story (time-to-resolution, devloop cycle-time-to-
  merge) and ADR-231's (fitness baselines, churn) are **single-event** — none of them has a competing-risks
  shape that's been voiced. A claim that resolves *or* is withdrawn is arguably 2-state, but no pack has
  asked for it. **Leg (b) fails on the second consumer.**

ADR-223's own open item ("competing-risks beyond v1 right-censoring") and ADR-230 §7.2 + ADR-231
§Open-items all already record this as deferred. This roadmap **concurs and strengthens the gate**: competing
risks is the **largest** of the four (it changes the observation shape AND the output shape — see below), so
the speculative-build cost is the highest. **Recommend: keep firmly deferred; this is the last track to
build, gated on a named oncology competing-risks cohort that the single-event family demonstrably mis-states
(caught at the §11 gate, which is the right detector).**

### Design approach (for when the trigger fires)

This is the only deferral that is **not** a registry-menu append onto the existing surface — it changes two
contract shapes, which is why it is a separate, large track:

- **The observation shape changes.** `SurvivalObservation.eventObserved: boolean` becomes (additively) an
  **event-type**: `eventType?: number | string` (0/absent = censored, 1..K = cause-specific event). This
  is an additive widen of `SurvivalObservation` (a new optional field; the boolean stays the single-event
  default), so it does not break existing families — but it is a genuine input-shape change, not "the
  same observation shape" the cure-fraction family reused (ADR-231 D2).
- **The output shape changes.** A single `S(t)` becomes **cause-specific curves** — a CIF per cause,
  `CIF_j(t) = P(fail from cause j by t)`, with `Σ_j CIF_j(t) + S(t) = 1`. This is a **new summary kind**
  (`kind: 'competing-risks'` on the `PosteriorHandle.summary` union) carrying an array of per-cause CIFs —
  a discriminated widen exactly like the ADR-223 `kind: 'survival'` widen, but a genuinely new shape, not
  an optional field on the existing one.
- **Aalen-Johansen as the model-free reference.** Just as KM is the reference the parametric survival fits
  validate against (ADR-223 §Decision 3), the **Aalen-Johansen estimator** is the non-parametric CIF
  reference the competing-risks fits validate against, and the §11 GoF gate compares fitted CIF vs AJ CIF
  per cause (the `kmSupDivergence` analog generalizes to a per-cause sup-distance).
- **One new family or a family-class?** The recommended framing: **one new family per parametric form**
  (e.g. `survival.competing-risks-weibull@1` = cause-specific Weibull hazards) registered as a catalog row,
  the same registry-extensible posture — but riding the new observation + summary shapes. Multi-state
  (transition intensities among >2 states with back-transitions) is a **further** family-class beyond
  cause-specific competing risks; recommend treating multi-state as a *separate, later* deferral inside
  this track, not built with it (cause-specific CIF is the demanded-first shape; multi-state is the
  research-grade generalization).

### Kernel-surface impact + inclusion-test sketch

- **Contracts (Ring 0):** one additive `eventType?` on `SurvivalObservation` + one new summary kind
  (`CompetingRisksSummary`) on the union. **Two genuine new shapes** (not one optional field) — minor bump,
  additive, but the biggest contract delta of the four.
- **Runtime (Ring 1):** new adapter(s) (cause-specific hazard MLE), the Aalen-Johansen estimator, a §11
  per-cause GoF extension.
- **Schema (kernel):** zero new tables; one (or per-form) catalog row(s); fitted models ride
  `kernel.run_manifest`.
- **Inclusion-test sketch:** leg (a) **yes** (inference, concern #3). Leg (b) **NO TODAY** (one gated
  demander, second absent). **Net: fails today → stays deferred.** When built it is registry-menu growth
  **plus** two additive contract shapes — heavier than ADR-231, lighter than a new concern. Still no new
  kernel concern, no new table.

### ADR(s) needed + scope + dependencies

- **ADR needed (at trigger-time):** likely **two** — one for the contract widen (the `eventType` +
  `CompetingRisksSummary` shapes + the family) and, if multi-state follows, a second for multi-state /
  transition intensities. **Status now: do not write.**
- **Scope: L** (cause-specific competing risks) → **XL** if multi-state is included. The largest track.
- **Dependencies:** independent of #1, #3, #4. The async re-fit (#4) becomes *more* valuable here (more
  parameters to fit → heavier compute) but is not a hard dependency.

---

## 3. π / prognostic-factor STORAGE attachment — where a subject-characteristic claim physically hangs

### What & why

ADR-230 made the prognostic-vs-treatment distinction a **semantic projection** with **zero new storage**,
and its query semantics (D2) are deliberately **attachment-agnostic** — the partition reads claim type
*however the claims are physically carried*. But ADR-230 §7.3 names the open question it left: a prognostic-
factor claim conceptually attaches to the **subject's baseline state**, not to an intervention plan node —
yet the kernel models *intervention* plan nodes only (ADR-127 concern #1; ADR-213 for the subject
abstraction). So **where does a subject-characteristic (prognostic) claim physically hang?** Two shapes,
both named in ADR-230 §7.3:

- **Option A — a root / state plan node.** The prognostic claim hangs as an `EffectDeclaration` on a
  designated `root` (or a new `state`-kind) plan node that represents "the subject's baseline condition,"
  read as the start of the tree.
- **Option B — a subject-scoped declaration read alongside the tree.** The prognostic claims live in a
  subject-scoped store (keyed by `SubjectRef`, not by `PlanNodeId`), read **beside** the plan tree at
  inference time and composed onto the baseline.

This is the piece that makes Y(0) **truly subject-specific** (ADR-230's wedge): prognostic factors condition
the baseline **per subject** — both the susceptible AFT *and* (per ADR-231 D3) the cure fraction π. The
named driver is **oncology prognosis** (stage, nodal status, tumor markers condition *this patient's*
untreated course) **+** the agnostic studio baseline-risk profiles (an athlete's duty-cycle conditions the
baseline injury curve) — i.e. the same ≥2 demand ADR-230 §5 established for the *semantic* split.

### The ADR-176 demand check (adversarial)

**Verdict: SPLIT — the demand is real (≥2 packs, the ADR-230 §5 pair), but the STORAGE shape passes the
inclusion test ONLY if the attachment must be kernel-validated/queried; today ADR-230's attachment-agnostic
query means it can run pack-side on `metadata` first.** This is the subtlest verdict in the set.

ADR-230 §5 already ran this as two objects with two verdicts:
- **The semantic distinction + Y(0) query partition → PROMOTED** (it's a query semantic the kernel's
  composition must support; ≥2-pack; landed in ADR-230 D2).
- **A typed `claimType` storage field → NOT promoted** (derivable, not yet kernel-validated).

The **attachment** is a *third* object, and it inherits the same logic. Walking it:

- **The demand for subject-specific Y(0) is genuine and ≥2-pack** (oncology prognosis + fitness baseline-
  risk; ADR-230 §5). That is **not** in question — it is the same demand that promoted the semantic split.
- **But the STORAGE attachment is severable from the demand.** Because ADR-230 D2's partition is
  attachment-agnostic, a pack can carry prognostic claims **today** in subject-scoped `metadata` (the
  ADR-176 §2 simplicity boundary) and run the exact same Y(0) query — *the query does not care where the
  claim is stored.* So the **storage** half does **not** pass leg (b) yet on the strict reading: the kernel
  does not yet *have to* validate/query/version a typed attachment, because the partition works over
  metadata-carried claims. **Promotion of the typed attachment is demand-driven (ADR-176 §3): build it when
  a pack demonstrates the kernel must validate the attachment as first-class — e.g. when subject-scoped
  prognostic claims must be RLS-isolated, replayed in `run_manifest`, or queried cross-pack.**
- **The reproducibility angle is the strongest pro-kernel argument, and it is worth weighing.** A
  prognostic claim that conditions a *validated, replayable* Y(0) prognosis (ADR-230 D3 — Y(0) is a model
  that must be §11-calibrated) arguably **must** be pinned in the reproducibility spine for the PCCP audit
  trail (charter §10) — the same disqualifier ADR-223 Alt-2 / ADR-231 Alt-2 give for pack-side fits. **If**
  the prognostic claim is part of what makes the fitted Y(0) replayable, it crosses into concern #4
  (reproducibility) and the kernel-attachment verdict flips to PROMOTE. This is the **named trigger** to
  watch: *the first time a subject-scoped prognostic claim must be replayed bit-identically as part of a
  Y(0) run manifest.*

**Recommendation: build the SEMANTIC + query side (done in ADR-230); keep the STORAGE attachment on
subject-scoped `metadata` until the reproducibility trigger fires, then promote.** This is honest ADR-176:
do not build kernel storage surface the attachment-agnostic query does not require — but name the
reproducibility trigger precisely so it is not missed. Practically, this track is **mostly already
discharged** by ADR-230; the remaining kernel work is gated and small.

### Design approach (for when the trigger fires)

- **The two storage-shape options (ADR-230 §7.3), with the ADR-176 verdict:**
  - **Option A (root/state plan node):** reuses the existing `kernel.plan_node` + `effects` JSONB surface
    (ADR-154 / ADR-200) — **zero new table.** A prognostic claim is an `EffectDeclaration` on a `root`/
    `state`-kind node, derived as `prognostic-factor` by the ADR-230 D1 projection. **This is the
    minimal-kernel option** and the recommended first promotion (it rides shipped surface). Cost: it bends
    "plan nodes are intervention nodes" (ADR-127 concern #1) — a `state` node is not an action. ADR-230 §7.3
    flags exactly this tension.
  - **Option B (subject-scoped declaration store):** a new subject-keyed surface (a table or a typed region
    keyed by `SubjectRef` per ADR-213). **This is a new kernel table** → must pass the inclusion test on
    its own demand. More honest semantically (a subject characteristic is *about the subject*, not a node),
    but heavier.
  - **ADR-176 verdict between them: prefer Option A** (reuse `plan_node` + `effects`, a `state`-kind node;
    zero new table) **unless** subject-scoped cross-tree reuse is demanded (a prognostic profile shared
    across many plan trees for one subject), which is the trigger for Option B. Decide at promotion-time on
    the actual demand shape.
- **The π connection.** This track is **broader than π** — prognostic factors condition the **susceptible
  AFT baseline** (ADR-230 D2: `S_0(t|subject) = S_base(t)^exp(logHR_baseline)`) AND the **cure fraction π**
  (ADR-231 D3). So #3 spans both the log-HR channel (susceptible baseline) and the logit-channel (π). The
  π-conditioning specifically *is* the prognostic side of #1's logit-channel — which is why #1 and the
  π-side of #3 cluster (see §5). But #3 is not subsumed by #1: its log-HR-on-susceptible-baseline half is
  already expressible (ADR-230 D2) and just needs an attachment.

### Kernel-surface impact + inclusion-test sketch

- **Contracts (Ring 0):** zero today (ADR-230 is attachment-agnostic). At promotion: Option A → possibly a
  `state` plan-node kind (additive enum); Option B → a new subject-scoped contract.
- **Schema (kernel):** Option A → zero new table (reuses `plan_node`/`effects`); Option B → one new table.
- **Runtime (Ring 1):** the read-alongside-the-tree composition path (small — the partition already exists
  in ADR-230 D2).
- **Inclusion-test sketch:** leg (a) — the **query** is concern #3 (done); the **attachment**, if it must
  be replayed, becomes concern #4. Leg (b) — the subject-specific-Y(0) demand is ≥2-pack (PROMOTED for the
  semantic side); the **storage** attachment passes leg (b) only when the kernel must validate/version it
  (the reproducibility trigger). **Net: semantic side already kernel; storage side stays metadata until the
  named trigger, then Option A (no new table) is the minimal promotion.**

### ADR(s) needed + scope + dependencies

- **ADR needed (at trigger-time):** one — "prognostic-factor storage attachment" (the ADR-230 §7.3 ADR it
  explicitly defers to). Cites ADR-230 §7.3, ADR-154/ADR-200 (the `effects`-on-plan-node surface for
  Option A), ADR-213 (subject ref for Option B). **Status now: do not write the storage ADR yet;** the
  semantic side is already in ADR-230.
- **Scope: S** (Option A, reusing `plan_node`/`effects`) → **M** (Option B, new subject-scoped surface).
- **Dependencies:** the π-side overlaps #1's logit-channel (build together — see §5). The susceptible-
  baseline side is independent and already expressible.

---

## 4. Async population re-fit read-model — moving the cohort fit off the request path

### What & why

ADR-223 §Decision 3 already drew the line: the **per-subject** posterior (fit baseline + apply the composed
HR for one patient's tree) is the interactive request-path call, but the **population re-fit** (re-estimating
the cohort baseline on accruing outcomes — the PCCP in-envelope update, charter §10) is **async** — "a job
writes a new fitted-model read-model + a new `kernel.run_manifest`, the request path reads the latest." This
honors ADR-176's "expensive computation is async; never synchronous in a request path" rule.

The cure-fraction land made this sharper: the qa-engineer flagged the **nested EM cost** — the mixture-cure
EM (`mixture-cure-weibull.ts`) runs an outer EM loop (up to 500 iterations) with an **inner** profile-Newton
per iteration (up to 100), per cohort. On a large cohort that is materially more expensive than the
closed-form Normal-Normal posterior the WS-9 markets proof replayed, and competing-risks (#2) and the
covariate-EM (#1) would each make it heavier still. **The driver here is operational, not domain:** keep the
cohort fit off the synchronous request path so request latency does not depend on cohort size.

The open question ADR-223 + ADR-231 both carry: **does the async re-fit need its own read-model table for
the latest fitted model, or does the latest `kernel.run_manifest` suffice as the "current model" pointer?**

### The ADR-176 demand check (adversarial)

**Verdict: BUILD WHEN THE COST IS REAL — gated on a measured request-path EM cost, NOT on cohort-size fear.
This is the one track whose trigger is operational and measurable rather than domain-demand, and it should
be greenlit the moment the synchronous EM cost is demonstrated, not before.**

> **⏱️ MEASURED 2026-06-14 (founder-greenlit microbenchmark) — the cost trigger has NOT fired at v1 scale.**
> A deterministic microbenchmark (median of 30 timed runs, 5 warm-up, Win11 dev laptop, Node v22; budget =
> 50 ms request-path ceiling) timed both shipped mixture-cure fits across cohort sizes. Both converge in
> exactly **8 outer-EM iterations** at every n (data-shape-stable).
>
> | n | Weibull med (p95) | Log-logistic med (p95) |
> |---:|---:|---:|
> | 500 | 1.5 ms (1.9) | 1.5 ms (1.8) |
> | 1000 | 2.7 ms (3.1) | 2.8 ms (3.1) |
> | 2000 | 5.3 ms (6.0) | 5.6 ms (6.3) |
> | 5000 | 13.5 ms (14.7) | **44.8 ms (55.0)** |
> | 10000 | 27.8 ms (40.0) | **105.3 ms (171.7)** |
>
> **Crossings:** Weibull never crosses 50/100/250 ms within the tested range (linear ~2.7 ns/obs).
> Log-logistic crosses **50 ms at n≈10k** and ~44 ms at n=5k (the 2-D Newton + gradient-halving fallback is
> O(n)-per-candidate, super-linear at scale). **At realistic breast-cancer-survivorship cohorts
> (hundreds–~2,000 patients) both fits run < 6 ms — synchronous is fine for v1.**
>
> **Conclusion: Track C STAYS DEFERRED — the synchronous EM is not a request-path problem at v1 scale.** The
> trigger is now **quantified, not feared**: re-evaluate when (a) a cohort reaches **≥5,000** patients on the
> **log-logistic** family (the first to approach the ceiling), or **>10,000** on Weibull; OR (b) the first
> PCCP in-envelope population re-fit lands (the ADR-223 §Open-items trigger, independent of raw latency).
> Re-measure recipe: time `fitMixtureCure{Weibull,Loglogistic}` over deterministic π≈0.3 cohorts at the
> target n vs the 50 ms budget. Do NOT build the async re-fit now — the evidence gate the roadmap set is not met.

- **This is infra, not a domain family** — leg (a) is **concern #4** (reproducibility — versioned catalogs,
  run manifests; the re-fit *produces* a new pinned model version) **and** an operational property ADR-176
  §"expensive compute is async" governs directly.
- **Leg (b) is satisfied structurally:** every survival-consuming pack (oncology + ADR-223's time-to-event
  consumers + the studio baselines) hits the same population-re-fit shape — it is shared infra the kernel
  must own, not pack territory (a pack-side re-fit has no kernel-versioned manifest → no replay → no PCCP
  evidence, the ADR-223 Alt-2 disqualifier). **So the demand is genuinely ≥2-pack the moment the cost is
  real.**
- **The honest gate is the trigger ADR-223 §Open-items names:** *"the first PCCP in-envelope re-fit queried
  by 'give me the current live model for tenant X' at request-path latency"* — i.e. the first time the
  synchronous fit is too slow to sit in a request, OR the first PCCP in-envelope re-fit. **This is
  measurable** (a microbenchmark of the EM at realistic cohort sizes), unlike the domain triggers above. It
  is the one track where "build it" is a near-term, evidence-gated yes rather than a deferred-pending-demand.

**Recommend: greenlight a measurement first** (escalate to `implementer` for a microbenchmark of the
mixture-cure EM across cohort sizes — see escalation note), then **build the async re-fit the moment the
measurement shows the synchronous EM exceeds the request-path budget OR the first real PCCP in-envelope
re-fit lands.** Do not pre-build it speculatively; do not let it lag once the cost is shown.

### Design approach

- **The async job + the read-model.** A re-fit job (out-of-band, not in the request path) recomputes the
  cohort baseline (the EM) and writes (i) a new `kernel.run_manifest` row (the pinned, replayable model
  version — already the ADR-231 D6 / ADR-220 spine) and (ii) makes it discoverable as "the current fitted
  model for tenant X." The request path then reads the latest fitted model and applies the per-subject HR /
  π conditioning cheaply. This is the **store-the-generator-derive-the-view** pattern (ADR-176 §4): the fit
  is the expensive generator, run async; the request path reads a cheap derived handle.
- **The open fork: read-model TABLE vs latest-`run_manifest`-as-pointer.** This is the decision the founder
  must make for this track:
  - **Option A — latest `kernel.run_manifest` as the "current model" pointer.** Zero new table. "Current
    model for tenant X" = the most-recent `run_manifest` row for the relevant `(tenant, indicator, family)`
    with `method = 'posterior'` (or a re-fit marker). **Minimal-kernel.** Cost: "latest" is a query
    (ORDER BY created_at DESC LIMIT 1) with the subtle correctness question of *which* manifest is the
    canonical live one (a replay also writes manifests; a re-fit must be distinguishable from a replay).
  - **Option B — a dedicated read-model table** (`kernel.fitted_model_current` or similar): one row per
    `(tenant, indicator, family)` holding a pointer to the canonical live `run_manifest` + the cached
    `SurvivalSummary`. **This is exactly the deferred `kernel.posterior_cache` / `projector_state` shape
    ADR-220 named** (ADR-220 §"What is explicitly DEFERRED" — `posterior_cache` is "avoid recompute" +
    "current model" infra; `projector_state` is the rebuild-checkpoint infra). A re-fit is a **projection
    rebuild** in the ADR-121/122 sense: the async job is a projector, the read-model is its projection
    state, the cut-over to a new fitted model is a blue-green version flip (ADR-121 invariant 6).
- **The ADR-031/121/122 projector tie-in (this is the load-bearing connection).** The async re-fit **is**
  the first real consumer of the deferred projector surface. ADR-220 deferred `kernel.projector_state` with
  the named trigger *"the first materialized read-model that needs a rebuild checkpoint (ADR-031)."* **The
  async population re-fit is that trigger.** So Option B is not a new invention — it is the demand that
  earns the already-designed-but-deferred `projector_state` (ADR-121's 6-state machine + ADR-122's
  idempotent-apply contract). The re-fit job is a `Projector` (ADR-122 invariant 1); the fitted-model
  read-model is its `projection_state` (ADR-121); cut-over to a re-estimated cohort baseline is the
  blue-green version flip (ADR-121 invariant 6). **This is the strongest case in the set for building the
  deferred infra — because it activates a surface that was designed precisely for it.**
- **Recommendation on the fork: start with Option A (latest-`run_manifest`-as-pointer, zero new table) IF
  the only need is "read the current model," and promote to Option B (the `projector_state` /
  `posterior_cache` read-model) when the re-fit needs a rebuild checkpoint, blue-green cut-over, or
  cache-to-avoid-recompute** — i.e. let the ADR-220 deferral triggers decide, exactly as ADR-220 framed
  them. The async-job-off-the-request-path part is needed regardless; the read-model shape is the demand-
  gated half.

### Kernel-surface impact + inclusion-test sketch

- **Contracts (Ring 0):** none required (the job is runtime; the read is over existing `run_manifest` /
  `SurvivalSummary`).
- **Schema (kernel):** Option A → zero new table; Option B → activates `kernel.projector_state` (ADR-121,
  designed) and/or `kernel.posterior_cache` (ADR-220, deferred-with-trigger).
- **Runtime (Ring 1):** the async re-fit job (a `Projector` per ADR-122) + the request-path "read latest
  fitted model" path + the cut-over.
- **Inclusion-test sketch:** leg (a) **yes** (concern #4, reproducibility — the re-fit produces pinned
  model versions; ADR-176 async-compute rule). Leg (b) **yes structurally** (every survival pack hits it;
  pack-side loses replay). **Net: passes the test — but the read-model table (Option B) is gated on the
  ADR-220 deferral triggers; the async-job half passes now once the EM cost is measured.** This is the only
  track that PASSES leg (b) today (the others fail it). What's gated is the *cost* (is the EM actually too
  slow?) and the *read-model shape* (Option A vs B), not the demand.

### ADR(s) needed + scope + dependencies

- **ADR(s) needed:** one — "async population re-fit + the current-fitted-model read-model" — which **also
  fires the ADR-220 `projector_state` deferral** (it may amend/cite ADR-220's deferral list to record the
  trigger firing). Cites ADR-223 §Decision 3 + §3 + §Open-items, ADR-220 §"What is explicitly DEFERRED",
  ADR-121 + ADR-122 (the projector surface it activates). **Status now: write after the microbenchmark
  confirms the cost** (the trigger is measurable — measure first).
- **Scope: M** (Option A, async job + run_manifest pointer) → **L** (Option B, full projector_state /
  blue-green cut-over). Independent of #1, #2, #3 — pure infra; but it *de-risks* #1 and #2 (heavier fits
  benefit most from being async).

---

## 5. Synthesis: tracks, sequence, decisions

### 5.1 Clustering into tracks — validating the prior

The brief's prior was: **#1 + the π-side of #3 are the same mechanism (the π logit-channel); #2 is a
separate large track; #4 is independent infra; #3 is broader than π.** Walking it against the design above:

**VALIDATED, with one refinement on #3.** The clustering lands as **three tracks**:

| Track | Contents | Why it clusters |
|---|---|---|
| **Track A — the π / prognostic-conditioning track** | **#1 (treatment-on-π)** + **the π-side of #3** + the **susceptible-baseline side of #3** (the prognostic attachment) | The **covariate mixture-cure model is one mechanism**: a logit-channel on π (carrying treatment log-ORs *and* prognostic log-ORs) **plus** the already-expressible log-HR-on-susceptible-baseline prognostic conditioning (ADR-230 D2). The unifying object is **subject-specific Y(0)**: prognostic factors condition both the susceptible AFT and π per subject; a treatment shifts both under the contrast. #1 and the π-side of #3 are literally the same channel viewed through ADR-230's two claim types. The **storage-attachment** half of #3 is the carrier for the prognostic claims this track conditions on — so it belongs in Track A, not as a separate track. |
| **Track B — competing-risks / multi-state** | **#2** | Separate and large: it changes the **observation shape** (`eventType`) and the **output shape** (CIF / `kind: 'competing-risks'`) — the only deferral that is not an append onto the existing single-event surface. Multi-state is a further sub-deferral *inside* this track. |
| **Track C — async re-fit infra** | **#4** | Independent operational infra; activates the deferred `projector_state` (ADR-121/122) surface. Cross-cuts (heavier fits in A and B benefit) but depends on neither. |

**The refinement the prior asked for:** #3 is **broader than π and spans Track A fully** — its π-side is the
prognostic half of Track A's logit-channel, AND its susceptible-baseline side is the prognostic half of the
*existing* log-HR channel (already expressible per ADR-230 D2, needing only an attachment). So #3 is **not
half-in/half-out** — it is the *prognostic-conditioning carrier* for the whole of Track A. Track A is
precisely "make Y(0) subject-specific on both the susceptible baseline AND the plateau, and let treatment
shift both." That is the cleanest framing and it absorbs #1 and #3 entirely.

### 5.2 Recommended sequence

The sequence is **value × demand × dependency × effort**, applying ADR-176 with teeth (deferred where demand
is absent):

1. **Track C (async re-fit), the job-half — the microbenchmark RAN 2026-06-14; the cost trigger did NOT
   fire.** It is the only track that **passes leg (b) today** and its trigger is **measurable** (not
   domain-demand-gated) — so it was measured first (the right move). Result (§4 callout): at realistic v1
   cohort sizes (hundreds–~2,000 patients) both mixture-cure fits run **< 6 ms**, well under the 50 ms
   request-path budget; the synchronous EM is **not** a request-path problem at v1 scale. **So Track C is
   now DEFERRED with a quantified trigger** (log-logistic @ n≥5k / Weibull @ n>10k, or the first PCCP
   in-envelope re-fit) — re-measure with the recipe in §4 when a cohort approaches that scale, then build
   the async job + the `run_manifest`-pointer read (Option A). **Net: no near-term build — the evidence gate
   set by this roadmap was honoured and came back negative.** All three tracks are now correctly deferred.
2. **Track A (π / prognostic-conditioning) — SECOND, when oncology has a §11-gated π + nameable demand.**
   Highest oncology value and the natural continuation of ADR-230 + ADR-231 (it completes subject-specific
   Y(0)). But **it is demand-deferred today** (#1 fails leg (b); #3's storage-attachment is severable and
   metadata-first). Build it in two waves when the demand fires: (a) the prognostic-attachment + susceptible-
   baseline conditioning (mostly discharged by ADR-230; needs the attachment — Option A, no new table), then
   (b) the π logit-channel (covariate-EM IRLS M-step), which carries both prognostic-on-π and treatment-on-π
   once the channel exists. **Greenlight the *design ADR* when oncology names a calibratable π; build when
   the §11 gate has validated it.**
3. **Track B (competing-risks) — LAST, hard-gated on a named oncology competing-risks cohort.** The largest
   surface (two contract shapes), single weak demander, no second consumer. Build only when a real
   survivorship cohort demonstrably mis-stated by the single-event family surfaces (caught at the §11 gate —
   the right detector). Multi-state is a further deferral even inside this track.

**The rationale in one line:** build the infra that pays off everywhere and whose trigger is measurable
(C); continue the highest-value domain track when its demand is real and validated (A); hard-defer the
largest, least-demanded surface until a named cohort forces it (B). This refines the brief's prior exactly:
the prior had A first; the adversarial ADR-176 read moves **C first** (it's the only thing passing leg (b)
today and it de-risks the rest), keeps **A second** (highest value but demand-deferred), and **B last** (as
the prior had it).

### 5.3 The decisions the founder must make

1. **Greenlight Track C measurement now?** Authorize a microbenchmark of the mixture-cure EM across cohort
   sizes (`implementer` scaffolds; this roadmap describes what's measured: outer-EM × inner-Newton cost vs
   a request-path latency budget). **This is the only "do something now" ask.** Everything else is
   deferred-pending-demand.
2. **Track C read-model fork:** when the async re-fit builds, start with **Option A** (latest
   `run_manifest` as the current-model pointer, zero new table) and promote to **Option B** (activate
   `kernel.projector_state` / `posterior_cache` per ADR-121/122/220) only on the ADR-220 rebuild-checkpoint
   / cache trigger? (Recommended: yes.)
3. **Track A is demand-deferred — confirm it stays so** until oncology names a calibratable, §11-gated π.
   Do **not** write the treatment-on-π ADR or the storage-attachment ADR speculatively (ADR-176 §3).
4. **The Track A effect-channel discriminator fork (decide at A-build-time, recorded now):** derive the
   "targets hazard vs targets π" channel from existing fields (**Option A — semantic-yes / storage-no,
   mirroring ADR-230 §5**) or add a typed `target` discriminant (**Option B — storage promotion**)?
   Recommended: Option A first.
5. **The Track A prognostic-attachment fork (decide at A-build-time):** hang prognostic claims on a
   `root`/`state` plan node reusing `plan_node`/`effects` (**Option A — zero new table, recommended**) or a
   subject-scoped store (**Option B — new table, only if cross-tree subject-profile reuse is demanded**)?
6. **Track B stays hard-deferred — confirm.** Build competing-risks only on a named oncology competing-risks
   cohort the single-event family mis-states (the §11 gate is the detector); treat multi-state as a further
   deferral even then.
7. **Confirm NumPyro stays excluded** (the standing in-process-first deferral; [§7](#7-numpyro-explicitly-out-of-scope)).

### 5.4 ADR-176 verdict summary (the headline)

| Track / item | Concern | ≥2-pack demand TODAY? | Verdict |
|---|---|---|---|
| **C — async re-fit (job half)** | #4 reproducibility + async-compute rule | **Yes** (every survival pack; structural) | **MEASURED 2026-06-14 → cost trigger NOT fired at v1 scale (both fits < 6 ms @ n≤2k). DEFERRED with a quantified trigger: log-logistic @ n≥5k / Weibull @ n>10k, or the first PCCP re-fit.** |
| C — read-model table (Option B) | #4 | Gated on ADR-220 rebuild/cache trigger | Defer to its named trigger |
| **A — prognostic attachment (semantic side)** | #3 inference | **Yes** (ADR-230 §5 — already PROMOTED) | **Done in ADR-230** |
| A — prognostic attachment (storage side) | #3 → #4 if replayed | No (attachment-agnostic query → metadata-first) | Defer to the reproducibility trigger; Option A when it fires |
| **A — treatment-on-π (logit-channel)** | #1 inference | **No** (one gated demander, one absent) | **STAYS DEFERRED — do not build** |
| **B — competing-risks / multi-state** | #2 inference | **No** (one weak demander, no second) | **STAYS DEFERRED — hard-gate on a named cohort** |
| **D — NumPyro Bayesian sidecar** (the full-posterior engine) | #3 inference (engine, not family) + #4 reproducibility (the `replayMode` widen) | **No** (deterministic MLE serves every shipped consumer; the π-under-weak-censoring demander is structural-not-live; Laplace untried) | **DESIGNED 2026-06-14 ([doc](../../../layers/specs/concepts/design/2026-06-14-numpyro-bayesian-sidecar-design-deferred.md)), deferred until the trigger — do not build. Hybrid replay contract (Option c) recommended; rides Track C; needs 2 ADRs; sequenced after A/B/C + a rung-2 in-process Laplace step.** |

The honest top line: **only Track C passes leg (b) today** (and its build is gated on a measurable cost, not
a guess). Tracks A and B are real, designed-not-foreclosed, and **correctly deferred** — manufacturing
demand for either would violate ADR-176 §3. The semantic spadework for Track A is already banked in ADR-230.

---

## 6. Cross-reference integrity

Every load-bearing claim above is anchored:

- The four deferrals + their triggers: ADR-231 §"Open items / named deferrals"; ADR-230 §7.1/§7.2/§7.3;
  ADR-223 §Decision 3, §3 (async-compute), §"Open items".
- The HR-on-susceptible-hazard composition + π-as-prognostic-baseline: ADR-231 D3.
- The claim-type split + Y(0) query partition (attachment-agnostic): ADR-230 D1/D2; the two-verdict
  promotion pattern: ADR-230 §5.
- The reused effect algebra (log-space `sum` fold, no new operator): ADR-154 Commitment 5; the shipped
  `EffectDeclaration` shape (the `basis`/`conditions`/attachment fields the channel reads):
  `layers/substrate/libs/substrate-contracts/src/plan-tree/effect-declaration.ts`.
- The EM (outer × inner cost; the M-step π = (Σw)/n the covariate-IRLS replaces):
  `layers/substrate/libs/substrate-runtime/src/inference/math/mixture-cure-weibull.ts`.
- The reproducibility spine + the deferred read-model tables (`posterior_cache` / `projector_state`) and
  their named triggers: ADR-220 §Decision 1/2/3 + §"What is explicitly DEFERRED".
- The projector surface the async re-fit activates: ADR-121 (`projection_state` 6-state machine + blue-green
  version flip) + ADR-122 (`Projector` interface + idempotent apply).
- The inclusion test + demand-driven-never-speculative + store-generators-derive-graphs: ADR-176 §1/§3/§4.
- The four concerns + registry-extensible families: ADR-127 §4 + invariant 4.
- The subject ontology a subject-scoped prognostic store (Track A Option B) would key on: ADR-213.

## 7. Track D — NumPyro Bayesian sidecar: DESIGNED, deferred until the trigger

The full-Bayesian mixture-cure / survival posterior on the **NumPyro sidecar** is now **DESIGNED** (it was
"out of scope" in this roadmap's first draft; the founder asked for it designed, and the design landed
2026-06-14):
[`concepts/design/2026-06-14-numpyro-bayesian-sidecar-design-deferred.md`](../../../layers/specs/concepts/design/2026-06-14-numpyro-bayesian-sidecar-design-deferred.md).
**Designed ≠ greenlit-to-build** — the design's own ADR-176 verdict is "design it, keep it deferred until the
trigger; do not build speculatively," and this roadmap concurs: it stays **excluded from the BUILD plan**, a
finished blueprint on the shelf. The design recommends the **hybrid replay contract (Option c)** — deterministic
families keep bit-identical replay (the shipped spine, byte-unchanged), sampler families get an additive typed
`RunManifest.replayMode: 'bit-identical' | 'statistical'` discriminant — to resolve the load-bearing collision
with ADR-220's bit-identical-replay contract that a stochastic sampler cannot honor cross-hardware. It depends
**hard on Track C** (MCMC cannot be synchronous, so the Bayesian fit rides Track C's async-job infra as a
*consumer*), and it is sequenced **after** all three tracks (and after a cheaper rung-2 in-process
Laplace/profile-likelihood uncertainty step that the trigger's second conjunct requires us to try first). Its
trigger is unchanged: *"the day the deterministic MLE's uncertainty on π (or any parameter) is clinically
inadequate AND a Laplace/closed-form approx is insufficient"* (ADR-223/231 §Open-items) — and that trigger has
**not fired** (the §11 gate hasn't run on real PHI; the MLE-collapse hasn't been shown insufficient; Laplace is
untried). Two ADRs are needed when it fires: the sidecar architecture + the relaxed/hybrid replay contract.
The standing in-process-first deferral (ADR-223 Alt-3 / ADR-231 Alt-3) still governs the BUILD; the
in-process families remain the v1 truth. None of Tracks A/B/C needs it: Track A's covariate-EM is a
deterministic IRLS M-step, Track B's cause-specific MLE is deterministic, Track C is pure infra (the async-ness
is about *where* the deterministic fit runs, not *how*).
