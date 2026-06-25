---
title: Foundry owns the workbench instructions — the governance tracer (Unified Cockpit D5)
status: proposed
date: 2026-06-24
scope: design-global
tier: charter
product: system-builder-studio
builds-on:
  - docs/superpowers/specs/2026-06-24-unified-cockpit-masterplan.md   # the D-phase north-star (this is ~D5)
  - docs/superpowers/specs/2026-06-23-system-builder-studio-fusion-design.md  # the fusion (Phase A/B/C)
  - ADR-263..267   # foundry workflow-as-first-class ladder (the HOW tree + ACTION_REGISTRY)
  - ADR-242        # substance-as-derived-projection (store generators, derive graphs)
  - ADR-250, ADR-259  # the multi-target compiler (markdown / render-tree targets)
  - ADR-176        # kernel-minimality inclusion test
arc: substrate self-application — the workbench's own governance modelled in its own substrate
---

# Foundry owns the workbench instructions — the governance tracer

> The next arc of the Unified Cockpit (masterplan phase ~D5). Model the **workbench's own
> governance corpus** — `CLAUDE.md`, `policies/`, `workflows/`, the skills + agents, the live
> guardrails — as a **fused governance plan-tree the foundry owns**: it *observes* when each rule
> fires, *calibrates* whether the rule helps, *enforces* the rule via the actuator registry, and
> ultimately *generates* the instruction markdown from the tree. This closes the self-application
> loop the masterplan's D6 names: *"the foundry builds the model of the foundry; the guardrails
> governing that build are nodes in the tree being built."*

## 1. Why now / what it unlocks

The foundry already models the **product tree (the WHAT)** and the **workflow tree (the HOW**,
ADR-263–267, with its `ACTION_REGISTRY` actuation). The unified-cockpit Phases D1–D4 already
modelled the *guardrails* (disjointness gate, charter-checker, verifier-wave, review-floor) as
Axis-2 conditional interventions in the spine. **What is still imperative, static markdown is the
governance corpus itself** — the policies, workflows, and the orchestration instructions humans and
agents read by hand.

Modelling that corpus makes the dev/governance machinery **declared, observed, inferred, and
reproduced like any other substrate system** — which is precisely what turns the foundry+workbench
moat into the sellable SDLC-pro tool (and, swap the profile, the cancer-case-manager). It is the
"build the builder" thesis paying off: the factory becomes a first-class, calibratable system.

## 2. The destination — three ownership rungs across the whole corpus

"Foundry owning the workbench instructions" means all three rungs, as the arc's destination:

| Rung | What "owning" means | Status today |
|---|---|---|
| **R1 Observe + Calibrate** | corpus modelled as governance nodes; firings recorded in the log; the devloop twin calibrates "does this rule help?" | guardrails partly modelled (D1–D4); **policies/workflows not yet** |
| **R2 Enforce / Actuate** | governance nodes *drive* the process via `ACTION_REGISTRY` (the foundry runs the wave / review-floor, not just watches) | the conductor does this for the workflow; **not declared on the corpus** |
| **R3 Generate** | the tree is *source of truth*; `CLAUDE.md` / `AGENTS.md` / `policies` are **compiled from it** | net-new — but `AGENTS.md` is **already** generated from fragments (`build-agents.sh`), so the mechanism has a live precedent |

**Target corpus (modelled incrementally, never all at once):** `CLAUDE.md` (root), `policies/{coding,
testing,git,docs,voice}.md`, `workflows/{verifier-wave,designer-first,story-tracker}.md`, the 38
`.claude/skills/`, the 23 `.claude/agents/`, and the live guardrails (review-floor, disjointness,
charter-checker, verifier-wave, auto-mode classifier).

