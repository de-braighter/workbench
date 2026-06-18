# Foundry v1 Stage 2 Slice 2A — tree-from-queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a `treeFromQueue(productKey, state)` derivation so `planFrontier` can drive any queue-product, and prove `planFrontier(treeFromQueue(p)) ≡ claimableItems(p)` on the real canonical log + an active-items fixture. Additive; no behavior flip; zero kernel change.

**Architecture:** `treeFromQueue` builds a flat single-parent `CascadeNodeSpec` (one product root + one leaf per `WorkItemQueued` item, each leaf's `metadata` carrying the structural fields `planFrontier` reads) from a product's queue events in `state`. `planFrontier` over that tree reuses the existing `claimableItems ∘ projectTreeState` and therefore equals `claimableItems` filtered to the product — by construction.

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), vitest, the existing `CascadeNodeSpec`/`buildCascadeTree` shape.

## Global Constraints

- **Zero kernel change.** No edits to `@de-braighter/substrate-*`. `treeFromQueue` reuses the existing `CascadeNodeSpec` — NO new node kind.
- **ESM imports use explicit `.js` extensions.**
- **Additive only.** Do NOT change `nextItems`' default (`'queue'`), `projectTreeState`, `claimableItems`, or any consumer. This slice adds a derivation + a test; nothing else.
- **Test command:** `cd domains/foundry && npx vitest run` (the new test file first).
- **The derivation is pure + deterministic:** `treeFromQueue(productKey, state)` → `CascadeNodeSpec`, no I/O, no `Date.now()` inside.
- **Real log:** `domains/foundry/data/events.jsonl`. Read it via the repo's `readEnvelopes`.
- **Branch:** foundry → `v1-stage2-tree-from-queue`; specs → `foundry-v1-adr-246`. NO `git add -A` (foundry has untracked `extract-vocabs.mjs` — never stage it).

---

### Task 1: `treeFromQueue` derivation + biting acid test (foundry repo)

**Files:**
- Create: `domains/foundry/src/plan/tree-from-queue.ts`
- Create: `domains/foundry/test/tree-from-queue.acid.test.ts`

**Interfaces:**
- Consumes (READ these first to match shapes exactly): `src/plan/frontier.ts` — `planFrontier(tree, state, nowMs)` + `projectTreeState(...)` (note EXACTLY which metadata keys a leaf must carry — `itemId`, `scope`, `dependsOn` — and the root shape); `src/foundry-product.ts` — how `FOUNDRY_PRODUCT` / `buildCascadeTree` authors a `CascadeNodeSpec` (the canonical tree shape to mirror); `src/state.ts` — `claimableItems(state, nowMs)`, `fold(...)`, and the `state` shape (where queued items live — the `WorkItemQueued`-derived item records keyed by product); `src/log.ts` — `readEnvelopes(path)`.
- Produces: `treeFromQueue(productKey: string, state: DerivedState): CascadeNodeSpec` — a flat tree: one product root, one leaf per queued work-item of that product, each leaf carrying the same structural metadata (`itemId`/`scope`/`dependsOn`) that `projectTreeState` reads.

