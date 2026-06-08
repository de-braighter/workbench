# Board Runtime S1 — The Board Engine (domain-free, proven on drills) — Design

> **Status:** approved (brainstorming) — S1 sub-arc of the board-runtime epic. S1.1 gets the first detailed spec→plan; S1.2/S1.3 get their own specs when reached.
> **Date:** 2026-06-07
> **Parent:** `2026-06-07-football-board-runtime-design.md` (epic) · `2026-06-07-substrate-tree-renderer-north-star.md` (north-star). S0 (contracts) shipped (#218).

## 1. Goal

Generalize the drill editor's renderer + interaction + undo into a **domain-free board engine** that operates on the S0 `BoardGeometry` model, and prove it by re-expressing the drill surface on top of it — **drill behaviour byte-preserved**. This is the first consumer of the north-star renderer, built football-internal with a clean seam for later promotion.

## 2. Why operate on `BoardGeometry` (Fork 1)

The engine operates on `BoardGeometry` (S0), **not** `DrillDiagram`. This is what makes it domain-free and reusable (the epic's goal), and it exercises the S0 converters in anger: the drill surface loads `DrillDiagram → BoardGeometry`, edits geometry, saves `BoardGeometry → DrillDiagram`. The rejected alternative — extract structure but keep it on `DrillDiagram` — only reorganizes drill code without delivering a reusable engine.

## 3. The boundary the current code reveals

- `drill-diagram-ops.ts` — pure ops on `DrillDiagram`: `addDot`/`moveDot`/`setDotKind`/`removeDot`/`addArrow`/`removeArrow`/`setZone`/`clearZone`. Clamps to 100×60; mints `d{n}`/`a{n}` ids; bakes the `pack-football.drill-diagram.{kind}` token.
- `DrillEditorStore` (`state/drill-editor.store.ts`) — **mixes two concerns**:
  - *Generic engine state* (extract): `workingDiagram` (the model), `undo`/`redo`/transient stacks (snapshot-based, already model-agnostic in mechanism), `tool`, `selection`, `canUndo`/`canRedo`.
  - *Drill-catalog persistence* (stays drill-side): `saveStatus`, `errorReason`, `isVendor`, `needsFork`/`rememberFork`/`saveTargetKey`, `sourceKey`/`forkedKey`.
- `DrillBoardEditorComponent` (`generation/drill-board-editor.component.ts`) — bare SVG (`pitchGeometry()`, no `<db-pitch>`), 100×60, toolbar (11 tools + undo/redo), pointer + keyboard interaction, emits `diagramChange<DrillDiagram>`.

The engine extraction = lift the **generic** halves (ops + engine-state + render/interaction) onto `BoardGeometry`; leave **persistence/fork** in the drill host. This is the draw / edit / **persist** seam.

## 4. Architecture — `libs/pack-football-ui/src/lib/board-engine/`

A new, cleanly-bounded folder (football-internal now; the boundary is the later design-system promotion seam):

- **`board-ops.ts`** — pure ops on `BoardGeometry`: `addMarker`/`moveMarker`/`setMarkerKind`/`removeMarker`/`addArrow`/`removeArrow`/`setZone`/`clearZone`. Clamp from `geometry.frame` (not hardcoded 100×60). **Id-prefix + kind-token come from a per-board config** so drill stays `d{n}`/`a{n}` + `pack-football.drill-diagram.*` (byte-preservation). Zones: `setZone`/`clearZone` operate on the (drill) single-zone convention via the config (drill = one zone; the generic model holds `zones[]`, drill config caps at one).
- **`board-editor.store.ts`** — the generic engine store: `workingGeometry: signal<BoardGeometry>`, `undo`/`redo`/`beginTransient`/`updateTransient`/`commitTransient`/`cancelTransient`, `tool`, `selection`, `canUndo`/`canRedo`, `begin(initialGeometry)`. **No** save/fork/vendor concepts (those stay in the drill host). Snapshot-based undo, identical mechanism to today.
- **`board-editor.component.ts` + a render-config** — generalizes the SVG render + pointer/keyboard interaction. The **render-config** (the draw-half) declares: `frame`, the marker/arrow **palette** (which kinds exist + how each draws — glyph/colour/dash, the skin hook), which tools are enabled, and the id-prefixes. Interaction (the edit-half: drag, two-click arrow, zone draw, delete, keyboard nudge — WCAG 2.5.7/2.1.1/2.5.8) stays football-internal, **not** over-generalized (per substrate-architect: the edit-half is the unproven part). Emits committed `BoardGeometry`.

The drill surface (`DrillEditorPanel`) becomes a consumer: mounts `board-editor.component` with a **drill render-config** + the S0 `DrillDiagram⇄BoardGeometry` converters at load/save; keeps its own save/fork persistence.

## 5. Decomposition (each ships green; drill specs stay green)

- **S1.1 — `board-ops` + `board-editor.store` on `BoardGeometry`.** Pure modules + unit tests. Low-risk (the S0-flavored part). Includes the config shape for id-prefix/clamp. ✅ SHIPPED (#219).

> **Revised 2026-06-07 (Approach B — demand-driven, founder-confirmed).** The original S1.2/S1.3 below built the generic `board-editor.component` + a fat render-config for ONE consumer (drill) — speculative per ADR-176 + substrate-architect's caution (the edit-half may stay per-pack). Replaced with:
>
> - **S1.2 (revised) — wire the drill editor onto the engine.** Refactor `DrillBoardEditorComponent`'s INTERNALS only: hold `BoardGeometry` via `BoardEditorStore` + `board-ops`; convert at the component boundary (`drillDiagramToBoardGeometry` on the `diagram` input → working geometry; `boardGeometryToDrillDiagram` for the layout/render + the `diagramChange` emit). Interaction calls `board-ops` with drill kind-tokens (`pack-football.drill-diagram.{kind}`) + id-prefixes `'d'`/`'a'`; single-zone composed from `addZone`/`removeZone` at id `'drill-zone'` (the S0 `DRILL_ZONE_ID`); selection `'dot'`→`'marker'`. Public API + template structure + interaction signatures + the ~23 drill-editor specs stay byte-identical. **Finding:** the `DrillEditorStore` persistence half (saveStatus/fork) is vestigial — called nowhere outside the store + its spec (the panel owns its own save via the `diagramChange` output) — so the store swap is contained, no panel ripple. This proves the engine + S0 converters live on the most-sophisticated board NOW, with far less risk than a from-scratch generic component.
> - **The generic `BoardEditorComponent` + render-config moves to S3**, when the tactical board is the genuine **2nd consumer** — so the render-config is shaped by both boards' needs (ADR-176 promote-on-2nd-consumer), not drill-retrofitted. S3 extracts the shared component from the (now engine-backed) drill editor + applies it to tactical.

Checkpoint after S1.1 (done); S1.2 (revised) is the next detailed spec→plan.

## 6. Byte-preservation discipline (the non-negotiables)

- Drill marker/arrow ids stay `d{n}`/`a{n}` (id-prefix config).
- Drill kind tokens stay `pack-football.drill-diagram.{player|defender|keeper|cone|ball}` + `.arrow.{pass|run|dribble|shot}`.
- Clamp bounds stay 100×60 (from the drill frame).
- The drill editor's tools, keyboard map, and emitted shape are preserved (S1.3 proves it via the existing specs).
- Undo/redo semantics (snapshot-based, transient begin/commit) preserved.

## 7. Where it lives / promotion seam

`board-engine/` is pack-football-internal. The boundary kept clean for the north-star promotion: the engine + ops + store + render-config know **nothing** about drills or tactics (only `BoardGeometry` + a config). The drill/tactical specifics live in their render-configs + the S0 converters. At the 2nd consumer (tactical board in S3 is the same pack, so the real promotion trigger is a *different pack* or plan-tree viz), the engine extracts to design-system per ADR-176/168 — not in this sub-arc.

## 8. Risks

- **Byte-preservation under a model swap** (DrillDiagram→BoardGeometry→DrillDiagram round-trip + id-prefix) — the main risk; S0 round-trip guarantee + the existing drill specs are the guard; S1.3 is where it bites.
- **Render-config expressiveness** — the config must capture drill's exact rendering (dot glyphs, arrow dashes, zone) + tools. If it can't, the abstraction is wrong; S1.2 validates.
- **Edit-half generalization creep** — resist generalizing hit-testing/undo beyond drill's needs (substrate-architect's caution); keep interaction football-internal.
- **The store's snapshot undo on `BoardGeometry`** (larger objects than DrillDiagram) — negligible at board sizes.

## 9. Non-goals (S1)

- Tactical board on the engine (S3). Skins in the editor (S2). Persistence-port abstraction (S4). design-system promotion (post-epic). The render-config is football-internal, not the published render-definition contract.

## 10. Acceptance (S1 sub-arc)

The drill editor runs on the generic `board-engine` (ops + store + component on `BoardGeometry`), with drill specifics confined to a drill render-config + the S0 converters; the old `DrillBoardEditorComponent` is gone; all drill-board + bibliothek specs stay green; the engine has no drill/tactic knowledge. S1.1 (ops + store) ships first, independently green.
