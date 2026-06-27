# Drill-board Skins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the drill-board renderer *feel like football* by introducing a swappable **skin** system — shipping four skins (`schematic`, `matchday`, `telestrator`, `arena`), hardwiring `matchday` (grass + mini-shirt chips + numbers) into the Drill Library, with zero kernel/contract-breaking change and no accessibility regression.

**Architecture:** The renderer stays "data in → SVG out". All visual decisions move from module constants into a resolved **skin object** (`DrillBoardSkin`). `<lib-drill-board-scene>` gains an optional `skin` input (default `schematic`, byte-identical to today). Skins drive per-kind glyph (jersey/circle/ball/cone), fills, arrow styling, and skin-gated surface layers (grass, mow stripes, glow). A new optional `label` on the diagram dot carries the jersey number, with an auto-number fallback so existing seeded drills render numbered immediately.

**Tech Stack:** Angular 21 (standalone, signals, OnPush, zoneless) · SVG · Zod (pack-football-contracts) · Vitest + `@angular/core/testing` TestBed · de/en JSON i18n catalog (ADR-012).

**Spec:** [`docs/superpowers/specs/2026-06-04-drill-board-skins-design.md`](../specs/2026-06-04-drill-board-skins-design.md)

**Working directory:** all paths are relative to `D:/development/projects/de-braighter/domains/exercir/`. Run commands from there (the Nx workspace root). Build/test verb: `npx nx test pack-football-ui` (single file: append `-- <pattern>` or use the vitest `-t` flag via the project runner).

---

## File Structure

| File | Responsibility | PR |
|---|---|---|
| `libs/pack-football-ui/src/lib/generation/drill-board-glyphs.ts` | **new** — pure glyph geometry: `jerseyPath`, `conePoints` (moved) | 1 |
| `libs/pack-football-ui/src/lib/generation/drill-board-skins.ts` | **new** — `DrillBoardSkin` contract + `SKINS` (all 4) + `resolveSkin` | 1, 2, 3 |
| `libs/pack-football-ui/src/lib/generation/drill-board-style.ts` | folded into `schematic` skin; file deleted or thin re-export | 1 |
| `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts` | `skin` input; resolve skin; render surface + per-kind glyph + number; legend per skin | 1, 2, 3 |
| `libs/pack-football-ui/src/lib/generation/drill-board.types.ts` | `label?` on `DrillBoardDot`; re-export skin types | 1, 2 |
| `libs/pack-football-ui/src/lib/generation/drill-board-layout.ts` | thread `label`; auto-number fallback; number-aware aria | 2 |
| `libs/pack-football-contracts/src/lib/drill-diagram.schemas.ts` | optional `label` on the dot schema | 2 |
| `libs/pack-football-ui/src/lib/tactical-board/board-i18n.ts` + `i18n/{de,en}/board.json` | numbered-dot aria key; skin display names | 2 |
| `libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.ts` | pass `skin="matchday"` | 2 |
| `*.spec.ts` siblings | TDD coverage for each unit | 1, 2, 3 |

---

## PR 1 — Skin seam + `schematic` parity (no visual change)

> **PR-1 contract:** after this PR, the rendered output of the default skin is **byte-identical** to today. Every existing spec stays green. No new look ships yet. This de-risks the refactor.

### Task 1: Glyph geometry module

**Files:**
- Create: `libs/pack-football-ui/src/lib/generation/drill-board-glyphs.ts`
- Create: `libs/pack-football-ui/src/lib/generation/drill-board-glyphs.spec.ts`
- Modify (later in this task): nothing else yet — `drill-board-style.ts` keeps its `conePoints` until Task 3 swaps imports.

- [ ] **Step 1: Write the failing test**

Create `drill-board-glyphs.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { jerseyPath, conePoints } from './drill-board-glyphs.js';

describe('jerseyPath', () => {
  it('returns a closed SVG path string centred on (cx,cy)', () => {
    const d = jerseyPath(50, 30, 7);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
    // The path must reference the centre x somewhere (collar dip is at cx).
    expect(d).toContain('50');
  });

  it('scales with width: a wider shirt spans a larger x-range', () => {
    const nums = (s: string) => s.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const narrow = nums(jerseyPath(50, 30, 6));
    const wide = nums(jerseyPath(50, 30, 12));
    const spanX = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
    // Compare the x-extent (even indices are x in our M/L command stream).
    expect(spanX(wide.filter((_, i) => i % 2 === 0))).toBeGreaterThan(
      spanX(narrow.filter((_, i) => i % 2 === 0)),
    );
  });
});

describe('conePoints', () => {
  it('returns three "x,y" pairs for an upward triangle', () => {
    const pts = conePoints(10, 10, 6);
    expect(pts.split(' ')).toHaveLength(3);
    // Apex y is above centre (smaller y).
    const apexY = Number(pts.split(' ')[0].split(',')[1]);
    expect(apexY).toBeLessThan(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football-ui -- drill-board-glyphs`
Expected: FAIL — `Cannot find module './drill-board-glyphs.js'`.

- [ ] **Step 3: Write the glyph module**

Create `drill-board-glyphs.ts`:

```ts
/**
 * drill-board-glyphs.ts — pure SVG glyph geometry for the drill-board scene.
 *
 * No Angular, no skin coupling — usable from the scene component, skins, and
 * tests. Coordinates are in the scene's px space (viewport pixels).
 */

/** Points string for an equilateral triangle centred at (cx,cy), tip up. */
export function conePoints(cx: number, cy: number, r: number): string {
  const top = `${cx},${cy - r}`;
  const br = `${cx + r * 0.866},${cy + r * 0.5}`;
  const bl = `${cx - r * 0.866},${cy + r * 0.5}`;
  return `${top} ${br} ${bl}`;
}

/**
 * Mini football-shirt path centred at (cx,cy) with shoulder-width `w`
 * (body + two sleeves + collar notch). Tuned to read as a jersey at marker
 * scale (w ≈ 14–18 px on a 600-wide board).
 */
export function jerseyPath(cx: number, cy: number, w: number): string {
  const half = w / 2;
  const sl = w * 0.3; // sleeve overhang
  const top = cy - w * 0.4;
  const drop = w * 0.42; // sleeve length
  const bot = cy + w * 0.62;
  const col = w * 0.34; // collar width
  return [
    `M ${cx - half} ${top}`,
    `L ${cx - half - sl} ${top + w * 0.1}`,
    `L ${cx - half - sl} ${top + drop}`,
    `L ${cx - half} ${top + drop * 0.96}`,
    `L ${cx - half * 0.92} ${bot}`,
    `L ${cx + half * 0.92} ${bot}`,
    `L ${cx + half} ${top + drop * 0.96}`,
    `L ${cx + half + sl} ${top + drop}`,
    `L ${cx + half + sl} ${top + w * 0.1}`,
    `L ${cx + half} ${top}`,
    `L ${cx + col / 2} ${top}`,
    `L ${cx} ${top + w * 0.22}`,
    `L ${cx - col / 2} ${top}`,
    'Z',
  ].join(' ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football-ui -- drill-board-glyphs`
