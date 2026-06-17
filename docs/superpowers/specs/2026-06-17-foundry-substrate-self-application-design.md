---
title: "Foundry as a Substrate self-application — v0 design (the product-creation metamodel)"
status: design (pre-scaffold) — for review
kind: technical-design
created: 2026-06-17
author: stibe
relates-to:
  - docs/substrate-foundry-vision-capture-2026-06-16.md
  - layers/specs/concepts/design/2026-06-16-substrate-foundry-product-synthesis-ring.md
  - domains/devloop/docs/design/self-hosting-devloop.md
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
  - layers/specs/adr/adr-127-kernel-substrate-v1.md
  - layers/specs/adr/adr-154-algebraic-effect-declarations-and-composition-operators.md
  - layers/specs/adr/adr-027-pack-architecture.md
  - layers/specs/adr/adr-192-sanction-pack-devloop-pack-on-platform-zero-kernel-change.md
  - layers/specs/adr/adr-193-pack-devloop-effect-declarations-are-calibratable-claims.md
note: >
  Brainstormed design (superpowers:brainstorming). Captures the founder-approved
  v0 slice of modelling Foundry itself as a Substrate product: a product-creation
  metamodel ("both faces, one recursive tree") delivered descriptive-only, with
  ZERO kernel change (ADR-176), acid-tested by re-expressing a second shipped
  product. Implementation plan (superpowers:writing-plans) follows founder review
  of this spec.
---

# Foundry as a Substrate self-application — v0 design

> **The move.** Model Foundry — the machine we build products with — as itself a
> Substrate product. v0 is **descriptive only**: author the product-creation model
> as kernel data, observe the events that already flow, derive a few posteriors,
> and prove the model is *reusable* by re-expressing a second already-shipped
> product on it with zero new shapes. Zero kernel change; the running Foundry
> machine is untouched. This is the cheapest falsifiable bet on an ambitious
> target (the full "both faces" product-creation metamodel).

---

## 0. Revision 2 (2026-06-17) — corrected against the codebase

The plan-author pass found the codebase already further along than §1/§3/§13
assumed. **`domains/foundry` already exists** as the doing-machine and is
**already event-sourced** (`src/events.ts` typed events · `src/log.ts` append-only
JSONL log over `DomainEventEnvelope` · `src/state.ts` derived state · `src/wt-pool.ts`
lease/capacity · `src/mcp/` the MCP server). **`domains/devloop` already** has
`ingest/` (reads foundry events), `plan/` (derives a plan tree) and `inference/`
(posteriors/calibration). So:

- The merge (D7) is **into the existing `domains/foundry`**, keeping its log
  canonical — not a new domain, not a rename. After the merge the doing-machine is
  **co-located** with the twin; "untouched" means *its `ops.ts` coordination logic
  is not rewired* (still v1), not that it lives apart.
- Much of v0's observe+infer (the "ingester", the posteriors) **already exists** in
  devloop and is **repointed**, not built from scratch.
- **v0 therefore shrinks to three things:** (1) merge the two domains (move modules,
  tests stay green), (2) add the genuinely-new **metamodel** (substance/resource
  faces + the two instances), (3) the genericity acid-test. §13 below is superseded
  by the plan's phase list.

The decisions (§2, incl. D7), the metamodel (§4), the four-concern spine (§5), the
acid test (§9) and the governance (§12) are unchanged by this correction.

---

## 1. Provenance & motivation

The direction comes from the founder/ChatGPT brainstorm *"Produktfabrik durch
Substrate"* (mirrored at `docs/substrate-foundry-vision-capture-2026-06-16.md`;
distilled into the citable concept
`layers/specs/concepts/design/2026-06-16-substrate-foundry-product-synthesis-ring.md`).
Its load-bearing idea: Foundry is the *product-synthesis ring*, and it should be
**bootstrapped as the first product modelled in Substrate** — dogfooding that makes
every kernel weakness surface on the most-exercised workload, with improvements
compounding across all later products.

**Why now / why this is not greenfield.** The cluster already holds **two halves
that don't share a spine**:

- **The Foundry machine** — bespoke MCP coordination state (`foundry_claim` /
  `_next` / `_gate_*` / queue / leases). The *doing* side. Not on the kernel.
- **`pack-devloop`** (`domains/devloop`) — the SDLC already modelled as a Substrate
  read-twin (ratified ADR-192/193; four-concern mapping; *already ingests Foundry
  events*). The *observing* side.

