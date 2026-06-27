# Acquisition audit (2026-06-09) — remediation issue drafts + PR specs

Cold 6-auditor due-diligence panel + first-hand verification. Verdict **C+** (production-readiness). No fail-OPEN (cross-tenant leak) path was found — every tenant table is `ENABLE + FORCE` RLS; failure modes are breakage, not exfiltration. The recurring defect *pattern* is the risk: confident comments + green-but-vacuous tests + machinery for absent consumers let real defects ship green.

To file: `gh issue create --repo de-braighter/substrate --title "<title>" --body-file <section>.md` (or copy-paste).

---

## EPIC — Acquisition-grade audit (2026-06-09) — remediation tracker

Tracking issue. Code findings + tooling guardrails so the class doesn't recur.

**Code findings (this repo):** I1 ScopedPrismaService RLS evaporates · I3 refresh-rotation TOCTOU · I4 mapAuthError tenant-suspended→500 · I5 Beta collapse / ADR-154 stub · I7 SUBSTRATE_RLS_ENABLED no boot-guard
**Tooling guardrails:** PR1 switch-exhaustiveness · PR2 knip · PR3 DB/RLS tier in default gate
**Cross-repo follow-ups:** design-system (brick-registry dead machinery + lying comments; 79 components/~1 used) · foundation (`@de-braighter/std`+`lint-kit`+`test-kit` zero importers) · specs (ADR-110 #7≡#8 duplicate)

---

## I1 — [Important][security] ScopedPrismaService request-path RLS evaporates before the dependent query (fails CLOSED)

**File:** `libs/substrate-runtime/src/scoped-prisma/scoped-prisma.service.ts:70`; consumer `libs/substrate-runtime/src/idempotency/prisma-idempotency-key.repository.ts:45-53`.

`establishContext()` runs `set_config('app.tenant_pack_id',$1,true)` on the bare pooled client outside any transaction. `is_local=true` reverts at transaction end; in autocommit the standalone statement is its own one-statement tx, so the GUC is gone before the dependent query runs. Under the `app` role on FORCE-RLS `kernel.idempotency_key`, the SELECT matches zero rows and the INSERT is rejected by `WITH CHECK`.

**Direction:** fails CLOSED (breakage), NOT a leak. **Live?** latent — default idempotency binding is in-memory (`substrate.module.ts:1065`); the Prisma variant is documented-as-production (`:320-336`) but bound by no pack today. Activates when a customer follows the documented production binding.

**Fix:** route ScopedPrismaService through the same `$transaction` pattern as `GucPrismaRunner`, or demote/remove it. `PrismaLike` exposing only `$queryRawUnsafe` (no `$transaction`) makes correct use structurally impossible — that's the smell. Add the two-statement isolation test from PR3.

---

## I3 — [Important][security] Refresh-token rotation is non-atomic — TOCTOU race weakens reuse-detection

**Files:** `libs/substrate-runtime/src/auth/auth.service.ts:501-512`, `libs/substrate-runtime/src/auth/prisma-session.repository.ts:103-118`.

`create(successor)` then `markRotated()` are two non-transactional awaits; `markRotated` is an UNCONDITIONAL UPDATE (no `AND rotated_at IS NULL`) whose return is ignored; the reuse gate is on the earlier UNLOCKED read (`:456-469`). Two concurrent refreshes of the same token both pass `rotatedAt===null`, both mint successors, neither trips the theft response. The conditional-update idiom IS used in `revoke`/`revokeFamily` but omitted here.

**Direction:** fails closed (toward lockout). **Fix:** single conditional CAS — `UPDATE ... SET rotated_at=now(), rotated_to=$2 WHERE id=$1 AND rotated_at IS NULL RETURNING ...`; 0 rows updated ⇒ contention/reuse ⇒ deny. Add a concurrent-refresh test.

---

## I4 — [Important] mapAuthError drops reachable `tenant-suspended` → HTTP 500 (should be 403); switch not exhaustive

**File:** `libs/substrate-runtime/src/auth/http/auth-error-map.ts:56-117`.

`tenant-suspended` is declared (`auth.service.ts:93`) and returned by `selectTenant` (`:386`) but has no `case` → `default` → 500. A member of a suspended tenant gets 500 instead of 403, silently negating the slice-C1 feature. The header comment (`:51-53`) calls the function "total over the discriminated union" — false. `auth-error-map.spec.ts:61` enshrines the default-500.

**Fix:** add `case 'tenant-suspended' → 403`; replace the silent `default` with `assertNever(error: never)`. Caught permanently by PR1.

---

## I5 — [Important] Beta effect-composition collapses on `magnitudePrior=0` / non-finite; ADR-154 algebra stubbed

**File:** `libs/substrate-runtime/src/inference/math/beta-binomial.ts:45-69`.

`clamp01(successProp * magnitudePrior)`: `magnitudePrior===0` → `1e-9` ⇒ maximally-pessimistic prior from what a user writes as "no effect" (multiplicative identity is 1.0). `clamp01` returns 0.5 for non-finite ⇒ a NaN/Infinity magnitude is silently reset to uniform on a medical-grade path. The flat order-dependent rule matches none of ADR-154's commutative operators.

**Fix:** validate `magnitudePrior` finite & >0 at write time (typed error, not silent clamp); reconcile with ADR-154 `composeEffects` or annotate `// KNOWN-GAP(ADR-154)`.

---

## I7 — [Important][security] SUBSTRATE_RLS_ENABLED has no production boot-guard

**File:** `libs/substrate-runtime/src/scoped-prisma/rls-context.ts:59-61`.

Secure-by-default is good, but one `SUBSTRATE_RLS_ENABLED=false` (demo env copied to prod) no-ops the GUC for both paths. No boot assertion pairs "real app-role DB bound" with "RLS on" — unlike the dev-header shim which fails closed in prod (`substrate.module.ts:827-835`). Single point of total isolation failure (documented prior incident: `rls-context.ts:94-96`).

**Fix:** refuse to boot when `NODE_ENV==='production'` && `SUBSTRATE_RLS_ENABLED==='false'` && a real (non-in-memory) DB is bound.

---

## PR1 — [tooling] Enable `@typescript-eslint/switch-exhaustiveness-check` + ban `default` on unions

Add to `eslint.config.mjs` rules: `'@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: false, requireDefaultForNonUnion: true }]`. Fix the surfaced violations (at minimum I4: `auth-error-map.ts` — add the `tenant-suspended` case + `assertNever` default). Baseline-disable any large pre-existing clusters with a tracked TODO so the PR lands and NEW violations are caught. **Would have caught I4 at compile time.**

## PR2 — [tooling] Add `knip` to CI (enforce ADR-176 "demand-driven, never speculative")

Add `knip` devDep + `knip.json` + a `knip` npm script; wire as a CI step (report/baseline first — record current dead exports as a baseline, fail only on NEW unused exports, then ratchet). **Catches the speculative-generality class** (`std`/`lint-kit`/`test-kit` zero importers, `BrickKey`, `composes`).

## PR3 — [tooling] Run the DB/RLS isolation tier in the default `ci:local`; fail-not-skip on missing DB

The tier already exists (`ci:local:db` → `db:setup` + `test:db`; `01-create-roles.sql` provisions `app` as `NOSUPERUSER NOBYPASSRLS`). Gap: the default `ci:local` and `gate:prepush` don't invoke it, so the only real RLS isolation test (`prisma-run-manifest-repository.rls.integration.spec.ts`, `skipIf(!DATABASE_URL)`) never runs in normal/pre-push runs. **Changes:** (1) fold the DB tier into the default gate (or a `ci:local:full` the pre-push/CI runs); (2) make the global-setup **fail loudly** (not `skipIf`-skip) when it's supposed to run but the DB/role is absent; (3) assert the connecting role is `NOBYPASSRLS` (not superuser) at setup. Pairs with I1 — add a two-statement isolation test that exercises `ScopedPrismaService` (currently only `GucPrismaRunner` is tested).
