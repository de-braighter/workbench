# Scene 5 substitution event emission + tactical-board contract promotion — Design

> **Issue:** de-braighter/exercir#129 — "Scene 5: host wiring (Scene 5 page → ApplyPlanTreeEdit) + promote board type to pack-football-contracts".
> **Date:** 2026-06-07
> **Status:** approved (brainstorming → ready for implementation plan)

## 1. Context — what #129 actually needs

Issue #129 listed three actions. Investigation (2026-06-07) found **action 1 is already
merged** and the other two remain:

| Issue action | Status | Evidence |
|---|---|---|
| 1. Host page → `applyEdit` + correct `treeRootId` | ✅ **Done** (PRs #192, #193) | `MatchDayScene5PageComponent` mounts the board, calls `gestureToTreeEdit` with the real `treeRootId`, POSTs to `SubstrateClient.applyEdit`. |
| 2. Emit the substitution event on `substitute` | ❌ Not done | `onBoardChange` only does the plan-tree metadata-patch; no event is emitted. |
| 3. Promote the board type to `pack-football-contracts` | ❌ Not done | `TacticalBoard` & friends live only in `pack-football-ui`. |

Two corrections to the issue's framing surfaced during investigation:

- **There is no `LineupChangedV1` event.** The canonical ADR-161 catalog
  (`libs/pack-football/src/events/event-types.ts`) has **`football:SubstitutionMade.v1`**.
  Its endpoint already exists and is tested:
  `POST /pack-football/matches/:matchId/substitution` →
  `ApplySubstitutionUseCase` (emits `SubstitutionMade.v1`, RBAC `football.matchdayWrite`).
- **Pack-football has two write paths**, and a substitution legitimately touches both:
  - *Plan-tree edits* (`ApplyPlanTreeEdit` → RFC-6902 `metadata-patch` on
    `plan_node.metadata.visualEditor`) — the **visual board state** the coach sees and the
    board re-reads on reload.
  - *Domain events* (`ApplySubstitution` → match-timeline append + `SubstitutionMade.v1`) —
    the **canonical timeline fact** feeding SSE telemetry / inference.

## 2. Grounding facts (verified against the code)

These facts make the bridge feasible without re-seeding or gesture-vocabulary changes:

1. **`matchId === matchNodeId`.** The seed (`lineup-seed.ts`, `football-seed.ts`) sets the
   `match_simulation` plan node `id` to `SEEDED_FC_LANGGASSE_MATCH_ID`, the same id the
   lineup card uses. So the host page's `matchNodeId` (found via `kindRef === 'match_simulation'`)
   **is** the `matchId` to POST.
2. **Player ids are recoverable from the post-gesture board alone.** `substitute()`
   (`tactical-board-ops.ts`) **reuses the freed bench id**: after the swap the incoming player
   sits in `lineup[outSlotId]` and the outgoing player sits in `bench[inBenchId]`. Therefore
   `playerInId = postBoard.lineup.find(slotId === outSlotId).playerId` and
   `playerOutId = postBoard.bench.find(benchId === inBenchId).playerId`. No gesture enrichment
   or pre/post diffing required.
3. **Seed alignment.** Board lineup/bench and the lineup repo both derive players from
   `seededPlayerIdByJersey()`, so a board substitution (on-pitch → bench) maps to a *valid*
   lineup-repo substitution — the event won't fail `player-out-not-on-pitch` /
   `player-in-not-on-bench` for single substitutions on the seeded match.
4. **The substitution wire schema already exists.** `wire-schemas.ts` carries
   `SubstitutionRequestSchema` (`{ teamId, playerOutId, playerInId, minute, reason? }`) and
   `SubstitutionResponseSchema`, drift-guarded against the use-case by `wire-schemas-parity.spec.ts`.
   No new schema is needed.
5. **Contracts import path is settled.** `pack-football-ui` already imports
   `@de-braighter/pack-football-contracts` (PlanNodeKind, Squad). The package is
   `platform:agnostic` / `type:runtime` / `scope:pack-football` — the right home for a
   server-reusable board type.

## 3. Scope

**In:**

- (Item 2) The `substitute` board gesture emits `football:SubstitutionMade.v1` through the
  existing match-day endpoint; a coach-set **match-minute control** feeds the event's `minute`.
- (Item 3) The tactical-board **wire shape** moves to `@de-braighter/pack-football-contracts`,
  re-exported by `pack-football-ui`.

**Out (explicitly deferred):**

- Formation-change / captain gestures → events (issue asks only for substitute; the board has
  no formation-change gesture today).
- Re-binding the page to the matchday §4 `/.../matchday/match-{matchId}` route (item 1 shipped
  it keyed by a `teamId` query param; re-routing is its own slice).
- The deeper board↔lineup-repo reconciliation (the two write paths) — owned by epic #142's
  lineup escalation. This slice accepts dual-write.
- Server-side validation of `metadata.visualEditor` against the promoted `TacticalBoardSchema`
  — the promotion *enables* it; it is not wired here.

## 4. Design

### Part A — Item 3: promote the board type to contracts

Mirror the `drill-diagram.schemas.ts` precedent (Zod schema source-of-truth + `z.infer` types):

1. **New** `libs/pack-football-contracts/src/lib/tactical-board.schemas.ts` — Zod schemas +
   inferred types for the **wire/board** shapes only:
   `TacticalPosition`, `TacticalSlot`, `BenchSlot`, `BoardPoint`, `PlayAnnotation`
   (+ `PlayAnnotationKind`), `TacticalBoard`, and the `sceneKind` / `schemaVersion` literals.
   **Preserve the exact structural shape, including `readonly` arrays**, so every current
   consumer compiles unchanged.
2. **Export** them from `libs/pack-football-contracts/src/index.ts`; add a `contracts.spec.ts`
   case (valid board parses; structurally-invalid board rejects).
3. **`pack-football-ui/.../tactical-board.types.ts` re-exports** the promoted types from
   `@de-braighter/pack-football-contracts` instead of defining them locally. **UI-only** types
   stay local: `TacticalGesture` / `TacticalGestureKind`, `TacticalViewport`,
   `FormationSnapshot`, and the pitch-extent constants (interaction/presentation concerns the
   server never needs).
4. **Verify** `nx build pack-football-contracts` + `nx build pack-football-ui` green;
   `parseVisualEditorBoard` and the wire-parity specs still pass.

### Part B — Item 2: substitute → `SubstitutionMade.v1`

1. **`SubstrateClient.applySubstitution(matchId, body, signal?)`** — POSTs
   `{ teamId, playerOutId, playerInId, minute, reason? }` to
   `/pack-football/matches/${matchId}/substitution`, validating with the existing
   `SubstitutionRequestSchema` (request) and `SubstitutionResponseSchema` (response); same
   abort + `SubstrateClientError` handling as `applyEdit`.
2. **Pure helper** `substitutionRequestFromGesture(gesture, postBoard, teamId, minute)` →
   `{ teamId, playerOutId, playerInId, minute }` or `null` when either player id is missing
   (no-op substitution — empty out-slot or absent bench id), so the host skips emission.
3. **Match-minute control** on `MatchDayScene5PageComponent` — `minute = signal(0)` bound to an
   a11y-labeled `<input type="number" min="0" max="130">` (own `<label for>`), rendered in the
   `loaded` state. Clamp on read.
4. **`onBoardChange` branch** — the metadata-patch path is unchanged for **all** gestures (the
   board's visual state). **Additionally**, when `gesture.kind === 'substitute'`, build the
   request via the helper (using `minute()`) and call
   `applySubstitution(s.matchNodeId, …)` (`matchId = matchNodeId`).
5. **Dual-write / failure posture** — metadata-patch **first** (persists what the coach sees),
   then the event. If either throws, surface an inline `role="status"` error and keep the
   optimistic board (mirrors the existing `persistError` pattern). The two-write divergence risk
   is accepted for now (seed-aligned; epic #142 owns the real fix).

## 5. Testing

- **contracts:** `TacticalBoardSchema` shape spec (valid board parses; missing-array board rejects).
- **UI helper:** `substitutionRequestFromGesture` — happy path (both ids derived); `null` when
  out-slot empty / bench id absent.
- **`SubstrateClient.applySubstitution`:** success; 404 (`lineup-not-found`) and 409
  (`player-*-not-on-*`) failure mapping — parallel to the `applyEdit` specs.
- **page:** a `substitute` gesture calls `applySubstitution` with the derived ids + current
  minute; non-substitute gestures do **not** call it; an event failure surfaces inline without
  collapsing the board; the minute control updates the signal.

## 6. Accessibility

The minute input gets a visible `<label>` (WCAG 3.3.2 Labels), `min` / `max` bounds, and is
keyboard-native. The persist-error region stays a polite live region (already present).

## 7. Risks / notes

- **Multi-substitution consistency:** the event mutates the lineup repo; a second sub of the same
  player can return 409 `player-*-not-on-*`. Single subs are the demo path; the 409 surfaces as
  an inline error, not a crash.
- **`readonly` variance** is the main compile risk during the Part A type move — caught by the
  build gate in Part A step 4.
- **Running demo is in-memory** (only the plan-tree is Prisma-backed live), so the seed-alignment
  in §2.3 is what matters for a live demo run, not the DB seed.

## 8. Acceptance criteria

1. `@de-braighter/pack-football-contracts` exports `TacticalBoard` (+ slot/bench/play/position
   types & schemas); `pack-football-ui` consumes them from there; all builds + existing specs green.
2. Dragging a substitution on the Scene 5 board POSTs a valid `SubstitutionMade.v1` substitution
   (correct `matchId`, `playerOutId`, `playerInId`, coach-set `minute`) **in addition to** the
   metadata-patch.
3. Non-substitute gestures are unchanged (metadata-patch only).
4. A failed event surfaces inline; the optimistic board is preserved.
5. The minute control is present, labeled, and bounded 0–130.
