---
title: "devloop product positioning — the AI Delivery Audit (concept)"
status: positioning concept — APPROVED (brainstormed 2026-06-09)
kind: product positioning / value proposition
created: 2026-06-09
author: stibe (brainstormed with orchestrator/claude-opus-4-8)
supersedes-framing-of:
  - docs/superpowers/specs/2026-06-07-devloop-delivery-audit-concierge-pilot-design.md
relates-to:
  - docs/superpowers/specs/2026-06-08-devloop-cross-repo-delivery-intelligence-design.md
  - docs/superpowers/specs/2026-06-09-devloop-diff-in-diff-cohort-control-design.md
note: >
  This repositions WHAT devloop sells; it does not discard the built engine. All the
  cross-repo intelligence code (placebo + diff-in-diff, PRs #58–#62, merged) stays valid
  as the method foundation and the marketing engine. Subordinate to the oncology north-star.
---

# devloop Positioning — the AI Delivery Audit

> **One-liner:** *"You've bet big on AI coding assistants. We prove whether they're actually
> paying off — shipping faster **without silently increasing breakage** — with a scored
> prediction we verify, not another dashboard."*

## 1. Why this exists — the course-correction

The pilot's first instinct was "sell delivery intelligence" (cycle-time, review latency,
bottlenecks). Building it to a real, rigorous, confound-corrected finding exposed the flaw:
**process metrics don't sell.** "Adopting a PR template improved time-to-first-review by 18h"
is academically interesting and methodologically sound — and a budget-holder does not care.
The buy-chain *metric → outcome → money/risk* was broken: faster review doesn't obviously ship
more value, prevent incidents, or cut cost.

The problem was never the data or the method (both proven) — it was the **dependent variable**
and the **framing**. Two reframes fix it:

1. **Sell a verdict, not a metric.** devloop's one capability incumbents lack is the
   *calibration loop* — scored, falsifiable predictions that get verified. Swarmia / LinearB /
   DX **describe**; devloop **verifies**. The product is *"did your bet actually work?"*, not
   *"here's a chart."*
2. **Verify the bet everyone is anxious about and nobody can prove: the AI coding-assistant
   rollout** — measured against a **risk/quality** outcome (breakage), not vanity speed.

## 2. Buyer & pain

**Buyer:** VP-Engineering / CTO at a ~30–300-developer org that has adopted or is scaling
Copilot / Cursor / Claude Code (≈ every such org in 2026). The AI tooling spend is
board-visible; the economic buyer owns both the budget and the anxiety.

**Pain:** *"We've reshaped how we build around AI and spent real money on it — and we have no
credible idea whether it's helping, plus a nagging fear it's shipping more bugs/rework we'll
pay for later."* The market measures AI **velocity uplift** ("X% faster"); **nobody measures
the quality cost.** That gap is the wedge.

## 3. The outcome — dual, led by RISK (the differentiator)

- **Risk (the wedge):** is AI adoption increasing **change-failure / rework** — reverts,
  hotfixes, fixes of recently-merged changes? The fear no incumbent quantifies.
- **Velocity (table-stakes):** did throughput / cycle time actually improve? Everyone *claims*
  this; we *verify* it.
- **Headline:** *"Faster is easy to claim. We prove it isn't costing you quality."*

Leading with the risk/fear frame is deliberate: it sells (loss-aversion), and it is the
**unaddressed** half of the AI-productivity conversation.

## 4. Why devloop wins

Incumbents render dashboards. devloop runs a **within-org natural experiment**: delivery +
change-failure **before vs after** the AI rollout, **controlled** (the diff-in-diff cohort
method already built), ending in a **scored, falsifiable prediction** that the subscription
**verifies the next month**. The deliverable is a **verdict with a confidence and a track
record**, not a chart. The calibration loop *is* the moat.

## 5. The wedge → funnel

- **Fixed-price AI Delivery Audit** (concierge, GitHub-metadata-only, no source code). The
  customer **supplies the rollout date(s)** — no AI-adoption detection needed; we measure their
  own repos before/after, controlled, and deliver a verdict + scored predictions.
- **Converts to a monthly subscription** that verifies those predictions and tracks the bet as
  the rollout expands (more teams/repos) — the calibration loop running continuously.
- This is the *same audit → subscription funnel* as the 2026-06-07 pilot design, **re-pointed
  at the AI bet** and at a risk outcome.

## 6. Marketing engine (already built)

The cross-repo OSS study (PRs #58–#62) is repurposed as **inbound thought-leadership** —
*"We analyzed N public repos that adopted AI assistants; here's the velocity/quality
tradeoff."* It earns the meeting; the audit closes it. It is **content + method credibility,
not the product** a customer logs into.

## 7. The make-or-break risk

The audit's entire credibility rests on a **defensible change-failure / rework signal from
GitHub metadata.** Feasibility gradient:

- **Reverts** — clean: a later commit/PR `Revert "…(#X)"`. Reliable.
- **Hotfix / fix-follow** — fuzzier: a later PR cross-referencing an earlier one (`fixes #X`,
  `hotfix for #X`), or a change touching the same files shortly after a merge. Real but
  heuristic/noisy.
- **Linked bug issues** — a bug filed/linked shortly after a merge.

**This is the first thing to validate and the first thing to build.** It is the founder's own
earlier idea ("did a change need a fix later"), now load-bearing. If a credible change-failure
signal can't be extracted from metadata, the risk framing weakens and the audit must lean on a
weaker proxy — so prove this signal *before* committing to the AI-audit GTM.

## 8. What changes vs the 2026-06-07 pilot design

- **Lead bet:** generic "delivery intelligence" → **the AI coding-assistant rollout**.
- **Outcome:** speed metrics → **change-failure / rework (risk), velocity as table-stakes**.
- **Cross-repo intelligence:** was positioned as the differentiator → now the **marketing
  engine**; the product is the concierge audit on the **customer's own** repos.
- **Unchanged:** concierge, GitHub-metadata-only, audit→subscription funnel, calibration loop
  as the differentiator, system/team-level (never individual ranking), subordinate to oncology.

## 9. Non-goals

Not a self-serve dashboard SaaS; not multi-metric delivery analytics; not competing on
velocity dashboards; not AI-adoption *detection* (the customer supplies the rollout date); not
a public-repo product (that's marketing).

## 10. Open questions / next steps

1. **Validate the change-failure signal** (§7) — the gating build/experiment. Likely the first
   `writing-plans` target: a `rework`/`change-failure` outcome (reverts first, fix-follows
   next) added to the study engine, validated on real repos.
2. **Validate the positioning with a real prospect** — does the AI-ROI/quality fear convert to
   a paid audit? (The gating GTM unknown — needs 1–3 design partners, per the original pilot's
   open #1.)
3. **Pricing & buyer-facing name** — still open (the audit is the wedge; numbers TBD by founder).
4. **Sequencing vs oncology** — this remains subordinate; the AI-audit GTM is a parallel,
   abandonable bet, not a focus-stealer.
