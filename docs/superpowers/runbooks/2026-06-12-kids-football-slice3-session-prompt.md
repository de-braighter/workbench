# Ready-to-paste session prompt — kids-football slice 3 (onboarding wizard)

> Paste the block below into a fresh Claude Code session launched from `de-braighter/`.

---

Continue the exercir kids-football-club MVP — build slice 3 (the 5-step club onboarding
wizard) via subagent-driven-development.

Context (read in this order):
- Memory exercir-kids-football-mvp-arc — slices 1+2 shipped state (ex#240, ex#244), the
  skin-arc closure (ex#246, canonical-not-loaded + the host theme-collision lesson), and
  the battle-tested gotcha catalog (browser-run-through blind spots: initial store loads
  + per-endpoint response schemas; orphan :3150 holder; half-open conflict semantics;
  absent-key nullables; ACTIVE_TENANT_FN single provider; computed-over-FormControl;
  relative-routerLink double-resolve; post-findings CLI quirks). Read FIRST.
- Design spec: workbench docs/superpowers/specs/2026-06-11-exercir-kids-football-mvp-design.md
  (§8 slice ladder; slice 3 row: "5-step club creation (Club→Teams→Resources→Weekly
  slots→Review), seeds the club + an 8-drill starter library, signs the creator in as
  Club admin").
- Handoff source of truth: domains/exercir/docs/design/exercir-mvp-handoff/README.md —
  screen 2 "Club onboarding wizard" (segmented progress bar with labels Club, Teams,
  Resources, Weekly slots, Review; club+admin name → teams name+age chip rows →
  resources name+type → optional weekly slot rows day/from/until/resource/team → review
  cards + MOCKED invite-emails textarea; "Create club" seeds the club, signs the creator
  in as Club admin, lands on Club → Training slots) + screen 1 (the dashed "Set up a new
  club" button on sign-in = the entry point) + the prototype exercir/proto/auth.jsx.

No slice-3 plan exists yet. Phase 1: write it with superpowers:writing-plans, mirroring
the slice-2 plan's shape (TDD tasks, pre-flight reading list pointing at the NOW-IN-REPO
slice-2 reference files: the Team/Resource/Slot verticals + contract suites in
libs/pack-kids-football, the slot migration 20260612120000_kids_football_slot, the
module's generic inMemoryRepoProviders + seeds, the admin tabs + modal patterns +
kf-modal-focus in libs/pack-kids-football-ui, the slots board). PR the plan to the
workbench, verifier-review it, merge, then Phase 2: execute.

TWO DESIGN QUESTIONS the plan must answer FIRST (resolve at plan time; if either needs a
real spec, do a designer-first pass before the plan PR):
1. Runtime club creation = runtime TENANT creation. Today tenants are static STUB_CLUBS
   passed to SubstrateModule.forRoot at boot. Determine what the published substrate
   ^2.0.0 tenant-registry surface supports for registering a tenant at runtime
   (in-memory registration vs persisted TenantRegistry vs an exercir-side workaround);
   pick the simplest demo-honest mechanism and pin it in the plan. NOTE the
   exercir-charter consequence: a tenant-creation path is exactly where charter §6 wants
   `demo_mode = true` by default — the long-deferred demo_mode anchor likely FIRES in
   this slice; budget a task for it (TenantDescriptor anchor + created-tenant default)
   and tell exercir-charter-checker about it in the wave prompt.
2. The 8-drill starter library: the drill table is slice-4 territory. Decide pull the
   drill table forward (schema + minimal CRUD-less seed) vs stub the starter library
   (e.g. seed nothing, leave a pinned TODO seam for slice 4). Decide by what slice 4
   actually needs — don't build drill CRUD here.

Scope (in dependency order):
1. Club provisioning vertical — create-club use-case + endpoint orchestrating: tenant
   registration (per design question 1, demo_mode default true), club row, admin member
   + role grant (PACK_ROLE_ASSIGNMENT_REPOSITORY.grant at runtime, mirroring the
   bootstrap's grantIfAbsent), teams, resources, optional weekly slots (reuse the
   existing verticals' ports — the wizard payload is one POST, validated with zod
   composed from the existing Create*Input schemas), starter library per design
   question 2. Cascading-failure posture documented (same non-atomicity convention as
   the delete cascades). RBAC: club creation is PRE-AUTH (no session exists yet) —
   decide + pin the gating (open demo endpoint with demo_mode guard is acceptable for
   the prototype; say so explicitly).
2. Wizard UI — routed at the pack root (entry: the dashed "Set up a new club" button on
   sign-in): 5 steps with segmented progress bar, reactive forms per step (chip rows for
   teams/age, add/remove rows for resources + weekly slots reusing HALF_HOUR_OPTIONS/
   fmtHour from kf-slot-time), review step with cards + mocked invite-emails textarea
   (NO outbound anything — it is a textarea, period), Create club → store the returned
   identity in KfSessionService (the new admin is NOT in the static DEMO_USERS picker —
   the create response carries the session identity), navigate to /admin/slots. a11y
   MUST-FIX set (focus management between steps, aria-current on the progress bar,
   ≥24px targets, enabled-submit) + the shared kf-modal-focus helpers where applicable.
3. Sign-in integration — the dashed button, plus the multi-club picker staying intact
   for the stub clubs; a freshly created club's tenant URL must work end-to-end
   (/t/<new-tenant>/p/kids-football/...).

Constraints: substrate ^2.0.0 as pinned (auth/tenant/RLS surface only — no kernel/
inference); cut feat/kids-football-s3-onboarding off exercir origin/main in a fresh
worktree (domains/exercir-wt-kf-s3), npm ci; per-task two-stage review (spec then
quality); any workspace package.json change re-runs npm install + commits the lockfile;
gates = npm run ci:local + npm run test:db (extend the live RLS proof to any NEW table);
manual browser run-through: full wizard run creating a club end-to-end (incl. a weekly
slot row), landing signed-in on the new club's Training slots board, plus stub-club
regression (sign-in picker + slice-2 surfaces untouched) — screenshot the review step +
the landed board. Verifier wave (local-ci + reviewer + charter-checker +
exercir-charter-checker + qa-engineer, wave prompts forbid git ops in shared clones,
PR head readable in the dedicated worktree) + twin ritual (drain → post-findings with
FULL de-braighter/exercir#NN form, severities blocking|should-fix|nit|note, lines that
exist in the diff — re-anchor onto in-diff files if a path drops out of the diff →
merge → backfill → reconcile → ritual:post-merge). PR carries Producer:/Effort: deep/
Effect: cycle-time+findings lines and Closes a story issue.

Carry-forwards to honor in this slice: the demo_mode anchor (see design question 1 —
it fires HERE); exercir#245 (F1 event-log posture) is still open — the wizard's create
path ADDS mutations, so either wire the F1 event-log write here (closing #245's
deferred branch) or extend #245's doc-comment posture to the new services and say so in
the PR; en-only i18n (de/en split stays tracked, not this slice); the published skin is
canonical-not-loaded (ex#246) — do NOT load it globally in the shared host (the
theme-collision lesson), the parity spec guards the palette; subjectSensitivity
'developmental-minor' still does NOT fire (the wizard surfaces no inferred player
state) — it arms at slice 7/8.
