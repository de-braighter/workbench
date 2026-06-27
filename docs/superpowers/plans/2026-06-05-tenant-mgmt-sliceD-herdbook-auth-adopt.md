# Tenant Management — Slice D (Herdbook Auth Adoption) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Worktree off `domains/herdbook` `main`. The payoff slice — herdbook gets real login on the published auth layer.

**Goal:** herdbook adopts `@de-braighter/substrate-runtime@0.26.0`: mount the auth HTTP layer, seed a demo user + credential, prove `/auth/login → token → authenticated request` end-to-end through the **real HTTP wire pipeline** (the gap B2c's unit tests left), and (D2) a functional login UI + bearer interceptor + tenant context. **D1** = backend adoption + the integration test; **D2** = the Angular UI.

**Architecture:** herdbook's NestJS app imports `AuthHttpModule.forRoot(...)` alongside `SubstrateModule.forRoot(...)` → `/auth/*` + JWKS are served. A seed creates a demo `core.user` (the registrar) + a `local` argon2id credential + membership + the registrar role grant under the herdbook tenant. The **dev-header shim stays ON for the existing test corpus** (so the 416/253 suites stay green) — token login is ADDED, not forced; a token-only mode is `SUBSTRATE_DEV_HEADER_AUTH=false`. A **supertest HTTP-boot integration test** boots the real app and exercises login → token → a Bearer-authenticated `/animals` call (proving cookie-parser, throttler, @HttpCode, the guard chain on the wire). D2: an Angular login screen + a bearer interceptor (replacing the dev-header interceptor) + tenant context from the token + a tenant switcher.

**Tech Stack:** NestJS (mount `AuthHttpModule`), `supertest` (the HTTP-boot test), the herdbook `db:setup`/seed harness, Angular (login + interceptor), the published `substrate-runtime@0.26.0`.

**Spec:** ADR-211 (the auth layer) + the umbrella §4 Slice D. Predecessor: the full auth layer published (`0.26.0`).

---

## Part D1 — backend adoption + HTTP-boot integration test (the end-to-end proof)

### Task 1: Bump + mount AuthHttpModule
- [ ] Bump `@de-braighter/substrate-runtime` → `^0.26.0` in `apps/api/package.json` + `libs/herdbook-pack/package.json`; `pnpm install --ignore-scripts`. Verify the version + that `AuthHttpModule` is exported.
- [ ] In `apps/api/src/app/app.module.ts`, add `AuthHttpModule.forRoot({ ... })` to imports (alongside `SubstrateModule.forRoot`). Config: the EdDSA signing key from env (`SUBSTRATE_AUTH_SIGNING_KEY_PRIVATE`/`_KID`; dev-gen for dev), the cookie config, the CSRF allowed-origins (the web origin), the throttle limits. Ensure cookie-parser middleware is applied (the module's `configure` or the app's main.ts). Keep `SUBSTRATE_DEV_HEADER_AUTH` defaulting ON in dev/test (B3) — the existing corpus + live-run keep working.
- [ ] `pnpm run typecheck` + `npx nx build api` green. Commit `feat(api): mount AuthHttpModule (/auth/* + JWKS) on substrate-runtime 0.26.0`.

### Task 2: Seed a demo user + credential + membership + role
- [ ] A seed (`libs/herdbook-pack/prisma/seed/demo-user.ts` or in `db:setup`): create a demo `core.user` (e.g. `registrar@vssz.test`, the dev user id `1111…1111` if it must match, displayName) + a `local` credential (argon2id, a known dev password) + `core.user_tenant` (the herdbook tenant, tenant_role='owner'/'admin') + the registrar role grant in `core.pack_role_assignment` (under the herdbook tpid — already seeded in db:setup; reconcile so the demo user can log in AND has the registrar role). Reuse the substrate `LocalPasswordProvider.setPassword` / `seedPlatformAdmin`-style helpers or raw SQL on the substrate_auth connection. Idempotent. Wire into `db:setup`.
- [ ] Commit `feat(db): seed demo user + local credential + membership + registrar role (login-able)`.

### Task 3: The HTTP-boot integration test (the load-bearing proof)
- [ ] Add `supertest` (devDep) + an e2e/integration spec (`apps/api/src/app/auth-login.e2e.spec.ts` or the herdbook integration-test tier) that BOOTS the real NestJS app (`NestFactory` / `Test.createTestingModule(...).createNestApplication()` with the real `AuthHttpModule` + cookie-parser) and, DB-gated (needs herdbook-postgres + the seeded user):
  - `POST /auth/login {email, password}` → 200, an access token in the body + a refresh cookie (`Set-Cookie` httpOnly). Wrong password → 401.
  - `POST /auth/select-tenant` (cookie) → 200, an access token bound to the herdbook tenant.
  - `GET /animals` with `Authorization: Bearer <access>` (and `SUBSTRATE_DEV_HEADER_AUTH=false` for this test, OR just the bearer) → 200 with the herdbook data (proving the token → TenantPackContext → RLS read works end-to-end on the wire — the B3 guard swap in a real pipeline).
  - `GET /.well-known/jwks.json` → 200 public-only.
  - `POST /auth/refresh` (cookie) → 200 + a rotated cookie.
- [ ] Run it live (herdbook-postgres + db:setup). PASTE the proof (login→token→authenticated /animals). Commit `test(api): HTTP-boot integration — login → token → authenticated /animals (real wire pipeline)`.

### Task 4: D1 gate + PR + merge
- [ ] `pnpm run typecheck` + `nx build` + the existing `test:db` corpus (416/253 STILL green — dev-header default ON) + the new integration test green. Verifier wave (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`). PR (Producer/Effect; "D1 — herdbook adopts the auth layer; the HTTP-boot integration test closes B2c's wire-pipeline gap"). Merge → twin ritual. (No publish — herdbook is an app.)

---

## Part D2 — the Angular login UI + bearer interceptor + tenant context

### Task 5: Login screen + AuthClient + bearer interceptor
- [ ] An Angular login route (`apps/web/src/app/auth/login.component.ts`) — a reactive-forms login form (email + password) → `AuthClient.login()` → on single-tenant, store the access token (in-memory) + navigate; on multi-tenant, show the tenant picker → `selectTenant`. Use the de-braighter design tokens + WCAG 2.2 AA (login is an AAA-critical path — a11y-pro patterns: labels, focus, `3.3.8` accessible-auth, `3.3.7` redundant-entry).
- [ ] An `AuthClient` (Angular service) wrapping `/auth/login,select-tenant,refresh,logout,me` — access token in memory, the refresh cookie handled by the browser (withCredentials), a refresh-on-401 flow.
- [ ] A **bearer interceptor** replacing `dev-auth.interceptor.ts`: adds `Authorization: Bearer <access>` to `/api` calls; on 401, tries `/auth/refresh` → retry, else redirect to login. Remove/disable the dev-header interceptor (or keep it behind a dev flag).
- [ ] Commit per unit.

### Task 6: Tenant context/switcher + org self-admin (Settings → Team)
- [ ] Tenant context from the token (the active tenant); a header tenant switcher for multi-homed users (calls `select-tenant`, re-issues the token, reloads). Org-admin "Settings → Team": a tenant owner/admin invites/disables users + grants/revokes pack roles within their tenant (calls a herdbook endpoint over `core.user_tenant` + `core.pack_role_assignment`; governed by `user_tenant.tenant_role` + a `herdbook.user.manage` perm). (This may need a small herdbook backend endpoint — scope it minimally or defer org-admin to a follow-up if large.)
- [ ] Live-verify in a browser: log in as the registrar → work the registry with a real token (no dev headers). 
- [ ] Commit + a D2 PR + merge + twin ritual.

> **NOTE on D2 scope:** herdbook's login/org-admin UI may await a founder UI prototype (per herdbook CLAUDE.md "incoming UI prototype"). Build a FUNCTIONAL, accessible login + interceptor + tenant context now (the working end-to-end flow); the polished design + the full org-admin surface can graft onto the prototype when it lands. If the prototype is a hard precondition, D2 delivers the functional login + interceptor and defers the polish.

---

## Done = (D)

herdbook has real login: a user logs in (email + password) → gets an EdDSA token → works the registry with verified-token auth (RLS-scoped to their tenant), no dev-header spoofing. The HTTP-boot integration test proves the full auth wire pipeline end-to-end. **The tenant-management arc is complete** — persisted isolated multi-tenancy (A) + real identity/login (B) + platform-admin onboarding (C) + the herdbook-facing login (D). The founder's console + login UI prototypes graft onto the `/platform/*` + `/auth/*` backends.

---

## Self-review (author)

- **Spec coverage:** Slice D adoption → D1 (mount + seed + integration test); the umbrella's "herdbook login + tenant switcher + org self-admin" → D2. The HTTP-boot integration test closes the B2c wire-pipeline gap (the qa-flagged blind spot).
- **Backward-compat:** the dev-header shim stays ON in dev/test (B3 default) so the existing 416/253 corpus + live-run recipe keep working; token login is ADDED. The integration test uses the bearer path (or `SUBSTRATE_DEV_HEADER_AUTH=false`) to prove the token flow.
- **Security:** the seeded demo credential is a dev-only known password (`mustChangeOnFirstLogin` or documented); the web stores the access token in memory (not localStorage); the refresh cookie is httpOnly (browser-handled, withCredentials). Login is WCAG-AAA-critical (a11y-pro).
- **Risk flagged:** the EdDSA signing key in herdbook's dev = dev-gen (the substrate's prod fail-fast applies if NODE_ENV=production without the env key). The org-admin surface (D2 Task 6) may need a herdbook backend endpoint — scope minimally or defer. D2's polish may await the founder's UI prototype — deliver functional now.
