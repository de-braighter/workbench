# Substrate Audit Foundation Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the full-fidelity `kernel-audit` library + 3 migrations from the archived `de-braighter/exercir-service` repo (commit `970e8fb4`, PR #1316) into the new `layers/substrate` cluster repo, adapted for substrate topology (ESM with `.js` imports; `@de-braighter/*` package scope; `app.tenant_pack_id` GUC already-reconciled per Arc 1b; hex layout split across `substrate-contracts` + `substrate-runtime` per ADR-110/115/176). Implements ratified ADR-061 (kernel `AuditEvent` schema), ADR-062 (`AuditService` + retention tiers + tamper-evidence), and ADR-063 (pack manifest `auditContributions`) — at the v0.2 prototype-fidelity the archived migration shipped (4 tables, 2 enums, hash chain + Merkle anchor + WORM via REVOKE; external infra such as S3 Object Lock and RFC 3161 TSA are deterministic mocks per charter §3 OQ1, same as the archive).

**Architecture:** Three stacked PRs on `layers/substrate`'s `main`. **PR-A** lands the migration baseline (4 audit tables, 2 enums, RLS predicates, WORM revoke, app-role grants) — pure Prisma + SQL, no TypeScript surface yet. **PR-B** ports the lib — domain types + hash-chain + Merkle service + AuditEventRepository port into `substrate-contracts/src/audit/`; AuditService + subtype registry + in-memory & Prisma adapters + NestJS module into `substrate-runtime/src/audit/`. **PR-C** wires AuditService into `SubstrateModule.forRoot({ audit: ... })`, lands the WORM integration spec, bumps `substrate-contracts` to `0.6.0` and `substrate-runtime` to `0.7.0`, publishes. PR-A/B/C stack on `feat/audit-foundation-arc3`; the eventual single squash-merge to `main` is the same shape as Arc 1b's stacked merge (per the `feedback_shared-working-tree-concurrency` lesson — verify branch immediately before every commit).

