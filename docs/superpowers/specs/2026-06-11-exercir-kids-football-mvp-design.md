# Exercir MVP — kids-football-club training planner (design)

> **Status:** approved (brainstorming) 2026-06-11. The architecture + slice ladder for a small, *sellable* exercir MVP that runs on the existing pack/UI surface — **no fat kernel logic** (the Bayesian twin/what-if is explicitly out of the critical path).
> **Design handoff (the complete product spec — the source of truth for screens/data/tokens):** `domains/exercir/docs/design/exercir-mvp-handoff/` (README + interactive HTML prototype + React JSX reference). High-fidelity "Club Grass" direction. The JSX is reference-only; recreate in the Angular/Nx target.
> **Repo:** `domains/exercir`. **Substrate:** consumes published `@de-braighter/substrate-{contracts,runtime}@2.0.0`.

## 1. Goal

Ship a sellable training-planning product for **kids' football clubs**: a coach designs drills (pitch sketches + a measurable "expected effect"), sequences them into reusable templates, schedules templates onto club-defined time slots (→ calendar events), runs sessions pitch-side (timers, attendance, per-drill effect checks), and maintains a team view with player notes + development history; a club admin manages members/teams/resources and a conflict-aware training-slot board. Role-based sign-in, multi-team coach switcher, 5-step onboarding wizard. The clickable prototype already validated the UX — this builds the real, persistent product.

## 2. Founder decisions (2026-06-11 brainstorming)

1. **Buyer/wedge:** kids' football, inside a club (not B2C player, not generic multi-sport).
2. **Architecture home:** *grow `pack-kids-sports`* into the kids-football-club product (reuse its `manifest/application/out-adapters/ui` scaffolding) — NOT a retrofit of the partial pack-football demo surfaces, NOT a fully-clean new pack. Working pack name: **`pack-kids-football`** (grown from kids-sports; final name TBD at scaffold).
3. **Build fresh to Club Grass**, reusing: substrate auth/tenant + design-system bricks where they fit + the **pack-football board engine** for the pitch sketcher.
4. **Persistence: real per slice** — every vertical slice ships UI + API + pack tables + auth (real per-club data). The prototype already validated the UX, so no throwaway in-memory store.
5. **"Expected effect" stays plain pack data** for v1 (text + yes/no checks), with a clean forward seam to the kernel — not promoted now.

## 3. Architecture

A vertically-sliced product, three layers per the existing pack convention:

- **`pack-kids-football-contracts`** — typed entities + Zod schemas for the 8 entities (Club, Member, Team, Resource, Slot, Drill, Template, Event), shared between API + UI.
- **API** (NestJS, grown in the kids-sports `application` + `out-adapters`) — pack Prisma tables + endpoints, composed on `SubstrateModule.forRoot` for **RLS-scoped per-club persistence** (each club is a tenant; all rows tenant-scoped). Auth via the substrate's role-based sign-in.
- **`pack-kids-football-ui`** (Angular standalone + signals) — the 9 screens, Club Grass tokens, reactive forms + CVA, design-system bricks.

The kernel is used **only** as the tenant/auth/RLS substrate — there are **no kernel concepts** (no plan-tree, no effect-declaration, no inference) in this MVP.

## 4. Data model → pack tables (pack territory, not kernel)

The handoff's 8 entities (full shapes in the handoff README §"Data Model") map to **pack tables** under a club-scoped tenant:

- **Structured columns** for queryable/relational/conflict-relevant fields: roles, ages (`U7..U12`), team/resource foreign keys, slot `dow`/`date`/`start`/`end`, event `date`/`teamId`, etc.
- **JSONB columns** for the flexible shapes: `drill.sketch[]` (the 860×560 element array), `drill.points[]`, `drill.equipment[]`, `template.items[]`, `event.attendance{}`, `event.run{log,ratings}`, `member.notes[]`. This is the deliberate pack-representation/`metadata` boundary (ADR-176 — complexity lives in the pack, not the kernel).
- **Cascades** enforced at the API per the handoff: drill→templates→events; template→its events; team→member/slot assignments cleared; resource→its slots.
- **Tenancy:** the **Club** is the tenant root; every table is RLS-scoped to the club. Roles (Coach / Assistant coach / Team manager / Club admin / Facilities) gate navigation + mutations per the handoff permissions table. Events are team-scoped; the team switcher re-scopes calendar/roster/scheduling.

## 5. The "expected effect" seam (lightweight now, kernel-ready later)

