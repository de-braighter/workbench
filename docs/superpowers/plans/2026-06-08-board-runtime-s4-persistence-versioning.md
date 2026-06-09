# Board Runtime S4 — Tactical Persistence Port + Version-Navigation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a coach a navigable formation history (load a saved snapshot back as the working board, restore-persists-on-load) for the Scene-5 tactical board, backed by a consolidated, testable `TacticalBoardPersistence` injectable that S5 will reuse.

**Architecture:** Pure version mappers (`snapshotsFromTree`, `restoreVersionEdit`) read/write the snapshot `phase` nodes that are already saved under the match node. A `TacticalBoardPersistence` injectable (`providedIn:'root'`, wrapping `SubstrateClient`) consolidates load / per-gesture persist / restore; `MatchDayScene5PageComponent` delegates to it. Because the port wraps `SubstrateClient`, the host's existing specs (which mock `SubstrateClient`) keep passing through it unchanged. A formation-history UI in the host lists versions and restores one (re-seed + durable write).

**Tech Stack:** TypeScript, Angular 21 (standalone, signals, zoneless, OnPush), Vitest, Nx 22, `@de-braighter/substrate-contracts/plan-tree` (Ring-0 wire schema).

**Repo:** `domains/exercir` (run all `nx`/`npm` from there). Branch off `main`: `git checkout -b feat/board-runtime-s4-persistence-versioning main`.

**Conventions:** ESM imports with explicit `.js`. Verify with targeted `npx nx test pack-football-ui --include="**/<spec>"` (full UI suite can OOM under coverage×pool; targeted runs fine; a real FAILURE ≠ an OOM) + `npx nx build pack-football-ui`. Do NOT use `preview_*` tools. i18n: German source in `BOARD_MESSAGES_DE` + `i18n/de/board.json` + `i18n/en/board.json` (key-parity, no empties); `board-i18n.parity.spec.ts` asserts equality; `boardMsg(key)` falls through on a miss. TDD; one commit per task.

**Key shapes already in the codebase (do not redefine):**
- `PlanTree = { treeRootId, tenantPackId, nodes: PlanNode[] }`; `PlanNode = { id, parentId: string|null, treeRootId, kind, kindRef, ordinal, metadata: Record<string,unknown>, childrenIds: string[] }` (`@de-braighter/substrate-contracts/plan-tree`, mirrored via `data/wire-schemas.js`).
- `PlanTreeEdit` — the `metadata-patch` arm is `{ op: 'metadata-patch', nodeId, patch: { op:'replace', path, value }[] }`.
- `TacticalBoard = { sceneKind, schemaVersion, lineup, bench, captainSlotId, plays }`.
- `tactical-board-tree-ops.ts`: `gestureToTreeEdit(nodeId, gesture, board, treeRootId): PlanTreeEdit`, `VISUAL_EDITOR_BASE_PATH = '/visualEditor'`, and `snapshotInsertion` (writes a `phase` node, `kindRef: 'pack-football.tactical-board.snapshot'`, `metadata: { label, takenAt, visualEditor: {board} }`).
- `SubstrateClient`: `getPlanTree(teamId, signal?): Promise<{tree, requestId}>`, `applyEdit(treeRootId, edit): Promise<{tree, requestId}>` (returns the updated tree).
- `MatchDayScene5PageComponent` (`coach/ui/match-day-scene5-page.component.ts`): currently inlines `getPlanTree`→`findMatchNode`(kindRef `match_simulation`)→`parseVisualEditorBoard` (private) at `load()`, and `gestureToTreeEdit`+`applyEdit`+ the substitution side-effect at `onBoardChange()`. `LoadState` union has a `'loaded'` arm `{ treeRootId, matchNodeId, board }`.

---

## Task 1: Pure version mappers (`tactical-board-versions.ts`)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-tree-ops.ts` (export `SNAPSHOT_KIND_REF`, use it in `snapshotInsertion`)
- Create: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-versions.ts`
- Modify: `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts` (import `parseVisualEditorBoard` from the new module; delete the private copy)
- Test: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-versions.spec.ts`

