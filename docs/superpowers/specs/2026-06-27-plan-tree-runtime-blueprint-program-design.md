# Plan-Tree Runtime + Blueprint Layer + Studio Builder — Program Decomposition

- **Date:** 2026-06-27
- **Status:** Draft for founder review (program-level decomposition; each sub-project gets its own spec + plan)
- **Scope:** cross-cutting — `layers/` (new), `domains/foundry`, `domains/studio`, `layers/substrate` (boundary only)
- **Origin:** founder question "are we ready to persist the foundry SDLC tree?" → reframed during brainstorming into a 3-layer program.

## 1. Context

The founder asked whether the studio (which now persists its **Catalog/metamodel** via studio#127) can persist the **foundry SDLC tree**. Investigation surfaced that the studio persists the catalog, **not** plan trees (the plan-tree stores are in-memory placeholders), and that three distinct stores are in play:

- **Studio** authors plan trees natively — a "System" *is* a `BuildPathDraft`, which *is* a kernel `PlanTree` (`domains/studio/.../build-path/core/build-path-draft-store.ts` — "A `BuildPathDraft` IS a kernel `PlanTree`"). Its store *implements the kernel `PlanTreeStore` port*, but only with an in-memory adapter.
- **Kernel** already has a durable, RLS-scoped plan-tree store: the Ring-0 port `PlanTreeStore` (`layers/substrate/libs/substrate-contracts/.../plan-tree-store.port.ts`) + the Ring-1 `PrismaPlanTreeStore` over `kernel.plan_node` (`layers/substrate/libs/substrate-runtime/.../prisma-plan-tree.store.ts`). Contracts are at **2.7.0**. `domains/agri-ecosystem-twin` and `domains/devloop` already persist plan trees through it in production.
- **Foundry** already models *itself* as plan trees and **executes** them: a workflow tree (`FOUNDRY_WORKFLOW`) whose nodes carry an action `kind`, a closed `ACTION_REGISTRY: Map<kind, handler>`, and a conductor that walks the tree — event-sourced, exactly-once on replay (ADR-263–267). It also has the full blueprint verb-set: `extractBlueprint` / `blueprintToSpec` / `generate_from_blueprint` / `compile_blueprint` (`domains/foundry/src/metamodel/blueprint.ts`, `tree-from-queue.ts`, `mcp/tools.ts`). Foundry pins contracts at **0.10.0** (a skew to resolve).

The brainstorm converged on a larger thesis than the original ask.

## 2. Thesis

The orchestration/effect layer of every non-kernel application is naturally a **plan tree that executes**. Generalizing the foundry's already-proven, single-domain plan-tree runtime into a reusable layer lets every pack model *that layer* as executable trees — raising reuse, lowering marginal implementation effort, and yielding lattice testability. The original "persist the foundry SDLC tree" ask becomes a natural fall-out (the studio authors blueprints; deploy instantiates one into the kernel; sync-back extracts one).

**Discipline (non-negotiable):** this models the *orchestration/effect* layer only (decision in §6) — CRUD, queries, and UI stay conventional pack code. We are **not** building a Turing-complete JSONB interpreter, and **not** modeling "all logic" as trees.

## 3. The two worlds and the seam

The runtime joins two worlds inside each pack:

- **Declarative substrate world** — the plan tree, `effectDeclarations` (the twin/inference surface), reproducibility.
- **Imperative application world** — CRUD, integrations, queries, UI (ordinary pack code).

They meet *seamlessly* because of **declaration ⊥ actuation** (ADR-263): one node carries both faces — its `effectDeclarations` (what it claims to move) and its action `kind` (what it actually does, dispatched via the registry). The bridge is the **shared event log**: a handler does its imperative work by emitting events; replay folds events and never re-runs the handler, so execution automatically becomes observation the twin learns from.

**Seam contract (the runtime must enforce, not assume):**
1. Every handler is **idempotent / fully event-sourced** (replay folds events, fires exactly once).
2. Handlers may call *into* code but **must never imperatively edit the tree spine** ("store generators, derive graphs"); they emit events, structure is derived.
3. Control flow stays **derived** (completion = event, reachability = derived `dependsOn`), not callback wiring.

This seam is where every hard foundry bug lived (the S4 "wedge" = a non-idempotent step jamming the pipeline; the `dependsOn`-rekeying bug). "Seamless to use" ≠ "seamless to build correctly."

## 4. Architecture — the layer cake

```
STUDIO (domains/studio)            blueprint BUILDER (UI): author · deploy · sync-back
─────────────────────────────────────────────────────────────────────────────
BLUEPRINT LAYER (layers/, new)     trees-as-DATA: store · extract · generate · compile
PLAN-TREE RUNTIME (layers/, new)   execute orchestration/effect: ACTION_REGISTRY ·
                                   conductor · event-sourced fold · derived frontier
        ▲ consumed by ALL domains (foundry, exercir, …) via published @de-braighter/*
── ADR-176 LINE — everything above is NON-kernel ─────────────────────────────
KERNEL (layers/substrate)          store+structure trees, run the twin.
                                   PlanTreeStore (Ring 0/1) · kernel.plan_node
                                   GOAL: ZERO kernel change
```

**Placement decision:** the runtime + blueprint engine are **layers**, not packs. A thing consumed by every domain is layer-shaped; "pack" in this cluster means Ring 4/5 domain-level composition. Layer placement keeps dependency direction one-way (domains → layers) and prevents foundry-specific vocabulary leaking back into the shared engine. (Founder's "blueprint pack" wording maps to a layer technically.)

## 5. Sub-projects

Each is an independent brainstorm → spec → plan → implement cycle. "Lifts from" = generalize existing code, don't reinvent.

| # | Sub-project | Purpose | Lifts from | Boundary / interface | Tested by |
|---|---|---|---|---|---|
| **S1** | Plan-tree runtime (layer) | Domain-agnostic execution: `ACTION_REGISTRY`, event-sourced command dispatch, conductor step, derived frontier/advancement | foundry `state.ts`, `workflow-*` | inputs: a `PlanTree` + a handler registry; outputs: events + derived frontier | divergence invariant, fold-determinism, replay-stability, **idempotency/exactly-once seam acids** |
| **S2** | Blueprint engine (layer) | Trees-as-data: `ProductBlueprint` shape, `extract`/`generate`/`compile`, storage port | foundry `metamodel/blueprint.ts`, `tree-from-queue.ts`, `CompileTarget` | a `BlueprintStore` port + pure extract/generate/compile fns | round-trip identity (`extract∘generate==id`), genericity falsifier, storage-port contract |
| **S3** | Foundry migration (dogfood = kill-criterion) | Refactor foundry to consume S1+S2; delete private copies; resolve `@0.10→@2.7` skew | — | foundry depends on the new layers via published packages | foundry re-expresses with **zero new vocabulary**, else S1/S2 failed |
| **S4** | Studio durable persistence | Swap `InMemoryBuildPathDraftStore` → blueprint-engine adapter behind the *same* `PlanTreeStore` port; Systems persist | studio#127 catalog pattern (port→adapter→root wiring) | a persistent `PlanTreeStore` adapter at app root | adapter unit + studio component tests |
| **S5** | Deploy + sync (← original ask) | studio→kernel (instantiate/deploy = one-way door); kernel/foundry→studio (extract/sync-back); foundry SDLC tree as a sync source | foundry-queue-push (Fork 2 one-way door), `extractBlueprint` | a deploy actuator port + an import/sync port | **e2e round-trip** + actuator review |
| **S6** | Second pack on the runtime (reuse proof) | Express one existing pack's orchestration/effect layer (option b) on S1 | an exercir slice | the pack consumes S1's registry + runtime | the pack's own tests + the shared acids |
| **T** | E2E / seam harness (cross-cutting) | author → deploy → run → observe → sync, end to end; the acceptance contract for every slice | studio `wedge.integration.spec.ts`, foundry acids | — | *is* the test |

## 6. Decisions taken (founder, during brainstorm)

- **D1 — Blueprint authoring home:** the studio is a **blueprint builder**; blueprints (not live trees) are the studio's stored artifacts. Keeps "play around" stuff out of the kernel.
- **D2 — Blueprint engine source:** **generalize** the foundry's blueprint machinery into a reusable layer (foundry becomes a consumer). Not a fresh second implementation, not "foundry stays the only engine."
- **D3 — Runtime scope:** model the **orchestration/effect layer** as executable plan trees (like the foundry), CRUD/queries/UI remain conventional code. (Option b, not "whole pack as data.")
- **D4 — Layer placement:** runtime + blueprint engine live in `layers/` (consumed by all domains), not as a domain pack.
- **D5 — Sequencing:** **walking skeleton** (Option B) — a thin vertical slice through all layers first, standing up the e2e harness on day one, then deepen each layer.

## 7. Testability + the e2e gap (first-class)

Decomposition yields a lattice of independently-checkable contracts: the runtime is hardened once and inherited by every pack; handlers are tiny `(node, state) → events` units; the tree is data (structure/round-trip/mutation assertable without execution); determinism + seeded PRNG make replay reproducible; the seam becomes checkable properties (`fold(E) == fold(E ++ E)`, order-robustness, exactly-once).

**But** unit-green ≠ composes, and (for the studio) tests-green ≠ renders. The foundry's worst bugs were caught by integration/wedge acids + whole-branch review, not units; the studio's blank-render bug passed jsdom and needed browser-verify. The e2e gap the founder acknowledged is therefore a **named workstream (T)**, established with the walking skeleton and grown as the acceptance contract each slice must satisfy. T spans three tiers: (a) runtime/blueprint logic e2e (pure, fast), (b) studio author→deploy→sync e2e (browser/Playwright against a real kernel DB), (c) the seam acids.

## 8. Sequencing — the walking skeleton (Option B)

**Slice 0 (the skeleton):** author a trivial blueprint in the studio → store in a minimal blueprint layer → deploy to `kernel.plan_node` (via `PrismaPlanTreeStore`, the precedent agri/devloop already run) → sync it back into the studio. Functionally near-empty; it exercises the whole seam cheaply and stands up the e2e harness (T). Delivers a visible "persist + round-trip a tree" early.

**Then deepen (roughly parallel where deps allow):**
1. S1 plan-tree runtime (full) + grow T with seam acids.
2. S2 blueprint engine (full extract/generate/compile + storage).
3. S3 foundry migration — the kill-criterion dogfood; resolves the contract skew.
4. S4 studio durable persistence (full) + S5 deploy/sync (full) — the original ask, complete.
5. S6 second pack on the runtime — reuse proof beyond foundry.

## 9. Where the original ask lands

"Persist the foundry SDLC tree" is satisfied at **Slice 0** (round-trip proof) and completed at **S5** (deploy/sync with the foundry as a sync source). The foundry SDLC tree (`FOUNDRY_WORKFLOW` / `FOUNDRY_PRODUCT`) is already extractable as a `PlanTree`, and its nodes already satisfy the kernel store's preconditions (`buildCascadeTree` sets `kindRef='cascade:'+kind`; stashes `_cascadeKey`, not the reserved `__kindRef`/`__tenantPackId`). The contract skew (foundry `@0.10` vs kernel `@2.7`) is resolved in S3.

## 10. Guardrails

- **Zero kernel change** — verify, don't assume; the foundry arc held this across 30+ PRs. The runtime + blueprint are pack/layer-level (ADR-176 inclusion test fails for both — they're authored templates + execution, not one of the four kernel concerns).
- **No drift** — generalization (D2) means one engine; the foundry/studio `scopesDisjoint` duplication is the cautionary precedent. Shared layer + golden contract tests, not copies.
- **Seam contract (§3)** enforced by the runtime, asserted by T.

## 11. Out of scope / non-goals

- Modeling CRUD/query/UI layers as trees (explicitly not — D3).
- A general-purpose / Turing-complete tree interpreter.
- Multi-tab sync, blueprint marketplace, cross-tenant blueprint sharing (later, if ever).
- Kernel schema changes.

## 12. Next step

Brainstorm **Slice 0 (the walking skeleton)** in detail → its own spec + implementation plan.
