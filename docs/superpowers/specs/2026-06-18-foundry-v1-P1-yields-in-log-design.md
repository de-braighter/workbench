# Foundry v1 P1 — Yields-in-Log

> Extends the `WorkItemQueued` event payload with an optional `yields` field so that a
> product blueprint can be extracted **from the event log alone** — no authored `CascadeNodeSpec`
> input required. Fixes the empty-substance face on generated products (ADR-249 gap).
> **Zero kernel change; pack-level payload extension + fold update only.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`src/events.ts`, `src/state.ts`, `src/plan/tree-from-queue.ts`,
  `src/ops.ts`, `src/mcp/server.ts`, `src/metamodel/generate.ts`, new `src/metamodel/substance-log.ts`).
  `layers/specs` (ADR-251, status proposed).
- **Predecessors:** ADR-242 (substance = derived ⋃ yields, never stored), ADR-248 (blueprint
  extraction — Stage 3), ADR-249 (blueprint generation — Stage 4), ADR-176 (kernel minimality
  inclusion test).

---

## 1. Problem — generated products have an empty substance face

**Recon (verified against source):**

- `WorkItemMeta.yields: SubstanceRef[]` lives on the authored `CascadeNodeSpec` node metadata
  (`src/metamodel/vocabulary.ts:17`). It is hand-declared on product spec files (e.g.
  `src/instances/whales-product.ts:38,50,70,82,102,114`).
- `WorkItemQueued` Zod schema (`src/events.ts:55-59`) has NO `yields` field. The event log
  carries itemId, title, scope, dependsOn, qualityObligations — nothing else.
- `treeFromQueue` (`src/plan/tree-from-queue.ts:38-48`) builds a `CascadeNodeSpec[]` from
  `state.items`, populating each work-item node's `meta` with only `{ itemId, title, scope,
  dependsOn }`. `yields` is absent.
- `ItemState` (`src/state.ts:39-52`) and the `EVENT.ITEM_QUEUED` fold case
  (`src/state.ts:168-182`) never capture `yields`.
- `blueprintSubstance` (`src/metamodel/blueprint.ts:74-86`) reads `node.metadata['yields']`
  from the `PlanTree` produced by `buildCascadeTree`. When the tree comes from `treeFromQueue`
  (log-derived), those metadata objects have no `yields` key → `blueprintSubstance` returns `[]`.

**Consequence:** `blueprintToEvents` (ADR-249) emits `WorkItemQueued` events from a spec but
silently drops yields. A round-trip through `blueprintToEvents → fold → treeFromQueue →
extractBlueprint` gives a `ProductBlueprint` whose `blueprintSubstance` is always empty —
breaking ADR-242 for generated products. This is the P1 gap flagged by the completeness-critic
after the autonomous ladder completed.

---

## 2. Decision — carry yields on WorkItemQueued; derive substance log-only

### What changes (thinnest falsifiable extension)

**R1 — Event schema:** add `yields?: z.array(SubstanceRefSchema).optional()` to the
`WorkItemQueued` Zod object in `src/events.ts`. The field is optional — existing events without
it parse cleanly (Zod `.optional()` with no `.default()`).

**R2 — ItemState:** add `yields?: SubstanceRef[]` to the `ItemState` interface
(`src/state.ts:39`). Optional; absent when the queued event had no yields.

**R3 — Fold:** in the `EVENT.ITEM_QUEUED` case (`src/state.ts:168`), capture
`yields: (p['yields'] as SubstanceRef[] | undefined)`. Store `undefined` when absent (no
back-fill, no default).

**R4 — treeFromQueue:** extend the `meta` object built per work-item (`src/plan/tree-from-queue.ts:42`)
to include `...(item.yields != null ? { yields: item.yields } : {})`. The field is present in
metadata only when yields were captured in state; absent otherwise. `buildCascadeTree` and
`blueprintSubstance` already handle absent-yields gracefully (they default to `[]`).

**R5 — ops / MCP input:** add `yields?: SubstanceRef[]` to `ItemInput`
(`src/ops.ts:34`) and the `items` array element in `foundry_queue_push`'s `inputSchema`
(`src/mcp/server.ts:71`). Both optional; callers that omit it get today's behavior.

**R6 — blueprintToEvents:** in `src/metamodel/generate.ts:191`, extract
`const yields = m['yields'] as SubstanceRef[] | undefined` from the work-item meta and spread
it into the `itemQueued(...)` call: `...(yields != null ? { yields } : {})`. This closes the
round-trip: spec → `blueprintToEvents` → events WITH yields → fold → `treeFromQueue` WITH
yields → `extractBlueprint` → `blueprintSubstance` non-empty.

**R6b — foundry_generate_from_blueprint MCP tool:** the `foundry_generate_from_blueprint`
tool instantiates a product from a blueprint by constructing an `ItemInput[]` and calling
`queuePush`. It must populate `ItemInput.yields` from each work-item's blueprint meta so
that the generated product's `WorkItemQueued` events carry yields into the log from the
moment of instantiation. Without this, a product generated via this tool would exhibit the
same empty-substance-face bug that P1 closes for `blueprintToEvents`.

**R7 — log-only substance helper:** add `src/metamodel/substance-log.ts` exporting:

```ts
/**
 * Derive substance for a product from log state alone (no authored spec needed).
 * Implements ADR-242: ⋃ yields of DONE items, deduplicated by (kind, id).
 * An item is DONE when state.items has it with a merged timestamp (itemDone()).
 */
