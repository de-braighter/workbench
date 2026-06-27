# ADR-282 Follow-ups: cockpit health badge + threshold calibration + read-surface divergence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three deferred ADR-282 follow-ups — threshold calibration, read-surface threshold divergence (item 3), and the cockpit health badge (item 1); route item 2(b) TOCTOU safety refinement through the founder architecture gate.

**Architecture:** Pure wiring over existing `health.ts` / `control.ts` / `progress.ts` primitives. No new event types. No kernel touch. All changes are dispatch-pack tooling only (the ADR-176 inclusion test is not triggered).

**Tech Stack:** TypeScript ESM (`.js` imports), vitest, Node http (no NestJS), `domains/foundry` repo.

## Global Constraints

- All imports use explicit `.js` extensions (e.g. `'../dispatch/health.js'`).
- Test files live in `test/` (NOT co-located `.spec.ts`); run with `npx vitest run test/<file>.test.ts`.
- Gate: `npm run ci:local` = `tsc -p tsconfig.json --noEmit && vitest run --coverage`. Must be green before PR.
- `src/dispatch/cli.ts` is coverage-excluded (trusted I/O boot) — keep testable logic in covered modules.
- ADR-176 hard constraint: zero new event types; nothing reaches `@de-braighter/substrate-*`; `runDispatchLoop` invariants (claims nothing, merges nothing) stay intact.
- Worktree: work on a FRESH branch off `origin/main` of `domains/foundry` (`git fetch origin main && git checkout -b feat/adr-282-followups`).
- PR body must carry `Producer: / Effort: standard / Effect: cycle-time`.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `src/dispatch/loop.ts` | Modify | Update `DEFAULT_DISPATCH_CONFIG` stall-watch threshold defaults |
| `src/dispatch/health.ts` | Modify | Update `DEFAULT_HEALTH_THRESHOLDS` to match calibrated values |
| `src/status.ts` | Modify | Add `thresholds?` to `statusText` opts, thread to `deriveDispatchHealth` |
| `src/mcp/tools.ts` | Modify | `foundry_status` + `foundry_dispatch health` read live config thresholds |
| `src/dashboard/server.ts` | Modify | `/api/dispatch/status` uses `deriveDispatchHealth`; add `health/claimId/branch/commits` to enriched rows; also pass live thresholds |
| `src/dashboard/render.ts` | Modify | `__dispatchRenderPanel` client JS renders health badge; add CSS to `dispatchStyles` |
| `test/dispatch-health.test.ts` | Modify | Verify tuned threshold defaults |
| `test/dispatch-mcp.test.ts` | Modify | `foundry_dispatch health` uses live config thresholds; `foundry_status` uses live thresholds |
| `test/dispatch-cockpit.acid.test.ts` | Modify | `/api/dispatch/status` returns `health` field; client JS contains badge rendering; static path byte-clean |
| `docs/adr-282-item2b-toctou-design-note.md` | Create | Designer-first note for the liveness-reaping TOCTOU safety; gates the behavior change |

---

### Task 1: Threshold calibration — update DEFAULT_HEALTH_THRESHOLDS and DEFAULT_DISPATCH_CONFIG

**Calibration evidence (from `data/events.jsonl` ClaimHeartbeat intervals):**

| Claim | Observed gaps | Note |
|---|---|---|
| agri/E1 | 17 min, 14 min, 17 min | normal run |
| agri/E2.1 | 9–15 min | normal run |
| agri/E4.1 | **24 min, 26 min**, 15 min, 12 min | longest observed normal |
| agri/E2.2 | 2h27 gap | interrupted session (outlier) |

Max observed live-worker quiet: **26 min**. Current `stalledAfterSeconds: 900` (15 min) false-positives at 17–26 min gaps. Current `deadAfterSeconds: 1800` (30 min) has only a 4-minute margin above the 26-min max.

Proposed tuned defaults:
- `slowAfterSeconds`: **600** (unchanged — correct for alive but not committing)
- `stalledAfterSeconds`: **1800** (30 min — above the 26-min max observed gap)
- `deadAfterSeconds`: **3600** (60 min — 2× stalled; safe margin for cross-run workers)

**Files:**
- Modify: `src/dispatch/loop.ts` (the `DEFAULT_DISPATCH_CONFIG` `slowAfterSeconds`/`stalledAfterSeconds`/`deadAfterSeconds` fields)
- Modify: `src/dispatch/health.ts` (the `DEFAULT_HEALTH_THRESHOLDS` object)
- Modify: `test/dispatch-health.test.ts` (tests that reference the old defaults by value)

