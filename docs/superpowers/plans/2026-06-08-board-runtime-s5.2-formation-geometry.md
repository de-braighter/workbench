# Board Runtime S5.2 — Formation→Geometry Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure formation→geometry template system so a tactical board can re-lay-out its 11 slots for each supported formation (`4-3-3`, `4-4-2`, `3-5-2`) while preserving which players are on the pitch — the geometry foundation S5.3c's formation picker will consume.

**Architecture:** One new pure module `tactical-board-formations.ts` (no Angular, no HTTP): a `FORMATION_KEYS` set + a `TACTICAL_FORMATIONS` registry mapping each key to 11 `TacticalSlot` positions in the 100×120 frame (4-3-3 reuses the existing `DEFAULT_4_3_3`), and a pure `applyFormation(board, key)` that re-positions the lineup to the template while carrying each player + captain across by slot index, falling back to 4-3-3 for an unknown key. Tested in isolation; no UI/page wiring (that is S5.3c).

**Tech Stack:** TypeScript, Vitest, Nx 22. Pure module in `libs/pack-football-ui/src/lib/tactical-board/`.

**Repo:** `domains/exercir` (run all from there). Branch off `main`: `git checkout -b feat/board-runtime-s5.2-formation-geometry main`.

**Conventions:** ESM imports with explicit `.js`. Targeted `npx nx test pack-football-ui --include="**/<spec>"` (full suite OOMs under coverage; a real FAILURE ≠ an OOM) + `npx nx build pack-football-ui`. Do NOT use `preview_*`. TDD; one commit per task.

**Key shapes already in the codebase (do not redefine):**
- `TacticalSlot = { slotId: string; playerId: string | null; position: TacticalPosition; x: number; y: number }` (`@de-braighter/pack-football-contracts`, re-exported via `tactical-board.types.js`).
- `TacticalPosition` enum: `GK | LB | CB | RB | CDM | CM | CAM | LW | RW | ST` (no LM/RM/LWB/RWB — wide mids/wing-backs use `LW/RW` / `LB/RB`).
- `TacticalBoard = { sceneKind, schemaVersion, lineup: TacticalSlot[], bench, captainSlotId: string|null, plays }`.
- `DEFAULT_4_3_3: readonly TacticalSlot[]` in `tactical-board-geometry.ts` — the 11-slot 4-3-3 template (the 4-3-3 source of truth; slotIds `s-gk`,`s-lb`,`s-cb-l`,`s-cb-r`,`s-rb`,`s-cm-l`,`s-cm-c`,`s-cm-r`,`s-lw`,`s-st`,`s-rw`). GK at y≈114 (bottom), attack toward y≈6 (top).
- Supported formation set = `FormationTemplateId = '4-3-3' | '4-4-2' | '3-5-2'` (`coach/data/coach-shapes.ts`). Build templates for exactly this set.

> **Scope note:** the S5 design doc's illustrative list named "4-2-3-1 / 5-3-2"; the authoritative product set in the code is `4-3-3 / 4-4-2 / 3-5-2` (`FormationTemplateId`). Build the latter. The display-key↔manifest-key mapping (`'4-4-2'` ↔ `football.intervention.formation.*`) is S5.3c's concern — S5.2 keys off the display form only.

---

## Task 1: `TACTICAL_FORMATIONS` registry + keys

