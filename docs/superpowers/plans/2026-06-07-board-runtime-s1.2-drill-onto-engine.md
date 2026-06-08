# Board Runtime S1.2 — Wire the Drill Editor onto the Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Refactor `DrillBoardEditorComponent`'s internals to run on the S1.1 board engine (`BoardEditorStore` + `board-ops` on `BoardGeometry`), converting `DrillDiagram⇄BoardGeometry` at the component boundary (S0 converters) — proving the engine + converters live on the most-sophisticated board, with the public API + template + interaction + the ~23 drill-editor specs **byte-identical**.

**Architecture:** A model-swap refactor of ONE file. The component holds `BoardGeometry` via `BoardEditorStore`; the `diagram` input is converted in (`drillDiagramToBoardGeometry`), and the `view` computed + the `diagramChange` emit convert out (`boardGeometryToDrillDiagram` → `layoutDrillBoard`), so the **template + the `view` shape are unchanged**. Interaction calls `board-ops` with drill kind-tokens (`pack-football.drill-diagram.{kind}`) + id-prefixes `'d'`/`'a'`; single-zone is composed from `addZone`/`removeZone` at the `DRILL_ZONE_ID`; selection `'dot'`→`'marker'`. The `DrillEditorStore` persistence half was vestigial (panel owns save via the output), so the swap is contained.

**Tech Stack:** TypeScript, Angular 21 (signals, OnPush, standalone), vitest, Nx 22. In `domains/exercir/libs/pack-football-ui`. Run from `D:/development/projects/de-braighter/domains/exercir`.

**Source spec:** `docs/superpowers/specs/2026-06-07-board-runtime-s1-engine-design.md` (§5 "Revised — Approach B").

