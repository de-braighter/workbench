# Tenant Management & Authentication — Umbrella Design

- **Date:** 2026-06-03
- **Status:** Draft (umbrella spec for a multi-slice arc)
- **Driver:** herdbook is the first domain that forces real multi-tenancy + login
- **Scope:** substrate kernel (`core.*` identity/tenant tables, auth layer, platform
  scope) + `design-system` (reusable auth UI) + herdbook (consumer of login + console)
- **Authoring competencies to involve:** `substrate-architect` (kernel ADRs),
  `substrate-coder-pro` (contracts + runtime), `swiss-pro` (nDSG/revFADP review of the
  user/session PII surface), `ui-pro` + `a11y-pro` (design-system auth bricks),
  `implementer` (herdbook wiring).

---

## 1. Why now

Today the de-braighter substrate **enforces** tenancy but has no tenant **entity**:

- A "tenant" exists only as (a) an in-memory `TenantDescriptor` registered at boot,
  (b) a derived `tenant_pack_id` (a deterministic RFC-4122 v5 UUID of `tenantId:packId`,
  `deriveTenantPackId` in `tenant-registry.ts`), and (c) the `x-tenant-id` / `x-pack-id`
  / `x-user-id` request headers the `TenantPackContextGuard` reads.
- There is **no `core.tenant` row, no `core.user` table**. `core.prisma` carries a
  literal `// TODO: build week 1 — core.Tenant / core.User / core.UserTenant / core.Session`.
- herdbook runs as **one hardcoded tenant** (`b6c5d8e2-…0001` → the string stub
  `herdbook-tpid-0001`), and identity is **spoofable** via headers (`TenantPackContextGuard`
  v1 trusts `x-user-id` with no verification).

herdbook is now a registry-grade product holding **real Swiss member PII** under nDSG /
revFADP. It needs: multiple breed-registry organizations as real, isolated tenants; a
platform operator who can onboard them; and a real login so identity is proven, not
asserted. That is "tenant management." It is a **substrate capability** (every domain
needs it); herdbook is merely the first consumer that forces the build.

### Relationship to existing decisions

- **ADR-027 (pack architecture)** already anticipates this: Invariant 2 ("Tenants
  activate packs", a `TenantPack` binding) and Invariant 6 (RLS via
  `current_setting('app.tenant_pack_id')`). This arc **operationalizes** Invariant 2
  (persists the `TenantPack` binding that currently only exists as a derived value) and
  leaves Invariant 6 untouched.
- **ADR-176 (kernel minimality / inclusion test).** Tenant + user + session are shared
  infrastructure needed by **≥2 packs** (herdbook, exercir, conservation, markets all run
  on the same tenancy primitive) and must be validated/queried/versioned by the kernel →
  they pass leg (b). They live in the `core` **governance ring** (alongside
  `core.pack_role_assignment` + `core.consent_receipt`, which the charter-checker has
  already sanctioned as resident), **not** in the four kernel-concern `kernel.*` schema.
- **ADR-110 (hexagonal ports).** "How a user proves identity" becomes an
  `IdentityProvider` **port** so AGOV / SwissID / HIN can later slot in as adapters with
  zero rework.

---

## 2. Decisions taken (the forks we resolved)

