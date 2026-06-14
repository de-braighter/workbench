# Kids-Football Slice 8 (Team View + Player Modal) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the kids-football team view + player modal (roster, coach-notes CRUD, per-event attendance toggles, and a consent-gated per-player development aggregation), firing the long-deferred `subjectSensitivity` developmental-minor trigger.

**Architecture:** A new Angular Team surface in `pack-kids-football-ui` (roster page + player modal) backed by pure derive-on-read aggregation helpers in `pack-kids-football-contracts`; two narrow RBAC write endpoints (`notes`, `attendance`) delegating to existing use-cases; a new `@RequiresConsent`-gated `GET /members/:memberId/development` server endpoint (server-side derive-on-read); a typed `PackManifest.subjectSensitivity` field added to substrate-contracts (cross-layer publish). NO new table.

**Tech Stack:** Nx 22 + npm-workspaces, Angular 21 (standalone, signals, OnPush), NestJS 10, Zod, Vitest, `@de-braighter/substrate-{contracts,runtime}`, the already-wired consent foundation (ADR-184).

**Spec:** `docs/superpowers/specs/2026-06-14-exercir-kids-football-s8-team-player-design.md`

**Source of truth for UX + aggregation:** handoff `domains/exercir/docs/design/exercir-mvp-handoff/README.md` screen 8 + prototype `exercir/proto/team.jsx` (read it — the authoritative roster + player-modal + development logic).

**Branch / worktree:** built off `origin/main` (`b8f5269` = slice 7) in a FRESH manual worktree `domains/exercir-wt-kf-s8` on `feat/kids-football-s8-team-player`. All git ops happen IN the worktree — NEVER touch the main clone.

---

## Conventions (read once)

- **Gates without masking pipes:** `npm run ci:local > /tmp/ci.log 2>&1; echo "EXIT=$?"` then READ the log. A pipe (`| tail`) returns the PIPE's exit code, not the command's.
- **Angular unit tests:** `NX_DAEMON=false npx nx test <project>` — the `@nx/angular:unit-test` executor REJECTS `--include`/`--run`/positional spec filters; run the full project suite.
- **Node/contracts tests:** `NX_DAEMON=false npx nx test pack-kids-football` / `pack-kids-football-contracts`.
- **CSS budget:** the prod build (`npx nx build pack-football-visual-editor`) enforces 8kB/component-style ERROR; `nx serve` does NOT. Keep each new component style under 8kB; share in `club-grass.css`.
- **Time tests:** inject the clock; NEVER hardcode calendar dates (the SSE-PT24H lesson).
- **Commit per task** (frequent commits). Conventional-commit messages, `kids-football:` scope.

---

## Task 1: Substrate — add `PackManifest.subjectSensitivity` typed field + publish

> CROSS-LAYER PREREQUISITE. Done in `layers/substrate` (its own branch + PR + verifier wave per substrate rules), NOT in the exercir worktree. Publishing needs a `write:packages` token.

**Files:**
- Modify: `layers/substrate/libs/substrate-contracts/src/pack-registry/pack-manifest.ts`
- Modify: the substrate-contracts api-extractor report (run `api:update`)
- Test: `layers/substrate/libs/substrate-contracts/src/pack-registry/pack-manifest.spec.ts` (or the nearest manifest type test)

- [ ] **Step 1: Verify the current substrate main line + latest published version**

Run:
```bash
cd layers/substrate && git fetch origin && git log --oneline -3 origin/main
GITHUB_TOKEN=$GITHUB_TOKEN npm view @de-braighter/substrate-contracts version
GITHUB_TOKEN=$GITHUB_TOKEN npm view @de-braighter/substrate-runtime version
```
Expected: note the current contracts/runtime versions (the b3-mixture-cure train put runtime at ~2.3.0). Choose the next contracts version aligned with the line (e.g. if contracts is 2.2.0 → publish `2.3.0`; if a higher minor exists, take the next). Record it as `<NEW_CONTRACTS_VERSION>`.

- [ ] **Step 2: Add the field (failing the api-extractor public-API gate first is expected)**

In `pack-manifest.ts`, add to the `PackManifest` interface (after `consentPurposes`, before `metadata`):
```ts
  /**
   * Developmental-ethics subject-sensitivity self-declaration (ADR-188 D2).
   * Absent/unset => the pack is not subject-affecting; the charter does not
   * bind. Declaring a value puts the pack in scope for the C1–C8
   * developmental-ethics charter checks run by `charter-checker` (the
   * verifier-wave / CI governance layer) — this is a CHARTER/CI-GOVERNANCE
   * field, NOT a kernel-runtime concern: no kernel subsystem validates,
   * queries, or versions it (it serves none of the four concerns directly).
   * It rides the ADR-027 pack-self-declaration contribution surface (like
   * `auditSubtypes`/`consentPurposes`); the kernel stays class-neutral
   * (ADR-127 SubjectRef untouched). Enum is non-foreclosed/additive
   * (ADR-188 D2): widening is additive; removing/repurposing a value is an
   * adversarial-review concern.
   */
  readonly subjectSensitivity?: 'developmental-minor' | 'vulnerable-adult';
```

