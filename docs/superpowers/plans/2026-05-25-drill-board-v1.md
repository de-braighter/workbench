# Drill-board v1 (read-only Drill-Bibliothek) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the S-21 "Drill-Bibliothek" stub with a read-only drill library: browse the football drill catalog grouped by phase, filter by phase/intensity, and view a selected drill's diagram rendered on an SVG pitch.

**Architecture:** Reuse the existing `pack-football-ui/generation/` pattern (pure `layout*` fn → view-model → standalone OnPush SVG scene component), mirroring `formation-*`. The drill-board uses its **own** view-model (`DrillBoardView`), not the plan-tree `SvgScene`, because a `DrillDiagram` is not a `PlanTree`. Pure pack feature — no kernel/substrate/design-system change. SVG renderer (ADR-177).

**Tech Stack:** TypeScript, Angular (standalone, signals, OnPush), Nx, Vitest (`@nx/angular:unit-test`), Zod (`DrillDiagramSchema`). Spec: `docs/superpowers/specs/2026-05-25-drill-board-v1-design.md`.

**Conventions to mirror (read these first):**
- Pure layout fn + scene component: `domains/exercir/libs/pack-football-ui/src/lib/generation/formation-layout.ts` + `formation-scene.component.ts` + their `.spec.ts`.
- Pitch constants: `formation-template.ts` (`PITCH_DIMENSIONS`, `PITCH_MARKINGS_DECORATIONS`).
- Contract: `domains/exercir/libs/pack-football/src/domain/football-event.ts` (`DrillDiagram`, `DrillDiagramSchema`, `DrillDiagramDot`, `DrillDiagramArrow`, `DrillDiagramZone`).
- Read use-case: `domains/exercir/libs/pack-football/src/in-ports/list-drills.use-case.ts` (`ListDrillsUseCase`, `ListDrillsFilter`).
- Catalog seed: `domains/exercir/libs/pack-football/src/manifest/interventions.ts`.
- Route stub to replace: `domains/exercir/libs/pack-football-ui/src/lib/shell/fc-workspace.routes.ts` (`stub('Drill-Bibliothek', 'S-21')`).
- API app controller pattern: mirror an existing controller in `domains/exercir/apps/pack-football-api/src/app/` (e.g. `pack-football-plan-tree.controller.ts`).

**Coordinate frame:** `DrillDiagram` dots/arrows/zone use normalized pitch units `x ∈ [0,100]`, `y ∈ [0,60]` (length × width). The layout fn maps these to a pixel viewport.

