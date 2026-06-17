---
title: "Foundry v1 — the conductor drives off the kernel plan tree (Phase A)"
status: design (pre-plan) — for review
kind: technical-design
created: 2026-06-17
author: stibe
relates-to:
  - docs/superpowers/specs/2026-06-17-foundry-substrate-self-application-design.md
  - layers/specs/adr/adr-241-sanction-domains-foundry-meta-product-rehome-sdlc-twin.md
  - layers/specs/adr/adr-242-product-substance-face-derived-projection.md
  - layers/specs/adr/adr-243-scenario-lab-engine-purity.md
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
  - layers/specs/adr/adr-127-kernel-substrate-v1.md
  - layers/specs/adr/adr-194-plan-tree-kernel-feedback-domain-agnostic-scope-and-typed-effect-field.md
  - layers/specs/adr/adr-154-algebraic-effect-declarations-and-composition-operators.md
note: >
  Brainstormed design (superpowers:brainstorming) for Foundry v1. Closes the
  doing-side two-sources-of-truth split that v0 deliberately deferred: the
  conductor's claimable frontier derives from the kernel plan tree, not the flat
  bespoke queue. Phase A (drive off the tree, divergence-gated, queue as shadow)
  is the buildable v1 slice; Phase B (devloop log-collapse + retirement) is
  designed here and sequenced as a separate green-tests-first increment. Zero
  kernel change (ADR-176), reversible at every step. Implementation plan
  (superpowers:writing-plans) follows founder review of this spec.
---

# Foundry v1 — the conductor drives off the kernel plan tree (Phase A)

> **The move.** v0 modelled Foundry as a Substrate product but kept the
> doing-machine and the metamodel as **two sources of truth**: the live
> coordinator reads a flat bespoke queue (`claimableItems` over `WorkItemQueued`
> events), while the authored plan tree is descriptive only — nothing reads it to
> decide what to do next. v1 makes the **kernel plan tree the authority for the
> frontier**: `foundry_next` derives claimable work from the tree, `claim`/`gate`/
> `merge` are events on the tree's leaf nodes, and a **divergence invariant**
> proves the tree-derived frontier and the legacy queue frontier never disagree.
> Phase A is the thinnest falsifiable increment; the bespoke queue is kept as a
> live shadow and the change is reversible at every step. **Zero kernel change.**

---

## 0. Why this is the next step (and why it is small)

[ADR-241](../../../layers/specs/adr/adr-241-sanction-domains-foundry-meta-product-rehome-sdlc-twin.md)
sanctioned `domains/foundry` as the product-creation meta-product and named the
v1 absorption + log-collapse as the **demand-pulled** next step. The v0 record's
held line was explicit (v0 spec §7, §10): *observe, don't drive* — the kernel
records, agents pull, "driving" is deferred. v1 lifts exactly that line, and
nothing more.

The increment is small because the codebase is already most of the way there:

- The bespoke queue is **already event-sourced** and **already a DAG** of
  `WorkItem` aggregates (`WorkItemQueued` + `dependsOn` edges + `scope`), with the
  frontier computed by a single pure function, `claimableItems(state, now)`
  (`domains/foundry/src/state.ts`).
- The v0 plan tree's leaf nodes **already carry `meta.itemId`** binding them to
  those same queue items (`domains/foundry/src/instances/foundry-product.ts`).
- `claim`/`merge` **already key on `itemId`** (the `WorkItem` aggregateId), so once
  a leaf node references that `itemId`, those events *are* leaf node events; `gate`
  keys on `productKey` → it is a node event on the **product root** (§6 makes this
  level distinction precise). No new event types, no aggregate re-keying either way.

So "drive off the tree" reduces to: **move the execution-relevant metadata
(`scope`, `dependsOn`) up onto the tree leaf, add one derivation (`planFrontier`),
and gate it with a divergence test.** Everything else stays.

## 1. The split, located precisely in the code

| | Bespoke queue (the live driver) | v0 plan tree (descriptive only) |
|---|---|---|
| **Source** | `WorkItemQueued` events → `items` map (`state.ts`) | `FOUNDRY_PRODUCT: CascadeNodeSpec[]` → `buildCascadeTree` → kernel `PlanTree` |
| **Shape** | flat **DAG** keyed by `itemId`, `dependsOn` edges, `scope` | strictly **single-parent** `Product→Capability→Feature→WorkItem` |
| **Identity** | `itemId` (e.g. `foundry/slice3-1`) | node id `uuidv5('cascade:'+key)`; leaf carries `meta.itemId` |
| **Frontier** | `claimableItems(s, now)` → `nextItems` → `foundry_next` | **none** — nothing reads it to pick work |
| **Carries** | `scope`, `dependsOn`, `qualityObligations` | `resource`, `yields`, `status`, `title`, `itemId` |

