# Foundry SDK Phase 6 — Knowledge Skin Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `createKnowledgeSkin` (already built in `layers/foundry-core`, Phase 3) into
`makeGenTools` so `gen_generate kind=knowledge` produces a valid `PlanNode` artifact.
Add `gen_list_coregen_kinds` for discovery. Zero breaking changes to existing MCP APIs.

**Architecture decision summary (concierge 2026-06-29):**

| Question | Decision |
|----------|----------|
| `foundry_compile_blueprint → planTreeSkin`? | NO — compile targets are specific artifacts, not plan phases; shape mismatch |
| `foundry_generate_from_blueprint → metaSkin`? | NO — queuePush ≠ manifest generation; shape mismatch |
| Knowledge skin in `gen_generate`? | YES — `createKnowledgeSkin` is fully built + exported from foundry-core |
| `CreateKnowledgeNodeFn` source | Local in `domains/foundry` — mirrors the `layers/knowledge` implementation, no cross-layer import |
| CoreFoundry routing for knowledge | Always unconditional (no `useCoreFoundry` flag needed — no file path exists for this kind) |
| Spec passed to `CoreFoundry.execute` | `a.model` (the inner knowledge spec) — NOT `a` like the code skin (code skin wraps `{ kind, model, claimRef }` as its spec; knowledge skin takes the content directly) |
| Option C (`CodePersistFn`) | DEFER — current bridge is clean; no concrete consumer |
| `gen_describe_schema` for knowledge | Leave as-is (file-kinds only); `gen_list_coregen_kinds` is the discovery surface |
| `GENERATION_KINDS` change | NO — stays file-only; knowledge is CoreFoundry-native |
| Blast radius | `domains/foundry` only — 1 new file + 1 edit to `gen-tools.ts` |
| Breaking changes | None — existing kinds and APIs unchanged |

**Tech stack:** TypeScript 5.x, Vitest 2.x, Node.js ESM (`moduleResolution: NodeNext`).

**Branch:** `feat/foundry-phase6-knowledge-skin` branched from `main` in `domains/foundry`.

---

## Global Constraints

- All relative imports **must end in `.js`** (ESM, NodeNext) — never `.ts`
- **Zero breaking changes** to all existing MCP tool APIs
- `GENERATION_KINDS` remains file-kind-only — `'knowledge'` is NOT added there
- `gen_list_kinds` is unchanged — it returns file kinds only
- `gen_describe_schema` is unchanged — it only handles file kinds
- `gen_generate kind=knowledge` always uses `CoreFoundry` — no `useCoreFoundry` flag check
- Local `createKnowledgeNodeFn` in `domains/foundry` must NOT import from `@de-braighter/knowledge`
  (that package is private/no-dist/incompatible from here — use `KnowledgeContractLite` from `@de-braighter/foundry-core`)
- Working directory for all commands: `D:/development/projects/de-braighter/domains/foundry`

---

## Key Types

### `PlanNode` (from `@de-braighter/substrate-contracts/plan-tree`)

```typescript
{
  id: string;          // uuid
  parentId: string | null;   // uuid or null
  treeRootId: string;  // uuid
  kind: string;        // e.g. "knowledge.adr"
  kindRef: string;     // e.g. "knowledge:adr"
  ordinal: number;
  metadata: Record<string, unknown>;  // title + knowledge go here
  childrenIds: readonly string[];
  effectDeclarations?: EffectDeclaration[];
}
```

### `KnowledgeSkinSpec` (from `@de-braighter/foundry-core`)

```typescript
{
  title: string;
  knowledgeKind: string;      // bare kind, e.g. "adr" → kind="knowledge.adr"
  contract: KnowledgeContractLite;
  parentId?: string | null;   // uuid or null
  treeRootId?: string;        // uuid
}
```

### `KnowledgeContractLite` (from `@de-braighter/foundry-core`)

```typescript
{
  summary: string;
  contentRef: { adapter: string; locator: string };
  cites: unknown[];
  lifecycle: 'draft' | 'active' | 'superseded' | 'archived';
  skin: string;
  embeddingRef?: string;
}
```

