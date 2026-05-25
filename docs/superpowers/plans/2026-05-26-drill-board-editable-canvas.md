# Drill-board editable canvas (Scene 4 authoring) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the editable drill-diagram canvas (ADR-160 Scene 4) — place/move/delete dots, draw/delete arrows, set/clear the zone, with full keyboard a11y; explicit save with local undo/redo; vendor→tenant lazy fork on first save.

**Architecture:** A new standalone OnPush `DrillBoardEditorComponent` renders its own interactive SVG (reusing the pure `layoutDrillBoard` + `pitch.ts` + extracted glyph styles), driven by a plain-class `DrillEditorStore` holding a working `DrillDiagram` signal with an undo/redo + transient-drag history. Editing is a **catalog mutation** persisted whole-diagram on explicit save: the UI calls two new thin HTTP endpoints that wrap the already-built `ForkTemplateUseCase` + `UpdateDrillDiagramUseCase`. The read-only `DrillBoardSceneComponent` viewer is untouched.

**Tech Stack:** TypeScript, Angular (standalone, signals, OnPush), Nx, Vitest (`@nx/angular:unit-test` for UI, `@nestjs/testing` + supertest for API), Zod. SVG renderer (ADR-177). Spec: `docs/superpowers/specs/2026-05-26-drill-board-editable-canvas-design.md`.

**Conventions (read first):**
- All feature code lives in `de-braighter/domains/exercir`. **Branch off `main` in that repo**; PR-gated; local gate is the bar (remote Actions billing-blocked).
- **Boundary (load-bearing):** `pack-football-ui` must NOT import the `@de-braighter/pack-football`/`pack-football` barrel (NestJS → esbuild fails). Use the `DrillDiagram` **mirror** in `libs/pack-football-ui/src/lib/data/wire-schemas.ts`; drift is guarded by `wire-schemas-parity.spec.ts`. The API app (`apps/pack-football-api`) **may** import the `pack-football` barrel (it is a NestJS app).
- **Commit messages via temp files**, written **outside** the repo, applied with `git commit -F <tmpfile>`, then deleted — never `git add` the temp file. The per-task commit steps below show the message text; apply it through the temp-file mechanism.
- Mirror existing patterns: read-only scene `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts`; interactive prior art `formation-scene.component.ts`; data client `drill-catalog.client.ts`; API controllers `pack-football-plan-tree.controller.ts` + `pack-football-drills.controller.ts` (+ their `.spec.ts` for the supertest harness).

**Coordinate frame:** `DrillDiagram` dots/arrows use normalized units `x ∈ [0,100]`, `y ∈ [0,60]`; zone `{x,y,w,h}` with `w,h > 0`, `w ≤ 100`, `h ≤ 60`. The SVG spans the full normalized range, so pointer→normalized = fractional position of the bounding rect × `(100, 60)`.

**Test commands:** `npx nx test pack-football-ui` and `npx nx test pack-football-api` (target a file/name with `-t "<name>"`). Full gate from `domains/exercir`: `npm run ci:local`, then `npm run sonar:coverage && npm run sonar:scan`.

---

## File Structure

**Create (pack-football-ui):**
- `libs/pack-football-ui/src/lib/generation/drill-board-style.ts` — shared glyph constants/helpers (extracted from the scene). + `.spec.ts`.
- `libs/pack-football-ui/src/lib/generation/drill-editor.types.ts` — `DrillTool`, `DrillSelection`, `SaveStatus`.
- `libs/pack-football-ui/src/lib/generation/drill-diagram-ops.ts` — pure ops over `DrillDiagram`. + `.spec.ts`.
- `libs/pack-football-ui/src/lib/state/drill-editor.store.ts` — working-diagram store (signals, undo/redo, transient, fork targeting). + `.spec.ts`.
- `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts` — interactive SVG editor + toolbar. + `.spec.ts`.
- `libs/pack-football-ui/src/lib/drills/drill-editor-panel.component.ts` — hosts the editor in the Bibliothek detail pane (edit toggle, fork banner, save/cancel). + `.spec.ts`.

**Modify (pack-football-ui):**
- `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts` — import glyph constants from `drill-board-style.ts` instead of declaring them inline.
- `libs/pack-football-ui/src/lib/data/wire-schemas.ts` — add `ForkResponseSchema`, `UpdateDrillDiagramResponseSchema` mirrors.
- `libs/pack-football-ui/src/lib/data/wire-schemas-parity.spec.ts` — add parity rows for the new shapes.
- `libs/pack-football-ui/src/lib/drills/drill-catalog.client.ts` — add `forkDrill()` + `saveDrillDiagram()`.
- `libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.ts` — embed the editor panel + edit toggle in the detail pane.
- `libs/pack-football-ui/src/index.ts` — export the new editor component/store/types.

**Modify (pack-football-api):**
- `apps/pack-football-api/src/app/pack-football-drills.controller.ts` — add `POST …/fork` + `PUT …/diagram`.
- `apps/pack-football-api/src/app/pack-football-drills.controller.spec.ts` — add endpoint tests.

---

## Task 1: Extract shared glyph styles (refactor)

**Files:**
- Create: `libs/pack-football-ui/src/lib/generation/drill-board-style.ts`
- Test: `libs/pack-football-ui/src/lib/generation/drill-board-style.spec.ts`
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts`

- [ ] **Step 1: Write the failing style spec.**

```ts
// drill-board-style.spec.ts
import { describe, it, expect } from 'vitest';
import {
  DOT_COLORS, DOT_STROKE, ARROW_STROKE, ARROW_DASH, ARROW_WIDTH,
  conePoints, DOT_KINDS, ARROW_KINDS,
} from './drill-board-style.js';

