# S3 Foundry Migration — Charter Runtime Dogfood Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the foundry consume `@de-braighter/charter-runtime` for its own SDLC plan trees, proving the charter layer works on a real non-toy tree via `extract → compile → generate → conductCharterStep`.

**Architecture:** All 6 `FOUNDRY_WORKFLOW` cascade nodes gain `meta.charter` contracts (role/mission/scope). A `StaticPlanTreeStore` holds the deterministically-reconstructed workflow tree in memory (no DB needed); a `FileCharterEventLog` persists charter lifecycle events to `charter-events.jsonl`. The existing `foundry_conduct_workflow` tool gets a `useCharter?: boolean` flag that routes through `conductCharterStep` when true — zero regression to the existing `conductWorkflowStep` path.

**Tech Stack:** TypeScript ESM, Vitest, `@de-braighter/charter-runtime` (file link), `@de-braighter/substrate-contracts/plan-tree` (already installed at ^2.7.0), `node:fs` (appendFileSync/readFileSync), `node:crypto` (randomUUID).

## Global Constraints

- All imports use explicit `.js` extensions (NodeNext moduleResolution).
- `@de-braighter/charter-runtime` is consumed as `file:../../layers/charter-runtime` — must be built (`npm run build`) before foundry installs it.
- `foundry-core` is consumed as a pre-built dist via `file:` link; same pattern applies to charter-runtime.
- Kernel-Untouched Invariant: zero diff to `layers/substrate` production files.
- All tests use Vitest (`npm test` in each package dir).
- Typecheck command: `npm run typecheck` (runs `tsc --noEmit`).
- Run all tests in `domains/foundry` with: `cd domains/foundry && npm test`.

---

## File map

| Status | Path | Responsibility |
|---|---|---|
| CREATE | `domains/foundry/src/mcp/charter-event-log.ts` | `FileCharterEventLog` — JSONL file-backed `CharterEventLog` port impl |
| CREATE | `domains/foundry/src/mcp/charter-event-log.spec.ts` | Unit tests for `FileCharterEventLog` |
| CREATE | `domains/foundry/src/mcp/static-plan-tree-store.ts` | `StaticPlanTreeStore` — in-memory `PlanTreeStore` for deterministic trees |
| CREATE | `domains/foundry/src/mcp/static-plan-tree-store.spec.ts` | Unit tests for `StaticPlanTreeStore` |
| CREATE | `domains/foundry/src/instances/foundry-workflow-charter.spec.ts` | 5-assertion integration test: extract→compile→generate→conductCharterStep on FOUNDRY_WORKFLOW |
| MODIFY | `domains/foundry/package.json` | Add `@de-braighter/charter-runtime` dep |
| MODIFY | `domains/foundry/src/instances/foundry-workflow.ts` | Add `meta.charter` to all 6 FOUNDRY_WORKFLOW cascade nodes |
| MODIFY | `domains/foundry/src/mcp/tools.ts` | Add `useCharter?: boolean` flag to `foundry_conduct_workflow` |
| CREATE | `layers/specs/adr/adr-287-s3-foundry-migration.md` | ADR-287 |

---

### Task 1: Add charter-runtime dependency

**Files:**
- Modify: `domains/foundry/package.json`

**Interfaces:**
- Produces: `@de-braighter/charter-runtime` importable from `domains/foundry` source

- [ ] **Step 1: Build charter-runtime**

```bash
cd layers/charter-runtime && npm run build
```

Expected: `dist/index.js` and `dist/index.d.ts` created with no errors.

- [ ] **Step 2: Add the dep to foundry's package.json**

In `domains/foundry/package.json`, add to `"dependencies"`:

```json
"@de-braighter/charter-runtime": "file:../../layers/charter-runtime",
```

The full `dependencies` block becomes:

```json
"dependencies": {
  "@de-braighter/charter-runtime": "file:../../layers/charter-runtime",
  "@de-braighter/foundry-core": "file:../../layers/foundry-core",
  "@de-braighter/substrate-contracts": "^2.7.0",
  "@de-braighter/substrate-runtime": "^2.7.0",
  "@modelcontextprotocol/sdk": "^1.29.0",
  "@prisma/client": "^5.22.0",
  "zod": "^3.25.76"
},
```

