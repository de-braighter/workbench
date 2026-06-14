# Exercir kids-football MVP — Slice 6 (calendar + scheduling, + persisted F1 audit) design

> **Status:** approved (brainstorming) 2026-06-14. Slice 6 of the Club Grass kids-football MVP — the **calendar + scheduling** surface (week grid, open-slot ghosts, schedule/match/event-detail modals) on a new `kids_football.event` pack table, **plus** wiring the pack's event mutations to the kernel's **persisted** audit trail (F1 / exercir#245).
> **Repo(s):** cross-layer. **Part A** = `layers/substrate` (publish a `sql/kernel-audit.sql` artifact, `2.1.1`). **Part B** = `domains/exercir` (adopt it + the calendar vertical + persisted F1 audit). **Substrate:** consumes published `@de-braighter/substrate-{contracts,runtime}@^2.1.1`.
> **Related:** `2026-06-11-exercir-kids-football-mvp-design.md` (the MVP; §8 row 6 is this slice, §4 the data model, §5 the expected-effect seam) · `2026-06-13-exercir-kids-football-s5-templates-design.md` (the template vertical + the cascade seam this cashes) · handoff `domains/exercir/docs/design/exercir-mvp-handoff/README.md` screen 6 + prototype `exercir/proto/calendar.jsx` · ADR-206 (vendored-kernel-tables / published-SQL-artifact posture) · ADR-061/062 (kernel audit) · exercir#245 (F1 event-log writes for pack CRUD).

## 1. Goal

A coach (or assistant coach) schedules a **training template onto a club slot** to create a calendar **event**, and adds **matches** to the calendar. The week grid recreates the handoff prototype faithfully: an auto-expanding hour range, today-tinted column, **open-slot ghosts** (future, unbooked → "+ Assign" → prefilled schedule modal), **training events** (ink, accent time/pitch + " · ✓" when run-completed, template name, phase mini-bar), **match events** (white, ink border, cone-orange "MATCH", vs opponent, Home/Away), and a right-rail "Upcoming sessions". Scheduling is conflict-style **guarded but never silently destructive**: one event per slot per date (enforced), over-length plans **warned but allowed** (slice-2 posture). A **Team manager** sees the calendar **read-only**. The event detail modal's "Run session" button is the slice-7 entry point (label flips Resume / Session report).

Slice 6 also **wires the pack's event mutations to the kernel's persisted audit trail** (founder decision, all-in-one): every event create/update/delete emits an `AuditEvent` through the substrate `AuditService`, persisted to `kernel.audit_event` in Postgres (not the in-memory default). This is the first concrete closure of exercir#245's "F1 event-log writes for pack CRUD" — for the event vertical — and establishes the reusable pattern (published SQL artifact + `forRoot` adapter wiring + `emitAuditEvent`) that #245 rolls out to the other verticals later.

The kernel is used as the tenant/auth/RLS **and now audit** substrate — still **no kernel domain concepts** (no plan-tree, no effect-declaration, no inference). The audit trail is kernel concern #2 ("flatten the observation"), consumed via a published port — pack-on-platform, not a kernel leak.

## 2. Decisions (2026-06-14 brainstorming)

1. **Event discriminator = a structured `kind` enum column** (`'training' | 'match'`), alongside structured `teamId` + `date`; everything else is JSONB (design §4). The calendar filters matches by `kind`; conflict/queryable fields stay columns. (Founder choice over deriving `kind` from JSONB presence.)
2. **Template delete is GUARDED, not cascaded** (founder choice: "don't let used templates be deleted"). `DeleteTemplateService` refuses to delete a template referenced by **any** event → `Result.err('template-in-use')` (HTTP 409). The coach removes the events first. No destructive cascade, no orphaned events, no session-history loss. The slice-5 **drill → template-item strip** cascade is unchanged; drill → event is indirect (through the template). Both delete services' seam comments are re-pinned.
3. **Team manager read access = grant `templateRead` + `drillRead`** (read-only; no Templates/Drills nav), so the read-only calendar live-looks-up template names, phase bars, and the detail drill list at full prototype fidelity. Matches the clubAdmin-holds-perm-without-nav precedent (slice 5). Single source of truth; the `"Training"` fallback covers the (now-impossible-to-create via delete, but defensively retained) orphan case.
4. **F1 audit = persisted to Postgres, all-in-one this slice** (founder choice). The pack emits validated audit events via `emitAuditEvent(...)` through the real substrate `AuditService`, persisted by `PrismaAuditEventRepository` to `kernel.audit_event`. Requires Part A (the published `sql/kernel-audit.sql` artifact) because kernel tables are substrate-owned and provisioned via the ADR-206 published-artifact path — exercir must **not** author kernel DDL itself.
5. **Substrate audit artifact ships as `2.1.1` from `main`** — a surgical, additive patch (a new `sql/` file + a parity spec; **no code/API change**). This deliberately avoids the `2.2.0` slot already claimed by the unmerged `b3-mixture-cure-family` (oncology) branch — `2.1.1 < 2.2.0`, so the oncology release line is undisturbed.
6. **Subject-sensitivity boundary holds.** Slice 6 surfaces **no inferred player state** — the calendar schedules and shows facts only (attendance + run are slice-7 facts, and even those are facts, not inference). `PackManifest.subjectSensitivity` stays **unset**. The pinned trigger (re-stated for slices 7/8): the moment a slice surfaces *inferred player state*, set `subjectSensitivity: 'developmental-minor'` in that same red→green pass so the ADR-187/188/189 gates engage.

## 3. Data model

```
Event   { id, teamId, date: ISO 'YYYY-MM-DD', kind: 'training' | 'match',
          training?: { templateId, slotId },                         // kind === 'training'
          match?:    { opponent, homeAway: 'Home'|'Away', start, end: float-hours, note },  // kind === 'match'
          attendance: { [memberId]: 'present'|'absent'|'sick'|'holiday'|'school' },  // slice 7 populates; {} now
          run?: { startedAt, drillStartedAt, idx, completed, finishedAt,
                  log: [{ drillId, plannedMin, actualSec, skipped }], ratings: { [drillId]: 'yes'|'no' } } }  // slice 7
```

- **Structured columns** (queryable / conflict-relevant): `id`, `tenant_pack_id`, `team_id`, `date`, `kind`, `created_at`, `updated_at`.
- **JSONB columns:** `training`, `match`, `attendance` (default `'{}'`), `run` (nullable). The `attendance`/`run` columns exist now but stay empty/`null` until slice 7 — declared now so slice 7 needs no migration.
- **Validation:** a `kind:'training'` event requires `training` (and no `match`); a `kind:'match'` event requires `match` (and no `training`). `match.end > match.start`. `date` is a strict ISO date. Enforced at the schema (a Zod discriminated-union-ish refinement) **and** the use-case.
- **Derived (never stored, ADR-176):** the week grid's hour range, ghosts, phase bars, budgets, `slotMin` length validation, and the calendar's per-day layout are all **looked up by id** from slots/templates/drills at render time — never copied onto the event row. The one snapshot we deliberately avoid: the template name is **not** denormalized (decision 3 grants the read role the perms to live-look-it-up).

## 4. Part A — substrate `sql/kernel-audit.sql` artifact (`2.1.1`)

**Why:** `PrismaAuditEventRepository.appendEvent` writes via raw SQL to `kernel.audit_event` (+ chain/anchor for higher tiers + the F1 `kernel.event_log` row + `kernel.outbox` row). exercir already provisions `kernel.event_log` + `outbox` via the published `sql/kernel-event-log.sql` (ADR-206), but **no `sql/kernel-audit.sql` is published** — only the authoritative Prisma migrations exist in the substrate source (`20260528122322_kernel_audit` + `…auditor_select_policy` + `…grant_schema_usage_to_app_auditor` + `…audit_tenant_pack_id_to_uuid` + `20260613090000_kernel_audit_worm_triggers`). A pack cannot adopt the audit tables without this artifact.

**What ships (substrate `main` → branch → PR → wave → publish `2.1.1`):**
- **`libs/substrate-runtime/sql/kernel-audit.sql`** — a **consolidated, idempotent projection** of the authoritative audit migrations (same authoring pattern + header as `kernel-event-log.sql`): `CREATE TABLE IF NOT EXISTS kernel.audit_event`, `audit_event_chain`, `audit_chain_anchor`, `audit_legal_hold`; their indexes; **RLS** (ENABLE+FORCE + tenant-isolation policies); the `app` + `app_auditor` **GRANTs** (append-only for the writer); and the **WORM BEFORE-UPDATE/DELETE triggers** (substrate#137 / #171). Applied **after** `app-roles.sql`, against the admin URL — exactly like the other artifacts.
- **A parity spec** (`sql/kernel-audit.artifact.spec.ts` or extend the existing artifact-parity test) proving the idempotent artifact projects the authoritative migration set (no table/column/policy drift) — the same safety net the event-log artifact carries.
- **Version bump → `2.1.1`** on both `substrate-contracts` + `substrate-runtime` (lock-step); CHANGELOG entry ("publish `sql/kernel-audit.sql` for downstream audit-table provisioning; no code change"). `files: ["sql", …]` already ships the `sql/` dir — the new file is included automatically.
- **Publish** `2.1.1` to GitHub Packages via `npm run publish:contracts` + `npm run publish:runtime` (the `guard-version.mjs` gate + `.npmrc` token). *Precondition:* a `GITHUB_TOKEN` with `write:packages`. If this environment's token is read-only, the founder runs the two publish commands (surfaced at build time).

**Governance:** this is **designer-first / kernel-shaped** — publishing the kernel's most safety-critical append-only DDL. `substrate-architect` blesses the artifact's faithful projection (incl. RLS + WORM + grants); `substrate-coder-pro` authors it + the parity spec. Its own verifier wave runs in `layers/substrate`.

## 5. Part B — exercir calendar vertical + persisted F1 audit

### 5.1 Contracts (`pack-kids-football-contracts`)
New `events.ts`, exported from `src/index.ts`:
- `EVENT_KINDS = ['training','match'] as const`; `MEMBER_ATTENDANCE = ['present','absent','sick','holiday','school'] as const`.
- `TrainingDetailSchema = z.object({ templateId, slotId })`; `MatchDetailSchema = z.object({ opponent: min(1).max(80), homeAway: z.enum(['Home','Away']), start, end: z.number(), note: max(200) }).refine(end>start)`.
- `EventSchema` with structured `id/teamId/date/kind` + optional `training`/`match` + `attendance` record + optional `run`, refined so the present detail matches `kind`. `CreateEventInputSchema = EventSchema.omit({ id:true })` (+ a `CreateTrainingInput`/`CreateMatchInput` ergonomic split if it reads cleaner). `RunSchema` is defined now (shape pinned) but only **read** this slice.
- **Reuse** the slice-2 `kf-slot-time` helpers + `slot-conflicts` time math for slot-length validation and the "next 4 occurrences" date computation (port the prototype's `pNextOccurrences`/`pIso`/`pFmt`/`pStartOfWeek` as **pure, tested** contracts functions — `kf-calendar-dates.ts` — so both API and UI share them; **clock-injectable** `now` per the time-coupled-tests lesson, never hardcoded calendar dates).

**Permissions** — two sites:
- `roles.ts`: append `eventRead`/`eventWrite` to `KF_PERMISSIONS` (order matters — the manifest spec asserts `Object.values` order).
- `pack-manifest.ts` `roles[]` (the role→permission grants): add `eventRead`/`eventWrite` to `coach` + `assistantCoach`; add `eventRead` + `templateRead` + `drillRead` to `teamManager` (currently `[memberRead, teamRead, slotRead]`) — decision 3, its read-only calendar fidelity. `facilities` unchanged (no event perms). `clubAdmin` holds all via `Object.values`. The manifest spec's role-permission assertions updated in the same red→green pass.

### 5.2 Migration (`prisma/packs/kids-football.prisma` + a new migration)
New `Event` model + `kids_football.event` table mirroring the slice-5 template migration **exactly**: `id UUID PK`, `tenant_pack_id UUID`, `team_id UUID`, `date TEXT` (ISO `YYYY-MM-DD`, matching the slot table's `date TEXT` column; lexically sortable so the `[tenantPackId, date]` index serves the week-window range query), `kind TEXT`, `training JSONB`, `match JSONB`, `attendance JSONB NOT NULL DEFAULT '{}'`, `run JSONB`, `created_at`, `updated_at`. Indexes: `@@index([tenantPackId])` + `@@index([tenantPackId, date])` (week-window query). **RLS:** ENABLE+FORCE; `USING` isolation on `current_setting('app.tenant_pack_id', true)::text`; `FOR INSERT WITH CHECK`; explicit `FOR UPDATE` USING+WITH CHECK (in-place update path — attendance/run mutations in slice 7); guarded `DO` block granting `SELECT/INSERT/UPDATE/DELETE` to the `app` role. Proven LIVE under `NOBYPASSRLS` in `rls.integration.spec.ts` (cross-tenant count-0 on list/update/delete) + the slice-5 reviewer's deferred **cross-tenant cascade-isolation** assertion folded in if natural.

### 5.3 Repository (`pack-kids-football` out-ports/out-adapters)
- `EVENT_REPOSITORY` out-port: `list()`, `findById(id)`, `create(input)`, `update(id, patch)`, `delete(id)`, **+ `existsForTemplate(templateId): Promise<boolean>`** (the delete-guard primitive — any active-tenant event referencing the template), **+ `existsForSlot(slotId, date): Promise<boolean>`** (the one-event-per-slot-per-date guard). `training`/`match`/`attendance`/`run` are JSONB round-trips.
- Two impls (`InMemoryEventRepository` + `PrismaEventRepository`) against **one** `event.repository.contract.ts` suite (mirrors `template.repository.contract.ts`): CRUD; cross-tenant count-0 on update/delete; JSONB round-trip on all four JSON columns; mutation isolation; `existsForTemplate` / `existsForSlot` (true/false + cross-tenant invisibility). The `PrismaEventRepository` uses the shared `prisma-guc.ts` GUC helper.
- **`TenantScopedClient` gains an `event` delegate** → the budgeted fan-out: update `stub-delegates.ts` + **every** sibling Prisma `*.repository.contract.spec.ts` (a missed one is a TS2741 the normal gate misses — the spec-reviewer must verify; budget for it).

### 5.4 Use-cases (`Result<T,E>`, mirror the template quartet — `List`/`Create`/`Update`/`Delete`, **no `Get`**)
- `ListEvents`, `CreateEvent`, `UpdateEvent`, `DeleteEvent`. The calendar loads events via the store; the detail/run loads via the store (`store.events().find(id)` → `loadEvents()` fallback) — so **no `GetEvent` use-case / `GET :id` endpoint** (`findById` is the internal primitive update/delete use).
- **Guards:** `CreateEvent` rejects a duplicate `(slotId, date)` for training (`event-slot-taken` → 409) via `existsForSlot`; over-length plans are **not** rejected (warned in the UI only). `kind`/detail consistency validated; not-found → `event-not-found`.
- **Cascade guard wiring:** `DeleteTemplateService` gains an `EVENT_REPOSITORY` dep → calls `existsForTemplate(templateId)` **before** the delete; if true → `Result.err('template-in-use')`. Non-atomic read-then-delete is acceptable + pinned (slice-2 cascade convention). `DeleteDrillService` keeps its slice-5 `removeDrillReferences` call; both seam comments re-pinned (drill→event is indirect through the template; template→event is now a guard).

### 5.5 Persisted F1 audit wiring (the #245 closure, event vertical)
- **Manifest** (`pack-manifest.ts`): add `auditSubtypes: [{ key:'event.created', displayName:'Calendar event created' }, { key:'event.updated', displayName:'Calendar event updated' }, { key:'event.deleted', displayName:'Calendar event deleted' }]`. (ADR-176 inclusion-test clause (b): the kernel-side `AuditSubtypeRegistry` validates it — constitutionally a typed-core extension, not a leak.) Manifest spec updated.
- **Composition root** (`app.module.ts`): import `AuditSubtypeRegistryModule.forRoot({ manifests: [PACK_KIDS_FOOTBALL_MANIFEST] })` (provides + bootstraps the registry from the manifest's `auditSubtypes`). In **DB mode** (`PACK_KIDS_FOOTBALL_DB=true`), pass `auditEventRepository: new PrismaAuditEventRepository(appRoleClient)` to `SubstrateModule.forRoot` so audit persists to `kernel.audit_event`. In in-memory mode (default dev/test), the substrate default (`InMemoryAuditEventRepository`) is used — the **same emit calls**, swappable adapter.
- **Emit** (the 3 event use-cases): inject `AuditService` + `AuditSubtypeRegistry`; on a **successful** mutation call `emitAuditEvent(registry, service, { packKey:'pack-kids-football', subtype:'event.created'|'updated'|'deleted', eventType:'kids-football.event.<verb>', action:'C'|'U'|'D', outcome:'success', tenantPackId: ctx.tenantPackId, agent:[{ role:'actor', userId: ctx.userId }], entity:[{ role:'target', what:'kids_football.event', linkedDomainRecordRef: eventId }], retentionTier:'operational', occurredAt: now })`. The actor `userId` + `tenantPackId` come from the existing request seam (`TenantPackContext`, which carries `userId`). A failed mutation emits nothing (the audit reflects the actual outcome).
- **db:setup:core** (`package.json`): append `prisma db execute --file node_modules/@de-braighter/substrate-runtime/sql/kernel-audit.sql --schema ./prisma` after the `kernel-event-log.sql` line. `tools/db/test-db.mjs` applies it so `test:db` provisions the audit tables.
- **Tests:** unit/integration proving each event mutation emits exactly one audit event with the right subtype/action/entity (in-memory `AuditService.query`); a `test:db` proof that a real event create lands a row in `kernel.audit_event` scoped to the tenant (and is cross-tenant invisible). Doc-comment posture flips from "deferred (#245)" to "wired (#245 event vertical); other verticals follow the same pattern."

### 5.6 API (`pack-kids-football-api`)
- `events.controller.ts` (mirrors `templates.controller.ts`): `GET` list, `POST`, `PATCH :id`, `DELETE :id` with `@RequiresPermission(eventRead/eventWrite)` (no `GET :id`). Match create/edit/delete go through the same endpoints (`kind:'match'`). e2e: the 403 matrix (**teamManager denied write/match/run**, `eventRead` allowed; facilities denied all), cross-club invisibility, the slot-taken 409, the template-in-use 409, and the audit-emitted assertion (or that's at the use-case level).
- **No stub-club event seed** — an empty calendar is the honest first-run; the browser run-through schedules one to exercise the flow. (Consistent with slice-5's no-template-seed decision.)

### 5.7 UI (`pack-kids-football-ui`)
- **Routes** under the shell (literal before `:id`): `calendar` (the week + rail screen) and `run/:eventId` (a **slice-7 stub** — a placeholder "Run session — slice 7" page so the event-detail "Run session" button routes somewhere; slice 7 fills it). The schedule/match/detail modals are children of the calendar page (component-local state, like the slice-2 slot modal).
- **Nav** (`kf-shell.component.ts`): `canSeeCalendar() = ['coach','assistant-coach','team-manager']`. **Team manager's first nav surface** — its sign-in landing → `/calendar` arrives now (the shell's role-landing map + the team-manager DEMO user's nav). Team nav stays slice 8.
- **`KidsFootballApiClient`:** `listEvents` / `createEvent` / `updateEvent` / `deleteEvent` with per-endpoint Zod parse (`EventListSchema` / `EventSchema`). `KfClubStore` gains an `events` collection + `eventsError` + `loadEvents()` (mirror `loadDrills`/`loadTemplates`; not part of `refresh()`). The calendar page loads events **+ templates + drills + slots** in `ngOnInit` (all four needed for the grid render — the initial-store-load lesson).
- **Components (decomposed):**
  - `calendar-page.component.ts` — the screen shell: header (week label, ‹ Today ›, "+ Match" + "Schedule training", hidden for read-only), the week-grid + rail layout, modal orchestration.
  - `calendar-week-grid.component.ts` — the 52px gutter + 7 day columns; auto-expanding hour range (derived from slots+matches via a pure helper); today tint; absolutely-positioned ghosts / training events / match events; phase mini-bars (`KF_PHASE_COLORS` + per-item drill-phase lookup). Behavior-heavy + **CSS-budget-sensitive** (see risks).
  - `upcoming-rail.component.ts` — the 320px "Upcoming sessions" list (Today / ✓ Done / Match badges).
  - `schedule-training-modal.component.ts` — template radios (phase bar) → slot radios (length-validated "{n} min — too short" red) → date chips (next 4 occurrences, taken struck) → summary → Create. Reactive-forms/CVA where it fits; **enabled-submit** house pattern (Create stays enabled; invalid → `role="alert"` + focus-first-invalid); `kf-modal-focus` trap.
  - `match-modal.component.ts` — opponent / date / kick-off+until (30-min steps) / Home-Away chips / note; `end>start` guard.
  - `event-detail-modal.component.ts` — meta, ✓ Done badge, phase bar, numbered drills, Remove / Close / **Run session** (label flips Resume / Session report from `run` state); read-only role hides Remove + Run.
- **Reuse:** `kf-slot-time`, the contracts slot/date helpers, `KfPhaseTag` / `KfIntensityDots` / `kf-sketch-thumbnail` (detail/ghost), `KF_PHASE_COLORS`, `kf-modal-focus` (trapTabKey/focusFirstField/restoreFocus), `resolveTenantFromRoute`, `mapKfError`, the enabled-submit + focus-first-invalid + `role=alert` pattern, the `--cg-*` literal `:host` skin idiom (no `:root` skin load — the shared-host collision lesson).

## 6. Cascade / guard — data flow

```
DELETE /kids-football/templates/:id
  └─ DeleteTemplateService.deleteTemplate(id)
       ├─ eventRepo.existsForTemplate(id)  → true ⇒ Result.err('template-in-use')  (HTTP 409; nothing deleted)
       └─ false ⇒ templateRepo.delete(id)  → false ⇒ 404
  (read-then-delete non-atomic across repos — pinned, slice-2 convention)

DELETE /kids-football/drills/:id    (slice-5 behaviour, unchanged)
  └─ DeleteDrillService → drillRepo.delete → on success templateRepo.removeDrillReferences(id)
     (drill→event is INDIRECT: the event references the template; a stripped drill just leaves the template)

POST /kids-football/events  (kind:'training')
  └─ CreateEvent → existsForSlot(slotId, date) → true ⇒ Result.err('event-slot-taken')  (HTTP 409)
     over-length plan ⇒ allowed (UI warns only)
     on success ⇒ emitAuditEvent(subtype:'event.created', action:'C', entity:event)  → kernel.audit_event
```

## 7. Testing

- **Contracts:** `EventSchema` parse/reject (kind/detail mismatch, bad `match.end<=start`, bad date, missing training/match for the kind); the pure calendar-date helpers (next-4-occurrences with an injected clock; ISO formatting; week-start) incl. boundary/TZ cases (noon-anchor stability).
- **Repository contract suite (both impls):** CRUD + cross-tenant count-0 (update/delete) + JSONB round-trip (training/match/attendance/run) + mutation isolation + `existsForTemplate` / `existsForSlot` (true/false + cross-tenant invisibility).
- **Use-cases:** create validation (kind/detail; slot-taken → `event-slot-taken`), update/delete not-found, list happy; **DeleteTemplate template-in-use guard** (event referencing → err; none → deletes); **audit emit** (each mutation emits one event with the right subtype/action/entity; failure emits none).
- **Controller e2e:** RBAC 403 matrix (teamManager read-only; facilities none), cross-club invisibility, slot-taken 409, template-in-use 409, invalid POST → 400, unknown PATCH → 404.
- **UI:** calendar page (grid renders events/ghosts/matches, auto hour-range, today tint, initial 4-collection load); schedule modal (template/slot/date selection, length-validation red, taken-date struck, enabled-submit + focus-first-invalid, create); match modal (`end>start` gate); event-detail (Run-session label flips, read-only hides actions); client (per-endpoint parse); store (`loadEvents` populates + error isolation).
- **`test:db`:** live RLS proof on `kids_football.event` (cross-tenant count-0 on list/update/delete under `NOBYPASSRLS`); **persisted-audit proof** — a real event create lands a `kernel.audit_event` row scoped to the tenant + cross-tenant invisible (the all-in-one F1 closure's acceptance).
- **Part A (substrate):** the `kernel-audit.sql` parity spec (idempotent artifact ↔ authoritative migration: no table/column/policy/trigger drift); substrate's own `ci:local` + wave.
- **Gate:** `npm run ci:local` (no masking pipe; capture `$?`) + `npm run test:db`; full **browser run-through** (schedule a training onto a slot, see it on the grid + rail; add a match; open the detail; try to delete the used template → blocked); screenshot proof `de-braighter/docs/club-grass-calendar-s6-proof.png`.

## 8. Scope / YAGNI

- **In (Part A):** the published `sql/kernel-audit.sql` artifact + parity spec + `2.1.1` publish (substrate, designer-first).
- **In (Part B):** the event vertical (contracts → migration/RLS → repo×2 → use-cases → controller → client → calendar UI: page + grid + rail + 3 modals + the `run/:eventId` slice-7 stub), the template-in-use delete guard, the one-event-per-slot-per-date guard, the persisted F1 audit wiring (manifest subtypes + forRoot adapter + `emitAuditEvent` in 3 use-cases + `db:setup:core` line), team-manager nav/landing + `templateRead`/`drillRead` grant.
- **Out (deferred):** running the session (slice 7 — attendance snapshot, the derived timer, wrap-up effect checks; the `run/:eventId` page is a stub now); the team/player development view (slice 8, where `subjectSensitivity` fires); F1 audit for the **other** verticals (member/team/resource/slot/drill/template — same pattern, demand-driven, the remainder of #245); drag-and-drop on the calendar (click-to-schedule only, prototype parity); recurring-event series (each event is a single dated row).

## 9. Risks / notes

- **Cross-layer coupling (the all-in-one cost, accepted).** Part B's persisted-audit path depends on Part A being **published** to the registry first (no `file:` linking — cluster rule). Execution order is strict: substrate `2.1.1` PR + wave + **publish**, then exercir bumps `^2.1.1` + `npm ci` + builds. The exercir PR's `test:db` audit proof cannot pass until `2.1.1` is on the registry. Mitigation: the in-memory adapter keeps **all non-DB tests + dev** green independent of the publish, so only the `test:db` audit assertion is publish-gated.
- **Publish from this environment.** `npm run publish:{contracts,runtime}` needs a `GITHUB_TOKEN` with `write:packages`. 2.0.0/2.1.0 were published in-cluster, so the flow works; if this session's token is read-only, the founder runs the two publish commands (`! npm run publish:…`). Surfaced at build time, not assumed.
- **Oncology arc non-disruption.** `2.1.1` is `< 2.2.0` (the unmerged oncology branch's claimed version) and additive-only — it does not touch the oncology release line. The audit WORM triggers it projects already landed on substrate `main` (#171).
- **CSS per-component-style budget (battle-tested).** The `pack-football-visual-editor` **prod** build enforces 6kB warn / **8kB ERROR** per component style. The week grid + schedule modal are large — decompose (grid / rail / modals as separate components) and trim inline CSS under 8kB. `nx serve` (dev config) hides this — **always run the prod `ci:local` build** (without a masking `| tail`).
- **`TenantScopedClient` fan-out.** Adding the `event` delegate fans mechanical edits to `stub-delegates.ts` + every sibling contract spec — a missed one is a TS2741 the type-stripped vitest gate misses. Spec-reviewer verifies.
- **Time-coupled tests.** The calendar/date helpers + any in-window assertions must use an **injected/fixed clock**, never hardcoded calendar dates (the SSE PT24H lesson) — the run timer (slice 7) will lean on the same discipline.
- **Audit demo posture (charter D1).** Persisted audit is a **code shape** (real rows in `kernel.audit_event`), not a regulatory claim — charter D1 defers the compliance/legal review. `retentionTier:'operational'` (90-day) is the right default for kids-football demo CRUD; deletions are **not** escalated to `security` tier this slice (demand-driven).
- **Shared-host theme collision (battle-tested).** New pages carry the `--cg-*` literal-value `:host` idiom via the shell cascade — no `:root` skin load.
