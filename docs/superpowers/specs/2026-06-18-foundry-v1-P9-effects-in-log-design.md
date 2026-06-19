# Foundry v1 P9 — Effects-in-Log

> Carries the authored `effectDeclarations` (interventions) through the event log so a blueprint
> EXTRACTED from the log alone carries effect-bearing `PlanNode`s — and `compile('browser-runtime')`
> (ADR-259, the crown) produces REAL interaction-buttons on the extract→compile pivot, not just on the
> direct `buildCascadeTree(SPEC)` path. Adds an OPTIONAL `effects?: EffectDeclaration[]` to the
> `WorkItemQueued` payload — additive, backward-compatible, and `planFrontierAll`-invariant-preserving.
> The THIRD authored-metadata face after yields (P1 / ADR-251) and ancestry (P5 / ADR-255). **Zero
> kernel change; pack-level payload extension carrying an EXISTING kernel type + fold + tree
> derivation only.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`src/events.ts`, `src/state.ts`, `src/plan/tree-from-queue.ts`,
  `src/plan/frontier.ts`, `src/ops.ts`, `src/mcp/server.ts`, `src/mcp/tools.ts`,
  `src/metamodel/generate.ts`, `src/instances/foundry-bootstrap.ts`).
  `layers/specs` (ADR-260, status proposed). **No `@de-braighter/substrate-*` change.**
