# Shape editor — Slice 5 (persistence + meaningful preview) — Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Complete the arc's ceiling — make an opened/edited recipe **saveable + reloadable** (serialize/deserialize `ShapeDefinition`, retire the slice-1 serialize/Save guards), and give opened recipes a **meaningful diagram preview** (sample props per geometry archetype, retiring the slice-1 placeholder). After slice 5: open → edit every construct → save → reopen, end-to-end.

**Architecture:** `docs/superpowers/specs/2026-06-27-shape-editor-design.md` §4 (slice 5). A `ShapeDefinition` is self-contained JSON-safe data (published `RecipeShape` shape) — so serialize/deserialize is a near-verbatim passthrough (no by-name-ref resolution like primitives/groups). The diagram preview hangs/degenerates on opened recipes only because the drill shapes need runtime props; supply sensible sample props per `geometry` archetype.

## Global Constraints
- Scope: `domains/studio/libs/board-editor` ONLY. ZERO design-system-core/kernel/brick change. No publish. ADR-176-safe.
- Additive + parity-neutral: the EXISTING plan-tree serialize/deserialize + `catalog-parity`/`catalog-document`/`recipe-roundtrip`/`token-hygiene` specs stay green (the shape path is additive; plan-tree docs byte-unchanged).
- Pattern: pure functions for serialize/deserialize; signal/emit for component; standalone/OnPush. BARE `var(--…)` tokens. a11y maintained.
- Test: `npm test` from `domains/studio/libs/board-editor` (baseline 600 green). Build: `cd libs/board-editor && npm run build`.
- Git: branch `feat-shape-editor-slice5`. Explicit-path commits. Footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Serialize / deserialize `ShapeDefinition` (catalog-document)

**Files:** Modify `libs/board-editor/src/lib/catalog-document.ts` (+ `catalog-document.spec.ts`).

**What:** `serializeCatalog` currently THROWS on a `'shape'`-kind definition (the slice-1 guard). Replace the throw with real serialization: add a `'shape'` variant to the `CatalogDocument` definition union carrying the ShapeDefinition's fields verbatim (`name`, `shapeKind`, `geometry?`, `draw`, `bounds`, `a11y`, `actions?`, `hit?`, `nudge?`, `handleRadius?`, `segTol?`, `minWH?` — all JSON-safe; the doc uses `name` as the human key like other defs, and carries `shapeKind` + the rest). `deserializeCatalog` reconstructs the `ShapeDefinition` (mint a fresh `id` like other defs; `kind:'shape'`). Round-trip: a shape-bearing `CatalogModel` → `serializeCatalog` → `deserializeCatalogWithReport` → equivalent `CatalogModel` (deep-equal modulo minted ids), then `buildRecipeFromCatalog` byte-identical.

- [ ] **Step 1: failing test** (add to `catalog-document.spec.ts`): build a small `CatalogModel` with one `ShapeDefinition` (kind/shapeKind/geometry/draw[RecipeValue]/bounds/a11y) placed in the root group; assert `serializeCatalog` does NOT throw; assert `buildRecipeFromCatalog(deserializeCatalogWithReport(serializeCatalog(model)).model)` deep-equals `buildRecipeFromCatalog(model)`. (Read the existing catalog-document tests for the established helpers/shape.)
- [ ] **Step 2: run → fail** (throws today).
- [ ] **Step 3: implement** the `'shape'` doc variant + serialize/deserialize. Read `catalog-document.ts` first for the CatalogDocumentV2 schema + the existing per-kind serialize/deserialize branches; mirror them for `'shape'` (verbatim field carry, fresh id on deserialize). Remove the throw.
- [ ] **Step 4: run → pass** (incl. existing catalog-document round-trip + parity green). - [ ] **Step 5: build.** - [ ] **Step 6: commit** `feat(board-editor): serialize/deserialize ShapeDefinition (catalog-document)`.

---

### Task 2: Retire the opened-recipe Save / code-view guards

**Files:** Modify `libs/board-editor/src/lib/catalog-designer.component.ts` (+ spec).

**What:** Slice 1 added `hasOpenedRecipe()` guards: `documentJson()` returns a "not serializable" notice + `saveCatalog()` early-returns + the Save button is disabled for shape-bearing catalogs. Now that shapes serialize (Task 1), RETIRE these guards: `documentJson()` returns the real serialized JSON; `saveCatalog()` persists; the Save button enables (when a name is set). Keep `hasOpenedRecipe` only where still needed (the DIAGRAM preview guard is handled in Task 3).

