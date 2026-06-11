# Exercir kids-football MVP — Slice 1 (foundation walking-skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Stand up the new persistent `pack-kids-football` pack and prove the *entire* real-persistence-per-slice stack end-to-end on ONE entity (Member) — pack scaffold + roles/permissions manifest + Prisma schema (all 4 spine entities) + RLS + migration + NestJS API on `SubstrateModule.forRoot` + Member CRUD (use-cases → RLS-scoped Prisma repo → endpoints) + a minimal Club-Grass admin UI page + login + the Club Grass skin foundation. Teams + Resources CRUD (slice 1b) then mirror the proven Member vertical.

**Architecture:** A new pack `libs/pack-kids-football` + API app `apps/pack-kids-football-api` in `domains/exercir`, mirroring the **pack-football** reference (DB + RLS + role-based auth). Each club is a tenant; every table carries `tenant_pack_id` and is RLS-scoped via `TENANT_RUNNER.run(fn)` (ADR-202). **No kernel/inference** — substrate provides only auth + tenant/RLS.

**Tech Stack:** Angular (standalone + signals) + NestJS + Prisma/Postgres, Nx + **vitest**, `@de-braighter/substrate-{contracts,runtime}@^1.0.0` (matching exercir — NOT 2.0.0; the MVP needs no inference), `@de-braighter/design-system-*` bricks + a new Club Grass skin.

**Repo:** `domains/exercir`. **Branch:** cut `feat/kids-football-s1-foundation` off `origin/main`. **Gate:** `npm run ci:local` (`nx run-many -t build lint && nx run-many -t test --parallel=1`); DB tests via `npm run test:db`. **Design source of truth:** `domains/exercir/docs/design/exercir-mvp-handoff/` (README = data model + screens + Club Grass tokens). **Reference to mirror:** `apps/pack-football-api/` + `libs/pack-football/` + `prisma/packs/football.prisma` + `libs/pack-football/src/manifest/pack-manifest.ts`.

---

## Pre-flight (read before Task 1)
The implementer of the FIRST task must read these reference files and mirror their structure (do NOT copy verbatim — adapt to the kids-football entities):
- `libs/pack-football/src/manifest/pack-manifest.ts` — the `*_ROLES` / `*_PERMISSIONS` / `PackManifest` shape.
- `prisma/packs/football.prisma` — the per-table `tenant_pack_id @map("tenant_pack_id")` + `@@index([tenantPackId])` + `@@schema(...)` + RLS convention.
- `apps/pack-football-api/src/app/app.module.ts` — `SubstrateModule.forRoot({ tenants, manifests })` + pack module composition.
- `apps/pack-football-api/src/app/pack-football-injuries.controller.ts` — `@Controller` + `@RequiresPermission(...)` + use-case-symbol injection + `Result<T,E>` unwrap.
- `libs/pack-football/src/out-ports/prisma-squad.repository.ts` + `out-ports/tenant-runner.port.ts` — every query wrapped in `runner.run(fn)`; the tenant_pack_id column is set by the runner's GUC, never hardcoded in the adapter.
- `libs/pack-football/project.json` + `apps/pack-football-api/project.json` — the nx project shape (build/test/lint targets, tags).

## File structure (created in this slice)

| File | Responsibility | Task |
|---|---|---|
| `libs/pack-kids-football-contracts/src/entities.ts` (+ zod) | Typed Club/Team/Member/Resource + Role/Permission enums | 1 |
| `libs/pack-kids-football/src/manifest/pack-manifest.ts` | `KF_ROLES` + `KF_PERMISSIONS` + `PACK_KIDS_FOOTBALL_MANIFEST` | 1 |
| `prisma/packs/kids-football.prisma` | 4 spine tables + `tenant_pack_id` RLS columns | 2 |
| `prisma/migrations/<ts>_kids_football_spine/` | forward migration + RLS policies | 2 |
| `libs/pack-kids-football/src/out-ports/member.repository.ts` (port + in-memory) | Member CRUD port + in-memory impl | 3 |
| `libs/pack-kids-football/src/application/*member*.use-case.ts` | List/Create/Update/Delete Member use-cases | 3 |
| `libs/pack-kids-football/src/out-adapters/prisma-member.repository.ts` | RLS-scoped Prisma Member repo (`runner.run`) | 4 |
| `apps/pack-kids-football-api/` (project.json, main.ts, app.module.ts, members.controller.ts, auth.bootstrap.ts) | NestJS API on SubstrateModule + Member endpoints + RBAC | 5 |
| `libs/design-system-css/src/skins/skin-club-grass.css` (design-system repo) | Club Grass token skin | 6 |
| `libs/pack-kids-football-ui/src/lib/shell/*` + `admin/members-page.component.ts` + `auth/sign-in-page.component.ts` | Shell + Members admin page + sign-in | 7 |
| `libs/pack-kids-football/src/routes.ts` + host-app mount | Tenant-scoped routes `/t/:tenant/p/kids-football/...` | 7 |

