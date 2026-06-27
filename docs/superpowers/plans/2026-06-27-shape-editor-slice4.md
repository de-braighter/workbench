# Shape editor — Slice 4 (recursive i18n/when value editing + a11y section) — Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Make the `recipe-value-editor` author the two remaining `RecipeValue` kinds — `{i18n: key, params?}` and `{when, then, else}` — by becoming **recursive** (nested value editors for params / then / else), and add the shape-editor **a11y section** (role + name + description). This reaches the arc's "edit EVERY construct" ceiling for value-bearing fields.

**Architecture:** `docs/superpowers/specs/2026-06-27-shape-editor-design.md` §3a/§4 (slice 4). The recipe-value-editor (slice 2) currently renders `{i18n}`/`{when}` read-only. Slice 4 makes them editable: an `{i18n}` value → a key `<input>` + a params editor (add/remove string keys, each value a NESTED `<studio-recipe-value-editor>`); a `{when}` value → a prop `<input>` + nested value editors for `then` and `else`. Recursion: a standalone component recurses by adding ITSELF to its `imports` array (Angular 21 supports self-import for recursive templates). All emit-whole-value immutable.

## Global Constraints
- Scope: `domains/studio/libs/board-editor` ONLY (`recipe-value-editor.component.ts` + `shape-editor.component.ts` + specs). ZERO design-system-core/kernel/brick change. No publish. ADR-176-safe.
- Additive + parity-neutral: `catalog-parity`/`catalog-document`/`recipe-roundtrip`/`token-hygiene` stay green. Slice 2/3 editing intact.
- Pattern: standalone, OnPush, signal `@Input`/`@Output`, emit-whole-value immutable. BARE `var(--…)` tokens (token-hygiene gate covers both components). Unique aria-labels; reactive-forms-free.
- **Recursion guard:** a nested value editor must not infinitely render — only `{i18n}` (with params) and `{when}` recurse, and only into their actual child values (finite recipe depth). No self-render when the value is a leaf (number/string/calc/bind/tpl).
- Test: `npm test` from `domains/studio/libs/board-editor` (baseline 594 green). Build: `cd libs/board-editor && npm run build` (NOT root pnpm -r).
- Git: branch `feat-shape-editor-slice4`. Explicit-path commits. Footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Recursive `recipe-value-editor` — `{when}` editing

**Files:** `recipe-value-editor.component.ts` (+ spec). (Do `when` first — simpler than i18n params, and establishes the recursion mechanic.)

**What:** Make `RecipeValueEditorComponent` import itself (`imports: [RecipeValueEditorComponent]` — self-reference for recursion). Enable the `when` kind option (remove its `disabled`). When `currentKind() === 'when'`, render: a `<input data-testid="rv-when-prop">` for the `when` prop string + a nested `<studio-recipe-value-editor [value]="thenValue" (valueChange)="onWhenThen($event)">` (label "then") + one for `else` (label "else"). Switching INTO `when` from a leaf → default `{ when: '', then: 0, else: 0 }`. Handlers emit the whole updated `{when,then,else}`.

- [ ] **Step 1: failing test** (add to `recipe-value-editor.component.spec.ts`):
```ts
it('edits a {when} value: prop + then/else via nested editors', () => {
  const f = TestBed.createComponent(RecipeValueEditorComponent);
  f.componentRef.setInput('value', { when: 'n', then: 1, else: 0 });
  f.detectChanges();
  const emits: unknown[] = [];
  f.componentInstance.valueChange.subscribe((v) => emits.push(v));
  // prop edit
  const prop = f.nativeElement.querySelector('[data-testid="rv-when-prop"]') as HTMLInputElement;
  prop.value = 'selected'; prop.dispatchEvent(new Event('input'));
  expect(emits.at(-1)).toEqual({ when: 'selected', then: 1, else: 0 });
  // then edit via the component handler (nested editor wiring)
  f.componentInstance.onWhenThen(5);
  expect(emits.at(-1)).toEqual({ when: 'n', then: 5, else: 0 }); // (operates on current @Input value)
});
it('switching kind to when emits the when default; when is no longer a disabled option', () => {
  const f = TestBed.createComponent(RecipeValueEditorComponent);
  f.componentRef.setInput('value', 0); f.detectChanges();
  const emits: unknown[] = [];
  f.componentInstance.valueChange.subscribe((v) => emits.push(v));
  f.componentInstance.onKindChange('when');
  expect(emits.at(-1)).toEqual({ when: '', then: 0, else: 0 });
});
```
- [ ] **Step 2: run → fail.**
- [ ] **Step 3: implement.** Self-import for recursion; enable `when` option; `asWhen()` accessor; `onWhenProp(s)`/`onWhenThen(v)`/`onWhenElse(v)` emit the spread-updated when object; `onKindChange` default for `when`. (Keep `i18n` still disabled until Task 2.)
- [ ] **Step 4: run → pass.** - [ ] **Step 5: build.** - [ ] **Step 6: commit** `feat(board-editor): recipe-value-editor — recursive {when} editing`.

---

### Task 2: Recursive `recipe-value-editor` — `{i18n}` editing (key + params)

**Files:** `recipe-value-editor.component.ts` (+ spec).