- [ ] **Step 3: Add a type-level test**

In the manifest spec, assert a manifest literal carrying `subjectSensitivity: 'developmental-minor'` type-checks and a bad value (`'foo'`) is a type error (`// @ts-expect-error`). Example:
```ts
it('accepts subjectSensitivity developmental-minor', () => {
  const m: PackManifest = { key: 'x', subjectSensitivity: 'developmental-minor' };
  expect(m.subjectSensitivity).toBe('developmental-minor');
});
```

- [ ] **Step 4: Update the api-extractor report + build + test**

Run:
```bash
cd layers/substrate
npx nx run substrate-contracts:api  # or the repo's api:update target — regenerate the .api.md report
npx nx build substrate-contracts && npx nx test substrate-contracts
```
Expected: build + tests PASS; the api report shows the new optional field.

- [ ] **Step 5: PR + verifier wave + merge (substrate rules)**

Open a substrate PR (designer-first not required — additive optional field; cite ADR-188 D2 + the inclusion-test nuance in the body). Run the substrate verifier wave; merge on green.

- [ ] **Step 6: Bump version + publish + verify**

Bump `package.json` version to `<NEW_CONTRACTS_VERSION>`, publish, and verify:
```bash
GITHUB_TOKEN=$GITHUB_TOKEN npm view @de-braighter/substrate-contracts version
```
Expected: returns `<NEW_CONTRACTS_VERSION>`. (Runtime is NOT republished — no runtime change this slice.)

---

## Task 2: Exercir worktree setup + pin bump

**Files:**
- Modify: `domains/exercir/package.json` (the `@de-braighter/substrate-contracts` range)

- [ ] **Step 1: Create the worktree off origin/main**

Run (from `de-braighter/`):
```bash
cd domains/exercir && git fetch origin
git worktree add ../exercir-wt-kf-s8 -b feat/kids-football-s8-team-player origin/main
cd ../exercir-wt-kf-s8 && GITHUB_TOKEN=$GITHUB_TOKEN npm ci
```
Expected: worktree at `domains/exercir-wt-kf-s8`, install succeeds. ALL subsequent steps run in this worktree.

- [ ] **Step 2: Bump the substrate-contracts pin**

