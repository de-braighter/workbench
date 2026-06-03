# Scene 5 — Tactical Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the live match-day tactical board (ADR-160 Scene 5) as a 4-PR cross-repo arc: verify/extend `<db-pitch>` in design-system, migrate `TacticalBoardComponent` to use it, add the Scene 5 host page wired to `ApplyPlanTreeEdit`, then expose the create-play gesture vocabulary with full WCAG 2.5.7 + keyboard compliance.

**Architecture:** `<db-pitch frame="full">` (design-system, SVG) is the shared pitch renderer consumed by both the authoring `TacticalBoardComponent` and the SSE-driven `CoachTacticalBoardComponent`. A new `MatchDayScene5PageComponent` in the visual-editor app mounts the authoring board and wires each `boardChange` emit to `gestureToTreeEdit → ApplyPlanTreeEditUseCase`. The create-play toolbar buttons wire the existing `addPlay` op with a two-click pointer path and a Space/Arrow/Space keyboard path.

**Tech Stack:** Angular 21 (signals, standalone, OnPush, zoneless), TypeScript, Vitest + Angular TestBed, axe-core, NestJS (API side for LineupChangedV1), SVG, `@de-braighter/substrate-contracts` (PlanTreeEdit), `@de-braighter/pack-football-contracts` (type promotion target).

---

## Pre-flight checks

Before starting, confirm:

```bash
# In layers/design-system
npx nx test design-system-angular   # must be green
npx nx build design-system-angular

# In domains/exercir
npx nx test pack-football-ui         # must be green
npx nx lint pack-football-ui
```

Also note the current `@de-braighter/design-system-angular` version consumed by exercir:

```bash
cat domains/exercir/package.json | grep design-system-angular
```

---

## Phase 1 — design-system: `<db-pitch>` full-frame verification + color tokens

**Repo:** `layers/design-system`
**PR closes:** #128 (tokens + contrast guard), #126 (pitch brick verified complete)

### File map (Phase 1)

| Action | File |
|---|---|
| Modify | `libs/design-system-angular/src/public/pitch/pitch.component.ts` |
| Modify | `libs/design-system-angular/src/public/pitch/db-pitch.spec.ts` |
| Modify | `libs/design-system-angular/src/lib/design-tokens/colors_and_type.css` (or wherever the token file lives — confirm with `find . -name "colors_and_type.css"`) |

---

### Task 1: Verify `frame="full"` renders both goals, halfway line, centre circle

- [ ] **Step 1: Read the existing spec to understand what's already tested**

```bash
cat layers/design-system/libs/design-system-angular/src/public/pitch/db-pitch.spec.ts
```

Look for any `frame="full"` test cases. Note which SVG elements are asserted.

- [ ] **Step 2: Read the component template to see if `full` renders two penalty areas and a centre circle**

```bash
cat layers/design-system/libs/design-system-angular/src/public/pitch/pitch.component.ts
```

Confirm: does the `full` branch render `[data-penalty-top]` AND `[data-penalty-bottom]`, a halfway line, and `[data-centre-circle]`?

- [ ] **Step 3: Add missing `full`-frame tests (if not already present)**

In `db-pitch.spec.ts`, add after the existing tests:

```typescript
describe('frame="full"', () => {
  it('renders both penalty areas', () => {
    TestBed.configureTestingModule({});
    const f = TestBed.createComponent(DbPitchComponent);
    f.componentRef.setInput('frame', 'full');
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-penalty-top]')).not.toBeNull();
    expect(el.querySelector('[data-penalty-bottom]')).not.toBeNull();
  });

  it('renders halfway line', () => {
    TestBed.configureTestingModule({});
    const f = TestBed.createComponent(DbPitchComponent);
    f.componentRef.setInput('frame', 'full');
    f.detectChanges();
    expect(
      (f.nativeElement as HTMLElement).querySelector('[data-halfway]'),
    ).not.toBeNull();
  });

  it('renders centre circle', () => {
    TestBed.configureTestingModule({});
    const f = TestBed.createComponent(DbPitchComponent);
    f.componentRef.setInput('frame', 'full');
    f.detectChanges();
    expect(
      (f.nativeElement as HTMLElement).querySelector('[data-centre-circle]'),
    ).not.toBeNull();
  });

  it('viewBox is 100 120', () => {
    TestBed.configureTestingModule({});
    const f = TestBed.createComponent(DbPitchComponent);
    f.componentRef.setInput('frame', 'full');
    f.detectChanges();
    const svg = (f.nativeElement as HTMLElement).querySelector('svg');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 100 120');
  });
});
```

- [ ] **Step 4: Run tests — expect FAIL if `full` frame is incomplete**

```bash
cd layers/design-system && npx nx test design-system-angular
```

- [ ] **Step 5: If tests fail, implement the missing `full`-frame SVG elements**

Open `pitch.component.ts`. In the `full` branch of the template, ensure:

```html
<!-- halfway line -->
<line data-halfway x1="0" y1="60" x2="100" y2="60" stroke="var(--db-pitch-line,#fff)" stroke-width="0.5"/>

<!-- centre circle (r≈9.15 on 100×120 scale) -->
<circle data-centre-circle cx="50" cy="60" r="9" stroke="var(--db-pitch-line,#fff)" stroke-width="0.5" fill="none"/>

<!-- bottom penalty area (mirror of top) -->
<rect data-penalty-bottom x="21.1" y="100.5" width="57.8" height="16.5"
  stroke="var(--db-pitch-line,#fff)" stroke-width="0.5" fill="none"/>
<rect x="32.1" y="105.5" width="35.8" height="11.5"
  stroke="var(--db-pitch-line,#fff)" stroke-width="0.5" fill="none"/>
```