- [ ] **Step 1: Write the failing test** — `tactical-board-versions.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { PlanTree } from '../data/wire-schemas.js';
import { snapshotsFromTree, restoreVersionEdit, SNAPSHOT_KIND_REF, parseVisualEditorBoard } from './tactical-board-versions.js';
import { TACTICAL_BOARD_SCENE_KIND, TACTICAL_BOARD_SCHEMA_VERSION, type TacticalBoard } from './tactical-board.types.js';

const MATCH = 'm-1';
function board(captain: string | null): TacticalBoard {
  return { sceneKind: TACTICAL_BOARD_SCENE_KIND, schemaVersion: TACTICAL_BOARD_SCHEMA_VERSION, lineup: [{ slotId: 's1', position: 'GK', x: 50, y: 114, playerId: 'p1' }], bench: [], captainSlotId: captain, plays: [] };
}
function snapNode(id: string, label: string, takenAt: string, captain: string | null) {
  return { id, parentId: MATCH, treeRootId: 'r', kind: 'phase', kindRef: SNAPSHOT_KIND_REF, ordinal: 0, metadata: { label, takenAt, visualEditor: board(captain) }, childrenIds: [] };
}
function tree(nodes: unknown[]): PlanTree {
  return { treeRootId: 'r', tenantPackId: 't', nodes } as PlanTree;
}

describe('snapshotsFromTree', () => {
  it('lists the match node snapshot children, newest first, with their parsed board', () => {
    const t = tree([
      { id: MATCH, parentId: 'r', treeRootId: 'r', kind: 'intervention', kindRef: 'match_simulation', ordinal: 0, metadata: {}, childrenIds: [] },
      snapNode('v1', 'Kickoff', '2026-06-08T10:00:00.000Z', 's1'),
      snapNode('v2', 'After 30', '2026-06-08T10:30:00.000Z', null),
      // a non-snapshot child + a snapshot under a DIFFERENT parent must be ignored:
      { id: 'x', parentId: MATCH, treeRootId: 'r', kind: 'phase', kindRef: 'something-else', ordinal: 0, metadata: {}, childrenIds: [] },
      { id: 'y', parentId: 'other', treeRootId: 'r', kind: 'phase', kindRef: SNAPSHOT_KIND_REF, ordinal: 0, metadata: { label: 'nope', takenAt: 'z', visualEditor: board('s1') }, childrenIds: [] },
    ]);
    const versions = snapshotsFromTree(t, MATCH);
    expect(versions.map((v) => v.nodeId)).toEqual(['v2', 'v1']); // newest-first
    expect(versions[0]).toMatchObject({ nodeId: 'v2', label: 'After 30', takenAt: '2026-06-08T10:30:00.000Z' });
    expect(versions[0]!.board.captainSlotId).toBeNull();
    expect(versions[1]!.board.captainSlotId).toBe('s1');
  });

  it('returns [] when the match node has no snapshot children', () => {
    expect(snapshotsFromTree(tree([{ id: MATCH, parentId: 'r', treeRootId: 'r', kind: 'intervention', kindRef: 'match_simulation', ordinal: 0, metadata: {}, childrenIds: [] }]), MATCH)).toEqual([]);
  });
});

describe('restoreVersionEdit', () => {
  it('builds a metadata-patch replacing all four visualEditor sub-fields', () => {
    const edit = restoreVersionEdit(MATCH, board('s1'));
    expect(edit.op).toBe('metadata-patch');
    if (edit.op !== 'metadata-patch') throw new Error('expected metadata-patch');
    expect(edit.nodeId).toBe(MATCH);
    expect(edit.patch.map((p) => p.path)).toEqual([
      '/visualEditor/lineup', '/visualEditor/bench', '/visualEditor/captainSlotId', '/visualEditor/plays',
    ]);
    expect((edit.patch[2] as { value: unknown }).value).toBe('s1');
  });
});

describe('parseVisualEditorBoard', () => {
  it('returns null for a non-board value and a board for a plausible one', () => {
    expect(parseVisualEditorBoard(null)).toBeNull();
    expect(parseVisualEditorBoard({ lineup: [], bench: [], plays: [], captainSlotId: 's1' })?.captainSlotId).toBe('s1');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

Run: `npx nx test pack-football-ui --include="**/tactical-board-versions.spec.ts"`
Expected: FAIL — cannot resolve `./tactical-board-versions.js`.

- [ ] **Step 3a: Promote the snapshot kindRef in tree-ops.** In `tactical-board-tree-ops.ts`, add an export near `VISUAL_EDITOR_BASE_PATH`:

```typescript
/** `kindRef` of the `phase` node a `snapshot-formation` inserts (ADR-160 Scene 5). */
export const SNAPSHOT_KIND_REF = 'pack-football.tactical-board.snapshot';
```

and replace the string literal in `snapshotInsertion` (`kindRef: 'pack-football.tactical-board.snapshot'`) with `kindRef: SNAPSHOT_KIND_REF`.

- [ ] **Step 3b: Implement** `tactical-board-versions.ts`:

```typescript
/**
 * tactical-board-versions — pure read/restore mappers for the Scene-5 formation
 * history (board runtime S4). Snapshots are `phase` nodes (kindRef
 * SNAPSHOT_KIND_REF) under the match node, each carrying a frozen board in
 * `metadata.visualEditor` (written by `tactical-board-tree-ops` snapshotInsertion).
 * `snapshotsFromTree` reads them; `restoreVersionEdit` writes one back as the live
 * board. No store, no HTTP, no Angular — pure.
 */
import type { PlanTree, PlanTreeEdit } from '../data/wire-schemas.js';
import { VISUAL_EDITOR_BASE_PATH, SNAPSHOT_KIND_REF } from './tactical-board-tree-ops.js';
import {
  TACTICAL_BOARD_SCENE_KIND,
  TACTICAL_BOARD_SCHEMA_VERSION,
  type TacticalBoard,
} from './tactical-board.types.js';

