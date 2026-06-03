# Scene 5 — Tactical Board v2 Design

- **Date:** 2026-06-03
- **Status:** design (brainstormed; pending implementation plan)
- **Supersedes:** `2026-05-26-tactical-board-scene5-design.md` (open questions now resolved)
- **Domain:** `de-braighter/domains/exercir` (`pack-football-ui`, `pack-football-api`, `pack-football-contracts`) **and** `de-braighter/layers/design-system` (`@de-braighter/design-system-angular`)
- **Trackers:** [exercir#93](https://github.com/de-braighter/exercir/issues/93) (epic), [#125](https://github.com/de-braighter/exercir/issues/125) (converge), [#126](https://github.com/de-braighter/exercir/issues/126) (promote pitch), [#127](https://github.com/de-braighter/exercir/issues/127) (create-play WCAG), [#128](https://github.com/de-braighter/exercir/issues/128) (tokens + contrast), [#129](https://github.com/de-braighter/exercir/issues/129) (host wiring)
- **Governing ADRs:** ADR-160 (Scene 5 — amended by this design), ADR-138 (visual-editor four-layer), ADR-162 (SSE live-telemetry), ADR-168 (design-system bricks), ADR-161 (domain events)

---

## 1. Summary

Deliver the **live match-day tactical board** (ADR-160 Scene 5): a full-pitch 100×120 authoring surface where the coach substitutes, adjusts formation, draws play annotations, and captures per-minute snapshots during a live match. Two separate boards — one authoring-optimistic, one SSE-reconciled live view — share a single enhanced `<db-pitch>` SVG brick from the design-system. Closes issues #125–#129 in a 4-PR cross-repo sequence.

---

## 2. Decisions (resolved in 2026-06-03 brainstorm)

| # | Decision | Choice | Rationale |
|---|---|---|---|
| D1 | Renderer | **SVG** (overrides 2026-05-22 Konva amendment in ADR-160) | All three existing pitch implementations are SVG and work in jsdom; Konva costs (canvas dep, jsdom test overhead) don't pay off at v1 scale (11 players, single-editor) |
| D2 | Pitch primitive | **Enhance `<db-pitch>` with `coordinateFrame` prop** (no new brick) | Two near-identical bricks in the same package would be confusing to maintain; `coordinateFrame` is additive and non-breaking |
| D3 | Component convergence | **Shared renderer, separate components** — no merge | `TacticalBoardComponent` (optimistic undo-redo) and `CoachTacticalBoardComponent` (SSE append-only reconciliation) have genuinely different data lifecycles; forcing one state machine is complexity without benefit |
| D4 | Brick location | **Promote `<db-pitch>` enhancement to `layers/design-system`** (cross-repo) | Long-term correct home; `<db-pitch>` already lives there |
| D5 | Create-play UX | **Toolbar + click-to-place + keyboard flow** (both WCAG 2.5.7 + 2.1.1) | Matches the drill-board pattern already established; `addPlay` op already written |

---

## 3. Architecture

```
layers/design-system
  @de-braighter/design-system-angular
    <db-pitch coordinateFrame="mini"|"full">   ← enhanced brick (SVG, field chrome only)
      + --db-pitch-surface / --db-pitch-line
      + --db-pitch-chip-bg / --db-pitch-chip-text tokens

domains/exercir
  pack-football-contracts
    TacticalBoardView, BoardSlot, BenchPlayer  ← promoted from pack-football-ui

  pack-football-ui
    TacticalBoardComponent                     ← authoring board (optimistic store, gesture vocab)
      consumes <db-pitch coordinateFrame="full">
    CoachTacticalBoardComponent                ← live SSE board (unchanged structurally)
      already consumes <db-pitch>; picks up new tokens via version bump

  apps/pack-football-visual-editor
    MatchDayScene5PageComponent                ← new host page
      mounts TacticalBoardComponent
      wires boardChange → gestureToTreeEdit → ApplyPlanTreeEditUseCase
      publishes LineupChangedV1 on substitute
```

**Field chrome vs overlays:** `<db-pitch>` renders field geometry only (touchlines, halfway line, penalty areas, goals, centre circle). Player slot chips and play annotations are children — absolutely positioned or SVG group overlays from the consuming component. No overlay slots in the brick itself.

---

## 4. PR sequence

### PR-1 · design-system — `<db-pitch>` coordinateFrame + tokens

**`coordinateFrame` prop** (default `'mini'` — non-breaking):

- `'mini'` → viewBox `0 0 100 60`: half-pitch, goal at top, 16m/6m boxes, penalty spot. Current behaviour unchanged.
- `'full'` → viewBox `0 0 100 120`: full pitch, halfway line at y=60, both penalty areas, both goals, centre circle. Same element set, mirrored.

**New color tokens in `colors_and_type.css`:**

| Token | Value | Role | Contrast vs white |
|---|---|---|---|
| `--db-pitch-surface` | `#2d5a1b` | Grass fill | — |
| `--db-pitch-line` | `#ffffff` | Field markings | — |
| `--db-pitch-chip-bg` | `#1a3a0f` | Player chip background | ~12:1 (AAA) |
| `--db-pitch-chip-text` | `#ffffff` | Player chip label | ~12:1 (AAA) |

**Contrast-guard unit test:** asserts `--db-pitch-chip-text` on `--db-pitch-chip-bg` ≥ 4.5:1 programmatically so a future token change fails CI before it ships.

**Tests:** `<db-pitch>` spec adds cases for `coordinateFrame="full"` — SVG dimensions, presence of centre-circle and both goal elements. Existing `coordinateFrame="mini"` tests unchanged.

---

### PR-2 · exercir — ADR-160 amendment + board migration

**Specs repo PR (in parallel):** Short ADR-160 amendment superseding the Konva note, recording D1–D3.

**`TacticalBoardComponent` migration:**
- Inline SVG field chrome deleted; `<db-pitch coordinateFrame="full">` inserted.
- Slot chips and play annotations remain as absolutely-positioned children over the brick.
- `tactical-board-layout.ts` (which computes slot x/y on 100×120) is the canonical layout helper. Any geometry duplicated in the coach board's layout helpers is consolidated here; both boards import from one source.

**`CoachTacticalBoardComponent`:** No structural change. Picks up new color tokens via design-system version bump.

**Type export discipline:** Re-export `TacticalBoardView` etc. from `pack-football-ui` index for consumers not yet on the new contracts package path — no breakage.

---

### PR-3 · exercir — Scene 5 host wiring

**`MatchDayScene5PageComponent`** in `apps/pack-football-visual-editor`:
- Route params: `matchNodeId`, `treeRootId`
- Load: reads `plan_node.metadata.visualEditor` via existing plan-tree read use-case → hydrates `TacticalBoardView`
- `boardChange` pipeline:
  ```
  gesture → gestureToTreeEdit(gesture, treeRootId)   ← route treeRootId (fixes seam)
           → ApplyPlanTreeEditUseCase.applyEdit(treeRootId, edit)
  substitute gesture → also publish LineupChangedV1 to SSE event log
  ```
- Errors: `tree-not-found` / `invalid-input` surface as inline `LoadState` signal (standard pattern)

**Type promotion to `@de-braighter/pack-football-contracts`:**
- `TacticalBoardView`, `BoardSlot`, `BenchPlayer` move from `pack-football-ui` to `pack-football-contracts`
- Server-side plan-tree controller can deserialize metadata without pulling Angular bundle
- Old imports in `pack-football-ui` become re-exports — no consumer breakage

**v1 gesture vocabulary** (what works after PR-3):
- swap-slot, substitute, set-captain, move-slot — all wired to `ApplyPlanTreeEdit`
- draw-play, clear-play, snapshot-formation — **deferred to PR-4 / follow-up** respectively

**`LineupChangedV1` (ADR-161):** On substitute, host publishes event to in-memory SSE event log. Live coach board reconciles on receipt — no page refresh required.

---

### PR-4 · exercir — Create-play affordance (WCAG 2.5.7 + 2.1.1)

**Toolbar extension:** Three new toolbar buttons: `draw-run`, `draw-pass`, `draw-zone`. Selecting one enters draw mode (same `tool` signal pattern as `DrillBoardEditorComponent`). Toggling the same button exits.

**Click-to-place (WCAG 2.5.7 — non-drag pointer alternative):**
1. Click slot A → slot highlighted as source
2. Click slot B → `addPlay(board, { kind, fromSlotId, toSlotId })` commits; annotation rendered
3. `draw-zone`: click sets zone centre; fixed-size zone placed. Resize is a future gesture.

**Keyboard path (WCAG 2.1.1 — full keyboard operability):**
- Space on focused slot → selects as source; `aria-pressed="true"`; announce "Quelle gewählt"
- Arrow keys → roving-tabindex navigates to adjacent slots (existing)
- Space on target slot → commits play; `aria-pressed` cleared; announce "Lauf/Pass gezeichnet"
- Escape → cancels draw mode, clears source selection

**`aria-label` on slots** updates dynamically with draw-mode context:
- Idle: `"Studer – CM"`
- Draw mode, no source: `"Studer – CM – Quelle wählen"`
- Draw mode, source selected: `"Studer – CM – Ziel wählen"`

**`clearPlay`:** Delete key when a play annotation is focused removes it — mirrors drill-board Delete.

**Axe-core test** on the draw-mode rendered state (`color-contrast: false` per convention).

**Out of scope for PR-4:** Formation snapshot (`snapshot-formation` gesture), zone resize, multi-play undo batch. Filed as follow-ups on #93.

---

## 5. What is NOT in this arc

- Formation snapshot (v1 deferral — needs per-minute snapshot persistence design)
- Zone resize gesture (follow-up)
- Multi-editor collaboration (Yjs/Hocuspocus — ADR-160 v2)
- Migration of drill-board pitch (100×60) or coach-lineup pitch onto `<db-pitch>` (separate follow-up)
- `<db-pitch>` → `<fc-pitch>` rename (cosmetic; separate issue if desired)

---

## 6. Open questions (none blocking)

None. All D1–D5 decisions are locked. The `treeRootId` seam fix (PR-3) is explicitly documented in the mapper source and will be corrected at the host level.
