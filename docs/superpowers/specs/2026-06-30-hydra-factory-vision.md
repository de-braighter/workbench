---
title: "Hydra Factory Vision — Software Factory Cockpit"
date: 2026-06-30
status: working-paper
authors: [founder]
tags: [vision, cockpit, plan-tree, charter, foundry, hydra]
---

# Hydra Factory Vision — Software Factory Cockpit

> Working paper synthesising the architectural thesis and the cockpit design direction.
> Next step: design session → formal spec → implementation plan.

---

## 1. The Thesis in One Sentence

**One body that remembers everything, many heads that each know one domain deeply, typed necks that are safe enough to trust and thin enough to stay out of the way.**

---

## 2. The Hydra Mascot

The hydra is our visual mascot because it IS the architecture:

| Hydra part | Substrate equivalent |
|---|---|
| **Body** | Substrate kernel — `kernel.plan_node`, event log, inference backbone, reproducibility. Minimal, stable, domain-agnostic. The body never bleeds. |
| **Heads** | Packs — workflow, customer-management, calendar, case-management, oncology, football, conservation. Each head autonomous, speaking its own language through `metadata`. |
| **Necks** | The typed connection tissue — `FoundryManifest` skins, `CharterNode` contracts, `BlueprintStore`. Typed and versioned. Cannot attach a head that violates the neck contract. |
| **Faces** | Skins applied per head — same customer-management head can wear a "social work" face or a "legal matter" face. The face changes UI, labels, mandatory fields; head behaviour is unchanged. |
| **Composite heads** | Heads that sprout from other heads — a case-management head is built from workflow + customer + calendar heads. Recursive composition. |

The hydra mascot enforces the kernel minimality invariant by intuition: a hydra with a giant body and tiny heads looks wrong. "That's head logic, not body logic" is the fastest rejection of a proposed kernel addition.

---

## 3. The Universal Primitive — Plan Trees Everywhere

### 3.1 Everything is a PlanNode

A system is a recursive single-parent tree of intervention nodes. This is universal — it applies to any purposeful process:

- A health rehabilitation plan → plan tree
- A football training programme → plan tree
- A software delivery pipeline → plan tree
- A deployment sequence → plan tree
- A governance charter → plan tree
- A knowledge corpus (ADRs, specs, concepts) → plan tree of knowledge nodes

**`PlanNode` with `metadata: JSONB` is the one kernel primitive.** `kind` + `kindRef` + `metadata` carry everything a pack needs without kernel schema changes. The `metadata: JSONB` boundary is the deliberate simplicity boundary (ADR-176) that makes universal plan-tree modelling possible without kernel bloat.

### 3.2 The Three Pillars All Reduce to Plan Trees

The three pillars of the system are not three different things — they are three lenses on the same primitive:

| Pillar | What it is | Metadata key |
|---|---|---|
| **Plan trees** | The universal primitive — recursive `PlanNode` spine | — |
| **Charters** | A specific plan tree where every node carries a governance lens | `metadata.charter` |
| **Foundries** | Systems (plan trees) executed by the charter-runtime | `metadata.foundry.*` |

**Charters** = a `CharterNode` is a kernel `PlanNode` + a governance contract (mission/scope/autonomy/quality/acceptance) + a `role` carried on `metadata.charter`. Typed as a lens, never a kernel type. The plan tree of charter nodes IS the charter. ZERO kernel change.

**Foundries** = systems expressed as plan trees (SDLC tree, product-features tree, ops tree) executed by the charter-runtime. `conductCharterStep` + `ACTION_REGISTRY` is the generic lifecycle engine. The foundry is its own product, modelled as its own plan tree, running on the substrate it builds.

### 3.3 Two Node Flavors, One Runtime

| Flavor | What it is | Example kinds |
|---|---|---|
| **Effect-null** | Knowledge artifacts — carry content, no side effects when executed | `knowledge.adr`, `knowledge.spec`, `knowledge.concept` |
| **Effect-bearing** | Operational actions — carry `effectDeclarations`, real-world side effects | `ops.deploy`, `ops.migrate`, `ops.healthcheck`, `ops.rollback` |

Both flavors are executed by the same charter-runtime (`conductCharterStep`). The difference is in the `executionMode` field (see §6) and the `effectDeclarations` metadata.

