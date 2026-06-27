# Board Kit — Angular Brick (`<ds-board-kit>`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Angular `<ds-board-kit>` brick in `design-system-angular` — a domain-free SVG renderer + editor that consumes the merged Board Kit pure core (`@de-braighter/design-system-core`): it renders a `RenderNode` tree via registry `draw()`, runs layout, owns a11y `describe()`/roving-focus/tool-chrome (S2, read-only), then wires pointer + keyboard + click-click into the pure gesture/transform/snapshot pipeline (S3, editing), and proves the **spatial modality** on a synthetic free-layout board in the design-system showcase.

**Architecture:** Approach A from the design spec (`docs/superpowers/specs/2026-06-16-substrate-tree-renderer-board-kit-design.md`, §3–§8 — Plan 2 = slices **S2 + S3**). The brick is a **thin Angular shell over pure functions**: a small set of platform-agnostic engine helpers (`buildRenderModel`, `hitTestTree`, `applyGesture`, `applyKey`) do the work and are unit-tested without the DOM; the `BoardKitComponent` is a façade that holds signal state (`working` tree via `linkedSignal`, `selection`, `SnapshotStack`), runs `runLayout`, draws declarative `SvgPrimitive[]` into a managed `<svg>`, and exposes an engine API (`undo`/`redo`/`revertTo`/`setMode`/`canUndo`/`canRedo`/`commit` output). The coordinate model is **draw-local + engine-translate**: `draw` emits primitives in node-local space; the engine wraps each node in `<g transform="translate(x,y)">` using the layout position (positions are absolute per node — the tree is flattened, never nested-transformed). DOM events are converted to the core's plain-data samples (`PressSample`/`KeyboardSample`) at a thin seam, so the proven pure classifiers do the real routing. This plan also folds in three deferred should-fixes from Plan 1's review (core: `mapNode` → `@internal`, `layoutTree` childXs micro-perf, new `renderDefinitionContract` harness).

**Tech Stack:** Angular **21** (standalone, signal `input()`/`output()`/`linkedSignal()`/`viewChild()`, `@if`/`@for` control flow, `OnPush`), TypeScript (ESM, `.js` import specifiers intra-module; core consumed via the `@de-braighter/design-system-core` barrel), Vitest via `@analogjs/vitest-angular` (`jsdom` env, `globals: false`, `TestBed` + `componentRef.setInput`), API Extractor (`api-check` gate). Target lib: `libs/design-system-angular` (`@de-braighter/design-system-angular`, tags `scope:design-system type:ui platform:web-angular` — allowed to depend on `type:core`). Showcase: `apps/showcase`.

---

## Preliminaries (read before Task 1)