Adjust exact coordinates to match the geometry already used in the top penalty area (mirror at y=60).

- [ ] **Step 6: Run tests — expect PASS**

```bash
npx nx test design-system-angular
```

- [ ] **Step 7: Commit**

```bash
cd layers/design-system
git checkout -b feat/db-pitch-full-frame-tokens
git add libs/design-system-angular/src/public/pitch/
git commit -m "test(design-system): verify db-pitch full-frame renders both goals + halfway + centre circle"
```

---

### Task 2: Add football pitch color tokens

- [ ] **Step 1: Find the token file**

```bash
find layers/design-system -name "colors_and_type.css" -not -path "*/node_modules/*"
```

- [ ] **Step 2: Add tokens** (append to the pitch section, or create one if absent)

```css
/* ─── Football pitch tokens ──────────────────────────────────────────── */
--db-pitch-surface: #2d5a1b;   /* Grass fill */
--db-pitch-line: #ffffff;       /* Field markings */
--db-pitch-chip-bg: #1a3a0f;   /* Player chip background */
--db-pitch-chip-text: #ffffff;  /* Player chip label — ≈12:1 on chip-bg (AAA) */
```

- [ ] **Step 3: Wire the tokens into `pitch.component.ts`**

Replace any hardcoded fill/stroke on the pitch surface rect with `var(--db-pitch-surface, #2d5a1b)` and lines with `var(--db-pitch-line, #ffffff)`.

- [ ] **Step 4: Add contrast-guard unit test**

In `db-pitch.spec.ts`, add:

```typescript
describe('pitch color tokens — WCAG 1.4.3 contrast guard', () => {
  function hexToRgb(hex: string): [number, number, number] {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function relativeLuminance([r, g, b]: [number, number, number]): number {
    const s = [r, g, b].map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * s[0]! + 0.7152 * s[1]! + 0.0722 * s[2]!;
  }

  function contrastRatio(fg: string, bg: string): number {
    const l1 = relativeLuminance(hexToRgb(fg));
    const l2 = relativeLuminance(hexToRgb(bg));
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }

  it('--db-pitch-chip-text on --db-pitch-chip-bg meets WCAG AA (≥4.5:1)', () => {
    // Values must match tokens in colors_and_type.css — update both together.
    const chipText = '#ffffff';
    const chipBg = '#1a3a0f';
    expect(contrastRatio(chipText, chipBg)).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
npx nx test design-system-angular
```

- [ ] **Step 6: Commit**

```bash
git add libs/design-system-angular/src/public/pitch/ libs/design-system-angular/src/lib/design-tokens/
git commit -m "feat(design-system): football pitch color tokens + contrast-guard test (#128)"
```

---

### Task 3: Publish new design-system version

- [ ] **Step 1: Bump patch version in `design-system-angular/package.json`**

Check current version:
```bash
cat layers/design-system/libs/design-system-angular/package.json | grep '"version"'
```

Bump patch (e.g. `1.4.2` → `1.4.3`).

- [ ] **Step 2: Build**

```bash
cd layers/design-system && npx nx build design-system-angular
```

- [ ] **Step 3: Publish to GitHub Packages**

```bash
cd layers/design-system/dist/libs/design-system-angular
npm publish
```

- [ ] **Step 4: Create PR, run verifier wave, merge**

```bash
cd layers/design-system
git push -u origin feat/db-pitch-full-frame-tokens
gh pr create --title "feat(design-system): db-pitch full-frame + football pitch tokens (#126, #128)"
```

Run verifier wave (local-ci + reviewer + charter-checker + qa-engineer) before merging.

---

## Phase 2 — exercir: ADR-160 amendment + board migration

**Repo:** `domains/exercir`
**PR closes:** #125 (converge), #126 (pitch promotion complete)

### File map (Phase 2)

| Action | File |
|---|---|
| Modify | `libs/pack-football-ui/src/lib/tactical-board/tactical-board.component.ts` |
| Modify | `libs/pack-football-ui/src/lib/tactical-board/tactical-board.component.spec.ts` |
| Modify | `libs/pack-football-ui/src/lib/tactical-board/tactical-board-layout.ts` (consolidate) |
| Bump | `package.json` — `@de-braighter/design-system-angular` version |
| Specs PR | `layers/specs/adr/adr-160-*.md` — amendment (parallel specs repo PR) |

---

### Task 4: Bump design-system version in exercir

- [ ] **Step 1: Update `package.json`**

In `domains/exercir/package.json`, update:

```json
"@de-braighter/design-system-angular": "^1.4.3"
```

(Use the version published in Task 3.)

- [ ] **Step 2: Install**

```bash
cd domains/exercir && npm install
```

- [ ] **Step 3: Verify existing tests still pass**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/scene5-board-migration
git add package.json package-lock.json
git commit -m "chore(exercir): bump design-system-angular to pick up db-pitch full-frame + tokens"
```

---

### Task 5: Migrate `TacticalBoardComponent` to use `<db-pitch frame="full">`

- [ ] **Step 1: Read the current template pitch section**

```bash
grep -n "viewBox\|circle\|penalty\|halfway\|pitch" \
  domains/exercir/libs/pack-football-ui/src/lib/tactical-board/tactical-board.component.ts \
  | head -30
```

Note which SVG lines constitute the field chrome (touchlines, goals, halfway line, boxes, centre circle).

- [ ] **Step 2: Add `DbPitchComponent` import to `TacticalBoardComponent`**

In `tactical-board.component.ts`, add to `imports` array:

```typescript
import { DbPitchComponent } from '@de-braighter/design-system-angular';

