# Foundry v1 — Conductor Drives Off the Kernel Plan Tree (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the foundry conductor's claimable frontier derive from the kernel plan tree (`planFrontier`) instead of the flat bespoke queue, gated by a divergence invariant that goes red if the tree and the shadowed queue disagree.

**Architecture:** `planFrontier = claimableItems ∘ projectTreeState`. `projectTreeState(tree, s)` rebuilds `DerivedState.items` from the plan tree's work-item leaves — taking *structure* (`itemId`, `scope`, `dependsOn`, `productKey`) from the tree but *status* (`claims`, `merged`, `retired`, `queuedAt`) from the real event-log-derived state. A `FrontierSource` selector on `nextItems`/`foundry_next` chooses `'queue'` (default, the unchanged shadow) or `'plan'` (the new driver). A divergence test asserts the two frontiers are identical; mutation tests prove it bites.

**Tech Stack:** TypeScript (ESM, `"type": "module"`), Node ≥20, zod, vitest 2.x, `@de-braighter/substrate-contracts` (plan-tree + events). Pure functions over an append-only JSONL event log; no NestJS/Prisma/DB.

## Global Constraints

- **Repo:** `domains/foundry` (`@de-braighter/foundry`). All Phase-A code + tests land here. The ADR (Task 6) lands in `layers/specs` (separate repo, separate PR).
- **Dependency floor (verbatim):** `@de-braighter/substrate-contracts": "^0.10.0"`, `zod": "^3.25.76"`, `vitest": "^2.1.0"`. Do **not** bump these.
- **ESM imports:** every relative import carries an explicit `.js` extension (e.g. `from '../state.js'`); contracts subpaths are `@de-braighter/substrate-contracts/plan-tree` and `.../events`.
- **Zero kernel change.** No edits under `layers/substrate`. The frontier rides ratified surfaces only: `PlanNode.kind` free-string + `metadata` JSONB (ADR-127/194). Adding a kernel entity/table/verb/field is out of scope and a review-fail.
- **Single claimability encoding.** `planFrontier` MUST reuse `claimableItems` (via `projectTreeState`) — never re-implement the claimable rule. (Review lesson M1: two encodings of "claimable" already drifted once.)
- **Default `source` is `'queue'`.** The seam must not change any existing caller's behaviour; `'plan'` is opt-in.
- **Determinism.** No `Date.now()` / `Math.random()` in `plan/frontier.ts`. Time enters only as the `nowMs` argument (the `FoundryDeps.now` injection pattern).
- **Commit hygiene:** stage explicit paths only (`git add <path>`), never `git add -A`. Commit after each task's tests pass. Run from `domains/foundry/`.
- **Test command:** single file `npx vitest run test/<file>.test.ts`; full suite `npm test`; gate `npm run ci:local` (typecheck + coverage). The 248 existing tests must stay green throughout.

---

### Task 1: `projectTreeState` + `planFrontier` (the core derivation)

**Files:**
- Create: `domains/foundry/src/plan/frontier.ts`
- Modify: `domains/foundry/src/metamodel/vocabulary.ts` (extend `WorkItemMeta` with optional `scope` / `dependsOn`)
- Test: `domains/foundry/test/frontier.test.ts`

**Interfaces:**
- Consumes: `claimableItems(s, nowMs)`, `type DerivedState`, `type ItemState` from `../state.js`; `type ItemScope` from `../events.js`; `type PlanTree` from `@de-braighter/substrate-contracts/plan-tree`; `buildCascadeTree`, `type CascadeNodeSpec` from `./cascade.js`.
- Produces: `projectTreeState(tree: PlanTree, s: DerivedState): DerivedState`, `planFrontier(tree: PlanTree, s: DerivedState, nowMs: number): ItemState[]`. Reads leaf `metadata.{itemId, scope, dependsOn, title}` and root `metadata.productKey`.

- [ ] **Step 1: Extend the leaf-metadata type**

In `domains/foundry/src/metamodel/vocabulary.ts`, add the optional execution-metadata fields to `WorkItemMeta` (kept optional so the descriptive `WHALES_PRODUCT` instance and the genericity acid-test are unaffected):

```ts
import type { CascadeNodeSpec } from '../plan/cascade.js';
import type { ItemScope } from '../events.js';   // NEW import

// ... NODE_KINDS / RESOURCES / SUBSTANCE_KINDS unchanged ...

export interface WorkItemMeta {
  resource: Resource;
  yields: SubstanceRef[];
  status: WorkItemStatus;
  itemId?: string;
  title?: string;
  scope?: ItemScope;        // NEW — execution structure, the frontier authority
  dependsOn?: string[];     // NEW — cross-links (sequencing), NEVER parentage
}
```

- [ ] **Step 2: Write the failing test**

