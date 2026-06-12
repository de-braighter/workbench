# Exercir kids-football MVP — Slice 2 (club operations: Teams + Resources + training-slots board) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the club-admin surface: Teams + Resources CRUD verticals (the deferred slice 1b — mirrors of the proven Member vertical, replacing the UI demo team fixtures with live endpoints), then the Slot vertical (the only NEW table) with a TDD-hardened pure conflict-detection function, surfaced on a Mon–Sun training-slots board with a live-conflict slot modal (saving always allowed, conflicts flagged).

**Architecture:** Everything lands in the four EXISTING slice-1 projects (`libs/pack-kids-football-contracts`, `libs/pack-kids-football`, `apps/pack-kids-football-api`, `libs/pack-kids-football-ui`) — **no new nx project, no new workspace package.json** (lockfile risk ≈ 0). Each entity is a full vertical per the slice-1 Member pattern: tenant-blind repository port + in-memory impl + Prisma adapter on ONE portable contract suite (ADR-110 inv-4), `Result<T,E>` use-cases, `@RequiresPermission` controllers, request-scoped in-memory seam / `GucPrismaRunner` DB path behind `PACK_KIDS_FOOTBALL_DB`. Conflict detection is a **pure function in the contracts lib** so the API list-annotation and the UI live modal warning share one implementation (the UI may not import the NestJS pack lib — nx boundary).

**Tech Stack:** Angular (standalone + signals) + NestJS + Prisma/Postgres, Nx + vitest, `@de-braighter/substrate-{contracts,runtime}@^2.0.0` **as already pinned by slice 1** (auth/tenant/RLS surface only — no kernel/inference).

**Repo:** `domains/exercir`. **Branch:** cut `feat/kids-football-s2-club-ops` off `origin/main` in a **fresh worktree** `domains/exercir-wt-kf-s2`, then `npm ci`. **Gate:** `npm run ci:local` + `npm run test:db` (live RLS proof must now cover the `slot` table). **Design source of truth:** `domains/exercir/docs/design/exercir-mvp-handoff/README.md` — data model (Slot shape), screen 9 "Club administration", "Interactions & Behavior" (the conflict rule). Prototype references: `docs/design/exercir-mvp-handoff/exercir/proto/club.jsx` (Teams/Resources tabs) + `club-slots.jsx` (board + conflict detection + slot modal).

**Slice-1b seam:** Tasks 1–7 are the deferred slice 1b (Teams + Resources). Task 7 ends the seam — if a separate 1b PR is ever wanted, split there. This plan ships both phases on one branch/PR.

---

## Pre-flight (read before Task 1)

The implementer of each task must read the slice-1 reference files for its layer and mirror their structure (adapt names, do NOT copy comments verbatim):

- **Vertical pattern (domain):** `libs/pack-kids-football/src/out-ports/member.repository.ts` (port + `InMemoryMemberRepository` with `activeTenant()` resolver + optional shared-store ctor param + `structuredClone` boundaries) · `src/out-ports/member.repository.contract.ts` (the portable contract suite: CRUD + malformed-UUID-as-not-found + tenant-isolation read/write + mutation isolation) · `src/out-ports/member.repository.spec.ts` (in-memory harness) · `src/application/*-member.service.ts` + `src/in-ports/*-member.use-case.ts` (`Result<T,E>` convention, DI symbols).
- **Prisma adapter:** `src/out-adapters/prisma-member.repository.ts` (inject only `TENANT_RUNNER`; every query in `runner.run(fn)`; `updateMany`/`deleteMany` count-0 = not-found; UUID regex guard; GUC read-back for parentless creates; nullable-Json omit-key rule) · `src/out-adapters/prisma-member.repository.contract.spec.ts` (fake GUC runner harness) · `src/out-ports/tenant-runner.port.ts` (the narrow structural `TenantScopedClient` — extend it per entity).
- **RLS migration shape:** `prisma/migrations/20260611120000_kids_football_spine/migration.sql` (ENABLE+FORCE RLS, `::text`-cast USING + WITH CHECK policies on `app.tenant_pack_id`, guarded `DO $...$` USAGE/grant blocks) + `prisma/packs/kids-football.prisma` (UUID PKs, `@map` snake_case, logical FKs as plain String — no `@relation`, per ADR-027 §5).
- **API composition:** `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts` (flag-gated repo binding, request-scoped `ACTIVE_TENANT_FN` lazy-read seam, `SHARED_*_STORE_MAP`, `PackKidsFootballDbModule.forRoot`) · `src/app/members.controller.ts` (`@RequiresPermission`, failure→status mapping) · `src/app/pack-kids-football-auth.bootstrap.ts` (`PACK_KF_CONTROLLERS` list, decorator-reference validation, demo grants + seeds) · `src/app/members.e2e.spec.ts` (RBAC 403/200 over in-memory binding) · `src/app/rls.integration.spec.ts` (DB-gated isolation proof).
- **UI patterns:** `libs/pack-kids-football-ui/src/lib/admin/members-page.component.ts` (role-gated writes, focus-trapped inline modal with restore-on-close, in-modal delete confirm, aria-live count, 24px+ targets) · `src/lib/shell/kf-shell.component.ts` (team switcher signal token, `:host` Club Grass tokens — `:root` is dead under emulated encapsulation) · `src/lib/data/kids-football-api.client.ts` (header-identity + zod-parsed responses) · `src/lib/data/demo-fixtures.ts` (the team fixtures Task 6 kills) · `src/lib/kf-i18n.ts` (en-only flat catalog).

**Battle-tested gotchas to honor (from the slice-1 memory):** `computed()` over `FormControl.value` has zero reactive deps — use `toSignal(control.valueChanges)`; Prisma rejects plain JS `null` for nullable **Json** columns (omit the key; scalar `String?`/`Int?` columns take `null` fine); relative `routerLink` resolves against the CURRENT route (the doubled `/admin/admin` trap) — there is NO absolute-routerLink precedent in the slice-1 shell (its only routerLink, `kf-shell.component.ts:199`, is relative; `signOut()` at `:299-308` is *imperative* `router.navigate`), so admin-tab links must be built fresh as absolute `[routerLink]` arrays resolving `:tenant` via the same `paramMap` fallback chain `signOut()` uses; new-schema grants need the guarded `GRANT USAGE` DO block; no workspace package.json should change in this slice — if one ever does, re-run `npm install` and commit the lockfile in the same commit.

