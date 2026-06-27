# Shape editor — Slice 2 (RecipeValue editor + shape editor: draw params + bounds) — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** The catalog-designer can select a loaded `ShapeDefinition` and edit its draw-primitive params + bounds as `RecipeValue`s (literal number/string OR expression: `{calc}`/`{bind}`/`{tpl}`). Plus model hardening (`ShapeDefinition extends Omit<RecipeShape,'kind'>`).

**Architecture:** See `docs/superpowers/specs/2026-06-27-shape-editor-design.md`. Two new components — `recipe-value-editor` (the reusable union-value control) + `shape-editor` (inline center-pane editor) — wired via a new `LibView {sel:'shape',id}` variant. Editing emits the whole updated `ShapeDefinition`; the host does `definitions.update(defs => defs.map(d => d.id===id ? updated : d))`. `buildRecipeFromCatalog` lowers a `ShapeDefinition` verbatim → no forward-path change; editing flows to the recipe.

**Tech:** Angular 21 standalone + OnPush + signal `@Input`/`@Output` (NO Reactive Forms — match `definition-drawer.component.ts`). Vitest. Types from `@de-braighter/design-system-core` (`RecipeValue`, `PrimitiveTemplate`, `RecipeShape`).

## Global Constraints

- Scope: `domains/studio/libs/board-editor` ONLY. ZERO design-system-core/kernel/brick change. No publish. ADR-176-safe.
- Additive + parity-neutral: plan-tree authoring (primitive/svg/group) untouched; `catalog-parity.spec.ts`, `catalog-document.spec.ts`, `recipe-roundtrip.spec.ts` MUST stay green.
- Pattern: signal `@Input`/`@Output`, emit-whole-object, host `definitions.update(map)`. Standalone, OnPush. Model after `definition-drawer.component.ts` for boilerplate/a11y (labels on inputs).
- Test runner: Vitest. `npm test` (= `ng test --no-watch`) from `domains/studio/libs/board-editor` (baseline 569 green). Build: `npm run build`.
- Git: branch `feat-shape-editor-slice2` in `domains/studio` (normal clone). Explicit-path commits (never `git add -A`). Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Model hardening — `ShapeDefinition extends Omit<RecipeShape,'kind'>`

**Files:** Modify `libs/board-editor/src/lib/catalog.ts` (the `ShapeDefinition` interface). Test: existing `recipe-roundtrip.spec.ts` + `catalog-from-recipe.spec.ts` + `catalog-shape-forward.spec.ts` must stay green.

**Why:** The hand-mirrored `ShapeDefinition` silently drops a future `RecipeShape` field. Deriving from `RecipeShape` makes a new REQUIRED field a compile error.

- [ ] **Step 1: Change the interface.** Import `RecipeShape` (already imported in catalog.ts). Replace the hand-written field list with:
```ts
export interface ShapeDefinition extends Omit<RecipeShape, 'kind'> {
  readonly id: string;
  readonly name: string;
  readonly kind: 'shape';
  /** The emitted RecipeShape.kind (registry key), e.g. 'kf.zone'. */
  readonly shapeKind: string;
}
```
(`Omit<RecipeShape,'kind'>` brings `draw`, `bounds`, `a11y`, `actions?`, `hit?`, `geometry?`, `nudge?`, `handleRadius?`, `segTol?`, `minWH?` — exactly the surface. Note: these become NON-readonly mutable types from RecipeShape; that's fine — keep the forward branch (`catalog.ts` shape branch) and `buildCatalogFromRecipe` spreading as-is. If TS complains about `readonly`-vs-mutable assignment anywhere, adjust the spread to a plain copy.)

- [ ] **Step 2: Build + run the full suite.** `npm run build` then `npm test`. Expected: build green; 569 tests green (round-trip + parity + reverse-mapper specs unaffected — the type is structurally compatible). Fix any TS friction from the readonly→mutable change minimally (do not change runtime behavior).

- [ ] **Step 3: Commit.**
```bash
git add libs/board-editor/src/lib/catalog.ts
git commit -m "refactor(board-editor): ShapeDefinition extends Omit<RecipeShape,'kind'> (no silent drift)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `recipe-value-editor.component.ts` — the reusable RecipeValue control

**Files:** Create `libs/board-editor/src/lib/recipe-value-editor.component.ts` + `.spec.ts`. Export from `public-api.ts` only if needed by tests (internal otherwise).

**Interfaces — Produces:**
- `RecipeValueKind = 'number' | 'string' | 'calc' | 'bind' | 'tpl' | 'i18n' | 'when'`
- `recipeValueKind(v: RecipeValue): RecipeValueKind` (exported pure helper): `typeof v === 'number' → 'number'`; `typeof v === 'string' → 'string'`; `'calc' in v → 'calc'`; `'bind' in v → 'bind'`; `'tpl' in v → 'tpl'`; `'i18n' in v → 'i18n'`; else `'when'`.
- `RecipeValueEditorComponent` (selector `studio-recipe-value-editor`): `@Input({required:true}) value: RecipeValue`, `@Input() label = ''`, `@Output() valueChange = EventEmitter<RecipeValue>`.

- [ ] **Step 1: Write the failing test** `recipe-value-editor.component.spec.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RecipeValueEditorComponent, recipeValueKind } from './recipe-value-editor.component';