In `package.json`, change `"@de-braighter/substrate-contracts": "^2.1.1"` → `"^<NEW_CONTRACTS_VERSION>"`. Leave the runtime pin unless Task 1 moved the runtime line (it didn't).

- [ ] **Step 3: Install + verify baseline green**

Run:
```bash
GITHUB_TOKEN=$GITHUB_TOKEN npm install
npx nx run-many -t build > /tmp/baseline.log 2>&1; echo "EXIT=$?"
```
Expected: install resolves the new contracts version; build EXIT=0 (slice-7 baseline green on the new pin).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(kids-football): bump substrate-contracts to ^<NEW_CONTRACTS_VERSION> (subjectSensitivity field)"
```

---

## Task 3: Contracts — permissions, consent purpose, development schema + aggregation helpers

**Files:**
- Modify: `libs/pack-kids-football-contracts/src/roles.ts`
- Create: `libs/pack-kids-football-contracts/src/kf-development.ts`
- Test: `libs/pack-kids-football-contracts/src/kf-development.spec.ts`
- Modify: `libs/pack-kids-football-contracts/src/index.ts` (barrel exports)

- [ ] **Step 1: Write the failing aggregation test**

Create `kf-development.spec.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { attStats, lastFiveAttendance, aggregateDevelopment } from './kf-development.js';
import type { ExercirEvent } from './events.js';
import type { Drill } from './drills.js';

const drill = (id: string, focus: string): Drill =>
  ({ id, name: id, focus, phase: 'Technical', age: 'U9', min: 10, players: '', equipment: [], intensity: 3, organisation: '', points: [], effect: '', sketch: [] } as unknown as Drill);

const trainingEvent = (id: string, date: string, attendance: Record<string, string>, run?: unknown): ExercirEvent =>
  ({ id, teamId: 't1', date, kind: 'training', training: { templateId: 'tpl', slotId: 's' }, attendance, run } as unknown as ExercirEvent);

describe('attStats', () => {
  it('returns pct null when no recorded sessions', () => {
    expect(attStats('p1', []).pct).toBeNull();
  });
  it('counts present / excused / absent and rounds pct', () => {
    const evts = [
      trainingEvent('e1', '2026-06-01', { p1: 'present' }),
      trainingEvent('e2', '2026-06-02', { p1: 'sick' }),
      trainingEvent('e3', '2026-06-03', { p1: 'absent' }),
      trainingEvent('e4', '2026-06-04', { p1: 'present' }),
    ];
    expect(attStats('p1', evts)).toEqual({ recorded: 4, present: 2, excused: 1, absent: 1, pct: 50 });
  });
});

describe('lastFiveAttendance', () => {
  it('returns up to 5 recorded events oldest-first', () => {
    const evts = Array.from({ length: 7 }, (_, i) =>
      trainingEvent('e' + i, '2026-06-0' + (i + 1), { p1: 'present' }));
    const dots = lastFiveAttendance('p1', evts);
    expect(dots).toHaveLength(5);
    expect(dots[0].date < dots[4].date).toBe(true);
  });
});

describe('aggregateDevelopment', () => {
  it('only counts completed runs where the player was present, skips skipped log entries', () => {
    const drills = [drill('d1', 'Passing'), drill('d2', 'Shooting')];
    const evts = [
      trainingEvent('e1', '2026-06-01', { p1: 'present' }, {
        startedAt: 1, drillStartedAt: 1, idx: 2, completed: true, finishedAt: 2,
        log: [{ drillId: 'd1', plannedMin: 10, actualSec: 600, skipped: false },
              { drillId: 'd2', plannedMin: 10, actualSec: 0, skipped: true }],
        ratings: { d1: 'yes' },
      }),
      trainingEvent('e2', '2026-06-02', { p1: 'absent' }, {
        startedAt: 1, drillStartedAt: 1, idx: 1, completed: true, finishedAt: 2,
        log: [{ drillId: 'd1', plannedMin: 10, actualSec: 600, skipped: false }], ratings: { d1: 'no' },
      }),
    ];
    const dev = aggregateDevelopment('p1', evts, drills);
    expect(dev.focusCounts).toEqual({ Passing: 1 });   // d2 skipped; e2 not present
    expect(dev.checks).toEqual([{ date: '2026-06-01', drillName: 'd1', rating: 'yes' }]);
  });
});
```

- [ ] **Step 2: Run it — verify it fails (module not found)**

Run: `NX_DAEMON=false npx nx test pack-kids-football-contracts > /tmp/t3.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `Cannot find module './kf-development.js'`.

- [ ] **Step 3: Implement `kf-development.ts`** (pure, derive-on-read; mirrors `team.jsx`)

```ts
/**
 * Pure derive-on-read aggregation for the team view (ADR-176 — never persisted).
 * Mirrors the prototype team.jsx attStats/AttDots + development arc.
 */
import type { ExercirEvent } from './events.js';
import type { Drill } from './drills.js';

const EXCUSED = ['sick', 'holiday', 'school'] as const;
const attRecorded = (e: ExercirEvent): boolean =>
  !!e.attendance && Object.keys(e.attendance).length > 0;

export interface AttStats { recorded: number; present: number; excused: number; absent: number; pct: number | null; }

export function attStats(memberId: string, events: readonly ExercirEvent[]): AttStats {
  const rec = events.filter((e) => attRecorded(e) && e.attendance[memberId] !== undefined);
  const present = rec.filter((e) => e.attendance[memberId] === 'present').length;
  const excused = rec.filter((e) => (EXCUSED as readonly string[]).includes(e.attendance[memberId])).length;
  const absent = rec.length - present - excused;
  return { recorded: rec.length, present, excused, absent, pct: rec.length ? Math.round((present / rec.length) * 100) : null };
}

export interface AttDot { eventId: string; date: string; status: string | undefined; }

export function lastFiveAttendance(memberId: string, events: readonly ExercirEvent[]): AttDot[] {
  return events
    .filter(attRecorded)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .reverse()
    .map((e) => ({ eventId: e.id, date: e.date, status: e.attendance[memberId] }));
}

export interface DevCheck { date: string; drillName: string; rating: 'yes' | 'no'; }
export interface PlayerDevelopment { focusCounts: Record<string, number>; checks: DevCheck[]; }

export function aggregateDevelopment(
  playerId: string,
  events: readonly ExercirEvent[],
  drills: readonly Drill[],
): PlayerDevelopment {
  const attended = events.filter((e) => e.run && e.run.completed && (e.attendance ?? {})[playerId] === 'present');
  const focusCounts: Record<string, number> = {};
  const checks: DevCheck[] = [];
  for (const e of attended) {
    for (const l of e.run!.log ?? []) {
      if (l.skipped) continue;
      const d = drills.find((x) => x.id === l.drillId);
      if (d) focusCounts[d.focus] = (focusCounts[d.focus] ?? 0) + 1;
    }
    for (const [dId, r] of Object.entries(e.run!.ratings ?? {})) {
      if (!r) continue;
      const d = drills.find((x) => String(x.id) === String(dId));
      if (d) checks.push({ date: e.date, drillName: d.name, rating: r as 'yes' | 'no' });
    }
  }
  checks.sort((a, b) => b.date.localeCompare(a.date));
  return { focusCounts, checks };
}
```

- [ ] **Step 4: Add perms + consent purpose to `roles.ts`**

Append to `KF_PERMISSIONS`:
```ts
  noteWrite: 'kids-football.note.write',
  attendanceWrite: 'kids-football.attendance.write',
```
Add a new export:
```ts
/** Consent purpose IDs (ADR-184 / ADR-188 C7). */
export const KF_CONSENT_PURPOSES = {
  viewPlayerDevelopment: 'kids-football.view-player-development',
} as const;
```

- [ ] **Step 5: Add the development response schema** (in `kf-development.ts` or a small `player-development.ts`)

```ts
import { z } from 'zod';
export const PlayerDevelopmentSchema = z.object({
  focusCounts: z.record(z.string(), z.number()),
  checks: z.array(z.object({ date: z.string(), drillName: z.string(), rating: z.enum(['yes', 'no']) })),
});
```

- [ ] **Step 6: Export from the barrel** — add `export * from './kf-development.js';` and `KF_CONSENT_PURPOSES` (if not via `roles.js`) to `index.ts`.

- [ ] **Step 7: Run tests + build — verify pass**

Run: `NX_DAEMON=false npx nx test pack-kids-football-contracts > /tmp/t3.log 2>&1; echo "EXIT=$?"` then `npx nx build pack-kids-football-contracts`.
Expected: tests PASS, build PASS.

- [ ] **Step 8: Commit**

```bash
git add libs/pack-kids-football-contracts
git commit -m "feat(kids-football): contracts — dev aggregation helpers + noteWrite/attendanceWrite perms + view-player-development consent purpose"
```

---

## Task 4: Manifest — subjectSensitivity + consentPurposes + perms + role grants

**Files:**
- Modify: `libs/pack-kids-football/src/manifest/pack-manifest.ts`
- Test: `libs/pack-kids-football/src/manifest/pack-manifest.spec.ts`

- [ ] **Step 1: Update the manifest spec (failing)** — assert: 16 permissions including `noteWrite`/`attendanceWrite`; `subjectSensitivity === 'developmental-minor'`; `consentPurposes` contains `view-player-development`; coach/assistantCoach/teamManager each include `noteWrite` + `attendanceWrite`; role→permission closure holds.

- [ ] **Step 2: Run — verify fail.** `NX_DAEMON=false npx nx test pack-kids-football > /tmp/t4.log 2>&1; echo "EXIT=$?"` → FAIL.

- [ ] **Step 3: Update `pack-manifest.ts`:**
  - Add to `permissions[]`: `{ id: P.noteWrite, displayName: 'Add and remove player coach-notes' }`, `{ id: P.attendanceWrite, displayName: 'Edit session attendance' }`.
  - Add `KF_CONSENT_PURPOSES` import; add `consentPurposes: [{ id: KF_CONSENT_PURPOSES.viewPlayerDevelopment, displayName: 'View a player\'s development record', legalBasis: 'revFADP Art. 6' }]`.
  - Add `subjectSensitivity: 'developmental-minor'` (with a doc comment citing ADR-188 D2 + the slice-8 trigger).
  - Append `P.noteWrite, P.attendanceWrite` to the coach, assistantCoach, AND teamManager `permissions` arrays (clubAdmin already has them via `Object.values(P)`). Update the role comments (teamManager: "edits notes + attendance per handoff — narrow perms, still NO eventWrite/memberWrite").

- [ ] **Step 4: Run — verify pass + build.** `NX_DAEMON=false npx nx test pack-kids-football` then `npx nx build pack-kids-football`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(kids-football): manifest — subjectSensitivity developmental-minor + consent purpose + noteWrite/attendanceWrite grants`.

---

## Task 5: GetPlayerDevelopmentUseCase

**Files:**
- Create: `libs/pack-kids-football/src/in-ports/get-player-development.use-case.ts`
- Create: `libs/pack-kids-football/src/application/get-player-development.service.ts`
- Test: `libs/pack-kids-football/src/application/get-player-development.service.spec.ts`
- Modify: `libs/pack-kids-football/src/index.ts` (export the token + use-case type)

> Read `list-club-events`/`list-members` use-cases + the event repository port first to mirror the Result shape + how events are loaded for the active tenant.

- [ ] **Step 1: Write the failing service spec** — given an in-memory event repo + drills, `getDevelopment(memberId)` returns `{ ok: true, value: aggregateDevelopment(...) }`; an unknown member still returns `{ ok: true, value: { focusCounts:{}, checks:[] } }` (development is derived over events — a member with no attended runs yields empty; there is no member existence check here since the consent guard + memberRead already gate the route, and listing events is tenant-scoped). Use a fixed set of events.

- [ ] **Step 2: Run — verify fail.** FAIL (module missing).

- [ ] **Step 3: Implement the in-port:**
```ts
import type { PlayerDevelopment } from '@de-braighter/pack-kids-football-contracts';
export type GetPlayerDevelopmentResult = { ok: true; value: PlayerDevelopment };
export interface GetPlayerDevelopmentUseCase {
  getDevelopment(memberId: string): Promise<GetPlayerDevelopmentResult>;
}
export const GET_PLAYER_DEVELOPMENT_USE_CASE = Symbol('GET_PLAYER_DEVELOPMENT_USE_CASE');
```

- [ ] **Step 4: Implement the service** — inject the EVENT_REPOSITORY (list for the active tenant) + DRILL_REPOSITORY (list), call the contracts `aggregateDevelopment(memberId, events, drills)`, return `{ ok: true, value }`. Pure derivation; no persistence (ADR-176).

- [ ] **Step 5: Wire into the pack module providers** (mirror how other use-cases bind their service to the token in `pack-kids-football.module.ts`). Export the token + use-case type from the lib barrel.

- [ ] **Step 6: Run — verify pass + build.** Expected: PASS.

- [ ] **Step 7: Commit** — `feat(kids-football): GetPlayerDevelopmentUseCase (derive-on-read player development)`.

---

## Task 6: API endpoints — development (consent-gated) + notes + attendance

**Files:**
- Modify: `apps/pack-kids-football-api/src/app/members.controller.ts` (add GET development + PATCH notes)
- Modify: `apps/pack-kids-football-api/src/app/events.controller.ts` (add PATCH attendance)
- Test: `apps/pack-kids-football-api/src/app/members.e2e.spec.ts` + `events.e2e.spec.ts`

> `@RequiresConsent` + `@RequiresPermission` are imported from `@de-braighter/substrate-runtime`. The ConsentGuard is auto-registered by `forRoot`.

- [ ] **Step 1: Write failing e2e — development consent allow/deny + notes/attendance RBAC.** In `members.e2e.spec.ts`: (a) a coach GET `/members/:id/development` for a member WITH a seeded consent receipt → 200 + `{focusCounts, checks}`; (b) same WITHOUT a receipt → 403; (c) a `noteWrite`-less role (facilities) PATCH `/members/:id/notes` → 403; coach PATCH notes → 200 merged. In `events.e2e.spec.ts`: coach + teamManager PATCH `/events/:id/attendance` → 200 merged; facilities → 403. (Grant the consent receipt in test setup via the injected `CONSENT_RECEIPT_REPOSITORY` for the allow case.)

- [ ] **Step 2: Run — verify fail.** Run the e2e project; FAIL (routes 404 / wrong status).

- [ ] **Step 3: Add the development endpoint** to `members.controller.ts`:
```ts
@Get(':memberId/development')
@RequiresPermission(KF_PERMISSIONS.memberRead)
@RequiresConsent({ purposeId: KF_CONSENT_PURPOSES.viewPlayerDevelopment, subjectFrom: 'memberId' })
async getDevelopment(@Param('memberId') memberId: string): Promise<unknown> {
  const result = await this.developmentUseCase.getDevelopment(memberId);
  return result.value; // always ok: true (derived)
}
```
Inject `GET_PLAYER_DEVELOPMENT_USE_CASE`. NOTE: `':memberId/development'` must NOT clash with `':id'` PATCH — `@Get` with a 2-segment path is distinct from `@Patch(':id')`; keep the literal sub-segment.

- [ ] **Step 4: Add the notes PATCH** to `members.controller.ts`:
```ts
@Patch(':id/notes')
@RequiresPermission(KF_PERMISSIONS.noteWrite)
async updateNotes(@Param('id') id: string, @Body() body: { notes?: unknown }): Promise<unknown> {
  const result = await this.updateUseCase.updateMember(id, { notes: body?.notes } as Parameters<typeof this.updateUseCase.updateMember>[1]);
  if (result.ok) return result.value;
  // map member-not-found → 404, invalid-input → 400 (mirror updateMember handler)
  ...
}
```
(Reuse the existing `UPDATE_MEMBER_USE_CASE` already injected.)

- [ ] **Step 5: Add the attendance PATCH** to `events.controller.ts`:
```ts
@Patch(':id/attendance')
@RequiresPermission(KF_PERMISSIONS.attendanceWrite)
async updateAttendance(@Param('id') id: string, @Body() body: { attendance?: unknown }): Promise<unknown> {
  const result = await this.updateEventUseCase.updateEvent(id, { attendance: body?.attendance } as ...);
  if (result.ok) return result.value;
  // map event-not-found → 404, invalid-input → 400 (mirror updateEvent handler)
}
```
(Reuse the existing event update use-case already injected in the events controller.)

- [ ] **Step 6: Run — verify pass + build.** `NX_DAEMON=false npx nx test pack-kids-football-api` + `npx nx build pack-kids-football-api`. Expected: PASS (consent allow=200, deny=403; RBAC matrices green).

- [ ] **Step 7: Commit** — `feat(kids-football): API — consent-gated GET development + narrow notes/attendance PATCH endpoints`.

---

## Task 7: Demo consent seed + boot validation

**Files:**
- Modify: `apps/pack-kids-football-api/src/app/pack-kids-football-auth.bootstrap.ts`
- Modify: `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts` (expose seeded Player ids if needed)
- Test: covered by Task 6's allow-case e2e (development 200 for a seeded player in the running app)

> The in-memory `CONSENT_RECEIPT_REPOSITORY` starts EMPTY → `@RequiresConsent` 403s until receipts exist. Seed them at boot for the demo Player-role members.

- [ ] **Step 1: Inject the consent repo into the auth bootstrap.** Add `@Inject(CONSENT_RECEIPT_REPOSITORY) private readonly consentReceipts: ConsentReceiptRepository` (import token + type from `@de-braighter/substrate-contracts`).

- [ ] **Step 2: Add `seedDemoConsentIfInMemory()`** called in `onApplicationBootstrap()` AFTER `seedDemoMembersIfInMemory()`. For each stub club's tenantPackId, list its Player-role members (have `seedDemoMembers` return the seeded members, or read `DEMO_PLAYER_IDS` exported from the demo fixtures), and for each grant the consent receipt:
```ts
for (const memberId of demoPlayerIds) {
  try {
    await this.consentReceipts.grant({
      tenantPackId: tpid, subjectId: memberId, packKey: KIDS_FOOTBALL_PACK_KEY,
      purposeId: KF_CONSENT_PURPOSES.viewPlayerDevelopment,
      grantedByActorId: STUB_CLUB_A_ADMIN_USER_ID, // non-empty actor (ADR-184 inv 7)
    });
  } catch (e) { if ((e as Error).name !== 'ActiveConsentConflictError') throw e; }
}
```
(Skip when `packKidsFootballDbEnabled()` — but note consent is in-memory regardless; the seed still runs so DB-mode demo also shows development. Confirm: the app wires `InMemoryConsentReceiptRepository` unconditionally, so seed unconditionally.)

- [ ] **Step 3: (Optional) wire decorator validation** — add `collectDecoratorConsentPurposeIds(controllers)` + `ConsentEngine.validateDecoratorReferences(...)` in the bootstrap (inject `ConsentEngine`), mirroring `validateDecoratorReferences()` for permissions. Catches a purpose-id typo at boot.

- [ ] **Step 4: Run the e2e + build.** The Task-6 allow-case (development 200) now passes against the booted app's seeded receipts. `NX_DAEMON=false npx nx test pack-kids-football-api`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(kids-football): seed demo consent receipts for view-player-development + boot-validate consent decorators`.

---

## Task 8: UI client methods

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts`
- Test: `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.spec.ts`

- [ ] **Step 1: Write failing client specs** — `setMemberNotes(id, notes)` PATCHes `/members/:id/notes` with `{notes}` + parses `MemberSchema`; `setEventAttendance(id, attendance)` PATCHes `/events/:id/attendance` with `{attendance}` + parses `EventSchema`; `getPlayerDevelopment(memberId)` GETs `/members/:memberId/development` + parses `PlayerDevelopmentSchema`. Mock `HttpClient` per the existing client-spec pattern.

- [ ] **Step 2: Run — verify fail.** FAIL.

- [ ] **Step 3: Implement the three methods** (mirror existing `updateMember`/`updateEvent`, attaching `buildHeaders()`):
```ts
async setMemberNotes(id: string, notes: MemberNote[]): Promise<Member> { /* PATCH .../members/:id/notes {notes}; parse MemberSchema */ }
async setEventAttendance(id: string, attendance: Record<string, MemberAttendance>): Promise<ExercirEvent> { /* PATCH .../events/:id/attendance {attendance}; parse EventSchema */ }
async getPlayerDevelopment(memberId: string): Promise<PlayerDevelopment> { /* GET .../members/:memberId/development; parse PlayerDevelopmentSchema */ }
```

- [ ] **Step 4: Run — verify pass.** `NX_DAEMON=false npx nx test pack-kids-football-ui`. Expected: PASS.

- [ ] **Step 5: Commit** — `feat(kids-football): client — setMemberNotes / setEventAttendance / getPlayerDevelopment`.

---

## Task 9: UI — AttendanceDots + Team roster page

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/team/attendance-dots.component.ts`
- Create: `libs/pack-kids-football-ui/src/lib/team/team-page.component.ts`
- Test: `libs/pack-kids-football-ui/src/lib/team/attendance-dots.component.spec.ts` + `team-page.component.spec.ts`

> Mirror the calendar/run-session page pattern (standalone, OnPush, signals, `--cg-*` `:host` skin, store loads). Roster layout from `team.jsx` `TeamScreen` (grid `44px 1.2fr 70px 110px 90px 1.6fr`). ALPHABETICAL sort (ADR-188 C1 — never rank by performance).

- [ ] **Step 1: Failing `attendance-dots` spec** — renders 5 dots with status-derived color + a `title`/`aria-label` carrying the status TEXT (not color-alone); renders "—" when no recorded attendance.

- [ ] **Step 2–3: Implement `AttendanceDotsComponent`** (input: `memberId` + `events`; uses `lastFiveAttendance`). Run → pass.

- [ ] **Step 4: Failing `team-page` spec** — given a stubbed store/client with 2 Player members + events, renders alphabetical rows with name/born/dots/present-%/note-preview; present-% color (≥75 accent-strong else `#C25441`); empty state when no players; staff chips. Clicking a row opens the modal (asserts the selected signal).

- [ ] **Step 5: Run — verify fail.** FAIL.

- [ ] **Step 6: Implement `TeamPageComponent`** — loads `client.listMembers(activeTeamId)` filtered `role==='Player'` (sort by name), `store.loadEvents()`, `store.loadDrills()`, `store.loadTemplates()`; computes `attStats` per player; renders the roster + staff chips + the team header ("My team · {name}", "{n} players · {avg}% avg attendance over {n} recorded sessions"); a `selectedPlayer` signal drives the modal. Keep style < 8kB (share in `club-grass.css`).

- [ ] **Step 7: Run — verify pass.** `NX_DAEMON=false npx nx test pack-kids-football-ui`. Expected: PASS.

- [ ] **Step 8: Commit** — `feat(kids-football): team roster page + attendance-dots component`.

---

## Task 10: UI — Player modal (notes / attendance / development)

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/team/player-modal.component.ts`
- Test: `libs/pack-kids-football-ui/src/lib/team/player-modal.component.spec.ts`

> 560px focus-trapped modal (reuse `kf-modal-focus`). Sections from `team.jsx` `PlayerModal`. Development section fetches the consent-gated endpoint.

- [ ] **Step 1: Failing spec** covering:
  - header stats line ("{present} of {recorded} sessions ({pct}%)" + excused/absent suffix, or "no attendance recorded yet");
  - **notes:** Add (a `FormControl`; disabled-until-non-empty) calls `client.setMemberNotes(id, [...notes, newNote])` then re-renders dated rows; delete calls `setMemberNotes` with the filtered array; focus management after add/delete;
  - **attendance:** per past event, 5 toggle chips; clicking calls `client.setEventAttendance(eventId, nextMap)` (toggle-off removes the key);
  - **development:** on open calls `client.getPlayerDevelopment(memberId)` → renders focus chips ("focus ×n") + recent checks (date, drill, ✓ On track / – Not yet) + the caption "A record of practice while present — not a skill rating."; on a 403 (rejected promise mapped) renders the "consent not on file" empty state; a generic load-error state otherwise.

- [ ] **Step 2: Run — verify fail.** FAIL.

- [ ] **Step 3: Implement `PlayerModalComponent`** — inputs: `player`, `team`, `events`, `templates`; injects the client. The development section renders ONLY from `getPlayerDevelopment()` (never client-aggregates — keeps the consent gate meaningful). Non-deficit copy. Keep style < 8kB.

- [ ] **Step 4: Run — verify pass.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat(kids-football): player modal — notes CRUD + attendance toggles + consent-gated development`.

---

## Task 11: Nav + route + i18n

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/routes.ts` (add `team` route)
- Modify: `libs/pack-kids-football-ui/src/lib/shell/kf-shell.component.ts` (add `canSeeTeam()` + nav link)
- Modify: `libs/pack-kids-football-ui/src/lib/kf-i18n.ts` (add `kf.shell.nav.team`)
- Test: `libs/pack-kids-football-ui/src/lib/shell/kf-shell.component.spec.ts`

- [ ] **Step 1: Failing shell spec** — `kf-nav-team` link shows for coach / assistant-coach / team-manager, hidden for club-admin / facilities.

- [ ] **Step 2: Run — verify fail.** FAIL.

- [ ] **Step 3: Implement:**
  - `routes.ts`: add `{ path: 'team', loadComponent: () => import('./team/team-page.component.js').then(m => m.TeamPageComponent) }` under the shell children.
  - `kf-shell.component.ts`: add `canSeeTeam = computed(() => ['coach','assistant-coach','team-manager'].includes(this.session()?.role ?? ''))` + an `@if (canSeeTeam())` nav link (`link('team')`, `data-testid="kf-nav-team"`, `msg.navTeam`). Update the `canSeeDrills`/`canSeeCalendar` comments that said "Team nav arrives slice 8".
  - `kf-i18n.ts`: add `'kf.shell.nav.team': 'Team'`.

- [ ] **Step 4: Run — verify pass.** Expected: PASS.

- [ ] **Step 5: Commit** — `feat(kids-football): Team nav + /team route (coach / assistant-coach / team-manager)`.

---

## Task 12: Finishing — prod build, gates, browser run-through, screenshot

**Files:** none (verification + proof)

- [ ] **Step 1: Prod build (style budget)** — `npx nx build pack-football-visual-editor > /tmp/prodbuild.log 2>&1; echo "EXIT=$?"`. Expected EXIT=0; no 8kB ERROR. If a component exceeds 8kB, move inline CSS into `club-grass.css` and re-run.

- [ ] **Step 2: ci:local** — `npm run ci:local > /tmp/ci.log 2>&1; echo "EXIT=$?"`. READ the log. Expected EXIT=0 across all projects.

- [ ] **Step 3: test:db** — `npm run test:db > /tmp/testdb.log 2>&1; echo "EXIT=$?"`. Expected EXIT=0 (no new table; events/members PATCH paths + slice-6 RLS/audit proofs stay green; consent is in-memory — no new RLS proof).

- [ ] **Step 4: Browser run-through** (Playwright MCP). Kill orphan :3150/:4200; serve the WORKTREE api (`PORT=3150`, in-memory) + host (:4200) via `&`-detached redirected commands (until-loop on ready). Drive: coach sign-in (FC Sonnenberg) → build a template + add a U9 slot (clubAdmin) → schedule a training → **run the session** (take attendance, advance drills, wrap-up effect checks, Finish) → open **Team** → verify roster (dots, present %, note preview) → open a player modal → add a note → toggle an attendance chip → verify the **development** chips + checks + the practice caption render (consent seed working). Screenshot to `de-braighter/docs/club-grass-team-player-s8-proof.png`.

- [ ] **Step 5: Commit any fixes** found in the run-through, then proceed to the verifier wave (handled by the orchestrator, see "After the plan").

---

## After the plan (orchestrator)

1. **Create the `type/story` issue up front** (`de-braighter/exercir`) for slice 8; put `Closes #NN` in the PR body.
2. **Open the PR** with `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`, `Effort: deep`, `Effect: cycle-time …±… expert`, `Effect: findings …±… expert`.
3. **Full verifier wave** (non-trivial): `reviewer` + `charter-checker` + `exercir-charter-checker` + `qa-engineer` + `local-ci`, read-only, pointed at the worktree (NO `isolation: worktree`; forbid git-writes + main-clone access). Ask the charter-checkers to specifically bless: the `subjectSensitivity` typed-field declaration (governance-typed slot), the C1 no-ranking roster, the C7 consent scoping (development-only + presence-guard caveat), and that the development aggregation is derived-not-stored (ADR-176).
4. **post-findings** (`de-braighter/exercir#NN`, severities `blocking|should-fix|nit|note`, JSON via the Write tool) → fix blockers + should-fixes → merge (squash).
5. **Twin ritual:** `drain exercir#NN` before merge; after merge `backfill de-braighter/exercir` + `reviews` + `resolve-findings` + `reconcile exercir#NN`.
6. **Update the memory** `exercir-kids-football-mvp-arc.md` (slice 8 SHIPPED → FULL 8-SLICE MVP COMPLETE; subjectSensitivity now set; consent foundation now consumed; next direction).

---

## Self-Review (completed)

- **Spec coverage:** §2.1 subjectSensitivity → Task 1+4; §2.2 consent → Task 4 (purpose) + Task 6 (guard) + Task 7 (seed); §2.3 perms → Task 3+4+6; §2.4 derive-on-read dev endpoint → Task 5+6; §2.5 consent scoping → Task 6 (development-only); §2.6 no new table → confirmed (no migration task); §2.7 humane framing → Task 9 (alphabetical) + Task 10 (caption/copy); §4.2 helpers → Task 3; §4.4 UI → Task 9/10/11; §5 testing → each task's TDD steps + Task 12; §6 scope → respected (no Prisma consent, no grant UI). All covered.
- **Placeholder scan:** controller failure-mapping in Task 6 steps 4–5 says "mirror the existing handler" with `...` — the engineer copies the existing `updateMember`/`updateEvent` switch in the same file; acceptable (the pattern is in-file). No TBD/TODO.
- **Type consistency:** `aggregateDevelopment` / `PlayerDevelopment` / `PlayerDevelopmentSchema` / `attStats` / `lastFiveAttendance` used consistently across Tasks 3/5/6/8/9/10; `KF_CONSENT_PURPOSES.viewPlayerDevelopment` + `noteWrite`/`attendanceWrite` consistent across Tasks 3/4/6; `GET_PLAYER_DEVELOPMENT_USE_CASE` consistent Task 5/6.