### `CreateKnowledgeNodeFn` (from `@de-braighter/foundry-core`)

```typescript
type CreateKnowledgeNodeFn = (params: {
  id: string;
  parentId: string | null;
  treeRootId: string;
  ordinal: number;
  knowledgeKind: string;
  title: string;
  contract: KnowledgeContractLite;
  childrenIds?: readonly string[];
}) => PlanNode;
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/generation/knowledge-node.ts` | **Create** | Local `CreateKnowledgeNodeFn` impl — builds a `PlanNode` with `kind="knowledge.<slug>"`, `kindRef="knowledge:<slug>"`, `metadata.title`, `metadata.knowledge` |
| `src/generation/knowledge-node.spec.ts` | **Create** | Unit tests for the local fn |
| `src/mcp/gen-tools.ts` | **Modify** | Add `kind=knowledge` branch in `gen_generate`; add `gen_list_coregen_kinds` tool |
| `src/mcp/gen-tools.spec.ts` | **Modify** | Add test for knowledge routing + `gen_list_coregen_kinds` |

---

## Task 1: Create `src/generation/knowledge-node.ts` + unit tests

**Goal:** Local `CreateKnowledgeNodeFn` implementation that mirrors `layers/knowledge/src/knowledge-node.ts`
without importing from the private `@de-braighter/knowledge` package.

- [ ] **Step 1: Read the following files first**

  - `src/generation/kinds.ts` — understand the GenerationKind pattern
  - `node_modules/@de-braighter/foundry-core/dist/index.d.ts` or the source at
    `layers/foundry-core/src/skins/knowledge-skin.ts` — confirm exact types

- [ ] **Step 2: Create `src/generation/knowledge-node.ts`**

  ```typescript
  import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
  import type { CreateKnowledgeNodeFn } from '@de-braighter/foundry-core';

  /**
   * Local `CreateKnowledgeNodeFn` implementation.
   *
   * Mirrors `layers/knowledge/src/knowledge-node.ts` without importing the
   * private `@de-braighter/knowledge` package (no-dist from here).
   *
   * Convention (from knowledge layer spec §3):
   *   - kind = "knowledge.<knowledgeKind>" (e.g. "knowledge.adr")
   *   - kindRef = "knowledge:<knowledgeKind>" (e.g. "knowledge:adr")
   *   - metadata.title = display title (kernel-aligned denorm key)
   *   - metadata.knowledge = the typed KnowledgeContractLite contract
   */
  export const createKnowledgeNodeFn: CreateKnowledgeNodeFn = (params) => {
    const node: PlanNode = {
      id: params.id,
      parentId: params.parentId,
      treeRootId: params.treeRootId,
      ordinal: params.ordinal,
      kind: `knowledge.${params.knowledgeKind}`,
      kindRef: `knowledge:${params.knowledgeKind}`,
      metadata: {
        title: params.title,
        knowledge: params.contract,
      },
      childrenIds: params.childrenIds ?? [],
    };
    return node;
  };
  ```

- [ ] **Step 3: Create `src/generation/knowledge-node.spec.ts`**

  Tests:
  1. Sets `kind` to `"knowledge.<knowledgeKind>"`
  2. Sets `kindRef` to `"knowledge:<knowledgeKind>"`
  3. Sets `metadata.title` to the params title
  4. Sets `metadata.knowledge` to the params contract
  5. Sets `childrenIds` to empty array when `childrenIds` is absent from params
  6. Preserves `parentId: null` for root nodes
  7. Passes with a non-null `parentId`

  Use a minimal valid `KnowledgeContractLite` fixture:
  ```typescript
  const contract = {
    summary: 'Test summary',
    contentRef: { adapter: 'inline', locator: 'test-locator' },
    cites: [],
    lifecycle: 'draft' as const,
    skin: 'knowledge',
  };
  ```

