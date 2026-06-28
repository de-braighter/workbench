# Foundry SDK Phase 4 — `domains/foundry` Strangler-Fig Migration onto CoreFoundry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `domains/foundry` so that `gen_generate` delegates through `CoreFoundry.execute()` as the execution seam, without breaking any of the 38 existing MCP tool APIs. This is a strangler-fig: all MCP callers see identical responses; the internals route through the CoreFoundry protocol.

**Key decisions (from architecture concierge, 2026-06-28):**

| Decision | Choice |
|----------|--------|
| CoreFoundry placement | Module singleton instantiated in `makeGenTools()`, guarded by `FOUNDRY_CORE_ENABLED` env var |
| gen_generate bridge pattern | Option A (thin wrapper): `CodeGenFn` wraps existing `generate()` — files + events still emitted inside it; bridge captures `GeneratedArtifactReport` via closure so MCP response format is unchanged |
| First migrated tool | `gen_generate` (highest value; proves the seam) |
| gen_preview routing | Deferred to Phase 5 (needs `dryRun` extension to `CodeSkinSpec` in foundry-core) |
| Knowledge skin wiring | Deferred to Phase 5 (`@de-braighter/knowledge` is `private: true`, no `exports`, no dist) |
| `foundry_*` control-plane tools | Phase 5+ (event-sourced state machine transitions ≠ `FoundryManifest` skins) |
| Kill-switch | `FOUNDRY_CORE_ENABLED=1` opt-in (server.ts) + `coreFoundry` optionality in `GenToolDeps` (per-tool fallback) |

**Tech Stack:** TypeScript 5.x, Zod 3.x, Vitest 2.x, Node.js ESM (`moduleResolution: NodeNext`), `@modelcontextprotocol/sdk`, `@de-braighter/foundry-core`.

## Global Constraints

- All relative imports **must end in `.js`** (ESM, NodeNext resolution) — never `.ts`
- **Zero breaking changes** to all 38 MCP tool APIs — responses identical in both paths
- **Strangler-fig**: `generate()` internals (file writes, JSONL event emission) are NOT changed; the bridge is a thin delegation layer
- Branch: **`feat/foundry-phase4-core-wiring`** branched from `main` in `domains/foundry`
- Working directory for all commands: `D:/development/projects/de-braighter/domains/foundry`
- Tests use `vitest` globals (`describe`, `it`, `expect`, `vi`, `beforeEach`) — no imports needed for those
- When `FOUNDRY_CORE_ENABLED` is unset or `'0'`: behavior is byte-for-byte identical to pre-Phase-4

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | **Modify** | Add `@de-braighter/foundry-core` dependency |
| `src/mcp/gen-tools.ts` | **Modify** | Extend `GenToolDeps` with `coreFoundry?: CoreFoundry`; wire bridge + CoreFoundry branch in `gen_generate` |
| `src/mcp/server.ts` | **Modify** | Import `CoreFoundry`; instantiate guarded by `FOUNDRY_CORE_ENABLED`; pass to `makeGenTools` |
| `src/generation/core-foundry-bridge.ts` | **Create** | `makeCodeGenBridge(deps)` → `{ genFn: CodeGenFn, getLastReport }` |
| `src/generation/core-foundry-bridge.spec.ts` | **Create** | 4 unit tests for the bridge adapter |
| `src/mcp/gen-tools.spec.ts` | **Create** | 2 integration tests: CoreFoundry path ≡ legacy path |

---

## Task 0: Plumbing — dependency + type extension (zero behavior)

**Goal:** Add `@de-braighter/foundry-core` to the package, extend `GenToolDeps`, and pass a `CoreFoundry` instance from `server.ts` — but register no skins and change no handler behavior. CI stays green.

- [ ] **Step 1: Add dependency**

In `package.json`, add to `"dependencies"`:
```json
"@de-braighter/foundry-core": "workspace:*"
```

