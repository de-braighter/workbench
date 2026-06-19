# Foundry workflow as a first-class plan tree + a kind-keyed action registry

> Foundry already models per-PRODUCT plan trees — the WHAT (`Product → Capability → Feature →
> WorkItem`), derived from `WorkItemQueued` events via `treeFromQueue` and driven by
> `planFrontierAll`. But the foundry WORKFLOW — the HOW (`intake → opportunity-brief → gate →
> charter → build-path → conduct → review → ship`) — is still PROCEDURAL: it lives in the
> `/foundry-*` skills, the conductor loop, and a scatter of gate events, NOT as a first-class plan
> tree. This converges two moves. **(1)** Promote the workflow to a first-class plan tree
> (`FOUNDRY_WORKFLOW`) — the SAME single-parent `CascadeNodeSpec` tree the existing
> `buildCascadeTree` already builds, distinct from the per-product trees, reusable (T0/T2 variants
> later). **(2)** Give its interventions a way to ACTUATE external work via a **kind-keyed action
> registry** — the "function on the intervention", done substrate-correctly: the node carries an
> action `kind` in its `metadata` (the serializable COMMAND, riding the `metadata` JSONB boundary),
> the pack runtime holds a static `kind → handler` dispatch table (the FUNCTION, pack code), and
> `actuate(deps, kind, args)` resolves and runs it — the handler executes the external action
> (calling existing store-locked ops) and EMITS EVENTS. This is the **Command pattern,
> event-sourced**: the command is data on the node, the handler is pack code, executing it emits
> events, and REPLAY folds the events — it never re-runs the handler. **Zero kernel change** — the
> workflow tree is the existing plan-tree primitive, the action `kind` rides `metadata`, the registry
> and `actuate()` are pack code, `effectDeclarations` are existing (ADR-176 NOT triggered).

- **Date:** 2026-06-19
- **Scope:** `domains/foundry` — a new workflow module + the workflow tree (which ships under
  `src/instances/`, alongside the other instance trees):
  `src/instances/foundry-workflow.ts` (new — `FOUNDRY_WORKFLOW: CascadeNodeSpec[]`, a small flat
  tree: sibling pipeline-stage nodes under ONE root; at least one node carries BOTH `metadata.action`
  and `effects`), `src/workflow/actions.ts` (new — the `kind → handler` action registry, a static
  `ReadonlyMap` mirroring the `CompileTarget` registry `src/compiler/registry.ts:8`, plus
  `actuate(deps, kind, args)` and `actuateNode(deps, node)` — resolve → run → events; unknown kind →
  throw), and
  `test/workflow-actions.acid.test.ts` (new acids — actuation-executes-the-real-op,
  closed-registry-throws, declaration⊥actuation-coexist, replay-is-events-not-handler-rerun,
  workflow-tree-is-a-valid-single-parent-PlanTree, actuateNode-fires-from-the-node). It REUSES the
  existing `buildCascadeTree`
  (`src/plan/cascade.ts:24`), the existing `reprioritizeProduct` op (`src/ops.ts:79`), one more
  existing store-locked op (`gateRequest`, `src/ops.ts:294`), and the existing
  `EffectDeclaration` field on `CascadeNodeSpec.effects` (`cascade.ts:21,44`). **No
  `@de-braighter/substrate-*` change. No `@de-braighter/design-system-*` change.**
- **Predecessors / boundary:**
  [ADR-262](../../../layers/specs/adr/adr-262-foundry-dashboard-interactive-actions.md) (the
  dashboard reprioritize action — foundry's FIRST actuation; this generalizes that single button
  into a registry),
  [ADR-261](../../../layers/specs/adr/adr-261-foundry-observability-dashboard.md) (the dashboard /
  cockpit — Slice 5 surfaces workflow actions there),
  [ADR-259](../../../layers/specs/adr/adr-259-foundry-browser-runtime-compile-target.md) (the P7
  crown — "button = intervention / trigger", the actuation precedent: the substrate-architect ruled
  the binding PACK-LEVEL, rejecting an `InterventionDescriptor` kernel contract),
  [ADR-154](../../../layers/specs/adr/adr-154-algebraic-effect-declarations-and-composition-operators.md)
  (effect-declaration algebra — the DECLARATION axis, distinct from actuation),
  [ADR-246](../../../layers/specs/adr/adr-246-foundry-queue-events-are-plan-node-declarations.md)
  (`treeFromQueue` / `planFrontier` — the workflow tree reuses this frontier fold for derived
  advancement, Slice 3),
  [ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) (the
  inclusion test — §6, both legs fail),
  [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md) (the four kernel concerns +
  the cross-link rule — a `PlanNodeId` reference, never multi-parent).
