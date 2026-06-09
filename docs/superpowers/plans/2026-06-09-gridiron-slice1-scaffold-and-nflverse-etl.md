# Gridiron Slice 1 — Scaffold + nflverse 4th-down ETL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the new `domains/gridiron` substrate domain and land verifiable NFL 4th-down plays (go/punt/kick) as `gridiron:Play.v1` events in the kernel `event_log`, each keyed by a deterministic situation-archetype × arm subject id.

**Architecture:** Scaffold the domain via the `/new-domain` skill (markets reference run) with foundation + DB + inference + UI tiers. The slice-1 *implemented* work is two pure layers in `gridiron-pack` (situation bucketing → deterministic archetype×arm UUID; one nflverse row → one `Play.v1` envelope) plus an NestJS ingestion service in `gridiron-api` that writes envelopes through the kernel outbox (`PrismaOutboxWriter`) inside a `GucPrismaRunner` transaction, scoped to `GRIDIRON_TENANT_PACK_ID`. A Python tool fetches/filters nflverse data out-of-band; the TS code consumes its JSON. The scaffolded inference/UI tiers are placeholders filled by Slices 2–3.

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), NestJS, Prisma + PostgreSQL (kernel `event_log`/`outbox`), Vitest, Zod, `uuid` (v5), `@de-braighter/substrate-{contracts,runtime}`; Python + `nfl_data_py` for the one-off data fetch.

**Spec:** `docs/superpowers/specs/2026-06-09-gridiron-nfl-4th-down-what-if-design.md` (this plan implements §3 "In" minus inference/UI/validation, §4, §5, §6 with OPEN-1 resolved as front-runner **(a) arm-in-subject**).

**Conventions to mirror (read these before coding):**
- `domains/markets/apps/markets-api/src/ingestion/price-ingestion.service.ts` — the ingestion-service shape this slice copies.
- `domains/markets/libs/markets-pack/src/observations.ts` — the envelope-builder shape.
- `domains/markets/apps/markets-api/src/ingestion/price-ingestion.service.spec.ts` — the service test shape (mock publisher/runner via vitest).
- `domains/markets/apps/markets-api/src/config/tenants.ts` — `*_TENANT_PACK_ID` / `*_PLAN_ROOT_ID` constants.

---

## File structure (slice 1)

**Scaffolded by `/new-domain` (Task 1), then filled by later tasks:**

| Path | Responsibility |
|---|---|
| `domains/gridiron/` (workspace) | pnpm workspace root + docker-compose + tools/db + .env.example |
| `apps/gridiron-api/prisma/schema.prisma` | vendored kernel `EventLog`/`Outbox` |
| `apps/gridiron-api/src/config/tenants.ts` | `GRIDIRON_TENANT_PACK_ID`, `GRIDIRON_PLAN_ROOT_ID` |
| `apps/gridiron-api/src/app/app.module.ts` | DI composition root |
| `libs/gridiron-pack/src/constants.ts` | `PACK_ID = 'gridiron'` |

**Created/modified by this slice's coding tasks:**

| Path | Responsibility | Task |
|---|---|---|
| `libs/gridiron-pack/src/archetype/archetype.ts` | arm mapping + 4-aspect bucketers + situation key | 2 |
| `libs/gridiron-pack/src/archetype/archetype-id.ts` | deterministic `(situationKey, arm)` → UUID v5 | 3 |
| `libs/gridiron-pack/src/ingestion/play-row.ts` | Zod schema for the consumed nflverse columns | 4 |
| `libs/gridiron-pack/src/ingestion/play-to-envelope.ts` | one play row → one `Play.v1` envelope (or null) | 4 |
| `libs/gridiron-pack/src/index.ts` | re-export the above | 2–4 |
| `apps/gridiron-api/src/ingestion/play-source.token.ts` | `PLAY_SOURCE` DI token + `PlaySource` interface | 5 |
| `apps/gridiron-api/src/ingestion/nflverse-file-source.ts` | read + validate the JSON data file | 5 |
| `apps/gridiron-api/src/ingestion/play-ingestion.service.ts` | rows → envelopes → outbox write | 5 |
| `apps/gridiron-api/src/ingestion/ingest.main.ts` | standalone one-shot ingest entrypoint | 6 |
| `apps/gridiron-api/src/app/app.module.ts` (modify) | register ingestion + outbox + runner providers | 6 |
| `tools/fetch-nflverse.py` | fetch/filter nflverse → `data/*.json` | 6 |
| `data/sample-fourth-downs.json` + `data/.gitignore` | committed smoke fixture; ignore bulk fetch output | 6 |

---

## Task 1: Scaffold the gridiron domain

**Setup task (not TDD).** Uses the `/new-domain` skill, which produces a green, buildable, testable workspace.

- [ ] **Step 1: Invoke `/new-domain`** with these intake answers:
  - Domain name: `gridiron`
  - Purpose: `NFL 4th-down what-if on the substrate`
  - HTTP port: `3400` · Postgres port: `5465` · Web port: `4300`
    - First confirm no collision: check existing `domains/*/docker-compose.yml` and `.env*` for those ports; bump if taken.
  - Tiers: **foundation + DB-persistence + inference + UI** (all four).

