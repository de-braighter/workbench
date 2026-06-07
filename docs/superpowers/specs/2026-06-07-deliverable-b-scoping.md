# Deliverable B — Real-Data Architecture: Scoping Brief (sub-project #1, Deliverable B)

- **Status:** scoping brief — decomposition + keystone decisions resolved; each sub-ADR is its own design → plan → build cycle.
- **Date:** 2026-06-07
- **Author:** orchestrator session (founder-directed)
- **Predecessors:** the ratified **oncology product charter** (`layers/specs/concepts/oncology-product-charter.md`, ADR-221) and its design brief (`docs/superpowers/specs/2026-06-07-second-brick-oncology-charter-design.md`). The charter set the *posture*; Deliverable B sets the *architecture*.
- **Owners (per sub-ADR below):** `substrate-architect` · `fhir-pro` · `swiss-pro` · `prisma-pro`.

---

## 1. What this is

Sub-project #1 had two artifacts: **A — the product charter** (done, ratified) and **B — the real-data architecture ADR**. This brief scopes B. The charter (§6 EPD posture, §9 survival commitment, §11 demo→real, §12 open items) deferred all *mechanism* to "Deliverable B"; this brief turns that pointer into a buildable plan.

**The headline finding (from the surface map):** "the real-data architecture ADR" is **too big for one ADR**. A code-surface survey of what exists vs. what real-PHI oncology needs found **five disjoint gaps** with different owners, risk profiles, and dependencies. One ADR deciding all five would be unreviewable and would couple a multi-month survival-model effort to a short encryption decision. **So Deliverable B is decomposed into a sequenced 4-ADR cluster (B1–B4).**

## 2. Surface reality — what exists vs. the gaps

From the surface map (citable file paths in §9). **What already exists, do not rebuild:**

- **`event_log` append** — `DomainEventEnvelope` + `DomainEventPublisher.publishAll` (`layers/substrate/libs/substrate-contracts/src/events/`), proven live by `domains/markets`. Opaque JSONB payload; kernel validates envelope shape only.
- **RLS tenancy** — `ScopedPrismaService` / `GucPrismaRunner` GUC plumbing + `TenantPackContextGuard` (`layers/substrate/libs/substrate-runtime/src/`), gated by `SUBSTRATE_RLS_ENABLED` (off until schema migrates; production wires it true). ADR-209/ADR-027 §6.
- **Audit hash-chain** — `kernel.audit_event` + chain + Merkle anchor, three retention tiers (operational/security/compliance).
- **Consent** — `ConsentEngine.hasConsent(tenantPackId, subjectId, purposeId)` over append-only `core.consent_receipt` (ADR-184), per-purpose binary.
- **Inference** — the `InferenceBackbone` port + beta/normal conjugate fast-paths (lognormal/EB-hierarchical maturing); `RunManifest` reproducibility contract (`run-manifest.ts`), stored as the payload of `kernel.InferenceRunCompleted.v1`.
- **`@de-braighter/health-fhir`** (`domains/health/libs/health-fhir`) — **export-only**: AuditEvent + plan-tree→CarePlan/PlanDefinition projectors, R5-typed, in-memory bulk-export. `private:true`.

**The five gaps Deliverable B must close** (mapped to B1–B4 in §3):

1. **Encryption at rest for PHI — zero implementation today.** (→ B1)
2. **EPD-FHIR ingest — completely missing.** `health-fhir` is export-only; no FHIR→`event_log` bridge, no IHE MHD read. (→ B2)
3. **Health domain event catalog — stubbed.** No `health:ObservationRecorded.v1` etc. registered. (→ B2)
4. **R4 / CH-Core / terminology ingest mapping — deferred.** `health-fhir` is R5-only; the EPD wire is R4. (→ B2)
5. **Survival / time-to-event inference family — zero.** Only beta/normal/lognormal exist; `kernel.distribution_catalog` is in-memory (no table yet). (→ B3)

## 3. The four sub-deliverables

### B1 — PHI-safe kernel tenancy + encryption-at-rest *(critical path; no upstream dependency)*

