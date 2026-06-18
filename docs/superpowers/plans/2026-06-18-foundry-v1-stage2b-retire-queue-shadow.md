# Foundry v1 Stage 2 Slice 2B — flip default + retire queue shadow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make `planFrontier` (over `treeFromQueue`) the sole conductor driver: add an all-product frontier, flip `nextItems`' default off `claimableItems`, repoint the remaining direct consumers, retire the `source` param. Behavior-preserving (proven equal to the legacy path); zero kernel change.

**Architecture:** `planFrontierAll(state, now) = ⋃_p planFrontier(treeFromQueue(p, state), state, now)`, sorted exactly as `claimableItems`. It replaces the standalone `claimableItems` driver in `nextItems`, `status.ts`, `ai-capacity.ts`. `claimableItems`/`projectTreeState` stay as `planFrontier`'s internal rule.

**Tech Stack:** TypeScript (ESM, `.js` extensions), vitest.

## Global Constraints

- **Zero kernel change.** No `@de-braighter/substrate-*` edits.
- **Behavior-preserving.** `planFrontierAll(state, now)` MUST deep-equal `claimableItems(state, now)` (same set AND order) on the real log + the active fixture. This is the gate — if they differ, the union/sort is wrong; fix it (do NOT weaken the assertion).
- **ESM `.js` extensions.** No `git add -A` (foundry has untracked `extract-vocabs.mjs`). Test cmd: `cd domains/foundry && npx vitest run`.
- **Retain the internal rule:** do NOT delete `claimableItems` or `projectTreeState` — `planFrontier` composes them. Retire only the *standalone driver* calls + the `source` param.
- **Branches:** foundry → `v1-stage2b-retire-queue-shadow`; specs → `foundry-v1-adr-247`.

---

### Task 1: `planFrontierAll` + flip nextItems + repoint consumers + retire source (foundry repo)

One cohesive, behavior-preserving change with the behavior-preservation acid test as its gate.

**Files:**
- Create: `domains/foundry/src/plan/plan-frontier-all.ts` (or add `planFrontierAll` beside `planFrontier` in `src/plan/frontier.ts` — match the existing module layout).
- Modify: `src/ops.ts` (`nextItems` default → `planFrontierAll`; remove `NextItemsOpts.source` + the `'queue'` branch), `src/status.ts:86` (repoint), `src/ai-capacity.ts:23` (repoint), `src/mcp/tools.ts` (`foundry_next` handler: drop `source` + the `buildCascadeTree(FOUNDRY_PRODUCT)` tree-building).
- Create: `domains/foundry/test/plan-frontier-all.acid.test.ts`.

**Interfaces:**
- Consumes (READ first): `src/plan/frontier.ts` (`planFrontier(tree, state, now)`), `src/plan/tree-from-queue.ts` (`treeFromQueue(productKey, state)`), `src/state.ts` (`claimableItems(state, now)` + its EXACT sort at ~464-467 — `planFrontierAll` must reproduce it; `DerivedState.products`), `src/ops.ts` (`nextItems`, `NextItemsOpts`, `toNextItem`, `sessionPrompts`), `src/status.ts`, `src/ai-capacity.ts`, `src/mcp/tools.ts` + `src/mcp/server.ts`.
- Produces: `planFrontierAll(state: DerivedState, nowMs: number): <same item type claimableItems returns>` — the all-product frontier, globally sorted identically to `claimableItems`.

- [ ] **Step 1: Write the failing behavior-preservation acid test** (`test/plan-frontier-all.acid.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { readEnvelopes } from '../src/log.js';
import { fold, claimableItems } from '../src/state.js';
import { planFrontierAll } from '../src/plan/plan-frontier-all.js'; // or '../src/plan/frontier.js'

const NOW = 1_900_000_000_000;

describe('planFrontierAll ≡ claimableItems (queue shadow retired, behavior preserved)', () => {
  it('REAL LOG: identical frontier (set AND order) for all products', () => {
    const s = fold(readEnvelopes('data/events.jsonl'));
    expect(planFrontierAll(s, NOW)).toEqual(claimableItems(s, NOW));
  });

  it('ACTIVE fixture incl. CROSS-PRODUCT scope conflict: identical frontier', () => {
    // independently-authored: ≥2 products, an active claim in product A blocking product B's
    // overlapping (same repo+issue) item, + a dependency chain + a TTL-expired claim.
    const s = fold(activeMultiProductFixture());
    expect(planFrontierAll(s, NOW)).toEqual(claimableItems(s, NOW)); // the bite: cross-product disjointness
    expect(planFrontierAll(s, NOW).length).toBeGreaterThan(0);       // non-trivial
  });

  it('determinism', () => {
    const s = fold(activeMultiProductFixture());
    expect(planFrontierAll(s, NOW)).toEqual(planFrontierAll(s, NOW));
  });
});
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run test/plan-frontier-all.acid.test.ts`) — module not found.

