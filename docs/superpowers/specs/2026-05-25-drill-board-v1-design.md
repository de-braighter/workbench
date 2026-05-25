# Drill-board v1 — read-only Drill-Bibliothek (design)

- **Date:** 2026-05-25
- **Status:** design (brainstormed; pending implementation plan)
- **Domain:** `de-braighter/domains/exercir` → `pack-football` + `pack-football-ui`
- **Tracker:** [de-braighter/exercir#87](https://github.com/de-braighter/exercir/issues/87)
- **Governing ADRs:** [ADR-160](https://github.com/de-braighter/specs/blob/main/adr/adr-160-pack-football-visual-editor-fourth-fifth-scenes-drill-diagram-tactical-board.md) (drill-diagram contract), [ADR-176](https://github.com/de-braighter/specs/blob/main/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) (pack vs kernel), [ADR-177](https://github.com/de-braighter/specs/blob/main/adr/adr-177-visual-editor-renderer-svg-canonical-reverse-konva.md) (SVG renderer), [ADR-158](https://github.com/de-braighter/specs/blob/main/adr/adr-158-football-intervention-catalog-binding.md) (catalog).

## 1. Summary

Build the **Drill-Bibliothek** (the S-21 stub) as a **read-only** drill library: browse the football drill catalog grouped by phase, filter by phase/intensity, and open a drill to view its diagram rendered on an SVG pitch alongside its metadata. Seed all ~12 vendor drills with diagrams so the catalog renders real boards.

The **editable canvas is deliberately deferred** — authoring is the a11y-heavy part (interactive SVG, keyboard editing, gesture semantics). v1 ships the catalog value and the rendered board; authoring is a later slice.

This is a **pure pack feature with zero kernel involvement** (ADR-176): the diagram is pack-side `metadata`, read through the catalog; no substrate change. Renderer is **SVG** (ADR-177).

## 2. Decisions locked (from the 2026-05-25 brainstorm)

| Decision | Choice |
|---|---|
| v1 spine | **Bibliothek-first** — browse + view; editable canvas deferred |
| View fidelity | **Rendered board, read-only** — render the `DrillDiagram` (dots/arrows/zone) on the pitch, not metadata-only |
| Seed scope | **Seed all ~12** vendor drills with `metadata.diagram` (catalog content) |
| Browse layout | **Grouped-by-phase master-detail** (list sectioned by `metadata.phase`; full board on selection) |
| Pitch primitive | **Local helper** (Approach 1), not a shared `<fc-pitch>` brick yet — promote on demonstrated 2nd consumer per ADR-176 |
| View-model | **Drill-board-specific**, NOT the plan-tree `SvgScene` (a `DrillDiagram` is not a `PlanTree`) |

## 3. Scope

**In:**
- Drill catalog browse: grouped by `metadata.phase`, filter by phase + intensity.
- Read-only rendered board for the selected drill: pitch + dots (player/defender/keeper/cone/ball) + arrows (pass/run/dribble/shot) + optional zone + legend.
- Drill metadata panel (name, phase, intensity, tier, description/coaching-point).
- Seed: all ~12 vendor drill rows gain a `metadata.diagram` conforming to `DrillDiagramSchema`.
- Read path wired end-to-end (use-case → endpoint → UI).
- Derived accessibility for the board; standard accessible list/filter controls.

**Out (deferred to later slices):**
- The **editable canvas** — place/move dots, draw arrows, set zone; save via `UpdateDrillDiagramUseCase`; the vendor→fork (tenant) UX; the gesture-interpreter editing path and its a11y.
- The **tactical-board** (ADR-160 Scene 5).
- A shared **`<fc-pitch>`** design-system/pack primitive (extract later).
- Tenant-authored drills.

## 4. Architecture

Reuse the established **`generation/` pattern** (pure layout fn → view-model → OnPush SVG component), as used by `formation-scene` / `player-view-scene` / `training-plan-scene`.

**Key divergence:** the view-model is **drill-board-specific**, not the plan-tree `SvgScene` from `generation/svg-scene.types.ts`. `SvgScene.SvgNode` carries a `planNodeRef` that drill dots do not have — forcing a `DrillDiagram` through a plan-tree type would be the wrong abstraction (the same boundary lesson as the kernel work). The drill-board defines its own small view-model.

All v1 code lives in **`pack-football-ui`** (UI) + **`pack-football`** (seed/data) + **`pack-football-api`** (read endpoint). No design-system or kernel changes.

## 5. Components

All paths under `domains/exercir/libs/`.

| Component | Path | Responsibility |
|---|---|---|
| Pitch helper | `pack-football-ui/src/lib/generation/pitch.ts` | Pure: emit pitch line geometry for a viewport. Local (Approach 1); future `<fc-pitch>` extraction point. |
| Layout fn | `pack-football-ui/src/lib/generation/drill-board-layout.ts` | **Pure** `(DrillDiagram, viewport) → DrillBoardView`: normalized→SVG coords for dots/arrows/zone; assigns per-element `ariaLabel`. No Angular. |
| Scene component | `pack-football-ui/src/lib/generation/drill-board-scene.component.ts` | Standalone, OnPush. Input: `DrillBoardView`. Renders pitch + dots + arrows + zone + legend. **Read-only** (no gestures). Emits the derived a11y description. |
| Bibliothek route | `pack-football-ui/src/lib/drills/drill-bibliothek.component.ts` | Replaces `stub('Drill-Bibliothek','S-21')` at route `drills` (`shell/fc-workspace.routes.ts`). Fetches drills, groups by phase, filter controls, master-detail; renders selected drill's `drill-board-scene` + metadata. |
| Data client | `pack-football-ui/src/lib/data/` (extend existing) | UI method to GET drills (optionally filtered). |
| Read endpoint | `pack-football-api/src/app/` | `GET /pack-football/drills` backed by `ListDrillsUseCase`. |

`DrillBoardView` shape (illustrative): `{ viewport, pitch, dots: {id, kind, x, y, label?, ariaLabel}[], arrows: {id, kind, from, to, ariaLabel}[], zone?: {x,y,w,h,ariaLabel}, summaryAriaLabel }`.

## 6. Data flow

1. Bibliothek route loads → UI client `GET /pack-football/drills` → `ListDrillsUseCase` returns `Intervention[]` (each with `metadata.phase`, `metadata.intensity`, `metadata.tier`, `metadata.diagram`).
2. Group by `metadata.phase`; render grouped list; phase/intensity filter narrows.
3. Select a drill → validate `metadata.diagram` against `DrillDiagramSchema` (`pack-football/src/domain/football-event.ts`) → `drill-board-layout` → `drill-board-scene.component` renders SVG + legend + metadata.
4. Missing/invalid diagram → graceful "no diagram yet" panel (defensive; seed-all populates all 12).

## 7. Accessibility (read-only, derived)

The board's accessible representation is **derived from the same `DrillBoardView`** that drives the SVG — one source, cannot drift ("derive, don't mirror", the ADR-176 principle applied to a11y):
- `<svg role="img">` with an `aria-label` summary (e.g., "Drill: Rondo 4v2 → finish; 4 attackers, 2 defenders, keeper, on a grid").
- A visually-hidden ordered description generated from the view-model: dots, then arrows in sequence ("pass #6→#8; run #7 to the box; shot to goal").
- List + filters use standard accessible controls; the workspace shell already provides skip-link / ARIA patterns.
- No editing semantics (read-only) — far lighter than the deferred canvas.

## 8. Seed data

Author 12 `metadata.diagram` blobs for the existing vendor drill catalog rows in `pack-football/src/manifest/interventions.ts` (currently zero diagrams). Each conforms to `DrillDiagramSchema`: `sceneKind`/`schemaVersion` = `'pack-football.drill-diagram.v1'`, `dots[]` (`pack-football.drill-diagram.{player|defender|keeper|cone|ball}`), `arrows[]` (`pack-football.drill-diagram.arrow.{pass|run|dribble|shot}`), optional `zone`. Vendor-tier catalog content; realistic small diagrams spanning the phases.

## 9. Testing

- `drill-board-layout` (pure) — unit: coords + `ariaLabel` for each element kind.
- `drill-board-scene` + `drill-bibliothek` — component tests (pack-football-ui has a working test setup, ~478 passing; **not** the blocked dsa/analog harness).
- Grouping + filter — unit.
- **Seed-validation spec:** all 12 `metadata.diagram`s parse against `DrillDiagramSchema`.
- Gate: `pnpm run ci:local` green + Sonar Quality Gate OK. Browser smoke-test the `drills` route before "done".
- Heavy visual-regression deferred (ADR-174's pixel-diff works on SVG output if wanted later).

## 10. Build order (decomposition)

1. Seed 12 diagrams + schema-validation spec.
2. `pitch.ts` + `drill-board-layout.ts` (pure).
3. `drill-board-scene.component.ts`.
4. Read endpoint (`GET /pack-football/drills`) + UI data client.
5. `drill-bibliothek.component.ts` (route, grouping, filter, master-detail) replacing the S-21 stub.
6. Derived a11y description.
7. Wire + browser smoke-test + ci:local + Sonar.

## 11. Future / not-foreclosed

- Editable canvas (authoring): the gesture vocabulary + `UpdateDrillDiagramUseCase` write path + vendor→fork UX, with the heavier interactive-canvas a11y.
- Tactical-board (Scene 5).
- Extract `<fc-pitch>` when a second consumer (tactical-board / editing) is real — per ADR-176's promotion rule.
- Card-gallery thumbnails (browse layout A) if desired later.

## 12. References

- `domains/exercir/libs/pack-football/src/in-ports/list-drills.use-case.ts` — read use-case (filter phase/intensity).
- `domains/exercir/libs/pack-football/src/domain/football-event.ts` — `DrillDiagramSchema`.
- `domains/exercir/libs/pack-football/src/manifest/interventions.ts` — drill catalog rows (seed target).
- `domains/exercir/libs/pack-football-ui/src/lib/generation/` — existing SVG scene pattern + `svg-scene.types.ts`.
- `domains/exercir/libs/pack-football-ui/src/lib/shell/fc-workspace.routes.ts` — the `drills` route (S-21 stub to replace).
- ADR-160 (drill-diagram contract + catalog-mutation write path, for the deferred authoring slice).