@Component({
  // ...
  imports: [DbPitchComponent],  // add this
})
```

- [ ] **Step 3: Replace the inline SVG field chrome with `<db-pitch>`**

In the template, find the `<svg>` element that contains field chrome (touchlines, halfway line, penalty areas, goals, centre circle — NOT the slot chips or play annotations).

Replace the field chrome `<g>` with:

```html
<db-pitch frame="full" style="position:absolute;inset:0;width:100%;height:100%;">
  <!-- slot chips, bench rail, and play annotations remain here as overlay children -->
</db-pitch>
```

The slot chip `<g>` elements and play annotation paths become children of `<db-pitch>` — they overlay via `position: absolute` or are projected as `<ng-content>` if the brick supports it (check the brick's template for `<ng-content>`; if not, use absolute positioning wrapper).

- [ ] **Step 4: Update `tacticalPitchGeometry()` call**

`TacticalBoardComponent` likely calls `tacticalPitchGeometry()` from `tactical-board-geometry.ts` for the pitch chrome. This call can be removed now that `<db-pitch>` handles it. Check if `tacticalPitchGeometry()` is used elsewhere — if only used by this component, delete the import.

- [ ] **Step 5: Run the spec — expect PASS (no pitch chrome tests should break)**

```bash
npx nx test pack-football-ui
```

If tests fail because they assert on pitch SVG elements that are now inside `<db-pitch>` (jsdom renders the brick), check whether `DbPitchComponent` is imported in the TestBed config. Add it if missing:

```typescript
TestBed.configureTestingModule({ imports: [TacticalBoardComponent, DbPitchComponent] });
```

- [ ] **Step 6: Update existing spec assertions that relied on inline pitch elements**

Any test asserting `[data-penalty]`, `[data-halfway]`, etc. on the root element now needs to query inside the `<db-pitch>` host element. Since `DbPitchComponent` is a real Angular component in jsdom, its template renders normally.

- [ ] **Step 7: Commit**

```bash
git add libs/pack-football-ui/src/lib/tactical-board/
git commit -m "feat(pack-football-ui): migrate TacticalBoardComponent to use db-pitch frame=full (#125, #126)"
```

---

### Task 6: Consolidate `tactical-board-layout.ts` (remove coach-board geometry duplication)

- [ ] **Step 1: Check if the coach board duplicates layout helpers**

```bash
grep -n "tacticalPitchGeometry\|layoutTacticalBoard\|TACTICAL_PITCH" \
  domains/exercir/libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board.component.ts \
  | head -10
```

- [ ] **Step 2: If the coach board has its own geometry helpers, redirect them**

If `coach-tactical-board.component.ts` imports from a local `generation/tactical-board-layout.ts` that overlaps with the authoring board's `tactical-board/tactical-board-layout.ts`:

- Identify the duplicate functions (e.g. slot position calculations)
- Update `coach-tactical-board.component.ts` to import from `tactical-board/tactical-board-layout.js` instead
- Delete the duplicated code from the generation helper

- [ ] **Step 3: Run tests**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 4: Commit (only if changes were needed)**

```bash
git add libs/pack-football-ui/src/lib/
git commit -m "refactor(pack-football-ui): consolidate tactical-board layout helpers (#125)"
```

---

### Task 7: File ADR-160 amendment (specs repo)

This is a parallel specs repo PR — file it now so it can be reviewed alongside the exercir PR.

- [ ] **Step 1: Find ADR-160 in `layers/specs/adr/`**

```bash
find layers/specs/adr -name "*160*"
```

- [ ] **Step 2: Append amendment section**

At the end of the ADR file, add:

```markdown
## Amendment — 2026-06-03

Supersedes the 2026-05-22 Konva note. Resolves three open questions:

**OQ-Render → SVG.** All three existing pitch implementations (drill-board 100×60, coach lineup, tactical-board 100×120) landed as SVG and pass jsdom tests without the `canvas` npm package. Konva costs (canvas dep, test-environment overhead, divergence from all other pitch renderers) do not pay off at v1 scale (11 players, single-editor). SVG is the canonical renderer for all pitch surfaces.

**OQ-Location → `<db-pitch>` enhanced in place.** The `frame: 'mini'|'half'|'full'` prop already exists on the design-system brick. No new brick needed; football-specific pitch tokens (`--db-pitch-*`) are added alongside it.

**OQ-Convergence → shared renderer, separate components.** `TacticalBoardComponent` (optimistic undo-redo) and `CoachTacticalBoardComponent` (SSE append-only reconciliation) keep separate state models. Both consume `<db-pitch frame="full">`. True component merge is deferred to v2 (multi-editor Yjs arc).
```

- [ ] **Step 3: PR, verifier wave, merge in specs repo**

```bash
cd layers/specs
git checkout -b adr/160-scene5-amendment
git add adr/
git commit -m "adr(160): Scene 5 amendment — SVG, db-pitch in-place, separate components"
git push -u origin adr/160-scene5-amendment
gh pr create --title "adr(160): Scene 5 amendment — SVG canonical, shared renderer, separate boards"
```

---

### Task 8: PR-2 — create exercir PR, wave, merge

- [ ] **Step 1: Push branch**

```bash
cd domains/exercir && git push -u origin feat/scene5-board-migration
```

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "feat(pack-football-ui): Scene 5 board migration — db-pitch frame=full (#125, #126)" \
  --body "Migrates TacticalBoardComponent to consume <db-pitch frame=full> from design-system. Consolidates layout helpers. Closes #125, #126.

Closes #125
Closes #126

Producer: orchestrator/claude-sonnet-4-6 [subagent-driven-development]
Effect: cycle-time 0.1±0.05 expert
Effect: findings 0±1 expert"
```