Expected: PASS (5 assertions across 3 tests).

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-glyphs.ts libs/pack-football-ui/src/lib/generation/drill-board-glyphs.spec.ts
git commit -m "feat(drill-board): add pure glyph geometry module (jersey + cone)"
```

---

### Task 2: Skin contract + `schematic` skin

**Files:**
- Create: `libs/pack-football-ui/src/lib/generation/drill-board-skins.ts`
- Create: `libs/pack-football-ui/src/lib/generation/drill-board-skins.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `drill-board-skins.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveSkin, SKINS } from './drill-board-skins.js';

describe('resolveSkin', () => {
  it('defaults to the schematic skin', () => {
    expect(resolveSkin().name).toBe('schematic');
    expect(resolveSkin(undefined).name).toBe('schematic');
  });

  it('returns the named skin', () => {
    expect(resolveSkin('matchday').name).toBe('matchday');
    expect(resolveSkin('telestrator').name).toBe('telestrator');
    expect(resolveSkin('arena').name).toBe('arena');
  });

  it('schematic preserves the legacy dot colours + circle glyph', () => {
    const s = SKINS.schematic;
    expect(s.dot.player.glyph).toBe('circle');
    expect(s.dot.player.fill).toBe('#2563eb');
    expect(s.dot.defender.fill).toBe('#dc2626');
    expect(s.dot.player.number).toBe(false);
    expect(s.surface.grass).toBe(false);
    expect(s.surface.lineColor).toBe('currentColor');
  });

  it('matchday uses jersey glyphs, numbers, and a grass surface', () => {
    const s = SKINS.matchday;
    expect(s.dot.player.glyph).toBe('jersey');
    expect(s.dot.player.number).toBe(true);
    expect(s.dot.keeper.glyph).toBe('jersey');
    expect(s.surface.grass).toBe(true);
    expect(s.surface.stripeCount).toBeGreaterThan(0);
  });

  it('every skin defines a style for every dot + arrow kind', () => {
    const dotKinds = ['player', 'defender', 'keeper', 'cone', 'ball'] as const;
    const arrowKinds = ['pass', 'run', 'dribble', 'shot'] as const;
    for (const skin of Object.values(SKINS)) {
      for (const k of dotKinds) expect(skin.dot[k]).toBeDefined();
      for (const k of arrowKinds) expect(skin.arrow[k]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football-ui -- drill-board-skins`
Expected: FAIL — `Cannot find module './drill-board-skins.js'`.

- [ ] **Step 3: Write the skin contract + all four skins**

Create `drill-board-skins.ts`. (Define all four now so later PRs only wire/render them — the data is cheap and keeps the contract in one place.)

