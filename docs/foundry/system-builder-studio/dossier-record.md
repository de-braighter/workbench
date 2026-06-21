---
product_key: system-builder-studio
renamed_from: studio-foundry-build-path-designer
source: docs/foundry-studio-fusion-handover.md (+ docs/superpowers/specs/2026-06-21-studio-foundry-build-path-designer-design.md)
intake_date: 2026-06-21
status: intake
---

# Dossier Record — System Builder Studio (Build Path Designer, slice 1)

> **Renamed 2026-06-21:** product `studio-foundry-build-path-designer` → **`system-builder-studio`**
> (founder rename). The Build Path Designer is slice 1 of System Builder Studio. Asset/source
> filenames below keep their original names (point-in-time snapshots).

## Essence

The fusion of **Studio** (the path-builder authoring UI on the design-system
`<ds-board-kit>` brick) and **Foundry** (the charter → build-path → claimable-work
execution machine) into a **visual development foundry** — a visual compiler for
product development. Instead of authoring Jira-style tickets, a founder authors or
reviews a structured plan tree (goal → capabilities/interventions → expected effects →
build-path decomposition → dependencies → scope boundaries → quality obligations →
gates → worker-ready items); Foundry then compiles/actuates that structure into
execution (queue items, claim protocol, session prompts, review waves, merge/release
ritual, event-log observations, calibration feedback). The plan tree becomes the
single explicit, replayable bridge between product strategy and software work — without
collapsing governance. **This dossier scopes the FIRST SLICE only** (the Build Path
Designer); the full fusion is explicitly deferred.

Core claims:

- The fusion is "the first step toward a powerful software development tool: a visual
  compiler for product development" — not an "AI builds apps from prompts" toy, but
  AI-assisted product engineering with visible structure, constraints, review, replay,
  and calibration.
- Most dev systems lose information between strategy (prose), work (tickets),
  architecture (docs), gates (CI/convention), agent work (chat), and outcomes
  (post-hoc reports). The fusion collapses these into one explicit development graph.
- A plan tree can be simultaneously human-authored (preserves intent), machine-readable
  (generates work), governed (avoids runaway automation), and observable (learns from
  outcomes).
- Both halves already exist and ship green: Studio (S4–S6 plan-tree authoring +
  Recipe Designer) and Foundry (MCP surface, build-path skill, workflow-as-first-class
  ladder). This is a fusion of two working things, not greenfield.
- The first slice — **Studio Foundry Build Path Designer** — proves the bridge
  charter → visual build path → Foundry queue, with zero kernel change.

## Domain-model hints

The raw ore the build-path designer (F4) will mine — most of it is already shaped by
the slice-1 design note (asset `2026-06-21-studio-foundry-build-path-designer-design.md`):

- **`BuildPathDraft`** — a strictly single-parent tree of typed `BuildNode`s; the same
  shape Studio already edits, so the two-trees loop is reused. (design note §Domain model)
- **`BuildNode.kind`** ∈ `goal | epic | work-item | gate` — typed, kernel-`PlanTree`-
  compatible structure. (design note §Domain model)
- **Per-node operational metadata** (NOT kernel structure, ADR-176): `scope` (ScopeSpec —
  path globs / disjointness key), `qualityObligation` (QualitySpec — tier → battery
  config), `dependsOn` (PlanNodeId[] — derived sibling references, never multi-parent),
  `gate` (GateSpec). (design note §Domain model, §Governance)
- **Gate** maps to Foundry's `request-gate` plan-tree intervention; founder-gated
  invariant preserved Foundry-side. (handover "founder gates"; design note Fork 3)
- **Lane** — a grouping tag / derived view over disjoint scopes, not a node kind.
  (design note §Domain model)
- **Edit loop** (Studio, already shipped): `PlanTree` signal → `projectPlanTree()` →
  `RenderNode` → `<ds-board-kit>` → `EditIntent` → `editIntentToPlanEdits()` →
  `PlanTreeEdit[]` → `PlanTreeStore.applyEdit()` → new `PlanTree` → re-projection.
  (handover "Current Studio Shape")
