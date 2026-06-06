# WS-6 — FHIR Eviction (relocate to `domains/health`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the entire FHIR runtime out of `@de-braighter/substrate-runtime` into a new `domains/health` repo (`@de-braighter/health-fhir`), leaving **zero** FHIR surface in the kernel — with no consumer migration (verified: nothing imports it).

**Architecture:** Three-part. **Part 1:** scaffold `domains/health` (single projection lib) and relocate the ~23 `src/fhir/` files, rewriting their relative kernel imports to published `@de-braighter/substrate-{contracts,runtime}` imports. **Part 2:** on the shared `release/1.0` branch, delete `src/fhir/` + its barrel exports from substrate-runtime. **Part 3:** publish train at the `substrate@1.0` cut (`@de-braighter/health-fhir@0.1.0` newly published; substrate-runtime major). No exercir re-point — exercir imports no FHIR symbol.

**Tech Stack:** TypeScript (ESM, `.js` extensions), NestJS (controllers/modules), Zod, Nx + vitest 4, pnpm workspace; the `/new-domain` scaffolder skill.

**Spec:** `docs/superpowers/specs/2026-06-06-ws6-fhir-eviction-design.md`.

---

## Pre-flight

Two independent work surfaces:

- **`domains/health`** — a brand-new repo (Part 1), its own git repo + PR. Scaffold via the **`/new-domain`** skill (the markets reference run), with the DB-persistence / inference-backbone / Angular-UI tiers **OFF** — v1 is a single projection library.
- **substrate `release/1.0`** — the deletion (Part 2), on the same `release/1.0` branch WS-3/WS-8 use. Gate: `npx vitest run`, `npx nx affected -t lint`, `npm run ci:local`. Never bypass pre-push hooks.

## File-structure map

**Part 1 — `domains/health` (new):**

| Path | Content |
|---|---|
| `domains/health/libs/health-fhir/src/` | the relocated `audit-event.projector.ts`, `plan-tree.projector.ts`, `fhir-export.service.ts`, `bulk-export.service.ts`, `in-memory-bulk-export-job.store.ts`, `fhir-audit-event.{controller,module}.ts`, `fhir-bulk-export.{controller,module}.ts`, `operation-outcome.exception-filter.ts`, `index.ts` (+ all `.spec.ts`) |
| `domains/health/libs/health-fhir/package.json` | `@de-braighter/health-fhir`, deps on `@de-braighter/substrate-{contracts,runtime}` |

**Part 2 — substrate (`release/1.0`):**

| File | Change |
|---|---|
| `libs/substrate-runtime/src/fhir/` | **Delete the directory** |
| `libs/substrate-runtime/src/index.ts` | Remove `export * from './fhir/index.js'` (`:181`) + the FHIR comment block (`:175–179`) + the gateable-module note (`:314`) |

---

## Part 1 — Stand up `domains/health` and relocate FHIR

### Task 1: Scaffold `domains/health` (single projection lib)

**Files:** new repo `domains/health`.

- [ ] **Step 1: Invoke `/new-domain`** for a domain named `health` with **only** the reusable-lib tier (no api, no DB, no inference, no UI). Confirm it produces a building, testing, pnpm-workspace-registered repo with one lib `health-fhir`.
- [ ] **Step 2: Set the package name + kernel deps** — `libs/health-fhir/package.json`:

```jsonc
{
  "name": "@de-braighter/health-fhir",
  "version": "0.1.0",
  "type": "module",
  "peerDependencies": {
    "@de-braighter/substrate-contracts": "^1.0.0",
    "@de-braighter/substrate-runtime": "^1.0.0"
  }
}
```

- [ ] **Step 3: Baseline green** — `npx nx build health-fhir && npx vitest run` in the empty lib. Expected: PASS. Commit the scaffold.

### Task 2: Map the FHIR files' kernel imports (no edits yet)

**Files:** none.

- [ ] **Step 1: Enumerate every relative kernel import in `src/fhir/`**

Run:

```bash
SUB=D:/development/projects/de-braighter/layers/substrate
git -C "$SUB" grep -nE "^import .* from '\.\./" -- 'libs/substrate-runtime/src/fhir/*.ts' | grep -v '.spec.ts'
```

- [ ] **Step 2: Map each to its published entry point** — relative imports of kernel *types/contracts* → `@de-braighter/substrate-contracts`; relative imports of runtime *services/decorators* → `@de-braighter/substrate-runtime`. Record the mapping. **Finding gate:** any kernel internal reached by `src/fhir/` that is **not** exported from either published package is a blocker — escalate (add to the published surface, or restructure the projector). List such cases before proceeding.

### Task 3: Relocate the files + rewrite imports

**Files:** copy `libs/substrate-runtime/src/fhir/*` → `domains/health/libs/health-fhir/src/`.

- [ ] **Step 1: Copy all `src/fhir/*.ts` (incl. specs)** into `health-fhir/src/`, preserving filenames. Make `health-fhir/src/index.ts` re-export what the old `fhir/index.ts` did.
- [ ] **Step 2: Rewrite imports** per Task 2's mapping — every `../<kernel>` → `@de-braighter/substrate-contracts` or `@de-braighter/substrate-runtime`. Intra-fhir relative imports (`./audit-event.projector.js` etc.) stay relative.
- [ ] **Step 3: Verify no relative escape remains**

Run: `git -C domains/health grep -nE "from '\.\./\.\./" -- 'libs/health-fhir/src/*.ts'`
Expected: **empty** (no import escapes the lib).

