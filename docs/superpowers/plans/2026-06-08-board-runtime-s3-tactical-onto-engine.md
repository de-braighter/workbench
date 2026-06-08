# Board Runtime S3 — Tactical Editor onto the Generic Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Scene-5 `TacticalBoardComponent` off its bespoke `TacticalBoardStore` + `tactical-board-ops` onto the shared `BoardEditorStore` + `board-ops` + the S0 `TacticalBinding`/converters — behaviour byte-preserved — so the engine carries a second real consumer.

**Architecture:** The engine store gains an optional `aux` snapshot so undo covers the tactical binding (drill passes none → byte-identical). A new pure `tactical-binding-ops.ts` re-expresses each gesture as a `(geometry, binding) → (geometry, binding)` transform — geometry via `board-ops`, binding by direct immutable update — and is proven equivalent to the existing `tactical-board-ops` by round-tripping through the S0 converters. The component composes a `board()` computed at the boundary (the S1.2 trick) so its template + specs migrate 1:1.

**Tech Stack:** TypeScript, Angular 21 (standalone, signals, zoneless, OnPush), Vitest, Nx 22, `@de-braighter/pack-football-contracts` (workspace-local).

**Repo:** `domains/exercir` (run all `nx`/`npm` from there). Branch off `main`: `git checkout -b feat/board-runtime-s3-tactical-onto-engine main`.

**Conventions:** ESM imports with explicit `.js`. Verify with `npx nx build <project>` + targeted `npx nx test pack-football-ui --include="**/<spec>"` (the full UI suite can OOM under coverage×pool — targeted runs are fine; a real FAILURE ≠ an OOM). Do NOT use `preview_*` tools. TDD: failing test → run → implement → run → commit. One commit per task.

**Key shapes already in the codebase (do not redefine):**
- `BoardGeometry = { frame: {width,height}; markers: {id,x,y,kind,label?,metadata?}[]; arrows: {id,kind,points:{x,y}[]}[]; zones: {id,x,y,w,h}[] }` (`@de-braighter/pack-football-contracts`).
- `TacticalBinding = { sceneKind, schemaVersion, slots: {markerId,playerId,position}[], bench: BenchSlot[], captainSlotId: string|null }`.
- `TacticalDecomposition = { geometry: BoardGeometry; binding: TacticalBinding }` (exported from contracts).
- Converters (contracts): `tacticalBoardToBoardGeometry(board): TacticalDecomposition`, `boardGeometryToTacticalBoard(geometry, binding): TacticalBoard`. Slot `slotId` ⟷ marker `id` (kind `TACTICAL_SLOT_MARKER_KIND`); play `playId` ⟷ arrow/zone `id`.
- `board-ops` (`libs/pack-football-ui/src/lib/board-engine/board-ops.ts`): `moveMarker(g,id,x,y)`, `removeArrow(g,id)`, `removeZone(g,id)`, `addMarker`, `addArrow(g,kind,x1,y1,x2,y2,prefix)` (2-point, prefix-minted — NOT used for tactical polyline plays), `addZone(g,id,x,y,w,h)`, `emptyBoardGeometry(frame)`. All clamp from `g.frame`.
- Existing tactical ops (`libs/pack-football-ui/src/lib/tactical-board/tactical-board-ops.ts`): `swapSlots`, `substitute`, `setCaptain`, `moveSlot`, `addPlay`, `clearPlays`, `nextPlayId`, `EMPTY_BOARD`, `boardFromLineup`, `snapshotFormation`.

---

## Task 1: Extend `BoardEditorStore` with an optional `aux` snapshot (engine; drill-safe)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/board-engine/board-editor.store.ts`
- Test: `libs/pack-football-ui/src/lib/board-engine/board-editor.store.spec.ts` (append)

- [ ] **Step 1: Write the failing tests** — append to `board-editor.store.spec.ts`:

