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

## The agents

Four fire on every wave; `exercir-charter-checker` is added only when the PR touches the exercir product domain (`domains/exercir/`).

| Agent | Model | Verifies | When | Read-only? |
|---|---|---|---|---|
| `local-ci` | `haiku` | Build + test + lint + PHI scan on PR head in an isolated worktree | Always | Yes (uses temp worktree) |
| `reviewer` | `opus` | Adversarial code review of the diff, incl. architecture drift (kernel creep, hidden coupling, boundary erosion). Severity-tagged: must-fix / should-fix / nit | Always | Yes |
| `charter-checker` | `opus` | The **substrate constitution** — ring boundaries, the four kernel concerns, the ADR-176 inclusion test, "store generators, derive graphs". Domain-agnostic | Always | Yes |
| `qa-engineer` | `sonnet` | Cross-cutting: test coverage, accessibility, performance budgets, observability, contract drift, doc completeness, ring-ownership + scalability integrity | Always | Yes |
| `exercir-charter-checker` | `sonnet` | The **Exercir product charter** — `prototype-assumptions-charter.md` (demo-mode, sandbox deps, no-real-PHI) | exercir-domain PRs | Yes |

**Model tiering** (set per agent in `.claude/agents/<name>.md` `model:` frontmatter, tiered by judgment required — not convenience): the two bug-finding roles that need the strongest reasoning, `reviewer` and `charter-checker`, run on `opus`; the broad-but-structured `qa-engineer` and the checklist-driven `exercir-charter-checker` run on `sonnet`; the mechanical `local-ci` (execute gates → parse → report) runs on `haiku`. To override for one wave, pass `model:` on the `Agent` spawn — the frontmatter is only the default.

## How to dispatch

All applicable agents fire **in parallel** — single message with one `Agent` tool call each (four always; a fifth, `exercir-charter-checker`, when the PR touches `domains/exercir/`). Every spawn carries `isolation: "worktree"`.

## Verdict matrix

| State | Action |
|---|---|
| All applicable PASS | Squash-merge |
| Any BLOCK | Fix in PR (if ~3-5 tool calls), then re-wave. Otherwise file follow-up tracker |
| Disagreement between agents | Escalate to founder via `AskUserQuestion` |

## SHOULD-FIX findings

In-PR fix preferred. ~3-5 tool calls beats ~15-20 for a follow-up ticket (~5× cost multiplier).

Defer to a follow-up only when the fix needs infrastructure outside PR scope, is a design decision the founder must weigh, or would explode the diff.