**Files:**
- Create: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.ts`
- Test: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { FORMATION_KEYS, TACTICAL_FORMATIONS, type FormationKey } from './tactical-board-formations.js';
import { DEFAULT_4_3_3 } from './tactical-board-geometry.js';

describe('TACTICAL_FORMATIONS', () => {
  it('exposes exactly the supported formation keys', () => {
    expect([...FORMATION_KEYS].sort()).toEqual(['3-5-2', '4-3-3', '4-4-2']);
  });

  it('4-3-3 is the existing DEFAULT_4_3_3 (single source of truth)', () => {
    expect(TACTICAL_FORMATIONS['4-3-3']).toBe(DEFAULT_4_3_3);
  });

  it('every formation has 11 slots at distinct, in-frame positions, GK at the bottom', () => {
    for (const key of FORMATION_KEYS) {
      const slots = TACTICAL_FORMATIONS[key];
      expect(slots).toHaveLength(11);
      // unique slotIds
      expect(new Set(slots.map((s) => s.slotId)).size).toBe(11);
      // unique positions (no two slots share the exact same x,y)
      expect(new Set(slots.map((s) => `${s.x},${s.y}`)).size).toBe(11);
      // all in the 100×120 frame
      for (const s of slots) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x).toBeLessThanOrEqual(100);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y).toBeLessThanOrEqual(120);
        expect(s.playerId).toBeNull(); // templates are unassigned
      }
      // exactly one GK, at the bottom third (own goal)
      const gks = slots.filter((s) => s.position === 'GK');
      expect(gks).toHaveLength(1);
      expect(gks[0]!.y).toBeGreaterThan(100);
    }
  });

  it('each formation has the expected defender/forward counts (by y-band)', () => {
    // 4-4-2: 4 defenders (y>85), 2 forwards (y<25); 3-5-2: 3 defenders, 2 forwards
    const back = (key: FormationKey) => TACTICAL_FORMATIONS[key].filter((s) => s.position !== 'GK' && s.y > 85).length;
    const front = (key: FormationKey) => TACTICAL_FORMATIONS[key].filter((s) => s.y < 25).length;
    expect(back('4-4-2')).toBe(4);
    expect(front('4-4-2')).toBe(2);
    expect(back('3-5-2')).toBe(3);
    expect(front('3-5-2')).toBe(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (module missing)

Run: `npx nx test pack-football-ui --include="**/tactical-board-formations.spec.ts"`
Expected: FAIL — cannot resolve `./tactical-board-formations.js`.

- [ ] **Step 3: Implement** `tactical-board-formations.ts`:

```typescript
/**
 * tactical-board-formations — pure formation→geometry templates for the
 * Scene-5 / coach tactical board (board runtime S5.2). Each template is 11
 * `TacticalSlot` positions in the normalised 100×120 frame (GK at the bottom
 * y≈114, attack toward the top y≈6), unassigned (playerId: null). `4-3-3`
 * reuses the existing `DEFAULT_4_3_3` so there is one 4-3-3 source of truth.
 * `applyFormation` (this module) re-positions a board's lineup to a template
 * while carrying players + captain across by slot index. No Angular, no HTTP.
 *
 * Positions use the `TacticalPosition` enum (GK/LB/CB/RB/CDM/CM/CAM/LW/RW/ST);
 * wide midfielders + wing-backs are expressed with the nearest enum position
 * (LW/RW for wide mids, LB/RB for wing-backs). Coordinates are tuned to read
 * cleanly on the vertical pitch; the specs pin STRUCTURE (counts, in-frame,
 * distinct, GK-at-bottom, player-preservation), not exact pixels.
 */
import { type TacticalSlot } from './tactical-board.types.js';
import { DEFAULT_4_3_3 } from './tactical-board-geometry.js';

/** The product's supported formation display keys (`coach-shapes.FormationTemplateId`). */
export type FormationKey = '4-3-3' | '4-4-2' | '3-5-2';
export const FORMATION_KEYS: readonly FormationKey[] = ['4-3-3', '4-4-2', '3-5-2'];

/** GK + 4 defenders + 4 midfielders (wide via LW/RW) + 2 strikers. */
const FORMATION_4_4_2: readonly TacticalSlot[] = [
  { slotId: 's-gk', playerId: null, position: 'GK', x: 50, y: 114 },
  { slotId: 's-lb', playerId: null, position: 'LB', x: 16, y: 94 },
  { slotId: 's-cb-l', playerId: null, position: 'CB', x: 38, y: 98 },
  { slotId: 's-cb-r', playerId: null, position: 'CB', x: 62, y: 98 },
  { slotId: 's-rb', playerId: null, position: 'RB', x: 84, y: 94 },
  { slotId: 's-lm', playerId: null, position: 'LW', x: 16, y: 60 },
  { slotId: 's-cm-l', playerId: null, position: 'CM', x: 40, y: 66 },
  { slotId: 's-cm-r', playerId: null, position: 'CM', x: 60, y: 66 },
  { slotId: 's-rm', playerId: null, position: 'RW', x: 84, y: 60 },
  { slotId: 's-st-l', playerId: null, position: 'ST', x: 38, y: 16 },
  { slotId: 's-st-r', playerId: null, position: 'ST', x: 62, y: 16 },
];