```typescript
describe('BoardEditorStore aux (sidecar) snapshots', () => {
  it('begin seeds aux and apply/undo/redo carry the (geometry, aux) pair', () => {
    const s = new BoardEditorStore<{ tag: string }>();
    s.begin(board(), { tag: 'a' });
    expect(s.workingAux()).toEqual({ tag: 'a' });

    s.apply(addMarker(s.workingGeometry(), 'k', 1, 1, 'd'), { tag: 'b' });
    expect(s.workingGeometry().markers).toHaveLength(1);
    expect(s.workingAux()).toEqual({ tag: 'b' });

    s.undo();
    expect(s.workingGeometry().markers).toHaveLength(0);
    expect(s.workingAux()).toEqual({ tag: 'a' });

    s.redo();
    expect(s.workingAux()).toEqual({ tag: 'b' });
  });

  it('transient commit/cancel restore aux too', () => {
    const s = new BoardEditorStore<{ tag: string }>();
    s.begin(board(), { tag: 'base' });
    s.beginTransient();
    s.updateTransient(addMarker(s.workingGeometry(), 'k', 1, 1, 'd'), { tag: 'mid' });
    s.cancelTransient();
    expect(s.workingGeometry().markers).toHaveLength(0);
    expect(s.workingAux()).toEqual({ tag: 'base' });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`workingAux` / 2-arg `begin` don't exist)

Run: `npx nx test pack-football-ui --include="**/board-editor.store.spec.ts"`
Expected: FAIL — `workingAux` is not a function / `begin` arity.

- [ ] **Step 3: Implement.** Rewrite `board-editor.store.ts` to be generic over an optional aux, snapshotting the pair. The existing no-aux call-sites (drill) stay byte-identical because `aux` defaults to `undefined`:

```typescript
import { computed, signal } from '@angular/core';

import type { BoardGeometry } from '@de-braighter/pack-football-contracts';
import { emptyBoardGeometry } from './board-ops.js';
import type { BoardSelection, BoardTool } from './board-editor.types.js';

interface Snapshot<TAux> {
  geometry: BoardGeometry;
  aux: TAux | undefined;
}

export class BoardEditorStore<TAux = undefined> {
  readonly workingGeometry = signal<BoardGeometry>(
    emptyBoardGeometry({ width: 100, height: 120 }),
  );
  readonly workingAux = signal<TAux | undefined>(undefined);
  readonly selection = signal<BoardSelection>({ kind: 'none' });
  readonly tool = signal<BoardTool>('select');

  private readonly undoDepth = signal(0);
  private readonly redoDepth = signal(0);
  readonly canUndo = computed(() => this.undoDepth() > 0);
  readonly canRedo = computed(() => this.redoDepth() > 0);

  private undoStack: Snapshot<TAux>[] = [];
  private redoStack: Snapshot<TAux>[] = [];
  private transientBase: Snapshot<TAux> | null = null;

  private snapshot(): Snapshot<TAux> {
    return { geometry: this.workingGeometry(), aux: this.workingAux() };
  }

  begin(initial: BoardGeometry, aux?: TAux): void {
    this.workingGeometry.set(initial);
    this.workingAux.set(aux);
    this.selection.set({ kind: 'none' });
    this.tool.set('select');
    this.undoStack = [];
    this.redoStack = [];
    this.transientBase = null;
    this.undoDepth.set(0);
    this.redoDepth.set(0);
  }

  setTool(t: BoardTool): void {
    this.tool.set(t);
  }

  select(s: BoardSelection): void {
    this.selection.set(s);
  }

  apply(next: BoardGeometry, aux?: TAux): void {
    this.undoStack.push(this.snapshot());
    this.redoStack = [];
    this.workingGeometry.set(next);
    if (aux !== undefined) this.workingAux.set(aux);
    this.syncDepths();
  }

  beginTransient(): void {
    if (this.transientBase !== null) return;
    this.transientBase = this.snapshot();
  }

  updateTransient(next: BoardGeometry, aux?: TAux): void {
    this.workingGeometry.set(next);
    if (aux !== undefined) this.workingAux.set(aux);
  }

  commitTransient(): void {
    if (this.transientBase === null) return;
    this.undoStack.push(this.transientBase);
    this.redoStack = [];
    this.transientBase = null;
    this.syncDepths();
  }

