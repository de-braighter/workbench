# Football Board Runtime — Architecture & Slice Ladder (epic design)

> **Status:** approved (brainstorming) — epic concept. S0 (+S1) get their own detailed spec→plan next; S2–S5 each get a spec→plan when reached.
> **Date:** 2026-06-07
> **Relates to:** exercir#214 (two-board reconciliation — this is its resolution), ADR-160 (Scene 5 visual editor), ADR-177 (SVG canonical), drill-board-skins (exercir#211), the #129 tactical-board contract promotion, ADR-176 (kernel minimality — the "minimal core, specialize in adapters" shape applied at pack-UI level).
>
> **Re-founded 2026-06-07 (north-star):** this epic is the **first consumer** of a generic *substrate-tree renderer + render-definition registry* — see [2026-06-07-substrate-tree-renderer-north-star.md](2026-06-07-substrate-tree-renderer-north-star.md). Per ADR-176 demand-driven promotion, we build the runtime in pack-football now and promote the *generic* renderer to design-system/substrate only at the **2nd consumer** (plan-tree viz / another pack). The §10 "where it lives" boundary is the extraction seam — keep it clean. substrate-architect verdict: the render-definition's **draw-half** likely promotes; the **edit-half** (heterogeneous undo, per-kind hit-testing) is the ambitious/unproven part that may stay per-pack (a read-only render-tree *viewer* is the safe consumer-#2 fallback). `BoardGeometry` (S0) is football's render-tree instance — a flat presentation tree of render-nodes.

## 1. Problem

pack-football has **three board surfaces that grew up separately** and duplicate each other, sharing only low-level primitives:

| Layer | Drill board | Tactical editor #1 | Coach matchday #2 |
|---|---|---|---|
| Component | `DrillBoardEditorComponent` | `TacticalBoardComponent` | `CoachTacticalBoardComponent` |
| Model | `DrillDiagram` (dots/arrows/zone) | `TacticalBoard` (slots/bench/captain/plays) | view-only `TacticalBoardView` |
| Edit runtime | `DrillEditorStore` | `TacticalBoardStore` (a mirror of it) | none (read-only) |
| Frame | **100×60** (horizontal) | **100×120** (vertical) | 100×120 |
| Renderer | bare SVG + `pitchGeometry()` | `<db-pitch>` + SVG overlay | `<db-pitch>` + SVG overlay |
| Skins | **4** (schematic/matchday/telestrator/arena) — read-only scene only | none | none |
| Persistence | drill catalog (repo) | plan-tree `metadata.visualEditor` | match events (SSE) |

The tell: **two undo/redo runtimes (`DrillEditorStore`, `TacticalBoardStore`) that explicitly mirror each other** — duplication wearing the costume of reuse. Same fragmentation across frames, models, layout families, and persistence.

**Founder decisions (2026-06-07):**

- #214 resolves R1: the routed `/coach/board` matchday surface is the canonical board; the others fold in.
- **Build the unified board UP FROM the drill editor** — it is the most sophisticated engine (drag/draw/zones/skins/undo), so it is the thing to generalize *from*.
- The goal is a **board runtime that handles boards of any kind** — not a one-off feature carry-over.

## 2. Decision — Approach B: geometry core + binding overlay

Rejected alternatives:

- **A (one superset `Board` model)** — tactical-only fields (`lineup`/`captain`/`formation`) optional and null for drills; the runtime branches on slot-bound-vs-freeform. A fat half-null model, and the engine carries domain knowledge it mostly ignores.
- **C (shared engine, separate models)** — unify only the editor engine via adapters; each board keeps its own model + persistence. Kills the duplicated engine but **not** a true "any board kind" model — falls short of the runtime goal.

**Chosen — B.** The runtime + model are **pure geometry** (markers/arrows/zones in a declared frame); the engine never knows what a squad or formation is. "Tactical-ness" (roster binding, formation slots, captain, plays semantics, match-events) lives in a thin **binding adapter** layered on top. Frame, marker-palette, skin, and **persistence** are per-kind config. This isolates the freeform-vs-roster semantic gap in *one* adapter instead of smearing it through the model, matches the kernel/pack split used elsewhere (ADR-176 minimal-core), and the drill board is *already* the pure-geometry core — so we generalize it in place.

## 3. Layered architecture

