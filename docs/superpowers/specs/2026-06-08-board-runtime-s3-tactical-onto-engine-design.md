# Board Runtime S3 — Rewire the Tactical Editor onto the Generic Engine — Design

> **Status:** approved (brainstorming) — S3 sub-arc of the board-runtime epic. Gets its own detailed spec→plan next.
> **Date:** 2026-06-08
> **Parent:** `2026-06-07-football-board-runtime-design.md` (epic, §11 slice S3) · `2026-06-07-board-runtime-s1-engine-design.md` (S1) · `2026-06-08-board-runtime-s2-skins-editor-design.md` (S2). S0–S2 shipped.

## 1. Goal

Bring pack-football's richest board surface — the Scene-5 `TacticalBoardComponent` (slot swap / substitute / set-captain / move-slot / draw-plays / snapshot, with undo + keyboard a11y) — onto the **generic board engine**, the same way S1.2 brought the drill editor onto it. The component moves off its bespoke `TacticalBoardStore` + `tactical-board-ops.ts` and onto the shared `BoardEditorStore` + `board-ops.ts` + the S0 `TacticalBinding` + converters, **behaviour byte-preserved**.

This makes the engine carry a **second real consumer** (drill + tactical) — the unlock that later justifies extracting the generic `BoardEditorComponent` (per ADR-176 promote-on-2nd-consumer) and converging onto one routed `/coach/board` (#214). S3 itself is **pure consolidation**: no new user-facing capability, no routed-board change, no component extraction.

## 2. Scope decisions (founder-confirmed)

- **Target = the Scene-5 `TacticalBoardComponent`** (the rich, unrouted editor), not the routed `CoachTacticalBoardComponent`. The routed-board convergence (mounting the engine-backed editor at `/coach/board`, retiring the dup) is **S4/S5**.
- **Rewire only — defer the generic `BoardEditorComponent`.** S3 shares the *store + ops + binding*, not a UI component. The component extraction (substrate-architect flagged the edit-half as the risky/unproven part) is a separate later slice once both consumers are stable.
- **Behaviour byte-preserved** — every gesture, undo/redo, transient drag, keyboard a11y, and the `boardChange` → `gestureToTreeEdit` → `metadata.visualEditor` persistence are identical.

## 3. The one real fork (Fork 1) — undo over the binding: extend the store with an optional `aux`

Today `TacticalBoardStore` snapshots the whole `TacticalBoard` (lineup + bench + captain + plays), so undo trivially covers both geometry **and** binding. The generic `BoardEditorStore` snapshots `BoardGeometry` **only** — but tactical's swap / substitute / set-captain are *binding* changes, not geometry. Three ways to keep them undoable were weighed:

1. **Extend `BoardEditorStore` to snapshot an optional `aux` payload** alongside `workingGeometry`. Drill passes none (byte-identical); tactical passes the `TacticalBinding`. Undo/transient restore the `{ geometry, aux }` pair. **Chosen.**
2. **Keep a separate tactical store** snapshotting `{ geometry, binding }` — no shared-store change, but it leaves a second near-identical snapshot machine. **Rejected** (no real consolidation — defeats "rewire onto the engine").
3. **Fold the binding into `marker.metadata`** so geometry is the single source of truth — **rejected**: breaks the S0 geometry/binding split, and bench players have no on-pitch marker to ride.

**Rationale (Approach 1):** `BoardEditorStore` and `TacticalBoardStore` are the *same generic snapshot machine* over different state types — exactly the duplication the engine exists to remove. The engine's contract becomes "version the editable board state = geometry + an opaque domain sidecar." Drill's sidecar is empty (provably unchanged); tactical's is the binding. This generalizes the **engine** (additive, low-risk), which is distinct from the **component** extraction that was deferred, and it is required for behaviour preservation — not speculative.

## 4. Architecture — what moves where

### 4.1 Engine — `board-editor.store.ts`
Add an optional `workingAux` signal that `begin` / `apply` / `beginTransient` / `updateTransient` / `commitTransient` / `cancelTransient` / `undo` / `redo` snapshot **alongside** `workingGeometry`. The undo/redo stacks store `{ geometry, aux }` pairs. Drill call-sites (`begin(g)` / `apply(g)`) keep working with `aux` defaulting to `undefined` — byte-identical behaviour. Tactical call-sites pass the binding as the second argument.

### 4.2 New pure module — `tactical-binding-ops.ts`
Each tactical gesture becomes a pure `(geometry, binding) → { geometry, binding }` transform:
- **Geometry gestures** delegate to `board-ops`: `move-slot` → `moveMarker`; `draw-play` (run/pass) → `addArrow`; `draw-play` (zone) → `addZone`; `clear-play` → `removeArrow` / `removeZone`.
- **Binding gestures** mutate the `TacticalBinding`: `swap` → exchange two slots' `playerId`; `substitute` → reassign a slot's `playerId` + update bench (preserving the freed-bench-id convention `tactical-board-event-ops.ts` relies on); `set-captain` → set `captainSlotId`.
- `snapshot-formation` stays a structural/persistence gesture surfaced via `boardChange` (host-side), unchanged.

Correctness is proven by round-tripping through the S0 converters (`tacticalBoardToBoardGeometry` ⟷ `boardGeometryToTacticalBoard`).

### 4.3 `TacticalBoardComponent` rewire
- **Load:** `tacticalBoardToBoardGeometry(board) → { geometry, binding }` → `store.begin(geometry, binding)`.
- **Template:** reads a `board() = boardGeometryToTacticalBoard(workingGeometry(), workingAux())` computed — the exact `working()`-helper trick S1.2 used for the drill editor, so the template **and** the white-box `store.board()` test reads migrate 1:1 (no template change, no test weakening).
- **Gestures:** call `tactical-binding-ops` → `store.apply(geometry, binding)` (or the transient methods for drag).
- **Emit / persist:** the `boardChange` gesture output + the `gestureToTreeEdit` → `metadata.visualEditor` path are **unchanged** (compose the `TacticalBoard` at the boundary exactly as today).
- Selection / tool / draw-tool toggles use the engine's existing `selection` / `tool` signals.

### 4.4 The 100×120 frame
No engine change: `board-ops` already clamps from `geometry.frame` and `BoardGeometry.frame` is declared (drill 100×60, tactical 100×120). S3 adds a tactical-frame `board-ops` clamp test to lock this in; the `<db-pitch frame="full">` render is untouched.

### 4.5 Dead code
After 4.3, `TacticalBoardStore` and the geometry parts of `tactical-board-ops.ts` are unused by the component. Retire them **if** nothing else references them (check `EMPTY_BOARD`, `substitutionRequestFromGesture`, and any spec imports); otherwise leave a note and retire in S5.

## 5. Scope, non-goals, acceptance

**In scope:** the tactical editor on the shared `BoardEditorStore` (+ optional `aux`) + `board-ops` + `tactical-binding-ops` + S0 converters; the tactical-frame clamp test; dead-code retirement when clean. Behaviour, a11y, and persistence byte-preserved.

**Non-goals (explicit, founder-confirmed):**
- No generic `BoardEditorComponent` / render-config extraction (deferred).
- No routed `/coach/board` change; `CoachTacticalBoardComponent` untouched.
- No formation-template system — the `formationKey`-ignored-for-geometry limitation stays as-is.
- No new draw-play / skin / capability features (tactical skins arrive when the routed board converges later).

**Acceptance:**
- The Scene-5 editor behaves identically — every gesture (swap, substitute, set-captain, move-slot, draw-play, clear-play, snapshot), undo/redo, transient drag, and keyboard a11y — while running on the shared engine.
- `boardChange` emits the same gesture vocabulary; the `metadata.visualEditor` persistence is unchanged.
- The tactical editor's ~65 specs stay green (white-box `board()` reads migrated 1:1, no weakening); the **full drill suite stays green** (engine `aux` is additive).
- The engine now has two real consumers (drill + tactical) on `BoardEditorStore` + `board-ops`.

## 6. Risks & mitigations

- **Drill regression from the shared-store change** — the `aux` extension touches the store drill uses. *Mitigation:* `aux` is optional and defaults to `undefined`; drill call-sites and snapshots are byte-identical; the full drill suite gates each step (S3.1 ships with drill green before tactical is touched).
- **Tactical behaviour drift during the rewire** — the editor is intricate (debounced gestures, transient drag, keyboard move-item). *Mitigation:* byte-preserve via the `board()` computed-helper (S1.2 precedent); keep all ~65 specs green with no assertion edits except the mechanical `store.board()` → `board()` read migration.
- **Binding/geometry round-trip lossiness** — the converters must compose back to an identical `TacticalBoard`. *Mitigation:* S3.2 adds round-trip property tests over every gesture before the component is rewired (S3.3).
- **Hidden coupling to `TacticalBoardStore`/`tactical-board-ops`** — other code may import them. *Mitigation:* grep before retiring (4.5); defer to S5 if not cleanly dead.

## 7. Decomposition (sketch — detailed in the plan)

Each step ships green; tactical + drill specs stay green throughout.

- **S3.1** — `BoardEditorStore` optional `aux` snapshot (pure engine + tests; drill untouched) + a tactical-100×120 `board-ops` clamp test.
- **S3.2** — pure `tactical-binding-ops.ts` (gesture → `{ geometry, binding }` transforms via `board-ops`), unit + S0-converter round-trip tests.
- **S3.3** — rewire `TacticalBoardComponent` internals onto the store + binding-ops + converters; byte-preserve the ~65 specs; `boardChange` + persistence identical.
- **S3.4** — retire the now-dead `TacticalBoardStore` (+ dead `tactical-board-ops` parts) if cleanly unreferenced; else note for S5.

(Exact step boundaries are the writing-plans skill's job; this is the design.)
