---
title: "External north-star realignment — Substrate, Foundry, Exercir"
status: draft
tier: design-global
scope: cluster
created: 2026-06-20
last_updated: 2026-06-20
authors: [stibe, codex]
relates-to:
  - layers/specs/01-vision.md
  - layers/specs/03-strategy.md
  - layers/specs/04-plan.md
  - layers/specs/concepts/design/north-star-vision-capture-2026-05-17.md
  - layers/specs/concepts/design/2026-06-16-substrate-foundry-product-synthesis-ring.md
  - layers/specs/CLAUDE.md
  - projects/exercir/project.yaml
  - projects/foundry/project.yaml
  - projects/studio/project.yaml
  - projects/devloop/project.yaml
---

## 1. Purpose

This design realigns the de Braighter north star with the current project
reality and makes the story externally marketable without abandoning the kernel
discipline ratified by ADR-176.

The current corpus contains three conflicting strategic frames:

- The old north-star capture still frames Option A as building Exercir,
  Strategir, and Operir as products while Substrate emerges internally.
- The newer specs guidance states that Exercir is the only active product,
  while Strategir and Operir drafts are retained for reference.
- The active project landscape shows real traction in Foundry, Studio,
  Devloop, Scenario Lab, Board Kit, and Exercir rather than in the old
  Strategir and Operir product line.

The realignment chooses the Foundry-centered option: Substrate remains the
semantic engine, Foundry becomes the product-synthesis machine, and Exercir
remains the first commercial product that proves the loop in the real world.

## 2. Decision

Adopt the following external north-star thesis:

> de Braighter builds evidence-driven product systems. Substrate is the
> semantic engine that models subjects, plans, observations, effects,
> inference, and reproducibility. Foundry turns those models into working
> products. Exercir is the first commercial product proving the loop in the
> real world.

This replaces the older active-product triad of Exercir, Strategir, and
Operir. Strategir and Operir remain archived venture drafts or reference
material, not active north-star products.

## 3. Product Roles

### 3.1 de Braighter

Role: company and product studio.

External posture: the maker of evidence-driven product systems.

### 3.2 Substrate

Role: semantic engine.

External posture: the engine behind the products, not yet a standalone open
platform.

### 3.3 Foundry

Role: product-synthesis machine.

External posture: explains how de Braighter repeatedly turns models into
product systems.

### 3.4 Studio

Role: authoring surface.

External posture: workspace for models, boards, simulation, review, and product
evolution.

### 3.5 Devloop

Role: internal software-delivery twin.

External posture: proof that the same loop improves de Braighter's own build
system.

### 3.6 Exercir

Role: first commercial product.

External posture: the first live product and market proof.

### 3.7 Scenario Lab

Role: domain-agnostic simulation.

External posture: cross-domain proof without code-level domain leakage.

### 3.8 Future Bricks

Role: demand-pulled products.

External posture: named only after a real pull signal exists.

### 3.9 Strategir and Operir

Role: historical venture drafts.

External posture: archive or reference only.

## 4. External Messaging

### 4.1 Short Form

> de Braighter builds evidence-driven product systems: software that knows what
> it is trying to change, observes what happens, and improves from evidence.

### 4.2 Substrate Line

> Substrate is the semantic engine underneath: it models real-world systems as
> subjects, plans, observations, effects, and learning loops.

### 4.3 Foundry Line

> Foundry is how de Braighter turns those models into products: blueprint,
> build, observe, review, learn, and evolve.

### 4.4 Exercir Line

> Exercir is the first product built on this loop: sport organizations plan
> training, observe what happens, and improve through evidence.

### 4.5 Words to Use Carefully

Use "digital twin" as a capability or explanation, not as the lead headline.
"Universal digital twin platform" is architecturally accurate but externally too
abstract and too easy to mistake for a generic platform promise. The lead market
language should be "evidence-driven product systems".

## 5. Strategy Consequences

### 5.1 Exercir Remains First

Exercir remains the first active market product. It is not demoted to a demo. It
is the first proof that Substrate can support a real customer-facing product
with planning, observation, evidence, and iteration.

### 5.2 Foundry Becomes Canonical

Foundry is no longer only an internal convenience layer. It becomes the
canonical product-machine story: de Braighter does not hand-build unrelated
apps; it models a product system, derives the work, observes the build, records
findings, and improves the method.

This does not promote Foundry concepts into the kernel. Foundry stays outside
the kernel and obeys ADR-176. It is product-synthesis machinery around
Substrate, not a fifth kernel concern.

### 5.3 Health Becomes Demand-Pulled

Health and Krebsliga Zürich should move from a fixed next phase to a
demand-pulled candidate. The health/FHIR work remains valuable, but the current
repository state describes it as a bootstrapping projection library with no live
consumer. The north star should not promise it as the next product unless a
current pull signal exists.

### 5.4 The Second Brick Is Criterion-Based

The second commercial brick should be selected by criteria, not by an old
roadmap slot. It should pull at least one capability Exercir does not fully
exercise:

