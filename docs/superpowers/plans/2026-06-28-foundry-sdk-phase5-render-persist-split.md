# Foundry SDK Phase 5 — Render/Persist Split + `gen_preview` Consolidation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `generate.ts` into a pure `render()` function and a side-effectful `persist()` function (Option B from Phase 4 design). This eliminates the logic duplication between `preview.ts` and `generate.ts`, gives `gen_preview` a clean path through `render()`, and makes the bridge explicit about pure vs side-effectful steps. Zero breaking changes to any MCP API.

**Architecture decision summary (concierge 2026-06-28):**

| Question | Decision |
|----------|----------|
| `gen_preview` via CoreFoundry? | NO — preview is ephemeral; no PlanNode value; route through `render()` directly |
| `dryRun` in `CodeSkinSpec`? | NO — wrong layer; not needed |
| Option B (render/persist split)? | YES — the core Phase 5 work |
| Blast radius | `domains/foundry` only — no foundry-core changes |
| `foundry_generate_from_blueprint → metaSkin` | DEFERRED — poor fit, needs design |
| `foundry_*` control-plane tools | DEFERRED — charter-runtime design required |
| Knowledge skin | DEFERRED — `@de-braighter/knowledge` still private/no-dist |

**Tech stack:** TypeScript 5.x, Vitest 2.x, Node.js ESM (`moduleResolution: NodeNext`).

**Branch:** `feat/foundry-phase5-render-persist-split` branched from `main` in `domains/foundry`.

---

## Global Constraints

- All relative imports **must end in `.js`** (ESM, NodeNext) — never `.ts`
- **Zero breaking changes** to all 38 MCP tool APIs
- `generate.ts` **external API unchanged**: `generate(deps: GenerateDeps, input): GeneratedArtifactReport` still works
- **`preview.ts` external API unchanged**: `preview(kind, model): PreviewResult` still works
- `sdk.preview()` and `sdk.generate()` in `index.ts` still exported — `gen_preview` and `gen_generate` callers unchanged
- The new `render()` function **must NOT be exported from `index.ts`** (naming conflict: `index.ts` already exports `render` from `./renderers/angular-feature.js` for backward-compat)
- Working directory for all commands: `D:/development/projects/de-braighter/domains/foundry`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/generation/render.ts` | **Create** | Pure render: validate → kindInfo → contextPack → hash → renderFn → determinism → return `RenderedOutput` |
| `src/generation/render.spec.ts` | **Create** | Unit tests for `render()` — pure, easily testable |
| `src/generation/persist.ts` | **Create** | Side-effectful: build slot report, write files, append events, return `GeneratedArtifactReport` |
| `src/generation/persist.spec.ts` | **Create** | Unit tests for `persist()` |
| `src/generation/generate.ts` | **Modify** | Thin wrapper: `render()` + `persist()` (API unchanged) |
| `src/generation/preview.ts` | **Modify** | Replace duplicated render logic with `render()` (API unchanged) |
| `src/generation/core-foundry-bridge.ts` | **Modify** | Use `render()` + `persist()` directly instead of `generate()` |

---

## Types

### `RenderedOutput` (from `render.ts`)

```typescript
export interface RenderedOutput {
  kind: string;
  files: RenderedFile[];          // includes body — RenderedFile = { path: string; body: string }
  slots: SlotRef[];               // unfilled — SlotRef = { id: string } at minimum
  mode: GenerationMode;
  modelHash: string;
  templateSetVersion: string;
  contextPackHash: string;
  reproducible: boolean;
}

