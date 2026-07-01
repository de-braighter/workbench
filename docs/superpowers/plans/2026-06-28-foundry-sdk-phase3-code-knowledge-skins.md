# Foundry SDK Phase 3 — Code Skin + Knowledge Skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two injectable-port skins to `@de-braighter/foundry-core` — `createCodeSkin(genFn)` wrapping the gen_* generation surface, and `createKnowledgeSkin(createNodeFn)` wrapping the knowledge-node factory — without adding any new package dependencies.

**Architecture:**
Both skins use the factory/injectable-port pattern established by `createCodeSkin`: the caller supplies a runtime function (`genFn` or `createNodeFn`) and receives a `FoundryManifest<TSpec, TArtifact>`. This keeps `@de-braighter/foundry-core` dependency-free from `@de-braighter/knowledge` (which is `private: true`, has no `exports` field, no dist, uses `moduleResolution: NodeNext` incompatible with its package.json — it cannot be imported from foundry-core). Neither new skin goes into `SKIN_TEMPLATES` (both require runtime injection). `SKIN_TEMPLATES` stays closed at `['plan-tree']`; a JSDoc comment on `metaSkin` documents the two registration patterns.

**Tech Stack:** TypeScript 5.x, Zod 3.x, Vitest 2.x, Node.js ESM (`moduleResolution: NodeNext`).

## Global Constraints

- All relative imports **must end in `.js`** (ESM, NodeNext resolution) — never `.ts`
- All PlanNodes produced by `generate()` **must parse against `PlanNodeSchema`** from `@de-braighter/substrate-contracts/plan-tree`
- Skins are **pure TypeScript** — zero NestJS, zero Prisma, zero MCP deps inside `layers/foundry-core`
- **No new dependencies** added to `package.json` — both skins use only already-installed packages (`zod`, `node:crypto`, `@de-braighter/substrate-contracts`)
- Branch: **`feat/foundry-core-phase3`** branched from `main` in `layers/foundry-core`
- Working directory for all commands: `D:/development/projects/de-braighter/layers/foundry-core`
- Tests use `vitest` globals (`describe`, `it`, `expect`, `vi`, `beforeEach`) — no imports needed for those
- **Test count baseline**: 52 tests before Phase 3 starts; plan adds 16 → target 68 green

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/skins/code-skin.ts` | **Create** | `CodeGenFn` type + `CodeSkinSpec` schema + `CodeArtifact` schema + `createCodeSkin(genFn)` factory |
| `src/skins/code-skin.spec.ts` | **Create** | 6 unit tests for `createCodeSkin` |
| `src/skins/knowledge-skin.ts` | **Create** | `KnowledgeContractLite` shape + `KnowledgeSkinSpec` schema + `CreateKnowledgeNodeFn` type + `createKnowledgeSkin(createNodeFn)` factory |
| `src/skins/knowledge-skin.spec.ts` | **Create** | 6 unit tests for `createKnowledgeSkin` |
| `src/skins/meta-skin.ts` | **Modify** | Add JSDoc comment above `metaSkin` documenting the two registration patterns |
| `src/e2e-phase3.spec.ts` | **Create** | 4 e2e integration tests — code + knowledge skins in a live `CoreFoundry` registry |
| `src/index.ts` | **Modify** | Barrel exports for code skin + knowledge skin |

---

### Task 1: Code Skin

**Files:**
- Create: `src/skins/code-skin.ts`
- Create: `src/skins/code-skin.spec.ts`

**Interfaces:**
- Consumes: `stampArtifact` from `../foundry-manifest.js`; `PlanNode` type from `@de-braighter/substrate-contracts/plan-tree`; `FoundryManifest`, `FoundryContext` from `../foundry-manifest.js`
- Produces: `CodeGenFn`, `CodeArtifact`, `CodeArtifactSchema`, `CodeSkinSpec`, `CodeSkinSpecSchema`, `createCodeSkin`

- [ ] **Step 1: Write the failing tests**

Create `src/skins/code-skin.spec.ts`:

```ts
import { z } from 'zod';
import { readFoundryArtifactMeta } from '../foundry-manifest.js';
import { createCodeSkin, CodeSkinSpecSchema } from './code-skin.js';
import type { CodeGenFn, CodeArtifact } from './code-skin.js';
import type { FoundryContext } from '../foundry-manifest.js';

