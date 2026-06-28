# S1 — Uniform Charter Lifecycle Runtime

- **Date:** 2026-06-28
- **Status:** Approved for implementation
- **Sub-project:** S1 of the recursive-charter-runtime program
- **Scope:** `layers/charter-runtime` only — zero kernel change
- **Precondition:** Slice 0 merged (`charter-runtime#1`, `substrate#202`, `specs#375`/ADR-283 ratified)
- **Supersedes:** nothing (extends Slice 0)
- **Produces:** ADR-285 (lifecycle protocol rationale, to be authored alongside implementation)

## 1. Purpose

Slice 0 delivered a walking skeleton: one event type (`NoteRecorded`), one action (`record-note`), two resolutions (`done | rejected`), and a single lifecycle pass with no re-derivation. S1 generalises this into a **full, domain-agnostic charter lifecycle runtime** inside `layers/charter-runtime`:

- The complete 8-stage lifecycle: `intake → validate → decompose-or-claim → execute → verify → gate → record → resolve`
- The complete resolution set: `done | expanded | blocked | rejected | superseded`
- A derived frontier over a hierarchical (growing) charter tree
- A generalised `ACTION_REGISTRY` (6 action kinds, closed map)
- A `CharterEventLog` port + in-memory adapter for lifecycle event persistence
- A `conductCharterStep` driver (the domain-agnostic conductor)
- 9 load-bearing acid tests

Zero kernel change. The Kernel-Untouched Invariant (ADR-283 D2) continues to hold.

## 2. Architecture

### 2.1 Module layout

New and modified files in `layers/charter-runtime/src/`:

```
src/
  # EXISTING (Slice 0) — changes noted
  charter-node.ts          ← ADD roles: epic | gate | review | adr | experiment
  inheritance.ts           ← UNCHANGED — canonical validateInheritance
  lifecycle.ts             ← kept; runLifecyclePass stays as backward-compat thin wrapper

  # NEW (S1)
  lifecycle-events.ts      ← CharterEvent discriminated union (6 types, .v1 versioned)
  lifecycle-state.ts       ← foldCharterLifecycleState → CharterLifecycleState
  event-log.port.ts        ← CharterEventLog port + InMemoryCharterEventLog adapter
  frontier.ts              ← charterFrontier(tree, state, nowMs): FrontierEntry[]
  action-registry.ts       ← ACTION_REGISTRY (6 action kinds, closed map, async handlers)
  conduct.ts               ← CharterDeps + conductCharterStep(deps, treeRootId)

  # UPDATED
  index.ts                 ← publish new surface; keep all Slice-0 exports

  testing/
    fixtures.ts            ← extend: add single-root-no-children fixture for decompose tests
    fake-plan-tree-prisma.ts  ← UNCHANGED
```

### 2.2 CharterDeps

The conductor's dependency bag, mirrors `FoundryDeps`:

```typescript
interface CharterDeps {
  eventLog: CharterEventLog;   // lifecycle event persistence
  planTreeStore: PlanTreeStore; // kernel store (used by decompose-node: load + save)
  tenantPackId: string;
  now: () => string;            // injectable ISO timestamp — never called inside fold
  newId: () => string;          // injectable UUID — never called inside fold
}
```

`now` and `newId` are injected so the fold path remains replay-stable (no `Date.now()` or `Math.random()` inside `foldCharterLifecycleState`). `planTreeStore` is the kernel's existing `PlanTreeStore` port — no new kernel operation is introduced.

## 3. Lifecycle events + `foldCharterLifecycleState`

### 3.1 `CharterEvent` union (`lifecycle-events.ts`)

```typescript
export type CharterEvent =
  // Slice 0 — kept
  | { type: 'charter:NoteRecorded.v1';
      nodeId: string; payload: { note: string }; occurredAt: string }
  // S1 — new
  | { type: 'charter:NodeClaimed.v1';
      nodeId: string; payload: { claimId: string; sessionId: string; ttlMinutes: number };
      occurredAt: string }
  | { type: 'charter:NodeReleased.v1';
      nodeId: string; payload: { claimId: string; resolution: Resolution; note?: string };
      occurredAt: string }
  | { type: 'charter:NodeDecomposed.v1';
      nodeId: string; payload: { childIds: string[] }; occurredAt: string }
  | { type: 'charter:GateRequested.v1';
      nodeId: string; payload: { gateId: string; gateType: string }; occurredAt: string }
  | { type: 'charter:GateDecided.v1';
      nodeId: string; payload: { gateId: string; decision: 'approved' | 'rejected'; note?: string };
      occurredAt: string }
```

### 3.2 Resolution set