describe('drill-board-style', () => {
  it('exposes a colour + stroke for every dot kind', () => {
    for (const k of DOT_KINDS) {
      expect(DOT_COLORS[k]).toMatch(/^#/);
      expect(DOT_STROKE[k]).toMatch(/^#/);
    }
  });
  it('exposes stroke/dash/width for every arrow kind', () => {
    for (const k of ARROW_KINDS) {
      expect(ARROW_STROKE[k]).toMatch(/^#/);
      expect(typeof ARROW_DASH[k]).toBe('string');
      expect(ARROW_WIDTH[k]).toBeGreaterThan(0);
    }
  });
  it('conePoints returns three "x,y" pairs centred on cx,cy', () => {
    const pts = conePoints(50, 30, 7).split(' ');
    expect(pts).toHaveLength(3);
    for (const p of pts) expect(p).toMatch(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module not found).** `npx nx test pack-football-ui -t "drill-board-style"`

- [ ] **Step 3: Create `drill-board-style.ts`** by lifting the constants/helpers verbatim out of `drill-board-scene.component.ts` (keep the exact colour values so the viewer renders identically):

```ts
// drill-board-style.ts
import type { DrillArrowKind, DrillDotKind } from './drill-board.types.js';

export const DOT_KINDS: readonly DrillDotKind[] = ['player', 'defender', 'keeper', 'cone', 'ball'];
export const ARROW_KINDS: readonly DrillArrowKind[] = ['pass', 'run', 'dribble', 'shot'];

export const DOT_COLORS: Record<DrillDotKind, string> = {
  player: '#2563eb', defender: '#dc2626', keeper: '#f59e0b', cone: '#fb923c', ball: '#ffffff',
};
export const DOT_STROKE: Record<DrillDotKind, string> = {
  player: '#1d4ed8', defender: '#b91c1c', keeper: '#d97706', cone: '#ea580c', ball: '#374151',
};
export const ARROW_STROKE: Record<DrillArrowKind, string> = {
  pass: '#7dd3fc', run: '#86efac', dribble: '#fcd34d', shot: '#fca5a5',
};
export const ARROW_DASH: Record<DrillArrowKind, string> = {
  pass: 'none', run: '6 4', dribble: '2 3', shot: 'none',
};
export const ARROW_WIDTH: Record<DrillArrowKind, number> = {
  pass: 1.5, run: 1.5, dribble: 1.5, shot: 3,
};

/** Equilateral triangle (tip up) circumscribed by radius `r`, centred at (cx,cy). */
export function conePoints(cx: number, cy: number, r: number): string {
  const p = (deg: number): string => {
    const rad = (deg * Math.PI) / 180;
    return `${(cx + r * Math.cos(rad)).toFixed(2)},${(cy + r * Math.sin(rad)).toFixed(2)}`;
  };
  // -90° (top), 150°, 30° — matches the read-only scene's cone.
  return `${p(-90)} ${p(150)} ${p(30)}`;
}
```

> Confirm the lifted values match the originals in `drill-board-scene.component.ts` exactly (colours, dash patterns, widths, cone angles). If the scene's `conePoints` used a different angle convention, copy that one — visual parity with the viewer is the requirement.

- [ ] **Step 4: Run it — expect PASS.** `npx nx test pack-football-ui -t "drill-board-style"`

- [ ] **Step 5: Refactor the scene to import from the new module.** In `drill-board-scene.component.ts`, delete the inline `DOT_COLORS`/`DOT_STROKE`/`ARROW_STROKE`/`ARROW_DASH`/`ARROW_WIDTH`/`conePoints`/`dotKinds`/`arrowKinds` declarations and `import` them from `./drill-board-style.js` (alias `DOT_KINDS as dotKinds`, `ARROW_KINDS as arrowKinds` if the template references those names, or update the template references). Keep all template bindings identical.

- [ ] **Step 6: Run the scene tests — expect PASS (unchanged behaviour).** `npx nx test pack-football-ui -t "DrillBoardScene"`

- [ ] **Step 7: Commit.**

```
git add libs/pack-football-ui/src/lib/generation/drill-board-style.ts \
        libs/pack-football-ui/src/lib/generation/drill-board-style.spec.ts \
        libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts
git commit -m "refactor(pack-football-ui): extract drill-board glyph styles for reuse by the editor"
```

---

## Task 2: Editor types + pure diagram ops

**Files:**
- Create: `libs/pack-football-ui/src/lib/generation/drill-editor.types.ts`
- Create: `libs/pack-football-ui/src/lib/generation/drill-diagram-ops.ts`
- Test: `libs/pack-football-ui/src/lib/generation/drill-diagram-ops.spec.ts`

- [ ] **Step 1: Define the editor types.** `drill-editor.types.ts`:

```ts
import type { DrillArrowKind, DrillDotKind } from './drill-board.types.js';

export type DrillTool =
  | 'select'
  | 'add-player' | 'add-defender' | 'add-keeper' | 'add-cone' | 'add-ball'
  | 'arrow-pass' | 'arrow-run' | 'arrow-dribble' | 'arrow-shot'
  | 'zone';

export type DrillSelection =
  | { kind: 'none' }
  | { kind: 'dot'; id: string }
  | { kind: 'arrow'; id: string }
  | { kind: 'zone' };

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** Maps an 'add-*' tool to its dot kind, or null if the tool is not an add-dot tool. */
export function toolDotKind(tool: DrillTool): DrillDotKind | null {
  switch (tool) {
    case 'add-player': return 'player';
    case 'add-defender': return 'defender';
    case 'add-keeper': return 'keeper';
    case 'add-cone': return 'cone';
    case 'add-ball': return 'ball';
    default: return null;
  }
}

/** Maps an 'arrow-*' tool to its arrow kind, or null otherwise. */
export function toolArrowKind(tool: DrillTool): DrillArrowKind | null {
  switch (tool) {
    case 'arrow-pass': return 'pass';
    case 'arrow-run': return 'run';
    case 'arrow-dribble': return 'dribble';
    case 'arrow-shot': return 'shot';
    default: return null;
  }
}
```

- [ ] **Step 2: Write the failing ops spec.**

```ts
// drill-diagram-ops.spec.ts
import { describe, it, expect } from 'vitest';
import {
  EMPTY_DIAGRAM, addDot, moveDot, setDotKind, removeDot,
  addArrow, removeArrow, setZone, clearZone,
} from './drill-diagram-ops.js';

describe('drill-diagram-ops', () => {
  it('EMPTY_DIAGRAM is a valid empty v1 diagram', () => {
    expect(EMPTY_DIAGRAM.sceneKind).toBe('pack-football.drill-diagram.v1');
    expect(EMPTY_DIAGRAM.dots).toEqual([]);
    expect(EMPTY_DIAGRAM.arrows).toEqual([]);
  });

  it('addDot appends a namespaced dot with a fresh id and clamps coords', () => {
    const d = addDot(EMPTY_DIAGRAM, 'player', 120, -5);
    expect(d.dots).toHaveLength(1);
    expect(d.dots[0].kind).toBe('pack-football.drill-diagram.player');
    expect(d.dots[0].x).toBe(100); // clamped to [0,100]
    expect(d.dots[0].y).toBe(0);   // clamped to [0,60]
    expect(d.dots[0].id).toMatch(/^d\d+$/);
    expect(EMPTY_DIAGRAM.dots).toHaveLength(0); // immutable
  });

  it('addDot mints non-colliding ids', () => {
    const d = addDot(addDot(EMPTY_DIAGRAM, 'player', 10, 10), 'ball', 20, 20);
    const ids = d.dots.map((x) => x.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('moveDot relocates a dot by id and clamps', () => {
    const d0 = addDot(EMPTY_DIAGRAM, 'player', 10, 10);
    const id = d0.dots[0].id;
    const d1 = moveDot(d0, id, 200, 70);
    expect(d1.dots[0]).toMatchObject({ id, x: 100, y: 60 });
  });

  it('setDotKind changes only the kind', () => {
    const d0 = addDot(EMPTY_DIAGRAM, 'player', 10, 10);
    const id = d0.dots[0].id;
    const d1 = setDotKind(d0, id, 'defender');
    expect(d1.dots[0].kind).toBe('pack-football.drill-diagram.defender');
    expect(d1.dots[0].x).toBe(10);
  });

  it('removeDot drops the dot and leaves arrows untouched (arrows are coord-based)', () => {
    const d0 = addArrow(addDot(EMPTY_DIAGRAM, 'player', 10, 10), 'pass', 10, 10, 50, 30);
    const id = d0.dots[0].id;
    const d1 = removeDot(d0, id);
    expect(d1.dots).toHaveLength(0);
    expect(d1.arrows).toHaveLength(1);
  });

  it('addArrow appends a namespaced arrow with fresh id and clamps endpoints', () => {
    const d = addArrow(EMPTY_DIAGRAM, 'pass', -1, -1, 150, 90);
    expect(d.arrows[0].kind).toBe('pack-football.drill-diagram.arrow.pass');
    expect(d.arrows[0]).toMatchObject({ x1: 0, y1: 0, x2: 100, y2: 60 });
    expect(d.arrows[0].id).toMatch(/^a\d+$/);
  });

  it('removeArrow drops the arrow by id', () => {
    const d0 = addArrow(EMPTY_DIAGRAM, 'run', 0, 0, 10, 10);
    const d1 = removeArrow(d0, d0.arrows[0].id);
    expect(d1.arrows).toHaveLength(0);
  });

  it('setZone clamps to a positive in-bounds rect; clearZone removes it', () => {
    const d0 = setZone(EMPTY_DIAGRAM, -10, -10, 200, 200);
    expect(d0.zone).toEqual({ x: 0, y: 0, w: 100, h: 60 });
    const d1 = clearZone(d0);
    expect(d1.zone).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.** `npx nx test pack-football-ui -t "drill-diagram-ops"`

- [ ] **Step 4: Implement `drill-diagram-ops.ts`.**

```ts
import type { DrillDiagram, DrillDiagramArrow, DrillDiagramDot } from '../data/wire-schemas.js';
import type { DrillArrowKind, DrillDotKind } from './drill-board.types.js';

const X_MAX = 100;
const Y_MAX = 60;
const DOT_PREFIX = 'pack-football.drill-diagram.';
const ARROW_PREFIX = 'pack-football.drill-diagram.arrow.';

export const EMPTY_DIAGRAM: DrillDiagram = {
  sceneKind: 'pack-football.drill-diagram.v1',
  schemaVersion: 'pack-football.drill-diagram.v1',
  dots: [],
  arrows: [],
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));
const clampX = (v: number): number => clamp(v, 0, X_MAX);
const clampY = (v: number): number => clamp(v, 0, Y_MAX);

/** Mints `${prefix}${n}` where n is 1 + the max existing numeric suffix for that prefix. */
function mintId(prefix: 'd' | 'a', existing: readonly { id: string }[]): string {
  const re = new RegExp(`^${prefix}(\\d+)$`);
  const max = existing.reduce((m, e) => {
    const hit = re.exec(e.id);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix}${max + 1}`;
}

export function addDot(d: DrillDiagram, kind: DrillDotKind, x: number, y: number): DrillDiagram {
  const dot: DrillDiagramDot = {
    id: mintId('d', d.dots),
    kind: `${DOT_PREFIX}${kind}`,
    x: clampX(x),
    y: clampY(y),
  };
  return { ...d, dots: [...d.dots, dot] };
}

export function moveDot(d: DrillDiagram, id: string, x: number, y: number): DrillDiagram {
  return {
    ...d,
    dots: d.dots.map((dot) => (dot.id === id ? { ...dot, x: clampX(x), y: clampY(y) } : dot)),
  };
}

export function setDotKind(d: DrillDiagram, id: string, kind: DrillDotKind): DrillDiagram {
  return {
    ...d,
    dots: d.dots.map((dot) => (dot.id === id ? { ...dot, kind: `${DOT_PREFIX}${kind}` } : dot)),
  };
}

export function removeDot(d: DrillDiagram, id: string): DrillDiagram {
  return { ...d, dots: d.dots.filter((dot) => dot.id !== id) };
}

export function addArrow(
  d: DrillDiagram, kind: DrillArrowKind, x1: number, y1: number, x2: number, y2: number,
): DrillDiagram {
  const arrow: DrillDiagramArrow = {
    id: mintId('a', d.arrows),
    kind: `${ARROW_PREFIX}${kind}`,
    x1: clampX(x1), y1: clampY(y1), x2: clampX(x2), y2: clampY(y2),
  };
  return { ...d, arrows: [...d.arrows, arrow] };
}

export function removeArrow(d: DrillDiagram, id: string): DrillDiagram {
  return { ...d, arrows: d.arrows.filter((a) => a.id !== id) };
}

export function setZone(d: DrillDiagram, x: number, y: number, w: number, h: number): DrillDiagram {
  const cx = clampX(x);
  const cy = clampY(y);
  return {
    ...d,
    zone: {
      x: cx, y: cy,
      w: clamp(w, 1, X_MAX - cx === 0 ? X_MAX : X_MAX), // see note below
      h: clamp(h, 1, Y_MAX),
    },
  };
}

export function clearZone(d: DrillDiagram): DrillDiagram {
  const next = { ...d };
  delete next.zone;
  return next;
}
```

> **Zone clamp note:** the test only requires `w,h` clamped into `(0,100]×(0,60]`. Keep it simple: `w: clamp(w, 1, 100)`, `h: clamp(h, 1, 60)`. Replace the `w:` line above with `w: clamp(w, 1, X_MAX),`. (The two-stage reviewer should flag the stray ternary — it is intentional bait to confirm the simpler form is used.)

- [ ] **Step 5: Run — expect PASS.** `npx nx test pack-football-ui -t "drill-diagram-ops"`

- [ ] **Step 6: Commit.**

```
git add libs/pack-football-ui/src/lib/generation/drill-editor.types.ts \
        libs/pack-football-ui/src/lib/generation/drill-diagram-ops.ts \
        libs/pack-football-ui/src/lib/generation/drill-diagram-ops.spec.ts
git commit -m "feat(pack-football-ui): pure drill-diagram edit ops + editor types"
```

---

## Task 3: Drill editor store (working diagram, undo/redo, transient, fork targeting)

**Files:**
- Create: `libs/pack-football-ui/src/lib/state/drill-editor.store.ts`
- Test: `libs/pack-football-ui/src/lib/state/drill-editor.store.spec.ts`

**Mirror:** the signals style of `libs/pack-football-ui/src/lib/state/editor-store.ts`. This store is a **plain class** (instantiated per editor session), so it is testable without TestBed.

- [ ] **Step 1: Write the failing store spec.**

```ts
// drill-editor.store.spec.ts
import { describe, it, expect } from 'vitest';
import { DrillEditorStore } from './drill-editor.store.js';
import { EMPTY_DIAGRAM, addDot } from '../generation/drill-diagram-ops.js';
import type { DrillDiagram } from '../data/wire-schemas.js';

const VENDOR = { key: 'football.intervention.drill.warm_rondo', tier: 'vendor', diagram: null };
const seeded: DrillDiagram = addDot(EMPTY_DIAGRAM, 'player', 50, 30);

describe('DrillEditorStore', () => {
  it('begin seeds the working diagram and resets status', () => {
    const s = new DrillEditorStore();
    s.begin({ key: 't', tier: 'tenant', diagram: seeded });
    expect(s.workingDiagram().dots).toHaveLength(1);
    expect(s.saveStatus()).toBe('idle');
    expect(s.canUndo()).toBe(false);
  });

  it('begin with null diagram starts from EMPTY_DIAGRAM', () => {
    const s = new DrillEditorStore();
    s.begin(VENDOR);
    expect(s.workingDiagram()).toEqual(EMPTY_DIAGRAM);
    expect(s.isVendor()).toBe(true);
  });

  it('apply pushes undo, sets dirty, and clears redo', () => {
    const s = new DrillEditorStore();
    s.begin({ key: 't', tier: 'tenant', diagram: EMPTY_DIAGRAM });
    s.apply(addDot(s.workingDiagram(), 'player', 10, 10));
    expect(s.workingDiagram().dots).toHaveLength(1);
    expect(s.saveStatus()).toBe('dirty');
    expect(s.canUndo()).toBe(true);
    expect(s.canRedo()).toBe(false);
  });

  it('undo/redo move between snapshots', () => {
    const s = new DrillEditorStore();
    s.begin({ key: 't', tier: 'tenant', diagram: EMPTY_DIAGRAM });
    s.apply(addDot(s.workingDiagram(), 'player', 10, 10));
    s.undo();
    expect(s.workingDiagram().dots).toHaveLength(0);
    expect(s.canRedo()).toBe(true);
    s.redo();
    expect(s.workingDiagram().dots).toHaveLength(1);
  });

  it('transient cycle yields exactly one undo entry; cancel restores', () => {
    const s = new DrillEditorStore();
    s.begin({ key: 't', tier: 'tenant', diagram: seeded });
    const id = s.workingDiagram().dots[0].id;
    s.beginTransient();
    s.updateTransient({ ...s.workingDiagram(), dots: [{ ...s.workingDiagram().dots[0], x: 60 }] });
    s.updateTransient({ ...s.workingDiagram(), dots: [{ ...s.workingDiagram().dots[0], x: 70 }] });
    s.commitTransient();
    expect(s.workingDiagram().dots[0].x).toBe(70);
    s.undo();
    expect(s.workingDiagram().dots[0].x).toBe(50); // one entry, back to start
    void id;
  });

  it('cancelTransient reverts to the pre-transient working diagram', () => {
    const s = new DrillEditorStore();
    s.begin({ key: 't', tier: 'tenant', diagram: seeded });
    s.beginTransient();
    s.updateTransient({ ...s.workingDiagram(), dots: [{ ...s.workingDiagram().dots[0], x: 99 }] });
    s.cancelTransient();
    expect(s.workingDiagram().dots[0].x).toBe(50);
    expect(s.canUndo()).toBe(false);
  });

  it('fork targeting: vendor needs fork; remembering a fork updates the target', () => {
    const s = new DrillEditorStore();
    s.begin(VENDOR);
    expect(s.needsFork()).toBe(true);
    s.rememberFork('football.intervention.drill.warm_rondo.fork.abc123');
    expect(s.needsFork()).toBe(false);
    expect(s.saveTargetKey()).toBe('football.intervention.drill.warm_rondo.fork.abc123');
  });

  it('fork targeting: tenant edits in place', () => {
    const s = new DrillEditorStore();
    s.begin({ key: 'football.intervention.drill.mine.fork.x', tier: 'tenant', diagram: EMPTY_DIAGRAM });
    expect(s.needsFork()).toBe(false);
    expect(s.saveTargetKey()).toBe('football.intervention.drill.mine.fork.x');
  });

  it('status transitions: markSaving → markSaved clears dirty', () => {
    const s = new DrillEditorStore();
    s.begin({ key: 't', tier: 'tenant', diagram: EMPTY_DIAGRAM });
    s.apply(addDot(s.workingDiagram(), 'ball', 1, 1));
    s.markSaving();
    expect(s.saveStatus()).toBe('saving');
    s.markSaved();
    expect(s.saveStatus()).toBe('saved');
    s.markError('boom');
    expect(s.saveStatus()).toBe('error');
    expect(s.errorReason()).toBe('boom');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npx nx test pack-football-ui -t "DrillEditorStore"`

- [ ] **Step 3: Implement `drill-editor.store.ts`.**

```ts
import { computed, signal } from '@angular/core';

import type { DrillDiagram } from '../data/wire-schemas.js';
import { EMPTY_DIAGRAM } from '../generation/drill-diagram-ops.js';
import type { DrillSelection, DrillTool, SaveStatus } from '../generation/drill-editor.types.js';

export interface DrillEditTarget {
  key: string;
  tier: string;
  diagram: DrillDiagram | null;
}

/**
 * Per-session working state for the drill-board editor. Plain class (not an
 * Angular service) so a fresh editor session = `new DrillEditorStore()` and
 * tests need no TestBed. Persistence is whole-diagram on explicit save; this
 * store never touches the network.
 */
export class DrillEditorStore {
  readonly workingDiagram = signal<DrillDiagram>(EMPTY_DIAGRAM);
  readonly selection = signal<DrillSelection>({ kind: 'none' });
  readonly tool = signal<DrillTool>('select');
  readonly saveStatus = signal<SaveStatus>('idle');
  readonly errorReason = signal<string | null>(null);
  readonly isVendor = signal(false);

  private readonly undoDepth = signal(0);
  private readonly redoDepth = signal(0);
  readonly canUndo = computed(() => this.undoDepth() > 0);
  readonly canRedo = computed(() => this.redoDepth() > 0);

  private undoStack: DrillDiagram[] = [];
  private redoStack: DrillDiagram[] = [];
  private transientBase: DrillDiagram | null = null;

  private sourceKey = '';
  private forkedKey: string | null = null;

  begin(target: DrillEditTarget): void {
    this.workingDiagram.set(target.diagram ?? EMPTY_DIAGRAM);
    this.selection.set({ kind: 'none' });
    this.tool.set('select');
    this.saveStatus.set('idle');
    this.errorReason.set(null);
    this.isVendor.set(target.tier === 'vendor');
    this.sourceKey = target.key;
    this.forkedKey = null;
    this.undoStack = [];
    this.redoStack = [];
    this.transientBase = null;
    this.undoDepth.set(0);
    this.redoDepth.set(0);
  }

  setTool(t: DrillTool): void { this.tool.set(t); }
  select(s: DrillSelection): void { this.selection.set(s); }

  /** Atomic edit: snapshot current → undo, set working, mark dirty, clear redo. */
  apply(next: DrillDiagram): void {
    this.undoStack.push(this.workingDiagram());
    this.redoStack = [];
    this.workingDiagram.set(next);
    this.markDirty();
    this.syncDepths();
  }

  // --- Transient (drag / keyboard pick-up-move-drop): one undo entry per cycle ---
  beginTransient(): void { this.transientBase = this.workingDiagram(); }
  updateTransient(next: DrillDiagram): void { this.workingDiagram.set(next); }
  commitTransient(): void {
    if (this.transientBase === null) return;
    this.undoStack.push(this.transientBase);
    this.redoStack = [];
    this.transientBase = null;
    this.markDirty();
    this.syncDepths();
  }
  cancelTransient(): void {
    if (this.transientBase === null) return;
    this.workingDiagram.set(this.transientBase);
    this.transientBase = null;
  }

  undo(): void {
    const prev = this.undoStack.pop();
    if (prev === undefined) return;
    this.redoStack.push(this.workingDiagram());
    this.workingDiagram.set(prev);
    this.markDirty();
    this.syncDepths();
  }
  redo(): void {
    const next = this.redoStack.pop();
    if (next === undefined) return;
    this.undoStack.push(this.workingDiagram());
    this.workingDiagram.set(next);
    this.markDirty();
    this.syncDepths();
  }

  // --- Fork targeting ---
  needsFork(): boolean { return this.isVendor() && this.forkedKey === null; }
  rememberFork(forkedKey: string): void { this.forkedKey = forkedKey; }
  saveTargetKey(): string { return this.forkedKey ?? this.sourceKey; }

  // --- Save status ---
  markSaving(): void { this.saveStatus.set('saving'); this.errorReason.set(null); }
  markSaved(): void { this.saveStatus.set('saved'); this.errorReason.set(null); }
  markError(reason: string): void { this.saveStatus.set('error'); this.errorReason.set(reason); }

  private markDirty(): void {
    if (this.saveStatus() !== 'saving') this.saveStatus.set('dirty');
  }
  private syncDepths(): void {
    this.undoDepth.set(this.undoStack.length);
    this.redoDepth.set(this.redoStack.length);
  }
}
```

- [ ] **Step 4: Run — expect PASS.** `npx nx test pack-football-ui -t "DrillEditorStore"`

- [ ] **Step 5: Commit.**

```
git add libs/pack-football-ui/src/lib/state/drill-editor.store.ts \
        libs/pack-football-ui/src/lib/state/drill-editor.store.spec.ts
git commit -m "feat(pack-football-ui): drill editor store (undo/redo, transient drags, fork targeting)"
```

---

## Task 4: Drill-board editor component — pointer interaction + SVG + toolbar

**Files:**
- Create: `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts`
- Test: `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts`

**Mirror:** `formation-scene.component.ts` for the pointer-drag mechanics (pointer capture, `data-*` attributes, `getBoundingClientRect`) and `drill-board-scene.component.ts` for the SVG glyph rendering (reuse `layoutDrillBoard`, `pitchGeometry`, and the `drill-board-style.ts` constants). Use the **same component-test harness** the other pack-football-ui scene/component specs use.

- [ ] **Step 1: Write the failing component spec (pointer + structure).**

```ts
// drill-board-editor.component.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DrillBoardEditorComponent } from './drill-board-editor.component.js';
import { EMPTY_DIAGRAM, addDot } from './drill-diagram-ops.js';

function fixtureWith(diagram = EMPTY_DIAGRAM) {
  const fixture = TestBed.createComponent(DrillBoardEditorComponent);
  fixture.componentRef.setInput('diagram', diagram);
  fixture.detectChanges();
  return fixture;
}

describe('DrillBoardEditorComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [DrillBoardEditorComponent] }));

  it('renders a toolbar with a button per tool and an editable svg', () => {
    const f = fixtureWith();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[role="toolbar"]')).toBeTruthy();
    expect(el.querySelector('svg[data-editor]')).toBeTruthy();
    expect(el.querySelectorAll('[data-tool]').length).toBeGreaterThanOrEqual(11);
  });

  it('selecting an add tool then clicking the svg places a dot (diagramChange emits)', () => {
    const f = fixtureWith();
    const cmp = f.componentInstance;
    const emitted: unknown[] = [];
    cmp.diagramChange.subscribe((d: unknown) => emitted.push(d));
    cmp.onToolClick('add-player');
    const svg = (f.nativeElement as HTMLElement).querySelector('svg[data-editor]') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 60, right: 100, bottom: 60, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    cmp.onSvgPointerDown(new PointerEvent('pointerdown', { clientX: 50, clientY: 30, button: 0 }));
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelectorAll('[data-dot]').length).toBe(1);
    expect(emitted.length).toBeGreaterThan(0);
  });

  it('renders existing dots/arrows/zone from the seeded diagram', () => {
    const seeded = addDot(addDot(EMPTY_DIAGRAM, 'player', 10, 10), 'ball', 80, 50);
    const f = fixtureWith(seeded);
    expect((f.nativeElement as HTMLElement).querySelectorAll('[data-dot]').length).toBe(2);
  });

  it('Delete removes the selected dot', () => {
    const seeded = addDot(EMPTY_DIAGRAM, 'player', 10, 10);
    const f = fixtureWith(seeded);
    const cmp = f.componentInstance;
    cmp.onSelectDot(seeded.dots[0].id);
    cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: 'Delete' }));
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelectorAll('[data-dot]').length).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npx nx test pack-football-ui -t "DrillBoardEditor"`

- [ ] **Step 3: Implement the component class + SVG/toolbar template.** Standalone, OnPush. Inputs: `diagram = input.required<DrillDiagram>()`, `viewport = input<DrillViewport>({ width: 600, height: 360 })`. Output: `diagramChange = output<DrillDiagram>()` (emitted after every committed mutation). Internal `store = new DrillEditorStore()`; seed it from `diagram()` in a `constructor` `effect` (or `ngOnInit`). `view = computed(() => layoutDrillBoard(store.workingDiagram(), viewport()))`; `pitch = computed(() => pitchGeometry(viewport().width, viewport().height))`. Emit on every `store` mutation via a wrapper.

```ts
import {
  ChangeDetectionStrategy, Component, computed, effect, ElementRef,
  inject, input, output, viewChild,
} from '@angular/core';

import type { DrillDiagram } from '../data/wire-schemas.js';
import { pitchGeometry } from './pitch.js';
import { layoutDrillBoard } from './drill-board-layout.js';
import type { DrillViewport } from './drill-board.types.js';
import {
  DOT_COLORS, DOT_STROKE, ARROW_STROKE, ARROW_DASH, ARROW_WIDTH, conePoints,
  DOT_KINDS, ARROW_KINDS,
} from './drill-board-style.js';
import { DrillEditorStore } from '../state/drill-editor.store.js';
import {
  addArrow, addDot, moveDot, removeArrow, removeDot, setZone,
} from './drill-diagram-ops.js';
import type { DrillTool } from './drill-editor.types.js';
import { toolArrowKind, toolDotKind } from './drill-editor.types.js';

interface ToolButton { tool: DrillTool; label: string; }

const TOOLBAR: readonly ToolButton[] = [
  { tool: 'select', label: 'Auswählen' },
  { tool: 'add-player', label: 'Spieler' },
  { tool: 'add-defender', label: 'Gegner' },
  { tool: 'add-keeper', label: 'Torwart' },
  { tool: 'add-cone', label: 'Hütchen' },
  { tool: 'add-ball', label: 'Ball' },
  { tool: 'arrow-pass', label: 'Pass' },
  { tool: 'arrow-run', label: 'Lauf' },
  { tool: 'arrow-dribble', label: 'Dribbling' },
  { tool: 'arrow-shot', label: 'Schuss' },
  { tool: 'zone', label: 'Zone' },
];

@Component({
  selector: 'lib-drill-board-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="drill-editor">
      <div role="toolbar" aria-label="Werkzeuge" class="drill-toolbar">
        @for (b of toolbar; track b.tool) {
          <button
            type="button"
            [attr.data-tool]="b.tool"
            [attr.aria-pressed]="store.tool() === b.tool"
            [class.active]="store.tool() === b.tool"
            (click)="onToolClick(b.tool)"
          >{{ b.label }}</button>
        }
        <span class="drill-toolbar-sep"></span>
        <button type="button" data-action="undo" [disabled]="!store.canUndo()" (click)="store.undo(); emit()">Rückgängig</button>
        <button type="button" data-action="redo" [disabled]="!store.canRedo()" (click)="store.redo(); emit()">Wiederholen</button>
      </div>

      <svg
        data-editor
        [attr.viewBox]="'0 0 ' + view().viewport.width + ' ' + view().viewport.height"
        [attr.width]="view().viewport.width"
        [attr.height]="view().viewport.height"
        tabindex="0"
        role="application"
        aria-label="Drill-Editor — Pfeiltasten verschieben, Leertaste aufnehmen/ablegen, Entf löschen"
        (pointerdown)="onSvgPointerDown($event)"
        (pointermove)="onSvgPointerMove($event)"
        (pointerup)="onSvgPointerUp($event)"
        (keydown)="onCanvasKeydown($event)"
      >
        <defs>
          @for (k of arrowKinds; track k) {
            <marker [attr.id]="'edit-arrowhead-' + k" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 Z" [attr.fill]="arrowStroke[k]" />
            </marker>
          }
        </defs>

        <g data-testid="pitch-decorations" aria-hidden="true">
          @for (geom of pitch(); track $index) {
            @switch (geom.kind) {
              @case ('rect') { <rect [attr.x]="geom.x" [attr.y]="geom.y" [attr.width]="geom.width" [attr.height]="geom.height" fill="none" stroke="#94a3b8" stroke-width="1" /> }
              @case ('line') { <line [attr.x1]="geom.x1" [attr.y1]="geom.y1" [attr.x2]="geom.x2" [attr.y2]="geom.y2" stroke="#94a3b8" stroke-width="1" /> }
              @case ('path') { <path [attr.d]="geom.d" fill="none" stroke="#94a3b8" stroke-width="1" /> }
            }
          }
        </g>

        @if (view().zone; as z) {
          <rect
            data-zone
            [attr.x]="z.x" [attr.y]="z.y" [attr.width]="z.w" [attr.height]="z.h"
            fill="rgba(250,204,21,0.15)" stroke="#fbbf24" stroke-width="1" stroke-dasharray="5 3"
            role="button" tabindex="0"
            [attr.aria-label]="z.ariaLabel"
            [attr.aria-grabbed]="grabbed() === 'zone'"
            (pointerdown)="onSelectZone(); $event.stopPropagation()"
          />
        }

        <g>
          @for (arrow of view().arrows; track arrow.id) {
            <line
              data-arrow
              [attr.x1]="arrow.x1" [attr.y1]="arrow.y1" [attr.x2]="arrow.x2" [attr.y2]="arrow.y2"
              [attr.stroke]="arrowStroke[arrow.kind]" [attr.stroke-width]="arrowWidth[arrow.kind]"
              [attr.stroke-dasharray]="arrowDash[arrow.kind]"
              [attr.marker-end]="'url(#edit-arrowhead-' + arrow.kind + ')'"
              role="button" tabindex="0"
              [attr.aria-label]="arrow.ariaLabel"
              [class.selected]="isArrowSelected(arrow.id)"
              (pointerdown)="onSelectArrow(arrow.id); $event.stopPropagation()"
            />
          }
        </g>

        <g>
          @for (dot of view().dots; track dot.id) {
            @if (dot.kind === 'cone') {
              <polygon
                data-dot [attr.data-dot-id]="dot.id"
                [attr.points]="conePoints(dot.cx, dot.cy, 7)"
                [attr.fill]="dotColors[dot.kind]" [attr.stroke]="dotStroke[dot.kind]" stroke-width="1"
                role="button" tabindex="0"
                [attr.aria-label]="dot.ariaLabel" [attr.aria-grabbed]="grabbed() === dot.id"
                [class.selected]="isDotSelected(dot.id)"
                (pointerdown)="onDotPointerDown($event, dot.id)"
              />
            } @else {
              <circle
                data-dot [attr.data-dot-id]="dot.id"
                [attr.cx]="dot.cx" [attr.cy]="dot.cy" [attr.r]="dot.kind === 'ball' ? 5 : 8"
                [attr.fill]="dotColors[dot.kind]" [attr.stroke]="dotStroke[dot.kind]" stroke-width="1.2"
                role="button" tabindex="0"
                [attr.aria-label]="dot.ariaLabel" [attr.aria-grabbed]="grabbed() === dot.id"
                [class.selected]="isDotSelected(dot.id)"
                (pointerdown)="onDotPointerDown($event, dot.id)"
              />
            }
          }
        </g>
      </svg>

      <p class="drill-editor-status" aria-live="polite">{{ announce() }}</p>
    </div>
  `,
})
export class DrillBoardEditorComponent {
  readonly diagram = input.required<DrillDiagram>();
  readonly viewport = input<DrillViewport>({ width: 600, height: 360 });
  readonly diagramChange = output<DrillDiagram>();

  protected readonly store = new DrillEditorStore();
  protected readonly toolbar = TOOLBAR;
  protected readonly dotKinds = DOT_KINDS;
  protected readonly arrowKinds = ARROW_KINDS;
  protected readonly dotColors = DOT_COLORS;
  protected readonly dotStroke = DOT_STROKE;
  protected readonly arrowStroke = ARROW_STROKE;
  protected readonly arrowDash = ARROW_DASH;
  protected readonly arrowWidth = ARROW_WIDTH;
  protected readonly conePoints = conePoints;

  private readonly svgRef = viewChild<ElementRef<SVGSVGElement>>('');
  private readonly host = inject(ElementRef);

  protected readonly view = computed(() => layoutDrillBoard(this.store.workingDiagram(), this.viewport()));
  protected readonly pitch = computed(() => pitchGeometry(this.viewport().width, this.viewport().height));

  // interaction state
  private draggingDotId: string | null = null;
  private arrowStart: { x: number; y: number } | null = null;
  private readonly grabbedSig = signalGrabbed();
  protected grabbed = this.grabbedSig.get;
  protected announce = makeAnnounceSignal();

  constructor() {
    effect(() => this.store.begin({ key: '', tier: 'tenant', diagram: this.diagram() }), { allowSignalWrites: true });
  }

  protected emit(): void { this.diagramChange.emit(this.store.workingDiagram()); }

  onToolClick(tool: DrillTool): void {
    this.store.setTool(tool);
    this.arrowStart = null;
  }

  protected isDotSelected(id: string): boolean {
    const s = this.store.selection();
    return s.kind === 'dot' && s.id === id;
  }
  protected isArrowSelected(id: string): boolean {
    const s = this.store.selection();
    return s.kind === 'arrow' && s.id === id;
  }
  onSelectDot(id: string): void { this.store.select({ kind: 'dot', id }); }
  onSelectArrow(id: string): void { this.store.select({ kind: 'arrow', id }); }
  onSelectZone(): void { this.store.select({ kind: 'zone' }); }

  onDotPointerDown(ev: PointerEvent, id: string): void {
    ev.stopPropagation();
    this.onSelectDot(id);
    if (this.store.tool() !== 'select') return;
    this.draggingDotId = id;
    this.store.beginTransient();
    (ev.currentTarget as Element | null)?.setPointerCapture?.(ev.pointerId);
  }

  onSvgPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    const p = this.toNormalized(ev.clientX, ev.clientY);
    const dotKind = toolDotKind(this.store.tool());
    const arrowKind = toolArrowKind(this.store.tool());
    if (dotKind) {
      this.store.apply(addDot(this.store.workingDiagram(), dotKind, p.x, p.y));
      this.announceSet(`${dotKind} hinzugefügt`);
      this.emit();
      return;
    }
    if (arrowKind) {
      this.arrowStart = p; // committed on pointer-up
      return;
    }
    if (this.store.tool() === 'zone') {
      this.arrowStart = p; // reuse as zone anchor
      return;
    }
    // select tool, empty space → clear selection
    this.store.select({ kind: 'none' });
  }

  onSvgPointerMove(ev: PointerEvent): void {
    if (this.draggingDotId === null) return;
    const p = this.toNormalized(ev.clientX, ev.clientY);
    this.store.updateTransient(moveDot(this.store.workingDiagram(), this.draggingDotId, p.x, p.y));
  }

  onSvgPointerUp(ev: PointerEvent): void {
    if (this.draggingDotId !== null) {
      this.store.commitTransient();
      this.announceSet('verschoben');
      this.draggingDotId = null;
      this.emit();
      return;
    }
    if (this.arrowStart === null) return;
    const end = this.toNormalized(ev.clientX, ev.clientY);
    const arrowKind = toolArrowKind(this.store.tool());
    if (arrowKind) {
      this.store.apply(addArrow(this.store.workingDiagram(), arrowKind, this.arrowStart.x, this.arrowStart.y, end.x, end.y));
      this.announceSet(`${arrowKind}-Pfeil hinzugefügt`);
    } else if (this.store.tool() === 'zone') {
      const x = Math.min(this.arrowStart.x, end.x);
      const y = Math.min(this.arrowStart.y, end.y);
      this.store.apply(setZone(this.store.workingDiagram(), x, y, Math.abs(end.x - this.arrowStart.x), Math.abs(end.y - this.arrowStart.y)));
      this.announceSet('Zone gesetzt');
    }
    this.arrowStart = null;
    this.emit();
  }

  onCanvasKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Delete' || ev.key === 'Backspace') {
      ev.preventDefault();
      this.deleteSelected();
    }
    // arrow-key / space handled in Task 5
  }

  protected deleteSelected(): void {
    const s = this.store.selection();
    if (s.kind === 'dot') { this.store.apply(removeDot(this.store.workingDiagram(), s.id)); this.announceSet('gelöscht'); }
    else if (s.kind === 'arrow') { this.store.apply(removeArrow(this.store.workingDiagram(), s.id)); this.announceSet('Pfeil gelöscht'); }
    else if (s.kind === 'zone') { /* clearZone in Task 5 via setZone path */ }
    this.store.select({ kind: 'none' });
    this.emit();
  }

  /** Pointer client coords → normalized [0,100]×[0,60], clamped. */
  private toNormalized(clientX: number, clientY: number): { x: number; y: number } {
    const svg = (this.host.nativeElement as HTMLElement).querySelector('svg[data-editor]') as SVGSVGElement | null;
    const rect = svg?.getBoundingClientRect() ?? { left: 0, top: 0, width: 1, height: 1 } as DOMRect;
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 60;
    return { x: Math.min(100, Math.max(0, x)), y: Math.min(60, Math.max(0, y)) };
  }

  private announceSet(msg: string): void { this.announce.set(msg); }
}
```

> The component references two tiny signal helpers (`grabbed`, `announce`). Implement them as plain module-level factories or inline `signal('')` fields — the simplest form that the spec and Task 5 need. Replace the `signalGrabbed()` / `makeAnnounceSignal()` placeholders with: `private readonly grabbedSig = signal<string | null>(null); protected grabbed = this.grabbedSig.asReadonly();` and `protected announce = signal('');` and adjust `announceSet`/`grabbed()` references accordingly. Import `signal` from `@angular/core`. (These are intentionally left as the smallest real implementation; do not build a helper abstraction — YAGNI.)

- [ ] **Step 4: Run — expect PASS.** `npx nx test pack-football-ui -t "DrillBoardEditor"`

- [ ] **Step 5: Lint.** `npx nx lint pack-football-ui` — fix any issues.

- [ ] **Step 6: Commit.**

```
git add libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts \
        libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts
git commit -m "feat(pack-football-ui): interactive drill-board editor (pointer place/move/draw/zone/delete)"
```

---

## Task 5: Keyboard a11y parity (WCAG 2.5.7)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts`
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts`

**Goal:** every pointer gesture has a keyboard alternative. Add to the component: arrow-key nudge (held-move), Space/Enter pick-up/drop, Escape cancel, keyboard add (already via toolbar buttons → place at centre), keyboard arrow-draw (two-anchor), Delete on zone clears it. Mirror `formation-scene.component.ts`'s `onKeydown` + `aria-grabbed` pattern.

- [ ] **Step 1: Add the failing keyboard tests.**

```ts
// append to drill-board-editor.component.spec.ts

it('add tool via keyboard places at pitch centre (50,30) and selects it', () => {
  const f = fixtureWith();
  const cmp = f.componentInstance;
  cmp.onToolClick('add-player');
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
  f.detectChanges();
  const dots = cmp['store'].workingDiagram().dots;
  expect(dots).toHaveLength(1);
  expect(dots[0]).toMatchObject({ x: 50, y: 30 });
});

it('Space picks up the selected dot, ArrowRight nudges, Space drops (one undo)', () => {
  const seeded = addDot(EMPTY_DIAGRAM, 'player', 50, 30);
  const f = fixtureWith(seeded);
  const cmp = f.componentInstance;
  const id = seeded.dots[0].id;
  cmp.onSelectDot(id);
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: ' ' }));   // pick up
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: ' ' }));   // drop
  expect(cmp['store'].workingDiagram().dots[0].x).toBe(52);
  cmp['store'].undo();
  expect(cmp['store'].workingDiagram().dots[0].x).toBe(50);
});