```ts
import type { DrillArrowKind, DrillDotKind } from './drill-board.types.js';

export type DrillBoardSkinName = 'schematic' | 'matchday' | 'telestrator' | 'arena';

/** How a dot is drawn. ball/cone detail (flat vs rich) follows surface.richMarkers. */
export type DotGlyph = 'circle' | 'jersey' | 'ball' | 'cone';

export interface DotStyle {
  glyph: DotGlyph;
  fill: string; // kit body / marker fill
  stroke: string; // trim / outline
  number: boolean; // print the dot's number on the glyph?
  numberFill?: string; // per-kit contrast colour for the number
}

export interface ArrowStyle {
  stroke: string;
  dash: string; // SVG stroke-dasharray ('none' for solid)
  width: number;
}

export interface SkinSurface {
  grass: boolean; // paint a pitch-fill rect behind the markings?
  grassFill?: string;
  stripeFill?: string; // alternating mow-band colour
  stripeCount: number; // 0 = no stripes
  lineColor: string; // pitch markings ('currentColor' keeps host-driven colour)
  lineOpacity: number;
  glow: 'none' | 'soft' | 'neon'; // marker/arrow glow filter
  richMarkers: boolean; // gradients + drop-shadow on ball/cone/jersey
}

export interface DrillBoardSkin {
  name: DrillBoardSkinName;
  surface: SkinSurface;
  dot: Record<DrillDotKind, DotStyle>;
  arrow: Record<DrillArrowKind, ArrowStyle>;
}

// ─── schematic — today's clinical look (output byte-identical) ───────────────
const schematic: DrillBoardSkin = {
  name: 'schematic',
  surface: {
    grass: false,
    stripeCount: 0,
    lineColor: 'currentColor',
    lineOpacity: 0.4,
    glow: 'none',
    richMarkers: false,
  },
  dot: {
    player: { glyph: 'circle', fill: '#2563eb', stroke: '#1d4ed8', number: false },
    defender: { glyph: 'circle', fill: '#dc2626', stroke: '#b91c1c', number: false },
    keeper: { glyph: 'circle', fill: '#f59e0b', stroke: '#d97706', number: false },
    cone: { glyph: 'cone', fill: '#fb923c', stroke: '#ea580c', number: false },
    ball: { glyph: 'ball', fill: '#ffffff', stroke: '#374151', number: false },
  },
  arrow: {
    pass: { stroke: '#7dd3fc', dash: 'none', width: 1.5 },
    run: { stroke: '#86efac', dash: '6 4', width: 1.5 },
    dribble: { stroke: '#fcd34d', dash: '2 3', width: 1.5 },
    shot: { stroke: '#fca5a5', dash: 'none', width: 3 },
  },
};

// ─── matchday — grass + mini-shirts + numbers (Drill Library default) ─────────
const matchday: DrillBoardSkin = {
  name: 'matchday',
  surface: {
    grass: true,
    grassFill: '#2f9b4e',
    stripeFill: '#36a957',
    stripeCount: 8,
    lineColor: '#ffffff',
    lineOpacity: 0.92,
    glow: 'none',
    richMarkers: true,
  },
  dot: {
    player: { glyph: 'jersey', fill: '#d8243a', stroke: '#ffffff', number: true, numberFill: '#ffffff' },
    defender: { glyph: 'jersey', fill: '#1f5fd0', stroke: '#ffffff', number: true, numberFill: '#ffffff' },
    keeper: { glyph: 'jersey', fill: '#16a34a', stroke: '#062e16', number: true, numberFill: '#eafff2' },
    cone: { glyph: 'cone', fill: '#ff7a2d', stroke: '#b8430b', number: false },
    ball: { glyph: 'ball', fill: '#ffffff', stroke: '#222222', number: false },
  },
  arrow: {
    pass: { stroke: '#ffffff', dash: 'none', width: 1.6 },
    run: { stroke: '#ffd24a', dash: '6 4', width: 1.6 },
    dribble: { stroke: '#ffe48a', dash: '2 3', width: 1.6 },
    shot: { stroke: '#ff5d3a', dash: 'none', width: 3 },
  },
};

// ─── telestrator — dark broadcast pitch + neon glow ──────────────────────────
const telestrator: DrillBoardSkin = {
  name: 'telestrator',
  surface: {
    grass: true,
    grassFill: '#06150f',
    stripeFill: '#0e2a1e',
    stripeCount: 8,
    lineColor: '#3df0c2',
    lineOpacity: 0.55,
    glow: 'neon',
    richMarkers: false,
  },
  dot: {
    player: { glyph: 'jersey', fill: '#0b3a44', stroke: '#26e0ff', number: true, numberFill: '#bff3ff' },
    defender: { glyph: 'jersey', fill: '#3a0b2a', stroke: '#ff3ea5', number: true, numberFill: '#ffc4e6' },
    keeper: { glyph: 'jersey', fill: '#0c3a16', stroke: '#56ff9e', number: true, numberFill: '#d6ffe6' },
    cone: { glyph: 'cone', fill: '#ffb02e', stroke: '#ffd98a', number: false },
    ball: { glyph: 'ball', fill: '#ffffff', stroke: '#0e1014', number: false },
  },
  arrow: {
    pass: { stroke: '#26e0ff', dash: 'none', width: 1.8 },
    run: { stroke: '#ffd24a', dash: '6 4', width: 1.8 },
    dribble: { stroke: '#7dd3fc', dash: '2 3', width: 1.6 },
    shot: { stroke: '#ff5d3a', dash: 'none', width: 3.2 },
  },
};

// ─── arena — glossy FIFA-HUD + heat glows ────────────────────────────────────
const arena: DrillBoardSkin = {
  name: 'arena',
  surface: {
    grass: true,
    grassFill: '#123c25',
    stripeFill: '#16482c',
    stripeCount: 8,
    lineColor: '#bfe9cf',
    lineOpacity: 0.4,
    glow: 'soft',
    richMarkers: true,
  },
  dot: {
    player: { glyph: 'jersey', fill: '#37c8ff', stroke: '#d6fbff', number: true, numberFill: '#04222e' },
    defender: { glyph: 'jersey', fill: '#ff7a4d', stroke: '#ffe0d6', number: true, numberFill: '#2a0a02' },
    keeper: { glyph: 'jersey', fill: '#7ce08a', stroke: '#e9ffe9', number: true, numberFill: '#06280f' },
    cone: { glyph: 'cone', fill: '#ff9a3d', stroke: '#ffcaa0', number: false },
    ball: { glyph: 'ball', fill: '#ffffff', stroke: '#04222e', number: false },
  },
  arrow: {
    pass: { stroke: '#37e0ff', dash: 'none', width: 1.8 },
    run: { stroke: '#ffd24a', dash: '6 4', width: 1.8 },
    dribble: { stroke: '#9be7ff', dash: '2 3', width: 1.6 },
    shot: { stroke: '#ff6b3d', dash: 'none', width: 3.2 },
  },
};

export const SKINS: Record<DrillBoardSkinName, DrillBoardSkin> = {
  schematic,
  matchday,
  telestrator,
  arena,
};

export function resolveSkin(name: DrillBoardSkinName = 'schematic'): DrillBoardSkin {
  return SKINS[name] ?? SKINS.schematic;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football-ui -- drill-board-skins`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-skins.ts libs/pack-football-ui/src/lib/generation/drill-board-skins.spec.ts
git commit -m "feat(drill-board): add DrillBoardSkin contract + four skin definitions"
```

---

### Task 3: Scene component resolves visuals from the skin (schematic unchanged)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board.types.ts` (add `label?` to `DrillBoardDot`)
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.ts`
- Delete: `libs/pack-football-ui/src/lib/generation/drill-board-style.ts` (folded into `schematic`)
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.spec.ts` (add a default-skin guard test)

- [ ] **Step 1: Add `label?` to the view dot type**

In `drill-board.types.ts`, add the optional field to `DrillBoardDot` (used in PR 2; harmless now):

```ts
export interface DrillBoardDot {
  id: string;
  kind: DrillDotKind;
  cx: number;
  cy: number;
  label?: string; // jersey number/label, when present
  ariaLabel: string;
}
```

Re-export the skin types from the same barrel for ergonomic imports (append at end of file):

```ts
export type {
  DrillBoardSkin,
  DrillBoardSkinName,
  DotStyle,
  ArrowStyle,
  SkinSurface,
  DotGlyph,
} from './drill-board-skins.js';
```

- [ ] **Step 2: Write the failing guard test**

Append to `drill-board-scene.component.spec.ts`:

```ts
  it('default skin renders circle dots and NO grass rect (schematic parity)', () => {
    const fixture = TestBed.createComponent(DrillBoardSceneComponent);
    fixture.componentRef.setInput('diagram', makeDiagram());
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg') as SVGSVGElement;
    // No skin set → schematic: dots are <circle>, no jersey <path data-dot>.
    expect(svg.querySelectorAll('circle[data-dot]').length).toBe(2);
    expect(svg.querySelectorAll('path[data-dot]').length).toBe(0);
    // schematic paints no grass: there is no [data-grass] rect.
    expect(svg.querySelector('[data-grass]')).toBeNull();
  });

  it('matchday skin renders jersey dots, numbers, and a grass rect', () => {
    const fixture = TestBed.createComponent(DrillBoardSceneComponent);
    fixture.componentRef.setInput('diagram', makeDiagram());
    fixture.componentRef.setInput('skin', 'matchday');
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg') as SVGSVGElement;
    expect(svg.querySelector('[data-grass]')).not.toBeNull();
    // player + defender → 2 jersey paths.
    expect(svg.querySelectorAll('path[data-dot]').length).toBe(2);
    // Auto-numbered: at least one chest number <text data-dot-number>.
    expect(svg.querySelectorAll('text[data-dot-number]').length).toBeGreaterThanOrEqual(1);
  });
```