```typescript
export type Resolution = 'done' | 'expanded' | 'blocked' | 'rejected' | 'superseded'
```

All five are terminal: a node with any resolution never re-enters the frontier. Slice 0's `'done' | 'rejected'` subset is preserved.

### 3.3 `foldCharterLifecycleState` (`lifecycle-state.ts`)

Pure fold into per-node state. Dedup key is `JSON.stringify(event)` — identical pattern to Slice 0's `foldCharterState`, extended to the full event set.

```typescript
interface ClaimState {
  claimId: string; sessionId: string; ttlMinutes: number;
  acquiredAt: string;
  released?: { resolution: Resolution; note?: string; at: string };
}

interface GateState {
  gateId: string; gateType: string;
  requestedAt: string;
  decision?: { decision: 'approved' | 'rejected'; note?: string; at: string };
}

interface NodeLifecycleState {
  claims: ClaimState[];
  resolution?: Resolution;         // set by NodeReleased or NodeDecomposed (→ 'expanded')
  decomposedChildIds?: string[];   // set by NodeDecomposed
  gates: GateState[];
  notes: string[];                 // preserved from Slice 0
}

interface CharterLifecycleState {
  byNode: Map<string, NodeLifecycleState>;
}
```

**Fold rules** (first-writer-wins / idempotency mirrors foundry `state.ts`):

- `NodeClaimed` → push claim; skip if node already has a terminal resolution (done-invariant: a resolved node accepts no further claims)
- `NodeReleased` → find open claim by `claimId`, set `released`; first release wins
- `NodeDecomposed` → set `resolution: 'expanded'` + `decomposedChildIds`; first-writer-wins
- `GateRequested` → push gate
- `GateDecided` → find gate by `gateId`, set `decision`; first-writer-wins
- `NoteRecorded` → push note (backward compat)

`NodeDecomposed.v1` does double duty: it records which child IDs were spawned (for audit + crash-recovery) AND sets `resolution: 'expanded'` on the parent, causing it to drop from all future frontiers with no extra logic.

**Derived helpers** (pure functions over `CharterLifecycleState`):

```typescript
const claimActive = (c: ClaimState, nowMs: number): boolean =>
  c.released == null && (nowMs - Date.parse(c.acquiredAt) < c.ttlMinutes * 60_000)

const nodeResolved    = (n: NodeLifecycleState): boolean => n.resolution != null
const nodeActiveClaim = (n: NodeLifecycleState, nowMs: number): ClaimState | undefined =>
  n.claims.find(c => claimActive(c, nowMs))
const openGate = (n: NodeLifecycleState): GateState | undefined =>
  n.gates.find(g => g.decision == null)
```

## 4. `CharterEventLog` port (`event-log.port.ts`)

Charter lifecycle events are layer concerns, not kernel domain events (ADR-285 D3). The port is defined in `charter-runtime`; adapters are consumer territory.

```typescript
export interface CharterEventLog {
  /** Append a lifecycle event. `treeRootId` is passed explicitly so the store can
   *  bucket by tree without scanning node membership. */
  append(treeRootId: string, event: CharterEvent): void;
  read(treeRootId: string): readonly CharterEvent[];
}
```

**`InMemoryCharterEventLog`** — the layer-provided adapter (tests, browser/studio contexts):

```typescript
export class InMemoryCharterEventLog implements CharterEventLog {
  private readonly store = new Map<string, CharterEvent[]>();
  append(treeRootId: string, event: CharterEvent): void {
    const bucket = this.store.get(treeRootId) ?? [];
    bucket.push(event);
    this.store.set(treeRootId, bucket);
  }
  read(treeRootId: string): readonly CharterEvent[] {
    return this.store.get(treeRootId) ?? [];
  }
}
```

`treeRootId` is passed explicitly on `append` so the store can bucket by tree without scanning node membership. `conductCharterStep` knows `treeRootId` at the call site and passes it through. File/DB adapters are consumer territory (the foundry plugs in its file adapter in S3).

No store lock at the charter-runtime layer (ADR-285 D8). Concurrency safety is the consumer's responsibility.

## 5. `charterFrontier` algorithm (`frontier.ts`)

Pure function — no IO. Takes the *current* plan tree (may have grown via decompose), folded lifecycle state, and current time.

```typescript
export type FrontierAction = 'decompose' | 'claim'

export interface FrontierEntry {
  nodeId: string;
  treeRootId: string;
  action: FrontierAction;
  charter: CharterContract;
  parentCharter: CharterContract | null; // pre-fetched for claim-time validateInheritance
}

export function charterFrontier(
  tree: PlanTree,
  state: CharterLifecycleState,
  nowMs: number,
): FrontierEntry[]
```

