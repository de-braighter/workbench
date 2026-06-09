# Board Runtime S5 — Coach-Board Convergence (close #214) — Design (mini-epic)

> **Status:** approved (brainstorming) — S5 sub-arc of the board-runtime epic, itself a **mini-epic** with a sub-slice ladder. Each sub-slice gets its own spec→plan→build. S0–S4 shipped.
> **Date:** 2026-06-08
> **Parent:** `2026-06-07-football-board-runtime-design.md` (epic, §11 slice S5) · S0–S4 designs (latest: `2026-06-08-board-runtime-s4-persistence-versioning-design.md`).

## 1. Goal

Close #214: converge pack-football's two tactical surfaces into **one routed `/coach/board`** — the live, in-match coach board gains the engine-backed editor's sophistication (draw-plays, undo, set-captain, snapshot, formation-history) while keeping its live SSE updates, formation picker, and match-timeline writes. The unrouted Scene-5 authoring page is then retired.

This is the product-convergence capstone; the board-runtime engine thesis (one domain-free engine + portable persistence) was delivered in S0–S4.

## 2. The two surfaces today (what S5 merges)

- **Routed `/coach/board`** — `CoachTacticalBoardPageComponent` + `CoachTacticalBoardComponent` (`coach/ui/`): a **live, in-match** board. Derives the match from `CoachStore.activePlanTree()`; subscribes to live match events via `MatchEventClient` (SSE: `substitution-made`, `formation-changed`); persists subs/formation as **match-timeline facts** via `MatchDayClient` (NOT board geometry); optimistic UI. Feature-poor: substitute + formation-picker + minute only. **No board-geometry persistence, no draw-plays/undo/captain/snapshot.**
- **Unrouted Scene-5** — `MatchDayScene5PageComponent` + the engine-backed `TacticalBoardComponent`: the **authoring** board. Full gestures + undo + draw-plays + snapshot + formation-history; persists board geometry to `metadata.visualEditor` via the S4 `TacticalBoardPersistence` port; substitution side-effect to `MatchDayClient`. **No SSE.**

## 3. Scope decisions (founder-confirmed)

- **Full convergence** (not a reframe): one routed `/coach/board` with SSE-live **and** authoring gestures **and** visual persistence + history.
- **Formation→geometry templates IN scope** — the picker becomes truthful (the board re-lays-out for 4-2-3-1 / 3-5-2 / 5-3-2, not just 4-3-3).
- **Architecture = Option B** — keep the routed page wrapper + its SSE/`CoachStore`/`MatchDayClient` wiring; **swap the inner board** `CoachTacticalBoardComponent` → the engine-backed `TacticalBoardComponent`; add the S4 port. Not a route replacement, not a from-scratch merged component.
- **Live-re-seed model** (the live/authoring reconciliation) — see §5.
- **SSE auth** — apply the **established query-param-token pattern** already used elsewhere in the demo (per the pack-football demo-runtime notes) to the coach board's `MatchEventClient`; do not invent a new scheme.

## 4. Architecture — Option B (swap the inner board)

`CoachTacticalBoardPageComponent` stays the routed page (`/t/:tenant/p/football/coach/board`) and keeps: the `MatchEventClient` SSE subscription, `CoachStore` match derivation, `MatchDayClient` sub/formation writes, optimistic UI, the minute control. It changes to:
- mount **`TacticalBoardComponent`** (the engine-backed rich board) instead of `CoachTacticalBoardComponent`;
- own a **`TacticalBoardPersistence`** (S4 port) for the initial board + version history + per-gesture visual persistence;
- route the rich board's `boardChange` gestures to a **dual-write** (§6);
- feed the formation picker through the **S5.2 formation-geometry** templates so the board re-lays-out.

`CoachTacticalBoardComponent` (the feature-poor inner board) becomes unused → retired (S5.4). The unrouted `MatchDayScene5PageComponent` is then redundant (the routed page is now the rich authoring+live board) → retired.

## 5. The live-re-seed model (the core reconciliation)

The converged board has **two lineup truths**: authoring (`metadata.visualEditor`, via the port) and the live match timeline (subs/formation facts, echoed over SSE). The model:
- **Authoring gestures** (draw-play, move-slot, set-captain, snapshot) edit the visual layer, auto-persisted per gesture via the port, **undoable within the current baseline**.
- **A live SSE event** (a real on-field substitution / formation change) applies a **surgical** update to lineup/bench/captain (and, for formation, the geometry via S5.2) — **preserving the drawn plays** — and **re-baselines**: it `begin()`s the board engine with the updated board and clears the undo stack (a physical on-field change is not "undoable").
- **Substitutions made on the board** dual-write (§6): the port (visual) **and** `MatchDayClient` (timeline fact) — the Scene-5 host's existing dual-write, now on the live page.

So: live facts re-baseline (surgical, plays-preserving, undo-clearing); local authoring edits are undoable until the next live re-baseline. This is the heart of S5.3 and its riskiest piece.

## 6. Dual-write

