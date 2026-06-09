# Board Runtime S4 — Tactical Persistence Port + Version-Navigation — Design

> **Status:** approved (brainstorming) — S4 sub-arc of the board-runtime epic. Gets its own detailed spec→plan next.
> **Date:** 2026-06-08
> **Parent:** `2026-06-07-football-board-runtime-design.md` (epic, §11 slice S4) · S0–S3 shipped (S3: `2026-06-08-board-runtime-s3-tactical-onto-engine-design.md`).

## 1. Goal

Give a coach a navigable **formation history** for the Scene-5 tactical board: list the formation snapshots that are *already being saved* and load one back as the working board, continuing forward from it. Underneath, consolidate the tactical board's persistence — currently inline in `MatchDayScene5PageComponent` — into one testable **`TacticalBoardPersistence`** seam that S5 will reuse when it routes the board to `/coach/board`.

S4 is **decomposition Thread B** of the original "S4" (the other two — Thread A generic `BoardEditorComponent`, Thread C Prisma-back the drill catalog — are deferred as independent later slices).

## 2. Scope decisions (founder-confirmed)

- **Target = the Scene-5 tactical surface** (`MatchDayScene5PageComponent` + `TacticalBoardComponent`). The history UI lands here; it becomes coach-reachable when **S5** routes this board to `/coach/board`.
- **Fork 1 — restore persists on load.** Selecting snapshot X re-seeds the editor AND writes X's board to the live `metadata.visualEditor` (durable; matches "go back to this formation and continue"). Not re-seed-only.
- **Fork 2 — an injectable `TacticalBoardPersistence` port.** Consolidate the host's inline persistence into one seam; S5 reuses it (the 2nd consumer — promote-on-demand, not speculative). Not pure-mappers-only.
- **Tactical-only.** No shared drill+tactical port (two divergent backends = YAGNI). Drill persistence (catalog client) is untouched.

## 3. The persistence reality this builds on

- **Live edits** auto-persist per gesture: `TacticalBoardComponent` emits `{ gesture, board }`; the host maps via `gestureToTreeEdit(matchNodeId, gesture, board, treeRootId)` → `SubstrateClient.applyEdit` (a `metadata-patch` `replace` of the changed `visualEditor` sub-field on the match node). There is **no unsaved working state** — every gesture is persisted as it happens.
- **Load**: the host `getPlanTree(teamId)` → `findMatchNode` (kindRef `match_simulation`) → `parseVisualEditorBoard(match.metadata.visualEditor)` (else default 4-3-3).
- **Snapshots** are written by the `snapshot-formation` gesture as a `subtree-insertion` of a `phase` node, `kindRef: 'pack-football.tactical-board.snapshot'`, under the match node, carrying `metadata: { label, takenAt, visualEditor: {board} }` (`tactical-board-tree-ops.ts`). They are **written but never read** — no nav UI. The history = the match node's children with that kindRef, already present in the fetched tree.

## 4. Architecture

### 4.1 Pure version mappers (new — alongside `gestureToTreeEdit`)
- `snapshotsFromTree(tree, matchNodeId): BoardVersionRef[]` — reads the match node's children whose `kindRef === SNAPSHOT_KIND_REF`, mapping each to `{ nodeId, label, takenAt }`. Newest-first ordering decided here (by `takenAt`).
- `restoreVersionEdit(matchNodeId, board): PlanTreeEdit` — a `metadata-patch` `replace`-ing all four `visualEditor` sub-fields (`lineup`, `bench`, `captainSlotId`, `plays`) from the snapshot board onto the live match node (the durable restore, Fork 1).
- `BoardVersionRef = { nodeId: string; label: string; takenAt: string }` and `SNAPSHOT_KIND_REF = 'pack-football.tactical-board.snapshot'` move to a shared spot (the snapshot kindRef currently lives as a string literal in `tactical-board-tree-ops.ts` — promote it to a named constant both the writer and `snapshotsFromTree` import). Pure, unit-tested.

### 4.2 `TacticalBoardPersistence` injectable (the "port")
An Angular `@Injectable` wrapping `SubstrateClient` + the pure mappers. Methods:
- `load(teamId, signal?): { treeRootId, matchNodeId, board, versions }` — the current host `load()` logic, now also returning `versions = snapshotsFromTree(tree, matchNodeId)`.
- `applyGesture(ctx, gesture, board): Promise<void>` — the existing `gestureToTreeEdit` → `applyEdit` (ctx carries `treeRootId`/`matchNodeId`).
- `listVersions(teamId, signal?): BoardVersionRef[]` — re-read for refresh (or the host keeps the list from `load` + appends optimistically on a `snapshot-formation` gesture).
- `restoreVersion(ctx, ref): TacticalBoard` — read the snapshot node's `metadata.visualEditor` board, `applyEdit(restoreVersionEdit(matchNodeId, board))`, return the board for the host to re-seed.

