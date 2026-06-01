# Pack-football player-trait DB persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the `PlayerTraitRepository` a Postgres-backed adapter over a new `football.player_trait_value` snapshot table, behind the umbrella `PACK_FOOTBALL_PACK_CRUD_DB` flag — the keystone Option-B resolution of OQ-5 for the ADR-202 fan-out.

**Architecture:** A **derived-rollup snapshot** table holds the per-player trait `value` the port already returns (the in-memory seed values — no new math, OQ-5 Option B). A shared `player-trait-seed.ts` module is the single source of truth that the in-memory double, the Prisma adapter, and the DB seed all consume, so one contract suite proves byte-for-byte parity. The Prisma adapter injects only `TENANT_RUNNER`, so RLS scoping is provable in the adapter. `label` stops being row data and becomes a `TRAIT_LABEL` catalog keyed by `traitKey`.

**Tech Stack:** TypeScript, NestJS 10, Prisma 6 (multi-schema, `football.*`), PostgreSQL 16 RLS, vitest, Nx 22. Pattern mirror: the just-merged `player-movement` port (#145).

**Source spec:** `docs/superpowers/specs/2026-06-01-pack-football-player-trait-db-persistence-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `libs/pack-football/src/manifest/trait-label.ts` | Create | `TRAIT_LABEL: Record<TraitKey, string>` catalog constant |
| `libs/pack-football/src/manifest/trait-label.spec.ts` | Create | Asserts every `TraitKey` has a label |
| `libs/pack-football/src/out-ports/player-trait-seed.ts` | Create | Shared seed fixtures + `StoredPlayerTraitValue` + `toPlayerTraitProfile` mapper |
| `libs/pack-football/src/out-ports/in-memory-player-trait.repository.ts` | Modify | Refactor to consume the seed module; re-export the 3 player-id constants |
| `libs/pack-football/src/out-ports/player-trait-repository.contract.ts` | Create | Shared contract + isolation suites both adapters pass |
| `libs/pack-football/src/out-ports/player-trait-repository.spec.ts` | Create | Runs the contract against in-memory (always) + Prisma (DB-gated) |
| `prisma/packs/football.prisma` | Modify | Add the `PlayerTraitValue` model |
| `prisma/migrations/20260601120000_add_player_trait_value/migration.sql` | Create | Hand-authored `CREATE TABLE` + RLS + GRANT |
| `libs/pack-football/src/out-ports/tenant-runner.port.ts` | Modify | Add `playerTraitValue` delegate + `TenantScopedPlayerTraitValueRow` |
| `libs/pack-football/src/out-ports/prisma-player-trait.repository.ts` | Create | The Postgres-backed adapter |
| `libs/pack-football/src/pack-football.module.ts` | Modify | Flag-gate `PLAYER_TRAIT_REPOSITORY` binding |
| `prisma/seed/football-seed.ts` | Modify | `seedPlayerTraits` writes `player_trait_value` rows for the 4 pilot players |

---

## Reference patterns (read before starting)

- **Adapter mirror:** `libs/pack-football/src/out-ports/prisma-player-movement.repository.ts`
- **Seed-module mirror:** `libs/pack-football/src/out-ports/player-movement-seed.ts`
- **Contract mirror:** `libs/pack-football/src/out-ports/player-movement-repository.contract.ts`
- **DB-gated spec mirror:** `libs/pack-football/src/out-ports/player-movement-repository.spec.ts`
- **Migration mirror:** `prisma/migrations/20260530215947_add_football_player/migration.sql`
- **Module flag-gate mirror:** `playerMovementRepositoryProviders` in `pack-football.module.ts`
- **Seed-fn mirror:** `seedPlayerMovements` in `prisma/seed/football-seed.ts`

All imports inside `libs/pack-football` use explicit `.js` extensions (ESM). The lib must NOT hard-import `@prisma/client` — the Prisma slice is structural (`TenantScopedClient`).

---

### Task 1: `TRAIT_LABEL` catalog constant

**Files:**
- Create: `libs/pack-football/src/manifest/trait-label.ts`
- Test: `libs/pack-football/src/manifest/trait-label.spec.ts`

- [ ] **Step 1: Write the failing test**

`libs/pack-football/src/manifest/trait-label.spec.ts`:

```ts
/**
 * TRAIT_LABEL catalog — every canonical TraitKey resolves to its German
 * domain label. The label is a property of the trait key, not of a player,
 * so it lives in the manifest catalog (not the player_trait_value table).
 */

import { describe, expect, it } from 'vitest';

import { TraitKeySchema, type TraitKey } from './trait-cluster.types.js';
import { TRAIT_LABEL } from './trait-label.js';

describe('TRAIT_LABEL', () => {
  it('has a non-empty label for every canonical TraitKey', () => {
    for (const traitKey of TraitKeySchema.options as TraitKey[]) {
      expect(TRAIT_LABEL[traitKey], traitKey).toBeTruthy();
    }
  });

  it('carries the five FC Länggasse domain terms', () => {
    expect(TRAIT_LABEL['sport-science.trait.speed']).toBe('Schnelligkeit');
    expect(TRAIT_LABEL['sport-science.trait.agility']).toBe('Agilität');
    expect(TRAIT_LABEL['sport-science.trait.technique']).toBe('Technik');
    expect(TRAIT_LABEL['sport-science.trait.repsprint']).toBe(
      'Wiederholungssprints',
    );
    expect(TRAIT_LABEL['sport-science.trait.gameiq']).toBe('Spielverständnis');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football -- trait-label`
Expected: FAIL — cannot find module `./trait-label.js`.

- [ ] **Step 3: Write minimal implementation**

`libs/pack-football/src/manifest/trait-label.ts`:

```ts
/**
 * TRAIT_LABEL — the German domain label for each cross-pack TraitKey.
 *
 * `label` is a property of the trait key (ADR-164 Commitment 3), not of a
 * player. It previously lived inline in the in-memory player-trait seed; the
 * OQ-5 Option-B `player_trait_value` snapshot does NOT store it (it is catalog
 * data keyed by traitKey). Both player-trait adapters resolve `label` from here
 * via `toPlayerTraitProfile`.
 *
 * Source spec:
 *   `docs/superpowers/specs/2026-06-01-pack-football-player-trait-db-persistence-design.md` §4
 */

import { type TraitKey } from './trait-cluster.types.js';

export const TRAIT_LABEL: Record<TraitKey, string> = {
  'sport-science.trait.speed': 'Schnelligkeit',
  'sport-science.trait.agility': 'Agilität',
  'sport-science.trait.technique': 'Technik',
  'sport-science.trait.repsprint': 'Wiederholungssprints',
  'sport-science.trait.gameiq': 'Spielverständnis',
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football -- trait-label`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football/src/manifest/trait-label.ts libs/pack-football/src/manifest/trait-label.spec.ts
git commit -m "feat(pack-football): TRAIT_LABEL catalog — label as trait-key data not row data"
```

---

### Task 2: Shared `player-trait-seed.ts` + refactor the in-memory double

**Files:**
- Create: `libs/pack-football/src/out-ports/player-trait-seed.ts`
- Modify: `libs/pack-football/src/out-ports/in-memory-player-trait.repository.ts`
- Test: `libs/pack-football/src/out-ports/player-trait-seed.spec.ts`

**Note:** the in-memory double currently embeds the seed (the `STUDER`/`CAPREZ`/`RODUIT`/`CAMENZIND` `SeedProfile`s + `toProfile`) and exports `SEEDED_MATEO_CAPREZ_PLAYER_ID`, `SEEDED_BASTIEN_RODUIT_PLAYER_ID`, `SEEDED_FLORIN_CAMENZIND_PLAYER_ID`. `player-movement-seed.ts` imports those three id constants from this file, so the refactor must KEEP them exported from `in-memory-player-trait.repository.ts` (re-export from the seed module) to avoid breaking the movement seed.

- [ ] **Step 1: Write the failing test**

`libs/pack-football/src/out-ports/player-trait-seed.spec.ts`:

```ts
/**
 * player-trait-seed — the shared fixtures + row→profile mapper behind both
 * player-trait adapters. Asserts the mapper groups one player's rows into the
 * profile shape and resolves labels from TRAIT_LABEL.
 */

import { describe, expect, it } from 'vitest';

import { SEEDED_LEVIN_STUDER_PLAYER_ID } from './in-memory-funnel.repository.js';
import {
  seedStoredPlayerTraitValues,
  seedStoredPlayerTraitsFor,
  seededTraitPlayerIds,
  toPlayerTraitProfile,
} from './player-trait-seed.js';

describe('player-trait-seed', () => {
  it('seeds the four pilot players', () => {
    expect(seededTraitPlayerIds()).toHaveLength(4);
    expect(seededTraitPlayerIds()).toContain(SEEDED_LEVIN_STUDER_PLAYER_ID);
  });

  it('maps Studer rows into a five-trait profile with resolved labels', () => {
    const profile = toPlayerTraitProfile(
      seedStoredPlayerTraitsFor(SEEDED_LEVIN_STUDER_PLAYER_ID),
    );
    expect(profile).not.toBeNull();
    expect(profile?.playerId).toBe(SEEDED_LEVIN_STUDER_PLAYER_ID);
    expect(profile?.position).toBe('6er');
    expect(profile?.ageBand).toBe('U19');
    expect(profile?.traits).toHaveLength(5);
    const speed = profile?.traits.find(
      (t) => t.traitKey === 'sport-science.trait.speed',
    );
    expect(speed?.label).toBe('Schnelligkeit');
    expect(speed?.value).toBe(66);
  });

  it('returns null for an empty row set (unseeded player)', () => {
    expect(toPlayerTraitProfile([])).toBeNull();
  });

  it('emits one row per (player, trait) across the seed', () => {
    // 4 players × 5 traits each.
    expect(seedStoredPlayerTraitValues()).toHaveLength(20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football -- player-trait-seed`
Expected: FAIL — cannot find module `./player-trait-seed.js`.

- [ ] **Step 3: Write the seed module**

`libs/pack-football/src/out-ports/player-trait-seed.ts`:

```ts
/**
 * The FC Länggasse U19 player-trait seed + the row→profile mapping shared by
 * the in-memory and Prisma player-trait adapters and the football DB seed.
 *
 * Single source of truth for the per-player trait posterior snapshot of the
 * four pilot players (Studer, Caprez, Roduit, Camenzind), so the in-memory test
 * double, the live `football.player_trait_value` rows, and the contract suite
 * all agree on identity and field shape (pack-crud-repository-pattern.md §5.5
 * test-double parity).
 *
 * OQ-5 Option B (derived-rollup snapshot): the stored `value` IS the posterior
 * median the port already returned — no new compute logic. `bar` (0..1, from
 * the Claude Design `FC_PLAYERS`) is the provenance; `value` is `round(bar*100)`
 * to match the cluster overlay's 0..100 percentile scale (ADR-164 Commitment 1).
 * `label` is NOT carried per row — it is resolved from TRAIT_LABEL by traitKey.
 *
 * Source spec:
 *   `docs/superpowers/specs/2026-06-01-pack-football-player-trait-db-persistence-design.md`
 */

import { TRAIT_LABEL } from '../manifest/trait-label.js';
import {
  type AgeBand,
  type PositionClusterKey,
  type TraitKey,
} from '../manifest/trait-cluster.types.js';
import { SEEDED_LEVIN_STUDER_PLAYER_ID } from './in-memory-funnel.repository.js';
import {
  type PlayerTraitProfile,
  type PlayerTraitRow,
} from './player-trait.repository.js';

// Player ids — Studer comes from the funnel seed; the other three are defined
// here as the canonical source and re-exported by the in-memory double for
// back-compat (player-movement-seed imports them from there).
export const SEEDED_MATEO_CAPREZ_PLAYER_ID =
  '00000010-0000-4000-8000-fc1a55e10010';
export const SEEDED_BASTIEN_RODUIT_PLAYER_ID =
  '00000021-0000-4000-8000-fc1a55e10021';
export const SEEDED_FLORIN_CAMENZIND_PLAYER_ID =
  '00000022-0000-4000-8000-fc1a55e10022';

interface SeedTrait {
  traitKey: TraitKey;
  // 0..1 in the Claude Design; normalised to 0..100 to match the cluster
  // overlay's percentile scale (ADR-164 Commitment 1).
  bar: number;
}

interface SeedProfile {
  playerId: string;
  position: PositionClusterKey;
  ageBand: AgeBand;
  traits: SeedTrait[];
}

const STUDER: SeedProfile = {
  playerId: SEEDED_LEVIN_STUDER_PLAYER_ID,
  position: '6er',
  ageBand: 'U19',
  traits: [
    { traitKey: 'sport-science.trait.speed', bar: 0.66 },
    { traitKey: 'sport-science.trait.agility', bar: 0.74 },
    { traitKey: 'sport-science.trait.technique', bar: 0.81 },
    { traitKey: 'sport-science.trait.repsprint', bar: 0.72 },
    { traitKey: 'sport-science.trait.gameiq', bar: 0.85 },
  ],
};

const CAPREZ: SeedProfile = {
  playerId: SEEDED_MATEO_CAPREZ_PLAYER_ID,
  position: '10er',
  ageBand: 'U19',
  traits: [
    { traitKey: 'sport-science.trait.speed', bar: 0.74 },
    { traitKey: 'sport-science.trait.agility', bar: 0.84 },
    { traitKey: 'sport-science.trait.technique', bar: 0.92 },
    { traitKey: 'sport-science.trait.repsprint', bar: 0.66 },
    { traitKey: 'sport-science.trait.gameiq', bar: 0.9 },
  ],
};

const RODUIT: SeedProfile = {
  playerId: SEEDED_BASTIEN_RODUIT_PLAYER_ID,
  position: 'IV',
  ageBand: 'U19',
  traits: [
    { traitKey: 'sport-science.trait.speed', bar: 0.7 },
    { traitKey: 'sport-science.trait.agility', bar: 0.68 },
    { traitKey: 'sport-science.trait.technique', bar: 0.72 },
    { traitKey: 'sport-science.trait.repsprint', bar: 0.78 },
    { traitKey: 'sport-science.trait.gameiq', bar: 0.74 },
  ],
};

const CAMENZIND: SeedProfile = {
  playerId: SEEDED_FLORIN_CAMENZIND_PLAYER_ID,
  position: '10er',
  ageBand: 'U19',
  traits: [
    { traitKey: 'sport-science.trait.speed', bar: 0.6 },
    { traitKey: 'sport-science.trait.agility', bar: 0.66 },
    { traitKey: 'sport-science.trait.technique', bar: 0.78 },
    { traitKey: 'sport-science.trait.repsprint', bar: 0.58 },
    { traitKey: 'sport-science.trait.gameiq', bar: 0.76 },
  ],
};

const SEED_BY_PLAYER: Record<string, SeedProfile> = {
  [SEEDED_LEVIN_STUDER_PLAYER_ID]: STUDER,
  [SEEDED_MATEO_CAPREZ_PLAYER_ID]: CAPREZ,
  [SEEDED_BASTIEN_RODUIT_PLAYER_ID]: RODUIT,
  [SEEDED_FLORIN_CAMENZIND_PLAYER_ID]: CAMENZIND,
};

/**
 * The narrow stored-trait shape both adapters map from (1:1 with the
 * `football.player_trait_value` table grain — one row per player/trait).
 */
export interface StoredPlayerTraitValue {
  id: string;
  playerId: string;
  position: PositionClusterKey;
  ageBand: AgeBand;
  traitKey: TraitKey;
  value: number;
}

function expand(seed: SeedProfile): StoredPlayerTraitValue[] {
  return seed.traits.map((t, idx) => ({
    id: `pt-${seed.playerId.slice(0, 8)}-${idx.toString().padStart(3, '0')}`,
    playerId: seed.playerId,
    position: seed.position,
    ageBand: seed.ageBand,
    traitKey: t.traitKey,
    value: Math.round(t.bar * 100),
  }));
}

/**
 * Group one player's stored trait rows into a `PlayerTraitProfile`, or null
 * when there are no rows (unseeded player). `position`/`ageBand` are a stable
 * per-player attribute, read from the first row; `label` resolves from
 * TRAIT_LABEL by traitKey.
 */
export function toPlayerTraitProfile(
  rows: readonly StoredPlayerTraitValue[],
): PlayerTraitProfile | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;
  const traits: PlayerTraitRow[] = rows.map((row) => ({
    traitKey: row.traitKey,
    label: TRAIT_LABEL[row.traitKey],
    value: row.value,
  }));
  return {
    playerId: first.playerId,
    position: first.position,
    ageBand: first.ageBand,
    traits,
  };
}

/** The stored trait rows for one seeded player; empty array if unseeded. */
export function seedStoredPlayerTraitsFor(
  playerId: string,
): StoredPlayerTraitValue[] {
  const seed = SEED_BY_PLAYER[playerId];
  return seed ? expand(seed) : [];
}

/** The player ids that carry a seeded trait profile (the four pilot players). */
export function seededTraitPlayerIds(): string[] {
  return Object.keys(SEED_BY_PLAYER);
}

/** Every seeded trait row across all four pilot players. */
export function seedStoredPlayerTraitValues(): StoredPlayerTraitValue[] {
  return Object.values(SEED_BY_PLAYER).flatMap(expand);
}
```

- [ ] **Step 4: Refactor the in-memory double to consume the seed**

Replace the entire body of `libs/pack-football/src/out-ports/in-memory-player-trait.repository.ts` with:

```ts
/**
 * InMemoryPlayerTraitRepository — v1 in-memory implementation of
 * `PlayerTraitRepository`. Seeded from the shared `player-trait-seed` module
 * (originally `ui-design/pack-football/fc-player-data.jsx` `FC_PLAYERS`) for the
 * four pilot players (Studer / Caprez / Roduit / Camenzind), so this double and
 * the Prisma adapter return an identical `PlayerTraitProfile` and pass one
 * contract suite (pack-crud-repository-pattern.md §5.5 test-double parity).
 *
 * The three pilot player-id constants are now defined in `player-trait-seed`
 * and re-exported here for back-compat (player-movement-seed imports them from
 * this module).
 */

import { Injectable } from '@nestjs/common';

import {
  SEEDED_BASTIEN_RODUIT_PLAYER_ID,
  SEEDED_FLORIN_CAMENZIND_PLAYER_ID,
  SEEDED_MATEO_CAPREZ_PLAYER_ID,
  seedStoredPlayerTraitsFor,
  seededTraitPlayerIds,
  toPlayerTraitProfile,
} from './player-trait-seed.js';
import {
  type PlayerTraitProfile,
  type PlayerTraitRepository,
} from './player-trait.repository.js';

export {
  SEEDED_MATEO_CAPREZ_PLAYER_ID,
  SEEDED_BASTIEN_RODUIT_PLAYER_ID,
  SEEDED_FLORIN_CAMENZIND_PLAYER_ID,
};

@Injectable()
export class InMemoryPlayerTraitRepository implements PlayerTraitRepository {
  private readonly profilesById = new Map<string, PlayerTraitProfile>();

  constructor() {
    for (const playerId of seededTraitPlayerIds()) {
      const profile = toPlayerTraitProfile(
        seedStoredPlayerTraitsFor(playerId),
      );
      if (profile) this.profilesById.set(playerId, profile);
    }
  }

  async findByPlayerId(playerId: string): Promise<PlayerTraitProfile | null> {
    return this.profilesById.get(playerId) ?? null;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx nx test pack-football -- player-trait-seed`
Expected: PASS (4 tests).

Run: `npx nx test pack-football`
Expected: PASS — the whole pack suite stays green (the in-memory refactor preserves the profile shape; movement-seed's id imports still resolve via the re-export).

- [ ] **Step 6: Commit**

```bash
git add libs/pack-football/src/out-ports/player-trait-seed.ts libs/pack-football/src/out-ports/player-trait-seed.spec.ts libs/pack-football/src/out-ports/in-memory-player-trait.repository.ts
git commit -m "feat(pack-football): shared player-trait-seed module + toPlayerTraitProfile mapper"
```

---

### Task 3: Shared contract suite (in-memory adapter only, for now)

**Files:**
- Create: `libs/pack-football/src/out-ports/player-trait-repository.contract.ts`
- Create: `libs/pack-football/src/out-ports/player-trait-repository.spec.ts`

- [ ] **Step 1: Write the contract suite**

`libs/pack-football/src/out-ports/player-trait-repository.contract.ts`:

```ts
/**
 * playerTraitRepositoryContract — the one shared contract suite both
 * `PlayerTraitRepository` adapters pass (pack-crud-repository-pattern.md §5.5
 * test-double parity).
 *
 * `findByPlayerId` asserts FULL equality of the seeded profile for a seeded
 * player (Studer's five-trait profile) and `null` for an unknown player. The
 * `traits[]` comparison is order-independent (the DB read order is free), so it
 * sorts by traitKey before comparing.
 *
 * Source spec:
 *   `docs/superpowers/specs/2026-06-01-pack-football-player-trait-db-persistence-design.md` §7
 */

import { describe, expect, it } from 'vitest';

import { SEEDED_LEVIN_STUDER_PLAYER_ID } from './in-memory-funnel.repository.js';
import type {
  PlayerTraitProfile,
  PlayerTraitRepository,
  PlayerTraitRow,
} from './player-trait.repository.js';
import {
  seedStoredPlayerTraitsFor,
  toPlayerTraitProfile,
} from './player-trait-seed.js';

const UNKNOWN_PLAYER_ID = '00000099-0000-4000-8000-fc1a55e10099';

/** The expected exact profile for the fixture player (Studer). */
function expectedStuderProfile(): PlayerTraitProfile {
  return toPlayerTraitProfile(
    seedStoredPlayerTraitsFor(SEEDED_LEVIN_STUDER_PLAYER_ID),
  )!;
}

function byTraitKey(a: PlayerTraitRow, b: PlayerTraitRow): number {
  return a.traitKey.localeCompare(b.traitKey);
}

/** Compare two profiles with order-independent traits[]. */
function expectProfileEqual(
  actual: PlayerTraitProfile | null,
  expected: PlayerTraitProfile,
): void {
  expect(actual).not.toBeNull();
  expect(actual?.playerId).toBe(expected.playerId);
  expect(actual?.position).toBe(expected.position);
  expect(actual?.ageBand).toBe(expected.ageBand);
  expect([...(actual?.traits ?? [])].sort(byTraitKey)).toEqual(
    [...expected.traits].sort(byTraitKey),
  );
}

export interface PlayerTraitContractHarness {
  repo: PlayerTraitRepository;
}

export function playerTraitRepositoryContract(
  label: string,
  makeHarness: () =>
    | Promise<PlayerTraitContractHarness>
    | PlayerTraitContractHarness,
): void {
  describe(`PlayerTraitRepository contract — ${label}`, () => {
    it('returns the exact seeded profile for a seeded player (Studer)', async () => {
      const { repo } = await makeHarness();
      const profile = await repo.findByPlayerId(SEEDED_LEVIN_STUDER_PLAYER_ID);
      expectProfileEqual(profile, expectedStuderProfile());
    });

    it('returns null for an unknown player', async () => {
      const { repo } = await makeHarness();
      expect(await repo.findByPlayerId(UNKNOWN_PLAYER_ID)).toBeNull();
    });
  });
}

export interface PlayerTraitIsolationHarness {
  /** A repo scoped to the tenant that owns the seeded trait rows. */
  ownRepo: PlayerTraitRepository;
  /** A repo scoped to a DIFFERENT tenant, against the same physical store. */
  foreignRepo: PlayerTraitRepository;
}

/**
 * playerTraitRepositoryIsolationContract — a repo scoped to a different tenant
 * MUST NOT read the seeded trait rows. Only meaningful against the live
 * `football.player_trait_value` RLS surface, so the in-memory double does not
 * run it; the DB-gated harness does. The `ownRepo` sanity read guards against a
 * false pass where neither tenant can see the rows.
 */
export function playerTraitRepositoryIsolationContract(
  label: string,
  make: () =>
    | Promise<PlayerTraitIsolationHarness>
    | PlayerTraitIsolationHarness,
): void {
  describe(`PlayerTraitRepository tenant-isolation — ${label}`, () => {
    it('the owning tenant reads the seeded profile (isolation sanity)', async () => {
      const { ownRepo } = await make();
      const profile = await ownRepo.findByPlayerId(
        SEEDED_LEVIN_STUDER_PLAYER_ID,
      );
      expectProfileEqual(profile, expectedStuderProfile());
    });

    it('a different tenant cannot read the trait rows (RLS isolation)', async () => {
      const { foreignRepo } = await make();
      const profile = await foreignRepo.findByPlayerId(
        SEEDED_LEVIN_STUDER_PLAYER_ID,
      );
      expect(profile).toBeNull();
    });
  });
}
```

- [ ] **Step 2: Write the spec running it against the in-memory double**

`libs/pack-football/src/out-ports/player-trait-repository.spec.ts` (in-memory block only — the DB-gated block is added in Task 5):

```ts
/**
 * Player-trait-repository conformance — runs the shared
 * `playerTraitRepositoryContract` against the in-memory double (always; CI stays
 * DB-free). The `PrismaPlayerTraitRepository` block over the live RLS surface is
 * added in Task 5 of the implementation plan, DB-gated on
 * `SUBSTRATE_APP_DATABASE_URL`.
 */

import { InMemoryPlayerTraitRepository } from './in-memory-player-trait.repository.js';
import { playerTraitRepositoryContract } from './player-trait-repository.contract.js';

playerTraitRepositoryContract('InMemoryPlayerTraitRepository', () => ({
  repo: new InMemoryPlayerTraitRepository(),
}));
```

- [ ] **Step 3: Run the spec**

Run: `npx nx test pack-football -- player-trait-repository`
Expected: PASS (2 tests — the in-memory contract).

- [ ] **Step 4: Commit**

```bash
git add libs/pack-football/src/out-ports/player-trait-repository.contract.ts libs/pack-football/src/out-ports/player-trait-repository.spec.ts
git commit -m "test(pack-football): shared player-trait contract suite (in-memory adapter)"
```

---

### Task 4: Schema model + `TenantScopedClient` delegate + migration

**Files:**
- Modify: `prisma/packs/football.prisma`
- Modify: `libs/pack-football/src/out-ports/tenant-runner.port.ts`
- Create: `prisma/migrations/20260601120000_add_player_trait_value/migration.sql`

This task has no unit test of its own; it is verified by `prisma generate` (build), the offline `prisma migrate diff` drift check, and (DB-gated) Task 5.

- [ ] **Step 1: Add the Prisma model**

In `prisma/packs/football.prisma`, immediately AFTER the `PlayerMovementEntry` model (after its closing `}` at the `@@schema("football")` block ending ~line 318), insert:

```prisma
/// Per-player trait posterior snapshot (OQ-5 Option B; derived-rollup snapshot
/// pattern). Holds the per-player `value` the PlayerTraitRepository returns —
/// derived state with no live generator yet, populated by the seed today and
/// the observation backbone later. `label` is NOT stored (catalog data keyed by
/// traitKey — see TRAIT_LABEL). Grain matches player_movement_entry. The derived
/// snapshot is a documented, bounded ADR-176 exception (spec §2.1).
model PlayerTraitValue {
  id           String   @id @default(cuid())
  tenantPackId String   @map("tenant_pack_id")
  playerId     String // logical FK → football.player.id (ADR-150 string FK)
  position     String // PositionClusterKey (6er / 10er / IV / …)
  ageBand      String // U15 | U17 | U19 | senior
  traitKey     String // sport-science.trait.* (ADR-164 Commitment 3)
  value        Float // posterior median, 0..100
  computedAt   DateTime @default(now())

  @@unique([tenantPackId, playerId, traitKey])
  @@index([tenantPackId])
  @@index([tenantPackId, playerId])
  @@map("player_trait_value")
  @@schema("football")
}
```

- [ ] **Step 2: Regenerate the Prisma client**

Run: `npm run db:generate`
Expected: success; `PlayerTraitValue` + the `playerTraitValue` delegate now exist on `PrismaClient`. (This does NOT touch the DB.)

- [ ] **Step 3: Widen `TenantScopedClient` with the trait delegate**

In `libs/pack-football/src/out-ports/tenant-runner.port.ts`, AFTER the `TenantScopedPlayerMovementDelegate` interface (~line 96), insert:

```ts
/** A trait-value row as stored in `football.player_trait_value` (1:1 snapshot). */
export interface TenantScopedPlayerTraitValueRow {
  readonly id: string;
  readonly tenantPackId: string;
  readonly playerId: string;
  readonly position: string;
  readonly ageBand: string;
  readonly traitKey: string;
  readonly value: number;
  readonly computedAt: Date;
}

/** The minimal Prisma `playerTraitValue` delegate the player-trait adapter reads through. */
export interface TenantScopedPlayerTraitValueDelegate {
  findMany(args: {
    where: { playerId: string };
  }): Promise<readonly TenantScopedPlayerTraitValueRow[]>;
}
```

Then add the delegate to the `TenantScopedClient` interface (after `playerMovementEntry`, ~line 232):

```ts
  readonly playerTraitValue: TenantScopedPlayerTraitValueDelegate;
```

- [ ] **Step 4: Hand-author the migration**

Create `prisma/migrations/20260601120000_add_player_trait_value/migration.sql`. The table columns are `TEXT` (cuid `String`), mirroring `player_movement_entry` — NOT `UUID` like `football.player`. The RLS shape mirrors `20260530215947_add_football_player` exactly (ENABLE + FORCE, a read isolation policy + a write WITH CHECK policy, GRANT to `app`). The index names follow Prisma's convention and are all < 63 chars (no truncation):

```sql
-- Add football.player_trait_value — the per-player trait posterior snapshot
-- (OQ-5 Option B, ADR-202 fan-out, exercir#142). A derived-rollup snapshot:
-- holds the `value` the PlayerTraitRepository returns, populated by the seed
-- today and the observation backbone later (spec §2.1, a bounded ADR-176
-- exception).
--
-- Forward-only per §20 P5. Columns are TEXT (cuid String @id) to mirror
-- player_movement_entry's grain — NOT UUID. The RLS policy + grant mirror
-- 20260530215947_add_football_player: ENABLE + FORCE ROW LEVEL SECURITY, a
-- tenant-pack isolation policy (USING) + an INSERT WITH CHECK policy against
-- the app.tenant_pack_id GUC, and SELECT/INSERT/UPDATE/DELETE granted to app.
--
-- The column is the snake_case `tenant_pack_id` (Prisma @map) — the policy
-- predicate references that physical name (per the §0 column convention,
-- 20260601090000).

-- CreateTable
CREATE TABLE "football"."player_trait_value" (
    "id" TEXT NOT NULL,
    "tenant_pack_id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "ageBand" TEXT NOT NULL,
    "traitKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "player_trait_value_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "player_trait_value_tenant_pack_id_playerId_traitKey_key" ON "football"."player_trait_value"("tenant_pack_id", "playerId", "traitKey");

-- CreateIndex
CREATE INDEX "player_trait_value_tenant_pack_id_idx" ON "football"."player_trait_value"("tenant_pack_id");

-- CreateIndex
CREATE INDEX "player_trait_value_tenant_pack_id_playerId_idx" ON "football"."player_trait_value"("tenant_pack_id", "playerId");

-- ─── row level security ─────────────────────────────────────────────────
-- Per ADR-027 invariant 6 + ADR-202 §5.8. ENABLE + FORCE (the table owner
-- bypasses RLS by default; the Prisma migration runner connects as owner, so
-- without FORCE the app reads across tenants when it runs as the same role in
-- dev). Policy keys USING + WITH CHECK on the tx-local app.tenant_pack_id GUC
-- the TenantRunner (and the seed) set.

ALTER TABLE "football"."player_trait_value" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "football"."player_trait_value" FORCE ROW LEVEL SECURITY;

CREATE POLICY player_trait_value_tenant_pack_isolation ON "football"."player_trait_value"
  USING ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));

CREATE POLICY player_trait_value_tenant_pack_isolation_write ON "football"."player_trait_value"
  FOR INSERT
  WITH CHECK ("tenant_pack_id"::text = current_setting('app.tenant_pack_id', true));

-- ─── grant the app role CRUD on the new table ───────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON "football"."player_trait_value" TO app;
```

- [ ] **Step 5: Verify the migration produces zero drift (DB-gated — needs a throwaway Postgres)**

This step requires a Postgres reachable via a throwaway/shadow URL. If no DB is available in this session, SKIP and rely on CI / the DB lane; note it in the PR. If a DB is available, provision in the order that avoids P3005 (app role → `migrate deploy` → kernel/core SQL), then:

Run:
```bash
npx prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma \
  --shadow-database-url "$SHADOW_DATABASE_URL" \
  --script
```
Expected: the ONLY statements printed concern the unrelated `kernel.event_log` / `outbox` CREATE (those come from raw-SQL `db:setup:core`, not migrations — a standing diff in this repo). NO `player_trait_value` statements. If `player_trait_value` appears, the hand-written index names don't match Prisma's expectation — copy the generated names into the migration and re-run until the table is drift-free.

- [ ] **Step 6: Verify the build (DB-free)**

Run: `npx nx build pack-football`
Expected: PASS — the widened `TenantScopedClient` + the regenerated client both typecheck.

- [ ] **Step 7: Commit**

```bash
git add prisma/packs/football.prisma libs/pack-football/src/out-ports/tenant-runner.port.ts "prisma/migrations/20260601120000_add_player_trait_value/migration.sql"
git commit -m "feat(pack-football): player_trait_value table + RLS migration + TenantScopedClient delegate"
```

---

### Task 5: `PrismaPlayerTraitRepository` adapter + the DB-gated contract block

**Files:**
- Create: `libs/pack-football/src/out-ports/prisma-player-trait.repository.ts`
- Modify: `libs/pack-football/src/out-ports/player-trait-repository.spec.ts`

- [ ] **Step 1: Write the adapter**

`libs/pack-football/src/out-ports/prisma-player-trait.repository.ts`:

```ts
/**
 * PrismaPlayerTraitRepository — Postgres-backed `PlayerTraitRepository` over
 * `football.player_trait_value`, the OQ-5 Option-B derived-rollup snapshot
 * (ADR-202 fan-out, exercir#142).
 *
 * It injects only `TENANT_RUNNER`; every query runs inside `runner.run(fn)`, so
 * RLS scoping is provable in the adapter — the runner sets the
 * `app.tenant_pack_id` GUC before `fn` runs, and the table's
 * `player_trait_value_tenant_pack_isolation` policy scopes the read to the
 * active tenant. The repository knows nothing about how/where the GUC is set.
 *
 * Rows map to the profile through the shared `toPlayerTraitProfile`, the same
 * helper the in-memory double uses, so both adapters emit the identical
 * `PlayerTraitProfile` and pass one contract suite (pack-crud-repository-pattern.md
 * §5.5). `position`/`ageBand`/`traitKey` come back from Postgres as `string`;
 * `rowToStored` narrows them to their catalog types — the seed (the only
 * writer) guarantees valid values.
 *
 * Source spec:
 *   `docs/superpowers/specs/2026-06-01-pack-football-player-trait-db-persistence-design.md` §5
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  type AgeBand,
  type PositionClusterKey,
  type TraitKey,
} from '../manifest/trait-cluster.types.js';
import {
  toPlayerTraitProfile,
  type StoredPlayerTraitValue,
} from './player-trait-seed.js';
import type {
  PlayerTraitProfile,
  PlayerTraitRepository,
} from './player-trait.repository.js';
import {
  TENANT_RUNNER,
  type TenantRunner,
  type TenantScopedPlayerTraitValueRow,
} from './tenant-runner.port.js';

@Injectable()
export class PrismaPlayerTraitRepository implements PlayerTraitRepository {
  constructor(@Inject(TENANT_RUNNER) private readonly runner: TenantRunner) {}

  async findByPlayerId(playerId: string): Promise<PlayerTraitProfile | null> {
    return this.runner.run(async (tx) => {
      const rows = await tx.playerTraitValue.findMany({ where: { playerId } });
      return toPlayerTraitProfile(rows.map(rowToStored));
    });
  }
}

function rowToStored(
  row: TenantScopedPlayerTraitValueRow,
): StoredPlayerTraitValue {
  return {
    id: row.id,
    playerId: row.playerId,
    position: row.position as PositionClusterKey,
    ageBand: row.ageBand as AgeBand,
    traitKey: row.traitKey as TraitKey,
    value: row.value,
  };
}
```

- [ ] **Step 2: Verify the adapter builds**

Run: `npx nx build pack-football`
Expected: PASS.

- [ ] **Step 3: Add the DB-gated block to the spec**

Replace the full contents of `libs/pack-football/src/out-ports/player-trait-repository.spec.ts` with (the in-memory block stays; a Prisma block is appended, mirroring `player-movement-repository.spec.ts`):

```ts
/**
 * Player-trait-repository conformance — runs the shared
 * `playerTraitRepositoryContract` against both adapters (pack-crud-repository-pattern.md §5.5):
 *
 *  - InMemoryPlayerTraitRepository — always (CI stays DB-free).
 *  - PrismaPlayerTraitRepository over a GucPrismaRunner-backed TenantRunner —
 *    DB-GATED on `SUBSTRATE_APP_DATABASE_URL` (the non-superuser `app` role).
 *    The gated block seeds the four pilot players' trait rows into
 *    `football.player_trait_value` under THIS SPEC'S OWN tenant-pack
 *    (idempotent), then proves the live RLS-scoped read returns the same
 *    profile the in-memory double does. The isolation block proves a foreign
 *    tenant reads nothing.
 *
 * Tenant isolation (exercir#148): this spec owns a DISTINCT tenant-pack so its
 * `player_trait_value` rows can't collide with the squad/movement specs'.
 *
 * Run locally: `npm run test:db`.
 */

import { PrismaClient } from '@prisma/client';
import { GucPrismaRunner } from '@de-braighter/substrate-runtime';
import { afterAll, beforeAll, describe } from 'vitest';

import { InMemoryPlayerTraitRepository } from './in-memory-player-trait.repository.js';
import { PrismaPlayerTraitRepository } from './prisma-player-trait.repository.js';
import { seedStoredPlayerTraitValues } from './player-trait-seed.js';
import {
  playerTraitRepositoryContract,
  playerTraitRepositoryIsolationContract,
} from './player-trait-repository.contract.js';
import type { TenantRunner, TenantScopedClient } from './tenant-runner.port.js';

// A tenant-pack OWNED BY THIS SPEC (distinct from the squad/movement specs'
// packs) so the trait rows can't collide with theirs.
const TRAIT_TENANT_PACK_ID = '5c5c5c5c-0000-4000-8000-5c0a55ed0004';
// A second, unrelated tenant-pack — seeds NOTHING; used only to prove RLS hides
// the trait rows from a repo scoped to a different tenant.
const OTHER_TENANT_PACK_ID = 'd1f7c0de-0000-4000-8000-0000000000ff';

/** A PrismaPlayerTraitRepository whose runner pins the given tenant-pack GUC. */
function repoScopedTo(
  app: PrismaClient,
  tenantPackId: string,
): PrismaPlayerTraitRepository {
  const guc = new GucPrismaRunner(app as never);
  const runner: TenantRunner = {
    run: (fn) =>
      guc.run(tenantPackId, (tx) => fn(tx as unknown as TenantScopedClient)),
  };
  return new PrismaPlayerTraitRepository(runner);
}

const APP_URL = process.env['SUBSTRATE_APP_DATABASE_URL'];
const ADMIN_URL = process.env['DATABASE_URL'];

// ─── In-memory double — always ───────────────────────────────────────────

playerTraitRepositoryContract('InMemoryPlayerTraitRepository', () => ({
  repo: new InMemoryPlayerTraitRepository(),
}));

// ─── Prisma adapter over the live app-role RLS surface — DB-gated ─────────

describe.skipIf(!APP_URL || !ADMIN_URL)(
  'PrismaPlayerTraitRepository (live football.player_trait_value, app role)',
  () => {
    let app: PrismaClient;
    let admin: PrismaClient;
    let repo: PrismaPlayerTraitRepository;
    let foreignRepo: PrismaPlayerTraitRepository;

    beforeAll(async () => {
      app = new PrismaClient({ datasources: { db: { url: APP_URL } } });
      admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });

      // Idempotent re-seed of ONLY the trait rows under THIS SPEC'S tenant-pack.
      // Admin bypasses RLS for the clean-and-insert; the read path under test
      // runs as the RLS-subject app role.
      await admin.$executeRawUnsafe(
        'DELETE FROM football.player_trait_value WHERE "tenant_pack_id" = $1',
        TRAIT_TENANT_PACK_ID,
      );
      for (const t of seedStoredPlayerTraitValues()) {
        await admin.playerTraitValue.create({
          data: {
            id: t.id,
            tenantPackId: TRAIT_TENANT_PACK_ID,
            playerId: t.playerId,
            position: t.position,
            ageBand: t.ageBand,
            traitKey: t.traitKey,
            value: t.value,
          },
        });
      }

      repo = repoScopedTo(app, TRAIT_TENANT_PACK_ID);
      foreignRepo = repoScopedTo(app, OTHER_TENANT_PACK_ID);
    });

    afterAll(async () => {
      await admin.$executeRawUnsafe(
        'DELETE FROM football.player_trait_value WHERE "tenant_pack_id" = $1',
        TRAIT_TENANT_PACK_ID,
      );
      await app.$disconnect();
      await admin.$disconnect();
    });

    playerTraitRepositoryContract('PrismaPlayerTraitRepository', () => ({
      repo,
    }));

    playerTraitRepositoryIsolationContract('PrismaPlayerTraitRepository', () => ({
      ownRepo: repo,
      foreignRepo,
    }));
  },
);
```

- [ ] **Step 4: Run the spec DB-free**

Run: `npx nx test pack-football -- player-trait-repository`
Expected: PASS — the in-memory contract runs (2 tests); the Prisma `describe.skipIf` is SKIPPED (no `SUBSTRATE_APP_DATABASE_URL`).

- [ ] **Step 5: (DB-gated, optional) run the live lane**

If a provisioned DB + app role is available: apply the migration (`npm run db:deploy`), then:

Run: `npm run test:db`
Expected: the Prisma block runs — contract parity (2) + isolation (2) green; the foreign tenant reads `null`.

- [ ] **Step 6: Commit**

```bash
git add libs/pack-football/src/out-ports/prisma-player-trait.repository.ts libs/pack-football/src/out-ports/player-trait-repository.spec.ts
git commit -m "feat(pack-football): PrismaPlayerTraitRepository + DB-gated parity/isolation spec"
```

---

### Task 6: Flag-gate the `PLAYER_TRAIT_REPOSITORY` binding in the module

**Files:**
- Modify: `libs/pack-football/src/pack-football.module.ts`

- [ ] **Step 1: Add the provider factory + the Prisma import**

In `pack-football.module.ts`, add the adapter import next to the other Prisma imports (after the `PrismaPlayerMovementRepository` import, ~line 153):

```ts
import { PrismaPlayerTraitRepository } from './out-ports/prisma-player-trait.repository.js';
```

Then add a provider factory next to `playerMovementRepositoryProviders` (after it, ~line 278):

```ts
/**
 * `PLAYER_TRAIT_REPOSITORY` binding — flag-gated per ADR-202 (the keystone
 * OQ-5 Option-B port, exercir#142). Default (flag off): the in-memory
 * test-double / demo path. On: the Postgres-backed `PrismaPlayerTraitRepository`
 * (over `football.player_trait_value`); it injects `TENANT_RUNNER`, which the
 * host composition root supplies — the pack lib declares neither the app-role
 * client nor the GUC.
 */
export function playerTraitRepositoryProviders(useDb: boolean): Provider[] {
  if (useDb) {
    return [
      PrismaPlayerTraitRepository,
      {
        provide: PLAYER_TRAIT_REPOSITORY,
        useExisting: PrismaPlayerTraitRepository,
      },
    ];
  }
  return [
    InMemoryPlayerTraitRepository,
    {
      provide: PLAYER_TRAIT_REPOSITORY,
      useExisting: InMemoryPlayerTraitRepository,
    },
  ];
}
```

- [ ] **Step 2: Replace the unconditional binding in `buildProviders`**

In `buildProviders`, the funnel section currently binds the in-memory trait repo unconditionally (~lines 604-608):

```ts
    InMemoryPlayerTraitRepository,
    {
      provide: PLAYER_TRAIT_REPOSITORY,
      useExisting: InMemoryPlayerTraitRepository,
    },
```

Replace those five lines with:

```ts
    ...playerTraitRepositoryProviders(isPackCrudDbFlagEnabled()),
```

- [ ] **Step 3: Verify build + full pack suite**

Run: `npx nx build pack-football`
Expected: PASS.

Run: `npx nx test pack-football`
Expected: PASS — the whole pack suite stays green (flag-off default keeps the in-memory binding, so funnel/player-funnel use-cases that depend on the trait repo are unchanged).

- [ ] **Step 4: Commit**

```bash
git add libs/pack-football/src/pack-football.module.ts
git commit -m "feat(pack-football): flag-gate PLAYER_TRAIT_REPOSITORY onto PrismaPlayerTraitRepository"
```

---

### Task 7: Seed `player_trait_value` for the four pilot players

**Files:**
- Modify: `prisma/seed/football-seed.ts`

- [ ] **Step 1: Import the trait seed + add `seedPlayerTraits`**

In `prisma/seed/football-seed.ts`, add the import next to the movement-seed import (~line 44):

```ts
import { seedStoredPlayerTraitValues } from '../../libs/pack-football/src/out-ports/player-trait-seed.js';
```

Add the seed function after `seedPlayerMovements` (~after line 253), mirroring its shape (own tx + GUC under the demo squad tenant-pack, delete-then-insert scoped to the tenant):

```ts
/**
 * Seed the four pilot players' trait snapshots into
 * `football.player_trait_value` under the demo squad tenant-pack — the read
 * source for the live `PrismaPlayerTraitRepository`. Same GUC as the squad seed
 * (the trait table's `player_trait_value_tenant_pack_isolation` policy keys on
 * `app.tenant_pack_id`). Idempotent: delete-then-insert scoped to the
 * tenant-pack. Rows come from the shared `seedStoredPlayerTraitValues()` so the
 * live rows are byte-identical to the in-memory double + the contract suite.
 */
async function seedPlayerTraits(prisma: PrismaClient): Promise<number> {
  return reseedScoped(prisma, SQUAD_TENANT_PACK_ID, async (tx) => {
    await tx.$executeRawUnsafe(
      'DELETE FROM football.player_trait_value WHERE "tenant_pack_id" = $1',
      SQUAD_TENANT_PACK_ID,
    );
    const traits = seedStoredPlayerTraitValues();
    for (const t of traits) {
      await tx.playerTraitValue.create({
        data: {
          id: t.id,
          tenantPackId: SQUAD_TENANT_PACK_ID,
          playerId: t.playerId,
          position: t.position,
          ageBand: t.ageBand,
          traitKey: t.traitKey,
          value: t.value,
        },
      });
    }
    return traits.length;
  });
}
```

- [ ] **Step 2: Call it from `seedFootball` + export it**

In `seedFootball`, after the movement-seed block (~after line 333), add:

```ts
    // Player-trait snapshots in football.player_trait_value, scoped to the same
    // squad tenant-pack. Own tx + GUC.
    const traitCount = await seedPlayerTraits(prisma);
    process.stdout.write(`football seed: ${traitCount} trait values\n`);
```

In the `export { ... }` block at the bottom (~line 475), add `seedPlayerTraits,` next to `seedPlayerMovements,`.

- [ ] **Step 3: Typecheck the seed**

Run: `npx tsc --noEmit -p prisma/tsconfig.json 2>/dev/null || npx nx build pack-football`
Expected: PASS (the seed imports the regenerated `playerTraitValue` delegate + the shared seed module). If `prisma/tsconfig.json` does not exist, rely on the `nx build` typecheck of the imported seed module.

- [ ] **Step 4: (DB-gated, optional) run the seed end-to-end**

If a provisioned DB is available:

Run: `npm run db:seed:football`
Expected: output includes `football seed: 20 trait values` and `football seed: OK`.

- [ ] **Step 5: Commit**

```bash
git add prisma/seed/football-seed.ts
git commit -m "feat(pack-football): seed player_trait_value for the four pilot players"
```

---

### Task 8: Final verification + story + PR

**Files:** none (verification + PR).

- [ ] **Step 1: Run the DB-free gate**

Run: `npm run ci:local`
Expected: `nx run-many -t build lint` + `nx run-many -t test` all PASS. The DB-gated trait/movement/squad blocks are skipped (no `SUBSTRATE_APP_DATABASE_URL`).

- [ ] **Step 2: Confirm the diff scope**

Run: `git diff --name-status main...HEAD`
Expected: exactly the 12 files in the File Structure table (9 created + 3 modified, plus the two `.spec.ts` test files). Nothing else.

- [ ] **Step 3: File the story issue (ADR-086 cascade)**

The reviewer blocks on a `Closes #` + `Tech design:` line (fan-out precedent — exercir has no kanban labels, but the cascade still applies). Create a story:

```bash
gh issue create --repo de-braighter/exercir \
  --title "player-trait Prisma adapter — OQ-5 Option-B keystone (#4 of the fan-out)" \
  --body "Port the PlayerTraitRepository onto football.player_trait_value (derived-rollup snapshot, OQ-5 Option B). Part of epic #142.

Tech design: docs/superpowers/specs/2026-06-01-pack-football-player-trait-db-persistence-design.md"
```

Note the issue number it returns (call it `<STORY#>`).

- [ ] **Step 4: Push the branch + open the PR**

```bash
git push -u origin HEAD
```

Then create the PR (the `Producer:` + `Effect:` lines feed the SDLC twin per the workbench ritual; `Effect:` declares only auto-observable Sonar/cycle indicators):

```bash
gh pr create --repo de-braighter/exercir \
  --title "feat(pack-football): player-trait Prisma adapter — OQ-5 Option-B keystone (#4 of the fan-out)" \
  --body "Closes #<STORY#>

Resolves OQ-5 (Option B) for the player-trait port: a derived-rollup snapshot table \`football.player_trait_value\` holding the per-player \`value\` the port already returned (no new math). Shared \`player-trait-seed\` drives the in-memory double, the Prisma adapter, and the DB seed through one contract suite. Bound under \`PACK_FOOTBALL_PACK_CRUD_DB\`; in-memory stays the flag-off default.

Tech design: docs/superpowers/specs/2026-06-01-pack-football-player-trait-db-persistence-design.md

Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effect: coverage 0±0.3 expert
Effect: duplication 0±0.2 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

**Note:** `gh pr edit` fails (token lacks `read:org`) — if the title/body need a later edit, use `gh api repos/de-braighter/exercir/pulls/<N> -X PATCH -f body=...`.

- [ ] **Step 5: Run the verifier wave**

Dispatch `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker` in parallel (all `isolation: "worktree"`) per `workflows/verifier-wave.md`. Address any blocking findings before merge.

---

## Self-Review (completed against the spec)

**Spec coverage:**
- §2 snapshot pattern (`computed_at`, read-only adapter, flag-off default) → Tasks 4 (schema `computedAt`), 5 (no write method), 6 (flag-gate). ✅
- §3 schema (one table, hand-authored migration, 2 RLS policies, GRANT) → Task 4. ✅
- §4 `TRAIT_LABEL` catalog + in-memory seed refactored to use it → Tasks 1 + 2. ✅
- §5 adapter (injects `TENANT_RUNNER`, `findByPlayerId`, `playerTraitValue` delegate, shared `toPlayerTraitProfile`) → Tasks 2 (mapper + delegate row), 4 (delegate on client), 5 (adapter). ✅
- §6 wiring under `PACK_FOOTBALL_PACK_CRUD_DB` + seed for 4 pilots → Tasks 6 + 7. ✅
- §7 testing (shared contract both adapters + DB-gated isolation + migrate-diff zero drift) → Tasks 3, 5, 4-step5. ✅
- §10 acceptance criteria → all mapped across Tasks 1–7. ✅

**Type consistency:** `StoredPlayerTraitValue` (Task 2) is consumed identically by `rowToStored` (Task 5) and the seed (Task 7); `toPlayerTraitProfile` signature (`readonly StoredPlayerTraitValue[] → PlayerTraitProfile | null`) is stable across Tasks 2/3/5; `TenantScopedPlayerTraitValueRow` (Task 4) matches the DB columns the adapter narrows (Task 5); `playerTraitRepositoryProviders` (Task 6) mirrors `playerMovementRepositoryProviders`. ✅

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the only conditional steps are the explicitly DB-gated ones (4-step5, 5-step5, 7-step4), which the DB-free gate does not require. ✅