- [ ] **Step 4: Run tests**

  ```bash
  npx vitest run src/generation/knowledge-node.spec.ts
  ```

  Expected: 7/7 pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/generation/knowledge-node.ts src/generation/knowledge-node.spec.ts
  git commit -m "feat(phase6-s1): local CreateKnowledgeNodeFn impl — mirrors knowledge layer without @de-braighter/knowledge import"
  ```

---

## Task 2: Update `makeGenTools` — knowledge routing + `gen_list_coregen_kinds`

**Goal:** Route `gen_generate kind=knowledge` through `CoreFoundry.execute('knowledge', a.model, ctx)`.
Add `gen_list_coregen_kinds` for discovery. Zero changes to existing tools.

- [ ] **Step 1: Read `src/mcp/gen-tools.ts`** (full) to understand current structure

- [ ] **Step 2: Update `src/mcp/gen-tools.ts`**

  Add imports at the top:
  ```typescript
  import { CoreFoundry, createCodeSkin, createKnowledgeSkin, type FoundryContext } from '@de-braighter/foundry-core';
  import { createKnowledgeNodeFn } from '../generation/knowledge-node.js';
  ```
  (Add `createKnowledgeSkin` to the existing `@de-braighter/foundry-core` import line.)

  Update `GenToolDeps` — no change needed (knowledge doesn't use `useCoreFoundry` flag).

  Update `gen_generate` to handle `kind=knowledge` **before** the `useCoreFoundry` check:
  ```typescript
  gen_generate: guard(async (a: { kind: string; model: unknown; claimRef: string }) => {
    // Knowledge kind always routes through CoreFoundry (no file-persist path exists)
    if (a.kind === 'knowledge') {
      const callFoundry = new CoreFoundry();
      callFoundry.register(createKnowledgeSkin(createKnowledgeNodeFn));
      return callFoundry.execute('knowledge', a.model, makeSyntheticCtx(deps));
    }
    if (deps.useCoreFoundry === true) {
      // ... existing code-skin path (unchanged) ...
    }
    return sdk.generate(...);
  }),
  ```

  Add `gen_list_coregen_kinds` to the returned object:
  ```typescript
  gen_list_coregen_kinds: guard((_a: Record<string, never>) => [
    {
      kind: 'knowledge',
      specSchema: 'KnowledgeSkinSpec',
      returns: 'PlanNode',
      description: 'Creates a kernel-shaped PlanNode with metadata.knowledge + metadata.title. Pass model as KnowledgeSkinSpec: { title, knowledgeKind, contract, parentId?, treeRootId? }.',
    },
  ]),
  ```

  Also register `gen_list_coregen_kinds` in the MCP server tool list (wherever the server
  registers each key from `makeGenTools` — likely `src/server.ts` or `src/mcp/server.ts`).

- [ ] **Step 3: Find and update the MCP server tool registration**

  Grep for where `makeGenTools` keys are registered in the server — look for `gen_generate`
  being listed. Add `gen_list_coregen_kinds` with the same tool-registration pattern.

  The description for the MCP tool registration:
  ```
  "List CoreFoundry-native generation kinds (e.g. knowledge). These kinds return structured artifacts (PlanNode, etc.) rather than files. Use gen_generate with one of these kinds and pass the kind-specific spec as `model`."
  ```

- [ ] **Step 4: Run typecheck**

  ```bash
  npm run typecheck
  ```

  Expected: `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

  ```bash
  git add src/generation/knowledge-node.ts src/mcp/gen-tools.ts src/server.ts  # (or whatever server file changed)
  git commit -m "feat(phase6-s2): gen_generate kind=knowledge routes through CoreFoundry; add gen_list_coregen_kinds"
  ```

---

## Task 3: Tests for knowledge routing and `gen_list_coregen_kinds`

**Goal:** Verify `gen_generate kind=knowledge` returns a valid `PlanNode` JSON, and
`gen_list_coregen_kinds` returns the expected list.

- [ ] **Step 1: Read `src/mcp/gen-tools.spec.ts`** to understand the current test patterns