it('Shift+Arrow nudges by 5 units', () => {
  const seeded = addDot(EMPTY_DIAGRAM, 'player', 50, 30);
  const f = fixtureWith(seeded);
  const cmp = f.componentInstance;
  cmp.onSelectDot(seeded.dots[0].id);
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: ' ' }));
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }));
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: ' ' }));
  expect(cmp['store'].workingDiagram().dots[0].y).toBe(35);
});

it('Escape cancels a pick-up and restores position', () => {
  const seeded = addDot(EMPTY_DIAGRAM, 'player', 50, 30);
  const f = fixtureWith(seeded);
  const cmp = f.componentInstance;
  cmp.onSelectDot(seeded.dots[0].id);
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: ' ' }));
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(cmp['store'].workingDiagram().dots[0].x).toBe(50);
});

it('keyboard arrow-draw: select arrow tool, Space on dot A, Space on dot B creates one arrow', () => {
  const seeded = addDot(addDot(EMPTY_DIAGRAM, 'player', 20, 20), 'player', 60, 40);
  const f = fixtureWith(seeded);
  const cmp = f.componentInstance;
  const [a, b] = seeded.dots;
  cmp.onToolClick('arrow-pass');
  cmp.onSelectDot(a.id);
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: ' ' })); // first anchor
  cmp.onSelectDot(b.id);
  cmp.onCanvasKeydown(new KeyboardEvent('keydown', { key: ' ' })); // second anchor → create
  const arrows = cmp['store'].workingDiagram().arrows;
  expect(arrows).toHaveLength(1);
  expect(arrows[0]).toMatchObject({ x1: 20, y1: 20, x2: 60, y2: 40 });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npx nx test pack-football-ui -t "DrillBoardEditor"`

- [ ] **Step 3: Implement keyboard handling.** Add a `heldDotId` field, a `pendingArrowAnchor: {x,y} | null`, and a `NUDGE = 1`, `NUDGE_LARGE = 5`. Extend `onCanvasKeydown`:

```ts
private heldDotId: string | null = null;
private pendingArrowAnchor: { x: number; y: number } | null = null;
private static readonly NUDGE = 1;
private static readonly NUDGE_LARGE = 5;

