# Drill-board — editable canvas (next slice) — handoff

> **Status:** not started — handoff/seed for a fresh session. Start with
> `superpowers:brainstorming` → `superpowers:writing-plans` before any code.
> This is **not** a plan yet; it's the context to write one from.

## Where v1 left off (shipped to `main`)

Drill-board **v1 = read-only Drill-Bibliothek** is merged into `de-braighter/exercir`:

- Browse the 12-drill catalog grouped by phase, filter by phase/intensity, open a
  drill to render its `DrillDiagram` on an SVG pitch (dots/arrows/zone + legend +
  metadata) with derived read-only a11y (`role="img"` summary + visually-hidden
  ordered description). Replaced the S-21 `FCPageStubComponent` stub.
- PRs: **#88** (feature, closes #87), **#90** (theme-cascade fix), **#91** (polish:
  curated drill names + CSS budget). Original plan + spec:
  `docs/superpowers/plans/2026-05-25-drill-board-v1.md` and
  `docs/superpowers/specs/2026-05-25-drill-board-v1-design.md`.

## The next slice: editable drill canvas (authoring half of S-21)

Per v1 spec §3 "Out (deferred)": the **editable canvas** — place/move dots, draw
arrows, set the zone, save edits, plus the vendor→tenant fork UX. This is the
**a11y-heavy** part v1 deliberately deferred (interactive SVG, keyboard editing,
gesture semantics).

### Contract / write path (read before planning)
- **ADR-160 §"Scene 4"** — drill-diagram editor + catalog-mutation contract.
- `UpdateDrillDiagramUseCase` (pack-football in-port) — the write path.
- `DrillCatalogUpdated.v1` event + `DrillCatalogUpdatedV1Schema` in
  `libs/pack-football/src/domain/football-event.ts`.
- Vendor-tier rows are immutable; editing forks to a **tenant** tier. The existing
  catalog repository write-guard specs (`manifest-intervention-catalog.repository`,
  `update-drill-diagram.service`) already assert vendor rows can't be mutated.

### Reuse from v1 (don't rebuild)
- `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts` — the
  read-only SVG scene. Decide: make it editable, or wrap it with an editing overlay.
- `drill-board-layout.ts` (pure layout), `pitch.ts` (pure pitch geometry).
- **Boundary (load-bearing):** the UI uses the **`DrillDiagram` mirror** in
  `pack-football-ui/src/lib/data/wire-schemas.ts` — it must **not** import the node
  `pack-football` barrel (esbuild rejects the NestJS pull; no path alias exists).
  Drift is guarded by `wire-schemas-parity.spec.ts`. Keep this for the write shape too.
- `pitch.ts` is the documented **promote-to-`<fc-pitch>`** point (ADR-176
  promote-on-2nd-consumer) — the editable canvas (or the tactical-board) is the
  second consumer that would justify extracting it.

### Gate / conventions (same as v1)
- PR-gated; branch off `main`; local gate is the bar (remote GitHub Actions
  billing-blocked until ~June). From `domains/exercir`: `npm run ci:local`, then
  `npm run sonar:coverage && npm run sonar:scan` (Sonar quality gate must stay OK —
  coverage detection is now wired; new code needs lcov-covered tests).
- Browser smoke-test the editing flow before "done" (type-check ≠ works). The
  visual-editor app: `nx serve pack-football-api` (:3100) + `nx serve
  pack-football-visual-editor` (:4200); route
  `/t/b6c5d8e2-1234-4abc-9def-fc1a55e1a55e/p/football/coach/drills`.
- Execute with `superpowers:subagent-driven-development` (fresh subagent per task,
  two-stage review).

## Further-deferred (not this slice)
- Tactical-board (ADR-160 Scene 5).
- Card-gallery thumbnails for the browse view.
- Full i18n/translations table for drill names (S-5) — v1 ships a curated map.
