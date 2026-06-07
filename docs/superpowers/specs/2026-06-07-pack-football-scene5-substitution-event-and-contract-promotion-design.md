# Scene 5 substitution event emission + tactical-board contract promotion — Design

> **Issue:** de-braighter/exercir#129 — "Scene 5: host wiring (Scene 5 page → ApplyPlanTreeEdit) + promote board type to pack-football-contracts".
> **Date:** 2026-06-07
> **Status:** approved (brainstorming → ready for implementation plan)

## 1. Context — what #129 actually needs (after investigation)

Issue #129 listed three actions. Investigation (2026-06-07) found the picture is more
nuanced than the issue text — there are **two distinct tactical-board surfaces**:

- **Board #1 — Scene 5 visual editor:** `TacticalBoardComponent`
  (`tactical-board/`) hosted by `MatchDayScene5PageComponent`
  (`coach/ui/match-day-scene5-page.component.ts`). Rich authoring (drag-drop swap,
  free positioning, play annotations, formation snapshots). Emits `{ gesture, board }`;
  the host writes **plan-tree metadata-patches** via `SubstrateClient.applyEdit`.
  **Not routed** in `fc-workspace.routes.ts` (exported from the lib, mounted nowhere in
  the product). This is the board #129's text references.
- **Board #2 — Coach matchday board:** `CoachTacticalBoardComponent` hosted by
  `CoachTacticalBoardPageComponent` (`coach/ui/`). Simpler live board. Emits
  `substitute { playerOutId, playerInId, minute }` + `changeFormation`; the page POSTs via
  `MatchDayClient.substitute()` → `football:SubstitutionMade.v1`, with a minute control
  (clamped 0–130), optimistic lineup, and an SSE live feed. **Routed** at the real
  `/coach/board` leaf.

Findings per issue action:

| Issue action | Status |
|---|---|
| 1. Host page → `applyEdit` + correct `treeRootId` | ✅ Done on Board #1 (PRs #192, #193) — but Board #1 is unrouted. |
| 2. Emit the substitution event on `substitute` | Substantively **already implemented on Board #2** (the routed coach board), incl. the minute control. This slice **deliberately adds the same capability to Board #1** (founder decision 2026-06-07), reusing the existing machinery. |
| 3. Promote the board type to contracts | ❌ Genuinely undone. |

Two corrections to the issue's framing:

- **There is no `LineupChangedV1` event.** The catalogued event
  (`libs/pack-football/src/events/event-types.ts`) is **`football:SubstitutionMade.v1`**.
- **A substitution touches two write paths** — the plan-tree `metadata.visualEditor`
  (visual board state the editor re-reads on reload) **and** the match-timeline event
  (`SubstitutionMade.v1`, feeding SSE / inference). Board #1 writes only the first today.

**Founder direction (2026-06-07):** wire item 2 into Board #1 anyway (informed of the
duplication + unrouted caveats), and **reconcile the two boards** as a recognised
follow-up (see §7).

## 2. Grounding facts (verified against the code)

1. **`matchId === matchNodeId`.** The seed (`lineup-seed.ts`, `football-seed.ts`) sets the
   `match_simulation` plan node `id` to `SEEDED_FC_LANGGASSE_MATCH_ID`, the same id the
   lineup card uses. So Board #1's `matchNodeId` (found via `kindRef === 'match_simulation'`)
   **is** the `matchId` to POST.
2. **Player ids are recoverable from the post-gesture board alone.** `substitute()`
   (`tactical-board-ops.ts`) **reuses the freed bench id**: after the swap the incoming player
   sits in `lineup[outSlotId]` and the outgoing player sits in `bench[inBenchId]`. So
   `playerInId = postBoard.lineup.find(slotId === outSlotId).playerId` and
   `playerOutId = postBoard.bench.find(benchId === inBenchId).playerId`. No gesture enrichment
   or pre/post diffing.
3. **Seed alignment.** Board lineup/bench and the lineup repo both derive players from
   `seededPlayerIdByJersey()`, so a board substitution maps to a *valid* lineup-repo
   substitution — the event won't fail `player-out-not-on-pitch` / `player-in-not-on-bench`
   for single substitutions on the seeded match.
4. **The substitution wire schema + client already exist.** `wire-schemas.ts` carries
   `SubstitutionRequestSchema` (`{ teamId, playerOutId, playerInId, minute, reason? }`) and
   `SubstitutionResponseSchema`. `MatchDayClient.substitute(matchId, req, signal?)`
   (`data/match-day.client.ts`) already POSTs to `/pack-football/matches/:matchId/substitution`.
   **No new schema, no new client method.**
