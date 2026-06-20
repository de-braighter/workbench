# Cross-tree `build-path` — the workflow spawns a product tree (the HOW kicks off a WHAT)

> Slice 1 ([ADR-263](../../../layers/specs/adr/adr-263-foundry-workflow-first-class-actions.md))
> promoted the foundry WORKFLOW to a first-class plan tree (`FOUNDRY_WORKFLOW`) and gave its
> interventions a substrate-correct way to ACTUATE — a kind-keyed action registry where the node
> carries an action `kind` in `metadata` (the serializable COMMAND), the pack holds a static
> `kind → handler` table (the FUNCTION), and `actuate(deps, kind, args)` resolves + runs it (the
> handler calls an EXISTING store-locked op and EMITS EVENTS; replay folds the events, never re-runs
> the handler). Slice 1 seeded `reprioritize-product` and `request-gate`. **Slice 2 adds the
> `build-path` action: a workflow intervention that SPAWNS a product tree across trees.** The
> `build-path` handler — given a target blueprint + a `newKey` in `actionArgs` — instantiates a NEW
> product tree in the canonical log by REUSING the EXISTING generation machinery
> ([ADR-249](../../../layers/specs/adr/adr-249-foundry-blueprint-generation.md): `blueprintToSpec` →
> `queuePush` → `ProductRegistered` + `WorkItemQueued`, NO new event type). The reach ACROSS trees is
> a **`PlanNodeId` REFERENCE, never multi-parent** (the kernel's own rule,
> [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md); north-star §20): two
> INDEPENDENT single-parent trees, the cross-link a SEPARATE DERIVED relation — never a parent edge.
> This resolves ADR-263 **OQ-2**. **Zero kernel change** — the action rides `metadata`, the handler
> + registry are pack code, the generate machinery is existing, and the cross-link is a derived
> `PlanNodeId` reference (ADR-176 NOT triggered, both legs fail → pack territory).

- **Date:** 2026-06-19
- **Scope:** `domains/foundry` — extend the Slice-1 workflow module:
  - `src/workflow/actions.ts` (extend) — register a third action `build-path → buildPathAction`. The
    handler reuses the EXISTING generate path: it calls `blueprintToSpec(blueprint, newKey)` +
    `queuePush` (the same machinery `foundry_generate_from_blueprint` runs, `src/mcp/tools.ts:100-135`),
    emitting `ProductRegistered` + `WorkItemQueued` for the spawned tree. NO new event type.
  - `src/instances/foundry-workflow.ts` (extend) — the EXISTING `stage-build-path` node
    (`foundry-workflow.ts:57-62`) gains `meta.action = 'build-path'`; its concrete target
    (`blueprint`, `newKey`) is supplied at ACTUATION via `actuateNode`'s `args` override
    (`actions.ts:63-71`), so the workflow tree carries the COMMAND, not a baked-in target.
  - `test/workflow-build-path.acid.test.ts` (new) — the five acids below, every one against a TEMP
    log.
  - It REUSES `blueprintToSpec` (`src/metamodel/generate.ts:99`), `queuePush` (`src/ops.ts:44`,
    store-locked), the deterministic id scheme `uuidv5('cascade:' + key)` (`src/plan/cascade.ts:25`
    + `src/scope.ts:15`), `planFrontierAll` (`src/plan/plan-frontier-all.ts:24`), and the Slice-1
    `actuate`/`actuateNode`/`ACTION_REGISTRY` (`src/workflow/actions.ts:37-71`). **No
    `@de-braighter/substrate-*` change. No `@de-braighter/design-system-*` change.**
- **Predecessors / boundary:**
  [ADR-263](../../../layers/specs/adr/adr-263-foundry-workflow-first-class-actions.md) (Slice 1 — the
  workflow tree + the action registry + `actuate`; D5 cross-tree triggers + OQ-2, the spawn linkage
  this slice resolves),
  [ADR-249](../../../layers/specs/adr/adr-249-foundry-blueprint-generation.md) (the generate machinery
  — `blueprintToSpec`/`blueprintToEvents` + `foundry_generate_from_blueprint`; the `build-path`
  handler is a thin action wrapper over this exact path),
  [ADR-248](../../../layers/specs/adr/adr-248-foundry-product-blueprint-extraction.md) (the extract side — a
  blueprint is the EXTRACT output that GENERATE re-instantiates; the round-trip `build-path` rides),
  [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) (§3 the
  `metadata` JSONB extension boundary the action + provenance ride; §4 store-generators-derive-graphs
  — the cross-link is a derived VIEW, never stored state),
  [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) (the cross-link rule — a
  `PlanNodeId` reference, never multi-parent),
  [ADR-154](../../../layers/specs/adr/adr-154-algebraic-effect-declarations-and-composition-operators.md)
  (effect declarations — the spawned tree carries its work-items' declarations through the log
  unchanged, the existing P9 generate-path behaviour).