**The conceptual key:** parentage (tree) ≠ execution order (deps). The
single-parent spine expresses *decomposition*; the `dependsOn` DAG expresses
*sequencing*. Per north-star §20, cross-links are a separate relation, **never**
multi-parent — so `dependsOn` rides leaf `metadata`, off the spine. A tree-driven
frontier is therefore exactly `claimableItems`' rule (`not-done ∧ deps-satisfied ∧
scope-disjoint`) evaluated over the tree's leaves + their metadata.

## 2. Founder-approved decisions (the brainstorm record)

| # | Decision | Choice |
|---|---|---|
| V1-D1 | **Slice boundary** | *Phase A now; Phase B designed + deferred.* Build only the conductor-drives-off-the-tree slice (frontier-over-tree + divergence test, queue as shadow). Fully spec Phase B (devloop log-collapse + retirement) and sequence it as a **separate** green-tests-first increment after A is green. |
| V1-D2 | **Actuation mode** (v0 §14 open q) | *Keep session-pull; only change the source.* The conductor session still pulls; `foundry_next` reads the plan-tree frontier instead of the flat queue. **No daemon / scheduler** — that surface (and its ADR-176/liveness scrutiny) is a clean v1.x follow-up. |
| V1-D3 | **Leaf ↔ WorkItem binding** | *Tree is authority; bind via `itemId`; queue shadows.* Leaf metadata carries `{itemId, scope, dependsOn}` and becomes the authoritative declaration. `planFrontier(tree, log)` computes the frontier directly; `claim`/`gate`/`merge` keep keying on `itemId` (zero aggregate change), so they are node events by the existing binding. A divergence test asserts `planFrontier ≡ claimableItems`. |
| V1-D4 | **Coordination rewire** | *Behind a seam, never in place.* Keeping the queue as a shadow with a divergence test **requires** both frontier paths to coexist — so `ops.ts` is **extended** behind a `FrontierSource` selector, not rewired. (Forced by V1-D1+V1-D3; mirrors the ADR-243 enforced-invariant pattern.) |

## 3. Architecture — the seam (V1-D4)

```text
domains/foundry/src
  ├─ ops.nextItems(deps, { source })   ← NEW optional selector
  │     ├─ source: 'queue' → claimableItems(s, now)   (UNCHANGED — the shadow)
  │     └─ source: 'plan'  → planFrontier(tree, s, now) (NEW — the driver)
  ├─ plan/frontier.ts  → planFrontier(): walk work-item leaves,
  │                       not-done ∧ deps-satisfied ∧ scope-disjoint, over the SAME log
  ├─ claim / gate / merge  ← UNTOUCHED: key on itemId; leaf references it → node events
  └─ plan/frontier.divergence.test.ts → assert planFrontier ≡ claimableItems (the kill-criterion)
```

- `foundry_next` gains an optional `source: 'queue' | 'plan'`, **default `'queue'`**
  for safety. The proof workflow and the conductor run `'plan'`; the divergence
  invariant guarantees equivalence, so the flip is provably safe.
- Both `planFrontier` and `claimableItems` read the **same event log** for claim/
  done/gate state. They differ **only** in where the *structural declaration*
  (`scope`, `dependsOn`) comes from — the tree leaf vs `WorkItemQueued`. That
  independence is what makes the divergence test a real falsifier (§5).
- Form stays correct-minimal — substrate-typed against
  `@de-braighter/substrate-contracts`, no NestJS/Prisma/RLS (none demand-pulled).

## 4. The metamodel change (V1-D3)

The foundry plan-tree **leaf** becomes the authority for execution facts:

```text
leaf(work-item).metadata = {
  itemId,          // binds to the claim aggregate (already present in v0)
  scope,           // { repo, issue?, pathPrefix? }   ← MOVED UP from WorkItemQueued
  dependsOn[],     // cross-links (sequencing), NEVER parentage  ← MOVED UP
  resource,        // ai | human | compute  (v0)
  yields[],        // substance refs        (v0)
  status,          // queued | built | done | retired  (v0, descriptive)
}
```

- Node **identity is unchanged** (`uuidv5('cascade:'+key)`). The claim aggregate is
  still `itemAggregateId(itemId)`. Binding is `meta.itemId`. So the 248-test event/
  aggregate core is untouched — the smallest possible diff.
- `scope` / `dependsOn` are *added* to the leaf metadata vocabulary (a typed pack
  shape via `metadata` JSONB, ADR-176-safe). The metamodel `vocabulary.ts`
  validator is extended to require them on `work-item` leaves.

`planFrontier(tree, state, now)` (new, `plan/frontier.ts`):

1. Collect **work-item leaves** (`kind === 'work-item'`).
2. A leaf is **claimable** iff: its `itemId` is not done/retired in the log
   (reuse `itemDone`/`itemRetired`/`itemStatus`), every `dependsOn` itemId is done,
   and its `scope` is disjoint from every active claim's scope (reuse
   `scopesDisjoint`).
3. Sort by product priority, then queue order, then `itemId` — **identical
   ordering** to `claimableItems`, so the two are set-and-order comparable.
4. Map to the existing `NextItem` shape. **No new public types.**

Frontier helpers (`itemDone`, `scopesDisjoint`, …) are **reused** from `state.ts`,
not reimplemented — a single source of the claimability rule (the same M1 review
lesson that already unified `nextItems` and the status board).

## 5. The acid test — built to *bite* (the kill-criterion)

This is the load-bearing test and it is designed against the **v0 lesson**: v0's
first genericity acid-test was a *weak falsifier* (whales ⊂ foundry → trivially
true) and shipped a numerically garbage posterior behind a false-green assertion.
The divergence test must be neither trivially green nor trivially red.

**Why it can genuinely fail.** `planFrontier` and `claimableItems` consume **two
independently-authored structural declarations** — the plan tree's leaf metadata
and the live queue's `WorkItemQueued` payloads — resolved against the *same* log.
Independent authorship means drift is real: a queue item with no tree leaf, a tree
leaf marked done while the queue shows it claimable, a `dependsOn`/`scope`
mismatch — each makes the frontiers disagree.

**The invariant.**

```text
∀ log-state L:  planFrontier(FOUNDRY_TREE, fold(L), now)
                ≡ claimableItems(fold(L), now)   restricted to the foundry product