On a board gesture, the routed page:
- always calls `port.applyGesture(ctx, gesture, board)` — persists the visual board (lineup/plays/captain) to `metadata.visualEditor` (covers draw-play, move-slot, set-captain, swap, clear-play; refreshes the version list).
- additionally, for `substitute`, calls `MatchDayClient.substitute(...)` (the match-timeline fact, via `substitutionRequestFromGesture` + the minute control); for the formation picker, calls `MatchDayClient.changeFormation(...)` (timeline fact) **and** re-lays-out via S5.2.
- preserves the existing inline error surface (a failed write doesn't collapse the board).

## 7. Sub-slice ladder

Each ships green; both boards' specs stay green until their surface is retired.

- **S5.2 — formation→geometry templates** *(first; pure, independent).* A `formationKey → slot positions` system for 4-3-3 / 4-2-3-1 / 3-5-2 / 5-3-2 (+ the existing default) as pure data + a mapper, unit-tested in isolation. No wiring yet. (Numbered S5.2 to match the ladder presented; built first.)
- **S5.1 — SSE auth fix** *(independent foundation).* Apply the established query-param-token pattern to the coach board's `MatchEventClient` so the live SSE subscription authenticates against the guarded endpoint (today it silently fails → HTTP-read fallback). Proven against the guarded endpoint.
- **S5.3 — the convergence** *(the big one; splits into sub-steps).* Routed coach page mounts `TacticalBoardComponent` + the S4 port (board + history), implements the §5 live-re-seed model (SSE → surgical baseline), the §6 dual-write, and the formation picker → S5.2 re-layout + timeline fact. Likely: **S5.3a** mount + port load/persist + dual-write + history UI; **S5.3b** SSE surgical re-baseline + undo-clear; **S5.3c** formation picker → geometry re-layout.
- **S5.4 — retire the duplicate.** Remove `CoachTacticalBoardComponent` + its specs + the unrouted `MatchDayScene5PageComponent`; update routes + `index.ts` exports. **Only what is cleanly dead** — `tactical-board-ops.ts` (S3 oracle + `boardFromLineup` for the port) and the drill code (`DrillEditorStore`/`drill-diagram-ops`) are NOT dead (verified) and stay. Close #214.

**Build order:** S5.2 → S5.1 → S5.3(a→b→c) → S5.4.

## 8. First sub-slice (S5.2) — detail

Build a formation-template system, pure + independently testable:
- A `FormationTemplate` shape: `formationKey → { slotId, position, x, y }[]` over the tactical 100×120 frame (GK at the goal line, lines spread up-pitch). Templates for `4-3-3`, `4-2-3-1`, `3-5-2`, `5-3-2`; the existing `DEFAULT_4_3_3` is the 4-3-3 source of truth (reuse, don't duplicate).
- A pure mapper `layoutForFormation(formationKey): TacticalSlot[]` (or `applyFormation(board, formationKey): TacticalBoard` that re-positions slots while **preserving playerIds by position/slot order**), in `tactical-board-geometry.ts` (or a new `formation-templates.ts`).
- Unit tests: each formation yields 11 slots at distinct in-frame positions; player assignment is preserved across a formation change (by position mapping); unknown formationKey falls back to 4-3-3.
- **No UI/page wiring in S5.2** — that's S5.3c. This slice is the pure geometry foundation the picker will consume.

## 9. Risks & mitigations

- **Undo-under-SSE (the core complexity)** — §5's surgical-re-baseline model is the mitigation; S5.3b is dedicated to getting it right (preserve plays, clear undo, surgical lineup/bench/captain). The board engine's `begin()` already re-seeds + clears history (S1), so the mechanism exists.
- **SSE auth blocker** — de-risked: an established query-param pattern exists (S5.1 applies it; not invent).
- **Two data sources (CoachStore-derived vs port-loaded board)** — the routed page currently derives the board from `CoachStore.activePlanTree()`; S5.3a switches the initial load to the port (`load` → match-node board + versions), keeping `CoachStore`/SSE for live updates. The reconciliation is the §5 model; a mismatch risk is mitigated by the port reading the same match node `CoachStore` points at.
- **Formation-geometry fidelity** — built in S5.2 (founder-chosen); the mapper preserves player assignment across formation changes (tested).
- **Retirement blast radius** — bounded by "only cleanly-dead" (S5.4); the recon confirmed the legacy ops + drill code are live and stay. The two retired surfaces' specs migrate/delete with their components.
- **Optimistic-UI interplay** — the routed page's existing optimistic lineup/formation signals must reconcile with the port's persisted board + SSE re-baseline; S5.3 folds the optimistic path into the live-re-seed model (one source of working truth = the engine store).

## 10. Non-goals
- No new board *engine* work (S1–S4 delivered it); no generic `BoardEditorComponent` extraction (Thread A, still deferred — `TacticalBoardComponent` is the shared board).
- No Prisma-back of the drill catalog (Thread C, deferred).
- No retirement of `tactical-board-ops.ts` or the drill code (not dead).
- No change to the drill editor / Drill Library.

## 11. Acceptance (mini-epic level)
One routed `/coach/board` that: renders the engine-backed board; supports draw-plays/undo/set-captain/snapshot + formation-history; stays live (SSE surgically re-baselines on real subs/formation, preserving plays); dual-writes subs/formation to the match timeline; re-lays-out correctly for all four formations; with `CoachTacticalBoardComponent` + the unrouted Scene-5 page retired and #214 closed. Each sub-slice keeps the affected specs green until its surface is retired.