- [ ] **Step 3: Install the new dep**

```bash
cd domains/foundry && npm install
```

Expected: `node_modules/@de-braighter/charter-runtime` symlinked to `layers/charter-runtime`.

- [ ] **Step 4: Verify typecheck still passes**

```bash
cd domains/foundry && npm run typecheck
```

Expected: exits 0, no errors.

- [ ] **Step 5: Commit**

```bash
cd domains/foundry && git add package.json package-lock.json
git commit -m "feat(foundry): add @de-braighter/charter-runtime dep (S3)"
```

---

### Task 2: FileCharterEventLog adapter

**Files:**
- Create: `domains/foundry/src/mcp/charter-event-log.ts`
- Create: `domains/foundry/src/mcp/charter-event-log.spec.ts`

**Interfaces:**
- Consumes: `CharterEvent`, `CharterEventLog` from `@de-braighter/charter-runtime`
- Produces: `FileCharterEventLog` class implementing `CharterEventLog`; constructor takes `filePath: string`

- [ ] **Step 1: Write the failing tests**

Create `domains/foundry/src/mcp/charter-event-log.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { FileCharterEventLog } from './charter-event-log.js';
import type { CharterEvent } from '@de-braighter/charter-runtime';

const TEST_DIR = join(process.cwd(), '.test-charter-log');
const TEST_FILE = join(TEST_DIR, 'charter-events.jsonl');

const TREE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TREE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const NOTE_A: CharterEvent = {
  type: 'charter:NoteRecorded.v1',
  nodeId: 'n1',
  payload: { note: 'hello' },
  occurredAt: '2026-06-29T10:00:00.000Z',
};

const NOTE_B: CharterEvent = {
  type: 'charter:NoteRecorded.v1',
  nodeId: 'n2',
  payload: { note: 'world' },
  occurredAt: '2026-06-29T10:00:01.000Z',
};

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe('FileCharterEventLog', () => {
  it('read returns [] when file does not exist', () => {
    const log = new FileCharterEventLog(TEST_FILE);
    expect(log.read(TREE_A)).toEqual([]);
  });

  it('appended event is returned by read for matching treeRootId', () => {
    const log = new FileCharterEventLog(TEST_FILE);
    log.append(TREE_A, NOTE_A);
    expect(log.read(TREE_A)).toEqual([NOTE_A]);
  });

  it('read filters by treeRootId — events for other trees are excluded', () => {
    const log = new FileCharterEventLog(TEST_FILE);
    log.append(TREE_A, NOTE_A);
    log.append(TREE_B, NOTE_B);
    expect(log.read(TREE_A)).toEqual([NOTE_A]);
    expect(log.read(TREE_B)).toEqual([NOTE_B]);
  });

  it('multiple events for same tree preserved in order', () => {
    const log = new FileCharterEventLog(TEST_FILE);
    log.append(TREE_A, NOTE_A);
    log.append(TREE_A, NOTE_B);
    expect(log.read(TREE_A)).toEqual([NOTE_A, NOTE_B]);
  });

  it('survives reconstruct — events persisted across new instance', () => {
    const log1 = new FileCharterEventLog(TEST_FILE);
    log1.append(TREE_A, NOTE_A);
    const log2 = new FileCharterEventLog(TEST_FILE);
    expect(log2.read(TREE_A)).toEqual([NOTE_A]);
  });
});
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
cd domains/foundry && npm test -- --reporter=verbose charter-event-log
```

Expected: 5 failures — `FileCharterEventLog` not found.

- [ ] **Step 3: Implement FileCharterEventLog**

Create `domains/foundry/src/mcp/charter-event-log.ts`:

```ts
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { CharterEvent, CharterEventLog } from '@de-braighter/charter-runtime';

interface Envelope {
  treeRootId: string;
  event: CharterEvent;
}

export class FileCharterEventLog implements CharterEventLog {
  constructor(private readonly filePath: string) {}

  read(treeRootId: string): readonly CharterEvent[] {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Envelope)
      .filter((env) => env.treeRootId === treeRootId)
      .map((env) => env.event);
  }

  append(treeRootId: string, event: CharterEvent): void {
    const envelope: Envelope = { treeRootId, event };
    appendFileSync(this.filePath, JSON.stringify(envelope) + '\n');
  }
}
```

