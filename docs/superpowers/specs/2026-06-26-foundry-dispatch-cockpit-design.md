# Foundry Dispatch Cockpit — Control + Observability Surface

**Date:** 2026-06-26
**Status:** design approved (brainstorming → this spec → implementation plan)
**Scope:** `domains/foundry` only. ZERO kernel change (no `@de-braighter/substrate-*` touch, no new event type).
**Relates to:** ADR-278 (headless dispatch bridge, ratified) §D3 · arc `headless-dispatch-bridge-arc`

## 1. Problem

ADR-278 shipped `foundry-dispatchd` — a daemon the studio cockpit starts/stops to spawn
headless `claude -p` workers over the claimable frontier. The backend is done and
live-proven on Windows (foundry#57 + the #60 spawn fix, both merged on `main`). The
**user-facing cockpit panel**, however, is minimal: a status dot (running=green /
crashed=red / else gray), `cap`, `pid`, and one Start/Stop button. The founder cannot
*watch* a drain — see the heartbeat tick, see which items workers are on, read the
daemon's log — without reloading, and the surface offers no control over the daemon's
config at start.

This spec turns that panel into a real **control + observability** surface. It does the
four things below and **nothing else** — the UI only starts/stops/observes; it NEVER
claims, merges, or decides a gate (governance stays with the founder gate + the daemon).

1. **Live status** — auto-poll the daemon so the founder watches `running → heartbeat
   ticking → drains → stopped` without reloading. Surface heartbeat freshness
   (`staleSeconds` — the crashed signal), uptime (`startedAt`), pid, and full config.
2. **In-flight visibility** — show how many workers are in flight and what each is on.
3. **Start-with-options** — a form to set the full dispatch config before Start, defaulting
   to the safe unattended permission mode.
4. **Log tail** — surface recent `data/dispatchd.log` lines for eyes on a drain.

## 2. Constraints (load-bearing — every decision below respects these)

- **Renderer is PURE; all I/O lives in `server.ts`.** `render.ts` receives data via `opts`
  and returns a string; reading the control file, folding the event log, and tailing the
  daemon log all happen in `server.ts`.
- **Byte-stable static path.** The dispatch UI is interactive-only, gated on
  `opts.interactive && opts.dispatch != null`. The static `npm run dashboard` output must
  contain **no dispatch artifact** — HTML, JS, *or* CSS. Enforced by
  `dispatch-cockpit.acid.test.ts` (static path contains no `id="dispatch-panel"`) and the
  determinism test `dashboard.acid.test.ts` (g1) (same inputs → byte-identical output).
- **Localhost-only write/read surface.** The server binds `127.0.0.1`. Mutating endpoints
  mirror the reprioritize/authorize/conduct endpoints VERBATIM (POST-only, `MAX_BODY` →
  413, founder-click-as-authorization). The new status endpoint is GET + read-only.
- **Three-actor decoupling via a file, no IPC.** Cockpit WRITES start/stop; the detached
  daemon READS the kill switch + WRITES heartbeats; status READS liveness. "Live" UI is
  just polling a file-derived view. There is no push channel and none is added.

## 3. Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|---|---|
| D1 | Scope | **All four directions** (live status + in-flight + start-form + log tail). |
| D2 | Live-update mechanism | **Read-only `GET /api/dispatch/status` + client poll that patches only the panel DOM.** Not full-page reload; not a `status` action on the POST endpoint. |
| D3 | In-flight source of truth | **The daemon publishes its own in-flight set** into `dispatchd.json` on each heartbeat (not inferred from event-log claims). The cockpit enriches ids → titles via the folded state. |
| D4 | `permissionMode` footgun | **Flip the shared default**: `DEFAULT_DISPATCH_CONFIG.permissionMode` `'acceptEdits'` → `'bypassPermissions'`. Fixes every start path (cockpit, MCP, any omit-config caller) at the source. |
| D5 | Start-form fields | **All eight knobs**: `cap`, `models.{cheap,capable}`, `permissionMode` up front; `pollIntervalMs`, `backoffBaseMs`, `backoffMaxMs`, `maxAttemptsPerItem`, `workerTimeoutMs` under an "advanced" toggle. |
| D6 | Layout (running state) | **Two-column**: status/config/controls left; live in-flight list + log tail right (reuses the dashboard's `.attn` two-column idiom). |
| D7 | CSS strategy | **Gated `<style>` block** (`dispatchStyles`, `''` on the static path) — not inline `style=` attributes, not the global `<style>`. |
| D8 | Start/Stop after-action | **Drop `location.reload()`**; on success trigger an immediate poll (flicker-free). |

## 4. Architecture

### 4.1 Components touched

| File | Change |
|---|---|
| `src/dispatch/control.ts` | `DispatchControlState` + `DispatchStatusView` gain `inFlight?: string[]`; `DispatchStatusView` gains `uptimeSeconds?: number`. `makeHeartbeat` accepts the in-flight ids and writes them. New `dispatchLogPath(dataDir)` helper; new pure `tailLines(text, n)`; new `readDispatchLogTail(dataDir, n)`. |
| `src/dispatch/loop.ts` | `DispatchLoopIO.recordHeartbeat` → `(inFlight: readonly string[]) => void`; the call site passes `[...inFlight]`. **Flip `DEFAULT_DISPATCH_CONFIG.permissionMode` → `'bypassPermissions'`.** |
| `src/dispatch/spawn.ts` | `spawnDispatchDaemon` uses `dispatchLogPath(...)` so the log writer and the tail reader can never drift apart. |
| `src/dispatch/cli.ts` | Wire the in-flight arg through the `makeHeartbeat` boundary. |
| `src/dashboard/server.ts` | New `GET /api/dispatch/status` (read-only, localhost). |
| `src/dashboard/render.ts` | Rebuild `dispatchSection()` (two-column running view + stopped-state form); extend `dispatchScript` (poll + DOM-patch + form submit + formatting helpers); add the gated `dispatchStyles` block. |

### 4.2 Data flow (the poll)

```
browser poll (~3s) ──GET /api/dispatch/status──> server.ts
    ├─ dispatchStatus(deps, now)            control file → status/healthy/uptime/staleSeconds/config/inFlight ids
    ├─ fold(readEnvelopes(logPath))         enrich each inFlight id → { title, riskTier, productKey }
    └─ readDispatchLogTail(deps.dataDir, N) last N lines of dispatchd.log
  <── compact JSON ──
client patches ONLY #dispatch-panel DOM (no reload, no re-render, scroll preserved)
```

The fold is server-side and cheap; the win over full-page reload is the tiny JSON payload
plus no client reflow/flicker/scroll-reset. The status endpoint is **read-only** — it never
appends to the event log (asserted by test, mirroring the existing read-only ACID checks).

### 4.3 `GET /api/dispatch/status` response contract

```jsonc
{
  "status": "running",          // running | stopped | crashed | never-started
  "healthy": true,
  "pid": 41208,                 // optional
  "uptimeSeconds": 840,         // optional; now - startedAt, server-computed
  "staleSeconds": 3,            // optional; heartbeat age, server-computed
  "config": {                   // optional; the full DispatchConfig
    "cap": 2,
    "models": { "cheap": "sonnet", "capable": "opus" },
    "pollIntervalMs": 5000, "backoffBaseMs": 30000, "backoffMaxMs": 900000,
    "maxAttemptsPerItem": 3, "permissionMode": "bypassPermissions", "workerTimeoutMs": 14400000
  },
  "inFlight": [                 // enriched from the folded event log; [] when none / unknown
    { "itemId": "exercir-321", "title": "Add drill filters", "riskTier": "T1", "productKey": "exercir" }
  ],
  "logTail": [                  // last N (~40) lines of dispatchd.log, each truncated; [] when no log
    "12:03:11 spawned exercir-321",
    "12:03:09 429 — backoff (attempt 0)"
  ]
}
```

`uptimeSeconds` and `inFlight` are **optional additive** fields on `DispatchStatusView`, so
the MCP `foundry_dispatch` `status` action (which returns `dispatchStatus(...)`) gains the
richer view with no breaking change. `logTail` is endpoint-only (assembled in `server.ts`),
not part of `DispatchStatusView`.

### 4.4 In-flight mechanism (daemon → control file → cockpit)

The drain loop's `inFlight: Set<string>` is in-memory only. We publish it the honest way:

- `loop.ts` calls `io.recordHeartbeat([...inFlight])` at the top of each iteration (the set
  there reflects currently-running workers).
- `makeHeartbeat(dataDir, now)` writes `{ ...control, heartbeatAt: now(), inFlight }` into
  `dispatchd.json`.
- The cockpit reads `inFlight` ids and joins each against the folded `state.items` for
  `{ title, riskTier, productKey }`. Ids absent from state (just-claimed / terminal) render
  id-only.

**Why the daemon's own set, not event-log claims:** an inferred "active claims" view cannot
distinguish a daemon-spawned worker's claim from a manual one. Publishing the daemon's set
makes "in flight (2)" mean exactly "this daemon has 2 workers running."

**Staleness honesty:** the in-flight list is live only while `status === 'running'`. For
`crashed`/`stopped` the list is frozen at the last heartbeat, so the UI greys it with an
"as of last heartbeat" note rather than implying it is current.

### 4.5 Panel layout

**Running state** (the watch state) — two columns:

```
headless dispatch · foundry-dispatchd
┌─────────────────────┬───────────────────────┐
│ ● running           │ in flight (2)          │
│ up 14m · ♥ 3s ago   │  • exercir-321   T1    │
│ pid 41208           │    Add drill filters   │
│ cap 2 · sonnet/opus │  • gd../debt-a11y T0   │
│ bypassPermissions   │                        │
│ [ Stop daemon ]     │ recent log             │
│                     │  12:03:11 spawned …    │
│                     │  12:03:09 429 backoff  │
└─────────────────────┴───────────────────────┘
```

**Stopped / never-started / crashed state** — the status line + a `[ Start daemon ▸ ]`
button that reveals the form:

```
cap [ 2 ]   cheap model [ sonnet ]   capable model [ opus ]
permission mode [ bypassPermissions ▾ ]   (acceptEdits | default | plan)
▸ advanced  →  pollIntervalMs · backoffBaseMs · backoffMaxMs · maxAttemptsPerItem · workerTimeoutMs
[ Start daemon ]
```

Submit gathers non-empty fields into a `config` object (omitted → defaults), POSTs
`{ action: 'start', config }`. `DispatchConfigInputSchema.safeParse` already validates
server-side (→ 400 on bad input); the client does light numeric coercion. `permissionMode`
defaults to `bypassPermissions` with `acceptEdits` selectable, so the governance choice is
**visible at start**.

### 4.6 Byte-stability gating

Three gated consts, all `''` on the static path (mirroring today's `dispatchScript`):

- `dispatchSection()` — already gated; stays gated.
- `dispatchScript` — extended; still gated.
- `dispatchStyles` — NEW gated `<style>` block for `.dispbtn` / `.dispstat` / in-flight /
  log / form classes (which are **currently unstyled**). Gating the CSS keeps the static
  output free of every dispatch artifact.

## 5. Error handling & edge cases

- **Poll fetch fails** (server gone): keep the last rendered state, show a subtle
  "reconnecting…" hint, never `alert()` (it blocks the page). The poll keeps ticking.
- **Torn control-file read**: `readControl` already returns `null` → `dispatchStatus`
  returns `never-started` → the panel shows Start.
- **Missing `dispatchd.log`**: `readDispatchLogTail` returns `[]` → "no log yet."
- **Stop honesty preserved**: the Stop confirm still says "in-flight workers finish on
  their own"; after Stop the in-flight list greys (frozen), it does not vanish.
- **Log-tail bound**: tail the last N (≈40) lines, each truncated, to bound the JSON payload
  and avoid unbounded reads of a long-running daemon's log.

## 6. Testing plan (TDD)

1. **`tailLines(text, n)` pure unit** — empty, fewer-than-n, exactly-n, trailing newline,
   per-line truncation.
2. **`control.ts`** — heartbeat round-trips `inFlight`; `dispatchStatus` surfaces
   `uptimeSeconds` + `inFlight`; a stale heartbeat still classifies `crashed` while
   carrying the (now-frozen) inFlight.
3. **`loop.ts`** — `recordHeartbeat` receives the current in-flight ids (spy); the default
   `permissionMode` is `bypassPermissions`.
4. **`server.ts`** — `GET /api/dispatch/status` returns the enriched JSON; **read-only**
   (event log byte-identical before/after — mirrors the existing read-only ACID assertion).
5. **`render.ts`** — running state renders two columns + in-flight rows + log lines; stopped
   state renders the form with `bypassPermissions` selected; **static path byte-clean** (no
   `id="dispatch-panel"`, no `__dispatchPoll`, no dispatch `<style>` marker).
6. **Regression sweep** — grep `acceptEdits` across `src/` + `test/`; update every assertion
   that pinned the old default.

## 7. Dogfood delivery (build this *with* the daemon)

The intent is for `foundry-dispatchd` to build its own cockpit — the cleanest proof the
dispatch bridge is real. Shape:

- **One T2 work item, cap = 1.** This is one cohesive, interdependent feature
  (`control`/`server`/`render` + their tests interleave), so it is *not* a parallel
  fan-out; a single worker builds it end-to-end. The daemon path (poll → spawn → build → PR
  → gate-halt) is still fully exercised.
- **Plan delivery: embed the implementation plan in the work-item prompt.** The foundry repo
  has no `docs/` convention and a worker checks out `main` (it cannot see an unmerged
  branch), so the plan travels *with the item* rather than as a file the worker must fetch.
- **Governance unchanged.** The worker runs its tier-gated verifier wave and opens a PR that
  HALTS at the founder ship gate. The founder decides the gate.
- **The recursion to watch for:** observe the daemon building the *new* cockpit through the
  *old* one (`npm run dashboard:serve` on today's minimal panel). After merge, the cockpit
  can watch itself.

## 8. Out of scope (YAGNI)

- No push channel / WebSocket — polling a file-derived view is sufficient and matches the
  three-actor decoupling.
- No persistence of in-flight history — the control file holds only the *current* set.
- No new event type, no kernel touch.
- No per-worker log streaming — the daemon's aggregate `dispatchd.log` tail is enough for
  "eyes on a drain."
- No parallel decomposition of *this* feature into multiple queue items (it is one
  interdependent unit).

## 9. Open follow-ups (non-blocking)

- Orphaned worktrees under `domains/foundry/.claude/worktrees/` (`adr-278-dispatch-bridge`,
  `d5-*`) from the bridge build — clean per `worktree-orphan-cleanup-mechanics` when
  convenient (disk + nx EBUSY risk), not part of this change.
