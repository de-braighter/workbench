---
title: "devloop cross-repo intelligence — diff-in-diff cohort control (design)"
status: design — APPROVED (brainstormed 2026-06-09); ready for writing-plans
kind: technical design (analytical-method extension)
created: 2026-06-09
author: stibe (brainstormed with orchestrator/claude-opus-4-8)
home: domains/devloop (extend src/intel/; builds on the merged adoption study #60/#61)
relates-to:
  - docs/superpowers/specs/2026-06-08-devloop-cross-repo-delivery-intelligence-design.md
  - docs/superpowers/plans/2026-06-08-devloop-cross-repo-delivery-intelligence-plan.md
decisions: >
  Settled via brainstorming 2026-06-09 (one core fork): CONTROL STRATEGY = aggregate
  cohort control (reuse the non-adopters from the same scan), NOT 1:1 matched controls
  and NOT regression/synthetic control. Pseudo-event assignment for controls is
  deterministic (non-adopter i ← the i-th adopter's real adoption date, cycling) so the
  control windows are calendar-aligned with treatment and the result is reproducible.
note: >
  Sharpens the first real finding ("adopting a PR template shows no reliable delivery
  benefit; weak slower-tilt") by isolating its one real weakness — the maturation
  confound (teams adopt templates as they formalize/scale, a regime change coincident
  with the event that the within-repo placebo cannot fully remove). A proof-extension,
  subordinate to the oncology north-star.
---

# Diff-in-Diff Cohort Control for the Adoption Study

> The within-repo natural experiment already subtracts each repo's *immediate pre-trend*
> (the placebo). It cannot subtract a **coincident regime change** — teams often adopt a PR
> template exactly as they formalise/scale (more reviewers, more process → slower), so part
> of "slower after adoption" is that scaling, not the template. This adds a **difference-in-
> differences** layer: measure the same net-effect on comparable **non-adopters** over the
> same calendar period, and report the *gap*. If adopters and controls drifted equally, the
> template had no effect; a residual gap is the template's real effect.

## 1. The method

For each outcome (`firstReviewHrs`, `cycleHours`), let:

- **treatment** = the qualifying adopters' per-repo net-effects (the existing study output).
- **control** = the qualifying non-adopters' per-repo net-effects, computed by the *same*
  `studyRepo` (same count-based before/after/placebo windows, same gate) around a
  **pseudo-event date** assigned to each non-adopter.

```
diffInDiff(outcome) = median(treatment netEffects) − median(control netEffects)
```

- `control median` is the **baseline drift** — what a comparable repo's delivery did over the
  same period *without* adopting.
- `diffInDiff` is the **template effect net of cohort drift** (sign: net-effect negative =
  faster = improved):
  - `≈ 0` → the template had no effect (the apparent slowdown was cohort drift).
  - `< 0` → adopters improved *more* than controls → the template helps.
  - `> 0` → adopters slowed *more* than controls → the template hurts.

## 2. Pseudo-event assignment (controls)

Non-adopters have no real adoption event, so they need a pseudo-event date to define their
before/after windows. **Deterministic, calendar-aligned:** sort the adopters' real adoption
dates; assign non-adopter *i* (in scan order) the date at index `i mod N_adopters`. This makes
the control population's pseudo-event dates span the *same calendar distribution* as the
treatment events (so both windows see the same ecosystem trends) and is fully reproducible
(no RNG — important since `Math.random` is also barred in some run contexts).

## 3. What changes (small; reuses the merged study)

1. **Ingest non-adopters.** The `intel-study` CLI currently `continue`s past a repo with no
   detected adoption. Instead, collect non-adopters; assign each its pseudo-event date (§2);
   ingest its windowed PRs via the existing `ingestWindowed(repo, pseudoEventMs)`.
2. **Run `studyRepo` on controls** — unchanged windows/gate/placebo; thin controls are
   excluded and reported (control-n ≤ #non-adopters).
3. **New pure `diffInDiff(treatment: RepoStudy[], control: RepoStudy[]): DiffInDiff[]`** in
   `adoption-study.ts` — per outcome: `{ outcome, treatmentMedian, controlMedian, diffInDiff,
   tP10, tP90, cP10, cP90, nTreat, nControl }` (medians + percentiles of each distribution).
4. **Extend `render-study.ts`** — per outcome, render treatment net-effect, the control's
   baseline drift, and the **diff-in-diff** (the template effect net of drift), plus the
   updated honest interpretation.

## 4. Components & isolation

| File | Change | Purity / test |
|---|---|---|
| `src/intel/adoption-study.ts` | **add** `diffInDiff(treatment, control)` + `DiffInDiff` type | pure + TDD'd |
| `src/intel/render-study.ts` | **extend** to render the diff-in-diff section | pure + TDD'd |
| `src/cli.ts` (`intel-study`) | collect non-adopters → pseudo-event (§2) → `ingestWindowed` → `studyRepo` → `diffInDiff` → render | coverage-excluded glue |
| `src/intel/{ingest-window,pr-outcomes,detect-adoption}.ts`, `studyRepo` | **reused unchanged** | already tested |

The pseudo-event-assignment math (`i mod N`, date sort) is small and lives in the CLI glue;
if it grows, extract a pure `assignPseudoEvents(adopterDates, nonAdopters)` helper and test it.
The credibility-bearing arithmetic (`diffInDiff`) is pure + tested.

## 5. Output

The study markdown gains, per outcome, a line like:

> **cycle time:** adopters net +2.8h slower; comparable non-adopters net +X.Xh over the same
> period (baseline drift); **diff-in-diff = (2.8 − X.X)h** — the template effect net of cohort
> drift (nTreat=35, nControl=N).

…with the interpretation rule from §1 and the existing caveats, **plus** the diff-in-diff
assumption (below).

## 6. Caveats (added to the rendered footer)

- **Parallel-trends assumption.** Diff-in-diff assumes adopters and controls *would* have
  drifted the same absent adoption. Not testable here, but materially more credible than the
  placebo alone. Aggregate (not 1:1-matched) controls rely on the cohort's homogeneity
  (top-N same-language) for comparability.
- **Selection.** Repos that don't adopt templates may differ systematically — but adopters-vs-
  comparable-non-adopters is exactly the contrast we want.
- (Existing caveats retained: observational, count-based windows, OSS cohort.)

## 7. Scope / non-goals (YAGNI)

**In:** aggregate cohort control; deterministic pseudo-event; `diffInDiff` + render; one
practice (PR template); the same 200-TS scan. **Out:** 1:1 matched controls; regression /
synthetic control; multi-practice / multi-language; any change to the windows/gate/placebo.
Cost: +~74 `ingestWindowed` calls (1/repo) — negligible.

## 8. Testing

- `diffInDiff` — TDD with synthetic treatment + control `RepoStudy[]`: assert per-outcome
  `treatmentMedian`, `controlMedian`, and `diffInDiff = treatmentMedian − controlMedian`,
  with the qualified-only filter and the empty-control / empty-treatment degenerate cases.
- `render-study` — extend the existing test to assert the diff-in-diff line + the parallel-
  trends caveat render, and that an absent control degrades gracefully (treatment-only output).
- Control ingestion is glue over the already-tested `ingestWindowed` (coverage-excluded, like
  the rest of `cli.ts`).

## After this

Re-run the 200-TS scan → the sharpened finding (treatment vs control vs diff-in-diff) — a
materially more confident answer to *"does adopting a PR template move delivery?"*. If the
diff-in-diff is still inconclusive at this n, the next lever is a larger/mid-tier scan (more
qualifying repos), not more method.
