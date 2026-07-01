# Foundry Phase 8 — Item 1: Root-node persist default

**Status:** In progress  
**Repo:** `domains/foundry`  
**Branch:** `feat/foundry-phase8-item1-root-node-default`

## Goal

When `gen_generate kind=knowledge` is called without explicit `parentId` in the model, inject
`parentId: null` before passing to `CoreFoundry.execute`. This makes standalone generation
default to a root node cleanly — no FK violation on `kernel.plan_node.parent_id`.

## Architecture decision (concierge 2026-06-29)

| Question | Decision |
|---|---|
| WHERE does the fix live? | `domains/foundry/src/mcp/gen-tools.ts` (MCP-path default) |
| NOT in foundry-core? | Correct — the skin stays generic. The default is MCP-specific UX. |
| ADR-176 | PASS — domain-side only, no kernel touch |
| ADR-027 | PASS — domain consumes published APIs, correct direction |
| New ADR needed? | No — domain-local default/UX fix, not a new pattern |

## Implementation

### Task 1: Inject root-node default in gen-tools.ts

In the `kind === 'knowledge'` branch of `gen_generate` in `gen-tools.ts`:

```typescript
if (a.kind === 'knowledge') {
  const ctx = makeSyntheticCtx(deps);
  // MCP-path root-node default: if the caller omitted parentId, default to null (root).
  // An explicit parentId (including null) passes through unchanged.
  const model =
    a.model !== null && typeof a.model === 'object' && !Object.hasOwn(a.model as object, 'parentId')
      ? { ...(a.model as object), parentId: null }
      : a.model;
  const callFoundry = new CoreFoundry();
  callFoundry.register(createKnowledgeSkin(createKnowledgeNodeFn));
  const node = await callFoundry.execute('knowledge', model, ctx);
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

### Task 2: Add tests for root-node default

In `gen-tools.spec.ts`, in the knowledge store-seam tests block:

```typescript
it('defaults parentId to null (root node) when model omits parentId', async () => {
  const savedTrees: unknown[] = [];
  const mockStore = {
    save: vi.fn(async (tree: unknown) => { savedTrees.push(tree); }),
    load: vi.fn(async () => null),
    applyEdit: vi.fn(async () => { throw new Error('not used'); }),
  };
  const tools = makeGenTools({ logPath: ':memory:', dataDir: '/tmp', store: mockStore });
  const model = {
    title: 'No parentId model',
    knowledgeKind: 'design-note',
    contract: {
      summary: 'Should default to root',
      contentRef: { adapter: 'inline', locator: 'test' },
      cites: [],
      lifecycle: 'draft' as const,
      skin: 'knowledge',
    },
    // parentId intentionally omitted
  };
  const result = await tools.gen_generate({ kind: 'knowledge', model, claimRef: 'test' });
  expect(result.isError).toBeFalsy();
  const node = JSON.parse(result.content[0].text);
  expect(node.parentId).toBeNull(); // root node — no FK violation
});

it('preserves an explicit parentId when provided', async () => {
  // If caller passes parentId explicitly (including non-null), it passes through
  const tools = makeGenTools({ logPath: ':memory:', dataDir: '/tmp' });
  const model = {
    title: 'Explicit parentId model',
    knowledgeKind: 'design-note',
    contract: {
      summary: 'Explicit parent',
      contentRef: { adapter: 'inline', locator: 'test' },
      cites: [],
      lifecycle: 'draft' as const,
      skin: 'knowledge',
    },
    parentId: null, // explicit null — passes through
  };
  const result = await tools.gen_generate({ kind: 'knowledge', model, claimRef: 'test' });
  expect(result.isError).toBeFalsy();
  const node = JSON.parse(result.content[0].text);
  expect(node.parentId).toBeNull();
});
```

### Task 3: Update gen_list_coregen_kinds description

Update the description to note `parentId` now defaults to null:
```
'...When a substrate DB is configured (SUBSTRATE_DATABASE_URL set) the node persists to kernel.plan_node. Standalone nodes default to root (parentId: null) — pass an explicit parentId to attach to an existing parent.'
```

### Task 4: typecheck + tests + commit + PR