### Task 4: Green the relocated lib (TDD — the moved specs ARE the tests)

**Files:** `domains/health/libs/health-fhir/`.

- [ ] **Step 1: Run the relocated specs** — `npx vitest run` in `domains/health`. The moved `*.spec.ts` (audit-event projector, plan-tree projector, bulk-export, controllers, operation-outcome filter) must pass against the published kernel imports.
- [ ] **Step 2: Build** — `npx nx build health-fhir`. Expected: PASS, emits the package.
- [ ] **Step 3: Commit + open the `domains/health` PR**

```bash
git -C domains/health add -A
git -C domains/health commit -m "feat: health-fhir — relocate FHIR runtime from substrate kernel (WS-6/ADR-204)"
```

PR body carries `Producer:` + `Effect: cycle-time/findings`; links ADR-204, the WS-6 design, epic substrate#94.

---

## Part 2 — Delete FHIR from substrate-runtime (on `release/1.0`)

### Task 5: Remove the FHIR surface + barrel exports (TDD)

**Files:**

- Delete: `libs/substrate-runtime/src/fhir/` (whole directory)
- Modify: `libs/substrate-runtime/src/index.ts`

- [ ] **Step 1: Write the failing guard test** — `libs/substrate-runtime/src/no-fhir-surface.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as barrel from './index.js';

describe('WS-6: FHIR evicted from substrate-runtime', () => {
  it('exports no FHIR symbol', () => {
    const keys = Object.keys(barrel as Record<string, unknown>);
    expect(keys.filter((k) => /fhir/i.test(k))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run libs/substrate-runtime/src/no-fhir-surface.spec.ts`. Expected: FAIL (barrel still re-exports `./fhir/index.js`).
- [ ] **Step 3: Delete the directory + barrel lines** — remove `src/fhir/`; in `src/index.ts` delete `export * from './fhir/index.js'` (`:181`), the FHIR comment block (`:175–179`), and the gateable-module note (`:314`).
- [ ] **Step 4: Run to verify it passes + full runtime suite green** — `npx vitest run libs/substrate-runtime && npx nx affected -t lint --base=release/1.0`. Expected: PASS; no dangling imports (nothing else in the kernel imports `src/fhir/` — verify with `git grep "fhir/" libs/substrate-runtime/src`).
- [ ] **Step 5: Commit**

```bash
git add libs/substrate-runtime/src
git commit -m "feat(runtime)!: evict FHIR runtime to @de-braighter/health-fhir (WS-6/ADR-204)"
```

### Task 6: Confirm zero consumer breakage

**Files:** none.

- [ ] **Step 1: Re-verify no domain imports FHIR**

Run: `for d in exercir conservation herdbook markets; do git -C D:/development/projects/de-braighter/domains/$d grep -nE "import .*[Ff]hir|FhirExportService|FhirAuditEvent|BulkExport" -- '*.ts' 2>/dev/null | grep -v '.spec.ts'; done`
Expected: **empty** (exercir's `fhirMapping: z.string()` field is a string, not an import — leave it untouched). If anything appears, it is a consumer that must adopt `@de-braighter/health-fhir` — escalate.

- [ ] **Step 2: WS-6 migration-guide section** — append to `docs/migration-substrate-1.0.md`: "FHIR removed from `@de-braighter/substrate-runtime`; consumers needing FHIR export adopt `@de-braighter/health-fhir`. No current consumer is affected." Commit.

---

## Part 3 — Publish train (at the `substrate@1.0` cut, substrate#92)

- [ ] **Step 1:** Publish `@de-braighter/health-fhir@0.1.0` from `domains/health` (after its PR merges).
- [ ] **Step 2:** The substrate-runtime FHIR removal lands in the coordinated `substrate@1.0` **major** (with WS-3 + WS-8). No consumer adopts `health-fhir` yet — the `fhirMapping` binding is deferred.
- [ ] **Step 3:** File the ADR-204 OQ-4 **deletion-trigger** note on `domains/health`: "zero consumers today; if the deferred `fhirMapping` binding is never built, `health-fhir` is a deletion candidate."

---

## Self-review

**Spec coverage:** §3 surface (relocate 23 files / delete dir + barrel) → Tasks 3/5. §4 new-repo decision → Task 1. §5 import rewrite → Tasks 2/3. §6 invariants (kernel AuditEvent untouched; only FHIR projection moves; gateable modules so no default-surface break) → Task 5 Step 4 + Task 6. §7 release mechanics (major bump; health-fhir@0.1.0; no adopt) → Part 3. §2 no-live-consumer finding → Task 6 (re-verify) + Part 3 Step 3 (deletion trigger). §8 ownership → headers. §9 sub-decisions → Task 1 (single lib), Part 3 (relocate-not-delete).

**Placeholder scan:** Task 2 is an explicit *discovery* step (enumerate-then-map) with the grep + mapping rule + a finding gate, not a vague "fix imports." The exact import list is data discovered at execution, not a design choice. All deletions name exact files/lines.

**Type consistency:** `@de-braighter/health-fhir` (package), `health-fhir` (nx project) used consistently; the moved symbols (`projectAuditEventToFhir`, `FhirExportService`, `FhirAuditEventModule`, `BulkExportService`, `FhirBulkExportController/Module`, `operation-outcome.exception-filter`) match the substrate barrel inventory in the design §3.