- [ ] **Step 2: Verify the scaffold is green**

Run (from `domains/gridiron/`):
```bash
pnpm install
pnpm -w build
pnpm -w test
```
Expected: install succeeds; build succeeds for `gridiron-spine`, `gridiron-pack`, `gridiron-api`, `gridiron-web`; smoke tests pass (`PACK_ID === 'gridiron'`, health controller returns `{ status: 'ok', pack: 'gridiron' }`).

- [ ] **Step 3: Confirm the kernel constants exist**

Open `apps/gridiron-api/src/config/tenants.ts` and confirm exports `GRIDIRON_TENANT_PACK_ID` (default `'10000000-0000-4001-8000-000000000001'`) and `GRIDIRON_PLAN_ROOT_ID`. Note the exact exported names — later tasks import them.

- [ ] **Step 4: Confirm the package names**

Open `libs/gridiron-pack/package.json` and `apps/gridiron-api/package.json`; record the exact `name` fields (expected `@de-braighter/gridiron-pack`, `@de-braighter/gridiron-api`). Use those exact names in `pnpm --filter` commands and cross-package imports below.

- [ ] **Step 5: Commit the scaffold**

```bash
git add domains/gridiron
git commit -m "feat(gridiron): scaffold domain (foundation + db + inference + ui tiers)"
```
> If the `/new-domain` skill already committed the scaffold, skip this step.

---

## Task 2: Arm mapping + 4-aspect situation bucketers (pack)

**Files:**
- Create: `libs/gridiron-pack/src/archetype/archetype.ts`
- Test: `libs/gridiron-pack/src/archetype/archetype.spec.ts`
- Modify: `libs/gridiron-pack/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// libs/gridiron-pack/src/archetype/archetype.spec.ts
import { describe, expect, it } from 'vitest';
import {
  armFromPlayType,
  bucketSituation,
  distanceBucket,
  fieldBucket,
  scoreBucket,
  situationKey,
  timeBucket,
} from './archetype.js';

describe('armFromPlayType', () => {
  it('maps nflverse play_type to a 4th-down arm', () => {
    expect(armFromPlayType('punt')).toBe('punt');
    expect(armFromPlayType('field_goal')).toBe('kick');
    expect(armFromPlayType('run')).toBe('go');
    expect(armFromPlayType('pass')).toBe('go');
  });
  it('returns null for non-decision play types', () => {
    expect(armFromPlayType('qb_kneel')).toBeNull();
    expect(armFromPlayType('kickoff')).toBeNull();
    expect(armFromPlayType('no_play')).toBeNull();
  });
});

describe('bucketers', () => {
  it('buckets distance to go', () => {
    expect(distanceBucket(1)).toBe('short');
    expect(distanceBucket(2)).toBe('short');
    expect(distanceBucket(5)).toBe('medium');
    expect(distanceBucket(10)).toBe('long');
  });
  it('buckets field position (yardline_100 = yards to opponent end zone)', () => {
    expect(fieldBucket(95)).toBe('own-deep');
    expect(fieldBucket(70)).toBe('own-mid');
    expect(fieldBucket(50)).toBe('midfield');
    expect(fieldBucket(30)).toBe('opp-side');
    expect(fieldBucket(10)).toBe('fringe');
  });
  it('buckets score differential (posteam minus defteam)', () => {
    expect(scoreBucket(-14)).toBe('trail-big');
    expect(scoreBucket(-6)).toBe('trail');
    expect(scoreBucket(0)).toBe('close');
    expect(scoreBucket(6)).toBe('lead');
    expect(scoreBucket(14)).toBe('lead-big');
  });
  it('buckets time (final two minutes wins regardless of quarter)', () => {
    expect(timeBucket(1, 3000)).toBe('1st-half');
    expect(timeBucket(3, 1500)).toBe('q3');
    expect(timeBucket(4, 600)).toBe('q4-early');
    expect(timeBucket(4, 90)).toBe('2-min');
    expect(timeBucket(2, 60)).toBe('2-min');
  });
});

describe('situationKey', () => {
  it('produces a stable pipe-delimited key', () => {
    const a = bucketSituation({ ydstogo: 2, yardline100: 35, scoreDiff: -4, qtr: 4, secondsLeft: 200 });
    expect(situationKey(a)).toBe('short|opp-side|trail|q4-early');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/archetype/archetype.spec.ts`
