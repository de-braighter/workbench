---
title: "devloop cross-repo delivery intelligence — PR-template adoption study (design)"
status: design — APPROVED (brainstormed 2026-06-08); ready for writing-plans
kind: product + technical design
created: 2026-06-08
author: stibe (brainstormed with orchestrator/claude-opus-4-8)
home: domains/devloop (extend; new src/intel/ surface, parallel to the concierge audit)
relates-to:
  - docs/superpowers/specs/2026-06-07-devloop-delivery-audit-concierge-pilot-design.md
  - docs/superpowers/plans/2026-06-08-devloop-delivery-audit-external-org-foundations.md
  - docs/superpowers/plans/2026-06-08-devloop-delivery-audit-report-generator.md
decisions: >
  Settled via brainstorming 2026-06-08 (five forks): (1) PRIMARY JOB = cross-repo
  delivery intelligence (a new product, not just a benchmark for the concierge audit).
  (2) CLAIM SHAPE = within-repo adoption events (natural experiments) — NOT cross-
  sectional correlation, NOT PR-level pooling. (3) FIRST EXPERIMENT = PR-template
  adoption → first-review latency + cycle-time. (4) SCALE = tiny proof-of-method
  (~150 top TypeScript repos, one practice, local run, no new infra). (5) RIGOR =
  placebo-controlled before/after (net out the repo's pre-existing trend). (6) WINDOWS
  = count-based (the K nearest PRs each side), not calendar — comparable power across
  repos of different PR rates.
note: >
  This is a NEW analysis surface, parallel to (not replacing) the concierge Delivery
  Audit. It is SUBORDINATE to the oncology north-star — a focused, cheap, abandonable
  proof of one method. If the signal is real, it becomes devloop's differentiated
  "delivery intelligence" layer (and the deferred benchmark-comparator + cold-outreach
  motions can build on the same corpus).
---

# Cross-Repo Delivery Intelligence — PR-Template Adoption Study

> Run **within-repo natural experiments** across many public repos: detect when a repo
> adopted a practice, measure a delivery outcome in the PRs immediately before vs after,
> **placebo-control for the repo's pre-existing trend**, and pool the per-repo effects into
> one defensible empirical claim with honest uncertainty. First experiment: *does adopting
> a PR template change first-review latency and cycle-time?* across ~150 top TypeScript repos.

## Why this, and why it isn't "another dashboard"

The single-repo concierge audit (built in the two June-08 plans) reads as competent
*description*, not insight — it has no comparator and too small an N for the inference
engine to find anything non-obvious. Cross-repo intelligence answers a different, harder,
*sellable* question: **"which engineering practices actually move delivery, and by how
much?"** — empirically, at scale, with a causal design rather than a correlation.

**The methodological crux (and why we cannot reuse `whatIf`).** devloop's existing
`whatIf` counterfactual has an anti-time-confounding guard that marks *any* before/after-
in-time comparison INCONCLUSIVE. A within-repo adoption study *is* a before/after-in-time
comparison — exactly what `whatIf` refuses to call causal. That is correct: the natural
experiment must **earn** the causal read `whatIf` won't grant, by controlling for the one
confound `whatIf` warns about — **secular trend** ("did delivery improve because of the
template, or was the repo already maturing?"). The placebo control (decision 5) is what
earns it. This study therefore needs its own purpose-built analysis, not `whatIf`.

## 1. Pipeline (four stages)

1. **Source** — fetch ~200 candidate public repos (one language) and snapshot the list to a
   checked-in file for reproducibility:
   `gh search repos --language typescript --sort stars --limit 200 --json fullName`.
   Public data → the snapshot and all downstream results are committable (no governance
   concern, unlike the private-repo validation work).
2. **Detect adoption** — per repo, find the commit that *added* the PR template, checking the
   common paths (`.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`,
   `PULL_REQUEST_TEMPLATE.md`, `docs/pull_request_template.md`). Mechanic:
   `gh api "repos/{repo}/commits?path={p}&per_page=100" --paginate` → the *oldest* commit on
   that path is the add; its `committer.date` is `adoptedAt`. Keep a repo only if the template
   was added **mid-history** (an adoption event exists) — repos that always had it or never
   had it are excluded (recorded).
3. **Measure** — reuse the existing `backfill` ingest path (`gh pr list --repo {repo} --state
   merged --json number,createdAt,mergedAt,reviews`) — *one call per repo*. From it, per PR:
   `openedAt` (createdAt), `cycleHours` (mergedAt−createdAt), and `firstReviewHrs` (earliest
   review `submittedAt` − createdAt; absent if the PR had no review). First-review time needs
   **no per-PR fan-out** (it rides the single PR-list call). Budget: ~3–4 API calls/repo ×
   ~150 ≈ ~600 calls, well under the 5k/hr authenticated limit.
4. **Study** — the core pure analysis (§2), then render (§3).

## 2. The analysis — count-based, placebo-controlled

For each adopting repo, sort its PRs ascending by `openedAt` and split into three windows of
**K** PRs (default **K = 20**), keyed on `adoptedAt`:

- **after** = the first K PRs with `openedAt ≥ adoptedAt`
- **before** = the last K PRs with `openedAt < adoptedAt`
- **placebo-pre** = the K PRs immediately preceding the `before` window

(So a repo needs ≥K PRs after the event and ≥2K before it.)

For each outcome (`firstReviewHrs`, `cycleHours`) independently, using only the PRs in a
window that *have* that outcome (a PR with no review contributes to `cycleHours` but not
`firstReviewHrs`):

```
effect    = median(after)  − median(before)        # raw before→after change
placebo   = median(before) − median(placebo-pre)   # the repo's pre-existing trend
netEffect = effect − placebo                        # change BEYOND the trend  ← the claim
```

**Per-repo validity gates** (a repo failing a gate is *excluded and reported*, never
silently dropped):

- ≥K PRs in `after` and ≥2K before the event (so all three windows are full), and
- for the outcome in question, ≥`MIN_WITH_OUTCOME` (default 5) PRs *with* that outcome in
  each of the three windows (else that outcome is INCONCLUSIVE for that repo).

**Pooling** across qualifying repos, per outcome: the empirical distribution of per-repo
`netEffect`s → `{ n, medianNetEffect, p10, p90, pctImproved }`, where `pctImproved` = the
fraction of repos with `netEffect < 0` (both outcomes are lower-is-better; faster = better).
No parametric model is required — percentiles of the per-repo distribution + a sign-style
`pctImproved` are honest and robust for a proof. (`netEffect` units are hours.)

## 3. Output

A small Markdown / stdout finding, e.g.:

> Across **{n} of {m}** scanned TypeScript repos that adopted a PR template mid-history,
> the median **time-to-first-review** changed by **{medianNetEffect}** *beyond each repo's
> pre-adoption trend* (placebo-controlled); **{pctImproved}** of repos improved (80% of repos
> between {p10} and {p90}). **Cycle-time**: net {…}. Excluded: {x} repos (no mid-history
> adoption), {y} (too few PRs around the event).

With explicit caveats: observational + placebo-controlled, **not an RCT**; count-based
windows assume the K-PR neighbourhoods are comparable; selection effect (repos that adopt
templates may differ systematically); **OSS cohort ≠ enterprise delivery**. Results are
public-data-derived → committable.

## 4. Components & isolation (new `src/intel/`)

| File | Responsibility | Purity / test |
|---|---|---|
| `src/intel/source-repos.ts` | `gh search` → snapshot of `owner/repo` list | thin gh glue; coverage-excluded |
| `src/intel/detect-adoption.ts` | gh commits-by-path **+ a pure `oldestAddDate(commits)` parser** | parser is pure + TDD'd; gh call thin |
| `src/intel/pr-outcomes.ts` | **pure** — per-PR `{pr, openedAt, cycleHours, firstReviewHrs?}` for a repo from the event log (`PrOpened`/`PrMerged`/`VerdictRecorded`) | pure + TDD'd |
| `src/intel/adoption-study.ts` | **pure** — `studyRepo(outcomes, adoptedAt, K)` (windowing + placebo `netEffect` + gates) and `poolStudies(perRepo[])` (pooled summary) | pure + TDD'd — **the heart** |
| `src/intel/render-study.ts` | **pure** — pooled summary → Markdown (honest caveats) | pure + TDD'd |
| `src/cli.ts` | orchestration command(s) wiring the four stages, isolated dataset via the `DEVLOOP_LOG` knob | coverage-excluded glue |

The arithmetic that determines credibility (windowing, placebo net-effect, pooling) lives in
`adoption-study.ts` as pure functions tested with synthetic fixtures — deterministic, no MC,
no network. The gh-calling stages (`source`, `detect`, `measure`) are thin and verified by
hand against real public repos (same coverage boundary as the existing `ingest/` code).

## 5. Scope / non-goals (YAGNI)

**In:** one practice (PR template), one language (TypeScript), ~150 repos, count-based
windows + placebo, pooled percentile summary for two outcomes.

**Out — deferred, explicitly not built now:**
- Matched-cohort difference-in-differences (brainstorm approach C) — the eventual hardening.
- Multiple practices (CI, CODEOWNERS, conventional commits) and multiple languages.
- The **benchmark-comparator** product (brainstorm option 1) and the **cold-outreach** audit
  (option 3) — both can build on this corpus later.
- Scheduled re-scans / a standing benchmark platform; any web UI.
- Reusing or modifying `whatIf` (it cannot serve this; see the crux above).

## 6. Relationship to the pilot & the north-star

This is a **new, parallel** surface in devloop — it does not change the concierge Delivery
Audit (plans of 2026-06-08). It is **subordinate to the oncology north-star**: a single,
cheap, local, abandonable proof of method. Decision rule after the proof: if `pctImproved`
and the net-effect distribution show a real, defensible signal → green-light scaling
(more practices, the matched-cohort control, the benchmark/cold-outreach motions). If not →
abandon at low cost, having learned the method doesn't yield non-obvious claims at this scale.

## 7. Risks & open points

- **Adoption-event detection precision.** A template file may be moved/renamed; we detect the
  *oldest* commit on each candidate path and take the earliest across paths. Edge cases
  (template added then deleted then re-added) are rare; treat the earliest add as the event
  and note the assumption.
- **K choice.** K=20 is a starting point; the proof should report results at K=20 and note
  sensitivity (e.g. also K=15) without over-tuning. Count-based windows can still span very
  different calendar durations across repos — acceptable for a proof; noted as a caveat.
- **Selection bias** is real and unfixable without a control cohort (deferred C) — disclosed
  in the output, not engineered away.
- **Small qualifying-n.** Many top repos may have always had a template (no event) or too few
  PRs around it → the qualifying n could be small. The pipeline reports the funnel
  (scanned → has-event → passed-gates) honestly; a thin n is itself a finding about feasibility.
