# Claim-ontology dossier — assessment against the existing kernel (2026-06-13)

**Source:** `docs/substrate-claim-ontology-dossier-2026-06-13.html` (founder-supplied,
"Substrate — Gespräch von A bis Z", an editorial reconstruction of an external
discussion that started from the B3 survival statistics — KS supremum, Weibull,
Kaplan-Meier — and generalized to a claim-centric minimal ontology).

**Status:** assessment only. No spec, ADR, or code change. Pending founder decision
on landing (see §6).

## 1. Verdict up front

The dossier is **the kernel's missing semantic theory, not a re-foundation
proposal** — and it should be landed exactly as that.

Read literally, it proposes `Term / Claim / Context` as *the* primitives, which
would be a substrate-v3 rewrite. Read correctly, it supplies the **unifying
"why"** behind the four kernel concerns that ADR-127/ADR-176 ratify by form but
never derive from first principles. The four concerns turn out to be the claim
ontology's *normal form* — claims specialized with load-bearing invariants:

> The plan tree is the kernel's store of **committed/normative claims** (with the
> single-parent invariant). The event log is its store of
> **observed/measured/performative claims** (with the append-only invariant).
> Inference produces **inferred/predicted claims** (beliefs = claims about
> claims). Reproducibility *is* the Context + Revision axioms (every claim
> scoped, nothing overwritten).

Almost every "axiom" in the dossier is already ratified kernel doctrine under a
different name. What is genuinely new is small, nameable, and feeds the two
queued frontiers (registry v1 ADR; oncology O-1).

## 2. Mapping: dossier concept ↔ existing kernel reality

| Dossier (axiom / concept) | Existing kernel reality | Where ratified |
|---|---|---|
| Axiom 4 — claims revised, never overwritten | Append-only event log; event-sourcing; run manifests | ADR-127 concerns #2/#4 |
| Axiom 6 — **state is projection**, not a primitive | **"Store generators, derive graphs"** — derived views never authoritative | ADR-176 §4, verbatim the same principle |
| Axiom 7 — trajectory is ordered projection | Derived views over the event log; the B3 survival family (Weibull/KM/`kmSupDivergence`) *is* the trajectory engine | substrate 2.0.0 (B3 S1–S5) |
| Axiom 8 — belief is a claim about a claim | Inference: plan + observations → posteriors | ADR-127 concern #3 |
| Axiom 10 — intervention is a performative claim | Plan-tree intervention nodes with typed effect declarations | ADR-127 concern #1; ADR-154 |
| Context (scope, time, model version, scenario, fork) | `tenant_pack_id` scoping; versioned catalogs; run manifests; `counterfactual()` forks | ADR-027; ADR-127 concern #4; inference port |
| Axiom 5 — contradictions are storable | Cross-pack comorbidity **detection** (kernel flags, never resolves) | ADR-176 worked-precedent #5; north-star §9.5 |
| Claim Store / Projection / Belief / Trajectory engines | event log / read models / inference backbone / survival family | shipped |
| Governance Engine | PolicyEngine + consent-bound service + audit (`kernel.AuditEvent`) | ADR-027 §6 |
| Hot / Semantic / Analytical runtime paths | Exactly the existing posture: no synchronous inference in request paths; CQRS read models; batch/async analytics | substrate conventions |
| Negative test — no hard-real-time primary runtime | Implied but never stated this cleanly | **new articulation** |

Provenance note worth savoring: the discussion *started* from Kolmogorov-Smirnov,
Weibull, and Kaplan-Meier — the exact statistics the substrate shipped as 2.0.0's
survival family this week (`kmSupDivergence` is literally a KS-style sup
statistic). The dossier is the founder's own kernel reflected back through an
abstract lens — and the lens reinvented the portfolio (§4 below).

## 3. What is genuinely new (the "brings us forward" part)

1. **The unifying semantics itself.** Today the kernel has four concerns with no
   single theory of why *those* four. "Contextualized claims over terms; states,
   beliefs, trajectories, interventions, outcomes are derived views" is that
   theory. It gives design reviews a second, independent validation instrument:
   anything proposed for the kernel should be expressible as a claim-mode or a
   projection — if it isn't, that's a smell ADR-176's inclusion test can't catch
   on its own.
2. **Claim modes as a typed vocabulary** (observed / measured / inferred /
   predicted / formal / normative / performative / assumed / committed). The
   event log doesn't distinguish these as a first-class dimension. This is
   *pack-event-taxonomy* guidance (versioned `.vN` event types), not a kernel
   column — but it's a good naming discipline for every new pack.
