# Pack-football player-trait DB persistence — technical design

- **Date:** 2026-06-01
- **Domain:** exercir / pack-football
- **Epic:** [exercir#142](https://github.com/de-braighter/exercir/issues/142) — ADR-202 TenantRunner pack-CRUD fan-out
- **Resolves:** OQ-5 (the per-player-value / training-projection backing decision) for the **player-trait** port
- **Parent concept:** `layers/specs/concepts/substrate/pack-football-persistence-reconciliation.md` §5 (player-trait row), §9 OQ-5
- **Status:** approved (brainstorm), pending implementation plan

## 1. Problem

The ADR-202 fan-out (epic #142) ported the cleanly-fannable pack-football repositories
onto DB-backed adapters (squad, injuries, player-movement, lineup). Five in-memory ports
remained. Three of them — **player-trait**, **player-self**, **funnel** — are blocked on
the concept's **Open Question 5**: their data is *derived* (posteriors / training
projections) and lost its backing table when `services/exercir-service` was deleted in
the 2026-05-25 cluster migration.

`PlayerTraitRepository` exposes one method:

```ts
findByPlayerId(playerId: string): Promise<PlayerTraitProfile | null>;
// PlayerTraitProfile { playerId, position: PositionClusterKey,
//                      ageBand: 'U15'|'U17'|'U19'|'senior',
//                      traits: { traitKey, label, value }[] }
```

`value` is "the player's posterior median on the 0..100 scale" — a **per-player posterior
cache** with no table. The `football.trait_cluster_entry` table holds only *reference
distributions* (p50/p90 by position/trait/ageBand), not per-player values, and the port
exposes no reference-overlay read. So player-trait cannot fan out without resolving where
the per-player value lives.

**Decision (founder, 2026-06-01): OQ-5 → Option B** — add pack projection tables now,
rather than wait for the observation/event backbone (Option A). This spec scopes Option B
to **player-trait only** (the keystone: smallest surface, and it is funnel's core input);
player-self and funnel are follow-on specs that reuse the pattern established here.

### 1.1 Key finding that shapes the design

The player-self/player-trait read services (`GetMyFormService`, etc.) **contain no
computation** — they are thin RBAC + passthrough to `repo.find*()`, which returns
pre-built seeded DTOs. The "projections over `TrainingSession`" never existed as code; the
values were always synthetic fixtures. Therefore Option B does **not** mean resurrecting
training-session storage and writing form/ACWR/posterior formulas (that is the
observation-backbone, i.e. Option A, work). It means storing the **derived rollup the port
already returns** — a near 1:1 table↔DTO fit with no new domain logic.

## 2. The shared snapshot-table pattern (established here)

A **derived-rollup snapshot** table holds values that are conceptually derived but have no
live generator yet. Conventions (reused by the player-self and funnel follow-on specs):

- `tenant_pack_id` (snake_case, per the §0 column convention merged in exercir#158) under
  RLS — the standard football `pack_isolation` + `pack_isolation_write` policy keyed on the
  `app.tenant_pack_id` GUC; `GRANT … TO app`.
- A `computed_at` timestamp marking snapshot freshness — honesty about the cached nature.
- **Read-only adapter.** No write port: the snapshot is populated by `db:seed:football`
  today and by the observation/event backbone later. No pack application code writes it.
- The in-memory double remains the **flag-off demo default** (ADR-202 test-double parity);
  the Prisma adapter binds under the umbrella `PACK_FOOTBALL_PACK_CRUD_DB` flag.

### 2.1 The ADR-176 tension — explicit and bounded

Persisting derived state is a documented exception to ADR-176's "store generators, derive
graphs." It is **scoped to the prototype** and bounded by: synthetic-data-only fixtures
(charter D2/D3/R12); the `computed_at` stamp making the snapshot's staleness legible; and
the standing intent that the observation backbone (Option A) supersedes these tables when
it lands — at which point the snapshot is either fed by the backbone or replaced by a
derived read. This spec is the bridge, not the destination.

## 3. Schema — one new table

`prisma/packs/football.prisma`:

```prisma
/// Per-player trait posterior snapshot (OQ-5 Option B; derived-rollup
/// snapshot pattern). Holds the per-player `value` the PlayerTraitRepository
/// returns — derived state with no live generator yet, populated by the seed
/// today and the observation backbone later. `label` is NOT stored (it is
/// catalog data keyed by traitKey — see TRAIT_LABEL). Grain matches
/// player_movement_entry (per-player, per-trait rows).
model PlayerTraitValue {
  id           String   @id @default(cuid())
  tenantPackId String   @map("tenant_pack_id")
  playerId     String                 // logical FK → football.player.id (ADR-150 string FK)
  position     String                 // PositionClusterKey (6er / 10er / IV / …)
  ageBand      String                 // U15 | U17 | U19 | senior
  traitKey     String                 // sport-science.trait.* (ADR-164 Commitment 3)
  value        Float                  // posterior median, 0..100
  computedAt   DateTime @default(now())

  @@unique([tenantPackId, playerId, traitKey])
  @@index([tenantPackId])
  @@index([tenantPackId, playerId])
  @@map("player_trait_value")
  @@schema("football")
}
```

Notes:
- `value Float` — `PlayerTraitRow.value` is `number`; Float gives headroom for a real
  fractional posterior median when the backbone lands. The in-memory seed currently rounds
  (`Math.round(bar * 100)`); stored as `66.0`, which compares equal to the in-memory `66`
  in the contract suite.
- `position` / `ageBand` denormalized per row (functionally a stable per-player attribute;
  acceptable for a snapshot — the flat row-per-trait grain mirrors `player_movement_entry`
  and keeps the read a single `findMany` with no join).
- New hand-authored migration `<ts>_add_player_trait_value` mirroring
  `20260530215947_add_football_player`: `CREATE TABLE` + `tenant_pack_id` snake column +
  the two RLS policies + `GRANT SELECT, INSERT, UPDATE, DELETE … TO app`. The unique index
  enforces one snapshot row per (tenant, player, trait).

## 4. Catalog addition — `TRAIT_LABEL`

`label` (German domain term, e.g. "Schnelligkeit") is a property of the `traitKey`, not of
the player — it currently lives only inline in the in-memory seed. Add a catalog constant
to `libs/pack-football/src/manifest/`:

```ts
export const TRAIT_LABEL: Record<TraitKey, string> = {
  'sport-science.trait.speed': 'Schnelligkeit',
  'sport-science.trait.agility': 'Agilität',
  'sport-science.trait.technique': 'Technik',
  'sport-science.trait.repsprint': 'Wiederholungssprints',
  'sport-science.trait.gameiq': 'Spielverständnis',
};
```

Both adapters resolve `label` from `TRAIT_LABEL`; the in-memory seed is refactored to drop
its inline `label` and use the constant. Label stops being per-row table data.

## 5. Adapter — `PrismaPlayerTraitRepository`

`libs/pack-football/src/out-ports/prisma-player-trait.repository.ts`:

- Injects only `TENANT_RUNNER` (the §7 shared request-scoped runner). Every query runs
  inside `runner.run(fn)` so RLS scoping is provable in the adapter.
- `findByPlayerId(playerId)`:
  `runner.run(tx => tx.playerTraitValue.findMany({ where: { playerId } }))` →
  if zero rows, return `null` (player not seeded) → else group rows into a
  `PlayerTraitProfile` (`position`/`ageBand` from the first row; `traits[]` mapped per row
  with `label` from `TRAIT_LABEL`, `value` from the row).
- Add a `playerTraitValue` delegate (`findMany({ where: { playerId } })`) and a
  `TenantScopedPlayerTraitValueRow` to `TenantScopedClient` in `tenant-runner.port.ts`,
  matching the narrow-structural-slice style of the existing delegates.
- A shared `toPlayerTraitProfile(rows)` mapper in a new `player-trait-seed.ts` module
  (mirroring `player-movement-seed.ts`), used by **both** the Prisma adapter and the
  in-memory double, so both emit an identical profile shape and pass one contract suite.
  All rows for a given player carry the same `position`/`ageBand` (per-player constant), so
  the mapper reads them from the first row.

## 6. Wiring + seed

- Bind `PrismaPlayerTraitRepository` to `PLAYER_TRAIT_REPOSITORY` inside `PackFootballModule`
  only when the umbrella `PACK_FOOTBALL_PACK_CRUD_DB` flag is on; the in-memory double is the
  flag-off default (ADR-202 §5.2 / the §7 generalization landed in exercir#143).
- `prisma/seed/football-seed.ts`: write `player_trait_value` rows for the four pilot players
  (Studer / Caprez / Roduit / Camenzind) using the same fixture values the in-memory seed
  carries, so both adapters return identical profiles. Tenant-scoped DELETE-then-insert for
  re-run stability, using the snake `"tenant_pack_id"` column (per the §0 convention).

## 7. Testing

- A shared **contract suite** (`player-trait-repository.contract.ts`) exercised against both
  the in-memory and Prisma adapters, asserting identical `PlayerTraitProfile` output for the
  seeded players + `null` for an unseeded player.
- A **DB-gated tenant-isolation case** (`describe.skipIf(!process.env.SUBSTRATE_APP_DATABASE_URL)`)
  proving a different tenant cannot read another tenant's trait rows under RLS — mirroring
  `player-movement-repository.spec.ts`.
- Verified via the throwaway-DB lane used for exercir#158: provision an empty DB →
  `db:deploy` → run the gated spec under the live-RLS env → confirm `pg_policies` shows the
  two `player_trait_value` policies. `prisma migrate diff` (shadow) must show zero football
  drift after the migration.

## 8. Charter compliance

- Synthetic-seed-only fixtures (D2/D3/R12); no real PHI. The new table is structure; the
  seed reuses the existing pseudonymized pilot-player data.
- DB path behind the default-off `PACK_FOOTBALL_PACK_CRUD_DB` flag (demo-mode governance).
- No external dependency. No kernel change (ADR-176): this is a `football.*` pack table; the
  derived-state exception is documented and bounded (§2.1).

## 9. Out of scope / follow-ons

- **player-self** (port #5) — the five derived reads (form / week-stats / recent-sessions /
  weekly-blocks / ACWR-with-trail) get their own snapshot tables reusing §2's pattern. The
  `PlayerGoal` / `PlayerTodo` tables already exist but have **no port consumer** and are not
  wired here. Separate spec.
- **funnel** (port #6) — once `player_trait_value` exists, funnel *derives* from it +
  `player_movement_entry` (already DB-backed); its presentation-only fields (resources,
  insights) have no source and stay synthetic. Likely no new table. Separate spec.
- The observation/event backbone (OQ-5 Option A) that would eventually feed/replace these
  snapshots — substrate-lane, not this spec.

## 10. Acceptance criteria

- [ ] `PlayerTraitValue` model added + hand-authored migration (table + `tenant_pack_id` +
      2 RLS policies + GRANT); `prisma migrate diff` shows zero football drift.
- [ ] `TRAIT_LABEL` catalog constant added; in-memory seed refactored to use it.
- [ ] `PrismaPlayerTraitRepository` + `playerTraitValue` delegate on `TenantScopedClient`;
      shared `toPlayerTraitProfile` mapper.
- [ ] Bound under `PACK_FOOTBALL_PACK_CRUD_DB`; in-memory remains flag-off default.
- [ ] `db:seed:football` writes `player_trait_value` for the four pilot players.
- [ ] Shared contract suite + DB-gated tenant-isolation spec green; build + DB-free unit
      suite green.
