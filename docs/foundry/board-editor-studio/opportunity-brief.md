---
product_key: board-editor-studio
brief_date: 2026-06-21
status: brief
substrate_fit: partial
rubric_total: 32/40
recommended_tier: T0
recommendation: build
---

# Opportunity Brief — Board Editor Studio

> Stage-2 scoring of `dossier-record.md`. This product is the visual next-generation
> of the shipped **Editor Recipe / Recipe Designer** (`domains/studio`, slices 1–3):
> author `<ds-board-kit>` board editors as declarative DATA, reframed from a single
> flat-`shapes[]` form into a **catalog IDE** — a navigable library of reusable
> primitive- and composite-**definitions** placed by **reference**, with a persistent
> live preview, code view, and cross-reference bookkeeping.

## Substrate-fit decomposition

This is **brick / studio territory** — it *composes* the substrate's `<ds-board-kit>`
tree-renderer brick and authors EditorRecipe DATA; it does **not** author kernel
concepts. The four-kernel-concern test is built for *domain twins*; applied to a
design-time **authoring tool** it reads `partial` by construction, and that is the
honest, ADR-176-safe answer (composes-not-authors).

- **Plan tree → `forced`.** The studio authors a *recipe document* whose composites
  form a single-parent, cycle-checked containment tree (`wouldCycle`/`defContains`),
  and the editors it produces *render* consumer plan trees via the board-kit. But this
  is a studio-side document model, not a kernel plan tree — the kernel's plan-tree
  concern is exercised by the board-kit brick it consumes, not authored here.
- **Event log → `absent`.** A design-time authoring tool streams no observations. There
  is no twin of "the studio" to feed. (Future tenant-authoring telemetry would be a
  separate concern, not in scope.)
- **Inference → `absent`.** No posteriors, no counterfactuals, nothing a user "buys" as
  a twin. The value is authoring leverage, not inference.
- **Reproducibility → `natural` (the one strong fit).** The recipe document is a
  versioned, serializable, replayable artifact: save/load/name a catalog, schema
  versioning across the flat-`shapes[]` → `definitions[]`+`layers[]` migration, copy-JSON
  export, and the (backlog) eject-to-TS hatch. Reproducibility of authored editors is real.

**Aggregate:** two `absent` ⇒ `substrate_fit: partial`. Per the stage-2 gate rule, any
`absent` core concern caps the recommendation at **a T0 experiment** — which is exactly
correct here and consistent with the sibling `studio` product already being T0.

## Reuse inventory

Concrete cluster assets this leans on — leverage is very high:

- **`@de-braighter/design-system-core@2.6.0` board-kit surface** — `EditorRecipe` schema,
  `interpretRecipe(recipe)` → live `BoardRegistry`, `validateRecipe` author-time gate,
  and the `<ds-board-kit>` SVG tree renderer/editor brick. The whole product is a richer
  front-end over this published API.
- **`domains/studio` slices 1–3 (shipped)** — `RecipeDesignerComponent`,
  `buildRecipeFromForm`, the CVA `PrimitivesEditorComponent`/`ShapesEditorComponent`
  chain, `sample-tree.ts`, and the `plan-kinds-parity.spec.ts` de-risking proof. The
  definition/instance model extends this proven base rather than greenfielding.
- **de-braighter design system** — tokens + 3 skins (exercir/strategir/operir), glass/neon
  language; the prototype's skin switcher maps onto existing skin infrastructure.
- **Angular Signals + reactive-forms-CVA governance** — the slices-1–3 CVA-over-`FormArray`
  pattern (`formControlName` hosting, `linkedSignal` echo-reset guard) is the template for
  the catalog/drawer forms.