- **Provenance.** Converged with the founder + recon-confirmed against the live foundry source: the
  cascade builder (`buildCascadeTree(spec: CascadeNodeSpec[]): PlanTree`, `cascade.ts:24`, where
  `CascadeNodeSpec` already carries BOTH `meta?` and `effects?: EffectDeclaration[]`,
  `cascade.ts:21`, mapped to `PlanNode.effectDeclarations` at `cascade.ts:44`), the `CompileTarget`
  registry the action registry mirrors (`ReadonlyMap<string, AnyTarget>` + a resolve-or-throw
  `compile`, `registry.ts:8-24`), the corrective op (`reprioritizeProduct`, `ops.ts:79`, store-locked
  under `withStoreLock(deps.dataDir, …)`), the gate-REQUEST op (`gateRequest`, `ops.ts:294` — an
  AUTOMATION op the workflow may actuate; the gate-DECISION op `gateDecide` stays founder-gated and is
  NOT a registry seed), the external-clock
  wake decision (`dueWakes(state, nowMs)`, `plan/wake.ts:22`, the P6 pattern Slice 3 reuses), and the
  universal frontier fold (`planFrontierAll(state, nowMs)`, `plan/plan-frontier-all.ts:24`).

---

## 1. The WHAT-vs-HOW split — and why the HOW is procedural today

Foundry runs two kinds of structure, and only one of them is a first-class plan tree.

| | The WHAT — the product tree | The HOW — the workflow |
|---|---|---|
| **Models** | What each product IS: `Product → Capability → Feature → WorkItem` | How the machine BUILDS a product: `intake → opportunity-brief → gate → charter → build-path → conduct → review → ship` |
| **Today** | A first-class plan tree. `treeFromQueue(productKey, state)` derives a `CascadeNodeSpec` from `WorkItemQueued` events (ADR-246); `buildCascadeTree` turns it into a kernel `PlanTree`; `planFrontierAll` drives the frontier (ADR-247). | PROCEDURAL. It lives in the `/foundry-*` skills (the prompts the conductor runs), the conductor loop (which step comes next), and a scatter of gate events. There is no `FOUNDRY_WORKFLOW` plan tree; no node says "this is the build-path stage". |
| **Per-instance** | One tree PER PRODUCT (oncology, whales-and-bubbles, …). | One pipeline, re-run for every product. Reusable by construction. |

The product tree got promoted to a plan tree because the machine needed to DERIVE claimability over
it (the frontier). The workflow never did — the conductor "just knew" the next step from the skill it
was running. That works, but it leaves the HOW invisible to everything the substrate makes
first-class about the WHAT:

- **The twin can't see the pipeline.** The product tree's progress is derived from the log; the
  workflow's progress is implicit in which skill the conductor last ran. The dashboard (ADR-261)
  renders per-product trees but has no node for "we are at the build-path stage of oncology".
- **The pipeline can't carry declared effects.** A workflow stage that is PREDICTED to move a
  delivery indicator (e.g. "a charter gate reduces downstream rework") has nowhere to declare it —
  there is no `PlanNode` to hang an `effectDeclaration` on.
- **The pipeline can't be a compile target.** The product tree compiles to a test-harness, a
  render-tree, and a browser-runtime (ADR-250/259). The workflow, being procedural, compiles to
  nothing — you cannot project it, validate it, or surface its stages as buttons.
- **There is no place to attach an ACTION.** When a workflow stage should TRIGGER external work
  (spawn a product tree, decide a gate, reprioritize), there is no node to carry the trigger and no
  uniform mechanism to fire it. The reprioritize button (ADR-262) is the ONE actuation that exists,
  and it is hand-wired into the dashboard, not attached to a workflow node.

This converges the fix: **make the workflow a first-class plan tree, AND give its nodes a uniform way
to actuate.**

---

## 2. The five key decisions

### KD-1 — The workflow IS a first-class plan tree (`FOUNDRY_WORKFLOW`)