**Algorithm** — for each node in `tree.nodes`:

1. **SKIP** if `nodeState.resolution` is set (any terminal resolution)
2. **SKIP** if `nodeActiveClaim(nodeState, nowMs)` is not null
3. **SKIP** if any `_dependsOn` sibling is not yet resolved (`_dependsOn` lives on `PlanNode.metadata._dependsOn: string[]` — a layer-owned key, distinct from kernel reserved `__kindRef`/`__tenantPackId`, written by `decompose-node` onto each child)
4. **DECIDE** action by tree shape + role:
   - `node.childrenIds.length === 0` AND role is decomposable (`product | epic | adr | experiment`) → `action: 'decompose'`
   - `node.childrenIds.length > 0` → **SKIP** (parent is structural scaffolding; either already resolved via `NodeDecomposed`, or was tree-authored with children — let children surface)
   - `node.childrenIds.length === 0` AND role is claimable (`task | gate | review`) → `action: 'claim'`

**Sort order** — stable tie-break by `node.ordinal` (ascending), then `nodeId` (lexicographic). Ordinal is set by `decompose-node` when creating children (0, 1, 2, …).

**One encoding** — `conductCharterStep`, any status readout, and any board view all call this single function. The claimability rule is never re-encoded elsewhere (ADR-247 discipline applied to charter).

**Tree growth** — after `decompose-node` calls `planTreeStore.save` (adding child nodes), the *next* call to `conductCharterStep` loads the updated tree and sees the children naturally. No in-memory continuation, no callback — pure re-derivation.

## 6. `ACTION_REGISTRY` + action handlers (`action-registry.ts`)

Closed `ReadonlyMap`. Unknown kind throws — never a silent no-op.

```typescript
export type ActionKind =
  | 'record-note'    // Slice 0, kept
  | 'claim-node'
  | 'release-node'
  | 'decompose-node'
  | 'request-gate'
  | 'decide-gate'

export interface CharterActionInput {
  nodeId: string;
  treeRootId: string;
  args: Record<string, unknown>;
  occurredAt: string;
  newId: () => string;
}

export interface CharterActionDeps {
  planTreeStore: PlanTreeStore; // decompose-node only
  tenantPackId: string;
}

export type ActionHandler = (
  input: CharterActionInput,
  deps: CharterActionDeps,
) => Promise<CharterEvent[]>

export const ACTION_REGISTRY: ReadonlyMap<ActionKind, ActionHandler>
```

**Handler table:**

| Kind | Args | Emits | Side-effect |
|---|---|---|---|
| `record-note` | `note: string` | `NoteRecorded.v1` | none |
| `claim-node` | `sessionId: string`, `ttlMinutes?: number`, `parentCharter`, `nodeCharter` | `NodeClaimed.v1` | none |
| `release-node` | `claimId: string`, `resolution: Resolution`, `note?: string` | `NodeReleased.v1` | none |
| `decompose-node` | `children: ChildSpec[]` | `NodeDecomposed.v1` | `planTreeStore.load` + `save` |
| `request-gate` | `gateType: string` | `GateRequested.v1` | none |
| `decide-gate` | `gateId: string`, `decision: 'approved'\|'rejected'`, `note?: string` | `GateDecided.v1` | none |

**Inheritance enforced at `claim-node`** — the handler receives `parentCharter` and `nodeCharter` via `args` (pre-fetched by `conductCharterStep`). Before emitting `NodeClaimed.v1` it calls `validateInheritance(parentCharter, nodeCharter)` — the canonical function from `inheritance.ts`, never a private copy. Rejection throws, preventing the claim from landing:

```typescript
const claimNode: ActionHandler = async (input) => {
  const parentCharter = input.args['parentCharter'] as CharterContract | null
  const nodeCharter   = input.args['nodeCharter']   as CharterContract
  if (parentCharter) {
    const verdict = validateInheritance(parentCharter, nodeCharter)
    if (!verdict.ok) throw new Error(`inheritance violation at claim: ${verdict.violation.reason}`)
  }
  // ... emit NodeClaimed.v1
}
```

**`decompose-node` idempotency** — exact-match-or-throw (mirrors foundry `buildPathAction`): if `node.childrenIds` is already non-empty, compare the expected child ID set; exact match → idempotent no-op; divergent set → throw. A partial re-decompose must never silently merge.