- [ ] **Step 1: failing test** (update/add in `catalog-designer.component.spec.ts`): after `openRecipe(kfDrillRecipe)`, `documentJson()` does NOT contain "not serializable" and IS valid JSON containing a shape (e.g. `"kind": "shape"` or the shapeKind); the Save button is NOT disabled when a name is set. (Update the slice-1 tests that asserted the notice/disabled — they now assert the retired behavior.)
- [ ] **Step 2: run → fail.**
- [ ] **Step 3: implement** — remove the `hasOpenedRecipe` branch from `documentJson()` (return the real `serializeCatalog` JSON); remove the `saveCatalog()` early-return; remove `[disabled]="hasOpenedRecipe()"` from Save (keep the name-empty disable). Reword/remove the catalog-document throw message (now unused). Update the slice-1 guard tests.
- [ ] **Step 4: run → pass.** - [ ] **Step 5: build.** - [ ] **Step 6: commit** `feat(board-editor): opened recipes are saveable — retire the serialize/Save guards`.

---

### Task 3: Meaningful diagram preview for opened recipes (sample props per archetype)

**Files:** Modify `libs/board-editor/src/lib/catalog-designer.component.ts` (+ the preview-tree helper, wherever `buildPreviewTree` supplies node props) (+ spec).

**What:** The diagram preview shows a placeholder for opened recipes (slice-1 guard) because shape nodes lack runtime props, so `{bind}`/`{calc}` resolve to degenerate/huge values (froze rasterization). Supply **sample props per `geometry` archetype** so the preview renders a recognizable synthetic board, then RETIRE the diagram placeholder guard:
- a pure helper `sampleShapeProps(shapeDef): Record<string, unknown>` — `geometry:'point'` → `{ x: <pos>, y: <pos>, n: 1 }`; `'box'` → `{ x, y, w: 80, h: 50 }`; `'polyline'` → `{ points: [[x1,y1],[x2,y2]] }`; no geometry (e.g. the pitch, which binds `frame.*`) → `{}` (the brick supplies `frame`). Spread sensible distinct positions per node so shapes don't all stack at origin.
- wire these into the preview-tree node props for shape-kind parts (where `buildPreviewTree`/`previewTree` assembles nodes).
- remove the `@if (hasOpenedRecipe())` diagram placeholder branch (the board now renders).

**Acceptance bar (pragmatic):** the diagram preview renders the opened drill board **without hanging or erroring** (a recognizable synthetic board — pixel-perfection NOT required). If a specific archetype still renders degenerately, keep its sample props minimal-but-finite (never NaN/huge) so the render is bounded; note any residual in the report.

- [ ] **Step 1: failing test** (component spec): after `openRecipe(kfDrillRecipe)` in diagram mode, the `[data-testid="preview-board"]` IS present (board renders) and `[data-testid="preview-opened-notice"]` is GONE; the preview node props for a point shape include `x`/`y` (assert `sampleShapeProps` output for each archetype). Keep it unit-level (the real render is serve-verified).
- [ ] **Step 2: run → fail.**
- [ ] **Step 3: implement** `sampleShapeProps` + wire into preview props + remove the diagram placeholder guard. If `buildPreviewTree` is in `catalog.ts` (pure) vs the component, place `sampleShapeProps` accordingly + keep it pure/tested.
- [ ] **Step 4: run → pass** (parity/round-trip green — `sampleShapeProps` is preview-only, never affects `buildRecipeFromCatalog`). - [ ] **Step 5: build.** - [ ] **Step 6: commit** `feat(board-editor): meaningful diagram preview for opened recipes (sample props per archetype)`.

---

## Final verification
- [ ] `npm test` (lib) green incl. parity + round-trip + catalog-document; lib build green.
- [ ] **Serve-verify** (controller, mandatory): open kids drill → the diagram preview RENDERS the board (no placeholder, no hang) → ✎ a shape, edit a value, see it (preview/JSON) → set a name, SAVE → back to Cookbook → reopen the saved recipe → it loads with the edit. No console error.
- [ ] PR `Closes #<issue>`; verifier wave (local-ci + whole-branch opus + qa-engineer); twin ritual; Producer/Effort/Effect.