- **Provenance.** Recon-confirmed against the live foundry source: the generate path
  (`blueprintToSpec(bp, newKey)` `generate.ts:99`, then `queuePush(deps, { product, items })`
  `ops.ts:44`, store-locked under `withStoreLock(deps.dataDir, …)`, appending `productRegistered`
  `events.ts:192` + `itemQueued` `events.ts:195`) as wired in `foundry_generate_from_blueprint`
  (`tools.ts:100-135`); the deterministic root id `uuidv5('cascade:' + newKey)` (`cascade.ts:25` for
  `id`, `scope.ts:15` for the SHA-1 v5 hash); the all-product frontier
  `planFrontierAll(s, nowMs)` (`plan-frontier-all.ts:24`, which folds `s.products.keys()`, so a newly
  registered product enters the frontier on the next fold); the Slice-1 registry shape
  (`ACTION_REGISTRY: ReadonlyMap<ActionKind, ActionHandler>` + resolve-or-throw `actuate`,
  `actions.ts:37-54`) and `actuateNode`'s `args ?? nodeArgs` override (`actions.ts:63-71`); the
  envelope `metadata` slot already carrying `{ actorRef }` (`events.ts:175-188`) — the available JSONB
  boundary for the provenance-in-log option (Decision 2).

---

## 1. The WHAT-vs-HOW spawn — D5 / OQ-2 from ADR-263

ADR-263 made the foundry workflow a first-class plan tree (the HOW) DISTINCT from the per-product
trees (the WHAT), and gave its nodes a uniform way to actuate. **D5** named the one action that reaches
ACROSS those two kinds of tree: the workflow's `build-path` stage SPAWNS a product tree — the HOW kicks
off a WHAT. **OQ-2** left the linkage open: is the spawned product-tree root recorded as a stored
`metadata.spawnedRoot: PlanNodeId` field on the workflow node, or is it DERIVED
(store-generators-derive-graphs)? This slice resolves OQ-2 in favour of the derived form, and builds
the spawn itself.

The mechanism is already in the building. Foundry has a GENERATION machinery that instantiates a NEW
product tree from a blueprint: `blueprintToSpec(blueprint, newKey)` re-keys the blueprint into a
`CascadeNodeSpec[]` (`generate.ts:99`), and `queuePush` (`ops.ts:44`) appends one `ProductRegistered`
+ one `WorkItemQueued` per work-item under the store lock — exactly what
`foundry_generate_from_blueprint` runs (`tools.ts:100-135`). Slice 2 does NOT author new spawn
machinery; it wraps this EXISTING path in a `build-path` action handler so a workflow intervention can
fire it.

| | The WHAT — the product tree | The HOW — the workflow tree |
|---|---|---|
| **What it models** | What a product IS: `Product → Capability → Feature → WorkItem`. | How the machine BUILDS a product: `intake → … → build-path → … → ship`. |
| **Root id** | `uuidv5('cascade:' + productKey)` — one tree per product. | `uuidv5('cascade:foundry-workflow')` — one pipeline, reusable. |
| **Slice 2's role** | The TARGET: `build-path` SPAWNS a fresh product tree (a new `productKey` = `newKey`). | The SOURCE: the `stage-build-path` node carries `meta.action = 'build-path'` and actuates the spawn. |

The crux Slice 2 must get right is the LINK between them. The HOW node spawned the WHAT root; the
two must be relatable — but they are two INDEPENDENT single-parent trees, and the kernel forbids the
naive move (making the product root a SECOND child of the workflow node). The resolution is the
kernel's own cross-link rule: a `PlanNodeId` REFERENCE, derived where possible, never a parent edge.

---

