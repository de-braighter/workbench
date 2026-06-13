---
title: Verifier wave
last_updated: 2026-06-12
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

## The review floor — nothing merges unreviewed

**Every PR gets at least one adversarial review pass before merge — no exemptions** (founder decision 2026-06-13; the SDLC twin showed ~93% of PRs were merging with *zero* agent review — the exact place a `ci:local`-green-but-wrong change hides, e.g. a flipped boolean or a wrong default that lint can't see).

- **Full wave** (the four agents below) — every PR that touches code, schema, or contract surface (see *When it applies*).
- **Review floor** — a single `/code-review` pass (one agent, low effort, high-confidence findings only) — for everything the full wave used to skip: pure-doc PRs, single-line fixes, pure renames, comment-only changes. They no longer skip review; they skip the *full wave* but still get one set of eyes.

The floor rides on top of `ci:local` (which every PR already passes) and is cheap — one agent — so nothing merges blind without the wave's overhead on trivia.

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

## Consult the twin (advisory)

Before composing a wave on a repo with PR-findings history, ask the twin what the finding
record says about each verifier there:

```bash
cd domains/devloop && npm run dev -- wave <owner/repo>
```

The readout reports per-verifier finding precision with sample sizes and flags low-precision
verifiers ("re-prompt or replace"). It is **advisory** — the composing session decides; thin
data falls back to the standard wave above. (F6; spec
`docs/superpowers/specs/2026-06-12-foundry-f6-twin-integration-design.md`.)

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