Create `domains/foundry/test/frontier.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCascadeTree, type CascadeNodeSpec } from '../src/plan/cascade.js';
import { planFrontier, projectTreeState } from '../src/plan/frontier.js';
import { fold } from '../src/state.js';
import { productRegistered, itemQueued, claimAcquired, mergeRecorded } from '../src/events.js';

const T0 = Date.parse('2026-06-17T12:00:00.000Z');

// A single-product drivable tree: structure (scope/deps) lives on the leaves.
const TREE_SPEC: CascadeNodeSpec[] = [
  { key: 'root', kind: 'product', parent: null, meta: { title: 'P', productKey: 'p' } },
  { key: 'cap', kind: 'capability', parent: 'root', meta: { title: 'cap' } },
  { key: 'feat', kind: 'feature', parent: 'cap', meta: { title: 'feat' } },
  { key: 'wi-a', kind: 'work-item', parent: 'feat',
    meta: { itemId: 'p/a', title: 'a', resource: 'ai', yields: [], status: 'queued',
            scope: { repo: 'r/p', issue: 1 }, dependsOn: [] } },
  { key: 'wi-b', kind: 'work-item', parent: 'feat',
    meta: { itemId: 'p/b', title: 'b', resource: 'ai', yields: [], status: 'queued',
            scope: { repo: 'r/p', issue: 2 }, dependsOn: ['p/a'] } },
];
const tree = buildCascadeTree(TREE_SPEC);

// Log: product + both items queued, nothing claimed/merged yet.
const baseLog = [
  productRegistered({ productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0', ts: '2026-06-17T12:00:00.000Z' }),
  itemQueued({ itemId: 'p/a', productKey: 'p', title: 'a', scope: { repo: 'r/p', issue: 1 }, ts: '2026-06-17T12:00:00.000Z' }),
  itemQueued({ itemId: 'p/b', productKey: 'p', title: 'b', scope: { repo: 'r/p', issue: 2 }, dependsOn: ['p/a'], ts: '2026-06-17T12:00:00.000Z' }),
];

describe('planFrontier (structure from tree, status from log)', () => {
  it('returns leaves whose deps are done, blocking dependents', () => {
    const s = fold(baseLog);
    // p/b depends on p/a (not done) -> only p/a is claimable
    expect(planFrontier(tree, s, T0).map((i) => i.itemId)).toEqual(['p/a']);
  });

  it('advances the frontier when a dependency merges (status from log)', () => {
    const s = fold([
      ...baseLog,
      claimAcquired({ claimId: 'c1', itemId: 'p/a', sessionId: 's', ttlMinutes: 240, ts: '2026-06-17T12:00:00.000Z' }),
      mergeRecorded({ itemId: 'p/a', prRef: 'r/p#1', ts: '2026-06-17T12:30:00.000Z' }),
    ]);
    // p/a done -> leaves frontier; p/b unblocked -> enters
    expect(planFrontier(tree, s, T0).map((i) => i.itemId)).toEqual(['p/b']);
  });

  it('projectTreeState takes scope/deps from the tree, status from the log', () => {
    const s = fold(baseLog);
    const projected = projectTreeState(tree, s);
    expect([...projected.items.keys()].sort()).toEqual(['p/a', 'p/b']);
    expect(projected.items.get('p/b')!.dependsOn).toEqual(['p/a']); // from tree leaf
    expect(projected.items.get('p/a')!.claims).toEqual([]);          // from log
  });

  it('throws on a work-item leaf missing scope (not drivable)', () => {
    const bad = buildCascadeTree([
      { key: 'root', kind: 'product', parent: null, meta: { productKey: 'p' } },
      { key: 'w', kind: 'work-item', parent: 'root', meta: { itemId: 'p/x', resource: 'ai', yields: [], status: 'queued' } },
    ]);
    expect(() => projectTreeState(bad, fold([]))).toThrow(/missing metadata.scope/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/frontier.test.ts`
Expected: FAIL — `Cannot find module '../src/plan/frontier.js'` (file not created yet).

- [ ] **Step 4: Write the minimal implementation**

Create `domains/foundry/src/plan/frontier.ts`:

```ts
// planFrontier = claimableItems ∘ projectTreeState. The plan tree is the AUTHORITY
// for execution STRUCTURE (which work-items exist + their scope + dependsOn); the
// event-log-derived state is the authority for STATUS (claims/merged/retired). One
// claimability encoding (claimableItems), applied to a tree-projected item set —
// so the tree-driven frontier can never silently re-encode the rule (review M1).
import type { PlanTree, PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import type { ItemScope } from '../events.js';
import { claimableItems, type DerivedState, type ItemState } from '../state.js';

const EPOCH = '1970-01-01T00:00:00.000Z';

interface LeafMeta {
  itemId?: string;
  scope?: ItemScope;
  dependsOn?: string[];
  title?: string;
}

function rootProductKey(tree: PlanTree): string {
  const root = tree.nodes.find((n) => n.id === tree.treeRootId);
  const pk = (root?.metadata as Record<string, unknown> | undefined)?.['productKey'];
  if (typeof pk !== 'string' || pk.length === 0) {
    throw new Error('plan tree root missing metadata.productKey (not drivable)');
  }
  return pk;
}

/** Rebuild DerivedState.items from the tree's work-item leaves: STRUCTURE from the
 *  tree leaf metadata, STATUS copied from the real log-derived state `s`. Every other
 *  concern (products, gates, …) is carried over from `s` unchanged. */
export function projectTreeState(tree: PlanTree, s: DerivedState): DerivedState {
  const productKey = rootProductKey(tree);
  const items = new Map<string, ItemState>();
  for (const n of tree.nodes as PlanNode[]) {
    if (n.kind !== 'work-item') continue;
    const m = n.metadata as unknown as LeafMeta;
    if (!m.itemId) throw new Error(`work-item leaf ${n.id} missing metadata.itemId`);
    if (!m.scope) throw new Error(`work-item leaf ${m.itemId} missing metadata.scope (not drivable)`);
    const prior = s.items.get(m.itemId);
    items.set(m.itemId, {
      itemId: m.itemId,
      productKey,
      epic: prior?.epic,
      title: m.title ?? prior?.title ?? m.itemId,
      scope: m.scope,                          // from tree (structure)
      lane: prior?.lane,
      dependsOn: m.dependsOn ?? [],            // from tree (structure)
      qualityObligations: prior?.qualityObligations ?? [],
      queuedAt: prior?.queuedAt ?? EPOCH,      // from log (status); EPOCH only for tree-only drift
      claims: prior?.claims ?? [],             // from log (status)
      merged: prior?.merged,                   // from log (status)
      retired: prior?.retired,                 // from log (status)
    });
  }
  return { ...s, items };
}

/** The tree-driven claimable frontier for the tree's product. */
export function planFrontier(tree: PlanTree, s: DerivedState, nowMs: number): ItemState[] {
  return claimableItems(projectTreeState(tree, s), nowMs);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/frontier.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Verify nothing else broke + commit**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (248 existing + 4 new).

```bash
git add src/plan/frontier.ts src/metamodel/vocabulary.ts test/frontier.test.ts
git commit -m "feat(foundry): planFrontier — tree-driven frontier (claimableItems ∘ projectTreeState)"
```

---

### Task 2: The `FrontierSource` seam (`nextItems` + `foundry_next`)

**Files:**
- Modify: `domains/foundry/src/ops.ts` (extend `nextItems` with a source selector)
- Modify: `domains/foundry/src/mcp/tools.ts` (wire the foundry tree for `source: 'plan'`)
- Test: `domains/foundry/test/frontier-seam.test.ts`

**Interfaces:**
- Consumes: `planFrontier` from `../plan/frontier.js`; `buildCascadeTree` from `../plan/cascade.js`; `FOUNDRY_PRODUCT` from `../instances/foundry-product.js`; existing `claimableItems`, `toNextItem`, `type NextItem`.
- Produces: `nextItems(deps, limit?, opts?: { source?: 'queue' | 'plan'; tree?: PlanTree }): NextItem[]`. `foundry_next` MCP tool accepts `{ limit?, source? }` and supplies the foundry tree when `source: 'plan'`.

- [ ] **Step 1: Write the failing test**

Create `domains/foundry/test/frontier-seam.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCascadeTree, type CascadeNodeSpec } from '../src/plan/cascade.js';
import { nextItems, queuePush, type FoundryDeps } from '../src/ops.js';