## 2. The four key decisions

### KD-1 — The cross-tree reach is a `PlanNodeId` REFERENCE, never multi-parent

The workflow's `build-path` node spawned the product root. The naive encoding is to make the product
root a child of the `build-path` node — but that gives the product root TWO parents (its own product
tree's null-parent root identity AND the workflow node), which the kernel forbids: the plan tree is
**strictly single-parent** ([ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md);
north-star §20). The correct encoding keeps **two INDEPENDENT single-parent trees** and relates them
with a SEPARATE relation:

- The workflow tree stays intact: `stage-build-path`'s `parentId` is the workflow root, and its
  `childrenIds` do NOT include the spawned product root (`cascade.ts:49` derives `childrenIds` only
  from `spec` entries whose `parent` names this node — the spawned product is in a DIFFERENT spec, so
  it can never appear there).
- The spawned product tree stays intact: its root is the null-parent root of its OWN tree
  (`treeFromQueue(newKey, state)` builds it from the spawned `WorkItemQueued` events), with the
  workflow nowhere in its parent chain.
- The link "workflow `build-path` node → spawned product root" is a SINGLE `PlanNodeId` — a typed
  edge OFF the spine, the same `metadata.crossRefs` discipline `cascade.ts:16,68` already uses for the
  ADR-graph cross-links. It is a reference (one id), never a parent list.

This is the kernel's own rule, applied verbatim: cross-links are a separate `PlanNodeId` relation,
never multi-parent.

### KD-2 — OQ-2 RESOLVED → the cross-link is DERIVED (store-generators-derive-graphs)

The cross-link is NOT a stored cross-ref field that the kernel persists on a `PlanNode`. It is
RECONSTRUCTABLE from the log + the workflow node, because the spawned root's id is DETERMINISTIC:

```text
spawnedProductRoot.id === uuidv5('cascade:' + newKey)
```

where `newKey` is the `build-path` action's argument (`cascade.ts:25` derives every node id as
`uuidv5('cascade:' + key)`; `scope.ts:15` is the SHA-1 v5 hash). So a derived helper reconstructs the
link from the log and the node — a VIEW, never stored state
([ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) §4):

```ts
// src/workflow/cross-tree.ts (new) — DERIVED, never stored.
import { uuidv5 } from '../scope.js';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';

/** The spawned product-tree root a build-path node points at — DERIVED from the
 *  newKey the action carried, never a stored cross-ref field on the kernel node. */
export function spawnedProductRootOf(node: PlanNode): string | undefined {
  const meta = node.metadata as Record<string, unknown>;
  if (meta['action'] !== 'build-path') return undefined;
  const args = (meta['actionArgs'] as Record<string, unknown> | undefined) ?? {};
  const newKey = args['newKey'];
  return typeof newKey === 'string' ? uuidv5('cascade:' + newKey) : undefined;
}
```

**PROVENANCE-IN-LOG (the recommended form).** Two sources can supply `newKey` to the derivation, and
they trade off cleanliness:

1. **Provenance-in-metadata (RECOMMENDED).** When the `build-path` handler emits the spawned product's
   events, it records the SPAWNING workflow nodeId on the emitted event's `metadata` (e.g.
   `metadata.spawnedBy = '<workflow build-path nodeId>'`), riding the ADR-176 §3 JSONB boundary — NO
   new typed kernel field. The cross-DAG is then a pure DERIVED SCAN of the log: for any spawned
   product whose first event carries `metadata.spawnedBy`, the reverse link is read directly from the
   log, and the forward link (`spawnedProductRootOf`) confirms it via the `uuidv5` derivation. The
   generator is EXPLICITLY in the log; the cross-DAG is a pure derived scan with no out-of-band state.
   The envelope already carries a `metadata` object (`events.ts:175-188`, currently `{ actorRef }`), so
   this rides an existing slot.
2. **actionArgs + uuidv5 (FALLBACK).** If `ProductRegistered` cannot carry the `spawnedBy` metadata
   on its emit path without touching the typed payload schema, fall back to reading `newKey` from the
   workflow node's `metadata.actionArgs` (or the actuation `args`) and deriving the root via `uuidv5`
   alone (`spawnedProductRootOf` above). The link is still fully derived — it just leans on the
   workflow node's recorded args rather than a provenance field on the spawned event.

