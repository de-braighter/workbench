# Exercir kids-football MVP — Slice 7 (run session) design

> **Status:** approved (brainstorming) 2026-06-14. Slice 7 of the Club Grass kids-football MVP — the **pitch-side session runner**: pre-start attendance snapshot, a live per-drill countdown that **derives from `run.drillStartedAt`** (survives reload), and a wrap-up with per-drill effect checks. This is the **last piece of the first-sellable milestone** (slices 1+4+5+6+7 = drills → template → schedule → run).
> **Repo:** `domains/exercir` (single-repo; no cross-layer, no new table). **Substrate:** consumes the already-pinned `@de-braighter/substrate-{contracts,runtime}@^2.1.1` (auth/tenant/RLS + the persisted audit wired in slice 6).
> **Related:** `2026-06-11-exercir-kids-football-mvp-design.md` (§8 row 7, §5 the expected-effect seam) · `2026-06-14-exercir-kids-football-s6-calendar-design.md` (the event vertical + the `RunSchema`/`attendance` columns this populates + the `run/:eventId` stub this replaces) · handoff `domains/exercir/docs/design/exercir-mvp-handoff/README.md` screen 7 + prototype `exercir/proto/run-session.jsx` (the authoritative pre-start/live/wrap-up spec).

## 1. Goal

A coach (or assistant coach) runs a scheduled training **pitch-side from a phone**. Pre-start: a **who's-here attendance snapshot** (tap a player to cycle present → absent → sick → holiday → school) + "Tonight's plan" + a full-width **Start session**. Live: a **progress bar** (done = phase color, current = bright accent), "Drill k of n · started M:SS ago", a current-drill card with a **countdown** (`M:SS`, overtime flips to `+M:SS` red) showing the drill's sketch + organisation + coaching points + the expected-effect callout, an "Up next" row, and **Skip** / **Mark drill done** (last drill → "Done — wrap up session"). Wrap-up: per-drill **actual-vs-planned** time + the expected-effect text + two toggle pills **"✓ On track" / "Not yet"**, then **Finish & save**.

This completes the coach loop. The run **populates** the `event.run` + `event.attendance` JSONB columns (built empty in slice 6) through the **existing `updateEvent` use-case** — no new table, no new migration, no new endpoint. The kernel is used as the tenant/auth/RLS + **persisted-audit** substrate (each run patch emits `event.updated` to `kernel.audit_event`, wired in slice 6) — still **no kernel domain concepts, no inference**.

## 2. Decisions (2026-06-14 brainstorming)

1. **Derive-on-read timer (ADR-176, the one real engineering piece).** The live countdown is `remaining = it.min*60 − (now − run.drillStartedAt)/1000`, recomputed on a 1s tick; "started ago" is `now − run.startedAt`. **`drillStartedAt`/`startedAt` are the only persisted times; `now`, `remaining`, and the elapsed are NEVER persisted.** A mid-session reload re-reads `run.drillStartedAt` from the event and resumes exactly. Tested with an **injected/fixed clock** (the SSE-PT24H + slice-6 calendar-date lesson) — never `new Date()` in the derivation logic; the page owns `now`.
2. **Run mutations reuse the existing `updateEvent` use-case** (founder-confirmed approach) — no new run use-cases/endpoints. Patches are **action-driven** (start, mark-done/skip, rate, finish — not per-tick), so each emits the slice-6 `event.updated` audit and the audit volume stays bounded (~6–12 rows/session). The run page calls `client.updateEvent(eventId, { run })` / `{ attendance, run }`.
3. **Starting a session snapshots attendance, default everyone present.** `start()` writes `event.attendance` for every active-team Player-role member (`existing[m.id] ?? 'present'`) + initialises `run = { startedAt, idx:0, drillStartedAt:startedAt, log:[], ratings:{}, completed:false }` in one `updateEvent` patch.
4. **Permissions: reuse `eventWrite` — no new permission.** Running a session mutates the event → `eventWrite` (coach + assistantCoach hold it; **teamManager is excluded** per the handoff "no run-session"). The roster for the attendance snapshot loads via the team's Player-role members — coach + assistantCoach already hold `memberRead` (pack-manifest), so no new grant.
5. **Effect checks are per-DRILL, not per-player → `subjectSensitivity` stays UNSET.** The wrap-up captures a coach gut-call yes/no per drill into `run.ratings` ("did this drill deliver for this team") + the attendance facts — **no inferred player state**. `PackManifest.subjectSensitivity` stays unset; the per-player development *aggregation* (slice 8) is where the ADR-187/188/189 trigger fires. Re-stated pin: slice 8 sets `subjectSensitivity: 'developmental-minor'` in that same red→green pass.
6. **The `run/:eventId` slice-6 stub is replaced** by the real run-session page. The event-detail "Run session" button (slice 6) already routes here; its label already flips Run / Resume / Session report from `run` state.
7. **The expected-effect seam (design §5) is cashed read-only here.** The drill's `effect` text is surfaced in the live callout + the wrap-up; `run.ratings` + `event.attendance` are the persisted evidence slice 8 aggregates. No promotion to a kernel effect-declaration (demand-driven, deferred).

