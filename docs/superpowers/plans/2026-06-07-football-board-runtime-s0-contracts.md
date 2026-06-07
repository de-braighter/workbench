# Board Runtime S0 — Contracts Foundation + Converters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the pure data foundation for the unified football board runtime — a domain-free `BoardGeometry` model, the tactical `TacticalBinding` (the domain side geometry omits), and the pure converters `DrillDiagram⇄BoardGeometry` (near-bijective) and `TacticalBoard⇄{geometry,binding}` (decompose/compose) — all round-trip-tested. **No behaviour change** anywhere; this is types + pure functions in `pack-football-contracts` only.

**Architecture:** Approach B (geometry core + binding overlay) from the epic design. The geometry is permissive + frame-relative (coordinates unbounded; per-kind schemas keep their own bounds). Drill maps near-1:1 (only the single optional zone's synthesized id differs). Tactical is non-bijective by design — `playerId`/`position`/`captain`/`bench` live in `TacticalBinding`, so tactical is **decompose → `{ geometry, binding }`** and **compose `(geometry, binding) → TacticalBoard`**.

**Tech Stack:** TypeScript, Zod 3.25, vitest, Nx 22. All in `domains/exercir/libs/pack-football-contracts` (pure, no Angular/NestJS). Run from `D:/development/projects/de-braighter/domains/exercir`.

**Source spec:** `docs/superpowers/specs/2026-06-07-football-board-runtime-design.md` (§4 model, §6 binding, §11 S0).

**Scope refinement vs the epic doc:** the epic's S0 line lumped in the `BoardKind` descriptor + persistence/binding *port interfaces*. Those are behavioural ports best defined with their first implementer (S1 engine / S3 binding / S4 persistence), so S0 is tightened to the **data contracts + converters** only (YAGNI; demand-driven). The port/descriptor interfaces land in S1/S3/S4.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `libs/pack-football-contracts/src/lib/board-geometry.schemas.ts` | Create | The pure geometry model: `BoardFrame`, `BoardMarker`, `BoardGeometryPoint`, `BoardArrow`, `BoardZone`, `BoardGeometry` (Zod + types) |
| `libs/pack-football-contracts/src/lib/board-geometry.spec.ts` | Create | Geometry schema validation tests |
| `libs/pack-football-contracts/src/lib/drill-geometry.converters.ts` | Create | `drillDiagramToBoardGeometry` + `boardGeometryToDrillDiagram` |
| `libs/pack-football-contracts/src/lib/drill-geometry.converters.spec.ts` | Create | Drill field-mapping + round-trip tests |
| `libs/pack-football-contracts/src/lib/tactical-binding.schemas.ts` | Create | `TacticalBindingSlot`, `TacticalBinding` (the domain side) (Zod + types) |
| `libs/pack-football-contracts/src/lib/tactical-geometry.converters.ts` | Create | `TACTICAL_SLOT_MARKER_KIND`, `TacticalDecomposition`, `tacticalBoardToBoardGeometry` (decompose) + `boardGeometryToTacticalBoard` (compose) |
| `libs/pack-football-contracts/src/lib/tactical-geometry.converters.spec.ts` | Create | Tactical decompose/compose + round-trip tests |
| `libs/pack-football-contracts/src/index.ts` | Modify | Barrel-export the new schemas/types/converters |

ESM `.js` import specifiers throughout. Naming note: the geometry point is `BoardGeometryPoint` to avoid colliding with the existing `BoardPoint` (tactical-board.schemas).

## Reference patterns

- **Existing wire shapes the converters bridge** (read these first): `libs/pack-football-contracts/src/lib/drill-diagram.schemas.ts` (`DrillDiagram` = `{ sceneKind, schemaVersion, dots[{id,kind,x,y,label?,metadata?}], arrows[{id,kind,x1,y1,x2,y2}], zone?{x,y,w,h} }`) and `libs/pack-football-contracts/src/lib/tactical-board.schemas.ts` (`TacticalBoard` = `{ sceneKind, schemaVersion, lineup[TacticalSlot{slotId,playerId|null,position,x,y}], bench[BenchSlot{benchId,playerId,position?}], captainSlotId|null, plays[PlayAnnotation] }`; `PlayAnnotation` = `{playId, kind:'run-arrow'|'pass-arrow', points[≥2]} | {playId, kind:'zone-highlight', x,y,w,h}`).
- **Zod + `z.infer` + `.readonly()` arrays + barrel-export style**: the `drill-diagram.schemas.ts` / `tactical-board.schemas.ts` precedent + the `export { … } from './x.schemas.js'` blocks in `index.ts`.
- **Test style**: `libs/pack-football-contracts/src/lib/contracts.spec.ts` (vitest `describe`/`it`, `Schema.parse`/`safeParse`).

---

### Task 1: The `BoardGeometry` model

**Files:** Create `board-geometry.schemas.ts` + `board-geometry.spec.ts`; Modify `index.ts`.

- [ ] **Step 1: Write the failing test** — `libs/pack-football-contracts/src/lib/board-geometry.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  BoardGeometrySchema,
  BoardMarkerSchema,
  BoardArrowSchema,
  BoardZoneSchema,
  BoardFrameSchema,
} from './board-geometry.schemas.js';

describe('board-geometry schemas', () => {
  const geometry = {
    frame: { width: 100, height: 120 },
    markers: [{ id: 'm1', x: 50, y: 60, kind: 'tactical.slot' }],
    arrows: [{ id: 'a1', kind: 'pass', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] }],
    zones: [{ id: 'z1', x: 0, y: 0, w: 10, h: 10 }],
  };

  it('accepts a well-formed geometry', () => {
    expect(BoardGeometrySchema.parse(geometry)).toEqual(geometry);
  });

  it('accepts a marker with an optional label + metadata', () => {
    expect(
      BoardMarkerSchema.safeParse({
        id: 'm2', x: 1, y: 2, kind: 'drill.player', label: '7', metadata: { foo: 'bar' },
      }).success,
    ).toBe(true);
  });

  it('requires an arrow to carry at least 2 points', () => {
    expect(
      BoardArrowSchema.safeParse({ id: 'a', kind: 'run', points: [{ x: 1, y: 2 }] }).success,
    ).toBe(false);
  });

  it('requires a positive frame', () => {
    expect(BoardFrameSchema.safeParse({ width: 0, height: 60 }).success).toBe(false);
  });

  it('rejects geometry missing an array (markers)', () => {
    const { markers: _omit, ...noMarkers } = geometry;
    expect(BoardGeometrySchema.safeParse(noMarkers).success).toBe(false);
  });

  it('treats zone w/h as free numbers (frame-relative, per-kind bounds enforced elsewhere)', () => {
    expect(BoardZoneSchema.safeParse({ id: 'z', x: -5, y: 0, w: 200, h: 1 }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx nx test pack-football-contracts` → FAIL ("Cannot find module './board-geometry.schemas.js'").

- [ ] **Step 3: Create `board-geometry.schemas.ts`** with EXACTLY:

```ts
/**
 * Board geometry — the domain-free core model for the unified football board
 * runtime (epic design §4, Approach B). Markers / arrows / zones in a DECLARED
 * frame; the engine + renderer are frame-agnostic. Coordinates are permissive
 * (frame-relative `z.number()`); per-kind wire schemas (drill 0..100/0..60,
 * tactical) keep their own bounds. `kind` is a palette-scoped string token (a
 * later ratchet replaces it with literal unions per north-star §20 P5). No
 * domain (squad/formation/captain) lives here — that is the binding overlay.
 */

import { z } from 'zod';

/** Pitch frame the geometry coordinates live in (drill 100×60, tactical 100×120). */
export const BoardFrameSchema = z.object({
  width: z.number().positive(),
  height: z.number().positive(),
});
export type BoardFrame = z.infer<typeof BoardFrameSchema>;

/** A positioned marker (a drill dot or a tactical lineup slot's position). */
export const BoardMarkerSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  kind: z.string().min(1),
  label: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type BoardMarker = z.infer<typeof BoardMarkerSchema>;

/** A point in the frame. */
export const BoardGeometryPointSchema = z.object({ x: z.number(), y: z.number() });
export type BoardGeometryPoint = z.infer<typeof BoardGeometryPointSchema>;

/** A directed polyline (drill arrow = 2 points; tactical play = polyline). */
export const BoardArrowSchema = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  points: z.array(BoardGeometryPointSchema).min(2).readonly(),
});
export type BoardArrow = z.infer<typeof BoardArrowSchema>;

/** A highlight rectangle (drill zone; tactical zone-highlight play). */
export const BoardZoneSchema = z.object({
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type BoardZone = z.infer<typeof BoardZoneSchema>;

/** The full geometry of a board (any kind). */
export const BoardGeometrySchema = z.object({
  frame: BoardFrameSchema,
  markers: z.array(BoardMarkerSchema).readonly(),
  arrows: z.array(BoardArrowSchema).readonly(),
  zones: z.array(BoardZoneSchema).readonly(),
});
export type BoardGeometry = z.infer<typeof BoardGeometrySchema>;
```

- [ ] **Step 4: Run to verify it passes** — `npx nx test pack-football-contracts` → PASS (existing + the 6 new geometry cases).

- [ ] **Step 5: Export from the barrel** — append to `libs/pack-football-contracts/src/index.ts`:

```ts
export {
  BoardFrameSchema,
  BoardMarkerSchema,
  BoardGeometryPointSchema,
  BoardArrowSchema,
  BoardZoneSchema,
  BoardGeometrySchema,
  type BoardFrame,
  type BoardMarker,
  type BoardGeometryPoint,
  type BoardArrow,
  type BoardZone,
  type BoardGeometry,
} from './lib/board-geometry.schemas.js';
```

- [ ] **Step 6: Build + commit** — `npx nx build pack-football-contracts` → PASS.

```bash
git add libs/pack-football-contracts/src/lib/board-geometry.schemas.ts libs/pack-football-contracts/src/lib/board-geometry.spec.ts libs/pack-football-contracts/src/index.ts
git commit -m "feat(pack-football-contracts): BoardGeometry model (board runtime S0)"
```

---

### Task 2: Drill ⇄ geometry converters

**Files:** Create `drill-geometry.converters.ts` + `drill-geometry.converters.spec.ts`; Modify `index.ts`.

**Context:** Drill is near-bijective. Forward: dots→markers (kind/label/metadata verbatim), arrows→2-point geometry arrows, optional single `zone`→`zones[0]` with a SYNTHESIZED stable id `'drill-zone'`. Back: markers→dots, geometry arrows→`x1,y1`(first point)/`x2,y2`(last point), `zones[0]`→`zone` (id dropped). Canonical round-trip proven: `DrillDiagram → geometry → DrillDiagram` is identity.

- [ ] **Step 1: Write the failing test** — `libs/pack-football-contracts/src/lib/drill-geometry.converters.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { DrillDiagram } from './drill-diagram.schemas.js';
import {
  drillDiagramToBoardGeometry,
  boardGeometryToDrillDiagram,
} from './drill-geometry.converters.js';

function sampleDrill(): DrillDiagram {
  return {
    sceneKind: 'pack-football.drill-diagram.v1',
    schemaVersion: 'pack-football.drill-diagram.v1',
    dots: [
      { id: 'd1', kind: 'pack-football.drill-diagram.player', x: 10, y: 20, label: '7' },
      { id: 'd2', kind: 'pack-football.drill-diagram.cone', x: 30, y: 40 },
    ],
    arrows: [
      { id: 'a1', kind: 'pack-football.drill-diagram.arrow.pass', x1: 1, y1: 2, x2: 3, y2: 4 },
    ],
    zone: { x: 5, y: 6, w: 7, h: 8 },
  };
}

describe('drill ⇄ geometry converters', () => {
  it('maps dots/arrows/zone into the 100×60 geometry', () => {
    const g = drillDiagramToBoardGeometry(sampleDrill());
    expect(g.frame).toEqual({ width: 100, height: 60 });
    expect(g.markers).toEqual([
      { id: 'd1', x: 10, y: 20, kind: 'pack-football.drill-diagram.player', label: '7' },
      { id: 'd2', x: 30, y: 40, kind: 'pack-football.drill-diagram.cone' },
    ]);
    expect(g.arrows).toEqual([
      { id: 'a1', kind: 'pack-football.drill-diagram.arrow.pass', points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
    ]);
    expect(g.zones).toEqual([{ id: 'drill-zone', x: 5, y: 6, w: 7, h: 8 }]);
  });

  it('emits no zone when the drill has none', () => {
    const { zone: _omit, ...noZone } = sampleDrill();
    expect(drillDiagramToBoardGeometry(noZone).zones).toEqual([]);
  });

  it('round-trips DrillDiagram → geometry → DrillDiagram (identity)', () => {
    const d = sampleDrill();
    expect(boardGeometryToDrillDiagram(drillDiagramToBoardGeometry(d))).toEqual(d);
  });

  it('preserves dot metadata across the round-trip', () => {
    const d = sampleDrill();
    d.dots[0].metadata = { note: 'x' };
    expect(boardGeometryToDrillDiagram(drillDiagramToBoardGeometry(d))).toEqual(d);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx nx test pack-football-contracts` → FAIL ("Cannot find module './drill-geometry.converters.js'").

- [ ] **Step 3: Create `drill-geometry.converters.ts`** with EXACTLY:

```ts
/**
 * Pure converters between the drill wire shape (`DrillDiagram`) and the unified
 * `BoardGeometry` (board runtime S0). Drill is near-bijective: the only
 * non-identity is the single optional `zone`, which gains a synthesized stable
 * id on the way out and drops it on the way back. The canonical round-trip
 * `DrillDiagram → geometry → DrillDiagram` is the identity.
 */

import type { BoardGeometry, BoardMarker } from './board-geometry.schemas.js';
import type { DrillDiagram, DrillDiagramDot, DrillDiagramArrow } from './drill-diagram.schemas.js';

const DRILL_FRAME = { width: 100, height: 60 } as const;
/** Synthesized id for the drill's single optional zone (dropped on convert-back). */
export const DRILL_ZONE_ID = 'drill-zone' as const;

export function drillDiagramToBoardGeometry(d: DrillDiagram): BoardGeometry {
  return {
    frame: { width: DRILL_FRAME.width, height: DRILL_FRAME.height },
    markers: d.dots.map((dot) => {
      const m: BoardMarker = { id: dot.id, x: dot.x, y: dot.y, kind: dot.kind };
      if (dot.label !== undefined) m.label = dot.label;
      if (dot.metadata !== undefined) m.metadata = dot.metadata;
      return m;
    }),
    arrows: d.arrows.map((a) => ({
      id: a.id,
      kind: a.kind,
      points: [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }],
    })),
    zones:
      d.zone === undefined
        ? []
        : [{ id: DRILL_ZONE_ID, x: d.zone.x, y: d.zone.y, w: d.zone.w, h: d.zone.h }],
  };
}

export function boardGeometryToDrillDiagram(g: BoardGeometry): DrillDiagram {
  const dots: DrillDiagramDot[] = g.markers.map((m) => {
    const dot: DrillDiagramDot = { id: m.id, kind: m.kind, x: m.x, y: m.y };
    if (m.label !== undefined) dot.label = m.label;
    if (m.metadata !== undefined) dot.metadata = m.metadata;
    return dot;
  });
  const arrows: DrillDiagramArrow[] = g.arrows.flatMap((a) => {
    const first = a.points[0];
    const last = a.points[a.points.length - 1];
    if (first === undefined || last === undefined) return [];
    return [{ id: a.id, kind: a.kind, x1: first.x, y1: first.y, x2: last.x, y2: last.y }];
  });
  const diagram: DrillDiagram = {
    sceneKind: 'pack-football.drill-diagram.v1',
    schemaVersion: 'pack-football.drill-diagram.v1',
    dots,
    arrows,
  };
  const zone = g.zones[0];
  if (zone !== undefined) {
    diagram.zone = { x: zone.x, y: zone.y, w: zone.w, h: zone.h };
  }
  return diagram;
}
```

- [ ] **Step 4: Run to verify it passes** — `npx nx test pack-football-contracts` → PASS (the 4 new drill-converter cases).

- [ ] **Step 5: Export from the barrel** — append to `index.ts`:

```ts
export {
  DRILL_ZONE_ID,
  drillDiagramToBoardGeometry,
  boardGeometryToDrillDiagram,
} from './lib/drill-geometry.converters.js';
```

- [ ] **Step 6: Build + commit** — `npx nx build pack-football-contracts` → PASS.

```bash
git add libs/pack-football-contracts/src/lib/drill-geometry.converters.ts libs/pack-football-contracts/src/lib/drill-geometry.converters.spec.ts libs/pack-football-contracts/src/index.ts
git commit -m "feat(pack-football-contracts): DrillDiagram ⇄ BoardGeometry converters (board runtime S0)"
```

---

### Task 3: Tactical binding + decompose/compose converters

**Files:** Create `tactical-binding.schemas.ts`, `tactical-geometry.converters.ts`, `tactical-geometry.converters.spec.ts`; Modify `index.ts`.

**Context:** Tactical is NOT bijective — `BoardGeometry` omits the domain (`playerId`/`position`/`captain`/`bench`), so it travels in `TacticalBinding`. `tacticalBoardToBoardGeometry` DECOMPOSES a `TacticalBoard` into `{ geometry, binding }`; `boardGeometryToTacticalBoard(geometry, binding)` COMPOSES them back. Lineup slots → `tactical.slot` markers (positions only) + binding entries (playerId/position); bench + captain → binding; plays → arrows (run/pass, kind verbatim) + zones (zone-highlight). **Play order is normalized to arrows-then-zones on compose** (z-order across the arrow/zone boundary is not modelled; a S3+ rendering concern) — so round-trip equality is asserted with plays compared order-insensitively, while lineup/bench/captain are exact.

- [ ] **Step 1: Create the binding schema** `libs/pack-football-contracts/src/lib/tactical-binding.schemas.ts`:

```ts
/**
 * Tactical binding — the domain side of a tactical board that the pure
 * `BoardGeometry` deliberately omits (board runtime S0, Approach B). Carries
 * per-slot roster identity + position, the bench, and the captain, keyed to the
 * geometry markers by `markerId` (== the `TacticalSlot.slotId`). Composed back
 * with a `BoardGeometry` to reconstruct a `TacticalBoard` for persistence.
 */

import { z } from 'zod';

import {
  BenchSlotSchema,
  TacticalPositionSchema,
  TACTICAL_BOARD_SCENE_KIND,
  TACTICAL_BOARD_SCHEMA_VERSION,
} from './tactical-board.schemas.js';

/** The domain a single lineup marker carries (keyed to a geometry marker id). */
export const TacticalBindingSlotSchema = z.object({
  markerId: z.string().min(1),
  playerId: z.string().nullable(),
  position: TacticalPositionSchema,
});
export type TacticalBindingSlot = z.infer<typeof TacticalBindingSlotSchema>;

/** The full domain side of a tactical board (everything geometry omits). */
export const TacticalBindingSchema = z.object({
  sceneKind: z.literal(TACTICAL_BOARD_SCENE_KIND),
  schemaVersion: z.literal(TACTICAL_BOARD_SCHEMA_VERSION),
  slots: z.array(TacticalBindingSlotSchema).readonly(),
  bench: z.array(BenchSlotSchema).readonly(),
  captainSlotId: z.string().nullable(),
});
export type TacticalBinding = z.infer<typeof TacticalBindingSchema>;
```

- [ ] **Step 2: Write the failing converter test** `libs/pack-football-contracts/src/lib/tactical-geometry.converters.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { TacticalBoard, PlayAnnotation } from './tactical-board.schemas.js';
import {
  TACTICAL_SLOT_MARKER_KIND,
  tacticalBoardToBoardGeometry,
  boardGeometryToTacticalBoard,
} from './tactical-geometry.converters.js';

function sampleBoard(): TacticalBoard {
  return {
    sceneKind: 'pack-football.tactical-board.v1',
    schemaVersion: 1,
    lineup: [
      { slotId: 's-gk', playerId: 'p1', position: 'GK', x: 50, y: 114 },
      { slotId: 's-cm', playerId: 'p2', position: 'CM', x: 50, y: 60 },
    ],
    bench: [{ benchId: 'b-1', playerId: 'p3', position: 'ST' }],
    captainSlotId: 's-cm',
    plays: [
      { playId: 'pa-1', kind: 'pass-arrow', points: [{ x: 50, y: 60 }, { x: 50, y: 114 }] },
      { playId: 'pa-2', kind: 'zone-highlight', x: 10, y: 10, w: 20, h: 20 },
    ],
  };
}

function sortPlays(plays: readonly PlayAnnotation[]): PlayAnnotation[] {
  return [...plays].sort((a, b) => a.playId.localeCompare(b.playId));
}

describe('tactical decompose/compose converters', () => {
  it('decomposes lineup positions into tactical.slot markers (no domain in geometry)', () => {
    const { geometry } = tacticalBoardToBoardGeometry(sampleBoard());
    expect(geometry.frame).toEqual({ width: 100, height: 120 });
    expect(geometry.markers).toEqual([
      { id: 's-gk', x: 50, y: 114, kind: TACTICAL_SLOT_MARKER_KIND },
      { id: 's-cm', x: 50, y: 60, kind: TACTICAL_SLOT_MARKER_KIND },
    ]);
  });

  it('decomposes plays into arrows (run/pass) + zones (zone-highlight)', () => {
    const { geometry } = tacticalBoardToBoardGeometry(sampleBoard());
    expect(geometry.arrows).toEqual([
      { id: 'pa-1', kind: 'pass-arrow', points: [{ x: 50, y: 60 }, { x: 50, y: 114 }] },
    ]);
    expect(geometry.zones).toEqual([{ id: 'pa-2', x: 10, y: 10, w: 20, h: 20 }]);
  });

  it('decomposes domain (playerId/position/bench/captain) into the binding', () => {
    const { binding } = tacticalBoardToBoardGeometry(sampleBoard());
    expect(binding.slots).toEqual([
      { markerId: 's-gk', playerId: 'p1', position: 'GK' },
      { markerId: 's-cm', playerId: 'p2', position: 'CM' },
    ]);
    expect(binding.bench).toEqual([{ benchId: 'b-1', playerId: 'p3', position: 'ST' }]);
    expect(binding.captainSlotId).toBe('s-cm');
  });

  it('round-trips TacticalBoard → {geometry,binding} → TacticalBoard (lineup/bench/captain exact, plays order-insensitive)', () => {
    const b = sampleBoard();
    const { geometry, binding } = tacticalBoardToBoardGeometry(b);
    const back = boardGeometryToTacticalBoard(geometry, binding);
    expect(back.lineup).toEqual(b.lineup);
    expect(back.bench).toEqual(b.bench);
    expect(back.captainSlotId).toBe(b.captainSlotId);
    expect(back.sceneKind).toBe(b.sceneKind);
    expect(back.schemaVersion).toBe(b.schemaVersion);
    expect(sortPlays(back.plays)).toEqual(sortPlays(b.plays));
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx nx test pack-football-contracts` → FAIL ("Cannot find module './tactical-geometry.converters.js'").

- [ ] **Step 4: Create `tactical-geometry.converters.ts`** with EXACTLY:

```ts
/**
 * Pure converters between the tactical wire shape (`TacticalBoard`) and the
 * unified `BoardGeometry` + its `TacticalBinding` (board runtime S0, Approach
 * B). Tactical is NOT bijective: geometry omits the domain, so it travels in
 * the binding. `tacticalBoardToBoardGeometry` DECOMPOSES → `{ geometry, binding }`;
 * `boardGeometryToTacticalBoard` COMPOSES them back. Plays normalize to
 * arrows-then-zones on compose (cross-boundary z-order is not modelled).
 */

import type {
  BoardArrow,
  BoardGeometry,
  BoardMarker,
  BoardZone,
} from './board-geometry.schemas.js';
import type { TacticalBinding, TacticalBindingSlot } from './tactical-binding.schemas.js';
import {
  TACTICAL_BOARD_SCENE_KIND,
  TACTICAL_BOARD_SCHEMA_VERSION,
  type PlayAnnotation,
  type TacticalBoard,
  type TacticalPosition,
  type TacticalSlot,
} from './tactical-board.schemas.js';

/** The `kind` token every tactical lineup-slot marker carries in geometry. */
export const TACTICAL_SLOT_MARKER_KIND = 'pack-football.tactical-board.slot' as const;

/** The pure-geometry + domain split a tactical board decomposes into. */
export interface TacticalDecomposition {
  geometry: BoardGeometry;
  binding: TacticalBinding;
}

export function tacticalBoardToBoardGeometry(b: TacticalBoard): TacticalDecomposition {
  const markers: BoardMarker[] = b.lineup.map((s) => ({
    id: s.slotId,
    x: s.x,
    y: s.y,
    kind: TACTICAL_SLOT_MARKER_KIND,
  }));
  const arrows: BoardArrow[] = [];
  const zones: BoardZone[] = [];
  for (const p of b.plays) {
    if (p.kind === 'zone-highlight') {
      zones.push({ id: p.playId, x: p.x, y: p.y, w: p.w, h: p.h });
    } else {
      arrows.push({ id: p.playId, kind: p.kind, points: p.points.map((pt) => ({ x: pt.x, y: pt.y })) });
    }
  }
  const geometry: BoardGeometry = {
    frame: { width: 100, height: 120 },
    markers,
    arrows,
    zones,
  };
  const binding: TacticalBinding = {
    sceneKind: TACTICAL_BOARD_SCENE_KIND,
    schemaVersion: TACTICAL_BOARD_SCHEMA_VERSION,
    slots: b.lineup.map(
      (s): TacticalBindingSlot => ({ markerId: s.slotId, playerId: s.playerId, position: s.position }),
    ),
    bench: b.bench.map((x) => ({ ...x })),
    captainSlotId: b.captainSlotId,
  };
  return { geometry, binding };
}

export function boardGeometryToTacticalBoard(
  geometry: BoardGeometry,
  binding: TacticalBinding,
): TacticalBoard {
  const domainByMarker = new Map<string, TacticalBindingSlot>(
    binding.slots.map((s) => [s.markerId, s]),
  );
  const lineup: TacticalSlot[] = geometry.markers
    .filter((m) => m.kind === TACTICAL_SLOT_MARKER_KIND)
    .map((m): TacticalSlot => {
      const domain = domainByMarker.get(m.id);
      // The binding always covers lineup markers; the fallbacks below are an
      // unreachable defensive default for a malformed geometry/binding pair.
      const position: TacticalPosition = domain ? domain.position : 'CM';
      return {
        slotId: m.id,
        playerId: domain ? domain.playerId : null,
        position,
        x: m.x,
        y: m.y,
      };
    });
  const arrowPlays: PlayAnnotation[] = geometry.arrows.map((a) => ({
    playId: a.id,
    kind: a.kind === 'run-arrow' ? 'run-arrow' : 'pass-arrow',
    points: a.points.map((pt) => ({ x: pt.x, y: pt.y })),
  }));
  const zonePlays: PlayAnnotation[] = geometry.zones.map((z) => ({
    playId: z.id,
    kind: 'zone-highlight',
    x: z.x,
    y: z.y,
    w: z.w,
    h: z.h,
  }));
  return {
    sceneKind: TACTICAL_BOARD_SCENE_KIND,
    schemaVersion: TACTICAL_BOARD_SCHEMA_VERSION,
    lineup,
    bench: binding.bench.map((x) => ({ ...x })),
    captainSlotId: binding.captainSlotId,
    plays: [...arrowPlays, ...zonePlays],
  };
}
```

- [ ] **Step 5: Run to verify it passes** — `npx nx test pack-football-contracts` → PASS (the 4 new tactical cases). `npx nx build pack-football-contracts` → PASS.

- [ ] **Step 6: Export from the barrel** — append to `index.ts`:

```ts
export {
  TacticalBindingSlotSchema,
  TacticalBindingSchema,
  type TacticalBindingSlot,
  type TacticalBinding,
} from './lib/tactical-binding.schemas.js';
export {
  TACTICAL_SLOT_MARKER_KIND,
  tacticalBoardToBoardGeometry,
  boardGeometryToTacticalBoard,
  type TacticalDecomposition,
} from './lib/tactical-geometry.converters.js';
```

- [ ] **Step 7: Commit**

```bash
git add libs/pack-football-contracts/src/lib/tactical-binding.schemas.ts libs/pack-football-contracts/src/lib/tactical-geometry.converters.ts libs/pack-football-contracts/src/lib/tactical-geometry.converters.spec.ts libs/pack-football-contracts/src/index.ts
git commit -m "feat(pack-football-contracts): TacticalBoard ⇄ geometry+binding converters (board runtime S0)"
```

---

### Task 4: Slice verification + PR

- [ ] **Step 1: Full gate** — `npx nx test pack-football-contracts` → PASS; `npx nx lint pack-football-contracts` → 0 errors (no new warnings on the new files — esp. no `no-non-null-assertion`); `npx nx build pack-football-contracts` → PASS.
- [ ] **Step 2: Consumer sanity** — `npx nx build pack-football-ui` → PASS (the contracts barrel grew; confirm nothing downstream broke). (The barrel is additive, so this should be clean.)
- [ ] **Step 3: Diff sanity** — `git diff --name-status main...HEAD` → exactly the 8 files in the File Structure table.
- [ ] **Step 4: Push + PR** — `git push -u origin HEAD`; `gh pr create` with a summary (S0 of the board-runtime epic; pure data + converters; no behaviour change; round-trip-proven), a `Tech design:` link to both the epic concept doc and this plan, `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`, `Effect: cycle-time 0.01±0.02 expert`, `Effect: findings 0±1 expert`.
- [ ] **Step 5: Verifier wave** — `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker` (read-only, worktree isolation) at the PR head.

---

## Self-Review (against the spec)

**Spec coverage:** §4 `BoardGeometry` model (frame/marker/arrow/zone, declared frame, permissive coords, palette-token `kind`, plural zones, polyline arrows, marker label+metadata) → Task 1. §6 binding (domain side: per-slot playerId/position, bench, captain) → Task 3 (`TacticalBinding`). §11 S0 converters: `DrillDiagram⇄BoardGeometry` (near-bijective) → Task 2; `TacticalBoard⇄{geometry,binding}` (decompose/compose) → Task 3. The S0-scope-refinement (ports deferred) is stated in the header. ✅

**Placeholder scan:** no TBD/TODO; every step has full code + exact commands + expected output. ✅

**Type consistency:** `BoardGeometry`/`BoardMarker`/`BoardArrow`/`BoardZone`/`BoardFrame`/`BoardGeometryPoint` defined in Task 1, consumed by both converter modules (Tasks 2/3); `TacticalBinding`/`TacticalBindingSlot` defined in Task 3 §schema, consumed by the Task 3 converters; `TACTICAL_SLOT_MARKER_KIND` + `TacticalDecomposition` defined + exported in Task 3; converters reuse `DrillDiagram*` (Task 2) and `TacticalBoard`/`PlayAnnotation`/`TacticalSlot`/`TacticalPosition`/`BenchSlot` (existing). Drill round-trip is identity; tactical round-trip is lineup/bench/captain-exact + plays-order-insensitive (documented). The geometry `BoardGeometryPoint` name avoids the existing `BoardPoint` collision. ✅
