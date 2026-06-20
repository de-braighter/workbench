# AI-SDLC Benchmark Suite — captured reference (2026-06-20)

> **Captured by:** founder (dropped into Downloads, surfaced for foundry relevance).
> **Why it's here:** this is an evidence-based AI-assisted-SDLC measurement model that maps almost
> directly onto what foundry's SDLC twin (`domains/devloop`, absorbed into `foundry/twin` per P8/ADR-258)
> is built to do. Captured verbatim below for cluster durability; the foundry-relevance analysis is the
> preamble. Original lived at `~/Downloads/ai-sdlc-benchmarks.md`.

## Why it matters to foundry (the twin + the self-improving-SDLC arc)

The document's core thesis — **pair every speed metric with a quality counterweight; gate on leading
per-PR signals, monitor lagging flow as trends; Goodhart-proof by refusing any single "AI score"** — is
exactly the discipline foundry's twin already gestures at (the `Effect:` calibration loop, the warn-only
`Effort:` confound, the review floor). It grounds that discipline in the uncomfortable empirical evidence
(METR: devs ~19% *slower* while feeling ~20% faster; GitClear: AI roughly doubled <14-day churn and
multiplied clone density).

### What foundry's twin already has
`cycle-time` + `findings` (self-observing from the log via `reconcile`), the `whatif` effort lever,
per-producer/per-model calibration, and SonarQube metrics (coverage / duplication / complexity /
tech-debt / maintainability / reliability / security / smells / bugs).

### What this reference ADDS (highest-value first)
1. **The paired verdict — "net flow efficiency" ⭐** (lead-time *down* AND change-failure-rate + churn
   *flat-or-down*). The single most important gap: foundry currently observes `cycle-time` **without a
   paired quality counterweight**, and the doc's whole argument is that a speed metric alone *lies*. This
   is precisely the verdict the **M2 "SDLC-counterfactual" milestone** ([[self-improving-sdlc-arc]]) is
   chasing.
2. **AI rework cost ⭐** — % of *AI-authored* lines churned <14 days ÷ AI-authored lines. The literal
   dogfooding metric ("does AI-authored code churn more than human code?"). Foundry already carries
   `Producer:` attribution on PRs, so it *can* compute this — it closes the calibration loop that has
   been stuck at `unknown`.
3. **Short-term churn (<14d) + rework ratio** — git-history-derived, so **self-observing exactly like
   cycle-time/findings** — droppable straight into `reconcile`.
4. **Diff coverage** (changed lines) vs whole-repo coverage % — the doc explicitly demotes whole-repo %
   as vanity and gates *changed-line* coverage instead.
5. **The GATE / WARN / TREND taxonomy + the vanity-metric demotion** — validates and sharpens foundry's
   review-floor + `Effect:` design (it confirms `Effort:` self-reports are satisfaction signals, never
   gates — matching the warn-only confound already shipped on the effort lever).

### The one honest caveat
The **prod-deploy / incident DORA half** (deployment frequency, change-failure-rate, MTTR,
defect-escape) does NOT fit foundry's current reality — its internal products don't deploy to prod with
an incident log. Those stay aspirational. The **git/PR-derived half** (churn, rework, diff coverage,
duplication, AI rework cost, net flow efficiency) maps onto the same PR/commit log the twin already reads
— that's the part to harvest first.

### Backlog
Concrete twin extension tracked against the self-improving-SDLC arc (M2): add the paired
**net-flow-efficiency** verdict + **AI rework cost** + **<14d churn / rework ratio** to the twin's
indicator set (all git-derived / self-observing). See the devloop tracking issue.

---

# AI-Assisted SDLC — Performance Benchmark Suite (verbatim source)

**Purpose:** continuously quantify whether your AI-assisted software development lifecycle is *actually* effective — i.e. delivering faster **without** silently degrading code quality, maintainability, or stability. Designed for dashboard monitoring + selective CI gating.