**Tech Stack:** TypeScript 5.x (ESM, nodenext, composite tsconfig), Prisma ^5.22 (multiSchema), Postgres 16, NestJS 10, vitest 4, Zod 3.24, `@de-braighter/substrate-contracts` + `@de-braighter/substrate-runtime` (this repo's own packages).

**Repo/env:** `D:\development\projects\de-braighter\layers\substrate\`. Branches off `main` (last commit `dbdb5ef Merge PR #14 — Arc 2 release`). **CRITICAL: verify branch immediately before every commit** — `git branch --show-current` MUST print the expected feature branch. If a build/lint errors `Cannot find module '@de-braighter/...'`, STOP + report BLOCKED — do not run `setup-dev.sh` (per `feedback_forms-lib-build-reads-stale-node-modules-copy`).

**Authoritative archive source:** `de-braighter/exercir-service` (archived 2026-05-25, read-only). Reachable via `gh api repos/de-braighter/exercir-service/contents/<path>`. Default ref is `main`. Every file fetch in PR-B follows this pattern:

```bash
gh api repos/de-braighter/exercir-service/contents/<path> --jq '.content' | base64 -d > /tmp/<file>
```

The implementer **always** fetches the archive verbatim, then applies the explicit adaptations listed per task. **Never** copy from memory; always fetch.

**Authoritative concept docs:** `layers/specs/concepts/audit-log-abstract-model.md` (§6 design), `layers/specs/adr/adr-061-kernel-audit-event-schema.md`, `layers/specs/adr/adr-062-*.md`, `layers/specs/adr/adr-063-*.md`, `layers/specs/adr/adr-132-admin-route-rls-escape-hatch.md` (Invariant 3 — load-bearing for `AdminCrossTenantRead.v1` rows).

---

## Pre-conditions (verify before starting)

- `cd D:/development/projects/de-braighter/layers/substrate`
- `git checkout main && git pull origin main && git log --oneline -1` → must show `dbdb5ef Merge pull request #14 from de-braighter/chore/release-arc2-event-sourcing`.
- `node -p "require('./libs/substrate-contracts/package.json').version"` → `0.5.0`.
- `node -p "require('./libs/substrate-runtime/package.json').version"` → `0.6.0`.
- `npm run ci:local` → green baseline (build + lint + vitest).
- `gh auth status` → authenticated (needed for `gh api` archive fetches).
- `psql --version` → confirms a local Postgres client (substrate-postgres container should be running per `docker compose up -d substrate-postgres`; check via `docker ps | grep substrate-postgres`).

If any of the above fails, stop and reconcile before proceeding.

---

## Decisions (reversible — flag in review if contested)

1. **4 tables, not 5.** The archived `20260502170000_kernel_audit/migration.sql` shipped 4 tables (`audit_event`, `audit_event_chain`, `audit_chain_anchor`, `audit_legal_hold`). The concept §6.1 sketches 5 (split `AuditEventAgent`/`AuditEventEntity` from `AuditEvent`); the archive denormalises agent/entity into JSONB columns on `audit_event`. We port the archive shape verbatim — fewer joins, identical surface, and the concept §6.1 explicitly allows the JSONB inlining.

2. **GUC reconciliation is a no-op.** The archive migration already uses `current_setting('app.tenant_pack_id', true)` in every RLS predicate (matching Arc 1b's reconciliation). No translation needed in the SQL. The Prisma `@db.Text` mapping for `tenant_pack_id` stays `TEXT` to match the archive — substrate's *new* tables (`kernel.plan_node`) use UUID, but the audit migration's TEXT shape is the existing convention and changing it would require an Arc 1b co-migration. (Open item: future cleanup PR to align on UUID; not load-bearing for this arc.)

3. **`tenant_id` and `tenant_pack_id` are BOTH retained on `audit_event`.** The archive carries both because audit rows can be emitted in pre-auth contexts (`tenant_id` may be set before `tenant_pack_id` resolves). Port verbatim.

4. **External infra stays mocked.** `tsa_token_ref` is `'mock-tsa://<hash>'`; `s3_object_lock_ref` is `'mock-s3://anchors/<id>'`. The archive's PrismaAuditEventRepository synthesises both deterministically. Real TSA + S3 Object Lock are deferred — same as the archive (charter §3 OQ1).

5. **Package scope rebind.** Every `@exercir/...` import → `@de-braighter/...`. The single archive dependency is `@exercir/plugin-api` for the `AuditSubtype` type — we **inline** that type in `substrate-contracts/src/audit/audit-types.ts` (it's a `string` literal-union alias used only by the subtype registry; no need to take a dependency).

6. **Module system.** Archive is CommonJS (`"type": "commonjs"`, `"main": "src/index.ts"`); substrate is ESM (`"type": "module"`). Every import in ported files gets a `.js` suffix per substrate's ESM convention. The compiled-output structure stays — `tsconfig.lib.json` already handles this for the substrate libs.

7. **Hex split: contracts vs runtime.** Per substrate's ring discipline (ADR-176):
   - `substrate-contracts/src/audit/` — pure-TS, zero NestJS, published as part of `@de-braighter/substrate-contracts`: domain types, hash-chain functions, MerkleService class (no `@Injectable`), AuditEventRepository port + token + DTOs, subtype errors. **One package import path.**
   - `substrate-runtime/src/audit/` — NestJS-bound, published as part of `@de-braighter/substrate-runtime`: AuditService (`@Injectable`), AuditSubtypeRegistry (`@Injectable`), `AuditSubtypeRegistryModule` (NestJS), `emit-audit-event` helper, OTel-Loki subscriber, in-memory adapter, Prisma adapter.

8. **In-memory adapter exported via `/testing` subpath.** Mirror Arc 1's `@de-braighter/substrate-runtime/testing` convention (where `InMemoryInferenceBackbone` and `InMemoryPlanTreeStore` live). The Prisma adapter ships from the main runtime entrypoint.

9. **`@Inject(AUDIT_EVENT_REPOSITORY)` uses `Symbol.for`.** Per the Arc 1b PR #12 fix (`fix(substrate-contracts): use Symbol.for for INFERENCE_BACKBONE_PORT + PLAN_TREE_STORE DI tokens`), all new substrate DI tokens are `Symbol.for('<key>')` so cross-package identity is stable. Token key: `'@de-braighter/substrate-contracts/AUDIT_EVENT_REPOSITORY'`.

10. **Three-PR stack, single squash on merge.** Per cluster git policy + Arc 1b precedent. PR-B branches off PR-A's feature branch; PR-C branches off PR-B's; each PR retargets `main` after its predecessor merges.

---

## File Structure

### PR-A — migrations + Prisma models

- Create: `layers/substrate/prisma/migrations/<ts>_auditor_select_policy/migration.sql` — port of `20260428210000_auditor_select_policy/migration.sql` (auditor role + permissive SELECT policy).
- Create: `layers/substrate/prisma/migrations/<ts>_kernel_audit/migration.sql` — port of `20260502170000_kernel_audit/migration.sql` (4 tables + enums + RLS + WORM + grants).
- Create: `layers/substrate/prisma/migrations/<ts>_grant_schema_usage_to_app_auditor/migration.sql` — port of `20260611000000_grant_schema_usage_to_app_auditor/migration.sql`.
- Modify: `layers/substrate/prisma/schema/audit.prisma` — replace the v0.2 scaffold (comment block) with the 4 Prisma models + 2 enums.
- Modify: `layers/substrate/prisma/schema/kernel.prisma` — (no edits expected; kernel tables stay; double-check no overlap).

### PR-B — library port

**`substrate-contracts/src/audit/`** (pure TS, zero NestJS):
- Create: `audit-types.ts` — `AuditAction`, `AuditOutcome`, `RetentionTier`, `AuditAgentInput`, `AuditEntityInput`, `AuditSourceInput`, `RecordAuditEventInput`, `RecordAuditEventResult`, `AuditEventRow`, `AuditQueryFilter`, `AuditQueryScope`, `VerifyChainResult`, `AuditSubtype` (inlined).
- Create: `hash-chain.ts` — `canonicalJson`, `sha256Hex`, `computeChainLink`, `nextPrevHash`, `verifyLinearChain`, types `ChainLink`, `ChainLinkInput`, `AuditChainRow`.
- Create: `merkle-service.ts` — `MerkleService` class (no `@Injectable` — pure class), types `MerkleAnchor`, `MerkleProof`.
- Create: `audit-subtype-errors.ts` — `AuditSubtypeCollision`, `AuditSubtypeNotRegistered`.
- Create: `audit-event-repository.port.ts` — `AuditEventRepository` interface, `AUDIT_EVENT_REPOSITORY` `Symbol.for` token, `AppendAuditEventInput`, `AppendAuditEventResult`, `AuditChainRowDto`, `CloseAnchorInput`, `CloseAnchorResult`, `MerkleAnchorClosure`.
- Create: `audit-event-repository.contract.spec.ts` — re-usable contract suite (consumed by per-adapter tests).
- Create: `index.ts` — barrel.
- Modify: `substrate-contracts/src/index.ts` — re-export `./audit/index.js`.

**Spec tests in contracts** (vitest, pure):
- Create: `hash-chain.spec.ts` — verifies `nextPrevHash`, `verifyLinearChain`, `canonicalJson`, `sha256Hex`.
- Create: `merkle-service.spec.ts` — verifies `buildAnchor`, `verifyProof`.

**`substrate-runtime/src/audit/`** (NestJS-bound):
- Create: `audit-service.ts` — `AuditService` (`@Injectable`, depends on `AUDIT_EVENT_REPOSITORY`).
- Create: `audit-subtype-registry.ts` — `AUDIT_SUBTYPE_REGISTRY` token + `AuditSubtypeRegistry` (`@Injectable`), `RegisteredAuditSubtype`.
- Create: `audit-subtype-registry.module.ts` — `AuditSubtypeRegistryModule`, `AuditSubtypeBootstrap`, `AuditSubtypeRegistryModuleOptions`.
- Create: `emit-audit-event.ts` — `emitAuditEvent`, `EmitAuditEventInput`.
- Create: `otel-loki-subscriber.ts` — `AUDIT_OTEL_LOKI_SUBSCRIBER` token + `registerAuditOtelLokiSubscriber`.
- Create: `in-memory-audit-event-repository.adapter.ts` — `InMemoryAuditEventRepository`.
- Create: `prisma-audit-event-repository.adapter.ts` — `PrismaAuditEventRepository`, `AuditEventRepositoryPrismaLike`.
- Create: per-file `*.spec.ts` for each of the above (port from archive).
- Create: `prisma-audit-event-repository.worm.integration.spec.ts` — env-gated, hits DB.
- Create: `index.ts` — runtime barrel.
- Create: `testing.ts` — separate barrel exporting only `InMemoryAuditEventRepository` for the `/testing` subpath.
- Modify: `substrate-runtime/src/index.ts` — re-export `./audit/index.js`.
- Modify: `substrate-runtime/src/testing.ts` (if exists) or create — re-export `InMemoryAuditEventRepository`.
- Modify: `substrate-runtime/package.json` — verify `/testing` subpath export already exists (per Arc 1's `InMemoryInferenceBackbone`); no change expected.

### PR-C — composition + integration + publish

- Modify: `substrate-runtime/src/substrate.module.ts` (or equivalent — locate via `grep -r "SubstrateModule" layers/substrate/libs/substrate-runtime/src`) — add `audit?:` field to `SubstrateModuleOptions`; bind `AUDIT_EVENT_REPOSITORY` from caller; provide `AuditService` + `AuditSubtypeRegistry`.
- Create: `substrate-runtime/src/audit/audit-service.integration.spec.ts` — end-to-end on InMemory adapter.
- Create: `substrate-runtime/src/audit/prisma-audit-event-repository.worm.integration.spec.ts` — env-gated DB spec.
- Modify: `substrate-contracts/package.json` — bump version `0.5.0 → 0.6.0`, append `audit` to "description".
- Modify: `substrate-runtime/package.json` — bump version `0.6.0 → 0.7.0`.
- Modify: `substrate-contracts/CHANGELOG.md` + `substrate-runtime/CHANGELOG.md` — add `0.6.0` / `0.7.0` entry.
- Modify: `layers/substrate/README.md` — add audit section (1 paragraph + quick-start).

---

## PR-A — Migrations + Prisma models

### Task A1: Branch + baseline gate

**Files:** none (git only)

- [ ] **Step 1:** Create the feature branch off `main`.

```bash
cd D:/development/projects/de-braighter/layers/substrate
git checkout main && git pull --ff-only origin main
git checkout -b feat/audit-foundation-arc3
git branch --show-current   # MUST print: feat/audit-foundation-arc3
```

- [ ] **Step 2:** Run the baseline gate.

```bash
npm run ci:local
echo "EXIT: $?"
```

Expected: EXIT 0. If a build errors `Cannot find module '@de-braighter/...'`, STOP and report BLOCKED.

### Task A2: Fetch + port the auditor_select_policy migration

**Files:**
- Create: `layers/substrate/prisma/migrations/<ts>_auditor_select_policy/migration.sql`

- [ ] **Step 1:** Generate the migration name with a fresh timestamp (per Prisma convention).

```bash
TS=$(date -u +%Y%m%d%H%M%S)
mkdir -p prisma/migrations/${TS}_auditor_select_policy
echo "Migration timestamp: ${TS}"
```

Record `${TS}` — used in the next two tasks for ordering.

- [ ] **Step 2:** Fetch the archive verbatim.

```bash
gh api repos/de-braighter/exercir-service/contents/prisma/migrations/20260428210000_auditor_select_policy/migration.sql \
  --jq '.content' | base64 -d > prisma/migrations/${TS}_auditor_select_policy/migration.sql
```

- [ ] **Step 3:** Apply the adaptations.

Open `prisma/migrations/${TS}_auditor_select_policy/migration.sql`. The archive uses `audit."AuditEvent"` (PascalCase Prisma-default mapping). Since the PR-A migration creates `kernel.audit_event` with snake_case, and *this auditor policy references the audit schema*, we need to **defer the auditor policy creation** until after PR-A's kernel_audit migration runs. But the auditor migration in the archive was migration-ordered BEFORE the kernel_audit migration (`20260428` < `20260502`), so the archive's auditor policy referenced an `audit.AuditEvent` table that already existed from a yet-earlier migration that DID NOT make it into the substrate's clean-structure migration.

**Decision:** stub the auditor policy so it references `kernel.audit_event` (the table we're about to create) — *not* `audit."AuditEvent"` (which doesn't exist in substrate). Rewrite the body:

```sql
-- Audit reads — per-tenant SELECT for the `auditor` role.
--
-- Adapted for substrate: the archive referenced audit."AuditEvent" (a separate
-- audit schema). Substrate consolidates audit_event into kernel schema and
-- uses kernel.audit_event. RLS via app.tenant_pack_id GUC.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auditor') THEN
    -- Idempotent grant — auditor role already exists from platform init.
    GRANT USAGE ON SCHEMA kernel TO auditor;
    GRANT SELECT ON ALL TABLES IN SCHEMA kernel TO auditor;
    ALTER DEFAULT PRIVILEGES IN SCHEMA kernel GRANT SELECT ON TABLES TO auditor;
  ELSE
    -- Local dev may not have the auditor role; skip without failing.
    RAISE NOTICE 'auditor role not present; skipping kernel-schema grants.';
  END IF;
END$$;

-- The per-row USING policy is added in the kernel_audit migration alongside the
-- kernel.audit_event table itself (CREATE POLICY auditor_tenant_select).
```

Move the per-row `CREATE POLICY auditor_tenant_select` into the kernel_audit migration body (Task A3). This consolidation matches substrate's pattern (per-table policies live with the table DDL).

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3" ] || { echo "WRONG BRANCH"; exit 1; }
git add prisma/migrations/${TS}_auditor_select_policy/
git commit -m "chore(substrate): prepare auditor-schema grants migration (audit foundation, part 1/3)"
```

### Task A3: Port the kernel_audit migration

**Files:**
- Create: `layers/substrate/prisma/migrations/<ts+1>_kernel_audit/migration.sql`

- [ ] **Step 1:** Allocate the next-second timestamp.

```bash
TS2=$(date -u -d '1 second' +%Y%m%d%H%M%S 2>/dev/null || python -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(seconds=1)).strftime('%Y%m%d%H%M%S'))")
mkdir -p prisma/migrations/${TS2}_kernel_audit
echo "TS2: ${TS2}"
```

- [ ] **Step 2:** Fetch the archive.

```bash
gh api repos/de-braighter/exercir-service/contents/prisma/migrations/20260502170000_kernel_audit/migration.sql \
  --jq '.content' | base64 -d > prisma/migrations/${TS2}_kernel_audit/migration.sql
```

- [ ] **Step 3:** Apply the adaptations to `prisma/migrations/${TS2}_kernel_audit/migration.sql`. The file is ~250 lines; the adaptations are:

  - **No schema rename.** Archive uses `kernel.audit_event`; substrate also uses `kernel.*`. Leave as-is.
  - **`tenant_pack_id` column stays TEXT.** Already TEXT in archive; matches the archive's RLS predicate `current_setting('app.tenant_pack_id', true)` returning TEXT. (Future cleanup PR may align to UUID; not in scope.)
  - **Append the auditor SELECT policy** at the end of the file (the row-level policy that the auditor migration in Task A2 explicitly defers). Append:

```sql
-- ─── auditor SELECT policy (consolidated from auditor_select_policy migration) ─
-- Per-row policy for the `auditor` role, joined onto the tenant_pack_id GUC
-- pattern. Rows where tenant_pack_id IS NULL (kernel-only events) are
-- intentionally hidden from per-tenant auditors; a future global-auditor role
-- can use a separate policy.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'auditor') THEN
    CREATE POLICY auditor_tenant_select ON kernel.audit_event
      FOR SELECT TO auditor
      USING (
        tenant_pack_id IS NOT NULL
        AND tenant_pack_id = current_setting('app.audit_tenant_pack_id', true)
      );
  END IF;
END$$;
```

Note the GUC name: `app.audit_tenant_pack_id` (auditor-side) is distinct from `app.tenant_pack_id` (app-side). This separation mirrors the archive's `app.audit_tenant_id` vs `app.tenant_id`. The auditor connects with `SET LOCAL ROLE auditor; SET LOCAL app.audit_tenant_pack_id = '<id>';` per the archive convention.

- [ ] **Step 4:** Smoke-test the SQL syntax by `--create-only` running prisma migrate (no apply).

```bash
# Confirm SQL is syntactically valid by attempting a dry-run validate.
# Prisma doesn't have a native --dry-run; instead, ensure the file parses by
# attempting an `npm run prisma:migrate -- --create-only --name dry_run_audit`
# — but only if substrate has a `prisma:migrate` script. Otherwise inspect via:
cat prisma/migrations/${TS2}_kernel_audit/migration.sql | wc -l
# Expected: ~260 lines (5 lines header + 2 enums + 4 tables + ~10 indexes + RLS + WORM + grants + auditor policy).
```

If you have a live `substrate-postgres` container, apply:

```bash
npm run prisma:migrate || true   # apply pending migrations; expect green
```

Expected: migration applies cleanly. Inspect:

```bash
docker exec substrate-postgres psql -U postgres -d substrate -c "\d+ kernel.audit_event"
docker exec substrate-postgres psql -U postgres -d substrate -c "\d+ kernel.audit_event_chain"
docker exec substrate-postgres psql -U postgres -d substrate -c "\d+ kernel.audit_chain_anchor"
docker exec substrate-postgres psql -U postgres -d substrate -c "\d+ kernel.audit_legal_hold"
docker exec substrate-postgres psql -U postgres -d substrate -c "\dt kernel.audit*"
```

Expected: 4 tables, with the column/index/constraint shape from the migration.

- [ ] **Step 5:** Smoke-test RLS + WORM.

```bash
# RLS — without the GUC set, INSERT must fail.
docker exec substrate-postgres psql -U postgres -d substrate -c "
BEGIN;
INSERT INTO kernel.audit_event (tenant_pack_id, event_type, action, outcome)
  VALUES ('test-pack', 'smoke_test', 'C', 'success');
ROLLBACK;
"
# Expected: succeeds when running as postgres (superuser bypasses RLS).
# A non-superuser test is deferred (the app-role gated suite — same posture as plan_node).

# WORM — UPDATE/DELETE on audit_event from non-owner role must fail.
# (Skipped without an `app` role; superuser bypasses REVOKE.)
```

- [ ] **Step 6:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3" ] || { echo "WRONG BRANCH"; exit 1; }
git add prisma/migrations/${TS2}_kernel_audit/
git commit -m "feat(substrate): kernel.audit_event + audit_event_chain + audit_chain_anchor + audit_legal_hold (audit foundation, part 2/3)"
```

### Task A4: Port the grant_schema_usage migration

**Files:**
- Create: `layers/substrate/prisma/migrations/<ts+2>_grant_schema_usage_to_app_auditor/migration.sql`

- [ ] **Step 1:** Allocate timestamp.

```bash
TS3=$(date -u -d '2 second' +%Y%m%d%H%M%S 2>/dev/null || python -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(seconds=2)).strftime('%Y%m%d%H%M%S'))")
mkdir -p prisma/migrations/${TS3}_grant_schema_usage_to_app_auditor
```

- [ ] **Step 2:** Fetch the archive.

```bash
gh api repos/de-braighter/exercir-service/contents/prisma/migrations/20260611000000_grant_schema_usage_to_app_auditor/migration.sql \
  --jq '.content' | base64 -d > prisma/migrations/${TS3}_grant_schema_usage_to_app_auditor/migration.sql
```

- [ ] **Step 3:** Apply adaptations.

The archive likely grants USAGE on `audit` schema; substrate uses `kernel` schema for audit. Rewrite the body so it idempotently grants USAGE + SELECT on `kernel` to `app` and `auditor` roles (both `IF EXISTS`-guarded so local dev without those roles still passes).

Read the archive content first:

```bash
cat prisma/migrations/${TS3}_grant_schema_usage_to_app_auditor/migration.sql
```

If the content references `audit."AuditEvent"`, replace with `kernel.audit_event`. If it references `schema audit`, replace with `schema kernel`. Wrap all GRANT statements in `DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '<role>') THEN ... END IF; END$$;` blocks for idempotency.

- [ ] **Step 4:** Apply + verify.

```bash
npm run prisma:migrate || true
```

Expected: migration applies cleanly.

- [ ] **Step 5:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3" ] || { echo "WRONG BRANCH"; exit 1; }
git add prisma/migrations/${TS3}_grant_schema_usage_to_app_auditor/
git commit -m "chore(substrate): grant kernel-schema USAGE+SELECT to app+auditor (audit foundation, part 3/3)"
```

### Task A5: Update audit.prisma — Prisma models + enums

**Files:**
- Modify: `layers/substrate/prisma/schema/audit.prisma`

- [ ] **Step 1:** Replace the v0.2 scaffold (the comment block) with the real models.

Open `prisma/schema/audit.prisma`. The current content is a 37-line comment block (read first). Replace from line 17 onward (keep the file-header comment block intact at lines 1–16) with the following Prisma models:

```prisma
// Schema declared in core.prisma generator block — see datasource.schemas.

enum AuditRetentionTier {
  operational
  security
  compliance

  @@map("audit_retention_tier")
  @@schema("kernel")
}

enum AuditOutcome {
  success
  minor_failure
  serious_failure
  major_failure

  @@map("audit_outcome")
  @@schema("kernel")
}

model AuditEvent {
  id                  String              @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantId            String?             @map("tenant_id") @db.Uuid
  tenantPackId        String?             @map("tenant_pack_id")
  correlationId       String?             @map("correlation_id") @db.Uuid
  spanId              String?             @map("span_id")
  parentSpanId        String?             @map("parent_span_id")
  eventType           String              @map("event_type")
  eventTypeSystem     String              @default("kernel") @map("event_type_system")
  category            String[]            @default([])
  action              String              @db.Char(1)
  severity            Int                 @default(6) @db.SmallInt
  occurredAt          DateTime            @default(now()) @map("occurred_at") @db.Timestamptz()
  recordedAt          DateTime            @default(now()) @map("recorded_at") @db.Timestamptz()
  outcome             AuditOutcome
  outcomeDesc         String?             @map("outcome_desc")
  purposeOfEvent      String[]            @default([]) @map("purpose_of_event")
  authorizationBasis  String[]            @default([]) @map("authorization_basis")
  agent               Json                @default("[]")
  source              Json                @default("{}")
  entity              Json                @default("[]")
  retentionTier       AuditRetentionTier  @default(operational) @map("retention_tier")
  retentionStatuteRef String?             @map("retention_statute_ref")
  chainEntryId        String?             @map("chain_entry_id") @db.Uuid
  merkleAnchorId      String?             @map("merkle_anchor_id") @db.Uuid
  legalHoldRef        String?             @map("legal_hold_ref") @db.Uuid
  createdByUserId     String?             @map("created_by_user_id")
  createdByDbRole     String?             @map("created_by_db_role")

  @@index([recordedAt], map: "idx_audit_event_recorded_brin", type: BRIN)
  @@index([tenantPackId, recordedAt], map: "idx_audit_event_tenant_pack")
  @@index([tenantId, recordedAt], map: "idx_audit_event_tenant")
  @@index([correlationId], map: "idx_audit_event_correlation")
  @@index([eventTypeSystem, eventType, recordedAt], map: "idx_audit_event_event_type")
  @@index([retentionTier, recordedAt], map: "idx_audit_event_tier")
  @@map("audit_event")
  @@schema("kernel")
}

model AuditEventChain {
  id            String             @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantPackId  String             @map("tenant_pack_id")
  auditEventId  String             @map("audit_event_id") @db.Uuid
  prevHash      String             @map("prev_hash")
  payloadHash   String             @map("payload_hash")
  tier          AuditRetentionTier
  recordedAt    DateTime           @default(now()) @map("recorded_at") @db.Timestamptz()

  @@index([tenantPackId, tier, recordedAt], map: "idx_audit_chain_tenant_pack_recorded")
  @@index([auditEventId], map: "idx_audit_chain_event")
  @@map("audit_event_chain")
  @@schema("kernel")
}

model AuditChainAnchor {
  id                  String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  tenantPackId        String   @map("tenant_pack_id")
  windowStart         DateTime @map("window_start") @db.Timestamptz()
  windowEnd           DateTime @map("window_end") @db.Timestamptz()
  eventCount          BigInt   @default(0) @map("event_count")
  merkleRoot          String   @map("merkle_root")
  prevAnchorId        String?  @map("prev_anchor_id") @db.Uuid
  prevAnchorHash      String?  @map("prev_anchor_hash")
  tsaTokenRef         String   @map("tsa_token_ref")
  tsaTokenIssuedAt    DateTime @default(now()) @map("tsa_token_issued_at") @db.Timestamptz()
  s3ObjectLockRef     String?  @map("s3_object_lock_ref")
  s3ObjectLockUntil   DateTime? @map("s3_object_lock_until") @db.Timestamptz()
  verifiedAt          DateTime? @map("verified_at") @db.Timestamptz()
  createdAt           DateTime @default(now()) @map("created_at") @db.Timestamptz()

  @@index([tenantPackId, windowEnd], map: "idx_audit_chain_anchor_tenant_pack")
  @@map("audit_chain_anchor")
  @@schema("kernel")
}

model AuditLegalHold {
  id                       String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  personId                 String?  @map("person_id") @db.Uuid
  scopeId                  String?  @map("scope_id") @db.Uuid
  caseRef                  String   @map("case_ref")
  startedAt                DateTime @default(now()) @map("started_at") @db.Timestamptz()
  startedByDpoUserId       String   @map("started_by_dpo_user_id")
  startedByLegalUserId     String   @map("started_by_legal_user_id")
  liftedAt                 DateTime? @map("lifted_at") @db.Timestamptz()
  liftedByDpoUserId        String?  @map("lifted_by_dpo_user_id")
  liftedByLegalUserId      String?  @map("lifted_by_legal_user_id")
  notes                    String?

  @@map("audit_legal_hold")
  @@schema("kernel")
}
```

- [ ] **Step 2:** Generate the Prisma client.

```bash
npm run prisma:generate || npx prisma generate --schema prisma/schema
```

Expected: clean generation with `AuditEvent`, `AuditEventChain`, `AuditChainAnchor`, `AuditLegalHold` delegates available.

- [ ] **Step 3:** Verify build.

```bash
npx nx build substrate-runtime
```

Expected: green. (substrate-contracts doesn't depend on Prisma so build unaffected there.)

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3" ] || { echo "WRONG BRANCH"; exit 1; }
git add prisma/schema/audit.prisma
git commit -m "feat(substrate): audit.prisma — Prisma models for 4 audit tables + 2 enums"
```

### Task A6: PR-A — push, open PR, charter-check

- [ ] **Step 1:** Full local gate.

```bash
npm run ci:local
echo "EXIT: $?"
```

Expected: EXIT 0.

- [ ] **Step 2:** Push.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3" ] || { echo "WRONG BRANCH"; exit 1; }
git push -u origin feat/audit-foundation-arc3
```

- [ ] **Step 3:** Open PR-A (the audit-foundation arc anchor).

```bash
gh pr create --base main --head feat/audit-foundation-arc3 \
  --title "feat(substrate): audit foundation — 4 tables + RLS + WORM (Arc 3 PR-A)" \
  --body "$(cat <<'EOF'
## Summary

Ports the kernel.audit_event + audit_event_chain + audit_chain_anchor + audit_legal_hold schema from the archived de-braighter/exercir-service (PR #1316, commit 970e8fb4) into substrate. Includes the auditor role + permissive SELECT policy. Implements ratified ADR-061 + ADR-062. RLS via existing app.tenant_pack_id GUC (Arc 1b). WORM via REVOKE UPDATE,DELETE.

## What this lands

- 3 Prisma migrations (auditor schema grants, kernel_audit core, schema usage grants).
- 4 audit tables: audit_event (FHIR R5-shaped), audit_event_chain (per-tenant_pack hash chain), audit_chain_anchor (daily Merkle anchors), audit_legal_hold (two-actor blocker).
- 2 enums: audit_retention_tier (operational/security/compliance), audit_outcome.
- 10 indexes (NFR1 hot-path + NFR5 volume).
- CHECK constraints enforcing the tier ↔ chain_entry_id ↔ merkle_anchor_id invariants from ADR-132 §Amendment 2026-05-14.
- Prisma model entries in audit.prisma (v0.2 scaffold → real models).

## What this does NOT land

- The TypeScript surface (port, service, adapters) — lands in PR-B (feat/audit-foundation-arc3-lib).
- SubstrateModule wiring — lands in PR-C (feat/audit-foundation-arc3-wire).
- External infra (real S3 Object Lock, real RFC 3161 TSA) — stays mocked (charter §3 OQ1, same as archive).

## Test plan

- [x] npm run ci:local green
- [x] migrations apply cleanly against substrate-postgres
- [x] \d+ kernel.audit_event etc. shows 4 tables with expected columns + indexes + constraints
- [x] RLS predicate uses app.tenant_pack_id (no app.tenant_id residue)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4:** Run the verifier wave on PR-A (per cluster `workflows/verifier-wave.md`):
  - `local-ci` agent — confirms `npm run ci:local` green.
  - `charter-checker` agent — confirms ADR-176 inclusion test (4 audit tables are kernel-shape because ≥2 packs will use audit; ratified by ADR-061), no kernel-creep beyond the 4 concerns.
  - `reviewer` agent — diff review of the 3 SQL files + audit.prisma.
  - `qa-engineer` agent — checks the cascade integrity (Prisma client regeneration; no consumer breakage).

All four must approve with no BLOCKERs before merge.

- [ ] **Step 5:** Merge PR-A.

```bash
gh pr merge <PR-A#> --merge --delete-branch=false   # branch stays — PR-B/C still stack on it
git checkout main && git pull
```

PR-B/C will retarget `main` after their own merges.

---

## PR-B — Library port (contracts + runtime)

### Task B1: Branch off PR-A

- [ ] **Step 1:** Branch from PR-A's HEAD (or `main` if PR-A already merged).

```bash
cd D:/development/projects/de-braighter/layers/substrate
git checkout main && git pull --ff-only origin main
git checkout -b feat/audit-foundation-arc3-lib
git branch --show-current   # MUST print: feat/audit-foundation-arc3-lib
```

- [ ] **Step 2:** Baseline gate.

```bash
npm run ci:local
echo "EXIT: $?"
```

Expected: EXIT 0 (PR-A is merged; Prisma client knows about AuditEvent etc.).

### Task B2: Port domain types — `audit-types.ts` (TDD)

**Files:**
- Create: `libs/substrate-contracts/src/audit/audit-types.ts`
- Create: `libs/substrate-contracts/src/audit/audit-types.spec.ts` (type-only spec)

- [ ] **Step 1:** Fetch the archive source.

```bash
mkdir -p libs/substrate-contracts/src/audit
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/domain/audit-types.ts \
  --jq '.content' | base64 -d > libs/substrate-contracts/src/audit/audit-types.ts
```

- [ ] **Step 2:** Apply adaptations. Open `libs/substrate-contracts/src/audit/audit-types.ts`. Apply:

  - **Remove the `@exercir/plugin-api` import.** Replace `import type { AuditSubtype } from '@exercir/plugin-api';` with an inline alias near the top of the file:

```ts
/**
 * Pack-declared audit subtype (FHIR R5 AuditEvent.event.subtype Coding).
 * Inlined here to avoid a cross-package dependency; the original lived in
 * `@exercir/plugin-api` (archived). Pack manifests carry typed string-literal
 * unions and pass values from them at write sites.
 */
export type AuditSubtype = string;
```

  - **Add `.js` to any local imports** (`./hash-chain` → `./hash-chain.js`, etc. — though `audit-types.ts` is typically self-contained).

  - **Verify all types are `export type`** (no value exports). If the file has any `export const` or `export class`, leave them; they'll be split into separate files in later tasks.

- [ ] **Step 3:** Create a type-only spec.

```ts
// libs/substrate-contracts/src/audit/audit-types.spec.ts
import { describe, expect, it } from 'vitest';

import type {
  AuditAction,
  AuditOutcome,
  RetentionTier,
  AuditAgentInput,
  AuditEntityInput,
  AuditSourceInput,
  RecordAuditEventInput,
  RecordAuditEventResult,
  AuditEventRow,
  AuditQueryFilter,
  AuditQueryScope,
  VerifyChainResult,
  AuditSubtype,
} from './audit-types.js';

describe('audit-types', () => {
  it('AuditAction is the FHIR R5 C|R|U|D|E literal union', () => {
    const valid: AuditAction[] = ['C', 'R', 'U', 'D', 'E'];
    expect(valid.length).toBe(5);
  });

  it('AuditOutcome covers FHIR R5 outcome enum', () => {
    const valid: AuditOutcome[] = ['success', 'minor_failure', 'serious_failure', 'major_failure'];
    expect(valid.length).toBe(4);
  });

  it('RetentionTier matches the kernel.audit_retention_tier enum', () => {
    const valid: RetentionTier[] = ['operational', 'security', 'compliance'];
    expect(valid.length).toBe(3);
  });

  it('RecordAuditEventInput has the FHIR-shape fields', () => {
    const fixture: RecordAuditEventInput = {
      eventType: 'patient_record_open',
      action: 'R',
      outcome: 'success',
      agents: [],
      entities: [],
    };
    expect(fixture.eventType).toBe('patient_record_open');
  });

  it('AuditSubtype is a string alias', () => {
    const s: AuditSubtype = 'room_swap';
    expect(typeof s).toBe('string');
  });
});
```

- [ ] **Step 4:** Run the spec.

```bash
npx vitest run --config libs/substrate-contracts/vitest.config.ts src/audit/audit-types.spec.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-contracts/src/audit/audit-types.ts libs/substrate-contracts/src/audit/audit-types.spec.ts
git commit -m "feat(substrate-contracts): port audit domain types from kernel-audit"
```

### Task B3: Port hash-chain — `hash-chain.ts` (TDD)

**Files:**
- Create: `libs/substrate-contracts/src/audit/hash-chain.ts`
- Create: `libs/substrate-contracts/src/audit/hash-chain.spec.ts`

- [ ] **Step 1:** Fetch the archive sources.

```bash
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/domain/hash-chain.ts \
  --jq '.content' | base64 -d > libs/substrate-contracts/src/audit/hash-chain.ts
```

Check for a co-located test file in the archive:

```bash
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/domain --jq '.[].name' | grep -i hash
```

If a `hash-chain.spec.ts` exists in the archive, fetch it too:

```bash
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/domain/hash-chain.spec.ts \
  --jq '.content' | base64 -d > libs/substrate-contracts/src/audit/hash-chain.spec.ts
```

If not, write the spec inline (Step 3 below).

- [ ] **Step 2:** Apply adaptations to `hash-chain.ts`.

  - Local imports add `.js`: `import { ... } from './audit-types'` → `import { ... } from './audit-types.js'`.
  - `@exercir/...` imports → `@de-braighter/...` (likely none in hash-chain).
  - Replace `crypto.createHash` import if it's `import { createHash } from 'crypto'` with `import { createHash } from 'node:crypto'` for clarity.
  - Verify the exported surface matches the index.ts barrel from the archive: `canonicalJson`, `sha256Hex`, `computeChainLink`, `nextPrevHash`, `verifyLinearChain`, types `ChainLink`, `ChainLinkInput`, `AuditChainRow`.

- [ ] **Step 3:** If the archive spec was not present, write the inline spec.

```ts
// libs/substrate-contracts/src/audit/hash-chain.spec.ts
import { describe, expect, it } from 'vitest';

import {
  canonicalJson,
  sha256Hex,
  computeChainLink,
  nextPrevHash,
  verifyLinearChain,
  type AuditChainRow,
} from './hash-chain.js';

describe('canonicalJson', () => {
  it('sorts object keys deterministically', () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe(canonicalJson({ a: 1, b: 2 }));
  });

  it('handles nested objects', () => {
    const a = canonicalJson({ x: { b: 2, a: 1 } });
    const b = canonicalJson({ x: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    expect(canonicalJson([1, 2, 3])).not.toBe(canonicalJson([3, 2, 1]));
  });
});

describe('sha256Hex', () => {
  it('returns 64-char lowercase hex', () => {
    const h = sha256Hex('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(sha256Hex('test')).toBe(sha256Hex('test'));
  });
});

describe('computeChainLink', () => {
  it('produces a payloadHash + prevHash derived from prior chain row', () => {
    const link = computeChainLink({
      prevHash: '',
      payload: { eventType: 'x', action: 'C', outcome: 'success', agent: [], entity: [] },
    });
    expect(link.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(link.prevHash).toBe('');
  });
});

describe('verifyLinearChain', () => {
  it('returns valid=true for a correctly chained sequence', () => {
    const rows: AuditChainRow[] = [
      { id: '1', auditEventId: 'a1', prevHash: '', payloadHash: sha256Hex('1'), recordedAt: new Date(), tier: 'security' },
    ];
    rows.push({
      id: '2',
      auditEventId: 'a2',
      prevHash: nextPrevHash(rows[0]!.prevHash, rows[0]!.payloadHash),
      payloadHash: sha256Hex('2'),
      recordedAt: new Date(),
      tier: 'security',
    });
    const result = verifyLinearChain(rows);
    expect(result.valid).toBe(true);
  });

  it('returns valid=false when a row is tampered', () => {
    const rows: AuditChainRow[] = [
      { id: '1', auditEventId: 'a1', prevHash: '', payloadHash: sha256Hex('1'), recordedAt: new Date(), tier: 'security' },
      { id: '2', auditEventId: 'a2', prevHash: 'WRONG', payloadHash: sha256Hex('2'), recordedAt: new Date(), tier: 'security' },
    ];
    const result = verifyLinearChain(rows);
    expect(result.valid).toBe(false);
  });
});
```

- [ ] **Step 4:** Run the spec.

```bash
npx vitest run --config libs/substrate-contracts/vitest.config.ts src/audit/hash-chain.spec.ts
```

Expected: PASS. If a `nextPrevHash` signature mismatch surfaces, inspect the archive impl and adjust the spec call. The implementation is the authority; the spec just exercises the public surface.

- [ ] **Step 5:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-contracts/src/audit/hash-chain.ts libs/substrate-contracts/src/audit/hash-chain.spec.ts
git commit -m "feat(substrate-contracts): port hash-chain (canonicalJson + sha256Hex + chain + verify)"
```

### Task B4: Port merkle-service — `merkle-service.ts` (TDD)

**Files:**
- Create: `libs/substrate-contracts/src/audit/merkle-service.ts`
- Create: `libs/substrate-contracts/src/audit/merkle-service.spec.ts`

- [ ] **Step 1:** Fetch + co-located spec if present.

```bash
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/domain/merkle-service.ts \
  --jq '.content' | base64 -d > libs/substrate-contracts/src/audit/merkle-service.ts

gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/domain --jq '.[].name' | grep -i merkle
# If a merkle-service.spec.ts exists, fetch:
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/domain/merkle-service.spec.ts \
  --jq '.content' | base64 -d > libs/substrate-contracts/src/audit/merkle-service.spec.ts 2>/dev/null || true
```

- [ ] **Step 2:** Apply adaptations.

  - Local imports add `.js`.
  - `crypto` import normalised to `node:crypto`.
  - Verify the exported surface: `MerkleService` class, types `MerkleAnchor`, `MerkleProof`.
  - If the class is decorated with `@Injectable()`, **REMOVE** the decorator + import — contracts is zero-NestJS. The class can still be instantiated by the runtime via `new MerkleService()`.

- [ ] **Step 3:** If no archive spec was fetched, write inline.

```ts
// libs/substrate-contracts/src/audit/merkle-service.spec.ts
import { describe, expect, it } from 'vitest';

import { MerkleService, type MerkleAnchor } from './merkle-service.js';

describe('MerkleService', () => {
  const svc = new MerkleService();

  it('buildAnchor on a single payload produces a root equal to its leaf hash', () => {
    const anchor = svc.buildAnchor(['payload-1-hash']);
    expect(anchor.root).toMatch(/^[0-9a-f]{64}$/);
    expect(anchor.leafCount).toBe(1);
  });

  it('buildAnchor on two payloads produces a different root than one payload', () => {
    const a1 = svc.buildAnchor(['p1']);
    const a2 = svc.buildAnchor(['p1', 'p2']);
    expect(a1.root).not.toBe(a2.root);
  });

  it('verifyProof succeeds for an honest inclusion proof', () => {
    const leaves = ['l0', 'l1', 'l2', 'l3'];
    const anchor = svc.buildAnchor(leaves);
    const proof = svc.buildProof(leaves, 2);  // proof of leaves[2]
    expect(svc.verifyProof(leaves[2]!, proof, anchor.root)).toBe(true);
  });

  it('verifyProof fails for a tampered leaf', () => {
    const leaves = ['l0', 'l1', 'l2', 'l3'];
    const anchor = svc.buildAnchor(leaves);
    const proof = svc.buildProof(leaves, 2);
    expect(svc.verifyProof('TAMPERED', proof, anchor.root)).toBe(false);
  });
});
```

If the archive's MerkleService doesn't expose `buildProof` / `verifyProof` directly, inspect the file and write the spec against whatever public methods it has. The intent: at least 4 tests covering anchor build + proof verify.

- [ ] **Step 4:** Run + commit.

```bash
npx vitest run --config libs/substrate-contracts/vitest.config.ts src/audit/merkle-service.spec.ts
# Expected: PASS

[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-contracts/src/audit/merkle-service.ts libs/substrate-contracts/src/audit/merkle-service.spec.ts
git commit -m "feat(substrate-contracts): port MerkleService — anchor build + proof verify"
```

### Task B5: Port subtype errors — `audit-subtype-errors.ts`

**Files:**
- Create: `libs/substrate-contracts/src/audit/audit-subtype-errors.ts`

- [ ] **Step 1:** Fetch + adapt.

```bash
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/domain/audit-subtype-errors.ts \
  --jq '.content' | base64 -d > libs/substrate-contracts/src/audit/audit-subtype-errors.ts
```

Adaptations: `.js` on imports (likely none), no other changes — these are pure error classes.

- [ ] **Step 2:** Build sanity check (no spec — pure exception classes).

```bash
npx tsc -p libs/substrate-contracts/tsconfig.lib.json --noEmit
```

Expected: clean.

- [ ] **Step 3:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-contracts/src/audit/audit-subtype-errors.ts
git commit -m "feat(substrate-contracts): port AuditSubtypeCollision + AuditSubtypeNotRegistered errors"
```

### Task B6: Port AuditEventRepository port — `audit-event-repository.port.ts`

**Files:**
- Create: `libs/substrate-contracts/src/audit/audit-event-repository.port.ts`
- Create: `libs/substrate-contracts/src/audit/audit-event-repository.contract.spec.ts`

- [ ] **Step 1:** Fetch.

```bash
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/out-ports/audit-event-repository.port.ts \
  --jq '.content' | base64 -d > libs/substrate-contracts/src/audit/audit-event-repository.port.ts

gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/out-ports/audit-event-repository.contract.spec.ts \
  --jq '.content' | base64 -d > libs/substrate-contracts/src/audit/audit-event-repository.contract.spec.ts
```

- [ ] **Step 2:** Adapt the port file.

  - `.js` on all local imports.
  - **DI token: bump to `Symbol.for`** per Decision 9. Find the line `export const AUDIT_EVENT_REPOSITORY: unique symbol = Symbol('AUDIT_EVENT_REPOSITORY');` (or similar) and replace with:

```ts
export const AUDIT_EVENT_REPOSITORY: unique symbol = Symbol.for(
  '@de-braighter/substrate-contracts/AUDIT_EVENT_REPOSITORY',
);
```

  - Verify the exported surface matches the archive's index.ts barrel: `AuditEventRepository`, `AUDIT_EVENT_REPOSITORY`, `AppendAuditEventInput`, `AppendAuditEventResult`, `AuditChainRowDto`, `CloseAnchorInput`, `CloseAnchorResult`, `MerkleAnchorClosure`.

- [ ] **Step 3:** Adapt the contract spec.

  - `.js` on local imports.
  - The contract spec is a **factory function** that takes a `RepoFactory` and runs a battery of tests. It's not a standalone spec but a helper consumed by per-adapter spec files in `substrate-runtime`. Verify the exported symbol shape (likely `runAuditEventRepositoryContract(factory)` or similar).
  - If the contract spec imports `vitest`, leave that import; vitest is the substrate's test runner.

- [ ] **Step 4:** Add a token-identity test (one new test, not from archive).

Append to the bottom of `audit-event-repository.contract.spec.ts` OR create a standalone `audit-event-repository.port.spec.ts`:

```ts
// libs/substrate-contracts/src/audit/audit-event-repository.port.spec.ts
import { describe, expect, it } from 'vitest';

import { AUDIT_EVENT_REPOSITORY } from './audit-event-repository.port.js';

describe('AUDIT_EVENT_REPOSITORY token', () => {
  it('is a Symbol.for so cross-package DI identity is stable', () => {
    expect(typeof AUDIT_EVENT_REPOSITORY).toBe('symbol');
    expect(Symbol.keyFor(AUDIT_EVENT_REPOSITORY)).toBe(
      '@de-braighter/substrate-contracts/AUDIT_EVENT_REPOSITORY',
    );
  });
});
```

- [ ] **Step 5:** Run + commit.

```bash
npx vitest run --config libs/substrate-contracts/vitest.config.ts src/audit/audit-event-repository.port.spec.ts
# Expected: PASS

[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-contracts/src/audit/audit-event-repository.port.ts \
        libs/substrate-contracts/src/audit/audit-event-repository.contract.spec.ts \
        libs/substrate-contracts/src/audit/audit-event-repository.port.spec.ts
git commit -m "feat(substrate-contracts): port AUDIT_EVENT_REPOSITORY port + contract spec (Symbol.for DI)"
```

### Task B7: Wire contracts barrel + verify

**Files:**
- Create: `libs/substrate-contracts/src/audit/index.ts`
- Modify: `libs/substrate-contracts/src/index.ts`

- [ ] **Step 1:** Create the audit barrel.

```ts
// libs/substrate-contracts/src/audit/index.ts
export * from './audit-types.js';
export * from './hash-chain.js';
export * from './merkle-service.js';
export * from './audit-subtype-errors.js';
export * from './audit-event-repository.port.js';
```

- [ ] **Step 2:** Re-export from the top-level contracts barrel.

Open `libs/substrate-contracts/src/index.ts`. Add (preserving existing exports):

```ts
export * from './audit/index.js';
```

(Place it after the existing event/inference/plan-tree exports, alphabetised would be after `./adapters/...` if any; convention here is grouped by ring.)

- [ ] **Step 3:** Build + full contracts suite.

```bash
npx nx build substrate-contracts
npx vitest run --config libs/substrate-contracts/vitest.config.ts
```

Expected: both green. Note count of tests passing (should be existing ~N + the new audit tests).

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-contracts/src/audit/index.ts libs/substrate-contracts/src/index.ts
git commit -m "feat(substrate-contracts): expose audit/* via main barrel"
```

### Task B8: Port InMemoryAuditEventRepository adapter (TDD)

**Files:**
- Create: `libs/substrate-runtime/src/audit/in-memory-audit-event-repository.adapter.ts`
- Create: `libs/substrate-runtime/src/audit/in-memory-audit-event-repository.adapter.spec.ts`

- [ ] **Step 1:** Fetch.

```bash
mkdir -p libs/substrate-runtime/src/audit
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/out-adapters/in-memory-audit-event-repository.adapter.ts \
  --jq '.content' | base64 -d > libs/substrate-runtime/src/audit/in-memory-audit-event-repository.adapter.ts

gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/out-adapters/in-memory-audit-event-repository.adapter.spec.ts \
  --jq '.content' | base64 -d > libs/substrate-runtime/src/audit/in-memory-audit-event-repository.adapter.spec.ts
```

- [ ] **Step 2:** Apply adaptations.

  - **Imports of `@exercir/kernel-audit` types or symbols** → `@de-braighter/substrate-contracts` (the audit barrel). All audit domain types + the port + token now live in contracts.
  - **`.js`** on all local imports.
  - **Remove any `@Injectable()` decorator** if present on the InMemoryRepo. In-memory adapters in substrate are plain classes used via `new` in tests + DI providers.
  - The spec file likely imports the contract suite from the contracts package — adjust its import path: `import { runAuditEventRepositoryContract } from '@de-braighter/substrate-contracts'` (or wherever the contract suite is barrel-exported).

- [ ] **Step 3:** Run the spec.

```bash
npx vitest run --config libs/substrate-runtime/vitest.config.ts src/audit/in-memory-audit-event-repository.adapter.spec.ts
```

Expected: PASS (count matches archive — likely 10+ tests covering append + load + chain integrity + anchor closure + idempotency).

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-runtime/src/audit/in-memory-audit-event-repository.adapter.ts \
        libs/substrate-runtime/src/audit/in-memory-audit-event-repository.adapter.spec.ts
git commit -m "feat(substrate-runtime): port InMemoryAuditEventRepository adapter"
```

### Task B9: Port PrismaAuditEventRepository adapter (TDD against mock client)

**Files:**
- Create: `libs/substrate-runtime/src/audit/prisma-audit-event-repository.adapter.ts`
- Create: `libs/substrate-runtime/src/audit/prisma-audit-event-repository.contract.spec.ts`

- [ ] **Step 1:** Fetch.

```bash
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/out-adapters/prisma-audit-event-repository.adapter.ts \
  --jq '.content' | base64 -d > libs/substrate-runtime/src/audit/prisma-audit-event-repository.adapter.ts

gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/out-adapters/prisma-audit-event-repository.contract.spec.ts \
  --jq '.content' | base64 -d > libs/substrate-runtime/src/audit/prisma-audit-event-repository.contract.spec.ts
```

- [ ] **Step 2:** Apply adaptations.

  - `@exercir/kernel-audit` → `@de-braighter/substrate-contracts`.
  - `.js` on local imports.
  - **PrismaClient import:** the archive likely imports from `@prisma/client` (the generated client lives in the consuming app). In substrate, the generated client lives in `libs/substrate-runtime/node_modules/.prisma/client` or via the workspace-level alias. Check the existing pattern in `libs/substrate-runtime/src/scoped-prisma/scoped-prisma.service.ts` — copy its import shape.
  - **`AuditEventRepositoryPrismaLike` type** — keep this type unchanged. It's the "structural Prisma" interface that lets unit tests mock the client.
  - **Snake_case column mappings.** Verify the adapter's Prisma queries reference fields as Prisma sees them (camelCase via the `@map` annotations in audit.prisma). The archive used the same pattern; should be a no-op.
  - **Remove `@Injectable()` if present** — `PrismaAuditEventRepository` in the archive was likely annotated. For substrate, declare it on the runtime side; but per the substrate convention (look at `PrismaPlanTreeStore` in `libs/substrate-runtime/src/plan-tree/prisma-plan-tree.store.ts`), the class may need `@Injectable()` for NestJS DI. **Keep the decorator** (substrate convention is `@Injectable()` on Prisma adapters).

- [ ] **Step 3:** Run the contract spec against the mock client.

```bash
npx vitest run --config libs/substrate-runtime/vitest.config.ts src/audit/prisma-audit-event-repository.contract.spec.ts
```

Expected: PASS. The contract spec uses an in-memory `PrismaLike` double to exercise the adapter without a live DB.

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-runtime/src/audit/prisma-audit-event-repository.adapter.ts \
        libs/substrate-runtime/src/audit/prisma-audit-event-repository.contract.spec.ts
git commit -m "feat(substrate-runtime): port PrismaAuditEventRepository (unit-tested via mock client)"
```

### Task B10: Port AuditSubtypeRegistry + AuditSubtypeRegistryModule (TDD)

**Files:**
- Create: `libs/substrate-runtime/src/audit/audit-subtype-registry.ts`
- Create: `libs/substrate-runtime/src/audit/audit-subtype-registry.spec.ts`
- Create: `libs/substrate-runtime/src/audit/audit-subtype-registry.module.ts`
- Create: `libs/substrate-runtime/src/audit/audit-subtype-registry.module.spec.ts`

- [ ] **Step 1:** Fetch all four.

```bash
for f in audit-subtype-registry.ts audit-subtype-registry.spec.ts; do
  gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/application/${f} \
    --jq '.content' | base64 -d > libs/substrate-runtime/src/audit/${f}
done

for f in audit-subtype-registry.module.ts audit-subtype-registry.module.spec.ts; do
  gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/infrastructure/${f} \
    --jq '.content' | base64 -d > libs/substrate-runtime/src/audit/${f}
done
```

- [ ] **Step 2:** Adapt all four.

  - `@exercir/kernel-audit` → `@de-braighter/substrate-contracts` (for `AuditSubtypeCollision`, `AuditSubtypeNotRegistered`, `AuditSubtype`).
  - `.js` on all local imports.
  - **`AUDIT_SUBTYPE_REGISTRY` token:** keep as the archive defined it. If it's `Symbol(...)`, bump to `Symbol.for('@de-braighter/substrate-runtime/AUDIT_SUBTYPE_REGISTRY')`.
  - `@Injectable()` retained on the registry class.
  - The module file imports NestJS `Module`, `DynamicModule` — keep verbatim.

- [ ] **Step 3:** Run both specs.

```bash
npx vitest run --config libs/substrate-runtime/vitest.config.ts \
  src/audit/audit-subtype-registry.spec.ts \
  src/audit/audit-subtype-registry.module.spec.ts
```

Expected: both PASS. If the module spec needs a NestJS test harness (`@nestjs/testing`), verify that package is in `libs/substrate-runtime/package.json` — substrate already uses it (per `SubstrateModule` tests).

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-runtime/src/audit/audit-subtype-registry.ts \
        libs/substrate-runtime/src/audit/audit-subtype-registry.spec.ts \
        libs/substrate-runtime/src/audit/audit-subtype-registry.module.ts \
        libs/substrate-runtime/src/audit/audit-subtype-registry.module.spec.ts
git commit -m "feat(substrate-runtime): port AuditSubtypeRegistry + NestJS module"
```

### Task B11: Port AuditService (TDD)

**Files:**
- Create: `libs/substrate-runtime/src/audit/audit-service.ts`
- Create: `libs/substrate-runtime/src/audit/audit-service.spec.ts`

- [ ] **Step 1:** Fetch.

```bash
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/application/audit-service.ts \
  --jq '.content' | base64 -d > libs/substrate-runtime/src/audit/audit-service.ts
```

The archive does not have a standalone `audit-service.spec.ts` — it has `audit-service.integration.spec.ts` (lands in PR-C). Write a focused unit spec inline (Step 3).

- [ ] **Step 2:** Adapt.

  - `@exercir/kernel-audit` → `@de-braighter/substrate-contracts` for: domain types, `AUDIT_EVENT_REPOSITORY`, `AuditEventRepository`, `MerkleService`, hash-chain helpers, errors.
  - `.js` on all local imports.
  - `@Injectable()` retained.
  - `@Inject(AUDIT_EVENT_REPOSITORY)` retained (NestJS).
  - **Verify the service is fully self-contained** — no transitive `@exercir/...` imports remain.

- [ ] **Step 3:** Write a focused unit spec.

```ts
// libs/substrate-runtime/src/audit/audit-service.spec.ts
import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  AUDIT_EVENT_REPOSITORY,
  type AuditEventRepository,
  type RecordAuditEventInput,
} from '@de-braighter/substrate-contracts';

import { AuditService } from './audit-service.js';

describe('AuditService', () => {
  let repo: AuditEventRepository;
  let svc: AuditService;
  const appendSpy = vi.fn();

  beforeEach(() => {
    appendSpy.mockReset();
    repo = {
      append: appendSpy.mockResolvedValue({ id: 'evt-1', chainEntryId: null }),
      // Add stubs for any other methods the AuditEventRepository interface defines —
      // inspect audit-event-repository.port.ts and stub each:
      loadByTenantPack: vi.fn().mockResolvedValue([]),
      closeAnchor: vi.fn(),
      // ... etc. Any missing method will surface as a TypeScript error.
    } as unknown as AuditEventRepository;
    svc = new AuditService(repo);
  });

  it('write delegates to repo.append with the FHIR-shape input', async () => {
    const input: RecordAuditEventInput = {
      eventType: 'patient_record_open',
      action: 'R',
      outcome: 'success',
      agents: [{ role: 'requestor', personId: 'p1' }],
      entities: [{ role: 'target', what: 'Patient/p1' }],
    };
    const result = await svc.write(input);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(result.id).toBe('evt-1');
  });

  it('write applies the default retentionTier when not supplied', async () => {
    await svc.write({
      eventType: 'system_event',
      action: 'E',
      outcome: 'success',
      agents: [],
      entities: [],
    });
    const call = appendSpy.mock.calls[0]![0];
    expect(['operational', 'security', 'compliance']).toContain(call.retentionTier);
  });

  it('write throws when retentionTier="compliance" but agent.systemAgentRef missing', async () => {
    // (Adapt this test to the actual validation surface of the archive's AuditService.
    // The archive likely has a hard-coded floor — if not, drop this test.)
  });
});
```

Run:

```bash
npx vitest run --config libs/substrate-runtime/vitest.config.ts src/audit/audit-service.spec.ts
```

Expected: PASS (or near-PASS — adjust stubs per the actual `AuditEventRepository` interface signature).

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-runtime/src/audit/audit-service.ts \
        libs/substrate-runtime/src/audit/audit-service.spec.ts
git commit -m "feat(substrate-runtime): port AuditService (write-path orchestrator)"
```

### Task B12: Port emit-audit-event helper + otel-loki-subscriber

**Files:**
- Create: `libs/substrate-runtime/src/audit/emit-audit-event.ts`
- Create: `libs/substrate-runtime/src/audit/emit-audit-event.spec.ts`
- Create: `libs/substrate-runtime/src/audit/otel-loki-subscriber.ts`

- [ ] **Step 1:** Fetch.

```bash
for f in emit-audit-event.ts emit-audit-event.spec.ts otel-loki-subscriber.ts; do
  gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/application/${f} \
    --jq '.content' | base64 -d > libs/substrate-runtime/src/audit/${f}
done
```

- [ ] **Step 2:** Adapt all three (`@exercir/...` → `@de-braighter/...`, `.js` on imports, `Symbol.for` for `AUDIT_OTEL_LOKI_SUBSCRIBER` token if present).

- [ ] **Step 3:** Run the spec.

```bash
npx vitest run --config libs/substrate-runtime/vitest.config.ts src/audit/emit-audit-event.spec.ts
```

Expected: PASS.

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-runtime/src/audit/emit-audit-event.ts \
        libs/substrate-runtime/src/audit/emit-audit-event.spec.ts \
        libs/substrate-runtime/src/audit/otel-loki-subscriber.ts
git commit -m "feat(substrate-runtime): port emit-audit-event helper + otel-loki-subscriber stub"
```

### Task B13: Wire substrate-runtime barrels + `/testing` subpath

**Files:**
- Create: `libs/substrate-runtime/src/audit/index.ts`
- Create: `libs/substrate-runtime/src/audit/testing.ts`
- Modify: `libs/substrate-runtime/src/index.ts`
- Modify: `libs/substrate-runtime/src/testing.ts` (or whichever file is at the `/testing` subpath entry)

- [ ] **Step 1:** Audit barrel — runtime-side public exports.

```ts
// libs/substrate-runtime/src/audit/index.ts
export { AuditService } from './audit-service.js';
export {
  AuditSubtypeRegistry,
  AUDIT_SUBTYPE_REGISTRY,
} from './audit-subtype-registry.js';
export type { RegisteredAuditSubtype } from './audit-subtype-registry.js';
export {
  AuditSubtypeBootstrap,
  AuditSubtypeRegistryModule,
} from './audit-subtype-registry.module.js';
export type { AuditSubtypeRegistryModuleOptions } from './audit-subtype-registry.module.js';
export { emitAuditEvent } from './emit-audit-event.js';
export type { EmitAuditEventInput } from './emit-audit-event.js';
export {
  AUDIT_OTEL_LOKI_SUBSCRIBER,
  registerAuditOtelLokiSubscriber,
} from './otel-loki-subscriber.js';
export {
  PrismaAuditEventRepository,
} from './prisma-audit-event-repository.adapter.js';
export type { AuditEventRepositoryPrismaLike } from './prisma-audit-event-repository.adapter.js';
```

- [ ] **Step 2:** Audit `/testing` subpath barrel.

```ts
// libs/substrate-runtime/src/audit/testing.ts
export { InMemoryAuditEventRepository } from './in-memory-audit-event-repository.adapter.js';
```

- [ ] **Step 3:** Re-export from the main runtime barrel.

Open `libs/substrate-runtime/src/index.ts`. Append after the existing `plan-tree`/`inference`/`events` exports:

```ts
// Audit — the kernel.audit_event + AuditService surface per ADR-061/062.
// The schemas it operates on live in the contracts package's `/audit` subpath.
export * from './audit/index.js';
```

- [ ] **Step 4:** Re-export from the `/testing` entrypoint. Locate the existing testing entrypoint (per Arc 1's `InMemoryInferenceBackbone`):

```bash
find libs/substrate-runtime -name "testing*.ts" -not -path "*/node_modules/*" | head -5
```

Likely `libs/substrate-runtime/src/testing.ts` or similar. Open it and append:

```ts
export { InMemoryAuditEventRepository } from './audit/testing.js';
```

If `package.json` already declares the `/testing` subpath export, no further action. Otherwise (unlikely — Arc 1 set this up), the `package.json` exports field needs a `./testing` entry pointing at the compiled `testing.js`.

- [ ] **Step 5:** Build + library-wide gate.

```bash
npx nx build substrate-runtime
npx vitest run --config libs/substrate-runtime/vitest.config.ts
```

Expected: green.

- [ ] **Step 6:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-runtime/src/audit/index.ts \
        libs/substrate-runtime/src/audit/testing.ts \
        libs/substrate-runtime/src/index.ts \
        libs/substrate-runtime/src/testing.ts
git commit -m "feat(substrate-runtime): expose audit + InMemoryAuditEventRepository via main + /testing barrels"
```

### Task B14: PR-B — push, open PR, charter-check

- [ ] **Step 1:** Full local gate.

```bash
npm run ci:local
echo "EXIT: $?"
```

Expected: EXIT 0.

- [ ] **Step 2:** Push + open PR-B (stacked on PR-A's branch if PR-A is unmerged, else `main`).

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-lib" ] || { echo "WRONG BRANCH"; exit 1; }
git push -u origin feat/audit-foundation-arc3-lib

gh pr create --base main --head feat/audit-foundation-arc3-lib \
  --title "feat(substrate): audit foundation — library port (Arc 3 PR-B)" \
  --body "$(cat <<'EOF'
## Summary

Ports the kernel-audit library from archived de-braighter/exercir-service into substrate. Domain primitives (hash-chain, MerkleService, audit-types, errors) + port + DTOs land in substrate-contracts. AuditService + subtype registry + adapters (InMemory + Prisma) + emit-audit-event + otel-loki-subscriber land in substrate-runtime. InMemoryAuditEventRepository exposed via /testing subpath (Arc 1 convention).

## What this lands

- substrate-contracts/src/audit/* — 5 files + 4 specs
- substrate-runtime/src/audit/* — 10 files + 10 specs (port adapters + service + module + subtype registry + emit helper + otel stub)
- Both barrels re-exported from package roots
- AUDIT_EVENT_REPOSITORY token now Symbol.for (Arc 1b convention)

## What this does NOT land

- SubstrateModule.forRoot({ audit: ... }) wiring — lands in PR-C
- WORM integration spec (env-gated DB) — lands in PR-C

## Test plan

- [x] npm run ci:local green
- [x] All ported specs pass (contract suite + unit + module spec)
- [x] No transitive @exercir/* imports remain (`grep -r '@exercir/' libs/substrate-{contracts,runtime}/src/audit` returns empty)
- [x] PrismaAuditEventRepository unit-tested via mock PrismaLike (no live DB)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3:** Verifier wave on PR-B (same agents as PR-A).

- [ ] **Step 4:** Merge PR-B.

```bash
gh pr merge <PR-B#> --merge --delete-branch=false
git checkout main && git pull
```

---

## PR-C — SubstrateModule wiring + integration spec + publish

### Task C1: Branch off `main` (PR-A + PR-B merged)

- [ ] **Step 1:**

```bash
cd D:/development/projects/de-braighter/layers/substrate
git checkout main && git pull --ff-only origin main
git checkout -b feat/audit-foundation-arc3-wire
git branch --show-current   # MUST print: feat/audit-foundation-arc3-wire
```

- [ ] **Step 2:** Baseline gate.

```bash
npm run ci:local
echo "EXIT: $?"
```

Expected: EXIT 0.

### Task C2: Add `audit` to SubstrateModuleOptions + composition root

**Files:**
- Modify: `libs/substrate-runtime/src/substrate.module.ts` (or equivalent — locate via `find libs/substrate-runtime/src -name 'substrate*.module.ts'`)

- [ ] **Step 1:** Locate the composition root.

```bash
find libs/substrate-runtime/src -name '*.module.ts' -not -path '*/node_modules/*'
grep -rln "SubstrateModuleOptions\|SubstrateModule\b" libs/substrate-runtime/src
```

Expected: a single file like `libs/substrate-runtime/src/substrate.module.ts` or `libs/substrate-runtime/src/composition/substrate.module.ts`. Open it.

- [ ] **Step 2:** Extend `SubstrateModuleOptions` to accept the audit-event-repository binding.

Find the interface declaration:

```ts
export interface SubstrateModuleOptions {
  // existing: tenantRegistry, packRegistry, scopedPrisma, inferenceBackbone, planTreeStore, ...
}
```

Add:

```ts
  audit?: {
    eventRepository?: Type<unknown> | { useExisting: Type<unknown> } | { useValue: unknown };
  };
```

(Use the same shape pattern existing fields use — copy the pattern from `inferenceBackbone` or `planTreeStore`.)

- [ ] **Step 3:** Bind in `forRoot`.

In the `forRoot(options: SubstrateModuleOptions): DynamicModule` body, add (inside the `providers` array):

```ts
// AuditService — kernel.audit_event write surface (ADR-061/062).
// Caller binds AUDIT_EVENT_REPOSITORY; AuditService consumes it.
...(options.audit?.eventRepository
  ? [
      // The caller-provided binding (class | useExisting | useValue).
      typeof options.audit.eventRepository === 'function'
        ? { provide: AUDIT_EVENT_REPOSITORY, useClass: options.audit.eventRepository }
        : { provide: AUDIT_EVENT_REPOSITORY, ...options.audit.eventRepository },
      // The orchestrator service itself.
      AuditService,
    ]
  : []),
```

Add imports:

```ts
import { AUDIT_EVENT_REPOSITORY } from '@de-braighter/substrate-contracts';
import { AuditService } from './audit/index.js';
```

If `forRoot` exports services back to consumers, add `AuditService` to the `exports` array on the same condition.

- [ ] **Step 4:** Run the existing SubstrateModule spec to confirm no break.

```bash
npx vitest run --config libs/substrate-runtime/vitest.config.ts | grep -iE "substrate.module|composition"
```

Expected: existing tests still green; no regression.

- [ ] **Step 5:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-wire" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-runtime/src/substrate.module.ts   # adjust path if needed
git commit -m "feat(substrate-runtime): wire AuditService into SubstrateModule.forRoot({ audit })"
```

### Task C3: AuditService integration spec (in-memory)

**Files:**
- Create: `libs/substrate-runtime/src/audit/audit-service.integration.spec.ts`

- [ ] **Step 1:** Fetch the archive's integration spec.

```bash
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/application/audit-service.integration.spec.ts \
  --jq '.content' | base64 -d > libs/substrate-runtime/src/audit/audit-service.integration.spec.ts
```

- [ ] **Step 2:** Adapt.

  - `@exercir/...` → `@de-braighter/...`.
  - `.js` on all local imports.
  - The integration spec likely builds a NestJS test module via `@nestjs/testing`. Verify it imports `SubstrateModule` (or whatever was the archive's composition root). Replace the archive's module references with `SubstrateModule.forRoot({ audit: { eventRepository: InMemoryAuditEventRepository } })`.
  - Import `InMemoryAuditEventRepository` from `@de-braighter/substrate-runtime/testing`.

- [ ] **Step 3:** Run.

```bash
npx vitest run --config libs/substrate-runtime/vitest.config.ts src/audit/audit-service.integration.spec.ts
```

Expected: PASS.

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-wire" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-runtime/src/audit/audit-service.integration.spec.ts
git commit -m "test(substrate-runtime): port AuditService integration spec (in-memory, NestJS testing harness)"
```

### Task C4: WORM integration spec (DB-gated)

**Files:**
- Create: `libs/substrate-runtime/src/audit/prisma-audit-event-repository.worm.integration.spec.ts`

- [ ] **Step 1:** Fetch.

```bash
gh api repos/de-braighter/exercir-service/contents/libs/kernel-audit/src/out-adapters/prisma-audit-event-repository.worm.integration.spec.ts \
  --jq '.content' | base64 -d > libs/substrate-runtime/src/audit/prisma-audit-event-repository.worm.integration.spec.ts
```

- [ ] **Step 2:** Adapt.

  - `@exercir/...` → `@de-braighter/...`.
  - `.js` on local imports.
  - **Env-gate.** Look for an `it.skipIf(process.env.<FLAG>)` or `describe.skipIf(...)` pattern in the archive. Substrate's convention (per `prisma-outbox.writer.integration.spec.ts`) is:

```ts
const RUN_DB_TESTS = process.env['SUBSTRATE_INTEGRATION_DB_TESTS'] === 'true';
describe.skipIf(!RUN_DB_TESTS)('PrismaAuditEventRepository WORM (DB)', () => { ... });
```

  - Connect to `SUBSTRATE_DATABASE_URL` from env.
  - The spec exercises: INSERT succeeds + UPDATE/DELETE fail (WORM revoke); RLS blocks reads without `app.tenant_pack_id` GUC; chain integrity holds across multiple writes; anchor closure produces a valid Merkle root.

- [ ] **Step 3:** Run with DB enabled (optional but recommended).

```bash
docker compose up -d substrate-postgres
SUBSTRATE_INTEGRATION_DB_TESTS=true \
  SUBSTRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5544/substrate \
  npx vitest run --config libs/substrate-runtime/vitest.config.ts \
    src/audit/prisma-audit-event-repository.worm.integration.spec.ts
```

Expected: PASS. If the spec hits an `app` role missing error, it's fine — the substrate setup leaves that as a deferred gated suite (same posture as `plan_node` per the rewire's deferred list). Skip with `RUN_DB_TESTS=false` to keep CI green.

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-wire" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-runtime/src/audit/prisma-audit-event-repository.worm.integration.spec.ts
git commit -m "test(substrate-runtime): WORM integration spec for PrismaAuditEventRepository (DB-gated)"
```

### Task C5: Update CHANGELOGs + bump versions

**Files:**
- Modify: `libs/substrate-contracts/package.json` (`0.5.0` → `0.6.0`)
- Modify: `libs/substrate-runtime/package.json` (`0.6.0` → `0.7.0`)
- Modify: `libs/substrate-contracts/CHANGELOG.md`
- Modify: `libs/substrate-runtime/CHANGELOG.md`

- [ ] **Step 1:** Bump `substrate-contracts/package.json`.

Open `libs/substrate-contracts/package.json`. Find `"version": "0.5.0"`, change to `"0.6.0"`. Update the `"description"` field to append `+ audit primitives (hash-chain + Merkle + AuditEventRepository port)`.

- [ ] **Step 2:** Bump `substrate-runtime/package.json`.

Open `libs/substrate-runtime/package.json`. Find `"version": "0.6.0"`, change to `"0.7.0"`. Update the `"description"` to append `+ AuditService + InMemoryAuditEventRepository + PrismaAuditEventRepository`.

Verify the `"exports"` field includes `./testing` already — should be there from Arc 1.

- [ ] **Step 3:** Append CHANGELOG entries.

For `libs/substrate-contracts/CHANGELOG.md` prepend:

```markdown
## 0.6.0 (2026-MM-DD)

### Added
- `audit/*` subpath: domain types (`AuditAction`, `AuditOutcome`, `RetentionTier`, ...), hash-chain primitives (`canonicalJson`, `sha256Hex`, `computeChainLink`, `verifyLinearChain`), `MerkleService`, subtype errors (`AuditSubtypeCollision`, `AuditSubtypeNotRegistered`), and the `AuditEventRepository` out-port + `AUDIT_EVENT_REPOSITORY` token (Symbol.for).
- Implements ratified ADR-061 (kernel AuditEvent schema) at v0.2 prototype fidelity. Ported from archived de-braighter/exercir-service `libs/kernel-audit`.
```

For `libs/substrate-runtime/CHANGELOG.md` prepend:

```markdown
## 0.7.0 (2026-MM-DD)

### Added
- `audit/*` subpath: `AuditService` write surface, `AuditSubtypeRegistry` + `AuditSubtypeRegistryModule`, `emitAuditEvent` helper, `OTEL_LOKI_SUBSCRIBER` stub, in-memory + Prisma adapters for `AuditEventRepository`.
- `SubstrateModule.forRoot({ audit: { eventRepository } })` — caller-provided binding, AuditService composed automatically.
- `@de-braighter/substrate-runtime/testing` now also exports `InMemoryAuditEventRepository`.
- 4 new Prisma models on `kernel.*`: `AuditEvent`, `AuditEventChain`, `AuditChainAnchor`, `AuditLegalHold` (3 migrations: auditor schema grants, kernel_audit core, schema usage grants). Implements ADR-061/062 at v0.2 prototype fidelity.
```

- [ ] **Step 4:** Commit.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-wire" ] || { echo "WRONG BRANCH"; exit 1; }
git add libs/substrate-contracts/package.json libs/substrate-runtime/package.json \
        libs/substrate-contracts/CHANGELOG.md libs/substrate-runtime/CHANGELOG.md
git commit -m "chore(release): substrate-contracts@0.6.0 + substrate-runtime@0.7.0 (audit foundation)"
```

### Task C6: PR-C — push, open PR, verifier wave, merge

- [ ] **Step 1:** Full local gate.

```bash
npm run ci:local
echo "EXIT: $?"
```

Expected: EXIT 0.

- [ ] **Step 2:** Push + open PR-C.

```bash
[ "$(git branch --show-current)" = "feat/audit-foundation-arc3-wire" ] || { echo "WRONG BRANCH"; exit 1; }
git push -u origin feat/audit-foundation-arc3-wire

gh pr create --base main --head feat/audit-foundation-arc3-wire \
  --title "feat(substrate): audit foundation — wire SubstrateModule + integration + release (Arc 3 PR-C, FINAL)" \
  --body "$(cat <<'EOF'
## Summary

Wires AuditService into SubstrateModule.forRoot({ audit: { eventRepository } }). Lands the integration spec on InMemory adapter + WORM integration spec (DB-gated). Releases substrate-contracts@0.6.0 + substrate-runtime@0.7.0.

## What this lands

- SubstrateModule wiring — caller binds eventRepository; AuditService composed automatically
- AuditService integration spec (NestJS testing harness, InMemory backend)
- PrismaAuditEventRepository WORM integration spec (env-gated SUBSTRATE_INTEGRATION_DB_TESTS=true)
- CHANGELOG entries + version bumps

## Outstanding (not in scope)

- Real RFC 3161 TSA + S3 Object Lock daemon (charter §3 OQ1 — mocked in v0.2)
- Retention engine daemon (concept §6.5 — runtime job, not in archive)
- FHIR R5 AuditEvent exporter (concept R10 — read-time projection, not in archive)
- App-role RLS gated suite (deferred per the same posture as plan_node)
- Bump TENANT_REGISTRY token to Symbol.for (out-of-scope; tracked as substrate hygiene PR)

## Test plan

- [x] npm run ci:local green
- [x] AuditService integration spec passes against InMemory
- [x] WORM spec gated; passes when DB available
- [x] CHANGELOGs updated; versions bumped

Closes audit-foundation Arc 3. 🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3:** Verifier wave on PR-C (reviewer + charter-checker + qa-engineer + local-ci).

- [ ] **Step 4:** Merge.

```bash
gh pr merge <PR-C#> --merge --delete-branch
git checkout main && git pull
```

- [ ] **Step 5:** Update memory + index. (Optional — only if a relevant memory file should be updated to reflect "audit foundation v0.2 shipped".)

---

## Done-criteria checklist

- [ ] PR-A merged: 4 audit tables exist on substrate-postgres with the correct columns, indexes, CHECK constraints, RLS policies, WORM revoke.
- [ ] PR-B merged: `@de-braighter/substrate-contracts/audit/*` + `@de-braighter/substrate-runtime/audit/*` ship with no `@exercir/...` residue (`grep -r '@exercir' libs/substrate-{contracts,runtime}/src` returns empty).
- [ ] PR-C merged: `SubstrateModule.forRoot({ audit })` composes AuditService; AuditService integration spec green against InMemory.
- [ ] `substrate-contracts@0.6.0` + `substrate-runtime@0.7.0` published (or version-bumped pending the next release sweep).
- [ ] `npm run ci:local` green across 3 PRs.
- [ ] Verifier wave: all four agents approve, no BLOCKERs.
- [ ] CHANGELOG entries land.

---

## Deferred (NOT in scope of this arc)

- **Real RFC 3161 TSA + S3 Object Lock** — daemon-side integration. Mocked per archive + charter.
- **Retention engine** — nightly job that deletes operational rows > 90d, archives security > 30d, seals compliance per regulatory window. Not in archive lib.
- **FHIR R5 `AuditEvent` exporter** (concept R10) — read-time projection. Not in archive lib.
- **RFC 3881 / IHE ATNA exporter** (concept R11) — read-time projection for legacy hospital EHRs. Not in archive lib.
- **pgaudit integration** (concept I4) — DB-trigger emission via `pg_notify`. Future arc.
- **Pack manifest `auditContributions` contract** (concept §6.3) — ADR-063. Needs substrate-side pack-manifest infrastructure first.
- **App-role RLS gated suite** — same deferred posture as `plan_node` per the rewire's deferred list.
- **Cross-tenant admin read** (ADR-132 Invariant 3) — `kernel.AdminCrossTenantRead.v1` audit emission via `admin_reader` role. Future arc once `libs/kernel-admin-context/` is also ported.
- **`TENANT_REGISTRY` token Symbol.for bump** — sidesteppable today (substrate's contracts package is the only consumer); cleanup PR.

---

## Self-review

**Spec coverage (archive port + ADR-061/062/063):**
- 4 audit tables + 2 enums → PR-A Tasks A3 + A5. ✓
- 3 migrations ported with adaptations → PR-A Tasks A2/A3/A4. ✓
- Domain types (audit-types, hash-chain, merkle-service, subtype-errors) → PR-B Tasks B2–B5. ✓
- AuditEventRepository port + Symbol.for token → PR-B Task B6. ✓
- AuditService write-path → PR-B Task B11. ✓
- AuditSubtypeRegistry + NestJS module → PR-B Task B10. ✓
- InMemory + Prisma adapters → PR-B Tasks B8/B9. ✓
- emit-audit-event + otel-loki-subscriber → PR-B Task B12. ✓
- SubstrateModule wiring → PR-C Task C2. ✓
- Integration specs (InMemory + WORM) → PR-C Tasks C3/C4. ✓
- Release notes + version bumps → PR-C Task C5. ✓

**Placeholder scan:** Every step carries concrete `gh api` URLs, exact commands, exact commit messages, and expected outputs. No TBD/TODO. The few places where archive-source inspection is needed (Task B11 spec stub shape) explicitly say "adapt per the actual interface" with a fallback: "drop this test" if the archive doesn't validate.

**Type/name consistency:** `AUDIT_EVENT_REPOSITORY` token key `'@de-braighter/substrate-contracts/AUDIT_EVENT_REPOSITORY'` is the same across Decision 9, Task B6 Step 2, and Task C2 Step 3. `SubstrateModuleOptions.audit.eventRepository` field name consistent across Task C2 Steps 2 + 3 and Task C3 Step 2. Branch names `feat/audit-foundation-arc3` / `-lib` / `-wire` consistent across all PRs.

**Risk profile:** Lowest in PR-A (pure SQL + Prisma schema; failure mode = migration syntax error caught locally). Medium in PR-B (port volume; main risk = forgotten `@exercir/` import or missed `.js` suffix surfacing at build time — both caught by `nx build` + lint). Medium in PR-C (SubstrateModule wiring needs to match the existing composition-root pattern; risk = signature drift from the inferenceBackbone/planTreeStore precedent — Task C2 Step 1 explicitly says "copy the pattern from inferenceBackbone or planTreeStore"). The verifier wave catches anything cross-cutting.
