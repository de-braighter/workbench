# Board Runtime S5.3 — Coach-Board Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Converge the routed `/coach/board` onto the engine-backed board: `CoachTacticalBoardPageComponent` mounts `TacticalBoardComponent` + the S4 `TacticalBoardPersistence` port (full `TacticalBoard` from `metadata.visualEditor`), gains draw-plays/undo/captain/snapshot + a formation-history UI, keeps its live SSE updates (now surgically re-seeding the board, preserving plays) + the formation picker + the match-timeline dual-write, and re-lays-out via the S5.2 formation templates.

**Architecture:** The page keeps its route + `CoachStore` (match-node derivation + squad) + `MatchEventClient` SSE + `MatchDayClient` writes, but (1) loads the board via `port.load(teamId)` instead of deriving a flat lineup, (2) mounts `TacticalBoardComponent` (emit `boardChange{gesture,board}`) instead of `CoachTacticalBoardComponent`, (3) on `boardChange` dual-writes (port.applyGesture for the visual board + `MatchDayClient.substitute` for the timeline fact), (4) on an SSE event re-seeds the `board` input via a pure surgical helper (preserving plays; the engine `begin()` clears undo), (5) adds a formation `<select>` → `applyFormation` re-layout + `MatchDayClient.changeFormation`. `CoachTacticalBoardComponent` becomes unused (retired in S5.4).

**Tech Stack:** TypeScript, Angular 21 (standalone, signals, zoneless, OnPush), Vitest, Nx 22.

**Repo:** `domains/exercir`. Branch off `main`: `git checkout -b feat/board-runtime-s5.3-convergence main`.

**Conventions:** ESM `.js` imports. Targeted `npx nx test pack-football-ui --include="**/<spec>"` (full suite OOMs under coverage; real FAILURE ≠ OOM) + `npx nx build pack-football-ui`. Do NOT use `preview_*`. TDD; one commit per task.

**Key shapes (verbatim from the codebase — do not redefine):**
- `TacticalBoard = { sceneKind, schemaVersion, lineup: TacticalSlot[], bench: BenchSlot[], captainSlotId: string|null, plays: PlayAnnotation[] }`.
- `TacticalBoardComponent` (`tactical-board/tactical-board.component.ts`): `@Input board = input.required<TacticalBoard>()`, `roster = input<RosterRow[]>([])`, `viewport`, `readonly`; `@Output boardChange = output<{ gesture: TacticalGesture; board: TacticalBoard }>()`; selector `lib-tactical-board`; seeds the engine via a `board`-input effect (so re-seeding = changing the `board` input). NO formation picker.
- `TacticalBoardPersistence` (`tactical-board/tactical-board-persistence.ts`, `providedIn:'root'`): `load(teamId, signal?): Promise<TacticalBoardLoad>` where `TacticalBoardLoad = { kind:'loaded'; treeRootId; matchNodeId; board; versions: BoardVersionRef[] } | { kind:'no-match' }`; `applyGesture(ctx: {treeRootId, matchNodeId}, gesture, board): Promise<BoardVersionRef[]>`; `restoreVersion(ctx, ref): Promise<{board, versions}>`.
- `applyFormation(board, key: FormationKey): TacticalBoard` + `FormationKey = '4-3-3'|'4-4-2'|'3-5-2'` + `FORMATION_KEYS` (`tactical-board-formations.ts`, S5.2 — carries players + captain by index, fallback 4-3-3).
- `CoachTacticalBoardPageComponent` (`coach/ui/coach-tactical-board-page.component.ts`) today: injects `CoachStore`/`SubstrateClient`/`MatchDayClient`/`DestroyRef`; `activeMatchNode = computed(() => deriveNextMatchNode(store.activePlanTree()))`; `teamId = computed(() => store.activeTeam()?.teamId)`; `optimisticLineup`/`optimisticFormationKey` signals; `writeError` signal; SSE in `ngOnInit` (`new MatchEventClient({baseUrl}).subscribe(matchNodeId, e => boardRef()?.onMatchEvent(e))`); `onSubstitute`/`onChangeFormation` call `MatchDayClient` + set optimistic signals; `FORMATION_DISPLAY_TO_MANIFEST` maps display→manifest keys; template renders `<lib-coach-tactical-board [match] [bench] [roster] [captainId] (substitute) (changeFormation)>` + a `[data-testid="board-write-error"]`. 11 specs.
- `MatchDayScene5PageComponent.onBoardChange` is the dual-write reference: `port.applyGesture(...)` then, for `gesture.kind==='substitute'`, `substitutionRequestFromGesture(gesture, board, teamId, minute())` → `matchDayClient.substitute(matchNodeId, req)`; it also has the formation-history list+restore UI (S4) to mirror.

