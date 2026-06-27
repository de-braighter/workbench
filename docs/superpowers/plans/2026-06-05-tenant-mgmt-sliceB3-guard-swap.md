# Tenant Management — Slice B3 (Guard Swap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Worktree off `layers/substrate` `main`. SECURITY-SENSITIVE — the request-auth path. Publishes `0.25.0`.

**Goal:** Replace the trusted-header request auth with **verified bearer-token auth**: a new `AuthContextGuard` verifies the access JWT (alg-pinned EdDSA) and builds the SAME `TenantPackContext` everything downstream already consumes — so `ScopedPrismaService`, `PolicyEngine`, and all pack controllers are UNCHANGED. The legacy header shim survives behind `SUBSTRATE_DEV_HEADER_AUTH` (default OFF in prod, ON in dev/tests so the existing corpus keeps passing).

**Architecture:** The token carries everything the context needs (`sub`=userId, `tid`=tenantId, `pack`, `tpid`=tenantPackId, `roles`, `sid`, `plat`). `AuthContextGuard.canActivate` reads `Authorization: Bearer <jwt>`, `AccessTokenService.verify` (alg-pinned, requiredClaims), maps claims → `TenantPackContext` ({tenantId, packId, userId, requestId, tenantPackId}), attaches `request.tenantPackContext`. Token verification is a **local signature check** (no DB hit — ε-budget). The legacy `TenantPackContextGuard` (header → registry → context) is retained; `forRoot` selects which guard is the `APP_GUARD` based on `SUBSTRATE_DEV_HEADER_AUTH` (or a single guard that prefers the token and falls back to headers only when the dev flag is on). Published `0.24.0`→`0.25.0` (additive — the default stays dev-header-on so no consumer breaks until they opt into tokens).

**Tech Stack:** NestJS guards (`APP_GUARD`), the B2a `AccessTokenService`, the existing `TenantPackContextGuard` + `TenantRegistry`, Vitest.

**Spec:** ADR-211 §Decision/3 (the guard swap) + §6.4 backward-compat. Predecessor: B2c (`0.24.0` published — `AccessTokenService` + the full auth layer).

---

## Repos & key facts

- All in `layers/substrate` (worktree off main → `0.24.0`).
- The existing `TenantPackContextGuard` (`src/context-guards/tenant-pack-context.guard.ts`) reads `x-tenant-id`/`x-pack-id`/`x-user-id` → `TenantRegistry` → builds `TenantPackContext` → attaches `request.tenantPackContext`. It's registered as `APP_GUARD` in `forRoot`. Reuse its `TenantPackContext` shape + the `tenantPackContextProvider`.
- **Backward-compat is load-bearing:** the entire existing test corpus + the documented live-run recipes use the header shim. So `SUBSTRATE_DEV_HEADER_AUTH` defaults to allowing headers (ON) UNLESS explicitly disabled — flipping to token-only is opt-in. A consumer (herdbook D) sets `SUBSTRATE_DEV_HEADER_AUTH=false` to go token-only.
- The token's `tpid` claim IS the `tenant_pack_id` — so `AuthContextGuard` does NOT need to call `TenantRegistry.resolveTenantPackId` (it's in the token). It MAY re-validate the tenant is registered (cheap) but the token is the authority.
- Token verify needs the `SigningKeyService` (public key) — already in `forRoot` from B2a.
- Publish `0.25.0`.

---

## Task 1: `AuthContextGuard`

**Files:** create `libs/substrate-runtime/src/context-guards/auth-context.guard.ts` + spec.

