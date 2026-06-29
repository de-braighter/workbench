# Foundry Live Status Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each work-item node's stored seed `status` with its live event-log-derived `itemStatus`, joined server-side in the foundry `/api/catalog` handler, so the studio Details panel shows live truth (zero studio change).

**Architecture:** A new pure module `src/dashboard/live-status.ts` folds the canonical log into an `itemId → ItemStatus` map and merges it into the cascade nodes' `metadata.status` before `mapNodesToCatalog`. The `/api/catalog` handler folds per request (the pattern `/api/snapshot` already uses), inside a try/catch that falls back to seed statuses.

**Tech Stack:** TypeScript ESM, Node `http` (foundry dashboard), Vitest. Spec: `docs/superpowers/specs/2026-06-29-foundry-live-status-join-design.md`.

## Global Constraints

- ZERO kernel change · ZERO studio change · read-only · ADR-176-aligned (pure derivation on read; nothing persisted).
- The live status REPLACES `metadata.status` only where the node's `metadata.itemId` (a string) matches a folded item; a node with no match keeps its seed status; a node with no `itemId` is unchanged.
- `mergeLiveStatus` is pure — it must NOT mutate the input nodes (return new node objects; leave the source `metadata` untouched).
- Fail-soft: if folding the log throws, skip the merge — nodes keep seed status; never crash the endpoint.
- `/api/plan-tree` is unchanged (the flat panel shows no status).
- Only `/api/catalog` gains the join; the studio is untouched.
- Test command (from `domains/foundry`): `npx vitest run <file>` ; typecheck `npm run typecheck`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/dashboard/live-status.ts` | **Create** | `buildStatusByItemId(state, nowMs)` + `mergeLiveStatus(nodes, map)` — pure |
| `src/dashboard/live-status.spec.ts` | **Create** | unit tests for both functions |
| `src/dashboard/server.ts` | Modify | `/api/catalog` handler: fold → buildStatusByItemId → mergeLiveStatus before mapping |
| `test/dashboard-catalog-endpoints.acid.test.ts` | Modify | integration: live status overrides seed in the served catalog |

---

## Task 1 — Pure `live-status.ts` (`buildStatusByItemId` + `mergeLiveStatus`)

**Repo:** `domains/foundry`. Branch `feat/live-status-join` from `main`.

**Files:**
- Create: `src/dashboard/live-status.ts`
- Create: `src/dashboard/live-status.spec.ts`

**Interfaces:**
- Consumes: `fold`, `itemStatus`, `DerivedState`, `ItemStatus` from `../state.js`; `PlanNode` from `@de-braighter/substrate-contracts/plan-tree`.
- Produces: `buildStatusByItemId(state: DerivedState, nowMs: number): Map<string, ItemStatus>` and `mergeLiveStatus(nodes: readonly PlanNode[], statusByItemId: ReadonlyMap<string, ItemStatus>): PlanNode[]` — consumed by Task 2.

---

- [ ] **Step 1.1: Create the branch**

```bash
# in D:/development/projects/de-braighter/domains/foundry
git checkout main && git checkout -b feat/live-status-join
```

- [ ] **Step 1.2: Write the failing tests**

Create `src/dashboard/live-status.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import { fold, type ItemStatus } from '../state.js';
import { itemQueued } from '../events.js';
import { buildStatusByItemId, mergeLiveStatus } from './live-status.js';

const T0 = '2026-06-18T10:00:00.000Z';
const NOW = Date.parse(T0);

function node(id: string, metadata: Record<string, unknown>): PlanNode {
  return {
    id, parentId: null, treeRootId: id, kind: 'work-item', kindRef: 'work-item',
    ordinal: 0, metadata, childrenIds: [],
  };
}

describe('buildStatusByItemId', () => {
  it('maps each folded item to its live itemStatus', () => {
    const state = fold([
      itemQueued({ itemId: 'foundry/a', productKey: 'foundry', title: 'A', scope: { repo: 'r', issue: 1 }, ts: T0 }),
      itemQueued({ itemId: 'foundry/b', productKey: 'foundry', title: 'B', scope: { repo: 'r', issue: 2 }, ts: T0 }),
    ]);
    const map = buildStatusByItemId(state, NOW);
    expect(map.get('foundry/a')).toBe('queued');
    expect(map.get('foundry/b')).toBe('queued');
    expect(map.size).toBe(2);
  });
});

