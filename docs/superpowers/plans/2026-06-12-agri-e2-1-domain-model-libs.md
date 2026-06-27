# Agri E2.1 — Domain-Model Libs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the agri-ecosystem-twin wedge domain model — 3 indicators (soil moisture, pest pressure [inverse], yield), the plot/field/farm subject types, the cover-crop A/B intervention catalog with typed effect declarations, and the season → intervention-sequence plan-tree builder — as two substrate-free TypeScript libs (`spine` = generic reusable shapes, `pack` = agri instances + builders).

**Architecture:** Two libs under `libs/`. The **spine** (`@de-braighter/agri-ecosystem-twin-spine`) holds domain-knowledge-free, reusable value-object shapes + pure helpers: indicator-with-direction, a typed effect-declaration, a generic single-parent subject hierarchy, and a generic single-parent plan tree. The **pack** (`@de-braighter/agri-ecosystem-twin-pack`) consumes the spine and supplies the concrete agri instances: the 3 indicators, the farm/field/plot levels, the cover-crop A/B catalog with effect declarations, and `buildSeasonPlan`. **Zero substrate import** — the kernel mapping happens in E2.2 (the api). The libs are pure, synchronous, fully unit-testable.

**Tech Stack:** TypeScript 5 (NodeNext ESM — relative imports carry `.js`), vitest 4 (`defineBaseConfig` from `@de-braighter/test-kit`), eslint (`@de-braighter/lint-kit` sonarjs-recommended preset — watch `no-duplicate-string` S1192). Build order: **spine builds before pack** (pack resolves `@de-braighter/agri-ecosystem-twin-spine` via the `node_modules` symlink → `dist`).

---

## Conventions (apply to every file)

- **ESM `.js` extensions on relative imports** (NodeNext). Cross-package imports use the package name (`@de-braighter/agri-ecosystem-twin-spine`).
- `readonly` on all interface fields and `ReadonlyArray<…>` for collections — these are immutable domain value objects.
- `noUncheckedIndexedAccess` is on: indexing a record/array yields `T | undefined`. Guard or assert.
- Tests live beside source as `*.spec.ts`; they are excluded from the build (`tsconfig` excludes `**/*.spec.ts`) and from coverage.
- Keep functions small (sonarjs cognitive-complexity is on). Prefer data-driven lookups over `switch`.
- After writing each file's code + tests, run the lib's `test` and, before committing the lib, run `pnpm run lint` at repo root for that file. **If `sonarjs/no-duplicate-string` fires, extract the repeated literal to a single `const` (typed) and reference it.**

---

## File Structure

**Spine** (`libs/agri-ecosystem-twin-spine/src/`):
- `indicator.ts` — `IndicatorDirection`, `IndicatorDef<Id>`, `isInverse`, `orientToBenefit`.
- `effect-declaration.ts` — `EffectSign`, `EffectBasis`, `EffectDeclaration<Id>`, `effect()` factory, `signedDelta`, `isBeneficial`.
- `subject-hierarchy.ts` — `SubjectNode<Kind>`, `SubjectTreeNode<Kind>`, `buildSubjectForest`, `pathToRoot`.
- `plan-tree.ts` — `PlanNode<Payload>`, `PlanTreeNode<Payload>`, `buildPlanTree`, `flattenPlanTree`, `planLeaves`.
- `index.ts` — barrel (replaces the `SPINE_READY` placeholder).

**Pack** (`libs/agri-ecosystem-twin-pack/src/`):
- `constants.ts` — `PACK_ID` (unchanged).
- `indicators.ts` — `AgriIndicatorId`, `SOIL_MOISTURE`, `PEST_PRESSURE`, `YIELD`, `AGRI_INDICATORS`, `AGRI_INDICATOR_IDS`.
- `subjects.ts` — `SubjectLevel`, `SUBJECT_LEVELS`, `Farm`, `Field`, `Plot`, `AgriSubject`, `parentLevelOf`.
- `interventions.ts` — `CoverCropMixId`, `CounterfactualArm`, `CoverCropMix`, `COVER_VETCH`, `COVER_PHACELIA`, `COVER_CROP_CATALOG`, `COVER_CROP_ARMS`, `effectOn`.
- `plan-builder.ts` — `PlanNodePayload`, `SeasonPlanInput`, `buildSeasonPlan`, `buildArmPlans`.
- `index.ts` — barrel (`PACK_ID` + the four modules).

---

## TASK 1 — Spine: indicator-with-direction

**Files:**
- Create test: `libs/agri-ecosystem-twin-spine/src/indicator.spec.ts`
- Create: `libs/agri-ecosystem-twin-spine/src/indicator.ts`

- [ ] **Step 1: Write the failing test**

