# Foundry Cockpit — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Foundry Cockpit Angular app (Phase 1 — Foundation + Execute) so the founder can see the full plan tree as an SVG diagram, claim/release/gate nodes, and see what's actionable right now.

**Architecture:** New Angular CLI app at `domains/foundry/apps/cockpit` (`:4201`) talking to the existing foundry Express server (`:4555`). Three new backend endpoints (`/api/trees`, `/api/frontier/:treeRootId`, `/api/action/:nodeId`) added to `server.ts`. A new `dispatchCharterAction` export in `layers/charter-runtime` enables user-driven (non-conductor) action dispatch. ZERO kernel change — `executionMode`, `treeRole`, `scriptRef` live in `metadata.JSONB`.

**Tech Stack:** Angular 21 (standalone components, signals, OnPush), `@de-braighter/design-system-angular@^1.15.1` (BoardKitComponent), `@de-braighter/charter-runtime` (charterFrontier, foldCharterLifecycleState), vitest for unit tests, pnpm workspace.

## Global Constraints

- ZERO kernel change — `PlanNode` schema (`layers/substrate`) is never touched
- Cockpit is localhost-only (same as dashboard server — bound to `127.0.0.1`)
- Angular: standalone components, signal `input()`/`output()`, OnPush, no `@Input()`/`@Output()` decorators
- All Angular components use `ChangeDetectionStrategy.OnPush`
- Phase 1 is a single-founder tool — no JWT auth on cockpit endpoints (Phase 3 adds auth)
- `planTreeToRecipe()` and `planNodesToRenderTree()` must be pure functions (no side effects, no Angular deps)
- All tests use vitest (not Jest), run with `npm test` in `apps/cockpit`
- CORS in `dashboard/server.ts` must allow both `:4200` (studio) AND `:4201` (cockpit)
- Charter event log path: `data/charter-events.jsonl` (sibling to existing `data/` dir)
- `tenantPackId` for cockpit queries: read from `COCKPIT_TENANT_PACK_ID` env var, default `'foundry-default'`

---

## File Map

**Charter-runtime (layers/charter-runtime/src/):**
- Create: `dispatch-action.ts` — `dispatchCharterAction()` user-driven action dispatch
- Modify: `index.ts` — export `dispatchCharterAction`

**Foundry backend (domains/foundry/src/):**
- Create: `cockpit/file-charter-event-log.ts` — file-backed `CharterEventLog` impl
- Create: `cockpit/cockpit.router.ts` — `/api/trees`, `/api/frontier/:treeRootId`, `/api/action/:nodeId`, `/api/charter-status/:treeRootId`
- Modify: `dashboard/server.ts` — CORS update + mount cockpit router

**Cockpit Angular app (domains/foundry/apps/cockpit/):**
- Create: `package.json`, `angular.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.spec.json`
- Create: `src/main.ts`, `src/styles.css`, `src/index.html`
- Create: `src/app/app.config.ts`, `src/app/app.routes.ts`
- Create: `src/app/shell/cockpit-shell.component.ts`
- Create: `src/app/shared/cockpit-types.ts`
- Create: `src/app/shared/foundry-cockpit.client.ts`
- Create: `src/app/shared/live-status.service.ts`
- Create: `src/app/shared/plan-tree-render.ts` — `planNodesToRenderTree()` (pure)
- Create: `src/app/shared/plan-tree-recipe.ts` — `planTreeToRecipe()` (pure)
- Create: `src/app/project/project.page.ts`
- Create: `src/app/execute/execute.page.ts`
- Create: `src/app/execute/board/cockpit-board.component.ts`
- Create: `src/app/execute/frontier-panel/frontier-panel.component.ts`
- Create: `src/app/execute/node-detail/node-detail-panel.component.ts`

**Workspace:**
- Create: `domains/foundry/pnpm-workspace.yaml`

---

### Task 1: `dispatchCharterAction` in charter-runtime

The `ACTION_REGISTRY` in charter-runtime is intentionally NOT exported (callers use `conductCharterStep` for the autonomous conductor). The cockpit needs user-triggered action dispatch (founder picks a node + action explicitly). Add a clean export for this.

**Files:**
- Create: `layers/charter-runtime/src/dispatch-action.ts`
- Modify: `layers/charter-runtime/src/index.ts`
- Create: `layers/charter-runtime/src/dispatch-action.spec.ts`

**Interfaces:**
- Consumes: `ACTION_REGISTRY`, `CharterEventLog`, `ActionKind`, `CharterEvent`
- Produces: `dispatchCharterAction(deps, nodeId, treeRootId, actionKind, args): Promise<CharterEvent[]>`, exported from index

- [ ] **Step 1: Write the failing test**

```typescript
// layers/charter-runtime/src/dispatch-action.spec.ts
import { describe, it, expect } from 'vitest';
import { InMemoryCharterEventLog } from './event-log.port.js';
import { dispatchCharterAction } from './dispatch-action.js';

const fakeStore = {
  save: async () => {},
  load: async () => null,
  applyEdit: async () => { throw new Error('not used'); },
};

describe('dispatchCharterAction', () => {
  it('emits record-note event and appends to log', async () => {
    const log = new InMemoryCharterEventLog();
    const deps = {
      eventLog: log,
      planTreeStore: fakeStore as never,
      tenantPackId: 'test-tenant',
      now: () => '2026-06-30T10:00:00Z',
      newId: () => 'gate-1',
    };
    const events = await dispatchCharterAction(
      deps, 'node-1', 'tree-root-1', 'record-note', { note: 'hello' }
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('charter:NoteRecorded.v1');
    expect(log.read('tree-root-1')).toHaveLength(1);
  });

  it('throws on unknown action kind', async () => {
    const log = new InMemoryCharterEventLog();
    const deps = {
      eventLog: log,
      planTreeStore: fakeStore as never,
      tenantPackId: 'test-tenant',
      now: () => '2026-06-30T10:00:00Z',
      newId: () => 'x',
    };
    await expect(
      dispatchCharterAction(deps, 'node-1', 'tree-1', 'unknown-action' as never, {})
    ).rejects.toThrow('unknown action');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```
cd layers/charter-runtime && npm test -- --reporter=verbose 2>&1 | grep -E "dispatch-action|FAIL|PASS"
```
Expected: `FAIL` — `dispatch-action.ts` not found.

- [ ] **Step 3: Implement `dispatch-action.ts`**

```typescript
// layers/charter-runtime/src/dispatch-action.ts
import type { CharterEventLog } from './event-log.port.js';
import type { PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
import { ACTION_REGISTRY, type ActionKind } from './action-registry.js';
import type { CharterEvent } from './lifecycle-events.js';

export interface DispatchActionDeps {
  eventLog: CharterEventLog;
  planTreeStore: PlanTreeStore;
  tenantPackId: string;
  now: () => string;
  newId: () => string;
}

export async function dispatchCharterAction(
  deps: DispatchActionDeps,
  nodeId: string,
  treeRootId: string,
  actionKind: ActionKind,
  args: Record<string, unknown>,
): Promise<CharterEvent[]> {
  const handler = ACTION_REGISTRY.get(actionKind);
  if (!handler) throw new Error(`unknown action: ${actionKind}`);
  const emitted = await handler(
    { nodeId, treeRootId, args, occurredAt: deps.now(), newId: deps.newId },
    { planTreeStore: deps.planTreeStore, tenantPackId: deps.tenantPackId },
  );
  for (const ev of emitted) {
    deps.eventLog.append(treeRootId, ev);
  }
  return emitted;
}
```

- [ ] **Step 4: Export from `index.ts`**

Add to `layers/charter-runtime/src/index.ts` at the end of the S2 block:
```typescript
// ── Cockpit dispatch (user-triggered actions) ────────────────────────────────
export type { DispatchActionDeps } from './dispatch-action.js';
export { dispatchCharterAction } from './dispatch-action.js';
```

- [ ] **Step 5: Run test to verify it passes**

```
cd layers/charter-runtime && npm test -- --reporter=verbose 2>&1 | grep -E "dispatch-action|✓|✗"
```
Expected: `✓ emits record-note event and appends to log` · `✓ throws on unknown action kind`

- [ ] **Step 6: Typecheck**

```
cd layers/charter-runtime && npm run typecheck
```
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
cd layers/charter-runtime
git add src/dispatch-action.ts src/dispatch-action.spec.ts src/index.ts
git commit -m "feat(charter-runtime): dispatchCharterAction for user-driven cockpit actions"
```

---

### Task 2: `FileCharterEventLog` + backend `GET /api/trees`

The cockpit backend needs a file-based `CharterEventLog` for persisting events between server restarts, and a `GET /api/trees` endpoint for the forest home.

**Files:**
- Create: `domains/foundry/src/cockpit/file-charter-event-log.ts`
- Create: `domains/foundry/src/cockpit/file-charter-event-log.spec.ts`
- Create: `domains/foundry/src/cockpit/cockpit.router.ts` (trees endpoint only — frontier + action in Task 3)
- Modify: `domains/foundry/src/dashboard/server.ts` (CORS, router mount)

**Interfaces:**
- Consumes: `CharterEventLog` port from `@de-braighter/charter-runtime`
- Produces: `FileCharterEventLog`, `createCockpitRouter(deps)`, `GET /api/trees` response

- [ ] **Step 1: Write the failing test**

```typescript
// domains/foundry/src/cockpit/file-charter-event-log.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileCharterEventLog } from './file-charter-event-log.js';

const testDir = join(tmpdir(), 'charter-log-test-' + Date.now());
const logPath = join(testDir, 'charter-events.jsonl');

beforeEach(() => mkdirSync(testDir, { recursive: true }));
afterEach(() => rmSync(testDir, { recursive: true, force: true }));

describe('FileCharterEventLog', () => {
  it('returns empty array when file does not exist', () => {
    const log = new FileCharterEventLog(logPath);
    expect(log.read('tree-1')).toEqual([]);
  });

  it('appends and reads back events for the correct treeRootId', () => {
    const log = new FileCharterEventLog(logPath);
    const ev = {
      type: 'charter:NoteRecorded.v1' as const,
      nodeId: 'node-1',
      payload: { note: 'hi' },
      occurredAt: '2026-06-30T10:00:00Z',
    };
    log.append('tree-1', ev);
    log.append('tree-2', { ...ev, nodeId: 'node-2' });
    const r1 = log.read('tree-1');
    expect(r1).toHaveLength(1);
    expect(r1[0].nodeId).toBe('node-1');
    const r2 = log.read('tree-2');
    expect(r2).toHaveLength(1);
    expect(r2[0].nodeId).toBe('node-2');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```
cd domains/foundry && npm test -- --reporter=verbose 2>&1 | grep -E "file-charter|FAIL"
```

- [ ] **Step 3: Implement `FileCharterEventLog`**

```typescript
// domains/foundry/src/cockpit/file-charter-event-log.ts
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CharterEventLog } from '@de-braighter/charter-runtime';
import type { CharterEvent } from '@de-braighter/charter-runtime';

export class FileCharterEventLog implements CharterEventLog {
  constructor(private readonly logPath: string) {
    mkdirSync(dirname(logPath), { recursive: true });
  }