- [ ] **Step 1: Write the failing acid test** (`test/tree-from-queue.acid.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { readEnvelopes } from '../src/log.js';
import { fold } from '../src/state.js';            // confirm export name
import { claimableItems } from '../src/state.js';
import { planFrontier } from '../src/plan/frontier.js';
import { treeFromQueue } from '../src/plan/tree-from-queue.js';

const NOW = 1_900_000_000_000; // fixed ms; do NOT use Date.now() in assertions

// helper: queue-event fixture builder — author realistic foundry:WorkItemQueued.v1 envelopes
// + ClaimAcquired / MergeRecorded to create an ACTIVE frontier (deps + scope conflict + TTL-expired claim).
// Match the real envelope shape by reading how existing tests / foundry-product build events.

describe('treeFromQueue ≡ claimableItems', () => {
  it('REAL LOG (negative control): no phantom claimable items for any product', () => {
    const s = fold(readEnvelopes('data/events.jsonl'));
    for (const p of productKeysIn(s)) {           // derive the product set from state
      const viaTree = planFrontier(treeFromQueue(p, s), s, NOW).map(i => i.itemId).sort();
      const viaQueue = claimableItems(s, NOW).filter(i => i.productKey === p).map(i => i.itemId).sort();
      expect(viaTree).toEqual(viaQueue);          // all done → both [] ; bites if derivation hallucinates
    }
  });

  it('ACTIVE fixture (the bite): same NON-empty frontier as claimableItems', () => {
    const s = fold(activeFixtureEvents());          // queued items: a deps→b, scope-conflict pair, a TTL-expired claim
    const p = 'fixture-product';
    const viaTree = planFrontier(treeFromQueue(p, s), s, NOW).map(i => i.itemId).sort();
    const viaQueue = claimableItems(s, NOW).filter(i => i.productKey === p).map(i => i.itemId).sort();
    expect(viaTree.length).toBeGreaterThan(0);      // non-trivial
    expect(viaTree).toEqual(viaQueue);
  });

  it('determinism: treeFromQueue is pure', () => {
    const s = fold(activeFixtureEvents());
    expect(treeFromQueue('fixture-product', s)).toEqual(treeFromQueue('fixture-product', s));
  });
});
```

- [ ] **Step 2: Run it — verify it fails** (`npx vitest run test/tree-from-queue.acid.test.ts`) → FAIL (module not found).

- [ ] **Step 3: Implement `treeFromQueue`** in `src/plan/tree-from-queue.ts` — build a flat `CascadeNodeSpec` (product root + one leaf per the product's queued item in `state`, each leaf's `metadata` carrying `itemId`/`scope`/`dependsOn` exactly as `projectTreeState` reads them). Mirror the `CascadeNodeSpec` shape from `foundry-product.ts`. Pure; no `Date.now()`.

- [ ] **Step 4: Run the test → PASS.** If the REAL-LOG assertion fails for a product (viaTree ≠ viaQueue), the derivation is unfaithful — fix `treeFromQueue` so the projected frontier matches the queue frontier exactly. If the ACTIVE fixture's `viaTree` is empty, fix the fixture so it has genuinely-claimable items.

- [ ] **Step 5: Mutation check (prove the test BITES), then REVERT.** Temporarily make `treeFromQueue` drop `dependsOn` from each leaf; re-run; confirm the ACTIVE-fixture equality assertion goes RED (a dep that should block an item no longer does → frontiers diverge). REVERT. Record the result.

- [ ] **Step 6: Run the full suite** (`npx vitest run`) → all green (additive; nothing else changed).

- [ ] **Step 7: Commit**

```bash
git add domains/foundry/src/plan/tree-from-queue.ts domains/foundry/test/tree-from-queue.acid.test.ts
git commit -m "feat(foundry): treeFromQueue derivation + empirical planFrontier≡claimableItems acid test"
```

---

### Task 2: ADR-246 — queue events are plan-node declarations (specs repo, designer-authored)

Drafted by `substrate-architect`; reviewed by `charter-checker` (COHERENT) + `spec-auditor`.

**Files:**
- Create: `layers/specs/adr/adr-246-foundry-queue-events-are-plan-node-declarations.md` (status `proposed` until charter-checker COHERENT).
- Modify: `layers/specs/adr/adrs-by-tier.md` (+1 the same tier as ADR-244/245) + the ADR index (`adr/README.md`).

- [ ] **Step 1: Confirm 246 free** (`ls layers/specs/adr | grep adr-246` empty; 245 latest).
- [ ] **Step 2: Author the ADR** — records: `WorkItemQueued` events ARE the event-sourced declaration of plan-tree leaves; the plan tree is **derivable** from them (`treeFromQueue`), making `planFrontier` universal and setting the path to retiring the standalone `claimableItems` shadow (Slice 2B). State the ADR-176 inclusion test is NOT triggered (the plan tree is a ratified kernel concept per ADR-127 §1; `treeFromQueue` is a pack-level *derived view* — "store generators, derive graphs", ADR-176 §4 — no new kernel shape). Cite ADR-244 (Phase A), ADR-127, ADR-176. Match the ADR-244/245 frontmatter convention + tier.
- [ ] **Step 3: Validate** — `node tools/validators/frontmatter-schema.mjs layers/specs/adr/adr-246-*.md` (status ∈ {proposed, ratified, superseded}); spec-auditor clean.
- [ ] **Step 4: Commit** on branch `foundry-v1-adr-246`.

---

## Self-Review

**Spec coverage:** §2 Slice 2A (treeFromQueue + empirical equivalence, additive, no flip) → Task 1. §6 ADR-246 → Task 2. §2 Slice 2B (flip/retire) + §exceptions (foundry self-event-sourcing, FOUNDRY_PRODUCT exception) → explicitly deferred, no task. §4 acid test (real-log negative control + active fixture bite + mutation + determinism) → Task 1 steps 1/4/5. No gaps.

**Placeholder scan:** the fixture builders (`activeFixtureEvents`, `productKeysIn`) are implementer-authored against the real envelope/state shapes (intentional fixture authoring, not hidden requirements). All file paths, the `treeFromQueue` signature, and the assertions are concrete.

**Type consistency:** `treeFromQueue(productKey, state): CascadeNodeSpec` used identically in the impl + test + interfaces. `planFrontier(tree, state, nowMs)` / `claimableItems(state, nowMs)` per the recon — implementer confirms exact signatures by reading the source (noted in Task 1 interfaces).
