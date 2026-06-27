# Tenant Management — Slice B2c (Auth HTTP + Publish) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Worktree off `layers/substrate` `main`. SECURITY-SENSITIVE — verifier wave includes a security pass. **This slice publishes `@de-braighter/substrate-runtime@0.24.0`.**

**Goal:** The HTTP front door for auth: `/auth/login,select-tenant,refresh,logout,me` + `/.well-known/jwks.json`, the httpOnly refresh cookie, throttling (before argon2), CSRF defense on the cookie path, and the `provider-error`→503 mapping. Then publish — the first consumable auth release.

**Architecture:** An `AuthController` (+ a `JwksController`) mounted by `SubstrateModule.forRoot` (the way the existing controllers are), delegating to the B2b `AuthService`. The **refresh token lives in an httpOnly·Secure·SameSite=Strict cookie scoped to `/auth`** (JS-unreadable); the **access token returns in the JSON body** (SPA holds it in memory). Login throttled per-IP (`@nestjs/throttler`) + per-account (a small in-memory limiter, prototype) — gating *before* the argon2 hash. CSRF on the cookie-bearing endpoints via SameSite=Strict + an Origin/Referer check (bearer-header calls are CSRF-immune). Errors map: `invalid-credentials`→401 (generic), `provider-error`/infra→503, validation→400, `token-reuse-detected`→401 + clear cookie. Published as `0.24.0` (0.23.0 is immutable/published with B1; main carries B1+B2a+B2b unpublished).

**Tech Stack:** NestJS controllers + `@nestjs/throttler` + `cookie-parser` (reconcile against what's already in the substrate), zod request validation (the substrate's validation convention), supertest/Nest `TestingModule` for HTTP tests, the B2b `AuthService`.

**Spec:** ADR-211 (ratified+amended) §Decision/3–6 + DP-6/DP-7. Predecessor: B2b (`AuthService` on main, `1c68345`).

---

## Repos & key facts

- All in `layers/substrate` (worktree off main → B1+B2a+B2b; package.json says 0.23.0 unpublished-ahead).
- **Reconcile against the real substrate:** how controllers are mounted (the FHIR/AuditEvent controllers — `forRoot` `controllers:[]`?), whether `@nestjs/throttler` + `cookie-parser` are already deps (add if not), the request-validation convention (zod pipe?), and the HTTP test pattern (TestingModule + supertest?). Mirror the existing controllers.
- **Publish:** `npm view @de-braighter/substrate-runtime version` (exact) → expect `0.23.0`; bump `0.24.0`; publish from `libs/substrate-runtime` after merge.
- The auth controllers should be mountable but **gateable** — a consumer that doesn't want HTTP auth (a pure-library use) shouldn't be forced to expose `/auth/*`. Provide a `forRoot` flag (e.g. `mountAuthHttp?: boolean`, default sensible) OR a separate importable `AuthHttpModule`. Decide + document.

---

## Task 1: `AuthController` — login + select-tenant

**Files:** `libs/substrate-runtime/src/auth/http/auth.controller.ts` + dto + spec.

- [ ] **Step 1: Write the failing HTTP test** (Nest `TestingModule` + supertest, mirror the existing controller-test pattern):
  - `POST /auth/login {email,password}` valid single-tenant → 200, body `{ accessToken, user:{id,displayName}, tenants:[...] }`, `Set-Cookie` with the refresh token (httpOnly; Secure in prod; SameSite=Strict; Path=/auth; Max-Age=refresh-TTL). The raw refresh token is NOT in the JSON body.
  - multi-tenant → 200, body `{ user, tenants }` (NO accessToken), cookie set.
  - wrong password / unknown email → 401 `{ error:'invalid_credentials' }` (generic, identical). Validation failure (missing/blank email) → 400.
  - `POST /auth/select-tenant {tenantId,packId?}` with the refresh cookie → 200 `{ accessToken }`. Not-a-member → 403. No cookie → 401.
