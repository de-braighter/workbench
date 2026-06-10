---
title: Product Charter (Foundry Gate 1 artifact)
last_updated: 2026-06-10
---

# Product Charter — <Product Name>

> Authored at Gate 1 (founder greenlight, recorded via `foundry_gate_decide`).
> The charter FIXES what downstream stages parameterize on (spec §3 stage 3);
> changing the risk tier later is a new founder gate, not an edit.

```markdown
---
product_key: <key>
charter_date: <YYYY-MM-DD>
risk_tier: T0 | T1 | T2
greenlight_gate: <gateId>
status: chartered
brief: docs/foundry/<key>/opportunity-brief.md
---

# Charter — <Product Name>

## Name & key
<Product name, product_key, one-line pitch.>

## Risk tier
<The chosen tier + WHY, against this policy (spec §3):>

| Tier | Examples | Gates | Quality parameters |
| --- | --- | --- | --- |
| **T0** prototype/demo | markets, gridiron | greenlight + ship | wave standard, auto-merge OK |
| **T1** product | herdbook, exercir | + architecture approval | wave + `deep` effort on kernel-touching items, mutation thresholds enforced |
| **T2** regulated | oncology (MDR Class IIb) | + every kernel-touching ADR + designer-first mandatory | full battery, RLS/tenancy proofs required, no auto-merge |

## Scope (the wedge)
<The narrowest valuable first slice, from the brief — sharpened.>

## What NOT to build
<Explicit exclusions. Each line saves a future session from scope creep.>

## Quality plan
<Tier-derived obligations that become `qualityObligations` on queue items
(F4 consumes these verbatim), e.g. `mutation>=60`, `a11y-battery`,
`rls-proofs`, `non-superuser-testcontainers`.>

## Gate schedule
<Which founder gates at which milestones, per the tier row above.>

## Repo plan
<Domain repo name (`de-braighter/<key>`), `/new-domain` scaffold tiers needed
(spine/pack/api/db/inference/ui), packages consumed.>
```
