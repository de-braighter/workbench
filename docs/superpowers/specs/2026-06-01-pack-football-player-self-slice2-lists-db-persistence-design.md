# Pack-football player-self DB persistence — slice 2 (recent-sessions + weekly-blocks) technical design

- **Date:** 2026-06-01
- **Domain:** exercir / pack-football
- **Epic:** [exercir#142](https://github.com/de-braighter/exercir/issues/142) — ADR-202 TenantRunner pack-CRUD fan-out
- **Resolves:** OQ-5 (Option B) for the player-self port — **slice 2 of N** (the two list reads)
- **Builds on:** `docs/superpowers/specs/2026-06-01-pack-football-player-self-aggregates-db-persistence-design.md` (slice 1 — the composite adapter + `player_self_person` registry, shipped as exercir#163)
- **Status:** approved (brainstorm), pending implementation plan

## 1. Problem

Slice 1 (exercir#163) DB-backed the three flat player-self aggregate reads (form /
week-stats / ACWR) + the RBAC primitives via a **composite** `PrismaPlayerSelfRepository`;
the three list reads (`findRecentSessions`, `findWeeklyBlocks`, `findMatchDay`) delegate to a
composed in-memory double. This slice DB-backs the two list reads that are real per-person
data — `findRecentSessions` + `findWeeklyBlocks` — removing them from the fallback.
`findMatchDay` stays delegated (slice 3 — it derives from the already-DB-backed lineup
tables; no new table).

Same OQ-5 Option-B finding as slice 1: the read services are thin RBAC + passthrough; the
session/block lists were always synthetic fixtures, so Option B = store the rows the port
already returns. Same derived-snapshot pattern + ADR-176 bounded exception (slice-1 spec §2).

## 2. Schema — two row tables

`prisma/packs/football.prisma`, row-per-item like `player_movement_entry`. Both carry
`tenantPackId String @map("tenant_pack_id")` + `@@schema("football")`; `tenant_pack_id` snake,
all other columns unmapped camelCase. `startedAt` is **String** (TEXT) to preserve the
ISO-8601-with-offset display string (a `timestamptz` normalises to UTC and drops the offset
— same fidelity choice as slice-1 `computedAt`).

### 2.1 `player_self_session` — `RecentSessionDTO`

```prisma
/// Per-player recent-session row (RecentSessionDTO). One row per session.
/// Derived-snapshot ADR-176 exception (slice-1 spec §2.1). `startedAt` text for
/// ISO+offset fidelity.
model PlayerSelfSession {
  id              String  @id @default(cuid())
  tenantPackId    String  @map("tenant_pack_id")
  personId        String
  sessionId       String  // RecentSessionDTO.sessionId (uuid)
  kind            String  // training | match
  title           String
  startedAt       String  // ISO-8601 with offset
  durationMinutes Int
  participation   String  // full | partial | observed
  myRpe           Int?    // 1..10 Borg CR10
  myMood          Int?    // 1..5 Likert

  @@unique([tenantPackId, sessionId])
  @@index([tenantPackId])
  @@index([tenantPackId, personId])
  @@map("player_self_session")
  @@schema("football")
}
```

### 2.2 `player_self_weekly_block` — `WeeklyBlockDTO`

```prisma
/// Per-player weekly-block row (WeeklyBlockDTO). One row per block. The week is
/// NOT a storage dimension — the read labels all blocks with the requested week
/// (parity with the in-memory double). Derived-snapshot ADR-176 exception.
model PlayerSelfWeeklyBlock {
  id              String  @id @default(cuid())
  tenantPackId    String  @map("tenant_pack_id")
  personId        String
  blockId         String  // WeeklyBlockDTO.blockId (uuid)
  day             String  // mon | tue | … | sun
  kind            String  // training | match | reha | rest
  title           String
  startedAt       String  // ISO-8601 with offset
  durationMinutes Int
  state           String  // done | now | future

  @@unique([tenantPackId, blockId])
  @@index([tenantPackId])
  @@index([tenantPackId, personId])
  @@map("player_self_weekly_block")
  @@schema("football")
}
```

### 2.3 Migration

Hand-authored `<ts>_add_player_self_lists` mirroring the slice-1 migration: two `CREATE
TABLE` (TEXT/cuid columns, `Int`→`INTEGER`, snake `tenant_pack_id`), each with its
unique + two indexes, ENABLE + FORCE RLS, a `<table>_tenant_pack_isolation` USING policy +
`<table>_tenant_pack_isolation_write` FOR INSERT WITH CHECK policy on
`current_setting('app.tenant_pack_id', true)`, GRANT to `app`. Verify ≤63-char index names
and zero football drift via `prisma migrate diff` on the manual DB lane (longest:
`player_self_weekly_block_tenant_pack_id_personId_idx`, 51 chars).

## 3. Shared seed extension + mappers — `player-self-seed.ts`

Extend the shared module (no new file) with the session/block layer, transcribing the
fixtures from the in-memory double's current `recentSessions` / `weeklyBlocks` (Studer's 4
sessions + 6 blocks, Caprez's 1 + 1, the unbound player's empty lists) — **preserve every
value exactly**. Add:

- `StoredPlayerSelfSession` / `StoredPlayerSelfWeeklyBlock` row types (1:1 with the tables).
- `toRecentSessionDTO(row)` / `toWeeklyBlockDTO(row)` mappers (narrow `kind` / `participation`
  / `day` / `state` to their DTO unions; pass `startedAt` through).
- Seed accessors: `seedStoredPlayerSelfSessions()`, `…WeeklyBlocks()`, and per-player
  `…SessionsFor(personId)` / `…WeeklyBlocksFor(personId)` for the seed + contract expecteds.

The in-memory double refactors to build `findRecentSessions` / `findWeeklyBlocks` from these
accessors + mappers — leaving **only `matchDay`** in its local `DeferredPlayerSeed` map
(slice 3 trims it next). The session **sort + slice** stays in the double exactly as today
(`startedAt` string-descending, then `slice(0, limit)`); the DB adapter replicates it (§4).

## 4. Composite adapter — `prisma-player-self.repository.ts`

DB-back the two list reads (each inside `runner.run`, RLS-scoped); `findMatchDay` stays
delegated to `this.fallback`.

- `findRecentSessions(ref, limit)`:
  - `tx.playerSelfPerson.findFirst({ where: { personId } })` — **null → `{ kind: 'player-not-found' }`**;
  - **`row.teamId === null` → `{ kind: 'no-team-binding' }`** (reuses the slice-1 registry);
  - else `tx.playerSelfSession.findMany({ where: { personId } })` → map via
    `toRecentSessionDTO`, **sort by `startedAt` descending (string compare — identical to the
    in-memory double), `slice(0, limit)`** → `{ kind: 'sessions', value: { personRef, sessions } }`.
- `findWeeklyBlocks(ref, weekISO)`:
  - `tx.playerSelfPerson.findFirst(...)` null → `null`;
  - else `tx.playerSelfWeeklyBlock.findMany({ where: { personId } })` → map →
    `{ personRef, weekISO, blocks }` (the requested `weekISO` is the label; no week filter —
    parity with the in-memory double).
- `TenantScopedClient` widens with `playerSelfSession` + `playerSelfWeeklyBlock` delegates
  (`findMany({ where: { personId } })`) + their row types.

Note on ordering: the session order is meaningful (recent first), so both adapters produce
the same `startedAt`-descending order and the contract asserts the exact ordered list. The
DB adapter sorts in-adapter (string compare) rather than via `orderBy`, to guarantee
byte-identical order with the double regardless of Postgres collation.

## 5. Wiring + seed

- No module change — the slice-1 `playerSelfRepositoryProviders` already binds the composite
  adapter under `PACK_FOOTBALL_PACK_CRUD_DB`.
- `prisma/seed/football-seed.ts`: extend `seedPlayerSelf` to also delete-then-insert
  `player_self_session` + `player_self_weekly_block` (child→parent order alongside the
  existing four) from `seedStoredPlayerSelfSessions()` / `…WeeklyBlocks()`.

## 6. Testing

- Extend the shared **contract suite** (`player-self-repository.contract.ts`): for a seeded
  bound player (Studer) `findRecentSessions` returns the exact `startedAt`-descending session
  list and `findWeeklyBlocks` returns the exact blocks; **the unbound seeded player →
  `findRecentSessions` = `{ kind: 'no-team-binding' }`**; an unknown id →
  `{ kind: 'player-not-found' }` and `findWeeklyBlocks` = `null`.
- Extend the **DB-gated** block to seed the two new tables (under the spec's own tenant-pack)
  and run the extended contract + a foreign-tenant isolation assertion (foreign tenant →
  `player-not-found` / `null`).
- The DB-free **composite-delegation** test shrinks to cover only `findMatchDay` (the last
  delegated read) + `currentWeekISO`.
- `prisma migrate diff` zero football drift; `pg_policies` shows the four new policies.

## 7. Charter compliance

Synthetic-seed-only fixtures (D2/D3/R12), no real PHI — reuses the existing pseudonymized FC
Länggasse session/block fixtures. DB path behind the default-off `PACK_FOOTBALL_PACK_CRUD_DB`
flag. No external dependency. No kernel change (ADR-176 bounded pack-local exception).

## 8. Out of scope / follow-ons

- **player-self slice 3** — `findMatchDay`: derives from the already-DB-backed
  `match_fixture` / `lineup_*` tables (likely no new table); the last delegated read. Separate
  spec.
- club (OQ-3) + reha (OQ-2) — founder decisions, separate.

## 9. Acceptance criteria

- [ ] `PlayerSelfSession` + `PlayerSelfWeeklyBlock` models + hand-authored migration (2 tables
      + 4 RLS policies + 2 GRANTs); `prisma migrate diff` zero football drift.
- [ ] `player-self-seed.ts` extended with the two `Stored*` types + `toRecentSessionDTO` /
      `toWeeklyBlockDTO` mappers + accessors; in-memory double refactored onto them (only
      `matchDay` stays local).
- [ ] `TenantScopedClient` widened with `playerSelfSession` + `playerSelfWeeklyBlock`
      delegates.
- [ ] composite adapter DB-backs `findRecentSessions` (3-way discriminator + sort/slice) +
      `findWeeklyBlocks`; `findMatchDay` stays delegated.
- [ ] `seedPlayerSelf` writes the two new tables.
- [ ] extended contract (incl. no-team-binding) + DB-gated isolation + shrunk delegation test
      green; build + DB-free suite green.