The foundry workflow becomes `FOUNDRY_WORKFLOW`, a single-parent `CascadeNodeSpec` tree of
pipeline-stage nodes (`intake → opportunity-brief → gate → charter → build-path → conduct → review →
ship`), built by the EXISTING `buildCascadeTree` (`cascade.ts:24`) into a kernel `PlanTree`. **No new
kernel shape** — it is the same plan-tree primitive the product trees already use, just a DIFFERENT
tree: the product tree is the WHAT (one per product), the workflow tree is the HOW (one pipeline,
reusable). Because it is an ordinary `CascadeNodeSpec[]`, it round-trips JSON through the append-only
log, re-folds, validates via `PlanTreeSchema.parse` (`cascade.ts:53`), and reproduces — exactly like a
product tree. The topology is a FLAT fan-out, NOT a nested pipeline: all stage nodes are SIBLINGS under
ONE workflow root (each stage's single parent is the root), so the `intake → … → ship` arrows describe
the SEQUENCE, not tree nesting — stage ORDERING is a derived `dependsOn` (the KD-4 frontier-advancement
story, Slice 3), never tree depth. Later slices add T0/T2 workflow VARIANTS (a lighter pipeline for a
game-jam product, a heavier one for a regulated health product) as sibling `CascadeNodeSpec[]`
instances.

### KD-2 — Interventions actuate via a kind-keyed action registry (the function on the intervention, done substrate-correctly)

A workflow node needs to DO something — spawn a product tree, request a gate, reprioritize. The
naive instinct is "put a function on the node". **You cannot.** The kernel node is DATA, not code:
it round-trips JSON through the append-only log, is re-folded, validated, and reproduced, so a live
function cannot be serialized onto it. The substrate-correct resolution splits the function into a
serializable command + a code dispatch table:

- **The COMMAND is data on the node.** The node carries an action `kind` (and its args) in its
  `metadata` — `metadata.action` is the kind string (`'reprioritize-product'`) and
  `metadata.actionArgs` its args. This is the
  serializable command, riding the `metadata` JSONB extension boundary (ADR-176 §3: the deliberate
  per-pack extension space). It survives the log round-trip because it is plain JSON.
- **The FUNCTION is pack code.** `src/workflow/actions.ts` holds a static `kind → handler` dispatch
  table — a `ReadonlyMap<string, ActionHandler>`, the SAME shape as the `CompileTarget` registry
  (`registry.ts:8`). The handlers are real functions; they live in pack code, never on the node.
- **`actuate(deps, kind, args)` resolves and runs.** It looks the `kind` up in the table, calls the
  handler with `(deps, args)`, and the handler executes the external action (by calling an EXISTING
  store-locked op) and EMITS EVENTS. An unknown `kind` THROWS (closed registry) — the same
  resolve-or-throw discipline `compile()` uses (`registry.ts:20`).

This is the **Command pattern, event-sourced** (§4): the command is data on the node, the handler is
pack code, executing the command emits events, and replay folds the events — it NEVER re-runs the
handler.

### KD-3 — Declaration ⊥ actuation (two independent axes on a node)

A workflow node carries up to two orthogonal things, and they DO NOT interact:

| Axis | What it is | Where it lives | Who reads it |
|---|---|---|---|
| **Declaration** | The DECLARED causal-twin effect — "this stage is predicted to shift indicator X" (ADR-154). | `PlanNode.effectDeclarations` (the kernel-typed field, `CascadeNodeSpec.effects`, `cascade.ts:21,44`). | The inference / twin side — composes effects, computes posteriors. |
| **Actuation** | The ACTUATION — "this stage DOES Z" (spawn a tree, request a gate, reprioritize). | `PlanNode.metadata.action` (the kind string) + `PlanNode.metadata.actionArgs` (pack vocabulary in the JSONB boundary). | The pack runtime — `actuate()` resolves the `kind` and fires the handler. |

A node can carry BOTH, NEITHER, or EITHER. They are independent: a declaration is a PREDICTION the
twin reasons about; an actuation is a SIDE EFFECT the runtime performs. The twin never fires an
action; `actuate` never touches an effect declaration. Slice 1 proves they coexist on one node
(§5, acid (c)).

### KD-4 — Control flow stays DERIVED (event-sourced), not callbacks

The workflow ADVANCES the same way the product frontier advances: completion is an EVENT, and the
next stage's reachability is a DERIVED dependency — the same shape as a work-item `dependsOn`,
evaluated by the SAME frontier fold (`planFrontier` / `planFrontierAll`, `frontier.ts:96` /
`plan-frontier-all.ts:24`). A stage becomes reachable when its predecessor's completion event lands;
an external re-check (a scheduled-wake / the conductor — P6's external-clock pattern, `dueWakes`,
`wake.ts:22`) POKES the fold to re-derive the frontier. There is **no registered in-memory
continuation, no callback, no `.then()` chained onto the handler.**

**Why no callback.** A callback is ephemeral and invisible to everything the substrate makes
first-class:

- **Invisible to replay / reproducibility** (a kernel concern, ADR-127 §1.4). A callback is a live
  closure; it is not in the log, so a replay cannot reconstruct "what was scheduled to happen next".
  A derived dependency IS in the log (it is the completion event + the `dependsOn` structure), so
  replay reproduces the frontier exactly.
- **Invisible to the twin.** The twin reasons over the plan tree + the observation log. A callback
  is neither; a `dependsOn` edge is structure the twin can see.
- **Invisible to the cockpit.** The dashboard derives everything from the log (ADR-261). "What runs
  next" must be derivable from the log, not held in a process's memory — otherwise the cockpit
  cannot show it and a restart loses it.
- **P6 already made exactly this call.** Scheduled-wake (ADR-256) deliberately kept the clock
  EXTERNAL and the due-set DERIVED (`dueWakes` is a pure decision over folded state), precisely to
  avoid an in-process timer / continuation. The workflow advances on the same principle.

### KD-5 — Cross-tree triggers are a `PlanNodeId` reference, never multi-parent

The workflow's `build-path` stage SPAWNS a product tree — a reach ACROSS trees (the HOW kicks off a
WHAT). The kernel's own rule governs this (ADR-127 / north-star §20): **single-parent trees are
preserved; the reach-across is a typed `PlanNodeId` edge, derived where possible — never a second
parent.** The workflow's `build-path` node references the product-tree root it spawned by id (a
`metadata.spawnedRoot: PlanNodeId`, a cross-link off the spine, the same `metadata.crossRefs`
discipline `cascade.ts:68` already uses). This is a LATER slice (Slice 2) — noted here so the
mechanism is designed for it, not retrofitted.

