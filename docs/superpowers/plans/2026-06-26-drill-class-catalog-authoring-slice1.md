# Board-recipe authoring model — Slice 1 (general open + round-trip) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the studio catalog-designer a reusable, general board-authoring model whose atom is a rich `RecipeShape`, so it can open and byte-parity round-trip **any** published `EditorRecipe` (kf-drill the hardest fixture) — the in-memory round-trip + a read-only live "Open recipe" affordance. Per-construct GUI editors are later slices.

**Architecture:** Add a `ShapeDefinition` (mirrors the full published `RecipeShape` surface) to the `CatalogModel`'s `CatalogDefinition` union; `buildRecipeFromCatalog` gains a forward branch that emits a rich shape directly (no offset, no bounds fallback); a new pure `buildCatalogFromRecipe` is the general inverse (any recipe → rich `ShapeDefinition`s + a root group, near-identity, no abstraction reconstruction). A coverage-suite spec proves `buildRecipeFromCatalog(buildCatalogFromRecipe(r))` deep-equals `r` for kf-drill + a full-surface synthetic recipe + the plan-tree recipe. The catalog-designer gains an "Open recipe" control that loads kf-drill via the inverse into its model signals (mirroring the existing `openCatalog(id)` store-load path). The existing primitive/group compile-down authoring is untouched (additive ⇒ plan-tree parity stays green).

**Tech Stack:** TypeScript (strict, ESM), Angular 21 (standalone, signals, OnPush), Vitest, `@de-braighter/design-system-core@^2.8.0` (published board-kit types — `EditorRecipe`/`RecipeShape`/`PrimitiveTemplate`/`RecipeValue`/`RecipeAction`/`RecipeEdge`), `@de-braighter/board-recipes@^1.0.0` (the `kfDrillRecipe` fixture).

## Global Constraints

- **Scope:** `domains/studio/libs/board-editor` ONLY. Zero `design-system-core`/kernel/brick change. **No publish, no pnpm release dance.** ADR-176-safe (the studio composes the published brick; authors no kernel concept; stores nothing in the kernel).
- **Types are imported, never redefined:** `EditorRecipe`, `RecipeShape`, `PrimitiveTemplate`, `RecipeValue`, `RecipeAction`, `RecipeEdge` come from `@de-braighter/design-system-core`. Confirm each is exported there before use (they are re-exported from the board-kit barrel).
- **Additive + parity-neutral:** the existing `PrimitiveDefinition` / `SvgDefinition` / `Group` types and the primitive/svg/group branches of `buildRecipeFromCatalog` are **byte-unchanged**. `catalog-parity.spec.ts` and `catalog-document.spec.ts` MUST stay green.
- **Test runner:** Vitest. Run the lib suite with `npm test` (= `ng test --no-watch`) from `domains/studio/libs/board-editor`. To iterate fast on one suite, temporarily use `describe.only` / `it.only` and REMOVE before commit. Build check: `npm run build` (= `ng build`) from the lib dir.
- **Equality:** the round-trip gate uses Vitest `toEqual` (deep structural; treats `undefined`-valued keys as equal to absent keys — so conditional-spread emission round-trips both recipes that omit a field and recipes that set it).
- **Git hygiene:** the worker operates in an isolated worktree of `domains/studio`. Commit with explicit paths. Conventional-commit messages. End each commit body with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **PR:** create the tracking issue first (`Closes #<n>` required), branch, open the PR before the verifier wave; `Producer:` / `Effort: standard` / `Effect: cycle-time` + `findings` lines in the PR body.

---

### Task 1: `ShapeDefinition` type + `CatalogModel` recipe fields + forward branch

Add the rich-shape definition and emit it directly from the expander. This is the forward half — model → recipe.

**Files:**
- Modify: `domains/studio/libs/board-editor/src/lib/catalog.ts` (the `CatalogDefinition` union ~`:373`; `CatalogModel` ~`:412`; `buildRecipeFromCatalog` ~`:655`)
- Test: `domains/studio/libs/board-editor/src/lib/catalog-shape-forward.spec.ts` (new)

