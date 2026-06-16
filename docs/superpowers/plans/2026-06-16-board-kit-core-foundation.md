# Board Kit — Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the platform-agnostic core of the generic recursive presentation-tree renderer+editor ("Board Kit") — its contract types and pure engine (tree ops, layout, gesture classification, snapshot-undo, registry validation) — in `design-system-core`, fully unit-tested with zero Angular.

**Architecture:** Approach A from the design spec (`docs/superpowers/specs/2026-06-16-substrate-tree-renderer-board-kit-design.md`): a `RenderNode` presentation tree + a `kind → RenderDefinition` registry; editing is **pure transforms returning a new tree** (no command inversion), undo is **snapshot-based with structural sharing**. This plan delivers ONLY the pure layer — the Angular `<ds-board-kit>` component (S2/S3) and the plan-tree consumer (S4–S6) are separate follow-up plans. Persistence precision rides an optional `EditIntent` returned alongside the new tree.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Nx 22, Vitest (`node` env, `globals: false`), API Extractor (`api-check` gate). Target lib: `libs/design-system-core` (`@de-braighter/design-system-core`, tags `scope:design-system type:core platform:agnostic`). New module: `src/public/board-kit/`.

---

## Preliminaries (read before Task 1)

- **Repo:** `layers/design-system`. Branch from `main`: `git checkout -b feat/board-kit-core`.
- **Test command:** `npx nx vite:test design-system-core` (the test target is `vite:test`, not `test`). Per-file: `npx nx vite:test design-system-core` runs all `src/**/*.spec.ts`.
- **Vitest specifics:** `globals: false` → every spec MUST `import { describe, it, expect } from 'vitest'`. Specs live next to source as `*.spec.ts`.
- **ESM:** intra-module imports use explicit `.js` extensions (e.g. `import { findNode } from './tree-ops.js'`). Type-only imports use `import type`.
- **`*-core` is platform-agnostic** — NO DOM, NO Angular, NO RN. Do not reference `KeyboardEvent`, `PointerEvent`, `document`, etc. Interaction inputs are modeled as plain data (`KeyboardSample`, `PressSample`).
- **api-check gate:** adding public exports requires regenerating `etc/design-system-core.api.md` (Task 9): `cd libs/design-system-core && npx api-extractor run --local --verbose`, then commit the updated `etc/*.api.md`.

## File structure (created by this plan)

```
libs/design-system-core/src/public/board-kit/
├── render-node.ts          # S0 contracts: all types (RenderNode, RenderDefinition, …)
├── gesture.ts              # S0/S1: interaction data types + pure classifiers
├── tree-ops.ts             # S1: pure tree mutations + validateTree (structural sharing)
├── undo-stack.ts           # S1: SnapshotStack<T> (depth-capped undo/redo)
├── layout.ts               # S1: layoutFree + layoutTree + runLayout
├── validate-registry.ts    # S0/S1: validateRegistry (a11y boundary gate)
├── index.ts                # board-kit module barrel
└── *.spec.ts               # co-located tests per file
libs/design-system-core/src/index.ts   # MODIFY: re-export './public/board-kit/index.js'
libs/design-system-core/etc/design-system-core.api.md   # MODIFY: regenerated
```

Each file has one responsibility; `render-node.ts` is type-only (no runtime), so its correctness is proven by the behavioral tasks that import it + the build.

---

## Task 0: Designer-first ADRs (precondition — NOT code)

The spec (§10) fires two ADRs that must be `proposed`/`accepted` before code lands (the implementer precondition). This task is a designer dispatch, not TDD.

**Files:**
- Create: `layers/specs/adr/adr-<next>-generic-tree-renderer-board-kit.md` (ADR-Lxx)
- Create: `layers/specs/adr/adr-<next>-render-tree-contract-home-and-shape.md` (ADR-Lyy)

- [ ] **Step 1:** Dispatch the `substrate-architect` agent (cross-cutting design-system + two-trees boundary) to author the two ADRs using `/adr-scaffolder` for numbering + template. Inputs: the design spec, north-star §8.
  - **ADR-Lxx** ratifies: the renderer/registry/edit-engine as a design-system brick (ADR-168); per-source projections; the two-trees discipline as governing (kernel plan tree ≠ presentation tree; geometry never enters the kernel).
  - **ADR-Lyy** ratifies: `RenderNode` lives platform-agnostic in `design-system-core` (NOT substrate-contracts); invariants = single-root / acyclic / unique-ids; the `EditIntent` shape; editing = pure-transform (Approach A), command-algebra deferred.
- [ ] **Step 2:** Land the ADRs via PR (specs are PR-gated). Acceptance: both `status: accepted` (or `proposed` with founder sign-off), indexed, spec-auditor clean.
- [ ] **Step 3:** Confirm the design spec's `ratified-by:` is updated to cite the two ADR numbers; graduate the north-star capture per §10 (separate spec PR — may trail).