5. **i18n keys exist.** `common.term.minute` ('Minute') and `board.coach.matchMinuteAria`
   ('Spielminute') are already in the catalogs. The minute control needs **no new key**.
6. **Contracts import path is settled.** `pack-football-ui` already imports
   `@de-braighter/pack-football-contracts`. The package is `platform:agnostic` /
   `type:runtime` / `scope:pack-football`.
7. **Zod 3.25.76** supports `z.array(x).readonly()`, so `z.infer` reproduces the current
   `readonly` array shape exactly — promoted types stay structurally identical.

## 3. Scope

**In:**

- (Item 2) Board #1's `substitute` gesture emits `football:SubstitutionMade.v1` via the
  existing `MatchDayClient.substitute()`, fed by a new coach-set **match-minute control** on
  `MatchDayScene5PageComponent`. The metadata-patch path is retained (dual-write).
- (Item 3) The tactical-board **wire shape** moves to `@de-braighter/pack-football-contracts`,
  re-exported by `pack-football-ui`.
- A small DRY extraction: the coach page's private `describeWriteError` →
  shared `describeMatchDayClientFailure` (2nd consumer; the client file itself flags this).

**Out (explicitly deferred):**

- Formation-change / captain gestures → events on Board #1 (issue asks only for substitute;
  Board #1 has no formation-change gesture).
- Routing Board #1 / re-binding to the matchday §4 route.
- Server-side validation of `metadata.visualEditor` against the promoted schema (the promotion
  *enables* it; not wired here).
- **The two-board reconciliation itself** — see §7 (its own follow-up).

## 4. Design

### Part A — Item 3: promote the board type to contracts

Mirror the `drill-diagram.schemas.ts` precedent (Zod schema source-of-truth + `z.infer` types):

1. **New** `libs/pack-football-contracts/src/lib/tactical-board.schemas.ts` — Zod schemas +
   inferred types for the **wire/board** shapes only:
   `TacticalPositionSchema`/`TacticalPosition` (`z.enum` of the 10 codes),
   `TacticalSlotSchema`/`TacticalSlot`, `BenchSlotSchema`/`BenchSlot`,
   `BoardPointSchema`/`BoardPoint`, `PlayAnnotationSchema`/`PlayAnnotation`
   (`z.union` of a `kind: z.enum(['run-arrow','pass-arrow'])` arm + a `zone-highlight` literal
   arm — **not** `discriminatedUnion`, to preserve the combined arrow arm), `TacticalBoardSchema`/
   `TacticalBoard`, and the `TACTICAL_BOARD_SCENE_KIND` / `TACTICAL_BOARD_SCHEMA_VERSION`
   constants. Apply `.readonly()` to every array (`lineup`, `bench`, `plays`, arrow `points`)
   so the inferred types match the current `readonly` shape **exactly**.
2. **Export** them from `libs/pack-football-contracts/src/index.ts`; add `contracts.spec.ts`
   cases (valid board parses; missing-array board rejects; the two play-annotation arms parse).
3. **`pack-football-ui/.../tactical-board.types.ts` re-exports** the promoted types from
   `@de-braighter/pack-football-contracts` instead of defining them locally. **UI-only** types
   stay local: `TacticalGesture` / `TacticalGestureKind`, `TacticalViewport`,
   `FormationSnapshot`, `TacticalBoardSceneKind` / `TacticalBoardSchemaVersion` aliases,
   and the pitch-extent constants.
4. **Verify** `nx build pack-football-contracts` + `nx build pack-football-ui` +
   `nx test pack-football-ui` green (esp. `parseVisualEditorBoard` + wire-parity specs).

### Part B — Item 2: Board #1 `substitute` → `SubstitutionMade.v1`

1. **Pure helper** — new `libs/pack-football-ui/src/lib/tactical-board/tactical-board-event-ops.ts`:
   `MINUTE_MIN = 0`, `MINUTE_MAX = 130`, and
   `substitutionRequestFromGesture(gesture, postBoard, teamId, minute): SubstitutionRequest | null`
   deriving `playerInId`/`playerOutId` per §2.2; returns `null` for a no-op sub (either id
   missing) so the host skips emission.
2. **DRY extraction** — new `libs/pack-football-ui/src/lib/data/describe-match-day-client-failure.ts`
   exporting `describeMatchDayClientFailure(err): string` (the coach page's `describeWriteError`
   body verbatim). Repoint `CoachTacticalBoardPageComponent` to import it; delete its local copy.