export { SNAPSHOT_KIND_REF };

/** A navigable formation-history entry (the snapshot node + its frozen board). */
export interface BoardVersionRef {
  nodeId: string;
  label: string;
  takenAt: string;
  board: TacticalBoard;
}

/**
 * Structural parse of an opaque `metadata.visualEditor` value into a
 * `TacticalBoard`; null when absent/implausible (the caller seeds a default
 * rather than clobbering). Moved here from the Scene-5 host so the version
 * reader + the host share one parser.
 */
export function parseVisualEditorBoard(raw: unknown): TacticalBoard | null {
  if (raw === null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o['lineup']) || !Array.isArray(o['bench']) || !Array.isArray(o['plays'])) {
    return null;
  }
  const captain = o['captainSlotId'];
  return {
    sceneKind: TACTICAL_BOARD_SCENE_KIND,
    schemaVersion: TACTICAL_BOARD_SCHEMA_VERSION,
    lineup: o['lineup'] as TacticalBoard['lineup'],
    bench: o['bench'] as TacticalBoard['bench'],
    captainSlotId: typeof captain === 'string' ? captain : null,
    plays: o['plays'] as TacticalBoard['plays'],
  };
}

/** Reads the match node's snapshot children → version refs, newest-first. */
export function snapshotsFromTree(tree: PlanTree, matchNodeId: string): BoardVersionRef[] {
  const out: BoardVersionRef[] = [];
  for (const n of tree.nodes) {
    if (n.parentId !== matchNodeId || n.kindRef !== SNAPSHOT_KIND_REF) continue;
    const meta = n.metadata as { label?: unknown; takenAt?: unknown; visualEditor?: unknown };
    const board = parseVisualEditorBoard(meta.visualEditor);
    if (board === null) continue;
    out.push({
      nodeId: n.id,
      label: typeof meta.label === 'string' ? meta.label : n.id,
      takenAt: typeof meta.takenAt === 'string' ? meta.takenAt : '',
      board,
    });
  }
  return out.sort((a, b) => b.takenAt.localeCompare(a.takenAt));
}

/** A metadata-patch that restores a snapshot board onto the live match node. */
export function restoreVersionEdit(matchNodeId: string, board: TacticalBoard): PlanTreeEdit {
  const replace = (field: string, value: unknown) =>
    ({ op: 'replace' as const, path: `${VISUAL_EDITOR_BASE_PATH}/${field}`, value });
  return {
    op: 'metadata-patch',
    nodeId: matchNodeId,
    patch: [
      replace('lineup', board.lineup),
      replace('bench', board.bench),
      replace('captainSlotId', board.captainSlotId),
      replace('plays', board.plays),
    ],
  };
}
```

- [ ] **Step 3c: Re-home the host's parser.** In `match-day-scene5-page.component.ts`, delete the private `parseVisualEditorBoard` function (bottom of file) and import it instead:

```typescript
import { parseVisualEditorBoard } from '../../tactical-board/tactical-board-versions.js';
```

(The host's `load()` call site `parseVisualEditorBoard(match.metadata['visualEditor'])` is unchanged.)

- [ ] **Step 4: Run — expect PASS**

Run: `npx nx test pack-football-ui --include="**/tactical-board-versions.spec.ts" --include="**/tactical-board-tree-ops.spec.ts" --include="**/match-day-scene5-page.component.spec.ts"`
Expected: PASS — new mapper tests + the existing tree-ops specs (SNAPSHOT_KIND_REF change is value-identical) + the host specs (parser moved, behaviour identical).

- [ ] **Step 5: Build + commit**

```bash
npx nx build pack-football-ui
git add libs/pack-football-ui/src/lib/tactical-board/tactical-board-versions.ts libs/pack-football-ui/src/lib/tactical-board/tactical-board-versions.spec.ts libs/pack-football-ui/src/lib/tactical-board/tactical-board-tree-ops.ts libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts
git commit -m "feat(pack-football-ui): pure tactical version mappers (snapshotsFromTree/restoreVersionEdit) (S4.1)"
```

---

## Task 2: `TacticalBoardPersistence` injectable; host delegates

**Files:**
- Create: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-persistence.ts`
- Create: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-persistence.spec.ts`
- Modify: `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts` (delegate `load`/`onBoardChange` to the port; add `versions` to the loaded state)

> **Spec-preservation contract:** the port is `@Injectable({ providedIn: 'root' })` and injects `SubstrateClient`. The host's existing 14 specs mock `SubstrateClient` (`configure({ getPlanTree, applyEdit })`); since the port calls those same methods with the same arguments, those specs MUST keep passing unchanged (the port is transparent over `SubstrateClient`). Do NOT change `match-day-scene5-page.component.spec.ts` in this task except, if strictly required, additive providers — assertions stay.

- [ ] **Step 1: Write the failing test** — `tactical-board-persistence.spec.ts` (drives the port through a mocked `SubstrateClient`):

```typescript
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanTree } from '../data/wire-schemas.js';
import { SubstrateClient, type ApplyEditResponse, type GetPlanTreeResponse } from '../data/substrate-client.js';
import { SNAPSHOT_KIND_REF } from './tactical-board-versions.js';
import { TacticalBoardPersistence } from './tactical-board-persistence.js';
import { TACTICAL_BOARD_SCENE_KIND, TACTICAL_BOARD_SCHEMA_VERSION, type TacticalBoard } from './tactical-board.types.js';