> Gate: do not start Task 1 until ADR-Lyy fixes the `RenderNode` home + invariants (this plan assumes `design-system-core` + single-root/acyclic/unique-ids).

---

## Task 1: S0 — contract types (`render-node.ts` + `gesture.ts` interaction types)

**Files:**
- Create: `libs/design-system-core/src/public/board-kit/render-node.ts`
- Create: `libs/design-system-core/src/public/board-kit/gesture.ts` (types only in this task; classifiers in Task 7)
- Test: `libs/design-system-core/src/public/board-kit/render-node.spec.ts`

- [ ] **Step 1: Write the failing test** (a literal-construction test — proves the shapes compile and compose; types have no runtime behavior, so this is a shape guard)

```ts
// render-node.spec.ts
import { describe, it, expect } from 'vitest';
import type { RenderNode, RenderDefinition, BoardRegistry, EditResult } from './render-node.js';
import type { Gesture } from './gesture.js';

describe('board-kit contracts', () => {
  it('composes a recursive RenderNode tree', () => {
    const tree: RenderNode<{ label: string }> = {
      id: 'root', kind: 'plan.root', props: { label: 'Plan' },
      children: [{ id: 'a', kind: 'plan.intervention', props: { label: 'A' }, children: [] }],
    };
    expect(tree.children[0]?.id).toBe('a');
  });

  it('a RenderDefinition may omit the edit half (read-only kind)', () => {
    const readOnly: RenderDefinition<{ label: string }> = {
      kind: 'twin.node',
      draw: () => [{ p: 'text', x: 0, y: 0, text: 'n' }],
      bounds: () => ({ x: 0, y: 0, w: 10, h: 10 }),
      describe: (n) => ({ role: 'img', name: n.props.label }),
    };
    expect(readOnly.edit).toBeUndefined();
    const reg: BoardRegistry = new Map([[readOnly.kind, readOnly]]);
    expect(reg.size).toBe(1);
  });

  it('an EditResult carries the new tree + optional intent', () => {
    const r: EditResult = {
      tree: { id: 'root', kind: 'k', props: {}, children: [] },
      intent: { op: 'remove', nodeId: 'x' },
    };
    expect(r.intent?.op).toBe('remove');
  });

  it('a drag Gesture is expressible', () => {
    const g: Gesture = { type: 'drag', x1: 0, y1: 0, x2: 9, y2: 9 };
    expect(g.type).toBe('drag');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx vite:test design-system-core`
Expected: FAIL — cannot resolve `./render-node.js` / `./gesture.js` (modules not found).

- [ ] **Step 3: Write `gesture.ts` interaction types**

```ts
// gesture.ts — interaction data types (platform-agnostic; classifiers added in Task 7).
export interface PressSample { x: number; y: number; }
/** Platform-agnostic key event (NO DOM KeyboardEvent in *-core). */
export interface KeyboardSample { key: string; }

export type Gesture =
  | { type: 'tap'; x: number; y: number }
  | { type: 'drag'; x1: number; y1: number; x2: number; y2: number };
```

- [ ] **Step 4: Write `render-node.ts`**