- **Predecessors:** ADR-251 (yields-in-log — P1; the first authored-metadata face, the additive
  optional-field pattern this slice reuses verbatim), ADR-255 (ancestry-in-log — P5; the second
  face, the same all-four-emit-sites lesson), ADR-259 (browser-runtime compile target — P7, the
  crown whose extract-path claim this slice reconciles), ADR-154 (the `EffectDeclaration` algebra —
  an intervention = a plan-node + a declared effect), ADR-242 (substance = derived, never stored —
  the derive-don't-store discipline this slice keeps), ADR-176 (kernel minimality inclusion test),
  ADR-127 (the four kernel concerns).

---

## 1. Problem — extracted blueprints have effect-free PlanNodes, so the crown's extract→compile pivot produces ZERO interactions

**Recon (verified against source):**

- The P7 browser-runtime target binds a button to `{ nodeId, effectDeclarationId }` for EACH
  `PlanNode` carrying `effectDeclarations` (ADR-259 D2; `interactions = bp.process.nodes.flatMap(node
  => node.effectDeclarations?.map(eff => ({ nodeId: node.id, effectDeclarationId: eff.declarationId,
  … })) ?? [])`). A node WITHOUT `effectDeclarations` contributes ZERO bindings (the negative
  control). So `interactions` is a pure function of `bp.process.nodes[].effectDeclarations`.
- `effectDeclarations` reach a `PlanNode` via exactly ONE path: `CascadeNodeSpec.effects`
  (`src/plan/cascade.ts:21`) → `buildCascadeTree` spreads `...(s.effects ? { effectDeclarations:
  s.effects } : {})` onto the node (`src/plan/cascade.ts:44`). `effects` is a TOP-LEVEL
  `CascadeNodeSpec` field of type `EffectDeclaration[]` (the EXISTING kernel type, imported from
  `@de-braighter/substrate-contracts/plan-tree`, `cascade.ts:18`) — it is NOT in `meta`.
- `WorkItemQueued`'s Zod schema (`src/events.ts:72-78`) carries `itemId / productKey / epic / title /
  scope / lane / dependsOn / qualityObligations / yields? / ancestry?` — but NO `effects` field. The
  event log is effect-free.
- The fold's `EVENT.ITEM_QUEUED` case (`src/state.ts:182-198`) captures `yields` (`state.ts:195`) and
  `ancestry` (`state.ts:196`) onto `ItemState` but NOT `effects`; `ItemState` (`src/state.ts:41-56`)
  has no `effects` field.
- `specFromQueue` (`src/plan/tree-from-queue.ts:48-63`) builds each work-item leaf's `CascadeNodeSpec`
  with `meta: { itemId, title, scope, dependsOn, yields }` and NO top-level `effects`
  (`tree-from-queue.ts:51-62`). So the leaf the log reconstructs has no `effects` → `buildCascadeTree`
  maps it to a `PlanNode` with NO `effectDeclarations`.
- `blueprintToEvents` (`src/metamodel/generate.ts:198-249`) reads `m['yields']`, `epic`, `lane`,
  `dependsOn`, `qualityObligations` off `wi.meta` and threads them onto the `itemQueued` it emits
  (`generate.ts:235, 245-248`) — but it NEVER reads `wi.effects` and never threads it. The
  generated/re-emitted product's queue events are effect-free.

**Consequence (the broken pivot):** `extractBlueprint(specFromQueue('foundry', state))` (the
log-derived path used by `foundry_extract_blueprint`, `src/mcp/tools.ts:70-77`) produces a
`ProductBlueprint` whose `process.nodes` carry NO `effectDeclarations`. `compile(bp,
'browser-runtime')` over that blueprint therefore yields `interactions: []` — the materialized app has
ZERO buttons. The crown's "button = intervention" works ONLY on the DIRECT `buildCascadeTree(SPEC)`
path (where `SPEC.effects` is hand-authored, e.g. `ARC_CASCADE`'s `pr:devloop-scaffold` node,
`cascade.ts:87-98`). The extract→compile pivot — the self-application flagship — is broken. This is
the P9 gap the completeness-critic flagged after the P7 crown shipped.

**The reconciliation note (ADR-259 overclaims).** ADR-259's Consequences/Positive says "The extract →
generate → compile vision is COMPLETE — to a running app … A blueprint can be extracted (Stage 3),
re-generated (Stage 4), cast to … a RUNNING browser app where … a button-click IS an intervention"
(adr-259:320-324). That is TRUE for a blueprint built directly from a hand-authored `SPEC` (the P7
acids use `FIXTURE_A`/`FIXTURE_B`/`ARC_CASCADE` directly, NEVER through `extract`), but FALSE for a
blueprint EXTRACTED from the log — because effects never reach the log. P9 closes exactly that gap,
the SAME pattern P1 fixed for the substance face and P5 fixed for the structure face. After P9, the
ADR-259 claim holds end-to-end for the extracted-blueprint path too.

---

## 2. Decision — carry the authored effectDeclarations through the log

### What changes (thinnest falsifiable extension)

The mechanism is the SAME additive shape P1 used for `yields` and P5 used for `ancestry`: an OPTIONAL
field on the `WorkItemQueued` payload, normalized on fold, threaded through the tree derivation, and
emitted by ALL FOUR `WorkItemQueued` producers. Five numbered touch-points (R1–R5), plus the
four-emit-sites obligation (R2b — the same all-producers lesson P1/P5 learned).

The single load-bearing difference from P1/P5: `EffectDeclaration` is an EXISTING kernel type
(`@de-braighter/substrate-contracts/plan-tree`), already imported and used by `cascade.ts:18`. P9
REUSES its published `EffectDeclarationSchema` for payload validation — it does NOT define a new
foundry schema (P1 defined `SubstanceRefSchema`, P5 defined `AncestorRefSchema`; P9 imports the
kernel's). This is still a pack-level change (the kernel type is carried OPAQUELY on a pack event
payload; the kernel never inspects it — ADR-027/030), and the ADR-176 verdict is identical (§5).

**R1 — Event schema (`src/events.ts`):** add an OPTIONAL `effects?: EffectDeclaration[]` to the
`WorkItemQueued` Zod object (`events.ts:72-78`), validated by the PUBLISHED kernel schema:

```ts
// src/events.ts — import the EXISTING kernel schema (do NOT redefine):
import { EffectDeclarationSchema } from '@de-braighter/substrate-contracts/plan-tree';

// in the WorkItemQueued object (events.ts:72-78), alongside yields + ancestry:
const WorkItemQueued = z.object({
  // … itemId / productKey / epic / title / scope / lane / dependsOn / qualityObligations …
  yields: z.array(SubstanceRefSchema).optional(),
  ancestry: z.array(AncestorRefSchema).optional(),
  effects: z.array(EffectDeclarationSchema).optional(),   // NEW — the kernel type, opaque on the payload
});
```

`EffectDeclaration` is already type-imported into the foundry pack via `cascade.ts:18`; the WorkItemQueued
field reuses the same published type. The field is OPTIONAL with no `.default()`: existing events
without it parse cleanly (Zod `.optional()`), and absent effects reproduce today's effect-free
behavior exactly — no interventions, no buttons (the backward-compat + negative-control boundary).

**R2 — ItemState (`src/state.ts`):** add `effects: EffectDeclaration[]` (NON-OPTIONAL, default `[]`)
to the `ItemState` interface (`src/state.ts:41-56`), exactly alongside `yields` (`state.ts:52`) and
`ancestry` (`state.ts:53`). Capture it normalized in the `EVENT.ITEM_QUEUED` fold case
(`src/state.ts:182-198`), mirroring `yields` (`state.ts:195`) / `ancestry` (`state.ts:196`):

```ts
// ItemState (state.ts:41-56): add
effects: EffectDeclaration[];

// EVENT.ITEM_QUEUED fold case (state.ts:182-198): add
effects: (p['effects'] as EffectDeclaration[] | undefined) ?? [],
```

Default `[]` means existing folded items and effect-less events both produce `effects: []`, which the
tree derivation treats as a node with no `effectDeclarations` (no intervention).

**R3 — `specFromQueue` (`src/plan/tree-from-queue.ts`):** set the reconstructed work-item leaf's
TOP-LEVEL `effects` from `item.effects` so `buildCascadeTree` maps it to `PlanNode.effectDeclarations`
(`cascade.ts:44`). The leaf builder (`tree-from-queue.ts:48-63`) currently returns
`{ key, kind: 'work-item', parent, meta: { itemId, title, scope, dependsOn, yields } }`; add the
top-level `effects` field (NOT in `meta` — `cascade.ts:44` reads `s.effects`, not `s.meta.effects`):

```ts
// src/plan/tree-from-queue.ts leaf builder (48-63): add the top-level effects field
return {
  key: item.itemId,
  kind: 'work-item',
  parent,
  meta: { itemId: item.itemId, title: item.title, scope: item.scope,
          dependsOn: item.dependsOn, yields: item.yields },
  ...(item.effects.length > 0 ? { effects: item.effects } : {}),   // NEW → PlanNode.effectDeclarations
};
```

This is the load-bearing line: with it, the LOG-DERIVED spec's work-item node carries `effects` →
`buildCascadeTree` (`cascade.ts:44`) produces `effectDeclarations` on the `PlanNode` →
`extractBlueprint`'s `process` (it is just `buildCascadeTree(spec)`, `blueprint.ts:59`) carries them →
`compile('browser-runtime')` reads `node.effectDeclarations` and emits a binding (ADR-259 D2). The
single source of truth for the leaf shape, exactly as the spec comment (`tree-from-queue.ts:18-21`)
notes for `yields`: removing `effects: item.effects` here re-breaks the pivot.

**R4 — `ops.ts` + `foundry_queue_push` MCP schema:** add `effects?: EffectDeclaration[]` to
`ItemInput` (`src/ops.ts:37-41`, alongside `yields?` / `ancestry?` at `ops.ts:40`) and thread it onto
the appended `itemQueued` in `queuePush` (`src/ops.ts:59-66`):

```ts
// ItemInput (ops.ts:37-41): add
effects?: EffectDeclaration[];

// queuePush emit (ops.ts:59-66): add
append(ev.itemQueued({
  ...it,
  productKey: input.product.productKey,
  ...(it.ancestry != null ? { ancestry: it.ancestry } : {}),
  ...(it.effects != null ? { effects: it.effects } : {}),    // NEW
  ts,
}), deps.logPath);
```

EXPOSE it on the `foundry_queue_push` MCP tool schema (`src/mcp/server.ts:80-87`, the `items` array
element, alongside `yields` at `server.ts:85` and `ancestry` at `server.ts:86`):

```ts
// src/mcp/server.ts items element (80-87): add
effects: z.array(EffectDeclarationSchema).optional(),
```

so a conductor can queue an intervention-bearing item directly. (`yields` is already threaded
implicitly via the `...it` spread in `queuePush`, `ops.ts:61`; `ancestry` is spread explicitly at
`ops.ts:63` because of its conditional. `effects` follows the explicit-conditional form for symmetry
and to keep the absent-field-omitted invariant.)

**R5 — `projectTreeState` (`src/plan/frontier.ts`):** carry `effects` through the leaf projection,
PRESERVING the `planFrontierAll ≡ claimableItems` invariant. The single load-bearing difference from
`yields`/`ancestry` (which live on `n.metadata` and are read off `LeafMeta`): `effects` live on the
PlanNode's TYPED `effectDeclarations` field, NOT on `n.metadata`. So `projectTreeState` reads them
DIRECTLY off the node — `const effects = n.effectDeclarations as EffectDeclaration[] | undefined` —
and copies `effects: effects ?? prior?.effects ?? []` onto the rebuilt `ItemState`. `LeafMeta`
(`frontier.ts:12-19`) is NOT extended with an `effects?` field, because effects are never in
metadata.

```ts
// projectTreeState (frontier.ts), inside the per-leaf rebuild: read off the typed PlanNode field
// (NOT metadata, where yields/ancestry sit), then carry with the same prior-fallback shape:
const effects = n.effectDeclarations as EffectDeclaration[] | undefined;
// … on the rebuilt ItemState:
effects: effects ?? prior?.effects ?? [],
```

> **Frontier-path nuance (read carefully).** `projectTreeState` reads the leaf's metadata via
> `n.metadata as LeafMeta` (`frontier.ts:46`) for `itemId` / `scope` / `dependsOn` / `title` /
> `yields` / `ancestry`, but `effects` lives on `PlanNode.effectDeclarations`, NOT on `n.metadata`.
> So `effects` is read straight off the node (`n.effectDeclarations`) — on a tree built by
> `buildCascadeTree` (`cascade.ts:44`) that is exactly where effects land — with `prior?.effects` as
> the fallback for any leaf whose node carries none (e.g. a log-derived `prior` ItemState that R2
> populated). This is the one read that does NOT go through `LeafMeta`: `yields`/`ancestry` round-trip
> into the BLUEPRINT through `specFromQueue` (R3) off metadata, whereas effects round-trip through the
> typed `effectDeclarations` field. `projectTreeState`'s job is the FRONTIER, for which effects are
> inert (see §6); the `effects` carried here keeps the projected `ItemState` complete but does NOT
> change claimability.

### What does NOT change

- `cascade.ts` / `buildCascadeTree` — already maps `CascadeNodeSpec.effects → PlanNode.effectDeclarations`
  (`cascade.ts:44`). No change; R3 simply feeds it the field from the log.
- `blueprint.ts` / `extractBlueprint` — signature and body unchanged. `extractBlueprint` is just
  `buildCascadeTree(spec)` for `process` (`blueprint.ts:59`); once R3 makes the log-derived spec
  effect-bearing, the extracted blueprint's `process.nodes` carry `effectDeclarations` with NO change
  to `extractBlueprint`.
- `target-browser-runtime.ts` / `materialize-html.ts` (ADR-259) — UNCHANGED. The crown already reads
  `node.effectDeclarations` and emits a button per declared effect; P9 supplies it the data on the
  extract path it was missing. The fix is entirely UPSTREAM of the compiler.
- `EffectDeclarationSchema` — the published kernel schema, imported and reused; NOT redefined in
  foundry (the one difference from P1's `SubstanceRefSchema` / P5's `AncestorRefSchema`, which were
  foundry-local).
- `DerivedState` shape — no new top-level field. Effects live on `ItemState` elements already in
  `state.items`.
- No new event TYPE; no kernel contract change. `WorkItemQueued` gains one optional field.

---

## 3. Architecture

```text
authored spec node with CascadeNodeSpec.effects (EffectDeclaration[])    [the DIRECT path today]
  │  blueprintToEvents (generate.ts:198 — filters work-item leaves)
  ▼
WorkItemQueued event  ──(effects?: EffectDeclaration[])──▶ fold
                                                            │
                                          ItemState.effects (default [])      ← R2
                                                            │
specFromQueue(productKey, state)                            │                 ← R3
  └─ work-item leaf gains TOP-LEVEL effects = item.effects ─┤
                                                            ▼
buildCascadeTree(spec)   s.effects → PlanNode.effectDeclarations  (cascade.ts:44)
                                                            │
                                                            ▼
extractBlueprint(specFromQueue(...))  →  bp.process.nodes carry effectDeclarations   ← THE FIX
                                                            │
                                                            ▼
compile(bp, 'browser-runtime')  →  interactions = button per declared effect   (ADR-259 D2)
                                                            │
                                   materializeHtml(descriptor) → REAL buttons on the extracted app
```

The chain from `item.effects` (R2) to a materialized button is now closed for the EXTRACTED
blueprint, not just the direct `buildCascadeTree(SPEC)` blueprint.

---

## 4. The four emit sites — effects rides ALL FOUR WorkItemQueued producers

`blueprintToEvents` is the primary producer, but it is NOT the only write path to a `WorkItemQueued`
event. P9 closes the producer side on EVERY one — the same all-emit-sites lesson P1 (ADR-251) and P5
(ADR-255) applied to their four `yields`/`ancestry` emit sites (greening on one producer while the
live path uses another is the methodological mismatch both prior reviews caught). The four:

| # | Emit site | Source | What it threads |
|---|-----------|--------|-----------------|
| 1 | `blueprintToEvents` | `src/metamodel/generate.ts:198-249` | the generate / extract→generate path. Read `const effects = wi.effects` off the spec node (TOP-LEVEL, since `blueprintToSpec` already recovers `node.effectDeclarations → spec.effects` at `generate.ts:172-173`) and spread `...(effects != null && effects.length > 0 ? { effects } : {})` into the `itemQueued` (`generate.ts:238-249`), exactly as it spreads `yields` (`generate.ts:247`) and `ancestry` (`generate.ts:248`). |
| 2 | `queuePush` / `ItemInput.effects` | `src/ops.ts:37-41, 59-66` | the manual queue-push path (R4); `ItemInput` gains optional `effects?: EffectDeclaration[]`, threaded onto the appended `itemQueued`, EXPOSED on the `foundry_queue_push` MCP schema (`src/mcp/server.ts:80-87`). |
| 3 | `foundry_generate_from_blueprint` | `src/mcp/tools.ts:82-114` | the MCP generate handler; reads `n.effects` per work-item (the spec from `blueprintToSpec`, which carries `effects`) and passes it through to `queuePush` in the `items` map (`tools.ts:100-110`), alongside `yields` (`tools.ts:108`) and `ancestry` (`tools.ts:109`). |
| 4 | `foundryBootstrapEvents` | `src/instances/foundry-bootstrap.ts:64-75` | **THE KEY one** — the ONLY write path for the live `FOUNDRY_PRODUCT`. `planFrontierAll` drives foundry's OWN frontier off the bootstrap-written items (P3 / ADR-254), so without effects HERE, foundry's own interventions never survive into the log → `extract→compile` of foundry-the-product yields no buttons. Read `node.effects` off the `CascadeNodeSpec` and spread `...(node.effects != null && node.effects.length > 0 ? { effects: node.effects } : {})` into the `itemQueued` (`foundry-bootstrap.ts:66-75`), alongside `yields` (`foundry-bootstrap.ts:72`) and `ancestry` (`foundry-bootstrap.ts:73`). |

Each producer reads the source `CascadeNodeSpec.effects` (the top-level field, NOT `meta.effects`) and
omits the payload key when it is absent or empty → effect-less items stay effect-less (the
negative-control boundary preserved end-to-end). Effects ride ONLY on `WorkItemQueued` leaf events
(the leaf-only boundary P1/P5 established): the log records leaf facts; intermediate
capability/feature nodes carry no effects (P5's reconstructed nodes already carry only `kind` +
`title` — ADR-255 OQ-4 named effect-on-intermediates as deferred/demand-driven, and P9 does not change
that).

---

## 5. ADR-176 analysis — NOT triggered

P9 is a pack-level change on every leg of the inclusion test (ADR-176 §2), identical to P1/P5:

- **(a) Is this one of the four kernel concerns?** No. The four concerns are recurse the plan, flat
  the observation, inference, reproducibility (ADR-127; north-star §20 P3). `WorkItemQueued` is a
  foundry pack event, not a kernel contract (`@de-braighter/substrate-contracts` carries no foundry
  events). Adding an optional `effects?` is a pack-internal payload extension. `EffectDeclaration` IS
  a kernel type — but it is carried OPAQUELY on a pack event payload (the kernel never inspects pack
  payloads, ADR-027/030), exactly as `yields` (a foundry type) and `ancestry` (a foundry type) ride
  the same event. Carrying a kernel type on a pack payload does not make the pack event a kernel
  concern; the kernel already validates/versions `EffectDeclaration` where it actually lives
  (`PlanNode.effectDeclarations`, validated by `PlanTreeSchema.parse`). P9 adds NOTHING to that —
  `buildCascadeTree`'s existing `PlanTreeSchema.parse` (`cascade.ts:53`) re-validates the effects
  when they land on the tree.
- **(b) Is it needed by ≥2 packs as shared infrastructure the kernel must validate / query /
  version?** No. The `effects?` field on `WorkItemQueued`, `ItemState.effects`, and the
  `specFromQueue` carry-through are pack-local; one pack (`domains/foundry`) consumes them. The kernel
  does not validate, query, or version the `WorkItemQueued.effects` field (it validates the
  `EffectDeclaration` shape only when it reaches `PlanNode.effectDeclarations` — which P9 routes it to,
  via the EXISTING `cascade.ts:44` map).

**Both legs fail → pack territory.**

**"Store generators, derive graphs" is UPHELD.** The `effectDeclarations` on the extracted blueprint's
`PlanNode`s are DERIVED by `specFromQueue` + `buildCascadeTree` from the `effects` carried on the
work-item leaves — never stored as a separate effect graph. `ItemState.effects` is the generator held
in the projection; the on-tree `effectDeclarations` (and the descriptor's `interactions`, ADR-259) are
the derived views. The crown's `interactions` are computed at compile time and never persisted — the
same derive-don't-store discipline ADR-259 §"store generators" and ADR-242 apply. The `EffectDeclaration`
already being a typed kernel field (promoted out of `metadata` on demonstrated ≥2-pack need per ADR-194
D2 / ADR-154) is exactly why P9 needs no NEW kernel shape: the typed home already exists, and P9 only
carries the already-typed value through a pack event.

ZERO changes to `@de-braighter/substrate-contracts` or `@de-braighter/substrate-runtime`.
Charter-checker must confirm COHERENT.

---

## 6. Frontier invariant — claimability is effect-blind

The `planFrontierAll ≡ claimableItems` invariant (ADR-246/247) MUST survive P9. It does, structurally
— effects are inert to claimability, exactly as depth (P5) and substance (P1) are:

- `claimableItems` (`src/state.ts:495-507`) reads only leaf `work-item` items + their `scope` +
  `dependsOn` (+ product priority for sort). It NEVER reads `effects` or `effectDeclarations`.
- `projectTreeState` (`frontier.ts:36-86`) rebuilds `ItemState` ONLY for `n.kind === 'work-item'`
  nodes (`frontier.ts:45`). Adding `effects` to the rebuilt `ItemState` (R5) changes neither the leaf
  set nor any leaf's `scope` / `dependsOn`. The frontier reads leaves + scope + dependsOn only, never
  effects.
- Therefore `planFrontier(treeFromQueue(...))` returns the IDENTICAL frontier with or without effects
  carried. `planFrontierAll ≡ claimableItems` is preserved by construction.

This is the same effect-inertness ADR-255 §9c proves for depth and ADR-251 implies for substance: the
three authored-metadata faces (yields, ancestry, effects) are all independent optional fields on the
same event, and ALL THREE are inert to the conductor frontier.

---

## 7. Acid battery — must BITE

The test authors all fixtures INLINE; no production builder output is used to derive the expected
value. The CENTERPIECE is the broken-pivot acid: it must reproduce the EXACT failure (extracted
blueprint → compile → zero buttons) before P9, and pass after.

### ACID 1 — the broken-pivot acid (the centerpiece; must BITE)

An INDEPENDENT product that is HIERARCHICAL (P5 ancestry: `product → capability → feature →
work-item`) AND has `yields` on a work-item (P1) AND has `effectDeclarations` on a work-item — i.e. a
fixture that exercises all three authored-metadata faces at once. Then the full extract→compile pivot:

```text
FIXTURE_SPEC (product → cap → feat → wi-with-effect{+yields}; declares one real EffectDeclaration
              authored on wi-with-effect, e.g. { declarationId: uuidv5('effect:p9-fixture-cov'),
              indicatorId: 'coverage', direction: '+', … })
  1. events = blueprintToEvents(FIXTURE_SPEC, 'p9-gen', TS)
       → the WorkItemQueued for wi-with-effect carries `effects` = [that EffectDeclaration]
  2. state = fold(events)                              → ItemState.effects populated (R2)
  3. logSpec = specFromQueue('p9-gen', state)          → leaf gains top-level effects (R3)
  4. bp = extractBlueprint(logSpec, state, 'p9-gen')   → bp.process node carries effectDeclarations
  5. descriptor = compile(bp, 'browser-runtime')       (ADR-259)
  6. assert descriptor.interactions.length >= 1, and the binding's effectDeclarationId ===
     uuidv5('effect:p9-fixture-cov') (the REAL authored declarationId), and the binding's nodeId ===
     uuidv5('cascade:wi-with-effect') (the REAL node id) — a TRUE reference, not a fabrication.
  7. materializeHtml(descriptor) emits a <button data-node-id data-effect-id> carrying those exact
     ids (the button materializes).
```

This is the kill-criterion for the gap: before P9, step 4's blueprint has effect-free nodes → step 5
gives `interactions: []` → step 6 FAILS (length 0). After P9, it passes with the real ids.

### ACID 2 — MUTATION (drop the effects-carry → RED)

Repeat ACID 1 but drop the effects-carry at exactly ONE site (e.g. patch `specFromQueue` to omit the
top-level `effects` on the leaf — R3 reverted, the pre-P9 behavior). Re-run the pivot: step 4's
blueprint node has no `effectDeclarations` → `descriptor.interactions` is `[]` → the
`interactions.length >= 1` assertion FAILS. Proves the test bites: a regression in the effects
threading turns the centerpiece RED. (A second mutation variant drops the carry at `blueprintToEvents`
— R2b site #1 — and asserts the same RED, pinning the emit-site obligation.)

### ACID 3 — NEGATIVE CONTROL (effect-less work-item → no interaction)

A work-item with NO `effects` (omit the field on the source `CascadeNodeSpec`): run the full pivot.
Assert `descriptor.interactions` does NOT contain a binding for that node's id, and (for a product
whose ONLY work-items are effect-less) `descriptor.interactions` is `[]` and `materializeHtml` emits
NO `<button data-effect-id>`. Proves no phantom intervention appears — the effect-less boundary
survives the round-trip through the log (the same negative control ADR-259 acid 2 asserts on the
direct path, now asserted on the extract path).

### ACID 4 — BOOTSTRAP path (foundry's own interventions survive)

`foundryBootstrapEvents(emptyState, TS, spec)` where `spec` is an independent fixture (or
`FOUNDRY_PRODUCT` augmented with an `effects`-bearing work-item) → `fold` → `treeFromQueue('foundry')`
→ `extractBlueprint(specFromQueue('foundry', state), …)` → `compile('browser-runtime')`. Assert the
intervention(s) authored on the bootstrapped work-item(s) survive into `descriptor.interactions` with
their real `effectDeclarationId`s. This exercises the path the LIVE foundry log actually uses (P3 /
ADR-254) — the same methodological-mismatch guard P5 ACID 7 installed for ancestry. Without R2b site
#4 (bootstrap), this acid is RED.

### ACID 5 — BACKWARD-COMPAT (old WorkItemQueued without effects → no regression)

Fold a `WorkItemQueued` event lacking the `effects` field (a pre-P9 event). Assert it deserializes to
`ItemState.effects === []` without error, `specFromQueue` omits the top-level `effects` on the leaf,
the extracted blueprint's node has no `effectDeclarations`, and `compile('browser-runtime')` yields no
binding for it. A product whose entire log is effect-free returns `interactions: []` — status quo
preserved, no migration required.

### ACID 6 — P1 + P5 intact (the three faces coexist)

Within ACID 1's three-face fixture: drive items to DONE and assert `deriveSubstanceFromLog` (P1 /
ADR-251) still yields the union of the work-items' substance, AND `specFromQueue` still reconstructs
the 4-level hierarchy (P5 / ADR-255 structural equality). P9 must not regress P1 or P5: yields,
ancestry, and effects are THREE independent optional fields on the same event.

### ACID 7 — Frontier invariant (claimability unchanged by effects)

An active-items fixture (queued items with deps + a scope conflict) authored BOTH with and without
`effects` on the work-items. Assert `planFrontierAll(state, now)` returns the IDENTICAL frontier with
vs without effects. Pins `planFrontierAll ≡ claimableItems` (§6): effects are inert to the frontier.

### ACID 8 — Builds green

Full foundry test suite stays green; no existing projector, conductor, frontier, or P7 compiler
behavior changes. The P7 acids (`test/p7-browser-runtime.acid.test.ts`) — which compile DIRECT
blueprints — still pass unchanged; P9 only adds the extract-path coverage they never had.

---

## 8. Backward-compatibility

`effects` is optional everywhere:

- Old `WorkItemQueued` events without the field parse fine (Zod `.optional()`).
- `ItemState.effects` defaults to `[]` on fold (R2) — `specFromQueue` then omits the top-level
  `effects` on the leaf, the extracted blueprint's node has no `effectDeclarations`, and the crown
  emits no button — exactly today's behavior. No phantom interventions.
- Reverting P9 means extracted blueprints return to effect-free nodes (the broken pivot). No log
  migration is required; historical events have no effects and reconstruct effect-free as before.

Real-product logs (agri, whales, oncology) and the P3 bootstrap items contain `WorkItemQueued` events
without `effects`; only NEW queued events via the four emit sites carry it. Note: the real shipped
products (WHALES_PRODUCT, FOUNDRY_PRODUCT) carry ZERO `effectDeclarations` today (ADR-259's fixtures
note: those products are "POOR intervention fixtures") — so for them, even after P9 the extracted
blueprint stays effect-free (correctly: there are no authored effects to carry). P9 closes the
MECHANISM; the gap only becomes VISIBLE on a product that authors effects (the fixtures, and
`ARC_CASCADE`'s `pr:devloop-scaffold` if surfaced as a queued product).

**Live-log re-cutover is a SEPARATE, founder-gated step — NOT done in this slice.** Same posture as P5
(ADR-255 §8): the existing live foundry items were registered by the P3 bootstrap BEFORE P9, so they
carry no effects; the CODE now emits effects for FUTURE bootstrap runs (and for the test fixtures), but
re-registering the REAL live `data/events.jsonl` is a live-shared-log mutation and a founder decision.
Until then, the live foundry product's extracted blueprint stays effect-free; the self-application
honesty is proven on the bootstrap code path against a fresh state (ACID 4), not asserted over the
already-cutover live log.

---

## 9. What this COMPLETES — reconciling ADR-259's claim

ADR-259 (the P7 crown) claimed the extract→generate→compile vision is "COMPLETE — to a running app
where … a button-click IS an intervention" (adr-259:320-324). That claim was TRUE for the direct
`buildCascadeTree(SPEC)` path (the only path P7's acids exercise) but FALSE for the EXTRACTED-blueprint
path, because `effectDeclarations` never reached the log. P9 closes that gap: after P9, an extracted
blueprint's `PlanNode`s carry `effectDeclarations`, so `compile('browser-runtime')` produces real
interaction-buttons on the extract→compile pivot — the self-application flagship — end to end.

P9 is the THIRD authored-metadata face to round-trip through the log, completing the set:

| Face | Slice / ADR | Field on WorkItemQueued | Lands on | Derived view |
|---|---|---|---|---|
| Substance | P1 / ADR-251 | `yields?: SubstanceRef[]` (foundry type) | `ItemState.yields` → leaf meta | `blueprintSubstance` / `deriveSubstanceFromLog` |
| Structure | P5 / ADR-255 | `ancestry?: AncestorRef[]` (foundry type) | `ItemState.ancestry` → reconstructed nodes | the 4-level tree |
| Intervention | P9 / ADR-260 | `effects?: EffectDeclaration[]` (KERNEL type) | `ItemState.effects` → leaf `effects` → `PlanNode.effectDeclarations` | the crown's `interactions` |

After P1+P5+P9, the event log is a COMPLETE representation of the product's authored metadata: its
substance, its structure, and its interventions all derive from the log alone. The crown's
extract→compile pivot composes for all three.

---

## 10. Slice scope

- **foundry:** add `effects?: z.array(EffectDeclarationSchema).optional()` to `WorkItemQueued`
  (`src/events.ts`, importing the PUBLISHED `EffectDeclarationSchema`); add `effects: EffectDeclaration[]`
  to `ItemState` + normalize on fold (`src/state.ts`); set the top-level `effects` on the reconstructed
  leaf in `specFromQueue` (`src/plan/tree-from-queue.ts`); thread `effects` through ALL FOUR
  `WorkItemQueued` emit sites — `blueprintToEvents` (`src/metamodel/generate.ts`), `queuePush` /
  `ItemInput.effects` (`src/ops.ts`) exposed on the `foundry_queue_push` MCP schema
  (`src/mcp/server.ts`), `foundry_generate_from_blueprint` (`src/mcp/tools.ts`), and
  `foundryBootstrapEvents` (`src/instances/foundry-bootstrap.ts`); carry `effects` through
  `projectTreeState` by reading the typed `n.effectDeclarations` field (NOT `LeafMeta`, which is
  unchanged) (`src/plan/frontier.ts`). Add the acid battery (ACID 1 broken-pivot
  centerpiece + ACID 2 mutation + ACID 3 negative control + ACID 4 bootstrap path + ACID 5
  backward-compat + ACID 6 P1+P5-intact + ACID 7 frontier-invariant + ACID 8 builds-green). **No
  `@de-braighter/substrate-*` change. No P7 compiler / materializer change.**
- **specs:** ADR-260 (proposed) — codifies the effects-in-log mechanism as the third
  authored-metadata face that completes the crown's extract→compile pivot.

P9 depends on P1 (ADR-251) and P5 (ADR-255) being landed (the additive optional-field pattern + the
`specFromQueue` carry-through they established) and reconciles P7 (ADR-259). The three faces are
independent optional fields; P9 reuses their machinery for the third.

---

## 11. Deferred

- **Live-log re-cutover (founder-gated; NOT in this slice).** §8 — re-registering the live foundry
  items so their effects land is a live-shared-log mutation and a founder decision.
- **Effects on intermediate (capability/feature) levels.** P5's reconstructed intermediate nodes carry
  only `kind` + `title` (ADR-255 OQ-4). Effects on intermediate levels would require the
  `AncestorRef` shape to grow; demand-driven per ADR-176, not in scope.
- **EditIntent → kernel tree-edit-op binding (ADR-240 D4) on the extracted app.** ADR-259 deferred a
  button that MUTATES the live plan tree; P9 only makes the button APPEAR on the extracted app (it
  fires `{ nodeId, effectDeclarationId }`, the marker). Wiring a live tree edit / inference re-run is
  the same deferred arc ADR-259 named.
- **Historical log backfill** — recovering authored effects for existing real-product logs is out of
  scope; only new queued events carry effects.
