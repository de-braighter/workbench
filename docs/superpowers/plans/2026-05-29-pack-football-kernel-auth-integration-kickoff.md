# Next-session kickoff — pack-football: first real consumer of the kernel auth primitives

> Paste the block below into a fresh Claude Code session launched from `de-braighter/`.
> It's a kickoff prompt, not a finished plan — the session should brainstorm + design (designer-first) before coding.

---

## PROMPT

We're picking up **pack-football integration** — wiring the substrate kernel's authorization + consent primitives end-to-end in `domains/exercir/` as the **first real consumer**. This is the natural next step after the PolicyEngine + Consent foundation + audit-role arcs all landed on `de-braighter/substrate@main`.

Before doing anything, recall context: read the memory `substrate-kernel-2026-05-29-arc-state` and `substrate-nx-vitest4-executor-and-worktree-daemon-lock`. Launch from `de-braighter/` (cluster root); the kernel work lives in `layers/substrate/`, this work lives in `domains/exercir/`.

### What already exists (don't re-derive)

**Substrate (merged on `main`, published):**
- `@de-braighter/substrate-contracts@0.7.0` + `@de-braighter/substrate-runtime@0.8.0`.
- **PolicyEngine**: `@RequiresPermission` / `@RequiresAnyPermission` / `@RequiresPermissions` decorators + `PolicyGuard`; `PackRoleAssignmentRepository.grant`; manifest `permissions[]` + `roles[]`. (ADR-127, ADR-182.)
- **Consent**: `@RequiresConsent({ purposeId, subjectFrom })` + `ConsentGuard`; `ConsentReceiptRepository.grant`; manifest `consentPurposes[]`. **OQ2 v1 lock-in: subject resolution is route-param-only** — declare e.g. `subjectFrom: 'playerId'` and the guard reads it from the route param. (ADR-184.)
- **RLS/WORM actually enforce** now under the non-superuser `app` role (substrate#41 / PR #46): every repository write is `tenant_pack_id`-scoped via the `app.tenant_pack_id` GUC set by `ScopedPrismaService`. The dev DB is provisioned with the `app`/`auditor`/`dpo`/`legal_officer` roles via `layers/substrate/docker/init-scripts/01-create-roles.sql`.

**pack-football (`domains/exercir/`):**
- `apps/pack-football-api/` — NestJS app with controllers: drills, injuries, live-telemetry, match-day, squad, plan-tree, plus a root controller. Tenants are stubbed (`src/config/stub-tenants.ts`).
- `libs/pack-football/` — `pack-football.module.ts` + `engine-player-projection.service`.
- **It depends on STALE substrate versions** (`contracts@^0.5.0`, `runtime@^0.6.0`) — predating PolicyEngine + Consent. **Step one is bumping to `^0.7.0` / `^0.8.0`.**
- Some guard/manifest scaffolding may already be partial — verify what's real vs stub before adding.

### The task

Make pack-football a genuine consumer of the kernel auth path:
1. **Bump** `domains/exercir` to substrate `contracts@^0.7.0` + `runtime@^0.8.0`; reconcile any API drift.
2. **Author the pack manifest** for football: declare `permissions[]` (e.g. `football.squad.read`, `football.injury.write`, …), `roles[]` (e.g. `tenant_admin`, `coach`, `physio`), and `consentPurposes[]` (e.g. an injury/medical-data purpose). Map each to the right kernel declaration shape.
3. **Apply the decorators** on the real controller routes — `@RequiresPermission(...)` / `@RequiresAnyPermission(...)` per route, and `@RequiresConsent({ purposeId, subjectFrom: '<routeParam>' })` on any route touching a player's medical/PHI-adjacent data (injuries is the obvious one).
4. **Wire the repositories** — grants flow through `PackRoleAssignmentRepository.grant` (role assignment) + `ConsentReceiptRepository.grant` (consent receipt), under the request's tenant_pack scope.
5. **Wire the composition root** — `SubstrateModule.forRoot({ ... })` with the manifest + the Prisma-backed repositories + guards as `APP_GUARD`; bind the app under the `app`-role connection for the integration tests.
6. **Verify end-to-end** — a request without the permission/consent is denied; with it, allowed; cross-tenant is invisible. Reuse the substrate#41 dual-URL + provisioned-roles pattern for any DB-gated enforcement test.

### How to work

- **Designer-first.** This is a new cross-cutting integration. Start with `/architecture-concierge` (or `/angular-architecture-concierge` only for any UI), then **brainstorm** the manifest shape + route→permission/consent mapping, and write a short concept doc / ADR in `layers/specs/` *before* coding. Don't free-style the manifest.
- **Mini-arc rhythm.** Follow the reusable 3-PR rhythm from the arc-state memory where it fits (e.g. PR-1 manifest + bump + boot wiring; PR-2 decorators on routes; PR-3 repository grant flows + enforcement tests). Keep PRs small and PR-gated.
- **Honor the prototype charter.** `domains/exercir` is product-layer (Ring 4/5) — the `prototype-assumptions-charter` D-gates apply (demo-mode, sandboxed external deps, **no real PHI**). The `exercir-charter-checker` joins the verifier wave on `domains/exercir/` PRs.
- **Verifier wave** on every non-trivial PR: `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker`, parallel, `isolation: "worktree"`.
- **Local gate.** `domains/exercir` has its own `ci:local`. NOTE: it's a *separate repo* from substrate — check whether it has the same `@nx/vitest`↔vitest-4 executor bug we just fixed in substrate (PR #47). If `nx test` exits 1 with no summary while `vitest run` is green, apply the same `nx:run-commands` wrapper fix (see memory `substrate-nx-vitest4-executor-and-worktree-daemon-lock`). If it hits EBUSY/orphan-daemon locks, delegate to `windows-devops-pro`.
- **Branch discipline:** verify `git branch --show-current` before every commit (shared-working-tree lesson); never bypass pre-push hooks.

### First moves

1. Recon `domains/exercir/`: read `apps/pack-football-api/src/app/app.module.ts`, the controllers, `libs/pack-football/`, and any existing manifest/guard wiring. Establish what's real vs stubbed.
2. Read the substrate side you'll consume: the manifest types + decorators + guards + repository ports in `@de-braighter/substrate-{contracts,runtime}` (in `layers/substrate/libs/`), and the consent-foundation design doc / ADR-184.
3. Resolve the open questions before coding:
   - **Permission taxonomy** — what's the minimal real permission set for football's routes? (Don't over-model.)
   - **Which routes need consent** — injuries clearly (medical-adjacent); does anything else? What's the consent `purposeId` + which route param is the subject (`playerId`?)?
   - **Roles** — `tenant_admin` / `coach` / `physio` mapping to permissions.
   - **Seeding** — how do role assignments + consent receipts get granted in the demo/stub-tenant flow?
4. Then propose the PR breakdown and confirm before implementing.

Surface a short plan + the open-question answers before writing code.