Expected: FAIL — `Cannot find module './archetype.js'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// libs/gridiron-pack/src/archetype/archetype.ts

/** A 4th-down decision arm. */
export type Arm = 'go' | 'punt' | 'kick';

/** Map an nflverse `play_type` to a 4th-down arm; null when the play is not a go/punt/kick decision. */
export function armFromPlayType(playType: string): Arm | null {
  switch (playType) {
    case 'punt':
      return 'punt';
    case 'field_goal':
      return 'kick';
    case 'run':
    case 'pass':
      return 'go';
    default:
      return null; // qb_kneel, qb_spike, kickoff, extra_point, no_play, ...
  }
}

export type DistanceBucket = 'short' | 'medium' | 'long';
export function distanceBucket(ydstogo: number): DistanceBucket {
  if (ydstogo <= 2) return 'short';
  if (ydstogo <= 6) return 'medium';
  return 'long';
}

export type FieldBucket = 'own-deep' | 'own-mid' | 'midfield' | 'opp-side' | 'fringe';
/** `yardline100` = yards from the OPPONENT end zone (lower = closer to scoring). */
export function fieldBucket(yardline100: number): FieldBucket {
  if (yardline100 > 80) return 'own-deep';
  if (yardline100 > 60) return 'own-mid';
  if (yardline100 > 40) return 'midfield';
  if (yardline100 > 20) return 'opp-side';
  return 'fringe';
}

export type ScoreBucket = 'trail-big' | 'trail' | 'close' | 'lead' | 'lead-big';
export function scoreBucket(scoreDiff: number): ScoreBucket {
  if (scoreDiff <= -9) return 'trail-big';
  if (scoreDiff <= -4) return 'trail';
  if (scoreDiff <= 3) return 'close';
  if (scoreDiff <= 8) return 'lead';
  return 'lead-big';
}

export type TimeBucket = '1st-half' | 'q3' | 'q4-early' | '2-min';
/** `secondsLeft` = game_seconds_remaining (whole game); `qtr` = quarter. */
export function timeBucket(qtr: number, secondsLeft: number): TimeBucket {
  if (secondsLeft <= 120) return '2-min';
  if (qtr <= 2) return '1st-half';
  if (qtr === 3) return 'q3';
  return 'q4-early';
}

export interface SituationArchetype {
  distance: DistanceBucket;
  field: FieldBucket;
  score: ScoreBucket;
  time: TimeBucket;
}

export function bucketSituation(input: {
  ydstogo: number;
  yardline100: number;
  scoreDiff: number;
  qtr: number;
  secondsLeft: number;
}): SituationArchetype {
  return {
    distance: distanceBucket(input.ydstogo),
    field: fieldBucket(input.yardline100),
    score: scoreBucket(input.scoreDiff),
    time: timeBucket(input.qtr, input.secondsLeft),
  };
}

/** Stable, human-readable key for an archetype (used to derive the subject UUID). */
export function situationKey(a: SituationArchetype): string {
  return `${a.distance}|${a.field}|${a.score}|${a.time}`;
}
```

- [ ] **Step 4: Re-export from the pack index**

Edit `libs/gridiron-pack/src/index.ts` — add (keep existing exports):
```ts
export * from './archetype/archetype.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/archetype/archetype.spec.ts`
Expected: PASS (all assertions green).

- [ ] **Step 6: Commit**

```bash
git add libs/gridiron-pack/src/archetype/archetype.ts libs/gridiron-pack/src/archetype/archetype.spec.ts libs/gridiron-pack/src/index.ts
git commit -m "feat(gridiron): situation bucketers + 4th-down arm mapping"
```

---

## Task 3: Deterministic archetype × arm subject id (pack)

Resolves OPEN-1 front-runner **(a)**: the inference subject is the `(situationKey, arm)` pair, encoded as a UUIDv5 so it is deterministic and a valid `@db.Uuid` `aggregateId`.

**Files:**
- Create: `libs/gridiron-pack/src/archetype/archetype-id.ts`
- Test: `libs/gridiron-pack/src/archetype/archetype-id.spec.ts`
- Modify: `libs/gridiron-pack/src/index.ts`, `libs/gridiron-pack/package.json`

- [ ] **Step 1: Add the `uuid` dependency**

Run: `pnpm --filter @de-braighter/gridiron-pack add uuid && pnpm --filter @de-braighter/gridiron-pack add -D @types/uuid`
Expected: `uuid` in dependencies, `@types/uuid` in devDependencies of `libs/gridiron-pack/package.json`.

- [ ] **Step 2: Write the failing test**

```ts
// libs/gridiron-pack/src/archetype/archetype-id.spec.ts
import { describe, expect, it } from 'vitest';
import { archetypeArmId } from './archetype-id.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('archetypeArmId', () => {
  it('is a valid v5 UUID', () => {
    expect(archetypeArmId('short|opp-side|trail|q4-early', 'go')).toMatch(UUID_RE);
  });
  it('is deterministic for the same (key, arm)', () => {
    const a = archetypeArmId('short|opp-side|trail|q4-early', 'go');
    const b = archetypeArmId('short|opp-side|trail|q4-early', 'go');
    expect(a).toBe(b);
  });
  it('differs by arm and by situation', () => {
    const go = archetypeArmId('short|opp-side|trail|q4-early', 'go');
    const punt = archetypeArmId('short|opp-side|trail|q4-early', 'punt');
    const otherSit = archetypeArmId('long|own-deep|lead|1st-half', 'go');
    expect(go).not.toBe(punt);
    expect(go).not.toBe(otherSit);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/archetype/archetype-id.spec.ts`
Expected: FAIL — `Cannot find module './archetype-id.js'`.

- [ ] **Step 4: Write minimal implementation**