**Interfaces:**
- Produces:
  - `interface ShapeDefinition { readonly id: string; readonly name: string; readonly kind: 'shape'; readonly shapeKind: string; readonly geometry?: 'point'|'box'|'polyline'; readonly draw: ReadonlyArray<PrimitiveTemplate>; readonly bounds: { x: RecipeValue; y: RecipeValue; w: RecipeValue; h: RecipeValue }; readonly a11y: { role: string; name: RecipeValue; description?: RecipeValue }; readonly actions?: ReadonlyArray<RecipeAction>; readonly hit?: RecipeShape['hit']; readonly nudge?: number; readonly handleRadius?: number; readonly segTol?: number; readonly minWH?: number; }`
  - `type CatalogDefinition = PrimitiveDefinition | SvgDefinition | Group | ShapeDefinition`
  - `CatalogModel` gains `readonly recipeId?: string; readonly recipeName?: string; readonly recipeEdges?: ReadonlyArray<RecipeEdge>;`
  - `buildRecipeFromCatalog(catalog: CatalogModel): EditorRecipe` (unchanged signature) now emits a rich shape for a `'shape'`-kind root part and carries `recipeId`/`recipeName`/`recipeEdges`.

- [ ] **Step 1: Write the failing test**

Create `catalog-shape-forward.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildRecipeFromCatalog } from './catalog';
import type { CatalogModel } from './catalog';

describe('buildRecipeFromCatalog — ShapeDefinition (rich shape) branch', () => {
  it('emits a rich shape directly: RecipeValues untouched, no offset, owns its bounds', () => {
    const model: CatalogModel = {
      recipeId: 'demo',
      recipeName: 'Demo',
      rootGroupId: 'root',
      definitions: [
        {
          id: 'shape-0', name: 'Zone', kind: 'shape', shapeKind: 'demo.zone', geometry: 'box',
          draw: [{ p: 'rect', x: 0, y: 0, w: { bind: 'w' }, h: { calc: 'h - 2' }, fill: '#fff' }],
          bounds: { x: 0, y: 0, w: { calc: 'max(w,1)' }, h: { bind: 'h' } },
          a11y: { role: 'img', name: { i18n: 'demo.zone' } },
        },
        // The part offset (999,999) MUST be ignored by the rich-shape branch.
        { id: 'root', name: 'root', kind: 'group', parts: [{ defId: 'shape-0', x: 999, y: 999 }] },
      ],
    };
    expect(buildRecipeFromCatalog(model)).toEqual({
      id: 'demo',
      name: 'Demo',
      shapes: [{
        kind: 'demo.zone', geometry: 'box',
        draw: [{ p: 'rect', x: 0, y: 0, w: { bind: 'w' }, h: { calc: 'h - 2' }, fill: '#fff' }],
        bounds: { x: 0, y: 0, w: { calc: 'max(w,1)' }, h: { bind: 'h' } },
        a11y: { role: 'img', name: { i18n: 'demo.zone' } },
      }],
    });
  });

  it('falls back to catalog-preview id/name when recipeId/recipeName absent', () => {
    const model: CatalogModel = {
      rootGroupId: 'root',
      definitions: [{ id: 'root', name: 'root', kind: 'group', parts: [] }],
    };
    const out = buildRecipeFromCatalog(model);
    expect(out.id).toBe('catalog-preview');
    expect(out.name).toBe('Catalog preview');
  });

  it('emits both a plan-tree primitive part and a rich shape part in one catalog', () => {
    const model: CatalogModel = {
      rootGroupId: 'root',
      definitions: [
        { id: 'c', name: 'circle', kind: 'circle', params: { r: 20, fill: '#ff0' }, basePosition: { cx: 60, cy: 70 } },
        {
          id: 's', name: 'Mark', kind: 'shape', shapeKind: 'demo.mark',
          draw: [{ p: 'circle', cx: 0, cy: 0, r: 5 }],
          bounds: { x: -5, y: -5, w: 10, h: 10 },
          a11y: { role: 'img', name: 'mark' },
        },
        { id: 'root', name: 'root', kind: 'group',
          parts: [{ defId: 'c', x: 0, y: 0, kind: 'catalog.circle', bounds: { x: 40, y: 50, w: 40, h: 40 } },
                  { defId: 's', x: 0, y: 0 }] },
      ],
    };
    const out = buildRecipeFromCatalog(model);
    expect(out.shapes.map((s) => s.kind)).toEqual(['catalog.circle', 'demo.mark']);
    expect(out.shapes[1].draw).toEqual([{ p: 'circle', cx: 0, cy: 0, r: 5 }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test` (from `domains/studio/libs/board-editor`).
Expected: FAIL — TS error `Type '"shape"' is not assignable` (the union lacks `ShapeDefinition`) and/or the assertion fails (no shape branch).

- [ ] **Step 3: Add the imports + types to `catalog.ts`**

