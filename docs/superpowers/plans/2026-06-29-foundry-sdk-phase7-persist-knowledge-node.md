# Foundry SDK Phase 7 — Persist gen_generate kind=knowledge to the Substrate DB

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the round-trip started in Phase 6. After `gen_generate kind=knowledge` returns
a `PlanNode` artifact, that node must also be persisted to `kernel.plan_node` (via
`PlanTreeStore.save()`) so it is queryable by the knowledge layer.

**Architecture decision summary (concierge 2026-06-29):**

| Question | Decision |
|----------|----------|
| Where does the DB write live? | In `gen-tools.ts`, **after** `CoreFoundry.execute()` returns — NOT inside `knowledge-skin.persist()` |
| Why not inside `persist()`? | `persist()` is a stamp step (decorate artifact → PlanNode); `save()` needs a full `PlanTree` (treeRootId + tenantPackId + nodes[]); changing `persist()` would alter `FoundryManifest`'s semantic contract and affect all skins |
| Why not a new `gen_persist_knowledge_node` tool? | Breaks "generate = done" UX; agents would need to remember to call it; fragile |
| Injection pattern | `GenToolDeps` gets `store?: PlanTreeStore` (optional — store absent = current in-memory-only behaviour, backward-compatible) |
| Where does `PlanTreeStore` type come from? | `@de-braighter/substrate-contracts/plan-tree` — already a dep of `domains/foundry` |
| Real binding (production) | `PrismaPlanTreeStore` from `@de-braighter/substrate-runtime` constructed in `server.ts` (composition root) when `SUBSTRATE_DATABASE_URL` env var is set |
| New dep needed? | Yes: `@de-braighter/substrate-runtime` as a prod dep of `domains/foundry` (all other domain MCP servers already have it) |
| tenantPackId | Propagated from `makeSyntheticCtx`'s `tenantPackId` (`'foundry-mcp'` by default, overridable via `FOUNDRY_TENANT_PACK_ID` env var) |
| ADR-176 kernel test | Pass — `PlanTreeStore` is an existing kernel port (concern #1 "recurse the plan"); this is a new consumer, not a new kernel primitive. Zero schema change. |
| Breaking changes | None — store is optional; all existing tool APIs unchanged |

**Pattern this follows:** `ingestCorpus` in `layers/knowledge/src/ingest.ts` — build nodes, then
`store.save(tree)` with an injected `PlanTreeStore`. The gen_generate path does the same.

**Branch:** `feat/foundry-phase7-persist-knowledge-node` branched from `main` in `domains/foundry`.

**Tech stack:** TypeScript 5.x, Vitest 2.x, Node.js ESM (`moduleResolution: NodeNext`).

---

## Global Constraints

- All relative imports **must end in `.js`** (ESM, NodeNext) — never `.ts`
- **Zero breaking changes** to existing MCP tool APIs (store is optional; absent = existing behaviour)
- `FoundryManifest.persist()` signature is **not changed** — the DB write is a caller-level concern
- `@de-braighter/knowledge` is still off-limits in `domains/foundry` (private/no-dist)
- Working directory for all commands: `D:/development/projects/de-braighter/domains/foundry`

---

## Key Types

### `PlanTreeStore` (from `@de-braighter/substrate-contracts/plan-tree`)

```typescript
export interface PlanTreeStore {
  load(treeRootId: string): Promise<PlanTree | null>;
  save(tree: PlanTree): Promise<void>;
  applyEdit(treeRootId: string, edit: PlanTreeEdit): Promise<PlanTree>;
}
```

### `PlanTree` (from `@de-braighter/substrate-contracts/plan-tree`)

```typescript
export interface PlanTree {
  treeRootId: string;
  tenantPackId: string;
  nodes: PlanNode[];
}
```

### `PrismaPlanTreeStore` (from `@de-braighter/substrate-runtime`)

```typescript
// Constructor signature
new PrismaPlanTreeStore(prismaDelegate: PlanNodePrismaDelegate, ctx: { tenantPackId: string; userId: string })
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/mcp/gen-tools.ts` | **Modify** | Add `store?: PlanTreeStore` + `tenantPackId?: string` to `GenToolDeps`; post-execute save call for kind=knowledge |
| `src/mcp/gen-tools.spec.ts` | **Modify** | Add test: store.save called with correct PlanTree when store is injected |
| `package.json` | **Modify** | Add `@de-braighter/substrate-runtime` as prod dep |
| `src/mcp/server.ts` | **Modify** | Read `SUBSTRATE_DATABASE_URL` + `FOUNDRY_TENANT_PACK_ID` env vars; construct `PrismaPlanTreeStore` when present; pass to `makeGenTools` |

---

## Task 1: Wire `PlanTreeStore` into `GenToolDeps` and the gen_generate knowledge branch

**Goal:** After `CoreFoundry.execute('knowledge', ...)` returns a `PlanNode`, wrap it in a
`PlanTree` and call `deps.store.save(tree)` when a store is injected.

- [ ] **Step 1: Read `src/mcp/gen-tools.ts`** (full) to anchor the edit

- [ ] **Step 2: Update `GenToolDeps` and imports in `src/mcp/gen-tools.ts`**

  Add import at the top (alongside existing substrate-contracts imports via foundry-core):
  ```typescript
  import type { PlanTree, PlanTreeStore } from '@de-braighter/substrate-contracts/plan-tree';
  ```

  Extend `GenToolDeps`:
  ```typescript
  export interface GenToolDeps {
    logPath: string;
    dataDir: string;
    now?: () => string;
    newId?: () => string;
    useCoreFoundry?: boolean;
    /** Optional store for persisting knowledge PlanNodes to the substrate DB (S1). */
    store?: PlanTreeStore;
    /** tenantPackId stamped on the PlanTree when persisting. Defaults to the synthetic ctx value. */
    tenantPackId?: string;
  }
  ```

  Update `makeSyntheticCtx` to use `deps.tenantPackId`:
  ```typescript
  function makeSyntheticCtx(deps: Pick<GenToolDeps, 'newId' | 'tenantPackId'>): FoundryContext {
    const newId = deps.newId ?? (() => randomUUID());
    return {
      tenantPackId: deps.tenantPackId ?? 'foundry-mcp',
      parentNodeId: newId(),
      runId: newId(),
    };
  }
  ```

  Update the `kind=knowledge` branch in `gen_generate`:
  ```typescript
  if (a.kind === 'knowledge') {
    const ctx = makeSyntheticCtx(deps);
    const callFoundry = new CoreFoundry();
    callFoundry.register(createKnowledgeSkin(createKnowledgeNodeFn));
    const node = await callFoundry.execute('knowledge', a.model, ctx);
    if (deps.store) {
      const tree: PlanTree = {
        treeRootId: node.treeRootId,
        tenantPackId: ctx.tenantPackId,
        nodes: [node],
      };
      await deps.store.save(tree);
    }
    return node;
  }
  ```

- [ ] **Step 3: Run typecheck**

  ```bash
  npm run typecheck
  ```

  Expected: `tsc --noEmit` clean.

- [ ] **Step 4: Commit**

  ```bash
  git add src/mcp/gen-tools.ts
  git commit -m "feat(phase7-s1): wire PlanTreeStore into GenToolDeps; persist knowledge PlanNode after execute"
  ```

---

## Task 2: Tests for the store seam

**Goal:** Verify that when a `store` is injected into `GenToolDeps`, `store.save` is called with
the correct `PlanTree` shape after `gen_generate kind=knowledge`.

- [ ] **Step 1: Read `src/mcp/gen-tools.spec.ts`** to understand current test structure

- [ ] **Step 2: Add store-seam tests to `src/mcp/gen-tools.spec.ts`**

  ```typescript
  describe('gen_generate kind=knowledge — store seam', () => {
    const validModel = {
      title: 'Phase 7 test node',
      knowledgeKind: 'design-note',
      contract: {
        summary: 'A persisted design note',
        contentRef: { adapter: 'inline', locator: 'test' },
        cites: [],
        lifecycle: 'draft' as const,
        skin: 'knowledge',
      },
    };

    it('calls store.save with a PlanTree wrapping the generated node when store is injected', async () => {
      const savedTrees: unknown[] = [];
      const mockStore = {
        save: vi.fn(async (tree: unknown) => { savedTrees.push(tree); }),
        load: vi.fn(async () => null),
        applyEdit: vi.fn(async () => { throw new Error('not used'); }),
      };
      const tools = makeGenTools({ logPath: ':memory:', dataDir: '/tmp', store: mockStore, tenantPackId: 'test-tenant' });
      const result = await tools.gen_generate({ kind: 'knowledge', model: validModel, claimRef: 'test-claim' });

      expect(result.isError).toBeFalsy();
      expect(mockStore.save).toHaveBeenCalledTimes(1);

      const tree = savedTrees[0] as { treeRootId: string; tenantPackId: string; nodes: unknown[] };
      expect(tree.tenantPackId).toBe('test-tenant');
      expect(tree.nodes).toHaveLength(1);

      const node = JSON.parse(result.content[0].text);
      expect(tree.treeRootId).toBe(node.treeRootId);
      expect((tree.nodes[0] as { id: string }).id).toBe(node.id);
    });

    it('does NOT call store.save when no store is injected', async () => {
      const tools = makeGenTools({ logPath: ':memory:', dataDir: '/tmp' }); // no store
      const result = await tools.gen_generate({ kind: 'knowledge', model: validModel, claimRef: 'test-claim' });
      expect(result.isError).toBeFalsy();
      // No assertion needed on store — just verifying no crash
    });

    it('returns an error when store.save throws', async () => {
      const failStore = {
        save: vi.fn(async () => { throw new Error('DB write failed'); }),
        load: vi.fn(async () => null),
        applyEdit: vi.fn(async () => { throw new Error('not used'); }),
      };
      const tools = makeGenTools({ logPath: ':memory:', dataDir: '/tmp', store: failStore });
      const result = await tools.gen_generate({ kind: 'knowledge', model: validModel, claimRef: 'test-claim' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/DB write failed/);
    });
  });
  ```

- [ ] **Step 3: Run the new tests**

  ```bash
  npx vitest run src/mcp/gen-tools.spec.ts
  ```

  Expected: all existing tests pass + new store-seam tests pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/mcp/gen-tools.spec.ts
  git commit -m "test(phase7-s2): store seam coverage — save called, no-store no-crash, save-throw propagates"
  ```

---

## Task 3: Add `@de-braighter/substrate-runtime` dep + bind `PrismaPlanTreeStore` in `server.ts`

**Goal:** When `SUBSTRATE_DATABASE_URL` is set, construct a real `PrismaPlanTreeStore` and pass
it to `makeGenTools` so `gen_generate kind=knowledge` persists to `kernel.plan_node`.

- [ ] **Step 1: Check current substrate-runtime version**

  ```bash
  cat ../../layers/substrate/libs/substrate-runtime/package.json | grep '"version"'
  ```

  Note the version for the `package.json` dep entry.

- [ ] **Step 2: Add dep to `package.json`**

  In `domains/foundry/package.json`, add to `"dependencies"`:
  ```json
  "@de-braighter/substrate-runtime": "file:../../layers/substrate/libs/substrate-runtime"
  ```

  Then reinstall:
  ```bash
  npm install
  ```

- [ ] **Step 3: Read `src/mcp/server.ts`** (full) to understand where `makeGenTools` is called

- [ ] **Step 4: Update `src/mcp/server.ts`**

  Add imports at the top:
  ```typescript
  import { PrismaClient } from '@prisma/client';
  import { PrismaPlanTreeStore } from '@de-braighter/substrate-runtime';
  ```

  In `main()`, before `makeGenTools(...)`, construct the store when env vars are present:

  ```typescript
  const dbUrl = process.env['SUBSTRATE_DATABASE_URL'];
  const tenantPackId = process.env['FOUNDRY_TENANT_PACK_ID'] ?? 'foundry-mcp';
  const userId = process.env['FOUNDRY_USER_ID'] ?? '00000000-0000-0000-0000-000000000000';

  const planTreeStore = dbUrl
    ? new PrismaPlanTreeStore(
        new PrismaClient({ datasources: { db: { url: dbUrl } } }) as unknown as Parameters<typeof PrismaPlanTreeStore>[0],
        { tenantPackId, userId },
      )
    : undefined;

  const gen = makeGenTools({ dataDir: DEFAULT_DATA_DIR, logPath: DEFAULT_LOG, useCoreFoundry, store: planTreeStore, tenantPackId });
  ```

  **Note:** `PrismaPlanTreeStore` takes a `PlanNodePrismaDelegate` (the `planNode` property of a
  Prisma client). Check the actual constructor signature in
  `layers/substrate/libs/substrate-runtime/src/plan-tree/` and adjust the call accordingly.
  The Prisma client's `planNode` delegate (`.planNode`) is the correct first argument, not the
  full client. Read the runtime's source before finalizing this step.

- [ ] **Step 5: Run typecheck**

  ```bash
  npm run typecheck
  ```

  Resolve any type errors (likely the PrismaClient delegate shape — see note above).

- [ ] **Step 6: Run full tests**

  ```bash
  npm run test
  ```

  Expected: all tests pass (PrismaPlanTreeStore is only constructed in `main()`, not in tests).

- [ ] **Step 7: Commit**

  ```bash
  git add package.json src/mcp/server.ts
  git commit -m "feat(phase7-s3): bind PrismaPlanTreeStore in server.ts when SUBSTRATE_DATABASE_URL is set"
  ```

---

## Task 4: Full CI + PR

- [ ] **Step 1: Run full CI**

  ```bash
  npm run typecheck && npm run test:coverage
  ```

  Expected: typecheck clean, all tests pass.

- [ ] **Step 2: Open PR**

  ```bash
  git push -u origin feat/foundry-phase7-persist-knowledge-node
  gh pr create \
    --title "feat: Phase 7 — persist gen_generate kind=knowledge to substrate DB" \
    --body "$(cat <<'EOF'
  ## Summary

  - Adds optional `store?: PlanTreeStore` to `GenToolDeps` in `gen-tools.ts`
  - After `CoreFoundry.execute('knowledge', ...)` returns a `PlanNode`, wraps it in a `PlanTree` and calls `store.save(tree)` — closing the round-trip
  - Binds `PrismaPlanTreeStore` in `server.ts` when `SUBSTRATE_DATABASE_URL` env var is set; falls back to no-op (in-memory only) when absent — zero breaking change
  - Adds `@de-braighter/substrate-runtime` as a prod dep (needed for `PrismaPlanTreeStore` in the composition root)
  - Pattern follows `ingestCorpus` in the knowledge layer: build nodes → `store.save(tree)` with injected store

  ## Test plan

  - [ ] `gen_generate kind=knowledge` with mock store: `store.save` called once with correct `PlanTree` shape
  - [ ] No store injected: no crash, same return value
  - [ ] `store.save` throws: error propagated as MCP `isError: true` response
  - [ ] `npm run typecheck` clean
  - [ ] All existing tests pass (≥1165)

  ## ADR-176 kernel check

  `PlanTreeStore` is an existing kernel port (concern #1 "recurse the plan"). This is a new consumer of the published port — no new kernel primitive, no schema change. Kernel-Untouched.

  Producer: orchestrator/claude-sonnet-4-6 [architecture-concierge, subagent-driven-development]
  Effort: standard
  Effect: cycle-time 0.005±0.01 expert
  EOF
  )"
  ```

---

## Self-Review Checklist

### Spec coverage
- [ ] `GenToolDeps.store?: PlanTreeStore` — typed from `@de-braighter/substrate-contracts/plan-tree`
- [ ] `GenToolDeps.tenantPackId?: string` — propagated to `makeSyntheticCtx` and `PlanTree.tenantPackId`
- [ ] `gen_generate kind=knowledge` calls `store.save({ treeRootId: node.treeRootId, tenantPackId, nodes: [node] })` when store present
- [ ] Store absent = existing in-memory-only behaviour (backward-compatible, zero crash)
- [ ] `store.save` error propagated via guard → MCP `isError: true` response
- [ ] `@de-braighter/substrate-runtime` added to `domains/foundry/package.json` deps
- [ ] `PrismaPlanTreeStore` bound in `server.ts` only when `SUBSTRATE_DATABASE_URL` is set
- [ ] `FoundryManifest.persist()` interface **not changed**
- [ ] `knowledge-skin.ts` **not changed**
- [ ] `@de-braighter/knowledge` still not imported in `domains/foundry`
- [ ] All existing tests pass (≥1165)
- [ ] `npm run typecheck` clean

### What is NOT in Phase 7

| Item | Reason | Phase |
|------|---------|-------|
| Multi-node tree support (corpus of nodes) | gen_generate produces exactly one node; corpus ingest is the knowledge layer's path | Later if needed |
| RLS tenant validation at generate time | RLS is enforced by the Postgres GUC set by `PrismaPlanTreeStore`; the tenantPackId comes from env | Later |
| `gen_describe_schema kind=knowledge` | Discovery via `gen_list_coregen_kinds` is sufficient | Deferred |
| `gen_preview kind=knowledge` | PlanNode has no meaningful preview format | Deferred |
| DB-gated integration test | Would need real Postgres; FakePlanTreePrisma approach requires importing knowledge testing helpers (out of scope) | Phase 8+ |

---

## Memory update after merge

After the PR is merged and the devloop ritual is run, update:

`C:\Users\stibe\.claude\projects\D--development-projects-de-braighter\memory\foundry-sdk-three-pillar-arc.md`

Mark the arc as closed with Phase 7 included, noting that the full round-trip
(`gen_generate kind=knowledge` → PlanNode in memory + persisted to `kernel.plan_node`) is live.
