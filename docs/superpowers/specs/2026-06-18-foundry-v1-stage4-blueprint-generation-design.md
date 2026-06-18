# Foundry v1 Stage 4 — Blueprint GENERATION (Slice 4A)

> Scaffolds a new product **from** a blueprint — the inverse of Stage 3's `extractBlueprint`. Proves
> `generate ∘ extract == identity` (a generated product re-expresses an existing one). The other half
> of the extract↔generate pivot. **Zero new kernel shapes; reuses CascadeNodeSpec + the two events.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`blueprintToSpec` + `blueprintToEvents` + a thin `foundry_generate_from_blueprint` MCP tool + the round-trip acid test); `layers/specs` (ADR-249).
- **Predecessor:** ADR-248 (Stage 3 — `extractBlueprint`, `ProductBlueprint = { process: PlanTree, done }`).

## 1. Problem — a blueprint can be extracted but not instantiated

Stage 3 made a product's blueprint **extractable** (`extractBlueprint(spec, state, key)`). The product
compiler vision needs the **inverse**: given a blueprint, **generate a new live product** — register it
and queue its work-items (the "epic ladder"). Today nothing turns a `ProductBlueprint` back into a live
product; the only tree→spec conversion is `treeFromQueue` (queue-specialised + flat). Generation is the
missing half of the extract↔generate pivot (Stage 5 then compiles the blueprint to targets).

**Recon facts that shape the design:**
- `buildCascadeTree(spec: CascadeNodeSpec[]): PlanTree` exists; the `PlanTree` carries ALL metadata
  `buildCascadeTree` consumes, so a `PlanTree → CascadeNodeSpec[]` inverse is faithful — but **no
  inverse exists** (net-new).
- A product goes LIVE via `ProductRegistered` + `WorkItemQueued` events (`queuePush`/`foundry_queue_push`).
- Node ids are `uuidv5('cascade:'+key)`; itemIds are `<productKey>/<suffix>`. **Re-keying is mechanical**
  — rewrite the product prefix and all ids re-derive distinctly.
- `/new-domain` (code scaffold) is **orthogonal** — generation here produces the foundry queue events
  (the epic ladder), not the repo files.

## 2. Decision — invert the blueprint into a spec + events

### Known data-shape requirement — productKey-aligned specs

For a clean **one-round** round-trip (`generate ∘ extract == identity, exact`), a product's spec
keys MUST be **productKey-aligned**: every item key takes the form `<productKey>/<suffix>` and the
root key equals `productKey`. When that holds, all uuidv5 ids re-derive identically after the key
rewrite and the round-trip is exact in one pass.

WHALES_PRODUCT's internal key scheme (`whales/*`) differs from its productKey
(`whales-and-bubbles`). This is a latent authoring inconsistency: the keys were authored before the
productKey was settled. Generation gracefully **normalizes** such specs to the new key on the first
round and is **idempotent** thereafter (re-running generation on the already-normalized product
produces an identical result). Normalization is not a defect — it is the correct behavior for
misaligned input — but it means the strong one-round identity does NOT hold for WHALES against its
original keys (it holds against the normalized form).

### Slice 4A (build now)

Three net-new functions (no new shapes — they consume/produce existing types):
- **`blueprintToSpec(bp: ProductBlueprint, newKey: string): CascadeNodeSpec[]`** — walk `bp.process`
  (the `PlanTree`), reconstruct the `CascadeNodeSpec[]` (one per node: `{ key, kind, parent, meta, effects }`),
  re-keying every node key + work-item `itemId` from the original productKey prefix to `newKey`. The
  faithful inverse of `buildCascadeTree` (modulo the key rewrite). Preserves hierarchy, yields, scope,
  dependsOn, resource, effects.
