# Oncology Product Charter — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author and ratify the **oncology product charter** (sub-project #1, Deliverable A) — a PR-gated specs-repo document that supersedes the prototype-assumptions-charter for the regulated health domain and establishes the governance regime under which real-PHI oncology code may be written.

**Architecture:** This is a *document-authoring* plan, not code. The artifact is `layers/specs/concepts/oncology-product-charter.md` (12 sections), plus a domain-scoped supersession note on `prototype-assumptions-charter.md`, an index entry, and a citing/adoption ADR. The "tests" are the specs-repo verifier wave (`spec-auditor` cross-refs/numbering/dependency-closure + `md-quality-review` structural/markdownlint), the `charter-checker` + `exercir-charter-checker` watchdogs (supersession soundness), and the founder ratification gate (`status: draft → ratified`). Sections are authored by their domain-owner agents (`swiss-pro` / `fhir-pro` / `substrate-architect`); coherence is enforced by an end-to-end reconciliation pass before the gates.

**Tech Stack:** Markdown; ADR-181 frontmatter schema; the specs-repo PR flow; the `swiss-pro` / `fhir-pro` / `substrate-architect` / `charter-checker` / `exercir-charter-checker` agents; the `/adr-scaffolder`, `/md-quality-review` skills.

**Source of truth for contents:** `docs/superpowers/specs/2026-06-07-second-brick-oncology-charter-design.md` (the design brief — every task draws its required contents from it). Keystone decisions recorded there are founder-ratified; do not relitigate them.

**Adaptation note (read before executing):** because this authors a regulatory document, each task's "code" block is replaced by a **Required contents** block (what the section must establish), a **Cite** list (sources), and **Acceptance** (how to know the section is done). There is no literal unit test; verification is the doc gates in Tasks 9–11.

---

## File structure (decomposition locked here)

| File | Responsibility | Tasks |
|---|---|---|
| `layers/specs/concepts/oncology-product-charter.md` (**create**) | The charter — 12 sections | 1–7 |
| `layers/specs/concepts/prototype-assumptions-charter.md` (**modify**) | Add the domain-scoped supersession note + per-pin disposition | 8 |
| `layers/specs/concepts/README.md` (**modify**) | Index the new charter | 8 |
| `layers/specs/adr/adr-NNN-adopt-oncology-product-charter.md` (**create**, number via `/adr-scaffolder`) | The adoption/ratification ADR that cites the charter | 9 |

**Ownership map (who authors which charter section):**
- **substrate-architect:** §1 (purpose/scope/supersession vs ADR-176 + four concerns), §9 (inference & survival-family commitment), §11 (demo→real transition).
- **swiss-pro (device-regulation spine):** §3 (regulatory posture), §5 (clinical safety/authority), §8 (staged-claim ladder), §10 (governance/change-control/lifecycle).
- **swiss-pro (data-protection + auth spine):** §4 (PHI regime), §7 (identity/auth).
- **fhir-pro:** §6 (EPD/EPR integration + terminology/mCODE).
- **orchestrator (this session):** §2 (product & intended purpose — already decided), §12 (open decisions/owners/ratification), the decision-record + supersession scaffolding in Task 1.

---

## Task 1: Branch + charter skeleton (the already-decided spine)

**Files:**
- Setup: a fresh specs-repo branch (worktree to avoid disturbing the in-flight `adr/217-platform-admin-backend` checkout).
- Create: `layers/specs/concepts/oncology-product-charter.md`

- [ ] **Step 1: Cut an isolated specs branch off specs `origin/main`**

```bash
cd /d/development/projects/de-braighter/layers/specs
git fetch origin --quiet
# worktree keeps the current adr/217 checkout untouched (shared-working-tree concurrency)
git worktree add -b docs/oncology-product-charter ../specs-wt-oncology-charter origin/main
cd ../specs-wt-oncology-charter
```

- [ ] **Step 2: Create the charter file with frontmatter + all 12 section headers + the already-decided content**

Frontmatter must match the ADR-181 schema (same keys as `prototype-assumptions-charter.md`): `title`, `status: draft`, `created: 2026-06-07`, `last_updated: 2026-06-07`, `authors`, `domain: health / oncology`, `relates-to: [...]`, `ratified-by: []`.

