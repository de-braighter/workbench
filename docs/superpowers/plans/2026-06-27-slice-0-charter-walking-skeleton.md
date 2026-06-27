# Slice 0 — Charter Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove end-to-end that a recursive Charter Node (governance contract on `PlanNode.metadata`) round-trips through the real `kernel.plan_node` store, inherits fail-closed, and runs one event-sourced lifecycle pass — with zero kernel production change.

**Architecture:** A new pure-TS layer `@de-braighter/charter-runtime` (cloned at `layers/charter-runtime`) holds a typed *lens* over the kernel `PlanNode` (contract under `metadata.charter`), a fail-closed `scope` narrow-only inheritance validator, and a one-pass event-sourced lifecycle with a closed `ACTION_REGISTRY`. The kernel round-trip is proven two ways: a fast fake-delegate round-trip (charter layer) and a real-Postgres round-trip of a generic metadata-rich tree (a new spec added to `layers/substrate`, charter-agnostic so the kernel stays untouched).

**Tech Stack:** TypeScript (ESM/NodeNext), Zod, Vitest; `@de-braighter/substrate-contracts@^2.7` (`PlanTree`/`PlanNode`/`PlanTreeSchema`) + `@de-braighter/substrate-runtime` (`PrismaPlanTreeStore`); Postgres via the substrate DB-test harness.

**Repo setup (DONE):** `de-braighter/charter-runtime` created (private) and SSH-cloned to `layers/charter-runtime` (branch `main`, README only). All charter-layer work happens in that clone; Task 8 happens in `layers/substrate`.

## Global Constraints

- **ESM/NodeNext** — every relative import carries an explicit `.js` extension (e.g. `from './charter-node.js'`). `package.json` has `"type": "module"`.
- **Zero kernel production change** — these paths in `layers/substrate` MUST stay byte-identical vs `origin/main`: `libs/substrate-contracts/src/plan-tree/plan-tree-schemas.ts`, `libs/substrate-contracts/src/plan-tree/plan-tree-store.port.ts`, `libs/substrate-runtime/src/plan-tree/prisma-plan-tree.store.ts`, and any `kernel.plan_node` migration. Adding a *test* file is allowed.
- **No charter vocabulary under `layers/substrate`** — the substrate-side spec (Task 8) uses a generic metadata-rich tree; it never imports or names `charter`/`CharterContract`/role values.
- **Contract on `metadata.charter`** — never extend the kernel `PlanNode` schema. Reserved metadata keys `__kindRef` / `__tenantPackId` MUST NOT be used by charter nodes. Every charter node sets `kindRef` to `charter:<role>` (non-empty, satisfies the kernel `.min(1)`).
- **Replay-stable** — no `Date.now()` / `new Date()` / `Math.random()` in the fold or lifecycle path; `occurredAt` and ids are injected by the caller.
- **Branch discipline** — work on a feature branch in `layers/charter-runtime`; the plan doc + spec live in the workbench on `docs/plan-tree-runtime-blueprint-program`. Commit frequently. Do NOT run git ops in shared clones other than the one you own.

---

## File Structure

In `layers/charter-runtime/`:
- `package.json`, `tsconfig.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore` — scaffolding (Task 1)
- `src/index.ts` — public surface re-exports
- `src/charter-node.ts` — the typed lens (`CharterContract`, `CharterRole`, `readCharter`, `writeCharter`) (Task 2)
- `src/charter-node.spec.ts`
- `src/inheritance.ts` — `validateInheritance`, `effectiveScope`, `InheritanceViolation` (Task 3)
- `src/inheritance.spec.ts`
- `src/lifecycle.ts` — `CharterEvent`, `ACTION_REGISTRY`, `runLifecyclePass`, `foldCharterState` (Task 4)
- `src/lifecycle.spec.ts`
- `src/fixtures.ts` — `productTaskCharterTree` (test helper, exported) (Task 5)
- `src/store-readiness.spec.ts` — kernel-valid + preconditions (Task 5)
- `src/kernel-roundtrip.spec.ts` — fake-delegate round-trip (Task 6)
- `src/e2e-capstone.spec.ts` — capstone (Task 7)
- `src/boundary-acid.spec.ts` — import-boundary acid (Task 7)

In `layers/substrate/`:
- `libs/substrate-runtime/src/plan-tree/prisma-plan-tree.store.db.spec.ts` — real-DB round-trip (Task 8)

---

### Task 1: Scaffold `@de-braighter/charter-runtime`

**Files:**
- Create: `layers/charter-runtime/package.json`
- Create: `layers/charter-runtime/tsconfig.json`
- Create: `layers/charter-runtime/tsconfig.build.json`
- Create: `layers/charter-runtime/vitest.config.ts`
- Create: `layers/charter-runtime/.gitignore`
- Create: `layers/charter-runtime/src/index.ts`
- Create: `layers/charter-runtime/src/smoke.spec.ts`

**Interfaces:**
- Produces: a building, test-running pure-TS ESM lib that later tasks fill in.

- [ ] **Step 1: Create a feature branch**

```bash
cd layers/charter-runtime
git checkout -b feat/slice-0-walking-skeleton
```

