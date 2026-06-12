# What-if form-index decision readout — variance-aware coach decision (Check-2 closure)

**Date:** 2026-06-12
**Repo:** `domains/exercir`
**Status:** approved (autonomous session per north-star thesis-test brief; specs#298)
**Predecessors:** exercir#237 (substrate 2.0.0 adoption), substrate#165 (ADR-224), the what-if lane (#119/#120/#169/#121/#122)

## 1. Goal

Wire ONE real coach-facing decision in `domains/exercir` to the variance-aware posterior
that exercir's declared effect distributions now produce through the substrate 2.0 kernel
(ADR-224). The decision shown to the coach must **flip on variance, not just mean** —
mirroring the kernel's in-tree regression
`layers/substrate/libs/substrate-runtime/src/inference/composed-effect-decision-relevance.spec.ts`
(same mean shift: POINT commits, NORMAL doesn't). This de-synthesizes north-star Check 2's
last caveat ("synthetic decision rule on the in-memory adapter", specs#298).

Folded in (PR #237 follow-ups, both touching the same files):

- **Follow-up 1** — consolidate the 7 duplicated ADR-154 declaration builders into
  exported `passPointEffect` / `formNormalEffect`.
- **Follow-up 4** — exhaustive error switch (`const _: never`) in
  `translate-inference-error.ts`.
- **Follow-up 3 (partial, free)** — form-effect parity between the in-memory and DB drill
  seeds falls out of the builder consolidation.

## 2. The decision

> **Readiness commit:** the coach commits a player to a 4-week drill block iff
> **P(form_index ≥ 70) ≥ 0.70** under that drill's posterior.

- `target = 70` — the form-index readiness bar. Equals the catalog's population prior mean
  (`buildPackFootballInferenceCatalog`: prior N(70, 10), /100 scale per ADR-157 row 1):
  "at or above average form".
- `confidenceBar = 0.70` — the kernel regression's `DECISION_THRESHOLD`, reused verbatim.
- Applied **per arm** from each arm's posterior `(mean, sd)`:
  `pCommit = P(X ≥ target) = 1 − Φ((target − mean)/sd)`.
- **Indicator-conditional:** only `football.indicator.form_index` has a decision rule
  (the closed-form normal×normal cell where declared variance propagates).
  `pass_completion` (beta×point — no variance contribution) gets **no** decision block.

### Why per-arm tail probability, not uplift-difference tail

The pack receives only marginal posterior summaries per arm. A `P(cf − base ≥ t)` readout
needs the joint distribution: both arms condition on the SAME observations, so an
independence assumption double-counts the shared subject-level uncertainty (prior sd 10
per arm ⇒ ~√200 noise floor that drowns any plausible σ_E — no threshold could credibly
flip on variance). The per-arm absolute tail is fully honest from marginals, and is
literally the kernel regression's decision rule — the cleanest possible mirror.

### Why the demo subject is the youth call-up, and why Drill-X's form sd changes 2 → 10

The `NormalNormalFastPathAdapter` shifts the prior **before** conditioning on evidence.
Consequences:

1. For data-rich players (Studer: 6 form readings) the drill effect washes out of both
   mean and variance — the honest Bayesian answer, and useless for a decision demo.
2. Only at **zero** form observations does "same composed mean ⇒ same posterior mean"
   hold exactly (with observations, point-vs-normal priors weight the shift differently
   and the means diverge — the flip criterion would be confounded).
3. `SEEDED_YOUTH_CALLUP_PLAYER_ID` (`00000077-…-fc1a55e10077`) has zero form readings
   in both seeds ⇒ posterior = shifted prior = N(70 + Σδ, 10² + Σσ_E²) exactly.

With the current seed sd 2, the declared uncertainty is 4 % of prior variance —
**cosmetic**, the pre-ADR-224 world in disguise (no decision could ever flip on it).
Re-declaring Drill-X's form effect as `normal(mean 6, sd 10)` is the honest POC claim
("aggressive pressing block — big claimed upside, uncertain transfer"; `basis: 'expert'`,
`confidence: 0.6` already say so) and makes the declared variance decision-material.
Drill-Y stays `normal(1, 2)` (gentle, well-understood rondo nudge). Seed magnitudes are
charter-pinned synthetic POC values; changing them is sanctioned.

### Worked numbers (zero-obs subject, prior N(70,10), target 70, bar 0.70)

| Arm / configuration            | Posterior     | P(form ≥ 70) | Verdict |
| ------------------------------ | ------------- | ------------ | ------- |
| point(+6) (retired-scalar view)| N(76, 10)     | **0.725747** | commit  |
| normal(+6, sd 10) (live seed)  | N(76, √200)   | **0.664313** | hold    |
| Drill-Y normal(+1, sd 2)       | N(71, √104)   | 0.539057     | hold    |

(6-dp values are exact normal tails; the implementation's Abramowitz-Stegun 7.1.26
approximation carries |error| < 1.5×10⁻⁷, so specs pin at **4 dp** —
0.7257 / 0.6643 / 0.5391. Never tighten a spec pin past 4 dp from this table.)

Same +6 mean shift, ~2.6 pp above / ~3.6 pp below the bar — a robust flip, not
hair-splitting. The live overlay therefore shows a decision the pre-2.0 scalar path
would have gotten **wrong** (it would commit).

## 3. Architecture

### 3.1 Pack lib (`libs/pack-football`)

- **`src/inference/indicator-keys.ts` (new leaf):** `PASS_COMPLETION_INDICATOR_KEY`,
  `FORM_INDEX_INDICATOR_KEY`, the two event-type constants. Moved out of
  `inference-backbone.providers.ts`, which **re-exports them** (no consumer breakage).
  Needed to break the import cycle the builder consolidation would otherwise create
  (providers → drill-subtrees-seed → providers).
- **`src/inference/effect-builders.ts` (new, beside `pass-completion-log-odds.ts`):**
  - `passPointEffect(declarationId, multiplicative)` — full ADR-154 declaration,
    `point` log-odds delta via `passCompletionLogOddsDelta` (OQ-1).
  - `formNormalEffect(declarationId, meanShift, sd)` — full ADR-154 declaration,
    `normal` magnitude. `sd` is **explicit** (no default — sd is now decision-material,
    call sites must own it).
  - Both exported from the lib barrel. Sweep all 7 duplicates: 4 spec-local copies
    (`compute-team-twin`, `compare-drill-what-if`, `compare-drill-grid`,
    `get-player-funnel` specs), providers' `drillEffect`, seed's
    `passCompletionEffect`/`formIndexEffect`.
- **`src/inference/drill-subtrees-seed.ts`:** use the shared builders; Drill-X form
  effect `sd 2 → 10` (Drill-Y stays 2); doc comments updated to the variance-honesty
  rationale.
- **`src/inference/inference-backbone.providers.ts`:** the in-memory `registerTree`
  seed derives its nodes from `DRILL_SUBTREES` (imported from the seed module) —
  single source of truth; the in-memory trees gain the form effects they currently
  lack (the live-demo enabler + follow-up-3 parity).
- **`src/application/normal-tail-probability.ts` (new):**
  `normalTailProbability(target, mean, sd)` = 1 − Φ((target−mean)/sd), Abramowitz-Stegun
  7.1.26 Φ (same approximation the kernel spec uses; error < 1.5×10⁻⁷). Guard:
  `sd ≤ 0` → degenerate step (`mean ≥ target ? 1 : 0`). Unit spec pins the kernel
  oracle values (0.841345 / 0.665061) plus this design's worked numbers.
- **`src/in-ports/compare-drill-what-if.use-case.ts`:** additive optional field on
  `WhatIfComparisonSchema`:

  ```ts
  export const WhatIfArmDecisionSchema = z.object({
    probabilityAtOrAboveTarget: z.number().min(0).max(1),
    commit: z.boolean(),
  });
  export const WhatIfDecisionSchema = z.object({
    target: z.number(),
    confidenceBar: z.number().min(0).max(1),
    baseline: WhatIfArmDecisionSchema,
    counterfactual: WhatIfArmDecisionSchema,
  });
  // on WhatIfComparisonSchema:
  decision: WhatIfDecisionSchema.optional(),
  ```

  Multi-arm (`compareMulti`) does NOT get a decision block (YAGNI — no consumer).
- **`src/application/compare-drill-what-if.service.ts`:** pack-local
  `WHAT_IF_DECISION_RULES: Record<string, {target, confidenceBar}>` (form_index only;
  same posture/rationale style as `INDICATOR_POLARITY`). `reduceComparison` computes
  `decision` when a rule exists for the indicator; absent otherwise.
- **`src/application/translate-inference-error.ts` (follow-up 4):** replace `default`
  with explicit arms for all 12 currently-masked kinds + `const _: never` guard.
  Routing policy:
  - transient infra → `inference-unavailable`: `timeout`, `sidecar-unavailable`,
    `latency-budget-exceeded`
  - structural/caller → `invalid-input`: `tree-not-found`, `identifiability-undefined`,
    `distribution-not-in-catalog`, `curve-not-in-catalog`
  - generic tail → `inference-failed` (detail names the kind): `cancelled`,
    `cohort-too-small`, `positivity-violated`, `handle-expired`, `internal`

### 3.2 API (`apps/pack-football-api`)

No handler change (`indicatorKey` already flows; response is pass-through). The
real-AppModule integration spec gains a form_index what-if case for the youth call-up
asserting the decision block's worked numbers — proof through the production wiring.

### 3.3 UI (`libs/pack-football-ui`)

- **`data/wire-schemas.ts`:** mirror the decision schemas (+ parity-spec update).
- **`player/ui/what-if-decision-strip.component.ts` (new, presentational):** compact
  strip rendering the form-readiness decision: per-arm `P(Form ≥ 70) = 66 %` + a
  text+icon verdict (never colour-only), one sr-only German summary sentence, and the
  rule sentence ("Commit ab 70 % Konfidenz"). The existing `PlayerWhatIfChrome` is NOT
  reused — its `pp` lift formatting is pass-completion-scale-specific.
- **`player/fc-player-funnel-page.component.ts`:** when the what-if overlay is active
  (`?counterfactual=drill-x-vs-y`), fire a SECOND `compareWhatIf(…, form_index)` call in
  parallel (own state signal + AbortController, failure isolated — the pass lane
  survives a form-lane failure, and vice versa); render the strip beneath the chrome.
- **`player/ui/funnel-i18n.ts`** + de/en catalogs: new keys (title, rule sentence,
  per-arm verdicts, sr sentence, unavailable note). German source per ADR-012.

### 3.4 Out of scope

- Multi-arm decision blocks; SSE; any kernel/substrate change; pass_completion decision
  rules; re-conditioning (`condition()` — that is Check 3); persisting anything
  (the decision is derived at read time — ADR-176 "store generators, derive graphs").

## 4. Testing

1. **`normal-tail-probability.spec.ts`** — Φ oracle pins (kernel values + §2 numbers),
   sd≤0 guard, monotonicity.
2. **`what-if-decision-relevance.spec.ts` (the de-synthesizing regression)** — through
   the REAL `CompareDrillWhatIfService` + `InferenceBackboneRouter` + in-memory adapters
   (the production catalog builder): ONE `compare()` call where the baseline tree carries
   `point(+6)` and the counterfactual `normal(+6, sd 10)` on form_index, zero-obs
   subject → identical arm means (liftMean 0), `baseline.commit === true`
   (p ≈ 0.725747), `counterfactual.commit === false` (p ≈ 0.664313). Plus the
   live-seed-shaped case (X normal(6,10) vs Y normal(1,2), youth id → hold/hold with
   pinned probabilities) and a pass_completion case asserting `decision` is absent.
3. **Service spec extensions** — decision block presence/values via the existing
   stub-backbone harness; schema-validation arm.
4. **Controller integration spec** — real AppModule, youth call-up, form_index: decision
   block matches §2 worked numbers end-to-end.
5. **UI** — strip component spec (verdict text, sr sentence, no colour-only encoding);
   funnel page spec (second call fired with form_index key, failure isolation);
   wire-parity spec.
6. **Lint gate** — `nx lint` runs (the `nx build`/`test`-don't-run-eslint gotcha).
7. **Live browser proof** — youth call-up deep link, screenshot of the strip for the
   #298 closure comment.

## 5. Risks / notes

- **Seed-value change is visible** in the DB-path drill seed (`kernel.plan_node.effects`
  JSONB): live DBs need a re-seed to pick up sd 10 (same caveat PR #237 already noted
  for the log-odds re-expression). In-memory demo needs nothing.
- The chrome's `FLAT_DEAD_BAND` (0.005, pass-scale) is effectively zero on the /100 form
  scale — pre-existing quirk, deliberately untouched (direction still correct for ±5).
- `WhatIfArmSchema` is shared with multi-arm — the decision block is therefore top-level
  optional, NOT a per-arm field, so `compareMulti` is untouched.
- Wave reviewers receive ADR-224 + `docs/migration-substrate-2.0.md` as ratified
  contracts (landing lesson from substrate#165).
