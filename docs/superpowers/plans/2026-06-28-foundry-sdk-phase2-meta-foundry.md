# Foundry SDK Phase 2 — Meta-Foundry Skin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the meta-foundry skin so `CoreFoundry` can generate new `FoundryManifest` kinds from structured specs, proven by a full `execute('meta') → registerFromNode → execute('plan-tree')` round-trip.

**Architecture:** The descriptor/executable split resolves the "serialize functions to JSON" paradox — a plan node stores a JSON descriptor (`metadata.foundry.manifest = { kind, version, description }`), and the in-memory registry holds the executable. `CoreFoundry.registerFromNode(node, executable)` bridges the two: it reads the descriptor from metadata and registers the executable by kind. The meta-skin's `generate()` returns an in-memory `FoundryManifest` object from a `SKIN_TEMPLATES` factory; its `persist()` writes the descriptor plan node. The plan-tree skin (`kind='plan-tree'`) is Phase 2's first manifest produced by the meta-foundry.

**Tech Stack:** TypeScript 5.x, ESM (`"type": "module"`), Zod 3.x, Vitest 2.x, `node:crypto` (randomUUID), `@de-braighter/substrate-contracts` (PlanNode)

## Global Constraints

- **ESM**: every relative import ends in `.js` (TypeScript resolves `.js` → `.ts` at compile time)
- **ZERO kernel change**: no file under `layers/substrate/` may be touched. No `@de-braighter/substrate-runtime` in production source. No relative `../../substrate` paths.
- **Boundary**: `foundry-manifest.ts` and `core-foundry.ts` must NOT import `@de-braighter/charter-runtime`. `plan-tree-skin.ts`, `meta-skin.ts`, and `meta-skin-seed.ts` must NOT import `@de-braighter/charter-runtime` (they don't need it).
- **UUIDs**: all `PlanNode` id fields (`id`, `parentId` when non-null, `treeRootId`) must be RFC 4122 UUIDs. Use `crypto.randomUUID()` in production; use named UUID constants in tests.
- **`pnpm ci:local`** (`tsc -p tsconfig.json --noEmit && vitest run`) must pass after every task.
- **`@de-braighter/substrate-contracts` peer dep `^2.7.0`** — import from the published package, not relative.
- **Working directory**: `D:/development/projects/de-braighter/layers/foundry-core/`
- **Branch**: `feat/foundry-core-phase2` (create from `main` before Task 1)
- **Git ops**: only inside `layers/foundry-core/`. Never `git add -A` from the workbench root.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/foundry-manifest.ts` | Modify | Add `FoundryManifestMetaSchema`, `FoundryManifestMeta`, `readFoundryManifestMeta`, `stampManifestDescriptor` |
| `src/foundry-manifest.spec.ts` | Modify | Add 4 tests for new manifest-meta helpers |
| `src/core-foundry.ts` | Modify | Add `registerFromNode(node, executable): this`; import `readFoundryManifestMeta` |
| `src/core-foundry.spec.ts` | Modify | Add 3 tests for `registerFromNode` |
| `src/skins/plan-tree-skin.ts` | Create | `planTreeSkin: FoundryManifest<PlanTreeSkinSpec, PlanNode[]>` |
| `src/skins/plan-tree-skin.spec.ts` | Create | 6 unit tests |
| `src/skins/meta-skin.ts` | Create | `metaSkin: FoundryManifest<MetaSkinSpec, FoundryManifest>` + `SKIN_TEMPLATES` factory |
| `src/skins/meta-skin.spec.ts` | Create | 6 unit tests |
| `src/seeds/meta-skin-seed.ts` | Create | Hand-written descriptor plan node for the meta-skin itself |
| `src/e2e-meta-foundry.spec.ts` | Create | Full round-trip integration test (5 assertions) |
| `src/index.ts` | Modify | Export all new public symbols |

---

### Task 1: `FoundryManifestMeta` + helpers in `foundry-manifest.ts`

**Files:**

- Modify: `src/foundry-manifest.ts`
- Modify: `src/foundry-manifest.spec.ts`

**Interfaces:**

- Produces (consumed by Tasks 2, 4, 5):
  - `FoundryManifestMetaSchema: z.ZodObject<...>`
  - `FoundryManifestMeta: { kind: string; version: string; description?: string }`
  - `readFoundryManifestMeta(node: PlanNode): FoundryManifestMeta | null`
  - `stampManifestDescriptor(node: PlanNode, meta: FoundryManifestMeta): PlanNode`

- [ ] **Step 1: Create a branch**

```bash
cd D:/development/projects/de-braighter/layers/foundry-core
git checkout main
git pull origin main
git checkout -b feat/foundry-core-phase2
```

- [ ] **Step 2: Write the failing tests**

Add a new `describe` block at the end of `src/foundry-manifest.spec.ts`. The existing `base` fixture and imports are already present. Add these imports at the top of the file alongside existing imports:

```ts
import {
  // ... existing imports ...
  FoundryManifestMetaSchema,
  readFoundryManifestMeta,
  stampManifestDescriptor,
} from '../foundry-manifest.js';
```

Add at the end of the file (after all existing describe blocks):

```ts
describe('readFoundryManifestMeta', () => {
  it('returns null when foundry.manifest key is absent', () => {
    expect(readFoundryManifestMeta(base)).toBeNull();
  });

  it('parses valid manifest meta with defaults applied', () => {
    const node = stampManifestDescriptor(base, { kind: 'charter' });
    const result = readFoundryManifestMeta(node);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('charter');
    expect(result!.version).toBe('0.0.0');
  });

  it('throws on malformed manifest meta (fail-closed)', () => {
    const node: PlanNode = {
      ...base,
      metadata: { 'foundry.manifest': { notKind: true } },
    };
    expect(() => readFoundryManifestMeta(node)).toThrow();
  });
});

describe('stampManifestDescriptor', () => {
  it('does not mutate the original node', () => {
    const before = structuredClone(base.metadata);
    stampManifestDescriptor(base, { kind: 'meta' });
    expect(base.metadata).toEqual(before);
  });
});
```

- [ ] **Step 3: Run tests — expect 4 failures**

```bash
cd D:/development/projects/de-braighter/layers/foundry-core
pnpm test
```

Expected: 4 test failures (functions not defined yet).

- [ ] **Step 4: Implement — add to `src/foundry-manifest.ts`**

Append after the existing `stampArtifact` function:

```ts
export const FoundryManifestMetaSchema = z.object({
  kind: z.string().min(1),
  version: z.string().default('0.0.0'),
  description: z.string().optional(),
});
export type FoundryManifestMeta = z.infer<typeof FoundryManifestMetaSchema>;

/**
 * Reads the foundry manifest descriptor from a plan node's metadata.
 * - undefined (key absent) → null
 * - present-but-malformed → throws (fail-closed, mirrors readFoundryArtifactMeta pattern)
 */
export function readFoundryManifestMeta(node: PlanNode): FoundryManifestMeta | null {
  const raw = node.metadata[FOUNDRY_MANIFEST_KEY];
  if (raw === undefined) return null;
  return FoundryManifestMetaSchema.parse(raw);
}

/** Stamps a foundry manifest descriptor onto a plan node WITHOUT mutating the original. */
export function stampManifestDescriptor(node: PlanNode, meta: FoundryManifestMeta): PlanNode {
  return {
    ...node,
    metadata: { ...node.metadata, [FOUNDRY_MANIFEST_KEY]: meta },
  };
}
```

- [ ] **Step 5: Run `pnpm ci:local` — expect all tests to pass**

```bash
pnpm ci:local
```

Expected output: `Tests: 33 passed (N)` (29 existing + 4 new), `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/foundry-manifest.ts src/foundry-manifest.spec.ts
git commit -m "feat: FoundryManifestMeta schema + readFoundryManifestMeta + stampManifestDescriptor"
```

---

### Task 2: `CoreFoundry.registerFromNode()`

**Files:**

- Modify: `src/core-foundry.ts`
- Modify: `src/core-foundry.spec.ts`

**Interfaces:**

- Consumes (from Task 1):
  - `readFoundryManifestMeta(node: PlanNode): FoundryManifestMeta | null`
  - `stampManifestDescriptor(node: PlanNode, meta: FoundryManifestMeta): PlanNode`
- Produces (consumed by Task 5):
  - `CoreFoundry.registerFromNode(node: PlanNode, executable: FoundryManifest<unknown, unknown>): this`
    - Reads `readFoundryManifestMeta(node)` → throws if null
    - Throws if `meta.kind !== executable.kind`
    - Calls `this.register(executable)` and returns `this`

- [ ] **Step 1: Write failing tests**

In `src/core-foundry.spec.ts`, add these imports at the top (alongside existing imports):

```ts
import {
  // ... existing imports (FoundryContext, readFoundryArtifactMeta, stampArtifact) ...
  stampManifestDescriptor,
  readFoundryManifestMeta,
} from './foundry-manifest.js';
```

Add a new `describe` block inside or after the existing `describe('CoreFoundry', () => {`:

```ts
describe('CoreFoundry.registerFromNode', () => {
  const NODE_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const RUN_ID  = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

  const baseNode: PlanNode = {
    id: NODE_ID,
    parentId: null,
    treeRootId: NODE_ID,
    kind: 'foundry-manifest',
    kindRef: 'foundry-manifest',
    ordinal: 0,
    metadata: {},
    childrenIds: [],
  };
  const ctx: FoundryContext = {
    tenantPackId: 'tenant',
    parentNodeId: NODE_ID,
    runId: RUN_ID,
  };

  it('registers the executable by the kind from the node descriptor', async () => {
    const descriptorNode = stampManifestDescriptor(baseNode, { kind: 'stub' });
    const freshFoundry = new CoreFoundry();
    freshFoundry.registerFromNode(descriptorNode, stubManifest);
    const result = await freshFoundry.execute('stub', { value: 'x' }, ctx);
    expect(readFoundryArtifactMeta(result)).not.toBeNull();
  });

  it('throws when node has no foundry.manifest metadata', () => {
    expect(() =>
      new CoreFoundry().registerFromNode(baseNode, stubManifest)
    ).toThrow('foundry.manifest');
  });

  it('throws when manifest kind does not match node descriptor kind', () => {
    const descriptorNode = stampManifestDescriptor(baseNode, { kind: 'other-kind' });
    expect(() =>
      new CoreFoundry().registerFromNode(descriptorNode, stubManifest)
    ).toThrow('mismatch');
  });
});
```

Note: `stubManifest` and `ctx` are already defined in the existing `describe('CoreFoundry', ...)` block — the new describe block above uses its own local `baseNode`/`ctx`. If the test runner scopes variables differently, copy the `stubManifest` definition into the new block. Check the existing spec file to see if `stubManifest` is module-scoped.

- [ ] **Step 2: Run tests — expect 3 new failures**

```bash
pnpm test
```

- [ ] **Step 3: Implement — modify `src/core-foundry.ts`**

Add `readFoundryManifestMeta` to the import from `foundry-manifest.js`, then add the `registerFromNode` method:

```ts
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import type { FoundryManifest, FoundryContext } from './foundry-manifest.js';
import { readFoundryManifestMeta } from './foundry-manifest.js';

export class CoreFoundry {
  private readonly registry = new Map<string, FoundryManifest<unknown, unknown>>();

  /** Registers a manifest by kind. Last registration wins if kind is already registered. */
  register<TSpec, TArtifact>(manifest: FoundryManifest<TSpec, TArtifact>): this {
    this.registry.set(manifest.kind, manifest as FoundryManifest<unknown, unknown>);
    return this;
  }

  /**
   * Registers a manifest from a plan node descriptor.
   * Reads the kind from `metadata.foundry.manifest`; validates it matches the executable.
   * Throws if the node has no foundry.manifest metadata or if the kinds disagree.
   */
  registerFromNode(node: PlanNode, executable: FoundryManifest<unknown, unknown>): this {
    const meta = readFoundryManifestMeta(node);
    if (!meta) {
      throw new Error(
        `Node "${node.id}" has no foundry.manifest metadata — use stampManifestDescriptor first`
      );
    }
    if (meta.kind !== executable.kind) {
      throw new Error(
        `Manifest kind mismatch: node descriptor says "${meta.kind}" but executable says "${executable.kind}"`
      );
    }
    return this.register(executable);
  }

  async execute<TSpec>(kind: string, spec: TSpec, ctx: FoundryContext): Promise<PlanNode> {
    const manifest = this.registry.get(kind);
    if (!manifest) throw new Error(`No manifest registered for kind: "${kind}"`);
    const parsed = manifest.specSchema.parse(spec);
    const artifact = await manifest.generate(parsed, ctx);
    return manifest.persist(artifact, ctx);
  }
}
```

- [ ] **Step 4: Run `pnpm ci:local`**

```bash
pnpm ci:local
```

Expected: `Tests: 36 passed (N)` (33 + 3), `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/core-foundry.ts src/core-foundry.spec.ts
git commit -m "feat: CoreFoundry.registerFromNode — bridge plan node descriptor to in-memory registry"
```

---

### Task 3: `plan-tree-skin.ts`

**Files:**

- Create: `src/skins/plan-tree-skin.ts`
- Create: `src/skins/plan-tree-skin.spec.ts`

**Interfaces:**

- Consumes (from Task 1): `stampArtifact`, `FoundryManifest`, `FoundryContext` from `../foundry-manifest.js`
- Produces (consumed by Task 4 and Task 5):
  - `PlanTreeSkinSpecSchema`
  - `PlanTreeSkinSpec: { rootId: string (uuid), treeRootId?: string (uuid), phases: string[] }`
  - `planTreeSkin: FoundryManifest<PlanTreeSkinSpec, PlanNode[]>`
    - `kind: 'plan-tree'`
    - `generate(spec, ctx)` → `PlanNode[]` (one node per phase, `ordinal` = array index)
    - `persist(nodes, ctx)` → stamps `nodes[0]` as artifact with `manifestKind: 'plan-tree'`

- [ ] **Step 1: Write failing tests — create `src/skins/plan-tree-skin.spec.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { PlanNodeSchema } from '@de-braighter/substrate-contracts/plan-tree';
import { readFoundryArtifactMeta } from '../foundry-manifest.js';
import { planTreeSkin, PlanTreeSkinSpecSchema } from './plan-tree-skin.js';
import type { FoundryContext } from '../foundry-manifest.js';

const ROOT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const RUN_ID  = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

const ctx: FoundryContext = {
  tenantPackId: 'tenant',
  parentNodeId: ROOT_ID,
  runId: RUN_ID,
};

const spec = {
  rootId: ROOT_ID,
  phases: ['Design', 'Build', 'Test'],
};

describe('planTreeSkin', () => {
  it('kind is "plan-tree"', () => {
    expect(planTreeSkin.kind).toBe('plan-tree');
  });

  it('specSchema rejects empty phases array', () => {
    expect(() => PlanTreeSkinSpecSchema.parse({ rootId: ROOT_ID, phases: [] })).toThrow(z.ZodError);
  });

  it('specSchema accepts valid spec', () => {
    expect(() => PlanTreeSkinSpecSchema.parse(spec)).not.toThrow();
  });

  it('generate returns one PlanNode per phase with correct ordinal', async () => {
    const nodes = await planTreeSkin.generate(spec, ctx);
    expect(nodes).toHaveLength(3);
    expect(nodes[0].ordinal).toBe(0);
    expect(nodes[1].ordinal).toBe(1);
    expect(nodes[2].ordinal).toBe(2);
  });

  it('generate stores phase name in metadata["plan.phase"]', async () => {
    const nodes = await planTreeSkin.generate(spec, ctx);
    expect(nodes[0].metadata['plan.phase']).toBe('Design');
    expect(nodes[1].metadata['plan.phase']).toBe('Build');
  });

  it('persist stamps the first node as artifact', async () => {
    const nodes = await planTreeSkin.generate(spec, ctx);
    const result = await planTreeSkin.persist(nodes, ctx);
    const meta = readFoundryArtifactMeta(result);
    expect(meta).not.toBeNull();
    expect(meta!.manifestKind).toBe('plan-tree');
    expect(meta!.runNodeId).toBe(RUN_ID);
  });
});
```

Note: `z` needs to be imported — add `import { z } from 'zod';` at the top.

- [ ] **Step 2: Run tests — expect 6 new failures**

```bash
pnpm test
```

- [ ] **Step 3: Implement — create `src/skins/plan-tree-skin.ts`**

```ts
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import type { FoundryManifest, FoundryContext } from '../foundry-manifest.js';
import { stampArtifact } from '../foundry-manifest.js';

export const PlanTreeSkinSpecSchema = z.object({
  rootId: z.string().uuid(),
  treeRootId: z.string().uuid().optional(),
  phases: z.array(z.string().min(1)).min(1),
});
export type PlanTreeSkinSpec = z.infer<typeof PlanTreeSkinSpecSchema>;

export const planTreeSkin: FoundryManifest<PlanTreeSkinSpec, PlanNode[]> = {
  kind: 'plan-tree',
  specSchema: PlanTreeSkinSpecSchema,

  async generate(spec: PlanTreeSkinSpec, _ctx: FoundryContext): Promise<PlanNode[]> {
    const treeRootId = spec.treeRootId ?? spec.rootId;
    return spec.phases.map((phase, i) => ({
      id: randomUUID(),
      parentId: spec.rootId,
      treeRootId,
      kind: 'phase',
      kindRef: 'phase',
      ordinal: i,
      metadata: { 'plan.phase': phase },
      childrenIds: [],
    }));
  },

  async persist(nodes: PlanNode[], ctx: FoundryContext): Promise<PlanNode> {
    return stampArtifact(nodes[0], 'plan-tree', ctx.runId);
  },
};
```

- [ ] **Step 4: Run `pnpm ci:local`**

```bash
pnpm ci:local
```

Expected: `Tests: 42 passed (N)` (36 + 6), `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/skins/plan-tree-skin.ts src/skins/plan-tree-skin.spec.ts
git commit -m "feat: plan-tree skin — FoundryManifest<PlanTreeSkinSpec, PlanNode[]>"
```

---

### Task 4: `meta-skin.ts`

**Files:**

- Create: `src/skins/meta-skin.ts`
- Create: `src/skins/meta-skin.spec.ts`

**Interfaces:**

- Consumes (from Task 1): `stampArtifact`, `stampManifestDescriptor`, `FoundryManifest`, `FoundryContext` from `../foundry-manifest.js`
- Consumes (from Task 3): `planTreeSkin` from `./plan-tree-skin.js`
- Produces (consumed by Task 5):
  - `MetaSkinSpecSchema`
  - `MetaSkinSpec: { kind: string, description?: string }`
  - `metaSkin: FoundryManifest<MetaSkinSpec, FoundryManifest<unknown, unknown>>`
    - `kind: 'meta'`
    - `generate(spec, ctx)` → looks up `SKIN_TEMPLATES.get(spec.kind)`, throws `Error` (NOT ZodError) if absent
    - `persist(executable, ctx)` → creates a descriptor plan node, stamps `foundry.manifest` + `foundry.artifact`, returns it

- [ ] **Step 1: Write failing tests — create `src/skins/meta-skin.spec.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { readFoundryArtifactMeta, readFoundryManifestMeta } from '../foundry-manifest.js';
import { metaSkin, MetaSkinSpecSchema } from './meta-skin.js';
import type { FoundryContext } from '../foundry-manifest.js';

const ROOT_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const RUN_ID  = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

const ctx: FoundryContext = {
  tenantPackId: 'tenant',
  parentNodeId: ROOT_ID,
  runId: RUN_ID,
};

describe('metaSkin', () => {
  it('kind is "meta"', () => {
    expect(metaSkin.kind).toBe('meta');
  });

  it('specSchema rejects missing kind', () => {
    expect(() => MetaSkinSpecSchema.parse({})).toThrow(z.ZodError);
  });

  it('specSchema accepts valid spec', () => {
    expect(() => MetaSkinSpecSchema.parse({ kind: 'plan-tree', description: 'A plan tree' })).not.toThrow();
  });

  it('generate returns the plan-tree skin executable for kind="plan-tree"', async () => {
    const executable = await metaSkin.generate({ kind: 'plan-tree' }, ctx);
    expect(executable.kind).toBe('plan-tree');
    expect(typeof executable.generate).toBe('function');
    expect(typeof executable.persist).toBe('function');
  });

  it('generate throws for unknown kind (not a ZodError)', async () => {
    await expect(
      metaSkin.generate({ kind: 'unknown-kind' }, ctx)
    ).rejects.toThrow('No skin template for kind');
  });

  it('persist stamps the descriptor with foundry.manifest metadata', async () => {
    const executable = await metaSkin.generate({ kind: 'plan-tree' }, ctx);
    const descriptor = await metaSkin.persist(executable, ctx);
    const manifestMeta = readFoundryManifestMeta(descriptor);
    expect(manifestMeta).not.toBeNull();
    expect(manifestMeta!.kind).toBe('plan-tree');
    const artifactMeta = readFoundryArtifactMeta(descriptor);
    expect(artifactMeta).not.toBeNull();
    expect(artifactMeta!.manifestKind).toBe('meta');
  });
});
```

- [ ] **Step 2: Run tests — expect 6 new failures**

```bash
pnpm test
```

- [ ] **Step 3: Implement — create `src/skins/meta-skin.ts`**

```ts
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
import type { FoundryManifest, FoundryContext } from '../foundry-manifest.js';
import { stampArtifact, stampManifestDescriptor } from '../foundry-manifest.js';
import { planTreeSkin } from './plan-tree-skin.js';

export const MetaSkinSpecSchema = z.object({
  kind: z.string().min(1),
  description: z.string().optional(),
});
export type MetaSkinSpec = z.infer<typeof MetaSkinSpecSchema>;

const SKIN_TEMPLATES = new Map<string, FoundryManifest<unknown, unknown>>([
  ['plan-tree', planTreeSkin as FoundryManifest<unknown, unknown>],
]);

export const metaSkin: FoundryManifest<MetaSkinSpec, FoundryManifest<unknown, unknown>> = {
  kind: 'meta',
  specSchema: MetaSkinSpecSchema,

  async generate(
    spec: MetaSkinSpec,
    _ctx: FoundryContext,
  ): Promise<FoundryManifest<unknown, unknown>> {
    const template = SKIN_TEMPLATES.get(spec.kind);
    if (!template) throw new Error(`No skin template for kind: "${spec.kind}"`);
    return template;
  },

  async persist(
    executable: FoundryManifest<unknown, unknown>,
    ctx: FoundryContext,
  ): Promise<PlanNode> {
    const id = randomUUID();
    const descriptor: PlanNode = {
      id,
      parentId: ctx.parentNodeId,
      treeRootId: ctx.parentNodeId,
      kind: 'foundry-manifest',
      kindRef: 'foundry-manifest',
      ordinal: 0,
      metadata: {},
      childrenIds: [],
    };
    const withManifest = stampManifestDescriptor(descriptor, {
      kind: executable.kind,
      version: '0.0.0',
    });
    return stampArtifact(withManifest, 'meta', ctx.runId);
  },
};
```

- [ ] **Step 4: Run `pnpm ci:local`**

```bash
pnpm ci:local
```

Expected: `Tests: 48 passed (N)` (42 + 6), `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add src/skins/meta-skin.ts src/skins/meta-skin.spec.ts
git commit -m "feat: meta skin — FoundryManifest<MetaSkinSpec, FoundryManifest> + SKIN_TEMPLATES factory"
```

---

### Task 5: seed + integration test + `index.ts` + `ci:local` green

**Files:**

- Create: `src/seeds/meta-skin-seed.ts`
- Create: `src/e2e-meta-foundry.spec.ts`
- Modify: `src/index.ts`

**Interfaces:**

- Consumes (from Tasks 1–4): all new symbols
- Produces: published package surface (no new downstream deps in Phase 2)

- [ ] **Step 1: Create `src/seeds/meta-skin-seed.ts`**

This is the one plan node that bootstraps the meta-skin — it cannot be self-generated. It is hand-written and checked in as a TypeScript constant.

```ts
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';

/**
 * Hand-written seed descriptor for the meta-skin itself.
 * The one manifest that cannot be produced by the meta-foundry (bootstrap invariant).
 * Load it with: foundry.registerFromNode(META_SKIN_SEED, metaSkin)
 */
export const META_SKIN_SEED: PlanNode = {
  id: 'f6a7b8c9-d0e1-2345-fabc-456789012345',
  parentId: null,
  treeRootId: 'f6a7b8c9-d0e1-2345-fabc-456789012345',
  kind: 'foundry-manifest',
  kindRef: 'foundry-manifest',
  ordinal: 0,
  metadata: {
    'foundry.manifest': {
      kind: 'meta',
      version: '0.0.0',
      description:
        'Generates new FoundryManifest kinds from structured specs. The one manifest that cannot self-generate.',
    },
  },
  childrenIds: [],
};
```

- [ ] **Step 2: Write the integration test — create `src/e2e-meta-foundry.spec.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import { PlanNodeSchema } from '@de-braighter/substrate-contracts/plan-tree';
import { CoreFoundry } from './core-foundry.js';
import {
  readFoundryArtifactMeta,
  readFoundryManifestMeta,
} from './foundry-manifest.js';
import { metaSkin } from './skins/meta-skin.js';
import { planTreeSkin } from './skins/plan-tree-skin.js';
import { META_SKIN_SEED } from './seeds/meta-skin-seed.js';
import type { FoundryContext } from './foundry-manifest.js';

const ROOT_ID    = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const RUN_ID     = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const PLAN_ROOT  = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

const ctx: FoundryContext = {
  tenantPackId: 'tenant',
  parentNodeId: ROOT_ID,
  runId: RUN_ID,
};

describe('meta-foundry round-trip', () => {
  let foundry: CoreFoundry;

  beforeEach(() => {
    foundry = new CoreFoundry().register(metaSkin);
  });

  it('execute("meta") returns a descriptor node with foundry.manifest stamped', async () => {
    const descriptor = await foundry.execute('meta', { kind: 'plan-tree' }, ctx);
    const meta = readFoundryManifestMeta(descriptor);
    expect(meta).not.toBeNull();
    expect(meta!.kind).toBe('plan-tree');
  });

  it('descriptor node also carries foundry.artifact (run record)', async () => {
    const descriptor = await foundry.execute('meta', { kind: 'plan-tree' }, ctx);
    const artifact = readFoundryArtifactMeta(descriptor);
    expect(artifact).not.toBeNull();
    expect(artifact!.manifestKind).toBe('meta');
    expect(artifact!.runNodeId).toBe(RUN_ID);
  });

  it('registerFromNode enables execute("plan-tree") after meta execution', async () => {
    const descriptor = await foundry.execute('meta', { kind: 'plan-tree' }, ctx);
    foundry.registerFromNode(descriptor, planTreeSkin);
    const ctx2: FoundryContext = { ...ctx, parentNodeId: PLAN_ROOT };
    const result = await foundry.execute(
      'plan-tree',
      { rootId: PLAN_ROOT, phases: ['Design', 'Build'] },
      ctx2,
    );
    const meta = readFoundryArtifactMeta(result);
    expect(meta).not.toBeNull();
    expect(meta!.manifestKind).toBe('plan-tree');
  });

  it('PlanNodeSchema.parse succeeds on plan-tree output (kernel schema gate)', async () => {
    const descriptor = await foundry.execute('meta', { kind: 'plan-tree' }, ctx);
    foundry.registerFromNode(descriptor, planTreeSkin);
    const ctx2: FoundryContext = { ...ctx, parentNodeId: PLAN_ROOT };
    const result = await foundry.execute(
      'plan-tree',
      { rootId: PLAN_ROOT, phases: ['Phase A'] },
      ctx2,
    );
    expect(() => PlanNodeSchema.parse(result)).not.toThrow();
  });

  it('META_SKIN_SEED enables registerFromNode for the meta-skin itself (bootstrap proof)', () => {
    const freshFoundry = new CoreFoundry();
    freshFoundry.registerFromNode(META_SKIN_SEED, metaSkin);
    const seedMeta = readFoundryManifestMeta(META_SKIN_SEED);
    expect(seedMeta).not.toBeNull();
    expect(seedMeta!.kind).toBe('meta');
  });
});
```

- [ ] **Step 3: Run tests — expect 5 new failures**

```bash
pnpm test
```

- [ ] **Step 4: Update `src/index.ts`**

Replace the entire file with:

```ts
// Protocol types
export type { FoundryManifest, FoundryContext, FoundryArtifactMeta, FoundryManifestMeta } from './foundry-manifest.js';
export {
  FOUNDRY_MANIFEST_KEY,
  FOUNDRY_RUN_KEY,
  FOUNDRY_ARTIFACT_KEY,
  FoundryArtifactMetaSchema,
  FoundryManifestMetaSchema,
  readFoundryArtifactMeta,
  readFoundryManifestMeta,
  stampArtifact,
  stampManifestDescriptor,
} from './foundry-manifest.js';

// Registry + executor
export { CoreFoundry } from './core-foundry.js';

// Built-in skins
export { charterSkin, CharterSkinSpecSchema } from './skins/charter-skin.js';
export type { CharterSkinSpec } from './skins/charter-skin.js';

export { planTreeSkin, PlanTreeSkinSpecSchema } from './skins/plan-tree-skin.js';
export type { PlanTreeSkinSpec } from './skins/plan-tree-skin.js';

export { metaSkin, MetaSkinSpecSchema } from './skins/meta-skin.js';
export type { MetaSkinSpec } from './skins/meta-skin.js';

// Bootstrap seed
export { META_SKIN_SEED } from './seeds/meta-skin-seed.js';
```

- [ ] **Step 5: Run `pnpm ci:local`**

```bash
pnpm ci:local
```

Expected: `Tests: 53 passed (N)` (48 + 5), `tsc --noEmit` clean.

- [ ] **Step 6: Run `pnpm build` — verify `dist/index.js` re-exports new symbols**

```bash
pnpm build
node --input-type=module -e "
import { metaSkin, planTreeSkin, META_SKIN_SEED, readFoundryManifestMeta } from './dist/index.js';
console.log(metaSkin.kind, planTreeSkin.kind, META_SKIN_SEED.id);
console.log('BUILD OK');
"
```

Expected output: `meta plan-tree f6a7b8c9-d0e1-2345-fabc-456789012345\nBUILD OK`

- [ ] **Step 7: Commit**

```bash
git add src/seeds/meta-skin-seed.ts src/e2e-meta-foundry.spec.ts src/index.ts
git commit -m "feat: meta-skin seed + e2e round-trip + updated barrel export"
```

- [ ] **Step 8: Push**

```bash
git push -u origin feat/foundry-core-phase2
```

---

## Self-Review

**1. Spec coverage (from design doc §5 Phase 2):**

| Requirement | Task |
|---|---|
| Meta skin `kind='meta'` | Task 4 |
| Spec schema (freeform + structured) | Task 4 (`MetaSkinSpecSchema`) |
| `generate()` produces `FoundryManifest` object | Task 4 |
| `persist()` serializes as plan node | Task 4 |
| `CoreFoundry.execute()` extended to look up from plan tree | Task 2 (`registerFromNode`) |
| Plan-tree skin `kind='plan-tree'` | Task 3 |
| Seed migration (hand-write meta-skin manifest plan node) | Task 5 (`META_SKIN_SEED`) |
| Gate: round-trip verifiable from plan tree alone | Task 5 (`e2e-meta-foundry.spec.ts`) |

**2. Placeholder scan:** No TBD, no "add validation", no "similar to Task N". All code is verbatim.

**3. Type consistency check:**

- `FoundryManifestMeta` defined Task 1, consumed Tasks 2, 4, 5 — consistent.
- `stampManifestDescriptor(node, meta)` defined Task 1, used Tasks 4, 5 — consistent.
- `readFoundryManifestMeta(node)` defined Task 1, used Tasks 2, 5 — consistent.
- `planTreeSkin` defined Task 3, imported Task 4 (`meta-skin.ts`), Task 5 (`e2e`) — consistent.
- `metaSkin` defined Task 4, imported Task 5 — consistent.
- `META_SKIN_SEED` defined Task 5 step 1, imported same task step 2 — consistent.
- `CoreFoundry.registerFromNode` defined Task 2, called Task 5 — consistent.

**Known limitation (not a gap):** `ctx.parentNodeId` is a plain `string` with no UUID validation; the meta-skin's `persist()` uses it as `parentId` and `treeRootId` in the descriptor node. If the caller passes a non-UUID `parentNodeId`, `PlanNodeSchema.parse()` on the descriptor would fail. This is a caller responsibility; the integration test uses a valid UUID.
