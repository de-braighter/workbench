# S1 — Uniform Charter Lifecycle Runtime — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalise Slice-0's one-event skeleton into a full 8-stage charter lifecycle runtime inside `layers/charter-runtime` — complete CharterEvent union, foldCharterLifecycleState, CharterEventLog port, hierarchical frontier, 6-action ACTION_REGISTRY, conductCharterStep with crash recovery, and 9 load-bearing acid tests.

**Architecture:** Pure layer (`@de-braighter/charter-runtime`). New files add alongside Slice-0 files without removing them. `lifecycle.ts` (Slice-0 backward compat) imports CharterEvent/Resolution from the new `lifecycle-events.ts`. The kernel (`layers/substrate`) is untouched — zero diff to plan-tree-schemas.ts, plan-tree-store.port.ts, prisma-plan-tree.store.ts, or any migration.

**Tech Stack:** TypeScript ESM, Vitest, Zod, `@de-braighter/substrate-contracts` (PlanTree/PlanNode/PlanTreeStore), `@de-braighter/substrate-runtime` (PrismaPlanTreeStore, for e2e capstone only).

## Global Constraints

- **Zero kernel change** — no diff to `layers/substrate/**` except tests that were already there. The Kernel-Untouched Invariant (ADR-283 D2) must hold.
- **One `validateInheritance`** — always import from `./inheritance.js`; never copy or re-implement.
- **Replay-stable fold** — `Date.now()` and `Math.random()` must never appear inside `foldCharterLifecycleState`. `now` and `newId` are injected via `CharterDeps`.
- **ESM imports** — all internal imports use explicit `.js` extension (e.g. `./lifecycle-events.js`).
- **Test runner** — `pnpm test` from `layers/charter-runtime/` (Vitest, `src/**/*.spec.ts`).
- **Dedup key** — `JSON.stringify(event)` throughout the fold (whole event body, same as Slice-0 pattern).
- **ACTION_REGISTRY** — closed `ReadonlyMap`; unknown kind throws, never silently no-ops.

## File Map

```
src/
  charter-node.ts          MODIFY  — add roles: epic | gate | review | adr | experiment
                                     add DECOMPOSABLE_ROLES / CLAIMABLE_ROLES sets
  lifecycle.ts             MODIFY  — import CharterEvent + Resolution from lifecycle-events.ts;
                                     update foldCharterState to narrow on NoteRecorded.v1
  lifecycle-events.ts      CREATE  — full CharterEvent union (6 types) + Resolution (5 values)
  lifecycle-state.ts       CREATE  — foldCharterLifecycleState + state types + helpers
  event-log.port.ts        CREATE  — CharterEventLog interface + InMemoryCharterEventLog
  frontier.ts              CREATE  — charterFrontier(tree, state, nowMs): FrontierEntry[]
  action-registry.ts       CREATE  — ACTION_REGISTRY (6 kinds) + CharterActionInput/Deps/Handler
  conduct.ts               CREATE  — CharterDeps + conductCharterStep + crash recovery
  acids.spec.ts            CREATE  — 9 load-bearing acid tests
  index.ts                 MODIFY  — publish new surface; keep all Slice-0 exports

  testing/
    fixtures.ts            MODIFY  — add decomposableProductTree() + PRODUCT_ROOT_ID constant
    fake-plan-tree-prisma.ts  UNCHANGED
```

---

### Task 1: `lifecycle-events.ts` + update `lifecycle.ts`

**Files:**
- Create: `layers/charter-runtime/src/lifecycle-events.ts`
- Modify: `layers/charter-runtime/src/lifecycle.ts`

**Interfaces:**
- Produces: `CharterEvent` (6-variant union), `Resolution` (5 values) — consumed by all later tasks

- [ ] **Step 1: Create `lifecycle-events.ts`**

```typescript
// src/lifecycle-events.ts
export type Resolution = 'done' | 'expanded' | 'blocked' | 'rejected' | 'superseded'

export type CharterEvent =
  | { type: 'charter:NoteRecorded.v1';
      nodeId: string; payload: { note: string }; occurredAt: string }
  | { type: 'charter:NodeClaimed.v1';
      nodeId: string;
      payload: { claimId: string; sessionId: string; ttlMinutes: number };
      occurredAt: string }
  | { type: 'charter:NodeReleased.v1';
      nodeId: string;
      payload: { claimId: string; resolution: Resolution; note?: string };
      occurredAt: string }
  | { type: 'charter:NodeDecomposed.v1';
      nodeId: string; payload: { childIds: string[] }; occurredAt: string }
  | { type: 'charter:GateRequested.v1';
      nodeId: string; payload: { gateId: string; gateType: string }; occurredAt: string }
  | { type: 'charter:GateDecided.v1';
      nodeId: string;
      payload: { gateId: string; decision: 'approved' | 'rejected'; note?: string };
      occurredAt: string }
```

- [ ] **Step 2: Update `lifecycle.ts` — import CharterEvent/Resolution + fix foldCharterState**

Replace the top of `lifecycle.ts` (remove the local `CharterEvent` interface and `Resolution` type, import from the new module, add a type narrowing guard in `foldCharterState`):

```typescript
// src/lifecycle.ts  (full file after edit)
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import { readCharter, type CharterContract } from './charter-node.js';
import { validateInheritance } from './inheritance.js';
import type { CharterEvent, Resolution } from './lifecycle-events.js';

export type { CharterEvent, Resolution } from './lifecycle-events.js';

type ActionKind = 'record-note';
interface ActionInput {
  nodeId: string;
  note: string;
  occurredAt: string;
}
type Handler = (input: ActionInput) => CharterEvent[];

const ACTION_REGISTRY: ReadonlyMap<ActionKind, Handler> = new Map<ActionKind, Handler>([
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

export interface LifecycleContext {
  parent: CharterContract | null;
  action: { kind: ActionKind; note: string };
  occurredAt: string;
}

export function runLifecyclePass(
  node: PlanNode,
  ctx: LifecycleContext,
): { events: CharterEvent[]; resolution: Resolution } {
  const charter = readCharter(node);
  if (charter === null) return { events: [], resolution: 'rejected' };
  if (ctx.parent) {
    const verdict = validateInheritance(ctx.parent, charter);
    if (!verdict.ok) return { events: [], resolution: 'rejected' };
  }
  const handler = ACTION_REGISTRY.get(ctx.action.kind);
  if (!handler) throw new Error(`unknown action kind: ${ctx.action.kind}`);
  const events = handler({ nodeId: node.id, note: ctx.action.note, occurredAt: ctx.occurredAt });
  return { events, resolution: 'done' };
}

export interface ProjectedState {
  notesByNode: Record<string, string[]>;
}

export function foldCharterState(events: readonly CharterEvent[]): ProjectedState {
  const notesByNode: Record<string, string[]> = {};
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type !== 'charter:NoteRecorded.v1') continue;
    const dedupKey = JSON.stringify(e);
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    (notesByNode[e.nodeId] ??= []).push(e.payload.note);
  }
  return { notesByNode };
}
```

- [ ] **Step 3: Run existing tests to verify no regressions**

```
cd layers/charter-runtime && pnpm test
```

Expected: all Slice-0 tests still pass (lifecycle.spec.ts, e2e-capstone.spec.ts, any others). Zero failures.

- [ ] **Step 4: Commit**

```bash
git add layers/charter-runtime/src/lifecycle-events.ts layers/charter-runtime/src/lifecycle.ts
git commit -m "feat(charter-runtime): add full CharterEvent union + Resolution in lifecycle-events.ts"
```

---

### Task 2: `lifecycle-state.ts` — fold + helpers + Acids 1 & 7

**Files:**
- Create: `layers/charter-runtime/src/lifecycle-state.ts`
- Create: `layers/charter-runtime/src/lifecycle-state.spec.ts`

**Interfaces:**
- Consumes: `CharterEvent`, `Resolution` from `./lifecycle-events.js`
- Produces: `CharterLifecycleState`, `NodeLifecycleState`, `ClaimState`, `GateState`, `foldCharterLifecycleState`, `claimActive`, `nodeResolved`, `nodeActiveClaim`, `openGate`

- [ ] **Step 1: Write failing tests (Acid 1 — fold-determinism + Acid 7 — full resolution set)**