- [ ] **Step 2: Add tests to `src/mcp/gen-tools.spec.ts`**

  Add two describe blocks:

  **`gen_list_coregen_kinds`:**
  ```typescript
  describe('gen_list_coregen_kinds', () => {
    it('returns a list containing the knowledge kind', async () => {
      const result = await tools.gen_list_coregen_kinds({});
      expect(result.isError).toBeFalsy();
      const kinds = JSON.parse(result.content[0].text);
      expect(Array.isArray(kinds)).toBe(true);
      expect(kinds.find((k) => k.kind === 'knowledge')).toBeDefined();
    });
  });
  ```

  **`gen_generate kind=knowledge`:**
  ```typescript
  describe('gen_generate kind=knowledge', () => {
    it('returns a PlanNode artifact with correct kind, kindRef, and metadata', async () => {
      const model = {
        title: 'Phase 6 test node',
        knowledgeKind: 'design-note',
        contract: {
          summary: 'A test design note',
          contentRef: { adapter: 'inline', locator: 'test' },
          cites: [],
          lifecycle: 'draft',
          skin: 'knowledge',
        },
      };
      const result = await tools.gen_generate({ kind: 'knowledge', model, claimRef: 'test-claim' });
      expect(result.isError).toBeFalsy();
      const node = JSON.parse(result.content[0].text);
      expect(node.kind).toBe('knowledge.design-note');
      expect(node.kindRef).toBe('knowledge:design-note');
      expect(node.metadata.title).toBe('Phase 6 test node');
      expect(node.metadata.knowledge.summary).toBe('A test design note');
      expect(typeof node.id).toBe('string');
    });

    it('returns an error for invalid knowledge spec', async () => {
      const result = await tools.gen_generate({ kind: 'knowledge', model: { invalid: true }, claimRef: 'test' });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/ERROR/);
    });
  });
  ```

- [ ] **Step 3: Run the new tests**

  ```bash
  npx vitest run src/mcp/gen-tools.spec.ts
  ```

  Expected: all existing tests pass + new knowledge tests pass.

- [ ] **Step 4: Full CI**

  ```bash
  npm run typecheck && npm run test
  ```

  Expected: all tests pass, `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

  ```bash
  git add src/mcp/gen-tools.spec.ts
  git commit -m "test(phase6-s3): gen_generate kind=knowledge + gen_list_coregen_kinds coverage"
  ```

---

## Self-Review Checklist

### Spec coverage
- [ ] `src/generation/knowledge-node.ts` — local `CreateKnowledgeNodeFn` with correct kind/kindRef/metadata pattern
- [ ] `src/generation/knowledge-node.spec.ts` — 7 unit tests
- [ ] `gen_generate kind=knowledge` routes through `CoreFoundry.execute('knowledge', a.model, ctx)` — NOT `a`
- [ ] `gen_generate kind=knowledge` does NOT check `useCoreFoundry` flag (unconditional CoreFoundry path)
- [ ] No `@de-braighter/knowledge` import anywhere in `domains/foundry`
- [ ] `gen_list_coregen_kinds` registered in the MCP server
- [ ] `GENERATION_KINDS` unchanged — `knowledge` not added
- [ ] `gen_list_kinds` unchanged
- [ ] `gen_describe_schema` unchanged
- [ ] All existing tests pass (1155+)
- [ ] `npm run typecheck` clean

### What is NOT in Phase 6

| Item | Reason | Phase |
|------|---------|-------|
| `foundry_compile_blueprint → planTreeSkin` | Operation shape mismatch — compile targets ≠ plan phases | Dropped |
| `foundry_generate_from_blueprint → metaSkin` | Operation shape mismatch — queuePush ≠ manifest generation | Dropped |
| Knowledge PlanNode persistence to substrate DB | Needs SubstrateClient + tenantPackId | Phase 7+ |
| `gen_describe_schema kind=knowledge` | Discovery via `gen_list_coregen_kinds`; schema is in foundry-core | Phase 7+ |
| `gen_preview kind=knowledge` | Ephemeral — PlanNode has no meaningful preview format | Phase 7+ |
| Option C (`CodePersistFn` in foundry-core) | No concrete consumer yet | Deferred |
