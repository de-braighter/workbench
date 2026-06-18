# Foundry v1 P6 — Scheduled-wake actuation

> Gives foundry's conductor a SCHEDULED self-wake without an internal timer. The REAL CLOCK
> stays EXTERNAL — a cron job / scheduled session / the OS calls an MCP tool periodically;
> foundry only RECORDS the schedule, DECIDES which ticks are due, and RETURNS the
> `planFrontierAll` frontier. Two new pack events (`WakeScheduled` / `WakeFired`), one pure
> deterministic `dueWakes` decision over them, two MCP tools. Resolves
> [ADR-247](../../../layers/specs/adr/adr-247-foundry-doing-side-unified-queue-shadow-retired.md)
> open-question #2. **Zero kernel change; pack-level events + a pure decision function + two
> inbound adapters only — NO timer primitive reaches the kernel (the ADR-176 trip this design
> exists to avoid).**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`src/events.ts`, `src/scope.ts`, `src/state.ts`,
  `src/plan/wake.ts` (new), `src/ops.ts`, `src/mcp/tools.ts`, `src/mcp/server.ts`).
  `layers/specs` (ADR-256, status proposed).
- **Predecessors:** ADR-241 (foundry as sanctioned meta-product), ADR-244 (conductor drives the
  plan-tree frontier), ADR-246 (`planFrontierAll` / `treeFromQueue`), ADR-247 (doing-side
  unified — `planFrontierAll` is the sole conductor driver; P6 resolves its open-Q2), ADR-254
  (foundry self-event-sourcing — the conductor drives FOUNDRY itself off the log; the scheduled
  wake re-checks that same frontier), ADR-176 (kernel minimality inclusion test), ADR-127
  (kernel substrate — the four concerns).

---

## 1. Problem — foundry's conductor is REACTIVE; it has no scheduled self-wake

**Recon (verified against source):**

- Foundry is 100% reactive. There is no `setTimeout`, no `setInterval`, no cron, no daemon
  anywhere in `domains/foundry/src`. The conductor advances ONLY when a session invokes it
  (via the `/foundry-conduct` flow), which drains `planFrontierAll` and dispatches sessions.
  Nothing re-checks the frontier on a schedule; if no human (or scheduled session) invokes the
  conductor, the frontier sits un-drained even when items have become claimable (a dependency
  cleared, a TTL-expired claim freed a scope).
- `planFrontierAll(s, nowMs)` (`src/plan/plan-frontier-all.ts:24`) is the pure, idempotent
  all-product frontier re-check: it folds the log into state and unions
  `planFrontier(treeFromQueue(p, s), s, nowMs)` over every registered product. It has NO
  side effects on claimability — calling it once or a thousand times yields the same frontier
  for the same `(state, nowMs)`. `nextItems` (`src/ops.ts:396`) is its read-only projection
  through `toNextItem`.
- The clock is already INJECTED. Every op resolves `now` via `nowOf(deps)` over
  `FoundryDeps.now` (`src/ops.ts:24, 28`), which defaults to `() => new Date().toISOString()`.
  Tests pin `FoundryDeps.now` to a fixed clock — the standard determinism seam.
- Idempotency precedent already exists. The first-writer-wins fold pattern (a re-recorded fact
  is ignored, the first wins) is established in `state.ts` for gate decisions, ADR
  reservations, merges, slot leases, retirements, and coordinator registration
  (`src/state.ts:268-326`). Monotone-max accumulation is not yet present; P6 adds it for
  `lastFiredTick`.
- Coordinator presence events already exist (`CoordinatorRegistered` / `CoordinatorHeartbeat`,
  `src/events.ts:29-30, 118-126, 204-211`) — the constructor + fold + scope pattern P6 mirrors
  for its two new events.