- non-person subjects;
- reproducible model versioning;
- vendor-only subtree registry;
- inference depth beyond the current families;
- user-authored model or process evolution;
- cross-domain Scenario Lab proof with customer-facing value.

### 5.5 Strategir and Operir Are Archived

Strategir and Operir should be explicitly marked as reference-only venture
drafts. Their useful ideas may feed future products, but the names should not
appear in current north-star product sequencing.

## 6. Documentation Cascade

### 6.1 `layers/specs/01-vision.md`

Rewrite the opening around evidence-driven product systems:

- de Braighter builds evidence-driven product systems;
- Substrate is the semantic engine;
- Foundry turns models into products;
- Exercir is the first commercial product;
- future products are demand-pulled.

Remove language that implies Strategir or Operir are active products.

### 6.2 `layers/specs/03-strategy.md`

Replace the fixed five-move sequence with a Foundry-centered strategy:

1. make Substrate v1 small, reproducible, and useful;
2. prove the loop commercially through Exercir;
3. use Foundry, Studio, Devloop, Board Kit, and Scenario Lab to reduce the cost
   and risk of the next product;
4. choose the next brick by pull signal and substrate capability stress;
5. expand only where evidence shows repeatability.

Move Health/KLZ from fixed move 3 to the candidate list.

### 6.3 `layers/specs/04-plan.md`

Update the phase plan so it does not claim a fixed Health/KLZ next phase. The
plan should separate:

- commercial proof: Exercir;
- product-machine proof: Foundry, Studio, Devloop, Scenario Lab;
- next-brick selection: demand-pulled and criteria-gated.

### 6.4 `layers/specs/concepts/design/north-star-vision-capture-2026-05-17.md`

Keep the old capture as an architecture-citable historical document, but add a
status banner:

> Superseded for external positioning and product sequencing by the 2026-06-20
> external north-star realignment. Still citable for the substrate architecture:
> recurse the plan, flat the observation, the four kernel concerns, ring
> topology, and kernel-minimality principles.

### 6.5 Business Venture Drafts

Mark these as archived or reference-only:

- `layers/specs/business/ventures/strategir/`
- `layers/specs/business/ventures/operir/`

Keep them as idea reservoirs. Do not use them in active product sequencing.

### 6.6 Project Descriptors

Harmonize `projects/*.yaml` so statuses and descriptions match the new roles:

- `exercir`: active commercial product;
- `foundry`: product-synthesis control plane;
- `studio`: authoring and operating surface;
- `devloop`: internal SDLC twin;
- `scenario-lab`: agnostic simulation proof;
- `health`: bootstrapping projection library / candidate, not committed second
  product;
- other domains: bootstrapping/prototype/candidate unless they have current
  pull.

## 7. Guardrails

### 7.1 Keep the Kernel Small

The new external story must not create pressure to put Foundry, Studio,
product-blueprint, or scenario concepts into the kernel. ADR-176 remains the
promotion test: only shared infrastructure needed by at least two packs and
required for kernel validation, querying, or versioning belongs in the typed
core.

### 7.2 Do Not Sell a Standalone Platform Too Early

Substrate can be marketable as the engine underneath de Braighter products. It
should not be sold as an open generic platform until the product evidence earns
that move.

### 7.3 Keep Exercir Real

Exercir must stay a genuine product, not a marketing prop for Substrate. Its
success criteria should remain real usage, real workflows, and real feedback
loops in sport organizations.

### 7.4 Let the Next Brick Be Pulled

Do not name the next commercial product before a real pull signal exists.
Candidate concepts can be researched, but the roadmap should name selection
criteria rather than force a stale vertical.

## 8. Acceptance Criteria

The realignment is complete when:

1. `01-vision.md` presents the external evidence-driven product-systems thesis.
2. `03-strategy.md` removes Strategir/Operir as active products and makes the
   next brick demand-pulled.
3. `04-plan.md` no longer fixes Health/KLZ as the next committed phase unless a
   current pull signal is documented.
4. The old north-star capture has a supersession banner that preserves
   architectural citations.
5. Strategir and Operir venture drafts are marked reference-only.
6. Project descriptors use consistent role language.
7. No change introduces a new kernel concern or weakens ADR-176.

## 9. Open Questions

1. Should the public tagline prefer "evidence-driven product systems" or
   "systems that learn from evidence"? Recommendation: use the former in
   strategic docs and the latter in marketing copy.
2. Should Foundry be externally named immediately, or should public copy first
   say "our product engine" and introduce Foundry later? Recommendation: name it
   in investor/partner materials, keep customer copy focused on the product they
   are buying.
3. What is the minimum current pull signal required to promote a candidate into
   the second commercial brick? Recommendation: named anchor, concrete workflow,
   and at least one Substrate capability Exercir does not already exercise.

## 10. Non-Goals

- No implementation changes.
- No kernel changes.
- No new product commitments beyond Exercir.
- No deletion of historical Strategir or Operir material.
- No external claim that Substrate is already an open third-party platform.