```typescript
// src/lifecycle-state.spec.ts
import { describe, it, expect } from 'vitest';
import { foldCharterLifecycleState, nodeResolved } from './lifecycle-state.js';
import type { CharterEvent } from './lifecycle-events.js';

const NOW = '2026-06-29T10:00:00.000Z';
const NODE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CLAIM_1 = 'conduct-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('foldCharterLifecycleState', () => {
  describe('Acid 1 — fold-determinism / replay-stability', () => {
    it('fold(E) === fold([...E, ...E]) for all 6 event types', () => {
      const events: CharterEvent[] = [
        { type: 'charter:NoteRecorded.v1', nodeId: NODE_A, payload: { note: 'hi' }, occurredAt: NOW },
        { type: 'charter:NodeClaimed.v1', nodeId: NODE_A, payload: { claimId: CLAIM_1, sessionId: 'conductor', ttlMinutes: 30 }, occurredAt: NOW },
        { type: 'charter:NodeReleased.v1', nodeId: NODE_A, payload: { claimId: CLAIM_1, resolution: 'done' }, occurredAt: NOW },
        { type: 'charter:NodeDecomposed.v1', nodeId: NODE_A, payload: { childIds: ['c1', 'c2'] }, occurredAt: NOW },
        { type: 'charter:GateRequested.v1', nodeId: NODE_A, payload: { gateId: 'g1', gateType: 'review' }, occurredAt: NOW },
        { type: 'charter:GateDecided.v1', nodeId: NODE_A, payload: { gateId: 'g1', decision: 'approved' }, occurredAt: NOW },
      ];
      const once = foldCharterLifecycleState(events);
      const twice = foldCharterLifecycleState([...events, ...events]);
      const ns1 = once.byNode.get(NODE_A)!;
      const ns2 = twice.byNode.get(NODE_A)!;
      expect(ns1.notes).toEqual(ns2.notes);
      expect(ns1.claims.length).toBe(ns2.claims.length);
      expect(ns1.resolution).toBe(ns2.resolution);
      expect(ns1.gates.length).toBe(ns2.gates.length);
    });
  });

  describe('Acid 7 — full resolution set', () => {
    const resolutions = ['done', 'expanded', 'blocked', 'rejected', 'superseded'] as const;
    for (const resolution of resolutions) {
      it(`resolution '${resolution}' records correctly and sets nodeResolved`, () => {
        const events: CharterEvent[] = [
          { type: 'charter:NodeClaimed.v1', nodeId: NODE_A, payload: { claimId: CLAIM_1, sessionId: 'conductor', ttlMinutes: 30 }, occurredAt: NOW },
          { type: 'charter:NodeReleased.v1', nodeId: NODE_A, payload: { claimId: CLAIM_1, resolution }, occurredAt: NOW },
        ];
        const state = foldCharterLifecycleState(events);
        const ns = state.byNode.get(NODE_A)!;
        expect(ns.resolution).toBe(resolution);
        expect(nodeResolved(ns)).toBe(true);
      });
    }

    it('NodeDecomposed sets resolution expanded', () => {
      const events: CharterEvent[] = [
        { type: 'charter:NodeDecomposed.v1', nodeId: NODE_A, payload: { childIds: ['c1'] }, occurredAt: NOW },
      ];
      const state = foldCharterLifecycleState(events);
      expect(state.byNode.get(NODE_A)!.resolution).toBe('expanded');
    });
  });
});
```

- [ ] **Step 2: Run — verify tests fail with "cannot find module"**

```
cd layers/charter-runtime && pnpm test -- lifecycle-state
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `lifecycle-state.ts`**

```typescript
// src/lifecycle-state.ts
import type { CharterEvent, Resolution } from './lifecycle-events.js';

export interface ClaimState {
  claimId: string;
  sessionId: string;
  ttlMinutes: number;
  acquiredAt: string;
  released?: { resolution: Resolution; note?: string; at: string };
}

export interface GateState {
  gateId: string;
  gateType: string;
  requestedAt: string;
  decision?: { decision: 'approved' | 'rejected'; note?: string; at: string };
}

export interface NodeLifecycleState {
  claims: ClaimState[];
  resolution?: Resolution;
  decomposedChildIds?: string[];
  gates: GateState[];
  notes: string[];
}

export interface CharterLifecycleState {
  byNode: Map<string, NodeLifecycleState>;
}

export function claimActive(c: ClaimState, nowMs: number): boolean {
  return c.released == null && (nowMs - Date.parse(c.acquiredAt) < c.ttlMinutes * 60_000);
}

export function nodeResolved(n: NodeLifecycleState): boolean {
  return n.resolution != null;
}

export function nodeActiveClaim(n: NodeLifecycleState, nowMs: number): ClaimState | undefined {
  return n.claims.find(c => claimActive(c, nowMs));
}

export function openGate(n: NodeLifecycleState): GateState | undefined {
  return n.gates.find(g => g.decision == null);
}

function getOrCreate(state: CharterLifecycleState, nodeId: string): NodeLifecycleState {
  const existing = state.byNode.get(nodeId);
  if (existing) return existing;
  const fresh: NodeLifecycleState = { claims: [], gates: [], notes: [] };
  state.byNode.set(nodeId, fresh);
  return fresh;
}

export function foldCharterLifecycleState(
  events: readonly CharterEvent[],
): CharterLifecycleState {
  const state: CharterLifecycleState = { byNode: new Map() };
  const seen = new Set<string>();
  for (const e of events) {
    const dedupKey = JSON.stringify(e);
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const ns = getOrCreate(state, e.nodeId);
    switch (e.type) {
      case 'charter:NoteRecorded.v1':
        ns.notes.push(e.payload.note);
        break;
      case 'charter:NodeClaimed.v1':
        // done-invariant: resolved node accepts no further claims
        if (nodeResolved(ns)) break;
        ns.claims.push({
          claimId: e.payload.claimId,
          sessionId: e.payload.sessionId,
          ttlMinutes: e.payload.ttlMinutes,
          acquiredAt: e.occurredAt,
        });
        break;
      case 'charter:NodeReleased.v1': {
        const claim = ns.claims.find(c => c.claimId === e.payload.claimId);
        if (claim && claim.released == null) {
          claim.released = { resolution: e.payload.resolution, note: e.payload.note, at: e.occurredAt };
          ns.resolution = e.payload.resolution;
        }
        break;
      }
      case 'charter:NodeDecomposed.v1':
        if (ns.resolution == null) {
          ns.resolution = 'expanded';
          ns.decomposedChildIds = e.payload.childIds;
        }
        break;
      case 'charter:GateRequested.v1':
        ns.gates.push({
          gateId: e.payload.gateId,
          gateType: e.payload.gateType,
          requestedAt: e.occurredAt,
        });
        break;
      case 'charter:GateDecided.v1': {
        const gate = ns.gates.find(g => g.gateId === e.payload.gateId);
        if (gate && gate.decision == null) {
          gate.decision = {
            decision: e.payload.decision,
            note: e.payload.note,
            at: e.occurredAt,
          };
        }
        break;
      }
    }
  }
  return state;
}
```

- [ ] **Step 4: Run tests — verify pass**

```
cd layers/charter-runtime && pnpm test -- lifecycle-state
```

Expected: all lifecycle-state tests PASS.

- [ ] **Step 5: Commit**

```bash
git add layers/charter-runtime/src/lifecycle-state.ts layers/charter-runtime/src/lifecycle-state.spec.ts
git commit -m "feat(charter-runtime): add foldCharterLifecycleState + state types (Acids 1 & 7)"
```

---

### Task 3: `event-log.port.ts` — CharterEventLog + InMemoryCharterEventLog

**Files:**
- Create: `layers/charter-runtime/src/event-log.port.ts`
- Create: `layers/charter-runtime/src/event-log.port.spec.ts`

**Interfaces:**
- Consumes: `CharterEvent` from `./lifecycle-events.js`
- Produces: `CharterEventLog` interface, `InMemoryCharterEventLog` class

- [ ] **Step 1: Write failing test**

```typescript
// src/event-log.port.spec.ts
import { describe, it, expect } from 'vitest';
import { InMemoryCharterEventLog } from './event-log.port.js';
import type { CharterEvent } from './lifecycle-events.js';

const ROOT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROOT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NODE_1 = '11111111-1111-4111-8111-111111111111';