---

## 4. The Forest — A Domain's Fleet of Plan Trees

A single domain does not have one plan tree. It has a **fleet**, all living in `kernel.plan_node`, all in the same substrate:

| `treeRole` | Purpose | Node kinds | Effect? |
|---|---|---|---|
| `sdlc` | How we build it — delivery process | work-item, feature, capability, gate:review | null |
| `features` | What it is — capability decomposition | product, system, capability, feature, intervention | null |
| `knowledge` | What we know — ADRs, specs, concepts, background | `knowledge.*` | null |
| `ops` | How we run it — deploy, migrate, healthcheck, incident | `ops.*` | **bearing** |
| `execution` | Live instances — one per tenant/customer/session | instantiated from features blueprint | bearing |
| `roadmap` | Where we're going — objectives → epics → milestones | roadmap-objective, epic, milestone, gate:decision | null |
| `governance` | Who is responsible — recursive charter hierarchy | role:product, role:epic, role:task, gate:adr | null |

**Convention needed:** `metadata.treeRole` on every root `PlanNode`. ZERO kernel change. The cockpit reads `treeRole` to decide how to render and which execution mode to default to.

### 4.1 Trees Reference Each Other

Trees in the fleet are connected by logical cross-tree references in `metadata.JSONB`:

- SDLC work-item → `metadata.implementsFeatureId` → features tree node
- Knowledge node → `metadata.forFeatureId` → the feature it documents
- Ops deploy node → `metadata.productVersion` → SDLC release node
- Execution instance → `metadata.blueprintNodeId` → features tree node it instantiates
- Roadmap milestone → `metadata.featureIds[]` → features tree nodes it declares done

All logical references (string IDs, no Prisma `@relation`). Cross-pack, cross-tree wiring stays in metadata; the kernel stores the spine.

---

## 5. Pack Composition — Brick Building

### 5.1 The Vision

A developer picks up a `workflow` pack, a `customer-management` pack, a `calendar` pack. They wire them into a "Case Management System" brick. That brick takes its own skin (social-work vs legal-matter). The resulting composite is itself a first-class building block for a larger system.

Recursive composition under ring/layer boundaries — identical to how Angular components nest: each exposes typed inputs/outputs, can be instantiated independently, and nesting is transparent.

### 5.2 What Already Exists

- **Multi-pack tenants:** `TenantPack` rows bind `(Tenant, Pack)`. One tenant activates many packs simultaneously.
- **`import_ref` on `kernel.plan_node`:** carries `{ subtreeId, version, signature }` — content-addressable pointer to a versioned signed subtree published by another pack. This IS the composition mechanism at kernel level. `kernel.subtree_manifest` is the registry.
- **Logical foreign keys (intentional):** cross-pack entity references are string IDs, not Prisma `@relation`. A pack must be extractable to its own database (ADR-027 invariant 5).
- **RLS + tenant-pack isolation:** every row carries `tenant_pack_id`; PostgreSQL enforces at SQL level.

### 5.3 What Is Missing

1. **Subtree registry infrastructure** — `kernel.subtree_manifest` shape exists; hosting, signing, cross-tenant distribution deferred. Trigger: "second pack publishes anything."
2. **`CrossPackQueryService` + `SubjectLink`** — cross-pack entity reads need a `SECURITY DEFINER` service + consent-bound `SubjectLink` rows. Neither implemented. Cross-pack reads today are informal JSONB string lookups.
3. **Studio is single-pack** — no multi-pack assembly UI. No "drag a subtree from pack-football into pack-care."
4. **Composite skins / assembly spec** — `FoundryManifest` handles one skin at a time. A composite skin coordinating multiple skins across a pack assembly does not exist.
5. **Recursive brick identity** — no convention for a "composite kind" with its own `subtree_manifest` entry and declared interface.

---

## 6. Execution Modes — Deterministic First, AI When Required

### 6.1 Ops = Dev

There is no special ops infrastructure. Deploying a service, running a migration, executing a canary flip, responding to an incident — these are charter nodes with `executionMode: 'deterministic'` and `effectDeclarations`, executed by `conductCharterStep` exactly as a code-authoring node is.

BizDevOps closure — one continuous plan tree:

