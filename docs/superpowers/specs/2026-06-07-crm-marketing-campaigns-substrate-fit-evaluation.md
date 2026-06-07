---
title: "CRM & marketing campaigns as a substrate pack — fit evaluation & concept"
status: concept (idea evaluation) — for founder review, not greenlit
kind: product-concept
created: 2026-06-07
author: stibe
home: none yet (candidate domain — would be domains/<crm-name> if pursued)
relates-to:
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
  - layers/specs/adr/adr-027-pack-architecture.md
  - layers/specs/adr/adr-203-wire-inference-to-observation-log-and-second-conjugate-family.md
  - docs/superpowers/specs/2026-06-03-markets-external-source-integration-design.md
origin: >
  Founder dropped a passing idea (2026-06-07): "substrate is a match for CRM and
  marketing campaigns too i think." This doc evaluates that hunch against how the
  kernel actually works and where the cluster is strategically, then captures the
  recommended framing if it is ever pursued. It is an EVALUATION + CONCEPT, not a
  build design and not a commitment.
verdict: >
  Architectural fit is real and unusually clean — among the tightest mappings in
  the cluster, with campaign-level COUNTERFACTUAL as the standout. But "a CRM" is
  the wrong product framing (red ocean; heavy non-substrate lifts in identity and
  scale). The defensible shape is a CAMPAIGN INCREMENTALITY / UPLIFT engine as a
  pack that AUGMENTS an existing stack — not a Salesforce competitor. Subordinate
  to the oncology north-star; value is as a substrate-generality demonstrator and
  a potential commercial counterweight, not a pivot.
---

# CRM & marketing campaigns as a substrate pack — fit evaluation & concept

