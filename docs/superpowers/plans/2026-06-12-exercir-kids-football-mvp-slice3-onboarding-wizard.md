# Exercir kids-football MVP — Slice 3 (club onboarding wizard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The 5-step club onboarding wizard (Club → Teams → Resources → Weekly slots → Review): a single pre-auth `POST /kids-football/onboarding` provisions a NEW tenant at runtime, seeds the club row (`demo_mode = true`), the admin member + club-admin role grant, teams, resources, optional weekly slots, and the 8-drill starter library; the UI wizard (entered via the dashed "Set up a new club" button on sign-in) signs the creator in as Club admin and lands on the new club's Training slots board.

**Architecture:** Everything lands in the four EXISTING projects (`libs/pack-kids-football-contracts`, `libs/pack-kids-football`, `apps/pack-kids-football-api`, `libs/pack-kids-football-ui`) — no new nx project, no new workspace package.json (lockfile risk ≈ 0). Two NEW pack verticals are deliberately MINIMAL: Club (create + find — no endpoints) and Drill (createMany + list — the seed surface only; drill CRUD is slice 4). The onboarding orchestration is an API-side application service (composition-root territory: it touches the tenant registry instance, role grants, and the request context) that REUSES the existing Create-Member/Team/Resource/Slot use-cases, so all slice-1/2 validation and invariants apply unchanged.

**Tech Stack:** Angular (standalone + signals) + NestJS + Prisma/Postgres, Nx + vitest, `@de-braighter/substrate-{contracts,runtime}@^2.0.0` as already pinned (auth/tenant/RLS surface only — no kernel/inference).