At the top import block (currently importing from `@de-braighter/design-system-core`), add `RecipeValue` and `RecipeEdge` if not already imported (the file already imports `EditorRecipe`, `PrimitiveTemplate`, `RecipeAction`, `RecipeEdge`, `RecipeShape`). Ensure `RecipeValue` is added:

```ts
import type {
  EdgeAttachment, EdgeSide, EditorRecipe, PrimitiveTemplate,
  RecipeAction, RecipeEdge, RecipeShape, RecipeValue,
} from '@de-braighter/design-system-core';
```

After the `Group` interface and before `// ── CatalogDefinition ──`, add:

```ts
// ── ShapeDefinition — the GENERAL authoring atom (mirrors the published RecipeShape) ──
//
// A rich shape authored DIRECTLY: its draw primitives carry RecipeValues (calc/bind/tpl/
// when/i18n), it carries a geometry archetype + rich a11y + actions + hit/tuning. This is
// the general form — every board recipe is "just shapes" — so a model whose atom is a full
// RecipeShape expresses the whole recipe surface and round-trips ANY EditorRecipe. The
// existing primitive/group placement is preserved as compile-down sugar that lowers into the
// SAME shape output. Rich shapes are authored in LOCAL space (no offset composition), so the
// expander emits them verbatim — never offset-summing a RecipeValue.
export interface ShapeDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: 'shape';
  /** The emitted RecipeShape.kind (the registry key), e.g. 'kf.zone'. */
  readonly shapeKind: string;
  readonly geometry?: 'point' | 'box' | 'polyline';
  readonly draw: ReadonlyArray<PrimitiveTemplate>;
  readonly bounds: { readonly x: RecipeValue; readonly y: RecipeValue; readonly w: RecipeValue; readonly h: RecipeValue };
  readonly a11y: { readonly role: string; readonly name: RecipeValue; readonly description?: RecipeValue };
  readonly actions?: ReadonlyArray<RecipeAction>;
  readonly hit?: RecipeShape['hit'];
  readonly nudge?: number;
  readonly handleRadius?: number;
  readonly segTol?: number;
  readonly minWH?: number;
}
```

Update the `CatalogDefinition` union (~`:373`):

```ts
export type CatalogDefinition = PrimitiveDefinition | SvgDefinition | Group | ShapeDefinition;
```

Add the recipe-level fields to `CatalogModel` (~`:412`, after `connectors?`):

```ts
  /** The emitted recipe id/name (absent ⇒ the legacy 'catalog-preview' literals). Carried so a
   *  loaded recipe round-trips its identity (a rich shape model spans any recipe). */
  readonly recipeId?: string;
  readonly recipeName?: string;
  /** Passthrough of an imported recipe's `edges` (ADR-276 connectors). Slice 1 carries them
   *  verbatim for round-trip fidelity; reconciling with the connector model is a later slice. */
  readonly recipeEdges?: ReadonlyArray<RecipeEdge>;
```

- [ ] **Step 4: Add the forward branch + recipe-level emission to `buildRecipeFromCatalog`**

Inside the `for (const part of rootGroup.parts)` loop, BEFORE the existing `if (def.kind === 'group')`, add the shape branch (it owns its bounds, so it does NOT use `shapeBounds`/`partKind`):

```ts
    if (def.kind === 'shape') {
      shapes.push({
        kind: def.shapeKind,
        ...(def.geometry !== undefined ? { geometry: def.geometry } : {}),
        draw: [...def.draw],
        bounds: def.bounds,
        a11y: def.a11y,
        ...(def.actions !== undefined ? { actions: [...def.actions] } : {}),
        ...(def.hit !== undefined ? { hit: def.hit } : {}),
        ...(def.nudge !== undefined ? { nudge: def.nudge } : {}),
        ...(def.handleRadius !== undefined ? { handleRadius: def.handleRadius } : {}),
        ...(def.segTol !== undefined ? { segTol: def.segTol } : {}),
        ...(def.minWH !== undefined ? { minWH: def.minWH } : {}),
      });
      continue;
    }
```

(The `continue` skips the primitive/svg/group branches for this part. Confirm the loop body has no trailing code after the branches that the `continue` would wrongly skip — currently it does not.)

Update BOTH return statements to carry the recipe-level fields. The `empty` constant (~`:662`):

```ts
  const empty: EditorRecipe = {
    id: catalog.recipeId ?? 'catalog-preview',
    name: catalog.recipeName ?? 'Catalog preview',
    shapes: [],
  };
```

The final `return` (~`:760`):