```ts
// render-node.ts — Board Kit S0 contracts (pure types; no runtime).
import type { Gesture, KeyboardSample, PressSample } from './gesture.js';

export interface Point { x: number; y: number; }
export interface Bounds { x: number; y: number; w: number; h: number; }
export interface A11yDescriptor { role: string; name: string; description?: string; }

/** Declarative SVG draw output — the engine renders these inside its managed <svg>. */
export type SvgPrimitive =
  | { p: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; strokeWidth?: number }
  | { p: 'line'; x1: number; y1: number; x2: number; y2: number; stroke?: string; strokeWidth?: number; dash?: string }
  | { p: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; rx?: number }
  | { p: 'path'; d: string; fill?: string; stroke?: string }
  | { p: 'text'; x: number; y: number; text: string; fill?: string; anchor?: 'start' | 'middle' | 'end' };

/** The derived presentation node. Invariants (ADR-Lyy): single-root, unique ids, acyclic. */
export interface RenderNode<P = unknown> {
  id: string;
  kind: string;
  props: P;
  children: readonly RenderNode[];
}

export type LayoutStrategy = { mode: 'free' } | { mode: 'tree'; xGap?: number; yGap?: number };
export interface Frame { id: string; width: number; height: number; layout: LayoutStrategy; }

export type GestureKind = 'tap' | 'drag';
export interface ToolSpec { id: string; label: string; gesture: GestureKind; keyboard?: boolean; }

/** A gesture's target node, or null for the canvas. */
export interface EditTarget { nodeId: string | null; }

/** Optional semantic label of what an edit did — lets the host persist precisely
 *  (a reparent is not recoverable by diffing two trees). */
export type EditIntent =
  | { op: 'insert'; parentId: string; node: RenderNode }
  | { op: 'remove'; nodeId: string }
  | { op: 'reparent'; nodeId: string; newParentId: string }
  | { op: 'patch'; nodeId: string; patch: Record<string, unknown> }
  | { op: 'move'; nodeId: string; x: number; y: number };

/** Pure-transform result: the new tree + an optional persistence intent. */
export interface EditResult { tree: RenderNode; intent?: EditIntent; }
export interface HitResult { nodeId: string; }

export interface DrawContext { frame: Frame; }
export interface EditContext { frame: Frame; }

/** What a consumer registers to "define a shape" for a kind. */
export interface RenderDefinition<P = unknown> {
  kind: string;
  // DRAW half (required)
  draw(node: RenderNode<P>, ctx: DrawContext): SvgPrimitive[];
  bounds(node: RenderNode<P>, ctx: DrawContext): Bounds;
  describe(node: RenderNode<P>): A11yDescriptor;
  // EDIT half (optional — omit ⇒ read-only kind)
  edit?: {
    tools: readonly ToolSpec[];
    hitTest(node: RenderNode<P>, at: Point, ctx: DrawContext): HitResult | null;
    onGesture(g: Gesture, target: EditTarget, tree: RenderNode, ctx: EditContext): EditResult | null;
    onKey(k: KeyboardSample, target: EditTarget, tree: RenderNode, ctx: EditContext): EditResult | null;
  };
}

export type BoardRegistry = ReadonlyMap<string, RenderDefinition>;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx nx vite:test design-system-core`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/render-node.ts \
        libs/design-system-core/src/public/board-kit/gesture.ts \
        libs/design-system-core/src/public/board-kit/render-node.spec.ts
git commit -m "feat(board-kit): S0 contract types (RenderNode, RenderDefinition, EditIntent)"
```

---

## Task 2: `validateTree` — tree invariants

**Files:**
- Create: `libs/design-system-core/src/public/board-kit/tree-ops.ts`
- Test: `libs/design-system-core/src/public/board-kit/tree-ops.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tree-ops.spec.ts
import { describe, it, expect } from 'vitest';
import { validateTree } from './tree-ops.js';
import type { RenderNode } from './render-node.js';

const leaf = (id: string): RenderNode => ({ id, kind: 'k', props: {}, children: [] });

