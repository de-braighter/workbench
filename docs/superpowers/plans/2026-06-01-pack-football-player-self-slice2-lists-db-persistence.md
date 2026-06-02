# Pack-football player-self DB persistence — slice 2 (recent-sessions + weekly-blocks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DB-back the two player-self list reads (`findRecentSessions` + `findWeeklyBlocks`) on the composite `PrismaPlayerSelfRepository` via two new `football.player_self_*` row tables — ADR-202 fan-out port #5, slice 2; `findMatchDay` stays delegated (slice 3).

**Architecture:** Two row-per-item tables (`player_self_session`, `player_self_weekly_block`) mirroring `player_movement_entry`. The shared `player-self-seed.ts` gains the session/block layer (Stored types + `toRecentSessionDTO`/`toWeeklyBlockDTO` mappers + fixtures), driving the in-memory double, the Prisma adapter, and the DB seed through one contract suite. The composite adapter DB-backs the two list reads (reusing the slice-1 `player_self_person` registry for the `no-team-binding` discriminator); only `findMatchDay` remains delegated to the internal in-memory fallback.

**Tech Stack:** TypeScript, NestJS 10, Prisma 6 (multi-schema `football.*`), PostgreSQL 16 RLS, vitest, Nx 22. Pattern mirror: the shipped player-self slice 1 (exercir#163) + the player-movement row-table port.

**Source spec:** `docs/superpowers/specs/2026-06-01-pack-football-player-self-slice2-lists-db-persistence-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `libs/pack-football/src/out-ports/player-self-seed.ts` | Modify | Add `StoredPlayerSelfSession`/`StoredPlayerSelfWeeklyBlock` + `toRecentSessionDTO`/`toWeeklyBlockDTO` mappers + fixtures + accessors |
| `libs/pack-football/src/out-ports/player-self-seed.spec.ts` | Modify | Add session/block mapper + seed assertions |
| `libs/pack-football/src/out-ports/in-memory-player-self.repository.ts` | Modify | `findRecentSessions`/`findWeeklyBlocks` source from the shared seed; only `matchDay` stays local |
| `libs/pack-football/src/out-ports/player-self-repository.contract.ts` | Modify | Add session/block parity + no-team-binding + player-not-found cases |
| `prisma/packs/football.prisma` | Modify | Add `PlayerSelfSession` + `PlayerSelfWeeklyBlock` models |
| `prisma/migrations/20260601140000_add_player_self_lists/migration.sql` | Create | Hand-authored: 2 tables + 4 RLS policies + 2 GRANTs |
| `libs/pack-football/src/out-ports/tenant-runner.port.ts` | Modify | Add `playerSelfSession` + `playerSelfWeeklyBlock` delegates + row types |
| `libs/pack-football/src/out-ports/prisma-player-self.repository.ts` | Modify | DB-back the two list reads; shrink the delegated set to `findMatchDay` |
| `libs/pack-football/src/out-ports/player-self-repository.spec.ts` | Modify | Extend the DB-gated block (seed 2 tables); shrink the DB-free delegation test to `findMatchDay` |
| `prisma/seed/football-seed.ts` | Modify | `seedPlayerSelf` also writes the two new tables |

ESM: relative imports inside `libs/pack-football/src` use explicit `.js` extensions. The lib adapter must NOT import `@prisma/client` (structural `TenantScopedClient` slice only); the DB-gated spec MAY.

---

## Reference patterns (read before starting)

- **The slice-1 mirror (shipped):** `player-self-seed.ts`, `prisma-player-self.repository.ts`, `player-self-repository.contract.ts`, `player-self-repository.spec.ts`, the `20260601130000_add_player_self_aggregates` migration, `seedPlayerSelf` in `football-seed.ts`.
- **Row-table precedent:** `player-movement-seed.ts` + `prisma-player-movement.repository.ts` (list read → row table).
- **The DTOs being backed:** `in-ports/player-self/get-my-recent-sessions.use-case.ts` (`RecentSessionDTO`, `MyRecentSessionsResponse`, `FindRecentSessionsResult`), `get-my-weekly-blocks.use-case.ts` (`WeeklyBlockDTO`, `MyWeeklyBlocksResponse`). `out-ports/player-self.repository.ts` for `FindRecentSessionsResult`.

---

### Task 1: Extend `player-self-seed.ts` with the session/block layer

**Files:**
- Modify: `libs/pack-football/src/out-ports/player-self-seed.ts`
- Test: `libs/pack-football/src/out-ports/player-self-seed.spec.ts`

**Context:** the in-memory double (`in-memory-player-self.repository.ts`) currently holds the `recentSessions` / `weeklyBlocks` fixtures inline in `buildStuderSeed`/`buildCaprezSeed`/`buildUnboundSeed` (`DeferredPlayerSeed`). This task moves the session/block data + shapes into the shared seed. **Transcribe every value exactly** from the in-memory double (a later spec-review diffs them).

- [ ] **Step 1: Add the failing test cases**

Append to `libs/pack-football/src/out-ports/player-self-seed.spec.ts` (inside the existing top-level `describe('player-self-seed', …)` or a new one), adding these imports to the existing import from `./player-self-seed.js`: `seedStoredPlayerSelfSessions`, `seedStoredPlayerSelfWeeklyBlocks`, `storedSessionsFor`, `storedWeeklyBlocksFor`, `toRecentSessionDTO`, `toWeeklyBlockDTO`:

```ts
describe('player-self-seed — slice 2 (sessions + blocks)', () => {
  it('seeds Studer 4 sessions + 6 blocks, Caprez 1 + 1, unbound 0 + 0', () => {
    expect(storedSessionsFor(SEEDED_PLAYER_STUDER_ID)).toHaveLength(4);
    expect(storedWeeklyBlocksFor(SEEDED_PLAYER_STUDER_ID)).toHaveLength(6);
    expect(storedSessionsFor(SEEDED_PLAYER_CAPREZ_ID)).toHaveLength(1);
    expect(storedWeeklyBlocksFor(SEEDED_PLAYER_CAPREZ_ID)).toHaveLength(1);
    expect(storedSessionsFor(SEEDED_UNBOUND_PLAYER_ID)).toHaveLength(0);
    expect(storedWeeklyBlocksFor(SEEDED_UNBOUND_PLAYER_ID)).toHaveLength(0);
  });

  it('maps a session row into RecentSessionDTO (no personId leak)', () => {
    const dto = toRecentSessionDTO(storedSessionsFor(SEEDED_PLAYER_STUDER_ID)[0]!);
    expect(dto).not.toHaveProperty('personId');
    expect(dto).toHaveProperty('sessionId');
    expect(dto).toHaveProperty('kind');
    expect(dto).toHaveProperty('startedAt');
    expect(dto).toHaveProperty('participation');
  });

  it('maps a block row into WeeklyBlockDTO', () => {
    const dto = toWeeklyBlockDTO(storedWeeklyBlocksFor(SEEDED_PLAYER_STUDER_ID)[0]!);
    expect(dto).not.toHaveProperty('personId');
    expect(dto).toHaveProperty('blockId');
    expect(dto).toHaveProperty('day');
    expect(dto).toHaveProperty('state');
  });

  it('exposes flat seed accessors across the three persons', () => {
    expect(seedStoredPlayerSelfSessions()).toHaveLength(5); // 4 + 1 + 0
    expect(seedStoredPlayerSelfWeeklyBlocks()).toHaveLength(7); // 6 + 1 + 0
  });
});
```

Add `SEEDED_PLAYER_CAPREZ_ID` + `SEEDED_UNBOUND_PLAYER_ID` to the spec's existing import if not present.

- [ ] **Step 2: Run to verify failure**

Run: `npx nx test pack-football -- player-self-seed`
Expected: FAIL — the new symbols don't exist.

- [ ] **Step 3: Extend the seed module**

In `libs/pack-football/src/out-ports/player-self-seed.ts`, add the imports for the DTO + union types at the top (next to the existing player-self use-case imports):

```ts
import type {
  RecentSessionDTO,
  SessionKind,
  Participation,
} from '../in-ports/player-self/get-my-recent-sessions.use-case.js';
import type {
  WeeklyBlockDTO,
  BlockKind,
  BlockState,
  DayOfWeek,
} from '../in-ports/player-self/get-my-weekly-blocks.use-case.js';
```

Add the row types (near the other `Stored*` types):

```ts
export interface StoredPlayerSelfSession {
  personId: string;
  sessionId: string;
  kind: SessionKind;
  title: string;
  startedAt: string; // ISO-8601 with offset
  durationMinutes: number;
  participation: Participation;
  myRpe: number | null;
  myMood: number | null;
}

export interface StoredPlayerSelfWeeklyBlock {
  personId: string;
  blockId: string;
  day: DayOfWeek;
  kind: BlockKind;
  title: string;
  startedAt: string; // ISO-8601 with offset
  durationMinutes: number;
  state: BlockState;
}
```

Add the mappers (drop `personId` — the item DTOs don't carry it):

```ts
export function toRecentSessionDTO(row: StoredPlayerSelfSession): RecentSessionDTO {
  return {
    sessionId: row.sessionId,
    kind: row.kind,
    title: row.title,
    startedAt: row.startedAt,
    durationMinutes: row.durationMinutes,
    participation: row.participation,
    myRpe: row.myRpe,
    myMood: row.myMood,
  };
}

export function toWeeklyBlockDTO(row: StoredPlayerSelfWeeklyBlock): WeeklyBlockDTO {
  return {
    blockId: row.blockId,
    day: row.day,
    kind: row.kind,
    title: row.title,
    startedAt: row.startedAt,
    durationMinutes: row.durationMinutes,
    state: row.state,
  };
}
```

Add two fixture arrays — `SESSIONS: StoredPlayerSelfSession[]` and `WEEKLY_BLOCKS: StoredPlayerSelfWeeklyBlock[]` — by **transcribing the exact values** from the in-memory double's `buildStuderSeed`/`buildCaprezSeed`/`buildUnboundSeed` `recentSessions` + `weeklyBlocks` arrays, adding `personId` to each row (the player's id). Studer = 4 sessions + 6 blocks, Caprez = 1 + 1, unbound = none. Read the double to copy `sessionId`/`blockId`/`title`/`startedAt`/`durationMinutes`/`kind`/`participation`/`day`/`state`/`myRpe`/`myMood` verbatim.

Add the accessors:

```ts
export function seedStoredPlayerSelfSessions(): StoredPlayerSelfSession[] { return [...SESSIONS]; }
export function seedStoredPlayerSelfWeeklyBlocks(): StoredPlayerSelfWeeklyBlock[] { return [...WEEKLY_BLOCKS]; }
export function storedSessionsFor(personId: string): StoredPlayerSelfSession[] {
  return SESSIONS.filter((s) => s.personId === personId);
}
export function storedWeeklyBlocksFor(personId: string): StoredPlayerSelfWeeklyBlock[] {
  return WEEKLY_BLOCKS.filter((b) => b.personId === personId);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx nx test pack-football -- player-self-seed`
Expected: PASS (the 4 new tests + the existing slice-1 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football/src/out-ports/player-self-seed.ts libs/pack-football/src/out-ports/player-self-seed.spec.ts
git commit -m "feat(pack-football): extend player-self-seed with session + weekly-block layer"
```

---

### Task 2: Refactor the in-memory double onto the shared session/block seed

**Files:**
- Modify: `libs/pack-football/src/out-ports/in-memory-player-self.repository.ts`

**Context:** the double's `findRecentSessions`/`findWeeklyBlocks` currently read the local `DeferredPlayerSeed.recentSessions`/`.weeklyBlocks`. Re-point them at the shared seed (`storedSessionsFor`/`storedWeeklyBlocksFor` + the mappers), leaving **only `matchDay`** in the local map. The 8 consumer specs (the recent-sessions + weekly-blocks service specs especially) must stay green with byte-identical output.

- [ ] **Step 1: Trim `DeferredPlayerSeed` to match-day only + re-point the two reads**

In `in-memory-player-self.repository.ts`:
1. Add to the import from `./player-self-seed.js`: `storedSessionsFor`, `storedWeeklyBlocksFor`, `toRecentSessionDTO`, `toWeeklyBlockDTO`.
2. Change `DeferredPlayerSeed` to hold only what `findMatchDay` needs:

```ts
interface DeferredPlayerSeed {
  readonly personRef: PersonSubjectRef;
  readonly matchDay: MyMatchDayDTO;
}
```

3. Trim `buildStuderSeed`/`buildCaprezSeed`/`buildUnboundSeed` to return only `{ personRef, matchDay }` (drop their `recentSessions` + `weeklyBlocks` arrays). The `RecentSessionDTO` / `WeeklyBlockDTO` type imports + the `SEED_MATCH_ID`/`teamFixtureByTeamId` stay.
4. Re-point the two reads:

```ts
async findRecentSessions(
  personRef: PersonSubjectRef,
  limit: number,
): Promise<FindRecentSessionsResult> {
  const person = storedPersonFor(personRef.id);
  if (!person) return { kind: 'player-not-found' };
  if (person.teamId === null) return { kind: 'no-team-binding' };
  const sorted = storedSessionsFor(personRef.id)
    .map(toRecentSessionDTO)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return {
    kind: 'sessions',
    value: { personRef, sessions: sorted.slice(0, limit) },
  };
}

async findWeeklyBlocks(
  personRef: PersonSubjectRef,
  weekISO: string,
): Promise<MyWeeklyBlocksResponse | null> {
  const person = storedPersonFor(personRef.id);
  if (!person) return null;
  return {
    personRef,
    weekISO,
    blocks: storedWeeklyBlocksFor(personRef.id).map(toWeeklyBlockDTO),
  };
}
```

(Note: existence + team-binding now resolve through `storedPersonFor` — the shared registry — not the local `seeds` map. `findMatchDay` keeps using the local `seeds` map.) Remove the now-unused `RecentSessionDTO`/`WeeklyBlockDTO` imports if the trimmed `DeferredPlayerSeed` no longer references them, OR keep them if still used; let the lint/build tell you.

- [ ] **Step 2: Run the full pack suite**

Run: `npx nx test pack-football`
Expected: PASS — the recent-sessions + weekly-blocks service specs + the in-memory repo spec stay green (the shared-seed values were transcribed exactly in Task 1). If a session-ordering or value assertion fails, the transcription diverged — fix Task 1's values, not the consumer.

Run: `npx nx lint pack-football` → expect green (no unused imports left behind).

- [ ] **Step 3: Commit**

```bash
git add libs/pack-football/src/out-ports/in-memory-player-self.repository.ts
git commit -m "refactor(pack-football): in-memory player-self list reads onto the shared seed"
```

---

### Task 3: Extend the contract suite (session/block parity + no-team-binding)

**Files:**
- Modify: `libs/pack-football/src/out-ports/player-self-repository.contract.ts`

- [ ] **Step 1: Add the list-read contract cases**

In `player-self-repository.contract.ts`, add to the existing import from `./player-self-seed.js`: `SEEDED_UNBOUND_PLAYER_ID`, `storedSessionsFor`, `storedWeeklyBlocksFor`, `toRecentSessionDTO`, `toWeeklyBlockDTO`. Add an unbound ref constant near the top:

```ts
const unboundRef: PersonSubjectRef = { kind: 'person', id: SEEDED_UNBOUND_PLAYER_ID };
```

Inside `playerSelfRepositoryContract`'s `describe`, add:

```ts
it('findRecentSessions returns the seeded sessions (startedAt desc) for a bound player', async () => {
  const { repo } = await makeHarness();
  const expected = storedSessionsFor(SEEDED_PLAYER_STUDER_ID)
    .map(toRecentSessionDTO)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const result = await repo.findRecentSessions(studerRef, 10);
  expect(result.kind).toBe('sessions');
  if (result.kind === 'sessions') {
    expect(result.value.sessions).toEqual(expected);
  }
});

it('findRecentSessions returns no-team-binding for the unbound player', async () => {
  const { repo } = await makeHarness();
  expect((await repo.findRecentSessions(unboundRef, 10)).kind).toBe('no-team-binding');
});

it('findRecentSessions returns player-not-found for an unknown id', async () => {
  const { repo } = await makeHarness();
  expect((await repo.findRecentSessions(unknownRef, 10)).kind).toBe('player-not-found');
});

it('findWeeklyBlocks returns the seeded blocks for a bound player, null for unknown', async () => {
  const { repo } = await makeHarness();
  const expectedBlocks = storedWeeklyBlocksFor(SEEDED_PLAYER_STUDER_ID).map(toWeeklyBlockDTO);
  const res = await repo.findWeeklyBlocks(studerRef, SEED_WEEK_ISO);
  expect(res).toEqual({ personRef: studerRef, weekISO: SEED_WEEK_ISO, blocks: expectedBlocks });
  expect(await repo.findWeeklyBlocks(unknownRef, SEED_WEEK_ISO)).toBeNull();
});
```

Add to the isolation contract's "foreign tenant sees nothing" case:

```ts
    expect((await foreignRepo.findRecentSessions(studerRef, 10)).kind).toBe('player-not-found');
    expect(await foreignRepo.findWeeklyBlocks(studerRef, SEED_WEEK_ISO)).toBeNull();
```

(`SEED_WEEK_ISO`, `studerRef`, `unknownRef`, `SEEDED_PLAYER_STUDER_ID` already exist in the file from slice 1.)

- [ ] **Step 2: Run against the in-memory adapter**

Run: `npx nx test pack-football -- player-self-repository`
Expected: PASS — the in-memory contract now includes the 4 new list cases (+ the slice-1 cases).

- [ ] **Step 3: Commit**

```bash
git add libs/pack-football/src/out-ports/player-self-repository.contract.ts
git commit -m "test(pack-football): contract cases for player-self list reads + no-team-binding"
```

---

### Task 4: Two models + `TenantScopedClient` delegates + migration

**Files:**
- Modify: `prisma/packs/football.prisma`
- Modify: `libs/pack-football/src/out-ports/tenant-runner.port.ts`
- Create: `prisma/migrations/20260601140000_add_player_self_lists/migration.sql`

- [ ] **Step 1: Add the two Prisma models**

In `prisma/packs/football.prisma`, after the `PlayerSelfAcwr` model, add `PlayerSelfSession` + `PlayerSelfWeeklyBlock` exactly as in the spec §2.1–§2.2 (copy verbatim). Key: `tenantPackId String @map("tenant_pack_id")`; `startedAt String`; `durationMinutes Int`; the optional `myRpe Int?` / `myMood Int?`; `@@unique([tenantPackId, sessionId])` / `@@unique([tenantPackId, blockId])`; both `@@index([tenantPackId])` + `@@index([tenantPackId, personId])`; `@@schema("football")`.

- [ ] **Step 2: Regenerate the client**

Run: `npm run db:generate`
Expected: success; `playerSelfSession` + `playerSelfWeeklyBlock` delegates exist on `PrismaClient`.

- [ ] **Step 3: Widen `TenantScopedClient`**

In `tenant-runner.port.ts`, after the `TenantScopedPlayerSelfAcwrDelegate`, add (with one-line JSDoc each, matching the file convention):

```ts
/** A recent-session row as stored in `football.player_self_session` (1:1 RecentSessionDTO). */
export interface TenantScopedPlayerSelfSessionRow {
  readonly id: string;
  readonly tenantPackId: string;
  readonly personId: string;
  readonly sessionId: string;
  readonly kind: string;
  readonly title: string;
  readonly startedAt: string;
  readonly durationMinutes: number;
  readonly participation: string;
  readonly myRpe: number | null;
  readonly myMood: number | null;
}

/** The minimal Prisma `playerSelfSession` delegate the player-self adapter reads through. */
export interface TenantScopedPlayerSelfSessionDelegate {
  findMany(args: { where: { personId: string } }): Promise<readonly TenantScopedPlayerSelfSessionRow[]>;
}

/** A weekly-block row as stored in `football.player_self_weekly_block` (1:1 WeeklyBlockDTO). */
export interface TenantScopedPlayerSelfWeeklyBlockRow {
  readonly id: string;
  readonly tenantPackId: string;
  readonly personId: string;
  readonly blockId: string;
  readonly day: string;
  readonly kind: string;
  readonly title: string;
  readonly startedAt: string;
  readonly durationMinutes: number;
  readonly state: string;
}

/** The minimal Prisma `playerSelfWeeklyBlock` delegate the player-self adapter reads through. */
export interface TenantScopedPlayerSelfWeeklyBlockDelegate {
  findMany(args: { where: { personId: string } }): Promise<readonly TenantScopedPlayerSelfWeeklyBlockRow[]>;
}
```

Add to `TenantScopedClient` (after `playerSelfAcwr`):

```ts
  readonly playerSelfSession: TenantScopedPlayerSelfSessionDelegate;
  readonly playerSelfWeeklyBlock: TenantScopedPlayerSelfWeeklyBlockDelegate;
```

- [ ] **Step 4: Hand-author the migration**

Create `prisma/migrations/20260601140000_add_player_self_lists/migration.sql` with a header comment matching the slice-1 migration, then the two tables. For EACH table: `CREATE TABLE`, its indexes, ENABLE + FORCE RLS, the two policies (`<table>_tenant_pack_isolation` USING + `<table>_tenant_pack_isolation_write` FOR INSERT WITH CHECK on `current_setting('app.tenant_pack_id', true)`), GRANT to `app`. TEXT/cuid columns, snake `tenant_pack_id`, `INTEGER` for the int columns. The exact DDL:

```sql
-- player_self_session
CREATE TABLE "football"."player_self_session" (
    "id" TEXT NOT NULL,
    "tenant_pack_id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startedAt" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "participation" TEXT NOT NULL,
    "myRpe" INTEGER,
    "myMood" INTEGER,
    CONSTRAINT "player_self_session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "player_self_session_tenant_pack_id_sessionId_key" ON "football"."player_self_session"("tenant_pack_id", "sessionId");
CREATE INDEX "player_self_session_tenant_pack_id_idx" ON "football"."player_self_session"("tenant_pack_id");
CREATE INDEX "player_self_session_tenant_pack_id_personId_idx" ON "football"."player_self_session"("tenant_pack_id", "personId");
ALTER TABLE "football"."player_self_session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "football"."player_self_session" FORCE ROW LEVEL SECURITY;
CREATE POLICY player_self_session_tenant_pack_isolation ON "football"."player_self_session"
  USING ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));
CREATE POLICY player_self_session_tenant_pack_isolation_write ON "football"."player_self_session"
  FOR INSERT WITH CHECK ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "football"."player_self_session" TO app;

-- player_self_weekly_block
CREATE TABLE "football"."player_self_weekly_block" (
    "id" TEXT NOT NULL,
    "tenant_pack_id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startedAt" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    CONSTRAINT "player_self_weekly_block_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "player_self_weekly_block_tenant_pack_id_blockId_key" ON "football"."player_self_weekly_block"("tenant_pack_id", "blockId");
CREATE INDEX "player_self_weekly_block_tenant_pack_id_idx" ON "football"."player_self_weekly_block"("tenant_pack_id");
CREATE INDEX "player_self_weekly_block_tenant_pack_id_personId_idx" ON "football"."player_self_weekly_block"("tenant_pack_id", "personId");
ALTER TABLE "football"."player_self_weekly_block" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "football"."player_self_weekly_block" FORCE ROW LEVEL SECURITY;
CREATE POLICY player_self_weekly_block_tenant_pack_isolation ON "football"."player_self_weekly_block"
  USING ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));
CREATE POLICY player_self_weekly_block_tenant_pack_isolation_write ON "football"."player_self_weekly_block"
  FOR INSERT WITH CHECK ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "football"."player_self_weekly_block" TO app;
```

(Add the header comment block above these — forward-only, RLS rationale, snake-`tenant_pack_id` note.)

- [ ] **Step 5: (DB-gated) verify zero drift**

If a throwaway Postgres is reachable: provision (app role → `migrate deploy` → kernel/core SQL), then `npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma --shadow-database-url "<url>" --script` → expect ONLY the standing `kernel.event_log`/`outbox` diff, NO `player_self_session`/`player_self_weekly_block`. If `player_self_*` appears, copy the generated index names. If no DB, SKIP + note.

- [ ] **Step 6: Build (DB-free)**

Run: `npx nx build pack-football` → PASS. Run `npx nx test pack-football` → PASS (no behavior change yet).

- [ ] **Step 7: Commit**

```bash
git add prisma/packs/football.prisma libs/pack-football/src/out-ports/tenant-runner.port.ts "prisma/migrations/20260601140000_add_player_self_lists/migration.sql"
git commit -m "feat(pack-football): player_self_session + player_self_weekly_block tables + delegates"
```

---

### Task 5: Composite adapter — DB-back the two list reads

**Files:**
- Modify: `libs/pack-football/src/out-ports/prisma-player-self.repository.ts`
- Modify: `libs/pack-football/src/out-ports/player-self-repository.spec.ts`

- [ ] **Step 1: DB-back `findRecentSessions` + `findWeeklyBlocks`**

In `prisma-player-self.repository.ts`:
1. Add to the import from `./player-self-seed.js`: `toRecentSessionDTO`, `toWeeklyBlockDTO`, `type StoredPlayerSelfSession`, `type StoredPlayerSelfWeeklyBlock`.
2. Add to the import from `./tenant-runner.port.js`: `type TenantScopedPlayerSelfSessionRow`, `type TenantScopedPlayerSelfWeeklyBlockRow`.
3. Replace the two delegated methods with DB-backed bodies (leave `findMatchDay` delegating to `this.fallback`):

```ts
async findRecentSessions(personRef: PersonSubjectRef, limit: number): Promise<FindRecentSessionsResult> {
  return this.runner.run(async (tx) => {
    const person = await tx.playerSelfPerson.findFirst({ where: { personId: personRef.id } });
    if (!person) return { kind: 'player-not-found' };
    if (person.teamId === null) return { kind: 'no-team-binding' };
    const rows = await tx.playerSelfSession.findMany({ where: { personId: personRef.id } });
    const sessions = rows
      .map((r) => toRecentSessionDTO(sessionRowToStored(r)))
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, limit);
    return { kind: 'sessions', value: { personRef, sessions } };
  });
}

async findWeeklyBlocks(personRef: PersonSubjectRef, weekISO: string): Promise<MyWeeklyBlocksResponse | null> {
  return this.runner.run(async (tx) => {
    const person = await tx.playerSelfPerson.findFirst({ where: { personId: personRef.id } });
    if (!person) return null;
    const rows = await tx.playerSelfWeeklyBlock.findMany({ where: { personId: personRef.id } });
    return { personRef, weekISO, blocks: rows.map((r) => toWeeklyBlockDTO(blockRowToStored(r))) };
  });
}
```

4. Add the two `*RowToStored` helpers at the bottom (narrowing the DB strings to the DTO unions — safe, the seed is the only writer):

```ts
function sessionRowToStored(row: TenantScopedPlayerSelfSessionRow): StoredPlayerSelfSession {
  return {
    personId: row.personId,
    sessionId: row.sessionId,
    kind: row.kind as StoredPlayerSelfSession['kind'],
    title: row.title,
    startedAt: row.startedAt,
    durationMinutes: row.durationMinutes,
    participation: row.participation as StoredPlayerSelfSession['participation'],
    myRpe: row.myRpe,
    myMood: row.myMood,
  };
}

function blockRowToStored(row: TenantScopedPlayerSelfWeeklyBlockRow): StoredPlayerSelfWeeklyBlock {
  return {
    personId: row.personId,
    blockId: row.blockId,
    day: row.day as StoredPlayerSelfWeeklyBlock['day'],
    kind: row.kind as StoredPlayerSelfWeeklyBlock['kind'],
    title: row.title,
    startedAt: row.startedAt,
    durationMinutes: row.durationMinutes,
    state: row.state as StoredPlayerSelfWeeklyBlock['state'],
  };
}
```

(`MyWeeklyBlocksResponse` + `FindRecentSessionsResult` are already imported in slice 1; `findMatchDay` keeps its `this.fallback.findMatchDay(...)` line.)

- [ ] **Step 2: Build**

Run: `npx nx build pack-football` → PASS.

- [ ] **Step 3: Update the spec — shrink the DB-free delegation test, extend the DB-gated seed**

In `player-self-repository.spec.ts`:
1. In the DB-free `describe('PrismaPlayerSelfRepository composite delegation (DB-free)', …)` block, **remove** the `findRecentSessions` + `findWeeklyBlocks` delegation `it`s (they're DB-backed now); keep only `findMatchDay` delegates + `currentWeekISO`.
2. In the DB-gated `beforeAll`, add session + block seeding (after the acwr loop) and the deletes (in the child→parent delete loop add `player_self_session` + `player_self_weekly_block` at the front):

```ts
      for (const s of seedStoredPlayerSelfSessions()) {
        await admin.playerSelfSession.create({ data: { tenantPackId: SELF_TENANT_PACK_ID, ...s } });
      }
      for (const b of seedStoredPlayerSelfWeeklyBlocks()) {
        await admin.playerSelfWeeklyBlock.create({ data: { tenantPackId: SELF_TENANT_PACK_ID, ...b } });
      }
```

Add the two table names to the `for (const t of [...])` delete arrays (both `beforeAll` and `afterAll`), at the FRONT: `'player_self_weekly_block', 'player_self_session', …`. Add the imports `seedStoredPlayerSelfSessions`, `seedStoredPlayerSelfWeeklyBlocks` from `./player-self-seed.js`.

- [ ] **Step 4: Run DB-free + commit**

Run: `npx nx test pack-football -- player-self-repository` → PASS (in-memory contract incl. the new list cases; Prisma block skipped). Run `npx nx build pack-football` + `npx nx lint pack-football` → PASS.

```bash
git add libs/pack-football/src/out-ports/prisma-player-self.repository.ts libs/pack-football/src/out-ports/player-self-repository.spec.ts
git commit -m "feat(pack-football): DB-back player-self findRecentSessions + findWeeklyBlocks"
```

---

### Task 6: Seed the two new tables

**Files:**
- Modify: `prisma/seed/football-seed.ts`

- [ ] **Step 1: Extend `seedPlayerSelf`**

In `prisma/seed/football-seed.ts`:
1. Add to the player-self-seed import: `seedStoredPlayerSelfSessions`, `seedStoredPlayerSelfWeeklyBlocks`.
2. In `seedPlayerSelf`, add the two table names to the delete loop array at the FRONT (`'player_self_weekly_block', 'player_self_session', 'player_self_acwr', …`), and after the acwr insert loop add:

```ts
    for (const s of seedStoredPlayerSelfSessions()) {
      await tx.playerSelfSession.create({ data: { tenantPackId: SQUAD_TENANT_PACK_ID, ...s } });
    }
    for (const b of seedStoredPlayerSelfWeeklyBlocks()) {
      await tx.playerSelfWeeklyBlock.create({ data: { tenantPackId: SQUAD_TENANT_PACK_ID, ...b } });
    }
```

- [ ] **Step 2: Typecheck**

Run: `npx nx build pack-football` → PASS. If a DB is available: `npm run db:seed:football` → output still ends `football seed: OK`. Else SKIP + note.

- [ ] **Step 3: Commit**

```bash
git add prisma/seed/football-seed.ts
git commit -m "feat(pack-football): seed player_self_session + player_self_weekly_block"
```

---

### Task 7: Final verification + story + PR

- [ ] **Step 1: DB-free gate**

Run: `npm run ci:local` → build + lint + test all PASS.

- [ ] **Step 2: Diff scope**

Run: `git diff --name-status main...HEAD` → exactly the 10 files in the File Structure table. Nothing else.

- [ ] **Step 3: Story issue**

```bash
gh issue create --repo de-braighter/exercir \
  --title "player-self DB persistence slice 2 (recent-sessions + weekly-blocks) — fan-out port #5" \
  --body "DB-back the two player-self list reads (findRecentSessions + findWeeklyBlocks) via two football.player_self_* row tables; findMatchDay stays delegated (slice 3). Reuses the slice-1 player_self_person registry for the no-team-binding discriminator. Part of epic #142.

Tech design: docs/superpowers/specs/2026-06-01-pack-football-player-self-slice2-lists-db-persistence-design.md"
```

Note the `<STORY#>`.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin HEAD
```

```bash
gh pr create --repo de-braighter/exercir \
  --title "feat(pack-football): player-self DB persistence slice 2 (recent-sessions + weekly-blocks) — fan-out port #5" \
  --body "Closes #<STORY#>

DB-backs the two player-self list reads on the composite \`PrismaPlayerSelfRepository\` via two new \`football.player_self_*\` row tables (\`player_self_session\`, \`player_self_weekly_block\`). \`findRecentSessions\`'s 3-way discriminator reuses the slice-1 \`player_self_person\` registry (\`no-team-binding\` when team is null). \`findMatchDay\` stays delegated to the internal in-memory double (slice 3). Shared \`player-self-seed\` drives both adapters + the seed through one contract suite. Behind \`PACK_FOOTBALL_PACK_CRUD_DB\`; in-memory stays the flag-off default.

Tech design: docs/superpowers/specs/2026-06-01-pack-football-player-self-slice2-lists-db-persistence-design.md

Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]
Effect: duplication 0±0.3 expert
Effect: coverage 0±0.6 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

(`gh pr edit` fails on the no-read:org token — use `gh api repos/de-braighter/exercir/pulls/<N> -X PATCH -f body=...` for later edits.)

- [ ] **Step 5: Verifier wave**

Dispatch `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker` (read-only, reading the exercir clone at the feat checkout; do not switch branches). Address blocking findings before merge.

---

## Self-Review (completed against the spec)

**Spec coverage:** §2 schema (2 tables) → Task 4. §2.3 migration → Task 4. §3 shared seed + mappers → Tasks 1–2. §4 composite adapter (3-way discriminator, sort/slice, weekly-blocks label, matchDay stays) → Task 5. §5 wiring (none) + seed → Task 6. §6 testing (contract incl. no-team-binding + DB-gated + shrunk delegation) → Tasks 3 + 5. §8 out of scope (matchDay = slice 3) → delegated, not built. §9 acceptance → covered Tasks 1–6. ✅

**Placeholder scan:** the Task-1 "transcribe from the double" is a named-source instruction with a reviewer diff (mirrors slice 1's Task 1); the `<ts>`/`<STORY#>` are standard conventions. No vague TODOs. ✅

**Type consistency:** `StoredPlayerSelfSession`/`StoredPlayerSelfWeeklyBlock` (Task 1) consumed identically by the in-memory double (Task 2), the contract (Task 3), the adapter's `sessionRowToStored`/`blockRowToStored` (Task 5), and the seed (Task 6); `toRecentSessionDTO`/`toWeeklyBlockDTO` signatures stable across Tasks 1/2/3/5; `TenantScopedPlayerSelf{Session,WeeklyBlock}Row`/`Delegate` (Task 4) match the adapter's row mappers (Task 5); the session `startedAt`-descending string sort is identical in the double (Task 2), the contract expected (Task 3), and the adapter (Task 5). ✅