**Test command (all tasks):** `npx nx test pack-football-ui` and `npx nx test pack-football` (run the single project; the executing agent may target a file with vitest's `-t`). Full gate: `pnpm run ci:local`.

---

## File Structure

**Create:**
- `domains/exercir/libs/pack-football-ui/src/lib/generation/drill-board.types.ts` — `DrillBoardView` view-model + element types.
- `domains/exercir/libs/pack-football-ui/src/lib/generation/drill-board-layout.ts` — pure `layoutDrillBoard(diagram, viewport) → DrillBoardView`.
- `domains/exercir/libs/pack-football-ui/src/lib/generation/drill-board-layout.spec.ts`
- `domains/exercir/libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts` — standalone OnPush SVG renderer.
- `domains/exercir/libs/pack-football-ui/src/lib/generation/drill-board-scene.component.spec.ts`
- `domains/exercir/libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.ts` — the `drills` route component.
- `domains/exercir/libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.spec.ts`
- `domains/exercir/libs/pack-football-ui/src/lib/drills/drill-catalog.client.ts` — UI data client for the read endpoint.
- `domains/exercir/libs/pack-football-ui/src/lib/drills/drill-catalog.client.spec.ts`
- `domains/exercir/libs/pack-football/src/manifest/drill-diagrams.seed.ts` — the 12 seed diagrams (catalog content).
- `domains/exercir/libs/pack-football/src/manifest/drill-diagrams.seed.spec.ts`
- `domains/exercir/apps/pack-football-api/src/app/pack-football-drills.controller.ts` — `GET /pack-football/drills`.
- `domains/exercir/apps/pack-football-api/src/app/pack-football-drills.controller.spec.ts`

**Modify:**
- `domains/exercir/libs/pack-football/src/manifest/interventions.ts` — attach `metadata.diagram` to the 12 drill rows (from the seed).
- `domains/exercir/libs/pack-football-ui/src/lib/shell/fc-workspace.routes.ts` — point the `drills` route at `DrillBibliothekComponent` instead of the stub.
- `domains/exercir/apps/pack-football-api/src/app/app.module.ts` (or equivalent) — register the new controller.

---

## Task 1: Seed the 12 drill diagrams (catalog content)

**Files:**
- Create: `libs/pack-football/src/manifest/drill-diagrams.seed.ts`
- Test: `libs/pack-football/src/manifest/drill-diagrams.seed.spec.ts`
- Modify: `libs/pack-football/src/manifest/interventions.ts`

- [ ] **Step 1: Read the catalog to get the 12 drill keys + their phases.**
Open `interventions.ts`; list the 12 rows whose key matches `football.intervention.drill.*`. Record each drill's key + `metadata.phase`. You will author one diagram per key.

- [ ] **Step 2: Write the failing seed-validation spec.**

```ts
// drill-diagrams.seed.spec.ts
import { describe, it, expect } from 'vitest';
import { DrillDiagramSchema } from '../domain/football-event.js';
import { DRILL_DIAGRAMS } from './drill-diagrams.seed.js';

describe('DRILL_DIAGRAMS seed', () => {
  it('has one diagram per vendor drill key', () => {
    expect(Object.keys(DRILL_DIAGRAMS).length).toBe(12);
  });
  it('every diagram conforms to DrillDiagramSchema', () => {
    for (const [key, diagram] of Object.entries(DRILL_DIAGRAMS)) {
      const parsed = DrillDiagramSchema.safeParse(diagram);
      expect(parsed.success, `${key}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`).toBe(true);
    }
  });
  it('every diagram has at least one dot and uses valid kinds', () => {
    for (const diagram of Object.values(DRILL_DIAGRAMS)) {
      expect(diagram.dots.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run it — expect FAIL (module not found).** `npx nx test pack-football -t "DRILL_DIAGRAMS"`

- [ ] **Step 4: Author the seed.** Create `drill-diagrams.seed.ts` exporting `DRILL_DIAGRAMS: Record<string, DrillDiagram>` keyed by drill key. Author 12 small, realistic diagrams. Each: `sceneKind` & `schemaVersion` = `'pack-football.drill-diagram.v1'`; `dots[]` with `kind` ∈ `pack-football.drill-diagram.{player|defender|keeper|cone|ball}`; `arrows[]` with `kind` ∈ `pack-football.drill-diagram.arrow.{pass|run|dribble|shot}`; coords `x∈[0,100]`, `y∈[0,60]`; optional `zone`. Example row:

```ts
import type { DrillDiagram } from '../domain/football-event.js';

export const DRILL_DIAGRAMS: Record<string, DrillDiagram> = {
  'football.intervention.drill.warm_rondo': {
    sceneKind: 'pack-football.drill-diagram.v1',
    schemaVersion: 'pack-football.drill-diagram.v1',
    dots: [
      { id: 'p1', kind: 'pack-football.drill-diagram.player', x: 30, y: 20 },
      { id: 'p2', kind: 'pack-football.drill-diagram.player', x: 60, y: 18 },
      { id: 'p3', kind: 'pack-football.drill-diagram.player', x: 30, y: 45 },
      { id: 'p4', kind: 'pack-football.drill-diagram.player', x: 60, y: 47 },
      { id: 'd1', kind: 'pack-football.drill-diagram.defender', x: 43, y: 30 },
      { id: 'd2', kind: 'pack-football.drill-diagram.defender', x: 50, y: 38 },
      { id: 'b1', kind: 'pack-football.drill-diagram.ball', x: 31, y: 21 },
    ],
    arrows: [
      { id: 'a1', kind: 'pack-football.drill-diagram.arrow.pass', x1: 31, y1: 21, x2: 59, y2: 18 },
    ],
    zone: { x: 25, y: 12, w: 45, h: 40 },
  },
  // ...11 more, one per drill key, varied across phases (warmup/technique/tactic/finishing/keeper/...)
};
```

- [ ] **Step 5: Run the spec — expect PASS.** `npx nx test pack-football -t "DRILL_DIAGRAMS"`

- [ ] **Step 6: Attach diagrams to the catalog rows.** In `interventions.ts`, for each of the 12 drill rows set `metadata.diagram = DRILL_DIAGRAMS[<key>]`. If the existing intervention metadata Zod schema does not yet permit a `diagram` field, widen it to `diagram: DrillDiagramSchema.optional()` (import from `../domain/football-event.js`). Run the existing manifest specs: `npx nx test pack-football` — expect PASS (fix any schema-coverage assertions that count metadata fields).

- [ ] **Step 7: Commit.**
```bash
git add libs/pack-football/src/manifest/drill-diagrams.seed.ts libs/pack-football/src/manifest/drill-diagrams.seed.spec.ts libs/pack-football/src/manifest/interventions.ts
git commit -m "feat(pack-football): seed 12 vendor drill diagrams (DrillDiagramSchema)"
```

---

## Task 2: Drill-board view-model + pure layout fn

**Files:**
- Create: `libs/pack-football-ui/src/lib/generation/drill-board.types.ts`, `drill-board-layout.ts`
- Test: `libs/pack-football-ui/src/lib/generation/drill-board-layout.spec.ts`

- [ ] **Step 1: Define the view-model types.** `drill-board.types.ts`:

```ts
export interface DrillViewport { width: number; height: number; } // SVG px

export type DrillDotKind = 'player' | 'defender' | 'keeper' | 'cone' | 'ball';
export type DrillArrowKind = 'pass' | 'run' | 'dribble' | 'shot';

export interface DrillBoardDot { id: string; kind: DrillDotKind; cx: number; cy: number; ariaLabel: string; }
export interface DrillBoardArrow { id: string; kind: DrillArrowKind; x1: number; y1: number; x2: number; y2: number; ariaLabel: string; }
export interface DrillBoardZone { x: number; y: number; w: number; h: number; ariaLabel: string; }

export interface DrillBoardView {
  viewport: DrillViewport;
  dots: readonly DrillBoardDot[];
  arrows: readonly DrillBoardArrow[];
  zone: DrillBoardZone | null;
  summaryAriaLabel: string;
}
```

- [ ] **Step 2: Write the failing layout spec.**

```ts
// drill-board-layout.spec.ts
import { describe, it, expect } from 'vitest';
import { layoutDrillBoard, PITCH_LENGTH, PITCH_WIDTH } from './drill-board-layout.js';
import type { DrillDiagram } from '@de-braighter/pack-football';

const diagram: DrillDiagram = {
  sceneKind: 'pack-football.drill-diagram.v1',
  schemaVersion: 'pack-football.drill-diagram.v1',
  dots: [
    { id: 'p1', kind: 'pack-football.drill-diagram.player', x: 0, y: 0 },
    { id: 'b1', kind: 'pack-football.drill-diagram.ball', x: 100, y: 60 },
  ],
  arrows: [{ id: 'a1', kind: 'pack-football.drill-diagram.arrow.pass', x1: 0, y1: 0, x2: 100, y2: 60 }],
  zone: { x: 10, y: 10, w: 20, h: 20 },
};

describe('layoutDrillBoard', () => {
  it('scales normalized [0,100]x[0,60] to the viewport corners', () => {
    const v = layoutDrillBoard(diagram, { width: 1000, height: 600 });
    expect(v.dots[0]).toMatchObject({ kind: 'player', cx: 0, cy: 0 });
    expect(v.dots[1]).toMatchObject({ kind: 'ball', cx: 1000, cy: 600 });
  });
  it('maps dot/arrow kind from the namespaced string', () => {
    const v = layoutDrillBoard(diagram, { width: 100, height: 60 });
    expect(v.dots[0].kind).toBe('player');
    expect(v.arrows[0].kind).toBe('pass');
  });
  it('produces a per-element and summary ariaLabel', () => {
    const v = layoutDrillBoard(diagram, { width: 100, height: 60 });
    expect(v.dots[0].ariaLabel).toContain('player');
    expect(v.arrows[0].ariaLabel.toLowerCase()).toContain('pass');
    expect(v.summaryAriaLabel).toContain('1 player');
  });
  it('returns zone scaled, or null when absent', () => {
    const v = layoutDrillBoard(diagram, { width: 100, height: 60 });
    expect(v.zone).toMatchObject({ x: 10, y: 10, w: 20, h: 20 });
    const v2 = layoutDrillBoard({ ...diagram, zone: undefined }, { width: 100, height: 60 });
    expect(v2.zone).toBeNull();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.** `npx nx test pack-football-ui -t "layoutDrillBoard"`

- [ ] **Step 4: Implement `drill-board-layout.ts`.**

```ts
import type { DrillDiagram } from '@de-braighter/pack-football';
import type { DrillArrowKind, DrillBoardView, DrillDotKind, DrillViewport } from './drill-board.types.js';

export const PITCH_LENGTH = 100; // normalized x max
export const PITCH_WIDTH = 60;   // normalized y max

const DOT_KIND_RE = /^pack-football\.drill-diagram\.([a-z-]+)$/;
const ARROW_KIND_RE = /^pack-football\.drill-diagram\.arrow\.([a-z-]+)$/;
const DOT_LABELS: Record<DrillDotKind, string> = {
  player: 'player', defender: 'defender', keeper: 'keeper', cone: 'cone', ball: 'ball',
};

function dotKind(raw: string): DrillDotKind {
  const m = DOT_KIND_RE.exec(raw);
  const k = (m?.[1] ?? 'player') as DrillDotKind;
  return k in DOT_LABELS ? k : 'player';
}
function arrowKind(raw: string): DrillArrowKind {
  const m = ARROW_KIND_RE.exec(raw);
  return (m?.[1] ?? 'pass') as DrillArrowKind;
}

export function layoutDrillBoard(diagram: DrillDiagram, viewport: DrillViewport): DrillBoardView {
  const sx = viewport.width / PITCH_LENGTH;
  const sy = viewport.height / PITCH_WIDTH;

  const dots = diagram.dots.map((d) => {
    const kind = dotKind(d.kind);
    return { id: d.id, kind, cx: d.x * sx, cy: d.y * sy, ariaLabel: `${DOT_LABELS[kind]} at ${Math.round(d.x)},${Math.round(d.y)}` };
  });
  const arrows = diagram.arrows.map((a) => {
    const kind = arrowKind(a.kind);
    return { id: a.id, kind, x1: a.x1 * sx, y1: a.y1 * sy, x2: a.x2 * sx, y2: a.y2 * sy, ariaLabel: `${kind} arrow` };
  });
  const zone = diagram.zone
    ? { x: diagram.zone.x * sx, y: diagram.zone.y * sy, w: diagram.zone.w * sx, h: diagram.zone.h * sy, ariaLabel: 'zone' }
    : null;

  const counts = dots.reduce<Record<string, number>>((acc, d) => { acc[d.kind] = (acc[d.kind] ?? 0) + 1; return acc; }, {});
  const summaryAriaLabel = Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', ') + `; ${arrows.length} arrows`;

  return { viewport, dots, arrows, zone, summaryAriaLabel };
}
```

- [ ] **Step 5: Run — expect PASS.** `npx nx test pack-football-ui -t "layoutDrillBoard"`

- [ ] **Step 6: Commit.**
```bash
git add libs/pack-football-ui/src/lib/generation/drill-board.types.ts libs/pack-football-ui/src/lib/generation/drill-board-layout.ts libs/pack-football-ui/src/lib/generation/drill-board-layout.spec.ts
git commit -m "feat(pack-football-ui): pure drill-board layout fn + view-model"
```

---

## Task 3: Drill-board scene component (read-only SVG)

**Files:**
- Create: `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts`
- Test: `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.spec.ts`

**Mirror:** `formation-scene.component.ts` for the standalone/OnPush/computed-over-layout structure — but **remove all interaction** (no `GestureInterpreter`, `SubstrateClient`, `EditorStore`, pointer/keyboard drag handlers, no `@Output`). This scene is read-only.

- [ ] **Step 1: Write the failing component spec.** Mirror `formation-scene.component.spec.ts`'s harness (same TestBed/render setup this project already uses). Assert: given a `DrillDiagram` input, the rendered SVG contains one shape per dot, one `<line>`/`<path>` per arrow, a `<rect>` for the zone, and the `<svg>` carries `role="img"` with the summary `aria-label`.

```ts
import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DrillBoardSceneComponent } from './drill-board-scene.component.js';
// ...mirror the exact render harness used in formation-scene.component.spec.ts...

it('renders a dot per diagram dot and sets role=img + summary aria-label', async () => {
  // arrange: create component, set `diagram` input to a 2-dot/1-arrow/1-zone diagram
  // act: detectChanges
  // assert: svg[role="img"] exists; querySelectorAll('[data-dot]').length === 2;
  //         querySelectorAll('[data-arrow]').length === 1; svg.getAttribute('aria-label') contains '2 player' (or counts)
});
```

- [ ] **Step 2: Run — expect FAIL.** `npx nx test pack-football-ui -t "DrillBoardScene"`

- [ ] **Step 3: Implement the component.** Standalone, `ChangeDetectionStrategy.OnPush`. Input `diagram = input.required<DrillDiagram>()` and `viewport = input<DrillViewport>({ width: 600, height: 360 })`. A `view = computed(() => layoutDrillBoard(this.diagram(), this.viewport()))`. Template: an `<svg [attr.viewBox]>` with `role="img"` and `[attr.aria-label]="view().summaryAriaLabel"`; the pitch markings (reuse `PITCH_MARKINGS_DECORATIONS`/`PITCH_DIMENSIONS` from `formation-template.ts`, scaled to the same viewport, OR a small local `pitch.ts` if the formation constants are coupled to the formation frame); a `@for` over `view().zone` (rect), `view().arrows` (`<line marker-end>` with per-kind stroke/dash), `view().dots` (`<circle>`/`<polygon>` per kind) — each element gets `[attr.data-dot]`/`[attr.data-arrow]` and `[attr.aria-label]`; a visually-hidden `<ul>` ordered description built from `view()` (dots then arrows) for screen readers; a legend row. Define `<marker>` defs for arrowheads. Color/dash per kind: player `#2563eb`, defender `#dc2626`, keeper `#f59e0b`, cone (triangle) `#fb923c`, ball (small white). pass solid `#7dd3fc`, run dashed, dribble wavy/dotted, shot thick `#fca5a5`.

- [ ] **Step 4: Run — expect PASS.** `npx nx test pack-football-ui -t "DrillBoardScene"`

- [ ] **Step 5: Commit.**
```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts libs/pack-football-ui/src/lib/generation/drill-board-scene.component.spec.ts
git commit -m "feat(pack-football-ui): read-only drill-board SVG scene component"
```

---

## Task 4: Read endpoint — GET /pack-football/drills

**Files:**
- Create: `apps/pack-football-api/src/app/pack-football-drills.controller.ts`
- Test: `apps/pack-football-api/src/app/pack-football-drills.controller.spec.ts`
- Modify: the api module that registers controllers (mirror where `pack-football-plan-tree.controller.ts` is registered).

**Mirror:** `pack-football-plan-tree.controller.ts` for the controller/DI/validation/error-envelope conventions.

- [ ] **Step 1: Write the failing controller spec.** Assert `GET /pack-football/drills` returns the catalog as `{ drills: [...] }`, each item `{ key, name, phase, intensity, tier, diagram }`; and that `?phase=technique&intensity=moderate` narrows via `ListDrillsUseCase.listDrills({ phase, intensity })`. Mirror the spec harness of the plan-tree controller spec; inject a stub `ListDrillsUseCase`.

- [ ] **Step 2: Run — expect FAIL.** `npx nx test pack-football-api -t "drills"`

- [ ] **Step 3: Implement the controller.** Inject `LIST_DRILLS_USE_CASE` (token from `list-drills.use-case.ts`). `@Get('drills')` reads optional `phase`/`intensity` query params, calls `listDrills(filter)`, maps each `Intervention` → the wire shape (pulling `metadata.phase/intensity/tier/diagram`), returns `{ drills }`. Follow the existing controller's error-envelope + validation posture. Register it in the api module.

- [ ] **Step 4: Run — expect PASS.** `npx nx test pack-football-api -t "drills"`

- [ ] **Step 5: Commit.**
```bash
git add apps/pack-football-api/src/app/pack-football-drills.controller.ts apps/pack-football-api/src/app/pack-football-drills.controller.spec.ts apps/pack-football-api/src/app/*.module.ts
git commit -m "feat(pack-football-api): GET /pack-football/drills read endpoint"
```

---

## Task 5: UI drill-catalog client

**Files:**
- Create: `libs/pack-football-ui/src/lib/drills/drill-catalog.client.ts`, `drill-catalog.client.spec.ts`

**Mirror:** the existing UI data client (`libs/pack-football-ui/src/lib/data/substrate-client.ts`) for fetch/error/requestId conventions.

- [ ] **Step 1: Write the failing client spec.** Assert `listDrills()` GETs `/pack-football/drills` and returns the parsed `DrillCatalogEntry[]`; `listDrills({ phase, intensity })` appends query params. Stub `fetch` as the existing client's spec does.

- [ ] **Step 2: Run — expect FAIL.** `npx nx test pack-football-ui -t "DrillCatalogClient"`

- [ ] **Step 3: Implement.** Define `DrillCatalogEntry { key; name; phase; intensity; tier; diagram: DrillDiagram | null }`. `listDrills(filter?)` builds the query string, fetches, validates each entry's `diagram` with `DrillDiagramSchema.safeParse` (invalid → `diagram: null`), returns entries. Mirror the substrate-client's error handling.

- [ ] **Step 4: Run — expect PASS.** `npx nx test pack-football-ui -t "DrillCatalogClient"`

- [ ] **Step 5: Commit.**
```bash
git add libs/pack-football-ui/src/lib/drills/drill-catalog.client.ts libs/pack-football-ui/src/lib/drills/drill-catalog.client.spec.ts
git commit -m "feat(pack-football-ui): drill-catalog UI client"
```

---

## Task 6: Drill-Bibliothek route component (grouped master-detail)

**Files:**
- Create: `libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.ts`, `drill-bibliothek.component.spec.ts`
- Modify: `libs/pack-football-ui/src/lib/shell/fc-workspace.routes.ts`

- [ ] **Step 1: Write the failing component spec.** Assert: on load it calls `DrillCatalogClient.listDrills()` (stub), groups entries by `phase` into sections, renders the section headings + entry rows; selecting an entry renders a `<lib-drill-board-scene>` bound to that entry's `diagram`; the phase/intensity filter re-queries (or filters the in-memory list); an entry with `diagram: null` shows a "no diagram yet" panel instead of the scene.

- [ ] **Step 2: Run — expect FAIL.** `npx nx test pack-football-ui -t "DrillBibliothek"`

- [ ] **Step 3: Implement.** Standalone, OnPush. On init, fetch via `DrillCatalogClient`. `signal` for entries, selected entry, and filter. `computed` groups entries by `phase` (use the canonical phase order). Template: left = grouped list (sections by phase, each a button row; keyboard-navigable), right = selected drill's `<lib-drill-board-scene [diagram]="selected().diagram">` + metadata (name/phase/intensity/tier/description) OR the empty-state. Filter controls bind to the filter signal. Import `DrillBoardSceneComponent`.

- [ ] **Step 4: Run — expect PASS.** `npx nx test pack-football-ui -t "DrillBibliothek"`

- [ ] **Step 5: Replace the route stub.** In `fc-workspace.routes.ts`, change the `drills` route from `stub('Drill-Bibliothek', 'S-21')` to lazy-load `DrillBibliothekComponent` (match how other real routes are wired in that file). Keep the `fc-workspace.types.ts` `{ id: 'drills', label: 'Drill-Bibliothek' }` nav entry.

- [ ] **Step 6: Run the project tests + lint.** `npx nx test pack-football-ui && npx nx lint pack-football-ui` — expect PASS.

- [ ] **Step 7: Commit.**
```bash
git add libs/pack-football-ui/src/lib/drills/ libs/pack-football-ui/src/lib/shell/fc-workspace.routes.ts
git commit -m "feat(pack-football-ui): Drill-Bibliothek route (grouped master-detail), replaces S-21 stub"
```

---

## Task 7: Full gate + browser smoke-test

- [ ] **Step 1: Run the local gate.** From `domains/exercir`: `pnpm run ci:local` — expect build + lint + typecheck + tests green across all projects. Fix any breakage (e.g. public-API exports: ensure `DrillBibliothekComponent`, `DrillBoardSceneComponent` are exported from the lib's `index.ts` if other code imports them).

- [ ] **Step 2: Sonar.** `npm run sonar:up` (if not running) then `npm run sonar:scan` — expect Quality Gate OK.

- [ ] **Step 3: Browser smoke-test (type-check passing ≠ feature works).** Start the visual-editor/workspace app, navigate to the `drills` route, confirm: the grouped list renders 12 drills across phase sections; filtering by phase/intensity narrows; selecting a drill renders its board (pitch + dots/arrows/zone + legend + metadata); a screen-reader (or the accessibility tree) shows the `role="img"` summary + the hidden ordered description.

- [ ] **Step 4: Commit any fixes.**
```bash
git add -A
git commit -m "chore(pack-football-ui): drill-board v1 gate fixes + public-api exports"
```

---

## Self-review notes (addressed)

- **Spec coverage:** browse-grouped-by-phase (Task 6), filter (Tasks 4/5/6), rendered read-only board (Tasks 2/3), seed-all-12 (Task 1), derived a11y (Task 2 ariaLabels + Task 3 role=img + hidden list), read path end-to-end (Tasks 4/5/6), route replaces S-21 stub (Task 6) — all covered.
- **Deferred (not in this plan, per spec §3):** editable canvas, tactical-board, `<fc-pitch>` extraction, tenant authoring.
- **Type consistency:** `DrillBoardView`/`DrillBoardDot`/`DrillBoardArrow`/`DrillBoardZone` (Task 2) are consumed unchanged by Task 3; `DrillCatalogEntry` (Task 5) consumed by Task 6; `DrillDiagram` from `@de-braighter/pack-football` throughout.
- **Mirror-pointers** are intentional where exact code depends on live conventions (component render harness, api controller, data client) — the named file to mirror is given in each such task; the executing agent matches the established pattern rather than fabricating divergent code.
