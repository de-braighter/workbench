# Derived-state exception audit (WS-5, Group C)

ADR-176 §4 ("store generators, derive graphs") forbids persisting derived state as
primary **kernel** state. That prohibition is **kernel-scoped**: it constrains what the
substrate kernel may hold, not what a pack may persist in its *own* schema. Several packs
persist derived rollup/snapshot tables in their own pack schemas, each annotated with a
`// ADR-176 exception` / `Derived-snapshot` comment. This audit classifies every such
table against a single test and records the crisp pack-side rule.

**Test.** A persisted derived value in a pack schema is legitimate iff it is EITHER
**(a)** a point-in-time decision record whose divergence from the live value is itself
meaningful (e.g. predicted-vs-actual drift), OR **(b)** a temporary stand-in for a
generator not yet wired, carrying a named retirement trigger. Anything else — a persisted
value that is merely a faster read of a *live, wired* generator — is a **cache-in-disguise**
and is not permitted.

## Classification table

| table | file:line | derived from (generator) | generator wired? | classification | retirement trigger |
|---|---|---|---|---|---|
| `planned_mating` (`predicted_f` / `predicted_verdict`) | `domains/herdbook/libs/herdbook-pack/prisma/schema.prisma:599` | live offspring inbreeding `F` via `LineageRepository.kinship(sire, dam)` + per-tenant `Setting` thresholds, computed by `MatingEvaluatorService` at plan time | yes — `MatingEvaluatorService` recomputes live for drift | snapshot/decision-record (keep) | none — permanent. Snapshot is the plan-time decision; the evaluator recomputes live to surface drift (predicted-vs-actual). |
| `player_trait_value` | `domains/exercir/prisma/packs/football.prisma:326` | per-player trait posterior median (OQ-5 Option B), 0..100 | no — "no live generator yet", populated by seed today | cache-in-disguise (convert when generator lands) | observation backbone wired (the per-player trait posterior generator) |
| `player_self_person` | `domains/exercir/prisma/packs/football.prisma:351` | player-self identity/binding anchor (RBAC source for personExists / findPersonTenantId) | no — seed-populated stand-in | cache-in-disguise (convert when generator lands) | live person/tenant binding source (observation backbone) |
| `player_self_form` | `domains/exercir/prisma/packs/football.prisma:367` | per-player form snapshot (MyFormDTO: formIndex / load7d / acwr / rpe) | no — seed-populated stand-in | cache-in-disguise (convert when generator lands) | observation backbone (live form/load derivation) |
| `player_self_week_stats` | `domains/exercir/prisma/packs/football.prisma:387` | per-player weekly stats snapshot (MyWeekStatsDTO) | no — seed-populated stand-in | cache-in-disguise (convert when generator lands) | observation backbone (live weekly-stats rollup) |
| `player_self_acwr` | `domains/exercir/prisma/packs/football.prisma:410` | per-player ACWR snapshot (MyACWRDTO: acute/chronic sRPE, target band, trail) | no — seed-populated stand-in | cache-in-disguise (convert when generator lands) | observation backbone (live ACWR derivation) |
| `player_self_session` | `domains/exercir/prisma/packs/football.prisma:434` | per-player recent-session rows (RecentSessionDTO) | no — seed-populated stand-in; "shared-event model arrives with the observation backbone" | cache-in-disguise (convert when generator lands) | observation backbone (shared-event session model, one row per attendee) |
| `player_self_weekly_block` | `domains/exercir/prisma/packs/football.prisma:459` | per-player weekly-block rows (WeeklyBlockDTO) | no — seed-populated stand-in (parity with the in-memory double) | cache-in-disguise (convert when generator lands) | observation backbone (live weekly-block derivation) |
| `player_self_match_day` | `domains/exercir/prisma/packs/football.prisma:485` | per-player match-day snapshot (MyMatchDayDTO) | no — "in-memory matchDay is a standalone synthetic blob ... snapshotted (not derived)" | cache-in-disguise (convert when generator lands) | lineup-port fixture/briefing alignment + observation backbone (so match-day is *derived*, not snapshotted) |

Notes on coverage: the three `domains/exercir/prisma/migrations/*` hits from the search
(`20260601130000_add_player_self_aggregates`, `20260601140000_add_player_self_lists`,
`20260602120000_add_player_self_match_day`) are the migration DDL for the same
player-self / player-trait tables above — not additional exception tables. No exception
tables exist beyond those listed.

## Findings vs. expectation

The audit matched the expected pattern exactly:

- **herdbook `planned_mating`** is a genuine type-**(a)** decision record. `predicted_f` /
  `predicted_verdict` are computed live from a *wired* generator
  (`MatingEvaluatorService` → `LineageRepository.kinship` + per-tenant thresholds) and
  persisted as the plan-time snapshot precisely so later live recomputation can surface
  drift (predicted-vs-actual). Keep, permanently.
- **exercir player-self family + `player_trait_value`** are all type-**(b)** stand-ins.
  Their schema comments explicitly state there is *no live generator yet* — they are
  populated by the seed today, with the live generator ("the observation backbone")
  arriving later. They are legitimate *only* as temporary stand-ins and must be converted
  to derived reads (or dropped) once that generator is wired.

**Concern to track:** none of the exercir type-(b) rows today carry a *named* retirement
trigger in the form the rule below mandates (their comments name the generator informally
as "the observation backbone" but not a machine-checkable `retire-when:` token). They are
classified `cache-in-disguise (convert when generator lands)` rather than outright
violations because the generator is genuinely not yet wired and the intent-to-retire is
documented — but each comment should be upgraded to the canonical
`// derived-snapshot (ADR-176 pack exception): b, retire-when: <observation-backbone-wired>`
form. This is the actionable follow-up for Group D.

## Pack-side rule

> **Pack-side derived-state rule.** ADR-176 §4's prohibition on persisted derived state is *kernel-scoped*. A pack MAY persist a derived value in its own schema iff it is (a) a point-in-time decision record whose divergence from the live value is itself meaningful, OR (b) a temporary stand-in for a generator not yet wired, carrying a named retirement trigger. Every such table MUST carry a `// derived-snapshot (ADR-176 pack exception): <a|b>, retire-when: <trigger>` comment. A persisted value that is merely a faster read of a live generator is a cache-in-disguise and is **not** permitted.

Proposed for ratification as an amendment to ADR-176 — tracking issue to be filed in Group D of the remediation plan.