```
intent (knowledge node, effect-null)
  └─ design (ADR — knowledge node)
       └─ implement (code PR — ai node)
            └─ review (gate — human)
                 └─ deploy:staging (deterministic — kubectl apply)
                      └─ verify (deterministic — healthcheck)
                           └─ deploy:prod (deterministic — canary flip)
                                └─ operate (deterministic — monitoring probe)
                                     └─ incident? (decomposed subtree on alarm)
                                          └─ outcome (knowledge node — retro + inference update)
```

Every node is a `PlanNode`. Every event lands in one `CharterEventLog`. One twin sees the whole delivery pipeline.

### 6.2 The `executionMode` Field (New Design Concept)

Per-intervention declaration on `metadata.charter.executionMode` — ZERO kernel change (JSONB):

| Mode | Runtime behaviour | Use for |
|---|---|---|
| `deterministic` | `ScriptWorker` adapter — registered function, no Claude call | CI, git ops, deploys, migrations, healthchecks, computed fields |
| `ai` | Headless Claude worker (`foundry_dispatch`) | Code authoring, doc writing, review, novel problem-solving |
| `human` | Emits `GateRequested.v1`, halts — founder decides in cockpit | Architecture reviews, scope approvals, ship decisions |
| `hybrid` | Deterministic first; escalates to `ai` if script returns `needsEscalation: true` | Linting with AI-assisted fix suggestions on failure |

`ScriptWorker`: a concrete handler registered at startup by `scriptRef`, executing a named shell sequence inside a proper claim/release lifecycle. The `CharterEventLog` stays complete. No silent fast-paths that break the audit trail.

### 6.3 Where AI is Currently Overused

The foundry's `gen_*` generation tools are already correctly deterministic (template renderers, no LLM). `foundry_conduct_workflow` is a pure state machine. The real over-AI areas:

1. **Session-level orchestration** — the main Claude session decides which `gen_*` call to make, which kind to pass, which model to construct. These are often rule applications fully derivable from the spec. A `plan.yaml` + deterministic resolver could route `phase → kind → model → gen_generate` without a Claude call.
2. **Monolithic dispatch workers** — mechanical SDLC steps (run `nx test`, commit, open PR) arrive wrapped in AI context because worker sessions are monolithic. A `ScriptWorker` adapter removes the AI from these steps while keeping them in the audit trail.

---

## 7. The Cockpit Vision — Four Verbs, One Surface

### 7.1 Current State

The studio today gives fragments, not a cockpit:
- `/plan-tree` panel: read-only nested list of the foundry SDLC tree from :4555; live status 5s poll
- System-editor: `BuildPathDraft` plan tree, drag-drop, `InMemoryBuildPathDraftStore` (not persisted)
- Catalog panel: 8 item-type libraries, loaded via HTTP from foundry
- No deploy button. No instantiation flow. No execution control. No forest view.

### 7.2 The Vision — Four Verbs

**Draft** → **Deploy** → **Instantiate** → **Execute**

| Verb | What happens | Charter-runtime step |
|---|---|---|
| **Draft** | Design a named, versioned blueprint — plan tree of interventions with `CharterNode` contracts per node | `BlueprintStore.save()` (needs durable Postgres adapter) |
| **Deploy** | Push blueprint to substrate — one-way door | `generate(compiled) → PlanTree` → `PlanTreeStore.save()` (S5) |
| **Instantiate** | Create a live instance for a tenant/context | Stamp blueprint version, assign rootNodeId, emit initial `NodeDecomposed` events |
| **Execute** | Drive execution — see frontier, claim/release nodes, trigger gates, monitor event log | `conductCharterStep`, `charterFrontier`, `foundry_gate_decide` |

The cockpit shows ALL of a domain's trees (the fleet from §4) in a forest view. Dev work items AND ops nodes in the same plan-tree view. A release is a subtree that crosses the dev/ops boundary seamlessly.

### 7.3 Relationship to Charter Program Sub-projects

- S4 (studio durable persistence) = prerequisite: `PLAN_TREE_STORE` properly injected, `FoundryPrismaPlanTreeStore`, JWT auth on foundry server
- S5 (deploy + sync) = the "Deploy" button: calls `generate(compiled)` + `PlanTreeStore.save()`
- `executionMode` + `ScriptWorker` = new design concept, belongs in S5 scope or as S5 addendum