- [ ] **Step 3: Run verifier wave (local-ci + reviewer + charter-checker + qa-engineer + exercir-charter-checker)**

- [ ] **Step 4: Merge when green**

```bash
gh pr merge --squash --delete-branch
```

---

## Phase 3 — exercir: Scene 5 host wiring

**PR closes:** #129 (host wiring)

### File map (Phase 3)

| Action | File |
|---|---|
| Create | `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts` |
| Create | `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.spec.ts` |
| Modify | `libs/pack-football-ui/src/lib/tactical-board/tactical-board-tree-ops.ts` (treeRootId fix) |
| Create | `libs/pack-football-contracts/src/lib/tactical-board.types.ts` |
| Modify | `libs/pack-football-contracts/src/index.ts` (new exports) |
| Modify | `libs/pack-football-ui/src/lib/tactical-board/tactical-board.types.ts` (re-export) |
| Modify | `apps/pack-football-api/src/app/app.module.ts` (LineupChangedV1 wiring) |

---

### Task 9: Promote `TacticalBoardView`, `BoardSlot`, `BenchPlayer` to `pack-football-contracts`

- [ ] **Step 1: Create `libs/pack-football-contracts/src/lib/tactical-board.types.ts`**

```typescript
/**
 * Tactical-board wire types — promoted from pack-football-ui so the server
 * can deserialize plan_node.metadata.visualEditor without pulling the Angular
 * bundle. Matches the shapes in tactical-board.types.ts exactly.
 */

export interface TacticalBoardView {
  viewport: BoardViewport;
  slots: readonly BoardSlot[];
  bench: readonly BenchPlayer[];
  formationKey: string;
  summaryAriaLabel: string;
}

export interface BoardViewport {
  width: number;
  height: number;
}

export interface BoardSlot {
  slotIndex: number;
  position: string;
  cx: number;
  cy: number;
  playerId: string | null;
  playerNumber: number | null;
  displayName: string | null;
  isCaptain: boolean;
  ariaLabel: string;
}

export interface BenchPlayer {
  playerId: string;
  jerseyNumber: number;
  displayName: string;
  position: string;
  ariaLabel: string;
}
```

- [ ] **Step 2: Export from `pack-football-contracts/src/index.ts`**

Add:

```typescript
export {
  type TacticalBoardView,
  type BoardViewport,
  type BoardSlot,
  type BenchPlayer,
} from './lib/tactical-board.types.js';
```

- [ ] **Step 3: Update `tactical-board.types.ts` in `pack-football-ui` to re-export from contracts**

In `libs/pack-football-ui/src/lib/tactical-board/tactical-board.types.ts`, change the type definitions to re-exports:

```typescript
// Types promoted to @de-braighter/pack-football-contracts — re-exported here
// so existing pack-football-ui consumers are not broken.
export type {
  TacticalBoardView,
  BoardViewport,
  BoardSlot,
  BenchPlayer,
} from '@de-braighter/pack-football-contracts';

// Types that remain pack-football-ui internal (not on the wire):
export const TACTICAL_PITCH_HEIGHT = 120;
export const TACTICAL_PITCH_LENGTH = 100;
// ... (keep all non-wire types as-is)
```

- [ ] **Step 4: Run tests**

```bash
npx nx test pack-football-ui pack-football-contracts
```

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/scene5-host-wiring
git add libs/pack-football-contracts/ libs/pack-football-ui/src/lib/tactical-board/tactical-board.types.ts
git commit -m "feat(pack-football-contracts): promote TacticalBoardView + BoardSlot + BenchPlayer from pack-football-ui (#129)"
```

---

### Task 10: Fix `treeRootId` seam in `gestureToTreeEdit`

- [ ] **Step 1: Read `tactical-board-tree-ops.ts` around the seam**

```bash
grep -n "treeRootId\|parentNodeId\|snapshotInsertion" \
  domains/exercir/libs/pack-football-ui/src/lib/tactical-board/tactical-board-tree-ops.ts
```

- [ ] **Step 2: Write a failing test that proves the seam is fixed**

In a new or existing spec for `tactical-board-tree-ops.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { gestureToTreeEdit } from './tactical-board-tree-ops.js';
import { EMPTY_BOARD } from './tactical-board.store.js'; // or import a stub board