const ROOT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const RUN_ID  = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

const ctx: FoundryContext = {
  tenantPackId: 'tenant-1',
  parentNodeId: ROOT_ID,
  runId: RUN_ID,
};

const stubArtifact: CodeArtifact = {
  runId: 'gen-run-1',
  kind: 'angular-feature',
  files: [{ path: 'src/foo.ts', bytes: 100 }],
  reproducible: true,
};

describe('createCodeSkin', () => {
  it('returned manifest has kind "code"', () => {
    const skin = createCodeSkin(vi.fn(async () => stubArtifact));
    expect(skin.kind).toBe('code');
  });

  it('specSchema rejects spec missing claimRef', () => {
    expect(() =>
      CodeSkinSpecSchema.parse({ kind: 'angular-feature', model: {} }),
    ).toThrow(z.ZodError);
  });

  it('specSchema accepts valid spec', () => {
    expect(() =>
      CodeSkinSpecSchema.parse({ kind: 'angular-feature', model: { name: 'Foo' }, claimRef: 'feat/x' }),
    ).not.toThrow();
  });

  it('generate calls genFn with correct arguments', async () => {
    const genFn: CodeGenFn = vi.fn(async () => stubArtifact);
    const skin = createCodeSkin(genFn);
    await skin.generate({ kind: 'angular-feature', model: { name: 'Foo' }, claimRef: 'feat/x' }, ctx);
    expect(genFn).toHaveBeenCalledWith({
      kind: 'angular-feature',
      model: { name: 'Foo' },
      claimRef: 'feat/x',
    });
  });

  it('generate returns the CodeArtifact from genFn', async () => {
    const skin = createCodeSkin(vi.fn(async () => stubArtifact));
    const result = await skin.generate(
      { kind: 'angular-feature', model: {}, claimRef: 'feat/x' },
      ctx,
    );
    expect(result).toBe(stubArtifact);
  });

  it('persist stamps artifact node with foundry.artifact (manifestKind="code")', async () => {
    const skin = createCodeSkin(vi.fn(async () => stubArtifact));
    const node = await skin.persist(stubArtifact, ctx);
    const meta = readFoundryArtifactMeta(node);
    expect(meta).not.toBeNull();
    expect(meta!.manifestKind).toBe('code');
    expect(meta!.runNodeId).toBe(RUN_ID);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd D:/development/projects/de-braighter/layers/foundry-core
pnpm vitest run src/skins/code-skin.spec.ts
```

Expected: FAIL — `Cannot find module './code-skin.js'`

- [ ] **Step 3: Write the implementation**

Create `src/skins/code-skin.ts`:

```ts
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import type { FoundryManifest, FoundryContext } from '../foundry-manifest.js';
import { stampArtifact } from '../foundry-manifest.js';

export const CodeGenFileSchema = z.object({
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
});
export type CodeGenFile = z.infer<typeof CodeGenFileSchema>;

export const CodeArtifactSchema = z.object({
  runId: z.string().min(1),
  kind: z.string().min(1),
  files: z.array(CodeGenFileSchema),
  reproducible: z.boolean(),
  modelHash: z.string().optional(),
});
export type CodeArtifact = z.infer<typeof CodeArtifactSchema>;

export const CodeSkinSpecSchema = z.object({
  kind: z.string().min(1),
  model: z.unknown(),
  claimRef: z.string().min(1),
});
export type CodeSkinSpec = z.infer<typeof CodeSkinSpecSchema>;

/** Injectable port — caller supplies the code-generation function. */
export type CodeGenFn = (input: {
  kind: string;
  model: unknown;
  claimRef: string;
}) => Promise<CodeArtifact>;

export function createCodeSkin(genFn: CodeGenFn): FoundryManifest<CodeSkinSpec, CodeArtifact> {
  return {
    kind: 'code',
    specSchema: CodeSkinSpecSchema,

    async generate(spec: CodeSkinSpec, _ctx: FoundryContext): Promise<CodeArtifact> {
      return genFn({ kind: spec.kind, model: spec.model, claimRef: spec.claimRef });
    },

    async persist(artifact: CodeArtifact, ctx: FoundryContext): Promise<PlanNode> {
      const id = randomUUID();
      const node: PlanNode = {
        id,
        parentId: ctx.parentNodeId,
        treeRootId: ctx.parentNodeId,
        kind: 'code-artifact',
        kindRef: 'code-artifact',
        ordinal: 0,
        metadata: {
          'code.runId': artifact.runId,
          'code.kind': artifact.kind,
          'code.files': artifact.files,
          'code.reproducible': artifact.reproducible,
        },
        childrenIds: [],
      };
      return stampArtifact(node, 'code', ctx.runId);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/skins/code-skin.spec.ts
```

Expected: 6/6 PASS.

- [ ] **Step 5: Run full suite to verify no regressions**

```bash
pnpm run ci:local
```

Expected: 58 tests PASS (52 existing + 6 new), `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/skins/code-skin.ts src/skins/code-skin.spec.ts
git commit -m "feat: code skin — createCodeSkin(genFn) injectable port factory"
```

---

### Task 2: Knowledge Skin

**Files:**
- Create: `src/skins/knowledge-skin.ts`
- Create: `src/skins/knowledge-skin.spec.ts`

**Interfaces:**
- Consumes: `stampArtifact` from `../foundry-manifest.js`; `PlanNode` type from `@de-braighter/substrate-contracts/plan-tree`; `FoundryManifest`, `FoundryContext` from `../foundry-manifest.js`
- Produces: `KnowledgeContractLiteSchema`, `KnowledgeContractLite`, `KnowledgeSkinSpecSchema`, `KnowledgeSkinSpec`, `CreateKnowledgeNodeFn`, `createKnowledgeSkin`

**Why `KnowledgeContractLite`?** `@de-braighter/knowledge` is `private: true`, has no `exports` field, no `dist/`, and `postinstall: prisma generate` — it cannot be imported from foundry-core under `moduleResolution: NodeNext`. Foundry-core defines the minimal contract shape locally. The shape is structurally identical to `KnowledgeContractSchema` in `@de-braighter/knowledge` (structural typing means callers who pass a real `KnowledgeContract` from that package satisfy `KnowledgeContractLite` automatically).

- [ ] **Step 1: Write the failing tests**

Create `src/skins/knowledge-skin.spec.ts`:

```ts
import { z } from 'zod';
import { readFoundryArtifactMeta } from '../foundry-manifest.js';
import { createKnowledgeSkin, KnowledgeSkinSpecSchema } from './knowledge-skin.js';
import type { CreateKnowledgeNodeFn } from './knowledge-skin.js';
import type { FoundryContext } from '../foundry-manifest.js';

const ROOT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const RUN_ID  = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

const ctx: FoundryContext = {
  tenantPackId: 'tenant-1',
  parentNodeId: ROOT_ID,
  runId: RUN_ID,
};

const validContract = {
  summary: 'A test knowledge node',
  contentRef: { adapter: 'file', locator: 'docs/test.md' },
  cites: [] as unknown[],
  lifecycle: 'draft' as const,
  skin: 'adr',
};

const validSpec = {
  title: 'Test ADR',
  knowledgeKind: 'adr',
  contract: validContract,
};

const stubCreateNode: CreateKnowledgeNodeFn = vi.fn((params) => ({
  id: params.id,
  parentId: params.parentId,
  treeRootId: params.treeRootId,
  ordinal: params.ordinal,
  kind: `knowledge.${params.knowledgeKind}`,
  kindRef: `knowledge:${params.knowledgeKind}`,
  metadata: { title: params.title, knowledge: params.contract },
  childrenIds: params.childrenIds ?? [],
}));

describe('createKnowledgeSkin', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returned manifest has kind "knowledge"', () => {
    const skin = createKnowledgeSkin(stubCreateNode);
    expect(skin.kind).toBe('knowledge');
  });

  it('specSchema rejects spec missing title', () => {
    expect(() =>
      KnowledgeSkinSpecSchema.parse({ knowledgeKind: 'adr', contract: validContract }),
    ).toThrow(z.ZodError);
  });

  it('specSchema accepts valid spec', () => {
    expect(() => KnowledgeSkinSpecSchema.parse(validSpec)).not.toThrow();
  });

  it('generate calls createNodeFn with title + knowledgeKind from spec', async () => {
    const skin = createKnowledgeSkin(stubCreateNode);
    await skin.generate(validSpec, ctx);
    expect(stubCreateNode).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Test ADR', knowledgeKind: 'adr' }),
    );
  });

  it('generate returns a PlanNode with kind "knowledge.adr"', async () => {
    const skin = createKnowledgeSkin(stubCreateNode);
    const result = await skin.generate(validSpec, ctx);
    expect(result.kind).toBe('knowledge.adr');
  });

  it('persist stamps node with foundry.artifact (manifestKind="knowledge")', async () => {
    const skin = createKnowledgeSkin(stubCreateNode);
    const generated = await skin.generate(validSpec, ctx);
    const persisted = await skin.persist(generated, ctx);
    const meta = readFoundryArtifactMeta(persisted);
    expect(meta).not.toBeNull();
    expect(meta!.manifestKind).toBe('knowledge');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm vitest run src/skins/knowledge-skin.spec.ts
```

Expected: FAIL — `Cannot find module './knowledge-skin.js'`

- [ ] **Step 3: Write the implementation**

Create `src/skins/knowledge-skin.ts`:

```ts
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import type { FoundryManifest, FoundryContext } from '../foundry-manifest.js';
import { stampArtifact } from '../foundry-manifest.js';

/**
 * Minimal contract shape — mirrors `KnowledgeContractSchema` from
 * `@de-braighter/knowledge` without creating a cross-layer import
 * (that package is private/no-dist/NodeNext-incompatible from here).
 * Callers who pass a real `KnowledgeContract` satisfy this structurally.
 */
export const KnowledgeContractLiteSchema = z.object({
  summary: z.string().min(1),
  contentRef: z.object({
    adapter: z.string().min(1),
    locator: z.string().min(1),
  }),
  cites: z.array(z.unknown()).default([]),
  lifecycle: z.enum(['draft', 'active', 'superseded', 'archived']),
  skin: z.string().min(1),
  embeddingRef: z.string().optional(),
});
export type KnowledgeContractLite = z.infer<typeof KnowledgeContractLiteSchema>;

export const KnowledgeSkinSpecSchema = z.object({
  title: z.string().min(1),
  knowledgeKind: z.string().min(1),
  contract: KnowledgeContractLiteSchema,
  parentId: z.string().uuid().nullable().optional(),
  treeRootId: z.string().uuid().optional(),
});
export type KnowledgeSkinSpec = z.infer<typeof KnowledgeSkinSpecSchema>;

/** Injectable port — mirrors `createKnowledgeNode` signature from `@de-braighter/knowledge`. */
export type CreateKnowledgeNodeFn = (params: {
  id: string;
  parentId: string | null;
  treeRootId: string;
  ordinal: number;
  knowledgeKind: string;
  title: string;
  contract: KnowledgeContractLite;
  childrenIds?: readonly string[];
}) => PlanNode;

export function createKnowledgeSkin(
  createNodeFn: CreateKnowledgeNodeFn,
): FoundryManifest<KnowledgeSkinSpec, PlanNode> {
  return {
    kind: 'knowledge',
    specSchema: KnowledgeSkinSpecSchema,

    async generate(spec: KnowledgeSkinSpec, ctx: FoundryContext): Promise<PlanNode> {
      const id = randomUUID();
      const parentId = spec.parentId ?? ctx.parentNodeId;
      const treeRootId = spec.treeRootId ?? ctx.parentNodeId;
      return createNodeFn({
        id,
        parentId,
        treeRootId,
        ordinal: 0,
        knowledgeKind: spec.knowledgeKind,
        title: spec.title,
        contract: spec.contract,
      });
    },

    async persist(artifact: PlanNode, ctx: FoundryContext): Promise<PlanNode> {
      return stampArtifact(artifact, 'knowledge', ctx.runId);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run src/skins/knowledge-skin.spec.ts
```

Expected: 6/6 PASS.

- [ ] **Step 5: Run full suite to verify no regressions**

```bash
pnpm run ci:local
```

Expected: 64 tests PASS (58 after Task 1 + 6 new), `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/skins/knowledge-skin.ts src/skins/knowledge-skin.spec.ts
git commit -m "feat: knowledge skin — createKnowledgeSkin(createNodeFn) injectable port factory"
```

---

### Task 3: Barrel + meta-skin JSDoc + e2e + push

**Files:**
- Modify: `src/skins/meta-skin.ts` (JSDoc on `metaSkin` export)
- Modify: `src/index.ts` (barrel exports for code + knowledge skins)
- Create: `src/e2e-phase3.spec.ts`

**Interfaces:**
- Consumes: everything already in `src/skins/code-skin.ts` + `src/skins/knowledge-skin.ts` from Tasks 1 + 2

- [ ] **Step 1: Update the meta-skin JSDoc**

Open `src/skins/meta-skin.ts`. Replace the `export const metaSkin` declaration with:

```ts
/**
 * The meta-foundry skin — generates descriptor `PlanNode`s for other skins.
 *
 * **Registration patterns:**
 * - **Template skins** (`SKIN_TEMPLATES`) — pure const skins that need no runtime
 *   injection (currently: `plan-tree`). `execute('meta', { kind })` generates their
 *   descriptor; `registerFromNode(descriptor, skin)` activates them.
 * - **Injectable skins** — require a runtime-injected dependency function. Register
 *   them directly: `foundry.register(createCodeSkin(genFn))` or
 *   `foundry.register(createKnowledgeSkin(createNodeFn))`. They bypass `meta`
 *   discovery intentionally and do not appear in `SKIN_TEMPLATES`.
 */
export const metaSkin: FoundryManifest<MetaSkinSpec, FoundryManifest<unknown, unknown>> = {
```

(Keep the rest of the function body unchanged.)

- [ ] **Step 2: Add barrel exports**

Open `src/index.ts` and append the following lines after the existing `// Built-in skins` block:

```ts
// Injectable skin factories
export { createCodeSkin, CodeSkinSpecSchema, CodeArtifactSchema, CodeGenFileSchema } from './skins/code-skin.js';
export type { CodeSkinSpec, CodeArtifact, CodeGenFile, CodeGenFn } from './skins/code-skin.js';

export { createKnowledgeSkin, KnowledgeSkinSpecSchema, KnowledgeContractLiteSchema } from './skins/knowledge-skin.js';
export type { KnowledgeSkinSpec, KnowledgeContractLite, CreateKnowledgeNodeFn } from './skins/knowledge-skin.js';
```

- [ ] **Step 3: Write the failing e2e tests**

Create `src/e2e-phase3.spec.ts`:

```ts
import { PlanNodeSchema } from '@de-braighter/substrate-contracts/plan-tree';
import { CoreFoundry } from './core-foundry.js';
import { readFoundryArtifactMeta } from './foundry-manifest.js';
import { metaSkin } from './skins/meta-skin.js';
import { createCodeSkin } from './skins/code-skin.js';
import { createKnowledgeSkin } from './skins/knowledge-skin.js';
import type { CodeGenFn, CodeArtifact } from './skins/code-skin.js';
import type { CreateKnowledgeNodeFn } from './skins/knowledge-skin.js';
import type { FoundryContext } from './foundry-manifest.js';

const ROOT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const RUN_ID  = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

const ctx: FoundryContext = {
  tenantPackId: 'tenant-1',
  parentNodeId: ROOT_ID,
  runId: RUN_ID,
};

const stubCodeArtifact: CodeArtifact = {
  runId: 'gen-run-1',
  kind: 'angular-feature',
  files: [{ path: 'src/foo.ts', bytes: 200 }],
  reproducible: true,
};

const stubGenFn: CodeGenFn = vi.fn(async () => stubCodeArtifact);

const stubCreateKnowledgeNode: CreateKnowledgeNodeFn = (params) => ({
  id: params.id,
  parentId: params.parentId,
  treeRootId: params.treeRootId,
  ordinal: params.ordinal,
  kind: `knowledge.${params.knowledgeKind}`,
  kindRef: `knowledge:${params.knowledgeKind}`,
  metadata: { title: params.title, knowledge: params.contract },
  childrenIds: params.childrenIds ?? [],
});

describe('Phase 3 e2e', () => {
  it('code skin: register directly + execute returns artifact node (manifestKind="code")', async () => {
    const foundry = new CoreFoundry()
      .register(metaSkin)
      .register(createCodeSkin(stubGenFn));
    const node = await foundry.execute(
      'code',
      { kind: 'angular-feature', model: { name: 'MyFeature' }, claimRef: 'feat/my-feature' },
      ctx,
    );
    const meta = readFoundryArtifactMeta(node);
    expect(meta).not.toBeNull();
    expect(meta!.manifestKind).toBe('code');
  });

  it('knowledge skin: register directly + execute returns artifact node (manifestKind="knowledge")', async () => {
    const foundry = new CoreFoundry()
      .register(createKnowledgeSkin(stubCreateKnowledgeNode));
    const node = await foundry.execute(
      'knowledge',
      {
        title: 'Test ADR',
        knowledgeKind: 'adr',
        contract: {
          summary: 'A design decision',
          contentRef: { adapter: 'file', locator: 'layers/specs/adr/adr-999.md' },
          cites: [],
          lifecycle: 'draft',
          skin: 'adr',
        },
      },
      ctx,
    );
    const meta = readFoundryArtifactMeta(node);
    expect(meta).not.toBeNull();
    expect(meta!.manifestKind).toBe('knowledge');
  });

  it('knowledge skin: PlanNodeSchema.parse succeeds on output (kernel schema gate)', async () => {
    const foundry = new CoreFoundry()
      .register(createKnowledgeSkin(stubCreateKnowledgeNode));
    const node = await foundry.execute(
      'knowledge',
      {
        title: 'Schema Gate',
        knowledgeKind: 'concept',
        contract: {
          summary: 'Concept node test',
          contentRef: { adapter: 'file', locator: 'docs/concept.md' },
          cites: [],
          lifecycle: 'draft',
          skin: 'concept',
        },
      },
      ctx,
    );
    expect(() => PlanNodeSchema.parse(node)).not.toThrow();
  });

  it('code + knowledge skins coexist in one foundry registry', async () => {
    const foundry = new CoreFoundry()
      .register(metaSkin)
      .register(createCodeSkin(stubGenFn))
      .register(createKnowledgeSkin(stubCreateKnowledgeNode));

    const codeNode = await foundry.execute(
      'code',
      { kind: 'service-method', model: {}, claimRef: 'feat/svc' },
      ctx,
    );
    const knowledgeNode = await foundry.execute(
      'knowledge',
      {
        title: 'Service Doc',
        knowledgeKind: 'concept',
        contract: {
          summary: 'Documents the service',
          contentRef: { adapter: 'file', locator: 'docs/service.md' },
          cites: [],
          lifecycle: 'draft',
          skin: 'concept',
        },
      },
      ctx,
    );

    expect(readFoundryArtifactMeta(codeNode)!.manifestKind).toBe('code');
    expect(readFoundryArtifactMeta(knowledgeNode)!.manifestKind).toBe('knowledge');
  });
});
```

- [ ] **Step 4: Run the e2e tests to verify they fail**

```bash
pnpm vitest run src/e2e-phase3.spec.ts
```

Expected: FAIL — `Cannot find module './skins/code-skin.js'` (barrel not yet updated triggers type-check issues, but actual runtime imports work from Task 1/2 source).

Actually: the e2e file imports from the skin files directly (not the barrel), so it should PASS at this point if Tasks 1 and 2 are complete. Run:

```bash
pnpm vitest run src/e2e-phase3.spec.ts
```

Expected: 4/4 PASS (Tasks 1+2 deliverables are live).

- [ ] **Step 5: Run the full ci:local**

```bash
pnpm run ci:local
```

Expected: 68 tests PASS (64 after Task 2 + 4 new), `tsc --noEmit` clean. This validates the barrel additions and JSDoc edit too.

- [ ] **Step 6: Build to verify the publishable dist**

```bash
pnpm run build 2>/dev/null || npx tsc -p tsconfig.build.json
```

Expected: `dist/` produced with no errors. (foundry-core has `tsconfig.build.json` identical to charter-runtime's — `outDir: dist`, excludes specs.)

- [ ] **Step 7: Commit all Task 3 changes**

```bash
git add src/skins/meta-skin.ts src/index.ts src/e2e-phase3.spec.ts
git commit -m "feat: barrel + meta-skin JSDoc + Phase 3 e2e (code + knowledge skins)"
```

- [ ] **Step 8: Push and open PR**

```bash
git push -u origin feat/foundry-core-phase3
gh pr create \
  --repo de-braighter/foundry-core \
  --base main \
  --title "feat(foundry-core): Phase 3 — code skin + knowledge skin (injectable port pattern)" \
  --body "$(cat <<'EOF'
## Summary

- Adds `createCodeSkin(genFn)` — injectable port wrapping the gen_* code-generation surface (`CodeGenFn` type); caller supplies the generator function
- Adds `createKnowledgeSkin(createNodeFn)` — injectable port wrapping the knowledge-node factory (`CreateKnowledgeNodeFn` type + `KnowledgeContractLite` minimal shape); caller supplies `createKnowledgeNode` from `@de-braighter/knowledge`
- Both skins use the same pattern: factory function → `FoundryManifest<TSpec, TArtifact>`; neither goes into `SKIN_TEMPLATES` (injectable = no static registration)
- `metaSkin` JSDoc updated to document both registration patterns (template vs injectable)
- Zero new dependencies — both skins use only `zod` + `node:crypto` + `@de-braighter/substrate-contracts`
- 68 tests green (+16 from 52 baseline)

## Architecture note

`@de-braighter/knowledge` is `private: true`, has no `exports` field, no `dist/`, and carries `postinstall: prisma generate` — it cannot be imported from `layers/foundry-core` under `moduleResolution: NodeNext`. The `KnowledgeContractLite` schema defined here is structurally identical to `KnowledgeContractSchema` in that package; callers pass the real `KnowledgeContract` and TypeScript structural typing satisfies the constraint.

## Test plan

- [ ] `pnpm run ci:local` → 68/68 green, `tsc --noEmit` clean
- [ ] `tsc -p tsconfig.build.json` → `dist/` produced, no errors
- [ ] `createCodeSkin` unit tests (6) cover: kind, schema validation, genFn delegation, persist stamp
- [ ] `createKnowledgeSkin` unit tests (6) cover: kind, schema validation, createNodeFn delegation, persist stamp
- [ ] Phase 3 e2e (4): code skin alone, knowledge skin alone, kernel schema gate, both coexist

Producer: orchestrator/claude-sonnet-4-6 [writing-plans, subagent-driven-development]
Effort: standard
Effect: cycle-time 0.008±0.003 expert
Effect: findings 2±1 expert
EOF
)"
```

- [ ] **Step 9: Report the PR URL**

Print the opened PR URL so the ritual can be run after merge.

---

## Self-Review Checklist

### Spec coverage
- [x] Code skin factory + types → Task 1
- [x] Knowledge skin factory + types + `KnowledgeContractLite` → Task 2
- [x] SKIN_TEMPLATES stays closed (no changes — both are injectable) → documented in Task 3 JSDoc
- [x] meta-skin JSDoc update → Task 3 Step 1
- [x] Barrel exports → Task 3 Step 2
- [x] e2e: code skin coexists with knowledge skin → Task 3 e2e test 4
- [x] Kernel schema gate (PlanNodeSchema.parse) → Task 3 e2e test 3
- [x] No new package.json deps → constraint met (zero deps added)
- [x] Push + PR → Task 3 Steps 8–9

### Type consistency
- `CodeGenFn`, `CodeArtifact`, `CodeSkinSpec` defined in Task 1 → consumed in Task 3 e2e
- `CreateKnowledgeNodeFn`, `KnowledgeContractLite`, `KnowledgeSkinSpec` defined in Task 2 → consumed in Task 3 e2e
- `stubCreateKnowledgeNode` in Task 3 e2e matches `CreateKnowledgeNodeFn` signature exactly (id, parentId, treeRootId, ordinal, knowledgeKind, title, contract, childrenIds)
- `stubCodeArtifact` in Task 3 e2e matches `CodeArtifact` (runId, kind, files, reproducible)

### Placeholder scan
None found.