---

## 8. Visual Rendering — The SVG Board for Plan Trees

### 8.1 The Gap

The nested HTML list in the studio's `/plan-tree` panel does not communicate:
- Branching structure and depth at a glance
- Node status as spatial signal (done / claimed / blocked / gate-pending)
- Cross-tree references
- Execution mode per node (AI vs script vs human)
- Which subtree is in flight vs idle vs finished

### 8.2 The Infrastructure Already Exists

- **`ds-board-kit`** (ADR-257, all 4 surfaces shipped): SVG board renderer, tree-renderer surface, viewport/zoom/pan
- **`EditorRecipe` DSL** (`@de-braighter/board-recipes@1.0.0`, ADR-280/281): declarative data structure → SVG. Recipes are typed TypeScript objects (not JSON strings, not imperative code). Composable with Angular signals.
- **Skin system** (ADR-234): board surfaces wear domain-specific visual vocabularies

### 8.3 What Needs to Be Built — `planTreeToRecipe()`

A single pure function:

```typescript
planTreeToRecipe(nodes: PlanNode[], liveStatus?: StatusMap): EditorRecipe
```

Mapping rules:
- `node.kind` → shape: `knowledge.*` = document rect, `ops.*` = hexagon, `gate.*` = diamond, `work-item` = rounded box, `product/capability/feature` = card
- `metadata.charter.executionMode` → icon overlay: `deterministic` = ⚙, `ai` = ✦, `human` = ⊙
- `liveStatus[node.id]` → fill: done = green, claimed = blue, blocked = red, queued = grey
- `node.parentId` → structural connector (solid)
- `metadata.relatedNodeId` → cross-tree connector (dashed)
- `gate` → diamond + gate-status badge

Recipe recomputed each 5s poll via `LiveStatusService`. Signals-based — reactive, no full re-render.

**Forest view:** `forestToRecipe(roots: PlanNode[], crossLinks: CrossTreeLink[]): EditorRecipe` — same DSL, higher zoom. Tree roots as clusters, inter-tree dashed connectors.

**Effort estimate:** 2–3 PRs. `planTreeToRecipe()` is pure (unit-testable without DOM). The renderer never changes.

---

## 9. Cross-Tree Inference — The Substrate's Unfair Advantage

### 9.1 What the Twin Can See

When all changes across all trees emit typed events to `CharterEventLog` with feature-tree attribution, the inference backbone can compute calibrated posteriors over software engineering decisions:

| Inference question | Observable signal | Causal chain |
|---|---|---|
| What did lib extraction do to velocity? | Sonar duplication before/after → subsequent PR cycle time on affected files | `DuplicationReduced.v1` event → downstream SDLC nodes on same features |
| Does abstraction pay off? | `AbstractionIntroduced` → complexity delta → velocity delta | Charter node completing abstraction → Sonar scan → feature delivery speed |
| Do better ADRs speed up implementation? | ADR quality score → implementation PR cycle time | Knowledge tree ADR node quality → SDLC work-item implementing that decision |
| Do design specs reduce verifier findings? | Design note existence + quality → finding count on implementation PRs | `designer-first` gate node → implementation PR findings |
| Does TDD change bug rate? | Test-first vs test-after PRs → finding rate + ops incident events | `metadata.testFirst` → verifier findings + ops incident subtrees |
| ROI of refactoring? | Refactor cycle time → velocity gained on affected code area | SDLC refactor nodes → subsequent velocity on same feature subtree |

### 9.2 What Needs to Be Built

1. **Code-metric events** — `ScriptWorker` runs Sonar diff on PR merge, emits `DuplicationReduced.v1`, `ComplexityChanged.v1` with `featureNodeIds[]` attribution. Sonar scan already runs via `ritual:post-merge`; event emission + attribution link is the new part.
2. **Knowledge quality scoring** — deterministic scorer on ADR creation: completeness, alternatives_considered, consequences_articulated → `metadata.qualityScore` (JSONB). Run by `ScriptWorker` on `gen_generate kind=knowledge` persist.
3. **Cross-tree attribution on SDLC nodes** — `metadata.implementsFeatureId` + `metadata.implementsAdrId` populated consistently by foundry gen-tools.
4. **`whatif` stratification extension** — add `whatif cycle-time by:abstraction-type` and `whatif findings by:adr-quality-tier` as new stratification dimensions in the devloop twin. Same `posterior_cache` pattern (ADR-237), new dimension.

