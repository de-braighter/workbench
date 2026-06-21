---
product_key: system-builder-studio
renamed_from: studio-foundry-build-path-designer
brief_date: 2026-06-21
status: brief
substrate_fit: partial
rubric_total: 33/40
recommended_tier: T0
recommendation: build
---

# Opportunity Brief — System Builder Studio

> Stage 2 of the Foundry pipeline. Scores substrate fit + the 8-dimension
> opportunity rubric, recommends a risk tier, and tees up founder **Gate 1**
> (greenlight). Sources: `dossier-record.md` + the two manifested assets
> (`foundry-studio-fusion-handover.md`, the slice-1 design note). **Slice 1 of
> System Builder Studio = the Build Path Designer** (charter → visual build path →
> Foundry queue); the full Studio↔Foundry fusion is explicitly deferred. (Product
> renamed from `studio-foundry-build-path-designer` on 2026-06-21.)

## Substrate-fit decomposition

This is a **meta-product**: a Studio authoring surface whose *output* is a kernel
`PlanTree`. So each concern is read at two levels — what it is for the designer
*itself*, and what it is for the build path it emits.

| Kernel concern | What it concretely is here | Judgment |
|---|---|---|
| **Plan tree** | The `BuildPathDraft` *is* a strictly single-parent tree of typed `BuildNode`s (`goal \| epic \| work-item \| gate`). Structure → kernel `PlanTree`; operational fields (`scope`, `qualityObligation`, `dependsOn`, `gate`) → metadata + derived views. The product exists to author the kernel's central primitive. | **natural** |
| **Event log** | The `PUSH` one-way door appends real observations to **Foundry's** event log (`foundry_queue_push` / `bootstrap_workflow`); queue/claim/review/merge events stream from there. The write side is in-slice; read-back re-projection onto the draft is deferred (design note forward-ref). | **natural** (write in-slice, read deferred) |
| **Inference** | The slice computes **derived views** — disjointness overlaps across scopes, prompt-preview of generated session prompts, quality derived from risk tier. These are "derive graphs, don't store them" (ADR-176-aligned), **not posteriors**. The genuine inference home — the devloop SDLC calibration twin (predicted-vs-observed delivery indicators → per-producer calibration) — observes this product's push events but is **downstream and out-of-slice**. | **forced** (real for the product, awkward/absent in-slice) |
| **Reproducibility** | The plan structure is versioned + replayable; `PUSH` is the *single audited actuation*; nothing right of push is copied back as authoritative state. The store is kernel-shaped so a live-substrate swap is a port change, not a rewrite. | **natural** |

**Aggregation:** plan-tree natural · event-log natural · reproducibility natural ·
inference forced → **`substrate_fit: partial`**. The `partial` is *entirely* the
inference concern, which is correctly **downstream** (the designer is upstream of a
calibration loop that already ships in devloop), not a sign the idea is
ill-shaped — the plan-tree fit is as native as anything in the cluster. A `partial`
fit is itself a reason to **prototype, not over-build** (see Risk tier).

## Reuse inventory

This slice is overwhelmingly **additive over already-shipped assets** — it
*subtracts* the landed Studio UI and charters only the new ends.

