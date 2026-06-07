---
title: "devloop → sellable product — Delivery Audit concierge pilot (design)"
status: design — APPROVED (substance), PAUSED before spec-finalization at founder request
kind: product + technical design
created: 2026-06-07
author: stibe (brainstormed with orchestrator/claude-opus-4-8)
home: domains/devloop (extend; no new repo for the pilot)
relates-to:
  - docs/superpowers/specs/2026-06-07-substrate-saas-portfolio-ingestion-analysis.md
  - docs/superpowers/specs/2026-05-29-devloop-pack-technical-design.md
  - layers/specs/adr/adr-192-sanction-pack-devloop-pack-on-platform-zero-kernel-change.md
  - layers/specs/adr/adr-193-pack-devloop-effect-declarations-are-calibratable-claims.md
decisions: >
  Settled via brainstorming 2026-06-07 (four founder forks): (1) AMBITION =
  concierge paid pilot (smallest sellable thing; protect the oncology north-star;
  no self-serve SaaS yet). (2) LEADING PAIN = delivery intelligence ("where are
  your real delivery bottlenecks, and which intervention will actually move them")
  — chosen over AI-agent-governance because it sells into an EXISTING budget line
  (Swarmia/LinearB/Jellyfish/DX) with a real differentiator. (3) DELIVERABLE =
  audit → subscription funnel (paid Delivery Audit wedge converting to a monthly
  subscription twin). (4) APPROACH = A, operator-run report-first (we run the
  existing engine against the partner's repos and deliver a tuned report; no login,
  no multi-tenancy, metadata-only).
note: >
  This is the FIRST sub-project of the larger "make devloop sellable" endeavour.
  Later sub-projects (self-serve MVP SaaS, billing, open-core) sequence AFTER pilot
  validation. The whole effort is SUBORDINATE to the oncology north-star
  (second-brick-oncology-direction) — chosen because productizing devloop dogfoods
  the cluster's own delivery (it makes oncology ship faster, not slower).
---

# devloop → sellable product — Delivery Audit concierge pilot

> devloop's engine — causal/counterfactual SDLC inference + a self-scoring
> calibration loop + a knowledge graph — already exists as an internal single-user
> CLI. The pilot turns it into the smallest thing a stranger will pay for: a
> fixed-price **Delivery Audit** that converts into a **monthly subscription twin**,
> run concierge-style (we operate it), leading with **delivery intelligence**, on
> **GitHub metadata only** (source code never leaves the customer's control).

## Starting line (what exists today, verified 2026-06-07)

`domains/devloop` is a **single-user, no-multi-tenant, no-PHI CLI** (substrate-
contracts-typed; no NestJS/Postgres/RLS in the base path) that runs against the
cluster's own repos via local `gh`. Already built and reusable:

- **Ingest** (`src/ingest/`): GitHub PR lifecycle (`backfill`), PR reviews, Sonar
  metrics, verifier verdicts (via `SubagentStop` hook → `drain`).
- **Event log**: append-only `data/events.jsonl` (`DomainEventEnvelope`, `devloop:*.v1`).
- **Inference** (`src/inference/`): in-process Monte-Carlo — cycle-time posterior,
  **calibration** (declared-vs-observed `Effect:` scoring, Gaussian log-score),
  **reliability** (verifier/producer trust), qa-baseline, **whatif** (counterfactual), retros.
- **Knowledge graph** (`src/knowledge-graph/`) + MCP server.
- **Dashboard** (`src/ui/dashboard.ts`): a self-contained HTML twin.

The hard part (the engine) is done. The pilot adds the thin shell that makes it
sellable to an external party.

## 1. What we sell — the funnel, and why it isn't "another dashboard"

A fixed-price **Delivery Audit** → converting to a **monthly subscription twin**.
The differentiator is that **devloop's calibration loop *is* the funnel**:

- The audit ends in *forward, falsifiable predictions* ("do X → cycle-time ~Yh ±Z"),
  not just recommendations. Competitors (Swarmia, LinearB, Jellyfish, DX) are
  descriptive/correlational; devloop makes **scored causal claims**.
- The subscription exists to *verify those claims*: each month we observe whether the
  predicted effects materialized and show our own calibration. The product proves its
  own worth over time. Audit = testable hypothesis; subscription = the test.

## 2. The audit deliverable (the product)

A tuned version of the existing HTML twin + a narrative layer:

1. **Scope & data** — N repos, M PRs over ~90 days; *metadata only, no source code*.
2. **Delivery baseline** — cycle time, review latency, throughput, WIP, batch size,
   rework (the descriptive entry eng leaders expect).
3. **Top-3 bottlenecks** — the *causal* read: where the delivery system is actually
   constrained, not merely what is slow.
4. **Counterfactual interventions** — "change X → expected effect on indicator Y
   (±uncertainty)," ranked by expected impact. **The differentiated core.**
5. **Calibration hook** — "here are our predictions; subscribe and we score ourselves
   against reality."

## 3. The subscription (ongoing)

Monthly re-run that **closes the loop**: did the interventions move the indicators as
predicted? Plus refreshed bottlenecks and the next ranked intervention. Operator-run,
re-delivered as a hosted link. No customer login in the pilot.

## 4. What we build (delta on top of today's devloop — deliberately small)

- **External-org ingestion** — extend the GitHub ingest to target an arbitrary
  org/repos via a read-only GitHub App install or a scoped token (today it's wired to
  cluster repos via `src/cluster-repos.ts`).
- **Audit-report generator** — the narrative + counterfactual + ranked-intervention
  layer over the existing inference outputs.
- **External-buyer tuning of the dashboard** — branding, plain-language framing, no
  cluster-internal jargon.
- **Operator runbook** — onboard a partner, run, deliver, re-run monthly.

No auth, no multi-tenancy, no billing infra, no web app.

## 5. Privacy & ethics posture (a feature, not a footnote)

- **Metadata-only, read-only, delete-on-request** — source code never leaves the
  customer's control. This is the single biggest objection-killer for plugging a
  stranger into an engineering org.
- **System/team-level reporting, never individual ranking.** Delivery data touches
  individual contributors; the product principle (and EU works-council reality) is to
  aggregate and report on the *system*, never to performance-manage people. Kills the
  "surveillance tool" rejection and is the right line.
- A one-page data-processing agreement (Swiss nDSG / GDPR). Light, but real
  (swiss-pro territory when drafted).

## 6. Scope / non-goals (YAGNI for the pilot)

Explicitly **out**, deferred to post-validation sub-projects: self-serve signup,
GitHub App marketplace/OAuth flow, self-serve billing, a login UI, Jira (fast-follow),
Sonar/code-quality (keep audit metadata-only), open-core.

## 7. Open decisions (to resolve when we resume — NOT yet answered)

1. **Design-partner access — the GATING dependency.** A concierge pilot dies without
   1–3 willing teams. Does the founder already have candidate orgs (network,
   ex-colleagues, Swiss tech scene), or is *"land the first design partners"* itself
   sub-project zero? Determines build-then-sell vs sell-then-build. **No default — needs
   a founder answer.**
2. **GitHub-only for the audit MVP** (Jira fast-follow) — recommended; assume yes
   unless revisited.
3. **Naming** — "devloop" is an internal name; a buyer-facing name is needed
   eventually. Parked.
4. **Pricing** — indicative fixed-price audit + monthly subscription; founder to set
   the numbers. Placeholder in the eventual spec.

## Resume point

Brainstorming flow paused here at founder request (2026-06-07), immediately after
design approval and writing this design doc. **Next session, in order:**
1. Resolve Open Decision #1 (design-partner access) — it reshapes sequencing.
2. Confirm #2/#3/#4.
3. Spec self-review (placeholders/consistency/scope/ambiguity), then founder reviews
   the spec.
4. Invoke the `writing-plans` skill to produce the implementation plan for the build
   delta in §4.

(Per founder workflow this design doc is **uncommitted** — PR it when ready; the
workbench is PR-gated.)