- [ ] **Step 2: fail → 3: implement** the controller (inject `AuthService`; read/write the cookie; validate the DTO via the substrate's zod/validation convention; the error-map). **4: green.**
- [ ] **Step 5: Commit** `feat(auth-http): /auth/login + /auth/select-tenant (httpOnly refresh cookie, generic 401, error-map)`.

---

## Task 2: `AuthController` — refresh + logout + me

**Files:** `auth.controller.ts` + spec.

- [ ] **Step 1: Write the failing tests:**
  - `POST /auth/refresh` (refresh cookie) → 200 `{ accessToken }` + a NEW `Set-Cookie` (rotation). The old cookie value no longer works (a 2nd refresh with the OLD cookie → 401 + cleared cookie, reuse-detected). No cookie → 401.
  - `POST /auth/logout` (refresh cookie) → 204 + `Set-Cookie` clearing the refresh cookie (Max-Age=0). Idempotent (logout twice → 204).
  - `GET /auth/me` (`Authorization: Bearer <access>`) → 200 `{ user, activeTenant, tenants }` (verify via `AccessTokenService`; NO DB-heavy work — a token verify + a light lookup). Invalid/expired/missing token → 401.
- [ ] **Step 2: fail → 3: implement** (refresh reads the cookie, calls `AuthService.refresh`, sets the rotated cookie; reuse-detected → 401 + clear cookie; logout clears; me verifies the bearer token). **4: green.**
- [ ] **Step 5: Commit** `feat(auth-http): /auth/refresh (rotate cookie) + /auth/logout (clear) + /auth/me`.

---

## Task 3: JWKS endpoint

**Files:** `libs/substrate-runtime/src/auth/http/jwks.controller.ts` + spec.

- [ ] **Step 1: Failing test:** `GET /.well-known/jwks.json` → 200 `{ keys: [{ kty:'OKP', crv:'Ed25519', x, kid, use:'sig', alg:'EdDSA' }, ...] }` (current + previous public keys; NO private `d`; public, no auth required; cacheable Cache-Control header).
- [ ] **Step 2: fail → 3: implement** (inject `SigningKeyService.jwks()`; a public GET, no guard). **4: green.**
- [ ] **Step 5: Commit** `feat(auth-http): /.well-known/jwks.json (public-only EdDSA keys, cacheable)`.

---

## Task 4: Throttling (before argon2) + per-account limiter

**Files:** the controller + a throttle guard config.

- [ ] **Step 1: Failing test:** N+1 rapid `POST /auth/login` from the same IP → the (N+1)th is **429** (per-IP throttle), and the throttle gates BEFORE the handler (so argon2 doesn't run on throttled requests). A per-account limiter: M+1 failed logins for the same email → 429 (or a lockout-with-backoff) even from different IPs. (Per-account state is in-memory for the prototype — note it resets on restart; prod uses a store.)
- [ ] **Step 2: fail → 3: implement** with `@nestjs/throttler` (per-IP `@Throttle` on `/auth/login`; add the module if absent) + a small per-account in-memory limiter (a `Map<emailHash, {count, windowStart}>`; key on a hash of the email, NOT the raw email, to avoid a PII map; reset on success). Throttle runs as a guard (before the handler → before argon2). **4: green.**
- [ ] **Step 5: Commit** `feat(auth-http): per-IP + per-account login throttling (gates before argon2)`.

---

## Task 5: CSRF + cookie hardening + the error-map polish

**Files:** the controller / a small CSRF check.

- [ ] **Step 1: Failing test:** a `POST /auth/refresh` (or logout) with a cross-origin `Origin` header (not in the allow-list) → 403 (CSRF defense); same-origin → ok. The refresh cookie is SameSite=Strict + httpOnly + (prod) Secure + Path=/auth. Confirm the `provider-error`/infra path → 503 (not 401), and `token-reuse-detected` → 401 + cleared cookie.
- [ ] **Step 2: fail → 3: implement** an Origin/Referer allow-list check on the cookie-bearing endpoints (refresh, logout, select-tenant) — config the allowed origins via a `forRoot` option/env. (Bearer-header endpoints `me` are CSRF-immune — no check.) Finalize the error-map. **4: green.**
- [ ] **Step 5: Commit** `feat(auth-http): CSRF origin-check on cookie endpoints + cookie hardening + error-map`.

---

## Task 6: Module wiring + full gate

**Files:** `composition-root/substrate.module.ts` (controllers + cookie-parser middleware + the auth-http options), the barrel.

- [ ] **Step 1:** Mount `AuthController` + `JwksController` via `forRoot` (controllers + the throttler module + cookie-parser; gated by `mountAuthHttp` or a separate `AuthHttpModule` — your call, documented). Wire the cookie config + the CSRF allowed-origins + the throttle limits as `forRoot` options (with sensible defaults). Export what consumers need.
- [ ] **Step 2: Full gate:** `npx nx test substrate-runtime` green (the HTTP tests use TestingModule; DB-gated skip without env); `npx tsc -b libs/substrate-runtime` clean; a boot-smoke test that the auth controllers resolve in the DI graph.
- [ ] **Step 3: Verifier wave** — `local-ci` + `reviewer` (SECURITY: the cookie flags httpOnly/Secure/SameSite=Strict/Path; the access token NOT in a cookie; throttle-before-argon2; the CSRF origin-check; generic 401 / 503 distinction; reuse-detected clears the cookie; no secret logging; the JWKS is public-only) + `charter-checker` (no new table; confirms auth-http stays governance-ring + consent-separated; the controllers in substrate-runtime are coherent given ADR-204's FHIR-controller demotion direction — confirm auth-http belongs in the kernel runtime) + `qa-engineer`. Address blocking findings.

---

## Task 7: Bump + publish 0.24.0

- [ ] **Step 1:** `npm view @de-braighter/substrate-runtime version` (exact) → expect `0.23.0`. Set `libs/substrate-runtime/package.json` → `0.24.0`. Update the CHANGELOG (0.24.0 = B2a + B2b + B2c auth additions). If `0.24.0` is taken (parallel session), next free by exact equality.
- [ ] **Step 2:** Commit the bump. PR (Producer/Effect; Tech design ADR-211; "publishes 0.24.0 — the first consumable auth release; B3 = the guard swap"). Verifier wave → merge.
- [ ] **Step 3: After merge — publish + twin ritual.** `cd libs/substrate-runtime && npm publish`; verify `npm view … version` == `0.24.0`. Twin ritual.

---

## Done = (B2c)

`@de-braighter/substrate-runtime@0.24.0` published — the full auth layer is consumable: `/auth/login,select-tenant,refresh,logout,me` + `/.well-known/jwks.json`, httpOnly refresh cookie, throttling-before-argon2, CSRF defense, the error-map. **Next: B3 (the guard swap — `AuthContextGuard` verifies the bearer token → `TenantPackContext`; header shim behind `SUBSTRATE_DEV_HEADER_AUTH`), then the herdbook login UI (D).**

---

## Self-review (author)

- **Spec coverage:** §Decision/3 (access token in body) + §Decision/4 (refresh cookie + rotation) → Tasks 1+2; JWKS → Task 3; throttling-before-argon2 (§Decision/6) → Task 4; CSRF split (DP/§Decision/6) → Task 5; the error-map (provider-error→503) → Tasks 1/5; the publish → Task 7.
- **Security emphases:** httpOnly·Secure·SameSite=Strict·Path=/auth refresh cookie (access token NEVER in a cookie — in the body, SPA memory); throttle-before-argon2 (memory-DoS); CSRF origin-check on cookie endpoints (bearer = immune); generic 401 (no oracle); 503 for infra (not 401); reuse-detected → 401 + clear cookie; JWKS public-only; no secret logging; per-account limiter keys on a HASH of the email (no PII map).
- **Type consistency:** `AuthService.{login,selectTenant,refresh,logout}` (B2b) consumed verbatim; `SigningKeyService.jwks()` (B2a) → the JWKS controller; `AccessTokenService.verify` (B2a) → `/auth/me`. The cookie name + flags consistent across set (login/select/refresh) + clear (logout/reuse).
- **Risk flagged:** the controller-mount pattern + `@nestjs/throttler`/`cookie-parser` availability are the integration unknowns — reconcile against the real substrate (the existing controllers). Per-account throttling is in-memory (prototype; prod needs a store — note it). The `mountAuthHttp` gating decision must not break existing consumers that import SubstrateModule without wanting `/auth/*`.