---

## 3. The mechanism — the action registry (`src/workflow/actions.ts`)

The registry is a static `ReadonlyMap<string, ActionHandler>` mirroring the `CompileTarget` registry
verbatim (`registry.ts:8-24`), plus a resolve-or-throw `actuate`. The handlers wrap EXISTING
store-locked ops; the registry adds the kind-keyed dispatch.

```ts
// src/workflow/actions.ts (new)
import { gateRequest, reprioritizeProduct, type FoundryDeps } from '../ops.js';
import type { PlanNode } from '@de-braighter/substrate-contracts/plan-tree';

/** A serializable command name carried in a plan node's metadata. */
export type ActionKind = string;

/** The function on the intervention. Each handler validates/casts its own args. */
export interface ActionHandler {
  (deps: FoundryDeps, args: Record<string, unknown>): unknown;
}

const reprioritizeProductAction: ActionHandler = (deps, args) =>
  reprioritizeProduct(deps, {
    productKey: String(args['productKey']),
    priority: Number(args['priority']),
  });

const requestGateAction: ActionHandler = (deps, args) =>
  gateRequest(deps, {
    productKey: String(args['productKey']),
    gateType: args['gateType'] as Parameters<typeof gateRequest>[1]['gateType'],
    ...(args['payloadRef'] != null ? { payloadRef: String(args['payloadRef']) } : {}),
  });

/** kind → handler. Static + closed: every entry wraps an EXISTING store-locked op. */
export const ACTION_REGISTRY: ReadonlyMap<ActionKind, ActionHandler> = new Map<ActionKind, ActionHandler>([
  ['reprioritize-product', reprioritizeProductAction],
  ['request-gate', requestGateAction],
]);

export function listActions(): string[] {
  return [...ACTION_REGISTRY.keys()].sort();
}

/** Resolve `kind` in the closed registry and run it. Unknown kind throws (no
 *  silent no-op). The handler's underlying op is store-locked; actuate is thin. */
export function actuate(deps: FoundryDeps, kind: ActionKind, args: Record<string, unknown> = {}): unknown {
  const handler = ACTION_REGISTRY.get(kind);
  if (handler == null) {
    throw new Error(`unknown action: ${kind}. Available: ${listActions().join(', ')}`);
  }
  return handler(deps, args);
}

/** Actuate the action carried on a plan node: node.metadata.action (data) →
 *  registry handler (code). `args` override node.metadata.actionArgs. */
export function actuateNode(deps: FoundryDeps, node: PlanNode, args?: Record<string, unknown>): unknown {
  const meta = node.metadata as Record<string, unknown>;
  const kind = meta['action'];
  if (typeof kind !== 'string') {
    throw new Error(`node ${node.id} carries no action (metadata.action)`);
  }
  const nodeArgs = (meta['actionArgs'] as Record<string, unknown> | undefined) ?? {};
  return actuate(deps, kind, args ?? nodeArgs);
}
```