- [ ] **Step 3: Implement `planFrontierAll`** — iterate `state.products`, `planFrontier(treeFromQueue(p, state), state, now)` each, concatenate, then apply the SAME sort `claimableItems` uses (read `state.ts` ~464-467 and reproduce it exactly). Return the same item shape.

- [ ] **Step 4: Run the acid test → PASS.** If the REAL-LOG or CROSS-PRODUCT assertion fails, the union/sort diverges from `claimableItems` — fix `planFrontierAll` (likely the sort, or a missing cross-product projection) until deep-equal. Do NOT weaken the assertion.

- [ ] **Step 5: Flip the default + repoint consumers + retire source.** In `ops.ts`: `nextItems` default branch → `planFrontierAll(s, nowMs)`; remove `NextItemsOpts.source` + the `'queue'`/`'plan'`-tree branch (keep an optional `tree` only if some test needs it — otherwise remove). In `status.ts:86` + `ai-capacity.ts:23` → `planFrontierAll` (repo-filter where the old code filtered). In `mcp/tools.ts` `foundry_next` → drop `source` + the `buildCascadeTree(FOUNDRY_PRODUCT)` arg. `sessionPrompts` needs no change (delegates to `nextItems`).

- [ ] **Step 6: Add the retirement guard test** — assert `nextItems(deps, n)` (no opts) returns `planFrontierAll`'s result (default IS the plan path); and a source-level assertion that no `src/` production module outside `plan/frontier.ts` calls `claimableItems` as a standalone driver (read the `src/` files for `claimableItems(` call sites and assert the expected set — only `frontier.ts` internal). This pins "the queue shadow is gone".

- [ ] **Step 7: Mutation check (prove the cross-product bite), then REVERT.** Temporarily make `planFrontierAll` compute each product's frontier against a state STRIPPED of other products' claims (break cross-product disjointness); confirm the CROSS-PRODUCT-conflict assertion goes RED; REVERT. Record it.

- [ ] **Step 8: Full suite green** (`npx vitest run`) — fix any test that passed `source:'queue'`/`'plan'` to the new shape (those are expected churn from retiring the param).

- [ ] **Step 9: Commit**

```bash
git add domains/foundry/src/plan/plan-frontier-all.ts domains/foundry/test/plan-frontier-all.acid.test.ts
git add -u domains/foundry/src/ops.ts domains/foundry/src/status.ts domains/foundry/src/ai-capacity.ts domains/foundry/src/mcp/tools.ts
git commit -m "feat(foundry): planFrontier is the sole driver — flip default + retire the queue shadow"
```

---

### Task 2: ADR-247 — doing-side unified, queue shadow retired (specs repo, designer-authored)

Drafted by `substrate-architect`; reviewed by `charter-checker` (COHERENT) + `spec-auditor`.

**Files:**
- Create: `layers/specs/adr/adr-247-foundry-doing-side-unified-queue-shadow-retired.md` (status `proposed`).
- Modify: `adr/adrs-by-tier.md` (+1 same tier as ADR-244/245/246) + `adr/README.md` index.

- [ ] **Step 1: Confirm 247 free** (`ls adr | grep adr-247` empty; 246 latest).
- [ ] **Step 2: Author** — records: the doing-side is unified; `planFrontier` (over `treeFromQueue`) is the SOLE conductor driver; the standalone `claimableItems` queue-shadow path is retired; `claimableItems` is retained ONLY as `planFrontier`'s internal rule (one claimability encoding preserved). `FOUNDRY_PRODUCT` remains the hand-authored meta-product exception. Realizes ADR-246's stated path. ADR-176 inclusion test NOT triggered (pack-level: retire a pack code path + repoint pack consumers). Cite ADR-246, ADR-244, ADR-127, ADR-176. Match the ADR-246 frontmatter/tier.
- [ ] **Step 3: Validate** (`node tools/validators/frontmatter-schema.mjs adr/adr-247-*.md`); spec-auditor clean.
- [ ] **Step 4: Commit** on `foundry-v1-adr-247`.

---

## Self-Review

**Spec coverage:** §2 Slice 2B (planFrontierAll + flip + repoint + retire source) → Task 1 steps 3/5. §4 acid test (behavior preservation real+active, cross-product bite, mutation, retirement guard, determinism) → Task 1 steps 1/4/6/7. §6 ADR-247 → Task 2. §exceptions (FOUNDRY_PRODUCT vestigial, foundry self-event-sourcing deferred) → noted, no task. No gaps.

**Placeholder scan:** `activeMultiProductFixture` is implementer-authored against the real envelope/state shapes (intentional fixture authoring). All file paths + the `planFrontierAll` signature + the assertions are concrete.

**Type consistency:** `planFrontierAll(state, nowMs)` used identically across impl/test/consumers. The exact `claimableItems` sort + item type are confirmed-by-reading-source (Task 1 interfaces). `nextItems`/`NextItemsOpts` edits described concretely.