> Note: the second test depends on Task 6's auto-number layout. It will pass once Tasks 3 + 6 land. If running strictly per-task, expect this one to fail until Task 6; mark it `it.todo` here and convert to `it` in Task 6. Choose ONE: keep `it.todo('matchday … numbers')` in this task, flip to `it` in Task 6.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx nx test pack-football-ui -- drill-board-scene`
Expected: FAIL — `skin` input doesn't exist / circles still hardcoded.

- [ ] **Step 4: Rewrite the scene component to render from the skin**

Replace `drill-board-scene.component.ts` with the skin-driven version. Key changes: new `skin` input; `activeSkin` computed; surface (grass + stripes) layer with `[data-grass]`; glow/rich `<defs>`; pitch lines coloured from skin; arrows + dots resolve from skin; per-glyph dot rendering with optional number `<text data-dot-number>`; legend swatches from skin.

```ts
/**
 * DrillBoardSceneComponent — Layer 3 renderer for the drill-board scene.
 * READ-ONLY: inputs in, SVG out. Standalone, signals, OnPush, zoneless.
 *
 * Inputs:
 *   diagram  — required DrillDiagram (wire-schema mirror)
 *   viewport — optional DrillViewport (default 600×360 px)
 *   skin     — optional DrillBoardSkinName (default 'schematic' = legacy look)
 *
 * All visuals come from the resolved `DrillBoardSkin`; the data contract and
 * the a11y surface (hidden <ul>, role="img" summary, legend) are skin-agnostic.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import type { DrillDiagram } from '../data/wire-schemas.js';
import { boardMsg } from '../tactical-board/board-i18n.js';
import { conePoints, jerseyPath } from './drill-board-glyphs.js';
import { layoutDrillBoard } from './drill-board-layout.js';
import {
  resolveSkin,
  type DrillBoardSkinName,
} from './drill-board-skins.js';
import type {
  DrillArrowKind,
  DrillDotKind,
  DrillViewport,
} from './drill-board.types.js';
import { pitchGeometry } from './pitch.js';

const DOT_KINDS: readonly DrillDotKind[] = ['player', 'defender', 'keeper', 'cone', 'ball'];
const ARROW_KINDS: readonly DrillArrowKind[] = ['pass', 'run', 'dribble', 'shot'];
const JERSEY_W = 16; // shoulder-width (px) of a player jersey at default viewport

@Component({
  selector: 'lib-drill-board-scene',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host { display: block; }
      .sr-only {
        position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
        overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border-width: 0;
      }
      .drill-legend {
        display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 6px 0 2px;
        font-size: 0.78em; opacity: 0.85;
      }
      .drill-legend-item { display: flex; align-items: center; gap: 5px; }
    `,
  ],
  template: `
    @let v = view();
    @let skin = activeSkin();

    <!-- Visually-hidden ordered description for screen readers (skin-agnostic) -->
    <ul class="sr-only" [attr.aria-label]="elementsAria">
      @for (dot of v.dots; track dot.id) { <li>{{ dot.ariaLabel }}</li> }
      @for (arrow of v.arrows; track arrow.id) { <li>{{ arrow.ariaLabel }}</li> }
      @if (v.zone) { <li>{{ v.zone.ariaLabel }}</li> }
    </ul>

    <svg
      [attr.viewBox]="'0 0 ' + v.viewport.width + ' ' + v.viewport.height"
      [attr.width]="v.viewport.width"
      [attr.height]="v.viewport.height"
      role="img"
      [attr.aria-label]="v.summaryAriaLabel"
    >
      <defs>
        @for (kind of arrowKinds; track kind) {
          <marker
            [attr.id]="'arrowhead-' + kind" markerWidth="8" markerHeight="8"
            refX="6" refY="3" orient="auto"
          >
            <path d="M0,0 L0,6 L8,3 Z" [attr.fill]="skin.arrow[kind].stroke" />
          </marker>
        }
        @if (skin.surface.glow !== 'none') {
          <filter id="skin-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur [attr.stdDeviation]="skin.surface.glow === 'neon' ? 1.4 : 0.9" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        }
        @if (skin.surface.richMarkers) {
          <radialGradient id="skin-ball" cx="38%" cy="32%" r="72%">
            <stop offset="0" stop-color="#ffffff" /><stop offset="1" stop-color="#c9d0d8" />
          </radialGradient>
          <linearGradient id="skin-cone" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#ff8a3d" /><stop offset="1" stop-color="#e2560f" />
          </linearGradient>
          <filter id="skin-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.1" flood-color="#06210f" flood-opacity="0.5" />
          </filter>
        }
      </defs>

      <!-- Surface: grass + mow stripes (skin-gated, decorative) -->
      @if (skin.surface.grass) {
        <rect
          data-grass aria-hidden="true" x="0" y="0"
          [attr.width]="v.viewport.width" [attr.height]="v.viewport.height"
          [attr.fill]="skin.surface.grassFill"
        />
        @for (band of stripeBands(); track band.i) {
          <rect
            aria-hidden="true" x="0" [attr.y]="band.y"
            [attr.width]="v.viewport.width" [attr.height]="band.h"
            [attr.fill]="skin.surface.stripeFill"
          />
        }
      }

      <!-- Pitch markings (decorative) -->
      <g data-testid="pitch-decorations" aria-hidden="true">
        @for (geom of pitch(); track $index) {
          @switch (geom.kind) {
            @case ('rect') {
              <rect [attr.x]="geom.x" [attr.y]="geom.y" [attr.width]="geom.width" [attr.height]="geom.height"
                fill="none" [attr.stroke]="skin.surface.lineColor"
                [attr.stroke-opacity]="skin.surface.lineOpacity" stroke-width="0.8" />
            }
            @case ('line') {
              <line [attr.x1]="geom.x1" [attr.y1]="geom.y1" [attr.x2]="geom.x2" [attr.y2]="geom.y2"
                [attr.stroke]="skin.surface.lineColor"
                [attr.stroke-opacity]="skin.surface.lineOpacity" stroke-width="0.8" />
            }
            @case ('path') {
              <path [attr.d]="geom.d" fill="none" [attr.stroke]="skin.surface.lineColor"
                [attr.stroke-opacity]="skin.surface.lineOpacity" stroke-width="0.8" />
            }
          }
        }
      </g>

      <!-- Zone (decorative; <ul> is canonical) -->
      @if (v.zone) {
        <rect data-zone aria-hidden="true"
          [attr.x]="v.zone.x" [attr.y]="v.zone.y" [attr.width]="v.zone.w" [attr.height]="v.zone.h"
          fill="rgba(250,204,21,0.15)" stroke="#fbbf24" stroke-width="1" stroke-dasharray="5 3"
          [attr.aria-label]="v.zone.ariaLabel" />
      }

      <!-- Arrows (decorative) -->
      <g aria-hidden="true" [attr.filter]="skin.surface.glow !== 'none' ? 'url(#skin-glow)' : null">
        @for (arrow of v.arrows; track arrow.id) {
          <line data-arrow
            [attr.x1]="arrow.x1" [attr.y1]="arrow.y1" [attr.x2]="arrow.x2" [attr.y2]="arrow.y2"
            [attr.stroke]="skin.arrow[arrow.kind].stroke"
            [attr.stroke-width]="skin.arrow[arrow.kind].width"
            [attr.stroke-dasharray]="skin.arrow[arrow.kind].dash"
            [attr.marker-end]="'url(#arrowhead-' + arrow.kind + ')'"
            [attr.aria-label]="arrow.ariaLabel" />
        }
      </g>

      <!-- Dots (decorative) -->
      <g aria-hidden="true">
        @for (dot of v.dots; track dot.id) {
          @let ds = skin.dot[dot.kind];
          @switch (ds.glyph) {
            @case ('jersey') {
              <g [attr.filter]="markerFilter(skin)">
                <path data-dot [attr.d]="jerseyPath(dot.cx, dot.cy, jerseyW)"
                  [attr.fill]="ds.fill" [attr.stroke]="ds.stroke" stroke-width="0.8"
                  [attr.aria-label]="dot.ariaLabel" />
                @if (ds.number && dot.label) {
                  <text data-dot-number [attr.x]="dot.cx" [attr.y]="dot.cy + jerseyW * 0.28"
                    text-anchor="middle" [attr.font-size]="jerseyW * 0.42" font-weight="800"
                    [attr.fill]="ds.numberFill ?? '#ffffff'">{{ dot.label }}</text>
                }
              </g>
            }
            @case ('cone') {
              <polygon data-dot [attr.points]="conePoints(dot.cx, dot.cy, 7)"
                [attr.fill]="skin.surface.richMarkers ? 'url(#skin-cone)' : ds.fill"
                [attr.stroke]="ds.stroke" stroke-width="1"
                [attr.filter]="markerFilter(skin)" [attr.aria-label]="dot.ariaLabel" />
            }
            @case ('ball') {
              <circle data-dot [attr.cx]="dot.cx" [attr.cy]="dot.cy" r="5"
                [attr.fill]="skin.surface.richMarkers ? 'url(#skin-ball)' : ds.fill"
                [attr.stroke]="ds.stroke" stroke-width="1.2"
                [attr.filter]="markerFilter(skin)" [attr.aria-label]="dot.ariaLabel" />
            }
            @default {
              <circle data-dot [attr.cx]="dot.cx" [attr.cy]="dot.cy" r="8"
                [attr.fill]="ds.fill" [attr.stroke]="ds.stroke" stroke-width="1.2"
                [attr.aria-label]="dot.ariaLabel" />
            }
          }
        }
      </g>
    </svg>

    <!-- Legend (skin swatches) -->
    <div class="drill-legend" aria-hidden="true">
      @for (kind of dotKinds; track kind) {
        @let ds = activeSkin().dot[kind];
        <span class="drill-legend-item">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            @switch (ds.glyph) {
              @case ('jersey') { <path [attr.d]="jerseyPath(7, 7, 9)" [attr.fill]="ds.fill" [attr.stroke]="ds.stroke" stroke-width="0.5" /> }
              @case ('cone') { <polygon [attr.points]="conePoints(7, 7, 6)" [attr.fill]="ds.fill" [attr.stroke]="ds.stroke" stroke-width="1" /> }
              @case ('ball') { <circle cx="7" cy="7" r="4" [attr.fill]="ds.fill" [attr.stroke]="ds.stroke" stroke-width="1" /> }
              @default { <circle cx="7" cy="7" r="6" [attr.fill]="ds.fill" [attr.stroke]="ds.stroke" stroke-width="1" /> }
            }
          </svg>
          {{ kind }}
        </span>
      }
      @for (kind of arrowKinds; track kind) {
        <span class="drill-legend-item">
          <svg width="20" height="10" aria-hidden="true">
            <line x1="0" y1="5" x2="18" y2="5"
              [attr.stroke]="activeSkin().arrow[kind].stroke"
              [attr.stroke-width]="activeSkin().arrow[kind].width"
              [attr.stroke-dasharray]="activeSkin().arrow[kind].dash" />
          </svg>
          {{ kind }}
        </span>
      }
    </div>
  `,
})
export class DrillBoardSceneComponent {
  readonly diagram = input.required<DrillDiagram>();
  readonly viewport = input<DrillViewport>({ width: 600, height: 360 });
  readonly skin = input<DrillBoardSkinName>('schematic');

