---
product_key: system-builder-studio
renamed_from: studio-foundry-build-path-designer
charter_date: 2026-06-21
risk_tier: T0
greenlight_gate: d2d3f338-d7f6-4316-be57-330cf4d28f55
status: chartered
brief: docs/foundry/system-builder-studio/opportunity-brief.md
---

# Charter — System Builder Studio

> Authored at Gate 1 (founder greenlight `d2d3f338-d7f6-4316-be57-330cf4d28f55`,
> recorded via `foundry_gate_decide` → approved, 2026-06-21). This charter FIXES
> what `/build-path` (stage 4) parameterizes on. Changing the risk tier later is a
> **new founder gate**, not an edit. (Product renamed from
> `studio-foundry-build-path-designer` on 2026-06-21; the build path designer is
> **slice 1** of System Builder Studio.)

## Name & key

- **Name:** System Builder Studio
- **Key:** `system-builder-studio`
- **Slice 1:** the **Build Path Designer**.
- **One-line pitch:** a focused authoring surface inside `domains/studio` that turns
  a product charter into a Foundry build path — visually, on `<ds-board-kit>` — and
  pushes it to the Foundry queue. **Not** a full IDE.

## Risk tier

**T0 (prototype/demo).** Two independent reads converge (per the brief):

| Tier | Examples | Gates | Quality parameters |
| --- | --- | --- | --- |
| **T0** prototype/demo | markets, gridiron | greenlight + ship | wave standard, auto-merge OK |
| T1 product | herdbook, exercir | + architecture approval | wave + `deep` effort on kernel-touching items, mutation thresholds enforced |
| T2 regulated | oncology (MDR Class IIb) | + every kernel-touching ADR + designer-first mandatory | full battery, RLS/tenancy proofs required, no auto-merge |

**Why T0:**
1. **Blast radius / regulatory** — confined to `domains/studio`; no PHI; no real
   users beyond the founder; no external integration beyond Foundry's own MCP. The
   **only** state-writing actuation is `foundry_queue_push` (the one-way door),
   itself founder-gated and reversible-until-push. **Zero kernel change**
   (ADR-176-safe by construction).
2. **Substrate fit is `partial`** (inference is downstream/out-of-slice — the slice
   computes derived views, not posteriors). The gate rule caps a `partial`-fit idea
   at T0; this *converges* with the blast-radius read rather than fighting it. A
   non-clean inference fit is itself a reason to prototype, not commit a product
   build.

## Scope (the wedge)

Author **one** charter visually into a `BuildPathDraft` on `<ds-board-kit>`, resolve
scope conflicts in the disjointness panel, and **push** it to the Foundry queue —
proving the bridge **charter → visual build path → Foundry queue**, with the
disjointness gate blocking unsafe parallelism.

The slice **subtracts** the already-landed Studio UI (S4–S6 gesture-native tree
editor + kernel-shaped `PlanTreeStore` + the two-trees loop) and charters only the
**new ends**:

1. **Charter-import projector** — `projectCharterToDraft()`: charter-shaped input → `BuildPathDraft`.
2. **`BuildPathDraft` model + store** — typed `BuildNode` (`goal | epic | work-item | gate`); in-memory, **kernel-shaped** (`PlanTree`-compatible, port-swap-ready).
3. **Board-kit binding** — reuse Studio's two-trees loop wholesale; gate nodes render distinctly.
4. **Node inspector** — label, kind, `dependsOn`; work-items get scope + a *compact* quality summary (one effort knob); gate nodes get gate metadata. Not a form-heavy admin surface.
5. **Disjointness panel** — computes scope overlaps across work-items; clash badges; **blocks push while unresolved**.
6. **Prompt-preview panel** — renders the worker-session prompts Foundry *would* generate, before commit.
7. **Push actuator** — the one-way door: `foundry_queue_push` (the single audited Foundry actuation).