If `domains/foundry` is not in the cluster pnpm workspace, substitute `"file:../../layers/foundry-core"` and verify `layers/foundry-core/dist/` is built and current (`pnpm run build` in that repo first).

Run: `pnpm install` (or `npm install`)

- [ ] **Step 2: Extend `GenToolDeps` in `src/mcp/gen-tools.ts`**

Add the import and the optional field:
```typescript
import type { CoreFoundry } from '@de-braighter/foundry-core';

// In the GenToolDeps interface:
coreFoundry?: CoreFoundry;   // absent → legacy path; present → CoreFoundry path
```

No handler code changes in this step.

- [ ] **Step 3: Instantiate `CoreFoundry` in `server.ts`**

Add import:
```typescript
import { CoreFoundry } from '@de-braighter/foundry-core';
```

In `main()`, before the `makeGenTools(...)` call:
```typescript
const useCoreFoundry = process.env['FOUNDRY_CORE_ENABLED'] === '1';
const coreFoundry = useCoreFoundry ? new CoreFoundry() : undefined;
```

Pass it to `makeGenTools` (adapt the actual call site):
```typescript
const gen = makeGenTools({ dataDir: DEFAULT_DATA_DIR, logPath: DEFAULT_LOG, now: deps.now, newId: deps.newId, coreFoundry });
```

No skins registered on `coreFoundry` yet — `makeTools(...)` is **not** changed.

- [ ] **Step 4: Typecheck + full CI**

```bash
npm run typecheck && npm run test
```

Expected: all existing tests PASS, `tsc --noEmit` clean.

Smoke boot: `FOUNDRY_CORE_ENABLED=0 npm run mcp` — server boots, all tools respond normally.

- [ ] **Step 5: Commit**

```bash
git add package.json src/mcp/gen-tools.ts src/mcp/server.ts
git commit -m "chore(phase4-s0): add foundry-core dep + CoreFoundry plumbing (zero behavior change)"
```

---

## Task 1: Bridge adapter

**Goal:** `makeCodeGenBridge(deps)` wraps `generate()` as a `CodeGenFn`, captures the full `GeneratedArtifactReport` via closure, and passes 4 unit tests.

**Why the closure pattern?** `CoreFoundry.execute()` returns a `PlanNode` (the persisted artifact node), not the `TArtifact` that `generate()` produces. The MCP `gen_generate` handler needs the full `GeneratedArtifactReport` (including `mode`, `slots`, `findings`, `templateSetVersion`). The bridge's closure captures the report before `execute()` discards it, so the MCP response format is preserved without changing `core-foundry.ts`'s API.

- [ ] **Step 1: Read `generate.ts` to confirm exported types**

Read `src/generation/generate.ts` and confirm:
- `GenerateDeps` is exported (add `export` if not)
- `GeneratedArtifactReport` is exported (add `export` if not)
- The exact fields of `GeneratedArtifactReport` (expected: `runId`, `kind`, `mode`, `modelHash`, `templateSetVersion`, `contextPackHash`, `claimRef`, `files`, `slots`, `findings`, `reproducible`)

- [ ] **Step 2: Write failing tests**