- [ ] **Step 2: Resolve the real published versions of the @de-braighter deps**

```bash
pnpm view @de-braighter/substrate-contracts version
pnpm view @de-braighter/substrate-runtime version
```
Use the printed versions (caret-ranged) in `package.json` below in place of `^2.7.0` / `^2.0.0` if they differ.

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "@de-braighter/charter-runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "ci:local": "tsc -p tsconfig.json --noEmit && vitest run"
  },
  "dependencies": { "zod": "^3.23.8" },
  "peerDependencies": { "@de-braighter/substrate-contracts": "^2.7.0" },
  "devDependencies": {
    "@de-braighter/substrate-contracts": "^2.7.0",
    "@de-braighter/substrate-runtime": "^2.0.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 4: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 5: Write `tsconfig.build.json`**

```json
{ "extends": "./tsconfig.json", "exclude": ["src/**/*.spec.ts"] }
```

- [ ] **Step 6: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { globals: true, environment: 'node', include: ['src/**/*.spec.ts'] },
});
```

- [ ] **Step 7: Write `.gitignore`**

```gitignore
node_modules/
dist/
*.tsbuildinfo
```

- [ ] **Step 8: Write `src/index.ts` (placeholder export so the build has an entry)**

```ts
export const CHARTER_RUNTIME = '@de-braighter/charter-runtime';
```

- [ ] **Step 9: Write `src/smoke.spec.ts`**

```ts
import { CHARTER_RUNTIME } from './index.js';

describe('scaffold', () => {
  it('exports the package marker', () => {
    expect(CHARTER_RUNTIME).toBe('@de-braighter/charter-runtime');
  });
});
```

- [ ] **Step 10: Install + verify build/test**

```bash
pnpm install
pnpm run ci:local
```
Expected: typecheck clean; 1 test passes.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore(charter-runtime): scaffold ESM TS lib (build + vitest)"
```

---

### Task 2: Charter Node typed lens

**Files:**
- Create: `layers/charter-runtime/src/charter-node.ts`
- Test: `layers/charter-runtime/src/charter-node.spec.ts`

**Interfaces:**
- Consumes: `PlanNode` (type) from `@de-braighter/substrate-contracts/plan-tree`.
- Produces:
  - `type CharterRole = 'product' | 'task'`
  - `interface CharterContract { role: CharterRole; mission: { objective: string; outcome: string }; scope: { allowedPathPrefixes: readonly string[] } }`
  - `CharterContractSchema: ZodType<CharterContract>`
  - `readCharter(node: PlanNode): CharterContract | null` — null if absent; **throws** if present-but-malformed (fail-closed)
  - `writeCharter(node: PlanNode, c: CharterContract): PlanNode`

- [ ] **Step 1: Write the failing test**

```ts
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import { readCharter, writeCharter, type CharterContract } from './charter-node.js';

const baseNode = (): PlanNode => ({
  id: '11111111-1111-4111-8111-111111111111',
  parentId: null,
  treeRootId: '11111111-1111-4111-8111-111111111111',
  kind: 'product',
  kindRef: 'charter:product',
  ordinal: 0,
  metadata: {},
  childrenIds: [],
});

const contract: CharterContract = {
  role: 'product',
  mission: { objective: 'o', outcome: 'r' },
  scope: { allowedPathPrefixes: ['docs/'] },
};

describe('charter-node lens', () => {
  it('writeCharter then readCharter round-trips the contract', () => {
    const node = writeCharter(baseNode(), contract);
    expect(readCharter(node)).toEqual(contract);
  });

  it('readCharter returns null when no charter is present', () => {
    expect(readCharter(baseNode())).toBeNull();
  });

  it('writeCharter does not mutate the input node', () => {
    const node = baseNode();
    writeCharter(node, contract);
    expect(node.metadata).toEqual({});
  });

  it('readCharter throws when the charter key is present but malformed (fail-closed)', () => {
    const bad = { ...baseNode(), metadata: { charter: { role: 'product' } } };
    expect(() => readCharter(bad as PlanNode)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/charter-node.spec.ts`
Expected: FAIL — cannot find module `./charter-node.js`.

- [ ] **Step 3: Write `src/charter-node.ts`**