  protected readonly elementsAria = boardMsg('board.drillBoardScene.elementsAria');
  protected readonly dotKinds = DOT_KINDS;
  protected readonly arrowKinds = ARROW_KINDS;
  protected readonly jerseyW = JERSEY_W;

  readonly view = computed(() => layoutDrillBoard(this.diagram(), this.viewport()));
  readonly activeSkin = computed(() => resolveSkin(this.skin()));
  readonly pitch = computed(() => {
    const vp = this.viewport();
    return pitchGeometry(vp.width, vp.height);
  });

  /** Alternating mow-stripe bands across the pitch height. */
  readonly stripeBands = computed(() => {
    const skin = this.activeSkin();
    const vp = this.viewport();
    const n = skin.surface.stripeCount;
    if (!skin.surface.grass || n <= 0) return [] as { i: number; y: number; h: number }[];
    const h = vp.height / n;
    return Array.from({ length: n }, (_, i) => ({ i, y: i * h, h })).filter(
      (b) => b.i % 2 === 0,
    );
  });

  // Template helpers (pure passthroughs to the glyph module).
  protected jerseyPath(cx: number, cy: number, w: number): string {
    return jerseyPath(cx, cy, w);
  }
  protected conePoints(cx: number, cy: number, r: number): string {
    return conePoints(cx, cy, r);
  }
  protected markerFilter(skin: { surface: { richMarkers: boolean; glow: string } }): string | null {
    if (skin.surface.glow !== 'none') return 'url(#skin-glow)';
    if (skin.surface.richMarkers) return 'url(#skin-shadow)';
    return null;
  }
}
```

- [ ] **Step 5: Delete the old style module**

`drill-board-style.ts` is now fully superseded by `schematic` + the glyph module. Remove it and its imports:

```bash
git rm libs/pack-football-ui/src/lib/generation/drill-board-style.ts
```

Search for any remaining importers and update them to `drill-board-skins.ts` / `drill-board-glyphs.ts`:

Run: `npx nx test pack-football-ui -- drill-board` then `grep -rn "drill-board-style" libs/pack-football-ui/src` (expect: no matches).

- [ ] **Step 6: Adjust the matchday-numbers guard test for task ordering**

If you kept the `matchday … numbers` test as `it.todo` in Step 2, leave it `todo` — Task 6 flips it. The `default skin … schematic parity` test must PASS now.

- [ ] **Step 7: Run the full scene + layout + glyph + skin suite**

Run: `npx nx test pack-football-ui -- drill-board`
Expected: PASS — including the **unchanged** legacy specs (2 `[data-dot]`, 9 legend `<svg>`, cone polygon, zone rect, viewBox, read-only). The default-skin parity test passes; the matchday-numbers test is `todo`.

- [ ] **Step 8: Build to confirm Angular template compiles**

Run: `npx nx build pack-football-ui`
Expected: SUCCESS (no template type errors; `@let`, `@switch`, `input()` all compile under Angular 21).

- [ ] **Step 9: Commit**

```bash
git add libs/pack-football-ui/src/lib/generation/
git commit -m "refactor(drill-board): render from skin object; schematic output unchanged"
```

---

### Task 4: PR-1 verification gate

- [ ] **Step 1: Run the pack-football-ui lint + test + build**

```bash
npx nx lint pack-football-ui
npx nx test pack-football-ui
npx nx build pack-football-ui
```
Expected: all green. No visual change has shipped (default skin == schematic; no caller passes `skin` yet).

- [ ] **Step 2: Open PR 1**

Branch, push, PR titled `feat(drill-board): skin seam + schematic parity`. PR body includes:
```
Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]
Effect: cycle-time 0.01±0.02 expert
Effect: findings 1±1 expert
```

---

## PR 2 — Player numbers + Matchday (the visible win)

### Task 5: Add optional `label` to the diagram dot contract

**Files:**
- Modify: `libs/pack-football-contracts/src/lib/drill-diagram.schemas.ts`
- Modify: `libs/pack-football-contracts/src/lib/contracts.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `contracts.spec.ts` (match the file's existing `describe`/import style):

```ts
import { DrillDiagramDotSchema } from './drill-diagram.schemas.js';

describe('DrillDiagramDotSchema label', () => {
  it('accepts an optional short jersey label', () => {
    const ok = DrillDiagramDotSchema.safeParse({
      id: 'p1', kind: 'pack-football.drill-diagram.player', x: 10, y: 10, label: '7',
    });
    expect(ok.success).toBe(true);
  });

  it('still accepts a dot with no label (backward-compatible)', () => {
    const ok = DrillDiagramDotSchema.safeParse({
      id: 'p1', kind: 'pack-football.drill-diagram.player', x: 10, y: 10,
    });
    expect(ok.success).toBe(true);
  });

  it('rejects a label longer than 3 characters', () => {
    const bad = DrillDiagramDotSchema.safeParse({
      id: 'p1', kind: 'pack-football.drill-diagram.player', x: 10, y: 10, label: '1234',
    });
    expect(bad.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football-contracts -- contracts`
Expected: FAIL — `label` accepted-as-unknown or length not enforced (the first test may pass if zod ignores unknown keys; the **third** test fails because there's no max(3) rule). Confirm at least one assertion fails.

- [ ] **Step 3: Add the field**

In `drill-diagram.schemas.ts`, extend `DrillDiagramDotSchema`:

```ts
export const DrillDiagramDotSchema = z.object({
  id: z.string().min(1),
  kind: z.string().regex(/^pack-football\.drill-diagram\.[a-z-]+$/),
  x: z.number().min(0).max(100),
  y: z.number().min(0).max(60),
  /** Jersey label/number shown on the marker, e.g. "7", "10", "GK", "C". */
  label: z.string().max(3).optional(),
  metadata: z.record(z.unknown()).optional(),
});
```

> `schemaVersion` stays `…v1` — the field is optional, so all existing v1 diagrams validate unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football-contracts -- contracts`
Expected: PASS.

- [ ] **Step 5: Build the contracts lib so the dist `.d.ts` carries `label`**

Run: `npx nx build pack-football-contracts`
Expected: SUCCESS. (UI consumes the built type via `@de-braighter/pack-football-contracts`; rebuild so `DrillDiagramDot` exposes `label`.)

- [ ] **Step 6: Commit**

```bash
git add libs/pack-football-contracts/src/lib/drill-diagram.schemas.ts libs/pack-football-contracts/src/lib/contracts.spec.ts
git commit -m "feat(pack-football-contracts): optional jersey label on drill-diagram dot"
```

---

### Task 6: Thread `label` + auto-number fallback + numbered aria in the layout

**Files:**
- Modify: `libs/pack-football-ui/src/lib/tactical-board/board-i18n.ts` + `i18n/de/board.json` + `i18n/en/board.json`
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-layout.ts`
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-layout.spec.ts`

- [ ] **Step 1: Add the numbered-dot aria key to all three i18n sources**

In `board-i18n.ts` `BOARD_MESSAGES_DE`, add after `'board.drill.aria.dotAt'`:

```ts
  'board.drill.aria.dotAtNumbered': '{kind} Nr. {label} bei {x},{y}',
```

Add the same key+value to `libs/pack-football-ui/src/lib/i18n/de/board.json`. Add the English staging value to `libs/pack-football-ui/src/lib/i18n/en/board.json`:

```json
  "board.drill.aria.dotAtNumbered": "{kind} no. {label} at {x},{y}"
```

(The `de` JSON value must match the TS map exactly — `board-i18n.parity.spec.ts` asserts equality.)

- [ ] **Step 2: Write the failing layout test**

Add to `drill-board-layout.spec.ts`:

```ts
describe('layoutDrillBoard player numbers', () => {
  const numbered: DrillDiagram = {
    sceneKind: 'pack-football.drill-diagram.v1',
    schemaVersion: 'pack-football.drill-diagram.v1',
    dots: [
      { id: 'p1', kind: 'pack-football.drill-diagram.player', x: 10, y: 10 },
      { id: 'p2', kind: 'pack-football.drill-diagram.player', x: 20, y: 20, label: '9' },
      { id: 'd1', kind: 'pack-football.drill-diagram.defender', x: 30, y: 30 },
      { id: 'k1', kind: 'pack-football.drill-diagram.keeper', x: 40, y: 40 },
    ],
    arrows: [],
  };

  it('auto-numbers player/defender dots by order within their kind when no label', () => {
    const v = layoutDrillBoard(numbered, { width: 100, height: 60 });
    expect(v.dots[0].label).toBe('1'); // first player, no explicit label
    expect(v.dots[2].label).toBe('1'); // first defender (separate sequence)
  });

  it('respects an explicit label over the auto-number', () => {
    const v = layoutDrillBoard(numbered, { width: 100, height: 60 });
    expect(v.dots[1].label).toBe('9');
  });

  it('does NOT auto-number keeper/cone/ball dots', () => {
    const v = layoutDrillBoard(numbered, { width: 100, height: 60 });
    expect(v.dots[3].label).toBeUndefined(); // keeper, no explicit label
  });

  it('folds the number into the dot ariaLabel', () => {
    const v = layoutDrillBoard(numbered, { width: 100, height: 60 });
    expect(v.dots[1].ariaLabel).toContain('Nr. 9');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx nx test pack-football-ui -- drill-board-layout`
Expected: FAIL — `label` is `undefined`, no auto-number.

- [ ] **Step 4: Implement auto-number + label threading**

In `drill-board-layout.ts`, import the numbered aria key usage and rewrite the `dots` mapping. Replace the existing `const dots = diagram.dots.map(...)` block with:

```ts
  // Auto-number player/defender dots by order within their kind (1-based) when
  // they carry no explicit `label`; explicit labels always win. keeper/cone/ball
  // are not auto-numbered.
  const AUTO_NUMBER_KINDS: ReadonlySet<DrillDotKind> = new Set(['player', 'defender']);
  const seq: Partial<Record<DrillDotKind, number>> = {};

  const dots = diagram.dots.map((d) => {
    const kind = dotKind(d.kind);
    let label = d.label;
    if (label === undefined && AUTO_NUMBER_KINDS.has(kind)) {
      const next = (seq[kind] ?? 0) + 1;
      seq[kind] = next;
      label = String(next);
    }
    const x = Math.round(d.x);
    const y = Math.round(d.y);
    const ariaLabel =
      label !== undefined
        ? boardMsg('board.drill.aria.dotAtNumbered')
            .replace('{kind}', dotKindLabel(kind))
            .replace('{label}', label)
            .replace('{x}', String(x))
            .replace('{y}', String(y))
        : boardMsg('board.drill.aria.dotAt')
            .replace('{kind}', dotKindLabel(kind))
            .replace('{x}', String(x))
            .replace('{y}', String(y));
    return {
      id: d.id,
      kind,
      cx: d.x * sx,
      cy: d.y * sy,
      label,
      ariaLabel,
    };
  });
```

> `DrillDiagramDot` now carries `label` (Task 5), so `d.label` is typed. The view dot type already has `label?` (Task 3 Step 1).

- [ ] **Step 5: Run test to verify it passes**

Run: `npx nx test pack-football-ui -- drill-board-layout`
Expected: PASS. Also re-run the existing layout tests (the `Spieler` aria test still holds — auto-numbered players now read `Spieler Nr. 1 bei …`, which still `toContain('Spieler')`).

- [ ] **Step 6: Flip the matchday-numbers scene test from `todo` to `it`**

In `drill-board-scene.component.spec.ts`, change the `matchday … numbers` `it.todo` to `it`. Run:

Run: `npx nx test pack-football-ui -- drill-board-scene`
Expected: PASS — matchday now renders `text[data-dot-number]` because the layout auto-numbers the player+defender.

- [ ] **Step 7: Run the i18n parity spec**

Run: `npx nx test pack-football-ui -- board-i18n`
Expected: PASS — the new key exists in the TS map and `de/board.json` with identical values.

- [ ] **Step 8: Commit**

```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-layout.ts libs/pack-football-ui/src/lib/generation/drill-board-layout.spec.ts libs/pack-football-ui/src/lib/generation/drill-board-scene.component.spec.ts libs/pack-football-ui/src/lib/tactical-board/board-i18n.ts libs/pack-football-ui/src/lib/i18n/de/board.json libs/pack-football-ui/src/lib/i18n/en/board.json
git commit -m "feat(drill-board): auto-numbered player labels + numbered aria"
```

---

### Task 7: Hardwire Matchday in the Drill Library

**Files:**
- Modify: `libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.ts`
- Modify: `libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `drill-bibliothek.component.spec.ts` (follow the file's existing TestBed + client-mock setup; reuse its helper that loads a drill with a diagram and selects it). The assertion:

```ts
  it('renders the drill board with the matchday skin', async () => {
    // ... arrange: load catalog, select a drill that has a diagram ...
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const scene = fixture.nativeElement.querySelector('lib-drill-board-scene') as HTMLElement | null;
    expect(scene).not.toBeNull();
    // Matchday paints grass — assert the grass rect is present in the rendered board.
    expect(scene?.querySelector('[data-grass]')).not.toBeNull();
  });
```

> If the existing spec lacks a "select a drill with a diagram" path, model the new test on the existing `drill-detail` selection test in the same file; pick a seeded entry whose `diagram` is non-null.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx nx test pack-football-ui -- drill-bibliothek`
Expected: FAIL — no `[data-grass]` (the board still renders default schematic).

- [ ] **Step 3: Pass the skin**

In `drill-bibliothek.component.ts`, update the detail-board binding (currently `<lib-drill-board-scene [diagram]="entry.diagram" />`):

```html
              @if (entry.diagram !== null) {
                <lib-drill-board-scene [diagram]="entry.diagram" skin="matchday" />
              } @else {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx nx test pack-football-ui -- drill-bibliothek`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.ts libs/pack-football-ui/src/lib/drills/drill-bibliothek.component.spec.ts
git commit -m "feat(drill-library): render drill boards with the matchday skin"
```

---

### Task 8: PR-2 verification + manual look-check

- [ ] **Step 1: Full pack-football-ui gate**

```bash
npx nx lint pack-football-ui
npx nx test pack-football-ui
npx nx build pack-football-ui
```
Expected: all green.

- [ ] **Step 2: Manual visual check (per exercir CLAUDE.md — no preview_* on this machine; use the demo)**

Per the `exercir pack-football demo runtime` memory: start the web (:4200) + api (:3100) demo, open the Drill-Bibliothek, select a drill, confirm the board shows grass + mow stripes + white lines + mini-shirts with numbers (own red, opponent blue, keeper green) + real ball + 3D cones. Screenshot for the PR.

- [ ] **Step 3: Open PR 2**

PR `feat(drill-library): matchday skin — grass + mini-shirts with numbers`. Body:
```
Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effect: cycle-time 0.01±0.02 expert
Effect: findings 2±2 expert
```

---

## PR 3 — Telestrator + Arena skins (defined-and-ready)

> The skin objects already exist (Task 2). This PR adds **render coverage + tests** proving they render correctly, so they're production-ready for the live-match / progression surfaces when those land. No surface is wired to them yet (out of scope per spec §3).

### Task 9: Telestrator + Arena render coverage

**Files:**
- Modify: `libs/pack-football-ui/src/lib/generation/drill-board-scene.component.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add a parametrised suite:

```ts
import type { DrillBoardSkinName } from './drill-board-skins.js';

describe.each(['matchday', 'telestrator', 'arena'] as DrillBoardSkinName[])(
  'DrillBoardSceneComponent skin=%s',
  (skinName) => {
    it('renders jersey dots + a grass rect + numbers', () => {
      const fixture = TestBed.createComponent(DrillBoardSceneComponent);
      fixture.componentRef.setInput('diagram', makeDiagram());
      fixture.componentRef.setInput('skin', skinName);
      fixture.detectChanges();
      const svg = fixture.nativeElement.querySelector('svg') as SVGSVGElement;
      expect(svg.querySelector('[data-grass]')).not.toBeNull();
      expect(svg.querySelectorAll('path[data-dot]').length).toBe(2);
      expect(svg.querySelectorAll('text[data-dot-number]').length).toBeGreaterThanOrEqual(1);
    });
  },
);

describe('DrillBoardSceneComponent glow/rich defs', () => {
  it('telestrator emits a glow filter', () => {
    const fixture = TestBed.createComponent(DrillBoardSceneComponent);
    fixture.componentRef.setInput('diagram', makeDiagram());
    fixture.componentRef.setInput('skin', 'telestrator');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#skin-glow')).not.toBeNull();
  });

  it('arena emits the rich-marker ball gradient', () => {
    const fixture = TestBed.createComponent(DrillBoardSceneComponent);
    fixture.componentRef.setInput('diagram', makeDiagram());
    fixture.componentRef.setInput('skin', 'arena');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#skin-ball')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it passes immediately OR reveals a gap**

Run: `npx nx test pack-football-ui -- drill-board-scene`
Expected: PASS (the Task-3 component already renders glow/rich defs + jersey/number per skin). If any assertion fails, fix the component's `<defs>`/glyph branch — do NOT weaken the test.

> This is the rare case where the implementation (Task 3) precedes the test; that's fine — the test is the *regression guard* that telestrator/arena keep rendering. If everything passes first run, that confirms Task 3 generalised correctly.

- [ ] **Step 3: Commit**

```bash
git add libs/pack-football-ui/src/lib/generation/drill-board-scene.component.spec.ts
git commit -m "test(drill-board): render coverage for telestrator + arena skins"
```

---

### Task 10: PR-3 verification

- [ ] **Step 1: Full gate**

```bash
npx nx lint pack-football-ui
npx nx test pack-football-ui
npx nx build pack-football-ui
```
Expected: green.

- [ ] **Step 2: Open PR 3**

PR `feat(drill-board): telestrator + arena skins (defined-and-ready)`. Body:
```
Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effect: cycle-time 0.01±0.02 expert
Effect: findings 1±1 expert
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Skin system / contract → Task 2. ✅
- Four skins shipped → Task 2 (definitions) + Tasks 3/9 (render coverage). ✅
- Mini-jersey glyph → Task 1. ✅
- Player numbers (optional `label` + auto-fallback) → Tasks 5 + 6. ✅
- Matchday hardwired in Drill Library → Task 7. ✅
- `schematic` byte-identical default → Task 3 (parity test) + Task 4 (gate). ✅
- a11y preserved (hidden `<ul>`, role=img, legend, numbered aria) → Task 3 (unchanged a11y) + Task 6 (numbered aria + parity). ✅
- No kernel/design-system/API change → confined to `pack-football-ui` + `pack-football-contracts`. ✅
- Deferred: skin switcher, surface wiring of telestrator/arena, editor number input → not tasked (explicitly out of scope). ✅

**Placeholder scan:** No TBD/TODO; all code blocks complete; the one "model on existing test" note (Task 7 Step 1) points at a concrete sibling test rather than hand-waving. ✅

**Type consistency:** `DrillBoardSkin`/`DotStyle`/`SkinSurface`/`resolveSkin`/`SKINS` consistent across Tasks 2/3/9; `label` field consistent across contract (Task 5), view dot type (Task 3), and layout (Task 6); glyph names (`jersey`/`circle`/`ball`/`cone`) consistent between skins (Task 2) and the scene `@switch` (Task 3); i18n key `board.drill.aria.dotAtNumbered` consistent between Task 6 Steps 1 + 4. ✅

**Known ordering wrinkle (flagged in-task):** the matchday-numbers scene test depends on Task 6's auto-numbering; Task 3 Step 2 keeps it `it.todo`, Task 6 Step 6 flips it to `it`. ✅
