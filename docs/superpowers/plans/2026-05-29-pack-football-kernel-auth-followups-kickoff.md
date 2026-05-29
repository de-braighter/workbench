# Next-session kickoff — pack-football kernel-auth follow-ups (DB-level RLS infra arc + retire the transitional stub)

> Paste the block below into a fresh Claude Code session launched from `de-braighter/`.
> It's a kickoff prompt, not a finished plan — the session should recall context, then
> brainstorm + design (designer-first) the infra arc before coding. The two follow-ups are
> independent; pick the order (the stub-retirement is the smaller, lower-risk one — a good warm-up).

---

## PROMPT

We're picking up the **two tracked follow-ups** from the pack-football kernel-auth arc, which is now fully merged (`@de-braighter/substrate-contracts@0.7.0` + `runtime@0.8.0` published; specs#225 + exercir#110 + exercir#111 all on `main`). pack-football is the kernel auth path's first real consumer end-to-end — every route permission-gated, the per-player injury route consent-gated, and the deny/allow/withdraw/cross-tenant matrix proven through the real guard cascade with **in-memory** repositories.

**Before doing anything, recall context:** read the memories `pack-football-kernel-auth-integration-state` (the whole arc + both follow-ups + gotchas) and `substrate-nx-vitest4-executor-and-worktree-daemon-lock` (local-gate gotchas). Launch from `de-braighter/` (cluster root); this work lives in `domains/exercir/`. **Use git worktrees** for isolation (the founder's standing preference): create one in `domains/exercir/.worktrees/<branch>` — `.worktrees/` is already gitignored.

### Follow-up A — retire the transitional `coachFromHeaders` / `CoachPrincipal` stub (smaller; do first)

PR-1 kept this stub as transitional defense-in-depth behind the now-authoritative `PolicyGuard`. It's dead weight: `coachFromHeaders()` (in `pack-football-drills.controller.ts` + `pack-football-match-day.controller.ts`) fabricates `roles: ['football.coach']` for every request and passes a `CoachPrincipal` **into** the S-6/S-7 use-cases, which run their own `coachPrincipalHasRole(principal, 'football.coach')` check and can return a `'forbidden'` failure — all now redundant with the guard.

The task: remove the application-level principal authz cleanly.
1. Drop the `principal` / `CoachPrincipal` parameter from the affected use-case signatures — at least `ForkTemplateUseCase`, `UpdateDrillDiagramUseCase`, `ApplySubstitutionUseCase`, `ApplyFormationChangeUseCase` (grep for `CoachPrincipal` + `coachPrincipalHasRole` to find the full set; check the S-6/S-7 reha/match-day services too).
2. Remove the internal role-check + the `'forbidden'` failure variant from each (and the now-dead `coachPrincipalHasRole` / `CoachAuthzFailure` if nothing else uses them).
3. Delete `coachFromHeaders()` from the controllers; the routes are already `@RequiresPermission`-gated.
4. Update every caller + spec. **This is the bulk of the work** — it's a signature-change ripple across use-cases + their unit specs + the controller integration specs. Keep the public in-port symbols stable where you can; only the principal param goes.
5. Confirm `AdminPrincipal` / `FootballRoleSchema` survive if still used by S-11 admin use-cases (don't over-delete — grep first).

This is **TDD-shaped**: each use-case has a spec; change the spec to drop the forbidden-principal cases, watch it fail to compile, then adjust the signature. Don't free-style the deletion.

### Follow-up B — DB-level RLS enforcement (the infra arc; `exercir#112`)

PR-2's enforcement matrix runs on **in-memory** repos. The DB-level RLS cross-tenant invariant (the kernel `core.pack_role_assignment` / `core.consent_receipt` tables under the non-superuser `app` Postgres role) is **not** re-exercised in exercir — exercir's `prisma/schema.prisma` has no `core.*` tables and provisions no `app`/RLS roles. It IS proven at the substrate layer (substrate#41). This arc brings the capability into exercir. **Designer-first — this needs a short concept doc / decision before coding.**

The task (per `exercir#112`):
1. **Schema** — bring kernel `core.pack_role_assignment` + `core.consent_receipt` (+ their RLS policies, partial-unique indexes, soft-delete columns) into exercir's database. Decide the mechanism: import substrate's migrations vs a generated exercir migration vs a shared migration package. (Open question — see below.)
2. **Roles** — provision the `app` non-superuser role in exercir's dev DB, mirroring `layers/substrate/docker/init-scripts/01-create-roles.sql`. Find where exercir's DB/docker provisioning lives (the shared dev-Docker stack is referenced from the cluster; confirm the exact path) and add the role init so it runs before migrations on a fresh volume.
3. **Wire the Prisma adapters** — `PrismaPackRoleAssignmentRepository` + `PrismaConsentReceiptRepository` (already in `@de-braighter/substrate-runtime`; both take `ScopedPrismaService`). Bind them in `app.module.ts` behind a DB flag, mirroring the existing `PACK_FOOTBALL_KERNEL_OUTBOX` env-gated provider block. The dual-URL pattern: `SUBSTRATE_APP_DATABASE_URL` for the app-role connection; `ScopedPrismaService` sets the `app.tenant_pack_id` GUC per request.
4. **DB-gated test** — a cross-tenant RLS enforcement spec that **skips cleanly** when the DB / role / env aren't present (mirror substrate#41's guard, including a meta-guard that fails loudly if a DB is reachable but `SUBSTRATE_APP_DATABASE_URL` is unset). Extend/mirror the existing `apps/pack-football-api/src/app/pack-football-authz-enforcement.spec.ts` shape — grant in tenant A, query under tenant B's `app.tenant_pack_id` GUC, assert RLS returns no rows (true DB-level invisibility, not just repo-scoping).

Resolve before coding (open questions for B):
- **Migration ownership.** Does exercir own a copy of the `core.*` migration, or consume substrate's? (Avoid drift — if substrate's `core.*` schema changes, exercir must not silently diverge. A shared/published migration is cleaner than a copy-paste.)
- **Demo-mode default unchanged.** The InMemory adapters + demo seed (`PackFootballAuthBootstrap`) stay the default; the Prisma path is flag-gated and dev/CI-only. Confirm the bootstrap's idempotent grant seed still works against the Prisma adapters (the `grant`/`findActive*` ports are identical; ADR-184 Invariant 7 `grantedByActorId` non-empty still applies).
- **Charter.** Still product-layer, still no real PHI — the DB rows are synthetic demo grants/consents. `exercir-charter-checker` will check §4 (real schemas/RLS are *expected* here, unlike PR-1/PR-2) + that no real PHI lands.

### How to work (both follow-ups)

- **Worktrees.** One worktree per follow-up (or one for both if done together). `git worktree add .worktrees/<branch> -b <branch>`. Teardown after merge: `nx daemon --stop` in the worktree first (orphan-daemon EBUSY risk), then `rm -rf .worktrees/<name>` (`git worktree remove` fails on the worktree's `node_modules`) + `git worktree prune`.
- **Local gate, vitest not nx.** `apps/pack-football-api/project.json` still uses the buggy `@nx/vitest:test` executor — run suites via the `vitest` CLI directly (`npx vitest run --config <path> --coverage.enabled=false`). `nx build` / `nx lint` are fine. (Switching the api `test` target to `nx:run-commands` per substrate PR#47 is itself a small optional hygiene fix.)
- **DI gotcha.** Any new exercir provider/bootstrap that injects a substrate engine **must** use explicit `@Inject(PolicyEngine)` / `@Inject(ConsentEngine)` — this app doesn't emit the decorator type-metadata Nest needs for class-token injection (bit us in PR-1: `this.policyEngine` came back `undefined` → `app.init()` cascade-failed).
- **Verifier wave** on every non-trivial PR: `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker`, parallel, `isolation: "worktree"`. For Follow-up B (real schema + RLS + migration) run the full wave; charter-checker matters here (it touches DB schema, though still pack-side `core.*` consumption, not kernel authorship).
- **Branch discipline:** verify `git branch --show-current` before every commit; never bypass pre-push hooks. PR-gated everywhere. Reconcile any concept doc with as-shipped before merging it.

### First moves

1. Recall the two memories above. Decide order (recommend Follow-up A first — contained refactor, no infra).
2. For A: grep `domains/exercir` for `CoachPrincipal`, `coachPrincipalHasRole`, `coachFromHeaders`, `CoachAuthzFailure` to map the full blast radius before touching anything. Propose the signature changes + confirm.
3. For B: read `exercir#112`, the substrate#41 work (`layers/substrate/docker/init-scripts/01-create-roles.sql` + the activated WORM/RLS specs), and exercir's `prisma/schema.prisma` + docker/DB provisioning. Resolve the migration-ownership open question, write a short concept doc / decision, then implement.
4. Surface a short plan + the open-question answers (especially migration ownership) before writing code.