> Marketing, stripped of jargon, is the substrate's exact loop: you *intervene*
> (send a touchpoint), you *observe* (the customer acts or doesn't), you *infer*
> the causal effect, and the valuable question is always counterfactual — *would
> this conversion have happened anyway?* That last question is the most valuable
> and most under-served problem in martech, and it is precisely the capability the
> substrate already proved in exercir's what-if lane. The fit is real. The trap is
> calling the result "a CRM."

## TL;DR scorecard

| Lens | Score | One-line |
|---|---|---|
| Architectural / four-concern fit | **8/10** | Among the cleanest mappings in the cluster; counterfactual is the killer fit. |
| As "a CRM product" | **3/10** | Red ocean (Salesforce/HubSpot); identity + scale are heavy non-substrate lifts. |
| As a narrow incrementality/uplift wedge | **6–7/10** | Under-served niche; plays to the substrate's rarest strength; augments, not replaces. |
| As a substrate-generality demonstrator | **8/10** | "sports + breeding + finance + oncology + marketing on one kernel" = north-star §9 made undeniable. |
| Strategic timing vs. oncology north-star | **caution** | Don't let it pull focus off the regulated deep play; parallel/later commercial pack at most. |

**Recommendation:** if pursued, frame it as **campaign incrementality/uplift as a
pack that augments an existing stack** — and treat it as subordinate to the
oncology north-star ([[second-brick-oncology-direction]]).

## The fit (steelman) — four concerns, near 1:1

The kernel is exactly four concerns (CLAUDE.md / ADR-127). Marketing maps onto all
four with little distortion:

1. **Recurse the plan** → `campaign → journey/segment → touchpoint → message-variant`.
   A single-parent tree of *interventions*, each carrying a typed effect declaration
   (expected lift on open / click / conversion). This is exactly how journey-
   orchestration tools (Braze, Iterable, Customer.io) already model campaigns.
2. **Flat the observation** → the customer activity stream (email opened, link
   clicked, form submitted, purchased, churned, unsubscribed). This is *literally*
   an append-only event log — it is what CDPs (Segment, RudderStack) are built on.
3. **Inference** → posteriors over campaign effect: attribution, uplift,
   incrementality, propensity. The "digital twin of the funnel."
4. **Reproducibility** → versioned campaigns, A/B variant catalogs, run manifests —
   "which version of the campaign ran, to whom, when."

**The standout — counterfactual.** The entire ad-measurement industry (marketing-
mix modeling, multi-touch attribution, geo-holdout experiments, uplift modeling)
is causal inference in a marketing costume. Most CRM tools ship *correlational*
attribution (last-touch / linear) that practitioners know is wrong. The substrate's
counterfactual lane — *"what if segment X received variant B instead of A?"* —
already shipped and ran end-to-end in exercir (the 2×2 {drill}×{indicator}
what-if; see [[exercir-what-if-lane-state]]). That is the rarest capability in the
space, and it is native to the platform.

## Where the analogy breaks (stress test)

### 1. Tree vs. graph
The kernel is **strictly single-parent tree** ("Cross-links, if ever needed, are a
separate `PlanNodeId` relation, never multi-parent" — CLAUDE.md). A *designed*
campaign hierarchy is a tree — fine. But a customer's *journey through it* is a DAG:
fan-in (one "abandoned cart" email triggered by three campaigns), re-entry, merges,
waits. This is consistent with substrate philosophy — **store generators, derive
graphs**: the journey is a derived view over observations, never the plan tree — but
it is the first place a naïve mapping breaks, and journey orchestration is the
visible product surface. Care required, not a blocker.

### 2. Three heavy *non-substrate* lifts
A CRM pack would carry a lot of weight the kernel deliberately does not touch:

- **Identity resolution** — anonymous→known stitching, cross-device, B2B account
  hierarchies. This is *why the CDP category exists*. The substrate has a `subject`;
  it does not resolve identities. Big pack-side build.
- **Event scale** — marketing is clickstream-volume (tens of millions of events/day
  for a mid-size B2C). `kernel.event_log` is Postgres, sized for players / animals /
  patients, not population martech. Would need a streaming ingest tier batching into
  the log.
- **Population-scale inference** — today's engine is *in-process Normal-Normal
  conjugate*, ideal for small-N domains, not uplift trees over millions of users.
  **This is the most important honest caveat: the fit is at the conceptual layer;
  the substrate's current inference is not yet a marketing-analytics engine.**

### 3. Brutal, mature market
CRM = Salesforce / HubSpot / Microsoft Dynamics. Automation = Braze / Iterable /
Klaviyo / Marketo. Attribution is a *startup graveyard* — iOS 14 + cookie
deprecation killed multi-touch attribution; survivors pivoted to incrementality
(Recast, Haus, INCRMNTAL). Selling "a CRM" against the incumbents is a losing game.
Selling "a Bayesian incrementality/uplift engine that reads your existing event
stream and tells you what actually caused conversions" is a real, under-served wedge.

### 4. Low build-novelty (a feature, with a caveat)
Structurally this is the **markets recipe** again (external source → `event_log` →
posterior → readout; see [[markets-domain-arc]]) with a richer plan tree. That
*de-risks the build* — but it also means the pack teaches the substrate nothing new
**unless** we deliberately push the genuinely novel surface: the branching, effect-
declaring campaign tree plus an **N-armed sequential counterfactual** (exercir's
what-if is only 2×2; a campaign optimizer is N arms over time).

## Governance check (ADR-176 inclusion test)

A CRM/campaign pack is a **domain consumer of the kernel**, not a kernel change. It
fails the inclusion test for kernel residency (campaign/segment/touchpoint/identity
shapes are not needed by ≥2 packs as shared infra the kernel must validate) — which
is the *correct* result: it lives as a typed pack lib + `metadata` JSONB, PACK-on-
platform per ADR-027, **zero kernel change**. The only things that could ever
promote are genuinely cross-pack primitives (e.g. a generic "segment/cohort
selector" or a streaming-ingest spine) — and only on demonstrated multi-pack need,
never speculatively. Same discipline markets followed with its source spine.

## Strategic positioning

The active north-star is the regulated Swiss oncology device — deep moat, high
regulation, PHI-encryption just shipped ([[second-brick-oncology-direction]]). A
CRM pack is the *opposite shape*: horizontal, commodity, low-regulation. The risk
is dilution of a hard-won focus.

The counter-argument has two parts:
1. **Generality proof.** Running marketing on the same kernel as team-sports,
   animal breeding, finance, and oncology is the strongest possible demonstration
   of the "collapse into one substrate" thesis (north-star §9). High narrative and
   dogfooding value independent of whether it becomes a product.
2. **Commercial counterweight.** A horizontal, faster-revenue pack could fund a
   long-horizon regulated medical play.

**Conclusion:** worth keeping on the menu as a *parallel/later* commercial pack or
a demonstrator — explicitly subordinate to oncology, not a pivot.

## Recommended shape (if pursued)

Narrow the wedge hard:

- **Position:** "campaign incrementality / uplift engine" — *augments* an existing
  CRM/ESP/CDP, does not replace it. You bring the causal brain; they keep the
  system of record and the sending infrastructure.
- **Spine reuse:** ride the markets **source spine** for ingest (declare the CRM/ESP
  as a source → adapt its event payload → ground observations → provenance →
  confidence gating). Same incubate-pack-local, graduate-on-2nd-consumer rule.
- **Novel surface to actually build:** the effect-declaring **campaign plan tree** +
  **N-armed sequential counterfactual** at the segment level. That is the part that
  is new for the substrate and differentiated in the market.
- **Deliberately out of scope (the non-substrate lifts):** identity resolution at
  scale, clickstream-volume streaming ingest, population-scale inference. Name them
  as dependencies/risks; do not pretend the kernel solves them.

## Open questions (decisions needed before any design)

1. **Pursue at all, and when?** Park as a logged idea, or schedule as a parallel
   commercial pack after an oncology milestone? (Recommendation: park; revisit
   post-oncology-milestone.)
2. **Wedge confirmation** — incrementality engine (augment) vs. journey
   orchestration (compete)? (Strong recommendation: augment.)
3. **First "source"** — which real CRM/ESP event stream to adapt first (HubSpot,
   Klaviyo, a CSV export) for a markets-style thin demonstrator?
4. **Inference regime** — does the small-N conjugate path suffice for a
   *segment-level* demonstrator (segments are small-N even when users aren't), or
   does this force the population-inference question early?

## Next step

This doc is the evaluation. If the founder greenlights even a thin demonstrator,
the next artifact is a markets-style slice-1 technical design (one real source, one
inference lens, a thin readout) — explicitly scoped to the *segment-level
counterfactual* so it exercises the novel surface without taking on the identity/
scale lifts. Until then: logged in `product-ideas-backlog` and here.
