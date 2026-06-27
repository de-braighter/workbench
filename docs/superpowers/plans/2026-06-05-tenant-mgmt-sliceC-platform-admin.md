# Tenant Management — Slice C (Platform-Admin Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Worktree off `layers/substrate` `main`. SECURITY-SENSITIVE (above-RLS platform writes + the most-privileged principal). C2 publishes `0.26.0`. The console UI is OUT (founder prototype wires to the `/platform/*` backend).

**Goal:** The platform operator onboards breed-registry tenants. `PlatformAdminService` (create/list/suspend tenant, activate pack, provision-first-admin) + `PlatformAdminGuard` (gates on the `plat='operator'` claim) + a bootstrap super-admin seed + the `/platform/*` HTTP surface. Per ADR-217 (ratified).

**Architecture:** The platform operator is a `core.user` with `platform_role='operator'` (B1) → the token's `plat` claim → `PlatformAdminGuard`. `PlatformAdminService` runs on the **`substrate_auth` connection** and gets a NEW grant: INSERT/UPDATE on `core.tenant` + `core.tenant_pack` (the `app` role STAYS excluded — negative test). `provisionFirstAdmin` is one transaction (create user + credential + membership(owner) + the pack-`admin` grant in `core.pack_role_assignment` via a `SET LOCAL app.tenant_pack_id` GUC-scoped sub-transaction — ADR-217 OQ-1=(i)). `suspendTenant`/`archiveTenant` set `core.tenant.status`/`archived_at`; a suspended tenant can't be `selectTenant`'d (a tenant-status check added to `AuthService`). Two sub-slices: **C1** (grant + service + guard + bootstrap) merges to main; **C2** (the opt-in `/platform/*` `PlatformHttpModule`) publishes `0.26.0`.

**Tech Stack:** the B1 identity repos + `provisionTenant` (A1) + `PackRoleAssignmentRepository` + the `substrate_auth` raw-SQL pattern + `GucPrismaRunner` (for the GUC-scoped grant sub-tx), NestJS guards/controllers, Vitest.