Both are ADR-176-safe (neither adds a typed kernel field; both keep the link a derived view). The
implementer should PICK BY RECON of whether the spawned-product emit path can ride the envelope
`metadata` cleanly. **Recommendation: provenance-in-metadata** — recording `spawnedBy` on the spawned
event makes the generator (the workflow node that spawned this product) live IN THE LOG, so the
cross-DAG is a pure backward scan + the forward `uuidv5` check, with no reliance on the workflow node
still carrying the original `actionArgs`. The fallback is acceptable and equally kernel-safe; it is
chosen only if the emit path makes the metadata ride awkward.

### KD-3 — The handler COMPOSES, it does not author

The `build-path` handler adds NO new write machinery. It calls the EXISTING generate path:

```ts
// src/workflow/actions.ts (extend) — the third registry entry.
const buildPathAction: ActionHandler = (deps, args) => {
  const blueprint = ProductBlueprintSchema.parse(args['blueprint']);
  const newKey = String(args['newKey']);
  const spec = blueprintToSpec(blueprint, newKey);   // ADR-249 re-key (generate.ts:99)
  // queuePush is store-locked (ops.ts:44) + appends ProductRegistered + WorkItemQueued.
  // Provenance-in-metadata (KD-2 recommended): pass the spawning workflow nodeId so the
  // spawned events carry metadata.spawnedBy (the implementer wires this on the emit path).
  return generateFromSpec(deps, spec, newKey /*, spawnedBy */);
};

ACTION_REGISTRY:  // …add ['build-path', buildPathAction]
```

- It REUSES `blueprintToSpec` + `queuePush` — the same path `foundry_generate_from_blueprint` runs
  (`tools.ts:100-135`); a small `generateFromSpec` helper (extracted from that tool body, or the tool
  body called directly) maps the spec's work-items into `queuePush` items (carrying `ancestry`,
  `yields`, `effects` exactly as the existing tool does, `tools.ts:117-131`).
- It is STORE-LOCKED transitively: `queuePush` runs under `withStoreLock(deps.dataDir, …)`
  (`ops.ts:45`), so the spawn inherits concurrency safety — `actuate` adds no lock of its own (the
  Slice-1 invariant, `actions.ts:47`).
- It FIRES ONCE: `actuate`/`actuateNode` call the handler synchronously, once, at actuation time. The
  emitted `ProductRegistered` + `WorkItemQueued` events land in the log; replay folds THOSE events and
  never re-runs the handler — the Command-pattern-event-sourced invariant from ADR-263 D3.

### KD-4 — ADR-176 verdict: PACK-LEVEL (zero kernel change)

The P7 / Slice-1 precedent applies again. The action `kind` `'build-path'` rides the `metadata` JSONB
boundary; the handler + the registry entry are pack code; the generate machinery
(`blueprintToSpec`/`queuePush`) is EXISTING pack code; the cross-link is a DERIVED `PlanNodeId`
reference (a view, never stored). Applying the inclusion test (§4 below): leg (a) — a `build-path`
action + a derived cross-link is NOT one of the four kernel concerns (the plan tree is, but no NEW
kernel shape is added — the spawned product tree is the existing plan-tree primitive); leg (b) — no
≥2-pack need (single consumer, `domains/foundry`). Both legs FAIL → pack territory. **Zero kernel
change; zero design-system change.**

---

## 3. Slice 2 — "a workflow intervention spawns a product tree across trees"

The thinnest falsifiable slice: register `build-path` in the action registry, point the existing
`stage-build-path` node at it, and prove that actuating it spawns a well-formed product tree the
frontier picks up — with the cross-link a single DERIVED `PlanNodeId` reference and both trees still
strictly single-parent.

### 3.1 Mechanism + file:line touch-points