## 3. Data model — no new table

The run **populates** the slice-6 columns (no migration):

```
event.attendance : { [memberId]: 'present'|'absent'|'sick'|'holiday'|'school' }   // snapshot at start; editable pre-start
event.run        : { startedAt, drillStartedAt, idx, completed, finishedAt?,
                     log: [{ drillId, plannedMin, actualSec, skipped }],          // appended per advance
                     ratings: { [drillId]: 'yes'|'no' } }                          // wrap-up effect checks
```

- `RunSchema` + `MEMBER_ATTENDANCE` already exist in `pack-kids-football-contracts` (slice 6). The run page reads/writes these via `updateEvent`.
- **Derived, never stored:** the countdown, the elapsed-since-start, the over/under flag, the progress-segment widths, the total-on-drills — all computed on read from `run` + the template items.

## 4. Layer plan

### 4.1 Contracts (`pack-kids-football-contracts`)
A small pure helper module `kf-run-timer.ts` (+ spec), **clock-injected**:
- `fmtClock(sec): string` → `"M:SS"` (abs value, `Math.floor(s/60) + ':' + pad(s%60)`).
- `drillRemainingSec(plannedMin, drillStartedAtMs, nowMs): number` (may be negative = overtime).
- `elapsedSec(startedAtMs, nowMs): number`.
- `nextRunState(run, items, action, nowMs)` — OPTIONAL pure reducer for `start`/`advance(skipped)`/`finish` if it reads cleaner than inline component logic (mirrors the prototype's `start`/`advance`/`finish`); keeps the run-state transitions pure + unit-testable with a fixed clock. (If the component logic stays trivial, inline it — YAGNI.) `ATTENDANCE_CYCLE = ['present','absent','sick','holiday','school'] as const` for the pre-start chip cycle.
No schema changes (RunSchema exists). No new permissions (decision 4). No manifest change (`subjectSensitivity` stays unset, decision 5).

### 4.2 API (`pack-kids-football` + `pack-kids-football-api`)
**No changes** — the run reuses `updateEvent` (PATCH `/kids-football/events/:id` with `{ run }` / `{ attendance, run }`), already built + RBAC'd (`eventWrite`) + audited (`event.updated`) in slice 6. Confirm `UpdateEventPatch` accepts `run` + `attendance` partials (it does — both are `Partial<CreateEventInput>` keys). Add an e2e case if not already covered: a coach PATCHes `{run}` → 200 + the merged event carries the run; teamManager PATCH → 403 (already proven). No `subjectSensitivity`, no new audit subtype (run patches ride `event.updated`).

### 4.3 UI (`pack-kids-football-ui`)
- **Route:** replace the `run/:eventId` stub (`lib/run/run-session-stub.page.component.ts`) with the real `run-session-page.component.ts` (same route + selector area; delete/repurpose the stub). Loads the event (`store.events().find(id)` → `loadEvents()` fallback, the drill-editor pattern), the template (`store.templates()` → `loadTemplates()`), the drills (`loadDrills()`), and the active-team **Player-role members** (`store.members()` → a `loadMembers()`; filter `role === 'Player' && teamId === activeTeam`). Distinguishes load-error vs not-found via the store error signals.
- **The page owns `now`:** `now = signal(Date.now())` + a 1s `setInterval` in an effect (cleared on destroy) — the ONLY clock; passed to the pure timer helpers so children/tests stay deterministic.
- **Three phase views** (one component, OnPush, mobile-width `min(100%, 460px)` centered, ink header — recreating `run-session.jsx`):
  - **pre-start** (`!run || !run.startedAt`): attendance chips (`ATTENDANCE_CYCLE`, present=accent / excused=amber-tint / absent=red-tint; tap cycles + PATCHes `{attendance}`), "Who's here? n of m", "Tonight's plan" numbered list, full-width **Start session** (PATCHes the attendance snapshot + initial `run`).
  - **live** (`run.startedAt && run.idx < items.length && !completed`): progress-bar segments (done = `KF_PHASE_COLORS[phase]`, current = bright accent, rest faint), "Drill {idx+1} of {n} · started {fmtClock(elapsed)} ago", current-drill card (`KfPhaseTag`, name, the **countdown** `dsp` tabular-nums — over → `+` + danger color, "over the {min}′ plan" / "of {min}′ planned"), `KfSketchThumbnail` (or the full sketch render), organisation, numbered coaching points, the **expected-effect callout** (the drill's `effect`), an "Up next" dashed row, **Skip** (ghost, advance skipped) + **Mark drill done** / (last) **Done — wrap up session** (advance).
  - **wrap-up** (`run.idx >= items.length || run.completed`): "Effect check — did each drill deliver?" + per-drill rows (name, `{fmtClock(actualSec)} run · {plannedMin}′ planned` or "skipped", the `effect` text, **✓ On track** / **Not yet** toggle pills → PATCH `{run.ratings}`), then **Finish & save** (PATCH `run.completed=true, finishedAt`) → on a completed run show "Back to calendar".
- **Reuse:** `KF_PHASE_COLORS`, `KfPhaseTag`, `KfIntensityDots`, `KfSketchThumbnail`/the sketch render core, `resolveTenantFromRoute`, `mapKfError`, the `kf-i18n` pattern, the `--cg-*` `:host` skin idiom (no `:root` load). a11y: real `<button>`s with `aria-label`s; the countdown in an `aria-live="off"` region (it ticks every second — do NOT announce each tick; announce phase transitions only, ZWJ-alternated if needed); attendance chips convey status in text (not color alone); the progress bar has an accessible label.
- **CSS budget:** the run page is large — keep its component style **under 8kB** (shared in `club-grass.css`); decompose into sub-components (pre-start / live / wrap-up, or a shared header + three bodies) if it approaches the limit. Run the **prod build** (`nx build pack-football-visual-editor`) to catch it.

## 5. Testing

- **Contracts:** `kf-run-timer` — `fmtClock` (0→"0:00", 65→"1:05", negative abs), `drillRemainingSec`/`elapsedSec` with a FIXED `now` (positive + overtime-negative), the (optional) `nextRunState` reducer (`start` snapshots + inits run; `advance` appends the right log entry + bumps idx + resets drillStartedAt; `advance(skipped)` → actualSec 0 + skipped true; `finish` sets completed+finishedAt) — all clock-injected, NEVER hardcoded dates.
- **UI (component spec, fixed clock via a `now` input/override):** pre-start (attendance chip cycle PATCHes; Start snapshots + inits run + transitions to live); live (countdown renders from an injected `now`/`drillStartedAt`; overtime flips to `+`/danger; "started ago"; Skip/Mark-done advance + PATCH; progress segments; last-drill button label); **reload-survival** (re-mounting with an event whose `run.drillStartedAt` is in the past resumes the countdown at the right value — the proof the timer is derived, not stored); wrap-up (per-drill rows, rating toggle PATCHes ratings, Finish PATCHes completed+finishedAt); load-error vs not-found.
- **API:** confirm/extend the events e2e — a coach PATCH `{run}` / `{attendance}` → 200 merged; teamManager run PATCH → 403 (eventWrite gate; already proven in slice 6).
- **Gate:** `npm run ci:local` (no masking pipe) + `npm run test:db` (no new DB shape, but run it — the event PATCH path is exercised; the slice-6 RLS/audit proofs stay green). Full **browser run-through**: open a scheduled training's detail → Run session → take attendance → Start → advance through drills (watch the countdown + overtime) → reload mid-session (timer resumes) → wrap-up effect checks → Finish & save → the event-detail/calendar shows "✓ Done". Screenshot `de-braighter/docs/club-grass-run-session-s7-proof.png`.

## 6. Scope / YAGNI

- **In:** the `kf-run-timer` pure helpers, the run-session page (pre-start / live / wrap-up) replacing the stub, the active-team roster load for attendance, the action-driven `updateEvent` patches (start/advance/skip/rate/finish), the derive-on-read timer, the reload-survival test, the events-PATCH e2e confirmation.
- **Out (deferred):** the team/player **development view** + the per-player effect-check aggregation (slice 8, where `subjectSensitivity` fires); promoting the drill effect to a kernel effect-declaration (demand-driven); pausing/editing a running session beyond skip/advance; offline/PWA; the O(events) guard-scan index (slice-6 follow-up); #251/#255 tail nits; the bare-hex `#d4683b` → `--cg-match` token nit (fold if natural while in the calendar files, else defer).

## 7. Risks / notes

- **Timer correctness is the central risk** — it MUST derive from `run.drillStartedAt` (persisted) and never store a ticking value; test reload-survival explicitly with a fixed clock. A hardcoded date in a timer test rots (the SSE-PT24H lesson).
- **Audit volume:** action-driven patches keep `event.updated` emits bounded (~6–12/session); if a future "auto-save every N seconds" is added, switch to lifecycle-only audit (session.started/completed) to avoid flooding `kernel.audit_event`. Not needed now.
- **Roster source:** the run page needs the active-team Player-role members; confirm the store exposes a coach-accessible `loadMembers()` (coach has `memberRead`) — if `members` is only loaded via the admin `refresh()`, add a `loadMembers()` the run page calls (mirror `loadEvents`/`loadTemplates`). The plan resolves the exact store method.
- **CSS budget** (battle-tested): the run page is big — decompose + trim under 8kB; verify via the prod build, not `nx serve`.
- **Shared-host theme collision** (battle-tested): `--cg-*` literal `:host` idiom; no `:root` skin load.
