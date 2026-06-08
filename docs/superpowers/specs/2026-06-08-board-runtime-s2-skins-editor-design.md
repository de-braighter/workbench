# Board Runtime S2 — Skins into the Drill Editor (persisted, picker) — Design

> **Status:** approved (brainstorming) — S2 sub-arc of the board-runtime epic. Gets its own detailed spec→plan next.
> **Date:** 2026-06-08
> **Parent:** `2026-06-07-football-board-runtime-design.md` (epic, §11 slice S2) · `2026-06-07-board-runtime-s1-engine-design.md` (S1, shipped #219/#220). S1 (engine, proven on drills) complete.

## 1. Goal

Close the **editor/scene skin asymmetry**: today the read-only `DrillBoardSceneComponent` renders all four skins (grass / stripes / glow / jersey-glyphs / auto-numbers / rich markers / legend), while the editable `DrillBoardEditorComponent` shows only a hardcoded schematic skeleton. S2 brings the editor to **skin-parity**, adds a **skin picker** in the editor toolbar, and **persists the chosen skin per drill** so the Drill Library renders each drill in its own skin instead of a hardwired `matchday`.

This delivers the epic's "drill editor gains live skins" and is the lower-risk rehearsal of the live-re-render + picker-a11y problems that S3's tactical board will inherit.

## 2. What S1 already established (and what stays put)

- The board **engine** (`board-ops.ts` + `BoardEditorStore`, `libs/pack-football-ui/src/lib/board-engine/`) operates on `BoardGeometry` and is **skin-agnostic**. **S2 does not touch the engine.** A skin is a pure render-time mapping from `kind → style`; it is not engine state (it fails the "is this part of geometry/selection/undo?" test). This preserves the S1 boundary.
- The drill surface already converts `DrillDiagram ⇄ BoardGeometry` at load/save and keeps its own catalog persistence. S2 rides those existing seams.

## 3. The render-reuse decision (Fork 1) — shared pure helpers, defer the generic component to S3

The scene's skin render is battle-tested; the editor's is absent. Three ways to close the gap were weighed:

1. **Duplicate** the scene's skin SVG into the editor template — fastest, but forks the render into two drifting templates. **Rejected.**
2. **Extract the pure skin-styling helpers** into a shared module that both scene and editor import; each keeps its own template but single-sources the *logic*. **Chosen.**
3. **Compose** the scene as a read-only background under an interaction overlay — most DRY for chrome, but interactive markers must be drawn by the editor anyway (so glyphs still duplicate) and it forces a surface/full scene split, which is really S3's generic-renderer extraction pulled early. **Rejected.**

**Rationale (Approach 2):** drill is currently the *only* consumer of skins. Extracting a fully generic `BoardRenderer` component now would be speculative (ADR-176 spirit / promote-on-2nd-consumer). S2 single-sources only the *pure functions* (cheap, safe, no premature abstraction); **S3** — when the tactical board arrives as consumer #2 — extracts the generic component with two real consumers in hand.

**Shared module** (e.g. `libs/pack-football-ui/src/lib/generation/drill-board-render.ts`, building on what already exists in `drill-board-skins.ts` + the scene): `resolveSkin(name)`, surface-style values (grass colour, stripe bands, line colour/opacity), marker-glyph selection (`kind → circle | jersey | cone | ball`), filter-URL resolution (glow / rich-marker shadow), legend rows, and the numbers-aware layout option. The scene is refactored to consume these (behaviour byte-preserved); the editor consumes the same set + adds the skin chrome (`<rect>` grass, stripe bands, `<filter>` defs, jersey/number glyphs) to its template, with interaction handles layered on top.

## 4. Data model & flow

### 4.1 Skin name is a contract enum (Fork 2 — set in contracts, look in UI)

- `pack-football-contracts`: add `DrillBoardSkinSchema = z.enum(['schematic','matchday','telestrator','arena'])` + `export type DrillBoardSkinName = z.infer<…>`. The contract owns the **closed set** (wire-validatable).
- `pack-football-ui` `drill-board-skins.ts`: imports the *type* and maps each name to its visual `DrillBoardSkin` definition. The UI owns the **look**. Single source of truth for the set; no drift between the validated wire enum and the render union.

### 4.2 Skin lives on the catalog entry, not the diagram

- A drill is an `Intervention` with `subCatalog === 'drill'`; its `metadata` is a Zod `.passthrough()` object already carrying `name`/`phase`/`intensity`/`description`/`diagram`/`requirements`. Add `skin?: DrillBoardSkinName` there.
- **No DB migration:** drill persistence is in-memory maps today (`ManifestInterventionCatalogRepository`); the metadata passthrough carries the field exactly as the diagram override does. Geometry (`DrillDiagram`, schema-versioned `v1`) is untouched — skin is display policy, orthogonal to geometry.

### 4.3 One save persists geometry + skin

- The editor authors the diagram via the existing `PUT /pack-football/drills/:key/diagram` path (separate from the create form). **Widen that request to `{ diagram, skin }`** — "save this drill scene" persists both. The **create form is untouched** (no skin field there).
- **Default = `matchday`.** Drills with no saved skin fall back to `matchday` everywhere (`entry.skin ?? 'matchday'`), so today's Library appearance is **byte-identical**. New drills open in `matchday`; the coach can switch.
- **Save-time = save-skin (confirmed):** the dropdown *is* the drill's persisted skin. Switching to `schematic` for precise editing and saving persists `schematic`. Simple "what you see is what's saved" model; an "editing view vs saved skin" separation is an explicit non-goal (deferred).

### 4.4 Layers a `skin` value threads through

1. `pack-football-contracts` — `DrillBoardSkinSchema`/`DrillBoardSkinName`; add `skin?` to the diagram-update request schema.
2. `pack-football` — `InterventionSchema.metadata.skin?`; `updateDrillDiagram` use-case + repository accept & store `skin`.
3. `pack-football-api` — `DrillWire.skin`; `toWire()` mapping; the diagram-`PUT` handler reads `skin`.
4. `pack-football-ui` client — `DrillCatalogEntry.skin`; the update call sends `skin`.
5. `drill-bibliothek.component.ts` (the `skin="matchday"` site) — `[skin]="entry.skin ?? 'matchday'"`.
6. `drill-board-editor.component.ts` — `skin` signal, toolbar dropdown, skinned render via the shared helpers, `skin` in the save payload; opens at the drill's saved skin (else `matchday`).

## 5. Picker UX & accessibility

- A labelled `<select>` ("Skin") in the editor toolbar; `change` updates a `skin` signal → live re-render via the shared helpers.
- A polite live-region announces the change (e.g. "Skin: Matchday"), reusing the existing `lib-fc-status-live` idiom.
- **Per-skin SR-number gating** (the #211 lesson): a marker's screen-reader text announces a number *only* when the active skin has `dot[kind].number`. Schematic must **not** leak "player 7". This gate must hold in the editor, not only the scene — gate it at the skin boundary, not in the shared layout.
- Skin changes during a transient drag/draw must not corrupt the in-flight stroke: the `skin` signal is render-only and independent of the engine's transient state, so a mid-drag switch simply re-renders; no engine guard needed (covered by a test).
- i18n: add `board.skin.{schematic,matchday,telestrator,arena}` + `board.skinPicker.label` to the de/en catalogs + the TS map + the parity spec (German source-of-truth idiom).

## 6. Scope, non-goals, acceptance

**In scope:** editor skin render at parity with the scene; toolbar dropdown + live a11y; persist `{diagram, skin}` round-trip (in-memory repo + wire); Library renders `entry.skin` with `matchday` fallback; shared skin-helper extraction (scene refactored onto it, byte-preserved); i18n.

**Non-goals (explicit):**
- No generic `BoardEditorComponent`/`BoardRenderer` extraction — that is **S3** (with tactical as consumer #2).
- No Prisma/DB — persistence stays in-memory.
- No skin field on the create form.
- Nothing tactical (S3); no persistence-port/versioning abstraction (S4).

**Acceptance:**
- The editor renders each of the four skins at visual parity with the scene (grass / stripes / glow / glyphs / numbers / legend), live on dropdown change.
- Per-skin SR-number gating holds in the editor (no number announced under `schematic`).
- A drill saved with a non-default skin reloads in that skin (editor) and renders in that skin in the Library; drills with no saved skin render `matchday` (Library byte-identical to today).
- **Existing drill specs stay green** — geometry, interaction, undo/redo, and the schematic path are byte-preserved; the scene refactor onto shared helpers changes no scene output.

## 7. Risks & mitigations

- **Scene refactor regresses read-only output** — the scene already ships; refactoring it onto shared helpers risks pixel/SR drift. *Mitigation:* keep existing scene specs green and add a render-snapshot/DOM assertion per skin before refactoring; the helpers must return values identical to today's inline logic.
- **Editor template density** — grass/stripes/glow/glyph conditionals plus interaction handles can bloat the template. *Mitigation:* push the pure decisions into helpers (Approach 2) so the template stays declarative; do **not** pre-extract a component (S3).
- **Wire-enum drift** — the validated skin set and the UI render union must agree. *Mitigation:* single source in contracts (§4.1); the UI derives its type from it.
- **a11y leak under non-numbering skins** — recurred in #211. *Mitigation:* the SR-number gate is asserted by test for both numbering and non-numbering skins, in the editor specifically.

## 8. Decomposition (sketch — detailed in the plan)

Each step ships green; existing drill + scene specs stay green throughout.

- **S2.1** — contract enum + metadata field + wire/repository/client threading (no UI behaviour change yet); update path carries `skin`; Library reads `entry.skin ?? 'matchday'`.
- **S2.2** — extract the shared skin-render helpers; refactor the scene onto them (output byte-preserved).
- **S2.3** — bring the editor render to skin-parity using the helpers; default to the drill's saved skin.
- **S2.4** — the toolbar dropdown + live a11y + per-skin SR-number gating + i18n; wire skin into the save payload.

(Exact step boundaries are the writing-plans skill's job; this is the design.)