**Scope:** Nx monorepo (Angular / Spring Boot / Kafka / S3-Iceberg), GitHub-centric pipeline (Actions + structured issue templates), small team.

---

## 1. Design principles (why these metrics and not the obvious ones)

The measurement design is driven by the current empirical evidence, which is uncomfortable:

- **Perceived speed ≠ real speed.** In the METR randomized controlled trial (16 experienced OSS devs, 246 real tasks, early-2025 tools), AI assistance *increased* completion time by ~19% while the same developers *believed* it had cut time by ~20%. → **Never gate on self-reported productivity, and treat it as a satisfaction signal only.**
- **Speed gains come bundled with rework and duplication.** GitClear's longitudinal analysis (200M+ changed lines) found short-term code churn roughly doubling alongside AI adoption (~3.3% pre-AI baseline → ~5.7% in 2024 → ~7.1% in 2025), refactoring/"moved" code collapsing below 10% of changes, and copy-paste/clone density rising several-fold. Cloned blocks correlate with materially higher defect rates. → **Every velocity metric must be paired with a quality counterweight, or the benchmark lies.**
- **Goodhart's law is the default failure mode.** Any single number used to represent "productivity" will be gamed. → **Balanced scorecard across four dimensions; no composite "AI score" used for individual evaluation.**

**Three rules that follow:**

1. **Pair every speed metric with a quality counterweight** in the same view. A lead-time drop that coincides with a change-failure-rate or churn rise is *not* an improvement.
2. **Gate on leading quality signals per-PR; monitor lagging flow signals as trends.** DORA-style aggregates are too noisy and too lagging to block a single PR.
3. **Demote vanity metrics explicitly** (lines of code, suggestion acceptance rate, commit count, perceived speed). Track them for context; never gate or rank people on them.

---

## 2. The metric suite

Organized by the **DX Core 4** dimensions (Speed, Quality, Effectiveness/Flow, Impact) — the 2024/25 unification of DORA + SPACE + DevEx — plus a dedicated **AI layer** for adoption and AI-specific cost.

Legend — **Role:** `GATE` = hard per-PR CI gate · `WARN` = soft CI annotation · `TREND` = dashboard/weekly-review only (never blocks).

### 2.1 Speed

| Metric | Definition / formula | Data source | Target band (calibrate to your baseline) | Role |
|---|---|---|---|---|
| **Lead time for changes** (DORA) | median(time from first commit on branch → deployed to prod) | GitHub PR events + deployment events | Elite < 1 day · Good 1–7 d · Watch > 1 wk | TREND |
| **Deployment frequency** (DORA) | count(prod deploys) / period | GitHub Deployments / Actions `deployment_status` | Elite ≥ daily · Good ≥ weekly | TREND |
| **PR cycle time** | median(PR opened → merged), split into *time-to-first-review · review time · rework time* | GitHub PR API | first-review < 4 working h; total < 24 working h | TREND |
| **PR size** | lines changed per PR (added+deleted, excl. generated/lockfiles) | git diff | median ≤ ~200; cap large PRs | WARN/GATE |

> PR size is a *control* on the AI failure mode of huge, hard-to-review generated diffs. Block or require split above a hard cap (e.g. 800 LOC excluding generated files).

### 2.2 Quality (the counterweight — most important under AI)

