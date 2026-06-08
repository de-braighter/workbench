# Board Runtime S1.1 — Engine Ops + Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Land the pure, domain-free heart of the board engine — `board-ops` (geometry mutations on the S0 `BoardGeometry`, config-driven id-prefix + frame-clamp) and `board-editor.store` (the generic engine state: working geometry + undo/redo/transient + tool + selection) — fully unit-tested, with NO drill/tactic knowledge and NO persistence concerns.

**Architecture:** New internal folder `libs/pack-football-ui/src/lib/board-engine/`. `board-ops.ts` generalizes `generation/drill-diagram-ops.ts` onto `BoardGeometry` (clamp from `geometry.frame`; ids minted from a caller-supplied prefix so drill stays `d{n}`/`a{n}`). `board-editor.store.ts` generalizes the GENERIC half of `state/drill-editor.store.ts` (snapshot undo/redo/transient, tool, selection) — the drill-catalog persistence half (saveStatus/fork) stays drill-side. Pure modules; no public-API (`index.ts`) change — these are internal engine units consumed by S1.2 (component) + S1.3 (drill cutover).

**Tech Stack:** TypeScript, Angular 21 signals (`signal`/`computed`, used standalone — no TestBed needed), vitest, Nx 22. All in `domains/exercir/libs/pack-football-ui`. Run from `D:/development/projects/de-braighter/domains/exercir`.

**Source spec:** `docs/superpowers/specs/2026-06-07-board-runtime-s1-engine-design.md` (§4 boundary, §6 byte-preservation).

**Reference (the modules being generalized):** `libs/pack-football-ui/src/lib/generation/drill-diagram-ops.ts` (clamp/id-suffix/ops) and `libs/pack-football-ui/src/lib/state/drill-editor.store.ts` (undo/transient mechanism). The S0 model lives in `@de-braighter/pack-football-contracts` (`BoardGeometry`/`BoardFrame`/`BoardMarker`/`BoardArrow`/`BoardZone`).

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `libs/pack-football-ui/src/lib/board-engine/board-ops.ts` | Create | `emptyBoardGeometry` + pure geometry mutations (`addMarker`/`moveMarker`/`setMarkerKind`/`removeMarker`/`addArrow`/`removeArrow`/`addZone`/`removeZone`) on `BoardGeometry` |
| `libs/pack-football-ui/src/lib/board-engine/board-ops.spec.ts` | Create | Ops unit tests (id-prefix sequencing, frame-clamp, immutability) |
| `libs/pack-football-ui/src/lib/board-engine/board-editor.types.ts` | Create | `BoardTool` + `BoardSelection` (generalized from drill) |
| `libs/pack-football-ui/src/lib/board-engine/board-editor.store.ts` | Create | `BoardEditorStore` — generic engine state (working geometry, undo/redo/transient, tool, selection) |
| `libs/pack-football-ui/src/lib/board-engine/board-editor.store.spec.ts` | Create | Store unit tests (begin/apply/undo/redo/transient/tool/selection) |

No `index.ts` change (internal engine modules). ESM `.js` import specifiers throughout. No Angular component, no NestJS, no HTTP.

---

### Task 1: `board-ops` — geometry mutations on `BoardGeometry`

**Files:** Create `board-engine/board-ops.ts` + `board-engine/board-ops.spec.ts`.