**The guard:** `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts` (~23 tests). These must stay green — they are the byte-preservation contract. Run them after the refactor and iterate until green.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts` | Modify | Swap internals to `BoardEditorStore` + `board-ops` on `BoardGeometry`; boundary-convert; selection `'dot'`→`'marker'` |
| `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts` | (Guard, do NOT change behaviour) | The ~23 specs must stay green; only touch if a test asserts an internal that legitimately changed (selection kind) — see Task 1 Step 9 |

No other files change. `DrillEditorStore`, `drill-diagram-ops.ts` stay on disk (still used by their own specs + possibly other consumers — do NOT delete them in S1.2). `board-ops.ts` / `board-editor.store.ts` (S1.1) + the S0 converters (`@de-braighter/pack-football-contracts`) are consumed.

---

### Task 1: Refactor `DrillBoardEditorComponent` onto the engine

**Files:** Modify `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts`.

This is a cohesive model-swap — apply ALL edits below (the file won't compile half-swapped), then run the specs + build. Read the current file first; the line numbers are guides, match on the code.

- [ ] **Step 1: Swap the imports.** Replace the import of `DrillEditorStore` (line ~39) and the `drill-diagram-ops` import block (lines ~52–61) with the engine + converter imports. Specifically:

Remove:
```ts
import { DrillEditorStore } from '../state/drill-editor.store.js';
```
and
```ts
import {
  addArrow,
  addDot,
  clearZone,
  moveDot,
  removeArrow,
  removeDot,
  setDotKind,
  setZone,
} from './drill-diagram-ops.js';
```

Add (alongside the existing imports):
```ts
import {
  DRILL_ZONE_ID,
  boardGeometryToDrillDiagram,
  drillDiagramToBoardGeometry,
  type BoardGeometry,
} from '@de-braighter/pack-football-contracts';
import { BoardEditorStore } from '../board-engine/board-editor.store.js';
import {
  addArrow,
  addMarker,
  addZone,
  moveMarker,
  removeArrow,
  removeMarker,
  removeZone,
  setMarkerKind,
} from '../board-engine/board-ops.js';
```

(Keep `layoutDrillBoard, PITCH_LENGTH, PITCH_WIDTH` from `./drill-board-layout.js`; keep the `drill-board-style` imports, `drill-board.types`, `drill-editor.types`, `pitch`.)

- [ ] **Step 2: Add drill kind-token helpers** (module scope, near `TOOLS`):

```ts
/** Build the drill dot/arrow kind tokens the geometry markers/arrows carry. */
const drillDotToken = (k: DrillDotKind): string => `pack-football.drill-diagram.${k}`;
const drillArrowToken = (k: DrillArrowKind): string => `pack-football.drill-diagram.arrow.${k}`;
```

- [ ] **Step 3: Swap the store + view + begin.**
  - `readonly store = new DrillEditorStore();` → `readonly store = new BoardEditorStore();`
  - `view` computed: `layoutDrillBoard(this.store.workingDiagram(), this.viewport())` → `layoutDrillBoard(boardGeometryToDrillDiagram(this.store.workingGeometry()), this.viewport())`
  - The constructor effect's begin: `untracked(() => this.store.begin({ key: '', tier: 'tenant', diagram: d }));` → `untracked(() => this.store.begin(drillDiagramToBoardGeometry(d)));`

- [ ] **Step 4: Swap the selection sites** (`'dot'` → `'marker'`; zone gets the id):
  - `onSelectDot`: `this.store.select({ kind: 'dot', id });` → `this.store.select({ kind: 'marker', id });`
  - `onSelectZone`: `this.store.select({ kind: 'zone' });` → `this.store.select({ kind: 'zone', id: DRILL_ZONE_ID });`
  - `onSetDotKind`: `if (sel.kind !== 'dot') return;` → `if (sel.kind !== 'marker') return;`
  - `handleArrowDrawKey`: `const anchor = sel.kind === 'dot'` → `const anchor = sel.kind === 'marker'`
  - `handlePickDropKey`: `if (sel.kind !== 'dot') return true;` → `if (sel.kind !== 'marker') return true;`
  - `deleteSelected`: `if (sel.kind === 'dot') {` → `if (sel.kind === 'marker') {`
  - The keyboard add-at-centre select: `this.store.select({ kind: 'dot', id: added.id });` → `this.store.select({ kind: 'marker', id: added.id });`
  - **Template** (line ~141): `@if (store.selection().kind === 'dot') {` → `@if (store.selection().kind === 'marker') {`

- [ ] **Step 5: Swap the op-call sites to `board-ops` + `workingGeometry`** (each `this.store.workingDiagram()` → `this.store.workingGeometry()`):
  - `onSetDotKind`: `this.store.apply(setDotKind(this.store.workingDiagram(), sel.id, kind));` → `this.store.apply(setMarkerKind(this.store.workingGeometry(), sel.id, drillDotToken(kind)));`
  - `onSvgPointerDown` (the `const tool` read): `const tool = this.store.tool();` → `const tool = this.store.tool() as DrillTool;` (the store tool is now the generic `BoardTool=string`; this component's tools are `DrillTool` — cast at the boundary). Then `addDot(...)` → `const next = addMarker(this.store.workingGeometry(), drillDotToken(dotKind), x, y, 'd');`
  - `onSvgPointerMove`: `moveDot(this.store.workingDiagram(), this.draggingDotId, x, y)` → `moveMarker(this.store.workingGeometry(), this.draggingDotId, x, y)`
  - `onSvgPointerUp` arrow: `const kind = toolArrowKind(this.store.tool());` → `const kind = toolArrowKind(this.store.tool() as DrillTool);` then `addArrow(this.store.workingDiagram(), kind, this.arrowStart.x, this.arrowStart.y, x, y)` → `addArrow(this.store.workingGeometry(), drillArrowToken(kind), this.arrowStart.x, this.arrowStart.y, x, y, 'a')`
  - `onSvgPointerUp` zone: `const next = setZone(this.store.workingDiagram(), minX, minY, w, h);` → `const next = addZone(removeZone(this.store.workingGeometry(), DRILL_ZONE_ID), DRILL_ZONE_ID, minX, minY, w, h);`
  - `handleAddAtCentreKey`: `const dotKind = toolDotKind(this.store.tool());` → `const dotKind = toolDotKind(this.store.tool() as DrillTool);` then `addDot(this.store.workingDiagram(), dotKind, 50, 30)` → `addMarker(this.store.workingGeometry(), drillDotToken(dotKind), 50, 30, 'd')`; and `const added = next.dots.at(-1);` → `const added = next.markers.at(-1);`
  - `handleArrowDrawKey`: `const arrowKind = toolArrowKind(this.store.tool());` → `const arrowKind = toolArrowKind(this.store.tool() as DrillTool);` then `const working = this.store.workingDiagram();` → `const working = this.store.workingGeometry();` and `addArrow(working, arrowKind, this.pendingArrowAnchor.x, this.pendingArrowAnchor.y, anchor.x, anchor.y)` → `addArrow(working, drillArrowToken(arrowKind), this.pendingArrowAnchor.x, this.pendingArrowAnchor.y, anchor.x, anchor.y, 'a')`
  - `handleZoneKey`: `const working = this.store.workingDiagram();` → `const working = this.store.workingGeometry();`; `if (working.zone) {` → `const zone = working.zones.find((z) => z.id === DRILL_ZONE_ID); if (zone) {`; the create branch `this.store.apply(setZone(working, 25, 15, 50, 30));` → `this.store.apply(addZone(removeZone(working, DRILL_ZONE_ID), DRILL_ZONE_ID, 25, 15, 50, 30));`; the select `{ kind: 'zone' }` → `{ kind: 'zone', id: DRILL_ZONE_ID }`
  - `handleNudgeKey`: `moveDot(this.store.workingDiagram(), this.heldDotId, cur.x + dx, cur.y + dy)` → `moveMarker(this.store.workingGeometry(), this.heldDotId, cur.x + dx, cur.y + dy)`
  - `handleZoneAdjustKey`: `const zone = this.store.workingDiagram().zone;` → `const zone = this.store.workingGeometry().zones.find((z) => z.id === DRILL_ZONE_ID);`; keep `let { x, y, w, h } = zone;`; `setZone(this.store.workingDiagram(), x, y, w, h)` → `addZone(removeZone(this.store.workingGeometry(), DRILL_ZONE_ID), DRILL_ZONE_ID, x, y, w, h)`
  - `deleteSelected`: `next = removeDot(this.store.workingDiagram(), sel.id);` → `next = removeMarker(this.store.workingGeometry(), sel.id);`; `next = removeArrow(this.store.workingDiagram(), sel.id);` → `next = removeArrow(this.store.workingGeometry(), sel.id);`; `next = clearZone(this.store.workingDiagram());` → `next = removeZone(this.store.workingGeometry(), DRILL_ZONE_ID);`; the local type `let next: DrillDiagram | null = null;` → `let next: BoardGeometry | null = null;`

- [ ] **Step 6: Swap `dotCoords` + `emitChange`.**
  - `dotCoords`: `const dot = this.store.workingDiagram().dots.find((d) => d.id === id); return dot ? { x: dot.x, y: dot.y } : null;` → `const m = this.store.workingGeometry().markers.find((mk) => mk.id === id); return m ? { x: m.x, y: m.y } : null;`
  - `emitChange`: `this.diagramChange.emit(this.store.workingDiagram());` → `this.diagramChange.emit(boardGeometryToDrillDiagram(this.store.workingGeometry()));`

- [ ] **Step 7: Build to flush type errors.** Run `npx nx build pack-football-ui`. Fix any residual `workingDiagram`/`DrillDiagram`/op-name references the steps missed, and any remaining `toolDotKind/toolArrowKind(this.store.tool())` sites needing the `as DrillTool` cast. Expected: PASS once all sites are swapped.

- [ ] **Step 8: Run the drill-editor specs (the byte-preservation guard).** Run `npx nx test pack-football-ui --include="**/drill-board-editor.component.spec.ts"`. Expected: all ~23 PASS unchanged.

- [ ] **Step 9: If (and only if) a spec fails because it asserted the OLD selection kind `'dot'`** (e.g. checks `store.selection()` equals `{ kind: 'dot', id }`), update that assertion to `'marker'` — this is the one legitimate internal change (selection generalized). Do NOT change any assertion about rendered DOM, data-attributes, aria, emitted `DrillDiagram` shape, or editing behaviour — those must pass as-is (if they don't, the refactor diverged; fix the component, not the test). Re-run until green.

- [ ] **Step 10: Lint + commit.** `npx nx lint pack-football-ui` → 0 errors (the `as DrillTool` casts are accepted; no new non-null-assertions). `npx nx build pack-football-ui` → PASS.

```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts
git commit -m "refactor(pack-football-ui): drill editor runs on the board engine (BoardGeometry); S1.2"
```

---

### Task 2: Slice verification + PR

- [ ] **Step 1: Full gate** — `npx nx test pack-football-ui` → PASS (the FULL suite incl. all drill-board + bibliothek specs + the board-engine specs — nothing regressed); `npx nx lint pack-football-ui` → 0 errors; `npx nx build pack-football-ui` → PASS. Also confirm `pack-football-visual-editor` still builds (it hosts the drill UI): `npx nx build pack-football-visual-editor` → PASS.
- [ ] **Step 2: Diff sanity** — `git diff --name-status main...HEAD` → the drill-board-editor component (+ its spec only if Step 9 fired). No other file.
- [ ] **Step 3: Push + PR** — `git push -u origin HEAD`; `gh pr create` with a summary (board-runtime S1.2; drill editor now runs on the engine via S0 converters; behaviour byte-preserved; the engine proven on the most-sophisticated board; generic component deferred to S3), `Tech design:` links to the S1 design + epic docs, `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`, `Effect: cycle-time 0.01±0.02 expert`, `Effect: findings 0±1 expert`.
- [ ] **Step 4: Verifier wave** — `local-ci` + `reviewer` + `charter-checker` + `exercir-charter-checker` (read-only, worktree isolation) at the PR head. This slice changes a real working component (not pure-additive), so include `reviewer` (holistic diff) + `qa-engineer` is optional (no new a11y/endpoint surface; the a11y is byte-preserved — but the diff touches an interactive component, so a quick `qa-engineer` pass on the a11y-preservation is reasonable).

---

## Self-Review (against the S1 design, Approach B)

**Spec coverage:** §5-revised "wire drill editor onto the engine" → Task 1 (store/ops/view/begin/emit/selection swaps + boundary converters). "byte-preserved, ~23 specs green" → Task 1 Steps 8–9 + Task 2 Step 1. "single-zone composed from addZone/removeZone at DRILL_ZONE_ID" → Step 5 (zone sites). "drill kind-tokens + id-prefix d/a" → Step 2 helpers + Step 5. "persistence half vestigial, contained swap" → no panel/DrillEditorStore deletion; the swap is component-internal. "generic component deferred to S3" → not in this plan. ✅

**Placeholder scan:** no TBD/TODO; every swap is an exact before→after; the one conditional (Step 9) is bounded + explicit. ✅

**Type consistency:** `board-ops` names (`addMarker`/`moveMarker`/`setMarkerKind`/`removeMarker`/`addArrow`/`removeArrow`/`addZone`/`removeZone`) match S1.1; `BoardEditorStore.workingGeometry()`/`begin(initial)`/`select({kind:'marker'|'zone',id})` match S1.1's `BoardSelection`; the S0 converters (`drillDiagramToBoardGeometry`/`boardGeometryToDrillDiagram`/`DRILL_ZONE_ID`) match S0's exports; `addArrow(g, kind, x1,y1,x2,y2, idPrefix)` arg order matches S1.1 board-ops; the marker kind-token (`pack-football.drill-diagram.{k}`) matches what `boardGeometryToDrillDiagram` → `layoutDrillBoard` strips back to the short `DrillDotKind`, so `view().dots[].kind` + the `dotFill`/`arrowColor` helpers are unchanged. The `as DrillTool` cast bridges the generic `BoardTool=string` tool signal to the drill `toolDotKind`/`toolArrowKind` helpers. ✅
