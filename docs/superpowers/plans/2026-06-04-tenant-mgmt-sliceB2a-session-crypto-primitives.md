# Tenant Management — Slice B2a (Session + Crypto Primitives) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Worktree off `layers/substrate` `main`. SECURITY-SENSITIVE — verifier wave includes a dedicated security pass + charter-checker (required reviewer per the ADR-209 standing condition for the new `core.session` auth-scoped table).

**Goal:** The cryptographic + persistence primitives for sessions: `core.session` (the revocable refresh-token store), the EdDSA signing-key service + JWKS, access-JWT issue/verify, and refresh-token generation/hashing. No `AuthService` orchestration (B2b), no HTTP (B2c).

**Architecture:** `core.session` is a fourth *auth-subsystem-only* `core.*` table (substrate_auth role only; charter-condition: enumerated allow-list + negative-grant test). A `SigningKeyService` holds an Ed25519 keypair (env-injected for the prototype per ADR-211 DP-6 `[PROTO-OK]`; generated for dev) and exposes signing + a JWKS public-key view. An `AccessTokenService` (the vetted `jose` lib) issues/verifies EdDSA JWTs with the ADR-211 claims + ~15-min TTL. A `RefreshTokenService` generates 256-bit CSPRNG opaque tokens and hashes them (SHA-256 — high-entropy secret) for storage. A `SessionRepository` (in-memory + Prisma parity) persists the session family. Published as a `substrate-runtime` minor bump only when B2 is consumer-ready (B2c) — B2a merges to main without a publish.

**Tech Stack:** TypeScript ESM, `jose` (EdDSA/Ed25519 JWT), Node `crypto` (Ed25519 keygen, randomBytes, SHA-256), Prisma 6, Vitest, PostgreSQL 16, the `substrate_auth` DB role from B1.