- **Foundry actuation surface** (events, not documents): queue/claim state lives in the
  Foundry event log; reached via MCP/CLI (`foundry_queue_push`, `foundry_bootstrap_workflow`).
  (handover "Current Foundry Shape"; design note §Data flow)
- **Charter inputs** Foundry already structures: wedge, risk tier, repo plan, quality
  obligations; build-path expands a charter into scaffold plan, epic ladder, UI-surface
  plan, ADR needs, quality-battery config, claimable work items + disjointness proof.
  (handover "Current Foundry Shape")

## UI-prototype artifacts

The handover **deliberately excludes** all visual/logo/SVG/icon exploration from the
prior conversation — none carried in. The slice-1 design note specifies UX surfaces
(textual, not mockups): tree canvas (`<ds-board-kit>`), node inspector, disjointness
panel, quality-obligations summary, prompt-preview panel, push action. One Mermaid
data-flow diagram is included in the design note. **No image/SVG mockups in this dossier.**

## Market signal

The dossier is internal-infrastructure framing, not a go-to-market pitch — no buyers,
pricing, or pain claims are asserted (consistent with the substrate's "internal
infrastructure, do not market externally" posture). The only market-shaped claim
(founder hypothesis, untested): this fuses into "a powerful software development tool"
that does "AI-assisted product engineering" with governance — positioned explicitly
*against* prompt-to-app toys. Relates to the [studio product direction] "sell the
path-BUILDER, not the paths" reframe.

## Asset manifest

| Asset | Type | What it is |
| --- | --- | --- |
| `assets/foundry-studio-fusion-handover.md` | Markdown (idea capture) | The product-idea handover for the Studio↔Foundry fusion: core thesis, current shape of both halves, product fusion, why-it-matters, the recommended first slice, architectural constraints, 8 open design questions, suggested next pass. Visual exploration intentionally stripped. |
| `assets/2026-06-21-studio-foundry-build-path-designer-design.md` | Markdown (design note) | Slice-1 design note (PR de-braighter/workbench#193). Locks the three founder forks, dispositions all 8 open questions, defines the `BuildPathDraft` domain model, data flow, UX surfaces, governance, and forward references. |

**Nothing-lost check:** manifest rows = 2 == source file count = 2 ✓

## Open questions

What this dossier does NOT answer that stage 2 (opportunity brief / charter) will need:

- **Risk tier** — the build-path designer is a Studio-internal authoring surface (no
  PHI, no external integration beyond Foundry's own MCP); likely T0/T1, but the brief
  must score it.
- **Wedge framing** — is the sellable wedge the Build Path Designer itself, or is it a
  capability of the broader "visual development foundry" product? (The full fusion is
  deferred; the brief should decide whether to charter the slice standalone or as a
  fusion epic.)
- **Scope vs. already-landed Studio UI** — part of the Studio UI has already landed
  (studio S4–S6 plan-tree authoring + Recipe Designer). The build-path must subtract
  what exists (the gesture-native tree editor + kernel-shaped store) and charter only
  the new ends: charter-import projector, `BuildPathDraft` model/store, inspector
  (scope/quality/depends-on/gate), disjointness panel, prompt-preview panel, push actuator.
- **Live-substrate boundary** — slice-1 keeps the draft in-memory (only live wire is
  `foundry_queue_push`); when does the store swap to kernel-backed?
- **Repo placement** — does the Build Path Designer live in `domains/studio` (the
  design note's assumption) or get its own product repo?
- **Effort/quality battery** — to be derived from the risk tier at charter time.

---

**Next stage:** `/opportunity-brief studio-foundry-build-path-designer`
(scores substrate fit + the 8-dimension opportunity rubric, recommends a risk tier,
tees up founder Gate 1 greenlight).