- [ ] **Step 4: Run tests — verify all 5 pass**

```bash
cd domains/foundry && npm test -- --reporter=verbose charter-event-log
```

Expected: 5 passed.

- [ ] **Step 5: Typecheck**

```bash
cd domains/foundry && npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
cd domains/foundry && git add src/mcp/charter-event-log.ts src/mcp/charter-event-log.spec.ts
git commit -m "feat(foundry): FileCharterEventLog — file-backed CharterEventLog for S3"
```

---

### Task 3: StaticPlanTreeStore adapter

**Files:**
- Create: `domains/foundry/src/mcp/static-plan-tree-store.ts`
- Create: `domains/foundry/src/mcp/static-plan-tree-store.spec.ts`

**Interfaces:**
- Consumes: `PlanTree`, `PlanTreeEdit`, `PlanTreeStore` from `@de-braighter/substrate-contracts/plan-tree`
- Produces: `StaticPlanTreeStore` class; constructor takes `trees: PlanTree[]`

- [ ] **Step 1: Write the failing tests**

Create `domains/foundry/src/mcp/static-plan-tree-store.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { StaticPlanTreeStore } from './static-plan-tree-store.js';
import type { PlanTree } from '@de-braighter/substrate-contracts/plan-tree';

const TREE_A: PlanTree = {
  treeRootId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  tenantPackId: 'f0d40000-0000-5000-8000-0000000000f1',
  nodes: [],
};

const TREE_B: PlanTree = {
  treeRootId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  tenantPackId: 'f0d40000-0000-5000-8000-0000000000f1',
  nodes: [],
};

describe('StaticPlanTreeStore', () => {
  it('load returns tree for matching treeRootId', async () => {
    const store = new StaticPlanTreeStore([TREE_A]);
    expect(await store.load(TREE_A.treeRootId)).toEqual(TREE_A);
  });

  it('load returns null for unknown treeRootId', async () => {
    const store = new StaticPlanTreeStore([TREE_A]);
    expect(await store.load('unknown-id')).toBeNull();
  });

  it('load finds correct tree when multiple trees present', async () => {
    const store = new StaticPlanTreeStore([TREE_A, TREE_B]);
    expect(await store.load(TREE_B.treeRootId)).toEqual(TREE_B);
  });

  it('save is a no-op and resolves without error', async () => {
    const store = new StaticPlanTreeStore([TREE_A]);
    await expect(store.save(TREE_A)).resolves.toBeUndefined();
    // tree unchanged after save
    expect(await store.load(TREE_A.treeRootId)).toEqual(TREE_A);
  });

  it('applyEdit throws with clear message', async () => {
    const store = new StaticPlanTreeStore([TREE_A]);
    await expect(
      store.applyEdit(TREE_A.treeRootId, {} as never),
    ).rejects.toThrow('StaticPlanTreeStore does not support applyEdit');
  });
});
```

- [ ] **Step 2: Run tests — verify they all fail**

```bash
cd domains/foundry && npm test -- --reporter=verbose static-plan-tree-store
```

Expected: 5 failures — `StaticPlanTreeStore` not found.

- [ ] **Step 3: Implement StaticPlanTreeStore**

Create `domains/foundry/src/mcp/static-plan-tree-store.ts`:

```ts
import type { PlanTree, PlanTreeEdit, PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';

export class StaticPlanTreeStore implements PlanTreeStore {
  private readonly index: Map<string, PlanTree>;

  constructor(trees: PlanTree[]) {
    this.index = new Map(trees.map((t) => [t.treeRootId, t]));
  }

  async load(treeRootId: string): Promise<PlanTree | null> {
    return this.index.get(treeRootId) ?? null;
  }

  async save(_tree: PlanTree): Promise<void> {
    // no-op: spec is the source of truth, not this store
  }

  async applyEdit(_treeRootId: string, _edit: PlanTreeEdit): Promise<PlanTree> {
    throw new Error('StaticPlanTreeStore does not support applyEdit');
  }
}
```

- [ ] **Step 4: Run tests — verify all 5 pass**

