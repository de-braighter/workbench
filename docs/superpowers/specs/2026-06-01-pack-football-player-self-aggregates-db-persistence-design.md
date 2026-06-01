# Pack-football player-self DB persistence — slice 1 (flat aggregates) technical design

- **Date:** 2026-06-01
- **Domain:** exercir / pack-football
- **Epic:** [exercir#142](https://github.com/de-braighter/exercir/issues/142) — ADR-202 TenantRunner pack-CRUD fan-out
- **Resolves:** OQ-5 (the per-player-value / training-projection backing decision) for the **player-self** port — **slice 1 of N** (the three flat aggregate reads)
- **Parent concept:** `layers/specs/concepts/substrate/pack-football-persistence-reconciliation.md` §5 (player-self row), §9 OQ-5
- **Builds on:** `docs/superpowers/specs/2026-06-01-pack-football-player-trait-db-persistence-design.md` (the derived-rollup-snapshot pattern, shipped as exercir#161 — ADR-202 fan-out port #4)
- **Status:** approved (brainstorm), pending implementation plan

## 1. Problem

The ADR-202 fan-out (epic #142) ports the in-memory pack-football repositories onto
DB-backed adapters. **player-self** (port #5) is the largest remaining in-memory port:
`PlayerSelfRepository` is a single out-port backing **six** heterogeneous reads —
`findForm`, `findWeekStats`, `findRecentSessions`, `findWeeklyBlocks`, `findACWR`,
`findMatchDay` — plus the RBAC primitives `personExists` / `findPersonTenantId` and the
`currentWeekISO()` clock. Its backing tables died with `services/exercir-service` in the
2026-05-25 cluster migration, so it was blocked on the concept's **Open Question 5**.

**OQ-5 was resolved Option B** (add pack projection tables now; founder, 2026-06-01) and
shipped for player-trait (exercir#161). This spec applies the same resolution to
player-self, **sliced** to the three flat per-person aggregate reads:

- `findForm` → `MyFormDTO`
- `findWeekStats(weekISO)` → `MyWeekStatsDTO`
- `findACWR` → `MyACWRDTO`

The list/nested reads (`findRecentSessions`, `findWeeklyBlocks`, `findMatchDay`) are
**out of scope** here and land in follow-on specs (§9). Because `PLAYER_SELF_REPOSITORY` is
one symbol bound to one adapter, the slice ships as a **composite adapter** (§5): DB for
the three sliced reads + the RBAC primitives, an in-memory delegate for the deferred reads
— the lineup-port precedent (exercir#149).

### 1.1 Key finding that shapes the design

As with player-trait (its spec §1.1), the player-self read services (`GetMyFormService`,
`GetMyWeekStatsService`, `GetMyACWRService`) **contain no computation** — each resolves the
target tenant (`findPersonTenantId`), runs the `authorizeSelfRead` gate, then returns the
repository's pre-built DTO. The "projection over training sessions" never existed as code;
the aggregates were always synthetic fixtures. So Option B does **not** mean resurrecting
session storage + form/ACWR/week-stats math (that is the observation-backbone, Option A).
It means storing the **derived rollup the port already returns** — a near 1:1 table↔DTO fit.

### 1.2 The RBAC model the schema must honour

Every read calls `findPersonTenantId(personRef)` → `authorizeSelfRead(principal, personRef,
targetTenantId)` (`application/player-self/authorize.ts`), which rejects unless
`personRef.kind === 'person'`, `personRef.id === principal.personId`, **and**
`targetTenantId === principal.tenantId`. The `principal.tenantId` is the **org tenant**
(a uuid, e.g. `SEEDED_FC_LANGGASSE_TENANT_ID`) — distinct from the `tenant_pack_id` that
RLS-scopes the `football.*` tables. So the DB path must resolve a person→org-tenant mapping
that is **RLS-safe**: under the principal's `tenant_pack_id` GUC, a person seeded in a
different tenant-pack is hidden → `findPersonTenantId` returns `null` → `authorizeSelfRead`
yields `cross-tenant-read` (no information leak). `findPersonTenantId` must therefore be
**DB-backed** on the DB path — authorizing against an in-memory identity while reading DB
data would be incoherent.

## 2. The shared snapshot-table pattern (reused from player-trait §2)

The same **derived-rollup snapshot** conventions apply: `tenant_pack_id` (snake) under the
standard football `pack_isolation` + `pack_isolation_write` RLS policy keyed on the
`app.tenant_pack_id` GUC + `GRANT … TO app`; a `computed_at` honesty stamp where the DTO
carries one; **read-only adapters** (no write port — the seed populates today, the
observation backbone later); the in-memory double remains the **flag-off demo default**, the
Prisma adapter binds under the umbrella `PACK_FOOTBALL_PACK_CRUD_DB` flag.

### 2.1 The ADR-176 tension — explicit and bounded (same ruling as player-trait)

Persisting derived state is a documented exception to ADR-176's "store generators, derive
graphs", which is **kernel-scoped** (§4 governs *kernel* state, not what a pack caches in
its own schema; charter-checker SANCTIONED this for exercir#161). It is scoped to the
prototype and bounded by: synthetic-data-only fixtures (charter D2/D3/R12); the
`computed_at` stamp making staleness legible; and the standing intent that the observation
backbone (Option A) supersedes these tables. This spec is a bridge, not the destination.

### 2.2 What is new vs player-trait

- **Person-scoped identity + RBAC** (§1.2) — a dedicated `player_self_person` registry table
  is the identity/authorization anchor, decoupled from the metric tables.
- **A composite adapter** (§5) — the port is partially DB-backed; deferred reads delegate to
  a composed in-memory double.
- **Nested data** — the ACWR `trail` (a ≤28-point daily time series) is a **JSONB** column
  (a child table is overkill for a read-only display series).
- **Display-instant fidelity** — `computedAt` is an ISO-8601 string **with offset**
  (`2026-05-17T12:00:00+02:00`) the contract asserts byte-for-byte. A `timestamptz` column
  normalises to UTC and drops the offset, so `computed_at` is stored as **text** holding the
  literal display string. The backbone would store a real instant; the snapshot stores what
  the port returns.

## 3. Schema — four tables

`prisma/packs/football.prisma`. All four carry `tenantPackId String @map("tenant_pack_id")`
+ `@@schema("football")` and get the canonical two RLS policies + GRANT in the migration
(§3.5). Column physical names: `tenant_pack_id` is `@map`'d (snake); all other columns are
unmapped camelCase (`personId`, `weekIso`, `computedAt`, …) — mirroring `player_trait_value`.

### 3.1 `player_self_person` — identity / RBAC anchor

```prisma
/// Player-self identity + binding anchor (OQ-5 Option B slice 1). The RBAC
/// source for personExists / findPersonTenantId — RLS-safe: a person in a
/// foreign tenant-pack is hidden, so findPersonTenantId returns null and
/// authorizeSelfRead yields cross-tenant-read. `tenantId` is the ORG tenant
/// (≠ tenant_pack_id); `teamId` is null for the no-team-binding state the
/// deferred recent-sessions read uses. Derived-snapshot ADR-176 exception (§2.1).
model PlayerSelfPerson {
  id           String  @id @default(cuid())
  tenantPackId String  @map("tenant_pack_id")
  personId     String  // person uuid (= squad player id, ADR-150 string FK)
  tenantId     String  // ORG tenant uuid, returned by findPersonTenantId
  teamId       String? // null => no-team-binding (deferred recent-sessions read)

  @@unique([tenantPackId, personId])
  @@index([tenantPackId])
  @@map("player_self_person")
  @@schema("football")
}
```

### 3.2 `player_self_form` — `MyFormDTO`

```prisma
/// Per-player form snapshot (MyFormDTO). One row per person. Float for the
/// 0..100 / sRPE-minute metrics (seed values are integral; Float gives backbone
/// headroom). `computedAt` stored as text to preserve the ISO+offset display
/// string. Derived-snapshot ADR-176 exception (§2.1).
model PlayerSelfForm {
  id           String  @id @default(cuid())
  tenantPackId String  @map("tenant_pack_id")
  personId     String
  formIndex    Float   // 0..100
  formTrend    String  // up | down | flat
  load7d       Float   // rolling 7-day sRPE-minutes
  acwr         Float?  // null when chronic baseline missing
  rpeLatest    Float?  // Borg CR10 1..10; null when no recent session
  computedAt   String  // ISO-8601 with offset (display instant)

  @@unique([tenantPackId, personId])
  @@index([tenantPackId])
  @@map("player_self_form")
  @@schema("football")
}
```

### 3.3 `player_self_week_stats` — `MyWeekStatsDTO`

```prisma
/// Per-player weekly stats snapshot (MyWeekStatsDTO). One row per person per
/// ISO week. Int columns mirror the DTO's z.number().int() fields; the two
/// fractions are Float?. Derived-snapshot ADR-176 exception (§2.1).
model PlayerSelfWeekStats {
  id                  String  @id @default(cuid())
  tenantPackId        String  @map("tenant_pack_id")
  personId            String
  weekIso             String  // YYYY-Www
  sessionsCompleted   Int
  sessionsScheduled   Int
  minutesPlayed       Int
  sprintCount         Int
  passAccuracyPressed Float?  // [0,1]
  vmaxKmh             Float?

  @@unique([tenantPackId, personId, weekIso])
  @@index([tenantPackId])
  @@index([tenantPackId, personId])
  @@map("player_self_week_stats")
  @@schema("football")
}
```

### 3.4 `player_self_acwr` — `MyACWRDTO`

```prisma
/// Per-player ACWR snapshot (MyACWRDTO). One row per person. The target band
/// tuple is two Float columns; the ≤28-point daily trail is JSONB (read-only
/// display series). `computedAt` text for ISO+offset fidelity. Derived-snapshot
/// ADR-176 exception (§2.1).
model PlayerSelfAcwr {
  id                 String  @id @default(cuid())
  tenantPackId       String  @map("tenant_pack_id")
  personId           String
  acuteSrpeMinutes   Float
  chronicSrpeMinutes Float
  ratio              Float?  // null at cold-start (chronic = 0)
  targetBandLow      Float
  targetBandHigh     Float
  trail              Json    // DailyLoadPoint[] { date 'YYYY-MM-DD', loadSrpeMinutes } oldest→newest
  computedAt         String  // ISO-8601 with offset (display instant)

  @@unique([tenantPackId, personId])
  @@index([tenantPackId])
  @@map("player_self_acwr")
  @@schema("football")
}
```

### 3.5 Migration

One hand-authored migration `<ts>_add_player_self_aggregates` (NOT `migrate dev`),
mirroring `20260601120000_add_player_trait_value`: four `CREATE TABLE` blocks (TEXT/cuid
columns, `tenant_pack_id` snake, `Float`→`DOUBLE PRECISION`, `Int`→`INTEGER`, `Json`→`JSONB`,
the text `computedAt`), then for **each** table: ENABLE + FORCE ROW LEVEL SECURITY, a
`<table>_tenant_pack_isolation` USING policy + a `<table>_tenant_pack_isolation_write` FOR
INSERT WITH CHECK policy on `current_setting('app.tenant_pack_id', true)`, and
`GRANT SELECT, INSERT, UPDATE, DELETE … TO app`. Index names follow Prisma's
mapped-first-then-field convention; verify ≤63 chars and zero football drift via
`prisma migrate diff` on the manual DB lane (the longest, `player_self_week_stats_tenant_pack_id_personId_idx`, is well under 63).

## 4. Shared seed + mappers — `player-self-seed.ts`

A new `libs/pack-football/src/out-ports/player-self-seed.ts` (mirroring `player-trait-seed.ts`)
is the **single source of truth**, extracted from the existing in-memory double's
`buildStuderSeed` / `buildCaprezSeed` / `buildUnboundSeed`. It owns the full fixtures for the
three pilot persons (Studer #23, Caprez #10, the unbound player) **including** the deferred
reads' data (sessions / blocks / match-day), so the composed in-memory double (§5) reads the
same source and the demo stays coherent. It exports:

- The seeded id + tenant constants (`SEEDED_PLAYER_STUDER_ID`, `SEEDED_PLAYER_CAPREZ_ID`,
  `SEEDED_UNBOUND_PLAYER_ID`, `SEEDED_FC_LANGGASSE_TENANT_ID`, `SEEDED_OTHER_CLUB_TENANT_ID`,
  `SEEDED_FC_LANGGASSE_TEAM_ID`) — relocated here and re-exported from
  `in-memory-player-self.repository.ts` for back-compat (the RBAC spec + cross-pack tests
  import them from there).
- Narrow stored row types: `StoredPlayerSelfPerson`, `StoredPlayerSelfForm`,
  `StoredPlayerSelfWeekStats`, `StoredPlayerSelfAcwr`.
- Mappers used by **both** adapters: `toMyFormDTO(row)`, `toMyWeekStatsDTO(row)`,
  `toMyACWRDTO(row)` — each reconstructs `personRef = { kind: 'person', id: personId }`,
  rebuilds `targetBand = [targetBandLow, targetBandHigh]`, and passes `trail` / `computedAt`
  through. (The list/match-day mappers stay in the in-memory double for now.)
- Seed accessors: `seedStoredPlayerSelfPersons()`, `…Forms()`, `…WeekStats()`, `…Acwrs()`
  for the DB seed, and `…For(personId)` helpers for the contract's expected values.

The in-memory double is refactored to construct its `MyFormDTO` / `MyWeekStatsDTO` /
`MyACWRDTO` via these mappers (so both adapters emit identical shapes), keeping its existing
sessions/blocks/match-day seed for the deferred reads.

## 5. Composite adapter — `PrismaPlayerSelfRepository`

`libs/pack-football/src/out-ports/prisma-player-self.repository.ts`:

- Constructor injects `TENANT_RUNNER` **and** a composed `InMemoryPlayerSelfRepository`
  (`@Inject`ed) as the `fallback` for the deferred reads — the lineup-port composite
  precedent (exercir#149).
- DB-backed (each inside `runner.run(fn)`, RLS-scoped):
  - `personExists(ref)` → `tx.playerSelfPerson.findFirst({ where: { personId: ref.id } }) !== null`.
  - `findPersonTenantId(ref)` → `…findFirst(…)?.tenantId ?? null` (RLS-safe per §1.2).
  - `findForm(ref)` → `tx.playerSelfForm.findFirst({ where: { personId: ref.id } })` →
    `toMyFormDTO` or `null`.
  - `findWeekStats(ref, weekISO)` → `tx.playerSelfWeekStats.findFirst({ where: { personId,
    weekIso: weekISO } })` → `toMyWeekStatsDTO` or `null`. (No re-label-to-requested-week
    quirk — the DB returns the row for the asked week or `null`; the in-memory double's
    re-label is double-specific, like the movement port's `hasPlayer` divergence.)
  - `findACWR(ref)` → `tx.playerSelfAcwr.findFirst({ where: { personId: ref.id } })` →
    `toMyACWRDTO` or `null`.
  - `currentWeekISO()` → the **real** current ISO week (a small `isoWeekOf(new Date())`
    helper). The default-week `getMyWeekStats` path returns `not-found` unless the live week
    is seeded — an accepted prototype limitation, superseded by the backbone (§9).
- Delegated to `fallback` (deferred slices): `findRecentSessions`, `findWeeklyBlocks`,
  `findMatchDay`. The `TenantScopedClient` slice is widened with `playerSelfPerson`,
  `playerSelfForm`, `playerSelfWeekStats`, `playerSelfAcwr` delegates + their row types
  (`tenant-runner.port.ts`), `trail` typed as `unknown`/`Json` and narrowed in the mapper.

## 6. Wiring + seed

- `playerSelfRepositoryProviders(useDb)` in `pack-football.module.ts`, gated on
  `isPackCrudDbFlagEnabled()` (port #5 of the fan-out). On: `PrismaPlayerSelfRepository`
  composed with an `InMemoryPlayerSelfRepository` instance for the fallback; off: the bare
  in-memory double (today's default). Replaces the current unconditional
  `InMemoryPlayerSelfRepository` binding.
- `prisma/seed/football-seed.ts`: `seedPlayerSelf(prisma)` (mirroring `seedPlayerTraits`,
  own tx + GUC via `reseedScoped`, delete-then-insert scoped to the tenant-pack) writes the
  four tables for the three pilot persons from the shared seed. Rows carry
  `tenant_pack_id = SQUAD_TENANT_PACK_ID` (demo RLS scope) and `tenant_id =
  SEEDED_FC_LANGGASSE_TENANT_ID` (the org tenant the demo principal authorises against).

## 7. Testing

- A shared **contract suite** (`player-self-repository.contract.ts`) run against both
  adapters: identical `MyFormDTO` / `MyWeekStatsDTO` (at the **seeded** week, passed
  explicitly) / `MyACWRDTO` for the seeded persons; `personExists` true (seeded) / false
  (unknown id); `findPersonTenantId` returns `SEEDED_FC_LANGGASSE_TENANT_ID` (seeded) / `null`
  (unknown); `findForm`/`findACWR` `null` for an unknown person. The ACWR `trail` equality is
  full and order-sensitive (oldest→newest).
- A **DB-gated tenant-isolation case** (`describe.skipIf(!process.env.SUBSTRATE_APP_DATABASE_URL)`,
  this spec's own distinct tenant-pack uuid) proving a foreign tenant reads `personExists =
  false`, `findPersonTenantId = null`, and `null` from all three reads — mirroring
  `player-trait-repository.spec.ts`.
- Verified on the throwaway-DB lane: empty DB → `db:deploy` → run the gated spec under the
  live-RLS env → confirm `pg_policies` shows the eight `player_self_*` policies;
  `prisma migrate diff` shows zero football drift.
- The composite delegation is unit-tested: the DB adapter's `findRecentSessions` /
  `findWeeklyBlocks` / `findMatchDay` return the fallback double's results.

## 8. Charter compliance

- Synthetic-seed-only fixtures (D2/D3/R12); no real PHI — reuses the existing pseudonymized
  FC Länggasse U19 pilot data already in the in-memory seed.
- DB path behind the default-off `PACK_FOOTBALL_PACK_CRUD_DB` flag (demo-mode governance).
- No external dependency. No kernel change (ADR-176): `football.*` pack tables; the
  derived-state exception is documented + bounded (§2.1).

## 9. Out of scope / follow-ons

- **player-self slice 2** — `findRecentSessions` + `findWeeklyBlocks`: per-person row tables
  (`player_self_session`, `player_self_weekly_block`) reusing this pattern; the
  `no-team-binding` discriminator reads `player_self_person.team_id`. Separate spec.
- **player-self slice 3** — `findMatchDay`: likely derives from the already-DB-backed
  `match_fixture` / `lineup_*` tables (no new table, like funnel). Separate spec.
- **funnel** (port #6) — once player-self + player-trait + player-movement are DB-backed,
  funnel mostly derives; likely no new table. Separate spec.
- The real-clock + live-aggregate semantics (`currentWeekISO` resolving to a seeded week;
  form/ACWR/week-stats computed from sessions) — the observation backbone (OQ-5 Option A),
  substrate-lane, not this spec.

## 10. Acceptance criteria

- [ ] Four models (`PlayerSelfPerson`, `PlayerSelfForm`, `PlayerSelfWeekStats`,
      `PlayerSelfAcwr`) + one hand-authored migration (four tables + `tenant_pack_id` + 8 RLS
      policies + 4 GRANTs); `prisma migrate diff` shows zero football drift.
- [ ] `player-self-seed.ts` shared module + `toMyFormDTO` / `toMyWeekStatsDTO` /
      `toMyACWRDTO` mappers; in-memory double refactored to use them; id/tenant constants
      re-exported for back-compat.
- [ ] `TenantScopedClient` widened with the four `playerSelf*` delegates + row types.
- [ ] `PrismaPlayerSelfRepository` — DB for the three reads + `personExists` /
      `findPersonTenantId` + real-clock `currentWeekISO`; deferred reads delegate to a
      composed in-memory double.
- [ ] Bound under `PACK_FOOTBALL_PACK_CRUD_DB` (composed with the fallback); in-memory
      remains the flag-off default.
- [ ] `db:seed:football` writes the four `player_self_*` tables for the three pilot persons.
- [ ] Shared contract suite (both adapters) + DB-gated isolation spec + composite-delegation
      unit test green; build + DB-free unit suite green.