- [ ] **Step 1: Write the failing test** — `libs/pack-football-ui/src/lib/board-engine/board-ops.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { BoardGeometry } from '@de-braighter/pack-football-contracts';
import {
  emptyBoardGeometry,
  addMarker,
  moveMarker,
  setMarkerKind,
  removeMarker,
  addArrow,
  removeArrow,
  addZone,
  removeZone,
} from './board-ops.js';

const FRAME60 = { width: 100, height: 60 };

describe('board-ops', () => {
  it('emptyBoardGeometry carries the frame + empty collections', () => {
    expect(emptyBoardGeometry(FRAME60)).toEqual({
      frame: { width: 100, height: 60 }, markers: [], arrows: [], zones: [],
    });
  });

  it('addMarker mints ids from the prefix and clamps to the frame', () => {
    let g: BoardGeometry = emptyBoardGeometry(FRAME60);
    g = addMarker(g, 'pack-football.drill-diagram.player', 200, -5, 'd');
    g = addMarker(g, 'pack-football.drill-diagram.cone', 30, 40, 'd');
    expect(g.markers).toEqual([
      { id: 'd1', x: 100, y: 0, kind: 'pack-football.drill-diagram.player' }, // clamped x→100, y→0
      { id: 'd2', x: 30, y: 40, kind: 'pack-football.drill-diagram.cone' },
    ]);
  });

  it('addMarker continues the id sequence past the current max suffix', () => {
    const g0: BoardGeometry = {
      frame: { width: 100, height: 60 },
      markers: [{ id: 'd5', x: 1, y: 1, kind: 'k' }],
      arrows: [], zones: [],
    };
    expect(addMarker(g0, 'k', 2, 2, 'd').markers[1]?.id).toBe('d6');
  });

  it('moveMarker clamps to the frame + preserves other markers/fields', () => {
    const g0: BoardGeometry = {
      frame: { width: 100, height: 120 },
      markers: [{ id: 'm1', x: 0, y: 0, kind: 'k', label: '7' }],
      arrows: [], zones: [],
    };
    const g1 = moveMarker(g0, 'm1', 50, 200);
    expect(g1.markers[0]).toEqual({ id: 'm1', x: 50, y: 120, kind: 'k', label: '7' }); // y clamped to frame.height
  });

  it('setMarkerKind changes only the targeted marker kind', () => {
    const g0: BoardGeometry = {
      frame: FRAME60, markers: [{ id: 'm1', x: 1, y: 1, kind: 'a' }], arrows: [], zones: [],
    };
    expect(setMarkerKind(g0, 'm1', 'b').markers[0]?.kind).toBe('b');
  });

  it('removeMarker drops only the targeted marker', () => {
    const g0: BoardGeometry = {
      frame: FRAME60,
      markers: [{ id: 'm1', x: 1, y: 1, kind: 'a' }, { id: 'm2', x: 2, y: 2, kind: 'b' }],
      arrows: [], zones: [],
    };
    expect(removeMarker(g0, 'm1').markers.map((m) => m.id)).toEqual(['m2']);
  });

  it('addArrow mints a 2-point polyline (clamped) with a prefixed id', () => {
    const g1 = addArrow(emptyBoardGeometry(FRAME60), 'pack-football.drill-diagram.arrow.pass', 1, 2, 200, 80, 'a');
    expect(g1.arrows).toEqual([
      { id: 'a1', kind: 'pack-football.drill-diagram.arrow.pass', points: [{ x: 1, y: 2 }, { x: 100, y: 60 }] },
    ]);
  });

  it('removeArrow drops only the targeted arrow', () => {
    const g0: BoardGeometry = {
      frame: FRAME60, markers: [],
      arrows: [{ id: 'a1', kind: 'k', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }], zones: [],
    };
    expect(removeArrow(g0, 'a1').arrows).toEqual([]);
  });

  it('addZone clamps x/y to the frame and w/h to [1, frame]', () => {
    const g1 = addZone(emptyBoardGeometry(FRAME60), 'drill-zone', -1, 70, 0, 200);
    expect(g1.zones).toEqual([{ id: 'drill-zone', x: 0, y: 60, w: 1, h: 60 }]);
  });

  it('removeZone drops the targeted zone by id', () => {
    const g0: BoardGeometry = {
      frame: FRAME60, markers: [], arrows: [],
      zones: [{ id: 'drill-zone', x: 0, y: 0, w: 5, h: 5 }],
    };
    expect(removeZone(g0, 'drill-zone').zones).toEqual([]);
  });

  it('does not mutate the input geometry', () => {
    const g0 = emptyBoardGeometry(FRAME60);
    addMarker(g0, 'k', 1, 1, 'd');
    expect(g0.markers).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx nx test pack-football-ui --include="**/board-ops.spec.ts"` → FAIL ("Cannot find module './board-ops.js'").

