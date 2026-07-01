# Foundry Cockpit Phase 2A — Execute Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Phase-1 Execute view production-complete — resolve every deferred finding from the Phase-1 whole-branch review: board selection highlight, the silent action no-op, the a11y pass, and two small robustness fixes.

**Architecture:** Foundry-only (`domains/foundry`). The board highlight is a pure-recipe change (a `when:{bind:'__selected'}` selection-ring primitive — verified that `interpretRecipe` emits `when`-gated primitives only when truthy, so NO `ds-board-kit`/design-system change is needed). The a11y fixes are component-template changes. The null-stub log is a one-liner in the cockpit router.

**Tech Stack:** Angular 21 (standalone, signals, OnPush), vitest (jsdom), Express 5, `@de-braighter/design-system-core` recipe types.

## Global Constraints

- ZERO kernel change (ADR-176) — no `layers/substrate` touch; nothing under `apps/cockpit` or `src/cockpit` touches the kernel schema.
- ZERO design-system change — the board highlight is achieved purely in `planTreeToRecipe` (foundry), not by modifying the published `ds-board-kit`.
- Angular: standalone, OnPush, signal `input()`/`output()`; no `@Input()`/`@Output()` decorators.
- ESM `.js` import extensions on all relative imports.
- `planTreeToRecipe` / `planNodesToRenderTree` stay PURE (no Angular deps, no side effects).
- WCAG 2.2 AA for all interactive elements (native controls, `aria-current`/`aria-pressed`, no keyboard scroll side-effects).
- Every component change must keep `npm run build` green (Angular `strictTemplates` is the substantive wiring gate) and its focused spec green.
- All work in `domains/foundry` on branch `feat/cockpit-phase2a-hardening`.

---

## File Map

- Modify: `apps/cockpit/src/app/shared/plan-tree-recipe.ts` — add selection-ring primitive per shape (T1)
- Modify: `apps/cockpit/src/app/shared/plan-tree-recipe.spec.ts` — test the selection-ring (T1)
- Modify: `src/cockpit/cockpit.router.ts` — null-stub warning log on frontier/action (T2)
- Modify: `apps/cockpit/src/app/execute/frontier-panel/frontier-panel.component.ts` — native `<button>` per item (T3)
- Modify: `apps/cockpit/src/app/execute/node-detail/node-detail-panel.component.ts` — split MODE_ICON glyph/label (T4)
- Modify: `apps/cockpit/src/app/shell/cockpit-shell.component.ts` — treeId regex excludes `new` (T5)
- Modify: `apps/cockpit/src/app/shared/plan-tree-render.ts` — cycle guard in `buildNode` (T6)
- Modify: `apps/cockpit/src/app/shared/plan-tree-render.spec.ts` — cycle-guard test (T6)

---

### Task 1: Board selection highlight via recipe `when:{bind:'__selected'}`

The Phase-1 review found `__selected` is set on RenderNode props but nothing draws it, so a frontier-click never highlights the board node. Fix: each recipe shape draws a selection-ring rect gated on `when:{bind:'__selected'}`. Verified: `interpretRecipe` emits a `when`-bearing primitive only when it resolves truthy, and the board re-renders when the `tree` input's `__selected` changes.

**Files:**
- Modify: `apps/cockpit/src/app/shared/plan-tree-recipe.ts`
- Modify: `apps/cockpit/src/app/shared/plan-tree-recipe.spec.ts`

**Interfaces:**
- Consumes: `PrimitiveTemplate` (rect variant has `when?: RecipeValue`), `RecipeValue` `{bind}` form
- Produces: each `RecipeShape.draw` includes a final selection-ring rect with `when: { bind: '__selected' }`

- [ ] **Step 1: Write the failing test**