```typescript
const decomposeNode: ActionHandler = async (input, deps) => {
  const children = ChildSpecArraySchema.parse(input.args['children'])
  const tree = await deps.planTreeStore.load(input.treeRootId)
  if (!tree) throw new Error(`no tree at ${input.treeRootId}`)
  const parentNode = tree.nodes.find(n => n.id === input.nodeId)
  if (!parentNode) throw new Error(`node not found: ${input.nodeId}`)

  if (parentNode.childrenIds.length > 0) {
    const expectedIds = children.map(c => c.id).sort()
    const existingIds = [...parentNode.childrenIds].sort()
    if (JSON.stringify(existingIds) === JSON.stringify(expectedIds)) {
      // Idempotent: children already in tree means NodeDecomposed.v1 is already in the
      // event log (it was appended on the first run). Return no new events — the fold
      // already holds resolution: 'expanded' from the prior append.
      return []
    }
    throw new Error(`decompose-node: divergent child set under ${input.nodeId}`)
  }

  const childNodes: PlanNode[] = children.map((c, i) =>
    writeCharter({
      id: c.id, parentId: input.nodeId, treeRootId: input.treeRootId,
      kind: c.role, kindRef: `charter:${c.role}`, ordinal: i,
      metadata: { _dependsOn: c.dependsOn ?? [] }, childrenIds: [],
    }, c.contract)
  )
  await deps.planTreeStore.save(addChildrenToTree(tree, input.nodeId, childNodes))

  return [{
    type: 'charter:NodeDecomposed.v1',
    nodeId: input.nodeId,
    payload: { childIds: childNodes.map(n => n.id) },
    occurredAt: input.occurredAt,
  }]
}
```

## 7. `conductCharterStep` + crash recovery (`conduct.ts`)

```typescript
export type ConductStatus = 'advanced' | 'awaiting-gate' | 'idle'

export interface ConductResult {
  status: ConductStatus;
  nodeId?: string;
  action?: FrontierAction;
  frontier?: FrontierEntry[];
}

export async function conductCharterStep(
  deps: CharterDeps,
  treeRootId: string,
): Promise<ConductResult>
```

**Step sequence** — each call is a fresh load; no in-memory continuation:

```
1. tree    ← await deps.planTreeStore.load(treeRootId)
2. events  ← deps.eventLog.read(treeRootId)
3. state   ← foldCharterLifecycleState(events)
4. nowMs   ← Date.parse(deps.now())
5. frontier ← charterFrontier(tree, state, nowMs)
6. if frontier is empty → crash-recovery check → if none, return { status: 'idle', frontier: [] }
7. head ← frontier[0]
8. nodeState ← state.byNode.get(head.nodeId)
9. if head.action === 'claim' AND openGate(nodeState) exists → return { status: 'awaiting-gate', nodeId, frontier }
10. dispatch ← ACTION_REGISTRY.get(actionKindFor(head.action))
11. events  ← await dispatch(input, deps)
12. for each emitted event → deps.eventLog.append(treeRootId, event)
13. re-derive frontier (re-load tree for 'decompose' — tree has grown)
14. return { status: 'advanced', nodeId: head.nodeId, action: head.action, frontier }
```

`actionKindFor('decompose') = 'decompose-node'`; `actionKindFor('claim') = 'claim-node'`.

**Gate halt invariant** — when a `claim` frontier node has an open gate, the conductor halts with `awaiting-gate` without actuating any action. The gate is passed only by an explicit `decide-gate` call (founder/operator driven). The conductor never auto-passes a gate.

**Crash recovery** — mirrors `recoverDanglingStage`. The crash window: `NodeClaimed.v1` was appended but the process crashed before `NodeReleased.v1`. On restart the node has an active claim and drops from the frontier → `conductCharterStep` would falsely return `idle`.

Conductor own-claim pattern: `claimId = 'conduct-${nodeId}'`, `sessionId = 'conductor'`.

```typescript
const conductClaimId = (nodeId: string) => `conduct-${nodeId}`
const CONDUCTOR_SESSION = 'conductor'

function danglingOwnClaim(state: CharterLifecycleState): string | undefined {
  for (const [nodeId, ns] of state.byNode) {
    if (nodeResolved(ns)) continue
    const last = ns.claims.at(-1)
    if (last?.claimId === conductClaimId(nodeId)
        && last.sessionId === CONDUCTOR_SESSION
        && last.released == null) return nodeId
  }
  return undefined
}
```

Recovery (step 6): if a dangling own-claim is found, append `NodeReleased.v1(resolution: 'done')` for that claim, re-derive frontier, return `{ status: 'advanced' }`. Idempotent: if two conductors race to recover, the second sees a resolved node and skips.

**No store lock at this layer** — lock-free by design (ADR-285 D8). The in-memory adapter is single-threaded. The foundry brings `withStoreLock` in S3.

## 8. Acids (load-bearing property tests)