describe('mergeLiveStatus', () => {
  const map = new Map<string, ItemStatus>([['foundry/a', 'built']]);

  it('replaces metadata.status when the node itemId matches', () => {
    const out = mergeLiveStatus([node('n1', { itemId: 'foundry/a', status: 'done' })], map);
    expect(out[0]!.metadata['status']).toBe('built');
    expect(out[0]!.metadata['itemId']).toBe('foundry/a');
  });

  it('keeps the seed status when the node itemId is absent from the map', () => {
    const out = mergeLiveStatus([node('n1', { itemId: 'foundry/unknown', status: 'done' })], map);
    expect(out[0]!.metadata['status']).toBe('done');
  });

  it('leaves nodes with no itemId unchanged', () => {
    const out = mergeLiveStatus([node('n1', { title: 'cap' })], map);
    expect(out[0]!.metadata['status']).toBeUndefined();
  });

  it('does not mutate the input node metadata', () => {
    const input = node('n1', { itemId: 'foundry/a', status: 'done' });
    mergeLiveStatus([input], map);
    expect(input.metadata['status']).toBe('done');
  });
});
```

- [ ] **Step 1.3: Run them — verify they fail**

```bash
npx vitest run src/dashboard/live-status.spec.ts
```

Expected: FAIL — `Cannot find module './live-status.js'`.

- [ ] **Step 1.4: Implement `live-status.ts`**

Create `src/dashboard/live-status.ts`:

```ts
// live-status.ts — join live event-log-derived item status onto cascade plan nodes
// for the Studio Details panel. Pure: buildStatusByItemId folds the canonical log
// into an itemId→ItemStatus map; mergeLiveStatus replaces metadata.status on nodes
// whose metadata.itemId matches, returning new node objects (never mutating input).
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import { itemStatus, type DerivedState, type ItemStatus } from '../state.js';

/** Build an itemId → live ItemStatus map from the folded canonical log. */
export function buildStatusByItemId(state: DerivedState, nowMs: number): Map<string, ItemStatus> {
  const out = new Map<string, ItemStatus>();
  for (const [itemId, item] of state.items) {
    out.set(itemId, itemStatus(item, nowMs));
  }
  return out;
}

/** Return nodes with metadata.status replaced by the live status where the node's
 *  metadata.itemId matches the map. Pure — never mutates the input nodes. Nodes with
 *  no itemId, or an itemId absent from the map, are returned unchanged. */