export interface RenderInput {
  kind: string;
  model: unknown;
  contextPack?: ContextPack;      // optional — defaults to buildContextPack() if absent
}
```

### `render(input: RenderInput): RenderedOutput`

Pure — no I/O. Runs: `validateModel → GENERATION_KINDS.get → getRenderer → buildContextPack → hashModel → renderFn → determinism self-check`. Throws on invalid kind or model.

### `persist(deps: GenerateDeps, rendered: RenderedOutput, meta: { claimRef: string; runId: string; ts: string }): GeneratedArtifactReport`

Side-effectful. Runs: compute `fileReport` (path+bytes), compute `slotReport` (isSlotFilled from logic file body), build+validate event envelopes (`generationRun`, `artifactGenerated`), write file tree under `outDir`, append two JSONL events. Returns full `GeneratedArtifactReport`.

---

## Task 1: Create `render.ts` and `render.spec.ts`

**Goal:** Pure render function + unit tests.

- [ ] **Step 1: Read the following files first**

  Read these to confirm exact types and function signatures before writing:
  - `src/generation/generate.ts` (full) — extract the render logic
  - `src/generation/preview.ts` (full) — confirm duplication
  - `src/generation/renderers/index.ts` — confirm `RenderedFile`, `SlotRef` types
  - `src/generation/slots.ts` — confirm `SlotRef` type
  - `src/generation/hash.ts` — confirm `hashModel` signature

- [ ] **Step 2: Create `src/generation/render.ts`**

  ```typescript
  import { validateModel } from './validate.js';
  import { getRenderer, type RenderedFile } from './renderers/index.js';
  import { buildContextPack, type ContextPack } from './context-packs/index.js';
  import { GENERATION_KINDS, type GenerationKind } from './kinds.js';
  import { hashModel } from './hash.js';
  import type { GenerationMode } from './modes.js';
  import type { SlotRef } from './slots.js';

  export interface RenderInput {
    kind: string;
    model: unknown;
    contextPack?: ContextPack;
  }

  export interface RenderedOutput {
    kind: string;
    files: RenderedFile[];
    slots: SlotRef[];
    mode: GenerationMode;
    modelHash: string;
    templateSetVersion: string;
    contextPackHash: string;
    reproducible: boolean;
  }

  export function render(input: RenderInput): RenderedOutput {
    const v = validateModel(input.kind, input.model);
    if (!v.ok) {
      const detail = [...v.schemaErrors, ...v.policyFindings.map((f) => `${f.policy}: ${f.message}`)].join('; ');
      throw new Error(`cannot generate — invalid model: ${detail}`);
    }
    const info = GENERATION_KINDS.get(input.kind as GenerationKind);
    if (!info) throw new Error(`unknown kind: ${input.kind}`);

    const model = input.model as { templateSetVersion: string };
    const renderFn = getRenderer(input.kind);
    const pack = input.contextPack ?? buildContextPack({ schemas: [info.schemaRef] });
    const modelHash = hashModel(model);
    const { files, slots } = renderFn(model, model.templateSetVersion, pack.hash);

    const second = renderFn(model, model.templateSetVersion, pack.hash);
    const reproducible = JSON.stringify(second.files) === JSON.stringify(files);

    return { kind: input.kind, files, slots, mode: info.mode, modelHash, templateSetVersion: model.templateSetVersion, contextPackHash: pack.hash, reproducible };
  }
  ```

- [ ] **Step 3: Create `src/generation/render.spec.ts`**

  Test a real kind (`angular-feature` or `pack-scaffold`) — use a minimal valid model. Tests:
  1. Returns correct `kind`, `mode`, `modelHash`, `reproducible: true`
  2. Returns `files` array with `path` and `body` strings
  3. Returns `slots` array (may be empty)
  4. Throws on unknown kind
  5. Throws on invalid model

  Use real model fixtures (not mocks) since `render()` is pure and fast.

- [ ] **Step 4: Run render tests**

  ```bash
  npx vitest run src/generation/render.spec.ts
  ```

  Expected: 5/5 pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/generation/render.ts src/generation/render.spec.ts
  git commit -m "feat(phase5-s1): pure render() function extracted from generate.ts"
  ```

---

## Task 2: Create `persist.ts` and `persist.spec.ts`

**Goal:** Side-effectful persist function + unit tests.

- [ ] **Step 1: Read these files first**

  - `src/generation/generate.ts` — extract the persist logic (file writes, events, slot report)
  - `src/generation/slots.ts` — confirm `isSlotFilled` signature
  - `src/events.ts` — confirm `generationRun`, `artifactGenerated` signatures