- [ ] **Step 1: Write the failing test.** `AuthContextGuard.canActivate`:
  - valid `Authorization: Bearer <jwt>` (a token issued by `AccessTokenService`) → builds `request.tenantPackContext = { tenantId: claims.tid, packId: claims.pack, userId: claims.sub, requestId: <new uuid>, tenantPackId: claims.tpid }` and returns true. (Also expose `roles`/`sid`/`plat` for downstream — attach to the request or a parallel `request.authClaims` if the `TenantPackContext` shape can't hold them; KEEP `TenantPackContext` shape unchanged so downstream is untouched — put roles/plat on a sibling `request.authClaims`.)
  - missing/malformed Authorization header → return false (401/403). Expired/tampered/alg-confusion token → false (delegated to `AccessTokenService.verify` which already rejects these — assert the guard returns false, not throws).
  - a token whose `tid` is for a tenant the registry doesn't know → false (optional re-validation — if you add it; otherwise the token is trusted).
- [ ] **Step 2: fail → 3: implement** (inject `AccessTokenService`; parse the bearer header; verify; map claims → context; `randomUUID` for requestId; attach context + sibling claims; no throws — return false on any failure). **4: green.**
- [ ] **Step 5: Commit** `feat(context-guards): AuthContextGuard (verify bearer JWT → TenantPackContext)`.

---

## Task 2: forRoot guard selection + the dev-header flag

**Files:** `composition-root/substrate.module.ts` + spec.

- [ ] **Step 1: Write the failing test.** With `SUBSTRATE_DEV_HEADER_AUTH` unset/`true` (default), the `APP_GUARD` accepts the `x-tenant-id`/etc. header path (the existing corpus). With `SUBSTRATE_DEV_HEADER_AUTH=false`, a header-only request (no bearer token) is REJECTED, and a valid bearer token is accepted. (A `forRoot` option `devHeaderAuth?: boolean` may override the env, default = `process.env.SUBSTRATE_DEV_HEADER_AUTH !== 'false'`.)
- [ ] **Step 2: fail → 3: implement.** Choose the cleanest mechanism:
  - **Option A (recommended): one composite guard** — `AuthContextGuard` runs first; if no bearer token AND `devHeaderAuth` is on, fall back to the header path (delegate to the existing `TenantPackContextGuard` logic). If `devHeaderAuth` is off and no valid token → reject. This keeps a single `APP_GUARD` + a clear precedence (token > header-if-dev).
  - OR Option B: `forRoot` binds EITHER `AuthContextGuard` OR `TenantPackContextGuard` as the `APP_GUARD` based on the flag (simpler but no token-in-dev). Option A is better (token works even in dev). Pick + document.
  - Default `devHeaderAuth = true` so existing consumers/tests are unaffected. **4: green** (the existing guard tests + the new token tests both pass).
- [ ] **Step 5: Commit** `feat(composition-root): forRoot binds token-or-header auth via SUBSTRATE_DEV_HEADER_AUTH`.

---

## Task 3: Backward-compat sweep + gate + publish

**Files:** the barrel; `package.json`.

- [ ] **Step 1:** Export `AuthContextGuard` (+ any new option type) from the barrel. Confirm `TenantPackContext` shape + `tenantPackContextProvider` are UNCHANGED (downstream untouched).
- [ ] **Step 2: Backward-compat sweep:** `npx nx test substrate-runtime` → the ENTIRE existing corpus green (the header guard still works by default; the new guard tests pass). `npx tsc -b libs/substrate-runtime` clean. If any existing test breaks because the default changed, the default is wrong — fix to keep `devHeaderAuth` defaulting ON.
- [ ] **Step 3: Verifier wave** — `local-ci` + `reviewer` (SECURITY: alg-pinned verify, no-throw, the token claims → context mapping is correct + can't be spoofed, the dev-header default doesn't accidentally allow header-spoofing in prod, roles/plat on a sibling not leaking into TenantPackContext incorrectly) + `charter-checker` (no new table; the guard stays governance-ring; the context shape unchanged) + `qa-engineer`. Address blocking findings.
- [ ] **Step 4: Bump + publish.** `npm view … version` (exact) → `0.24.0`; set `0.25.0`. Commit. PR (Producer/Effect; "publishes 0.25.0; the dev-header shim defaults ON for backward-compat; consumers set SUBSTRATE_DEV_HEADER_AUTH=false for token-only"). Verifier wave → merge → `npm publish` → twin ritual. **Remember the worktree `npm install` before push (the nx-lint pre-push gate needs a complete graph).**

---

## Done = (B3)

`@de-braighter/substrate-runtime@0.25.0` — `AuthContextGuard` verifies bearer tokens → the same `TenantPackContext`; the header shim is behind `SUBSTRATE_DEV_HEADER_AUTH` (default ON). The substrate can now authenticate requests by verified token. Existing consumers unaffected (header default). **Next: C (platform-admin backend), then D (herdbook adopts token auth + the login UI).**

---

## Self-review (author)

- **Spec coverage:** §Decision/3 guard swap → Tasks 1+2; §6.4 backward-compat (header shim behind the flag, default ON) → Task 2 + the Task 3 sweep. The token carries `tpid` so no per-request `resolveTenantPackId` DB hit (ε-budget).
- **Security:** alg-pinned verify (delegated to `AccessTokenService`); no-throw guard (return false → 403); the `TenantPackContext` shape is UNCHANGED so downstream RLS/policy are untouched; the dev-header default must NOT enable header-spoofing in prod (a consumer in prod sets `SUBSTRATE_DEV_HEADER_AUTH=false`) — document loudly.
- **Type consistency:** `TenantPackContext` ({tenantId, packId, userId, requestId, tenantPackId}) reused verbatim; the claims (`tid`/`pack`/`sub`/`tpid` from B2b's `issueAccessFor`) map 1:1; `AccessTokenService.verify` (B2a) consumed.
- **Risk flagged:** the default-ON dev-header flag is the backward-compat hinge — if it defaulted OFF, the entire existing corpus + herdbook would break until D. Keep it ON; token-only is opt-in. The guard composition (token-then-header-fallback) must not let a header bypass a present-but-invalid token.
