---
title: Git + PR discipline
last_updated: 2026-05-24
---

# Git + PR discipline

## PR-everywhere

**All repos go through PRs**, including `specs/` (ADRs, concept docs). No direct-to-main pushes. This reverses the previous "Specs/main workflow vs services PR workflow" split documented in the legacy `exercir-workbench/.claude/agent-workflow.md` §6.4.

## Verifier wave

Every non-trivial PR (new endpoint, schema migration, multi-component UI feature, cross-pack contract change) gets the verifier wave **in parallel** before merging (four agents always; `exercir-charter-checker` joins on `domains/exercir/` PRs):

- `local-ci` — build + test + lint + PHI scan
- `reviewer` — adversarial code review + architecture-drift detection
- `charter-checker` — substrate constitution (ring boundaries, the four kernel concerns, the ADR-176 inclusion test, "store generators, derive graphs")
- `qa-engineer` — cross-cutting (coverage, a11y, perf, observability, ring-ownership + scalability, contract drift, doc completeness)
- `exercir-charter-checker` — Exercir product prototype-charter (demo-mode, sandbox deps, no-real-PHI); exercir-domain PRs only

All applicable agents dispatched in one message with multiple tool calls, all using `isolation: "worktree"`. Disagreement escalates to the founder. See `workflows/verifier-wave.md` for details.

## Sonar quality gate (code repos)

Code repos with a Sonar gate run it **before merging** a non-trivial code PR — not just the fast `ci:local`. The gate pushes a **fresh analysis** to the local SonarQube (`localhost:9000`) and enforces the quality gate:

- **exercir:** `npm run ci:sonar` — `ci:local` + fresh coverage + scan + the fatal `sonar:gate` check.
- **devloop:** Sonar is already wired into `ci:local` (non-fatal push); its scan refreshes on every gate run.
- Other code repos (design-system, substrate): run `npm run sonar:scan` (after coverage) where wired.

Why per-merge, not occasional: SonarQube was billing-frozen CI's blind spot — analyses were manual and stale, so the quality gate never evaluated recent PRs and `pack-devloop`'s calibration loop had no fresh, attributable coverage to observe. A per-merge analysis keeps the gate live and gives the calibration loop tight bracketing windows. (True per-PR New Code measures still need CI + PR decoration — deferred while GHA is frozen.)

A Sonar token must be available (`SONAR_TOKEN`, a repo `tools/sonar/.token`, or `SONAR_ADMIN_PW` from the gitignored `.env`); without one the scan skips non-fatally.

## Hard rules

- **Never `--no-verify`.** Pre-push hooks (PHI scanner, secret scanner) are the only gates between work and the remote when GHA is frozen. Fix the underlying issue if a hook fails; do not bypass.
- **Never force-push to `main`/`master`.** Force-push to feature branches is OK only when explicitly authorized.
- **Never amend a commit after a hook failed.** The hook failure means the commit didn't happen; `--amend` modifies the PREVIOUS commit and can destroy work. Re-stage and create a NEW commit.
- **Don't bundle unrelated changes** in one commit or PR.

## Commit messages

- Imperative mood ("add X", "fix Y", not "added X", "fixed Y").
- First line ≤ 72 characters.
- Body explains *why*, not *what* (the diff shows what).
- Co-authored-by trailers for AI-assisted commits per the team convention.

## PR body — Effect declarations (optional, non-gating)

When a PR carries a *forward prediction* about a measurable delivery indicator, declare it in the body so `pack-devloop` can calibrate the predictor over time. This is an [ADR-193](../layers/specs/adr/adr-193-pack-devloop-effect-declarations-are-calibratable-claims.md) **calibratable claim — never a merge gate**: declarations are optional, observed-vs-declared is logged not enforced, a missing or wrong declaration never blocks a PR, and it scores the *predictor's* calibration (the producer), not compliance.

One line per declared effect:

```text
Effect: <indicatorId> <predicted>±<sd> [basis]
```

- `<indicatorId>` — what you're predicting (declare across dimensions, not just coverage). Auto-observed today: `cycle-time` (hours) and `findings` (clean-wave count) are **self-observing** from the log; the A–E quality ratings `maintainability`, `security`, `reliability` (and `security-hotspots`), plus `coverage`, `smells`, `bugs`, `vulnerabilities`, `tech-debt`, `duplication`, `complexity` come from **SonarQube** (delta across the merge, when a token is configured; for ratings −1 = improved one letter grade). Other indicators are captured but won't score until an observer is wired into `pack-devloop`.
- `<predicted>±<sd>` — point estimate and 1σ uncertainty (separator `±`, `+/-`, or `+-`). The score is a proper rule: an over-tight wrong interval is penalised, but so is a vague wide one — sharpness *and* accuracy both count, so state an honest `sd`.
- `[basis]` — optional provenance: `literature | expert | tenant | derived | sham` (defaults to `derived`).

Example (a PR expected to merge quickly):

```text
Effect: cycle-time 6±2 expert
```

**Orchestrator:** include an `Effect:` line whenever you can make a defensible prediction about an observed indicator (e.g. `cycle-time`, `findings`, `coverage`); omit it rather than guess wildly. An empty or reflexive declaration teaches readers to ignore the field.

### Producer attribution

Per-producer calibration ("which agents' claims are trustworthy", §5.3) needs to know *who* authored a PR — and `gh` can't tell it (the PR author is a human account; we carry no AI commit trailer). So the producing session declares it in the body, one line:

```text
Producer: <producer>/<model> [skill1, skill2]
```

e.g. `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans]`. `backfill` parses it into a producer event; without it, every calibration pair on that PR reads `producer='unknown'` and the §5.3 posterior is inert. **Include it on every agent-authored PR.**

### Feeding the twin — the per-PR ritual

The signals only accrue if the loop is fed. From `domains/devloop`:

- **After a verifier wave:** `npm run dev -- drain <repo#pr>` — PR-scopes the captured verdicts so `findings` / `qa.score` score (un-scoped drains feed verifier-trust only).
- **After merge:** `npm run dev -- backfill` then `… reconcile` — parses the `Producer:`/`Effect:` lines and observes the self-observing + Sonar indicators.
- **Per the retro cadence (notable PRs only):** `npm run dev -- retro '{"repo":"…","pr":N,"kind":"friction|win|improvement","note":"…","by":"<retro-er ≠ author>"}'` — accumulates lessons + the open-improvement backlog (`… retros`).

## Branches

- Feature branches off `main`. Squash-merge to `main` via PR.
- Per-story branches named `feat/<short-slug>` or `fix/<short-slug>`.