Add to `plan-tree-recipe.spec.ts`:
```typescript
it('each shape draws a selection-ring primitive gated on __selected', () => {
  const nodes = [node('n1', 'product'), node('n2', 'work-item', 'n1')];
  const recipe = planTreeToRecipe(nodes, {}, undefined);
  for (const shape of recipe.shapes) {
    const ring = shape.draw.find(
      d => d.p === 'rect' && typeof d.when === 'object' && d.when !== null && 'bind' in d.when && (d.when as { bind: string }).bind === '__selected',
    );
    expect(ring, `shape ${shape.kind} must have a __selected ring`).toBeDefined();
  }
});
```

- [ ] **Step 2: Run to verify it fails**

```
cd /d/development/projects/de-braighter/domains/foundry/apps/cockpit && npm test -- plan-tree-recipe 2>&1 | tail -8
```
Expected: the new test fails (no selection-ring primitive yet).

- [ ] **Step 3: Add the selection ring to `shapeForKind`**

In `plan-tree-recipe.ts`, inside `shapeForKind`, append a selection-ring rect as the LAST `draw` entry (drawn on top), gated on `__selected`. The ring traces the shape's bounds with a highlight stroke + no fill:
```typescript
// Selection ring — drawn only on the selected node (interpretRecipe emits `when`-gated
// primitives only when truthy). Foundry-local highlight; no ds-board-kit change needed.
{
  p: 'rect',
  x: -2, y: -2, w: w + 4, h: h + 4, rx: rx + 2,
  fill: 'none',
  stroke: 'var(--accent, #22d39a)',
  when: { bind: '__selected' },
},
```
(Add it after the existing label/icon primitives in the `draw` array. Use the same `w`/`h`/`rx` already in scope in `shapeForKind`.)

- [ ] **Step 4: Run tests to verify pass**

```
cd /d/development/projects/de-braighter/domains/foundry/apps/cockpit && npm test -- plan-tree-recipe 2>&1 | tail -8
```
Expected: all plan-tree-recipe tests pass (including the new one).

- [ ] **Step 5: Build**

```
cd /d/development/projects/de-braighter/domains/foundry/apps/cockpit && npm run build 2>&1 | tail -2
```
Expected: `Application bundle generation complete.`

- [ ] **Step 6: Commit**

```bash
cd /d/development/projects/de-braighter/domains/foundry
git add apps/cockpit/src/app/shared/plan-tree-recipe.ts apps/cockpit/src/app/shared/plan-tree-recipe.spec.ts
git commit -m "feat(cockpit): board selection-ring highlight via recipe when:__selected"
```

---

### Task 2: Null-stub action-loop warning log

When the foundry server runs without `STUDIO_JWT_*` keys, `planTreeStore` is a null stub: `/api/frontier` returns empty and `/api/action` 404s. The Phase-1 review flagged this as a silent surprise. Add a one-time clear warning so the founder knows actions are no-ops until a durable store/tree exists.

**Files:**
- Modify: `src/cockpit/cockpit.router.ts`

**Interfaces:**
- Consumes: `CockpitRouterDeps` (already carries `planTreeStore`)
- Produces: a `console.warn` emitted once when the router is created with the null-stub store

- [ ] **Step 1: Detect the null stub at router creation**

In `createCockpitRouter`, after destructuring `opts`, detect whether the store is the no-op stub. The stub's `load` always resolves `null`; the real store is `FoundryPrismaPlanTreeStore`. The server passes the stub only in keyless mode. Add a flag the server sets explicitly — change `CockpitRouterDeps` to include `storeIsLive: boolean` and have `server.ts` pass `storeIsLive: !!prisma`. Then in `createCockpitRouter`:
```typescript
if (!opts.storeIsLive) {
  console.warn(
    '[cockpit] planTreeStore is the no-op stub (no STUDIO_JWT_* keys): ' +
    '/api/frontier returns empty and /api/action is a no-op (404). ' +
    'Deploy a durable tree or set STUDIO_JWT_* to enable the action loop.',
  );
}
```
Add `storeIsLive: boolean;` to the `CockpitRouterDeps` interface.

- [ ] **Step 2: Pass the flag from `server.ts`**

In `src/dashboard/server.ts`, where `createCockpitRouter({...})` is called, add `storeIsLive: !!prisma,` to the options object.