**Required contents (author now, from the design brief):**
- The **decision record** table (design brief §2 — the 5 keystone decisions + that they override the handoff §4 leans).
- **§2 Product & intended purpose** — fully authored: the target IIb intended-use statement + the narrow v1 claim (survivorship decision-support + PRO-triage, risk-model in shadow/validation), breast-survivorship indication, user/patient populations, the continuous-improvement claim.
- The **resolving principle** ("design to IIb, claim narrow, escalate by evidence") as a framing block (design brief §3).
- **Empty section stubs** for §1, §3–§11 each with a one-line `<!-- owner: <agent> — see plan Task N -->` marker and the section's purpose sentence (from design brief §6). §12 stub too.

**Acceptance:** file parses; frontmatter has all ADR-181 keys; §2 + the decision record + resolving principle are complete; §1/§3–§12 are clearly-marked stubs.

- [ ] **Step 3: Commit**

```bash
git add concepts/oncology-product-charter.md
git commit -m "docs(concept): oncology product charter — skeleton + decided spine (§2, decision record)"
```

---

## Task 2: §1 Purpose, scope & supersession (owner: substrate-architect)

**Files:** Modify `concepts/oncology-product-charter.md` (§1)

- [ ] **Step 1: Read the actual prototype-charter pin rows BEFORE writing the supersession framing**

