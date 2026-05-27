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