---

## Task 1: Contracts + roles/permissions manifest

**Files:**
- Create: `libs/pack-kids-football-contracts/src/entities.ts`, `…/zod.ts`, `…/index.ts`, `project.json`, `package.json`
- Create: `libs/pack-kids-football/src/manifest/pack-manifest.ts`
- Test: `libs/pack-kids-football-contracts/src/entities.spec.ts`, `…/manifest/pack-manifest.spec.ts`

- [ ] **Step 1: Write the failing test** — assert the Zod schemas accept a valid Member/Team/Club/Resource (shapes from the handoff README §"Data Model") and reject a bad role; assert `PACK_KIDS_FOOTBALL_MANIFEST` declares the 5 handoff roles (Coach/Assistant coach/Team manager/Club admin/Facilities) and a permission set covering member/team/resource/slot/drill/template/event read+write. Define the enums:
```ts
export const KF_ROLES = { clubAdmin:'kids-football.club-admin', coach:'kids-football.coach',
  assistantCoach:'kids-football.assistant-coach', teamManager:'kids-football.team-manager',
  facilities:'kids-football.facilities' } as const;
export const KF_PERMISSIONS = { memberRead:'kids-football.member.read', memberWrite:'kids-football.member.write',
  teamRead:'…', teamWrite:'…', resourceRead:'…', resourceWrite:'…' /* …slot/drill/template/event in later slices */ } as const;
```
- [ ] **Step 2: Run → FAIL** (`cd domains/exercir && npx vitest run libs/pack-kids-football-contracts/src/entities.spec.ts`).
- [ ] **Step 3: Implement** the entity types + Zod (mirror an existing `pack-football-contracts` lib for the project.json/package.json/index shape; entities per the handoff data model — structured fields + the JSONB-bound fields typed as their TS shapes: `member.notes: {id;date;text}[]`, etc.) and the manifest (mirror `pack-football/src/manifest/pack-manifest.ts`: roles→permissions mapping per the handoff permissions table — Club admin gets member/team/resource write; Coach gets team-scoped read; etc.).
- [ ] **Step 4: Run → PASS.** Register both as nx projects (mirror a pack-*-contracts `project.json`, tags `scope:pack-kids-football`,`type:application`).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S1 — contracts + roles/permissions manifest`.

> **Pre-flight gotcha:** pack-kids-sports' existing manifest uses the OLD `PersonaDescriptor` model — do NOT mirror it. Mirror pack-football's `PackManifest`.

## Task 2: Prisma schema (4 spine entities) + RLS migration

**Files:**
- Create: `prisma/packs/kids-football.prisma` (Club, Team, Member, Resource)
- Create: the forward migration (RLS policies) under `prisma/migrations/`
- Test: `apps/pack-kids-football-api/src/app/rls.integration.spec.ts` (DB-gated, added in Task 5 — for now a schema-shape unit assertion)

- [ ] **Step 1: Write the failing test** — a DB-free assertion that the generated Prisma client exposes `club/team/member/resource` models with a `tenantPackId` field. (The live RLS proof lands in Task 5's integration spec.)
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `kids-football.prisma` mirroring `prisma/packs/football.prisma`: each model has `tenantPackId String @map("tenant_pack_id")`, `@@index([tenantPackId])`, `@@map(...)`, `@@schema("kids_football")`. Club{clubName}; Team{name,age,color}; Member{name,role,teamId?,teamIds Json?,born?,notes Json}; Resource{name,type,surface,status,note?}. Add the migration with `ALTER TABLE … ENABLE ROW LEVEL SECURITY; FORCE ROW LEVEL SECURITY;` + a `USING (tenant_pack_id = current_setting('app.tenant_pack_id', true))` policy per table (mirror the football pack's RLS migration). `npm run db:generate`.
- [ ] **Step 4: Run → PASS** (client shape). Confirm `npx prisma validate --schema=./prisma`.
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S1 — Prisma spine schema (Club/Team/Member/Resource) + RLS`.