3. **Match-minute control** on `MatchDayScene5PageComponent` — `minute = signal(0)`, an
   `onMinuteInput(ev)` clamp to `[MINUTE_MIN, MINUTE_MAX]`, and a programmatically-associated
   control rendered in the `loaded` state: `<label for="scene5-minute">{{ msg.minute }}</label>`
   (visible "Minute" via `common.term.minute`) + `<input id="scene5-minute" type="number"
   [min] [max] [value]="minute()" (input)="onMinuteInput($event)">`. Accessible name = visible
   text (WCAG 2.5.3-safe), so **no `aria-label`**.
4. **`onBoardChange` branch** — `inject(MatchDayClient)`. The metadata-patch path is unchanged
   for **all** gestures. **Additionally**, when `gesture.kind === 'substitute'`, build the
   request via the helper (using `this.minute()` + `this.teamId`) and, when non-null, call
   `matchDayClient.substitute(s.matchNodeId, req)`.
5. **Failure posture** — a second `substitutionError = signal<string | null>(null)` rendered in
   its own polite `role="status"` block via `substitutionFailedLabel(describeMatchDayClientFailure(err))`.
   The metadata-patch failure keeps using `persistError`. Either/both may show; the optimistic
   board is never collapsed. Reset both at the start of `onBoardChange`.

## 5. Testing

- **contracts:** `TacticalBoardSchema` shape spec (valid board parses; missing-array rejects;
  both play-annotation arms parse).
- **UI helper:** `substitutionRequestFromGesture` — happy path (both ids derived from the
  post-board); `null` when out-slot empty / bench id absent.
- **page:** a `substitute` gesture calls `matchDayClient.substitute` with the derived ids +
  current minute (and the metadata-patch still fires); non-substitute gestures do **not** call
  it; a substitution failure surfaces in `substitutionError` without collapsing the board;
  `onMinuteInput` clamps. Use a fake `MatchDayClient` (spy) + the existing `SubstrateClient`
  fake pattern from the current page spec.
- **coach page:** still green after the `describeMatchDayClientFailure` extraction.

## 6. Accessibility

The minute input uses a `<label for>`-associated visible "Minute" label (WCAG 3.3.2; 2.5.3-safe
— no divergent `aria-label`), `min`/`max` bounds, keyboard-native. The `substitutionError` /
`persistError` regions are polite live regions.

## 7. Reconciliation (recommended follow-up — not this slice)

This slice knowingly adds a **third** substitution path (Board #1 gesture → event), alongside
Board #2's existing path and the plan-tree metadata-patch. That is acceptable short-term but
the real fix is to decide the board topology:

- **Option R1 — Board #1 becomes the routed live FC-MatchDay surface** (matchday §4 route),
  folding in Board #2's event emission + SSE; retire Board #2.
- **Option R2 — keep both**, with Board #1 as the rich pre-match authoring tool and Board #2 as
  the in-match live board, and a documented boundary.
- **Option R3 — merge** the two board components into one configurable surface.

Recommendation: **file a `type/concept` (or `type/decision`) issue** capturing the two-board
discovery + these options, to be brainstormed separately. This design proceeds with the wiring
but records the duplication as intentional-pending-R.

## 8. Risks / notes

- **Multi-substitution consistency:** the event mutates the lineup repo; a second sub of the
  same player can return 409 `player-*-not-on-*`. Single subs are the demo path; the 409
  surfaces inline, not as a crash.
- **`readonly` variance** is the main compile risk during the Part A type move — caught by the
  build gate in Part A step 4 (mitigated by `.readonly()` per §2.7).
- **Running demo is in-memory** (only the plan-tree is Prisma-backed live), so the seed-alignment
  in §2.3 is what matters for a live run.
- **Board #1 is unrouted**, so this capability is not reachable by a coach in the running product
  until §7 routes it. Accepted per the founder decision.

## 9. Acceptance criteria

1. `@de-braighter/pack-football-contracts` exports `TacticalBoard` (+ slot/bench/play/position
   types & schemas); `pack-football-ui` consumes them from there; all builds + existing specs green.
2. On Board #1, a substitution gesture POSTs a valid `SubstitutionMade.v1` substitution (correct
   `matchId`, `playerOutId`, `playerInId`, coach-set `minute`) via `MatchDayClient` **in addition
   to** the metadata-patch.
3. Non-substitute gestures are unchanged (metadata-patch only).
4. A failed event surfaces inline (`substitutionError`); the optimistic board is preserved.
5. The minute control is present, `<label for>`-associated, and bounded 0–130.
6. `describeMatchDayClientFailure` is shared by the coach page and Board #1's page; the coach
   page spec stays green.
7. A reconciliation follow-up issue (§7) is filed.
