# `gridiron` Approach B — decision-value inference (staged, fuller) (design)

- **Date:** 2026-06-09
- **Status:** design (brainstormed; pending implementation plan)
- **Domain:** `de-braighter/domains/gridiron` (built: slices 1–5 shipped; live-verified on the 2023 season)
- **Predecessor spec:** [`2026-06-09-gridiron-nfl-4th-down-what-if-design.md`](./2026-06-09-gridiron-nfl-4th-down-what-if-design.md) (§9 consistency-check framing, §11 Approach B + #3 staged path)
- **Governing ADRs:** ADR-176 (kernel minimality — **zero kernel change**; all conjugates already exist), ADR-027 (pack-on-platform), ADR-203/204 (inference wired to `event_log`; Normal-Normal + Beta-Binomial conjugates), ADR-012 (i18n).
- **Motivation:** slice-4 measured kernel-vs-4th-down-bot agreement at **9/11 (82%)** after the evidence gate, with **2 residual mismatches** — both 4th-and-short where the bot says *go* and the kernel says kick/punt: `short|opp-side|close|q3`, `short|midfield|close|q3`. Root cause: pooling the **realized outcome of the action taken** (a failed go is catastrophic) + selection bias. The realized metric is not the lever; the **decision value** is.

## 1. Summary

Approach B reconstructs the 4th-down bot's decision logic **on the kernel's existing conjugate menu** (`normal` + `beta`), composed in the pack — no nflfastR EP/WP model imported, no kernel change. It ships in three slices:

- **S6 — WPA negative control:** swap the realized indicator EPA → WPA and re-score. *Predicted:* ≈82%, same 2 mismatches → proves a better *metric* buys nothing (the cause is structural).
- **S7 — decision-value with a derived expected-points curve:** rank arms by `value(arm)` computed from a kernel-inferred EP curve + conversion/FG probabilities. *Predicted:* the 4th-and-short mismatches flip toward *go*; agreement clears 82%.
- **S8 — UI mode toggle:** switch the ranking basis live (Pooled EPA · Pooled WPA · Decision-value) so the conservative pooled call visibly becomes the aggressive decision-value call.

The S6→S7 contrast is the thesis in two numbers: **metric doesn't help, model does** — and the one thing the model still can't do (condition on game-state to kill selection bias) is exactly the #3 boundary.

## 2. Decisions locked (2026-06-09 brainstorm)

| Decision | Choice |
|---|---|
| Scope | **Both, staged** — S6 negative control THEN S7 fix (full pedagogical narrative) |
| EP for the decision value | **Fuller: a kernel-derived EP curve** (Normal-Normal over next-score from a broad play sample) — NOT a shortcut conditional-outcome or imported nflfastR `ep` |
| Conversion + FG | **Beta-Binomial** (the kernel's `beta` conjugate) |
| Net punt | **documented constant (~40 yds)** for v1 (inferring it is a trivial later refinement) |
| UI | **Mode toggle in scope** (Pooled EPA / Pooled WPA / Decision-value) |
| Kernel | **Zero change** — pack composition over existing conjugates |

## 3. The decision-value model (S7)

In expected-points (EP) space, for a 4th down at field position `spot` (yards to opponent end zone) with `togo` yards to gain:

```
value(go)   = P(convert)·EP(spot − togo)          − (1 − P(convert))·EP_opp(spot)
value(punt) = − EP_opp(spot + netPunt)            // netPunt ≈ 40 yds (touchback-capped near goal)
value(kick) = P(makeFG | kickDist)·3              − (1 − P(makeFG))·EP_opp(spot)   // miss ≈ opp ball at spot
```

where `EP_opp(s)` = the opponent's expected points with 1st-&-10 at the field position implied by `s`, entered as a negative to the possessing team: `EP_opp(s) = −EP(100 − s)`. (`kickDist ≈ spot + 17`.) The recommended arm = argmax of the three; lift = top − punt; the evidence gate (slice 5) still applies (abstain if the components lack data).

### Components (all kernel-inferred from raw outcomes)

1. **EP(field) — the expected-points curve.**
   - New broad ingestion stream `gridiron:DriveState.v1` over **all** plays (not just 4th downs), payload `{ fieldBin, nextScorePoints }`.
   - `nextScorePoints` = the signed points the *possessing* team next scores in the game (+7 TD / +3 FG / +2 safety / −… if the opponent scores next / 0 if none) — computed in the ETL (the spec's B-ready `rawOutcome`). This is what nflfastR's EP model is itself trained on; here the **kernel infers it directly**.
   - `EP(fieldBin)` = **Normal-Normal** posterior per 10-yard bin (0–100 → 10 bins), subject = field bin.
2. **P(convert | distance) — Beta-Binomial.** Binary `converted` on go plays, pooled by distance bucket (short/medium/long). Conversion-by-distance is robust + low-selection-bias.
3. **P(makeFG | kick-distance) — Beta-Binomial.** Binary `fgMade` on field-goal plays, by kick-distance bucket.
4. **Net punt** — documented constant `NET_PUNT_YDS = 40` for v1 (with touchback capping inside the opponent 40).

### Composition

A pure pack module `decision-value.ts` takes the EP-curve posteriors + P(convert) + P(makeFG) + the situation's field/distance and returns `{ go, punt, kick }` values + the ranked recommendation. The readout service gains a **`mode: 'pooled' | 'decision-value'`**: `pooled` is slices 1–5 (rank by posterior mean of the realized indicator); `decision-value` ranks by the composed values.

## 4. S6 — WPA negative control

- Add `wpa` to the `Play.v1` payload (play-row schema + envelope + the filter script column list).
- Add a `gridiron.wpa` catalog indicator (`numeratorPath: payload.wpa`).
- Parameterize the readout + harness by `indicatorKey` (default `gridiron.epa`); the oracle harness runs **both** epa and wpa and reports each.
- **Documented expectation:** WPA agreement ≈ EPA's (same 2 mismatches). A negative control isolating the cause as structural, not metric-choice.

## 5. S8 — UI mode toggle

The what-if page gains a control: **Pooled EPA · Pooled WPA · Decision-value**. Same situation picker; on mode change the arms + recommendation + "vs. the bot" badge recompute (the client sends `mode` + `indicatorKey`). a11y preserved: a labelled `<fieldset>`/segmented control (44px targets), the existing `aria-live` recommendation re-announces on recompute, the accessible table updates. de/en per ADR-012 where a catalog exists (English v1 otherwise, flagged).

## 6. Data

One re-fetch/re-ingest:
- **4th-down stream (`Play.v1`):** add `wpa`, `converted` (go), `fgMade` (field_goal) to the payload + the filter script.
- **Broad EP stream (`DriveState.v1`):** all plays with a valid `ep`/scoring context → `{ fieldBin, nextScorePoints }`. ~50k plays/season → **batched** outbox writes (chunk `publishAll`).
- **`nextScorePoints` ETL:** computed in `filter-pbp.py` (within each game, look forward to the next scoring event; sign by possessing team). Guarded truncate (row-count) before ingest, per the slice-4-recovery lesson.

## 7. Testing

- **Pure unit:** EP-curve binning; `nextScorePoints` derivation (fixture drives); the `decision-value.ts` composition (given component posteriors + a situation → expected `value(go/punt/kick)` ranking, incl. the short-yardage "go wins" case and a long-yardage "punt wins" case); FG/conversion bucketers.
- **Service:** readout `mode='decision-value'` fans the right inference calls (EP bins + convert + FG) and composes; `mode='pooled'` unchanged.
- **Harness:** `validate-oracle` reports agreement per **(mode, indicator)** — so S6's negative (`pooled`/wpa ≈ pooled/epa) and S7's positive (`decision-value` > 82%) are both captured as numbers, with the 2 target mismatches tracked.
- **UI:** mode toggle changes the basis; a11y (labels, live region, table) holds across modes.

## 8. Scope boundaries (YAGNI) + honest limitation

**In:** S6 WPA control; S7 EP curve (broad ingest + Normal-Normal) + P(convert)/P(makeFG) Beta-Binomial + constant net-punt + decision-value composition + `decision-value` readout mode; S8 UI mode toggle; the per-(mode,indicator) harness.

**Out (documented):**
- **Game-state conditioning / selection-bias de-confounding** — EP and P(convert) are *league-pooled*, not conditioned on score/time, so residual selection bias remains. This is the **#3** boundary (a genuine inference-backbone step: hierarchical / causal). S7 deliberately gets as far as conjugate composition allows and *names* where #3 begins.
- **WP-space decision value** (score/time-aware) — the EP-space version is the standard first cut; WP is a #3-era extension.
- **Inferred net-punt / touchback nuance beyond the cap** — constant for v1.

## 9. Why this is still zero-kernel-change

Every component is an existing conjugate readout: `EP(field)` and the conditional outcomes are **Normal-Normal**; `P(convert)` and `P(makeFG)` are **Beta-Binomial**. The kernel already exposes both via `INFERENCE_BACKBONE.posterior()` (catalog `conjugateHint: 'normal' | 'beta'`). The decision-value *composition* is pack arithmetic over those posteriors — pack territory by the ADR-176 inclusion test (single-pack need; no kernel validation/versioning required). The substrate stays minimal; the football lives in the pack.