## Task 3: Member CRUD use-cases + in-memory repo (TDD the domain first)

**Files:**
- Create: `libs/pack-kids-football/src/out-ports/member.repository.ts` (port + `InMemoryMemberRepository`)
- Create: `libs/pack-kids-football/src/application/{list,create,update,delete}-member.use-case.ts` + DI symbols
- Test: the use-case specs + the in-memory repo spec

- [ ] **Step 1: Write the failing tests** — List returns seeded members for a tenant; Create adds + returns the new member; Update patches notes/role/team; Delete removes + (cascade noted for later: clears team assignment). Use the `Result<T,E>` convention (mirror a pack-football use-case). Members are tenant-scoped at the repo boundary.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the port + `InMemoryMemberRepository` (a `Map<tenant, Map<id, Member>>`) + the four use-cases (pure, injected repo). DI symbols mirror pack-football.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S1 — Member CRUD use-cases + in-memory repo`.

## Task 4: RLS-scoped Prisma Member repo

**Files:**
- Create: `libs/pack-kids-football/src/out-adapters/prisma-member.repository.ts`
- Test: `…/prisma-member.repository.contract.spec.ts` (the SAME contract suite Task 3's in-memory repo passes — ADR-110 inv-4: one contract, two impls)

- [ ] **Step 1: Write the failing test** — run the Task-3 repository CONTRACT suite against `PrismaMemberRepository` (DB-free where possible via a fake runner; the live RLS proof is Task 5). Assert every method calls `runner.run(fn)` (the GUC-scoping boundary) and never hardcodes `tenant_pack_id` in a `where`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** mirroring `libs/pack-football/src/out-ports/prisma-squad.repository.ts`: inject `TENANT_RUNNER`; wrap each query in `runner.run(async (tx) => tx.member.…)`; the runner sets `app.tenant_pack_id` so RLS scopes rows. Map the JSONB `notes`/`teamIds`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S1 — RLS-scoped Prisma Member repo`.

## Task 5: NestJS API app + SubstrateModule composition + Member endpoints + RBAC + live RLS proof

**Files:**
- Create: `apps/pack-kids-football-api/` — `project.json`, `src/main.ts`, `src/app/app.module.ts`, `src/app/members.controller.ts`, `src/app/auth.bootstrap.ts`, `src/app/pack-kids-football.module.ts`
- Test: `src/app/members.e2e.spec.ts` (DB-free, in-memory repo binding) + `src/app/rls.integration.spec.ts` (DB-gated, app role)

- [ ] **Step 1: Write the failing tests** — (a) e2e over the in-memory binding: `GET /kids-football/members` requires `kids-football.member.read` (403 without the role, 200 with), `POST` requires `member.write`, the team switcher header re-scopes results; (b) DB-gated: seed two clubs (tenants), assert a member in club A is invisible under club B's tenant context (RLS isolation under the NOBYPASSRLS app role).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** mirroring `apps/pack-football-api/`: `SubstrateModule.forRoot({ tenants: <stub clubs>, manifests: [PACK_KIDS_FOOTBALL_MANIFEST] })` + `PackKidsFootballModule.forRoot()` (binds in-memory or Prisma repo by an env flag `PACK_KIDS_FOOTBALL_DB`); `MembersController` with `@RequiresPermission(KF_PERMISSIONS.memberRead/Write)`; `auth.bootstrap.ts` granting a demo club-admin role. The DB integration spec runs under the app (NOBYPASSRLS) role.
- [ ] **Step 4: Run → PASS** (e2e DB-free; the DB-gated spec via `npm run test:db` with Postgres up + the migration applied).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S1 — API app, SubstrateModule, Member endpoints + RBAC + live RLS proof`.

## Task 6: Club Grass skin (design-system)

**Files:**
- Create: `layers/design-system/libs/design-system-css/src/skins/skin-club-grass.css`
- Test: the design-system `skin-lint` (asserts a skin only redeclares existing base vars)

- [ ] **Step 1: Write/extend the failing check** — add `skin-club-grass.css` to the skin-lint target's input; it must pass skin-lint (only override existing `tokens.css` vars).
- [ ] **Step 2: Run → FAIL** (skin missing).
- [ ] **Step 3: Implement** — map the handoff "Club Grass" palette onto existing design tokens ONLY: `--color-bg` ← paper `#F5F3EC`, `--color-ink`/text ← `#1C2520`, `--color-accent` ← grass green, plus the phase colors where a matching token exists. Do NOT invent new variable names (skin-lint fails otherwise — ADR-170). Run the design-system build + skin-lint.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** (design-system repo, own PR) — `feat(design-system): Club Grass skin for the kids-football MVP`.

