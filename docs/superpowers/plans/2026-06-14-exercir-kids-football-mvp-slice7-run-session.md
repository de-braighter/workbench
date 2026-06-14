# Exercir kids-football MVP — Slice 7 (run session) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pitch-side session runner — a mobile-width page where a coach takes attendance, starts a session, runs each drill against a **derive-on-read countdown** (computed from `run.drillStartedAt`, so it survives reload), and finishes with per-drill effect checks — completing the coach loop (drills → template → schedule → **run**) and the first-sellable milestone (slices 1+4+5+6+7).

**Architecture:** Single-repo, NO new table, NO new endpoint, NO cross-layer work. The run **populates** the `event.run` + `event.attendance` JSONB columns (built empty in slice 6) through the **existing `updateEvent` use-case** (PATCH `/kids-football/events/:id` with `{run}` / `{attendance, run}`), which already RBAC-gates (`eventWrite`) + emits the persisted `event.updated` audit. The timer is pure derive-on-read (ADR-176): the live countdown is `it.min*60 − (now − run.drillStartedAt)/1000`, recomputed on a 1s tick, never persisted. New work: one pure timer helper in contracts + one bespoke Angular run-session page (replacing the slice-6 `run/:eventId` stub).

**Tech Stack:** Angular (standalone + signals) + the existing NestJS/Prisma event vertical (unchanged), Nx + vitest, `@de-braighter/substrate-{contracts,runtime}@^2.1.1` (already pinned).

**Repo:** `domains/exercir`. **Branch:** `feat/kids-football-s7-run-session` off `origin/main` (= e466e72, which HAS slice 6) in a **fresh manual worktree `domains/exercir-wt-kf-s7`** (a parent `isolation:worktree` worktrees the WORKBENCH, not exercir):

```bash
cd domains/exercir
git fetch origin && git worktree add ../exercir-wt-kf-s7 -b feat/kids-football-s7-run-session origin/main
cd ../exercir-wt-kf-s7
GITHUB_TOKEN=ghp_… npm ci            # @de-braighter/* from GitHub Packages (read:packages)
npm ls @de-braighter/substrate-runtime   # expect 2.1.1
```

Work entirely in `../exercir-wt-kf-s7` so the main clone's dev servers stay untouched. **Gate:** `npm run ci:local` + `npm run test:db`.

**Design sources of truth:** `docs/superpowers/specs/2026-06-14-exercir-kids-football-s7-run-session-design.md` · prototype `domains/exercir/docs/design/exercir-mvp-handoff/exercir/proto/run-session.jsx` (THE authoritative pre-start/live/wrap-up logic — read it in full) · handoff README screen 7 · the slice-6 calendar vertical (the event/`updateEvent`/client/store this consumes) + `2026-06-14-exercir-kids-football-s6-calendar-design.md`.

---

## Design decisions (resolved at plan time — pinned)

### D-1. Derive-on-read timer (ADR-176) — the one real engineering piece
The countdown = `it.min*60 − (now − run.drillStartedAt)/1000`; "started ago" = `now − run.startedAt`. `drillStartedAt`/`startedAt` (ms epoch) are the ONLY persisted times. `now`, `remaining`, elapsed are NEVER persisted. The page owns `now` (a signal ticked by one 1s `setInterval`, cleared on destroy). Reload re-reads `run.drillStartedAt` from the event → resumes exactly. All timer math lives in pure, clock-injected `kf-run-timer.ts` helpers (tested with a FIXED `now`, never `new Date()` / hardcoded dates — the SSE-PT24H + slice-6 calendar-date lesson).

### D-2. Run mutations reuse `updateEvent` — no new use-case/endpoint
Action-driven patches (start / mark-done / skip / rate / finish — NOT per-tick) via `client.updateEvent(eventId, {run})` / `{attendance, run}`. Each emits the slice-6 `event.updated` audit; volume stays bounded (~6–12 rows/session). NO new audit subtype. NO API changes.

### D-3. Start snapshots attendance, default present
`start()` builds `attendance[m.id] = existing[m.id] ?? 'present'` for every active-team Player-role member + inits `run = { startedAt: now, idx:0, drillStartedAt: now, log:[], ratings:{}, completed:false }` in ONE `updateEvent({attendance, run})` patch.