---

## Task 1: Pure live-update helper `applyLiveSubstitution`

**Files:**
- Modify: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.ts` (append) — co-locate with `applyFormation` (both are pure board→board live/layout transforms).
- Test: `libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.spec.ts` (append)

- [ ] **Step 1: Write the failing test** — append:

```typescript
import { applyLiveSubstitution } from './tactical-board-formations.js';

describe('applyLiveSubstitution', () => {
  const board = (() => {
    const lineup = DEFAULT_4_3_3.map((s, i) => ({ ...s, playerId: `p${i + 1}` }));
    return boardFromLineup(lineup, [], lineup[0]!.slotId);
  })();
  // give it a play so we can assert it's preserved
  const withPlay = { ...board, plays: [{ playId: 'pl1', kind: 'pass-arrow' as const, points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }] };

  it('swaps the outgoing player for the incoming one in the lineup', () => {
    const next = applyLiveSubstitution(withPlay, 'p1', 'pX');
    expect(next.lineup.find((s) => s.slotId === 's-gk')!.playerId).toBe('pX');
    expect(next.lineup.filter((s) => s.playerId === 'p1')).toHaveLength(0);
  });

  it('preserves plays, bench, captain, and slot positions', () => {
    const next = applyLiveSubstitution(withPlay, 'p1', 'pX');
    expect(next.plays).toEqual(withPlay.plays);
    expect(next.bench).toEqual(withPlay.bench);
    expect(next.captainSlotId).toBe(withPlay.captainSlotId);
    expect(next.lineup.map((s) => `${s.x},${s.y}`)).toEqual(withPlay.lineup.map((s) => `${s.x},${s.y}`));
  });

  it('is a no-op clone when the outgoing player is not on the pitch', () => {
    const next = applyLiveSubstitution(withPlay, 'not-here', 'pX');
    expect(next.lineup.map((s) => s.playerId)).toEqual(withPlay.lineup.map((s) => s.playerId));
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`applyLiveSubstitution` undefined)

Run: `npx nx test pack-football-ui --include="**/tactical-board-formations.spec.ts"`
Expected: FAIL.

- [ ] **Step 3: Implement** — append to `tactical-board-formations.ts`:

```typescript
/**
 * Surgically swap a player on the pitch (a live SSE substitution-made fact),
 * preserving plays/bench/captain/slot-positions. Pure — fresh board. A no-op
 * clone when the outgoing player isn't in the lineup.
 */
export function applyLiveSubstitution(board: TacticalBoard, playerOutId: string, playerInId: string): TacticalBoard {
  return {
    ...board,
    lineup: board.lineup.map((s) => (s.playerId === playerOutId ? { ...s, playerId: playerInId } : { ...s })),
  };
}
```

- [ ] **Step 4: Run — expect PASS** ; **Step 5: Commit**

```bash
npx nx test pack-football-ui --include="**/tactical-board-formations.spec.ts"
git add libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.ts libs/pack-football-ui/src/lib/tactical-board/tactical-board-formations.spec.ts
git commit -m "feat(pack-football-ui): applyLiveSubstitution pure helper (S5.3)"
```

---

## Task 2 (3a): Mount the engine board + port load + dual-write + formation-history

**Files:**
- Modify: `libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.ts`
- Modify: `libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.spec.ts`

> **READ the current page + its spec + `MatchDayScene5PageComponent` (the dual-write + history reference) first.** This is a rewire of an existing ~330-line page; the steps below are the recipe.

- [ ] **Step 1: Baseline the page specs** — `npx nx test pack-football-ui --include="**/coach-tactical-board-page.component.spec.ts"` → record the count (11) + which assert MatchDayClient calls vs the rendered child.

- [ ] **Step 2: Switch the board source to the port + mount the engine board.** Inject `TacticalBoardPersistence`. In `ngOnInit` (alongside the existing match-node derivation), call `port.load(this.teamId() ?? '')` and store a `loaded` signal `{ treeRootId, matchNodeId, board, versions }` (mirror `MatchDayScene5PageComponent`'s `LoadState`). Keep `activeMatchNode`/`teamId`/`CoachStore` for the match-node id + squad + the no-match empty state. Replace the working board the template binds with a `board` signal seeded from `port.load`'s board (and re-seeded by SSE in 3b / formation in 3c). Replace the template's `<lib-coach-tactical-board …>` with:

```html
<lib-tactical-board [board]="board()" (boardChange)="onBoardChange($event)" />
```

(import `TacticalBoardComponent`; drop `CoachTacticalBoardComponent` from `imports`.)

- [ ] **Step 3: Dual-write on `boardChange`** — mirror `MatchDayScene5PageComponent.onBoardChange`:

```typescript
async onBoardChange(event: { gesture: TacticalGesture; board: TacticalBoard }): Promise<void> {
  const s = this.loaded();
  if (s === null) return;
  this.board.set(event.board);
  this.writeError.set(null);
  try {
    const versions = await this.persistence.applyGesture({ treeRootId: s.treeRootId, matchNodeId: s.matchNodeId }, event.gesture, event.board);
    this.loaded.set({ ...s, versions });
  } catch (err) {
    this.writeError.set(describeSubstrateClientFailure(err));
  }
  if (event.gesture.kind === 'substitute') {
    const teamId = this.teamId();
    const req = teamId ? substitutionRequestFromGesture(event.gesture, event.board, teamId, this.minute()) : null;
    if (req) {
      try { await this.matchDayClient.substitute(s.matchNodeId, req); }
      catch (err) { this.writeError.set(substitutionFailedLabel(describeMatchDayClientFailure(err))); }
    }
  }
}
```

(Add a `minute` signal + the minute control to the page, mirroring Scene-5; import `substitutionRequestFromGesture`, `describeSubstrateClientFailure`, `describeMatchDayClientFailure`, `substitutionFailedLabel`.) The old `onSubstitute`/`onChangeFormation`/`optimisticLineup` handlers are removed (subs now flow through `boardChange`; formation through the 3c picker).

- [ ] **Step 4: Formation-history UI** — port the S4 list+restore from `MatchDayScene5PageComponent` (the `versions` list + `onRestoreVersion(ref)` → `port.restoreVersion` → `this.board.set(board)` + `this.loaded.set({...s, versions})` + announce). Reuse the existing `board.scene5.history.*` i18n keys (or add `board.coachPage.history.*` mirrors — prefer reusing the scene5 keys to avoid new strings). `role="list"`, real restore `<button>` (≥24px, labelled), polite announce — same as S4.

- [ ] **Step 5: Migrate the page specs.** The 11 specs query `lib-coach-tactical-board` + assert `substitute`/`changeFormation` outputs. Migrate:
  - selector `lib-coach-tactical-board` → `lib-tactical-board`;
  - the substitute test: emit a `boardChange` with `{ gesture: { kind:'substitute', outSlotId, inBenchId }, board: <post-sub board> }` from the mounted board and assert `MatchDayClient.substitute` is called with the derived ids + minute (use the Scene-5 page spec's substitute test as the template);
  - the port: provide `TacticalBoardPersistence` with a mocked `SubstrateClient` (its `getPlanTree` returns a tree whose `match_simulation` node carries a `metadata.visualEditor` board; `applyEdit` returns the tree) — mirror the Scene-5 page spec's `configure`;
  - keep the no-match, bench/squad-derivation (if still rendered), and error-surface assertions, adapting to the new wiring.
  Do NOT weaken assertions; the MatchDayClient dual-write + error surface must stay proven.

- [ ] **Step 6: Run + build + commit**

```bash
npx nx test pack-football-ui --include="**/coach-tactical-board-page.component.spec.ts"
npx nx build pack-football-ui
git add libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.ts libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.spec.ts
git commit -m "feat(pack-football-ui): routed coach board mounts engine board + port + dual-write + history (S5.3a)"
```

---

## Task 3 (3b): SSE surgical re-baseline

**Files:**
- Modify: `coach-tactical-board-page.component.ts` (the SSE callback)
- Modify: `coach-tactical-board-page.component.spec.ts` (append SSE tests)

- [ ] **Step 1: Write the failing tests** — append (drive the SSE callback directly):

```typescript
it('on an SSE substitution-made event, re-seeds the board with the swapped player, preserving plays', async () => {
  // load a board with a play + p1 on the GK slot, mount, then deliver an SSE sub p1→pX.
  // assert: board().lineup GK slot now pX; board().plays unchanged.
});
it('on an SSE formation-changed event, re-lays-out the board (applyFormation), preserving players', async () => {
  // deliver SSE formation-changed to '4-4-2'; assert board().lineup slotIds == the 4-4-2 template; players carried.
});
```
(Flesh these out against the page's SSE wiring — the page should expose the SSE handler or you drive it via the injected `MatchEventClient` mock's captured callback. Mirror how the Scene-5/coach specs inject fakes.)

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Replace the `ngOnInit` SSE forwarding (`boardRef()?.onMatchEvent(e)`) with a surgical re-seed:

```typescript
const sub = client.subscribe(matchNodeId, (e) => this.onLiveEvent(e));
```

```typescript
private onLiveEvent(e: MatchEvent): void {
  const cur = this.board();
  if (e.kind === 'substitution-made') {
    this.board.set(applyLiveSubstitution(cur, e.playerOutId, e.playerInId));
    this.liveAnnounce.set(substitutionAnnounce(e.minute));
  } else if (e.kind === 'formation-changed') {
    this.board.set(applyFormation(cur, e.toFormation as FormationKey));
    this.liveAnnounce.set(formationChangeAnnounce(e.fromFormation, e.toFormation, e.minute));
  }
}
```

Setting `board()` re-seeds `<lib-tactical-board [board]>`, whose effect calls `store.begin()` → re-baseline + undo cleared (per S1). Plays are preserved by `applyLiveSubstitution`/`applyFormation`. Remove the `boardRef` viewChild (no longer needed). Add a polite `liveAnnounce` live-region. (The live SSE event does NOT re-persist — it's already a server fact; it only updates the local working board.)

- [ ] **Step 4: Run + commit**

```bash
npx nx test pack-football-ui --include="**/coach-tactical-board-page.component.spec.ts"
git add libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.ts libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.spec.ts
git commit -m "feat(pack-football-ui): SSE live events surgically re-baseline the board (S5.3b)"
```

---

## Task 4 (3c): Formation picker → re-layout + timeline fact

**Files:**
- Modify: `coach-tactical-board-page.component.ts` (add the picker + handler)
- Modify: `coach-tactical-board-page.component.spec.ts` (append)
- i18n: reuse `board.coach.changeFormationAria` (exists) for the picker label.

- [ ] **Step 1: Write the failing test** — append:

```typescript
it('the formation picker re-lays-out the board, persists, and dual-writes the timeline fact', async () => {
  // pick '4-4-2' → board().lineup slotIds == 4-4-2 template; MatchDayClient.changeFormation called with the manifest key + minute.
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Add a `<select data-formation-picker [attr.aria-label]="msg.changeFormationAria">` to the page template (options from `FORMATION_KEYS`, selected = the board's current formation if derivable, else `'4-3-3'`), `(change)="onPickFormation($any($event.target).value)"`:

```typescript
async onPickFormation(key: string): Promise<void> {
  const s = this.loaded();
  if (s === null) return;
  const manifestKey = FORMATION_DISPLAY_TO_MANIFEST[key];
  if (!manifestKey) { this.writeError.set(unknownFormationLabel(key)); return; }
  const next = applyFormation(this.board(), key as FormationKey);
  this.board.set(next);
  this.writeError.set(null);
  // persist the re-layout (a move-slot-equivalent visual change) + the timeline fact
  try {
    const versions = await this.persistence.applyGesture({ treeRootId: s.treeRootId, matchNodeId: s.matchNodeId }, { kind: 'move-slot', slotId: next.lineup[0]!.slotId, x: next.lineup[0]!.x, y: next.lineup[0]!.y }, next);
    this.loaded.set({ ...s, versions });
  } catch (err) { this.writeError.set(describeSubstrateClientFailure(err)); }
  const teamId = this.teamId();
  if (teamId) {
    try { await this.matchDayClient.changeFormation(s.matchNodeId, { teamId, toFormationKey: manifestKey, minute: this.minute(), triggerKind: 'tactical' }); }
    catch (err) { this.writeError.set(formationFailedLabel(describeMatchDayClientFailure(err))); }
  }
}
```

> Note on persistence: a formation re-layout moves all slots, but the gesture vocabulary has no "whole-board replace" verb; the simplest faithful persist is to write the full board via the port. If `applyGesture` with a single `move-slot` gesture does NOT persist the whole new lineup (it patches `lineup` from the passed `board`, which IS the full re-laid-out board — verify `gestureToTreeEdit` for `move-slot` replaces the whole `lineup` field from `board.lineup`), it works. CONFIRM by reading `gestureToTreeEdit` (`move-slot` → `replace('lineup', board.lineup)` = the full new lineup) — if so, this persists the re-layout correctly. Keep `FORMATION_DISPLAY_TO_MANIFEST` (already in the page) restricted to the `FORMATION_KEYS` set.

- [ ] **Step 4: Run + build + lint + commit**

```bash
npx nx test pack-football-ui --include="**/coach-tactical-board-page.component.spec.ts"
npx nx build pack-football-ui && npx nx lint pack-football-ui
git add libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.ts libs/pack-football-ui/src/lib/coach/ui/coach-tactical-board-page.component.spec.ts
git commit -m "feat(pack-football-ui): coach board formation picker → applyFormation re-layout + timeline fact (S5.3c)"
```

---

## Task 5: Full-gate verification + PR

- [ ] **Step 1:** `npx nx run-many -t build -p pack-football-ui pack-football-visual-editor` ; `npx nx test pack-football-ui` ; `npx nx lint pack-football-ui` — all green (OOM fallback: targeted runs of the touched specs + tactical-board.component + match-day-scene5-page + the formations/persistence/match-event specs).
- [ ] **Step 2:** push + PR (`Tech design:` the S5 epic design; Producer/Effect; "Part of #214; S5 closes it" — S5.4 does the actual close). Note `CoachTacticalBoardComponent` is now unused → retired in S5.4.
- [ ] **Step 3:** verifier wave (reviewer + charter + exercir-charter + qa-engineer — this is a substantial UI/integration slice, run the FULL wave); auto-merge on green; twin ritual.

---

## Self-Review (plan author)

**Spec coverage (S5 design §4–§6):** Option-B mount (3a Task 2) · port load board+versions (3a) · dual-write port+MatchDayClient (3a Task 3) · formation-history (3a Task 4) · live-re-seed surgical+preserve-plays+clear-undo (3b Task 3, via `applyLiveSubstitution`/`applyFormation` + the engine `begin()`) · formation picker re-layout+timeline (3c Task 4) · spec migration (Task 2 Step 5). Acceptance (one routed board, draw-plays/undo/history, live, dual-write, re-layout, picker) → Tasks 2–4; #214 close + retire → deferred to S5.4 (next slice). 

**Placeholder scan:** the SSE + formation page-spec tests (Task 3/4 Step 1) are sketched with explicit assertions but not full TestBed bodies — the implementer fleshes them against the existing page-spec harness (the recipe names the exact assertions). The new pure helper (Task 1) + the page handlers (Tasks 2–4) ship full code. This is a deliberate recipe-over-a-large-existing-file approach (the page is ~330 lines the implementer reads). One CONFIRM flagged: `gestureToTreeEdit('move-slot')` replaces the whole `lineup` from `board.lineup` (so the formation re-layout persists) — the implementer verifies before relying on it.

**Type consistency:** `applyLiveSubstitution(board, outId, inId): TacticalBoard` (Task 1) used in 3b. `applyFormation`/`FormationKey`/`FORMATION_KEYS` (S5.2) used in 3b/3c. `TacticalBoardPersistence.load/applyGesture/restoreVersion` + `TacticalBoardContext{treeRootId,matchNodeId}` + `BoardVersionRef` (S4) used in 2/3c/4. `boardChange{gesture,board}` (the engine board's output) consumed in `onBoardChange` (Task 2). `FORMATION_DISPLAY_TO_MANIFEST` (existing page const) reused in 3c. `substitutionRequestFromGesture`/`describe*Failure`/`substitutionFailedLabel`/`formationFailedLabel`/`unknownFormationLabel` (existing) reused.