  read(treeRootId: string): CharterEvent[] {
    if (!existsSync(this.logPath)) return [];
    return readFileSync(this.logPath, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as { treeRootId: string; event: CharterEvent })
      .filter(r => r.treeRootId === treeRootId)
      .map(r => r.event);
  }

  append(treeRootId: string, event: CharterEvent): void {
    appendFileSync(this.logPath, JSON.stringify({ treeRootId, event }) + '\n', 'utf8');
  }
}
```

- [ ] **Step 4: Create `cockpit.router.ts` (trees endpoint)**

```typescript
// domains/foundry/src/cockpit/cockpit.router.ts
import { Router, type Request, type Response } from 'express';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import type { CharterEventLog } from '@de-braighter/charter-runtime';
import { foldCharterLifecycleState, charterFrontier, dispatchCharterAction } from '@de-braighter/charter-runtime';
import type { DispatchActionDeps } from '@de-braighter/charter-runtime';
import type { ActionKind } from '@de-braighter/charter-runtime';
import type { PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
import { buildCascadeTree } from '../plan/cascade.js';
import { FOUNDRY_PRODUCT } from '../instances/foundry-product.js';
import { buildStatusByItemId } from '../dashboard/live-status.js';
import { fold } from '../state.js';
import { readEnvelopes } from '../log.js';
import type { FoundryDeps } from '../ops.js';
import { randomUUID } from 'node:crypto';

function asyncHandler(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response): void => {
    fn(req, res).catch((err: unknown) => {
      res.status(500).json({ ok: false, error: (err as Error).message });
    });
  };
}

export interface CockpitRouterDeps {
  deps: FoundryDeps;
  charterEventLog: CharterEventLog;
  planTreeStore: PlanTreeStore;
  tenantPackId: string;
}

export function createCockpitRouter(opts: CockpitRouterDeps): Router {
  const router = Router();
  const { deps, charterEventLog, planTreeStore, tenantPackId } = opts;
  const cascadeTree = buildCascadeTree(FOUNDRY_PRODUCT);

  // ── GET /api/trees ─────────────────────────────────────────────────────────
  // Returns all root PlanNodes with aggregated status for the forest home.
  // Phase 1: wraps the in-memory cascade tree + legacy status fold.
  router.get('/trees', asyncHandler(async (_req, res) => {
    const nodes = cascadeTree.nodes;
    let statusByItemId: Map<string, string> = new Map();
    try {
      const state = fold(readEnvelopes(deps.logPath));
      statusByItemId = buildStatusByItemId(state, Date.now());
    } catch { /* log unreadable → empty map */ }

    // Group nodes by root (parentId = null)
    const roots = nodes.filter(n => n.parentId === null);

    const trees = roots.map(root => {
      const subtree = collectSubtree(nodes, root.id);
      const treeRole = (root.metadata?.['treeRole'] as string | undefined) ?? 'sdlc';
      const counts = { done: 0, claimed: 0, blocked: 0, queued: 0, gatePending: 0 };
      for (const n of subtree) {
        const s = statusByItemId.get(n.id) ?? 'queued';
        if (s === 'done') counts.done++;
        else if (s === 'claimed') counts.claimed++;
        else if (s === 'blocked') counts.blocked++;
        else if (s === 'gate-pending') counts.gatePending++;
        else counts.queued++;
      }
      return {
        node: root,
        treeRole,
        nodeCount: subtree.length,
        statusCounts: counts,
        lastActivityAt: new Date().toISOString(),
      };
    });

    res.json({ ok: true, trees });
  }));

  // ── GET /api/charter-status/:treeRootId ────────────────────────────────────
  router.get('/charter-status/:treeRootId', (_req, res) => {
    const treeRootId = _req.params['treeRootId'] as string;
    try {
      const events = charterEventLog.read(treeRootId);
      const state = foldCharterLifecycleState(events);
      const nowMs = Date.now();
      const statuses: Record<string, string> = {};
      for (const [nodeId, ns] of state.byNode) {
        if (ns.resolution != null) { statuses[nodeId] = 'done'; continue; }
        const activeClaim = ns.claims.find(c => c.released == null &&
          nowMs - Date.parse(c.acquiredAt) < c.ttlMinutes * 60_000);
        if (activeClaim) { statuses[nodeId] = 'claimed'; continue; }
        const openGate = ns.gates.find(g => g.decision == null);
        if (openGate) { statuses[nodeId] = 'gate-pending'; continue; }
        statuses[nodeId] = 'queued';
      }
      res.json({ ok: true, statuses });
    } catch (e) {
      res.json({ ok: true, statuses: {} });
    }
  });

  // ── GET /api/frontier/:treeRootId ──────────────────────────────────────────
  router.get('/frontier/:treeRootId', asyncHandler(async (req, res) => {
    const treeRootId = req.params['treeRootId'] as string;
    const tree = await planTreeStore.load(treeRootId);
    if (!tree) { res.json({ ok: true, frontier: [] }); return; }
    const events = charterEventLog.read(treeRootId);
    const state = foldCharterLifecycleState(events);
    const nowMs = Date.now();
    const entries = charterFrontier(tree, state, nowMs);
    // Enrich with node metadata for the UI
    const byId = new Map(tree.nodes.map(n => [n.id, n]));
    const enriched = entries.map(e => {
      const node = byId.get(e.nodeId);
      const meta = (node?.metadata ?? {}) as Record<string, unknown>;
      const charter = meta['charter'] as Record<string, unknown> | undefined;
      return {
        ...e,
        kind: node?.kind ?? 'unknown',
        title: (meta['title'] as string | undefined) ?? node?.kindRef ?? e.nodeId,
        executionMode: (charter?.['executionMode'] as string | undefined) ?? 'ai',
      };
    });
    res.json({ ok: true, frontier: enriched });
  }));

  // ── POST /api/action/:nodeId ───────────────────────────────────────────────
  router.post('/action/:nodeId', asyncHandler(async (req, res) => {
    const nodeId = req.params['nodeId'] as string;
    const body = req.body as {
      action: string;
      treeRootId: string;
      decision?: 'approved' | 'rejected';
      claimId?: string;
      gateId?: string;
    };
    const { treeRootId, action, decision, claimId, gateId } = body;
    if (!treeRootId) { res.status(400).json({ ok: false, error: 'treeRootId required' }); return; }

    // Build action-specific args from the node's current state
    const events = charterEventLog.read(treeRootId);
    const state = foldCharterLifecycleState(events);
    const ns = state.byNode.get(nodeId);

    const tree = await planTreeStore.load(treeRootId);
    if (!tree) { res.status(404).json({ ok: false, error: 'tree not found' }); return; }
    const node = tree.nodes.find(n => n.id === nodeId);
    if (!node) { res.status(404).json({ ok: false, error: 'node not found' }); return; }
    const parentNode = node.parentId ? tree.nodes.find(n => n.id === node.parentId) : null;
    const meta = (node.metadata ?? {}) as Record<string, unknown>;
    const charter = (meta['charter'] as Record<string, unknown> | undefined) ?? {};
    const parentMeta = (parentNode?.metadata ?? {}) as Record<string, unknown>;
    const parentCharter = (parentMeta['charter'] as Record<string, unknown> | undefined) ?? null;

    let actionKind: ActionKind;
    let args: Record<string, unknown>;

    if (action === 'claim') {
      actionKind = 'claim-node';
      args = { nodeCharter: charter, parentCharter, ttlMinutes: 30 };
    } else if (action === 'release') {
      const activeClaim = ns?.claims.find(c => c.released == null);
      actionKind = 'release-node';
      args = { claimId: claimId ?? activeClaim?.claimId ?? `conduct-${nodeId}`, resolution: 'done' };
    } else if (action === 'request-gate') {
      actionKind = 'request-gate';
      args = { gateType: 'review' };
    } else if (action === 'decide-gate') {
      const openGateState = ns?.gates.find(g => g.decision == null);
      actionKind = 'decide-gate';
      args = { gateId: gateId ?? openGateState?.gateId ?? '', decision: decision ?? 'approved' };
    } else {
      res.status(400).json({ ok: false, error: `unknown action: ${action}` }); return;
    }

    const dispatchDeps: DispatchActionDeps = {
      eventLog: charterEventLog,
      planTreeStore,
      tenantPackId,
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
    };

    const emitted = await dispatchCharterAction(dispatchDeps, nodeId, treeRootId, actionKind, args);
    res.json({ ok: true, events: emitted });
  }));

  return router;
}

function collectSubtree(nodes: PlanNode[], rootId: string): PlanNode[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const result: PlanNode[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id) continue;
    const n = byId.get(id);
    if (!n) continue;
    result.push(n);
    queue.push(...n.childrenIds);
  }
  return result;
}
```

- [ ] **Step 5: Update `dashboard/server.ts` — CORS + mount cockpit router**

Find the line in `server.ts`:
```typescript
const CORS_ORIGIN   = 'http://localhost:4200';
```
Replace with:
```typescript
const CORS_ORIGIN_STUDIO  = 'http://localhost:4200';
const CORS_ORIGIN_COCKPIT = 'http://localhost:4201';
```

Find:
```typescript
app.use(cors({ origin: CORS_ORIGIN }));
```
Replace with:
```typescript
app.use(cors({ origin: [CORS_ORIGIN_STUDIO, CORS_ORIGIN_COCKPIT] }));
```

Then add after the existing `if (prisma && keys)` block:

```typescript
  // ── Cockpit routes (no auth — Phase 1 single-founder tool) ─────────────────
  const cockpitTenantPackId = process.env['COCKPIT_TENANT_PACK_ID'] ?? 'foundry-default';
  const charterLogPath = join(deps.dataDir, 'charter-events.jsonl');
  const charterEventLog = prisma
    ? new FileCharterEventLog(charterLogPath)
    : new InMemoryCharterEventLog();
  const cockpitPlanTreeStore = prisma
    ? (await import('../plan-tree/foundry-prisma-plan-tree.store.js')).storeFor(
        { user: { tenantPackId: cockpitTenantPackId } } as never, prisma
      )
    : { load: async () => null, save: async () => {}, applyEdit: async () => { throw new Error(); } };

  app.use('/api', createCockpitRouter({
    deps,
    charterEventLog,
    planTreeStore: cockpitPlanTreeStore,
    tenantPackId: cockpitTenantPackId,
  }));