Create `src/generation/core-foundry-bridge.spec.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('./generate.js', () => ({
  generate: vi.fn(() => ({
    runId: 'run-1',
    kind: 'angular-feature',
    mode: 'bounded',
    modelHash: 'abc123',
    templateSetVersion: '1.0.0',
    contextPackHash: 'def456',
    claimRef: 'feat/my-feature',
    files: [{ path: 'src/foo.component.ts', bytes: 200 }],
    slots: [{ id: 'logic', filled: false, testRef: 'src/foo.component.spec.ts' }],
    findings: [],
    reproducible: true,
  })),
}));

import { generate } from './generate.js';
import { makeCodeGenBridge } from './core-foundry-bridge.js';

const deps = {
  logPath: join(tmpdir(), `bridge-test-${randomUUID()}.jsonl`),
  outDir:  join(tmpdir(), `bridge-test-out-${randomUUID()}`),
};

describe('makeCodeGenBridge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('genFn calls generate() with the correct deps and input', async () => {
    const bridge = makeCodeGenBridge(deps);
    await bridge.genFn({ kind: 'angular-feature', model: { name: 'Foo' }, claimRef: 'feat/foo' });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ logPath: deps.logPath, outDir: deps.outDir }),
      { kind: 'angular-feature', model: { name: 'Foo' }, claimRef: 'feat/foo' },
    );
  });

  it('genFn result satisfies CodeArtifact shape (runId, kind, files, reproducible)', async () => {
    const bridge = makeCodeGenBridge(deps);
    const artifact = await bridge.genFn({ kind: 'angular-feature', model: {}, claimRef: 'feat/x' });
    expect(artifact).toMatchObject({
      runId: 'run-1',
      kind: 'angular-feature',
      reproducible: true,
    });
    expect(artifact.files).toHaveLength(1);
  });

  it('getLastReport() returns null before any genFn call', () => {
    const bridge = makeCodeGenBridge(deps);
    expect(bridge.getLastReport()).toBeNull();
  });

  it('getLastReport() returns full GeneratedArtifactReport after genFn call (slots, mode, claimRef preserved)', async () => {
    const bridge = makeCodeGenBridge(deps);
    await bridge.genFn({ kind: 'angular-feature', model: {}, claimRef: 'feat/x' });
    const report = bridge.getLastReport();
    expect(report).not.toBeNull();
    expect(report!.mode).toBe('bounded');
    expect(report!.slots).toHaveLength(1);
    expect(report!.claimRef).toBe('feat/my-feature');
    expect(report!.templateSetVersion).toBe('1.0.0');
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

```bash
npx vitest run src/generation/core-foundry-bridge.spec.ts
```

Expected: FAIL — `Cannot find module './core-foundry-bridge.js'`

- [ ] **Step 4: Write the bridge implementation**

Create `src/generation/core-foundry-bridge.ts`:

```typescript
import type { CodeGenFn, CodeArtifact } from '@de-braighter/foundry-core';
import { generate, type GenerateDeps, type GeneratedArtifactReport } from './generate.js';

export interface CodeGenBridge {
  readonly genFn: CodeGenFn;
  /** Returns the full GeneratedArtifactReport from the most recent genFn call. */
  readonly getLastReport: () => GeneratedArtifactReport | null;
}

/**
 * Bridges the existing generate() function to the CoreFoundry CodeGenFn port.
 *
 * Option A (strangler-fig): generate() still writes files and emits JSONL events
 * internally. The bridge captures the full GeneratedArtifactReport via closure so
 * the MCP gen_generate handler can retrieve it after CoreFoundry.execute() returns
 * a PlanNode. Phase 5 will split generate() into render + persist (Option B).
 */
export function makeCodeGenBridge(deps: GenerateDeps): CodeGenBridge {
  let _lastReport: GeneratedArtifactReport | null = null;

  const genFn: CodeGenFn = async (input) => {
    _lastReport = generate(deps, input);
    return {
      runId:        _lastReport.runId,
      kind:         _lastReport.kind,
      files:        _lastReport.files,
      reproducible: _lastReport.reproducible,
      modelHash:    _lastReport.modelHash,
    } satisfies CodeArtifact;
  };

  return {
    genFn,
    getLastReport: () => _lastReport,
  };
}
```

**If `GenerateDeps` or `GeneratedArtifactReport` are not exported from `generate.ts`**, add `export` to their declarations now (no behavioral change to the function, just export visibility).

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run src/generation/core-foundry-bridge.spec.ts
```

Expected: 4/4 PASS.

- [ ] **Step 6: Full CI**

```bash
npm run typecheck && npm run test
```

Expected: all existing tests + 4 new bridge tests PASS, `tsc --noEmit` clean.

- [ ] **Step 7: Commit**

```bash
git add src/generation/core-foundry-bridge.ts src/generation/core-foundry-bridge.spec.ts
git commit -m "feat(phase4-s1): core-foundry bridge — CodeGenFn wrapping generate() with report capture"
```