| Asset (concrete) | How it's reused |
|---|---|
| **Studio two-trees loop** (`domains/studio/apps/studio-ui`, S4–S6 shipped) | `PlanTree` signal → `projectPlanTree()` → `RenderNode` → `<ds-board-kit>` → `EditIntent` → `editIntentToPlanEdits()` → `PlanTreeStore.applyEdit()`. Reused **wholesale**; only the projector (charter→draft) + actuator (draft→push) are new. |
| **`<ds-board-kit>` brick** (design-system, core 2.5.0 / angular 1.14.0) | The generic CDK-grade tree renderer+editor; selection-aware-draw renders gate nodes distinctly. Already consumer-proven (exercir + kids). |
| **Foundry MCP surface** | `foundry_queue_push` is the **one live wire**; `foundry_bootstrap_workflow` for workflow actuation. Reached only through the public surface — never Foundry internals. |
| **`/build-path` skill (F4)** | Already turns a charter into scaffold plan / epic ladder / UI-surface plan / ADR needs / quality-battery / claimable items **+ disjointness proof**. The designer is a *visual front-end* over logic that already exists in prose — the disjointness + quality-derivation logic is reusable. |
| **Recipe Designer** (studio#2/#3/#4, S1–S3) | Future path (#8): author the node-inspector editors as Recipe data. Reuse **deferred**, pattern exists. |
| **devloop SDLC twin + calibration ritual** | The downstream inference home (`Producer:`/`Effort:`/`Effect:` → reconcile → per-producer calibration). Consumes push events. Out-of-slice but already shipped. |
| **Kernel `PlanTree` contracts** (`@de-braighter/substrate-contracts`) + **ADR-239/240** two-trees discipline + **ADR-176** inclusion test | `BuildPathDraftStore` stays kernel-shaped (port-swap-ready); governance patterns reused verbatim. |

## Scorecard

8 dimensions, 1–5 each, total **/40**.

| # | Dimension | Score | Justification |
|---|---|---|---|
| 1 | **Strategic fit** | **5** | The flagship "sell the path-**BUILDER**, not the paths" reframe ([[studio-product-direction]]) made concrete, fused with the foundry self-application thesis — the bridge that turns the whole substrate/foundry program into a usable tool. Maximally central. |
| 2 | **Market pain** | **2** | The dossier asserts **no** external buyers/pricing/pain (internal-infra posture; "do not market externally"). The pain — information loss between strategy ↔ work ↔ outcomes — is real but **founder-internal/dogfood**, not externally validated. |
| 3 | **Buyer clarity** | **2** | No external buyer; the "buyer" is the founder / the foundry itself. Clear internal user, no external buyer. |
| 4 | **Data feasibility** | **5** | All data is internal + already-shaped — charters, `PlanTree`s, Foundry events all exist in the cluster. Zero external acquisition. |
| 5 | **MVP feasibility** | **5** | Both halves ship green; the slice is additive-only (~7 narrow pieces: projector · store · shell · canvas · inspector · disjointness · prompt-preview · push actuator) reusing the two-trees loop wholesale, **zero kernel change**. Watch item: prompt-preview *fidelity* to what Foundry actually generates. |
| 6 | **Differentiation** | **4** | The "visual compiler for product development — governance, replay, calibration, explicitly **NOT** prompt-to-app" framing is genuinely differentiated. Strong concept, but internal ⇒ untested against any external alternative. |
| 7 | **Regulatory ease** | **5** | No PHI, no external integration beyond Foundry's own MCP, Studio-internal authoring tool. Zero regulatory burden. |
| 8 | **Platform leverage** | **5** | Maximal — composes Foundry + Studio + design-system + kernel `PlanTree` + (downstream) the devloop twin into one surface. The substrate self-applying to its own development. |

**Total: 33/40.** The two low scores (market pain, buyer clarity) correctly
reflect the **internal-infrastructure** posture — this is tooling, not a
go-to-market product. It scores very high on everything that matters for internal
tooling and low only on the external-market dimensions that don't apply.

## Risk tier

**Recommended: T0 (prototype/demo).** Two independent lines converge here:

1. **Blast radius / regulatory** — confined to `domains/studio`; no PHI; no real
   users beyond the founder; the **only** state-writing actuation is
   `foundry_queue_push` (the one-way door), which is itself founder-gated and
   reversible-until-push. **Zero kernel change** (ADR-176-safe by construction).
2. **Gate-rule alignment** — substrate fit is `partial` (inference forced /
   downstream). A non-clean inference fit is a reason to *prototype and learn*,
   not to commit a T1 product build. The two reads agree: **T0**.

**Quality (per the T0 row):** wave **standard**, auto-merge OK. **One sharpening:**
the **push actuator** is the single irreversible seam (it writes real Foundry
state) — even inside a T0 battery it warrants a deliberate review focus (idempotency
of `foundry_queue_push`, disjointness-gate-blocks-push enforced before any write).

## Recommendation & wedge

**Recommendation: BUILD now, as a T0 product.**

**Wedge (narrowest valuable first slice):**

> Author **one** charter visually into a `BuildPathDraft` on `<ds-board-kit>`,
> resolve scope conflicts in the disjointness panel, and **push** it to the
> Foundry queue — proving the bridge **charter → visual build path → Foundry
> queue**, with the disjointness gate blocking unsafe parallelism.

The design note's pieces are all slice-1 and mutually reinforcing; the wedge *is*
slice-1 as designed. If sequencing is needed, the load-bearing core is
**charter-import projector + board-kit binding + disjointness panel + push
actuator**, with **inspector + prompt-preview** as fast-follows.

**Repo placement (decided at Gate 1):** the code lands in the existing
**`domains/studio`** repo (additive — reuses the shipped studio-ui app + two-trees
loop), *not* a new git repo. The Foundry product `system-builder-studio` is
registered with `repo: "de-braighter/studio"`.

## What NOT to build (charter candidates)

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

---

**Gate 1 (founder greenlight) — APPROVED.** Recorded via `foundry_gate_decide`
(gate `d2d3f338-d7f6-4316-be57-330cf4d28f55`, 2026-06-21). The charter
(`docs/foundry/system-builder-studio/charter.md`) binds name, tier, scope,
what-NOT-to-build, quality plan, gate schedule, and the repo-placement decision.