- **`blueprintToEvents(spec: CascadeNodeSpec[], newKey: string): (ProductRegistered | WorkItemQueued)[]`**
  — the **pure event-projection** counterpart: given a spec it returns the minimal event set to instantiate
  the spec as a LIVE product (one `ProductRegistered` from the product root + scope; one `WorkItemQueued`
  per work-item node carrying itemId/scope/dependsOn/title/qualityObligations from node metadata). A
  freshly-generated product has nothing done. **Used directly by the round-trip acid test** — `fold(blueprintToEvents(spec))` instantiates the product in-memory to prove the generated events are correct.
  It is NOT called by the MCP tool at runtime; the MCP tool writes via `queuePush` directly (see below).
- **`foundry_generate_from_blueprint(blueprint, newKey)` MCP tool** — a thin wrapper: `blueprintToSpec`
  derives the re-keyed spec, then writes the product live via the **existing `queuePush`** (idempotent
  product registration + dup-item rejection) directly — it does NOT call `blueprintToEvents` at runtime.
  Both paths (`queuePush` and `blueprintToEvents`) emit the same `ProductRegistered` + `WorkItemQueued`
  events; `blueprintToEvents` is the pure projection the acid test uses to verify that the event-set
  is correct before any I/O occurs.

### Deferred (recorded)

- **`/new-domain` code scaffold** — bringing the target repo into existence is orthogonal; the
  orchestrator sequences `/new-domain` then generation. Not in this slice.
