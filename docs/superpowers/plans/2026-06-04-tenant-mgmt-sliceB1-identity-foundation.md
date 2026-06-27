# Tenant Management — Slice B1 (Identity Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). Work in a git worktree off `layers/substrate` `main`. SECURITY-SENSITIVE — the verifier wave includes a dedicated security pass + charter-checker (required reviewer per the ADR-209 standing condition).

**Goal:** Persist real users + credentials + tenant memberships in the substrate, and add the `IdentityProvider` port with a `LocalPasswordProvider` (argon2id) — the identity foundation for login. No HTTP, no sessions, no JWT (those are B2).

**Architecture:** Three new *auth-scoped* (global, non-RLS) `core.*` tables — `core.user`, `core.user_credential`, `core.user_tenant` — guarded by a NEW dedicated `substrate_auth` DB role (the pack `app` role gets **no** access; a negative-grant test proves it cannot read `core.user_credential`). An `IdentityProvider` port (`verify → Promise<Result<{userId}, AuthError>>`) with a `LocalPasswordProvider` adapter using **argon2id** (`@node-rs/argon2`, prebuilt — no native build) with uniform-timing dummy-verify to kill the account-existence oracle. Repos (User / UserCredential / UserTenant) follow the ADR-202 in-memory+Prisma parity pattern. Published as a `substrate-runtime` minor bump.

**Tech Stack:** TypeScript ESM, NestJS DI, Prisma 6 multiSchema (hand-written SQL migrations), `@node-rs/argon2`, Vitest (`describe.skipIf` DB-gated), PostgreSQL 16. The substrate test DB is on :5544.

