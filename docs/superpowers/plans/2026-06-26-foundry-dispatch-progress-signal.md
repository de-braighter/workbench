# Foundry Native Dispatch Progress Signal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give foundry a native, derived per-worker progress signal (commits-since-claim, task N/M, last commit, heartbeat age) surfaced on `foundry_status`, a `foundry_dispatch progress` MCP action, and the cockpit in-flight row — replacing the hand-rolled cron+bash watcher.

**Architecture:** A pure-ish derived query `deriveDispatchProgress(state, nowMs, {run, readFile})` in a new `src/dispatch/progress.ts` computes one row per active claim from the folded event log + the claim's worktree git log + the plan file at the item's new optional `planRef`. The git/fs reads are injected so the query is unit-testable. Three thin consumers render it. ZERO new event type.

**Tech Stack:** TypeScript (ESM, explicit `.js` extensions), Node `node:child_process`/`node:fs`, Vitest, `tsx`. No new dependencies. Builds on the merged cockpit (foundry `main` `06a3cce`).

## Global Constraints

- **Scope:** `domains/foundry` only. ZERO kernel change — no `@de-braighter/substrate-*`, no new event type.
- **Derived, read-only, never-throws:** progress is computed on read; the query never appends to the log and never throws — every missing input degrades that row gracefully.
- **Injected I/O:** the git + plan-file reads go through injected `run`/`readFile` params (default to real `git`/`fs`) so tests need no real repo.
- **Pure renderer / localhost-only (cockpit):** the cockpit enrichment happens in `server.ts`; `render.ts` stays pure; `GET /api/dispatch/status` stays localhost-only + read-only; all dispatch UI stays gated on `opts.interactive && opts.dispatch != null` (the static path stays byte-clean).
- **Run a single test file:** `npx vitest run test/<file>.test.ts` (one test: add `-t "<name>"`). Full gate: `npm run ci:local`. Typecheck only: `npm run typecheck`.
- **Commit discipline:** `git add <explicit paths>` only — never `git add -A`. End each commit message with the Co-Authored-By trailer shown.

---

### Task 1: Add the optional `planRef` field to the WorkItem

**Files:**

- Modify: `src/events.ts` (the `WorkItemQueued` zod schema)
- Modify: `src/state.ts` (`ItemState` interface + the `ITEM_QUEUED` fold)
- Modify: `src/ops.ts` (the `ItemInput` interface)
- Test: `test/state.test.ts` (append a case)

**Interfaces:**

- Produces: `ItemInput.planRef?: string`, `WorkItemQueued` payload `planRef?: string`, `ItemState.planRef?: string`.

- [ ] **Step 1: Write the failing test**

Append to `test/state.test.ts` (it already imports `fold` + builds events; mirror an existing queue+fold case). Use the event builder `itemQueued`:

```ts
import { itemQueued } from '../src/events.js';
import { fold } from '../src/state.js';

describe('planRef on the WorkItem', () => {
  it('folds planRef from WorkItemQueued onto ItemState', () => {
    const env = itemQueued({
      itemId: 'pr-1', productKey: 'p', title: 'T',
      scope: { repo: 'r' }, planRef: 'docs/plans/x.md', ts: '2026-06-26T00:00:00.000Z',
    });
    const s = fold([env]);
    expect(s.items.get('pr-1')?.planRef).toBe('docs/plans/x.md');
  });
  it('leaves planRef undefined when omitted', () => {
    const env = itemQueued({ itemId: 'pr-2', productKey: 'p', title: 'T', scope: { repo: 'r' }, ts: '2026-06-26T00:00:00.000Z' });
    expect(fold([env]).items.get('pr-2')?.planRef).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/state.test.ts -t "planRef on the WorkItem"`