```ts
// libs/gridiron-pack/src/archetype/archetype-id.ts
import { v5 as uuidv5 } from 'uuid';
import type { Arm } from './archetype.js';

/** Fixed namespace UUID for deriving deterministic gridiron archetype×arm subject ids. */
export const GRIDIRON_ARCHETYPE_NAMESPACE = '6f2a1c9e-0b3d-4e7a-9c21-5d8f4b6a1e30';

/** Deterministic UUID for a `(situationKey, arm)` pair — the inference subject id. */
export function archetypeArmId(situationKey: string, arm: Arm): string {
  return uuidv5(`${situationKey}|${arm}`, GRIDIRON_ARCHETYPE_NAMESPACE);
}
```

- [ ] **Step 5: Re-export from the pack index**

Edit `libs/gridiron-pack/src/index.ts` — add:
```ts
export * from './archetype/archetype-id.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/archetype/archetype-id.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add libs/gridiron-pack/src/archetype/archetype-id.ts libs/gridiron-pack/src/archetype/archetype-id.spec.ts libs/gridiron-pack/src/index.ts libs/gridiron-pack/package.json
git commit -m "feat(gridiron): deterministic archetype x arm subject id (uuid v5)"
```

---

## Task 4: Play-row schema + play → envelope mapping (pack)

The heart of the ETL: one nflverse row → one `gridiron:Play.v1` envelope (or `null` for non-decision rows).

**Files:**
- Create: `libs/gridiron-pack/src/ingestion/play-row.ts`
- Create: `libs/gridiron-pack/src/ingestion/play-to-envelope.ts`
- Test: `libs/gridiron-pack/src/ingestion/play-to-envelope.spec.ts`
- Modify: `libs/gridiron-pack/src/index.ts`, `libs/gridiron-pack/package.json`

- [ ] **Step 1: Add deps (zod + the substrate envelope type)**

First open `domains/markets/libs/markets-pack/package.json` and note which dependency provides `DomainEventEnvelope` (expected `@de-braighter/substrate-runtime`) and the `zod` version. Then:
```bash
pnpm --filter @de-braighter/gridiron-pack add zod @de-braighter/substrate-runtime
```
> Match the exact versions markets-pack uses. If markets-pack imports `DomainEventEnvelope` from a different package, add that one instead and adjust the import in Step 4.

- [ ] **Step 2: Write the play-row schema** (no test of its own; exercised via Step 3)

```ts
// libs/gridiron-pack/src/ingestion/play-row.ts
import { z } from 'zod';

/** The subset of nflverse play-by-play columns the gridiron ETL consumes. */
export const PlayRowSchema = z.object({
  game_id: z.string(),
  play_id: z.number(),
  game_date: z.string(), // 'YYYY-MM-DD'
  down: z.number().nullable(),
  ydstogo: z.number(),
  yardline_100: z.number(),
  score_differential: z.number().nullable(),
  game_seconds_remaining: z.number().nullable(),
  qtr: z.number(),
  play_type: z.string().nullable(),
  epa: z.number().nullable(),
});

export type PlayRow = z.infer<typeof PlayRowSchema>;
```

- [ ] **Step 3: Write the failing test**

```ts
// libs/gridiron-pack/src/ingestion/play-to-envelope.spec.ts
import { describe, expect, it } from 'vitest';
import { archetypeArmId } from '../archetype/archetype-id.js';
import { GRIDIRON_PLAY_EVENT_TYPE, playRowToEnvelope } from './play-to-envelope.js';
import type { PlayRow } from './play-row.js';

const TPID = '10000000-0000-4001-8000-000000000001';

function row(overrides: Partial<PlayRow> = {}): PlayRow {
  return {
    game_id: '2023_01_BUF_NYJ',
    play_id: 1234,
    game_date: '2023-09-11',
    down: 4,
    ydstogo: 2,
    yardline_100: 35,
    score_differential: -4,
    game_seconds_remaining: 200,
    qtr: 4,
    play_type: 'run',
    epa: 0.42,
    ...overrides,
  };
}

describe('playRowToEnvelope', () => {
  it('maps a 4th-down go play to a Play.v1 envelope', () => {
    const env = playRowToEnvelope(TPID, row());
    expect(env).not.toBeNull();
    expect(env!.eventType).toBe(GRIDIRON_PLAY_EVENT_TYPE);
    expect(env!.aggregateType).toBe('gridiron.play');
    expect(env!.tenantPackId).toBe(TPID);
    expect(env!.packId).toBe('gridiron');
    expect(env!.eventVersion).toBe(1);
    expect(env!.occurredAt).toBe('2023-09-11T00:00:00.000Z');
    // subject id = archetype(short|opp-side|trail|q4-early) x arm(go)
    expect(env!.aggregateId).toBe(archetypeArmId('short|opp-side|trail|q4-early', 'go'));
    expect(env!.payload).toMatchObject({
      decision: 'go',
      epa: 0.42,
      rawOutcome: null,
      archetypeKey: 'short|opp-side|trail|q4-early',
      yardsToGo: 2,
      yardline100: 35,
      scoreDiff: -4,
      secondsLeft: 200,
      qtr: 4,
      gameId: '2023_01_BUF_NYJ',
      playId: 1234,
    });
  });

  it('maps punt and field_goal to their arms', () => {
    expect(playRowToEnvelope(TPID, row({ play_type: 'punt' }))!.payload).toMatchObject({ decision: 'punt' });
    expect(playRowToEnvelope(TPID, row({ play_type: 'field_goal' }))!.payload).toMatchObject({ decision: 'kick' });
  });

  it('returns null for non-4th-down rows', () => {
    expect(playRowToEnvelope(TPID, row({ down: 3 }))).toBeNull();
    expect(playRowToEnvelope(TPID, row({ down: null }))).toBeNull();
  });

  it('returns null for non-decision play types', () => {
    expect(playRowToEnvelope(TPID, row({ play_type: 'qb_kneel' }))).toBeNull();
    expect(playRowToEnvelope(TPID, row({ play_type: null }))).toBeNull();
  });

  it('returns null when the EPA indicator is missing', () => {
    expect(playRowToEnvelope(TPID, row({ epa: null }))).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-pack exec vitest run src/ingestion/play-to-envelope.spec.ts`