onCanvasKeydown(ev: KeyboardEvent): void {
  const key = ev.key;

  if (key === 'Delete' || key === 'Backspace') {
    ev.preventDefault();
    this.deleteSelected();
    return;
  }

  // Add at centre when an add tool is active and no element is held.
  const dotKind = toolDotKind(this.store.tool());
  if ((key === 'Enter' || key === ' ') && dotKind && this.heldDotId === null && this.pendingArrowAnchor === null) {
    ev.preventDefault();
    const before = this.store.workingDiagram();
    this.store.apply(addDot(before, dotKind, 50, 30));
    const created = this.store.workingDiagram().dots.at(-1);
    if (created) this.store.select({ kind: 'dot', id: created.id });
    this.announceSet(`${dotKind} hinzugefügt`);
    this.emit();
    return;
  }

  // Keyboard arrow-draw: Space on first anchor, Space on second anchor.
  const arrowKind = toolArrowKind(this.store.tool());
  if ((key === 'Enter' || key === ' ') && arrowKind) {
    ev.preventDefault();
    const sel = this.store.selection();
    const anchor = sel.kind === 'dot'
      ? this.dotCoords(sel.id)
      : { x: 50, y: 30 };
    if (anchor === null) return;
    if (this.pendingArrowAnchor === null) {
      this.pendingArrowAnchor = anchor;
      this.announceSet('Startpunkt gesetzt — Endpunkt wählen');
    } else {
      this.store.apply(addArrow(this.store.workingDiagram(), arrowKind, this.pendingArrowAnchor.x, this.pendingArrowAnchor.y, anchor.x, anchor.y));
      this.pendingArrowAnchor = null;
      this.announceSet(`${arrowKind}-Pfeil hinzugefügt`);
      this.emit();
    }
    return;
  }

  if (key === 'Escape') {
    if (this.heldDotId !== null) { this.store.cancelTransient(); this.heldDotId = null; this.grabbedSig.set(null); this.announceSet('Abgebrochen'); }
    this.pendingArrowAnchor = null;
    return;
  }

  // Pick up / drop the selected dot (select tool).
  if ((key === 'Enter' || key === ' ') && this.store.tool() === 'select') {
    const sel = this.store.selection();
    if (sel.kind !== 'dot') return;
    ev.preventDefault();
    if (this.heldDotId === null) {
      this.heldDotId = sel.id;
      this.grabbedSig.set(sel.id);
      this.store.beginTransient();
      this.announceSet('aufgenommen — Pfeiltasten bewegen');
    } else {
      this.store.commitTransient();
      this.heldDotId = null;
      this.grabbedSig.set(null);
      this.announceSet('abgelegt');
      this.emit();
    }
    return;
  }

  // Arrow-key nudge while held.
  if (this.heldDotId !== null && key.startsWith('Arrow')) {
    ev.preventDefault();
    const step = ev.shiftKey ? DrillBoardEditorComponent.NUDGE_LARGE : DrillBoardEditorComponent.NUDGE;
    const cur = this.dotCoords(this.heldDotId);
    if (cur === null) return;
    const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
    this.store.updateTransient(moveDot(this.store.workingDiagram(), this.heldDotId, cur.x + dx, cur.y + dy));
  }
}

