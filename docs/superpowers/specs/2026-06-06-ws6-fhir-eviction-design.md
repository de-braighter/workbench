# WS-6 — FHIR Eviction (relocate to `domains/health`) — Design

- **Status:** proposed (awaiting user review)
- **Date:** 2026-06-06
- **Author:** orchestrator session (founder-directed)
- **Implements:** [ADR-204](../../../layers/specs/adr/adr-204-demote-fhir-runtime-from-kernel.md) (**ratified** — Direction B, both projectors, zero FHIR in `substrate-runtime`).
- **Sequenced by:** [ADR-218](../../../layers/specs/adr/adr-218-north-star-critical-path-sequencing.md) — sibling of WS-3 + WS-8 in the `substrate@1.0` batch.
- **Rides:** the `substrate@1.0` breaking batch — epic [substrate#92](https://github.com/de-braighter/substrate/issues/92) / WS-6 epic [substrate#94](https://github.com/de-braighter/substrate/issues/94).
- **Founder decision (2026-06-06):** the health-pack home = a **new `domains/health` repo** publishing `@de-braighter/health-fhir`.
- **Successor artifact:** `docs/superpowers/plans/2026-06-06-ws6-fhir-eviction-plan.md`.

---

## 1. Why this exists

A FHIR runtime ships **inside** the kernel runtime at `libs/substrate-runtime/src/fhir/` — projectors, R5 resource types, controllers, bulk-export. ADR-204 (ratified) found it **fails the ADR-176 inclusion test**: it is not one of the four kernel concerns (clinical-FHIR is domain-interop), it is needed by ≤1 pack, and its ratifying ADR-032 rests on a **superseded** entity model (`kernel.Person`/`Consent`/`Influence` — none exist post-collapse). The founder ratified **Direction B**: relocate the entire FHIR runtime (both wired projectors) into a separate health-pack composing the kernel, leaving **zero** FHIR surface in `substrate-runtime`.

## 2. The load-bearing finding — there is no live consumer

ADR-204 rejected "delete outright" because *"pack-football does use the clinical export."* **The live code contradicts that premise** (verified 2026-06-06):

- exercir imports `@de-braighter/substrate-runtime` in ~17 files, but **none** import any FHIR symbol (`projectAuditEventToFhir`, `FhirExportService`, `FhirAuditEventController/Module`, `BulkExportService`, `FhirBulkExportController/Module`). `git grep "import .*[Ff]hir" domains/exercir` → **empty**.
- The only FHIR traces in exercir are (a) a *comment* in `outbox-dispatcher.ts:12` and (b) an optional `fhirMapping: z.string()` *manifest field* (`indicator.types.ts:173`, "deferred FHIR binding") — a plain string, **no substrate-FHIR dependency**.

**Consequence:** WS-6 has **zero consumer re-point**. ADR-204's "pack-football re-points its FHIR dependency" is moot. WS-6 is a clean **lift-and-delete**. The relocation (vs delete-outright) is justified by the **deferred** `fhirMapping` intent + the north-star health-vertical roadmap — the capability is *preserved* in `domains/health` for when the deferred binding lands, not serving a live consumer. (If the founder preferred, delete-outright is now viable per ADR-204 Alt-2 since no consumer is stranded; the ratified + just-confirmed choice is **relocate**.)

## 3. Live surface (what moves / what's deleted)

**Relocate** — all ~23 files under `libs/substrate-runtime/src/fhir/` →

- `audit-event.projector.ts` (+ `.spec`, `.compliance.spec`) — kernel `AuditEvent` → FHIR `AuditEvent` (`projectAuditEventToFhir`).
- `plan-tree.projector.ts` (+ `.spec`, `.smoke.spec`) — plan-tree → `CarePlan` / `PlanDefinition`.
- `fhir-export.service.ts`, `bulk-export.service.ts`, `in-memory-bulk-export-job.store.ts` (+ specs).
- `fhir-audit-event.{controller,module}.ts`, `fhir-bulk-export.{controller,module}.ts` (+ specs).
- `operation-outcome.exception-filter.ts` (+ spec).
- `index.ts` (the FHIR sub-barrel).

**Delete from substrate-runtime:**

- the entire `src/fhir/` directory.
- `libs/substrate-runtime/src/index.ts` — the `export * from './fhir/index.js'` (`:181`) + the FHIR comment block (`:175–179`) + the gateable-module note (`:314`).

**Untouched (kernel residents — only their FHIR *projection* moves):** the kernel `AuditEvent` row + hash-chain ([ADR-061]), consent ([ADR-184]), effects-on-plan-node ([ADR-200]). The FHIR modules were **opt-in / gateable** (`forRoot` ships zero per the `:314` note) and exercir never opts in — so removing them changes **no default kernel surface** and breaks no consumer.

## 4. Decision — new `domains/health` repo

Create a new cluster **domain repo `domains/health`** (sibling of `exercir`, `conservation`), publishing **`@de-braighter/health-fhir`**, that **composes** the kernel per [ADR-027](../../../layers/specs/adr/adr-027-pack-architecture.md) pack-on-platform. The relocated FHIR code imports the kernel surface it needs from the **published** `@de-braighter/substrate-{contracts,runtime}` packages (not relative paths). Scaffolded via the **`/new-domain`** skill (the markets reference run), trimmed to a single library (no api/UI tiers needed for v1 — it's a projection lib).

Dependency direction: `@de-braighter/health-fhir` → depends on → `@de-braighter/substrate-{contracts,runtime}`. The kernel never depends on health. Clean, acyclic, physical boundary — FHIR leaves the substrate **repo** entirely (the "cannot silently regress" property the Direction-B override bought).

## 5. The import rewrite (the real mechanical work)

The `src/fhir/` files today import kernel types via **relative paths** within `substrate-runtime` (e.g. `../audit/…`, `../plan-tree/…`, the kernel `AuditEvent` / plan-node row types). On relocation each becomes a **published-package import**:

- kernel row/contract types → `@de-braighter/substrate-contracts`
- runtime services/decorators the projectors lean on → `@de-braighter/substrate-runtime`

A discovery step (plan Task 2) enumerates every relative import in `src/fhir/` and maps it to its published entry point. Any kernel internal the projectors reach for that is **not** published is a finding — either it must be added to the published surface (escalate) or the projector restructured to not need it.

## 6. Invariants preserved

- Kernel stays the four concerns; `substrate-runtime` drops FHIR **entirely** (physical, ADR-176 charter-flag clears). No new kernel surface; this is removal + relocation.
- The kernel `AuditEvent` + hash-chain interchange is unchanged; only its *FHIR serialization* moves (a knowing cost per ADR-204 OQ-2 — the kernel forgoes emitting ATNA FHIR AuditEvent of its own facts).
- FHIR-shape / mCODE / Swiss-EPD profiling decisions inside `domains/health` are **`fhir-pro` / `swiss-pro` territory** (out of scope here — pure relocation, no shape change).

## 7. Release mechanics

- Physically removing the FHIR surface is a **breaking major** bump of `@de-braighter/substrate-runtime` — it rides `substrate@1.0` (substrate#92). Because **no consumer imports FHIR**, the break is theoretical for current consumers (nothing to migrate).
- `@de-braighter/health-fhir@0.1.0` is **newly published** from `domains/health`. No consumer adopts it yet (the `fhirMapping` binding is deferred); it stands ready for the future health vertical.
- substrate-side deletion lands on the `release/1.0` branch; the `domains/health` scaffold is its own repo + PR.

## 8. Ownership

`/new-domain` skill + `substrate-coder-pro` (scaffold `domains/health` + the import rewrite) · `substrate-coder-pro` (delete `src/fhir/` + barrel from substrate) · `fhir-pro` (consulted on FHIR-shape only if the move surfaces a profiling question) · verifier wave on both PRs (substrate removal + new domains/health).

## 9. Confirmed sub-decisions (this session)

1. Health-pack home = **new `domains/health` repo**, `@de-braighter/health-fhir` (founder, 2026-06-06).
2. **Relocate, not delete** — preserved for the deferred `fhirMapping` binding + the health-vertical roadmap (ADR-204 ratified; reconfirmed despite the no-live-consumer finding).
3. v1 `domains/health` is a **single projection library** (no api/UI tiers) — minimal scaffold.