- [ ] **Step 3: Create `board-ops.ts`** with EXACTLY:

```ts
/**
 * board-ops — pure geometry mutations on the S0 `BoardGeometry` (board runtime
 * S1.1). The domain-free heart of the board engine: generalizes
 * `generation/drill-diagram-ops.ts` so any board kind reuses it. Clamps from
 * `geometry.frame` (not a hardcoded frame); ids are minted from a caller-supplied
 * prefix (drill passes 'd'/'a' to keep `d{n}`/`a{n}`; later kinds pass their own).
 * No drill/tactic knowledge, no persistence — those live in the render-config +
 * the host. Zones are add/remove by id; single-zone (drill) semantics compose
 * from these in the drill render-config (S1.2).
 */

import type {
  BoardArrow,
  BoardFrame,
  BoardGeometry,
  BoardMarker,
  BoardZone,
} from '@de-braighter/pack-football-contracts';

/** An empty board with the given frame (the engine's initial state). */
export function emptyBoardGeometry(frame: BoardFrame): BoardGeometry {
  return { frame: { width: frame.width, height: frame.height }, markers: [], arrows: [], zones: [] };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Next `${prefix}{n}` id, continuing past the max existing suffix with that prefix. */
function nextId(ids: readonly string[], prefix: string): string {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const max = ids.reduce((m, id) => {
    const hit = re.exec(id);
    return hit ? Math.max(m, Number.parseInt(hit[1], 10)) : m;
  }, 0);
  return `${prefix}${max + 1}`;
}

export function addMarker(
  g: BoardGeometry,
  kind: string,
  x: number,
  y: number,
  idPrefix: string,
): BoardGeometry {
  const marker: BoardMarker = {
    id: nextId(g.markers.map((m) => m.id), idPrefix),
    x: clamp(x, 0, g.frame.width),
    y: clamp(y, 0, g.frame.height),
    kind,
  };
  return { ...g, markers: [...g.markers, marker] };
}

export function moveMarker(g: BoardGeometry, id: string, x: number, y: number): BoardGeometry {
  return {
    ...g,
    markers: g.markers.map((m) =>
      m.id === id ? { ...m, x: clamp(x, 0, g.frame.width), y: clamp(y, 0, g.frame.height) } : m,
    ),
  };
}

export function setMarkerKind(g: BoardGeometry, id: string, kind: string): BoardGeometry {
  return { ...g, markers: g.markers.map((m) => (m.id === id ? { ...m, kind } : m)) };
}

export function removeMarker(g: BoardGeometry, id: string): BoardGeometry {
  return { ...g, markers: g.markers.filter((m) => m.id !== id) };
}

export function addArrow(
  g: BoardGeometry,
  kind: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  idPrefix: string,
): BoardGeometry {
  const arrow: BoardArrow = {
    id: nextId(g.arrows.map((a) => a.id), idPrefix),
    kind,
    points: [
      { x: clamp(x1, 0, g.frame.width), y: clamp(y1, 0, g.frame.height) },
      { x: clamp(x2, 0, g.frame.width), y: clamp(y2, 0, g.frame.height) },
    ],
  };
  return { ...g, arrows: [...g.arrows, arrow] };
}

export function removeArrow(g: BoardGeometry, id: string): BoardGeometry {
  return { ...g, arrows: g.arrows.filter((a) => a.id !== id) };
}

export function addZone(
  g: BoardGeometry,
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
): BoardGeometry {
  const zone: BoardZone = {
    id,
    x: clamp(x, 0, g.frame.width),
    y: clamp(y, 0, g.frame.height),
    w: clamp(w, 1, g.frame.width),
    h: clamp(h, 1, g.frame.height),
  };
  return { ...g, zones: [...g.zones, zone] };
}

export function removeZone(g: BoardGeometry, id: string): BoardGeometry {
  return { ...g, zones: g.zones.filter((z) => z.id !== id) };
}
```