---

## Task 2: Wire `gen_generate` → CoreFoundry path

**Goal:** `gen_generate` MCP handler routes through `CoreFoundry.execute('code', spec, ctx)` when `coreFoundry` is present; falls back to `generate()` directly when absent. MCP response format is identical in both paths. Passing 2 integration tests gates the merge.

- [ ] **Step 1: Write failing integration tests**

Create `src/mcp/gen-tools.spec.ts`:

```typescript
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../generation/generate.js', () => ({
  generate: vi.fn(() => ({
    runId: 'run-99',
    kind: 'pack-scaffold',
    mode: 'deterministic',
    modelHash: 'aabbcc',
    templateSetVersion: '1.0.0',
    contextPackHash: 'ddeeff',
    claimRef: 'feat/scaffold',
    files: [{ path: 'src/scaffold.ts', bytes: 50 }],
    slots: [],
    findings: [],
    reproducible: true,
  })),
}));

import { CoreFoundry } from '@de-braighter/foundry-core';
import { makeGenTools } from './gen-tools.js';

const testDeps = {
  dataDir: join(tmpdir(), `gen-tools-test-${randomUUID()}`),
  logPath: join(tmpdir(), `gen-tools-test-${randomUUID()}.jsonl`),
};

describe('gen_generate MCP handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('CoreFoundry path: MCP response contains full GeneratedArtifactReport fields', async () => {
    const coreFoundry = new CoreFoundry();
    const tools = makeGenTools({ ...testDeps, coreFoundry });

    const result = await tools.gen_generate({
      kind: 'pack-scaffold',
      model: { name: 'my-pack' },
      claimRef: 'feat/scaffold',
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.runId).toBe('run-99');
    expect(parsed.kind).toBe('pack-scaffold');
    expect(parsed.mode).toBe('deterministic');
    expect(parsed.files).toHaveLength(1);
    expect(parsed.reproducible).toBe(true);
    expect(parsed.claimRef).toBe('feat/scaffold');
  });

  it('legacy path: identical report when coreFoundry is absent', async () => {
    const tools = makeGenTools(testDeps); // no coreFoundry

    const result = await tools.gen_generate({
      kind: 'pack-scaffold',
      model: { name: 'my-pack' },
      claimRef: 'feat/scaffold',
    });

    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.runId).toBe('run-99');
    expect(parsed.kind).toBe('pack-scaffold');
  });
});
```

