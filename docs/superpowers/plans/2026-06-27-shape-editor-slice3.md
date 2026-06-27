# Shape editor — Slice 3 (geometry archetype + draw primitive add/remove/reorder) — Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Extend the `shape-editor` so a user can set a shape's `geometry` archetype (none/point/box/polyline — the brick synthesizes the edit behavior) and add / remove / reorder its draw primitives (creating defaults per `p` kind). Builds on slice 2's shape-editor.

**Architecture:** `docs/superpowers/specs/2026-06-27-shape-editor-design.md` §4 (slice 3). Pure shape-editor extension + handlers, same signal/emit-whole-object pattern. `points` (polyline) are runtime instance props the recipe binds to — NOT authored here (the brick handles endpoint-drag from `geometry:'polyline'`).

## Global Constraints
- Scope: `domains/studio/libs/board-editor` ONLY (mainly `shape-editor.component.ts` + spec). ZERO design-system-core/kernel/brick change. No publish. ADR-176-safe.
- Additive + parity-neutral: plan-tree authoring + `catalog-parity`/`catalog-document`/`recipe-roundtrip` specs stay green.
- Pattern: standalone, OnPush, signal `@Input`/`@Output`, emit-whole-object immutable; per-row toolbar a11y (roving toolbar like group-editor; WCAG 2.4.3 focus on remove/reorder); unique aria-labels. New styled markup must use BARE `var(--…)` tokens (token-hygiene gate covers `ShapeEditorComponent`).
- Test: `npm test` from `domains/studio/libs/board-editor` (baseline 586 green). Build: `npm run build`.
- Git: branch `feat-shape-editor-slice3` in `domains/studio`. Explicit-path commits. Footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Geometry archetype control

**Files:** Modify `libs/board-editor/src/lib/shape-editor.component.ts` (+ spec).

**What:** In the shape-editor header/meta section, add a labelled `<select data-testid="shape-geometry">` with options `none` / `point` / `box` / `polyline`, bound to `shape.geometry ?? 'none'`. On change: `'none'` → emit `{ ...shape, geometry: undefined }` (omit the field — use object destructuring to drop it, NOT set undefined, so the round-trip stays clean); otherwise → `{ ...shape, geometry: value }`.

- [ ] **Step 1: failing test** (add to `shape-editor.component.spec.ts`):
```ts
it('shows the geometry archetype and emits a change (box) and a clear (none)', () => {
  const f = TestBed.createComponent(ShapeEditorComponent);
  f.componentRef.setInput('shape', shape); // shape has geometry:'box' (slice-2 fixture)
  f.detectChanges();
  const sel = f.nativeElement.querySelector('[data-testid="shape-geometry"]') as HTMLSelectElement;
  expect(sel.value).toBe('box');
  const emits: ShapeDefinition[] = [];
  f.componentInstance.shapeChange.subscribe((s) => emits.push(s));
  f.componentInstance.onGeometryChange('point');
  expect(emits.at(-1)!.geometry).toBe('point');
  f.componentInstance.onGeometryChange('none');
  expect('geometry' in emits.at(-1)!).toBe(false); // field OMITTED, not undefined
});
```
- [ ] **Step 2: run → fail.**
- [ ] **Step 3: implement** `onGeometryChange(v: 'none'|'point'|'box'|'polyline')`: for `'none'`, `const { geometry, ...rest } = this.shape; this.shapeChange.emit(rest as ShapeDefinition);` else `this.shapeChange.emit({ ...this.shape, geometry: v });`. Add the labelled select to the template (testid + aria-label "Geometry archetype").
- [ ] **Step 4: run → pass.** - [ ] **Step 5: build.** - [ ] **Step 6: commit** `feat(board-editor): shape-editor — geometry archetype control`.

---

### Task 2: Add / remove / reorder draw primitives

**Files:** Modify `libs/board-editor/src/lib/shape-editor.component.ts` (+ spec). Export a pure helper `defaultPrimitive(p: PrimitiveTemplate['p']): PrimitiveTemplate`.

