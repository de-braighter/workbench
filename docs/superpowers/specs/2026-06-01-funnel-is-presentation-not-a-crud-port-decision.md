# Decision — funnel is a presentation projection, not an ADR-202 CRUD port

- **Date:** 2026-06-01
- **Domain:** exercir / pack-football
- **Epic:** [exercir#142](https://github.com/de-braighter/exercir/issues/142) — ADR-202 TenantRunner pack-CRUD fan-out
- **Parent concept:** `layers/specs/concepts/substrate/pack-football-persistence-reconciliation.md` §5 (funnel row), §9 OQ-5
- **Status:** accepted (founder decision, 2026-06-01)
- **Type:** scope decision (no code)

## TL;DR

`FUNNEL_REPOSITORY` (port #6 of the fan-out) is **removed from the DB-persistence
fan-out**. funnel is a **presentation projection** built from synthetic UI data, not
per-tenant CRUD data — so the "in-memory fixture → RLS-scoped DB table" treatment that fit
ports #1–#5 does not apply. funnel stays on its in-memory adapter until its *real*
derivation (posterior + EffectDeclaration chain — the inference lane) lands. The ADR-202
**data** fan-out is therefore considered fulfilled at the six real-data ports.

## What we found

The fan-out (epic #142) ported the in-memory pack-football reads onto RLS-scoped
`football.*` tables, OQ-5 Option B. Six ports carried genuine per-tenant data and were
DB-backed (or had the pattern established): **squad, injuries, player-movement, lineup,
player-trait** (exercir#161), **player-self** slice 1 (exercir#163).

funnel was listed as port #6. On inspection it is **not** that kind of port:

- `FunnelRepository.findFunnel(scope, subjectRef) → FunnelView | null` returns a rich
  **presentation** structure: seven nested arrays (`contexts`, `capabilities`, `traits`,
  `indicators`, `resources`, `insights`) plus seven scalar UI labels (`title`, `subject`,
  `role`, `score`, `summary`, …) across three scopes (player / coach / admin).
- The in-memory double is three hand-authored German UI blobs
  (`PLAYER_VIEW` / `COACH_VIEW` / `ADMIN_VIEW`, from
  `ui-design/pack-football/football-funnel-data.jsx`). **100% synthetic.**
- It does **not** overlap the shipped data tables. Notably, `FunnelView.traits[]` is a
  *different* set (`aer` / `neuro` / `tend` / `iq` / `eisen` — physiological) from
  `football.player_trait_value`'s `sport-science.trait.{speed,agility,technique,repsprint,gameiq}`.
  The one place that genuinely consumes `player_trait_value` is the per-player drill-down's
  `PlayerFunnelView.clusterOverlay` — a **separate field** on a different use-case
  (`GetPlayerFunnelUseCase`), already DB-overlaid via the player-trait read, and **not** part
  of `FunnelView` or the `FUNNEL_REPOSITORY` port.
- funnel's own port doc already states the intended real source: "a future substrate-backed
  adapter computes the same shape from **posterior + EffectDeclaration chain**" (i.e.
  inference, not CRUD), and it is flagged `PROMOTION-CANDIDATE` (ADR-164 §6 Risk 6).

## Why we are NOT DB-backing it now

A `funnel_view` snapshot table (scalar columns + the seven arrays as JSONB, one row per
(tenant_pack, scope, subject)) was the consistent-with-the-others option. We reject it:

- It would persist a **synthetic UI blob**, not derived data. The OQ-5 Option-B
  derived-rollup-snapshot pattern (player-trait / player-self) is justified because it stores
  *the value the port already returned from real per-tenant data*. funnel has no such data —
  the snapshot would be a fixture moved into Postgres, gaining RLS scoping but zero
  data-derivation value. The ADR-176 "documented, bounded exception" framing would be
  *weaker* here than for player-trait, because nothing is actually being derived.
- It would entrench a UI shape as a storage schema right before the real derivation
  (inference) is meant to replace it — locking in throwaway structure.

Building the **real** derivation (compose the DB-backed sources + the inference backbone's
posterior/counterfactual chain) is the correct end state, but that is a different epic from
the CRUD fan-out: it depends on the substrate inference path (ADR-203, now shipped) being
wired into a funnel read-model. That is inference-lane work, sequenced separately.

## Decision

1. **funnel is reclassified out of the ADR-202 DB-persistence fan-out.** It is a
   presentation projection, not a pack-CRUD port. `FUNNEL_REPOSITORY` stays on
   `InMemoryFunnelRepository` (the demo default) — no `funnel_view` table, no flag-gated
   Prisma adapter.
2. **The ADR-202 *data* fan-out is fulfilled at the six real-data ports** (squad, injuries,
   player-movement, lineup, player-trait, player-self). The pack-CRUD-onto-RLS mission is
   complete for everything that was actually per-tenant data.
3. **funnel's real home is the inference lane.** When a funnel read-model derives from the
   DB-backed sources + the (now shipped, ADR-203) inference backbone, that is its own
   concept → spec → plan, tracked separately from #142.

## What this does NOT close

These remain, and are unaffected by this decision (they are *data*, not presentation):

- **player-self slices 2–3** — `recentSessions` + `weeklyBlocks` (row tables) and `matchDay`
  (derives from the shipped lineup tables). Real per-tenant data; in-memory today; follow-on
  specs (player-self spec §9). The natural next CRUD increment.
- **club** (OQ-3, founder pack-split) and **reha-pathway** (OQ-2, writes `kernel.plan_node`,
  substrate lane). Still blocked on founder decisions, not code.

## Follow-ups

- Update `pack-football-persistence-reconciliation.md` §5 (funnel row) + §9 to record this
  reclassification (a specs-repo PR; concept amendment).
- On epic #142, note funnel is descoped (presentation, not CRUD) and the data fan-out's
  remaining tail is player-self 2–3 + club + reha.