**Note on `guard()` response shape:** The `guard()` wrapper serializes the return value as `{ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }`. Adjust the assertion format if the actual serialization differs — read `src/mcp/tools.ts` guard implementation to confirm the exact shape.

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run src/mcp/gen-tools.spec.ts
```

Expected: FAIL — `gen_generate` routes to legacy path in both cases (CoreFoundry branch not yet wired).

- [ ] **Step 3: Wire `gen_generate` branch + `makeSyntheticCtx` in `gen-tools.ts`**

In `src/mcp/gen-tools.ts`, add imports at the top:

```typescript
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CoreFoundry, createCodeSkin, type FoundryContext } from '@de-braighter/foundry-core';
import { makeCodeGenBridge } from '../generation/core-foundry-bridge.js';
import { generate } from '../generation/generate.js';
```

Add `makeSyntheticCtx` helper (before `makeGenTools`):

```typescript
function makeSyntheticCtx(deps: Pick<GenToolDeps, 'newId'>): FoundryContext {
  const newId = deps.newId ?? (() => randomUUID());
  return {
    tenantPackId: 'foundry-mcp',  // synthetic — local MCP server, not a multi-tenant runtime
    parentNodeId: newId(),
    runId: newId(),
  };
}
```

At the top of `makeGenTools`, add bridge setup before the returned object:

```typescript
export function makeGenTools(deps: GenToolDeps) {
  // Phase 4: build bridge + register code skin when CoreFoundry is enabled
  const bridge = deps.coreFoundry
    ? makeCodeGenBridge({
        logPath: deps.logPath,
        outDir: join(deps.dataDir, 'generated'),
        now: deps.now,
        newId: deps.newId,
      })
    : null;

  if (bridge && deps.coreFoundry) {
    deps.coreFoundry.register(createCodeSkin(bridge.genFn));
  }

  return {
    // ... all existing gen_* handlers unchanged, EXCEPT gen_generate below ...

    gen_generate: guard(async (a: { kind: string; model: unknown; claimRef: string }) => {
      if (bridge && deps.coreFoundry) {
        await deps.coreFoundry.execute('code', a, makeSyntheticCtx(deps));
        return bridge.getLastReport()!;
      }
      // Legacy path — identical to pre-Phase-4
      return generate(
        { logPath: deps.logPath, outDir: join(deps.dataDir, 'generated'), now: deps.now, newId: deps.newId },
        a,
      );
    }),

    // gen_preview, gen_validate_model, gen_list_kinds, gen_describe_schema,
    // gen_describe_op_catalog, gen_verify_artifact, gen_explain_failure, gen_propose_op
    // — ALL UNCHANGED; leave their implementations exactly as they are
  };
}
```

**Critical:** Only `gen_generate` gets the new branch. Every other handler in `gen-tools.ts` and all of `tools.ts` (the 29 `foundry_*` tools) must remain untouched.

- [ ] **Step 4: Run integration tests**

```bash
npx vitest run src/mcp/gen-tools.spec.ts
```

Expected: 2/2 PASS — CoreFoundry path and legacy path both produce the same `runId`, `kind`, `mode`, `files`, `reproducible`, `claimRef`.

- [ ] **Step 5: Full CI + smoke**

```bash
npm run typecheck && npm run test
```

Expected: all tests PASS (existing + 4 bridge + 2 integration), `tsc --noEmit` clean.

End-to-end smoke — start server with CoreFoundry enabled and call `gen_generate` for each kind:
```bash
FOUNDRY_CORE_ENABLED=1 npm run mcp
# In a Claude Code session, call gen_generate once per kind:
# angular-feature, service-method, pack-scaffold
# Verify: files written to <dataDir>/generated/; events in events.jsonl
```

Also verify the kill-switch:
```bash
FOUNDRY_CORE_ENABLED=0 npm run mcp
# Call gen_generate — must behave identically to pre-Phase-4
```

- [ ] **Step 6: Commit**

```bash
git add src/mcp/gen-tools.ts src/mcp/gen-tools.spec.ts
git commit -m "feat(phase4-s2): gen_generate routes through CoreFoundry.execute() when FOUNDRY_CORE_ENABLED=1"
```

---

## Task 3: Push + PR

- [ ] **Step 1: Final CI gate**

```bash
npm run typecheck && npm run test
```

Expected: all tests PASS.

- [ ] **Step 2: Push and open PR**

```bash
git push -u origin feat/foundry-phase4-core-wiring
gh pr create \
  --repo de-braighter/foundry \
  --base main \
  --title "feat(foundry): Phase 4 — gen_generate wired through CoreFoundry.execute()" \
  --body "$(cat <<'EOF'
## Summary

- Establishes `@de-braighter/foundry-core` as the execution backbone seam for `gen_generate` (the strangler-fig entry point)
- `makeCodeGenBridge()` wraps the existing `generate()` function as a `CodeGenFn` (Option A — thin wrapper; `generate()` still writes files + emits JSONL events internally; the seam is the `CoreFoundry.execute()` call, not a behavioral change)
- Bridge uses closure (`_lastReport`) to capture the full `GeneratedArtifactReport` — `CoreFoundry.execute()` returns `PlanNode`, so this is the only way to preserve the MCP response format
- `gen_generate` branches on `deps.coreFoundry` presence: CoreFoundry path calls `execute('code', spec, ctx)` then returns the captured report; legacy path calls `generate()` directly — byte-for-byte identical
- Kill-switch: `FOUNDRY_CORE_ENABLED=1` (server.ts opt-in); when unset, legacy path runs
- **Zero breaking changes** to all 38 MCP tool APIs; zero changes to `generate.ts`, `tools.ts`, or any `foundry_*` handler