- [ ] **Step 3: Typecheck + tests**

```
cd /d/development/projects/de-braighter/domains/foundry && npm run typecheck 2>&1 | tail -3 && npm test -- dashboard 2>&1 | grep -E "Test Files|Tests" | head -3
```
Expected: typecheck exit 0; dashboard tests still pass (the warn is harmless; if a test asserts on clean stderr, adjust — but the existing dashboard tests construct the router with a store and should be unaffected).

- [ ] **Step 4: Commit**

```bash
cd /d/development/projects/de-braighter/domains/foundry
git add src/cockpit/cockpit.router.ts src/dashboard/server.ts
git commit -m "feat(foundry): warn when cockpit action loop runs against the null-stub store"
```

---

### Task 3: FrontierPanel a11y — native `<button>` per item

The Phase-1 review found `role="listbox"` + `tabindex="0"` on every option violates the APG roving-tabindex contract, and `(keydown.space)` lacks `preventDefault()` (space both selects AND scrolls). Replace the custom listbox with a list of native `<button>`s — buttons handle Enter/Space natively (no scroll, no manual keydown handlers) and convey selection via `aria-pressed`.

**Files:**
- Modify: `apps/cockpit/src/app/execute/frontier-panel/frontier-panel.component.ts`

**Interfaces:**
- Consumes: existing `frontier`/`selectedId` inputs, `nodeSelected`/`refreshRequested` outputs, `sorted()` computed, `modeIcon()`
- Produces: a `<ul>` of `<li><button>` items; no `role="listbox"`/`role="option"`/manual `keydown`

- [ ] **Step 1: Replace the list template**

Change the list markup so the container is a plain labeled `<ul>` and each item is a native `<button>` (keyboard + click handled natively, `aria-pressed` for selection):
```html
<ul class="fp-list" aria-label="Frontier nodes">
  @for (entry of sorted(); track entry.nodeId) {
    <li>
      <button
        type="button"
        class="fp-entry"
        [class.selected]="entry.nodeId === selectedId()"
        [class.human]="entry.executionMode === 'human'"
        [attr.aria-pressed]="entry.nodeId === selectedId()"
        (click)="nodeSelected.emit(entry.nodeId)"
      >
        <span class="fp-mode-icon" aria-hidden="true">{{ modeIcon(entry.executionMode) }}</span>
        <span class="fp-title-text">{{ entry.title }}</span>
        <span class="fp-kind-badge">{{ entry.kind }}</span>
      </button>
    </li>
  }
</ul>
```
Remove the old `role="listbox"`, `role="option"`, `[attr.aria-selected]`, `tabindex="0"`, `(keydown.enter)`, `(keydown.space)`.

- [ ] **Step 2: Adjust the styles**

Update the `.fp-list`/`.fp-entry` CSS so the `<ul>` has no bullets/margin and the `<button>` looks like the old row (full width, left-aligned, inherits font/color, pointer cursor):
```css
.fp-list { list-style: none; margin: 0; padding: 0; }
.fp-entry { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 12px; background: none; border: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.fp-entry:hover, .fp-entry.selected { background: var(--bg-elev, #161b2c); }
.fp-entry.human { border-left: 3px solid var(--color-warning, #f59e0b); }
```
(Keep the existing `.fp-mode-icon` / `.fp-title-text` / `.fp-kind-badge` rules.)

- [ ] **Step 3: Build + spec**

```
cd /d/development/projects/de-braighter/domains/foundry/apps/cockpit && npm run build 2>&1 | tail -2 && npm test -- frontier-panel 2>&1 | grep -E "Test Files|Tests" | head -3
```
Expected: build complete; frontier-panel spec passes.

- [ ] **Step 4: Commit**

```bash
cd /d/development/projects/de-braighter/domains/foundry
git add apps/cockpit/src/app/execute/frontier-panel/frontier-panel.component.ts
git commit -m "fix(cockpit): FrontierPanel native button-per-item a11y (roving tabindex + space scroll)"
```

---

### Task 4: NodeDetail a11y — split MODE_ICON glyph from label