- **Board-kit tree-renderer arc lessons** ([[board-kit-tree-renderer-arc]]) — the WCAG-2.4.3
  focus-recovery trap (real browsers blur disabled controls to `<body>`; jsdom doesn't) is a
  known hazard for the reorder/remove/drop interactions this product is full of.

## Scorecard

| # | Dimension | Score | Justification |
|---|---|---|---|
| 1 | Strategic fit | 5 | Directly advances the flagship **studio product direction** (sell the path-BUILDER, not the paths); deepens the substrate's authoring surface. |
| 2 | Market pain | 2 | No external buyer/pain stated in the dossier; today an internal authoring tool. Tenant/end-user authoring is a future hypothesis, untested. |
| 3 | Buyer clarity | 2 | Buyer is internal (founder + design/dev team) now; the "studio you can sell" buyer is aspirational and unproven. |
| 4 | Data feasibility | 5 | No external data dependency; the only "data" is a sample node-tree fixture for preview — trivially available. |
| 5 | MVP feasibility | 5 | Slices 1–3 already ship the engine + form + parity proof; this is incremental on a proven base with a clean compile-down wedge. |
| 6 | Differentiation | 3 | "Editors as data" + definition/instance reuse + composites is a genuinely distinctive authoring model — but it's internal tooling, so differentiation accrues to the platform, not a market. |
| 7 | Regulatory ease | 5 | None — no PHI, no external integrations, no auth surface, T0 internal. |
| 8 | Platform leverage | 5 | Maximal — dogfoods composes-not-authors, strengthens the board-kit brick surface, and the usage cross-ref graph is a textbook "store generators, derive graphs" exemplar. |
| | **Total** | **32/40** | Strong for a T0 internal tool; the only weak axes (market/buyer) are expected and acceptable for tooling. |

## Risk tier

**T0 (prototype / internal dev tool).** Justification:

- **Regulatory burden: none.** No PHI, no real users, no external dependencies, no auth.
- **Blast radius: contained.** Work is studio-only by default (`domains/studio`). The one
  cross-cutting risk is whether `svg`/composites/definition-refs force a
  `design-system-core` brick change (a published-package blast radius); the wedge is
  designed to *avoid* that by compiling-down studio-side first (preserving the slices-1–3
  "zero core change" posture), and any brick change is gated to a separate, deliberately
  scoped item with charter-checker review.
- A T0 tier means tier-light quality battery (review floor + targeted wave), no
  regulated-device obligations.

## Recommendation & wedge

**Build now.** The founder has verbally greenlit ("this is where we go with our board
editor"); this brief tees up the formal Gate 1.

**Wedge (narrowest valuable first slice): the catalog shell + definition/instance model,
compiled DOWN to the existing `shapes[]` at interpret time.** Concretely: a left-rail
catalog navigator + a primitives library where a primitive is authored once as a named
*definition* and *placed* as instances `{ref,x,y}` into a node's layer stack, with the
live preview unchanged — and a `buildRecipeFromCatalog` that *expands* definitions/instances
into the existing flat `shapes[]` so `interpretRecipe`/`<ds-board-kit>` need **zero change**.
This delivers the headline reuse-by-reference value, proves the model lowers cleanly, and
*de-risks the central open question* (studio-only vs core change) before any cross-repo
publish is committed. Composites, the `svg` primitive, cross-ref analytics, the detail
drawer, board-settings surface, persistence, and the richer serialization then ladder on
top as subsequent build-path items.

## What NOT to build (charter candidates)

1. **Multi-board / multi-recipe catalog management.** The "catalog" pill hints at managing
   many boards; the prototype only ever edits ONE board's definitions. Scope to a
   per-board definition library first; defer cross-board catalog management.
2. **Drag-to-reparent / free-layout authoring gesture.** "Re-parent (drag)" is a toggle and
   instances carry x/y offsets, but authoring is numeric-offset only in the prototype. Defer
   the actual drag-to-reparent / free-layout gesture (also a slices-1–3 backlog item).
3. **End-user / tenant authoring + `svg` sanitization hardening.** Raw-SVG injection
   (`dangerouslySetInnerHTML`) is unsafe for untrusted authors. Build for the trusted
   internal author first; defer tenant-authoring and the sanitization posture it requires.
4. **eject-to-TS (`BoardRegistry` codegen).** JSON export + copy-JSON first; defer eject.
5. **A bespoke `design-system-core` brick rewrite.** Resist lowering definitions/instances/
   `svg`/composites into the brick until the compile-down studio-side approach is proven
   insufficient — any brick change is a separate, charter-checker-gated item, not the wedge.

## Next stage

On Gate-1 greenlight: register the product, request the greenlight gate, then author
`charter.md` (binds name/tier/scope/what-NOT-to-build/quality plan/gate schedule), then
`/build-path board-editor-studio` to decompose into claimable foundry work items.