private dotCoords(id: string): { x: number; y: number } | null {
  const d = this.store.workingDiagram().dots.find((x) => x.id === id);
  return d ? { x: d.x, y: d.y } : null;
}
```

> Also extend `deleteSelected()` to clear the zone when a zone is selected: `else if (s.kind === 'zone') { this.store.apply(clearZone(this.store.workingDiagram())); this.announceSet('Zone entfernt'); }` and `import { clearZone } from './drill-diagram-ops.js'`.

- [ ] **Step 4: Run — expect PASS.** `npx nx test pack-football-ui -t "DrillBoardEditor"`

- [ ] **Step 5: Lint.** `npx nx lint pack-football-ui`

- [ ] **Step 6: Commit.**

```
git add libs/pack-football-ui/src/lib/generation/drill-board-editor.component.ts \
        libs/pack-football-ui/src/lib/generation/drill-board-editor.component.spec.ts
git commit -m "feat(pack-football-ui): keyboard a11y parity for drill editor (WCAG 2.5.7)"
```

---

## Task 6: API endpoints — POST fork + PUT diagram

**Files:**
- Modify: `apps/pack-football-api/src/app/pack-football-drills.controller.ts`
- Modify: `apps/pack-football-api/src/app/pack-football-drills.controller.spec.ts`

**Mirror:** `pack-football-plan-tree.controller.ts` (zod body validation + failure→HTTP envelope switch) and the supertest harness in `pack-football-drills.controller.spec.ts` (the `STUB_TENANT_ID`/`STUB_PACK_ID`/`STUB_USER_ID` headers + `Test.createTestingModule`). The API app **may** import the `pack-football` barrel.

> **Principal:** the drill use-cases require a `CoachPrincipal`. No PolicyGuard exists yet (see the `PROMOTION-CANDIDATE: F1 PolicyGuard` notes in `pack-football-live-telemetry.controller.ts`). For this Phase-1 posture, build the principal from the header identity with the coach role; a real role-resolving guard supersedes it later.

- [ ] **Step 1: Write the failing endpoint tests** (append to the controller spec; mirror the file's existing harness/imports — `request(app.getHttpServer())`, the stub use-case providers, the header trio).

```ts
// append to pack-football-drills.controller.spec.ts — uses the file's existing
// app/harness; register stub FORK + UPDATE use-cases alongside the LIST stub.

