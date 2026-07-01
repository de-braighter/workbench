# S2 — Charter Blueprint Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `extract`, `compile`, `generate`, and a `BlueprintStore` port to `layers/charter-runtime` so that a charter tree can be snapshotted, validated, and re-instantiated as a fresh PlanTree skeleton.

**Architecture:** Pure-function approach — `extract`/`compile`/`generate` are synchronous, stateless functions; `BlueprintStore` is a port+in-memory adapter following the same pattern as `CharterEventLog`. All code is additive to existing S0/S1 files; the kernel is untouched.

**Tech Stack:** TypeScript ESM, Zod (already in deps), Vitest, `@de-braighter/substrate-contracts` (PlanNode/PlanTree types), `@de-braighter/substrate-runtime` (PrismaPlanTreeStore + FakePlanTreePrisma for tests).

## Global Constraints

- Branch: `feat/s2-blueprint-engine` on `de-braighter/charter-runtime`
- All imports use `.js` extensions (ESM, TypeScript resolves `.ts` at build; `.js` at runtime)
- `PlanNode` fields: `id, parentId, treeRootId, kind, kindRef, ordinal, metadata, childrenIds`
- `PlanTree` fields: `treeRootId, tenantPackId, nodes`
- Test command (from `layers/charter-runtime/`): `pnpm test` (runs `vitest run`)
- Single-file test command: `pnpm vitest run src/<file>.spec.ts`
- Typecheck: `pnpm run typecheck`
- `CharterContract` shape: `{ role: CharterRole; mission: { objective: string; outcome: string }; scope: { allowedPathPrefixes: readonly string[] } }`
- Kernel-Untouched Invariant: zero diff to `layers/substrate` production files — Acid 9 must stay green
- `validateInheritance(parent, child)` returns `{ ok: true } | { ok: false; violation: { reason: string } }`
- Test fixtures are in `src/testing/fixtures.ts`: `productTaskCharterTree()`, `decomposableProductTree()`, `PRODUCT_ID`, `TASK_ID`, `PRODUCT_ROOT_ID`, `TENANT_PACK_ID`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/blueprint.ts` | **Create** | `CharterBlueprint` / `CharterBlueprintNode` types; `extract`, `compile`, `generate` functions; `CompileResult`, `CompileError` types |
| `src/blueprint.spec.ts` | **Create** | Unit tests: extract (3), compile (9), generate (4) |
| `src/blueprint-store.port.ts` | **Create** | `BlueprintStore` port interface + `InMemoryBlueprintStore` class |
| `src/blueprint-store.port.spec.ts` | **Create** | Port contract tests (3) |
| `src/acids.spec.ts` | **Modify** | Add Acid 10: extract→compile→generate→conductCharterStep round-trip; add `CharterBlueprint`/`InMemoryBlueprintStore` to forbidden list |
| `src/index.ts` | **Modify** | Append S2 export block |

---

## Task 1: Types + `extract` function

**Files:**
- Create: `src/blueprint.ts`
- Create: `src/blueprint.spec.ts`

**Interfaces:**
- Produces: `CharterBlueprint`, `CharterBlueprintNode`, `extract(tree, blueprintId, opts?) → CharterBlueprint` — consumed by Tasks 2, 3, 4, 5

---

- [ ] **Step 1.1: Create the branch**

```bash
# In D:/development/projects/de-braighter/layers/charter-runtime
git checkout -b feat/s2-blueprint-engine
```

Expected: `Switched to a new branch 'feat/s2-blueprint-engine'`

---

- [ ] **Step 1.2: Write the failing tests for `extract`**

Create `src/blueprint.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import { writeCharter, readCharter, type CharterContract } from './charter-node.js';
import { extract } from './blueprint.js';
import {
  productTaskCharterTree, PRODUCT_ID, TASK_ID, TENANT_PACK_ID,
} from './testing/fixtures.js';

// ─── extract tests ────────────────────────────────────────────────────────────

describe('extract', () => {
  it('skips non-charter nodes', () => {
    const tree = productTaskCharterTree();
    // Add a bare node with no charter metadata
    const nonCharter: PlanNode = {
      id: 'bare-node', parentId: PRODUCT_ID, treeRootId: PRODUCT_ID,
      kind: 'scaffold', kindRef: 'scaffold', ordinal: 99,
      metadata: {}, childrenIds: [],
    };
    const mixedTree = { ...tree, nodes: [...tree.nodes, nonCharter] };

    const bp = extract(mixedTree, 'bp-1', { createdAt: '2026-06-29T10:00:00.000Z' });

    expect(bp.nodes).toHaveLength(2); // product + task, not the bare node
    expect(bp.nodes.every(n => n.id !== 'bare-node')).toBe(true);
  });

  it('preserves node structure faithfully', () => {
    const tree = productTaskCharterTree();
    const bp = extract(tree, 'bp-test', { name: 'my-blueprint', createdAt: '2026-06-29T10:00:00.000Z' });

    expect(bp.id).toBe('bp-test');
    expect(bp.name).toBe('my-blueprint');
    expect(bp.sourceTreeRootId).toBe(PRODUCT_ID);
    expect(bp.createdAt).toBe('2026-06-29T10:00:00.000Z');

    const productNode = bp.nodes.find(n => n.id === PRODUCT_ID)!;
    expect(productNode).toBeDefined();
    expect(productNode.parentId).toBeNull();
    expect(productNode.role).toBe('product');
    expect(productNode.ordinal).toBe(0);

    const taskNode = bp.nodes.find(n => n.id === TASK_ID)!;
    expect(taskNode).toBeDefined();
    expect(taskNode.parentId).toBe(PRODUCT_ID);
    expect(taskNode.role).toBe('task');
  });

  it('uses mission.objective as default label', () => {
    const tree = productTaskCharterTree();
    const bp = extract(tree, 'bp-label', { createdAt: '2026-06-29T10:00:00.000Z' });

    const productNode = bp.nodes.find(n => n.id === PRODUCT_ID)!;
    expect(productNode.label).toBe('Build the charter runtime');

    const taskNode = bp.nodes.find(n => n.id === TASK_ID)!;
    expect(taskNode.label).toBe('Implement the lens');
  });
});
```

---

- [ ] **Step 1.3: Run tests — verify they fail**

```bash
pnpm vitest run src/blueprint.spec.ts
```

Expected: errors like `Cannot find module './blueprint.js'`

---

- [ ] **Step 1.4: Create `src/blueprint.ts` with types and `extract`**

```ts
// src/blueprint.ts
import type { PlanNode, PlanTree } from '@de-braighter/substrate-contracts/plan-tree';
import type { CharterContract, CharterRole } from './charter-node.js';
import { readCharter, writeCharter } from './charter-node.js';
import { validateInheritance } from './inheritance.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CharterBlueprintNode {
  /** Source PlanNode.id (UUID) — stable reference key within this blueprint. */
  id: string;
  /** null = root node. */
  parentId: string | null;
  role: CharterRole;
  contract: CharterContract;
  /** Sibling ordering preserved from source tree. */
  ordinal: number;
  /** IDs of other nodes within this blueprint (from _dependsOn metadata). */
  dependsOn: string[];
  /** Optional human display name — defaults to contract.mission.objective. */
  label?: string;
}