```bash
cd domains/foundry && npm test -- --reporter=verbose static-plan-tree-store
```

Expected: 5 passed.

- [ ] **Step 5: Typecheck**

```bash
cd domains/foundry && npm run typecheck
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
cd domains/foundry && git add src/mcp/static-plan-tree-store.ts src/mcp/static-plan-tree-store.spec.ts
git commit -m "feat(foundry): StaticPlanTreeStore — in-memory PlanTreeStore for S3 charter path"
```

---

### Task 4: Charter-decorate FOUNDRY_WORKFLOW + round-trip integration test

**Files:**
- Create: `domains/foundry/src/instances/foundry-workflow-charter.spec.ts`
- Modify: `domains/foundry/src/instances/foundry-workflow.ts`

**Interfaces:**
- Consumes: `extract`, `compile`, `generate`, `conductCharterStep`, `InMemoryCharterEventLog` from `@de-braighter/charter-runtime`; `buildCascadeTree` + `FOUNDRY_WORKFLOW` from the foundry; `StaticPlanTreeStore` from Task 3; `FOUNDRY_TENANT_PACK_ID` from `../scope.js`
- Produces: `FOUNDRY_WORKFLOW` cascade nodes with valid `metadata.charter` on all 6 nodes; integration test suite (5 assertions)

- [ ] **Step 1: Write the failing integration test**