**Repo:** `domains/exercir`. **Branch:** cut `feat/kids-football-s3-onboarding` off `origin/main` in a **fresh worktree** `domains/exercir-wt-kf-s3`, then `npm ci` (then `npm ls @de-braighter/substrate-runtime` must show 2.x — the main clone's node_modules is stale at 1.0.0; the lockfile is correct). **Gate:** `npm run ci:local` + `npm run test:db` (live RLS proof extended to the NEW `drill` table + the now-written `club` table → 6 tables). **Design source of truth:** `domains/exercir/docs/design/exercir-mvp-handoff/README.md` — screen 2 "Club onboarding wizard" + screen 1 "Sign-in" (the dashed button). Prototype references: `docs/design/exercir-mvp-handoff/exercir/proto/auth.jsx` (the wizard, the `build()` payload assembly) + `proto-app.jsx:6-64` (the 8 starter drills).

---

## Design decisions (resolved at plan time — pinned)

### D-1. Runtime club creation = runtime tenant registration (the substrate 2.0.0 surface)

Verified against the published `@de-braighter/substrate-runtime@2.0.0` source (`layers/substrate/libs/substrate-runtime/src/`):

- `TenantRegistry` (the interface behind `TENANT_REGISTRY`) is **read-only** — `isTenantRegistered` / `isPackEnabledForTenant` / `getDescriptor` / `resolveTenantPackId`, no register method. `InMemoryTenantRegistry` is frozen at construction.
- `SubstrateModule.forRoot` accepts an **explicit `tenantRegistry?: TenantRegistry` instance** with highest binding precedence (`substrate.module.ts:317`, factory at `:1751-1761`).
- `TenantPackContextGuard` consults the registry **fresh per request** (no boot cache) — a tenant added to the registry instance after boot is immediately routable.
- `TenantDescriptor` = `{tenantId, displayName, registeredPacks}` — **no demo_mode field, no metadata field**.

**Decision: an exercir-side `MutableStubTenantRegistry`** (API config, ~40 lines) implementing the published `TenantRegistry` interface by **delegating every read to a rebuilt `InMemoryTenantRegistry` snapshot** — `register(descriptor)` appends and re-snapshots. Delegation guarantees IDENTICAL resolution semantics (incl. tenantPackId derivation) with zero copied kernel logic. The instance is passed to `forRoot({ tenantRegistry })` (replacing `tenants: STUB_CLUBS` — the instance is SEEDED with `STUB_CLUBS`, so the stub clubs keep working) and provided under a local DI symbol so the onboarding service can call `register()`.

**Demo-honest limitation, pinned in code doc + this plan:** the registry is process-local. An API restart loses created tenants (in-memory mode also loses their data; on the DB path the ROWS persist but the tenant resolution does not, so the rows become unreachable until re-provisioned). Accepted at prototype volume. The named production upgrade seam (NOT built here): `provisionTenant()` + `PrismaTenantRegistry` over `core.tenant`/`core.tenant_pack` (both already shipped in substrate 2.0.0).

**Pre-auth gating, pinned:** club creation happens before any session exists. The onboarding endpoint is an **open demo endpoint**: `@Public()` (exported by substrate-runtime; `CompositeAuthGuard` short-circuits on `IS_PUBLIC_KEY`) + NO `@RequiresPermission` (PolicyGuard passes undecorated routes — `policy.guard.ts:80`). This is explicitly acceptable for the prototype: the endpoint can only create fresh demo tenants (`demo_mode = true`, below), never touch existing ones, and validates its full payload before any side effect.

### D-2. The demo_mode anchor FIRES in this slice (charter §2 D7)

The charter (`layers/specs/concepts/charter/prototype-assumptions-charter.md`, pin **D7** "no-real-outbound-payrexx-sandbox") pins the demo-mode facet as `tenant.demo_mode = true` + outbound-block. A tenant-creation path is exactly where the long-deferred anchor lands. Since `TenantDescriptor` cannot carry it (D-1), the anchor lives **pack-side, on the club row** (ADR-176: pack representation belongs in the pack):

- `kids_football.club` gains `demo_mode BOOLEAN NOT NULL DEFAULT true`; `ClubSchema` gains `demoMode: z.boolean()`.
- The wizard **always** creates clubs with `demoMode: true` — no UI toggle, no API override field (the request schema has no demoMode key).
- Doc-comment anchors (in `ClubSchema`, the club migration, and `KidsFootballOnboardingService`) state: *any future outbound path (invite emails are the first candidate) MUST check `club.demoMode` and block/sandbox outbound when true (charter §2 D7).* 
- The wizard's invite-emails textarea is **mocked, period**: the textarea content is **never sent to the API** (the request schema has no invites field) — nothing to block because nothing leaves the browser.
- The wave prompt for `exercir-charter-checker` names this design explicitly.

### D-3. The 8-drill starter library: pull the drill TABLE forward, not drill CRUD

Decided by what slice 4 actually needs: slice 4 (drill library + editor + sketcher) needs the `drill` table with the full handoff shape regardless, and on the **DB path clubs created in slice 3 persist** — stubbing the seed would create a slice-4 backfill problem for real rows. The handoff data model pins the drill shape exactly (so schema risk is low), and the prototype carries the 8 starter drills verbatim (`proto-app.jsx:6-64`).

In scope: contracts `DrillSchema` (+ sketch-element union), `kids_football.drill` table + RLS, `DRILL_REPOSITORY` port with **`createMany` + `list` ONLY** (the seed surface), the `STARTER_DRILLS` fixture (8 drills ported 1:1), seeded by the onboarding service. **NOT in scope** (slice 4): drill update/delete, drill HTTP endpoints, drill permissions in the manifest, any drill UI. The review step's "Starter drills — 8 included" card reads `STARTER_DRILLS.length` from the shared contracts fixture.

### D-4. exercir#245 (F1 event-log posture) — extend the doc-comment posture

The wizard's create path ADDS mutations without F1 event-log writes. Wiring the substrate event-log port is a posture decision #245 tracks; this slice **extends #245's documented posture to the new services** (`KidsFootballOnboardingService`, the Club/Drill repos) via the same doc-comment convention the slice-2 services carry, and the PR body says so. #245 stays open.

### Other pinned deviations from the prototype

- **Enabled-submit (a11y MUST-FIX, drill-arc convention):** Continue / Create club stay ENABLED; clicking with an invalid step surfaces inline errors and focuses the first invalid field. (The prototype disables Continue.) Row "Add" buttons likewise stay enabled and validate on click.
- **Resource defaults:** prototype `build()` sets `surface: "Grass"` flat; we map `type === 'Gym hall' → surface 'Indoor'`, else `'Grass'` (a Grass gym hall is nonsense data). `status: 'Available'`, `note` omitted — faithful otherwise.
- **Wizard slot rows reference teams/resources by INDEX** (they have no ids yet — prototype-faithful); the server resolves indexes to the created UUIDs and then calls the EXISTING `CreateSlotUseCase` (which re-validates via `CreateSlotInputSchema` + existence checks).
- **Team colors are server-assigned** `KF_TEAM_COLORS[i % 6]` (prototype `P_TEAM_COLORS[i % …]`); the wizard composes its team payload from `TeamSchema.omit({id, color})`.
- **Sign-in for a created club after sign-out shows an empty picker** (DEMO_USERS is static — the new admin is NOT in it; the create response carries the session identity instead). An empty-state line + the dashed button keep the page functional. Re-entry after sign-out = create a new club or use a stub club (demo posture, pinned).

---

## Pre-flight (read before Task 1)

The implementer of each task must read the slice-1/2 reference files for its layer and mirror their structure (adapt names, do NOT copy comments verbatim):

- **Vertical pattern (now-in-repo, slice 2):** `libs/pack-kids-football/src/out-ports/team.repository.ts` + `…/slot.repository.ts` (port + in-memory with `activeTenant()` resolver + optional shared-store ctor param + `structuredClone` boundaries) · `…/team.repository.contract.ts` + `…/slot.repository.contract.ts` (the portable contract suites incl. tenant-isolation cases) · `src/application/create-slot.service.ts` (`Result<T,E>`, referential validation) · `src/out-adapters/prisma-slot.repository.ts` (TENANT_RUNNER-only injection, `runner.run` everywhere, GUC read-back create, count-0 semantics) · `src/out-ports/tenant-runner.port.ts` (delegate types to extend per entity).
- **Migration shape:** `prisma/migrations/20260612120000_kids_football_slot/migration.sql` (ENABLE+FORCE RLS, `::text`-cast USING + INSERT WITH CHECK + explicit FOR UPDATE policy, guarded grant DO blocks) + `prisma/packs/kids-football.prisma`.
- **API composition:** `apps/pack-kids-football-api/src/app/pack-kids-football.module.ts` (generic `inMemoryRepoProviders<T>`, the single `ACTIVE_TENANT_FN` provider — register it ONCE, `SHARED_*_STORE_MAP`, seeds) · `…/pack-kids-football-auth.bootstrap.ts` (`PACK_KF_CONTROLLERS`, `grantIfAbsent` — the grant call the onboarding service mirrors) · `…/config/stub-clubs.ts` · `…/slots.e2e.spec.ts` (e2e harness) · `…/rls.integration.spec.ts` (DB-gated proof to extend).
- **Substrate 2.0.0 surface (in the worktree's node_modules after `npm ci`, or source at `layers/substrate/libs/substrate-runtime/src/`):** `tenant-registry/tenant-registry.ts` (TenantRegistry interface + TenantDescriptorSchema) · `tenant-registry/in-memory-tenant.registry.ts` (the snapshot impl we delegate to) · `context-guards/public.decorator.ts` (+ `composite-auth.guard.ts` `@Public` short-circuit) · `context-guards/tenant-pack-context.guard.ts:37-48` (`TenantPackContext` = `{tenantId, packId, userId, requestId, tenantPackId}`).
- **UI patterns (now-in-repo, slice 2):** `libs/pack-kids-football-ui/src/lib/auth/sign-in-page.component.ts` (the page the dashed button lands on; `selectUser` → `KfSessionService.signIn` → navigate) · `lib/data/kf-session.service.ts` (`KfSession` shape) · `lib/data/kids-football-api.client.ts` (`buildHeaders` — note it THROWS without a session; the wizard needs a sessionless call) · `lib/data/kf-slot-time.ts` (`HALF_HOUR_OPTIONS`, `fmtHour`, `DOW_FULL`) · `lib/admin/club-admin-shell.component.ts` (`tabLink` absolute-array pattern + paramMap fallback chain) · `lib/admin/slots-page.component.ts` (modal focus + form patterns) · `lib/a11y/kf-modal-focus.ts` · `lib/kf-i18n.ts` · `lib/routes.ts` · `lib/shell/auth.guard.ts` (the `/setup` route must NOT carry it).
- **Prototype:** `docs/design/exercir-mvp-handoff/exercir/proto/auth.jsx` (wizard layout, step gating, `build()`) + `proto-app.jsx:6-64` (starter drills).

**Battle-tested gotchas to honor (slices 1+2 memory):** browser run-through catches what unit layers can't — initial store loads + per-endpoint response shapes; kill any orphan :3150 holder before serving (`Get-NetTCPConnection -LocalPort 3150`); `toSignal(control.valueChanges)` not `computed()` over `control.value`; absolute `['/t', tenant, …]` routerLink arrays via the paramMap fallback chain (never relative); nullable scalars round-trip as plain `null`, only Json columns reject it; ONE `ACTIVE_TENANT_FN` provider per module; new-schema/table grants need the guarded DO block; no workspace package.json change expected — if one happens, re-run `npm install` and commit the lockfile in the same commit; post-findings uses the FULL `de-braighter/exercir#NN` form and the Write tool for JSON (PowerShell BOM breaks it).

## File structure (created/modified in this slice)

| File | Responsibility | Task |
|---|---|---|
| `libs/pack-kids-football-contracts/src/entities.ts` (+ spec) · `src/drills.ts` (NEW: DrillSchema + STARTER_DRILLS) (+ spec) · `src/onboarding.ts` (NEW: CreateClubRequest/Response) (+ spec) · `src/index.ts` | Club demoMode, Drill contract, starter fixture, wizard wire schemas, `KF_TEAM_COLORS` | 1 |
| `prisma/packs/kids-football.prisma` (Club.demoMode + Drill model) + `prisma/migrations/20260612200000_kids_football_onboarding/migration.sql` + `out-adapters/prisma-schema-shape.spec.ts` | club demo_mode column + drill table + RLS | 2 |
| `libs/pack-kids-football/src/out-ports/club.repository.{ts,contract.ts,spec.ts}` · `…/drill.repository.{ts,contract.ts,spec.ts}` · `src/out-adapters/prisma-club.repository.ts` + `prisma-drill.repository.ts` (+ contract specs) · `tenant-runner.port.ts` (club + drill delegates) · `src/index.ts` | Club + Drill minimal verticals (one contract suite, two impls each) | 3 |
| `apps/pack-kids-football-api/src/config/mutable-stub-tenant.registry.ts` (+ spec) · `src/app/app.module.ts` (forRoot swap + registry provider) | Runtime-registrable tenant registry | 4 |
| `apps/pack-kids-football-api/src/app/onboarding.service.ts` (+ spec) · `…/onboarding.controller.ts` · `…/onboarding.e2e.spec.ts` · `pack-kids-football.module.ts` (club/drill providers + stores) · `pack-kids-football-auth.bootstrap.ts` (controller list) · `rls.integration.spec.ts` (club + drill proofs) | Pre-auth onboarding endpoint orchestrating the full seed | 5 |
| `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (+ spec) — `createClub` sessionless · `lib/auth/sign-in-page.component.ts` (+ spec) — dashed button + empty state · `lib/routes.ts` (`setup` route) · `kf-i18n.ts` | Wizard entry + sessionless client call | 6 |
| `libs/pack-kids-football-ui/src/lib/onboarding/onboarding-draft.service.ts` (+ spec) · `lib/onboarding/onboarding-wizard.component.ts` (+ spec) · `kf-i18n.ts` | Draft store + wizard shell (progress bar, step engine, step 1) | 7 |
| `lib/onboarding/onboarding-wizard.component.ts` (steps 2–4 templates + handlers, + spec cases) | Teams / Resources / Weekly-slots steps | 8 |
| `lib/onboarding/onboarding-wizard.component.ts` (review + submit, + spec cases) | Review step, create→session→navigate | 9 |
| — | Slice gate, browser run-through, story issue, PR, wave, ritual | 10 |

---

## Task 1: Contracts — Club demoMode, Drill schema, starter fixture, onboarding wire schemas

**Files:**
- Modify: `libs/pack-kids-football-contracts/src/entities.ts` (+ `entities.spec.ts`), `src/index.ts`
- Create: `libs/pack-kids-football-contracts/src/drills.ts`, `…/drills.spec.ts`, `src/onboarding.ts`, `…/onboarding.spec.ts`

- [ ] **Step 1: Write the failing specs.**
  - `entities.spec.ts`: `ClubSchema` now parses `{id: uuid, clubName, demoMode: true}` and REJECTS a missing `demoMode`; `KF_TEAM_COLORS` has the 6 handoff palette entries in order.
  - `drills.spec.ts`: a full drill (use STARTER_DRILLS[2] "Passing Gates" — it exercises all three sketch element kinds) parses; bad phase / intensity 6 / sketch element with unknown `t` rejected; `STARTER_DRILLS.length === 8`; every fixture entry parses against `DrillSchema.omit({id: true})`; names match the prototype list (`Traffic Lights` … `Cool-down & Review`).
  - `onboarding.spec.ts`: a valid request (2 teams, 2 resources, 1 slot referencing indexes 0/1) parses; empty `teams` / empty `resources` rejected; slot with `end <= start`, non-half-hour start, `resourceIndex` out of bounds, `teamIndex` out of bounds each rejected; request with an extra `demoMode` or `invites` key is STRIPPED (zod default) — assert the parsed output has no such keys; `CreateClubResponseSchema` round-trips.
- [ ] **Step 2: Run → FAIL** (`npx vitest run libs/pack-kids-football-contracts`).
- [ ] **Step 3: Implement.**

  `entities.ts` — extend ClubSchema (the demo_mode anchor; keep the doc comment):

```ts
/**
 * demoMode is the charter §2 D7 demo-mode anchor (prototype-assumptions-charter):
 * clubs created at runtime default to demo_mode = true; any future OUTBOUND path
 * (invite emails are the first candidate) MUST check club.demoMode and block or
 * sandbox outbound when true. There is deliberately no API field to set it false.
 */
export const ClubSchema = z.object({
  id: z.string(),
  clubName: z.string().min(1),
  demoMode: z.boolean(),
});

/** Handoff team palette — wizard-created teams get KF_TEAM_COLORS[i % 6]. */
export const KF_TEAM_COLORS = [
  '#2F8A4E', '#4C9BD6', '#E8A93C', '#9C8DC9', '#D4683B', '#3C7C8C',
] as const;
```

  `drills.ts` — schema + fixture:

```ts
export const KF_DRILL_PHASES = ['Warm-up', 'Technical', 'Game', 'Cool-down'] as const;

const SketchPointSchema = z.object({
  t: z.enum(['player', 'opp', 'cone', 'ball']),
  x: z.number(), y: z.number(),
  n: z.number().int().optional(),
});
const SketchArrowSchema = z.object({
  t: z.enum(['pass', 'run']),
  x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(),
});
const SketchZoneSchema = z.object({
  t: z.literal('zone'),
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
});
export const DrillSketchElementSchema = z.union([
  SketchZoneSchema, SketchArrowSchema, SketchPointSchema,
]);

export const DrillSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  focus: z.string().min(1),
  phase: z.enum(KF_DRILL_PHASES),
  age: z.enum(KF_TEAM_AGE_BANDS),
  /** Planned minutes. */
  min: z.number().int().min(1),
  players: z.string(),
  equipment: z.array(z.string()),
  intensity: z.number().int().min(1).max(5),
  organisation: z.string(),
  /** Coaching points. */
  points: z.array(z.string()),
  /** The expected effect — the product differentiator (plain pack data, design §5). */
  effect: z.string(),
  /** 860×560 coordinate space (handoff data model). */
  sketch: z.array(DrillSketchElementSchema),
});
export type Drill = z.infer<typeof DrillSchema>;
export type DrillSketchElement = z.infer<typeof DrillSketchElementSchema>;

