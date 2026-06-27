# Tenant Management — Slice B2b (AuthService Orchestration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Worktree off `layers/substrate` `main`. SECURITY-SENSITIVE — verifier wave includes a dedicated security pass.

**Goal:** The `AuthService` that orchestrates the B1 identity + B2a session/crypto primitives into login / select-tenant / refresh (with **rotation + reuse-detection**) / logout, the **DP-2 audit** (opaque `user_id`, no PII), and the **DP-4 erasure-cascade**. Service layer only — no HTTP (B2c), no publish (rides with B2c).

**Architecture:** `AuthService` composes the existing ports: `IdentityProvider` + the identity repos (B1), `SessionRepository` + `AccessTokenService` + `RefreshTokenService` (B2a), the `TenantRegistry` (resolve `tenant_pack_id`), the `PackRoleAssignmentRepository` (roles), and the `AuditService` (`kernel.AuditEvent`). Refresh implements RTR: rotate an active token; a replayed *rotated* token → revoke the whole family + audit `session.reuse-detected`. DP-2: every auth event audited with `user_id` only (no email/PII in payloads — tested). DP-4: `eraseUser` hard-deletes credentials + sessions + memberships and tombstones the user. Pure service logic; tested in-memory (no DB needed for the orchestration tests; the repos have in-memory doubles).

**Tech Stack:** TypeScript ESM, NestJS DI, the B1+B2a ports, `kernel.AuditEvent` via the substrate `AuditService`, Vitest.