```ts
  return {
    id: catalog.recipeId ?? 'catalog-preview',
    name: catalog.recipeName ?? 'Catalog preview',
    shapes,
    ...(catalog.recipeEdges !== undefined && catalog.recipeEdges.length > 0
      ? { edges: [...catalog.recipeEdges] }
      : {}),
  };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (the 3 new `catalog-shape-forward` tests + all existing specs, incl. `catalog-parity.spec.ts` / `catalog-document.spec.ts` unchanged-green).

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: `ng build` succeeds (no TS errors from the union/`CatalogModel` changes).

- [ ] **Step 7: Commit**

```bash
git add src/lib/catalog.ts src/lib/catalog-shape-forward.spec.ts
git commit -m "feat(board-editor): ShapeDefinition rich-shape forward branch + recipe id/name/edges

The general authoring atom — a RecipeShape-shaped definition emitted directly by
buildRecipeFromCatalog (RecipeValues verbatim, no offset, owns its bounds). Additive;
plan-tree compile-down paths byte-unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: `buildCatalogFromRecipe` — the general reverse-mapper

The inverse: any `EditorRecipe` → a `CatalogModel` of rich `ShapeDefinition`s + a root group. Near-identity; no abstraction reconstruction.

**Files:**
- Create: `domains/studio/libs/board-editor/src/lib/catalog-from-recipe.ts`
- Test: `domains/studio/libs/board-editor/src/lib/catalog-from-recipe.spec.ts`

**Interfaces:**
- Consumes: `ShapeDefinition`, `CatalogModel` (Task 1, from `./catalog`); `EditorRecipe`, `RecipeShape` (core).
- Produces: `buildCatalogFromRecipe(recipe: EditorRecipe): CatalogModel`.

- [ ] **Step 1: Write the failing test**

Create `catalog-from-recipe.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { EditorRecipe } from '@de-braighter/design-system-core';
import { buildCatalogFromRecipe } from './catalog-from-recipe';

describe('buildCatalogFromRecipe — general reverse-mapper', () => {
  it('maps each recipe shape to a ShapeDefinition + a root part, carrying id/name', () => {
    const recipe: EditorRecipe = {
      id: 'r1', name: 'R1',
      shapes: [
        { kind: 'a', geometry: 'point', draw: [{ p: 'circle', cx: 0, cy: 0, r: 15 }],
          bounds: { x: -15, y: -15, w: 30, h: 30 }, a11y: { role: 'img', name: { i18n: 'a' } } },
        { kind: 'b', draw: [{ p: 'rect', x: 0, y: 0, w: { bind: 'w' }, h: { calc: 'h' } }],
          bounds: { x: 0, y: 0, w: { bind: 'w' }, h: { bind: 'h' } }, a11y: { role: 'img', name: 'b' } },
      ],
    };
    const cat = buildCatalogFromRecipe(recipe);
    expect(cat.recipeId).toBe('r1');
    expect(cat.recipeName).toBe('R1');
    const shapeDefs = cat.definitions.filter((d) => d.kind === 'shape');
    expect(shapeDefs).toHaveLength(2);
    expect(shapeDefs.map((d) => (d as { shapeKind: string }).shapeKind)).toEqual(['a', 'b']);
    const root = cat.definitions.find((d) => d.id === cat.rootGroupId);
    expect(root?.kind).toBe('group');
    expect((root as { parts: ReadonlyArray<{ defId: string; x: number; y: number }> }).parts)
      .toEqual(shapeDefs.map((d) => ({ defId: d.id, x: 0, y: 0 })));
  });

  it('carries `actions` only when present (never empty-vs-absent drift)', () => {
    const recipe: EditorRecipe = {
      id: 'r', name: 'r',
      shapes: [
        { kind: 'noact', draw: [{ p: 'rect', x: 0, y: 0, w: 1, h: 1 }],
          bounds: { x: 0, y: 0, w: 1, h: 1 }, a11y: { role: 'img', name: 'x' } },
        { kind: 'act', draw: [{ p: 'rect', x: 0, y: 0, w: 1, h: 1 }],
          bounds: { x: 0, y: 0, w: 1, h: 1 }, a11y: { role: 'img', name: 'y' },
          actions: [{ op: 'remove', on: { key: ['Delete'] } }] },
      ],
    };
    const defs = buildCatalogFromRecipe(recipe).definitions.filter((d) => d.kind === 'shape') as Array<{ actions?: unknown }>;
    expect('actions' in defs[0]).toBe(false);
    expect(defs[1].actions).toEqual([{ op: 'remove', on: { key: ['Delete'] } }]);
  });

  it('carries recipe.edges through to recipeEdges', () => {
    const recipe: EditorRecipe = {
      id: 'r', name: 'r', shapes: [],
      edges: [{ id: 'e', kind: 'line', source: { nodeId: 'n0', attach: { on: 'pixel', dx: 0, dy: 0 } },
               target: { nodeId: 'n1', attach: { on: 'side', side: 'left', t: 0.5 } } }],
    };
    expect(buildCatalogFromRecipe(recipe).recipeEdges).toEqual(recipe.edges);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module './catalog-from-recipe'`.