export interface CharterBlueprint {
  /** Caller-supplied UUID. */
  id: string;
  name?: string;
  /** Set when extracted from a live tree; informational only. */
  sourceTreeRootId?: string;
  createdAt: string;
  nodes: CharterBlueprintNode[];
}

// ─── extract ─────────────────────────────────────────────────────────────────

/**
 * Walk a live PlanTree and emit a CharterBlueprint.
 * Non-charter nodes (readCharter === null) are silently skipped.
 * blueprintId is caller-supplied — generate it with newId() at the call site.
 * createdAt defaults to new Date().toISOString() (acceptable outside a fold).
 */
export function extract(
  tree: PlanTree,
  blueprintId: string,
  opts?: { name?: string; createdAt?: string },
): CharterBlueprint {
  const nodes: CharterBlueprintNode[] = [];

  for (const node of tree.nodes) {
    const charter = readCharter(node);
    if (charter === null) continue;

    const dependsOn = (node.metadata['_dependsOn'] as string[] | undefined) ?? [];

    nodes.push({
      id: node.id,
      parentId: node.parentId,
      role: charter.role,
      contract: charter,
      ordinal: node.ordinal,
      dependsOn,
      label: charter.mission.objective,
    });
  }

  return {
    id: blueprintId,
    name: opts?.name,
    sourceTreeRootId: tree.treeRootId,
    createdAt: opts?.createdAt ?? new Date().toISOString(),
    nodes,
  };
}

// ─── compile (added in Task 2) ───────────────────────────────────────────────
// ─── generate (added in Task 3) ──────────────────────────────────────────────
```

---

- [ ] **Step 1.5: Run tests — verify they pass**

```bash
pnpm vitest run src/blueprint.spec.ts
```

Expected: `3 passed`

---

- [ ] **Step 1.6: Typecheck**

```bash
pnpm run typecheck
```

Expected: no errors

---

- [ ] **Step 1.7: Commit**

```bash
git add src/blueprint.ts src/blueprint.spec.ts
git commit -m "feat(s2): CharterBlueprint types + extract function"
```

---

## Task 2: `compile` function

**Files:**
- Modify: `src/blueprint.ts` (append compile + error types)
- Modify: `src/blueprint.spec.ts` (append compile tests)

**Interfaces:**
- Consumes: `CharterBlueprint`, `CharterBlueprintNode` from Task 1; `validateInheritance` from `inheritance.ts`
- Produces: `compile(bp) → CompileResult`, `CompileError`, `CompileResult` — consumed by Task 5 (acid)

---

- [ ] **Step 2.1: Append compile tests to `src/blueprint.spec.ts`**

Add after the existing `extract` describe block:

```ts
// ─── compile tests ────────────────────────────────────────────────────────────