Create `domains/foundry/src/instances/foundry-workflow-charter.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  extract, compile, generate, conductCharterStep,
  InMemoryCharterEventLog, type CharterDeps,
} from '@de-braighter/charter-runtime';
import { buildCascadeTree } from '../plan/cascade.js';
import { FOUNDRY_WORKFLOW } from './foundry-workflow.js';
import { StaticPlanTreeStore } from '../mcp/static-plan-tree-store.js';
import { FOUNDRY_TENANT_PACK_ID } from '../scope.js';

let tick = 0;

function makeDeps(log: InMemoryCharterEventLog, store: StaticPlanTreeStore): CharterDeps {
  return {
    eventLog: log,
    planTreeStore: store,
    tenantPackId: FOUNDRY_TENANT_PACK_ID,
    now: () => new Date(Date.UTC(2026, 5, 29, 10, 0, ++tick)).toISOString(),
    newId: () => `fw-charter-id-${++tick}`,
  };
}

describe('FOUNDRY_WORKFLOW charter round-trip (S3 dogfood)', () => {
  it('1. extract yields 6 charter nodes — all FOUNDRY_WORKFLOW stages are decorated', () => {
    const tree = buildCascadeTree(FOUNDRY_WORKFLOW);
    const bp = extract(tree, 'fw-bp-test-1', { createdAt: '2026-06-29T10:00:00.000Z' });
    expect(bp.nodes).toHaveLength(6);
    expect(bp.nodes.map((n) => n.role)).toContain('product');
    expect(bp.nodes.map((n) => n.role)).toContain('gate');
    expect(bp.nodes.filter((n) => n.role === 'task')).toHaveLength(4);
  });

  it('2. compile passes clean — scope inheritance valid across all 6 nodes', () => {
    const tree = buildCascadeTree(FOUNDRY_WORKFLOW);
    const bp = extract(tree, 'fw-bp-test-2', { createdAt: '2026-06-29T10:00:00.000Z' });
    expect(compile(bp)).toEqual({ ok: true });
  });

  it('3. generate produces a 6-node PlanTree with no ID overlap with the source tree', () => {
    const tree = buildCascadeTree(FOUNDRY_WORKFLOW);
    const bp = extract(tree, 'fw-bp-test-3', { createdAt: '2026-06-29T10:00:00.000Z' });
    let genId = 0;
    const generated = generate(bp, {
      newId: () => `fw-gen-${++genId}`,
      tenantPackId: FOUNDRY_TENANT_PACK_ID,
    });
    expect(generated.nodes).toHaveLength(6);
    const sourceIds = new Set(tree.nodes.map((n) => n.id));
    expect(generated.nodes.every((n) => !sourceIds.has(n.id))).toBe(true);
  });

  it('4. conductCharterStep first call claims stage-intake', async () => {
    tick = 100;
    const tree = buildCascadeTree(FOUNDRY_WORKFLOW);
    const log = new InMemoryCharterEventLog();
    const store = new StaticPlanTreeStore([tree]);
    const deps = makeDeps(log, store);

    const result = await conductCharterStep(deps, tree.treeRootId);

    expect(result.status).toBe('advanced');
    expect(result.nodeId).toBeDefined();
    const claimed = log.read(tree.treeRootId).filter((e) => e.type === 'charter:NodeClaimed.v1');
    expect(claimed).toHaveLength(1);
  });

  it('5. conductCharterStep second call claims a different frontier stage', async () => {
    tick = 200;
    const tree = buildCascadeTree(FOUNDRY_WORKFLOW);
    const log = new InMemoryCharterEventLog();
    const store = new StaticPlanTreeStore([tree]);
    const deps = makeDeps(log, store);

    const r1 = await conductCharterStep(deps, tree.treeRootId);
    expect(r1.status).toBe('advanced');

    const r2 = await conductCharterStep(deps, tree.treeRootId);
    expect(r2.status).toBe('advanced');
    expect(r2.nodeId).not.toBe(r1.nodeId);

    const claimed = log.read(tree.treeRootId).filter((e) => e.type === 'charter:NodeClaimed.v1');
    expect(claimed).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run tests — verify all 5 fail**

```bash
cd domains/foundry && npm test -- --reporter=verbose foundry-workflow-charter
```

Expected: 5 failures (tests 1–2 fail because `extract` returns 0 nodes — no `metadata.charter` yet; tests 3–5 follow from that). Confirm the error is `expect(received).toHaveLength(6)` with received = 0.

- [ ] **Step 3: Add charter contracts to FOUNDRY_WORKFLOW**

Open `domains/foundry/src/instances/foundry-workflow.ts`. Add `meta.charter` to all 6 nodes. The `charter` object is a plain `Record<string, unknown>` at authoring time — validated at runtime by `readCharter()` via Zod. No import of charter-runtime needed in this file.

Replace the `FOUNDRY_WORKFLOW` export with the following (only the `meta` objects change; all other fields stay identical):

```ts
export const FOUNDRY_WORKFLOW: CascadeNodeSpec[] = [
  {
    key: 'foundry-workflow',
    kind: 'product',
    parent: null,
    meta: {
      productKey: 'foundry',
      title: 'Foundry pipeline (workflow)',
      charter: {
        role: 'product',
        mission: {
          objective: 'Run the foundry SDLC pipeline end-to-end',
          outcome: 'Products are built, reviewed, and shipped to the cluster',
        },
        scope: { allowedPathPrefixes: ['de-braighter'] },
      },
    },
  },
  {
    key: 'stage-intake',
    kind: 'stage',
    parent: 'foundry-workflow',
    meta: {
      title: 'Intake — capture founder inputs',
      dependsOn: [],
      charter: {
        role: 'task',
        mission: {
          objective: 'Capture founder inputs',
          outcome: 'Founder inputs recorded in workbench',
        },
        scope: { allowedPathPrefixes: ['de-braighter/workbench'] },
      },
    },
  },
  {
    key: 'stage-gate-greenlight',
    kind: 'stage',
    parent: 'foundry-workflow',
    meta: {
      title: 'Greenlight gate — prioritise the product',
      dependsOn: ['stage-intake'],
      founderGated: true,
      action: 'reprioritize-product',
      actionArgs: { productKey: 'foundry', priority: 500 },
      charter: {
        role: 'gate',
        mission: {
          objective: 'Greenlight gate — prioritise the product',
          outcome: 'Product prioritised by founder decision',
        },
        scope: { allowedPathPrefixes: ['de-braighter/workbench'] },
      },
    },
    effects: [{
      declarationId: uuidv5('effect:foundry-workflow-greenlight-cycle-time'),
      indicatorId: 'cycle-time',
      direction: '-',
      magnitudePrior: { kind: 'normal', mean: -2, sd: 1 },
      confidence: 0.5,
      horizon: 'P0D',
      compositionOperator: 'sum',
      commutative: true,
      basis: 'expert',
      declaredAt: '2026-06-18T00:00:00.000Z',
    }],
  },
  {
    key: 'stage-build-path',
    kind: 'stage',
    parent: 'foundry-workflow',
    meta: {
      title: 'Build path — spawn the product tree from a blueprint',
      dependsOn: ['stage-gate-greenlight'],
      action: 'build-path',
      actionArgs: { blueprint: SAMPLE_BLUEPRINT, newKey: SAMPLE_TARGET_KEY },
      charter: {
        role: 'task',
        mission: {
          objective: 'Build path — spawn the product tree from a blueprint',
          outcome: 'Product tree instantiated in foundry log',
        },
        scope: { allowedPathPrefixes: ['de-braighter/foundry'] },
      },
    },
  },
  {
    key: 'stage-conduct',
    kind: 'stage',
    parent: 'foundry-workflow',
    meta: {
      title: 'Conduct — autonomous build loop',
      dependsOn: ['stage-build-path'],
      charter: {
        role: 'task',
        mission: {
          objective: 'Conduct — autonomous build loop',
          outcome: 'Product items built and merged',
        },
        scope: { allowedPathPrefixes: ['de-braighter/foundry'] },
      },
    },
  },
  {
    key: 'stage-ship',
    kind: 'stage',
    parent: 'foundry-workflow',
    meta: {
      title: 'Ship — release the product',
      dependsOn: ['stage-conduct'],
      charter: {
        role: 'task',
        mission: {
          objective: 'Ship — release the product',
          outcome: 'Product released to the cluster',
        },
        scope: { allowedPathPrefixes: ['de-braighter'] },
      },
    },
  },
];
```

- [ ] **Step 4: Run tests — verify all 5 pass**

```bash
cd domains/foundry && npm test -- --reporter=verbose foundry-workflow-charter
```

Expected: 5 passed.

- [ ] **Step 5: Run full foundry suite to catch regressions**

```bash
cd domains/foundry && npm test
```

Expected: all existing tests still pass (the charter fields are additive to `meta` — no existing code reads them).

- [ ] **Step 6: Typecheck**

```bash
cd domains/foundry && npm run typecheck
```

Expected: exits 0.

- [ ] **Step 7: Commit**

```bash
cd domains/foundry && git add src/instances/foundry-workflow.ts src/instances/foundry-workflow-charter.spec.ts
git commit -m "feat(foundry): charter-decorate FOUNDRY_WORKFLOW + round-trip integration test (S3)"
```

---

### Task 5: Wire useCharter flag in foundry_conduct_workflow

**Files:**
- Modify: `domains/foundry/src/mcp/tools.ts`

**Interfaces:**
- Consumes: `FileCharterEventLog` (Task 2), `StaticPlanTreeStore` (Task 3), `conductCharterStep` + `CharterDeps` from `@de-braighter/charter-runtime`, `FOUNDRY_WORKFLOW` + `buildCascadeTree` already in scope, `FOUNDRY_TENANT_PACK_ID` from `../scope.js`, `randomUUID` from `node:crypto`
- Produces: `foundry_conduct_workflow` accepts `useCharter?: boolean`; when true, returns a `ConductResult` from the charter runtime

- [ ] **Step 1: Add imports to tools.ts**

At the top of `domains/foundry/src/mcp/tools.ts`, add these imports alongside the existing ones:

```ts
import { randomUUID } from 'node:crypto';
import { conductCharterStep, type CharterDeps } from '@de-braighter/charter-runtime';
import { join } from 'node:path';
import { FOUNDRY_WORKFLOW } from '../instances/foundry-workflow.js';
import { FileCharterEventLog } from './charter-event-log.js';
import { StaticPlanTreeStore } from './static-plan-tree-store.js';
import { FOUNDRY_TENANT_PACK_ID } from '../scope.js';
```

Note: `join` from `node:path` and `FOUNDRY_WORKFLOW`/`buildCascadeTree` may already be imported — check existing imports and add only what is missing. `buildCascadeTree` is already imported: `import { buildCascadeTree } from '../plan/cascade.js';`

- [ ] **Step 2: Extend the foundry_conduct_workflow handler**

Find the existing handler in `makeTools`:

```ts
foundry_conduct_workflow: guard((a: { instance?: string; authorizeStage?: string }) => {
```

Replace with:

```ts
foundry_conduct_workflow: guard(async (a: { instance?: string; authorizeStage?: string; useCharter?: boolean }) => {
  if (a.useCharter === true) {
    const charterTree = buildCascadeTree(FOUNDRY_WORKFLOW);
    const eventLog = new FileCharterEventLog(join(deps.dataDir, 'charter-events.jsonl'));
    const planTreeStore = new StaticPlanTreeStore([charterTree]);
    const charterDeps: CharterDeps = {
      eventLog,
      planTreeStore,
      tenantPackId: FOUNDRY_TENANT_PACK_ID,
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
    };
    return conductCharterStep(charterDeps, charterTree.treeRootId);
  }
  const instance = a.instance ?? WORKFLOW_PRODUCT_KEY;
  const authorized = a.authorizeStage != null
    ? authorizeWorkflowStage(deps, a.authorizeStage, instance)
    : undefined;
  const step = conductWorkflowStep(deps, instance);
  return { ...(authorized != null ? { authorized: authorized.stage } : {}), step };
}),
```

Note: the handler changes from a sync arrow to `async` — this is required because `conductCharterStep` returns a `Promise`. The `guard` wrapper already uses `await fn(...)` so this is safe.

- [ ] **Step 3: Typecheck**

```bash
cd domains/foundry && npm run typecheck
```

Expected: exits 0. If `join` was already imported, TypeScript will flag a duplicate — remove the duplicate import.

- [ ] **Step 4: Run full test suite**

```bash
cd domains/foundry && npm test
```

Expected: all tests pass (the new branch is not exercised by existing tests; the charter round-trip test from Task 4 still passes).

- [ ] **Step 5: Smoke-test the useCharter path manually**

Start the foundry MCP server in a terminal:
```bash
cd domains/foundry && npm run mcp
```

In a second terminal, send a test call (requires an MCP client or `@modelcontextprotocol/sdk` inspector):
```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"foundry_conduct_workflow","arguments":{"useCharter":true}}}' | node -e "
const {createInterface} = require('readline');
process.stdin.pipe(process.stdout);
"
```

Expected: a JSON response with `"status":"advanced"` and a `nodeId`. A `charter-events.jsonl` file appears in the foundry's data directory (default: `domains/foundry/data/charter-events.jsonl`).

If you cannot run the MCP server (missing MCP client), skip Step 5 — the integration test in Task 4 covers the same code path through `InMemoryCharterEventLog` + `StaticPlanTreeStore`.

- [ ] **Step 6: Commit**

```bash
cd domains/foundry && git add src/mcp/tools.ts
git commit -m "feat(foundry): useCharter flag on foundry_conduct_workflow — S3 live charter path"
```

---

### Task 6: Author ADR-287

**Files:**
- Create: `layers/specs/adr/adr-287-s3-foundry-migration.md`

**Interfaces:**
- Produces: ADR-287 in `proposed` status; to be ratified on PR merge

- [ ] **Step 1: Create the ADR file**

Create `layers/specs/adr/adr-287-s3-foundry-migration.md`:

```markdown
---
id: ADR-287
title: S3 Foundry Migration — Charter Runtime Dogfood
status: proposed
date: 2026-06-29
tags: [charter-runtime, foundry, dogfood, s3]
tier: architectural
scope: cross-layer
relates-to: [ADR-285, ADR-286, ADR-176, ADR-263]
---

