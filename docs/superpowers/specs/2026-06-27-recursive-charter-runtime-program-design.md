# Recursive Charter Runtime — Program Decomposition

- **Date:** 2026-06-27
- **Status:** Draft for founder review (program-level decomposition; each sub-project gets its own spec + plan)
- **Scope:** cross-cutting — `layers/` (new charter layer), `domains/foundry`, `domains/studio`, `layers/substrate` (boundary only — **zero change**)
- **Origin:** founder question "are we ready to persist the foundry SDLC tree?" → reframed in brainstorming into a 3-layer program → reframed again around a **recursive Charter Node** as the core primitive.
- **Supersedes:** `2026-06-27-plan-tree-runtime-blueprint-program-design.md` (the pre-charter framing).

## 1. Context

The founder asked whether the studio (which now persists its **Catalog/metamodel** via studio#127) can persist the **foundry SDLC tree**. Investigation surfaced three stores — studio (plan trees, in-memory only), kernel (durable `PlanTreeStore` over `kernel.plan_node`, contracts @2.7.0; agri + devloop already use it), foundry (models + executes its own trees, contracts @0.10.0). Brainstorming then converged on a larger, unifying idea: **charters on all levels.**

## 2. Thesis — the recursive Charter Node

Instead of distinct types (project charter / mini charter / task / work item), there is **one recursive Charter Node**, identical in form at every depth. `role` + depth + claimability + gates differentiate; the *structure* is uniform and fractal. The plan tree of charter nodes **is** the charter. This unifies three things the prior decomposition kept separate:

| Was | Becomes |
|---|---|
| Blueprint = `{process: PlanTree, done}` | **Charter Tree** = a plan tree of Charter Nodes; the blueprint is its portable/extractable form |
| Runtime executes "orchestration nodes" | Runtime executes **Charter Nodes via one uniform lifecycle** + enforces inheritance |
| Studio = blueprint builder | Studio = **charter builder** (authors the contract per node, at any level) |

The keystone consequence: **the prompt stops being the truth.** A claimable Charter Node *is* the worker's bounded execution contract (the "mini-charter"); the prompt is only transport. The contract is validatable, loggable, auditable, and reproducible.

This generalizes machinery that already exists at the *product* level — the foundry pipeline (`dossier → opportunity-brief → charter.md → build-path → queue`), the `charter-checker` constitutional agent, and `exercir-charter-checker` — to **all levels, recursively, with a uniform lifecycle.** We build on it, not beside it.

## 3. The Charter Node primitive

A Charter Node **is** a kernel `PlanNode` (concern #1, the recursive single-parent spine) + a governance contract carried on `metadata` + a `role`. Typed as a *lens* over `PlanNode` (the foundry's `BuildNode` pattern), never as a kernel type.

```yaml
# A typed lens over PlanNode.metadata — validated by the CHARTER LAYER, not the kernel.
id: charter-runtime/E2.1          # PlanNode.id (uuid)
parentId: charter-runtime/E2      # PlanNode.parentId — the fractal spine
role: product | epic | task | gate | review | adr | experiment
claimable: true | false           # only some nodes are directly worked; others are context/constraints

mission:
  objective: "..."
  outcome: "..."

scope:                            # inherited; children may only NARROW
  in: []
  out: []
  allowedPathPrefixes: []
  repos: []

autonomy:                         # inherited; children may only RESTRICT
  maxMode: advisory | bounded-builder | autonomous-operator
  allowed: [inspect, edit, test, open_pr, release_built]
  requiresGate: [architecture_change, adr_acceptance, merge, ship]
  forbidden: [direct_to_main, bypass_hooks, modify_secrets, widen_scope_without_gate]

quality:                          # inherited; children may only ADD/EQUAL
  obligations: [ci-local, code-review, charter-check]
  evidenceRequired: [diff_summary, test_output, pr_ref, verifier_findings, gate_decisions]

acceptance:
  criteria: []

dependsOn: []                     # derived ordering (existing pattern), not tree edges
```

**Role is not a new type.** A `product` and a `task` are the *same node* with a different `role`, depth, scope-breadth, and claimability. Most fields are **optional + inherited** — a leaf task inherits the product mission and overrides only what it narrows. Role-specific *required* fields (a `gate` needs a decider; an `adr` needs a status) are enforced by **role-conditional validation**, not separate types.

## 4. Inheritance — the safety model (derived, fail-closed)

The whole autonomy guarantee rests on a one-directional inheritance rule:

```yaml
inheritance:
  scope:     narrow-only      # child scope ⊆ parent scope
  autonomy:  restrict-only    # child autonomy ⊆ parent autonomy
  quality:   add-or-equal     # child obligations ⊇ parent obligations
  gates:     add-or-equal     # child gates ⊇ parent gates
```

- A node's **effective contract = parent ∩ child-narrowing** — a **derived view**, computed over the tree, never stored ("store generators, derive graphs", north-star §20). Same shape as the foundry's `computeScopeDisjointness`.
- **Scope-widening is never a worker decision** — it is a charter change or a gate.
- The validator must **fail closed** and be enforced at *both* authoring time and claim/execute time, with a golden contract test. This is the single most safety-critical piece (the foundry's scope-disjointness lesson: a gap here means autonomy silently stops meaning anything).

## 5. The uniform lifecycle

Every Charter Node — product, epic, task, review, gate, ADR — runs the **same** lifecycle. This *is* the plan-tree runtime (generalizing the foundry conductor's stage walk).

```
intake → validate → decompose-or-claim → execute → verify → gate → record → resolve
```

```yaml
resolution:
  done:       "Acceptance met and evidence recorded."
  expanded:   "Node decomposed into valid child nodes."
  blocked:    "Cannot proceed without external decision or missing dependency."
  rejected:   "Gate failed or charter invalid."
  superseded: "Replaced by a newer node."
```

Rule: **every node may either be executed or decompose into smaller nodes, but always via the same protocol.** Some roles have degenerate lifecycles (a `gate` mostly waits on a decision) — the runtime handles role-specific shapes gracefully.

## 6. The two worlds and the seam

The runtime joins the **declarative substrate world** (the tree, `effectDeclarations`, the twin, reproducibility) and the **imperative application world** (CRUD, integrations, queries, UI) via **declaration ⊥ actuation** (ADR-263): one node carries both its `effectDeclarations` (what it claims to move) and its action `kind` (what it does, dispatched through a closed `ACTION_REGISTRY`). The bridge is the **shared event log** — handlers do imperative work by *emitting events*; replay folds events and never re-runs handlers, so execution becomes observation the twin learns from.

**Seam contract (runtime enforces, T asserts):** handlers are idempotent / fully event-sourced; handlers may call *into* code but never imperatively edit the tree spine; control flow stays derived (completion = event, reachability = derived `dependsOn`). Every hard foundry bug lived here (the S4 "wedge").

**Discipline (D3):** this models the *orchestration/effect* layer only. CRUD/queries/UI stay conventional pack code. Not a Turing-complete JSONB interpreter; not "all logic as trees."

## 7. Architecture — the layer cake + the Kernel-Untouched Invariant

```
STUDIO (domains/studio)            charter BUILDER (UI): author · deploy · sync-back
─────────────────────────────────────────────────────────────────────────────
CHARTER LAYER (layers/, new)       Charter Node typed lens · inheritance validator ·
                                   uniform lifecycle runtime · charter-tree/blueprint
                                   engine (store · extract · generate · compile)
        ▲ consumed by ALL domains (foundry, exercir, …) via published @de-braighter/*
── ADR-176 LINE — everything above is NON-kernel ─────────────────────────────
KERNEL (layers/substrate)          recursive single-parent tree + opaque `metadata`
                                   JSONB + event log + kernel.plan_node persistence.
                                   It STORES strings + JSONB; it never INTERPRETS charters.
```

**Placement:** the charter runtime + engine are **layers** (consumed by every domain), not a pack. Foundry consumes them like it consumes substrate today.

### The Kernel-Untouched Invariant (the guarantee)

Running the charter contract through the **ADR-176 inclusion test**: (a) a governance contract is *not* one of the four kernel concerns, and (b) the *kernel* never needs to validate/query/version it — only the layer + consumers do. **Both clauses fail → pack/layer territory, decisively.** The contract rides on the kernel's existing `metadata: z.record(z.unknown())` field — the "deliberate simplicity boundary" the doctrine names. The recursion is the kernel's concern #1, *reused not added*. Inheritance + charter graphs are derived views, never stored state.

Enforced by three checks (part of workstream T):

1. **Zero-diff guard** — these paths must not change across the whole program: `substrate-contracts/src/plan-tree/plan-tree-schemas.ts`, `plan-tree-store.port.ts`, `prisma-plan-tree.store.ts`, the `kernel.plan_node` migration. A one-line CI assertion.
2. **Boundary acid** (ADR-243 agnosticism-gate pattern) — the charter layer imports `PlanNode` **as a type only**; no charter vocabulary appears under `layers/substrate`.
3. **`charter-checker` agent** — the existing constitutional guardian reviews every kernel-touching PR for ring boundaries + the inclusion test + "store generators, derive graphs."

**Known future pressure point (not now, gated):** efficiently *querying* by a charter field would want a JSONB-path index = a kernel migration. Not needed to build/run this (the layer queries), gated by the promotion rule (demand-driven ≥2-pack need), likely avoidable. The line: the kernel may *store* `kind`/`metadata` but must never *interpret* charter semantics.

**Track record:** the foundry self-application arc (30+ PRs, ADRs 244–272) was zero kernel change, `charter-checker` COHERENT throughout. The charter model demands *strictly less* of the kernel than that.

## 8. Autonomy model (bound to existing governance, not a fork)

Three levels, default **bounded-builder**:

1. **advisory** — plan + recommend, change nothing.
2. **bounded-builder** — edit, test, open PR within scope (default).
3. **autonomous-operator** — claim, re-plan, spawn subtasks, verify; halts at founder/ship gates.

The `autonomy` block **maps onto the governance that already exists** — the founder gates + the auto-mode escalation classifier in CLAUDE.md — it does not invent a parallel rulebook. T2 stays hard founder-gated at ship. Scope-widening is always a charter change.

## 9. Mini-charter = the worker handoff

A claimable Charter Node *is* the worker contract. The foundry-worker / subagent flow becomes: **Charter Tree → (build-path compile) → claimable node → thin worker prompt that says "execute this Charter Node via the foundry-worker protocol."** The truth lives in the node (validated, logged, replayable), not the prompt. This directly hardens the dogfood failures noted to date (workers dying at the PR boundary, orphaned claims): lifecycle states + evidence requirements make progress explicit and recoverable.

## 10. Sub-projects

Each is its own brainstorm → spec → plan → implement cycle. "Lifts from" = generalize existing code.

| # | Sub-project | Purpose | Lifts from | Tested by |
|---|---|---|---|---|
| **S0** | Charter Node schema + inheritance validator (layer, foundational) | The typed lens over `PlanNode.metadata`, `role`, role-conditional validation, the fail-closed inheritance rules + effective-contract derivation | foundry `BuildNode`, `computeScopeDisjointness` | inheritance golden tests (narrow/restrict/add-only), fail-closed bites, role-conditional validation |
| **S1** | Uniform lifecycle runtime (layer) | intake→…→resolve interpreter, `ACTION_REGISTRY` dispatch, event-sourced fold, derived frontier/advancement | foundry conductor, `state.ts`, `workflow-*` | divergence invariant, fold-determinism, replay-stability, **idempotency/exactly-once seam acids** |
| **S2** | Charter-tree / blueprint engine (layer) | store · extract · generate · compile a charter tree; blueprint = portable form | foundry `metamodel/blueprint.ts`, `tree-from-queue.ts`, `CompileTarget` | round-trip identity, genericity falsifier, storage-port contract |
| **S3** | Foundry migration (dogfood = kill-criterion) | Foundry consumes S0–S2; delete private copies; resolve `@0.10→@2.7` skew; its product charter + build-path + worker handoff become instances of the general model | — | foundry re-expresses with **zero new vocabulary**, else S0–S2 failed |
| **S4** | Studio durable persistence | Swap `InMemoryBuildPathDraftStore` → charter-engine adapter behind the *same* `PlanTreeStore` port; charters persist | studio#127 catalog pattern | adapter unit + studio component tests |
| **S5** | Deploy + sync + mini-charter handoff (← original ask) | studio→kernel (instantiate/deploy = one-way door); kernel/foundry→studio (extract/sync-back); foundry SDLC tree as a sync source; worker prompt = transport | foundry-queue-push (Fork 2), `extractBlueprint`, foundry-worker | **e2e round-trip** + actuator review |
| **S6** | Second pack on the runtime (reuse proof) | Express one existing pack's orchestration/effect layer (option b) on the charter runtime | an exercir slice | the pack's own tests + shared acids |
| **T** | E2E / seam / kernel-untouched harness (cross-cutting) | author→deploy→run→observe→sync end to end; seam acids; **the Kernel-Untouched Invariant checks** | studio `wedge.integration.spec.ts`, foundry acids, ADR-243 boundary gate | *is* the test |

## 11. Decisions taken (founder, during brainstorm)

- **D1** — Studio is a **charter/blueprint builder**; charters are the studio's stored artifacts (keeps "play around" out of the kernel).
- **D2** — **Generalize** the foundry's blueprint + runtime machinery into reusable layers (foundry becomes a consumer).
- **D3** — Model the **orchestration/effect layer** as executable trees; CRUD/queries/UI stay code.
- **D4** — Runtime + engine live in `layers/` (not a domain pack).
- **D5** — Sequencing: **walking skeleton** first, e2e harness from day one.
- **D6** — **One recursive Charter Node** (role differentiates), not distinct charter types.
- **D7** — Inheritance is **narrow/restrict/add-only**, derived + fail-closed; scope-widening is a charter change.
- **D8** — **Zero kernel change**, enforced by the Kernel-Untouched Invariant; charter contract on `metadata`; autonomy binds to existing governance.

## 12. Sequencing — the walking skeleton (Option B)

**Slice 0 (the skeleton):** author **one Charter Node** in the studio → store in a minimal charter engine → run it through **one uniform lifecycle pass** with **one inheritance check** → deploy to `kernel.plan_node` (via `PrismaPlanTreeStore`) → sync it back. Near-empty functionally; it exercises the whole seam *and the Kernel-Untouched Invariant* cheaply, and stands up the e2e harness (T). Delivers a visible charter round-trip early.

**Then deepen:** S0 (inheritance validator) → S1 (lifecycle runtime) → S2 (engine) → S3 (foundry dogfood, resolves skew) → S4 + S5 (studio persistence + deploy/sync; original ask complete) → S6 (second pack).

## 13. Where the original ask lands

"Persist the foundry SDLC tree" is proven at **Slice 0** (round-trip) and completed at **S5** (deploy/sync with the foundry as a sync source). The foundry tree is already extractable as a `PlanTree`; its nodes satisfy the kernel store's preconditions (`kindRef='cascade:'+kind`, no reserved-key collision). The `@0.10→@2.7` skew is resolved in S3.

## 14. Guardrails

- **Kernel-Untouched Invariant (§7)** — zero-diff guard + boundary acid + `charter-checker`.
- **Inheritance fail-closed (§4)** — golden contract test, enforced at author + claim/execute.
- **Seam contract (§6)** — idempotent handlers, no imperative spine edits, derived control flow.
- **No drift (D2)** — one shared engine; the studio/foundry `scopesDisjoint` duplication is the cautionary precedent.
- **ADR needs** — the new charter layer + the Charter Node contract + inheritance model + autonomy model warrant an ADR (cross-cutting, designer-first). Fold into the S0/S1 brainstorm.

## 15. Out of scope / non-goals

- Modeling CRUD/query/UI as trees (D3).
- A general-purpose / Turing-complete tree interpreter.
- Promoting any charter field into the kernel typed core (promotion-rule gated; not now).
- Multi-tab sync, charter marketplace, cross-tenant charter sharing.
- Kernel schema changes.

## 16. Next step

Brainstorm **Slice 0 (the walking skeleton)** in detail → its own spec + implementation plan.