**Spec:** ADR-211 (ratified+amended specs#258) §Decision/4 (RTR), §Decision/6 (errors), DP-2 (audit), DP-4 (erasure). Predecessor: B2a (`core.session` + crypto on substrate main, `ecaf680`).

---

## Repos & key facts

- All in `layers/substrate` (worktree off main, which has B1+B2a; `substrate-runtime` is at 0.23.0 on main, unpublished B2a additions).
- `AuthService` is a singleton (no request scope; it takes ids as args). Place under `libs/substrate-runtime/src/auth/auth.service.ts`.
- **DP-2 (load-bearing):** audit actor = `user_id` (opaque uuid); NEVER put email/display-name/password/token in an audit payload. The substrate `AuditService` writes `kernel.AuditEvent` — find its exact API (method, the event shape, the subtype registry) and use it; the auth subtypes (`login.success`, `login.failure`, `session.refresh`, `session.reuse-detected`, `session.revoke`, `user.erased`, `membership.change`) must be declared if the AuditSubtypeRegistry validates them at boot (check — like the pack manifests declare audit subtypes). A test asserts no audit payload field contains an `@`/email-shaped or password-shaped value.
- **Errors:** `AuthService` returns typed `Result` (no throws across the boundary). Distinguish `invalid-credentials` (generic, security) from `provider-error`/infra failure (for B2c to map to 503 + alerting) — but login still responds generically; the distinction is in the typed error for the caller, not leaked to the end user.
- No HTTP, no throttling (B2c), no publish.

---

## Task 1: AuthService — `login`

**Files:** create `libs/substrate-runtime/src/auth/auth.service.ts` + `.spec.ts`.

- [ ] **Step 1: Write the failing test.** `login({ email, password })`:
  - verifies via `IdentityProvider` → on `invalid-credentials`, returns `err(invalid-credentials)` + audits `login.failure` (actor = the email-resolved user_id IF the user exists, else a null/anonymous actor — but NEVER the email in the payload; if no user, audit `login.failure` with `outcome:'unknown-principal'` and no PII).
  - on success: loads the user's active memberships (`UserTenantRepository.findByUser`), generates a refresh token (`RefreshTokenService`) + creates a session (`SessionRepository.create` with `family_id = a new uuid`, `refresh_hash`, `expires_at`, `active_tenant_id = null` for multi or the single tenant), and returns `ok({ refreshToken, user: {id, displayName}, tenants: [{tenantId, tenantRole, displayName}], accessToken? })`. If the user has exactly ONE active tenant, auto-issue an access token bound to it (call the shared `issueAccessFor(session, tenantId, packId)` from Task 2); if >1, `accessToken` is omitted (client must `selectTenant`).
  - audits `login.success` (actor user_id, no PII).
  - a disabled user → `err(user-disabled)` (after the IdentityProvider's verify, which already handles it) + audit `login.failure outcome:'disabled'`.
- [ ] **Step 2: Run → fail.** **Step 3: Implement.** **Step 4: Run → green.**
- [ ] **Step 5: Commit** `feat(auth): AuthService.login (verify → session + refresh, single-tenant auto-issue, DP-2 audit)`.

---

## Task 2: AuthService — `selectTenant` + the shared `issueAccessFor`

**Files:** `auth.service.ts` + spec.

- [ ] **Step 1: Write the failing test.** `selectTenant({ refreshToken, tenantId, packId })`:
  - hash the refresh token → `SessionRepository.findByRefreshHash` → must be active (not rotated/revoked/expired) → else `err(invalid-session)`.
  - assert the user is a member of `tenantId` (`UserTenantRepository.findByUserAndTenant`, active) → else `err(not-a-member)`.
  - resolve `tenant_pack_id` via `TenantRegistry.resolveTenantPackId(tenantId, packId)` → if null, `err(pack-not-enabled)`.
  - resolve roles: `PackRoleAssignmentRepository.findActiveForUser(tenantPackId, userId)` (or the equivalent) → the `roles[]` claim.
  - update the session's `active_tenant_id`, issue an access token via `issueAccessFor`, return `ok({ accessToken })`.
  - `issueAccessFor(session, userId, tenantId, packId, tpid, roles, platformRole)` builds the ADR-211 claims (`sub`,`tid`,`tpid`,`pack`,`roles`,`sid`=session.id,`plat`,`iat`,`exp`,`nbf`) → `AccessTokenService.issue`.
- [ ] **Step 2: fail → 3: implement → 4: green.**
- [ ] **Step 5: Commit** `feat(auth): AuthService.selectTenant + issueAccessFor (membership + tpid + roles → EdDSA token)`.

---

## Task 3: AuthService — `refresh` with rotation + REUSE-DETECTION

**Files:** `auth.service.ts` + spec. **THE security-critical task.**

- [ ] **Step 1: Write the failing tests** (multiple — this is the load-bearing security logic):
  - **Happy rotation:** `refresh({ refreshToken })` on an ACTIVE session → generates a NEW refresh token, creates a NEW session row (same `family_id`, `active_tenant_id` carried over), `markRotated(oldId, newId, now)` on the old, issues a NEW access token, returns `ok({ accessToken, refreshToken })`. The old refresh token no longer works.
  - **REUSE DETECTION:** presenting an ALREADY-ROTATED refresh token (its hash matches a row with `rotated_at` set) → DO NOT issue; `SessionRepository.revokeFamily(familyId)` (revoke EVERY session in the family — log the user out everywhere), audit `session.reuse-detected` (actor user_id), return `err(token-reuse-detected)`. Assert: after this, the legitimate (newer) token in the family is ALSO revoked.
  - **Revoked / expired / unknown token** → `err(invalid-session)` (generic; audit nothing or a benign failure). A revoked-family token → `err`.
- [ ] **Step 2: fail → 3: implement** the rotate-vs-reuse branch carefully (active → rotate; rotated → reuse → revoke family; revoked/expired/missing → invalid) → **4: green.** Verify the reuse-detection test actually revokes the whole family.
- [ ] **Step 5: Commit** `feat(auth): AuthService.refresh — RTR rotation + reuse-detection (replayed token revokes the family)`.

---

## Task 4: AuthService — `logout` + the DP-4 `eraseUser` cascade

**Files:** `auth.service.ts` + spec.

- [ ] **Step 1: Write the failing tests.**
  - `logout({ refreshToken })` → `SessionRepository.findByRefreshHash` → `revoke(session.id)` (or `revokeFamily` for logout-all; `logout` revokes the one session, `logoutAll(userId)` revokes all). Audit `session.revoke`. Idempotent (logging out an already-revoked session is a no-op `ok`).
  - **DP-4 `eraseUser({ userId })`** (erasure-cascade): hard-delete `UserCredentialRepository.deleteForUser` + `SessionRepository.deleteForUser` + the memberships (`UserTenantRepository.deleteForUser` or mark left) + tombstone/anonymize `core.user` (`UserRepository.anonymize/disable` — null the email→`deleted-<uuid>`, displayName→"Deleted user", status `disabled`). Audit `user.erased` (actor user_id — which survives as the opaque reference; the email↔uuid mapping is severed, reconciling DP-2/audit-immutability). Assert: after erasure, the credentials + sessions are gone, the user row is tombstoned (no PII), and `login` with the old email fails.
- [ ] **Step 2: fail → 3: implement → 4: green.** (Add `deleteForUser`/`anonymize` to the B1 identity repos if missing — in-memory + Prisma + the contract suite.)
- [ ] **Step 5: Commit** `feat(auth): AuthService.logout + eraseUser DP-4 cascade (credential/session/membership delete + user tombstone)`.

---

## Task 5: DP-2 audit integrity — the no-PII test

**Files:** `auth.service.spec.ts` (or a dedicated `auth-audit-no-pii.spec.ts`).

- [ ] **Step 1: Write the test:** drive `login` (success + failure), `refresh` (+ reuse), `logout`, `eraseUser` with a recording `AuditService` double; collect EVERY emitted audit event; assert NO payload field (recursively) contains an `@`-shaped string (email), the password, or the raw/hashed token — only `user_id` (uuid), event subtype, tenant context, outcome. This is the ADR-211 DP-2 load-bearing guarantee.
- [ ] **Step 2: Run → green** (fix any event that leaks PII). Confirm the auth subtypes are declared wherever the substrate validates audit subtypes at boot.
- [ ] **Step 3: Commit** `test(auth): DP-2 — no PII/email/secret in any auth audit payload`.

---

## Task 6: forRoot wiring + gate

**Files:** `composition-root/substrate.module.ts`, the barrel.

- [ ] **Step 1:** Bind `AuthService` (a singleton constructed with the identity + session + token + registry + role + audit dependencies). Export `AuthService` + its result/error types from the barrel.
- [ ] **Step 2: Gate:** `npx nx test substrate-runtime` green (the AuthService specs are in-memory — no DB needed; DB-gated repos still skip without env); `npx tsc -b libs/substrate-runtime` clean.
- [ ] **Step 3: Verifier wave** — `local-ci` + `reviewer` (SECURITY: the reuse-detection branch correctness, no-PII audit, generic errors, no secret logging, the erasure cascade completeness, no timing oracle in login) + `charter-checker` (no new table — confirms the AuthService stays governance-ring + consent-separated) + `qa-engineer`. Address blocking findings.
- [ ] **Step 4:** NO publish (B2b → main; publish lands with B2c). PR (Producer/Effect; Tech design ADR-211; "Out of scope: HTTP + throttling + publish = B2c"). Verifier wave → merge → twin ritual.

---

## Done = (B2b)

`AuthService` on substrate main: `login` (→ session + refresh, single-tenant auto-issue), `selectTenant` (membership + tpid + roles → EdDSA token), `refresh` (**RTR rotation + reuse-detection** — a replayed token revokes the family), `logout`/`logoutAll`, and `eraseUser` (DP-4 cascade). Every auth event audited with **no PII** (DP-2 tested). Not published. **Next: B2c (`/auth/*` HTTP + JWKS endpoint + throttling + the refresh cookie → publishes 0.24.0).**

---

## Self-review (author)

- **Spec coverage:** §Decision/4 RTR → Task 3 (the reuse-detection branch is the crux); §Decision/6 errors → Tasks 1–4 (typed Result, generic invalid-credentials, provider-error distinction); DP-2 audit → Task 5 (the no-PII test); DP-4 erasure → Task 4. The `/auth/*` HTTP + throttling + cookie + publish are B2c — correctly out.
- **Security emphases:** the reuse-detection branch (active→rotate, rotated→revoke-family) gets dedicated tests; no-PII audit (DP-2) tested; generic errors (no account-existence oracle carried from B1's LocalPasswordProvider — login surfaces the same generic error); no secret logging; the erasure cascade is complete (credential+session+membership+user-tombstone); audit actor = opaque user_id (severs the PII mapping on erasure).
- **Type consistency:** `issueAccessFor` shared between Task 1 (single-tenant auto-issue) + Task 2 (selectTenant); the session `family_id`/`rotated_to` (from B2a) used by Task 3's rotation; the repo methods (`findByRefreshHash`, `markRotated(id, successorId, at)`, `revokeFamily`, `deleteForUser`, `anonymize`) match B2a's port + B1's identity repos (add `deleteForUser`/`anonymize` to identity repos if missing, Task 4).
- **Risk flagged:** the AuditService API + the audit-subtype-registration are the integration unknowns — reconcile against the real substrate AuditService. The reuse-detection family-revoke must be atomic enough that a concurrent refresh can't slip through (single-threaded test proves the logic; note concurrency as a B2c/prod concern).