- [ ] **Step 3: Write the implementation**

Create `catalog-from-recipe.ts`:

```ts
// catalog-from-recipe.ts — the GENERAL reverse-mapper: EditorRecipe → CatalogModel.
//
// Each recipe shape becomes one rich `ShapeDefinition` (the general authoring atom) placed by a
// root-group part at the origin. Near-identity, no abstraction reconstruction — it never tries to
// recover reusable parts/groups/offsets from a flat shape (that universality across plan-tree /
// drill / future recipes IS the reusable capability). The catalog-internal ids (def id, group id)
// do NOT appear in the emitted recipe (the forward path keys on `shapeKind`), so simple
// deterministic ids keep the round-trip stable. Pure: same recipe → same catalog.
import type { EditorRecipe, RecipeShape } from '@de-braighter/design-system-core';
import type { CatalogModel, ShapeDefinition, Group, GroupPart } from './catalog';

function toShapeDefinition(shape: RecipeShape, index: number): ShapeDefinition {
  return {
    id: `shape-${index}`,
    name: shape.kind,
    kind: 'shape',
    shapeKind: shape.kind,
    ...(shape.geometry !== undefined ? { geometry: shape.geometry } : {}),
    draw: shape.draw,
    bounds: shape.bounds,
    a11y: shape.a11y,
    ...(shape.actions !== undefined ? { actions: shape.actions } : {}),
    ...(shape.hit !== undefined ? { hit: shape.hit } : {}),
    ...(shape.nudge !== undefined ? { nudge: shape.nudge } : {}),
    ...(shape.handleRadius !== undefined ? { handleRadius: shape.handleRadius } : {}),
    ...(shape.segTol !== undefined ? { segTol: shape.segTol } : {}),
    ...(shape.minWH !== undefined ? { minWH: shape.minWH } : {}),
  };
}

export function buildCatalogFromRecipe(recipe: EditorRecipe): CatalogModel {
  const shapeDefs = recipe.shapes.map((s, i) => toShapeDefinition(s, i));
  const parts: GroupPart[] = shapeDefs.map((d) => ({ defId: d.id, x: 0, y: 0 }));
  const rootGroup: Group = { id: 'root', name: 'Recipe', kind: 'group', parts };
  return {
    definitions: [...shapeDefs, rootGroup],
    rootGroupId: 'root',
    recipeId: recipe.id,
    recipeName: recipe.name,
    ...(recipe.edges !== undefined ? { recipeEdges: recipe.edges } : {}),
  };
}
```