## Architecture note

This is Option A of the Phase 4 concierge design. The `CoreFoundry.execute()` call is the seam — observable, interceptable, replaceable. Phase 5 will split `generate()` into `render()` (pure, returns files with content) + `persist()` (writes + emits events), giving CoreFoundry full ownership of the write path (Option B). Phase 5 scope: `gen_preview` routing (needs `dryRun` extension to `CodeSkinSpec`), `createKnowledgeSkin` wiring (blocked on `@de-braighter/knowledge-contracts` extraction), `foundry_compile_blueprint → planTreeSkin`, `foundry_*` control-plane charter integration.

## Test plan

- [ ] `npm run typecheck && npm run test` → all green
- [ ] Bridge unit tests (4): `genFn` delegates to `generate()`; `getLastReport()` returns full report with `mode`, `slots`, `claimRef`
- [ ] `gen_generate` integration tests (2): CoreFoundry path report ≡ legacy path report; legacy path unaffected when `coreFoundry` absent
- [ ] `FOUNDRY_CORE_ENABLED=0 npm run mcp` → server boots; all 38 tools work as pre-Phase-4
- [ ] `FOUNDRY_CORE_ENABLED=1 npm run mcp` + `gen_generate` for each kind → files written to `generated/`; events in `events.jsonl`; response format unchanged

Producer: orchestrator/claude-sonnet-4-6 [architecture-concierge, writing-plans]
Effort: standard
Effect: cycle-time 0.008±0.003 expert
Effect: findings 1±1 expert
EOF
)"
```

- [ ] **Step 3: Report PR URL**

Print the PR URL so the post-merge ritual can be run.

---

## Self-Review Checklist

### Spec coverage
- [x] `@de-braighter/foundry-core` added as dependency → Task 0
- [x] `GenToolDeps.coreFoundry?: CoreFoundry` type extension → Task 0
- [x] `CoreFoundry` singleton in `server.ts`, guarded by `FOUNDRY_CORE_ENABLED` → Task 0
- [x] Bridge `makeCodeGenBridge` creates `genFn` + `getLastReport` closure → Task 1
- [x] Bridge unit tests (4) → Task 1
- [x] `gen_generate` CoreFoundry branch (`execute` + `getLastReport`) → Task 2
- [x] Legacy fallback path preserved when `coreFoundry` absent → Task 2
- [x] `gen_generate` integration tests (2) → Task 2
- [x] All 37 other MCP tools untouched → verified by no changes to `tools.ts` or other gen handlers
- [x] MCP response format identical in both paths → Task 2 integration test assertions
- [x] Kill-switch verified (FOUNDRY_CORE_ENABLED=0 + FOUNDRY_CORE_ENABLED=1) → Task 2 smoke

### What is NOT in Phase 4 (Phase 5 scope)

| Item | Blocker |
|------|---------|
| `gen_preview` via CoreFoundry | Needs `dryRun?: boolean` added to `CodeSkinSpec` in `foundry-core` |
| Knowledge skin wiring | `@de-braighter/knowledge` is `private: true`, no `exports`, no dist — needs `knowledge-contracts` split |
| `foundry_compile_blueprint → planTreeSkin` | Needs compiler target → skin mapping design |
| `foundry_generate_from_blueprint → metaSkin` | Well-aligned; deferred to keep Phase 4 blast radius minimal |
| All `foundry_*` control-plane tools | Event-sourced state machine ≠ `FoundryManifest` skin; needs charter-runtime integration design |
| Option B (pure render/persist split) | Requires refactoring `generate.ts`; no external blockers but higher risk |
| Attaching `PlanNode` from `execute()` to substrate | Needs `SubstrateClient` in `domains/foundry`; deferred to observability phase |

### Placeholder scan
None.
