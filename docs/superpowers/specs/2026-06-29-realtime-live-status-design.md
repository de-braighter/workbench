# Real-Time Live Status — Design

- **Date:** 2026-06-29
- **Status:** Draft for founder review
- **Scope:** `domains/foundry` (new lightweight endpoint) + `domains/studio` (LiveStatusService + inspector overlay + editor lifecycle)
- **Builds on:** the live-status join (foundry#79 — `buildStatusByItemId` + the server-side join that sets the *initial* status at catalog load). This keeps that status *fresh while the editor is open*.
- **Constraints:** ZERO kernel change · read-only · ADR-176-aligned (the live status is an ephemeral overlay signal, never persisted, never patched into the kernel draft — "store generators, derive graphs")

## 1. Purpose

Today the node-detail Details "Status" is **static-at-load**: foundry#79 joins the live `itemStatus` once, when the studio fetches `/api/catalog`. It does not change as foundry runs. This adds a **continuous, editor-scoped auto-poll** so the selected node's Status updates on its own while you watch — without re-fetching or mutating the catalog/draft.

## 2. Decisions

- **D1 — Auto-poll, editor-scoped.** A background timer (default 5s) re-fetches statuses while the system-editor is open; it starts on editor open and stops on destroy. (The studio has no auto-poll today — the Operate tab is load-once + manual reload — so this is a new, deliberately-bounded pattern.)
- **D2 — Lightweight dedicated endpoint.** A new `GET /api/item-status` returns only `{ itemId → ItemStatus }`. It reuses `buildStatusByItemId` (foundry#79) over a per-request fold. Rejected: polling `/api/catalog` (heavy; wouldn't update the editor's already-projected draft anyway).
- **D3 — Ephemeral overlay signal, NOT a draft patch.** The live status lives in a studio `LiveStatusService` signal and is overlaid onto `meta.status` inside the existing `detailFields()` computed. Rejected: patching the kernel `BuildPathDraft` per poll via `metadata-patch` edits — heavy, pollutes the edit history, couples a display concern to the authoring engine.
- **D4 — Inspector Details only.** That is the only per-item status surface. The catalog card ("N work-items") and the flat `/plan-tree` panel show no per-item status; out of scope.
- **D5 — Fail-soft, no blank.** A poll failure keeps the last-known status map; the static (foundry#79) value remains visible until the first successful poll. The static join stays the source of the *initial* value.

## 3. Architecture & data flow

```
foundry (new endpoint)                     studio (new service + existing inspector overlay)
──────────────────────                     ─────────────────────────────────────────────────
GET /api/item-status                   →   LiveStatusService
  fold(readEnvelopes(logPath))               setInterval(POLL_MS) → fetch /api/item-status
  → buildStatusByItemId(state, now)          → statuses = signal<Record<string,string>>({})
  → { ok:true, statuses:{itemId:status} }    start()/stop(); fail-soft (keep last)
  (try/catch → {} on fold error)                 │ statuses() read here makes it reactive
                                                 ▼
                                           detailFields() = toDetailFields(
                                             live ? { ...meta, status: live } : meta )
                                           system-editor: start() in ngOnInit, stop() in ngOnDestroy
```

## 4. Foundry — `GET /api/item-status`

A new route in `src/dashboard/server.ts`, mirroring the existing read routes (CORS `http://localhost:4200`, `{ ok: true, ... }` envelope):

```ts
if (req.method === 'GET' && req.url === '/api/item-status') {
  let statuses: Record<string, string> = {};
  try {
    const state = fold(readEnvelopes(deps.logPath));
    statuses = Object.fromEntries(buildStatusByItemId(state, Date.now()));
  } catch {
    // log unreadable → empty map; never crash
  }
  res.writeHead(200, { 'content-type': 'application/json', 'Access-Control-Allow-Origin': CORS_ORIGIN, 'Access-Control-Allow-Methods': 'GET' });
  res.end(JSON.stringify({ ok: true, statuses }));
  return;
}
```

`fold`/`readEnvelopes`/`buildStatusByItemId` are already imported (the latter from foundry#79). No new module needed on the foundry side.

## 5. Studio — `LiveStatusService`

**New file:** `apps/studio-ui/src/app/system-editor/live-status.service.ts`

```ts
@Injectable()  // provided at the system-editor component (editor-scoped lifecycle)
export class LiveStatusService {
  private readonly statusesSig = signal<Record<string, string>>({});
  readonly statuses = this.statusesSig.asReadonly();
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Begin polling every POLL_MS. Idempotent (a second start() is a no-op). */
  start(): void {
    if (this.timer !== null) return;
    void this.poll();                       // immediate first fetch
    this.timer = setInterval(() => void this.poll(), POLL_MS);
  }

  stop(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
  }

  private async poll(): Promise<void> {
    try {
      const r = await fetch(ITEM_STATUS_URL);
      if (!r.ok) return;                     // keep last-known on HTTP error
      const body = (await r.json()) as { ok: boolean; statuses?: Record<string, string> };
      if (body.ok && body.statuses) this.statusesSig.set(body.statuses);
    } catch { /* network error → keep last-known */ }
  }
}
```

`const POLL_MS = 5000;` and `const ITEM_STATUS_URL = 'http://localhost:4555/api/item-status';` (the per-file URL-constant convention the other foundry adapters use). Status is typed `string` studio-side (the toDetailFields status renderer already treats it as a string; no need to import the foundry enum).

## 6. Studio — inspector overlay + lifecycle

In `system-editor.page.ts`:
- Inject `LiveStatusService` and add it to the component `providers` (so its lifecycle is editor-scoped).
- `ngOnInit` → `liveStatus.start()`; implement `OnDestroy` → `liveStatus.stop()`.
- Overlay in the existing `detailFields()` computed:

```ts
readonly detailFields = computed<DetailField[]>(() => {
  const meta = this.selectedDetail()?.meta;
  const itemId = meta?.['itemId'];
  const live = typeof itemId === 'string' ? this.liveStatus.statuses()[itemId] : undefined;
  return toDetailFields(live ? { ...meta, status: live } : meta);
});
```

Reading `this.liveStatus.statuses()` inside the computed makes the Details Status field re-render on each poll. No template change.

## 7. Error handling & lifecycle

- Poll failure (network throw / `!r.ok` / malformed) → the signal retains its previous value; the UI never blanks. The static foundry#79 value shows until the first successful poll.
- `stop()` clears the interval on editor destroy — no leaked timers. `start()` is idempotent.
- The foundry endpoint is fail-soft (fold error → `{ statuses: {} }`, 200).

## 8. Testing

- **Foundry** (append to `test/dashboard-catalog-endpoints.acid.test.ts`, mirroring its boot harness) — boot the server on port 0 with a temp log containing `itemQueued(foundry/x)`, `GET /api/item-status`, assert `body.ok === true` and `body.statuses['foundry/x'] === 'queued'`. Plus an empty-log case (fresh temp dir) → `body.statuses` is `{}`.
- **Studio `LiveStatusService`** — Vitest fake timers: `start()` does an immediate poll then one per `POLL_MS` (advance the timer, flush the mocked-fetch promise, assert `statuses()` updated); a failed poll keeps the last value; `stop()` clears the timer (no further fetches after advancing).
- **Studio inspector** — with a selected node whose `meta.itemId` has a live entry differing from `meta.status`, assert the Details Status shows the **live** value (overlay wins); with no live entry, the static value shows.

## 9. Out of scope (YAGNI)

- Live status in the catalog card, the flat `/plan-tree` panel, or any non-inspector surface.
- SSE/WebSocket push (polling is enough for a glance tool).
- Surfacing claim holder / gate / PR ref (status enum only — that's the "enrich Details" idea, a separate feature).
- Configurable interval UI (the 5s constant is editable in code; no settings surface).

## 10. Process

Two PRs via subagent-driven-development: **foundry** (`/api/item-status` + integration test) → review/wave/merge/ritual; then **studio** (`LiveStatusService` + inspector overlay + lifecycle + tests) → review/wave/merge/ritual. Browser re-verify at the end: open the Foundry system, select a work-item, append a claim/merge event to the foundry log, and watch the Details Status change within ~5s without a reload.