3. **The Evidence relation (`supports` / `contradicts`) between claims.** This is
   the one ontology element with **no kernel counterpart**. Inference consumes
   events wholesale; nothing models one claim weighing on another. Under the
   ADR-176 inclusion test it stays pack territory today (no ≥2-pack demand), but
   oncology (guideline-vs-observation, evidence grading) is the likely first real
   consumer — track it as a *potential future promotion*, not a now-build.
4. **The latency classification + the clean negative-test sentence** ("Substrate
   can describe, audit, simulate, and govern hard-real-time systems — but should
   not claim-natively drive them"). The cluster has lived this posture; nobody
   has written the boundary down this quotably.
5. **The Behandlungspfad pattern as product architecture for oncology.** "A
   treatment path is a *normative* trajectory of claims; the real treatment is an
   *observed* trajectory of claims; decision support = comparing both under
   evidence, uncertainty, context" — that is a one-sentence product spec for the
   queued oncology T2 build (O-1 foundation onward), including the explicit
   stance that a 10-minute best-justified *proposal* (never "the ideal path") is
   acceptable and desirable.

## 4. The portfolio coincidence (strong validation signal)

The dossier "design-proofs" the ontology against seven domains chosen in the
abstract. Five of the seven already exist in the cluster as built or queued
domains:

| Dossier design proof | Cluster reality |
|---|---|
| Fussball-Coaching | `domains/exercir` pack-football — live |
| Landwirtschaftliche Systeme | `domains/agri-ecosystem-twin` — in flight (E2.2) |
| Behandlungspfade | oncology T2 — queued (workbench#129, 7 items) |
| Synthetic Reality (forked contexts) | the what-if / `counterfactual()` lane (exercir, gridiron) |
| AI Agent Governance | the foundry + devloop SDLC twin (loosely: normative claims over agent behavior, performative claims over actions, gates) |
| Marketing-Kampagnen | untested — product-ideas-backlog territory |
| Case Management | untested |

An abstract ontology that independently re-derives the existing product
portfolio is meaningful evidence the kernel's shape generalizes — this is the
strongest pro-thesis signal since the C1–C5 ladder.

## 5. The danger: the re-foundation reading

If `Claim` were adopted as a *storage primitive* (one generic claims table,
everything a row), the kernel would hit precisely the trap ADR-176
"Alternatives Considered #2" already rejected for the general property-graph:

- A tree is a claim-set **with invariants** (single-parent, acyclic), and those
  invariants are load-bearing — they make edit verbs well-defined, the closure
  table possible, traversal total.
- An append-only log is a claim-set **with an ordering invariant** — it's what
  makes replay and reproducibility tractable.
- A generic Claim store has *fewer guarantees*: complexity relocates from the
  kernel (solved once) to every consumer (solved N times).

The dossier itself contains the disarming move: "Diese Schichten sind
Architekturmechanik, keine neuen Ontologie-Primitive." The landing must make
this binding: **the claim ontology is the semantic layer; the four concerns
remain the storage/runtime normal form. No `kernel.claim` table. ADR-176
unchanged.**

## 6. Recommended landing

1. **One concept doc** in `layers/specs/concepts/design/` (tier: design, scope:
   cluster): *"Claim ontology — the semantic theory of the substrate kernel"*.
   Contents: the Term/Claim/Context ontology + axioms; the §2 mapping table
   (kernel concern ↔ claim specialization); claim-mode vocabulary as pack-event
   naming guidance; the latency classification + negative-test boundary; the
   explicit non-goals (no new primitives, no re-foundation, ADR-176 governs).
   PR-gated with `spec-auditor` + `md-quality-review` per specs repo rules.
2. **Feed the registry v1 designer-first ADR** (the post-specs#302 next step):
   published `bridge.*`/pack subtrees are precisely *normative/committed claim
   bundles imported into a tenant's context* — the claim framing hands the
   registry its content-model semantics for free.
3. **Feed oncology O-1** with the §3.5 Behandlungspfad pattern (normative vs
   observed trajectory; versioned, revisable, justified proposals).
4. **Track, don't build:** the Evidence relation (supports/contradicts) as a
   named candidate for future `metadata`→kernel promotion, demand-driven per
   ADR-176 §3, with oncology as the probable first demander.
5. **Do not** open any substrate code change off this document.

## 7. Open questions for the founder

- Land the concept doc now, or fold the material directly into the registry-v1
  ADR as its semantics section? (Recommendation: separate concept doc — the
  registry ADR should *cite* the theory, not carry it.)
- Should the claim-mode vocabulary become a recommended (non-gating) convention
  for new pack event types?
- Does the dossier's "Substrate ist die Runtime für revidierbare Beschreibungen
  beobachtbarer Systeme" formula belong in the north-star as a §-level
  positioning sentence? (It is internal-framing-safe under Option A.)
