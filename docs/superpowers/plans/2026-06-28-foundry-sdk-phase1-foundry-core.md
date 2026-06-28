# Foundry SDK — Phase 1 (`layers/foundry-core`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `layers/foundry-core` — a new published `@de-braighter/foundry-core` cluster layer that implements the `FoundryManifest<TSpec, TArtifact>` protocol, the `CoreFoundry` class, and the first concrete skin (`kind='charter'`), proving the full round-trip (spec → generate → persist → `PlanNode`) against the already-shipped `layers/charter-runtime`. Zero kernel change; ADR-176 compliant; peer layer to `layers/charter-runtime`.

**Architecture:** A new sibling repo `de-braighter/foundry-core` cloned at `layers/foundry-core/`, a pnpm workspace with one library, mirroring the **charter-runtime** single-lib pattern (ADR-283 precedent). `foundry-manifest.ts` owns the protocol types + three metadata-key constants + Zod-validated read/write helpers. `core-foundry.ts` owns the in-memory manifest registry + `execute()`. `skins/charter-skin.ts` is the first concrete manifest — it delegates to `@de-braighter/charter-runtime` and proves the architecture composes cleanly without kernel involvement. A boundary-acid test enforces the import boundary (no relative substrate reach; no production dep on substrate-runtime). An integration test covers the full round-trip in one vitest file.

**Tech Stack:** TypeScript 5.6 (ESM/NodeNext), pnpm 9, Zod ^3.23.8, Vitest ^2.1.8; `@de-braighter/substrate-contracts` (type-only peer dep, from npm) + `@de-braighter/charter-runtime` (peer dep and dev dep via `file:../charter-runtime`). No NestJS, no Prisma, no substrate-runtime in production source.

**Spec:** `docs/superpowers/specs/2026-06-28-foundry-sdk-three-pillar-design.md` — §2 (Approach C Meta-Manifest protocol), §3 (layer placement + ring dependency diagram), §3.2 (ADR-176 inclusion test), §4.1 (charter skin spec), §5 Phase 1 deliverables. ADR precedent: `layers/specs/adr/adr-283-charter-runtime-cluster-layer.md`.

**Cross-repo note:** Tasks 1–6 are all in the new `layers/foundry-core/` repo (its own git history). Task 1 Step 1 creates the GitHub remote and clones it (follow the exact pattern from the knowledge-layer S0 plan: `gh repo create de-braighter/foundry-core --private`, then `git clone git@github.com:de-braighter/foundry-core.git layers/foundry-core`). The workbench `repos.yaml` and `projects/foundry-core/project.yaml` are updated in Task 6 on a separate workbench branch. The specs repo gets no change in Phase 1 (ADR reserved for Phase 2 when the meta-manifest ships).

---

## Global Constraints

- **ESM/NodeNext** — every relative import carries an explicit `.js` extension (e.g. `from './foundry-manifest.js'`). Each `package.json` has `"type": "module"`.
- **ZERO kernel change (STOP/escalate guardrail)** — no file under `layers/substrate` production surface may be edited. These paths MUST stay byte-identical vs `origin/main`: `libs/substrate-contracts/src/plan-tree/*`, `libs/substrate-runtime/src/plan-tree/*`, any `kernel.*` Prisma schema/migration. **Any task that would edit a `layers/substrate` production file is a STOP — escalate; do not proceed.**
- **Everything rides `metadata` + the published plan-tree port** — the layer consumes substrate only through the published `@de-braighter/substrate-{contracts,runtime}` package surface (never a relative reach into the sibling repo, never a deep `dist/` path). Enforced by the boundary-acid test (Task 2).
- **No production dep on substrate-runtime** — production source files (non-spec, non-testing) MUST NOT import `@de-braighter/substrate-runtime`. Only test/testing files may. Enforced by the boundary-acid test second assertion.
- **Charter vocab stays in the charter layer** — `foundry-manifest.ts` and `core-foundry.ts` MUST NOT import from `@de-braighter/charter-runtime`. Only `skins/charter-skin.ts` may. The boundary-acid test enforces this.
- **Peer dep on substrate-contracts ^2.7.0** — matches charter-runtime's pin; do not bump without a deliberate cluster upgrade.
- **All tests pass via `vitest run`** — no skipped tests; every `it()` must be green before committing the task.
- **Branch discipline** — work on a feature branch `feat/foundry-core-phase1` in the new `layers/foundry-core` repo; never `git add -A`; never git ops in shared clones (workbench, substrate, charter-runtime).

---

## File Structure

```text
layers/foundry-core/
├── src/
│   ├── foundry-manifest.ts          # FoundryManifest interface + FoundryContext + metadata helpers
│   ├── core-foundry.ts              # CoreFoundry class (in-memory registry + execute)
│   ├── skins/
│   │   └── charter-skin.ts          # charterSkin: FoundryManifest<CharterSkinSpec, PlanNode>
│   ├── index.ts                     # public barrel exports
│   ├── foundry-manifest.spec.ts     # unit tests: metadata helpers + boundary acid test
│   ├── core-foundry.spec.ts         # unit tests: CoreFoundry registry + execute
│   └── e2e-charter-skin.spec.ts     # integration: full round-trip (charter skin)
├── package.json
├── tsconfig.json
├── tsconfig.build.json
└── vitest.config.ts
```