```ts
import { z } from 'zod';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';

export const CharterRoleSchema = z.enum(['product', 'task']);
export type CharterRole = z.infer<typeof CharterRoleSchema>;

export const CharterContractSchema = z.object({
  role: CharterRoleSchema,
  mission: z.object({ objective: z.string().min(1), outcome: z.string().min(1) }),
  scope: z.object({ allowedPathPrefixes: z.array(z.string().min(1)).readonly() }),
});
export type CharterContract = z.infer<typeof CharterContractSchema>;

/** The single metadata key the charter contract lives under (distinct from the
 *  kernel's reserved top-level `__kindRef` / `__tenantPackId`). */
export const CHARTER_METADATA_KEY = 'charter';

/** Absent → null; present-but-malformed → throws (fail-closed). */
export function readCharter(node: PlanNode): CharterContract | null {
  const raw = node.metadata[CHARTER_METADATA_KEY];
  if (raw === undefined) return null;
  return CharterContractSchema.parse(raw);
}

export function writeCharter(node: PlanNode, contract: CharterContract): PlanNode {
  return {
    ...node,
    metadata: { ...node.metadata, [CHARTER_METADATA_KEY]: contract },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/charter-node.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Export from the barrel + commit**

Replace `src/index.ts` body with:
```ts
export * from './charter-node.js';
```
Run: `pnpm run ci:local` (expected: clean).
```bash
git add -A
git commit -m "feat(charter-runtime): Charter Node typed lens over PlanNode.metadata"
```

---

### Task 3: Fail-closed scope inheritance

**Files:**
- Create: `layers/charter-runtime/src/inheritance.ts`
- Test: `layers/charter-runtime/src/inheritance.spec.ts`

**Interfaces:**
- Consumes: `CharterContract` from `./charter-node.js`.
- Produces:
  - `interface InheritanceViolation { field: 'scope'; reason: string }`
  - `validateInheritance(parent: CharterContract, child: CharterContract): { ok: true } | { ok: false; violation: InheritanceViolation }`
  - `effectiveScope(chain: readonly CharterContract[]): { allowedPathPrefixes: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
import { validateInheritance, effectiveScope } from './inheritance.js';
import type { CharterContract } from './charter-node.js';

const c = (prefixes: string[]): CharterContract => ({
  role: 'task',
  mission: { objective: 'o', outcome: 'r' },
  scope: { allowedPathPrefixes: prefixes },
});

describe('scope inheritance (narrow-only, fail-closed)', () => {
  it('accepts a child whose prefixes are within the parent', () => {
    const r = validateInheritance(c(['src/']), c(['src/charter/']));
    expect(r.ok).toBe(true);
  });

  it('accepts equal scope', () => {
    expect(validateInheritance(c(['src/']), c(['src/'])).ok).toBe(true);
  });

  it('REJECTS a child that widens beyond the parent (the fail-closed bite)', () => {
    const r = validateInheritance(c(['src/charter/']), c(['src/']));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.violation.field).toBe('scope');
      expect(r.violation.reason).toContain('src/');
    }
  });

  it('REJECTS a child with a disjoint prefix', () => {
    expect(validateInheritance(c(['src/']), c(['docs/'])).ok).toBe(false);
  });

  it('effectiveScope narrows down the chain to the deepest set', () => {
    const eff = effectiveScope([c(['src/', 'docs/']), c(['src/charter/'])]);
    expect(eff.allowedPathPrefixes).toEqual(['src/charter/']);
  });

  it('effectiveScope of an empty chain is empty', () => {
    expect(effectiveScope([]).allowedPathPrefixes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/inheritance.spec.ts`
Expected: FAIL — cannot find module `./inheritance.js`.

- [ ] **Step 3: Write `src/inheritance.ts`**

```ts
import type { CharterContract } from './charter-node.js';

export interface InheritanceViolation {
  field: 'scope';
  reason: string;
}

/** A child path prefix is permitted iff it equals or sits under some parent prefix. */
function isCoveredBy(childPrefix: string, parentPrefixes: readonly string[]): boolean {
  return parentPrefixes.some(
    (p) => childPrefix === p || childPrefix.startsWith(p),
  );
}

export function validateInheritance(
  parent: CharterContract,
  child: CharterContract,
): { ok: true } | { ok: false; violation: InheritanceViolation } {
  const parentPrefixes = parent.scope.allowedPathPrefixes;
  for (const childPrefix of child.scope.allowedPathPrefixes) {
    if (!isCoveredBy(childPrefix, parentPrefixes)) {
      return {
        ok: false,
        violation: {
          field: 'scope',
          reason: `child path prefix "${childPrefix}" is not within parent scope [${parentPrefixes.join(', ')}]`,
        },
      };
    }
  }
  return { ok: true };
}

/** The running intersection down the ancestor chain (root → … → leaf), derived. */
export function effectiveScope(
  chain: readonly CharterContract[],
): { allowedPathPrefixes: string[] } {
  if (chain.length === 0) return { allowedPathPrefixes: [] };
  let acc = [...chain[0].scope.allowedPathPrefixes];
  for (let i = 1; i < chain.length; i++) {
    const childPrefixes = chain[i].scope.allowedPathPrefixes;
    acc = childPrefixes.filter((cp) =>
      acc.some((ap) => cp === ap || cp.startsWith(ap)),
    );
  }
  return { allowedPathPrefixes: acc };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/inheritance.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Export + commit**

Append to `src/index.ts`:
```ts
export * from './inheritance.js';
```
Run: `pnpm run ci:local`.
```bash
git add -A
git commit -m "feat(charter-runtime): fail-closed scope narrow-only inheritance + effectiveScope"
```

---

### Task 4: Event-sourced lifecycle pass

**Files:**
- Create: `layers/charter-runtime/src/lifecycle.ts`
- Test: `layers/charter-runtime/src/lifecycle.spec.ts`

**Interfaces:**
- Consumes: `PlanNode` (type) from contracts; `readCharter` (`./charter-node.js`); `validateInheritance` (`./inheritance.js`); `CharterContract`.
- Produces:
  - `interface CharterEvent { type: 'charter:NoteRecorded.v1'; nodeId: string; payload: { note: string }; occurredAt: string }`
  - `type ActionKind = 'record-note'`
  - `const ACTION_REGISTRY: ReadonlyMap<ActionKind, (ctx: { nodeId: string; note: string; occurredAt: string }) => CharterEvent[]>`
  - `type Resolution = 'done' | 'blocked' | 'rejected'`
  - `interface LifecycleContext { parent: CharterContract | null; action: { kind: ActionKind; note: string }; occurredAt: string }`
  - `runLifecyclePass(node: PlanNode, ctx: LifecycleContext): { events: CharterEvent[]; resolution: Resolution }`
  - `interface ProjectedState { notesByNode: Record<string, string[]> }`
  - `foldCharterState(events: readonly CharterEvent[]): ProjectedState`

- [ ] **Step 1: Write the failing test**

```ts
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import { writeCharter, type CharterContract } from './charter-node.js';
import {
  runLifecyclePass,
  foldCharterState,
  ACTION_REGISTRY,
  type LifecycleContext,
} from './lifecycle.js';

const ID = '22222222-2222-4222-8222-222222222222';
const childContract: CharterContract = {
  role: 'task',
  mission: { objective: 'o', outcome: 'r' },
  scope: { allowedPathPrefixes: ['src/charter/'] },
};
const parentContract: CharterContract = {
  role: 'product',
  mission: { objective: 'o', outcome: 'r' },
  scope: { allowedPathPrefixes: ['src/'] },
};
const node = (): PlanNode =>
  writeCharter(
    {
      id: ID,
      parentId: null,
      treeRootId: ID,
      kind: 'task',
      kindRef: 'charter:task',
      ordinal: 0,
      metadata: {},
      childrenIds: [],
    },
    childContract,
  );
const ctx = (over: Partial<LifecycleContext> = {}): LifecycleContext => ({
  parent: parentContract,
  action: { kind: 'record-note', note: 'hello' },
  occurredAt: '2026-06-27T00:00:00.000Z',
  ...over,
});

describe('uniform lifecycle pass', () => {
  it('runs intake→validate→execute→record→resolve and emits one event', () => {
    const r = runLifecyclePass(node(), ctx());
    expect(r.resolution).toBe('done');
    expect(r.events).toEqual([
      {
        type: 'charter:NoteRecorded.v1',
        nodeId: ID,
        payload: { note: 'hello' },
        occurredAt: '2026-06-27T00:00:00.000Z',
      },
    ]);
  });

  it('REJECTS when the child violates parent scope (fail-closed)', () => {
    const widening = { ...parentContract, scope: { allowedPathPrefixes: ['src/charter/'] } };
    const r = runLifecyclePass(node(), ctx({ parent: widening }));
    expect(r.resolution).toBe('rejected');
    expect(r.events).toEqual([]);
  });

  it('REJECTS a node with no charter', () => {
    const bare: PlanNode = {
      id: ID, parentId: null, treeRootId: ID, kind: 'task',
      kindRef: 'charter:task', ordinal: 0, metadata: {}, childrenIds: [],
    };
    expect(runLifecyclePass(bare, ctx()).resolution).toBe('rejected');
  });

  it('throws on an unknown action kind', () => {
    expect(() =>
      // @ts-expect-error — deliberately invalid kind
      runLifecyclePass(node(), ctx({ action: { kind: 'nope', note: 'x' } })),
    ).toThrow(/unknown action kind/);
  });

  it('fold is deterministic and duplicate-append safe (replay acid)', () => {
    const { events } = runLifecyclePass(node(), ctx());
    const once = foldCharterState(events);
    const twice = foldCharterState([...events, ...events]);
    expect(twice).toEqual(once);
    expect(once.notesByNode[ID]).toEqual(['hello']);
  });

  it('the registry holds exactly the record-note action', () => {
    expect([...ACTION_REGISTRY.keys()]).toEqual(['record-note']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lifecycle.spec.ts`
Expected: FAIL — cannot find module `./lifecycle.js`.

- [ ] **Step 3: Write `src/lifecycle.ts`**

```ts
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import { readCharter, type CharterContract } from './charter-node.js';
import { validateInheritance } from './inheritance.js';

export interface CharterEvent {
  type: 'charter:NoteRecorded.v1';
  nodeId: string;
  payload: { note: string };
  occurredAt: string;
}

export type ActionKind = 'record-note';
interface ActionInput {
  nodeId: string;
  note: string;
  occurredAt: string;
}
type Handler = (input: ActionInput) => CharterEvent[];

export const ACTION_REGISTRY: ReadonlyMap<ActionKind, Handler> = new Map<
  ActionKind,
  Handler
>([
  [
    'record-note',
    (input) => [
      {
        type: 'charter:NoteRecorded.v1',
        nodeId: input.nodeId,
        payload: { note: input.note },
        occurredAt: input.occurredAt,
      },
    ],
  ],
]);

export type Resolution = 'done' | 'blocked' | 'rejected';

export interface LifecycleContext {
  parent: CharterContract | null;
  action: { kind: ActionKind; note: string };
  occurredAt: string;
}

export function runLifecyclePass(
  node: PlanNode,
  ctx: LifecycleContext,
): { events: CharterEvent[]; resolution: Resolution } {
  // intake
  const charter = readCharter(node);
  if (charter === null) return { events: [], resolution: 'rejected' };
  // validate (inheritance, when a parent is in context)
  if (ctx.parent) {
    const verdict = validateInheritance(ctx.parent, charter);
    if (!verdict.ok) return { events: [], resolution: 'rejected' };
  }
  // execute (dispatch the declared action kind)
  const handler = ACTION_REGISTRY.get(ctx.action.kind);
  if (!handler) throw new Error(`unknown action kind: ${ctx.action.kind}`);
  const events = handler({
    nodeId: node.id,
    note: ctx.action.note,
    occurredAt: ctx.occurredAt,
  });
  // record + resolve
  return { events, resolution: 'done' };
}

export interface ProjectedState {
  notesByNode: Record<string, string[]>;
}

/** Pure fold. Duplicate events (same identity) collapse — replay/at-least-once safe. */
export function foldCharterState(
  events: readonly CharterEvent[],
): ProjectedState {
  const notesByNode: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const e of events) {
    const dedupKey = `${e.type}|${e.nodeId}|${e.payload.note}|${e.occurredAt}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    (notesByNode[e.nodeId] ??= []).push(e.payload.note);
  }
  return { notesByNode };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lifecycle.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Export + commit**

Append to `src/index.ts`:
```ts
export * from './lifecycle.js';
```
Run: `pnpm run ci:local`.
```bash
git add -A
git commit -m "feat(charter-runtime): event-sourced one-pass lifecycle + replay-safe fold"
```

---

### Task 5: Fixture + store-readiness proof

**Files:**
- Create: `layers/charter-runtime/src/fixtures.ts`
- Test: `layers/charter-runtime/src/store-readiness.spec.ts`

**Interfaces:**
- Consumes: `writeCharter`, `CharterContract` (`./charter-node.js`); `PlanTree`, `PlanNode`, `PlanTreeSchema` from `@de-braighter/substrate-contracts/plan-tree`.
- Produces: `productTaskCharterTree(opts?: { childPrefixes?: string[] }): PlanTree` — a 2-node `product`(root)→`task`(leaf) charter tree.

- [ ] **Step 1: Write `src/fixtures.ts`**

```ts
import type { PlanTree, PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import { writeCharter, type CharterContract } from './charter-node.js';

export const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
export const TASK_ID = '44444444-4444-4444-8444-444444444444';
export const TENANT_PACK_ID = '55555555-5555-4555-8555-555555555555';

export function productTaskCharterTree(
  opts: { childPrefixes?: string[] } = {},
): PlanTree {
  const product: CharterContract = {
    role: 'product',
    mission: { objective: 'Build the charter runtime', outcome: 'Charters execute' },
    scope: { allowedPathPrefixes: ['src/', 'docs/'] },
  };
  const task: CharterContract = {
    role: 'task',
    mission: { objective: 'Implement the lens', outcome: 'Contract round-trips' },
    scope: { allowedPathPrefixes: opts.childPrefixes ?? ['src/charter/'] },
  };
  const productNode: PlanNode = writeCharter(
    {
      id: PRODUCT_ID, parentId: null, treeRootId: PRODUCT_ID,
      kind: 'product', kindRef: 'charter:product', ordinal: 0,
      metadata: {}, childrenIds: [TASK_ID],
    },
    product,
  );
  const taskNode: PlanNode = writeCharter(
    {
      id: TASK_ID, parentId: PRODUCT_ID, treeRootId: PRODUCT_ID,
      kind: 'task', kindRef: 'charter:task', ordinal: 0,
      metadata: {}, childrenIds: [],
    },
    task,
  );
  return { treeRootId: PRODUCT_ID, tenantPackId: TENANT_PACK_ID, nodes: [productNode, taskNode] };
}
```

- [ ] **Step 2: Write the failing test `src/store-readiness.spec.ts`**

```ts
import { PlanTreeSchema } from '@de-braighter/substrate-contracts/plan-tree';
import { productTaskCharterTree } from './fixtures.js';

describe('charter tree is kernel-store-ready (zero kernel change needed)', () => {
  it('passes the kernel PlanTreeSchema as-is', () => {
    expect(() => PlanTreeSchema.parse(productTaskCharterTree())).not.toThrow();
  });

  it('every node has a non-empty kindRef', () => {
    for (const n of productTaskCharterTree().nodes) {
      expect(n.kindRef.length).toBeGreaterThan(0);
    }
  });

  it('no node metadata uses the kernel reserved keys', () => {
    for (const n of productTaskCharterTree().nodes) {
      expect(Object.keys(n.metadata)).not.toContain('__kindRef');
      expect(Object.keys(n.metadata)).not.toContain('__tenantPackId');
    }
  });
});
```

- [ ] **Step 3: Run test**

Run: `pnpm exec vitest run src/store-readiness.spec.ts`
Expected: PASS (3 tests). If `PlanTreeSchema.parse` throws, the contract placement is wrong — fix before proceeding (do NOT change the kernel).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(charter-runtime): product→task fixture + kernel-store-readiness proof"
```

---

### Task 6: Charter-side fake-delegate kernel round-trip

**Files:**
- Test: `layers/charter-runtime/src/kernel-roundtrip.spec.ts`

**Interfaces:**
- Consumes: `PrismaPlanTreeStore`, `type PlanTreePrismaClient`, `type PlanNodeRecord` from `@de-braighter/substrate-runtime`; `productTaskCharterTree` (`./fixtures.js`).

- [ ] **Step 1: Confirm the import path of `PrismaPlanTreeStore`**

```bash
node -e "import('@de-braighter/substrate-runtime').then(m => console.log(Object.keys(m).filter(k=>k.includes('PlanTree'))))"
```
Expected output includes `PrismaPlanTreeStore`. (If it is re-exported from a subpath, adjust the import below accordingly.)

- [ ] **Step 2: Write the failing test**

```ts
import {
  PrismaPlanTreeStore,
  type PlanTreePrismaClient,
  type PlanNodeRecord,
} from '@de-braighter/substrate-runtime';
import { productTaskCharterTree } from './fixtures.js';

/** Array-backed fake of the narrow Prisma slice the store uses (mirrors the
 *  kernel store's own spec). */
class FakePlanTreePrisma implements PlanTreePrismaClient {
  rows: PlanNodeRecord[] = [];
  readonly planNode = {
    findMany: async (args: { where: { treeRootId: string; deletedAt: null } }) =>
      this.rows
        .filter((r) => r.treeRootId === args.where.treeRootId)
        .sort((a, b) => a.ordinal - b.ordinal),
    deleteMany: async (args: { where: { treeRootId: string } }) => {
      this.rows = this.rows.filter((r) => r.treeRootId !== args.where.treeRootId);
      return {};
    },
    createMany: async (args: { data: readonly PlanNodeRecord[] }) => {
      this.rows.push(...args.data.map((r) => ({ ...r })));
      return {};
    },
  };
  async $transaction<T>(fn: (tx: PlanTreePrismaClient) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

const byId = <T extends { id: string }>(ns: readonly T[]) =>
  [...ns].sort((a, b) => a.id.localeCompare(b.id));

describe('charter tree round-trips the kernel store mapping (fake delegate)', () => {
  it('save then load returns a deep-equal tree (charter contract on metadata survives)', async () => {
    const tree = productTaskCharterTree();
    const store = new PrismaPlanTreeStore(new FakePlanTreePrisma(), {
      tenantPackId: tree.tenantPackId,
      userId: '66666666-6666-4666-8666-666666666666',
    });

    await store.save(tree);
    const loaded = await store.load(tree.treeRootId);

    expect(loaded).not.toBeNull();
    expect(loaded!.treeRootId).toBe(tree.treeRootId);
    expect(loaded!.tenantPackId).toBe(tree.tenantPackId);
    expect(byId(loaded!.nodes)).toEqual(byId(tree.nodes));
  });
});
```

- [ ] **Step 3: Run test to verify it fails, then passes**

Run: `pnpm exec vitest run src/kernel-roundtrip.spec.ts`
Expected: PASS. If a TS error arises passing the fake as `PlanTreePrismaClient`, the fake's method signatures need to match the published `PlanTreePrismaClient` interface — adjust the fake to the published types (do not change production code).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(charter-runtime): charter tree round-trips the kernel store mapping (fake)"
```

---

### Task 7: e2e capstone + import-boundary acid

**Files:**
- Test: `layers/charter-runtime/src/e2e-capstone.spec.ts`
- Test: `layers/charter-runtime/src/boundary-acid.spec.ts`

**Interfaces:**
- Consumes: all of the above (`productTaskCharterTree`, `validateInheritance`, `readCharter`, `runLifecyclePass`, `foldCharterState`, `PrismaPlanTreeStore`).

- [ ] **Step 1: Write the e2e capstone test**

```ts
import {
  PrismaPlanTreeStore,
  type PlanTreePrismaClient,
  type PlanNodeRecord,
} from '@de-braighter/substrate-runtime';
import { productTaskCharterTree, PRODUCT_ID, TASK_ID } from './fixtures.js';
import { readCharter } from './charter-node.js';
import { validateInheritance } from './inheritance.js';
import { runLifecyclePass, foldCharterState } from './lifecycle.js';

class FakePlanTreePrisma implements PlanTreePrismaClient {
  rows: PlanNodeRecord[] = [];
  readonly planNode = {
    findMany: async (args: { where: { treeRootId: string; deletedAt: null } }) =>
      this.rows.filter((r) => r.treeRootId === args.where.treeRootId).sort((a, b) => a.ordinal - b.ordinal),
    deleteMany: async (args: { where: { treeRootId: string } }) => {
      this.rows = this.rows.filter((r) => r.treeRootId !== args.where.treeRootId);
      return {};
    },
    createMany: async (args: { data: readonly PlanNodeRecord[] }) => {
      this.rows.push(...args.data.map((r) => ({ ...r })));
      return {};
    },
  };
  async $transaction<T>(fn: (tx: PlanTreePrismaClient) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe('Slice 0 e2e: author → validate → lifecycle → kernel round-trip', () => {
  it('threads the whole skeleton on a valid charter tree', async () => {
    const tree = productTaskCharterTree();
    const product = readCharter(tree.nodes.find((n) => n.id === PRODUCT_ID)!)!;
    const taskNode = tree.nodes.find((n) => n.id === TASK_ID)!;
    const task = readCharter(taskNode)!;

    // validate: inheritance passes
    expect(validateInheritance(product, task).ok).toBe(true);

    // lifecycle: one event-sourced pass, replay-once
    const { events, resolution } = runLifecyclePass(taskNode, {
      parent: product,
      action: { kind: 'record-note', note: 'slice-0' },
      occurredAt: '2026-06-27T00:00:00.000Z',
    });
    expect(resolution).toBe('done');
    expect(foldCharterState([...events, ...events]).notesByNode[TASK_ID]).toEqual(['slice-0']);

    // kernel round-trip
    const store = new PrismaPlanTreeStore(new FakePlanTreePrisma(), {
      tenantPackId: tree.tenantPackId, userId: '66666666-6666-4666-8666-666666666666',
    });
    await store.save(tree);
    const loaded = await store.load(tree.treeRootId);
    expect(readCharter(loaded!.nodes.find((n) => n.id === TASK_ID)!)).toEqual(task);
  });

  it('NEGATIVE: a scope-widening child is rejected before any side effect', () => {
    const tree = productTaskCharterTree({ childPrefixes: ['/'] }); // widens beyond src/,docs/
    const product = readCharter(tree.nodes.find((n) => n.id === PRODUCT_ID)!)!;
    const taskNode = tree.nodes.find((n) => n.id === TASK_ID)!;
    const task = readCharter(taskNode)!;

    expect(validateInheritance(product, task).ok).toBe(false);
    const r = runLifecyclePass(taskNode, {
      parent: product,
      action: { kind: 'record-note', note: 'should-not-run' },
      occurredAt: '2026-06-27T00:00:00.000Z',
    });
    expect(r.resolution).toBe('rejected');
    expect(r.events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the capstone**

Run: `pnpm exec vitest run src/e2e-capstone.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Write the import-boundary acid `src/boundary-acid.spec.ts`**

```ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(process.cwd(), 'src');
const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

describe('Kernel-Untouched Invariant — import boundary', () => {
  it('charter layer imports substrate only via its published package surface', () => {
    for (const f of files) {
      const text = readFileSync(join(SRC, f), 'utf8');
      // no relative reach into a sibling substrate repo
      expect(text).not.toMatch(/from ['"]\.\.\/\.\.\/substrate/);
      // any @de-braighter import is the published scope, not a deep dist path
      const imports = [...text.matchAll(/from ['"](@de-braighter\/[^'"]+)['"]/g)].map((m) => m[1]);
      for (const imp of imports) {
        expect(imp).toMatch(/^@de-braighter\/(substrate-contracts|substrate-runtime)(\/[a-z-]+)?$/);
      }
    }
  });

  it('production source (non-spec) does not depend on substrate-runtime', () => {
    for (const f of files.filter((f) => !f.endsWith('.spec.ts'))) {
      const text = readFileSync(join(SRC, f), 'utf8');
      expect(text).not.toMatch(/@de-braighter\/substrate-runtime/);
    }
  });
});
```

- [ ] **Step 4: Run the boundary acid + full suite**

Run: `pnpm run ci:local`
Expected: typecheck clean; ALL specs pass.

- [ ] **Step 5: Commit + push the branch**

```bash
git add -A
git commit -m "test(charter-runtime): e2e capstone + import-boundary acid (Kernel-Untouched Invariant)"
git push -u origin feat/slice-0-walking-skeleton
```

---

### Task 8: Real-Postgres kernel round-trip (in `layers/substrate`) + zero-diff verification

**Files:**
- Create: `layers/substrate/libs/substrate-runtime/src/plan-tree/prisma-plan-tree.store.db.spec.ts`

**Interfaces:**
- Consumes: `PrismaPlanTreeStore`, `type PlanTreePrismaClient` (`./prisma-plan-tree.store.js`); a real `PrismaClient`. Charter-agnostic — uses a generic metadata-rich `PlanTree`.

- [ ] **Step 1: Branch in the substrate clone**

```bash
cd ../substrate   # i.e. layers/substrate
git checkout main && git pull --ff-only
git checkout -b feat/charter-slice-0-plan-tree-db-roundtrip
```

- [ ] **Step 2: Write the DB integration test (mirrors `prisma-run-manifest-repository.rls.integration.spec.ts` harness)**

```ts
// DB-INTEGRATION: proves kernel.plan_node round-trips a metadata-rich PlanTree
// against real Postgres (FK + acyclic trigger + kindRef + JSONB metadata).
// Runs under the db tier (vitest.db.config.ts); skips when no DB.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import {
  PrismaPlanTreeStore,
  type PlanTreePrismaClient,
} from './prisma-plan-tree.store.js';
import type { PlanTree } from '@de-braighter/substrate-contracts/plan-tree';

const DATABASE_URL = process.env['SUBSTRATE_DATABASE_URL'];

const byId = <T extends { id: string }>(ns: readonly T[]) =>
  [...ns].sort((a, b) => a.id.localeCompare(b.id));

describe.skipIf(!DATABASE_URL)(
  'PrismaPlanTreeStore — kernel.plan_node real-DB round-trip',
  () => {
    const ROOT = randomUUID();
    const CHILD = randomUUID();
    const TENANT = randomUUID();
    const USER = randomUUID();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let prisma: any;
    let store: PrismaPlanTreeStore;

    beforeAll(async () => {
      const { PrismaClient } = await import('@prisma/client');
      prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
      store = new PrismaPlanTreeStore(prisma as unknown as PlanTreePrismaClient, {
        tenantPackId: TENANT,
        userId: USER,
      });
    }, 60_000);

    afterAll(async () => {
      if (!prisma) return;
      try {
        await prisma.$executeRawUnsafe(
          `DELETE FROM kernel.plan_node WHERE tree_root_id = $1::uuid`,
          ROOT,
        );
      } catch {
        // best-effort
      }
      await prisma.$disconnect();
    });

    it('saves a metadata-rich tree and loads it back deep-equal', async () => {
      const tree: PlanTree = {
        treeRootId: ROOT,
        tenantPackId: TENANT,
        nodes: [
          {
            id: ROOT, parentId: null, treeRootId: ROOT, kind: 'product',
            kindRef: 'cat:product', ordinal: 0,
            metadata: { title: 'Root', nested: { a: 1, b: ['x', 'y'] } },
            childrenIds: [CHILD],
          },
          {
            id: CHILD, parentId: ROOT, treeRootId: ROOT, kind: 'task',
            kindRef: 'cat:task', ordinal: 0,
            metadata: { title: 'Child', deep: { contract: { scope: { p: ['src/'] } } } },
            childrenIds: [],
          },
        ],
      };

      await store.save(tree);
      const loaded = await store.load(ROOT);

      expect(loaded).not.toBeNull();
      expect(loaded!.treeRootId).toBe(ROOT);
      expect(loaded!.tenantPackId).toBe(TENANT);
      expect(byId(loaded!.nodes)).toEqual(byId(tree.nodes));
    });
  },
);
```

- [ ] **Step 3: Bring up the test DB + run the spec under the db tier**

```bash
npm run db:setup    # starts Postgres (docker-compose) + applies migrations
npx vitest run -c libs/substrate-runtime/vitest.db.config.ts libs/substrate-runtime/src/plan-tree/prisma-plan-tree.store.db.spec.ts
```
Expected: 1 test PASS (not skipped — the global setup fails loud if the DB is absent). If it skips, `SUBSTRATE_DATABASE_URL` is unset; export it from `.env` (see `.env.example`).

- [ ] **Step 4: Verify the Kernel-Untouched Invariant (zero-diff guard)**

```bash
git diff --stat origin/main -- \
  libs/substrate-contracts/src/plan-tree/plan-tree-schemas.ts \
  libs/substrate-contracts/src/plan-tree/plan-tree-store.port.ts \
  libs/substrate-runtime/src/plan-tree/prisma-plan-tree.store.ts \
  prisma/schema
```
Expected: **empty output** (only the new `*.db.spec.ts` is added). If anything else changed, revert it — the kernel must stay untouched.

- [ ] **Step 5: Commit + push**

```bash
git add libs/substrate-runtime/src/plan-tree/prisma-plan-tree.store.db.spec.ts
git commit -m "test(substrate): real-DB round-trip of a metadata-rich PlanTree through kernel.plan_node"
git push -u origin feat/charter-slice-0-plan-tree-db-roundtrip
```

---

## Self-Review

**Spec coverage:**
- Layer builds + registered → Task 1. Lens → Task 2. Inheritance fail-closed + effectiveScope → Task 3. Lifecycle + replay/exactly-once → Task 4. Store-readiness (kernel-valid, preconditions) → Task 5. Charter mapping round-trip → Task 6. e2e capstone + boundary acid → Task 7. Real-DB round-trip + zero-diff guard → Task 8. All spec §9 acceptance criteria mapped.
- ADR (spec §12): the ADR is drafted alongside execution as a separate designer-first task (not code) — flagged here, authored during/after the wave; it is NOT a blocker for the skeleton's green build but IS required before merge.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; version-resolution steps are real commands, not placeholders.

**Type consistency:** `CharterContract`/`CharterRole`/`readCharter`/`writeCharter` (Task 2) are consumed unchanged in Tasks 3–7; `runLifecyclePass`/`foldCharterState`/`ACTION_REGISTRY` signatures (Task 4) match their uses in Task 7; `productTaskCharterTree(opts)` (Task 5) is called with `{ childPrefixes }` in Task 7; `PrismaPlanTreeStore(prisma, { tenantPackId, userId })` used consistently in Tasks 6–8.

## Quality plan (per spec §10)

Non-trivial + cross-repo → full verifier wave (local-ci · reviewer · charter-checker · qa-engineer) + opus whole-branch, per repo PR. `charter-checker` certifies the Kernel-Untouched Invariant. Two PRs: `de-braighter/charter-runtime#1` (Tasks 1–7) and `de-braighter/substrate#…` (Task 8). The substrate PR carries the zero-diff guard output as evidence.