| # | Fork | Decision | Consequence |
|---|------|----------|-------------|
| D1 | What "tenant management" means | **Platform-admin console** (operator onboards orgs) is the target; foundation underneath it | The ladder is bottom-up; the console is slice C |
| D2 | Auth depth | **Full login** — real `core.user` + credentials + sessions, replacing the header shim | `core.user` / `core.session` are in scope, not deferred |
| D3 | Credential mechanism | **`IdentityProvider` port + `LocalPasswordProvider` (argon2) adapter** | Swiss IdP is a later adapter, not a rewrite |
| D4 | User ↔ tenant cardinality | **Multi-homed** — global `core.user`, `core.user_tenant` membership, JWT carries the *active* tenant | A tenant switcher exists; identity is global, not tenant-owned |
| D5 | Where the UI lives | **Reusable auth UI in `design-system`** (login + console + org-admin bricks), hosted per-app | Aligns with the open "one design system, possibly multiple apps" question |
| D6 | Session model (own rec.) | **Short-lived JWT access token + revocable server-side refresh session** (`core.session`) | Logout/forced-revoke works; good for nDSG erasure/withdrawal |
| D7 | Platform identity (own rec.) | A flag/role on `core.user` (`platform_role`) checked by a `PlatformAdminGuard` | No separate "platform tenant"; simplest above-RLS gate |
| D8 | Global-table RLS posture (own rec.) | Identity/tenant tables are **auth-scoped, not per-tenant RLS** — reachable only via substrate auth/platform services on a restricted DB role | Resolves the "login reads user before tenant context exists" paradox |

### Non-goals (explicitly out for this arc)

- Real AGOV / SwissID / HIN federation (designed-for via the port; not built — a later
  adapter).
- MFA / passkeys / WebAuthn (the `core.user_credential` shape leaves room; not built).
- Billing / subscription / quota management on tenants (tenant has a `status`; no billing).
- Self-service tenant sign-up (tenants are operator-provisioned in slice C; public
  sign-up is a later concern).
- SSO between herdbook and other domain apps beyond a shared token format.

---

## 3. Target architecture (end-state, after D)

### 3.1 Two scopes, one schema

The substrate gains a deliberate **two-scope** model in the `core` schema:

```
┌───────────────────────── AUTH / PLATFORM SCOPE ─────────────────────────┐
│ Reachable ONLY by substrate auth + platform services (restricted DB      │
│ role; runs WITHOUT app.tenant_pack_id set). Global, cross-tenant.        │
│                                                                          │
│   core.tenant            — the org (breed registry) as a real row        │
│   core.tenant_pack       — (tenant, pack) activation; OWNS tenant_pack_id │
│   core.user              — global identity principal (email, status)     │
│   core.user_credential   — per-(user, provider) secret (argon2 hash)     │
│   core.user_tenant       — membership: which tenants a user belongs to   │
│   core.session           — revocable refresh sessions (jti, expiry)      │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────── PER-TENANT RLS SCOPE (unchanged) ────────────────┐
│ Reachable by pack code; app.tenant_pack_id IS set; RLS filters rows.      │
│                                                                          │
│   core.pack_role_assignment — user→pack-role grants (per tenant_pack_id)  │
│   core.consent_receipt       — consent receipts (per tenant_pack_id)      │
│   kernel.*, herdbook.*, …    — all existing tenant-scoped data            │
└──────────────────────────────────────────────────────────────────────────┘
```

The **load-bearing rule**: identity/tenant tables are *global* and protected at the
**application layer** (only the substrate auth/platform services touch them) plus a
**restricted DB role** — they are **not** filtered by `app.tenant_pack_id`, because the
login path must find a user by email before any tenant is known. Per-tenant authorization
(what a user may *do* inside a tenant) stays in the RLS-scoped
`core.pack_role_assignment`. Membership (which tenants a user may *enter*) lives in the
auth-scoped `core.user_tenant`.

### 3.2 Request lifecycle, after the guard swap

```
1. Client sends Authorization: Bearer <access-jwt>  (no x-* headers)
2. AuthGuard verifies signature + exp, reads { userId, activeTenantId, packId,
   tenantPackId, sessionId, roles[] } from the JWT claims.
3. (cheap) confirms the session (jti) is not revoked — short-lived access tokens
   mean this can be a per-N-minutes check or skipped until refresh, design TBD in B.
4. Builds the same TenantPackContext shape used today { tenantId, packId, userId,
   requestId, tenantPackId } → ScopedPrismaService sets app.tenant_pack_id → RLS as before.
5. Pack controllers and PolicyEngine are UNCHANGED — they still consume
   TenantPackContext + pack_role_assignment. The swap is invisible below the guard.
```

