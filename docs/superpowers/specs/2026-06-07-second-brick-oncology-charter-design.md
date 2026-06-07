# Second Brick — Oncology Product Charter: Design Brief (sub-project #1, Deliverable A)

- **Status:** design brief — keystone decisions resolved; full charter authoring is the next phase.
- **Date:** 2026-06-07
- **Author:** orchestrator session (founder-directed brainstorming)
- **Supersedes-context:** scopes and decides the keystones for the **product charter** that will supersede
  `layers/specs/concepts/prototype-assumptions-charter.md` for the regulated health domain.
- **Owners (full-charter authoring):** `swiss-pro` (regulatory / nDSG / EPD / auth) · `fhir-pro` (EPD-FHIR / terminology / mCODE) ·
  `substrate-architect` (PHI-safe kernel tenancy + how the pathway/survival/reproducibility spine composes).
- **Ratification gate:** the founder ratifies the charter; `charter-checker` + `exercir-charter-checker` must pass the supersession.
- **Founder pre-ratification (2026-06-07):** the founder **pre-ratified** the charter these keystone decisions define ("it's ratified"). The eventual `status: draft → ratified` flip is carried on this authority *once the authored charter passes the watchdog gates faithfully encoding §2's decisions* — **no separate ratification ceremony**. Condition: a **material deviation** surfaced during specialist authoring (e.g. risk class lands at MDR Class III not IIb; the narrow-v1 market-entry claim is legally untenable; EPD-write staging conflicts with a Stammgemeinschaft requirement) is a *new decision* and escalates to the founder — it is not covered by the pre-ratification.
- **Predecessor:** `docs/superpowers/specs/2026-06-07-second-brick-oncology-handoff.md` (workbench PR #82).

---

## 1. What this brief is (and is not)

This is the **brainstorming output** for sub-project #1, **Deliverable A — the product charter**. It records the founder-ratified
keystone decisions, the resolving principle that makes them coherent, the regulatory implications, the substrate-coherence mapping,
and the charter's section structure. It is **not** the charter itself: the full charter is authored next by the specialist agents
(swiss-pro / fhir-pro / substrate-architect) as a PR-gated `layers/specs/concepts/` document, with a superseding note on the
prototype-assumptions-charter.

**Deliverable B — the real-data architecture ADR — is explicitly out of scope here** (its own spec → plan cycle; see §10).

## 2. Decision record — keystone decisions (founder-ratified 2026-06-07)

The handoff brief (`…-oncology-handoff.md` §4) carried *leans* toward a tightly-scoped, low-regulatory-load v1
(decision-support only, read-only EPD, "scope it tight so it is tractable"). **The founder overrode those leans toward the
maximal target**, with a narrow-claim market entry as the tractability mechanism instead of a narrow *product*. Recorded as
new decision events with rationale:

| # | Decision | Handoff §4 lean | **Founder choice (ratified)** |
|---|---|---|---|
| 1 | Clinical-authority posture | Decision-support; stay out of MDR | **MDR medical device** (regulated clinical authority) |
| 2 | EPD/EPR integration depth | Read-only ingest first | **Full read + write** (IHE MHD + XDS, Stammgemeinschaft) |
| 3 | First indication | "Pick one cancer + one stage" | **Breast cancer — survivorship** |
| 4 | Intended purpose | (not in §4) | **Combined risk-prediction + care-plan decision support, continuously self-improving** |
| 5 | v1 legal/operational basis | "Scope it tight" | **Narrow-claim market entry → escalate to the full IIb claim by evidence** |

**Indicative regulatory consequence of (4):** the combined claim (a wrong output could contribute to serious deterioration —
e.g. under-surveillance from an under-stated recurrence risk) places the *target* device at **MDR Class IIb** under Rule 11,
and — as a continuously-learning clinical-decision AI — simultaneously a **high-risk AI system under the EU AI Act** (Art. 6).
Risk class is indicative pending the conformity-assessment / notified-body determination in the specialist design pass.

## 3. The resolving principle — "design to IIb, claim narrow, escalate by evidence"

The named risk in "narrow entry → IIb" (decision #5) is the **two-products trap**: building a narrow product first and then
*rebuilding* it for IIb — two codebases, two validations, wasted years. The charter's central commitment kills that trap:

> **Build the full IIb engine from day one; let the market-facing *claim* start narrow and widen as real-world evidence accrues.
> Re-certify upward — never rebuild.**

| Layer | Day-one commitment | Escalates to |
|---|---|---|
| **Engine / architecture** | Full IIb twin: survival inference + continuous-improvement loop + EPD read/write, built to ISO 13485 / 14971 / IEC 62304 / 82304 spec | (built once — unchanged) |
| **Market-facing claim** | Narrow: survivorship-care decision-support + PRO-monitoring/triage (≈ IIa, possibly borderline-wellness). The recurrence/survival risk-model runs in **shadow / validation mode** — generating evidence, **not yet claimed** | Combined risk-prediction + care-plan **IIb** claim, via PCCP-governed evidence promotion |
| **Legal basis** | Market entry under the narrow claim + the nDSG/revFADP real-PHI regime; risk-model validation on consented real-world data | MDR IIb conformity assessment + AI-Act high-risk conformity |

This is only feasible because of the substrate (see §5): every model version is replayable evidence (WS-9), and claim-widening is a
*governed promotion* (ADR-216), not a new build. **The narrow claim and the IIb target are the same artifact at two certification
levels** — the sentence the charter exists to establish.

## 4. Regulatory implications the charter must carry

- **Dual regime, satisfied at once:** MDR (device) **and** EU AI Act (high-risk AI). For the Swiss market: MDR mirrored via the
  **MepV / MedDO + Swissmedic + a CH-REP**; the AI Act bites for EU-market access (CH is converging). Both frameworks' obligations
  must be designed in, not retrofitted.
- **Predetermined Change Control Plan (PCCP):** a continuously-learning device that changes behaviour post-market normally re-triggers
  conformity assessment per update. The accepted escape is a PCCP — a pre-declared **bounded adaptation envelope** (what may change, on
  what data, validated how) so in-envelope updates avoid re-certification. This is the single hardest pattern in the regime and the
  keystone the founder chose; it is where the substrate earns its keep.
- **Human oversight (AI Act Art. 14)** + the clinician-in-the-loop boundary replace prototype-charter D2 (no-clinical-authority) with a
  *regulated* clinical-authority line, not a relaxation.
- **Standards stack the charter budgets for:** ISO 13485 (QMS), ISO 14971 (risk management), IEC 62304 (software lifecycle),
  IEC 82304 (health software), plus the clinical-evaluation strategy (MDR Annex XIV) and post-market surveillance / vigilance.

> All regulatory specifics in this section are the *shape* the charter must address; the precise classifications, conformity routes,
> and CH/EU obligations are confirmed by `swiss-pro` (+ a regulatory consultant) when authoring the full charter.

## 5. Substrate-coherence mapping (why this is the substrate's telos, not new kernel work)

The product **consumes already-shipped primitives**; it does not ask the kernel to grow (ADR-176 minimality holds). The mapping:

| Product need | Shipped substrate primitive | Source |
|---|---|---|
| PCCP audit trail: versioned, reproducible, replayable model updates | **WS-9 reproducibility** — `run_manifest` + `distribution_catalog` + bit-identical replay | ADR-220 |
| Claim-widening as a *governed promotion* (the continuous-improvement valve) | **ADR-216 adaptive-care gate** — gated AI model-change proposals (ratify-additive-only) | ADR-215/216 |
| Recurrence/survival as the modeled outcome | **Survival / time-to-event inference family** — the named 3rd-family gap, now domain-motivated (demand-driven, Option A) | handoff §5; north-star §15.1 |
| The survivorship journey as a model | **Recursive plan-tree + effect declarations** (plan = model, twin = runtime) | ADR-199/200 |
| Patient / tumor / cohort as first-class subjects | **WS-8 subject generalization** | ADR-213 |
| Real-PHI tenancy isolation | **RLS secure-by-default** (WS-4) + audit hash-chain + `consent_receipt` | ADR-209 |
| EPD ingest → kernel + pathway → `CarePlan`/`PlanDefinition` egress | **`@de-braighter/health-fhir`** (relocated, `domains/health`; publish = `health#1`) | ADR-204 |

**Net:** the survival family is the only genuinely new modeling work, and it is *pulled by the product* (Option A), not speculative.
Everything else is the platform doing the job it was built for.

## 6. Charter structure (Deliverable A — the sections the full charter will contain)

1. **Purpose, scope & supersession** — what this governs; the *domain-scoped* supersession of the prototype charter (the prototype
   charter still governs exercir/conservation demos); relationship to ADR-176 + the four kernel concerns (a domain product charter,
   **not** a kernel change).
2. **Product & intended purpose** — the device; the **target IIb intended-use statement** + the **narrow v1 claim**; breast-survivorship
   indication; user/patient populations; the continuous-improvement claim.
3. **Regulatory posture** — MDR IIb target via narrow→escalate; EU AI Act high-risk; Swiss MepV/MedDO + Swissmedic + CH-REP; the
   **PCCP / change-control** commitment; clinical-evaluation strategy; the standards stack (§4).
4. **Data-protection & PHI regime** (supersedes D5/D7/D17) — nDSG/revFADP lawful basis (+ GDPR for the EU market), Swiss data residency,
   encryption at rest/in transit, RLS (WS-4 secure-by-default), consent (kernel `consent_receipt` + audit on real PHI), retention/erasure,
   data-subject rights, DPIA.
5. **Clinical safety & authority** (supersedes D2) — clinician-in-the-loop, AI-Act Art. 14 human oversight, clinical-responsibility
   boundary, the staged-claim authority ladder.
6. **EPD/EPR integration posture** — full read + write *target* (IHE MHD + XDS, CH Core v7 / R4, Cara/Sanela Stammgemeinschaft),
   staged (read-only ingest in narrow-v1, write-back later); terminology bindings (LOINC / SNOMED CT / ICD / CHOP, mCODE, SPHN) →
   defers depth to Deliverable B.
7. **Identity & auth** — HIN (clinicians) / AGOV / SwissID (patients); the AGOV-replacing-CH-LOGIN deadline (2026-10-31) + swiyu timing.
8. **The staged-claim ladder** — explicit narrow→IIb rungs: claim level × evidence required × regulatory step at each rung.
9. **Inference & the survival-family commitment** — commits to building the survival/time-to-event family to clinical-grade validation.
10. **Governance, change-control & lifecycle** — PCCP envelope, model-update governance via ADR-216, post-market surveillance + vigilance,
    versioning.
11. **Demo→real transition** — the gate from demo-mode to real-PHI; what flips, what stays.
12. **Open decisions, owners & ratification gate** — unresolved items handed to swiss-pro / fhir-pro / substrate-architect (+ a regulatory
    consultant); the founder-ratification gate.

## 7. Supersession scope (what the charter replaces, and how the watchdogs pass)

The product charter is **domain-scoped**: it governs the regulated oncology/health product; the prototype-assumptions-charter continues
to govern the exercir/conservation prototypes. Within the health domain it replaces three load-bearing prototype assumptions with their
*regulated counterparts* (replacement, not relaxation) and reaffirms a fourth:

| Prototype assumption | Disposition under the product charter |
|---|---|
| **D2 — no clinical-content authority** | **Replaced** by a regulated clinical-authority line (MDR device + AI-Act human oversight; clinician-in-the-loop) |
| **D5 — no real PHI** | **Replaced** by a lawful real-PHI regime (nDSG/revFADP basis + encryption + RLS + consent/audit) |
| **D7 — demo-mode** | **Replaced** by the demo→real transition gate (§6 charter, item 11) |
| **D17 — Swiss data residency** | **Reaffirmed and strengthened** (residency as a hard requirement for real PHI) |

`charter-checker` + `exercir-charter-checker` must confirm the supersession is *explicit, domain-scoped, and replacement-not-deletion* —
i.e. every removed rail has a named regulated successor.

## 8. Open items for the specialist design pass (handed to the owners)

When authoring the full charter, the owners resolve (non-exhaustive):

- **swiss-pro:** the precise nDSG/revFADP lawful basis + consent architecture; the MepV/Swissmedic/CH-REP route + the AI-Act high-risk
  obligations; the PCCP shape; the QMS/clinical-evaluation commitments; the auth regime (HIN/AGOV/SwissID) + the AGOV deadline.
- **fhir-pro:** the EPD-FHIR read+write conformance (IHE MHD v4.2.2 + XDS, CH Core v7 / R4); terminology bindings + the breast-cancer
  mCODE profile set; the `health-fhir` publish (`health#1`) as the EPD consumer.
- **substrate-architect:** PHI-safe kernel tenancy (real-PHI rows under RLS + encryption + consent/audit); how the survivorship
  pathway plan-tree + survival twin + WS-9 reproducibility + the ADR-216 gate compose; the survival-family contract shape.
- **The narrow v1 claim** — confirm the entry claim is *survivorship decision-support + PRO-triage* (proposed) vs. an alternative
  narrow framing; pin the exact regulatory class of the entry rung.

## 9. Out of scope (separate cycles, do not absorb)

- **Deliverable B — the real-data architecture ADR** (EPD-FHIR ingest → kernel; PHI-safe tenancy; the pathway/survival/reproducibility
  spine; health-fhir egress). Its own spec → plan cycle.
- **Sub-projects #2–#4** (the care-pathway modeler + survival family; journey slices + vendor registry + adaptive-care gate; health-fhir
  egress + EPD write) — pulled in as the product needs them (Option A).

## 10. Citable artifacts

- `docs/superpowers/specs/2026-06-07-second-brick-oncology-handoff.md` — the predecessor brief (workbench PR #82).
- `layers/specs/concepts/prototype-assumptions-charter.md` — the charter being superseded (D2/D5/D7 load-bearing; D17 reaffirmed).
- `layers/specs/adr/adr-218-north-star-critical-path-sequencing.md` — the sequencing this product sits at the end of.
- `layers/specs/concepts/substrate/case-management-second-brick-2026-06-05.md` — the second-brick framing + the four gaps + the acid test
  (this program's vertical pick overrides its lean-C recommendation — a founder call, now extended to the maximal-target posture).
- `layers/specs/concepts/swiss-top5-cancer-pathways.md` — prior clinical-pathway domain knowledge (reusable; the *Exercir-pack/ADR-033
  synthetic framing* is superseded by this real-clinical-data charter).
- ADRs: 204 (FHIR eviction → health-fhir), 213 (subjects/WS-8), 220 (reproducibility/WS-9), 209 (tenants/RLS), 199/200 (plan-tree +
  effects), 215/216 (the modeler-evolution gate), 027 (pack-on-platform), 176 (kernel minimality), 032 (superseded FHIR-export rationale).
- `layers/specs/concepts/substrate/north-star-vision-capture-2026-05-17.md` — §4.2 the collapse, §15.1 inference cost, §15.2 registry,
  §19.5 Option A.
- Agents: `swiss-pro`, `fhir-pro`, `substrate-architect` (authoring); `charter-checker` + `exercir-charter-checker` (supersession watchdogs).