**What:** Enable the `i18n` kind. When `currentKind() === 'i18n'`: a `<input data-testid="rv-i18n-key">` for the key; a params editor over `params ?? {}` — each entry is a key `<input>` + a nested `<studio-recipe-value-editor>` for its value + a remove button; an "add param" control (key input + add). Switching INTO `i18n` → default `{ i18n: '' }` (no params). Handlers emit the whole `{i18n,params?}` (omit `params` when empty).

- [ ] **Step 1: failing test** (add to spec):
```ts
it('edits an {i18n} value: key + params (nested) + add/remove param', () => {
  const f = TestBed.createComponent(RecipeValueEditorComponent);
  f.componentRef.setInput('value', { i18n: 'k', params: { x: 1 } });
  f.detectChanges();
  const emits: any[] = [];
  f.componentInstance.valueChange.subscribe((v) => emits.push(v));
  const key = f.nativeElement.querySelector('[data-testid="rv-i18n-key"]') as HTMLInputElement;
  key.value = 'kf.x'; key.dispatchEvent(new Event('input'));
  expect(emits.at(-1)).toEqual({ i18n: 'kf.x', params: { x: 1 } });
  f.componentInstance.onI18nParamChange('x', 9);
  expect(emits.at(-1)).toEqual({ i18n: 'k', params: { x: 9 } });
  f.componentInstance.onI18nAddParam('y');           // adds y with a default literal
  expect(emits.at(-1).params).toHaveProperty('y');
  f.componentInstance.onI18nRemoveParam('x');
  expect(emits.at(-1).params).not.toHaveProperty('x');
});
it('an i18n value with no params omits the params key when the last is removed', () => {
  const f = TestBed.createComponent(RecipeValueEditorComponent);
  f.componentRef.setInput('value', { i18n: 'k', params: { x: 1 } }); f.detectChanges();
  const emits: any[] = [];
  f.componentInstance.valueChange.subscribe((v) => emits.push(v));
  f.componentInstance.onI18nRemoveParam('x');
  expect('params' in emits.at(-1)).toBe(false);
});
```
- [ ] **Step 2: run → fail.** - [ ] **Step 3: implement** (enable i18n option; `asI18n()`; `onI18nKey`/`onI18nParamChange(key,v)`/`onI18nAddParam(key)`/`onI18nRemoveParam(key)`; omit empty params; the `rv-advanced` read-only fallback is now removed since i18n/when are editable — but keep a guard for any unknown future kind). - [ ] **Step 4: pass.** - [ ] **Step 5: build.** - [ ] **Step 6: commit** `feat(board-editor): recipe-value-editor — recursive {i18n} key+params editing`.

---

### Task 3: shape-editor a11y section (role + name + description)

**Files:** `shape-editor.component.ts` (+ spec).

**What:** An "A11y" section: a role `<input data-testid="a11y-role">` (string → `{...shape, a11y:{...shape.a11y, role}}`); the name via `<studio-recipe-value-editor [value]="shape.a11y.name" label="Accessible name" (valueChange)="onA11yName($event)">`; an optional description — a `<studio-recipe-value-editor>` when `shape.a11y.description` is present + an "add description" / "remove description" toggle. All immutable emit-whole-shape.

- [ ] **Step 1: failing test** (add to `shape-editor.component.spec.ts`):
```ts
it('a11y: edits role, name (value editor), and adds/removes description', () => {
  const f = TestBed.createComponent(ShapeEditorComponent);
  f.componentRef.setInput('shape', shape); // a11y:{role:'img', name:{i18n:'kf.zone'}}
  f.detectChanges();
  const emits: ShapeDefinition[] = [];
  f.componentInstance.shapeChange.subscribe((s) => emits.push(s));
  f.componentInstance.onA11yRole('group');
  expect(emits.at(-1)!.a11y.role).toBe('group');
  f.componentInstance.onA11yName({ i18n: 'kf.other' });
  expect(emits.at(-1)!.a11y.name).toEqual({ i18n: 'kf.other' });
  f.componentInstance.onA11yAddDescription();
  expect(emits.at(-1)!.a11y.description).toBeDefined();
  f.componentInstance.onA11yRemoveDescription();
  expect('description' in emits.at(-1)!.a11y).toBe(false);
});
```
- [ ] **Step 2: run → fail.** - [ ] **Step 3: implement** the a11y section + `onA11yRole`/`onA11yName`/`onA11yDescription`/`onA11yAddDescription`/`onA11yRemoveDescription` (immutable a11y spread; omit description when removed). Import `RecipeValueEditorComponent` (already imported). - [ ] **Step 4: pass** (incl. parity/round-trip). - [ ] **Step 5: build.** - [ ] **Step 6: commit** `feat(board-editor): shape-editor — a11y section (role + name + description)`.

---

## Final verification
- [ ] `npm test` (lib) green incl. parity + round-trip + token-hygiene; lib build green.
- [ ] **Serve-verify** (controller, CONSOLIDATED slices 3+4): open kids drill → ✎ a shape → exercise geometry select, add/remove a draw primitive (s3), AND edit an a11y name's i18n key + a param, edit a when value (s4) → no console error, no hang.
- [ ] PR `Closes #<issue>`; verifier wave (local-ci + whole-branch opus + qa-engineer); twin ritual; Producer/Effort/Effect.
