# Foundry v1 P5 — Hierarchical ↔ Flat Tree Reconciliation

> Carries the authored product hierarchy (Capability → Feature) through the event log so
> `extract → generate → treeFromQueue` of a real product reconstructs its 4-level tree
> instead of collapsing to a depth-2 flat tree. Adds an OPTIONAL `ancestry?: AncestorRef[]`
> to the `WorkItemQueued` payload — additive, backward-compatible, and `planFrontierAll`-
> invariant-preserving. **Zero kernel change; pack-level payload extension + fold + tree
> derivation only.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`src/events.ts`, `src/metamodel/generate.ts`, `src/state.ts`,
  `src/plan/tree-from-queue.ts`, `src/plan/frontier.ts`).
  `layers/specs` (ADR-255, status proposed).
- **Predecessors:** ADR-241 (foundry as sanctioned meta-product), ADR-242 (substance =
  derived ⋃ yields, never stored), ADR-244 (conductor drives plan-tree frontier),
  ADR-246 (`treeFromQueue` makes `planFrontier` universal), ADR-248 (blueprint extraction —
  Stage 3), ADR-249 (blueprint generation — Stage 4), ADR-251 (yields-in-log — P1; P5
  depends on it), ADR-176 (kernel minimality inclusion test).

---

## 1. Problem — the authored hierarchy is lost in the log round-trip

**Recon (verified against source):**

- Authored product specs are genuinely 4-level (`product → capability → feature → work-item`).
  `FOUNDRY_PRODUCT` (`src/instances/foundry-product.ts`) has 5 capabilities / 8 features /
  17 work-items; `WHALES_PRODUCT` (`src/instances/whales-product.ts`) has 1 capability /
  3 features / 6 work-items. These intermediate nodes carry `kind` + `meta.title` and are the
  human-meaningful decomposition of the product.
- `blueprintToEvents` (`src/metamodel/generate.ts:178`) filters
  `const workItems = spec.filter((n) => n.kind === 'work-item')` and emits a `WorkItemQueued`
  event ONLY for each work-item leaf (`generate.ts:180-205`). The intermediate `capability`
  and `feature` nodes emit NO events. They never reach the log.
- `specFromQueue` (`src/plan/tree-from-queue.ts:18-52`) rebuilds a hard-coded depth-2 FLAT
  tree from `state.items`: one `product` root (`tree-from-queue.ts:21-33`) plus one
  `work-item` leaf per item, each leaf's `parent` hard-wired to `productKey`
  (`tree-from-queue.ts:37-48`). There is no machinery to reconstruct intermediate levels.
- `ItemState` (`src/state.ts:40-54`) and the `EVENT.ITEM_QUEUED` fold case
  (`src/state.ts:170-186`) capture `itemId / productKey / epic / title / scope / lane /
  dependsOn / qualityObligations / yields` — nothing about a work-item's capability or
  feature ancestor.

**Consequence:** `blueprintToEvents → fold → treeFromQueue` of a 4-level authored product
produces a depth-2 tree. The capability and feature levels are silently dropped. A round-trip
through the log can never reconstruct the authored hierarchy — `extractBlueprint(treeFromQueue(...))`
of `FOUNDRY_PRODUCT` returns a flat blueprint, not the 4-level one that was authored. This is
the P5 gap flagged by the completeness-critic after the autonomous ladder completed: P1
(ADR-251) closed the substance face, but the structural face is still lossy.

---

## 2. Decision — carry the authored ancestry through the log

### What changes (thinnest falsifiable extension)

The mechanism is the same additive shape P1 used for `yields`: an OPTIONAL field on the
`WorkItemQueued` payload, normalized on fold, threaded through the tree derivation. Five
numbered touch-points:

**R1 — Event schema (`src/events.ts`):** add an OPTIONAL `ancestry?: AncestorRef[]` to the
`WorkItemQueued` Zod object (`events.ts:60-65`). Define and export a new `AncestorRefSchema`
mirroring the `SubstanceRefSchema` pattern (`events.ts:56-59`):

