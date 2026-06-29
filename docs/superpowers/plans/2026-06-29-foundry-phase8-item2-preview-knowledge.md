# Foundry Phase 8 — Item 2: gen_preview kind=knowledge

**Status:** In progress  
**Repo:** `domains/foundry`  
**Branch:** `feat/foundry-phase8-item2-preview-knowledge`

## Goal

Add a CoreFoundry-native preview for `kind=knowledge` in `gen_preview`. Currently `gen_preview`
delegates entirely to `sdk.preview()` which only handles file-kinds. The knowledge preview
should render the would-be PlanNode (no write, no event) — symmetric with `gen_generate kind=knowledge`
minus the persist step.

## Architecture decision (concierge 2026-06-29)

| Question | Decision |
|---|---|
| WHERE | `domains/foundry/src/mcp/gen-tools.ts` — add knowledge branch in gen_preview |
| No store call | Correct — preview is read/render-only; no `store.save()` |
| Root-node default | Yes — apply same `parentId: null` default as Item 1 |
| ADR-176 | PASS — domain-side only |
| ADR-027 | PASS — domain consumes published APIs |
| gen_list_coregen_kinds | Update to mention preview is supported |
| New ADR needed? | No |

## Implementation

### Task 1: Add knowledge branch in gen_preview

Replace the current:
```typescript
gen_preview: guard((a: { kind: string; model: unknown }) => sdk.preview(a.kind, a.model)),
```
with:
```typescript
gen_preview: guard(async (a: { kind: string; model: unknown }) => {
  if (a.kind === 'knowledge') {
    const ctx = makeSyntheticCtx(deps);
    const model =
      a.model !== null && typeof a.model === 'object' && !Object.hasOwn(a.model as object, 'parentId')
        ? { ...(a.model as object), parentId: null }
        : a.model;
    const callFoundry = new CoreFoundry();
    callFoundry.register(createKnowledgeSkin(createKnowledgeNodeFn));
    return callFoundry.execute('knowledge', model, ctx);
  }
  return sdk.preview(a.kind, a.model);
}),
```

### Task 2: Update gen_list_coregen_kinds

Add `preview: true` or a note that gen_preview is supported:
```
'Preview (gen_preview) is supported — returns the PlanNode that would be generated, no write.'
```

### Task 3: Add test for gen_preview kind=knowledge

```typescript
describe('gen_preview kind=knowledge', () => {
  it('returns a PlanNode without calling store.save', async () => {
    const mockStore = {
      save: vi.fn(async () => {}),
      load: vi.fn(async () => null),
      applyEdit: vi.fn(async () => { throw new Error('not used'); }),
    };
    const tools = makeGenTools({ logPath: ':memory:', dataDir: '/tmp', store: mockStore });
    const model = {
      title: 'Preview node',
      knowledgeKind: 'design-note',
      contract: {
        summary: 'Dry-run preview',
        contentRef: { adapter: 'inline', locator: 'test' },
        cites: [],
        lifecycle: 'draft' as const,
        skin: 'knowledge',
      },
    };
    const result = await tools.gen_preview({ kind: 'knowledge', model });
    expect(result.isError).toBeFalsy();
    const node = JSON.parse(result.content[0].text);
    expect(node.kind).toBe('knowledge.design-note');
    expect(node.parentId).toBeNull(); // root-node default applied
    expect(mockStore.save).not.toHaveBeenCalled(); // preview = no write
  });
});
```

### Task 4: typecheck + tests + commit + PR