export function mergeLiveStatus(
  nodes: readonly PlanNode[],
  statusByItemId: ReadonlyMap<string, ItemStatus>,
): PlanNode[] {
  return nodes.map((node) => {
    const itemId = node.metadata['itemId'];
    if (typeof itemId !== 'string') return node;
    const live = statusByItemId.get(itemId);
    if (live === undefined) return node;
    return { ...node, metadata: { ...node.metadata, status: live } };
  });
}
```

- [ ] **Step 1.5: Run tests — verify all pass**

```bash
npx vitest run src/dashboard/live-status.spec.ts
```

Expected: PASS (1 buildStatusByItemId + 4 mergeLiveStatus).

- [ ] **Step 1.6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. (If `ItemStatus` or `DerivedState` is not exported from `state.ts`, confirm the exact export — both are exported per `src/state.ts`: `export type ItemStatus` and `export interface DerivedState { items: Map<string, ItemState>; … }`.)

- [ ] **Step 1.7: Commit**

```bash
git add src/dashboard/live-status.ts src/dashboard/live-status.spec.ts
git commit -m "feat(live-status): buildStatusByItemId + mergeLiveStatus (pure)"
```

---

## Task 2 — Wire the join into `/api/catalog` + integration test

**Repo:** `domains/foundry` (same branch `feat/live-status-join`).

**Files:**
- Modify: `src/dashboard/server.ts` (the `/api/catalog` route handler)
- Modify: `test/dashboard-catalog-endpoints.acid.test.ts`

**Interfaces:**
- Consumes: `buildStatusByItemId`, `mergeLiveStatus` from Task 1; the already-imported `fold`, `readEnvelopes` (used by `/api/snapshot`); `itemQueued` (`../src/events.js`) + `append` (`../src/log.js`) in the test.

---

- [ ] **Step 2.1: Write the failing integration test**

Add to the top imports of `test/dashboard-catalog-endpoints.acid.test.ts`:

```ts
import { itemQueued } from '../src/events.js';
import { append } from '../src/log.js';
```

Append this test inside the existing `describe('dashboard-catalog-endpoints …')` block:

```ts
it('GET /api/catalog reflects the live item status, overriding the seed', async () => {
  const deps = tempDeps();
  // Seed the temp log: queue foundry/slice3-1 (the story-pool-auto node, seed status 'done').
  // A freshly-queued item folds to live status 'queued'.
  append(
    itemQueued({
      itemId: 'foundry/slice3-1', productKey: 'foundry', title: 'Warm-pool auto-engagement',
      scope: { repo: 'de-braighter/foundry', issue: 1 }, ts: '2026-06-18T10:00:00.000Z',
    }),
    deps.logPath,
  );

  const { url, close } = await startDashboardServer(deps, { port: 0 });
  try {
    const res = await fetch(`${url}/api/catalog`);
    expect(res.status).toBe(200);
    const body = await res.json() as { catalog: { systems: { root: PlanNodeLike }[] } };

    // Walk the nested SystemNode tree to the node with meta.itemId === 'foundry/slice3-1'.
    const find = (n: PlanNodeLike): PlanNodeLike | null => {
      if (n.meta && n.meta['itemId'] === 'foundry/slice3-1') return n;
      for (const c of n.children ?? []) { const f = find(c); if (f) return f; }
      return null;
    };
    const node = find(body.catalog.systems[0]!.root);
    expect(node).toBeTruthy();
    // live 'queued' overrode the seed 'done'
    expect(node!.meta!['status']).toBe('queued');
  } finally {
    await close();
  }
});
```

Add this local type near the top of the file (after the imports), so the walker is typed without importing the studio Catalog:

```ts
interface PlanNodeLike {
  meta?: Record<string, unknown>;
  children?: PlanNodeLike[];
}
```

- [ ] **Step 2.2: Run it — verify it fails**

```bash
npx vitest run test/dashboard-catalog-endpoints.acid.test.ts
```

Expected: FAIL — `node!.meta!['status']` is `'done'` (the seed), because the handler doesn't join live status yet.

- [ ] **Step 2.3: Wire the join into the `/api/catalog` handler**

In `src/dashboard/server.ts`, add the import near the other dashboard imports (e.g. after `import { mapNodesToCatalog } from './catalog-mapper.js';`):

```ts
import { buildStatusByItemId, mergeLiveStatus } from './live-status.js';
```

Find the `/api/catalog` route handler. It currently sources the nodes like:

```ts
const nodes = models.foundry.nodes;
const catalog = mapNodesToCatalog(nodes);
```

Replace those two lines with:

```ts
let nodes = models.foundry.nodes;
try {
  const state = fold(readEnvelopes(deps.logPath));
  nodes = mergeLiveStatus(nodes, buildStatusByItemId(state, Date.now()));
} catch {
  // log unreadable / fold error → fall back to the in-memory seed statuses; never crash
}
const catalog = mapNodesToCatalog(nodes);
```

(`fold` and `readEnvelopes` are already imported at the top of `server.ts` — they back `/api/snapshot`. Do not re-import them.)

- [ ] **Step 2.4: Run the integration test — verify it passes**

```bash
npx vitest run test/dashboard-catalog-endpoints.acid.test.ts
```

Expected: PASS — the node's `meta.status` is now `'queued'` (live), and the existing catalog/plan-tree route tests stay green.

- [ ] **Step 2.5: Run the full suite + typecheck**

```bash
npx vitest run && npm run typecheck
```

Expected: all pass, no type errors. (The two pre-existing `dashboard-cockpit`/`dashboard-interactive` acid tests may time out under full-suite parallelism — a known pre-existing flake unrelated to this change; confirm they pass in isolation if they trip.)

- [ ] **Step 2.6: Commit**

```bash
git add src/dashboard/server.ts test/dashboard-catalog-endpoints.acid.test.ts
git commit -m "feat(live-status): join live itemStatus into GET /api/catalog (overrides seed)"
```

> **Controller note:** after Task 2, open the foundry PR, run the gate (reviewer + charter-checker + local-ci), merge, run the ritual, then browser re-verify: restart the `:4555` server with merged code, reload the studio, select a work-item, confirm the Details "Status" reflects the live fold value.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| D1 — replace (not dual-display) | Task 1 `mergeLiveStatus` (replaces status) + Task 2 (no studio change) |
| D2 — foundry-side, server-only | Task 2 (handler wiring; zero studio file) |
| D3 — static-at-load | Task 2 (fold per request; no polling) |
| D4 — `/api/catalog` only | Task 2 (only that handler; `/api/plan-tree` untouched) |
| D5 — fail-soft | Task 2 (try/catch around the fold+merge) |
| `buildStatusByItemId` | Task 1 (+ test) |
| `mergeLiveStatus` pure, no-mutate | Task 1 (+ no-mutate test) |
| fallback: no-match keeps seed; no-itemId unchanged | Task 1 (two tests) |
| integration: live overrides seed in served catalog | Task 2 (asserts `meta.status === 'queued'`) |

All covered. ✓

**Placeholder scan:** No TBD/TODO. The only conditional note (Step 1.6 confirming `ItemStatus`/`DerivedState` exports) is a verification instruction; both are confirmed exported in `src/state.ts`. ✓

**Type consistency:** `buildStatusByItemId(DerivedState, number): Map<string, ItemStatus>` and `mergeLiveStatus(readonly PlanNode[], ReadonlyMap<string, ItemStatus>): PlanNode[]` are used identically in Task 2's import + call. `ItemStatus` is imported in both the Task 1 impl and spec. The integration test's `PlanNodeLike` walker matches the `{ meta?, children? }` shape the catalog `SystemNode` actually has. ✓
