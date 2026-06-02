# Pack-football player-self DB persistence — slice 1 (flat aggregates) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `PlayerSelfRepository`'s three flat aggregate reads (form / week-stats / ACWR) a Postgres backing via a composite `PrismaPlayerSelfRepository`, behind the `PACK_FOOTBALL_PACK_CRUD_DB` flag — ADR-202 fan-out port #5, slice 1.

**Architecture:** Four `football.*` snapshot tables (a `player_self_person` RBAC/identity registry + form/week_stats/acwr metric tables). A shared `player-self-seed.ts` module (Stored row types + `toMyFormDTO`/`toMyWeekStatsDTO`/`toMyACWRDTO` mappers) drives the in-memory double, the Prisma adapter, and the DB seed through one contract suite. The Prisma adapter is **composite**: DB-backs the three reads + the RBAC primitives (`personExists`/`findPersonTenantId`) + real-clock `currentWeekISO`, and delegates the deferred reads (`findRecentSessions`/`findWeeklyBlocks`/`findMatchDay`) to an internally-instantiated `InMemoryPlayerSelfRepository` (the lineup-port composite precedent).

**Tech Stack:** TypeScript, NestJS 10, Prisma 6 (multi-schema `football.*`), PostgreSQL 16 RLS (`tenant_pack_id` GUC), vitest, Nx 22. Pattern mirror: the shipped player-trait port (#4, exercir#161).

**Source spec:** `docs/superpowers/specs/2026-06-01-pack-football-player-self-aggregates-db-persistence-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `libs/pack-football/src/out-ports/player-self-seed.ts` | Create | Shared `Stored*` row types + `toMyFormDTO`/`toMyWeekStatsDTO`/`toMyACWRDTO` mappers + the three pilot fixtures + seed accessors + the relocated id/tenant constants |
| `libs/pack-football/src/out-ports/player-self-seed.spec.ts` | Create | Unit spec for the mappers + seed |
| `libs/pack-football/src/out-ports/in-memory-player-self.repository.ts` | Modify | Build form/week-stats/ACWR via the shared mappers; re-export the relocated constants; keep the deferred-read seeds |
| `libs/pack-football/src/out-ports/player-self-repository.contract.ts` | Create | Shared contract + isolation suites both adapters pass |
| `libs/pack-football/src/out-ports/player-self-repository.spec.ts` | Create | Runs the contract against in-memory (always) + Prisma (DB-gated) |
| `libs/pack-football/src/out-ports/iso-week.ts` | Create | `isoWeekOf(date)` ISO-8601 week helper for the DB adapter's real-clock `currentWeekISO` |
| `libs/pack-football/src/out-ports/iso-week.spec.ts` | Create | Unit spec for `isoWeekOf` |
| `prisma/packs/football.prisma` | Modify | Add the four `PlayerSelf*` models |
| `prisma/migrations/20260601130000_add_player_self_aggregates/migration.sql` | Create | Hand-authored: 4 tables + 8 RLS policies + 4 GRANTs |
| `libs/pack-football/src/out-ports/tenant-runner.port.ts` | Modify | Add the four `playerSelf*` delegates + row types |
| `libs/pack-football/src/out-ports/prisma-player-self.repository.ts` | Create | The composite Postgres adapter |
| `libs/pack-football/src/pack-football.module.ts` | Modify | Flag-gate the `PLAYER_SELF_REPOSITORY` binding |
| `prisma/seed/football-seed.ts` | Modify | `seedPlayerSelf` writes the four tables for the three pilots |

---

## Reference patterns (read before starting)

- **Whole shipped mirror:** the player-trait port — `player-trait-seed.ts`, `prisma-player-trait.repository.ts`, `player-trait-repository.contract.ts`, `player-trait-repository.spec.ts`, the `20260601120000_add_player_trait_value` migration, `playerTraitRepositoryProviders` in `pack-football.module.ts`, `seedPlayerTraits` in `football-seed.ts`.
- **Composite-adapter precedent:** `prisma-lineup.repository.ts` — note `private readonly timeline = new InMemoryLineupRepository();` and the delegated methods (`appendSubstitution`/`appendFormationChange`).
- **The port + DTOs being backed:** `player-self.repository.ts`, `in-memory-player-self.repository.ts`, and the use-cases under `in-ports/player-self/` (`get-my-form`, `get-my-week-stats`, `get-my-acwr`) for the exact DTO field shapes. `application/player-self/authorize.ts` for the RBAC gate.

ESM: every relative import inside `libs/pack-football/src` uses an explicit `.js` extension. The lib must NOT hard-import `@prisma/client` (structural `TenantScopedClient` slice only); the DB-gated spec MAY.

---

### Task 1: Shared `player-self-seed.ts` + mappers

**Files:**
- Create: `libs/pack-football/src/out-ports/player-self-seed.ts`
- Test: `libs/pack-football/src/out-ports/player-self-seed.spec.ts`

**Context:** the existing `in-memory-player-self.repository.ts` holds the fixtures inline (`buildStuderSeed`/`buildCaprezSeed`/`buildUnboundSeed`, each a `PlayerSeed` with `form`/`weekStats`/`recentSessions`/`weeklyBlocks`/`acwr`/`matchDay` + `tenantId`/`teamId`). This task creates the shared module holding the **flat-row** form of the three sliced reads' data + identity, plus the mappers. It does NOT yet touch the in-memory double (Task 2). It also relocates the id/tenant constants here as the canonical source.

- [ ] **Step 1: Write the failing test**

`libs/pack-football/src/out-ports/player-self-seed.spec.ts`:

```ts
/**
 * player-self-seed — the shared fixtures + row→DTO mappers behind both
 * player-self adapters (slice 1: form / week-stats / ACWR). Asserts each mapper
 * reconstructs the DTO shape and the seed covers the three pilot persons.
 */

import { describe, expect, it } from 'vitest';

import {
  SEEDED_FC_LANGGASSE_TENANT_ID,
  SEEDED_PLAYER_STUDER_ID,
  seedStoredPlayerSelfPersons,
  seedStoredPlayerSelfForms,
  seedStoredPlayerSelfWeekStats,
  seedStoredPlayerSelfAcwrs,
  toMyFormDTO,
  toMyWeekStatsDTO,
  toMyACWRDTO,
  storedFormFor,
  storedWeekStatsFor,
  storedAcwrFor,
  SEED_WEEK_ISO,
} from './player-self-seed.js';

describe('player-self-seed', () => {
  it('seeds the three pilot persons across all four tables', () => {
    expect(seedStoredPlayerSelfPersons()).toHaveLength(3);
    expect(seedStoredPlayerSelfForms()).toHaveLength(3);
    expect(seedStoredPlayerSelfAcwrs()).toHaveLength(3);
    // one week-stats row per person for the seeded week
    expect(seedStoredPlayerSelfWeekStats()).toHaveLength(3);
  });

  it('maps Studer form into MyFormDTO with a reconstructed personRef', () => {
    const dto = toMyFormDTO(storedFormFor(SEEDED_PLAYER_STUDER_ID)!);
    expect(dto.personRef).toEqual({ kind: 'person', id: SEEDED_PLAYER_STUDER_ID });
    expect(dto.formIndex).toBe(76);
    expect(dto.formTrend).toBe('up');
    expect(dto.acwr).toBe(1.04);
    expect(dto.rpeLatest).toBe(7);
  });

  it('maps Studer week-stats into MyWeekStatsDTO', () => {
    const dto = toMyWeekStatsDTO(
      storedWeekStatsFor(SEEDED_PLAYER_STUDER_ID, SEED_WEEK_ISO)!,
    );
    expect(dto.weekISO).toBe(SEED_WEEK_ISO);
    expect(dto.sessionsCompleted).toBe(4);
    expect(dto.sessionsScheduled).toBe(5);
  });

  it('maps Studer ACWR into MyACWRDTO with the targetBand tuple + trail', () => {
    const dto = toMyACWRDTO(storedAcwrFor(SEEDED_PLAYER_STUDER_ID)!);
    expect(dto.ratio).toBe(1.04);
    expect(dto.targetBand).toEqual([0.8, 1.3]);
    expect(dto.trail.length).toBe(28);
    expect(dto.trail[0]).toHaveProperty('date');
    expect(dto.trail[0]).toHaveProperty('loadSrpeMinutes');
  });

  it('exposes the org tenant for the seeded persons', () => {
    const studer = seedStoredPlayerSelfPersons().find(
      (p) => p.personId === SEEDED_PLAYER_STUDER_ID,
    );
    expect(studer?.tenantId).toBe(SEEDED_FC_LANGGASSE_TENANT_ID);
    expect(studer?.teamId).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football -- player-self-seed`
Expected: FAIL — cannot find module `./player-self-seed.js`.

- [ ] **Step 3: Write the seed module**

Create `libs/pack-football/src/out-ports/player-self-seed.ts`. Define the stored row types + mappers exactly as below, then transcribe the fixture VALUES from the existing `in-memory-player-self.repository.ts` (`buildStuderSeed`/`buildCaprezSeed`/`buildUnboundSeed`) — **preserve every value exactly** (formIndex, formTrend, load7d, acwr, rpeLatest, computedAt; the week-stats fields; the ACWR acute/chronic/ratio/targetBand/trail/computedAt; the per-person `tenantId`/`teamId`). The id/tenant constants below are MOVED here from the in-memory double (Task 2 re-exports them):

```ts
/**
 * The FC Länggasse U19 player-self seed (slice 1: form / week-stats / ACWR) +
 * the row→DTO mappers shared by the in-memory and Prisma adapters and the DB
 * seed. Single source of truth so the in-memory test double, the live
 * `football.player_self_*` rows, and the contract suite all agree
 * (pack-crud-repository-pattern.md §5.5 test-double parity).
 *
 * OQ-5 Option B (derived-rollup snapshot): the stored values ARE the DTOs the
 * port already returned — no new compute logic. `computedAt` is the literal
 * ISO-8601-with-offset display string (stored as text downstream to preserve
 * the offset). `targetBand` is two scalar columns rebuilt into the tuple.
 *
 * Source spec:
 *   `docs/superpowers/specs/2026-06-01-pack-football-player-self-aggregates-db-persistence-design.md`
 */

import type { PersonSubjectRef } from '../domain/subject-ref.js';
import type { MyACWRDTO, DailyLoadPoint } from '../in-ports/player-self/get-my-acwr.use-case.js';
import type { MyFormDTO, FormTrend } from '../in-ports/player-self/get-my-form.use-case.js';
import type { MyWeekStatsDTO } from '../in-ports/player-self/get-my-week-stats.use-case.js';

// ─── relocated identity constants (canonical source; re-exported by the double) ──

/** Mirror of `jerseyToPlayerId` from `in-memory-squad.repository.ts`. */
function jerseyToPlayerId(num: number): string {
  const n = num.toString().padStart(2, '0');
  const hi = n.padStart(8, '0');
  return `${hi}-0000-4000-8000-fc1a55e100${n}`;
}
export const SEEDED_PLAYER_STUDER_ID = jerseyToPlayerId(23);
export const SEEDED_PLAYER_CAPREZ_ID = jerseyToPlayerId(10);
export const SEEDED_UNBOUND_PLAYER_ID = '99999999-9999-4999-8999-fc1a55e10000';
export const SEEDED_FC_LANGGASSE_TENANT_ID = 'fc1a55e1-7e10-4000-8000-fc1a55e1ee10';
export const SEEDED_OTHER_CLUB_TENANT_ID = 'c10bc10b-7e10-4000-8000-c10bc10bc10b';
export const SEED_WEEK_ISO = '2026-W20';

// Re-exported team id (the FC Länggasse team the bound pilots belong to). MUST
// equal `SEEDED_FC_LANGGASSE_TEAM_ID` from in-memory-plan-tree.repository.ts —
// import it there rather than re-declare, to keep one source.
import { SEEDED_FC_LANGGASSE_TEAM_ID } from './in-memory-plan-tree.repository.js';
export { SEEDED_FC_LANGGASSE_TEAM_ID };

// ─── stored row shapes (1:1 with the football.player_self_* tables) ──────────

export interface StoredPlayerSelfPerson {
  personId: string;
  tenantId: string;     // org tenant
  teamId: string | null; // null => no-team-binding
}

export interface StoredPlayerSelfForm {
  personId: string;
  formIndex: number;
  formTrend: FormTrend;
  load7d: number;
  acwr: number | null;
  rpeLatest: number | null;
  computedAt: string; // ISO-8601 with offset
}

export interface StoredPlayerSelfWeekStats {
  personId: string;
  weekIso: string;
  sessionsCompleted: number;
  sessionsScheduled: number;
  minutesPlayed: number;
  sprintCount: number;
  passAccuracyPressed: number | null;
  vmaxKmh: number | null;
}

export interface StoredPlayerSelfAcwr {
  personId: string;
  acuteSrpeMinutes: number;
  chronicSrpeMinutes: number;
  ratio: number | null;
  targetBandLow: number;
  targetBandHigh: number;
  trail: readonly DailyLoadPoint[];
  computedAt: string; // ISO-8601 with offset
}

// ─── mappers (row → DTO), shared by both adapters ────────────────────────────

function personRefOf(personId: string): PersonSubjectRef {
  return { kind: 'person', id: personId };
}

export function toMyFormDTO(row: StoredPlayerSelfForm): MyFormDTO {
  return {
    personRef: personRefOf(row.personId),
    formIndex: row.formIndex,
    formTrend: row.formTrend,
    load7d: row.load7d,
    acwr: row.acwr,
    rpeLatest: row.rpeLatest,
    computedAt: row.computedAt,
  };
}

export function toMyWeekStatsDTO(row: StoredPlayerSelfWeekStats): MyWeekStatsDTO {
  return {
    personRef: personRefOf(row.personId),
    weekISO: row.weekIso,
    sessionsCompleted: row.sessionsCompleted,
    sessionsScheduled: row.sessionsScheduled,
    minutesPlayed: row.minutesPlayed,
    sprintCount: row.sprintCount,
    passAccuracyPressed: row.passAccuracyPressed,
    vmaxKmh: row.vmaxKmh,
  };
}

export function toMyACWRDTO(row: StoredPlayerSelfAcwr): MyACWRDTO {
  return {
    personRef: personRefOf(row.personId),
    acuteSrpeMinutes: row.acuteSrpeMinutes,
    chronicSrpeMinutes: row.chronicSrpeMinutes,
    ratio: row.ratio,
    targetBand: [row.targetBandLow, row.targetBandHigh],
    trail: [...row.trail],
    computedAt: row.computedAt,
  };
}

// ─── the three pilot fixtures (TRANSCRIBE VALUES from the existing double) ────
// buildAcwrTrail mirrors the existing in-memory double's helper; reuse it for
// the trail rows. Studer trail: buildAcwrTrail('2026-04-20', 28, i => 50 + ((i*13)%80));
// Caprez trail: buildAcwrTrail('2026-04-20', 28, i => 60 + ((i*11)%90)); unbound: [].

function buildAcwrTrail(
  startDate: string,
  days: number,
  loader: (i: number) => number,
): DailyLoadPoint[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const trail: DailyLoadPoint[] = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start.getTime() + i * 86400000);
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    trail.push({ date: `${yyyy}-${mm}-${dd}`, loadSrpeMinutes: loader(i) });
  }
  return trail;
}

const PERSONS: StoredPlayerSelfPerson[] = [
  // TRANSCRIBE: Studer (team bound), Caprez (team bound), unbound (teamId null).
  // tenantId = SEEDED_FC_LANGGASSE_TENANT_ID for all three;
  // teamId = SEEDED_FC_LANGGASSE_TEAM_ID for Studer + Caprez, null for unbound.
];

const FORMS: StoredPlayerSelfForm[] = [
  // TRANSCRIBE the `form` block of each of the three seeds (exact values).
];

const WEEK_STATS: StoredPlayerSelfWeekStats[] = [
  // TRANSCRIBE the `weekStats` block of each seed; weekIso = SEED_WEEK_ISO.
];

const ACWRS: StoredPlayerSelfAcwr[] = [
  // TRANSCRIBE the `acwr` block of each seed: acute/chronic/ratio, targetBand
  // [0.8,1.3] -> low/high, trail via buildAcwrTrail(...), computedAt.
];

// ─── accessors ───────────────────────────────────────────────────────────────

export function seedStoredPlayerSelfPersons(): StoredPlayerSelfPerson[] { return [...PERSONS]; }
export function seedStoredPlayerSelfForms(): StoredPlayerSelfForm[] { return [...FORMS]; }
export function seedStoredPlayerSelfWeekStats(): StoredPlayerSelfWeekStats[] { return [...WEEK_STATS]; }
export function seedStoredPlayerSelfAcwrs(): StoredPlayerSelfAcwr[] { return [...ACWRS]; }

export function storedPersonFor(personId: string): StoredPlayerSelfPerson | undefined {
  return PERSONS.find((p) => p.personId === personId);
}
export function storedFormFor(personId: string): StoredPlayerSelfForm | undefined {
  return FORMS.find((f) => f.personId === personId);
}
export function storedWeekStatsFor(personId: string, weekIso: string): StoredPlayerSelfWeekStats | undefined {
  return WEEK_STATS.find((w) => w.personId === personId && w.weekIso === weekIso);
}
export function storedAcwrFor(personId: string): StoredPlayerSelfAcwr | undefined {
  return ACWRS.find((a) => a.personId === personId);
}
```

NOTE the field-name fix: `toMyWeekStatsDTO` maps stored `weekIso` → DTO `weekISO` (the DTO uses `weekISO`, the column uses `weekIso`). Verify the DTO property names against the use-case files when transcribing.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football -- player-self-seed`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football/src/out-ports/player-self-seed.ts libs/pack-football/src/out-ports/player-self-seed.spec.ts
git commit -m "feat(pack-football): shared player-self-seed module + form/week-stats/ACWR mappers"
```

---

### Task 2: Refactor the in-memory double onto the shared seed

**Files:**
- Modify: `libs/pack-football/src/out-ports/in-memory-player-self.repository.ts`

**Context:** the double currently builds its `MyFormDTO`/`MyWeekStatsDTO`/`MyACWRDTO` from inline `PlayerSeed` data and defines the id/tenant constants. Refactor so the three sliced reads return the shared mappers' output (one source of truth), the constants are re-exported from the seed module, and the deferred-read seeds (recentSessions/weeklyBlocks/matchDay) stay. The 8 consumer specs (6 service specs + `player-self-rbac.spec.ts` + `in-memory-player-self.repository.spec.ts`) must keep passing.

- [ ] **Step 1: Refactor the double**

In `in-memory-player-self.repository.ts`:
1. Replace the locally-declared constants (`SEEDED_PLAYER_STUDER_ID`, `SEEDED_PLAYER_CAPREZ_ID`, `SEEDED_UNBOUND_PLAYER_ID`, `SEEDED_FC_LANGGASSE_TENANT_ID`, `SEEDED_OTHER_CLUB_TENANT_ID`, and `jerseyToPlayerId`) with a re-export from the seed module:

```ts
import {
  SEEDED_PLAYER_STUDER_ID,
  SEEDED_PLAYER_CAPREZ_ID,
  SEEDED_UNBOUND_PLAYER_ID,
  SEEDED_FC_LANGGASSE_TENANT_ID,
  SEEDED_OTHER_CLUB_TENANT_ID,
  SEED_WEEK_ISO,
  storedFormFor,
  storedWeekStatsFor,
  storedAcwrFor,
  storedPersonFor,
  toMyFormDTO,
  toMyWeekStatsDTO,
  toMyACWRDTO,
} from './player-self-seed.js';

export {
  SEEDED_PLAYER_STUDER_ID,
  SEEDED_PLAYER_CAPREZ_ID,
  SEEDED_UNBOUND_PLAYER_ID,
  SEEDED_FC_LANGGASSE_TENANT_ID,
  SEEDED_OTHER_CLUB_TENANT_ID,
};
```

2. Change `findForm`/`findWeekStats`/`findACWR` to source from the shared seed via the mappers, and `personExists`/`findPersonTenantId` from `storedPersonFor`:

```ts
async personExists(personRef: PersonSubjectRef): Promise<boolean> {
  return storedPersonFor(personRef.id) !== undefined;
}

async findPersonTenantId(personRef: PersonSubjectRef): Promise<string | null> {
  return storedPersonFor(personRef.id)?.tenantId ?? null;
}

async findForm(personRef: PersonSubjectRef): Promise<MyFormDTO | null> {
  const row = storedFormFor(personRef.id);
  return row ? toMyFormDTO(row) : null;
}

async findWeekStats(personRef: PersonSubjectRef, weekISO: string): Promise<MyWeekStatsDTO | null> {
  const row = storedWeekStatsFor(personRef.id, SEED_WEEK_ISO);
  if (!row) return null;
  // preserve the existing re-label-to-requested-week behaviour (double-specific).
  return { ...toMyWeekStatsDTO(row), weekISO };
}

async findACWR(personRef: PersonSubjectRef): Promise<MyACWRDTO | null> {
  const row = storedAcwrFor(personRef.id);
  return row ? toMyACWRDTO(row) : null;
}
```

3. Keep the existing `findRecentSessions`/`findWeeklyBlocks`/`findMatchDay`/`currentWeekISO` and their seed data (recentSessions/weeklyBlocks/matchDay + the `teamFixtureByTeamId` map + the `teamId === null` → `no-team-binding` logic). The `teamId` for the binding/no-binding decision now comes from `storedPersonFor(personRef.id)?.teamId`.

- [ ] **Step 2: Run the full pack suite**

Run: `npx nx test pack-football`
Expected: PASS — the 6 player-self service specs + `player-self-rbac.spec.ts` + `in-memory-player-self.repository.spec.ts` stay green (the DTOs are byte-identical because the values were transcribed exactly in Task 1). If a consumer breaks on a missing constant import, ensure it is re-exported from the double per Step 1.

- [ ] **Step 3: Commit**

```bash
git add libs/pack-football/src/out-ports/in-memory-player-self.repository.ts
git commit -m "refactor(pack-football): in-memory player-self double onto the shared seed mappers"
```

---

### Task 3: Shared contract suite (in-memory adapter)

**Files:**
- Create: `libs/pack-football/src/out-ports/player-self-repository.contract.ts`
- Create: `libs/pack-football/src/out-ports/player-self-repository.spec.ts`

- [ ] **Step 1: Write the contract suite**

`libs/pack-football/src/out-ports/player-self-repository.contract.ts`:

```ts
/**
 * playerSelfRepositoryContract — the shared contract both `PlayerSelfRepository`
 * adapters pass for slice 1 (form / week-stats / ACWR) + the RBAC primitives
 * (pack-crud-repository-pattern.md §5.5 test-double parity). Week-stats is asserted at the
 * SEEDED week (passed explicitly) — the in-memory double's re-label-to-other-week
 * is double-specific and not part of the contract.
 *
 * Source spec:
 *   `docs/superpowers/specs/2026-06-01-pack-football-player-self-aggregates-db-persistence-design.md` §7
 */

import { describe, expect, it } from 'vitest';

import type { PersonSubjectRef } from '../domain/subject-ref.js';
import type { PlayerSelfRepository } from './player-self.repository.js';
import {
  SEEDED_FC_LANGGASSE_TENANT_ID,
  SEEDED_PLAYER_STUDER_ID,
  SEED_WEEK_ISO,
  storedFormFor,
  storedWeekStatsFor,
  storedAcwrFor,
  toMyFormDTO,
  toMyWeekStatsDTO,
  toMyACWRDTO,
} from './player-self-seed.js';

const UNKNOWN_PERSON_ID = '00000099-0000-4000-8000-fc1a55e10099';
const studerRef: PersonSubjectRef = { kind: 'person', id: SEEDED_PLAYER_STUDER_ID };
const unknownRef: PersonSubjectRef = { kind: 'person', id: UNKNOWN_PERSON_ID };

export interface PlayerSelfContractHarness {
  repo: PlayerSelfRepository;
}

export function playerSelfRepositoryContract(
  label: string,
  makeHarness: () => Promise<PlayerSelfContractHarness> | PlayerSelfContractHarness,
): void {
  describe(`PlayerSelfRepository contract — ${label}`, () => {
    it('personExists is true for a seeded person, false for an unknown id', async () => {
      const { repo } = await makeHarness();
      expect(await repo.personExists(studerRef)).toBe(true);
      expect(await repo.personExists(unknownRef)).toBe(false);
    });

    it('findPersonTenantId returns the org tenant for a seeded person, null for unknown', async () => {
      const { repo } = await makeHarness();
      expect(await repo.findPersonTenantId(studerRef)).toBe(SEEDED_FC_LANGGASSE_TENANT_ID);
      expect(await repo.findPersonTenantId(unknownRef)).toBeNull();
    });

    it('findForm returns the seeded form for Studer, null for unknown', async () => {
      const { repo } = await makeHarness();
      expect(await repo.findForm(studerRef)).toEqual(toMyFormDTO(storedFormFor(SEEDED_PLAYER_STUDER_ID)!));
      expect(await repo.findForm(unknownRef)).toBeNull();
    });

    it('findWeekStats returns the seeded week stats at the seeded week, null for unknown', async () => {
      const { repo } = await makeHarness();
      expect(await repo.findWeekStats(studerRef, SEED_WEEK_ISO)).toEqual(
        toMyWeekStatsDTO(storedWeekStatsFor(SEEDED_PLAYER_STUDER_ID, SEED_WEEK_ISO)!),
      );
      expect(await repo.findWeekStats(unknownRef, SEED_WEEK_ISO)).toBeNull();
    });

    it('findACWR returns the seeded ACWR (with full trail) for Studer, null for unknown', async () => {
      const { repo } = await makeHarness();
      expect(await repo.findACWR(studerRef)).toEqual(toMyACWRDTO(storedAcwrFor(SEEDED_PLAYER_STUDER_ID)!));
      expect(await repo.findACWR(unknownRef)).toBeNull();
    });
  });
}

export interface PlayerSelfIsolationHarness {
  ownRepo: PlayerSelfRepository;
  foreignRepo: PlayerSelfRepository;
}

/**
 * A repo scoped to a different tenant-pack MUST NOT see the seeded person — so
 * personExists=false, findPersonTenantId=null, and all three reads null. Only
 * meaningful against the live RLS surface; the DB-gated harness runs it.
 */
export function playerSelfRepositoryIsolationContract(
  label: string,
  make: () => Promise<PlayerSelfIsolationHarness> | PlayerSelfIsolationHarness,
): void {
  describe(`PlayerSelfRepository tenant-isolation — ${label}`, () => {
    it('the owning tenant sees the seeded person (isolation sanity)', async () => {
      const { ownRepo } = await make();
      expect(await ownRepo.personExists(studerRef)).toBe(true);
      expect(await ownRepo.findForm(studerRef)).not.toBeNull();
    });

    it('a foreign tenant sees nothing (RLS isolation)', async () => {
      const { foreignRepo } = await make();
      expect(await foreignRepo.personExists(studerRef)).toBe(false);
      expect(await foreignRepo.findPersonTenantId(studerRef)).toBeNull();
      expect(await foreignRepo.findForm(studerRef)).toBeNull();
      expect(await foreignRepo.findWeekStats(studerRef, SEED_WEEK_ISO)).toBeNull();
      expect(await foreignRepo.findACWR(studerRef)).toBeNull();
    });
  });
}
```

- [ ] **Step 2: Write the spec running the in-memory adapter**

`libs/pack-football/src/out-ports/player-self-repository.spec.ts` (in-memory block only — DB-gated block added in Task 5):

```ts
/**
 * Player-self-repository conformance — runs the shared
 * `playerSelfRepositoryContract` against the in-memory double (always; CI stays
 * DB-free). The `PrismaPlayerSelfRepository` block is added in Task 5,
 * DB-gated on `SUBSTRATE_APP_DATABASE_URL`.
 */

import { InMemoryPlayerSelfRepository } from './in-memory-player-self.repository.js';
import { playerSelfRepositoryContract } from './player-self-repository.contract.js';

playerSelfRepositoryContract('InMemoryPlayerSelfRepository', () => ({
  repo: new InMemoryPlayerSelfRepository(),
}));
```

- [ ] **Step 3: Run + lint**

Run: `npx nx test pack-football -- player-self-repository`
Expected: PASS (5 contract tests, in-memory).

Run: `npx nx lint pack-football`
Expected: PASS (the exported-but-unused `playerSelfRepositoryIsolationContract` mirrors the player-trait contract's isolation export — used in Task 5).

- [ ] **Step 4: Commit**

```bash
git add libs/pack-football/src/out-ports/player-self-repository.contract.ts libs/pack-football/src/out-ports/player-self-repository.spec.ts
git commit -m "test(pack-football): shared player-self contract suite (in-memory adapter)"
```

---

### Task 4: Schema (4 models) + `TenantScopedClient` delegates + migration

**Files:**
- Modify: `prisma/packs/football.prisma`
- Modify: `libs/pack-football/src/out-ports/tenant-runner.port.ts`
- Create: `prisma/migrations/20260601130000_add_player_self_aggregates/migration.sql`

- [ ] **Step 1: Add the four Prisma models**

In `prisma/packs/football.prisma`, after the `PlayerTraitValue` model, add the four models exactly as specified in the spec §3.1–§3.4 (`PlayerSelfPerson`, `PlayerSelfForm`, `PlayerSelfWeekStats`, `PlayerSelfAcwr`) — copy them verbatim from the spec. Key points: `tenantPackId String @map("tenant_pack_id")`; unmapped camelCase columns elsewhere; `trail Json`; `computedAt String`; `@@schema("football")`; the uniques + indexes per the spec.

- [ ] **Step 2: Regenerate the client**

Run: `npm run db:generate`
Expected: success; the four `playerSelf*` delegates exist on `PrismaClient` (no DB needed).

- [ ] **Step 3: Widen `TenantScopedClient`**

In `libs/pack-football/src/out-ports/tenant-runner.port.ts`, after the `TenantScopedPlayerTraitValueDelegate`, add the four row types + delegates, then add the four members to `TenantScopedClient`:

```ts
export interface TenantScopedPlayerSelfPersonRow {
  readonly id: string;
  readonly tenantPackId: string;
  readonly personId: string;
  readonly tenantId: string;
  readonly teamId: string | null;
}
export interface TenantScopedPlayerSelfPersonDelegate {
  findFirst(args: { where: { personId: string } }): Promise<TenantScopedPlayerSelfPersonRow | null>;
}

export interface TenantScopedPlayerSelfFormRow {
  readonly id: string;
  readonly tenantPackId: string;
  readonly personId: string;
  readonly formIndex: number;
  readonly formTrend: string;
  readonly load7d: number;
  readonly acwr: number | null;
  readonly rpeLatest: number | null;
  readonly computedAt: string;
}
export interface TenantScopedPlayerSelfFormDelegate {
  findFirst(args: { where: { personId: string } }): Promise<TenantScopedPlayerSelfFormRow | null>;
}

export interface TenantScopedPlayerSelfWeekStatsRow {
  readonly id: string;
  readonly tenantPackId: string;
  readonly personId: string;
  readonly weekIso: string;
  readonly sessionsCompleted: number;
  readonly sessionsScheduled: number;
  readonly minutesPlayed: number;
  readonly sprintCount: number;
  readonly passAccuracyPressed: number | null;
  readonly vmaxKmh: number | null;
}
export interface TenantScopedPlayerSelfWeekStatsDelegate {
  findFirst(args: { where: { personId: string; weekIso: string } }): Promise<TenantScopedPlayerSelfWeekStatsRow | null>;
}

export interface TenantScopedPlayerSelfAcwrRow {
  readonly id: string;
  readonly tenantPackId: string;
  readonly personId: string;
  readonly acuteSrpeMinutes: number;
  readonly chronicSrpeMinutes: number;
  readonly ratio: number | null;
  readonly targetBandLow: number;
  readonly targetBandHigh: number;
  readonly trail: unknown; // Prisma Json; narrowed in the adapter mapper
  readonly computedAt: string;
}
export interface TenantScopedPlayerSelfAcwrDelegate {
  findFirst(args: { where: { personId: string } }): Promise<TenantScopedPlayerSelfAcwrRow | null>;
}
```

Add to `TenantScopedClient` (after `playerTraitValue`):

```ts
  readonly playerSelfPerson: TenantScopedPlayerSelfPersonDelegate;
  readonly playerSelfForm: TenantScopedPlayerSelfFormDelegate;
  readonly playerSelfWeekStats: TenantScopedPlayerSelfWeekStatsDelegate;
  readonly playerSelfAcwr: TenantScopedPlayerSelfAcwrDelegate;
```

- [ ] **Step 4: Hand-author the migration**

Create `prisma/migrations/20260601130000_add_player_self_aggregates/migration.sql`. Four `CREATE TABLE` blocks + per-table RLS, mirroring `20260601120000_add_player_trait_value` exactly (TEXT cuid columns, snake `tenant_pack_id`, `DOUBLE PRECISION` for Float, `INTEGER` for Int, `JSONB` for `trail`, `TEXT` for `computedAt`/`week_iso`/`team_id`/`tenant_id`). For EACH of the four tables: PK, the unique + secondary indexes per the model, `ENABLE` + `FORCE ROW LEVEL SECURITY`, a `<table>_tenant_pack_isolation` USING policy + `<table>_tenant_pack_isolation_write` FOR INSERT WITH CHECK policy on `current_setting('app.tenant_pack_id', true)`, and `GRANT SELECT, INSERT, UPDATE, DELETE ON "football"."<table>" TO app`. Index names follow Prisma's convention; the longest (`player_self_week_stats_tenant_pack_id_personId_idx`, 50 chars) is < 63.

Example for one table (replicate the shape for all four; `player_self_person` shown):

```sql
-- player_self_person
CREATE TABLE "football"."player_self_person" (
    "id" TEXT NOT NULL,
    "tenant_pack_id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "teamId" TEXT,
    CONSTRAINT "player_self_person_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "player_self_person_tenant_pack_id_personId_key" ON "football"."player_self_person"("tenant_pack_id", "personId");
CREATE INDEX "player_self_person_tenant_pack_id_idx" ON "football"."player_self_person"("tenant_pack_id");
ALTER TABLE "football"."player_self_person" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "football"."player_self_person" FORCE ROW LEVEL SECURITY;
CREATE POLICY player_self_person_tenant_pack_isolation ON "football"."player_self_person"
  USING ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));
CREATE POLICY player_self_person_tenant_pack_isolation_write ON "football"."player_self_person"
  FOR INSERT WITH CHECK ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "football"."player_self_person" TO app;
```

Use a top-of-file comment block matching the player-trait migration's header (forward-only, RLS rationale, snake-tenant_pack_id note). The `player_self_form` columns: `formIndex DOUBLE PRECISION`, `formTrend TEXT`, `load7d DOUBLE PRECISION`, `acwr DOUBLE PRECISION` (nullable), `rpeLatest DOUBLE PRECISION` (nullable), `computedAt TEXT`. `player_self_week_stats`: the four counts `INTEGER`, `passAccuracyPressed`/`vmaxKmh DOUBLE PRECISION` nullable, `week_iso TEXT`, with `UNIQUE("tenant_pack_id","personId","weekIso")` + indexes `(tenant_pack_id)` and `(tenant_pack_id, personId)`. `player_self_acwr`: `acuteSrpeMinutes`/`chronicSrpeMinutes`/`targetBandLow`/`targetBandHigh DOUBLE PRECISION`, `ratio DOUBLE PRECISION` nullable, `trail JSONB NOT NULL`, `computedAt TEXT`, unique `(tenant_pack_id, personId)`.

- [ ] **Step 5: (DB-gated) verify zero drift**

If a throwaway Postgres is reachable, provision (app role → `migrate deploy` → kernel/core SQL) and run:
```bash
npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma --shadow-database-url "$SHADOW_DATABASE_URL" --script
```
Expected: only the standing `kernel.event_log`/`outbox` diff; NO `player_self_*` statements. If `player_self_*` appears, copy the generated index names in. If no DB, SKIP and note it.

- [ ] **Step 6: Build (DB-free)**

Run: `npx nx build pack-football`
Expected: PASS (the widened `TenantScopedClient` + regenerated client typecheck).

- [ ] **Step 7: Commit**

```bash
git add prisma/packs/football.prisma libs/pack-football/src/out-ports/tenant-runner.port.ts "prisma/migrations/20260601130000_add_player_self_aggregates/migration.sql"
git commit -m "feat(pack-football): player_self_* tables + RLS migration + TenantScopedClient delegates"
```

---

### Task 5: ISO-week helper + composite `PrismaPlayerSelfRepository` + DB-gated spec

**Files:**
- Create: `libs/pack-football/src/out-ports/iso-week.ts`
- Create: `libs/pack-football/src/out-ports/iso-week.spec.ts`
- Create: `libs/pack-football/src/out-ports/prisma-player-self.repository.ts`
- Modify: `libs/pack-football/src/out-ports/player-self-repository.spec.ts`

- [ ] **Step 1: Write the ISO-week helper test**

`libs/pack-football/src/out-ports/iso-week.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isoWeekOf } from './iso-week.js';

describe('isoWeekOf', () => {
  it('computes the ISO-8601 week label', () => {
    expect(isoWeekOf(new Date('2026-05-14T12:00:00Z'))).toBe('2026-W20');
    // 2026-01-01 is a Thursday → ISO week 1 of 2026.
    expect(isoWeekOf(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
    // 2025-12-29 (Mon) belongs to ISO week 1 of 2026.
    expect(isoWeekOf(new Date('2025-12-29T00:00:00Z'))).toBe('2026-W01');
  });
});
```

- [ ] **Step 2: Run it (fail), then implement**

Run: `npx nx test pack-football -- iso-week` → FAIL (no module).

`libs/pack-football/src/out-ports/iso-week.ts`:

```ts
/**
 * ISO-8601 week label (`YYYY-Www`) for a date — the DB player-self adapter's
 * real-clock `currentWeekISO`. ISO weeks are Thursday-anchored.
 */
export function isoWeekOf(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // shift to the week's Thursday
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}
```

Run: `npx nx test pack-football -- iso-week` → PASS (1 test).

- [ ] **Step 3: Write the composite adapter**

`libs/pack-football/src/out-ports/prisma-player-self.repository.ts`:

```ts
/**
 * PrismaPlayerSelfRepository — composite Postgres adapter for `PlayerSelfRepository`
 * slice 1 (form / week-stats / ACWR), ADR-202 fan-out port #5.
 *
 * DB-backs the three flat aggregate reads + the RBAC primitives
 * (`personExists`/`findPersonTenantId`) over `football.player_self_*`, each
 * inside `runner.run(fn)` so RLS scoping is provable in the adapter; a foreign
 * tenant-pack is hidden by the `player_self_person_tenant_pack_isolation` policy,
 * so `findPersonTenantId` returns null and `authorizeSelfRead` yields
 * cross-tenant-read. The deferred list reads (recentSessions / weeklyBlocks /
 * matchDay) delegate to an internally-instantiated `InMemoryPlayerSelfRepository`
 * (the lineup-port composite precedent), which reads the same shared seed so the
 * demo stays coherent. `currentWeekISO` is the real ISO week (`isoWeekOf`).
 *
 * Source spec:
 *   `docs/superpowers/specs/2026-06-01-pack-football-player-self-aggregates-db-persistence-design.md` §5
 */

import { Inject, Injectable } from '@nestjs/common';

import type { PersonSubjectRef } from '../domain/subject-ref.js';
import type { MyACWRDTO, DailyLoadPoint } from '../in-ports/player-self/get-my-acwr.use-case.js';
import type { MyFormDTO, FormTrend } from '../in-ports/player-self/get-my-form.use-case.js';
import type { MyMatchDayDTO } from '../in-ports/player-self/get-my-match-day.use-case.js';
import type { MyWeekStatsDTO } from '../in-ports/player-self/get-my-week-stats.use-case.js';
import type { MyWeeklyBlocksResponse } from '../in-ports/player-self/get-my-weekly-blocks.use-case.js';
import { InMemoryPlayerSelfRepository } from './in-memory-player-self.repository.js';
import { isoWeekOf } from './iso-week.js';
import type { FindRecentSessionsResult, PlayerSelfRepository } from './player-self.repository.js';
import {
  toMyACWRDTO,
  toMyFormDTO,
  toMyWeekStatsDTO,
  type StoredPlayerSelfAcwr,
  type StoredPlayerSelfForm,
  type StoredPlayerSelfWeekStats,
} from './player-self-seed.js';
import {
  TENANT_RUNNER,
  type TenantRunner,
  type TenantScopedPlayerSelfAcwrRow,
  type TenantScopedPlayerSelfFormRow,
  type TenantScopedPlayerSelfWeekStatsRow,
} from './tenant-runner.port.js';

@Injectable()
export class PrismaPlayerSelfRepository implements PlayerSelfRepository {
  /** Composed double for the deferred reads; reads the same shared seed. */
  private readonly fallback = new InMemoryPlayerSelfRepository();

  constructor(@Inject(TENANT_RUNNER) private readonly runner: TenantRunner) {}

  async personExists(personRef: PersonSubjectRef): Promise<boolean> {
    return this.runner.run(async (tx) => {
      const row = await tx.playerSelfPerson.findFirst({ where: { personId: personRef.id } });
      return row !== null;
    });
  }

  async findPersonTenantId(personRef: PersonSubjectRef): Promise<string | null> {
    return this.runner.run(async (tx) => {
      const row = await tx.playerSelfPerson.findFirst({ where: { personId: personRef.id } });
      return row?.tenantId ?? null;
    });
  }

  async findForm(personRef: PersonSubjectRef): Promise<MyFormDTO | null> {
    return this.runner.run(async (tx) => {
      const row = await tx.playerSelfForm.findFirst({ where: { personId: personRef.id } });
      return row ? toMyFormDTO(formRowToStored(row)) : null;
    });
  }

  async findWeekStats(personRef: PersonSubjectRef, weekISO: string): Promise<MyWeekStatsDTO | null> {
    return this.runner.run(async (tx) => {
      const row = await tx.playerSelfWeekStats.findFirst({ where: { personId: personRef.id, weekIso: weekISO } });
      return row ? toMyWeekStatsDTO(weekStatsRowToStored(row)) : null;
    });
  }

  async findACWR(personRef: PersonSubjectRef): Promise<MyACWRDTO | null> {
    return this.runner.run(async (tx) => {
      const row = await tx.playerSelfAcwr.findFirst({ where: { personId: personRef.id } });
      return row ? toMyACWRDTO(acwrRowToStored(row)) : null;
    });
  }

  // ─── deferred reads delegate to the composed in-memory double ──────────────
  async findRecentSessions(personRef: PersonSubjectRef, limit: number): Promise<FindRecentSessionsResult> {
    return this.fallback.findRecentSessions(personRef, limit);
  }
  async findWeeklyBlocks(personRef: PersonSubjectRef, weekISO: string): Promise<MyWeeklyBlocksResponse | null> {
    return this.fallback.findWeeklyBlocks(personRef, weekISO);
  }
  async findMatchDay(personRef: PersonSubjectRef, teamId: string): Promise<MyMatchDayDTO | null> {
    return this.fallback.findMatchDay(personRef, teamId);
  }

  currentWeekISO(): string {
    return isoWeekOf(new Date());
  }
}

function formRowToStored(row: TenantScopedPlayerSelfFormRow): StoredPlayerSelfForm {
  return {
    personId: row.personId,
    formIndex: row.formIndex,
    formTrend: row.formTrend as FormTrend,
    load7d: row.load7d,
    acwr: row.acwr,
    rpeLatest: row.rpeLatest,
    computedAt: row.computedAt,
  };
}

function weekStatsRowToStored(row: TenantScopedPlayerSelfWeekStatsRow): StoredPlayerSelfWeekStats {
  return {
    personId: row.personId,
    weekIso: row.weekIso,
    sessionsCompleted: row.sessionsCompleted,
    sessionsScheduled: row.sessionsScheduled,
    minutesPlayed: row.minutesPlayed,
    sprintCount: row.sprintCount,
    passAccuracyPressed: row.passAccuracyPressed,
    vmaxKmh: row.vmaxKmh,
  };
}

function acwrRowToStored(row: TenantScopedPlayerSelfAcwrRow): StoredPlayerSelfAcwr {
  return {
    personId: row.personId,
    acuteSrpeMinutes: row.acuteSrpeMinutes,
    chronicSrpeMinutes: row.chronicSrpeMinutes,
    ratio: row.ratio,
    targetBandLow: row.targetBandLow,
    targetBandHigh: row.targetBandHigh,
    trail: row.trail as readonly DailyLoadPoint[],
    computedAt: row.computedAt,
  };
}
```

Note: `currentWeekISO` is real-clock — the default-week `getMyWeekStats` path returns not-found unless the live week is seeded (accepted per spec §9). The contract always passes an explicit week.

- [ ] **Step 4: Build**

Run: `npx nx build pack-football` → PASS.

- [ ] **Step 5: Add the DB-gated block to the spec**

Replace `libs/pack-football/src/out-ports/player-self-repository.spec.ts` with the two-block version (mirror `player-trait-repository.spec.ts`):

```ts
/**
 * Player-self-repository conformance — runs the shared
 * `playerSelfRepositoryContract` against both adapters (slice 1):
 *  - InMemoryPlayerSelfRepository — always (CI stays DB-free).
 *  - PrismaPlayerSelfRepository over a GucPrismaRunner-backed TenantRunner —
 *    DB-GATED on `SUBSTRATE_APP_DATABASE_URL`. Seeds the four player_self_*
 *    tables under THIS SPEC'S OWN tenant-pack, then proves RLS-scoped parity +
 *    a foreign tenant sees nothing.
 *
 * Run locally: `npm run test:db`.
 */

import { PrismaClient } from '@prisma/client';
import { GucPrismaRunner } from '@de-braighter/substrate-runtime';
import { afterAll, beforeAll, describe } from 'vitest';

import { InMemoryPlayerSelfRepository } from './in-memory-player-self.repository.js';
import { PrismaPlayerSelfRepository } from './prisma-player-self.repository.js';
import {
  seedStoredPlayerSelfPersons,
  seedStoredPlayerSelfForms,
  seedStoredPlayerSelfWeekStats,
  seedStoredPlayerSelfAcwrs,
} from './player-self-seed.js';
import {
  playerSelfRepositoryContract,
  playerSelfRepositoryIsolationContract,
} from './player-self-repository.contract.js';
import type { TenantRunner, TenantScopedClient } from './tenant-runner.port.js';

const SELF_TENANT_PACK_ID = '5c5c5c5c-0000-4000-8000-5c0a55ed0005';
const OTHER_TENANT_PACK_ID = 'd1f7c0de-0000-4000-8000-0000000000ff';

function repoScopedTo(app: PrismaClient, tenantPackId: string): PrismaPlayerSelfRepository {
  const guc = new GucPrismaRunner(app as never);
  const runner: TenantRunner = {
    run: (fn) => guc.run(tenantPackId, (tx) => fn(tx as unknown as TenantScopedClient)),
  };
  return new PrismaPlayerSelfRepository(runner);
}

const APP_URL = process.env['SUBSTRATE_APP_DATABASE_URL'];
const ADMIN_URL = process.env['DATABASE_URL'];

playerSelfRepositoryContract('InMemoryPlayerSelfRepository', () => ({
  repo: new InMemoryPlayerSelfRepository(),
}));

describe.skipIf(!APP_URL || !ADMIN_URL)(
  'PrismaPlayerSelfRepository (live football.player_self_*, app role)',
  () => {
    let app: PrismaClient;
    let admin: PrismaClient;
    let repo: PrismaPlayerSelfRepository;
    let foreignRepo: PrismaPlayerSelfRepository;

    beforeAll(async () => {
      app = new PrismaClient({ datasources: { db: { url: APP_URL } } });
      admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });

      for (const t of ['player_self_acwr', 'player_self_week_stats', 'player_self_form', 'player_self_person']) {
        await admin.$executeRawUnsafe(`DELETE FROM football.${t} WHERE "tenant_pack_id" = $1`, SELF_TENANT_PACK_ID);
      }
      for (const p of seedStoredPlayerSelfPersons()) {
        await admin.playerSelfPerson.create({ data: { tenantPackId: SELF_TENANT_PACK_ID, personId: p.personId, tenantId: p.tenantId, teamId: p.teamId } });
      }
      for (const f of seedStoredPlayerSelfForms()) {
        await admin.playerSelfForm.create({ data: { tenantPackId: SELF_TENANT_PACK_ID, ...f } });
      }
      for (const w of seedStoredPlayerSelfWeekStats()) {
        await admin.playerSelfWeekStats.create({ data: { tenantPackId: SELF_TENANT_PACK_ID, ...w } });
      }
      for (const a of seedStoredPlayerSelfAcwrs()) {
        await admin.playerSelfAcwr.create({ data: { tenantPackId: SELF_TENANT_PACK_ID, personId: a.personId, acuteSrpeMinutes: a.acuteSrpeMinutes, chronicSrpeMinutes: a.chronicSrpeMinutes, ratio: a.ratio, targetBandLow: a.targetBandLow, targetBandHigh: a.targetBandHigh, trail: a.trail as unknown as object, computedAt: a.computedAt } });
      }

      repo = repoScopedTo(app, SELF_TENANT_PACK_ID);
      foreignRepo = repoScopedTo(app, OTHER_TENANT_PACK_ID);
    });

    afterAll(async () => {
      for (const t of ['player_self_acwr', 'player_self_week_stats', 'player_self_form', 'player_self_person']) {
        await admin.$executeRawUnsafe(`DELETE FROM football.${t} WHERE "tenant_pack_id" = $1`, SELF_TENANT_PACK_ID);
      }
      await app.$disconnect();
      await admin.$disconnect();
    });

    playerSelfRepositoryContract('PrismaPlayerSelfRepository', () => ({ repo }));
    playerSelfRepositoryIsolationContract('PrismaPlayerSelfRepository', () => ({ ownRepo: repo, foreignRepo }));
  },
);
```

- [ ] **Step 6: Run DB-free + commit**

Run: `npx nx test pack-football -- player-self-repository` → PASS (in-memory 5 tests; Prisma block skipped). Run `npx nx build pack-football` + `npx nx lint pack-football` → PASS.

```bash
git add libs/pack-football/src/out-ports/iso-week.ts libs/pack-football/src/out-ports/iso-week.spec.ts libs/pack-football/src/out-ports/prisma-player-self.repository.ts libs/pack-football/src/out-ports/player-self-repository.spec.ts
git commit -m "feat(pack-football): composite PrismaPlayerSelfRepository + isoWeek helper + DB-gated spec"
```

---

### Task 6: Flag-gate the `PLAYER_SELF_REPOSITORY` binding

**Files:**
- Modify: `libs/pack-football/src/pack-football.module.ts`

- [ ] **Step 1: Import + provider factory**

Add the import near the other Prisma out-port imports:

```ts
import { PrismaPlayerSelfRepository } from './out-ports/prisma-player-self.repository.js';
```

Add the factory after `playerTraitRepositoryProviders`:

```ts
/**
 * `PLAYER_SELF_REPOSITORY` binding — flag-gated per ADR-202 (port #5 of the
 * fan-out, slice 1: form / week-stats / ACWR; exercir#142). Default (flag off):
 * the in-memory double. On: the composite `PrismaPlayerSelfRepository` (DB for
 * the three aggregate reads + RBAC primitives; deferred list reads delegate to
 * an internal in-memory double). It injects `TENANT_RUNNER` from the host.
 */
export function playerSelfRepositoryProviders(useDb: boolean): Provider[] {
  if (useDb) {
    return [
      PrismaPlayerSelfRepository,
      { provide: PLAYER_SELF_REPOSITORY, useExisting: PrismaPlayerSelfRepository },
    ];
  }
  return [
    InMemoryPlayerSelfRepository,
    { provide: PLAYER_SELF_REPOSITORY, useExisting: InMemoryPlayerSelfRepository },
  ];
}
```

- [ ] **Step 2: Replace the unconditional binding**

In `buildProviders`, the current player-self binding is:

```ts
    InMemoryPlayerSelfRepository,
    {
      provide: PLAYER_SELF_REPOSITORY,
      useExisting: InMemoryPlayerSelfRepository,
    },
```

Replace those lines with:

```ts
    ...playerSelfRepositoryProviders(isPackCrudDbFlagEnabled()),
```

- [ ] **Step 3: Build + full suite**

Run: `npx nx build pack-football` → PASS. Run `npx nx test pack-football` → PASS (flag-off default keeps in-memory; the 6 player-self service use-cases stay green).

- [ ] **Step 4: Commit**

```bash
git add libs/pack-football/src/pack-football.module.ts
git commit -m "feat(pack-football): flag-gate PLAYER_SELF_REPOSITORY onto composite PrismaPlayerSelfRepository"
```

---

### Task 7: Seed the four `player_self_*` tables

**Files:**
- Modify: `prisma/seed/football-seed.ts`

- [ ] **Step 1: Import + `seedPlayerSelf`**

Add the import next to the player-trait seed import:

```ts
import {
  seedStoredPlayerSelfPersons,
  seedStoredPlayerSelfForms,
  seedStoredPlayerSelfWeekStats,
  seedStoredPlayerSelfAcwrs,
} from '../../libs/pack-football/src/out-ports/player-self-seed.js';
```

Add the function after `seedPlayerTraits` (mirroring its shape — own tx + GUC via `reseedScoped`, delete-then-insert scoped to the tenant-pack):

```ts
/**
 * Seed the three pilot persons' player-self aggregates into the four
 * `football.player_self_*` tables under the demo squad tenant-pack — the read
 * source for the live composite `PrismaPlayerSelfRepository`. Same GUC as the
 * squad seed. Idempotent: delete-then-insert scoped to the tenant-pack. Rows
 * come from the shared seed so the live rows match the in-memory double + the
 * contract suite. `tenant_id` (org) = SEEDED_FC_LANGGASSE_TENANT_ID; the demo
 * principal authorises against it.
 */
async function seedPlayerSelf(prisma: PrismaClient): Promise<number> {
  return reseedScoped(prisma, SQUAD_TENANT_PACK_ID, async (tx) => {
    for (const t of ['player_self_acwr', 'player_self_week_stats', 'player_self_form', 'player_self_person']) {
      await tx.$executeRawUnsafe(`DELETE FROM football.${t} WHERE "tenant_pack_id" = $1`, SQUAD_TENANT_PACK_ID);
    }
    const persons = seedStoredPlayerSelfPersons();
    for (const p of persons) {
      await tx.playerSelfPerson.create({ data: { tenantPackId: SQUAD_TENANT_PACK_ID, personId: p.personId, tenantId: p.tenantId, teamId: p.teamId } });
    }
    for (const f of seedStoredPlayerSelfForms()) {
      await tx.playerSelfForm.create({ data: { tenantPackId: SQUAD_TENANT_PACK_ID, ...f } });
    }
    for (const w of seedStoredPlayerSelfWeekStats()) {
      await tx.playerSelfWeekStats.create({ data: { tenantPackId: SQUAD_TENANT_PACK_ID, ...w } });
    }
    for (const a of seedStoredPlayerSelfAcwrs()) {
      await tx.playerSelfAcwr.create({ data: { tenantPackId: SQUAD_TENANT_PACK_ID, personId: a.personId, acuteSrpeMinutes: a.acuteSrpeMinutes, chronicSrpeMinutes: a.chronicSrpeMinutes, ratio: a.ratio, targetBandLow: a.targetBandLow, targetBandHigh: a.targetBandHigh, trail: a.trail as unknown as object, computedAt: a.computedAt } });
    }
    return persons.length;
  });
}
```

- [ ] **Step 2: Call it + export**

In `seedFootball`, after the player-trait block:

```ts
    const selfCount = await seedPlayerSelf(prisma);
    process.stdout.write(`football seed: ${selfCount} player-self persons\n`);
```

Add `seedPlayerSelf,` to the bottom `export { ... }` block.

- [ ] **Step 3: Typecheck**

Run: `npx nx build pack-football` → PASS (the seed's imported symbols + the four `playerSelf*` delegates typecheck). If a DB is available: `npm run db:seed:football` → output includes `football seed: 3 player-self persons` + `football seed: OK`. Else SKIP + note.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed/football-seed.ts
git commit -m "feat(pack-football): seed player_self_* aggregates for the three pilot persons"
```

---

### Task 8: Final verification + story + PR

- [ ] **Step 1: DB-free gate**

Run: `npm run ci:local` → build + lint + test all PASS (DB-gated blocks skipped).

- [ ] **Step 2: Diff scope**

Run: `git diff --name-status main...HEAD` → exactly the 13 files in the File Structure table (8 created + 5 modified, counting the spec files). Nothing else.

- [ ] **Step 3: Story issue**

```bash
gh issue create --repo de-braighter/exercir \
  --title "player-self DB persistence slice 1 (form/week-stats/ACWR) — fan-out port #5" \
  --body "Composite PrismaPlayerSelfRepository over four football.player_self_* tables (OQ-5 Option B, slice 1). Deferred reads (sessions/blocks/match-day) delegate to a composed in-memory double — follow-on slices. Part of epic #142.

Tech design: docs/superpowers/specs/2026-06-01-pack-football-player-self-aggregates-db-persistence-design.md"
```

Note the returned `<STORY#>`.

- [ ] **Step 4: Push + PR**

```bash
git push -u origin HEAD
```

```bash
gh pr create --repo de-braighter/exercir \
  --title "feat(pack-football): player-self DB persistence slice 1 (form/week-stats/ACWR) — fan-out port #5" \
  --body "Closes #<STORY#>

Composite \`PrismaPlayerSelfRepository\` (OQ-5 Option B, ADR-202 fan-out port #5, slice 1). Four \`football.player_self_*\` tables (person registry + form + week-stats + ACWR); DB-backs the three flat aggregate reads + the RBAC primitives + real-clock currentWeekISO; the deferred list reads delegate to a composed in-memory double. Shared \`player-self-seed\` drives both adapters + the seed through one contract suite. Bound under \`PACK_FOOTBALL_PACK_CRUD_DB\`; in-memory stays the flag-off default.

Tech design: docs/superpowers/specs/2026-06-01-pack-football-player-self-aggregates-db-persistence-design.md

Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]
Effect: duplication 0±0.3 expert
Effect: coverage 0±0.6 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

(`gh pr edit` fails on the no-read:org token — use `gh api repos/de-braighter/exercir/pulls/<N> -X PATCH -f body=...` for later edits.)

- [ ] **Step 5: Verifier wave**

Dispatch `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker` (read-only reviewers read the exercir clone at the feat checkout; do not switch branches). Address blocking findings before merge.

---

## Self-Review (completed against the spec)

**Spec coverage:** §1.2 RBAC → Tasks 4 (registry table) + 5 (DB `findPersonTenantId`/`personExists`). §2 snapshot pattern → Tasks 4–7. §2.2 composite + JSONB trail + text computedAt → Tasks 4 (schema) + 5 (adapter). §3.1–3.4 four tables → Task 4. §4 shared seed + mappers → Tasks 1–2. §5 composite adapter + real-clock currentWeekISO → Task 5. §6 wiring + seed → Tasks 6–7. §7 contract + DB-gated isolation → Tasks 3 + 5. §9 deferred reads → delegated (Task 5), not built. §10 acceptance → covered across Tasks 1–7. ✅

**Placeholder scan:** the only `TRANSCRIBE` markers (Task 1 seed arrays, Task 4 migration tables) are deliberate "preserve exact values from the existing double / replicate the shown shape" instructions with the source named + the reviewer verifying — not vague TODOs. The `<ts>` migration timestamp is the standard convention. ✅

**Type consistency:** `Stored*` types (Task 1) consumed identically by the mappers (Task 1), the in-memory double (Task 2), the adapter's `*RowToStored` (Task 5), and the seed (Task 7); `toMyFormDTO`/`toMyWeekStatsDTO`/`toMyACWRDTO` signatures stable across Tasks 1/3/5; `TenantScopedPlayerSelf*Row`/`Delegate` (Task 4) match the adapter's row mappers (Task 5); `playerSelfRepositoryProviders` (Task 6) mirrors `playerTraitRepositoryProviders`; the stored `weekIso` ↔ DTO `weekISO` rename is called out explicitly. ✅
