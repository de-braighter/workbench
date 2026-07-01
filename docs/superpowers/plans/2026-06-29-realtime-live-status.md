# Real-Time Live Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-poll (editor-scoped, 5s) the node-detail Details "Status" so a selected node's status updates as foundry runs, overlaying the live value onto the static one without re-fetching the catalog or mutating the kernel draft.

**Architecture:** A new lightweight foundry `GET /api/item-status` returns `{ itemId → ItemStatus }` (reusing `buildStatusByItemId` from foundry#79). A studio `LiveStatusService` polls it into a signal while the editor is open; the inspector's existing `detailFields()` computed overlays that signal onto `meta.status` before `toDetailFields`.

**Tech Stack:** TypeScript, Node `http` (foundry dashboard), Angular standalone + signals + Vitest (studio). Spec: `docs/superpowers/specs/2026-06-29-realtime-live-status-design.md`.

## Global Constraints

- ZERO kernel change. Foundry change is a Ring 4/5 dashboard route; studio change is Ring 4/5 app code.
- Read-only; the live status is an EPHEMERAL overlay signal — never persisted, never patched into the kernel `BuildPathDraft` ("store generators, derive graphs").
- Foundry endpoint is fail-soft: fold error → `{ ok: true, statuses: {} }`, never crash; `/api/catalog` and all other routes untouched.
- Studio poll is fail-soft: a failed poll keeps the last-known status map (never blanks); the foundry#79 static value shows until the first successful poll.
- Editor-scoped lifecycle: poll starts on editor open, stops on destroy (no leaked timers; no app-wide polling).
- Poll cadence is a single named constant `POLL_MS = 5000`. Foundry base URL `http://localhost:4555` (the per-file URL-constant convention the other studio foundry adapters use).
- Two PRs: **foundry** (Task 1) merges first; then **studio** (Tasks 2–3). Studio tests use mocked fetch + fake timers and do NOT require the foundry PR merged.
- **Concurrency caution:** a separate session may share the foundry working tree. Before any foundry git op, confirm `git branch --show-current` is your branch; generate review packages against `origin/<branch>`; never `checkout`/`stash`/`reset` a shared tree.
- Foundry test cmd (from `domains/foundry`): `npx vitest run <file>` ; typecheck `npm run typecheck`. Studio (from `domains/studio/apps/studio-ui`): `node_modules/.bin/ng test --no-watch` ; build `node_modules/.bin/ng build`.

---

## File Structure

| Repo | File | Action | Responsibility |
|---|---|---|---|
| foundry | `src/dashboard/server.ts` | Modify | add `GET /api/item-status` route (folds + serializes `buildStatusByItemId`) |
| foundry | `test/dashboard-catalog-endpoints.acid.test.ts` | Modify | integration test for the new route |
| studio | `apps/studio-ui/src/app/system-editor/live-status.service.ts` | **Create** | poll `/api/item-status` into a `statuses` signal; `start()`/`stop()` |
| studio | `apps/studio-ui/src/app/system-editor/live-status.service.spec.ts` | **Create** | fake-timer unit tests |
| studio | `apps/studio-ui/src/app/system-editor/system-editor.page.ts` | Modify | provide+inject `LiveStatusService`; `start()` in ngOnInit, `stop()` in ngOnDestroy; overlay in `detailFields()` |
| studio | `apps/studio-ui/src/app/system-editor/system-editor.page.spec.ts` | Modify | overlay test (live value wins over static) |

---

## Task 1 — Foundry: `GET /api/item-status`

**Repo:** `domains/foundry`. Branch `feat/realtime-item-status` from `main`.

**Files:**
- Modify: `src/dashboard/server.ts`
- Modify: `test/dashboard-catalog-endpoints.acid.test.ts`

**Interfaces:**
- Consumes: `buildStatusByItemId` (already imported in `server.ts` from `./live-status.js`), `fold`/`readEnvelopes` (already imported).
- Produces: `GET /api/item-status` → `{ ok: true, statuses: Record<string, string> }`.

---

- [ ] **Step 1.1: Create the branch**

```bash
# in D:/development/projects/de-braighter/domains/foundry
git checkout main && git pull --ff-only && git checkout -b feat/realtime-item-status
```

(If the working tree is on another session's branch, do NOT switch it — coordinate or use a worktree. Confirm `git branch --show-current` is `feat/realtime-item-status` before proceeding.)

- [ ] **Step 1.2: Write the failing integration test**

Append inside the existing `describe('dashboard-catalog-endpoints …')` block in `test/dashboard-catalog-endpoints.acid.test.ts` (the `itemQueued` + `append` imports were already added by foundry#79; reuse them):

```ts
it('GET /api/item-status returns the live itemId→status map', async () => {
  const deps = tempDeps();
  append(
    itemQueued({
      itemId: 'foundry/x', productKey: 'foundry', title: 'X',
      scope: { repo: 'de-braighter/foundry', issue: 1 }, ts: '2026-06-18T10:00:00.000Z',
    }),
    deps.logPath,
  );
  const { url, close } = await startDashboardServer(deps, { port: 0 });
  try {
    const res = await fetch(`${url}/api/item-status`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4200');
    const body = await res.json() as { ok: boolean; statuses: Record<string, string> };
    expect(body.ok).toBe(true);
    expect(body.statuses['foundry/x']).toBe('queued');
  } finally {
    await close();
  }
});

it('GET /api/item-status returns an empty map for an empty log', async () => {
  const deps = tempDeps();                 // fresh temp dir, no events appended
  const { url, close } = await startDashboardServer(deps, { port: 0 });
  try {
    const body = await (await fetch(`${url}/api/item-status`)).json() as { ok: boolean; statuses: Record<string, string> };
    expect(body.ok).toBe(true);
    expect(body.statuses).toEqual({});
  } finally {
    await close();
  }
});
```

- [ ] **Step 1.3: Run it — verify it fails**

```bash
npx vitest run test/dashboard-catalog-endpoints.acid.test.ts
```

Expected: FAIL — `/api/item-status` 404s (returns the server's not-found fallback, so `res.status` ≠ 200 / body parse fails).

- [ ] **Step 1.4: Add the route to `server.ts`**

In `src/dashboard/server.ts`, find the `/api/catalog` route handler (`if (req.method === 'GET' && req.url === '/api/catalog') { … }`). Immediately AFTER its closing `}` (and before the next route), insert:

```ts
if (req.method === 'GET' && req.url === '/api/item-status') {
  // READ-ONLY live item-status map for the Studio inspector's auto-poll. Folds the
  // canonical log per request (same pattern as /api/snapshot) and serializes the
  // itemId→ItemStatus map. Fail-soft: a fold error yields an empty map, never a crash.
  let statuses: Record<string, string> = {};
  try {
    const state = fold(readEnvelopes(deps.logPath));
    statuses = Object.fromEntries(buildStatusByItemId(state, Date.now()));
  } catch {
    // log unreadable → empty map
  }
  res.writeHead(200, {
    'content-type': 'application/json',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'GET',
  });
  res.end(JSON.stringify({ ok: true, statuses }));
  return;
}
```

(`fold`, `readEnvelopes`, `buildStatusByItemId`, and `CORS_ORIGIN` are all already in scope in `server.ts` — no new imports.)

- [ ] **Step 1.5: Run tests — verify pass**

```bash
npx vitest run test/dashboard-catalog-endpoints.acid.test.ts
```

Expected: PASS (the two new tests + the existing route tests).

- [ ] **Step 1.6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 1.7: Commit**

```bash
git add src/dashboard/server.ts test/dashboard-catalog-endpoints.acid.test.ts
git commit -m "feat(item-status): add GET /api/item-status (live itemId->status map)"
```

> **Controller note:** after Task 1, open the foundry PR, run the gate (reviewer + charter-checker + local-ci), merge, run the ritual. Then proceed to the studio tasks.

---

## Task 2 — Studio: `LiveStatusService`

**Repo:** `domains/studio`. Branch `feat/realtime-live-status` from `main`.

**Files:**
- Create: `apps/studio-ui/src/app/system-editor/live-status.service.ts`
- Create: `apps/studio-ui/src/app/system-editor/live-status.service.spec.ts`

**Interfaces:**
- Produces: `class LiveStatusService` with `readonly statuses: Signal<Record<string, string>>`, `start(): void`, `stop(): void` — consumed by Task 3.

---

- [ ] **Step 2.1: Create the branch**

```bash
# in D:/development/projects/de-braighter/domains/studio
git checkout main && git pull --ff-only && git checkout -b feat/realtime-live-status
```

- [ ] **Step 2.2: Write the failing service tests**

Create `apps/studio-ui/src/app/system-editor/live-status.service.spec.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LiveStatusService } from './live-status.service';

function okResponse(statuses: Record<string, string>) {
  return { ok: true, json: async () => ({ ok: true, statuses }) } as unknown as Response;
}

describe('LiveStatusService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('start() polls immediately and updates the statuses signal', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ 'a': 'built' })));
    const svc = new LiveStatusService();
    svc.start();
    await vi.advanceTimersByTimeAsync(0); // flush the immediate poll's microtasks
    expect(svc.statuses()).toEqual({ 'a': 'built' });
    svc.stop();
  });

  it('re-polls every POLL_MS', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ 'a': 'queued' }))
      .mockResolvedValueOnce(okResponse({ 'a': 'built' }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new LiveStatusService();
    svc.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(svc.statuses()).toEqual({ 'a': 'queued' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(svc.statuses()).toEqual({ 'a': 'built' });
    svc.stop();
  });

  it('keeps the last-known map when a poll fails', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(okResponse({ 'a': 'queued' }))
      .mockRejectedValueOnce(new Error('network'));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new LiveStatusService();
    svc.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(svc.statuses()).toEqual({ 'a': 'queued' }); // unchanged on failure
    svc.stop();
  });

  it('stop() halts further polling', async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ 'a': 'queued' }));
    vi.stubGlobal('fetch', fetchMock);
    const svc = new LiveStatusService();
    svc.start();
    await vi.advanceTimersByTimeAsync(0);
    const callsAfterStart = fetchMock.mock.calls.length;
    svc.stop();
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetchMock.mock.calls.length).toBe(callsAfterStart); // no further fetches
  });
});
```

- [ ] **Step 2.3: Run them — verify they fail**

```bash
node_modules/.bin/ng test --no-watch
```

Expected: FAIL — `Cannot find module './live-status.service'`.

- [ ] **Step 2.4: Implement `live-status.service.ts`**

Create `apps/studio-ui/src/app/system-editor/live-status.service.ts`:

```ts
// live-status.service.ts — editor-scoped auto-poll of the foundry per-item live
// status. Polls GET /api/item-status every POLL_MS into a signal; the inspector
// overlays it onto the static Details status. Ephemeral — nothing is persisted.
import { Injectable, signal, type Signal } from '@angular/core';

const POLL_MS = 5000;
const ITEM_STATUS_URL = 'http://localhost:4555/api/item-status';

@Injectable() // provided at the system-editor component (editor-scoped lifecycle)
export class LiveStatusService {
  private readonly statusesSig = signal<Record<string, string>>({});
  readonly statuses: Signal<Record<string, string>> = this.statusesSig.asReadonly();
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Begin polling every POLL_MS (with an immediate first poll). Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  /** Stop polling and release the timer. Safe to call when not started. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    try {
      const r = await fetch(ITEM_STATUS_URL);
      if (!r.ok) return; // keep last-known on HTTP error
      const body = (await r.json()) as { ok: boolean; statuses?: Record<string, string> };
      if (body.ok && body.statuses) this.statusesSig.set(body.statuses);
    } catch {
      // network error → keep last-known
    }
  }
}
```

- [ ] **Step 2.5: Run tests — verify pass**

```bash
node_modules/.bin/ng test --no-watch
```

Expected: PASS (4 LiveStatusService tests + the existing suite).

- [ ] **Step 2.6: Commit**

```bash
git add apps/studio-ui/src/app/system-editor/live-status.service.ts apps/studio-ui/src/app/system-editor/live-status.service.spec.ts
git commit -m "feat(live-status): LiveStatusService — editor-scoped poll of /api/item-status"
```

---

## Task 3 — Studio: inspector overlay + editor lifecycle

**Repo:** `domains/studio` (same branch `feat/realtime-live-status`).

**Files:**
- Modify: `apps/studio-ui/src/app/system-editor/system-editor.page.ts`
- Modify: `apps/studio-ui/src/app/system-editor/system-editor.page.spec.ts`

**Interfaces:**
- Consumes: `LiveStatusService` (Task 2); the existing `selectedDetail()` computed, `detailFields()` computed, `ngOnInit`, and `toDetailFields`.

---

- [ ] **Step 3.1: Write the failing overlay test**

In `apps/studio-ui/src/app/system-editor/system-editor.page.spec.ts`, add a fake service + a test. The component PROVIDES `LiveStatusService` (Task 3 adds that), and component providers are not overridable by plain module providers — so use `TestBed.overrideComponent` with the fake. Add near the top:

```ts
import { signal } from '@angular/core';
import { LiveStatusService } from './live-status.service';

class FakeLiveStatus {
  private readonly sig = signal<Record<string, string>>({});
  readonly statuses = this.sig.asReadonly();
  setStatuses(m: Record<string, string>): void { this.sig.set(m); }
  start(): void { /* no-op in tests */ }
  stop(): void { /* no-op in tests */ }
}
```

Add this test (it sets up its own TestBed because it must `overrideComponent` before `createComponent` — do NOT route it through the shared `mount` helper):

```ts
it('overlays the live status over the static Details status', async () => {
  const fake = new FakeLiveStatus();
  const system = {
    id: 'sys-1', name: 'Sys', domain: 'foundry', desc: '', visibility: 'private' as const,
    root: { id: 'root-1', kind: 'epic' as const, title: 'Root', children: [
      { id: 'wi-1', kind: 'work' as const, title: 'Do it', children: [],
        meta: { itemId: 'foundry/slice3-1', status: 'done' } },
    ] },
  };

  TestBed.configureTestingModule({ imports: [SystemEditorPage] }); // + any ports the existing tests register
  TestBed.overrideComponent(SystemEditorPage, {
    set: { providers: [{ provide: LiveStatusService, useValue: fake }] },
  });
  const fixture = TestBed.createComponent(SystemEditorPage);
  fixture.componentRef.setInput('system', system);   // match how existing tests feed the system input
  fixture.detectChanges();                            // ngOnInit projects + fake.start() no-op
  fixture.componentInstance.select('wi-1');

  // no live entry yet → static 'done'
  fixture.detectChanges();
  let details = fixture.nativeElement.querySelector('[data-testid="node-details"]') as HTMLElement;
  expect(details.textContent).toContain('done');

  // live entry arrives → overlay wins
  fake.setStatuses({ 'foundry/slice3-1': 'built' });
  fixture.detectChanges();
  details = fixture.nativeElement.querySelector('[data-testid="node-details"]') as HTMLElement;
  expect(details.textContent).toContain('built');
});
```

> Match the existing spec's exact way of feeding the `system` input + selecting (read `system-editor.page.spec.ts` — it has a `mount(system)` helper and `comp.select(...)`). Reuse its module-provider list in `configureTestingModule`; the only addition is the `overrideComponent` for `LiveStatusService`. If reusing `mount` is feasible with a pre-create override, do that; otherwise inline the setup as above.

- [ ] **Step 3.2: Run it — verify it fails**

```bash
node_modules/.bin/ng test --no-watch
```

Expected: FAIL — `LiveStatusService` not provided / `detailFields` doesn't overlay (the second assertion finds `done`, not `built`).

- [ ] **Step 3.3: Provide + inject the service and wire lifecycle**

In `apps/studio-ui/src/app/system-editor/system-editor.page.ts`:

1. Import the service and Angular `OnDestroy`/`inject` (add to the existing `@angular/core` import if not present):

```ts
import { LiveStatusService } from './live-status.service';
```

2. Add a `providers` array to the `@Component({...})` decorator (it currently has none):

```ts
  providers: [LiveStatusService],
```

3. Change the class declaration to also implement `OnDestroy`, and inject the service. The class is `export class SystemEditorPage implements OnInit {` — change to:

```ts
export class SystemEditorPage implements OnInit, OnDestroy {
```

   Add the injection with the other injected fields:

```ts
  private readonly liveStatus = inject(LiveStatusService);
```

   (Ensure `OnDestroy` and `inject` are imported from `@angular/core`.)

4. In the existing `ngOnInit()` body, after the draft is seeded, add:

```ts
    this.liveStatus.start();
```

5. Add the destroy hook (anywhere in the class body):

```ts
  ngOnDestroy(): void {
    this.liveStatus.stop();
  }
```

- [ ] **Step 3.4: Add the overlay to `detailFields()`**

Replace the existing one-line `detailFields` computed:

```ts
  readonly detailFields = computed<DetailField[]>(() => toDetailFields(this.selectedDetail()?.meta));
```

with:

```ts
  readonly detailFields = computed<DetailField[]>(() => {
    const meta = this.selectedDetail()?.meta;
    const itemId = meta?.['itemId'];
    const live = typeof itemId === 'string' ? this.liveStatus.statuses()[itemId] : undefined;
    return toDetailFields(live ? { ...meta, status: live } : meta);
  });
```

- [ ] **Step 3.5: Run tests — verify pass**

```bash
node_modules/.bin/ng test --no-watch
```

Expected: PASS (the overlay test + the existing Details tests + the full suite).

- [ ] **Step 3.6: Production build**

```bash
node_modules/.bin/ng build
```

Expected: clean compile.

- [ ] **Step 3.7: Commit**

```bash
git add apps/studio-ui/src/app/system-editor/system-editor.page.ts apps/studio-ui/src/app/system-editor/system-editor.page.spec.ts
git commit -m "feat(live-status): inspector overlays live status; editor-scoped poll lifecycle"
```

> **Controller note:** after Task 3, open the studio PR, run the wave (charter-checker + qa-engineer + local-ci), merge, run the ritual, then browser re-verify: open the Foundry system, select a work-item, append a claim/merge event to the foundry log, and confirm the Details Status changes within ~5s without a reload.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| D1 — auto-poll, editor-scoped, 5s | Task 2 (`POLL_MS`, start/stop) + Task 3 (ngOnInit/ngOnDestroy) |
| D2 — lightweight `GET /api/item-status` reusing buildStatusByItemId | Task 1 |
| D3 — ephemeral overlay signal, not draft-patch | Task 2 (signal) + Task 3 (overlay in detailFields) |
| D4 — inspector Details only | Task 3 (only detailFields touched) |
| D5 — fail-soft (keep last; static shows until first poll) | Task 1 (try/catch → {}) + Task 2 (poll catch keeps signal) |
| LiveStatusService unit (poll/interval/fail/stop) | Task 2 (4 tests) |
| inspector overlay-wins test | Task 3 |
| foundry integration test | Task 1 (2 tests) |

All covered. ✓

**Placeholder scan:** No TBD/TODO. The only deferral note (Task 3 "match the existing mount helper") points at the in-repo spec pattern; the assertions are complete. ✓

**Type consistency:** `LiveStatusService.statuses: Signal<Record<string,string>>` + `start()`/`stop()` defined in Task 2, consumed identically in Task 3 (overlay reads `this.liveStatus.statuses()[itemId]`) and the Task 3 fake mirrors the same shape. The endpoint contract `{ ok, statuses: Record<string,string> }` is produced in Task 1 and consumed in Task 2's `poll()`. ✓
