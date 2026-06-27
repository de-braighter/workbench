# Slice-3 · Foundry lifecycle + observability ops (item 2, single bundled foundry PR)

- **Date:** 2026-06-14
- **Spec:** `docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md` §9.3 (orphan-reconcile), §C.3/§9.4 (coordinator presence), D6 (per-item TTL).
- **Repo:** `domains/foundry` (worktree off `origin/main` @ 558db93).
- **Pattern:** mirror the existing event/state/ops/mcp pattern (`claim`/`reserveAdr`/`recordMerge`). TDD mandatory, tests vs `mkdtempSync` temp dirs, modeled on `test/ops-*.test.ts`. npm (not nx): `npm run ci:local`.
- **Founder decision (2026-06-14):** ONE bundled foundry PR (lifecycle + observability together).

## Why (the warts this closes — from the live autonomous run)

1. `foundry_release{blocked}` on a BUILT item **re-queues** it (it reappears claimable despite an open PR + pending gate).
2. There is **no clean terminal-done** for a built/blocked item without a fresh `foundry_claim`→`release done` (the O-2 bookkeeping workaround).
3. **F1 retire-op gap:** a stale/superseded QUEUED item can't be retired (claim→release-done-superseded workaround; a not-yet-claimable stale item can't be retired at all).
4. **Orphan-reconcile (§9.3):** a stranded commit/PR on a stale claim is recovered out-of-band (gh + log archaeology); promote to a foundry op.
5. **Observability (§C.3/§9.4):** no coordinator presence in `foundry_status`; the board doesn't show gate status per built item.

## Design (two lifecycle verbs + minimal observability)

- **`retireItem`** = terminal ABANDON (no re-queue) — closes warts 1, 2, 3.
- **`reconcileClaim`** = ADOPT a stranded PR into `built` — closes wart 4 (§9.3).
- **coordinator presence** + **gate-aware board** = observability (§C.3/§9.4).
- **D6 per-item TTL:** already supported (`claim` takes `ttlMinutes`); NO foundry code — a conductor-skill policy note only (out of scope for this PR; noted in PR body).

## Invariants (never weaken)