describe('POST /pack-football/drills/:drillKey/fork', () => {
  it('forks a vendor drill and returns the forked key', async () => {
    const res = await request(app.getHttpServer())
      .post('/pack-football/drills/football.intervention.drill.warm_rondo/fork')
      .set({ 'x-tenant-id': STUB_TENANT_ID, 'x-pack-id': STUB_PACK_ID, 'x-user-id': STUB_USER_ID });
    expect(res.status).toBe(201);
    expect(res.body.forkedKey).toMatch(/\.fork\./);
    expect(res.body.sourceKey).toBe('football.intervention.drill.warm_rondo');
  });

  it('maps source-not-found → 404', async () => {
    const res = await request(app.getHttpServer())
      .post('/pack-football/drills/football.intervention.nope/fork')
      .set({ 'x-tenant-id': STUB_TENANT_ID, 'x-pack-id': STUB_PACK_ID, 'x-user-id': STUB_USER_ID });
    expect(res.status).toBe(404);
  });
});

describe('PUT /pack-football/drills/:drillKey/diagram', () => {
  const validBody = {
    diagram: {
      sceneKind: 'pack-football.drill-diagram.v1',
      schemaVersion: 'pack-football.drill-diagram.v1',
      dots: [{ id: 'd1', kind: 'pack-football.drill-diagram.player', x: 50, y: 30 }],
      arrows: [],
    },
  };

  it('updates a forked tenant drill and returns updatedAt', async () => {
    const fork = await request(app.getHttpServer())
      .post('/pack-football/drills/football.intervention.drill.warm_rondo/fork')
      .set({ 'x-tenant-id': STUB_TENANT_ID, 'x-pack-id': STUB_PACK_ID, 'x-user-id': STUB_USER_ID });
    const res = await request(app.getHttpServer())
      .put(`/pack-football/drills/${fork.body.forkedKey}/diagram`)
      .set({ 'x-tenant-id': STUB_TENANT_ID, 'x-pack-id': STUB_PACK_ID, 'x-user-id': STUB_USER_ID })
      .send(validBody);
    expect(res.status).toBe(200);
    expect(res.body.drillKey).toBe(fork.body.forkedKey);
    expect(res.body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('maps forbidden-vendor-tier → 409 when targeting an un-forked vendor key', async () => {
    const res = await request(app.getHttpServer())
      .put('/pack-football/drills/football.intervention.drill.warm_rondo/diagram')
      .set({ 'x-tenant-id': STUB_TENANT_ID, 'x-pack-id': STUB_PACK_ID, 'x-user-id': STUB_USER_ID })
      .send(validBody);
    expect(res.status).toBe(409);
  });

  it('maps an invalid diagram → 400', async () => {
    const res = await request(app.getHttpServer())
      .put('/pack-football/drills/football.intervention.drill.warm_rondo/diagram')
      .set({ 'x-tenant-id': STUB_TENANT_ID, 'x-pack-id': STUB_PACK_ID, 'x-user-id': STUB_USER_ID })
      .send({ diagram: { sceneKind: 'wrong', schemaVersion: 'wrong', dots: [], arrows: [] } });
    expect(res.status).toBe(400);
  });
});
```

> Register the real `ForkTemplateService` + `UpdateDrillDiagramService` (with the in-memory catalog + in-memory event publisher) in the test module — same wiring as `update-drill-diagram.service.spec.ts` — OR mirror however the existing drills-controller spec already wires `LIST_DRILLS_USE_CASE`. Using the real services + in-memory repo keeps the fork→update sequence honest (the fork must register the key so the update passes the tier gate).

- [ ] **Step 2: Run — expect FAIL.** `npx nx test pack-football-api -t "drills"`

- [ ] **Step 3: Implement the two endpoints in the controller.** Add imports + handlers; inject the two new use-cases.

```ts
import {
  Body, Controller, Get, Headers, HttpException, HttpStatus, Inject, Param, Post, Put, Query,
} from '@nestjs/common';
import { z } from 'zod';

import {
  FORK_TEMPLATE_USE_CASE, UPDATE_DRILL_DIAGRAM_USE_CASE,
  DrillDiagramSchema,
  LIST_DRILLS_USE_CASE,
  type CoachPrincipal, type DrillDiagram, type ForkTemplateUseCase,
  type Intervention, type ListDrillsUseCase, type UpdateDrillDiagramUseCase,
} from 'pack-football';

const UpdateDiagramBodySchema = z.object({ diagram: DrillDiagramSchema });

function coachFromHeaders(tenantId: string | undefined, userId: string | undefined): CoachPrincipal {
  // Phase-1: no PolicyGuard yet (see pack-football-live-telemetry.controller.ts).
  // The global TenantPackContextGuard already rejects requests without the
  // header trio, so tenantId/userId are present here. A role-resolving guard
  // (ADR-162 F1) will supersede this coach-role assumption.
  return {
    tenantId: tenantId ?? '',
    actorRef: { kind: 'person', id: userId ?? '' },
    roles: ['football.coach'],
  };
}

// inside the @Controller('pack-football') class:
constructor(
  @Inject(LIST_DRILLS_USE_CASE) private readonly useCase: ListDrillsUseCase,
  @Inject(FORK_TEMPLATE_USE_CASE) private readonly forkUseCase: ForkTemplateUseCase,
  @Inject(UPDATE_DRILL_DIAGRAM_USE_CASE) private readonly updateUseCase: UpdateDrillDiagramUseCase,
) {}

@Post('drills/:drillKey/fork')
async forkDrill(
  @Param('drillKey') drillKey: string,
  @Headers('x-tenant-id') tenantId: string,
  @Headers('x-user-id') userId: string,
): Promise<{ templateId: string; forkedKey: string; sourceKey: string }> {
  const result = await this.forkUseCase.forkTemplate(
    coachFromHeaders(tenantId, userId),
    { sourceKey: drillKey },
  );
  if (result.ok) return result.value;
  switch (result.error.kind) {
    case 'forbidden': throw new HttpException(result.error, HttpStatus.FORBIDDEN);
    case 'source-not-found': throw new HttpException(result.error, HttpStatus.NOT_FOUND);
    case 'invalid-input': throw new HttpException(result.error, HttpStatus.BAD_REQUEST);
    default: {
      const _x: never = result.error; void _x;
      throw new HttpException({ kind: 'invalid-input', detail: 'unknown failure' }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}

@Put('drills/:drillKey/diagram')
async updateDrillDiagram(
  @Param('drillKey') drillKey: string,
  @Body() rawBody: unknown,
  @Headers('x-tenant-id') tenantId: string,
  @Headers('x-user-id') userId: string,
): Promise<{ drillKey: string; updatedAt: string }> {
  const parsed = UpdateDiagramBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpException(
      { kind: 'invalid-input', detail: `body failed validation at ${issue?.path.join('.') ?? '<root>'}: ${issue?.message ?? 'unknown'}` },
      HttpStatus.BAD_REQUEST,
    );
  }
  const result = await this.updateUseCase.updateDrillDiagram(
    coachFromHeaders(tenantId, userId),
    { drillKey, diagram: parsed.data.diagram },
  );
  if (result.ok) return result.value;
  switch (result.error.kind) {
    case 'forbidden': throw new HttpException(result.error, HttpStatus.FORBIDDEN);
    case 'forbidden-vendor-tier': throw new HttpException(result.error, HttpStatus.CONFLICT);
    case 'drill-not-found':
    case 'not-a-drill': throw new HttpException(result.error, HttpStatus.NOT_FOUND);
    case 'invalid-input': throw new HttpException(result.error, HttpStatus.BAD_REQUEST);
    default: {
      const _x: never = result.error; void _x;
      throw new HttpException({ kind: 'invalid-input', detail: 'unknown failure' }, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
```

> Confirm `FORK_TEMPLATE_USE_CASE`, `UPDATE_DRILL_DIAGRAM_USE_CASE`, `DrillDiagramSchema`, `CoachPrincipal`, `ForkTemplateUseCase`, `UpdateDrillDiagramUseCase` are exported from the `pack-football` barrel (`libs/pack-football/src/index.ts`); if any is missing, add the export there (it is the API app's only access path). Both use-cases are already provided by `PackFootballModule`, so no DI wiring beyond the `@Inject` is needed.

- [ ] **Step 4: Run — expect PASS.** `npx nx test pack-football-api -t "drills"`

- [ ] **Step 5: Lint.** `npx nx lint pack-football-api`

- [ ] **Step 6: Commit.**

```
git add apps/pack-football-api/src/app/pack-football-drills.controller.ts \
        apps/pack-football-api/src/app/pack-football-drills.controller.spec.ts \
        libs/pack-football/src/index.ts
git commit -m "feat(pack-football-api): POST drills/:key/fork + PUT drills/:key/diagram"
```

---

## Task 7: UI client — fork + save + wire-schema parity

**Files:**
- Modify: `libs/pack-football-ui/src/lib/data/wire-schemas.ts`
- Modify: `libs/pack-football-ui/src/lib/data/wire-schemas-parity.spec.ts`
- Modify: `libs/pack-football-ui/src/lib/drills/drill-catalog.client.ts`
- Modify: `libs/pack-football-ui/src/lib/drills/drill-catalog.client.spec.ts`

- [ ] **Step 1: Add the mirrored write-response schemas to `wire-schemas.ts`** (next to `DrillDiagramSchema`):

```ts
export const ForkResponseSchema = z.object({
  templateId: z.string().min(1),
  forkedKey: z.string().min(1),
  sourceKey: z.string().min(1),
});
export type ForkResponse = z.infer<typeof ForkResponseSchema>;

export const UpdateDrillDiagramResponseSchema = z.object({
  drillKey: z.string().min(1),
  updatedAt: z.string().min(1),
});
export type UpdateDrillDiagramResponse = z.infer<typeof UpdateDrillDiagramResponseSchema>;
```

- [ ] **Step 2: Add parity-spec rows** in `wire-schemas-parity.spec.ts` (mirror the existing `DrillDiagram` parity block: a representative-fixture parse + a source-text drift guard against the canonical declarations).

```ts
import { ForkResponseSchema, UpdateDrillDiagramResponseSchema } from './wire-schemas.js';

describe('fork + update-diagram wire parity', () => {
  it('ForkResponseSchema parses the ForkTemplateResponse shape', () => {
    const r = ForkResponseSchema.safeParse({
      templateId: '00000000-0000-4000-8000-000000000000',
      forkedKey: 'football.intervention.drill.warm_rondo.fork.abc123',
      sourceKey: 'football.intervention.drill.warm_rondo',
    });
    expect(r.success).toBe(true);
  });
  it('UpdateDrillDiagramResponseSchema parses the UpdateDrillDiagramResponse shape', () => {
    const r = UpdateDrillDiagramResponseSchema.safeParse({
      drillKey: 'football.intervention.drill.warm_rondo.fork.abc123',
      updatedAt: '2026-05-26T10:00:00.000Z',
    });
    expect(r.success).toBe(true);
  });
  it('canonical ForkTemplateResponse still declares templateId/forkedKey/sourceKey', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../pack-football/src/in-ports/fork-template.use-case.ts'),
      'utf8',
    );
    expect(src).toContain('templateId');
    expect(src).toContain('forkedKey');
    expect(src).toContain('sourceKey');
  });
  it('canonical UpdateDrillDiagramResponse still declares drillKey/updatedAt', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../pack-football/src/in-ports/update-drill-diagram.use-case.ts'),
      'utf8',
    );
    expect(src).toContain('drillKey');
    expect(src).toContain('updatedAt');
  });
});
```

> Match the existing parity spec's import style for `readFileSync`/`resolve` and the relative path convention it already uses to reach `libs/pack-football/src/...`; adjust the `../` depth to whatever that file already uses.

- [ ] **Step 3: Run the parity spec — expect PASS.** `npx nx test pack-football-ui -t "wire parity"`

- [ ] **Step 4: Write the failing client tests** (append to `drill-catalog.client.spec.ts`, mirroring its `fetchImpl` stubbing):

```ts
it('forkDrill POSTs to /drills/:key/fork and returns the forked key', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({
      templateId: 't', forkedKey: 'football.intervention.drill.warm_rondo.fork.abc', sourceKey: 'football.intervention.drill.warm_rondo',
    }), { status: 201 });
  }) as unknown as typeof fetch;
  const client = new DrillCatalogClient();
  client.configure({ baseUrl: 'http://x', fetchImpl });
  const res = await client.forkDrill('football.intervention.drill.warm_rondo');
  expect(res.forkedKey).toContain('.fork.');
  expect(calls[0].url).toBe('http://x/pack-football/drills/football.intervention.drill.warm_rondo/fork');
  expect(calls[0].init.method).toBe('POST');
});

it('saveDrillDiagram PUTs the diagram and returns updatedAt', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ drillKey: 'k', updatedAt: '2026-05-26T10:00:00.000Z' }), { status: 200 });
  }) as unknown as typeof fetch;
  const client = new DrillCatalogClient();
  client.configure({ baseUrl: 'http://x', fetchImpl });
  const diagram = { sceneKind: 'pack-football.drill-diagram.v1', schemaVersion: 'pack-football.drill-diagram.v1', dots: [], arrows: [] } as const;
  const res = await client.saveDrillDiagram('k', diagram);
  expect(res.updatedAt).toMatch(/^\d{4}/);
  expect(calls[0].init.method).toBe('PUT');
  expect(JSON.parse(calls[0].init.body as string)).toEqual({ diagram });
});
```

- [ ] **Step 5: Run — expect FAIL.** `npx nx test pack-football-ui -t "DrillCatalogClient"`

- [ ] **Step 6: Implement `forkDrill` + `saveDrillDiagram`** on `DrillCatalogClient` (reuse `dispatch` + `parseOrFail`):

```ts
import {
  DrillDiagramSchema, ForkResponseSchema, UpdateDrillDiagramResponseSchema,
  type DrillDiagram, type ForkResponse, type UpdateDrillDiagramResponse,
} from '../data/wire-schemas.js';