(Note: `GroupPart`/`Group`/`ShapeDefinition` must be exported from `catalog.ts` — `Group` and `GroupPart` already are; confirm and export if needed.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (the 3 new reverse-mapper tests + all prior).

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-from-recipe.ts src/lib/catalog-from-recipe.spec.ts
git commit -m "feat(board-editor): buildCatalogFromRecipe — general recipe→catalog reverse-mapper

Any EditorRecipe → a CatalogModel of rich ShapeDefinitions + a root group. Near-identity,
no abstraction reconstruction; carries recipe id/name/edges. The basis for opening any recipe.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The coverage-suite round-trip gate (the headline)

Prove `buildRecipeFromCatalog(buildCatalogFromRecipe(r))` deep-equals `r` for kf-drill + a full-surface synthetic recipe + the plan-tree recipe. This is the load-bearing gate AND the generality proof.

**Files:**
- Create: `domains/studio/libs/board-editor/src/lib/recipe-fixtures.ts` (the synthetic fixtures)
- Test: `domains/studio/libs/board-editor/src/lib/recipe-roundtrip.spec.ts`

**Interfaces:**
- Consumes: `buildRecipeFromCatalog` (`./catalog`), `buildCatalogFromRecipe` (`./catalog-from-recipe`), `kfDrillRecipe` (`@de-braighter/board-recipes`).
- Produces: `FULL_SURFACE_RECIPE`, `PLAN_TREE_RECIPE` (exported `EditorRecipe` consts in `recipe-fixtures.ts`).

- [ ] **Step 1: Write the fixtures**

Create `recipe-fixtures.ts`:

```ts
// recipe-fixtures.ts — recipes for the round-trip coverage suite.
import type { EditorRecipe } from '@de-braighter/design-system-core';

// Exercises every construct kf-drill omits: {tpl}, a11y description, all six RecipeAction ops,
// hit + nudge/handleRadius/segTol/minWH, a primitive `when`, {when/then/else}, and edges (both
// side + pixel attach). Makes the capability demonstrably GENERAL, not kf-drill-shaped.
export const FULL_SURFACE_RECIPE: EditorRecipe = {
  id: 'full-surface',
  name: 'Full surface',
  shapes: [
    {
      kind: 'fs.box',
      geometry: 'box',
      draw: [
        { p: 'rect', x: 0, y: 0, w: { bind: 'w' }, h: { calc: 'h - 1' },
          fill: { tpl: '{color}' }, stroke: '#000', rx: 4, when: { bind: '__selected' } },
        { p: 'text', x: 0, y: 0, text: { i18n: 'fs.label' }, anchor: 'middle' },
      ],
      bounds: { x: 0, y: 0, w: { calc: 'max(w,1)' }, h: { bind: 'h' } },
      a11y: {
        role: 'img',
        name: { when: 'n', then: { i18n: 'fs.named' }, else: 'unnamed' },
        description: { i18n: 'fs.desc' },
      },
      actions: [
        { op: 'add-child', on: { key: ['a'] }, childKind: 'fs.box' },
        { op: 'remove', on: { key: ['Delete'] } },
        { op: 'reparent', on: { gesture: 'drag' } },
        { op: 'move', on: { gesture: 'drag' } },
        { op: 'resize', handles: 'corners', minW: 10, minH: 10 },
        { op: 'reshape', ends: ['head', 'tail'] },
      ],
      hit: { handles: 'corners', handleRadius: 8, body: 'rect', segmentTolerance: 6 },
      nudge: 2, handleRadius: 9, segTol: 11, minWH: 3,
    },
    {
      kind: 'fs.poly',
      geometry: 'polyline',
      draw: [{ p: 'line', x1: { bind: 'points.0.0' }, y1: { bind: 'points.0.1' },
               x2: { bind: 'points.1.0' }, y2: { bind: 'points.1.1' } }],
      bounds: { x: 0, y: 0, w: 1, h: 1 },
      a11y: { role: 'img', name: 'poly' },
    },
  ],
  edges: [
    { id: 'e1', kind: 'arrow',
      source: { nodeId: 'n0', attach: { on: 'side', side: 'right', t: 0.5 } },
      target: { nodeId: 'n1', attach: { on: 'pixel', dx: 4, dy: 6 } },
      stroke: '#fff', strokeWidth: 2, dash: '4 4' },
  ],
};

// The plan-tree recipe — the ground-truth flat recipe `buildRecipeFromCatalog` emits for the
// plan-tree fixture (mirrors `catalog-parity.spec.ts`'s `expectedRecipe`). Proves the general
// model round-trips the EXISTING class too. `actions: undefined` is intentional (toEqual treats
// it as absent, which is what the rich-shape branch emits).
export const PLAN_TREE_RECIPE: EditorRecipe = {
  id: 'catalog-preview',
  name: 'Catalog preview',
  shapes: [
    { kind: 'catalog.circle', draw: [{ p: 'circle', cx: 60, cy: 70, r: 20, fill: '#ff0' }],
      bounds: { x: 40, y: 50, w: 40, h: 40 }, a11y: { role: 'img', name: 'circle' } },
    { kind: 'catalog.rect', draw: [{ p: 'rect', x: 15, y: 25, w: 80, h: 40, fill: '#0f0', stroke: '#000' }],
      bounds: { x: 15, y: 25, w: 80, h: 40 }, a11y: { role: 'img', name: 'rect' } },
    { kind: 'catalog.line', draw: [{ p: 'line', x1: 15, y1: 25, x2: 115, y2: 75, stroke: '#f00' }],
      bounds: { x: 15, y: 25, w: 100, h: 50 }, a11y: { role: 'img', name: 'line' } },
    { kind: 'catalog.text', draw: [{ p: 'text', x: 15, y: 25, text: 'Hello', fill: '#fff', anchor: 'start' }],
      bounds: { x: 15, y: 25, w: 60, h: 20 }, a11y: { role: 'img', name: 'text' } },
    { kind: 'catalog.path', draw: [{ p: 'path', d: 'M 0 0 L 50 50', fill: 'none', stroke: '#00f' }],
      bounds: { x: 5, y: 10, w: 50, h: 50 }, a11y: { role: 'img', name: 'path' } },
  ],
};
```

- [ ] **Step 2: Write the failing gate test**

Create `recipe-roundtrip.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { EditorRecipe } from '@de-braighter/design-system-core';
import { kfDrillRecipe } from '@de-braighter/board-recipes';
import { buildRecipeFromCatalog } from './catalog';
import { buildCatalogFromRecipe } from './catalog-from-recipe';
import { FULL_SURFACE_RECIPE, PLAN_TREE_RECIPE } from './recipe-fixtures';

describe('recipe round-trip — coverage suite (generality gate)', () => {
  const cases: ReadonlyArray<readonly [string, EditorRecipe]> = [
    ['kf-drill', kfDrillRecipe as EditorRecipe],
    ['full-surface', FULL_SURFACE_RECIPE],
    ['plan-tree', PLAN_TREE_RECIPE],
  ];
  for (const [label, recipe] of cases) {
    it(`round-trips ${label} byte-identical`, () => {
      expect(buildRecipeFromCatalog(buildCatalogFromRecipe(recipe))).toEqual(recipe);
    });
  }
});
```

- [ ] **Step 3: Run the gate to verify it fails first, then passes**

Run: `npm test`
Expected: with Tasks 1+2 already merged, this should PASS immediately. If any case FAILS, the failing diff names the exact construct that didn't survive (e.g. an omitted `hit` field or an `edges` drop) — fix the forward/reverse passthrough for that field in Task 1/Task 2 code (do NOT weaken the fixture; the fixture is the coverage target). Re-run until all 3 cases PASS.

- [ ] **Step 4: Build check**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/recipe-fixtures.ts src/lib/recipe-roundtrip.spec.ts
git commit -m "test(board-editor): recipe round-trip coverage suite — kf-drill + full-surface + plan-tree

The generality gate: buildRecipeFromCatalog(buildCatalogFromRecipe(r)) deep-equals r for the
hard real fixture, a synthetic full-surface recipe (every construct kf-drill omits), and the
plan-tree recipe. Proves the model covers the whole recipe surface, reusably.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The "Open recipe" affordance (read-only live open)

A control that loads `kfDrillRecipe` into the catalog-designer's model so the existing preview pipeline renders it. Mirrors the existing `openCatalog(id)` store-load seam.

**Files:**
- Modify: `domains/studio/libs/board-editor/src/lib/catalog-designer.component.ts` (add `openRecipe(...)`; add a menu button; ~`:1307` is the pattern to mirror)
- Test: `domains/studio/libs/board-editor/src/lib/catalog-designer.component.spec.ts` (add a case)

**Interfaces:**
- Consumes: `buildCatalogFromRecipe` (`./catalog-from-recipe`), `kfDrillRecipe` (`@de-braighter/board-recipes`), the component's existing signals `definitions` / `rootGroupId` / `connectors` / `lib` / `previewTree` and `catalog` computed.
- Produces: `openRecipe(recipe: EditorRecipe): void` on `CatalogDesignerComponent`.

- [ ] **Step 1: Read the pattern**

Read `catalog-designer.component.ts:1307` (`openCatalog`) — it sets `definitions`, `rootGroupId`, `connectors`, `lib`, then `previewTree.set(buildPreviewTree(this.catalog()))`. Mirror exactly, sourcing the model from `buildCatalogFromRecipe(recipe)` instead of the store.

- [ ] **Step 2: Write the failing test**

Add to `catalog-designer.component.spec.ts` (follow the file's existing fixture/setup pattern — `TestBed`, `createComponent`, `fixture.detectChanges()`):

```ts
import { kfDrillRecipe } from '@de-braighter/board-recipes';
// ...inside the existing describe with a configured `component`:
it('openRecipe loads a recipe into the model (kf-drill → 8 shape kinds, pipeline renders)', () => {
  component.openRecipe(kfDrillRecipe);
  fixture.detectChanges();
  const recipe = component.recipe();           // the existing computed: buildRecipeFromCatalog(catalog())
  expect(recipe.shapes.map((s) => s.kind)).toEqual([
    'kf.pitch', 'kf.zone', 'kf.point.player', 'kf.point.opp',
    'kf.point.cone', 'kf.point.ball', 'kf.arrow.pass', 'kf.arrow.run',
  ]);
  // The preview pipeline runs without throwing (interpretRecipe succeeded → a registry exists).
  expect(component.registry()).toBeDefined();
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `component.openRecipe is not a function`.

- [ ] **Step 4: Implement `openRecipe` + the menu button**

Add the import near the top of the component:

```ts
import { buildCatalogFromRecipe } from './catalog-from-recipe';
import { kfDrillRecipe } from '@de-braighter/board-recipes';
```

Add the method (mirroring `openCatalog`, but no store/persistence — read-only open):

```ts
  /** Open a published board-kit recipe into the editor model (read-only authoring view): the
   *  general reverse-mapper lowers it to a CatalogModel of rich shapes; the existing preview
   *  pipeline (`recipe` → `registry` → <ds-board-kit>) renders it. Per-construct editors are
   *  later slices; this proves any recipe LOADS and the pipeline runs. */
  openRecipe(recipe: EditorRecipe): void {
    const model = buildCatalogFromRecipe(recipe);
    this.definitions.set([...model.definitions]);
    this.rootGroupId.set(model.rootGroupId);
    this.connectors.set([...(model.connectors ?? [])]);
    this.lib.set({ sel: 'group', id: model.rootGroupId });
    this.previewTree.set(buildPreviewTree(this.catalog()));
  }
```

Add a button in the catalog menu template (near the existing catalog-menu controls, ~`:574`–`:603`). Place it inside the open menu panel:

```html
<button type="button" class="cd-menu-item"
        (click)="openRecipe(kfDrillRecipe); catalogMenuOpen.set(false)">
  Open recipe: Kids drill board
</button>
```

Expose `kfDrillRecipe` to the template by adding a class field:

```ts
  protected readonly kfDrillRecipe = kfDrillRecipe;
```

(and reference it as `kfDrillRecipe` in the template since component members are template-visible).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (the new component test + all prior, incl. parity specs).

- [ ] **Step 6: Build check**

Run: `npm run build`
Expected: `ng build` succeeds (template references resolve).

- [ ] **Step 7: Browser-verify (manual)**

Serve the standalone board-editor app and confirm the read-only open works:
```bash
# from domains/studio
npm run -w apps/board-editor-ui start   # or the repo's documented serve command for apps/board-editor-ui
```
- Open the catalog menu → click **"Open recipe: Kids drill board"**.
- Confirm: the navigator lists the 8 `kf.*` shapes; the preview panel renders without a blank/error state; **0 console errors**. (Shapes render at default sample-instance props — a meaningful sample-instance drill render is a later slice; slice 1 proves load + pipeline + no errors.)
- Capture a proof screenshot to `domains/studio/docs/board-editor-open-recipe-kf-drill-proof.png`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/catalog-designer.component.ts src/lib/catalog-designer.component.spec.ts
git commit -m "feat(board-editor): Open recipe affordance — load any published recipe (kf-drill) read-only

Mirrors the store openCatalog seam: buildCatalogFromRecipe lowers a recipe into the model
signals so the existing preview pipeline renders it. Read-only; per-construct editors are
later slices.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (before PR / wave)

- [ ] `npm test` (lib) — all green, including the coverage suite (3/3) and the untouched `catalog-parity.spec.ts` / `catalog-document.spec.ts`.
- [ ] `npm run build` (lib) — green.
- [ ] Browser proof captured (Task 4 Step 7).
- [ ] Open the PR (`Closes #<issue>`), body carries `Producer:` / `Effort: standard` / `Effect: cycle-time` + `findings`.
- [ ] Verifier wave (`local-ci` + `reviewer` + `qa-engineer` + `charter-checker`) with `isolation: "worktree"`. (No `exercir-charter-checker` — studio, not exercir.)
- [ ] On merge: twin ritual `npm run ritual:post-merge -- de-braighter/studio#<pr>`.
- [ ] Ratify the ADR (separate `layers/specs` PR — authored alongside this plan; see the design spec §8).

## Notes for the implementer

- **Do not weaken the fixtures to make the gate pass.** If a round-trip case fails, the missing construct is a real forward/reverse gap — fix the passthrough in Task 1/Task 2.
- **`toEqual` undefined-leniency** is why conditional-spread emission round-trips both kf-drill (omits `actions`/`geometry`/tuning) and the full-surface recipe (sets them). Keep emission conditional (never emit `actions: undefined`).
- **The plan-tree compile-down authoring is untouched.** `buildCatalogFromRecipe` produces rich shapes, so `PLAN_TREE_RECIPE` round-trips via the rich-shape path — that is the generality proof, NOT a change to how the catalog-designer authors plan-tree boards.
- **`Group`/`GroupPart`/`ShapeDefinition` exports:** ensure all three are `export`ed from `catalog.ts` (Task 2 imports them).