```

Add imports at top of `server.ts`:
```typescript
import { join } from 'node:path';
import { FileCharterEventLog } from '../cockpit/file-charter-event-log.js';
import { InMemoryCharterEventLog } from '@de-braighter/charter-runtime';
import { createCockpitRouter } from '../cockpit/cockpit.router.js';
```

- [ ] **Step 6: Run tests to verify all pass**

```
cd domains/foundry && npm test 2>&1 | tail -10
```
Expected: all existing tests still pass, new `file-charter-event-log` tests pass.

- [ ] **Step 7: Typecheck**

```
cd domains/foundry && npm run typecheck
```

- [ ] **Step 8: Commit**

```bash
cd domains/foundry
git add src/cockpit/ src/dashboard/server.ts
git commit -m "feat(foundry): FileCharterEventLog + cockpit router (trees/frontier/action/charter-status)"
```

---

### Task 3: Angular cockpit workspace scaffold

Create the pnpm workspace + Angular CLI app structure for the cockpit. No logic yet — just the scaffold that `ng serve` can start.

**Files:**
- Create: `domains/foundry/pnpm-workspace.yaml`
- Create: `domains/foundry/apps/cockpit/package.json`
- Create: `domains/foundry/apps/cockpit/angular.json`
- Create: `domains/foundry/apps/cockpit/tsconfig.json`
- Create: `domains/foundry/apps/cockpit/tsconfig.app.json`
- Create: `domains/foundry/apps/cockpit/tsconfig.spec.json`
- Create: `domains/foundry/apps/cockpit/src/index.html`
- Create: `domains/foundry/apps/cockpit/src/main.ts`
- Create: `domains/foundry/apps/cockpit/src/styles.css`
- Create: `domains/foundry/apps/cockpit/src/app/app.component.ts` (stub)
- Create: `domains/foundry/apps/cockpit/src/app/app.config.ts`
- Create: `domains/foundry/apps/cockpit/src/app/app.routes.ts`

**Interfaces:**
- Produces: `ng serve` starts at `:4201`, `ng test` runs vitest

- [ ] **Step 1: Write a minimal app component test**

```typescript
// domains/foundry/apps/cockpit/src/app/app.component.spec.ts
import { describe, it, expect } from 'vitest';

describe('app scaffold', () => {
  it('is importable', async () => {
    const { AppComponent } = await import('./app.component.js');
    expect(AppComponent).toBeDefined();
  });
});
```

- [ ] **Step 2: Create workspace file**

```yaml
# domains/foundry/pnpm-workspace.yaml
packages:
  - "apps/*"
allowBuilds:
  esbuild: true
minimumReleaseAgeExclude:
  - '@de-braighter/*'
```

- [ ] **Step 3: Create `apps/cockpit/package.json`**

```json
{
  "name": "cockpit",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "ng": "ng",
    "start": "ng serve --port 4201",
    "build": "ng build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@angular/common": "^21.2.0",
    "@angular/compiler": "^21.2.0",
    "@angular/core": "^21.2.0",
    "@angular/forms": "^21.2.0",
    "@angular/platform-browser": "^21.2.0",
    "@angular/router": "^21.2.0",
    "@de-braighter/design-system-angular": "^1.15.1",
    "@de-braighter/design-system-core": "^2.6.0",
    "@de-braighter/substrate-contracts": "^2.7.0",
    "rxjs": "~7.8.0",
    "tslib": "^2.3.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@angular-builders/custom-esbuild": "21.1.0",
    "@angular/build": "^21.2.15",
    "@angular/cli": "^21.2.15",
    "@angular/compiler-cli": "^21.2.0",
    "jsdom": "^28.0.0",
    "typescript": "~5.9.2",
    "vitest": "^4.0.8"
  }
}
```

- [ ] **Step 4: Create `angular.json`**

```json
{
  "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
  "version": 1,
  "cli": { "packageManager": "npm" },
  "newProjectRoot": "projects",
  "projects": {
    "cockpit": {
      "projectType": "application",
      "root": "",
      "sourceRoot": "src",
      "prefix": "app",
      "architect": {
        "build": {
          "builder": "@angular/build:application",
          "options": {
            "outputPath": "dist/cockpit",
            "index": "src/index.html",
            "browser": "src/main.ts",
            "tsConfig": "tsconfig.app.json",
            "assets": [{ "glob": "**/*", "input": "public" }],
            "styles": ["src/styles.css"]
          },
          "configurations": {
            "production": {
              "budgets": [
                { "type": "initial", "maximumWarning": "500kB", "maximumError": "1MB" },
                { "type": "anyComponentStyle", "maximumWarning": "4kB", "maximumError": "8kB" }
              ],
              "outputHashing": "all"
            },
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true
            }
          },
          "defaultConfiguration": "production"
        },
        "serve": {
          "builder": "@angular/build:dev-server",
          "configurations": {
            "production": { "buildTarget": "cockpit:build:production" },
            "development": { "buildTarget": "cockpit:build:development" }
          },
          "defaultConfiguration": "development"
        }
      }
    }
  }
}
```

- [ ] **Step 5: Create tsconfig files**

```json
// tsconfig.json
{
  "compileOnSave": false,
  "compilerOptions": {
    "outDir": "./dist/out-tsc",
    "strict": true,
    "noImplicitOverride": true,
    "noPropertyAccessFromIndexSignature": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "declaration": false,
    "experimentalDecorators": true,
    "moduleResolution": "bundler",
    "importHelpers": true,
    "target": "ES2022",
    "module": "ES2022",
    "useDefineForClassFields": false,
    "lib": ["ES2022", "dom"]
  },
  "angularCompilerOptions": {
    "enableI18nLegacyMessageIdFormat": false,
    "strictInjectionParameters": true,
    "strictInputAccessModifiers": true,
    "strictTemplates": true
  }
}

// tsconfig.app.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/app",
    "types": []
  },
  "files": ["src/main.ts"],
  "include": ["src/**/*.d.ts"]
}

// tsconfig.spec.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./out-tsc/spec",
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*.spec.ts", "src/**/*.d.ts"]
}
```

- [ ] **Step 6: Create `src/index.html`, `src/main.ts`, `src/styles.css`**

```html
<!-- src/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Foundry Cockpit</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <app-cockpit></app-cockpit>
</body>
</html>
```

```typescript
// src/main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component.js';
import { appConfig } from './app/app.config.js';

bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err));
```

```css
/* src/styles.css */
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; font-family: var(--font-ui, system-ui, sans-serif); background: var(--bg, #0f1320); color: var(--ink, #e8ecf7); }
```

- [ ] **Step 7: Create stub `app.component.ts`, `app.config.ts`, `app.routes.ts`**

```typescript
// src/app/app.component.ts
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-cockpit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet],
  template: `<router-outlet />`,
})
export class AppComponent {}
```

```typescript
// src/app/app.config.ts
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { routes } from './app.routes.js';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(),
  ],
};
```

```typescript
// src/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./project/project.page.js').then(m => m.ProjectPage) },
  { path: 'tree/:treeId/execute', loadComponent: () => import('./execute/execute.page.js').then(m => m.ExecutePage) },
  { path: 'tree/:treeId/execute/:instanceId', loadComponent: () => import('./execute/execute.page.js').then(m => m.ExecutePage) },
  { path: '**', redirectTo: '' },
];
```

- [ ] **Step 8: Install deps and verify serve starts**

```bash
cd domains/foundry/apps/cockpit && npm install
npm run start 2>&1 | head -20
```
Expected: `Local: http://localhost:4201/` in output (Ctrl-C after confirming).

- [ ] **Step 9: Run test scaffold**

```bash
cd domains/foundry/apps/cockpit && npm test 2>&1 | tail -5
```
Expected: `✓ is importable`

- [ ] **Step 10: Commit**

```bash
cd domains/foundry
git add pnpm-workspace.yaml apps/cockpit/
git commit -m "feat(cockpit): Angular CLI scaffold at :4201 with pnpm workspace"
```

---

### Task 4: Shell component + routing

**Files:**
- Create: `src/app/shell/cockpit-shell.component.ts`

**Interfaces:**
- Consumes: `ActivatedRoute`, `Router` from `@angular/router`; `toSignal` from `@angular/core/rxjs-interop`
- Produces: Level-1 (forest, no tabs) and Level-2 (pipeline, with 4 tabs + breadcrumb) navigation shell

- [ ] **Step 1: Write a test**

```typescript
// src/app/shell/cockpit-shell.component.spec.ts
import { describe, it, expect } from 'vitest';
import { CockpitShellComponent } from './cockpit-shell.component.js';

describe('CockpitShellComponent', () => {
  it('is defined as a component', () => {
    expect(CockpitShellComponent).toBeDefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd domains/foundry/apps/cockpit && npm test -- --reporter=verbose 2>&1 | grep shell
```

- [ ] **Step 3: Implement shell component**