/**
 * The 8-drill starter library the onboarding wizard seeds (design §8 slice 3).
 * Ported 1:1 from the validated prototype, docs/design/exercir-mvp-handoff/
 * exercir/proto/proto-app.jsx lines 6-64 — names, focus, phase, age, min,
 * players, intensity, equipment, organisation, points, effect, and sketch
 * arrays VERBATIM; only the prototype's numeric `id` is dropped (ids are
 * generated at seed time). Slice 4's drill library builds on this same data.
 */
export const STARTER_DRILLS: readonly Omit<Drill, 'id'>[] = [
  {
    name: 'Traffic Lights', focus: 'Ball mastery', phase: 'Warm-up', age: 'U9',
    min: 10, players: 'Any', intensity: 2, equipment: ['Cones', 'Balls'],
    organisation: 'Every player with a ball inside the grid. Coach calls colors: green = dribble, amber = toe-taps on the ball, red = stop dead with sole on ball.',
    points: ['Soft touches, ball close', 'Eyes up while dribbling'],
    effect: 'Players keep the ball within one step at all times; fewer giveaways from heavy first touches in games.',
    sketch: [
      { t: 'zone', x: 200, y: 110, w: 460, h: 340 },
      { t: 'player', x: 300, y: 200, n: 1 }, { t: 'player', x: 430, y: 310, n: 2 },
      { t: 'player', x: 560, y: 190, n: 3 },
      { t: 'ball', x: 322, y: 212 }, { t: 'ball', x: 452, y: 322 }, { t: 'ball', x: 582, y: 202 },
    ],
  },
  // … the remaining 7 drills ported the same way from proto-app.jsx:13-63
  // (Sharks & Minnows, Passing Gates, Rondo 4v1, 1v1 to Mini Goals,
  //  Shooting Ladder, 4v4 Small-Sided Game, Cool-down & Review) —
  // copy each field verbatim; drop `id`.
];
```

  `onboarding.ts` — wire schemas COMPOSED from the existing entity schemas:

```ts
import { KF_RESOURCE_TYPES, ResourceSchema, TeamSchema } from './entities.js';

/** Step-2 team rows: name + age; color is server-assigned (KF_TEAM_COLORS[i % 6]). */
const OnboardingTeamSchema = TeamSchema.omit({ id: true, color: true });
/** Step-3 resource rows: name + type; surface/status/note are server defaults. */
const OnboardingResourceSchema = ResourceSchema.omit({
  id: true, surface: true, status: true, note: true,
});
/**
 * Step-4 weekly slot rows reference teams/resources by ARRAY INDEX (they have
 * no ids before creation — prototype-faithful). The server resolves indexes to
 * created UUIDs, then funnels through the existing CreateSlotUseCase (which
 * re-validates via CreateSlotInputSchema + referential checks).
 */