const ROOT = 'r', MATCH = 'm-1';
const seededBoard = { lineup: [{ slotId: 's1', position: 'GK', x: 50, y: 114, playerId: 'p1' }], bench: [], captainSlotId: 's1', plays: [] };
function snapBoard(): TacticalBoard {
  return { sceneKind: TACTICAL_BOARD_SCENE_KIND, schemaVersion: TACTICAL_BOARD_SCHEMA_VERSION, lineup: [], bench: [], captainSlotId: null, plays: [] };
}
function tree(withSnapshot: boolean): PlanTree {
  const nodes: unknown[] = [
    { id: ROOT, parentId: null, treeRootId: ROOT, kind: 'root', kindRef: 'team-pathway', ordinal: 0, metadata: {}, childrenIds: [MATCH] },
    { id: MATCH, parentId: ROOT, treeRootId: ROOT, kind: 'intervention', kindRef: 'match_simulation', ordinal: 0, metadata: { visualEditor: seededBoard }, childrenIds: [] },
  ];
  if (withSnapshot) nodes.push({ id: 'v1', parentId: MATCH, treeRootId: ROOT, kind: 'phase', kindRef: SNAPSHOT_KIND_REF, ordinal: 0, metadata: { label: 'L', takenAt: '2026-06-08T10:00:00.000Z', visualEditor: snapBoard() }, childrenIds: [] });
  return { treeRootId: ROOT, tenantPackId: 't', nodes } as PlanTree;
}

function make(client: Partial<SubstrateClient>): TacticalBoardPersistence {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: SubstrateClient, useValue: client as SubstrateClient }] });
  return TestBed.inject(TacticalBoardPersistence);
}

