# Editor Recipe — Board Designer (slice 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a board editor authorable as declarative data — an `EditorRecipe` that a pure `interpretRecipe()` compiles into a live `BoardRegistry` — and prove it with a thin studio screen whose interactive preview reproduces the hand-written plan-kinds editor.

**Architecture:** Two phases across two repos. **Phase A** adds the recipe schema + `interpretRecipe`/`validateRecipe` to `design-system-core/board-kit` (pure, no DOM), then publishes a new package version. **Phase B** adds a `RecipeDesignerComponent` to `domains/studio` that authors a recipe via reactive forms and renders/edits it live in a `<ds-board-kit>`, with a plan-kinds parity test proving equivalence.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, Angular 21 (standalone, signals, OnPush, Reactive Forms), Nx (design-system), pnpm+npm (studio), `@de-braighter/design-system-core` + `@de-braighter/design-system-angular`.

## Global Constraints

- **Pure core.** Everything in `design-system-core` stays free of DOM / Angular / RN. Port boundary returns plain data; no throws at render time (interpreter is total).
- **ESM import specifiers.** Intra-lib imports use explicit `.js` extensions (e.g. `./recipe.js`), matching the existing board-kit files.
- **`drag` tools require a keyboard path.** `validateRegistry` errors on a `drag` ToolSpec without `keyboard: true`. The interpreter MUST emit `keyboard: true` for `reparent`/`move` tools (the engine's two-click reducer is the alternative).
- **Key-only actions are NOT tools.** `add-child`/`remove` produce `onKey` handlers but NO `ToolSpec` (mirrors `plan-kinds.ts`, where only `reparent` is a tool).
- **Publish boundary.** The studio consumes `design-system-core` as a published package (`^2.2.0`), NOT a `file:` link. Phase B cannot pass CI until Phase A's new version is published. The publish step (Task A6) is the one outward-facing action — get the founder's go before publishing.
- **No substrate-kernel change.** This is board-kit (brick) territory. ADR-176-safe.
- **PR-gated in both repos.** `Producer: orchestrator/claude-opus-4-8 [subagent-driven-development]` · `Effort: standard`. Verifier wave on both PRs.
- **Angular conventions (studio).** Standalone, `input()`/`output()` signals, `OnPush`, Reactive Forms (apply `reactive-forms-cva-governance` when building the form). Verify with `ng build` / `ng test --no-watch` (no `preview_*` browser tools on this machine).

---

# Phase A — design-system-core: schema + interpreter (then publish)

Work in `layers/design-system`. Test: `npx nx test design-system-core`. Build: `npx nx build design-system-core`.
All new files live in `libs/design-system-core/src/public/board-kit/`.

## Task A1: Recipe schema types + `resolveValue`

**Files:**
- Create: `libs/design-system-core/src/public/board-kit/recipe.ts`
- Create: `libs/design-system-core/src/public/board-kit/interpret-recipe.ts` (resolver only this task)
- Test: `libs/design-system-core/src/public/board-kit/interpret-recipe.spec.ts`

**Interfaces:**
- Produces: `EditorRecipe`, `RecipeShape`, `RecipeAction`, `RecipeValue`, `PrimitiveTemplate` (types); `resolveValue(value: RecipeValue, props: Record<string, unknown>): string | number`.

- [ ] **Step 1: Create the schema types** — `recipe.ts`:

```ts
// recipe.ts — declarative board-editor schema (pure types). interpret-recipe.ts
// compiles an EditorRecipe into a live BoardRegistry.

/** A draw-primitive field: literal, prop binding, interpolation, or conditional. */
export type RecipeValue =
  | number
  | string
  | { bind: string }                                         // node.props[bind]
  | { tpl: string }                                          // "{kindRef} · {effectCount}"
  | { when: string; then: RecipeValue; else: RecipeValue };  // truthiness of node.props[when]

/** A draw primitive whose fields are RecipeValues — mirrors SvgPrimitive 1:1. */
export type PrimitiveTemplate =
  | { p: 'circle'; cx: RecipeValue; cy: RecipeValue; r: RecipeValue; fill?: RecipeValue; stroke?: RecipeValue; strokeWidth?: RecipeValue }
  | { p: 'line'; x1: RecipeValue; y1: RecipeValue; x2: RecipeValue; y2: RecipeValue; stroke?: RecipeValue; strokeWidth?: RecipeValue; dash?: RecipeValue }
  | { p: 'rect'; x: RecipeValue; y: RecipeValue; w: RecipeValue; h: RecipeValue; fill?: RecipeValue; stroke?: RecipeValue; rx?: RecipeValue }
  | { p: 'path'; d: RecipeValue; fill?: RecipeValue; stroke?: RecipeValue }
  | { p: 'text'; x: RecipeValue; y: RecipeValue; text: RecipeValue; fill?: RecipeValue; anchor?: RecipeValue };

export type RecipeAction =
  | { op: 'add-child'; on: { key: string[] }; childKind: string; childProps?: Record<string, unknown> }
  | { op: 'remove'; on: { key: string[] } }
  | { op: 'reparent'; on: { gesture: 'drag' } }
  | { op: 'move'; on: { gesture: 'drag' } };

export interface RecipeShape {
  kind: string;
  draw: PrimitiveTemplate[];
  bounds: { x: RecipeValue; y: RecipeValue; w: RecipeValue; h: RecipeValue };
  a11y: { role: string; name: RecipeValue; description?: RecipeValue };
  actions?: RecipeAction[];
}

export interface EditorRecipe {
  id: string;
  name: string;
  shapes: RecipeShape[];
}
```

- [ ] **Step 2: Write the failing test** — `interpret-recipe.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveValue } from './interpret-recipe.js';

describe('resolveValue', () => {
  const props = { label: 'Warm-up', kindRef: 'intervention', effectCount: 2, zero: 0 };
  it('returns literals unchanged', () => {
    expect(resolveValue(186, props)).toBe(186);
    expect(resolveValue('var(--x)', props)).toBe('var(--x)');
  });
  it('binds a prop (number stays number, else string)', () => {
    expect(resolveValue({ bind: 'effectCount' }, props)).toBe(2);
    expect(resolveValue({ bind: 'label' }, props)).toBe('Warm-up');
    expect(resolveValue({ bind: 'missing' }, props)).toBe('');
  });
  it('interpolates a template', () => {
    expect(resolveValue({ tpl: '{kindRef} · {effectCount}' }, props)).toBe('intervention · 2');
    expect(resolveValue({ tpl: '{missing}!' }, props)).toBe('!');
  });
  it('branches on truthiness', () => {
    const v = { when: 'effectCount', then: 'has', else: 'none' } as const;
    expect(resolveValue(v, props)).toBe('has');
    expect(resolveValue({ when: 'zero', then: 'has', else: 'none' }, props)).toBe('none');
  });
});
```

- [ ] **Step 3: Run the test, verify it fails**

Run: `npx nx test design-system-core -- interpret-recipe`
Expected: FAIL — `resolveValue` is not exported / not defined.

- [ ] **Step 4: Implement `resolveValue`** — start `interpret-recipe.ts`:

```ts
// interpret-recipe.ts — compile a declarative EditorRecipe into a live BoardRegistry.
import type { RecipeValue } from './recipe.js';

type Props = Record<string, unknown>;

const asText = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** Resolve one RecipeValue against a node's props. Total: never throws. */
export function resolveValue(value: RecipeValue, props: Props): string | number {
  if (typeof value === 'number' || typeof value === 'string') return value;
  if ('bind' in value) {
    const raw = props[value.bind];
    return typeof raw === 'number' ? raw : asText(raw);
  }
  if ('tpl' in value) {
    return value.tpl.replace(/\{(\w+)\}/g, (_m, k: string) => asText(props[k]));
  }
  return props[value.when] ? resolveValue(value.then, props) : resolveValue(value.else, props);
}
```

- [ ] **Step 5: Run the test, verify it passes**

Run: `npx nx test design-system-core -- interpret-recipe`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/recipe.ts \
        libs/design-system-core/src/public/board-kit/interpret-recipe.ts \
        libs/design-system-core/src/public/board-kit/interpret-recipe.spec.ts
git commit -m "feat(board-kit): EditorRecipe schema + RecipeValue resolver"
```

## Task A2: `interpretRecipe` — DRAW half (draw/bounds/describe)

**Files:**
- Modify: `interpret-recipe.ts`
- Test: `interpret-recipe.spec.ts`

**Interfaces:**
- Consumes: `resolveValue` (A1), `RenderDefinition`/`SvgPrimitive`/`Bounds`/`A11yDescriptor`/`BoardRegistry` from `./render-node.js`.
- Produces: `interpretRecipe(recipe: EditorRecipe, opts?: { idFactory?: () => string }): BoardRegistry` (DRAW half this task; EDIT half in A3).

- [ ] **Step 1: Write the failing test** (append to `interpret-recipe.spec.ts`):

```ts
import { interpretRecipe } from './interpret-recipe.js';
import type { EditorRecipe } from './recipe.js';
import type { RenderNode } from './render-node.js';

const card: EditorRecipe = {
  id: 'demo', name: 'Demo',
  shapes: [{
    kind: 'demo.card',
    draw: [
      { p: 'rect', x: 0, y: 0, w: 186, h: 52, rx: 8, fill: 'var(--bg-2)', stroke: 'var(--accent)' },
      { p: 'text', x: 93, y: 26, anchor: 'middle', text: { bind: 'label' } },
    ],
    bounds: { x: 0, y: 0, w: 186, h: 52 },
    a11y: { role: 'img', name: { tpl: 'Card: {label}' },
      description: { when: 'effectCount', then: { tpl: '{effectCount} effect(s)' }, else: 'no effects' } },
  }],
};
const node: RenderNode = { id: 'n1', kind: 'demo.card', props: { label: 'Hi', effectCount: 0 }, children: [] };
const ctx = { frame: { id: 'f', width: 200, height: 80, layout: { mode: 'free' as const } } };

describe('interpretRecipe — draw half', () => {
  it('draws resolved primitives', () => {
    const def = interpretRecipe(card).get('demo.card')!;
    expect(def.draw(node, ctx)).toEqual([
      { p: 'rect', x: 0, y: 0, w: 186, h: 52, rx: 8, fill: 'var(--bg-2)', stroke: 'var(--accent)' },
      { p: 'text', x: 93, y: 26, anchor: 'middle', text: 'Hi', fill: undefined },
    ]);
  });
  it('computes bounds', () => {
    expect(interpretRecipe(card).get('demo.card')!.bounds(node, ctx)).toEqual({ x: 0, y: 0, w: 186, h: 52 });
  });
  it('describes with conditional description', () => {
    expect(interpretRecipe(card).get('demo.card')!.describe(node)).toEqual({ role: 'img', name: 'Card: Hi', description: 'no effects' });
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx nx test design-system-core -- interpret-recipe`
Expected: FAIL — `interpretRecipe` not exported.

- [ ] **Step 3: Implement the DRAW half** (append to `interpret-recipe.ts`):

```ts
import type {
  A11yDescriptor, Bounds, BoardRegistry, RenderDefinition, RenderNode, SvgPrimitive,
} from './render-node.js';
import type { EditorRecipe, PrimitiveTemplate, RecipeShape, RecipeValue } from './recipe.js';

const propsOf = (node: RenderNode): Props =>
  (typeof node.props === 'object' && node.props !== null ? node.props : {}) as Props;

const num = (v: RecipeValue, p: Props): number => {
  const r = resolveValue(v, p);
  return typeof r === 'number' ? r : Number(r) || 0;
};
const str = (v: RecipeValue | undefined, p: Props): string | undefined =>
  v === undefined ? undefined : asText(resolveValue(v, p));

function resolvePrimitive(t: PrimitiveTemplate, p: Props): SvgPrimitive {
  switch (t.p) {
    case 'circle':
      return { p: 'circle', cx: num(t.cx, p), cy: num(t.cy, p), r: num(t.r, p),
        fill: str(t.fill, p), stroke: str(t.stroke, p), strokeWidth: t.strokeWidth !== undefined ? num(t.strokeWidth, p) : undefined };
    case 'line':
      return { p: 'line', x1: num(t.x1, p), y1: num(t.y1, p), x2: num(t.x2, p), y2: num(t.y2, p),
        stroke: str(t.stroke, p), strokeWidth: t.strokeWidth !== undefined ? num(t.strokeWidth, p) : undefined, dash: str(t.dash, p) };
    case 'rect':
      return { p: 'rect', x: num(t.x, p), y: num(t.y, p), w: num(t.w, p), h: num(t.h, p),
        fill: str(t.fill, p), stroke: str(t.stroke, p), rx: t.rx !== undefined ? num(t.rx, p) : undefined };
    case 'path':
      return { p: 'path', d: asText(resolveValue(t.d, p)), fill: str(t.fill, p), stroke: str(t.stroke, p) };
    case 'text':
      return { p: 'text', x: num(t.x, p), y: num(t.y, p), text: asText(resolveValue(t.text, p)),
        fill: str(t.fill, p), anchor: str(t.anchor, p) as 'start' | 'middle' | 'end' | undefined };
  }
}

export interface InterpretOptions { idFactory?: () => string; }

let seq = 0;
const defaultIdFactory = (): string => `rk-${++seq}`;

function buildDefinition(shape: RecipeShape, _idFactory: () => string): RenderDefinition {
  return {
    kind: shape.kind,
    draw: (node) => shape.draw.map((t) => resolvePrimitive(t, propsOf(node))),
    bounds: (node): Bounds => {
      const p = propsOf(node);
      return { x: num(shape.bounds.x, p), y: num(shape.bounds.y, p), w: num(shape.bounds.w, p), h: num(shape.bounds.h, p) };
    },
    describe: (node): A11yDescriptor => {
      const p = propsOf(node);
      return {
        role: shape.a11y.role,
        name: asText(resolveValue(shape.a11y.name, p)),
        description: shape.a11y.description !== undefined ? asText(resolveValue(shape.a11y.description, p)) : undefined,
      };
    },
  };
}

export function interpretRecipe(recipe: EditorRecipe, opts?: InterpretOptions): BoardRegistry {
  const idFactory = opts?.idFactory ?? defaultIdFactory;
  return new Map(recipe.shapes.map((s) => [s.kind, buildDefinition(s, idFactory)]));
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx nx test design-system-core -- interpret-recipe`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/interpret-recipe.ts \
        libs/design-system-core/src/public/board-kit/interpret-recipe.spec.ts
git commit -m "feat(board-kit): interpretRecipe draw/bounds/describe half"
```

## Task A3: `interpretRecipe` — EDIT half (tools/hitTest/onKey/onGesture)

**Files:**
- Modify: `interpret-recipe.ts`
- Test: `interpret-recipe.spec.ts`

**Interfaces:**
- Consumes: `insertChild`/`removeNode`/`reparentNode` from `./tree-ops.js`; `Gesture`/`KeyboardSample` from `./gesture.js`; `EditResult`/`EditContext`/`HitResult`/`Point`/`ToolSpec` from `./render-node.js`.
- Produces: shapes with `actions` interpret to a `RenderDefinition.edit` block (key/gesture dispatch to built-in ops, deriving `EditIntent`).

- [ ] **Step 1: Write the failing test** (append):

```ts
import type { Gesture } from './gesture.js';

const editable: EditorRecipe = {
  id: 'pt', name: 'PT',
  shapes: [{
    kind: 'pt.node',
    draw: [{ p: 'rect', x: 0, y: 0, w: 186, h: 52 }],
    bounds: { x: 0, y: 0, w: 186, h: 52 },
    a11y: { role: 'img', name: { bind: 'label' } },
    actions: [
      { op: 'add-child', on: { key: ['a', 'A', 'Insert'] }, childKind: 'pt.node', childProps: { label: 'New' } },
      { op: 'remove', on: { key: ['Delete', 'Backspace'] } },
      { op: 'reparent', on: { gesture: 'drag' } },
    ],
  }],
};
const tree = (): RenderNode => ({
  id: 'root', kind: 'pt.node', props: { label: 'root' }, children: [
    { id: 'a', kind: 'pt.node', props: { label: 'a' }, children: [] },
    { id: 'b', kind: 'pt.node', props: { label: 'b' }, children: [] },
  ],
});
const editCtx = { frame: { id: 'f', width: 400, height: 200, layout: { mode: 'tree' as const } } };

describe('interpretRecipe — edit half', () => {
  const def = () => interpretRecipe(editable, { idFactory: () => 'new-1' }).get('pt.node')!;

  it('derives only gesture tools, with keyboard:true on drag', () => {
    expect(def().edit!.tools).toEqual([{ id: 'reparent', label: 'Move under…', gesture: 'drag', keyboard: true }]);
  });
  it('hitTests the bounds rect', () => {
    expect(def().edit!.hitTest(tree().children[0], { x: 10, y: 10 }, editCtx)).toEqual({ nodeId: 'a' });
    expect(def().edit!.hitTest(tree().children[0], { x: 999, y: 10 }, editCtx)).toBeNull();
  });
  it('add-child key inserts a fresh node', () => {
    const r = def().edit!.onKey({ key: 'a' }, { nodeId: 'a' }, tree(), editCtx)!;
    expect(r.intent).toEqual({ op: 'insert', parentId: 'a', node: { id: 'new-1', kind: 'pt.node', props: { label: 'New' }, children: [] } });
  });
  it('remove key deletes the node', () => {
    const r = def().edit!.onKey({ key: 'Delete' }, { nodeId: 'b' }, tree(), editCtx)!;
    expect(r.intent).toEqual({ op: 'remove', nodeId: 'b' });
  });
  it('drag reparents using ctx.dropTarget', () => {
    const g: Gesture = { type: 'drag', x1: 0, y1: 0, x2: 0, y2: 0 };
    const r = def().edit!.onGesture(g, { nodeId: 'a' }, tree(), { ...editCtx, dropTarget: { nodeId: 'b' } })!;
    expect(r.intent).toEqual({ op: 'reparent', nodeId: 'a', newParentId: 'b' });
  });
  it('read-only shape (no actions) has no edit block', () => {
    const ro = interpretRecipe({ id: 'r', name: 'r', shapes: [{ kind: 'k', draw: [{ p: 'rect', x: 0, y: 0, w: 1, h: 1 }], bounds: { x: 0, y: 0, w: 1, h: 1 }, a11y: { role: 'img', name: 'x' } }] });
    expect(ro.get('k')!.edit).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx nx test design-system-core -- interpret-recipe`
Expected: FAIL — `edit` is undefined on the definition.

- [ ] **Step 3: Implement the EDIT half** (add to `interpret-recipe.ts` imports + helpers + wire into `buildDefinition`):

```ts
// add to imports:
import type { EditContext, EditResult, HitResult, Point, ToolSpec } from './render-node.js';
import type { Gesture, KeyboardSample } from './gesture.js';
import { insertChild, removeNode, reparentNode } from './tree-ops.js';
import type { RecipeAction } from './recipe.js';
```

```ts
// helpers (module scope):
const rectHitFor = (shape: RecipeShape) =>
  (node: RenderNode, at: Point): HitResult | null => {
    const p = propsOf(node);
    const x = num(shape.bounds.x, p), y = num(shape.bounds.y, p);
    const w = num(shape.bounds.w, p), h = num(shape.bounds.h, p);
    return at.x >= x && at.x <= x + w && at.y >= y && at.y <= y + h ? { nodeId: node.id } : null;
  };

function toolsFor(actions: readonly RecipeAction[]): ToolSpec[] {
  const tools: ToolSpec[] = [];
  for (const a of actions) {
    if (a.op === 'reparent') tools.push({ id: 'reparent', label: 'Move under…', gesture: 'drag', keyboard: true });
    if (a.op === 'move') tools.push({ id: 'move', label: 'Move', gesture: 'drag', keyboard: true });
  }
  return tools;
}

function onKeyFor(actions: readonly RecipeAction[], idFactory: () => string) {
  return (k: KeyboardSample, target: { nodeId: string | null }, tree: RenderNode): EditResult | null => {
    const id = target.nodeId;
    if (!id) return null;
    for (const a of actions) {
      if (a.op === 'add-child' && a.on.key.includes(k.key)) {
        const node: RenderNode = { id: idFactory(), kind: a.childKind, props: a.childProps ?? {}, children: [] };
        return { tree: insertChild(tree, id, node), intent: { op: 'insert', parentId: id, node } };
      }
      if (a.op === 'remove' && a.on.key.includes(k.key)) {
        const next = removeNode(tree, id);
        return next === tree ? null : { tree: next, intent: { op: 'remove', nodeId: id } };
      }
    }
    return null;
  };
}

function onGestureFor(actions: readonly RecipeAction[]) {
  return (g: Gesture, target: { nodeId: string | null }, tree: RenderNode, ctx: EditContext): EditResult | null => {
    if (g.type !== 'drag') return null;
    const id = target.nodeId;
    if (!id) return null;
    for (const a of actions) {
      if (a.op === 'reparent') {
        const newParentId = ctx.dropTarget?.nodeId;
        if (!newParentId) return null;
        const next = reparentNode(tree, id, newParentId);
        return next === tree ? null : { tree: next, intent: { op: 'reparent', nodeId: id, newParentId } };
      }
      if (a.op === 'move') return { tree, intent: { op: 'move', nodeId: id, x: g.x2, y: g.y2 } };
    }
    return null;
  };
}
```

```ts
// in buildDefinition(), before `return def`, change to build a mutable def then attach edit:
function buildDefinition(shape: RecipeShape, idFactory: () => string): RenderDefinition {
  const def: RenderDefinition = {
    kind: shape.kind,
    draw: (node) => shape.draw.map((t) => resolvePrimitive(t, propsOf(node))),
    bounds: (node) => { const p = propsOf(node); return { x: num(shape.bounds.x, p), y: num(shape.bounds.y, p), w: num(shape.bounds.w, p), h: num(shape.bounds.h, p) }; },
    describe: (node) => { const p = propsOf(node); return { role: shape.a11y.role, name: asText(resolveValue(shape.a11y.name, p)), description: shape.a11y.description !== undefined ? asText(resolveValue(shape.a11y.description, p)) : undefined }; },
  };
  if (shape.actions && shape.actions.length > 0) {
    def.edit = {
      tools: toolsFor(shape.actions),
      hitTest: rectHitFor(shape),
      onKey: onKeyFor(shape.actions, idFactory),
      onGesture: onGestureFor(shape.actions),
    };
  }
  return def;
}
```

> Note: `def` is typed `RenderDefinition` (whose `edit` is optional) — assigning `def.edit` afterward is fine. Remove the now-duplicated inline `draw/bounds/describe` from A2 if you re-declare them here.

- [ ] **Step 4: Run, verify it passes**

Run: `npx nx test design-system-core -- interpret-recipe`
Expected: PASS (all draw + edit tests).

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/interpret-recipe.ts \
        libs/design-system-core/src/public/board-kit/interpret-recipe.spec.ts
git commit -m "feat(board-kit): interpretRecipe edit half (built-in op dispatch)"
```

## Task A4: `validateRecipe` (author-time gate)

**Files:**
- Create: `libs/design-system-core/src/public/board-kit/validate-recipe.ts`
- Test: `libs/design-system-core/src/public/board-kit/validate-recipe.spec.ts`

**Interfaces:**
- Consumes: `interpretRecipe` (A2/A3), `validateRegistry` from `./validate-registry.js`.
- Produces: `validateRecipe(recipe: EditorRecipe): RecipeValidationError[]`; `RecipeValidationError { shape: string; code: 'duplicate-kind' | 'empty-draw' | 'unknown-child-kind' | 'registry'; detail: string }`.

- [ ] **Step 1: Write the failing test** — `validate-recipe.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateRecipe } from './validate-recipe.js';
import type { EditorRecipe } from './recipe.js';

const ok: EditorRecipe = { id: 'r', name: 'r', shapes: [
  { kind: 'a', draw: [{ p: 'rect', x: 0, y: 0, w: 1, h: 1 }], bounds: { x: 0, y: 0, w: 1, h: 1 }, a11y: { role: 'img', name: 'a' },
    actions: [{ op: 'add-child', on: { key: ['a'] }, childKind: 'a' }] },
]};

describe('validateRecipe', () => {
  it('passes a well-formed recipe', () => { expect(validateRecipe(ok)).toEqual([]); });
  it('flags a duplicate kind', () => {
    const r: EditorRecipe = { ...ok, shapes: [...ok.shapes, ok.shapes[0]] };
    expect(validateRecipe(r)).toContainEqual({ shape: 'a', code: 'duplicate-kind', detail: 'a' });
  });
  it('flags an empty draw', () => {
    const r: EditorRecipe = { id: 'r', name: 'r', shapes: [{ kind: 'b', draw: [], bounds: { x: 0, y: 0, w: 1, h: 1 }, a11y: { role: 'img', name: 'b' } }] };
    expect(validateRecipe(r)).toContainEqual({ shape: 'b', code: 'empty-draw', detail: 'shape has no draw primitives' });
  });
  it('flags an unknown childKind', () => {
    const r: EditorRecipe = { id: 'r', name: 'r', shapes: [{ kind: 'a', draw: [{ p: 'rect', x: 0, y: 0, w: 1, h: 1 }], bounds: { x: 0, y: 0, w: 1, h: 1 }, a11y: { role: 'img', name: 'a' }, actions: [{ op: 'add-child', on: { key: ['a'] }, childKind: 'ghost' }] }] };
    expect(validateRecipe(r)).toContainEqual({ shape: 'a', code: 'unknown-child-kind', detail: 'ghost' });
  });
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `npx nx test design-system-core -- validate-recipe`
Expected: FAIL — `validateRecipe` not defined.

- [ ] **Step 3: Implement** — `validate-recipe.ts`:

```ts
// validate-recipe.ts — author-time gate over an EditorRecipe.
import type { EditorRecipe } from './recipe.js';
import { interpretRecipe } from './interpret-recipe.js';
import { validateRegistry } from './validate-registry.js';

export interface RecipeValidationError {
  shape: string;
  code: 'duplicate-kind' | 'empty-draw' | 'unknown-child-kind' | 'registry';
  detail: string;
}

export function validateRecipe(recipe: EditorRecipe): RecipeValidationError[] {
  const errors: RecipeValidationError[] = [];
  const kinds = new Set<string>();
  for (const shape of recipe.shapes) {
    if (kinds.has(shape.kind)) errors.push({ shape: shape.kind, code: 'duplicate-kind', detail: shape.kind });
    kinds.add(shape.kind);
    if (shape.draw.length === 0) errors.push({ shape: shape.kind, code: 'empty-draw', detail: 'shape has no draw primitives' });
  }
  for (const shape of recipe.shapes) {
    for (const a of shape.actions ?? []) {
      if (a.op === 'add-child' && !kinds.has(a.childKind)) {
        errors.push({ shape: shape.kind, code: 'unknown-child-kind', detail: a.childKind });
      }
    }
  }
  for (const e of validateRegistry(interpretRecipe(recipe))) {
    errors.push({ shape: e.kind, code: 'registry', detail: `${e.code}: ${e.detail}` });
  }
  return errors;
}
```

- [ ] **Step 4: Run, verify it passes**

Run: `npx nx test design-system-core -- validate-recipe`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/validate-recipe.ts \
        libs/design-system-core/src/public/board-kit/validate-recipe.spec.ts
git commit -m "feat(board-kit): validateRecipe author-time gate"
```

## Task A5: Public exports + registry-conformance test

**Files:**
- Modify: `libs/design-system-core/src/public/board-kit/index.ts`
- Test: `libs/design-system-core/src/public/board-kit/interpret-recipe.spec.ts`

**Interfaces:**
- Produces: from `@de-braighter/design-system-core` — types `EditorRecipe`, `RecipeShape`, `RecipeAction`, `RecipeValue`, `PrimitiveTemplate`, `InterpretOptions`, `RecipeValidationError`; functions `interpretRecipe`, `resolveValue`, `validateRecipe`.

- [ ] **Step 1: Write the failing conformance test** (append to `interpret-recipe.spec.ts`):

```ts
import { validateRegistry } from './validate-registry.js';

it('interpreted registry passes validateRegistry (a11y/tool gate)', () => {
  expect(validateRegistry(interpretRecipe(editable))).toEqual([]);
});
```

- [ ] **Step 2: Run, verify it passes already** (the interpreter satisfies the gate)

Run: `npx nx test design-system-core -- interpret-recipe`
Expected: PASS — confirms `reparent` emitted `keyboard: true`.

- [ ] **Step 3: Add public exports** — append to `index.ts`:

```ts
export type { RecipeValue, PrimitiveTemplate, RecipeAction, RecipeShape, EditorRecipe } from './recipe.js';
export type { InterpretOptions } from './interpret-recipe.js';
export { interpretRecipe, resolveValue } from './interpret-recipe.js';
export type { RecipeValidationError } from './validate-recipe.js';
export { validateRecipe } from './validate-recipe.js';
```

- [ ] **Step 4: Build the lib, verify the public API**

Run: `npx nx build design-system-core`
Expected: build succeeds. If an api-extractor / public-API gate runs, run its `api:update` per the repo's convention and commit the updated API report.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/index.ts \
        libs/design-system-core/src/public/board-kit/interpret-recipe.spec.ts
git commit -m "feat(board-kit): export recipe interpreter public surface"
```

## Task A6: Version bump + publish (GATED — founder go required)

**Files:**
- Modify: `libs/design-system-core/package.json` (`version`)

- [ ] **Step 1: Read the current version**

Run: `node -p "require('./libs/design-system-core/package.json').version"`
Expected: e.g. `2.5.0`. Bump the **minor** (additive surface) → `2.6.0`.

- [ ] **Step 2: Open the design-system PR + run the verifier wave**

Push the branch, open the PR (body carries `Producer:`/`Effort:`/`Effect: findings`), run the wave (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`, `isolation: worktree`). Drain → merge per the twin ritual.

- [ ] **Step 3: Publish (after merge; founder go required)**

Follow the design-system release flow (`npx nx build design-system-core` then publish to GitHub Packages with `GITHUB_TOKEN`). This is the one outward-facing action — confirm before publishing. Verify the new version is resolvable:

Run: `npm view @de-braighter/design-system-core version`
Expected: `2.6.0`.

---

# Phase B — domains/studio: the Recipe Designer screen

Work in `domains/studio`. Test: `cd apps/studio-ui && npm run test` (`ng test --no-watch`). Build: `npm run build`. The new core version (A6) must be published first.

## Task B1: Bump dep + plan-kinds parity proof

**Files:**
- Modify: `apps/studio-ui/package.json` (dep range, if needed)
- Create: `apps/studio-ui/src/app/recipe-designer/plan-kinds.recipe.ts`
- Test: `apps/studio-ui/src/app/recipe-designer/plan-kinds-parity.spec.ts`

**Interfaces:**
- Consumes: published `interpretRecipe` + types; local `planKindsRegistry` from `../plan-tree/plan-kinds`.
- Produces: `planKindsRecipe: EditorRecipe` re-expressing `plan.root` + `plan.intervention`.

- [ ] **Step 1: Refresh the dependency**

Ensure `apps/studio-ui/package.json` allows the new core (`^2.2.0` already admits `2.6.0`). Run `npm install` so the lockfile resolves `@de-braighter/design-system-core@2.6.0`. Verify:

Run: `node -p "require('@de-braighter/design-system-core').interpretRecipe ? 'ok' : 'missing'"` (from `apps/studio-ui`)
Expected: `ok`.

- [ ] **Step 2: Author the plan-kinds recipe** — `plan-kinds.recipe.ts`:

```ts
// plan-kinds.recipe.ts — the hand-written planKindsRegistry re-expressed as data.
// Parity target for the slice-1 de-risking proof.
import type { EditorRecipe } from '@de-braighter/design-system-core';

export const planKindsRecipe: EditorRecipe = {
  id: 'plan-tree', name: 'Plan Tree Editor',
  shapes: [
    {
      kind: 'plan.root',
      draw: [
        { p: 'rect', x: 0, y: 0, w: 186, h: 52, rx: 8, fill: 'var(--bg-3, #161b2c)', stroke: 'var(--line-1, #2a2f40)' },
        { p: 'text', x: 93, y: 31, anchor: 'middle', text: { bind: 'label' }, fill: 'var(--fg-1, #e8ecf7)' },
      ],
      bounds: { x: 0, y: 0, w: 186, h: 52 },
      a11y: { role: 'group', name: { tpl: 'Plan root: {label}' } },
      actions: [{ op: 'add-child', on: { key: ['a', 'A', 'Insert'] }, childKind: 'plan.intervention', childProps: { label: 'New intervention', kindRef: 'intervention', effectCount: 0 } }],
    },
    {
      kind: 'plan.intervention',
      draw: [
        { p: 'rect', x: 0, y: 0, w: 186, h: 52, rx: 8, fill: 'var(--bg-2, #0f1320)', stroke: 'var(--accent, #22d39a)' },
        { p: 'text', x: 93, y: 23, anchor: 'middle', text: { bind: 'label' }, fill: 'var(--fg-1, #e8ecf7)' },
        { p: 'text', x: 93, y: 40, anchor: 'middle', fill: 'var(--fg-2, #94a3d2)',
          text: { when: 'effectCount', then: { tpl: '{kindRef} · {effectCount} effect(s)' }, else: { tpl: '{kindRef}' } } },
      ],
      bounds: { x: 0, y: 0, w: 186, h: 52 },
      a11y: { role: 'img', name: { tpl: 'Intervention: {label}' },
        description: { when: 'effectCount', then: { tpl: '{effectCount} effect declaration(s)' }, else: 'no effects' } },
      actions: [
        { op: 'add-child', on: { key: ['a', 'A', 'Insert'] }, childKind: 'plan.intervention', childProps: { label: 'New intervention', kindRef: 'intervention', effectCount: 0 } },
        { op: 'remove', on: { key: ['Delete', 'Backspace'] } },
        { op: 'reparent', on: { gesture: 'drag' } },
      ],
    },
  ],
};
```

- [ ] **Step 3: Write the parity test** — `plan-kinds-parity.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { interpretRecipe } from '@de-braighter/design-system-core';
import type { RenderNode } from '@de-braighter/design-system-core';
import { planKindsRegistry } from '../plan-tree/plan-kinds';
import { planKindsRecipe } from './plan-kinds.recipe';

const ctx = { frame: { id: 'f', width: 400, height: 200, layout: { mode: 'tree' as const } } };
const intervention = (over: Record<string, unknown> = {}): RenderNode => ({ id: 'n', kind: 'plan.intervention', props: { label: 'Warm-up', kindRef: 'intervention', effectCount: 0, ...over }, children: [] });

describe('plan-kinds recipe parity', () => {
  const hand = planKindsRegistry();
  const cooked = interpretRecipe(planKindsRecipe, { idFactory: () => 'new-1' });

  it('draws intervention identically (no effects)', () => {
    expect(cooked.get('plan.intervention')!.draw(intervention(), ctx)).toEqual(hand.get('plan.intervention')!.draw(intervention(), ctx));
  });
  it('draws intervention identically (with effects — conditional subtitle)', () => {
    const n = intervention({ effectCount: 3 });
    expect(cooked.get('plan.intervention')!.draw(n, ctx)).toEqual(hand.get('plan.intervention')!.draw(n, ctx));
  });
  it('describes intervention identically (conditional description)', () => {
    expect(cooked.get('plan.intervention')!.describe(intervention())).toEqual(hand.get('plan.intervention')!.describe(intervention()));
    expect(cooked.get('plan.intervention')!.describe(intervention({ effectCount: 3 }))).toEqual(hand.get('plan.intervention')!.describe(intervention({ effectCount: 3 })));
  });
  it('reparents identically', () => {
    const tree: RenderNode = { id: 'root', kind: 'plan.root', props: { label: 'r' }, children: [intervention(), { ...intervention(), id: 'm' }] };
    const g = { type: 'drag' as const, x1: 0, y1: 0, x2: 0, y2: 0 };
    const drop = { ...ctx, dropTarget: { nodeId: 'm' } };
    const a = cooked.get('plan.intervention')!.edit!.onGesture(g, { nodeId: 'n' }, tree, drop);
    const b = hand.get('plan.intervention')!.edit!.onGesture(g, { nodeId: 'n' }, tree, drop);
    expect(a!.intent).toEqual(b!.intent);
  });
});
```

> Parity note: the hand-written `draw` uses two `{tpl}`-equivalent strings; the recipe reproduces the conditional subtitle with `{when}` (resolves spec O1). If any assertion fails, it has localized the exact schema gap — that is the de-risking signal, not a blocker.

- [ ] **Step 4: Run, verify it passes**

Run: `cd apps/studio-ui && npm run test -- plan-kinds-parity`
Expected: PASS — the data version is indistinguishable from the hand-written one.

- [ ] **Step 5: Commit**

```bash
git add apps/studio-ui/package.json apps/studio-ui/package-lock.json \
        apps/studio-ui/src/app/recipe-designer/plan-kinds.recipe.ts \
        apps/studio-ui/src/app/recipe-designer/plan-kinds-parity.spec.ts
git commit -m "test(studio): plan-kinds recipe parity proof against hand-written registry"
```

## Task B2: RecipeDesignerComponent — interactive preview from a static recipe

**Files:**
- Create: `apps/studio-ui/src/app/recipe-designer/sample-tree.ts`
- Create: `apps/studio-ui/src/app/recipe-designer/recipe-designer.component.ts`
- Test: `apps/studio-ui/src/app/recipe-designer/recipe-designer.component.spec.ts`

**Interfaces:**
- Consumes: `interpretRecipe`, `BoardKitComponent`, `Frame`, `RenderNode`, `EditResult`.
- Produces: `RecipeDesignerComponent` rendering a `<ds-board-kit>` over a sample tree; `sampleTreeFor(kind: string): RenderNode`.

- [ ] **Step 1: Sample tree helper** — `sample-tree.ts`:

```ts
// sample-tree.ts — a tiny root + two children of the authored kind, for the preview.
import type { RenderNode } from '@de-braighter/design-system-core';

export function sampleTreeFor(kind: string): RenderNode {
  const child = (id: string, label: string): RenderNode => ({ id, kind, props: { label, kindRef: 'intervention', effectCount: 0 }, children: [] });
  return { id: 'preview-root', kind, props: { label: 'Sample root', kindRef: 'intervention', effectCount: 0 }, children: [child('s1', 'Node A'), child('s2', 'Node B')] };
}
```

- [ ] **Step 2: Write the failing component test** — `recipe-designer.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { RecipeDesignerComponent } from './recipe-designer.component';

describe('RecipeDesignerComponent', () => {
  beforeEach(async () => { await TestBed.configureTestingModule({ imports: [RecipeDesignerComponent] }).compileComponents(); });

  it('renders a <ds-board-kit> preview from the recipe', async () => {
    const f = TestBed.createComponent(RecipeDesignerComponent);
    f.detectChanges(); await f.whenStable();
    expect(f.nativeElement.querySelector('ds-board-kit')).not.toBeNull();
    const ids = [...f.nativeElement.querySelectorAll('[data-node-id]')].map((g: Element) => g.getAttribute('data-node-id'));
    expect(ids).toEqual(expect.arrayContaining(['preview-root', 's1', 's2']));
  });
});
```

- [ ] **Step 3: Run, verify it fails**

Run: `cd apps/studio-ui && npm run test -- recipe-designer`
Expected: FAIL — component does not exist.

- [ ] **Step 4: Implement the component (preview-only this task)** — `recipe-designer.component.ts`:

```ts
// recipe-designer.component.ts — author an EditorRecipe; preview + edit it live.
import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { BoardKitComponent } from '@de-braighter/design-system-angular';
import { interpretRecipe } from '@de-braighter/design-system-core';
import type { EditorRecipe, Frame, RenderNode } from '@de-braighter/design-system-core';
import { planKindsRecipe } from './plan-kinds.recipe';
import { sampleTreeFor } from './sample-tree';

let seq = 0;
const freshId = (): string => `rk-${++seq}`;

@Component({
  selector: 'studio-recipe-designer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BoardKitComponent],
  styles: [`
    :host { display: block; padding: 1rem; color: var(--fg-1, #e8ecf7); }
    .layout { display: grid; grid-template-columns: 340px 1fr; gap: 1rem; align-items: start; }
    .board { border: 1px solid var(--line-1, rgba(148,163,210,.18)); border-radius: 8px; background: var(--bg-1, #0a0d14); }
    .hint { color: var(--fg-2, #94a3d2); font-size: .85rem; }
  `],
  template: `
    <h1>Recipe Designer</h1>
    <p class="hint">Author a board editor as data. The preview interprets your recipe live — tap a node, press <kbd>A</kbd> to add, <kbd>Delete</kbd> to remove, drag to re-parent.</p>
    <div class="layout">
      <section aria-label="Recipe form"><!-- form added in B3 --></section>
      <div class="board">
        <ds-board-kit [tree]="previewTree()" [registry]="registry()" [frame]="frame()"
          ariaLabel="Recipe preview" (commit)="onCommit($event)" />
      </div>
    </div>
  `,
})
export class RecipeDesignerComponent {
  readonly recipe = signal<EditorRecipe>(planKindsRecipe);
  readonly registry = computed(() => interpretRecipe(this.recipe(), { idFactory: freshId }));
  readonly previewTree = signal<RenderNode>(sampleTreeFor('plan.intervention'));
  readonly frame = computed<Frame>(() => ({ id: 'recipe-preview', width: 640, height: 320, layout: { mode: 'tree', xGap: 214, yGap: 104 } }));

  onCommit(result: { tree: RenderNode }): void { this.previewTree.set(result.tree); }
}
```

- [ ] **Step 5: Run, verify it passes**

Run: `cd apps/studio-ui && npm run test -- recipe-designer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio-ui/src/app/recipe-designer/sample-tree.ts \
        apps/studio-ui/src/app/recipe-designer/recipe-designer.component.ts \
        apps/studio-ui/src/app/recipe-designer/recipe-designer.component.spec.ts
git commit -m "feat(studio): Recipe Designer interactive preview (static recipe)"
```

## Task B3: Reactive form — author the shape + actions, live-update the preview

> Apply the `reactive-forms-cva-governance` skill. The form drives a single shape (slice-1 scope): `kind`, a primitives FormArray, bounds, a11y, and action toggles. On every change it rebuilds the `recipe` signal, which re-interprets the preview.

**Files:**
- Create: `apps/studio-ui/src/app/recipe-designer/recipe-form.ts`
- Modify: `apps/studio-ui/src/app/recipe-designer/recipe-designer.component.ts`
- Test: `apps/studio-ui/src/app/recipe-designer/recipe-designer.component.spec.ts`

**Interfaces:**
- Produces: `buildRecipeFromForm(value: RecipeFormValue): EditorRecipe`; `RecipeFormValue` (kind, primitives[], bounds, a11y, actions flags).

- [ ] **Step 1: Pure form→recipe mapper** — `recipe-form.ts`:

```ts
// recipe-form.ts — pure mapping from the designer form's value to an EditorRecipe.
import type { EditorRecipe, PrimitiveTemplate, RecipeAction, RecipeValue } from '@de-braighter/design-system-core';

export interface PrimRow {
  p: 'rect' | 'text' | 'circle' | 'line';
  // generic numeric fields (used per-shape); text/value handling below
  x?: number; y?: number; w?: number; h?: number; rx?: number;
  cx?: number; cy?: number; r?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  fill?: string; stroke?: string; anchor?: 'start' | 'middle' | 'end';
  // text only:
  textMode?: 'lit' | 'bind' | 'tpl';
  textValue?: string;
}

export interface RecipeFormValue {
  kind: string;
  primitives: PrimRow[];
  bounds: { x: number; y: number; w: number; h: number };
  a11yRole: string;
  a11yName: string; // a {tpl}
  actions: { addChild: boolean; remove: boolean; reparent: boolean };
}

function textValue(row: PrimRow): RecipeValue {
  const v = row.textValue ?? '';
  if (row.textMode === 'bind') return { bind: v };
  if (row.textMode === 'tpl') return { tpl: v };
  return v;
}

function toPrimitive(row: PrimRow): PrimitiveTemplate {
  switch (row.p) {
    case 'rect': return { p: 'rect', x: row.x ?? 0, y: row.y ?? 0, w: row.w ?? 0, h: row.h ?? 0, rx: row.rx, fill: row.fill, stroke: row.stroke };
    case 'text': return { p: 'text', x: row.x ?? 0, y: row.y ?? 0, text: textValue(row), fill: row.fill, anchor: row.anchor };
    case 'circle': return { p: 'circle', cx: row.cx ?? 0, cy: row.cy ?? 0, r: row.r ?? 0, fill: row.fill, stroke: row.stroke };
    case 'line': return { p: 'line', x1: row.x1 ?? 0, y1: row.y1 ?? 0, x2: row.x2 ?? 0, y2: row.y2 ?? 0, stroke: row.stroke };
  }
}

export function buildRecipeFromForm(value: RecipeFormValue): EditorRecipe {
  const actions: RecipeAction[] = [];
  if (value.actions.addChild) actions.push({ op: 'add-child', on: { key: ['a', 'A', 'Insert'] }, childKind: value.kind, childProps: { label: 'New', kindRef: 'intervention', effectCount: 0 } });
  if (value.actions.remove) actions.push({ op: 'remove', on: { key: ['Delete', 'Backspace'] } });
  if (value.actions.reparent) actions.push({ op: 'reparent', on: { gesture: 'drag' } });
  return {
    id: 'authored', name: 'Authored editor',
    shapes: [{
      kind: value.kind,
      draw: value.primitives.map(toPrimitive),
      bounds: value.bounds,
      a11y: { role: value.a11yRole, name: { tpl: value.a11yName } },
      actions: actions.length ? actions : undefined,
    }],
  };
}
```

- [ ] **Step 2: Write the failing test** (append to `recipe-designer.component.spec.ts`):

```ts
import { buildRecipeFromForm } from './recipe-form';

it('maps a form value to a single-shape recipe', () => {
  const r = buildRecipeFromForm({
    kind: 'demo.card', primitives: [{ p: 'rect', x: 0, y: 0, w: 100, h: 40 }, { p: 'text', x: 50, y: 22, anchor: 'middle', textMode: 'bind', textValue: 'label' }],
    bounds: { x: 0, y: 0, w: 100, h: 40 }, a11yRole: 'img', a11yName: 'Card: {label}',
    actions: { addChild: true, remove: true, reparent: false },
  });
  expect(r.shapes[0].kind).toBe('demo.card');
  expect(r.shapes[0].draw[1]).toEqual({ p: 'text', x: 50, y: 22, anchor: 'middle', text: { bind: 'label' }, fill: undefined });
  expect(r.shapes[0].actions?.map((a) => a.op)).toEqual(['add-child', 'remove']);
});

it('editing the form kind re-interprets the preview registry', async () => {
  const f = TestBed.createComponent(RecipeDesignerComponent);
  const c = f.componentInstance;
  f.detectChanges();
  c.form.patchValue({ kind: 'demo.card' });
  c.form.controls.bounds.patchValue({ x: 0, y: 0, w: 100, h: 40 });
  f.detectChanges();
  expect(c.recipe().shapes[0].kind).toBe('demo.card');
});
```

- [ ] **Step 3: Run, verify it fails**

Run: `cd apps/studio-ui && npm run test -- recipe-designer`
Expected: FAIL — `buildRecipeFromForm` / `c.form` not present.

- [ ] **Step 4: Wire the reactive form into the component.** Add `ReactiveFormsModule` to imports, build a typed form, and replace the `recipe` signal source with the form value via `toSignal`/`valueChanges`. Replace the component body's recipe wiring and the empty `<section>` with the form controls:

```ts
// add imports:
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { buildRecipeFromForm, type RecipeFormValue } from './recipe-form';
```

```ts
// in @Component imports: [BoardKitComponent, ReactiveFormsModule]
// replace the class body's recipe source:
  private readonly fb = new FormBuilder().nonNullable;
  readonly form = this.fb.group({
    kind: 'plan.intervention',
    primitives: this.fb.control<RecipeFormValue['primitives']>([
      { p: 'rect', x: 0, y: 0, w: 186, h: 52, rx: 8, fill: 'var(--bg-2,#0f1320)', stroke: 'var(--accent,#22d39a)' },
      { p: 'text', x: 93, y: 30, anchor: 'middle', textMode: 'bind', textValue: 'label' },
    ]),
    bounds: this.fb.group({ x: 0, y: 0, w: 186, h: 52 }),
    a11yRole: 'img',
    a11yName: 'Node: {label}',
    actions: this.fb.group({ addChild: true, remove: true, reparent: true }),
  });
  private readonly formValue = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  readonly recipe = computed<EditorRecipe>(() => buildRecipeFromForm(this.formValue() as RecipeFormValue));
  readonly registry = computed(() => interpretRecipe(this.recipe(), { idFactory: freshId }));
  readonly previewTree = signal<RenderNode>(sampleTreeFor('plan.intervention'));
```

> Keep `previewTree` seeded from the initial kind. When `kind` changes, reseed: add an `effect` that re-bases the preview tree to `sampleTreeFor(this.form.getRawValue().kind)` (so the preview nodes match the authored kind). The template's `<section>` gets inputs bound to `form` controls (a `kind` text input, an `a11yName` input, three action checkboxes, and a read-only primitives list) — wire them with `[formGroup]="form"` per the reactive-forms governance skill.

- [ ] **Step 5: Run, verify it passes**

Run: `cd apps/studio-ui && npm run test -- recipe-designer`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/studio-ui/src/app/recipe-designer/recipe-form.ts \
        apps/studio-ui/src/app/recipe-designer/recipe-designer.component.ts \
        apps/studio-ui/src/app/recipe-designer/recipe-designer.component.spec.ts
git commit -m "feat(studio): reactive form authors the shape + actions, live preview"
```

## Task B4: Recipe JSON panel + validation surface

**Files:**
- Modify: `recipe-designer.component.ts`
- Test: `recipe-designer.component.spec.ts`

**Interfaces:**
- Consumes: `validateRecipe` from core.
- Produces: a read-only JSON view of `recipe()` + an inline list of `validateRecipe(recipe())` errors.

- [ ] **Step 1: Write the failing test** (append):

```ts
it('shows the recipe JSON and reports validation errors', async () => {
  const f = TestBed.createComponent(RecipeDesignerComponent);
  const c = f.componentInstance;
  f.detectChanges();
  expect(c.recipeJson()).toContain('"kind": "plan.intervention"');
  c.form.controls.primitives.setValue([]); // empty draw -> validation error
  f.detectChanges();
  expect(c.errors().some((e) => e.code === 'empty-draw')).toBe(true);
});
```

- [ ] **Step 2: Run, verify it fails**

Run: `cd apps/studio-ui && npm run test -- recipe-designer`
Expected: FAIL — `recipeJson` / `errors` not defined.

- [ ] **Step 3: Implement** — add to the component:

```ts
import { validateRecipe } from '@de-braighter/design-system-core';
// ...
  readonly recipeJson = computed(() => JSON.stringify(this.recipe(), null, 2));
  readonly errors = computed(() => validateRecipe(this.recipe()));
```

Add to the template (inside the form `<section>`): a `<pre>{{ recipeJson() }}</pre>` and `@if (errors().length) { <ul role="alert">@for (e of errors(); track $index) { <li>{{ e.shape }}: {{ e.detail }}</li>} </ul> }`.

- [ ] **Step 4: Run, verify it passes**

Run: `cd apps/studio-ui && npm run test -- recipe-designer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio-ui/src/app/recipe-designer/recipe-designer.component.ts \
        apps/studio-ui/src/app/recipe-designer/recipe-designer.component.spec.ts
git commit -m "feat(studio): recipe JSON view + inline validation"
```

## Task B5: Route + nav

**Files:**
- Modify: `apps/studio-ui/src/app/app.routes.ts`
- Modify: `apps/studio-ui/src/app/app.html` (add a nav link)
- Test: `apps/studio-ui/src/app/app.spec.ts` (route smoke)

- [ ] **Step 1: Add the route** — `app.routes.ts`:

```ts
import { Routes } from '@angular/router';
import { PlanAuthorComponent } from './plan-author.component';
import { RecipeDesignerComponent } from './recipe-designer/recipe-designer.component';

export const routes: Routes = [
  { path: '', component: PlanAuthorComponent },
  { path: 'recipe-designer', component: RecipeDesignerComponent },
];
```

- [ ] **Step 2: Add a nav link** — in `app.html`, add `<a routerLink="/recipe-designer">Recipe Designer</a>` (ensure `RouterLink` is imported in `App`). Run a route smoke test asserting the link/route resolves.

- [ ] **Step 3: Build + full test**

Run: `cd apps/studio-ui && npm run build && npm run test`
Expected: build OK, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/studio-ui/src/app/app.routes.ts apps/studio-ui/src/app/app.html apps/studio-ui/src/app/app.ts apps/studio-ui/src/app/app.spec.ts
git commit -m "feat(studio): route + nav to the Recipe Designer"
```

- [ ] **Step 5: Open the studio PR + verifier wave + twin ritual** (as in A6 step 2, for `domains/studio`).

---

## Self-Review

**Spec coverage:**
- §2 schema → A1 (`recipe.ts`). ✓
- §3 `RecipeValue` variants → A1 (`resolveValue`). ✓
- §4 interpreter draw/bounds/describe → A2; edit half → A3; totality/`idFactory` → A3; placement (core) → all of Phase A; public exports → A5. ✓
- §4 `validateRecipe` → A4. ✓
- §5 Recipe Designer (two panes, live interpret, interactive preview, JSON panel, inline validation) → B2 (preview) + B3 (form) + B4 (JSON+validation). ✓
- §6 data flow (form→signal→interpret→board, preview-local tree) → B2/B3. ✓
- §7 tests: interpreter units → A1–A4; parity proof → B1; component tests → B2–B4. ✓ (Parity relocated to studio per dependency direction — documented at plan top.)
- §8 O1 (conditional) → resolved via `{when}` in B1 fixture; O2 (rect-only hit) → A3 `rectHitFor`; O3 (move schema-complete, preview affordance deferred) → A3 emits move intent, no free-layout preview. ✓
- §10 boundaries / PR-gated / publish boundary → A6 + B5 + Global Constraints. ✓

**Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". The B3 template wiring references concrete control names and the reactive-forms skill; the primitives editor is intentionally a read-only list in slice 1 (the form seeds two primitives) — full per-primitive add/remove UI is slice 2 (non-goal). Flagged, not hidden.

**Type consistency:** `resolveValue`/`num`/`str`/`asText`/`propsOf` consistent A1↔A2↔A3. `interpretRecipe(recipe, { idFactory })` signature identical across A2/A3/B1/B2. `RecipeValidationError` fields match A4↔B4. `buildRecipeFromForm`/`RecipeFormValue` consistent B3↔tests. ToolSpec for `reparent` (`keyboard:true`) matches the Global Constraint + parity expectation.

**Known slice-1 simplification (honest):** the B3 form seeds + edits a bounded shape (kind, two seeded primitives, bounds, a11y name, action toggles). A general add-any-primitive editor + multi-shape recipes are explicit non-goals (spec §2) deferred to slice 2.
