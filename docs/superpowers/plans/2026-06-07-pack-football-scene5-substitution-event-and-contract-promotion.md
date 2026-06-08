# Scene 5 substitution event emission + tactical-board contract promotion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the tactical-board wire type to `@de-braighter/pack-football-contracts`, and make the Scene 5 visual-editor board (Board #1) emit `football:SubstitutionMade.v1` on a substitution — fed by a new match-minute control — reusing the existing `MatchDayClient.substitute()`.

**Architecture:** Two independent parts. **Part A** (Tasks 1–2) moves the board *wire* shape to the contracts lib as Zod schemas (`.readonly()`-preserving) + re-exports it from `pack-football-ui`. **Part B** (Tasks 3–5) adds a pure gesture→request helper, extracts a shared client-error describer (2nd consumer), and wires `MatchDayScene5PageComponent`'s `substitute` gesture to POST a substitution via `MatchDayClient` alongside the existing plan-tree metadata-patch (dual-write).

**Tech Stack:** TypeScript, Angular 21 (standalone, signals, OnPush, zoneless), Zod 3.25, NestJS-side endpoint already exists, vitest + `@angular/core/testing` TestBed, Nx 22. All runs from `domains/exercir`.

**Source spec:** `docs/superpowers/specs/2026-06-07-pack-football-scene5-substitution-event-and-contract-promotion-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `libs/pack-football-contracts/src/lib/tactical-board.schemas.ts` | Create | Zod schemas + inferred types for the board wire shape (position/slot/bench/point/play/board) |
| `libs/pack-football-contracts/src/lib/contracts.spec.ts` | Modify | Add tactical-board schema cases |
| `libs/pack-football-contracts/src/index.ts` | Modify | Export the new schemas + types |
| `libs/pack-football-ui/src/lib/tactical-board/tactical-board.types.ts` | Modify | Re-export the promoted wire types from contracts; keep UI-only types local |
| `libs/pack-football-ui/src/lib/tactical-board/tactical-board-event-ops.ts` | Create | Pure `substitutionRequestFromGesture` + `MINUTE_MIN/MAX` |
| `libs/pack-football-ui/src/lib/tactical-board/tactical-board-event-ops.spec.ts` | Create | Helper unit tests |
| `libs/pack-football-ui/src/lib/data/describe-match-day-client-failure.ts` | Create | Shared `describeMatchDayClientFailure` (extracted from the coach page) |
| `libs/pack-football-ui/src/lib/data/describe-match-day-client-failure.spec.ts` | Create | Describer unit tests |
| `libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.ts` | Modify | Use the shared describer; delete the local `describeWriteError` |
| `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts` | Modify | Minute control + `substitute`→event wiring |
| `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.spec.ts` | Modify | Minute + substitution-emission tests |

ESM `.js` import specifiers everywhere. `tactical-board.types.ts` / `tactical-board-event-ops.ts` stay pure (no Angular/NestJS).

## Reference patterns

- **Promotion precedent:** `libs/pack-football-contracts/src/lib/drill-diagram.schemas.ts` + its `contracts.spec.ts` cases (Zod-first + `z.infer`).
- **The client already built:** `libs/pack-football-ui/src/lib/data/match-day.client.ts` — `substitute(matchId, req, signal?)`.
- **The describer to extract:** `describeWriteError` at the bottom of `coach-tactical-board-page.component.ts`.
- **The current board types** (the shape to reproduce exactly): `libs/pack-football-ui/src/lib/tactical-board/tactical-board.types.ts`.
- **The page-spec harness:** `match-day-scene5-page.component.spec.ts` (`configure` / `render` / `boardComponent` helpers).

---

### Task 1: Promote the board wire type to contracts (Zod schemas)

**Files:** Create `libs/pack-football-contracts/src/lib/tactical-board.schemas.ts`; Modify `contracts.spec.ts`.

- [ ] **Step 1: Write the failing test** — append to `libs/pack-football-contracts/src/lib/contracts.spec.ts`:

Add to the imports at the top of the file:

```ts
import {
  TacticalBoardSchema,
  TacticalSlotSchema,
  PlayAnnotationSchema,
} from './tactical-board.schemas.js';
```

Append this describe block:

```ts
describe('tactical-board schemas', () => {
  const slot = { slotId: 's-cm', playerId: 'p1', position: 'CM', x: 50, y: 60 };
  const board = {
    sceneKind: 'pack-football.tactical-board.v1',
    schemaVersion: 1,
    lineup: [slot],
    bench: [{ benchId: 'b-1', playerId: 'p2', position: 'ST' }],
    captainSlotId: 's-cm',
    plays: [],
  };

  it('accepts a well-formed board', () => {
    expect(TacticalBoardSchema.parse(board)).toEqual(board);
  });

  it('allows a null captain and an unfilled lineup slot', () => {
    expect(
      TacticalBoardSchema.safeParse({
        ...board,
        captainSlotId: null,
        lineup: [{ ...slot, playerId: null }],
      }).success,
    ).toBe(true);
  });

  it('rejects a board missing the lineup array', () => {
    const { lineup: _omit, ...noLineup } = board;
    expect(TacticalBoardSchema.safeParse(noLineup).success).toBe(false);
  });

  it('rejects an unknown position code', () => {
    expect(TacticalSlotSchema.safeParse({ ...slot, position: 'XX' }).success).toBe(false);
  });

  it('parses both play-annotation arms', () => {
    expect(
      PlayAnnotationSchema.safeParse({
        playId: 'pa-1',
        kind: 'run-arrow',
        points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
      }).success,
    ).toBe(true);
    expect(
      PlayAnnotationSchema.safeParse({
        playId: 'pa-2',
        kind: 'zone-highlight',
        x: 0,
        y: 0,
        w: 10,
        h: 10,
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football-contracts`
Expected: FAIL — `Cannot find module './tactical-board.schemas.js'`.

- [ ] **Step 3: Create the schema module** — `libs/pack-football-contracts/src/lib/tactical-board.schemas.ts`:

```ts
/**
 * Tactical-board wire schemas (ADR-160 Scene 5; promoted from pack-football-ui
 * per ADR-160 §97 so the server reuses one source of truth). Mirrors the
 * `metadata.visualEditor` attachment shape: `{ sceneKind, schemaVersion, lineup,
 * bench, captainSlotId, plays }`. Arrays carry `.readonly()` so the inferred
 * types match the editor's `readonly` shape exactly. Interaction-only types
 * (gestures, viewport, pitch extents) stay in pack-football-ui — the server
 * never needs them.
 */

import { z } from 'zod';

/** Player-position label carried by a lineup slot. */
export const TacticalPositionSchema = z.enum([
  'GK',
  'LB',
  'CB',
  'RB',
  'CDM',
  'CM',
  'CAM',
  'LW',
  'RW',
  'ST',
]);
export type TacticalPosition = z.infer<typeof TacticalPositionSchema>;

/** A positioned player slot on the pitch (`x`/`y` in the 100×120 frame). */
export const TacticalSlotSchema = z.object({
  slotId: z.string(),
  playerId: z.string().nullable(),
  position: TacticalPositionSchema,
  x: z.number(),
  y: z.number(),
});
export type TacticalSlot = z.infer<typeof TacticalSlotSchema>;

/** An off-pitch player in the bench rail. */
export const BenchSlotSchema = z.object({
  benchId: z.string(),
  playerId: z.string(),
  position: TacticalPositionSchema.optional(),
});
export type BenchSlot = z.infer<typeof BenchSlotSchema>;

/** A point in the 100×120 pitch frame. */
export const BoardPointSchema = z.object({ x: z.number(), y: z.number() });
export type BoardPoint = z.infer<typeof BoardPointSchema>;

/** Discriminant of a play-pattern annotation. */
export type PlayAnnotationKind = 'run-arrow' | 'pass-arrow' | 'zone-highlight';

/**
 * A coach-drawn play annotation. `run-arrow`/`pass-arrow` carry a polyline;
 * `zone-highlight` carries a rectangle. Modelled as a `union` (not
 * `discriminatedUnion`) so the arrow arm keeps its combined `'run-arrow' |
 * 'pass-arrow'` kind — matching the editor's existing type exactly.
 */
export const PlayAnnotationSchema = z.union([
  z.object({
    playId: z.string(),
    kind: z.enum(['run-arrow', 'pass-arrow']),
    points: z.array(BoardPointSchema).readonly(),
  }),
  z.object({
    playId: z.string(),
    kind: z.literal('zone-highlight'),
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }),
]);
export type PlayAnnotation = z.infer<typeof PlayAnnotationSchema>;

/** Scene-kind literal (ADR-160 §Scene-type versioning). */
export const TACTICAL_BOARD_SCENE_KIND = 'pack-football.tactical-board.v1' as const;
export type TacticalBoardSceneKind = typeof TACTICAL_BOARD_SCENE_KIND;

/** The attachment schema version the host can branch on when migrating payloads. */
export const TACTICAL_BOARD_SCHEMA_VERSION = 1 as const;
export type TacticalBoardSchemaVersion = typeof TACTICAL_BOARD_SCHEMA_VERSION;

/** The full tactical-board working state (the `metadata.visualEditor` shape). */
export const TacticalBoardSchema = z.object({
  sceneKind: z.literal(TACTICAL_BOARD_SCENE_KIND),
  schemaVersion: z.literal(TACTICAL_BOARD_SCHEMA_VERSION),
  lineup: z.array(TacticalSlotSchema).readonly(),
  bench: z.array(BenchSlotSchema).readonly(),
  captainSlotId: z.string().nullable(),
  plays: z.array(PlayAnnotationSchema).readonly(),
});
export type TacticalBoard = z.infer<typeof TacticalBoardSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football-contracts`
Expected: PASS (existing drill/squad cases + the 5 new tactical-board cases).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-contracts/src/lib/tactical-board.schemas.ts libs/pack-football-contracts/src/lib/contracts.spec.ts
git commit -m "feat(pack-football-contracts): promote tactical-board wire schema (ADR-160 §97)"
```

---

### Task 2: Export from contracts + re-export from pack-football-ui

**Files:** Modify `libs/pack-football-contracts/src/index.ts`, `libs/pack-football-ui/src/lib/tactical-board/tactical-board.types.ts`.

- [ ] **Step 1: Export from the contracts barrel** — append to `libs/pack-football-contracts/src/index.ts`:

```ts
export {
  TACTICAL_BOARD_SCENE_KIND,
  TACTICAL_BOARD_SCHEMA_VERSION,
  TacticalPositionSchema,
  TacticalSlotSchema,
  BenchSlotSchema,
  BoardPointSchema,
  PlayAnnotationSchema,
  TacticalBoardSchema,
  type TacticalPosition,
  type TacticalSlot,
  type BenchSlot,
  type BoardPoint,
  type PlayAnnotation,
  type PlayAnnotationKind,
  type TacticalBoard,
  type TacticalBoardSceneKind,
  type TacticalBoardSchemaVersion,
} from './lib/tactical-board.schemas.js';
```

- [ ] **Step 2: Build the contracts lib (so the dist the UI resolves is fresh)**

Run: `npx nx build pack-football-contracts`
Expected: PASS.

- [ ] **Step 3: Replace the local board types with re-exports** — overwrite `libs/pack-football-ui/src/lib/tactical-board/tactical-board.types.ts` with:

```ts
/**
 * tactical-board.types.ts — Scene 5 board types.
 *
 * The WIRE/board shapes (TacticalBoard + slots/bench/plays/positions + the
 * sceneKind/schemaVersion constants) are promoted to
 * `@de-braighter/pack-football-contracts` (ADR-160 §97) so the server reuses one
 * source of truth; this module re-exports them. The UI-only interaction types
 * (gesture vocabulary, viewport, pitch extents, FormationSnapshot) stay here —
 * the server never needs them. These shapes are presentational + pure (no
 * Angular, no NestJS, no HTTP).
 */

export {
  TACTICAL_BOARD_SCENE_KIND,
  TACTICAL_BOARD_SCHEMA_VERSION,
  TacticalPositionSchema,
  TacticalSlotSchema,
  BenchSlotSchema,
  BoardPointSchema,
  PlayAnnotationSchema,
  TacticalBoardSchema,
  type TacticalPosition,
  type TacticalSlot,
  type BenchSlot,
  type BoardPoint,
  type PlayAnnotation,
  type PlayAnnotationKind,
  type TacticalBoard,
  type TacticalBoardSceneKind,
  type TacticalBoardSchemaVersion,
} from '@de-braighter/pack-football-contracts';

import type {
  TacticalBoard,
  PlayAnnotation,
} from '@de-braighter/pack-football-contracts';

// ─── UI-only types (interaction + presentation) ──────────────────────────────

/** A serializable snapshot of a board at a labelled match minute. */
export interface FormationSnapshot {
  label: string;
  takenAt: string;
  board: TacticalBoard;
}

/**
 * The typed gesture union the board component emits. Each maps 1:1 to the
 * ADR-160 Scene 5 gesture vocab. The host translates a gesture into a plan-tree
 * edit / metadata-patch via `tactical-board-tree-ops.ts`.
 */
export type TacticalGesture =
  | { kind: 'swap-slot'; slotIdA: string; slotIdB: string }
  | { kind: 'substitute'; outSlotId: string; inBenchId: string }
  | { kind: 'set-captain'; slotId: string }
  | { kind: 'move-slot'; slotId: string; x: number; y: number }
  | { kind: 'draw-play'; play: PlayAnnotation }
  | { kind: 'clear-play'; playId: string }
  | { kind: 'snapshot-formation'; label: string };

/** The kind discriminant of a {@link TacticalGesture}. */
export type TacticalGestureKind = TacticalGesture['kind'];

/** A pixel viewport the 100×120 normalised frame is projected into. */
export interface TacticalViewport {
  width: number;
  height: number;
}

/** Normalised pitch frame extents (ADR-160 Scene 5 §Coordinate system). */
export const TACTICAL_PITCH_LENGTH = 100; // x max (touchline-to-touchline)
export const TACTICAL_PITCH_HEIGHT = 120; // y max (goal-line-to-goal-line, vertical)
```

- [ ] **Step 4: Build + test pack-football-ui (proves the type move is structurally transparent)**

Run: `npx nx build pack-football-ui`
Expected: PASS (no `readonly` / shape errors — `parseVisualEditorBoard`, the board component, tree-ops all compile against the re-exported types).

Run: `npx nx test pack-football-ui`
Expected: PASS (incl. the existing `match-day-scene5-page.component.spec.ts` + wire-parity specs).

If the build fails on a `readonly` mismatch, the `.readonly()` calls in Task 1 are the fix point — do NOT relax consumers.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-contracts/src/index.ts libs/pack-football-ui/src/lib/tactical-board/tactical-board.types.ts
git commit -m "refactor(pack-football-ui): consume the promoted tactical-board type from contracts"
```

---

### Task 3: Pure gesture→substitution-request helper

**Files:** Create `libs/pack-football-ui/src/lib/tactical-board/tactical-board-event-ops.ts` + its spec.

- [ ] **Step 1: Write the failing test** — `libs/pack-football-ui/src/lib/tactical-board/tactical-board-event-ops.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  MINUTE_MIN,
  MINUTE_MAX,
  substitutionRequestFromGesture,
} from './tactical-board-event-ops.js';
import {
  TACTICAL_BOARD_SCENE_KIND,
  TACTICAL_BOARD_SCHEMA_VERSION,
  type TacticalBoard,
} from './tactical-board.types.js';

/** A post-substitution board: incoming player on the pitch slot, outgoing on the bench. */
function postBoard(): TacticalBoard {
  return {
    sceneKind: TACTICAL_BOARD_SCENE_KIND,
    schemaVersion: TACTICAL_BOARD_SCHEMA_VERSION,
    lineup: [{ slotId: 's-cm', playerId: 'in-player', position: 'CM', x: 50, y: 60 }],
    bench: [{ benchId: 'b-1', playerId: 'out-player', position: 'CM' }],
    captainSlotId: null,
    plays: [],
  };
}

describe('substitutionRequestFromGesture', () => {
  it('derives playerIn (lineup[outSlotId]) and playerOut (bench[inBenchId]) from the post-board', () => {
    const req = substitutionRequestFromGesture(
      { kind: 'substitute', outSlotId: 's-cm', inBenchId: 'b-1' },
      postBoard(),
      'team-1',
      MINUTE_MAX,
    );
    expect(req).toEqual({
      teamId: 'team-1',
      playerOutId: 'out-player',
      playerInId: 'in-player',
      minute: MINUTE_MAX,
    });
  });

  it('returns null for a no-op substitution (out-slot has no player)', () => {
    const board = postBoard();
    const emptied: TacticalBoard = {
      ...board,
      lineup: [{ ...board.lineup[0]!, playerId: null }],
    };
    expect(
      substitutionRequestFromGesture(
        { kind: 'substitute', outSlotId: 's-cm', inBenchId: 'b-1' },
        emptied,
        'team-1',
        MINUTE_MIN,
      ),
    ).toBeNull();
  });

  it('returns null when the bench id is absent', () => {
    expect(
      substitutionRequestFromGesture(
        { kind: 'substitute', outSlotId: 's-cm', inBenchId: 'missing' },
        postBoard(),
        'team-1',
        10,
      ),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football-ui -- tactical-board-event-ops`
Expected: FAIL — `Cannot find module './tactical-board-event-ops.js'`.

- [ ] **Step 3: Create the helper** — `libs/pack-football-ui/src/lib/tactical-board/tactical-board-event-ops.ts`:

```ts
/**
 * tactical-board-event-ops.ts — pure mapper: a Scene 5 `substitute` gesture +
 * the POST-gesture board → the `MatchDayClient.substitute` request body
 * (`football:SubstitutionMade.v1`).
 *
 * `substitute()` (tactical-board-ops) reuses the freed bench id, so AFTER the
 * swap the incoming player sits in `lineup[outSlotId]` and the outgoing player
 * sits in `bench[inBenchId]`. Both player ids are therefore recoverable from
 * the post-gesture board alone — no pre/post diff, no gesture enrichment.
 *
 * Returns null for a no-op substitution (either id missing) so the host skips
 * the event emission.
 */

import type { SubstitutionRequest } from '../data/wire-schemas.js';
import type { TacticalBoard, TacticalGesture } from './tactical-board.types.js';

/** Inclusive bounds the match-day endpoint enforces on `minute`. */
export const MINUTE_MIN = 0;
export const MINUTE_MAX = 130;

/** The `substitute` arm of {@link TacticalGesture}. */
type SubstituteGesture = Extract<TacticalGesture, { kind: 'substitute' }>;

export function substitutionRequestFromGesture(
  gesture: SubstituteGesture,
  postBoard: TacticalBoard,
  teamId: string,
  minute: number,
): SubstitutionRequest | null {
  const playerInId =
    postBoard.lineup.find((s) => s.slotId === gesture.outSlotId)?.playerId ?? null;
  const playerOutId =
    postBoard.bench.find((b) => b.benchId === gesture.inBenchId)?.playerId ?? null;
  if (playerInId === null || playerOutId === null) return null;
  return { teamId, playerOutId, playerInId, minute };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football-ui -- tactical-board-event-ops`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/tactical-board/tactical-board-event-ops.ts libs/pack-football-ui/src/lib/tactical-board/tactical-board-event-ops.spec.ts
git commit -m "feat(pack-football-ui): pure substitute-gesture → SubstitutionMade request helper"
```

---

### Task 4: Extract the shared MatchDayClient-failure describer

**Files:** Create `describe-match-day-client-failure.ts` + spec; Modify `coach-tactical-board-page.component.ts`.

- [ ] **Step 1: Write the failing test** — `libs/pack-football-ui/src/lib/data/describe-match-day-client-failure.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { describeMatchDayClientFailure } from './describe-match-day-client-failure.js';
import { MatchDayClientError } from './match-day.client.js';

describe('describeMatchDayClientFailure', () => {
  it('surfaces the domain `kind` from an http-error body', () => {
    const err = new MatchDayClientError({
      kind: 'http-error',
      status: 409,
      body: { kind: 'player-in-not-on-bench' },
      requestId: 'r1',
    });
    expect(describeMatchDayClientFailure(err)).toBe('player-in-not-on-bench');
  });

  it('falls back to `http-error {status}` when the body has no kind', () => {
    const err = new MatchDayClientError({
      kind: 'http-error',
      status: 500,
      body: {},
      requestId: 'r1',
    });
    expect(describeMatchDayClientFailure(err)).toBe('http-error 500');
  });

  it('returns the failure kind for a non-http failure', () => {
    const err = new MatchDayClientError({ kind: 'network-error', message: 'down', requestId: 'r1' });
    expect(describeMatchDayClientFailure(err)).toBe('network-error');
  });

  it('returns the message for a plain Error', () => {
    expect(describeMatchDayClientFailure(new Error('boom'))).toBe('boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football-ui -- describe-match-day-client-failure`
Expected: FAIL — `Cannot find module './describe-match-day-client-failure.js'`.

- [ ] **Step 3: Create the describer** — `libs/pack-football-ui/src/lib/data/describe-match-day-client-failure.ts` (the coach page's `describeWriteError` body verbatim):

```ts
/**
 * describeMatchDayClientFailure — user-facing reason for a failed match-day
 * write. For an http-error the server attaches the parsed JSON body, whose
 * `kind` carries the actual domain reason (e.g. `player-in-not-on-bench`) —
 * surface THAT rather than the useless generic `http-error`. Falls back to the
 * status, then the failure kind, then the raw Error message.
 *
 * Shared by CoachTacticalBoardPageComponent + MatchDayScene5PageComponent
 * (2nd consumer — promoted per the match-day.client.ts §helpers note).
 */

import { commonMsg } from '../i18n/common-i18n.js';
import { MatchDayClientError } from './match-day.client.js';

export function describeMatchDayClientFailure(err: unknown): string {
  if (err instanceof MatchDayClientError) {
    const failure = err.failure;
    if (failure.kind === 'http-error') {
      const body = failure.body;
      if (
        typeof body === 'object' &&
        body !== null &&
        'kind' in body &&
        typeof (body as { kind: unknown }).kind === 'string'
      ) {
        return (body as { kind: string }).kind;
      }
      return `http-error ${failure.status}`;
    }
    return failure.kind;
  }
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : commonMsg('common.error.unknown');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football-ui -- describe-match-day-client-failure`
Expected: PASS.

- [ ] **Step 5: Repoint the coach page to the shared describer.** In `libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.ts`:

1. Change the match-day-client import (line ~37) from:

```ts
import { MatchDayClient, MatchDayClientError } from '../../data/match-day.client.js';
```

to:

```ts
import { MatchDayClient } from '../../data/match-day.client.js';
import { describeMatchDayClientFailure } from '../../data/describe-match-day-client-failure.js';
```

2. In `onSubstitute`, change `substitutionFailedLabel(describeWriteError(err))` to `substitutionFailedLabel(describeMatchDayClientFailure(err))`.
3. In `onChangeFormation`, change `formationFailedLabel(describeWriteError(err))` to `formationFailedLabel(describeMatchDayClientFailure(err))`.
4. **Delete** the module-private `describeWriteError` function at the bottom of the file (the whole `function describeWriteError(err: unknown): string { … }`).
5. If lint now flags `commonMsg` as unused in this file, remove its import (`import { commonMsg } from '../../i18n/common-i18n.js';`). (`describeMatchDayClientFailure` owns that fallback now.)

- [ ] **Step 6: Verify the coach page + its spec stay green, and lint is clean**

Run: `npx nx test pack-football-ui -- coach-tactical-board-page`
Expected: PASS (behaviour is identical — the describer moved, not changed).

Run: `npx nx lint pack-football-ui`
Expected: PASS (no unused imports).

- [ ] **Step 7: Commit**

```bash
git add libs/pack-football-ui/src/lib/data/describe-match-day-client-failure.ts libs/pack-football-ui/src/lib/data/describe-match-day-client-failure.spec.ts libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.ts
git commit -m "refactor(pack-football-ui): extract shared describeMatchDayClientFailure (2nd consumer)"
```

---

### Task 5: Wire the Scene 5 page — minute control + substitute→event

**Files:** Modify `match-day-scene5-page.component.ts` + its spec.

- [ ] **Step 1: Write the failing tests** — in `match-day-scene5-page.component.spec.ts`:

1. Add imports:

```ts
import { MatchDayClient } from '../../data/match-day.client.js';
import { SEEDED_FC_LANGGASSE_TEAM_ID } from '../../data/wire-schemas.js';
```

2. Replace the `configure` helper so it also provides a fake `MatchDayClient`:

```ts
function configure(client: Partial<SubstrateClient>, matchDay: Partial<MatchDayClient> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SubstrateClient, useValue: client as SubstrateClient },
      { provide: MatchDayClient, useValue: matchDay as MatchDayClient },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: { get: () => null } } },
      },
    ],
  });
}
```

3. Append these tests inside the `describe('MatchDayScene5PageComponent', …)` block:

```ts
  it('on a substitute gesture, POSTs a substitution (derived ids + minute) AND the metadata-patch', async () => {
    const applyEdit = vi.fn<SubstrateClient['applyEdit']>(
      async () => ({ tree: makeTree(), requestId: 'r2' }) as ApplyEditResponse,
    );
    const substitute = vi.fn(async () => ({
      entryId: 'e1',
      matchId: MATCH_NODE,
      minute: 0,
      appendedAt: '2026-05-23T14:30:00.000Z',
    }));
    configure(
      { getPlanTree: vi.fn(async () => ({ tree: makeTree(), requestId: 'r1' })), applyEdit },
      { substitute },
    );
    const fixture = await render();

    const post: TacticalBoard = {
      ...boardComponent(fixture).board(),
      lineup: [{ slotId: 's-cm', position: 'CM', x: 50, y: 60, playerId: 'in-player' }],
      bench: [{ benchId: 'b-1', playerId: 'out-player', position: 'CM' }],
    };
    boardComponent(fixture).boardChange.emit({
      gesture: { kind: 'substitute', outSlotId: 's-cm', inBenchId: 'b-1' },
      board: post,
    });
    await fixture.whenStable();

    expect(applyEdit).toHaveBeenCalledOnce(); // dual-write: metadata-patch still fires
    expect(substitute).toHaveBeenCalledOnce();
    const [matchId, req] = substitute.mock.calls[0]!;
    expect(matchId).toBe(MATCH_NODE);
    expect(req).toEqual({
      teamId: SEEDED_FC_LANGGASSE_TEAM_ID,
      playerOutId: 'out-player',
      playerInId: 'in-player',
      minute: 0,
    });
  });

  it('does NOT POST a substitution for a non-substitute gesture', async () => {
    const substitute = vi.fn(async () => ({ entryId: 'e1', matchId: MATCH_NODE, minute: 0, appendedAt: 'x' }));
    configure(
      {
        getPlanTree: vi.fn(async () => ({ tree: makeTree(), requestId: 'r1' })),
        applyEdit: vi.fn(async () => ({ tree: makeTree(), requestId: 'r2' }) as ApplyEditResponse),
      },
      { substitute },
    );
    const fixture = await render();

    boardComponent(fixture).boardChange.emit({
      gesture: { kind: 'set-captain', slotId: 's-st' },
      board: boardComponent(fixture).board(),
    });
    await fixture.whenStable();

    expect(substitute).not.toHaveBeenCalled();
  });

  it('carries the minute from the control into the substitution request', async () => {
    const substitute = vi.fn(async () => ({ entryId: 'e1', matchId: MATCH_NODE, minute: 65, appendedAt: 'x' }));
    configure(
      {
        getPlanTree: vi.fn(async () => ({ tree: makeTree(), requestId: 'r1' })),
        applyEdit: vi.fn(async () => ({ tree: makeTree(), requestId: 'r2' }) as ApplyEditResponse),
      },
      { substitute },
    );
    const fixture = await render();

    const input = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="scene5-minute"]',
    ) as HTMLInputElement;
    input.value = '65';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const post: TacticalBoard = {
      ...boardComponent(fixture).board(),
      lineup: [{ slotId: 's-cm', position: 'CM', x: 50, y: 60, playerId: 'in-player' }],
      bench: [{ benchId: 'b-1', playerId: 'out-player', position: 'CM' }],
    };
    boardComponent(fixture).boardChange.emit({
      gesture: { kind: 'substitute', outSlotId: 's-cm', inBenchId: 'b-1' },
      board: post,
    });
    await fixture.whenStable();

    expect(substitute.mock.calls[0]![1].minute).toBe(65);
  });

  it('surfaces an inline substitution error without collapsing the board', async () => {
    const substitute = vi.fn(async () => {
      throw new MatchDayClientError({
        kind: 'http-error',
        status: 409,
        body: { kind: 'player-in-not-on-bench' },
        requestId: 'r3',
      });
    });
    configure(
      {
        getPlanTree: vi.fn(async () => ({ tree: makeTree(), requestId: 'r1' })),
        applyEdit: vi.fn(async () => ({ tree: makeTree(), requestId: 'r2' }) as ApplyEditResponse),
      },
      { substitute },
    );
    const fixture = await render();

    const post: TacticalBoard = {
      ...boardComponent(fixture).board(),
      lineup: [{ slotId: 's-cm', position: 'CM', x: 50, y: 60, playerId: 'in-player' }],
      bench: [{ benchId: 'b-1', playerId: 'out-player', position: 'CM' }],
    };
    boardComponent(fixture).boardChange.emit({
      gesture: { kind: 'substitute', outSlotId: 's-cm', inBenchId: 'b-1' },
      board: post,
    });
    await fixture.whenStable();
    fixture.detectChanges();

    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('[data-testid="scene5-substitution-error"]')).not.toBeNull();
    expect(root.querySelector('lib-tactical-board')).not.toBeNull();
  });
```

4. Add `MatchDayClientError` to the substrate-client/test imports — at the top add:

```ts
import { MatchDayClientError } from '../../data/match-day.client.js';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx nx test pack-football-ui -- match-day-scene5-page`
Expected: FAIL — no `[data-testid="scene5-minute"]`, `substitute` never called (the wiring doesn't exist yet).

- [ ] **Step 3: Wire the page.** In `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts`:

1. Extend the `board-i18n` import to add `substitutionFailedLabel`:

```ts
import { boardMsg, scene5PersistErrorLabel, substitutionFailedLabel } from '../../tactical-board/board-i18n.js';
```

2. Add these imports:

```ts
import { commonMsg } from '../../i18n/common-i18n.js';
import { MatchDayClient } from '../../data/match-day.client.js';
import { describeMatchDayClientFailure } from '../../data/describe-match-day-client-failure.js';
import {
  MINUTE_MIN,
  MINUTE_MAX,
  substitutionRequestFromGesture,
} from '../../tactical-board/tactical-board-event-ops.js';
```

3. Add a `.minute-field` style inside the `styles` array (after the `.status.error` rule):

```ts
      .minute-field {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        margin: 0 0 12px;
      }
      .minute-field input {
        width: 5ch;
      }
```

4. In the template, inside `@case ('loaded') {`, BEFORE `@if (loadedBoard(); as board) {`, add the minute control:

```html
        <p class="minute-field">
          <label for="scene5-minute">{{ msg.minute }}</label>
          <input
            id="scene5-minute"
            type="number"
            data-testid="scene5-minute"
            [min]="minuteMin"
            [max]="minuteMax"
            [value]="minute()"
            (input)="onMinuteInput($event)"
          />
        </p>
```

5. In the template, AFTER the `scene5-persist-error` `@if` block (still inside `@case ('loaded')`), add the substitution-error block:

```html
        @if (substitutionError(); as subErr) {
          <p
            class="status error"
            role="status"
            aria-live="polite"
            data-testid="scene5-substitution-error"
          >
            {{ subErr }}
          </p>
        }
```

6. Add `minute` to the `msg` object:

```ts
  protected readonly msg = {
    eyebrow: boardMsg('board.scene5.eyebrow'),
    heading: boardMsg('board.scene5.heading'),
    loading: loadingLabel(boardMsg('board.scene5.loadingLabel')),
    minute: commonMsg('common.term.minute'),
  };
```

7. Add the injected client + new signals/fields (next to the existing `persistError`):

```ts
  private readonly matchDayClient = inject(MatchDayClient);

  protected readonly substitutionError = signal<string | null>(null);
  protected readonly minute = signal(MINUTE_MIN);
  protected readonly minuteMin = MINUTE_MIN;
  protected readonly minuteMax = MINUTE_MAX;
```

8. Add the minute handler (e.g. above `onBoardChange`):

```ts
  onMinuteInput(ev: Event): void {
    const n = (ev.target as HTMLInputElement).valueAsNumber;
    this.minute.set(
      Number.isNaN(n) ? MINUTE_MIN : Math.min(MINUTE_MAX, Math.max(MINUTE_MIN, n)),
    );
  }
```

9. Replace `onBoardChange` with the dual-write version:

```ts
  async onBoardChange(event: {
    gesture: TacticalGesture;
    board: TacticalBoard;
  }): Promise<void> {
    const s = this.state();
    if (s.kind !== 'loaded') return;
    this.persistError.set(null);
    this.substitutionError.set(null);

    const edit = gestureToTreeEdit(s.matchNodeId, event.gesture, event.board, s.treeRootId);
    try {
      await this.client.applyEdit(s.treeRootId, edit);
    } catch (err) {
      this.persistError.set(describeSubstrateClientFailure(err));
    }

    // A substitution is also a match-timeline fact: emit SubstitutionMade.v1 via
    // the match-day endpoint (ADR-161), in addition to the visual metadata-patch.
    if (event.gesture.kind === 'substitute') {
      const req = substitutionRequestFromGesture(
        event.gesture,
        event.board,
        this.teamId,
        this.minute(),
      );
      if (req !== null) {
        try {
          await this.matchDayClient.substitute(s.matchNodeId, req);
        } catch (err) {
          this.substitutionError.set(substitutionFailedLabel(describeMatchDayClientFailure(err)));
        }
      }
    }
  }
```

(Keep the existing `describeSubstituteClientFailure` import — i.e. `describeSubstrateClientFailure` — that's already imported at the top.)

- [ ] **Step 4: Run the page tests to verify they pass**

Run: `npx nx test pack-football-ui -- match-day-scene5-page`
Expected: PASS (the 6 existing + 4 new tests).

- [ ] **Step 5: Build + lint**

Run: `npx nx build pack-football-ui`
Expected: PASS.

Run: `npx nx lint pack-football-ui`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.spec.ts
git commit -m "feat(pack-football-ui): Scene 5 substitute gesture emits SubstitutionMade.v1 + minute control (#129)"
```

---

### Task 6: Final verification, reconciliation follow-up, PR

- [ ] **Step 1: Full local gate**

Run: `npm run ci:local`
Expected: green.

- [ ] **Step 2: Diff sanity**

Run: `git diff --name-status main...HEAD`
Expected: exactly the 11 files in the File Structure table.

- [ ] **Step 3: File the reconciliation follow-up (spec §7)**

```bash
gh issue create --repo de-braighter/exercir \
  --title "Reconcile the two tactical boards (Scene 5 visual editor vs coach matchday board)" \
  --body "Two tactical-board surfaces co-exist: the Scene 5 visual editor (TacticalBoardComponent + MatchDayScene5PageComponent — rich authoring, plan-tree edits, **unrouted**) and the coach matchday board (CoachTacticalBoardComponent + CoachTacticalBoardPageComponent — substitution/formation events + SSE, routed at /coach/board). #129 wired SubstitutionMade.v1 into the Scene 5 board too, knowingly creating a third substitution path. Decide the topology: R1 route the Scene 5 editor as the live FC-MatchDay surface (fold in the coach board's event emission; retire the coach board); R2 keep both with a documented boundary; R3 merge into one configurable surface. See docs/superpowers/specs/2026-06-07-pack-football-scene5-substitution-event-and-contract-promotion-design.md §7."
```

- [ ] **Step 4: Push + open the PR**

```bash
git push -u origin HEAD
```

Then `gh pr create` with `Closes #129`, a summary noting items 2+3 done (item 1 already shipped via #192/#193), the two-board reconciliation follow-up link, the design link, and:

```
Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]
Effect: cycle-time 0.01±0.02 expert
Effect: findings 0±1 expert
```

- [ ] **Step 5: Verifier wave** — `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker`, all `isolation: "worktree"` at the PR head (read-only).

---

## Self-Review (against the spec)

**Spec coverage:** §4 Part A (type promotion) → Tasks 1–2. §4 Part B.1 (helper) → Task 3. §4 Part B.2 (describer extraction) → Task 4. §4 Part B.3 (minute control) → Task 5 steps 3.4/3.6/3.7/3.8. §4 Part B.4 (onBoardChange branch) → Task 5 step 3.9. §4 Part B.5 (failure posture) → Task 5 step 3.5/3.9. §5 testing → Tasks 1/3/4/5 tests. §6 a11y (label-for) → Task 5 step 3.4. §7 reconciliation → Task 6 step 3. §9 acceptance 1→T2, 2→T5, 3→T5, 4→T5, 5→T5, 6→T4, 7→T6. ✅

**Placeholder scan:** no TBD/TODO; every code step has full code; commands carry expected output. ✅

**Type consistency:** `TacticalBoard`/`TacticalSlot`/`BenchSlot`/`PlayAnnotation` defined in Task 1, re-exported in Task 2, consumed by the Task 3 helper + Task 5 tests; `SubstitutionRequest` (existing wire schema) is the helper's return + `MatchDayClient.substitute` param; `substitutionRequestFromGesture(gesture, postBoard, teamId, minute)` signature identical across Task 3 def + Task 5 call; `describeMatchDayClientFailure(err)` identical across Task 4 def + coach-page repoint + Task 5 use; `MINUTE_MIN`/`MINUTE_MAX` from Task 3 used in Task 5; the substitution request fields (`teamId/playerOutId/playerInId/minute`) match `SubstitutionRequestSchema`. ✅