export function deriveSubstanceFromLog(
  state: DerivedState,
  productKey: string,
): SubstanceRef[] { ... }
```

This is the log-only face of the substance derivation. It reads `state.items`, filters to
`productKey + itemDone(item)`, unions their `item.yields ?? []`, and deduplicates by
`${kind} ${id}`. Substance remains a DERIVED view (ADR-242) — it is never stored on
`ItemState` or `DerivedState`.

**Key semantic invariant (must not be relaxed):** a yield counts toward substance only when
its work-item is DONE (has a `MergeRecorded` in the log, reflected as `item.merged != null`).
Yields are CAPTURED at queue-time but only LAND in substance at merge-time. Do not count
queued-but-not-done yields.

### What does NOT change

- `blueprintSubstance` in `blueprint.ts` — already correct; it reads `node.metadata['yields']`
  from the `PlanTree`. Once `treeFromQueue` populates that field (R4), it works without modification.
- `extractBlueprint` — signature and body unchanged. The improvement is entirely upstream (the
  tree it receives now carries yields).
- `DerivedState` shape — no new top-level field. Yields live on `ItemState` elements already
  in `state.items`.
- No new event type; no kernel contract change.

---

## 3. Architecture

```
WorkItemQueued event  ──(yields?: SubstanceRef[])──▶  fold ──▶  ItemState.yields?
                                                                       │
treeFromQueue(state, productKey)                                       │
  └─ per work-item node meta: { itemId, title, scope, dependsOn, yields? }
                                                                       │
buildCascadeTree(spec)  ──────────────────────────────────────────────▶
                                                                       ▼
blueprintSubstance(extractBlueprint(treeFromQueueSpec, state, key))
  = ⋃ yields of done items   ← NON-EMPTY for generated products after P1
```

```
blueprintToEvents(authoredSpec, newKey)
  └─ per work-item: itemQueued({ ..., yields: meta['yields'] ?? undefined })
        │
        ▼
  fold → state.items carry yields
        │
        ▼
  treeFromQueue → CascadeNodeSpec nodes carry yields in meta
        │
        ▼
  extractBlueprint (log-only path) → blueprintSubstance NON-EMPTY
```

The authored spec path (`extractBlueprint(authoredSpec, state, key)`) is unchanged — yields
already ride on authored `CascadeNodeSpec` nodes.

---

## 4. Acid test — must BITE

The test lives in a new file (e.g. `src/metamodel/substance-log.spec.ts` or an extension of
the existing blueprint spec). All fixtures are authored INLINE in the test; no production
builder output is used to derive the expected value.

### Round-trip assertion (primary)

Define an **independent fixture spec**:

```ts
const FIXTURE_SPEC: CascadeNodeSpec[] = [
  { key: 'test-product', kind: 'product', parent: null,
    meta: { name: 'Test', repo: 'test/repo', riskTier: 'T0' } },
  { key: 'wi-alpha', kind: 'work-item', parent: 'test-product',
    meta: { itemId: 'wi-alpha', title: 'Alpha', scope: { repo: 'test/repo' },
            dependsOn: [], yields: [{ kind: 'pack', id: 'alpha-pack' }] } },
  { key: 'wi-beta', kind: 'work-item', parent: 'test-product',
    meta: { itemId: 'wi-beta', title: 'Beta', scope: { repo: 'test/repo' },
            dependsOn: [], yields: [{ kind: 'board', id: 'beta-board' }] } },
];