  cancelTransient(): void {
    if (this.transientBase === null) return;
    this.workingGeometry.set(this.transientBase.geometry);
    this.workingAux.set(this.transientBase.aux);
    this.transientBase = null;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.snapshot());
    this.workingGeometry.set(prev.geometry);
    this.workingAux.set(prev.aux);
    this.syncDepths();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.snapshot());
    this.workingGeometry.set(next.geometry);
    this.workingAux.set(next.aux);
    this.syncDepths();
  }

  private syncDepths(): void {
    this.undoDepth.set(this.undoStack.length);
    this.redoDepth.set(this.redoStack.length);
  }
}
```

> Note: `apply`/`updateTransient` only overwrite `workingAux` when `aux !== undefined`, so drill's `apply(geometry)` (no aux) leaves `workingAux` untouched at `undefined` — byte-identical. Tactical always passes the binding.

- [ ] **Step 4: Run — expect PASS** (new aux tests + the existing 8 store tests)

Run: `npx nx test pack-football-ui --include="**/board-editor.store.spec.ts"`
Expected: PASS, all.

- [ ] **Step 5: Build to prove drill (the other consumer) still type-checks**

Run: `npx nx build pack-football-ui`
Expected: builds (drill's `new BoardEditorStore()` resolves to `BoardEditorStore<undefined>`).

- [ ] **Step 6: Run the drill editor specs (drill must be byte-green)**

Run: `npx nx test pack-football-ui --include="**/drill-board-editor.component.spec.ts"`
Expected: PASS (unchanged).

- [ ] **Step 7: Commit**

```bash
git add libs/pack-football-ui/src/lib/board-engine/board-editor.store.ts libs/pack-football-ui/src/lib/board-engine/board-editor.store.spec.ts
git commit -m "feat(pack-football-ui): board engine store carries an optional aux snapshot (S3.1)"
```

---

## Task 2: Tactical-frame `board-ops` clamp test (locks 100×120 frame-agnosticism)

**Files:**
- Test: `libs/pack-football-ui/src/lib/board-engine/board-ops.spec.ts` (append; create if absent following the store-spec style)

- [ ] **Step 1: Write the test** (board-ops is already frame-agnostic — this locks the tactical frame):

```typescript
import { describe, expect, it } from 'vitest';
import { emptyBoardGeometry, moveMarker, addMarker } from './board-ops.js';

describe('board-ops on the tactical 100×120 frame', () => {
  it('clamps a moved marker to the tactical frame, not the drill frame', () => {
    const g = addMarker(emptyBoardGeometry({ width: 100, height: 120 }), 'k', 50, 50, 's');
    const moved = moveMarker(g, 's1', 200, 200);
    expect(moved.markers[0]).toMatchObject({ x: 100, y: 120 }); // clamped to 100×120, not 100×60
  });
});
```

- [ ] **Step 2: Run — expect PASS** (board-ops already clamps from `g.frame`)

Run: `npx nx test pack-football-ui --include="**/board-ops.spec.ts"`
Expected: PASS. (If the file didn't exist, this is its first test; confirm it runs.)

- [ ] **Step 3: Commit**

```bash
git add libs/pack-football-ui/src/lib/board-engine/board-ops.spec.ts
git commit -m "test(pack-football-ui): lock board-ops clamp on the tactical 100x120 frame (S3.1)"
```

---

## Task 3: Pure `tactical-binding-ops.ts` (gesture → `{geometry,binding}` transforms)

**Files:**
- Create: `libs/pack-football-ui/src/lib/tactical-board/tactical-binding-ops.ts`
- Test: `libs/pack-football-ui/src/lib/tactical-board/tactical-binding-ops.spec.ts`

- [ ] **Step 1: Write the failing test** — equivalence to the proven `tactical-board-ops`, verified through the S0 converters. Create `tactical-binding-ops.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import {
  tacticalBoardToBoardGeometry,
  boardGeometryToTacticalBoard,
} from '@de-braighter/pack-football-contracts';
import {
  swapSlots as swapSlotsBoard,
  substitute as substituteBoard,
  setCaptain as setCaptainBoard,
  moveSlot as moveSlotBoard,
  addPlay as addPlayBoard,
  clearPlays as clearPlaysBoard,
  boardFromLineup,
} from './tactical-board-ops.js';
import {
  swapSlots,
  substitute,
  setCaptain,
  moveSlot,
  drawPlay,
  clearPlays,
} from './tactical-binding-ops.js';
import type { TacticalBoard, PlayAnnotation } from './tactical-board.types.js';