Expected: FAIL — `Cannot find module './play-to-envelope.js'`.

- [ ] **Step 5: Write minimal implementation**

```ts
// libs/gridiron-pack/src/ingestion/play-to-envelope.ts
import type { DomainEventEnvelope } from '@de-braighter/substrate-runtime';
import { PACK_ID } from '../constants.js';
import { armFromPlayType, bucketSituation, situationKey } from '../archetype/archetype.js';
import { archetypeArmId } from '../archetype/archetype-id.js';
import type { PlayRow } from './play-row.js';

export const GRIDIRON_PLAY_EVENT_TYPE = 'gridiron:Play.v1';

/**
 * Map ONE nflverse play row to a `Play.v1` envelope.
 * Returns null when the row is not a 4th-down go/punt/kick decision with a usable EPA.
 */
export function playRowToEnvelope(tenantPackId: string, row: PlayRow): DomainEventEnvelope | null {
  if (row.down !== 4) return null;
  if (row.play_type == null) return null;
  const arm = armFromPlayType(row.play_type);
  if (arm == null) return null;
  if (row.epa == null) return null;

  const scoreDiff = row.score_differential ?? 0;
  const secondsLeft = row.game_seconds_remaining ?? 0;

  const archetype = bucketSituation({
    ydstogo: row.ydstogo,
    yardline100: row.yardline_100,
    scoreDiff,
    qtr: row.qtr,
    secondsLeft,
  });
  const key = situationKey(archetype);

  return {
    packId: PACK_ID,
    tenantPackId,
    eventType: GRIDIRON_PLAY_EVENT_TYPE,
    aggregateType: 'gridiron.play',
    aggregateId: archetypeArmId(key, arm),
    eventVersion: 1,
    occurredAt: `${row.game_date}T00:00:00.000Z`,
    payload: {
      decision: arm,
      epa: row.epa,
      rawOutcome: null, // B-ready: Approach B's ETL fills the independent outcome
      archetypeKey: key,
      yardsToGo: row.ydstogo,
      yardline100: row.yardline_100,
      scoreDiff,
      secondsLeft,
      qtr: row.qtr,
      gameId: row.game_id,
      playId: row.play_id,
    },
    metadata: {
      actorRef: 'nflverse-file-source',
      season: row.game_date.slice(0, 4),
    },
  };
}
```
> If `DomainEventEnvelope` does not have a `metadata`/`packId` field (confirm against `markets-pack/src/observations.ts`), match its exact field set — drop or rename to mirror the markets envelope object precisely.

- [ ] **Step 6: Re-export from the pack index**

Edit `libs/gridiron-pack/src/index.ts` — add:
```ts
export * from './ingestion/play-row.js';
export * from './ingestion/play-to-envelope.js';
```

- [ ] **Step 7: Run the full pack test suite**

Run: `pnpm --filter @de-braighter/gridiron-pack test`
Expected: PASS — archetype, archetype-id, and play-to-envelope specs all green.

- [ ] **Step 8: Commit**

```bash
git add libs/gridiron-pack/src/ingestion libs/gridiron-pack/src/index.ts libs/gridiron-pack/package.json
git commit -m "feat(gridiron): nflverse play row -> Play.v1 envelope mapping"
```

---

## Task 5: Play source + ingestion service (api)

Mirrors `markets` `PriceIngestionService`: map rows → envelopes (drop nulls) → write through the kernel outbox inside one `GucPrismaRunner` transaction.

**Files:**
- Create: `apps/gridiron-api/src/ingestion/play-source.token.ts`
- Create: `apps/gridiron-api/src/ingestion/nflverse-file-source.ts`
- Create: `apps/gridiron-api/src/ingestion/play-ingestion.service.ts`
- Test: `apps/gridiron-api/src/ingestion/play-ingestion.service.spec.ts`

- [ ] **Step 1: Define the source token + interface**

```ts
// apps/gridiron-api/src/ingestion/play-source.token.ts
import type { PlayRow } from '@de-braighter/gridiron-pack';

export const PLAY_SOURCE = Symbol('PLAY_SOURCE');

export interface PlaySource {
  read(): readonly PlayRow[];
}
```

- [ ] **Step 2: Write the file source**

