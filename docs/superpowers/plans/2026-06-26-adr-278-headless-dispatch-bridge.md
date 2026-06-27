# ADR-278 Headless Dispatch Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless dispatch bridge (ADR-278 rung 1): the studio cockpit spawns an autonomous `foundry-dispatchd` daemon that launches headless `claude -p` workers over the claimable frontier, each self-claiming (claim = dedup), governed by a concurrency cap + 429 backoff + cockpit kill switch + crash-recovery — kernel grows by ZERO.

**Architecture:** Two halves mirror the existing `dispatch-review` precedent: (1) a **thin, side-effect-free `dispatch-worker` declared-actuator** in `ACTION_REGISTRY` (the in-log INTENT — no store op, replay-safe); (2) an **external headless RUNNER** — a `foundry-dispatchd` daemon whose pure loop is injected with every I/O boundary (`spawnWorker`, `shouldStop`, `recordHeartbeat`, `backoff`, `sleep`) so the whole drain/backoff/crash-recovery logic is unit-testable with mocks, and only the thin real `claude -p` spawn is trusted I/O. A `foundry_dispatch` MCP tool (start | stop | status) + a cockpit control panel drive the daemon; the kill switch + status live in a control file (`data/dispatchd.json`) the loop polls. The daemon drives off the existing `foundry_next` frontier and reuses `renderSessionPrompt`; it claims nothing and merges nothing.

**Tech Stack:** TypeScript ESM (explicit `.js` import extensions), Node `child_process`, vitest 2.x, zod, `@modelcontextprotocol/sdk`. All work in `domains/foundry`.

## Global Constraints

- **Repo:** `domains/foundry` only. Worktree: `domains/foundry/.claude/worktrees/adr-278-dispatch-bridge` on branch `feat/adr-278-headless-dispatch-bridge` (off `origin/main` @ `f83bc46`). `node_modules` resolves by walk-up to the parent clone — no install.
- **ADR-176 — kernel grows by ZERO.** Nothing reaches `@de-braighter/substrate-*`. No new event type (the atomic claim is the durable record). Everything is pack/tooling territory.
- **`dispatch-worker` stays side-effect-free** — it returns a descriptor and calls NO store-locked op (replay-safe; a fold never re-spawns). Exact mirror of `dispatchReviewAction`.
- **Claim is the dedup.** The daemon claims nothing; the spawned worker's `foundry_claim` is the single source of "is this item being worked." The daemon merges nothing (structurally — `DispatchLoopIO` has no merge boundary).
- **Gates stay human.** The daemon dispatches all tiers (T0/T1/T2); T2 builds then HALTS at the founder ship gate (worker behaviour via `renderSessionPrompt` → the `foundry-worker` skill). The daemon never decides a gate or merges T2.
- **D-1 mechanism = `claude -p` + inherited `CLAUDE_CODE_OAUTH_TOKEN`. NEVER the Agent SDK.** Spawn cwd = cluster root (so `.mcp.json` loads the foundry MCP); inherit `process.env` (SSH → git push, `gh` → PR/merge, OAuth token → model). Never `--bare`.
- **ESM:** every relative import ends in `.js`. Port boundaries return values or throw; MCP tool handlers never throw at transport level (the `guard()` wrapper converts to `isError`).
- **TDD:** write the failing test, watch it fail, implement minimal, watch it pass, commit. Run tests TARGETED (`npx vitest run <file>`) — the full collect is slow/flaky under load.
- **TS strictness:** `exactOptionalPropertyTypes`-style discipline already in this repo — spread optional fields conditionally (`...(x != null ? { x } : {})`), never assign `undefined` to an optional field.
- **Lint:** markdownlint MD004 — never start a wrapped line with `+ ` (reword).
- **Commit trailer** on every commit:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

**New files (all under `domains/foundry/`):**

- `src/dispatch/loop.ts` — the PURE daemon loop + planners (`planSpawnBatch`, `isDrained`, `modelForItem`, `backoffDelayMs`, `runDispatchLoop`) + the shared types (`DispatchConfig`, `SpawnResult`, `DispatchLoopIO`, `DispatchLoopResult`, `DEFAULT_DISPATCH_CONFIG`).
- `src/dispatch/control.ts` — the control-file state machine + kill-switch/heartbeat boundary factories (`readControl`, `writeControl`, `controlPath`, `startDispatch`, `stopDispatch`, `dispatchStatus`, `makeKillSwitch`, `makeHeartbeat`, types `DispatchControlState`, `DispatchStatusView`, `SpawnDaemon`).
- `src/dispatch/spawn.ts` — the REAL external mechanic: `buildClaudeArgs`, `classifyExit`, `resolveClusterRoot`, `spawnClaudeWorker` (the `claude -p` spawn), `spawnDispatchDaemon` (launch the detached `foundry-dispatchd`).
- `src/dispatch/cli.ts` — the `foundry-dispatchd` entrypoint: read config from the control file, wire the real spawn + `ops.nextItems` frontier reader + control-file kill switch/heartbeat → `runDispatchLoop`.
- `test/dispatch-loop.test.ts`, `test/dispatch-control.test.ts`, `test/dispatch-spawn.test.ts`, `test/dispatch-mcp.test.ts`, `test/dispatch-cockpit.acid.test.ts`.

**Modified files:**

- `src/workflow/actions.ts` — add `dispatchWorkerAction` + register `'dispatch-worker'`.
- `src/workflow/actions.spec.ts` — membership now 5 kinds + dispatch-worker behaviour test.
- `test/workflow-actions.acid.test.ts` — ACID 8 exact-membership now 5 kinds.
- `src/mcp/tools.ts` — `makeTools(deps, opts)` gains optional `spawnDaemon`; add `foundry_dispatch` handler.
- `src/mcp/server.ts` — register `foundry_dispatch` (typed args).
- `src/dashboard/server.ts` — `POST /api/dispatch` (start|stop) endpoint; pass dispatch status into the GET render.
- `src/dashboard/render.ts` — dispatch control panel (interactive-only; byte-stable static) + client script.
- `package.json` — add `"dispatchd": "tsx src/dispatch/cli.ts"`.

---

## Task 1: `dispatch-worker` declared-actuator + acid updates

**Files:**
- Modify: `src/workflow/actions.ts`
- Modify: `src/workflow/actions.spec.ts`
- Modify: `test/workflow-actions.acid.test.ts`

**Interfaces:**
- Consumes: `ActionHandler`, `ACTION_REGISTRY`, `actuate`, `FoundryDeps` (existing).
- Produces: a registry entry `'dispatch-worker' → dispatchWorkerAction` returning `{ kind: 'dispatch-worker', target: string, limit?: number, requestedAt: string }`. Now five sanctioned kinds: `['build-path', 'dispatch-review', 'dispatch-worker', 'reprioritize-product', 'request-gate']`.

- [ ] **Step 1: Write the failing behaviour test** in `src/workflow/actions.spec.ts`. Update the existing membership assertion to five kinds and add a `dispatch-worker` describe block (mirror the `dispatch-review` block). Replace the membership `it` body and append the new block:

```ts
  it('ACTION_REGISTRY membership is exactly the five sanctioned kinds', () => {
    expect([...ACTION_REGISTRY.keys()].sort()).toEqual(
      ['build-path', 'dispatch-review', 'dispatch-worker', 'reprioritize-product', 'request-gate'].sort(),
    );
  });
```

Then append, after the existing `dispatch-review` `it`s but inside the top `describe`:

```ts
  it('dispatch-worker returns a dispatch descriptor and writes no foundry state', () => {
    const deps = tempDeps();
    expect(readEnvelopes(deps.logPath)).toHaveLength(0); // empty before

    const out = actuate(deps, 'dispatch-worker', { target: 'frontier', limit: 3 }) as Record<string, unknown>;
    expect(out['kind']).toBe('dispatch-worker');
    expect(out['target']).toBe('frontier');
    expect(out['limit']).toBe(3);
    expect(out['requestedAt']).toBe('2026-06-24T10:00:00Z');

    // The bite: a regression that made dispatch-worker emit ANY event turns this RED.
    expect(readEnvelopes(deps.logPath)).toHaveLength(0); // still empty after
  });

  it('dispatch-worker omits limit when not given, and throws when target is not a string', () => {
    const deps = tempDeps();
    const out = actuate(deps, 'dispatch-worker', { target: 'oncology' }) as Record<string, unknown>;
    expect(out).toEqual({ kind: 'dispatch-worker', target: 'oncology', requestedAt: '2026-06-24T10:00:00Z' });
    expect('limit' in out).toBe(false);

    expect(() => actuate(deps, 'dispatch-worker', {})).toThrow(/target/);
    expect(() => actuate(deps, 'dispatch-worker', { target: 7 })).toThrow(/target/);
  });
```

- [ ] **Step 2: Run the test, watch it fail.** Run: `npx vitest run src/workflow/actions.spec.ts`. Expected: FAIL — membership mismatch + `unknown action: dispatch-worker`.

- [ ] **Step 3: Implement `dispatchWorkerAction`** in `src/workflow/actions.ts`. Insert after `dispatchReviewAction` (before `buildPathAction`):

```ts
/** The HEADLESS-DISPATCH actuator (ADR-278 D-1). THIN declared-actuator mirroring
 *  dispatchReviewAction: it records the INTENT to dispatch headless `claude -p` workers
 *  over a target (a productKey, an itemId, or the sentinel `frontier`) and returns a
 *  dispatch descriptor { kind, target, limit?, requestedAt }. It does NOT spawn workers
 *  (that is the EXTERNAL `foundry-dispatchd` runner, a sibling of `gh` / the merge hot-path)
 *  and — like dispatch-review — it calls NO store-locked op: dispatch produces NO foundry
 *  state (the spawned worker's atomic foundry_claim is the durable record, which is why no
 *  spawn event is needed — an event-sourced handler would RE-SPAWN on replay). This is the
 *  declaration ⊥ actuation invariant (ADR-263): side-effect-free → replay-safe. */
const dispatchWorkerAction: ActionHandler = (deps, args) => {
  const target = args['target'];
  if (typeof target !== 'string') {
    throw new Error('dispatch-worker requires args.target (string: a productKey, itemId, or "frontier")');
  }
  const requestedAt = (deps.now ?? (() => new Date().toISOString()))();
  const limit = args['limit'];
  return {
    kind: 'dispatch-worker' as const,
    target,
    ...(typeof limit === 'number' ? { limit } : {}),
    requestedAt,
  };
};
```