> **NOTE:** This touches the design-system repo (separate from exercir) — it is its own commit/PR/publish. The exercir UI (Task 7) consumes it once published, or references the skin file directly in dev.

## Task 7: Sign-in + shell + team switcher + Members admin page (Club Grass UI)

**Files:**
- Create: `libs/pack-kids-football-ui/` (project.json) + `src/lib/auth/sign-in-page.component.ts`, `src/lib/shell/kf-shell.component.ts` (+ team switcher), `src/lib/admin/members-page.component.ts`, `src/lib/data/kids-football-api.client.ts` (HTTP + JWT interceptor)
- Create: `libs/pack-kids-football/src/routes.ts` (tenant-scoped) + mount in `apps/pack-football-visual-editor/src/app/app.routes.ts` at `/t/:tenant/p/kids-football/...`
- Test: component specs (sign-in submits + stores JWT; members-page lists/creates via the client; team switcher re-scopes)

- [ ] **Step 1: Write the failing tests** — sign-in form (reactive, CVA per `/reactive-forms-cva-governance`) posts credentials → stores the returned token → routes to the shell; the members admin page (Club Grass styled) lists members from the API client and creates one via a modal form; the team switcher (signal) changes the active team and re-scopes the roster. a11y: 24px targets, focus-management on modal open/close, enabled-submit, live count (per the drill-library a11y MUST-FIX patterns in memory).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** — standalone Angular components + signals; the API client attaches the JWT header + `x-tenant-id`/`x-pack-id`; the shell applies the Club Grass skin; reactive forms + design-system bricks; routes tenant-scoped (`/t/:tenant/p/kids-football/admin/members`). Mirror the FCWorkspace shell (`libs/pack-football-ui/src/lib/shell/fc-workspace.routes.ts`) for the role-guarded multi-view structure.
- [ ] **Step 4: Run → PASS.** Then `npm run ci:local` (full, green).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S1 — sign-in, shell, team switcher, Members admin (Club Grass)`.

## Task 8: Slice gate + push
- [ ] **Step 1:** `npm run ci:local` green; `npm run test:db` green (RLS isolation).
- [ ] **Step 2:** Manually run the API + UI (`/t/<club>/p/kids-football/admin/members`): sign in as club-admin, create/edit/delete a member, confirm it persists per-club (a second club can't see it). Screenshot the Club Grass Members page.
- [ ] **Step 3:** push `feat/kids-football-s1-foundation`, open the PR (`Producer:`/`Effort:`/`Effect:`), verifier wave (+ `exercir-charter-checker`), twin ritual.

---

## Self-review notes (author)
- **Spec coverage:** design §3 architecture → Tasks 1,5; §4 data model → Task 2 (+ JSONB); §6 Club Grass → Task 6; §8 slice-1 (Members of Members/Teams/Resources) → Tasks 3–5,7. **Deviation:** Teams + Resources CRUD deferred to **slice 1b** (mirror the proven Member vertical) so slice 1 is a walking skeleton, not a big-bang. **Correction:** builds on substrate `^1.0.0` (exercir's pin), not 2.0.0 (the MVP needs no inference; mixing runtime majors in one workspace is risky) — revisit on exercir's 2.0 migration.
- **Type consistency:** `KF_ROLES`/`KF_PERMISSIONS`/`PACK_KIDS_FOOTBALL_MANIFEST` and the `Member` shape are defined in Task 1 and reused verbatim in Tasks 3–5,7. The repository CONTRACT (Task 3) is the single suite both impls satisfy (Tasks 3,4).
- **No fat kernel:** zero kernel/inference; substrate used only for auth + tenant/RLS. The 8 entities are pack tables; JSONB for flexible shapes.