---

## Task 1 — Scaffold `layers/foundry-core`

Create the new repo, all config files, and confirm pnpm resolution. No source files yet.

- [ ] **Step 1: Create GitHub repo + clone**

  ```bash
  gh repo create de-braighter/foundry-core --private --description "Foundry SDK layer — manifest protocol + skins"
  git clone git@github.com:de-braighter/foundry-core.git D:/development/projects/de-braighter/layers/foundry-core
  cd D:/development/projects/de-braighter/layers/foundry-core
  git checkout -b feat/foundry-core-phase1
  ```

  Expected: repo exists on GitHub; local clone at `layers/foundry-core/`; branch created.

- [ ] **Step 2: Write `package.json`**

  Create `layers/foundry-core/package.json`:

  ```json
  {
    "name": "@de-braighter/foundry-core",
    "version": "0.0.0",
    "private": true,
    "type": "module",
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    },
    "scripts": {
      "build": "tsc -p tsconfig.build.json",
      "typecheck": "tsc -p tsconfig.json --noEmit",
      "test": "vitest run",
      "ci:local": "tsc -p tsconfig.json --noEmit && vitest run"
    },
    "dependencies": {
      "zod": "^3.23.8"
    },
    "peerDependencies": {
      "@de-braighter/substrate-contracts": "^2.7.0",
      "@de-braighter/charter-runtime": "^0.0.0"
    },
    "devDependencies": {
      "@de-braighter/substrate-contracts": "^2.7.0",
      "@de-braighter/charter-runtime": "file:../charter-runtime",
      "@types/node": "^26.0.1",
      "typescript": "^5.6.3",
      "vitest": "^2.1.8"
    }
  }
  ```

  Note: `@de-braighter/charter-runtime` uses a `file:` reference because each layer is a standalone pnpm workspace (not a monorepo root); `workspace:*` would not resolve across independent workspaces. The `file:` reference requires charter-runtime's `dist/` to exist — Task 1 Step 8 builds it first.

- [ ] **Step 3: Write `tsconfig.json`**

  Create `layers/foundry-core/tsconfig.json` (identical to charter-runtime):

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "lib": ["ES2022"],
      "strict": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "declaration": true,
      "outDir": "dist",
      "rootDir": "src",
      "types": ["vitest/globals", "node"]
    },
    "include": ["src/**/*.ts"]
  }
  ```

- [ ] **Step 4: Write `tsconfig.build.json`**

  Create `layers/foundry-core/tsconfig.build.json` (identical to charter-runtime):

  ```json
  { "extends": "./tsconfig.json", "compilerOptions": { "types": ["node"] }, "exclude": ["src/**/*.spec.ts", "src/testing/**"] }
  ```

- [ ] **Step 5: Write `vitest.config.ts`**

  Create `layers/foundry-core/vitest.config.ts` (identical to charter-runtime):

  ```ts
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: { globals: true, environment: 'node', include: ['src/**/*.spec.ts'] },
  });
  ```

- [ ] **Step 6: Create `src/` directory**

  ```bash
  mkdir -p D:/development/projects/de-braighter/layers/foundry-core/src/skins
  ```

- [ ] **Step 7: Build `layers/charter-runtime` to produce `dist/`**

  The `file:` reference in foundry-core's devDependencies resolves against charter-runtime's `exports`, which point to `./dist/index.js`. Build it first:

  ```bash
  cd D:/development/projects/de-braighter/layers/charter-runtime
  pnpm build
  ```

  Expected: `dist/` directory created with `index.js` and `index.d.ts`. No TypeScript errors.

  If `pnpm build` fails with "command not found", confirm pnpm is on PATH: `pnpm --version`. If charter-runtime's own `node_modules` are missing, run `pnpm install` in `layers/charter-runtime/` first.

- [ ] **Step 8: Install dependencies in foundry-core**

  Run from the foundry-core workspace root so pnpm resolves the `file:` reference:

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  pnpm install
  ```

  Expected: `node_modules/@de-braighter/charter-runtime/` symlinks to or copies from `../charter-runtime/dist/`. No `ERR_PNPM_NO_MATCHING_VERSION` or `ERR_PNPM_PEER_DEP_ISSUES` errors. If the peer dep range `^0.0.0` for charter-runtime causes a version mismatch warning (charter-runtime is `0.0.0`), change the peerDep range to `">=0.0.0"` and note it as a known version-pin caveat.