```ts
export const AncestorRefSchema = z.object({
  key: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().optional(),
});
export type AncestorRef = z.infer<typeof AncestorRefSchema>;
```

`AncestorRef` is an ordered list from the product-root's child (the capability) down to the
work-item's IMMEDIATE parent (the feature) — it EXCLUDES the product root (which is always the
tree root, reconstructed independently) and EXCLUDES the work-item itself. The field is added
to `WorkItemQueued` as `ancestry: z.array(AncestorRefSchema).optional()`. Optional → existing
events without it parse cleanly (Zod `.optional()` with no `.default()`); absent ancestry
reproduces today's flat behavior exactly.

**R2 — `blueprintToEvents` (`src/metamodel/generate.ts`):** when emitting `itemQueued(...)`
for a work-item leaf (`generate.ts:180-205`), walk that leaf's `parent` chain UP the spec —
EXCLUDING the product root — and emit the ordered chain (root-child-first) as `ancestry`. The
spec is already in scope; build a `key → CascadeNodeSpec` map once, then for each work-item
walk `parent` pointers, collecting `{ key, kind, title }` for every non-root ancestor, and
reverse into root-first order. Spread it into the `itemQueued` call exactly as P1 spread
`yields` (`generate.ts:202`):

```ts
const ancestry = ancestryOf(wi, byKey); // ordered capability..feature, root excluded
events.push(itemQueued({
  itemId, productKey: newKey, title, scope, dependsOn, qualityObligations,
  ...(epic != null ? { epic } : {}),
  ...(lane != null ? { lane } : {}),
  ...(yields != null ? { yields } : {}),
  ...(ancestry.length > 0 ? { ancestry } : {}),
  ts: now,
}));
```

A work-item directly under the product root (no intermediate levels) yields an empty
`ancestry` → the field is omitted → flat behavior, no phantom intermediates.

**R3 — Fold (`src/state.ts`):** carry `ancestry` into `ItemState.ancestry`, normalized
NON-OPTIONAL with a default `[]` — exactly mirroring how `yields` is normalized in the
`EVENT.ITEM_QUEUED` case (`state.ts:183`, the P1 / ADR-251 D2 pattern):

```ts
// ItemState (state.ts:40-54): add
ancestry: AncestorRef[];

// EVENT.ITEM_QUEUED fold case (state.ts:170-186): add
ancestry: (p['ancestry'] as AncestorRef[] | undefined) ?? [],
```

Default `[]` means existing folded items and ancestry-less events both produce
`ancestry: []`, which the tree derivation treats as flat.

**R4 — `specFromQueue` (`src/plan/tree-from-queue.ts`):** reconstruct the intermediate
`CascadeNodeSpec` nodes from the union of all work-items' ancestries, and rewire each leaf's
`parent`. The algorithm:

- Union every product work-item's `item.ancestry` and DEDUP by `key` (siblings repeat their
  shared capability/feature; dedup collapses them to one reconstructed node).
- For each deduped `AncestorRef` (in ancestry order), push a `CascadeNodeSpec` whose
  `parent` is the PREVIOUS ancestor's `key`, or `productKey` for the FIRST ancestor in the
  chain; `kind` is the ref's `kind`; `meta.title` is the ref's `title`.