it('gestureToTreeEdit snapshot-formation: treeRootId in the returned edit matches the passed rootId', () => {
  const treeRootId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const nodeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const gesture = { kind: 'snapshot-formation' as const, label: 'Min 45' };
  const board = EMPTY_BOARD; // use whatever stub exists in the codebase

  const edit = gestureToTreeEdit(nodeId, gesture, board, treeRootId);

  // The subtree-insertion must carry the correct treeRootId, not parentNodeId.
  expect(edit.kind).toBe('subtree-insertion');
  if (edit.kind === 'subtree-insertion') {
    expect(edit.node.treeRootId).toBe(treeRootId);
  }
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 4: Fix `gestureToTreeEdit` to accept and thread `treeRootId`**

Update the function signature in `tactical-board-tree-ops.ts`:

```typescript
export function gestureToTreeEdit(
  nodeId: string,
  gesture: TacticalGesture,
  board: TacticalBoard,
  treeRootId: string,  // ← new param; was defaulting to nodeId inside snapshotInsertion
): PlanTreeEdit {
  // ... existing cases unchanged ...
  case 'snapshot-formation':
    return snapshotInsertion(nodeId, gesture.label, board, treeRootId); // pass through
}
```

Update `snapshotInsertion`:

```typescript
function snapshotInsertion(
  parentNodeId: string,
  label: string,
  board: TacticalBoard,
  treeRootId: string,  // ← was using parentNodeId as fallback; now always explicit
): PlanTreeEdit {
  return {
    kind: 'subtree-insertion',
    node: {
      id: crypto.randomUUID(),
      parentId: parentNodeId,
      treeRootId,               // ← fixed: was `parentNodeId`
      kind: 'phase',
      kindRef: 'formation-snapshot',
      ordinal: 0,
      metadata: { label, visualEditor: { ...board } },
    },
  };
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 6: Commit**

```bash
git add libs/pack-football-ui/src/lib/tactical-board/tactical-board-tree-ops.ts
git commit -m "fix(pack-football-ui): gestureToTreeEdit threads treeRootId to snapshotInsertion (#129)"
```

---

### Task 11: Create `MatchDayScene5PageComponent`

- [ ] **Step 1: Write the spec first**

Create `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.spec.ts`:

```typescript
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APPLY_PLAN_TREE_EDIT_USE_CASE } from 'pack-football';
import { TacticalBoardComponent } from '../../tactical-board/tactical-board.component.js';
import { MatchDayScene5PageComponent } from './match-day-scene5-page.component.js';

const TREE_ROOT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MATCH_NODE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

class FakeApplyPlanTreeEditUseCase {
  calls: Array<{ treeRootId: string; edit: unknown }> = [];
  async applyEdit(treeRootId: string, edit: unknown) {
    this.calls.push({ treeRootId, edit });
    return { ok: true, value: {} };
  }
}

function setup() {
  const useCase = new FakeApplyPlanTreeEditUseCase();
  TestBed.configureTestingModule({
    providers: [
      { provide: APPLY_PLAN_TREE_EDIT_USE_CASE, useValue: useCase },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { params: { treeRootId: TREE_ROOT_ID, matchNodeId: MATCH_NODE_ID } },
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(MatchDayScene5PageComponent);
  fixture.detectChanges();
  return { fixture, useCase, root: fixture.nativeElement as HTMLElement };
}

describe('MatchDayScene5PageComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders the tactical board', () => {
    const { root } = setup();
    expect(root.querySelector('lib-tactical-board')).not.toBeNull();
  });

  it('calls applyEdit with the correct treeRootId on boardChange', async () => {
    const { fixture, useCase } = setup();
    const board = fixture.componentInstance;
    const tbFixture = fixture.debugElement.query(
      (el) => el.componentInstance instanceof TacticalBoardComponent,
    );
    tbFixture.componentInstance.boardChange.emit({
      gesture: { kind: 'set-captain', slotId: 'slot-1' },
      board: {} as never,
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(useCase.calls).toHaveLength(1);
    expect(useCase.calls[0]?.treeRootId).toBe(TREE_ROOT_ID);
  });

  it('surfaces a tree-not-found error via inline error state', async () => {
    const { fixture, useCase, root } = setup();
    useCase.applyEdit = async () => ({
      ok: false,
      error: { kind: 'tree-not-found', treeRootId: TREE_ROOT_ID },
    });
    const tbFixture = fixture.debugElement.query(
      (el) => el.componentInstance instanceof TacticalBoardComponent,
    );
    tbFixture.componentInstance.boardChange.emit({
      gesture: { kind: 'set-captain', slotId: 'slot-1' },
      board: {} as never,
    });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(root.querySelector('[data-testid="scene5-error"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL (component doesn't exist)**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 3: Implement `MatchDayScene5PageComponent`**

Create `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts`:

```typescript
import {
  ChangeDetectionStrategy,
  Component,
  Inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import {
  APPLY_PLAN_TREE_EDIT_USE_CASE,
  type ApplyPlanTreeEditUseCase,
} from 'pack-football';
import { TacticalBoardComponent } from '../../tactical-board/tactical-board.component.js';
import { gestureToTreeEdit } from '../../tactical-board/tactical-board-tree-ops.js';
import type { TacticalBoard, TacticalGesture } from '../../tactical-board/tactical-board.types.js';

type PageError = { kind: 'tree-not-found' } | { kind: 'invalid-input'; detail: string };

@Component({
  selector: 'lib-match-day-scene5-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TacticalBoardComponent],
  template: `
    @if (error(); as err) {
      <p class="status error" data-testid="scene5-error">
        {{ err.kind === 'tree-not-found' ? 'Spiel nicht gefunden.' : 'Ungültige Änderung: ' + err.detail }}
      </p>
    }
    <lib-tactical-board
      [board]="initialBoard()"
      (boardChange)="onBoardChange($event)"
    />
  `,
})
export class MatchDayScene5PageComponent implements OnInit {
  protected readonly error = signal<PageError | null>(null);
  protected readonly initialBoard = signal<TacticalBoard | null>(null);

  private readonly treeRootId: string;
  private readonly matchNodeId: string;

  constructor(
    private readonly route: ActivatedRoute,
    @Inject(APPLY_PLAN_TREE_EDIT_USE_CASE)
    private readonly applyEditUseCase: ApplyPlanTreeEditUseCase,
  ) {
    this.treeRootId = this.route.snapshot.params['treeRootId'] as string;
    this.matchNodeId = this.route.snapshot.params['matchNodeId'] as string;
  }

  ngOnInit(): void {
    // TODO: load board from plan tree metadata in a follow-up slice.
    // For v1, the board is initialised empty; the SSE stream reconciles it.
    this.initialBoard.set(null);
  }

  protected async onBoardChange(event: { gesture: TacticalGesture; board: TacticalBoard }): Promise<void> {
    this.error.set(null);
    const edit = gestureToTreeEdit(
      this.matchNodeId,
      event.gesture,
      event.board,
      this.treeRootId,
    );
    const result = await this.applyEditUseCase.applyEdit(this.treeRootId, edit);
    if (!result.ok) {
      this.error.set(result.error);
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts \
        libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.spec.ts
git commit -m "feat(pack-football-ui): MatchDayScene5PageComponent wired to ApplyPlanTreeEdit (#129)"
```

---

### Task 12: Publish LineupChangedV1 on substitute

- [ ] **Step 1: Find where LineupChangedV1 is defined**

```bash
grep -rn "LineupChangedV1\|LineupChanged" \
  domains/exercir/libs/pack-football/src/ \
  --include="*.ts" | head -10
```

- [ ] **Step 2: Write a test that `onBoardChange` with a substitute gesture publishes the event**

In `match-day-scene5-page.component.spec.ts`, add:

```typescript
import { type SseLiveTelemetryPort, SSE_LIVE_TELEMETRY_PORT } from 'pack-football';

it('publishes LineupChangedV1 to SSE event log on substitute gesture', async () => {
  const published: unknown[] = [];
  const fakeSse = { publishEvent: (e: unknown) => published.push(e) };

  TestBed.configureTestingModule({
    providers: [
      { provide: APPLY_PLAN_TREE_EDIT_USE_CASE, useValue: new FakeApplyPlanTreeEditUseCase() },
      { provide: SSE_LIVE_TELEMETRY_PORT, useValue: fakeSse },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { params: { treeRootId: TREE_ROOT_ID, matchNodeId: MATCH_NODE_ID } } },
      },
    ],
  });
  const fixture = TestBed.createComponent(MatchDayScene5PageComponent);
  fixture.detectChanges();

  const tbFixture = fixture.debugElement.query(
    (el) => el.componentInstance instanceof TacticalBoardComponent,
  );
  tbFixture.componentInstance.boardChange.emit({
    gesture: { kind: 'substitute', playerOutId: 'p1', playerInId: 'p2', minute: 60 },
    board: {} as never,
  });
  await fixture.whenStable();

  expect(published.some((e: any) => e.eventType === 'football:LineupChanged.v1')).toBe(true);
});
```

- [ ] **Step 3: Run — expect FAIL**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 4: Implement SSE publish in `MatchDayScene5PageComponent`**

Inject the SSE port and publish on substitute:

```typescript
// In constructor:
@Inject(SSE_LIVE_TELEMETRY_PORT) private readonly sseTelemetry: SseLiveTelemetryPort,

// In onBoardChange, after applyEdit succeeds:
if (result.ok && event.gesture.kind === 'substitute') {
  this.sseTelemetry.publishEvent({
    eventType: 'football:LineupChanged.v1',
    payload: {
      matchId: this.matchNodeId,
      playerOutId: event.gesture.playerOutId,
      playerInId: event.gesture.playerInId,
      minute: event.gesture.minute,
    },
  });
}
```

(Adjust `SseLiveTelemetryPort` to the actual port interface — check `grep -rn "SseLiveTelemetryPort" libs/pack-football/src/` for the real type name.)

- [ ] **Step 5: Run — expect PASS**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 6: Commit**

```bash
git add libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts \
        libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.spec.ts
git commit -m "feat(pack-football-ui): publish LineupChangedV1 on substitute in Scene 5 page (#129)"
```

---

### Task 13: PR-3 — create exercir PR, wave, merge

- [ ] **Step 1: Push**

```bash
cd domains/exercir && git push -u origin feat/scene5-host-wiring
```

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "feat(pack-football-ui): Scene 5 host wiring → ApplyPlanTreeEdit + type promotion (#129)" \
  --body "MatchDayScene5PageComponent wires TacticalBoardComponent.boardChange to gestureToTreeEdit → ApplyPlanTreeEdit. Fixes treeRootId seam. Publishes LineupChangedV1 on substitute. Promotes TacticalBoardView/BoardSlot/BenchPlayer to pack-football-contracts.

Closes #129

Producer: orchestrator/claude-sonnet-4-6 [subagent-driven-development]
Effect: cycle-time 0.1±0.05 expert
Effect: findings 0±1 expert"
```

- [ ] **Step 3: Run verifier wave (local-ci + reviewer + charter-checker + qa-engineer + exercir-charter-checker)**

- [ ] **Step 4: Merge when green**

```bash
gh pr merge --squash --delete-branch
```

---

## Phase 4 — exercir: Create-play affordance (WCAG 2.5.7 + 2.1.1)

**PR closes:** #127 (create-play WCAG)

### File map (Phase 4)

| Action | File |
|---|---|
| Modify | `libs/pack-football-ui/src/lib/tactical-board/tactical-board.component.ts` |
| Modify | `libs/pack-football-ui/src/lib/tactical-board/tactical-board.component.spec.ts` |
| Modify | `libs/pack-football-ui/src/lib/tactical-board/tactical-board.store.ts` (drawSource signal) |

---

### Task 14: Add `draw-run` / `draw-pass` / `draw-zone` toolbar buttons (pointer path)

- [ ] **Step 1: Write failing tests for the draw-mode toolbar**

In `tactical-board.component.spec.ts`, add:

```typescript
describe('create-play toolbar (WCAG 2.5.7)', () => {
  it('renders draw-run, draw-pass, draw-zone toolbar buttons', () => {
    const f = fixtureWith(SEEDED_BOARD);
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('[data-tool="draw-run"]')).not.toBeNull();
    expect(el.querySelector('[data-tool="draw-pass"]')).not.toBeNull();
    expect(el.querySelector('[data-tool="draw-zone"]')).not.toBeNull();
  });

  it('clicking draw-run enters draw mode (tool signal = draw-run)', () => {
    const f = fixtureWith(SEEDED_BOARD);
    const cmp = f.componentInstance;
    (f.nativeElement.querySelector('[data-tool="draw-run"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(cmp['store'].tool()).toBe('draw-run');
  });

  it('clicking a slot in draw-run mode selects it as source', () => {
    const f = fixtureWith(SEEDED_BOARD);
    const cmp = f.componentInstance;
    cmp['store'].selectTool('draw-run');
    const firstSlot = f.nativeElement.querySelector('[data-slot]') as HTMLElement;
    firstSlot.click();
    f.detectChanges();
    expect(cmp['drawSource']()).not.toBeNull();
  });

  it('clicking a second slot in draw-run mode emits boardChange with draw-play gesture', () => {
    const f = fixtureWith(SEEDED_BOARD_WITH_TWO_SLOTS);
    const cmp = f.componentInstance;
    const emitted: unknown[] = [];
    cmp.boardChange.subscribe((e: unknown) => emitted.push(e));

    cmp['store'].selectTool('draw-run');
    const slots = f.nativeElement.querySelectorAll('[data-slot]') as NodeListOf<HTMLElement>;
    slots[0]!.click();  // source
    f.detectChanges();
    slots[1]!.click();  // target
    f.detectChanges();

    expect(emitted).toHaveLength(1);
    expect((emitted[0] as any).gesture.kind).toBe('draw-play');
    expect((emitted[0] as any).gesture.annotationKind).toBe('run');
  });
});
```

(`fixtureWith`, `SEEDED_BOARD`, etc. mirror the pattern from `DrillBoardEditorComponent` spec — adapt to whatever test helpers exist in `tactical-board.component.spec.ts`.)

- [ ] **Step 2: Run — expect FAIL**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 3: Add `drawSource` signal to `TacticalBoardStore` (or component)**

In `tactical-board.store.ts`, add:

```typescript
readonly drawSource = signal<string | null>(null);  // slotId of the first click
```

- [ ] **Step 4: Add draw-mode toolbar buttons to `TacticalBoardComponent` template**

In the `[role="toolbar"]` section:

```html
<button type="button" data-tool="draw-run"
  [attr.aria-pressed]="store.tool() === 'draw-run'"
  (click)="store.selectTool('draw-run')">
  Lauf
</button>
<button type="button" data-tool="draw-pass"
  [attr.aria-pressed]="store.tool() === 'draw-pass'"
  (click)="store.selectTool('draw-pass')">
  Pass
</button>
<button type="button" data-tool="draw-zone"
  [attr.aria-pressed]="store.tool() === 'draw-zone'"
  (click)="store.selectTool('draw-zone')">
  Zone
</button>
```

- [ ] **Step 5: Wire slot click in draw mode**

In `TacticalBoardComponent.onSlotClick(slotId: string)`:

```typescript
protected onSlotClick(slotId: string): void {
  const tool = this.store.tool();
  if (tool === 'draw-run' || tool === 'draw-pass') {
    const source = this.store.drawSource();
    if (source === null) {
      this.store.drawSource.set(slotId);  // first click: set source
    } else {
      const annotationKind = tool === 'draw-run' ? 'run' : 'pass';
      const gesture = { kind: 'draw-play' as const, annotationKind, fromSlotId: source, toSlotId: slotId };
      const board = this.store.workingBoard();
      this.store.apply(addPlay(board, gesture));
      this.store.drawSource.set(null);
      this.boardChange.emit({ gesture, board });
    }
    return;
  }
  if (tool === 'draw-zone') {
    const gesture = { kind: 'draw-play' as const, annotationKind: 'zone' as const, centreSlotId: slotId };
    const board = this.store.workingBoard();
    this.store.apply(addPlay(board, gesture));
    this.boardChange.emit({ gesture, board });
    return;
  }
  // ... existing select-tool logic
}
```

- [ ] **Step 6: Update `aria-label` on slots dynamically**

In the slot chip template, the `aria-label` should reflect draw-mode context:

```html
[attr.aria-label]="drawModeAriaLabel(slot)"
```

Add `drawModeAriaLabel(slot: TacticalSlotView): string` to the component:

```typescript
protected drawModeAriaLabel(slot: TacticalSlotView): string {
  const tool = this.store.tool();
  const base = slot.ariaLabel;
  if (tool !== 'draw-run' && tool !== 'draw-pass' && tool !== 'draw-zone') return base;
  const source = this.store.drawSource();
  if (source === null) return `${base} – Quelle wählen`;
  return `${base} – Ziel wählen`;
}
```

- [ ] **Step 7: Run tests — expect PASS**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 8: Commit**

```bash
git checkout -b feat/scene5-create-play
git add libs/pack-football-ui/src/lib/tactical-board/
git commit -m "feat(pack-football-ui): create-play toolbar + click-to-place pointer path (WCAG 2.5.7) (#127)"
```

---

### Task 15: Add keyboard flow for create-play (WCAG 2.1.1)

- [ ] **Step 1: Write failing keyboard test**

In `tactical-board.component.spec.ts`:

```typescript
describe('create-play keyboard path (WCAG 2.1.1)', () => {
  it('Space on source slot in draw-run mode sets drawSource', () => {
    const f = fixtureWith(SEEDED_BOARD);
    const cmp = f.componentInstance;
    cmp['store'].selectTool('draw-run');
    const slot = f.nativeElement.querySelector('[data-slot]') as HTMLElement;
    slot.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    f.detectChanges();
    expect(cmp['store'].drawSource()).not.toBeNull();
  });

  it('Space on target slot commits the play and emits boardChange', () => {
    const f = fixtureWith(SEEDED_BOARD_WITH_TWO_SLOTS);
    const cmp = f.componentInstance;
    const emitted: unknown[] = [];
    cmp.boardChange.subscribe((e: unknown) => emitted.push(e));

    cmp['store'].selectTool('draw-run');
    const slots = f.nativeElement.querySelectorAll('[data-slot]') as NodeListOf<HTMLElement>;
    slots[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    f.detectChanges();
    slots[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    f.detectChanges();

    expect(emitted).toHaveLength(1);
  });

  it('Escape in draw mode clears drawSource and exits draw mode', () => {
    const f = fixtureWith(SEEDED_BOARD);
    const cmp = f.componentInstance;
    cmp['store'].selectTool('draw-run');
    const slot = f.nativeElement.querySelector('[data-slot]') as HTMLElement;
    slot.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    f.detectChanges();

    f.nativeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();

    expect(cmp['store'].drawSource()).toBeNull();
    expect(cmp['store'].tool()).toBe('select');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 3: Wire keyboard handler on slot elements**

On each slot in the template, add:

```html
(keydown)="onSlotKeydown($event, slot.slotId)"
```

In the component:

```typescript
protected onSlotKeydown(ev: KeyboardEvent, slotId: string): void {
  if (ev.key === ' ' || ev.key === 'Enter') {
    ev.preventDefault();
    this.onSlotClick(slotId);  // reuse click logic — Space = click in draw mode
  }
}
```

- [ ] **Step 4: Wire Escape on the board canvas**

On the root SVG/div element:

```html
(keydown)="onBoardKeydown($event)"
```

In the component:

```typescript
protected onBoardKeydown(ev: KeyboardEvent): void {
  if (ev.key === 'Escape' && this.store.drawSource() !== null) {
    this.store.drawSource.set(null);
    this.store.selectTool('select');
  }
  // ... existing Escape handling (e.g. cancel keyboard drag)
}
```

- [ ] **Step 5: Add `aria-pressed` to source slot chip when selected**

In the slot template:

```html
[attr.aria-pressed]="store.drawSource() === slot.slotId || null"
```

- [ ] **Step 6: Run — expect PASS**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 7: Commit**

```bash
git add libs/pack-football-ui/src/lib/tactical-board/
git commit -m "feat(pack-football-ui): create-play keyboard flow Space/Escape (WCAG 2.1.1) (#127)"
```

---

### Task 16: Add axe-core test for draw-mode

- [ ] **Step 1: Add axe test to `tactical-board.component.spec.ts`**

```typescript
import axe from 'axe-core';

it('has no axe-core a11y violations in draw-run mode with source selected', async () => {
  const f = fixtureWith(SEEDED_BOARD);
  const cmp = f.componentInstance;
  cmp['store'].selectTool('draw-run');
  const slot = f.nativeElement.querySelector('[data-slot]') as HTMLElement;
  slot.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  f.detectChanges();

  // Colour-contrast needs a real renderer + fonts; skip in jsdom.
  const results = await axe.run(f.nativeElement as HTMLElement, {
    rules: { 'color-contrast': { enabled: false } },
  });
  expect(results.violations).toEqual([]);
});
```

- [ ] **Step 2: Run — expect PASS**

```bash
npx nx test pack-football-ui
```

- [ ] **Step 3: Commit**

```bash
git add libs/pack-football-ui/src/lib/tactical-board/tactical-board.component.spec.ts
git commit -m "test(pack-football-ui): axe-core no-violations for create-play draw mode (#127)"
```

---

### Task 17: PR-4 — create exercir PR, wave, merge

- [ ] **Step 1: Push**

```bash
cd domains/exercir && git push -u origin feat/scene5-create-play
```

- [ ] **Step 2: Create PR**

```bash
gh pr create \
  --title "feat(pack-football-ui): Scene 5 create-play WCAG 2.5.7 + keyboard (#127)" \
  --body "Exposes draw-run / draw-pass / draw-zone from the existing addPlay op. Click-to-place satisfies WCAG 2.5.7 (non-drag pointer alternative). Space/Arrow/Space keyboard path satisfies WCAG 2.1.1. Axe-core no-violations in draw mode.

Closes #127

Producer: orchestrator/claude-sonnet-4-6 [subagent-driven-development]
Effect: cycle-time 0.1±0.05 expert
Effect: findings 0±1 expert"
```

- [ ] **Step 3: Run verifier wave (local-ci + reviewer + a11y-pro + charter-checker + qa-engineer + exercir-charter-checker)**

Note: include `a11y-pro` in this wave — this PR touches WCAG 2.5.7 and 2.1.1 specifically.

- [ ] **Step 4: Merge when green**

```bash
gh pr merge --squash --delete-branch
```

---

## Post-merge: twin ritual for each PR

After each PR merges, run from `domains/devloop`:

```bash
npm run dev -- drain exercir#<PR>
npm run dev -- backfill de-braighter/exercir
npm run dev -- reconcile
npm run dev -- retro '{"repo":"de-braighter/exercir","pr":<N>,"kind":"win","note":"...","by":"orchestrator/claude-sonnet-4-6"}'
```

---

## Out of scope (follow-up issues to file on #93 after this arc merges)

- Formation snapshot (`snapshot-formation` gesture wiring + per-minute persistence)
- Zone resize gesture
- Multi-play undo batch
- Migration of drill-board pitch (100×60) and coach-lineup pitch onto `<db-pitch>`
- `<db-pitch>` → `<fc-pitch>` cosmetic rename (if desired)
- Scene 5 board initial state loading from `plan_node.metadata.visualEditor` (Task 11 notes this as a follow-up)
