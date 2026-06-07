# Second Brick — Real-Clinical Oncology Product: Sub-Project #1 Brief + Program Handoff

- **Status:** handoff to a fresh session (this session is closing). Brainstorm-stage scoping; **not yet designed or built.**
- **Date:** 2026-06-07
- **Author:** orchestrator session (founder-directed)
- **For the new session:** read this top-to-bottom, then the cited artifacts, then start sub-project #1's design pass. The substrate kernel is ready; this is a *product* program.

---

## 1. The decision trail (how we got here)

This session completed the **substrate-coherence remediation program** (Truth → Enforce → Correct + the owned arcs): `substrate@1.0` shipped (WS-3 legacy-port retirement, WS-6 FHIR eviction → `domains/health`, WS-8 opaque-`role` SubjectRef), both consumers migrated (markets, exercir), then **WS-4** (RLS secure-by-default + pedigree UUID, merged) and **WS-9** (kernel concern #4 — reproducibility: `run_manifest` + `distribution_catalog` + bit-identical replay, merged + proven). The kernel is now four-concerns-complete, FHIR-free, tenant-secure, reproducible, at 1.0.

Then: **"what's missing to launch the north-star domain?"** → a gap analysis (ADR-218 sequencing + the case-management-second-brick concept). Two of the four enabling gaps (WS-8 subjects, WS-9 reproducibility) closed this session; the remaining two (a vendor subtree registry; an inference family fitting case outcomes) are *demand-driven by design* (Option A — build when a product pulls them).

**The founder's pick (the consequential call):** the second brick is **not** the concept's lean (C investigations/claims). It is a **real-clinical-data Swiss oncology care-pathway product** — the full health journey *prevention → diagnosis → treatment → survivorship*, **cancer first**, and explicitly the **real-clinical-data** framing (not the synthetic-demo path).

**Why this is coherent (the substrate's telos):** the FHIR kernel export (now `@de-braighter/health-fhir`, mCODE), the `fhir-pro` lane (R4 / CH Core v7 / IHE MHD for the Swiss EPD), the `swiss-pro` lane (nDSG/revFADP, Cara+Sanela Stammgemeinschaft, AGOV/SwissID/HIN), the SPHN/KLS-register context — the platform was built for a Swiss oncology product. Survival is the canonical cancer outcome, so the missing inference family is domain-motivated; `health-fhir` gets its consumer; the full-journey patient twin is the most vivid "plan tree = model, twin = runtime" demonstration.

**The load-bearing tension (named, accepted):** "real clinical data" **crosses the ratified prototype-assumptions-charter** (D5 no-PHI, D7 demo-mode, D2 no-clinical-authority). You **cannot write a real-PHI flow under it.** So the first artifact is *governance*, not code — hence sub-project #1.

## 2. The program decomposition (each its own spec → plan → build)

1. **Product charter + real-data architecture** — *sub-project #1, the unblocker (this brief)*.
2. **Oncology care-pathway modeler + survival twin** — the journey as a recursive plan-tree + a **survival inference family** (the 3rd-family gap, now domain-motivated) + reproducibility (WS-9). *May prototype on synthetic cohorts in parallel to validate shape.*
3. **Journey slices + differentiators** — diagnosis → treatment → survivorship stages; the vendor **registry** (mCODE-aligned regimen/protocol template subtrees); the **ADR-216 adaptive-care gate** (clinician ratifies AI-proposed pathway revisions).
4. **The `health-fhir` consumer + EPD egress** — pathway → `CarePlan`/`PlanDefinition`; closes the WS-6 loop.

## 3. Sub-project #1 — scope (what the new session designs first)

Two designer-first artifacts. **Owners: swiss-pro (regulatory) + fhir-pro (FHIR/EPD) + substrate-architect (kernel posture); the founder ratifies the charter.**

### Deliverable A — the product charter (supersedes the prototype-assumptions-charter for the oncology product)

Must decide:

- **Lawful basis** for processing oncology PHI under **nDSG / revFADP** (consent + legal grounds).
- **PHI-safe regime**: Swiss data residency (D17), encryption-at-rest, RLS isolation (WS-4's RLS-on default helps), nDSG retention/erasure, the kernel `consent_receipt` + audit hash-chain applied to *real* PHI.
- **EPD/EPR posture**: read-ingest (IHE MHD/XDS) ± write-egress (CarePlan), via the **Cara/Sanela** Stammgemeinschaft.
- **The D2 clinical-content-authority line** — the single biggest governance fork (see §4).
- **Auth/identity**: HIN (clinicians) / AGOV / SwissID (patients); note the AGOV-replacing-CH-LOGIN deadline (2026-10-31) + the swiyu wallet timing.
- **The demo→real transition** off the prototype demo-mode regime.

### Deliverable B — the real-data architecture ADR

Must decide:

- **EPD-FHIR ingest** (R4 / CH Core v7 / IHE MHD v4.2.2) → `kernel.event_log`, with terminology bindings (LOINC / SNOMED CT / ICD / CHOP, mCODE, SPHN for the KLS register).
- **PHI-safe kernel tenancy** (real-PHI rows under RLS + encryption + consent/audit).
- **The oncology care-pathway model** (journey as plan-tree + effect declarations) + the **survival twin** (the new inference family) + reproducibility (WS-9 `run_manifest`).
- **`health-fhir` egress** (`CarePlan`/`PlanDefinition` + EPD write).

## 4. Open founder decisions for the new session (resolve these first)

1. **Clinical-authority posture (the biggest fork).** *Recommended:* position as decision-**support** modeling — stay out of medical-device/MDR territory (no diagnostic/treatment claims; the substrate projects outcomes + supports clinicians, it does not prescribe). The alternative (a regulated medical device) is far heavier (MDR, clinical evaluation, notified body) — a separate, much larger commitment.
2. **EPD integration depth.** *Recommended:* **read-only ingest first** (IHE MHD/XDS read of a patient's oncology documents → event_log); defer bidirectional write-egress to a later slice. Keeps #1 tractable.
3. **The first oncology indication.** Pick one cancer + one journey stage to anchor the first real slice (e.g., a specific tumor's treatment pathway with overall/progression-free survival as the outcome). Determines the survival-family shape + the mCODE profiles.

> These were *not* confirmed this session (the founder chose to hand off). They are the new session's first questions; the recommendations are leans, not decisions.

## 5. What's already in place (the new session builds on this)

- **Kernel ready (1.0):** recursive plan-tree + effect declarations (ADR-199/200), append-only event_log, inference wired to the log with 4 conjugate fast-paths (normal/beta/lognormal/EB-hierarchical — but **no survival/categorical family yet**), persisted tenants + RLS (ADR-209, secure-by-default per WS-4), audit hash-chain, reproducibility (`run_manifest` + `distribution_catalog` + replay, WS-9/ADR-220), subjects generalized (WS-8/ADR-213 — a patient/tumor/cohort are all first-class).
- **`@de-braighter/health-fhir`** (`domains/health`) — the relocated FHIR/mCODE projection pack (AuditEvent + plan-tree projectors, R5 types, bulk-export); currently `private:true`, no consumer (publish = `health#1`). The oncology pathway is its intended consumer.
- **The modeler-evolution gate is designed:** ADR-215 (kernel MCP inbound adapter) + ADR-216 (gated AI model-change proposals — ratify-additive-only, now un-blockable since WS-9 shipped). The adaptive-care surface *consumes* this gate; no new design needed for it.

## 6. Recommended kickoff for the new session

1. Founder resolves the three §4 decisions (clinical-authority posture; EPD depth; first indication).
2. Dispatch the designer-first pass — **swiss-pro** (the charter's nDSG/EPD/auth regime), **fhir-pro** (the EPD-FHIR ingest + terminology + mCODE profiles), **substrate-architect** (PHI-safe kernel tenancy + how the pathway/survival/reproducibility spine composes) — authoring Deliverable A (the product charter, likely a new charter doc + a superseding note on `prototype-assumptions-charter.md`) and Deliverable B (the architecture ADR).
3. Founder ratifies the charter; then sub-project #2 (the modeler + survival family) can start (the survival family can prototype on synthetic cohorts in parallel).

## 7. Citable artifacts

- `layers/specs/adr/adr-218-north-star-critical-path-sequencing.md` — the sequencing (subjects → reproducibility + inference depth → registry → product).
- `layers/specs/concepts/substrate/case-management-second-brick-2026-06-05.md` — the second-brick framing, the four gaps (§3.2), the candidate analysis (§4 — note: this brief's vertical pick *overrides* its lean-C recommendation toward clinical, a founder call), the acid test (§6).
- `layers/specs/concepts/prototype-assumptions-charter.md` — the charter sub-project #1 must supersede (D5/D7/D2 are load-bearing).
- ADRs: 204 (FHIR eviction → health-fhir), 213 (subjects), 220 (reproducibility), 209 (tenants), 027 (pack-on-platform), 215/216 (the modeler-evolution gate); ADR-032 (the superseded pre-collapse FHIR-export rationale, file-retained).
- `layers/specs/concepts/substrate/north-star-vision-capture-2026-05-17.md` — §4.2 the collapse, §15.1 inference cost, §15.2 registry, §19.5 Option A.
- Agents: **swiss-pro**, **fhir-pro**, **substrate-architect** (design); **charter-checker** + **exercir-charter-checker** (the prototype-charter watchdogs — the supersession must satisfy them).

## 8. The honest framing for the new session

The substrate is done; this is **building the real product**, and it is a **regulated Swiss clinical program**, not a prototype slice. Sub-project #1 is governance + architecture *because you cannot write a real-PHI line until the charter regime exists*. Scope it tight (decision-support, read-only EPD, one indication) so it is tractable; the full prevention→survivor journey + bidirectional EPD + the registry are later sub-projects pulled in as the product needs them (Option A).