| Metric | Definition / formula | Data source | Target band | Role |
|---|---|---|---|---|
| **Change failure rate** (DORA) | deploys causing incident/rollback/hotfix ÷ total deploys | deployments + incident log / revert detection | Elite ≤ 5% · Good ≤ 15% · Watch > 15% | TREND |
| **Failed-deployment recovery time** (DORA / MTTR) | median(incident start → service restored) | incident log | Elite < 1 h · Good < 1 day | TREND |
| **Short-term code churn** | lines reverted or rewritten **< 14 days** after authoring ÷ lines authored | git history analysis (e.g. GitClear-style, or custom git-log script) | Hold near your pre-AI baseline (~3–4%); alarm > 7% | TREND + WARN |
| **Code turnover (rework) rate** | merged code later reverted/substantially rewritten — *isolates* bad changes from healthy refactor | git history | trend flat/down | TREND |
| **Duplication / clone density on changed code** | % of new lines that are Type-1/2 clones | SonarQube / `jscpd` in CI | new duplication ≤ 3%; no new clusters | GATE |
| **Diff coverage** | test coverage on *changed* lines (not whole-repo %) | coverage report diffed vs base | ≥ 80% on changed lines | GATE |
| **Static-analysis regressions** | new blocker/critical issues introduced by the PR | SonarQube / ESLint / Spotless / Checkstyle quality gate | zero new blocker/critical | GATE |
| **Defect escape rate** | bugs found in prod ÷ (bugs found pre-merge + prod) | issue tracker labels | trend down | TREND |

### 2.3 Effectiveness / Flow (DevEx)

| Metric | Definition / formula | Data source | Target band | Role |
|---|---|---|---|---|
| **Rework ratio** | commits pushed *after* first review ÷ total commits on PR | GitHub PR API | trend down; spike = AI output needing heavy cleanup | TREND |
| **Review depth** | review comments per 100 changed lines; % PRs with ≥1 substantive review | GitHub review API | guard against rubber-stamping AI PRs | TREND |
| **Time-to-first-review** | PR opened → first review submitted | GitHub | < 4 working h | TREND |
| **Developer friction / flow** (survey) | periodic short pulse (DevEx-style), self-reported | survey tool | direction only | TREND (never gate) |

> The METR result means the friction survey is a *health-of-experience* signal, **not** a productivity proxy. Rising satisfaction with falling delivery quality is a red flag, not a win.

### 2.4 AI layer (adoption, cost, AI-specific risk)

| Metric | Definition / formula | Data source | Target band | Role |
|---|---|---|---|---|
| **AI contribution share** | % of merged lines AI-assisted | commit-level AI detection (hard — see §5) or PR self-tag | context only | TREND |
| **AI rework cost** ⭐ | % of **AI-authored** lines churned < 14 days ÷ AI-authored lines | git history + AI attribution | should ≈ human churn; gap = AI value leak | TREND |
| **Cost per merged PR** | (token/API spend or local-LLM compute) ÷ merged PRs | API billing / proxy logs (LiteLLM) | trend vs value delivered | TREND |
| **Net flow efficiency** ⭐ | did AI reduce lead time **without** raising change-failure-rate or churn? (paired check) | derived | the real verdict | TREND |
| **AI suggestion acceptance rate** | accepted ÷ suggested | tool telemetry | **VANITY — context only** | TREND (never gate) |

### 2.5 Impact (business outcome)

| Metric | Definition / formula | Data source | Role |
|---|---|---|---|
| **% engineering time on new value** | feature work ÷ (feature + maintenance + rework) | issue tracker time/labels | TREND |
| **Throughput per engineer** | merged PRs (or story points) per eng per week | GitHub | TREND — **never** for individual evaluation |

---

## 3. CI gate logic (what actually blocks a merge)

Only **leading, per-PR, deterministic** signals are hard gates. Everything lagging or aggregate is a dashboard trend reviewed weekly. Implemented as required GitHub Actions checks:

**Hard gates (block merge):**
1. **Diff coverage** on changed lines ≥ 80%.
2. **No new blocker/critical** static-analysis issues (SonarQube/ESLint/Checkstyle/Spotless quality gate = pass).
3. **New duplication ≤ 3%** and no new clone clusters (`jscpd` / SonarQube).
4. **PR size hard cap** (e.g. ≤ 800 non-generated LOC) — else require split.
5. Nx affected `lint` + `test` + `build` green; Nx tag/boundary constraints respected.