Nine acid tests in `acids.spec.ts`. Each targets one non-negotiable guarantee.

| # | Acid | Property proven |
|---|---|---|
| 1 | Fold-determinism / replay-stability | `fold(E) === fold([...E, ...E])` for all 6 event types |
| 2 | Frontier-advance (claimed node drops) | Claim → drops from frontier; resolve → stays off |
| 3 | Decompose-advance (parent expands, children surface) | After decompose: root resolves `expanded`, children appear on frontier |
| 4 | Inheritance-at-claim (fail-closed) | Widened child scope → `claim-node` throws, no `NodeClaimed.v1` emitted, node remains on frontier |
| 5 | Exactly-once (idempotent conductor) | Two calls on an advanced node: second call is `idle` or next step, never double-applies |
| 6 | Gate-halt invariant | Open gate → `awaiting-gate`, no claim emitted; `GateDecided(approved)` → `advanced` |
| 7 | Full resolution set | All 5 resolutions record correctly and drop from frontier |
| 8 | Crash-recovery (dangling own-claim completes) | Manually-appended dangling own-claim → recovery appends release → next call advances |
| 9 | Kernel-Untouched boundary acid (extended) | No charter vocab in `lifecycle-events.ts` types bleeds into `plan-tree-schemas.ts` or `plan-tree-store.port.ts` |

## 9. ADR-285 — scope summary

To be authored alongside the implementation (charter-checker required this before consumer domains can use S1).

**Title:** "ADR-285: The uniform charter lifecycle protocol — 8 stages, port-backed event log, hierarchical frontier"

**Decisions covered:**

- **D1** — the 8 lifecycle stages and what each means; degenerate role lifecycles (gate skips execute; review skips gate)
- **D2** — the resolution set (`done | expanded | blocked | rejected | superseded`) and when each applies
- **D3** — `CharterEventLog` port separate from the kernel event log (boundary acid; charter events are layer concerns, not kernel domain events)
- **D4** — hierarchical frontier algorithm; one encoding; tree re-derivation after decompose
- **D5** — `decompose-node` uses kernel `PlanTreeStore.save` — no new kernel operation; Kernel-Untouched Invariant holds
- **D6** — `validateInheritance` enforced at claim time; one function, no private copy (the #1 Slice-0 cross-task bug)
- **D7** — exactly-once / replay-stability contract; handlers emit events, fold is the only state, `now`/`newId` injected
- **D8** — no store lock at the charter-runtime layer; concurrency safety is consumer territory

**Alternatives considered:** kernel event log (boundary acid violation, rejected); pure-functional core with no port (defers complexity to consumers, rejected); store lock at the layer (blocks browser/studio use-cases, rejected).

## 10. What generalises vs what stays foundry-specific

| Concern | Generalises to charter-runtime | Stays in foundry |
|---|---|---|
| Event fold + derived state | `foldCharterLifecycleState` | foundry `fold` (its own event types) |
| Frontier derivation | `charterFrontier` (hierarchical) | `planFrontier` / `planFrontierAll` (flat cascade) |
| Conductor | `conductCharterStep` | `conductWorkflowStep` (calls charter-runtime in S3) |
| ACTION_REGISTRY pattern | `charter-runtime/action-registry.ts` | foundry `workflow/actions.ts` (foundry-specific action kinds) |
| Event persistence | `CharterEventLog` port | foundry file-based log (provides adapter in S3) |
| Store lock | none (consumer concern) | `withStoreLock` (file-based) |
| Specific workflow tree | — | `FOUNDRY_WORKFLOW` + variants |

## 11. Out of scope for S1

- Blueprint/charter-tree engine (S2)
- Foundry migration onto the layer (S3)
- Studio durable persistence (S4)
- Deploy + sync + mini-charter handoff (S5)
- Second consuming pack (S6)
- Multi-tree frontier (`charterFrontierAll` — deferred to S6)
- npm publish of `charter-runtime` (deferred until a domain consumes it, S3+)

## 12. Guardrails (standing, unchanged from ADR-283)

- **Kernel-Untouched Invariant** — zero diff to `plan-tree-schemas.ts`, `plan-tree-store.port.ts`, `prisma-plan-tree.store.ts`, `kernel.plan_node` migration
- **Boundary acid** — no charter vocabulary under `layers/substrate/**` production
- **One validateInheritance** — the canonical function from `inheritance.ts`; no private copies anywhere in the implementation
- **Replay-stable fold** — `now`/`newId` never called inside `foldCharterLifecycleState`
- **`charter-checker` agent** — reviews every PR for ring boundaries + inclusion test + "store generators, derive graphs"