**Interfaces:**
- No API change — the threshold fields already exist on both objects; this is a value update only.

- [ ] **Step 1: Update `DEFAULT_HEALTH_THRESHOLDS` in `src/dispatch/health.ts`**

Replace the existing `DEFAULT_HEALTH_THRESHOLDS` object:

```typescript
export const DEFAULT_HEALTH_THRESHOLDS: HealthThresholds = {
  slowAfterSeconds: 600,
  stalledAfterSeconds: 1800,  // was 900 — above the 26-min observed max gap
  deadAfterSeconds: 3600,     // was 1800 — 2× stalled, safe margin for cross-run
};
```

- [ ] **Step 2: Update `DEFAULT_DISPATCH_CONFIG` in `src/dispatch/loop.ts`**

The `slowAfterSeconds`, `stalledAfterSeconds`, `deadAfterSeconds` fields on `DEFAULT_DISPATCH_CONFIG` must match `DEFAULT_HEALTH_THRESHOLDS` (they're the source of truth for the daemon config):

```typescript
export const DEFAULT_DISPATCH_CONFIG: DispatchConfig = {
  // ... existing fields unchanged ...
  slowAfterSeconds: 600,
  stalledAfterSeconds: 1800,  // was 900
  deadAfterSeconds: 3600,     // was 1800
  autoRecoverEmptyOrphans: true,
};
```

- [ ] **Step 3: Update tests that use the old threshold values**

In `test/dispatch-health.test.ts`, the `runStallWatch` tests use `activeState(beatAgoSec)` with `beatAgoSec: 1000` to trigger `stalled` and `beatAgoSec: 2000` to trigger `dead`. After the threshold change, `1000s` is below the new `stalledAfterSeconds: 1800`, so the stalled test needs to use `beatAgoSec: 2000` for `stalled` and `beatAgoSec: 4000` for `dead`.

Find and update the test at `test/dispatch-health.test.ts`:
- Line with `it('heartbeat silent past stalledAfter...'` — change `heartbeatAgeSeconds: 1000` to `heartbeatAgeSeconds: 2000`
- Line with `it('heartbeat silent past deadAfter...'` — change `heartbeatAgeSeconds: 2000` to `heartbeatAgeSeconds: 4000`
- The `stalled` and `dead` runStallWatch tests use `activeState(1000)` (stalled) and `activeState(2000)` (dead) — change to `activeState(2000)` (stalled) and `activeState(4000)` (dead)
- The `dispatch-health.test.ts` `NOW` is 1h after `T0`; `activeState(beatAgoSec)` makes the heartbeat `beatAgoSec` seconds before `NOW`. So `activeState(4000)` gives `4000s > deadAfterSeconds 3600` → dead.
- The `T` constant imports `DEFAULT_HEALTH_THRESHOLDS as T` — this update automatically applies; no import change needed.

Run: `npx vitest run test/dispatch-health.test.ts`
Expected: All tests pass (the logic is unchanged; only values move).

- [ ] **Step 4: Run full ci:local**

```bash
npm run ci:local
```

Expected: green (1117+ tests, coverage ≥ prior, tsc clean).

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/health.ts src/dispatch/loop.ts test/dispatch-health.test.ts
git commit -m "feat(dispatch): calibrate stall-watch thresholds (stalled→30m dead→60m per heartbeat evidence)"
```

---

### Task 2: Read-surface threshold divergence — thread live config into foundry_status and foundry_dispatch health

**Problem:** `foundry_status` and `foundry_dispatch health` derive at `DEFAULT_HEALTH_THRESHOLDS` always, while the daemon acts on the live `DispatchConfig` thresholds from the control file. An operator who overrides thresholds sees a diverged verdict.

**Fix:** Read live config via `dispatchStatus(deps, now).config` (which already reads the control file) and pass the extracted thresholds to `statusText` / `deriveDispatchHealth`.

**Files:**
- Modify: `src/status.ts` — add `thresholds?: HealthThresholds` to the `opts` parameter type; it already flows to `deriveDispatchHealth`
- Modify: `src/mcp/tools.ts` — `foundry_status` and `foundry_dispatch health` cases read live config + pass thresholds
- Test: `test/dispatch-mcp.test.ts`

**Interfaces:**
- Consumes from Task 1: `HealthThresholds` (unchanged type) and calibrated defaults
- Produces: `statusText(s, now, { thresholds })` signature (same function, widened opts type)

- [ ] **Step 1: Write failing tests**

Add to `test/dispatch-mcp.test.ts`:

```typescript
import { writeControl } from '../src/dispatch/control.js';
import { DEFAULT_DISPATCH_CONFIG } from '../src/dispatch/loop.js';

// --- threshold divergence tests ---

describe('foundry_dispatch health — uses live config thresholds', () => {
  it('reads stalledAfterSeconds from the control file (not DEFAULT)', async () => {
    const d = tmp();
    const logPath = join(d, 'events.jsonl');
    const NOW_ISO = '2026-06-27T12:00:00.000Z';
    const T0 = '2026-06-27T11:00:00.000Z';
    // heartbeat 2100s before NOW — dead at default (3600) but NOT at custom 7200
    const hbAt = new Date(Date.parse(NOW_ISO) - 2100 * 1000).toISOString();
    append(itemQueued({ itemId: 'test/thresh-1', productKey: 'test', title: 'T', scope: { repo: 'r' }, ts: T0 }), logPath);
    append(claimAcquired({ claimId: 'tc-1', itemId: 'test/thresh-1', sessionId: 'ts-1', ts: T0 }), logPath);
    append(claimHeartbeat({ claimId: 'tc-1', itemId: 'test/thresh-1', sessionId: 'ts-1', ts: hbAt }), logPath);
    // Override deadAfterSeconds to 7200 (2h) in the control file
    writeControl(d, { ...DEFAULT_DISPATCH_CONFIG, status: 'running', config: { ...DEFAULT_DISPATCH_CONFIG, deadAfterSeconds: 7200 }, startedAt: T0, heartbeatAt: T0 } as never);
    const tools = makeTools({ dataDir: d, logPath, now: () => NOW_ISO }, { spawnDaemon: () => 1 });
    const res = await tools.foundry_dispatch({ action: 'health' });
    expect(res.isError).toBeFalsy();
    const rows = JSON.parse((res.content[0] as { text: string }).text);
    const row = rows[0];
    // 2100s < custom 7200 deadAfterSeconds → stalled (1800 default stalled < 2100); NOT dead
    expect(row.health).not.toBe('dead-empty');
    expect(row.health).not.toBe('dead-salvageable');
    expect(['stalled', 'slow', 'healthy']).toContain(row.health);
  });
});

describe('foundry_status — uses live config thresholds', () => {
  it('reads thresholds from control file (dead verdict shifts when stalledAfterSeconds overridden)', async () => {
    const d = tmp();
    const logPath = join(d, 'events.jsonl');
    const NOW_ISO = '2026-06-27T12:00:00.000Z';
    const T0 = '2026-06-27T11:00:00.000Z';
    // heartbeat 2100s before NOW — dead at default (3600) but stalled at custom stalledAfter=7200
    const hbAt = new Date(Date.parse(NOW_ISO) - 2100 * 1000).toISOString();
    append(itemQueued({ itemId: 'test/stat-thresh', productKey: 'test', title: 'T', scope: { repo: 'r' }, ts: T0 }), logPath);
    append(claimAcquired({ claimId: 'sc-1', itemId: 'test/stat-thresh', sessionId: 'ss-1', ts: T0 }), logPath);
    append(claimHeartbeat({ claimId: 'sc-1', itemId: 'test/stat-thresh', sessionId: 'ss-1', ts: hbAt }), logPath);
    // Override: set stalledAfterSeconds=7200 so 2100s doesn't even reach stalled
    writeControl(d, { status: 'running', config: { ...DEFAULT_DISPATCH_CONFIG, stalledAfterSeconds: 7200, deadAfterSeconds: 14400 }, startedAt: T0, heartbeatAt: T0 } as never);
    const tools = makeTools({ dataDir: d, logPath, now: () => NOW_ISO }, { spawnDaemon: () => 1 });
    const res = await tools.foundry_status({});
    expect(res.isError).toBeFalsy();
    const txt = (res.content[0] as { text: string }).text;
    // With live config, 2100s < stalledAfterSeconds:7200 → no STALL-WATCH entry (healthy)
    expect(txt).toContain('STALL-WATCH');
    expect(txt).toContain('all healthy');
  });
});
```

Run: `npx vitest run test/dispatch-mcp.test.ts`
Expected: FAIL (writeControl type mismatch is handled by cast; tests fail because live thresholds aren't read yet).

- [ ] **Step 2: Widen `statusText` opts in `src/status.ts`**

Find the function signature:
```typescript
export function statusText(s: DerivedState, nowIso: string, opts: { run?: GitRun; readFile?: ReadFile } = {}): string {
```

Change to:
```typescript
import type { HealthThresholds } from './dispatch/health.js';

export function statusText(s: DerivedState, nowIso: string, opts: { run?: GitRun; readFile?: ReadFile; thresholds?: HealthThresholds } = {}): string {
```

The existing `const healthRows = deriveDispatchHealth(s, nowMs, opts);` already passes opts through, and `deriveDispatchHealth` accepts `thresholds?` in its opts. No further change to statusText body needed.

- [ ] **Step 3: Thread live thresholds in `src/mcp/tools.ts` — `foundry_status` case**

Locate the `foundry_status` entry in `makeTools`:

```typescript
foundry_status: guard((_a: Record<string, never>) => statusText(fold(readEnvelopes(deps.logPath)), nowIso())),
```

Replace with:

```typescript
foundry_status: guard((_a: Record<string, never>) => {
  const s = fold(readEnvelopes(deps.logPath));
  const now = nowIso();
  const view = dispatchStatus(deps, Date.parse(now));
  const thresholds = view.config != null ? {
    slowAfterSeconds: view.config.slowAfterSeconds,
    stalledAfterSeconds: view.config.stalledAfterSeconds,
    deadAfterSeconds: view.config.deadAfterSeconds,
  } : undefined;
  return statusText(s, now, { thresholds });
}),
```

`dispatchStatus` is already imported in `tools.ts` from `'../dispatch/control.js'`. No new import needed.

- [ ] **Step 4: Thread live thresholds in `src/mcp/tools.ts` — `foundry_dispatch health` case**

Locate:
```typescript
case 'health': return deriveDispatchHealth(fold(readEnvelopes(deps.logPath)), Date.parse(nowIso()));
```

Replace with:
```typescript
case 'health': {
  const s = fold(readEnvelopes(deps.logPath));
  const now = Date.parse(nowIso());
  const view = dispatchStatus(deps, now);
  const thresholds = view.config != null ? {
    slowAfterSeconds: view.config.slowAfterSeconds,
    stalledAfterSeconds: view.config.stalledAfterSeconds,
    deadAfterSeconds: view.config.deadAfterSeconds,
  } : undefined;
  return deriveDispatchHealth(s, now, { thresholds });
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run test/dispatch-mcp.test.ts
```

Expected: All pass including the two new threshold-divergence tests.

- [ ] **Step 6: Run full ci:local and commit**

```bash
npm run ci:local
```

Expected: green.

```bash
git add src/status.ts src/mcp/tools.ts test/dispatch-mcp.test.ts
git commit -m "feat(dispatch): thread live config thresholds into foundry_status + foundry_dispatch health (item 3)"
```

---

### Task 3: Cockpit health badge — server enrichment in `/api/dispatch/status`

**Problem:** The `/api/dispatch/status` JSON uses `deriveDispatchProgress` which doesn't include the `health` verdict. Switching to `deriveDispatchHealth` adds `health`, `claimId`, `branch`, and `commitsSinceClaim` to each enriched in-flight row at zero extra cost (it wraps `deriveDispatchProgress` internally).

**Also:** pass live thresholds from `view.config` to `deriveDispatchHealth` so the cockpit's health display matches the daemon's action thresholds.

**Files:**
- Modify: `src/dashboard/server.ts`
- Test: `test/dispatch-cockpit.acid.test.ts` (extend the `cockpit in-flight row — progress fields` describe block)

**Interfaces:**
- Consumes: `DispatchHealthRow` (extends `DispatchProgressRow` — superset) from `src/dispatch/health.js`
- Produces: enriched in-flight row objects with `{ itemId, title?, riskTier?, productKey?, taskN?, tasksTotal?, lastCommitSubject?, heartbeatAgeSeconds?, health?, claimId?, branch?, commits? }`

- [ ] **Step 1: Write failing test**

Add to `test/dispatch-cockpit.acid.test.ts` inside the `'cockpit in-flight row — progress fields'` describe block, after the existing test:

```typescript
it('GET /api/dispatch/status includes health field on enriched in-flight items', async () => {
  const d = tmp();
  const logPath = join(d, 'events.jsonl');
  const nowIso = new Date(Date.now()).toISOString();
  // Seed: queue + claim + stale heartbeat (2100s ago → stalled or dead per calibrated thresholds)
  const staleHb = new Date(Date.now() - 2100 * 1000).toISOString();
  append(itemQueued({ itemId: 'hb-item', productKey: 'p', title: 'Health badge test', scope: { repo: 'r' }, ts: nowIso }), logPath);
  append(claimAcquired({ claimId: 'hb-c1', itemId: 'hb-item', sessionId: 'hb-s1', ts: nowIso }), logPath);
  append(claimHeartbeat({ claimId: 'hb-c1', itemId: 'hb-item', sessionId: 'hb-s1', ts: staleHb }), logPath);
  writeControl(d, { status: 'running', config: DEFAULT_DISPATCH_CONFIG, startedAt: nowIso, heartbeatAt: nowIso, inFlight: ['hb-item'] });
  const { url, close } = await startDashboardServer({ dataDir: d, logPath }, { port: 0, spawnDaemon: () => undefined });
  try {
    const body = await (await fetch(`${url}/api/dispatch/status`)).json();
    const row = body.inFlight.find((x: { itemId: string }) => x.itemId === 'hb-item');
    expect(row).toBeTruthy();
    expect(row).toHaveProperty('health');
    expect(['healthy', 'slow', 'stalled', 'dead-empty', 'dead-salvageable']).toContain(row.health);
    expect(row).toHaveProperty('claimId', 'hb-c1');
  } finally { await close(); }
});
```

Run: `npx vitest run test/dispatch-cockpit.acid.test.ts`
Expected: FAIL (`health` and `claimId` absent from response).

- [ ] **Step 2: Update server.ts `/api/dispatch/status` handler**

In `src/dashboard/server.ts`, find the `GET /api/dispatch/status` block (starting at `if (req.method === 'GET' && req.url === '/api/dispatch/status')`).

Current import at top of file:
```typescript
import { deriveDispatchProgress } from '../dispatch/progress.js';
```

Replace with:
```typescript
import { deriveDispatchHealth } from '../dispatch/health.js';
```

Inside the handler, replace:
```typescript
const progress = deriveDispatchProgress(s, now, { itemIds: view.inFlight ?? [] });
const byId = new Map(progress.map((r) => [r.itemId, r]));
const inFlight = (view.inFlight ?? []).map((itemId) => {
  const it = s.items.get(itemId);
  const base = it == null ? { itemId } : { itemId, title: it.title, riskTier: s.products.get(it.productKey)?.riskTier, productKey: it.productKey };
  const p = byId.get(itemId);
  return p == null ? base : { ...base, taskN: p.taskN, tasksTotal: p.tasksTotal, lastCommitSubject: p.lastCommitSubject, heartbeatAgeSeconds: p.heartbeatAgeSeconds };
});
```

With:
```typescript
const liveThresholds = view.config != null ? {
  slowAfterSeconds: view.config.slowAfterSeconds,
  stalledAfterSeconds: view.config.stalledAfterSeconds,
  deadAfterSeconds: view.config.deadAfterSeconds,
} : undefined;
const healthRows = deriveDispatchHealth(s, now, { itemIds: view.inFlight ?? [], thresholds: liveThresholds });
const byId = new Map(healthRows.map((r) => [r.itemId, r]));
const inFlight = (view.inFlight ?? []).map((itemId) => {
  const it = s.items.get(itemId);
  const base = it == null ? { itemId } : { itemId, title: it.title, riskTier: s.products.get(it.productKey)?.riskTier, productKey: it.productKey };
  const h = byId.get(itemId);
  return h == null ? base : {
    ...base,
    taskN: h.taskN,
    tasksTotal: h.tasksTotal,
    lastCommitSubject: h.lastCommitSubject,
    heartbeatAgeSeconds: h.heartbeatAgeSeconds,
    health: h.health,
    claimId: h.claimId,
    branch: h.branch,
    commits: h.commitsSinceClaim,
  };
});
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run test/dispatch-cockpit.acid.test.ts
```

Expected: All pass including the new health-enrichment test.

- [ ] **Step 4: Run full ci:local and commit**

```bash
npm run ci:local
```

Expected: green.

```bash
git add src/dashboard/server.ts test/dispatch-cockpit.acid.test.ts
git commit -m "feat(cockpit): /api/dispatch/status adds health/claimId/branch/commits to in-flight rows (item 1 server path)"
```

---

### Task 4: Cockpit health badge — client render in `__dispatchRenderPanel`

**Problem:** The in-flight panel's client-side `__dispatchRenderPanel` JS doesn't use the `health`, `claimId`, or `branch` fields added in Task 3. Add a health badge per row and a salvage hint for `dead-salvageable`.

**Pattern (mirrors the existing progress row):** health badge lives only in `__dispatchRenderPanel` (the client-side JS), not in server-side `dispatchPanelBody`. The badge appears after the first 3s poll. The static path (no dispatch panel) stays byte-identical.

**Files:**
- Modify: `src/dashboard/render.ts` — add health badge to `__dispatchRenderPanel`'s `inf` row template; add health CSS to `dispatchStyles`
- Test: `test/dispatch-cockpit.acid.test.ts`

**Interfaces:**
- Consumes from Task 3: `health?`, `claimId?`, `branch?`, `commits?` on each in-flight row object from the poll
- Produces: rendered `<span class="health-<verdict>">` and `<div class="health-salvage-hint">` in the DOM

- [ ] **Step 1: Write failing tests**

Add to `test/dispatch-cockpit.acid.test.ts`:

```typescript
describe('client health badge — __dispatchRenderPanel', () => {
  it('interactive render contains health badge CSS classes in dispatchStyles', () => {
    const s = emptyState();
    const running: DispatchStatusView = { status: 'running', healthy: true };
    const html = renderFoundryDashboard(s, 0, { interactive: true, dispatch: running });
    // Health badge CSS must be present inside the gated dispatch styles
    expect(html).toContain('health-dead-salvageable');
    expect(html).toContain('health-salvage-hint');
  });
  it('static path has no health badge artifacts (byte-clean)', () => {
    const html = renderFoundryDashboard(emptyState(), 0, {});
    expect(html).not.toContain('health-dead-salvageable');
    expect(html).not.toContain('health-salvage-hint');
  });
  it('client JS renders health field and salvage hint for dead-salvageable', () => {
    const s = emptyState();
    const running: DispatchStatusView = { status: 'running', healthy: true };
    const html = renderFoundryDashboard(s, 0, { interactive: true, dispatch: running });
    // __dispatchRenderPanel must handle the health field from the poll
    expect(html).toContain("x.health");
    expect(html).toContain("dead-salvageable");
    expect(html).toContain("health-salvage-hint");
    expect(html).toContain("x.claimId");
    expect(html).toContain("x.branch");
  });
});
```

Run: `npx vitest run test/dispatch-cockpit.acid.test.ts`
Expected: FAIL (health badge not yet in the render).

- [ ] **Step 2: Add health badge CSS to `dispatchStyles` in `src/dashboard/render.ts`**

Locate `dispatchStyles` (the template literal inside the gated `opts?.interactive && opts.dispatch != null` condition). It currently ends with `#dispatch-panel .disp-reconnect { ... }`. Add health badge styles:

```typescript
// After the last existing rule inside dispatchStyles:
  #dispatch-panel .health-badge { font-size: 10px; text-transform: uppercase; letter-spacing: .4px; font-weight: 700; margin-left: 6px; }
  #dispatch-panel .health-healthy { color: #22c55e; }
  #dispatch-panel .health-slow { color: #f59e0b; }
  #dispatch-panel .health-stalled { color: #fb923c; }
  #dispatch-panel .health-dead-empty { color: #ef4444; }
  #dispatch-panel .health-dead-salvageable { color: #ef4444; font-weight: 900; }
  #dispatch-panel .health-salvage-hint { font-size: 10.5px; color: #fbbf24; margin-top: 2px; display: block; }
```

- [ ] **Step 3: Add health badge to `__dispatchRenderPanel` client JS in `src/dashboard/render.ts`**

Inside `__dispatchRenderPanel`, locate the `inf` variable assignment where in-flight rows are rendered. Currently:

```javascript
var inf = (v.inFlight || []).map(function(x){
  if (typeof x === 'string') return '<li><code class="id">' + __dispatchEsc(x) + '</code></li>';
  var tier = x.riskTier ? '<span class="tier">' + __dispatchEsc(x.riskTier) + '</span>' : '';
  var title = x.title ? '<span class="rtitle">' + __dispatchEsc(x.title) + '</span>' : '';
  var prog = '';
  if (x.tasksTotal != null) prog = ' <span class="muted">task ' + (x.taskN != null ? x.taskN : 0) + '/' + x.tasksTotal + '</span>';
  else if (x.lastCommitSubject) prog = ' <span class="muted">' + __dispatchEsc(x.lastCommitSubject) + '</span>';
  var beat = x.heartbeatAgeSeconds != null ? ' <span class="muted">&#9829; ' + x.heartbeatAgeSeconds + 's</span>' : '';
  return '<li><code class="id">' + __dispatchEsc(x.itemId) + '</code>' + tier + title + prog + beat + '</li>';
}).join('');
```

Replace with (add health badge + salvage hint after `beat`):

```javascript
var inf = (v.inFlight || []).map(function(x){
  if (typeof x === 'string') return '<li><code class="id">' + __dispatchEsc(x) + '</code></li>';
  var tier = x.riskTier ? '<span class="tier">' + __dispatchEsc(x.riskTier) + '</span>' : '';
  var title = x.title ? '<span class="rtitle">' + __dispatchEsc(x.title) + '</span>' : '';
  var prog = '';
  if (x.tasksTotal != null) prog = ' <span class="muted">task ' + (x.taskN != null ? x.taskN : 0) + '/' + x.tasksTotal + '</span>';
  else if (x.lastCommitSubject) prog = ' <span class="muted">' + __dispatchEsc(x.lastCommitSubject) + '</span>';
  var beat = x.heartbeatAgeSeconds != null ? ' <span class="muted">&#9829; ' + x.heartbeatAgeSeconds + 's</span>' : '';
  var healthBadge = x.health ? ' <span class="health-badge health-' + __dispatchEsc(x.health) + '">' + __dispatchEsc(x.health) + '</span>' : '';
  var salvageHint = x.health === 'dead-salvageable'
    ? '<span class="health-salvage-hint">SALVAGE: claim ' + __dispatchEsc(x.claimId || '?') + ' · branch ' + __dispatchEsc(x.branch || '?') + (x.commits != null ? ' · ' + x.commits + ' commits' : '') + '</span>'
    : '';
  return '<li><code class="id">' + __dispatchEsc(x.itemId) + '</code>' + tier + title + prog + beat + healthBadge + salvageHint + '</li>';
}).join('');
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run test/dispatch-cockpit.acid.test.ts
```

Expected: All pass including the three new health badge tests; the static-path byte-clean test passes (health badge is gated on interactive+dispatch).

Specifically verify the existing tests still pass:
- `'omits the dispatch panel on the static path (byte-identical)'` — still passes (badge is in gated code only)
- `'omits ALL dispatch artifacts on the static path (byte-clean)'` — still passes
- `'renders Start (with form) when never-started; two-column Stop view when running'` — still passes (dispatching `inFlight: ['exercir-321']` as string → hits the `typeof x === 'string'` branch, no health badge rendered for string items)

- [ ] **Step 5: Run full ci:local and commit**

```bash
npm run ci:local
```

Expected: green (tsc + vitest --coverage).

```bash
git add src/dashboard/render.ts test/dispatch-cockpit.acid.test.ts
git commit -m "feat(cockpit): health badge per in-flight row with dead-salvageable recovery hint (item 1 client path)"
```

---

### Task 5: Item 2(b) design note + founder gate request

**No code change.** Write the designer-first concept doc for the liveness-reaping TOCTOU safety refinement and note it as an open decision for the founder.

**Context:** A currently in-flight worker (child process alive in the daemon's `inFlight` set) can have a heartbeat-silent period > `deadAfterSeconds` (e.g., during a long build step). The current stall-watch pass would classify it as `dead-empty` via the heartbeat-age fallback and auto-recover (release `blocked`) — even though the child is still running. When the worker resumes, it would find its claim released and fail ungracefully.

**Proposed safety:** In `makeStallWatchTick`, protect items currently in the daemon's `inFlight` set from the heartbeat-age auto-recovery path. These items can be `stalled` (surface only) but never `dead` (auto-act) while their child is still alive. Only cross-run workers (launched outside this daemon run, NOT in `inFlight`) fall back to heartbeat-age classification for dead/auto-recover.

**Files:**
- Create: `docs/adr-282-item2b-toctou-design-note.md`

- [ ] **Step 1: Write the design note**

Create `docs/adr-282-item2b-toctou-design-note.md` with this content:

```markdown
# ADR-282 Item 2(b): Liveness-Reaping TOCTOU Safety Refinement

**Status:** Proposed — awaiting founder architecture gate before implementation.

**Context:**
`runStallWatch` derives health via `deriveDispatchHealth`, which applies the heartbeat-age
fallback: if `heartbeatAgeSeconds >= deadAfterSeconds` AND `commitsSinceClaim === 0`, the
item is classified `dead-empty` and auto-recovered (claim released `blocked`, item re-queued).

The TOCTOU risk: a worker whose child is still running in the daemon's `inFlight` set but
has gone quiet for > `deadAfterSeconds` (e.g., a long build step, gate check, or heavy test
suite) would be auto-recovered while alive. When the child resumes, its `foundry_heartbeat`
call targets a released claim → error; any subsequent `foundry_release` also fails. The
committed work (if any) would be stranded.

**Proposed decision:**
Add `currentlyInFlightIds?: string[]` to `StallWatchIO` and propagate it into
`deriveClaimHealth`. Items in `currentlyInFlightIds` are capped at `stalled` (never `dead`),
because the daemon can see their child is alive. The heartbeat-age `dead` classification
applies ONLY to claims where:
- the child exited (`childExited === true`), OR
- the item is NOT in `currentlyInFlightIds` (cross-run / externally-launched worker)

`makeStallWatchTick` passes `[...inFlight]` as `currentlyInFlightIds` on each tick.

**Changes required if approved:**
1. `src/dispatch/health.ts` — add `currentlyInFlightIds?: string[]` to `StallWatchIO` and
   `deriveDispatchHealth` opts; in `runStallWatch`, skip auto-recovery for items in the set;
   in `deriveClaimHealth`, cap verdict at `stalled` when caller signals the child is live.
2. `src/dispatch/stall-watch-runner.ts` — pass `[...inFlight]` as `currentlyInFlightIds`.
3. `test/dispatch-health.test.ts` + `test/dispatch-stall-watch-runner.test.ts` — tests for
   the new in-flight protection.

**Governance line (unchanged):**  
The auto-recover boundary stays `dead-empty` only. This change narrows when a claim reaches
`dead` in the first place for same-run workers, aligning the action with what the daemon
actually knows: "I spawned this child; it hasn't reported exit; it's just quiet."

**Requires:** Founder architecture gate decision before building.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adr-282-item2b-toctou-design-note.md
git commit -m "docs: ADR-282 item 2(b) TOCTOU design note — awaiting founder gate"
```

---

### Post-PR: twin ritual

After the PR merges:

```bash
# From domains/devloop
npm run ritual:post-merge -- de-braighter/foundry#<PR_NUMBER>
```

Declare in the PR body:
```
Producer: orchestrator/claude-sonnet-4-6 [writing-plans, subagent-driven-development]
Effort: standard
Effect: cycle-time 0.01±0.02 expert
```

---

## Self-review

**Spec coverage check:**

| ADR-282 surface | Task |
|---|---|
| D-1 `deriveClaimHealth` / `deriveDispatchHealth` | Already shipped (foundry#63) |
| D-2 `runStallWatch` auto-recover `dead-empty` | Already shipped |
| D-3 `dead-salvageable` flag-only | Surfaced in Task 4 (badge + recovery hint) |
| D-4(1) derivation | Already shipped |
| D-4(2) `foundry_status` STALL-WATCH block | Already shipped; Task 2 fixes threshold divergence |
| D-4(3) `foundry_dispatch health` MCP action | Already shipped; Task 2 fixes threshold divergence |
| D-4(4) cockpit badge | **Task 3 + Task 4** |
| OQ-1 threshold calibration | **Task 1** |
| TOCTOU safety (reviewer note) | **Task 5 design note → gate** |

**Placeholder scan:** No TBD, TODO, or "similar to" references. Every step has concrete code.

**Type consistency:**
- `DispatchHealthRow` (from `health.ts`) is used in server.ts; it extends `DispatchProgressRow` so all existing progress fields remain.
- `thresholds?: HealthThresholds` added to `statusText` opts and threads through to `deriveDispatchHealth` opts (already has `thresholds?` field).
- `dispatchStatus(...).config` is `DispatchConfig` which has the three threshold fields; the extraction is consistent across tools.ts and server.ts.