describe('validateTree', () => {
  it('passes a well-formed tree', () => {
    const t: RenderNode = { id: 'r', kind: 'k', props: {}, children: [leaf('a'), leaf('b')] };
    expect(validateTree(t)).toEqual([]);
  });

  it('flags a duplicate id', () => {
    const t: RenderNode = { id: 'r', kind: 'k', props: {}, children: [leaf('a'), leaf('a')] };
    expect(validateTree(t)).toEqual([{ code: 'duplicate-id', detail: 'a' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx vite:test design-system-core`
Expected: FAIL — `validateTree` not exported.

- [ ] **Step 3: Write minimal implementation**

```ts
// tree-ops.ts
import type { RenderNode } from './render-node.js';

export interface TreeValidationError { code: 'duplicate-id' | 'cycle'; detail: string; }

/** Validate ADR-Lyy invariants: unique ids, acyclic. (Single-root is structural.) */
export function validateTree(tree: RenderNode): TreeValidationError[] {
  const errors: TreeValidationError[] = [];
  const seen = new Set<string>();
  const walk = (n: RenderNode, ancestors: ReadonlySet<string>): void => {
    if (ancestors.has(n.id)) { errors.push({ code: 'cycle', detail: n.id }); return; }
    if (seen.has(n.id)) errors.push({ code: 'duplicate-id', detail: n.id });
    seen.add(n.id);
    const next = new Set(ancestors).add(n.id);
    for (const c of n.children) walk(c, next);
  };
  walk(tree, new Set());
  return errors;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx vite:test design-system-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/tree-ops.ts \
        libs/design-system-core/src/public/board-kit/tree-ops.spec.ts
git commit -m "feat(board-kit): validateTree invariants (unique-id, acyclic)"
```

---

## Task 3: tree mutations with structural sharing

**Files:**
- Modify: `libs/design-system-core/src/public/board-kit/tree-ops.ts`
- Modify: `libs/design-system-core/src/public/board-kit/tree-ops.spec.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to tree-ops.spec.ts
import { findNode, mapNode, insertChild, removeNode, reparentNode, patchNodeProps } from './tree-ops.js';

describe('tree mutations', () => {
  const tree = (): RenderNode => ({
    id: 'r', kind: 'k', props: {}, children: [
      { id: 'a', kind: 'k', props: { v: 1 }, children: [leaf('a1')] },
      leaf('b'),
    ],
  });

  it('findNode returns the node or null', () => {
    expect(findNode(tree(), 'a1')?.id).toBe('a1');
    expect(findNode(tree(), 'zzz')).toBeNull();
  });

  it('insertChild appends under the parent (structural sharing: sibling subtree shared)', () => {
    const t = tree();
    const next = insertChild(t, 'a', leaf('a2'));
    expect(findNode(next, 'a')?.children.map((c) => c.id)).toEqual(['a1', 'a2']);
    expect(next.children[1]).toBe(t.children[1]); // untouched sibling 'b' shared by reference
  });

  it('removeNode drops the subtree; root is not removable', () => {
    expect(findNode(removeNode(tree(), 'a'), 'a')).toBeNull();
    const t = tree();
    expect(removeNode(t, 'r')).toBe(t);
  });

  it('reparentNode moves a subtree; refuses a cycle (into own descendant)', () => {
    const moved = reparentNode(tree(), 'b', 'a');
    expect(findNode(moved, 'a')?.children.map((c) => c.id)).toEqual(['a1', 'b']);
    const t = tree();
    expect(reparentNode(t, 'a', 'a1')).toBe(t); // 'a1' is a descendant of 'a' → no-op
  });

  it('patchNodeProps merges props', () => {
    const next = patchNodeProps<{ v: number }>(tree(), 'a', { v: 9 });
    expect((findNode(next, 'a')?.props as { v: number }).v).toBe(9);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-core`
Expected: FAIL — `findNode`/`mapNode`/… not exported.

- [ ] **Step 3: Implement (append to tree-ops.ts)**

```ts
export function findNode(tree: RenderNode, id: string): RenderNode | null {
  if (tree.id === id) return tree;
  for (const c of tree.children) {
    const hit = findNode(c, id);
    if (hit) return hit;
  }
  return null;
}

/** Apply `replacer` to the node with `id`, sharing unchanged subtrees by reference. */
export function mapNode(
  tree: RenderNode,
  id: string,
  replacer: (n: RenderNode) => RenderNode,
): RenderNode {
  if (tree.id === id) return replacer(tree);
  let changed = false;
  const children = tree.children.map((c) => {
    const next = mapNode(c, id, replacer);
    if (next !== c) changed = true;
    return next;
  });
  return changed ? { ...tree, children } : tree;
}

export function insertChild(tree: RenderNode, parentId: string, child: RenderNode): RenderNode {
  return mapNode(tree, parentId, (p) => ({ ...p, children: [...p.children, child] }));
}

export function removeNode(tree: RenderNode, id: string): RenderNode {
  if (tree.id === id) return tree; // root not removable
  let changed = false;
  const children: RenderNode[] = [];
  for (const c of tree.children) {
    if (c.id === id) { changed = true; continue; }
    const next = removeNode(c, id);
    if (next !== c) changed = true;
    children.push(next);
  }
  return changed ? { ...tree, children } : tree;
}

export function reparentNode(tree: RenderNode, id: string, newParentId: string): RenderNode {
  if (id === tree.id || id === newParentId) return tree;
  const node = findNode(tree, id);
  if (!node) return tree;
  if (findNode(node, newParentId)) return tree; // would create a cycle
  return insertChild(removeNode(tree, id), newParentId, node);
}

export function patchNodeProps<P>(tree: RenderNode, id: string, patch: Partial<P>): RenderNode {
  return mapNode(tree, id, (n) => ({ ...n, props: { ...(n.props as object), ...patch } as P }));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/tree-ops.ts \
        libs/design-system-core/src/public/board-kit/tree-ops.spec.ts
git commit -m "feat(board-kit): pure tree mutations with structural sharing"
```

---

## Task 4: `SnapshotStack` — undo/redo

**Files:**
- Create: `libs/design-system-core/src/public/board-kit/undo-stack.ts`
- Test: `libs/design-system-core/src/public/board-kit/undo-stack.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// undo-stack.spec.ts
import { describe, it, expect } from 'vitest';
import { SnapshotStack } from './undo-stack.js';

describe('SnapshotStack', () => {
  it('undo returns the prior snapshot; redo replays it', () => {
    const s = new SnapshotStack<string>(3);
    expect(s.canUndo).toBe(false);
    s.push('v0');            // about to move to v1; remember v0
    expect(s.undo('v1')).toBe('v0');
    expect(s.redo('v0')).toBe('v1');
  });

  it('push clears the redo future', () => {
    const s = new SnapshotStack<string>(3);
    s.push('v0');
    s.undo('v1');            // future = [v1]
    s.push('v0b');           // a new edit clears redo
    expect(s.canRedo).toBe(false);
  });

  it('caps history at depth', () => {
    const s = new SnapshotStack<number>(2);
    s.push(1); s.push(2); s.push(3); // only last 2 kept
    expect(s.undo(99)).toBe(3);
    expect(s.undo(3)).toBe(2);
    expect(s.undo(2)).toBeNull();    // 1 was evicted
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-core`
Expected: FAIL — `SnapshotStack` not found.

- [ ] **Step 3: Implement**

```ts
// undo-stack.ts — depth-capped snapshot undo/redo. Structural sharing is the
// caller's concern (tree-ops shares unchanged subtrees), so a snapshot is cheap.
export class SnapshotStack<T> {
  private past: T[] = [];
  private future: T[] = [];
  constructor(private readonly depth = 24) {}

  get canUndo(): boolean { return this.past.length > 0; }
  get canRedo(): boolean { return this.future.length > 0; }

  /** Record the snapshot we are leaving, before applying a new edit. Clears redo. */
  push(prev: T): void {
    this.past = [...this.past, prev].slice(-this.depth);
    this.future = [];
  }

  /** Return the prior snapshot (or null); pushes `current` onto redo. */
  undo(current: T): T | null {
    const prev = this.past.at(-1);
    if (prev === undefined) return null;
    this.past = this.past.slice(0, -1);
    this.future = [current, ...this.future].slice(0, this.depth);
    return prev;
  }

  /** Return the next redo snapshot (or null); pushes `current` onto past. */
  redo(current: T): T | null {
    const next = this.future[0];
    if (next === undefined) return null;
    this.future = this.future.slice(1);
    this.past = [...this.past, current].slice(-this.depth);
    return next;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/undo-stack.ts \
        libs/design-system-core/src/public/board-kit/undo-stack.spec.ts
git commit -m "feat(board-kit): SnapshotStack depth-capped undo/redo"
```

---

## Task 5: `layoutFree` — coordinate-authoritative layout

**Files:**
- Create: `libs/design-system-core/src/public/board-kit/layout.ts`
- Test: `libs/design-system-core/src/public/board-kit/layout.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// layout.spec.ts
import { describe, it, expect } from 'vitest';
import { layoutFree } from './layout.js';
import type { RenderNode } from './render-node.js';

describe('layoutFree', () => {
  it('reads x/y from node props; skips nodes without coordinates', () => {
    const tree: RenderNode = {
      id: 'r', kind: 'board', props: {}, children: [
        { id: 'm1', kind: 'marker', props: { x: 10, y: 20 }, children: [] },
        { id: 'm2', kind: 'marker', props: { x: 30, y: 40 }, children: [] },
      ],
    };
    const pos = layoutFree(tree);
    expect(pos.get('m1')).toEqual({ x: 10, y: 20 });
    expect(pos.get('m2')).toEqual({ x: 30, y: 40 });
    expect(pos.has('r')).toBe(false); // root frame has no coords
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-core`
Expected: FAIL — `layoutFree` not found.

- [ ] **Step 3: Implement**

```ts
// layout.ts
import type { LayoutStrategy, RenderNode } from './render-node.js';

export interface NodePosition { x: number; y: number; }
export type LayoutResult = ReadonlyMap<string, NodePosition>;

/** 'free' layout: positions are authoritative, read from each node's props.x/props.y. */
export function layoutFree(tree: RenderNode): LayoutResult {
  const out = new Map<string, NodePosition>();
  const walk = (n: RenderNode): void => {
    const p = n.props as { x?: unknown; y?: unknown };
    if (typeof p.x === 'number' && typeof p.y === 'number') out.set(n.id, { x: p.x, y: p.y });
    n.children.forEach(walk);
  };
  walk(tree);
  return out;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/layout.ts \
        libs/design-system-core/src/public/board-kit/layout.spec.ts
git commit -m "feat(board-kit): layoutFree (coordinate-authoritative)"
```

---

## Task 6: `layoutTree` + `runLayout` — computed tree layout

**Files:**
- Modify: `libs/design-system-core/src/public/board-kit/layout.ts`
- Modify: `libs/design-system-core/src/public/board-kit/layout.spec.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to layout.spec.ts
import { layoutTree, runLayout } from './layout.js';

describe('layoutTree', () => {
  const tree: RenderNode = {
    id: 'r', kind: 'plan.root', props: {}, children: [
      { id: 'a', kind: 'plan', props: {}, children: [] },
      { id: 'b', kind: 'plan', props: {}, children: [] },
    ],
  };

  it('places leaves left-to-right by gap and depth by row', () => {
    const pos = layoutTree(tree, { xGap: 100, yGap: 50 });
    expect(pos.get('a')).toEqual({ x: 0, y: 50 });
    expect(pos.get('b')).toEqual({ x: 100, y: 50 });
  });

  it('centers a parent over its children', () => {
    const pos = layoutTree(tree, { xGap: 100, yGap: 50 });
    expect(pos.get('r')).toEqual({ x: 50, y: 0 }); // midpoint of a(0) and b(100)
  });

  it('runLayout dispatches on strategy', () => {
    expect(runLayout(tree, { mode: 'tree', xGap: 100, yGap: 50 }).get('r')).toEqual({ x: 50, y: 0 });
    const free: RenderNode = { id: 'r', kind: 'b', props: {}, children: [{ id: 'm', kind: 'm', props: { x: 7, y: 8 }, children: [] }] };
    expect(runLayout(free, { mode: 'free' }).get('m')).toEqual({ x: 7, y: 8 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-core`
Expected: FAIL — `layoutTree`/`runLayout` not found.

- [ ] **Step 3: Implement (append to layout.ts)**

```ts
/**
 * 'tree' layout (simple tidy): leaves are spaced left-to-right by `xGap`, each
 * row is `yGap` apart by depth, and a parent is centered over the span of its
 * children. A first-cut tidy layout — Reingold–Tilford tightening is a later
 * enhancement (the consumer never sees coordinates, so this can change freely).
 */
export function layoutTree(
  tree: RenderNode,
  opts: { xGap?: number; yGap?: number } = {},
): LayoutResult {
  const xGap = opts.xGap ?? 80;
  const yGap = opts.yGap ?? 100;
  const out = new Map<string, NodePosition>();
  let nextLeaf = 0;
  const assign = (n: RenderNode, depth: number): number => {
    const y = depth * yGap;
    let x: number;
    if (n.children.length === 0) {
      x = nextLeaf * xGap;
      nextLeaf += 1;
    } else {
      const childXs = n.children.map((c) => assign(c, depth + 1));
      x = (childXs[0] + childXs[childXs.length - 1]) / 2;
    }
    out.set(n.id, { x, y });
    return x;
  };
  assign(tree, 0);
  return out;
}

export function runLayout(tree: RenderNode, strategy: LayoutStrategy): LayoutResult {
  return strategy.mode === 'tree'
    ? layoutTree(tree, { xGap: strategy.xGap, yGap: strategy.yGap })
    : layoutFree(tree);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/layout.ts \
        libs/design-system-core/src/public/board-kit/layout.spec.ts
git commit -m "feat(board-kit): layoutTree (tidy) + runLayout dispatch"
```

---

## Task 7: gesture classifiers — tap/drag + click-click anchor (drag alternative)

**Files:**
- Modify: `libs/design-system-core/src/public/board-kit/gesture.ts`
- Test: `libs/design-system-core/src/public/board-kit/gesture.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// gesture.spec.ts
import { describe, it, expect } from 'vitest';
import { classifyPress, reduceAnchor, DRAG_THRESHOLD } from './gesture.js';

describe('classifyPress', () => {
  it('a small displacement is a tap', () => {
    expect(classifyPress({ x: 0, y: 0 }, { x: 2, y: 1 })).toEqual({ type: 'tap', x: 2, y: 1 });
  });
  it('a large displacement is a drag', () => {
    expect(classifyPress({ x: 0, y: 0 }, { x: 50, y: 0 }))
      .toEqual({ type: 'drag', x1: 0, y1: 0, x2: 50, y2: 0 });
  });
  it('uses DRAG_THRESHOLD as the boundary', () => {
    expect(DRAG_THRESHOLD).toBe(6);
  });
});

describe('reduceAnchor (click-click drag alternative)', () => {
  it('first click sets the anchor', () => {
    expect(reduceAnchor(null, { kind: 'click', at: { x: 5, y: 5 } })).toEqual({ anchor: { x: 5, y: 5 } });
  });
  it('second click far enough emits a drag and clears the anchor', () => {
    const r = reduceAnchor({ x: 0, y: 0 }, { kind: 'click', at: { x: 40, y: 0 } });
    expect(r.anchor).toBeNull();
    expect(r.gesture).toEqual({ type: 'drag', x1: 0, y1: 0, x2: 40, y2: 0 });
  });
  it('a too-short second click cancels (no gesture)', () => {
    expect(reduceAnchor({ x: 0, y: 0 }, { kind: 'click', at: { x: 2, y: 0 } })).toEqual({ anchor: null });
  });
  it('an explicit cancel clears the anchor', () => {
    expect(reduceAnchor({ x: 1, y: 1 }, { kind: 'cancel' })).toEqual({ anchor: null });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-core`
Expected: FAIL — `classifyPress`/`reduceAnchor`/`DRAG_THRESHOLD` not exported.

- [ ] **Step 3: Implement (append to gesture.ts)**

```ts
/** Press-release displacement below which a gesture is a tap (doubles as the
 *  select-move dead zone). Mirrors the proven CLICK_TOLERANCE in both boards. */
export const DRAG_THRESHOLD = 6;
/** Minimum click-click span (board px) for a draw to commit. */
export const MIN_DRAW_LEN = 18;

export function classifyPress(down: PressSample, up: PressSample, threshold = DRAG_THRESHOLD): Gesture {
  return Math.hypot(up.x - down.x, up.y - down.y) < threshold
    ? { type: 'tap', x: up.x, y: up.y }
    : { type: 'drag', x1: down.x, y1: down.y, x2: up.x, y2: up.y };
}

export type AnchorState = PressSample | null;
export type AnchorEvent = { kind: 'click'; at: PressSample } | { kind: 'cancel' };
export interface AnchorResult { anchor: AnchorState; gesture?: Gesture; }

/** WCAG 2.5.7 drag alternative: click sets an anchor, a second click commits a
 *  drag (or cancels if too short); `cancel` clears. Pure reducer — the engine
 *  feeds it digested clicks. */
export function reduceAnchor(state: AnchorState, ev: AnchorEvent, minLen = MIN_DRAW_LEN): AnchorResult {
  if (ev.kind === 'cancel') return { anchor: null };
  if (state === null) return { anchor: ev.at };
  if (Math.hypot(ev.at.x - state.x, ev.at.y - state.y) < minLen) return { anchor: null };
  return { anchor: null, gesture: { type: 'drag', x1: state.x, y1: state.y, x2: ev.at.x, y2: ev.at.y } };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/gesture.ts \
        libs/design-system-core/src/public/board-kit/gesture.spec.ts
git commit -m "feat(board-kit): pure gesture classifiers (tap/drag + click-click anchor)"
```

---

## Task 8: `validateRegistry` — the a11y boundary gate

**Files:**
- Create: `libs/design-system-core/src/public/board-kit/validate-registry.ts`
- Test: `libs/design-system-core/src/public/board-kit/validate-registry.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// validate-registry.spec.ts
import { describe, it, expect } from 'vitest';
import { validateRegistry } from './validate-registry.js';
import type { RenderDefinition, BoardRegistry } from './render-node.js';

const baseDraw = {
  draw: () => [],
  bounds: () => ({ x: 0, y: 0, w: 1, h: 1 }),
  describe: () => ({ role: 'img', name: 'n' }),
};

describe('validateRegistry', () => {
  it('passes a read-only kind and a drag tool that declares a keyboard path', () => {
    const ok: RenderDefinition = {
      kind: 'arrow', ...baseDraw,
      edit: {
        tools: [{ id: 'draw', label: 'Draw', gesture: 'drag', keyboard: true }],
        hitTest: () => null, onGesture: () => null, onKey: () => null,
      },
    };
    const reg: BoardRegistry = new Map([[ok.kind, ok]]);
    expect(validateRegistry(reg)).toEqual([]);
  });

  it('flags a drag tool with no keyboard path (WCAG 2.5.7/2.1.1)', () => {
    const bad: RenderDefinition = {
      kind: 'arrow', ...baseDraw,
      edit: {
        tools: [{ id: 'draw', label: 'Draw', gesture: 'drag' }],
        hitTest: () => null, onGesture: () => null, onKey: () => null,
      },
    };
    const reg: BoardRegistry = new Map([[bad.kind, bad]]);
    expect(validateRegistry(reg)).toEqual([
      { kind: 'arrow', code: 'drag-tool-no-keyboard', detail: "tool 'draw' offers drag without a keyboard path" },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-core`
Expected: FAIL — `validateRegistry` not found.

- [ ] **Step 3: Implement**

```ts
// validate-registry.ts — dev/test gate: a kind cannot ship a partially
// accessible board. Enforced at the registry boundary (spec §6.1).
import type { BoardRegistry } from './render-node.js';

export interface RegistryError {
  kind: string;
  code: 'missing-describe' | 'drag-tool-no-keyboard';
  detail: string;
}

export function validateRegistry(registry: BoardRegistry): RegistryError[] {
  const errors: RegistryError[] = [];
  for (const def of registry.values()) {
    if (typeof def.describe !== 'function') {
      errors.push({ kind: def.kind, code: 'missing-describe', detail: 'describe() is required' });
    }
    for (const tool of def.edit?.tools ?? []) {
      if (tool.gesture === 'drag' && !tool.keyboard) {
        errors.push({
          kind: def.kind,
          code: 'drag-tool-no-keyboard',
          detail: `tool '${tool.id}' offers drag without a keyboard path`,
        });
      }
    }
  }
  return errors;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-core`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/validate-registry.ts \
        libs/design-system-core/src/public/board-kit/validate-registry.spec.ts
git commit -m "feat(board-kit): validateRegistry a11y boundary gate"
```

---

## Task 9: public API barrel + index wiring + api-check + full gate

**Files:**
- Create: `libs/design-system-core/src/public/board-kit/index.ts`
- Modify: `libs/design-system-core/src/index.ts`
- Modify: `libs/design-system-core/etc/design-system-core.api.md` (regenerated)

- [ ] **Step 1: Write the board-kit barrel**

```ts
// index.ts — Board Kit public surface (pure layer). The Angular <ds-board-kit>
// component (S2/S3) lives in design-system-angular and imports from here.
export type {
  Point, Bounds, A11yDescriptor, SvgPrimitive, RenderNode, LayoutStrategy, Frame,
  GestureKind, ToolSpec, EditTarget, EditIntent, EditResult, HitResult,
  DrawContext, EditContext, RenderDefinition, BoardRegistry,
} from './render-node.js';
export type { PressSample, KeyboardSample, Gesture, AnchorState, AnchorEvent, AnchorResult } from './gesture.js';
export { classifyPress, reduceAnchor, DRAG_THRESHOLD, MIN_DRAW_LEN } from './gesture.js';
export type { TreeValidationError } from './tree-ops.js';
export {
  validateTree, findNode, mapNode, insertChild, removeNode, reparentNode, patchNodeProps,
} from './tree-ops.js';
export { SnapshotStack } from './undo-stack.js';
export type { NodePosition, LayoutResult } from './layout.js';
export { layoutFree, layoutTree, runLayout } from './layout.js';
export type { RegistryError } from './validate-registry.js';
export { validateRegistry } from './validate-registry.js';
```

- [ ] **Step 2: Re-export from the lib index**

Add to `libs/design-system-core/src/index.ts` (after the existing exports):

```ts
// ─── Board Kit (recursive presentation-tree renderer — pure layer) ───
export * from './public/board-kit/index.js';
```

- [ ] **Step 3: Build + typecheck**

Run: `npx nx build design-system-core && npx nx typecheck design-system-core`
Expected: both succeed.

- [ ] **Step 4: Regenerate the API report (api-check gate)**

Run: `cd libs/design-system-core && npx api-extractor run --local --verbose && cd -`
Expected: `etc/design-system-core.api.md` updated with the new Board Kit exports; api-extractor exits 0.

- [ ] **Step 5: Run the full local gate**

Run (from repo root, capture exit code — do NOT pipe to a masker): `npm run ci:local > /tmp/bk-ci.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0` (lib:conformance + tokens:check + build + lint + typecheck + api-check + vite:test all green). Read the log to confirm `design-system-core` tests ran (not `passWithNoTests`).

- [ ] **Step 6: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/index.ts \
        libs/design-system-core/src/index.ts \
        libs/design-system-core/etc/design-system-core.api.md
git commit -m "feat(board-kit): export pure core surface + regenerate API report"
```

- [ ] **Step 7: Open the PR** (verifier wave per the review floor — non-trivial change ⇒ full wave: local-ci + reviewer + charter-checker + qa-engineer; charter-checker confirms the two-trees discipline + that nothing here is kernel). PR body carries `Producer:`, `Effort: standard`, and (optionally) `Effect: cycle-time …`/`Effect: findings …` per the workbench ritual.

---

## Self-Review

- **Spec coverage:** S0 (contracts) → Tasks 1–8 define every type in spec §4 (`RenderNode`, `RenderDefinition` draw+edit, `EditIntent`/`EditResult`, `LayoutStrategy`/`Frame`, `ToolSpec`, `SvgPrimitive`). S1 (pure core) → tree-ops (Tasks 2–3), layout free+tree (Tasks 5–6), gesture digest (Task 7), snapshot-undo w/ structural sharing (Tasks 3+4), `validateRegistry` a11y gate (Task 8). The `intent` refinement (§5.3) is in the `EditResult`/`EditIntent` types. **Out of scope for this plan (by design):** the Angular `<ds-board-kit>` component, per-kind `draw` rendering to DOM, raw-event→gesture wiring, `revertTo`, the showcase, and the plan-tree consumer — all S2–S6, in Plans 2–3.
- **Placeholder scan:** none — every step has complete code/commands. (Task 0 ADR filenames carry `<next>` because numbers are assigned by `/adr-scaffolder` at author time — that is a real, unavoidable late-bound value, not a placeholder for logic.)
- **Type consistency:** `RenderNode`, `RenderDefinition`, `EditResult`, `EditIntent`, `BoardRegistry`, `Gesture`, `KeyboardSample`, `PressSample`, `LayoutResult`, `NodePosition` are defined once (Tasks 1/5/6) and referenced consistently; `onKey` takes `KeyboardSample` (not DOM `KeyboardEvent`) everywhere; barrel (Task 9) re-exports exactly the names defined.

---

## Status

Plan 1 of 3 for the Board Kit arc. Produces a published-ready, fully-tested pure engine core in `design-system-core`. **Next plans (write after this lands):** Plan 2 (`board-kit` Angular brick — S2/S3 + showcase, `design-system-angular`); Plan 3 (plan-tree authoring consumer — S4–S6, `scenario-lab`).