### 9.3 Why This Is Genuinely Novel

No tool today joins code-level refactoring events + feature-tree attribution + knowledge quality + SDLC velocity + ops incident rate into one causal model. DORA metrics measure deploy frequency and change failure rate — they cannot tell you whether the reduction came from better design docs, a specific lib extraction, or stricter review gates. The substrate can, because it has the event log that connects all of them.

---

## 10. Gap Analysis — Current State vs Target

### What exists and works

| Capability | Status |
|---|---|
| `kernel.plan_node` recursive store + RLS | ✅ live |
| `CharterEventLog` + lifecycle runtime (`conductCharterStep`, S0–S2) | ✅ live (74+97 tests) |
| Blueprint engine (`extract`/`compile`/`generate`) | ✅ live (S2) |
| `FoundryManifest` skin protocol + `CoreFoundry` | ✅ live (foundry-core@1.x) |
| Knowledge skin (`gen_generate kind=knowledge` + Postgres persist) | ✅ live (Phase 7+8) |
| Studio plan-tree panel (read-only, 5s live status) | ✅ live (foundry#76–81 + studio#130–132) |
| `@de-braighter/board-recipes@1.0.0` + `ds-board-kit` 4 surfaces | ✅ live |
| Multi-pack tenant support (`TenantPack` rows) | ✅ live |
| `import_ref` + `subtree_manifest` schema | ✅ designed, not operational |

### What is missing for the cockpit

| Gap | Effort | Blocker |
|---|---|---|
| `BlueprintStore` durable Postgres adapter | S4 scope | S4 spec + PR |
| `PLAN_TREE_STORE` properly injected (not `new`'d inline) | S4 scope | S4 PR |
| JWT auth on foundry server | S4 scope | S4 PR |
| **Deploy** button (S5 one-way door) | S5 scope | S4 prerequisite |
| **Instantiate** flow | S5 scope | S5 PR |
| **Execute** view (frontier + gate UI) | S5 scope | S5 PR |
| `executionMode` field + `ScriptWorker` adapter | New concept | Design → S5 addendum |
| `treeRole` on root nodes convention | Trivial | Convention doc + gen-tool enforcement |
| `planTreeToRecipe()` + SVG board panel | 2–3 PRs | No design blocker |
| Forest view (multi-tree navigation) | Follow-on | `planTreeToRecipe` first |
| `CrossPackQueryService` + `SubjectLink` | Pack composition arc | ADR + design |
| Code-metric events (`DuplicationReduced.v1` etc.) | Inference arc | `ScriptWorker` adapter first |
| Knowledge quality scoring | Inference arc | `ScriptWorker` adapter first |
| Subtree registry infrastructure (hosting/signing) | Pack composition arc | demand-driven trigger |

---

## 11. The Design Session Agenda

The "rolls royce software factory cockpit" design session should cover these in order:

1. **Cockpit architecture** — unified navigation (draft → deploy → instantiate → execute as ONE flow); what Angular routes, what panels, what the shell looks like
2. **`executionMode` spec** — formal definition of the 4 modes; `ScriptWorker` adapter contract; how `ACTION_REGISTRY` routes at claim time
3. **`treeRole` convention** — which roles, how enforced, how the cockpit renders each role differently
4. **`planTreeToRecipe()` spec** — node-kind → visual shape mapping; layout algorithm (dagre vs level-based); connector types; skin vocabulary
5. **S4/S5 integration** — how the cockpit's "Deploy" button wires to `generate(compiled)` + `PlanTreeStore.save()`; auth model
6. **Forest view** — how to navigate a domain's full fleet; which trees shown, which hidden by default; zoom levels

Open questions that need founder decisions before designing:
- Which domain does the cockpit launch for? (foundry itself, as dogfood? or a new domain?)
- Is the cockpit a separate Angular app or a panel within the existing studio?
- Does `executionMode: 'deterministic'` mean a named TypeScript function registered at startup, or a shell command string in metadata?
- What is the trigger for "second pack publishes anything" — do we activate the subtree registry now?