describe('compile', () => {
  const PARENT_CONTRACT: CharterContract = {
    role: 'product',
    mission: { objective: 'Build it', outcome: 'Built' },
    scope: { allowedPathPrefixes: ['src/'] },
  };
  const CHILD_CONTRACT: CharterContract = {
    role: 'task',
    mission: { objective: 'Do it', outcome: 'Done' },
    scope: { allowedPathPrefixes: ['src/charter/'] }, // valid narrow
  };

  function makeNode(
    id: string,
    parentId: string | null,
    contract: CharterContract,
    opts: { dependsOn?: string[]; ordinal?: number } = {},
  ) {
    return {
      id, parentId, role: contract.role, contract,
      ordinal: opts.ordinal ?? 0,
      dependsOn: opts.dependsOn ?? [],
    };
  }

  it('valid 2-node blueprint compiles clean', () => {
    const { compile } = await import('./blueprint.js');
    const bp = {
      id: 'bp', createdAt: '2026-06-29T10:00:00.000Z',
      nodes: [makeNode('root', null, PARENT_CONTRACT), makeNode('child', 'root', CHILD_CONTRACT)],
    };
    expect(compile(bp)).toEqual({ ok: true });
  });

  it('no-root error when all nodes have a parentId', () => {
    const { compile } = await import('./blueprint.js');
    const bp = {
      id: 'bp', createdAt: '2026-06-29T10:00:00.000Z',
      nodes: [makeNode('a', 'b', CHILD_CONTRACT), makeNode('b', 'a', CHILD_CONTRACT)],
    };
    const result = compile(bp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(e => e.kind === 'no-root')).toBe(true);
  });

  it('multiple-roots error when two nodes have parentId null', () => {
    const { compile } = await import('./blueprint.js');
    const bp = {
      id: 'bp', createdAt: '2026-06-29T10:00:00.000Z',
      nodes: [makeNode('r1', null, PARENT_CONTRACT), makeNode('r2', null, PARENT_CONTRACT)],
    };
    const result = compile(bp);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(e => e.kind === 'multiple-roots');
      expect(err).toBeDefined();
      if (err?.kind === 'multiple-roots') expect(err.nodeIds).toHaveLength(2);
    }
  });

  it('orphan-parent when parentId references missing node', () => {
    const { compile } = await import('./blueprint.js');
    const bp = {
      id: 'bp', createdAt: '2026-06-29T10:00:00.000Z',
      nodes: [makeNode('root', null, PARENT_CONTRACT), makeNode('child', 'ghost', CHILD_CONTRACT)],
    };
    const result = compile(bp);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(e => e.kind === 'orphan-parent');
      expect(err).toBeDefined();
      if (err?.kind === 'orphan-parent') {
        expect(err.nodeId).toBe('child');
        expect(err.missingParentId).toBe('ghost');
      }
    }
  });

  it('orphan-dependency when dependsOn references missing node', () => {
    const { compile } = await import('./blueprint.js');
    const bp = {
      id: 'bp', createdAt: '2026-06-29T10:00:00.000Z',
      nodes: [
        makeNode('root', null, PARENT_CONTRACT),
        makeNode('child', 'root', CHILD_CONTRACT, { dependsOn: ['ghost-dep'] }),
      ],
    };
    const result = compile(bp);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(e => e.kind === 'orphan-dependency');
      expect(err).toBeDefined();
      if (err?.kind === 'orphan-dependency') {
        expect(err.nodeId).toBe('child');
        expect(err.missingDepId).toBe('ghost-dep');
      }
    }
  });

  it('parent-cycle detected (A → parent B → parent A)', () => {
    const { compile } = await import('./blueprint.js');
    const bp = {
      id: 'bp', createdAt: '2026-06-29T10:00:00.000Z',
      nodes: [makeNode('a', 'b', CHILD_CONTRACT), makeNode('b', 'a', CHILD_CONTRACT)],
    };
    const result = compile(bp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(e => e.kind === 'parent-cycle')).toBe(true);
  });

  it('dependency-cycle detected (A dependsOn B dependsOn A)', () => {
    const { compile } = await import('./blueprint.js');
    const bp = {
      id: 'bp', createdAt: '2026-06-29T10:00:00.000Z',
      nodes: [
        makeNode('root', null, PARENT_CONTRACT),
        makeNode('a', 'root', CHILD_CONTRACT, { dependsOn: ['b'] }),
        makeNode('b', 'root', CHILD_CONTRACT, { dependsOn: ['a'] }),
      ],
    };
    const result = compile(bp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some(e => e.kind === 'dependency-cycle')).toBe(true);
  });

  it('inheritance-violation when child scope is wider than parent', () => {
    const { compile } = await import('./blueprint.js');
    const widenedChild: CharterContract = {
      role: 'task',
      mission: { objective: 'Do it', outcome: 'Done' },
      scope: { allowedPathPrefixes: ['/'] }, // wider than parent's ['src/']
    };
    const bp = {
      id: 'bp', createdAt: '2026-06-29T10:00:00.000Z',
      nodes: [makeNode('root', null, PARENT_CONTRACT), makeNode('child', 'root', widenedChild)],
    };
    const result = compile(bp);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const err = result.errors.find(e => e.kind === 'inheritance-violation');
      expect(err).toBeDefined();
      if (err?.kind === 'inheritance-violation') expect(err.nodeId).toBe('child');
    }
  });

  it('collects all errors in one pass', () => {
    const { compile } = await import('./blueprint.js');
    const widenedChild: CharterContract = {
      role: 'task',
      mission: { objective: 'Do it', outcome: 'Done' },
      scope: { allowedPathPrefixes: ['/'] },
    };
    const bp = {
      id: 'bp', createdAt: '2026-06-29T10:00:00.000Z',
      nodes: [
        makeNode('root', null, PARENT_CONTRACT),
        makeNode('child', 'root', widenedChild),             // inheritance-violation
        makeNode('orphan-child', 'ghost', CHILD_CONTRACT),  // orphan-parent
        makeNode('with-missing-dep', 'root', CHILD_CONTRACT, { dependsOn: ['nonexistent'] }), // orphan-dep
      ],
    };
    const result = compile(bp);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
```

---

- [ ] **Step 2.2: Run tests — verify compile tests fail**

```bash
pnpm vitest run src/blueprint.spec.ts
```

Expected: ~9 failures mentioning `compile is not a function` or similar

---

- [ ] **Step 2.3: Implement `compile` in `src/blueprint.ts`**

Replace the `// ─── compile (added in Task 2)` comment with the full implementation:

```ts
// ─── compile ─────────────────────────────────────────────────────────────────

export type CompileError =
  | { kind: 'no-root' }
  | { kind: 'multiple-roots'; nodeIds: string[] }
  | { kind: 'orphan-parent'; nodeId: string; missingParentId: string }
  | { kind: 'orphan-dependency'; nodeId: string; missingDepId: string }
  | { kind: 'parent-cycle'; nodeIds: string[] }
  | { kind: 'dependency-cycle'; nodeIds: string[] }
  | { kind: 'inheritance-violation'; nodeId: string; reason: string };

export type CompileResult = { ok: true } | { ok: false; errors: CompileError[] };

function detectParentCycles(nodeById: Map<string, CharterBlueprintNode>): CompileError[] {
  const globallyChecked = new Set<string>();
  const errors: CompileError[] = [];
  const reportedCycleKeys = new Set<string>();

  for (const startId of nodeById.keys()) {
    if (globallyChecked.has(startId)) continue;
    const chain: string[] = [];
    const inChain = new Map<string, number>(); // id → index in chain
    let cur: string | null = startId;

    while (cur !== null && !globallyChecked.has(cur)) {
      if (inChain.has(cur)) {
        const cycleStart = inChain.get(cur)!;
        const cycleIds = chain.slice(cycleStart);
        const key = [...cycleIds].sort().join(',');
        if (!reportedCycleKeys.has(key)) {
          reportedCycleKeys.add(key);
          errors.push({ kind: 'parent-cycle', nodeIds: cycleIds });
        }
        break;
      }
      inChain.set(cur, chain.length);
      chain.push(cur);
      cur = nodeById.get(cur)?.parentId ?? null;
    }

    for (const id of chain) globallyChecked.add(id);
  }
  return errors;
}

function detectDependencyCycles(bp: CharterBlueprint): CompileError[] {
  const nodeIds = new Set(bp.nodes.map(n => n.id));

  // remaining[id] = set of valid deps this node still needs satisfied
  const remaining = new Map<string, Set<string>>();
  // satisfies[dep] = list of nodes that depend on dep
  const satisfies = new Map<string, string[]>(bp.nodes.map(n => [n.id, []]));

  for (const node of bp.nodes) {
    const validDeps = node.dependsOn.filter(dep => nodeIds.has(dep));
    remaining.set(node.id, new Set(validDeps));
    for (const dep of validDeps) {
      satisfies.get(dep)!.push(node.id);
    }
  }

  const queue = bp.nodes
    .filter(n => remaining.get(n.id)!.size === 0)
    .map(n => n.id);
  let processed = 0;

  while (queue.length > 0) {
    const cur = queue.shift()!;
    processed++;
    for (const dependent of satisfies.get(cur)!) {
      const deps = remaining.get(dependent)!;
      deps.delete(cur);
      if (deps.size === 0) queue.push(dependent);
    }
  }

  if (processed < bp.nodes.length) {
    const cycleNodes = bp.nodes
      .filter(n => remaining.get(n.id)!.size > 0)
      .map(n => n.id);
    return [{ kind: 'dependency-cycle', nodeIds: cycleNodes }];
  }
  return [];
}

/**
 * Validate a blueprint end-to-end. Collects ALL errors in one pass —
 * no fail-fast — so a design tool sees the complete problem list.
 */
export function compile(bp: CharterBlueprint): CompileResult {
  const errors: CompileError[] = [];
  const nodeById = new Map(bp.nodes.map(n => [n.id, n]));

  // 1. Root check
  const roots = bp.nodes.filter(n => n.parentId === null);
  if (roots.length === 0) {
    errors.push({ kind: 'no-root' });
  } else if (roots.length > 1) {
    errors.push({ kind: 'multiple-roots', nodeIds: roots.map(n => n.id) });
  }

  // 2. Parent ref integrity
  const orphanParentNodes = new Set<string>();
  for (const node of bp.nodes) {
    if (node.parentId !== null && !nodeById.has(node.parentId)) {
      errors.push({ kind: 'orphan-parent', nodeId: node.id, missingParentId: node.parentId });
      orphanParentNodes.add(node.id);
    }
  }

  // 3. Dependency ref integrity
  for (const node of bp.nodes) {
    for (const dep of node.dependsOn) {
      if (!nodeById.has(dep)) {
        errors.push({ kind: 'orphan-dependency', nodeId: node.id, missingDepId: dep });
      }
    }
  }

  // 4. Parent-chain cycle detection
  errors.push(...detectParentCycles(nodeById));

  // 5. Dependency cycle detection
  errors.push(...detectDependencyCycles(bp));

  // 6. Inheritance validation (skip nodes with orphan-parent — avoids misleading double-errors)
  for (const node of bp.nodes) {
    if (node.parentId === null || orphanParentNodes.has(node.id)) continue;
    const parent = nodeById.get(node.parentId);
    if (!parent) continue; // already flagged in step 2
    const verdict = validateInheritance(parent.contract, node.contract);
    if (!verdict.ok) {
      errors.push({ kind: 'inheritance-violation', nodeId: node.id, reason: verdict.violation.reason });
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

---

- [ ] **Step 2.4: Run tests — verify all pass**

```bash
pnpm vitest run src/blueprint.spec.ts
```

Expected: `12 passed` (3 extract + 9 compile)

---

- [ ] **Step 2.5: Typecheck**

```bash
pnpm run typecheck
```

Expected: no errors

---

- [ ] **Step 2.6: Commit**

```bash
git add src/blueprint.ts src/blueprint.spec.ts
git commit -m "feat(s2): compile — collect-all validation (inheritance, cycles, refs)"
```

---

## Task 3: `generate` function

**Files:**
- Modify: `src/blueprint.ts` (append `generate`)
- Modify: `src/blueprint.spec.ts` (append generate tests)

**Interfaces:**
- Consumes: `CharterBlueprint`, `CharterBlueprintNode` from Task 1; `writeCharter` from `charter-node.ts`
- Produces: `generate(bp, opts) → PlanTree` — consumed by Task 5 (acid)

---

- [ ] **Step 3.1: Append generate tests to `src/blueprint.spec.ts`**

Add after the `compile` describe block:

```ts
// ─── generate tests ───────────────────────────────────────────────────────────

describe('generate', () => {
  it('produces fresh UUIDs — none overlap source tree IDs', () => {
    const { generate } = await import('./blueprint.js');
    const tree = productTaskCharterTree();
    const bp = extract(tree, 'bp-gen', { createdAt: '2026-06-29T10:00:00.000Z' });

    let counter = 0;
    const generated = generate(bp, {
      newId: () => `gen-${++counter}`,
      tenantPackId: TENANT_PACK_ID,
    });

    const sourceIds = new Set(tree.nodes.map(n => n.id));
    expect(generated.nodes.every(n => !sourceIds.has(n.id))).toBe(true);
    expect(generated.nodes).toHaveLength(tree.nodes.length);
  });

  it('maps parentId and derives childrenIds correctly', () => {
    const { generate } = await import('./blueprint.js');
    const tree = productTaskCharterTree();
    const bp = extract(tree, 'bp-parent', { createdAt: '2026-06-29T10:00:00.000Z' });

    let counter = 0;
    const generated = generate(bp, {
      newId: () => `gen-${++counter}`,
      tenantPackId: TENANT_PACK_ID,
    });

    const genRoot = generated.nodes.find(n => n.parentId === null);
    expect(genRoot).toBeDefined();
    expect(genRoot!.childrenIds).toHaveLength(1);

    const genTask = generated.nodes.find(n => n.parentId === genRoot!.id);
    expect(genTask).toBeDefined();
    expect(genTask!.childrenIds).toHaveLength(0);
  });

  it('maps dependsOn IDs to fresh UUIDs', () => {
    const { generate } = await import('./blueprint.js');
    // Build a blueprint with dependsOn manually
    const productContract: CharterContract = {
      role: 'product',
      mission: { objective: 'Build', outcome: 'Built' },
      scope: { allowedPathPrefixes: ['src/'] },
    };
    const taskContract: CharterContract = {
      role: 'task',
      mission: { objective: 'Do', outcome: 'Done' },
      scope: { allowedPathPrefixes: ['src/'] },
    };
    const aId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const bId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const bp: import('./blueprint.js').CharterBlueprint = {
      id: 'bp-deps', createdAt: '2026-06-29T10:00:00.000Z',
      nodes: [
        { id: aId, parentId: null, role: 'product', contract: productContract, ordinal: 0, dependsOn: [] },
        { id: bId, parentId: aId, role: 'task', contract: taskContract, ordinal: 0, dependsOn: [aId] },
      ],
    };

    const idMapping = new Map<string, string>();
    const generated = generate(bp, {
      newId: () => {
        const fresh = `fresh-${idMapping.size + 1}`;
        return fresh;
      },
      tenantPackId: TENANT_PACK_ID,
    });

    // The task node's _dependsOn should reference the fresh ID of 'a', not 'a' itself
    const genTask = generated.nodes.find(n => n.parentId !== null)!;
    const genRoot = generated.nodes.find(n => n.parentId === null)!;
    const deps = genTask.metadata['_dependsOn'] as string[];
    expect(deps).toHaveLength(1);
    expect(deps[0]).toBe(genRoot.id); // maps to fresh ID of root
    expect(deps[0]).not.toBe(aId);   // not the source UUID
  });

  it('round-trip: extract → generate preserves roles and contracts', () => {
    const { generate } = await import('./blueprint.js');
    const tree = productTaskCharterTree();
    const bp = extract(tree, 'bp-rt', { createdAt: '2026-06-29T10:00:00.000Z' });

    let counter = 0;
    const generated = generate(bp, {
      newId: () => `rt-${++counter}`,
      tenantPackId: TENANT_PACK_ID,
    });

    // Same roles
    const sourceRoles = tree.nodes.map(n => readCharter(n)?.role).sort();
    const genRoles = generated.nodes.map(n => readCharter(n)?.role).sort();
    expect(genRoles).toEqual(sourceRoles);

    // Contracts preserved
    const sourceContracts = tree.nodes.map(n => readCharter(n)).filter(Boolean);
    for (const contract of sourceContracts) {
      const found = generated.nodes.some(n => {
        const c = readCharter(n);
        return c?.role === contract!.role &&
               c?.mission.objective === contract!.mission.objective;
      });
      expect(found).toBe(true);
    }
  });
});
```

> **Note:** `readCharter` is imported from `./charter-node.js`. Add it to the imports at the top of `blueprint.spec.ts`:
> ```ts
> import { writeCharter, readCharter, type CharterContract } from './charter-node.js';
> ```

---

- [ ] **Step 3.2: Run tests — verify generate tests fail**

```bash
pnpm vitest run src/blueprint.spec.ts
```

Expected: generate tests fail with `generate is not a function`

---

- [ ] **Step 3.3: Implement `generate` in `src/blueprint.ts`**

Replace the `// ─── generate (added in Task 3)` comment with:

```ts
// ─── generate ────────────────────────────────────────────────────────────────

/**
 * Turn a blueprint into a fresh PlanTree skeleton with remapped UUIDs.
 * Does NOT call compile — trusts a valid blueprint. Passing an invalid
 * blueprint (e.g. multiple roots, orphan refs) produces a malformed PlanTree
 * without error; call compile() first when correctness is required.
 */
export function generate(
  bp: CharterBlueprint,
  opts: { newId: () => string; tenantPackId: string; treeRootId?: string },
): PlanTree {
  // 1. Build ID map: blueprint node id → fresh UUID
  const idMap = new Map<string, string>();
  for (const node of bp.nodes) {
    idMap.set(node.id, opts.newId());
  }

  // 2. Determine treeRootId
  const rootNode = bp.nodes.find(n => n.parentId === null)!;
  const treeRootId = opts.treeRootId ?? idMap.get(rootNode.id)!;

  // 3. Build childrenIds lookup (sorted by ordinal for stable ordering)
  const childrenOf = new Map<string, string[]>(bp.nodes.map(n => [n.id, []]));
  const sortedNodes = [...bp.nodes].sort((a, b) => a.ordinal - b.ordinal);
  for (const node of sortedNodes) {
    if (node.parentId !== null && childrenOf.has(node.parentId)) {
      childrenOf.get(node.parentId)!.push(node.id);
    }
  }

  // 4. Build PlanNodes with remapped IDs
  const planNodes: PlanNode[] = bp.nodes.map(node => {
    const freshId = idMap.get(node.id)!;
    const freshParentId = node.parentId != null ? idMap.get(node.parentId)! : null;
    const freshChildrenIds = childrenOf.get(node.id)!.map(cid => idMap.get(cid)!);
    const freshDependsOn = node.dependsOn.map(dep => idMap.get(dep) ?? dep);

    const basePlanNode: PlanNode = {
      id: freshId,
      parentId: freshParentId,
      treeRootId,
      kind: node.role,
      kindRef: `charter:${node.role}`,
      ordinal: node.ordinal,
      childrenIds: freshChildrenIds,
      metadata: { _dependsOn: freshDependsOn },
    };

    return writeCharter(basePlanNode, node.contract);
  });

  return { treeRootId, tenantPackId: opts.tenantPackId, nodes: planNodes };
}
```

---

- [ ] **Step 3.4: Run tests — verify all pass**

```bash
pnpm vitest run src/blueprint.spec.ts
```

Expected: `16 passed` (3 extract + 9 compile + 4 generate)

---

- [ ] **Step 3.5: Typecheck**

```bash
pnpm run typecheck
```

Expected: no errors

---

- [ ] **Step 3.6: Commit**

```bash
git add src/blueprint.ts src/blueprint.spec.ts
git commit -m "feat(s2): generate — fresh PlanTree skeleton from CharterBlueprint"
```

---

## Task 4: `BlueprintStore` port

**Files:**
- Create: `src/blueprint-store.port.ts`
- Create: `src/blueprint-store.port.spec.ts`

**Interfaces:**
- Consumes: `CharterBlueprint` from Task 1
- Produces: `BlueprintStore`, `InMemoryBlueprintStore` — consumed by Task 5 (acid Acid 9 forbidden-words update)

---

- [ ] **Step 4.1: Write failing port tests**

Create `src/blueprint-store.port.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { InMemoryBlueprintStore } from './blueprint-store.port.js';
import type { CharterBlueprint } from './blueprint.js';

const SAMPLE_BP: CharterBlueprint = {
  id: 'bp-store-test',
  name: 'Store test',
  createdAt: '2026-06-29T10:00:00.000Z',
  nodes: [
    {
      id: 'root-node',
      parentId: null,
      role: 'product',
      contract: {
        role: 'product',
        mission: { objective: 'Build it', outcome: 'Built' },
        scope: { allowedPathPrefixes: ['src/'] },
      },
      ordinal: 0,
      dependsOn: [],
      label: 'Build it',
    },
  ],
};

describe('InMemoryBlueprintStore', () => {
  it('save → load returns deep-equal blueprint', async () => {
    const store = new InMemoryBlueprintStore();
    await store.save(SAMPLE_BP);
    const loaded = await store.load(SAMPLE_BP.id);
    expect(loaded).toEqual(SAMPLE_BP);
  });

  it('load unknown id returns null', async () => {
    const store = new InMemoryBlueprintStore();
    const result = await store.load('nonexistent');
    expect(result).toBeNull();
  });

  it('second save overwrites first', async () => {
    const store = new InMemoryBlueprintStore();
    await store.save(SAMPLE_BP);
    const updated: CharterBlueprint = { ...SAMPLE_BP, name: 'Updated name' };
    await store.save(updated);
    const loaded = await store.load(SAMPLE_BP.id);
    expect(loaded?.name).toBe('Updated name');
  });
});
```

---

- [ ] **Step 4.2: Run tests — verify they fail**

```bash
pnpm vitest run src/blueprint-store.port.spec.ts
```

Expected: `Cannot find module './blueprint-store.port.js'`

---

- [ ] **Step 4.3: Create `src/blueprint-store.port.ts`**

```ts
// src/blueprint-store.port.ts
import type { CharterBlueprint } from './blueprint.js';

/**
 * Port for persisting and retrieving charter blueprints.
 * Mirrors the CharterEventLog port pattern (ADR-285 D3).
 * Consumers (studio in S4, foundry in S3) provide persistence-backed adapters.
 */
export interface BlueprintStore {
  save(blueprint: CharterBlueprint): Promise<void>;
  load(id: string): Promise<CharterBlueprint | null>;
}

/** In-memory default — suitable for tests and development.
 *  Not thread-safe; not persistent across process restarts. */
export class InMemoryBlueprintStore implements BlueprintStore {
  private readonly store = new Map<string, CharterBlueprint>();

  async save(bp: CharterBlueprint): Promise<void> {
    // Shallow-copy nodes array to prevent external mutation (same pattern as InMemoryCharterEventLog)
    this.store.set(bp.id, { ...bp, nodes: [...bp.nodes] });
  }

  async load(id: string): Promise<CharterBlueprint | null> {
    return this.store.get(id) ?? null;
  }
}
```

---

- [ ] **Step 4.4: Run tests — verify all pass**

```bash
pnpm vitest run src/blueprint-store.port.spec.ts
```

Expected: `3 passed`

---

- [ ] **Step 4.5: Typecheck**

```bash
pnpm run typecheck
```

Expected: no errors

---

- [ ] **Step 4.6: Commit**

```bash
git add src/blueprint-store.port.ts src/blueprint-store.port.spec.ts
git commit -m "feat(s2): BlueprintStore port + InMemoryBlueprintStore"
```

---

## Task 5: Integration acid + public surface

**Files:**
- Modify: `src/acids.spec.ts` (add Acid 10; update Acid 9 forbidden list)
- Modify: `src/index.ts` (append S2 export block)

**Interfaces:**
- Consumes: `extract`, `compile`, `generate` from Tasks 1–3; `conductCharterStep` from S1; `productTaskCharterTree`, `TENANT_PACK_ID` from fixtures; `PrismaPlanTreeStore`, `FakePlanTreePrisma`, `InMemoryCharterEventLog` from existing imports

---

- [ ] **Step 5.1: Add Acid 10 to `src/acids.spec.ts`**

Add the following imports at the top of `acids.spec.ts` (after existing imports):

```ts
import { extract, compile, generate } from './blueprint.js';
```

Then append Acid 10 after the Acid 9 describe block (before the closing of the file):

```ts
// ─── Acid 10 ─────────────────────────────────────────────────────────────────
describe('Acid 10 — blueprint round-trip: extract → compile → generate → conductCharterStep', () => {
  it('a blueprint extracted from a valid tree compiles clean, generates a fresh tree, and the conductor advances it', async () => {
    tick = 1000;
    const sourceTree = productTaskCharterTree();

    // 1. Extract blueprint from source tree
    const bp = extract(sourceTree, 'acid-10-bp', { createdAt: '2026-06-29T10:00:00.000Z' });
    expect(bp.nodes).toHaveLength(2);
    expect(bp.sourceTreeRootId).toBe(sourceTree.treeRootId);

    // 2. Compile — must pass clean
    const compileResult = compile(bp);
    expect(compileResult).toEqual({ ok: true });

    // 3. Generate — fresh PlanTree skeleton
    let genCounter = 0;
    const generated = generate(bp, {
      newId: () => `acid10-${++genCounter}`,
      tenantPackId: TENANT_PACK_ID,
    });

    // All IDs must be fresh (no overlap with source tree)
    const sourceIds = new Set(sourceTree.nodes.map(n => n.id));
    expect(generated.nodes.every(n => !sourceIds.has(n.id))).toBe(true);

    // 4. conductCharterStep advances the generated tree
    const store = new PrismaPlanTreeStore(new FakePlanTreePrisma(), {
      tenantPackId: TENANT_PACK_ID,
      userId: '66666666-6666-4666-8666-666666666666',
    });
    const log = new InMemoryCharterEventLog();
    await store.save(generated);

    const deps: CharterDeps = {
      eventLog: log,
      planTreeStore: store,
      tenantPackId: TENANT_PACK_ID,
      now: () => new Date(Date.UTC(2026, 5, 29, 10, 0, ++tick)).toISOString(),
      newId: () => `acid10-id-${++tick}`,
    };

    const result = await conductCharterStep(deps, generated.treeRootId);
    expect(result.status).toBe('advanced');
  });
});
```

---

- [ ] **Step 5.2: Update Acid 9 forbidden list in `src/acids.spec.ts`**

Find the existing `forbidden` array in Acid 9 and add the two new S2 symbols:

```ts
// Before:
const forbidden = ['CharterNode', 'CharterContract', 'charterFrontier', 'CharterEvent', 'conductCharterStep'];

// After:
const forbidden = ['CharterNode', 'CharterContract', 'charterFrontier', 'CharterEvent', 'conductCharterStep', 'CharterBlueprint', 'InMemoryBlueprintStore'];
```

---

- [ ] **Step 5.3: Run all tests — verify Acid 10 passes, Acid 9 still passes**

```bash
pnpm test
```

Expected: all tests pass (prior ~74 + new ~19 = ~93 total). Specifically:
- `Acid 9` passes at 0 hits
- `Acid 10` passes

---

- [ ] **Step 5.4: Update `src/index.ts` — append S2 export block**

Open `src/index.ts` and append at the end:

```ts
// ── S2 ──────────────────────────────────────────────────────────────────────
export type { CharterBlueprint, CharterBlueprintNode, CompileResult, CompileError } from './blueprint.js';
export { extract, compile, generate } from './blueprint.js';
export type { BlueprintStore } from './blueprint-store.port.js';
export { InMemoryBlueprintStore } from './blueprint-store.port.js';
```

---

- [ ] **Step 5.5: Run full suite + typecheck**

```bash
pnpm test && pnpm run typecheck
```

Expected: all tests pass, no type errors

---

- [ ] **Step 5.6: Commit**

```bash
git add src/acids.spec.ts src/index.ts
git commit -m "feat(s2): Acid 10 round-trip + public surface export block"
```

---

## Task 6: ADR-286 + PR

**Files:**
- Create: `layers/specs/adr/adr-286-s2-blueprint-engine.md` (in `de-braighter/specs` repo at `D:/development/projects/de-braighter/layers/specs/`)
- Charter-runtime: push branch + open PR

**Interfaces:**
- No code consumed. Documents the decisions already implemented.

---

- [ ] **Step 6.1: Write ADR-286**

Create `D:/development/projects/de-braighter/layers/specs/adr/adr-286-s2-blueprint-engine.md`:

```markdown
---
title: "ADR-286: The charter blueprint engine — extract, compile, generate, BlueprintStore"
status: proposed
tier: design-global
scope: cluster
date: 2026-06-29
decision-makers: [stibe]
relates-to:
  - adr/adr-283-charter-runtime-cluster-layer.md
  - adr/adr-285-s1-lifecycle-runtime-protocol.md
  - adr/adr-176-substrate-kernel-minimality-inclusion-test.md
---

# ADR-286: The charter blueprint engine — extract, compile, generate, BlueprintStore

## Status

Proposed.

This ADR is the written rationale for the S2 Blueprint Engine delivered in
`de-braighter/charter-runtime` (branch `feat/s2-blueprint-engine`). S2 adds the
machinery for capturing, validating, and re-instantiating charter tree designs as
portable, execution-state-free snapshots. It is additive to the S1 lifecycle runtime
(ADR-285) — zero change to any S0/S1 file, and the Kernel-Untouched Invariant (ADR-283
D2) holds.

## Context

S1 delivered a conductor that can advance a charter tree one step at a time, but only
if the tree already exists in the kernel store. S2 unlocks three new consumers:

1. **Studio draft persistence (S4)** — save/load tree designs before they are deployed
   to the kernel.
2. **Foundry migration (S3, dogfood)** — migrate `buildCascadeTree` product trees into
   the charter-runtime; the blueprint is the portable snapshot used for that migration.
3. **Domain template bootstrapping** — any domain can produce a charter tree skeleton
   from a shared blueprint without coupling to a running kernel store.

A **blueprint** is the *design-time form* of a charter tree: a validated snapshot of
roles, contracts, and dependency edges, divorced from any lifecycle events or runtime
state.

## Decisions

### D1 — UUID-as-key + optional `label`

Blueprint nodes keep their source `PlanNode.id` UUIDs as reference keys within the
blueprint. `generate` remaps all of them to fresh UUIDs. `compile` validates on the
source UUIDs. An optional `label` field carries a human-readable name (defaulting to
`contract.mission.objective`); it is not a key.

**Why not logical keys?** Logical keys (e.g. `"root"`, `"task-1"`) require deriving
stable names from a UUID-keyed tree, which is fragile. The UUID-as-key approach is
consistent with the foundry's `ProductBlueprint.process` (a `PlanTree` with UUIDs) and
is the simplest option that preserves `dependsOn` edge references exactly — no
key-remapping inside `compile`.

**Why not UUID-only (no label)?** `label` costs nothing to store and gives the studio
and human authors a display name without synthesising one from the contract.

### D2 — Caller-owned blueprint identity

`extract` takes an explicit `blueprintId: string` from the caller. The caller generates
it (e.g. via `deps.newId()`). This keeps `extract` a pure function with no injected
generators — consistent with the foundry's `extractBlueprint(spec, state, productKey)`
where `productKey` is always caller-supplied.

### D3 — Non-charter nodes silently skipped by `extract`

`extract` calls `readCharter(node)` on each tree node; nodes returning `null` are
skipped. A tree may contain structural scaffolding nodes without charter metadata; the
blueprint is agnostic to them. Skipping silently (no error) is correct — a scaffolding
node is not a blueprint concern.

### D4 — `compile` collects all errors (no fail-fast)

`compile` runs all six validation checks in one pass and returns the complete error list.
A design tool (studio) needs to see every problem at once, not fix one and resubmit. The
same discipline as TypeScript's type-checker.

Checks in order: (1) root existence, (2) parent-ref integrity, (3) dependency-ref
integrity, (4) parent-chain acyclicity, (5) dependency acyclicity (Kahn's), (6)
inheritance validation via `validateInheritance` from `inheritance.ts`. Inheritance
check is skipped for nodes whose parent is already flagged as missing, to avoid
misleading double-errors.

### D5 — `generate` trusts a valid blueprint (no internal compile)

`generate` does not call `compile` internally. Callers that require validity validate
ahead of time. Passing an invalid blueprint (e.g. multiple roots) produces a malformed
`PlanTree` without error. This mirrors S0's discipline: `writeCharter` stores without
validating; `readCharter` validates on read. Trust the boundary, not every write path.

### D6 — `childrenIds` derived in `generate`, not stored in blueprint

Blueprint nodes carry `parentId` (the single source of truth for parent-child
relationships). `generate` derives `childrenIds` from those relationships in one pass,
sorted by ordinal. This is "store generators, derive graphs" (ADR-176 §4 / north-star
§20) applied to blueprint generation.

### D7 — `BlueprintStore` port mirrors `CharterEventLog`; `list()` deferred

`BlueprintStore` exposes `save(blueprint)` and `load(id)` — the minimum needed by S2
consumers. `list()` is deferred to S4 when the studio needs it. The port pattern mirrors
`CharterEventLog` (ADR-285 D3): a simple interface + `InMemoryBlueprintStore` default.

### D8 — Kernel-Untouched Invariant holds

S2 is purely additive to `layers/charter-runtime`. Zero diff to:
- `substrate-contracts/src/plan-tree/plan-tree-schemas.ts`
- `substrate-contracts/src/plan-tree/plan-tree-store.port.ts`
- `substrate-runtime/src/plan-tree/prisma-plan-tree.store.ts`
- the `kernel.plan_node` migration

Acid 9 (recursive substrate scan) passes at 0 hits. `CharterBlueprint` and
`InMemoryBlueprintStore` are added to the Acid 9 forbidden-words list.

## Consequences

- Any domain can now snapshot a live charter tree, validate the snapshot, and
  re-instantiate it as a fresh PlanTree skeleton — ready for `conductCharterStep`.
- The foundry's `buildCascadeTree` migration path (S3) is unblocked: extract a blueprint
  from the foundry product tree, compile it, generate a charter-runtime tree.
- Studio draft persistence (S4) is unblocked: the studio uses `extract` to snapshot and
  `generate` to restore from a saved blueprint.
- `compile`'s collect-all discipline means the studio can show a full error list to the
  author without round-trips.

## Alternatives Considered

### Async `extract(treeRootId, planTreeStore)`

Rejected. Coupling I/O into `extract` breaks the pure-function discipline established
across S0/S1 and makes testing harder (requires store mocks for core logic). The
caller-loads pattern (load the tree, pass it as a value) is the S1 deliberate discipline.

### Logical keys for blueprint nodes (human-readable slugs)

Rejected. Key derivation from a UUID tree is fragile (no canonical slug for a UUID node
without a naming convention). UUID-as-key is simpler and preserves `dependsOn` edge
references without remapping inside `compile`.

### `BlueprintBuilder` fluent authoring API (template-first)

Deferred to S4. S2's primary use-cases are extract-from-live-tree and
generate-skeleton. Template authoring (building a blueprint without a source tree) is an
S4 studio concern.

## References

- [ADR-283](adr-283-charter-runtime-cluster-layer.md) — charter-runtime layer placement
  + Kernel-Untouched Invariant
- [ADR-285](adr-285-s1-lifecycle-runtime-protocol.md) — S1 lifecycle runtime; S2 builds
  on it
- [ADR-176](adr-176-substrate-kernel-minimality-inclusion-test.md) — the inclusion test;
  "store generators, derive graphs"
- Design spec: `docs/superpowers/specs/2026-06-29-s2-blueprint-engine-design.md`
```

---

- [ ] **Step 6.2: Commit ADR-286 in specs repo**

```bash
# In D:/development/projects/de-braighter/layers/specs
git checkout -b feat/adr-286-s2-blueprint-engine
git add adr/adr-286-s2-blueprint-engine.md
git commit -m "docs(adr): ADR-286 — S2 blueprint engine (extract/compile/generate/BlueprintStore)"
git push -u origin feat/adr-286-s2-blueprint-engine
```

---

- [ ] **Step 6.3: Open specs PR**

```bash
gh pr create \
  --title "docs: ADR-286 — S2 charter blueprint engine" \
  --body "$(cat <<'EOF'
## Summary

- Adds ADR-286 ratifying the S2 Blueprint Engine decisions for `layers/charter-runtime`
- Records: UUID-as-key+label (D1), caller-owned identity (D2), skip non-charter (D3), collect-all compile (D4), generate trusts caller (D5), derive childrenIds (D6), minimal BlueprintStore port (D7), Kernel-Untouched Invariant certified (D8)

## Test plan

- [ ] spec-auditor passes (cross-refs, numbering, frontmatter)
- [ ] ADR-285 and ADR-283 links resolve
- [ ] No markdownlint violations

Producer: orchestrator/claude-sonnet-4-6 [brainstorming, writing-plans]
Effort: light
Effect: cycle-time 0.01±0.02 expert
EOF
)"
```

---

- [ ] **Step 6.4: Push charter-runtime branch + open charter-runtime PR**

```bash
# In D:/development/projects/de-braighter/layers/charter-runtime
git push -u origin feat/s2-blueprint-engine
gh pr create \
  --title "feat(s2): charter blueprint engine — extract, compile, generate, BlueprintStore" \
  --body "$(cat <<'EOF'
## Summary

- Adds `CharterBlueprint` / `CharterBlueprintNode` types (UUID-as-key + optional label)
- `extract(tree, blueprintId)` — pure structural snapshot, skips non-charter nodes
- `compile(bp)` — collect-all validation: parent refs, dep refs, acyclicity, inheritance
- `generate(bp, opts)` — fresh PlanTree skeleton with remapped UUIDs, ready for `conductCharterStep`
- `BlueprintStore` port + `InMemoryBlueprintStore` (mirrors `CharterEventLog` pattern)
- Acid 10: extract→compile→generate→conductCharterStep round-trip
- Acid 9 forbidden-words list extended with `CharterBlueprint`, `InMemoryBlueprintStore`
- ADR-286 reserved; rationale filed in specs PR

## Test plan

- [ ] `pnpm test` — all ~93 tests pass
- [ ] `pnpm run typecheck` — no errors
- [ ] Acid 9 (Kernel-Untouched) passes at 0 hits
- [ ] Acid 10 (blueprint round-trip) passes
- [ ] `charter-checker` agent review passes

Producer: orchestrator/claude-sonnet-4-6 [brainstorming, writing-plans, subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert
Effect: findings 0±1 expert
EOF
)"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `CharterBlueprint` + `CharterBlueprintNode` types (UUID-as-key + optional label) | Task 1 |
| `extract(tree, blueprintId, opts?) → CharterBlueprint` | Task 1 |
| Non-charter nodes silently skipped | Task 1 |
| `compile` — parent refs, dep refs, acyclicity, inheritance, collect-all | Task 2 |
| `generate` — fresh IDs, childrenIds derived, dependsOn remapped | Task 3 |
| `BlueprintStore` port + `InMemoryBlueprintStore` | Task 4 |
| Integration acid: extract→compile→generate→conductCharterStep | Task 5 |
| Acid 9 forbidden-words extended | Task 5 |
| Public surface export block in `index.ts` | Task 5 |
| ADR-286 | Task 6 |
| PR in charter-runtime + PR in specs | Task 6 |

All requirements covered. ✓

**Placeholder scan:** No TBD / TODO / "similar to Task N" patterns present. ✓

**Type consistency check:**

| Name | Defined in | Used in |
|---|---|---|
| `CharterBlueprint` | Task 1 `blueprint.ts` | Task 2 compile, Task 3 generate, Task 4 store, Task 5 acid, Task 6 ADR |
| `CharterBlueprintNode` | Task 1 `blueprint.ts` | Task 2 `detectParentCycles` param |
| `CompileError` | Task 2 `blueprint.ts` | Task 5 `index.ts` export |
| `CompileResult` | Task 2 `blueprint.ts` | Task 5 `index.ts` export |
| `BlueprintStore` | Task 4 `blueprint-store.port.ts` | Task 5 `index.ts` export |
| `InMemoryBlueprintStore` | Task 4 `blueprint-store.port.ts` | Task 5 `index.ts` export, Acid 9 forbidden list |
| `extract` | Task 1 | Task 5 acid, Task 5 `index.ts` |
| `compile` | Task 2 | Task 5 acid, Task 5 `index.ts` |
| `generate` | Task 3 | Task 5 acid, Task 5 `index.ts` |

All names consistent across tasks. ✓