The Phase-1 review found `MODE_ICON` values like `'⚙ Script'` are single text nodes, so screen readers announce the glyph name ("gear") as noise. Split each into `{ icon, label }` so the glyph is rendered in an `aria-hidden` span and only the label is announced.

**Files:**
- Modify: `apps/cockpit/src/app/execute/node-detail/node-detail-panel.component.ts`

**Interfaces:**
- Consumes: `executionMode()` computed
- Produces: `modeBadge()` returns `{ icon, label }`; template renders `<span aria-hidden>{{icon}}</span> {{label}}`

- [ ] **Step 1: Change the MODE_ICON map + modeBadge computed**

Replace the string map with an `{icon,label}` map:
```typescript
const MODE_ICON: Record<string, { icon: string; label: string }> = {
  deterministic: { icon: '⚙', label: 'Script' },
  ai:            { icon: '✦', label: 'AI' },
  human:         { icon: '⊙', label: 'Human' },
  hybrid:        { icon: '⚙✦', label: 'Hybrid' },
};
```
Change the `modeBadge` computed to return the object (with a fallback):
```typescript
readonly modeBadge = computed(() => MODE_ICON[this.executionMode()] ?? { icon: '', label: this.executionMode() });
```

- [ ] **Step 2: Update the template**

Where the badge was rendered as `{{ modeBadge() }}`, render the split form:
```html
<span class="badge mode-badge"><span aria-hidden="true">{{ modeBadge().icon }}</span> {{ modeBadge().label }}</span>
```

- [ ] **Step 3: Build + spec**

```
cd /d/development/projects/de-braighter/domains/foundry/apps/cockpit && npm run build 2>&1 | tail -2 && npm test -- node-detail 2>&1 | grep -E "Test Files|Tests" | head -3
```
Expected: build complete; node-detail spec passes.

- [ ] **Step 4: Commit**

```bash
cd /d/development/projects/de-braighter/domains/foundry
git add apps/cockpit/src/app/execute/node-detail/node-detail-panel.component.ts
git commit -m "fix(cockpit): NodeDetail split mode glyph from label for screen readers"
```

---

### Task 5: Shell treeId regex excludes the draft route

The Phase-1 review found `/\/tree\/([^/]+)/` matches `/tree/new/draft` → breadcrumb shows "new" and the Execute tab links to `/tree/new/execute`. Exclude the `new` sentinel so the shell chrome (breadcrumb + tabs) does not appear on the draft route.

**Files:**
- Modify: `apps/cockpit/src/app/shell/cockpit-shell.component.ts`

**Interfaces:**
- Consumes: the `url()` signal
- Produces: `treeId()` returns `null` when the matched segment is `new`

- [ ] **Step 1: Guard the regex result**

Change the `treeId` computed so a matched `new` segment yields `null`:
```typescript
readonly treeId = computed(() => {
  const match = /\/tree\/([^/]+)/.exec(this.url() ?? '');
  const id = match ? match[1] : null;
  return id === 'new' ? null : id;
});
```

- [ ] **Step 2: Build + spec**

```
cd /d/development/projects/de-braighter/domains/foundry/apps/cockpit && npm run build 2>&1 | tail -2 && npm test -- shell 2>&1 | grep -E "Test Files|Tests" | head -3
```
Expected: build complete; shell spec passes.

- [ ] **Step 3: Commit**

```bash
cd /d/development/projects/de-braighter/domains/foundry
git add apps/cockpit/src/app/shell/cockpit-shell.component.ts
git commit -m "fix(cockpit): shell hides breadcrumb/tabs on the /tree/new/draft route"
```

---

### Task 6: `buildNode` cycle guard

The Phase-1 review noted `planNodesToRenderTree`'s recursive `buildNode` has no visited-set, so a malformed payload with a `childrenIds` cycle would stack-overflow. The single-parent-tree invariant makes this nominal, but a cheap guard makes the pure adapter total.

**Files:**
- Modify: `apps/cockpit/src/app/shared/plan-tree-render.ts`
- Modify: `apps/cockpit/src/app/shared/plan-tree-render.spec.ts`