This is the key compatibility property: **everything below `TenantPackContext` keeps
working**. The arc replaces *how the context is obtained* (verified token vs trusted
header), not the context itself or anything downstream.

### 3.3 The `tenant_pack_id` continuity guarantee (and a pre-existing inconsistency to fix)

`core.tenant_pack` becomes the **owner** of `tenant_pack_id`, and the column is `@db.Uuid`
(matching `core.pack_role_assignment`). `DbTenantRegistry.resolveTenantPackId` returns the
**stored** value from the row rather than re-deriving it.

A discovery during planning complicates the herdbook flip: herdbook today runs **two
different `tenant_pack_id` values in two subsystems**:
- **Pack data** (`herdbook.*` animals, code-lists, …) and the kernel lineage repo are
  keyed on the *string stub* `herdbook-tpid-0001` (herdbook's `tenant_pack_id` columns are
  TEXT, so a non-UUID string is accepted), threaded explicitly via `HERDBOOK_TENANT_PACK_ID`.
- **The policy grant** (`core.pack_role_assignment`, a UUID column) uses the *derived UUID*
  `28b96bdb-2321-5a5e-9b66-3b49af0a5940` (= `deriveTenantPackId('b6c5d8e2-…0001', 'herdbook')`),
  because the guard's `resolveTenantPackId` returns the derived value.

These coexist only because the two subsystems never compare values. `core.tenant_pack.tenant_pack_id`
is a UUID column, so it **cannot** store `herdbook-tpid-0001`. The reconciliation: canonicalize
on the **derived UUID** — seed the herdbook `core.tenant_pack` row with
`deriveTenantPackId(tenantId,'herdbook')`, and **migrate herdbook's existing pack data** from
the TEXT string to that UUID (a `UPDATE herdbook.* SET tenant_pack_id = '28b96bdb-…'` across
~14 tables) so all three subsystems agree. The `herdbook-tpid-0001` stub in `tenants.ts` is
retired. Because this touches ~14 tables + ~140 test usages and is herdbook-local, it is the
**herdbook-adopt** step (its own plan/PR after the substrate publishes), not the substrate
primitive. The substrate side only seeds/serves the value; it imposes no migration on existing
substrate data.

---

## 4. The slice ladder

Each slice is its own spec → plan → subagent-driven build → live-verify → PR → merge →
twin-ritual cycle. Order is strict (each depends on the prior). The publish train per
substrate slice: `@de-braighter/substrate-contracts` (minor) → `@de-braighter/substrate-runtime`
(minor) → consumer adopt.

### Slice A — Substrate: persisted tenants + DB-backed registry

**Goal:** replace the hardcoded single tenant with real persisted tenants, with no auth
change yet. Independently shippable and live-verifiable.

**Split at the publish seam** (decided during planning — see §3.3):
- **A1 (substrate-side)** — the foundation in `layers/substrate`: the `core.tenant` +
  `core.tenant_pack` tables (auth-scoped, see below), the published `core-schema.sql`
  artifact + drift-guard extension, `PrismaTenantRegistry`, the `forRoot` `tenantRegistry`
  option, a `provisionTenant` helper, all proven by the substrate's own DB-gated tests, then
  **published** as a runtime minor bump. Self-contained; no consumer migration.