**Spec:** ADR-211 (ratified + amended specs#258) §Decision/3–6 + the concept §5.4–5.8. Predecessor: B1 (`substrate-runtime@0.23.0` — the identity tables + `substrate_auth` role + the `AUTH_SUBSYSTEM_ONLY_TABLES` drift-guard class).

---

## Repos & key facts

- All in `layers/substrate` (worktree off main → `0.23.0`).
- `core.session` is auth-subsystem-only (substrate_auth role only, NO `app`) — same posture as `core.user_credential`. Add it to the drift-guard `AUTH_SUBSYSTEM_ONLY_TABLES` set (the B1 fail-closed gate already forces this) + ship its negative-grant test.
- EdDSA key (prototype): env `SUBSTRATE_AUTH_SIGNING_KEY_PRIVATE` (base64 PKCS8 Ed25519) + `SUBSTRATE_AUTH_SIGNING_KEY_KID`. If unset (dev/test), generate an ephemeral keypair at boot + log a warning (never in prod). Key NEVER in DB/repo (DP-6).
- `jose` supports EdDSA (Ed25519): `SignJWT(...).setProtectedHeader({ alg: 'EdDSA', kid }).sign(privateKey)`; `jwtVerify(token, publicKey, { algorithms:['EdDSA'] })`; `exportJWK(publicKey)` for the JWKS.
- Refresh token: `crypto.randomBytes(32)` → base64url (256-bit). Hash for storage: `crypto.createHash('sha256').update(token).digest('hex')` (fast hash is correct for a HIGH-ENTROPY random secret — argon2 is for low-entropy passwords; per swiss-pro §2).
- No publish in B2a (no external consumer until B2c/B3). Merge to main only.

---

## Task 1: `core.session` table (auth-subsystem-only)

**Agent:** `prisma-pro`/`substrate-coder-pro`. **Files:** `prisma/schema/core.prisma`; `prisma/migrations/<ts>_core_session/migration.sql`; `sql/core-schema.sql`; the drift-guard spec.

- [ ] **Step 1: Prisma model** (after `UserTenant`). Session family for rotation + reuse-detection.
```prisma
/// Auth-scoped + AUTH-SUBSYSTEM-ONLY (substrate_auth role only; no `app`).
/// The revocable refresh-token store. `family_id` groups a rotation chain (RTR):
/// each refresh rotates → a new row (same family), the prior row gets rotated_at.
/// Presenting an ALREADY-rotated token (reuse) → revoke the whole family (theft).
/// `refresh_hash` = SHA-256 of the opaque 256-bit token (never the token itself).
/// PII minimization (ADR-211 DP-7): device/UA optional, collect-when-used.
model Session {
  id             String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId         String    @map("user_id") @db.Uuid
  familyId       String    @map("family_id") @db.Uuid
  refreshHash    String    @unique @map("refresh_hash")
  activeTenantId String?   @map("active_tenant_id") @db.Uuid
  issuedAt       DateTime  @default(now()) @map("issued_at") @db.Timestamptz()
  expiresAt      DateTime  @map("expires_at") @db.Timestamptz()
  lastUsedAt     DateTime? @map("last_used_at") @db.Timestamptz()
  rotatedAt      DateTime? @map("rotated_at") @db.Timestamptz()
  revokedAt      DateTime? @map("revoked_at") @db.Timestamptz()
  @@index([familyId])
  @@index([userId])
  @@map("session")
  @@schema("core")
}
```
- [ ] **Step 2: Migration** `prisma/migrations/<ts greater than 20260604110000>_core_session/migration.sql` — the table, the unique index on `refresh_hash`, the family/user indexes, NO RLS, grants to `substrate_auth` ONLY (S/I/U/D — sessions ARE updated (rotate) + deleted (erasure/prune); NO `app` grant). Mirror the B1 identity-migration grant pattern.
- [ ] **Step 3:** Mirror into `sql/core-schema.sql` (idempotent, after the identity tables, `-- AUTH-SCOPED (substrate_auth-only)`).
- [ ] **Step 4: Drift guard:** add `'session'` to `AUTH_SUBSYSTEM_ONLY_TABLES`. Run → green (the B1 fail-closed gate would otherwise demand an `app` grant). `npx prisma validate` → valid.
- [ ] **Step 5: Commit** `feat(core): core.session table (auth-subsystem-only, RTR family, ADR-211)`.

---

## Task 2: `SessionRepository` (in-memory + Prisma parity)

**Agent:** `substrate-coder-pro`. **Files:** `libs/substrate-runtime/src/auth/session-repository.port.ts` + contract suite + in-memory + Prisma adapters + specs (under `src/auth/`).

- [ ] **Step 1: Port** — global (no tenant arg; runs on substrate_auth). Methods B2a+B2b need: `create(input)`, `findByRefreshHash(hash)`, `markRotated(id, at)`, `revoke(id)`, `revokeFamily(familyId)`, `findActiveByUser(userId)` (for "your sessions"), `deleteForUser(userId)` (DP-4 erasure), `pruneExpired(before)` (retention). Return typed `Result`/plain (match the B1 identity-repo shape exactly).
- [ ] **Step 2: Shared contract suite** `runSessionRepositoryContract` (ADR-202 parity; test-internal, NOT barrel-exported) covering: create+findByRefreshHash round-trip; markRotated then findByRefreshHash shows rotatedAt; revoke/revokeFamily; deleteForUser; pruneExpired; uniqueness of refresh_hash.
- [ ] **Step 3: In-memory adapter** + spec (runs the suite).
- [ ] **Step 4: Prisma adapter** (raw SQL on the substrate_auth client, no GUC — non-RLS) + DB-gated contract spec (`skipIf(!SUBSTRATE_AUTH_DATABASE_URL)`).
- [ ] **Step 5: Commit** `feat(auth): SessionRepository (in-memory + Prisma, RTR-aware, contract parity)`.

---

## Task 3: `SigningKeyService` (EdDSA Ed25519 + JWKS)

**Agent:** `substrate-coder-pro`. **Files:** `libs/substrate-runtime/src/auth/signing-key.service.ts` + spec. Add `jose` dep.

- [ ] **Step 1: Add `jose`** to `libs/substrate-runtime/package.json`; install; verify it imports + does EdDSA on this host (`node -e "import('jose').then(j=>j.generateKeyPair('EdDSA',{crv:'Ed25519'})).then(()=>console.log('ok'))"` — jose is pure JS, no native build).
- [ ] **Step 2: Write the failing test:** `SigningKeyService` loads the keypair from env (`SUBSTRATE_AUTH_SIGNING_KEY_PRIVATE` base64 PKCS8 + `_KID`) OR generates an ephemeral dev keypair when unset (+ a one-time warn); exposes `currentKid`, `signingKey()` (private), and `jwks()` → `{ keys: [{ kty:'OKP', crv:'Ed25519', x, kid, use:'sig', alg:'EdDSA' }] }` (the PUBLIC key only, via `exportJWK`). Assert: jwks() never exposes the private `d`; the kid matches; a token signed with the signing key verifies against the JWKS public key.
- [ ] **Step 3: Implement** with `jose` (`importPKCS8`/`generateKeyPair('EdDSA',{crv:'Ed25519',extractable:true})`, `exportJWK` for the public side; strip any private component for jwks()). Support a SECOND (previous) key for rotation overlap: `jwks()` returns current + optional previous public keys (both kids) so rotation doesn't invalidate live tokens (ADR-211 key-mgmt). The private signing key never leaves the service.
- [ ] **Step 4: Run → green.** Commit `feat(auth): SigningKeyService (EdDSA Ed25519, env-injected + dev-gen, JWKS public-only, rotation overlap)`.

---

## Task 4: `AccessTokenService` (jose EdDSA JWT issue/verify)

**Agent:** `substrate-coder-pro`. **Files:** `libs/substrate-runtime/src/auth/access-token.service.ts` + spec.

- [ ] **Step 1: Write the failing test:** `issue(claims)` → an EdDSA JWT with the ADR-211 claims (`sub`, `tid`, `tpid`, `pack`, `roles`, `sid`, `plat`, `iat`, `exp`, `nbf`) + ~15-min `exp` + the signing `kid` in the header. `verify(token)` → the validated claims (signature via the JWKS public key + `exp`/`nbf` checked, `alg` pinned to `['EdDSA']` — reject `alg:none`/HS). Assert: a tampered token fails; an expired token fails; an `alg:none` token is rejected; the kid resolves the right public key.
- [ ] **Step 2: Implement** with `jose` `SignJWT` (`setProtectedHeader({alg:'EdDSA', kid})`, `setIssuedAt`, `setExpirationTime('15m')`, `setNotBefore('0s')`, `.sign(signingKey)`) + `jwtVerify(token, getKey, { algorithms:['EdDSA'] })` where `getKey` resolves the public key by the token's `kid` from the SigningKeyService JWKS (so rotation overlap works). Configurable TTL (default 15m). NEVER accept a symmetric alg.
- [ ] **Step 3: Run → green.** Commit `feat(auth): AccessTokenService (EdDSA JWT issue/verify, alg-pinned, kid-resolved)`.

---

## Task 5: `RefreshTokenService` (CSPRNG opaque + SHA-256 hash)

**Agent:** `substrate-coder-pro`. **Files:** `libs/substrate-runtime/src/auth/refresh-token.service.ts` + spec.

- [ ] **Step 1: Write the failing test:** `generate()` → `{ token, hash }` where `token` is a 256-bit (32-byte) base64url CSPRNG string and `hash = sha256(token)` (hex). `hashOf(token)` → the same hash (for lookup on refresh). Assert: tokens are unique across many calls; `hashOf(token) === generate().hash` for the same token; the token has ≥43 base64url chars (256-bit); the raw token is NEVER stored/returned by `hashOf`.
- [ ] **Step 2: Implement** with Node `crypto.randomBytes(32)` → `.toString('base64url')`; `createHash('sha256').update(token).digest('hex')`. (Fast hash is correct for a high-entropy random secret — NOT argon2.) No secret logging.
- [ ] **Step 3: Run → green.** Commit `feat(auth): RefreshTokenService (256-bit CSPRNG opaque token + SHA-256 hash)`.

---

## Task 6: DP-3 negative-grant for core.session + forRoot wiring + gate

**Agent:** `substrate-coder-pro` + verifier wave. **Files:** `src/auth/core-session-grants.contract.spec.ts` (DB-gated); `composition-root/substrate.module.ts`; the barrel.

- [ ] **Step 1: DP-3 negative-grant DB test** for `core.session` (mirror the B1 `core-identity-grants` test): as `app` → SELECT/INSERT on `core.session` REJECTED (42501); as `substrate_auth` → SUCCEEDS. Run green (substrate_auth DB role + the migration applied).
- [ ] **Step 2: forRoot wiring** — bind `SESSION_REPOSITORY` (constructed instance), `SigningKeyService`, `AccessTokenService`, `RefreshTokenService` (singletons; the key service reads env). Export the services + the session-repo port from the runtime barrel (contract suites stay test-internal).
- [ ] **Step 3: Full gate:** `npx nx test substrate-runtime` green (DB-gated skip without env); DB-gated green with the 3 env URLs + substrate_auth; `npx tsc -b libs/substrate-runtime` clean.
- [ ] **Step 4: Verifier wave** — `local-ci` + `reviewer` (SECURITY focus: EdDSA correctness, alg-pinning, no symmetric-alg accept, key never exposed in JWKS, CSPRNG for refresh, SHA-256-not-argon2 for the high-entropy token, no secret logging, the kid-rotation) + `charter-checker` (REQUIRED — confirms `core.session` admitted to the allow-list + negative-grant) + `qa-engineer`. Address blocking findings.
- [ ] **Step 5:** NO version bump, NO publish (B2a merges to main; publish lands with B2c when the auth layer is consumer-ready). Open the PR (body: Producer/Effect; Tech design ADR-211; "Out of scope: AuthService orchestration = B2b, HTTP = B2c, publish deferred to B2c"). Verifier wave → merge → twin ritual.

---

## Done = (B2a)

`core.session` (auth-subsystem-only, RTR family, drift-guard + negative-grant) + `SessionRepository` (parity) + `SigningKeyService` (EdDSA + JWKS, key never exposed) + `AccessTokenService` (EdDSA JWT, alg-pinned) + `RefreshTokenService` (CSPRNG + SHA-256) — all on substrate `main`, security-audited, NOT yet published. **Next: B2b (`AuthService`: login/select-tenant/refresh with rotation + reuse-detection + DP-2 audit + DP-4 erasure).**

---

## Self-review (author)

- **Spec coverage:** ADR-211 §Decision/3 (EdDSA access JWT) → Tasks 3+4; §Decision/4 (opaque refresh + rotation store) → Tasks 1+2+5 (rotation *orchestration* is B2b; B2a builds the family-aware store + the token primitives); §Decision/5 (`core.session`) → Task 1; DP-3 (the new auth table) → Task 6.1 + the charter condition (drift-guard allow-list) → Task 1.4. DP-2 audit + DP-4 erasure-orchestration + the `/auth/*` + throttling are B2b/B2c — correctly out of B2a.
- **Security emphases:** `jose` + Node `crypto` (no hand-rolled crypto); alg pinned to EdDSA (reject symmetric/none); private key never in JWKS/DB/repo (env-injected, DP-6); CSPRNG 256-bit refresh + SHA-256 (high-entropy → fast hash correct, NOT argon2); the substrate_auth-only grant + the negative-grant test; no secret logging; dedicated security pass in the wave.
- **Type consistency:** the session-repo methods (`findByRefreshHash`, `markRotated`, `revokeFamily`, `deleteForUser`, `pruneExpired`) named identically across the port (Task 2.1) + the contract suite (2.2) + the adapters; `RefreshTokenService.{generate,hashOf}` + `{token,hash}` shape consistent (Task 5); `AccessTokenService.{issue,verify}` (Task 4). Match the B1 identity-repo `Result` shape.
- **Risk flagged:** the EdDSA key lifecycle (env vs dev-gen) is the new infra surface — the dev-gen path must warn loudly + never run in prod; the JWKS must be public-only (a test asserts no `d`). `core.session` is the 4th auth-subsystem-only table — the fail-closed drift guard already forces its enumeration.