| # | Touch-point | What |
|---|---|---|
| 1 | `src/workflow/actions.ts` (extend) | Add `build-path → buildPathAction` to `ACTION_REGISTRY` (`actions.ts:37`). The handler reuses `blueprintToSpec` (`generate.ts:99`) + `queuePush` (`ops.ts:44`) — the `foundry_generate_from_blueprint` path (`tools.ts:100-135`) — emitting `ProductRegistered` + `WorkItemQueued` (NO new event type). It rides the Slice-1 `actuate`/`actuateNode` resolve-or-throw unchanged. |
| 2 | `src/instances/foundry-workflow.ts` (extend) | The EXISTING `stage-build-path` node (`foundry-workflow.ts:57-62`) gains `meta.action = 'build-path'`. The concrete target (`blueprint`, `newKey`) is supplied at ACTUATION via `actuateNode(deps, node, { blueprint, newKey })` — the `args` override (`actions.ts:70`), so the workflow tree carries the COMMAND, not a baked-in product. |
| 3 | `src/workflow/cross-tree.ts` (new) | `spawnedProductRootOf(node)` (+ a `crossTreeLinks(state)` log scan when provenance-in-metadata is chosen, KD-2) — the DERIVED helper reconstructing the workflow-node → product-root link from the log + the node. No stored cross-ref field. |
| 4 | `test/workflow-build-path.acid.test.ts` (new) | The acid battery (§3.2), every acid against a TEMP log. |

The kernel, `substrate-contracts`, the conductor, and the dashboard are UNTOUCHED in Slice 2.

### 3.2 Acid battery — each must BITE

Committed + deterministic, run unconditionally in `ci:local`. Every acid runs against a TEMP log —
NEVER the live one.

**(a) Actuation spawns a product tree the frontier picks up.** Seed a temp log (empty or with the
foundry product). Build a small target blueprint (a root + one work-item; reuse `extractBlueprint` over
a tiny spec, or a fixture). `actuateNode(deps, buildPathNode, { blueprint, newKey: 'spawned-x' })` (or
`actuate(deps, 'build-path', { blueprint, newKey: 'spawned-x' })`); re-`fold` the temp log → assert the
spawned product is registered (`state.products.has('spawned-x')`), its `WorkItemQueued` landed
(`state.items.has('spawned-x/…')`), and `planFrontierAll(state, now)` INCLUDES the spawned work-item
(`plan-frontier-all.ts:24` folds `s.products.keys()`, so the new product enters the frontier). The
spawned tree is well-formed: `buildCascadeTree(treeFromQueue('spawned-x', state))` parses
(`cascade.ts:53`). **BITE:** drop the `'build-path'` entry from `ACTION_REGISTRY` → `actuate` throws
`unknown action: build-path …` (the closed-registry guarantee, `actions.ts:50`) → no spawn → the
`products.has('spawned-x')` assertion fails → RED.

**(b) The cross-link is a SINGLE `PlanNodeId` reference, DERIVED.** Build `FOUNDRY_WORKFLOW`; locate
the `stage-build-path` node. After the spawn (a), call `spawnedProductRootOf(buildPathNode)` → assert
it returns ONE id, and that id `=== uuidv5('cascade:spawned-x')` `=== treeFromQueue('spawned-x',
state).treeRootId` (the ACTUAL spawned-tree root). Assert it is a single id (a reference), NOT a
parent list. **BITE:** corrupt the derivation (return `uuidv5('cascade:' + 'wrong')`, or read the
wrong arg key) → the id mismatches the actual spawned root → RED.

