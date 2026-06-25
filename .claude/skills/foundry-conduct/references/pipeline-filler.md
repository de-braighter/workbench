# Pipeline-filler (Component E — full per-tier detail) + deferred increments

> Load this when the autonomous conductor goes IDLE (nothing claimable AND nothing awaiting
> merge) and the core SKILL.md IDLE-CHECK summary points you here for the full per-tier
> mechanism — the greenlit predicate, the green-desk anti-livelock bounds, and the Tier-3
> stop-for-founder protocol. The core states the ladder (Tier 1 auto → Tier 2 auto → Tier 3
> founder-gated → true idle); this is the detail of each rung and the inviolable gate boundary.

## Pipeline-filler (Component E — never idle)

When the autonomous conductor finds the pipeline empty (nothing claimable AND nothing
awaiting merge), it does **not** stop — it invokes the pipeline-filler to replenish work.
The filler runs a **priority ladder** that respects the founder's "drop inputs · decide
gates" boundary:

### Tier 1 — Continuation (AUTO — no new gate required)
For each already-**greenlit** product whose charter has unbuilt epics, run `/build-path`
to decompose and emit the next work items into the foundry queue (including ADR-reservation
via Component A). This is within the existing greenlight: the product was already approved;
`/build-path` only emits NEW itemIds (idempotent on existing items). **No founder gate.**

**Greenlit predicate (machine-checkable):** A product is greenlit when
`foundry_gate_status { productKey: <product> }` returns a gate with
`gateType: 'greenlight'` AND `decision: 'approved'` (or the product's charter status is
`approved` in the charter file). Use `foundry_gate_status` — NOT an event-log grep. A
filler MUST NEVER widen its mandate to a non-greenlit product.

→ If new items appear: continue the main loop immediately.

### Tier 2 — Green-desk maintenance (AUTO — within standing mandate)
Invoke the **`/green-desk` skill** (Component D — implemented): it scans every active repo
across every debt dimension, drops false-positives via the audit ledger, and emits disjoint
path-area cleanup items (`green-desk-<repo-slug>/debt-<area>`) under a synthetic
`green-desk-<repo-slug>` T0 product. Driving repos to a clean desk is part of the standing build
mandate. The skill owns the anti-livelock mechanism (git-HEAD repo-suppression + per-cycle
cap + no-new-progress stop); this filler simply invokes it and continues if items appear
within budget. **No founder gate.**

**Anti-livelock rule (mechanism now lives in the skill):** Tier 2 is suppressed for a
specific repo within a cycle if no merge has changed that repo since the last sweep of it —
`/green-desk` derives this from `git rev-parse origin/main` vs the `lastSweptCommit` in its
per-repo ledger (no foundry event; ADR-176). A per-cycle work-item cap (default 10 items)
and a no-new-progress stop further bound it; the filler yields when the cap is hit and
continues on the next IDLE CHECK.

→ If cleanup items appear (within cap): continue the main loop immediately.

### Tier 3 — New-product / new-feature proposals (FOUNDER-GREENLIGHT-GATED)
Run the **`product-strategist` agent** to surface 2–3 ranked candidate next-features or
new products from the masterplan, product-ideas backlog, and retros. These proposals **DO
NOT auto-build.** They hit **Gate 1 (greenlight)**: the conductor SURFACES them to the
founder and enters a **STOP-FOR-FOUNDER** state. It never auto-charters or auto-builds a
new product. On a founder greenlight, the dossier→brief→charter→`/build-path` pipeline
fills the queue, and the conductor resumes from Tier 1.

### Gate boundary (inviolable)
- **Tiers 1 and 2 are fully autonomous** — they operate within already-granted mandates
  (greenlit products, standing green-desk obligation) and require zero founder interaction.
- **Tier 3 ALWAYS requires a founder greenlight** — a new product or out-of-masterplan
  feature is NEVER auto-built. The conductor surfaces, explains, and waits.
- **True idle (real, reachable termination) when all three tiers are exhausted:** no
  unbuilt epic on any greenlit product, no unsuppressed repo debt, and no founder-greenlit
  proposal. Context-critical stop is the backstop — true idle fires first.
  Clean stop message: "Conductor idle — no unbuilt epics, no repo debt, no greenlit
  proposals. Re-launch after a masterplan input or greenlight."

Reuses existing skills: `/build-path` (Tier 1), the `/green-desk` debt-path
generator (Component D — Tier 2), and the `product-strategist` agent (Tier 3).

## Deferred to the next increment (named)

In-**Workflow** review stage + auto-merge T0/T1 as a **sibling pipeline stage** (pipeline:
build → wave → merge; slice 2.1 — distinct from autonomous mode which already self-waves inside
each worker subagent); a lightweight
`ConductorRegistered` presence record; the external-daemon substrate for 24/7 unattended running
(design v2 — autonomous Agent-loop mode already covers the unattended case within a single
session's context budget).
