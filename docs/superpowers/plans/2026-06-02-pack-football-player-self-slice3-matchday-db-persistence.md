# Pack-football player-self DB persistence — slice 3 (match-day) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** DB-back the last player-self read (`findMatchDay`) via a `football.player_self_match_day` snapshot table, **completing the port** — the composite adapter's in-memory fallback then dissolves into a plain Prisma adapter. ADR-202 fan-out port #5, slice 3.

**Architecture:** A `player_self_match_day` snapshot row per person (the in-memory matchDay is a standalone synthetic blob that can't derive from the lineup tables for parity — slice-3 spec §1.1). The shared `player-self-seed.ts` gains the match-day layer (`StoredPlayerSelfMatchDay` + `toMyMatchDayDTO` mapper + fixtures), driving the in-memory double, the Prisma adapter, and the DB seed through one contract. DB-backing `findMatchDay` removes the last delegated read, so the adapter's `fallback` field + the in-memory double's local `DeferredPlayerSeed`/`teamFixtureByTeamId` structure are deleted.

**Tech Stack:** TypeScript, NestJS 10, Prisma 6 (`football.*`), PostgreSQL 16 RLS, vitest, Nx 22. Pattern mirror: player-self slices 1–2 (exercir#163, #165).

**Source spec:** `docs/superpowers/specs/2026-06-02-pack-football-player-self-slice3-matchday-db-persistence-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `libs/pack-football/src/out-ports/player-self-seed.ts` | Modify | Add `StoredPlayerSelfMatchDay` + `toMyMatchDayDTO` + fixtures + accessors + relocate `SEED_MATCH_ID` |
| `libs/pack-football/src/out-ports/player-self-seed.spec.ts` | Modify | Add match-day mapper + seed assertions |
| `libs/pack-football/src/out-ports/in-memory-player-self.repository.ts` | Modify | `findMatchDay` onto the shared seed; **delete** `DeferredPlayerSeed`/`buildXSeed`/`teamFixtureByTeamId` |
| `libs/pack-football/src/out-ports/player-self-repository.contract.ts` | Modify | Add match-day contract + isolation cases |
| `prisma/packs/football.prisma` | Modify | Add the `PlayerSelfMatchDay` model |
| `prisma/migrations/20260602120000_add_player_self_match_day/migration.sql` | Create | Hand-authored: 1 table + 2 RLS policies + GRANT |
| `libs/pack-football/src/out-ports/tenant-runner.port.ts` | Modify | Add the `playerSelfMatchDay` delegate + row type |
| `libs/pack-football/src/out-ports/prisma-player-self.repository.ts` | Modify | DB-back `findMatchDay`; **remove** the `fallback` field + in-memory import; de-composite the class doc |
| `libs/pack-football/src/out-ports/player-self-repository.spec.ts` | Modify | DB-gated: seed match-day + the table-RLS proof; **remove** the `neverRunner` delegation block (keep a `currentWeekISO` test) |
| `prisma/seed/football-seed.ts` | Modify | `seedPlayerSelf` writes `player_self_match_day` |

ESM `.js` imports. Adapter must NOT import `@prisma/client`. DB-gated spec MAY.

---

## Reference patterns

- **The slice-2 mirror (shipped):** `player-self-seed.ts` (the session/block layer), `prisma-player-self.repository.ts` (`*RowToStored` + the runner.run reads + the DB-gated table-RLS test), the `20260601140000_add_player_self_lists` migration, `seedPlayerSelf` in `football-seed.ts`.
- **The DTO:** `in-ports/player-self/get-my-match-day.use-case.ts` (`MyMatchDayDTO`, `MyLineupSlotDTO`, `MatchPhase`, `RoleOnSheet`).

---

### Task 1: Extend `player-self-seed.ts` with the match-day layer

**Files:** Modify `player-self-seed.ts`; Test `player-self-seed.spec.ts`.

**Context:** the in-memory double holds the matchDay fixtures inline (`buildStuderSeed`/`buildCaprezSeed`/`buildUnboundSeed`, `matchDay:` blocks) + `SEED_MATCH_ID`. Move them to the shared seed. **Transcribe every value exactly** (Studer bench card, Caprez starter/CM/captain card, unbound zeroed card; both bound `teamId = SEEDED_FC_LANGGASSE_TEAM_ID`, `matchId = SEED_MATCH_ID`, `phase` from the double). A spec-review diffs your values.

- [ ] **Step 1: Failing test** — append to `player-self-seed.spec.ts` (add the imports `seedStoredPlayerSelfMatchDays`, `storedMatchDayFor`, `toMyMatchDayDTO`, `SEED_MATCH_ID`):

```ts
describe('player-self-seed — slice 3 (match-day)', () => {
  it('seeds a match-day row per pilot person', () => {
    expect(seedStoredPlayerSelfMatchDays().length).toBeGreaterThanOrEqual(2);
    expect(storedMatchDayFor(SEEDED_PLAYER_STUDER_ID)).toBeDefined();
    expect(storedMatchDayFor(SEEDED_PLAYER_CAPREZ_ID)).toBeDefined();
  });

  it('maps Studer match-day into MyMatchDayDTO (bench, no slot)', () => {
    const dto = toMyMatchDayDTO(storedMatchDayFor(SEEDED_PLAYER_STUDER_ID)!);
    expect(dto.personRef).toEqual({ kind: 'person', id: SEEDED_PLAYER_STUDER_ID });
    expect(dto.matchId).toBe(SEED_MATCH_ID);
    expect(dto.myLineupSlot).toEqual({ roleOnSheet: 'bench', slot: null, isCaptain: false });
    expect(dto.acknowledgedAt).toBeNull();
    expect(Array.isArray(dto.briefing)).toBe(true);
  });

  it('maps Caprez match-day into MyMatchDayDTO (starter CM captain)', () => {
    const dto = toMyMatchDayDTO(storedMatchDayFor(SEEDED_PLAYER_CAPREZ_ID)!);
    expect(dto.myLineupSlot).toEqual({ roleOnSheet: 'starter', slot: 'CM', isCaptain: true });
  });
});
```

- [ ] **Step 2: Run (fail)** — `npx nx test pack-football -- player-self-seed` → FAIL.

- [ ] **Step 3: Extend the seed module.** Add the DTO type imports:

```ts
import type {
  MyMatchDayDTO,
  MatchPhase,
  RoleOnSheet,
} from '../in-ports/player-self/get-my-match-day.use-case.js';
```

Relocate `SEED_MATCH_ID` here (and re-export from the in-memory double in Task 3 if a consumer imports it — grep first):

```ts
export const SEED_MATCH_ID = 'd0d0d0d0-d0d0-4d0d-8d0d-fc1a55e1ma01';
```

Add the row type:

```ts
export interface StoredPlayerSelfMatchDay {
  personId: string;
  teamId: string;
  matchId: string;
  homeClub: string;
  awayClub: string;
  venue: string | null;
  kickoffAt: string;
  phase: MatchPhase;
  roleOnSheet: RoleOnSheet | null; // null => myLineupSlot is null
  slot: string | null;
  isCaptain: boolean | null;
  briefing: readonly string[];
  acknowledgedAt: string | null;
}
```

Add the mapper:

```ts
export function toMyMatchDayDTO(row: StoredPlayerSelfMatchDay): MyMatchDayDTO {
  return {
    personRef: { kind: 'person', id: row.personId },
    matchId: row.matchId,
    homeClub: row.homeClub,
    awayClub: row.awayClub,
    venue: row.venue,
    kickoffAt: row.kickoffAt,
    phase: row.phase,
    myLineupSlot:
      row.roleOnSheet === null
        ? null
        : { roleOnSheet: row.roleOnSheet, slot: row.slot, isCaptain: row.isCaptain ?? false },
    briefing: [...row.briefing],
    acknowledgedAt: row.acknowledgedAt,
  };
}
```

Add a `MATCH_DAYS: StoredPlayerSelfMatchDay[]` array transcribing the three persons' `matchDay` blocks from the in-memory double (Studer, Caprez, unbound), each with `teamId: SEEDED_FC_LANGGASSE_TEAM_ID`. Flatten `myLineupSlot` → `roleOnSheet`/`slot`/`isCaptain` (all three doubles have a non-null myLineupSlot, so `roleOnSheet` is never null here — the null path exists for the schema, not the seed). Copy `phase`/`homeClub`/`awayClub`/`venue`/`kickoffAt`/`briefing`/`acknowledgedAt` verbatim.

Add accessors:

```ts
export function seedStoredPlayerSelfMatchDays(): StoredPlayerSelfMatchDay[] { return [...MATCH_DAYS]; }
export function storedMatchDayFor(personId: string): StoredPlayerSelfMatchDay | undefined {
  return MATCH_DAYS.find((m) => m.personId === personId);
}
```

- [ ] **Step 4: Run (pass)** — `npx nx test pack-football -- player-self-seed` → PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football/src/out-ports/player-self-seed.ts libs/pack-football/src/out-ports/player-self-seed.spec.ts
git commit -m "feat(pack-football): extend player-self-seed with the match-day layer"
```

---

### Task 2: In-memory double — collapse onto the shared seed (delete the local structure)

**Files:** Modify `in-memory-player-self.repository.ts`.

**Context:** `findMatchDay` is the last read using the local `DeferredPlayerSeed` map. Re-point it at the shared seed; then **delete** `DeferredPlayerSeed`, `buildStuderSeed`/`buildCaprezSeed`/`buildUnboundSeed`, the `seeds` Map, `teamFixtureByTeamId`, and the local `SEED_MATCH_ID` (now in the shared seed). The full suite — especially `application/player-self/get-my-match-day.service.spec.ts` — must stay green.

- [ ] **Step 1: Refactor.** Add to the `./player-self-seed.js` import: `storedMatchDayFor`, `toMyMatchDayDTO` (and `SEED_MATCH_ID` if any consumer of this file imports it — grep `SEED_MATCH_ID` across the pack; if a consumer imports it from here, re-export it: `export { SEED_MATCH_ID } from './player-self-seed.js';`).

Replace `findMatchDay`:

```ts
async findMatchDay(personRef: PersonSubjectRef, teamId: string): Promise<MyMatchDayDTO | null> {
  const row = storedMatchDayFor(personRef.id);
  if (!row || row.teamId !== teamId) return null;
  return toMyMatchDayDTO(row);
}
```

Then DELETE: the `DeferredPlayerSeed` interface, the three `buildXSeed` functions, the `private readonly seeds` Map + its constructor population, the `teamFixtureByTeamId` Map + its constructor population, the local `SEED_MATCH_ID` const, and any now-unused imports (`MyMatchDayDTO` stays — it types `findMatchDay`; remove `RecentSessionDTO`/`WeeklyBlockDTO`/`PersonSubjectRef`-only-if-unused etc. — let lint guide you). The class likely no longer needs a constructor at all (no local state). The other methods (personExists/findPersonTenantId/findForm/findWeekStats/findACWR/findRecentSessions/findWeeklyBlocks/currentWeekISO) already source from the shared seed and are unchanged.

- [ ] **Step 2: Verify** — `npx nx test pack-football` → PASS (esp. `get-my-match-day.service.spec.ts`). `npx nx lint pack-built` … run `npx nx lint pack-football` → green (no unused imports / no empty constructor warnings). If `get-my-match-day.service.spec` fails on a value, the matchDay transcription diverged (fix Task 1, not the consumer). If it relies on a behavior the snapshot can't reproduce, STOP and report BLOCKED with the exact assertion.

- [ ] **Step 3: Commit**

```bash
git add libs/pack-football/src/out-ports/in-memory-player-self.repository.ts
git commit -m "refactor(pack-football): collapse in-memory player-self double onto the shared seed (drop local fixtures)"
```

---

### Task 3: Extend the contract suite (match-day + team gating)

**Files:** Modify `player-self-repository.contract.ts`.

- [ ] **Step 1: Add cases.** Add to the `./player-self-seed.js` import: `SEED_MATCH_ID`, `SEEDED_FC_LANGGASSE_TEAM_ID`, `storedMatchDayFor`, `toMyMatchDayDTO`. Add a constant `const OTHER_TEAM_ID = '99999999-9999-4999-8999-fc1a55e1team';` near the refs. Inside `playerSelfRepositoryContract`'s `describe`, add:

```ts
    it('findMatchDay returns the seeded card for Studer + the bound team', async () => {
      const { repo } = await makeHarness();
      const expected = toMyMatchDayDTO(storedMatchDayFor(SEEDED_PLAYER_STUDER_ID)!);
      expect(await repo.findMatchDay(studerRef, SEEDED_FC_LANGGASSE_TEAM_ID)).toEqual(expected);
    });

    it('findMatchDay returns null for the wrong team (gating) and an unknown person', async () => {
      const { repo } = await makeHarness();
      expect(await repo.findMatchDay(studerRef, OTHER_TEAM_ID)).toBeNull();
      expect(await repo.findMatchDay(unknownRef, SEEDED_FC_LANGGASSE_TEAM_ID)).toBeNull();
    });
```

Add to the isolation contract's "a foreign tenant sees nothing" `it`:

```ts
      expect(await foreignRepo.findMatchDay(studerRef, SEEDED_FC_LANGGASSE_TEAM_ID)).toBeNull();
```

- [ ] **Step 2: Run** — `npx nx test pack-football -- player-self-repository` → PASS (in-memory contract incl. the 2 new match-day cases). `npx nx lint pack-football` → green.

- [ ] **Step 3: Commit**

```bash
git add libs/pack-football/src/out-ports/player-self-repository.contract.ts
git commit -m "test(pack-football): contract cases for findMatchDay + team gating"
```

---

### Task 4: Model + `TenantScopedClient` delegate + migration

**Files:** Modify `prisma/packs/football.prisma`, `tenant-runner.port.ts`; Create the migration.

- [ ] **Step 1: Add the model** — in `prisma/packs/football.prisma` after `PlayerSelfWeeklyBlock`, add the `PlayerSelfMatchDay` model verbatim from spec §2 (TEXT/cuid; `venue`/`roleOnSheet`/`slot`/`acknowledgedAt` nullable; `isCaptain Boolean?`; `briefing Json`; `@@unique([tenantPackId, personId])` + `@@index([tenantPackId])`; `@@map`/`@@schema`).

- [ ] **Step 2: Generate** — `npm run db:generate` → `playerSelfMatchDay` delegate exists.

- [ ] **Step 3: Widen `TenantScopedClient`** — after the `TenantScopedPlayerSelfWeeklyBlockDelegate`, add (JSDoc one-liners per file convention):

```ts
/** A match-day row as stored in `football.player_self_match_day` (1:1 MyMatchDayDTO). */
export interface TenantScopedPlayerSelfMatchDayRow {
  readonly id: string;
  readonly tenantPackId: string;
  readonly personId: string;
  readonly teamId: string;
  readonly matchId: string;
  readonly homeClub: string;
  readonly awayClub: string;
  readonly venue: string | null;
  readonly kickoffAt: string;
  readonly phase: string;
  readonly roleOnSheet: string | null;
  readonly slot: string | null;
  readonly isCaptain: boolean | null;
  readonly briefing: unknown;
  readonly acknowledgedAt: string | null;
}

/** The minimal Prisma `playerSelfMatchDay` delegate the player-self adapter reads through. */
export interface TenantScopedPlayerSelfMatchDayDelegate {
  findFirst(args: { where: { personId: string; teamId: string } }): Promise<TenantScopedPlayerSelfMatchDayRow | null>;
}
```

Add to `TenantScopedClient` (after `playerSelfWeeklyBlock`):

```ts
  readonly playerSelfMatchDay: TenantScopedPlayerSelfMatchDayDelegate;
```

- [ ] **Step 4: Hand-author the migration** — `prisma/migrations/20260602120000_add_player_self_match_day/migration.sql` with the slice-2-style header, then:

```sql
-- player_self_match_day
CREATE TABLE "football"."player_self_match_day" (
    "id" TEXT NOT NULL,
    "tenant_pack_id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "homeClub" TEXT NOT NULL,
    "awayClub" TEXT NOT NULL,
    "venue" TEXT,
    "kickoffAt" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "roleOnSheet" TEXT,
    "slot" TEXT,
    "isCaptain" BOOLEAN,
    "briefing" JSONB NOT NULL,
    "acknowledgedAt" TEXT,
    CONSTRAINT "player_self_match_day_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "player_self_match_day_tenant_pack_id_personId_key" ON "football"."player_self_match_day"("tenant_pack_id", "personId");
CREATE INDEX "player_self_match_day_tenant_pack_id_idx" ON "football"."player_self_match_day"("tenant_pack_id");
ALTER TABLE "football"."player_self_match_day" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "football"."player_self_match_day" FORCE ROW LEVEL SECURITY;
CREATE POLICY player_self_match_day_tenant_pack_isolation ON "football"."player_self_match_day"
  USING ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));
CREATE POLICY player_self_match_day_tenant_pack_isolation_write ON "football"."player_self_match_day"
  FOR INSERT WITH CHECK ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "football"."player_self_match_day" TO app;
```

(Index names: `player_self_match_day_tenant_pack_id_personId_key` = 49 chars, under 63.)

- [ ] **Step 5: (DB-gated) drift check** — if a DB is reachable, `prisma migrate diff … --script` → only the standing kernel diff, NO `player_self_match_day`. Else SKIP + note.

- [ ] **Step 6: Build** — `npx nx build pack-football` → PASS; `npx nx test pack-football` → PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/packs/football.prisma libs/pack-football/src/out-ports/tenant-runner.port.ts "prisma/migrations/20260602120000_add_player_self_match_day/migration.sql"
git commit -m "feat(pack-football): player_self_match_day table + delegate + RLS migration"
```

---

### Task 5: DB-back `findMatchDay` + remove the fallback (de-composite the adapter)

**Files:** Modify `prisma-player-self.repository.ts`, `player-self-repository.spec.ts`.

- [ ] **Step 1: DB-back + remove fallback.** In `prisma-player-self.repository.ts`:
1. Add to the `./player-self-seed.js` import: `toMyMatchDayDTO`, `type StoredPlayerSelfMatchDay`. Add to the `./tenant-runner.port.js` import: `type TenantScopedPlayerSelfMatchDayRow`. Add `type MyMatchDayDTO` import from the match-day use-case if not present.
2. Replace `findMatchDay`:

```ts
async findMatchDay(personRef: PersonSubjectRef, teamId: string): Promise<MyMatchDayDTO | null> {
  return this.runner.run(async (tx) => {
    const row = await tx.playerSelfMatchDay.findFirst({ where: { personId: personRef.id, teamId } });
    return row ? toMyMatchDayDTO(matchDayRowToStored(row)) : null;
  });
}
```

3. **Delete** `private readonly fallback = new InMemoryPlayerSelfRepository();` and the `import { InMemoryPlayerSelfRepository } from './in-memory-player-self.repository.js';` — there are no delegated reads left.
4. Add the `matchDayRowToStored` helper:

```ts
function matchDayRowToStored(row: TenantScopedPlayerSelfMatchDayRow): StoredPlayerSelfMatchDay {
  return {
    personId: row.personId,
    teamId: row.teamId,
    matchId: row.matchId,
    homeClub: row.homeClub,
    awayClub: row.awayClub,
    venue: row.venue,
    kickoffAt: row.kickoffAt,
    phase: row.phase as StoredPlayerSelfMatchDay['phase'],
    roleOnSheet: row.roleOnSheet as StoredPlayerSelfMatchDay['roleOnSheet'],
    slot: row.slot,
    isCaptain: row.isCaptain,
    briefing: row.briefing as readonly string[],
    acknowledgedAt: row.acknowledgedAt,
  };
}
```

5. Update the class doc-comment: drop the "composite / deferred `findMatchDay`" framing — it is now a plain Prisma adapter for the whole player-self port (all reads DB-backed).

- [ ] **Step 2: Build** — `npx nx build pack-football` → PASS.

- [ ] **Step 3: Update the spec.** In `player-self-repository.spec.ts`:
1. **Remove** the DB-free `describe('PrismaPlayerSelfRepository composite delegation (DB-free)', …)` block (there is no delegated read to prove anymore). If you want to keep a DB-free `currentWeekISO` assertion, replace the block with a tiny `describe('PrismaPlayerSelfRepository (DB-free)')` holding only the `currentWeekISO` test (construct with a `throwingRunner` so it proves currentWeekISO needs no DB). Remove now-unused imports (`SEEDED_FC_LANGGASSE_TEAM_ID` may now be needed below — keep what the file uses).
2. DB-gated `beforeAll`: after the weekly-block seeding loop add:

```ts
      for (const m of seedStoredPlayerSelfMatchDays()) {
        await admin.playerSelfMatchDay.create({ data: { tenantPackId: SELF_TENANT_PACK_ID, ...m, briefing: m.briefing as unknown as object } });
      }
```

Add `seedStoredPlayerSelfMatchDays` to the import. Add `'player_self_match_day'` to the FRONT of both delete-loop arrays.

- [ ] **Step 4: Run + lint + build, commit.** `npx nx test pack-football -- player-self-repository` → PASS (in-memory contract incl. match-day; Prisma block skipped). `npx nx build pack-football` + `npx nx lint pack-football` → PASS.

```bash
git add libs/pack-football/src/out-ports/prisma-player-self.repository.ts libs/pack-football/src/out-ports/player-self-repository.spec.ts
git commit -m "feat(pack-football): DB-back findMatchDay; player-self adapter is no longer composite"
```

---

### Task 6: Seed the match-day table

**Files:** Modify `prisma/seed/football-seed.ts`.

- [ ] **Step 1: Extend `seedPlayerSelf`.** Add `seedStoredPlayerSelfMatchDays` to the player-self-seed import. Add `'player_self_match_day'` to the FRONT of the delete-loop array. After the weekly-block insert loop add:

```ts
    for (const m of seedStoredPlayerSelfMatchDays()) {
      await tx.playerSelfMatchDay.create({ data: { tenantPackId: SQUAD_TENANT_PACK_ID, ...m, briefing: m.briefing as unknown as object } });
    }
```

- [ ] **Step 2: Typecheck** — `npx nx build pack-football` → PASS. (DB available → `npm run db:seed:football` ends `OK`; else SKIP + note.)

- [ ] **Step 3: Commit**

```bash
git add prisma/seed/football-seed.ts
git commit -m "feat(pack-football): seed player_self_match_day"
```

---

### Task 7: Final verification + story + PR

- [ ] **Step 1:** `npm run ci:local` → green.
- [ ] **Step 2:** `git diff --name-status main...HEAD` → exactly the 10 files in the File Structure table.
- [ ] **Step 3: Story** — `gh issue create --repo de-braighter/exercir --title "player-self DB persistence slice 3 (match-day) — completes the fan-out port #5" --body "DB-back findMatchDay via football.player_self_match_day; the composite adapter's in-memory fallback dissolves — the player-self port is fully DB-backed. Part of epic #142.\n\nTech design: docs/superpowers/specs/2026-06-02-pack-football-player-self-slice3-matchday-db-persistence-design.md"`
- [ ] **Step 4: Push + PR** — `git push -u origin HEAD`; then `gh pr create` with `Closes #<STORY#>`, a summary noting the port is now complete + the fallback removed, `Tech design:` link, `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`, `Effect: duplication 0±0.3 expert`, `Effect: coverage 0±0.6 expert`.
- [ ] **Step 5: Verifier wave** — `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker` (read-only at the feat checkout).

---

## Self-Review (against the spec)

**Spec coverage:** §2 schema (1 table) → Task 4. §2.1 migration → Task 4. §3 seed + mapper → Task 1. §4 in-memory collapse → Task 2. §5 adapter de-composite (DB-back + remove fallback) → Task 5. §6 wiring (none) + seed → Task 6. §7 testing (contract + team gating + isolation + table-RLS + remove neverRunner) → Tasks 3 + 5. §9 port-complete → the fallback removal in Task 5. §10 acceptance → Tasks 1–6. ✅

**Placeholder scan:** the Task-1 transcription is named-source + reviewer-verified (slice-1/2 precedent); `<ts>`/`<STORY#>` standard. ✅

**Type consistency:** `StoredPlayerSelfMatchDay` (Task 1) consumed by the in-memory double (Task 2), the contract (Task 3), `matchDayRowToStored` (Task 5), the seed (Task 6); `toMyMatchDayDTO` stable across Tasks 1/2/3/5; `TenantScopedPlayerSelfMatchDayRow`/`Delegate` (Task 4) match the adapter mapper (Task 5); `SEED_MATCH_ID` relocated (Task 1) + re-exported if needed (Task 2). ✅