const OnboardingSlotSchema = z.object({
  dow: z.number().int().min(1).max(7),
  start: z.number().min(0).max(24),
  end: z.number().min(0).max(24),
  resourceIndex: z.number().int().min(0),
  teamIndex: z.number().int().min(0),
});

export const CreateClubRequestSchema = z
  .object({
    clubName: z.string().trim().min(1),
    adminName: z.string().trim().min(1),
    teams: z.array(OnboardingTeamSchema).min(1),
    resources: z.array(OnboardingResourceSchema).min(1),
    slots: z.array(OnboardingSlotSchema).default([]),
    // NOTE deliberately ABSENT: demoMode (server-forced true, charter D7) and
    // invites (the review-step textarea is mocked — content never leaves the browser).
  })
  .superRefine((req, ctx) => {
    req.slots.forEach((s, i) => {
      if (s.end <= s.start)
        ctx.addIssue({ code: 'custom', message: `slots[${i}]: end must be after start` });
      if (s.start % 0.5 !== 0 || s.end % 0.5 !== 0)
        ctx.addIssue({ code: 'custom', message: `slots[${i}]: 30-minute steps` });
      if (s.resourceIndex >= req.resources.length)
        ctx.addIssue({ code: 'custom', message: `slots[${i}]: resourceIndex out of bounds` });
      if (s.teamIndex >= req.teams.length)
        ctx.addIssue({ code: 'custom', message: `slots[${i}]: teamIndex out of bounds` });
    });
  });
export type CreateClubRequest = z.infer<typeof CreateClubRequestSchema>;

export const CreateClubResponseSchema = z.object({
  tenantId: z.string().uuid(),
  clubName: z.string(),
  demoMode: z.literal(true),
  admin: z.object({ userId: z.string().uuid(), name: z.string() }),
  seeded: z.object({
    teams: z.number().int(), resources: z.number().int(),
    slots: z.number().int(), drills: z.number().int(),
  }),
});
export type CreateClubResponse = z.infer<typeof CreateClubResponseSchema>;
```

  Export everything from `src/index.ts`. If any existing code consumed the old 1-field `ClubSchema`, fix it in this pass (grep `ClubSchema` — slice 1 defined it but nothing consumes it yet).
- [ ] **Step 4: Run → PASS** (`npx nx run-many -t lint test --projects=pack-kids-football-contracts`).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S3 — Club demoMode anchor, Drill contract + 8-drill starter fixture, onboarding wire schemas`.

## Task 2: Prisma — club demo_mode column + drill table + RLS migration

**Files:**
- Modify: `prisma/packs/kids-football.prisma`, `libs/pack-kids-football/src/out-adapters/prisma-schema-shape.spec.ts`
- Create: `prisma/migrations/20260612200000_kids_football_onboarding/migration.sql`

- [ ] **Step 1: Write the failing test** — extend the schema-shape spec: the generated client's `club` model exposes `demoMode`; a `drill` model exists with `tenantPackId/name/focus/phase/age/min/players/intensity/equipment/organisation/points/effect/sketch`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** `Club` gains `demoMode Boolean @default(true) @map("demo_mode")` (doc comment cites charter §2 D7 — see Task 1's ClubSchema comment). New model (JSONB for the flexible shapes per design §4; `min` is safe as a column name in PG only when quoted by Prisma — it maps cleanly; keep it):

```prisma
/// A training drill. Slice 3 creates this table for the onboarding starter
/// library (seed-only: createMany + list); drill CRUD + editor arrive in
/// slice 4. equipment/points/sketch are JSONB per the pack-representation
/// boundary (design §4, ADR-176).
model Drill {
  id           String   @id @default(uuid()) @db.Uuid
  tenantPackId String   @map("tenant_pack_id") @db.Uuid
  name         String
  focus        String
  phase        String
  age          String
  min          Int
  players      String
  intensity    Int
  equipment    Json     @default("[]")
  organisation String
  points       Json     @default("[]")
  effect       String
  sketch       Json     @default("[]")
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  @@index([tenantPackId])
  @@map("drill")
  @@schema("kids_football")
}
```

  Migration `20260612200000_kids_football_onboarding/migration.sql` mirrors the slot migration (`20260612120000_kids_football_slot`) for one table + one ALTER:
  1. `ALTER TABLE "kids_football"."club" ADD COLUMN "demo_mode" BOOLEAN NOT NULL DEFAULT true;` (comment: charter §2 D7 anchor).
  2. `CREATE TABLE "kids_football"."drill" (…)` with all columns above; the `@@index`.
  3. `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`; `drill_tenant_pack_isolation` USING + `drill_tenant_pack_isolation_write` FOR INSERT WITH CHECK + `drill_tenant_pack_isolation_update` FOR UPDATE USING+WITH CHECK (the slice-2 in-place-update convention — slice 4 updates drills; add the policy NOW so no RLS migration is needed then), all on `"tenant_pack_id"::text = current_setting('app.tenant_pack_id', true)`.
  4. The guarded DO block re-granting `USAGE ON SCHEMA kids_football` + `GRANT SELECT, INSERT, UPDATE, DELETE ON "kids_football"."drill" TO app` behind the `pg_roles` existence check.

  `npm run db:generate`; `npx prisma validate --schema=./prisma`.
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S3 — club.demo_mode anchor column + drill table + RLS migration`.

## Task 3: Club + Drill minimal verticals (one contract suite, two impls each)

**Files:**
- Create: `libs/pack-kids-football/src/out-ports/club.repository.ts`, `…/club.repository.contract.ts`, `…/club.repository.spec.ts`, `…/drill.repository.ts`, `…/drill.repository.contract.ts`, `…/drill.repository.spec.ts`
- Create: `libs/pack-kids-football/src/out-adapters/prisma-club.repository.ts`, `…/prisma-club.repository.contract.spec.ts`, `…/prisma-drill.repository.ts`, `…/prisma-drill.repository.contract.spec.ts`
- Modify: `out-ports/tenant-runner.port.ts` (club + drill delegate types on `TenantScopedClient`), `out-adapters/testing/stub-delegates.ts`, `src/index.ts`

These verticals are DELIBERATELY narrower than Member/Team/Resource/Slot — they exist to serve the onboarding seed (and slice-4's read side). No use-case services in the pack lib (the API-side onboarding service orchestrates), no update/delete.

```ts
// club.repository.ts
export type CreateClubInput = Omit<Club, 'id'>;
export interface ClubRepository {
  /** The tenant's club row, or null before onboarding. One club per tenant-pack (demo model). */
  find(): Promise<Club | null>;
  create(input: CreateClubInput): Promise<Club>;
}
export const CLUB_REPOSITORY = Symbol('CLUB_REPOSITORY');

