# Foundry Native Dispatch Progress Signal — Design

**Date:** 2026-06-26
**Status:** design approved (brainstorming → this spec → implementation plan)
**Scope:** `domains/foundry` only. ZERO kernel change (no `@de-braighter/substrate-*`, no new event type).
**Relates to:** ADR-278 (headless dispatch bridge) · the cockpit observability surface (foundry#61, merged `06a3cce`) · arc `headless-dispatch-bridge-arc`

## 1. Problem

While the daemon built `dispatch-cockpit-1`, the founder watched its progress through a
*hand-rolled* cron + bash watcher: polling the claim's worktree git log, the
`ClaimHeartbeat`/`GateRequested` events, the daemon heartbeat, and `dispatchd.log`, reporting
on a cadence. The founder flagged this should be a **native foundry capability**, not
re-scripted each session.

Every input is already a durable artifact foundry owns, so the progress signal is a **pure
derived query** — no new event type, no stored state (the "store generators, derive graphs"
kernel discipline). This is the natural next layer of the cockpit: today's panel shows *what*
is in flight; this adds *how far along* each one is.

## 2. Constraints

- **Derived, not stored.** Progress is computed on read from the event log + the claim's
  worktree git state + the plan file. Nothing is persisted; no new event type.
- **Best-effort, never throws.** Observability must never break a `foundry_status` render or a
  dashboard poll. Every missing input degrades gracefully (see §5).
- **Read-only.** The query reads; it never appends to the event log or mutates a claim.
- **Testable I/O.** The git/fs reads are injected (like `spawn.ts`'s `run`) so the query is
  unit-testable without a real repo or worktree.
- **Pure renderer / localhost-only** (inherited from the cockpit): the cockpit enrichment
  happens in `server.ts`; `render.ts` stays pure; the `GET /api/dispatch/status` surface stays
  localhost-only and read-only.

## 3. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Surface breadth | **Pull**: the derived query, surfaced on `foundry_status` + the cockpit in-flight row + a `foundry_dispatch progress` MCP action. No native scheduler (the cockpit poll + any caller covers "periodic"). |
| D2 | Task `N/M` denominator | **Parse the plan file** referenced by the item — count `### Task N:` headings = `M`. |
| D3 | How the query finds the plan | **New optional `planRef` field on the WorkItem** (rides `WorkItemQueued.v1` like `generationKind`). Degrades to "N commits" when absent/unreadable. |
| D4 | Build shape | **One cohesive item** (one query, surfaced three ways). The cockpit dependency is satisfied (merged on `main`), so no sequencing split is needed. |

## 4. Architecture

### 4.1 The derived query

`deriveDispatchProgress(deps): DispatchProgressRow[]` in a new `src/dispatch/progress.ts`.
One row per **active claim** (claimed, not terminal), derived per claim:

```ts
interface DispatchProgressRow {
  itemId: string;
  claimId: string;
  productKey: string;
  commitsSinceClaim?: number;   // git rev-list --count $(merge-base main HEAD)..HEAD in the claim's worktree
  lastCommitSubject?: string;   // git log -1 --format=%s
  lastCommitAt?: string;        // git log -1 --format=%cI
  tasksTotal?: number;          // M — count of /^### Task \d+/ headings in the planRef file
  taskN?: number;               // min(commitsSinceClaim, tasksTotal)
  heartbeatAgeSeconds?: number; // now − latest ClaimHeartbeat for the claim
}
```

Inputs, all foundry-owned:
- **Active claims + worktree path** — from the folded state (the `ClaimAcquired` payload carries `worktree`).
- **Liveness** — the latest `ClaimHeartbeat` for the claim.
- **Git fields** — shelled in the claim's worktree (injected `run(cmd, cwd)` for tests).
- **`M`** — read the file at the item's `planRef`, count `^### Task \d+` headings.

The query operates per **active claim** so it serves both consumers uniformly:
`foundry_status` enriches its ACTIVE CLAIMS; the cockpit joins by `itemId` onto its
(daemon-published) in-flight rows.

### 4.2 The `planRef` field

Optional `planRef?: string` added to `ItemInput` (`ops.ts`) and the `WorkItemQueued.v1`
payload (`events.ts`) — the same additive, opaque pattern as `generationKind`. The producer
(build-path, or a manual `foundry_queue_push`) sets it to the plan's path. The query reads it;
no other code depends on it.

### 4.3 Surfaces

| Surface | Change |
|---|---|
| `foundry_status` (`src/status.ts`) | a **DISPATCH PROGRESS** block under ACTIVE CLAIMS: `itemId · task N/M · <last commit subject> · ♥ <age>s` per active claim. |
| `foundry_dispatch progress` (`src/mcp/tools.ts` + `server.ts`) | a 4th action (`start\|stop\|status` → `+progress`) returning `DispatchProgressRow[]`. The scripting/headless surface — the native replacement for the cron+bash. |
| Cockpit in-flight row (`src/dashboard/server.ts` + `render.ts`) | `GET /api/dispatch/status` enriches each in-flight item with its `DispatchProgressRow`; the in-flight `<li>` renders `task 3/7 · feat(…): … · ♥ 12s`. Server `dispatchPanelBody` + client `__dispatchRenderPanel` both render it (kept structurally identical, per the cockpit's gating discipline). |

### 4.4 Files

| File | Change |
|---|---|
| `src/dispatch/progress.ts` | new — `deriveDispatchProgress` + the pure helpers (`countPlanTasks`, `parseGitLog`) |
| `src/events.ts` | `planRef` on `WorkItemQueued.v1` payload |
| `src/ops.ts` | `planRef` on `ItemInput` (rides `...it` into the event) |
| `src/status.ts` | render the DISPATCH PROGRESS block |
| `src/mcp/tools.ts` + `src/mcp/server.ts` | the `progress` action |
| `src/dashboard/server.ts` | enrich `GET /api/dispatch/status` in-flight rows via `deriveDispatchProgress` |
| `src/dashboard/render.ts` | render the per-row progress (server body + client mirror) |

## 5. Error handling (graceful degradation)

- **No `planRef` / unreadable / unparseable plan** → omit `tasksTotal` + `taskN`; keep
  `commitsSinceClaim` ("3 commits" instead of "3/7").
- **Missing worktree / git error** → omit the git fields; the row still carries `itemId` +
  `heartbeatAgeSeconds` (the claim is alive even if the worktree is gone).
- **No `ClaimHeartbeat` yet** → omit `heartbeatAgeSeconds`.
- **The query never throws** — any per-claim derivation error degrades that row to its
  available fields; one bad worktree can't break the whole readout or the dashboard render.
- **Terminal items** (a `GateRequested`/`ClaimReleased` present) are **excluded** — progress
  is for *active* work.

## 6. Testing (TDD)

1. **`countPlanTasks(text)` pure** — counts `^### Task \d+` headings; 0 for a plan with none; ignores `### Task` in prose without a number.
2. **`parseGitLog` / `commitsSinceClaim`** — via **injected** `run` returning canned git output; correct count + last subject/date; degradation when `run` throws.
3. **`deriveDispatchProgress`** — one row per active claim; `taskN = min(commits, M)`; terminal claims excluded; missing `planRef` → no `taskN/M`; missing worktree → no git fields; never throws.
4. **`foundry_status`** — renders the DISPATCH PROGRESS block for active claims; absent when none.
5. **`foundry_dispatch progress`** — returns `DispatchProgressRow[]`; **read-only** (event log byte-identical before/after).
6. **cockpit** — the in-flight `<li>` renders `N/M` + last subject + heartbeat age (server body + client mirror); static path stays byte-clean (no new ungated artifact).

## 7. Dogfood note

Queue-ready as **one T2 item, cap=1**, `planRef` pointing at this feature's plan. The
cockpit dependency is already merged on `main`, so the worker branches off a `main` that has
the cockpit — no sequencing trap.

**Caveat — the gate-halt footgun bites again.** Until the foundry-worker T2-halt releases
`built` instead of `blocked` (and/or the dispatch loop skips gate-pending items), a clean
dogfood needs the same recovery as #61 (recovery-claim → release `built` → `record_merge`),
*and* the daemon must be stopped promptly after the worker claims to avoid re-dispatch. The
clean path is to **land the gate-halt fix first** (a small foundry item) so this feature's
dogfood closes itself.

## 8. Out of scope (YAGNI)

- No native scheduled/push report — the cockpit poll + the MCP action cover "periodic"; a
  scheduler is a consumer, not part of this primitive.
- No persisted progress history — the query is read-time only.
- No cross-claim aggregation / ETA prediction — `commits-since-claim` + `task N/M` is enough
  for "how far along."
- No new event type, no kernel touch.

## 9. Open follow-ups (non-blocking)

- **The gate-halt fix** (release `built` not `blocked`; daemon skips gate-pending items) — a
  separate small foundry item that this feature's clean dogfood depends on (§7).