describe('TacticalBoardPersistence', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('load returns the parsed board + match ids + versions', async () => {
    const p = make({ getPlanTree: vi.fn(async () => ({ tree: tree(true), requestId: 'r1' }) as GetPlanTreeResponse) });
    const res = await p.load('team-1');
    expect(res).toMatchObject({ kind: 'loaded', treeRootId: ROOT, matchNodeId: MATCH });
    if (res.kind !== 'loaded') throw new Error('expected loaded');
    expect(res.board.captainSlotId).toBe('s1');
    expect(res.versions.map((v) => v.nodeId)).toEqual(['v1']);
  });

  it('load returns no-match when the tree has no match-simulation node', async () => {
    const t = { treeRootId: ROOT, tenantPackId: 't', nodes: [{ id: ROOT, parentId: null, treeRootId: ROOT, kind: 'root', kindRef: 'team-pathway', ordinal: 0, metadata: {}, childrenIds: [] }] } as PlanTree;
    const p = make({ getPlanTree: vi.fn(async () => ({ tree: t, requestId: 'r1' }) as GetPlanTreeResponse) });
    expect((await p.load('team-1')).kind).toBe('no-match');
  });

  it('applyGesture maps the gesture + applies it + returns the response-tree versions', async () => {
    const applyEdit = vi.fn(async () => ({ tree: tree(true), requestId: 'r2' }) as ApplyEditResponse);
    const p = make({ applyEdit });
    const board = snapBoard();
    const versions = await p.applyGesture({ treeRootId: ROOT, matchNodeId: MATCH }, { kind: 'set-captain', slotId: 's1' }, { ...board, captainSlotId: 's1' });
    expect(applyEdit).toHaveBeenCalledOnce();
    const [treeRootId, edit] = applyEdit.mock.calls[0]!;
    expect(treeRootId).toBe(ROOT);
    expect(edit.op).toBe('metadata-patch');
    expect(versions.map((v) => v.nodeId)).toEqual(['v1']);
  });

  it('restoreVersion writes the snapshot board onto the match node and returns it', async () => {
    const applyEdit = vi.fn(async () => ({ tree: tree(true), requestId: 'r3' }) as ApplyEditResponse);
    const p = make({ applyEdit });
    const ref = { nodeId: 'v1', label: 'L', takenAt: 'z', board: snapBoard() };
    const { board } = await p.restoreVersion({ treeRootId: ROOT, matchNodeId: MATCH }, ref);
    const [, edit] = applyEdit.mock.calls[0]!;
    expect(edit.op).toBe('metadata-patch');
    if (edit.op === 'metadata-patch') {
      expect(edit.nodeId).toBe(MATCH);
      expect(edit.patch.map((x) => x.path)).toContain('/visualEditor/lineup');
    }
    expect(board).toEqual(ref.board);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (port missing)

Run: `npx nx test pack-football-ui --include="**/tactical-board-persistence.spec.ts"`
Expected: FAIL — cannot resolve `./tactical-board-persistence.js`.

- [ ] **Step 3: Implement** `tactical-board-persistence.ts`:

```typescript
/**
 * TacticalBoardPersistence — the consolidated persistence seam for the Scene-5
 * tactical board (board runtime S4). Wraps SubstrateClient + the pure mappers:
 * load (board + versions), per-gesture persist, and snapshot restore. The
 * Scene-5 host delegates here; S5's routed /coach/board page reuses it. Tactical-
 * only by design (drill persists via its own catalog client).
 */
import { Injectable, inject } from '@angular/core';

import { SubstrateClient } from '../data/substrate-client.js';
import type { PlanTree } from '../data/wire-schemas.js';
import { gestureToTreeEdit } from './tactical-board-tree-ops.js';
import {
  parseVisualEditorBoard,
  restoreVersionEdit,
  snapshotsFromTree,
  type BoardVersionRef,
} from './tactical-board-versions.js';
import { boardFromLineup } from './tactical-board-ops.js';
import { DEFAULT_4_3_3 } from './tactical-board-geometry.js';
import type { TacticalBoard, TacticalGesture } from './tactical-board.types.js';

/** `kindRef` of the match-simulation node the board attaches to (ADR-160). */
const MATCH_KIND_REF = 'match_simulation';

/** Tree-scoped ids a persist/restore call needs. */
export interface TacticalBoardContext {
  treeRootId: string;
  matchNodeId: string;
}

export type TacticalBoardLoad =
  | { kind: 'loaded'; treeRootId: string; matchNodeId: string; board: TacticalBoard; versions: BoardVersionRef[] }
  | { kind: 'no-match' };

@Injectable({ providedIn: 'root' })
export class TacticalBoardPersistence {
  private readonly client = inject(SubstrateClient);

  /** Fetch the team tree → parsed board + match ids + version history. */
  async load(teamId: string, signal?: AbortSignal): Promise<TacticalBoardLoad> {
    const { tree } = await this.client.getPlanTree(teamId, signal);
    const match = findMatchNode(tree);
    if (match === undefined) return { kind: 'no-match' };
    const board = parseVisualEditorBoard(match.metadata['visualEditor']) ?? boardFromLineup(DEFAULT_4_3_3);
    return {
      kind: 'loaded',
      treeRootId: tree.treeRootId,
      matchNodeId: match.id,
      board,
      versions: snapshotsFromTree(tree, match.id),
    };
  }

  /** Persist one gesture (the POST-gesture board); return the refreshed versions. */
  async applyGesture(ctx: TacticalBoardContext, gesture: TacticalGesture, board: TacticalBoard): Promise<BoardVersionRef[]> {
    const edit = gestureToTreeEdit(ctx.matchNodeId, gesture, board, ctx.treeRootId);
    const { tree } = await this.client.applyEdit(ctx.treeRootId, edit);
    return snapshotsFromTree(tree, ctx.matchNodeId);
  }

  /** Restore a snapshot as the live board; return the board (to re-seed) + versions. */
  async restoreVersion(ctx: TacticalBoardContext, ref: BoardVersionRef): Promise<{ board: TacticalBoard; versions: BoardVersionRef[] }> {
    const { tree } = await this.client.applyEdit(ctx.treeRootId, restoreVersionEdit(ctx.matchNodeId, ref.board));
    return { board: ref.board, versions: snapshotsFromTree(tree, ctx.matchNodeId) };
  }
}

function findMatchNode(tree: PlanTree): PlanTree['nodes'][number] | undefined {
  return tree.nodes.find((n) => n.kindRef === MATCH_KIND_REF);
}
```

- [ ] **Step 4: Run the port spec — expect PASS**

Run: `npx nx test pack-football-ui --include="**/tactical-board-persistence.spec.ts"`
Expected: PASS — 4/4.

- [ ] **Step 5: Delegate the host to the port (behaviour + specs preserved).** In `match-day-scene5-page.component.ts`:

Add `versions: BoardVersionRef[]` to the `'loaded'` arm of `LoadState`. Replace the direct `SubstrateClient` injection's board usage with the port:

```typescript
import { TacticalBoardPersistence } from '../../tactical-board/tactical-board-persistence.js';
import type { BoardVersionRef } from '../../tactical-board/tactical-board-versions.js';
// keep: SubstrateClient import is still used ONLY for SubstrateClientError typing in catch; keep MatchDayClient.
```

```typescript
  private readonly persistence = inject(TacticalBoardPersistence);
```

Rewrite `load()` to delegate (preserving the exact state mapping the specs assert):

```typescript
  async load(): Promise<void> {
    this.state.set({ kind: 'loading' });
    try {
      const res = await this.persistence.load(this.teamId, this.abort.signal);
      if (res.kind === 'no-match') {
        this.state.set({ kind: 'failed', reason: boardMsg('board.scene5.noMatchNode') });
        return;
      }
      this.state.set({
        kind: 'loaded',
        treeRootId: res.treeRootId,
        matchNodeId: res.matchNodeId,
        board: res.board,
        versions: res.versions,
      });
    } catch (err) {
      if (err instanceof SubstrateClientError && err.failure.kind === 'cancelled') return;
      this.state.set({ kind: 'failed', reason: describeSubstrateClientFailure(err) });
    }
  }
```

Rewrite the persist call in `onBoardChange()` (keep the substitution side-effect + error posture exactly as-is):

```typescript
    try {
      const versions = await this.persistence.applyGesture(
        { treeRootId: s.treeRootId, matchNodeId: s.matchNodeId },
        event.gesture,
        event.board,
      );
      this.state.set({ ...s, versions });
    } catch (err) {
      this.persistError.set(describeSubstrateClientFailure(err));
    }
```

(The `findMatchNode`/`parseVisualEditorBoard`/`gestureToTreeEdit`/`getPlanTree`/`applyEdit` usages move out; remove the now-unused `findMatchNode` private fn + the `SubstrateClient`/`gestureToTreeEdit`/`getPlanTree`/`DEFAULT_4_3_3`/`boardFromLineup`/`MATCH_KIND_REF` imports that the port now owns — but KEEP `SubstrateClientError` for the catch, `MatchDayClient` + `substitutionRequestFromGesture` for the substitution side-effect, and `describeSubstrateClientFailure`.)

- [ ] **Step 6: Run the host specs — expect PASS UNCHANGED**

Run: `npx nx test pack-football-ui --include="**/match-day-scene5-page.component.spec.ts"`
Expected: PASS — all 14, unchanged (the mocked `SubstrateClient.getPlanTree`/`applyEdit` drive through the root-provided port). If a spec fails: the port must be calling `SubstrateClient` with the SAME args the spec asserts — fix the port/host delegation, do NOT weaken the spec.

- [ ] **Step 7: Build + commit**

```bash
npx nx build pack-football-ui
git add libs/pack-football-ui/src/lib/tactical-board/tactical-board-persistence.ts libs/pack-football-ui/src/lib/tactical-board/tactical-board-persistence.spec.ts libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts
git commit -m "feat(pack-football-ui): TacticalBoardPersistence port; Scene-5 host delegates (S4.2)"
```

---

## Task 3: Formation-history UI (list + restore + i18n)

**Files:**
- Modify: `libs/pack-football-ui/src/lib/tactical-board/board-i18n.ts` + `i18n/de/board.json` + `i18n/en/board.json` + `board-i18n.parity.spec.ts`
- Modify: `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts` (history UI + `onRestoreVersion`)
- Test: `libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.spec.ts` (append history cases)

- [ ] **Step 1: i18n keys (TDD via the parity spec).** Append to `board-i18n.parity.spec.ts`:

```typescript
import { versionRestoredLabel } from './board-i18n.js';
it('versionRestoredLabel interpolates the snapshot label', () => {
  expect(versionRestoredLabel('Kickoff')).toBe('Formation geladen: Kickoff');
});
```

Add to `BOARD_MESSAGES_DE` (and identically to `i18n/de/board.json`; English values to `i18n/en/board.json`):

```typescript
  'board.scene5.history.heading': 'Formations-Verlauf',
  'board.scene5.history.empty': 'Noch keine gespeicherten Formationen',
  'board.scene5.history.restore': 'Laden',
  'board.scene5.history.announce': 'Formation geladen: {label}',
```

(EN: `'Formation history'`, `'No saved formations yet'`, `'Load'`, `'Formation loaded: {label}'`.) Add the resolver to `board-i18n.ts`:

```typescript
/** "Formation geladen: {label}" announce string. */
export function versionRestoredLabel(label: string): string {
  return boardMsg('board.scene5.history.announce').replace('{label}', label);
}
```

Run: `npx nx test pack-football-ui --include="**/board-i18n.parity.spec.ts"` → PASS (parity restored + resolver).

- [ ] **Step 2: Write the failing UI tests** — append to `match-day-scene5-page.component.spec.ts`. Extend `makeTree` to optionally add a snapshot child, and add cases. First add a helper near the top:

```typescript
import { SNAPSHOT_KIND_REF } from '../../tactical-board/tactical-board-versions.js';
function snapshotChild(id: string, label: string, takenAt: string, captain: string | null) {
  return { id, parentId: MATCH_NODE, treeRootId: TREE_ROOT, kind: 'phase', kindRef: SNAPSHOT_KIND_REF, ordinal: 0, metadata: { label, takenAt, visualEditor: { lineup: [{ slotId: 's-gk', position: 'GK', x: 50, y: 114, playerId: 'p9' }], bench: [], captainSlotId: captain, plays: [] } }, childrenIds: [] };
}
function treeWithSnapshots(): PlanTree {
  const t = makeTree({ lineup: [{ slotId: 's-gk', position: 'GK', x: 50, y: 114, playerId: 'p1' }], bench: [], captainSlotId: 's-gk', plays: [] });
  return { ...t, nodes: [...t.nodes, snapshotChild('v1', 'Kickoff', '2026-06-08T10:00:00.000Z', 's-gk')] } as PlanTree;
}
```

The cases:

```typescript
it('renders the formation-history list from the loaded snapshots', async () => {
  configure({ getPlanTree: vi.fn(async () => ({ tree: treeWithSnapshots(), requestId: 'r1' })) });
  const fixture = await render();
  const items = (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="scene5-version"]');
  expect(items).toHaveLength(1);
  expect(items[0]!.textContent).toContain('Kickoff');
});

it('restoring a snapshot persists it + re-seeds the board + announces', async () => {
  const applyEdit = vi.fn<SubstrateClient['applyEdit']>(async () => ({ tree: treeWithSnapshots(), requestId: 'r2' }) as ApplyEditResponse);
  configure({ getPlanTree: vi.fn(async () => ({ tree: treeWithSnapshots(), requestId: 'r1' })), applyEdit });
  const fixture = await render();
  // the live board started with player p1; the snapshot's board has p9.
  expect(boardComponent(fixture).board().lineup[0]!.playerId).toBe('p1');
  (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="scene5-version-restore"]')!.click();
  await fixture.whenStable();
  fixture.detectChanges();
  expect(applyEdit).toHaveBeenCalledOnce();
  const [, edit] = applyEdit.mock.calls[0]!;
  expect(edit.op).toBe('metadata-patch'); // a restore write
  // re-seeded: the board now shows the snapshot's player p9.
  expect(boardComponent(fixture).board().lineup[0]!.playerId).toBe('p9');
  expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="scene5-version-announce"]')?.textContent).toContain('Kickoff');
});

it('shows the empty-state when there are no snapshots', async () => {
  configure({ getPlanTree: vi.fn(async () => ({ tree: makeTree({ lineup: [], bench: [], captainSlotId: null, plays: [] }), requestId: 'r1' })) });
  const fixture = await render();
  expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="scene5-history-empty"]')).not.toBeNull();
});
```

- [ ] **Step 3: Run — expect FAIL** (no history UI)

Run: `npx nx test pack-football-ui --include="**/match-day-scene5-page.component.spec.ts"`
Expected: FAIL on the 3 new cases.

- [ ] **Step 4: Implement the history UI.** In `match-day-scene5-page.component.ts`:

Add to the `msg` object: `historyHeading: boardMsg('board.scene5.history.heading')`, `historyEmpty: boardMsg('board.scene5.history.empty')`, `historyRestore: boardMsg('board.scene5.history.restore')`. Import `versionRestoredLabel` from `board-i18n.js` and `BoardVersionRef` (already imported in Task 2). Add a `versions` accessor + an announce signal:

```typescript
  protected readonly versionAnnounce = signal<string>('');
  protected readonly versions = computed<BoardVersionRef[]>(() => {
    const s = this.state();
    return s.kind === 'loaded' ? s.versions : [];
  });
```

Add the restore handler:

```typescript
  async onRestoreVersion(ref: BoardVersionRef): Promise<void> {
    const s = this.state();
    if (s.kind !== 'loaded') return;
    this.persistError.set(null);
    try {
      const { board, versions } = await this.persistence.restoreVersion(
        { treeRootId: s.treeRootId, matchNodeId: s.matchNodeId },
        ref,
      );
      this.state.set({ ...s, board, versions });
      this.versionAnnounce.set(versionRestoredLabel(ref.label));
    } catch (err) {
      this.persistError.set(describeSubstrateClientFailure(err));
    }
  }
```

Add to the `@case ('loaded')` template block (after the board), a history region:

```html
        <section aria-labelledby="scene5-history-h" style="margin-top:16px">
          <h2 id="scene5-history-h" style="font-size:14px;margin:0 0 8px">{{ msg.historyHeading }}</h2>
          @if (versions().length === 0) {
            <p data-testid="scene5-history-empty" style="font-size:13px;opacity:0.7">{{ msg.historyEmpty }}</p>
          } @else {
            <ul style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px">
              @for (v of versions(); track v.nodeId) {
                <li data-testid="scene5-version" style="display:flex;align-items:center;gap:8px;font-size:13px">
                  <span>{{ v.label }}</span>
                  <button
                    type="button"
                    data-testid="scene5-version-restore"
                    [attr.aria-label]="msg.historyRestore + ': ' + v.label"
                    style="min-height:24px;min-width:24px"
                    (click)="onRestoreVersion(v)"
                  >{{ msg.historyRestore }}</button>
                </li>
              }
            </ul>
          }
          <p aria-live="polite" data-testid="scene5-version-announce" style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">{{ versionAnnounce() }}</p>
        </section>
```

- [ ] **Step 5: Run — expect PASS**

Run: `npx nx test pack-football-ui --include="**/match-day-scene5-page.component.spec.ts"`
Expected: PASS — the 14 prior + the 3 new.

- [ ] **Step 6: Build + commit**

```bash
npx nx build pack-football-ui
git add libs/pack-football-ui/src/lib/tactical-board/board-i18n.ts libs/pack-football-ui/src/lib/tactical-board/board-i18n.parity.spec.ts libs/pack-football-ui/src/lib/i18n/de/board.json libs/pack-football-ui/src/lib/i18n/en/board.json libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.ts libs/pack-football-ui/src/lib/coach/ui/match-day-scene5-page.component.spec.ts
git commit -m "feat(pack-football-ui): Scene-5 formation-history UI (list + restore) (S4.3)"
```

---

## Task 4: Full-gate verification + PR

**Files:** none.

- [ ] **Step 1: Build + test + lint**

Run: `npx nx run-many -t build -p pack-football-ui pack-football-visual-editor` ; `npx nx test pack-football-ui` ; `npx nx lint pack-football-ui`
Expected: builds; full suite green (if it OOMs under coverage — known infra — fall back to targeted runs of versions / persistence / scene5-page / tactical-board / board-i18n.parity specs); lint 0 errors (no unused imports left from the host delegation).

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/board-runtime-s4-persistence-versioning
gh pr create --title "feat: board runtime S4 — tactical persistence port + formation-history (version-navigation)" --body "$(cat <<'EOF'
Adds a navigable formation history to the Scene-5 tactical board: list the
snapshots already being saved (phase nodes under the match node) and load one
back as the working board (restore persists it as the live visualEditor; edits
continue forward). Underneath, the Scene-5 host's inline persistence is
consolidated into a TacticalBoardPersistence injectable (load / applyGesture /
restoreVersion) that S5 reuses when it routes the board to /coach/board.

Tactical-only (no shared drill port); Threads A (generic component) + C
(Prisma-back catalog) remain deferred. The host's 14 existing specs pass
unchanged (the port is transparent over SubstrateClient).

Tech design: de-braighter/workbench docs/superpowers/specs/2026-06-08-board-runtime-s4-persistence-versioning-design.md
Plan: de-braighter/workbench docs/superpowers/plans/2026-06-08-board-runtime-s4-persistence-versioning.md

Part of the board-runtime epic (#214); does not close it (S5 does).

Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]
Effect: cycle-time 0.01±0.02 expert
Effect: findings 1±2 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verifier wave + twin ritual.** Run the wave (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker`, `isolation: worktree`); fix blockers; after merge run the devloop twin ritual (`drain` → `backfill de-braighter/exercir` → `reconcile`).

---

## Self-Review (completed by plan author)

**Spec coverage:** §4.1 pure version mappers (`snapshotsFromTree`/`restoreVersionEdit`/`BoardVersionRef`/`SNAPSHOT_KIND_REF`/`parseVisualEditorBoard` re-home) → Task 1. §4.2 `TacticalBoardPersistence` injectable + host delegation (behaviour/specs preserved) → Task 2. §4.3 formation-history UI (list + restore-persists-on-load + re-seed + announce + a11y + i18n) → Task 3. §2 Fork 1 (restore persists) → Task 1 `restoreVersionEdit` + Task 2 `restoreVersion` + Task 3 onRestoreVersion. §2 Fork 2 (injectable port) → Task 2. §5 acceptance → Tasks 2 (host specs green) + 3 (history + restore round-trip) + 4 (full gate). §6 risks: host-refactor regression → Task 2 spec-preservation contract; snapshot read needs tree → versions come from `load`/`applyGesture`/`restoreVersion` response trees (Task 2); over-abstraction → tactical-only scope.

**Placeholder scan:** no TBD/TODO. New files (`tactical-board-versions.ts`, `tactical-board-persistence.ts`) ship full real code + tests; the host edits are a precise recipe (the host is a known ~340-line file the implementer reads). Inline styles in the Task-3 template match the host's existing inline-style convention.

**Type consistency:** `BoardVersionRef = { nodeId, label, takenAt, board }` defined in Task 1, consumed identically in Tasks 2 (`applyGesture`/`restoreVersion` return + `BoardVersionRef[]`) + 3 (`versions`/`onRestoreVersion`). `TacticalBoardContext = { treeRootId, matchNodeId }` consistent across Task 2 + 3 call-sites. `TacticalBoardLoad` discriminated union (`'loaded'|'no-match'`) defined Task 2, mapped in the host's `load()`. `SNAPSHOT_KIND_REF` single-sourced in tree-ops (Task 1), imported by versions + the spec. `restoreVersionEdit`/`snapshotsFromTree`/`parseVisualEditorBoard` names match between Task 1 definitions, Task 2 port usage, and the specs. `versionRestoredLabel` defined Task 3 i18n, used in `onRestoreVersion`.