```ts
// apps/gridiron-api/src/ingestion/nflverse-file-source.ts
import { readFileSync } from 'node:fs';
import { PlayRowSchema, type PlayRow } from '@de-braighter/gridiron-pack';
import type { PlaySource } from './play-source.token.js';

/** Reads + validates the JSON produced by tools/fetch-nflverse.py. */
export class NflverseFileSource implements PlaySource {
  constructor(private readonly filePath: string) {}

  read(): readonly PlayRow[] {
    const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown[];
    return parsed.map((r) => PlayRowSchema.parse(r));
  }
}
```

- [ ] **Step 3: Write the failing service test** (mirror `price-ingestion.service.spec.ts`)

```ts
// apps/gridiron-api/src/ingestion/play-ingestion.service.spec.ts
import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import {
  DOMAIN_EVENT_PUBLISHER,
  GucPrismaRunner,
} from '@de-braighter/substrate-runtime';
import type { PlayRow } from '@de-braighter/gridiron-pack';
import { PlayIngestionService } from './play-ingestion.service.js';
import { PLAY_SOURCE, type PlaySource } from './play-source.token.js';

function row(overrides: Partial<PlayRow> = {}): PlayRow {
  return {
    game_id: '2023_01_BUF_NYJ', play_id: 1, game_date: '2023-09-11',
    down: 4, ydstogo: 2, yardline_100: 35, score_differential: -4,
    game_seconds_remaining: 200, qtr: 4, play_type: 'run', epa: 0.4,
    ...overrides,
  };
}

async function buildService(rows: readonly PlayRow[]) {
  const publishAll = vi.fn().mockResolvedValue(undefined);
  const run = vi.fn().mockImplementation(async (_tpid: string, cb: (tx: unknown) => unknown) => cb({}));
  const source: PlaySource = { read: () => rows };

  const moduleRef = await Test.createTestingModule({
    providers: [
      PlayIngestionService,
      { provide: DOMAIN_EVENT_PUBLISHER, useValue: { publishAll } },
      { provide: GucPrismaRunner, useValue: { run } },
      { provide: PLAY_SOURCE, useValue: source },
    ],
  }).compile();

  return { service: moduleRef.get(PlayIngestionService), publishAll, run };
}

describe('PlayIngestionService', () => {
  it('writes one envelope per valid 4th-down decision row', async () => {
    const { service, publishAll, run } = await buildService([
      row({ play_type: 'run' }),
      row({ play_type: 'punt' }),
      row({ down: 3 }),            // dropped (not 4th down)
      row({ play_type: 'kickoff' }), // dropped (not a decision)
    ]);

    const result = await service.ingest();

    expect(result).toEqual({ read: 4, ingested: 2 });
    expect(run).toHaveBeenCalledOnce();
    expect(publishAll).toHaveBeenCalledOnce();
    const [envelopes] = publishAll.mock.calls[0];
    expect(envelopes).toHaveLength(2);
    expect(envelopes[0]).toMatchObject({ eventType: 'gridiron:Play.v1', aggregateType: 'gridiron.play' });
  });

  it('writes nothing through the outbox when there are no valid rows', async () => {
    const { service, publishAll } = await buildService([row({ down: 1 })]);
    const result = await service.ingest();
    expect(result).toEqual({ read: 1, ingested: 0 });
    // still called once with an empty array (single transaction), or not at all — assert the count is 0
    const calls = publishAll.mock.calls;
    if (calls.length > 0) expect(calls[0][0]).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @de-braighter/gridiron-api exec vitest run src/ingestion/play-ingestion.service.spec.ts`
Expected: FAIL — `Cannot find module './play-ingestion.service.js'`.

- [ ] **Step 5: Write minimal implementation**

```ts
// apps/gridiron-api/src/ingestion/play-ingestion.service.ts
import { Inject, Injectable } from '@nestjs/common';
import {
  DOMAIN_EVENT_PUBLISHER,
  GucPrismaRunner,
  type DomainEventPublisher,
} from '@de-braighter/substrate-runtime';
import { playRowToEnvelope } from '@de-braighter/gridiron-pack';
import { GRIDIRON_TENANT_PACK_ID } from '../config/tenants.js';
import { PLAY_SOURCE, type PlaySource } from './play-source.token.js';

export interface IngestionResult {
  read: number;
  ingested: number;
}

@Injectable()
export class PlayIngestionService {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    @Inject(GucPrismaRunner) private readonly runner: GucPrismaRunner,
    @Inject(PLAY_SOURCE) private readonly source: PlaySource,
  ) {}

  async ingest(): Promise<IngestionResult> {
    const rows = this.source.read();
    const envelopes = rows
      .map((r) => playRowToEnvelope(GRIDIRON_TENANT_PACK_ID, r))
      .filter((e): e is NonNullable<typeof e> => e !== null);

    await this.runner.run(GRIDIRON_TENANT_PACK_ID, (tx) => this.publisher.publishAll(envelopes, tx));

    return { read: rows.length, ingested: envelopes.length };
  }
}
```
> Confirm the exact import names `DOMAIN_EVENT_PUBLISHER`, `DomainEventPublisher`, `GucPrismaRunner` against `markets-api/src/ingestion/price-ingestion.service.ts`. Confirm `runner.run(tenantPackId, cb)` signature there.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @de-braighter/gridiron-api exec vitest run src/ingestion/play-ingestion.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/gridiron-api/src/ingestion
git commit -m "feat(gridiron): play ingestion service writes Play.v1 via kernel outbox"
```

---

## Task 6: Ingest entrypoint + app wiring + nflverse fetch tool

**Files:**
- Create: `apps/gridiron-api/src/ingestion/ingest.main.ts`
- Modify: `apps/gridiron-api/src/app/app.module.ts`
- Modify: `apps/gridiron-api/package.json` (add `ingest` script)
- Create: `tools/fetch-nflverse.py`
- Create: `data/sample-fourth-downs.json`, `data/.gitignore`

- [ ] **Step 1: Register ingestion providers in the app module**

Open `domains/markets/apps/markets-api/src/app/app.module.ts` and copy how it provides `DOMAIN_EVENT_PUBLISHER` (a `PrismaOutboxWriter`) and `GucPrismaRunner`. Then edit `apps/gridiron-api/src/app/app.module.ts` to add, alongside the existing providers:

```ts
import { NflverseFileSource } from '../ingestion/nflverse-file-source.js';
import { PlayIngestionService } from '../ingestion/play-ingestion.service.js';
import { PLAY_SOURCE } from '../ingestion/play-source.token.js';
// ... plus the same PrismaOutboxWriter / GucPrismaRunner imports markets uses