- [ ] **Step 4: Run to verify it passes** — `npx nx test pack-football-ui --include="**/board-ops.spec.ts"` → PASS (11 cases). If `nx test` filtering is unavailable, run the full `npx nx test pack-football-ui` and confirm the board-ops cases pass.

- [ ] **Step 5: Lint + commit** — `npx nx lint pack-football-ui` → clean (no new warnings on the 2 files).

```bash
git add libs/pack-football-ui/src/lib/board-engine/board-ops.ts libs/pack-football-ui/src/lib/board-engine/board-ops.spec.ts
git commit -m "feat(pack-football-ui): board-engine board-ops on BoardGeometry (S1.1)"
```

---

### Task 2: `BoardEditorStore` — the generic engine state

**Files:** Create `board-engine/board-editor.types.ts`, `board-engine/board-editor.store.ts`, `board-engine/board-editor.store.spec.ts`.

**Context:** Generalizes the GENERIC half of `DrillEditorStore` (snapshot undo/redo/transient, tool, selection). The drill store's persistence half (`saveStatus`/`errorReason`/`isVendor`/`needsFork`/`rememberFork`/`saveTargetKey`/`markDirty`) is deliberately OMITTED — it stays drill-side (the host observes geometry changes for its own dirty/save state in S1.3). Plain class using standalone Angular signals (no TestBed).

- [ ] **Step 1: Create the types** `libs/pack-football-ui/src/lib/board-engine/board-editor.types.ts`:

```ts
/**
 * board-editor.types — interaction state for the generic board engine (S1.1).
 * `BoardTool` is an open token ('select' is the neutral default; the render-config
 * (S1.2) declares the rest + maps them to add-marker/add-arrow/zone). `BoardSelection`
 * generalizes the drill selection (drill 'dot' → 'marker'; zone now id-keyed).
 */

/** The active editor tool. 'select' is the neutral default; render-config defines others. */
export type BoardTool = string;

/** What the editor currently has selected. */
export type BoardSelection =
  | { kind: 'none' }
  | { kind: 'marker'; id: string }
  | { kind: 'arrow'; id: string }
  | { kind: 'zone'; id: string };
```