```

asserted as both **set equality** and **order equality** (same `itemId` sequence).

**The battery (state coverage).** Evaluate the invariant across a fixture battery:
empty log; one item claimed; one item done **unblocking a dependent**; a scope
conflict between two leaves; a retired item; a stale (TTL-expired) claim. These are
the exact branches `claimableItems` distinguishes — so the test exercises every
claimability transition, not just the happy path.

**Mutation tests (proving the falsifier bites).** A test is worthless if it cannot
be made to fail. Perturbation cases assert the divergence test goes **red**:
drop a `dependsOn` from a leaf; widen a leaf `scope` to overlap another; remove a
leaf that the queue still has; flip a leaf `status`. Each perturbation MUST flip
the invariant to failing — encoded as `expect(divergence(...)).toBe(false)`.

**Replay determinism.** `planFrontier` is a pure fold over a pinned event slice +
the authored tree — bit-stable across runs (reuses the substrate replay
discipline; concern #4). No `Date.now`/`Math.random` in the derivation path.

## 6. The proof workflow — DONE, clause 1

Prove the conductor can run a **real** workflow entirely off the tree:

1. Author **one real not-yet-done work-item** into `FOUNDRY_PRODUCT` with full
   leaf metadata (`itemId`, `scope`, `dependsOn`, `resource`). Candidate: the
   Phase B story itself (`foundry/v1-phaseB-log-collapse`) — self-hosting
   recursion, the v1 work appearing as the first tree-driven item.
2. With `source: 'plan'`, drive the lifecycle off the tree in the realistic
   conductor order: `foundry_next(plan) → claim → release(built) →
   gate_request(ship) → gate_decide(approved) → record_merge`, asserting each
   event lands as a plan-tree **node event** and that the frontier **advances by
   re-deriving from tree + log** (the merged leaf leaves the frontier; a dependent
   leaf enters it).
   - **Node-event granularity (made precise).** `claim`/`release`/`record_merge`
     key on `itemId` → they bind to the **work-item leaf**. `gate_request`/
     `gate_decide` key on `productKey` (product-scoped in `ops.ts`) → they bind to
     the **product root node** (`productKey` = the tree root). Both are plan-tree
     node events; they simply attach at different tree levels. The spec does **not**
     pretend a gate is a leaf event — that level mismatch is exactly the kind of
     imprecision the v0 whole-branch review caught, so it is stated, not papered
     over.
3. Assert (via §5's invariant, run inside this workflow) that the `'plan'`-driven
   sequence is identical to what `'queue'` would have produced — the drive is
   *proven equivalent*, not merely *parallel*.

## 7. Phase B design (deferred, sequenced) — DONE, clause 2

Designed now; built as a separate increment after Phase A is green. **It is a
repoint, not a rewrite**, because `domains/devloop` *already ingests foundry
events*.

- **Target.** One canonical log: `domains/foundry`'s append-only JSONL log
  (canonical per ADR-241 §D7). The devloop twin's `ingest`/`plan`/`inference` read
  **that** log directly instead of their own store.
- **devloop's own events** (CI verdicts, wave findings, retro, calibration) are
  themselves `DomainEventEnvelope`s — they are **appended into the one canonical
  log**, so coordination events (claim/gate/merge) and observation events
  (CI/wave/retro) share a single ordered spine.
- **Migration.** Append devloop's historical events into the unified log ordered by
  `occurredAt`; de-dup on envelope identity; repoint devloop's readers; run
  devloop's **full** suite green against the unified log; **then** retire the
  separate devloop log. Reversible — devloop is untouched until its tests pass
  against the unified log; the migration is append-only into a fresh log.
- **Acid test (Phase B).** The absorbed twin reads the unified log natively and
  reproduces its existing posteriors bit-for-bit (replay determinism), **and** a
  test asserts coordination + observation events fold from one log with no
  cross-log seam remaining.
- **Governance.** Phase B gets its **own full-absorption ADR + charter pass** —
  exactly the demand-pulled follow-up ADR-241 §3 names. It supersedes the rest of
  ADR-192's homing and ratifies the `domains/devloop` retirement.

## 8. Governance (ADR-176)

- **Zero kernel change.** No kernel entity/table/verb/field. The frontier
  derivation rides ratified surfaces: `PlanNode.kind` free-string +
  `effectDeclarations` (ADR-194), the plan tree + event log (ADR-127), and
  `metadata` JSONB for `scope`/`dependsOn`/`resource`/`yields`.
- **Inclusion test — passes by exclusion.** The frontier-over-tree derivation and
  the leaf execution-metadata shape are needed by exactly **one** consumer
  (`domains/foundry`) → pack territory, same verdict v0 got. The promotion rule
  (ADR-176 §3) still applies if a second consumer ever needs the same shape.
- **Derived, never stored.** `planFrontier` is a *view* over tree + log — never
  persisted as authoritative (the ADR-242 / "store generators, derive graphs"
  discipline). The divergence invariant is itself an *enforced* invariant in the
  ADR-243 spirit: a clean boundary with a gate, not a convention.

### ADR triggers

- **ADR (new, design-local, Phase A):** "The conductor drives off the plan-tree
  frontier; the bespoke queue becomes a divergence-gated shadow." Records the
  frontier-authority shift + the divergence-invariant-as-enforced-pattern (sibling
  of ADR-243). Zero kernel change.
- **ADR (named, deferred, Phase B):** the full-absorption / log-collapse ADR (§7),
  written when Phase B is built — the follow-up ADR-241 §3 already names.

## 9. Testing

- **Divergence invariant** (§5) — set+order equality across the state battery.
- **Mutation suite** (§5) — each perturbation flips the invariant to red.
- **Proof workflow** (§6) — full `claim→gate→merge` off `source:'plan'`, frontier
  re-derivation asserted.
- **Replay determinism** — `planFrontier` bit-stable over a pinned event slice.
- **Reuse, not reimplement** — `planFrontier` calls `state.ts` helpers; a test
  pins that the two frontiers share the claimability rule (no second encoding).
- **Existing 248 tests stay green** — claim/gate/merge/log/state untouched.

## 10. What stays out (the v1 boundary / YAGNI)

No scheduler/daemon — session-pull stays (V1-D2) · no aggregate re-keying — identity
unchanged (V1-D3) · **no kernel change** · no new event types · no full devloop
absorption in Phase A — designed + sequenced (V1-D1) · no blueprint generation /
scaffolding (that is v2) · **no multi-target product compiler / browser-runtime /
UI-as-projection** (the `docs/substrate-*-capture-2026-06-17.md` vision is v2+, the
Option-A-deferred platform tar pit — explicitly out). **In scope:** the frontier
moves to the tree, divergence-gated, queue shadowing — the doing-side unification
only.

## 11. Phase A deliverables (concrete)

1. Leaf metadata extension (`scope`, `dependsOn`) + `vocabulary.ts` validation.
2. `plan/frontier.ts` — `planFrontier(tree, state, now)`, reusing `state.ts` rules.
3. `FrontierSource` seam in `ops.nextItems` + `foundry_next` `source` param
   (default `'queue'`).
4. The divergence invariant + state battery + mutation suite.
5. The proof workflow test (`claim→gate→merge` off `'plan'`).
6. One real not-yet-done work-item authored into `FOUNDRY_PRODUCT`.
7. The Phase A design-local ADR.
8. Phase B left fully designed (§7) for its own later increment.

## 12. Open questions (carried, not blocking)

| Question | Activating trigger |
|---|---|
| Flip `foundry_next` default `'queue'→'plan'`, or keep opt-in? | After the divergence invariant has held green across real conductor runs. |
| Scheduled-wake actuation (the product self-drives the `ai` resource)? | A deliberate decision to remove the human-starts-each-session step (v1.x). |
| Does `planFrontier` subsume `claimableItems` (retire the shadow)? | After Phase A is trusted **and** Phase B's one-log collapse lands. |