const T0 = '2026-06-17T12:00:00.000Z';
function testDeps(): FoundryDeps {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-seam-'));
  let n = 0;
  return { dataDir: dir, logPath: join(dir, 'events.jsonl'), now: () => T0, newId: () => `id-${++n}` };
}

const SPEC: CascadeNodeSpec[] = [
  { key: 'root', kind: 'product', parent: null, meta: { title: 'P', productKey: 'p' } },
  { key: 'wi-a', kind: 'work-item', parent: 'root',
    meta: { itemId: 'p/a', title: 'a', resource: 'ai', yields: [], status: 'queued', scope: { repo: 'r/p', issue: 1 }, dependsOn: [] } },
];

describe('frontier source seam', () => {
  it("default source 'queue' is unchanged", () => {
    const deps = testDeps();
    queuePush(deps, { product: { productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0' },
      items: [{ itemId: 'p/a', title: 'a', scope: { repo: 'r/p', issue: 1 } }] });
    expect(nextItems(deps, 5).map((i) => i.itemId)).toEqual(['p/a']);
  });

  it("source 'plan' derives the frontier from the tree", () => {
    const deps = testDeps();
    queuePush(deps, { product: { productKey: 'p', name: 'P', repo: 'r/p', riskTier: 'T0' },
      items: [{ itemId: 'p/a', title: 'a', scope: { repo: 'r/p', issue: 1 } }] });
    const tree = buildCascadeTree(SPEC);
    expect(nextItems(deps, 5, { source: 'plan', tree }).map((i) => i.itemId)).toEqual(['p/a']);
  });

  it("source 'plan' without a tree throws", () => {
    const deps = testDeps();
    expect(() => nextItems(deps, 5, { source: 'plan' })).toThrow(/requires a tree/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/frontier-seam.test.ts`
Expected: FAIL — `nextItems` does not accept a third argument / `source` ignored.

- [ ] **Step 3: Implement the seam in `ops.ts`**

Add the import near the other state imports in `domains/foundry/src/ops.ts`:

```ts
import type { PlanTree } from '@de-braighter/substrate-contracts/plan-tree';
import { planFrontier } from './plan/frontier.js';
```

Replace the existing `nextItems` function with the seam version (keep `toNextItem` and the doc-comment above it):

```ts
export interface NextItemsOpts { source?: 'queue' | 'plan'; tree?: PlanTree }

/** Lock-free advisory read: what a fresh session should pick up. The claim op
 *  re-validates everything under the lock, so a racing read is harmless.
 *  `source: 'plan'` derives the frontier from the kernel plan tree (the v1 driver);
 *  the default 'queue' is the unchanged bespoke-queue shadow. */
export function nextItems(deps: FoundryDeps, limit = 5, opts: NextItemsOpts = {}): NextItem[] {
  const ts = nowOf(deps);
  const nowMs = Date.parse(ts);
  const s = load(deps);
  let items;
  if (opts.source === 'plan') {
    if (!opts.tree) throw new Error("nextItems source 'plan' requires a tree");
    items = planFrontier(opts.tree, s, nowMs);
  } else {
    items = claimableItems(s, nowMs);
  }
  return items.slice(0, limit).map((i) => toNextItem(s, i));
}
```

- [ ] **Step 4: Wire the foundry tree into `foundry_next`**

In `domains/foundry/src/mcp/tools.ts`, add imports:

```ts
import { buildCascadeTree } from '../plan/cascade.js';
import { FOUNDRY_PRODUCT } from '../instances/foundry-product.js';
```

Replace the `foundry_next` line in `makeTools` with:

```ts
    foundry_next: guard((a: { limit?: number; source?: 'queue' | 'plan' }) =>
      ops.nextItems(deps, a.limit ?? 5, {
        source: a.source,
        tree: a.source === 'plan' ? buildCascadeTree(FOUNDRY_PRODUCT) : undefined,
      })),
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/frontier-seam.test.ts test/mcp-tools.test.ts`
Expected: PASS (seam tests green; existing mcp-tools tests still green — default behaviour unchanged).

> Note: `foundry_next({ source: 'plan' })` builds the tree from `FOUNDRY_PRODUCT`, which after Task 5 carries `scope`/`dependsOn` on every work-item leaf. Until Task 5, the foundry leaves lack `scope`, so a live `source:'plan'` call would throw "missing metadata.scope" — that is correct (the instance isn't drivable yet) and is why the seam tests above use a self-contained `SPEC`, not `FOUNDRY_PRODUCT`.

- [ ] **Step 6: Full suite + commit**

Run: `npm run typecheck && npm test`
Expected: all green.

```bash
git add src/ops.ts src/mcp/tools.ts test/frontier-seam.test.ts
git commit -m "feat(foundry): FrontierSource seam — foundry_next can drive off the plan tree (default queue)"
```

---

### Task 3: The divergence invariant — the acid test (built to bite)

**Files:**
- Create: `domains/foundry/test/frontier-divergence.test.ts`
- Create: `domains/foundry/test/fixtures/drivable-tree.ts` (shared by Tasks 3 + 4)

**Interfaces:**
- Consumes: `planFrontier` from `../src/plan/frontier.js`; `claimableItems`, `fold` from `../src/state.js`; the event constructors from `../src/events.js`; `buildCascadeTree`, `type CascadeNodeSpec` from `../src/plan/cascade.js`.
- Produces: `DRIVABLE_SPEC: CascadeNodeSpec[]`, `QUEUE_FIXTURE` (an independent explicit `QueuePushInput`), and `mutate(spec, kind)` helper — all exported from the fixtures file.

- [ ] **Step 1: Write the shared fixture (independent tree + queue declarations)**

The divergence test's power comes from **two independently-authored** structural declarations. Create `domains/foundry/test/fixtures/drivable-tree.ts`:

```ts
import type { CascadeNodeSpec } from '../../src/plan/cascade.js';
import type { QueuePushInput } from '../../src/ops.js';

/** The TREE declaration of structure (scope + deps on the leaves). */
export const DRIVABLE_SPEC: CascadeNodeSpec[] = [
  { key: 'root', kind: 'product', parent: null, meta: { title: 'Demo', productKey: 'demo' } },
  { key: 'cap', kind: 'capability', parent: 'root', meta: { title: 'cap' } },
  { key: 'feat', kind: 'feature', parent: 'cap', meta: { title: 'feat' } },
  { key: 'wi-a', kind: 'work-item', parent: 'feat',
    meta: { itemId: 'demo/a', title: 'a', resource: 'ai', yields: [], status: 'queued', scope: { repo: 'r/demo', issue: 1 }, dependsOn: [] } },
  { key: 'wi-b', kind: 'work-item', parent: 'feat',
    meta: { itemId: 'demo/b', title: 'b', resource: 'ai', yields: [], status: 'queued', scope: { repo: 'r/demo', issue: 2 }, dependsOn: ['demo/a'] } },
  { key: 'wi-c', kind: 'work-item', parent: 'feat',
    meta: { itemId: 'demo/c', title: 'c', resource: 'human', yields: [], status: 'queued', scope: { repo: 'r/demo', issue: 3 }, dependsOn: [] } },
];

/** The QUEUE declaration of the SAME structure — authored separately as explicit
 *  literals (NOT derived from DRIVABLE_SPEC). This independence is what makes the
 *  divergence test a real falsifier: perturb one side and the frontiers diverge. */
export const QUEUE_FIXTURE: QueuePushInput = {
  product: { productKey: 'demo', name: 'Demo', repo: 'r/demo', riskTier: 'T0' },
  items: [
    { itemId: 'demo/a', title: 'a', scope: { repo: 'r/demo', issue: 1 } },
    { itemId: 'demo/b', title: 'b', scope: { repo: 'r/demo', issue: 2 }, dependsOn: ['demo/a'] },
    { itemId: 'demo/c', title: 'c', scope: { repo: 'r/demo', issue: 3 } },
  ],
};

export type Mutation = 'drop-dep' | 'widen-scope' | 'remove-leaf' | 'flip-status';

/** Return a perturbed copy of the tree spec (the queue fixture is left untouched). */
export function mutate(spec: CascadeNodeSpec[], kind: Mutation): CascadeNodeSpec[] {
  const clone: CascadeNodeSpec[] = spec.map((n) => ({ ...n, meta: n.meta ? { ...n.meta } : undefined }));
  const leaf = (id: string) => clone.find((n) => (n.meta as any)?.itemId === id)!;
  switch (kind) {
    case 'drop-dep':    (leaf('demo/b').meta as any).dependsOn = []; return clone;                       // b no longer waits on a
    case 'widen-scope': (leaf('demo/c').meta as any).scope = { repo: 'r/demo' }; return clone;           // c claims the whole repo
    case 'remove-leaf': return clone.filter((n) => (n.meta as any)?.itemId !== 'demo/c');                // tree forgets c
    case 'flip-status': (leaf('demo/a').meta as any).status = 'done'; return clone;                      // descriptive only — must NOT diverge
  }
}
```

- [ ] **Step 2: Write the divergence test (battery + mutation + negative control)**

Create `domains/foundry/test/frontier-divergence.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCascadeTree } from '../src/plan/cascade.js';
import { planFrontier } from '../src/plan/frontier.js';
import { claim, queuePush, release, recordMerge, type FoundryDeps } from '../src/ops.js';
import { claimableItems, fold } from '../src/state.js';
import { readEnvelopes } from '../src/log.js';
import { DRIVABLE_SPEC, QUEUE_FIXTURE, mutate, type Mutation } from './fixtures/drivable-tree.js';

const T0 = '2026-06-17T12:00:00.000Z';
const T0ms = Date.parse(T0);
function testDeps(): FoundryDeps {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-div-'));
  let n = 0;
  return { dataDir: dir, logPath: join(dir, 'events.jsonl'), now: () => T0, newId: () => `id-${++n}` };
}
const stateOf = (deps: FoundryDeps) => fold(readEnvelopes(deps.logPath));

/** true = the two frontiers DISAGREE (set + order), restricted to the demo product. */
function diverged(deps: FoundryDeps): boolean {
  const s = stateOf(deps);
  const tree = buildCascadeTree(DRIVABLE_SPEC);
  const plan = planFrontier(tree, s, T0ms).map((i) => i.itemId);
  const queue = claimableItems(s, T0ms).filter((i) => i.productKey === 'demo').map((i) => i.itemId);
  return JSON.stringify(plan) !== JSON.stringify(queue);
}
function divergedWith(deps: FoundryDeps, spec: ReturnType<typeof mutate>): boolean {
  const s = stateOf(deps);
  const plan = planFrontier(buildCascadeTree(spec), s, T0ms).map((i) => i.itemId);
  const queue = claimableItems(s, T0ms).filter((i) => i.productKey === 'demo').map((i) => i.itemId);
  return JSON.stringify(plan) !== JSON.stringify(queue);
}

describe('divergence invariant: planFrontier(tree) ≡ claimableItems(queue)', () => {
  it('holds across the state battery (empty / claimed / done-unblocks / scope-conflict / retired)', () => {
    const deps = testDeps();
    queuePush(deps, QUEUE_FIXTURE);
    expect(diverged(deps)).toBe(false);                           // all queued
    const c = claim(deps, { itemId: 'demo/a', sessionId: 's1' }); // one claimed
    expect(diverged(deps)).toBe(false);
    release(deps, { claimId: c.claimId, outcome: 'built', prRef: 'r/demo#1' });
    recordMerge(deps, { itemId: 'demo/a', prRef: 'r/demo#1' });   // done unblocks demo/b
    expect(diverged(deps)).toBe(false);
    claim(deps, { itemId: 'demo/c', sessionId: 's2' });           // c claimed (scope busy)
    expect(diverged(deps)).toBe(false);
  });

  it('BITES: dropping a dependency from the tree diverges', () => {
    const deps = testDeps();
    queuePush(deps, QUEUE_FIXTURE);                               // demo/b waits on demo/a (queue says so)
    expect(divergedWith(deps, mutate(DRIVABLE_SPEC, 'drop-dep'))).toBe(true); // tree frees demo/b
  });

  it('BITES: widening a leaf scope to overlap an active claim diverges', () => {
    const deps = testDeps();
    queuePush(deps, QUEUE_FIXTURE);
    claim(deps, { itemId: 'demo/a', sessionId: 's1' });           // a active on issue 1
    // widen demo/c to whole repo -> tree sees c as conflicting with a; queue keeps c free
    expect(divergedWith(deps, mutate(DRIVABLE_SPEC, 'widen-scope'))).toBe(true);
  });

  it('BITES: a leaf the queue still has but the tree forgot diverges', () => {
    const deps = testDeps();
    queuePush(deps, QUEUE_FIXTURE);
    expect(divergedWith(deps, mutate(DRIVABLE_SPEC, 'remove-leaf'))).toBe(true);
  });

  it('NEGATIVE CONTROL: flipping descriptive leaf.status does NOT diverge (status is log-derived)', () => {
    const deps = testDeps();
    queuePush(deps, QUEUE_FIXTURE);
    // leaf.status feeds substance/completeness only; projectTreeState reads status from the log,
    // so flipping it must leave the frontier (and the invariant) unchanged.
    expect(divergedWith(deps, mutate(DRIVABLE_SPEC, 'flip-status'))).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails (or is incomplete)**

Run: `npx vitest run test/frontier-divergence.test.ts`
Expected: FAIL — fixtures file/import errors until Step 1's file exists and Tasks 1–2 are in place. (If Tasks 1–2 are committed, the failure is only the missing fixtures import; once both files exist the suite must turn green/red on assertions, not import errors.)

- [ ] **Step 4: Make it pass**

No new production code is needed — Tasks 1–2 already implement `planFrontier`/projection. Ensure the fixtures file (Step 1) and the test (Step 2) are saved, then re-run.

Run: `npx vitest run test/frontier-divergence.test.ts`
Expected: PASS — battery holds (`false`), three mutations bite (`true`), negative control stays `false`.

- [ ] **Step 5: Full suite + commit**

Run: `npm run typecheck && npm test`
Expected: all green.

```bash
git add test/fixtures/drivable-tree.ts test/frontier-divergence.test.ts
git commit -m "test(foundry): divergence invariant (kill-criterion) + mutation suite that bites"
```

---

### Task 4: The proof workflow — claim → build → gate → merge off `source: 'plan'`

**Files:**
- Create: `domains/foundry/test/frontier-proof-workflow.test.ts`

**Interfaces:**
- Consumes: `nextItems`, `claim`, `release`, `gateRequest`, `gateDecide`, `recordMerge` from `../src/ops.js`; `buildCascadeTree` from `../src/plan/cascade.js`; `DRIVABLE_SPEC`, `QUEUE_FIXTURE` from `./fixtures/drivable-tree.js`.
- Produces: (test only — no new production code).

- [ ] **Step 1: Write the proof-workflow test**

Create `domains/foundry/test/frontier-proof-workflow.test.ts`:

```ts
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCascadeTree } from '../src/plan/cascade.js';
import { claim, gateDecide, gateRequest, nextItems, recordMerge, release, type FoundryDeps } from '../src/ops.js';
import { DRIVABLE_SPEC, QUEUE_FIXTURE } from './fixtures/drivable-tree.js';

const T0 = '2026-06-17T12:00:00.000Z';
function testDeps(): FoundryDeps {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-proof-'));
  let n = 0;
  return { dataDir: dir, logPath: join(dir, 'events.jsonl'), now: () => T0, newId: () => `id-${++n}` };
}

describe('proof workflow: a real lifecycle driven off the plan tree', () => {
  it('claim → release(built) → gate → record_merge advances the tree frontier', () => {
    const deps = testDeps();
    // Seed the live log so the projected tree items resolve their status (claims/merge).
    // (queuePush registers the product + items; the tree supplies the frontier structure.)
    const { queuePush } = require('../src/ops.js');
    queuePush(deps, QUEUE_FIXTURE);
    const tree = buildCascadeTree(DRIVABLE_SPEC);

    // 1. Pull the frontier FROM THE TREE.
    const planNext = nextItems(deps, 5, { source: 'plan', tree });
    expect(planNext.map((i) => i.itemId)).toEqual(['demo/a', 'demo/c']); // demo/b blocked by demo/a

    // 2. Claim the head item (claim keys on itemId == leaf binding → a leaf node event).
    const c = claim(deps, { itemId: 'demo/a', sessionId: 's1' });
    // 3. Build → release as built with the PR ref.
    release(deps, { claimId: c.claimId, outcome: 'built', prRef: 'r/demo#1' });
    // 4. Founder ship-gate on the PRODUCT root node (gate keys on productKey).
    const g = gateRequest(deps, { productKey: 'demo', gateType: 'ship', payloadRef: 'demo/a | r/demo#1' });
    gateDecide(deps, { gateId: g.gateId, decision: 'approved' });
    // 5. Conductor records the merge (terminalizes the leaf).
    recordMerge(deps, { itemId: 'demo/a', prRef: 'r/demo#1' });

    // 6. The tree frontier ADVANCED by re-derivation: demo/a gone, demo/b unblocked.
    const after = nextItems(deps, 5, { source: 'plan', tree });
    expect(after.map((i) => i.itemId)).toEqual(['demo/b', 'demo/c']);
  });

  it("the 'plan'-driven frontier equals what 'queue' would have produced at each step", () => {
    const deps = testDeps();
    const { queuePush } = require('../src/ops.js');
    queuePush(deps, QUEUE_FIXTURE);
    const tree = buildCascadeTree(DRIVABLE_SPEC);
    const ids = (src: 'queue' | 'plan') =>
      nextItems(deps, 5, src === 'plan' ? { source: 'plan', tree } : {}).map((i) => i.itemId).filter((x) => x.startsWith('demo/'));
    expect(ids('plan')).toEqual(ids('queue'));
    const c = claim(deps, { itemId: 'demo/a', sessionId: 's1' });
    release(deps, { claimId: c.claimId, outcome: 'built', prRef: 'r/demo#1' });
    recordMerge(deps, { itemId: 'demo/a', prRef: 'r/demo#1' });
    expect(ids('plan')).toEqual(ids('queue'));
  });
});
```

> Note on `require`: the foundry package is ESM. Prefer a top-level `import { queuePush } from '../src/ops.js';` over `require` — adjust the import list at the top of the file and delete the two `const { queuePush } = require(...)` lines. (Shown inline only to keep each test self-contained for an out-of-order reader.)

- [ ] **Step 2: Fix the imports (ESM)**

Replace the two `const { queuePush } = require('../src/ops.js');` lines by adding `queuePush` to the top `import { … } from '../src/ops.js';` list.

- [ ] **Step 3: Run the test**

Run: `npx vitest run test/frontier-proof-workflow.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Full suite + commit**

Run: `npm run typecheck && npm test`
Expected: all green.

```bash
git add test/frontier-proof-workflow.test.ts
git commit -m "test(foundry): proof workflow — claim→build→gate→merge driven off the plan tree"
```

---

### Task 5: Make the real `FOUNDRY_PRODUCT` instance drivable

**Files:**
- Modify: `domains/foundry/src/instances/foundry-product.ts` (add `productKey` to root; `scope` + `dependsOn` to every work-item leaf; add the queued Phase-B story leaf)
- Modify: `domains/foundry/src/metamodel/vocabulary.ts` (add `validateDrivable`)
- Test: `domains/foundry/test/instance-foundry-drivable.test.ts`

**Interfaces:**
- Consumes: `buildCascadeTree` from `../plan/cascade.js`; `projectTreeState` from `../plan/frontier.js`.
- Produces: `validateDrivable(spec: CascadeNodeSpec[]): string[]` — returns one error string per work-item leaf missing `scope` (empty array = fully drivable).

- [ ] **Step 1: Write the failing test**

Create `domains/foundry/test/instance-foundry-drivable.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildCascadeTree } from '../src/plan/cascade.js';
import { projectTreeState } from '../src/plan/frontier.js';
import { validateDrivable, validateInstance, vocabularyOf } from '../src/metamodel/vocabulary.js';
import { FOUNDRY_PRODUCT } from '../src/instances/foundry-product.js';
import { fold } from '../src/state.js';

describe('Product(foundry) is drivable off the plan tree', () => {
  it('every work-item leaf declares scope + dependsOn (validateDrivable passes)', () => {
    expect(validateDrivable(FOUNDRY_PRODUCT)).toEqual([]);
  });
  it('still a valid metamodel instance with the original four kinds', () => {
    expect(validateInstance(FOUNDRY_PRODUCT)).toEqual([]);
    expect([...vocabularyOf(FOUNDRY_PRODUCT).kinds].sort())
      .toEqual(['capability', 'feature', 'product', 'work-item']);
  });
  it('projects without throwing (tree is frontier-ready)', () => {
    const tree = buildCascadeTree(FOUNDRY_PRODUCT);
    expect(() => projectTreeState(tree, fold([]))).not.toThrow();
  });
  it('carries the in-flight Phase-B story as a queued leaf', () => {
    const phaseB = FOUNDRY_PRODUCT.find((n) => (n.meta as any)?.itemId === 'foundry/v1-phaseB-log-collapse');
    expect(phaseB).toBeDefined();
    expect((phaseB!.meta as any).status).toBe('queued');
    expect((phaseB!.meta as any).scope).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/instance-foundry-drivable.test.ts`
Expected: FAIL — `validateDrivable` is not exported; the foundry leaves lack `scope`.

- [ ] **Step 3: Add `validateDrivable` to `vocabulary.ts`**

Append to `domains/foundry/src/metamodel/vocabulary.ts`:

```ts
/** Drivability check: a tree the conductor drives off must declare scope (and may
 *  declare dependsOn) on every work-item leaf. Separate from validateInstance so the
 *  descriptive-only instances (e.g. whales) stay valid without being drivable. */
export function validateDrivable(spec: CascadeNodeSpec[]): string[] {
  const errs: string[] = [];
  for (const n of spec) {
    if (n.kind !== 'work-item') continue;
    const m = wi(n);
    if (!m?.itemId) errs.push(`work-item missing itemId (node ${n.key})`);
    if (!m?.scope) errs.push(`work-item missing scope (node ${n.key})`);
  }
  return errs;
}
```

- [ ] **Step 4: Make `FOUNDRY_PRODUCT` drivable**

In `domains/foundry/src/instances/foundry-product.ts`:

(a) Add `productKey` to the root node's `meta`:

```ts
  {
    key: 'foundry',
    kind: 'product',
    parent: null,
    meta: {
      title: 'Foundry — the autonomous product-creation machine',
      productKey: 'foundry',
    },
  },
```

(b) Add `scope` + `dependsOn` to **every** existing work-item leaf's `meta`. These eight leaves are all `status: 'done'` — they never become claimable, so their scope is descriptive-only and **scope-disjointness among them is irrelevant** (only active claims gate disjointness, and a done item has none). So scope each to its **real** primary source area; do **not** invent file paths. `dependsOn` is `[]` (independent shipped work). Example for the first leaf (`story-pool-auto`):

```ts
  {
    key: 'story-pool-auto',
    kind: 'work-item',
    parent: 'feat-warm-pool',
    meta: {
      title: 'Warm-pool auto-engagement (per-slot lease)',
      itemId: 'foundry/slice3-1',
      resource: 'ai',
      status: 'done',
      yields: [{ kind: 'pack', id: 'slot-lease-primitive' }],
      scope: { repo: 'de-braighter/foundry', pathPrefix: 'src/wt-pool.ts' },
      dependsOn: [],
    },
  },
```

Use these `pathPrefix` values, all **real** existing paths (overlap is fine — these are done items): `story-pool-auto`→`src/wt-pool.ts`; `story-retire`→`src/ops.ts`; `story-presence`→`src/ops.ts`; `story-ledger-scan`→`src/derivations/`; `story-suppress-fp`→`src/metamodel/`; `story-effect-parser`→`src/derivations/cycle-time.ts`; `story-conductor-gate-decide`→`src/ops.ts`; `story-pool-enqueue`→`src/mcp/`. (Verify each against the actual `domains/foundry/src/` tree before writing.)

(c) Add the in-flight Phase-B story as a new **queued** leaf under a new feature on `cap-scale` (or reuse `feat-conductor`):

```ts
  {
    key: 'feat-twin-absorption',
    kind: 'feature',
    parent: 'cap-scale',
    meta: { title: 'Twin absorption — one canonical log' },
  },
  {
    key: 'story-v1-phaseB-log-collapse',
    kind: 'work-item',
    parent: 'feat-twin-absorption',
    meta: {
      title: 'Collapse devloop + foundry event logs into one canonical log; retire devloop',
      itemId: 'foundry/v1-phaseB-log-collapse',
      resource: 'ai',
      status: 'queued',
      yields: [{ kind: 'policy', id: 'one-canonical-log' }],
      scope: { repo: 'de-braighter/foundry', pathPrefix: 'src/twin/' },
      dependsOn: [],
    },
  },
```

- [ ] **Step 5: Run the drivable test + the existing instance/replay/genericity tests**

Run: `npx vitest run test/instance-foundry-drivable.test.ts test/instance-foundry.test.ts test/replay-determinism.test.ts test/genericity-acid.test.ts test/metamodel-vocabulary.test.ts`
Expected: PASS — drivable passes; kinds unchanged (still the four); `deriveSubstance`/`completeness` still stable (the new queued leaf adds a *declared-not-landed* substance, which only changes the value, not stability — no test pins the value); whales genericity untouched (scope/deps aren't in `vocabularyOf`).

- [ ] **Step 6: Full suite + commit**

Run: `npm run ci:local`
Expected: typecheck clean; full suite + coverage green.

```bash
git add src/instances/foundry-product.ts src/metamodel/vocabulary.ts test/instance-foundry-drivable.test.ts
git commit -m "feat(foundry): make Product(foundry) drivable — leaf scope/deps + validateDrivable + in-flight Phase-B story"
```

---

### Task 6: Phase-A design-local ADR (separate repo: `layers/specs`)

**Files:**
- Create: `layers/specs/adr/adr-244-foundry-conductor-drives-plan-tree-frontier.md` (verify the number — see Step 1)
- Modify: `layers/specs/adr/adrs-by-tier.md` (add the new ADR under Design-local)

**Interfaces:** none (documentation). Follow the workbench ADR template + ADR-181 frontmatter governance.

- [ ] **Step 1: Verify the next free ADR number**

Run (from cluster root): `ls layers/specs/adr/ | grep -oE 'adr-[0-9]+' | sort -t- -k2 -n | tail -1`
Expected: highest existing is `adr-243`. Use `adr-244` unless a higher number now exists; if so, use max+1 and adjust the filename/title accordingly.

- [ ] **Step 2: Write the ADR**

Create `layers/specs/adr/adr-244-foundry-conductor-drives-plan-tree-frontier.md` with frontmatter mirroring ADR-243 (status `accepted`, `tier: design-local`, `scope: foundry`, `date: 2026-06-17`, `decision-makers: [stibe]`, `relates-to` ADR-241/242/243/176/127/194). Body sections: Status; Context (the v0 two-sources split, located in code — queue DAG vs descriptive tree); Decision (the conductor's frontier derives from the plan tree via `planFrontier = claimableItems ∘ projectTreeState`; structure-from-tree, status-from-log; the bespoke queue is a divergence-gated shadow; default `source` stays `'queue'`; claim/merge bind to the leaf, gate to the product root); ADR-176 verdict (adds nothing to the kernel — rides `kind`+`metadata`; inclusion test passes by exclusion, one consumer); the divergence-invariant-as-enforced-pattern (sibling of ADR-243); Alternatives (rewire in place — rejected; identity-unification — rejected as heavier; tree-as-read-only-lens — rejected as not真 driving); Consequences (Phase B log-collapse named as the deferred follow-up per ADR-241 §3). Reference the spec + this plan.

- [ ] **Step 3: Add the index entry**

In `layers/specs/adr/adrs-by-tier.md`, add a one-line entry for ADR-244 under the Design-local section, matching the existing row format.

- [ ] **Step 4: Lint + spec-audit**

Run the specs body lint if available (`bash tools/lint-md.sh` from `layers/specs`, or the repo's documented markdownlint command) and a `spec-auditor` pass (cross-refs, numbering, frontmatter). Fix any flagged issues.

- [ ] **Step 5: Commit (in the specs repo)**

```bash
git add adr/adr-244-foundry-conductor-drives-plan-tree-frontier.md adr/adrs-by-tier.md
git commit -m "docs(adr): ADR-244 — foundry conductor drives off the plan-tree frontier (Phase A)"
```

---

## Self-Review

**1. Spec coverage:**
- §2 decisions → reflected in Tasks 1–5 (seam default `'queue'` = V1-D2/D4; tree-authority binding = V1-D3) and the ADR (Task 6).
- §3 seam → Task 2. §4 metamodel change (`scope`/`dependsOn` on leaf; `planFrontier`) → Tasks 1 + 5. §5 acid test (battery + mutation + negative control) → Task 3. §6 proof workflow → Task 4. §7 Phase B → authored as the in-flight queued leaf (Task 5) + named in the ADR (Task 6); **build deferred** (correct — Phase A only). §8 governance + ADR triggers → Task 6.
- Gap check: §5's "replay determinism of `planFrontier`" — covered implicitly (pure fold, no `Date.now`/`Math.random`; constraint stated). The proof + divergence tests recompute deterministically. No dedicated replay test added (the existing `replay-determinism.test.ts` pattern covers the derivations; `planFrontier` purity is enforced by the no-`Date.now` constraint + Task 1's deterministic tests). Acceptable.

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to". Every code step shows full code; every test step shows the assertions.

**3. Type consistency:** `projectTreeState(tree, s)` / `planFrontier(tree, s, nowMs)` signatures match across Tasks 1–4. `NextItemsOpts { source?, tree? }` consistent between `ops.ts` (Task 2) and the seam tests. `validateDrivable(spec): string[]` consistent (Task 5). `WorkItemMeta.scope?: ItemScope` (Task 1) matches the leaf authoring (Task 5) and the projection read (Task 1). The `mutate`/`Mutation` helper (Task 3 fixture) matches its use in the divergence test.

---

## Execution Handoff

Per the brief's HOW and the user's standing instruction (always subagent-driven execution): Tasks 1–5 land as one `domains/foundry` PR (`Closes #<phase-A story>`); Task 6 lands as a separate `layers/specs` PR. After implementation, run the **verifier wave** (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`, isolation `worktree`) on the foundry PR, then the **whole-branch review** on the final diff (the pass that caught v0's non-deterministic posterior). Each PR carries `Producer:` / `Effort:` / `Effect:` lines and runs the twin ritual (`drain` → `backfill` → `reconcile`) after merge.