**Soft gates (annotate, don't block):**
6. **Churn guard:** flag PRs modifying code merged < 14 days ago → reviewer attention (rework signal).
7. **PR size warn** above median threshold (e.g. > 400 LOC).
8. **Coverage delta** negative on the module.

**Trend-only (weekly review, never block):** all DORA metrics, rework ratio, AI rework cost, cost per PR, net flow efficiency, satisfaction, throughput.

---

## 4. Anti-patterns — metrics you must NOT gate or rank on

| Vanity metric | Why it misleads |
|---|---|
| **Lines of code / code added** | AI inflates volume; more code is a *liability*, not output. |
| **AI suggestion acceptance rate** | Measures tool stickiness, not value; accepted code still churns. |
| **Commit count** | Trivially gamed; no relation to delivered value. |
| **Perceived/self-reported speedup** | METR: devs were 19% *slower* while feeling 20% faster. |
| **Whole-repo coverage %** | Gameable and insensitive; gate **diff** coverage instead. |
| **Throughput per engineer (for evaluation)** | Goodhart's law; fine as an aggregate trend, toxic per-person. |

---

## 5. Baseline & calibration protocol

You cannot benchmark without a baseline, and absolute industry numbers won't fit a small greenfield-leaning team.

1. **Measure 4–8 weeks before tuning thresholds.** Capture all TREND metrics with AI already in use, plus — if you can — a short pre-AI window for churn/lead-time.
2. **Set bands from your own percentiles**, not absolute elite/good labels. "Watch" = worse than your trailing-8-week median; "Alarm" = worse than p75.
3. **Re-baseline quarterly** and whenever you switch model tier (local Ollama/DeepSeek/Qwen ↔ Claude API) — that's exactly the kind of change `net flow efficiency` and `cost per PR` are meant to evaluate.
4. **The only verdict that matters:** lead time **down** AND change-failure-rate + churn **flat-or-down**. Speed alone is not a pass.

---

## 6. Implementation notes (data sources & cadence)

- **GitHub API / webhooks** → PR cycle time, size, review depth, rework ratio, deploy frequency, lead time.
- **GitHub Actions** → run the per-PR gates; emit metrics as job summaries / artifacts; push to a store.
- **Git history script** (custom or GitClear-style) → short-term churn, code turnover, AI rework cost. A nightly Action diffing each merged line's lifespan over a 14-day window is sufficient.
- **SonarQube / `jscpd` / ESLint / Checkstyle / Spotless** → duplication, clones, static-analysis gate.
- **Coverage tooling diffed vs base** (e.g. `diff-cover`) → diff coverage gate.
- **Incident log + revert detection** → change failure rate, MTTR, defect escape.
- **LiteLLM proxy / API billing** → AI cost per PR.
- **Storage/dashboard:** any TSDB or even a metrics table in the `ai-conventions` repo; the dashboard reads aggregates. Cadence: gates per-PR; aggregates nightly; review weekly; re-baseline quarterly.

---

## 7. Evidence base

- **METR (2025)** — *Measuring the Impact of Early-2025 AI on Experienced Open-Source Developer Productivity* (RCT): ~19% slowdown vs ~20% perceived speedup. Note METR's own caveat that this is setting-specific and may change as models improve.
- **GitClear (2024 / 2025)** — AI Copilot Code Quality: short-term churn ~3.3% → ~7.1%, refactoring share collapse, copy-paste/clone growth, clone–defect correlation.
- **DX Core 4 (Noda & Tacho, DX, 2024–25)** — unifies DORA + SPACE + DevEx into Speed / Effectiveness / Quality / Impact; plus the DX AI Measurement Framework for AI adoption/impact.
- **DORA** — deployment frequency, lead time, change failure rate, failed-deployment recovery time (+ reliability).

> Caveat in the spirit of evidence-based practice: these figures are population-level findings from specific studies and contexts; treat them as priors that justify *measuring*, not as guaranteed outcomes for your team. Your own baseline is the authority.