- **Closes:** gap #1 (encryption) + hardens the real-PHI posture (RLS-on flip for the health domain; consent scoping).
- **Exists / missing:** RLS GUC plumbing + audit + per-purpose consent exist; **encryption-at-rest and consent *scoping* are net-new.** Consent today is a per-purpose binary — oncology may need scoped consent (e.g. "imaging for oncology only", "deny pediatric data").
- **Keystone decision — RESOLVED:** **application-level encryption (Prisma field encryption)** with a KMS-managed key — PHI columns encrypted in the substrate's control (portable across Swiss hosting, fine-grained, CI-testable), not delegated to the deployment. *Open within B1:* key management/rotation port; deterministic encryption / blind-index strategy for any queried PHI column; the consent-scoping model; the `SUBSTRATE_RLS_ENABLED` production flip + schema migration.
- **Owners:** `substrate-architect` (the tenancy/port shape) · `prisma-pro` (the field-encryption middleware + migration) · `swiss-pro` (nDSG/residency constraints on key custody).

### B2 — EPD-FHIR ingest *(real data IN; depends on B1)*

- **Closes:** gaps #2, #3, #4 — the ingest bridge, the health event catalog, and the R4/CH-Core/terminology mapping.
- **Exists / missing:** the `event_log` append contract is ready (markets is the template); **everything FHIR-inbound is greenfield.** Needs: an IHE MHD Document-Retrieve read path (EPD→`health-fhir`), a `FHIR R4 Observation → DomainEventEnvelope → event_log` adapter, the `health:*` event catalog registered in the pack manifest (ADR-027), subject-identity resolution (**EPR-SPID → kernel subject**, leveraging ADR-213 subjects), and terminology normalization (LOINC / SNOMED CT / ICD / CHOP / mCODE).
- **Keystone decisions (open — B2's cycle):** the EPD read path + Stammgemeinschaft (Cara/Sanela) connection posture; the R4/CH-Core→kernel Subject/Indicator/Observation mapping; the breast-cancer mCODE profile set + terminology binding strengths.
- **Owners:** `fhir-pro` (lead — the FHIR/EPD/terminology) · `substrate-architect` (the event-catalog + subject-resolution kernel surface) · `swiss-pro` (the Stammgemeinschaft + EPR-SPID).

### B3 — Oncology pathway plan-tree + the survival twin *(the model; can start NOW on synthetic cohorts, in parallel with B1/B2)*

- **Closes:** gap #5 — the survival/time-to-event family + the `kernel.distribution_catalog` table (finally persisted) + WS-9 replay for fitted models.
- **Exists / missing:** the plan-tree + effect-declaration algebra + `RunManifest` exist; the **survival family is zero** and `distribution_catalog` is in-memory only.
- **Keystone decision — RESOLVED:** **in-process (JS/TS) survival first** — parametric (Weibull / log-logistic) + Kaplan-Meier non-parametric, matching the existing conjugate fast-path pattern; the **NumPyro/JAX sidecar stays deferred** until in-process limits are concrete (the standing decision). *Open within B3:* the survival-family **contract shape** (the censoring + event-time input; survival-curve + quantiles + hazard-ratio output) — re-run the ADR-176 inclusion test on the concrete interface (charter-checker flagged this as where the test bites with teeth); the `distribution_catalog` table schema (with version/hash for WS-9 pinning); the breast-survivorship pathway plan-tree shape (reusing the clinical knowledge in `swiss-top5-cancer-pathways.md`, *not* its superseded Exercir-pack framing).
- **Owners:** `substrate-architect` (lead — the inference family + catalog + plan-tree) · `fhir-pro` (the mCODE pathway profiles).
- **Note:** B3 validates its *shape* on **synthetic cohorts** before any real-PHI fitting (charter §9) — so it is **not blocked on B2** and starts immediately.

### B4 — health-fhir egress + EPD write *(real data OUT; last; gated to staged-claim rung 2)*

- **Closes:** the egress gap — plan-tree → CarePlan/PlanDefinition → **IHE MHD/XDS write** to the Stammgemeinschaft; projector completion (the `activity[]`/`goal[]` currently emitted empty); **publish `@de-braighter/health-fhir`** (drop `private:true`).
- **Keystone decisions (open — B4's cycle):** write-back consent flows; XDS provide/register conformance; the projector completion.
- **Owners:** `fhir-pro` (lead) · `swiss-pro` (XDS write + Stammgemeinschaft + consent).
- **Gating:** charter §8 — **EPD write-egress activates at rung 2 (the IIb target rung)**, so B4 is genuinely last and not on the near-term critical path.

## 4. Resolved keystone decisions (founder, 2026-06-07)

| Sub-ADR | Decision | Choice |
|---|---|---|
| B-cluster | One ADR vs. decompose | **Decompose into B1–B4** (sequenced cluster) |
| B1 | Encryption-at-rest approach | **Application-level (Prisma field encryption)** + KMS-managed key |
| B3 | Survival inference engine | **In-process (JS/TS) first** (Weibull / log-logistic / KM); NumPyro sidecar deferred |

## 5. Sequencing, critical path & parallelization

```text
B1 (tenancy + encryption)  ──►  B2 (EPD ingest)  ──►  [real-PHI fitting]
        │                                                    ▲
        │                                                    │
B3-survival (synthetic cohorts, starts now) ─────────────────┘
                                                             │
                                                  B4 (egress) ── gated to rung 2 (last)
```

- **Critical path = B1.** No upstream dependency; nothing real-PHI lands without encryption + RLS-on. **Start here.**
- **B3-survival runs concurrently** on synthetic cohorts (validates the family's shape independent of real data), then fits on real data once B1+B2 land.
- **B4 is rung-2-gated** (charter §8) — design it last; it is not near-term.

## 6. Open decisions handed to each sub-ADR's cycle

Each Bn is its own design → plan → build cycle; the decisions left open above are resolved *in that cycle*, not here. The biggest open ones: B1 key-rotation + consent-scoping model; B2 the EPD read path + R4/CH-Core mapping + mCODE profile set; B3 the survival-family contract shape (the real ADR-176 re-test) + the `distribution_catalog` schema. Each cycle's charter-checker pass confirms it stays within the substrate constitution and the ratified product charter.

## 7. Relationship to the charter & the program

- **Implements** the charter's §6 (EPD posture), §9 (survival commitment), §11 (demo→real), and the §12 open items routed to the conformity/EPD workstreams.
- **B3** is also the front half of **program sub-project #2** (the care-pathway modeler + survival twin) — the survival family is shared. **B4** closes the **WS-6 / ADR-204** FHIR-eviction loop (FHIR lives in the health pack, egresses to the EPD).
- Stays **demand-driven (Option A)**: every kernel-touching piece (the survival family, the `distribution_catalog` table) is pulled by this product, validating ADR-176 §3, not speculative.

## 8. Recommended next step

Start **B1** (the critical-path foundation) as its own brainstorm → design → plan → build cycle, with `substrate-architect` + `prisma-pro` + `swiss-pro`, resolving its open items (key rotation, consent scoping, the RLS-on migration) — while **B3-survival** is scoped in parallel on synthetic cohorts.

## 9. Citable artifacts

- Charter: `layers/specs/concepts/oncology-product-charter.md` (§6/§9/§11/§12) + `layers/specs/adr/adr-221-adopt-oncology-product-charter.md`.
- Charter design brief + handoff: `docs/superpowers/specs/2026-06-07-second-brick-oncology-charter-design.md`, `…-oncology-handoff.md`.
- **Surface map (what exists / what's missing):** `event_log` — `layers/substrate/libs/substrate-contracts/src/events/domain-event.schemas.ts` + `domain-event-publisher.port.ts`; RLS — `layers/substrate/libs/substrate-runtime/src/context-guards/tenant-pack-context.guard.ts` + the GUC plumbing in `src/`; inference — `layers/substrate/libs/substrate-contracts/src/inference/inference-backbone.port.ts`; reproducibility — `.../src/primitives/run-manifest.ts`; health-fhir — `domains/health/libs/health-fhir`.
- ADRs: 204 (FHIR eviction → health-fhir), 206 (event_log distribution to packs), 209 (persisted tenants/RLS), 213 (subjects), 220 (reproducibility/WS-9), 216 (adaptive-care gate), 184 (consent), 176 (kernel minimality — re-tested per sub-ADR), 027 (pack-on-platform).
- Clinical pathway knowledge (reusable; superseded framing): `layers/specs/concepts/swiss-top5-cancer-pathways.md`.
- Standing decision: NumPyro sidecar deferred — in-process inference first.