Expected: FAIL — `planRef` is `undefined` even when provided (schema strips it / fold doesn't carry it), and TypeScript errors that `planRef` is not a known property on the `itemQueued` input.

- [ ] **Step 3: Add `planRef` to the zod schema**

In `src/events.ts`, in the `WorkItemQueued = z.object({ … })` schema, add `planRef` next to `generationKind`:

```ts
  generationKind: z.string().min(1).optional(),
  planRef: z.string().min(1).optional(),
});
```

- [ ] **Step 4: Add `planRef` to `ItemState` + the fold**

In `src/state.ts`, in the `ItemState` interface, add after `generationKind?: string;`:

```ts
  /** Optional path to the implementation plan (used by deriveDispatchProgress to count tasks). Opaque; never affects claimability. */
  planRef?: string;
```

Then in the `case EVENT.ITEM_QUEUED:` fold block, alongside the existing `generationKind: optStr(p['generationKind'])`, add:

```ts
          planRef: optStr(p['planRef']),
```

- [ ] **Step 5: Add `planRef` to `ItemInput`**

In `src/ops.ts`, in the `ItemInput` interface, add `planRef` alongside `generationKind`:

```ts
  generationKind?: string;
  planRef?: string;
```

(`queuePush` already spreads `...it` into `ev.itemQueued`, so no further wiring is needed — `planRef` rides through like `generationKind`.)

- [ ] **Step 6: Run test + typecheck**

Run: `npx vitest run test/state.test.ts -t "planRef on the WorkItem"` → PASS.
Run: `npm run typecheck` → no errors.

- [ ] **Step 7: Commit**

```bash
git add src/events.ts src/state.ts src/ops.ts test/state.test.ts
git commit -m "$(cat <<'EOF'
feat(foundry): optional planRef field on the WorkItem (dispatch progress)

Rides WorkItemQueued.v1 + ItemState like generationKind — an opaque pointer to the
item's plan, used by deriveDispatchProgress to count tasks. Inert; never affects
claimability.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: The derived progress query

**Files:**

- Create: `src/dispatch/progress.ts`
- Test: `test/dispatch-progress.test.ts`

**Interfaces:**

- Consumes: `ItemState.planRef` (Task 1), `activeClaim`/`itemDone` from `state.js`.
- Produces: `DispatchProgressRow`, `countPlanTasks(text): number`, `deriveDispatchProgress(state, nowMs, {run?, readFile?}): DispatchProgressRow[]`, types `GitRun`/`ReadFile`.

- [ ] **Step 1: Write the failing test**

Create `test/dispatch-progress.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fold } from '../src/state.js';
import { itemQueued, claimAcquired, claimHeartbeat } from '../src/events.js';
import { countPlanTasks, deriveDispatchProgress, type GitRun, type ReadFile } from '../src/dispatch/progress.js';

const T0 = '2026-06-26T12:00:00.000Z';
function activeState() {
  return fold([
    itemQueued({ itemId: 'pr-1', productKey: 'p', title: 'Build it', scope: { repo: 'r' }, planRef: '/plan.md', ts: T0 }),
    claimAcquired({ claimId: 'c1', itemId: 'pr-1', sessionId: 's1', worktree: '/wt', branch: 'feat/pr-1', ts: T0 }),
    claimHeartbeat({ claimId: 'c1', itemId: 'pr-1', sessionId: 's1', ts: '2026-06-26T12:00:30.000Z' }),
  ]);
}

describe('countPlanTasks', () => {
  it('counts ### Task N: headings', () => {
    expect(countPlanTasks('### Task 1: A\nfoo\n### Task 2: B\n### Task 10: C')).toBe(3);
  });
  it('ignores prose mentioning Task without a number heading', () => {
    expect(countPlanTasks('see the task above\n## Task overview\n### Task one')).toBe(0);
  });
  it('is 0 for empty text', () => { expect(countPlanTasks('')).toBe(0); });
});