Then add it to the registry map (keep alphabetical-ish, after `dispatch-review`):

```ts
  ['dispatch-review', dispatchReviewAction],
  ['dispatch-worker', dispatchWorkerAction],
```

- [ ] **Step 4: Update ACID 8** in `test/workflow-actions.acid.test.ts`. Change the `listActions()` + keys assertions to five kinds:

```ts
    expect(listActions()).toEqual(['build-path', 'dispatch-review', 'dispatch-worker', 'reprioritize-product', 'request-gate']);
    expect([...ACTION_REGISTRY.keys()].sort()).toEqual(
      ['build-path', 'dispatch-review', 'dispatch-worker', 'reprioritize-product', 'request-gate'].sort(),
```

Also update the comment block above it to note `'dispatch-worker' joined in ADR-278 (the THIN headless-dispatch INTENT actuator — side-effect-free, mirrors dispatch-review)`.

- [ ] **Step 5: Run both test files, watch them pass.** Run: `npx vitest run src/workflow/actions.spec.ts test/workflow-actions.acid.test.ts`. Expected: PASS (all green).

- [ ] **Step 6: Typecheck + commit.** Run: `npx tsc -p tsconfig.json --noEmit` (expect clean). Then:

```bash
git add src/workflow/actions.ts src/workflow/actions.spec.ts test/workflow-actions.acid.test.ts
git commit -m "feat(dispatch): dispatch-worker declared-actuator (ADR-278 D-1)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: The pure dispatch loop

**Files:**
- Create: `src/dispatch/loop.ts`
- Test: `test/dispatch-loop.test.ts`

**Interfaces:**
- Consumes: `NextItem` (from `../ops.js`), `RiskTier` (from `../events.js`).
- Produces (all imported by Tasks 3–6):
  - `interface DispatchConfig { cap: number; models: { cheap: string; capable: string }; pollIntervalMs: number; backoffBaseMs: number; backoffMaxMs: number; maxAttemptsPerItem: number; permissionMode: string }`
  - `const DEFAULT_DISPATCH_CONFIG: DispatchConfig`
  - `type SpawnOutcomeKind = 'spawned' | 'rate-limited' | 'error'`
  - `interface SpawnResult { outcome: SpawnOutcomeKind; detail?: string; whenDone: Promise<void> }`
  - `interface DispatchLoopIO { readFrontier; spawnWorker; shouldStop; recordHeartbeat; backoff; sleep; config; log? }`
  - `interface DispatchLoopResult { stopped: boolean; drained: boolean; spawned: number; rateLimitHits: number; errors: number }`
  - `function planSpawnBatch(frontier, inFlight, cap, givenUp?): NextItem[]`
  - `function isDrained(frontier, inFlight, givenUp): boolean`
  - `function modelForItem(item: { riskTier; productKey }, models): string`
  - `function backoffDelayMs(attempt, base, max): number`
  - `async function runDispatchLoop(io: DispatchLoopIO): Promise<DispatchLoopResult>`

- [ ] **Step 1: Write the failing test for the pure planners** in `test/dispatch-loop.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import {
  planSpawnBatch, isDrained, modelForItem, backoffDelayMs,
  runDispatchLoop, DEFAULT_DISPATCH_CONFIG,
  type DispatchConfig, type DispatchLoopIO, type SpawnResult,
} from '../src/dispatch/loop.js';
import type { NextItem } from '../src/ops.js';

function item(itemId: string, over: Partial<NextItem> = {}): NextItem {
  return {
    itemId, title: itemId, scope: { repo: 'r/foundry' }, qualityObligations: [],
    productKey: 'foundry', priority: 1, riskTier: 'T0', repo: 'r/foundry', ...over,
  };
}

describe('planSpawnBatch — cap + in-flight + given-up filtering', () => {
  it('fills up to cap minus in-flight, skipping in-flight + given-up', () => {
    const frontier = [item('a'), item('b'), item('c'), item('d')];
    expect(planSpawnBatch(frontier, new Set(), 2).map((i) => i.itemId)).toEqual(['a', 'b']);
    expect(planSpawnBatch(frontier, new Set(['a']), 2).map((i) => i.itemId)).toEqual(['b', 'c']);
    expect(planSpawnBatch(frontier, new Set(['a', 'b']), 2)).toEqual([]); // cap full
    expect(planSpawnBatch(frontier, new Set(), 3, new Set(['b'])).map((i) => i.itemId)).toEqual(['a', 'c', 'd']);
  });
});

describe('isDrained', () => {
  it('drained only when nothing in-flight AND no dispatchable frontier item remains', () => {
    expect(isDrained([], new Set(), new Set())).toBe(true);
    expect(isDrained([item('a')], new Set(), new Set())).toBe(false);
    expect(isDrained([item('a')], new Set(['a']), new Set())).toBe(false); // a is in-flight
    expect(isDrained([item('a')], new Set(), new Set(['a']))).toBe(true);  // a given up
    expect(isDrained([], new Set(['x']), new Set())).toBe(false);          // x in-flight
  });
});

describe('modelForItem — tiered (D-5)', () => {
  const models = { cheap: 'sonnet', capable: 'opus' };
  it('green-desk or T0 → cheap; T1/T2 → capable', () => {
    expect(modelForItem({ riskTier: 'T0', productKey: 'foundry' }, models)).toBe('sonnet');
    expect(modelForItem({ riskTier: 'T0', productKey: 'green-desk-foundry' }, models)).toBe('sonnet');
    expect(modelForItem({ riskTier: 'T1', productKey: 'gridiron' }, models)).toBe('opus');
    expect(modelForItem({ riskTier: 'T2', productKey: 'oncology' }, models)).toBe('opus');
    // a green-desk product is cheap even if mis-tiered T2 (debt is always cheap)
    expect(modelForItem({ riskTier: 'T2', productKey: 'green-desk-exercir' }, models)).toBe('sonnet');
  });
});

describe('backoffDelayMs — exponential, capped', () => {
  it('doubles per attempt up to the ceiling', () => {
    expect(backoffDelayMs(0, 30000, 900000)).toBe(30000);
    expect(backoffDelayMs(1, 30000, 900000)).toBe(60000);
    expect(backoffDelayMs(2, 30000, 900000)).toBe(120000);
    expect(backoffDelayMs(99, 30000, 900000)).toBe(900000); // capped
  });
});
```

- [ ] **Step 2: Run it, watch it fail.** Run: `npx vitest run test/dispatch-loop.test.ts`. Expected: FAIL — cannot resolve `../src/dispatch/loop.js`.

- [ ] **Step 3: Create `src/dispatch/loop.ts`** with the types + pure helpers:

```ts
// The PURE headless-dispatch loop (ADR-278 §D3, the runner's brain). Every I/O boundary
// is INJECTED (DispatchLoopIO) so the whole drain / backoff / crash-recovery logic is
// unit-testable with mocks — the real `claude -p` spawn lives only behind io.spawnWorker
// (src/dispatch/spawn.ts). Modeled on wt-pool.ts (pure core + injected `run`).
//
// INVARIANTS (ADR-278):
//   - Claim is the dedup: the loop CLAIMS nothing. A spawned worker's atomic foundry_claim
//     drops it from the next foundry_next frontier. The loop's `inFlight` set only bridges
//     the spawn→claim gap so a tight poll never double-spawns the same item.
//   - Merges nothing: DispatchLoopIO has NO merge boundary — structurally impossible.
//   - Crash-recovery via foundry_next: a worker that dies mid-claim leaves no claim → its
//     item reappears in the frontier → re-dispatched (reconcile is against the merged-PR /
//     event-log-derived frontier, never heartbeats). A worker that merged-then-died leaves a
//     terminal item that never reappears.
//   - Tier-agnostic dispatch (D-6): all tiers dispatched; T2 build-then-gate-halt is the
//     WORKER's behaviour (renderSessionPrompt → foundry-worker skill), never the daemon's.
import type { NextItem } from '../ops.js';
import type { RiskTier } from '../events.js';

export interface DispatchConfig {
  /** Max concurrent headless workers (D-5: conservative, start 2–3). */
  cap: number;
  /** Tiered model ids passed to `claude -p --model` (D-5). */
  models: { cheap: string; capable: string };
  /** Poll interval between drain iterations. */
  pollIntervalMs: number;
  /** 429 backoff base (one shared Max cap). */
  backoffBaseMs: number;
  /** 429 backoff ceiling. */
  backoffMaxMs: number;
  /** Give up on an item after this many consecutive spawn ERRORS (runaway guard). */
  maxAttemptsPerItem: number;
  /** `claude -p --permission-mode` for unattended work. */
  permissionMode: string;
}

export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  cap: 2,
  models: { cheap: 'sonnet', capable: 'opus' },
  pollIntervalMs: 5000,
  backoffBaseMs: 30000,
  backoffMaxMs: 900000,
  maxAttemptsPerItem: 3,
  permissionMode: 'acceptEdits',
};

export type SpawnOutcomeKind = 'spawned' | 'rate-limited' | 'error';
export interface SpawnResult {
  outcome: SpawnOutcomeKind;
  detail?: string;
  /** Resolves when the spawned worker child exits (used to free the in-flight slot). */
  whenDone: Promise<void>;
}