/** GK + 3 centre-backs + 5 midfielders (wing-backs via LB/RB) + 2 strikers. */
const FORMATION_3_5_2: readonly TacticalSlot[] = [
  { slotId: 's-gk', playerId: null, position: 'GK', x: 50, y: 114 },
  { slotId: 's-cb-l', playerId: null, position: 'CB', x: 30, y: 96 },
  { slotId: 's-cb-c', playerId: null, position: 'CB', x: 50, y: 100 },
  { slotId: 's-cb-r', playerId: null, position: 'CB', x: 70, y: 96 },
  { slotId: 's-lwb', playerId: null, position: 'LB', x: 12, y: 70 },
  { slotId: 's-cm-l', playerId: null, position: 'CM', x: 36, y: 64 },
  { slotId: 's-cdm', playerId: null, position: 'CDM', x: 50, y: 72 },
  { slotId: 's-cm-r', playerId: null, position: 'CM', x: 64, y: 64 },
  { slotId: 's-rwb', playerId: null, position: 'RB', x: 88, y: 70 },
  { slotId: 's-st-l', playerId: null, position: 'ST', x: 38, y: 16 },
  { slotId: 's-st-r', playerId: null, position: 'ST', x: 62, y: 16 },
];

/** Formation display key → its 11-slot template (4-3-3 = the shared DEFAULT_4_3_3). */
export const TACTICAL_FORMATIONS: Record<FormationKey, readonly TacticalSlot[]> = {
  '4-3-3': DEFAULT_4_3_3,
  '4-4-2': FORMATION_4_4_2,
  '3-5-2': FORMATION_3_5_2,
};
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx nx test pack-football-ui --include="**/tactical-board-formations.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.ts libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.spec.ts
git commit -m "feat(pack-football-ui): tactical formation→geometry templates (4-3-3/4-4-2/3-5-2) (S5.2)"
```

---

## Task 2: `applyFormation` — re-layout preserving players + captain

**Files:**
- Modify: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.ts` (append)
- Test: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.spec.ts` (append)

- [ ] **Step 1: Write the failing test** — append:

```typescript
import { applyFormation } from './tactical-board-formations.js';
import { boardFromLineup } from './tactical-board-ops.js';

