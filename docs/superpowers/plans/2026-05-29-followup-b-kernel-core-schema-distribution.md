# Follow-up B — DB-level RLS for pack-football: kernel `core.*` schema distribution (design + plan)

**Status:** design — awaiting confirmation before implementation
**Issue:** exercir#112 · **Arc:** pack-football kernel-auth (exercir#110/#111 merged; CoachPrincipal retired #113/#114)
**Decision owner:** founder (chose "substrate publishes migrations" via AskUserQuestion, 2026-05-29)

## Problem

The auth/consent enforcement matrix is proven at the guard layer on **in-memory** repos (exercir#111). The **DB-level RLS** cross-tenant invariant — `core.pack_role_assignment` / `core.consent_receipt` under the non-superuser `app` role, scoped by the `app.tenant_pack_id` GUC — is proven only at the substrate layer (substrate#41). exercir's DB has no `core.*` tables and no `app` role, so the dual-URL provisioned-roles pattern can't be exercised in exercir yet.

## The deciding fact (why this is clean)

The substrate Prisma adapters query **raw SQL**, not typed Prisma models:

```js
// @de-braighter/substrate-runtime — prisma-pack-role-assignment.repository.js
constructor(@Inject design:paramtypes [ScopedPrismaService])   // sets app.tenant_pack_id GUC
await client.$queryRawUnsafe(`INSERT INTO core.pack_role_assignment ...`)
await client.$queryRawUnsafe(`SELECT ... FROM core.pack_role_assignment ...`)
```

Therefore **exercir does NOT vendor the `core.*` Prisma models.** It needs only:

1. the `core.*` tables + RLS policies + grants to *exist* in its DB,
2. the `app` non-superuser role provisioned,
3. an app-role `PrismaClient` + `ScopedPrismaService` wired so the GUC is set per request.

`core.*` lives entirely outside exercir's Prisma-managed `football` schema → `prisma migrate dev` never sees it → **no drift, no migrate-history pollution.** This is what makes "substrate is the single source of truth" the *cleaner* option, not the heavier one.

## Decision

**Substrate publishes its `core.*` schema as a consumable, idempotent SQL artifact; exercir applies it via `prisma db execute` (outside its own migrate history) and queries it through the substrate raw-SQL repos.**

### Artifact form (substrate side)

Ship two hand-maintained, **idempotent** SQL files in the `@de-braighter/substrate-runtime` package (add to `files`), under `sql/`:

- `sql/app-roles.sql` — the `app` role (the packs-relevant subset of `docker/init-scripts/01-create-roles.sql`): `CREATE ROLE app … NOSUPERUSER NOBYPASSRLS …` guarded by `IF NOT EXISTS` (a `DO` block), idempotent.
- `sql/core-schema.sql` — `CREATE SCHEMA IF NOT EXISTS core` + `CREATE TABLE IF NOT EXISTS core.pack_role_assignment / core.consent_receipt` + partial unique indexes (`WHERE revoked_at/withdrawn_at IS NULL`) + `ENABLE/FORCE ROW LEVEL SECURITY` + `DROP POLICY IF EXISTS … ; CREATE POLICY tenant_pack_isolation …` (USING/WITH CHECK on `current_setting('app.tenant_pack_id', true)`) + `GRANT SELECT, INSERT, UPDATE … TO app`. Re-runnable on an existing DB.

**Sync guard (substrate):** a test that applies `sql/core-schema.sql` to a fresh throwaway DB and asserts the resulting `core.*` shape matches a fresh `prisma migrate deploy` — so the consolidated artifact can't silently drift from substrate's authoritative migrations. This is the mechanism that makes "single source of truth" real.

Publish a new immutable substrate version (registry versions are immutable — never re-publish an existing one).

### Apply mechanism (exercir side)

- `package.json` script `db:setup:core` → runs the two published files against the **admin** URL:
  `prisma db execute --file node_modules/@de-braighter/substrate-runtime/sql/app-roles.sql --schema ./prisma`
  then `… sql/core-schema.sql`. Roles first (the GRANTs need the role), then schema. Both idempotent → safe to re-run.
- exercir's `prisma/schema.prisma` stays `schemas = ["football"]`. **No `core.*` models added.**
- Dev/CI only; gated. Demo-mode default (InMemory repos + `PackFootballAuthBootstrap` seed) is unchanged.

### Provider wiring (exercir `app.module.ts`)

Mirror the existing `PACK_FOOTBALL_KERNEL_OUTBOX` env-gated block. Behind a new flag (e.g. `PACK_FOOTBALL_KERNEL_DB_AUTH=true`):

- bind `PRISMA_CLIENT` → a `PrismaClient` on `SUBSTRATE_APP_DATABASE_URL` (the app-role connection),
- provide `ScopedPrismaService` (REQUEST-scoped; sets the GUC from `TENANT_PACK_CONTEXT.tenantPackId`),
- pass `PrismaPackRoleAssignmentRepository` + `PrismaConsentReceiptRepository` to `SubstrateModule.forRoot({ packRoleAssignmentRepository, consentReceiptRepository })` instead of the in-memory classes.
- Use explicit `@Inject(...)` for any substrate engine dep (the esbuild/metadata gotcha from #110).

### DB-gated test (exercir)

New `…/pack-football-rls-enforcement.spec.ts` mirroring substrate#41's deferred spec:

- `describe.skipIf(!APP_URL || !ADMIN_URL)` — skips cleanly when the DB/role/env aren't present.
- **Meta-guard:** fail loudly if a DB is reachable but `SUBSTRATE_APP_DATABASE_URL` is unset (a superuser-only connection silently passes RLS — false confidence).
- Seed a grant in tenant A (admin URL), then under the app role with `app.tenant_pack_id` = tenant B, assert the grant is invisible (RLS returns 0 rows) — true DB-level cross-tenant isolation, not just repo-scoping. Extend with the consent-receipt mirror.

## The 2-PR arc

1. **substrate PR** — add `sql/app-roles.sql` + `sql/core-schema.sql` + the sync-guard test; add `sql/` to package `files`; bump + publish a new immutable version. (Designer-first sub-question: does this decision warrant an ADR in `layers/specs/` — "kernel `core.*` schema distribution to packs"? It sets a pattern for every future RLS-backed pack, so **yes, promote to an ADR** alongside this PR.)
2. **exercir PR** — bump the substrate dep; add `db:setup:core`; provision via the published SQL; wire the app-role `PrismaClient` + `ScopedPrismaService` + the two Prisma repos behind the flag; add the DB-gated RLS spec. (Charter: real schema/RLS is *expected* here per exercir-charter §4; no real PHI — synthetic demo grants/consents only.)

## Open sub-questions (resolve in/with the substrate PR)

- **Artifact granularity:** consolidated `core-schema.sql` (recommended) vs shipping `prisma/migrations/**`. Consolidated is one idempotent apply, exactly the `core.*` subset packs need (excludes `kernel.*` audit tables); the sync-guard test addresses the "hand-maintained" risk.
- **Role-init home:** substrate ships `sql/app-roles.sql` (recommended, single-source) vs exercir mirrors just the app-role block locally. Substrate-ships keeps it single-source.
- **ADR promotion:** scaffold an ADR for the distribution decision (cross-pack pattern) — recommended.
- **Where does the dev DB come from?** exercir's docker/DB provisioning path is undocumented today (CLAUDE.md references a stale `exercir-workbench/docker/` path). Confirm the actual dev-Postgres + where `db:setup:core` runs in the dev/CI loop before the exercir PR.

## Gotchas carried forward

- Fresh worktree: `npm install` (needs `GITHUB_TOKEN`) **then `npm run db:generate`** (else TS4111 on `$disconnect`).
- Local gate via the **vitest CLI**, not `nx test` (buggy `@nx/vitest:test` executor). CI billing-frozen → local gate only.
- Substrate consumed via the **published package** only (no `file:` link) — the exercir PR can't start until the substrate version is published.
- Worktree teardown: `nx daemon --stop` → `rm -rf .worktrees/<name>` → `git worktree prune`.
- Verifier wave on each PR (read-only, against the committed diff): reviewer + charter-checker + qa-engineer (+ exercir-charter-checker on the exercir PR). charter-checker matters on the substrate PR (it touches the published surface + sets a distribution pattern).