- [ ] **Step 2: Write the failing test** `libs/pack-football-ui/src/lib/board-engine/board-editor.store.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { BoardGeometry } from '@de-braighter/pack-football-contracts';
import { addMarker, emptyBoardGeometry } from './board-ops.js';
import { BoardEditorStore } from './board-editor.store.js';

const FRAME = { width: 100, height: 60 };
function board(): BoardGeometry {
  return emptyBoardGeometry(FRAME);
}

describe('BoardEditorStore', () => {
  it('begin sets the working geometry + resets tool/selection/undo/redo', () => {
    const s = new BoardEditorStore();
    s.setTool('zone');
    s.apply(addMarker(board(), 'k', 1, 1, 'd'));
    s.begin(board());
    expect(s.workingGeometry()).toEqual(board());
    expect(s.tool()).toBe('select');
    expect(s.selection()).toEqual({ kind: 'none' });
    expect(s.canUndo()).toBe(false);
    expect(s.canRedo()).toBe(false);
  });

  it('apply pushes an undo frame and clears redo', () => {
    const s = new BoardEditorStore();
    s.begin(board());
    s.apply(addMarker(s.workingGeometry(), 'k', 1, 1, 'd'));
    expect(s.workingGeometry().markers).toHaveLength(1);
    expect(s.canUndo()).toBe(true);
    expect(s.canRedo()).toBe(false);
  });

  it('undo/redo move between snapshots', () => {
    const s = new BoardEditorStore();
    s.begin(board());
    s.apply(addMarker(s.workingGeometry(), 'k', 1, 1, 'd'));
    s.undo();
    expect(s.workingGeometry().markers).toHaveLength(0);
    expect(s.canRedo()).toBe(true);
    s.redo();
    expect(s.workingGeometry().markers).toHaveLength(1);
  });

  it('a new apply after undo clears the redo stack', () => {
    const s = new BoardEditorStore();
    s.begin(board());
    s.apply(addMarker(s.workingGeometry(), 'k', 1, 1, 'd'));
    s.undo();
    s.apply(addMarker(s.workingGeometry(), 'k', 2, 2, 'd'));
    expect(s.canRedo()).toBe(false);
  });

  it('transient: commit collapses to a single undo frame', () => {
    const s = new BoardEditorStore();
    s.begin(board());
    s.beginTransient();
    s.updateTransient(addMarker(s.workingGeometry(), 'k', 1, 1, 'd'));
    s.updateTransient(addMarker(s.workingGeometry(), 'k', 2, 2, 'd'));
    s.commitTransient();
    expect(s.workingGeometry().markers).toHaveLength(2);
    s.undo();
    expect(s.workingGeometry().markers).toHaveLength(0); // one undo reverts the whole transient
  });

  it('transient: cancel restores the pre-transient geometry', () => {
    const s = new BoardEditorStore();
    s.begin(board());
    s.updateTransient(addMarker(s.workingGeometry(), 'k', 1, 1, 'd')); // no beginTransient → still works as a set
    s.beginTransient();
    s.updateTransient(addMarker(s.workingGeometry(), 'k', 2, 2, 'd'));
    s.cancelTransient();
    expect(s.workingGeometry().markers).toHaveLength(1);
    expect(s.canUndo()).toBe(false);
  });

  it('setTool / select update their signals', () => {
    const s = new BoardEditorStore();
    s.begin(board());
    s.setTool('arrow-pass');
    s.select({ kind: 'marker', id: 'd1' });
    expect(s.tool()).toBe('arrow-pass');
    expect(s.selection()).toEqual({ kind: 'marker', id: 'd1' });
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx nx test pack-football-ui --include="**/board-editor.store.spec.ts"` → FAIL ("Cannot find module './board-editor.store.js'").

- [ ] **Step 4: Create `board-editor.store.ts`** with EXACTLY:

```ts
/**
 * BoardEditorStore — the generic engine state for the board runtime (S1.1):
 * working geometry + snapshot undo/redo/transient + tool + selection. This is
 * the generic half of the old `DrillEditorStore`; the drill-catalog persistence
 * half (save status / vendor fork) is deliberately NOT here — the host owns it
 * (it observes `workingGeometry` for its own dirty/save state). Plain class
 * using standalone Angular signals (usable outside an injection context).
 */

import { computed, signal } from '@angular/core';

import type { BoardGeometry } from '@de-braighter/pack-football-contracts';
import { emptyBoardGeometry } from './board-ops.js';
import type { BoardSelection, BoardTool } from './board-editor.types.js';

export class BoardEditorStore {
  readonly workingGeometry = signal<BoardGeometry>(
    emptyBoardGeometry({ width: 100, height: 120 }),
  );
  readonly selection = signal<BoardSelection>({ kind: 'none' });
  readonly tool = signal<BoardTool>('select');

  private readonly undoDepth = signal(0);
  private readonly redoDepth = signal(0);
  readonly canUndo = computed(() => this.undoDepth() > 0);
  readonly canRedo = computed(() => this.redoDepth() > 0);

  private undoStack: BoardGeometry[] = [];
  private redoStack: BoardGeometry[] = [];
  private transientBase: BoardGeometry | null = null;

  begin(initial: BoardGeometry): void {
    this.workingGeometry.set(initial);
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

  apply(next: BoardGeometry): void {
    this.undoStack.push(this.workingGeometry());
    this.redoStack = [];
    this.workingGeometry.set(next);
    this.syncDepths();
  }

  beginTransient(): void {
    if (this.transientBase !== null) return; // a transient is already in progress
    this.transientBase = this.workingGeometry();
  }

  updateTransient(next: BoardGeometry): void {
    this.workingGeometry.set(next);
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
    this.workingGeometry.set(this.transientBase);
    this.transientBase = null;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.workingGeometry());
    this.workingGeometry.set(prev);
    this.syncDepths();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.workingGeometry());
    this.workingGeometry.set(next);
    this.syncDepths();
  }

  private syncDepths(): void {
    this.undoDepth.set(this.undoStack.length);
    this.redoDepth.set(this.redoStack.length);
  }
}
```

