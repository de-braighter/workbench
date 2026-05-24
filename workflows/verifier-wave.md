---
title: Verifier wave
last_updated: 2026-05-24
---

# Verifier wave

The merge gate for every non-trivial PR.

## When it applies

Every PR that touches code, schema, or contract surface. Includes:

- New endpoints
- Schema migrations
- Multi-component UI features
- Cross-pack contract changes
- Cross-layer dependency changes

## When to skip

- Pure doc PRs (no code path touched)
- Single-line bug fixes with obvious test coverage
- Pure rename refactors

## The four agents

| Agent | Verifies | Read-only? |
|---|---|---|
| `local-ci` | Build + test + lint + PHI scan on PR head in an isolated worktree | Yes (uses temp worktree) |
| `reviewer` | Adversarial code review of the diff. Severity-tagged: must-fix / should-fix / nit | Yes |
| `charter-checker` | Compliance with the project charter (constraints document) | Yes |
| `qa-engineer` | Cross-cutting: test coverage, accessibility, performance budgets, observability, contract drift, doc completeness | Yes |

## How to dispatch

All four fire **in parallel** — single message with four `Agent` tool calls. Every spawn carries `isolation: "worktree"`.

## Verdict matrix

| State | Action |
|---|---|
| All 4 PASS | Squash-merge |
| Any 1 BLOCK | Fix in PR (if ~3-5 tool calls), then re-wave. Otherwise file follow-up tracker |
| Disagreement between agents | Escalate to founder via `AskUserQuestion` |

## SHOULD-FIX findings

In-PR fix preferred. ~3-5 tool calls beats ~15-20 for a follow-up ticket (~5× cost multiplier).

Defer to a follow-up only when the fix needs infrastructure outside PR scope, is a design decision the founder must weigh, or would explode the diff.
