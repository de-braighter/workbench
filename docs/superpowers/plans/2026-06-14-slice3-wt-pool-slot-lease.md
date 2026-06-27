# Slice-3 · Warm-pool per-slot LEASE primitive (foundry tested code, PR1)

- **Date:** 2026-06-14
- **Spec:** `docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md` §C.4, §9 OQ-6, §10 slice-3.
- **Repo:** `domains/foundry` (worktree off `origin/main` @ 4429aa7).
- **Pattern:** mirror `reserveAdr` (events/state/ops/mcp) + `store-lock.ts` (pure fns + injected `run`). TDD mandatory, tests vs `mkdtempSync` temp dirs.
- **Model (founder-chosen 2026-06-14):** worker self-leases, **claim-bound**. ONE new event; slot frees when its claim is no longer `claimActive` (released / handed-off / TTL-expired) — reuses the existing stale/reclaimable claim model. No `SlotReleased` event, no second TTL.

## Why (the gap this closes)

The warm-pool MECHANISM (`wt-pool.ts`, foundry#5) is shipped + tested but INERT on the autonomous path: nothing safely hands out slot indices. A naive worker-index→slot map COLLIDES under the superconductor (two conductors on one repo both lease slot-0 → one's reset wipes the other's tree). This adds a real per-slot LEASE under the same `withStoreLock` that arbitrates `claim()` — so slot-index allocation is globally arbitrated (multi-coordinator-safe by construction). This is the dropped `nextFreeSlot` from foundry#5 landing **with its consumer** (ADR-176 demand-driven). PR2 (separate) threads it into the worker/conductor skills.

## Invariants (never weaken)

- **Throughput-only.** Correctness never depends on the pool. The op may throw on any anomaly; the caller (worker ISOLATE) catches and cold-adds.
- **Store generators, derive graphs.** `nextFreeSlot` is a pure fold over active leases — NEVER stored state.
- **One store-lock.** The op runs inside `withStoreLock(deps.dataDir, …)`, identical to `claim`/`reserveAdr`.
- **Claim-bound liveness.** A slot is occupied iff its lease's claim is `claimActive(now)`. Freed on release/handoff/expiry — symmetric with `staleClaims` (reclaimable orphans, no leak).

## Task 1 — event + aggregate id (`events.ts`, `scope.ts`)

**RED →** `test/events.test.ts`: add a `slotLeased` describe block.
- `slotLeased({repo,slotIndex,claimId,sessionId,ts})` returns a valid envelope: `eventType === 'foundry:SlotLeased.v1'`, `aggregateType === 'WtSlot'`, `aggregateId === slotAggregateId(repo, slotIndex)`, payload `{repo, slotIndex, claimId}`, `metadata.actorRef === 'session:'+sessionId`.
- rejects negative `slotIndex` (zod `.nonnegative()`); accepts `0`.
- `scope.test.ts`: `slotAggregateId('r', 0)` is a valid v5 UUID, stable, and distinct per `(repo, slotIndex)` and across repos.

**GREEN →**
- `events.ts`: add `SLOT_LEASED: 'foundry:SlotLeased.v1'` to `EVENT`; `const SlotLeased = z.object({ repo: z.string().min(1), slotIndex: z.number().int().nonnegative(), claimId: z.string().min(1) })`; export `SlotLeasedPayload`; constructor:
  ```ts
  export const slotLeased = (i: z.input<typeof SlotLeased> & { ts: string; sessionId: string }) =>
    envelope(EVENT.SLOT_LEASED, 'WtSlot', slotAggregateId(i.repo, i.slotIndex), i.ts,
             SlotLeased.parse(i), `session:${i.sessionId}`);
  ```
  (`SlotLeased.parse(i)` strips the extra `ts`/`sessionId` — zod object strips unknowns; mirror existing constructors.)
- `scope.ts`: `export const slotAggregateId = (repo: string, slotIndex: number): string => uuidv5(\`wt-slot:${repo}#${slotIndex}\`);`

## Task 2 — fold + derived helpers (`state.ts`)

**RED →** `test/state.test.ts`: add a `slot lease` describe block driving `fold` + helpers:
- one lease on an active claim → `nextFreeSlot(s,'r',now) === 1`; `activeSlotLeases(s,'r',now)` length 1.
- two leases (slots 0,1) on two active claims → `nextFreeSlot === 2`.
- lowest-free fill: leases 0,1,2; the claim holding 1 is released → `nextFreeSlot === 1` (not 3).
- expiry frees: a lease whose claim has lapsed TTL (advance `now` past `lastBeatAt + ttl`) → its slot is free.
- handoff frees: a lease whose claim was handed-off → slot free.
- per-repo independence: leases on `r1` don't affect `nextFreeSlot('r2')`.
- idempotent fold: two `SlotLeased` for the same claimId → first-writer-wins (one entry).
- `slotLeaseForClaim(s, claimId)` returns the lease or undefined.

**GREEN →**
- `DerivedState`: add `slotLeases: Map<string, SlotLeaseState>` (key = claimId); init `new Map()` in `fold`.
- `interface SlotLeaseState { repo: string; slotIndex: number; claimId: string; leasedAt: string }`.
- fold case:
  ```ts
  case EVENT.SLOT_LEASED: {
    const claimId = str(p['claimId']);
    if (!s.slotLeases.has(claimId)) {
      s.slotLeases.set(claimId, { repo: str(p['repo']), slotIndex: p['slotIndex'] as number, claimId, leasedAt: e.occurredAt });
    }
    break;
  }
  ```
- helpers (after `adrReservationForItem`):
  ```ts
  export function activeSlotLeases(s: DerivedState, repo: string, nowMs: number): SlotLeaseState[] {
    const out: SlotLeaseState[] = [];
    for (const l of s.slotLeases.values()) {
      if (l.repo !== repo) continue;
      const c = findClaim(s, l.claimId);
      if (c && claimActive(c, nowMs)) out.push(l);
    }
    return out;
  }
  export function nextFreeSlot(s: DerivedState, repo: string, nowMs: number): number {
    const taken = new Set(activeSlotLeases(s, repo, nowMs).map((l) => l.slotIndex));
    let i = 0; while (taken.has(i)) i += 1; return i;
  }
  export function slotLeaseForClaim(s: DerivedState, claimId: string): SlotLeaseState | undefined {
    return s.slotLeases.get(claimId);
  }
  ```

## Task 3 — the op (`ops.ts`)

**RED →** `test/ops-lease-slot.test.ts` (mirror `ops-adr-reserve.test.ts`; build a queued+claimed item via `queuePush`+`claim`, drive `leaseSlotIndex`):
- allocates slot 0 for a fresh claim; returns `{ slotIndex: 0, repo, claimId }`.
- second claim on a DIFFERENT (disjoint-scope) item, same repo → slot 1 (no collision) — the headline multi-worker property.
- two DIFFERENT sessions racing on the same repo → distinct slots (serialized by the lock).
- releasing claim-A then a new claim-C leases → reuses slot 0 (lowest free).
- idempotent: the SAME claim leasing twice → same slotIndex, no second event (assert log line count).
- rejects unknown claimId; rejects an ended (released) claim; rejects a superseded claim.
- two repos → independent sequences (both start at 0).

**GREEN →**
```ts
export function leaseSlotIndex(deps: FoundryDeps, input: { claimId: string }): { slotIndex: number; repo: string; claimId: string } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const nowMs = Date.parse(ts);
    const s = load(deps);
    const c = liveClaim(s, input.claimId);             // unknown/ended → throw (existing helper)
    const item = assertActionable(s, c, nowMs);         // done/superseded → throw (existing helper)
    const existing = slotLeaseForClaim(s, input.claimId);
    if (existing) return { slotIndex: existing.slotIndex, repo: existing.repo, claimId: input.claimId };
    const prod = s.products.get(item.productKey);
    if (!prod) throw new Error(`item ${item.itemId} references unknown product ${item.productKey} — corrupt log?`);
    const repo = prod.repo;
    const slotIndex = nextFreeSlot(s, repo, nowMs);
    append(ev.slotLeased({ repo, slotIndex, claimId: input.claimId, sessionId: c.sessionId, ts }), deps.logPath);
    return { slotIndex, repo, claimId: input.claimId };
  });
}
```
- import `nextFreeSlot`, `slotLeaseForClaim` from `./state.js`. `liveClaim`/`assertActionable` are file-local — `leaseSlotIndex` must be defined AFTER them (they're declared in the lifecycle section). Place `leaseSlotIndex` after `handoff`.

## Task 4 — MCP tool (`mcp/tools.ts`)

**RED →** `test/mcp-tools.test.ts`: add a `foundry_lease_slot` case — push+claim an item, call the tool with `{ claimId }`, assert the parsed result has `slotIndex: 0`; a bad claimId → `isError: true`.

**GREEN →** in `makeTools`: `foundry_lease_slot: guard((a: { claimId: string }) => ops.leaseSlotIndex(deps, a)),`.

## Gate

- `npm run ci:local` (typecheck + `test:coverage`) GREEN in the worktree. Keep coverage at/above the foundry's current bar (statements ~98%, branches ~93%).
- `npm run build` (tsc emit) clean.
- No edits outside `src/{events,scope,state,ops,mcp/tools}.ts` + `test/*`.

## Out of scope (PR2, separate)

- `foundry-worker` ISOLATE self-lease wiring; conductor (build+autonomous) + superconductor prompts auto-engage; flip §C.4 / OQ-6 / slice-2.5 spec notes "slice-3 → shipped".

## Accepted edge (document in PR body)

A TTL-revived claim (lapsed then `foundry_heartbeat`-revived) can transiently share a slot with a worker that took the freed index meanwhile. This is **throughput-only**: it never corrupts the shared clone (`wt-pool ensureSlot` validates worktree-rootedness before any reset) nor the foundry log (store-lock arbitrates); the worst case is two builds collide in one slot, fail, and cold-retry. Bounded by the 240-min TTL window. Consistent with the spec's "any lease anomaly falls back to a cold `git worktree add`."