async forkDrill(sourceKey: string, signal?: AbortSignal): Promise<ForkResponse> {
  const requestId = mintRequestId();
  const url = `${this.config.baseUrl}/pack-football/drills/${encodeURIComponent(sourceKey)}/fork`;
  const response = await this.dispatch(url, requestId, { method: 'POST' }, signal);
  return parseOrFail(ForkResponseSchema, response.body, requestId);
}

async saveDrillDiagram(drillKey: string, diagram: DrillDiagram, signal?: AbortSignal): Promise<UpdateDrillDiagramResponse> {
  const requestId = mintRequestId();
  const url = `${this.config.baseUrl}/pack-football/drills/${encodeURIComponent(drillKey)}/diagram`;
  const response = await this.dispatch(
    url, requestId,
    { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ diagram }) },
    signal,
  );
  return parseOrFail(UpdateDrillDiagramResponseSchema, response.body, requestId);
}
```

> `mintRequestId`/`parseOrFail`/`dispatch` already exist in the file. `dispatch` already sets the `x-tenant-id`/`x-pack-id`/`x-user-id`/`x-request-id` headers and merges `init.headers`, so the JSON `content-type` is preserved.

- [ ] **Step 7: Run — expect PASS.** `npx nx test pack-football-ui -t "DrillCatalogClient"`

- [ ] **Step 8: Commit.**

```
git add libs/pack-football-ui/src/lib/data/wire-schemas.ts \
        libs/pack-football-ui/src/lib/data/wire-schemas-parity.spec.ts \
        libs/pack-football-ui/src/lib/drills/drill-catalog.client.ts \
        libs/pack-football-ui/src/lib/drills/drill-catalog.client.spec.ts
git commit -m "feat(pack-football-ui): drill-catalog client fork + save + wire-schema parity"
```

---

## Task 8: Editor panel + Bibliothek integration + public API

**Files:**
- Create: `libs/pack-football-ui/src/lib/drills/drill-editor-panel.component.ts`
- Test: `libs/pack-football-ui/src/lib/drills/drill-editor-panel.component.spec.ts`
- Modify: `libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.ts`
- Modify: `libs/pack-football-ui/src/index.ts`

- [ ] **Step 1: Write the failing panel spec.**

```ts
// drill-editor-panel.component.spec.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DrillEditorPanelComponent } from './drill-editor-panel.component.js';
import { DrillCatalogClient } from './drill-catalog.client.js';

const VENDOR_ENTRY = {
  key: 'football.intervention.drill.warm_rondo', name: 'Warm-up Rondo',
  phase: 'warmup', intensity: 'easy', tier: 'vendor', diagram: null,
};