Run: read `concepts/prototype-assumptions-charter.md` in full. Record the *actual* definitions of every pin the product charter will touch (the design brief assumes D2=no-clinical-authority, D5=no-PHI, D7=demo-mode, D17=residency — but the prototype charter's own "Reconstruction note" warns these meanings are contested). **Confirm or correct the D-pin mapping against the real rows.** Carry the confirmed mapping into Task 8.

- [ ] **Step 2: Author §1**

**Required contents:**
- What this charter governs (the regulated oncology/health product) and that it is **domain-scoped** — the prototype charter still governs exercir/conservation prototypes.
- That this is a **domain product charter, NOT a kernel change** — ADR-176 kernel minimality holds; the four kernel concerns are unchanged; the product *consumes* the kernel (forward-reference §5 substrate-coherence in the design brief).
- The supersession thesis: it *replaces* specific prototype pins with regulated successors (detail deferred to §3–§5 + Task 8's note), **replacement not deletion**.

**Cite:** ADR-176 (kernel minimality), ADR-127 (kernel substrate v1), `prototype-assumptions-charter.md` (confirmed pin rows from Step 1), the design brief §1/§7.

**Acceptance:** §1 states domain-scope, the not-a-kernel-change posture, and the replacement-not-deletion thesis; the confirmed D-pin mapping is recorded for Task 8.

- [ ] **Step 3: Commit**

```bash
git add concepts/oncology-product-charter.md
git commit -m "docs(concept): oncology charter §1 — purpose, scope, domain-scoped supersession"
```

---

## Task 3: §9 Inference & survival-family + §11 demo→real transition (owner: substrate-architect)

**Files:** Modify `concepts/oncology-product-charter.md` (§9, §11)

- [ ] **Step 1: Author §9 — inference & the survival-family commitment**

**Required contents:** commits to building the **survival/time-to-event inference family** (the named 3rd-family gap; the 4 conjugate fast-paths don't cover it) to clinical-grade validation; that it is **demand-driven (Option A)** so ADR-176 holds; recurrence/survival is the modeled outcome for the breast-survivorship indication; the clinical-grade validation bar (forward-reference §3's clinical-evaluation strategy).

**Cite:** design brief §5 (substrate-coherence mapping), handoff brief §5, north-star §15.1, ADR-220 (WS-9 reproducibility — every model version is replayable evidence).

- [ ] **Step 2: Author §11 — demo→real transition**

**Required contents:** the gate from the prototype demo-mode regime (D7) to the real-PHI regime; what *flips* (PHI handling, consent, audit-on-real-PHI, RLS-on) vs. what *stays* (the kernel primitives, the plan-tree/twin model); the trigger that crosses the gate.

**Cite:** confirmed D7 pin (Task 2 Step 1), ADR-209 (tenants/RLS WS-4), the kernel `consent_receipt` + audit hash-chain, design brief §6 item 11.

**Acceptance:** §9 commits the survival family + the Option-A justification + validation bar; §11 names the flips/stays + the trigger.

- [ ] **Step 3: Commit**

```bash
git add concepts/oncology-product-charter.md
git commit -m "docs(concept): oncology charter §9 survival-family + §11 demo->real transition"
```

---

## Task 4: §3 Regulatory posture + §5 Clinical safety/authority (owner: swiss-pro)

**Files:** Modify `concepts/oncology-product-charter.md` (§3, §5)

- [ ] **Step 1: Author §3 — regulatory posture**

**Required contents:** MDR **Class IIb target** via the narrow→escalate path; **EU AI Act high-risk** (Art. 6) — the *dual regime* satisfied at once; the Swiss route (**MepV/MedDO + Swissmedic + CH-REP**); the **PCCP / predetermined-change-control** commitment (the bounded adaptation envelope for the continuously-learning device); the clinical-evaluation strategy (MDR Annex XIV); the standards stack the charter budgets for (**ISO 13485, ISO 14971, IEC 62304, IEC 82304**). State all risk-class claims as *indicative pending conformity assessment*.

- [ ] **Step 2: Author §5 — clinical safety & authority** (supersedes the confirmed clinical-authority pin)

**Required contents:** clinician-in-the-loop model; **AI Act Art. 14 human oversight**; the clinical-responsibility boundary; how this *replaces* the prototype's no-clinical-authority pin with a *regulated* clinical-authority line (not a relaxation); ties to the §8 staged-claim authority ladder.

**Cite:** design brief §3/§4, EU-MDR Rule 11, EU AI Act Art. 6 + Art. 14, MepV/MedDO, the confirmed clinical-authority pin (Task 2 Step 1). Flag any specific classification for regulatory-consultant confirmation.

**Acceptance:** §3 carries the dual regime + PCCP + standards stack + indicative-class hedging; §5 establishes the regulated clinical-authority line as a replacement.

- [ ] **Step 3: Commit**

```bash
git add concepts/oncology-product-charter.md
git commit -m "docs(concept): oncology charter §3 regulatory posture + §5 clinical authority"
```

---

## Task 5: §8 Staged-claim ladder + §10 Governance/change-control (owner: swiss-pro)

**Files:** Modify `concepts/oncology-product-charter.md` (§8, §10)

- [ ] **Step 1: Author §8 — the staged-claim ladder**

**Required contents:** explicit rungs from the narrow v1 claim to the full IIb claim, each rung a row of **{claim level × evidence required × regulatory step}**. Rung 0 = narrow market entry (survivorship decision-support + PRO-triage; risk-model in shadow). Top rung = combined risk-prediction + care-plan IIb. Must be consistent with §3's escalation and §6's EPD-write staging.

- [ ] **Step 2: Author §10 — governance, change-control & lifecycle**

**Required contents:** the **PCCP envelope** (what may change, on what data, validated how — without re-certification); **model-update governance via the ADR-216 adaptive-care gate** (ratify-additive-only; claim-widening as a governed promotion); **WS-9 reproducibility as the PCCP audit trail** (`run_manifest` + `distribution_catalog` + replay); post-market surveillance + vigilance/incident reporting; versioning.

**Cite:** design brief §3/§4/§5, ADR-215/216 (modeler-evolution gate), ADR-220 (WS-9). 

**Acceptance:** §8 ladder rungs align with §3 + §6; §10 binds PCCP↔WS-9 and claim-widening↔ADR-216 explicitly.

- [ ] **Step 3: Commit**

```bash
git add concepts/oncology-product-charter.md
git commit -m "docs(concept): oncology charter §8 staged-claim ladder + §10 change-control"
```

---

## Task 6: §4 PHI regime + §7 Identity/auth (owner: swiss-pro)

**Files:** Modify `concepts/oncology-product-charter.md` (§4, §7)

- [ ] **Step 1: Author §4 — data-protection & PHI regime** (supersedes the confirmed no-PHI/demo-mode/residency pins)

**Required contents:** the **nDSG/revFADP lawful basis** + consent architecture (+ GDPR for the EU market); **Swiss data residency** as a hard requirement (reaffirming + strengthening the residency pin); encryption at rest/in transit; **RLS secure-by-default (WS-4)**; the kernel **`consent_receipt` + audit hash-chain applied to real PHI**; nDSG retention/erasure; data-subject rights; **DPIA**.

- [ ] **Step 2: Author §7 — identity & auth**

**Required contents:** **HIN** (clinicians) / **AGOV** / **SwissID** (patients); the **AGOV-replacing-CH-LOGIN deadline (2026-10-31)** + the swiyu wallet timing as planning constraints.

**Cite:** design brief §4/§6, nDSG/revFADP, ADR-209 (RLS WS-4), the confirmed no-PHI/demo-mode/residency pins (Task 2 Step 1).

**Acceptance:** §4 names lawful basis + residency + encryption + RLS + consent/audit + retention + DPIA as the regulated replacement for the no-PHI pin; §7 names the auth providers + the AGOV deadline.

- [ ] **Step 3: Commit**

```bash
git add concepts/oncology-product-charter.md
git commit -m "docs(concept): oncology charter §4 PHI regime + §7 identity/auth"
```

---

## Task 7: §6 EPD/EPR integration + terminology/mCODE (owner: fhir-pro)

**Files:** Modify `concepts/oncology-product-charter.md` (§6)

- [ ] **Step 1: Author §6**

**Required contents:** the EPD/EPR posture — **full read + write as the *target*** (IHE MHD v4.2.2 + XDS, CH Core v7 / R4, the **Cara/Sanela Stammgemeinschaft**), **staged**: read-ingest activates in narrow-v1, **write-egress activates at a later staged-claim rung** (per §8). Terminology bindings (**LOINC / SNOMED CT / ICD / CHOP, mCODE, SPHN** for the KLS register) and the **breast-cancer mCODE profile set** as the first profiles. Name `@de-braighter/health-fhir` (`domains/health`, publish = `health#1`) as the EPD consumer. Defer the *detailed* ingest/egress mechanics to Deliverable B (the architecture ADR) — §6 sets posture, not mechanism.

**Cite:** design brief §6 item 6 + §9, handoff brief §3 Deliverable B (boundary), ADR-204 (FHIR eviction → health-fhir), CH Core v7 / IHE MHD v4.2.2.

**Acceptance:** §6 states the read+write target, the read-first/write-later staging tied to §8, the terminology + mCODE bindings, the health-fhir consumer, and the explicit Deliverable-B boundary.

- [ ] **Step 2: Commit**

```bash
git add concepts/oncology-product-charter.md
git commit -m "docs(concept): oncology charter §6 — EPD/EPR posture + terminology/mCODE"
```

---

## Task 8: §12 + supersession wiring + index (owner: orchestrator)

**Files:**
- Modify `concepts/oncology-product-charter.md` (§12)
- Modify `concepts/prototype-assumptions-charter.md` (supersession note)
- Modify `concepts/README.md` (index)

- [ ] **Step 1: Author §12 — open decisions, owners & ratification gate**

**Required contents:** the open items handed to the owners (design brief §8 — the precise nDSG basis, the conformity route, the exact narrow-v1 class, the mCODE profile set, the survival-family contract shape, PHI-safe kernel tenancy specifics); the **founder-ratification gate** (status flips draft→ratified on ratification); that the watchdogs (`charter-checker` + `exercir-charter-checker`) must pass.

- [ ] **Step 2: Add the domain-scoped supersession note to the prototype charter**

Using the **confirmed D-pin mapping from Task 2 Step 1**, add a clearly-marked note (near the top, after the Reconstruction note) stating that for the **regulated health domain only**, the named pins are superseded by `oncology-product-charter.md`, with a per-pin disposition table (replaced-by / reaffirmed). Do **not** renumber or delete any pin. Update the prototype charter's `last_updated` and add the new charter to its `relates-to`.

**Acceptance:** the note is domain-scoped, cites the new charter, gives per-pin disposition (replacement-not-deletion), touches no pin numbering.

- [ ] **Step 3: Index the new charter**

Add an entry for `oncology-product-charter.md` to `concepts/README.md` following the existing entry format.

- [ ] **Step 4: Commit**

```bash
git add concepts/oncology-product-charter.md concepts/prototype-assumptions-charter.md concepts/README.md
git commit -m "docs(concept): oncology charter §12 + domain-scoped supersession note + index"
```

---

## Task 9: Adoption ADR (owner: orchestrator)

**Files:** Create `adr/adr-NNN-adopt-oncology-product-charter.md` (number via `/adr-scaffolder`)

- [ ] **Step 1: Scaffold the ADR with correct numbering**

Run `/adr-scaffolder` (project ADR). Let it pick the next free number (memory: numbering collisions have happened — do NOT hand-pick; 215–220 are taken). This is the **adoption/governance ADR** that cites the charter and is the lifecycle vehicle for `draft → ratified` — distinct from **Deliverable B (the architecture ADR)**, which is out of scope here.

- [ ] **Step 2: Author the ADR body**

**Required contents:** Decision = adopt `oncology-product-charter.md` as the governance regime for the regulated health domain, superseding the confirmed prototype pins for that domain. Context = the second-brick pick + the load-bearing tension (handoff §1). Consequences = real-PHI code becomes writable under the charter regime; the dual MDR+AI-Act commitment; the PCCP obligation. Status: `proposed` (→ `accepted` on founder ratification). Link the charter + the design brief + the handoff brief.

**Acceptance:** ADR validates against ADR-181 frontmatter; cites the charter; status `proposed`; clearly scoped as adoption-not-architecture.

- [ ] **Step 3: Commit**

```bash
git add adr/adr-NNN-adopt-oncology-product-charter.md
# + any index/kanban update the adr-scaffolder makes
git commit -m "docs(adr): ADR-NNN — adopt the oncology product charter (proposed)"
```

---

## Task 10: Coherence pass + doc gates

**Files:** read-only over the charter + ADR; fix-forward on findings

- [ ] **Step 1: End-to-end coherence pass (the document "integration test")**

Read the assembled charter §1–§12 in order. Verify cross-section consistency: the §8 staged-claim ladder ↔ §3 escalation ↔ §6 EPD-write staging tell *one* story; §10 PCCP ↔ §9 survival-family ↔ ADR-220 are consistent; §1's replacement-not-deletion ↔ §4/§5's regulated successors ↔ Task 8's per-pin note all agree; no section contradicts the decision record. Fix any drift inline + commit.

- [ ] **Step 2: Run `/md-quality-review` on the charter + ADR**

Run the `md-quality-review` skill (structural + content + markdownlint, the specs-repo config). Fix findings to green.

- [ ] **Step 3: Dispatch `spec-auditor`**

Dispatch the `spec-auditor` agent (read-only) over the specs branch: cross-refs resolve, ADR numbering has no collision, dependency closure holds, frontmatter conforms (ADR-181), `relates-to` links are valid. Fix findings.

- [ ] **Step 4: Commit fixes**

```bash
git add -A
git commit -m "docs(concept): oncology charter — coherence pass + spec-auditor/md gates green"
```

---

## Task 11: Charter-checker watchdogs

**Files:** read-only; fix-forward on findings

- [ ] **Step 1: Dispatch `charter-checker` and `exercir-charter-checker` in parallel**

Both read-only, `isolation: worktree`. They must confirm the supersession is **explicit, domain-scoped, and replacement-not-deletion** — every removed prototype rail has a named regulated successor, and exercir/conservation prototypes remain governed by the unchanged prototype charter. They walk the D-pin coverage; the per-pin note (Task 8) must satisfy that walk.

- [ ] **Step 2: Resolve findings**

Address every blocking finding inline (likely: a pin whose successor isn't explicit enough, or a scope leak). Re-dispatch if a fix is non-trivial. Commit.

```bash
git add -A
git commit -m "docs(concept): oncology charter — charter-checker findings resolved"
```

---

## Task 12: Open the specs PR + ratification gate

- [ ] **Step 1: Push + open the specs-repo PR**

```bash
git push -u origin docs/oncology-product-charter
gh pr create --repo de-braighter/specs --title "docs: oncology product charter (sub-project #1, Deliverable A)" --body "<summary + Producer:/Effect: lines per workbench convention; links the design brief + handoff brief>"
```

- [ ] **Step 2: Run the twin ritual + present to the founder for ratification**

After the verifier wave: `drain` the wave verdicts (devloop ritual). Present the charter to the **founder for ratification** — ratification is the real "done" gate. On ratification: flip the charter `status: draft → ratified`, set `ratified-by:` to the founder + the adoption ADR, and the ADR `proposed → accepted`. After merge: `backfill` + `reconcile` (twin ritual is mandatory).

- [ ] **Step 3: Clean up the worktree**

```bash
cd /d/development/projects/de-braighter/layers/specs
git worktree remove ../specs-wt-oncology-charter
```

---

## Self-review (run before execution)

**Spec coverage:** Every design-brief §6 section (1–12) maps to a task — §2+decision-record+principle→T1; §1→T2; §9,§11→T3; §3,§5→T4; §8,§10→T5; §4,§7→T6; §6→T7; §12+supersession+index→T8. The adoption ADR (lifecycle vehicle)→T9. The watchdogs + gates (design brief §7 supersession soundness)→T10–T11. Ratification gate (design brief §2/§12)→T12. Deliverable B + sub-projects #2–4 are explicitly out of scope (design brief §9). ✔

**Placeholder scan:** `adr-NNN` is intentional (numbered by `/adr-scaffolder` at execution — hand-picking risks a collision per memory); the PR body `<summary…>` is filled at PR time. No "TBD/handle-appropriately" content steps. ✔

**Type/name consistency:** file paths (`oncology-product-charter.md`), section numbers (§1–§12), agent owners, and the WS-9/ADR-216/ADR-204/ADR-209/ADR-176 citations are consistent across tasks. The D-pin mapping is deliberately *not* hardcoded — confirmed once in T2 Step 1 and reused in T8. ✔