export interface DispatchLoopIO {
  /** Read the claimable frontier (the existing foundry_next / ops.nextItems). */
  readFrontier: (limit: number) => Promise<NextItem[]> | NextItem[];
  /** Spawn ONE headless worker for an item (the injected external mechanic). */
  spawnWorker: (item: NextItem) => Promise<SpawnResult>;
  /** Kill switch — true → stop the loop (cockpit stop / control file). */
  shouldStop: () => boolean;
  /** Write a liveness heartbeat (control file). */
  recordHeartbeat: () => void;
  /** 429 backoff — sleep an attempt-indexed exponential delay. */
  backoff: (attempt: number) => Promise<void>;
  /** Sleep between drain iterations. */
  sleep: (ms: number) => Promise<void>;
  config: DispatchConfig;
  log?: (msg: string) => void;
}

export interface DispatchLoopResult {
  stopped: boolean;
  drained: boolean;
  spawned: number;
  rateLimitHits: number;
  errors: number;
}

/** Pick up to (cap − inFlight) frontier items not already in-flight or given-up. */
export function planSpawnBatch(
  frontier: NextItem[],
  inFlight: ReadonlySet<string>,
  cap: number,
  givenUp: ReadonlySet<string> = new Set(),
): NextItem[] {
  const slots = Math.max(0, cap - inFlight.size);
  if (slots === 0) return [];
  const out: NextItem[] = [];
  for (const it of frontier) {
    if (out.length >= slots) break;
    if (inFlight.has(it.itemId) || givenUp.has(it.itemId)) continue;
    out.push(it);
  }
  return out;
}

/** Drained ⇔ nothing in-flight AND every frontier item is given-up (nothing left to do). */
export function isDrained(
  frontier: NextItem[],
  inFlight: ReadonlySet<string>,
  givenUp: ReadonlySet<string>,
): boolean {
  if (inFlight.size > 0) return false;
  return frontier.every((i) => givenUp.has(i.itemId));
}

/** D-5: green-desk/debt + T0 → cheap; T1+/product → capable. */
export function modelForItem(
  item: { riskTier: RiskTier; productKey: string },
  models: { cheap: string; capable: string },
): string {
  const isGreenDesk = item.productKey.startsWith('green-desk-');
  if (isGreenDesk || item.riskTier === 'T0') return models.cheap;
  return models.capable;
}

/** Exponential backoff: base·2^attempt, capped at max. */
export function backoffDelayMs(attempt: number, base: number, max: number): number {
  return Math.min(max, base * 2 ** attempt);
}
```

- [ ] **Step 4: Run the planner tests, watch them pass.** Run: `npx vitest run test/dispatch-loop.test.ts`. Expected: PASS for the four planner describes (the `runDispatchLoop` import resolves but is untested yet).

- [ ] **Step 5: Write the failing test for `runDispatchLoop`** — append to `test/dispatch-loop.test.ts`. These drive the loop with a controllable mock IO:

```ts
/** A controllable mock IO. `frontiers` is a queue of successive readFrontier results;
 *  once exhausted it returns the last entry. spawnOutcomes maps itemId → outcome. */
function mockIO(opts: {
  frontiers: NextItem[][];
  spawn: (item: NextItem) => SpawnResult;
  stopAfter?: number;            // shouldStop() returns true once this many polls elapsed
  config?: Partial<DispatchConfig>;
}): { io: DispatchLoopIO; heartbeats: number; backoffs: number[] } {
  let polls = 0;
  const state = { heartbeats: 0, backoffs: [] as number[] };
  const io: DispatchLoopIO = {
    readFrontier: () => {
      const f = opts.frontiers[Math.min(polls, opts.frontiers.length - 1)] ?? [];
      polls += 1;
      return f;
    },
    spawnWorker: async (it) => opts.spawn(it),
    shouldStop: () => opts.stopAfter != null && polls > opts.stopAfter,
    recordHeartbeat: () => { state.heartbeats += 1; },
    backoff: async (attempt) => { state.backoffs.push(attempt); },
    sleep: async () => {},
    config: { ...DEFAULT_DISPATCH_CONFIG, ...(opts.config ?? {}) },
    log: () => {},
  };
  return { io, ...state, get heartbeats() { return state.heartbeats; }, get backoffs() { return state.backoffs; } } as never;
}

const spawned = (): SpawnResult => ({ outcome: 'spawned', whenDone: Promise.resolve() });
const errored = (detail = 'boom'): SpawnResult => ({ outcome: 'error', detail, whenDone: Promise.resolve() });
const limited = (): SpawnResult => ({ outcome: 'rate-limited', whenDone: Promise.resolve() });