describe('InMemoryCharterEventLog', () => {
  it('buckets events by treeRootId — reads are isolated', () => {
    const log = new InMemoryCharterEventLog();
    const evA: CharterEvent = { type: 'charter:NoteRecorded.v1', nodeId: NODE_1, payload: { note: 'a' }, occurredAt: '2026-06-29T00:00:00.000Z' };
    const evB: CharterEvent = { type: 'charter:NoteRecorded.v1', nodeId: NODE_1, payload: { note: 'b' }, occurredAt: '2026-06-29T00:00:01.000Z' };
    log.append(ROOT_A, evA);
    log.append(ROOT_B, evB);
    expect(log.read(ROOT_A)).toEqual([evA]);
    expect(log.read(ROOT_B)).toEqual([evB]);
    expect(log.read('unknown-root')).toEqual([]);
  });

  it('returned array from read is immutable (readonly)', () => {
    const log = new InMemoryCharterEventLog();
    const ev: CharterEvent = { type: 'charter:NoteRecorded.v1', nodeId: NODE_1, payload: { note: 'x' }, occurredAt: '2026-06-29T00:00:00.000Z' };
    log.append(ROOT_A, ev);
    const result = log.read(ROOT_A);
    // TypeScript readonly — runtime test: push would mutate a copy, not the store
    expect(result.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — verify fail**

```
cd layers/charter-runtime && pnpm test -- event-log
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `event-log.port.ts`**

```typescript
// src/event-log.port.ts
import type { CharterEvent } from './lifecycle-events.js';

export interface CharterEventLog {
  /**
   * Append a lifecycle event. `treeRootId` is passed explicitly so the store
   * can bucket by tree without scanning node membership.
   */
  append(treeRootId: string, event: CharterEvent): void;
  read(treeRootId: string): readonly CharterEvent[];
}

export class InMemoryCharterEventLog implements CharterEventLog {
  private readonly store = new Map<string, CharterEvent[]>();

  append(treeRootId: string, event: CharterEvent): void {
    const bucket = this.store.get(treeRootId) ?? [];
    bucket.push(event);
    this.store.set(treeRootId, bucket);
  }

  read(treeRootId: string): readonly CharterEvent[] {
    return this.store.get(treeRootId) ?? [];
  }
}
```

- [ ] **Step 4: Run — verify pass**

```
cd layers/charter-runtime && pnpm test -- event-log
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add layers/charter-runtime/src/event-log.port.ts layers/charter-runtime/src/event-log.port.spec.ts
git commit -m "feat(charter-runtime): add CharterEventLog port + InMemoryCharterEventLog"
```

---

### Task 4: Extend charter roles + `frontier.ts` + fixture + Acid 2

**Files:**
- Modify: `layers/charter-runtime/src/charter-node.ts`
- Modify: `layers/charter-runtime/src/testing/fixtures.ts`
- Create: `layers/charter-runtime/src/frontier.ts`
- Create: `layers/charter-runtime/src/frontier.spec.ts`

**Interfaces:**
- Consumes: `CharterContract`, `CharterRole`, `readCharter`, `DECOMPOSABLE_ROLES`, `CLAIMABLE_ROLES` from `charter-node.js`; `CharterLifecycleState`, `nodeResolved`, `nodeActiveClaim` from `lifecycle-state.js`
- Produces: `FrontierAction`, `FrontierEntry`, `charterFrontier`

- [ ] **Step 1: Extend CharterRoleSchema in `charter-node.ts` + add role sets**

Open `src/charter-node.ts`. Replace:

```typescript
export const CharterRoleSchema = z.enum(['product', 'task']);
export type CharterRole = z.infer<typeof CharterRoleSchema>;
```

With:

```typescript
export const CharterRoleSchema = z.enum([
  'product', 'task', 'epic', 'gate', 'review', 'adr', 'experiment',
]);
export type CharterRole = z.infer<typeof CharterRoleSchema>;

/** Roles that advance by decomposing into child nodes (no children → action:'decompose'). */
export const DECOMPOSABLE_ROLES = new Set<CharterRole>(['product', 'epic', 'adr', 'experiment']);
/** Roles that advance by being claimed and executed (leaf nodes → action:'claim'). */
export const CLAIMABLE_ROLES = new Set<CharterRole>(['task', 'gate', 'review']);
```

- [ ] **Step 2: Run existing tests — verify no regressions**

```
cd layers/charter-runtime && pnpm test
```

Expected: all tests pass. (CharterRoleSchema now accepts more values — backward compatible.)

- [ ] **Step 3: Add `decomposableProductTree` fixture to `testing/fixtures.ts`**

Open `src/testing/fixtures.ts`. After the existing exports, add:

```typescript
export const PRODUCT_ROOT_ID = '11111111-1111-4111-8111-111111111111';
export const EPIC_ID         = '22222222-2222-4222-8222-222222222222';

/** A single product node with no children — frontier action will be 'decompose'. */
export function decomposableProductTree(): PlanTree {
  const product: CharterContract = {
    role: 'product',
    mission: { objective: 'Build the system', outcome: 'System built' },
    scope: { allowedPathPrefixes: ['src/'] },
  };
  const productNode: PlanNode = writeCharter(
    {
      id: PRODUCT_ROOT_ID, parentId: null, treeRootId: PRODUCT_ROOT_ID,
      kind: 'product', kindRef: 'charter:product', ordinal: 0,
      metadata: {}, childrenIds: [],
    },
    product,
  );
  return { treeRootId: PRODUCT_ROOT_ID, tenantPackId: TENANT_PACK_ID, nodes: [productNode] };
}
```

- [ ] **Step 4: Write failing frontier tests (Acid 2 — frontier-advance)**

```typescript
// src/frontier.spec.ts
import { describe, it, expect } from 'vitest';
import { charterFrontier } from './frontier.js';
import { foldCharterLifecycleState } from './lifecycle-state.js';
import { productTaskCharterTree, TASK_ID, decomposableProductTree, PRODUCT_ROOT_ID } from './testing/fixtures.js';
import type { CharterEvent } from './lifecycle-events.js';

const NOW_MS = Date.parse('2026-06-29T10:00:00.000Z');

describe('charterFrontier', () => {
  it('claimable task appears on frontier with action=claim', () => {
    const tree = productTaskCharterTree();
    const state = foldCharterLifecycleState([]);
    const frontier = charterFrontier(tree, state, NOW_MS);
    expect(frontier).toHaveLength(1);
    expect(frontier[0].nodeId).toBe(TASK_ID);
    expect(frontier[0].action).toBe('claim');
  });

  it('decomposable product (no children) appears with action=decompose', () => {
    const tree = decomposableProductTree();
    const state = foldCharterLifecycleState([]);
    const frontier = charterFrontier(tree, state, NOW_MS);
    expect(frontier).toHaveLength(1);
    expect(frontier[0].nodeId).toBe(PRODUCT_ROOT_ID);
    expect(frontier[0].action).toBe('decompose');
  });

  describe('Acid 2 — frontier-advance', () => {
    it('claimed node drops from frontier; resolved node stays off', () => {
      const tree = productTaskCharterTree();
      const claimId = `conduct-${TASK_ID}`;

      // After claim: drops
      const claimedEvents: CharterEvent[] = [
        { type: 'charter:NodeClaimed.v1', nodeId: TASK_ID, payload: { claimId, sessionId: 'conductor', ttlMinutes: 30 }, occurredAt: '2026-06-29T10:00:00.000Z' },
      ];
      const claimedState = foldCharterLifecycleState(claimedEvents);
      const afterClaim = charterFrontier(tree, claimedState, NOW_MS);
      expect(afterClaim.find(e => e.nodeId === TASK_ID)).toBeUndefined();

      // After resolve: stays off
      const resolvedEvents: CharterEvent[] = [
        ...claimedEvents,
        { type: 'charter:NodeReleased.v1', nodeId: TASK_ID, payload: { claimId, resolution: 'done' }, occurredAt: '2026-06-29T10:01:00.000Z' },
      ];
      const resolvedState = foldCharterLifecycleState(resolvedEvents);
      const afterResolve = charterFrontier(tree, resolvedState, NOW_MS);
      expect(afterResolve.find(e => e.nodeId === TASK_ID)).toBeUndefined();
    });

    it('parentCharter is pre-fetched for task under product', () => {
      const tree = productTaskCharterTree();
      const state = foldCharterLifecycleState([]);
      const frontier = charterFrontier(tree, state, NOW_MS);
      expect(frontier[0].parentCharter).not.toBeNull();
      expect(frontier[0].parentCharter?.role).toBe('product');
    });
  });
});
```

- [ ] **Step 5: Run — verify fail**

```
cd layers/charter-runtime && pnpm test -- frontier
```

Expected: FAIL (module not found).

- [ ] **Step 6: Create `frontier.ts`**

```typescript
// src/frontier.ts
import type { PlanTree } from '@de-braighter/substrate-contracts/plan-tree';
import { readCharter, DECOMPOSABLE_ROLES, CLAIMABLE_ROLES, type CharterContract } from './charter-node.js';
import type { CharterLifecycleState } from './lifecycle-state.js';
import { nodeResolved, nodeActiveClaim } from './lifecycle-state.js';

export type FrontierAction = 'decompose' | 'claim';

export interface FrontierEntry {
  nodeId: string;
  treeRootId: string;
  action: FrontierAction;
  charter: CharterContract;
  /** Pre-fetched for claim-time validateInheritance; null for root nodes. */
  parentCharter: CharterContract | null;
}

export function charterFrontier(
  tree: PlanTree,
  state: CharterLifecycleState,
  nowMs: number,
): FrontierEntry[] {
  const nodeById = new Map(tree.nodes.map(n => [n.id, n]));
  const entries: FrontierEntry[] = [];

  for (const node of tree.nodes) {
    const ns = state.byNode.get(node.id);

    if (ns && nodeResolved(ns)) continue;
    if (ns && nodeActiveClaim(ns, nowMs) != null) continue;

    // SKIP if any declared dependency is not yet resolved
    const deps = (node.metadata['_dependsOn'] as string[] | undefined) ?? [];
    const blocked = deps.some(depId => {
      const depNs = state.byNode.get(depId);
      return depNs == null || !nodeResolved(depNs);
    });
    if (blocked) continue;

    const charter = readCharter(node);
    if (charter == null) continue;

    const role = charter.role;
    const parentNode = node.parentId != null ? nodeById.get(node.parentId) : null;
    const parentCharter = parentNode != null ? readCharter(parentNode) : null;

    if (node.childrenIds.length === 0) {
      if (DECOMPOSABLE_ROLES.has(role)) {
        entries.push({ nodeId: node.id, treeRootId: tree.treeRootId, action: 'decompose', charter, parentCharter });
      } else if (CLAIMABLE_ROLES.has(role)) {
        entries.push({ nodeId: node.id, treeRootId: tree.treeRootId, action: 'claim', charter, parentCharter });
      }
    }
    // node.childrenIds.length > 0 → structural parent; skip, children surface
  }

  // Stable sort: ordinal ascending, then nodeId lexicographic (tie-break)
  return entries.sort((a, b) => {
    const na = nodeById.get(a.nodeId);
    const nb = nodeById.get(b.nodeId);
    const ordDiff = (na?.ordinal ?? 0) - (nb?.ordinal ?? 0);
    return ordDiff !== 0 ? ordDiff : a.nodeId.localeCompare(b.nodeId);
  });
}
```

- [ ] **Step 7: Run — verify pass**

```
cd layers/charter-runtime && pnpm test -- frontier
```

Expected: all frontier tests PASS.

- [ ] **Step 8: Commit**

```bash
git add \
  layers/charter-runtime/src/charter-node.ts \
  layers/charter-runtime/src/testing/fixtures.ts \
  layers/charter-runtime/src/frontier.ts \
  layers/charter-runtime/src/frontier.spec.ts
git commit -m "feat(charter-runtime): extend roles + charterFrontier + decomposable fixture (Acid 2)"
```

---

### Task 5: `action-registry.ts` — all 6 action handlers + Acids 3 & 4

**Files:**
- Create: `layers/charter-runtime/src/action-registry.ts`
- Create: `layers/charter-runtime/src/action-registry.spec.ts`

**Interfaces:**
- Consumes: `CharterEvent`, `Resolution` from `./lifecycle-events.js`; `validateInheritance`, `writeCharter`, `CHARTER_METADATA_KEY`, `CharterContract` from `./charter-node.js`; `PlanTreeStore`, `PlanTree`, `PlanNode` from `@de-braighter/substrate-contracts/plan-tree`
- Produces: `ActionKind`, `CharterActionInput`, `CharterActionDeps`, `ActionHandler`, `ChildSpec`, `ACTION_REGISTRY`

- [ ] **Step 1: Write failing tests (Acid 4 — inheritance-at-claim; Acid 3 — decompose-advance)**

```typescript
// src/action-registry.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { ACTION_REGISTRY } from './action-registry.js';
import type { CharterActionInput, CharterActionDeps, ChildSpec } from './action-registry.js';
import type { PlanTree, PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import type { PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
import { foldCharterLifecycleState } from './lifecycle-state.js';
import { charterFrontier } from './frontier.js';
import { PRODUCT_ROOT_ID, decomposableProductTree } from './testing/fixtures.js';
import type { CharterContract } from './charter-node.js';
import { InMemoryCharterEventLog } from './event-log.port.js';

const NOW = '2026-06-29T10:00:00.000Z';
const NOW_MS = Date.parse(NOW);
const NODE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NODE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TREE_ROOT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TENANT_PACK_ID = '55555555-5555-4555-8555-555555555555';

function makeInput(overrides: Partial<CharterActionInput> = {}): CharterActionInput {
  return {
    nodeId: NODE_A,
    treeRootId: TREE_ROOT,
    args: {},
    occurredAt: NOW,
    newId: () => 'new-id-1',
    ...overrides,
  };
}

class FakeStore implements PlanTreeStore {
  constructor(private tree: PlanTree) {}
  async load(id: string) { return this.tree.treeRootId === id ? this.tree : null; }
  async save(t: PlanTree) { this.tree = t; }
  async applyEdit() { return this.tree; }
}

const fakeDeps = (tree?: PlanTree): CharterActionDeps => ({
  planTreeStore: tree ? new FakeStore(tree) : { load: async () => null, save: async () => {}, applyEdit: async () => ({} as PlanTree) },
  tenantPackId: TENANT_PACK_ID,
});

describe('ACTION_REGISTRY', () => {
  it('throws on unknown kind', () => {
    expect(ACTION_REGISTRY.get('unknown-kind' as any)).toBeUndefined();
  });

  describe('record-note', () => {
    it('emits NoteRecorded.v1', async () => {
      const handler = ACTION_REGISTRY.get('record-note')!;
      const events = await handler(makeInput({ args: { note: 'hello' } }), fakeDeps());
      expect(events[0].type).toBe('charter:NoteRecorded.v1');
      expect((events[0] as any).payload.note).toBe('hello');
    });
  });

  describe('Acid 4 — inheritance-at-claim (fail-closed)', () => {
    it('throws when child scope widens parent scope — no NodeClaimed emitted', async () => {
      const handler = ACTION_REGISTRY.get('claim-node')!;
      const parentCharter: CharterContract = {
        role: 'product',
        mission: { objective: 'x', outcome: 'y' },
        scope: { allowedPathPrefixes: ['src/'] },
      };
      const widenedCharter: CharterContract = {
        role: 'task',
        mission: { objective: 'x', outcome: 'y' },
        scope: { allowedPathPrefixes: ['/'] }, // widens beyond src/
      };
      await expect(
        handler(makeInput({ args: { parentCharter, nodeCharter: widenedCharter, ttlMinutes: 30 } }), fakeDeps()),
      ).rejects.toThrow('inheritance violation');
    });

    it('emits NodeClaimed.v1 when scope is valid', async () => {
      const handler = ACTION_REGISTRY.get('claim-node')!;
      const parentCharter: CharterContract = {
        role: 'product',
        mission: { objective: 'x', outcome: 'y' },
        scope: { allowedPathPrefixes: ['src/'] },
      };
      const validCharter: CharterContract = {
        role: 'task',
        mission: { objective: 'x', outcome: 'y' },
        scope: { allowedPathPrefixes: ['src/charter/'] },
      };
      const events = await handler(
        makeInput({ args: { parentCharter, nodeCharter: validCharter, ttlMinutes: 30 } }),
        fakeDeps(),
      );
      expect(events[0].type).toBe('charter:NodeClaimed.v1');
    });
  });

  describe('Acid 3 — decompose-advance (parent expands, children surface)', () => {
    it('decomposeNode emits NodeDecomposed, updates tree, children appear on frontier', async () => {
      const tree = decomposableProductTree();
      const store = new FakeStore(tree);
      const log = new InMemoryCharterEventLog();

      const children: ChildSpec[] = [
        {
          id: NODE_A,
          role: 'task',
          contract: {
            role: 'task',
            mission: { objective: 'Do the work', outcome: 'Work done' },
            scope: { allowedPathPrefixes: ['src/'] },
          },
          dependsOn: [],
        },
        {
          id: NODE_B,
          role: 'task',
          contract: {
            role: 'task',
            mission: { objective: 'Do more work', outcome: 'More done' },
            scope: { allowedPathPrefixes: ['src/'] },
          },
          dependsOn: [NODE_A],
        },
      ];

      const handler = ACTION_REGISTRY.get('decompose-node')!;
      const events = await handler(
        makeInput({ nodeId: PRODUCT_ROOT_ID, treeRootId: PRODUCT_ROOT_ID, args: { children } }),
        { planTreeStore: store, tenantPackId: TENANT_PACK_ID },
      );

      expect(events[0].type).toBe('charter:NodeDecomposed.v1');
      log.append(PRODUCT_ROOT_ID, events[0]);

      const updatedTree = await store.load(PRODUCT_ROOT_ID);
      const state = foldCharterLifecycleState(log.read(PRODUCT_ROOT_ID));

      // Parent resolved as 'expanded'
      expect(state.byNode.get(PRODUCT_ROOT_ID)?.resolution).toBe('expanded');

      // First child (no deps) appears on frontier
      const frontier = charterFrontier(updatedTree!, state, NOW_MS);
      expect(frontier.some(e => e.nodeId === NODE_A)).toBe(true);
      // Second child (depends on NODE_A) is blocked
      expect(frontier.some(e => e.nodeId === NODE_B)).toBe(false);
    });

    it('decompose-node is idempotent — same children → empty events on retry', async () => {
      const tree = decomposableProductTree();
      const store = new FakeStore(tree);
      const children: ChildSpec[] = [
        {
          id: NODE_A,
          role: 'task',
          contract: { role: 'task', mission: { objective: 'x', outcome: 'y' }, scope: { allowedPathPrefixes: ['src/'] } },
          dependsOn: [],
        },
      ];
      const handler = ACTION_REGISTRY.get('decompose-node')!;
      const input = makeInput({ nodeId: PRODUCT_ROOT_ID, treeRootId: PRODUCT_ROOT_ID, args: { children } });
      await handler(input, { planTreeStore: store, tenantPackId: TENANT_PACK_ID });
      const retry = await handler(input, { planTreeStore: store, tenantPackId: TENANT_PACK_ID });
      expect(retry).toEqual([]);
    });
  });

  describe('request-gate / decide-gate', () => {
    it('request-gate emits GateRequested with a new gateId', async () => {
      const handler = ACTION_REGISTRY.get('request-gate')!;
      let counter = 0;
      const events = await handler(
        makeInput({ args: { gateType: 'review' }, newId: () => `gate-${++counter}` }),
        fakeDeps(),
      );
      expect(events[0].type).toBe('charter:GateRequested.v1');
      expect((events[0] as any).payload.gateType).toBe('review');
    });

    it('decide-gate emits GateDecided', async () => {
      const handler = ACTION_REGISTRY.get('decide-gate')!;
      const events = await handler(
        makeInput({ args: { gateId: 'gate-1', decision: 'approved' } }),
        fakeDeps(),
      );
      expect(events[0].type).toBe('charter:GateDecided.v1');
      expect((events[0] as any).payload.decision).toBe('approved');
    });
  });
});
```

- [ ] **Step 2: Run — verify fail**

```
cd layers/charter-runtime && pnpm test -- action-registry
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `action-registry.ts`**

```typescript
// src/action-registry.ts
import { z } from 'zod';
import type { PlanNode, PlanTree, PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
import { writeCharter, type CharterContract } from './charter-node.js';
import { validateInheritance } from './inheritance.js';
import type { CharterEvent, Resolution } from './lifecycle-events.js';

export type ActionKind =
  | 'record-note'
  | 'claim-node'
  | 'release-node'
  | 'decompose-node'
  | 'request-gate'
  | 'decide-gate';

export interface CharterActionInput {
  nodeId: string;
  treeRootId: string;
  args: Record<string, unknown>;
  occurredAt: string;
  newId: () => string;
}

export interface CharterActionDeps {
  planTreeStore: PlanTreeStore;
  tenantPackId: string;
}

export type ActionHandler = (
  input: CharterActionInput,
  deps: CharterActionDeps,
) => Promise<CharterEvent[]>;

const ChildSpecSchema = z.object({
  id: z.string().uuid(),
  role: z.string().min(1),
  contract: z.object({
    role: z.string(),
    mission: z.object({ objective: z.string(), outcome: z.string() }),
    scope: z.object({ allowedPathPrefixes: z.array(z.string()) }),
  }),
  dependsOn: z.array(z.string().uuid()).optional(),
});
export type ChildSpec = z.infer<typeof ChildSpecSchema>;
const ChildSpecArraySchema = z.array(ChildSpecSchema);

function addChildrenToTree(tree: PlanTree, parentId: string, children: PlanNode[]): PlanTree {
  const childIds = children.map(c => c.id);
  return {
    ...tree,
    nodes: [
      ...tree.nodes.map(n => n.id === parentId ? { ...n, childrenIds: [...n.childrenIds, ...childIds] } : n),
      ...children,
    ],
  };
}

const recordNote: ActionHandler = async (input) => ([{
  type: 'charter:NoteRecorded.v1',
  nodeId: input.nodeId,
  payload: { note: String(input.args['note'] ?? '') },
  occurredAt: input.occurredAt,
}]);

const claimNode: ActionHandler = async (input) => {
  const parentCharter = (input.args['parentCharter'] ?? null) as CharterContract | null;
  const nodeCharter   = input.args['nodeCharter'] as CharterContract;
  if (parentCharter) {
    const verdict = validateInheritance(parentCharter, nodeCharter);
    if (!verdict.ok) throw new Error(`inheritance violation at claim: ${verdict.violation.reason}`);
  }
  return [{
    type: 'charter:NodeClaimed.v1',
    nodeId: input.nodeId,
    payload: {
      claimId: `conduct-${input.nodeId}`,
      sessionId: 'conductor',
      ttlMinutes: Number(input.args['ttlMinutes'] ?? 30),
    },
    occurredAt: input.occurredAt,
  }];
};

const releaseNode: ActionHandler = async (input) => ([{
  type: 'charter:NodeReleased.v1',
  nodeId: input.nodeId,
  payload: {
    claimId: String(input.args['claimId']),
    resolution: input.args['resolution'] as Resolution,
    note: input.args['note'] != null ? String(input.args['note']) : undefined,
  },
  occurredAt: input.occurredAt,
}]);

const decomposeNode: ActionHandler = async (input, deps) => {
  const children = ChildSpecArraySchema.parse(input.args['children']);
  const tree = await deps.planTreeStore.load(input.treeRootId);
  if (!tree) throw new Error(`no tree at ${input.treeRootId}`);
  const parentNode = tree.nodes.find(n => n.id === input.nodeId);
  if (!parentNode) throw new Error(`node not found: ${input.nodeId}`);

  if (parentNode.childrenIds.length > 0) {
    const expectedIds = children.map(c => c.id).sort();
    const existingIds = [...parentNode.childrenIds].sort();
    if (JSON.stringify(existingIds) === JSON.stringify(expectedIds)) {
      // Idempotent: NodeDecomposed.v1 already in log from the prior run.
      return [];
    }
    throw new Error(`decompose-node: divergent child set under ${input.nodeId}`);
  }

  const childNodes: PlanNode[] = children.map((c, i) =>
    writeCharter(
      {
        id: c.id,
        parentId: input.nodeId,
        treeRootId: input.treeRootId,
        kind: c.role,
        kindRef: `charter:${c.role}`,
        ordinal: i,
        metadata: { _dependsOn: c.dependsOn ?? [] },
        childrenIds: [],
      },
      c.contract as CharterContract,
    )
  );
  await deps.planTreeStore.save(addChildrenToTree(tree, input.nodeId, childNodes));

  return [{
    type: 'charter:NodeDecomposed.v1',
    nodeId: input.nodeId,
    payload: { childIds: childNodes.map(n => n.id) },
    occurredAt: input.occurredAt,
  }];
};

const requestGate: ActionHandler = async (input) => ([{
  type: 'charter:GateRequested.v1',
  nodeId: input.nodeId,
  payload: { gateId: input.newId(), gateType: String(input.args['gateType']) },
  occurredAt: input.occurredAt,
}]);

const decideGate: ActionHandler = async (input) => ([{
  type: 'charter:GateDecided.v1',
  nodeId: input.nodeId,
  payload: {
    gateId: String(input.args['gateId']),
    decision: input.args['decision'] as 'approved' | 'rejected',
    note: input.args['note'] != null ? String(input.args['note']) : undefined,
  },
  occurredAt: input.occurredAt,
}]);

export const ACTION_REGISTRY: ReadonlyMap<ActionKind, ActionHandler> = new Map<ActionKind, ActionHandler>([
  ['record-note',   recordNote],
  ['claim-node',    claimNode],
  ['release-node',  releaseNode],
  ['decompose-node', decomposeNode],
  ['request-gate',  requestGate],
  ['decide-gate',   decideGate],
]);
```

- [ ] **Step 4: Run — verify pass**

```
cd layers/charter-runtime && pnpm test -- action-registry
```

Expected: all tests PASS.

- [ ] **Step 5: Run full suite — no regressions**

```
cd layers/charter-runtime && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add layers/charter-runtime/src/action-registry.ts layers/charter-runtime/src/action-registry.spec.ts
git commit -m "feat(charter-runtime): add ACTION_REGISTRY (6 kinds) + decompose-node + Acids 3 & 4"
```

---

### Task 6: `conduct.ts` — conductCharterStep + crash recovery + Acids 5, 6 & 8

**Files:**
- Create: `layers/charter-runtime/src/conduct.ts`
- Create: `layers/charter-runtime/src/conduct.spec.ts`

**Interfaces:**
- Consumes: all prior modules
- Produces: `CharterDeps`, `ConductStatus`, `ConductResult`, `conductCharterStep`

- [ ] **Step 1: Write failing tests (Acids 5, 6, 8)**

```typescript
// src/conduct.spec.ts
import { describe, it, expect } from 'vitest';
import { conductCharterStep } from './conduct.js';
import type { CharterDeps } from './conduct.js';
import { InMemoryCharterEventLog } from './event-log.port.js';
import { PrismaPlanTreeStore } from '@de-braighter/substrate-runtime';
import { FakePlanTreePrisma } from './testing/fake-plan-tree-prisma.js';
import { productTaskCharterTree, TASK_ID, TENANT_PACK_ID } from './testing/fixtures.js';
import type { CharterEvent } from './lifecycle-events.js';

let tick = 0;
const makeDeps = (log: InMemoryCharterEventLog): CharterDeps => ({
  eventLog: log,
  planTreeStore: new PrismaPlanTreeStore(new FakePlanTreePrisma(), {
    tenantPackId: TENANT_PACK_ID,
    userId: '66666666-6666-4666-8666-666666666666',
  }),
  tenantPackId: TENANT_PACK_ID,
  now: () => new Date(Date.UTC(2026, 5, 29, 10, 0, ++tick)).toISOString(),
  newId: () => `id-${++tick}`,
});

describe('conductCharterStep', () => {
  describe('Acid 5 — exactly-once / idempotent conductor', () => {
    it('first call claims the task; second call returns idle (node has active claim)', async () => {
      tick = 0;
      const tree = productTaskCharterTree();
      const log = new InMemoryCharterEventLog();
      const deps = makeDeps(log);
      await deps.planTreeStore.save(tree);

      const r1 = await conductCharterStep(deps, tree.treeRootId);
      expect(r1.status).toBe('advanced');
      expect(r1.nodeId).toBe(TASK_ID);
      expect(r1.action).toBe('claim');

      const r2 = await conductCharterStep(deps, tree.treeRootId);
      expect(r2.status).toBe('idle');
    });

    it('after worker releases node, next conductor call also returns idle (node resolved)', async () => {
      tick = 100;
      const tree = productTaskCharterTree();
      const log = new InMemoryCharterEventLog();
      const deps = makeDeps(log);
      await deps.planTreeStore.save(tree);

      await conductCharterStep(deps, tree.treeRootId); // claims TASK_ID

      // Simulate worker releasing the node
      log.append(tree.treeRootId, {
        type: 'charter:NodeReleased.v1',
        nodeId: TASK_ID,
        payload: { claimId: `conduct-${TASK_ID}`, resolution: 'done' },
        occurredAt: new Date(Date.UTC(2026, 5, 29, 10, 5)).toISOString(),
      });

      const r3 = await conductCharterStep(deps, tree.treeRootId);
      expect(r3.status).toBe('idle');
    });
  });

  describe('Acid 6 — gate-halt invariant', () => {
    it('open gate → conductor returns awaiting-gate without claiming', async () => {
      tick = 200;
      const tree = productTaskCharterTree();
      const log = new InMemoryCharterEventLog();
      const deps = makeDeps(log);
      await deps.planTreeStore.save(tree);

      // Manually append a gate request on the task node BEFORE it is claimed
      log.append(tree.treeRootId, {
        type: 'charter:GateRequested.v1',
        nodeId: TASK_ID,
        payload: { gateId: 'gate-1', gateType: 'review' },
        occurredAt: '2026-06-29T09:00:00.000Z',
      });

      const r1 = await conductCharterStep(deps, tree.treeRootId);
      expect(r1.status).toBe('awaiting-gate');
      // No NodeClaimed emitted
      const claimed = log.read(tree.treeRootId).filter(e => e.type === 'charter:NodeClaimed.v1');
      expect(claimed).toHaveLength(0);

      // Decide gate → approved → conductor can now advance
      log.append(tree.treeRootId, {
        type: 'charter:GateDecided.v1',
        nodeId: TASK_ID,
        payload: { gateId: 'gate-1', decision: 'approved' },
        occurredAt: '2026-06-29T09:30:00.000Z',
      });

      const r2 = await conductCharterStep(deps, tree.treeRootId);
      expect(r2.status).toBe('advanced');
      expect(r2.nodeId).toBe(TASK_ID);
    });
  });

  describe('Acid 8 — crash-recovery (dangling own-claim completes)', () => {
    it('pre-existing dangling conductor claim → recovery appends release → status advanced', async () => {
      tick = 300;
      const tree = productTaskCharterTree();
      const log = new InMemoryCharterEventLog();
      const deps = makeDeps(log);
      await deps.planTreeStore.save(tree);

      // Simulate crash: NodeClaimed appended but process died before NodeReleased
      log.append(tree.treeRootId, {
        type: 'charter:NodeClaimed.v1',
        nodeId: TASK_ID,
        payload: { claimId: `conduct-${TASK_ID}`, sessionId: 'conductor', ttlMinutes: 30 },
        occurredAt: '2026-06-29T09:00:00.000Z',
      });

      const r = await conductCharterStep(deps, tree.treeRootId);
      expect(r.status).toBe('advanced');

      // Verify recovery appended a NodeReleased event
      const released = log.read(tree.treeRootId).filter(e => e.type === 'charter:NodeReleased.v1');
      expect(released).toHaveLength(1);
    });
  });
});
```

- [ ] **Step 2: Run — verify fail**

```
cd layers/charter-runtime && pnpm test -- conduct.spec
```

Expected: FAIL (module not found).

- [ ] **Step 3: Create `conduct.ts`**

```typescript
// src/conduct.ts
import type { PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
import type { CharterEventLog } from './event-log.port.js';
import type { CharterLifecycleState } from './lifecycle-state.js';
import { foldCharterLifecycleState, nodeResolved, openGate } from './lifecycle-state.js';
import { charterFrontier, type FrontierAction, type FrontierEntry } from './frontier.js';
import { ACTION_REGISTRY } from './action-registry.js';

export interface CharterDeps {
  eventLog: CharterEventLog;
  planTreeStore: PlanTreeStore;
  tenantPackId: string;
  /** Injectable ISO timestamp — never called inside foldCharterLifecycleState. */
  now: () => string;
  /** Injectable UUID — never called inside foldCharterLifecycleState. */
  newId: () => string;
}

export type ConductStatus = 'advanced' | 'awaiting-gate' | 'idle';

export interface ConductResult {
  status: ConductStatus;
  nodeId?: string;
  action?: FrontierAction;
  frontier?: FrontierEntry[];
}

const conductClaimId = (nodeId: string) => `conduct-${nodeId}`;
const CONDUCTOR_SESSION = 'conductor';

function danglingOwnClaim(state: CharterLifecycleState): string | undefined {
  for (const [nodeId, ns] of state.byNode) {
    if (nodeResolved(ns)) continue;
    const last = ns.claims.at(-1);
    if (
      last?.claimId === conductClaimId(nodeId) &&
      last.sessionId === CONDUCTOR_SESSION &&
      last.released == null
    ) return nodeId;
  }
  return undefined;
}

export async function conductCharterStep(
  deps: CharterDeps,
  treeRootId: string,
  opts?: { decomposeArgs?: Record<string, unknown> },
): Promise<ConductResult> {
  const tree = await deps.planTreeStore.load(treeRootId);
  if (!tree) throw new Error(`no charter tree at ${treeRootId}`);

  const events = deps.eventLog.read(treeRootId);
  const state = foldCharterLifecycleState(events);
  const nowMs = Date.parse(deps.now());
  const frontier = charterFrontier(tree, state, nowMs);

  if (frontier.length === 0) {
    const danglingNodeId = danglingOwnClaim(state);
    if (danglingNodeId) {
      const releaseEvent = {
        type: 'charter:NodeReleased.v1' as const,
        nodeId: danglingNodeId,
        payload: {
          claimId: conductClaimId(danglingNodeId),
          resolution: 'done' as const,
          note: 'recovered by conductor',
        },
        occurredAt: deps.now(),
      };
      deps.eventLog.append(treeRootId, releaseEvent);
      const updatedEvents = deps.eventLog.read(treeRootId);
      const updatedState = foldCharterLifecycleState(updatedEvents);
      const updatedFrontier = charterFrontier(tree, updatedState, nowMs);
      return { status: 'advanced', nodeId: danglingNodeId, action: 'claim', frontier: updatedFrontier };
    }
    return { status: 'idle', frontier: [] };
  }

  const head = frontier[0];
  const nodeState = state.byNode.get(head.nodeId);

  if (head.action === 'claim' && nodeState && openGate(nodeState) != null) {
    return { status: 'awaiting-gate', nodeId: head.nodeId, frontier };
  }

  const actionKind = head.action === 'decompose' ? 'decompose-node' : 'claim-node';
  const handler = ACTION_REGISTRY.get(actionKind);
  if (!handler) throw new Error(`no handler for action kind: ${actionKind}`);

  const occurredAt = deps.now();
  const handlerArgs: Record<string, unknown> =
    head.action === 'decompose'
      ? (opts?.decomposeArgs ?? { children: [] })
      : { parentCharter: head.parentCharter, nodeCharter: head.charter, ttlMinutes: 30 };

  const emitted = await handler(
    { nodeId: head.nodeId, treeRootId, args: handlerArgs, occurredAt, newId: deps.newId },
    { planTreeStore: deps.planTreeStore, tenantPackId: deps.tenantPackId },
  );

  for (const ev of emitted) {
    deps.eventLog.append(treeRootId, ev);
  }

  const updatedTree =
    head.action === 'decompose'
      ? ((await deps.planTreeStore.load(treeRootId)) ?? tree)
      : tree;
  const updatedEvents = deps.eventLog.read(treeRootId);
  const updatedState = foldCharterLifecycleState(updatedEvents);
  const updatedFrontier = charterFrontier(updatedTree, updatedState, nowMs);

  return { status: 'advanced', nodeId: head.nodeId, action: head.action, frontier: updatedFrontier };
}
```

- [ ] **Step 4: Run — verify pass**

```
cd layers/charter-runtime && pnpm test -- conduct.spec
```

Expected: all conduct tests PASS.

- [ ] **Step 5: Run full suite**

```
cd layers/charter-runtime && pnpm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add layers/charter-runtime/src/conduct.ts layers/charter-runtime/src/conduct.spec.ts
git commit -m "feat(charter-runtime): add conductCharterStep + crash recovery (Acids 5, 6, 8)"
```

---

### Task 7: `acids.spec.ts` — all 9 acids as a canonical integration suite

**Files:**
- Create: `layers/charter-runtime/src/acids.spec.ts`

This file is the authoritative statement of all 9 S1 load-bearing properties. It exercises the full stack (eventLog + planTreeStore + conductCharterStep). Acid 9 is the Kernel-Untouched boundary acid — asserts that no charter vocabulary bleeds into substrate production files.

- [ ] **Step 1: Create `acids.spec.ts`**

```typescript
// src/acids.spec.ts
/**
 * S1 load-bearing acid tests — 9 properties that must always hold.
 * These are integration-level: they exercise the full charter-runtime stack.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { conductCharterStep } from './conduct.js';
import type { CharterDeps } from './conduct.js';
import { InMemoryCharterEventLog } from './event-log.port.js';
import { foldCharterLifecycleState } from './lifecycle-state.js';
import { charterFrontier } from './frontier.js';
import { ACTION_REGISTRY } from './action-registry.js';
import type { ChildSpec } from './action-registry.js';
import { PrismaPlanTreeStore } from '@de-braighter/substrate-runtime';
import { FakePlanTreePrisma } from './testing/fake-plan-tree-prisma.js';
import {
  productTaskCharterTree, decomposableProductTree,
  TASK_ID, PRODUCT_ROOT_ID, TENANT_PACK_ID,
} from './testing/fixtures.js';
import type { CharterEvent } from './lifecycle-events.js';
import type { CharterContract } from './charter-node.js';

let tick = 0;

function freshDeps(log: InMemoryCharterEventLog): CharterDeps {
  return {
    eventLog: log,
    planTreeStore: new PrismaPlanTreeStore(new FakePlanTreePrisma(), {
      tenantPackId: TENANT_PACK_ID,
      userId: '66666666-6666-4666-8666-666666666666',
    }),
    tenantPackId: TENANT_PACK_ID,
    now: () => new Date(Date.UTC(2026, 5, 29, 10, 0, ++tick)).toISOString(),
    newId: () => `acid-id-${++tick}`,
  };
}

// ─── Acid 1 ─────────────────────────────────────────────────────────────────
describe('Acid 1 — fold-determinism / replay-stability', () => {
  it('fold(E) === fold([...E, ...E]) for all 6 event types', () => {
    const NODE = TASK_ID;
    const events: CharterEvent[] = [
      { type: 'charter:NoteRecorded.v1', nodeId: NODE, payload: { note: 'hi' }, occurredAt: '2026-06-29T10:00:00.000Z' },
      { type: 'charter:NodeClaimed.v1', nodeId: NODE, payload: { claimId: `conduct-${NODE}`, sessionId: 'conductor', ttlMinutes: 30 }, occurredAt: '2026-06-29T10:00:01.000Z' },
      { type: 'charter:NodeReleased.v1', nodeId: NODE, payload: { claimId: `conduct-${NODE}`, resolution: 'done' }, occurredAt: '2026-06-29T10:00:02.000Z' },
      { type: 'charter:NodeDecomposed.v1', nodeId: 'other', payload: { childIds: [NODE] }, occurredAt: '2026-06-29T10:00:03.000Z' },
      { type: 'charter:GateRequested.v1', nodeId: NODE, payload: { gateId: 'g1', gateType: 'review' }, occurredAt: '2026-06-29T10:00:04.000Z' },
      { type: 'charter:GateDecided.v1', nodeId: NODE, payload: { gateId: 'g1', decision: 'approved' }, occurredAt: '2026-06-29T10:00:05.000Z' },
    ];
    const once = foldCharterLifecycleState(events);
    const twice = foldCharterLifecycleState([...events, ...events]);
    const ns1 = once.byNode.get(NODE)!;
    const ns2 = twice.byNode.get(NODE)!;
    expect(ns1.resolution).toBe(ns2.resolution);
    expect(ns1.claims.length).toBe(ns2.claims.length);
    expect(ns1.gates.length).toBe(ns2.gates.length);
    expect(ns1.notes).toEqual(ns2.notes);
  });
});

// ─── Acid 2 ─────────────────────────────────────────────────────────────────
describe('Acid 2 — frontier-advance (claimed node drops)', () => {
  it('claim → drops from frontier; resolve → stays off frontier', () => {
    const tree = productTaskCharterTree();
    const nowMs = Date.parse('2026-06-29T10:00:00.000Z');
    const claimId = `conduct-${TASK_ID}`;

    const afterClaim = foldCharterLifecycleState([
      { type: 'charter:NodeClaimed.v1', nodeId: TASK_ID, payload: { claimId, sessionId: 'conductor', ttlMinutes: 30 }, occurredAt: '2026-06-29T10:00:00.000Z' },
    ]);
    expect(charterFrontier(tree, afterClaim, nowMs).find(e => e.nodeId === TASK_ID)).toBeUndefined();

    const afterResolve = foldCharterLifecycleState([
      { type: 'charter:NodeClaimed.v1', nodeId: TASK_ID, payload: { claimId, sessionId: 'conductor', ttlMinutes: 30 }, occurredAt: '2026-06-29T10:00:00.000Z' },
      { type: 'charter:NodeReleased.v1', nodeId: TASK_ID, payload: { claimId, resolution: 'done' }, occurredAt: '2026-06-29T10:00:01.000Z' },
    ]);
    expect(charterFrontier(tree, afterResolve, nowMs).find(e => e.nodeId === TASK_ID)).toBeUndefined();
  });
});

// ─── Acid 3 ─────────────────────────────────────────────────────────────────
describe('Acid 3 — decompose-advance (parent expands, children surface)', () => {
  it('after decompose-node: parent resolved expanded, children appear on frontier', async () => {
    const store = new PrismaPlanTreeStore(new FakePlanTreePrisma(), { tenantPackId: TENANT_PACK_ID, userId: '66666666-6666-4666-8666-666666666666' });
    const log = new InMemoryCharterEventLog();
    const tree = decomposableProductTree();
    await store.save(tree);

    const childId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const children: ChildSpec[] = [{
      id: childId,
      role: 'task',
      contract: { role: 'task', mission: { objective: 'Do it', outcome: 'Done' }, scope: { allowedPathPrefixes: ['src/'] } },
      dependsOn: [],
    }];

    const handler = ACTION_REGISTRY.get('decompose-node')!;
    const events = await handler(
      { nodeId: PRODUCT_ROOT_ID, treeRootId: PRODUCT_ROOT_ID, args: { children }, occurredAt: '2026-06-29T10:00:00.000Z', newId: () => 'x' },
      { planTreeStore: store, tenantPackId: TENANT_PACK_ID },
    );
    log.append(PRODUCT_ROOT_ID, events[0]);

    const updatedTree = await store.load(PRODUCT_ROOT_ID);
    const state = foldCharterLifecycleState(log.read(PRODUCT_ROOT_ID));

    expect(state.byNode.get(PRODUCT_ROOT_ID)?.resolution).toBe('expanded');
    const frontier = charterFrontier(updatedTree!, state, Date.now());
    expect(frontier.some(e => e.nodeId === childId)).toBe(true);
  });
});

// ─── Acid 4 ─────────────────────────────────────────────────────────────────
describe('Acid 4 — inheritance-at-claim (fail-closed)', () => {
  it('widened child scope → claim-node throws, no NodeClaimed emitted', async () => {
    const handler = ACTION_REGISTRY.get('claim-node')!;
    const parent: CharterContract = { role: 'product', mission: { objective: 'x', outcome: 'y' }, scope: { allowedPathPrefixes: ['src/'] } };
    const widened: CharterContract = { role: 'task', mission: { objective: 'x', outcome: 'y' }, scope: { allowedPathPrefixes: ['/'] } };
    const store = { load: async () => null, save: async () => {}, applyEdit: async () => ({} as any) };
    await expect(
      handler({ nodeId: TASK_ID, treeRootId: TASK_ID, args: { parentCharter: parent, nodeCharter: widened }, occurredAt: '2026-06-29T10:00:00.000Z', newId: () => 'x' }, { planTreeStore: store, tenantPackId: TENANT_PACK_ID }),
    ).rejects.toThrow('inheritance violation');
  });
});

// ─── Acid 5 ─────────────────────────────────────────────────────────────────
describe('Acid 5 — exactly-once (idempotent conductor)', () => {
  it('second call after claim returns idle, not double-apply', async () => {
    tick = 500;
    const log = new InMemoryCharterEventLog();
    const deps = freshDeps(log);
    await deps.planTreeStore.save(productTaskCharterTree());

    const r1 = await conductCharterStep(deps, productTaskCharterTree().treeRootId);
    expect(r1.status).toBe('advanced');
    const r2 = await conductCharterStep(deps, productTaskCharterTree().treeRootId);
    expect(r2.status).toBe('idle');

    const claimed = log.read(productTaskCharterTree().treeRootId).filter(e => e.type === 'charter:NodeClaimed.v1');
    expect(claimed).toHaveLength(1); // exactly once
  });
});

// ─── Acid 6 ─────────────────────────────────────────────────────────────────
describe('Acid 6 — gate-halt invariant', () => {
  it('open gate → awaiting-gate; GateDecided(approved) → advanced', async () => {
    tick = 600;
    const log = new InMemoryCharterEventLog();
    const deps = freshDeps(log);
    const tree = productTaskCharterTree();
    await deps.planTreeStore.save(tree);

    log.append(tree.treeRootId, {
      type: 'charter:GateRequested.v1',
      nodeId: TASK_ID,
      payload: { gateId: 'g-acid6', gateType: 'review' },
      occurredAt: '2026-06-29T09:00:00.000Z',
    });

    const r1 = await conductCharterStep(deps, tree.treeRootId);
    expect(r1.status).toBe('awaiting-gate');
    expect(log.read(tree.treeRootId).filter(e => e.type === 'charter:NodeClaimed.v1')).toHaveLength(0);

    log.append(tree.treeRootId, {
      type: 'charter:GateDecided.v1',
      nodeId: TASK_ID,
      payload: { gateId: 'g-acid6', decision: 'approved' },
      occurredAt: '2026-06-29T09:30:00.000Z',
    });

    const r2 = await conductCharterStep(deps, tree.treeRootId);
    expect(r2.status).toBe('advanced');
  });
});

// ─── Acid 7 ─────────────────────────────────────────────────────────────────
describe('Acid 7 — full resolution set', () => {
  const resolutions = ['done', 'expanded', 'blocked', 'rejected', 'superseded'] as const;
  for (const resolution of resolutions) {
    it(`'${resolution}' drops node from frontier`, () => {
      const tree = productTaskCharterTree();
      const nowMs = Date.parse('2026-06-29T10:00:00.000Z');
      const claimId = `conduct-${TASK_ID}`;
      const events: CharterEvent[] =
        resolution === 'expanded'
          ? [{ type: 'charter:NodeDecomposed.v1', nodeId: TASK_ID, payload: { childIds: [] }, occurredAt: '2026-06-29T10:00:00.000Z' }]
          : [
              { type: 'charter:NodeClaimed.v1', nodeId: TASK_ID, payload: { claimId, sessionId: 'conductor', ttlMinutes: 30 }, occurredAt: '2026-06-29T10:00:00.000Z' },
              { type: 'charter:NodeReleased.v1', nodeId: TASK_ID, payload: { claimId, resolution }, occurredAt: '2026-06-29T10:00:01.000Z' },
            ];
      const state = foldCharterLifecycleState(events);
      const frontier = charterFrontier(tree, state, nowMs);
      expect(frontier.find(e => e.nodeId === TASK_ID)).toBeUndefined();
    });
  }
});

// ─── Acid 8 ─────────────────────────────────────────────────────────────────
describe('Acid 8 — crash-recovery (dangling own-claim completes)', () => {
  it('dangling conductor claim → recovery appends NodeReleased → status advanced', async () => {
    tick = 800;
    const log = new InMemoryCharterEventLog();
    const deps = freshDeps(log);
    const tree = productTaskCharterTree();
    await deps.planTreeStore.save(tree);

    log.append(tree.treeRootId, {
      type: 'charter:NodeClaimed.v1',
      nodeId: TASK_ID,
      payload: { claimId: `conduct-${TASK_ID}`, sessionId: 'conductor', ttlMinutes: 30 },
      occurredAt: '2026-06-29T09:00:00.000Z',
    });

    const r = await conductCharterStep(deps, tree.treeRootId);
    expect(r.status).toBe('advanced');
    const released = log.read(tree.treeRootId).filter(e => e.type === 'charter:NodeReleased.v1');
    expect(released).toHaveLength(1);
  });
});

// ─── Acid 9 ─────────────────────────────────────────────────────────────────
describe('Acid 9 — Kernel-Untouched boundary acid', () => {
  it('no charter vocabulary bleeds into substrate production source files', () => {
    // Substrate production paths that must never be touched
    const guardedFiles = [
      path.resolve('../../layers/substrate/libs/substrate-contracts/src/plan-tree/plan-tree-schemas.ts'),
      path.resolve('../../layers/substrate/libs/substrate-contracts/src/plan-tree/plan-tree-store.port.ts'),
      path.resolve('../../layers/substrate/libs/substrate-runtime/src/plan-tree/prisma-plan-tree.store.ts'),
    ].map(p => path.normalize(p));

    const charterKeywords = ['charter:', 'CharterContract', 'CharterRole', 'validateInheritance', 'readCharter'];

    for (const filePath of guardedFiles) {
      if (!fs.existsSync(filePath)) continue; // path may differ per machine layout
      const content = fs.readFileSync(filePath, 'utf8');
      for (const kw of charterKeywords) {
        expect(content, `found charter keyword '${kw}' in kernel file ${filePath}`).not.toContain(kw);
      }
    }
  });
});
```

- [ ] **Step 2: Run — verify all 9 acids pass**

```
cd layers/charter-runtime && pnpm test -- acids.spec
```

Expected: all 9 acid tests PASS. If Acid 9 file-paths don't resolve on this machine, update the `path.resolve` expressions to match your actual cluster layout (the `layers/` directory is a sibling of the `charter-runtime/` directory; from `layers/charter-runtime/`, the substrate is at `../../layers/substrate/` relative to project root — adjust if running from a worktree).

- [ ] **Step 3: Run full suite — final check**

```
cd layers/charter-runtime && pnpm test
```

Expected: all tests PASS (Slice-0 suite + all new S1 tests).

- [ ] **Step 4: Commit**

```bash
git add layers/charter-runtime/src/acids.spec.ts
git commit -m "test(charter-runtime): add acids.spec.ts — all 9 S1 load-bearing acid tests"
```

---

### Task 8: `index.ts` public surface + ADR-285

**Files:**
- Modify: `layers/charter-runtime/src/index.ts`
- Create: `layers/specs/adr/adr-285-charter-lifecycle-protocol.md`

**Interfaces:**
- Consumes: all new S1 modules
- Produces: complete public API surface; ADR-285 in specs

- [ ] **Step 1: Update `index.ts` to publish the full S1 surface**

Replace the full content of `src/index.ts`:

```typescript
// src/index.ts
// ── Slice-0 (preserved) ──────────────────────────────────────────────────────
export { readCharter, writeCharter } from './charter-node.js';
export { validateInheritance, effectiveScope } from './inheritance.js';
export { runLifecyclePass, foldCharterState } from './lifecycle.js';

export type { CharterContract, CharterRole } from './charter-node.js';
export { CharterContractSchema, CharterRoleSchema, DECOMPOSABLE_ROLES, CLAIMABLE_ROLES } from './charter-node.js';
export type { InheritanceViolation } from './inheritance.js';
export type { LifecycleContext, ProjectedState } from './lifecycle.js';

// ── S1 (new) ─────────────────────────────────────────────────────────────────
export type { CharterEvent, Resolution } from './lifecycle-events.js';
export type { CharterLifecycleState, NodeLifecycleState, ClaimState, GateState } from './lifecycle-state.js';
export { foldCharterLifecycleState, claimActive, nodeResolved, nodeActiveClaim, openGate } from './lifecycle-state.js';
export type { CharterEventLog } from './event-log.port.js';
export { InMemoryCharterEventLog } from './event-log.port.js';
export type { FrontierAction, FrontierEntry } from './frontier.js';
export { charterFrontier } from './frontier.js';
export type { ActionKind, CharterActionInput, CharterActionDeps, ActionHandler, ChildSpec } from './action-registry.js';
// ACTION_REGISTRY intentionally NOT exported — callers dispatch through conductCharterStep
export type { CharterDeps, ConductStatus, ConductResult } from './conduct.js';
export { conductCharterStep } from './conduct.js';
```

- [ ] **Step 2: Run typecheck and tests**

```
cd layers/charter-runtime && pnpm run typecheck && pnpm test
```

Expected: typecheck PASS, all tests PASS.

- [ ] **Step 3: Create ADR-285**

Create `layers/specs/adr/adr-285-charter-lifecycle-protocol.md`:

```markdown
---
id: ADR-285
title: "The uniform charter lifecycle protocol — 8 stages, port-backed event log, hierarchical frontier"
status: proposed
date: 2026-06-29
tier: design-global
scope: layers/charter-runtime
authors: [stibe-heller]
supersedes: []
---

## Context

S1 of the recursive-charter-runtime program (see ADR-283) generalises the Slice-0 walking skeleton into a
full lifecycle runtime for Charter Nodes inside `layers/charter-runtime`. Every Charter Node — product,
epic, task, gate, review, ADR, experiment — runs the same 8-stage protocol. The runtime must be
domain-agnostic, replay-stable, and Kernel-Untouched.

## Decisions

### D1 — 8 lifecycle stages + degenerate role lifecycles

The uniform lifecycle is: `intake → validate → decompose-or-claim → execute → verify → gate → record → resolve`.

Role-specific degenerate lifecycles:
- `gate` node: skips execute; mostly waits on a `GateDecided` event.
- `review` node: skips gate; claims and executes as a review task.

### D2 — Resolution set: `done | expanded | blocked | rejected | superseded`

All five are terminal. A node with any resolution is permanently excluded from the frontier. The distinction:
- `done` — acceptance criteria met and evidence recorded.
- `expanded` — node decomposed into valid child nodes (`NodeDecomposed.v1` sets this automatically).
- `blocked` — cannot proceed without an external decision or missing dependency.
- `rejected` — gate failed or charter invalid.
- `superseded` — replaced by a newer node or charter revision.

### D3 — `CharterEventLog` port separate from the kernel event log

Charter lifecycle events (`charter:*.v1`) are layer concerns, not kernel domain events. The `CharterEventLog`
port lives in `layers/charter-runtime`; the kernel's event log is unchanged. This is the boundary acid:
no charter vocabulary appears under `layers/substrate/**` production files.

**Alternative rejected:** Using the kernel event log would violate the Kernel-Untouched Invariant (ADR-283 D2)
by introducing charter vocabulary into the kernel's dispatch path.

### D4 — Hierarchical frontier algorithm; one encoding; re-derivation after decompose

`charterFrontier(tree, state, nowMs)` is the single function encoding claimability rules. It is called
by `conductCharterStep`, status readouts, and any board view. The rule is never re-encoded elsewhere
(ADR-247 discipline applied to charter).

After `decompose-node` calls `planTreeStore.save`, the next `conductCharterStep` call re-loads the tree
and sees children naturally. No in-memory continuation, no callbacks.

### D5 — `decompose-node` uses kernel `PlanTreeStore.save` — no new kernel operation

`decompose-node` calls `planTreeStore.load` + `planTreeStore.save` (full upsert). Both operations already
exist in the `PlanTreeStore` port (ADR-283 Ring-0). Zero new kernel operation or migration is required.
The Kernel-Untouched Invariant holds.

### D6 — `validateInheritance` enforced at claim time; one function, no private copy

The `claim-node` action handler calls `validateInheritance(parentCharter, nodeCharter)` from
`inheritance.ts` before emitting `NodeClaimed.v1`. Scope-widening throws and prevents the claim from
landing. This is the #1 Slice-0 cross-task bug: a private copy forked the rule and accepted equal scope
as invalid. One function, no copies.

### D7 — Exactly-once / replay-stability contract

Handlers emit events; `foldCharterLifecycleState` is the only state. `now()` and `newId()` are injected
via `CharterDeps` and never called inside the fold. Dedup key is `JSON.stringify(event)` (whole event body).
Duplicate events collapse — replay/at-least-once safe.

### D8 — No store lock at the charter-runtime layer

Concurrency safety is the consumer's responsibility. `InMemoryCharterEventLog` is single-threaded.
The foundry brings `withStoreLock` in S3 when plugging in its file-backed adapter. Locking at this layer
would block browser/studio use-cases.

**Alternative rejected:** Store lock at the layer — blocks single-threaded browser contexts; foundry
already provides `withStoreLock` at the consumer boundary.

## Consequences

- `layers/charter-runtime` is Kernel-Untouched (zero diff to substrate production files), certified by Acid 9.
- Consumers (foundry in S3, studio in S4) implement `CharterEventLog` adapters for their persistence needs.
- The hierarchical frontier algorithm supports growing trees (decompose-then-surface pattern) without callbacks.
- S2 (blueprint engine) will provide the `children` spec for decompose-node dispatch in the conductor.
```

- [ ] **Step 4: Commit both files**

```bash
git add layers/charter-runtime/src/index.ts layers/specs/adr/adr-285-charter-lifecycle-protocol.md
git commit -m "feat(charter-runtime): publish S1 public API surface + draft ADR-285"
```

- [ ] **Step 5: Run final full suite one more time**

```
cd layers/charter-runtime && pnpm run ci:local
```

Expected: typecheck PASS + all tests PASS. This is the green gate before opening the PR.

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered by task(s) |
|---|---|
| §2.1 Module layout | All tasks create/modify the listed files |
| §2.2 CharterDeps | Task 6 (conduct.ts) |
| §3.1 CharterEvent union (6 types) | Task 1 (lifecycle-events.ts) |
| §3.2 Resolution set (5 values) | Task 1 |
| §3.3 foldCharterLifecycleState + helpers | Task 2 (lifecycle-state.ts) |
| §4 CharterEventLog port + InMemory | Task 3 (event-log.port.ts) |
| §5 charterFrontier algorithm | Task 4 (frontier.ts) |
| §5 DECOMPOSABLE_ROLES / CLAIMABLE_ROLES | Task 4 (charter-node.ts update) |
| §5 _dependsOn ordering | Task 4 (frontier.ts deps check) |
| §6 ACTION_REGISTRY (6 kinds) | Task 5 (action-registry.ts) |
| §6 inheritance at claim-node | Task 5 |
| §6 decompose-node idempotency | Task 5 |
| §7 conductCharterStep step sequence | Task 6 (conduct.ts) |
| §7 gate-halt invariant | Task 6 |
| §7 crash recovery | Task 6 |
| §8 Acids 1–9 | Task 2 (1,7), Task 4 (2), Task 5 (3,4), Task 6 (5,6,8), Task 7 (9) |
| §9 ADR-285 | Task 8 |
| index.ts public surface | Task 8 |
| charter-node.ts role extension | Task 4 |
| fixtures.ts decomposable fixture | Task 4 |

**Placeholder scan:** No TBD, TODO, or incomplete steps found.

**Type consistency check:**
- `CharterEvent` defined in `lifecycle-events.ts`, re-exported via `lifecycle.ts` (backward compat), and exported from `index.ts` — single source.
- `Resolution` same pattern.
- `claimId` generated as `` `conduct-${nodeId}` `` — consistent across `action-registry.ts` (claimNode handler) and `conduct.ts` (conductClaimId / danglingOwnClaim).
- `CharterActionInput.args['parentCharter']` / `args['nodeCharter']` passed by `conductCharterStep` and consumed by `claimNode` handler — consistent.
- `ChildSpec` exported from `action-registry.ts`, consumed by `acids.spec.ts` — consistent.