// drill.repository.ts
export type CreateDrillInput = Omit<Drill, 'id'>;
export interface DrillRepository {
  list(): Promise<readonly Drill[]>;
  /** Bulk insert (the starter-library seed). Returns the created drills in input order. */
  createMany(inputs: readonly CreateDrillInput[]): Promise<readonly Drill[]>;
}
export const DRILL_REPOSITORY = Symbol('DRILL_REPOSITORY');
```

- [ ] **Step 1: Write the failing contract suites** mirroring `team.repository.contract.ts`'s structure with the reduced surface. Club cases: `find()` null when empty; create returns id + `demoMode` round-trips `true` AND `false` (the column default must not mask the written value); find returns the created club; tenant isolation (A's club invisible under B; B's `find()` null); mutation isolation (`structuredClone` boundary). Drill cases: empty list; `createMany(STARTER_DRILLS)` returns 8 with distinct ids, list returns them in insertion order with `sketch`/`equipment`/`points` arrays deep-equal to the fixture (JSONB round-trip); `createMany([])` returns `[]` and writes nothing; tenant isolation read; mutation isolation. Run each suite against the in-memory impl AND the Prisma adapter (fake GUC-runner harness, same pattern as `prisma-slot.repository.contract.spec.ts`).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** `InMemoryClubRepository` / `InMemoryDrillRepository` (same `activeTenant()` + optional shared-store ctor + `structuredClone` at boundaries) and `PrismaClubRepository` / `PrismaDrillRepository` (inject only `TENANT_RUNNER`; every query in `runner.run(fn)`; GUC read-back for parentless creates; drill `createMany` loops `tx.drill.create` inside ONE `runner.run` call — input order preserved, ids returned; Json columns get the arrays directly — never `null`). Extend `TenantScopedClient` with `club` + `drill` delegate types; extend the stub delegates. **Carry the #245 posture doc comment** (same wording convention as the slice-2 services) on both repos' create paths.
- [ ] **Step 4: Run → PASS** (`npx nx run-many -t lint test --projects=pack-kids-football`).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S3 — Club + Drill seed verticals (one contract suite, two impls each)`.

## Task 4: MutableStubTenantRegistry + forRoot swap

**Files:**
- Create: `apps/pack-kids-football-api/src/config/mutable-stub-tenant.registry.ts`, `…/mutable-stub-tenant.registry.spec.ts`
- Modify: `apps/pack-kids-football-api/src/app/app.module.ts`

- [ ] **Step 1: Write the failing spec.** Construct with `STUB_CLUBS`: both stub tenants resolve (`isTenantRegistered`, `resolveTenantPackId(id, 'kids-football')` non-null, `getDescriptor` matches); an unknown tenant does not. After `register({tenantId: <fresh uuid>, displayName: 'SV Test', registeredPacks: ['kids-football']})`: the new tenant resolves with a non-null tenantPackId DIFFERENT from both stubs', and the stubs STILL resolve to their previous tenantPackIds (snapshot rebuild preserves derivation). `register` with an already-registered tenantId is a no-op (idempotent — descriptor unchanged). `register` with a descriptor failing `TenantDescriptorSchema` throws.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement:**

```ts
import {
  InMemoryTenantRegistry,
  TenantDescriptorSchema,
  type TenantDescriptor,
  type TenantRegistry,
} from '@de-braighter/substrate-runtime';

/**
 * MutableStubTenantRegistry — the published TenantRegistry interface with ONE
 * exercir-side addition: register() (runtime club onboarding, slice 3).
 *
 * Every READ delegates to a rebuilt InMemoryTenantRegistry snapshot, so the
 * resolution semantics (incl. tenantPackId derivation) are IDENTICAL to the
 * substrate's own in-memory implementation — zero copied kernel logic. The
 * TenantPackContextGuard consults the registry per request (no boot cache), so
 * a registered tenant is immediately routable.
 *
 * PINNED PROTOTYPE LIMITATION: process-local. An API restart loses runtime
 * registrations (in-memory mode also loses their data; on the DB path the rows
 * persist but become unreachable until re-provisioned). Production upgrade
 * seam (not built): substrate provisionTenant() + PrismaTenantRegistry over
 * core.tenant / core.tenant_pack.
 */
export class MutableStubTenantRegistry implements TenantRegistry {
  private tenants: TenantDescriptor[];
  private inner: InMemoryTenantRegistry;

  constructor(seed: readonly TenantDescriptor[]) {
    this.tenants = [...seed];
    this.inner = new InMemoryTenantRegistry(this.tenants);
  }

  /** Registers a tenant at runtime. Idempotent by tenantId. Validates the descriptor. */
  register(descriptor: TenantDescriptor): void {
    const parsed = TenantDescriptorSchema.parse(descriptor);
    if (this.tenants.some((t) => t.tenantId === parsed.tenantId)) return;
    this.tenants = [...this.tenants, parsed];
    this.inner = new InMemoryTenantRegistry(this.tenants);
  }

  isTenantRegistered(tenantId: string): Promise<boolean> {
    return this.inner.isTenantRegistered(tenantId);
  }
  isPackEnabledForTenant(tenantId: string, packId: string): Promise<boolean> {
    return this.inner.isPackEnabledForTenant(tenantId, packId);
  }
  getDescriptor(tenantId: string): Promise<TenantDescriptor | null> {
    return this.inner.getDescriptor(tenantId);
  }
  resolveTenantPackId(tenantId: string, packId: string): Promise<string | null> {
    return this.inner.resolveTenantPackId(tenantId, packId);
  }
}

/** DI token for the mutable registry instance (the onboarding service injects it). */
export const KF_MUTABLE_TENANT_REGISTRY = Symbol('KF_MUTABLE_TENANT_REGISTRY');
```

  (If `InMemoryTenantRegistry` exposes additional optional interface members in 2.0.0 — check `tenant-registry.ts` — delegate those too.) `app.module.ts`: build ONE module-level instance `const kfTenantRegistry = new MutableStubTenantRegistry(STUB_CLUBS);`, pass `tenantRegistry: kfTenantRegistry` to `SubstrateModule.forRoot` (REPLACING the `tenants: STUB_CLUBS` line — precedence makes both redundant), and add `{ provide: KF_MUTABLE_TENANT_REGISTRY, useValue: kfTenantRegistry }` to AppModule providers.
