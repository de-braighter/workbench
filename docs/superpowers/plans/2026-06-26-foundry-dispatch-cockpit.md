# Foundry Dispatch Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the foundry cockpit's minimal headless-dispatch panel into a live control + observability surface — auto-polling status, daemon-published in-flight visibility, a full-config Start form, and a `dispatchd.log` tail — without touching the kernel or breaking the byte-stable static dashboard.

**Architecture:** The renderer (`src/dashboard/render.ts`) stays PURE; ALL I/O lives in `src/dashboard/server.ts`. A new read-only `GET /api/dispatch/status` returns a compact JSON view that a small client poll uses to patch only the panel DOM (no full-page reload). The daemon publishes its own in-flight item ids into the control file (`data/dispatchd.json`) on each heartbeat, so the cockpit shows exactly what its workers are on. Every dispatch artifact (HTML, CSS, JS) stays behind the existing `opts.interactive && opts.dispatch != null` gate so the static `npm run dashboard` output is unchanged.

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), Node `node:http`, Vitest, `tsx`. No new dependencies.

## Global Constraints

Every task's requirements implicitly include this section. Values copied verbatim from the spec (`docs/superpowers/specs/2026-06-26-foundry-dispatch-cockpit-design.md`).

- **Scope:** `domains/foundry` only. ZERO kernel change — no `@de-braighter/substrate-*` import, no new event type.
- **Pure renderer:** `render.ts` is a deterministic function of `(DerivedState, nowMs, opts)`. No `Date.now()`, no I/O inside it. All reads/folds/tails happen in `server.ts`.
- **Byte-stable static path:** dispatch HTML, CSS, and JS are emitted ONLY when `opts.interactive && opts.dispatch != null`. The static path must contain none of: `id="dispatch-panel"`, `__dispatchPoll`, `<!-- DISPATCH-STYLES -->`.
- **Localhost-only:** the server binds `127.0.0.1`. The new status route is GET + read-only (it never appends to the event log). Mutating routes keep the existing shape (POST-only, `MAX_BODY` → 413).
- **Exact default flip:** `DEFAULT_DISPATCH_CONFIG.permissionMode` changes from `'acceptEdits'` to `'bypassPermissions'`.
- **Run a single test file:** `npx vitest run test/<file>.test.ts`. Run one test: add `-t "<name>"`. Full gate: `npm run ci:local` (typecheck + coverage). Typecheck only: `npm run typecheck`.
- **Commit discipline:** `git add <explicit paths>` only — never `git add -A`. End each commit message body with the Co-Authored-By trailer shown in the steps.

---

### Task 1: Daemon log tail + shared log-path helper

**Files:**

- Create: `src/dispatch/logtail.ts`
- Modify: `src/dispatch/spawn.ts` (use the shared `dispatchLogPath` so writer + reader never drift)
- Test: `test/dispatch-logtail.test.ts`

**Interfaces:**

- Produces: `dispatchLogPath(dataDir: string): string`, `tailLines(text: string, n: number): string[]`, `readDispatchLogTail(dataDir: string, n: number): string[]`.

- [ ] **Step 1: Write the failing test**

Create `test/dispatch-logtail.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tailLines, readDispatchLogTail, dispatchLogPath } from '../src/dispatch/logtail.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } } });
function tmp(): string { const d = mkdtempSync(join(tmpdir(), 'logtail-')); dirs.push(d); return d; }

describe('tailLines', () => {
  it('returns [] for empty / whitespace-only input', () => {
    expect(tailLines('', 5)).toEqual([]);
    expect(tailLines('   \n\n  ', 5)).toEqual([]);
  });
  it('returns all lines when fewer than n', () => {
    expect(tailLines('a\nb\nc', 5)).toEqual(['a', 'b', 'c']);
  });
  it('returns the last n lines in order when more than n', () => {
    expect(tailLines('a\nb\nc\nd', 2)).toEqual(['c', 'd']);
  });
  it('strips trailing CR and drops blank lines', () => {
    expect(tailLines('a\r\n\r\nb\r\n', 5)).toEqual(['a', 'b']);
  });
  it('truncates a long line to 300 chars + ellipsis', () => {
    const [out] = tailLines('x'.repeat(500), 1);
    expect(out.length).toBe(301);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('readDispatchLogTail', () => {
  it('returns [] when the log file is absent', () => {
    expect(readDispatchLogTail(tmp(), 10)).toEqual([]);
  });
  it('reads the last n lines of an existing log', () => {
    const d = tmp();
    writeFileSync(dispatchLogPath(d), 'l1\nl2\nl3\n', 'utf8');
    expect(readDispatchLogTail(d, 2)).toEqual(['l2', 'l3']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dispatch-logtail.test.ts`
Expected: FAIL — `Cannot find module '../src/dispatch/logtail.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/dispatch/logtail.ts`:

```ts
// Reading the daemon's own log (data/dispatchd.log) for the cockpit "eyes on a drain" tail.
// Pure parse (tailLines) + thin best-effort I/O (readDispatchLogTail). The path helper is
// shared with the daemon launcher (spawn.ts) so the writer and reader can never drift on the
// filename. Observability is best-effort: a read error degrades to [] and never breaks render.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The daemon's append-only log path under a data dir (writer: spawnDispatchDaemon). */
export function dispatchLogPath(dataDir: string): string {
  return join(dataDir, 'dispatchd.log');
}

/** Pure: the last `n` non-empty lines of `text`, in original order, each stripped of a
 *  trailing CR (Windows) and truncated to 300 chars + ellipsis so one chatty line can't
 *  bloat the JSON payload. Empty / whitespace-only input → []. */
export function tailLines(text: string, n: number): string[] {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim().length > 0);
  return lines
    .slice(Math.max(0, lines.length - n))
    .map((l) => (l.length > 300 ? l.slice(0, 300) + '…' : l));
}

/** Read the last `n` lines of the daemon log under `dataDir`. Missing file or read error
 *  → [] (the daemon never ran / no output yet, or a transient read race). */
export function readDispatchLogTail(dataDir: string, n: number): string[] {
  const p = dispatchLogPath(dataDir);
  if (!existsSync(p)) return [];
  try {
    return tailLines(readFileSync(p, 'utf8'), n);
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/dispatch-logtail.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Point the daemon launcher at the shared helper**

In `src/dispatch/spawn.ts`, add the import near the other dispatch imports (after the `import type { SpawnDaemon } from './control.js';` line):

```ts
import { dispatchLogPath } from './logtail.js';
```

Then in `spawnDispatchDaemon`, replace this line:

```ts
  const logPath = join(root, 'data', 'dispatchd.log');
