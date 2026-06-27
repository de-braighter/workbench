# O-6.2 — Adopt the WORM BEFORE-UPDATE/DELETE trigger on `kernel.audit_event*` (substrate#137)

> Foundry item `oncology/O-6.2` (T2). Scope repo `de-braighter/substrate`. Branch `feat/oncology-o-6-2`.
> This is a **design note + plan in one** — the right weight because the item ADOPTS an
> already-proven, already-designed pattern (health#5's WORM trigger) rather than introducing a
> new port/primitive. No new ADR (the design does not diverge from health's proven approach).

## Problem (substrate#137)

The published `PrismaAuditEventRepository` chain-append serialises concurrent appends with a
`SELECT … FROM kernel.audit_event_chain … FOR UPDATE` row lock (TOCTOU protection against a
stale `prev_hash`; adapter `appendChainRow`, lines ~373-382). `closeAnchor` takes the same lock
on `kernel.audit_chain_anchor` (line ~296).

In Postgres, **`SELECT … FOR UPDATE` requires the UPDATE privilege on the locked table.** The
shipped `kernel_audit` migration (`20260528122322_kernel_audit`, lines 239-259) implements WORM
purely by **grant** — `REVOKE UPDATE, DELETE … FROM PUBLIC` + `GRANT SELECT, INSERT` only to the
`app` role. So under the non-superuser `app` role, the security/compliance chain-append **raises
`permission denied for table audit_event_chain` (SQLSTATE 42501)** before it can take the lock.

This was never caught upstream because substrate's own `app`-role spec
(`prisma-audit-event-repository.worm-app-role.deferred.spec.ts`) only ever INSERTs **bare
operational rows**, which skip the chain entirely (operational tier → no `appendChainRow`). The
contract spec exercises the chain, but only under `SUBSTRATE_DATABASE_URL` = the **superuser**
(`postgres`), which BYPASSES grants — so the 42501 never surfaces there either.

## The fix (health#5's proven pattern, strictly stronger than grant-only WORM)

Health already proved the fix in `domains/health` (migration
`20260607140000_kernel_audit_worm_triggers`, ADR-222 §6 / B1 follow-up; reviewer CLEAN, 6 live-DB
probes). Adopt it verbatim into substrate's own audit layer:

1. **`GRANT UPDATE ON kernel.audit_event_chain, kernel.audit_event TO app`** — so the
   `FOR UPDATE` advisory row lock is *takeable*.
2. **A `BEFORE UPDATE OR DELETE` row trigger** (`kernel.audit_worm_guard()`) on both tables that
   `RAISE EXCEPTION … USING ERRCODE = 'insufficient_privilege'` — so a row can be **LOCKED but
   never MUTATED or DELETED**. A `BEFORE UPDATE OR DELETE` trigger does **not** fire on
   `SELECT … FOR UPDATE` (that takes a row lock without issuing an UPDATE statement), so the
   chain-append lock works while any actual mutation is rejected.
3. **Superuser is exempted** inside the trigger (`current_setting('is_superuser') = 'on'`) so the
   dev-container admin connection + the retention-engine 90d-window cleanup script can still run
   (the substrate convention: §WORM "deletes … happen via a vendor-admin script"). Returning the
   appropriate tuple (`NEW` for UPDATE, `OLD` for DELETE) lets the admin op PROCEED; returning
   NULL would silently SKIP it.

### Why a trigger beats grant-only WORM

- **It permits the legitimate `FOR UPDATE` lock** (the whole point — 42501 goes away under `app`).
- **It is strictly stronger:** the trigger blocks the table **OWNER and superuser too** by
  default (a REVOKE does not — owners/superusers bypass grants). We *deliberately* re-admit the
  superuser via the `is_superuser` branch (admin cleanup), but the `app` role — the runtime
  writer, the thing that actually writes the trail — can **never** UPDATE/DELETE a written audit
  row. The append-only legal guarantee now holds in the engine, not merely at the grant boundary.

### What is deliberately NOT trigger-locked

`kernel.audit_chain_anchor` — the adapter legitimately UPDATEs it on `closeAnchor`
(`merkle_root` / `verified_at` / TSA / S3-lock writeback) and takes its own `FOR UPDATE` lock
there. That table's design **is** mutable (the open-window anchor is closed in place). It keeps its
existing narrow column grants (`GRANT UPDATE (verified_at) … TO app` from the base migration), and
already has UPDATE priv for its own `FOR UPDATE` — so `closeAnchor` was never broken. Adding a
trigger there would break it. (Health made the identical carve-out.)

## Scope (hard boundary)

- **IN:** `libs/substrate-runtime/src/audit/` (test wiring to rely on the trigger) **and** the
  WORM-trigger migration under `prisma/migrations/` (explicitly owned by this item per its title:
  "the migration is outside `src/audit/` — owned by this item").
- **OUT:** everything else. The sibling O-6.1 worker owns
  `libs/substrate-runtime/src/adapters/field-encryption/` (disjoint) and owns no migration.

## Plan (TDD, tier-gated T2)

1. **Migration** `prisma/migrations/20260613xxxxxx_kernel_audit_worm_triggers/migration.sql` —
   adopt health's pattern verbatim (grant UPDATE to `app` on the two WORM tables + the
   `kernel.audit_worm_guard()` function + the two `BEFORE UPDATE OR DELETE` triggers). Self-
   documenting header (the design note travels with the migration, as health did). Idempotent
   (`DROP TRIGGER IF EXISTS`, `CREATE OR REPLACE FUNCTION`, role-guarded `GRANT`).

2. **Prove the chain-append now works under `app`** — the gap the item names. Extend the DB-gated
   `app`-role spec to drive a **security/compliance `appendEvent`** through
   `PrismaAuditEventRepository` under `SUBSTRATE_APP_DATABASE_URL` (the path that takes the
   `FOR UPDATE` chain lock). This is the RED test: against the base migration it fails with 42501;
   after the trigger migration it passes.

3. **Prove the trigger still blocks UPDATE/DELETE under `app`** — the existing
   `worm-app-role.deferred.spec.ts` UPDATE/DELETE-denied tests must stay green (now enforced by the
   trigger's `insufficient_privilege` RAISE rather than by the absent grant — the error code +
   message both still match `/permission denied/i`? **No** — the trigger's message is
   "append-only (WORM): UPDATE is not permitted". Update the assertions to match the trigger
   message while keeping the SQLSTATE-42501 semantics, OR assert on the SQLSTATE. Decide during
   impl against the actual thrown shape.)

4. **assertNonSuperuser floor obligation** — the DB suite MUST assert the connected `app` role is
   genuinely NOSUPERUSER (+ NOBYPASSRLS), so a misconfigured `SUBSTRATE_APP_DATABASE_URL` pointing
   at a superuser FAILS LOUD instead of false-passing (a superuser bypasses both the grant and the
   trigger's `is_superuser` branch). Add an `assertNonSuperuser` check in `beforeAll`.

5. **Quality (T2):** green `ci:local` (DB-free) + `ci:local:db` (DB tier — MANDATORY for a
   grant/trigger change); full verifier wave foreground; PR before wave; post-findings before any
   fix commit. `Producer: foundry-worker/claude-opus-4-8 [foundry-worker, designer-first]`,
   `Effort: deep`.

6. **LAND (T2 ship gate):** PR green + wave-clean + findings posted →
   `foundry_gate_request { productKey: oncology, gateType: ship }` and STOP. Never auto-merge.

## Reproducibility / migration-safety notes

- INSERT/DDL-only forward migration, no data backfill. Re-runnable (all statements idempotent).
- The trigger function lives in the `kernel` schema (matches the tables). `provider = postgresql`.
- Replay/run-manifest surfaces are untouched (this is a grant/trigger DDL change; no contract,
  no Ring-0, no published-package-API change → no version bump).
