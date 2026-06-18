# Foundry v1 Stage 2 — Doing-Side Unification (Slice 2A: tree-from-queue)

> Stage 2 of the autonomous Foundry ladder. Makes the conductor's plan-tree frontier driver
> (`planFrontier`) **universal** by deriving a product's plan tree from its `WorkItemQueued` events,
> and empirically proves `planFrontier ≡ claimableItems` on the **real** canonical log. The keystone
> for retiring the queue shadow (Slice 2B). **Additive, no behavior flip, zero kernel change.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (a `treeFromQueue` derivation + an empirical equivalence test); `layers/specs` (ADR-246).
- **Predecessor:** ADR-244 (Phase A — conductor drives off the plan tree; `planFrontier = claimableItems ∘ projectTreeState`, `source:'queue'|'plan'`, default `'queue'`).

## 1. Problem — the queue and the tree drive different things, and the invariant was untestable on real data

Phase A gave the conductor two frontier computations and a divergence invariant (`planFrontier ≡
claimableItems`) checked only on **synthetic** battery fixtures. An empirical spike over the **real**
4584-event canonical log revealed *why* the invariant could never validate the naive way:

- **All four queue-registered products** (agri-ecosystem-twin, oncology, whales-and-bubbles,
  green-desk-devloop) are **fully done** — 0 claimable items. They exist as `WorkItemQueued` +
  claim/merge events.
- **Foundry itself was never queue-registered** — no `ProductRegistered`/`WorkItemQueued` events for
  its own items. Foundry's items exist *only* in the code-authored `FOUNDRY_PRODUCT` tree, and the
  tree's `meta.status:'done'` annotations are **hand-written, not log-derived** (Phase A/B were done
  via git PRs, not via `foundry_claim`/`record_merge`).
- So **no product has both a plan tree and live queue status** → `planFrontier` (needs a tree) and
  `claimableItems` (works off queue events) never overlap on real data. The "divergence" the spike
  observed (`planFrontier(foundryTree)=9` vs `claimableItems(foundry)=0`) is structural, not a bug.

**The keystone the spike proved:** every `WorkItemQueued` event carries exactly the fields a plan-tree
leaf needs — `itemId`, `scope`, `dependsOn`, `productKey` (verified on a real `agri` item). **A plan
tree is derivable from the queue events.** This is the bridge that makes `planFrontier` universal and
ultimately lets the queue shadow be retired.

## 2. Decision — derive the tree from the queue (Slice 2A); flip + retire later (Slice 2B)

### Slice 2A — `treeFromQueue` + empirical equivalence — BUILD NOW (additive, no flip)

Add a derivation `treeFromQueue(productKey, state)` that builds a **flat single-parent plan tree**
(a `CascadeNodeSpec`, the same shape `buildCascadeTree` produces) from a product's `WorkItemQueued`
items — one root (the product) with one leaf per work item, each leaf's `metadata` carrying
`itemId`/`scope`/`dependsOn`. Then `planFrontier(treeFromQueue(p, state), state, now)` drives **any**
queue-product, and by construction equals `claimableItems(state, now)` filtered to that product (both
read the same queue events through the same claimability rule).

**Prove it** with a new test that asserts `planFrontier(treeFromQueue(p)) ≡ claimableItems(p)` on:
1. the **real** canonical log (`data/events.jsonl`), for every product present — a negative control:
   all products are done, so both sides must be `[]` (catches a derivation that hallucinates items);
2. an **independently-authored active-items fixture** (queued items with deps + a scope conflict +
   a TTL-expired claim) — the non-trivial bite, where both sides return the same NON-empty frontier;
3. a **mutation** (corrupt `treeFromQueue` — e.g. drop `dependsOn` from a leaf) → `planFrontier`
   diverges from `claimableItems` → the equality assertion goes **RED**.

**No flip.** `nextItems` default stays `'queue'`. `treeFromQueue` is added + tested; nothing changes
behavior. This closes §12's "the divergence invariant has held on real data" with a real-data proof,
and makes `planFrontier` universal — the prerequisite for Slice 2B.