```

with:

```ts
  const logPath = dispatchLogPath(join(root, 'data'));
```

(Leave the surrounding `mkdirSync(dirname(logPath), …)` and the `openSync` as-is — `join` is still imported and used.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/dispatch/logtail.ts src/dispatch/spawn.ts test/dispatch-logtail.test.ts
git commit -m "$(cat <<'EOF'
feat(dispatch): daemon log tail + shared dispatchLogPath (ADR-278 cockpit)

tailLines (pure) + readDispatchLogTail for the cockpit "eyes on a drain" view;
spawnDispatchDaemon now writes via the shared dispatchLogPath so the log writer
and the tail reader can never drift on the filename.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Control file carries the in-flight set; status surfaces uptime + in-flight

**Files:**

- Modify: `src/dispatch/control.ts`
- Test: `test/dispatch-control.test.ts` (append two cases)

**Interfaces:**

- Consumes: nothing new.
- Produces: `DispatchControlState.inFlight?: string[]`; `DispatchStatusView.inFlight?: string[]` and `.uptimeSeconds?: number`; `makeHeartbeat(dataDir, now)` now returns `(inFlight?: readonly string[]) => void`.

- [ ] **Step 1: Write the failing tests**

Append to `test/dispatch-control.test.ts`, inside the existing file (after the `describe('makeHeartbeat', …)` block — it already imports `makeHeartbeat`, `writeControl`, `readControl`, `dispatchStatus`, `DEFAULT_DISPATCH_CONFIG`, and `T0`):

```ts
describe('inFlight + uptime', () => {
  it('makeHeartbeat writes the in-flight item ids when provided', () => {
    const d = tmp();
    writeControl(d, { status: 'running', config: DEFAULT_DISPATCH_CONFIG, startedAt: T0, heartbeatAt: T0 });
    makeHeartbeat(d, () => '2026-06-26T12:05:00.000Z')(['exercir-321', 'gd/debt-a11y']);
    const c = readControl(d);
    expect(c?.inFlight).toEqual(['exercir-321', 'gd/debt-a11y']);
    expect(c?.heartbeatAt).toBe('2026-06-26T12:05:00.000Z');
  });
  it('dispatchStatus surfaces uptimeSeconds and inFlight', () => {
    const d = tmp();
    writeControl(d, { status: 'running', config: DEFAULT_DISPATCH_CONFIG, startedAt: T0, heartbeatAt: T0, inFlight: ['exercir-321'] });
    const v = dispatchStatus({ dataDir: d }, Date.parse(T0) + 60000);
    expect(v.uptimeSeconds).toBe(60);
    expect(v.inFlight).toEqual(['exercir-321']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/dispatch-control.test.ts`
Expected: FAIL — the new cases fail (`inFlight` is `undefined`; `uptimeSeconds` is `undefined`). The existing cases still pass.

- [ ] **Step 3: Extend the control state + status view types**

In `src/dispatch/control.ts`, replace the `DispatchControlState` interface with:

```ts
export interface DispatchControlState {
  status: 'running' | 'stopped';
  pid?: number;
  startedAt?: string;
  heartbeatAt?: string;
  /** ADR-278 cockpit: the daemon's currently-spawned worker item ids, refreshed each heartbeat. */
  inFlight?: string[];
  config: DispatchConfig;
}
```

and replace the `DispatchStatusView` interface with:

```ts
export interface DispatchStatusView {
  status: 'running' | 'stopped' | 'crashed' | 'never-started';
  healthy: boolean;
  pid?: number;
  startedAt?: string;
  heartbeatAt?: string;
  staleSeconds?: number;
  /** now - startedAt, in seconds (cockpit "up 14m"). */
  uptimeSeconds?: number;
  /** The daemon's published in-flight item ids (frozen at the last heartbeat when not running). */
  inFlight?: string[];
  config?: DispatchConfig;
}
```

- [ ] **Step 4: Make `makeHeartbeat` carry the in-flight ids**

Replace the existing `makeHeartbeat` function with:

```ts
/** The loop's heartbeat boundary: stamp heartbeatAt (and the current in-flight item ids when
 *  provided), preserving status/config. inFlight is OPTIONAL — a no-arg call only refreshes
 *  the timestamp, leaving any existing inFlight untouched. */
export function makeHeartbeat(dataDir: string, now: () => string): (inFlight?: readonly string[]) => void {
  return (inFlight) => {
    const c = readControl(dataDir);
    if (c == null) return;
    writeControl(dataDir, {
      ...c,
      heartbeatAt: now(),
      ...(inFlight != null ? { inFlight: [...inFlight] } : {}),
    });
  };
}
```

- [ ] **Step 5: Surface `uptimeSeconds` + `inFlight` in `dispatchStatus`**

Replace the `dispatchStatus` function body's `staleSeconds`/`common` block. Specifically, in `dispatchStatus`, after the `const staleSeconds = …` line, add the uptime line and extend `common`:

```ts
  const staleSeconds = c.heartbeatAt != null ? Math.max(0, Math.round((nowMs - Date.parse(c.heartbeatAt)) / 1000)) : undefined;
  const uptimeSeconds = c.startedAt != null ? Math.max(0, Math.round((nowMs - Date.parse(c.startedAt)) / 1000)) : undefined;
  const common = {
    ...(c.pid != null ? { pid: c.pid } : {}),
    ...(c.startedAt != null ? { startedAt: c.startedAt } : {}),
    ...(c.heartbeatAt != null ? { heartbeatAt: c.heartbeatAt } : {}),
    ...(staleSeconds != null ? { staleSeconds } : {}),
    ...(uptimeSeconds != null ? { uptimeSeconds } : {}),
    ...(c.inFlight != null ? { inFlight: c.inFlight } : {}),
    config: c.config,
  };
```

(Leave the three `if (c.status …)` return lines below `common` unchanged.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/dispatch-control.test.ts`
Expected: PASS — all cases, including the existing `makeHeartbeat` / `dispatchStatus` ones (the no-arg `makeHeartbeat(d, now)()` call still works because `inFlight` is optional and, when omitted, no `inFlight` key is written).

- [ ] **Step 7: Commit**

```bash
git add src/dispatch/control.ts test/dispatch-control.test.ts
git commit -m "$(cat <<'EOF'
feat(dispatch): control file carries in-flight set; status adds uptime (ADR-278)

DispatchControlState.inFlight + DispatchStatusView.{uptimeSeconds,inFlight};
makeHeartbeat optionally stamps the current worker item ids each heartbeat.
Additive + optional, so the MCP foundry_dispatch status action gains the richer
view with no breaking change.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Loop publishes the in-flight set each heartbeat; flip the permission default

**Files:**

- Modify: `src/dispatch/loop.ts`
- Test: `test/dispatch-loop.test.ts` (append cases)

**Interfaces:**

- Consumes: `makeHeartbeat`'s `(inFlight?) => void` (Task 2) via `cli.ts` wiring (already assignable — no `cli.ts` edit needed).
- Produces: `DispatchLoopIO.recordHeartbeat: (inFlight: readonly string[]) => void`; `DEFAULT_DISPATCH_CONFIG.permissionMode === 'bypassPermissions'`.

- [ ] **Step 1: Write the failing tests**

Append to `test/dispatch-loop.test.ts` (it already imports `runDispatchLoop`, `DEFAULT_DISPATCH_CONFIG`). Add these imports at the top if not present: `import type { DispatchLoopIO } from '../src/dispatch/loop.js';` and `import type { NextItem } from '../src/ops.js';`. Then append:

```ts
describe('heartbeat publishes in-flight + safe default', () => {
  it('records a heartbeat carrying the current in-flight item ids', async () => {
    const item = (id: string): NextItem => ({ itemId: id } as unknown as NextItem);
    const captured: string[][] = [];
    let calls = 0;
    const io: DispatchLoopIO = {
      readFrontier: () => [item('a')],
      // never-resolving whenDone → 'a' stays in-flight across iterations
      spawnWorker: async () => ({ outcome: 'spawned', whenDone: new Promise<void>(() => {}) }),
      shouldStop: () => calls++ >= 2, // allow two full iterations, then stop
      recordHeartbeat: (ids) => { captured.push([...ids]); },
      backoff: async () => {},
      sleep: async () => {},
      config: { ...DEFAULT_DISPATCH_CONFIG, cap: 1 },
    };
    await runDispatchLoop(io);
    // iteration 1 heartbeat sees []; after spawning 'a' it stays in-flight, so iteration 2's
    // heartbeat (taken before the kill-switch trips on iteration 3) records ['a'].
    expect(captured.some((ids) => ids.includes('a'))).toBe(true);
  });

  it('DEFAULT_DISPATCH_CONFIG.permissionMode is bypassPermissions (unattended-safe)', () => {
    expect(DEFAULT_DISPATCH_CONFIG.permissionMode).toBe('bypassPermissions');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/dispatch-loop.test.ts`
Expected: FAIL — the in-flight case fails (`recordHeartbeat` is called with no args today, so `ids` is `undefined` → `[...ids]` throws / captures nothing) and the default case fails (`'acceptEdits' !== 'bypassPermissions'`).

- [ ] **Step 3: Change the heartbeat boundary signature**

In `src/dispatch/loop.ts`, in the `DispatchLoopIO` interface, replace:

```ts
  /** Write a liveness heartbeat (control file). */
  recordHeartbeat: () => void;
```

with:

```ts
  /** Write a liveness heartbeat + publish the current in-flight item ids (control file). */
  recordHeartbeat: (inFlight: readonly string[]) => void;
```

- [ ] **Step 4: Pass the in-flight set at the call site**

In `runDispatchLoop`, replace the heartbeat call:

```ts
    io.recordHeartbeat();
```

with:

```ts
    io.recordHeartbeat([...inFlight]);
```

- [ ] **Step 5: Flip the permission default**

In `DEFAULT_DISPATCH_CONFIG`, replace:

```ts
  permissionMode: 'acceptEdits',
```

with:

```ts
  permissionMode: 'bypassPermissions',
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/dispatch-loop.test.ts`
Expected: PASS (existing cases still green — a `() => {}` mock is assignable to `(inFlight) => void`; the harness mocks ignore the new arg).

- [ ] **Step 7: Confirm no other test pinned the old default**

Run: `grep -rn "acceptEdits" src test`
Expected: exactly two hits in `test/dispatch-spawn.test.ts` — line ~11 (`buildClaudeArgs('opus', 'acceptEdits')`, an explicit pass-through arg) and the `--permission-mode acceptEdits` it asserts on that same call. Both test `buildClaudeArgs`'s pass-through with a literal, NOT the default, so they stay correct. The other spawn assertion uses `DEFAULT_DISPATCH_CONFIG.permissionMode` dynamically and auto-tracks the flip. **No edit needed.** If grep shows any assertion that the *default* equals `'acceptEdits'`, update it to `'bypassPermissions'`.

- [ ] **Step 8: Commit**

```bash
git add src/dispatch/loop.ts test/dispatch-loop.test.ts
git commit -m "$(cat <<'EOF'
feat(dispatch): loop publishes in-flight each heartbeat; default bypassPermissions

recordHeartbeat now carries the in-flight item ids so the cockpit shows exactly
what the daemon's workers are on. Flip DEFAULT_DISPATCH_CONFIG.permissionMode
acceptEdits->bypassPermissions: acceptEdits HANGS an unattended worker (allowlist
lacks git/npm/gh) — fixed at the source for the cockpit, the MCP tool, and any
omit-config caller.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Read-only `GET /api/dispatch/status` (enriched live view)

**Files:**

- Modify: `src/dashboard/server.ts`
- Test: `test/dispatch-cockpit.acid.test.ts` (append a describe block)

**Interfaces:**

- Consumes: `dispatchStatus` (already imported in `server.ts`), `readDispatchLogTail` (Task 1), `fold`/`readEnvelopes` (already imported).
- Produces: `GET /api/dispatch/status` → JSON `{ ...DispatchStatusView, inFlight: Array<{itemId,title?,riskTier?,productKey?}>, logTail: string[] }`.

- [ ] **Step 1: Write the failing test**

Append to `test/dispatch-cockpit.acid.test.ts`. Add `writeControl` + `DEFAULT_DISPATCH_CONFIG` to its imports (it already imports `readControl` from `../src/dispatch/control.js` and `startDashboardServer`). Update that import line to:

```ts
import { readControl, writeControl, type DispatchStatusView } from '../src/dispatch/control.js';
import { DEFAULT_DISPATCH_CONFIG } from '../src/dispatch/loop.js';
import { existsSync, readFileSync } from 'node:fs';
```

Then append:

```ts
describe('server — GET /api/dispatch/status (read-only live view)', () => {
  it('returns the enriched status JSON and never mutates the log', async () => {
    const d = tmp();
    const logPath = join(d, 'events.jsonl');
    // a fresh heartbeat (real clock) so status classifies 'running'; one published in-flight id
    const nowIso = new Date(Date.now()).toISOString();
    writeControl(d, { status: 'running', config: DEFAULT_DISPATCH_CONFIG, startedAt: nowIso, heartbeatAt: nowIso, inFlight: ['x-1'] });
    const before = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
    const { url, close } = await startDashboardServer({ dataDir: d, logPath }, { port: 0, spawnDaemon: () => undefined });
    try {
      const res = await fetch(`${url}/api/dispatch/status`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.status).toBe('running');
      expect(Array.isArray(body.inFlight)).toBe(true);
      expect(body.inFlight[0].itemId).toBe('x-1'); // id-only enrichment when not in the event log
      expect(Array.isArray(body.logTail)).toBe(true);
      const after = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '';
      expect(after).toBe(before); // READ-ONLY: the event log is byte-identical
    } finally {
      await close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dispatch-cockpit.acid.test.ts`
Expected: FAIL — `GET /api/dispatch/status` currently 404s, so `res.ok` is false.

- [ ] **Step 3: Add the read-only status route**

In `src/dashboard/server.ts`, add the import near the other dispatch imports:

```ts
import { readDispatchLogTail } from '../dispatch/logtail.js';
```

Then, inside the request handler, add this branch immediately BEFORE the final `res.writeHead(404, …)` fallback:

```ts
        if (req.method === 'GET' && req.url === '/api/dispatch/status') {
          // READ-ONLY live status for the cockpit poll (ADR-278 §D3). Localhost-only (the
          // server binding is the boundary). Folds the event log ONLY to enrich the daemon's
          // published in-flight ids with titles/tier/product — it NEVER appends. The renderer
          // stays pure; this endpoint assembles the compact JSON the client patches into the DOM.
          const now = Date.now();
          const view = dispatchStatus(deps, now);
          const s = fold(readEnvelopes(deps.logPath));
          const inFlight = (view.inFlight ?? []).map((itemId) => {
            const it = s.items.get(itemId);
            if (it == null) return { itemId };
            return { itemId, title: it.title, riskTier: s.products.get(it.productKey)?.riskTier, productKey: it.productKey };
          });
          const logTail = readDispatchLogTail(deps.dataDir, 40);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ...view, inFlight, logTail }));
          return;
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/dispatch-cockpit.acid.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.ts test/dispatch-cockpit.acid.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): read-only GET /api/dispatch/status for the cockpit poll (ADR-278)

Compact JSON: the dispatch status view + in-flight ids enriched (title/tier/
product) from the folded event log + the dispatchd.log tail. Localhost-only and
read-only (the event log is byte-identical before/after).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Rebuild `dispatchSection` — two-column body, Start form, gated styles

**Files:**

- Modify: `src/dashboard/render.ts` (replace `dispatchSection`; add `dispatchPanelBody`, `dispatchForm`, `dispatchStyles`)
- Test: `test/dispatch-cockpit.acid.test.ts` (extend render assertions)

**Interfaces:**

- Consumes: `opts.dispatch: DispatchStatusView`, the module-private `esc`.
- Produces: the panel markup the client mirror (Task 6) must match — element ids/classes `dispatch-panel`, `disp-grid`, `disp-left`, `disp-right`, `disp-inflight`, `disp-loglist`, `dispbtn start|stop`, `disp-form`, and the gated `<!-- DISPATCH-STYLES -->` marker.

- [ ] **Step 1: Write the failing tests**

In `test/dispatch-cockpit.acid.test.ts`, replace the existing `it('renders Start when never-started; Stop when running', …)` with a richer version and add a stopped-form case:

```ts
  it('renders Start (with form) when never-started; two-column Stop view when running', () => {
    const s = emptyState();
    const never: DispatchStatusView = { status: 'never-started', healthy: false };
    const htmlNever = renderFoundryDashboard(s, 0, { interactive: true, dispatch: never });
    expect(htmlNever).toContain('id="dispatch-panel"');
    expect(htmlNever).toContain('__dispatchToggleForm()');
    expect(htmlNever).toContain('class="disp-form"');
    expect(htmlNever).toContain('bypassPermissions'); // default selected in the permission-mode field
    expect(htmlNever).toContain('<!-- DISPATCH-STYLES -->');

    const running: DispatchStatusView = {
      status: 'running', healthy: true, pid: 42, uptimeSeconds: 840, staleSeconds: 3,
      inFlight: ['exercir-321'], config: { ...DEFAULT_DISPATCH_CONFIG, cap: 2 },
    };
    const htmlRunning = renderFoundryDashboard(s, 0, { interactive: true, dispatch: running });
    expect(htmlRunning).toContain('__dispatchStop()');
    expect(htmlRunning).toContain('class="disp-grid"');
    expect(htmlRunning).toContain('in flight (1)');
    expect(htmlRunning).toContain('exercir-321');
    expect(htmlRunning).toContain('recent log');
  });

  it('omits ALL dispatch artifacts on the static path (byte-clean)', () => {
    const html = renderFoundryDashboard(emptyState(), 0, {});
    expect(html).not.toContain('id="dispatch-panel"');
    expect(html).not.toContain('__dispatchPoll');
    expect(html).not.toContain('<!-- DISPATCH-STYLES -->');
  });
```

Add `DEFAULT_DISPATCH_CONFIG` to the test imports if not already present (Task 4 added it).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/dispatch-cockpit.acid.test.ts`
Expected: FAIL — today's panel has no `disp-grid` / `disp-form` / `<!-- DISPATCH-STYLES -->`.

- [ ] **Step 3: Replace `dispatchSection` and add the body/form/style helpers**

In `src/dashboard/render.ts`, replace the entire `dispatchSection` const (the block from the `// ---- dispatch cockpit panel …` comment through the closing `};`) with:

```ts
  // ---- dispatch cockpit panel (ADR-278 §D3) — interactive-only, byte-stable static ----
  // Two-column control + observability surface. STRICTLY gated on opts.interactive &&
  // opts.dispatch != null — never emitted on the static written-to-file path (byte-identical).
  // The server-rendered body and the client mirror (__dispatchRenderPanel in dispatchScript)
  // MUST stay structurally identical: same classes, same shape. Render tests + the live smoke
  // catch drift.
  const fmtDur = (sec: number | undefined): string => {
    if (sec == null) return '';
    if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    if (sec >= 60) return `${Math.floor(sec / 60)}m`;
    return `${sec}s`;
  };
  const dispatchForm = (cfg: DispatchStatusView['config']): string => {
    const c = cfg ?? DEFAULT_DISPATCH_CONFIG_FOR_FORM;
    const opt = (v: string, sel: string): string => `<option value="${esc(v)}"${v === sel ? ' selected' : ''}>${esc(v)}</option>`;
    const modes = ['bypassPermissions', 'acceptEdits', 'default', 'plan'];
    return `<div class="disp-form" id="disp-form" hidden>
      <label>cap <input id="disp-f-cap" type="number" min="1" value="${esc(String(c.cap))}"></label>
      <label>cheap model <input id="disp-f-cheap" type="text" value="${esc(c.models.cheap)}"></label>
      <label>capable model <input id="disp-f-capable" type="text" value="${esc(c.models.capable)}"></label>
      <label>permission mode <select id="disp-f-perm">${modes.map((m) => opt(m, c.permissionMode)).join('')}</select></label>
      <button type="button" class="disp-advtoggle" onclick="__dispatchToggleAdvanced()">▸ advanced</button>
      <div class="disp-adv" id="disp-adv" hidden>
        <label>pollIntervalMs <input id="disp-f-poll" type="number" min="1" value="${esc(String(c.pollIntervalMs))}"></label>
        <label>backoffBaseMs <input id="disp-f-bbase" type="number" min="1" value="${esc(String(c.backoffBaseMs))}"></label>
        <label>backoffMaxMs <input id="disp-f-bmax" type="number" min="1" value="${esc(String(c.backoffMaxMs))}"></label>
        <label>maxAttemptsPerItem <input id="disp-f-attempts" type="number" min="1" value="${esc(String(c.maxAttemptsPerItem))}"></label>
        <label>workerTimeoutMs <input id="disp-f-timeout" type="number" min="1" value="${esc(String(c.workerTimeoutMs))}"></label>
      </div>
      <button type="button" class="dispbtn start" onclick="__dispatchStart()">Start daemon</button>
    </div>`;
  };
  const dispatchPanelBody = (dsp: DispatchStatusView): string => {
    const running = dsp.status === 'running';
    const color = running ? '#22c55e' : dsp.status === 'crashed' ? '#ef4444' : '#6b7280';
    const meta: string[] = [];
    if (dsp.uptimeSeconds != null) meta.push(`up ${esc(fmtDur(dsp.uptimeSeconds))}`);
    if (dsp.staleSeconds != null) meta.push(`♥ ${esc(String(dsp.staleSeconds))}s ago`);
    if (dsp.pid != null) meta.push(`pid ${esc(String(dsp.pid))}`);
    const cfg = dsp.config;
    const cfgLine = cfg ? `cap ${esc(String(cfg.cap))} · ${esc(cfg.models.cheap)}/${esc(cfg.models.capable)} · ${esc(cfg.permissionMode)}` : '';
    const control = running
      ? `<button class="dispbtn stop" onclick="__dispatchStop()">Stop daemon</button>`
      : `<button class="dispbtn start" onclick="__dispatchToggleForm()">Start daemon ▸</button>${dispatchForm(cfg)}`;
    const stale = !running;
    const inflightRows = (dsp.inFlight ?? []).map((id) => `<li><code class="id">${esc(id)}</code></li>`).join('');
    const left = `<div class="disp-left">
      <div class="disp-statline"><span class="dispstat" style="color:${color}">${esc(dsp.status)}</span></div>
      <div class="disp-meta">${meta.join(' · ')}</div>
      ${cfgLine ? `<div class="disp-cfg">${cfgLine}</div>` : ''}
      <div class="disp-controls">${control}</div>
    </div>`;
    const right = `<div class="disp-right">
      <div class="disp-inflight"><div class="disp-h">in flight (${esc(String((dsp.inFlight ?? []).length))})${stale ? ' <span class="muted">· as of last heartbeat</span>' : ''}</div><ul class="disp-list">${inflightRows}</ul></div>
      <div class="disp-log"><div class="disp-h">recent log</div><ul class="disp-loglist"></ul></div>
    </div>`;
    return `<div class="disp-grid">${left}${right}</div>`;
  };
  const dispatchSection = (): string => {
    if (!opts?.interactive || opts.dispatch == null) return '';
    return `
  <!-- DISPATCH — the cockpit controls + observes foundry-dispatchd (ADR-278) -->
  <div class="section">
    <h2>headless dispatch · foundry-dispatchd</h2>
    <div class="panel" id="dispatch-panel">${dispatchPanelBody(opts.dispatch)}</div>
  </div>
  ${dispatchStyles}`;
  };
```

- [ ] **Step 4: Add the `DEFAULT_DISPATCH_CONFIG_FOR_FORM` import and the `dispatchStyles` const**

`dispatchForm` references `DEFAULT_DISPATCH_CONFIG_FOR_FORM` for the never-started case (no config yet). Add this import alias near the top of `render.ts` (with the other imports):

```ts
import { DEFAULT_DISPATCH_CONFIG as DEFAULT_DISPATCH_CONFIG_FOR_FORM } from '../dispatch/loop.js';
```

Then add the gated `dispatchStyles` const next to `dispatchScript` (just above the `return \`<!DOCTYPE html>…\`` block, alongside the other gated consts). The `<!-- DISPATCH-STYLES -->` marker keeps the static path detectably clean:

```ts
  // Gated dispatch styles — '' on the static path so the static dashboard carries NO dispatch
  // CSS (byte-identical). A <style> in <body> is valid HTML5 and mirrors the gated <script>.
  const dispatchStyles = opts?.interactive && opts.dispatch != null
    ? `<style>
  /* DISPATCH-STYLES */
  #dispatch-panel .disp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  #dispatch-panel .disp-statline { margin-bottom: 6px; }
  #dispatch-panel .dispstat { font-weight: 700; text-transform: uppercase; letter-spacing: .5px; font-size: 13px; }
  #dispatch-panel .disp-meta { color: #8b94a3; font-size: 12px; margin-bottom: 4px; }
  #dispatch-panel .disp-cfg { color: #6b7280; font-size: 11.5px; font-family: "SF Mono", Consolas, monospace; margin-bottom: 10px; }
  #dispatch-panel .disp-h { font-size: 10.5px; text-transform: uppercase; letter-spacing: .7px; color: #7a8494; margin: 4px 0 6px; }
  #dispatch-panel ul.disp-list, #dispatch-panel ul.disp-loglist { list-style: none; margin: 0 0 10px; padding: 0; }
  #dispatch-panel ul.disp-list li { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  #dispatch-panel ul.disp-loglist li { font-family: "SF Mono", Consolas, monospace; font-size: 11px; color: #9aa4b2; padding: 2px 0; white-space: pre-wrap; word-break: break-all; }
  #dispatch-panel .tier { font-size: 10px; color: #5eead4; background: #0e2a24; border-radius: 4px; padding: 1px 6px; }
  #dispatch-panel .dispbtn { font: inherit; font-size: 12px; font-weight: 600; cursor: pointer; border: none; border-radius: 6px; padding: 6px 13px; margin-top: 8px; }
  #dispatch-panel .dispbtn.start { background: #2dd4bf; color: #04201c; }
  #dispatch-panel .dispbtn.stop { background: #ef4444; color: #1a0707; }
  #dispatch-panel .disp-form { margin-top: 10px; display: flex; flex-direction: column; gap: 7px; }
  #dispatch-panel .disp-form label { display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 12px; color: #cbd2dd; }
  #dispatch-panel .disp-form input, #dispatch-panel .disp-form select { background: #0a0c10; color: #e6e9ef; border: 1px solid #1e2430; border-radius: 5px; padding: 4px 7px; font: inherit; font-size: 12px; width: 160px; }
  #dispatch-panel .disp-advtoggle { background: none; border: none; color: #5eead4; cursor: pointer; font: inherit; font-size: 12px; text-align: left; padding: 0; }
  #dispatch-panel .disp-adv { display: flex; flex-direction: column; gap: 7px; padding-left: 8px; border-left: 2px solid #1e2430; }
  #dispatch-panel .disp-reconnect { color: #f59e0b; font-size: 11px; }
</style>`
    : '';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/dispatch-cockpit.acid.test.ts`
Expected: PASS — running view has `disp-grid` + `in flight (1)` + `exercir-321` + `recent log`; never-started has the form with `bypassPermissions`; static path byte-clean.

- [ ] **Step 6: Confirm determinism + the full dashboard suite still pass**

Run: `npx vitest run test/dashboard.acid.test.ts test/dispatch-cockpit.acid.test.ts`
Expected: PASS — including the `(g1)` determinism test (the panel body is a pure function of `opts.dispatch`; no clock/random).

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/render.ts test/dispatch-cockpit.acid.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): two-column dispatch panel + Start form + gated styles (ADR-278)

Server-rendered two-column running view (status/config/Stop left; in-flight + log
right) and a stopped-state Start form exposing the full DispatchConfig (advanced
knobs collapsed; permissionMode defaults to bypassPermissions). New gated
dispatchStyles block keeps the static dashboard byte-clean (no dispatch CSS).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Make the panel live — poll, DOM-patch, form submit

**Files:**

- Modify: `src/dashboard/render.ts` (replace the `dispatchScript` const)
- Test: `test/dispatch-cockpit.acid.test.ts` (assert script markers present interactive / absent static)

**Interfaces:**

- Consumes: `GET /api/dispatch/status` (Task 4), the panel classes/ids from Task 5.
- Produces: client globals `__dispatchPoll`, `__dispatchRenderPanel`, `__dispatchStart`, `__dispatchStop`, `__dispatchToggleForm`, `__dispatchToggleAdvanced`.

- [ ] **Step 1: Write the failing tests**

Append to `test/dispatch-cockpit.acid.test.ts`:

```ts
describe('dispatch script — gated live poll', () => {
  it('emits the poll + mirror render when interactive; nothing on the static path', () => {
    const s = emptyState();
    const running: DispatchStatusView = { status: 'running', healthy: true };
    const live = renderFoundryDashboard(s, 0, { interactive: true, dispatch: running });
    expect(live).toContain('__dispatchPoll');
    expect(live).toContain('__dispatchRenderPanel');
    expect(live).toContain("'/api/dispatch/status'");
    const staticHtml = renderFoundryDashboard(s, 0, {});
    expect(staticHtml).not.toContain('__dispatchPoll');
    expect(staticHtml).not.toContain('__dispatchRenderPanel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dispatch-cockpit.acid.test.ts -t "gated live poll"`
Expected: FAIL — `__dispatchPoll` / `__dispatchRenderPanel` not yet emitted.

- [ ] **Step 3: Replace the `dispatchScript` const**

In `src/dashboard/render.ts`, replace the entire `dispatchScript` const (the block from its `// The founder-click DISPATCH START/STOP action script …` comment through the closing `: '';`) with the version below. It keeps Start/Stop, adds the poll + mirror render + form submit, drops `location.reload()` in favor of an immediate poll, and guards against clobbering the form while the founder is typing:

```ts
  // The DISPATCH live-control script — rendered ONCE, only on the served (interactive)
  // dashboard AND only when opts.dispatch is present. Polls GET /api/dispatch/status (~3s) and
  // patches ONLY #dispatch-panel via __dispatchRenderPanel, which MUST mirror the server-side
  // dispatchPanelBody (Task 5) structurally. Omitted entirely (no <script>) on the static path
  // and on any interactive render without a dispatch view — output stays inert + byte-identical.
  const dispatchScript = opts?.interactive && opts.dispatch != null
    ? `<script>
  var __dispatchFormOpen = false;
  var __dispatchTimer = null;
  function __dispatchEsc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function __dispatchFmtDur(s){ if(s==null) return ''; if(s>=3600) return Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m'; if(s>=60) return Math.floor(s/60)+'m'; return s+'s'; }
  function __dispatchFormHtml(c){
    c = c || {};
    var models = c.models || {};
    var modes = ['bypassPermissions','acceptEdits','default','plan'];
    var perm = c.permissionMode || 'bypassPermissions';
    var opts = modes.map(function(m){ return '<option value="'+__dispatchEsc(m)+'"'+(m===perm?' selected':'')+'>'+__dispatchEsc(m)+'</option>'; }).join('');
    function num(id,v){ return '<label>'+id+' <input id="disp-f-'+id+'" type="number" min="1" value="'+__dispatchEsc(v==null?'':v)+'"></label>'; }
    return '<div class="disp-form" id="disp-form" hidden>'
      + '<label>cap <input id="disp-f-cap" type="number" min="1" value="'+__dispatchEsc(c.cap==null?'':c.cap)+'"></label>'
      + '<label>cheap model <input id="disp-f-cheap" type="text" value="'+__dispatchEsc(models.cheap==null?'':models.cheap)+'"></label>'
      + '<label>capable model <input id="disp-f-capable" type="text" value="'+__dispatchEsc(models.capable==null?'':models.capable)+'"></label>'
      + '<label>permission mode <select id="disp-f-perm">'+opts+'</select></label>'
      + '<button type="button" class="disp-advtoggle" onclick="__dispatchToggleAdvanced()">&#9656; advanced</button>'
      + '<div class="disp-adv" id="disp-adv" hidden>'
      + num('poll', c.pollIntervalMs) + num('bbase', c.backoffBaseMs) + num('bmax', c.backoffMaxMs)
      + num('attempts', c.maxAttemptsPerItem) + num('timeout', c.workerTimeoutMs)
      + '</div>'
      + '<button type="button" class="dispbtn start" onclick="__dispatchStart()">Start daemon</button>'
      + '</div>';
  }
  function __dispatchRenderPanel(v){
    var running = v.status === 'running';
    var color = running ? '#22c55e' : v.status === 'crashed' ? '#ef4444' : '#6b7280';
    var meta = [];
    if (v.uptimeSeconds != null) meta.push('up ' + __dispatchEsc(__dispatchFmtDur(v.uptimeSeconds)));
    if (v.staleSeconds != null) meta.push('&#9829; ' + __dispatchEsc(v.staleSeconds) + 's ago');
    if (v.pid != null) meta.push('pid ' + __dispatchEsc(v.pid));
    var cfg = v.config;
    var cfgLine = cfg ? 'cap ' + __dispatchEsc(cfg.cap) + ' &middot; ' + __dispatchEsc((cfg.models||{}).cheap) + '/' + __dispatchEsc((cfg.models||{}).capable) + ' &middot; ' + __dispatchEsc(cfg.permissionMode) : '';
    var control = running
      ? '<button class="dispbtn stop" onclick="__dispatchStop()">Stop daemon</button>'
      : '<button class="dispbtn start" onclick="__dispatchToggleForm()">Start daemon &#9656;</button>' + __dispatchFormHtml(cfg);
    var stale = !running;
    var inf = (v.inFlight || []).map(function(x){
      if (typeof x === 'string') return '<li><code class="id">' + __dispatchEsc(x) + '</code></li>';
      var tier = x.riskTier ? '<span class="tier">' + __dispatchEsc(x.riskTier) + '</span>' : '';
      var title = x.title ? '<span class="rtitle">' + __dispatchEsc(x.title) + '</span>' : '';
      return '<li><code class="id">' + __dispatchEsc(x.itemId) + '</code>' + tier + title + '</li>';
    }).join('');
    var log = (v.logTail || []).map(function(l){ return '<li>' + __dispatchEsc(l) + '</li>'; }).join('');
    var left = '<div class="disp-left"><div class="disp-statline"><span class="dispstat" style="color:' + color + '">' + __dispatchEsc(v.status) + '</span></div>'
      + '<div class="disp-meta">' + meta.join(' &middot; ') + '</div>'
      + (cfgLine ? '<div class="disp-cfg">' + cfgLine + '</div>' : '')
      + '<div class="disp-controls">' + control + '</div></div>';
    var right = '<div class="disp-right"><div class="disp-inflight"><div class="disp-h">in flight (' + ((v.inFlight || []).length) + ')'
      + (stale ? ' <span class="muted">&middot; as of last heartbeat</span>' : '') + '</div><ul class="disp-list">' + inf + '</ul></div>'
      + '<div class="disp-log"><div class="disp-h">recent log</div><ul class="disp-loglist">' + log + '</ul></div></div>';
    return '<div class="disp-grid">' + left + right + '</div>';
  }
  function __dispatchApply(v){
    // Don't clobber the panel while the founder is filling the Start form (no live data is
    // changing when stopped anyway). Resume re-rendering once the form is closed/submitted.
    if (__dispatchFormOpen) return;
    var panel = document.getElementById('dispatch-panel');
    if (panel) panel.innerHTML = __dispatchRenderPanel(v);
  }
  function __dispatchPoll(){
    fetch('/api/dispatch/status', { headers: { 'accept': 'application/json' } })
      .then(function(r){ return r.json(); })
      .then(function(v){ __dispatchApply(v); })
      .catch(function(){
        var m = document.getElementById('dispatch-panel');
        if (m && !__dispatchFormOpen) { var h = m.querySelector('.disp-meta'); if (h) h.insertAdjacentHTML('beforeend', ' <span class="disp-reconnect">&middot; reconnecting&hellip;</span>'); }
      });
  }
  function __dispatchToggleForm(){
    var f = document.getElementById('disp-form');
    if (!f) return;
    f.hidden = !f.hidden;
    __dispatchFormOpen = !f.hidden;
  }
  function __dispatchToggleAdvanced(){
    var a = document.getElementById('disp-adv');
    if (a) a.hidden = !a.hidden;
  }
  function __dispatchGatherConfig(){
    function n(id){ var el = document.getElementById('disp-f-' + id); if (!el || el.value === '') return undefined; var x = Number(el.value); return isNaN(x) ? undefined : x; }
    function t(id){ var el = document.getElementById('disp-f-' + id); return el && el.value !== '' ? el.value : undefined; }
    var cfg = {};
    var cap = n('cap'); if (cap != null) cfg.cap = cap;
    var cheap = t('cheap'); var capable = t('capable');
    if (cheap != null && capable != null) cfg.models = { cheap: cheap, capable: capable };
    var perm = (document.getElementById('disp-f-perm') || {}).value; if (perm) cfg.permissionMode = perm;
    var poll = n('poll'); if (poll != null) cfg.pollIntervalMs = poll;
    var bbase = n('bbase'); if (bbase != null) cfg.backoffBaseMs = bbase;
    var bmax = n('bmax'); if (bmax != null) cfg.backoffMaxMs = bmax;
    var att = n('attempts'); if (att != null) cfg.maxAttemptsPerItem = att;
    var to = n('timeout'); if (to != null) cfg.workerTimeoutMs = to;
    return cfg;
  }
  function __dispatchStart(){
    var cfg = __dispatchGatherConfig();
    if (!confirm('Start foundry-dispatchd? It spawns headless claude -p workers over the claimable frontier (up to the cap). T2 items build then HALT at the founder ship gate.')) return;
    __dispatchFormOpen = false;
    fetch('/api/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', config: cfg }) })
      .then(async function(res){ if (res.ok) { __dispatchPoll(); } else { alert('failed: ' + await res.text()); } })
      .catch(function(e){ alert('failed: ' + e); });
  }
  function __dispatchStop(){
    if (!confirm('Stop foundry-dispatchd? The daemon exits at its next poll; in-flight workers finish on their own.')) return;
    fetch('/api/dispatch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) })
      .then(async function(res){ if (res.ok) { __dispatchPoll(); } else { alert('failed: ' + await res.text()); } })
      .catch(function(e){ alert('failed: ' + e); });
  }
  __dispatchTimer = setInterval(__dispatchPoll, 3000);
</script>`
    : '';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/dispatch-cockpit.acid.test.ts`
Expected: PASS — including the static-path byte-clean assertions (`__dispatchPoll` / `__dispatchRenderPanel` absent).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/render.ts test/dispatch-cockpit.acid.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): live poll + DOM-patch + Start-form submit for the cockpit (ADR-278)

setInterval polls GET /api/dispatch/status (~3s) and patches only #dispatch-panel
via __dispatchRenderPanel (mirrors the server body). Start gathers the full config
from the form; Start/Stop drop location.reload() for an immediate poll. A
form-open guard prevents the poll from clobbering the founder's input. Gated:
nothing emitted on the static path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Full-battery verification + live smoke

**Files:** none (verification gate).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — the whole foundry suite, including `dashboard.acid.test.ts`, `dispatch-*.test.ts`, `dispatch-cockpit.acid.test.ts`.

- [ ] **Step 2: Run the gate (typecheck + coverage)**

Run: `npm run ci:local`
Expected: typecheck clean; coverage run green.

- [ ] **Step 3: Confirm the static dashboard is unchanged (byte-stable)**

Run: `npm run dashboard > /tmp/dash-after.html && grep -c "dispatch-panel" /tmp/dash-after.html`
Expected: `0` — the static path carries no dispatch artifact. (On Windows shells without `/tmp`, write to `./dash-after.html` and delete it after; do NOT commit it.)

- [ ] **Step 4: Live smoke (manual, recommended)**

Run: `npm run dashboard:serve` then open `http://127.0.0.1:4555`.
Verify: the panel shows the stopped/never-started state with `[ Start daemon ▸ ]`; clicking it reveals the form (permission mode defaulted to `bypassPermissions`, advanced collapsed). With a claimable item in `foundry_next` and `cap=1`, Start spawns a worker; the panel auto-updates (status → running, ♥ ticking, `in flight (1)` with the item, log lines appearing) WITHOUT a reload; Stop trips the kill switch and the in-flight list greys with "as of last heartbeat". Stop the server with Ctrl-C.

- [ ] **Step 5: Final no-op commit guard**

Run: `git status --short`
Expected: clean (all changes already committed across Tasks 1–6). If `dash-after.html` exists, delete it.

---

## Self-Review

**Spec coverage** (against `2026-06-26-foundry-dispatch-cockpit-design.md`):

- §3 D1 four directions → Task 4 (status endpoint feeds live status + log tail), Task 2/3 (in-flight), Task 5/6 (panel + form). ✓
- §3 D2 GET status + DOM patch → Task 4 + Task 6. ✓
- §3 D3 daemon publishes in-flight → Task 2 (`makeHeartbeat`) + Task 3 (loop passes ids). ✓
- §3 D4 flip shared default → Task 3 Step 5. ✓
- §3 D5 all eight knobs + advanced → Task 5 `dispatchForm` + Task 6 `__dispatchFormHtml`. ✓
- §3 D6 two-column layout → Task 5 `dispatchPanelBody`. ✓
- §3 D7 gated `<style>` → Task 5 `dispatchStyles`. ✓
- §3 D8 drop `location.reload()` → Task 6 (`__dispatchPoll` on success). ✓
- §4.3 response contract → Task 4. ✓
- §4.4 staleness honesty (grey when not running) → Task 5 `stale` note + Task 6 mirror. ✓
- §5 error handling (poll fail → reconnecting, no alert; missing log → []; torn control → never-started) → Task 6 `.catch`, Task 1 `readDispatchLogTail`, existing `dispatchStatus`. ✓
- §6 testing plan items 1–6 → Tasks 1–6 tests + Task 7. ✓

**Placeholder scan:** none — every step has complete code or an exact command + expected output.

**Type consistency:** `recordHeartbeat(inFlight)` (Task 3) consumes `makeHeartbeat`'s `(inFlight?) => void` (Task 2) — assignable. `DispatchStatusView.inFlight: string[]` (control) is enriched to objects ONLY in the endpoint payload (Task 4) and the client tolerates both string and object forms (Task 6 `__dispatchRenderPanel`). Server `dispatchPanelBody` (Task 5) and client `__dispatchRenderPanel` (Task 6) emit the same classes (`disp-grid`/`disp-left`/`disp-right`/`disp-inflight`/`disp-loglist`/`dispbtn start|stop`).

## Dogfood note

This plan is authored to be **worker-executable** and is intended to be embedded into a single **T2, cap=1** `foundry_queue_push` item so `foundry-dispatchd` builds its own cockpit. The worker runs Tasks 1–7 in order (TDD), runs its tier-gated verifier wave, and opens a PR that HALTS at the founder ship gate. See spec §7.