```ts
// indicator.spec.ts
import { describe, it, expect } from 'vitest';
import { isInverse, orientToBenefit, type IndicatorDef } from './indicator.js';

const higher: IndicatorDef = { id: 'm', label: 'Moisture', unit: '% vwc', short: 'M', direction: 'higher-is-better' };
const lower: IndicatorDef = { id: 'p', label: 'Pest', unit: 'index', short: 'P', direction: 'lower-is-better' };

describe('indicator', () => {
  it('isInverse is true only for lower-is-better', () => {
    expect(isInverse(lower)).toBe(true);
    expect(isInverse(higher)).toBe(false);
  });
  it('orientToBenefit keeps sign for higher-is-better', () => {
    expect(orientToBenefit(higher, 2.4)).toBe(2.4);
    expect(orientToBenefit(higher, -1)).toBe(-1);
  });
  it('orientToBenefit flips sign for lower-is-better', () => {
    expect(orientToBenefit(lower, 0.06)).toBe(-0.06);
    expect(orientToBenefit(lower, -0.5)).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `pnpm --filter @de-braighter/agri-ecosystem-twin-spine run test` → FAIL (module not found).

- [ ] **Step 3: Write the implementation**

```ts
// indicator.ts
/** Whether a higher raw value of an indicator is the better outcome. */
export type IndicatorDirection = 'higher-is-better' | 'lower-is-better';

/** A measurable indicator with a known benefit direction. Domain-agnostic. */
export interface IndicatorDef<Id extends string = string> {
  readonly id: Id;
  /** Human-readable name. */
  readonly label: string;
  /** Unit of measure, e.g. '% vwc', 't/ha'. */
  readonly unit: string;
  /** Short code, e.g. 'MOIST'. */
  readonly short: string;
  /** Higher-is-better, or an inverse (lower-is-better) indicator. */
  readonly direction: IndicatorDirection;
}

/** True for inverse indicators where a lower raw value is the desired outcome. */
export function isInverse(indicator: IndicatorDef): boolean {
  return indicator.direction === 'lower-is-better';
}

/**
 * Re-orient a raw value so that larger always means "better", regardless of the
 * indicator's direction — for inverse indicators the sign is flipped, so any two
 * indicators can be compared on a common benefit axis.
 */
export function orientToBenefit(indicator: IndicatorDef, rawValue: number): number {
  return isInverse(indicator) ? -rawValue : rawValue;
}
```

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `feat(spine): indicator-with-direction value object`

---

## TASK 2 — Spine: typed effect declaration

**Files:**
- Create test: `libs/agri-ecosystem-twin-spine/src/effect-declaration.spec.ts`
- Create: `libs/agri-ecosystem-twin-spine/src/effect-declaration.ts`

- [ ] **Step 1: Write the failing test**

```ts
// effect-declaration.spec.ts
import { describe, it, expect } from 'vitest';
import { effect, signedDelta, isBeneficial } from './effect-declaration.js';
import { type IndicatorDef } from './indicator.js';

const yieldInd: IndicatorDef = { id: 'yield', label: 'Yield', unit: 't/ha', short: 'Y', direction: 'higher-is-better' };
const pestInd: IndicatorDef = { id: 'pest', label: 'Pest', unit: 'index', short: 'P', direction: 'lower-is-better' };