// EXPECTED substance — computed INDEPENDENTLY, by hand:
const EXPECTED_SUBSTANCE: SubstanceRef[] = [
  { kind: 'pack', id: 'alpha-pack' },
  { kind: 'board', id: 'beta-board' },
];
```

Test steps:

1. `blueprintToEvents(FIXTURE_SPEC, 'test-product-gen', TS)` — emits `WorkItemQueued` events
   WITH `yields` on each item.
2. Fold those events to `state`.
3. Drive BOTH items to DONE: emit `ClaimAcquired` + `MergeRecorded` for `wi-alpha` AND
   `wi-beta` and fold them into `state`. (Substance must be EARNED — the merge events are
   required, not simulated.)
4. Call `treeFromQueue(state, 'test-product-gen')` → `logSpec`.
5. `bp = extractBlueprint(logSpec, state, 'test-product-gen')`.
6. Assert `blueprintSubstance(bp)` deep-equals `EXPECTED_SUBSTANCE` (sorted by `kind+id`).

This is the round-trip: authored spec → events → log → log-derived tree → blueprint →
substance equals independently computed expected value.

### Red mutation (must flip RED)

Repeat the round-trip but drop `yields` from the `WorkItemQueued` event for `wi-alpha` before
folding (patch `events[1].payload` to remove the `yields` key). Assert that
`blueprintSubstance(bp)` does NOT contain `{ kind: 'pack', id: 'alpha-pack' }`. The equality
check against `EXPECTED_SUBSTANCE` must FAIL (length mismatch or missing ref).

### Negative control 1 — done-gate

Run the round-trip but drive only `wi-alpha` to DONE; leave `wi-beta` queued (no
`MergeRecorded`). Assert `blueprintSubstance(bp)` equals `[{ kind: 'pack', id: 'alpha-pack' }]`
only — `{ kind: 'board', id: 'beta-board' }` must be ABSENT. Proves the done-gate bites: a
queued yield with no merge does not count.

### Negative control 2 — no yields → empty substance

Emit a product with work-items carrying NO yields (omit the field entirely in
`blueprintToEvents`). Drive all items to DONE. Assert `blueprintSubstance(bp)` is `[]`. Proves
no phantom substance appears.

### Real-product proof (whales)

`WHALES_PRODUCT` spec declares yields on 6 work-items (verified: `scaffold`, `contracts`,
`engine`, `ai-opponent`, `api`, `game-ui`). After P1, calling:

```ts
const events = blueprintToEvents(WHALES_PRODUCT, 'whales-gen', TS);
// fold + drive all items to DONE
const bp = extractBlueprint(treeFromQueue(state, 'whales-gen'), state, 'whales-gen');
blueprintSubstance(bp); // must be non-empty, ≥6 refs
```

Assert length ≥ 6 and that `{ kind: 'pack', id: 'engine' }` is present. Before P1, this
returns `[]`. This proves the gap is closed for a real shipped product.

---

## 5. ADR-176 analysis — NOT triggered

P1 is a pack-level change on all three counts of the inclusion test (ADR-176):

- (a) `WorkItemQueued` is a foundry pack event, not a kernel contract (`@de-braighter/substrate-contracts`
  carries no foundry events). Adding `yields?` to it is a pack-internal payload extension.
- (b) `ItemState.yields` is a pack-local struct — it lives in `domains/foundry/src/state.ts`,
  not in the kernel contracts or runtime.
- (c) `deriveSubstanceFromLog` is a pack-local pure function over pack-local state. It is not
  shared infrastructure needed by ≥2 packs.
- `SubstanceRef` is already a foundry/studio-metamodel type in `src/metamodel/vocabulary.ts`,
  not a kernel primitive.

ZERO changes to `@de-braighter/substrate-contracts` or `@de-braighter/substrate-runtime`.
Charter-checker must confirm COHERENT.

---

## 6. Reversibility

`yields` is optional everywhere:

- Old `WorkItemQueued` events without the field parse fine (Zod `.optional()`).
- `ItemState.yields` absent → `treeFromQueue` omits the key from node meta → `blueprintSubstance`
  returns `[]` — exactly today's behavior.
- Reverting P1 means generated products return to empty substance. No log migration is required.
  Historical events simply have no yields; the fold produces the same state as before.

---

## 7. Deferred

- **Historical log backfill** — real-product logs (agri, whales, oncology) contain existing
  `WorkItemQueued` events without yields. Backfilling those is out of scope; only NEW queued
  events (post-P1 deploy) carry yields. Old events continue to fold to `yields: undefined`.
- **P5 hierarchical ↔ flat tree reconciliation** — `treeFromQueue` produces a flat tree
  (product → work-items, no capability/feature levels). `blueprintToEvents` does the same
  (work-items only, skips intermediate nodes). Reconciling this with the 4-level authored
  tree is a separate concern that depends on yields being in the log (this slice) but is
  not part of P1.
- **`deriveSubstanceFromLog` as a public MCP tool** — the log-only substance derivation could
  be exposed as a `foundry_substance_query` MCP tool. Deferred; the helper is useful
  internally first.