**Spec:** ADR-217 (ratified, specs#267) + the umbrella §4 Slice C. Predecessor: B3 (`0.25.0` — the token + `plat` claim + `request.authClaims`).

---

## Part C1 — grant + PlatformAdminService + guard + bootstrap (merges to main, no publish)

### Task 1: Migration — substrate_auth writes tenant/tenant_pack (the charter-condition grant)

**Files:** `prisma/migrations/<ts>_platform_tenant_write/migration.sql`; `sql/core-schema.sql`; the drift-guard spec.

- [ ] Migration: `GRANT INSERT, UPDATE ON "core"."tenant" TO substrate_auth; GRANT INSERT, UPDATE ON "core"."tenant_pack" TO substrate_auth;` (NO DELETE to anyone — a DELETE could orphan every pack's `tenant_pack_id`). Mirror into `sql/core-schema.sql`.
- [ ] **Drift guard:** `tenant`/`tenant_pack` are in `AUTH_SCOPED_TABLES` (today: SELECT-to-app + SELECT-to-substrate_auth). Now they ALSO have substrate_auth INSERT/UPDATE. Update the drift-guard assertion for these two tables: app still gets SELECT only (NOT write); substrate_auth gets SELECT+INSERT+UPDATE (no DELETE). Keep the closed-allow-list discipline. Run → green.
- [ ] Commit `feat(core): substrate_auth writes core.tenant/tenant_pack (platform write path, ADR-217)`.

### Task 2: DP-3 negative-grant — app STILL can't write tenant/tenant_pack

- [ ] DB-gated test (mirror `core-tenant-grants`): as `app`, INSERT/UPDATE on `core.tenant`/`core.tenant_pack` → REJECTED (42501); as `substrate_auth`, INSERT/UPDATE → SUCCEEDS, DELETE → REJECTED (no DELETE grant). Run green.
- [ ] Commit `test(core): app cannot write tenant tables; substrate_auth can (no DELETE) — ADR-217`.

### Task 3: `PlatformAdminService`

**Files:** `libs/substrate-runtime/src/platform/platform-admin.service.ts` (+ port for the tenant-admin repo if needed) + spec.

- [ ] Methods (return typed `Result`; run on the substrate_auth client; tests in-memory with doubles):
  - `createTenant({ slug, displayName, packKeys })` → reuses `provisionTenant` (inserts `core.tenant` + `core.tenant_pack`); returns the tenant + its derived `tenant_pack_id`(s). Reject duplicate slug.
  - `listTenants()` / `getTenant(id)` → read `core.tenant` (+ active packs).
  - `suspendTenant(id)` / `unsuspend` / `archiveTenant(id)` → set `status`/`archived_at`. Audit.
  - `activatePack(tenantId, packKey)` / `deactivatePack` → `core.tenant_pack` (provision the binding / set `deactivated_at`).
  - **`provisionFirstAdmin({ tenantId, email, displayName, tempPasswordOrInvite })`** — ONE transaction: create `core.user` + `core.user_credential` (local, argon2id via `LocalPasswordProvider.setPassword` for the temp-password path, `mustChangeOnFirstLogin` in metadata; OR an invite token) + `core.user_tenant` (tenant_role='owner') + the pack-`admin` grant in `core.pack_role_assignment` written via a **`SET LOCAL app.tenant_pack_id = <tenant's tpid>` GUC-scoped sub-tx** (ADR-217 OQ-1=(i)) so the RLS WITH CHECK passes. Atomic (rollback on any failure). Reject if the email already exists. Audit `tenant.provisioned-admin` (opaque user_id, no PII).
- [ ] Commit per logical method group (commit-per-task).

### Task 4: `PlatformAdminGuard` + bootstrap + the tenant-status check

**Files:** `src/platform/platform-admin.guard.ts`, `src/platform/seed-platform-admin.ts`, `AuthService` (the status check).

- [ ] `PlatformAdminGuard` — gates on `request.authClaims?.plat === 'operator'` (set by B3's AuthContextGuard). Reject (403) otherwise. No-throw.
- [ ] `seedPlatformAdmin({ email, password, env })` — creates `core.user` (`platform_role='operator'`) + a `local` credential (argon2id). Idempotent (refuses if the operator email exists). For db:setup / a bootstrap script. (Resolves the bootstrap paradox.)
- [ ] **Tenant-status check:** in `AuthService.selectTenant` (and the `refresh` re-issue), reject if the tenant's `status !== 'active'` (suspended/archived → `err(tenant-suspended)`). A small additive check + a test. (A suspended tenant's live access tokens expire ≤15min — documented.)
- [ ] forRoot binds `PlatformAdminService` + `PlatformAdminGuard` (singletons). Export them + `seedPlatformAdmin`.
- [ ] Commit per unit.

### Task 5: C1 gate + merge (no publish)

- [ ] `npx nx test substrate-runtime` green (in-memory service + guard tests; DB-gated grant/negative-grant green with the 3 env URLs); `tsc -b` clean; the drift guard green. Verifier wave — `local-ci` + `reviewer` (SECURITY: the platform-write grant, the provisionFirstAdmin atomicity + the GUC-scoped pack-role grant, the guard can't be bypassed, app-stays-excluded, no PII in audit, the bootstrap idempotency) + `charter-checker` (REQUIRED — the two grant widenings per ADR-209 condition) + `qa-engineer`. Address blocking. PR (Producer/Effect; Tech design ADR-217; "C1; no publish — C2 publishes 0.26.0"). **`npm install` in the worktree before push (lint gate).** Merge → twin ritual.

---

## Part C2 — the `/platform/*` HTTP surface (publishes 0.26.0)

### Task 6: `PlatformHttpModule` + controllers

**Files:** `src/platform/http/platform.controller.ts` (+ dtos) + spec; `platform-http.module.ts`.

- [ ] A separate opt-in `PlatformHttpModule.forRoot({...})` (mirror `AuthHttpModule`), all routes guarded by `PlatformAdminGuard` + throttled:
  - `POST /platform/tenants` (createTenant), `GET /platform/tenants` (list), `GET /platform/tenants/:id` (detail), `PATCH /platform/tenants/:id` (suspend/unsuspend/archive/rename), `POST /platform/tenants/:id/packs` (activate/deactivate pack), `POST /platform/tenants/:id/admins` (provisionFirstAdmin).
  - DTOs validated (the substrate convention). Errors mapped (403 non-operator, 409 duplicate slug/email, 404 unknown tenant, 400 validation). DP-2 audit on each mutation (opaque user_id).
  - Tests: each endpoint (operator → ok; non-operator → 403; the create→provision-admin flow; duplicate→409). Use the substrate's controller-test pattern (direct invocation + reflected metadata).
- [ ] Commit per logical group.

### Task 7: C2 gate + publish 0.26.0

- [ ] Full gate green; `npm view … version` (exact) → `0.25.0`; bump `0.26.0` + CHANGELOG. Verifier wave. PR ("publishes 0.26.0 — the platform-admin backend; the console UI prototype wires to /platform/*"). **`npm install` before push.** Merge → `npm publish` → verify → twin ritual.

---

## Done = (C)

`@de-braighter/substrate-runtime@0.26.0` — the platform operator can create/list/suspend breed-registry tenants and provision each one's first admin, all via `/platform/*` (guarded by `plat='operator'`, audited, the `app` role provably can't write tenant tables). A seeded bootstrap operator resolves the chicken-and-egg. **Next: D (herdbook adopts token auth + the login UI + org self-admin + the consuming-pack HTTP-boot integration test); the founder's console UI prototype wires to `/platform/*`.**

---

## Self-review (author)

- **Spec coverage (ADR-217):** §2 tenant-write grant → Task 1+2; §3 PlatformAdminService + the atomic provisionFirstAdmin (OQ-1=(i) GUC-scoped grant) → Task 3; §4 bootstrap → Task 4; the tenant-status check → Task 4; §5 `/platform/*` → Task 6. The charter-condition (two grant widenings, charter-checker required) → Tasks 1/2/5.
- **Security:** the platform operator is the most-privileged principal (short TTL + throttle + audit + bearer-only mitigate); the platform-write grant keeps `app` excluded (negative test); provisionFirstAdmin atomic with the GUC-scoped pack-role grant; the bootstrap idempotent + env-driven; no PII in audit (opaque user_id); the temp-password path sets `mustChangeOnFirstLogin`.
- **Type consistency:** reuses `provisionTenant({tenantId, slug, displayName, packKeys})` (A1), `LocalPasswordProvider.setPassword` (B1), the identity repos (B1), `PackRoleAssignmentRepository.grant` (the role repo), `GucPrismaRunner.run(tpid, fn)` (for the GUC-scoped grant). `request.authClaims.plat` (B3).
- **Risk flagged:** the tenant-write grant is the second auth-table grant widening — charter-checker is a required reviewer (ADR-209 condition). provisionFirstAdmin's GUC-scoped sub-tx must genuinely be ONE transaction (rollback-all on failure) — test the atomicity (a mid-op failure leaves no orphan user/tenant). The console UI is the founder's prototype — build only the `/platform/*` backend.