- **Repo:** `layers/design-system`. Branch from `main`: `git checkout -b feat/board-kit-angular`.
- **No new ADR.** ADR-239 (renderer/registry brick) + ADR-240 (`RenderNode` home + invariants + `EditIntent` + Approach-A) already ratify this brick (merged in specs#319). Plan 2 is pure implementation of the ratified design — no Task 0 designer dispatch.
- **Two test commands:**
  - Core (Tasks A1–A4): `npx nx vite:test design-system-core` (env `node`, `globals: false`).
  - Angular (Tasks B–D): `npx nx vite:test design-system-angular` (env `jsdom`, `globals: false`, TestBed). If Nx reports no such target, the inferred name may differ — check with `npx nx show project design-system-angular`; core's equivalent is `vite:test`.
- **Vitest specifics:** `globals: false` → every spec MUST `import { describe, it, expect } from 'vitest'`. Specs live next to source as `*.spec.ts`.
- **ESM:** intra-module imports use explicit `.js` extensions (mirror `pitch.component.ts` → `import { … } from './pitch-geometry.js'`). Core is a package import: `from '@de-braighter/design-system-core'` (barrel only — eslint `no-restricted-imports` forbids `@de-braighter/*/src/*`). Type-only imports use `import type`.
- **Angular signals only** — `input()`/`input.required()`/`output()`/`computed()`/`signal()`/`linkedSignal()`/`viewChild()`. No `@Input()`/`@Output()` decorators. `ChangeDetectionStrategy.OnPush`. (See `pitch.component.ts` and `icon.component.ts` for the house style.)
- **SVG in templates:** writing `<circle>`/`<line>`/`<rect>`/`<path>`/`<text>` lexically inside `<svg>…</svg>` gives them the SVG namespace automatically — `@if`/`@for` blocks are transparent to namespacing. `DbPitch` does exactly this; mirror it.
- **api-check gate:** adding public exports requires regenerating the API report (Task D3): `cd libs/design-system-angular && npx api-extractor run --local --verbose`, then commit the updated `etc/design-system-angular.api.md`. Same for core in Task A4 (`libs/design-system-core`).
- **Cross-lib build ordering:** `npm workspaces` is NOT configured. After editing core (Part A), the Angular **build** resolves `@de-braighter/design-system-core` via the `node_modules/@de-braighter/*` junction → `dist/`. Typecheck/test resolve via the tsconfig path → core **src**, so new core exports are visible to Angular tests immediately. If `design-system-angular:build` fails to resolve core, run `npx nx build design-system-core && bash scripts/setup-dev.sh`. `npm run ci:local` builds in topological order (`^build`).
- **Gate = `npm run ci:local`** (root): `lib:conformance → tokens:check → nx run-many -t build lint typecheck api-check → nx run-many -t vite:test --parallel=1`. **Capture real exit codes** — `cmd > log 2>&1; echo "EXIT=$?"`, never `| tail; echo $?` (the pipe masks the exit code; it has bitten this repo twice). The pre-push hook (`.githooks`, runs `nx … lint`) exits nonzero on lint errors (warnings OK).

## File structure (created/modified by this plan)

```
# Part A — design-system-core fold-ins (deferred should-fixes)
libs/design-system-core/src/public/board-kit/
├── layout.ts                       # MODIFY: layoutTree childXs micro-perf (no behavior change)
├── layout.spec.ts                  # MODIFY: add a 3-child centering test (locks semantics)
├── tree-ops.ts                     # MODIFY: mark mapNode @internal
├── render-definition-contract.ts   # CREATE: renderDefinitionContract(def, sample) pure harness
├── render-definition-contract.spec.ts  # CREATE
└── index.ts                        # MODIFY: drop mapNode from barrel; add renderDefinitionContract + types
libs/design-system-core/etc/design-system-core.api.md   # MODIFY: regenerated

# Part B/C — the Angular brick
libs/design-system-angular/src/public/board-kit/
├── board-kit.engine.ts             # B: pure helpers (buildRenderModel, hitTestTree, applyGesture, applyKey)
├── board-kit.engine.spec.ts        # B: pure unit tests (no DOM)
├── board-kit.component.ts          # C: <ds-board-kit> (S2 render + S3 edit façade)
├── board-kit.component.spec.ts     # C: TestBed tests (render, focus, edit, undo/redo, revert)
└── index.ts                        # D: board-kit module barrel
libs/design-system-angular/src/index.ts                 # MODIFY: re-export './public/board-kit/index.js'
libs/design-system-angular/etc/design-system-angular.api.md  # MODIFY: regenerated

# Part D — showcase (proves the SPATIAL modality)
apps/showcase/src/app/pages/ds-board-kit.page.ts        # CREATE: marker registry + toolbar + live board
apps/showcase/src/app/nav.catalog.ts                    # MODIFY: add the nav entry
```

Each file has one responsibility. `board-kit.engine.ts` holds *all* the logic (pure, fully tested); `board-kit.component.ts` is a thin signal/DOM shell over it.

---

## Part A — Core fold-ins (deferred should-fixes from Plan 1's review)

These are contained `design-system-core` changes. They land first so the new core surface is stable before the Angular brick consumes it.

### Task A1: `layoutTree` childXs micro-perf (no behavior change)

The current `layoutTree` builds the full `childXs` array via `.map()` but only reads the first and last entries to center a parent. Every child must still be assigned (the recursion has side effects: it advances `nextLeaf` and sets each node's position), so the fix is **not** "skip middle children" — it is "avoid materializing the intermediate array" by tracking only the first/last x during the walk.

**Files:**
- Modify: `libs/design-system-core/src/public/board-kit/layout.ts:24-47` (the `layoutTree` body)
- Modify: `libs/design-system-core/src/public/board-kit/layout.spec.ts`

- [ ] **Step 1: Add a failing/locking test** (a 3-child parent must center over the span of the *first and last* leaves — proves the optimization preserves the centering semantics)

```ts
// append inside the existing `describe('layoutTree', …)` block in layout.spec.ts
  it('centers a parent over the FIRST and LAST child span (3+ children)', () => {
    const wide: RenderNode = {
      id: 'r', kind: 'plan.root', props: {}, children: [
        { id: 'a', kind: 'plan', props: {}, children: [] },
        { id: 'b', kind: 'plan', props: {}, children: [] },
        { id: 'c', kind: 'plan', props: {}, children: [] },
      ],
    };
    const pos = layoutTree(wide, { xGap: 100, yGap: 50 });
    expect(pos.get('a')).toEqual({ x: 0, y: 50 });
    expect(pos.get('b')).toEqual({ x: 100, y: 50 });
    expect(pos.get('c')).toEqual({ x: 200, y: 50 });
    expect(pos.get('r')).toEqual({ x: 100, y: 0 }); // midpoint of a(0) and c(200), NOT mean of all three
  });
```

- [ ] **Step 2: Run to verify it passes against the current code** (the existing implementation already centers over first/last, so this test should PASS now — it is a regression lock that must stay green through the refactor)

Run: `npx nx vite:test design-system-core`
Expected: PASS (the new test + all existing layout tests).

- [ ] **Step 3: Apply the micro-perf refactor** — replace the `else` branch of `assign` in `layoutTree`:

```ts
    } else {
      // Micro-perf: only the first & last child x are needed to center the
      // parent, but EVERY child must still be assigned (side effects: nextLeaf
      // advance + out.set per node). Track endpoints without allocating an array.
      let firstX = 0;
      let lastX = 0;
      n.children.forEach((c, i) => {
        const cx = assign(c, depth + 1);
        if (i === 0) firstX = cx;
        lastX = cx;
      });
      x = (firstX + lastX) / 2;
    }
```

- [ ] **Step 4: Run to verify it still passes**

Run: `npx nx vite:test design-system-core`
Expected: PASS (identical results — the refactor is behavior-preserving).

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/layout.ts \
        libs/design-system-core/src/public/board-kit/layout.spec.ts
git commit -m "perf(board-kit): layoutTree centers via first/last child without materializing childXs"
```

---

### Task A2: `renderDefinitionContract` — pure conformance harness

Spec §6.3 names a `renderDefinitionContract(def)` harness that *any* kind runs against: draw returns primitives, bounds finite, describe non-empty, edit transforms are pure (same input → same output, no mutation), and every drag tool declares a keyboard path. Mirroring the module's existing `validateRegistry`/`validateTree` style, this is a **pure function returning violations** (not a vitest `describe` block) — so it is runner-agnostic and a consumer can wrap it in their own `it()`.

**Files:**
- Create: `libs/design-system-core/src/public/board-kit/render-definition-contract.ts`
- Test: `libs/design-system-core/src/public/board-kit/render-definition-contract.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// render-definition-contract.spec.ts
import { describe, it, expect } from 'vitest';
import { renderDefinitionContract } from './render-definition-contract.js';
import type { RenderDefinition, RenderNode } from './render-node.js';

const node = (props: object): RenderNode => ({ id: 'n', kind: 'dot', props, children: [] });

const conforming: RenderDefinition<{ x: number; y: number }> = {
  kind: 'dot',
  draw: () => [{ p: 'circle', cx: 0, cy: 0, r: 4 }],
  bounds: () => ({ x: -4, y: -4, w: 8, h: 8 }),
  describe: (n) => ({ role: 'img', name: `dot ${n.props.x},${n.props.y}` }),
  edit: {
    tools: [{ id: 'move', label: 'Move', gesture: 'drag', keyboard: true }],
    hitTest: () => null,
    onGesture: (_g, _t, tree) => ({ tree }), // pure: returns input tree unchanged
    onKey: () => null,
  },
};

describe('renderDefinitionContract', () => {
  it('passes a conforming definition', () => {
    expect(renderDefinitionContract(conforming, node({ x: 1, y: 2 }))).toEqual([]);
  });

  it('flags a drag tool with no keyboard path', () => {
    const bad: RenderDefinition = {
      ...conforming,
      edit: { ...conforming.edit!, tools: [{ id: 'move', label: 'Move', gesture: 'drag' }] },
    };
    expect(renderDefinitionContract(bad, node({ x: 1, y: 2 }))).toContainEqual({
      code: 'drag-tool-no-keyboard',
      detail: "tool 'move' offers drag without a keyboard path",
    });
  });

  it('flags a non-finite bounds', () => {
    const bad: RenderDefinition = { ...conforming, bounds: () => ({ x: 0, y: 0, w: NaN, h: 8 }) };
    expect(renderDefinitionContract(bad, node({ x: 1, y: 2 }))).toContainEqual({
      code: 'non-finite-bounds',
      detail: 'bounds returned a non-finite value',
    });
  });

  it('flags an empty describe name', () => {
    const bad: RenderDefinition = { ...conforming, describe: () => ({ role: 'img', name: '' }) };
    expect(renderDefinitionContract(bad, node({ x: 1, y: 2 }))).toContainEqual({
      code: 'empty-describe-name',
      detail: 'describe() returned an empty name',
    });
  });

  it('flags an impure onGesture that mutates its input tree', () => {
    const bad: RenderDefinition = {
      ...conforming,
      edit: {
        ...conforming.edit!,
        onGesture: (_g, _t, tree) => {
          (tree as { id: string }).id = 'MUTATED'; // illegal in-place mutation
          return { tree };
        },
      },
    };
    expect(renderDefinitionContract(bad, node({ x: 1, y: 2 }))).toContainEqual({
      code: 'impure-edit',
      detail: 'onGesture mutated its input tree',
    });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-core`
Expected: FAIL — `renderDefinitionContract` not found.

- [ ] **Step 3: Implement**

```ts
// render-definition-contract.ts — pure conformance harness for a single
// RenderDefinition (spec §6.3). Runner-agnostic: returns violations, like
// validateRegistry/validateTree. A consumer wraps it in their own test:
//   it('conforms', () => expect(renderDefinitionContract(def, sample)).toEqual([]));
import type { EditContext, RenderDefinition, RenderNode } from './render-node.js';
import type { Gesture, KeyboardSample } from './gesture.js';

export interface ContractViolation {
  code:
    | 'draw-not-array'
    | 'non-finite-bounds'
    | 'empty-describe-name'
    | 'drag-tool-no-keyboard'
    | 'impure-edit';
  detail: string;
}

const isFiniteNum = (v: number): boolean => typeof v === 'number' && Number.isFinite(v);

/** Run the draw/bounds/describe/edit halves of `def` against `sample` and
 *  return any contract violations. `sample` must be a node of `def.kind`. */
export function renderDefinitionContract(
  def: RenderDefinition,
  sample: RenderNode,
): ContractViolation[] {
  const out: ContractViolation[] = [];
  const ctx: EditContext & { frame: EditContext['frame'] } = {
    frame: { id: 'contract', width: 100, height: 100, layout: { mode: 'free' } },
  };

  // DRAW half
  const prims = def.draw(sample, ctx);
  if (!Array.isArray(prims)) out.push({ code: 'draw-not-array', detail: 'draw() did not return an array' });

  const b = def.bounds(sample, ctx);
  if (!isFiniteNum(b.x) || !isFiniteNum(b.y) || !isFiniteNum(b.w) || !isFiniteNum(b.h)) {
    out.push({ code: 'non-finite-bounds', detail: 'bounds returned a non-finite value' });
  }

  const a = def.describe(sample);
  if (!a.name || a.name.trim() === '') {
    out.push({ code: 'empty-describe-name', detail: 'describe() returned an empty name' });
  }

  // EDIT half (optional)
  if (def.edit) {
    for (const tool of def.edit.tools) {
      if (tool.gesture === 'drag' && !tool.keyboard) {
        out.push({
          code: 'drag-tool-no-keyboard',
          detail: `tool '${tool.id}' offers drag without a keyboard path`,
        });
      }
    }
    // Purity probe: a deep-frozen input must not be mutated by the transforms.
    const frozen = deepFreeze(structuredCloneNode(sample));
    const target = { nodeId: sample.id };
    const drag: Gesture = { type: 'drag', x1: 0, y1: 0, x2: 10, y2: 10 };
    const key: KeyboardSample = { key: 'ArrowRight' };
    try {
      def.edit.onGesture(drag, target, frozen, ctx);
    } catch {
      out.push({ code: 'impure-edit', detail: 'onGesture mutated its input tree' });
    }
    try {
      def.edit.onKey(key, target, frozen, ctx);
    } catch {
      out.push({ code: 'impure-edit', detail: 'onKey mutated its input tree' });
    }
  }
  return out;
}

function structuredCloneNode(n: RenderNode): RenderNode {
  return { id: n.id, kind: n.kind, props: { ...(n.props as object) }, children: n.children.map(structuredCloneNode) };
}

function deepFreeze(n: RenderNode): RenderNode {
  Object.freeze(n.props);
  n.children.forEach(deepFreeze);
  return Object.freeze(n);
}
```

> Note: a pure transform reads the frozen tree and returns a *new* tree (structural sharing), so it never writes the frozen input — `Object.freeze` makes an illegal in-place write throw, which the `try/catch` reports as `impure-edit`. (`structuredClone` is avoided because `RenderNode.children` is `readonly`; the small hand clone keeps the freeze targets ours.)

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-core`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/render-definition-contract.ts \
        libs/design-system-core/src/public/board-kit/render-definition-contract.spec.ts
git commit -m "feat(board-kit): renderDefinitionContract pure conformance harness (spec §6.3)"
```

---

### Task A3: mark `mapNode` `@internal`

`mapNode` is the structural-sharing primitive that `insertChild`/`patchNodeProps` wrap; consumers (including the Angular brick) use those wrappers + `removeNode`/`reparentNode`, never `mapNode` directly. Plan 1's review flagged it should not be public API. Add the `@internal` tag (it is dropped from the barrel in Task A4).

**Files:**
- Modify: `libs/design-system-core/src/public/board-kit/tree-ops.ts:30` (the `mapNode` JSDoc)

- [ ] **Step 1: Verify nothing outside core imports `mapNode`** (it is only used inside `tree-ops.ts`)

Run: `grep -rn "mapNode" libs --include=*.ts | grep -v "design-system-core/src/public/board-kit/tree-ops"`
Expected: no matches outside `tree-ops.ts` (and its spec, which imports from `./tree-ops.js` directly — unaffected by the barrel).

- [ ] **Step 2: Add the `@internal` tag** — replace the `mapNode` JSDoc:

```ts
/**
 * Apply `replacer` to the node with `id`, sharing unchanged subtrees by reference.
 * @internal Structural-sharing primitive — use insertChild/removeNode/reparentNode/
 * patchNodeProps instead. Not part of the public Board Kit surface.
 */
export function mapNode(
```

- [ ] **Step 3: Run core tests to confirm nothing broke** (the in-module spec import still resolves `mapNode`)

Run: `npx nx vite:test design-system-core`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/tree-ops.ts
git commit -m "docs(board-kit): mark mapNode @internal (structural-sharing primitive)"
```

---

### Task A4: core barrel + API report regen + core gate

**Files:**
- Modify: `libs/design-system-core/src/public/board-kit/index.ts`
- Modify: `libs/design-system-core/etc/design-system-core.api.md` (regenerated)

- [ ] **Step 1: Update the board-kit barrel** — in `index.ts`, (a) remove `mapNode` from the `tree-ops.js` export, (b) add the contract export. Replace the `tree-ops.js` value-export line and append the contract exports:

```ts
// tree mutations (mapNode is @internal — not re-exported)
export {
  validateTree, findNode, insertChild, removeNode, reparentNode, patchNodeProps,
} from './tree-ops.js';
```

Append after the `validate-registry.js` exports:

```ts
export type { ContractViolation } from './render-definition-contract.js';
export { renderDefinitionContract } from './render-definition-contract.js';
```

- [ ] **Step 2: Build + typecheck core**

Run: `npx nx build design-system-core && npx nx typecheck design-system-core`
Expected: both succeed.

- [ ] **Step 3: Regenerate the core API report**

Run: `cd libs/design-system-core && npx api-extractor run --local --verbose && cd -`
Expected: `etc/design-system-core.api.md` updated — `mapNode()` **removed** from the public surface; `renderDefinitionContract()` + `ContractViolation` **added**. api-extractor exits 0.

- [ ] **Step 4: Confirm the API diff**

Run: `git diff --stat libs/design-system-core/etc/design-system-core.api.md && grep -c "mapNode" libs/design-system-core/etc/design-system-core.api.md`
Expected: the `.api.md` shows changes; `mapNode` count is `0`.

- [ ] **Step 5: Refresh the dist symlink so the Angular build sees the new core surface**

Run: `bash scripts/setup-dev.sh`
Expected: `linked @de-braighter/design-system-core -> dist/libs/design-system-core` (idempotent; harmless if already linked).

- [ ] **Step 6: Commit**

```bash
git add libs/design-system-core/src/public/board-kit/index.ts \
        libs/design-system-core/etc/design-system-core.api.md
git commit -m "feat(board-kit): export renderDefinitionContract; drop mapNode from public barrel"
```

---

## Part B — the pure engine helpers (`board-kit.engine.ts`)

All Board Kit *logic* lives here as pure functions so it is unit-tested without the DOM, exactly as Plan 1's core is. The component (Part C) is a thin shell that calls these.

### Task B1: `buildRenderModel` — flatten + draw + describe + per-node isolation

Produces the flat draw list the component's template iterates. Spec §6.2 per-node render isolation: a `draw`/`bounds`/`describe` that throws (or a missing kind) renders a fallback placeholder + logs; it does not take down siblings.

**Files:**
- Create: `libs/design-system-angular/src/public/board-kit/board-kit.engine.ts`
- Test: `libs/design-system-angular/src/public/board-kit/board-kit.engine.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// board-kit.engine.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { buildRenderModel } from './board-kit.engine.js';
import type {
  BoardRegistry, DrawContext, RenderDefinition, RenderNode,
} from '@de-braighter/design-system-core';

const ctx: DrawContext = { frame: { id: 'f', width: 100, height: 100, layout: { mode: 'free' } } };

const dot: RenderDefinition = {
  kind: 'dot',
  draw: () => [{ p: 'circle', cx: 0, cy: 0, r: 4 }],
  bounds: () => ({ x: -4, y: -4, w: 8, h: 8 }),
  describe: (n) => ({ role: 'img', name: `dot ${n.id}` }),
  edit: { tools: [], hitTest: () => null, onGesture: () => null, onKey: () => null },
};

const tree: RenderNode = {
  id: 'r', kind: 'root', props: {}, children: [
    { id: 'a', kind: 'dot', props: { x: 10, y: 20 }, children: [] },
  ],
};

describe('buildRenderModel', () => {
  it('emits one item per node, with primitives + a11y + position + editability', () => {
    const reg: BoardRegistry = new Map([['dot', dot]]);
    const positions = new Map([['a', { x: 10, y: 20 }]]);
    const items = buildRenderModel(tree, positions, reg, ctx);
    const a = items.find((i) => i.id === 'a')!;
    expect(a.pos).toEqual({ x: 10, y: 20 });
    expect(a.primitives).toEqual([{ p: 'circle', cx: 0, cy: 0, r: 4 }]);
    expect(a.a11y).toEqual({ role: 'img', name: 'dot a' });
    expect(a.editable).toBe(true);
  });

  it('renders a fallback placeholder for an unregistered kind (does not throw)', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const items = buildRenderModel(tree, new Map(), new Map(), ctx);
    const r = items.find((i) => i.id === 'r')!;
    expect(r.fallback).toBe(true);
    expect(r.a11y.name).toContain('root'); // names the kind
    expect(r.editable).toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('isolates a throwing draw — sibling still renders', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom: RenderDefinition = { ...dot, kind: 'boom', draw: () => { throw new Error('x'); } };
    const reg: BoardRegistry = new Map([['dot', dot], ['boom', boom]]);
    const t: RenderNode = {
      id: 'r', kind: 'dot', props: {}, children: [
        { id: 'bad', kind: 'boom', props: {}, children: [] },
        { id: 'ok', kind: 'dot', props: {}, children: [] },
      ],
    };
    const items = buildRenderModel(t, new Map(), reg, ctx);
    expect(items.find((i) => i.id === 'bad')!.fallback).toBe(true);
    expect(items.find((i) => i.id === 'ok')!.fallback).toBeFalsy();
    err.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-angular`
Expected: FAIL — `buildRenderModel` not found.

- [ ] **Step 3: Implement**

```ts
// board-kit.engine.ts — pure Board Kit engine helpers (no Angular, no DOM).
// The <ds-board-kit> component is a thin signal/DOM shell over these.
import {
  classifyPress, findNode, validateTree,
} from '@de-braighter/design-system-core';
import type {
  A11yDescriptor, BoardRegistry, DrawContext, EditContext, EditResult, EditTarget,
  Gesture, KeyboardSample, LayoutResult, NodePosition, Point, RenderNode, SvgPrimitive,
} from '@de-braighter/design-system-core';

export interface RenderItem {
  id: string;
  kind: string;
  pos: NodePosition;
  primitives: readonly SvgPrimitive[];
  a11y: A11yDescriptor;
  editable: boolean;
  /** true when the kind was missing or draw/describe threw — a placeholder was substituted. */
  fallback?: boolean;
}

const FALLBACK_PRIMS: readonly SvgPrimitive[] = [
  { p: 'rect', x: -8, y: -8, w: 16, h: 16, fill: 'none', stroke: 'var(--err, #ff5d5d)', rx: 2 },
  { p: 'text', x: 0, y: 4, text: '?', anchor: 'middle', fill: 'var(--err, #ff5d5d)' },
];

function fallbackItem(node: RenderNode, pos: NodePosition, why: string): RenderItem {
  console.error(`[board-kit] node '${node.id}' (kind '${node.kind}') unrenderable: ${why}`);
  return {
    id: node.id, kind: node.kind, pos, primitives: FALLBACK_PRIMS, editable: false, fallback: true,
    a11y: { role: 'img', name: `Unrenderable node (kind ${node.kind})` },
  };
}

/** Flatten the tree (pre-order) to a positioned draw list, isolating per-node failures. */
export function buildRenderModel(
  tree: RenderNode,
  positions: LayoutResult,
  registry: BoardRegistry,
  ctx: DrawContext,
): RenderItem[] {
  const items: RenderItem[] = [];
  const walk = (n: RenderNode): void => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    const def = registry.get(n.kind);
    if (!def) {
      items.push(fallbackItem(n, pos, 'no RenderDefinition registered'));
    } else {
      try {
        items.push({
          id: n.id, kind: n.kind, pos,
          primitives: def.draw(n, ctx),
          a11y: def.describe(n),
          editable: !!def.edit,
        });
      } catch (err) {
        items.push(fallbackItem(n, pos, String(err)));
      }
    }
    n.children.forEach(walk);
  };
  walk(tree);
  return items;
}
```

> Keep the `classifyPress`/`findNode`/`validateTree`/`Gesture`/`KeyboardSample`/`EditResult`/`EditTarget`/`EditContext`/`Point` imports in place even though only `buildRenderModel` uses a subset now — Tasks B2/B3 add `hitTestTree`/`applyGesture`/`applyKey` to this same file and need them. (If your linter flags unused imports before B2/B3 land, add them in B2/B3 instead and keep B1's import list to what it uses: `A11yDescriptor, BoardRegistry, DrawContext, LayoutResult, NodePosition, RenderNode, SvgPrimitive`.)

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-angular`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-angular/src/public/board-kit/board-kit.engine.ts \
        libs/design-system-angular/src/public/board-kit/board-kit.engine.spec.ts
git commit -m "feat(board-kit): buildRenderModel (flatten + draw + a11y + per-node isolation)"
```

---

### Task B2: `hitTestTree` — route a board point to a target node

Resolves which node a board-space `Point` hits. Iterates nodes in **reverse paint order** (topmost first), converting the point to node-local space (`at - pos`); prefers per-kind `def.edit.hitTest`, falls back to `def.bounds` containment for read-only kinds (so they are still selectable). Returns `{ nodeId }` or `{ nodeId: null }` for canvas.

**Files:**
- Modify: `libs/design-system-angular/src/public/board-kit/board-kit.engine.ts`
- Modify: `libs/design-system-angular/src/public/board-kit/board-kit.engine.spec.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to board-kit.engine.spec.ts
import { hitTestTree } from './board-kit.engine.js';
import type { EditContext } from '@de-braighter/design-system-core';

const editCtx: EditContext = ctx;

describe('hitTestTree', () => {
  const reg: BoardRegistry = new Map([['dot', dot]]);
  const positions = new Map([['a', { x: 10, y: 20 }]]);

  it('hits a node via its per-kind hitTest (node-local coords)', () => {
    const hitDot: RenderDefinition = {
      ...dot,
      edit: { ...dot.edit!, hitTest: (_n, at) => (Math.hypot(at.x, at.y) <= 4 ? { nodeId: _n.id } : null) },
    };
    const r = hitTestTree(tree, positions, new Map([['dot', hitDot]]), { x: 12, y: 22 }, editCtx);
    expect(r).toEqual({ nodeId: 'a' }); // (12,22) - pos(10,20) = (2,2), within r=4
  });

  it('misses → canvas target', () => {
    const hitDot: RenderDefinition = {
      ...dot,
      edit: { ...dot.edit!, hitTest: (_n, at) => (Math.hypot(at.x, at.y) <= 4 ? { nodeId: _n.id } : null) },
    };
    expect(hitTestTree(tree, positions, new Map([['dot', hitDot]]), { x: 90, y: 90 }, editCtx))
      .toEqual({ nodeId: null });
  });

  it('falls back to bounds containment for a kind without hitTest', () => {
    const ro: RenderDefinition = { kind: 'dot', draw: dot.draw, bounds: dot.bounds, describe: dot.describe };
    const r = hitTestTree(tree, positions, new Map([['dot', ro]]), { x: 11, y: 21 }, editCtx);
    expect(r).toEqual({ nodeId: 'a' }); // bounds(-4..4) around pos(10,20) contains (11,21)
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-angular`
Expected: FAIL — `hitTestTree` not exported.

- [ ] **Step 3: Implement (append to board-kit.engine.ts)**

```ts
function flatten(tree: RenderNode): RenderNode[] {
  const out: RenderNode[] = [];
  const walk = (n: RenderNode): void => { out.push(n); n.children.forEach(walk); };
  walk(tree);
  return out;
}

function within(b: { x: number; y: number; w: number; h: number }, p: Point): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
}

/** Resolve the node hit by a board-space point. Reverse paint order = topmost wins. */
export function hitTestTree(
  tree: RenderNode,
  positions: LayoutResult,
  registry: BoardRegistry,
  at: Point,
  ctx: EditContext,
): EditTarget {
  const nodes = flatten(tree);
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const n = nodes[i];
    const def = registry.get(n.kind);
    if (!def) continue;
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    const local: Point = { x: at.x - pos.x, y: at.y - pos.y };
    if (def.edit?.hitTest) {
      const hit = def.edit.hitTest(n, local, ctx);
      if (hit) return { nodeId: hit.nodeId };
    } else if (within(def.bounds(n, ctx), local)) {
      return { nodeId: n.id };
    }
  }
  return { nodeId: null };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-angular`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-angular/src/public/board-kit/board-kit.engine.ts \
        libs/design-system-angular/src/public/board-kit/board-kit.engine.spec.ts
git commit -m "feat(board-kit): hitTestTree (reverse paint order, node-local hitTest + bounds fallback)"
```

---

### Task B3: `applyGesture` + `applyKey` — route to the target kind, validate the result

Looks up the **target node's** kind, calls its `onGesture`/`onKey`, and **rejects an invalid returned tree** (spec §6.2: a return that violates the invariants is a no-op + dev error, never applied). `null` target or `null` result → `null` (clean no-op).

**Files:**
- Modify: `libs/design-system-angular/src/public/board-kit/board-kit.engine.ts`
- Modify: `libs/design-system-angular/src/public/board-kit/board-kit.engine.spec.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to board-kit.engine.spec.ts
import { applyGesture, applyKey } from './board-kit.engine.js';
import { patchNodeProps } from '@de-braighter/design-system-core';
import type { Gesture, KeyboardSample } from '@de-braighter/design-system-core';

describe('applyGesture / applyKey', () => {
  const moveDot: RenderDefinition = {
    ...dot,
    edit: {
      tools: [{ id: 'move', label: 'Move', gesture: 'drag', keyboard: true }],
      hitTest: () => null,
      onGesture: (g, t, tr) => {
        if (g.type !== 'drag' || t.nodeId == null) return null;
        const n = findNodeProps(tr, t.nodeId);
        const nx = n.x + (g.x2 - g.x1);
        const ny = n.y + (g.y2 - g.y1);
        return { tree: patchNodeProps(tr, t.nodeId, { x: nx, y: ny }), intent: { op: 'move', nodeId: t.nodeId, x: nx, y: ny } };
      },
      onKey: (k, t, tr) => {
        if (t.nodeId == null || k.key !== 'ArrowRight') return null;
        const n = findNodeProps(tr, t.nodeId);
        return { tree: patchNodeProps(tr, t.nodeId, { x: n.x + 8, y: n.y }), intent: { op: 'move', nodeId: t.nodeId, x: n.x + 8, y: n.y } };
      },
    },
  };
  function findNodeProps(tr: RenderNode, id: string): { x: number; y: number } {
    const found = (function f(n: RenderNode): RenderNode | null {
      if (n.id === id) return n;
      for (const c of n.children) { const h = f(c); if (h) return h; }
      return null;
    })(tr);
    return found!.props as { x: number; y: number };
  }
  const reg: BoardRegistry = new Map([['dot', moveDot]]);
  const t: RenderNode = { id: 'r', kind: 'dot', props: { x: 0, y: 0 }, children: [{ id: 'a', kind: 'dot', props: { x: 10, y: 20 }, children: [] }] };

  it('applyGesture moves the target node and returns the intent', () => {
    const g: Gesture = { type: 'drag', x1: 0, y1: 0, x2: 5, y2: 7 };
    const res = applyGesture(t, { nodeId: 'a' }, g, reg, editCtx)!;
    const a = res.tree.children[0].props as { x: number; y: number };
    expect(a).toEqual({ x: 15, y: 27 });
    expect(res.intent).toEqual({ op: 'move', nodeId: 'a', x: 15, y: 27 });
  });

  it('applyKey moves on ArrowRight', () => {
    const res = applyKey(t, { nodeId: 'a' }, { key: 'ArrowRight' }, reg, editCtx)!;
    expect((res.tree.children[0].props as { x: number }).x).toBe(18);
  });

  it('null target → null (clean no-op)', () => {
    expect(applyGesture(t, { nodeId: null }, { type: 'drag', x1: 0, y1: 0, x2: 5, y2: 5 }, reg, editCtx)).toBeNull();
  });

  it('rejects a transform that returns an invalid tree (duplicate id)', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const dupReg: BoardRegistry = new Map([['dot', {
      ...moveDot,
      edit: { ...moveDot.edit!, onGesture: () => ({ tree: { id: 'r', kind: 'dot', props: {}, children: [{ id: 'r', kind: 'dot', props: {}, children: [] }] } }) },
    }]]);
    expect(applyGesture(t, { nodeId: 'a' }, { type: 'drag', x1: 0, y1: 0, x2: 9, y2: 9 }, dupReg, editCtx)).toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-angular`
Expected: FAIL — `applyGesture`/`applyKey` not exported.

- [ ] **Step 3: Implement (append to board-kit.engine.ts)**

```ts
function routeEdit(
  tree: RenderNode,
  target: EditTarget,
  registry: BoardRegistry,
  run: (def: NonNullable<ReturnType<BoardRegistry['get']>>['edit']) => EditResult | null,
): EditResult | null {
  if (target.nodeId == null) return null;
  const node = findNode(tree, target.nodeId);
  if (!node) return null;
  const def = registry.get(node.kind);
  if (!def?.edit) return null;
  const result = run(def.edit);
  if (!result) return null;
  const errors = validateTree(result.tree);
  if (errors.length > 0) {
    console.error(`[board-kit] edit rejected — invalid tree: ${errors.map((e) => `${e.code}(${e.detail})`).join(', ')}`);
    return null;
  }
  return result;
}

/** Route a gesture to the target node's kind; reject an invariant-violating result. */
export function applyGesture(
  tree: RenderNode, target: EditTarget, gesture: Gesture, registry: BoardRegistry, ctx: EditContext,
): EditResult | null {
  return routeEdit(tree, target, registry, (edit) => edit!.onGesture(gesture, target, tree, ctx));
}

/** Route a key to the target node's kind; reject an invariant-violating result. */
export function applyKey(
  tree: RenderNode, target: EditTarget, key: KeyboardSample, registry: BoardRegistry, ctx: EditContext,
): EditResult | null {
  return routeEdit(tree, target, registry, (edit) => edit!.onKey(key, target, tree, ctx));
}
```

> Now every import listed in B1's note is used. If any remain unused (`classifyPress`, `Point` are used by B2; `Gesture`/`KeyboardSample`/`EditResult`/`EditTarget`/`EditContext` by B3), the lint step in Task D3 will catch it — keep the import list to exactly what the three tasks reference.

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-angular`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-angular/src/public/board-kit/board-kit.engine.ts \
        libs/design-system-angular/src/public/board-kit/board-kit.engine.spec.ts
git commit -m "feat(board-kit): applyGesture/applyKey routing + returned-tree invariant rejection"
```

---

## Part C — the `<ds-board-kit>` component

### Task C1: `BoardKitComponent` — S2 read-only render + a11y + roving focus

Renders the tree via the engine, runs layout, draws declarative primitives into a managed `<svg>`, applies `describe()` per node, and owns roving-tabindex focus + a `validateRegistry` dev gate. **Read-only** — no edit wiring yet.

**Files:**
- Create: `libs/design-system-angular/src/public/board-kit/board-kit.component.ts`
- Test: `libs/design-system-angular/src/public/board-kit/board-kit.component.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// board-kit.component.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BoardKitComponent } from './board-kit.component.js';
import type { BoardRegistry, Frame, RenderDefinition, RenderNode } from '@de-braighter/design-system-core';

const dot: RenderDefinition<{ x: number; y: number; label: string }> = {
  kind: 'dot',
  draw: () => [{ p: 'circle', cx: 0, cy: 0, r: 6 }],
  bounds: () => ({ x: -6, y: -6, w: 12, h: 12 }),
  describe: (n) => ({ role: 'img', name: `Dot ${n.props.label}` }),
  edit: {
    tools: [{ id: 'move', label: 'Move', gesture: 'drag', keyboard: true }],
    hitTest: (n, at) => (Math.hypot(at.x, at.y) <= 6 ? { nodeId: n.id } : null),
    onGesture: () => null,
    onKey: () => null,
  },
};
const registry: BoardRegistry = new Map([['dot', dot]]);
const frame: Frame = { id: 'f', width: 200, height: 120, layout: { mode: 'free' } };
const tree: RenderNode = {
  id: 'board', kind: 'dot', props: { x: 0, y: 0, label: 'root' }, children: [
    { id: 'a', kind: 'dot', props: { x: 30, y: 40, label: 'A' }, children: [] },
  ],
};

function mount(t = tree) {
  const f = TestBed.createComponent(BoardKitComponent);
  f.componentRef.setInput('tree', t);
  f.componentRef.setInput('registry', registry);
  f.componentRef.setInput('frame', frame);
  f.detectChanges();
  return f;
}

describe('BoardKitComponent (S2 render)', () => {
  it('renders an <svg> sized by the frame', () => {
    const f = mount();
    const svg = f.nativeElement.querySelector('svg') as SVGSVGElement;
    expect(svg.getAttribute('viewBox')).toBe('0 0 200 120');
  });

  it('draws a circle for the marker, translated to its layout position', () => {
    const f = mount();
    const g = f.nativeElement.querySelector('[data-node-id="a"]') as SVGGElement;
    expect(g.getAttribute('transform')).toBe('translate(30,40)');
    expect(g.querySelector('circle')).not.toBeNull();
  });

  it('labels each node group from describe() (role + aria-label)', () => {
    const f = mount();
    const g = f.nativeElement.querySelector('[data-node-id="a"]') as SVGGElement;
    expect(g.getAttribute('role')).toBe('img');
    expect(g.getAttribute('aria-label')).toBe('Dot A');
  });

  it('gives the first editable node a roving tabindex of 0', () => {
    const f = mount();
    const a = f.nativeElement.querySelector('[data-node-id="a"]') as SVGGElement;
    expect(a.getAttribute('tabindex')).toBe('0');
  });

  it('throws in dev when the registry is non-conformant (drag tool, no keyboard)', () => {
    const badDot: RenderDefinition = { ...dot, edit: { ...dot.edit!, tools: [{ id: 'move', label: 'Move', gesture: 'drag' }] } };
    const f = TestBed.createComponent(BoardKitComponent);
    f.componentRef.setInput('tree', tree);
    f.componentRef.setInput('registry', new Map([['dot', badDot]]) as BoardRegistry);
    f.componentRef.setInput('frame', frame);
    expect(() => f.detectChanges()).toThrow(/board-kit.*registry/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-angular`
Expected: FAIL — `BoardKitComponent` not found.

- [ ] **Step 3: Implement**

```ts
// board-kit.component.ts — <ds-board-kit> generic recursive presentation-tree
// renderer + editor (design spec §3–§8, slices S2/S3). Domain-free: knows
// nothing about football, plans, or kernels — it consumes a RenderNode tree +
// a kind→RenderDefinition registry. Approach A: edits are pure transforms
// returning a new tree (board-kit.engine.ts); undo is snapshot-based.
import {
  ChangeDetectionStrategy, Component, ElementRef, OnInit, computed, effect, inject,
  input, isDevMode, linkedSignal, output, signal, viewChild,
} from '@angular/core';
import {
  SnapshotStack, runLayout, validateRegistry,
} from '@de-braighter/design-system-core';
import type {
  BoardRegistry, DrawContext, EditResult, Frame, RenderNode, SvgPrimitive,
} from '@de-braighter/design-system-core';
import { buildRenderModel, type RenderItem } from './board-kit.engine.js';

@Component({
  selector: 'ds-board-kit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      #svg
      class="bk-canvas"
      [attr.viewBox]="'0 0 ' + frame().width + ' ' + frame().height"
      role="application"
      [attr.aria-label]="ariaLabel()"
      preserveAspectRatio="xMidYMid meet"
    >
      @for (item of items(); track item.id) {
        <g
          [attr.data-node-id]="item.id"
          [attr.transform]="'translate(' + item.pos.x + ',' + item.pos.y + ')'"
          [attr.role]="item.a11y.role"
          [attr.aria-label]="item.a11y.name"
          [attr.tabindex]="item.id === tabTargetId() ? 0 : (item.editable ? -1 : null)"
          [class.bk-selected]="item.id === selection()"
          (keydown)="onKeyDown($event, item.id)"
        >
          @for (p of item.primitives; track $index) {
            @switch (p.p) {
              @case ('circle') {
                <circle [attr.cx]="p.cx" [attr.cy]="p.cy" [attr.r]="p.r"
                  [attr.fill]="p.fill ?? 'none'" [attr.stroke]="p.stroke ?? null" [attr.stroke-width]="p.strokeWidth ?? null" />
              }
              @case ('line') {
                <line [attr.x1]="p.x1" [attr.y1]="p.y1" [attr.x2]="p.x2" [attr.y2]="p.y2"
                  [attr.stroke]="p.stroke ?? 'currentColor'" [attr.stroke-width]="p.strokeWidth ?? null" [attr.stroke-dasharray]="p.dash ?? null" />
              }
              @case ('rect') {
                <rect [attr.x]="p.x" [attr.y]="p.y" [attr.width]="p.w" [attr.height]="p.h"
                  [attr.fill]="p.fill ?? 'none'" [attr.stroke]="p.stroke ?? null" [attr.rx]="p.rx ?? null" />
              }
              @case ('path') {
                <path [attr.d]="p.d" [attr.fill]="p.fill ?? 'none'" [attr.stroke]="p.stroke ?? null" />
              }
              @case ('text') {
                <text [attr.x]="p.x" [attr.y]="p.y" [attr.fill]="p.fill ?? 'currentColor'" [attr.text-anchor]="p.anchor ?? 'start'">{{ p.text }}</text>
              }
            }
          }
        </g>
      }
    </svg>
  `,
  styles: [`
    :host { display: block; }
    .bk-canvas { width: 100%; height: auto; touch-action: none; -webkit-user-select: none; user-select: none; }
    .bk-canvas [data-node-id] { outline: none; cursor: pointer; }
    .bk-canvas [data-node-id]:focus-visible { outline: 2px solid var(--focus, #5ad1ff); outline-offset: 2px; }
    .bk-canvas .bk-selected { filter: drop-shadow(0 0 2px var(--focus, #5ad1ff)); }
  `],
})
export class BoardKitComponent implements OnInit {
  /** The host's projection output (a derived RenderNode tree). */
  readonly tree = input.required<RenderNode>();
  /** kind → RenderDefinition. */
  readonly registry = input.required<BoardRegistry>();
  /** Coordinate + layout config (one frame this arc; multi-frame is deferred). */
  readonly frame = input.required<Frame>();
  /** Accessible name for the whole board. */
  readonly ariaLabel = input<string>('Editable board');
  /** Emitted on every committed edit (S3). */
  readonly commit = output<EditResult>();

  protected readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  private readonly host = inject(ElementRef);

  /** Optimistic working tree: resets to the input whenever the host re-projects. */
  protected readonly working = linkedSignal<RenderNode>(() => this.tree());
  protected readonly selection = signal<string | null>(null);
  protected readonly snapshot = new SnapshotStack<RenderNode>();

  protected readonly ctx = computed<DrawContext>(() => ({ frame: this.frame() }));
  protected readonly positions = computed(() => runLayout(this.working(), this.frame().layout));
  protected readonly items = computed<RenderItem[]>(() =>
    buildRenderModel(this.working(), this.positions(), this.registry(), this.ctx()),
  );

  /** Roving tabindex: the selected node, or the first editable node, gets tabindex 0. */
  protected readonly tabTargetId = computed(() => {
    const sel = this.selection();
    if (sel && this.items().some((i) => i.id === sel && i.editable)) return sel;
    return this.items().find((i) => i.editable)?.id ?? null;
  });

  constructor() {
    // New host projection (new tree identity) = fresh edit session.
    effect(() => { this.tree(); this.resetSession(); });
    // Focus follows selection after a (re-)render.
    effect(() => {
      const sel = this.selection();
      if (sel) queueMicrotask(() => this.focusNode(sel));
    });
  }

  ngOnInit(): void {
    // A11y boundary gate (spec §6.1): a partially-accessible registry is a
    // programming error — fail loudly in dev.
    if (isDevMode()) {
      const errors = validateRegistry(this.registry());
      if (errors.length > 0) {
        throw new Error(`[board-kit] non-conformant registry: ${errors.map((e) => `${e.kind}:${e.code}`).join(', ')}`);
      }
    }
  }

  protected onKeyDown(_ev: KeyboardEvent, _id: string): void { /* edit wiring in S3 (Task C2) */ }

  private resetSession(): void {
    this.snapshot.reset();
    this.selection.set(null);
  }

  private focusNode(id: string): void {
    const el = this.host.nativeElement.querySelector(`[data-node-id="${id}"]`) as SVGGElement | null;
    el?.focus();
  }
}
```

> `SnapshotStack` has no `reset()` today. Add one in core (it is a one-line, behavior-additive method) as part of this task — see Step 3b.

- [ ] **Step 3b: Add `SnapshotStack.reset()` to core** (the component needs to clear history on a new projection)

In `libs/design-system-core/src/public/board-kit/undo-stack.ts`, add inside the class:

```ts
  /** Drop all history (e.g. a fresh edit session on a new projection). */
  reset(): void {
    this.past = [];
    this.future = [];
  }
```

Add a test in `libs/design-system-core/src/public/board-kit/undo-stack.spec.ts`:

```ts
  it('reset() clears past and future', () => {
    const s = new SnapshotStack<string>(3);
    s.push('v0');
    s.undo('v1');
    s.reset();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
  });
```

Run core tests: `npx nx vite:test design-system-core` → PASS. (No barrel/api change — `SnapshotStack` is already exported; a new method widens the class surface, so **regenerate core's api.md in Task A4's pattern**: run `cd libs/design-system-core && npx api-extractor run --local --verbose && cd -` and include `etc/design-system-core.api.md` in this task's commit. If Task A4 already ran, just re-run the regen here.)

- [ ] **Step 4: Run to verify the component test passes**

Run: `npx nx vite:test design-system-angular`
Expected: PASS (5 component tests). If the registry-throw test fails because the effect/ngOnInit timing differs, confirm the throw happens in `ngOnInit` (inputs are set before `ngOnInit`, so `this.registry()` is readable there).

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-angular/src/public/board-kit/board-kit.component.ts \
        libs/design-system-angular/src/public/board-kit/board-kit.component.spec.ts \
        libs/design-system-core/src/public/board-kit/undo-stack.ts \
        libs/design-system-core/src/public/board-kit/undo-stack.spec.ts \
        libs/design-system-core/etc/design-system-core.api.md
git commit -m "feat(board-kit): <ds-board-kit> S2 read-only render + a11y + roving focus; SnapshotStack.reset"
```

---

### Task C2: `BoardKitComponent` — S3 edit wiring (pointer + keyboard + click-click + undo)

Wires the engine: a press → gesture → hit-test → `applyGesture` → snapshot + commit; arrow keys → `applyKey`; click-click drag alternative via `reduceAnchor`; `undo`/`redo`/`revertTo`; `canUndo`/`canRedo`. Routing is tested by calling the component's public engine methods directly (no synthetic DOM events — the same data-first discipline as the core).

**Files:**
- Modify: `libs/design-system-angular/src/public/board-kit/board-kit.component.ts`
- Modify: `libs/design-system-angular/src/public/board-kit/board-kit.component.spec.ts`

- [ ] **Step 1: Add failing tests**

```ts
// append to board-kit.component.spec.ts
import { patchNodeProps, findNode } from '@de-braighter/design-system-core';
import type { EditResult } from '@de-braighter/design-system-core';

// A registry whose marker actually moves, for edit tests.
const moveDot: RenderDefinition<{ x: number; y: number; label: string }> = {
  ...dot,
  edit: {
    tools: [{ id: 'move', label: 'Move', gesture: 'drag', keyboard: true }],
    hitTest: (n, at) => (Math.hypot(at.x, at.y) <= 6 ? { nodeId: n.id } : null),
    onGesture: (g, t, tr) => {
      if (g.type !== 'drag' || t.nodeId == null) return null;
      const p = findNode(tr, t.nodeId)!.props as { x: number; y: number };
      const nx = p.x + (g.x2 - g.x1); const ny = p.y + (g.y2 - g.y1);
      return { tree: patchNodeProps(tr, t.nodeId, { x: nx, y: ny }), intent: { op: 'move', nodeId: t.nodeId, x: nx, y: ny } };
    },
    onKey: (k, t, tr) => {
      if (t.nodeId == null || k.key !== 'ArrowRight') return null;
      const p = findNode(tr, t.nodeId)!.props as { x: number; y: number };
      return { tree: patchNodeProps(tr, t.nodeId, { x: p.x + 8, y: p.y }), intent: { op: 'move', nodeId: t.nodeId, x: p.x + 8, y: p.y } };
    },
  },
};
const moveReg: BoardRegistry = new Map([['dot', moveDot]]);

function mountEditable() {
  const f = TestBed.createComponent(BoardKitComponent);
  f.componentRef.setInput('tree', tree);
  f.componentRef.setInput('registry', moveReg);
  f.componentRef.setInput('frame', frame);
  f.detectChanges();
  return f;
}

describe('BoardKitComponent (S3 edit)', () => {
  it('routePress(drag) moves the hit node, emits commit, and re-renders', () => {
    const f = mountEditable();
    const c = f.componentInstance;
    const emitted: EditResult[] = [];
    c.commit.subscribe((e: EditResult) => emitted.push(e));
    // marker 'a' is at (30,40); grab on it, drag +10,+5
    c.routePress({ x: 30, y: 40 }, { x: 40, y: 45 });
    f.detectChanges();
    expect(emitted[0].intent).toEqual({ op: 'move', nodeId: 'a', x: 40, y: 45 });
    const g = f.nativeElement.querySelector('[data-node-id="a"]') as SVGGElement;
    expect(g.getAttribute('transform')).toBe('translate(40,45)');
    expect(c.canUndo).toBe(true);
  });

  it('a tap selects the node (no commit)', () => {
    const f = mountEditable();
    const c = f.componentInstance;
    let commits = 0; c.commit.subscribe(() => (commits += 1));
    c.routePress({ x: 30, y: 40 }, { x: 31, y: 40 }); // within DRAG_THRESHOLD → tap
    f.detectChanges();
    expect(commits).toBe(0);
    expect(f.nativeElement.querySelector('[data-node-id="a"]').classList.contains('bk-selected')).toBe(true);
  });

  it('routeKey(ArrowRight) moves the selected node', () => {
    const f = mountEditable();
    const c = f.componentInstance;
    c.selectNode('a');
    c.routeKey({ key: 'ArrowRight' });
    f.detectChanges();
    expect((f.nativeElement.querySelector('[data-node-id="a"]') as SVGGElement).getAttribute('transform')).toBe('translate(38,40)');
  });

  it('click-click is a drag alternative: anchor on the node, second click moves it', () => {
    const f = mountEditable();
    const c = f.componentInstance;
    c.setMode('two-click');
    c.routeClick({ x: 30, y: 40 }); // anchor on marker 'a'
    c.routeClick({ x: 60, y: 70 }); // commit: delta +30,+30
    f.detectChanges();
    expect((f.nativeElement.querySelector('[data-node-id="a"]') as SVGGElement).getAttribute('transform')).toBe('translate(60,70)');
  });

  it('undo restores the prior tree; redo replays', () => {
    const f = mountEditable();
    const c = f.componentInstance;
    c.routePress({ x: 30, y: 40 }, { x: 50, y: 40 }); // a → (50,40)
    f.detectChanges();
    c.undo();
    f.detectChanges();
    expect((f.nativeElement.querySelector('[data-node-id="a"]') as SVGGElement).getAttribute('transform')).toBe('translate(30,40)');
    c.redo();
    f.detectChanges();
    expect((f.nativeElement.querySelector('[data-node-id="a"]') as SVGGElement).getAttribute('transform')).toBe('translate(50,40)');
  });

  it('revertTo sets the working tree without growing undo history', () => {
    const f = mountEditable();
    const c = f.componentInstance;
    const fixed: RenderNode = { id: 'board', kind: 'dot', props: { x: 0, y: 0, label: 'root' }, children: [{ id: 'a', kind: 'dot', props: { x: 99, y: 99, label: 'A' }, children: [] }] };
    c.revertTo(fixed);
    f.detectChanges();
    expect((f.nativeElement.querySelector('[data-node-id="a"]') as SVGGElement).getAttribute('transform')).toBe('translate(99,99)');
    expect(c.canUndo).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx nx vite:test design-system-angular`
Expected: FAIL — `routePress`/`routeKey`/`routeClick`/`selectNode`/`setMode`/`undo`/`redo`/`revertTo`/`canUndo` not found.

- [ ] **Step 3: Implement** — extend `BoardKitComponent`. Add imports, fields, the engine façade methods, and the DOM handlers; replace the placeholder `onKeyDown`.

Update the import lines:

```ts
import {
  SnapshotStack, classifyPress, reduceAnchor, runLayout, validateRegistry,
} from '@de-braighter/design-system-core';
import type {
  AnchorState, BoardRegistry, DrawContext, EditContext, EditResult, Frame,
  KeyboardSample, PressSample, RenderNode, SvgPrimitive,
} from '@de-braighter/design-system-core';
import { applyGesture, applyKey, buildRenderModel, hitTestTree, type RenderItem } from './board-kit.engine.js';
```

Add fields (after `snapshot`):

```ts
  protected readonly mode = signal<'drag' | 'two-click'>('drag');
  protected readonly undoState = signal<{ canUndo: boolean; canRedo: boolean }>({ canUndo: false, canRedo: false });
  private anchor: AnchorState = null;
  private anchorTarget: string | null = null;
  private down: PressSample | null = null;
  private readonly editCtx = computed<EditContext>(() => ({ frame: this.frame() }));
```

Add the template wiring — put pointer handlers on the `<svg>` element (just after `preserveAspectRatio`):

```html
      (pointerdown)="onPointerDown($event)"
      (pointerup)="onPointerUp($event)"
```

Add the engine façade + DOM seam methods, and replace `onKeyDown`/`resetSession`:

```ts
  // ── Engine façade (host- and showcase-drivable) ───────────────────────────
  get canUndo(): boolean { return this.undoState().canUndo; }
  get canRedo(): boolean { return this.undoState().canRedo; }

  setMode(mode: 'drag' | 'two-click'): void { this.mode.set(mode); this.anchor = null; this.anchorTarget = null; }
  selectNode(id: string | null): void { this.selection.set(id); }

  undo(): void { const prev = this.snapshot.undo(this.working()); if (prev) { this.working.set(prev); this.refreshUndo(); } }
  redo(): void { const next = this.snapshot.redo(this.working()); if (next) { this.working.set(next); this.refreshUndo(); } }
  /** Host reconciliation (e.g. after a persistence failure): set the tree, no snapshot. */
  revertTo(tree: RenderNode): void { this.working.set(tree); }

  /** Pointer press → gesture → hit-test → edit; tap selects (or feeds two-click). */
  routePress(downAt: PressSample, upAt: PressSample): void {
    const g = classifyPress(downAt, upAt);
    if (g.type === 'drag') {
      const target = hitTestTree(this.working(), this.positions(), this.registry(), downAt, this.editCtx());
      const result = applyGesture(this.working(), target, g, this.registry(), this.editCtx());
      if (result) this.commitEdit(result);
      return;
    }
    if (this.mode() === 'two-click') { this.routeClick({ x: g.x, y: g.y }); return; }
    const tapTarget = hitTestTree(this.working(), this.positions(), this.registry(), { x: g.x, y: g.y }, this.editCtx());
    this.selection.set(tapTarget.nodeId);
  }

  /** WCAG 2.5.7 drag alternative: first click anchors on a node, second commits the move. */
  routeClick(at: PressSample): void {
    const r = reduceAnchor(this.anchor, { kind: 'click', at });
    if (r.gesture) {
      const result = applyGesture(this.working(), { nodeId: this.anchorTarget }, r.gesture, this.registry(), this.editCtx());
      if (result) this.commitEdit(result);
      this.anchor = null; this.anchorTarget = null;
      return;
    }
    this.anchor = r.anchor;
    this.anchorTarget = r.anchor
      ? hitTestTree(this.working(), this.positions(), this.registry(), at, this.editCtx()).nodeId
      : null;
  }

  /** Keyboard parity: route a key to the selected node. */
  routeKey(sample: KeyboardSample): void {
    const result = applyKey(this.working(), { nodeId: this.selection() }, sample, this.registry(), this.editCtx());
    if (result) this.commitEdit(result);
  }

  private commitEdit(result: EditResult): void {
    this.snapshot.push(this.working());
    this.working.set(result.tree);
    this.refreshUndo();
    this.commit.emit(result);
  }
  private refreshUndo(): void {
    this.undoState.set({ canUndo: this.snapshot.canUndo, canRedo: this.snapshot.canRedo });
  }

  // ── DOM seam (thin: convert events to plain data, delegate to the façade) ──
  protected onPointerDown(ev: PointerEvent): void { this.down = this.toBoard(ev); }
  protected onPointerUp(ev: PointerEvent): void {
    const up = this.toBoard(ev);
    if (this.mode() === 'two-click') { this.routeClick(up); this.down = null; return; }
    if (this.down) this.routePress(this.down, up);
    this.down = null;
  }
  protected onKeyDown(ev: KeyboardEvent, id: string): void {
    this.selection.set(id);
    const before = this.working();
    this.routeKey({ key: ev.key });
    if (this.working() !== before) ev.preventDefault();
  }

  private toBoard(ev: { clientX: number; clientY: number }): PressSample {
    const el = this.svg().nativeElement;
    const ctm = el.getScreenCTM?.();
    if (ctm && typeof DOMPoint !== 'undefined') {
      const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    }
    const r = el.getBoundingClientRect();
    const sx = el.viewBox.baseVal.width ? el.viewBox.baseVal.width / r.width : 1;
    const sy = el.viewBox.baseVal.height ? el.viewBox.baseVal.height / r.height : 1;
    return { x: (ev.clientX - r.left) * sx, y: (ev.clientY - r.top) * sy };
  }

  private resetSession(): void {
    this.snapshot.reset();
    this.selection.set(null);
    this.anchor = null; this.anchorTarget = null;
    this.refreshUndo();
  }
```

> `SvgPrimitive`/`DrawContext` stay imported (template + `ctx`); `EditContext` is used by `editCtx`. Remove any import that lint flags as unused.

- [ ] **Step 4: Run to verify pass**

Run: `npx nx vite:test design-system-angular`
Expected: PASS (all S2 + S3 component tests).

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-angular/src/public/board-kit/board-kit.component.ts \
        libs/design-system-angular/src/public/board-kit/board-kit.component.spec.ts
git commit -m "feat(board-kit): <ds-board-kit> S3 edit wiring (pointer/keyboard/click-click + undo/redo/revert)"
```

---

## Part D — barrel, showcase, and the full gate

### Task D1: board-kit module barrel + lib re-export

**Files:**
- Create: `libs/design-system-angular/src/public/board-kit/index.ts`
- Modify: `libs/design-system-angular/src/index.ts`

- [ ] **Step 1: Write the board-kit module barrel**

```ts
// index.ts — Board Kit Angular brick public surface.
export { BoardKitComponent } from './board-kit.component.js';
export type { RenderItem } from './board-kit.engine.js';
export { buildRenderModel, hitTestTree, applyGesture, applyKey } from './board-kit.engine.js';
```

- [ ] **Step 2: Re-export from the lib index** — append to `libs/design-system-angular/src/index.ts`:

```ts
// ─── Board Kit (generic recursive presentation-tree renderer + editor) ───
export * from './public/board-kit/index.js';
```

- [ ] **Step 3: Build + typecheck the lib**

Run: `npx nx build design-system-core && bash scripts/setup-dev.sh && npx nx build design-system-angular && npx nx typecheck design-system-angular`
Expected: all succeed (core built + symlinked first so the Angular package build resolves the new core surface).

- [ ] **Step 4: Commit**

```bash
git add libs/design-system-angular/src/public/board-kit/index.ts \
        libs/design-system-angular/src/index.ts
git commit -m "feat(board-kit): export <ds-board-kit> + engine helpers from design-system-angular"
```

---

### Task D2: Showcase page — proves the SPATIAL modality (S3)

A free-layout board of draggable markers, authored entirely as a *consumer* registry (the brick never authors kinds). Demonstrates drag-move, keyboard-move, the click-click alternative, undo/redo, and an intent log.

**Files:**
- Create: `apps/showcase/src/app/pages/ds-board-kit.page.ts`
- Modify: `apps/showcase/src/app/nav.catalog.ts`

- [ ] **Step 1: Write the showcase page**

```ts
// ds-board-kit.page.ts — showcase for <ds-board-kit>: a free-layout marker board.
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { BoardKitComponent } from '@de-braighter/design-system-angular';
import { findNode, patchNodeProps } from '@de-braighter/design-system-core';
import type {
  BoardRegistry, EditResult, Frame, RenderDefinition, RenderNode,
} from '@de-braighter/design-system-core';

interface MarkerProps { x: number; y: number; label: string; }
const R = 16;
const STEP = 8;

const markerDef: RenderDefinition<MarkerProps> = {
  kind: 'demo.marker',
  draw: (n) => [
    { p: 'circle', cx: 0, cy: 0, r: R, fill: 'var(--accent, #22d39a)', stroke: 'var(--fg-1, #e8ecf7)', strokeWidth: 2 },
    { p: 'text', x: 0, y: 5, text: n.props.label, anchor: 'middle', fill: 'var(--bg-0, #050608)' },
  ],
  bounds: () => ({ x: -R, y: -R, w: 2 * R, h: 2 * R }),
  describe: (n) => ({ role: 'img', name: `Marker ${n.props.label}`, description: `at ${Math.round(n.props.x)}, ${Math.round(n.props.y)}` }),
  edit: {
    tools: [{ id: 'move', label: 'Move', gesture: 'drag', keyboard: true }],
    hitTest: (_n, at) => (Math.hypot(at.x, at.y) <= R ? { nodeId: _n.id } : null),
    onGesture: (g, t, tr) => {
      if (g.type !== 'drag' || t.nodeId == null) return null;
      const p = findNode(tr, t.nodeId)?.props as MarkerProps | undefined;
      if (!p) return null;
      const nx = p.x + (g.x2 - g.x1); const ny = p.y + (g.y2 - g.y1);
      return { tree: patchNodeProps<MarkerProps>(tr, t.nodeId, { x: nx, y: ny }), intent: { op: 'move', nodeId: t.nodeId, x: nx, y: ny } };
    },
    onKey: (k, t, tr) => {
      if (t.nodeId == null) return null;
      const d: Record<string, [number, number]> = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] };
      const delta = d[k.key];
      if (!delta) return null;
      const p = findNode(tr, t.nodeId)?.props as MarkerProps | undefined;
      if (!p) return null;
      const nx = p.x + delta[0]; const ny = p.y + delta[1];
      return { tree: patchNodeProps<MarkerProps>(tr, t.nodeId, { x: nx, y: ny }), intent: { op: 'move', nodeId: t.nodeId, x: nx, y: ny } };
    },
  },
};

@Component({
  selector: 'show-ds-board-kit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BoardKitComponent],
  styles: [`
    .wrap { padding: 1rem; color: var(--fg-1, #e8ecf7); }
    .stage { max-width: 480px; border: 1px solid var(--line-1, rgba(148,163,210,.18)); border-radius: 8px; background: var(--bg-1, #0a0d14); }
    .bar { display: flex; gap: .5rem; align-items: center; margin: .75rem 0; flex-wrap: wrap; }
    .bar button { min-height: 24px; min-width: 24px; padding: .25rem .6rem; border-radius: 6px; border: 1px solid var(--line-1, #2a2f40); background: var(--bg-2, #0f1320); color: inherit; cursor: pointer; }
    .bar button[disabled] { opacity: .4; cursor: default; }
    .bar button.active { border-color: var(--accent, #22d39a); }
    .log { font: 12px/1.5 monospace; opacity: .8; max-height: 8rem; overflow: auto; }
  `],
  template: `
    <div class="wrap">
      <h1>&lt;ds-board-kit&gt;</h1>
      <p>Generic recursive presentation-tree renderer + editor. This demo registers one
        <code>demo.marker</code> kind on a <code>free</code>-layout board: drag a marker, or focus it (Tab)
        and use arrow keys, or switch to two-click mode and click a marker then its destination.</p>

      <div class="bar">
        <button (click)="bk.undo()" [disabled]="!bk.canUndo">Undo</button>
        <button (click)="bk.redo()" [disabled]="!bk.canRedo">Redo</button>
        <button [class.active]="mode() === 'drag'" (click)="setMode('drag')">Drag</button>
        <button [class.active]="mode() === 'two-click'" (click)="setMode('two-click')">Two-click</button>
      </div>

      <div class="stage">
        <ds-board-kit #bk [tree]="tree" [registry]="registry" [frame]="frame" ariaLabel="Demo marker board" (commit)="onCommit($event)" />
      </div>

      <h3>Intent log</h3>
      <div class="log">
        @for (line of log(); track $index) { <div>{{ line }}</div> }
        @if (!log().length) { <div>— move a marker —</div> }
      </div>
    </div>
  `,
})
export class DsBoardKitPage {
  protected readonly frame: Frame = { id: 'demo', width: 320, height: 200, layout: { mode: 'free' } };
  protected readonly registry: BoardRegistry = new Map([['demo.marker', markerDef as RenderDefinition]]);
  protected readonly tree: RenderNode = {
    id: 'board', kind: 'demo.board', props: {}, children: [
      { id: 'm1', kind: 'demo.marker', props: { x: 70, y: 80, label: '1' }, children: [] },
      { id: 'm2', kind: 'demo.marker', props: { x: 180, y: 120, label: '2' }, children: [] },
      { id: 'm3', kind: 'demo.marker', props: { x: 250, y: 60, label: '3' }, children: [] },
    ],
  };
  protected readonly mode = signal<'drag' | 'two-click'>('drag');
  protected readonly log = signal<string[]>([]);

  protected setMode(m: 'drag' | 'two-click'): void {
    this.mode.set(m);
    // The template ref drives the component; mirror the mode into it.
    queueMicrotask(() => this.boardRef?.setMode(m));
  }
  private boardRef: BoardKitComponent | null = null;

  protected onCommit(e: EditResult): void {
    this.log.update((l) => [`${JSON.stringify(e.intent)}`, ...l].slice(0, 20));
  }
}
```

> The `demo.board` root kind is intentionally **not** registered — it exercises the per-node fallback isolation (Task B1) gracefully (a small placeholder at the origin) while the three markers render normally. If you prefer a clean root, register a trivial read-only `demo.board` kind (draw `[]`, bounds `{x:0,y:0,w:0,h:0}`, describe `{role:'group',name:'board'}`) — either is fine; the unregistered-root path is a live demonstration of §6.2.

> Wiring `setMode` through `queueMicrotask`/`boardRef` is a showcase convenience. Simpler + robust: bind the mode directly by giving the page a `@ViewChild(BoardKitComponent)` ref, or just call `bk.setMode(m)` inline in the template buttons: `(click)="bk.setMode('drag')"`. **Prefer the inline template-ref form** — replace the two mode buttons' handlers with `(click)="bk.setMode('drag')"` / `(click)="bk.setMode('two-click')"` and drop `boardRef`/`queueMicrotask` (the page's `mode` signal then only mirrors the active-button styling: set it in the same handler, `(click)="mode.set('drag'); bk.setMode('drag')"`). Implement the inline form to avoid the ref dance.

- [ ] **Step 2: Register the page in the nav catalog** — in `apps/showcase/src/app/nav.catalog.ts`, add an item to the `bricks` group's `items` array (keep alphabetical-ish with the existing `db-*` entries):

```ts
      { id: 'ds-board-kit', label: 'Board Kit', load: () => import('./pages/ds-board-kit.page').then((m) => m.DsBoardKitPage) },
```

- [ ] **Step 3: Build the showcase to confirm it compiles**

Run: `npx nx build showcase > /tmp/bk2-showcase.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. (If the component-style budget warns, trim the page `styles` — keep well under budget; the page CSS above is ~0.7kB.)

- [ ] **Step 4: Browser-verify the spatial modality** (manual, per the design's "showcase proves the SPATIAL modality")

Run: `npx nx serve showcase` (then open the printed URL, navigate to **Design System Bricks → Board Kit**). Confirm: (a) three markers render; (b) dragging a marker moves it and appends a `{"op":"move",…}` line to the intent log; (c) Tab focuses a marker (visible focus ring) and arrow keys nudge it; (d) Two-click mode: click a marker then a destination moves it; (e) Undo/Redo reverse/replay. Capture a screenshot to `docs/board-kit-showcase-spatial-proof.png` for the PR.

- [ ] **Step 5: Commit**

```bash
git add apps/showcase/src/app/pages/ds-board-kit.page.ts \
        apps/showcase/src/app/nav.catalog.ts \
        docs/board-kit-showcase-spatial-proof.png
git commit -m "feat(board-kit): showcase page proving the spatial modality (drag/keyboard/click-click/undo)"
```

---

### Task D3: Angular API report regen + full local gate + PR

**Files:**
- Modify: `libs/design-system-angular/etc/design-system-angular.api.md` (regenerated)

- [ ] **Step 1: Regenerate the Angular API report**

Run: `npx nx build design-system-angular && cd libs/design-system-angular && npx api-extractor run --local --verbose && cd -`
Expected: `etc/design-system-angular.api.md` gains `BoardKitComponent`, `RenderItem`, `buildRenderModel`, `hitTestTree`, `applyGesture`, `applyKey`. api-extractor exits 0.

- [ ] **Step 2: Run the full local gate** (capture the exit code — do NOT pipe to a masker)

Run (repo root): `npm run ci:local > /tmp/bk2-ci.log 2>&1; echo "EXIT=$?"`
Expected: `EXIT=0`. Then verify the relevant projects actually ran (not `passWithNoTests`):

Run: `grep -E "design-system-(core|angular)|board-kit|showcase" /tmp/bk2-ci.log | grep -iE "pass|fail|test|error" | head -40`
Expected: design-system-core + design-system-angular vite:test report passing suites including board-kit specs; no lint/typecheck/api-check errors. If `EXIT` is non-zero, open `/tmp/bk2-ci.log`, find the first failing gate, fix, re-run.

- [ ] **Step 3: Commit the API report**

```bash
git add libs/design-system-angular/etc/design-system-angular.api.md
git commit -m "feat(board-kit): regenerate design-system-angular API report"
```

- [ ] **Step 4: Open the PR** (verifier wave per the review floor — non-trivial change ⇒ full wave: `local-ci` + `reviewer` + `qa-engineer` + `charter-checker`, all `isolation: "worktree"`, in parallel; `charter-checker` confirms the two-trees discipline holds — geometry/positions never persist to the kernel and the brick authors no kernel concepts). PR body carries the workbench ritual lines:

```
Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert
Effect: findings 3±2 expert
```

PR title: `feat(board-kit): Angular <ds-board-kit> brick — render + edit engine (S2/S3) + showcase`. Body summarizes: the three-layer architecture (host/engine/registry), the pure-engine + thin-shell split, the deferred core should-fixes folded in (mapNode @internal, layoutTree micro-perf, renderDefinitionContract, SnapshotStack.reset), and the showcase proof. Link spec + ADR-239/240.

---

## Self-Review

**1. Spec coverage (Plan 2 = S2 + S3):**
- **S2 engine + draw** (spec §8): `BoardKitComponent` renders via registry `draw` → declarative `SvgPrimitive[]` in a managed `<svg>` (Task C1 template `@switch`), runs `runLayout` (positions computed), applies `describe()` per node (role + aria-label), owns roving-tabindex focus (`tabTargetId` + focus effect) and tool/canvas chrome (the SVG `role="application"`). Read-only path tested in C1. ✓
- **S3 edit wiring** (spec §8 / §5.2): pointer + keyboard → digest (`classifyPress`) → `hitTest` (`hitTestTree`) → `applyGesture`/`applyKey` → snapshot (`SnapshotStack`) + `commit`; click-click alternative (`reduceAnchor` via `routeClick`); `revertTo`; undo/redo. Showcase proves the **spatial modality** on a synthetic free-layout board (Task D2). ✓
- **Draw model** (§4.3): declarative primitives rendered by the engine — every `SvgPrimitive` variant has a `@case` (circle/line/rect/path/text). Component escape hatch is explicitly out of scope (§9) — not implemented. ✓
- **Layout** (§5.1): `runLayout` dispatches `free`/`tree`; the showcase uses `free` (the proven spatial path). `tree` layout is exercised by the consumer in Plan 3. ✓
- **A11y boundary** (§6.1): engine digests drag *and* click-click into one `Gesture` and routes both pointer + keyboard → WCAG 2.5.7 satisfied; `validateRegistry` dev gate throws on a drag-tool-without-keyboard (C1 test); 24px tool-chrome targets (showcase `.bar button` min 24px). ✓
- **Error handling** (§6.2): per-node render isolation (B1 fallback + test); returned-tree invariant rejection (B3 `validateTree` + test); rejected edit = clean no-op (`applyGesture` → `null`); persistence failure → `revertTo` (C2 test). ✓
- **Testing tiers** (§6.3): pure-core/engine unit tests (B1–B3), `renderDefinitionContract` harness (A2), component TestBed tests (C1/C2), consumer manual e2e via showcase (D2). Perf bench is a §6.4 gate deferred to the large-tree (twin) consumer — not Plan 2. ✓
- **Deferred should-fixes folded in** (user instruction): `mapNode` `@internal` (A3) + dropped from barrel (A4); `layoutTree` childXs micro-perf (A1); `renderDefinitionContract` harness (A2). Plus `SnapshotStack.reset()` (C1 Step 3b) needed by the component. ✓

**2. Placeholder scan:** No `TBD`/`TODO`/"add error handling"/"similar to Task N". Every code step shows complete code; every run step shows the command + expected result. The one late-bound value is the PR's `Effect:` numbers (self-declared at PR time per the ritual) — a real process value, not a logic placeholder.

**3. Type consistency:** `RenderItem` (defined B1) is used by the component `items` computed + barrel (D1). `buildRenderModel`/`hitTestTree`/`applyGesture`/`applyKey` signatures defined in B1–B3 are called with matching args in C1/C2 (`(tree, positions, registry, ctx)` / `(tree, target, gesture, registry, ctx)`). Core imports (`runLayout`, `classifyPress`, `reduceAnchor`, `validateRegistry`, `SnapshotStack`, `findNode`, `patchNodeProps`, `validateTree`) match the verified core surface; `mapNode` is *not* imported anywhere (consumers use the wrappers). `EditResult`/`EditIntent`/`EditTarget`/`Frame`/`DrawContext`/`EditContext`/`BoardRegistry`/`RenderNode`/`SvgPrimitive`/`PressSample`/`KeyboardSample`/`AnchorState` are all consumed exactly as the core exports them. `setMode`/`mode` values `'drag'|'two-click'` are consistent between component (C2) and showcase (D2). The `[frame]` (singular) input deliberately deviates from the spec §4.4 sketch's `[frames]` (multi-frame is out of scope §9) — documented in the component JSDoc. ✓

---

## Status

Plan 2 of 3 for the Board Kit arc. Produces the published-ready Angular `<ds-board-kit>` brick (render + edit engine, S2/S3) in `design-system-angular`, consuming the merged `design-system-core` Board Kit pure layer via the same-repo dist/symlink (no publish needed), plus a showcase that proves the spatial modality. **Founder decisions confirmed (2026-06-16):** brick name stays `board-kit`/`<ds-board-kit>`; Plan 3's consumer home is `domains/scenario-lab`; `reparent` persists as compose-remove+insert (no kernel verb). **Next plan (write after this lands + design-system-core is republished with a version bump):** Plan 3 (plan-tree authoring consumer — S4 read-only projection, S5 structural authoring, S6 node-property editing, in `domains/scenario-lab`).