- [ ] **Step 2: Create `src/generation/persist.ts`**

  ```typescript
  import { mkdirSync, writeFileSync } from 'node:fs';
  import { dirname, join } from 'node:path';
  import { append } from '../log.js';
  import { generationRun, artifactGenerated } from '../events.js';
  import { isSlotFilled } from './slots.js';
  import type { GenerateDeps, GeneratedArtifactReport } from './generate.js';
  import type { RenderedOutput } from './render.js';

  export function persist(
    deps: GenerateDeps,
    rendered: RenderedOutput,
    meta: { claimRef: string; runId: string; ts: string },
  ): GeneratedArtifactReport {
    const fileReport = rendered.files.map((f) => ({ path: f.path, bytes: Buffer.byteLength(f.body, 'utf8') }));
    const logicFile = rendered.files.find((f) => f.path.endsWith('.logic.ts'));
    const specFile = rendered.files.find((f) => f.path.endsWith('.spec.ts'));
    const slotReport = rendered.slots.map((s) => ({
      id: s.id,
      filled: logicFile ? isSlotFilled(logicFile.body, s.id) : false,
      testRef: specFile?.path,
    }));

    // Validate event envelopes before any side effects
    const runEvent = generationRun({
      runId: meta.runId, kind: rendered.kind, mode: rendered.mode,
      modelHash: rendered.modelHash, templateSetVersion: rendered.templateSetVersion,
      contextPackHash: rendered.contextPackHash, claimRef: meta.claimRef, ts: meta.ts,
    });
    const artifactEvent = artifactGenerated({
      runId: meta.runId, kind: rendered.kind, files: fileReport, slots: slotReport, ts: meta.ts,
    });

    for (const file of rendered.files) {
      const abs = join(deps.outDir, file.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, file.body, 'utf8');
    }

    append(runEvent, deps.logPath);
    append(artifactEvent, deps.logPath);

    return {
      runId: meta.runId, kind: rendered.kind, mode: rendered.mode, modelHash: rendered.modelHash,
      templateSetVersion: rendered.templateSetVersion, contextPackHash: rendered.contextPackHash,
      claimRef: meta.claimRef, files: fileReport, slots: slotReport, findings: [], reproducible: rendered.reproducible,
    };
  }
  ```

  **Note on circular import:** `persist.ts` imports `GenerateDeps` from `generate.ts`. To avoid a circular import (`generate.ts` imports from `persist.ts` and vice versa), extract `GenerateDeps` and `GeneratedArtifactReport` into a shared types file (`src/generation/generate-types.ts`) if needed — check if circular import occurs before creating the types file.

- [ ] **Step 3: Create `src/generation/persist.spec.ts`**

  Use a real `RenderedOutput` fixture (from `render()` or hand-written). Tests:
  1. Writes files to `outDir` (verify with `existsSync`)
  2. Appends events to `logPath` (verify with `readFileSync`)
  3. Returns correct `GeneratedArtifactReport` shape (runId, kind, mode, files, slots, reproducible)
  4. `slotReport.filled` is `false` when logic file absent

- [ ] **Step 4: Run persist tests**

  ```bash
  npx vitest run src/generation/persist.spec.ts
  ```

  Expected: 4/4 pass.

- [ ] **Step 5: Commit**

  ```bash
  git add src/generation/persist.ts src/generation/persist.spec.ts
  git commit -m "feat(phase5-s2): side-effectful persist() function extracted from generate.ts"
  ```

---

## Task 3: Refactor callers — `generate.ts`, `preview.ts`, `core-foundry-bridge.ts`

**Goal:** All three callers delegate to `render()` + `persist()`. All existing tests pass. API unchanged.

- [ ] **Step 1: Refactor `generate.ts`**

  Replace the body with a thin delegation:

  ```typescript
  import { randomUUID } from 'node:crypto';
  import type { ContextPack } from './context-packs/index.js';
  import { render } from './render.js';
  import { persist } from './persist.js';

  export interface GenerateDeps { logPath: string; outDir: string; now?: () => string; newId?: () => string }
  export type { GeneratedArtifactReport } from './generate-types.js'; // or keep inline if no circular

  export function generate(
    deps: GenerateDeps,
    input: { kind: string; model: unknown; claimRef: string; contextPack?: ContextPack },
  ): GeneratedArtifactReport {
    const now = (deps.now ?? (() => new Date().toISOString()))();
    const newId = deps.newId ?? (() => randomUUID());
    const runId = newId();
    const rendered = render({ kind: input.kind, model: input.model, contextPack: input.contextPack });
    return persist(deps, rendered, { claimRef: input.claimRef, runId, ts: now });
  }
  ```

  **Circular import check:** If `persist.ts` imports `GenerateDeps` from `generate.ts` and `generate.ts` imports `persist`, you have a cycle. Resolution: move `GenerateDeps` + `GeneratedArtifactReport` to `src/generation/generate-types.ts`, import from there in both files.