**Spec:** ADR-211 (ratified, specs#257) + concept `concepts/substrate/identity-sessions-login.md`. Honors the ADR-209 charter condition (auth-scoped allow-list + negative-grant + charter-checker review) and swiss-pro DP-3 (the dedicated auth role) + DP-7 (data minimization — no fingerprinting; device/UA deferred to B2's `core.session`).

**Scope note:** `core.session` is **B2** (create-when-consumed — it's used by the session/token layer). B1 is identity only. DP-2 (no-PII-in-audit) is **B2** (no audit events are emitted in B1). B1 owns **DP-3** (credential isolation).

---

## Repos & key facts

- All code in `layers/substrate` (worktree off main, which has A1/A3a/A3a-v2 → `substrate-runtime@0.22.0`).
- Auth-scoped tables = the ADR-209 category: global, NO `tenant_pack_isolation` RLS, mirrored into `sql/core-schema.sql`, enumerated in the drift-guard `AUTH_SCOPED_TABLES`. **Difference from `core.tenant`:** these get NO `app`-role grant at all — only the new `substrate_auth` role. The drift-guard must accept "auth-scoped table with NO app grant" for the credential/session-family tables.
- New DB role `substrate_auth` ships in `sql/app-roles.sql` (the substrate artifact packs apply). Test DB needs it too (env `SUBSTRATE_AUTH_DATABASE_URL`).
- `IdentityProvider` port placement: follow the `TenantRegistry` precedent — in **substrate-runtime** (`src/identity/`), NOT contracts (no contracts bump). If the executor finds the cluster convention is contracts, flag it.
- argon2: **`@node-rs/argon2`** (prebuilt, no node-gyp). OWASP argon2id params (memoryCost ≥ 19456 KiB, timeCost ≥ 2, parallelism 1) — store the full encoded hash string (params travel with it for upgradeability).
- Publish: `substrate-runtime` `0.22.0` → `0.23.0` (additive minor). Check `npm view … version` EXACT before bump.

---

## Task 1: Prisma models + migration — core.user / user_credential / user_tenant (auth-scoped)

**Agent:** `prisma-pro` / `substrate-coder-pro`. **Files:** modify `prisma/schema/core.prisma`; create `prisma/migrations/<ts>_core_identity/migration.sql`.

- [ ] **Step 1: Add the Prisma models** to `core.prisma` (after `TenantPack`). Auth-scoped (no RLS); follow the `Tenant`/`TenantPack` `@map`/`@db` conventions.

```prisma
/// Auth-scoped (GLOBAL, NOT per-tenant RLS). The global identity principal.
/// Read by the auth subsystem BEFORE any tenant context (login by email), so
/// it cannot be RLS-scoped. Reachable ONLY via the substrate auth services on
/// the dedicated `substrate_auth` DB role; the pack `app` role gets NO access.
/// PII (revFADP) — audit actors reference `id` (opaque uuid), never email
/// (ADR-211 DP-2); erasure severs the email↔id mapping. See ADR-211 + ADR-209.
model User {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email        String    @unique
  displayName  String    @map("display_name")
  status       String    @default("active") // active | disabled
  platformRole String?   @map("platform_role") // null | "operator" (slice C)
  createdAt    DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  disabledAt   DateTime? @map("disabled_at") @db.Timestamptz()
  @@map("user")
  @@schema("core")
}

/// Auth-scoped. Per-(user, provider) credential. provider 'local' → argon2id
/// hash in secret_hash. The HIGHEST-VALUE secret store — NEVER readable by the
/// pack `app` role (ADR-211 DP-3, tested). `metadata` JSONB for future
/// provider linkage (agov/swissid subject id).
model UserCredential {
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  provider   String   // "local" | future: "agov","swissid"
  secretHash String?  @map("secret_hash") // argon2id encoded string; null for federated
  metadata   Json     @default("{}") @db.JsonB
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt  DateTime @default(now()) @updatedAt @map("updated_at") @db.Timestamptz()
  @@unique([userId, provider])
  @@map("user_credential")
  @@schema("core")
}

/// Auth-scoped. Membership: which tenants a user belongs to (multi-homed).
/// tenant_role governs org self-administration (slice D). NOT per-tenant RLS —
/// the switcher needs "all my tenants" across tenant scopes.
model UserTenant {
  id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId     String    @map("user_id") @db.Uuid
  tenantId   String    @map("tenant_id") @db.Uuid
  tenantRole String    @default("member") @map("tenant_role") // owner | admin | member
  status     String    @default("active")
  joinedAt   DateTime  @default(now()) @map("joined_at") @db.Timestamptz()
  leftAt     DateTime? @map("left_at") @db.Timestamptz()
  @@unique([userId, tenantId])
  @@map("user_tenant")
  @@schema("core")
}
```

- [ ] **Step 2: Migration SQL** `prisma/migrations/<ts>_core_identity/migration.sql` (timestamp > the latest existing). Auth-scoped: NO RLS. **Grants go to `substrate_auth` ONLY** (NOT `app`). `core.user`/`core.user_tenant` may also grant the `substrate_auth` role; `core.user_credential` is `substrate_auth`-only (never `app`).

```sql
-- Identity foundation (tenant-management slice B1, ADR-211).
-- AUTH-SCOPED + AUTH-SUBSYSTEM-ONLY: global identity tables read pre-tenant-context.
-- NO RLS. Grants to the dedicated `substrate_auth` role ONLY — the pack `app`
-- role gets NOTHING here (ADR-211 DP-3). app-roles.sql creates `substrate_auth`.

CREATE TABLE "core"."user" (
    "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "email"         TEXT NOT NULL,
    "display_name"  TEXT NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'active',
    "platform_role" TEXT NULL,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "disabled_at"   TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX "uq_user_email" ON "core"."user" ("email");

CREATE TABLE "core"."user_credential" (
    "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"     UUID NOT NULL,
    "provider"    TEXT NOT NULL,
    "secret_hash" TEXT NULL,
    "metadata"    JSONB NOT NULL DEFAULT '{}'::jsonb,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "uq_user_credential_user_provider" ON "core"."user_credential" ("user_id", "provider");

CREATE TABLE "core"."user_tenant" (
    "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id"     UUID NOT NULL,
    "tenant_id"   UUID NOT NULL,
    "tenant_role" TEXT NOT NULL DEFAULT 'member',
    "status"      TEXT NOT NULL DEFAULT 'active',
    "joined_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "left_at"     TIMESTAMPTZ NULL
);
CREATE UNIQUE INDEX "uq_user_tenant_user_tenant" ON "core"."user_tenant" ("user_id", "tenant_id");

-- Grants: substrate_auth ONLY. NO grant to `app` (DP-3: app cannot touch identity/secrets).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'substrate_auth') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "core"."user"            TO substrate_auth;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "core"."user_credential" TO substrate_auth;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "core"."user_tenant"     TO substrate_auth;
    GRANT USAGE ON SCHEMA "core" TO substrate_auth;
  END IF;
END$$;
```

- [ ] **Step 3:** `npx prisma validate --schema prisma/schema` → valid. Apply to the test DB (`prisma migrate deploy` owner URL) if running.
- [ ] **Step 4: Commit** `feat(core): identity tables — user/user_credential/user_tenant (auth-scoped, substrate_auth-only, ADR-211)`.

---

## Task 2: The `substrate_auth` DB role + the published artifacts

**Agent:** `substrate-coder-pro`. **Files:** `libs/substrate-runtime/sql/app-roles.sql`, `libs/substrate-runtime/sql/core-schema.sql`, the drift-guard spec, the test-DB role setup.

- [ ] **Step 1:** In `sql/app-roles.sql`, add the `substrate_auth` login role idempotently (mirror how `app` is created — NOBYPASSRLS; a login role with a password the auth subsystem connects as). Document: this role is the ONLY one granted on the identity/credential tables.
- [ ] **Step 2:** Mirror the three tables into `sql/core-schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS` + the `substrate_auth`-only grants), after the `core.tenant_pack` block. Mark them `-- AUTH-SCOPED (substrate_auth-only)`.
- [ ] **Step 3: Extend the drift guard** (`src/published-sql/core-schema-drift.spec.ts`): add `'user','user_credential','user_tenant'` to the `AUTH_SCOPED_TABLES` enumerated set. These tables grant to `substrate_auth`, NOT `app` — so the per-table grant assertion must NOT require an `app` grant for them. Add a sub-class (e.g. `AUTH_SUBSYSTEM_ONLY_TABLES`) OR branch: for these tables, assert the artifact contains `GRANT SELECT, INSERT, UPDATE, DELETE ON "core"."<t>" TO substrate_auth` and assert NO `… TO app` grant on `core.user_credential`. Keep the existing `core.tenant`/`tenant_pack` (SELECT-to-app) + tenant-scoped (S/I/U-to-app) rules intact. Run → green.
- [ ] **Step 4: Test-DB provisioning:** ensure the substrate test harness creates the `substrate_auth` role (so the DB-gated specs can connect as it). Add a `SUBSTRATE_AUTH_DATABASE_URL` convention mirroring `SUBSTRATE_APP_DATABASE_URL`. Document in the test setup.
- [ ] **Step 5: Commit** `feat(core): substrate_auth role + identity tables in core-schema.sql artifact + drift guard`.

---

## Task 3: The `IdentityProvider` port + `AuthError`

**Agent:** `substrate-coder-pro`. **Files:** create `libs/substrate-runtime/src/identity/identity-provider.port.ts`.

- [ ] **Step 1: Write the port** (in runtime, per the TenantRegistry precedent). Uses the substrate `Result` type (find it — likely re-exported from contracts; mirror `PrismaTenantRegistry`/pack-role-assignment which return `Promise<Result<...>>` or plain Promises — check the established shape and match it).

```ts
export type AuthError =
  | { kind: 'invalid-credentials' }   // generic — never reveals which/whether
  | { kind: 'user-disabled' }
  | { kind: 'provider-error'; message: string };

export interface IdentityVerifyInput {
  readonly identifier: string; // email for the local provider
  readonly secret: string;     // password for the local provider
}

export interface IdentityProvider {
  readonly id: string; // "local" | future "agov" | "swissid"
  /** Verify a credential; resolve the global userId on success. No throws. */
  verify(input: IdentityVerifyInput): Promise<Result<{ userId: string }, AuthError>>;
}

export const IDENTITY_PROVIDER: unique symbol = Symbol.for('@de-braighter/substrate-runtime/IDENTITY_PROVIDER');
```
(If the cluster `Result` is `{ ok, value } | { ok:false, error }`, use it exactly. If the auth convention prefers a discriminated `AuthError` over `Result`, follow the ADR-211 port shape.)

- [ ] **Step 2: Unit test** the type-level contract via the LocalPasswordProvider (Task 5). Commit with Task 5.

---

## Task 4: The repos (User / UserCredential / UserTenant) — in-memory + Prisma + contract parity

**Agent:** `substrate-coder-pro`. **Files:** under `libs/substrate-runtime/src/identity/` — port interfaces, a shared contract suite, in-memory + Prisma adapters + specs.

- [ ] **Step 1: Repo ports** (read/write, NO tenant arg — these are global): `UserRepository` (`findByEmail`, `findById`, `create`, `setStatus`), `UserCredentialRepository` (`findByUserAndProvider`, `upsert`, `deleteForUser`), `UserTenantRepository` (`findByUser`, `findByUserAndTenant`, `create`, ...). Keep minimal — only what B1 + the LocalPasswordProvider need (YAGNI; B2/C add more).
- [ ] **Step 2: Shared contract suite** `runUserRepositoryContract` etc. (ADR-202 parity) — test-internal (imports vitest), NOT barrel-exported.
- [ ] **Step 3: In-memory adapters** + specs (call the contract suite).
- [ ] **Step 4: Prisma adapters** (raw SQL via the `substrate_auth` client — no GUC; these are non-RLS) + DB-gated contract specs (`describe.skipIf(!SUBSTRATE_AUTH_DATABASE_URL)`), running the shared suite against a real DB on the `substrate_auth` role.
- [ ] **Step 5: Commit** `feat(identity): User/UserCredential/UserTenant repos (in-memory + Prisma, contract parity)`.

---

## Task 5: `LocalPasswordProvider` (argon2id) + uniform timing

**Agent:** `substrate-coder-pro`. **Files:** `libs/substrate-runtime/src/identity/local-password.provider.ts` + spec; add `@node-rs/argon2` dep.

- [ ] **Step 1: Add the dep** `@node-rs/argon2` to `libs/substrate-runtime/package.json`; install. (Prebuilt — no node-gyp. Verify it imports on this host.)
- [ ] **Step 2: Write the failing test** (unit): `LocalPasswordProvider.verify` returns `ok({userId})` for a correct password, `err({kind:'invalid-credentials'})` for a wrong password AND for a non-existent email (generic — same error), and runs a **dummy verify** when the user/credential is missing (uniform timing — no account-existence oracle). A `setPassword(userId, password)` hashes with argon2id + upserts the credential.

```ts
// representative assertions
it('verifies a correct local password', async () => {
  const { provider, users, creds } = makeFixture();
  const u = await users.create({ email: 'a@x.ch', displayName: 'A' });
  await provider.setPassword(u.id, 'correct horse battery staple');
  const r = await provider.verify({ identifier: 'a@x.ch', secret: 'correct horse battery staple' });
  expect(r.ok && r.value.userId).toBe(u.id);
});
it('returns generic invalid-credentials for a wrong password', async () => { /* err invalid-credentials */ });
it('returns the SAME generic error for an unknown email (no account-existence oracle)', async () => {
  const r = await provider.verify({ identifier: 'nobody@x.ch', secret: 'x' });
  expect(r.ok).toBe(false); // and kind === 'invalid-credentials'
});
it('runs a dummy argon2 verify when the user is missing (uniform timing)', async () => { /* assert hash() called even on miss */ });
```

- [ ] **Step 3: Implement** with `@node-rs/argon2` (`hash` with argon2id + OWASP params; `verify`). On missing user/credential, still call `verify` against a fixed dummy hash before returning `err({kind:'invalid-credentials'})` (uniform timing). Never log the password/hash. `setPassword` → `hash(password)` → `credRepo.upsert({userId, provider:'local', secretHash})`.
- [ ] **Step 4: Run → green.** Commit `feat(identity): LocalPasswordProvider (argon2id via @node-rs/argon2, uniform-timing, generic errors)`.

---

## Task 6: DP-3 negative-grant test (the credential isolation, the new security surface)

**Agent:** `substrate-coder-pro`. **Files:** `libs/substrate-runtime/src/identity/core-identity-grants.contract.spec.ts` (DB-gated).

- [ ] **Step 1: Write the DB-gated test** proving the access-control model: as the **`app`** role, `SELECT FROM core.user_credential` → REJECTED (`permission denied`, SQLSTATE 42501); same for `core.user`/`core.user_tenant` (app has no grant). As the **`substrate_auth`** role, SELECT/INSERT on all three → SUCCEEDS. This is the ADR-211 DP-3 + ADR-209 charter-condition negative-grant test for the new auth-scoped tables.
```ts
const APP = process.env['SUBSTRATE_APP_DATABASE_URL'];
const AUTH = process.env['SUBSTRATE_AUTH_DATABASE_URL'];
describe.skipIf(!APP || !AUTH)('core identity tables — auth-subsystem-only grants', () => {
  it('the app (pack) role CANNOT read core.user_credential', async () => {
    await expect(appClient.$queryRawUnsafe('SELECT 1 FROM "core"."user_credential" LIMIT 1'))
      .rejects.toThrow(/permission denied/i);
  });
  it('the substrate_auth role CAN read + write core.user_credential', async () => { /* succeeds */ });
  // + core.user, core.user_tenant app-denied
});
```
- [ ] **Step 2: Run green** against the test DB (both roles provisioned). Commit `test(core): app role cannot read identity tables; substrate_auth can (DP-3)`.

---

## Task 7: forRoot wiring + exports + gate + publish

**Agent:** `substrate-coder-pro` + verifier wave. **Files:** `composition-root/substrate.module.ts`, the barrel, `package.json`.

- [ ] **Step 1:** Add a `forRoot` option to bind `IDENTITY_PROVIDER` (a constructed `LocalPasswordProvider` instance, like the auth repos) + bind the identity repos. Export `IdentityProvider`/`AuthError`/`IDENTITY_PROVIDER`/`LocalPasswordProvider` + the repo ports from the runtime barrel (the contract suites stay test-internal).
- [ ] **Step 2: Full gate:** `npx nx test substrate-runtime` (unit green; DB-gated skip without env), DB-gated green with `SUBSTRATE_DATABASE_URL` + `SUBSTRATE_APP_DATABASE_URL` + `SUBSTRATE_AUTH_DATABASE_URL`, `npx tsc -b libs/substrate-runtime` clean.
- [ ] **Step 3: Verifier wave** — `local-ci` + `reviewer` + `charter-checker` (REQUIRED per the standing condition — confirms the 3 new auth-scoped tables are correctly admitted to the allow-list + the substrate_auth posture) + `qa-engineer` + a **dedicated security pass** (the `/security-review` discipline: argon2 params, uniform timing, no secret logging, the grant model, no account-existence oracle, no hand-rolled crypto). Address blocking findings.
- [ ] **Step 4: Bump + publish.** `npm view @de-braighter/substrate-runtime version` (exact) → `0.22.0`; set `0.23.0`. Commit. PR (body: `Producer:` + `Effect: cycle-time`/`findings`; Tech design ADR-211). After merge: `npm publish` from `libs/substrate-runtime`; verify; twin ritual.

---

## Done = (B1)

`@de-braighter/substrate-runtime@0.23.0` ships `core.user`/`core.user_credential`/`core.user_tenant` (auth-scoped, `substrate_auth`-only, in the migration + artifact, drift-guard green), the `IdentityProvider` port + `LocalPasswordProvider` (argon2id, uniform-timing, generic errors), the identity repos (in-memory + Prisma parity), and the DP-3 negative-grant test proving the pack `app` role cannot read credentials. No HTTP, no sessions yet. **Next: B2 (sessions + EdDSA tokens + AuthService + `/auth/*`).**

---

## Self-review (author)

- **Spec coverage:** ADR-211 B1 (schema + identity port + LocalPasswordProvider + repos) → Tasks 1–5; DP-3 (dedicated auth role + credential isolation) → Tasks 2 + 6; the charter condition (allow-list + negative-grant + charter-checker) → Tasks 2/6/7. DP-2 (audit) + `core.session` correctly deferred to B2 (no audit/session in B1) — noted.
- **Security emphases:** vetted argon2 (`@node-rs/argon2`, no hand-rolled crypto), uniform timing + generic errors (no account-existence oracle), no secret logging, the `substrate_auth`-only grant model + the negative-grant test, charter-checker + a dedicated security pass in the wave.
- **Type consistency:** `IdentityProvider.verify → Promise<Result<{userId}, AuthError>>` used in Tasks 3 + 5; `setPassword(userId, password)` in Task 5; repos' global (no-tenant) method shapes in Task 4. Match the cluster `Result` shape exactly (verify against an existing runtime port).
- **Risk flagged:** the drift-guard now has THREE table classes (tenant-scoped S/I/U-to-app + isolation policy; auth-scoped SELECT-to-app `core.tenant`/`tenant_pack`; auth-subsystem-only S/I/U/D-to-`substrate_auth`-no-app). Keep the enumerated sets explicit + the existing assertions intact. The `substrate_auth` test-DB role provisioning is the new infra dependency.