## Context

S1 (ADR-285) shipped the charter lifecycle runtime. S2 (ADR-286) shipped the blueprint engine. The kill-criterion for the charter layer is "does it work beyond a toy?" — proven only when a real, non-toy tree with real governance semantics runs through `extract → compile → generate → conductCharterStep`.

The foundry's `FOUNDRY_WORKFLOW` — 6 nodes (product root + 5 stage nodes: intake, gate-greenlight, build-path, conduct, ship) — is the dogfood subject. The existing `@de-braighter/substrate-contracts` skew (@^0.10 → @2.7) was already resolved in foundry Phase 7.

## Decision

**D1 — Production decoration.** All 6 `FOUNDRY_WORKFLOW` cascade nodes gain `metadata.charter` (role + mission + scope) directly in the cascade spec. No import of `@de-braighter/charter-runtime` is needed in `foundry-workflow.ts` — the contract is a plain object literal; `readCharter()` validates at runtime via Zod.

**D2 — State split.** The workflow tree is deterministic (`buildCascadeTree(FOUNDRY_WORKFLOW)` always produces the same PlanTree); only charter lifecycle events are stateful. Therefore: tree = `StaticPlanTreeStore` (in-memory, reconstructed per call); events = `FileCharterEventLog` (`charter-events.jsonl` in the foundry data dir). This is correct, not a compromise.

