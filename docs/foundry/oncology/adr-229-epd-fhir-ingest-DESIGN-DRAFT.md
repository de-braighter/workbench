# ADR-229 (DRAFT) — B2 EPD-FHIR R4 ingest — design captured from the O-4 worker (2026-06-13)

> **Why this file exists:** the foundry worker for `oncology/O-4` produced this complete
> designer-first ADR design but **could not land it** — the `layers/specs` sibling clone
> had been wiped mid-session by a concurrent session's `robocopy /MIR` junction-follow (NOT idle eviction; see the `robocopy-mir-junction-wipe-incident` memory). The design
> is preserved here (the stable workbench) so the resume session writes ADR-229 verbatim
> rather than re-deriving it. **Resume:** restore `layers/specs` (init-workbench), re-claim
> `oncology/O-4` off `origin/main`, write `adr/adr-229-epd-fhir-r4-ingest.md` from this, run
> the specs wave, `foundry_gate_request gateType:"adr"`, STOP (architecture-first — do NOT
> build the IHE-MHD port until the founder approves the ADR).

## Number + index facts (authoritative, off origin/main as of 2026-06-13)

- **ADR-229 is the correct number.** `origin/main` already has `adr-227` (O-1 PHI schema),
  `adr-228` (cloud-KMS, renamed from a 227 collision), and `next-free-adr: 229`. Work off
  `origin/main` (the local clone was stale).
- Index edits: `adr/README.md` line 5 `next-free-adr: 229 → 230`; the prose line
  `current latest: ADR-228; next free: ADR-229 → 229/230`; append the ADR-229 sentence in
  the "names since changed" paragraph **after** the anchor `…implementation a separate
  substrate-repo step.).` (end of the ADR-228 description); add a design-local entry to
  `adr/adrs-by-tier.md`.
- **Frontmatter** (validator wants `date`/`decision-makers`/`applies-to`, NOT
  `created`/`last_updated`/`domain`): copy adr-227/228. Recommended `tier: design-local`,
  `scope: health`, `status: proposed`, `applies-to: domains/health`.

## Decision (architecture-first)

A **read-only** EPD-FHIR **R4** ingest in the health pack `domains/health/libs/health-fhir/`
(NOT the kernel — closes the ADR-204 FHIR-demotion loop; charter §6 names
`@de-braighter/health-fhir` as the consumer). Pulls a patient's oncology documents via
**IHE MHD v4.2.2** and maps the **breast-cancer mCODE profile set** into the O-1
`Tumor`/`Observation` schema (ADR-227). **Sandbox/reference community only, no real
Stammgemeinschaft, no real PHI.**

### 1. IHE MHD read sequence (R4)
Consent-gate (`ConsentDecisionService`, actor=therapist/action=read) + mTLS → **ITI-83/PIXm**
(EPR-SPID resolve) → **ITI-67** (Find DocumentReferences, oncology-filtered) → **ITI-68**
(Retrieve Document → R4 `Binary`/Bundle of mCODE resources). ITI-65 publish is **out of
scope** (= O-5 egress).

### 2. mCODE → O-1 mapping (20 rows; confirm version-sensitive codes against pinned profiles)
- Primary Cancer Condition → `Tumor.primary_site_code` / `histology_code` / `laterality_code` / `diagnosis_date`.
- TNM staging (LOINC, confirmed): clinical T/N/M 21905-5 / 21906-3 / 21907-1; clinical stage group 21908-9; pathological stage group 21902-2; pathological primary tumor 21899-0; pN≈21900-6 / pM≈21901-4 / grade≈59542-1 (**flagged "confirm"**) → `Tumor.clinical_*` / `pathological_*` / `stage_group` / `grade`.
- Receptor markers: ER 16112-5 / PR 16113-3 / HER2 48676-1 → `Tumor.er/pr/her2_status`; BRCA → `Tumor.brca_status` (genomics class).
- Cancer Disease Status (**LOINC 97509-4 in mCODE STU3, was 88040-1 — version-sensitive; key off the pinned profile version**) + recurrence/death → `Observation` rows (`observation_type` / `value_code` / `marker_code` / `observation_date` / `event_observed`).
- **Critical invariants:** produce **string-shaped domain values** for the encrypted String columns (coded token / ISO date / boolean-string); **never store a FHIR resource and never a computed `duration_t`** — survival is derived downstream by O-3 (ADR-176 §4). Respect mCODE extensible/preferred binding strengths (tolerate Swiss-extended codes).

### 3. R4↔R5 conflation guard (the named defect class; charter §6 verbatim)
Structural separation — distinct module (`health-fhir` R4 vs kernel R5/mCODE export
ADR-032); R4-native parse with **no R5 intermediate on ingest**; kernel stays FHIR-free +
PHI-free (ADR-204 / ADR-227 §7 OQ-7); plus a `version-skew-check` backstop.

### 4. New IHE-MHD client out-port + sandbox/real seam (ADR-110/152 hexagonal)
Pure-TS `IheMhdReadPort` (`resolvePatient` / `findDocumentReferences` / `retrieveDocument`,
returning typed `Result`s; adapter maps SOAP-fault / FHIR `OperationOutcome` / transport
errors into a typed error union). Seam mirrors B1's FakeKmsDriver / ADR-228: a deterministic
**`FakeIheMhdClient`** (canned synthetic R4 Bundles for CI) + a
**`SandboxCommunityGatewayAdapter`** (real mTLS against the sandbox reference community
only). **Hard invariant on both: no real Stammgemeinschaft / no real PHI** (the T2
synthetic-cohorts obligation enforced by wiring).

### 5. ADR-081 reconciliation
ADR-229 **supersedes ADR-081 in part** for the read-ingest adapter — relocates it from
kernel (`libs/kernel-epd`) to the health pack, R4-native / read-first, while **inheriting**
ADR-081's IHE baseline (MHD v4.2.2; ITI-83/67/68; Sanela/Cara sandbox equivalents;
consent-mediation; per-community mTLS). ADR-081 stays ratified; retiring `libs/kernel-epd`
for egress is O-5's concern.

### 6. Open items (FHIR/terminology)
CH Core v7 + mCODE STU profile-version pins & binding strengths; confirm pN/pM/grade/BRCA
codes; per-element value sets; whether the sandbox is IHE Gazelle vs official EPD reference
env vs local fake; ITI-83 EPR-SPID→Patient details; ADR-084 eÜberweisungsbericht filtering;
SPHN/KLS feed deferred (egress-adjacent).

## Cross-refs to wire
ADR-227 (O-1 schema), ADR-222 (column classes), ADR-228 (fake/real KMS seam precedent),
ADR-204 (FHIR demotion), ADR-032 (kernel R5/mCODE export), ADR-081 (Swiss EPD adapter),
ADR-046/047 (consent), ADR-084 (eÜberweisungsbericht), ADR-110/152 (hexagonal), ADR-176
(derived-not-stored), ADR-213 (subject ontology).

## PR body for the resume session
`Producer: foundry-worker/claude-opus-4-8 [foundry-worker, designer-first, fhir-pro]` ·
`Effort: deep` · omit `cycle-time` (gated).
