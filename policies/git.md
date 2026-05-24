---
title: Git + PR discipline
last_updated: 2026-05-24
---

# Git + PR discipline

## PR-everywhere

**All repos go through PRs**, including `specs/` (ADRs, concept docs). No direct-to-main pushes. This reverses the previous "Specs/main workflow vs services PR workflow" split documented in the legacy `exercir-workbench/.claude/agent-workflow.md` §6.4.

## Verifier wave

Every non-trivial PR (new endpoint, schema migration, multi-component UI feature, cross-pack contract change) gets the four-agent verifier wave **in parallel** before merging:

- `local-ci` — build + test + lint + PHI scan
- `reviewer` — adversarial code review
- `charter-checker` — charter compliance
- `qa-engineer` — cross-cutting (coverage, a11y, perf, observability, contract drift, doc completeness)

All four dispatched in one message with multiple tool calls. All four use `isolation: "worktree"`. Disagreement escalates to the founder. See `workflows/verifier-wave.md` for details.

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

## Branches

- Feature branches off `main`. Squash-merge to `main` via PR.
- Per-story branches named `feat/<short-slug>` or `fix/<short-slug>`.