// inside @Module providers: [...]
PlayIngestionService,
{
  provide: PLAY_SOURCE,
  useFactory: () => new NflverseFileSource(process.env['GRIDIRON_DATA_FILE'] ?? 'data/sample-fourth-downs.json'),
},
// + the DOMAIN_EVENT_PUBLISHER (PrismaOutboxWriter) and GucPrismaRunner providers,
//   mirrored verbatim from markets-api/src/app/app.module.ts
```
> The outbox writer + runner providers may already be present if the DB tier scaffolded them. If so, only add `PlayIngestionService` + the `PLAY_SOURCE` factory.

- [ ] **Step 2: Verify the api still builds**

Run: `pnpm --filter @de-braighter/gridiron-api build`
Expected: build succeeds (DI graph resolves at compile; runtime wiring verified in Task 7).

- [ ] **Step 3: Write the standalone ingest entrypoint**

```ts
// apps/gridiron-api/src/ingestion/ingest.main.ts
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app/app.module.js';
import { PlayIngestionService } from './play-ingestion.service.js';

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const result = await app.get(PlayIngestionService).ingest();
    console.log(`[gridiron ingest] read=${result.read} ingested=${result.ingested}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[gridiron ingest] failed', err);
  process.exit(1);
});
```

- [ ] **Step 4: Add the `ingest` npm script**

Edit `apps/gridiron-api/package.json` `scripts`:
```json
"ingest": "node dist/ingestion/ingest.main.js"
```
> Confirm the build output path (`dist/...`) matches the api's tsconfig `outDir`; adjust if the scaffold emits elsewhere.

- [ ] **Step 5: Write the nflverse fetch tool**

```python
# tools/fetch-nflverse.py
"""Fetch nflverse play-by-play, filter to 4th-down go/punt/kick decisions, emit JSON for the gridiron ETL.

Usage:
  pip install nfl_data_py pandas
  python tools/fetch-nflverse.py --seasons 2022 2023 2024 --out data/fourth-downs-2022-2024.json
"""
import argparse
import json
import nfl_data_py as nfl

COLUMNS = [
    "game_id", "play_id", "game_date", "down", "ydstogo", "yardline_100",
    "score_differential", "game_seconds_remaining", "qtr", "play_type", "epa",
]
DECISION_PLAY_TYPES = {"punt", "field_goal", "run", "pass"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", nargs="+", type=int, required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    df = nfl.import_pbp_data(args.seasons, downcast=True, cache=False)
    df = df[(df["down"] == 4) & (df["play_type"].isin(DECISION_PLAY_TYPES))]
    df = df[COLUMNS].copy()
    df["game_date"] = df["game_date"].astype(str)
    df["play_id"] = df["play_id"].astype(int)
    records = df.where(df.notnull(), None).to_dict(orient="records")
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(records, f)
    print(f"wrote {len(records)} 4th-down plays to {args.out}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 6: Add the committed smoke fixture + data gitignore**

```json
// data/sample-fourth-downs.json  (a few real-shaped rows for a no-Python smoke run)
[
  {"game_id":"2023_01_BUF_NYJ","play_id":101,"game_date":"2023-09-11","down":4,"ydstogo":1,"yardline_100":38,"score_differential":-3,"game_seconds_remaining":210,"qtr":4,"play_type":"run","epa":0.55},
  {"game_id":"2023_01_BUF_NYJ","play_id":102,"game_date":"2023-09-11","down":4,"ydstogo":8,"yardline_100":62,"score_differential":-3,"game_seconds_remaining":900,"qtr":3,"play_type":"punt","epa":-0.10},
  {"game_id":"2023_02_KC_JAX","play_id":201,"game_date":"2023-09-17","down":4,"ydstogo":3,"yardline_100":22,"score_differential":7,"game_seconds_remaining":400,"qtr":4,"play_type":"field_goal","epa":0.30},
  {"game_id":"2023_02_KC_JAX","play_id":202,"game_date":"2023-09-17","down":3,"ydstogo":5,"yardline_100":40,"score_differential":0,"game_seconds_remaining":1800,"qtr":2,"play_type":"pass","epa":0.05}
]
```

```gitignore
# data/.gitignore — ignore bulk fetch output, keep the smoke fixture
*.json
!sample-fourth-downs.json
```

- [ ] **Step 7: Commit**

```bash
git add apps/gridiron-api/src/ingestion/ingest.main.ts apps/gridiron-api/src/app/app.module.ts apps/gridiron-api/package.json tools/fetch-nflverse.py data/sample-fourth-downs.json data/.gitignore
git commit -m "feat(gridiron): ingest entrypoint, app wiring, nflverse fetch tool + smoke fixture"
```

---

## Task 7: Live verification (events land in the event_log)

**Verification task (not TDD).** Proves the wiring end-to-end against a real Postgres. Run from `domains/gridiron/`.

- [ ] **Step 1: Start the database**

Run: `docker compose up -d gridiron-db`
Expected: container healthy on port `5465`.

- [ ] **Step 2: Provision schema + seed the plan root**

Run:
```bash
cp .env.example .env   # if not already present
node tools/db/setup.mjs
psql "$DATABASE_URL_MIGRATE" -f tools/db/seed.sql
```
Expected: `kernel` schema created (`event_log`, `outbox`, `plan_node`); one plan-root row seeded.

- [ ] **Step 3: Build + run the ingest against the smoke fixture**

Run:
```bash
pnpm --filter @de-braighter/gridiron-api build
pnpm --filter @de-braighter/gridiron-api ingest
```
Expected stdout: `[gridiron ingest] read=4 ingested=3` (4 rows in the fixture; the 3rd-down `pass` row is dropped).

- [ ] **Step 4: Confirm rows in the event_log**

Run:
```bash
psql "$DATABASE_URL" -c "select event_type, aggregate_type, count(*) from kernel.event_log group by 1,2;"
psql "$DATABASE_URL" -c "select aggregate_id, payload->>'decision' as decision, payload->>'archetypeKey' as situation, payload->>'epa' as epa from kernel.event_log order by recorded_at limit 5;"
```
Expected: `gridiron:Play.v1 | gridiron.play | 3`; three rows with `decision` ∈ {go, punt, kick}, distinct `aggregate_id`s, populated `archetypeKey`/`epa`.

- [ ] **Step 5: (Optional) full-season load**

Run:
```bash
pip install nfl_data_py pandas
python tools/fetch-nflverse.py --seasons 2022 2023 2024 --out data/fourth-downs-2022-2024.json
GRIDIRON_DATA_FILE=data/fourth-downs-2022-2024.json pnpm --filter @de-braighter/gridiron-api ingest
```
Expected: several thousand `gridiron:Play.v1` rows; `select count(*) from kernel.event_log;` in the low thousands.

- [ ] **Step 6: Record the run in the README**

Add a short "Slice 1 — ingest run" section to `domains/gridiron/README.md` with the commands above, then commit:
```bash
git add domains/gridiron/README.md
git commit -m "docs(gridiron): slice-1 ingest run recipe"
```

---

## Self-Review

**Spec coverage (against `2026-06-09-gridiron-nfl-4th-down-what-if-design.md`):**
- §3 In — source-spine ETL ✅ (Tasks 4–6); archetype bucketing ✅ (Task 2); DB tier ✅ (Task 1). Inference catalog / `/readout` / what-if / UI / validation harness → **deferred to Slices 2–4** (out of this plan by design; see scope check).
- §4 architecture & tiers ✅ (Task 1; ports flagged for collision check).
- §5 event shape ✅ (Task 4 envelope matches the `Play.v1` payload incl. `rawOutcome: null` B-readiness + confounder fields).
- §6 subject/archetype/arms ✅ (Tasks 2–3); OPEN-1 resolved as front-runner **(a)** with a written note where it's encoded (Task 3 + Task 4 `aggregateId`).
- §10 testing — unit (Tasks 2–5) ✅; integration via the live run (Task 7) ✅; e2e/validation → later slices.

**Placeholder scan:** No "TBD/TODO/handle edge cases" steps; every code step shows full code. The three `>` notes (envelope field set, substrate import names, build outDir) are *verification instructions against named existing files*, not deferred work.

**Type consistency:** `Arm` (`'go'|'punt'|'kick'`), `situationKey` format `distance|field|score|time`, `archetypeArmId(situationKey, arm)`, `playRowToEnvelope(tenantPackId, row)`, `IngestionResult { read, ingested }`, `PLAY_SOURCE`/`PlaySource.read()` are used identically across Tasks 2–6. `GRIDIRON_PLAY_EVENT_TYPE = 'gridiron:Play.v1'` and `aggregateType = 'gridiron.play'` consistent in mapping, test, and the psql assertion.

**Scope:** Single coherent slice (scaffold → pure ETL → service → live proof). Slices 2 (catalog + `/readout`), 3 (what-if + UI), 4 (validation harness) follow as separate plans.