- Rewire each work-item leaf's `parent` to its LAST ancestor's `key` (the feature), or
  `productKey` when `ancestry` is empty (today's flat path, unchanged).

`CascadeNodeSpec` (`src/plan/cascade.ts:21`) already supports arbitrary depth via its `parent`
field, and `buildCascadeTree` (`cascade.ts:24`) maps each `key → uuidv5('cascade:' + key)`
(`cascade.ts:25`). Therefore reconstructing nodes with the SAME keys the authored spec used
produces IDENTICAL node ids → structural equality with `buildCascadeTree(authoredSpec)`. The
keys are carried verbatim through `AncestorRef.key`, so the round-trip is exact.

**R5 — `projectTreeState` (`src/plan/frontier.ts`):** pass `ancestry` through the leaf
projection like `epic` is passed (`frontier.ts:52-63`), PRESERVING the
`planFrontierAll ≡ claimableItems` invariant. `LeafMeta` (`frontier.ts:12-18`) gains an
optional `ancestry?: AncestorRef[]`; `projectTreeState` (`frontier.ts:43-64`) copies
`ancestry: m.ancestry ?? prior?.ancestry ?? []` onto the rebuilt `ItemState`, exactly as it
copies `yields` (`frontier.ts:62`). Claimability reads ONLY leaf work-items + scope +
`dependsOn` (`claimableItems`), NEVER tree depth — so adding intermediate nodes to the
projected tree must not, and does not, change which items are claimable (see §6).

### What does NOT change

- `epic` (`events.ts:61`) — currently cosmetic, never used for topology. Left untouched; see
  the alternatives in §3. A single string cannot encode two ordered intermediate levels with
  their kinds, so it is not the vehicle for hierarchy.
- `buildCascadeTree` and `cascade.ts` — already support arbitrary depth via `parent`. No
  change; the reconstruction in R4 produces a deeper but well-formed `CascadeNodeSpec[]`.
- `extractBlueprint` / `blueprintToSpec` — signatures and bodies unchanged. The improvement is
  upstream: the tree `specFromQueue` produces now carries the intermediate nodes, and
  `extractBlueprint` reads them faithfully (it already round-trips arbitrary depth via
  `_cascadeKey`, `generate.ts:5-12`).
- `DerivedState` shape — no new top-level field. Ancestry lives on `ItemState` elements
  already in `state.items`.
- No new event TYPE; no kernel contract change. `WorkItemQueued` gains one optional field.

---

## 3. Architecture

```text
authored 4-level spec (product → capability → feature → work-item)
  │  blueprintToEvents (generate.ts:178 filters work-item leaves)
  ▼
WorkItemQueued event  ──(ancestry?: AncestorRef[] = [capability, feature])──▶ fold
                                                                                │
                                                       ItemState.ancestry (default [])
                                                                                │
specFromQueue(productKey, state)  ─ union+dedup ancestries by key ──────────────┤
  ├─ product root (unchanged)                                                    │
  ├─ reconstruct intermediate nodes: parent = prev ancestor key | productKey     │
  └─ rewire work-item leaf: parent = last ancestor key | productKey              │
                                                                                 ▼
buildCascadeTree(spec)   key → uuidv5('cascade:'+key)   ──▶  IDENTICAL node ids
                                                                                 │
                                                                                 ▼
  structural equality vs buildCascadeTree(authoredSpec)   (parent edges + depth + kinds)
```

The product root is always reconstructed independently (it is the tree root). Ancestry encodes
only the levels BETWEEN the root and the leaf, so the union-dedup-reconstruct step is the
inverse of the work-item-leaves-only filter in `blueprintToEvents`.

---

## 4. Alternatives considered

### A. Reuse the `epic` field as the grouping level

`epic` (`events.ts:61`) already exists on `WorkItemQueued` and is currently cosmetic / unused
for topology.

- **Pro:** no new field; reuses an existing payload slot.
- **Con:** a single string encodes exactly ONE grouping level. The authored products are
  genuinely two-level intermediate (capability AND feature), each with its own `kind`. `epic`
  cannot encode two ordered levels, nor their kinds, nor reconstruct distinct `CascadeNodeSpec`
  nodes for each. **Insufficient.** Left untouched.

### B. Emit each intermediate node as its own new event type

Introduce a `PlanNodeQueued` (or similar) event that registers each capability / feature node,
folded into a separate `state.planNodes` map and joined into the tree at derivation time.

- **Pro:** intermediate nodes get a first-class log presence, symmetric with work-items.
- **Con:** heavier on every axis — a new event vocabulary, a new fold case, a new
  `aggregateType`, a new projector map. More kernel-shape-adjacent surface for a structural
  concern that is fully derivable from data already attached to the work-item leaves.
  **Rejected as not-thinnest.**

### C. Carry ancestry as a denormalized field on the work-item event (CHOSEN)

Attach the ordered ancestor chain to each `WorkItemQueued` event; dedup on fold/derivation.

- **Pro:** one optional field; no new event type; no new fold case beyond a normalized field;
  reconstruction is a pure derivation in `specFromQueue`. Backward-compatible (absent = flat).
- **Con:** the ancestry is denormalized — sibling work-items repeat their shared capability /
  feature refs. This is a SMALL, DEPTH-BOUNDED denormalization (ancestor depth is the product's
  fixed level count, ≤ 2 intermediate levels in practice), deduped on derivation. It is
  idiomatic for this append-only log, which already denormalizes `productKey` and `title` onto
  every work-item event. **Chosen.**

---

## 5. ADR-176 analysis — NOT triggered

P5 is a pack-level change on every leg of the inclusion test (ADR-176 §2):

- **(a) Is this one of the four kernel concerns?** No. `WorkItemQueued` is a foundry pack
  event, not a kernel contract (`@de-braighter/substrate-contracts` carries no foundry
  events). Adding an optional `ancestry?` is a pack-internal payload extension. `AncestorRef`
  is a foundry pack type, OPAQUE to the kernel (the kernel never inspects pack payloads,
  ADR-027/030).
- **(b) Is it needed by ≥2 packs as shared infrastructure the kernel must validate / query /
  version?** No. `AncestorRef`, `ItemState.ancestry`, and the `specFromQueue` reconstruction
  are pack-local. One pack (`domains/foundry`) consumes them. The kernel does not validate,
  query, or version any of these shapes.

Both legs fail → pack territory.

**"Store generators, derive graphs" is UPHELD.** The hierarchy is DERIVED by `specFromQueue`
from the ancestry data carried on work-item leaves — it is never stored as a separate graph
or as standalone intermediate-node records. The `CascadeNodeSpec` already supports arbitrary
depth via its single-parent `parent` field; no new structural primitive is introduced. The
`metadata` JSONB boundary is respected: `meta.title` on a reconstructed node rides the per-node
metadata slot, the deliberate per-pack extension space (ADR-176 §3).

ZERO changes to `@de-braighter/substrate-contracts` or `@de-braighter/substrate-runtime`.
Charter-checker must confirm COHERENT.

---

## 6. Acid test — must BITE

The test authors all fixtures INLINE; no production builder output is used to derive the
expected value. The expected tree comes from `buildCascadeTree` applied to the SAME authored
fixture, so the assertion is a genuine round-trip.

### Primary round-trip — structural equality (must BITE)

Author an INDEPENDENT 4-level hierarchical fixture: `product → 2 capabilities → features →
work-items`, with `yields` on some work-items (to confirm P1 is preserved). Then:

```text
FIXTURE_SPEC (product → cap-a, cap-b → feat-* → wi-*, yields on some wi-*)
  1. events = blueprintToEvents(FIXTURE_SPEC, 'fixture-gen', TS)
       → WorkItemQueued events carrying `ancestry` = [capability, feature] per leaf
  2. state = fold(events)                       → ItemState.ancestry populated
  3. logSpec = specFromQueue('fixture-gen', state)
       → reconstructs intermediate capability/feature nodes + rewires leaf parents
  4. logTree = buildCascadeTree(logSpec)
  5. assert structural equality (logTree vs buildCascadeTree(FIXTURE_SPEC re-keyed)):
       - parent edges identical
       - depth identical (4 levels, not 2)
       - node kinds identical (product/capability/feature/work-item)
```

Structural equality is asserted on `{ id, parentId, kind, childrenIds }` per node. Because keys
are carried verbatim through `AncestorRef.key` and `buildCascadeTree` maps `key →
uuidv5('cascade:'+key)`, the reconstructed node ids equal the authored ones — the equality is
exact, not approximate.

### Red mutation (must flip RED)

Force `specFromQueue` to ignore `ancestry` (e.g. patch it to always wire each leaf's `parent`
to `productKey` and skip intermediate-node reconstruction — the pre-P5 flat behavior). Re-run
the round-trip:

- depth collapses to 2 (product → work-items),
- the structural-equality assertion FAILS (missing capability/feature nodes; wrong parent
  edges).

This proves the test bites: if the ancestry threading regresses, the assertion goes RED.

### Negative control — genuinely flat fixture (no phantom intermediates)

Author a FLAT fixture: `product → work-items` directly, no capability/feature nodes (so
`blueprintToEvents` emits empty `ancestry` and the field is omitted). Run the round-trip and
assert the reconstructed tree EQUALS the flat source: depth 2, NO phantom intermediate nodes
injected. Proves the reconstruction does not hallucinate hierarchy where none was authored.

### P1 intact — substance still derives

Within the primary round-trip (whose work-items carry `yields`), drive items to DONE and assert
`deriveSubstanceFromLog(state, 'fixture-gen')` (ADR-251 / P1) still yields the union of the
work-items' substance. P5 must not regress P1: ancestry and yields are independent optional
fields on the same event.

### Frontier invariant — claimability unchanged by depth

Author an active-items fixture (queued items with deps + a scope conflict + a TTL-expired
claim) BOTH as a flat tree AND as the same items under reconstructed intermediate nodes.
Assert `planFrontierAll(state, now)` (equivalently `claimableItems` filtered to the product)
returns the IDENTICAL frontier with vs without intermediate nodes. This pins the
`planFrontierAll ≡ claimableItems` invariant: claimability reads only leaf work-items + scope
+ `dependsOn`, never tree depth, so intermediate nodes are inert to the frontier.

### Real-product proof (foundry / whales)

Run the round-trip on `FOUNDRY_PRODUCT` (5 cap / 8 feat / 17 wi) and `WHALES_PRODUCT`
(1 cap / 3 feat / 6 wi). Assert the reconstructed tree's depth and node-kind multiset match
the authored fixture. Before P5, both reconstruct to depth 2; after P5, they reconstruct the
full 4-level tree. Proves the gap is closed for the two real shipped product fixtures.

---

## 7. Round-trip contract

The contract P5 establishes, stated precisely:

```text
For any authored CascadeNodeSpec[] `spec` with productKey-aligned keys:
  buildCascadeTree(specFromQueue(k, fold(blueprintToEvents(spec, k, TS))))
    ≡structural≡  buildCascadeTree(spec)
```

where `≡structural≡` is equality on `{ id, parentId, kind, childrenIds }` per node (ordinal /
metadata payload aside). The equality holds because:

- `blueprintToEvents` emits the full ancestor chain (capability + feature) as `ancestry` on
  each work-item leaf,
- the fold normalizes it onto `ItemState.ancestry`,
- `specFromQueue` reconstructs the intermediate nodes with the SAME keys and rewires leaf
  parents,
- `buildCascadeTree`'s `key → uuidv5('cascade:'+key)` mapping makes identical keys produce
  identical node ids.

This is the structural sibling of P1's substance round-trip contract (ADR-251 §2): P1 made the
SUBSTANCE face round-trip through the log; P5 makes the STRUCTURE face round-trip through the
log.

---

## 8. Backward-compatibility

`ancestry` is optional everywhere:

- Old `WorkItemQueued` events without the field parse fine (Zod `.optional()`).
- `ItemState.ancestry` defaults to `[]` on fold (R3) — `specFromQueue` then treats the item as
  flat (leaf parent = `productKey`), exactly today's behavior. No phantom intermediate nodes.
- Reverting P5 means generated products return to flat reconstruction. No log migration is
  required. Historical events simply have no ancestry; the fold produces `ancestry: []` and the
  same flat tree as before.

Real-product logs (agri, whales, oncology) contain existing `WorkItemQueued` events without
`ancestry`. Backfilling those is out of scope; only NEW queued events (post-P5 deploy via
`blueprintToEvents`) carry ancestry. Old events continue to reconstruct flat. The historical
foundry items registered by the P3 bootstrap (ADR-254) likewise have no ancestry until
re-queued.

---

## 9. Frontier invariant — claimability is depth-blind

The `planFrontierAll ≡ claimableItems` invariant (ADR-246/247) MUST survive P5. It does,
structurally:

- `claimableItems` reads only leaf `work-item` items + their `scope` + `dependsOn`. It never
  reads tree depth or intermediate nodes.
- `projectTreeState` (`frontier.ts:43-64`) rebuilds `ItemState` ONLY for `n.kind ===
  'work-item'` nodes (`frontier.ts:44`). The reconstructed `capability` / `feature` nodes are
  NOT work-items, so they contribute zero items to the projection — they are inert to
  claimability.
- Adding intermediate nodes deepens the tree but changes neither the leaf set nor any leaf's
  `scope` / `dependsOn`. Therefore `planFrontier(treeFromQueue(...))` returns the identical
  frontier with or without the intermediate nodes.

The acid-test "frontier invariant" case (§6) is the empirical proof: identical frontier with
vs without intermediate nodes.

---

## 10. Boundary note — ancestry rides only on work-item leaf events

`blueprintToEvents` emits `ancestry` ONLY on the `WorkItemQueued` events (the work-item leaves
it already filters for at `generate.ts:178`). Intermediate `capability` / `feature` nodes do
NOT get their own events — they are reconstructed purely from the ancestry carried on the
leaves. This is the same leaf-only boundary P1 (ADR-251) established for `yields`: the event log
records leaf facts, and intermediate structure is DERIVED from those leaf facts at tree-build
time, never separately stored. The boundary keeps the event vocabulary unchanged (no new event
type) and upholds "store generators, derive graphs" (ADR-176).

---

## 11. Slice scope

- **foundry:** add `AncestorRefSchema` + `ancestry?` to `WorkItemQueued` (`src/events.ts`);
  emit the ancestor chain in `blueprintToEvents` (`src/metamodel/generate.ts`); normalize
  `ancestry` onto `ItemState` in the fold (`src/state.ts`); reconstruct intermediate nodes +
  rewire leaf parents in `specFromQueue` (`src/plan/tree-from-queue.ts`); thread `ancestry`
  through `projectTreeState` + `LeafMeta` (`src/plan/frontier.ts`). Add the acid-test battery
  (primary round-trip + red mutation + flat negative control + P1-intact + frontier-invariant
  + real-product proof).
- **specs:** ADR-255 (proposed) — codifies the ancestry-in-log mechanism as the structural
  round-trip contract.

P5 depends on P1 (ADR-251) being landed: the acid test asserts P1's substance derivation is
preserved, and the two optional fields (`yields`, `ancestry`) share the same additive,
fold-normalized pattern.

---

## 12. Deferred

- **Historical log backfill** — real-product logs contain `WorkItemQueued` events without
  `ancestry`. Backfilling them to recover their authored hierarchy is out of scope; only new
  queued events carry ancestry. Old events reconstruct flat.
- **Ancestry on `foundry_queue_push` / MCP input** — the manual queue-push path (`ItemInput`,
  `foundry_queue_push`) does not yet accept `ancestry`. Adding it would let a conductor queue a
  hierarchically-placed item directly. Deferred; `blueprintToEvents` is the first and primary
  producer (the generate path), and closing the round-trip there is the P5 objective.
- **Intermediate-node metadata richness** — reconstructed capability / feature nodes carry only
  `kind` + `meta.title` from the `AncestorRef`. Richer intermediate metadata (descriptions,
  effect declarations on intermediate levels) is not carried. Deferred; demand-driven per
  ADR-176 — promote only when a consumer needs it.