- [ ] **Step 4: Run → PASS** — `npx nx test pack-kids-football-api` (the full existing e2e corpus is the regression proof that the registry swap is behavior-identical for the stub clubs).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S3 — runtime-registrable tenant registry on the published TenantRegistry seam`.

## Task 5: Onboarding service + @Public controller + e2e + live RLS proof

**Files:**
- Create: `apps/pack-kids-football-api/src/app/onboarding.service.ts`, `…/onboarding.service.spec.ts`, `…/onboarding.controller.ts`, `…/onboarding.e2e.spec.ts`
- Modify: `pack-kids-football.module.ts` (club + drill repo providers via `inMemoryRepoProviders` / Prisma flag-gate + `SHARED_CLUB_STORE_MAP` + `SHARED_DRILL_STORE_MAP`; export nothing new — the onboarding service lives API-side), `pack-kids-football-auth.bootstrap.ts` (`PACK_KF_CONTROLLERS` + append `KidsFootballOnboardingHttpController`), `src/app/rls.integration.spec.ts`

- [ ] **Step 1: Write the failing tests.**
  - **Service spec** (in-memory repos + a real `MutableStubTenantRegistry` + a recording fake for `PACK_ROLE_ASSIGNMENT_REPOSITORY` + a mutable fake request object): happy path creates — in order — tenant registration, attached `request.tenantPackContext` (assert `{tenantId, packId: 'kids-football', userId: <admin>, tenantPackId}` present BEFORE the first repo write — probe via a wrapped repo), club row `{clubName, demoMode: true}`, admin member `{name, role: 'Club admin', teamIds: [], notes: []}`, `grant` called once with `{tenantPackId, userId: <new uuid>, packKey: 'kids-football', roleId: KF_ROLES.clubAdmin}`, teams with server-assigned colors `KF_TEAM_COLORS[0]`/`[1]`, resources with `surface` mapped (`Gym hall → Indoor`, else `Grass`) + `status 'Available'`, slots resolved from indexes (`recurring: true, date: null`, resourceId/teamId = the created UUIDs), 8 drills (DRILL_REPOSITORY.list() names match STARTER_DRILLS). Returns the `CreateClubResponse` with `seeded: {teams: 2, resources: 2, slots: 1, drills: 8}`. **Validation-first:** an invalid request (empty teams) returns `{ok: false, error: {kind: 'invalid-input'}}` AND the registry has no new tenant + zero grants (no side effect before validation). **Mid-flight failure posture:** if a downstream use-case returns `{ok: false}` the service returns `{ok: false, error: {kind: 'onboarding-failed', detail}}` — doc comment pins the non-atomicity convention (each repo call its own transaction on the DB path; a crash mid-seed orphans a fresh demo tenant, which is harmless — every wizard run mints a new tenantId; same convention as the slice-2 delete cascades).
  - **e2e** (in-memory binding, mirror `slots.e2e.spec.ts` harness): `POST /kids-football/onboarding` with NO identity headers + valid payload → 201, body parses `CreateClubResponseSchema`, `demoMode: true`; follow-up `GET /kids-football/teams` with `x-tenant-id: <returned tenantId>`, `x-user-id: <returned admin.userId>`, `x-pack-id: kids-football` → 200 with the 2 created teams (proves registry + grant + context end-to-end); `GET /kids-football/slots` as the new admin → the slot with resolved ids, `conflictIds: []`; stub-club regression — club A's admin still sees ONLY club A's seeded teams (new club's data invisible); invalid payload (no teams) → 400 `{kind: 'invalid-input'}`; slot `end <= start` → 400.
  - **RLS integration** (`rls.integration.spec.ts`, DB-gated): extend the proof to **club and drill** — insert one row per table under club A's GUC; club B's GUC sees neither and cannot update/delete them (count 0) under the NOBYPASSRLS app role (6 tables total).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.**

  `onboarding.service.ts` (request-scoped — it injects REQUEST and the request-scoped use-cases):

```ts
/**
 * KidsFootballOnboardingService — the slice-3 club-provisioning orchestration.
 *
 * Lives API-SIDE (not in the pack lib) deliberately: tenant provisioning is
 * composition-root territory — it touches the MutableStubTenantRegistry
 * instance, the substrate role-assignment repository, and the request's
 * tenantPackContext. Domain writes are delegated to the EXISTING pack
 * use-cases (CreateMember/Team/Resource/Slot), so slice-1/2 validation and
 * invariants apply unchanged.
 *
 * PRE-AUTH: the endpoint is @Public (no session exists yet). After validating
 * the FULL payload (no side effect before validation) the service registers
 * the new tenant, resolves its tenantPackId, and SELF-ATTACHES the request's
 * tenantPackContext — the same lazy-read seam ACTIVE_TENANT_FN and the KF
 * TENANT_RUNNER consult — so every downstream repo write lands in the new
 * tenant's bucket (in-memory) / RLS scope (DB path).
 *
 * demo_mode (charter §2 D7): created clubs are ALWAYS demoMode: true.
 * F1 event-log posture: like the slice-1/2 CRUD services, these mutations
 * carry no kernel event-log write — tracked in exercir#245.
 * NON-ATOMIC (pinned): each repo call is its own transaction on the DB path; a
 * crash mid-seed orphans a fresh demo tenant (harmless — each run mints a new
 * tenantId; nothing references a partially-seeded tenant).
 */
```

  Flow (each step exactly as spec'd above): `CreateClubRequestSchema.safeParse` → `randomUUID()` tenantId + adminUserId → `registry.register({tenantId, displayName: clubName, registeredPacks: [KIDS_FOOTBALL_PACK_KEY]})` → `tenantPackId = await registry.resolveTenantPackId(tenantId, KIDS_FOOTBALL_PACK_KEY)` (null → `onboarding-failed`) → attach `request.tenantPackContext = {tenantId, packId: KIDS_FOOTBALL_PACK_KEY, userId: adminUserId, requestId: randomUUID(), tenantPackId}` → `clubRepo.create({clubName, demoMode: true})` → `roleAssignments.grant({tenantPackId, userId: adminUserId, packKey: KIDS_FOOTBALL_PACK_KEY, roleId: KF_ROLES.clubAdmin})` (a fresh tenant cannot have prior grants — plain `grant`, mirroring the bootstrap's `grantIfAbsent` semantics trivially) → `createMemberUseCase.execute({name: adminName, role: 'Club admin', teamIds: [], notes: []})` → teams in order via `createTeamUseCase` (color `KF_TEAM_COLORS[i % KF_TEAM_COLORS.length]`), collecting ids → resources via `createResourceUseCase` (surface mapping, status `'Available'`), collecting ids → slots via `createSlotUseCase` (`{recurring: true, dow, date: null, start, end, resourceId: resourceIds[s.resourceIndex], teamId: teamIds[s.teamIndex]}`) → `drillRepo.createMany(STARTER_DRILLS)` → response. Any `{ok: false}` from a use-case aborts with `onboarding-failed` (+ the failed step in `detail`).

  `onboarding.controller.ts`:

```ts
@Controller('kids-football/onboarding')
export class KidsFootballOnboardingHttpController {
  constructor(
    @Inject(KidsFootballOnboardingService)
    private readonly onboarding: KidsFootballOnboardingService,
  ) {}

  /**
   * OPEN DEMO ENDPOINT (pinned, design D-1): club creation is pre-auth — no
   * session exists yet. @Public() short-circuits the CompositeAuthGuard; no
   * @RequiresPermission (PolicyGuard passes undecorated routes). The posture
   * guard is demo_mode: the endpoint can only mint fresh demo tenants.
   */
  @Post()
  @Public()
  async createClub(@Body() body: unknown): Promise<unknown> {
    const result = await this.onboarding.createClub(body);
    if (result.ok) return result.value; // Nest default 201
    if (result.error.kind === 'invalid-input')
      throw new HttpException(result.error, HttpStatus.BAD_REQUEST);
    throw new HttpException(result.error, HttpStatus.INTERNAL_SERVER_ERROR);
  }
}
```

  Module wiring: `SHARED_CLUB_STORE_MAP` + `SHARED_DRILL_STORE_MAP` (exported like the others; NO demo seed — stub clubs have no club row until someone onboards, which is correct: nothing reads club rows yet) + `inMemoryRepoProviders(CLUB_REPOSITORY, …)` / `inMemoryRepoProviders(DRILL_REPOSITORY, …)` flag-gated against the Prisma adapters; export `CLUB_REPOSITORY` + `DRILL_REPOSITORY` tokens from `PackKidsFootballModule` so the API-side service resolves them. `KidsFootballOnboardingService` goes in AppModule providers; the controller is appended to `PACK_KF_CONTROLLERS` (it contributes zero decorator permission ids — `collectDecoratorPermissionIds` handles that).
- [ ] **Step 4: Run → PASS** — `npx nx run-many -t test --projects=pack-kids-football,pack-kids-football-api`, then `npm run test:db` with Postgres up (the migration applies; club + drill RLS proofs live).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S3 — pre-auth onboarding endpoint (tenant registration, demo_mode club, admin grant, full seed) + live RLS proof ×6`.