- **A2 (herdbook-adopt)** — its own plan/PR after A1 publishes: flip herdbook onto
  `PrismaTenantRegistry`, seed the herdbook `core.tenant`/`core.tenant_pack` rows, and
  reconcile the string-vs-UUID `tenant_pack_id` (§3.3). **SHIPPED 2026-06-04 (herdbook#30)** —
  the guard now resolves `tenant_pack_id` from `core.tenant_pack` (not a constant), all data is
  keyed on the derived UUID, live-proven (200-with-data / unknown-tenant-403 / test:db green).
- **A3 (request-scoped pack data plane)** — *discovered during A2*: herdbook's pack data
  providers (`PostgresLineageRepository` + the ~11 `*Providers`) are constructed at composition
  time with the **constant** `tenant_pack_id`, never the per-request
  `tenantPackContext.tenantPackId` — so two real tenants' *data* both land under tenant A's
  scope (R4 single-tenant pinning). The **auth plane** is now per-tenant correct; A3 threads the
  resolved tpid through the providers (request-scoped runner, ADR-202 `TenantRunner`) to deliver
  real two-tenant **data** isolation. Prerequisite for slice C onboarding a 2nd real tenant.
  Tracked: herdbook#31.

The plan `2026-06-03-tenant-mgmt-sliceA1-substrate-foundation.md` covers A1; A2 has its own
plan (`2026-06-04-tenant-mgmt-sliceA2-herdbook-adopt.md`).

**A new core-table category — *auth-scoped*.** `core.tenant`/`core.tenant_pack` are global
(above any single tenant) and must be readable by `PrismaTenantRegistry` with **no
`app.tenant_pack_id` GUC set** (the registry resolves that GUC value in the first place).
The existing `tenant_pack_isolation` RLS policy would hide every row in that state, and
`core.tenant` has no `tenant_pack_id` column at all. So these tables are **not** per-tenant
RLS-scoped: no isolation policy, `GRANT SELECT … TO app` only (the registry reads; writes are
reserved to the migrate/owner role in A1 and the platform role in slice C). The drift guard
(which today hard-requires `tenant_pack_isolation` + `GRANT SELECT, INSERT, UPDATE` per core
table) is extended to recognize this category.

**Ships:**
- Migration adding `core.tenant` and `core.tenant_pack` (auth-scoped; no per-tenant RLS;
  `app`-role read grant gated so only the platform/auth path writes — see §6 RLS posture).
- `DbTenantRegistry implements TenantRegistry` (reads `core.tenant` + `core.tenant_pack`),
  bound in the composition root behind a flag, with `InMemoryTenantRegistry` retained as
  the test double + offline default.
- A provisioning seed/CLI (`provisionTenant({ displayName, packs[] })`) that inserts the
  tenant + its tenant_pack rows (computing/storing `tenant_pack_id`). No HTTP API yet —
  the platform API is slice C.
- The `core-schema.sql` distribution artifact + drift guard (ADR-195 mechanism) extended
  so packs can apply the new tables.
- herdbook flips to `DbTenantRegistry`; its tenant becomes a **seeded row** carrying the
  live `tenant_pack_id`. `tenants.ts` constants are retired in favour of the seed.

**Data model:**

```prisma
model Tenant {
  id          String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  slug        String    @unique          // url-safe key, e.g. "vssz"
  displayName String    @map("display_name")
  status      String    @default("active") // active | suspended | archived
  metadata    Json      @default("{}") @db.JsonB  // per-org extension (branding, locale default…)
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  archivedAt  DateTime? @map("archived_at") @db.Timestamptz()
  @@map("tenant")
  @@schema("core")
}

model TenantPack {
  id           String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId     String    @map("tenant_id") @db.Uuid
  packKey      String    @map("pack_key")
  tenantPackId String    @unique @map("tenant_pack_id") @db.Uuid // the RLS scope key
  activatedAt  DateTime  @default(now()) @map("activated_at") @db.Timestamptz()
  deactivatedAt DateTime? @map("deactivated_at") @db.Timestamptz()
  @@unique([tenantId, packKey])
  @@map("tenant_pack")
  @@schema("core")
}
```

**Live-verify:** herdbook runs end-to-end reading its tenant from the DB (A2 ✓). The
two-real-tenant RLS-isolation check (an animal under tenant A invisible under tenant B's
`tenant_pack_id`) requires the **request-scoped pack data plane (A3)** — A2 alone keeps the
data plane single-tenant (the constant tpid through the providers), so that check lands with
A3, not A2.

**ADR:** `substrate-architect` authors "persisted tenants + DbTenantRegistry" (operationalizes
ADR-027 Invariant 2; auth-scoped table posture; tenant_pack_id continuity).

---

### Slice B — Substrate: identity, sessions, login (real auth behind the port)

**Goal:** real users + credentials + login; demote the header shim to a dev-only flag.

**Ships:**
- Migration adding `core.user`, `core.user_credential`, `core.user_tenant`,
  `core.session` (auth-scoped).
- `IdentityProvider` port in `substrate-contracts` + `LocalPasswordProvider` adapter
  (argon2id) in `substrate-runtime`.
- `AuthService` (substrate-runtime): `login(email, secret) → { accessJwt, refreshToken,
  tenants[] }`, `selectTenant(tenantId)` (re-issues a JWT bound to the active tenant),
  `refresh(refreshToken)`, `logout(sessionId)`.
- HTTP: `POST /auth/login`, `POST /auth/select-tenant`, `POST /auth/refresh`,
  `POST /auth/logout`, `GET /auth/me`. These run in the **auth scope** (no tenant context).
- **Guard swap:** a new `AuthContextGuard` verifies the bearer JWT and builds
  `TenantPackContext`; `TenantPackContextGuard`'s header path is retained behind
  `SUBSTRATE_DEV_HEADER_AUTH=true` for local dev / tests only (fail-closed in prod).
- JWT: short-lived access (claims: `sub`, `email`, `tid` active tenant, `pack`,
  `tpid`, `sid` session jti, `roles[]`, `plat` platform flag, `exp`); refresh = opaque
  token hashed in `core.session`, revocable.

**Data model (sketch):**

```prisma
model User {
  id           String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  email        String   @unique
  displayName  String   @map("display_name")
  status       String   @default("active")  // active | disabled
  platformRole String?  @map("platform_role") // null | "operator" (D7)
  createdAt    DateTime @default(now()) @map("created_at") @db.Timestamptz()
  disabledAt   DateTime? @map("disabled_at") @db.Timestamptz()
  @@map("user") @@schema("core")
}

model UserCredential {           // per (user, provider); local-password = argon2 hash
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  provider   String                       // "local" | future: "agov","swissid"
  secretHash String?  @map("secret_hash") // argon2id; null for federated providers
  metadata   Json     @default("{}") @db.JsonB
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz()
  @@unique([userId, provider])
  @@map("user_credential") @@schema("core")
}

model UserTenant {               // membership (auth-scoped, NOT per-tenant RLS)
  id         String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId     String   @map("user_id") @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  tenantRole String   @default("member") @map("tenant_role") // owner | admin | member
  status     String   @default("active")
  joinedAt   DateTime @default(now()) @map("joined_at") @db.Timestamptz()
  leftAt     DateTime? @map("left_at") @db.Timestamptz()
  @@unique([userId, tenantId])
  @@map("user_tenant") @@schema("core")
}

model Session {                  // revocable refresh sessions
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  userId        String   @map("user_id") @db.Uuid
  refreshHash   String   @map("refresh_hash")  // hash of the opaque refresh token
  activeTenantId String? @map("active_tenant_id") @db.Uuid
  issuedAt      DateTime @default(now()) @map("issued_at") @db.Timestamptz()
  expiresAt     DateTime @map("expires_at") @db.Timestamptz()
  revokedAt     DateTime? @map("revoked_at") @db.Timestamptz()
  @@map("session") @@schema("core")
}
```

`IdentityProvider` port (in `substrate-contracts`):

```ts
export interface IdentityProvider {
  readonly id: string; // "local" | "agov" | …
  /** Verify a credential, returning the global userId on success. No throws. */
  verify(input: { identifier: string; secret: string }):
    Promise<Result<{ userId: string }, AuthError>>;
}
```

**Two role layers** (kept deliberately distinct):
- `user_tenant.tenant_role` (owner/admin/member) → governs org self-administration
  (who may manage the tenant's users) — slice D.
- `core.pack_role_assignment.role_id` (registrar/judge/admin) → governs *pack* permissions
  (unchanged; PolicyEngine consumes it).

**Live-verify:** seed a user + credential + membership + a pack-role grant; `POST /auth/login`
→ token → `POST /auth/select-tenant` → call a herdbook endpoint with the bearer token and
get the same result the header shim gave; `POST /auth/logout` → token's session revoked →
refresh fails.

**ADR:** `substrate-architect` authors "identity, sessions & the IdentityProvider port"
(auth-scope posture, JWT+refresh model, guard-swap compatibility, dev-header flag).
**`swiss-pro` review:** user/session PII — retention of `core.session`, erasure of
`core.user` on member-deletion, audit of credential changes (nDSG/revFADP).

---

### Slice C — Platform-admin console (the operator's control panel)

**Goal:** the surface where the operator onboards a breed-registry org and provisions its
first admin.

**Ships:**
- `PlatformAdminGuard` — gates the platform API on `JWT.plat === "operator"` (D7). The
  platform API runs in the **auth scope** (above RLS), using the restricted platform DB
  path.
- `PlatformAdminService` + HTTP (auth-scoped, `/platform/*`):
  - `POST /platform/tenants` — create tenant (+ activate packs) → reuses slice-A provisioning.
  - `GET /platform/tenants` / `GET /platform/tenants/:id` — list / detail.
  - `PATCH /platform/tenants/:id` — suspend / archive / rename / edit metadata.
  - `POST /platform/tenants/:id/packs` — activate/deactivate a pack.
  - `POST /platform/tenants/:id/admins` — **provision first admin**: create `core.user`
    (status active, no password) + `core.user_credential` (a one-time set-password
    invite token, or an operator-set temporary password) + `core.user_tenant`
    (`tenant_role = owner`) + the pack-level `admin` role grant in
    `core.pack_role_assignment` (under the tenant's `tenant_pack_id`).
- **Bootstrap super-admin:** a seed (env-driven email + initial password) creates the
  first `core.user` with `platform_role = operator`. This resolves the bootstrap paradox
  (you can't use the console to create the first operator).
- The console **UI** consumes the design-system auth/console bricks (slice D ships the
  bricks; C may stub a minimal host or land alongside D — sequencing decided at C-design).

**Live-verify:** log in as the seeded operator → create a brand-new tenant "Demo Registry"
→ activate the herdbook pack → provision its first admin → that admin logs in, selects the
tenant, and sees an **empty** herdbook (RLS-isolated from the original tenant).

**ADR:** `substrate-architect` authors "platform scope & admin API" (the above-RLS
platform context, `PlatformAdminGuard`, bootstrap, provisioning transaction semantics —
tenant + user + membership + role grant must be atomic / compensating).

---

### Slice D — Herdbook tenant UX + reusable auth UI

**Goal:** the herdbook-facing payoff — real login, tenant-aware app, org self-admin —
built on reusable design-system bricks (D5).

**Ships (design-system):**
- `auth` bricks: `<bds-login-form>`, `<bds-tenant-switcher>`, `<bds-session-menu>`,
  and a `<bds-platform-console>` pattern brick (tenant list/create/detail) + an
  `<bds-org-team>` pattern brick (manage a tenant's users + role grants). Pure
  presentation + typed inputs/outputs; no substrate import (consumes view-models).
- An `AuthClient` (design-system or a thin shared lib): wraps `/auth/*`, token storage
  (in-memory access + httpOnly-ish refresh handling), the refresh interceptor, and the
  tenant-switch flow. (Where exactly `AuthClient` lives — design-system vs a shared lib —
  decided at D-design.)

**Ships (herdbook-web):**
- A real **login route** (hosts `<bds-login-form>`); the existing dev-header interceptor
  is replaced by a bearer-token interceptor + refresh-on-401.
- Tenant context comes from the token; a **tenant switcher** in the header for multi-homed
  users (re-issues the JWT for the chosen tenant, reloads tenant-scoped data).
- **Org self-administration** — "Settings → Team": a tenant `owner`/`admin` invites/disables
  users and grants/revokes pack roles within *their* tenant (writes
  `core.user_tenant` + `core.pack_role_assignment`; never sees other tenants). Governed by
  `user_tenant.tenant_role` (D) + `herdbook.user.manage`-style permission.
- The platform console route (operator-only), hosting `<bds-platform-console>`, guarded by
  the platform flag.

**Live-verify:** full loop in a browser — operator logs in → console → onboards a tenant +
admin → that admin logs in → manages their own team → a member logs in and works the
registry — all WCAG 2.2 AA (login is an AAA-critical path per a11y-pro).

**ADRs / specs:** `ui-pro` + `a11y-pro` co-author the auth-bricks spec (brick contracts,
the AAA login path, focus management, `3.3.8` accessible-auth + `3.3.7` redundant-entry);
herdbook plan wires them.

---

## 5. Sequencing & dependencies

```
A (tenants persisted) ──► B (users + login) ──► C (platform console) ──► D (herdbook UX + bricks)
   substrate                substrate              substrate                design-system + herdbook
   publish train            publish train          publish train           (+ thin shared client)
```

- A unblocks B (users belong to tenants).
- B unblocks C (the console provisions users; the operator must log in).
- C unblocks D's console surface; B unblocks D's login surface.
- D's bricks may be developed in parallel with C once B's `/auth/*` contract is frozen,
  but land last (they consume both).

Hard gates between slices: each substrate slice **publishes** before its consumer adopts;
each slice is **live-verified** before merge (the herdbook house rule — unit-green is not
enough); twin-ritual after every merge.

---

## 6. Cross-cutting concerns

### 6.1 RLS posture for the global tables (the load-bearing security call)

`core.tenant / tenant_pack / user / user_credential / user_tenant / session` are **not**
per-tenant RLS-scoped (there is no `app.tenant_pack_id` to filter on during login). They
are protected by **two** mechanisms:

1. **Application layer** — only the substrate `AuthService` / `PlatformAdminService`
   touch them; no pack code, no controller outside `/auth` + `/platform` can reach them.
2. **DB role** — per the `core.prisma` header comment's production posture: a restricted
   role for the auth/platform path (analogous to the documented `kernel_resolver` +
   `BYPASSRLS` for "the pre-context auth lookup"). The `app` role used by pack requests
   gets **no** grants on these tables.

This is the deliberate, documented exception to "every row carries `tenant_pack_id`": it
applies to **tenant-scoped data**, and identity/tenant tables are by definition
*above* a single tenant. The charter-checker should be consulted (governance-ring
addition) — the precedent is `core.pack_role_assignment` already living in `core` with
sanction.

### 6.2 Swiss data protection (nDSG / revFADP) — first-class, not bolted on

Users + sessions are **personal data**. Per herdbook's CLAUDE.md, consent / retention /
erasure / audit are first-class. Concretely:
- **Audit** every credential set/reset, login success/failure, session revoke, role grant,
  tenant membership change → `kernel.AuditEvent` (ADR-027 §6) with PII field classification.
- **Erasure** — deleting/anonymizing a member must cascade to `core.user` (and its
  credentials/sessions) per the right-to-erasure; design the cascade in slice B.
- **Retention** — `core.session` rows expire + are pruned; failed-login throttling data
  is short-lived.
- `swiss-pro` reviews slices B and C before merge.

### 6.3 The bootstrap paradox

The first platform operator cannot be created by the console (which requires being logged
in as an operator). Resolution: a **seed** (`scripts/seed-platform-admin`) reads an
env-provided email + initial password, creates `core.user` with `platform_role=operator`
+ a `local` credential. Idempotent; refuses to run twice for the same email. Slice C.

### 6.4 Backwards compatibility & the dev shim

- Slice A keeps the header shim entirely (no auth change).
- Slice B introduces token auth but **retains** the header path behind
  `SUBSTRATE_DEV_HEADER_AUTH=true` — default **off** in prod, **on** in the existing
  test/dev harness so the large existing test corpus and the documented live-run recipe
  keep working during the transition. A follow-up retires the header path once all
  consumers use tokens.
- `TenantPackContext` shape is unchanged → `ScopedPrismaService`, `PolicyEngine`,
  `GucPrismaRunner`, every pack controller are untouched.

### 6.5 Token verification cost (ε-budget)

Per-request work must stay cheap (qa-strategy ε-budget). Access-token verification is a
local signature check (no DB hit). Session-revocation checking on every request would add
a DB hit; mitigate with short access-token TTL (revocation effective within the TTL) and
check the session only on **refresh**. Final policy decided in slice B.

---

## 7. ADRs to author (one per slice, numbers allocated live by `substrate-architect`)

1. **(Slice A)** Persisted tenants + `DbTenantRegistry` + auth-scoped table posture +
   `tenant_pack_id` continuity. Operationalizes ADR-027 Invariant 2.
2. **(Slice B)** Identity, credentials, sessions & the `IdentityProvider` port; JWT +
   revocable refresh; the guard swap + dev-header flag.
3. **(Slice C)** Platform scope (above-RLS), `PlatformAdminGuard`, bootstrap super-admin,
   atomic tenant-provisioning.
4. **(Slice D)** Reusable auth UI bricks in design-system (contracts + the AAA login path);
   herdbook hosting + org self-admin permission model.

Each ADR runs the spec-auditor + md-quality verifier wave (specs repo is PR-gated,
ADR-191). The `next-free-adr` frontmatter in `layers/specs/adr/README.md` is the source of
truth for numbering (the README prose lags).

---

## 8. Open questions (resolved at the slice where they bite — not now)

- **B:** exact session-revocation check cadence (every request vs refresh-only); access/
  refresh TTLs; password policy + reset/invite-token flow; failed-login throttling store.
- **B:** does `core.user.email` global-uniqueness hold across all tenants (yes, per D4
  multi-homed), and how is email change handled?
- **C:** does the console live in herdbook-web or a dedicated platform app for the
  prototype? (Leaning: host in herdbook-web behind the platform flag now; extract later.)
- **C:** provision-admin UX — operator-set temp password vs emailed invite link (email
  needs an outbound mail dependency — likely sandboxed/stubbed in the prototype).
- **D:** where `AuthClient` + token storage live (design-system vs a thin shared lib);
  refresh-token storage strategy in the browser (httpOnly cookie needs server cooperation).
- **D:** tenant-switcher placement + whether conservation/herdbook share one app shell.

---

## 9. Risks

| Risk | Mitigation |
|------|-----------|
| Re-scoping live herdbook data when `tenant_pack` takes ownership of `tenant_pack_id` | §3.3 — seed the herdbook `tenant_pack` row with the **exact** derived value already in use; assert equality in the migration/seed |
| Auth-scoped tables become an RLS bypass hole | §6.1 — restricted DB role + app-layer service boundary + charter-checker review; `app` role gets zero grants on identity tables |
| Guard swap breaks the large existing test corpus + live-run recipe | §6.4 — retain header path behind a dev flag; flip consumers incrementally |
| Security-sensitive code (password hashing, JWT, session) authored fast | argon2id via a vetted lib (no hand-rolled crypto); `reviewer` + `qa-engineer` + a focused security pass on slices B/C; `swiss-pro` for the PII/DP angle |
| Scope creep into MFA/SSO/billing | §2 non-goals are explicit; the `IdentityProvider` port + `metadata` JSONB absorb future shape without kernel churn |
| design-system auth bricks vs the AAA login bar | `a11y-pro` co-authors the brick spec (WCAG 2.2 AA mandatory, AAA for login per the charter's critical-path list) |

---

## 10. Definition of done (whole arc)

In a browser, with the header shim **off**: the seeded operator logs in, onboards a new
breed-registry tenant and its first admin from the console; that admin logs in, selects
their tenant, manages their own team, and works an RLS-isolated herdbook; a member logs in
and operates the registry — every step verified end-to-end against the real stack, every
merge live-verified + twin-ritualed, the substrate published, and the four ADRs ratified.