- [ ] **Step 2: Refactor `preview.ts`**

  Replace the render duplication with `render()`:

  ```typescript
  import { render } from './render.js';
  import type { RenderedFile } from './renderers/index.js';
  import type { GenerationMode } from './modes.js';
  import type { SlotRef } from './slots.js';

  export interface PreviewResult { files: RenderedFile[]; slots: SlotRef[]; mode: GenerationMode }

  export function preview(kind: string, model: unknown): PreviewResult {
    const rendered = render({ kind, model });
    return { files: rendered.files, slots: rendered.slots, mode: rendered.mode };
  }
  ```

- [ ] **Step 3: Refactor `core-foundry-bridge.ts`**

  Replace `generate()` call with explicit `render()` + `persist()`:

  ```typescript
  import type { CodeGenFn, CodeArtifact } from '@de-braighter/foundry-core';
  import { render } from './render.js';
  import { persist } from './persist.js';
  import type { GenerateDeps, GeneratedArtifactReport } from './generate.js';

  // (CodeGenBridge interface and makeCodeGenBridge signature unchanged)

  const genFn: CodeGenFn = async (input) => {
    _lastReport = null; // prevents stale report if render() or persist() throws
    const now = (deps.now ?? (() => new Date().toISOString()))();
    const newId = deps.newId ?? (() => randomUUID());
    const runId = newId();
    const rendered = render({ kind: input.kind, model: input.model });
    const report = persist(deps, rendered, { claimRef: input.claimRef, runId, ts: now });
    _lastReport = report;
    return {
      runId: report.runId, kind: report.kind, files: report.files,
      reproducible: report.reproducible, modelHash: report.modelHash,
    } satisfies CodeArtifact;
  };
  ```

- [ ] **Step 4: Full CI**

  ```bash
  npm run typecheck && npm run test
  ```

  Expected: all 1129+ existing tests PASS + new render + persist unit tests. `tsc --noEmit` clean.

- [ ] **Step 5: Commit**

  ```bash
  git add src/generation/generate.ts src/generation/preview.ts src/generation/core-foundry-bridge.ts
  git commit -m "refactor(phase5-s3): generate + preview + bridge delegate to render() + persist()"
  ```

---

## Self-Review Checklist

### Spec coverage
- [ ] `src/generation/render.ts` — pure render function with `RenderInput` + `RenderedOutput` types
- [ ] `src/generation/render.spec.ts` — 5 unit tests (valid render, files shape, slots, unknown kind, invalid model)
- [ ] `src/generation/persist.ts` — side-effectful persist with correct event envelopes
- [ ] `src/generation/persist.spec.ts` — 4 unit tests (files written, events appended, report shape, slot filling)
- [ ] `generate.ts` refactored — thin wrapper, same external API
- [ ] `preview.ts` refactored — uses `render()`, same external API
- [ ] `core-foundry-bridge.ts` refactored — uses `render()` + `persist()` explicitly
- [ ] Zero circular imports (check: generate-types.ts extraction if needed)
- [ ] `render()` NOT exported from `index.ts` (naming conflict with backward-compat slice-1 export)
- [ ] All 1129 existing tests pass
- [ ] `npm run typecheck` clean

### What is NOT in Phase 5

| Item | Blocker | Phase |
|------|---------|-------|
| `gen_preview` CoreFoundry routing | Ephemeral — no PlanNode value | Never (correctly out of scope) |
| `dryRun` in `CodeSkinSpec` | Not needed | Dropped |
| Knowledge skin wiring | `@de-braighter/knowledge` private/no-dist | Phase 6+ |
| `foundry_compile_blueprint → planTreeSkin` | Needs skin-mapping design | Phase 6 |
| `foundry_generate_from_blueprint → metaSkin` | Poor fit — different shapes | Phase 6 with redesign |
| All `foundry_*` control-plane tools | Charter-runtime integration required | Phase 6+ |
| Attaching PlanNode to substrate | Needs SubstrateClient | Phase 6+ |
| Option C (CoreFoundry owns persist path) | Needs `CodePersistFn` in foundry-core | Phase 6 |
