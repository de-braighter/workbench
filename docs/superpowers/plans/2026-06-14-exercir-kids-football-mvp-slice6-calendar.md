# Exercir kids-football MVP — Slice 6 (calendar + scheduling, + persisted F1 audit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **This plan is CROSS-LAYER**: Part A ships in `layers/substrate` (and must be **published** to the registry), Part B in `domains/exercir`. Do Part A fully (incl. publish) before Part B's audit-persistence tasks.

**Goal:** A coach schedules training templates onto club slots (→ calendar events) and adds matches, on a new `kids_football.event` pack table rendered as a week grid (auto-expanding hour range, open-slot ghosts, training/match events, upcoming rail) with schedule/match/event-detail modals — **and** every event mutation writes a real, tenant-isolated audit row to `kernel.audit_event` (persisted F1 / exercir#245), which requires publishing a `sql/kernel-audit.sql` artifact from substrate first.

**Architecture:** Cross-layer. **Part A** (`layers/substrate`, designer-first): author + publish a `sql/kernel-audit.sql` provisioning artifact (consolidated idempotent projection of the authoritative kernel-audit migrations + WORM triggers, mirroring `kernel-event-log.sql`) + a parity spec, as a surgical `2.1.1` patch from `main` (`< 2.2.0`, so the unmerged oncology `b3-mixture-cure-family` 2.2.0 line is undisturbed). **Part B** (`domains/exercir`): the event vertical mirrors the slice-5 **template** vertical exactly (contracts → migration/RLS → repo×2 on one contract suite → Result use-cases → RBAC controller → client+store → UI), plus: the persisted-audit wiring (manifest `auditSubtypes` + `AuditSubtypeRegistryModule` + `PrismaAuditEventRepository` in DB-mode `forRoot` + `emitAuditEvent` in the 3 event use-cases), the **template-in-use delete guard** (founder's "don't delete used templates"), and the bespoke calendar UI. All derived state (hour range, ghosts, budgets, slot-length validation) is computed on read (ADR-176), never persisted.

**Tech Stack:** Angular (standalone + signals + reactive forms) + NestJS + Prisma/Postgres, Nx + vitest, `@de-braighter/substrate-{contracts,runtime}@^2.1.1` (auth/tenant/RLS **+ audit** surface — no kernel domain concepts/inference).

**Repos / branches / worktrees:**
- **Part A** — `layers/substrate`, branch `feat/kernel-audit-sql-artifact` off `origin/main`. A fresh worktree is optional (substrate's own clone is fine if clean); if a verifier or parallel session is active, use `git worktree add ../substrate-wt-audit-sql -b feat/kernel-audit-sql-artifact origin/main`.
- **Part B** — `domains/exercir`, branch `feat/kids-football-s6-calendar` off `origin/main` in a **fresh manual worktree** (a parent `isolation:worktree` worktrees the WORKBENCH, not exercir):

```bash
cd domains/exercir
git fetch origin && git worktree add ../exercir-wt-kf-s6 -b feat/kids-football-s6-calendar origin/main
cd ../exercir-wt-kf-s6
GITHUB_TOKEN=ghp_… npm ci                    # @de-braighter/* from GitHub Packages (read:packages)
npm ls @de-braighter/substrate-runtime       # expect 2.1.1 AFTER Part A publishes + the dep is bumped (Task B0)
```

Work entirely in `../exercir-wt-kf-s6` so the main clone's `:4200`/`:3150` dev servers stay untouched. **Gate:** `npm run ci:local` + `npm run test:db`.

**Design sources of truth:** `docs/superpowers/specs/2026-06-14-exercir-kids-football-s6-calendar-design.md` (this slice's design + the resolved forks) · `domains/exercir/docs/design/exercir-mvp-handoff/README.md` screen 6 ("Calendar") + the data model + "Interactions & Behavior" + "Roles & Permissions" · prototype `docs/design/exercir-mvp-handoff/exercir/proto/calendar.jsx` (week grid, schedule/match/event modals, `pViewSlots`/`pNextOccurrences`/`pIso`/`pFmt` slot view-model + date math) · the slice-5 **template** vertical as the layer-by-layer mirror · `node_modules/@de-braighter/substrate-runtime/sql/kernel-event-log.sql` (the artifact authoring pattern Part A copies) · `layers/substrate/prisma/migrations/{20260528122322_kernel_audit,20260528122254_auditor_select_policy,20260528122925_grant_schema_usage_to_app_auditor,20260528142103_audit_tenant_pack_id_to_uuid,20260613090000_kernel_audit_worm_triggers}/migration.sql` (the authoritative DDL Part A projects).

---

## Design decisions (resolved at plan time — pinned)

### D-1. Event shape = structured `kind` enum + `teamId`/`date` columns; everything else JSONB (founder, design §2.1, §3)
`kids_football.event` columns: `id`, `tenant_pack_id`, `team_id`, `date TEXT` (ISO `YYYY-MM-DD`, matching the slot table's `date TEXT`; lexically sortable for the `[tenantPackId, date]` week-window index), `kind TEXT` (`'training'|'match'`), `training JSONB` (`{templateId, slotId}`), `match JSONB` (`{opponent, homeAway, start, end, note}`), `attendance JSONB NOT NULL DEFAULT '{}'`, `run JSONB` (nullable), `created_at`, `updated_at`. The calendar filters matches by `kind`. `attendance`/`run` exist now but stay empty/`null` until slice 7 (declared now → slice 7 needs no migration). A `kind:'training'` event carries `training` (no `match`); a `kind:'match'` carries `match` (no `training`) — enforced at schema + use-case.

### D-2. Template delete is GUARDED, not cascaded (founder: "don't let used templates be deleted", design §2.2)
`DeleteTemplateService` calls `eventRepo.existsForTemplate(templateId)` BEFORE the delete; if any active-tenant event references it → `Result.err('template-in-use')` (HTTP 409). The coach removes the events first. No cascade-delete of events, no orphans, no session-history loss. The slice-5 **drill → template-item strip** cascade (`DeleteDrillService.removeDrillReferences`) is unchanged; drill→event is indirect (the event references the template; a stripped drill just leaves the template). Both delete services' seam comments are re-pinned.

### D-3. teamManager read access + nav/landing (founder, design §2.3, §5.1, §5.7)
`teamManager` gains `eventRead` + `templateRead` + `drillRead` (read-only; no Templates/Drills nav) so the read-only calendar live-looks-up names/phase-bars/detail. `coach`/`assistantCoach` gain `eventRead`/`eventWrite`. `clubAdmin` holds all via `Object.values`; `facilities` unchanged. The **Calendar** nav shows for `coach`/`assistantCoach`/`teamManager` (`canSeeCalendar()`); teamManager's sign-in landing → `/calendar` (its FIRST nav surface). Team nav stays slice 8.

### D-4. Persisted F1 audit — emit via the substrate AuditService, persisted to kernel.audit_event (founder all-in-one, design §4, §5.5)
The 3 event use-cases (`Create`/`Update`/`Delete`) call `emitAuditEvent(registry, service, {packKey:'pack-kids-football', subtype, action, agent, entity, …})` on a SUCCESSFUL mutation. The manifest declares `auditSubtypes: event.created/updated/deleted`. `app.module.ts` imports `AuditSubtypeRegistryModule.forRoot({manifests})` and, in DB-mode, passes `auditEventRepository: new PrismaAuditEventRepository(appRoleClient)` to `SubstrateModule.forRoot` → persists to `kernel.audit_event`. In-memory mode (default dev/test) uses the substrate default `InMemoryAuditEventRepository` — same emit calls, swappable adapter. `retentionTier:'operational'`. Actor `userId` + `tenantPackId` from the request `TenantPackContext`.

### D-5. Substrate audit artifact ships as `2.1.1` from `main` (design §4, §9)
Additive (a new `sql/` file + parity spec; NO code/API change) → patch bump. `2.1.1 < 2.2.0` (the unmerged oncology branch's claimed version), so the oncology release line is undisturbed. The WORM triggers it projects already landed on substrate `main` (#171). Publish via `npm run publish:contracts` + `npm run publish:runtime` (needs `write:packages`; if this session's token is read-only, the founder runs the two commands).

### D-6. Scheduling guards — one-event-per-slot-per-date ENFORCED; over-length WARNED, not blocked (handoff "Interactions", design §1, §5.4)
`CreateEvent` (training) rejects a duplicate `(slotId, date)` → `Result.err('event-slot-taken')` (409) via `existsForSlot`. Over-length plans (template total > slot minutes) are allowed; the schedule modal warns ("{n} min over this slot") but Create stays enabled. Mirrors the slice-2 conflict-never-blocks posture.

### D-7. subjectSensitivity stays unset (charter, design §2.6)
The calendar schedules + shows facts only — no inferred player state. `PackManifest.subjectSensitivity` stays unset. Re-stated trigger for slices 7/8: the moment a slice surfaces *inferred player state*, set `subjectSensitivity: 'developmental-minor'` in that same red→green pass.

### D-8. No `GET :id` endpoint / `GetEvent` use-case — store-backed load (mirror drill/template, design §5.4)
The calendar loads events via `store.events()`; the detail/run loads via `store.events().find(id)` → `loadEvents()` fallback. `EventRepository.findById` is the internal primitive `Update`/`Delete` use. No `GET :id`.

### D-9. No stub-club event seed (design §5.6)
An empty calendar is the honest first-run; the browser run-through schedules one. Consistent with slice-5's no-template-seed.

### D-10. `run/:eventId` is a slice-7 STUB (design §5.7)
A placeholder page ("Run session — slice 7"; shows the event/template name + a "back to calendar" link) so the event-detail "Run session" button routes somewhere. Slice 7 replaces it. The detail button's label still flips Run / Resume / Session report from the event's `run` state (read-only this slice).

### D-11. Calendar date math = pure, clock-injectable contracts helpers (time-coupled-tests lesson)
Port the prototype's `pStartOfWeek`/`pAddDays`/`pIso`/`pFmt`/`pNextOccurrences` into a pure, tested `kf-calendar-dates.ts` in contracts with an **injected `now`/`today`** — NEVER hardcode calendar dates in tests (the SSE PT24H lesson; the slice-7 run timer leans on the same discipline).

### D-12. Derived-on-read, never persisted (ADR-176)
The week grid's hour range, ghosts, phase bars, budgets, and the slot-length validation are all looked up by id from slots/templates/drills at render time. The event row carries only references + JSONB. The template name is NOT denormalized (D-3 grants the read role the perms to look it up).

---

## Pre-flight (read before Task B1)

The implementer of each Part-B task must read the slice-5 **template** reference files for its layer and mirror their structure (adapt drill/template→event names; do NOT copy comments verbatim). All paths are on `origin/main` (the worktree base — the slice-5 vertical is present there):

- **Template vertical (the exact event mirror):** `libs/pack-kids-football-contracts/src/templates.ts` (schema + `CreateInputSchema` + barrel) · `libs/pack-kids-football/src/out-ports/template.repository.{ts,contract.ts,spec.ts}` (port + in-memory + the portable suite) · `src/out-adapters/prisma-template.repository.ts` (+ contract spec) · `out-ports/tenant-runner.port.ts` (the `template` delegate types + `TenantScopedClient.template` — mirror for `event`) · `out-adapters/prisma-guc.ts` (`CURRENT_TENANT_PACK_ID_SQL`, `isValidUuid`) · `out-adapters/testing/stub-delegates.ts`.
- **Use-cases + controller + module:** `in-ports/{list,create,update,delete}-template.use-case.ts` (Result types + Symbol tokens) · `application/{list,create,update,delete}-template.service.ts` · `application/delete-template.service.ts` (Task B7 edits this — the guard) · `application/delete-drill.service.ts` (Task B7 re-pins its seam) · `apps/pack-kids-football-api/src/app/templates.controller.ts` (the RBAC controller to copy) · `…/templates.e2e.spec.ts` · `…/pack-kids-football.module.ts` (provider + token-export block, `inMemoryRepoProviders`) · `…/pack-kids-football-auth.bootstrap.ts` (`PACK_KF_CONTROLLERS`) · `…/app.module.ts` (the `SubstrateModule.forRoot` composition root — Task B6 edits this).
- **Slot vertical (for the calendar geometry + slot-length):** `libs/pack-kids-football-contracts/src/slot-conflicts.ts` + `kf-slot-time` helpers (slot time strings, `dowOfDate`) — the schedule modal's slot-length math reuses these · `libs/pack-kids-football-ui/.../admin/training-slots-board.component.ts` (the Mon–Sun board — reference for the absolutely-positioned-by-time grid + team-color pills).
- **UI:** `lib/data/kids-football-api.client.ts` (template methods — `buildHeaders` + per-endpoint zod parse) · `lib/data/kf-club-store.ts` (`loadTemplates` + per-collection error signal + `error` aggregate + sign-out clear) · `lib/routes.ts` (templates routes; `new` before `:id`) · `lib/shell/kf-shell.component.ts` (`canSeeTemplates`/`canSeeDrills` nav predicates + role-landing map + `link(...)`) · `lib/templates/template-list-page.component.ts` (header/grid + phase bar + `ngOnInit` dual load) · `lib/templates/template-builder-page.component.ts` (sticky header, enabled-submit, store-backed load with loadFailed/notFound precedence, focus-trapped modal via `kf-modal-focus`) · `lib/drills/kf-phase-colors.ts` (`KF_PHASE_COLORS`/`KF_PHASE_FALLBACK`) · `lib/drills/{kf-phase-tag,kf-intensity-dots}.component.ts` · `lib/drills/sketch/kf-sketch-thumbnail.component.ts` · `lib/a11y/kf-modal-focus.ts` (`trapTabKey`/`focusFirstField`/`restoreFocus`) · `lib/shell/kf-route-tenant.ts` (`resolveTenantFromRoute`) · `lib/data/map-kf-error.ts` (`mapKfError`) · `lib/kf-i18n.ts`.
- **Audit (the F1 wiring):** `node_modules/@de-braighter/substrate-runtime` exports `AuditService`, `AuditSubtypeRegistry`, `AUDIT_SUBTYPE_REGISTRY`, `AuditSubtypeRegistryModule`, `emitAuditEvent`, `PrismaAuditEventRepository` (all from the package root). `node_modules/@de-braighter/substrate-contracts` exports `RecordAuditEventInput`, `AuditAgentInput`, `AuditEntityInput`, `AuditAction`. `SubstrateModule.forRoot` accepts `auditEventRepository?: AuditEventRepository | (() => …) | (new () => …)` (defaults to `InMemoryAuditEventRepository`; `AuditService` auto-provided). `PackManifest.auditSubtypes?: ReadonlyArray<{key, displayName, packKey?}>`. `TenantPackContext` carries `userId` + `tenantPackId`.

**Battle-tested gotchas to honor (slices 1–5 memory):**
- **`cmd | tail` (any pipe) returns the PIPE's exit code, not cmd's** — for gates run WITHOUT a masking pipe + capture `$?`: `npm run ci:local > /tmp/ci.log 2>&1; echo "EXIT=$?"` and READ the log. The `pack-football-visual-editor` **prod** build enforces a **per-component-style budget (6kB warn / 8kB ERROR)** — the week grid + schedule modal are big; decompose + trim inline CSS under 8kB. `nx serve` (dev config) hides this — always run the prod `ci:local`.
- **Foreground long `sleep` is BLOCKED** — wait for a dev server via Bash `run_in_background:true` + an `until`/`for` loop exiting on `localhost:4200|bundle generation complete` OR `Failed to compile|EADDRINUSE`. Short `sleep 8` inside a command is fine.
- **Test executor:** `@nx/angular:unit-test` (UI lib `test` target) REJECTS `--include`/`--run`/positional spec filters — run the full project suite: `NX_DAEMON=false npx nx test <project>` (`NX_DAEMON=false` avoids daemon-lock with the main clone's servers).
- **jsdom `localStorage` is a Proxy → `vi.spyOn` is silently dropped** — seed the real store or `vi.stubGlobal`.
- **Extending `TenantScopedClient` (the new `event` delegate) fans out** to `stub-delegates.ts` + EVERY sibling Prisma contract spec — a missed one is a TS2741 the type-stripped vitest gate misses (composite tsconfig.spec checks 0 files). The spec-reviewer must verify. Budget for it.
- Browser run-through catches what unit layers can't — **always `loadX()` on `ngOnInit`** (component specs stub a pre-populated store); parse **PER-ENDPOINT** response shapes (list vs single). Kill any orphan `:3150` PID before serving (`Get-NetTCPConnection -LocalPort 3150`). NEVER pipe a background `nx serve` through `head -N` (SIGPIPE).
- `toSignal(control.valueChanges)` not `computed()` over `control.value`. Absolute `['/t', tenant, …]` routerLink arrays via `resolveTenantFromRoute`. ONE `ACTIVE_TENANT_FN`/`inMemoryRepoProviders` token per module. zod chain order `.max(…).default(…)`.
- **Time-coupled tests rot** — the calendar/date helpers + any in-window assertions use an injected/fixed clock, NEVER hardcoded calendar dates (the SSE PT24H lesson).
- **devloop ritual** (MANDATORY, via `npx tsx src/cli.ts` from `domains/devloop`): `post-findings` uses the FULL `de-braighter/exercir#NN` form + the **Write tool** for JSON (PowerShell BOM breaks the parse); severity enum is `blocking|should-fix|nit|note` (no `info`); `backfill`/`reviews`/`resolve-findings` take `de-braighter/exercir` (OWNER/REPO, NO `#PR`); `drain`/`reconcile`/`post-findings` take `exercir#NN`. The `ritual:post-merge` npm script is hardcoded for devloop's own repo — run the steps manually for exercir.

## File structure (created/modified in this slice)

| File | Responsibility | Task |
|---|---|---|
| `layers/substrate/libs/substrate-runtime/sql/kernel-audit.sql` (NEW) · `…/sql/kernel-audit.artifact.spec.ts` (NEW or extend the existing artifact-parity test) · `libs/substrate-{contracts,runtime}/package.json` · CHANGELOG.md | published audit-table provisioning artifact + parity spec + `2.1.1` bump | A1 |
| (substrate gate + wave + publish) | `2.1.1` to GitHub Packages | A2 |
| `domains/exercir/package.json` · `prisma/` · `tools/db/test-db.mjs` | bump `^2.1.1`, `npm ci`, add `kernel-audit.sql` to `db:setup:core` + test-db | B0 |
| `libs/pack-kids-football-contracts/src/roles.ts` (+ spec) · `libs/pack-kids-football/src/manifest/pack-manifest.ts` (+ spec) | eventRead/eventWrite (12→14) + coach/AC/teamManager grants + `auditSubtypes` | B1 |
| `libs/pack-kids-football-contracts/src/events.ts` (+ spec) · `…/kf-calendar-dates.ts` (+ spec) · `src/index.ts` | EventSchema (+ training/match/run details), CreateEventInput, pure calendar-date helpers | B2 |
| `prisma/packs/kids-football.prisma` · `prisma/migrations/20260614120000_kids_football_event/migration.sql` | `Event` model + table/RLS | B3 |
| `libs/pack-kids-football/src/out-ports/event.repository.{ts,contract.ts,spec.ts}` · `out-ports/tenant-runner.port.ts` · `out-adapters/prisma-event.repository.ts` (+ contract spec) · `out-adapters/testing/stub-delegates.ts` · `src/index.ts` | port + in-memory + Prisma on ONE contract suite (incl. existsForTemplate/existsForSlot) + event delegate | B4 |
| `libs/pack-kids-football/src/in-ports/{list,create,update,delete}-event.use-case.ts` · `src/application/*-event.service.ts` (+ `event-use-cases.spec.ts`) · `src/index.ts` · `apps/…/pack-kids-football.module.ts` | Result<T,E> use-cases + slot-taken guard + DI wiring | B5 |
| `libs/pack-kids-football/src/application/*-event.service.ts` (audit) · `apps/…/app.module.ts` · `apps/…/pack-kids-football.module.ts` | `emitAuditEvent` in 3 use-cases + `AuditSubtypeRegistryModule` + `PrismaAuditEventRepository` DB-mode wiring | B6 |
| `libs/pack-kids-football/src/application/delete-template.service.ts` (+ spec) · `…/delete-drill.service.ts` | template-in-use delete guard + re-pinned seams | B7 |
| `apps/pack-kids-football-api/src/app/events.controller.ts` · `…/events.e2e.spec.ts` · `pack-kids-football-auth.bootstrap.ts` | RBAC endpoints + e2e (403 matrix + slot-taken + template-in-use + audit) | B8 |
| `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (+ spec) · `lib/data/kf-club-store.ts` (+ spec) | event client methods + store collection (`loadEvents`) | B9 |
| `lib/routes.ts` · `lib/shell/kf-shell.component.ts` (+ spec) · `lib/run/run-session-stub.page.component.ts` (NEW) · `lib/kf-i18n.ts` | calendar + run/:eventId routes + `canSeeCalendar` nav + teamManager landing | B10 |
| `lib/calendar/calendar-week-grid.component.ts` (+ spec) · `lib/calendar/upcoming-rail.component.ts` (+ spec) · `lib/calendar/kf-calendar-geometry.ts` (+ spec) | the week grid + rail + pure geometry helpers | B11 |
| `lib/calendar/schedule-training-modal.component.ts` (+ spec) | template→slot→date schedule modal | B12 |
| `lib/calendar/match-modal.component.ts` (+ spec) · `lib/calendar/event-detail-modal.component.ts` (+ spec) | match + event-detail modals | B13 |
| `lib/calendar/calendar-page.component.ts` (+ spec) | the screen shell (header + grid + rail + modal orchestration) | B14 |
| — | Slice gate, browser run-through, story issue, PR, verifier wave, ritual | B15 |

---

# PART A — substrate `sql/kernel-audit.sql` artifact (`2.1.1`)

## Task A1: Author the kernel-audit provisioning artifact + parity spec + bump 2.1.1

**Files (in `layers/substrate`):**
- Create: `libs/substrate-runtime/sql/kernel-audit.sql`, `libs/substrate-runtime/sql/kernel-audit.artifact.spec.ts` (or extend the existing event-log artifact-parity spec if one exists — `grep -rl "kernel-event-log.sql" libs/substrate-runtime/src` to find it)
- Modify: `libs/substrate-contracts/package.json`, `libs/substrate-runtime/package.json` (version `2.1.0` → `2.1.1`; runtime dep range on contracts → `^2.1.1`), `libs/substrate-runtime/CHANGELOG.md`, `libs/substrate-contracts/CHANGELOG.md`

> **Designer-first gate:** before writing the SQL, a `substrate-architect` pass confirms the artifact must be a faithful, idempotent projection of the authoritative migrations (no behavioural divergence) — this is the kernel's append-only audit log, the most safety-critical table set. `substrate-coder-pro` authors the SQL + the parity spec.

- [ ] **Step 1: Read the authoritative DDL.** Read all five migrations the artifact projects, in order: `prisma/migrations/20260528122322_kernel_audit/migration.sql` (the 4 tables: `audit_event`, `audit_event_chain`, `audit_chain_anchor`, `audit_legal_hold` + indexes + RLS), `…20260528122254_auditor_select_policy`, `…20260528122925_grant_schema_usage_to_app_auditor`, `…20260528142103_audit_tenant_pack_id_to_uuid` (the column-type correction — apply the FINAL shape, not the pre-correction one), `…20260613090000_kernel_audit_worm_triggers` (the BEFORE-UPDATE/DELETE WORM triggers). Read `libs/substrate-runtime/sql/kernel-event-log.sql` in full as the authoring template (header block, idempotency style, the "apply after app-roles.sql" note, the grant `DO` block).
- [ ] **Step 2: Write the failing parity spec** `kernel-audit.artifact.spec.ts` — mirror the event-log artifact's parity test if it exists; otherwise assert structurally: the artifact file exists; it contains `CREATE TABLE IF NOT EXISTS kernel.audit_event` (+ `audit_event_chain`, `audit_chain_anchor`, `audit_legal_hold`); every column name present in the authoritative `20260528122322_kernel_audit` (+ the `audit_tenant_pack_id_to_uuid` correction) `CREATE TABLE` blocks appears in the artifact (parse both, diff the column sets — no drift); it `ENABLE ROW LEVEL SECURITY` + `FORCE` on `audit_event`; it contains the WORM trigger function + the BEFORE UPDATE/DELETE triggers from `20260613090000`; it grants to `app` + `app_auditor`; every statement is idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE` / guarded `DO`). Run → FAIL (file absent).
- [ ] **Step 3: Author `kernel-audit.sql`.** A consolidated, idempotent projection of the five migrations, header-styled like `kernel-event-log.sql`:
  - Header block: "PUBLISHED ARTIFACT (ADR-206). Provisions `kernel.audit_event*` for a consuming pack that emits audit events via the substrate `AuditService`/`PrismaAuditEventRepository` (kernel concern #2). Apply AFTER `app-roles.sql`. Single source of truth = the consolidated, idempotent projection of substrate's authoritative kernel-audit migrations (kernel_audit + auditor_select_policy + grant_schema_usage_to_app_auditor + audit_tenant_pack_id_to_uuid + kernel_audit_worm_triggers)."
  - `CREATE SCHEMA IF NOT EXISTS kernel;` then `CREATE TABLE IF NOT EXISTS kernel.audit_event (…)` etc. with the EXACT final column shapes (apply the uuid correction). Idempotent indexes (`CREATE INDEX IF NOT EXISTS`). RLS `ENABLE`+`FORCE` (idempotent — `ALTER TABLE … ENABLE` is safe to re-run; wrap policy creation in `DROP POLICY IF EXISTS` + `CREATE POLICY`, the event-log artifact's pattern). The WORM trigger function as `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`. The grants in a guarded `DO` block (`IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app')` … `app_auditor`).
- [ ] **Step 4: Run the parity spec → PASS.** `npx nx test substrate-runtime` (or the project's test target). Also apply it against a scratch DB if the substrate test harness has a testcontainer (`grep -rl "testcontainer\|pg-mem\|DATABASE_URL" libs/substrate-runtime/src/audit`) — confirm `PrismaAuditEventRepository`'s existing contract spec passes against a DB provisioned by the new artifact (not just the Prisma migrations).
- [ ] **Step 5: Bump + CHANGELOG.** `2.1.0` → `2.1.1` in both package.json (runtime's `@de-braighter/substrate-contracts` dep range → `^2.1.1`). CHANGELOG entries under `## [2.1.1]`: "Publish `sql/kernel-audit.sql` — downstream provisioning artifact for `kernel.audit_event*` (ADR-206 pattern, mirrors `kernel-event-log.sql`). No code/API change. Enables packs to persist `AuditService` writes via `PrismaAuditEventRepository`." Note `2.1.1 < 2.2.0` so the oncology `b3-mixture-cure-family` line is unaffected.
- [ ] **Step 6: Commit** — `git add libs/substrate-runtime/sql/kernel-audit.sql libs/substrate-runtime/sql/kernel-audit.artifact.spec.ts libs/substrate-contracts/package.json libs/substrate-runtime/package.json libs/substrate-contracts/CHANGELOG.md libs/substrate-runtime/CHANGELOG.md` then `git commit -m "feat(audit): publish sql/kernel-audit.sql provisioning artifact + parity spec (2.1.1)"`.

## Task A2: Substrate gate + wave + publish 2.1.1

- [ ] **Step 1: Local gate.** From `layers/substrate`: the substrate `ci:local` (or `npm/pnpm run ci:local`) green — `npm run … > /tmp/sub-ci.log 2>&1; echo "EXIT=$?"` (no masking pipe).
- [ ] **Step 2: PR + verifier wave.** Open the substrate PR (this is a designer-first kernel-DDL change → full wave). Spawn `reviewer` + `charter-checker` + `qa-engineer` + `local-ci` (read-only, `isolation:"worktree"`, git-writes forbidden). The wave prompt: this is an ADDITIVE published artifact (no code change); the parity spec is the safety net proving no drift from the authoritative migrations; `2.1.1` deliberately avoids the oncology `2.2.0` slot. Post-findings, fix blockers/should-fixes, merge (squash) to substrate `main`.
- [ ] **Step 3: Publish.** From `layers/substrate` on `main` (post-merge): `npm run publish:contracts` then `npm run publish:runtime` (the `guard-version.mjs` gate confirms the version is unpublished). **Precondition:** a `GITHUB_TOKEN` with `write:packages`. If this session's token is read-only, STOP and ask the founder to run `! npm run publish:contracts` + `! npm run publish:runtime` from `layers/substrate` — Part B's audit-persistence `test:db` proof is gated on `2.1.1` being on the registry. Verify: `npm view @de-braighter/substrate-runtime version` → `2.1.1`.
- [ ] **Step 4: Twin ritual** for the substrate PR (drain/backfill/reconcile per the standard ritual, `de-braighter/substrate`).

---

# PART B — exercir calendar vertical + persisted F1 audit

## Task B0: Worktree + bump substrate dep + adopt the audit SQL artifact

**Files:**
- Modify: `domains/exercir/package.json` (dep ranges + `db:setup:core` script), `tools/db/test-db.mjs`

- [ ] **Step 1: Create the worktree** (per the header recipe) and `GITHUB_TOKEN=… npm ci` (still on `^2.1.0`).
- [ ] **Step 2: Bump the substrate dep ranges** in `package.json`: `@de-braighter/substrate-contracts` + `@de-braighter/substrate-runtime` → `^2.1.1`. Re-install: `GITHUB_TOKEN=… npm install` (updates the lockfile). Verify `npm ls @de-braighter/substrate-runtime` → `2.1.1`. **(Blocked until Task A2 publishes — if `2.1.1` is not yet on the registry, the install fails; complete Part A first.)**
- [ ] **Step 3: Adopt the audit artifact in `db:setup:core`.** Append to the `db:setup:core` script in `package.json`, after the `kernel-event-log.sql` line:

```
 && prisma db execute --file node_modules/@de-braighter/substrate-runtime/sql/kernel-audit.sql --schema ./prisma
```

  In `tools/db/test-db.mjs`, find where it runs `db:setup:core` (or applies the kernel-event-log artifact) and ensure the kernel-audit artifact is applied to the test DB too (so `test:db` provisions `kernel.audit_event*`). If `test-db.mjs` calls the `db:setup:core` npm script, no further edit is needed; if it hard-codes the artifact list, add the kernel-audit line.
- [ ] **Step 4: Verify** with Postgres up: `npm run db:setup:core` then `psql … -c "\dt kernel.audit_event"` (or a `prisma db execute` SELECT) confirms `kernel.audit_event` exists. (If no DB in the env, the wave + Task B8's `test:db` prove it live.)
- [ ] **Step 5: Commit** — `git add package.json package-lock.json tools/db/test-db.mjs` then `git commit -m "build(exercir): bump @de-braighter/substrate@^2.1.1 + provision kernel.audit_event via kernel-audit.sql"`.

## Task B1: Event permissions + role grants + manifest auditSubtypes (12→14)

**Files:**
- Modify: `libs/pack-kids-football-contracts/src/roles.ts` (+ `roles.spec.ts` if it asserts counts), `libs/pack-kids-football/src/manifest/pack-manifest.ts`, `…/pack-manifest.spec.ts`

- [ ] **Step 1: Write the failing specs** (`pack-manifest.spec.ts`, mirror the slice-5 edits):
  - rename `'declares all 12 permissions…'` → `'declares all 14 permissions, each prefixed kids-football.'` (`toEqual(Object.values(KF_PERMISSIONS))`);
  - `'grants clubAdmin all 12…'` → `…14…` (`Object.values`);
  - extend `coach` + `assistantCoach` expected arrays with `eventRead, eventWrite`;
  - update `teamManager` expected array to `[memberRead, teamRead, slotRead, eventRead, templateRead, drillRead]` (the read-only-calendar grant, D-3); assert `not.toContain(eventWrite)`/`templateWrite`/`drillWrite`;
  - `facilities` unchanged (`not.toContain(eventRead)`);
  - ADD `'declares the event audit subtypes'` — `manifest.auditSubtypes.map(s => s.key)` `toEqual(['event.created','event.updated','event.deleted'])`.
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx run-many -t test --projects=pack-kids-football-contracts,pack-kids-football`.
- [ ] **Step 3: Implement.** `roles.ts` — append to `KF_PERMISSIONS` (order matters):

```ts
  templateRead: 'kids-football.template.read',
  templateWrite: 'kids-football.template.write',
  eventRead: 'kids-football.event.read',
  eventWrite: 'kids-football.event.write',
```

  Update the doc-comment ("event read+write added in slice 6"). `pack-manifest.ts` — two new permission entries (`Object.values` order):

```ts
    { id: P.eventRead, displayName: 'Read the calendar / scheduled events' },
    { id: P.eventWrite, displayName: 'Schedule training, add matches, run sessions' },
```

  Append `P.eventRead, P.eventWrite` to BOTH `coach` and `assistantCoach`. Update `teamManager` to add `P.eventRead, P.templateRead, P.drillRead` with the pinned rationale:

```ts
      // teamManager read-only-calendar grant (slice 6, founder — design §2.3):
      // the Calendar is read-only for teamManager but renders scheduled-training
      // template NAMES + phase bars + the detail drill list, so it needs
      // templateRead + drillRead (live lookup, single source of truth) on top of
      // eventRead. NO write perms (no eventWrite/templateWrite/drillWrite — no
      // scheduling, match creation, or run-session). The Templates/Drills NAV
      // stays hidden for teamManager (canSeeCalendar only); it holds the read
      // perms without the nav, like clubAdmin holds template perms via Object.values.
```

  Add `auditSubtypes` to the manifest object:

```ts
  auditSubtypes: [
    { key: 'event.created', displayName: 'Calendar event created' },
    { key: 'event.updated', displayName: 'Calendar event updated' },
    { key: 'event.deleted', displayName: 'Calendar event deleted' },
  ],
```

  Update the manifest header doc ("Slice 6: event read+write; teamManager read-only-calendar grant; auditSubtypes for the persisted F1 audit trail (#245)").
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-contracts/src/roles.ts libs/pack-kids-football/src/manifest/pack-manifest.ts libs/pack-kids-football/src/manifest/pack-manifest.spec.ts` then `git commit -m "feat(exercir): kids-football S6 — event permissions + teamManager calendar grant + audit subtypes (12→14)"`.

## Task B2: Contracts — Event schemas + pure calendar-date helpers

**Files:**
- Create: `libs/pack-kids-football-contracts/src/events.ts`, `…/events.spec.ts`, `…/kf-calendar-dates.ts`, `…/kf-calendar-dates.spec.ts`
- Modify: `libs/pack-kids-football-contracts/src/index.ts`

- [ ] **Step 1: Write the failing specs.**
  - `events.spec.ts`: `EventSchema` parses a valid training event (`{id, teamId, date:'2026-06-16', kind:'training', training:{templateId, slotId}, attendance:{}}`) and a valid match (`{…, kind:'match', match:{opponent:'SV Blau', homeAway:'Home', start:9, end:10.5, note:''}, attendance:{}}`); REJECTS a training event with no `training`, a match with no `match`, a training event that ALSO has `match`, `match.end <= match.start`, a bad `date` (`'2026-6-1'`), a bad `homeAway`, a bad attendance status value. `CreateEventInputSchema` output has no `id`. `attendance` defaults to `{}` when omitted; `run` is optional.
  - `kf-calendar-dates.spec.ts` (clock injected — pass a fixed `today`): `isoDate(new Date('2026-06-16T12:00:00'))` → `'2026-06-16'`; `startOfWeek(date)` returns the Monday; `addDays`; `fmtDayLabel` → `'Tue 16 Jun'`; `nextOccurrences({recurring:true, dow:2}, 4, today)` returns the next 4 Tuesdays on/after `today` (assert with a FIXED `today`, never `new Date()`); `nextOccurrences({recurring:false, date:'2026-06-20'}, 4, today)` returns `['2026-06-20']` when in the future, `[]` when past `today`; TZ-stability (noon anchor) for a date near a DST boundary.
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx test pack-kids-football-contracts`.
- [ ] **Step 3: Implement `events.ts`:**

```ts
/**
 * Kids Football calendar-event contracts (slice 6). An Event is a single dated
 * occurrence on a team's calendar — either a TRAINING (a template scheduled onto
 * a slot) or a MATCH. Structured fields (id/teamId/date/kind) are columns; the
 * variant detail + attendance + run are JSONB (pack-representation boundary,
 * design §3, ADR-176). attendance/run are populated in slice 7; declared now.
 * Platform-agnostic (zod-only, no NestJS).
 */
import { z } from 'zod';

export const EVENT_KINDS = ['training', 'match'] as const;
export const MEMBER_ATTENDANCE = ['present', 'absent', 'sick', 'holiday', 'school'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export type MemberAttendance = (typeof MEMBER_ATTENDANCE)[number];

/** ISO calendar date YYYY-MM-DD (strict). */
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be ISO YYYY-MM-DD');

export const TrainingDetailSchema = z.object({
  templateId: z.string(),
  slotId: z.string(),
});
export const MatchDetailSchema = z
  .object({
    opponent: z.string().min(1).max(80),
    homeAway: z.enum(['Home', 'Away']),
    /** Float hours, e.g. 9.5 = 09:30. */
    start: z.number().min(0).max(24),
    end: z.number().min(0).max(24),
    note: z.string().max(200).default(''),
  })
  .refine((m) => m.end > m.start, { message: 'end must be after start', path: ['end'] });

/** Per-drill run log + ratings (slice 7 populates; defined now so the column is typed). */
export const RunSchema = z.object({
  startedAt: z.number(),
  drillStartedAt: z.number(),
  idx: z.number().int().min(0),
  completed: z.boolean(),
  finishedAt: z.number().nullable().optional(),
  log: z.array(z.object({ drillId: z.string(), plannedMin: z.number(), actualSec: z.number(), skipped: z.boolean() })),
  ratings: z.record(z.string(), z.enum(['yes', 'no'])),
});

export const EventSchema = z
  .object({
    id: z.string(),
    teamId: z.string(),
    date: IsoDate,
    kind: z.enum(EVENT_KINDS),
    training: TrainingDetailSchema.optional(),
    match: MatchDetailSchema.optional(),
    attendance: z.record(z.string(), z.enum(MEMBER_ATTENDANCE)).default({}),
    run: RunSchema.nullable().optional(),
  })
  .refine((e) => (e.kind === 'training' ? !!e.training && !e.match : !!e.match && !e.training), {
    message: 'training events require `training` (and no `match`); match events require `match` (and no `training`)',
    path: ['kind'],
  });
export type ExercirEvent = z.infer<typeof EventSchema>;
export type TrainingDetail = z.infer<typeof TrainingDetailSchema>;
export type MatchDetail = z.infer<typeof MatchDetailSchema>;
export type EventRun = z.infer<typeof RunSchema>;

export const CreateEventInputSchema = EventSchema.innerType().omit({ id: true }).superRefine((e, ctx) => {
  if (e.kind === 'training' ? !(e.training && !e.match) : !(e.match && !e.training))
    ctx.addIssue({ code: 'custom', path: ['kind'], message: 'detail must match kind' });
});
export type CreateEventInput = z.infer<typeof CreateEventInputSchema>;
```

  > Note: `.refine()` returns a `ZodEffects`; to `.omit()` you operate on the inner object then re-attach the refinement via `.superRefine` (shown). The implementer verifies the exact zod composition compiles (zod `^3.24`) — if `innerType().omit` is awkward, define the base `z.object` once, derive both `EventSchema` (base + refine) and `CreateEventInputSchema` (base.omit + refine) from it.

  Implement `kf-calendar-dates.ts` — pure, clock-injected:

```ts
/** Pure calendar-date helpers for the week grid + scheduling. Clock is ALWAYS
 *  injected (a `today: Date` arg) — never read `new Date()` here, so tests pin
 *  time (the time-coupled-tests lesson). Ported from prototype calendar.jsx. */
const DAY_MS = 86_400_000;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDays(d: Date, n: number): Date { return new Date(d.getTime() + n * DAY_MS); }
export function startOfWeek(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  return new Date(x.getTime() - ((x.getDay() + 6) % 7) * DAY_MS); // Monday
}
export function fmtDayLabel(d: Date): string { return `${DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${MON[d.getMonth()]}`; }
export function dowIndex(d: Date): number { return (d.getDay() + 6) % 7 + 1; } // 1=Mon..7=Sun

export interface OccurrenceSlot { recurring: boolean; dow?: number; date?: string; }
/** Next `count` future (>= today) occurrences of a slot, as Date[] (noon-anchored). */
export function nextOccurrences(slot: OccurrenceSlot, count: number, today: Date): Date[] {
  const t0 = new Date(today); t0.setHours(0, 0, 0, 0);
  if (!slot.recurring && slot.date) {
    const d = new Date(slot.date + 'T12:00:00');
    return d >= t0 ? [d] : [];
  }
  const out: Date[] = [];
  let d = new Date(t0); d.setHours(12, 0, 0, 0);
  for (let i = 0; i < 60 && out.length < count; i++) {
    if (dowIndex(d) === slot.dow) out.push(new Date(d));
    d = addDays(d, 1);
  }
  return out;
}
```

  Export everything from `src/index.ts` (`EVENT_KINDS`, `MEMBER_ATTENDANCE`, `EventSchema`, `TrainingDetailSchema`, `MatchDetailSchema`, `RunSchema`, `CreateEventInputSchema`, the types; and all the `kf-calendar-dates` helpers).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-contracts/src/events.ts libs/pack-kids-football-contracts/src/events.spec.ts libs/pack-kids-football-contracts/src/kf-calendar-dates.ts libs/pack-kids-football-contracts/src/kf-calendar-dates.spec.ts libs/pack-kids-football-contracts/src/index.ts` then `git commit -m "feat(exercir): kids-football S6 — Event contracts + pure calendar-date helpers"`.

## Task B3: Migration — kids_football.event table + RLS

**Files:**
- Modify: `prisma/packs/kids-football.prisma`
- Create: `prisma/migrations/20260614120000_kids_football_event/migration.sql`

- [ ] **Step 1: Add the `Event` model** to `prisma/packs/kids-football.prisma` (after `Template`), mirroring the Template model's conventions:

```prisma
/// A single dated calendar occurrence for a team (slice 6) — a TRAINING (template
/// scheduled onto a slot) or a MATCH. Structured cols (team_id/date/kind) are
/// queryable; `training`/`match`/`attendance`/`run` are JSONB per the pack boundary
/// (design §3, ADR-176). attendance/run populated in slice 7. tenantPackId
/// RLS-scopes the row (kids_football.event_tenant_pack_isolation).
model Event {
  id           String   @id @default(uuid()) @db.Uuid
  tenantPackId String   @map("tenant_pack_id") @db.Uuid
  teamId       String   @map("team_id") @db.Uuid
  date         String
  kind         String
  training     Json?
  match        Json?
  attendance   Json     @default("{}")
  run          Json?
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([tenantPackId])
  @@index([tenantPackId, date])
  @@map("event")
  @@schema("kids_football")
}
```

- [ ] **Step 2: Write the migration SQL** `prisma/migrations/20260614120000_kids_football_event/migration.sql`, mirroring `20260613120000_kids_football_template/migration.sql` (ENABLE+FORCE RLS, USING + INSERT WITH CHECK + explicit FOR UPDATE, guarded `app` grant):

```sql
-- kids-football S6 calendar — CREATE the event table for scheduled trainings +
-- matches (training/match/attendance/run JSONB). Convention mirrors
-- 20260613120000_kids_football_template: UUID PK, snake_case, ENABLE + FORCE RLS,
-- USING + WITH CHECK (INSERT) + explicit FOR UPDATE (attendance/run mutations land
-- in slice 7), grants to the non-superuser `app` role via a guarded DO block.
-- Forward-only (§20 P5).

CREATE TABLE "kids_football"."event" (
    "id"             UUID         NOT NULL,
    "tenant_pack_id" UUID         NOT NULL,
    "team_id"        UUID         NOT NULL,
    "date"           TEXT         NOT NULL,
    "kind"           TEXT         NOT NULL,
    "training"       JSONB,
    "match"          JSONB,
    "attendance"     JSONB        NOT NULL DEFAULT '{}',
    "run"            JSONB,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "event_tenant_pack_id_idx" ON "kids_football"."event"("tenant_pack_id");
CREATE INDEX "event_tenant_pack_id_date_idx" ON "kids_football"."event"("tenant_pack_id", "date");

ALTER TABLE "kids_football"."event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kids_football"."event" FORCE ROW LEVEL SECURITY;

CREATE POLICY event_tenant_pack_isolation ON "kids_football"."event"
  USING ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));

CREATE POLICY event_tenant_pack_isolation_write ON "kids_football"."event"
  FOR INSERT
  WITH CHECK ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));

-- Event has a real in-place UPDATE path (PATCH /:id; attendance/run in slice 7).
-- The FOR ALL isolation USING already doubles as the UPDATE WITH CHECK default;
-- this DECLARES the tenant-rewrite guard explicitly (slot/template precedent).
CREATE POLICY event_tenant_pack_isolation_update ON "kids_football"."event"
  FOR UPDATE
  USING ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true))
  WITH CHECK ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));

DO $grant_block$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app') THEN
    EXECUTE 'GRANT USAGE ON SCHEMA kids_football TO app';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON "kids_football"."event" TO app';
  END IF;
END
$grant_block$;
```

- [ ] **Step 3: Regenerate the client + verify** — `npm run db:generate`; with Postgres up confirm `npx prisma migrate status` shows the new migration (do NOT hand-edit `migration_lock`). (No DB → reviewed by the wave + proven live in Task B8 `test:db`.)
- [ ] **Step 4: Build** — `NX_DAEMON=false npx nx run-many -t build --projects=pack-kids-football,pack-kids-football-api` (the generated client compiles against `Event`).
- [ ] **Step 5: Commit** — `git add prisma/packs/kids-football.prisma prisma/migrations/20260614120000_kids_football_event` then `git commit -m "feat(exercir): kids-football S6 — event table + RLS migration"`.

## Task B4: Event repository — port + in-memory + Prisma on ONE contract suite (+ existsForTemplate/existsForSlot)

**Files:**
- Create: `libs/pack-kids-football/src/out-ports/event.repository.ts`, `…/event.repository.contract.ts`, `…/event.repository.spec.ts`, `out-adapters/prisma-event.repository.ts`, `out-adapters/prisma-event.repository.contract.spec.ts`
- Modify: `out-ports/tenant-runner.port.ts`, `out-adapters/testing/stub-delegates.ts`, `src/index.ts`

- [ ] **Step 1: Write the failing contract suite** `event.repository.contract.ts` (run against BOTH impls; mirror `template.repository.contract.ts`). `EventRepositoryHarness = { repo; setTenant(id); tenants:{a,b} }`. `makeTrainingEvent(overrides?)` → valid `CreateEventInput` (`{teamId:TEAM_A, date:'2026-06-16', kind:'training', training:{templateId:TPL_A, slotId:SLOT_A}, attendance:{}}`); `makeMatchEvent(overrides?)`. Cases:
  - `list` empty for a fresh tenant.
  - `create` returns the event with a truthy id; `list` returns it; JSONB `training`/`match`/`attendance`/`run` round-trip deep-equal.
  - `findById` → null for absent/malformed uuid; returns the created event; null cross-tenant.
  - `update` merges (patch `{attendance}` leaves `training` untouched; patch `{run}` sets it); absent id → null; cross-tenant id → null (count-0).
  - `delete` → true + gone; absent id → false; cross-tenant id → false (B cannot delete A; A still lists it).
  - `existsForTemplate(TPL_A)`: true when a training event references it; false when none; cross-tenant — B's events don't make A's `existsForTemplate` true (run under A's tenant after seeding only B). Returns false for a match-only tenant.
  - `existsForSlot(SLOT_A, '2026-06-16')`: true when a training event occupies that slot+date; false for a different date or slot; cross-tenant invisible.
  - Mutation isolation (mutating a returned event / its JSONB does not corrupt the store).
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx test pack-kids-football`.
- [ ] **Step 3: Implement.** `event.repository.ts` — port + in-memory (mirror `template.repository.ts`):

```ts
import type { ExercirEvent } from '@de-braighter/pack-kids-football-contracts';

export type CreateEventInput = Omit<ExercirEvent, 'id'>;
export type UpdateEventPatch = Partial<CreateEventInput>;

export interface EventRepository {
  list(): Promise<readonly ExercirEvent[]>;
  findById(id: string): Promise<ExercirEvent | null>;
  /** Create one event. Returns the created event. F1 audit is emitted by the
   *  CreateEvent use-case (slice 6, exercir#245 — event vertical wired). */
  create(input: CreateEventInput): Promise<ExercirEvent>;
  /** Partial update; null when the id does not resolve for the active tenant. */
  update(id: string, patch: UpdateEventPatch): Promise<ExercirEvent | null>;
  /** Delete; true when removed, false when absent. */
  delete(id: string): Promise<boolean>;
  /** Guard primitive (design §2.2): does ANY active-tenant event reference this
   *  template (training.templateId === templateId)? Backs the template-in-use
   *  delete guard — a referenced template cannot be deleted. */
  existsForTemplate(templateId: string): Promise<boolean>;
  /** Guard primitive (design §2.6): is this slot already booked on this date
   *  (one-event-per-slot-per-date)? Backs the schedule create guard. */
  existsForSlot(slotId: string, date: string): Promise<boolean>;
}

export const EVENT_REPOSITORY = Symbol('EVENT_REPOSITORY');
```

  `InMemoryEventRepository` — `Map<tenantId, Map<eventId, ExercirEvent>>`, `structuredClone` both boundaries, `crypto.randomUUID()` id mint. `update` forwards only `!== undefined` keys (`teamId`/`date`/`kind`/`training`/`match`/`attendance`/`run`); JSONB values replace via clone when present. `existsForTemplate`: `[...bucket.values()].some(e => e.kind==='training' && e.training?.templateId === templateId)`. `existsForSlot`: `…some(e => e.kind==='training' && e.training?.slotId === slotId && e.date === date)`.

  `tenant-runner.port.ts` — add the **Event delegate types** (mirror the Template block; single `create`):

```ts
export interface TenantScopedEventRow {
  readonly id: string; readonly tenantPackId: string; readonly teamId: string;
  readonly date: string; readonly kind: string;
  readonly training: unknown; readonly match: unknown;
  readonly attendance: unknown; readonly run: unknown;
  readonly createdAt: Date; readonly updatedAt: Date;
}
export interface TenantScopedEventCreateInput {
  id: string; tenantPackId: string; teamId: string; date: string; kind: string;
  training: unknown; match: unknown; attendance: unknown; run: unknown;
}
export interface TenantScopedEventUpdateData {
  teamId?: string; date?: string; kind?: string;
  training?: unknown; match?: unknown; attendance?: unknown; run?: unknown;
}
export interface TenantScopedEventDelegate {
  findMany(args: { orderBy?: { date: 'asc' | 'desc' } }): Promise<readonly TenantScopedEventRow[]>;
  findUnique(args: { where: { id: string } }): Promise<TenantScopedEventRow | null>;
  create(args: { data: TenantScopedEventCreateInput }): Promise<TenantScopedEventRow>;
  updateMany(args: { where: { id: string }; data: TenantScopedEventUpdateData }): Promise<{ count: number }>;
  deleteMany(args: { where: { id: string } }): Promise<{ count: number }>;
}
```

  Add `readonly event: TenantScopedEventDelegate;` to `TenantScopedClient`. Extend `out-adapters/testing/stub-delegates.ts` with an `event` stub delegate (mirror the `template` stub) AND fix every sibling Prisma contract spec literal that the `TenantScopedClient` growth fans out to (the budgeted TS2741 gotcha — grep `TenantScopedClient` and `stub-delegates` usages).

  `prisma-event.repository.ts` (mirror `prisma-template.repository.ts`): `list` (findMany orderBy date asc → `rowToEvent`), `findById` (uuid-guard → findUnique), `create` (`runner.run` → read active tenant via `CURRENT_TENANT_PACK_ID_SQL` → `tx.event.create({data:{id: randomUUID(), tenantPackId, teamId, date, kind, training, match, attendance: input.attendance ?? {}, run: input.run ?? null}})`), `update` (uuid-guard; presence-driven `data`; empty `data` → `findById`; `updateMany` count-0 → null → findUnique re-read → map), `delete` (uuid-guard → deleteMany count boolean), `existsForTemplate`/`existsForSlot` (`runner.run` → `findMany` → JS `.some(...)` on the mapped rows — JSONB `training` is parsed in `rowToEvent`; acceptable at club scale). `rowToEvent` casts the JSONB columns to the contract types and coerces `attendance` to `{}` when null. Carry the audit-deferred-to-use-case doc-comment on the mutations.

  `prisma-event.repository.contract.spec.ts` — fake-delegate harness (in-memory `event` delegate proving the row shape) running the same suite + the DB-gated block.
  Export `EventRepository`, `EVENT_REPOSITORY`, `InMemoryEventRepository`, `CreateEventInput`, `UpdateEventPatch`, `PrismaEventRepository` from `src/index.ts`.
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx run-many -t lint test --projects=pack-kids-football`.
- [ ] **Step 5: Commit** — explicit `git add` of the 5 created files + `tenant-runner.port.ts` + `stub-delegates.ts` + `src/index.ts`, then `git commit -m "feat(exercir): kids-football S6 — event repository (port + in-memory + Prisma, one contract suite) + existsForTemplate/existsForSlot guards"`.

## Task B5: Event use-cases (list/create/update/delete, Result<T,E>) + slot-taken guard + module wiring

**Files:**
- Create: `libs/pack-kids-football/src/in-ports/{list-events,create-event,update-event,delete-event}.use-case.ts`, `src/application/{list-events,create-event,update-event,delete-event}.service.ts`, `…/event-use-cases.spec.ts`
- Modify: `src/index.ts`, `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts`

- [ ] **Step 1: Write the failing specs** (`event-use-cases.spec.ts`, in-memory repo; mirror `template-use-cases.spec.ts`): list returns created events; create-training happy (validates via `CreateEventInputSchema`, returns event with id); create with bad detail (kind/detail mismatch) → `invalid-input`; **create training onto an already-booked `(slotId, date)` → `event-slot-taken`** (seed one, create a second on the same slot+date); create match happy; update happy (patch `attendance` only — training preserved); update validates the merged candidate; update unknown id → `event-not-found`; delete happy → ok; delete unknown id → `event-not-found`. (Audit emission is added + asserted in Task B6 — keep these specs audit-agnostic by injecting a no-op AuditService double, OR defer the audit dep to B6 and add it here as a constructor param with a stub.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** In-ports mirror the template quartet (Symbol tokens; `CreateEventInput`/`UpdateEventPatch` re-exported from the port):

```ts
// create-event.use-case.ts
export type { CreateEventInput } from '../out-ports/event.repository.js';
export type CreateEventFailure =
  | { kind: 'invalid-input'; detail: string }
  | { kind: 'event-slot-taken'; slotId: string; date: string };
export type CreateEventResult = { ok: true; value: ExercirEvent } | { ok: false; error: CreateEventFailure };
export interface CreateEventUseCase { createEvent(input: CreateEventInput): Promise<CreateEventResult>; }
export const CREATE_EVENT_USE_CASE = Symbol('CREATE_EVENT_USE_CASE');
// update: failure 'invalid-input' | 'event-not-found' (carries id); patch UpdateEventPatch
// delete: failure 'event-not-found' (carries id)
// list:   failure never
```

  Services:
  - `ListEventsService` — `repo.list()` → ok.
  - `CreateEventService` — `CreateEventInputSchema.safeParse(input)` → first-issue `invalid-input`; **if `kind==='training'` and `await repo.existsForSlot(training.slotId, date)` → `event-slot-taken`**; `repo.create(parsed.data)` → value. (Over-length is NOT checked here — warned in the UI only, D-6.)
  - `UpdateEventService` — `repo.findById(id)` → `event-not-found`; merge `{...existingMinusId, ...definedKeys(patch)}`; validate merged via `EventSchema` (or the inner object) → `invalid-input`; `repo.update(id, patch)` → null ⇒ `event-not-found`.
  - `DeleteEventService` — `repo.delete(id)` → false ⇒ `event-not-found`.

  Export all from `src/index.ts`. In `PackKidsFootballModule` wire the `EVENT_REPOSITORY` provider (add `Event` to the `inMemoryRepoProviders` set + the Prisma binding, mirroring `TEMPLATE_REPOSITORY`; NO shared store-map seed — D-9) and the four use-case providers + `useExisting` token bindings + the four token exports.
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx run-many -t test --projects=pack-kids-football,pack-kids-football-api`.
- [ ] **Step 5: Commit** — explicit `git add` of the 9 created files + `src/index.ts` + `pack-kids-football.module.ts`, then `git commit -m "feat(exercir): kids-football S6 — event use-cases (Result<T,E>) + one-event-per-slot-per-date guard + module wiring"`.

## Task B6: Persisted F1 audit — emit in use-cases + composition-root wiring

**Files:**
- Modify: `libs/pack-kids-football/src/application/{create-event,update-event,delete-event}.service.ts` (+ `event-use-cases.spec.ts`), `apps/pack-kids-football-api/src/app/app.module.ts`, `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts`

- [ ] **Step 1: Write the failing audit specs** (extend `event-use-cases.spec.ts`): construct the 3 services with a REAL `AuditService` over an `InMemoryAuditEventRepository` + an `AuditSubtypeRegistry` seeded from the pack manifest (`new AuditSubtypeRegistry()`; register the manifest's `auditSubtypes` under `packKey:'pack-kids-football'` — mirror `AuditSubtypeBootstrap.onApplicationBootstrap`), and a stub request context exposing `userId`/`tenantPackId`. Assert: a successful `createEvent` produces exactly ONE audit event (`auditService.query({...}, scope)`) with `eventType:'kids-football.event.created'`, `action:'C'`, `agent[0].userId === ctx.userId`, `entity[0].linkedDomainRecordRef === createdId`, `retentionTier:'operational'`; `updateEvent` → `action:'U'` `event.updated`; `deleteEvent` → `action:'D'` `event.deleted`; a FAILED mutation (slot-taken / not-found) emits NO audit event. (Use `@de-braighter/substrate-runtime/testing` for `InMemoryAuditEventRepository` if exported there; else from the runtime root.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Inject `AuditService` + `AuditSubtypeRegistry` + the request `TenantPackContext` seam into the 3 services (the pack already reads `request.tenantPackContext` lazily — reuse that seam to get `userId` + `tenantPackId`; for the use-case unit, pass a `() => {userId, tenantPackId}` accessor or the context, matching how `ACTIVE_TENANT_FN` is provided). On a SUCCESSFUL mutation, after the repo call:

```ts
import { emitAuditEvent, type AuditService, type AuditSubtypeRegistry } from '@de-braighter/substrate-runtime';

await emitAuditEvent(this.auditRegistry, this.auditService, {
  packKey: 'pack-kids-football',
  subtype: 'event.created',                 // 'event.updated' | 'event.deleted'
  eventType: 'kids-football.event.created', // mirror the verb
  action: 'C',                              // 'U' | 'D'
  outcome: 'success',
  tenantPackId: ctx.tenantPackId,
  agent: [{ role: 'actor', userId: ctx.userId }],
  entity: [{ role: 'target', what: 'kids_football.event', linkedDomainRecordRef: created.id }],
  retentionTier: 'operational',
});
```

  > A failed mutation returns its `Result.err` BEFORE the emit — the audit reflects the real outcome. Wrap the emit so an audit-write failure does not corrupt the mutation result (log + continue): the mutation already succeeded; per charter D1 (demo posture) an audit-write hiccup must not 500 a successful schedule. Pin this in a doc-comment.

  `app.module.ts` — import `AuditSubtypeRegistryModule.forRoot({ manifests: [PACK_KIDS_FOOTBALL_MANIFEST] })` (provides + bootstraps `AUDIT_SUBTYPE_REGISTRY` from `manifest.auditSubtypes`). In the DB-mode branch (`packKidsFootballDbEnabled()`), pass `auditEventRepository: new PrismaAuditEventRepository(appRoleClient)` to `SubstrateModule.forRoot` so audit persists to `kernel.audit_event`; in-memory mode keeps the substrate default. Inject `AuditService` + `AUDIT_SUBTYPE_REGISTRY` into the 3 event services via `PackKidsFootballModule` providers (they resolve from the SubstrateModule's global exports).

  > **Doc-comment posture flip:** the event repo + use-case comments change from "no F1 event-log write (exercir#245)" to "F1 audit wired (exercir#245, event vertical): each mutation emits a kernel.audit_event via emitAuditEvent → AuditService → PrismaAuditEventRepository (DB mode) / InMemoryAuditEventRepository (dev/test). The other verticals follow the same pattern (#245 remainder)."
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx run-many -t test --projects=pack-kids-football,pack-kids-football-api`.
- [ ] **Step 5: Commit** — explicit `git add` of the 3 services + spec + `app.module.ts` + `pack-kids-football.module.ts`, then `git commit -m "feat(exercir): kids-football S6 — persisted F1 audit (emitAuditEvent in event use-cases + PrismaAuditEventRepository wiring) — closes #245 for the event vertical"`.

## Task B7: Template-in-use delete guard + re-pinned seams

**Files:**
- Modify: `libs/pack-kids-football/src/application/delete-template.service.ts` (+ its spec / `template-use-cases.spec.ts`), `…/delete-drill.service.ts`

- [ ] **Step 1: Write the failing spec.** In the template-delete tests (in-memory `TemplateRepository` + in-memory `EventRepository` under the same `activeTenant`): seed a template `T`; (a) with NO event referencing it → `deleteTemplate(T.id)` ok + gone; (b) with a training event referencing `T` (`training.templateId === T.id`) → `deleteTemplate(T.id)` → `Result.err({kind:'template-in-use'})` and `T` STILL lists (not deleted). Add: a match event (no `training`) does NOT block deletion.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Add `@Inject(EVENT_REPOSITORY) private readonly eventRepo: EventRepository` to `DeleteTemplateService`; before `repo.delete(id)`:

```ts
/**
 * Delete guard (slice 6, design §2.2, founder "don't delete used templates"):
 * a template referenced by ANY active-tenant event cannot be deleted — the
 * coach removes those calendar events first. Read-then-delete is non-atomic
 * across the template + event repos (slice-2 cascade convention): a concurrent
 * schedule between the check and the delete could race; tolerated at club scale.
 * No cascade-delete of events (would erase session history slice 8 aggregates).
 */
if (await this.eventRepo.existsForTemplate(id)) {
  return { ok: false, error: { kind: 'template-in-use', id } };
}
```

  Add `'template-in-use'` to `DeleteTemplateFailure` (carries `id`). Re-pin `delete-drill.service.ts`'s seam comment: "drill→template items cascaded (slice 5); drill→event is INDIRECT (events reference templates, not drills — a stripped drill just leaves the template). The template→event relationship is guarded at DeleteTemplateService (slice 6): a used template cannot be deleted." Confirm both providers resolve in `PackKidsFootballModule` (the `EVENT_REPOSITORY` provider from Task B5 is in the same module).
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx test pack-kids-football`.
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football/src/application/delete-template.service.ts libs/pack-kids-football/src/application/*template*.spec.ts libs/pack-kids-football/src/application/delete-drill.service.ts` then `git commit -m "feat(exercir): kids-football S6 — template-in-use delete guard + re-pinned cascade seams"`.

## Task B8: Events HTTP controller + RBAC e2e + audit + test:db

**Files:**
- Create: `apps/pack-kids-football-api/src/app/events.controller.ts`, `…/events.e2e.spec.ts`
- Modify: `…/pack-kids-football-auth.bootstrap.ts` (`PACK_KF_CONTROLLERS`), the `rls.integration.spec.ts` (the live-RLS proof set)

- [ ] **Step 1: Write the failing e2e** (`events.e2e.spec.ts`, in-memory binding; mirror `templates.e2e.spec.ts`):
  - as club-A **coach** — `GET /kids-football/events` → 200 `[]`; create a template + slot first (or reuse seeded ids), `POST` a valid training event → 201; `GET` shows 1; `PATCH /:id` `{attendance:{...}}` → 200; `DELETE /:id` → 204, back to 0; `POST` a match event → 201;
  - **slot-taken:** `POST` two trainings on the same `(slotId, date)` → second → 409 `{kind:'event-slot-taken'}`;
  - **template-in-use:** create a template + a training event referencing it, `DELETE /kids-football/templates/:id` → 409 `{kind:'template-in-use'}`;
  - as club-A **teamManager** — `GET /kids-football/events` → 200 (eventRead), `POST` → 403, `PATCH`/`DELETE` → 403; `GET /kids-football/templates` → 200 (templateRead grant, D-3); as **facilities** — `GET /kids-football/events` → 403;
  - as club-B **coach** — `GET` → 200 with ONLY club B's events (cross-club invisibility);
  - invalid `POST` (kind/detail mismatch) → 400; `PATCH` unknown uuid → 404 `{kind:'event-not-found'}`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `events.controller.ts` — copy `templates.controller.ts`, swapping template→event tokens/use-cases + `template-not-found`→`event-not-found`, and map the two new failures: `event-slot-taken` → 409, the controller does NOT own template-in-use (that's the templates controller's DELETE, which already returns the `DeleteTemplate` Result — extend its error mapping to map `template-in-use` → 409).

```ts
@Controller('kids-football/events')
export class KidsFootballEventsHttpController {
  // GET    @RequiresPermission(KF_PERMISSIONS.eventRead)   → 200 ExercirEvent[]
  // POST   @RequiresPermission(KF_PERMISSIONS.eventWrite)  → 201 | 400(invalid-input) | 409(event-slot-taken)
  // PATCH  :id @RequiresPermission(KF_PERMISSIONS.eventWrite) → 200 | 400 | 404(event-not-found)
  // DELETE :id @RequiresPermission(KF_PERMISSIONS.eventWrite) → 204 | 404(event-not-found)
}
```

  In `templates.controller.ts` DELETE handler, map `template-in-use` → `throw new ConflictException({kind:'template-in-use'})`. Append `KidsFootballEventsHttpController` to `PACK_KF_CONTROLLERS`.
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx test pack-kids-football-api`, then with Postgres up `npm run test:db`. **Extend `rls.integration.spec.ts`:** add the `kids_football.event` live-RLS proof (cross-tenant count-0 on list/update/delete under `NOBYPASSRLS`) AND the **persisted-audit proof** — perform a real event create through the DB-mode stack and assert a row appears in `kernel.audit_event` scoped to the tenant (and is cross-tenant invisible). If folding the slice-5 reviewer's deferred cross-tenant cascade-isolation assertion is natural here, add it.
- [ ] **Step 5: Commit** — `git add apps/pack-kids-football-api/src/app/events.controller.ts apps/pack-kids-football-api/src/app/events.e2e.spec.ts apps/pack-kids-football-api/src/app/templates.controller.ts apps/pack-kids-football-api/src/app/pack-kids-football-auth.bootstrap.ts` (+ the rls spec path) then `git commit -m "feat(exercir): kids-football S6 — events RBAC endpoints + e2e (403 matrix + slot-taken + template-in-use + audit) + live RLS/audit test:db"`.

## Task B9: UI data tier — event client methods + store collection

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (+ spec), `lib/data/kf-club-store.ts` (+ spec)

- [ ] **Step 1: Write the failing tests.**
  - Client spec: `listEvents()` GETs `/kids-football/events` with identity headers, parses `z.array(EventSchema)`, rejects a malformed entry; `createEvent(payload)` POSTs + parses `EventSchema`; `updateEvent(id, patch)` PATCHes; `deleteEvent(id)` DELETEs → void.
  - Store spec: `events()` empty initially; `loadEvents()` populates + clears `eventsError`; a 403 sets `eventsError` via `mapKfError` + leaves `events` untouched; `loadEvents` is NOT part of `refresh()`; `eventsError` is in the `error` aggregate; the sign-out effect clears `_events`/`_eventsError`.
- [ ] **Step 2: Run → FAIL** — `NX_DAEMON=false npx nx test pack-kids-football-ui`.
- [ ] **Step 3: Implement.** Client — `EventListSchema = z.array(EventSchema)` + four methods mirroring the template quartet (`createEvent(payload: Omit<ExercirEvent,'id'>)`, `updateEvent(id, patch: Partial<Omit<ExercirEvent,'id'>>)`, `deleteEvent(id)`). Store — `_events`/`_eventsError` signals + readonly views + `loadEvents()` (mirror `loadTemplates`, incl. error-isolation); add `_eventsError` to the `error` aggregate computed; add both signals to the sign-out clear effect; doc-comment why events stay out of `refresh()`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.spec.ts libs/pack-kids-football-ui/src/lib/data/kf-club-store.ts libs/pack-kids-football-ui/src/lib/data/kf-club-store.spec.ts` then `git commit -m "feat(exercir): kids-football S6 — event client methods + store collection"`.

## Task B10: Routes + nav (canSeeCalendar + teamManager landing) + run/:eventId stub + i18n

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/run/run-session-stub.page.component.ts` (+ spec)
- Modify: `lib/routes.ts`, `lib/shell/kf-shell.component.ts` (+ spec), `lib/kf-i18n.ts`

- [ ] **Step 1: Write the failing shell spec.** `kf-shell.component.spec.ts`: a `coach` session renders the Calendar nav link (`[data-testid="kf-nav-calendar"]`) → `['/t', tenant, 'p', 'kids-football', 'calendar']`; `assistant-coach` renders it; **`team-manager` renders it** (its first nav surface, D-3); a `club-admin` session does NOT (clubAdmin lives on Club tabs); a `facilities`/none session does not. Also: a `team-manager` session's landing redirect resolves to `/calendar` (assert the role-landing map entry).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  - `run-session-stub.page.component.ts` — a minimal standalone page (`selector:'lib-kf-run-session-stub'`): reads `:eventId` from the route, loads via `store.events()` (+ `loadEvents()` fallback) and `store.templates()`, shows the date/template-name header + a "Run session lands in slice 7" notice + a back-to-calendar link (absolute array). Keeps the event-detail "Run session" button routable now.
  - `routes.ts` — add under the shell wrapper (literal before `:id`): `{ path: 'calendar', loadComponent: () => import('./calendar/calendar-page.component.js').then(m => m.CalendarPageComponent) }` and `{ path: 'run/:eventId', loadComponent: () => import('./run/run-session-stub.page.component.js').then(m => m.RunSessionStubPageComponent) }`.
  - `kf-shell.component.ts` — add the predicate + nav link + the teamManager landing:

```ts
  /**
   * Roles that can see the Calendar nav link: coach + assistant coach + team
   * manager. team manager's Calendar is READ-ONLY (no Schedule/Match/Run — see
   * the events permission grant) but it IS team manager's first (and, until
   * slice 8's Team view, only) nav surface, so it lands here on sign-in.
   * Deliberately EXCLUDES club-admin (Club tabs). (design §2.3)
   */
  protected readonly canSeeCalendar = computed(() =>
    ['coach', 'assistant-coach', 'team-manager'].includes(this.session()?.role ?? ''),
  );
```

   Render the link after Templates / before Club (`@if (canSeeCalendar()) { <a … [routerLink]="link('calendar')" data-testid="kf-nav-calendar">{{ msg.navCalendar }}</a> }`). In the role-landing map (the post-sign-in redirect — find where coach→drills is set), add `team-manager → 'calendar'` (and coach/assistant-coach already land on drills; leave them).
  - `kf-i18n.ts` — add `'kf.shell.nav.calendar': 'Calendar'` + all the calendar/modal keys Tasks B11–B14 need (add them in this one pass; see those tasks for the key list).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/run/run-session-stub.page.component.ts libs/pack-kids-football-ui/src/lib/run/run-session-stub.page.component.spec.ts libs/pack-kids-football-ui/src/lib/routes.ts libs/pack-kids-football-ui/src/lib/shell/kf-shell.component.ts libs/pack-kids-football-ui/src/lib/shell/kf-shell.component.spec.ts libs/pack-kids-football-ui/src/lib/kf-i18n.ts` then `git commit -m "feat(exercir): kids-football S6 — calendar + run/:eventId routes + canSeeCalendar nav + teamManager landing"`.

## Task B11: Calendar week-grid + upcoming rail + pure geometry helpers

**Files:**
- Create: `lib/calendar/kf-calendar-geometry.ts` (+ spec), `lib/calendar/calendar-week-grid.component.ts` (+ spec), `lib/calendar/upcoming-rail.component.ts` (+ spec)

- [ ] **Step 1: Write the failing specs.**
  - `kf-calendar-geometry.spec.ts`: `hourRange([{start:17,end:18.5}], [])` → `{hs:16, he:20, span:4}` (clamps to 16–20 default); a slot at 7:00 expands `hs` to 7; a match ending 21.5 expands `he` to 22; `topPct(17, 16, 4)` → 25; `heightPct(17,18.5,4)` → 37.5.
  - `calendar-week-grid.component.spec.ts` (inputs: `events`, `slots`, `templates`, `drills`, `weekStart`, `today`, `readOnly`): renders 7 day columns + the hour gutter; a future unbooked slot renders a ghost button (`data-testid="kf-cal-ghost-<slotId>"`) with "+ Assign" (hidden when `readOnly`); a training event renders ink with the template name + "· ✓" when `run.completed`; a match renders white with "MATCH" + opponent; today's column has the tint class; clicking a ghost emits `assign({slotId, date})`; clicking a training event emits `openEvent(id)`; clicking a match emits `openMatch(id)`.
  - `upcoming-rail.component.spec.ts`: renders the next ≤6 future events sorted by date with Today/✓ Done/Match badges; empty-state when none; emits the same open events on click.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**
  - `kf-calendar-geometry.ts` — pure helpers (mirror the prototype's `hs`/`he`/`span` math):

```ts
export interface HourRange { hs: number; he: number; span: number; }
export function hourRange(slotTimes: ReadonlyArray<{ start: number; end: number }>, matchTimes: ReadonlyArray<{ start: number; end: number }>): HourRange {
  const pts = [...slotTimes, ...matchTimes].flatMap((t) => [t.start, t.end]);
  const hs = pts.length ? Math.min(16, Math.floor(Math.min(...pts))) : 16;
  const he = pts.length ? Math.max(20, Math.ceil(Math.max(...pts))) : 20;
  return { hs, he, span: he - hs };
}
export const topPct = (h: number, hs: number, span: number) => ((h - hs) / span) * 100;
export const heightPct = (start: number, end: number, span: number) => ((end - start) / span) * 100;
```

  - `calendar-week-grid.component.ts` (`selector:'lib-kf-calendar-week-grid'`, OnPush, `styleUrls:['../club-grass.css']` + a small component style UNDER 8kB — trim aggressively): inputs `events`/`slots`/`templates`/`drills`/`weekStart: Date`/`today: Date`/`readOnly: boolean`; outputs `assign = output<{slotId; date}>()`, `openEvent = output<string>()`, `openMatch = output<string>()`. Derive: `days = computed(() => Array.from({length:7}, (_,i) => addDays(weekStart, i)))`; `range = computed(() => hourRange(slots-as-times, matches-as-times))`; per-day ghosts (`slots` where future + unbooked) + events (training ink / match white) absolutely positioned via `topPct`/`heightPct`. Reuse `KF_PHASE_COLORS` for the training phase mini-bar, `kf-slot-time` for the time string, `resolveTenantFromRoute` is NOT needed (the page handles nav). Build the slot view-model (resource name + time) by looking slots up against `slots` input (the page passes resources-resolved slots, or pass `resources` too — keep the grid input-driven, no store injection).
  - `upcoming-rail.component.ts` (`selector:'lib-kf-upcoming-rail'`, OnPush): input `events`/`slots`/`templates`/`today`; output `openEvent`/`openMatch`. `upcoming = computed(() => events.filter(e => e.date >= isoDate(today)).sort(byDate).slice(0,6))`. Today / ✓ Done / Match badges.
  - i18n keys (added in B10's pass): `kf.calendar.open`, `kf.calendar.oneOff`, `kf.calendar.assign`, `kf.calendar.match`, `kf.calendar.vs` (subst {opponent}), `kf.calendar.upcoming`, `kf.calendar.upcomingEmpty`, `kf.calendar.today`, `kf.calendar.done`.
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx test pack-kids-football-ui`.
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/calendar/kf-calendar-geometry.ts libs/pack-kids-football-ui/src/lib/calendar/kf-calendar-geometry.spec.ts libs/pack-kids-football-ui/src/lib/calendar/calendar-week-grid.component.ts libs/pack-kids-football-ui/src/lib/calendar/calendar-week-grid.component.spec.ts libs/pack-kids-football-ui/src/lib/calendar/upcoming-rail.component.ts libs/pack-kids-football-ui/src/lib/calendar/upcoming-rail.component.spec.ts` then `git commit -m "feat(exercir): kids-football S6 — calendar week-grid + upcoming rail + geometry helpers"`.

## Task B12: Schedule-training modal

**Files:**
- Create: `lib/calendar/schedule-training-modal.component.ts` (+ spec)

- [ ] **Step 1: Write the failing spec** (inputs `templates`/`slots`/`drills`/`events`/`prefill:{templateId?,slotId?,date?}`/`today`; output `create = output<{templateId, slotId, date}>()` + `close`): renders a radio-style card per template (phase bar via `summarizeTemplateBudget` + drill-phase lookup); renders a radio per slot with its length, showing "{n} min — too short" (`#B3402E`) when the selected template total > slot minutes; renders the next-4-occurrence date chips with taken dates struck (an event already on that `(slotId,date)`); a `prefill.slotId` preselects that slot + first free date; the summary line reads "Creates: {name} · {dayLabel} · {time} · {pitch}" and shows "— plan is {n} min over this slot" when over-length; **Create is disabled only when no template / no slot / no date / the chosen date is taken** — over-length does NOT disable it (D-6); clicking Create emits `{templateId, slotId, date}`; backdrop/✕ emits close. Enabled-submit + focus management via `kf-modal-focus`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `schedule-training-modal.component.ts` (`selector:'lib-kf-schedule-training-modal'`, OnPush, modal scaffolding mirroring the slot modal's focus trap). Signals: `tplId`/`slotId`/`date`; `slotMin = computed(() => round((slot.end-slot.start)*60))`; `total = computed(() => Σ template.items.min)`; `fits = computed(() => total() <= slotMin())`; `occ = computed(() => nextOccurrences(slot, 4, today))`; `taken(d)` checks `events`. Reuse `kf-slot-time`, `KF_PHASE_COLORS`, `summarizeTemplateBudget`, `kf-modal-focus`. i18n keys: `kf.schedule.title`, `kf.schedule.stepTemplate`, `kf.schedule.stepSlot`, `kf.schedule.stepDate`, `kf.schedule.tooShort` (subst), `kf.schedule.taken`, `kf.schedule.summary` (subst), `kf.schedule.over` (subst {n}), `kf.schedule.create`, `kf.schedule.cancel`, `kf.schedule.noTemplates`, `kf.schedule.noSlots`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/calendar/schedule-training-modal.component.ts libs/pack-kids-football-ui/src/lib/calendar/schedule-training-modal.component.spec.ts` then `git commit -m "feat(exercir): kids-football S6 — schedule-training modal (template→slot→date, length-validated)"`.

## Task B13: Match modal + event-detail modal

**Files:**
- Create: `lib/calendar/match-modal.component.ts` (+ spec), `lib/calendar/event-detail-modal.component.ts` (+ spec)

- [ ] **Step 1: Write the failing specs.**
  - `match-modal.component.spec.ts` (input `match?` for edit; outputs `save = output<MatchDetail & {date}>()`, `remove`, `close`): renders opponent / date / kick-off+until selects (30-min steps) / Home-Away chips / note; Save disabled when opponent empty OR `end <= start`; editing preselects; Save emits the payload; Remove (edit only) emits remove.
  - `event-detail-modal.component.spec.ts` (inputs `event`/`slots`/`templates`/`drills`/`readOnly`; outputs `remove`, `run`, `close`): meta kicker (day · time · pitch), template name (or "Training" fallback), ✓ Done badge when `run.completed`, phase bar, numbered drill list; Remove + Run buttons hidden when `readOnly`; the Run button label = "Run session" / "Resume session" (`run.startedAt` && !completed) / "Session report" (`run.completed`); Run emits `run(event.id)`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** both (mirror the prototype `MatchModal` + `EventDetailModal`; modal scaffolding + `kf-modal-focus`). Match `times` array `8..21.5 step 0.5`; `fmtH` time formatter (reuse the slot one). Detail looks up `tpl`/`slot`/`drills` from inputs; the Run-button label logic from `event.run`. i18n keys: match — `kf.match.titleAdd`/`kf.match.titleEdit`, `kf.match.opponent`, `kf.match.date`, `kf.match.kickoff`, `kf.match.until`, `kf.match.venue`, `kf.match.home`, `kf.match.away`, `kf.match.note`, `kf.match.add`, `kf.match.save`, `kf.match.remove`, `kf.match.cancel`; detail — `kf.eventDetail.done`, `kf.eventDetail.remove`, `kf.eventDetail.close`, `kf.eventDetail.run`, `kf.eventDetail.resume`, `kf.eventDetail.report`, `kf.eventDetail.training`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/calendar/match-modal.component.ts libs/pack-kids-football-ui/src/lib/calendar/match-modal.component.spec.ts libs/pack-kids-football-ui/src/lib/calendar/event-detail-modal.component.ts libs/pack-kids-football-ui/src/lib/calendar/event-detail-modal.component.spec.ts` then `git commit -m "feat(exercir): kids-football S6 — match modal + event-detail modal"`.

## Task B14: Calendar page (header + grid + rail + modal orchestration)

**Files:**
- Create: `lib/calendar/calendar-page.component.ts` (+ spec)

- [ ] **Step 1: Write the failing spec** (`calendar-page.component.spec.ts`, pre-populated store stub for unit cases): `ngOnInit` calls `loadEvents()` + `loadTemplates()` + `loadDrills()` + `loadSlots()` (the initial-load lesson — all four needed for the grid); the header renders the week label + ‹ Today › nav (offset signal) + "+ Match" + "Schedule training" buttons, both HIDDEN for a read-only (teamManager) session; clicking "Schedule training" opens the schedule modal; the grid's `assign` event opens the schedule modal prefilled; the grid's `openEvent` opens the detail modal; `openMatch` opens the match modal; creating from the schedule modal calls `client.createEvent` → `loadEvents()`; the detail modal's `run` navigates to `run/:eventId`; team switcher re-scopes the events shown (filter by active team).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `calendar-page.component.ts` (`selector:'lib-kf-calendar-page'`, OnPush, `styleUrls:['../club-grass.css']`). Inject `KfClubStore`, `KidsFootballApiClient`, `Router`, `ActivatedRoute`. `offset = signal(0)`; `today = signal(new Date())` (the ONLY `new Date()` — the page owns "now"; pass it down to the pure helpers so children stay testable); `weekStart = computed(() => addDays(startOfWeek(today()), offset()*7))`; `readOnly = computed(() => this.store.session()?.role === 'team-manager')`; `activeTeamEvents = computed(() => store.events().filter(e => e.teamId === activeTeamId()))`. Compose `<lib-kf-calendar-week-grid>` + `<lib-kf-upcoming-rail>` + the three modals (component-local `scheduleOpen`/`matchModal`/`detailId` signals). Resolve slot view-models (resource name) by joining `store.slots()` + `store.resources()`. `ngOnInit`: load the four collections. Create/update/delete handlers call the client then `loadEvents()`; the detail `run` → `router.navigate(['/t', tenant, 'p','kids-football','run', id])`. i18n keys: `kf.calendar.title` (week label is computed, not i18n), `kf.calendar.today`, `kf.calendar.prev`, `kf.calendar.next`, `kf.calendar.addMatch`, `kf.calendar.schedule`.
- [ ] **Step 4: Run → PASS** — `NX_DAEMON=false npx nx test pack-kids-football-ui`, then `NX_DAEMON=false npx nx run-many -t lint --projects=pack-kids-football-ui`.
- [ ] **Step 5: Commit** — `git add libs/pack-kids-football-ui/src/lib/calendar/calendar-page.component.ts libs/pack-kids-football-ui/src/lib/calendar/calendar-page.component.spec.ts` then `git commit -m "feat(exercir): kids-football S6 — calendar page (week grid + rail + schedule/match/detail orchestration)"`.

## Task B15: Slice gate, browser run-through, story issue, PR, verifier wave, ritual

- [ ] **Step 1: Full local gate.** From `../exercir-wt-kf-s6`: `npm run ci:local > /tmp/s6-ci.log 2>&1; echo "EXIT=$?"` (NO masking pipe — READ the log; watch the per-component CSS budget on the grid + schedule modal) and `npm run test:db > /tmp/s6-db.log 2>&1; echo "EXIT=$?"` with Postgres up (the new `event` live-RLS proof + the persisted-audit `kernel.audit_event` proof from Task B8).
- [ ] **Step 2: Browser run-through** (kill any orphan `:3150`/`:4200` first; serve the worktree api `PORT=3150` + the visual-editor host on `:4200` via `&`-detached commands redirected to a log — never pipe a serve through `head`; wait via a `run_in_background` until-loop on `localhost:4200|bundle generation complete` OR `Failed to compile|EADDRINUSE`). As a coach: open `/calendar` → empty week; "Schedule training" → pick a template + slot + date → Create → the training event appears on the grid + rail; push the template over the slot length → confirm the "{n} min over" warning but Create still works; "+ Match" → add a match → it appears white with "MATCH"; open the training event detail → see the phase bar + drill list + the "Run session" button; go to `/templates`, try to delete the scheduled template → blocked (409 "scheduled on the calendar"). Sign in as the **team manager** → lands on `/calendar`, sees events read-only (no Schedule/Match buttons). Screenshot to `de-braighter/docs/club-grass-calendar-s6-proof.png`.
- [ ] **Step 3: Story issue + PR.** Open the exercir story issue (`type/story`, slice 6) + the PR BEFORE the wave. PR body: the conventional summary + the twin lines:
  - `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`
  - `Effort: deep` (designer-first substrate artifact + full wave + cross-layer)
  - `Effect: cycle-time 0.02±0.03 expert` and `Effect: findings 9±5 expert` (self-observing cross-repo indicators only).
  - State the decisions: D-2 (template-in-use guard, no cascade), D-3 (teamManager grants + landing), D-4 (persisted F1 audit — #245 closed for the event vertical), D-6 (slot-taken enforced / over-length warned), D-7 (subjectSensitivity unset). Link the substrate `2.1.1` PR (Part A).
- [ ] **Step 4: Verifier wave** (review floor: non-trivial → full wave). Spawn in parallel, all `isolation:"worktree"`, read-only, git-writes + main-clone access forbidden: `reviewer` + `charter-checker` + `exercir-charter-checker` + `qa-engineer` (`local-ci` dimension already run in Step 1). Wave prompt notes: subjectSensitivity stays unset by design (D-7); the template-in-use guard's read-then-delete non-atomicity is the sanctioned slice-2 posture (D-2); F1 audit is now WIRED + persisted (D-4, closes #245 for events) — the in-memory adapter in dev/test is the substrate default, PG persistence is proven in `test:db`; the nav/grant asymmetry (teamManager holds read perms without nav) is a founder decision (D-3).
- [ ] **Step 5: Post-findings → fix → merge → twin ritual.** Write the wave findings to a temp JSON (`[{verifier, severity, path?, line?, text}]`, severity ∈ `blocking|should-fix|nit|note`) and `npx tsx src/cli.ts post-findings de-braighter/exercir#NN findings.json` (from `domains/devloop`) BEFORE merge. Fix any blocking/should-fix in the worktree (re-run the gate). Merge (squash). Then the **mandatory twin ritual**: `drain exercir#NN` → `backfill de-braighter/exercir` → `reconcile exercir#NN` → `reviews de-braighter/exercir` → `resolve-findings de-braighter/exercir`. Update the `exercir-kids-football-mvp-arc` memory (slice 6 SHIPPED + new gotchas; RESUME → slice 7) and close exercir#245 (event vertical) with a note that the pattern rolls out to the other verticals on demand. Remove the worktree (`git worktree remove ../exercir-wt-kf-s6`) after verifying the PR LANDED.

---

## Self-Review

**1. Spec coverage** — every spec section maps to a task: Part A artifact §4 → A1/A2; dep+adopt §5 (intro) → B0; permissions+roles+auditSubtypes §5.1 → B1; contracts+date-helpers §5.1 → B2; migration+RLS §5.2 → B3; repository+guards §5.3 → B4; use-cases+slot-taken §5.4 → B5; persisted audit §5.5 → B6; template-in-use guard + seams §2.2/§6 → B7; controller+e2e+test:db §5.6/§7 → B8; client+store §5.7 → B9; routes+nav+landing+stub §5.7 → B10; week-grid+rail §5.7 → B11; schedule modal §5.7 → B12; match+detail modals §5.7 → B13; calendar page §5.7 → B14; gate/run-through/ritual §7 → B15. The §8 out-of-scope items (run-session, team/player view, F1 for other verticals, drag-drop, recurring series) are explicitly deferred, not built.

**2. Placeholder scan** — no TBD/TODO; every code step shows real code or a precise mirror-this-file instruction with the exemplar named. The one judgement call (the zod `.refine()` + `.omit()` composition in B2) is flagged with a fallback.

**3. Type consistency** — `EventRepository` methods (`list`/`findById`/`create`/`update`/`delete`/`existsForTemplate`/`existsForSlot`) used identically in B4 (port), B5 (use-cases), B7 (guard via `eventRepo.existsForTemplate`); `ExercirEvent`/`CreateEventInput`/`UpdateEventPatch` defined B2/B4, consumed B5/B6/B9; `emitAuditEvent(registry, service, {packKey, subtype, eventType, action, agent, entity, …})` signature matches the substrate contract (verified against `RecordAuditEventInput` + `emit-audit-event.d.ts`); `auditSubtypes` keys (`event.created/updated/deleted`) defined B1, asserted B1 + emitted B6; `eventRead`/`eventWrite` defined B1, used B8 (`@RequiresPermission`); `canSeeCalendar()` defined B10, no collision with `canSeeTemplates()`/`canSeeDrills()`; the calendar geometry helpers (`hourRange`/`topPct`/`heightPct`) defined B11, consumed in the grid (B11) + the page passes `today`/`weekStart` (B14); `nextOccurrences(slot, count, today)` defined B2, consumed B12. Consistent.

**4. Cross-layer ordering** — Part A (A1→A2 incl. publish) MUST complete before B0's dep bump + B6/B8's audit-persistence tests; the in-memory audit adapter keeps B1–B5 + B7 + all UI tasks green independent of the publish (only B6's PG-persistence assertion + B8's `test:db` audit proof are publish-gated). Flagged in B0 + the header.