### D-4. Permissions reuse `eventWrite` — no new permission; roster via the client
Running mutates the event → `eventWrite` (coach + assistantCoach; teamManager excluded — handoff "no run-session"). The attendance roster loads via `client.listMembers(activeTeamId)` (server-side team filter) → filter `role === 'Player'` (mirror `members-page.component.ts`'s `loadMembers`). coach + assistantCoach already hold `memberRead` (pack-manifest:75,82) — no new grant. NO store change (the store has no members collection; the members-admin page also uses the client directly).

### D-5. `subjectSensitivity` stays UNSET (founder-confirmed)
The run captures attendance FACTS + per-DRILL effect checks (`run.ratings`: a coach gut-call "did this drill deliver") — NO inferred player state. `PackManifest.subjectSensitivity` stays unset. The per-player development aggregation (slice 8) is where the ADR-187/188/189 trigger fires. NO manifest change this slice.

### D-6. Replace the slice-6 stub
`run/:eventId` currently → `RunSessionStubPageComponent` (`lib/run/run-session-stub.page.component.ts` + spec). Slice 7 creates `run-session-page.component.ts`, repoints the route to it, and DELETES the stub + its spec. The event-detail "Run session" button (slice 6) already routes to `run/:eventId` with the Run/Resume/Session-report label flip.

### D-7. Effect-check seam (read-only here, slice-8 ready)
The drill `effect` text is surfaced in the live callout + wrap-up; `run.ratings` (per drill) + `event.attendance` are the persisted evidence slice 8 aggregates. NO promotion to a kernel effect-declaration.

### D-8. Pinned deviations
- The page is ONE component with three `@if` phase-views (mirrors the prototype's single `RunSession`); decompose styles into `club-grass.css` to stay under the **8kB per-component CSS budget** (prod build enforces it). If the single component's inline style approaches 8kB, extract a shared `run-*` sub-component — but prefer one component for state cohesion.
- attendance status conveyed in TEXT (not color alone) — a11y. The ticking countdown is in an `aria-live="off"` region (never announce each second); announce only phase/drill transitions if at all.

---

## Pre-flight (read before Task 1)

Read these reference files (adapt; don't copy comments verbatim):
- **The prototype** `docs/design/exercir-mvp-handoff/exercir/proto/run-session.jsx` — the EXACT logic: `fmtClock`, `start`/`advance(skipped)`/`rate`/`finish`, the `remaining`/`over` derivation, the `ORDER` attendance cycle, the not-started / completed / live branch conditions, the `min(100%,460px)` wrap, the ink header.
- **The slice-6 event surface:** `libs/pack-kids-football-contracts/src/events.ts` (`RunSchema`, `EventRun`, `MEMBER_ATTENDANCE`, `MemberAttendance`, `ExercirEvent`) · `lib/data/kids-football-api.client.ts` (`updateEvent(id, patch)`, `listMembers(teamId?)`) · `lib/data/kf-club-store.ts` (`events()`/`loadEvents()`, `templates()`/`loadTemplates()`, `drills()`/`loadDrills()`, the load-error signals) · `lib/calendar/event-detail-modal.component.ts` (the Run-session button + label flip + how it reads `event.run`) · `lib/calendar/calendar-page.component.ts` (the `KF_ACTIVE_TEAM_ID` token usage + the `now = signal(new Date())` + 1s-tick pattern — mirror it).
- **The stub to replace:** `lib/run/run-session-stub.page.component.ts` (+ spec) · `lib/routes.ts` (the `run/:eventId` route) · `lib/admin/members-page.component.ts` `loadMembers()` (~line 847 — the `client.listMembers(teamId)` roster pattern to mirror).
- **UI reuse:** `lib/drills/kf-phase-colors.ts` (`KF_PHASE_COLORS`/`KF_PHASE_FALLBACK`) · `lib/drills/kf-phase-tag.component.ts` · `lib/drills/sketch/kf-sketch-thumbnail.component.ts` (or the sketch render core) · `lib/shell/kf-route-tenant.ts` (`resolveTenantFromRoute`) · `lib/data/map-kf-error.ts` · `lib/kf-i18n.ts` (`kfMsg`/`kfMsgSubst`) · `lib/shell/kf-active-team.token.ts` (`KF_ACTIVE_TEAM_ID`).

**Battle-tested gotchas (slices 1–6 memory):**
- **`cmd | tail` masks the exit code** — gates run WITHOUT a masking pipe + capture `$?` (`npm run ci:local > /tmp/ci.log 2>&1; echo "EXIT=$?"`; READ the log).
- **8kB per-component CSS budget** (prod build ERROR; `nx serve` hides it) — run `nx build pack-football-visual-editor` to catch it; trim inline styles / share in `club-grass.css`.
- **Foreground long `sleep` BLOCKED** — wait for a dev server via Bash `run_in_background:true` + an until-loop on `localhost:4200|bundle generation complete` OR `Failed to compile|EADDRINUSE`.
- **`@nx/angular:unit-test` rejects `--include`/`--run`/positional spec filters** — run the full project suite: `NX_DAEMON=false npx nx test <project>`.
- **jsdom `localStorage` is a Proxy** — `vi.spyOn` silently dropped; seed the real store or `vi.stubGlobal`.
- **Time-coupled tests rot** — the timer tests MUST use a FIXED/injected `now`, never `new Date()` / hardcoded calendar dates. The page passes its `now` signal down so the component is testable deterministically.
- **devloop ritual** (MANDATORY, `npx tsx src/cli.ts` from `domains/devloop`): `post-findings` FULL `de-braighter/exercir#NN` form + the Write tool for JSON (PowerShell BOM breaks the parse); severity `blocking|should-fix|nit|note`; `backfill`/`reviews`/`resolve-findings` take `de-braighter/exercir`; `drain`/`reconcile`/`post-findings` take `exercir#NN`. `gh pr merge` right after a push may report "not mergeable (UNKNOWN)" — GitHub computes it async; wait ~12s + retry.

## File structure (created/modified in this slice)

| File | Responsibility | Task |
|---|---|---|
| `libs/pack-kids-football-contracts/src/kf-run-timer.ts` (+ spec) · `src/index.ts` | pure clock-injected timer/run helpers (`fmtClock`, `drillRemainingSec`, `elapsedSec`, `ATTENDANCE_CYCLE`, `cycleAttendance`, `startRun`, `advanceRun`, `finishRun`) | 1 |
| `libs/pack-kids-football-ui/src/lib/run/run-session-page.component.ts` (+ spec) | the bespoke run-session page (pre-start / live / wrap-up); replaces the stub | 2 |
| `lib/routes.ts` · `lib/run/run-session-stub.page.component.ts` (+ spec) DELETE · `lib/kf-i18n.ts` | route → real page; remove stub; run i18n keys | 3 |
| `apps/pack-kids-football-api/src/app/events.e2e.spec.ts` | confirm run/attendance PATCH (coach 200, teamManager 403) | 4 |
| — | slice gate, browser run-through, PR, verifier wave, ritual | 5 |

---

## Task 1: Contracts — pure run-timer + run-state helpers

**Files:**
- Create: `libs/pack-kids-football-contracts/src/kf-run-timer.ts`, `…/kf-run-timer.spec.ts`
- Modify: `libs/pack-kids-football-contracts/src/index.ts`

- [ ] **Step 1: Write the failing spec** (`kf-run-timer.spec.ts`; ALL clock-injected — pass `nowMs`, never read the clock):
  - `fmtClock(0)`→`'0:00'`; `fmtClock(65)`→`'1:05'`; `fmtClock(-65)`→`'1:05'` (abs); `fmtClock(600)`→`'10:00'`.
  - `drillRemainingSec(10, 1_000_000, 1_300_000)` → `300` (10min plan, 300s elapsed → 300 left); `drillRemainingSec(10, 1_000_000, 1_700_000)` → `-100` (overtime negative).
  - `elapsedSec(1_000_000, 1_038_000)` → `38`.
  - `ATTENDANCE_CYCLE` deep-equals `['present','absent','sick','holiday','school']`; `cycleAttendance('present')`→`'absent'`; `cycleAttendance('school')`→`'present'` (wraps); `cycleAttendance('sick')`→`'holiday'`.
  - `startRun(['p1','p2'], {}, 5_000)` → `{ attendance:{p1:'present',p2:'present'}, run:{ startedAt:5_000, idx:0, drillStartedAt:5_000, log:[], ratings:{}, completed:false } }`; with an existing `{p1:'absent'}` → preserves `p1:'absent'`, defaults `p2:'present'`.
  - `advanceRun(run, items, false, 9_000)` (run at idx 0, drillStartedAt 5_000, items `[{drillId:'d1',min:10},…]`) → appends `log:[{drillId:'d1',plannedMin:10,actualSec:4,skipped:false}]`, `idx:1`, `drillStartedAt:9_000`; `advanceRun(run, items, true, 9_000)` → `actualSec:0, skipped:true`.
  - `finishRun(run, 12_000)` → `{...run, completed:true, finishedAt:12_000}`; `finishRun({...run, finishedAt:11_000}, 12_000)` keeps the original `finishedAt:11_000` (idempotent finish — mirrors the prototype's `finishedAt: run.finishedAt || Date.now()`).
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx test pack-kids-football-contracts`.
- [ ] **Step 3: Implement `kf-run-timer.ts`:**

```ts
/**
 * Pure run-session timer + state helpers (slice 7). Clock is ALWAYS injected
 * (`nowMs`/`*Ms` args) — never read the clock here, so the live timer is
 * derive-on-read (ADR-176) and tests pin time. Mirrors the prototype
 * run-session.jsx (fmtClock / start / advance / finish).
 */
import type { EventRun, MemberAttendance } from './events.js';

/** "M:SS" of |sec| (rounded). */
export function fmtClock(sec: number): string {
  const s = Math.abs(Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
/** Seconds left on a drill (negative = overtime). Derived, never stored. */
export function drillRemainingSec(plannedMin: number, drillStartedAtMs: number, nowMs: number): number {
  return plannedMin * 60 - (nowMs - drillStartedAtMs) / 1000;
}
/** Seconds since the session started. Derived, never stored. */
export function elapsedSec(startedAtMs: number, nowMs: number): number {
  return (nowMs - startedAtMs) / 1000;
}

export const ATTENDANCE_CYCLE = ['present', 'absent', 'sick', 'holiday', 'school'] as const;
export function cycleAttendance(s: MemberAttendance): MemberAttendance {
  const i = ATTENDANCE_CYCLE.indexOf(s);
  return ATTENDANCE_CYCLE[(i + 1) % ATTENDANCE_CYCLE.length];
}

export interface RunItem { drillId: string; min: number; }

/** Snapshot attendance (default present) + init the run state. */
export function startRun(
  playerIds: readonly string[],
  existing: Readonly<Record<string, MemberAttendance>>,
  nowMs: number,
): { attendance: Record<string, MemberAttendance>; run: EventRun } {
  const attendance: Record<string, MemberAttendance> = {};
  for (const id of playerIds) attendance[id] = existing[id] ?? 'present';
  return { attendance, run: { startedAt: nowMs, idx: 0, drillStartedAt: nowMs, log: [], ratings: {}, completed: false } };
}

/** Advance to the next drill, logging the current one's actual time. */
export function advanceRun(run: EventRun, items: readonly RunItem[], skipped: boolean, nowMs: number): EventRun {
  const it = items[run.idx];
  return {
    ...run,
    log: [...run.log, { drillId: it.drillId, plannedMin: it.min, actualSec: skipped ? 0 : Math.round((nowMs - run.drillStartedAt) / 1000), skipped }],
    idx: run.idx + 1,
    drillStartedAt: nowMs,
  };
}

/** Mark the run complete (idempotent finishedAt). */
export function finishRun(run: EventRun, nowMs: number): EventRun {
  return { ...run, completed: true, finishedAt: run.finishedAt ?? nowMs };
}
```

  Confirm `EventRun` (from `events.ts`) has `startedAt/drillStartedAt/idx/completed/finishedAt?/log[{drillId,plannedMin,actualSec,skipped}]/ratings`. Export everything from `src/index.ts`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-contracts/src/kf-run-timer.ts libs/pack-kids-football-contracts/src/kf-run-timer.spec.ts libs/pack-kids-football-contracts/src/index.ts` then `git commit -m "feat(exercir): kids-football S7 — pure run-session timer + state helpers"` (append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`).

## Task 2: Run-session page (pre-start / live / wrap-up)

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/run/run-session-page.component.ts`, `…/run-session-page.component.spec.ts`

> ONE standalone OnPush component, mobile-width `min(100%, 460px)` centered, ink header — recreating `run-session.jsx`. Keep inline CSS minimal (share in `../club-grass.css`); run the PROD build at the end to verify the 8kB budget.

- [ ] **Step 1: Write the failing spec** (`run-session-page.component.spec.ts`; inject a FIXED clock — make `now` overridable, e.g. a protected `now = signal(<fixed>)` the test sets, or accept a `nowFn`; stub `KidsFootballApiClient` (`updateEvent`, `listMembers`) + `KfClubStore` (`events`/`templates`/`drills` pre-populated) + `KF_ACTIVE_TEAM_ID`):
  - **load:** `ngOnInit` resolves the event by route `:eventId` (`store.events().find` → `loadEvents()` fallback), its template (`store.templates()` → `loadTemplates()`), drills (`loadDrills()`), and the roster (`client.listMembers(activeTeamId)` filtered to `role==='Player'`); not-found event → a not-found state; load error → error state.
  - **pre-start** (event with no `run` / `run.startedAt` falsy): renders the attendance chips for each player ("Who's here? · {present} of {n}"); tapping a chip calls `client.updateEvent(eventId, {attendance:{...cycled}})`; "Tonight's plan" lists the template drills; **Start session** calls `client.updateEvent` with the `startRun(...)` snapshot ({attendance, run}) and transitions to live.
  - **live** (`run.startedAt && run.idx < items.length && !run.completed`): the current drill card shows `fmtClock(drillRemainingSec(it.min, run.drillStartedAt, now))`; with a `now` set so remaining is negative it shows `+M:SS` + the overtime/danger class + "over the {min}′ plan"; "Drill {idx+1} of {n} · started {fmtClock(elapsed)} ago"; progress segments (done count = `run.idx`); **Mark drill done** calls `updateEvent({run: advanceRun(...)})` ; **Skip** → `advanceRun(...,true)`; the last drill's primary button reads "Done — wrap up session"; "Up next" shows `items[idx+1]`.
  - **RELOAD-SURVIVAL (the key test):** mount the component with an event whose `run.drillStartedAt` is `now − 120s` (fixed clock) and `it.min = 10` → the countdown renders `8:00` (600−120), proving the timer derives from the persisted `drillStartedAt` and was NOT reset on mount.
  - **wrap-up** (`run.idx >= items.length || run.completed`): per-drill rows show `{fmtClock(log.actualSec)} run · {plannedMin}′ planned` (or "skipped") + the drill `effect`; the "✓ On track"/"Not yet" pills call `updateEvent({run:{...ratings}})` (toggling off when re-tapped, mirroring the prototype's `ratings[id]===v ? undefined : v`); **Finish & save** calls `updateEvent({run: finishRun(...)})`; a completed run shows "Back to calendar".
  - **write failures** surface (try/catch → a `role="alert"`), mirroring the calendar page's `mapKfError` handling.
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx test pack-kids-football-ui`.
- [ ] **Step 3: Implement** `run-session-page.component.ts` (`selector:'lib-kf-run-session-page'`, standalone, OnPush, `styleUrls:['../club-grass.css']` + minimal inline). Inject `ActivatedRoute`, `Router`, `KfClubStore`, `KidsFootballApiClient`, `KF_ACTIVE_TEAM_ID`. The page OWNS `now`: `protected readonly now = signal(Date.now())` + an effect/ngOnInit `setInterval(() => this.now.set(Date.now()), 1000)` cleared in `ngOnDestroy` (the ONLY clock). Signals: the resolved `event`/`template`/`drills`/`players` (loaded in ngOnInit; `players = roster.filter(m => m.role==='Player')`). Derived: `run = computed(() => event()?.run ?? null)`; `items = computed(() => template()?.items ?? [])`; phase = computed from `run` (pre-start / live / wrap-up) per the prototype branch conditions. Use the `kf-run-timer` helpers for ALL time math + state transitions:
  - attendance toggle → `updateEvent(id, { attendance: { ...att, [m.id]: cycleAttendance(stOf(m)) } })` then refresh the local event (re-read from the response or `loadEvents()`).
  - start → `updateEvent(id, startRun(players().map(p=>p.id), event().attendance ?? {}, this.now()))`.
  - advance(skipped) → `updateEvent(id, { run: advanceRun(run()!, items(), skipped, this.now()) })`.
  - rate(drillId,v) → `updateEvent(id, { run: { ...run()!, ratings: { ...run()!.ratings, [drillId]: run()!.ratings[drillId]===v ? undefined : v } } })` (drop the key when toggled off).
  - finish → `updateEvent(id, { run: finishRun(run()!, this.now()) })`.
  After each write, update the local `event` signal from the returned event (so the derived timer/phase re-render) and surface failures via a `writeError` signal in a `role="alert"`. Render the three phases as `@if` blocks (mirror the prototype's `wrap`/`header`/branches): the ink header (← Calendar back link via `resolveTenantFromRoute`, date·pitch kicker, template name), the attendance chips (status in text + color), the live current-drill card (`KfPhaseTag`, name, the countdown `dsp`-styled tabular-nums with the over/danger flip, `kf-sketch-thumbnail` or sketch render, organisation, numbered points, the expected-effect callout), the progress bar (`KF_PHASE_COLORS`), "Up next", Skip/Mark-done, and the wrap-up effect-check rows + Finish. i18n keys via `kf-i18n.ts` (add in Task 3's pass or here — keep them in `kf-i18n.ts`): `kf.run.back`, `kf.run.whosHere` (subst {present}{total}), `kf.run.cyclehint`, `kf.run.tonightsPlan`, `kf.run.start`, `kf.run.drillOf` (subst {k}{n}), `kf.run.startedAgo` (subst {clock}), `kf.run.overPlan` (subst {min}), `kf.run.ofPlan` (subst {min}), `kf.run.upNext`, `kf.run.skip`, `kf.run.markDone`, `kf.run.wrapUp`, `kf.run.effectCheckTitle`, `kf.run.effectCheckHint`, `kf.run.onTrack`, `kf.run.notYet`, `kf.run.finish`, `kf.run.backToCalendar`, `kf.run.expected`, `kf.run.skipped`, `kf.run.runPlanned` (subst {actual}{planned}), `kf.run.notFound`, `kf.run.loadError`, `kf.run.saveFailed`.
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx run-many -t lint test --projects=pack-kids-football-ui`, THEN the PROD build `NX_DAEMON=false npx nx build pack-football-visual-editor > /tmp/s7-build.log 2>&1; echo "EXIT=$?"` (READ it; trim the component style under 8kB if it errors).
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/run/run-session-page.component.ts libs/pack-kids-football-ui/src/lib/run/run-session-page.component.spec.ts libs/pack-kids-football-ui/src/lib/kf-i18n.ts` then `git commit -m "feat(exercir): kids-football S7 — run-session page (pre-start/live/wrap-up, derive-on-read timer)"` (append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`).

## Task 3: Route swap + remove the stub

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/routes.ts`, `lib/kf-i18n.ts` (confirm the run keys from Task 2 are present)
- Delete: `lib/run/run-session-stub.page.component.ts`, `lib/run/run-session-stub.page.component.spec.ts`

- [ ] **Step 1: Repoint the route.** In `routes.ts`, change the `run/:eventId` route's `loadComponent` from `./run/run-session-stub.page.component.js` `RunSessionStubPageComponent` to `./run/run-session-page.component.js` `RunSessionPageComponent`; update the route-shape doc-comment ("run/:eventId → RunSessionPageComponent (slice 7)").
- [ ] **Step 2: Delete the stub** files (`run-session-stub.page.component.ts` + `.spec.ts`). Grep for any other reference to `RunSessionStubPageComponent` (`grep -rn RunSessionStub libs apps`) and remove/repoint them.
- [ ] **Step 3: Verify build + tests** — `NX_DAEMON=false npx nx run-many -t lint test build --projects=pack-kids-football-ui` (build catches a dangling stub import).
- [ ] **Step 4: Commit** — `git add libs/pack-kids-football-ui/src/lib/routes.ts libs/pack-kids-football-ui/src/lib/kf-i18n.ts && git rm libs/pack-kids-football-ui/src/lib/run/run-session-stub.page.component.ts libs/pack-kids-football-ui/src/lib/run/run-session-stub.page.component.spec.ts` then `git commit -m "feat(exercir): kids-football S7 — route run/:eventId to the real run-session page; remove the stub"` (append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`).

## Task 4: Events PATCH e2e — run/attendance round-trip + RBAC

**Files:**
- Modify: `apps/pack-kids-football-api/src/app/events.e2e.spec.ts`

- [ ] **Step 1: Write the failing e2e cases** (mirror the existing event e2e setup): as a club-A **coach**, create a training event, then `PATCH /kids-football/events/:id` with `{ attendance: { <memberId>: 'present' } }` → 200 and the returned event carries the attendance; `PATCH` with `{ run: { startedAt: 1, idx: 0, drillStartedAt: 1, log: [], ratings: {}, completed: false } }` → 200 and the event carries `run`; as a club-A **teamManager**, `PATCH …/events/:id` `{run:{...}}` → **403** (eventWrite gate). (If the existing e2e already covers a generic PATCH + the teamManager 403, ADD only the run/attendance-shaped assertions.)
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx test pack-kids-football-api`.
- [ ] **Step 3: Implement** — no app code change expected (slice 6's `updateEvent` already accepts `run`/`attendance` partials + RBAC-gates `eventWrite`). If a case fails because the PATCH validation rejects a valid `run`/`attendance` partial, fix the validation in `UpdateEventService`/the controller (it should accept these — `UpdateEventPatch` includes both keys). Most likely the test just passes once written (confirming the slice-6 path).
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx test pack-kids-football-api`.
- [ ] **Step 5: Commit** — `git add apps/pack-kids-football-api/src/app/events.e2e.spec.ts` then `git commit -m "test(exercir): kids-football S7 — events PATCH run/attendance round-trip + teamManager 403 e2e"` (append `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`).

## Task 5: Slice gate, browser run-through, PR, verifier wave, ritual

- [ ] **Step 1: Full local gate.** From `../exercir-wt-kf-s7`: `npm run ci:local > /tmp/s7-ci.log 2>&1; echo "EXIT=$?"` (NO masking pipe — READ it; watch the CSS budget) and `npm run test:db > /tmp/s7-db.log 2>&1; echo "EXIT=$?"` (Postgres :5545 — no new DB shape, but the event PATCH path + the slice-6 RLS/audit proofs stay green).
- [ ] **Step 2: Browser run-through** (kill orphan :3150/:4200 first; serve the worktree api `PORT=3150` + host :4200 via `&`-detached logged commands; wait via a `run_in_background` until-loop on `localhost:4200|bundle generation complete` OR `Failed to compile|EADDRINUSE`). As a coach: open a scheduled training (schedule one first if the in-memory store is empty — build a template + add a U9 slot via clubAdmin + schedule, OR reuse the slice-6 flow) → its event-detail → **Run session** → take attendance (cycle a couple of players) → **Start** → on the live screen watch the countdown tick + go overtime → **reload the page mid-session** and confirm the countdown RESUMES (the derive-on-read proof) → advance/skip through the drills → wrap-up: toggle a couple of "✓ On track"/"Not yet" → **Finish & save** → back on the calendar/detail the event shows "✓ Done". Screenshot to `de-braighter/docs/club-grass-run-session-s7-proof.png`.
- [ ] **Step 3: Story issue + PR.** Open the exercir story issue (`type/story`, slice 7) + the PR BEFORE the wave. PR body: the conventional summary + the twin lines:
  - `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`
  - `Effort: standard` (single-repo, no cross-layer; full wave but no designer-first substrate work)
  - `Effect: cycle-time 0.01±0.02 expert` and `Effect: findings 5±4 expert` (self-observing cross-repo indicators only).
  - State the decisions: D-1 (derive-on-read timer), D-2 (reuse updateEvent), D-5 (subjectSensitivity stays unset), D-6 (stub replaced). Note: completes the first-sellable milestone (1+4+5+6+7).
- [ ] **Step 4: Verifier wave** (review floor: non-trivial → full wave). Spawn in parallel, read-only against the worktree (NO git-writes, NO main-clone access, NO isolation:worktree — point them at the worktree): `reviewer` + `charter-checker` + `exercir-charter-checker` + `qa-engineer` (`local-ci` already run in Step 1). Wave prompt notes: subjectSensitivity stays unset by design (D-5, run = facts + per-drill checks, not per-player inference); the timer is derive-on-read (D-1 — verify no ticking value is persisted + the reload-survival test exists); run mutations reuse `updateEvent` so they ride the slice-6 `event.updated` audit (D-2 — no new audit gap); teamManager is correctly excluded from run (eventWrite). Specifically ask the reviewer to verify the timer NEVER persists `now`/`remaining` (the ADR-176 derive-on-read invariant) and that the reload-survival path is genuinely tested.
- [ ] **Step 5: Post-findings → fix → merge → twin ritual.** Write the wave findings to a temp JSON (`[{verifier, severity, path?, line?, text}]`, severity ∈ `blocking|should-fix|nit|note`) via the Write tool; `npx tsx src/cli.ts post-findings de-braighter/exercir#NN findings.json` (from `domains/devloop`) BEFORE merge. Fix any blocking/should-fix in the worktree (re-run the gate). Merge (squash; if "not mergeable UNKNOWN", wait ~12s + retry). Then the **mandatory twin ritual**: `drain exercir#NN` → `backfill de-braighter/exercir` → `reconcile exercir#NN` → `reviews de-braighter/exercir` → `resolve-findings de-braighter/exercir`. Update the `exercir-kids-football-mvp-arc` memory (slice 7 SHIPPED; RESUME → slice 8 team/player view + subjectSensitivity FIRES) and **tell the founder the first-sellable milestone (1+4+5+6+7) is COMPLETE**. Remove the worktree (`git worktree remove ../exercir-wt-kf-s7 --force` + `git worktree prune`; NEVER robocopy/MIR near node_modules) after verifying the PR LANDED.

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task: §4.1 timer helpers → T1; §4.3 the run page (pre-start/live/wrap-up + derived timer + roster load + updateEvent patches) → T2; §4.3 route swap + stub removal → T3; §4.2 events PATCH e2e → T4; §5 gate/run-through/ritual → T5. §3 (no new table) → honoured (no migration task). The §6 out-of-scope items (slice-8 development view, effect promotion, the O(events) index) are explicitly deferred, not built.

**2. Placeholder scan** — no TBD/TODO; T1 ships complete helper code; T2 names every reuse + the exact `updateEvent` patch shapes + the full i18n key list; T3/T4 are concrete edits. The one judgement call (single component vs sub-components for the CSS budget) has a clear default (one component; extract only if >8kB).

**3. Type consistency** — `kf-run-timer` helpers (`fmtClock`/`drillRemainingSec`/`elapsedSec`/`cycleAttendance`/`startRun`/`advanceRun`/`finishRun`) defined T1, consumed T2; they operate on `EventRun`/`MemberAttendance`/`RunItem` (from `events.ts`, slice 6); the page calls `client.updateEvent(id, patch)` + `client.listMembers(teamId)` (slice-6 client) with `{run}`/`{attendance}` partials matching `UpdateEventPatch`; `KF_ACTIVE_TEAM_ID` + `KF_PHASE_COLORS` + `resolveTenantFromRoute` reused as in the calendar page; the route swaps `RunSessionStubPageComponent` → `RunSessionPageComponent`. Consistent.
