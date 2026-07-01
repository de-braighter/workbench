# S3 Foundry Migration — Charter Runtime Dogfood

**Program:** Recursive Charter Node (layers/charter-runtime)
**Sub-project:** S3 — Foundry Migration
**ADR reserved:** ADR-287
**Date:** 2026-06-29
**Status:** design approved

## Context

S1 shipped the lifecycle runtime (74 tests, ADR-285). S2 shipped the blueprint engine — `extract → compile → generate` (97 tests, ADR-286). Both are in `layers/charter-runtime`.

S3 is the kill-criterion: **"does the charter layer work beyond a toy?"** The answer must be proved on a real, non-toy tree with real governance semantics. The foundry's own 6-node SDLC pipeline (`FOUNDRY_WORKFLOW`) is the dogfood subject.

**Hard constraint:** Kernel-Untouched Invariant — zero diff to `layers/substrate` production files. Enforced by Acid 9 (existing) + Acid 10 (new, S3).

**What S3 is not:** It does not wire `_dependsOn` pipeline ordering into the charter frontier (S5 concern), does not persist charter trees to Postgres (S4/S5), and does not add a charter skin to `foundry-core` (S5+).

## Dependency change

```
domains/foundry
  → @de-braighter/charter-runtime   ← NEW (file:../../layers/charter-runtime)
  → @de-braighter/foundry-core      (existing; already peers to charter-runtime)
  → @de-braighter/substrate-contracts ^2.7.0  (already at this version — Phase 7 resolved skew)
```

`foundry-core` already declares `@de-braighter/charter-runtime: ">=0.0.0"` as a peerDependency and `link:../charter-runtime` as a devDependency. `domains/foundry` needs it as a direct dep for the production `conductCharterStep` call.

## Architecture

### The state split

The workflow tree is a deterministic function of the spec:

```
buildCascadeTree(FOUNDRY_WORKFLOW)  →  PlanTree (always the same)
```

Only the charter lifecycle events are stateful. The split:

| Concern | Storage | Rationale |
|---|---|---|
| Tree structure | `StaticPlanTreeStore` (in-memory, reconstructed) | Deterministic from spec — no DB needed |
| Charter lifecycle events | `FileCharterEventLog` (`charter-events.jsonl`) | Durable; survives server restarts |

This is not a compromise — it is correct. `conductCharterStep` needs `planTreeStore.load(treeRootId)` and `eventLog.read(treeRootId)`. The `StaticPlanTreeStore` satisfies the port with no Postgres dependency. The `FileCharterEventLog` mirrors the foundry's existing `events.jsonl` pattern.

### Component map

```
domains/foundry/src/
  instances/
    foundry-workflow.ts          ← MODIFIED: +metadata.charter on 6 nodes
    foundry-workflow-charter.spec.ts  ← NEW: 5-assertion integration test
  mcp/
    charter-event-log.ts         ← NEW: FileCharterEventLog
    static-plan-tree-store.ts    ← NEW: StaticPlanTreeStore
    tools.ts                     ← MODIFIED: useCharter? flag on foundry_conduct_workflow

layers/charter-runtime/          ← MODIFIED: +Acid 10
layers/specs/adr/                ← NEW: adr-287-*.md
```

## Charter decoration of FOUNDRY_WORKFLOW

All 6 cascade nodes in `foundry-workflow.ts` gain `meta.charter: CharterContract`.

### Role mapping

`CharterRole` is one of: `product | task | epic | gate | review | adr | experiment`

- `DECOMPOSABLE_ROLES = ['product', 'epic', 'adr', 'experiment']` — advance by decomposing
- `CLAIMABLE_ROLES = ['task', 'gate', 'review']` — advance by claiming

| Cascade key | `kind` | Charter `role` | Notes |
|---|---|---|---|
| `foundry-workflow` | `product` | `product` | Decomposable root; 5 children already exist → frontier skips to children |
| `stage-intake` | `stage` | `task` | Claimable; no upstream dependencies in charter frontier |
| `stage-gate-greenlight` | `stage` | `gate` | Claimable; `gate` role signals a founder-decision boundary |
| `stage-build-path` | `stage` | `task` | Claimable |
| `stage-conduct` | `stage` | `task` | Claimable |
| `stage-ship` | `stage` | `task` | Claimable |

### Scope chain

`validateInheritance` uses segment-boundary-safe prefix matching: a child prefix `cp` is permitted iff `cp === parent` or `cp.startsWith(parent + '/')`.

| Node | `allowedPathPrefixes` | Covered by parent |
|---|---|---|
| `foundry-workflow` (root) | `['de-braighter']` | — (root) |
| `stage-intake` | `['de-braighter/workbench']` | starts with `de-braighter/` ✓ |
| `stage-gate-greenlight` | `['de-braighter/workbench']` | starts with `de-braighter/` ✓ |
| `stage-build-path` | `['de-braighter/foundry']` | starts with `de-braighter/` ✓ |
| `stage-conduct` | `['de-braighter/foundry']` | starts with `de-braighter/` ✓ |
| `stage-ship` | `['de-braighter']` | equals parent ✓ |

### Charter frontier behaviour in S3

`charterFrontier` reads `metadata._dependsOn` for dependency ordering. The cascade spec stores pipeline order in `metadata.dependsOn` (no underscore) — a different key. **S3 does not bridge these.** All 5 stage nodes surface as frontier entries in parallel. This is correct for S3's kill-criterion: we are proving claim mechanics, not pipeline ordering.

Pipeline ordering via `_dependsOn` is a named S5 follow-up.

### Mission/outcome shape

`CharterContractSchema.mission` requires `{ objective: string, outcome: string }`. Each stage gets a terse pair:

- `stage-intake`: objective = "Capture founder inputs", outcome = "Founder inputs recorded in workbench"
- `stage-gate-greenlight`: objective = "Greenlight gate — prioritise the product", outcome = "Product prioritised by founder"
- `stage-build-path`: objective = "Build path — spawn the product tree", outcome = "Product tree instantiated in foundry log"
- `stage-conduct`: objective = "Conduct — autonomous build loop", outcome = "Product items built and merged"
- `stage-ship`: objective = "Ship — release the product", outcome = "Product released to cluster"

## New files

### `FileCharterEventLog` (`src/mcp/charter-event-log.ts`)

Implements `CharterEventLog` port. JSONL envelope format:

```jsonl
{"treeRootId":"<uuid>","event":{...CharterEvent}}
```

- `read(treeRootId)` — parse all lines from `charter-events.jsonl`, filter by `treeRootId`, return `event` payloads
- `append(treeRootId, event)` — `appendFileSync` one JSONL line (sync, matches foundry's own log writer pattern)
- File created on first `append` if absent; the data dir is always present when the MCP server starts
- Data dir derived from `deps.logPath` via `path.dirname(deps.logPath)` — no new field on `FoundryDeps`

### `StaticPlanTreeStore` (`src/mcp/static-plan-tree-store.ts`)

Minimal `PlanTreeStore` implementation for a pre-built deterministic tree:

- Constructor takes `trees: PlanTree[]`, indexes by `treeRootId`
- `load(rootId)` — returns matching tree or `null`
- `save()` — no-op (spec is the source of truth)

Shared between the production charter path and the integration test.

## `foundry_conduct_workflow` extension

```ts
foundry_conduct_workflow: guard((a: {
  instance?: string;
  authorizeStage?: string;
  useCharter?: boolean;   // NEW
}) => {
  if (a.useCharter) {
    const charterTree = buildCascadeTree(FOUNDRY_WORKFLOW);
    const dataDir = path.dirname(deps.logPath);
    const eventLog = new FileCharterEventLog(path.join(dataDir, 'charter-events.jsonl'));
    const planTreeStore = new StaticPlanTreeStore([charterTree]);
    const charterDeps: CharterDeps = {
      eventLog,
      planTreeStore,
      tenantPackId: FOUNDRY_TENANT_PACK_ID,
      now: () => new Date().toISOString(),
      newId: () => randomUUID(),
    };
    return conductCharterStep(charterDeps, charterTree.treeRootId);
  }
  // existing conductWorkflowStep path — untouched
  const instance = a.instance ?? WORKFLOW_PRODUCT_KEY;
  const authorized = a.authorizeStage != null
    ? authorizeWorkflowStage(deps, a.authorizeStage, instance)
    : undefined;
  const step = conductWorkflowStep(deps, instance);
  return { ...(authorized != null ? { authorized: authorized.stage } : {}), step };
})
```

The existing path is **zero-regression** — `useCharter` is opt-in; all 21 live products are unaffected.

## Integration test (`src/instances/foundry-workflow-charter.spec.ts`)

Five assertions, all using `InMemoryCharterEventLog` + `StaticPlanTreeStore` — no file I/O, no DB, deterministic:

1. **extract** — `extract(buildCascadeTree(FOUNDRY_WORKFLOW), blueprintId)` yields exactly 6 `CharterBlueprintNode`s (all nodes carry valid `metadata.charter`)
2. **compile** — `compile(blueprint)` → `{ ok: true }` (root check, parent refs, inheritance chain all pass)
3. **generate** — `generate(blueprint, { newId, tenantPackId })` → `PlanTree` with 6 nodes, fresh UUIDs, valid `treeRootId`
4. **conductCharterStep first call** — against the charter tree → `{ status: 'advanced' }` (first frontier stage claimed)
5. **conductCharterStep second call** — second call on the same log → a second frontier stage claimed (`status: 'advanced'`, different `nodeId`); proves the fold is cumulative and the event log correctly gates already-claimed nodes

Estimated ~5 integration + ~8 unit tests (FileCharterEventLog + StaticPlanTreeStore) + Acid 10 = **~20 new tests**.

## Acid 10

Added to the `layers/charter-runtime` acid suite. Scans `layers/substrate` recursively for:

```
CharterContract | CharterRole | charter: | CHARTER_METADATA_KEY
```

Must find **0 hits** in any production file under `layers/substrate`. Mirrors Acid 9's implementation exactly (`readdirSync({ recursive: true })` + path-sep normalisation for Windows).

## Task list

| # | File | What |
|---|---|---|
| T1 | `domains/foundry/package.json` | Add `@de-braighter/charter-runtime: "file:../../layers/charter-runtime"` |
| T2 | `src/instances/foundry-workflow.ts` | Add `meta.charter` to all 6 `FOUNDRY_WORKFLOW` nodes |
| T3 | `src/mcp/charter-event-log.ts` | Implement `FileCharterEventLog` |
| T4 | `src/mcp/static-plan-tree-store.ts` | Implement `StaticPlanTreeStore` |
| T5 | `src/mcp/tools.ts` | Add `useCharter` flag + charter path to `foundry_conduct_workflow` |
| T6 | `src/instances/foundry-workflow-charter.spec.ts` | 5-assertion integration test |
| T7 | `layers/charter-runtime` acid suite | Add Acid 10 |
| T8 | `layers/specs/adr/adr-287-*.md` | Author ADR-287 |

## What S3 defers

| Concern | When |
|---|---|
| `_dependsOn` pipeline ordering in charter frontier | S5 (conduct+sync) |
| Postgres persistence of charter trees | S4/S5 |
| foundry-core charter skin (`gen_generate kind=charter`) | S5+ |
| Studio deploys charter trees to kernel | S5 |
| Second pack on the runtime (reuse proof) | S6 |