- **yields-in-log** (from Stage 3) — generation re-emits yields via the spec; the queue events stay
  yield-free (the blueprint's substance is carried by the spec, re-derivable). Full log-only generation
  is deferred with the Stage-3B yields-in-log work.

## 3. Architecture & mechanism — the round-trip

```text
ProductBlueprint bp { productKey, process: PlanTree, done }
        │  blueprintToSpec(bp, newKey)
        ▼
CascadeNodeSpec[] spec'  (re-keyed; one node per PlanTree node)
        │                                              │  buildCascadeTree(spec')
        │  [MCP tool / live path]  queuePush           ▼
        │──────────────────────────────────▶  PlanTree'  ( ≡ bp.process, modulo key )
        │
        │  [acid test / pure projection]  blueprintToEvents(spec', newKey)
        ▼
(ProductRegistered + WorkItemQueued[])   ← same events queuePush emits; used by fold in the test
        │  fold
        ▼
state'  ──extractBlueprint(spec', state', newKey)──▶  bp'  ( generate∘extract identity )
```

> **Two paths, same events:** the MCP tool writes live via `queuePush` (idempotent, I/O); the acid
> test projects the same event set in-memory via `blueprintToEvents` and verifies correctness via
> `fold`. They are functionally equivalent — both emit `ProductRegistered` + `WorkItemQueued`.

The keystone identity: **`buildCascadeTree(blueprintToSpec(bp, k)) ≡ bp.process` (modulo the key
rewrite)** — `blueprintToSpec` faithfully inverts `buildCascadeTree`. Composed with `blueprintToEvents`
+ `extractBlueprint`, a generated product re-expresses the source blueprint.

**Precision on round-trip strength:**
- For **productKey-aligned specs** (item keys `<productKey>/<suffix>`, root key == productKey):
  `generate ∘ extract == identity` holds **exactly in one round** (proven on the key-aligned fixture).
  This is the strong claim.
- For specs whose internal key scheme differs from the productKey (e.g. WHALES's `whales/*` keys vs
  productKey `whales-and-bubbles`): generation **normalizes** the key scheme on the first round and
  is **idempotent** thereafter. The strong one-round identity holds against the *normalized* form, not
  the original authoring. WHALES is the real-data normalization case.

## 4. Acid test — must BITE (two proofs)

The acid test proves **both** claims: strong one-round identity on a productKey-aligned fixture, and
normalize-then-idempotent on WHALES (the real-data case).

**Proof A — strong identity (key-aligned fixture):**

1. **Same-key round-trip (exact bite):** use an independently-authored fixture whose keys are
   productKey-aligned. `bp = extractBlueprint(SPEC, stateWithDone, key)`;
   `spec' = blueprintToSpec(bp, key)`; `events = blueprintToEvents(spec', key)`;
   `state' = fold(events)`; `bp' = extractBlueprint(spec', state', key)`. Assert `bp'.process`
   **deep-equals** `bp.process` (SAME key → SAME uuidv5 node ids → exact equality) and `bp'.done`
   equals `[]` (a freshly generated product has nothing merged). This is the **strong claim**:
   `generate ∘ extract == identity` exactly in one round.
2. **Mutation → RED:** corrupt `blueprintToSpec` (drop a node / mangle the re-key); the re-extracted
   process diverges from `bp.process` → the round-trip assertion goes RED.

**Proof B — idempotent normalization (WHALES real-data case):**

3. **Round-1 normalization:** `bp = extractBlueprint(WHALES_SPEC, state, 'whales-and-bubbles')`;
   `spec' = blueprintToSpec(bp, 'whales-and-bubbles')`; `events = blueprintToEvents(spec', 'whales-and-bubbles')`;
   `state' = fold(events)`; `bp' = extractBlueprint(spec', state', 'whales-and-bubbles')`. The
   original WHALES keys (`whales/*`) are normalized to `whales-and-bubbles/*` on this first pass.
   Assert `bp'.process` is structurally complete (same node count, kind/parent-structure, metadata,
   yields) and `bp'.done == []`.
4. **Idempotent (round-2):** run the same round-trip on `spec'` (the already-normalized spec). Assert
   `bp''process` **deep-equals** `bp'.process` — no further change. This proves normalization
   converges in one round and holds stable thereafter.

**Shared assertions:**

5. **New-key generation (re-express a distinct product):** `generate(bp, '<newKey>')` for both the
   aligned fixture and WHALES; the clone's re-extracted process is **structurally isomorphic** to
   `bp.process` with all ids re-derived from the new key (same node count, same kind/parent-structure,
   same metadata-minus-key-derived-fields, same yields).
6. **Genericity:** the SAME generic `blueprintToSpec`/`blueprintToEvents` handle WHALES + the fixture
   with no product-specific branch (assert by cross-product divergence + each matching its own source).
7. **Builds green + valid:** `blueprintToEvents` output passes the event schemas (fold without throw);
   the full foundry suite stays green.

## 5. Reversibility

Purely additive: three new functions + an MCP tool + a test. Nothing existing changes (`extractBlueprint`,
`buildCascadeTree`, `queuePush` are reused as-is). Reverting = delete the new file + the tool registration.
The MCP tool only emits the same events `foundry_queue_push` already emits — no new live-path behavior
beyond "queue from a blueprint instead of a hand-listed item array".

## 6. Governance — ADR-249, zero kernel change

- **ADR-249** records: blueprint GENERATION is the inverse of extraction — `blueprintToSpec` faithfully
  inverts `buildCascadeTree`, `blueprintToEvents` instantiates the product via the existing
  `ProductRegistered`/`WorkItemQueued` events; `generate ∘ extract == identity` (exact, one round) for
  productKey-aligned specs; for misaligned specs (e.g. WHALES), generation normalizes the key scheme on
  the first round and is idempotent thereafter. Completes the extract↔generate pivot (Stage 5 compiles).
  Status `proposed` until charter-checker COHERENT.
- **ADR-176 inclusion test — NOT triggered.** All three functions are pack-level; they consume/produce
  the ratified `PlanTree` + existing pack events + the `CascadeNodeSpec`/`ProductBlueprint` pack types.
  No new shape (explicitly NO `GenerationRequest`/`GenerationResult` wrapper — return `spec[]` + `events[]`
  directly). Single consumer (foundry). charter-checker runs regardless.

## 7. Scope boundaries (YAGNI)

- NO `/new-domain` code scaffold (orthogonal; deferred).
- NO new wrapper shapes (`GenerationRequest`/`GenerationResult`/`ReKeyingRule`) — reuse existing types.
- NO yields-in-log / log-only generation (deferred with Stage 3B).
- NO Stage 5 compilation.
- NO new kernel shapes.