```typescript
// src/app/shell/cockpit-shell.component.ts
import {
  ChangeDetectionStrategy, Component, computed
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-cockpit-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="ck-header">
      <span class="ck-logo">🐉 Foundry Cockpit</span>
      @if (treeId()) {
        <nav class="ck-breadcrumb" aria-label="Location">
          <a routerLink="/">Project</a>
          <span aria-hidden="true"> › </span>
          <span>{{ treeId() }}</span>
        </nav>
      }
    </header>
    @if (treeId()) {
      <nav class="ck-tabs" aria-label="Pipeline">
        <a routerLinkActive="active" [routerLink]="['/tree', treeId(), 'execute']">Execute</a>
      </nav>
    }
    <main class="ck-main">
      <router-outlet />
    </main>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100vh; }
    .ck-header { display: flex; align-items: center; gap: 16px; padding: 12px 20px; background: var(--bg-elev, #161b2c); border-bottom: 1px solid var(--rule, #2a2f40); }
    .ck-logo { font-weight: 700; font-size: 1rem; color: var(--ink, #e8ecf7); }
    .ck-breadcrumb { font-size: 0.875rem; color: var(--ink-2, #94a3d2); }
    .ck-breadcrumb a { color: var(--accent, #22d39a); text-decoration: none; }
    .ck-tabs { display: flex; gap: 4px; padding: 0 16px; background: var(--bg-sunken, #0c1019); border-bottom: 1px solid var(--rule, #2a2f40); }
    .ck-tabs a { padding: 10px 16px; color: var(--ink-2, #94a3d2); text-decoration: none; border-bottom: 2px solid transparent; }
    .ck-tabs a.active { color: var(--accent, #22d39a); border-bottom-color: var(--accent, #22d39a); }
    .ck-main { flex: 1; overflow: hidden; }
  `],
})
export class CockpitShellComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly routeData = toSignal(this.route.firstChild?.params ?? of({}));
  readonly treeId = computed(() => (this.routeData() as Record<string, string> | undefined)?.['treeId'] ?? null);
}
```

Wait — inject + ActivatedRoute for child params is complex. Use a simpler approach with Router events:

```typescript
// src/app/shell/cockpit-shell.component.ts
import {
  ChangeDetectionStrategy, Component, computed, inject
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs';
import { of } from 'rxjs';

@Component({
  selector: 'app-cockpit-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <header class="ck-header">
      <span class="ck-logo">🐉 Foundry Cockpit</span>
      @if (treeId()) {
        <nav class="ck-breadcrumb" aria-label="Location">
          <a routerLink="/">Project</a>
          <span aria-hidden="true"> › </span>
          <span>{{ treeId() }}</span>
        </nav>
      }
    </header>
    @if (treeId()) {
      <nav class="ck-tabs" aria-label="Pipeline">
        <a routerLinkActive="active" [routerLink]="['/tree', treeId(), 'execute']">Execute</a>
      </nav>
    }
    <main class="ck-main">
      <router-outlet />
    </main>
  `,
  styles: [`
    :host { display: flex; flex-direction: column; height: 100vh; }
    .ck-header { display: flex; align-items: center; gap: 16px; padding: 12px 20px; background: var(--bg-elev, #161b2c); border-bottom: 1px solid var(--rule, #2a2f40); }
    .ck-logo { font-weight: 700; font-size: 1rem; color: var(--ink, #e8ecf7); }
    .ck-breadcrumb { font-size: 0.875rem; color: var(--ink-2, #94a3d2); }
    .ck-breadcrumb a { color: var(--accent, #22d39a); text-decoration: none; }
    .ck-tabs { display: flex; gap: 4px; padding: 0 12px; background: var(--bg-sunken, #0c1019); border-bottom: 1px solid var(--rule, #2a2f40); }
    .ck-tabs a { padding: 10px 16px; color: var(--ink-2, #94a3d2); text-decoration: none; border-bottom: 2px solid transparent; }
    .ck-tabs a.active { color: var(--accent, #22d39a); border-bottom-color: var(--accent, #22d39a); }
    .ck-main { flex: 1; min-height: 0; }
  `],
})
export class CockpitShellComponent {
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map((e) => (e as NavigationEnd).url),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  // Extract treeId from URL pattern /tree/:treeId/*
  readonly treeId = computed(() => {
    const match = /\/tree\/([^/]+)/.exec(this.url() ?? '');
    return match ? match[1] : null;
  });
}
```

- [ ] **Step 4: Wire shell into `AppComponent` and routes**

Update `app.component.ts`:
```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CockpitShellComponent } from './shell/cockpit-shell.component.js';

@Component({
  selector: 'app-cockpit',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CockpitShellComponent],
  template: `<app-cockpit-shell />`,
})
export class AppComponent {}
```

- [ ] **Step 5: Verify test passes**

```bash
cd domains/foundry/apps/cockpit && npm test 2>&1 | grep -E "shell|✓|✗"
```

- [ ] **Step 6: Commit**

```bash
cd domains/foundry/apps/cockpit
git add src/app/shell/ src/app/app.component.ts
git commit -m "feat(cockpit): shell component + two-level routing (breadcrumb + pipeline tabs)"
```

---

### Task 5: `FoundryCockpitClient` + shared types

**Files:**
- Create: `src/app/shared/cockpit-types.ts`
- Create: `src/app/shared/foundry-cockpit.client.ts`

**Interfaces:**
- Produces: `FoundryCockpitClient` injectable; typed response interfaces for all 4 endpoints; FOUNDRY_URL token

- [ ] **Step 1: Write a test**

```typescript
// src/app/shared/foundry-cockpit.client.spec.ts
import { describe, it, expect } from 'vitest';
import { FoundryCockpitClient } from './foundry-cockpit.client.js';

describe('FoundryCockpitClient', () => {
  it('is defined', () => {
    expect(FoundryCockpitClient).toBeDefined();
  });
});
```

- [ ] **Step 2: Create `cockpit-types.ts`**

```typescript
// src/app/shared/cockpit-types.ts

/** Status code from the charter event log */
export type ItemStatusCode = 'queued' | 'claimed' | 'done' | 'blocked' | 'gate-pending';

/** Aggregated tree for the forest home (from GET /api/trees) */
export interface CockpitTree {
  node: {
    id: string;
    kind: string;
    kindRef: string;
    metadata: Record<string, unknown>;
    parentId: string | null;
    childrenIds: string[];
  };
  treeRole: string;
  nodeCount: number;
  statusCounts: {
    done: number;
    claimed: number;
    blocked: number;
    queued: number;
    gatePending: number;
  };
  lastActivityAt: string;
}

/** Frontier entry (from GET /api/frontier/:treeRootId) */
export interface CockpitFrontierEntry {
  nodeId: string;
  treeRootId: string;
  action: 'decompose' | 'claim';
  kind: string;
  title: string;
  executionMode: string;
}

/** Full node detail (from GET /api/plan-tree, enriched client-side) */
export interface CockpitPlanNode {
  id: string;
  parentId: string | null;
  kind: string;
  kindRef: string;
  treeRootId: string;
  ordinal: number;
  childrenIds: string[];
  metadata: Record<string, unknown>;
}

/** POST /api/action/:nodeId request body */
export interface ActionRequest {
  treeRootId: string;
  action: 'claim' | 'release' | 'request-gate' | 'decide-gate';
  decision?: 'approved' | 'rejected';
  gateId?: string;
  claimId?: string;
}
```

- [ ] **Step 3: Create `foundry-cockpit.client.ts`**

```typescript
// src/app/shared/foundry-cockpit.client.ts
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { CockpitTree, CockpitFrontierEntry, CockpitPlanNode, ActionRequest, ItemStatusCode } from './cockpit-types.js';

const BASE = 'http://127.0.0.1:4555';

@Injectable({ providedIn: 'root' })
export class FoundryCockpitClient {
  private readonly http = inject(HttpClient);

  async getTrees(): Promise<CockpitTree[]> {
    try {
      const r = await firstValueFrom(this.http.get<{ ok: boolean; trees: CockpitTree[] }>(`${BASE}/api/trees`));
      return r.trees;
    } catch { return []; }
  }

  async getPlanTree(treeRootId: string): Promise<CockpitPlanNode[]> {
    try {
      const r = await firstValueFrom(
        this.http.get<{ ok: boolean; treeRootId: string; nodes: CockpitPlanNode[] }>(`${BASE}/api/plan-tree`)
      );
      return r.nodes ?? [];
    } catch { return []; }
  }

  async getCharterStatus(treeRootId: string): Promise<Record<string, ItemStatusCode>> {
    try {
      const r = await firstValueFrom(
        this.http.get<{ ok: boolean; statuses: Record<string, ItemStatusCode> }>(`${BASE}/api/charter-status/${treeRootId}`)
      );
      return r.statuses ?? {};
    } catch { return {}; }
  }

  async getFrontier(treeRootId: string): Promise<CockpitFrontierEntry[]> {
    try {
      const r = await firstValueFrom(
        this.http.get<{ ok: boolean; frontier: CockpitFrontierEntry[] }>(`${BASE}/api/frontier/${treeRootId}`)
      );
      return r.frontier ?? [];
    } catch { return []; }
  }

  async postAction(nodeId: string, body: ActionRequest): Promise<boolean> {
    try {
      await firstValueFrom(this.http.post(`${BASE}/api/action/${nodeId}`, body));
      return true;
    } catch { return false; }
  }
}
```

- [ ] **Step 4: Run test**

```bash
cd domains/foundry/apps/cockpit && npm test 2>&1 | grep -E "FoundryCockpitClient|✓"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/shared/
git commit -m "feat(cockpit): FoundryCockpitClient + cockpit-types"
```

---

### Task 6: `LiveStatusService`

Component-provided (scoped per Execute page instance). Polls `GET /api/charter-status/:treeRootId` every 5s.

**Files:**
- Create: `src/app/shared/live-status.service.ts`
- Create: `src/app/shared/live-status.service.spec.ts`

**Interfaces:**
- Produces: `LiveStatusService` class; `statuses: Signal<Record<string, ItemStatusCode>>`; `start(treeRootId)` / `stop()` lifecycle methods

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/shared/live-status.service.spec.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LiveStatusService } from './live-status.service.js';
import type { FoundryCockpitClient } from './foundry-cockpit.client.js';

describe('LiveStatusService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts empty then updates on poll', async () => {
    const mockClient = {
      getCharterStatus: vi.fn().mockResolvedValue({ 'node-1': 'claimed' }),
    } as unknown as FoundryCockpitClient;

    const svc = new LiveStatusService(mockClient);
    expect(svc.statuses()).toEqual({});

    svc.start('tree-root-1');
    await Promise.resolve(); // let first poll resolve
    // Advance fake timers to fire the immediate first call
    await vi.runAllTimersAsync();

    expect(mockClient.getCharterStatus).toHaveBeenCalledWith('tree-root-1');
    svc.stop();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd domains/foundry/apps/cockpit && npm test -- --reporter=verbose 2>&1 | grep -E "LiveStatus|FAIL"
```

- [ ] **Step 3: Implement `LiveStatusService`**

```typescript
// src/app/shared/live-status.service.ts
import { Injectable, inject, signal } from '@angular/core';
import { FoundryCockpitClient } from './foundry-cockpit.client.js';
import type { ItemStatusCode } from './cockpit-types.js';

@Injectable()
export class LiveStatusService {
  private readonly client: FoundryCockpitClient;
  private intervalId: ReturnType<typeof setInterval> | null = null;

  readonly statuses = signal<Record<string, ItemStatusCode>>({});

  constructor(client?: FoundryCockpitClient) {
    // Support both Angular DI (no arg) and test construction (explicit arg)
    this.client = client ?? inject(FoundryCockpitClient);
  }

  start(treeRootId: string): void {
    this.stop();
    const poll = () => {
      this.client.getCharterStatus(treeRootId).then(s => this.statuses.set(s));
    };
    poll(); // immediate first poll
    this.intervalId = setInterval(poll, 5_000);
  }

  stop(): void {
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd domains/foundry/apps/cockpit && npm test 2>&1 | grep -E "LiveStatus|✓"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/shared/live-status.service.ts src/app/shared/live-status.service.spec.ts
git commit -m "feat(cockpit): LiveStatusService — component-provided 5s charter status poll"
```

---

### Task 7: `planNodesToRenderTree()` pure adapter

Converts flat `PlanNode[]` → hierarchical `RenderNode` tree consumed by `ds-board-kit`. Pure function, no side effects.

**Files:**
- Create: `src/app/shared/plan-tree-render.ts`
- Create: `src/app/shared/plan-tree-render.spec.ts`

**Interfaces:**
- Consumes: `RenderNode` from `@de-braighter/design-system-core`; `CockpitPlanNode`
- Produces: `planNodesToRenderTree(nodes, statusMap, selectedId): RenderNode`

- [ ] **Step 1: Write failing tests**

```typescript
// src/app/shared/plan-tree-render.spec.ts
import { describe, it, expect } from 'vitest';
import { planNodesToRenderTree } from './plan-tree-render.js';
import type { CockpitPlanNode } from './cockpit-types.js';

const makeNode = (id: string, parentId: string | null, kind = 'work-item', children: string[] = []): CockpitPlanNode => ({
  id, parentId, kind, kindRef: kind, treeRootId: 'root', ordinal: 0, childrenIds: children, metadata: {},
});

describe('planNodesToRenderTree', () => {
  it('builds a single-root tree from flat node list', () => {
    const nodes = [
      makeNode('root', null, 'product', ['child-1']),
      makeNode('child-1', 'root', 'feature', []),
    ];
    const tree = planNodesToRenderTree(nodes, {}, undefined);
    expect(tree.id).toBe('root');
    expect(tree.kind).toBe('product');
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].id).toBe('child-1');
  });

  it('sets fill prop to done color for done status', () => {
    const nodes = [makeNode('n1', null, 'work-item', [])];
    const tree = planNodesToRenderTree(nodes, { 'n1': 'done' }, undefined);
    expect(tree.props['fill']).toBe('var(--color-success-fill, #14532d)');
  });

  it('sets selected flag for selectedId node', () => {
    const nodes = [makeNode('n1', null, 'work-item', [])];
    const tree = planNodesToRenderTree(nodes, {}, 'n1');
    expect(tree.props['__selected']).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd domains/foundry/apps/cockpit && npm test -- plan-tree-render 2>&1 | tail -10
```

- [ ] **Step 3: Implement `plan-tree-render.ts`**

```typescript
// src/app/shared/plan-tree-render.ts
import type { RenderNode } from '@de-braighter/design-system-core';
import type { CockpitPlanNode, ItemStatusCode } from './cockpit-types.js';

const STATUS_FILL: Record<ItemStatusCode, string> = {
  'done':         'var(--color-success-fill, #14532d)',
  'claimed':      'var(--color-info-fill, #1e3a5f)',
  'blocked':      'var(--color-danger-fill, #4c1d1d)',
  'gate-pending': 'var(--color-warning-fill, #4a3000)',
  'queued':       'var(--color-neutral-fill, #1a1f2e)',
};
const STATUS_STROKE: Record<ItemStatusCode, string | undefined> = {
  'done':         undefined,
  'claimed':      'var(--color-info, #3b82f6)',
  'blocked':      undefined,
  'gate-pending': 'var(--color-warning, #f59e0b)',
  'queued':       undefined,
};

/**
 * Converts a flat PlanNode array into a RenderNode tree for ds-board-kit.
 * Pure — no side effects, no Angular deps.
 */
export function planNodesToRenderTree(
  nodes: CockpitPlanNode[],
  statusMap: Record<string, ItemStatusCode>,
  selectedId: string | undefined,
): RenderNode {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const root = nodes.find(n => n.parentId === null);
  if (!root) {
    // Return a placeholder root when no nodes
    return { id: '__empty', kind: 'product', props: { label: '(no nodes)' }, children: [] };
  }

  function buildNode(id: string): RenderNode {
    const n = byId.get(id);
    if (!n) return { id, kind: 'work-item', props: { label: id }, children: [] };
    const status = statusMap[id] as ItemStatusCode | undefined;
    const meta = n.metadata as Record<string, unknown>;
    const charter = meta['charter'] as Record<string, unknown> | undefined;
    return {
      id: n.id,
      kind: kindGroup(n.kind),
      props: {
        label: (meta['title'] as string | undefined) ?? n.kindRef ?? n.kind,
        executionMode: (charter?.['executionMode'] as string | undefined) ?? 'ai',
        fill: status ? STATUS_FILL[status] : STATUS_FILL['queued'],
        stroke: status ? STATUS_STROKE[status] : undefined,
        __selected: id === selectedId,
      },
      children: n.childrenIds.map(buildNode),
    };
  }

  return buildNode(root.id);
}

function kindGroup(kind: string): string {
  if (kind === 'product' || kind === 'system') return 'product';
  if (kind === 'capability' || kind === 'feature') return 'feature';
  if (kind.startsWith('gate')) return 'gate';
  if (kind.startsWith('knowledge')) return 'knowledge';
  if (kind.startsWith('ops')) return 'ops';
  return 'work-item';
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd domains/foundry/apps/cockpit && npm test -- plan-tree-render 2>&1 | tail -10
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/shared/plan-tree-render.ts src/app/shared/plan-tree-render.spec.ts
git commit -m "feat(cockpit): planNodesToRenderTree() — pure PlanNode[] → RenderNode adapter"
```

---

### Task 8: `planTreeToRecipe()` pure adapter

Produces an `EditorRecipe` (declarative shape templates + edge connectors) from `CockpitPlanNode[]`. Interpreted by `interpretRecipe()` into a `BoardRegistry` for `ds-board-kit`.

**Files:**
- Create: `src/app/shared/plan-tree-recipe.ts`
- Create: `src/app/shared/plan-tree-recipe.spec.ts`

**Interfaces:**
- Consumes: `EditorRecipe`, `RecipeShape`, `RecipeEdge` from `@de-braighter/design-system-core`; `CockpitPlanNode`
- Produces: `planTreeToRecipe(nodes, statusMap, selectedId): EditorRecipe`

- [ ] **Step 1: Write failing tests**

```typescript
// src/app/shared/plan-tree-recipe.spec.ts
import { describe, it, expect } from 'vitest';
import { planTreeToRecipe } from './plan-tree-recipe.js';
import type { CockpitPlanNode } from './cockpit-types.js';

const node = (id: string, kind: string, parent: string | null = null): CockpitPlanNode => ({
  id, parentId: parent, kind, kindRef: kind, treeRootId: 'root', ordinal: 0, childrenIds: [], metadata: {},
});

describe('planTreeToRecipe', () => {
  it('returns an EditorRecipe with at least one shape per kind group present in nodes', () => {
    const nodes = [node('n1', 'product'), node('n2', 'work-item', 'n1')];
    const recipe = planTreeToRecipe(nodes, {}, undefined);
    expect(recipe.id).toBe('cockpit-board');
    expect(recipe.shapes.length).toBeGreaterThan(0);
    const shapeKinds = recipe.shapes.map(s => s.kind);
    expect(shapeKinds).toContain('product');
    expect(shapeKinds).toContain('work-item');
  });

  it('emits a connector edge for parent-child relationships', () => {
    const nodes = [
      node('root', 'product'),
      node('child', 'work-item', 'root'),
    ];
    const recipe = planTreeToRecipe(nodes, {}, undefined);
    expect(recipe.edges?.some(e => e.source.nodeId === 'root' && e.target.nodeId === 'child')).toBe(true);
  });

  it('pure — calling twice with same input returns structurally equal result', () => {
    const nodes = [node('n1', 'feature')];
    expect(planTreeToRecipe(nodes, {}, undefined)).toEqual(planTreeToRecipe(nodes, {}, undefined));
  });
});
```

- [ ] **Step 2: Implement `plan-tree-recipe.ts`**

```typescript
// src/app/shared/plan-tree-recipe.ts
import type { EditorRecipe, RecipeShape, RecipeEdge } from '@de-braighter/design-system-core';
import type { CockpitPlanNode } from './cockpit-types.js';

// Shape dimensions per kind group
const DIMS: Record<string, { w: number; h: number; rx: number }> = {
  product:    { w: 200, h: 60, rx: 10 },
  feature:    { w: 160, h: 48, rx: 8 },
  gate:       { w: 80,  h: 80, rx: 4 },
  knowledge:  { w: 140, h: 40, rx: 4 },
  ops:        { w: 80,  h: 80, rx: 4 },
  'work-item':{ w: 140, h: 40, rx: 8 },
};
const DEFAULT_DIM = { w: 140, h: 40, rx: 8 };

const KIND_GROUPS = ['product', 'feature', 'gate', 'knowledge', 'ops', 'work-item'] as const;

function shapeForKind(kindGroup: string): RecipeShape {
  const { w, h, rx } = DIMS[kindGroup] ?? DEFAULT_DIM;
  const isGate = kindGroup === 'gate';
  const isOps = kindGroup === 'ops';
  return {
    kind: kindGroup,
    bounds: { x: 0, y: 0, w, h },
    a11y: { role: 'img', name: { bind: 'label' } },
    draw: [
      // Background rect (or diamond approximation for gates)
      {
        p: 'rect',
        x: isGate ? w / 4 : 0,
        y: isGate ? h / 4 : 0,
        w: isGate ? w / 2 : w,
        h: isGate ? h / 2 : h,
        rx,
        fill: { bind: 'fill' },
        stroke: { bind: 'stroke' },
      } as RecipeShape['draw'][number],
      // Label text
      {
        p: 'text',
        x: w / 2,
        y: h / 2 + 5,
        text: { bind: 'label' },
        anchor: 'middle',
        fill: 'var(--ink, #e8ecf7)',
      } as RecipeShape['draw'][number],
      // executionMode icon — bottom-right 16×16
      {
        p: 'text',
        x: w - 4,
        y: h - 4,
        text: { when: 'executionMode', then: { bind: 'executionModeIcon' }, else: '' },
        anchor: 'end',
        fill: 'var(--ink-2, #94a3d2)',
      } as RecipeShape['draw'][number],
    ],
  };
}

function nodeKindGroup(kind: string): string {
  if (kind === 'product' || kind === 'system') return 'product';
  if (kind === 'capability' || kind === 'feature') return 'feature';
  if (kind.startsWith('gate')) return 'gate';
  if (kind.startsWith('knowledge')) return 'knowledge';
  if (kind.startsWith('ops')) return 'ops';
  return 'work-item';
}

/**
 * Pure adapter: PlanNode[] → EditorRecipe.
 * The recipe contains SHAPE TEMPLATES (one per kind group) + EDGES (parent→child connectors).
 * Interpreted by interpretRecipe() into a BoardRegistry.
 */
export function planTreeToRecipe(
  nodes: CockpitPlanNode[],
  _statusMap: Record<string, string>,
  _selectedId: string | undefined,
): EditorRecipe {
  // Collect which kind groups are present
  const presentGroups = new Set(nodes.map(n => nodeKindGroup(n.kind)));
  const shapes: RecipeShape[] = [...presentGroups].map(shapeForKind);

  // Build parent→child edges (structural tree connectors)
  const edges: RecipeEdge[] = nodes
    .filter(n => n.parentId !== null)
    .map((n) => ({
      id: `e-${n.parentId}-${n.id}`,
      kind: 'arrow' as const,
      source: { nodeId: n.parentId!, attach: { on: 'side' as const, side: 'bottom' as const, t: 0.5 } },
      target: { nodeId: n.id, attach: { on: 'side' as const, side: 'top' as const, t: 0.5 } },
      stroke: 'var(--rule, #2a2f40)',
    }));

  // Cross-tree reference edges from metadata.relatedNodeId
  for (const n of nodes) {
    const relatedId = (n.metadata as Record<string, unknown>)?.['relatedNodeId'] as string | undefined;
    if (relatedId) {
      edges.push({
        id: `xref-${n.id}-${relatedId}`,
        kind: 'line',
        source: { nodeId: n.id, attach: { on: 'side', side: 'right', t: 0.5 } },
        target: { nodeId: relatedId, attach: { on: 'side', side: 'left', t: 0.5 } },
        stroke: 'var(--color-info, #3b82f6)',
        dash: '4 4',
      });
    }
  }

  return { id: 'cockpit-board', name: 'Cockpit Board', shapes, edges };
}
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
cd domains/foundry/apps/cockpit && npm test -- plan-tree-recipe 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add src/app/shared/plan-tree-recipe.ts src/app/shared/plan-tree-recipe.spec.ts
git commit -m "feat(cockpit): planTreeToRecipe() — pure EditorRecipe adapter for SVG board"
```

---

### Task 9: `CockpitBoardComponent`

Wraps `ds-board-kit` using the recipe + render-tree adapters.

**Files:**
- Create: `src/app/execute/board/cockpit-board.component.ts`

**Interfaces:**
- Consumes: `BoardKitComponent` from `@de-braighter/design-system-angular`; `interpretRecipe` from `@de-braighter/design-system-core`; `planNodesToRenderTree`, `planTreeToRecipe`; `input()` signals: `nodes`, `statusMap`, `selectedId`
- Produces: `CockpitBoardComponent` with `nodeSelected = output<string>()` 

- [ ] **Step 1: Write test**

```typescript
// src/app/execute/board/cockpit-board.component.spec.ts
import { describe, it, expect } from 'vitest';
import { CockpitBoardComponent } from './cockpit-board.component.js';

describe('CockpitBoardComponent', () => {
  it('is defined', () => { expect(CockpitBoardComponent).toBeDefined(); });
});
```

- [ ] **Step 2: Implement component**

```typescript
// src/app/execute/board/cockpit-board.component.ts
import {
  ChangeDetectionStrategy, Component, computed, input, output
} from '@angular/core';
import { BoardKitComponent } from '@de-braighter/design-system-angular';
import { interpretRecipe } from '@de-braighter/design-system-core';
import type { Frame } from '@de-braighter/design-system-core';
import { planNodesToRenderTree } from '../../shared/plan-tree-render.js';
import { planTreeToRecipe } from '../../shared/plan-tree-recipe.js';
import type { CockpitPlanNode, ItemStatusCode } from '../../shared/cockpit-types.js';

const X_STEP = 200;
const Y_STEP = 120;
const PAD = 40;

@Component({
  selector: 'app-cockpit-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BoardKitComponent],
  template: `
    <ds-board-kit
      [tree]="renderTree()"
      [registry]="registry()"
      [frame]="frame()"
      [edges]="edges()"
      (selectionChange)="nodeSelected.emit($event)"
    />
  `,
  styles: [':host { display: block; width: 100%; height: 100%; }'],
})
export class CockpitBoardComponent {
  readonly nodes = input.required<CockpitPlanNode[]>();
  readonly statusMap = input<Record<string, ItemStatusCode>>({});
  readonly selectedId = input<string | undefined>(undefined);

  readonly nodeSelected = output<string>();

  readonly renderTree = computed(() =>
    planNodesToRenderTree(this.nodes(), this.statusMap(), this.selectedId())
  );

  private readonly recipe = computed(() =>
    planTreeToRecipe(this.nodes(), this.statusMap(), this.selectedId())
  );

  readonly registry = computed(() => interpretRecipe(this.recipe()));
  readonly edges = computed(() => this.recipe().edges ?? []);

  readonly frame = computed((): Frame => {
    const n = Math.max(1, this.nodes().length);
    // Rough canvas sizing: sqrt(n) columns × rows × step + padding
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { width: cols * X_STEP + PAD * 2, height: rows * Y_STEP + PAD * 2, layout: 'tree' };
  });
}
```

- [ ] **Step 3: Run test, then commit**

```bash
cd domains/foundry/apps/cockpit && npm test -- cockpit-board 2>&1 | tail -5
git add src/app/execute/board/
git commit -m "feat(cockpit): CockpitBoardComponent — ds-board-kit wrapper with recipe adapter"
```

---

### Task 10: Project Page (forest home)

**Files:**
- Create: `src/app/project/project.page.ts`

**Interfaces:**
- Consumes: `FoundryCockpitClient.getTrees()`, `Router`
- Produces: `ProjectPage` — attention bar + tree cards grid + ghost cards + routing

- [ ] **Step 1: Write test**

```typescript
// src/app/project/project.page.spec.ts
import { describe, it, expect } from 'vitest';
import { ProjectPage } from './project.page.js';

describe('ProjectPage', () => {
  it('is defined', () => { expect(ProjectPage).toBeDefined(); });
});
```

- [ ] **Step 2: Implement**

```typescript
// src/app/project/project.page.ts
import {
  ChangeDetectionStrategy, Component, OnInit, computed, inject, signal
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FoundryCockpitClient } from '../shared/foundry-cockpit.client.js';
import type { CockpitTree } from '../shared/cockpit-types.js';

const TREE_ROLES = ['sdlc', 'features', 'knowledge', 'ops', 'roadmap', 'governance'] as const;
type TreeRole = typeof TREE_ROLES[number];

const ROLE_COLOR: Record<TreeRole, string> = {
  sdlc: 'var(--color-info, #3b82f6)',
  features: 'var(--color-violet, #8b5cf6)',
  knowledge: 'var(--color-amber, #f59e0b)',
  ops: 'var(--color-danger, #ef4444)',
  roadmap: 'var(--color-success, #22c55e)',
  governance: 'var(--ink-3, #4b5563)',
};

@Component({
  selector: 'app-project-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <!-- Attention bar -->
    <div class="attention-bar">
      <span class="chip">⊙ {{ totalGatePending() }} gates pending</span>
      <span class="chip">● {{ totalClaimed() }} claimed</span>
      <span class="chip">✕ {{ totalBlocked() }} blocked</span>
      <span class="chip">✓ {{ totalDone() }} done</span>
    </div>

    <!-- Tree cards grid -->
    <section class="tree-grid" aria-label="Plan tree forest">
      @for (role of treeRoles; track role) {
        @if (treeByRole()[role]; as tree) {
          <!-- Real tree card -->
          <button class="tree-card" (click)="navigate(tree)">
            <div class="role-badge" [style.color]="roleColor(role)">{{ role }}</div>
            <div class="tree-title">{{ treeName(tree) }}</div>
            <div class="node-count">{{ tree.nodeCount }} nodes</div>
            <div class="progress-bar">
              <div class="progress-fill" [style.width.%]="progressPct(tree)"></div>
            </div>
            <div class="status-chips">
              @if (tree.statusCounts.claimed) { <span class="chip-small">{{ tree.statusCounts.claimed }} claimed</span> }
              @if (tree.statusCounts.gatePending) { <span class="chip-small pulse">⊙ {{ tree.statusCounts.gatePending }} gate</span> }
            </div>
          </button>
        } @else {
          <!-- Ghost card -->
          <a class="tree-card ghost" [routerLink]="['/tree', 'new', 'draft']" [queryParams]="{ treeRole: role }">
            <div class="role-badge" [style.color]="roleColor(role)">{{ role }}</div>
            <div class="ghost-label">+ Create blueprint</div>
          </a>
        }
      }
    </section>
  `,
  styles: [`
    :host { display: block; padding: 24px; }
    .attention-bar { display: flex; gap: 12px; margin-bottom: 24px; flex-wrap: wrap; }
    .chip { padding: 6px 12px; background: var(--bg-elev, #161b2c); border-radius: 20px; font-size: 0.8rem; color: var(--ink-2, #94a3d2); }
    .tree-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
    .tree-card { background: var(--bg-elev, #161b2c); border: 1px solid var(--rule, #2a2f40); border-radius: 12px; padding: 16px; cursor: pointer; text-align: left; color: inherit; width: 100%; }
    .tree-card:hover { border-color: var(--accent-rim, #22d39a40); }
    .tree-card.ghost { border-style: dashed; opacity: 0.5; display: block; text-decoration: none; }
    .role-badge { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; margin-bottom: 8px; }
    .tree-title { font-weight: 600; margin-bottom: 4px; font-size: 0.9rem; }
    .node-count { font-size: 0.75rem; color: var(--ink-2, #94a3d2); margin-bottom: 8px; }
    .progress-bar { height: 4px; background: var(--bg-sunken, #0c1019); border-radius: 2px; margin-bottom: 8px; }
    .progress-fill { height: 100%; background: var(--accent, #22d39a); border-radius: 2px; }
    .status-chips { display: flex; gap: 6px; font-size: 0.7rem; flex-wrap: wrap; }
    .chip-small { padding: 2px 6px; background: var(--bg-sunken, #0c1019); border-radius: 10px; color: var(--ink-2, #94a3d2); }
    .ghost-label { color: var(--ink-3, #4b5563); margin-top: 12px; font-size: 0.85rem; }
    .pulse { animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
  `],
})
export class ProjectPage implements OnInit {
  private readonly client = inject(FoundryCockpitClient);
  private readonly router = inject(Router);

  readonly treeRoles = [...TREE_ROLES];
  private readonly trees = signal<CockpitTree[]>([]);

  readonly treeByRole = computed(() => {
    const map: Partial<Record<TreeRole, CockpitTree>> = {};
    for (const t of this.trees()) {
      const role = t.treeRole as TreeRole;
      if (TREE_ROLES.includes(role)) map[role] = t;
    }
    return map;
  });

  readonly totalGatePending = computed(() => this.trees().reduce((s, t) => s + t.statusCounts.gatePending, 0));
  readonly totalClaimed = computed(() => this.trees().reduce((s, t) => s + t.statusCounts.claimed, 0));
  readonly totalBlocked = computed(() => this.trees().reduce((s, t) => s + t.statusCounts.blocked, 0));
  readonly totalDone = computed(() => this.trees().reduce((s, t) => s + t.statusCounts.done, 0));

  async ngOnInit() {
    const trees = await this.client.getTrees();
    this.trees.set(trees);
  }

  roleColor(role: string): string {
    return ROLE_COLOR[role as TreeRole] ?? 'var(--ink-2)';
  }

  treeName(tree: CockpitTree): string {
    const meta = tree.node.metadata as Record<string, unknown>;
    return (meta['title'] as string | undefined) ?? tree.treeRole;
  }

  progressPct(tree: CockpitTree): number {
    const total = tree.nodeCount;
    return total > 0 ? Math.round((tree.statusCounts.done / total) * 100) : 0;
  }

  navigate(tree: CockpitTree): void {
    const id = tree.node.id;
    const hasClaimed = tree.statusCounts.claimed > 0 || tree.statusCounts.gatePending > 0;
    if (hasClaimed) {
      this.router.navigate(['/tree', id, 'execute']);
    } else {
      this.router.navigate(['/tree', id, 'execute']);
    }
  }
}
```

- [ ] **Step 3: Run test + commit**

```bash
cd domains/foundry/apps/cockpit && npm test -- project 2>&1 | tail -5
git add src/app/project/
git commit -m "feat(cockpit): ProjectPage — forest home (attention bar + tree cards grid)"
```

---

### Task 11: Execute Page layout + node selection state

Three-zone layout (frontier | SVG board | detail panel) with shared `selectedNodeId` signal.

**Files:**
- Create: `src/app/execute/execute.page.ts`

**Interfaces:**
- Consumes: `FoundryCockpitClient`, `LiveStatusService`, `CockpitBoardComponent`, `ActivatedRoute`
- Produces: `ExecutePage` with `selectedNodeId` signal; `nodes` + `statusMap` signals; placeholder zones

- [ ] **Step 1: Write test**

```typescript
// src/app/execute/execute.page.spec.ts
import { describe, it, expect } from 'vitest';
import { ExecutePage } from './execute.page.js';
describe('ExecutePage', () => { it('is defined', () => { expect(ExecutePage).toBeDefined(); }); });
```

- [ ] **Step 2: Implement**

```typescript
// src/app/execute/execute.page.ts
import {
  ChangeDetectionStrategy, Component, OnDestroy, OnInit,
  computed, inject, signal
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FoundryCockpitClient } from '../shared/foundry-cockpit.client.js';
import { LiveStatusService } from '../shared/live-status.service.js';
import { CockpitBoardComponent } from './board/cockpit-board.component.js';
import { FrontierPanelComponent } from './frontier-panel/frontier-panel.component.js';
import { NodeDetailPanelComponent } from './node-detail/node-detail-panel.component.js';
import type { CockpitPlanNode, CockpitFrontierEntry } from '../shared/cockpit-types.js';

@Component({
  selector: 'app-execute-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CockpitBoardComponent, FrontierPanelComponent, NodeDetailPanelComponent],
  providers: [LiveStatusService],
  template: `
    <div class="execute-layout">
      <!-- Left: frontier panel -->
      <aside class="frontier-zone">
        <app-frontier-panel
          [frontier]="frontier()"
          [selectedId]="selectedNodeId()"
          (nodeSelected)="selectedNodeId.set($event)"
          (refreshRequested)="loadFrontier()"
        />
      </aside>

      <!-- Centre: SVG board -->
      <section class="board-zone">
        @if (nodes().length > 0) {
          <app-cockpit-board
            [nodes]="nodes()"
            [statusMap]="liveStatus.statuses()"
            [selectedId]="selectedNodeId()"
            (nodeSelected)="selectedNodeId.set($event)"
          />
        } @else {
          <div class="empty-board">Loading plan tree…</div>
        }
      </section>

      <!-- Right: node detail slide-in -->
      @if (selectedNodeId()) {
        <aside class="detail-zone">
          <app-node-detail-panel
            [node]="selectedNode()"
            [treeRootId]="treeRootId()"
            (actionCompleted)="onActionCompleted()"
            (closed)="selectedNodeId.set(undefined)"
          />
        </aside>
      }
    </div>
  `,
  styles: [`
    :host { display: block; height: 100%; }
    .execute-layout { display: flex; height: 100%; overflow: hidden; }
    .frontier-zone { width: 280px; flex-shrink: 0; border-right: 1px solid var(--rule, #2a2f40); overflow-y: auto; }
    .board-zone { flex: 1; min-width: 0; overflow: hidden; }
    .detail-zone { width: 320px; flex-shrink: 0; border-left: 1px solid var(--rule, #2a2f40); overflow-y: auto; }
    .empty-board { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--ink-2, #94a3d2); }
  `],
})
export class ExecutePage implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly client = inject(FoundryCockpitClient);
  readonly liveStatus = inject(LiveStatusService);

  readonly treeRootId = signal<string>('');
  readonly nodes = signal<CockpitPlanNode[]>([]);
  readonly frontier = signal<CockpitFrontierEntry[]>([]);
  readonly selectedNodeId = signal<string | undefined>(undefined);

  readonly selectedNode = computed(() => {
    const id = this.selectedNodeId();
    return id ? this.nodes().find(n => n.id === id) ?? null : null;
  });

  async ngOnInit() {
    const treeId = this.route.snapshot.paramMap.get('treeId') ?? '';
    this.treeRootId.set(treeId);
    this.liveStatus.start(treeId);
    await Promise.all([this.loadNodes(treeId), this.loadFrontier()]);
  }

  ngOnDestroy() {
    this.liveStatus.stop();
  }

  async loadNodes(treeId: string) {
    const nodes = await this.client.getPlanTree(treeId);
    this.nodes.set(nodes);
  }

  async loadFrontier() {
    const id = this.treeRootId();
    if (!id) return;
    const frontier = await this.client.getFrontier(id);
    this.frontier.set(frontier);
  }

  async onActionCompleted() {
    await this.loadFrontier();
    this.liveStatus.start(this.treeRootId()); // re-poll immediately
  }
}
```

- [ ] **Step 3: Run test + commit**

```bash
cd domains/foundry/apps/cockpit && npm test -- execute.page 2>&1 | tail -5
git add src/app/execute/execute.page.ts
git commit -m "feat(cockpit): ExecutePage — three-zone layout with selectedNodeId signal"
```

---

### Task 12: Frontier Panel component

**Files:**
- Create: `src/app/execute/frontier-panel/frontier-panel.component.ts`

**Interfaces:**
- Consumes: `input() frontier: CockpitFrontierEntry[]`, `input() selectedId`, `output() nodeSelected`, `output() refreshRequested`
- Produces: `FrontierPanelComponent` — sorted list, executionMode icons, human gates float top

- [ ] **Step 1: Write test**

```typescript
// src/app/execute/frontier-panel/frontier-panel.component.spec.ts
import { describe, it, expect } from 'vitest';
import { FrontierPanelComponent } from './frontier-panel.component.js';
describe('FrontierPanelComponent', () => { it('is defined', () => { expect(FrontierPanelComponent).toBeDefined(); }); });
```

- [ ] **Step 2: Implement**

```typescript
// src/app/execute/frontier-panel/frontier-panel.component.ts
import {
  ChangeDetectionStrategy, Component, computed, input, output
} from '@angular/core';
import type { CockpitFrontierEntry } from '../../shared/cockpit-types.js';

const MODE_ICON: Record<string, string> = {
  deterministic: '⚙',
  ai: '✦',
  human: '⊙',
  hybrid: '⚙✦',
};

@Component({
  selector: 'app-frontier-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fp-header">
      <span class="fp-title">Frontier</span>
      <button class="fp-refresh" (click)="refreshRequested.emit()" aria-label="Refresh frontier">↺</button>
    </div>
    @if (sorted().length === 0) {
      <p class="fp-empty">No actionable nodes — all items done or waiting on upstream dependencies.</p>
    } @else {
      <ul class="fp-list" role="listbox" aria-label="Frontier nodes">
        @for (entry of sorted(); track entry.nodeId) {
          <li
            role="option"
            class="fp-entry"
            [class.selected]="entry.nodeId === selectedId()"
            [class.human]="entry.executionMode === 'human'"
            [attr.aria-selected]="entry.nodeId === selectedId()"
            (click)="nodeSelected.emit(entry.nodeId)"
            (keydown.enter)="nodeSelected.emit(entry.nodeId)"
            (keydown.space)="nodeSelected.emit(entry.nodeId)"
            tabindex="0"
          >
            <span class="fp-mode-icon" aria-hidden="true">{{ modeIcon(entry.executionMode) }}</span>
            <span class="fp-title-text">{{ entry.title }}</span>
            <span class="fp-kind-badge">{{ entry.kind }}</span>
          </li>
        }
      </ul>
    }
  `,
  styles: [`
    :host { display: block; padding: 12px 0; }
    .fp-header { display: flex; align-items: center; justify-content: space-between; padding: 0 12px 8px; border-bottom: 1px solid var(--rule, #2a2f40); }
    .fp-title { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; color: var(--ink-2, #94a3d2); letter-spacing: 0.05em; }
    .fp-refresh { background: none; border: none; cursor: pointer; color: var(--ink-2); font-size: 1rem; padding: 2px 4px; }
    .fp-empty { padding: 16px 12px; font-size: 0.8rem; color: var(--ink-3, #4b5563); }
    .fp-list { list-style: none; margin: 0; padding: 0; }
    .fp-entry { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; border-radius: 0; }
    .fp-entry:hover, .fp-entry.selected { background: var(--bg-elev, #161b2c); }
    .fp-entry.human { border-left: 3px solid var(--color-warning, #f59e0b); }
    .fp-mode-icon { font-size: 0.9rem; width: 20px; text-align: center; flex-shrink: 0; }
    .fp-title-text { flex: 1; font-size: 0.85rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .fp-kind-badge { font-size: 0.65rem; color: var(--ink-3, #4b5563); background: var(--bg-sunken, #0c1019); padding: 2px 4px; border-radius: 4px; flex-shrink: 0; }
  `],
})
export class FrontierPanelComponent {
  readonly frontier = input.required<CockpitFrontierEntry[]>();
  readonly selectedId = input<string | undefined>(undefined);
  readonly nodeSelected = output<string>();
  readonly refreshRequested = output<void>();

  // Human gates float to top, otherwise stable order
  readonly sorted = computed(() => {
    const entries = [...this.frontier()];
    entries.sort((a, b) => {
      if (a.executionMode === 'human' && b.executionMode !== 'human') return -1;
      if (a.executionMode !== 'human' && b.executionMode === 'human') return 1;
      return 0;
    });
    return entries;
  });

  modeIcon(mode: string): string {
    return MODE_ICON[mode] ?? '✦';
  }
}
```

- [ ] **Step 3: Run test + commit**

```bash
cd domains/foundry/apps/cockpit && npm test -- frontier-panel 2>&1 | tail -5
git add src/app/execute/frontier-panel/
git commit -m "feat(cockpit): FrontierPanelComponent — frontier list with executionMode icons"
```

---

### Task 13: Node Detail Panel + action buttons

**Files:**
- Create: `src/app/execute/node-detail/node-detail-panel.component.ts`

**Interfaces:**
- Consumes: `input() node: CockpitPlanNode | null`, `input() treeRootId: string`, `FoundryCockpitClient`; `output() actionCompleted`, `output() closed`
- Produces: `NodeDetailPanelComponent` — fields display + context-sensitive action buttons + HTTP dispatch

- [ ] **Step 1: Write test**

```typescript
// src/app/execute/node-detail/node-detail-panel.component.spec.ts
import { describe, it, expect } from 'vitest';
import { NodeDetailPanelComponent } from './node-detail-panel.component.js';
describe('NodeDetailPanelComponent', () => { it('is defined', () => { expect(NodeDetailPanelComponent).toBeDefined(); }); });
```

- [ ] **Step 2: Implement**

```typescript
// src/app/execute/node-detail/node-detail-panel.component.ts
import {
  ChangeDetectionStrategy, Component, computed, inject, input, output, signal
} from '@angular/core';
import { FoundryCockpitClient } from '../../shared/foundry-cockpit.client.js';
import type { CockpitPlanNode } from '../../shared/cockpit-types.js';

const MODE_ICON: Record<string, string> = {
  deterministic: '⚙ Script', ai: '✦ AI', human: '⊙ Human', hybrid: '⚙✦ Hybrid',
};

@Component({
  selector: 'app-node-detail-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (node()) {
      <div class="ndp">
        <div class="ndp-header">
          <span class="ndp-kind">{{ node()?.kind }}</span>
          <button class="ndp-close" (click)="closed.emit()" aria-label="Close detail">✕</button>
        </div>
        <div class="ndp-body">
          <h2 class="ndp-title">{{ title() }}</h2>
          <div class="ndp-badges">
            <span class="badge mode-badge">{{ modeBadge() }}</span>
            @if (treeRole()) { <span class="badge role-badge">{{ treeRole() }}</span> }
          </div>

          @if (scriptRef()) {
            <div class="ndp-field">
              <label>Script</label><span class="mono">{{ scriptRef() }}</span>
            </div>
          }

          @if (charterMission()) {
            <details class="ndp-charter">
              <summary>Charter contract</summary>
              <div class="ndp-field"><label>Mission</label><p>{{ charterMission() }}</p></div>
              @if (charterScope()) { <div class="ndp-field"><label>Scope</label><p>{{ charterScope() }}</p></div> }
            </details>
          }

          <!-- Action buttons -->
          <div class="ndp-actions">
            @if (nodeStatus() === 'queued') {
              <button class="btn-primary" [disabled]="acting()" (click)="act('claim')">Claim</button>
            }
            @if (nodeStatus() === 'claimed') {
              <button class="btn-secondary" [disabled]="acting()" (click)="act('release')">Release</button>
              <button class="btn-secondary" [disabled]="acting()" (click)="act('request-gate')">Request Gate</button>
            }
            @if (nodeStatus() === 'gate-pending') {
              <button class="btn-primary" [disabled]="acting()" (click)="act('decide-gate', 'approved')">Approve</button>
              <button class="btn-danger" [disabled]="acting()" (click)="act('decide-gate', 'rejected')">Reject</button>
            }
            @if (errorMsg()) {
              <p class="ndp-error">{{ errorMsg() }}</p>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .ndp { display: flex; flex-direction: column; height: 100%; }
    .ndp-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--rule, #2a2f40); }
    .ndp-kind { font-size: 0.7rem; color: var(--ink-2, #94a3d2); text-transform: uppercase; letter-spacing: 0.05em; }
    .ndp-close { background: none; border: none; cursor: pointer; color: var(--ink-2); font-size: 1.1rem; padding: 2px; }
    .ndp-body { padding: 16px; flex: 1; overflow-y: auto; }
    .ndp-title { margin: 0 0 12px; font-size: 1rem; font-weight: 600; }
    .ndp-badges { display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
    .badge { padding: 2px 8px; border-radius: 10px; font-size: 0.7rem; background: var(--bg-sunken, #0c1019); }
    .ndp-field { margin-bottom: 10px; }
    .ndp-field label { display: block; font-size: 0.7rem; text-transform: uppercase; color: var(--ink-2, #94a3d2); margin-bottom: 2px; }
    .mono { font-family: var(--font-mono, monospace); font-size: 0.8rem; }
    .ndp-charter { margin-bottom: 12px; }
    .ndp-charter summary { cursor: pointer; color: var(--ink-2); font-size: 0.8rem; margin-bottom: 8px; }
    .ndp-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--rule, #2a2f40); }
    .btn-primary { padding: 8px 16px; background: var(--accent, #22d39a); color: #0f1320; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
    .btn-secondary { padding: 8px 16px; background: var(--bg-elev, #161b2c); color: var(--ink, #e8ecf7); border: 1px solid var(--rule, #2a2f40); border-radius: 6px; cursor: pointer; }
    .btn-danger { padding: 8px 16px; background: var(--color-danger, #ef4444); color: #fff; border: none; border-radius: 6px; cursor: pointer; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .ndp-error { color: var(--color-danger, #ef4444); font-size: 0.8rem; margin: 0; }
  `],
})
export class NodeDetailPanelComponent {
  private readonly client = inject(FoundryCockpitClient);

  readonly node = input<CockpitPlanNode | null>(null);
  readonly treeRootId = input.required<string>();
  readonly actionCompleted = output<void>();
  readonly closed = output<void>();

  readonly acting = signal(false);
  readonly errorMsg = signal<string | null>(null);

  private meta = computed(() => (this.node()?.metadata ?? {}) as Record<string, unknown>);
  private charter = computed(() => (this.meta()?.['charter'] ?? {}) as Record<string, unknown>);

  readonly title = computed(() => (this.meta()?.['title'] as string | undefined) ?? this.node()?.kindRef ?? '');
  readonly treeRole = computed(() => this.meta()?.['treeRole'] as string | undefined);
  readonly executionMode = computed(() => (this.charter()?.['executionMode'] as string | undefined) ?? 'ai');
  readonly modeBadge = computed(() => MODE_ICON[this.executionMode()] ?? this.executionMode());
  readonly scriptRef = computed(() =>
    this.executionMode() === 'deterministic' ? (this.charter()?.['scriptRef'] as string | undefined) : undefined
  );
  readonly charterMission = computed(() => (this.charter()?.['mission'] as string | undefined));
  readonly charterScope = computed(() => (this.charter()?.['scope'] as string | undefined));
  readonly nodeStatus = computed(() => (this.meta()?.['__nodeStatus'] as string | undefined) ?? 'queued');

  async act(action: string, decision?: 'approved' | 'rejected') {
    const n = this.node();
    if (!n) return;
    this.acting.set(true);
    this.errorMsg.set(null);
    const ok = await this.client.postAction(n.id, {
      treeRootId: this.treeRootId(),
      action: action as never,
      decision,
    });
    this.acting.set(false);
    if (ok) {
      this.actionCompleted.emit();
    } else {
      this.errorMsg.set('Action failed — check server logs');
    }
  }
}
```

- [ ] **Step 3: Run test + commit**

```bash
cd domains/foundry/apps/cockpit && npm test -- node-detail 2>&1 | tail -5
git add src/app/execute/node-detail/
git commit -m "feat(cockpit): NodeDetailPanelComponent — fields + context-sensitive action buttons"
```

---

### Task 14: Wire `app.routes.ts` with shell + create stub pages

Update routing to use `CockpitShellComponent` as layout wrapper. Create stub pages for Draft/Deploy/Instances so navigating to `/tree/:id/draft` etc. doesn't 404.

**Files:**
- Modify: `src/app/app.routes.ts`
- Create: `src/app/execute/stub-page.ts`

**Interfaces:**
- Consumes: all lazy-loaded page components
- Produces: full routing tree with shell wrapper

- [ ] **Step 1: Update `app.routes.ts`**

```typescript
// src/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./shell/cockpit-shell.component.js').then(m => m.CockpitShellComponent),
    children: [
      { path: '', loadComponent: () => import('./project/project.page.js').then(m => m.ProjectPage) },
      { path: 'tree/:treeId/execute', loadComponent: () => import('./execute/execute.page.js').then(m => m.ExecutePage) },
      { path: 'tree/:treeId/execute/:instanceId', loadComponent: () => import('./execute/execute.page.js').then(m => m.ExecutePage) },
      { path: 'tree/new/draft', loadComponent: () => import('./execute/stub-page.js').then(m => m.StubPage) },
      { path: '**', redirectTo: '' },
    ],
  },
];
```

- [ ] **Step 2: Create `stub-page.ts`**

```typescript
// src/app/execute/stub-page.ts
import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-stub-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div style="padding:24px;color:var(--ink-2)">Phase 3: Draft/Deploy/Instances (coming soon)</div>`,
})
export class StubPage {}
```

- [ ] **Step 3: Verify app builds**

```bash
cd domains/foundry/apps/cockpit && npm run build 2>&1 | tail -15
```
Expected: `Application bundle generation complete.`

- [ ] **Step 4: Commit**

```bash
git add src/app/app.routes.ts src/app/execute/stub-page.ts
git commit -m "feat(cockpit): complete routing tree with shell wrapper"
```

---

### Task 15: Dev setup, smoke test, and vitest.config

**Files:**
- Create: `domains/foundry/apps/cockpit/vitest.config.ts`
- Modify: `domains/foundry/package.json` (add cockpit start script)

**Interfaces:**
- Produces: `npm test` runs all tests; `npm run cockpit:start` starts the cockpit at :4201; smoke-test confirms servers talk

- [ ] **Step 1: Create `vitest.config.ts`**

```typescript
// domains/foundry/apps/cockpit/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',  // pure unit tests, no DOM
    globals: false,
    include: ['src/**/*.spec.ts'],
  },
});
```

- [ ] **Step 2: Run full test suite**

```bash
cd domains/foundry/apps/cockpit && npm test 2>&1 | tail -20
```
Expected: all tests pass (no failures). Count the number of test files — expect ≥ 8.

- [ ] **Step 3: Add cockpit start to foundry package.json**

In `domains/foundry/package.json`, add to `scripts`:
```json
"cockpit:install": "cd apps/cockpit && npm install",
"cockpit:start": "cd apps/cockpit && npm run start",
"cockpit:build": "cd apps/cockpit && npm run build"
```

- [ ] **Step 4: Smoke test — serve both servers**

Open two terminals.

Terminal 1 (foundry server):
```bash
cd domains/foundry && npm run dashboard:serve 2>&1 | head -5
```
Expected: `dashboard serving at http://127.0.0.1:4555 (Ctrl-C to stop)`

Terminal 2 (cockpit):
```bash
cd domains/foundry && npm run cockpit:start 2>&1 | head -10
```
Expected: `Local: http://localhost:4201/` — Angular build starts.

- [ ] **Step 5: Verify CORS by curling trees endpoint**

```bash
curl -s -H "Origin: http://localhost:4201" http://127.0.0.1:4555/api/trees | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);console.log('ok:', r.ok, 'trees:', r.trees?.length)})"
```
Expected: `ok: true trees: 1` (or more if multiple trees in DB).

- [ ] **Step 6: Final typecheck on charter-runtime + foundry**

```bash
cd layers/charter-runtime && npm run typecheck && cd ../../../domains/foundry && npm run typecheck
```
Expected: both exit 0.

- [ ] **Step 7: Commit final wiring**

```bash
cd domains/foundry
git add package.json apps/cockpit/vitest.config.ts
git commit -m "feat(cockpit): dev setup complete — vitest config, cockpit start scripts, smoke test"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task | Covered? |
|---|---|---|
| New Angular app at `domains/foundry/apps/cockpit` `:4201` | T3 | ✅ |
| Shell: header + breadcrumb + pipeline tabs | T4 | ✅ |
| `GET /api/trees` endpoint | T2 | ✅ |
| `GET /api/frontier/:treeRootId` endpoint | T2 | ✅ |
| `POST /api/action/:nodeId` endpoint | T2 | ✅ |
| `LiveStatusService` 5s poll | T6 | ✅ |
| `planTreeToRecipe()` pure adapter | T8 | ✅ |
| `planNodesToRenderTree()` adapter | T7 | ✅ |
| `CockpitBoardComponent` wrapping ds-board-kit | T9 | ✅ |
| Project page — attention bar + tree cards | T10 | ✅ |
| Ghost cards for missing roles | T10 | ✅ |
| Execute page — three-zone layout | T11 | ✅ |
| Frontier panel — sorted list + executionMode icons | T12 | ✅ |
| Human gate nodes float to top | T12 | ✅ |
| Node detail panel — all fields | T13 | ✅ |
| Action buttons (queued/claimed/gate-pending) | T13 | ✅ |
| `dispatchCharterAction` in charter-runtime | T1 | ✅ |
| CORS for `:4201` | T2 | ✅ |
| ZERO kernel change | all | ✅ (no substrate changes) |

**Placeholder scan:** None found. All steps include actual code.

**Type consistency check:**
- `CockpitPlanNode` used in T5, T7, T8, T9, T11, T12, T13 — same type throughout
- `ItemStatusCode` used in T6, T7, T9, T11 — consistent
- `CockpitFrontierEntry` used in T5, T11, T12 — consistent
- `planNodesToRenderTree(nodes, statusMap, selectedId)` — same signature in T7 definition and T9 usage
- `planTreeToRecipe(nodes, statusMap, selectedId)` — same signature in T8 definition and T9 usage

**Gap found:** `NodeDetailPanelComponent` uses `metadata['__nodeStatus']` for button logic, but this field isn't populated by the server. The `ExecutePage` needs to merge charter status into node metadata OR pass the status separately as an input.

**Fix:** Add `statusMap` input to `NodeDetailPanelComponent` and compute `nodeStatus` from it:

In `NodeDetailPanelComponent`, add:
```typescript
readonly statusMap = input<Record<string, string>>({});
// replace nodeStatus computed:
readonly nodeStatus = computed(() => this.statusMap()[this.node()?.id ?? ''] ?? 'queued');
```

And in `ExecutePage` template, add `[statusMap]="liveStatus.statuses()"` to `<app-node-detail-panel>`.