- [ ] **Step 5: Run to verify it passes** — `npx nx test pack-football-ui --include="**/board-editor.store.spec.ts"` → PASS (7 cases). If the store spec errors with an Angular injection-context complaint on `computed`, mirror the harness used by the existing `libs/pack-football-ui/src/lib/state/drill-editor.store.spec.ts` (read it) — but plain `signal`/`computed` instantiation works standalone, so this should pass without TestBed.

- [ ] **Step 6: Lint + build + commit** — `npx nx lint pack-football-ui` → clean; `npx nx build pack-football-ui` → PASS.

```bash
git add libs/pack-football-ui/src/lib/board-engine/board-editor.types.ts libs/pack-football-ui/src/lib/board-engine/board-editor.store.ts libs/pack-football-ui/src/lib/board-engine/board-editor.store.spec.ts
git commit -m "feat(pack-football-ui): board-engine BoardEditorStore (generic engine state, S1.1)"
```

---

### Task 3: Slice verification + PR

- [ ] **Step 1: Gate** — `npx nx test pack-football-ui` → PASS (full suite, incl. the new board-engine specs + all existing drill specs unchanged); `npx nx lint pack-football-ui` → 0 errors; `npx nx build pack-football-ui` → PASS.
- [ ] **Step 2: Diff sanity** — `git diff --name-status main...HEAD` → exactly the 5 new files under `libs/pack-football-ui/src/lib/board-engine/`. (No `index.ts` change; no existing file touched — board-engine is purely additive in S1.1.)
- [ ] **Step 3: Push + PR** — `git push -u origin HEAD`; `gh pr create` with a summary (board-runtime S1.1; the pure engine core — ops + store on BoardGeometry; additive, no consumer yet; drill cutover is S1.3), `Tech design:` links to the S1 design + epic docs, `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`, `Effect: cycle-time 0.01±0.02 expert`, `Effect: findings 0±1 expert`.
- [ ] **Step 4: Verifier wave** — `local-ci` + `charter-checker` + `exercir-charter-checker` (read-only, worktree isolation) at the PR head. (qa-engineer's a11y/perf/endpoint dimensions don't apply to pure additive engine modules; per-task combined reviews cover code-quality.)

---

## Self-Review (against the S1 design)

**Spec coverage:** §4 `board-ops` (generic mutations, frame-clamp, id-prefix config) → Task 1. §4 `board-editor.store` (generic engine state, persistence omitted) → Task 2. §6 byte-preservation (id-prefix → `d{n}`/`a{n}`; frame-clamp; undo/transient mechanism identical to drill) → Tasks 1+2 (the prefix param + the snapshot mechanism mirror the drill modules). §4 "board-engine/ internal, no public API" → no index.ts change (Task 3 diff-sanity). S1.1's non-goals (component, render-config, cutover, zones-multi) correctly deferred. ✅

**Placeholder scan:** no TBD/TODO; every code step has full code + exact commands + expected output. ✅

**Type consistency:** `emptyBoardGeometry`/`addMarker`/`moveMarker`/`setMarkerKind`/`removeMarker`/`addArrow`/`removeArrow`/`addZone`/`removeZone` defined in Task 1, consumed by the Task 2 store spec; `BoardTool`/`BoardSelection` (Task 2 types) used by `BoardEditorStore`; the store mirrors the drill store's method names where generic (`begin`/`apply`/`beginTransient`/`updateTransient`/`commitTransient`/`cancelTransient`/`undo`/`redo`/`setTool`/`select`/`canUndo`/`canRedo`) but on `workingGeometry: signal<BoardGeometry>`; ids minted via the `idPrefix` param (drill 'd'/'a'); clamp uses `g.frame.{width,height}`. Drill `selection 'dot'` → generic `'marker'`. ✅