## File structure (created/modified in this slice)

| File | Responsibility | Task |
|---|---|---|
| `libs/pack-kids-football/src/out-ports/team.repository.ts` (+ `.contract.ts`, `.spec.ts`) | Team port + in-memory + contract suite | 1 |
| `libs/pack-kids-football/src/in-ports/{list,create,update,delete}-team.use-case.ts` + `src/application/*-team.service.ts` | Team use-cases (delete cascades member assignments) | 1 |
| `libs/pack-kids-football/src/out-adapters/prisma-team.repository.ts` (+ contract spec) · `tenant-runner.port.ts` (team delegate) | RLS-scoped Prisma Team repo | 2 |
| `apps/pack-kids-football-api/src/app/teams.controller.ts` (+ e2e spec) · `pack-kids-football.module.ts` · `pack-kids-football-auth.bootstrap.ts` | Teams endpoints + RBAC + demo team seed | 3 |
| Same four layers for **Resource** (`resource.repository.ts` … `resources.controller.ts`) | Resource vertical | 4–5 |
| `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` · `kf-club-store.ts` (new) · `demo-fixtures.ts` (teams KILLED) · `shell/kf-shell.component.ts` · `admin/members-page.component.ts` | Live teams/resources plumbing; switcher + members consume the API | 6 |
| `libs/pack-kids-football-ui/src/lib/admin/club-admin-shell.component.ts` (tabs layout) · `admin/teams-page.component.ts` · `admin/resources-page.component.ts` · `routes.ts` · `kf-i18n.ts` | Club-administration tab bar + Teams/Resources tabs | 7 |
| `libs/pack-kids-football-contracts/src/entities.ts` (+ slot schemas) · `src/slot-conflicts.ts` (NEW, pure) · `src/roles.ts` (slot perms) · `libs/pack-kids-football/src/manifest/pack-manifest.ts` | Slot contract + conflict engine + permissions | 8 |
| `prisma/packs/kids-football.prisma` (Slot model) + `prisma/migrations/<ts>_kids_football_slot/migration.sql` | Slot table + RLS | 9 |
| `libs/pack-kids-football/src/out-ports/slot.repository.{ts,contract.ts}` + `out-adapters/prisma-slot.repository.ts` (+ specs) · `tenant-runner.port.ts` (slot delegate) | Slot port + two impls on one contract | 10 |
| `libs/pack-kids-football/src/{in-ports,application}/*slot*` · `apps/…/slots.controller.ts` (+ e2e) · module/bootstrap wiring · `rls.integration.spec.ts` (slot/team/resource proofs) · cascade upgrades | Slot use-cases + annotated list + endpoints + live RLS proof | 11 |
| `libs/pack-kids-football-ui/src/lib/admin/slots-page.component.ts` (+ spec) · client slot methods · `kf-slot-time.ts` · team/resource card hour-lines | Training-slots board + slot modal | 12 |

---

## Task 1: Team domain vertical — contract suite + port + in-memory + use-cases

**Files:**
- Create: `libs/pack-kids-football/src/out-ports/team.repository.ts`, `…/team.repository.contract.ts`, `…/team.repository.spec.ts`
- Create: `libs/pack-kids-football/src/in-ports/{list,create,update,delete}-team.use-case.ts`, `src/application/{list,create,update,delete}-team.service.ts`, `src/application/team-use-cases.spec.ts`
- Modify: `libs/pack-kids-football/src/index.ts` (export the new symbols)

- [ ] **Step 1: Write the failing contract suite + use-case specs.** Mirror `member.repository.contract.ts` 1:1, substituting `Team` (shape from contracts: `{id, name, age: 'U7'..'U12', color}`):

