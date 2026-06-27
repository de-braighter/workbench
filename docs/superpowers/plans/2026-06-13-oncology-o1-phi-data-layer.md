# Plan — Oncology O-1: PHI data layer (tumor/observation) + relation-graph activation

**Item:** `oncology/O-1` (foundry, T2). **Spec:** ADR-227 (ratified, specs#305). **Repo:**
`de-braighter/health`, worktree `domains/health/.claude/worktrees/oncology-o-1`, branch
`feat/oncology-o-1`, scope `libs/health-api/`. **Substrate already bumped to 2.1.0 (commit 4614222).**

## Goal

Land the first *related* PHI tables (`Patient → Tumor → Observation`), activate the field-encryption
relation graph (pass the live `PrismaClient` to `forRoot`), and prove nested-PHI encryption + RLS +
crypto-shred end-to-end against live Postgres under the `app` role — synthetic cohorts only, no real PHI.

## Load-bearing facts (verified against installed node_modules 2.1.0)

- `SubstrateModuleOptions.prismaClient?: PrismaLike` exists (substrate.module.d.ts:87) — the rewire target.
- `ColumnClass = 'identity' | 'staging' | 'genomics' | 'outcome'` (**`outcome` SINGULAR**). `blindIndex`
  valid ONLY for `'identity'`.
- Encrypted columns are Prisma `String` / `String?` (TEXT, holding a `CipherEnvelope` string) — never
  `Boolean`/`DateTime`. Mirrors `patient.name` / `patient.ahv`.
- Existing forRoot call (health-substrate.composition.ts) passes `{ keyProvider,
  fieldEncryptionRegistry, auditEventRepository? }` and NO `prismaClient` → EMPTY relation graph today.
- Existing RLS/migration pattern: `20260607120000_health_patient_phi` (ENABLE+FORCE RLS;
  `tenant_pack_isolation` policy `tenant_pack_id::text = current_setting('app.tenant_pack_id', true)`
  USING+WITH CHECK; `GRANT SELECT, INSERT, UPDATE` no-DELETE to `app`, gated on `IF EXISTS pg_roles app`).
- DB: `health-postgres` :5546 (up). DB tier runs via `vitest.db.config.ts` (`test:db`). `app` role is
  NOSUPERUSER + NOBYPASSRLS (`assertNonSuperuser` in setup). `db:setup` / `db:reset` provision.

## Schema (the design ADR-227 §1 commits)

`Tumor` (health schema): `id` uuid PK, `tenant_pack_id` uuid, `patient_id` uuid FK→Patient,
`created_at` timestamptz — all plaintext. Encrypted (`String`, TEXT): `primary_site_code`,
`laterality_code`, `histology_code`, `grade`, `clinical_t/n/m`, `stage_group` (**staging**, NOT NULL);
`pathological_t/n/m`, `er_status`, `pr_status`, `her2_status`, `diagnosis_date` (**staging**, nullable);
`brca_status` (**genomics**, nullable). `@@index([patientId])`. Patient gains `tumors Tumor[]`.

`Observation` (health schema): `id` uuid PK, `tenant_pack_id` uuid, `tumor_id` uuid FK→Tumor,
`created_at` timestamptz — plaintext. Encrypted (`String`, **outcome**): `observation_date`,
`observation_type`, `event_observed` (NOT NULL); `value_code`, `value_quantity`, `marker_code`
(nullable). `@@index([tumorId])`.

**No blind index on any new column** (ADR-227 §3). **No stored `duration_t`** — survival values are
derived at the O-3 read boundary (ADR-176 §4).

## Tasks (TDD; A→B→C sequential, D after C)

### Task A — schema + migration
Add the two models to `prisma/schema.prisma` (+ Patient back-relation). Write the forward migration
`prisma/migrations/<ts>_oncology_tumor_observation/migration.sql` mirroring the patient-PHI migration:
CREATE TABLE both (FKs, TEXT encrypted cols, `@@index` FKs); ENABLE+FORCE RLS; `tenant_pack_isolation`
policy on both; `GRANT SELECT,INSERT,UPDATE` (no DELETE) to `app`. **Acceptance:** `prisma validate` +
`prisma generate` clean; `db:setup` (or `prisma migrate deploy`) applies the migration clean to
health-postgres; the generated client exposes `Tumor`/`Observation`.

### Task B — registry + relation-graph rewire (load-bearing)
Extend the field-encryption registry (the `buildPatientFieldEncryptionRegistry` builder) to register
every encrypted Tumor + Observation field with its `ColumnClass` (`'staging'`/`'genomics'`/`'outcome'`;
none blind-indexed). Thread the live `PrismaClient`: add `prismaClient` to `HealthSubstrateConfig` +
`HealthSubstrateRootModule.forRoot`, pass `{ …, prismaClient }` into `SubstrateModule.forRoot`;
`composeHealthSubstrate` receives + forwards it. **Acceptance:** build green; a composition unit test
asserts `forRoot` accepts `prismaClient` and the registry reports Tumor + Observation registered with
the right classes.

### Task C — nested-PHI DB-gated proof (the O-1 deliverable) — runs under the `app` role, synthetic only
A `*.db.spec.ts` (vitest.db.config) that, with FABRICATED data:
1. Nested `patient.create({ data: { …, tumors: { create: [{ …, observations: { create: [...] } }] } } })`
   encrypts ALL PHI at every depth — **assert ciphertext at rest via a RAW SQL read** (bypassing the
   extension): `tumor.primary_site_code` / `observation.observation_date` hold a `CipherEnvelope` JSON,
   not plaintext.
2. Decrypt round-trip through the extension yields the original plaintext for nested fields.
3. Cross-tenant RLS isolation: nested rows under tenant A are invisible under tenant B's GUC scope.
4. **Fail-loud negative:** composing WITHOUT `prismaClient` (EMPTY graph) → a nested PHI write THROWS
   `FieldEncryptionError` (proves the rewire is load-bearing).
5. Crypto-shred: destroy the tenant DEK → nested ciphertext unrecoverable.
**Guardrails (anti-test-theater):** the suite MUST run under the `app` NOSUPERUSER+NOBYPASSRLS role
(`assertNonSuperuser` in setup — a superuser BYPASSRLS would false-pass §3); the at-rest assertion MUST
be a raw query (not the decrypting client); the fail-loud test MUST actually throw (assert the error).

### Task D — Stryker mutation-t2
Wire `foundation/test-kit` `defineStrykerConfig` (t2, `break:75`) + a `mutation` script on health-api;
add the `@stryker-mutator/*` dev deps (pnpm install — **needs the `.npmrc` MAX_PATH line still present**).
Targeted mutate the new pure surface (registry/composition). **Acceptance:** stryker runs; score ≥75 on
the targeted surface (or the config is correctly wired where the battery exists).

## Quality (Phase 4, after A–D)
`ci:local` + `ci:local:db` green; scope confinement (`git diff --name-only origin/main...HEAD` all under
`libs/health-api/` except the sanctioned root-lockfile + health-fhir/package.json bump); **revert the
`.npmrc` MAX_PATH line before the PR commit**. Open the health PR (Producer/Effort/Effect), full T2
verifier wave + findings ritual, then the T2 ship gate.
