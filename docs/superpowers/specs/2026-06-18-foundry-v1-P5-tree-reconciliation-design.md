# Foundry v1 P5 — Hierarchical ↔ Flat Tree Reconciliation

> Carries the authored product hierarchy (Capability → Feature) through the event log so
> `extract → generate → treeFromQueue` of a real product reconstructs its 4-level tree
> instead of collapsing to a depth-2 flat tree. Adds an OPTIONAL `ancestry?: AncestorRef[]`
> to the `WorkItemQueued` payload — additive, backward-compatible, and `planFrontierAll`-
> invariant-preserving. **Zero kernel change; pack-level payload extension + fold + tree
> derivation only.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`src/events.ts`, `src/metamodel/generate.ts`, `src/state.ts`,
  `src/plan/tree-from-queue.ts`, `src/plan/frontier.ts`, `src/ops.ts`,
  `src/mcp/server.ts`, `src/mcp/tools.ts`, `src/instances/foundry-bootstrap.ts`).
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
numbered touch-points (R1–R5), plus a shared `ancestryOf` emit helper that closes the
producer side on ALL FOUR `WorkItemQueued` emit sites (R2b — the un-deferred §12 work, this
mirrors P1/ADR-251's "four yields emit sites" pattern; see §12).

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

**R2 — shared `ancestryOf` helper (`src/metamodel/generate.ts:59-80`):** the emit-time walk is
factored into ONE exported helper, `ancestryOf(wi, byKey)`, so every producer threads ancestry
identically. Given a work-item `CascadeNodeSpec` and a `key → CascadeNodeSpec` map, it walks the
`parent` chain UP the spec — EXCLUDING the product root (`node.parent === null` stops the walk) —
collecting `{ key, kind, title }` for every non-root ancestor, then reverses into root-child-first
order. A work-item directly under the product root yields an empty `ancestry` → the field is
omitted at every call site → flat behavior, no phantom intermediates.

```ts
export function ancestryOf(wi: CascadeNodeSpec, byKey: Map<string, CascadeNodeSpec>): AncestorRef[] {
  const chain: AncestorRef[] = [];
  let fromKey = wi.key;
  let parentKey = wi.parent;
  const visited = new Set<string>();
  while (parentKey != null) {
    if (visited.has(parentKey)) throw new Error(`ancestry walk: cycle detected at ${parentKey} for node ${fromKey}`);
    visited.add(parentKey);
    const node = byKey.get(parentKey);
    if (node == null) throw new Error(`ancestry walk: dangling parent ${parentKey} for node ${fromKey}`);
    if (node.parent === null) break; // product root — excluded
    const title = (node.meta as Record<string, unknown> | undefined)?.['title'] as string | undefined;
    chain.push({ key: node.key, kind: node.kind, ...(title != null ? { title } : {}) });
    fromKey = node.key;
    parentKey = node.parent;
  }
  return chain.reverse(); // leaf-parent-first → root-child-first
}
```

`ancestryOf` is the EMIT-TIME strict path: it throws loudly on a malformed authored spec — both a
dangling mid-chain `parent` (a key absent from `byKey`) AND a `parent` cycle (a chain that never
reaches `parent === null`, caught by the visited-set guard). Well-formed authored specs never hit
either; the throw is the loud-failure contract for bad authored input (§9b). This is intentionally
the OPPOSITE posture from the reconstruct-time graceful degrade in R4 / §9a — see §9 for the
emit-strict vs read-total split.

**R2b — thread `ancestryOf` through ALL FOUR `WorkItemQueued` emit sites.** `blueprintToEvents` is
the first and primary producer, but it is NOT the only write path to a `WorkItemQueued` event.
P5 closes the producer side on every one — exactly as P1/ADR-251 had to thread `yields` through
its four yields emit sites (the symmetric "all-emit-sites" lesson: greening on one producer while
the live path uses another is a methodological mismatch the review caught for yields). The four:

| # | Emit site | Source | Notes |
|---|-----------|--------|-------|
| 1 | `blueprintToEvents` | `src/metamodel/generate.ts:236` | the generate / extract→generate path; spreads `...(ancestry.length > 0 ? { ancestry } : {})` into `itemQueued` exactly as it spreads `yields` |
| 2 | `queuePush` / `ItemInput.ancestry` | `src/ops.ts:39, 62` | the manual queue-push path; `ItemInput` gains optional `ancestry?: AncestorRef[]`, threaded onto the appended `itemQueued`. EXPOSED on the `foundry_queue_push` MCP tool schema (`src/mcp/server.ts:86`, `ancestry: z.array(AncestorRefSchema).optional()`) so a conductor can queue a hierarchically-placed item directly |
| 3 | `foundry_generate_from_blueprint` | `src/mcp/tools.ts:97` | the MCP generate handler; computes `ancestryOf(n, byKey)` per work-item and passes it through to `queuePush` |
| 4 | `foundryBootstrapEvents` | `src/instances/foundry-bootstrap.ts:65` | **THE KEY one** — the ONLY write path for the live `FOUNDRY_PRODUCT`. `planFrontierAll` drives foundry's OWN frontier off the bootstrap-written items (P3/ADR-254), so without ancestry HERE the self-application honesty is false: `treeFromQueue('foundry')` would reconstruct flat even though the authored product is 4-level. ACID 7 is the bootstrap-path proof (`foundryBootstrapEvents → fold → treeFromQueue ≡structural≡ buildCascadeTree(FOUNDRY_PRODUCT)`: FOUNDRY = 1 product / 5 capabilities / 8 features / 17 work-items, depth 4) |

Each call site builds its own `byKey = new Map(spec.map((n) => [n.key, n]))` over the spec in
scope and spreads `...(ancestry.length > 0 ? { ancestry } : {})` into the `itemQueued` it emits.
A work-item directly under the product root yields an empty `ancestry` → the field is omitted →
flat behavior, no phantom intermediates.

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

**`specFromQueue` is a TOTAL function — graceful degrade, never throw (`tree-from-queue.ts:30-106`).**
A well-formed `CascadeNodeSpec[]` has globally-unique keys, so a given ancestor key occupies one
fixed depth → one fixed parent. The union-dedup step tracks `seen: Map<key, parentKey>`. If a
LATER occurrence of an already-seen key reconstructs to a DIFFERENT parent (the same key at two
chain depths), the source ancestry is malformed. On that collision `specFromQueue` does NOT throw:
it emits a `console.warn` (`[foundry] specFromQueue: ancestry collision for product <k> (key <a>
under parents <p1>/<p2>); falling back to flat reconstruction`), sets a `collided` flag, and
RETURNS a deterministic FLAT reconstruction for THAT product only (every work-item directly under
the product root — the pre-P5 behavior, no phantom intermediates).

The rationale is the frontier invariant, stated as a non-negotiable: `specFromQueue` (via
`treeFromQueue`) feeds `planFrontierAll`, the SOLE conductor driver, which iterates ALL products.
The `planFrontierAll ≡ claimableItems` invariant must hold over every log. A throw inside the
per-product projection would brick the frontier for ALL products — one malformed product would
take down the healthy ones, vanishing the entire conductor frontier. So the projection MUST be
total; malformation is surfaced as a warning (not silently swallowed, not fatal). ACID 9 is the
explicit frontier-resilience proof: one malformed product present alongside a healthy one →
`planFrontierAll` does not throw, the healthy product's claimable items stay present + unchanged,
and the malformed product's items still appear (flat, via the fallback). This is the
reconstruct-time GRACEFUL-DEGRADE path, intentionally the OPPOSITE posture from the emit-time
strict throw in R2 / §9b.

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

### Real-product proof (foundry / whales) — ACID 6

Run the round-trip on `FOUNDRY_PRODUCT` (5 cap / 8 feat / 17 wi) and `WHALES_PRODUCT`
(1 cap / 3 feat / 6 wi). Assert the reconstructed tree's depth and node-kind multiset match
the authored fixture. Before P5, both reconstruct to depth 2; after P5, they reconstruct the
full 4-level tree. Proves the gap is closed for the two real shipped product fixtures. ACID 6
runs the round-trip via `blueprintToEvents` (the generate path).

### Bootstrap / live-log path — ACID 7 (the KEY self-application proof)

ACID 6 greens via `blueprintToEvents`, but the LIVE foundry product is written ONLY by
`foundryBootstrapEvents` (`planFrontierAll` drives foundry's own frontier off the bootstrap-written
items per P3/ADR-254). Before this fix, bootstrap was ancestry-blind → the live product
reconstructed FLAT, and ACID 6 greened on a path the live log never uses (a methodological
mismatch — the same failure P1's review caught for yields). ACID 7 exercises the path the live log
ACTUALLY uses: `foundryBootstrapEvents(emptyState) → fold → treeFromQueue('foundry') ≡structural≡
buildCascadeTree(FOUNDRY_PRODUCT)`, asserting kind-multiset `{ product: 1, capability: 5,
feature: 8, work-item: 17 }`, max depth 4, and the exact parent-edge set.

### Queue-push / MCP path — ACID 8

`queuePush(ItemInput with ancestry) → fold → treeFromQueue` reconstructs the intermediates,
proving `ItemInput.ancestry` (the `foundry_queue_push` MCP path) carries hierarchy onto the log;
a leaf with NO ancestry stays flat under the product root (no phantom intermediates).

### Frontier resilience — ACID 9 (one malformed product must not brick healthy ones)

A HEALTHY 4-level product present alongside a MALFORMED product (the same ancestor key under two
different parents). Assert `planFrontierAll` does NOT throw, the healthy product's claimable items
stay present + unchanged, and the malformed product's items still appear (flat, via the
`specFromQueue` fallback), with the malformation surfaced via `console.warn`. This is the explicit
proof of the total-projection rationale (§9a / R4).

### Collision-guard + cycle-guard unit tests

The collision guard (same key at two parents → flat fallback + warn, total over any log; vs the
redundant-sibling case which dedups cleanly) and the cycle guard (`ancestryOf` throws
synchronously, does not hang, on a parent cycle) are pinned as standalone tests — the empirical
proofs of the emit-strict (§9b) vs read-total (§9a) split.

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
`ancestry`. Backfilling those is out of scope; only NEW queued events (post-P5 deploy via the
four emit sites in R2b) carry ancestry. Old events continue to reconstruct flat. The historical
foundry items registered by the P3 bootstrap (ADR-254) likewise have no ancestry until
re-registered.

**Live-log re-cutover is a SEPARATE, founder-gated step — NOT done in this slice.** The existing
live foundry items were registered by the P3 bootstrap (ADR-254) BEFORE P5, so they carry no
ancestry and `treeFromQueue('foundry')` over the live `data/events.jsonl` still reconstructs flat.
The CODE now emits ancestry for FUTURE bootstrap runs (and for the test fixtures that prove ACID 7
on an empty state), but re-cutting-over the REAL live log — re-registering the live foundry items
so their ancestry lands — is a live-shared-log mutation and therefore a founder decision (the same
class of gated cutover P3/ADR-254 itself required). It is explicitly out of scope here. Until the
founder runs that re-cutover, the live foundry product's log-derived tree stays flat; the
self-application honesty (ACID 7) is proven on the bootstrap code path against a fresh state, not
asserted over the already-cutover live log.

---

## 9. Failure-mode discipline + the frontier invariant

P5 has two structurally different failure-handling postures, applied at two different times. They
are intentionally OPPOSITE, and the split is the load-bearing design choice this section records.

### 9a. Reconstruct-time (read) — TOTAL, graceful degrade

`specFromQueue` / `treeFromQueue` feeds `planFrontierAll`, the SOLE conductor driver, which
iterates ALL products. A hypothetically-malformed log (an ancestor key reconstructing under two
different parents — see R4) must NOT take down the frontier. So at READ time the projection is
TOTAL: on collision it falls back to a flat reconstruction for THAT product and emits a
`console.warn`; it never throws. A throw here would brick `planFrontierAll` for every healthy
product — one malformed product would vanish the whole conductor frontier. ACID 9 (frontier
resilience) is the explicit proof: one malformed product must not brick the healthy ones.

### 9b. Emit-time (write) — STRICT, loud throw

`ancestryOf` (R2), the emit-time walk shared by all four producers, throws loudly on a malformed
AUTHORED spec — both a dangling mid-chain parent (key absent from the spec map) AND a parent cycle
(visited-set guard; without it the `while` would never terminate). Well-formed authored specs
never hit either; the throw is the loud-failure contract for bad authored input. This is the
OPPOSITE of 9a on purpose: bad authored input fails loudly at the producer, where the author can
fix it; a hypothetically-malformed log degrades gracefully at the reader, so the always-on
conductor stays up. The two are not in tension — they guard different inputs at different times.

### 9c. Frontier invariant — claimability is depth-blind

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
vs without intermediate nodes. ACID 9 extends it to the resilience guarantee in 9a.

---

## 10. Boundary note — ancestry rides only on work-item leaf events

All four producers (R2b) emit `ancestry` ONLY on the `WorkItemQueued` events (the work-item
leaves — `blueprintToEvents` and `foundry_generate_from_blueprint` filter for them; `queuePush`
and `foundryBootstrapEvents` only ever queue work-items). Intermediate `capability` / `feature`
nodes do NOT get their own events — they are reconstructed purely from the ancestry carried on
the leaves. This is the same leaf-only boundary P1 (ADR-251) established for `yields`: the event
log records leaf facts, and intermediate structure is DERIVED from those leaf facts at tree-build
time, never separately stored. The boundary keeps the event vocabulary unchanged (no new event
type) and upholds "store generators, derive graphs" (ADR-176).

---

## 11. Slice scope

- **foundry:** add `AncestorRefSchema` + `ancestry?` to `WorkItemQueued` (`src/events.ts`);
  add the shared `ancestryOf` emit helper (`src/metamodel/generate.ts`); thread it through ALL
  FOUR `WorkItemQueued` emit sites — `blueprintToEvents` (`src/metamodel/generate.ts`),
  `queuePush` / `ItemInput.ancestry` (`src/ops.ts`) exposed on the `foundry_queue_push` MCP tool
  (`src/mcp/server.ts`), `foundry_generate_from_blueprint` (`src/mcp/tools.ts`), and
  `foundryBootstrapEvents` (`src/instances/foundry-bootstrap.ts`); normalize `ancestry` onto
  `ItemState` in the fold (`src/state.ts`); reconstruct intermediate nodes + rewire leaf parents
  in `specFromQueue` as a TOTAL function with collision graceful-degrade
  (`src/plan/tree-from-queue.ts`); thread `ancestry` through `projectTreeState` + `LeafMeta`
  (`src/plan/frontier.ts`). Add the acid-test battery (ACID 1 primary round-trip + ACID 2 red
  mutation + ACID 3 flat negative control + ACID 4 P1-intact + ACID 5 frontier-invariant + ACID 6
  real-product proof + ACID 7 bootstrap/live-log path + ACID 8 queue-push path + ACID 9 frontier
  resilience + the collision-guard and cycle-guard tests).
- **specs:** ADR-255 (proposed) — codifies the ancestry-in-log mechanism as the structural
  round-trip contract.

P5 depends on P1 (ADR-251) being landed: the acid test asserts P1's substance derivation is
preserved, and the two optional fields (`yields`, `ancestry`) share the same additive,
fold-normalized pattern.

---

## 12. Shipped beyond the original cut + what remains deferred

This slice shipped MORE than the original cut described. Two items the first draft listed as
deferred were instead BUILT, and one new founder-gated step was named. Recorded here so the
durable spec matches the shipped code (the ledger's recurring ADR-vs-code drift; reconcile before
ratify).

### Un-deferred — SHIPPED in this slice

- **Ancestry on ALL FOUR `WorkItemQueued` emit sites (was: "Ancestry on `foundry_queue_push` /
  MCP input — deferred").** The original cut closed the round-trip only on `blueprintToEvents` and
  left the manual queue-push / MCP path for later. The shipped code threads ancestry through the
  shared `ancestryOf` helper on EVERY producer (R2b): `blueprintToEvents`, `queuePush` /
  `ItemInput.ancestry` (exposed on the `foundry_queue_push` MCP tool schema),
  `foundry_generate_from_blueprint`, AND `foundryBootstrapEvents`. The bootstrap site is the
  KEY one: it is the only write path for the live `FOUNDRY_PRODUCT`, so without it the
  self-application honesty (`treeFromQueue('foundry')` reconstructing the 4-level hierarchy) would
  be false. ACID 7 / ACID 8 prove the bootstrap and queue-push paths. This mirrors P1/ADR-251's
  "four yields emit sites" fix — the same all-producers lesson, applied to ancestry.

### Remains deferred

- **Live-log re-cutover (founder-gated; NOT in this slice).** The existing live foundry items
  registered by the P3 bootstrap (ADR-254) before P5 carry no ancestry; the code now emits
  ancestry for future/test bootstrap runs, but re-registering the REAL live `data/events.jsonl`
  items is a live-shared-log mutation and a founder decision. Out of scope here; see §8.
- **Historical log backfill** — real-product logs (agri, whales, oncology) contain
  `WorkItemQueued` events without `ancestry`. Backfilling them to recover their authored hierarchy
  is out of scope; only new queued events carry ancestry. Old events reconstruct flat.
- **Intermediate-node metadata richness** — reconstructed capability / feature nodes carry only
  `kind` + `meta.title` from the `AncestorRef`. Richer intermediate metadata (descriptions,
  effect declarations on intermediate levels) is not carried. Deferred; demand-driven per
  ADR-176 — promote only when a consumer needs it.