```ts
export type CreateTeamInput = Omit<Team, 'id'>;
export type UpdateTeamPatch = Partial<Pick<Team, 'name' | 'age' | 'color'>>;
export interface TeamRepository {
  list(): Promise<readonly Team[]>;
  findById(id: string): Promise<Team | null>;
  create(input: CreateTeamInput): Promise<Team>;
  update(id: string, patch: UpdateTeamPatch): Promise<Team | null>;
  delete(id: string): Promise<boolean>;
}
export const TEAM_REPOSITORY = Symbol('TEAM_REPOSITORY');
```

  Contract cases: empty-list, create-returns-id, insertion order, distinct ids, findById hit/absent-UUID/malformed-id→null, update patch/absent/malformed/persists, delete true/false/malformed, tenant isolation read+write (A invisible to B; cross-tenant update→null, delete→false, row unchanged), mutation isolation (mutate a returned team's `name` — store unaffected). Use-case specs: list returns `{ok:true, value}`; create validates via `TeamSchema.omit({id})` and returns `{ok:false, error:{kind:'invalid-input', detail}}` on bad age band; update returns `{kind:'team-not-found', id}` for an absent id; **delete cascades member assignments** — seed an `InMemoryMemberRepository` with a player (`teamId` = the team) and a coach (`teamIds` contains it), delete the team, assert the player's `teamId` is `null` and the coach's `teamIds` no longer contains the id.
- [ ] **Step 2: Run → FAIL** (`cd domains/exercir-wt-kf-s2 && npx vitest run libs/pack-kids-football/src/out-ports/team.repository.spec.ts libs/pack-kids-football/src/application/team-use-cases.spec.ts` — modules missing).
- [ ] **Step 3: Implement** `InMemoryTeamRepository` (same `activeTenant()` + optional `store` ctor, `structuredClone` at every boundary) + the four services. `DeleteTeamService` injects `TEAM_REPOSITORY` **and** `MEMBER_REPOSITORY`; after a successful team delete it lists members and clears `teamId === id → null` / filters `id` out of `teamIds` via `memberRepo.update` (handoff cascade: "team → member/slot assignments cleared"; the **slot** half of that cascade lands in Task 11 when the slot port exists — note it in the service doc comment). **Known limitation, pin it in the service doc comment:** on the Prisma path each `runner.run()` is its own transaction, so the cascade is NOT atomic — a crash mid-cascade can leave a member referencing a deleted team (the prototype's single-store reducer was atomic). Accepted at MVP volume; the reference is logical-FK (no DB constraint breaks) and a re-run of the delete path self-heals. A pack-level unit-of-work is the upgrade path if it ever matters.
- [ ] **Step 4: Run → PASS**, then `npx nx run-many -t lint test --projects=pack-kids-football`.
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — Team CRUD vertical (port + in-memory + use-cases, member-assignment cascade)`.

## Task 2: RLS-scoped Prisma Team repo

**Files:**
- Create: `libs/pack-kids-football/src/out-adapters/prisma-team.repository.ts`, `…/prisma-team.repository.contract.spec.ts`
- Modify: `libs/pack-kids-football/src/out-ports/tenant-runner.port.ts` (add `TenantScopedTeamRow/CreateInput/UpdateData/Delegate`; add `readonly team: TenantScopedTeamDelegate` to `TenantScopedClient`), `src/index.ts`

- [ ] **Step 1: Write the failing test** — run `describeTeamRepositoryContract('Prisma', …)` against `PrismaTeamRepository` with the same fake-GUC-runner harness pattern as `prisma-member.repository.contract.spec.ts` (in-memory row store keyed by tenant GUC; P2023-style throw on malformed UUID in `where.id`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** mirroring `prisma-member.repository.ts`: UUID regex guard, `runner.run` everywhere, GUC read-back (`current_setting('app.tenant_pack_id', true)`) for the parentless create, `updateMany`/`deleteMany` count-0 semantics. Team has NO Json columns, so no omit-key dance — all fields are scalar Strings. `kids_football.team` already exists in the spine migration: **no schema change in this task.**
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — RLS-scoped Prisma Team repo on the shared contract suite`.

## Task 3: Teams HTTP controller + module wiring + demo team seed + RBAC e2e

**Files:**
- Create: `apps/pack-kids-football-api/src/app/teams.controller.ts`, `…/teams.e2e.spec.ts`
- Modify: `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts` (team providers, `SHARED_TEAM_STORE_MAP`, `seedDemoTeams`), `…/pack-kids-football-auth.bootstrap.ts` (`PACK_KF_CONTROLLERS` + seed call)

- [ ] **Step 1: Write the failing e2e** (mirror `members.e2e.spec.ts`, in-memory binding): `GET /kids-football/teams` → 403 without a grant, 200 with `KF_PERMISSIONS.teamRead` (coach), returns the seeded demo teams; `POST/PATCH/DELETE` → 403 for coach (no `teamWrite`), 2xx for club-admin; `PATCH` absent id → 404 `{kind:'team-not-found'}`; bad body → 400 `{kind:'invalid-input'}`; club A's teams invisible to club B.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Controller mirrors `members.controller.ts` (read → `teamRead`, writes → `teamWrite`; same failure→status mapping; no query filter). Module: `SHARED_TEAM_STORE_MAP` + request-scoped `InMemoryTeamRepository` reusing the SAME `ACTIVE_TENANT_FN` provider, flag-gated against `PrismaTeamRepository`, use-case providers + exports. Seed: `seedDemoTeams(tpidA, tpidB)` reusing the EXISTING module-level demo team UUIDs (`DEMO_TEAM_SONN_A='a1b2c3d4-1001-4abc-8001-0000c1ab1001'`, `DEMO_TEAM_SONN_B='a1b2c3d4-1002-4abc-8001-0000c1ab1002'`, `DEMO_TEAM_STAD_A='b1b2c3d4-2001-4abc-8002-0000c1ab2001'`) so the slice-1 member seed's `teamId` references resolve to real teams:

```ts
// Club A: { id: DEMO_TEAM_SONN_A, name: 'FC Sonnenberg U9',  age: 'U9',  color: '#2F8A4E' }
//         { id: DEMO_TEAM_SONN_B, name: 'FC Sonnenberg U11', age: 'U11', color: '#4C9BD6' }
// Club B: { id: DEMO_TEAM_STAD_A, name: 'FC Stadtpark U10',  age: 'U10', color: '#2F8A4E' }
```

  Bootstrap: append `KidsFootballTeamsHttpController` to `PACK_KF_CONTROLLERS` (decorator-reference validation picks it up automatically) and call `seedDemoTeams` next to `seedDemoMembers` (in-memory mode only).
- [ ] **Step 4: Run → PASS** (`npx nx test pack-kids-football-api`).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — Teams endpoints + RBAC + demo team seed`.

## Task 4: Resource domain vertical + Prisma adapter

**Files:**
- Create: `libs/pack-kids-football/src/out-ports/resource.repository.ts`, `…/resource.repository.contract.ts`, `…/resource.repository.spec.ts`, `src/out-adapters/prisma-resource.repository.ts`, `…/prisma-resource.repository.contract.spec.ts`
- Create: `libs/pack-kids-football/src/in-ports/{list,create,update,delete}-resource.use-case.ts`, `src/application/{list,create,update,delete}-resource.service.ts`, `src/application/resource-use-cases.spec.ts`
- Modify: `tenant-runner.port.ts` (resource delegate), `src/index.ts`

This is the second pass through a now-proven pattern, so the whole vertical (port + in-memory + contract + Prisma adapter + use-cases) is ONE task. `Resource` shape from contracts: `{id, name, type, surface, status: 'Available'|'Maintenance', note?}` — all scalars, `note` optional (`String?` accepts plain `null`).

- [ ] **Step 1: Write the failing tests** — `describeResourceRepositoryContract` (same case set as Task 1, adapted fields: patch `status: 'Maintenance'`); run it against the in-memory impl AND the Prisma adapter (fake runner); use-case specs incl. create-validation (`ResourceSchema.omit({id})`, bad `type` → `invalid-input`) and `resource-not-found` on update/delete. Resource delete ships WITHOUT its slot cascade for now (slots don't exist yet — Task 11 adds "resource → its slots" per the handoff; pin that with a doc comment + a `// cascade lands in Task 11` note, NOT a skipped test).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** port + `InMemoryResourceRepository` + `PrismaResourceRepository` + delegate types + four services. `kids_football.resource` exists in the spine — no schema change.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — Resource CRUD vertical (one contract suite, two impls)`.

## Task 5: Resources HTTP controller + wiring + demo resource seed + RBAC e2e

**Files:**
- Create: `apps/pack-kids-football-api/src/app/resources.controller.ts`, `…/resources.e2e.spec.ts`
- Modify: `pack-kids-football.module.ts`, `pack-kids-football-auth.bootstrap.ts`

- [ ] **Step 1: Write the failing e2e** — mirror Task 3: read → `resourceRead` (coach 200, no-grant 403), writes → `resourceWrite` (club-admin only), 404/400 mapping, cross-club invisibility, seeded resources returned.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** controller + module providers (`SHARED_RESOURCE_STORE_MAP`) + `seedDemoResources` with FIXED UUIDs (new module-level consts, same hex-only discipline):

```ts
// Fully-formed v4-shaped UUIDs (lowercase hex, version nibble 4, variant nibble 8 —
// same discipline as DEMO_TEAM_SONN_A; ResourceSchema.id and the controllers validate UUID shape):
// Club A: { id: 'a2000001-3001-4abc-8001-0000c1ab3001', name: 'Pitch 1',  type: 'Full pitch', surface: 'Grass',      status: 'Available' }
//         { id: 'a2000001-3002-4abc-8001-0000c1ab3002', name: 'Pitch 2',  type: 'Half pitch', surface: 'Artificial', status: 'Available' }
//         { id: 'a2000001-3003-4abc-8001-0000c1ab3003', name: 'Gym hall', type: 'Gym hall',   surface: 'Indoor',     status: 'Maintenance', note: 'Floor renewal until July' }
// Club B: { id: 'b2000001-3001-4abc-8002-0000c1ab3001', name: 'Hauptplatz', type: 'Full pitch', surface: 'Grass', status: 'Available' }
```

  (The Maintenance gym hall gives the browser run-through a maintenance-flag scenario without any manual setup.) Append `KidsFootballResourcesHttpController` to `PACK_KF_CONTROLLERS`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — Resources endpoints + RBAC + demo resource seed`.

## Task 6: UI live data plumbing — kill the demo team fixtures

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (+ spec) — add `listTeams/createTeam/updateTeam/deleteTeam` + `listResources/createResource/updateResource/deleteResource` (zod-parsed via `TeamSchema`/`ResourceSchema`, same header pattern)
- Create: `libs/pack-kids-football-ui/src/lib/data/kf-club-store.ts` (+ spec)
- Modify: `libs/pack-kids-football-ui/src/lib/data/demo-fixtures.ts` — DELETE `DemoTeam`, `FC_SONNENBERG_TEAMS`, `FC_STADTPARK_TEAMS`, `FC_SONNENBERG_TEAM_A_ID/B_ID`, `FC_STADTPARK_TEAM_A_ID`, `teamsForTenant` and every "PARITY NOTE" about them; KEEP `DEMO_USERS` + tenant ids + `clubNameForTenant` (sign-in stays a mocked user picker per the handoff — only the TEAM fixtures were the parity hack). `DemoUser.teamIds` keeps its UUID literals (they now reference API-seeded teams).
- Modify: `shell/kf-shell.component.ts` (+ spec), `admin/members-page.component.ts` (+ spec), `src/index.ts`

- [ ] **Step 1: Write the failing tests** — `KfClubStore`: a root-provided signal store with `teams`/`resources` signals + `loadTeams()`/`loadResources()`/`refresh()` delegating to the client; clears on sign-out (session change to null). Shell spec: switcher options come from `store.teams()` filtered by `session.teamIds` (provide a stub store — no HTTP); members-page spec: team name column + modal team select consume `store.teams()` instead of `teamsForTenant`. Client spec: new methods hit the right URLs with identity headers, zod-reject a malformed body.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Store loads after sign-in (shell `ngOnInit` awaits `loadTeams()` before the active-team init/re-validation so the switcher race guard still holds). Delete the fixture exports; fix every import. `availableTeams` in the shell: `store.teams().filter(t => s.teamIds.includes(t.id))` — club-admin (`teamIds: []`) keeps seeing no switcher. Deleting `DemoTeam` retypes the shell's `computed<readonly DemoTeam[]>` (`kf-shell.component.ts:251`) and its `@for` element type to the contracts `Team` — do NOT re-import the deleted type.
- [ ] **Step 4: Run → PASS** (`npx nx test pack-kids-football-ui`); grep proves `teamsForTenant` has zero references.
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — live teams/resources in the UI, demo team fixtures retired`.

## Task 7: Club-administration tab layout + Teams tab + Resources tab  *(slice-1b seam ends here)*

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/admin/club-admin-shell.component.ts` (+ spec), `admin/teams-page.component.ts` (+ spec), `admin/resources-page.component.ts` (+ spec)
- Modify: `libs/pack-kids-football-ui/src/lib/routes.ts` (the Angular routes live in the UI lib — sanctioned slice-1 deviation documented in that file's header), `kf-i18n.ts`, `shell/kf-shell.component.ts` (nav link label)

- [ ] **Step 1: Write the failing tests** — Routes: `admin` children become `'' → ClubAdminShellComponent` with children `members|teams|resources|slots` (slots route added now, page lands in Task 12 — point it at teams-page? NO: register the slots route only in Task 12; here only members/teams/resources). ClubAdminShell: "Club administration" display heading + club name + underline tab bar; tabs are **router links built absolutely from the `:tenant` param** — `[routerLink]="['/t', tenant, 'p', 'kids-football', 'admin', tab.path]"` where `tenant` is resolved via the same `paramMap` fallback chain `signOut()` uses (`kf-shell.component.ts:299-308` — note that is *imperative* navigation, the only precedent; relative links double-resolve, the slice-1 `/admin/admin` gotcha) with `aria-current="page"` on the active tab (nav-with-links, not ARIA tabs — these are route navigations); 3.5px accent underline per screen 9. Teams tab: card grid (color dot, name display-font, age, player count, staff list with role badges) from `store.teams()` + members; create/edit modal (name input, age select over `KF_TEAM_AGE_BANDS`, 6-swatch color picker from the handoff team palette `#2F8A4E #4C9BD6 #E8A93C #9C8DC9 #D4683B #3C7C8C` — radio-group semantics, each swatch ≥24px, visible selected outline + `aria-checked`), in-modal delete confirm, role-gated writes (`+ Add team` hidden without club-admin). Resources tab: cards (name, status pill — Maintenance = red-tinted 1.5px border on the card, `type · surface · note`), modal (name, type/surface selects, Available/Maintenance status chips, note input). Both modals mirror the members-page focus pattern: focus trapped, initial focus on first field, restore to the opener on close, `Escape` closes. The "weekly slots · h" line on team cards and "h booked / week" on resource cards is DEFERRED to Task 12 (slots don't exist yet) — leave a `<!-- slot hours line lands with the slots vertical -->` comment in both templates.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (standalone + signals + OnPush; reactive forms per `/reactive-forms-cva-governance`; `toSignal(control.valueChanges)` for any form-derived signal; Club Grass `--cg-*` tokens on `:host`). Add the en-only `kf.teams.*` / `kf.resources.*` / `kf.adminTabs.*` strings to `kf-i18n.ts`. Shell nav link renames `Members` → `Club`: replace the `kf.shell.nav.members` catalog entry with `'kf.shell.nav.club': 'Club'` and update the shell's `msg.navMembers` → `msg.navClub` + `data-testid` (routerLink unchanged — the admin redirect now lands on the tabbed layout, default child `members`).
- [ ] **Step 4: Run → PASS**, then full `npm run ci:local` (the seam gate — everything to the left of the seam must be green on its own).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — club-admin tab layout + Teams/Resources admin tabs (slice-1b complete)`.

## Task 8: Slot contracts + conflict engine + slot permissions

**Files:**
- Modify: `libs/pack-kids-football-contracts/src/entities.ts` (+ `entities.spec.ts`), `src/roles.ts` (+ `roles.spec.ts`), `src/index.ts`
- Create: `libs/pack-kids-football-contracts/src/slot-conflicts.ts`, `…/slot-conflicts.spec.ts`
- Modify: `libs/pack-kids-football/src/manifest/pack-manifest.ts` (+ `pack-manifest.spec.ts`)

- [ ] **Step 1: Write the failing tests.** Entities:

```ts
export const SlotSchema = z.object({
  id: z.string(),
  recurring: z.boolean(),
  /** 1=Mon..7=Sun — required when recurring. */
  dow: z.number().int().min(1).max(7).optional().nullable(),
  /** ISO yyyy-mm-dd — required when ad hoc. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  /** Float hours, 30-min steps (17.5 = 17:30). */
  start: z.number().min(0).max(24),
  end: z.number().min(0).max(24),
  resourceId: z.string().uuid(),
  /** null/undefined = unassigned. DEVIATION from the prototype's '' sentinel — mirrors Member.teamId; the UI maps its '' select value to null. */
  teamId: z.string().uuid().optional().nullable(),
});
export const CreateSlotInputSchema = SlotSchema.omit({ id: true }).superRefine((s, ctx) => {
  if (s.recurring && s.dow == null) ctx.addIssue({ code: 'custom', message: 'recurring slot requires dow' });
  if (!s.recurring && !s.date) ctx.addIssue({ code: 'custom', message: 'ad-hoc slot requires date' });
  if (s.end <= s.start) ctx.addIssue({ code: 'custom', message: 'end must be after start' });
  if (s.start % 0.5 !== 0 || s.end % 0.5 !== 0) ctx.addIssue({ code: 'custom', message: '30-minute steps' });
});
export const AnnotatedSlotSchema = SlotSchema.extend({
  conflictIds: z.array(z.string()),
  maintenance: z.boolean(),
});
export type Slot = z.infer<typeof SlotSchema>;
export type AnnotatedSlot = z.infer<typeof AnnotatedSlotSchema>;
// NOTE: the structural create-input type (CreateSlotInput = Omit<Slot, 'id'>) lives with the
// repository port in Task 10, mirroring CreateMemberInput — do not mint a second name here.
```

  Spec: valid weekly + ad-hoc slots accepted; recurring-without-dow, adhoc-without-date, end≤start, 17.25 start, dow 8, bad date format all rejected. Roles: `slotRead: 'kids-football.slot.read'`, `slotWrite: 'kids-football.slot.write'`. Manifest spec: 8 permissions; clubAdmin holds slotWrite (it uses `Object.values(P)` — gains both automatically); coach/assistantCoach/teamManager/facilities each gain `slotRead`, none gains `slotWrite`. **This breaks five EXISTING assertions in `pack-manifest.spec.ts` — update them in the same red→green pass:** "declares all 6 permissions" (→ 8), coach `toEqual([memberRead, teamRead, resourceRead])` (+ slotRead), assistantCoach (same), teamManager `toEqual([memberRead, teamRead])` (+ slotRead), facilities `toEqual([resourceRead])` (+ slotRead). Grant rationale (broader than the handoff Roles table, deliberate): the slots board is read-relevant to every staff role — coaches/team managers see when their team trains; facilities staff see what's booked on their pitches — and read-only is harmless; only clubAdmin mutates.

  **Conflict engine (`slot-conflicts.ts`) — TDD this hard.** Implementation (pure, prototype-faithful — `club-slots.jsx:9-20`):

```ts
export interface SlotDayTime {
  readonly id?: string | null; // drafts (modal, unsaved) carry no id
  readonly recurring: boolean;
  readonly dow?: number | null;
  readonly date?: string | null;
  readonly start: number;
  readonly end: number;
  readonly resourceId: string;
}

/** ISO date → 1=Mon..7=Sun (noon anchor avoids TZ edge-cases). */
export function dowOfDate(isoDate: string): number {
  return ((new Date(`${isoDate}T12:00:00`).getDay() + 6) % 7) + 1;
}

export function slotsOverlap(a: SlotDayTime, b: SlotDayTime): boolean {
  if (!a.resourceId || !b.resourceId || a.resourceId !== b.resourceId) return false;
  let sameDay: boolean;
  if (a.recurring && b.recurring) sameDay = a.dow != null && a.dow === b.dow;
  else if (!a.recurring && !b.recurring) sameDay = !!a.date && a.date === b.date;
  else {
    const rec = a.recurring ? a : b;
    const adhoc = a.recurring ? b : a;
    sameDay = !!adhoc.date && rec.dow === dowOfDate(adhoc.date);
  }
  return sameDay && a.start < b.end && b.start < a.end;
}

/** All slots in `all` conflicting with `candidate` (self excluded by id when present). */
export function slotConflicts<T extends SlotDayTime>(
  candidate: SlotDayTime,
  all: readonly T[],
): T[] {
  return all.filter(
    (o) => (candidate.id == null || o.id !== candidate.id) && slotsOverlap(o, candidate),
  );
}
```

  Required cases (each its own `it`): ① same resource, both recurring, same dow, 17–18.5 vs 18–19 → conflict; ② back-to-back 17–18 vs 18–19 → NO conflict (strict `<` half-open intervals); ③ contained interval 17–19 vs 17.5–18 → conflict; ④ identical times, different resources → no; ⑤ both ad-hoc, same date, overlap → conflict; same times different dates → no; ⑥ recurring dow=2 vs ad-hoc `2026-06-16` (a Tuesday) overlapping → conflict **in both argument orders** (symmetry); ⑦ ad-hoc on a Wednesday vs recurring dow=2 → no; ⑧ `dowOfDate('2026-06-15')===1` (Mon) and `dowOfDate('2026-06-14')===7` (Sun); ⑨ draft candidate without id vs a list containing an identical stored slot → that slot IS returned; same candidate WITH the stored id → excluded (self); ⑩ empty `resourceId` on a draft → no conflicts; ⑪ zero-length boundary semantics, **fixtures pinned** (prototype-faithful — `slotsOverlap` has NO validity guard; invalid slots are rejected upstream by `CreateSlotInputSchema`'s `end > start`): zero-length draft AT another slot's start boundary — `{start:17, end:17}` vs `{start:17, end:18}` → NO conflict (`b.start < a.end` is `17 < 17` false); zero-length draft strictly INSIDE — `{start:17.5, end:17.5}` vs `{start:17, end:18}` → CONFLICT (`17.5 < 18 && 17 < 17.5`); ⑫ recurring slot with `dow: null` vs recurring → no conflict (no day match). Maintenance flagging is NOT this function's job — it's annotation-layer (Task 11).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (code above) + manifest additions + index exports.
- [ ] **Step 4: Run → PASS** (`npx nx run-many -t test --projects=pack-kids-football-contracts,pack-kids-football`).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — Slot contract + pure conflict engine + slot permissions`.

## Task 9: Slot Prisma model + RLS migration

**Files:**
- Modify: `prisma/packs/kids-football.prisma`
- Create: `prisma/migrations/20260612<hhmm>00_kids_football_slot/migration.sql`
- Modify: `libs/pack-kids-football/src/out-adapters/prisma-schema-shape.spec.ts` (slot model shape assertion)

- [ ] **Step 1: Write the failing test** — extend the schema-shape spec: the generated client exposes a `slot` model with `tenantPackId/recurring/dow/date/start/end/resourceId/teamId` fields.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Model (note `start`/`end` map to `start_hour`/`end_hour` — `end` is SQL-reserved; logical FKs stay plain String per ADR-027 §5):

```prisma
model Slot {
  id           String   @id @default(uuid()) @db.Uuid
  tenantPackId String   @map("tenant_pack_id") @db.Uuid
  recurring    Boolean
  dow          Int?
  date         String?
  start        Float    @map("start_hour")
  end          Float    @map("end_hour")
  resourceId   String   @map("resource_id")
  teamId       String?  @map("team_id")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([tenantPackId])
  @@index([tenantPackId, resourceId])
  @@map("slot")
  @@schema("kids_football")
}
```

  Migration mirrors the spine (`20260611120000_kids_football_spine/migration.sql`) for ONE table: `CREATE TABLE "kids_football"."slot" (… "start_hour" DOUBLE PRECISION NOT NULL, "end_hour" DOUBLE PRECISION NOT NULL …)`; both indexes; `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`; `slot_tenant_pack_isolation` USING + `slot_tenant_pack_isolation_write` FOR INSERT WITH CHECK, both on `"tenant_pack_id"::text = current_setting('app.tenant_pack_id', true)`; then the **guarded DO block** re-granting `USAGE ON SCHEMA kids_football` (idempotent belt) + `GRANT SELECT, INSERT, UPDATE, DELETE ON "kids_football"."slot" TO app` behind the `pg_roles` existence check. `npm run db:generate`; `npx prisma validate --schema=./prisma`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — kids_football.slot table + RLS migration`.

## Task 10: Slot domain vertical — port + in-memory + contract suite + Prisma adapter

**Files:**
- Create: `libs/pack-kids-football/src/out-ports/slot.repository.ts`, `…/slot.repository.contract.ts`, `…/slot.repository.spec.ts`, `src/out-adapters/prisma-slot.repository.ts`, `…/prisma-slot.repository.contract.spec.ts`
- Modify: `tenant-runner.port.ts` (slot delegate types + `readonly slot` on `TenantScopedClient`), `src/index.ts`

- [ ] **Step 1: Write the failing tests** — `describeSlotRepositoryContract` with the standard case set (Task 1 list) PLUS slot-specific cases: create a weekly slot (`recurring:true, dow:3, date:null`) and an ad-hoc slot (`recurring:false, date:'2026-06-20', dow:null`) and assert both round-trip exactly (nullable `Int?`/`String?` scalars take plain `null` — no Json omit-key dance needed); patch `teamId` from a UUID to `null` (un-assign) and assert it persists as null, not the old value.

```ts
export type CreateSlotInput = Omit<Slot, 'id'>;
export type UpdateSlotPatch = Partial<Pick<Slot, 'recurring' | 'dow' | 'date' | 'start' | 'end' | 'resourceId' | 'teamId'>>;
export const SLOT_REPOSITORY = Symbol('SLOT_REPOSITORY');
```

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `InMemorySlotRepository` + `PrismaSlotRepository` (UUID guard, `runner.run`, GUC read-back create, count-0 semantics) + delegate types. In the update path `teamId: null` MUST be forwarded (it's a scalar `String?` — only Json columns reject plain null).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — Slot vertical (one contract suite, two impls)`.

## Task 11: Slot use-cases (conflict-annotated list) + controller + wiring + cascades + live RLS proof

**Files:**
- Create: `libs/pack-kids-football/src/in-ports/{list,create,update,delete}-slot.use-case.ts`, `src/application/{list,create,update,delete}-slot.service.ts`, `src/application/slot-use-cases.spec.ts`
- Create: `apps/pack-kids-football-api/src/app/slots.controller.ts`, `…/slots.e2e.spec.ts`
- Modify: `pack-kids-football.module.ts` (slot providers + `SHARED_SLOT_STORE_MAP` — no demo slot seed; the browser run-through creates slots live), `pack-kids-football-auth.bootstrap.ts` (controller list), `src/app/rls.integration.spec.ts`
- Modify: `src/application/delete-team.service.ts` + spec (slot cascade), `src/application/delete-resource.service.ts` + spec (slot cascade)

- [ ] **Step 1: Write the failing tests.**
  - `ListSlotsService` injects `SLOT_REPOSITORY` + `RESOURCE_REPOSITORY` and returns `AnnotatedSlot[]`: for each slot, `conflictIds = slotConflicts(slot, all).map(c => c.id)` and `maintenance = resource.status === 'Maintenance'`. Spec: two overlapping same-resource Wednesday slots → each lists the other's id; a slot on the Maintenance resource → `maintenance: true` with empty `conflictIds`; an unassigned-team slot annotates fine.
  - `CreateSlotService` validates with `CreateSlotInputSchema` → `invalid-input`; verifies `resourceId` (and `teamId` when non-null) exist via the repos → `invalid-input` with detail otherwise. **Creating a CONFLICTING slot succeeds** — assert a second overlapping slot returns `{ok:true}` (conflicts never block saves; they only annotate the list). Update mirrors create's validation + `slot-not-found`.
  - Cascades: `DeleteTeamService` now ALSO nulls `slot.teamId` for the deleted team's slots; `DeleteResourceService` now deletes the resource's slots (handoff: "resource → its slots"). Spec both. Same non-atomicity caveat as Task 1 (separate `runner.run()` transactions per repo call) — carry the doc comment onto `DeleteResourceService` too.
  - e2e: read → `slotRead` (coach 200; ungranted 403), writes → `slotWrite` (club-admin only; coach POST → 403); `GET /kids-football/slots` returns annotated slots; cross-club invisibility.
  - RLS integration (`rls.integration.spec.ts`, DB-gated): extend the member proof to **team, resource, and slot** — insert one row per table under club A's GUC, assert club B's GUC sees none of them and cannot update/delete them (count 0), under the NOBYPASSRLS app role.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Controller: `GET/POST/PATCH/DELETE /kids-football/slots[...]` mirroring members.controller failure mapping; append `KidsFootballSlotsHttpController` to `PACK_KF_CONTROLLERS`.
- [ ] **Step 4: Run → PASS** — `npx nx run-many -t test --projects=pack-kids-football,pack-kids-football-api`, then `npm run test:db` with Postgres up (the migration applies, the slot RLS proof is live).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — Slot endpoints, conflict-annotated list, cascades + live RLS proof`.

## Task 12: Training-slots board UI + slot modal with live conflict warning

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/admin/slots-page.component.ts` (+ spec), `src/lib/data/kf-slot-time.ts` (+ spec)
- Modify: `kids-football-api.client.ts` (+ spec) — `listSlots(): Promise<AnnotatedSlot[]>` (parse with `z.array(AnnotatedSlotSchema)`), `createSlot/updateSlot/deleteSlot`
- Modify: `kf-club-store.ts` (slots signal + `loadSlots()`), `routes.ts` (slots child route), `kf-i18n.ts`, `admin/teams-page.component.ts` + `admin/resources-page.component.ts` (the deferred hour-lines)

- [ ] **Step 1: Write the failing tests.**
  - `kf-slot-time.ts`: `fmtHour(17.5)==='17:30'`, `fmtHour(8)==='8:00'`; `slotTimeRange(s)==='17:30 – 19:00'`; `HALF_HOUR_OPTIONS` = 8.0…21.5 inclusive in 0.5 steps.
  - Board page (screen 9 "Training slots" + `club-slots.jsx`): summary line `"{n} weekly slots · {h} h/week"` (recurring only; `h` formatted `13.5`/`13`) plus `· ⚠ {c} slots in conflict` (red, counts slots with non-empty `conflictIds`) wrapped in an `aria-live="polite"` region (a11y MUST-FIX live count); `+ Ad hoc slot` (ghost) and `+ Weekly slot` (primary) buttons — hidden without club-admin (role-gated writes); **Mon–Sun board**: 7 columns, recurring slots sorted by start, each card a button (≥24px target) showing the time range in the display font (tabular-nums), resource name (red + "· maintenance" when flagged), team pill tinted with the live team color or a dashed "Unassigned" pill; ⚠ marker + red 1.5px border when `conflictIds.length > 0 || maintenance`; empty day → dashed placeholder. **Ad-hoc list** below (date display-font, time, resource, ⚠ conflict, team pill), sorted by date, with the empty-state copy from the prototype.
  - **Slot modal** (focus-trapped, restore-on-close, Escape closes — mirror the members modal): Weekly/One-off toggle chips swap a Day select (`Monday…Sunday` → dow 1–7) for a date input (focus management on the swap — a11y MUST-FIX from the drill arc); From/Until selects over `HALF_HOUR_OPTIONS` rendered via `fmtHour` (Until options filtered to `> start`); Resource select (from `store.resources()`); Team select with an `Unassigned` option — UI value `''` maps to `teamId: null` at the client call; Save enabled when valid (`end > start`, resource chosen, day-or-date present) — conflicts do NOT disable it; in-edit Remove with in-modal confirm.
  - **Live conflict warning box**: derive the draft from the form via `toSignal(form.valueChanges, …)` (NEVER `computed()` over `control.value` — zero reactive deps, the slice-1 passing-spec-broken-DOM trap) and compute `slotConflicts(draft, store.slots())` + maintenance lookup **client-side with the SAME contracts function the server uses**; render the red-tinted box listing each overlap ("⚠ Overlaps {team or 'an unassigned slot'} · {day/date} {time range}") + the maintenance line + the "You can still save — the conflict stays flagged on the board." note, in an `aria-live="polite"` region. Spec: editing the form to overlap an existing slot makes the warning appear AND save stays enabled; saving succeeds.
  - Teams cards gain `"{n} weekly slots · {h} h"` and resource cards `"{h} h booked / week · {n} recurring slots"` from `store.slots()` (the Task-7 deferral).
  - Routes: `slots` child under the club-admin shell; the tab bar shows "Training slots".
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (standalone + signals + OnPush, reactive forms, `--cg-*` tokens on `:host`, en-only `kf.slots.*` strings). After every save/delete, `store.loadSlots()` refreshes annotations from the server (the server list stays the authority for persisted conflicts; the pure function only previews the draft).
- [ ] **Step 4: Run → PASS**, then full `npm run ci:local`.
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S2 — training-slots board, slot modal with live conflict warning`.

## Task 13: Slice gate + browser run-through + story issue + PR

- [ ] **Step 1:** `npm run ci:local` green; `npm run test:db` green (member + team + resource + slot RLS proofs).
- [ ] **Step 2: Manual browser run-through** (API :3150 in-memory mode + host app `pack-football-visual-editor` :4200, `/t/a1b2c3d4-0001-4abc-8001-0000c1ab0001/p/kids-football/`):
  1. Sign in as Anna Müller (club admin) → Club tabs render; Teams tab shows the two seeded teams with player counts; Resources shows 3 cards incl. the red-bordered Maintenance gym hall.
  2. Create a team + a resource via the modals; edit + delete them again.
  3. Training slots: create a weekly slot (Wed 17:00–18:30, Pitch 1, U9) → card on Wed, summary "1 weekly slots · 1.5 h/week". **Live conflict scenario:** open `+ Weekly slot`, pick Wed 17:30–19:00 on Pitch 1 → the red warning box lists the overlap while the modal is open, Save still enabled → save → both cards show ⚠ red borders, summary shows "⚠ 2 slots in conflict". Add an ad-hoc slot on a Wednesday date on Pitch 1 overlapping → also flagged (recurring-vs-adhoc weekday rule live). Create a slot on the Maintenance gym hall → maintenance flag.
  4. Sign in as Bruno (coach) → team switcher now shows the LIVE team names; slots board visible (slotRead), all write buttons hidden; sign in as club B's admin → none of club A's teams/resources/slots visible.
  5. Screenshot the conflict-flagged board → `de-braighter/docs/club-grass-slots-board-s2-proof.png`.
- [ ] **Step 3:** Create the story issue on `de-braighter/exercir` (mirror #239's shape: scope bullets + acceptance = this plan's goal); push `feat/kids-football-s2-club-ops`; open the PR with `Closes #<story>`, `Producer: orchestrator/claude-fable-5 [subagent-driven-development, writing-plans]`, `Effort: deep`, `Effect: cycle-time 0.01±0.01 expert` + `Effect: findings 5±3 expert`.
- [ ] **Step 4:** Verifier wave (`local-ci` + `reviewer` + `charter-checker` + `exercir-charter-checker` + `qa-engineer`, all `isolation: "worktree"`, prompts forbidding git ops in shared clones) → fix blockers → `drain de-braighter/exercir#<pr>` → `post-findings` (FULL `de-braighter/exercir#<pr>` form, severities `blocking|should-fix|nit|note`, lines that exist in the diff) → merge → `backfill` → `reconcile` → `ritual:post-merge`.

---

## Carry-forwards honored (and explicitly NOT in scope)

- **`demo_mode` anchor:** slice 2 ships no outbound path (no email/webhook/export) — the anchor note stays un-needed; add it the moment one appears (exercir-charter D7/§6).
- **i18n:** en-only `kf-i18n.ts` extension; de/en bundle split stays tracked, not this slice (ADR-012).
- **design-system#192 (Club Grass skin):** if it has merged + published by build time, switching the UI from the local `:host` palette to `skin-club-grass` is OPTIONAL, low-priority, and its OWN commit at the end — never block the slice on it.
- **`subjectSensitivity 'developmental-minor'`:** does NOT fire — slice 2 surfaces zero inferred player state (teams/resources/slots are club logistics). It becomes mandatory the moment a slice surfaces inferred player state or recommendations.

## Self-review notes (author)

- **Spec coverage:** design §8 slice-2 row (recurring + ad-hoc slots, Mon–Sun board, conflict detection, maintenance flags, saving-allowed) → Tasks 8–12; slice-1b (Teams/Resources mirroring Member, live endpoints replacing fixtures) → Tasks 1–7; handoff screen 9 all four tabs → Tasks 7 + 12; handoff conflict rule verbatim → Task 8 (12 named cases); handoff cascades (team → member/slot assignments cleared; resource → its slots) → Tasks 1 + 11 (the slot halves land when the slot port exists — pinned by doc comments in 1/4 and specs in 11).
- **Type consistency:** `TEAM_REPOSITORY`/`RESOURCE_REPOSITORY`/`SLOT_REPOSITORY` symbols + `Create*Input`/`Update*Patch` shapes defined in Tasks 1/4/10 and consumed verbatim in 3/5/11; `SlotSchema`/`AnnotatedSlotSchema`/`slotConflicts` defined in Task 8 and consumed in 11 (server annotation) + 12 (client preview) — one function, two consumers.
- **Deviations from the prototype, pinned:** `teamId: null` replaces the `''` sentinel (Member precedent; UI maps `''`→`null`); `start`/`end` → `start_hour`/`end_hour` columns (SQL reserved word); admin tabs are router links with `aria-current`, not ARIA tabs (they navigate).
- **No fat kernel:** zero kernel/inference; substrate ^2.0.0 used only for auth + tenant/RLS; conflict detection is pure pack logic in the contracts lib; the slot table is pack territory (ADR-176).