### Slice 2B — flip default + retire the queue shadow — AFTER 2A

Flip `nextItems` default `'queue'→'plan'` (using `treeFromQueue` per product); repoint the two direct
`claimableItems` consumers (`ai-capacity.ts`, `status.ts`) to `planFrontier`; retire the
`source:'queue'` branch. The `WorkItemQueued` events **remain** as the plan-node persistence;
`claimableItems` **remains** as `planFrontier`'s internal rule — only the *standalone queue path* is
retired. A test goes RED if any caller still reaches the raw queue frontier. (Conductor-usage recon
done at 2B time.)

### Exceptions & deferrals (recorded)

- **`FOUNDRY_PRODUCT` code tree stays** the one hand-authored exception: the meta-product is
  orchestrator-driven (this ladder), its status hand-maintained. It is not conductor-driven off the
  queue, so it does not need `treeFromQueue`.
- **Foundry self-event-sourcing DEFERRED:** making foundry record its own claim/merge lifecycle so
  its tree status is log-derived (instead of hand-annotated) is a real follow-up, but is NOT required
  to retire the queue shadow for *product* work. Noted for a later slice.

## 3. Architecture & mechanism

```
WorkItemQueued events (per product)         treeFromQueue(p, state)            planFrontier(tree, state, now)
  { itemId, scope, dependsOn, productKey } ───────────────────────▶ flat CascadeNodeSpec ──▶ claimableItems ∘ projectTreeState
                    │                                                                                    │
                    └────────────────────────── claimableItems(state, now) filter=p ─────────────────────┘
                                          (must be set-equal — the empirical invariant)
```

- `treeFromQueue` is a pure derivation: `(productKey, state) → CascadeNodeSpec`. Deterministic;
  one leaf per queued item; root = the product. It reuses the existing tree shape — no new node kind.
- It lives beside `plan/frontier.ts` (e.g. `plan/tree-from-queue.ts`), consumed by `planFrontier`'s
  caller; `projectTreeState`/`claimableItems` are unchanged.

## 4. Acid test — must BITE

1. **Real-log negative control:** `planFrontier(treeFromQueue(p)) === claimableItems(p) === []` for
   every product in `data/events.jsonl` (all done). Bites if the derivation hallucinates claimable
   items from done/merged work.
2. **Active-items fixture (the non-trivial bite):** an independently-authored queue with queued items
   + a dependency chain + a scope conflict + a TTL-expired claim; assert `planFrontier(treeFromQueue)`
   deep-equals `claimableItems` (both NON-empty, same set).
3. **Mutation → RED:** corrupt `treeFromQueue` (drop `dependsOn` / mis-key `scope`); the equality
   assertion must fail (proves the test detects an unfaithful derivation, not a tautology).
4. **Determinism:** `treeFromQueue(p, state)` twice → deep-equal.

## 5. Reversibility

Purely additive: a new derivation + a new test. The default driver stays `'queue'`; no consumer is
repointed. Reverting = delete the new file + test. Zero risk to live conductor behavior.

## 6. Governance — ADR-246, zero kernel change

- **ADR-246** records the unification principle: `WorkItemQueued` events ARE the event-sourced
  declaration of plan-tree leaves; the plan tree is **derivable** from them (`treeFromQueue`), making
  `planFrontier` universal and setting the path to retiring the standalone `claimableItems` shadow
  (2B). Status `proposed` until charter-checker COHERENT.
- **ADR-176 inclusion test — NOT triggered.** The plan tree is already a ratified kernel concept
  (ADR-127 §1). `treeFromQueue` is a pack-level *derivation* (a view) over existing pack events —
  "store generators, derive graphs" (ADR-176 §4): the events are the generator, the tree is the
  derived view. No new kernel shape; no kernel code. charter-checker runs regardless.

## 7. Scope boundaries (YAGNI)

- NO flip of the default driver (that is Slice 2B).
- NO foundry self-event-sourcing (deferred).
- NO scheduled-wake actuation (§12 optional, separate decision).
- NO new kernel shapes; `treeFromQueue` reuses the existing `CascadeNodeSpec`.