describe('deriveDispatchProgress', () => {
  const run: GitRun = (args) => {
    if (args[0] === 'merge-base') return 'BASE';
    if (args[0] === 'rev-list') return '3';
    if (args.includes('%s')) return 'feat: task three';
    if (args.includes('%cI')) return '2026-06-26T12:05:00+00:00';
    return '';
  };
  const readFile: ReadFile = () => '### Task 1: a\n### Task 2: b\n### Task 3: c\n### Task 4: d\n### Task 5: e\n### Task 6: f\n### Task 7: g';
  const now = Date.parse('2026-06-26T12:01:00.000Z');

  it('one row per active claim, enriched', () => {
    const rows = deriveDispatchProgress(activeState(), now, { run, readFile });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      itemId: 'pr-1', claimId: 'c1', productKey: 'p',
      commitsSinceClaim: 3, lastCommitSubject: 'feat: task three',
      tasksTotal: 7, taskN: 3, heartbeatAgeSeconds: 30,
    });
  });
  it('omits task N/M when no planRef', () => {
    const s = fold([
      itemQueued({ itemId: 'q', productKey: 'p', title: 'T', scope: { repo: 'r' }, ts: T0 }),
      claimAcquired({ claimId: 'c', itemId: 'q', sessionId: 's', worktree: '/wt', ts: T0 }),
    ]);
    const r = deriveDispatchProgress(s, now, { run, readFile })[0];
    expect(r.commitsSinceClaim).toBe(3);
    expect(r.tasksTotal).toBeUndefined();
    expect(r.taskN).toBeUndefined();
  });
  it('omits git fields + never throws when the worktree git read fails', () => {
    const boom: GitRun = () => { throw new Error('no worktree'); };
    const r = deriveDispatchProgress(activeState(), now, { run: boom, readFile })[0];
    expect(r.itemId).toBe('pr-1');
    expect(r.commitsSinceClaim).toBeUndefined();
    expect(r.heartbeatAgeSeconds).toBe(30); // liveness still derived
  });
  it('excludes items with no active claim', () => {
    const s = fold([itemQueued({ itemId: 'unclaimed', productKey: 'p', title: 'T', scope: { repo: 'r' }, ts: T0 })]);
    expect(deriveDispatchProgress(s, now, { run, readFile })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dispatch-progress.test.ts`
Expected: FAIL — `Cannot find module '../src/dispatch/progress.js'`.

- [ ] **Step 3: Write the implementation**

Create `src/dispatch/progress.ts`:

```ts
// The native dispatch PROGRESS signal (ADR-278 cockpit follow-up): a DERIVED, read-only query
// — one row per active claim — computed from the folded event log + the claim's worktree git
// log + the plan file at the item's planRef. No new event type, nothing stored ("store
// generators, derive graphs"). The git/fs reads are INJECTED (like spawn.ts's run) so the
// query is unit-testable with no real repo; best-effort everywhere → it never throws.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { activeClaim, itemDone, type ClaimState, type DerivedState, type ItemState } from '../state.js';

export interface DispatchProgressRow {
  itemId: string;
  claimId: string;
  productKey: string;
  commitsSinceClaim?: number;
  lastCommitSubject?: string;
  lastCommitAt?: string;
  tasksTotal?: number;
  taskN?: number;
  heartbeatAgeSeconds?: number;
}

/** Pure: count `### Task N:` headings (the plan's task count = M). */
export function countPlanTasks(text: string): number {
  return (text.match(/^### Task \d+/gm) ?? []).length;
}

export type GitRun = (args: string[], cwd: string) => string;
export type ReadFile = (path: string) => string | null;

const defaultRun: GitRun = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const defaultReadFile: ReadFile = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : null);

/** One row per ACTIVE claim (claimed, not terminal). Best-effort: a per-claim derivation
 *  error degrades that row to its available fields; the query never throws. */
export function deriveDispatchProgress(
  s: DerivedState,
  nowMs: number,
  opts: { run?: GitRun; readFile?: ReadFile } = {},
): DispatchProgressRow[] {
  const run = opts.run ?? defaultRun;
  const readFile = opts.readFile ?? defaultReadFile;
  const rows: DispatchProgressRow[] = [];
  for (const item of s.items.values()) {
    const c = activeClaim(item, nowMs);
    if (c == null || itemDone(item)) continue;
    rows.push(rowFor(item, c, nowMs, run, readFile));
  }
  return rows;
}

function rowFor(item: ItemState, c: ClaimState, nowMs: number, run: GitRun, readFile: ReadFile): DispatchProgressRow {
  const row: DispatchProgressRow = {
    itemId: item.itemId,
    claimId: c.claimId,
    productKey: item.productKey,
    heartbeatAgeSeconds: Math.max(0, Math.round((nowMs - Date.parse(c.lastBeatAt)) / 1000)),
  };
  if (c.worktree != null) {
    try {
      const base = run(['merge-base', 'main', 'HEAD'], c.worktree);
      row.commitsSinceClaim = Number(run(['rev-list', '--count', `${base}..HEAD`], c.worktree)) || 0;
      row.lastCommitSubject = run(['log', '-1', '--format=%s'], c.worktree) || undefined;
      row.lastCommitAt = run(['log', '-1', '--format=%cI'], c.worktree) || undefined;
    } catch {
      /* worktree gone / git error → omit git fields */
    }
  }
  if (item.planRef != null) {
    let text: string | null = null;
    try { text = readFile(item.planRef); } catch { text = null; }
    if (text != null) {
      const m = countPlanTasks(text);
      if (m > 0) {
        row.tasksTotal = m;
        if (row.commitsSinceClaim != null) row.taskN = Math.min(row.commitsSinceClaim, m);
      }
    }
  }
  return row;
}
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/dispatch-progress.test.ts` → PASS (8 tests).
Run: `npm run typecheck` → no errors. (If `claimHeartbeat`'s input shape differs, match the existing `test/state.test.ts` usage — it is `{ claimId, itemId, sessionId, ts }`.)

- [ ] **Step 5: Commit**

```bash
git add src/dispatch/progress.ts test/dispatch-progress.test.ts
git commit -m "$(cat <<'EOF'
feat(dispatch): derived per-claim progress query (ADR-278 cockpit follow-up)

deriveDispatchProgress: one row per active claim — commits-since-claim + last
commit (worktree git log), task N/M (planRef plan-parse), heartbeat age. Injected
git/fs I/O; best-effort, never throws. Pure countPlanTasks helper. Zero new event type.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Surface progress in `foundry_status`

**Files:**

- Modify: `src/status.ts`
- Test: `test/dispatch-progress.test.ts` (append) or `test/mcp-tools.test.ts` — use a `statusText` unit test here.

**Interfaces:**

- Consumes: `deriveDispatchProgress` (Task 2).
- Produces: a `DISPATCH PROGRESS` section in `statusText`'s output.

- [ ] **Step 1: Write the failing test**

Append to `test/dispatch-progress.test.ts`:

```ts
import { statusText } from '../src/status.js';

describe('statusText — DISPATCH PROGRESS block', () => {
  const run: GitRun = (args) => (args[0] === 'merge-base' ? 'B' : args[0] === 'rev-list' ? '3' : args.includes('%s') ? 'feat: task three' : '');
  const readFile: ReadFile = () => '### Task 1: a\n### Task 2: b\n### Task 3: c\n### Task 4: d\n### Task 5: e\n### Task 6: f\n### Task 7: g';
  it('renders task N/M + last subject + heartbeat age for an active claim', () => {
    const out = statusText(activeState(), '2026-06-26T12:01:00.000Z', { run, readFile });
    expect(out).toContain('DISPATCH PROGRESS');
    expect(out).toMatch(/pr-1.*task 3\/7.*feat: task three/);
  });
  it('shows (none) when no active claims', () => {
    const out = statusText(fold([]), '2026-06-26T12:01:00.000Z', { run, readFile });
    expect(out).toMatch(/DISPATCH PROGRESS\n\s*\(none\)/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dispatch-progress.test.ts -t "DISPATCH PROGRESS"`
Expected: FAIL — `statusText` has no `DISPATCH PROGRESS` block and its signature has no `opts`.

- [ ] **Step 3: Add the block to `statusText`**

In `src/status.ts`, import the query at the top:

```ts
import { deriveDispatchProgress, type GitRun, type ReadFile } from './dispatch/progress.js';
```

Change the signature to accept optional injected I/O (so the test can stub git/fs; production passes nothing → real git/fs):

```ts
export function statusText(s: DerivedState, nowIso: string, opts: { run?: GitRun; readFile?: ReadFile } = {}): string {
```

Then, immediately AFTER the `ACTIVE CLAIMS` section (after its `for (const { i, c } of actives) { … }` loop, before the `STALE CLAIMS` block), insert:

```ts
  lines.push('', 'DISPATCH PROGRESS');
  const progress = deriveDispatchProgress(s, nowMs, opts);
  if (progress.length === 0) lines.push('  (none)');
  for (const r of progress) {
    const tasks = r.tasksTotal != null ? `task ${r.taskN ?? 0}/${r.tasksTotal}` : (r.commitsSinceClaim != null ? `${r.commitsSinceClaim} commits` : '—');
    const subj = r.lastCommitSubject ? ` · ${oneLine(r.lastCommitSubject)}` : '';
    const beat = r.heartbeatAgeSeconds != null ? ` · ♥ ${r.heartbeatAgeSeconds}s` : '';
    lines.push(`  ${oneLine(r.itemId)} — ${tasks}${subj}${beat}`);
  }
```

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/dispatch-progress.test.ts -t "DISPATCH PROGRESS"` → PASS.
Run: `npm run typecheck` → no errors. (`statusText`'s existing callers pass no `opts` — the default `{}` keeps them green.)

- [ ] **Step 5: Commit**

```bash
git add src/status.ts test/dispatch-progress.test.ts
git commit -m "$(cat <<'EOF'
feat(foundry): DISPATCH PROGRESS block in foundry_status (ADR-278 cockpit follow-up)

Renders per-active-claim 'task N/M · <last subject> · ♥ <age>s' from the derived
progress query. Injected git/fs I/O (default real); existing callers unaffected.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `foundry_dispatch progress` MCP action

**Files:**

- Modify: `src/mcp/tools.ts` (the `foundry_dispatch` handler)
- Modify: `src/mcp/server.ts` (the `foundry_dispatch` action enum)
- Test: `test/mcp-tools.test.ts` (append)

**Interfaces:**

- Consumes: `deriveDispatchProgress` (Task 2).
- Produces: `foundry_dispatch({ action: 'progress' })` → `DispatchProgressRow[]`.

- [ ] **Step 1: Write the failing test**

Append to `test/mcp-tools.test.ts` (mirror its existing `foundry_dispatch` status test; it builds `deps` + a folded log). Seed an active claim, then:

```ts
it('foundry_dispatch progress returns a row per active claim (read-only)', () => {
  // seed: queue + claim an item in deps' log (use the file helpers this test already uses)
  // … append itemQueued + claimAcquired envelopes to deps.logPath …
  const before = readFileSync(deps.logPath, 'utf8');
  const rows = tools.foundry_dispatch({ action: 'progress' }) as Array<{ itemId: string }>;
  expect(Array.isArray(rows)).toBe(true);
  expect(rows.some((r) => r.itemId === 'pr-1')).toBe(true);
  expect(readFileSync(deps.logPath, 'utf8')).toBe(before); // read-only
});
```

(Match the file-seeding idiom already used by the surrounding `mcp-tools.test.ts` cases.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mcp-tools.test.ts -t "foundry_dispatch progress"`
Expected: FAIL — `action: 'progress'` hits the `default` throw (`unknown dispatch action`).

- [ ] **Step 3: Add the `progress` action**

In `src/mcp/server.ts`, widen the `foundry_dispatch` action enum from `['start','stop','status']` to include `'progress'` (both the registered tool's input schema enum AND the `a as { action: 'start' | 'stop' | 'status' | 'progress'; … }` cast).

In `src/mcp/tools.ts`, add the import:

```ts
import { deriveDispatchProgress } from '../dispatch/progress.js';
```

Widen the handler's parameter type to include `'progress'`, and add the case (it folds the log the same way the other read tools do — `deps` already exposes the folded state via the helper the surrounding cases use; if `tools.ts` folds inline, mirror that):

```ts
        case 'progress': return deriveDispatchProgress(fold(readEnvelopes(deps.logPath)), Date.parse(nowIso()));
```

(Use whatever `fold`/`readEnvelopes` access the other read-cases in `tools.ts` already use; do not introduce a new import if one exists.)

- [ ] **Step 4: Run test + typecheck**

Run: `npx vitest run test/mcp-tools.test.ts -t "foundry_dispatch progress"` → PASS.
Run: `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools.ts src/mcp/server.ts test/mcp-tools.test.ts
git commit -m "$(cat <<'EOF'
feat(mcp): foundry_dispatch progress action (ADR-278 cockpit follow-up)

A 4th action (start|stop|status|progress) returning DispatchProgressRow[] — the
native, scriptable replacement for the hand-rolled cron+bash watcher. Read-only.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Cockpit in-flight row shows progress

**Files:**

- Modify: `src/dashboard/server.ts` (`GET /api/dispatch/status` enrichment)
- Modify: `src/dashboard/render.ts` (`__dispatchRenderPanel` in-flight `<li>`)
- Test: `test/dispatch-cockpit.acid.test.ts` (append)

**Interfaces:**

- Consumes: `deriveDispatchProgress` (Task 2); the merged cockpit's `GET /api/dispatch/status` (enriches `inFlight` ids → `{itemId,title,riskTier,productKey}`).
- Produces: each in-flight object additionally carries `{ taskN?, tasksTotal?, lastCommitSubject?, heartbeatAgeSeconds? }`; the cockpit row renders `task N/M · <subject> · ♥ <age>s`.

- [ ] **Step 1: Write the failing test**

Append to `test/dispatch-cockpit.acid.test.ts`:

```ts
describe('cockpit in-flight row — progress fields', () => {
  it('GET /api/dispatch/status enriches in-flight items with progress', async () => {
    const d = tmp();
    const logPath = join(d, 'events.jsonl');
    // seed: queue + claim 'pr-1' so it is an active claim with a worktree
    appendEnvelopes(logPath, [
      itemQueued({ itemId: 'pr-1', productKey: 'p', title: 'Build it', scope: { repo: 'r' }, planRef: join(d, 'plan.md'), ts: new Date(Date.now()).toISOString() }),
      claimAcquired({ claimId: 'c1', itemId: 'pr-1', sessionId: 's1', worktree: d, branch: 'feat/pr-1', ts: new Date(Date.now()).toISOString() }),
    ]);
    writeFileSync(join(d, 'plan.md'), '### Task 1: a\n### Task 2: b', 'utf8');
    // a fresh running daemon control publishing pr-1 in-flight
    const nowIso = new Date(Date.now()).toISOString();
    writeControl(d, { status: 'running', config: DEFAULT_DISPATCH_CONFIG, startedAt: nowIso, heartbeatAt: nowIso, inFlight: ['pr-1'] });
    const { url, close } = await startDashboardServer({ dataDir: d, logPath }, { port: 0, spawnDaemon: () => undefined });
    try {
      const body = await (await fetch(`${url}/api/dispatch/status`)).json();
      const row = body.inFlight.find((x: { itemId: string }) => x.itemId === 'pr-1');
      expect(row).toBeTruthy();
      expect(row).toHaveProperty('tasksTotal', 2);   // plan has 2 tasks
      expect(row).toHaveProperty('heartbeatAgeSeconds');
    } finally { await close(); }
  });
});
```

(Add the imports it needs: `itemQueued`, `claimAcquired` from `../src/events.js`, `writeFileSync` from `node:fs`, and the test's existing `appendEnvelopes` helper — or whatever envelope-append idiom `dispatch-cockpit.acid.test.ts` already uses.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/dispatch-cockpit.acid.test.ts -t "progress fields"`
Expected: FAIL — `inFlight[*]` has no `tasksTotal`/`heartbeatAgeSeconds`.

- [ ] **Step 3: Enrich the endpoint with progress**

In `src/dashboard/server.ts`, in the `GET /api/dispatch/status` handler, after the existing `inFlight` enrichment (ids → `{itemId,title,riskTier,productKey}`), join the progress query by `itemId`:

```ts
          import_deriveDispatchProgress_at_top_of_file; // see note
          const progress = deriveDispatchProgress(s, now);   // s = the already-folded state in this handler
          const byId = new Map(progress.map((r) => [r.itemId, r]));
          const inFlight = (view.inFlight ?? []).map((itemId) => {
            const it = s.items.get(itemId);
            const base = it == null ? { itemId } : { itemId, title: it.title, riskTier: s.products.get(it.productKey)?.riskTier, productKey: it.productKey };
            const p = byId.get(itemId);
            return p == null ? base : { ...base, taskN: p.taskN, tasksTotal: p.tasksTotal, lastCommitSubject: p.lastCommitSubject, heartbeatAgeSeconds: p.heartbeatAgeSeconds };
          });
```

Add the import at the top of `server.ts`:

```ts
import { deriveDispatchProgress } from '../dispatch/progress.js';
```

(Reuse the handler's existing folded `s` and `now`; the merged handler already folds the log for the title/tier enrichment — pass that same `s` to `deriveDispatchProgress`, do not re-fold.)

- [ ] **Step 4: Render progress in the client in-flight row**

In `src/dashboard/render.ts`, in the client `__dispatchRenderPanel`'s `var inf = (v.inFlight || []).map(function(x){ … })` block (the object branch), append a progress suffix after the title:

```js
      var prog = '';
      if (x.tasksTotal != null) prog = ' <span class="muted">task ' + (x.taskN != null ? x.taskN : 0) + '/' + x.tasksTotal + '</span>';
      else if (x.lastCommitSubject) prog = ' <span class="muted">' + __dispatchEsc(x.lastCommitSubject) + '</span>';
      var beat = x.heartbeatAgeSeconds != null ? ' <span class="muted">♥ ' + x.heartbeatAgeSeconds + 's</span>' : '';
      return '<li><code class="id">' + __dispatchEsc(x.itemId) + '</code>' + tier + title + prog + beat + '</li>';
```

(This is inside the existing `else` branch that already builds `tier`/`title`; only the `prog`/`beat`/`return` lines are added. The server-side `dispatchPanelBody` initial render keeps showing ids only — the first poll enriches with progress, matching the cockpit's existing initial-ids/poll-enriched pattern.)

- [ ] **Step 5: Run test + the full dispatch suite**

Run: `npx vitest run test/dispatch-cockpit.acid.test.ts` → PASS (incl. the existing byte-stable + read-only assertions — the new code is inside the already-gated interactive path; the static path is untouched).
Run: `npm run typecheck` → no errors.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/server.ts src/dashboard/render.ts test/dispatch-cockpit.acid.test.ts
git commit -m "$(cat <<'EOF'
feat(dashboard): cockpit in-flight row shows task N/M + heartbeat (ADR-278 follow-up)

GET /api/dispatch/status joins deriveDispatchProgress by itemId; the client in-flight
<li> renders 'task N/M · <last subject> · ♥ <age>s'. Static path untouched (the new
render is inside the gated interactive branch).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Full-battery verification

**Files:** none (verification gate).

- [ ] **Step 1: Full suite** — Run: `npm test` → all green (incl. `dispatch-progress`, `dispatch-cockpit.acid`, `mcp-tools`, `state`).
- [ ] **Step 2: Gate** — Run: `npm run ci:local` → typecheck clean + coverage green.
- [ ] **Step 3: Static byte-stability** — Run: `npm run dashboard` then confirm the generated `data/foundry-dashboard.html` still contains **0** of `id="dispatch-panel"`, `__dispatchPoll`, `DISPATCH-STYLES` (the progress code is inside the gated interactive path; the static path must be unchanged).
- [ ] **Step 4: Clean tree** — Run: `git status --short` → clean (all committed across Tasks 1–5).

---

## Self-Review

**Spec coverage** (against `2026-06-26-foundry-dispatch-progress-signal-design.md`):

- §3 D1 surfaces → Task 3 (`foundry_status`), Task 4 (MCP `progress`), Task 5 (cockpit row). ✓
- §3 D2 parse-the-plan denominator → Task 2 `countPlanTasks` + `taskN/tasksTotal`. ✓
- §3 D3 `planRef` field → Task 1. ✓
- §4.1 query / fields / degradation → Task 2 (+ tests for missing planRef, git failure, no-active-claim). ✓
- §5 error handling (never throws; graceful) → Task 2 try/catch + the degradation tests. ✓
- §6 testing items 1–6 → Tasks 2–5 tests + Task 6. ✓

**Placeholder scan:** the only deliberately-soft spots are the test seeding idioms in Tasks 4–5 ("match the surrounding test's envelope-append helper"), because the exact helper name lives in those test files — the *assertions* and the *implementation code* are complete. Everything else is verbatim.

**Type consistency:** `DispatchProgressRow` (Task 2) is consumed unchanged by Tasks 3/4/5. `planRef` (Task 1) is read by `deriveDispatchProgress` (Task 2). `statusText(s, nowIso, opts?)` (Task 3) keeps its existing callers green via the default `{}`. The cockpit enrichment (Task 5) reuses the merged handler's folded `s` + `deriveDispatchProgress` from Task 2.

## Dogfood note (read before queueing)

Queue-ready as **one T2 item, cap=1**, with `planRef` pointing at THIS plan
(`.worktrees/dispatch-cockpit-design/docs/superpowers/plans/2026-06-26-foundry-dispatch-progress-signal.md`,
or wherever it lands on disk). The cockpit dependency is already merged on `main`.

**Land the gate-halt fix first.** Until the foundry-worker T2-halt releases `built` (not
`blocked`) and/or the dispatch loop skips gate-pending items, this dogfood needs the same
manual recovery as #61 (recovery-claim → release `built` → `record_merge`) and the daemon
must be stopped promptly after the worker claims. Cleanest: ship the gate-halt fix as its own
small foundry item, then dogfood this on a clean gate-halt.