**What:** Each draw-primitive card gets a small toolbar (↑ up / ↓ down / ✕ remove), roving-toolbar a11y like `group-editor`. Below the draw list, an "Add primitive" control: a `<select data-testid="add-prim-kind">` of `rect|circle|line|text|path` + an "Add" button → append `defaultPrimitive(kind)`.

`defaultPrimitive`: rect→`{p:'rect',x:0,y:0,w:10,h:10}`; circle→`{p:'circle',cx:0,cy:0,r:5}`; line→`{p:'line',x1:0,y1:0,x2:10,y2:10}`; text→`{p:'text',x:0,y:0,text:''}`; path→`{p:'path',d:''}`.

- [ ] **Step 1: failing test** (add to spec):
```ts
import { defaultPrimitive } from './shape-editor.component';
it('defaultPrimitive builds a minimal primitive per kind', () => {
  expect(defaultPrimitive('rect')).toEqual({ p: 'rect', x: 0, y: 0, w: 10, h: 10 });
  expect(defaultPrimitive('circle')).toEqual({ p: 'circle', cx: 0, cy: 0, r: 5 });
});
it('add/remove/reorder draw primitives emit immutable updates', () => {
  const f = TestBed.createComponent(ShapeEditorComponent);
  f.componentRef.setInput('shape', shape); // 1 draw primitive (rect)
  f.detectChanges();
  const emits: ShapeDefinition[] = [];
  f.componentInstance.shapeChange.subscribe((s) => emits.push(s));
  f.componentInstance.onAddPrimitive('circle');
  expect(emits.at(-1)!.draw).toHaveLength(2);
  expect(emits.at(-1)!.draw[1]).toEqual({ p: 'circle', cx: 0, cy: 0, r: 5 });
  // reorder: move new circle up
  f.componentInstance.onMovePrimitive(1, 'up');
  expect(emits.at(-1)!.draw.map((p) => p.p)).toEqual(['circle', 'rect']);
  // remove index 0
  f.componentInstance.onRemovePrimitive(0);
  expect(emits.at(-1)!.draw).toHaveLength(1);
});
```
(NOTE: `onMovePrimitive`/`onRemovePrimitive` operate on the CURRENT `this.shape` each call; since the test re-reads emits.at(-1) but the component's `@Input shape` isn't re-fed between calls in a unit test, have each handler operate on `this.shape` — for the test, drive sequential ops by re-setting the input OR assert each op independently against the slice-2 fixture. Simplest: assert each op independently from the base fixture, not chained. Adjust the test to call each handler from the fresh fixture state.)
- [ ] **Step 2: run → fail.**
- [ ] **Step 3: implement.** `onAddPrimitive(kind)`: `{ ...shape, draw: [...shape.draw, defaultPrimitive(kind)] }`. `onRemovePrimitive(i)`: `{ ...shape, draw: shape.draw.filter((_,j)=>j!==i) }`. `onMovePrimitive(i,dir)`: swap i with i±1 in a copied array. Template: per-card roving toolbar (↑↓✕, aria-labelled, disabled at bounds) + the add control. WCAG 2.4.3: after remove, move focus to a surviving control (mirror group-editor's pattern).
- [ ] **Step 4: run → pass** (incl. parity/round-trip green). - [ ] **Step 5: build.** - [ ] **Step 6: commit** `feat(board-editor): shape-editor — add/remove/reorder draw primitives`.

---

## Final verification
- [ ] `npm test` (lib) green incl. parity + round-trip; `npm run build` green.
- [ ] **Serve-verify** (controller): open kids drill → ✎ a shape → change its geometry archetype + add/remove a draw primitive → no console error, no hang (diagram stays the slice-1 placeholder for opened recipes).
- [ ] PR `Closes #<issue>`; verifier wave (local-ci + reviewer/whole-branch + qa-engineer); twin ritual; Producer/Effort/Effect.