**Interfaces:**
- Consumes: existing `buildNode` recursion
- Produces: `buildNode` carries a `visited: Set<string>`; a node id already in the set returns a leaf stub instead of recursing

- [ ] **Step 1: Write the failing test**

Add to `plan-tree-render.spec.ts`:
```typescript
it('does not infinite-loop on a childrenIds cycle (malformed payload)', () => {
  // root -> a -> root (cycle); buildNode must terminate, not stack-overflow
  const nodes = [
    makeNode('root', null, 'product', ['a']),
    makeNode('a', 'root', 'work-item', ['root']),
  ];
  expect(() => planNodesToRenderTree(nodes, {}, undefined)).not.toThrow();
  const tree = planNodesToRenderTree(nodes, {}, undefined);
  expect(tree.id).toBe('root');
});
```

- [ ] **Step 2: Run to verify it fails**

```
cd /d/development/projects/de-braighter/domains/foundry/apps/cockpit && npm test -- plan-tree-render 2>&1 | tail -8
```
Expected: the new test fails (RangeError: Maximum call stack size exceeded) before the guard.

- [ ] **Step 3: Add the visited-set guard**

In `plan-tree-render.ts`, thread a `visited` set through `buildNode`:
```typescript
function buildNode(id: string, visited: Set<string>): RenderNode {
  if (visited.has(id)) {
    return { id, kind: 'work-item', props: { label: id }, children: [] };
  }
  visited.add(id);
  const n = byId.get(id);
  // ... existing body, but the recursive call becomes:
  //   children: n.childrenIds.map(cid => buildNode(cid, visited)),
}
```
Update the initial call from `buildNode(root.id)` to `buildNode(root.id, new Set())`, and the recursive `n.childrenIds.map(buildNode)` to `n.childrenIds.map(cid => buildNode(cid, visited))`. Keep the existing missing-node stub for ids not in `byId`.

- [ ] **Step 4: Run tests to verify pass**

```
cd /d/development/projects/de-braighter/domains/foundry/apps/cockpit && npm test -- plan-tree-render 2>&1 | tail -8
```
Expected: all plan-tree-render tests pass (the cycle test terminates).

- [ ] **Step 5: Build + commit**

```bash
cd /d/development/projects/de-braighter/domains/foundry/apps/cockpit && npm run build 2>&1 | tail -2
cd /d/development/projects/de-braighter/domains/foundry
git add apps/cockpit/src/app/shared/plan-tree-render.ts apps/cockpit/src/app/shared/plan-tree-render.spec.ts
git commit -m "fix(cockpit): cycle guard in planNodesToRenderTree buildNode recursion"
```

---

## Self-Review

**Coverage of the Phase-1 deferred backlog:**

| Deferred finding | Task | Covered? |
|---|---|---|
| Board doesn't highlight frontier-selected node / dead `__selected` | T1 | ✅ (recipe `when:__selected` ring; `__selected` now consumed) |
| Silent action no-op against null-stub store | T2 | ✅ (warn log) |
| FrontierPanel listbox roving-tabindex + space scroll | T3 | ✅ (native buttons) |
| NodeDetail MODE_ICON emoji noise | T4 | ✅ (icon/label split) |
| Shell treeId regex matches `/tree/new/draft` | T5 | ✅ |
| `buildNode` cycle guard | T6 | ✅ |

**Out of scope (deferred to Cycle 2B — Instances):** the *full* action write-loop end-to-end (claim/release mutating a real tree) needs charter-bearing trees in the `planTreeStore`, which is what Instances instantiates. T2 makes the current no-op explicit; 2B makes the loop functional.

**Placeholder scan:** none — every step has concrete code.

**Type consistency:** `CockpitRouterDeps.storeIsLive: boolean` added in T2 and passed from `server.ts` in the same task. `MODE_ICON` shape change in T4 is self-contained (map + computed + template all updated in one task). `buildNode` signature change in T6 updates both call sites in the same task.