describe('DrillEditorPanelComponent', () => {
  let client: { forkDrill: ReturnType<typeof vi.fn>; saveDrillDiagram: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    client = {
      forkDrill: vi.fn().mockResolvedValue({ templateId: 't', forkedKey: 'football.intervention.drill.warm_rondo.fork.abc', sourceKey: VENDOR_ENTRY.key }),
      saveDrillDiagram: vi.fn().mockResolvedValue({ drillKey: 'football.intervention.drill.warm_rondo.fork.abc', updatedAt: '2026-05-26T10:00:00.000Z' }),
    };
    TestBed.configureTestingModule({
      imports: [DrillEditorPanelComponent],
      providers: [{ provide: DrillCatalogClient, useValue: client }],
    });
  });

  it('shows the vendor fork banner when entry tier is vendor', () => {
    const f = TestBed.createComponent(DrillEditorPanelComponent);
    f.componentRef.setInput('entry', VENDOR_ENTRY);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('[data-testid="fork-banner"]')).toBeTruthy();
  });

  it('save on a vendor drill forks first, then saves the forked key, then emits saved', async () => {
    const f = TestBed.createComponent(DrillEditorPanelComponent);
    f.componentRef.setInput('entry', VENDOR_ENTRY);
    const saved: unknown[] = [];
    f.componentInstance.saved.subscribe((k: unknown) => saved.push(k));
    f.detectChanges();
    await f.componentInstance.onSave();
    expect(client.forkDrill).toHaveBeenCalledWith(VENDOR_ENTRY.key);
    expect(client.saveDrillDiagram).toHaveBeenCalledWith('football.intervention.drill.warm_rondo.fork.abc', expect.anything());
    expect(saved).toContain('football.intervention.drill.warm_rondo.fork.abc');
  });
});
```

- [ ] **Step 2: Run — expect FAIL.** `npx nx test pack-football-ui -t "DrillEditorPanel"`

- [ ] **Step 3: Implement the panel.** Standalone, OnPush. Input `entry = input.required<DrillCatalogEntry>()`. Outputs `saved = output<string>()` (the persisted key) and `cancelled = output<void>()`. Holds the latest working diagram from the editor via `(diagramChange)`. On save: if vendor & not yet forked → `forkDrill(entry.key)`; then `saveDrillDiagram(targetKey, working)`; emit `saved(targetKey)`. Show fork banner when `entry().tier === 'vendor'`.

```ts
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';

import { DrillBoardEditorComponent } from '../generation/drill-board-editor.component.js';
import { EMPTY_DIAGRAM } from '../generation/drill-diagram-ops.js';
import type { DrillDiagram } from '../data/wire-schemas.js';
import { DrillCatalogClient } from './drill-catalog.client.js';
import type { DrillCatalogEntry } from './drill-catalog.client.js';

@Component({
  selector: 'lib-drill-editor-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DrillBoardEditorComponent],
  template: `
    <div class="drill-editor-panel">
      @if (entry().tier === 'vendor') {
        <p data-testid="fork-banner" class="fork-banner" role="note">
          Beim Speichern wird eine eigene Kopie für dein Team erstellt.
        </p>
      }
      <lib-drill-board-editor
        [diagram]="entry().diagram ?? empty"
        (diagramChange)="working.set($event)"
      />
      <div class="drill-editor-actions">
        <button type="button" data-action="save" [disabled]="status() === 'saving'" (click)="onSave()">Speichern</button>
        <button type="button" data-action="cancel" (click)="cancelled.emit()">Abbrechen</button>
        @if (status() === 'error') { <span class="error" role="alert">{{ errorReason() }}</span> }
        @if (status() === 'saved') { <span class="ok" role="status">Gespeichert</span> }
      </div>
    </div>
  `,
})
export class DrillEditorPanelComponent {
  readonly entry = input.required<DrillCatalogEntry>();
  readonly saved = output<string>();
  readonly cancelled = output<void>();

  protected readonly empty: DrillDiagram = EMPTY_DIAGRAM;
  protected readonly working = signal<DrillDiagram>(EMPTY_DIAGRAM);
  protected readonly status = signal<'idle' | 'saving' | 'saved' | 'error'>('idle');
  protected readonly errorReason = signal<string | null>(null);

  private readonly client = inject(DrillCatalogClient);
  private forkedKey: string | null = null;

  async onSave(): Promise<void> {
    this.status.set('saving');
    this.errorReason.set(null);
    try {
      const e = this.entry();
      let targetKey = e.key;
      if (e.tier === 'vendor' && this.forkedKey === null) {
        const fork = await this.client.forkDrill(e.key);
        this.forkedKey = fork.forkedKey;
      }
      if (this.forkedKey !== null) targetKey = this.forkedKey;
      await this.client.saveDrillDiagram(targetKey, this.working());
      this.status.set('saved');
      this.saved.emit(targetKey);
    } catch (err) {
      this.status.set('error');
      this.errorReason.set(err instanceof Error ? err.message : String(err));
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS.** `npx nx test pack-football-ui -t "DrillEditorPanel"`

- [ ] **Step 5: Wire the panel into the Bibliothek detail pane.** In `drill-bibliothek.component.ts`: import `DrillEditorPanelComponent`; add an `editing = signal(false)` field; in the detail pane add a **Bearbeiten** button (visible when an entry is selected and not editing) and render `<lib-drill-editor-panel>` when `editing()` is true; on `(saved)="onEditorSaved($event)"` call `loadDrills()` then re-select the entry whose `key === $event` (the forked key), and set `editing(false)`; on `(cancelled)` set `editing(false)`. Add a minimal `onEditorSaved(key: string)` method.

```ts
// sketch of the detail-pane addition (inside the @if (effectiveSelected(); as entry) block):
@if (!editing()) {
  <button type="button" data-action="edit" (click)="editing.set(true)">Bearbeiten</button>
  @if (entry.diagram !== null) { <lib-drill-board-scene [diagram]="entry.diagram" /> }
  @else { <div class="no-diagram" data-testid="drill-detail-no-diagram" role="status">Noch kein Diagramm vorhanden.</div> }
} @else {
  <lib-drill-editor-panel [entry]="entry" (saved)="onEditorSaved($event)" (cancelled)="editing.set(false)" />
}
```

```ts
// method:
protected readonly editing = signal(false);
async onEditorSaved(key: string): Promise<void> {
  this.editing.set(false);
  await this.loadDrills();
  const match = this.entries().find((e) => e.key === key);
  if (match) this.selected.set(match);
}
```

- [ ] **Step 6: Update the Bibliothek spec** to assert the edit toggle renders the panel and a `(saved)` event re-selects the forked entry (mirror the existing bibliothek spec's stubbing of `DrillCatalogClient`). Add one test: clicking `[data-action="edit"]` shows `lib-drill-editor-panel`.

- [ ] **Step 7: Export from the public API.** In `libs/pack-football-ui/src/index.ts` add:

```ts
export { DrillBoardEditorComponent } from './lib/generation/drill-board-editor.component.js';
export { DrillEditorPanelComponent } from './lib/drills/drill-editor-panel.component.js';
export { DrillEditorStore } from './lib/state/drill-editor.store.js';
export type { DrillTool, DrillSelection, SaveStatus } from './lib/generation/drill-editor.types.js';
export {
  ForkResponseSchema, UpdateDrillDiagramResponseSchema,
  type ForkResponse, type UpdateDrillDiagramResponse,
} from './lib/data/wire-schemas.js';
```

- [ ] **Step 8: Run the project tests + lint.** `npx nx test pack-football-ui && npx nx lint pack-football-ui` — expect PASS.

- [ ] **Step 9: Commit.**

```
git add libs/pack-football-ui/src/lib/drills/drill-editor-panel.component.ts \
        libs/pack-football-ui/src/lib/drills/drill-editor-panel.component.spec.ts \
        libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.ts \
        libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.spec.ts \
        libs/pack-football-ui/src/index.ts
git commit -m "feat(pack-football-ui): drill editor panel + Bibliothek edit toggle + lazy fork-on-save"
```

---

## Task 9: Full gate + browser smoke-test

- [ ] **Step 1: Run the local gate.** From `domains/exercir`: `npm run ci:local` — expect build + lint + typecheck + tests green across all projects. Fix any public-API/boundary breakage (e.g. ensure no UI file imports the `pack-football` barrel; confirm new exports resolve).

- [ ] **Step 2: Sonar.** `npm run sonar:coverage && npm run sonar:scan` — expect Quality Gate **OK** (new code covered by the unit/component tests above).

- [ ] **Step 3: Browser smoke-test (type-check passing ≠ feature works).** Start the apps: `nx serve pack-football-api` (:3100) + `nx serve pack-football-visual-editor` (:4200). Navigate to `/t/b6c5d8e2-1234-4abc-9def-fc1a55e1a55e/p/football/coach/drills`. Confirm, with **both mouse and keyboard**:
  - Select a vendor drill → **Bearbeiten** → the fork banner shows.
  - Place dots of each kind, move a dot (drag **and** Space+arrows+Space), draw an arrow (drag **and** two-anchor keyboard), set a zone, delete an element (Delete key).
  - Undo/redo work.
  - **Speichern** → forks (key gains `.fork.…`), persists, and the detail re-selects the forked tenant drill with the saved diagram rendered.
  - Editing the now-tenant drill again saves **in place** (no second fork).
  - Inspect the accessibility tree: `role="toolbar"`, focusable elements with `aria-grabbed`, the `aria-live` status announcing operations.

- [ ] **Step 4: Commit any fixes.**

```
git add -A
git commit -m "chore(pack-football): drill-editor gate fixes + smoke-test follow-ups"
```

---

## Self-review notes (addressed)

- **Spec coverage:** edit-mode toggle + editor (Tasks 4/5/8), eight gestures as pure ops (Task 2), pointer + keyboard parity incl. WCAG 2.5.7 (Tasks 4/5), undo/redo + dirty/save status (Task 3), lazy vendor→tenant fork (Tasks 3/6/8), two HTTP endpoints + failure mapping (Task 6), client + wire-schema parity (Task 7), boundary preserved — UI uses the mirror, never the barrel (Tasks 2/7), `<fc-pitch>` left local (no task — deliberate per §8), live-region a11y (Tasks 4/5) — all covered.
- **Type consistency:** `DrillDiagram` from `../data/wire-schemas.js` throughout the UI; `DrillTool`/`DrillSelection`/`SaveStatus` defined in Task 2 and consumed by Tasks 3–5/8; `drill-diagram-ops` fns (`addDot`/`moveDot`/`setDotKind`/`removeDot`/`addArrow`/`removeArrow`/`setZone`/`clearZone`/`EMPTY_DIAGRAM`) defined in Task 2, consumed by Tasks 3–5/8; store API (`begin`/`apply`/`beginTransient`/`updateTransient`/`commitTransient`/`cancelTransient`/`undo`/`redo`/`needsFork`/`rememberFork`/`saveTargetKey`/`markSaving`/`markSaved`/`markError`) defined in Task 3, consumed by Tasks 4/5; client `forkDrill`/`saveDrillDiagram` (Task 7) consumed by the panel (Task 8); endpoint paths `POST drills/:drillKey/fork` + `PUT drills/:drillKey/diagram` consistent across Tasks 6 (server) and 7 (client).
- **Mirror-pointers** are intentional where exact code depends on live conventions (component-test render harness, the controller spec's app harness, the parity spec's relative-path depth) — the named file to mirror is given in each such task.
- **Deferred (no task, per spec §3):** tactical-board (Scene 5), `<fc-pitch>` extraction, card-gallery thumbnails, drill-name i18n, multi-editor.