```
Board-kind descriptor ── { frame, palette, skin, binding?, persistencePort, versioning? }
  • DrillBoardKind     100×60,  drill palette,  no binding,    catalog port
  • TacticalBoardKind  100×120, jersey palette, roster binding, plan-tree port + versions

Binding overlay (per-kind, OPTIONAL) ── interprets geometry as domain
  • drill:    none (markers are freeform dots: player/cone/ball/keeper)
  • tactical: markers ↔ formation slots + roster players + captain; arrows/zones = "plays";
              bridges tactical commands (substitute / set-captain / change-formation)
              to geometry ops + the match-event port (MatchDayClient)

Render + skin layer ── generic SVG over BoardGeometry + a BoardSkin
  • one renderer; skins lifted to engine level + wired into the EDITOR (today drill scene only)

Edit runtime (the engine) ── ONE store, replacing the two mirrored ones
  • tool state · undo/redo · pointer drag · two-click arrows · zone draw · delete · keyboard nudge
  • WCAG 2.5.7 (no drag-only) / 2.1.1 (keyboard) / 2.5.8 (24px targets) preserved
  • emits committed geometry mutations

Geometry model (pure core) ── the unified data
  BoardGeometry { frame:{w,h}; markers:Marker[]; arrows:Arrow[]; zones:Zone[] }
    Marker { id, x, y, kind, label? }
    Arrow  { id, kind, points:[{x,y}…] }
    Zone   { id, x, y, w, h }
```

## 4. The unified geometry model

```ts
interface BoardFrame { width: number; height: number; } // 100×60 (drill) or 100×120 (tactical)

interface BoardMarker {
  id: string;
  x: number; y: number;          // in the frame
  kind: string;                  // palette-scoped token (e.g. 'drill.player', 'tactical.slot')
  label?: string;                // jersey/position label (drill: optional; tactical binding fills it)
}
interface BoardPoint { x: number; y: number; }
interface BoardArrow {
  id: string;
  kind: string;                  // 'pass' | 'run' | 'dribble' | 'shot' (palette-scoped)
  points: readonly BoardPoint[]; // ≥2 (drill arrows = exactly 2; tactical plays = polyline)
}
interface BoardZone { id: string; x: number; y: number; w: number; h: number; }

interface BoardGeometry {
  frame: BoardFrame;
  markers: readonly BoardMarker[];
  arrows: readonly BoardArrow[];
  zones: readonly BoardZone[];   // plural (drill had single zone; tactical plays had many)
}
```

**Reconciliation decisions (forced by the 3-way matrix):**

- **`zones[]` plural** + **arrows as `points[]`** — supersets covering drill (single zone, 2-pt arrows) and tactical-plays (multi zone, polylines).
- **Frame is *declared* data, not hardcoded** — resolves the 100×60-vs-100×120 mismatch; engine + renderer are frame-agnostic; the renderer picks `<db-pitch>` orientation from `frame`.
- **`kind` is a palette-scoped string token** — per-kind palettes enumerate valid marker/arrow kinds (drill: player/defender/keeper/cone/ball + pass/run/dribble/shot; tactical: slot + pass/run + zone). Literal-union ratchet later (north-star §20 P5).
- Existing `DrillDiagram` and `TacticalBoard` schemas stay as the **wire/persistence shapes**; pure converters bridge them to/from `BoardGeometry` (no breaking change to either persisted shape in early slices).

## 5. Board-kind descriptor

```ts
interface BoardKind {
  id: 'drill' | 'tactical';
  frame: BoardFrame;
  palette: BoardPalette;             // valid marker/arrow kinds + which tools are enabled
  defaultSkin: BoardSkinName;
  allowedSkins: readonly BoardSkinName[];
  binding?: BoardBinding;            // present for tactical; absent for drill
  persistencePort: BoardPersistencePort;
  versioning?: boolean;             // tactical: true (snapshots)
}
```

## 6. Binding overlay

A `BoardBinding` interprets geometry as domain meaning for a kind. **Drill has none.** The **tactical binding**:

- maps each `BoardMarker` (kind `tactical.slot`) to a formation slot + a roster player (jersey#/name/position label) + the captain flag; supplies a **formation-template** (formationKey → 11 slot positions in the 100×120 frame — replaces the hardcoded 4-3-3 layout);
- treats `arrows`/`zones` as "plays";
- bridges tactical-only commands to the match-event port: a `substitute`/`set-captain`/`change-formation` action becomes (geometry op) + (a `MatchDayClient` / event call, reusing the #129 `SubstitutionMade.v1` path). The engine stays event-ignorant; the binding owns the bridge.

This is where every roster/formation/squad concept lives — the engine and geometry model remain domain-free.

## 7. Render + skin layer

- One generic SVG renderer over `BoardGeometry` + a resolved `BoardSkin`.
- The skin system (schematic/matchday/telestrator/arena — exercir#211) is **lifted from drill-scene-only to engine-level** and wired into the **editor** (currently only the read-only `DrillBoardSceneComponent` uses skins). A skin picker becomes available on any board kind via `allowedSkins`.
- Skin descriptor generalizes to the unified marker/arrow kinds.
- Pitch rendering unifies on `<db-pitch>` (ADR-177 SVG canonical); the drill board's bespoke `pitchGeometry()` is reconciled against the brick (the brick gains frame-orientation if needed, or `pitchGeometry()` becomes the brick's internal).

## 8. Edit runtime (the engine)

One store replacing `DrillEditorStore` + `TacticalBoardStore`:

- tool state (select / add-marker / draw-arrow / draw-zone / move), undo/redo (transient-begin/commit cycle), pointer drag, two-click arrow placement, zone draw, delete, keyboard nudge.
- WCAG preserved: **2.5.7** (every drag has a no-drag alternative — two-click), **2.1.1** (full keyboard), **2.5.8** (24px hit-targets via transparent hit-strokes).
- emits committed `BoardGeometry` mutations; host wires persistence via the port.

## 9. Persistence port

```ts
interface BoardPersistencePort {
  load(): Promise<BoardGeometry>;
  save(next: BoardGeometry): Promise<void>;
  listVersions?(): Promise<BoardVersionRef[]>;   // tactical
  loadVersion?(ref: BoardVersionRef): Promise<BoardGeometry>;
}
```

- **drill** → catalog (`saveDrillDiagram` / `UpdateDrillDiagramService`), via `DrillDiagram⇄BoardGeometry` converter.
- **tactical** → plan-tree `metadata.visualEditor` via `gestureToTreeEdit` metadata-patch (#129 path) + **snapshot subtree nodes** for version-navigation (the founder's "navigate through versions"), via `TacticalBoard⇄BoardGeometry` converter.

## 10. Where it lives

Build the engine + model in `pack-football-ui` / `pack-football-contracts` first (co-located with the boards being unified). Keep the *generic* engine/model/renderer/skin boundary clean so it can **promote to a `design-system` brick** when a 2nd pack needs boards (promote-on-2nd-consumer, ADR-176). Football-specific `BoardKind`s (drill/tactical bindings + persistence) always stay in pack-football. **Promotion is not in this epic.**

## 11. Slice ladder

- **S0 — Contracts foundation.** Author `BoardGeometry` + `BoardKind`/`BoardBinding`/`BoardPersistencePort` contracts (Zod where wire-bound) in `pack-football-contracts`; pure converters `DrillDiagram⇄BoardGeometry` and `TacticalBoard⇄BoardGeometry`, fully unit-tested. **No behaviour change** — types + adapters only. *(First detailed spec→plan.)*
- **S1 — Engine extraction, proven on drills.** Extract the generic edit runtime (engine + single undo store + interaction) + the generic renderer from the drill editor; re-express `DrillBoardEditorComponent` as a thin `BoardKind=drill` over the engine. Drill behaviour byte-preserved (specs stay green). *Proves the engine on the most sophisticated board.*
- **S2 — Skins to engine + editor.** Lift skins to engine level; wire into the editor; add a skin picker. Drill editor gains live skins.
- **S3 — Binding + tactical frame.** Add the tactical binding overlay (roster/formation/captain + formation-template geometry) + the 100×120 frame; bring the coach matchday board onto the engine as `BoardKind=tactical` — gains **draw-plays + skins + undo** (the original "add a pass", delivered via the runtime).
- **S4 — Persistence port + versioning.** Abstract the port; tactical→plan-tree metadata + snapshots/**version-navigation**; drill→catalog.
- **S5 — Collapse duplicates.** Retire `TacticalBoardComponent` (Board #1); fold `CoachTacticalBoardComponent` onto the runtime; single routed `/coach/board`; close #214; remove the local dev-preview route added for the visual comparison.

## 12. Risks & mitigations

- **Semantic gap (freeform vs roster-bound)** — isolated entirely in the tactical binding adapter; the engine/model never branch on it. ✅ by design.
- **Frame dualism (100×60 vs 100×120)** — `frame` is declared data; engine/renderer are frame-agnostic. ✅
- **Formation-template geometry** — tactical slots need a formationKey→positions map (today the 4-3-3 layout is hand-coded; other formations don't move geometry). S3 must build the template system. ⚠️ real work.
- **Persistence dualism** — absorbed by the port; two adapters, one engine. ✅
- **Migration safety** — each slice keeps the affected board's specs green; S1 byte-preserves drill behaviour, S3 preserves coach-board behaviour while adding. The two boards never break mid-ladder.
- **Skin/editor wiring** — skins were never in an editor (only read-only scene); S2 must handle live re-render + a11y of the skin picker.

## 13. Non-goals (this epic)

- Promotion to `design-system` (later, on 2nd-pack demand).
- New board kinds beyond drill + tactical.
- Server-side validation of geometry beyond what each persistence path already does.
- Re-skinning the drill *read-only* scene (already done in #211).

## 14. Acceptance (epic-level)

The epic is done when: one engine + one geometry model + one renderer power both the drill board and the coach matchday board; skins work in the editor on both; the tactical board has draw-plays + undo + version-navigation; `TacticalBoardComponent` is retired; `/coach/board` is the single tactical surface; the two mirrored undo stores are one. Each slice ships independently green.