- Single store-lock arbitrates every mutation (identical to `claim`).
- Store generators, derive graphs — new predicates are pure folds, never persisted.
- A retired item is **terminal** (never re-claimable), like done; but a retired DEP does NOT satisfy a dependent (`depsSatisfied` stays `itemDone`-only — abandoning A leaves B's dep unmet, surfaced as stuck, never auto-unblocked).
- Never yank a LIVE worker: `retireItem` rejects an item with an ACTIVE claim; `reconcileClaim` acts only on a STALE last-claim.

## Task 1 — `WorkItemRetired.v1` event + scope (events.ts)

**RED →** `test/events.test.ts`: `workItemRetired({itemId, reason, ts})` → eventType `foundry:WorkItemRetired.v1`, aggregateType `WorkItem`, `aggregateId === itemAggregateId(itemId)`, payload `{itemId, reason}`, actor `foundry:conductor`. Reject empty itemId/reason.

**GREEN →** `events.ts`: add `WORK_ITEM_RETIRED: 'foundry:WorkItemRetired.v1'`; `const WorkItemRetired = z.object({ itemId: z.string().min(1), reason: z.string().min(1) })`; export type; constructor `workItemRetired(i & {ts})` → envelope(WORK_ITEM_RETIRED, 'WorkItem', itemAggregateId(i.itemId), ts, WorkItemRetired.parse(i), 'foundry:conductor'). (No new scope id — reuses `itemAggregateId`.)

## Task 2 — retired state + predicates (state.ts)

**RED →** `test/state.test.ts`: fold a `WorkItemRetired` → `it.retired = {reason, at}`; `itemRetired(it)` true; `itemStatus` === 'retired'; first-writer-wins (second retire ignored); a retired item is NOT in `claimableItems`; a retired DEP does NOT satisfy `depsSatisfied` for a dependent.

**GREEN →**
- `ItemState`: add `retired?: { reason: string; at: string }`.
- fold `WORK_ITEM_RETIRED`: `const item = s.items.get(itemId); if (item && item.retired == null) item.retired = { reason, at: e.occurredAt };` (first-writer-wins; mirrors merge idempotency).
- `export const itemRetired = (it: ItemState): boolean => it.retired != null;`
- `ItemStatus` gains `'retired'`; `itemStatus = itemDone ? 'done' : itemRetired ? 'retired' : activeClaim ? 'claimed' : itemBuilt ? 'built' : 'queued'`.
- `claimableItems`: unchanged (it already filters `itemStatus === 'queued'`, which excludes 'retired').
- `depsSatisfied`: unchanged (`itemDone`-only — a retired dep stays unsatisfied, by design).

## Task 3 — `retireItem` op (ops.ts)

**RED →** `test/ops-retire.test.ts` (mirror `ops-record-merge.test.ts`): retire a QUEUED item → status 'retired', not claimable; retire a BUILT item (released 'built') → 'retired', `claim` rejects it; retire a STALE-claimed item (claim expired) → allowed; **reject** retiring an ACTIVELY-claimed item (`/actively claimed/`); reject an already-done item; reject an already-retired item (idempotency-as-error or no-op — choose reject for clarity); reject unknown itemId.

**GREEN →**
```ts
export function retireItem(deps, input: { itemId: string; reason: string }): { itemId: string; retired: true } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps); const nowMs = Date.parse(ts); const s = load(deps);
    const item = s.items.get(input.itemId);
    if (!item) throw new Error(`unknown item: ${input.itemId}`);
    if (itemDone(item)) throw new Error(`item already done (merged): ${input.itemId}`);
    if (itemRetired(item)) throw new Error(`item already retired: ${input.itemId}`);
    const act = activeClaim(item, nowMs);
    if (act) throw new Error(`item actively claimed by session ${act.sessionId} — release/handoff before retiring: ${input.itemId}`);
    append(ev.workItemRetired({ itemId: input.itemId, reason: input.reason, ts }), deps.logPath);
    return { itemId: input.itemId, retired: true };
  });
}
```

## Task 4 — `reconcileClaim` op (ops.ts) — orphan-reconcile (§9.3), reuses ClaimReleased

**RED →** `test/ops-reconcile.test.ts`: build an item with a STALE claim (claim, advance clock past TTL, no release) → `reconcileClaim({itemId, prRef})` → item becomes 'built' with the prRef; **reject** if the last claim is still ACTIVE (`/active claim/` — don't adopt over a live worker); reject if there's no claim / the last claim already ended (nothing to reconcile); reject if the item is already terminal (done/retired/built). prRef required.

**GREEN →**
```ts
export function reconcileClaim(deps, input: { itemId: string; prRef: string; note?: string }): { itemId: string; claimId: string; outcome: 'built' } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps); const nowMs = Date.parse(ts); const s = load(deps);
    const item = s.items.get(input.itemId);
    if (!item) throw new Error(`unknown item: ${input.itemId}`);
    if (itemDone(item) || itemRetired(item)) throw new Error(`item already terminal: ${input.itemId}`);
    if (itemStatus(item, nowMs) === 'built') throw new Error(`item already built (awaiting merge): ${input.itemId}`);
    const last = item.claims.at(-1);
    if (!last) throw new Error(`no claim to reconcile on ${input.itemId}`);
    if (claimEnded(last)) throw new Error(`last claim on ${input.itemId} already ended — nothing to reconcile`);
    if (!claimExpired(last, nowMs)) throw new Error(`last claim on ${input.itemId} is still active (session ${last.sessionId}) — do not reconcile a live worker`);
    append(ev.claimReleased({ claimId: last.claimId, itemId: item.itemId, sessionId: last.sessionId, outcome: 'built', prRef: input.prRef, note: input.note ?? 'reconciled: adopted stranded PR from a stale claim', ts }), deps.logPath);
    return { itemId: input.itemId, claimId: last.claimId, outcome: 'built' };
  });
}
```
(Reuses `ClaimReleased.v1` — no new event. After append, `itemBuilt` is true → the conductor's merge pass handles it.)

## Task 5 — coordinator presence (events.ts + state.ts + ops.ts) — §C.3/§9.4 observability

**RED →** `test/events.test.ts` + `test/ops-coordinator.test.ts`: `registerCoordinator({kind:'conductor', sessionId})` → returns `{coordinatorId}`, fold shows it; `coordinatorHeartbeat({coordinatorId})` updates lastBeatAt; an unknown coordinatorId heartbeat → reject; a coordinator with a recent beat is `activeCoordinators`, one past the window is not; `kind` ∈ conductor|superconductor (reject other).

**GREEN →**
- `events.ts`: `COORDINATOR_REGISTERED: 'foundry:CoordinatorRegistered.v1'` payload `{coordinatorId, kind, sessionId}` (kind enum `['conductor','superconductor']`); `COORDINATOR_HEARTBEAT: 'foundry:CoordinatorHeartbeat.v1'` payload `{coordinatorId}`. Aggregate type `Coordinator`, new `coordinatorAggregateId(coordinatorId)=uuidv5('coordinator:'+id)` in scope.ts. Actor `session:<sessionId>` / `session:<...>`.
- `state.ts`: `CoordinatorState { coordinatorId, kind, sessionId, registeredAt, lastBeatAt }`; `coordinators: Map` on DerivedState; fold both events (register sets, heartbeat updates lastBeatAt if present); `COORDINATOR_PRESENCE_MS = 600_000` (10min) const; `activeCoordinators(s, nowMs) = [...].filter(c => nowMs - Date.parse(c.lastBeatAt) < COORDINATOR_PRESENCE_MS)`.
- `ops.ts`: `registerCoordinator({kind, sessionId})` → mint coordinatorId (idOf), append; `coordinatorHeartbeat({coordinatorId})` → reject unknown, append.

## Task 6 — status board: ACTIVE COORDINATORS + gate-aware BUILT (status.ts)

**RED →** `test/prompts-status.test.ts` (or status section of an existing test): statusText shows an ACTIVE COORDINATORS section listing active coordinators (kind + session + age); a stale coordinator is omitted; a BUILT item shows its gate status (pending/approved/rejected) by matching a gate whose `payloadRef` contains the itemId or prRef; a retired item appears under a RETIRED line (or is annotated).

**GREEN →**
- `status.ts`: add ACTIVE COORDINATORS section (after PRODUCTS or before NEXT UP). Annotate each BUILT item with its gate decision (scan `s.gates` for a gate whose `payloadRef` references the itemId or its prRef → 'gate: approved|pending|rejected|none'). Show RETIRED items count in the per-product line (extend the `by` tally to include `retired`) — `itemStatus` now returns 'retired', so the existing `by[itemStatus(i)]+=1` must handle the new key (extend the `by` object).

## Task 7 — MCP tools (mcp/tools.ts)

`foundry_retire_item` → `retireItem`; `foundry_reconcile_claim` → `reconcileClaim`; `foundry_register_coordinator` → `registerCoordinator`; `foundry_coordinator_heartbeat` → `coordinatorHeartbeat`. **RED:** add cases to `test/mcp-tools.test.ts` (happy + one error each).

## Gate

- `npm run ci:local` (typecheck + `test:coverage`) GREEN; coverage at/above bar (stmts ~98%, branches ~93%). Add tests for every new branch.
- `npm run build` clean.
- Touch ONLY `src/{events,scope,state,ops,status}.ts`, `src/mcp/tools.ts`, `test/*`.

## Out of scope (named follow-ups)

- Conductor/superconductor skill wiring to USE the new ops (retireItem on gate-reject; reconcileClaim in the recovery pass; registerCoordinator on startup + periodic heartbeat; size per-item TTL per D6) = a thin **workbench** follow-up PR.
- Item 3: green-desk first live sweep + FP-ledger seeding.
