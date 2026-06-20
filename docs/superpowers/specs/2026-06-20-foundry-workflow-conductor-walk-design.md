# The conductor WALKS the workflow tree — the workflow finally RUNS

> Slice 1 ([ADR-263](../../../layers/specs/adr/adr-263-foundry-workflow-first-class-actions.md))
> promoted the foundry WORKFLOW to a first-class plan tree (`FOUNDRY_WORKFLOW`) and gave its
> interventions a way to ACTUATE (the kind-keyed `ACTION_REGISTRY` + `actuate`/`actuateNode`). Slice 2
> ([ADR-264](../../../layers/specs/adr/adr-264-foundry-workflow-build-path-cross-tree.md)) added the
> `build-path` action — a workflow stage SPAWNS a product tree across trees. Slice 3
> ([ADR-265](../../../layers/specs/adr/adr-265-foundry-workflow-derived-advancement.md)) made the static
> tree ADVANCE: stages gained `dependsOn` edges (the pipeline order), `workflowFrontier(state, now)`
> derives the READY stage by REUSING `planFrontier`, and advancement is pure RE-DERIVATION over the log,
> isolated from the product conductor by NON-REGISTRATION. After Slice 3 the workflow could advance — but
> ONLY when something marked a stage done and re-read `workflowFrontier`; nothing WALKED it. **Slice 4 is
> the walk: `conductWorkflowStep(deps)` pulls the ready stage from `workflowFrontier`, actuates its
> `metadata.action` via `actuateNode` (Slice 1 — firing `build-path` from Slice 2 spawns a product),
> marks the stage done, and advances — BUT HALTS at FOUNDER-GATED stages (the governance invariant).** A
> founder-gated stage is passed ONLY by an explicit founder act, `authorizeWorkflowStage(deps,
> stageItemId)`, which threads ADR-262's founder-gated model into the workflow machine: automation
> auto-walks, governance requires a founder act. The conductor COMPOSES Slices 1–3 — no new claimability
> rule, no new fold, no new event type. It marks a stage done via a DIRECT `claimAcquired` +
> `claimReleased(done)` pair under the store lock, BYPASSING `claim()`/`release()`/`leaseSlotIndex`
> (which throws on the orphan workflow product) — safe because the stage was pulled from
> `workflowFrontier` (already `dependsOn`-gated) and the conductor walks stages SERIALLY. A re-entrant
> store-lock deadlock found in TDD is avoided by SEPARATING the done-marking lock scope from the
> actuation (the actuation's op self-locks) — so the actuate-then-mark-done is NON-ATOMIC, but the
> conductor is CRASH-RECOVERABLE (a partial step is RE-RUNNABLE, never WEDGED): `build-path` actuation is
> IDEMPOTENT (exact-replay-or-throw), `markStageDone` does a REAL under-lock readiness re-check (no
> double-mark), and a crash mid done-marking is RECOVERED by completing the conductor's OWN dangling
> claim (never a lying `idle`, never a foreign claim). **Zero kernel change** — `founderGated` rides
> `metadata`, the done-pair reuses existing events, both ADR-176 legs fail → pack territory.

- **Date:** 2026-06-20
- **Scope (as SHIPPED — `domains/foundry` branch `feat-workflow-conduct`, HEAD `3dcf09c` — the walk
  `6e5e037` + the two crash-recovery hardening commits `c37305f` + `3dcf09c`):**
  `domains/foundry` — a small composition over the Slice-1/2/3 workflow surface:
  - `src/plan/workflow-conductor.ts` (new) — the whole slice. Holds `conductWorkflowStep(deps):
    ConductResult`, `authorizeWorkflowStage(deps, stageItemId)`, the `ConductResult` /
    `ConductStatus` types, and the private helpers: `stageNode(stageKey)` (reads the AUTHORED
    `FOUNDRY_WORKFLOW` stage node — carrying `metadata.action` / `metadata.actionArgs` /
    `metadata.founderGated` — via `buildCascadeTree`, because `workflowTree()` DROPS those fields when it
    re-keys the stages to work-item leaves), `markStageDone(deps, stageKey, sessionId)` (the direct
    done-pair under `withStoreLock`, with a REAL under-lock readiness re-check that no-ops if the stage
    already folded done), and `danglingOwnStage` / `recoverDanglingStage` (the crash-recovery: detect +
    complete the conductor's OWN dangling claim left by a crash mid done-marking).
  - `src/workflow/actions.ts` (extend) — the `build-path` handler gains an IDEMPOTENT exact-replay-or-throw
    guard: a re-actuation under the same `newKey` with the same item set returns the existing product
    (a no-op), a divergent/foreign/partial/superset item set throws. This is what makes a partial
    conduct-step RE-RUNNABLE rather than permanently wedged.
  - `src/instances/foundry-workflow.ts` (extend) — the `stage-gate-greenlight` node gains
    `meta.founderGated: true` (`foundry-workflow.ts:79`). Additive metadata; the node's Slice-1
    `action: 'reprioritize-product'` + `effects` still ride alongside (proving declaration ⊥ actuation ⊥
    governance), but the founder-gate short-circuit fires FIRST in `conductWorkflowStep`, so the action
    never AUTO-actuates.
  - `src/mcp/tools.ts` (extend) + `src/mcp/server.ts` (register) — the `foundry_conduct_workflow` MCP
    tool (`tools.ts:104`): the operator trigger that steps/walks the conductor, with an optional
    `authorizeStage` to authorize a founder-gated stage BEFORE stepping.
  - `test/workflow-conduct.acid.test.ts` (new) — the acid battery (a)–(f) plus the crash-recovery
    coverage (the WEDGE / FIX-1 / FIX-3 groups, §5.2 below), EVERY acid against a TEMP log
    (`mkdtempSync`/`tmpdir`), `now` pinned via `FoundryDeps.now`.
  - It REUSES `workflowFrontier` (`src/plan/workflow-frontier.ts`, Slice 3), `actuateNode`
    (`src/workflow/actions.ts`, Slice 1 — extended with the `build-path` idempotency guard),
    `buildCascadeTree` (`src/plan/cascade.ts`), the `claimAcquired` / `claimReleased` event constructors
    (`src/events.ts`), `withStoreLock` (`src/store-lock.ts`), `fold` (`src/state.ts`), and `readEnvelopes`
    / `append` (`src/log.ts`). `planFrontierAll`, `claimableItems`, the kernel,
    `@de-braighter/substrate-contracts`, and the design-system are UNTOUCHED.
- **Predecessors / boundary:**
  [ADR-265](../../../layers/specs/adr/adr-265-foundry-workflow-derived-advancement.md) (Slice 3 — the
  `workflowFrontier` this conductor pulls; the isolation-by-non-registration this walk preserves),
  [ADR-264](../../../layers/specs/adr/adr-264-foundry-workflow-build-path-cross-tree.md) (Slice 2 — the
  `build-path` action the conductor fires at `stage-build-path`),
  [ADR-263](../../../layers/specs/adr/adr-263-foundry-workflow-first-class-actions.md) (Slice 1 —
  `actuate`/`actuateNode` + D3 the Command-pattern-event-sourced invariant + D4 derived-not-callback),
  [ADR-262](../../../layers/specs/adr/adr-262-foundry-dashboard-interactive-actions.md) (the FOUNDER-GATED
  governance model — a live-canonical-log mutation that steers the machine is authorized by the founder,
  never auto-applied; this slice threads that invariant into the conductor),
  [ADR-256](../../../layers/specs/adr/adr-256-foundry-scheduled-wake-actuation.md) (P6 scheduled-wake —
  the EXTERNAL clock that POKES the re-derivation; the conduct loop is the actuating counterpart),
  [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) (the
  inclusion test — §6, both legs fail → pack territory),
  [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) (the four kernel concerns; the plan
  tree is §1.1, reproducibility §1.4 — the reason the walk must be reconstructable from the log).
- **Provenance.** Recon-confirmed against the FINAL SHIPPED foundry source (HEAD `3dcf09c`):
  `conductWorkflowStep(deps)` (`src/plan/workflow-conductor.ts:162-203`) — pulls
  `workflowFrontier(fold(readEnvelopes(deps.logPath)), nowMs)[0]`; on an EMPTY frontier RECOVERS a
  dangling OWN-stage (`recoverDanglingStage` → `{ status: 'advanced', stage, frontier }`) before falling
  back to `{ status: 'idle' }` (never a lying idle); else short-circuits on `isFounderGated(node)` →
  `{ status: 'awaiting-founder', stage, frontier }`, else `actuateNode` (if `hasAction`) + `markStageDone`
  → `{ status: 'advanced', stage, frontier }`; `authorizeWorkflowStage(deps, stageItemId)`
  (`workflow-conductor.ts:210-225`) — the founder act that throws if the stage is not the ready stage or
  not founder-gated, else `markStageDone`; `markStageDone` (`workflow-conductor.ts:90-110`) — a REAL
  under-lock readiness re-check (re-folds + re-derives `workflowFrontier`, no-ops if the stage already
  dropped out) THEN the direct `claimAcquired` + `claimReleased(outcome:'done')` pair appended under
  `withStoreLock`, BYPASSING `claim`/`release`/`leaseSlot`; `danglingOwnStage` / `recoverDanglingStage`
  (`workflow-conductor.ts:117-152`) — the crash-recovery: detect the conductor's OWN dangling claim
  (`conduct-<stage>`, session `conductor`) and append the missing `claimReleased(done)`; foreign claims
  never auto-completed; the IDEMPOTENT `build-path` actuation (`src/workflow/actions.ts:64-98`) —
  `before.products.has(newKey)` + an exact-id match returns the existing product (a no-op), a
  divergent/foreign/partial/superset item set throws; `stageNode` (`workflow-conductor.ts:59-64`) — reads
  the authored `FOUNDRY_WORKFLOW` node via `buildCascadeTree(FOUNDRY_WORKFLOW)` (because `workflowTree()`
  drops `metadata.action`/`founderGated`); `isFounderGated`/`hasAction` (`workflow-conductor.ts:66-70`) —
  the `metadata.founderGated === true` / `typeof metadata.action === 'string'` predicates;
  `meta.founderGated: true` on the gate (`src/instances/foundry-workflow.ts:79`);
  `foundry_conduct_workflow` (`src/mcp/tools.ts:104-110`) — `authorizeStage?` then `conductWorkflowStep`;
  `withStoreLock` is NOT re-entrant (`src/store-lock.ts:131-135` — "NOT reentrant — never nest") which is
  why the done-marking lock scope is separated from the actuation; `actuateNode`
  (`src/workflow/actions.ts:128-136`) reads `metadata.action`/`metadata.actionArgs` and runs the registry
  handler under its OWN store lock; `leaseSlotIndex` throws on an un-registered product (the orphan
  workflow product is never in `s.products` — Slice 3's non-registration). Implementation: commits
  `6e5e037` (the walk) + `c37305f` + `3dcf09c` (the crash-recovery hardening) on `domains/foundry` branch
  `feat-workflow-conduct`.

---

## 1. The static-until-poked workflow — and why the conductor must WALK it

After Slice 3, `FOUNDRY_WORKFLOW` ADVANCES: `workflowFrontier(state, now)` derives the ready stage, and
re-deriving after a stage-done event moves the frontier forward. But Slice 3 deliberately did NOT wire a
DRIVER — the workflow advanced only when an acid (or `wake`) marked a stage done and re-read the
frontier. Nothing pulled the ready stage, fired its action, and marked it done. The HOW could advance,
but it did not RUN.

The product tree already runs this way — the conductor pulls `planFrontierAll`, a worker claims an item,
does the work, marks it done, and the next item becomes ready. The workflow is the SAME plan-tree
primitive (Slice 1), advancing the SAME way (Slice 3) — so the conductor can WALK it the same way, with
ONE difference that is the whole point of the slice: **a founder gate.**

| | Product conductor (the WHAT) | Workflow conductor (the HOW, this slice) |
|---|---|---|
| **Ready set** | `planFrontierAll(state, now)` over all registered products. | `workflowFrontier(state, now)` over the workflow tree (Slice 3). |
| **Actuation** | A human/agent worker claims + does the work, emits a merge. | `actuateNode(deps, node)` fires `metadata.action` (Slice 1) — `build-path` spawns a product (Slice 2). |
| **Completion** | `MergeRecorded` / `ClaimReleased(done)` via the lease/claim flow. | A DIRECT `claimAcquired` + `claimReleased(done)` pair (BYPASSING `leaseSlot`). |
| **Governance** | Gates are founder-decided OUT of band (`foundry_gate_decide`). | The conductor HALTS at a founder-gated stage; `authorizeWorkflowStage` is the founder act. |

The crux this slice settles is the governance one: the workflow's gate stage (`stage-gate-greenlight`)
is exactly the founder-gated decision ADR-262 deferred throughout the foundry grind — re-prioritising a
product is a live-canonical-log mutation that steers the machine. A conductor that AUTO-actuated the gate
would auto-greenlight + auto-spawn with no founder authorization. The walk must HALT there.

---

## 2. The governance-halt — the load-bearing decision

**The conductor cannot auto-pass a founder gate.** This is the load-bearing decision of the slice.

`conductWorkflowStep(deps)` (`workflow-conductor.ts:92`) pulls the ready stage and, BEFORE it actuates
anything, checks `isFounderGated(node)` (`workflow-conductor.ts:60` — `metadata.founderGated === true`).
If the stage is founder-gated it SHORT-CIRCUITS:

```ts
// src/plan/workflow-conductor.ts:100-103 (SHIPPED)
// GOVERNANCE INVARIANT: the conductor cannot auto-pass a founder gate.
if (isFounderGated(node)) {
  return { status: 'awaiting-founder', stage: head.itemId, frontier: ready };
}
```

It returns `{ status: 'awaiting-founder', stage }` — **no action actuated, the stage NOT marked done.**
The gate stays the ready stage; a second `conductWorkflowStep` call STILL halts (idempotent — the
conductor never auto-passes). The gate's Slice-1 `action: 'reprioritize-product'` + `effects` still ride
the node (declaration ⊥ actuation ⊥ governance — three orthogonal axes), but because the founder-gate
short-circuit fires FIRST, the action never AUTO-actuates.

A founder-gated stage is passed ONLY by an explicit founder act:

```ts
// src/plan/workflow-conductor.ts:120-135 (SHIPPED)
export function authorizeWorkflowStage(deps, stageItemId): { stage; frontier } {
  const ready = workflowFrontier(fold(readEnvelopes(deps.logPath)), nowMs);
  const head = ready.find((i) => i.itemId === stageItemId);
  if (!head) throw new Error(`stage not ready for authorization: ${stageItemId}`);
  const node = stageNode(stageItemId);
  if (!isFounderGated(node)) {
    throw new Error(`stage is not founder-gated (no authorization required): ${stageItemId}`);
  }
  markStageDone(deps, stageItemId, 'founder');   // the founder act
  return { stage: stageItemId, frontier: workflowFrontier(...) };
}
```

`authorizeWorkflowStage` marks the gate done (so `conductWorkflowStep` resumes past it on the next step),
but it is GUARDED both ways: it throws if the stage is not the ready workflow stage (the founder cannot
authorize an arbitrary or not-yet-reachable stage) AND if the stage is not founder-gated (there is no
authorization to give on a non-gated stage). This is exactly ADR-262's governance model — a steering
mutation is authorized by the founder, never auto-applied — threaded into the workflow MACHINE: the
dashboard Fix-button (ADR-262 D2) and `authorizeWorkflowStage` are the SAME invariant at two surfaces.
Slice 5 surfaces the halt as the founder-clickable button (§7).

---

## 3. The key decisions

### KD-1 — The conductor COMPOSES Slices 1–3; no new claimability rule, no new fold

`conductWorkflowStep` is pure composition. It pulls the ready stage from `workflowFrontier` (Slice 3),
actuates via `actuateNode` (Slice 1), and marks done with the existing done-pair (Slice 3's bootstrap
encoding). It introduces NO new claimability rule, NO new fold, NO new event type, NO bespoke frontier.
The source-scan acid (f) guards this: `workflow-conductor.ts` imports `workflowFrontier` + `actuateNode`
and re-implements no `claimableItems` / `depsSatisfied` / `dependsOn.every` / `.sort` of its own. The
ADR-247 M1 one-encoding principle is preserved — there is exactly one claimability encoding, and the
conductor reuses it verbatim.

### KD-2 — THE GOVERNANCE INVARIANT: the conductor HALTS at founder-gated stages (§2)

The load-bearing decision. Without it, the conductor would auto-actuate the gate's
`reprioritize-product` action and auto-advance past the greenlight — auto-greenlighting + auto-spawning
a product with no founder authorization. The founder-gate short-circuit (`workflow-conductor.ts:191`) is
checked BEFORE actuation, so a founder-gated stage is never actuated and never marked done by the
conductor. `authorizeWorkflowStage` is the only path past it. This threads ADR-262's founder-gated model
into the machine: automation auto-walks the pipeline, governance requires a founder act.

### KD-3 — The mark-done BYPASSES `leaseSlot` (a direct done-pair under the store lock)

The product conductor marks an item done through `claim()` → `leaseSlotIndex()` → `release()` — the
warm-pool slot dispatch that hands an item to a parallel worker. That path THROWS on a workflow stage:
the workflow product is NOT registered in `s.products` (Slice 3's isolation-by-non-registration), so
`leaseSlotIndex` cannot resolve it (`/not registered|corrupt log/`). The conductor walks stages
SERIALLY — it is not dispatching them to parallel warm-pool workers — so it needs none of the
lease/claim cross-session safety. It marks a stage done with the EXISTING done-event encoding directly:

```ts
// src/plan/workflow-conductor.ts:90-110 (SHIPPED) — under-lock re-check THEN the done-pair
export function markStageDone(deps, stageKey, sessionId): void {
  withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    // Authoritative re-check under the lock (KD-7): re-fold + re-derive the workflow frontier.
    // A stage already folded done has dropped out → no-op (no double-mark, idempotent).
    const ready = workflowFrontier(fold(readEnvelopes(deps.logPath)), Date.parse(ts));
    if (!ready.some((i) => i.itemId === stageKey)) return;
    const claimId = `conduct-${stageKey}`;
    // CRASH WINDOW (honest): a crash BETWEEN these two appends leaves a dangling OWN-claim,
    // closed by recovery (KD-8), not by expiry (ttlMinutes is a minimal placeholder).
    append(claimAcquired({ claimId, itemId: stageKey, sessionId, ttlMinutes: 1, ts }), deps.logPath);
    append(claimReleased({ claimId, itemId: stageKey, sessionId, outcome: 'done', ts }), deps.logPath);
  });
}
```

This is the `foundryBootstrapEvents` shape (the same `claimAcquired` + `claimReleased(done)` pair
P3/ADR-254 uses to mark historically-done items done) — NO new event type, NO second claimability rule
(`workflowFrontier` is reused verbatim). The done-marking is SAFE because the stage was pulled from
`workflowFrontier`, which already gated it by `dependsOn` (a stage is only marked done if it was
genuinely ready), AND because the under-lock re-check (KD-7) makes it idempotent — two conductors that
both pass the lock-free pre-check land EXACTLY ONE done-pair. No `SlotLeased` event is ever appended
during the walk (acid (e)).

### KD-4 — The actuation and the done-marking take the store lock SEPARATELY (the re-entrant-deadlock fix)

A re-entrant store-lock DEADLOCK was found and fixed in TDD. `withStoreLock` is NOT re-entrant
(`store-lock.ts:131-135` — "NOT reentrant — never nest"; it is a `mkdir`-EEXIST mutex that blocks until
the holder releases). `actuateNode`'s underlying op SELF-LOCKS (e.g. `build-path` → `queuePush` under
`withStoreLock`, `reprioritize-product` → `reprioritizeProduct` under `withStoreLock`). So if the
conductor held the store lock ACROSS the actuation, the actuation's op would block forever trying to
re-acquire a lock the conductor already holds — a self-deadlock.

The fix is to keep the two lock scopes SEPARATE, never nested. `conductWorkflowStep` actuates FIRST
(outside any lock the conductor holds — the actuation's op takes and releases its own lock), THEN marks
the stage done in `markStageDone`'s OWN lock scope:

```ts
// src/plan/workflow-conductor.ts:198-199 (SHIPPED) — actuate (self-locks) THEN mark done (separate lock)
if (hasAction(node)) actuateNode(deps, node);   // its op takes + releases the store lock
markStageDone(deps, head.itemId, 'conductor');  // a SEPARATE lock scope (sessionId 'conductor')
```

The frontier read (`workflowFrontier`) is lock-free advisory (like `nextItems`/`wake`); the done-marking
is the only part the conductor itself locks. The ordering is fail-safe FORWARD: a broken handler throws
in `actuateNode` BEFORE the done-pair is marked, so a failed actuation leaves the stage un-advanced (still
ready) — acid (c) MUTATION. But the two lock scopes are NOT nested, so the actuate-then-mark-done is
HONESTLY NON-ATOMIC: a crash BETWEEN a landed actuation and the done-pair leaves a partial step. That
partial step is RE-RUNNABLE, not a permanent wedge — closed by KD-6 (idempotent `build-path`), KD-7 (the
under-lock re-check) and KD-8 (dangling-own-claim recovery), the three robustness decisions added below.

### KD-5 — ADR-176 PACK-LEVEL: pack code composing existing primitives; zero kernel change

`founderGated` rides the `metadata` JSONB boundary (ADR-176 §3 — the same untyped per-pack extension
space `metadata.action` rides). The conductor is pack code composing existing pack/kernel primitives:
`workflowFrontier` (Slice 3 pack), `actuateNode` (Slice 1 pack), the `claimAcquired`/`claimReleased`
events (existing), `withStoreLock` (existing). NO new kernel shape, NO new event type. Both ADR-176
inclusion-test legs fail (a workflow conductor is not one of the four kernel concerns; single consumer
`domains/foundry`) → pack territory. The walk is Command-pattern-event-sourced (ADR-263 D3): actuation
emits events, replay FOLDS them and never re-runs the handler, so the whole walk is reconstructable from
the log alone (acid (d)). **Store generators, derive graphs** is upheld (ADR-176 §4) — the workflow
structure + the done-events live in the log; the frontier is a derived view re-computed on read.

### KD-6 — `build-path` actuation is IDEMPOTENT (exact-replay-or-throw) — the WEDGE FIX

The verifier wave found a BLOCKING bug. Because the conduct-step is non-atomic (KD-4), a partial step —
`build-path` already spawned the product, but the done-pair did NOT land (a crash or a concurrent race) —
leaves `stage-build-path` STILL the ready stage. Re-conducting RE-ACTUATES `build-path`. In the pre-fix
code, `build-path` called `queuePush` unconditionally, which THREW `items already queued` on the
already-spawned itemIds — so the partial step PERMANENTLY WEDGED the pipeline at `stage-build-path`: every
retry threw forever, the stage could never be marked done. The shipped code FIXES this with an
exact-replay-or-throw idempotency guard (`src/workflow/actions.ts:64-98`):

```ts
// src/workflow/actions.ts:78-91 (SHIPPED) — exact-replay-or-throw
const before = fold(readEnvelopes(deps.logPath));
const expectedIds = input.items.map((i) => i.itemId);
if (before.products.has(newKey)) {
  const exactMatch = expectedIds.length > 0
    && expectedIds.every((id) => before.items.get(id)?.productKey === newKey);
  if (exactMatch) {                                   // idempotent NO-OP: return the existing product
    return { productKey: newKey, rootNodeId: uuidv5('cascade:' + newKey), queued: expectedIds };
  }
  throw new Error(`build-path re-actuation under key '${newKey}' does not exactly replay …`); // STRICT
}
// newKey NOT registered → fresh spawn (fall through to queuePush)
```

- **`newKey` not registered** → fresh spawn (the normal first actuation).
- **`newKey` registered, EXACT match** (every expected id belongs to `newKey`) → idempotent NO-OP returning
  the existing product. This makes a partial conduct-step RE-RUNNABLE: the re-actuation is a no-op, then
  the done-pair finally lands.
- **`newKey` registered, item set DIVERGES** (any id missing, foreign-owned, or a disjoint SUPERSET with
  new ids) → THROWS. STRICT on purpose: a partial/superset re-spawn must NEVER silently merge half a
  product (`queuePush` only throws on OVERLAP, so a disjoint superset would otherwise merge — this guard
  closes that). No silent merge, no data-loss. The only idempotent case is an EXACT replay of THIS spawn.

### KD-7 — `markStageDone` does a REAL under-lock readiness re-check (no double-mark)

The earlier docstring CLAIMED an under-lock re-check, but the code did NOT do one — it appended the
done-pair unconditionally inside the lock. The shipped code makes the re-check REAL (the `markStageDone`
block in KD-3): UNDER the store lock it re-folds, re-derives `workflowFrontier`, and confirms the stage is
STILL ready BEFORE appending the done-pair; if a concurrent/retried conductor already marked it done — it
has dropped out of the frontier — `markStageDone` NO-OPs. So two conductors that both pass the lock-free
pre-check land EXACTLY ONE done-pair, never two.

### KD-8 — Crash-recovery via dangling-OWN-claim completion (never a lying `idle`)

The done-marking is two appends. A crash BETWEEN them leaves the conductor's OWN dangling claim (`claimId
conduct-<stage>`, session `conductor`, acquired but not released, item not done). Within its `ttlMinutes`
the stage folds to `claimed` and DROPS OUT of `workflowFrontier`, so a NAIVE `conductWorkflowStep` on an
empty frontier would return a LYING `{ status: 'idle' }` (STALLED mid-done, not exhausted). A lone
`claimReleased(done)` is a fold NO-OP (the fold's `findClaim` needs the prior `claimAcquired` in
`s.items`), so a single crash-atomic append is impossible without a new claimability rule — which the
conductor MUST NOT add (KD-1). The fix RECOVERS (`src/plan/workflow-conductor.ts:162-179`): on an empty
frontier, `conductWorkflowStep` detects a dangling OWN-claim (`recoverDanglingStage`) and COMPLETES it by
appending the missing `claimReleased(done)` — the SAME `claimId`, so the fold pairs it and the stage folds
done — then re-derives and reports `{ status: 'advanced', stage }`, NEVER a lying `idle`:

```ts
// src/plan/workflow-conductor.ts:166-178 (SHIPPED) — empty frontier is ambiguous; recover first
const recoveredStage = recoverDanglingStage(deps);   // completes the conductor's OWN dangling claim
if (recoveredStage != null) {
  const recovered = workflowFrontier(fold(readEnvelopes(deps.logPath)), nowMs);
  return { status: 'advanced', stage: recoveredStage, frontier: recovered };
}
return { status: 'idle', frontier: ready };          // a TRUE idle — no dangling own-stage
```

ONLY the conductor's OWN claims are auto-completed (`danglingOwnStage` matches `conduct-<stage>` + session
`conductor` + unreleased + not-handed-off). A FOREIGN claim is NEVER auto-completed — the conductor returns
a real `idle`, leaving it to its owner/TTL. So the non-atomic done-marking is CRASH-RECOVERABLE: a crash
leaves the pipeline RE-RUNNABLE, not wedged or silently stalled. The crash window is closed by RECOVERY,
not by claim expiry (the `ttlMinutes:1` is a minimal placeholder — there is NO "never expires" claim and
no reliance on TTL to heal the window).

---

## 4. The mechanism — `conductWorkflowStep` + `authorizeWorkflowStage`

### 4.1 `stageNode` reads the AUTHORED node (not the projected work-item leaf)

`workflowFrontier` returns `ItemState[]` projected by `workflowTree()`, which RE-KEYS each stage to a
work-item leaf and DROPS `metadata.action` / `metadata.actionArgs` / `metadata.founderGated`
(`workflow-frontier.ts:72-85` carries only `itemId`/`title`/`scope`/`dependsOn`). So to read the action
and the founder-gate flag, the conductor reads the AUTHORED `FOUNDRY_WORKFLOW` node by its
`_cascadeKey`:

```ts
// src/plan/workflow-conductor.ts:59-64 (SHIPPED)
function stageNode(stageKey: string): PlanNode {
  const tree = buildCascadeTree(FOUNDRY_WORKFLOW);
  const node = tree.nodes.find((n) => n.metadata['_cascadeKey'] === stageKey);
  if (!node) throw new Error(`workflow stage not found in FOUNDRY_WORKFLOW: ${stageKey}`);
  return node;
}
```

The frontier (STATUS, from the log) and the authored node (the action/gate METADATA, from the spec) are
two reads composed — the STRUCTURE-from-spec + STATUS-from-log split Slice 3 established, applied at the
conductor.

### 4.2 The step loop — pull, halt-or-actuate, mark, advance

```ts
// src/plan/workflow-conductor.ts:162-203 (SHIPPED) — the whole step.
export function conductWorkflowStep(deps: FoundryDeps): ConductResult {
  const nowMs = Date.parse(nowOf(deps));
  const ready = workflowFrontier(fold(readEnvelopes(deps.logPath)), nowMs);   // Slice 3, lock-free
  const head = ready[0];
  if (!head) {                                                                  // empty frontier is AMBIGUOUS
    const recoveredStage = recoverDanglingStage(deps);                          // KD-8 crash-recovery
    if (recoveredStage != null) {
      const recovered = workflowFrontier(fold(readEnvelopes(deps.logPath)), nowMs);
      return { status: 'advanced', stage: recoveredStage, frontier: recovered };
    }
    return { status: 'idle', frontier: ready };                                 // a TRUE idle (no dangling own-stage)
  }

  const node = stageNode(head.itemId);                                          // authored node (§4.1)
  if (isFounderGated(node)) {                                                   // KD-2 governance HALT
    return { status: 'awaiting-founder', stage: head.itemId, frontier: ready };
  }
  if (hasAction(node)) actuateNode(deps, node);                                 // Slice 1, self-locks (KD-4)
  markStageDone(deps, head.itemId, 'conductor');                               // direct done-pair + re-check (KD-3/7)

  const frontier = workflowFrontier(fold(readEnvelopes(deps.logPath)), nowMs);  // re-derive — advanced
  return { status: 'advanced', stage: head.itemId, frontier };
}
```

`ConductResult = { status: 'advanced' | 'awaiting-founder' | 'idle'; stage?; frontier? }` — `stage` is
the stage acted on (advanced / awaiting-founder), `frontier` is the re-derived workflow frontier after
the step (always returned, for the operator/dashboard).

### 4.3 The operator trigger — `foundry_conduct_workflow`

```ts
// src/mcp/tools.ts:104-110 (SHIPPED) — step/walk the conductor; authorize a gate before stepping.
foundry_conduct_workflow: guard((a: { authorizeStage?: string }) => {
  const authorized = a.authorizeStage != null ? authorizeWorkflowStage(deps, a.authorizeStage) : undefined;
  const step = conductWorkflowStep(deps);
  return { ...(authorized != null ? { authorized: authorized.stage } : {}), step };
}),
```

The operator steps the conductor by calling `foundry_conduct_workflow {}` repeatedly; when it returns
`awaiting-founder`, the founder authorizes by calling `foundry_conduct_workflow { authorizeStage:
'stage-gate-greenlight' }` (which authorizes THEN steps past the gate in one call). Walking it to
exhaustion runs the whole pipeline: `intake → gate(HALT) → [founder authorizes] → build-path(spawn) →
conduct → ship`.

---

## 5. Slice 4 — "the conductor walks the workflow tree, halts at founder gates, and is crash-recoverable"

The thinnest falsifiable slice: a step pulls the ready stage, halts at a founder gate or actuates +
marks done, and a full walk runs the pipeline end-to-end with each handler firing once (replay-safe). The
two hardening commits add the recovery floor: a partial conduct-step RE-RUNS to completion, never wedges.

### 5.1 Mechanism + file:line touch-points

| # | Touch-point | What |
|---|---|---|
| 1 | `src/plan/workflow-conductor.ts` (new) | The whole slice: `conductWorkflowStep` (`:162`), `authorizeWorkflowStage` (`:210`), `markStageDone` (`:90`, direct done-pair + under-lock re-check KD-7), `danglingOwnStage`/`recoverDanglingStage` (`:117`/`:140`, crash-recovery KD-8), `stageNode` (`:59`), `isFounderGated`/`hasAction` (`:66`), the `ConductResult`/`ConductStatus` types. |
| 2 | `src/workflow/actions.ts` (extend) | The `build-path` handler gains the exact-replay-or-throw idempotency guard (`:64-98`, KD-6) — what makes a partial conduct-step re-runnable. |
| 3 | `src/instances/foundry-workflow.ts` (extend) | `stage-gate-greenlight` gains `meta.founderGated: true` (`:79`). Additive metadata; the Slice-1 `action`/`effects` ride alongside, untouched. |
| 4 | `src/mcp/tools.ts` (`:104`) + `src/mcp/server.ts` | The `foundry_conduct_workflow` MCP tool — step the conductor; `authorizeStage?` authorizes a founder-gated stage before stepping. |
| 5 | `test/workflow-conduct.acid.test.ts` (new) | The acid battery (a)–(f) below + the crash-recovery groups (WEDGE / FIX-1 / FIX-3), every acid against a TEMP log. |
| 6 | `src/plan/workflow-frontier.ts`, `src/plan/plan-frontier-all.ts`, the kernel | **UNTOUCHED** — the conductor COMPOSES them; `planFrontierAll` and `claimableItems` are not changed (Slice-3 isolation preserved). |

### 5.2 Acid battery — each must BITE

Committed + deterministic in `test/workflow-conduct.acid.test.ts`, run unconditionally in `ci:local`.
Every acid runs against a TEMP log — NEVER the live one. `now` is pinned via `FoundryDeps.now`.

**(a) Conduct advances the first (action-less) stage; next ready is the gate.** From the bootstrapped
initial state (`bootstrapWorkflow` queues all 5 stages; `workflowFrontier` = `['stage-intake']`),
`conductWorkflowStep` returns `{ status: 'advanced', stage: 'stage-intake' }` (intake carries no action,
so it is marked done with no actuation), and the frontier advances to `['stage-gate-greenlight']` (the
founder-gated gate). **The bite:** the action-less stage advances by the done-pair alone; if
`markStageDone` did not fire, the frontier would not advance and the next-ready assertion fails.

**(b) The conductor HALTS at the founder-gated gate (the governance invariant).** Advance intake → reach
the gate. The gate carries `action: 'reprioritize-product'` — capture the `foundry` product's priority
BEFORE. `conductWorkflowStep` returns `{ status: 'awaiting-founder', stage: 'stage-gate-greenlight' }`:
the frontier is STILL `['stage-gate-greenlight']` (no advancement), `state.items.get('stage-gate-
greenlight').claims === []` (NOT marked done), and the `foundry` priority is UNCHANGED (no action
actuated — the founder-gate short-circuit fired first). A second `conductWorkflowStep` STILL halts
(idempotent — no auto-pass). **The headline bite (MUTATION):** remove `founderGated` from the gate (with
the `foundry` product registered so the gate's `reprioritize-product` action CAN fire) →
`conductWorkflowStep` AUTO-ADVANCES past the gate (`status: 'advanced'`, frontier →
`['stage-build-path']`) instead of `awaiting-founder` → RED. Pull the founder gate, the conductor
auto-greenlights.

**(c) Founder authorization unblocks build-path → product SPAWNED.** Conduct to the gate (halts),
authorize it (`authorizeWorkflowStage(deps, 'stage-gate-greenlight')`) → the frontier advances to
`['stage-build-path']`. The spawned product does NOT exist yet (no `planFrontierAll` item under
`SPAWNED_KEY/`). `conductWorkflowStep` advances `stage-build-path` → it ACTUATES `build-path` (Slice 2)
→ a product tree is SPAWNED: the spawned root is now in the GLOBAL product frontier (`planFrontierAll`
includes an item under `SPAWNED_KEY/`) and `state.products.has(SPAWNED_KEY)`. **The bite (MUTATION):**
drop the `build-path` entry from `ACTION_REGISTRY` → conducting `stage-build-path` throws `/unknown
action/`, NO product is spawned, and the stage stays un-advanced (still
`['stage-build-path']`) — proving the actuate-BEFORE-mark-done ordering is forward fail-safe (a thrown
actuation never half-marks the stage done, KD-4) → RED.

**(d) Walk the WHOLE pipeline; each handler fires once; replay-safe.** A `walkPipeline` helper steps the
conductor until idle, authorizing a founder-gated stage whenever it halts. The advanced stages are
EXACTLY `['stage-intake', 'stage-build-path', 'stage-conduct', 'stage-ship']` (the gate was
founder-authorized, NOT auto-advanced, so it is absent from the advanced list). The pipeline is
exhausted (`workflowFrontier` = `[]`, next `conductWorkflowStep` is `idle`). The `build-path` handler
fired EXACTLY ONCE (exactly one `ProductRegistered` for `SPAWNED_KEY`). **The replay-safe bite:** re-fold
the raw log MANY times (a pure projection — no handler in the loop) → the spawned-product event count is
STABLE across re-folds, every workflow stage is done, and the count never multiplies. If a fold re-ran
the handler, the count would grow → RED. The walk is reconstructable from the log; replay folds events,
never re-runs the handler (ADR-263 D3).

**(e) The conductor marks stages done WITHOUT warm-pool slot-leasing.** Walking the whole pipeline NEVER
invokes `leaseSlotIndex` (no `SlotLeased` event is appended during the walk). The acid PROVES the orphan
path genuinely throws — claim a workflow stage the LONG way (`ops.claim`) then `leaseSlotIndex` →
`/not registered|corrupt log/` (the workflow product is not registered) — so the conductor's clean walk
is real: it marks stages done via the DIRECT done-pair, not the lease path (KD-3). **The bite:** a
conductor that marked done through `leaseSlot` would throw on the orphan workflow product → the walk
would not complete → RED.

**(f) The conductor COMPOSES `workflowFrontier` + `actuate` (no second claimability rule).** A
source-scan acid asserts `workflow-conductor.ts` imports `workflowFrontier` + `actuateNode` and
re-implements NO claimability/gating rule of its own (no `function claimableItems`, no `function
depsSatisfied`, no `.sort(`, no `dependsOn.every`). PLUS a behavioural assertion: the stage the conductor
advances IS exactly the head of `workflowFrontier`. **The bite:** replace the frontier pull with a
hand-rolled `state.items.filter(deps-done ∧ not-done)` loop (a second encoding) → the source-scan guard
fails (the regex matches the re-implemented rule) AND the advanced-stage-is-the-frontier-head assertion
can diverge → RED (the ADR-247 M1 one-encoding principle, source-guarded).

**(g) WEDGE: a crashed/partial conduct-step RE-RUNS to completion (KD-6 — `build-path` idempotent).** Walk
to the ready `stage-build-path`, then actuate `build-path` DIRECTLY (product spawned) WITHOUT marking the
stage done — exactly the crash state (stage still ready, product already queued). Re-conduct →
`conductWorkflowStep` re-actuates `build-path`, which idempotent-RETURNS the existing product (NOT `items
already queued`), then marks done and advances; exactly ONE product spawned. A second variant conducts the
same ready build-path stage TWICE → one product, no throw, no wedge. **The bite (MUTATION):** restore a
non-idempotent `build-path` handler (always `queuePush`) → the recovery re-conduct throws `/already
queued/` → RED (the pre-fix permanent wedge made visible).

**(h) FIX-1: a crash mid done-marking is RECOVERED (KD-8 — dangling-own-claim).** Append ONLY the
conductor's `claimAcquired` for `stage-intake` (the first of `markStageDone`'s two appends) — the crash
window; the stage folds to `claimed` and drops out of `workflowFrontier` (`[]`). `conductWorkflowStep`
does NOT return a lying `idle` — it COMPLETES the dangling own-stage and reports `advanced`; the stage is
genuinely done and the frontier advances to the gate. Recovery is exactly-once (one `ClaimReleased(done)`).
**The bite (MUTATION):** remove the recovery → `conductWorkflowStep` returns the lying `idle` and the
pipeline STALLS → RED. **OWN-only:** a FOREIGN claim on a stage is NEVER auto-completed — the conductor
returns a real `idle`, not a spurious advance.

**(i) FIX-3: the under-lock readiness re-check prevents a double done-mark (KD-7).** Call the exported
`markStageDone` TWICE for the same ready `stage-intake` (two conductors past the lock-free pre-check) →
EXACTLY ONE done-pair lands; the second re-folds under the lock, finds intake gone, no-ops. **The bite
(MUTATION):** a no-guard `markStageDone` (re-check removed) called twice lands TWO done-pairs → RED; the
real guarded one lands ONE.

Two further committed checks pin the founder-gate semantics: `authorizeWorkflowStage` REJECTS a
non-founder-gated ready stage (`/not founder-gated/`) and a not-ready/already-done stage (`/not ready for
authorization/`); and the founder-gate's `reprioritize-product` action NEVER fires across the
authorize+conduct path (the `foundry` priority is unchanged — the gate is passed by AUTHORIZATION, not by
actuating its action).

### 5.3 What Slice 4 deliberately does NOT do

- It does NOT surface the halt as a UI button (Slice 5 — the dashboard renders `awaiting-founder` as a
  founder-clickable authorize button, reusing ADR-261/262's served-mode + confirm-gated pattern).
- It does NOT register the workflow as a product so it re-enters `planFrontierAll` — the conductor pulls
  `workflowFrontier` through a DEDICATED step (preserving Slice-3 non-registration); `planFrontierAll` is
  untouched.
- It does NOT add a new event type — the mark-done reuses the existing `claimAcquired` +
  `claimReleased(done)` pair.
- It does NOT add T0/T2 workflow variants (Slice 5) — `conductWorkflowStep` walks the single
  `FOUNDRY_WORKFLOW`; a variant is a separate keyed workflow the conductor walks the same way.

---

## 6. ADR-176 inclusion test — NOT triggered (pack-level)

Applying the inclusion test
([ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) §2 — BOTH
legs must hold for a thing to be kernel):

- **(a) Is "a conductor that walks the workflow frontier + a founder-gate halt" one of the four kernel
  concerns?** No new kernel shape. The plan tree IS a kernel concern (recurse the plan, ADR-127 §1.1),
  but the workflow tree is the EXISTING plan-tree primitive; the frontier is the EXISTING
  `workflowFrontier` (Slice 3); actuation is the EXISTING `actuateNode` (Slice 1); the done-event is the
  EXISTING `claimReleased(done)`; `founderGated` rides the `metadata` JSONB boundary (ADR-176 §3).
  `conductWorkflowStep` + `authorizeWorkflowStage` are pack-level composition. Nothing new reaches the
  kernel.
- **(b) Is the workflow conductor needed by ≥2 packs as shared infrastructure the kernel must validate /
  query / version?** No. Single consumer (`domains/foundry`), over foundry's own pipeline. No second pack
  needs the foundry workflow conductor; the kernel must not validate/version a pack's pipeline walker.

**Both legs FAIL → pack territory.** **"Store generators, derive graphs" is UPHELD** (ADR-176 §4): the
workflow structure + the stage-completion events (the actuation's emitted events + the done-pairs) live
in the log (the generators); the frontier is a DERIVED view re-computed on every read; the walk is
reconstructable from the log (replay folds the events, never re-runs the handler). **Zero kernel change;
zero design-system change.**

**External positioning — N/A.** Internal-only. An internal product-creation machine over the foundry
substrate, built not marketed (the north-star Option A framing).

---

## 7. The ladder — where this sits

| Slice | What | Mechanism |
|---|---|---|
| **1 (shipped)** | A workflow intervention actuates a real action. | `FOUNDRY_WORKFLOW` tree + `actuate`/`actuateNode` + the `ACTION_REGISTRY`. |
| **2 (shipped)** | A workflow intervention SPAWNS a product tree across trees. | `build-path` handler reusing the ADR-249 generate path; cross-link a DERIVED `PlanNodeId` reference. Resolves ADR-263 OQ-2. |
| **3 (shipped)** | The workflow tree ADVANCES itself by derivation. | Stages gain `dependsOn`; `workflowFrontier = planFrontier(workflowTree(), …)` (ONE encoding); stage-done is the EXISTING done-event; advancing is re-derivation poked by scheduled-wake, never a callback. Isolated by NON-REGISTRATION. Resolves ADR-263 OQ-1. |
| **4 (this)** | The conductor WALKS the workflow tree; the workflow RUNS, halts at founder gates, and is CRASH-RECOVERABLE. | `conductWorkflowStep` pulls `workflowFrontier` (Slice 3), `actuateNode`s the ready stage's action (Slice 1 — `build-path` spawns a product, Slice 2), marks it done via a DIRECT done-pair BYPASSING `leaseSlot` (serial walk; orphan product), and HALTS at founder-gated stages (the governance invariant); `authorizeWorkflowStage` is the founder act. Re-entrant-lock deadlock avoided by separating the done-marking lock from the actuation → the step is NON-ATOMIC but RECOVERABLE: idempotent `build-path` (KD-6), under-lock re-check (KD-7), dangling-own-claim recovery (KD-8) → a partial step RE-RUNS, never wedges. COMPOSES Slices 1–3; ZERO kernel change. |
| **5 (next)** | The dashboard surfaces the halt + T0/T2 variants. | The cockpit (ADR-261/262) renders an `awaiting-founder` stage as a founder-clickable AUTHORIZE button (reusing the served-mode + confirm-gated pattern); sibling `FOUNDRY_WORKFLOW` T0/T2 variants the conductor walks the same way (off `riskTier` / a selector). |

Slice 5 (the dashboard surfaces the halt as a founder-clickable button + T0/T2 variants) is the natural
next rung: the workflow now RUNS and HALTS at the gate, so the founder needs a one-click way to authorize
— exactly the ADR-262 served-mode + confirm-gated-button pattern, now firing `authorizeWorkflowStage`
instead of `reprioritizeProduct`. And once one workflow runs end-to-end, a T0-light / T2-heavy variant is
the same walk over a sibling tree.

---

## 8. What does NOT change

- **No kernel contract.** `@de-braighter/substrate-contracts` is byte-unchanged — the workflow tree is
  the EXISTING plan-tree primitive, `founderGated` rides the EXISTING `metadata` JSONB boundary, the
  mark-done reuses the EXISTING `claimAcquired` / `claimReleased(done)` events (no new event type).
- **No design-system change.** Slice 4 has no UI; the conductor is pure pack code (the UI is Slice 5).
- **No second claimability encoding.** The conductor pulls `workflowFrontier` (a thin wrapper over
  `planFrontier`, ADR-247 M1); the source-scan acid (f) guards that no second rule was introduced.
- **`planFrontierAll` + `claimableItems` are untouched.** The conductor walks the workflow frontier
  through a DEDICATED step, preserving the Slice-3 isolation-by-non-registration — the workflow product
  is never in `s.products`, so the product conductor never surfaces a stage; the workflow conductor is a
  separate driver. The mark-done deliberately bypasses `leaseSlotIndex` (which would throw on the orphan
  workflow product).

---

## 9. Slice scope

- **foundry (as SHIPPED, branch `feat-workflow-conduct` HEAD `3dcf09c` — the walk `6e5e037` + the
  crash-recovery hardening `c37305f` + `3dcf09c`):** add `src/plan/workflow-conductor.ts`
  (`conductWorkflowStep` + `authorizeWorkflowStage` + `markStageDone` the direct done-pair with the
  under-lock re-check + `danglingOwnStage`/`recoverDanglingStage` the crash-recovery + `stageNode` + the
  `ConductResult`/`ConductStatus` types), extend `src/workflow/actions.ts` (the `build-path`
  exact-replay-or-throw idempotency guard, `:64-98`), extend `src/instances/foundry-workflow.ts`
  (`stage-gate-greenlight` gains `meta.founderGated: true`, `:79`), add the `foundry_conduct_workflow` MCP
  tool (`src/mcp/tools.ts:104` + `src/mcp/server.ts`, the operator trigger), and add the acids in
  `test/workflow-conduct.acid.test.ts` (conduct-advances-first-stage · halts-at-founder-gate ·
  authorize-unblocks-build-path-spawn · walk-whole-pipeline-each-handler-once-replay-safe ·
  no-leaseSlot-in-the-walk · composes-workflowFrontier-and-actuate · wedge-partial-conduct-re-runs ·
  crash-mid-done-recovered · under-lock-re-check-no-double-mark). It REUSES `workflowFrontier`
  (`src/plan/workflow-frontier.ts`), `actuateNode` (`src/workflow/actions.ts`), `buildCascadeTree`
  (`src/plan/cascade.ts`), the `claimAcquired`/`claimReleased` events (`src/events.ts`), `withStoreLock`
  (`src/store-lock.ts`), `fold` (`src/state.ts`), `readEnvelopes`/`append` (`src/log.ts`).
  `planFrontierAll`, `claimableItems`, the kernel, and the design-system are UNTOUCHED. **No
  `@de-braighter/*` change.**
- **specs:** ADR-266 — codifies the key decisions: (KD-1) the conductor COMPOSES Slices 1–3 (no new
  claimability rule, no new fold, no new event type); (KD-2) THE GOVERNANCE INVARIANT — the conductor
  HALTS at founder-gated stages, `authorizeWorkflowStage` is the founder act, threading ADR-262's
  founder-gated model into the machine; (KD-3) the mark-done BYPASSES `leaseSlot` (a direct done-pair
  under the store lock; serial walk; safe because frontier-gated); (KD-4) the actuation and the
  done-marking take the store lock SEPARATELY (the re-entrant-deadlock fix → the step is NON-ATOMIC but
  RECOVERABLE); (KD-5) ADR-176 PACK-LEVEL, pack code composing existing primitives, `founderGated` rides
  `metadata`, zero kernel change, no new event type; plus the three RECOVERY/ROBUSTNESS decisions that
  make the conductor crash-recoverable: (KD-6) `build-path` actuation is IDEMPOTENT (exact-replay-or-throw
  — re-runnable, no silent merge); (KD-7) `markStageDone` does a REAL under-lock readiness re-check (no
  double-mark); (KD-8) crash-recovery completes the conductor's OWN dangling claim (never a lying `idle`,
  never a foreign claim). (In ADR-266 these land as decision invariants D1–D8 and Alternatives 1–4.)

This slice depends only on the existing workflow frontier (`workflowFrontier`, Slice 3), the existing
action registry (`actuateNode`, Slice 1), the existing done-event (`claimReleased(done)`), the existing
store lock (`withStoreLock`), and the existing `buildCascadeTree`. It is the realization of ADR-263 D4 +
the Slice-3 advancement — the conductor now DRIVES the workflow the way it drives the product tree, with
the one decisive addition that makes the HOW safe to automate: it HALTS at the founder gate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