- **The handlers wrap EXISTING ops.** `reprioritize-product → reprioritizeProduct` (`ops.ts:79`) is
  the seed (foundry's first actuation, ADR-262, now reachable from a workflow node). `request-gate →
  gateRequest` (`ops.ts:294`) is the second — an AUTOMATION op (the workflow REQUESTS a gate), chosen
  DELIBERATELY over `decide-gate`/`gateDecide`: a gate DECISION stays FOUNDER-GATED (the ADR-262
  governance model — live-canonical-log governance mutations are authorized by the founder's own
  click, never auto-actuated by the workflow), so a founder-governance DECISION is intentionally ABSENT
  from the auto-actuatable seed. Both seeds already run under `withStoreLock(deps.dataDir, …)`
  and APPEND events — `actuate` adds only the kind-keyed dispatch, no new write machinery.
- **Closed registry.** An unknown `kind` throws (`registry.ts:20` discipline). There is no dynamic
  registration, no eval, no string-to-function — the table is static and exhaustively known at
  build time.
- **Fires exactly once.** `actuate` calls the handler synchronously, once, at actuation time. The
  handler's events land in the log. Replay folds those events; it never calls `actuate` again (§4).

---

## 4. The Command pattern, event-sourced — handler fires once, events replayed

This is the conceptual crux: **how a "function on a data node" is correct in an event-sourced
kernel.** The Command pattern names the parts:

| Command-pattern part | Here | Substrate property it preserves |
|---|---|---|
| **Command (the request, as data)** | `metadata.action` (kind) + `metadata.actionArgs` on the `PlanNode` | Serializable → survives the log round-trip, re-folds, reproduces (the node stays DATA). |
| **Receiver (does the work)** | The existing store-locked op (`reprioritizeProduct`, `gateRequest`) | Already correct — `withStoreLock` + append-only. |
| **Invoker (dispatches)** | `actuate(deps, kind, args)` + the `ACTION_REGISTRY` table | Pack code, closed registry, resolve-or-throw. |
| **The record of what happened** | The events the handler emits | The append-only log — the durable memory. |

The lifecycle has TWO phases, and only the first runs the handler:

1. **Actuation (once).** Something fires `actuate(deps, kind, args)` — a conductor walking a ready
   workflow node, or (Slice 5) a founder clicking a button. The handler runs EXACTLY ONCE: it
   executes the external action and emits events into the append-only log.
2. **Replay (any number of times).** Folding the log to derive state replays the EMITTED EVENTS. It
   does NOT re-run `actuate` and does NOT re-run the handler. The action's effect is durably captured
   as events; re-deriving state re-reads those events.

So the handler is the only thing that touches the outside world, and it touches it once. The log is
the durable memory. This is why a callback would be wrong (KD-4): a callback is a live closure that
re-runs (or is lost) on replay; an emitted event is a fact that replays deterministically. **A
double-fold yields identical state with the handler called zero additional times** — that is the
acid (§5, acid (d)).

---

## 5. Slice 1 — "a workflow intervention actuates a real action"

The thinnest falsifiable slice: a small `FOUNDRY_WORKFLOW` tree + the action registry + `actuate`,
seeded with REAL actions wrapping EXISTING ops, with one node carrying BOTH an action and a declared
effect.

### 5.1 Mechanism + file:line touch-points

| # | Touch-point | What |
|---|---|---|
| 1 | `src/instances/foundry-workflow.ts` (new) | `FOUNDRY_WORKFLOW: CascadeNodeSpec[]` — sibling pipeline-stage nodes under ONE root (`intake`, `gate-greenlight`, `build-path`, `conduct`, `ship`, all parented to the workflow root). The dual node (`stage-gate-greenlight`) carries `metadata.action = 'reprioritize-product'` + `metadata.actionArgs = { productKey: 'foundry', priority: 500 }` AND `effects: [EffectDeclaration]` (a `cycle-time` declared twin effect), proving declaration⊥actuation coexist. Built by the existing `buildCascadeTree` (`cascade.ts:24`). |
| 2 | `src/workflow/actions.ts` (new) | The `ACTION_REGISTRY` (a static `ReadonlyMap<ActionKind, ActionHandler>`, the `registry.ts:8` shape) seeded with `reprioritize-product → reprioritizeProduct` (`ops.ts:79`) and `request-gate → gateRequest` (`ops.ts:294`); `actuate(deps, kind, args)` (resolve → run → events; unknown kind → throw, the `registry.ts:20` discipline); `actuateNode(deps, node)` (read `metadata.action`/`actionArgs` off a node → `actuate`); `listActions()`. |
| 3 | `test/workflow-actions.acid.test.ts` (new) | The acid battery (§5.2), every acid against a TEMP log. |

The product tree, the conductor loop, the dashboard, and the kernel are all UNTOUCHED in Slice 1.

### 5.2 Acid battery — must BITE

Committed + deterministic, run unconditionally in `ci:local`. Every acid runs against a TEMP log —
NEVER the live one.

The battery exercises BOTH seeded actions — the `reprioritize-product` end-to-end actuation and the
second seed `request-gate` (asserted registered, the closed-registry guarantee covering both kinds).

**(a) Actuation executes the real op.** Seed a temp log with `productRegistered({ productKey:
'foundry', …, priority: 1 })`. Call `actuate(deps, 'reprioritize-product', { productKey: 'foundry',
priority: 500 })`; re-`fold` the temp log → `state.products.get('foundry').priority === 500` and
exactly one `ProductRegistered` event was appended. **MUTATION → RED:** drop the
`'reprioritize-product'` entry from the registry → `actuate` throws (unknown action) → no event
appended → the priority-is-500 assertion fails. (This is the headline bite: pull the registry entry,
the action stops happening.)

**(b) Closed registry — unknown kind throws; both seeds present.** `actuate(deps, 'does-not-exist',
{})` THROWS `unknown action: does-not-exist. Available: request-gate, reprioritize-product` (the
`listActions()` order is alphabetical) and appends NO event (assert the `ProductRegistered` count is
unchanged across the call). A companion acid asserts BOTH seeds are registered
(`ACTION_REGISTRY.has('reprioritize-product')` AND `ACTION_REGISTRY.has('request-gate')`), so the
closed registry covers two real actions. **MUTATION → RED:** replacing the
`if (handler == null) throw` with a silent `return undefined` lets the unknown-kind call pass → the
throw assertion fails.

**(c) Declaration ⊥ actuation coexist on one node.** Build `FOUNDRY_WORKFLOW` via `buildCascadeTree`;
locate the dual node (`stage-gate-greenlight`) → assert its `PlanNode.metadata.action ===
'reprioritize-product'` AND its `PlanNode.effectDeclarations?.[0]` is the declared `cycle-time` effect
(`cascade.ts:44` maps `effects` → `effectDeclarations`). Independence is asserted directly: there is no
effect field in `metadata` (`metadata.indicatorId` is undefined) and no action kind inside the effect
declaration (`JSON.stringify(effectDeclarations)` does not contain `'reprioritize-product'`) — the two
axes are different fields, neither derived from the other. **MUTATION → RED:** dropping `effects` from
the dual node leaves `effectDeclarations` undefined → the both-present assertion fails.

**(d) Replay = events, not handler-rerun.** `actuate` the `reprioritize-product` action ONCE → assert
exactly one actuation-emitted `ProductRegistered` event landed (seed + 1). Then `fold` the temp log
MANY times (a pure projection — no handler in the loop) → assert every fold yields
`products.get('foundry').priority === 500` AND the `ProductRegistered` count is STILL stable across
replays (re-folding did not re-run the handler). **MUTATION → RED:** a fold that called `actuate`
(re-running the handler on replay) would multiply the event count → the count-is-stable assertion
fails. This is the event-sourced invariant: the handler fires once at actuation, replay folds the
emitted events.

**(e) The workflow tree is a valid single-parent `PlanTree`.** `buildCascadeTree(FOUNDRY_WORKFLOW)`
returns a `PlanTree` that `PlanTreeSchema.parse` accepts (`cascade.ts:53` already runs it — assert no
throw); assert exactly one root (`parentId === null` for exactly one node) and every
other node has a single non-null `parentId` (the stages are SIBLINGS under the root). Assert the action
node's built `PlanNode.metadata.action` survived the build (it round-trips through `metadata`,
`cascade.ts:48`). **MUTATION → RED:** giving a workflow node a second parent (two entries claiming it
as a child) breaks the single-parent assertion; dropping `metadata.action` from the spec surfaces no
`metadata.action` on the built node → the round-trip assertion fails.

**(f) `actuateNode` — the function on the intervention.** `actuateNode(deps, node)` reads
`node.metadata.action` (the kind) and `node.metadata.actionArgs` (its args) off a built workflow node
and fires the real op: the dual node's `reprioritize-product` actuation moves the priority to 500, and
an explicit `args` override is honoured over the node's own `actionArgs`. A node with NO
`metadata.action` THROWS `node <id> carries no action` (fail loud, never a silent no-op) — assert the
`stage-intake` node throws. **MUTATION → RED:** a silent-return mutation on the no-action path lets the
`stage-intake` call pass → the throw assertion fails.

### 5.3 What Slice 1 deliberately does NOT do

- It does NOT wire the conductor to walk the workflow tree (Slice 4) — `actuate` is called directly
  by the acid, proving the mechanism.
- It does NOT spawn a product tree or add a `PlanNodeId` cross-tree reference (Slice 2).
- It does NOT derive workflow advancement / scheduled-wake (Slice 3).
- It does NOT surface workflow actions as dashboard buttons (Slice 5).

Slice 1 proves ONLY the mechanism: a workflow node's `metadata.action` is resolved by the registry and
`actuate` fires the real op, emitting events — with a declared effect riding alongside, untouched.

---

## 6. ADR-176 inclusion test — NOT triggered (pack-level)

Applying the inclusion test
([ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) §2 —
BOTH legs must hold for a thing to be kernel):

- **(a) Is "a workflow plan tree + a kind-keyed action registry + `actuate`" one of the four kernel
  concerns?** Partially-already, partially-no. The plan tree IS a kernel concern (recurse the plan,
  ADR-127 §1.1) — but the workflow tree is the EXISTING plan-tree primitive, adding NO new kernel
  shape; it is just another `CascadeNodeSpec[]`. The action `kind`, the registry, and `actuate` are
  NOT kernel concerns — they are pack-authored actuation. An action `kind` rides the `metadata` JSONB
  extension boundary (ADR-176 §3, the deliberate per-pack space); the registry + `actuate` are pack
  code; `effectDeclarations` are EXISTING (ADR-154/194).
- **(b) Is the registry / `actuate` needed by ≥2 packs as shared infrastructure the kernel must
  validate / query / version?** No. Single consumer (`domains/foundry`), over foundry-specific action
  kinds. No second pack needs a foundry workflow tree or its action handlers; the kernel must not
  validate/version a pack's dispatch table.

**Both legs FAIL → pack territory.** This is the **P7 precedent applied again**: when ADR-259 asked
whether a "button = intervention/trigger" needed an `InterventionDescriptor` kernel contract, the
substrate-architect ruled it PACK-LEVEL (rejected) — the intervention is ALREADY first-class kernel
(`PlanNode.effectDeclarations`), so the button binding is a pack-authored presentation affordance
REFERENCING existing kernel ids. Same here: the plan node + its declared effect are kernel; the action
`kind` (in `metadata`) + the registry + `actuate` are pack-authored actuation referencing the existing
node. **"Store generators, derive graphs" is upheld** (ADR-176 §4): the workflow STRUCTURE lives in the
`CascadeNodeSpec` / log (the generator), the frontier is DERIVED (Slice 3), and the action's effect is
captured as EVENTS (the log) — nothing authoritative is stored outside the log, and no live function
is serialized onto a node. **Zero kernel change.**

---

## 7. The ladder — follow-up slices (NOT this slice)

Slice 1 proves the mechanism; the ladder assembles the cockpit-driven workflow one slice at a time.

| Slice | What | Mechanism |
|---|---|---|
| **1 (this)** | A workflow intervention actuates a real action. | `FOUNDRY_WORKFLOW` tree + `actuate`/`actuateNode` + the `ACTION_REGISTRY` seeded with `reprioritize-product` + `request-gate` (a gate DECISION stays founder-gated, deliberately OUT of the seed); one node carries both an action and a declared effect. |
| **2** | Cross-tree `build-path` action. | A `build-path` handler that GENERATES a product tree (reusing `blueprintToEvents` / `queuePush`, ADR-249) and records a `PlanNodeId` REFERENCE (`metadata.spawnedRoot`) from the workflow node to the product-tree root — a typed edge off the spine, NEVER a second parent (KD-5). |
| **3** | Derived workflow advancement. | The workflow's own frontier (`planFrontier(buildCascadeTree(FOUNDRY_WORKFLOW), state, now)`, reusing `frontier.ts:96`), with stage completion as an EVENT and the next stage's reachability as a derived `dependsOn` — POKED by scheduled-wake (P6, `dueWakes`, `wake.ts:22`), never a callback (KD-4). |
| **4** | The conductor walks the workflow tree. | The conductor pulls the workflow frontier (Slice 3), and for each ready node with a `metadata.action`, calls `actuate` — actuating ready workflow nodes the same way it claims ready product work-items. |
| **5** | T0/T2 variants + the cockpit drives the workflow. | Sibling `FOUNDRY_WORKFLOW` variants (a light T0 game-jam pipeline, a heavy T2 regulated-health pipeline, KD-1); the dashboard (ADR-261/262) surfaces workflow actions as confirm-gated buttons — a click `actuate`s the node, the founder-click-as-authorization model (ADR-262) now driving the WORKFLOW, not just the priority footgun. |

Each rung reuses an existing primitive: Slice 2 the cross-link rule (KD-5 / ADR-127), Slice 3 the
frontier fold + scheduled-wake (ADR-246/256), Slice 4 the conductor (ADR-247), Slice 5 the
founder-click-as-authorization cockpit (ADR-262). The convergence is: the foundry workflow becomes a
first-class, derivable, actuatable, cockpit-driven plan tree — the HOW made as first-class as the WHAT.

---

## 8. What does NOT change

- **No kernel contract.** `@de-braighter/substrate-contracts` is byte-unchanged — the workflow tree is
  the EXISTING plan-tree primitive (`buildCascadeTree` / `PlanTreeSchema`), the action `kind` rides
  the EXISTING `metadata` JSONB boundary, and `effectDeclarations` is the EXISTING ADR-154/194 field
  (§6).
- **No design-system change.** Slice 1 has no UI; the registry + `actuate` are pure pack code. (The
  dashboard buttons arrive in Slice 5, reusing the ADR-261/262 renderer — still no design-system
  import.)
- **No new dependency.** The registry is a `Map`; `actuate` is a function. The foundry `package.json`
  is unchanged.
- **No new write machinery.** The handlers wrap EXISTING store-locked ops (`reprioritizeProduct`,
  `gateRequest`); `actuate` adds only kind-keyed dispatch.
- **The product tree, the conductor, and the dashboard are untouched in Slice 1.** They are extended,
  not modified, by later rungs.

---

## 9. Slice scope

- **foundry:** add `src/instances/foundry-workflow.ts` (the `FOUNDRY_WORKFLOW: CascadeNodeSpec[]`
  pipeline tree — sibling stages under one root; the dual node carrying BOTH `metadata.action` and
  `effects`), `src/workflow/actions.ts`
  (the `ACTION_REGISTRY` `ReadonlyMap` seeded with `reprioritize-product → reprioritizeProduct` +
  `request-gate → gateRequest`, `actuate(deps, kind, args)` + `actuateNode(deps, node)`
  resolve-or-throw, `listActions()`), and the
  acids in `test/workflow-actions.acid.test.ts` (actuation-executes-the-real-op ·
  closed-registry-throws-with-both-seeds · declaration⊥actuation-coexist ·
  replay-is-events-not-handler-rerun · workflow-tree-is-a-valid-single-parent-PlanTree ·
  actuateNode-fires-from-the-node-or-throws). It reuses the EXISTING `buildCascadeTree`
  (`cascade.ts:24`), the EXISTING `CascadeNodeSpec.effects` field (`cascade.ts:21,44`), the EXISTING
  `reprioritizeProduct` op (`ops.ts:79`), the EXISTING `gateRequest` op (`ops.ts:294`), and the
  EXISTING `CompileTarget` registry shape as the template (`registry.ts:8`). **No `@de-braighter/*`
  change.**
- **specs:** ADR-263 (ratified) — codifies the five key decisions: (KD-1) the workflow is a
  first-class plan tree (`FOUNDRY_WORKFLOW`, the existing plan-tree primitive, distinct from product
  trees, reusable); (KD-2) interventions actuate via a kind-keyed action registry (the Command
  pattern, event-sourced — `metadata.action` is the command, the registry is the function,
  `actuate` fires the handler once and the log is the durable memory); (KD-3) declaration ⊥ actuation
  (two independent axes); (KD-4) control flow stays derived (event-sourced), not callbacks; (KD-5)
  cross-tree triggers are a `PlanNodeId` reference, never multi-parent. ADR-176 NOT triggered (the P7
  pack-level precedent), zero kernel change.

This slice depends only on the existing plan-tree builder (`buildCascadeTree`), the existing
store-locked ops, and the existing effect-declaration field. It is the generalization of the ADR-262
reprioritize action (foundry's first actuation) into a registry, and the realization of the ADR-259
"button = intervention" actuation precedent for the WORKFLOW.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