## Task 6: UI — sessionless createClub client + sign-in dashed button + /setup route

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/data/kids-football-api.client.ts` (+ spec), `lib/auth/sign-in-page.component.ts` (+ spec), `lib/routes.ts`, `lib/kf-i18n.ts`, `src/index.ts`

- [ ] **Step 1: Write the failing tests.**
  - Client spec: `createClub(payload)` POSTs to `/kids-football/onboarding` **without identity headers** (assert `x-tenant-id`/`x-user-id` ABSENT — `buildHeaders()` throws without a session, so this method must NOT call it; send only `x-request-id`), parses the response with `CreateClubResponseSchema`, rejects a malformed body. It works with a NULL session (the wizard is pre-auth).
  - Sign-in spec: a dashed "Set up a new club" button renders below the user list (divider + "or" per the handoff), navigates to `['/t', <tenant or 'demo'>, 'p', 'kids-football', 'setup']` on click (absolute array — never relative); when `visibleUsers()` is empty (unknown tenant, e.g. a created club after sign-out) an empty-state line renders (`kf.signIn.empty`) and the dashed button still renders; the stub-club picker is UNCHANGED for known tenants.
  - Routes: `setup` loads `OnboardingWizardComponent`, has NO `authGuard` (pre-auth), sits beside `sign-in`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Client method (plain `HttpHeaders` with only `x-request-id`); sign-in button styled per the handoff (1.5px dashed light border on the ink background, display font, uppercase, height 46 ≥ 24px target, visible focus ring); i18n keys `kf.signIn.or`, `kf.signIn.newClub`, `kf.signIn.empty` (`'No demo profiles for this club — set up a new club below, or use a stub-club URL.'`). The route entry mirrors `sign-in`'s `loadComponent` shape (the wizard component lands in Task 7 — create a minimal placeholder component file in THIS task so the route compiles, containing the component shell only: selector `lib-kf-onboarding-wizard`, empty template `<p>setup</p>`; Task 7 replaces it).
- [ ] **Step 4: Run → PASS** (`npx nx test pack-kids-football-ui`).
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S3 — sessionless onboarding client call + sign-in entry point + /setup route`.

## Task 7: Wizard draft store + shell (progress bar, step engine, step 1)

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/onboarding/onboarding-draft.service.ts`, `…/onboarding-draft.service.spec.ts`
- Modify: `lib/onboarding/onboarding-wizard.component.ts` (replace the Task-6 placeholder) (+ create `…/onboarding-wizard.component.spec.ts`), `lib/kf-i18n.ts`

The wizard is one routed page (paper full-screen, max-width 660 column — NOT inside the shell; it declares the `--cg-*` tokens via `styleUrls: ['../club-grass.css']` on `:host` like the sign-in page; **no global skin load** — ex#246 canonical-not-loaded, the host theme-collision lesson). Decomposition: a component-provided `OnboardingDraftService` holds ALL draft state as signals; the wizard component owns the step engine + templates (step templates stay in the single component file per the existing single-file idiom, but every mutation goes through the draft service so each step's logic is unit-testable without the DOM).

- [ ] **Step 1: Write the failing tests.**
  - Draft service: signals `clubName`, `adminName`, `teams` (`{name, age}[]`), `resources` (`{name, type}[]`), `slots` (`{dow, start, end, resourceIndex, teamIndex}[]`), `invites` (string — never leaves the browser); mutators `addTeam/removeTeam(i)/addResource/removeResource(i)/addSlot/removeSlot(i)`; **removing a resource/team REINDEXES slot rows** (drop slot rows whose `resourceIndex`/`teamIndex` points at the removed entry; decrement higher indexes — spec this hard, it's the index-reference trap); `canNext(step)` computed: step 0 = both names trimmed non-empty; 1 = ≥1 team; 2 = ≥1 resource; 3 = always; `stepErrors(step)` returns the i18n keys for what's missing (the enabled-submit pattern needs them); `toRequest()` assembles the `CreateClubRequest` (trimmed names, NO invites key).
  - Wizard component (stub draft + router): renders the 5-segment progress bar as an `<ol>` with the labels Club / Teams / Resources / Weekly slots / Review, `aria-current="step"` ONLY on the active segment, done segments tinted accent; "← Back to sign in" link (absolute array to `sign-in`); footer Back (hidden on step 0) / Continue (steps 0–3) / Create club (step 4); **enabled-submit**: Continue stays enabled — clicking it on an invalid step does NOT advance, renders the inline error region (`role="alert"`), and focuses the first invalid input; on a VALID advance the step heading (tabindex="-1") receives focus (focus management between steps — a11y MUST-FIX); Back never validates. Step 1 (Club): clubName + adminName inputs (labels per the handoff: "Club name" / "Your name", placeholder "You'll be the club admin"), 40px inputs ≥ 24px targets.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (standalone + signals + OnPush; reactive forms — one `FormGroup` for step 1, `toSignal(control.valueChanges)` for any form-derived signal, NEVER `computed()` over `control.value`; en-only `kf.onboarding.*` strings: `title` "New club setup", `back`, `continue`, `createClub`, `backToSignIn`, `step.club/teams/resources/slots/review`, `club.name`, `club.admin`, `club.adminPlaceholder`, `error.clubName`, `error.adminName`, `error.teamsEmpty`, `error.resourcesEmpty`, plus Task-8/9 keys as they land).
- [ ] **Step 4: Run → PASS**.
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S3 — onboarding wizard shell (segmented progress, enabled-submit step engine, club step)`.

## Task 8: Wizard steps 2–4 (Teams, Resources, Weekly slots)

**Files:**
- Modify: `lib/onboarding/onboarding-wizard.component.ts` (+ spec cases), `lib/kf-i18n.ts`

- [ ] **Step 1: Write the failing tests** (component spec, driving the real draft service).
  - **Teams step**: add-row = name input + age select over `KF_TEAM_AGE_BANDS` (default `'U9'`) + "Add team" button (enabled; on click with empty name → inline row error, no add); added rows render as chip rows with the palette dot (`KF_TEAM_COLORS[i % 6]` — the same color the server will assign), name, age, and a ✕ remove button (≥24px target, `aria-label` "Remove {name}"); removing reindexes/drops dependent slot rows (assert through the draft).
  - **Resources step**: add-row = name + type select over `KF_RESOURCE_TYPES` + Add; rows with name, type, ✕ remove.
  - **Weekly slots step** (optional — hint line "Optional — you can manage these later under Club → Training slots."): add-row selects — Day over `DOW_FULL` (dow 1–7, default Tuesday), From/Until over `HALF_HOUR_OPTIONS` rendered via `fmtHour` (Until options filtered `> start`; defaults 17:00–18:30), Resource + Team selects over the step-2/3 draft entries BY INDEX; Add validates `end > start` + both selects present (with ≥1 resource and ≥1 team guaranteed by step gating, default indexes 0 are valid); rows render `{DOW_FULL[dow-1]} {fmtHour(start)} – {fmtHour(end)} · {resource name} · {team name}` + ✕ remove. Continue from step 3 with zero slots is allowed (`canNext(3)` true).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (reuse `fmtHour`/`HALF_HOUR_OPTIONS`/`DOW_FULL` from `kf-slot-time.ts` — no re-derivation; i18n keys `kf.onboarding.teams.*`, `kf.onboarding.resources.*`, `kf.onboarding.slots.*`).
- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S3 — wizard team/resource/slot steps (index-referenced rows, reindex-on-remove)`.

## Task 9: Wizard review step + create → session → land on the slots board

**Files:**
- Modify: `lib/onboarding/onboarding-wizard.component.ts` (+ spec cases), `lib/kf-i18n.ts`, `src/index.ts` (export the wizard component)

- [ ] **Step 1: Write the failing tests.**
  - **Review step** renders the six summary cards from the draft (Club, Admin, Teams = joined names or —, Resources = joined names or —, "Weekly slots" = `{n} defined`, "Starter drills" = `{STARTER_DRILLS.length} included` — imported from contracts, not hardcoded 8) + the **mocked invite textarea**: label per the handoff ("Invite coaches & staff (emails, one per line — invites are mocked in this prototype)"), bound to `draft.invites`, and the SPEC ASSERTS the submitted payload contains NO invites key (it is a textarea, period — nothing outbound, nothing sent).
  - **Create club** (enabled-submit): on click, calls `client.createClub(draft.toRequest())` (stub client); while pending the button is `aria-disabled` with a busy label; on success calls `KfSessionService.signIn({userId: res.admin.userId, tenantId: res.tenantId, role: 'club-admin', roleLabel: 'Club Admin', teamIds: [], userName: res.admin.name, clubName: res.clubName})` and navigates to `['/t', res.tenantId, 'p', 'kids-football', 'admin', 'slots']` (the new admin is NOT in DEMO_USERS — the create response IS the session identity); on failure renders a `role="alert"` error region via `mapKfError` and does NOT navigate or sign in.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** (i18n `kf.onboarding.review.*` incl. `review.invites.label`, `review.creating`, `error.createFailed`).
- [ ] **Step 4: Run → PASS**, then full `npm run ci:local`.
- [ ] **Step 5: Commit** — `feat(exercir): kids-football S3 — review step + create club → signed-in landing on the slots board`.

## Task 10: Slice gate + browser run-through + story issue + PR

- [ ] **Step 1:** `npm run ci:local` green; `npm run test:db` green (member + team + resource + slot + **club + drill** RLS proofs).
- [ ] **Step 2: Manual browser run-through** (kill any orphan :3150 PID first; API :3150 in-memory mode + host app `pack-football-visual-editor` :4200):
  1. Open `/t/a1b2c3d4-0001-4abc-8001-0000c1ab0001/p/kids-football/sign-in` → stub picker intact (Anna/Bruno/Clara) + the dashed "Set up a new club" button below the divider.
  2. Click it → the wizard. Step 1: "SV Westend Kids" / "Petra Lange". Step 2: add "U9 Wildcats" (U9) + "U11 Lions" (U11). Step 3: add "Pitch 1" (Full pitch) + "Gym hall" (Gym hall). Step 4: add ONE weekly slot — Tuesday 17:00–18:30, Pitch 1, U9 Wildcats. Step 5: review cards show 2/2/1 + "8 included"; type two fake emails in the mocked textarea. **Screenshot the review step → `de-braighter/docs/club-grass-onboarding-review-s3-proof.png`.**
  3. Create club → lands SIGNED IN as Petra Lange (Club Admin) on `/t/<new-tenant>/p/kids-football/admin/slots`: the Tuesday slot card renders with the U9 Wildcats team pill, summary "1 weekly slots · 1.5 h/week". **Screenshot the landed board → `de-braighter/docs/club-grass-onboarding-landed-s3-proof.png`.** Check Teams/Resources tabs show the created rows (Gym hall surface "Indoor"); enabled-submit checks: try Continue on an empty step 1 → inline error + focus, no advance.
  4. Stub-club regression: sign out → back on the NEW tenant's sign-in (empty-state line + dashed button render); navigate to club A's sign-in URL → picker unchanged; sign in as Anna → slice-2 surfaces untouched (members/teams/resources/slots tabs live); club A sees NONE of the new club's data.
- [ ] **Step 3:** Create the story issue on `de-braighter/exercir` (mirror #243's shape: scope bullets + acceptance = this plan's goal, naming the demo_mode anchor + the registry mechanism); push `feat/kids-football-s3-onboarding`; open the PR with `Closes #<story>`, `Producer: orchestrator/claude-fable-5 [subagent-driven-development, writing-plans]`, `Effort: deep`, `Effect: cycle-time 0.01±0.01 expert` + `Effect: findings 5±3 expert`, and a PR-body note: *"F1 event-log posture: extended #245's doc-comment posture to the onboarding service + Club/Drill repos — #245 stays open as the posture tracker."*
- [ ] **Step 4:** Verifier wave (`local-ci` + `reviewer` + `charter-checker` + `exercir-charter-checker` + `qa-engineer`, all `isolation: "worktree"`, prompts forbidding git ops in shared clones, PR head readable in the dedicated worktree). The **exercir-charter-checker prompt must name D-1/D-2 explicitly**: the demo_mode anchor fires in this slice (club.demo_mode default true, no API override, doc anchors per charter §2 D7), the onboarding endpoint is a sanctioned open demo endpoint, and the invite textarea is mocked with nothing outbound. Fix blockers → `npm run dev -- drain de-braighter/exercir#<pr>` → `post-findings` (FULL `de-braighter/exercir#<pr>` form, severities `blocking|should-fix|nit|note`, lines that exist in the diff — re-anchor onto in-diff files if a path drops out) → merge → `backfill` → `reconcile` → `ritual:post-merge`.

---

## Carry-forwards honored (and explicitly NOT in scope)

- **`demo_mode` anchor (charter §2 D7): FIRES HERE** — see design D-2. The first outbound path (real invites) must consume it; none ships in this slice.
- **exercir#245 (F1 event-log):** posture extended to the new services via doc comments; the PR body says so; #245 stays open (design D-4).
- **i18n:** en-only `kf-i18n.ts` extension (`kf.onboarding.*`, `kf.signIn.or/newClub/empty`); de/en split stays tracked, not this slice (ADR-012).
- **Published skin (ex#246):** canonical-not-loaded — the wizard uses the pack's `:host` `--cg-*` literal projection (`club-grass.css`), NO global skin load in the shared host (theme-collision lesson); the parity spec guards the palette.
- **`subjectSensitivity 'developmental-minor'`:** does NOT fire — the wizard surfaces zero inferred player state (club provisioning is logistics). It arms at slice 7/8.
- **Substrate:** ^2.0.0 as pinned, auth/tenant/RLS surface only — the registry seam + `@Public()` are published runtime exports; zero kernel/inference.

## Self-review notes (author)

- **Spec coverage:** design §8 slice-3 row (5-step creation, seeds club + 8-drill starter library, signs creator in as Club admin, lands on Training slots) → Tasks 5–9 + 10.2-3; handoff screen 2 verbatim (segmented labeled progress bar, club+admin step, team name+age chips, resource name+type, optional day/from/until/resource/team slot rows, review cards + mocked invite textarea) → Tasks 7–9; screen 1 dashed button → Task 6; design question 1 (runtime tenant mechanism) → D-1 + Tasks 4–5; design question 2 (starter library) → D-3 + Tasks 1–3; demo_mode anchor → D-2 + Tasks 1, 2, 5; RBAC pre-auth posture pinned → D-1 + Task 5 controller doc; cascading-failure posture → Task 5 service doc (non-atomic, orphan-tenant-harmless convention).
- **Type consistency:** `CLUB_REPOSITORY`/`DRILL_REPOSITORY` + `CreateClubInput`/`CreateDrillInput` defined in Task 3, consumed in Task 5; `CreateClubRequestSchema`/`CreateClubResponseSchema`/`STARTER_DRILLS`/`KF_TEAM_COLORS` defined in Task 1, consumed in Tasks 5 (server), 6 (client parse), 8 (palette dots), 9 (review count); `MutableStubTenantRegistry.register` defined in Task 4, consumed in Task 5; the wizard's slot rows reuse `HALF_HOUR_OPTIONS`/`fmtHour`/`DOW_FULL` from the EXISTING `kf-slot-time.ts` (no new time helpers).
- **Deviations pinned:** enabled-submit (vs prototype's disabled Continue); `Gym hall → Indoor` surface mapping; index-based slot references resolved server-side; server-assigned team colors; invites never transmitted; sign-in empty-state for unknown tenants.
- **No fat kernel:** zero kernel concepts; the tenant-registry seam is the published `forRoot` option + interface; demo_mode lives on the pack's club row (ADR-176 — pack representation in the pack); drills are pack tables + JSONB.
