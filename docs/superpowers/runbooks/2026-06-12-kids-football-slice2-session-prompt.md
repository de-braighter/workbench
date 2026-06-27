# Session prompt — kids-football MVP slice 2 (club operations)

> Drafted 2026-06-12 right after slice 1 merged (exercir#240). Paste into a fresh session
> launched from `de-braighter/`. Scope decision baked in: **slice 1b (Teams + Resources)
> is folded into slice 2** — the slots board references teams + resources, so it can't be
> demoed without them. Split at the marked seam if 1b should ship as its own smaller PR.

```
Continue the exercir kids-football-club MVP — build slice 2 (club operations: Teams +
Resources verticals + the conflict-aware training-slots board) via
subagent-driven-development.

Context (read in this order):
- Memory exercir-kids-football-mvp-arc — slice-1 shipped state (ex#240), the slice-1b
  carry-forwards, and the battle-tested gotcha catalog (lockfile-sync, computed-over-
  FormControl, :host tokens, Prisma JsonNull, post-findings CLI quirks). Read FIRST.
- Design spec: workbench docs/superpowers/specs/2026-06-11-exercir-kids-football-mvp-design.md
  (§8 slice ladder; slice 2 row).
- Handoff source of truth: domains/exercir/docs/design/exercir-mvp-handoff/README.md —
  data model (Slot shape: recurring bool, dow 1-7 OR date ISO, start/end float hours,
  resourceId, teamId ''=unassigned), screen 9 "Club administration" (Teams + Resources +
  Training-slots tabs incl. the Mon–Sun board + slot modal), and the conflict rule under
  "Interactions & Behavior" (same resource AND same day — dow/dow, date/date, or
  recurring-dow matching an ad-hoc date's weekday — AND a.start < b.end && b.start <
  a.end; Maintenance resources flag ALL their slots; saving allowed, conflicts flagged).

No slice-2 plan exists yet. Phase 1: write it with superpowers:writing-plans, mirroring
the slice-1 plan's shape (TDD tasks, pre-flight reading list pointing at the NOW-IN-REPO
slice-1 reference files: libs/pack-kids-football/* for the vertical pattern, the contract
suite, prisma/migrations/20260611120000_kids_football_spine for the RLS migration shape,
apps/pack-kids-football-api for composition, libs/pack-kids-football-ui for UI patterns).
PR the plan to the workbench, verifier-review it, merge, then Phase 2: execute.

Scope (in dependency order):
1. [slice 1b — SPLIT SEAM] Teams + Resources verticals — mirror the Member vertical
   exactly (ports + in-memory + Prisma repos on one contract suite each, use-cases,
   controllers with @RequiresPermission team/resource read/write, admin UI tabs with
   create/edit modals). Tables already exist in the spine migration — no schema change
   needed for these two. This REPLACES the UI demo team fixtures with the real teams
   endpoint (kill the demo-fixtures parity hack; the team switcher + members team
   controls consume live data).
2. Slot vertical — NEW prisma table (kids_football.slot: recurring, dow int?, date
   string?, start/end float, resource_id, team_id nullable, tenant_pack_id RLS per the
   spine convention incl. guarded USAGE/grant DO blocks) + forward migration; slotRead/
   slotWrite added to KF_PERMISSIONS + manifest (clubAdmin write, staff roles read);
   CRUD vertical mirroring Member; conflict detection as a PURE pack function (TDD it
   hard: dow/dow, date/date, recurring-vs-adhoc weekday, boundary times, maintenance
   flagging) surfaced on the list endpoint, never blocking saves.
3. Training-slots board UI — admin tab: summary line (n weekly slots · h/week · ⚠ n in
   conflict), + Weekly / + Ad hoc buttons, Mon–Sun board of slot cards (time display font,
   resource, team pill in team color, ⚠ red border on conflict/maintenance), ad-hoc list
   below, slot modal (Weekly/One-off toggle, day-or-date, from/until 30-min steps,
   resource select, team-or-Unassigned, live conflict warning box — red tint, lists
   overlaps, save still allowed). a11y MUST-FIX set + focus-trapped modal per slice 1.

Constraints: substrate ^2.0.0 as pinned (auth/tenant/RLS surface only — no kernel/
inference); cut feat/kids-football-s2-club-ops off exercir origin/main in a fresh
worktree (domains/exercir-wt-kf-s2), npm ci; per-task two-stage review (spec then
quality); every workspace package.json change re-runs npm install + commits the lockfile;
gates = npm run ci:local + npm run test:db (live RLS proof for the slot table); manual
browser run-through incl. a live conflict scenario before the PR. Verifier wave
(local-ci + reviewer + charter-checker + exercir-charter-checker + qa-engineer, wave
prompts forbid git ops in shared clones) + twin ritual (drain → post-findings with FULL
de-braighter/exercir#NN form, severities blocking|should-fix|nit|note, lines that exist
in the diff → merge → backfill → reconcile → ritual:post-merge). PR carries Producer:/
Effort: deep/Effect: cycle-time+findings lines and Closes a story issue.

Carry-forwards to honor in this slice: add the demo_mode anchor note only if any outbound
path appears (none expected); keep en-only i18n (de/en bundles still tracked, not this
slice); if design-system#192 has merged + published by build time, optionally switch the
UI from the local :host palette to the published skin-club-grass (low priority, own
commit). The charter forward-flag (subjectSensitivity 'developmental-minor') does NOT
fire here — slice 2 surfaces no inferred player state.
```