describe('runDispatchLoop', () => {
  it('drains: spawns each frontier item then stops when frontier + in-flight empty', async () => {
    const frontiers = [[item('a'), item('b')], []]; // round 1 has work, round 2 empty
    const seen: string[] = [];
    const { io } = mockIO({ frontiers, spawn: (it) => { seen.push(it.itemId); return spawned(); }, config: { cap: 2 } });
    const r = await runDispatchLoop(io);
    expect(r.drained).toBe(true);
    expect(r.stopped).toBe(false);
    expect(r.spawned).toBe(2);
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('respects the kill switch (shouldStop) even with frontier work remaining', async () => {
    const frontiers = [[item('a')]]; // always has work
    const { io } = mockIO({ frontiers, spawn: () => spawned(), stopAfter: 0, config: { cap: 1 } });
    const r = await runDispatchLoop(io);
    expect(r.stopped).toBe(true);
    expect(r.drained).toBe(false);
  });

  it('429 → backoff with a rising attempt index, then continues', async () => {
    // round 1: rate-limited; round 2: spawns; round 3: empty → drain.
    let round = 0;
    const frontiers = [[item('a')], [item('a')], []];
    const { io, backoffs } = mockIO({
      frontiers,
      spawn: () => (round++ === 0 ? limited() : spawned()),
      config: { cap: 1 },
    }) as unknown as { io: DispatchLoopIO; backoffs: number[] };
    const r = await runDispatchLoop(io);
    expect(r.rateLimitHits).toBe(1);
    expect(backoffs[0]).toBe(0); // first backoff is attempt 0
    expect(r.drained).toBe(true);
  });

  it('crash-recovery: a spawn ERROR leaves the item claimable; re-dispatched until maxAttempts, then given up', async () => {
    const frontiers = [[item('a')]]; // 'a' never claims (always errors)
    let attempts = 0;
    const { io } = mockIO({
      frontiers,
      spawn: () => { attempts += 1; return errored(); },
      config: { cap: 1, maxAttemptsPerItem: 3 },
    });
    const r = await runDispatchLoop(io);
    expect(attempts).toBe(3);          // tried exactly maxAttemptsPerItem times
    expect(r.errors).toBe(3);
    expect(r.drained).toBe(true);      // item given up → loop drains, no runaway
  });

  it('records a heartbeat every iteration', async () => {
    const frontiers = [[item('a')], []];
    const m = mockIO({ frontiers, spawn: () => spawned(), config: { cap: 1 } }) as unknown as { io: DispatchLoopIO; heartbeats: number };
    await runDispatchLoop(m.io);
    expect(m.heartbeats).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 6: Run, watch the loop tests fail.** Run: `npx vitest run test/dispatch-loop.test.ts`. Expected: FAIL — `runDispatchLoop is not a function`.

- [ ] **Step 7: Implement `runDispatchLoop`** — append to `src/dispatch/loop.ts`:

```ts
/** The drain loop. Each iteration: kill-switch check → heartbeat → read frontier →
 *  plan a batch (cap − in-flight, minus given-up) → spawn each. A 429 triggers an
 *  attempt-indexed backoff and aborts the rest of THIS iteration's batch (re-read next
 *  loop). A spawn error leaves the item claimable (crash-recovery via the frontier) and
 *  counts toward maxAttemptsPerItem; an item that errors that many times is GIVEN UP
 *  (runaway guard). Exits when the kill switch trips (stopped) or the frontier + in-flight
 *  drain (drained). */
export async function runDispatchLoop(io: DispatchLoopIO): Promise<DispatchLoopResult> {
  const inFlight = new Set<string>();
  const attempts = new Map<string, number>();
  const givenUp = new Set<string>();
  let spawned = 0, rateLimitHits = 0, errors = 0, backoffAttempt = 0;
  const log = io.log ?? (() => {});

  for (;;) {
    if (io.shouldStop()) {
      log('kill switch tripped — stopping');
      return { stopped: true, drained: false, spawned, rateLimitHits, errors };
    }
    io.recordHeartbeat();

    const frontier = await io.readFrontier(io.config.cap * 2);
    if (isDrained(frontier, inFlight, givenUp)) {
      log('frontier + in-flight drained — stopping');
      return { stopped: false, drained: true, spawned, rateLimitHits, errors };
    }

    const batch = planSpawnBatch(frontier, inFlight, io.config.cap, givenUp);
    let backedOff = false;
    for (const it of batch) {
      if (io.shouldStop()) break;
      const r = await io.spawnWorker(it);
      if (r.outcome === 'rate-limited') {
        rateLimitHits += 1;
        log(`429 — backoff (attempt ${backoffAttempt})`);
        await io.backoff(backoffAttempt);
        backoffAttempt += 1;
        backedOff = true;
        break; // abort the rest of this batch; re-read next iteration
      }
      if (r.outcome === 'error') {
        errors += 1;
        const n = (attempts.get(it.itemId) ?? 0) + 1;
        attempts.set(it.itemId, n);
        if (n >= io.config.maxAttemptsPerItem) {
          givenUp.add(it.itemId);
          log(`giving up on ${it.itemId} after ${n} spawn errors`);
        } else {
          log(`spawn error for ${it.itemId} (${r.detail ?? 'unknown'}) — left claimable, will retry`);
        }
        continue;
      }
      // spawned: the claim becomes the dedup; track the slot until the child exits.
      spawned += 1;
      backoffAttempt = 0; // a successful spawn resets the shared backoff
      inFlight.add(it.itemId);
      void r.whenDone.finally(() => inFlight.delete(it.itemId));
    }

    if (!backedOff) await io.sleep(io.config.pollIntervalMs);
  }
}
```

- [ ] **Step 8: Run the full loop test file, watch it pass.** Run: `npx vitest run test/dispatch-loop.test.ts`. Expected: PASS (all describes green). If the `mockIO` getter shim is awkward in TS, simplify it to return `{ io, state }` and read `state.heartbeats`/`state.backoffs` — adjust the two tests that read them. Keep going until green.

- [ ] **Step 9: Typecheck + commit.** Run: `npx tsc -p tsconfig.json --noEmit`. Then:

```bash
git add src/dispatch/loop.ts test/dispatch-loop.test.ts
git commit -m "feat(dispatch): pure drain loop — cap, 429 backoff, crash-recovery (ADR-278 D3/D5)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: The control-file state machine (start | stop | status, kill switch, heartbeat)

**Files:**
- Create: `src/dispatch/control.ts`
- Test: `test/dispatch-control.test.ts`

**Interfaces:**
- Consumes: `DispatchConfig`, `DEFAULT_DISPATCH_CONFIG` (from `./loop.js`).
- Produces (imported by Tasks 4–7):
  - `interface DispatchControlState { status: 'running' | 'stopped'; pid?: number; startedAt?: string; heartbeatAt?: string; config: DispatchConfig }`
  - `interface DispatchStatusView { status: 'running' | 'stopped' | 'crashed' | 'never-started'; healthy: boolean; pid?: number; startedAt?: string; heartbeatAt?: string; staleSeconds?: number; config?: DispatchConfig }`
  - `type SpawnDaemon = (config: DispatchConfig) => number | undefined`
  - `function controlPath(dataDir: string): string`
  - `function readControl(dataDir: string): DispatchControlState | null`
  - `function writeControl(dataDir: string, state: DispatchControlState): void`
  - `function startDispatch(deps: { dataDir: string; now?: () => string }, opts: { config?: Partial<DispatchConfig> }, spawnDaemon: SpawnDaemon): DispatchControlState`
  - `function stopDispatch(deps: { dataDir: string; now?: () => string }): DispatchControlState`
  - `function dispatchStatus(deps: { dataDir: string }, nowMs: number): DispatchStatusView`
  - `function makeKillSwitch(dataDir: string): () => boolean`
  - `function makeHeartbeat(dataDir: string, now: () => string): () => void`
  - `const HEARTBEAT_STALE_MS = 60000`

- [ ] **Step 1: Write the failing test** in `test/dispatch-control.test.ts`:

```ts
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import {
  controlPath, readControl, writeControl, startDispatch, stopDispatch, dispatchStatus,
  makeKillSwitch, makeHeartbeat, HEARTBEAT_STALE_MS, type SpawnDaemon,
} from '../src/dispatch/control.js';
import { DEFAULT_DISPATCH_CONFIG } from '../src/dispatch/loop.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } } });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'dispatch-control-')); dirs.push(d); return d; }
const T0 = '2026-06-26T12:00:00.000Z';

describe('control file read/write', () => {
  it('readControl returns null when absent; round-trips after write', () => {
    const d = tmp();
    expect(readControl(d)).toBeNull();
    writeControl(d, { status: 'running', config: DEFAULT_DISPATCH_CONFIG, startedAt: T0, heartbeatAt: T0 });
    expect(existsSync(controlPath(d))).toBe(true);
    expect(readControl(d)?.status).toBe('running');
  });
});

describe('startDispatch', () => {
  it('writes running BEFORE spawning the daemon, then records the pid', () => {
    const d = tmp();
    let observedAtSpawn: string | undefined;
    const spawn: SpawnDaemon = () => { observedAtSpawn = readControl(d)?.status; return 4242; };
    const state = startDispatch({ dataDir: d, now: () => T0 }, { config: { cap: 3 } }, spawn);
    expect(observedAtSpawn).toBe('running'); // daemon's first kill-switch read sees running
    expect(state.status).toBe('running');
    expect(state.pid).toBe(4242);
    expect(state.config.cap).toBe(3);
    expect(readControl(d)?.pid).toBe(4242);
  });

  it('is idempotent when a fresh daemon is already running (no second spawn)', () => {
    const d = tmp();
    let spawns = 0;
    const spawn: SpawnDaemon = () => { spawns += 1; return 1; };
    startDispatch({ dataDir: d, now: () => new Date().toISOString() }, {}, spawn);
    startDispatch({ dataDir: d, now: () => new Date().toISOString() }, {}, spawn);
    expect(spawns).toBe(1);
  });
});

describe('stopDispatch flips the kill switch', () => {
  it('sets status stopped so makeKillSwitch returns true', () => {
    const d = tmp();
    writeControl(d, { status: 'running', config: DEFAULT_DISPATCH_CONFIG, startedAt: T0, heartbeatAt: T0 });
    const kill = makeKillSwitch(d);
    expect(kill()).toBe(false);
    stopDispatch({ dataDir: d, now: () => T0 });
    expect(kill()).toBe(true);
  });

  it('makeKillSwitch returns true when the control file is absent', () => {
    expect(makeKillSwitch(tmp())()).toBe(true);
  });
});

describe('makeHeartbeat', () => {
  it('updates heartbeatAt without disturbing status/config', () => {
    const d = tmp();
    writeControl(d, { status: 'running', config: DEFAULT_DISPATCH_CONFIG, startedAt: T0, heartbeatAt: T0 });
    makeHeartbeat(d, () => '2026-06-26T12:05:00.000Z')();
    const c = readControl(d);
    expect(c?.heartbeatAt).toBe('2026-06-26T12:05:00.000Z');
    expect(c?.status).toBe('running');
  });
});

describe('dispatchStatus — liveness classification', () => {
  it('never-started when absent', () => {
    expect(dispatchStatus({ dataDir: tmp() }, Date.parse(T0)).status).toBe('never-started');
  });
  it('running + healthy when heartbeat is fresh', () => {
    const d = tmp();
    writeControl(d, { status: 'running', config: DEFAULT_DISPATCH_CONFIG, startedAt: T0, heartbeatAt: T0 });
    const v = dispatchStatus({ dataDir: d }, Date.parse(T0) + 1000);
    expect(v.status).toBe('running');
    expect(v.healthy).toBe(true);
  });
  it('crashed when status running but heartbeat is stale', () => {
    const d = tmp();
    writeControl(d, { status: 'running', config: DEFAULT_DISPATCH_CONFIG, startedAt: T0, heartbeatAt: T0 });
    const v = dispatchStatus({ dataDir: d }, Date.parse(T0) + HEARTBEAT_STALE_MS + 1);
    expect(v.status).toBe('crashed');
    expect(v.healthy).toBe(false);
  });
  it('stopped is reported as stopped (healthy:false, not crashed)', () => {
    const d = tmp();
    writeControl(d, { status: 'stopped', config: DEFAULT_DISPATCH_CONFIG, startedAt: T0, heartbeatAt: T0 });
    expect(dispatchStatus({ dataDir: d }, Date.parse(T0) + HEARTBEAT_STALE_MS + 1).status).toBe('stopped');
  });
});
```

- [ ] **Step 2: Run, watch it fail.** Run: `npx vitest run test/dispatch-control.test.ts`. Expected: FAIL — cannot resolve `../src/dispatch/control.js`.

- [ ] **Step 3: Create `src/dispatch/control.ts`:**

```ts
// The dispatch CONTROL surface (ADR-278 §D3). The kill switch + status live in a control
// FILE (data/dispatchd.json) — the foundry's file-as-memory idiom — so three actors stay
// decoupled: the cockpit/MCP WRITE start|stop, the detached daemon READS the kill switch +
// WRITES heartbeats, and status READS liveness. No process IPC, no port. Crash-recovery is
// heartbeat-staleness-derived for the STATUS readout only; the loop's true recovery is the
// foundry_next frontier (loop.ts). Mirrors store-lock.ts: small pure-ish I/O over a file.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DispatchConfig } from './loop.js';
import { DEFAULT_DISPATCH_CONFIG } from './loop.js';

export const HEARTBEAT_STALE_MS = 60000; // ~12 missed 5s heartbeats → presumed crashed

export interface DispatchControlState {
  status: 'running' | 'stopped';
  pid?: number;
  startedAt?: string;
  heartbeatAt?: string;
  config: DispatchConfig;
}

export interface DispatchStatusView {
  status: 'running' | 'stopped' | 'crashed' | 'never-started';
  healthy: boolean;
  pid?: number;
  startedAt?: string;
  heartbeatAt?: string;
  staleSeconds?: number;
  config?: DispatchConfig;
}

/** Launch the detached daemon process; returns its pid (injected → mockable). */
export type SpawnDaemon = (config: DispatchConfig) => number | undefined;

export function controlPath(dataDir: string): string {
  return join(dataDir, 'dispatchd.json');
}

export function readControl(dataDir: string): DispatchControlState | null {
  const p = controlPath(dataDir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as DispatchControlState;
  } catch {
    return null; // a torn/partial write reads as "no control" — start/stop overwrite it
  }
}

export function writeControl(dataDir: string, state: DispatchControlState): void {
  const p = controlPath(dataDir);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), 'utf8');
}

function isFresh(heartbeatAt: string | undefined, nowMs: number): boolean {
  if (heartbeatAt == null) return false;
  return nowMs - Date.parse(heartbeatAt) <= HEARTBEAT_STALE_MS;
}

/** Start the daemon. Writes `running` FIRST (so the daemon's first kill-switch read sees
 *  running — no spawn-before-state race), THEN spawns, THEN records the pid. Idempotent:
 *  a running daemon with a fresh heartbeat is not re-spawned. */
export function startDispatch(
  deps: { dataDir: string; now?: () => string },
  opts: { config?: Partial<DispatchConfig> },
  spawnDaemon: SpawnDaemon,
): DispatchControlState {
  const now = deps.now ?? (() => new Date().toISOString());
  const existing = readControl(deps.dataDir);
  if (existing && existing.status === 'running' && isFresh(existing.heartbeatAt, Date.parse(now()))) {
    return existing;
  }
  const config: DispatchConfig = { ...DEFAULT_DISPATCH_CONFIG, ...(opts.config ?? {}) };
  const base: DispatchControlState = { status: 'running', startedAt: now(), heartbeatAt: now(), config };
  writeControl(deps.dataDir, base); // running visible BEFORE spawn
  const pid = spawnDaemon(config);
  const state: DispatchControlState = pid != null ? { ...base, pid } : base;
  if (pid != null) writeControl(deps.dataDir, state);
  return state;
}

/** Trip the kill switch: status → stopped. The daemon's next shouldStop() read exits it. */
export function stopDispatch(deps: { dataDir: string; now?: () => string }): DispatchControlState {
  const now = deps.now ?? (() => new Date().toISOString());
  const existing = readControl(deps.dataDir);
  const config = existing?.config ?? DEFAULT_DISPATCH_CONFIG;
  const state: DispatchControlState = {
    ...(existing ?? {}),
    status: 'stopped',
    config,
    heartbeatAt: now(),
  };
  writeControl(deps.dataDir, state);
  return state;
}

/** Classify liveness for the cockpit/MCP readout. running+fresh → running; running+stale →
 *  crashed; stopped → stopped; absent → never-started. */
export function dispatchStatus(deps: { dataDir: string }, nowMs: number): DispatchStatusView {
  const c = readControl(deps.dataDir);
  if (c == null) return { status: 'never-started', healthy: false };
  const staleSeconds = c.heartbeatAt != null ? Math.max(0, Math.round((nowMs - Date.parse(c.heartbeatAt)) / 1000)) : undefined;
  const common = {
    ...(c.pid != null ? { pid: c.pid } : {}),
    ...(c.startedAt != null ? { startedAt: c.startedAt } : {}),
    ...(c.heartbeatAt != null ? { heartbeatAt: c.heartbeatAt } : {}),
    ...(staleSeconds != null ? { staleSeconds } : {}),
    config: c.config,
  };
  if (c.status === 'stopped') return { status: 'stopped', healthy: false, ...common };
  // status running:
  if (isFresh(c.heartbeatAt, nowMs)) return { status: 'running', healthy: true, ...common };
  return { status: 'crashed', healthy: false, ...common };
}

/** The loop's kill-switch boundary: stop unless the control file says running. */
export function makeKillSwitch(dataDir: string): () => boolean {
  return () => {
    const c = readControl(dataDir);
    return c == null || c.status !== 'running';
  };
}

/** The loop's heartbeat boundary: stamp heartbeatAt, preserving status/config. */
export function makeHeartbeat(dataDir: string, now: () => string): () => void {
  return () => {
    const c = readControl(dataDir);
    if (c == null) return;
    writeControl(dataDir, { ...c, heartbeatAt: now() });
  };
}
```

- [ ] **Step 4: Run, watch it pass.** Run: `npx vitest run test/dispatch-control.test.ts`. Expected: PASS (all describes green).

- [ ] **Step 5: Typecheck + commit.** Run: `npx tsc -p tsconfig.json --noEmit`. Then:

```bash
git add src/dispatch/control.ts test/dispatch-control.test.ts
git commit -m "feat(dispatch): control-file state machine — start/stop/status + kill switch + heartbeat (ADR-278 D3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: The real `claude -p` spawn mechanic

**Files:**
- Create: `src/dispatch/spawn.ts`
- Test: `test/dispatch-spawn.test.ts`

**Interfaces:**
- Consumes: `NextItem` (`../ops.js`), `renderSessionPrompt` (`../prompts.js`), `DispatchConfig`, `SpawnResult`, `modelForItem` (`./loop.js`), `SpawnDaemon` (`./control.js`).
- Produces:
  - `function buildClaudeArgs(prompt: string, model: string, permissionMode: string): string[]`
  - `function classifyExit(code: number | null, stderr: string): SpawnOutcomeKind`
  - `function resolveClusterRoot(env: NodeJS.ProcessEnv, fromDir: string): string`
  - `function spawnClaudeWorker(item: NextItem, config: DispatchConfig, ctx?: { env?; cwd?; spawnFn? }): Promise<SpawnResult>` (real default)
  - `const spawnDispatchDaemon: SpawnDaemon` (launches the detached `foundry-dispatchd`)

- [ ] **Step 1: Write the failing test for the pure parts** in `test/dispatch-spawn.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildClaudeArgs, classifyExit, resolveClusterRoot } from '../src/dispatch/spawn.js';

describe('buildClaudeArgs — the claude -p argv (D-1)', () => {
  it('is headless print mode with --model and --permission-mode; never the Agent SDK', () => {
    const args = buildClaudeArgs('do the work', 'opus', 'acceptEdits');
    expect(args).toEqual(['-p', 'do the work', '--model', 'opus', '--permission-mode', 'acceptEdits']);
    // -p (print/headless) is the FIRST flag — the D-1 mechanism (subscription claude -p).
    expect(args[0]).toBe('-p');
  });
});

describe('classifyExit — 429 / rate-limit detection', () => {
  it('clean exit 0 → spawned', () => {
    expect(classifyExit(0, '')).toBe('spawned');
  });
  it('rate-limit / 429 / overloaded stderr → rate-limited (any non-zero code)', () => {
    expect(classifyExit(1, 'Error: 429 Too Many Requests')).toBe('rate-limited');
    expect(classifyExit(1, 'rate limit exceeded')).toBe('rate-limited');
    expect(classifyExit(1, 'overloaded_error')).toBe('rate-limited');
    expect(classifyExit(null, 'RATE LIMIT')).toBe('rate-limited');
  });
  it('other non-zero exit → error', () => {
    expect(classifyExit(1, 'something else broke')).toBe('error');
  });
});

describe('resolveClusterRoot — spawn cwd (D-4: .mcp.json must load)', () => {
  it('honors FOUNDRY_CLUSTER_ROOT when set', () => {
    expect(resolveClusterRoot({ FOUNDRY_CLUSTER_ROOT: 'X:/cluster' } as NodeJS.ProcessEnv, '/whatever')).toBe('X:/cluster');
  });
  it('else resolves two levels up from the foundry repo (domains/foundry → cluster root)', () => {
    // fromDir is the foundry repo root; cluster root = <root>/../..
    const got = resolveClusterRoot({} as NodeJS.ProcessEnv, '/a/b/de-braighter/domains/foundry');
    expect(got.replace(/\\/g, '/')).toBe('/a/b/de-braighter');
  });
});
```

- [ ] **Step 2: Run, watch it fail.** Run: `npx vitest run test/dispatch-spawn.test.ts`. Expected: FAIL — cannot resolve `../src/dispatch/spawn.js`.

- [ ] **Step 3: Create `src/dispatch/spawn.ts`:**

```ts
// The EXTERNAL mechanic (ADR-278 §D2): the actual headless `claude -p` spawn + the detached
// `foundry-dispatchd` launcher. Sibling of `gh` / the merge hot-path — NOT a kernel concept.
// The PURE parts (argv build, 429 classification, cluster-root resolution) are unit-tested;
// the child_process spawn itself is thin trusted I/O (like wt-pool's defaultRun), injected
// into the loop via io.spawnWorker so tests never launch a real process.
//
// D-1: subscription `claude -p` (never the Agent SDK). D-4: inherit the founder's ambient
// env (SSH→git push, gh→PR/merge, CLAUDE_CODE_OAUTH_TOKEN→model); cwd = cluster root so the
// foundry MCP loads from .mcp.json; never --bare. Commits/PRs are authored as the founder.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { NextItem } from '../ops.js';
import { renderSessionPrompt } from '../prompts.js';
import { modelForItem, type DispatchConfig, type SpawnResult, type SpawnOutcomeKind } from './loop.js';
import type { SpawnDaemon } from './control.js';

/** `claude -p "<prompt>" --model <model> --permission-mode <mode>` — D-1 headless mode. */
export function buildClaudeArgs(prompt: string, model: string, permissionMode: string): string[] {
  return ['-p', prompt, '--model', model, '--permission-mode', permissionMode];
}

const RATE_LIMIT_RE = /\b(429|rate[ _-]?limit|overloaded)\b/i;

/** Classify a child exit: clean → spawned; rate-limit signal → rate-limited; else error. */
export function classifyExit(code: number | null, stderr: string): SpawnOutcomeKind {
  if (code === 0) return 'spawned';
  if (RATE_LIMIT_RE.test(stderr)) return 'rate-limited';
  return 'error';
}

/** cwd for the spawned worker — the CLUSTER ROOT so .mcp.json wires the foundry MCP (D-4).
 *  FOUNDRY_CLUSTER_ROOT overrides; else two levels up from the foundry repo root. */
export function resolveClusterRoot(env: NodeJS.ProcessEnv, fromDir: string): string {
  const override = env['FOUNDRY_CLUSTER_ROOT'];
  if (override != null && override.length > 0) return override;
  return resolve(fromDir, '..', '..');
}

/** The foundry repo root (this module is at <root>/src/dispatch/spawn.ts → up 2 from here). */
function foundryRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

/** Spawn ONE headless worker. SETTLE WINDOW: if the child exits within settleMs we classify
 *  the early exit (a fast 429 → rate-limited; another fast failure → error); otherwise it is
 *  running → 'spawned' and whenDone tracks the eventual exit (freeing the in-flight slot).
 *  The spawn fn is injected for tests; the default is node:child_process.spawn. */
export function spawnClaudeWorker(
  item: NextItem,
  config: DispatchConfig,
  ctx: { env?: NodeJS.ProcessEnv; cwd?: string; spawnFn?: typeof spawn; settleMs?: number } = {},
): Promise<SpawnResult> {
  const env = ctx.env ?? process.env;
  const cwd = ctx.cwd ?? resolveClusterRoot(env, foundryRepoRoot());
  const spawnFn = ctx.spawnFn ?? spawn;
  const settleMs = ctx.settleMs ?? 8000;
  const model = modelForItem(item, config.models);
  const prompt = renderSessionPrompt(item);
  const args = buildClaudeArgs(prompt, model, config.permissionMode);

  return new Promise<SpawnResult>((resolveP) => {
    // shell:true so Windows resolves `claude.cmd`; inherit env (D-4); detached so the worker
    // outlives a daemon restart but is still reaped via whenDone.
    const child = spawnFn('claude', args, { cwd, env, shell: true });
    let stderr = '';
    let settled = false;
    child.stderr?.on('data', (d) => { stderr += String(d); });

    let resolveDone: () => void = () => {};
    const whenDone = new Promise<void>((r) => { resolveDone = r; });

    const settle = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolveP({ outcome: 'spawned', whenDone }); // still running past the settle window
    }, settleMs);

    child.on('error', (e) => {
      if (!settled) { settled = true; clearTimeout(settle); resolveP({ outcome: 'error', detail: e.message, whenDone }); }
      resolveDone();
    });
    child.on('exit', (code) => {
      resolveDone();
      if (settled) return;
      settled = true;
      clearTimeout(settle);
      const outcome = classifyExit(code, stderr);
      resolveP({ outcome, ...(outcome !== 'spawned' ? { detail: stderr.slice(0, 500) } : {}), whenDone });
    });
  });
}

/** Launch the DETACHED `foundry-dispatchd` (the SpawnDaemon used by startDispatch). Runs
 *  `tsx src/dispatch/cli.ts` from the foundry repo, inheriting env. Detached + unref'd so it
 *  survives the MCP/cockpit session that started it. Returns the child pid. */
export const spawnDispatchDaemon: SpawnDaemon = (_config) => {
  const root = foundryRepoRoot();
  const child = spawn('npx', ['tsx', 'src/dispatch/cli.ts'], {
    cwd: root, env: process.env, shell: true, detached: true, stdio: 'ignore',
  });
  child.unref();
  return child.pid;
};
```

- [ ] **Step 4: Run, watch the pure tests pass.** Run: `npx vitest run test/dispatch-spawn.test.ts`. Expected: PASS (the three pure describes). The `spawnClaudeWorker`/`spawnDispatchDaemon` I/O is trusted (not exercised here — covered structurally + by the live smoke).

- [ ] **Step 5: Typecheck + commit.** Run: `npx tsc -p tsconfig.json --noEmit`. Then:

```bash
git add src/dispatch/spawn.ts test/dispatch-spawn.test.ts
git commit -m "feat(dispatch): claude -p spawn mechanic + detached daemon launcher (ADR-278 D1/D4)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: The `foundry-dispatchd` CLI entrypoint + npm script

**Files:**
- Create: `src/dispatch/cli.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `runDispatchLoop`, `backoffDelayMs`, `DEFAULT_DISPATCH_CONFIG` (`./loop.js`); `makeKillSwitch`, `makeHeartbeat`, `readControl`, `writeControl` (`./control.js`); `spawnClaudeWorker` (`./spawn.js`); `nextItems`, `FoundryDeps` (`../ops.js`); `DEFAULT_DATA_DIR`, `DEFAULT_LOG` (`../log.js`).
- Produces: a runnable daemon (no exported API). This task wires the pieces; it is verified by typecheck + a smoke-import test (no real process launched).

- [ ] **Step 1: Write a thin failing wiring test** in `test/dispatch-loop.test.ts` (append) — assert the CLI module imports cleanly and the daemon `main` is wireable with injected boundaries (proving the wiring composes without launching `claude`):

```ts
import { runDaemon } from '../src/dispatch/cli.js';

describe('foundry-dispatchd wiring (runDaemon with injected IO)', () => {
  it('drains a one-item frontier through the injected spawn then stops', async () => {
    let stopped = false;
    const r = await runDaemon({
      readFrontier: () => (stopped ? [] : [item('a')]),
      spawnWorker: async () => { stopped = true; return { outcome: 'spawned', whenDone: Promise.resolve() }; },
      shouldStop: () => false,
      recordHeartbeat: () => {},
      backoff: async () => {},
      sleep: async () => {},
      config: { ...DEFAULT_DISPATCH_CONFIG, cap: 1 },
      log: () => {},
    });
    expect(r.spawned).toBe(1);
    expect(r.drained).toBe(true);
  });
});
```

- [ ] **Step 2: Run, watch it fail.** Run: `npx vitest run test/dispatch-loop.test.ts`. Expected: FAIL — cannot resolve `../src/dispatch/cli.js` / `runDaemon`.

- [ ] **Step 3: Create `src/dispatch/cli.ts`.** Export a `runDaemon(io)` thin pass-through to `runDispatchLoop` (so the wiring is testable) + a side-effectful `main()` that builds the real IO and is invoked when run directly:

```ts
// `foundry-dispatchd` — the autonomous headless dispatch daemon (ADR-278 §D3). Reads its
// config from the control file (written by foundry_dispatch start), builds the REAL IO
// (foundry_next frontier reader + claude -p spawn + control-file kill switch + heartbeat),
// and runs the pure drain loop until the kill switch trips or the frontier drains. The
// real boundaries are all here; loop.ts holds the (pure) brain.
import { setTimeout as delay } from 'node:timers/promises';
import { DEFAULT_DATA_DIR, DEFAULT_LOG } from '../log.js';
import { nextItems, type FoundryDeps } from '../ops.js';
import {
  runDispatchLoop, backoffDelayMs, DEFAULT_DISPATCH_CONFIG,
  type DispatchConfig, type DispatchLoopIO, type DispatchLoopResult,
} from './loop.js';
import { makeKillSwitch, makeHeartbeat, readControl, stopDispatch } from './control.js';
import { spawnClaudeWorker } from './spawn.js';

/** Thin seam so the wiring is unit-testable with injected IO. */
export function runDaemon(io: DispatchLoopIO): Promise<DispatchLoopResult> {
  return runDispatchLoop(io);
}

/** Build the real IO from the control-file config + live foundry log, run to completion,
 *  then mark the daemon stopped (so a clean drain leaves the control file honest). */
export async function main(): Promise<void> {
  const deps: FoundryDeps = { dataDir: DEFAULT_DATA_DIR, logPath: DEFAULT_LOG };
  const control = readControl(deps.dataDir);
  const config: DispatchConfig = control?.config ?? DEFAULT_DISPATCH_CONFIG;
  const now = (): string => new Date().toISOString();

  const io: DispatchLoopIO = {
    readFrontier: (limit) => nextItems(deps, limit),
    spawnWorker: (item) => spawnClaudeWorker(item, config),
    shouldStop: makeKillSwitch(deps.dataDir),
    recordHeartbeat: makeHeartbeat(deps.dataDir, now),
    backoff: (attempt) => delay(backoffDelayMs(attempt, config.backoffBaseMs, config.backoffMaxMs)),
    sleep: (ms) => delay(ms),
    config,
    log: (msg) => process.stdout.write(`[foundry-dispatchd] ${msg}\n`),
  };

  const result = await runDispatchLoop(io);
  // A natural drain (not a kill) marks the daemon stopped so status reads cleanly.
  if (result.drained) stopDispatch({ dataDir: deps.dataDir, now });
  process.stdout.write(`[foundry-dispatchd] exit: ${JSON.stringify(result)}\n`);
}

// Side-effectful entry (pathToFileURL guard for Windows, matching mcp/server.ts).
import { pathToFileURL } from 'node:url';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('[foundry-dispatchd boot error]', e); process.exit(1); });
}
```

- [ ] **Step 4: Run, watch the wiring test pass.** Run: `npx vitest run test/dispatch-loop.test.ts`. Expected: PASS (incl. the new `runDaemon` wiring test).

- [ ] **Step 5: Add the npm script** to `package.json` (after `"wt-pool"`):

```json
    "dispatchd": "tsx src/dispatch/cli.ts",
```

- [ ] **Step 6: Typecheck + commit.** Run: `npx tsc -p tsconfig.json --noEmit`. Then:

```bash
git add src/dispatch/cli.ts package.json test/dispatch-loop.test.ts
git commit -m "feat(dispatch): foundry-dispatchd daemon entrypoint + npm script (ADR-278 D3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: The `foundry_dispatch` MCP tool (start | stop | status)

**Files:**
- Modify: `src/mcp/tools.ts`
- Modify: `src/mcp/server.ts`
- Test: `test/dispatch-mcp.test.ts`

**Interfaces:**
- Consumes: `startDispatch`, `stopDispatch`, `dispatchStatus`, `SpawnDaemon` (`../dispatch/control.js`); `spawnDispatchDaemon` (`../dispatch/spawn.js`); `DispatchConfig` (`../dispatch/loop.js`).
- Produces: `makeTools(deps, opts?: { spawnDaemon?: SpawnDaemon })` (back-compatible — existing single-arg callers keep working) with a new `foundry_dispatch` handler. Server registers `foundry_dispatch` with typed args `{ action: 'start'|'stop'|'status', config?: {…} }`.

- [ ] **Step 1: Write the failing test** in `test/dispatch-mcp.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { makeTools } from '../src/mcp/tools.js';
import { readControl } from '../src/dispatch/control.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } } });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'dispatch-mcp-')); dirs.push(d); return d; }
function text(r: CallToolResult): string { return (r.content[0] as { text: string }).text; }

describe('foundry_dispatch MCP tool', () => {
  it('start writes a running control file via the INJECTED spawnDaemon (no real process)', async () => {
    const d = tmp();
    let spawned = 0;
    const tools = makeTools({ dataDir: d, logPath: join(d, 'events.jsonl'), now: () => '2026-06-26T12:00:00.000Z' },
      { spawnDaemon: () => { spawned += 1; return 999; } });
    const r = await tools.foundry_dispatch({ action: 'start', config: { cap: 3 } });
    expect(r.isError).toBeUndefined();
    expect(spawned).toBe(1);
    const c = readControl(d);
    expect(c?.status).toBe('running');
    expect(c?.config.cap).toBe(3);
    expect(c?.pid).toBe(999);
  });

  it('status reports the live view; stop flips it to stopped', async () => {
    const d = tmp();
    const tools = makeTools({ dataDir: d, logPath: join(d, 'events.jsonl'), now: () => new Date().toISOString() },
      { spawnDaemon: () => 1 });
    await tools.foundry_dispatch({ action: 'start' });
    const s1 = JSON.parse(text(await tools.foundry_dispatch({ action: 'status' })));
    expect(s1.status).toBe('running');
    await tools.foundry_dispatch({ action: 'stop' });
    const s2 = JSON.parse(text(await tools.foundry_dispatch({ action: 'status' })));
    expect(s2.status).toBe('stopped');
  });

  it('an unknown action is an isError result, not a throw', async () => {
    const d = tmp();
    const tools = makeTools({ dataDir: d, logPath: join(d, 'events.jsonl') }, { spawnDaemon: () => 1 });
    const r = await tools.foundry_dispatch({ action: 'frobnicate' } as never);
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run, watch it fail.** Run: `npx vitest run test/dispatch-mcp.test.ts`. Expected: FAIL — `foundry_dispatch` is not a function.

- [ ] **Step 3: Extend `makeTools`** in `src/mcp/tools.ts`. Add imports at top:

```ts
import { startDispatch, stopDispatch, dispatchStatus, type SpawnDaemon } from '../dispatch/control.js';
import { spawnDispatchDaemon } from '../dispatch/spawn.js';
import type { DispatchConfig } from '../dispatch/loop.js';
```

Change the signature + add the handler. Replace `export function makeTools(deps: ops.FoundryDeps) {` with:

```ts
export function makeTools(deps: ops.FoundryDeps, opts: { spawnDaemon?: SpawnDaemon } = {}) {
  const spawnDaemon = opts.spawnDaemon ?? spawnDispatchDaemon;
```

Then add this handler inside the returned object (e.g. after `foundry_conduct_workflow`):

```ts
    // ADR-278: control the headless dispatch daemon. start launches foundry-dispatchd (it
    // spawns ≤N headless `claude -p` workers over the claimable frontier, each self-claiming);
    // stop trips the kill switch; status reports liveness. The daemon claims nothing + merges
    // nothing; T2 builds then HALTS at the founder ship gate (worker behaviour).
    foundry_dispatch: guard((a: { action: 'start' | 'stop' | 'status'; config?: Partial<DispatchConfig> }) => {
      switch (a.action) {
        case 'start': return startDispatch(deps, { ...(a.config != null ? { config: a.config } : {}) }, spawnDaemon);
        case 'stop': return stopDispatch(deps);
        case 'status': return dispatchStatus(deps, Date.parse(nowIso()));
        default: throw new Error(`unknown dispatch action: ${String(a.action)} (expected start | stop | status)`);
      }
    }),
```

- [ ] **Step 4: Run, watch it pass.** Run: `npx vitest run test/dispatch-mcp.test.ts`. Expected: PASS.

- [ ] **Step 5: Register the tool** in `src/mcp/server.ts`. Add the import near the other dispatch-free imports (top of file):

```ts
import type { DispatchConfig } from '../dispatch/loop.js';
```

Then register it after `foundry_conduct_workflow` (the typed args honor the JSON_OBJECT_ARG lesson — `config` is a proper `z.object`, NOT `z.unknown`, so it renders `type: object` to the client):

```ts
  server.registerTool('foundry_dispatch', {
    description: 'Control the headless dispatch daemon (foundry-dispatchd, ADR-278): start | stop | status. ' +
      'start launches the daemon — it spawns up to N concurrent HEADLESS `claude -p` workers over the ' +
      'claimable frontier (foundry_next), each self-claiming (the claim is the dedup); stop trips the kill ' +
      'switch; status reports liveness (running | stopped | crashed | never-started). The daemon CLAIMS nothing ' +
      'and MERGES nothing; T2 items build then HALT at the founder ship gate. Pass config to override the ' +
      'concurrency cap / models / backoff on start.',
    inputSchema: {
      action: z.enum(['start', 'stop', 'status']),
      config: z.object({
        cap: z.number().int().positive().optional(),
        models: z.object({ cheap: z.string().min(1), capable: z.string().min(1) }).optional(),
        pollIntervalMs: z.number().int().positive().optional(),
        backoffBaseMs: z.number().int().positive().optional(),
        backoffMaxMs: z.number().int().positive().optional(),
        maxAttemptsPerItem: z.number().int().positive().optional(),
        permissionMode: z.string().min(1).optional(),
      }).optional(),
    },
  }, async (a) => tools.foundry_dispatch(a as { action: 'start' | 'stop' | 'status'; config?: Partial<DispatchConfig> }));
```

- [ ] **Step 6: Verify the MCP surface acid still passes + typecheck.** Run: `npx vitest run test/dispatch-mcp.test.ts test/mcp-tools.test.ts test/mcp-surface.acid.test.ts` then `npx tsc -p tsconfig.json --noEmit`. Expected: PASS + clean. (If `test/mcp-tools.test.ts` enumerates the tool set, add `foundry_dispatch` to its expected list.)

- [ ] **Step 7: Commit.**

```bash
git add src/mcp/tools.ts src/mcp/server.ts test/dispatch-mcp.test.ts
git commit -m "feat(dispatch): foundry_dispatch MCP tool — start/stop/status (ADR-278 D3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: The cockpit control (start/stop/status surface)

**Files:**
- Modify: `src/dashboard/server.ts`
- Modify: `src/dashboard/render.ts`
- Test: `test/dispatch-cockpit.acid.test.ts`

**Interfaces:**
- Consumes: `startDispatch`, `stopDispatch`, `dispatchStatus`, `DispatchStatusView` (`../dispatch/control.js`); `spawnDispatchDaemon` (`../dispatch/spawn.js`).
- Produces: `renderFoundryDashboard(state, now, opts)` gains an optional `opts.dispatch?: DispatchStatusView` → an interactive-only dispatch control panel (Start/Stop buttons + status). The server adds `POST /api/dispatch` (`{ action: 'start' | 'stop' }`) and passes `dispatchStatus` into the GET render. Static (non-interactive) render stays byte-identical (no `dispatch` → no panel).

- [ ] **Step 1: Write the failing render + endpoint test** in `test/dispatch-cockpit.acid.test.ts`:

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect } from 'vitest';
import { fold } from '../src/state.js';
import { readEnvelopes } from '../src/log.js';
import { renderFoundryDashboard } from '../src/dashboard/render.js';
import { startDashboardServer } from '../src/dashboard/server.js';
import { readControl, type DispatchStatusView } from '../src/dispatch/control.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } } });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'dispatch-cockpit-')); dirs.push(d); return d; }
const emptyState = () => fold(readEnvelopes(join(tmp(), 'nope.jsonl')));

describe('render — dispatch panel (interactive-only, byte-stable static)', () => {
  it('omits the dispatch panel on the static path (byte-identical)', () => {
    const s = emptyState();
    const staticHtml = renderFoundryDashboard(s, 0, {});
    expect(staticHtml).not.toContain('id="dispatch-panel"');
  });
  it('renders Start when never-started; Stop when running', () => {
    const s = emptyState();
    const never: DispatchStatusView = { status: 'never-started', healthy: false };
    const htmlNever = renderFoundryDashboard(s, 0, { interactive: true, dispatch: never });
    expect(htmlNever).toContain('id="dispatch-panel"');
    expect(htmlNever).toContain('__dispatchStart()');
    const running: DispatchStatusView = { status: 'running', healthy: true };
    const htmlRunning = renderFoundryDashboard(s, 0, { interactive: true, dispatch: running });
    expect(htmlRunning).toContain('__dispatchStop()');
    expect(htmlRunning).toContain('running');
  });
});

describe('server — POST /api/dispatch start/stop', () => {
  it('start then stop drives the control file via the localhost endpoint', async () => {
    const d = tmp();
    const { url, close } = await startDashboardServer({ dataDir: d, logPath: join(d, 'events.jsonl') }, { port: 0 });
    try {
      const r1 = await fetch(`${url}/api/dispatch`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', config: { cap: 2 } }),
      });
      expect(r1.ok).toBe(true);
      expect(readControl(d)?.status).toBe('running');
      const r2 = await fetch(`${url}/api/dispatch`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      });
      expect(r2.ok).toBe(true);
      expect(readControl(d)?.status).toBe('stopped');
    } finally {
      await close();
    }
  });
});
```

> Note: the server's real `spawnDispatchDaemon` would launch `npx tsx` here. To keep the acid hermetic, the server wires the daemon spawn through an injectable boundary defaulting to the real launcher; the test relies on `start` writing the control file regardless of whether the (detached, stdio-ignored) child actually boots. If the spawned `npx` is flaky in CI, pass a no-op spawn via the server opts (see Step 3) — prefer that for the test.

- [ ] **Step 2: Run, watch it fail.** Run: `npx vitest run test/dispatch-cockpit.acid.test.ts`. Expected: FAIL — no dispatch panel / no `/api/dispatch` route.

- [ ] **Step 3: Add the server endpoint + status wiring** in `src/dashboard/server.ts`. Add imports:

```ts
import { startDispatch, stopDispatch, dispatchStatus, type SpawnDaemon } from '../dispatch/control.js';
import { spawnDispatchDaemon } from '../dispatch/spawn.js';
```

Extend the server-opts to accept an injectable daemon spawn (default real), so the acid can pass a no-op. Change the signature:

```ts
export function startDashboardServer(
  deps: ops.FoundryDeps,
  opts: { port?: number; spawnDaemon?: SpawnDaemon } = {},
): Promise<{ url: string; close: () => Promise<void> }> {
  const spawnDaemon: SpawnDaemon = opts.spawnDaemon ?? spawnDispatchDaemon;
```

In the GET `/` handler, pass dispatch status into the render (read it the same place `state` is folded):

```ts
          const html = renderFoundryDashboard(state, Date.now(), {
            models, interactive: true, dispatch: dispatchStatus(deps, Date.now()),
          });
```

Add the new route (mirror the conduct endpoint's body-read security VERBATIM — 127.0.0.1, MAX_BODY → 413, POST-only). Insert before the `404`:

```ts
        if (req.method === 'POST' && req.url === '/api/dispatch') {
          // THE COCKPIT CONTROLS THE HEADLESS DISPATCH DAEMON (ADR-278 §D3): start launches
          // foundry-dispatchd; stop trips the kill switch. Localhost-only mutation, mirroring
          // the reprioritize/authorize/conduct endpoints VERBATIM. The daemon claims nothing
          // and merges nothing; this surface only starts/stops it.
          let dRaw: string;
          try {
            dRaw = await readBody(req);
          } catch (e) {
            if ((e as Error).message === 'payload too large') {
              res.writeHead(413, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'payload too large' }));
            }
            return;
          }
          let dParsed: { action?: string; config?: Record<string, unknown> };
          try {
            dParsed = JSON.parse(dRaw || '{}') as { action?: string; config?: Record<string, unknown> };
          } catch {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'invalid JSON body' }));
            return;
          }
          try {
            let result: unknown;
            if (dParsed.action === 'start') {
              result = startDispatch(deps, { ...(dParsed.config != null ? { config: dParsed.config } : {}) }, spawnDaemon);
            } else if (dParsed.action === 'stop') {
              result = stopDispatch(deps);
            } else {
              res.writeHead(400, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'action must be start | stop' }));
              return;
            }
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, result }));
          } catch (e) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
          }
          return;
        }
```

In the cockpit acid test (Step 1), pass `{ port: 0, spawnDaemon: () => undefined }` to keep it hermetic — update the test's `startDashboardServer` call accordingly.

- [ ] **Step 4: Add the render panel + client script** in `src/dashboard/render.ts`. First extend the opts type — find the `renderFoundryDashboard` signature / opts interface and add:

```ts
  dispatch?: import('../dispatch/control.js').DispatchStatusView;
```

Add a panel builder near `workflowSection` (interactive-only, like the workflow panel). The panel renders the status + exactly ONE primary button (Start when stopped/never-started/crashed; Stop when running):

```ts
  const dispatchSection = (): string => {
    if (!opts?.interactive || opts.dispatch == null) return '';
    const dsp = opts.dispatch;
    const running = dsp.status === 'running';
    const color = running ? '#22c55e' : dsp.status === 'crashed' ? '#ef4444' : '#6b7280';
    const btn = running
      ? `<button class="dispbtn stop" onclick="__dispatchStop()">Stop daemon</button>`
      : `<button class="dispbtn start" onclick="__dispatchStart()">Start daemon</button>`;
    const cap = dsp.config?.cap != null ? ` · cap ${esc(String(dsp.config.cap))}` : '';
    const pid = dsp.pid != null ? ` · pid ${esc(String(dsp.pid))}` : '';
    return `
  <!-- DISPATCH — the cockpit controls the headless dispatch daemon (ADR-278) -->
  <div class="section">
    <h2>headless dispatch · foundry-dispatchd</h2>
    <div class="panel" id="dispatch-panel">
      <span class="dispstat" style="color:${color}">${esc(dsp.status)}</span>${cap}${pid}
      ${btn}
    </div>
  </div>`;
  };
```

Insert `${dispatchSection()}` into the page body next to `${workflowSection()}` (find where `workflowSection()` is interpolated in the returned template and add the dispatch section adjacent to it).

Add the client script (rendered only when interactive && dispatch present), next to `advanceScript`:

```ts
  const dispatchScript = opts?.interactive && opts.dispatch != null
    ? `<script>
  function __dispatchStart() {
    if (!confirm('Start foundry-dispatchd? It will spawn headless claude -p workers over the claimable frontier (up to the concurrency cap). T2 items build then HALT at the founder ship gate.')) return;
    fetch('/api/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start' }) })
      .then(async function (res) { if (res.ok) { location.reload(); } else { alert('failed: ' + await res.text()); } })
      .catch(function (e) { alert('failed: ' + e); });
  }
  function __dispatchStop() {
    if (!confirm('Stop foundry-dispatchd? The daemon exits at its next poll; in-flight workers finish on their own.')) return;
    fetch('/api/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) })
      .then(async function (res) { if (res.ok) { location.reload(); } else { alert('failed: ' + await res.text()); } })
      .catch(function (e) { alert('failed: ' + e); });
  }
</script>`
    : '';
```

Interpolate `${dispatchScript}` into the page next to `${advanceScript}` in the returned template.

- [ ] **Step 5: Run, watch it pass.** Run: `npx vitest run test/dispatch-cockpit.acid.test.ts`. Expected: PASS. Then run the existing dashboard acids to confirm byte-stability of the static path: `npx vitest run test/dashboard.acid.test.ts test/dashboard-cockpit.acid.test.ts test/dashboard-interactive.acid.test.ts test/dashboard-mcp.acid.test.ts`. Expected: PASS (the static written-to-file render is unchanged — no `dispatch` opt passed on that path). If any static-render snapshot shifted, ensure `dispatchSection()`/`dispatchScript` are strictly gated on `opts.dispatch != null` and never emitted on the non-interactive path.

- [ ] **Step 6: Typecheck + commit.** Run: `npx tsc -p tsconfig.json --noEmit`. Then:

```bash
git add src/dashboard/server.ts src/dashboard/render.ts test/dispatch-cockpit.acid.test.ts
git commit -m "feat(dispatch): cockpit start/stop/status control for foundry-dispatchd (ADR-278 D3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **Run the full dispatch + workflow-action suite:** `npx vitest run test/dispatch-loop.test.ts test/dispatch-control.test.ts test/dispatch-spawn.test.ts test/dispatch-mcp.test.ts test/dispatch-cockpit.acid.test.ts src/workflow/actions.spec.ts test/workflow-actions.acid.test.ts test/mcp-tools.test.ts test/mcp-surface.acid.test.ts`. Expected: all green.
- [ ] **`ci:local`:** `npm run ci:local` (typecheck + full coverage run). Expected: green. If the full collect flakes on timeout under load, re-run the failing file targeted to confirm it is a flake, not a real failure.
- [ ] **Push + open the PR** with body lines: `Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]` · `Effort: deep` · `Effect: cycle-time 0.01±0.02 expert`. PR title: `feat(foundry): headless dispatch bridge — foundry-dispatchd + dispatch-worker + cockpit control (ADR-278)`.
- [ ] **Verifier wave** (foundry = T0 → standard wave): `reviewer` + `qa-engineer` + `charter-checker` in parallel (`isolation: "worktree"`). Post findings to the PR before merge.
- [ ] **Twin ritual after merge** (from `domains/devloop`): `npm run ritual:post-merge -- de-braighter/foundry#<pr>`.

## Live smoke (founder-gated; after `claude setup-token` + MCP reconnect)

The long-lived foundry MCP won't expose `foundry_dispatch` until the founder reconnects (`/mcp` → reconnect foundry). After `claude setup-token` + `export CLAUDE_CODE_OAUTH_TOKEN=…`:

- [ ] Start the daemon on a small NON-T2 frontier via the cockpit (or `foundry_dispatch action=start`). Confirm it spawns a worker that claims → builds → opens a PR.
- [ ] Confirm a T2 item HALTS at the founder ship gate (never auto-merges).
- [ ] Confirm the cockpit Stop button trips the kill switch (daemon exits at next poll).

## Self-Review notes (verified against ADR-278)

- **D-1** (`claude -p`, not Agent SDK): `buildClaudeArgs` → `-p` first; no SDK import anywhere. ✓
- **D-2** (autonomous daemon): `foundry-dispatchd` (Task 5) drains unattended. ✓
- **D-3** (foundry tool: daemon + `foundry_dispatch` start/stop/status, cockpit calls it): Tasks 5/6/7. ✓
- **D-4** (inherit ambient env; cwd = cluster root; never --bare): `spawnClaudeWorker` (`env: process.env`, `cwd: resolveClusterRoot`, no `--bare`). ✓
- **D-5** (cap + 429 backoff + tiered model): `DEFAULT_DISPATCH_CONFIG.cap=2`, `backoffDelayMs`, `modelForItem`. ✓
- **D-6** (all tiers dispatched; T2 build-then-gate-halt; daemon never merges/decides gates): tier-agnostic `planSpawnBatch`; no merge boundary in `DispatchLoopIO`; T2 halt is worker behaviour via `renderSessionPrompt`. ✓
- **dispatch-worker side-effect-free** (mirrors dispatch-review): Task 1 — no store op, descriptor only, acid proves no event appended. ✓
- **Kill switch + crash-recovery**: control file `shouldStop`; crash-recovery via the `foundry_next` frontier (item reappears) + `maxAttemptsPerItem` runaway guard. ✓
- **Kernel grows by ZERO**: nothing imports/extends `@de-braighter/substrate-*`; no new event type. ✓
