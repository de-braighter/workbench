---
title: "devloop — discovery aid that feeds the verify engine (next direction)"
status: DIRECTION — not yet brainstormed; sequenced AFTER the GTM gate
kind: product/technical direction note (pre-brainstorm)
created: 2026-06-09
author: stibe (discussed with orchestrator/claude-opus-4-8)
relates-to:
  - docs/superpowers/specs/2026-06-09-devloop-ai-delivery-audit-positioning.md
  - docs/superpowers/specs/2026-06-08-devloop-cross-repo-delivery-intelligence-design.md
note: >
  A scoped capture of a discussed-but-not-started direction so it's ready to brainstorm when
  picked up. NOT an approved design. Subordinate to the oncology north-star AND to the AI
  Delivery Audit's GTM gate — do not build before a prospect validates the funnel.
---

# Discovery Aid That Feeds the Verify Engine

## The idea

Today every analysis is **confirmatory**: a human declares what to observe ("PR-template →
cycle-time") and the engine tests it. The direction: a **discovery aid** that, on dropping a
dataset, **auto-detects candidate (feature → outcome) relationships** — "X seems to relate to
Y" — *without* the human pre-specifying them.

**Intent (pinned):** a discovery aid that **GENERATES hypotheses which feed the rigorous verify
engine** — NOT a standalone "explore mode" that surfaces correlations as the deliverable. The
second is the describe-not-verify trap the AI-audit positioning explicitly climbed out of.
Explore to *generate*; confirm to *conclude*. The discovery aid widens the top of the funnel
(customer drops data, doesn't need to know what to look for); the verify engine (placebo +
diff-in-diff) stays the moat.

## Why it must feed verify, never conclude (the cautionary tale)

Our own session is the proof: the naive correlation said *"PR templates → slower delivery."*
An auto-detector would have surfaced that **as a finding**. It was **wrong** — a cohort-drift
confound that only the controlled diff-in-diff exposed (it flipped to *faster*). Auto-
correlation has two structural traps that bite hard: **multiple comparisons** (N features × M
outcomes → spurious "significant" hits by chance) and **confounding / Simpson's paradox**
(aggregate associations reverse within strata). So auto-detected correlations are **leads, not
verdicts** — always labeled as candidates, always routed into the verify engine.

## Concept shape (the discovery pass)

1. Enumerate the feature space extractable from metadata — categorical (author, change-type,
   reviewer, has-template, AI-flag, day-of-week) and continuous-binned (PR size, time-of-day,
   review-queue depth) — × the outcomes (cycle-time, first-review, change-failure).
2. Score each (feature → outcome) pair by **effect size**.
3. Gate on **minimum events** (the power lesson — don't surface what you can't back).
4. **FDR-correct** the whole sweep (Benjamini-Hochberg) so multiple-comparisons noise is
   filtered.
5. Rank and surface the top 3–5 as **"candidates to verify"** — each with effect size + N,
   never as conclusions, with a one-click "verify this" → the controlled experiment.

## The crux — two candidate kinds → two verify modes

"Feed the verify engine" hides the key design decision: candidates split into two kinds that
route differently.

- **Event-like features** — something that *turned on at a point in time* (template adopted,
  AI rolled out, reviewer joined). Map cleanly onto the **before/after natural experiment we
  already built** (placebo + diff-in-diff). Discovery just needs the changepoint.
- **Stable strata** — *intrinsic* features always present (author, change-type, PR size). No
  "before/after" exists — they need a **matched cross-sectional verify** (X-PRs vs matched
  non-X PRs, controlling confounds). **This is a GAP** — the current verify engine is temporal,
  not matched-cross-sectional.

So scope is the first fork: **event-like only** (reuses the engine, ships fast) vs **also
stable strata** (needs a new matched-verify mode — more build, but covers the juicy "which
author/change-type/size drives breakage").

## Forks a brainstorm must settle

1. **Candidate kinds in scope** — event-like only vs also stable strata (the matched-verify
   build).
2. **The changepoint problem** — for event-like candidates with no supplied date, auto-detect
   the shift (changepoint detection — hard) vs only handle features with a known on-date
   (easier).
3. **Honesty guardrails** — FDR correction, min-N gate, and a UI framing that NEVER lets a
   candidate read as a conclusion.

## Honest bounds & sequencing

- Bounded by the feature space extractable from GitHub metadata — not magic; a funnel-widener.
- **Subordinate to the GTM gate.** A discovery aid that widens a funnel *nobody has validated
  yet* is premature. Brainstorm + build this only **after** a real prospect conversation
  confirms the AI Delivery Audit funnel is real (positioning doc §10.2).
- Reuses the merged cross-repo engine (PRs #58–#63) — `whatIf`/stratification, the placebo +
  diff-in-diff machinery, the change-failure outcome. The discovery pass is largely "run the
  existing stratification across all discoverable levers + FDR-rank."

## When picked up

Start a brainstorm with the three forks above. Likely first slice (if greenlit): **event-like
candidates only**, reusing the temporal verify engine, with FDR + min-N guardrails — the
smallest thing that proves the explore→confirm funnel end-to-end.