describe('applyFormation', () => {
  // a 4-3-3 board with players p1..p11 assigned in slot order, captain = slot 0.
  const seeded = (() => {
    const lineup = DEFAULT_4_3_3.map((s, i) => ({ ...s, playerId: `p${i + 1}` }));
    return boardFromLineup(lineup, [{ benchId: 'b1', playerId: 'pb', position: 'ST' }], lineup[0]!.slotId);
  })();

  it('re-positions to the target template (slotIds/positions/coords from the template)', () => {
    const next = applyFormation(seeded, '4-4-2');
    expect(next.lineup).toHaveLength(11);
    expect(next.lineup.map((s) => s.slotId)).toEqual(TACTICAL_FORMATIONS['4-4-2'].map((s) => s.slotId));
    expect(next.lineup.map((s) => s.position)).toEqual(TACTICAL_FORMATIONS['4-4-2'].map((s) => s.position));
    expect(next.lineup[0]).toMatchObject({ x: 50, y: 114 }); // GK from the 4-4-2 template
  });

  it('carries each player across by slot index (who-is-on-the-pitch preserved)', () => {
    const next = applyFormation(seeded, '4-4-2');
    expect(next.lineup.map((s) => s.playerId)).toEqual(
      Array.from({ length: 11 }, (_, i) => `p${i + 1}`),
    );
  });

  it('carries the captain across by index (old captain index → new slotId at that index)', () => {
    const next = applyFormation(seeded, '3-5-2');
    // captain was slot index 0; the new captain slotId is the 3-5-2 slot 0.
    expect(next.captainSlotId).toBe(TACTICAL_FORMATIONS['3-5-2'][0]!.slotId);
  });

  it('preserves bench + plays untouched', () => {
    const next = applyFormation(seeded, '4-4-2');
    expect(next.bench).toEqual(seeded.bench);
    expect(next.plays).toEqual(seeded.plays);
  });

  it('falls back to 4-3-3 for an unknown formation key', () => {
    const next = applyFormation(seeded, '9-9-9' as never);
    expect(next.lineup.map((s) => s.slotId)).toEqual(DEFAULT_4_3_3.map((s) => s.slotId));
  });

  it('leaves a null-captain board with a null captain', () => {
    const noCaptain = { ...seeded, captainSlotId: null };
    expect(applyFormation(noCaptain, '4-4-2').captainSlotId).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`applyFormation` not defined)

Run: `npx nx test pack-football-ui --include="**/tactical-board-formations.spec.ts"`
Expected: FAIL — `applyFormation` is not a function.

- [ ] **Step 3: Implement** — append to `tactical-board-formations.ts`:

```typescript
import { type TacticalBoard } from './tactical-board.types.js';

/**
 * Re-positions a board's lineup to a formation template, carrying each player
 * across by slot index (so "who is on the pitch" is preserved while the shape
 * changes) and remapping the captain to the new slot at the old captain's
 * index. Bench + plays are untouched. An unknown key falls back to 4-3-3.
 * Pure — returns a fresh board.
 */
export function applyFormation(board: TacticalBoard, key: FormationKey): TacticalBoard {
  const template = TACTICAL_FORMATIONS[key] ?? TACTICAL_FORMATIONS['4-3-3'];
  const oldCaptainIndex = board.lineup.findIndex((s) => s.slotId === board.captainSlotId);
  const lineup = template.map((slot, i) => ({
    ...slot,
    playerId: board.lineup[i]?.playerId ?? null,
  }));
  const captainSlotId =
    oldCaptainIndex >= 0 && oldCaptainIndex < lineup.length
      ? lineup[oldCaptainIndex]!.slotId
      : null;
  return { ...board, lineup, captainSlotId };
}
```

> Note: `template` is `readonly TacticalSlot[]`; `.map` produces a fresh mutable `TacticalSlot[]` for the new board — no mutation of the shared `TACTICAL_FORMATIONS` data.

- [ ] **Step 4: Run — expect PASS**

Run: `npx nx test pack-football-ui --include="**/tactical-board-formations.spec.ts"`
Expected: PASS (all Task-1 + Task-2 cases).

- [ ] **Step 5: Build + commit**

```bash
npx nx build pack-football-ui
git add libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.ts libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.spec.ts
git commit -m "feat(pack-football-ui): applyFormation re-layout preserving players + captain (S5.2)"
```

---

## Task 3: Full-gate verification + PR

**Files:** none.

- [ ] **Step 1: Build + test + lint**

Run: `npx nx build pack-football-ui` ; `npx nx test pack-football-ui --include="**/tactical-board-formations.spec.ts"` ; `npx nx lint pack-football-ui`
Expected: builds; formation specs green; lint 0 errors. (S5.2 adds a pure, unreferenced module — no other spec is affected; the full suite is unaffected but may be run if cheap.)

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin feat/board-runtime-s5.2-formation-geometry
gh pr create --title "feat: board runtime S5.2 — formation→geometry templates" --body "$(cat <<'EOF'
First sub-slice of S5 (coach-board convergence). A pure formation→geometry
template system: TACTICAL_FORMATIONS (4-3-3 reusing DEFAULT_4_3_3, plus 4-4-2 +
3-5-2 in the 100×120 frame) + applyFormation(board, key) that re-positions the
lineup to a template while carrying each player + captain across by slot index
(unknown key → 4-3-3 fallback). Pure, independently tested; no UI/page wiring
(that is S5.3c, where the formation picker consumes this).

Tech design: de-braighter/workbench docs/superpowers/specs/2026-06-08-board-runtime-s5-coach-board-convergence-design.md
Plan: de-braighter/workbench docs/superpowers/plans/2026-06-08-board-runtime-s5.2-formation-geometry.md

Part of the board-runtime epic (#214); S5 closes it.

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

**Spec coverage (S5 design §8 — the S5.2 detail):** `FormationTemplate`/registry → Task 1; reuse `DEFAULT_4_3_3` for 4-3-3 → Task 1 (`'4-3-3': DEFAULT_4_3_3`, asserted `toBe`); pure `applyFormation` preserving player assignment → Task 2; unknown-key → 4-3-3 fallback → Task 2; no UI/page wiring → confirmed (pure module only); unit-tested structure + preservation → Tasks 1+2. The design's "4-2-3-1/5-3-2" illustrative list is corrected to the authoritative `FormationTemplateId` set (`4-3-3/4-4-2/3-5-2`) with a scope note.

**Placeholder scan:** no TBD/TODO. Full real code for the module + both functions + all tests + exact commands. Formation coordinates are concrete designed values; the specs deliberately pin STRUCTURE (counts/in-frame/distinct/GK-bottom/player-preservation/fallback), not exact pixels — so a later visual coordinate tune is not a logic change.

**Type consistency:** `FormationKey` (`'4-3-3'|'4-4-2'|'3-5-2'`) + `FORMATION_KEYS` + `TACTICAL_FORMATIONS` defined in Task 1, consumed in Task 2's `applyFormation`. `TacticalSlot`/`TacticalBoard` from `tactical-board.types.js`; `DEFAULT_4_3_3` from `tactical-board-geometry.js`; `boardFromLineup` (test fixture) from `tactical-board-ops.js` (confirmed live). `applyFormation(board, key): TacticalBoard` signature consistent across its definition, the tests, and the S5.3c consumer-to-be.