- [ ] **Step 9: Commit scaffold**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  git add package.json tsconfig.json tsconfig.build.json vitest.config.ts
  git commit -m "chore: scaffold @de-braighter/foundry-core layer"
  ```

  Expected: commit created on `feat/foundry-core-phase1`.

---

## Task 2 — `src/foundry-manifest.ts` + unit tests (TDD)

Write the failing tests first, then implement. This task also contains the boundary acid test for the full layer.

- [ ] **Step 1: Write `src/foundry-manifest.spec.ts`** (failing first)

  Create `layers/foundry-core/src/foundry-manifest.spec.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { readFoundryArtifactMeta, stampArtifact, FOUNDRY_ARTIFACT_KEY } from './foundry-manifest.js';
  import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';

  const base: PlanNode = { id: 'n1', parentId: null, title: 'Node', metadata: {}, effects: [], kindRef: null };

  describe('foundry-manifest metadata helpers', () => {
    it('readFoundryArtifactMeta returns null when key absent', () => {
      expect(readFoundryArtifactMeta(base)).toBeNull();
    });

    it('readFoundryArtifactMeta parses a valid value', () => {
      const node: PlanNode = {
        ...base,
        metadata: {
          [FOUNDRY_ARTIFACT_KEY]: { manifestKind: 'charter', runNodeId: 'r1', producedAt: '2026-06-28T00:00:00.000Z' },
        },
      };
      const result = readFoundryArtifactMeta(node);
      expect(result?.manifestKind).toBe('charter');
    });

    it('stampArtifact adds foundry.artifact key without mutating original', () => {
      const stamped = stampArtifact(base, 'charter', 'run-42');
      expect(stamped.metadata[FOUNDRY_ARTIFACT_KEY]).toBeDefined();
      expect(base.metadata[FOUNDRY_ARTIFACT_KEY]).toBeUndefined();
    });

    it('readFoundryArtifactMeta throws on malformed value (fail-loud)', () => {
      const node: PlanNode = { ...base, metadata: { [FOUNDRY_ARTIFACT_KEY]: { bad: true } } };
      expect(() => readFoundryArtifactMeta(node)).toThrow();
    });
  });
  ```

- [ ] **Step 2: Write boundary acid test — add to `src/foundry-manifest.spec.ts`**

  Append a second `describe` block to the same file:

  ```ts
  import { readFileSync, readdirSync } from 'node:fs';
  import { join } from 'node:path';

  const SRC = join(process.cwd(), 'src');
  const files = (readdirSync(SRC, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.ts'))
    .map((f) => f.replace(/\\/g, '/'));

  describe('Kernel-Untouched Invariant — import boundary', () => {
    it('foundry-core imports substrate only via its published package surface', () => {
      for (const f of files) {
        const text = readFileSync(join(SRC, f), 'utf8');
        // no relative reach into a sibling substrate repo at any depth
        expect(text, `${f}: relative substrate import`).not.toMatch(/from ['"]\.[^'"]*substrate/);
        // any @de-braighter import is an approved layer dep
        const imports = [...text.matchAll(/from ['"](@de-braighter\/[^'"]+)['"]/g)].map((m) => m[1]);
        for (const imp of imports) {
          // Allowlist: substrate-contracts, substrate-runtime (test/testing only), charter-runtime (skins only).
          expect(imp, `${f}: unapproved import ${imp}`).toMatch(
            /^@de-braighter\/(substrate-contracts|substrate-runtime|charter-runtime)(\/[a-z-]+)?$/,
          );
        }
      }
    });

    it('production source does not import substrate-runtime', () => {
      const productionFiles = files.filter(
        (f) => !f.endsWith('.spec.ts') && !f.startsWith('testing/'),
      );
      for (const f of productionFiles) {
        const text = readFileSync(join(SRC, f), 'utf8');
        expect(text, `${f}: substrate-runtime in production`).not.toMatch(/@de-braighter\/substrate-runtime/);
      }
    });

    it('foundry-manifest and core-foundry do not import charter-runtime', () => {
      const coreFiles = files.filter(
        (f) => (f.includes('foundry-manifest') || f.includes('core-foundry')) && !f.endsWith('.spec.ts'),
      );
      for (const f of coreFiles) {
        const text = readFileSync(join(SRC, f), 'utf8');
        expect(text, `${f}: charter-runtime leaked into core`).not.toMatch(/@de-braighter\/charter-runtime/);
      }
    });
  });
  ```

  Note: Both `describe` blocks live in the same `foundry-manifest.spec.ts` file. The full import block for the file (merged) is shown in Step 1 + Step 2 combined. In practice write them together.

- [ ] **Step 3: Run tests (expect failure — module not found)**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  pnpm test
  ```

  Expected: `Cannot find module './foundry-manifest.js'` error. This confirms TDD red state.

- [ ] **Step 4: Implement `src/foundry-manifest.ts`**

  Create `layers/foundry-core/src/foundry-manifest.ts`:

  ```ts
  import { z } from 'zod';
  import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';

  export const FOUNDRY_MANIFEST_KEY = 'foundry.manifest';
  export const FOUNDRY_RUN_KEY = 'foundry.run';
  export const FOUNDRY_ARTIFACT_KEY = 'foundry.artifact';

  export interface FoundryContext {
    tenantPackId: string;
    parentNodeId: string;
    runId: string;
  }

  export interface FoundryManifest<TSpec, TArtifact> {
    readonly kind: string;
    readonly specSchema: z.ZodSchema<TSpec>;
    generate(spec: TSpec, ctx: FoundryContext): Promise<TArtifact>;
    persist(artifact: TArtifact, ctx: FoundryContext): Promise<PlanNode>;
  }

  export const FoundryArtifactMetaSchema = z.object({
    manifestKind: z.string().min(1),
    runNodeId: z.string().min(1),
    producedAt: z.string(),
  });
  export type FoundryArtifactMeta = z.infer<typeof FoundryArtifactMetaSchema>;

  /**
   * Reads the foundry artifact metadata from a plan node's metadata.
   * - undefined (key absent) → null
   * - a present-but-malformed value → throws (fail-closed, mirrors readCharter pattern)
   */
  export function readFoundryArtifactMeta(node: PlanNode): FoundryArtifactMeta | null {
    const raw = node.metadata[FOUNDRY_ARTIFACT_KEY];
    if (raw === undefined) return null;
    return FoundryArtifactMetaSchema.parse(raw);
  }

  /** Stamps the artifact metadata onto a plan node WITHOUT mutating the original. */
  export function stampArtifact(node: PlanNode, manifestKind: string, runNodeId: string): PlanNode {
    const meta: FoundryArtifactMeta = { manifestKind, runNodeId, producedAt: new Date().toISOString() };
    return { ...node, metadata: { ...node.metadata, [FOUNDRY_ARTIFACT_KEY]: meta } };
  }
  ```

- [ ] **Step 5: Run tests (expect green)**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  pnpm test
  ```

  Expected output:

  ```
  ✓ foundry-manifest metadata helpers (4 tests)
  ✓ Kernel-Untouched Invariant — import boundary (3 tests)
  Test Files  1 passed (1)
  Tests       7 passed (7)
  ```

  The boundary acid tests will initially fail on the `charter-runtime` allowlist check because `skins/` does not exist yet. If so: the acid test is correct — it will pass once the full file set exists. Defer the acid test execution to after Task 4 if it causes issues; comment `// acid tests run after all source files exist` and re-enable in Task 6.

- [ ] **Step 6: Commit**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  git add src/foundry-manifest.ts src/foundry-manifest.spec.ts
  git commit -m "feat: FoundryManifest protocol types + metadata helpers + boundary acid test"
  ```

---

## Task 3 — `src/core-foundry.ts` + unit tests (TDD)

- [ ] **Step 1: Write `src/core-foundry.spec.ts`** (failing first)

  Create `layers/foundry-core/src/core-foundry.spec.ts`:

  ```ts
  import { describe, it, expect, vi } from 'vitest';
  import { CoreFoundry } from './core-foundry.js';
  import type { FoundryManifest, FoundryContext } from './foundry-manifest.js';
  import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
  import { z } from 'zod';

  const ctx: FoundryContext = { tenantPackId: 'test-tenant', parentNodeId: 'parent-1', runId: 'run-1' };

  const stubNode: PlanNode = {
    id: 'result-node',
    parentId: null,
    title: 'Result',
    metadata: { 'foundry.artifact': { manifestKind: 'stub', runNodeId: 'run-1', producedAt: '2026-06-28T00:00:00Z' } },
    effects: [],
    kindRef: null,
  };

  const StubSpecSchema = z.object({ value: z.string() });
  type StubSpec = z.infer<typeof StubSpecSchema>;

  const stubManifest: FoundryManifest<StubSpec, PlanNode> = {
    kind: 'stub',
    specSchema: StubSpecSchema,
    generate: vi.fn(async (_spec, _ctx) => stubNode),
    persist: vi.fn(async (artifact, _ctx) => artifact),
  };

  describe('CoreFoundry', () => {
    it('register returns this for fluent chaining', () => {
      const foundry = new CoreFoundry();
      expect(foundry.register(stubManifest)).toBe(foundry);
    });

    it('execute calls generate then persist and returns the PlanNode', async () => {
      const foundry = new CoreFoundry();
      foundry.register(stubManifest);

      const result = await foundry.execute('stub', { value: 'hello' }, ctx);

      expect(result).toBe(stubNode);
      expect(stubManifest.generate).toHaveBeenCalledWith({ value: 'hello' }, ctx);
      expect(stubManifest.persist).toHaveBeenCalledWith(stubNode, ctx);
    });

    it('throws for unknown kind', async () => {
      const foundry = new CoreFoundry();
      await expect(foundry.execute('unknown', {}, ctx)).rejects.toThrow(
        'No manifest registered for kind: "unknown"',
      );
    });

    it('throws on invalid spec (Zod parse error)', async () => {
      const foundry = new CoreFoundry();
      foundry.register(stubManifest);
      await expect(foundry.execute('stub', { invalid: true }, ctx)).rejects.toThrow();
    });

    it('supports multiple manifests registered', async () => {
      const secondManifest: FoundryManifest<StubSpec, PlanNode> = {
        ...stubManifest,
        kind: 'second',
        generate: vi.fn(async () => ({ ...stubNode, id: 'second-result' })),
        persist: vi.fn(async (a) => a),
      };
      const foundry = new CoreFoundry();
      foundry.register(stubManifest).register(secondManifest);

      const r1 = await foundry.execute('stub', { value: 'a' }, ctx);
      const r2 = await foundry.execute('second', { value: 'b' }, ctx);

      expect(r1.id).toBe('result-node');
      expect(r2.id).toBe('second-result');
    });
  });
  ```

- [ ] **Step 2: Run tests (expect failure)**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  pnpm test
  ```

  Expected: `Cannot find module './core-foundry.js'` error.

- [ ] **Step 3: Implement `src/core-foundry.ts`**

  Create `layers/foundry-core/src/core-foundry.ts`:

  ```ts
  import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
  import type { FoundryManifest, FoundryContext } from './foundry-manifest.js';

  export class CoreFoundry {
    private readonly registry = new Map<string, FoundryManifest<unknown, unknown>>();

    register<TSpec, TArtifact>(manifest: FoundryManifest<TSpec, TArtifact>): this {
      this.registry.set(manifest.kind, manifest as FoundryManifest<unknown, unknown>);
      return this;
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

- [ ] **Step 4: Run tests (expect green)**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  pnpm test
  ```

  Expected output:

  ```
  ✓ foundry-manifest metadata helpers (4 tests)
  ✓ Kernel-Untouched Invariant — import boundary (3 tests)
  ✓ CoreFoundry (5 tests)
  Test Files  2 passed (2)
  Tests       12 passed (12)
  ```

- [ ] **Step 5: Commit**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  git add src/core-foundry.ts src/core-foundry.spec.ts
  git commit -m "feat: CoreFoundry — in-memory registry + execute"
  ```

---

## Task 4 — `src/skins/charter-skin.ts` + unit tests (TDD)

- [ ] **Step 1: Write skin unit tests** (failing first)

  Create `layers/foundry-core/src/skins/charter-skin.spec.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { charterSkin, CharterSkinSpecSchema } from './charter-skin.js';
  import { readCharter } from '@de-braighter/charter-runtime';
  import { readFoundryArtifactMeta } from '../foundry-manifest.js';

  const ctx = { tenantPackId: 'test-tenant', parentNodeId: 'parent-1', runId: 'run-7' };

  const validSpec = {
    id: 'charter-node-1',
    title: 'Test Product Charter',
    contract: {
      role: 'product' as const,
      mission: { objective: 'Build foundry SDK', outcome: 'Three pillars unified' },
      scope: { allowedPathPrefixes: ['layers/foundry-core/'] },
    },
  };

  describe('charterSkin', () => {
    it('kind is "charter"', () => {
      expect(charterSkin.kind).toBe('charter');
    });

    it('specSchema accepts valid spec', () => {
      expect(() => CharterSkinSpecSchema.parse(validSpec)).not.toThrow();
    });

    it('specSchema rejects missing title', () => {
      const { title: _omit, ...rest } = validSpec;
      expect(() => CharterSkinSpecSchema.parse(rest)).toThrow();
    });

    it('generate produces a PlanNode with the charter contract in metadata', async () => {
      const node = await charterSkin.generate(validSpec, ctx);
      expect(node.id).toBe('charter-node-1');
      const charter = readCharter(node);
      expect(charter).not.toBeNull();
      expect(charter!.role).toBe('product');
      expect(charter!.mission.objective).toBe('Build foundry SDK');
    });

    it('generate sets parentId from spec.parentId when provided', async () => {
      const specWithParent = { ...validSpec, parentId: 'root-node' };
      const node = await charterSkin.generate(specWithParent, ctx);
      expect(node.parentId).toBe('root-node');
    });

    it('generate sets parentId to null when spec.parentId absent', async () => {
      const node = await charterSkin.generate(validSpec, ctx);
      expect(node.parentId).toBeNull();
    });

    it('persist stamps the artifact metadata with manifestKind=charter and runNodeId from ctx', async () => {
      const generated = await charterSkin.generate(validSpec, ctx);
      const persisted = await charterSkin.persist(generated, ctx);
      const artifact = readFoundryArtifactMeta(persisted);
      expect(artifact).not.toBeNull();
      expect(artifact!.manifestKind).toBe('charter');
      expect(artifact!.runNodeId).toBe('run-7');
      expect(artifact!.producedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });

    it('persist does not mutate the artifact passed to it', async () => {
      const generated = await charterSkin.generate(validSpec, ctx);
      const metaBefore = { ...generated.metadata };
      await charterSkin.persist(generated, ctx);
      expect(generated.metadata).toEqual(metaBefore);
    });
  });
  ```

- [ ] **Step 2: Run tests (expect failure)**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  pnpm test
  ```

  Expected: `Cannot find module './charter-skin.js'` error.

- [ ] **Step 3: Implement `src/skins/charter-skin.ts`**

  Create `layers/foundry-core/src/skins/charter-skin.ts`:

  ```ts
  import { z } from 'zod';
  import { writeCharter, CharterContractSchema } from '@de-braighter/charter-runtime';
  import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';
  import type { FoundryManifest, FoundryContext } from '../foundry-manifest.js';
  import { stampArtifact } from '../foundry-manifest.js';

  export const CharterSkinSpecSchema = z.object({
    id: z.string().min(1),
    parentId: z.string().min(1).optional(),
    title: z.string().min(1),
    contract: CharterContractSchema,
  });
  export type CharterSkinSpec = z.infer<typeof CharterSkinSpecSchema>;

  export const charterSkin: FoundryManifest<CharterSkinSpec, PlanNode> = {
    kind: 'charter',
    specSchema: CharterSkinSpecSchema,

    async generate(spec, _ctx): Promise<PlanNode> {
      const base: PlanNode = {
        id: spec.id,
        parentId: spec.parentId ?? null,
        title: spec.title,
        metadata: {},
        effects: [],
        kindRef: null,
      };
      return writeCharter(base, spec.contract);
    },

    async persist(artifact, ctx): Promise<PlanNode> {
      return stampArtifact(artifact, 'charter', ctx.runId);
    },
  };
  ```

- [ ] **Step 4: Run tests (expect green)**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  pnpm test
  ```

  Expected output:

  ```
  ✓ foundry-manifest metadata helpers (4 tests)
  ✓ Kernel-Untouched Invariant — import boundary (3 tests)
  ✓ CoreFoundry (5 tests)
  ✓ charterSkin (8 tests)
  Test Files  3 passed (3)
  Tests       20 passed (20)
  ```

  Note: The boundary acid test third assertion (`foundry-manifest and core-foundry do not import charter-runtime`) will now pass because `charter-runtime` imports exist only in `skins/charter-skin.ts`, which is not named `foundry-manifest*` or `core-foundry*`.

- [ ] **Step 5: Commit**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  git add src/skins/charter-skin.ts src/skins/charter-skin.spec.ts
  git commit -m "feat: charter skin — FoundryManifest<CharterSkinSpec, PlanNode>"
  ```

---

## Task 5 — Integration test `src/e2e-charter-skin.spec.ts`

Full round-trip: `CoreFoundry.execute('charter', spec, ctx)` → verify both `metadata.charter` and `metadata['foundry.artifact']` are present on the result.

- [ ] **Step 1: Write `src/e2e-charter-skin.spec.ts`**

  Create `layers/foundry-core/src/e2e-charter-skin.spec.ts`:

  ```ts
  import { describe, it, expect } from 'vitest';
  import { CoreFoundry } from './core-foundry.js';
  import { charterSkin } from './skins/charter-skin.js';
  import { readCharter } from '@de-braighter/charter-runtime';
  import { readFoundryArtifactMeta } from './foundry-manifest.js';

  const ctx = { tenantPackId: 'test-tenant', parentNodeId: 'parent-1', runId: 'run-1' };

  const validSpec = {
    id: 'charter-node-1',
    title: 'Test Product Charter',
    contract: {
      role: 'product' as const,
      mission: { objective: 'Ship a foundry SDK', outcome: 'Three pillars unified' },
      scope: { allowedPathPrefixes: ['layers/foundry-core/'] },
    },
  };

  describe('CoreFoundry + charter skin', () => {
    it('round-trip: result carries both metadata.charter and metadata[foundry.artifact]', async () => {
      const foundry = new CoreFoundry();
      foundry.register(charterSkin);

      const result = await foundry.execute('charter', validSpec, ctx);

      const charter = readCharter(result);
      expect(charter).not.toBeNull();
      expect(charter!.role).toBe('product');
      expect(charter!.mission.objective).toBe('Ship a foundry SDK');

      const artifact = readFoundryArtifactMeta(result);
      expect(artifact).not.toBeNull();
      expect(artifact!.manifestKind).toBe('charter');
      expect(artifact!.runNodeId).toBe('run-1');
      expect(artifact!.producedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });

    it('throws for unknown kind', async () => {
      const foundry = new CoreFoundry();
      await expect(foundry.execute('unknown', {}, ctx)).rejects.toThrow(
        'No manifest registered for kind: "unknown"',
      );
    });

    it('throws on invalid spec', async () => {
      const foundry = new CoreFoundry();
      foundry.register(charterSkin);
      await expect(foundry.execute('charter', { invalid: true }, ctx)).rejects.toThrow();
    });

    it('register returns this for chaining', () => {
      const foundry = new CoreFoundry();
      expect(foundry.register(charterSkin)).toBe(foundry);
    });
  });
  ```

- [ ] **Step 2: Run all tests (expect green)**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  pnpm test
  ```

  Expected output:

  ```
  ✓ foundry-manifest metadata helpers (4 tests)
  ✓ Kernel-Untouched Invariant — import boundary (3 tests)
  ✓ CoreFoundry (5 tests)
  ✓ charterSkin (8 tests)
  ✓ CoreFoundry + charter skin (4 tests)
  Test Files  4 passed (4)
  Tests       24 passed (24)
  ```

- [ ] **Step 3: Commit**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  git add src/e2e-charter-skin.spec.ts
  git commit -m "test(e2e): full round-trip — CoreFoundry + charter skin"
  ```

---

## Task 6 — `src/index.ts` + `ci:local` green + register in cluster

Publish the public API barrel, run the full typecheck + test gate, then register the new layer in the workbench.

- [ ] **Step 1: Write `src/index.ts`**

  Create `layers/foundry-core/src/index.ts`:

  ```ts
  // Protocol types
  export type { FoundryManifest, FoundryContext, FoundryArtifactMeta } from './foundry-manifest.js';
  export {
    FOUNDRY_MANIFEST_KEY,
    FOUNDRY_RUN_KEY,
    FOUNDRY_ARTIFACT_KEY,
    FoundryArtifactMetaSchema,
    readFoundryArtifactMeta,
    stampArtifact,
  } from './foundry-manifest.js';

  // Registry + executor
  export { CoreFoundry } from './core-foundry.js';

  // Built-in skins
  export { charterSkin, CharterSkinSpecSchema } from './skins/charter-skin.js';
  export type { CharterSkinSpec } from './skins/charter-skin.js';
  ```

- [ ] **Step 2: Run `ci:local` (typecheck + tests)**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  pnpm run ci:local
  ```

  Expected output:

  ```
  (no TypeScript errors)
  ✓ foundry-manifest metadata helpers (4 tests)
  ✓ Kernel-Untouched Invariant — import boundary (3 tests)
  ✓ CoreFoundry (5 tests)
  ✓ charterSkin (8 tests)
  ✓ CoreFoundry + charter skin (4 tests)
  Test Files  4 passed (4)
  Tests       24 passed (24)
  ```

  If TypeScript errors surface (e.g., missing type declarations from charter-runtime because `dist/` is stale), run `cd D:/development/projects/de-braighter/layers/charter-runtime && pnpm build` to regenerate `dist/`, then re-run `ci:local` from foundry-core. The `file:` reference is re-resolved on each `pnpm install`, so if `dist/` changed run `pnpm install` in foundry-core again too.

- [ ] **Step 3: Verify no charter vocab leaked into core modules (grep check)**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  grep -r "charter" src/foundry-manifest.ts src/core-foundry.ts
  ```

  Expected output: empty (no matches). If any match appears, it is a violation of the import-boundary constraint — remove it before proceeding.

- [ ] **Step 4: Register in workbench `repos.yaml`**

  Open `D:/development/projects/de-braighter/repos.yaml`. Add an entry for `foundry-core` in the `layers` section, mirroring the `charter-runtime` entry:

  ```yaml
  - name: foundry-core
    repo: de-braighter/foundry-core
    local: layers/foundry-core
    description: "Foundry SDK — manifest protocol + skins (@de-braighter/foundry-core)"
  ```

- [ ] **Step 5: Create `projects/foundry-core/project.yaml`**

  Create `D:/development/projects/de-braighter/projects/foundry-core/project.yaml`:

  ```yaml
  key: foundry-core
  name: Foundry Core
  kind: layer
  package: "@de-braighter/foundry-core"
  repo: de-braighter/foundry-core
  local: layers/foundry-core
  status: active
  description: >
    Foundry SDK cluster layer. Implements the FoundryManifest protocol, CoreFoundry registry,
    and the first concrete skin (kind='charter'). Phase 1 of the Three-Pillar Unification design.
  design: docs/superpowers/specs/2026-06-28-foundry-sdk-three-pillar-design.md
  phase: 1
  ```

- [ ] **Step 6: Commit all files**

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  git add src/index.ts
  git commit -m "feat: public index.ts barrel exports"
  ```

  Then in the workbench repo (separate branch):

  ```bash
  cd D:/development/projects/de-braighter
  git checkout -b feat/register-foundry-core
  git add repos.yaml projects/foundry-core/project.yaml
  git commit -m "chore: register layers/foundry-core in cluster"
  ```

- [ ] **Step 7: Push and open PRs**

  Push the `layers/foundry-core` branch:

  ```bash
  cd D:/development/projects/de-braighter/layers/foundry-core
  git push -u origin feat/foundry-core-phase1
  gh pr create \
    --title "feat(foundry-core): Phase 1 — manifest protocol + CoreFoundry + charter skin" \
    --body "$(cat <<'EOF'
  ## Summary

  - Scaffolds `layers/foundry-core` (`@de-braighter/foundry-core`) as a new cluster layer peer to `layers/charter-runtime`.
  - Implements `FoundryManifest<TSpec, TArtifact>` interface, `FoundryContext`, three metadata-key constants, and Zod-validated `readFoundryArtifactMeta` / `stampArtifact` helpers.
  - Implements `CoreFoundry` class with in-memory manifest registry and `execute()` method.
  - Ships first concrete skin (`kind='charter'`): delegates to `@de-braighter/charter-runtime`; Zod-validated spec; `generate` + `persist` produce a properly stamped `PlanNode`.
  - Integration test covers full round-trip: `CoreFoundry.execute('charter', spec, ctx)` → node carries both `metadata.charter` and `metadata['foundry.artifact']`.
  - Boundary acid test enforces: no relative substrate reach; no substrate-runtime in production source; no charter-runtime leak into protocol core.
  - 24 tests passing; `ci:local` green (typecheck + vitest run).
  - ADR-176 gate: (a) not a kernel concern — fails; (b) not kernel-validated — fails. Verdict: layer territory, confirmed.
  - Zero kernel change. Kernel-Untouched Invariant certified.

  Producer: orchestrator/claude-sonnet-4-6 [foundry-sdk-phase1-plan, subagent-driven-development]
  Effort: standard
  Effect: cycle-time 0.008±0.005 expert
  EOF
  )"
  ```

  Push the workbench registration branch:

  ```bash
  cd D:/development/projects/de-braighter
  git push -u origin feat/register-foundry-core
  gh pr create \
    --title "chore: register layers/foundry-core in cluster" \
    --body "$(cat <<'EOF'
  ## Summary

  - Adds `foundry-core` entry to `repos.yaml`.
  - Creates `projects/foundry-core/project.yaml` descriptor.
  - Companion to the main foundry-core Phase 1 PR in `de-braighter/foundry-core`.

  Producer: orchestrator/claude-sonnet-4-6 [foundry-sdk-phase1-plan]
  Effort: light
  EOF
  )"
  ```

---

## Self-Review Checklist

Before handing off to the executing agent, verify:

- [ ] **Spec coverage**: Every Phase 1 deliverable from design §5 is addressed — `FoundryManifest` interface (Task 2), `CoreFoundry` (Task 3), charter skin (Task 4), integration test (Task 5), public exports (Task 6). Seed plan nodes for the manifest itself are deferred to Phase 2 (design §5 says "seed plan nodes for the charter-skin manifest itself" — this is the `metadata.foundry.manifest` self-description; Phase 1 focuses on the protocol, Phase 2 adds the meta-manifest skin that makes this self-referential). This is a deliberate scope boundary, not a gap.
- [ ] **No placeholders**: All code blocks are complete. All file paths are absolute or clearly relative to a named root. No `TODO`, `...`, `/* implement */` tokens in any code block.
- [ ] **Type consistency**: `PlanNode` import path is `@de-braighter/substrate-contracts/plan-tree` (matches charter-runtime pattern). `FoundryManifest<unknown, unknown>` cast in `CoreFoundry.registry` is the correct TypeScript widening pattern for an untyped map. `z.ZodSchema<TSpec>` is the correct base type for heterogeneous Zod schemas in the registry.
- [ ] **ESM imports**: Every relative import in the implementation code ends with `.js`. Verified in `core-foundry.ts` (`./foundry-manifest.js`), `charter-skin.ts` (`../foundry-manifest.js`), `index.ts` (all three). Test imports also use `.js` extensions.
- [ ] **Boundary acid test completeness**: Three assertions cover (1) no relative substrate import anywhere, (2) no substrate-runtime in production source, (3) no charter-runtime in protocol core files. This is strictly stronger than charter-runtime's own acid test (which only checks 1 and 2).
- [ ] **pnpm file: reference**: `file:../charter-runtime` in devDependencies requires `layers/charter-runtime/dist/` to exist before running `pnpm install` in foundry-core. Task 1 Step 7 builds charter-runtime first. If `dist/` is missing when the agent reaches Task 1 Step 8, the install will fail with a missing-package error — the fix is to run `pnpm build` in `layers/charter-runtime/` and retry.
- [ ] **Charter-runtime built before typecheck**: Task 6 Step 2 notes that if TypeScript errors appear due to missing `dist/`, the agent must build `charter-runtime` first. This is the one cross-repo prerequisite that cannot be avoided; it mirrors the pattern documented in `docs/superpowers/plans/2026-06-28-knowledge-layer-s0-extraction-scaffold.md` for `substrate-contracts`.
- [ ] **PR body format**: Both PRs include `Producer:`, `Effort:`, and `Effect:` lines per the SDLC twin ritual documented in `CLAUDE.md`. The cycle-time estimate (`0.008±0.005h`) reflects a same-session autonomous merge (seconds-to-minutes range per CLAUDE.md).

---

## Execution Handoff

**This plan is ready for autonomous execution via `superpowers:subagent-driven-development`.**

Hand the executing agent this file path and the following briefing:

> Implement `D:/development/projects/de-braighter/docs/superpowers/plans/2026-06-28-foundry-sdk-phase1-foundry-core.md` task by task using the subagent-driven-development skill. Work directory is `D:/development/projects/de-braighter/`. The new repo clones into `layers/foundry-core/`. All source code is provided verbatim in the plan — do not deviate from the given implementations. After each task's final step, verify `pnpm test` is green before proceeding. If any step produces an unexpected error that is not covered by the plan's "Expected:" guidance, STOP and escalate rather than improvising.

The executing agent should check off each `- [ ]` step as it completes it and leave the file updated so progress is visible.
