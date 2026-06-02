# Pack-football player-self DB persistence — slice 3 (match-day) technical design

- **Date:** 2026-06-02
- **Domain:** exercir / pack-football
- **Epic:** [exercir#142](https://github.com/de-braighter/exercir/issues/142) — ADR-202 TenantRunner pack-CRUD fan-out
- **Resolves:** OQ-5 (Option B) for the player-self port — **slice 3 of 3** (the last read; completes the port)
- **Builds on:** the shipped player-self slices 1 (exercir#163) + 2 (exercir#165)
- **Status:** approved (autonomous), pending implementation plan

## 1. Problem

Slices 1–2 DB-backed five of the six player-self reads. `findMatchDay` is the last,
delegated to the composite adapter's internal in-memory double. This slice DB-backs it,
**completing the port** — after which the composite adapter has zero delegated reads.

### 1.1 The derive-vs-snapshot finding (decision: snapshot)

Slice-1 §9 assumed `findMatchDay` would *derive* from the already-DB-backed lineup tables
(`match_fixture` / `lineup_*` / `match_briefing`). On inspection it **cannot, for parity**:
the in-memory `matchDay` is a standalone synthetic blob — `homeClub: 'FC Aarau U19'`,
`awayClub: 'FC Länggasse U19'` (an *away* match), specific briefing prose — whose values do
**not** match the lineup-port's seeded fixture/briefing rows (and those seeds can't change
without breaking the lineup port's tests). A derive adapter would diverge from the in-memory
output, breaking test-double parity. Unlike funnel (which composed *nothing*), `matchDay`
**is** genuine per-person data (Studer's bench slot vs Caprez's starter/captain slot), so it
belongs in a per-tenant table. Decision: a **snapshot table**, consistent with slices 1–2
(store the DTO the port already returns). Same bounded ADR-176 exception (slice-1 §2.1).

## 2. Schema — one table

`prisma/packs/football.prisma`. Carries `tenantPackId String @map("tenant_pack_id")` +
`@@schema("football")`; `tenant_pack_id` snake, all other columns camelCase. `kickoffAt` /
`acknowledgedAt` are **String** (TEXT) for ISO+offset fidelity (slice-1 `computedAt`
precedent). `briefing` is **JSONB** (string array). The nullable `myLineupSlot` is modelled
as three nullable columns — `roleOnSheet` null ⇒ the whole `myLineupSlot` is `null`.

```prisma
/// Per-player match-day snapshot (MyMatchDayDTO). One row per person. The
/// in-memory matchDay is a standalone synthetic blob that does NOT match the
/// lineup-port's fixture/briefing seeds, so it is snapshotted (not derived) —
/// derived-snapshot ADR-176 exception (slice-1 spec §2.1). `teamId` replicates
/// the findMatchDay(personRef, teamId) gating. `roleOnSheet` null ⇒ the whole
/// myLineupSlot is null. `kickoffAt`/`acknowledgedAt` text for ISO+offset
/// fidelity; `briefing` JSONB (string[]).
model PlayerSelfMatchDay {
  id             String   @id @default(cuid())
  tenantPackId   String   @map("tenant_pack_id")
  personId       String
  teamId         String
  matchId        String
  homeClub       String
  awayClub       String
  venue          String?
  kickoffAt      String
  phase          String
  roleOnSheet    String?  // null => myLineupSlot is null
  slot           String?
  isCaptain      Boolean?
  briefing       Json     // string[]
  acknowledgedAt String?  // always null in v1 (event deferred)

  @@unique([tenantPackId, personId])
  @@index([tenantPackId])
  @@map("player_self_match_day")
  @@schema("football")
}
```

### 2.1 Migration

Hand-authored `<ts>_add_player_self_match_day` mirroring the slice-2 migration: `CREATE
TABLE` (TEXT/cuid columns, `Boolean`→`BOOLEAN`, `Json`→`JSONB`, snake `tenant_pack_id`) + the
unique + `(tenant_pack_id)` index, ENABLE + FORCE RLS, the two policies
(`player_self_match_day_tenant_pack_isolation` USING + `…_write` FOR INSERT WITH CHECK on
`current_setting('app.tenant_pack_id', true)`), GRANT to `app`. Verify ≤63-char names + zero
football drift via `prisma migrate diff` on the manual DB lane.

## 3. Shared seed extension + mapper — `player-self-seed.ts`

Add the match-day layer (transcribing the fixtures from the in-memory double's current
`matchDay` blobs — **preserve every value exactly**: Studer's bench card + Caprez's
starter/captain card; both `teamId = SEEDED_FC_LANGGASSE_TEAM_ID`, `matchId = SEED_MATCH_ID`):

- `StoredPlayerSelfMatchDay` row type (1:1 with the table — `personId`, `teamId`, the DTO
  scalars, the flattened `roleOnSheet`/`slot`/`isCaptain`, `briefing: string[]`,
  `acknowledgedAt`).
- `toMyMatchDayDTO(row)` mapper — reconstructs `personRef`; rebuilds
  `myLineupSlot = roleOnSheet === null ? null : { roleOnSheet, slot, isCaptain: isCaptain ?? false }`;
  passes `briefing` / `kickoffAt` / `acknowledgedAt` through.
- Accessors: `seedStoredPlayerSelfMatchDays()`, `storedMatchDayFor(personId)`.
- Relocate `SEED_MATCH_ID` here (it currently lives in the in-memory double) and re-export
  it from the double for back-compat if any consumer imports it.

## 4. In-memory double — collapse to a pure shared-seed reader

`findMatchDay(personRef, teamId)` re-points onto the shared seed:

```ts
async findMatchDay(personRef, teamId): Promise<MyMatchDayDTO | null> {
  const row = storedMatchDayFor(personRef.id);
  if (!row || row.teamId !== teamId) return null;
  return toMyMatchDayDTO(row);
}
```

This is the last read still using the local `DeferredPlayerSeed` map / `buildStuderSeed` /
`buildCaprezSeed` / `buildUnboundSeed` / `teamFixtureByTeamId` — **all of which are now
deleted**. The in-memory double becomes a thin reader over the shared seed, with no local
fixtures. Verify the existing `get-my-match-day.service.spec.ts` stays green; if it relied on
the old `teamFixtureByTeamId` matchId-override quirk, the snapshot's stored `matchId` (already
`SEED_MATCH_ID`) reproduces the same output (the override was a no-op when the team's fixture
*was* `SEED_MATCH_ID`).

## 5. Composite adapter → pure adapter — `prisma-player-self.repository.ts`

DB-back `findMatchDay`, then **remove the fallback** entirely:

```ts
async findMatchDay(personRef, teamId): Promise<MyMatchDayDTO | null> {
  return this.runner.run(async (tx) => {
    const row = await tx.playerSelfMatchDay.findFirst({ where: { personId: personRef.id, teamId } });
    return row ? toMyMatchDayDTO(matchDayRowToStored(row)) : null;
  });
}
```

- `TenantScopedClient` widens with `playerSelfMatchDay` (`findFirst({ where: { personId, teamId } })`)
  + its row type. `matchDayRowToStored` narrows `phase`/`roleOnSheet` strings + the JSONB
  `briefing` (`as readonly string[]`).
- Delete `private readonly fallback = new InMemoryPlayerSelfRepository();` and the
  `InMemoryPlayerSelfRepository` import — **no read delegates anymore**. The class doc-comment
  drops the "composite / deferred" framing: it is now a plain Prisma adapter for the whole
  port.

## 6. Wiring + seed

- No module change (the slice-1 `playerSelfRepositoryProviders` already binds the adapter under
  `PACK_FOOTBALL_PACK_CRUD_DB`).
- `seedPlayerSelf` writes `player_self_match_day` for the seeded persons (Studer + Caprez),
  child→parent delete order (match_day before person, alongside the others).

## 7. Testing

- Extend the shared **contract**: `findMatchDay(studer, SEEDED_FC_LANGGASSE_TEAM_ID)` returns
  the exact stored DTO; `findMatchDay(studer, otherTeam)` → `null` (team gating);
  `findMatchDay(unknown, team)` → `null`. Add to the isolation contract: foreign tenant →
  `null`. Add a direct foreign-GUC table-RLS proof (slice-2 precedent) for
  `player_self_match_day`.
- **Remove the DB-free `neverRunner` delegation test entirely** — there is no delegated read
  left (`currentWeekISO` keeps its own DB-free test; move it out of the delegation describe if
  needed).
- Extend the DB-gated block to seed `player_self_match_day`.
- `prisma migrate diff` zero football drift; `pg_policies` shows the two new policies.

## 8. Charter compliance

Synthetic-seed-only (D2/D3/R12), no real PHI — reuses the pseudonymized FC Länggasse match-day
fixtures. DB path behind the default-off `PACK_FOOTBALL_PACK_CRUD_DB` flag. No external
dependency. Bounded pack-local ADR-176 exception.

## 9. Out of scope / follow-ons

- The player-self port is **complete** after this slice. Remaining fan-out: club (OQ-3), reha
  (OQ-2) — founder decisions, separate.
- The deferred `MatchDayAcknowledged` event (`acknowledgedAt` always null v1) — unchanged;
  out of scope.

## 10. Acceptance criteria

- [ ] `PlayerSelfMatchDay` model + hand-authored migration (1 table + 2 RLS policies + GRANT);
      `prisma migrate diff` zero football drift.
- [ ] `player-self-seed.ts` gains `StoredPlayerSelfMatchDay` + `toMyMatchDayDTO` + accessors +
      relocated `SEED_MATCH_ID`.
- [ ] In-memory double's `findMatchDay` sources from the shared seed; the local
      `DeferredPlayerSeed` / `buildXSeed` / `teamFixtureByTeamId` structure is **deleted**.
- [ ] `TenantScopedClient` widened with `playerSelfMatchDay`.
- [ ] Adapter DB-backs `findMatchDay`; the `fallback` field + `InMemoryPlayerSelfRepository`
      import are **removed**; the class is no longer composite.
- [ ] `seedPlayerSelf` writes `player_self_match_day`.
- [ ] Extended contract (incl. team gating) + DB-gated isolation + table-RLS proof green; the
      `neverRunner` delegation test removed; build + DB-free suite green.