**(c) Single-parent preserved across BOTH trees after the spawn.** After the spawn, assert the
workflow `build-path` node's built `childrenIds` do NOT include the spawned product root
(`buildPathNode.childrenIds.indexOf(spawnedRoot) === -1`), and the spawned tree's root has
`parentId === null` (its OWN tree's root) and appears as a child of NO workflow node. Walk both trees:
every node has exactly one parent (`parentId === null` for exactly one node per tree; every other node
a single non-null `parentId`). **BITE:** if the link were modeled as a parent edge (push the product
root into `buildPathNode.childrenIds`, or set the product root's `parentId` to the workflow node) →
the product root would have TWO parents (the workflow node AND its own null-root identity) → the
single-parent assertion fails → RED.

**(d) Store-generators-derive-graphs — the link survives a fold-from-scratch.** Re-`fold` the temp log
FROM SCRATCH (a fresh `fold(readEnvelopes(logPath))`) → assert `spawnedProductRootOf(buildPathNode)`
(and, under provenance-in-metadata, the `crossTreeLinks` log scan) reconstructs the SAME link with NO
new typed cross-ref field read off any `PlanNode` (assert no `PlanNode.metadata.spawnedRoot` stored
field is required — the link is computed, not read from a persisted kernel field). **BITE:** a
stored-state cross-ref (a `spawnedRoot` field baked onto the workflow `PlanNode` and trusted as
authoritative) would survive a fold-from-scratch DIFFERENTLY from the log-derived computation (it would
go stale, or be absent on a fresh fold) → the reconstructed-link-equals-derived assertion fails → RED.

**(e) Replay = events, not handler-rerun.** `actuate` the `build-path` action ONCE → assert the
spawned `ProductRegistered` count is exactly one and each `WorkItemQueued` landed once (seed + the
spawn's events). Then `fold` the temp log MANY times (a pure projection — no handler in the loop) →
assert every fold reproduces the spawned product identically AND the `ProductRegistered` /
`WorkItemQueued` counts are STABLE across replays (re-folding did not re-run the handler). **BITE:** a
fold that called `actuate` on replay would multiply the spawned events → the count-is-stable assertion
fails → RED. The event-sourced invariant (ADR-263 D3): the handler fires once at actuation, replay
folds the emitted events.

### 3.3 What Slice 2 deliberately does NOT do

- It does NOT derive workflow advancement / scheduled-wake (Slice 3) — `actuate` is called directly by
  the acid, proving the spawn mechanism.
- It does NOT wire the conductor to walk the workflow tree and fire `build-path` on a ready node
  (Slice 4).
- It does NOT surface `build-path` as a dashboard button (Slice 5).
- It does NOT add a new event type — the spawn rides the EXISTING `ProductRegistered` + `WorkItemQueued`
  (the ADR-249 generate path).

---

## 4. ADR-176 inclusion test — NOT triggered (pack-level)

Applying the inclusion test
([ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) §2 — BOTH
legs must hold for a thing to be kernel):

- **(a) Is "a `build-path` action + a cross-tree `PlanNodeId` reference" one of the four kernel
  concerns?** No new kernel shape. The plan tree IS a kernel concern (recurse the plan, ADR-127 §1.1),
  but the SPAWNED product tree is the EXISTING plan-tree primitive — `build-path` instantiates another
  `CascadeNodeSpec[]`, adding nothing new. The action `kind` rides the `metadata` JSONB boundary
  (ADR-176 §3); the handler + registry entry are pack code; the cross-link is a DERIVED `PlanNodeId`
  reference (ADR-176 §4, store-generators-derive-graphs — a view, never stored), and the optional
  `metadata.spawnedBy` provenance rides the same JSONB boundary (no typed kernel field).
- **(b) Is the `build-path` action / the cross-tree link needed by ≥2 packs as shared infrastructure
  the kernel must validate / query / version?** No. Single consumer (`domains/foundry`). No second
  pack needs a foundry-workflow `build-path` action or its spawn linkage; the kernel must not validate
  / version a pack's action handler or its derived cross-DAG.

**Both legs FAIL → pack territory.** This is the **P7 / Slice-1 precedent applied again**: the plan
node + the spawned tree are kernel (the existing primitive); the action `kind` (in `metadata`) + the
handler + the registry + the derived cross-link are pack-authored, referencing existing kernel ids.
**"Store generators, derive graphs" is UPHELD** (ADR-176 §4): the workflow STRUCTURE + the spawned
product STRUCTURE live in the log (the generators), and the cross-DAG ("workflow node → spawned root")
is a DERIVED VIEW reconstructed from the log + the node — nothing authoritative is stored outside the
log, and no second parent edge is created. **Zero kernel change.**

---

## 5. The ladder — where this sits

| Slice | What | Mechanism |
|---|---|---|
| **1 (shipped)** | A workflow intervention actuates a real action. | `FOUNDRY_WORKFLOW` tree + `actuate`/`actuateNode` + `ACTION_REGISTRY` seeded with `reprioritize-product` + `request-gate`; one node carries both an action and a declared effect. |
| **2 (this)** | A workflow intervention SPAWNS a product tree across trees. | A `build-path` handler reusing `blueprintToSpec` + `queuePush` (ADR-249 generate path, NO new event type); the cross-link a DERIVED `PlanNodeId` reference (`spawnedProductRootOf` / `crossTreeLinks`), provenance-in-metadata (`metadata.spawnedBy`) preferred; both trees strictly single-parent (KD-1/KD-3, ADR-127). Resolves ADR-263 OQ-2. |
| **3 (next)** | Derived workflow advancement. | The workflow's own frontier (`planFrontier(buildCascadeTree(FOUNDRY_WORKFLOW), state, now)`, `frontier.ts`), stage completion as an EVENT + the next stage's reachability a derived `dependsOn` — POKED by scheduled-wake (P6, `dueWakes`, `wake.ts:22`), never a callback (ADR-263 D4 / OQ-1). |
| **4** | The conductor walks the workflow tree. | The conductor pulls the workflow frontier (Slice 3) and `actuate`s each ready node — `build-path` becomes a conductor-fired spawn, not an acid-fired one. |
| **5** | T0/T2 variants + the cockpit drives the workflow. | Sibling `FOUNDRY_WORKFLOW` variants; the dashboard (ADR-261/262) surfaces `build-path` as a confirm-gated button — a founder click `actuate`s the spawn. |

Slice 3 (derived workflow advancement) is the natural next rung: once the workflow can SPAWN, the
pipeline needs to ADVANCE from one stage to the next on its own derived frontier — the OQ-1 story
ADR-263 left open.

---

## 6. What does NOT change

- **No kernel contract.** `@de-braighter/substrate-contracts` is byte-unchanged — the spawned product
  tree is the EXISTING plan-tree primitive (`buildCascadeTree` / `PlanTreeSchema`), the action `kind`
  rides the EXISTING `metadata` JSONB boundary, the optional provenance rides the EXISTING envelope
  `metadata` (`events.ts:175-188`), and no new event type is added (the spawn emits the EXISTING
  `ProductRegistered` + `WorkItemQueued`).
- **No design-system change.** Slice 2 has no UI; the handler + the derived helper are pure pack code.
- **No new dependency.** The handler reuses existing functions; `ACTION_REGISTRY` is the same `Map`.
- **No new write machinery.** The handler wraps the EXISTING store-locked `queuePush`; `actuate` adds
  only kind-keyed dispatch (the Slice-1 invariant).
- **The kernel, the conductor, and the dashboard are untouched in Slice 2.** They are extended, not
  modified, by later rungs.

---

## 7. Slice scope

- **foundry:** extend `src/workflow/actions.ts` (register `build-path → buildPathAction` reusing
  `blueprintToSpec` + `queuePush`), extend `src/instances/foundry-workflow.ts` (the
  `stage-build-path` node gains `meta.action = 'build-path'`, target supplied at actuation), add
  `src/workflow/cross-tree.ts` (`spawnedProductRootOf` / `crossTreeLinks` — the DERIVED helper), and
  the acids in `test/workflow-build-path.acid.test.ts`
  (actuation-spawns-a-product-tree-the-frontier-picks-up · cross-link-is-a-single-derived-PlanNodeId ·
  single-parent-preserved-across-both-trees · store-generators-derive-graphs-survives-fold-from-scratch
  · replay-is-events-not-handler-rerun). It REUSES `blueprintToSpec` (`generate.ts:99`), `queuePush`
  (`ops.ts:44`), `uuidv5('cascade:' + key)` (`cascade.ts:25` / `scope.ts:15`), `planFrontierAll`
  (`plan-frontier-all.ts:24`), and the Slice-1 `actuate`/`actuateNode`/`ACTION_REGISTRY`
  (`actions.ts:37-71`). **No `@de-braighter/*` change.**
- **specs:** ADR-264 — codifies the four key decisions: (KD-1) the cross-tree reach is a `PlanNodeId`
  reference, never multi-parent (two independent single-parent trees); (KD-2) OQ-2 resolved → the
  cross-link is DERIVED (store-generators-derive-graphs), provenance-in-metadata preferred; (KD-3) the
  handler COMPOSES (reuses the ADR-249 generate path, store-locked, fires once, replay folds events);
  (KD-4) ADR-176 verdict PACK-LEVEL, zero kernel change. Resolves ADR-263 OQ-2.

This slice depends only on the existing generate machinery (`blueprintToSpec` + `queuePush`), the
existing deterministic id scheme (`uuidv5('cascade:' + key)`), and the Slice-1 action registry. It is
the realization of ADR-263 D5 — the workflow's `build-path` stage spawning a product tree across trees,
with the kernel's single-parent rule preserved by construction.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