**D3 — `useCharter` seam.** `foundry_conduct_workflow` gains `useCharter?: boolean`. When true, routes through `conductCharterStep`. The existing `conductWorkflowStep` path is untouched — zero regression to 21 live products.

**D4 — No Postgres for charter trees in S3.** The `StaticPlanTreeStore` is the correct persistence tier for a deterministic tree. Postgres persistence of charter trees (via `PrismaPlanTreeStore`) is deferred to S4/S5 where the studio deploys charter trees to the kernel.

## Role mapping

| Cascade node | Charter role | Scope |
|---|---|---|
| `foundry-workflow` | `product` | `['de-braighter']` |
| `stage-intake` | `task` | `['de-braighter/workbench']` |
| `stage-gate-greenlight` | `gate` | `['de-braighter/workbench']` |
| `stage-build-path` | `task` | `['de-braighter/foundry']` |
| `stage-conduct` | `task` | `['de-braighter/foundry']` |
| `stage-ship` | `task` | `['de-braighter']` |

All child prefixes satisfy `isCoveredBy` against the root's `['de-braighter']`.

## Consequences

- **`domains/foundry`** gains `@de-braighter/charter-runtime` as a direct dependency.
- **Charter frontier is parallel** in S3: `_dependsOn` pipeline ordering is NOT bridged (the cascade `meta.dependsOn` key is different from `metadata._dependsOn` that `charterFrontier` reads). All 5 stage nodes surface as claimable simultaneously. Ordering via `_dependsOn` is S5.
- **Acid 9** (charter vocab boundary scan) continues to enforce Kernel-Untouched Invariant; no new acid needed in `layers/charter-runtime` — Acids 1–10 already pass.
- The dogfood integration test in `domains/foundry/src/instances/foundry-workflow-charter.spec.ts` proves the kill-criterion: 6-node FOUNDRY_WORKFLOW survives `extract → compile → generate → conductCharterStep` end-to-end.