**Locked founder forks (2026-06-21), binding on the build:**
- **Representation = editable draft projection** (Foundry stays single source of truth).
- **Actuation = push-to-queue is the one-way door** (edits reversible until push).
- **Founder gates = explicit nodes** on the canvas (map to Foundry `request-gate`).

## What NOT to build

1. **Read-back / re-projection loop** — Foundry observations/claim-state flowing
   *back* onto the draft. Push stays one-way; the loop is a later slice.
2. **Live-substrate store swap** — `BuildPathDraftStore` stays **in-memory** +
   kernel-shaped; no kernel-backed persistence this slice (proves the port seam
   without coupling).
3. **Recipe-Designer-authored node editors** — inspector editors stay hand-coded;
   the recipe-driven build-path designer is the future path (#8).
4. **Full IDE / code editor / live worker-orchestration UI / arbitrary workflow
   editor** — the designer authors *build paths*, not code.
5. **Editing queue/claim/observation state in Studio, or surfacing the calibration
   twin** — Foundry stays the operational authority; predicted-vs-observed lives in
   devloop, not here.

## Quality plan

Tier-derived obligations (T0: wave **standard**, auto-merge OK). These become
`qualityObligations` on queue items — `/build-path` consumes them verbatim:

- `wave-standard` — verifier wave (reviewer + qa-engineer + charter-checker) on every non-trivial item.
- `a11y-battery` — WCAG 2.2 AA on all new authoring surfaces (inspector, disjointness panel, prompt-preview); the `<ds-board-kit>` a11y already exists and must not regress.
- `two-trees-discipline` — ADR-239/240: draft is truth, `RenderNode` is a derived projection, layout geometry is **never** persisted (`move` maps to no edit).
- `zero-kernel-change` — charter-checker must confirm no kernel/contract change; all operational fields ride as metadata + derived views (ADR-176 inclusion test not met for this slice).
- `push-actuator-review` — the **one irreversible seam**. The push-actuator item gets a deliberate review focus even within a T0 battery: `foundry_queue_push` idempotency, and the **disjointness gate blocks push before any write**. Auto-merge OK for the other items; the actuator item warrants an explicit founder/reviewer checkpoint before it is wired to the live Foundry queue.

## Gate schedule

> **Founder directive 2026-06-21: fully-autonomous operation.** The founder waived
> the downstream founder gates for this T0 product — the slice builds, merges, and
> ships autonomously on green verifier waves. Gate 1 (greenlight) remains the
> historical record of authorization. This waiver is **scoped to this T0 product
> only**; it does NOT extend to any T2/regulated product's gates.

| Gate | When | Status |
|---|---|---|
| **Gate 1 — greenlight** | Brief approved | ✅ approved `d2d3f338-d7f6-4316-be57-330cf4d28f55` (2026-06-21) |
| **Founder checkpoint — push goes live** | Before the push actuator is wired to the real Foundry queue | **WAIVED** (founder, 2026-06-21) — `push-actuator-review` stays as an *engineering* review focus (idempotency + disjointness-blocks-push), but no founder confirmation gates it |
| **Gate — ship** | Slice complete | **WAIVED** (founder, 2026-06-21) — the slice auto-merges/auto-ships on a green verifier wave; no founder ship gate |

## Repo plan

- **Domain repo:** `de-braighter/studio` (existing — **additive**, not a new repo).
- **`/new-domain` scaffold tiers needed:** **none** — the `studio` domain and the
  `studio-ui` Angular app already exist and ship green; this is additive UI work
  within the existing app (reuses the S4–S6 two-trees loop).
- **Packages consumed:**
  - `@de-braighter/design-system` — `<ds-board-kit>` (core 2.5.0 / angular 1.14.0).
  - `@de-braighter/substrate-contracts` — `PlanTree` types for the kernel-shaped `BuildPathDraftStore`.
  - **Foundry public surface** (MCP/CLI) — `foundry_queue_push`, `foundry_bootstrap_workflow`. Never Foundry internals.