So "migrate Foundry to a Substrate product" is really: **do the doing-machine and
the twin collapse onto one kernel plan tree + event log?** This v0 takes the first
step toward "yes" — the **twin (`pack-devloop`) is merged into `domains/foundry`**
(it becomes foundry's observation+inference concern), while the **doing-machine
(Foundry MCP) stays separate and is only observed** (no rewire — that is the held v1
line). The three-way split (machine + twin + new model) collapses to two: the
doing-machine, and the product (foundry = absorbed twin ⊕ metamodel ⊕ instances).

## 2. Founder-approved decisions (the brainstorm record)

| # | Decision | Choice |
|---|---|---|
| D1 | **Primary win** | *Reusable product-creation template* — one model; Foundry = first self-hosting instance; whales/agri/oncology = later instances of the same model. |
| D2 | **Blueprint scope** | *Both faces, one recursive model* — the model declares the product's **substance** AND its **build-process** as one tree. |
| D3 | **First slice** | *Descriptive v0* — model + observe. No driving, no generation. |
| D4 | **`ai` resource** | *First-class typed resource + capacity* — `ai`/`human`/`compute` typed refs on nodes; warm-pool capacity **observed** (not scheduled) in v0. |
| D5 | **Home/structure** | *A `domains/foundry` product formed by **merging `pack-devloop` into it*** — the SDLC read-twin becomes foundry's observation+inference concern (`domains/devloop` re-homed/absorbed, tests staying green), then extended with the metamodel + substance face + instances. The Foundry MCP **doing-machine** stays separate and observed (not rewired) in v0. |
| D6 | **`WorkItem` grain** | *Story (epic-item)* — the leaf is a **story**, not a single PR. The PRs that implement a story attach to it as observations (their `Producer:`/`Effect:` lines feed the story node's run-manifest + effect). |
| D7 | **Merge approach** (codebase reality) | *Keep `@de-braighter/foundry`'s log canonical, move modules in* — absorb `domains/devloop` **into the existing `domains/foundry`**: keep foundry's `events.ts`/`log.ts`/`state.ts`/`wt-pool.ts` canonical; **move** devloop's `ingest`/`plan`/`inference` into foundry and **repoint** them at foundry's log; the metamodel rides foundry's existing log. Defer full log-unification. |

## 3. Architecture (the boundary)

`domains/foundry` is formed by **absorbing `domains/devloop`** (the SDLC read-twin)
and extending it. It **composes** the four kernel concerns via the published
`@de-braighter/substrate-*` packages — **zero kernel change** — the posture
`pack-devloop` already proved (ADR-192/193). The absorbed twin brings its tested
observation log + inference; the new work adds the metamodel, the substance/resource
faces, and the two product instances. The Foundry MCP doing-machine is **not**
absorbed in v0 — it stays a separate actuator whose event stream foundry *reads*.
All domain-specific shape lives in a **typed pack lib + `metadata` JSONB**.

```text
domains/foundry  (= domains/devloop, grown up)
  ├─ twin         (ABSORBED pack-devloop: observation log + inference)  ← CI/review/retro events
  ├─ metamodel    (typed pack lib: node / resource / substance vocabulary)
  ├─ instances    (authored kernel data: Product(foundry) + Product(whales))
  └─ derivations  (views over kernel: cycle-time · completeness · ai-bound?)
        ▲ reads (Foundry MCP machine — separate, NOT absorbed in v0)
        │ foundry event stream  (SlotLeased, gate, merge, …)
```

Form is **correct-minimal** (the `pack-devloop` Path-A precedent it inherits):
substrate-typed against `@de-braighter/substrate-contracts`, **no NestJS / Prisma /
Postgres / RLS** unless demand-pulled. Foundry-the-process is single-tenant, no-PHI,
read-mostly in v0; the full runtime stack would be the over-engineering ADR-176
forbids. **Migration safety:** the absorption re-homes `domains/devloop`'s existing
libs/tests first and keeps them green *before* any metamodel work begins (sequenced
in the plan), so the merge is a contained, reversible refactor — not a rewrite.

## 4. The metamodel — "both faces, one recursive tree"

The single-parent plan tree is the **process face**; **substance is the derived
output** of walking it.

```text
Product(foundry)                                    ← root
 └─ Capability(autonomous-conduct)
     └─ Feature(warm-pool)
         └─ WorkItem(story: warm-pool-auto-engagement)   ← leaf = a STORY (epic-item)
              resource: ai                          ← typed: ai | human | compute
              effect:   cycle-time −0.3 ± 0.1       ← EffectDeclaration (ADR-154), optional, never a gate
              yields:   [Pool.lease-primitive]      ← SUBSTANCE this story produces
              ← observations: the implementing PRs (foundry#6, wb#141) attach here
```

| Face | Modeled as | Derivation |
|---|---|---|
| **Process** ("BUILT-BY") | `Product → Capability → Feature → WorkItem` single-parent tree; `WorkItem` = a **story** (D6), carrying `resource`, optional `effect`, `yields[]`; implementing PRs attach as observations | the authored plan tree |
| **Substance** ("IS") | typed refs: `Pack`, `Board`, `Policy`, `Indicator` | `substance(product) = ⋃ yields(done work-items)` — **derived, never stored** |
| **Resource** | `ai \| human \| compute` ref per node; `Pool{slots, leased}` for `ai` | pool state derived from `SlotLeased`/lease events |

**The load-bearing reduction (why this is ADR-176-safe):** "both faces" needs **no
new kernel primitive**. The process face *is* the plan tree. The substance face is a
*derived projection* (`⋃ yields`), not stored state ("store generators, derive
graphs"). The resource face is typed metadata on nodes. So the whole ambitious "one
tree, two faces, AI as a resource" reduces to **typed pack metadata + one
derivation** over surfaces the kernel already ships. If that reduction holds, the
rest is small.

## 5. The four-concern spine

**Absorbs** `pack-devloop`'s ratified mapping (its §5.1) — the observation +
inference rows come with the merge — and **extends** it to the substance + resource
faces.

| Kernel concern | `foundry` v0 instantiation | Kernel surface (all ratified) |
|---|---|---|
| **Recurse the plan** | the `Product → … → WorkItem` tree | plan tree (ADR-127) + effect algebra (ADR-154) |
| **Flat the observation** | reuse: `claimed`, `lease.granted`, `pr.opened`, `wave.verdict`, `gate.decided`, `merged`, `retired`, `substance.landed` | event log (ADR-127) |
| **Inference** | `cycle-time` · `blueprint-completeness %` · `ai-throughput-bound?` — derived views | InferenceBackbone port |
| **Reproducibility** | run manifest per `ai` node (`agent·model·prompt-hash·base-commit·skills·isolation` = the `Producer:` line) | run manifests + versioned type catalog |

## 6. Data flow (all read-only in v0)

```text
AUTHOR (seed)            INGEST (read-only)              DERIVE (on demand)
Product(foundry) ─┐      foundry event stream ─┐         cycle-time  posterior
Product(whales)  ─┴─►    (SlotLeased,gate,merge)│   ┌──► completeness %
   plan-tree rows        GitHub PR (Producer:/  ├──►│    ai-throughput-bound?
   + metadata            Effect: body lines)    │   └──► (views over tree+log,
                         pack-devloop (CI/wave) ─┘        never stored)
```

- **Authoring (v0 = hand-authored seed).** Both products are authored from data that
  *already exists*, so the model is grounded, not invented.
  - `Product(foundry)` — reconstructed from the real foundry board (O-items, the
    slice-3 backlog, conductor stories); `WorkItem`s are **stories** (D6); the PRs
    that implemented each story (`foundry#6`, `foundry#7`, `wb#141`…) attach as
    observations — **their `Producer:` and `Effect:` lines are literally the
    run-manifest and the effect declaration** feeding the story node.
  - `Product(whales)` — reconstructed from the shipped 6-item wedge as six stories
    (`E1 → E2 → {E3 ∥ E4} → E5 → E6`). **The acid-test instance** — authored using
    only the shapes `Product(foundry)` already used.
- **Ingest.** A read-only ingester maps events that *already flow* onto `WorkItem`
  nodes (the assumption `pack-devloop`'s slice-1 validated). No new instrumentation.
  `substance.landed` fires when a merged `WorkItem`'s `yields` becomes real,
  advancing the substance projection.
- **Derive.** Posteriors recomputed through the InferenceBackbone port over tree +
  log; **never persisted as authoritative** (R4).

## 7. The AI seam in v0 — observe, don't drive

v0 changes **nothing** about how the `ai` resource is invoked. The product stays
**passive**; Claude Code + subagents keep pulling work through the existing Foundry
MCP + Agent dispatch (the seam that already runs — this very design session is
connected to it). v0 only **observes** two things about `ai`:

1. *which* AI did each node — the run manifest / `Producer:` line (concern #4);
2. *how saturated* the AI pool is — the `SlotLeased` events (capacity, D4).

The kernel **never calls** an agent — orchestrating agents is not one of the four
concerns, so the kernel must not do it; agents pull, the kernel records. "Driving"
(pulling work-items *from the kernel plan tree* instead of the bespoke queue) is the
**v1** line, deliberately held. So the ambitious AI-resource modelling lands as a
pure observation overlay, zero risk to the running conductor.

## 8. The three posteriors (v0 inference set)

| Posterior | Inputs | Answers | Why a posterior |
|---|---|---|---|
| **cycle-time** | `claim → merge` latency, grouped by `resource` + product | "how long does an `ai` WorkItem take vs a `human` gate-wait?" | carries uncertainty → reference-class forecast for the next item |
| **blueprint-completeness %** | `|substance landed| / |substance declared|` per product | "how done is this product's *substance*?" (the chat's Blueprint-Completeness KPI) | the substance face made measurable |
| **ai-throughput-bound?** | pool `leased/slots` vs count of ready `ai` WorkItems | "are we AI-capacity-bound, or work-starved?" | the capacity read (D4) |

## 9. Acid test + kill-criterion

| Test | Pass condition | On fail |
|---|---|---|
| **Genericity (primary)** | `Product(whales)` instantiates with **zero new** node/resource/substance/event types — type catalog identical to `Product(foundry)`'s | the metamodel isn't general → **stop / revise the model** |
| **Value (secondary)** | ≥1 posterior tells the conductor something the hand-rolled judgment didn't | defer the *inference* half — the genericity demonstration still stands |
| **Cost** | derivations fit the per-operation budget (R7) | the posterior doesn't run |

**Separable payoffs.** Even if no posterior beats current judgment, re-expressing
two real shipped products on one model with zero new shapes *is itself* the
reusable-template proof (D1). The slice cannot fully fail — worst case it banks the
template proof and defers the inference. (This is `pack-devloop`'s Attempt-3
discipline.)

## 10. What stays out (the v0 boundary / YAGNI)

No driving — the Foundry MCP **doing-machine** is untouched (observed, not rewired —
v1) · no generation/scaffolding (v2) · no scheduler/daemon (session-pull stays) ·
**no kernel change** · no new MCP tools (read existing streams) · no studio UI
(substance face is studio-*shaped* but unsurfaced) · no agri/oncology instances yet
(just foundry + whales). **In scope:** absorbing `pack-devloop` (D5) — but as a
green-tests re-home first, *then* the metamodel, never a rewrite.

## 11. Testing

- **Genericity assertion** — a literal test: the type vocabulary after authoring
  whales equals the vocabulary after authoring foundry (Δ = ∅).
- **Replay determinism** — posteriors recomputed from the same pinned type-catalog
  version + immutable event slice are bit-stable (reuses the substrate's
  `run_manifest`/replay discipline; concern #4).
- **Round-trip** — both instances load; `substance = ⋃ yields` derives correctly;
  all three posteriors compute within budget.

## 12. Governance (ADR-176)

- **Inclusion test, per tempting promotion.** The node/resource/substance types:
  needed by ≥2 packs today? No — one consumer (`domains/foundry`) → **pack
  territory.** Same verdict `pack-devloop` got. (If a second consumer ever needs the
  same shape, the promotion rule applies — tracked, not pre-empted.)
- **Zero kernel entity/table/verb/policy.** All shape = typed pack lib + `metadata`.
- **Gate:** `charter-checker` + the verifier wave.

### ADR triggers

- **ADR (new):** sanction `domains/foundry` as a pack-on-platform meta-product, zero
  kernel change, **amending/superseding ADR-192** to re-home the SDLC twin from
  `pack-devloop` into `domains/foundry` (the D5 merge).
- **ADR (new):** record substance-face-as-derived-projection (`substance = ⋃
  yields`), so it is never mistaken for stored state.

## 13. v0 deliverables (concrete)

1. **Absorb `domains/devloop` → `domains/foundry`** (re-home libs/tests, stay green)
   — the D5 merge, done first and contained.
2. The typed metamodel pack lib (node / resource / substance vocabulary).
3. Seed authoring of `Product(foundry)` + `Product(whales)` at story grain (D6).
4. Read-only ingester mapping existing events → story `WorkItem` nodes.
5. The three derived posteriors + the substance projection.
6. The genericity + replay tests.
7. The two ADRs.

## 14. Open questions (carried, not blocking)

| Question | Activating trigger |
|---|---|
| v1 actuation mode — session-pull vs scheduled wake? | The decision to let the product *drive* the `ai` resource (v1). |
| Does the substance face become the Studio's user-authored metamodel? | The Studio authoring surface is greenlit; v0 keeps it studio-*shaped* but internal. |
| Does the Foundry MCP doing-machine eventually fold onto the kernel tree too? | v1 driving lands and the bespoke queue state becomes the redundant half. |

> **Resolved in this revision:** `pack-devloop` is **merged** into `domains/foundry`
> (D5), and `WorkItem` grain is **story / epic-item** (D6) — both moved out of open
> questions.