**Consequence:** [ADR-247](../../../layers/specs/adr/adr-247-foundry-doing-side-unified-queue-shadow-retired.md)
unified the doing-side onto `planFrontierAll` as the sole conductor driver but explicitly
DEFERRED the question of a scheduled self-wake (its open-question #2, quoted verbatim):

> Should the conductor gain a scheduled-wake mechanism (e.g. a daily timer that re-checks
> `planFrontierAll` and signals a new session) now that the frontier is purely
> plan-tree-derived? Deliberately out of scope for this ADR; named here so it is not forgotten.
> A separate decision.

P6 is that separate decision. The frontier is purely plan-tree-derived, so a scheduled
re-check is a clean, well-defined operation: re-fold the log, recompute `planFrontierAll`,
return it. The only design question is WHERE the clock lives.

---

## 2. The crux — the real clock stays EXTERNAL

**The load-bearing architectural decision: foundry does NOT add an internal timer.** It adds
no `setInterval`, no `setTimeout`, no daemon loop, no scheduler thread. An internal timer would
be a standing wall-clock dependency inside a pure, replayable, event-sourced pack — and the
moment foundry needs a "fire every N minutes" primitive, the gravitational pull is to reach for
a SHARED scheduler/timer the kernel would own and validate. That is precisely an
[ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) trip:
a timer is not one of the four kernel concerns, and a kernel scheduler is the kind of
speculative shared infrastructure the inclusion test exists to keep out.

So the clock is kept where it already is — EXTERNAL and INJECTED:

- The **external actuator** is whatever already runs on a real clock: an OS cron entry, a
  scheduled CI job, a periodically-launched conductor session, or a human running a command on
  a cadence. It is the ONLY thing that touches wall time.
- The actuator calls an MCP tool (`foundry_wake`) PERIODICALLY. The interval at which the
  actuator polls is the actuator's business, not foundry's.
- On each call, foundry RECORDS what it must (a `WakeFired` per due tick), DECIDES which ticks
  are due (the pure `dueWakes` function over the injected `now`), and RETURNS the
  `planFrontierAll` frontier. It then does nothing until the next external call.

This keeps the whole mechanism PACK-LEVEL and DETERMINISTIC-TESTABLE. Because the only clock
input is `FoundryDeps.now`, every scheduling behaviour is exercised by pinning `now` to fixed
instants — no fake timers, no async waiting, no flakiness. The schedule + the fired ticks are
event-sourced generators; the due-set is a pure derivation over them. Foundry gains a
SCHEDULE-AWARE decision without gaining a clock.

```text
EXTERNAL (real wall clock)                 FOUNDRY (pure, event-sourced, clock injected)
─────────────────────────                  ──────────────────────────────────────────────
cron / scheduled session / OS  ──calls──▶  foundry_wake(scheduleId?)
   every N minutes                            │  now = FoundryDeps.now()    ← the ONLY clock read
                                              │  due  = dueWakes(state, now)  (PURE)
                                              │  append WakeFired per due tick (under lock)
                                              │  frontier = planFrontierAll(state, now)
                                              ▼
                            returns { fired: {scheduleId,tick}[], frontier: NextItem[] }
```

---

## 3. Mechanism — five touch-points

### R1 — two new pack events (`src/events.ts`)

Add two EVENT keys mirroring the coordinator pair (`src/events.ts:29-30`):

```text
WAKE_SCHEDULED: 'foundry:WakeScheduled.v1',
WAKE_FIRED:     'foundry:WakeFired.v1',
```

Define the two Zod payload objects (mirroring `CoordinatorRegistered` / `CoordinatorHeartbeat`,
`src/events.ts:118-126`):

```ts
const WakeScheduled = z.object({
  scheduleId: z.string().min(1),
  coordinatorId: z.string().min(1).optional(),
  intervalMinutes: z.number().int().positive(),
  // Must be a PARSEABLE instant: the schedule decides dueness from Date.parse(anchorAt),
  // so an unparseable value would yield NaN ticks and a schedule that SILENTLY never fires.
  anchorAt: z.string().min(1).refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'anchorAt must be a parseable instant (ISO 8601)',
  }),
});
const WakeFired = z.object({
  scheduleId: z.string().min(1),
  tick: z.number().int().nonnegative(),
});
```

Export the payload types and the two typed constructors, mirroring `coordinatorRegistered` /
`coordinatorHeartbeat` (`src/events.ts:204-211`) and binding to the wake aggregate (R-scope
below):

```ts
export const wakeScheduled = (i: z.input<typeof WakeScheduled> & { ts: string }) =>
  envelope(EVENT.WAKE_SCHEDULED, 'WakeSchedule', wakeAggregateId(i.scheduleId), i.ts,
           WakeScheduled.parse(i), 'foundry:scheduler');
export const wakeFired = (i: z.input<typeof WakeFired> & { ts: string }) =>
  envelope(EVENT.WAKE_FIRED, 'WakeSchedule', wakeAggregateId(i.scheduleId), i.ts,
           WakeFired.parse(i), 'foundry:scheduler');
```

`intervalMinutes` is a POSITIVE int (Zod-validated on construct, so a zero/negative interval
fails loud at the producer, not silently divides-by-zero in `currentTick`). `tick` is a
NON-NEGATIVE int. `anchorAt` is the ISO instant the schedule's tick-0 boundary sits on, and it
is validated as a PARSEABLE instant (Zod `.refine(v => !Number.isNaN(Date.parse(v)))`): `dueWakes`
derives ticks from `Date.parse(anchorAt)`, so an unparseable anchor would yield `NaN` ticks and a
schedule that SILENTLY never fires. The `.refine` makes a bad anchor fail LOUD at the producer
(`scheduleWake` throws) rather than recording a dead never-firing schedule — proven by ACID 7.

**Scope (`src/scope.ts`):** add the wake aggregate id, mirroring `coordinatorAggregateId`
(`src/scope.ts:32-33`):

```ts
export const wakeAggregateId = (scheduleId: string): string => uuidv5(`wake:${scheduleId}`);
```

`aggregateType` is `'WakeSchedule'`; both events for a schedule share its aggregate id.

### R2 — fold (`src/state.ts`)

Add two derived-state slots and two fold cases. `WakeScheduled` is FIRST-WRITER-WINS (a
re-schedule of the same `scheduleId` is ignored — the schedule is IMMUTABLE once recorded),
exactly mirroring the gate-decision / coordinator-registration idempotency guard
(`src/state.ts:268-326`). `WakeFired` is MONOTONIC-MAX:

```ts
// DerivedState: add
wakeSchedules: Map<string, { intervalMinutes: number; anchorAt: string; coordinatorId?: string }>;
lastFiredTick: Map<string, number>;

// EVENT.WAKE_SCHEDULED — first-writer-wins (immutable once recorded)
case EVENT.WAKE_SCHEDULED: {
  const scheduleId = str(p['scheduleId']);
  if (!s.wakeSchedules.has(scheduleId)) {
    s.wakeSchedules.set(scheduleId, {
      intervalMinutes: p['intervalMinutes'] as number,
      anchorAt: str(p['anchorAt']),
      ...(p['coordinatorId'] != null ? { coordinatorId: str(p['coordinatorId']) } : {}),
    });
  }
  break;
}

// EVENT.WAKE_FIRED — monotonic max (never regresses)
case EVENT.WAKE_FIRED: {
  const scheduleId = str(p['scheduleId']);
  const tick = p['tick'] as number;
  s.lastFiredTick.set(scheduleId, Math.max(s.lastFiredTick.get(scheduleId) ?? -1, tick));
  break;
}
```

The `?? -1` floor means an as-yet-unfired schedule reports `lastFiredTick = -1`, so the very
first due tick (tick 1, see R3) compares `1 > -1` and fires. `Math.max` makes a replayed /
out-of-order `WakeFired` a no-op — the fold never advances backwards.

### R3 — the pure decision function (`src/plan/wake.ts`, new)

`currentTick` and `dueWakes` are PURE — no I/O, no `Date.now()`, the only time input is the
`nowMs` argument:

```ts
export function currentTick(intervalMinutes: number, anchorAt: string, nowMs: number): number {
  return Math.floor((nowMs - Date.parse(anchorAt)) / (intervalMinutes * 60_000));
}

export function dueWakes(state: DerivedState, nowMs: number): DueWake[] {
  const due: DueWake[] = [];
  for (const [scheduleId, sched] of state.wakeSchedules) {
    const k = currentTick(sched.intervalMinutes, sched.anchorAt, nowMs);
    const last = state.lastFiredTick.get(scheduleId) ?? -1;
    if (k >= 1 && k > last) due.push({ scheduleId, tick: k });
  }
  return due;
}
```

A schedule is DUE iff `k >= 1` AND `k > lastFiredTick`. `k >= 1` means tick 0 (the anchor
boundary itself) never fires — the first wake fires at the FIRST full interval after the
anchor, not at the anchor. `k > lastFiredTick` is the idempotency guard (R-idempotency below).

### R3a — the collapse semantic + rationale (the load-bearing decision in `dueWakes`)

`dueWakes` returns AT MOST ONE `(scheduleId, tick)` per schedule — `tick = currentTick`, the
CURRENT tick — NOT a per-tick catch-up list of every interval boundary missed since
`lastFiredTick`. **Missed ticks COLLAPSE to the current tick.** This is `O(1)` per schedule and
BOUNDED regardless of how long the actuator was silent.

The rationale is exact: a wake's only effect is to re-check `planFrontierAll` and signal a
session. `planFrontierAll(state, now)` depends ONLY on `(state, now)` — it is IDENTICAL whether
1 tick or 100 ticks were missed, because the missed ticks did not change the log between them
(the actuator was simply not calling). Firing once per missed tick would produce N identical
re-checks and N identical signals — pure redundant work, and an UNBOUNDED catch-up list if the
actuator was offline for a long stretch (a machine asleep over a weekend). Collapsing to the
single current tick is therefore both CORRECT (one re-check captures the full state-at-now) and
BOUNDED (one event, one signal, no backlog). `lastFiredTick` advances straight to `k`, so the
collapsed ticks are permanently consumed — they never re-fire.

This is the same "derive the answer, don't replay every step" discipline the kernel applies to
graphs (store generators, derive graphs — ADR-176): the per-tick list is a generator we never
materialize; the current-tick decision is the derived answer.

### R4 — ops (`src/ops.ts`)

Two new write ops, both under `withStoreLock(deps.dataDir, ...)`, both resolving `ts` via
`nowOf(deps)` — the established mutation pattern (`recordMerge`, `src/ops.ts:288-302`;
`coordinatorHeartbeat`, `src/ops.ts:360-373`):

```ts
export function scheduleWake(
  deps: FoundryDeps,
  input: { scheduleId: string; coordinatorId?: string; intervalMinutes: number; anchorAt?: string },
): { scheduleId: string; intervalMinutes: number; anchorAt: string; created: boolean } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const s = load(deps);
    const existing = s.wakeSchedules.get(input.scheduleId);
    if (existing) {
      // first-writer-wins: re-scheduling is a no-op; return the existing immutable schedule
      return { scheduleId: input.scheduleId, intervalMinutes: existing.intervalMinutes,
               anchorAt: existing.anchorAt, created: false };
    }
    const anchorAt = input.anchorAt ?? ts; // defaults to now
    append(ev.wakeScheduled({ scheduleId: input.scheduleId, coordinatorId: input.coordinatorId,
                              intervalMinutes: input.intervalMinutes, anchorAt, ts }), deps.logPath);
    return { scheduleId: input.scheduleId, intervalMinutes: input.intervalMinutes, anchorAt, created: true };
  });
}

export function wake(
  deps: FoundryDeps,
  input: { scheduleId?: string } = {},
): { fired: { scheduleId: string; tick: number }[]; frontier: NextItem[] } {
  return withStoreLock(deps.dataDir, () => {
    const ts = nowOf(deps);
    const nowMs = Date.parse(ts);
    const s = load(deps);
    const due = dueWakes(s, nowMs).filter((d) => input.scheduleId == null || d.scheduleId === input.scheduleId);
    for (const d of due) append(ev.wakeFired({ scheduleId: d.scheduleId, tick: d.tick, ts }), deps.logPath);
    // Project the frontier from the PRE-APPEND snapshot `s`. A WakeFired marker does NOT change
    // claimability (it only advances lastFiredTick), so re-loading after the append yields an
    // identical planFrontierAll — no post-append `load(deps)` reload is needed.
    const frontier = planFrontierAll(s, nowMs).map((i) => toNextItem(s, i));
    return { fired: due, frontier };
  });
}
```

`scheduleWake` registers an immutable schedule (`anchorAt` defaults to now; first-writer-wins
makes re-scheduling a no-op that returns the existing schedule). `wake` computes the due ticks
at `now` (optionally filtered to one schedule), appends a `WakeFired` for each (advancing
`lastFiredTick`), and returns the freshly-projected `planFrontierAll` frontier. The frontier
projection REUSES `nextItems`' `toNextItem` projection (`src/ops.ts:382`) but — and this is the
load-bearing distinction — it projects the **FULL** `planFrontierAll` set, NOT sliced to a limit.
`nextItems` defaults to `.slice(0, 5)` (the top-5 drain view); `wake` takes NO limit param and
returns the COMPLETE claimable set. The woken frontier therefore equals `nextItems(deps, 100)`
(any limit ≫ the frontier size), i.e. the whole `planFrontierAll` projection — the conductor
wants the full picture to decide capacity, not the truncated drain head (R-acid #5).

> **Projection note (pre-append snapshot).** `wake` projects from the snapshot `s` loaded
> BEFORE the `WakeFired` appends — not from a post-append reload. A `WakeFired` marker advances
> `lastFiredTick` only; it does not touch any item's claimability, so `planFrontierAll(s, nowMs)`
> and `planFrontierAll(load(deps), nowMs)` are identical. The pre-append projection is the
> shipped code; a future reader should NOT "fix" it to add an `after = load(deps)` reload.

### R5 — MCP tools + server (`src/mcp/tools.ts`, `src/mcp/server.ts`)

Two new WRITE tools following the existing write-tool pattern — `guard(...)` wrapper in
`tools.ts` (mirroring `foundry_record_merge`, `src/mcp/tools.ts:61`; `foundry_bootstrap`,
`src/mcp/tools.ts:79`) and a `registerTool` with a Zod `inputSchema` in `server.ts` (mirroring
`foundry_bootstrap`, `src/mcp/server.ts:28-33`):

```ts
// tools.ts
foundry_schedule_wake: guard((a: { scheduleId: string; coordinatorId?: string; intervalMinutes: number; anchorAt?: string }) =>
  ops.scheduleWake(deps, a)),
foundry_wake: guard((a: { scheduleId?: string }) => ops.wake(deps, a)),

// server.ts
server.registerTool('foundry_schedule_wake', {
  description: 'Register an immutable wake schedule (fires every intervalMinutes from anchorAt). ' +
    'First-writer-wins: re-scheduling an existing scheduleId is a no-op. The EXTERNAL actuator ' +
    '(cron / scheduled session / OS) owns the real clock; foundry only records the schedule.',
  inputSchema: {
    scheduleId: z.string().min(1), coordinatorId: z.string().min(1).optional(),
    intervalMinutes: z.number().int().positive(), anchorAt: z.string().min(1).optional(),
  },
}, async (a) => tools.foundry_schedule_wake(a));

server.registerTool('foundry_wake', {
  description: 'The actuation tool — the EXTERNAL actuator calls this PERIODICALLY. Fires the due ' +
    'tick for each schedule (missed ticks collapse to one), advancing lastFiredTick, and returns ' +
    'the current planFrontierAll frontier. Idempotent: a duplicate call at the same instant fires ' +
    'nothing. Optionally scoped to one scheduleId.',
  inputSchema: { scheduleId: z.string().min(1).optional() },
}, async (a) => tools.foundry_wake(a));
```

`foundry_wake` is the actuation surface — the cron entry / scheduled session calls it on its
own cadence.

---

## 4. ADR-176 analysis — NOT triggered

P6 is pack-level on every leg of the inclusion test
([ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) §2):

- **(a) Is this one of the four kernel concerns?** No. The four concerns are recurse the plan,
  flat the observation, inference, reproducibility (ADR-127; north-star §20 P3). A scheduled
  wake is none of them — it is a pack-level ACTUATION convenience. `WakeScheduled` /
  `WakeFired` are foundry pack events (`@de-braighter/substrate-contracts` carries no foundry
  events), OPAQUE to the kernel. `dueWakes` is a pure pack function. **Critically, the kernel
  gains NO timer / scheduler / cron concept — the real clock is external.** There is zero new
  kernel shape.
- **(b) Is it needed by ≥2 packs as shared infrastructure the kernel must validate / query /
  version?** No. The schedule events, the `dueWakes` decision, and the two ops/tools are
  pack-local; one pack (`domains/foundry`) consumes them. The kernel validates, queries, and
  versions none of them.

Both legs fail → pack territory.

**"Store generators, derive graphs" is UPHELD.** `WakeScheduled` and `WakeFired` are the stored
GENERATORS (the schedule + the fired-tick high-water marks); `dueWakes` is a DERIVED decision
computed over them at read time, never stored. The due-set is recomputed from
`(wakeSchedules, lastFiredTick, now)` on every `wake` call — there is no materialized
"pending wakes" table. This is the same derive-don't-store discipline ADR-242 applies to
substance and ADR-255 applies to the hierarchy.

ZERO changes to `@de-braighter/substrate-contracts` or `@de-braighter/substrate-runtime`.
Charter-checker is the governance gate.

---

## 5. Alternatives considered

### A. Internal timer (`setInterval` inside foundry) — REJECTED

Foundry runs its own `setInterval` / daemon loop that periodically re-checks `planFrontierAll`
and signals a session.

- **Pro:** fully self-contained; no external actuator to configure.
- **Con:** introduces a standing wall-clock dependency inside a pure, event-sourced,
  replayable pack — un-testable without fake timers, flaky, and stateful across the process
  lifetime. Worse, it pulls toward a SHARED timer/scheduler primitive the moment a second
  consumer wants the same thing — an [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)
  trip (a timer is not one of the four concerns; a kernel scheduler is speculative shared
  infrastructure). **Rejected: the exact risk this design exists to avoid.** Keeping the clock
  external keeps foundry deterministic and the kernel timer-free.

### B. Per-tick catch-up list — REJECTED

`dueWakes` returns EVERY missed tick boundary since `lastFiredTick` (ticks `last+1 .. k`), one
`WakeFired` per tick, so the history records each interval that elapsed.

- **Pro:** a complete per-interval audit of which boundaries were crossed.
- **Con:** UNBOUNDED — an actuator offline over a long stretch produces an arbitrarily long
  catch-up list, N identical re-checks, and N identical session signals (the re-check is
  `planFrontierAll(state, now)`, identical for every collapsed tick). Pure redundant work with
  no added information. **Rejected: collapsing to the current tick is correct AND bounded**
  (R3a). The audit value is illusory — the ticks carry no per-tick state.

### C. Cron-expression schedule (`anchorAt` + cron string instead of `intervalMinutes`) — DEFERRED

Express the schedule as a cron expression (e.g. `0 9 * * *`) rather than a fixed interval, for
calendar-aligned wakes (daily at 09:00, weekdays only, etc.).

- **Pro:** richer scheduling — calendar alignment, day-of-week filters, timezone semantics.
- **Con:** a cron parser + timezone handling is materially heavier than `floor((now - anchor) /
  interval)`, and the interval is the THINNEST shape that resolves ADR-247 open-Q2. The
  external actuator already owns the real clock, so calendar alignment can live in the
  ACTUATOR (cron the actuator at 09:00; foundry's interval is then just "has a day passed").
  **Deferred, demand-driven per ADR-176 §3:** promote to a cron shape only when a consumer
  needs calendar semantics foundry's interval cannot express. The `intervalMinutes` field is
  the falsifiable minimum.

---

## 6. Idempotency analysis — a missed-or-duplicate tick never double-acts

`lastFiredTick` is MONOTONIC (R2's `Math.max`). A `wake` at a given `now` computes
`k = currentTick(now)` and fires ONLY if `k > lastFiredTick`. The three cases:

- **DUPLICATE wake at the same `now`.** First call: `k > lastFiredTick` → fires `WakeFired(k)`,
  `lastFiredTick` advances to `k`. Second call at the same `now`: `k == lastFiredTick` →
  `k > last` is false → fires NOTHING. No double-act.
- **MISSED-ticks gap (clock skipped several intervals).** `k` jumps ahead of `lastFiredTick`
  by more than 1. `wake` fires EXACTLY ONE `WakeFired(tick = k)` (the collapse, R3a), advancing
  `lastFiredTick` straight to `k`. Never multiple — the intermediate ticks are consumed by the
  jump, not enumerated.
- **The frontier re-check itself is idempotent.** `planFrontierAll(state, now)` has NO side
  effect on claimability (`src/plan/plan-frontier-all.ts`); calling it inside `wake` does not
  mutate which items are claimable. So even the act of "firing" only appends a `WakeFired`
  marker + returns a frontier — it never changes the doing-side state. The wake is observation,
  not mutation of the plan.

The net guarantee: AT MOST ONE `WakeFired` per schedule per distinct current-tick, regardless
of how many times (or how late) the external actuator calls.

---

## 7. Acid battery — must BITE

All cases inject `FoundryDeps.now` (the determinism seam, `src/ops.ts:24, 28`); no real clock
is read. Anchor `T0`, interval 60 minutes throughout.

1. **Fires AT the scheduled time, not before.** `scheduleWake({ intervalMinutes: 60, anchorAt:
   T0 })`. `wake` at `T0 + 30min` → `currentTick = 0`, `0 >= 1` false → fires NOTHING (no
   `WakeFired`). `wake` at `T0 + 60min` → `currentTick = 1`, `1 >= 1 && 1 > -1` → fires exactly
   one `WakeFired(tick 1)`. Pins the `k >= 1` boundary: tick 0 (the anchor itself) never fires;
   the first full interval does.

2. **Idempotent — no double-act (must flip RED under mutation).** Two `wake` calls BOTH at
   `T0 + 60min` → exactly ONE `WakeFired(tick 1)` total (`lastFiredTick = 1` after the first;
   the second sees `k == last`). RED MUTATION: drop the `k > lastFiredTick` guard in `dueWakes`
   → the second wake double-fires `WakeFired(tick 1)` again → the count assertion goes RED.
   Proves the idempotency guard bites.

3. **Missed-tick collapse.** No `wake` until `T0 + 200min` (interval 60 → `currentTick = 3`,
   ticks 1 and 2 skipped). `wake` fires EXACTLY ONE `WakeFired(tick 3)` — NOT ticks 1 + 2 + 3 —
   and `lastFiredTick = 3`. A follow-up `wake` at `T0 + 200min` (or any time before
   `T0 + 240min`) fires NOTHING. Pins R3a: missed ticks collapse to the current tick, bounded.

4. **Negative control — not-yet-due schedule records no WakeFired.** A schedule whose first
   tick has not been reached (`wake` at `T0 + 10min`, `currentTick = 0`): `wake` RETURNS the
   `planFrontierAll` frontier (proving it always returns the frontier) but appends NO
   `WakeFired` event (the log has zero `foundry:WakeFired.v1` envelopes for that schedule).
   Proves `wake` does not hallucinate a tick before the schedule is due.

5. **Woken frontier is the FULL `planFrontierAll`, not the top-5 drain view.** For the same
   `now`, `wake(deps).frontier` deep-equals `nextItems(deps, 100)` — the FULL `planFrontierAll`
   projection through `toNextItem`, NOT the default `nextItems(deps)` which slices to the top 5.
   `wake` takes NO limit param: it returns the COMPLETE claimable set (the conductor wants the
   whole picture to decide capacity). Authored over a 7-item fixture (queued across two products)
   so the full-vs-truncated distinction BITES: `wake(...).frontier` `toEqual(nextItems(deps, 100))`,
   `toHaveLength(7)`, and `length > 5` — if `wake` ever sliced to the default limit of 5 the
   length assertions flip RED. This is the genuine bite (not `[] == []`): a 7-item frontier proves
   the wake re-checks the same `planFrontierAll` the conductor drains, untruncated and with no
   claimability side-effect.

6. **Builds green.** Full foundry test suite stays green; no existing conductor, projector,
   fold, or frontier behaviour changes (the two new events are additive; existing folds skip
   unknown event types).

---

## 8. Slice scope

- **foundry:** add the `WakeScheduled` / `WakeFired` EVENT keys, Zod payloads, payload types,
  and typed constructors (`src/events.ts`); add `wakeAggregateId` (`src/scope.ts`); add the
  `wakeSchedules` + `lastFiredTick` derived-state slots and the two fold cases — first-writer-
  wins for `WakeScheduled`, monotonic-max for `WakeFired` (`src/state.ts`); add the pure
  `currentTick` + `dueWakes` decision functions (`src/plan/wake.ts`, new); add the `scheduleWake` +
  `wake` write ops under `withStoreLock` (`src/ops.ts`); add the `foundry_schedule_wake` +
  `foundry_wake` MCP tools (`src/mcp/tools.ts`, `src/mcp/server.ts`). Add the acid battery
  (fires-at-time + idempotent-no-double-act + missed-tick-collapse + not-yet-due negative
  control + woken-frontier-is-FULL-planFrontierAll + anchorAt-parseable-or-throw + builds-green).
- **specs:** ADR-256 (proposed) — codifies the external-clock scheduled-wake mechanism + the
  collapse semantic + the ADR-176-non-trigger.

P6 stands on ADR-247 (the unified doing-side it re-checks) and ADR-254 (the conductor drives
FOUNDRY itself off the log, so a scheduled wake re-checks foundry's own frontier among the
rest). It depends on neither P1 nor P5 — the wake mechanism is orthogonal to the
yields/ancestry fields on `WorkItemQueued`.

---

## 9. What does NOT change

- No internal timer, no daemon, no `setInterval` / `setTimeout` — the real clock stays external
  (the crux, §2).
- `planFrontierAll` / `treeFromQueue` / `claimableItems` — unchanged. `wake` REUSES
  `planFrontierAll` + `toNextItem`; it does not re-implement the frontier.
- The conductor's session-pull model — unchanged. `wake` SIGNALS (returns a frontier); it does
  not auto-claim or auto-launch. A `WakeFired` is a marker that the frontier was re-checked at
  a tick, not a dispatch.
- No kernel contract; no new `aggregateType` beyond the pack-local `'WakeSchedule'`; no change
  to any existing event, fold case, or projector.

---

## 10. Deferred

- **Cron-expression schedules** (Alternative C) — calendar-aligned wakes. Deferred,
  demand-driven per ADR-176 §3; the external actuator can carry calendar alignment today.
- **Auto-dispatch on wake** — a `wake` that not only returns the frontier but auto-claims +
  auto-launches sessions. Out of scope: the wake signals; the conductor's existing dispatch
  flow consumes the signal. Conflating the two would couple the (pure, testable) scheduling
  decision to the (side-effecting) session launch.
- **Schedule retirement / mutation** — `WakeScheduled` is immutable first-writer-wins; there is
  no `WakeUnscheduled` / re-anchor event. If a schedule must change, a NEW `scheduleId` is
  registered. A retirement event is demand-driven; named so it is not forgotten.
- **Per-coordinator wake routing** — `coordinatorId?` is carried on the schedule (so a wake can
  be attributed to a coordinator) but P6 does not branch on it. Routing the woken frontier to a
  specific coordinator's session is a future arc.