The product differentiator stays simple in v1: a free-text `effect` field on a Drill (visually distinct everywhere per the handoff) + per-drill `yes/no` effect-checks captured during run-session wrap-up, aggregated into the player "development" view (focus-area counts + recent effect checks for sessions the player attended). **No inference, no kernel.** The forward seam (deferred, demand-driven): the drill effect could later promote to a kernel effect-declaration and the run checks to observations feeding the twin — but only on demonstrated need, never speculatively.

## 6. Visual — "Club Grass"

Adopt the handoff's warm-chalk palette as the pack's design tokens (paper `#F5F3EC`, ink `#1C2520`, grass-green accent, phase colors Warm-up `#E8A93C` / Technical `#4C9BD6` / Game `#5BA864` / Cool-down `#9C8DC9`, match-orange `#D4683B`, over-budget `#FFB199`). Reuse design-system **structural/interaction bricks** (modals, steppers, chips, reactive-form controls, page-head) themed to Club Grass where they exist; build the **bespoke behavior-heavy pieces fresh** — the SVG pitch sketcher, the calendar week-grid, the run-session timer. Full token list + per-screen interaction specs live in the handoff README.

## 7. Reuse

- **Substrate 2.0.0** — role-based auth, tenant/RLS per club, the pack-on-platform `SubstrateModule.forRoot` composition.
- **pack-football board engine** (the board-runtime from exercir#214) — the sketcher's SVG coordinate space (860×560), place/drag/undo (24-step) interactions, pitch rendering with mowing stripes. Adapt, don't fork.
- **design-system bricks** — modals, reactive-forms + CVA controls, chips, steppers, page-head.
- **i18n** — strings via the ADR-012 i18n convention (de source / en); the handoff copy is English — German is the likely primary club locale (confirm at scaffold).

## 8. Slice ladder (each ships real: UI + API + pack tables + auth; own spec→plan→build)

1. **Foundation + club spine** — pack scaffold (grow kids-sports → kids-football), Club Grass tokens, role-based sign-in, shell + team switcher, club-admin CRUD for **Members / Teams / Resources** (with RLS per club).
2. **Training-slots board** — recurring (`dow`) + ad-hoc (`date`) slots, the Mon–Sun board, conflict detection (same resource + overlapping time + matching day; maintenance flags all its slots; saving allowed, conflicts flagged).
3. **Onboarding wizard** — the 5-step club creation (Club→Teams→Resources→Weekly slots→Review), seeds the club + an 8-drill starter library, signs the creator in as Club admin.
4. **Drill library + editor + pitch sketcher** — drill CRUD, the SVG sketcher (reuse the board engine), the "expected effect" card.
5. **Templates** — list + builder, drag-sequence drills, the phase-colored budget bar (over-budget warns, allowed).
6. **Calendar + scheduling** — week grid (auto-expanding hour range), open-slot ghosts, schedule modal (template→slot→event, slot-length validated, one-event-per-slot-per-date), match modal, event detail.
7. **Run session** — pre-start (attendance snapshot, who's-here cycle), live (per-drill countdown from `drillStartedAt`, survives reload; effect callout), wrap-up (per-drill actual-vs-planned + yes/no effect checks).
8. **Team view + player modal** — roster (last-5 attendance dots, present %), player notes (dated), per-event attendance toggles, development aggregation (focus-area counts + effect checks from attended runs).

**First sellable milestone:** the coach loop is complete around slices 1 + 4 + 5 + 6 + 7 (drills → template → schedule → run); slices 2–3 bootstrap it (a club + slots must exist to schedule); slice 8 is the retention payoff. Build order is the numeric order (each depends on the prior's tables): 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8.

## 9. Non-goals (v1)

- The Bayesian twin / what-if / any inference (the "no fat kernel logic" constraint).
- Player or Facilities sign-in (per the handoff roles — those roles have no MVP sign-in).
- Native mobile apps (responsive web; the run-session screen is mobile-width by design).
- Porting the localStorage prototype store (it is replaced by real API + DB, not migrated).
- Match-day tactics / lineup depth from the existing pack-football surfaces (the MVP's "Match" is a lightweight calendar event, not the tactical board).

## 10. Acceptance (MVP)

A club admin can onboard a club (teams, resources, weekly slots, members); a coach signs in (scoped to their team(s), with a switcher), builds drills with pitch sketches + an expected effect, sequences them into templates, schedules templates onto club slots (conflict- and length-checked) and matches onto the calendar, runs a session pitch-side (timers, attendance, effect checks), and reviews each player's attendance + development — all persisted per-club with role-gated access. No kernel inference anywhere; the substrate provides only auth + tenant/RLS.