The host (`MatchDayScene5PageComponent`) **delegates** to this injectable; its inline `getPlanTree`/`gestureToTreeEdit`/`applyEdit` calls move into the port. Behaviour for the existing load + per-gesture persist is **preserved** (the host's specs stay green). The substitution-side `matchDayClient.substitute` stays in the host (it's a match-timeline fact, not board persistence).

### 4.3 Version-navigation UI (in the host)
- A "Formation history" region listing `versions` (label + `takenAt`, newest first). Empty-state when none.
- Each row is a button → `restoreVersion(ctx, ref)` → the host swaps the board it passes to `<lib-tactical-board [board]=…>` (the component's seed effect re-begins the store) + a polite live-region announce ("Formation <label> geladen").
- After a `snapshot-formation` gesture, the host appends the new ref to its `versions` list (optimistic) so the just-saved formation appears without a re-fetch.
- a11y: a labelled list (`role="list"`/native `<ul>`), each restore a real `<button>` (24px target), the announce via the existing live-region idiom; i18n keys for the heading / restore label / announce (de source + typed map + parity).

## 5. Scope, non-goals, acceptance

**In scope:** the two pure version mappers + `BoardVersionRef`/`SNAPSHOT_KIND_REF`; the `TacticalBoardPersistence` injectable (host delegates, behaviour-preserved); the formation-history UI (list + restore-persists-on-load + re-seed + a11y + i18n).

**Non-goals (founder-confirmed):**
- No drill persistence change (no shared port); no Prisma (Thread C); no generic `BoardEditorComponent` (Thread A).
- No routing change — the history UI is on the unrouted Scene-5 surface; S5 routes it to coaches.
- No new snapshot-authoring change (the snapshot button + write path are unchanged); no delete/rename of snapshots (v1 lists + restores only).
- No `TacticalBoardComponent` change (it already takes a `board` input; re-seed rides the existing effect).

**Acceptance:**
- A coach sees the saved formation snapshots (label + time) and can load one; loading re-seeds the board AND persists it as the live `visualEditor` (a reload shows the restored formation); subsequent gestures persist forward onto it.
- The existing load + per-gesture persistence behaviour is unchanged (host specs green) after moving into `TacticalBoardPersistence`.
- The pure mappers are unit-tested (snapshot listing from a tree; the restore edit shape); the history UI + restore flow are tested; i18n parity holds.

## 6. Risks & mitigations

- **Host refactor regresses load/persist** — moving inline persistence into the injectable could drift behaviour (the clobber-safe load, the inline-error posture, the substitution side-effect). *Mitigation:* the host's existing specs are the gate (behaviour-preserved); move logic verbatim into the port; keep the substitution + error-surface handling in the host.
- **Snapshot read needs the full tree** — the host currently discards the tree after extracting the match node. *Mitigation:* `load` captures `versions` at fetch time; optimistic append on `snapshot-formation`; a `listVersions` re-read exists for refresh.
- **Restore-persist races a concurrent edit** — restore writes all four sub-fields; a near-simultaneous gesture could interleave. *Mitigation:* v1 is single-editor (ADR-160 Scene 5 §Lifecycle — no Yjs); the restore is one `applyEdit`, same path as any gesture; acceptable for the prototype.
- **Over-abstraction of the port** — guarded by tactical-only scope + the S5 second-consumer demand (§2). If S5 reuse turns out not to materialize, the port is still a clean host-internal seam (no external surface).

## 7. Decomposition (sketch — detailed in the plan)

Each step ships green; the host + tactical specs stay green throughout.

- **S4.1** — pure version mappers (`snapshotsFromTree`, `restoreVersionEdit`, `BoardVersionRef`, `SNAPSHOT_KIND_REF` promoted from the literal) + unit tests. No behaviour change.
- **S4.2** — `TacticalBoardPersistence` injectable; refactor `MatchDayScene5PageComponent` to delegate `load`/`applyGesture` (behaviour-preserved; host specs green); add `versions` to the loaded state.
- **S4.3** — the formation-history UI (list + `restoreVersion` on click + board re-seed + announce + a11y + i18n); tests.

(Exact step boundaries are the writing-plans skill's job; this is the design.)