// A small fixture: two on-pitch slots (one with a player), one bench player.
const BOARD: TacticalBoard = boardFromLineup(
  [
    { slotId: 's1', playerId: 'p1', position: 'GK', x: 6, y: 60 },
    { slotId: 's2', playerId: null, position: 'CB', x: 22, y: 40 },
  ],
  [{ benchId: 'b1', playerId: 'p9', position: 'ST' }],
  's1',
);

function roundtrip(board: TacticalBoard, op: (d: ReturnType<typeof tacticalBoardToBoardGeometry>) => ReturnType<typeof tacticalBoardToBoardGeometry>): TacticalBoard {
  const next = op(tacticalBoardToBoardGeometry(board));
  return boardGeometryToTacticalBoard(next.geometry, next.binding);
}

describe('tactical-binding-ops ≡ tactical-board-ops (via converters)', () => {
  it('swapSlots', () => {
    expect(roundtrip(BOARD, (d) => swapSlots(d, 's1', 's2'))).toEqual(swapSlotsBoard(BOARD, 's1', 's2'));
  });
  it('substitute', () => {
    expect(roundtrip(BOARD, (d) => substitute(d, 's2', 'b1'))).toEqual(substituteBoard(BOARD, 's2', 'b1'));
  });
  it('setCaptain', () => {
    expect(roundtrip(BOARD, (d) => setCaptain(d, 's2'))).toEqual(setCaptainBoard(BOARD, 's2'));
  });
  it('moveSlot (clamped)', () => {
    expect(roundtrip(BOARD, (d) => moveSlot(d, 's2', 30, 200))).toEqual(moveSlotBoard(BOARD, 's2', 30, 200));
  });
  it('drawPlay (pass-arrow polyline preserves id + points)', () => {
    const play: PlayAnnotation = { playId: 'pl1', kind: 'pass-arrow', points: [{ x: 6, y: 60 }, { x: 22, y: 40 }] };
    expect(roundtrip(BOARD, (d) => drawPlay(d, play))).toEqual(addPlayBoard(BOARD, play));
  });
  it('drawPlay (zone-highlight)', () => {
    const play: PlayAnnotation = { playId: 'pl1', kind: 'zone-highlight', x: 10, y: 10, w: 16, h: 16 };
    expect(roundtrip(BOARD, (d) => drawPlay(d, play))).toEqual(addPlayBoard(BOARD, play));
  });
  it('clearPlays(playId) removes only that play', () => {
    const play: PlayAnnotation = { playId: 'pl1', kind: 'pass-arrow', points: [{ x: 6, y: 60 }, { x: 22, y: 40 }] };
    const withPlay = addPlayBoard(BOARD, play);
    const cleared = roundtrip(withPlay, (d) => clearPlays(d, 'pl1'));
    expect(cleared).toEqual(clearPlaysBoard(withPlay, 'pl1'));
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module doesn't exist)

Run: `npx nx test pack-football-ui --include="**/tactical-binding-ops.spec.ts"`
Expected: FAIL — cannot resolve `./tactical-binding-ops.js`.

- [ ] **Step 3: Implement** — `libs/pack-football-ui/src/lib/tactical-board/tactical-binding-ops.ts`:

```typescript
/**
 * tactical-binding-ops — pure Scene-5 gestures re-expressed on the engine's
 * { geometry, binding } pair (board runtime S3). Geometry mutations delegate to
 * `board-ops` where they fit (move-slot, clear-play); binding mutations update
 * the `TacticalBinding` directly (swap, substitute, set-captain). Draw-play
 * appends the already-minted play to geometry verbatim (preserving its id +
 * polyline, which `board-ops.addArrow` cannot). Proven equivalent to the legacy
 * `tactical-board-ops` by round-trip through the S0 converters.
 */
import type {
  TacticalBinding,
  TacticalBindingSlot,
  TacticalDecomposition,
} from '@de-braighter/pack-football-contracts';
import { moveMarker, removeArrow, removeZone } from '../board-engine/board-ops.js';
import type { BenchSlot, PlayAnnotation } from './tactical-board.types.js';

/** Clone the binding slots (immutability helper). */
function cloneSlots(slots: readonly TacticalBindingSlot[]): TacticalBindingSlot[] {
  return slots.map((s) => ({ ...s }));
}

/** Swap the players occupying two slots — playerId only (mirror swapSlots). */
export function swapSlots(d: TacticalDecomposition, slotIdA: string, slotIdB: string): TacticalDecomposition {
  const a = d.binding.slots.find((s) => s.markerId === slotIdA);
  const b = d.binding.slots.find((s) => s.markerId === slotIdB);
  if (a === undefined || b === undefined) {
    return { geometry: d.geometry, binding: { ...d.binding, slots: cloneSlots(d.binding.slots) } };
  }
  return {
    geometry: d.geometry,
    binding: {
      ...d.binding,
      slots: d.binding.slots.map((s) => {
        if (s.markerId === slotIdA) return { ...s, playerId: b.playerId };
        if (s.markerId === slotIdB) return { ...s, playerId: a.playerId };
        return { ...s };
      }),
    },
  };
}

/** Bring a bench player onto a slot, freeing the outgoing player to the bench (mirror substitute). */
export function substitute(d: TacticalDecomposition, outSlotId: string, inBenchId: string): TacticalDecomposition {
  const benchEntry = d.binding.bench.find((x) => x.benchId === inBenchId);
  const slot = d.binding.slots.find((s) => s.markerId === outSlotId);
  if (benchEntry === undefined || slot === undefined) {
    return { geometry: d.geometry, binding: { ...d.binding, slots: cloneSlots(d.binding.slots) } };
  }
  const outgoingPlayerId = slot.playerId ?? null;
  const slots = d.binding.slots.map((s) =>
    s.markerId === outSlotId ? { ...s, playerId: benchEntry.playerId } : { ...s },
  );
  const bench: BenchSlot[] = d.binding.bench.filter((x) => x.benchId !== inBenchId).map((x) => ({ ...x }));
  if (outgoingPlayerId !== null) {
    bench.push({ benchId: inBenchId, playerId: outgoingPlayerId, position: slot.position });
  }
  return { geometry: d.geometry, binding: { ...d.binding, slots, bench } };
}

/** Record the captain slot (mirror setCaptain). */
export function setCaptain(d: TacticalDecomposition, slotId: string): TacticalDecomposition {
  return { geometry: d.geometry, binding: { ...d.binding, captainSlotId: slotId } };
}

/** Relocate a slot marker (geometry; clamped to the frame by board-ops). */
export function moveSlot(d: TacticalDecomposition, slotId: string, x: number, y: number): TacticalDecomposition {
  return { geometry: moveMarker(d.geometry, slotId, x, y), binding: d.binding };
}

/** Append an already-minted play to geometry, preserving its id + polyline (mirror addPlay). */
export function drawPlay(d: TacticalDecomposition, play: PlayAnnotation): TacticalDecomposition {
  if (play.kind === 'zone-highlight') {
    return {
      geometry: { ...d.geometry, zones: [...d.geometry.zones, { id: play.playId, x: play.x, y: play.y, w: play.w, h: play.h }] },
      binding: d.binding,
    };
  }
  return {
    geometry: { ...d.geometry, arrows: [...d.geometry.arrows, { id: play.playId, kind: play.kind, points: play.points.map((pt) => ({ x: pt.x, y: pt.y })) }] },
    binding: d.binding,
  };
}

/** Clear plays — one by id, or all when omitted (mirror clearPlays). */
export function clearPlays(d: TacticalDecomposition, playId?: string): TacticalDecomposition {
  if (playId === undefined) {
    return { geometry: { ...d.geometry, arrows: [], zones: [] }, binding: d.binding };
  }
  return { geometry: removeZone(removeArrow(d.geometry, playId), playId), binding: d.binding };
}
```

> If a binding type import path differs (e.g. `TacticalDecomposition`/`TacticalBindingSlot` not on the contracts barrel), read `libs/pack-football-contracts/src/index.ts` and import from the exact exported names; the converters + `TacticalDecomposition` are exported there (Task-0 reconnaissance confirmed). `BenchSlot`/`PlayAnnotation` come from `./tactical-board.types.js`.

- [ ] **Step 4: Run — expect PASS** (equivalence holds for all gestures)

Run: `npx nx test pack-football-ui --include="**/tactical-binding-ops.spec.ts"`
Expected: PASS. If a gesture's `.toEqual` fails, the binding-op diverges from the legacy op — fix the binding-op to match (the legacy op is the source of truth for behaviour).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/tactical-board/tactical-binding-ops.ts libs/pack-football-ui/src/lib/tactical-board/tactical-binding-ops.spec.ts
git commit -m "feat(pack-football-ui): tactical-binding-ops on the engine {geometry,binding} (S3.2)"
```

---

## Task 4: Rewire `TacticalBoardComponent` onto the engine (byte-preserved)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/tactical-board/tactical-board.component.ts`
- (Test: the existing `tactical-board.component.spec.ts` must stay green; migrate only `store.board()` reads if any are white-box.)

> **READ THE COMPONENT FIRST.** This is a mechanical rewire mirroring S1.2 (which did the same for the drill editor). Do not change the template's visual structure, the gesture vocabulary, the `boardChange` output shape, keyboard a11y, or debounce timing. The ONLY changes are the store type, the boundary conversion, and routing gesture calls through `tactical-binding-ops`.

- [ ] **Step 1: Capture the byte-preservation baseline**

Run: `npx nx test pack-football-ui --include="**/tactical-board.component.spec.ts"`
Expected: PASS — record the test count (≈65). This count must hold after the rewire.

- [ ] **Step 2: Swap the store + add the boundary `board()` computed.** In `tactical-board.component.ts`:

Replace the imports of `TacticalBoardStore` and the geometry-mutating `tactical-board-ops` functions (`swapSlots`, `substitute`, `setCaptain`, `moveSlot`, `addPlay`, `clearPlays`) with:

```typescript
import { computed } from '@angular/core'; // if not already imported
import {
  tacticalBoardToBoardGeometry,
  boardGeometryToTacticalBoard,
  type TacticalBinding,
} from '@de-braighter/pack-football-contracts';
import { BoardEditorStore } from '../board-engine/board-editor.store.js';
import {
  swapSlots,
  substitute,
  setCaptain,
  moveSlot,
  drawPlay,
  clearPlays,
} from './tactical-binding-ops.js';
```

Keep importing `nextPlayId` (and `EMPTY_BOARD`/`boardFromLineup` if the component references them) from `./tactical-board-ops.js`.

Replace the store field (was `readonly store = new TacticalBoardStore();`):

```typescript
  readonly store = new BoardEditorStore<TacticalBinding>();

  /** The working board, composed from the engine's geometry + binding (S3). */
  protected readonly board = computed(() =>
    boardGeometryToTacticalBoard(this.store.workingGeometry(), this.store.workingAux() as TacticalBinding),
  );
```

- [ ] **Step 3: Convert at load + migrate `store.board()` reads.**

The seed effect (was `this.store.begin(b)` where `b: TacticalBoard`): decompose first —

```typescript
      untracked(() => {
        const { geometry, binding } = tacticalBoardToBoardGeometry(b);
        this.store.begin(geometry, binding);
      });
```

Replace every `this.store.board()` read with `this.board()` (the new computed). Per the Task-0 grep these are at the `layoutTacticalBoardScene(...)` view computed, the `.lineup.find(...)` lookups, and the `boardChange.emit({ ..., board: this.store.board() })` sites. (If any spec reads `componentInstance['store'].board()` white-box, migrate it to `componentInstance['board']()` — the 1:1 read migration, no assertion change. The S1.2 drill rewire used this exact pattern.)

- [ ] **Step 4: Route gesture handlers through `tactical-binding-ops` + `store.apply(geometry, binding)`.**

Add a small private helper pair to keep the call-sites tidy:

```typescript
  private state(): { geometry: BoardGeometry; binding: TacticalBinding } {
    return { geometry: this.store.workingGeometry(), binding: this.store.workingAux() as TacticalBinding };
  }
  private commit(next: { geometry: BoardGeometry; binding: TacticalBinding }): void {
    this.store.apply(next.geometry, next.binding);
  }
```

(Import `BoardGeometry` type from `@de-braighter/pack-football-contracts` if not already.)

Rewrite each gesture handler (the legacy form was `this.store.apply(<op>(this.store.board(), ...))`):

```typescript
  // swap-slot
  this.commit(swapSlots(this.state(), slotIdA, slotIdB));
  // substitute
  this.commit(substitute(this.state(), outSlotId, inBenchId));
  // set-captain
  this.commit(setCaptain(this.state(), slotId));
  // move-slot (both the pointer-drag end and the keyboard nudge call-sites)
  this.commit(moveSlot(this.state(), slotId, x, y));
  // draw-play (after the component mints `play` with nextPlayId, as today)
  this.commit(drawPlay(this.state(), play));
  // clear-play
  this.commit(clearPlays(this.state(), playId));
```

The `snapshot-formation` handler keeps emitting `boardChange.emit({ gesture: { kind: 'snapshot-formation', label }, board: this.board() })` — no engine mutation (it is a structural/host gesture; the legacy code did not mutate the store for it either).

If the component used `store.beginTransient()/updateTransient()/commitTransient()/cancelTransient()` for drag (grep the component), thread the binding through: `updateTransient(moveSlot(this.state(), id, x, y).geometry, this.store.workingAux() as TacticalBinding)` — i.e. pass the (unchanged) binding alongside the moved geometry. (If the component does NOT use the store's transient methods — the Task-0 grep found none — leave drag as-is on `apply`.)

- [ ] **Step 5: Run the tactical specs — expect PASS at the baseline count**

Run: `npx nx test pack-football-ui --include="**/tactical-board.component.spec.ts"`
Expected: PASS — same count as Step 1. If a spec fails:
- A white-box `store.board()` read → migrate to `board()` (mechanical, no assertion change).
- A behaviour difference → the binding-op or boundary conversion diverges; fix to match the legacy behaviour. Do NOT weaken a spec to make it pass.

- [ ] **Step 6: Run the page host + drill specs (no collateral regression)**

Run: `npx nx test pack-football-ui --include="**/match-day-scene5-page.component.spec.ts" --include="**/drill-board-editor.component.spec.ts"`
Expected: PASS. (`boardChange` still emits `{ gesture, board: TacticalBoard }`, so the host's `gestureToTreeEdit` + `substitutionRequestFromGesture` are unaffected.)

- [ ] **Step 7: Build**

Run: `npx nx build pack-football-ui`
Expected: builds.

- [ ] **Step 8: Commit**

```bash
git add libs/pack-football-ui/src/lib/tactical-board/tactical-board.component.ts libs/pack-football-ui/src/lib/tactical-board/tactical-board.component.spec.ts
git commit -m "refactor(pack-football-ui): tactical editor runs on the board engine (S3.3)"
```

---

## Task 5: Retire the now-dead `TacticalBoardStore` + dead `tactical-board-ops` (conditional)

**Files:**
- Possibly delete: `libs/pack-football-ui/src/lib/tactical-board/tactical-board.store.ts` (+ its spec)
- Possibly trim: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-ops.ts`

- [ ] **Step 1: Find all remaining references**

Run (Grep, not bash): search the whole repo for `TacticalBoardStore`, and for each of `swapSlots`, `substitute`, `setCaptain`, `moveSlot`, `addPlay`, `clearPlays`, `EMPTY_BOARD`, `boardFromLineup`, `nextPlayId`, `snapshotFormation` imported from `tactical-board-ops`.

- [ ] **Step 2: Decide + act (founder rule: retire if cleanly dead, else defer to S5).**
  - If `TacticalBoardStore` has zero references outside its own spec → delete `tactical-board.store.ts` + `tactical-board.store.spec.ts`.
  - For each `tactical-board-ops` export: if zero references remain (after Task 4 removed the component's), delete that function + its spec cases. KEEP any still referenced (likely `nextPlayId` used by the component for draw-play; `EMPTY_BOARD`/`boardFromLineup` if used as input defaults or by `tactical-binding-ops.spec.ts`; `snapshotFormation`/`substitutionRequestFromGesture` if used by the page host).
  - If retirement is entangled (a kept export sits in the same file as dead ones), trim the dead exports only; leave the file. If untangling is risky, leave a `// TODO(S5): retire …` comment and STOP this task with a note — do not force a risky deletion.

- [ ] **Step 3: Verify nothing broke**

Run: `npx nx test pack-football-ui --include="**/tactical-board.component.spec.ts" --include="**/tactical-binding-ops.spec.ts"` and `npx nx build pack-football-ui`
Expected: PASS + builds.

- [ ] **Step 4: Commit** (only if something was retired; otherwise skip with a note)

```bash
git add -A libs/pack-football-ui/src/lib/tactical-board/
git commit -m "chore(pack-football-ui): retire dead TacticalBoardStore/tactical-board-ops (S3.4)"
```

---

## Task 6: Full-gate verification + PR

**Files:** none.

- [ ] **Step 1: Build affected**

Run: `npx nx run-many -t build -p pack-football-ui pack-football-contracts`
Expected: both build.

- [ ] **Step 2: Test the full `pack-football-ui` lib**

Run: `npx nx test pack-football-ui`
Expected: green (drill + tactical + engine). If it OOMs under coverage (known infra), fall back to targeted runs of the touched specs (store, board-ops, tactical-binding-ops, tactical-board.component, drill-board-editor.component, match-day-scene5-page).

- [ ] **Step 3: Lint**

Run: `npx nx lint pack-football-ui`
Expected: 0 errors (no unused imports left from the store/ops swap; the pre-existing spec-file non-null-assertion warnings are acceptable).

- [ ] **Step 4: Push + open the PR** (twin-ritual lines per `policies/git.md` + memory `twin-ritual-is-mandatory`; the diff is internal refactor, so `Tech design:` link + no `Closes` is correct):

```bash
git push -u origin feat/board-runtime-s3-tactical-onto-engine
gh pr create --title "refactor: board runtime S3 — tactical editor onto the generic engine" --body "$(cat <<'EOF'
Behaviour-preserving consolidation: the Scene-5 TacticalBoardComponent now runs
on the shared BoardEditorStore (+ optional aux) + board-ops + the S0
TacticalBinding/converters, via a pure tactical-binding-ops layer proven
equivalent to the legacy tactical-board-ops by converter round-trip. The engine
now carries a second real consumer (drill + tactical) — the unlock for the later
generic-component extraction + the routed /coach/board convergence (#214).
No user-facing change; generic component + routed-board collapse deferred (S4/S5).

Tech design: de-braighter/workbench docs/superpowers/specs/2026-06-08-board-runtime-s3-tactical-onto-engine-design.md
Plan: de-braighter/workbench docs/superpowers/plans/2026-06-08-board-runtime-s3-tactical-onto-engine.md

Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]
Effect: cycle-time 0.01±0.02 expert
Effect: findings 1±2 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Verifier wave + twin ritual.** Run the wave (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker`, `isolation: worktree`); fix blockers; after merge run the devloop twin ritual (`drain` → `backfill de-braighter/exercir` → `reconcile`).

---

## Self-Review (completed by plan author)

**Spec coverage:** §3 Fork 1 (store aux) → Task 1. §4.1 engine aux → Task 1. §4.2 tactical-binding-ops via board-ops + binding → Task 3. §4.3 component rewire (board() computed, converters at load/emit, gestures via binding-ops, boardChange + persistence unchanged) → Task 4. §4.4 100×120 frame → Task 2. §4.5 dead-code retirement (conditional) → Task 5. §5 acceptance (behaviour byte-preserved, ~65 tactical + full drill green, 2nd consumer) → Tasks 1/4/6. §6 risks (drill regression → Task 1 Steps 5-6; tactical drift → Task 4 baseline+migrate; round-trip lossiness → Task 3 equivalence tests; hidden coupling → Task 5 Step 1 grep).

**Placeholder scan:** no TBD/TODO except the intentional `// TODO(S5)` fallback in Task 5 (a documented defer per the founder rule) and the "read the component first / read the barrel if a path differs" instructions (bounded, with the exact symbols named). New artifacts (store, board-ops test, binding-ops) ship full real code + tests; the component rewire is a precise recipe over a 850-line file (the implementer reads it, mirroring the proven S1.2 pattern).

**Type consistency:** `BoardEditorStore<TAux>` + `workingAux()` + `begin/apply/updateTransient(…, aux?)` consistent across Tasks 1 + 4. `TacticalDecomposition = {geometry, binding}` is the binding-ops state type (Task 3) and the component's `state()`/`commit()` shape (Task 4). Binding-op names (`swapSlots`/`substitute`/`setCaptain`/`moveSlot`/`drawPlay`/`clearPlays`) match between Task 3's definitions, its spec, and Task 4's imports. `board()` computed name used identically in Task 4 Steps 2-4. Converters + `TACTICAL_SLOT_MARKER_KIND` id-mapping consistent with the contracts source.