describe('recipeValueKind', () => {
  it('classifies each RecipeValue kind', () => {
    expect(recipeValueKind(5)).toBe('number');
    expect(recipeValueKind('hi')).toBe('string');
    expect(recipeValueKind({ calc: 'w-1' })).toBe('calc');
    expect(recipeValueKind({ bind: 'w' })).toBe('bind');
    expect(recipeValueKind({ tpl: '{x}' })).toBe('tpl');
    expect(recipeValueKind({ i18n: 'k' })).toBe('i18n');
    expect(recipeValueKind({ when: 'n', then: 1, else: 0 })).toBe('when');
  });
});

describe('RecipeValueEditorComponent', () => {
  it('renders the current kind and emits an edited literal number', () => {
    const f = TestBed.createComponent(RecipeValueEditorComponent);
    f.componentRef.setInput('value', 5);
    f.detectChanges();
    let emitted: unknown;
    f.componentInstance.valueChange.subscribe((v) => (emitted = v));
    // the kind select shows 'number'; edit the number payload to 12
    const numInput = f.nativeElement.querySelector('[data-testid="rv-number"]') as HTMLInputElement;
    expect(numInput).not.toBeNull();
    numInput.value = '12';
    numInput.dispatchEvent(new Event('input'));
    expect(emitted).toBe(12);
  });

  it('switching kind to calc emits a {calc} default and edits the expression', () => {
    const f = TestBed.createComponent(RecipeValueEditorComponent);
    f.componentRef.setInput('value', 0);
    f.detectChanges();
    const emits: unknown[] = [];
    f.componentInstance.valueChange.subscribe((v) => emits.push(v));
    const kindSel = f.nativeElement.querySelector('[data-testid="rv-kind"]') as HTMLSelectElement;
    kindSel.value = 'calc';
    kindSel.dispatchEvent(new Event('change'));
    expect(emits.at(-1)).toEqual({ calc: '' });
    f.detectChanges();
    const calcInput = f.nativeElement.querySelector('[data-testid="rv-calc"]') as HTMLInputElement;
    calcInput.value = 'frame.width / 2';
    calcInput.dispatchEvent(new Event('input'));
    expect(emits.at(-1)).toEqual({ calc: 'frame.width / 2' });
  });

  it('an i18n value is shown read-only and passed through unedited (slice-4 deferral)', () => {
    const f = TestBed.createComponent(RecipeValueEditorComponent);
    f.componentRef.setInput('value', { i18n: 'kf.x' });
    f.detectChanges();
    // kind select disabled OR an "advanced" notice; no editable payload input for i18n.
    expect(f.nativeElement.querySelector('[data-testid="rv-advanced"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run → fail** (`npm test`): module not found.

- [ ] **Step 3: Implement the component.** Standalone, OnPush. A `<select data-testid="rv-kind">` listing the kinds (number/string/calc/bind/tpl, + i18n/when shown but disabled), bound to `recipeValueKind(value)`. Below it, a kind-specific input:
  - number → `<input type="number" data-testid="rv-number">` → emit `+value`.
  - string → `<input type="text" data-testid="rv-string">` → emit the string.
  - calc → `<input type="text" data-testid="rv-calc">` → emit `{ calc: input }`.
  - bind → `<input type="text" data-testid="rv-bind">` → emit `{ bind: input }`.
  - tpl → `<input type="text" data-testid="rv-tpl">` → emit `{ tpl: input }`.
  - i18n / when → a read-only `<span data-testid="rv-advanced">advanced — editable in a later slice</span>`; value passes through unedited.
  - On kind-change: emit the new-kind default (`number`→0, `string`→'', `calc`→`{calc:''}`, `bind`→`{bind:''}`, `tpl`→`{tpl:''}`); for i18n/when the kind option is disabled so a user can't switch INTO them (but a loaded i18n/when value is preserved).
  Each control has a `<label>` (use `@Input() label`). Follow `definition-drawer.component.ts` for input/label markup.

- [ ] **Step 4: Run → pass** (`npm test`). - [ ] **Step 5: Build** (`npm run build`). - [ ] **Step 6: Commit** (`recipe-value-editor.component.ts` + `.spec.ts`), message `feat(board-editor): recipe-value-editor — reusable RecipeValue (literal/expression) control`.

---

### Task 3: `shape-editor.component.ts` — header + draw params + bounds

**Files:** Create `libs/board-editor/src/lib/shape-editor.component.ts` + `.spec.ts`.

**Interfaces — Consumes:** `RecipeValueEditorComponent` (Task 2), `ShapeDefinition` (`./catalog`), `RecipeValue`/`PrimitiveTemplate` (core). **Produces:** `ShapeEditorComponent` (selector `studio-shape-editor`): `@Input({required:true}) shape: ShapeDefinition`, `@Output() shapeChange = EventEmitter<ShapeDefinition>`. Plus an exported pure helper `primitiveValueFields(p: PrimitiveTemplate): string[]` returning the RecipeValue field names present on a primitive (per `p`: rect→present of [x,y,w,h,fill,stroke,rx,when]; circle→[cx,cy,r,fill,stroke,strokeWidth,when]; line→[x1,y1,x2,y2,stroke,strokeWidth,dash,when]; text→[x,y,text,fill,anchor,when]; path→[d,fill,stroke,when]).

- [ ] **Step 1: Write the failing test** `shape-editor.component.spec.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ShapeEditorComponent, primitiveValueFields } from './shape-editor.component';
import type { ShapeDefinition } from './catalog';

const shape: ShapeDefinition = {
  id: 'shape-0', name: 'Zone', kind: 'shape', shapeKind: 'kf.zone', geometry: 'box',
  draw: [{ p: 'rect', x: 0, y: 0, w: { bind: 'w' }, h: { calc: 'h-2' }, fill: '#fff' }],
  bounds: { x: 0, y: 0, w: { calc: 'max(w,1)' }, h: { bind: 'h' } },
  a11y: { role: 'img', name: { i18n: 'kf.zone' } },
};

describe('primitiveValueFields', () => {
  it('lists present RecipeValue fields for a rect', () => {
    expect(primitiveValueFields(shape.draw[0])).toEqual(['x', 'y', 'w', 'h', 'fill']);
  });
});

describe('ShapeEditorComponent', () => {
  it('shows shapeKind read-only and renders a value editor per draw field + per bound', () => {
    const f = TestBed.createComponent(ShapeEditorComponent);
    f.componentRef.setInput('shape', shape);
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('kf.zone');
    // a recipe-value-editor per draw field (5) + per bound (4) = 9 value editors
    expect(f.nativeElement.querySelectorAll('studio-recipe-value-editor').length).toBe(9);
  });

  it('editing a draw param emits the updated shape (immutable)', () => {
    const f = TestBed.createComponent(ShapeEditorComponent);
    f.componentRef.setInput('shape', shape);
    f.detectChanges();
    let emitted: ShapeDefinition | undefined;
    f.componentInstance.shapeChange.subscribe((s) => (emitted = s));
    // simulate the shape editor's own handler for draw field 'fill' of primitive 0
    f.componentInstance.onDrawFieldChange(0, 'fill', '#000');
    expect(emitted!.draw[0]).toMatchObject({ p: 'rect', fill: '#000' });
    expect(emitted!.draw[0]).not.toBe(shape.draw[0]); // immutable
    expect(emitted!.bounds).toBe(shape.bounds); // untouched parts shared
  });

  it('editing a bound emits the updated shape', () => {
    const f = TestBed.createComponent(ShapeEditorComponent);
    f.componentRef.setInput('shape', shape);
    f.detectChanges();
    let emitted: ShapeDefinition | undefined;
    f.componentInstance.shapeChange.subscribe((s) => (emitted = s));
    f.componentInstance.onBoundChange('w', { calc: 'max(w,2)' });
    expect(emitted!.bounds.w).toEqual({ calc: 'max(w,2)' });
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement.** Standalone, OnPush, `imports: [RecipeValueEditorComponent]`.
  - Header: `{{ shape.shapeKind }}` (read-only) + a name `<input>` (→ `shapeChange.emit({...shape, name})`).
  - Draw section: `@for (p of shape.draw; track $index; let i = $index)` → a card per primitive showing `p.p` (the kind) + `@for (field of fields(p))` → `<studio-recipe-value-editor [value]="$any(p)[field]" [label]="field" (valueChange)="onDrawFieldChange(i, field, $event)">`.
  - Bounds section: 4 `<studio-recipe-value-editor>` for x/y/w/h → `onBoundChange('x'|'y'|'w'|'h', $event)`.
  - Handlers:
    - `onDrawFieldChange(i, field, v)`: `this.shapeChange.emit({ ...this.shape, draw: this.shape.draw.map((p,j)=> j===i ? {...p, [field]: v} : p) })`.
    - `onBoundChange(field, v)`: `this.shapeChange.emit({ ...this.shape, bounds: { ...this.shape.bounds, [field]: v } })`.
    - name change → `{...shape, name}`.
  - `primitiveValueFields(p)`: return the per-`p` field list filtered to fields actually present on `p` (so optional absent fields like `rx`/`when` aren't shown). Use a per-`p` ordered key list and `.filter(k => (p as any)[k] !== undefined)`.

- [ ] **Step 4: Run → pass.** - [ ] **Step 5: Build.** - [ ] **Step 6: Commit** (`shape-editor.component.ts` + `.spec.ts`), `feat(board-editor): shape-editor — edit a ShapeDefinition's draw params + bounds as RecipeValues`.

---

### Task 4: Wire the shape editor into the catalog-designer

**Files:** Modify `libs/board-editor/src/lib/catalog-designer.component.ts` (LibView + template + handler + imports). Test: `catalog-designer.component.spec.ts` (add cases). Keep `recipe-roundtrip.spec.ts` green + add a round-trip-after-edit assertion.

**Interfaces — Consumes:** `ShapeEditorComponent` (Task 3).

- [ ] **Step 1: Write the failing tests** (add to `catalog-designer.component.spec.ts`):
```ts
it('selecting a shape part shows the shape editor and editing updates the recipe', () => {
  const f = TestBed.createComponent(CatalogDesignerComponent);
  const c = f.componentInstance;
  f.detectChanges();
  c.openRecipe(kfDrillRecipe);
  f.detectChanges();
  // select the first shape def for editing
  const firstShape = c.definitions().find((d) => d.kind === 'shape')!;
  c.selectLib({ sel: 'shape', id: firstShape.id });
  f.detectChanges();
  expect(f.nativeElement.querySelector('studio-shape-editor')).not.toBeNull();
  // edit: change the shape's name via the host handler
  c.onShapeChange({ ...(firstShape as any), name: 'Edited pitch' });
  f.detectChanges();
  expect(c.definitions().find((d) => d.id === firstShape.id)!.name).toBe('Edited pitch');
});
```

- [ ] **Step 2: Run → fail** (`selectLib` may not accept `{sel:'shape'}`; `onShapeChange` undefined; no `studio-shape-editor`).

- [ ] **Step 3: Implement.**
  - Extend `LibView`: add `| { readonly sel: 'shape'; readonly id: string }`.
  - Add a `selectedShape = computed<ShapeDefinition | null>()`: when `lib().sel === 'shape'`, find the def by id (kind 'shape'), else null.
  - Template: a center-pane branch `@if (selectedShape(); as sh) { <studio-shape-editor [shape]="sh" (shapeChange)="onShapeChange($event)" /> }` (alongside the existing group/card-lib branches). Add `ShapeEditorComponent` to `imports`.
  - `onShapeChange(updated: ShapeDefinition)`: `this.definitions.update(defs => defs.map(d => d.id === updated.id ? updated : d));` (the existing immutable pattern; mirrors `onDrawerDefinitionChange`).
  - Make a shape part selectable: in the Parts list, clicking a shape-kind part calls `selectLib({sel:'shape', id: part.defId})`. (Check how parts surface selection; if the part row has no click-to-edit, add a small "edit" affordance OR route the existing def-select. Minimal: a per-part "Edit" button when the referenced def is a shape. Follow the group-editor parts-row pattern.)

- [ ] **Step 4: Run → pass** (the new case + all prior, incl. round-trip + parity). - [ ] **Step 5: Add a round-trip-after-edit test** in `recipe-roundtrip.spec.ts` or `catalog-from-recipe.spec.ts`: take kfDrillRecipe → `buildCatalogFromRecipe` → edit one shape def's a draw fill literal → `buildRecipeFromCatalog` → assert that shape's draw fill reflects the edit AND `buildCatalogFromRecipe(buildRecipeFromCatalog(edited))` round-trips the edited recipe. - [ ] **Step 6: Build.** - [ ] **Step 7: Commit** (`catalog-designer.component.ts` + spec + roundtrip spec), `feat(board-editor): wire shape editor — select a loaded shape, edit its params, recipe updates`.

---

## Final verification (before PR / wave)
- [ ] `npm test` (lib) green incl. parity + round-trip; `npm run build` green.
- [ ] **Serve-verify** (controller does this): `apps/board-editor-ui` → open kids drill → select a shape → edit a draw param (literal + a calc) → confirm the navigator/JSON reflects the edit, no console errors, no hang. Note: the diagram preview stays the slice-1 placeholder (the meaningful render is slice 5).
- [ ] PR `Closes #<issue>`; verifier wave (local-ci + reviewer + qa-engineer; charter-checker for the Task-1 model change); twin ritual; Producer/Effort/Effect.
