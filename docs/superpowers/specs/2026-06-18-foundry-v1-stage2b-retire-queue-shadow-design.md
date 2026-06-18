# Foundry v1 Stage 2 — Doing-Side Unification (Slice 2B: flip default + retire the queue shadow)

> Completes Stage 2. Makes `planFrontier` (over `treeFromQueue`) the **sole** conductor driver across
> all products, retires the standalone `claimableItems` queue path, and repoints the remaining direct
> consumers. **Behavior-preserving** (proven equal to the legacy path on the real log) and **zero
> kernel change.**

- **Date:** 2026-06-18
- **Scope:** `domains/foundry` (`nextItems` default + an all-product frontier + repoint 2 consumers + retire the `source` param); `layers/specs` (ADR-247).
- **Predecessor:** ADR-246 / Slice 2A (`treeFromQueue` made `planFrontier` universal; named this retirement as its path).

## 1. Problem — the conductor still drives off the queue shadow

After Slice 2A, `planFrontier(treeFromQueue(p), state, now) ≡ claimableItems(state, now)` filtered to
`p` (proven on the real log + an active fixture). But the **live conductor still drives off the legacy
queue path**: `foundry_next`'s MCP schema accepts only `{limit}`, so `nextItems` runs its default
branch — `claimableItems(state, now)` (all products) — never `planFrontier`. Four sites call
`claimableItems` directly (`ops.nextItems`, `ops.sessionPrompts`→`nextItems`, `status.ts:86`,
`ai-capacity.ts:23`). The "queue shadow" — `claimableItems` invoked as a *standalone, parallel* driver
— is still the real coordination path. Stage 2's DONE criterion ("coordination derives entirely from
the plan tree, queue shadow retired") is not met until the conductor drives off `planFrontier`.

## 2. Decision — `planFrontier` is the sole driver

### Slice 2B (build now)

1. **All-product plan frontier.** Add `planFrontierAll(state, now): NextItem[]` (e.g. in `plan/`) =
   `⋃_{p ∈ state.products} planFrontier(treeFromQueue(p, state), state, now)`, with the **same global
   sort `claimableItems` enforces** (product priority → queue order → itemId). By construction this
   equals `claimableItems(state, now)` across all products — including cross-product scope-disjointness
   (each per-product `planFrontier` already sees other products' active claims via `projectTreeState`).
2. **Flip the default.** `nextItems`' default path calls `planFrontierAll` instead of `claimableItems`.
   Remove the `source: 'queue' | 'plan'` param from `NextItemsOpts` and the `'queue'` branch — there is
   now ONE driver. (The MCP `foundry_next` handler simplifies: no `source`, no `buildCascadeTree(FOUNDRY_PRODUCT)`.)
3. **Repoint the remaining direct consumers** to the plan path: `status.ts:86` (the "NEXT UP" board) and
   `ai-capacity.ts:23` (the per-repo AI-throughput check) call `planFrontierAll` (filtered to the repo
   where needed) instead of `claimableItems`. `ops.sessionPrompts` follows automatically (it delegates
   to `nextItems`).
4. **Retain the internal rule.** `claimableItems` and `projectTreeState` **stay** — `planFrontier`
   composes them internally (`planFrontier = claimableItems ∘ projectTreeState`). What is retired is the
   **standalone** `claimableItems` call as a parallel driver, not the claimability rule itself. There
   remains exactly ONE encoding of "claimable" (ADR-244's M1 principle, preserved).

### What becomes vestigial (recorded)

- **`FOUNDRY_PRODUCT`** (the hand-authored code tree) is no longer on any live conductor path (it was
  only built when `source:'plan'` was passed, which the conductor never did). It remains the
  hand-authored meta-product declaration for Foundry itself + a test fixture; it is NOT deleted (the
  meta-product exception — foundry's own work is orchestrator-driven off this tree, outside `foundry_next`).

## 3. Architecture & mechanism

```
foundry_next({limit})                    (live conductor; no source param)
        │
        ▼
nextItems(deps, limit)  ── default ──▶  planFrontierAll(state, now)
                                              │  = ⋃_p planFrontier(treeFromQueue(p), state, now)
                                              │     sorted (product priority → queue order → itemId)
                                              ▼
status.ts / ai-capacity.ts  ───────────▶  planFrontierAll(state, now)   (repoint; repo-filter where needed)

  claimableItems + projectTreeState  ──── retained as planFrontier's INTERNAL rule (no standalone driver call)
```

## 4. Acid test — must BITE (behavior preservation + retirement)

1. **Behavior preservation (the core):** `planFrontierAll(state, now) ≡ claimableItems(state, now)`
   (deep-equal, same order) on (a) the **real** canonical log (all products) and (b) an
   **independently-authored active fixture** spanning ≥2 products with a **cross-product scope conflict**
   (an active claim in product A blocks product B's overlapping item) + a dependency chain + a
   TTL-expired claim. The cross-product case is the bite — it's where a naive per-product union would
   diverge from the global `claimableItems`.
2. **Mutation → RED:** break the union (e.g. compute each product's frontier WITHOUT the other products'
   state — drop the cross-product projection); the cross-product-conflict assertion must go RED.
3. **Retirement guard:** a test asserting `nextItems` with NO opts returns `planFrontierAll`'s result
   (the default is the plan path), and a source-level check that no production module under `src/`
   (excluding `plan/frontier.ts`'s internal use) calls `claimableItems` as a standalone driver — i.e.
   the queue shadow is gone. (Grep-style assertion or an architecture test.)
4. **Determinism + sort:** `planFrontierAll` is deterministic and reproduces `claimableItems`'s exact
   sort (the equality in #1 already pins this).

## 5. Reversibility

The flip is behind a single function swap in `nextItems` + two consumer repoints. Reverting = restore
the `claimableItems` calls. Because #1 proves `planFrontierAll ≡ claimableItems`, the flip is a no-op on
observable conductor behavior — the safest possible "change". The `source` param removal is the only
non-additive edit; it has no live callers (MCP schema never exposed it).

## 6. Governance — ADR-247, zero kernel change

- **ADR-247** records the completion: the doing-side is unified — `planFrontier` (over `treeFromQueue`)
  is the sole conductor driver; the standalone `claimableItems` queue-shadow path is retired;
  `claimableItems` is retained solely as `planFrontier`'s internal rule. Realizes ADR-246's stated path.
  Status `proposed` until charter-checker COHERENT.
- **ADR-176 inclusion test — NOT triggered.** Still pack-level: retiring a pack code path + repointing
  pack consumers to a pack derivation. No kernel shape, no kernel code. charter-checker runs regardless.

## 7. Scope boundaries (YAGNI)

- NO foundry self-event-sourcing (deferred — `FOUNDRY_PRODUCT` stays the hand-authored meta-product exception).
- NO scheduled-wake actuation (§12 optional, separate decision).
- NO deletion of `claimableItems`/`projectTreeState` (retained as the internal rule).
- NO new kernel shapes.