**Axis mapping (the masterplan's two axes hold):**
- **Axis 1 — Profile:** the SDLC profile (the workbench governs the SDLC). Swap the profile → the
  same machinery governs another domain.
- **Axis 2 — Intervention kind:** the corpus partitions cleanly —
  - **guardrails** (conditional/always-running): policies + review-floor + wave + disjointness +
    charter-checker;
  - **gates** (founder-gated): founder-merge, greenlight;
  - **workflow stages** (the HOW tree, already first-class);
  - **the arsenal** (skills + agents): treated as **actuators the nodes invoke**, *not* tree nodes
    (masterplan layer 4).

## 3. This slice — the review-floor tracer (face-first vertical)

The corpus is the ocean. Per the masterplan (*"each phase becomes its own `/build-path` when
reached… the ocean boils incrementally"*) we prove the **full vertical** — R1 → R2 → R3 — on
**exactly one artifact**, then generalize horizontally.

**Chosen tracer: the review-floor rule** (`policies/git.md`: *"no PR merges unreviewed… every PR
gets ≥1 `/code-review` pass; non-trivial PRs get the full verifier wave"*). It is the ideal tracer
because every rung already has a real hook:

| Rung | Why the review-floor |
|---|---|
| R1 observe | fires on **every PR merge** — richest signal, already in the foundry log (gate/wave/merge events + the findings ritual) |
| R1 calibrate | devloop **already** has a `findings` indicator + the D3 predicted-vs-observed pane (built for disjointness) — we *wire*, not build |
| R2 enforce | the conductor **already enforces** it (the merge rule) — we *declare* the existing actuator, not build new enforcement |
| R3 generate | it is a small **prose fragment** in `policies/git.md` — tractable to compile, mirroring the already-generated `AGENTS.md`-from-fragments precedent |

It is also the natural **second guardrail** after D1's disjointness tracer — and unlike
disjointness, it *has a markdown policy artifact to generate*, which is what makes it the one that
proves **R3**.

**Charter home:** extend the existing **`system-builder-studio`** product (the unified-cockpit
product, 43 done) — this is the D5 continuation of that arc, not a new product. Items are phase-keyed
**D5-***.

## 4. Architecture — the governance-node shape (zero new kernel shape)

Following the ADR-263 + masterplan precedent exactly:

```
FUSED GOVERNANCE TREE  (single-parent, foundry-owned, SDLC profile)
└─ guardrail: review-floor                          ◄── a PlanNode + Axis-2 metadata
     metadata.governanceKind = 'guardrail'
     metadata.sourceArtifact = 'policies/git.md#review-floor'    ← R3 link
     metadata.boundaryPredicateRef → derived view   ← R1 observe
     metadata.action = 'dispatch-review'            ← R2 enforce (ACTION_REGISTRY)
     metadata.authoredContent = { …canonical rule… } ← R3 generate source
     effectDeclarations: [ findings ↓ ]             ← R1 calibrate (devloop indicator)
```

- **The node is data on the `metadata` JSONB boundary** (the ADR-176 simplicity boundary) —
  `governanceKind`, `sourceArtifact`, `action` kind, authored rule content. The *function*
  (predicate, actuator, compiler) is pack code. This is the exact Command-pattern-event-sourced
  shape ADR-263 shipped for the workflow tree.
- **State is derived, never stored** (ADR-242) — firings = a derived view over the existing log;
  calibration = a devloop posterior.
- **Declaration ⊥ actuation** (ADR-263) — the node carries both the *declared* twin-effect
  (`findings ↓`) and the *actuation* kind (`dispatch-review`); two independent axes on one node.

**Where the code lives (honoring "no code in the workbench" — `de-braighter/CLAUDE.md`):**
- `domains/foundry` — the governance-node model, the boundary-predicate derived view, the
  `ACTION_REGISTRY` entry, the markdown compiler target.
- `domains/studio` — the cockpit "Governance" surface (author/observe/calibrate/regenerate).
- **`de-braighter/workbench`** (this repo) — receives only the **design doc** + (R3 output) the
  **generated `policies/git.md` fragment** + a drift tripwire. No engine code.

## 5. Build items (the `/build-path` preview)

Seven scope-disjoint items under `system-builder-studio`, phase **D5**:

**R1 — Observe + Calibrate**
- **D5-1 · Governance-node model** *(domains/foundry)* — the `GovernanceNode` lens over `PlanNode`:
  `governanceKind`, `sourceArtifact`, `boundaryPredicateRef`, `action`, `authoredContent` in
  `metadata`; seed exactly the **review-floor** node. Pure model + the boundary-predicate as a
  derived view. Zero new kernel shape.
- **D5-2 · Observe (firings)** *(domains/foundry)* — `reviewFloorFirings(state)`: per merged PR,
  derive "did it carry ≥1 review verdict before merge?" from the **existing** gate/wave/findings
  events. No new event types; firings are a derived view, never stored.
- **D5-3 · Calibrate** *(domains/studio + foundry twin)* — wire devloop predicted-vs-observed for the
  review-floor onto the `findings` indicator, into the Studio calibration pane (extends the D3
  disjointness pane). Posterior: *"does the review-floor cut escaped findings?"*; counterfactual:
  *"what breaks without it?"*

**R2 — Enforce (actuate)**
- **D5-4 · Declare the actuator** *(domains/foundry)* — `ACTION_REGISTRY` gains `dispatch-review` (or
  recognizes the existing wave-dispatch). The conductor **already enforces** the floor; this slice
  *declares* it on the node (declaration ⊥ actuation). The merge-decision gate stays founder-gated
  exactly as today — modelling enforcement widens no mandate.

**R3 — Generate (founder-gated)**
- **D5-5 · Compiler target + drift tripwire** *(domains/foundry → workbench)* — a `CompileTarget`
  casting the governance node → the `policies/git.md#review-floor` markdown fragment, with a **golden
  round-trip test** (mirrors `build-agents.sh` fragment-gen) + a **drift tripwire** (live markdown vs.
  tree-generated must match). Regenerating the workbench's own instruction file is **founder-gated**
  (high blast radius / visible-to-others).

**The face**
- **D5-6 · Cockpit "Governance" surface** *(domains/studio)* — show the review-floor node, its
  firings, its calibration, and a founder-gated **"regenerate fragment"** action. Author / observe /
  calibrate / drive in one place.

**The proof**
- **D5-7 · Wedge proof + genericity acid** *(integration)* — end-to-end: author node → observe
  firings from the **real** log → calibrate → (founder) regenerate fragment → tripwire green. Plus the
  foundry arc's standard **kill-criterion**: a *second* governance artifact (e.g. a `policies/testing.md`
  rule) re-expresses with **zero new node-kind / action / vocabulary** — else the model is bespoke,
  not generic.

## 6. Governance boundaries (the traps that will try to kill it)

- **R3 does NOT contradict "the foundry log stays authoritative."** The split is clean: the
  governance tree's **authored content** is the source for the *generated markdown*; the foundry
  **log** stays authoritative for *state* (firings, claims, calibration). Markdown becomes a derived
  projection of authored node-content — exactly how `AGENTS.md` is a projection of its fragments.
  Humans edit the *node's content* (via Studio / metadata), then recompile. Content authored in the
  tree · state derived from the log · markdown generated from content.
- **Single-parent + derive, don't store** — the review-floor applies to *many* PRs/nodes → a derived
  cross-link, **never** multi-parent. Firings + predicates are derived views.
- **Mechanics stay actuators** — `gh`, `/code-review` dispatch, the real-time merge hot-path never
  become kernel state. The kernel models; the actuator enforces (no synchronous inference in request
  paths).
- **Founder-gate the one irreversible seam** — R3 regenerate writes the workbench's own instructions.
  That is the single one-way door (the fusion arc's E5-push analogue); it is **founder-gated even
  under the `system-builder-studio` T0 waiver** (the waiver explicitly does not extend to
  high-blast-radius / visible-to-others seams).

## 7. Kernel minimality (ADR-176)

The review-floor guardrail is a **generic conditional intervention** — already covered by `PlanNode`
+ `effectDeclarations` + `metadata`. No `GovernanceDescriptor`, no new node-kind. This is the **6th
consecutive slice** the inclusion test stays pack-level (P7 rejected `InterventionDescriptor` 5×;
ADR-263 the workflow tree; this is the same shape). Expectation: **zero kernel change**,
charter-checker COHERENT. If some primitive genuinely *forces* a kernel touch, that trips
`AUTONOMY(1)` → substrate-architect + charter (surfaced, never auto-applied).

## 8. Testing / acid (the kill-criteria)

- **Round-trip fidelity (R3):** `generate(governanceNode) → markdown fragment` equals the canonical
  `policies/git.md#review-floor` fragment (golden test), and `extract → generate` is idempotent.
- **Observation faithfulness (R1):** `reviewFloorFirings` over the real log matches the actual
  per-PR review state; a mutation that drops the "≥1 verdict" check is RED.
- **Drift tripwire (R3):** live markdown ≠ tree-generated → the tripwire fails (so a hand-edit to the
  policy that diverges from the tree is caught).
- **Calibration honesty (R1):** the posterior is seeded / replay-stable (the foundry-arc lesson — no
  unseeded `Math.random`); predicted-vs-observed scores a real `findings` delta.
- **Genericity (the falsifier):** a second governance artifact re-expresses with zero new vocabulary
  — non-trivially (not a subset of the first), mirroring the foundry-arc acid-test discipline.

## 9. Execution

Foundry-conducted, item-by-item, autonomously under the `system-builder-studio` **T0 waiver** —
**except R3 (D5-5) regenerate, which is founder-gated**. Studio repo work stays disjoint from the
live path-builder (`studio/**`) items. Zero kernel change is the default expectation; a genuine
kernel touch trips `AUTONOMY(1)`. The slice is "done" when the cockpit can author, observe, calibrate
and (founder-gated) regenerate the **review-floor** rule end-to-end, and a second artifact proves the
model generic.

## 10. Open questions (for the implementation plan)

- **OQ-1 — fragment granularity for R3.** Generate the whole `policies/git.md`, or just the
  review-floor *fragment* (recommended: fragment-level, anchored by a sentinel comment, like
  `build-agents.sh`)? The slice assumes fragment-level.
- **OQ-2 — calibration indicator source.** Confirm the devloop `findings` indicator is PR-scoped
  enough to attribute to the review-floor (vs. needing a new derived indicator). The slice assumes
  reuse.
- **OQ-3 — actuator identity for R2.** Does `dispatch-review` register a *new* action kind, or bind
  the *existing* wave-dispatch the conductor already runs (recommended: bind existing, to keep the
  `ACTION_REGISTRY` exact-membership acid honest)?