## Deferred

| Concern | When |
|---|---|
| `_dependsOn` pipeline ordering in charter frontier | S5 |
| Postgres persistence of charter trees | S4/S5 |
| foundry-core charter skin (`gen_generate kind=charter`) | S5+ |
| Studio deploys charter trees to kernel | S5 |
| Second pack on the runtime (reuse proof) | S6 |
```

- [ ] **Step 2: Verify the ADR number is correct**

```bash
ls layers/specs/adr/ | grep adr-28 | sort
```

Expected: `adr-285-*.md`, `adr-286-*.md` present; `adr-287-*.md` should be the new file only.

- [ ] **Step 3: Run the specs markdownlint gate**

```bash
cd layers/specs && npm run lint:md 2>/dev/null || npx markdownlint-cli2 "adr/adr-287-*.md"
```

Expected: exits 0 (or no errors on the new file).

- [ ] **Step 4: Commit**

```bash
cd layers/specs && git add adr/adr-287-s3-foundry-migration.md
git commit -m "docs(adr): ADR-287 S3 foundry migration — charter runtime dogfood"
```

---

## Self-review checklist (run before declaring done)

- [ ] `cd domains/foundry && npm test` — all tests pass (including the 5 new round-trip assertions)
- [ ] `cd domains/foundry && npm run typecheck` — exits 0
- [ ] `cd layers/charter-runtime && npm test` — Acids 1–10 still pass; no charter-runtime changes needed
- [ ] `git diff layers/substrate` — zero diff (Kernel-Untouched confirmed)
- [ ] `charter-events.jsonl` is listed in `domains/foundry/.gitignore` or `data/` is already gitignored