describe('effect-declaration', () => {
  it('effect() builds an immutable typed declaration', () => {
    const e = effect('yield', 'increase', 0.2, 'field-trial');
    expect(e).toEqual({ indicatorId: 'yield', sign: 'increase', magnitude: 0.2, basis: 'field-trial' });
  });
  it('signedDelta is +magnitude for increase, -magnitude for decrease', () => {
    expect(signedDelta(effect('yield', 'increase', 0.2, 'field-trial'))).toBe(0.2);
    expect(signedDelta(effect('pest', 'decrease', 0.06, 'field-trial'))).toBe(-0.06);
  });
  it('isBeneficial: increase helps higher-is-better, decrease helps inverse', () => {
    expect(isBeneficial(effect('yield', 'increase', 0.2, 'field-trial'), yieldInd)).toBe(true);
    expect(isBeneficial(effect('yield', 'decrease', 0.2, 'field-trial'), yieldInd)).toBe(false);
    expect(isBeneficial(effect('pest', 'decrease', 0.06, 'field-trial'), pestInd)).toBe(true);
    expect(isBeneficial(effect('pest', 'increase', 0.06, 'field-trial'), pestInd)).toBe(false);
  });
  it('a zero-magnitude effect is not beneficial', () => {
    expect(isBeneficial(effect('yield', 'increase', 0, 'field-trial'), yieldInd)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Write the implementation**

```ts
// effect-declaration.ts
import { orientToBenefit, type IndicatorDef } from './indicator.js';

/** Direction an intervention moves an indicator's raw value. */
export type EffectSign = 'increase' | 'decrease';

/** Evidence basis backing an effect declaration. */
export type EffectBasis = 'agronomic-literature' | 'field-trial' | 'expert-estimate';

/**
 * A typed declaration that an intervention is expected to move `indicatorId`'s
 * raw value by `magnitude` (in the indicator's own units, always >= 0) in the
 * `sign` direction. Domain-agnostic in-memory value object — the kernel persists
 * effect declarations (ADR-154); the persistence layer (E2.2) maps this onto it.
 */
export interface EffectDeclaration<IndicatorId extends string = string> {
  readonly indicatorId: IndicatorId;
  readonly sign: EffectSign;
  /** Expected absolute change in the indicator's units (>= 0). */
  readonly magnitude: number;
  readonly basis: EffectBasis;
}

/** Construct a typed effect declaration. */
export function effect<Id extends string>(
  indicatorId: Id,
  sign: EffectSign,
  magnitude: number,
  basis: EffectBasis,
): EffectDeclaration<Id> {
  return { indicatorId, sign, magnitude, basis };
}

/** The signed delta an effect applies to its indicator's raw value. */
export function signedDelta(declaration: EffectDeclaration): number {
  return declaration.sign === 'decrease' ? -declaration.magnitude : declaration.magnitude;
}

/**
 * Whether an effect is beneficial for the given indicator: an increase on a
 * higher-is-better indicator, or a decrease on an inverse one. A zero-magnitude
 * (neutral) effect is not beneficial.
 */
export function isBeneficial(declaration: EffectDeclaration, indicator: IndicatorDef): boolean {
  return orientToBenefit(indicator, signedDelta(declaration)) > 0;
}
```

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `feat(spine): typed effect declaration + helpers`

---

## TASK 3 — Spine: single-parent subject hierarchy

**Files:**
- Create test: `libs/agri-ecosystem-twin-spine/src/subject-hierarchy.spec.ts`
- Create: `libs/agri-ecosystem-twin-spine/src/subject-hierarchy.ts`

- [ ] **Step 1: Write the failing test**

```ts
// subject-hierarchy.spec.ts
import { describe, it, expect } from 'vitest';
import { buildSubjectForest, pathToRoot, type SubjectNode } from './subject-hierarchy.js';

const nodes: SubjectNode[] = [
  { id: 'farm1', kind: 'farm', label: 'Farm', parentId: null },
  { id: 'fieldA', kind: 'field', label: 'Field A', parentId: 'farm1' },
  { id: 'plotA1', kind: 'plot', label: 'Plot A1', parentId: 'fieldA' },
  { id: 'plotA2', kind: 'plot', label: 'Plot A2', parentId: 'fieldA' },
];

describe('subject-hierarchy', () => {
  it('builds a forest with resolved children', () => {
    const [root] = buildSubjectForest(nodes);
    expect(root?.id).toBe('farm1');
    expect(root?.children[0]?.id).toBe('fieldA');
    expect(root?.children[0]?.children.map((c) => c.id)).toEqual(['plotA1', 'plotA2']);
  });
  it('pathToRoot returns the ancestor chain leaf->root', () => {
    expect(pathToRoot(nodes, 'plotA1').map((n) => n.id)).toEqual(['plotA1', 'fieldA', 'farm1']);
  });
  it('throws on a dangling parent reference', () => {
    expect(() => buildSubjectForest([{ id: 'x', kind: 'plot', label: 'X', parentId: 'missing' }])).toThrow();
  });
  it('throws when an id is unknown to pathToRoot', () => {
    expect(() => pathToRoot(nodes, 'nope')).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Write the implementation**

```ts
// subject-hierarchy.ts
/** A node in a single-parent subject hierarchy. */
export interface SubjectNode<Kind extends string = string> {
  readonly id: string;
  readonly kind: Kind;
  readonly label: string;
  /** Parent node id, or null for a root. Single-parent invariant. */
  readonly parentId: string | null;
}

/** A subject node with its resolved children — a derived view, never stored. */
export interface SubjectTreeNode<Kind extends string = string> extends SubjectNode<Kind> {
  readonly children: ReadonlyArray<SubjectTreeNode<Kind>>;
}

/**
 * Assemble a flat node list into a forest of `SubjectTreeNode` roots, preserving
 * input order among siblings. Throws if any `parentId` references an unknown id.
 */
export function buildSubjectForest<Kind extends string>(
  nodes: ReadonlyArray<SubjectNode<Kind>>,
): ReadonlyArray<SubjectTreeNode<Kind>> {
  const byId = new Map(nodes.map((n) => [n.id, { ...n, children: [] as SubjectTreeNode<Kind>[] }]));
  const roots: SubjectTreeNode<Kind>[] = [];
  for (const node of nodes) {
    const built = byId.get(node.id)!;
    if (node.parentId === null) {
      roots.push(built);
      continue;
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      throw new Error(`subject ${node.id} references unknown parent ${node.parentId}`);
    }
    parent.children.push(built);
  }
  return roots;
}

/**
 * The ancestor chain from `id` to its root (inclusive, leaf-first). Throws if
 * `id` is unknown or a `parentId` dangles.
 */
export function pathToRoot<Kind extends string>(
  nodes: ReadonlyArray<SubjectNode<Kind>>,
  id: string,
): ReadonlyArray<SubjectNode<Kind>> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: SubjectNode<Kind>[] = [];
  let cursor: string | null = id;
  while (cursor !== null) {
    const node: SubjectNode<Kind> | undefined = byId.get(cursor);
    if (!node) {
      throw new Error(`unknown subject id ${cursor}`);
    }
    chain.push(node);
    cursor = node.parentId;
  }
  return chain;
}
```

> Note: `byId.get(node.id)!` is safe because the map was built from `nodes`. The non-null assertion keeps the unreachable-branch count down (better for coverage than an `if`).

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `feat(spine): single-parent subject hierarchy + helpers`

---

## TASK 4 — Spine: single-parent plan tree

**Files:**
- Create test: `libs/agri-ecosystem-twin-spine/src/plan-tree.spec.ts`
- Create: `libs/agri-ecosystem-twin-spine/src/plan-tree.ts`

- [ ] **Step 1: Write the failing test**

```ts
// plan-tree.spec.ts
import { describe, it, expect } from 'vitest';
import { buildPlanTree, flattenPlanTree, planLeaves, type PlanNode } from './plan-tree.js';

const nodes: PlanNode<{ n: number }>[] = [
  { id: 'root', parentId: null, label: 'Season', payload: { n: 0 } },
  { id: 's1', parentId: 'root', label: 'Step 1', payload: { n: 1 } },
  { id: 's2', parentId: 'root', label: 'Step 2', payload: { n: 2 } },
];

describe('plan-tree', () => {
  it('builds a single-root tree with ordered children', () => {
    const root = buildPlanTree(nodes);
    expect(root.id).toBe('root');
    expect(root.children.map((c) => c.id)).toEqual(['s1', 's2']);
  });
  it('flattenPlanTree round-trips the nodes (root-first DFS)', () => {
    const root = buildPlanTree(nodes);
    expect(flattenPlanTree(root).map((n) => n.id)).toEqual(['root', 's1', 's2']);
  });
  it('planLeaves returns only childless nodes', () => {
    expect(planLeaves(buildPlanTree(nodes)).map((n) => n.id)).toEqual(['s1', 's2']);
  });
  it('throws when there is no root', () => {
    expect(() => buildPlanTree([{ id: 'a', parentId: 'b', label: 'A', payload: { n: 1 } }])).toThrow();
  });
  it('throws when there is more than one root', () => {
    expect(() => buildPlanTree([
      { id: 'r1', parentId: null, label: 'R1', payload: { n: 1 } },
      { id: 'r2', parentId: null, label: 'R2', payload: { n: 2 } },
    ])).toThrow();
  });
  it('throws on a dangling parent', () => {
    expect(() => buildPlanTree([
      { id: 'root', parentId: null, label: 'R', payload: { n: 0 } },
      { id: 's1', parentId: 'ghost', label: 'S1', payload: { n: 1 } },
    ])).toThrow();
  });
});
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Write the implementation**

```ts
// plan-tree.ts
/** A node in a single-parent plan tree carrying a typed payload. */
export interface PlanNode<Payload = unknown> {
  readonly id: string;
  /** Parent node id, or null for the single root. */
  readonly parentId: string | null;
  readonly label: string;
  readonly payload: Payload;
}

/** A plan node with its resolved children — a derived view, never stored. */
export interface PlanTreeNode<Payload = unknown> extends PlanNode<Payload> {
  readonly children: ReadonlyArray<PlanTreeNode<Payload>>;
}

/**
 * Assemble a flat node list into a single-root plan tree (kernel concern #1
 * "recurse the plan", as an in-memory domain value object). Throws unless there
 * is exactly one root and every non-root `parentId` resolves.
 */
export function buildPlanTree<Payload>(nodes: ReadonlyArray<PlanNode<Payload>>): PlanTreeNode<Payload> {
  const byId = new Map(nodes.map((n) => [n.id, { ...n, children: [] as PlanTreeNode<Payload>[] }]));
  const roots: PlanTreeNode<Payload>[] = [];
  for (const node of nodes) {
    const built = byId.get(node.id)!;
    if (node.parentId === null) {
      roots.push(built);
      continue;
    }
    const parent = byId.get(node.parentId);
    if (!parent) {
      throw new Error(`plan node ${node.id} references unknown parent ${node.parentId}`);
    }
    parent.children.push(built);
  }
  if (roots.length !== 1) {
    throw new Error(`a plan tree needs exactly one root, found ${roots.length}`);
  }
  return roots[0]!;
}

/** Root-first depth-first flatten back to plain nodes (inverse of buildPlanTree). */
export function flattenPlanTree<Payload>(root: PlanTreeNode<Payload>): ReadonlyArray<PlanNode<Payload>> {
  const out: PlanNode<Payload>[] = [];
  const visit = (node: PlanTreeNode<Payload>): void => {
    const { children, ...plain } = node;
    out.push(plain);
    for (const child of children) {
      visit(child);
    }
  };
  visit(root);
  return out;
}

/** The leaf nodes of a plan tree (the childless intervention nodes). */
export function planLeaves<Payload>(root: PlanTreeNode<Payload>): ReadonlyArray<PlanTreeNode<Payload>> {
  const out: PlanTreeNode<Payload>[] = [];
  const visit = (node: PlanTreeNode<Payload>): void => {
    if (node.children.length === 0) {
      out.push(node);
      return;
    }
    for (const child of node.children) {
      visit(child);
    }
  };
  visit(root);
  return out;
}
```

> Note: `const { children, ...plain } = node` drops the `children` field to recover a plain `PlanNode`. If eslint flags `children` as unused, rename to `_children` or add an eslint-disable for `no-unused-vars` on that line — prefer the rest-destructure; it is the cleanest inverse.

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `feat(spine): single-parent plan tree + builder/flatten/leaves`

---

## TASK 5 — Spine: barrel + remove placeholder

**Files:**
- Modify: `libs/agri-ecosystem-twin-spine/src/index.ts`
- Modify: `libs/agri-ecosystem-twin-spine/src/index.spec.ts`

- [ ] **Step 1: Replace `index.ts` (drop `SPINE_READY`)**

```ts
// index.ts
export * from './indicator.js';
export * from './effect-declaration.js';
export * from './subject-hierarchy.js';
export * from './plan-tree.js';
```

- [ ] **Step 2: Replace `index.spec.ts` with a barrel smoke test**

```ts
import { describe, it, expect } from 'vitest';
import { isInverse, effect, buildSubjectForest, buildPlanTree } from './index.js';

describe('agri-ecosystem-twin-spine barrel', () => {
  it('re-exports the public surface', () => {
    expect(typeof isInverse).toBe('function');
    expect(typeof effect).toBe('function');
    expect(typeof buildSubjectForest).toBe('function');
    expect(typeof buildPlanTree).toBe('function');
  });
});
```

- [ ] **Step 3: Build + test the whole spine** — `pnpm --filter @de-braighter/agri-ecosystem-twin-spine run build && pnpm --filter @de-braighter/agri-ecosystem-twin-spine run test` → PASS.
- [ ] **Step 4: Commit** — `feat(spine): export domain-model barrel; drop scaffold placeholder`

---

## TASK 6 — Pack: the 3 wedge indicators

**Files:**
- Create test: `libs/agri-ecosystem-twin-pack/src/indicators.spec.ts`
- Create: `libs/agri-ecosystem-twin-pack/src/indicators.ts`

> **Precondition:** spine is built (`pnpm --filter @de-braighter/agri-ecosystem-twin-spine run build`) so the pack can resolve it.

- [ ] **Step 1: Write the failing test**

```ts
// indicators.spec.ts
import { describe, it, expect } from 'vitest';
import { AGRI_INDICATORS, AGRI_INDICATOR_IDS, SOIL_MOISTURE, PEST_PRESSURE, YIELD } from './indicators.js';
import { isInverse } from '@de-braighter/agri-ecosystem-twin-spine';

describe('agri indicators', () => {
  it('defines exactly the three wedge indicators', () => {
    expect(AGRI_INDICATOR_IDS).toEqual(['soil-moisture', 'pest-pressure', 'yield']);
  });
  it('pest-pressure is the inverse (lower-is-better) indicator', () => {
    expect(isInverse(PEST_PRESSURE)).toBe(true);
    expect(isInverse(SOIL_MOISTURE)).toBe(false);
    expect(isInverse(YIELD)).toBe(false);
  });
  it('carries units from the domain', () => {
    expect(SOIL_MOISTURE.unit).toBe('% vwc');
    expect(YIELD.unit).toBe('t/ha');
  });
  it('AGRI_INDICATORS is keyed by id', () => {
    expect(AGRI_INDICATORS['pest-pressure']).toBe(PEST_PRESSURE);
  });
});
```

- [ ] **Step 2: Run test, verify it fails** — `pnpm --filter @de-braighter/agri-ecosystem-twin-pack run test`.

- [ ] **Step 3: Write the implementation**

```ts
// indicators.ts
import { type IndicatorDef } from '@de-braighter/agri-ecosystem-twin-spine';

/** The three wedge indicators. */
export type AgriIndicatorId = 'soil-moisture' | 'pest-pressure' | 'yield';

export const SOIL_MOISTURE: IndicatorDef<'soil-moisture'> = {
  id: 'soil-moisture', label: 'Soil Moisture', unit: '% vwc', short: 'MOIST', direction: 'higher-is-better',
};

export const PEST_PRESSURE: IndicatorDef<'pest-pressure'> = {
  // Inverse indicator: lower pest pressure is the desired outcome.
  id: 'pest-pressure', label: 'Pest Pressure', unit: 'index', short: 'PEST', direction: 'lower-is-better',
};

export const YIELD: IndicatorDef<'yield'> = {
  id: 'yield', label: 'Yield', unit: 't/ha', short: 'YIELD', direction: 'higher-is-better',
};

/** Ordered ids of the wedge indicators. */
export const AGRI_INDICATOR_IDS = ['soil-moisture', 'pest-pressure', 'yield'] as const;

/** The wedge indicators keyed by id. */
export const AGRI_INDICATORS: Readonly<Record<AgriIndicatorId, IndicatorDef<AgriIndicatorId>>> = {
  'soil-moisture': SOIL_MOISTURE,
  'pest-pressure': PEST_PRESSURE,
  yield: YIELD,
};
```

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `feat(pack): the three wedge indicators (soil moisture, pest [inverse], yield)`

---

## TASK 7 — Pack: plot/field/farm subject types

**Files:**
- Create test: `libs/agri-ecosystem-twin-pack/src/subjects.spec.ts`
- Create: `libs/agri-ecosystem-twin-pack/src/subjects.ts`

- [ ] **Step 1: Write the failing test**

```ts
// subjects.spec.ts
import { describe, it, expect } from 'vitest';
import { SUBJECT_LEVELS, parentLevelOf, type Farm, type Field, type Plot } from './subjects.js';
import { buildSubjectForest, type SubjectNode } from '@de-braighter/agri-ecosystem-twin-spine';

describe('agri subjects', () => {
  it('nests farm > field > plot', () => {
    expect(SUBJECT_LEVELS).toEqual(['farm', 'field', 'plot']);
  });
  it('parentLevelOf encodes the nesting rule', () => {
    expect(parentLevelOf('farm')).toBeNull();
    expect(parentLevelOf('field')).toBe('farm');
    expect(parentLevelOf('plot')).toBe('field');
  });
  it('concrete subjects build a forest via the spine helper', () => {
    const farm: Farm = { id: 'f1', kind: 'farm', label: 'Tellurian', parentId: null, region: 'Mendocino' };
    const field: Field = { id: 'fa', kind: 'field', label: 'Field A', parentId: 'f1' };
    const plot: Plot = { id: 'p1', kind: 'plot', label: 'Block A', parentId: 'fa', crop: 'Cabernet' };
    const subjects: SubjectNode[] = [farm, field, plot];
    const [root] = buildSubjectForest(subjects);
    expect(root?.children[0]?.children[0]?.id).toBe('p1');
  });
});
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Write the implementation**

```ts
// subjects.ts
import { type SubjectNode } from '@de-braighter/agri-ecosystem-twin-spine';

/** The three nesting levels of the agri subject hierarchy. */
export type SubjectLevel = 'farm' | 'field' | 'plot';

/** Levels root-first. */
export const SUBJECT_LEVELS = ['farm', 'field', 'plot'] as const;

/** A farm — the root subject; contains fields. */
export interface Farm extends SubjectNode<'farm'> {
  readonly parentId: null;
  readonly region?: string;
  readonly hectares?: number;
}

/** A field — child of a farm; contains plots. */
export interface Field extends SubjectNode<'field'> {
  readonly parentId: string;
}

/** A plot — child of a field; the subject a plan + counterfactual run on. */
export interface Plot extends SubjectNode<'plot'> {
  readonly parentId: string;
  readonly crop?: string;
  readonly hectares?: number;
}

export type AgriSubject = Farm | Field | Plot;

const PARENT_LEVEL: Readonly<Record<SubjectLevel, SubjectLevel | null>> = {
  farm: null,
  field: 'farm',
  plot: 'field',
};

/** The required parent level for a level, or null for the root level (farm). */
export function parentLevelOf(level: SubjectLevel): SubjectLevel | null {
  return PARENT_LEVEL[level];
}
```

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `feat(pack): plot/field/farm subject types + nesting rule`

---

## TASK 8 — Pack: cover-crop A/B intervention catalog

**Files:**
- Create test: `libs/agri-ecosystem-twin-pack/src/interventions.spec.ts`
- Create: `libs/agri-ecosystem-twin-pack/src/interventions.ts`

- [ ] **Step 1: Write the failing test**

```ts
// interventions.spec.ts
import { describe, it, expect } from 'vitest';
import { COVER_CROP_CATALOG, COVER_CROP_ARMS, COVER_VETCH, COVER_PHACELIA, effectOn } from './interventions.js';
import { isBeneficial } from '@de-braighter/agri-ecosystem-twin-spine';
import { PEST_PRESSURE } from './indicators.js';

describe('cover-crop catalog', () => {
  it('arm A is vetch+rye, arm B is phacelia+clover', () => {
    expect(COVER_CROP_ARMS.A).toBe(COVER_VETCH);
    expect(COVER_CROP_ARMS.B).toBe(COVER_PHACELIA);
    expect(COVER_VETCH.species).toEqual(['Vetch', 'Rye']);
    expect(COVER_PHACELIA.species).toEqual(['Phacelia', 'Clover']);
  });
  it('each mix declares a typed effect on all three indicators', () => {
    for (const mix of Object.values(COVER_CROP_CATALOG)) {
      expect(mix.effects.map((e) => e.indicatorId).sort()).toEqual(['pest-pressure', 'soil-moisture', 'yield']);
    }
  });
  it('carries the dossier effect magnitudes', () => {
    expect(effectOn(COVER_VETCH, 'soil-moisture')?.magnitude).toBe(2.4);
    expect(effectOn(COVER_PHACELIA, 'pest-pressure')?.magnitude).toBe(0.12);
  });
  it('both mixes reduce pest pressure beneficially (inverse indicator)', () => {
    const vetchPest = effectOn(COVER_VETCH, 'pest-pressure')!;
    expect(vetchPest.sign).toBe('decrease');
    expect(isBeneficial(vetchPest, PEST_PRESSURE)).toBe(true);
  });
  it('effectOn returns undefined for an indicator not declared', () => {
    expect(effectOn(COVER_VETCH, 'nonexistent' as never)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Write the implementation**

```ts
// interventions.ts
import { effect, type EffectBasis, type EffectDeclaration } from '@de-braighter/agri-ecosystem-twin-spine';
import { type AgriIndicatorId, SOIL_MOISTURE, PEST_PRESSURE, YIELD } from './indicators.js';

/** The two cover-crop mixes that form the A-vs-B counterfactual. */
export type CoverCropMixId = 'cover-vetch' | 'cover-phacelia';

/** The two counterfactual arms. */
export type CounterfactualArm = 'A' | 'B';

/** A cover-crop mix: an intervention carrying typed effect declarations. */
export interface CoverCropMix {
  readonly id: CoverCropMixId;
  readonly arm: CounterfactualArm;
  readonly label: string;
  readonly species: ReadonlyArray<string>;
  readonly effects: ReadonlyArray<EffectDeclaration<AgriIndicatorId>>;
}

// All catalog effects are sourced from the synthetic field-trial dataset.
const TRIAL: EffectBasis = 'field-trial';

export const COVER_VETCH: CoverCropMix = {
  id: 'cover-vetch',
  arm: 'A',
  label: 'Cover crop: Vetch + Rye',
  species: ['Vetch', 'Rye'],
  effects: [
    effect(SOIL_MOISTURE.id, 'increase', 2.4, TRIAL),
    effect(PEST_PRESSURE.id, 'decrease', 0.06, TRIAL),
    effect(YIELD.id, 'increase', 0.2, TRIAL),
  ],
};

export const COVER_PHACELIA: CoverCropMix = {
  id: 'cover-phacelia',
  arm: 'B',
  label: 'Cover crop: Phacelia + Clover',
  species: ['Phacelia', 'Clover'],
  effects: [
    effect(SOIL_MOISTURE.id, 'increase', 1.8, TRIAL),
    effect(PEST_PRESSURE.id, 'decrease', 0.12, TRIAL),
    effect(YIELD.id, 'increase', 0.1, TRIAL),
  ],
};

/** The cover-crop mixes keyed by id. */
export const COVER_CROP_CATALOG: Readonly<Record<CoverCropMixId, CoverCropMix>> = {
  'cover-vetch': COVER_VETCH,
  'cover-phacelia': COVER_PHACELIA,
};

/** The A-vs-B counterfactual arms: A = vetch, B = phacelia. */
export const COVER_CROP_ARMS: Readonly<Record<CounterfactualArm, CoverCropMix>> = {
  A: COVER_VETCH,
  B: COVER_PHACELIA,
};

/** The mix's declared effect on an indicator, or undefined if none declared. */
export function effectOn(mix: CoverCropMix, indicatorId: AgriIndicatorId): EffectDeclaration<AgriIndicatorId> | undefined {
  return mix.effects.find((e) => e.indicatorId === indicatorId);
}
```

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `feat(pack): cover-crop A/B catalog with typed effect declarations`

---

## TASK 9 — Pack: season → intervention-sequence plan builder

**Files:**
- Create test: `libs/agri-ecosystem-twin-pack/src/plan-builder.spec.ts`
- Create: `libs/agri-ecosystem-twin-pack/src/plan-builder.ts`

- [ ] **Step 1: Write the failing test**

```ts
// plan-builder.spec.ts
import { describe, it, expect } from 'vitest';
import { buildSeasonPlan, buildArmPlans, type PlanNodePayload } from './plan-builder.js';
import { planLeaves, flattenPlanTree } from '@de-braighter/agri-ecosystem-twin-spine';

describe('season plan builder', () => {
  it('builds a single-root season tree with an intervention per sequence step', () => {
    const root = buildSeasonPlan({ plotId: 'p1', season: '2026', sequence: ['cover-vetch', 'cover-phacelia'] });
    expect(root.parentId).toBeNull();
    expect(root.payload.kind).toBe('season');
    expect(root.children).toHaveLength(2);
    const leaves = planLeaves(root);
    expect(leaves.map((l) => (l.payload as Extract<PlanNodePayload, { kind: 'intervention' }>).mixId))
      .toEqual(['cover-vetch', 'cover-phacelia']);
  });
  it('intervention leaves carry the catalog effect declarations', () => {
    const root = buildSeasonPlan({ plotId: 'p1', season: '2026', sequence: ['cover-vetch'] });
    const [leaf] = planLeaves(root);
    const payload = leaf!.payload as Extract<PlanNodePayload, { kind: 'intervention' }>;
    expect(payload.arm).toBe('A');
    expect(payload.effects.find((e) => e.indicatorId === 'soil-moisture')?.magnitude).toBe(2.4);
  });
  it('an empty sequence yields a season root with no interventions', () => {
    const root = buildSeasonPlan({ plotId: 'p1', season: '2026', sequence: [] });
    expect(root.children).toHaveLength(0);
    expect(flattenPlanTree(root)).toHaveLength(1);
  });
  it('buildArmPlans makes one single-mix plan per arm', () => {
    const { A, B } = buildArmPlans('p1', '2026');
    expect(planLeaves(A).map((l) => (l.payload as Extract<PlanNodePayload, { kind: 'intervention' }>).mixId)).toEqual(['cover-vetch']);
    expect(planLeaves(B).map((l) => (l.payload as Extract<PlanNodePayload, { kind: 'intervention' }>).mixId)).toEqual(['cover-phacelia']);
  });
});
```

- [ ] **Step 2: Run test, verify it fails.**

- [ ] **Step 3: Write the implementation**

```ts
// plan-builder.ts
import {
  buildPlanTree,
  type EffectDeclaration,
  type PlanNode,
  type PlanTreeNode,
} from '@de-braighter/agri-ecosystem-twin-spine';
import { type AgriIndicatorId } from './indicators.js';
import { COVER_CROP_CATALOG, type CounterfactualArm, type CoverCropMixId } from './interventions.js';

/** Payload on a season plan-tree node: the season root or an intervention step. */
export type PlanNodePayload =
  | { readonly kind: 'season'; readonly plotId: string; readonly season: string }
  | {
      readonly kind: 'intervention';
      readonly order: number;
      readonly mixId: CoverCropMixId;
      readonly arm: CounterfactualArm;
      readonly effects: ReadonlyArray<EffectDeclaration<AgriIndicatorId>>;
    };

/** Inputs to build a season plan for one plot. */
export interface SeasonPlanInput {
  readonly plotId: string;
  /** A season label, e.g. '2026'. */
  readonly season: string;
  /** Ordered cover-crop mixes applied across the season. */
  readonly sequence: ReadonlyArray<CoverCropMixId>;
}

/**
 * Build a single-parent season plan tree for a plot: a season root parenting one
 * intervention node per sequence step (siblings, ordered by `order`), each leaf
 * carrying its catalog effect declarations. The result feeds the kernel plan
 * tree (E2.2) and the A-vs-B counterfactual (E3.1).
 */
export function buildSeasonPlan(input: SeasonPlanInput): PlanTreeNode<PlanNodePayload> {
  const rootId = `season:${input.plotId}:${input.season}`;
  const nodes: PlanNode<PlanNodePayload>[] = [
    {
      id: rootId,
      parentId: null,
      label: `Season ${input.season} — plot ${input.plotId}`,
      payload: { kind: 'season', plotId: input.plotId, season: input.season },
    },
  ];
  input.sequence.forEach((mixId, order) => {
    const mix = COVER_CROP_CATALOG[mixId];
    nodes.push({
      id: `${rootId}:step:${order}:${mixId}`,
      parentId: rootId,
      label: mix.label,
      payload: { kind: 'intervention', order, mixId, arm: mix.arm, effects: mix.effects },
    });
  });
  return buildPlanTree(nodes);
}

/**
 * The two single-mix season plans that form the A-vs-B counterfactual for a plot:
 * arm A = vetch, arm B = phacelia.
 */
export function buildArmPlans(
  plotId: string,
  season: string,
): { readonly A: PlanTreeNode<PlanNodePayload>; readonly B: PlanTreeNode<PlanNodePayload> } {
  return {
    A: buildSeasonPlan({ plotId, season, sequence: ['cover-vetch'] }),
    B: buildSeasonPlan({ plotId, season, sequence: ['cover-phacelia'] }),
  };
}
```

> Note on `noUncheckedIndexedAccess`: it adds `| undefined` only to **index-signature** access, not to a `Record` over a finite literal-union key. `COVER_CROP_CATALOG` is `Record<CoverCropMixId, CoverCropMix>` (= an object with two concrete properties), so `COVER_CROP_CATALOG[mixId]` is `CoverCropMix` — no `| undefined`, no assertion needed. (Contrast `Map.get`, which always returns `V | undefined`.)

- [ ] **Step 4: Run test, verify PASS.**
- [ ] **Step 5: Commit** — `feat(pack): season -> intervention-sequence plan-tree builder`

---

## TASK 10 — Pack: barrel + full gate

**Files:**
- Modify: `libs/agri-ecosystem-twin-pack/src/index.ts`
- Modify: `libs/agri-ecosystem-twin-pack/src/index.spec.ts`

- [ ] **Step 1: Replace `index.ts`**

```ts
// index.ts
export { PACK_ID } from './constants.js';
export * from './indicators.js';
export * from './subjects.js';
export * from './interventions.js';
export * from './plan-builder.js';
```

- [ ] **Step 2: Extend `index.spec.ts` (keep the PACK_ID assertion)**

```ts
import { describe, it, expect } from 'vitest';
import { PACK_ID, AGRI_INDICATOR_IDS, COVER_CROP_ARMS, buildSeasonPlan } from './index.js';

describe('agri-ecosystem-twin-pack barrel', () => {
  it('declares its pack id', () => {
    expect(PACK_ID).toBe('agri-ecosystem-twin');
  });
  it('re-exports the domain model', () => {
    expect(AGRI_INDICATOR_IDS).toHaveLength(3);
    expect(COVER_CROP_ARMS.A.id).toBe('cover-vetch');
    expect(typeof buildSeasonPlan).toBe('function');
  });
});
```

- [ ] **Step 3: Full repo gate** — from the worktree root:

```bash
pnpm run build && pnpm run typecheck && pnpm run lint && pnpm run test && pnpm run quality:knip:report
```

Expected: all green. If `sonarjs/no-duplicate-string` fires, extract the literal to a typed `const`. If knip reports unused exports for a public-API symbol, confirm it is part of the lib's intended public surface (the domain preset treats `src/index.ts` exports as entry points) — leave intended public API in place.

- [ ] **Step 4: Commit** — `feat(pack): export domain-model barrel`

---

## Self-Review checklist (run before opening the PR)

- **Spec coverage:** (1) 3 indicators → Task 6 ✓; (2) plot/field/farm subject types → Task 7 ✓; (3) cover-crop A/B catalog with typed effect declarations → Task 8 ✓; (4) season → intervention-sequence plan-tree builder types → Task 9 ✓. Spine Tasks 1–4 supply the reusable shapes each pack task consumes.
- **Scope:** every file under `libs/` (E2.1 pathPrefix). No `apps/`, no root `package.json`/`pnpm-lock.yaml`, no `tools/`, no substrate import. Confirm with `git diff --name-only origin/main...HEAD`.
- **Type consistency:** `IndicatorDef`, `EffectDeclaration`, `SubjectNode`, `PlanNode`/`PlanTreeNode` names match across spine ↔ pack. `effect()`, `buildPlanTree`, `planLeaves`, `flattenPlanTree`, `buildSubjectForest`, `pathToRoot` referenced consistently.
- **`seed-data-only` / `no-kernel-change`:** no live feed, no substrate-contracts/runtime import in `libs/` — pure domain types. ✓
