# Foundry v1 Stage 3 Slice 3A — Blueprint Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add `ProductBlueprint = { productKey, process: PlanTree, done: string[] }` + `extractBlueprint(spec, state, productKey)` + derived views (`blueprintSubstance`, `blueprintCompleteness`), and prove round-trip reconstruction generically (≥2 products). Additive; zero new kernel shapes; substance stays derived.

**Architecture:** The blueprint stores generators (the authored process tree + the log-derived done-set); substance + completeness are derived views. `extractBlueprint` reads the authored `CascadeNodeSpec` (structure + yields) and the live `DerivedState` (the done itemIds).

**Tech Stack:** TypeScript (ESM, `.js` extensions), vitest.

## Global Constraints

- **Zero kernel change.** No `@de-braighter/substrate-*` edits. `ProductBlueprint` is a pack-lib interface over the ratified `PlanTree` + `string[]`.
- **Substance stays DERIVED (ADR-242).** Do NOT store substance/completeness in the blueprint — derive them via `blueprintSubstance`/`blueprintCompleteness`.
- **ESM `.js` extensions.** No `git add -A` (foundry has untracked `extract-vocabs.mjs`). Test cmd: `cd domains/foundry && npx vitest run`.
- **Determinism:** `extractBlueprint` is pure (no `Date.now()`); substance dedup is order-independent set equality by `(kind,id)`.
- **Branches:** foundry → `v1-stage3-blueprint-extraction`; specs → `foundry-v1-adr-248`.

---

### Task 1: `ProductBlueprint` + `extractBlueprint` + derived views + round-trip acid test (foundry repo)

**Files:**
- Create: `domains/foundry/src/metamodel/blueprint.ts`
- Create: `domains/foundry/test/blueprint-extraction.acid.test.ts`

**Interfaces:**
- Consumes (READ first): `src/metamodel/substance.ts` (`deriveSubstance`, `completeness`, `SubstanceRef`, `SubstanceKind`, the `wis`/`uniq` helpers, `CascadeNodeSpec`, `WorkItemMeta` w/ `yields`/`status`/`itemId`), `src/plan/cascade.ts` (`buildCascadeTree(spec): PlanTree`, `CascadeNodeSpec`), `src/state.ts` (`fold`, `DerivedState`, the per-item `merged`/done flag — how to tell an itemId is done from the log), `src/instances/whales-product.ts` (`WHALES_PRODUCT` — a real yield-bearing spec; confirm its work-item `itemId`s match the log's `whales-and-bubbles/E*` ids), `src/log.ts` (`readEnvelopes`).
- Produces:
  - `interface ProductBlueprint { productKey: string; process: PlanTree; done: string[] }`
  - `extractBlueprint(spec: CascadeNodeSpec[], state: DerivedState, productKey: string): ProductBlueprint`
  - `blueprintSubstance(bp: ProductBlueprint): SubstanceRef[]` (⋃ yields of process work-items whose itemId ∈ bp.done; dedup by (kind,id))
  - `blueprintCompleteness(bp: ProductBlueprint): { landed: number; declared: number; pct: number }`

- [ ] **Step 1: Write the failing acid test** (`test/blueprint-extraction.acid.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { WHALES_PRODUCT } from '../src/instances/whales-product.js';
import { fold } from '../src/state.js';
import { deriveSubstance } from '../src/metamodel/substance.js';
import { buildCascadeTree } from '../src/plan/cascade.js';
import { extractBlueprint, blueprintSubstance, blueprintCompleteness } from '../src/metamodel/blueprint.js';

// helper: build a DerivedState whose done-set = a chosen set of itemIds (author WorkItemQueued + MergeRecorded).
// helper: an independently-authored FIXTURE_PRODUCT (CascadeNodeSpec[]) with yields on items + a MIXED done-set.

function roundTrips(spec, state, productKey) {
  const bp = extractBlueprint(spec, state, productKey);
  const bp2 = JSON.parse(JSON.stringify(bp));                 // plain-data proof
  expect(bp2.process).toEqual(buildCascadeTree(spec));        // process lossless
  // substance derived from the round-tripped blueprint == directly derived over the SAME done-set
  const directDone = deriveSubstanceForDone(spec, bp.done);   // ⋃ yields of spec work-items in bp.done
  expect(setOf(blueprintSubstance(bp2))).toEqual(setOf(directDone));
  return bp2;
}

describe('blueprint extraction round-trips generically', () => {
  it('WHALES (shipped, all done): substance + process reconstruct losslessly', () => {
    const state = stateWithDone(/* all whales E1..E6 merged */);
    roundTrips(WHALES_PRODUCT, state, 'whales-and-bubbles');
  });

  it('FIXTURE (mixed done): non-trivial completeness reconstructs', () => {
    const state = stateWithDone(/* a subset of fixture items merged */);
    const bp = roundTrips(FIXTURE_PRODUCT, state, 'fixture-product');
    const c = blueprintCompleteness(bp);
    expect(c.declared).toBeGreaterThan(0);
    expect(c.landed).toBeLessThan(c.declared);                 // genuinely partial
    expect(c.pct).toBeCloseTo(c.landed / c.declared);
  });

  it('GENERICITY: same code path for both products (no product-specific branch)', () => {
    // both above run through the SAME extractBlueprint/blueprintSubstance — assert by construction
    // (e.g. extract both and assert the functions referenced are identical / no per-key switch).
  });

  it('NEGATIVE CONTROL: a yield-less product → empty substance, pct 0 (no divide-by-zero)', () => {
    const bp = extractBlueprint(YIELDLESS_FIXTURE, stateWithDone(/* some done */), 'yieldless');
    expect(blueprintSubstance(bp)).toEqual([]);
    expect(blueprintCompleteness(bp).pct).toBe(0);
  });

  it('determinism', () => {
    const state = stateWithDone(/* fixed */);
    expect(extractBlueprint(FIXTURE_PRODUCT, state, 'fixture-product'))
      .toEqual(extractBlueprint(FIXTURE_PRODUCT, state, 'fixture-product'));
  });
});
```
(Author `stateWithDone`, `deriveSubstanceForDone`, `setOf`, `FIXTURE_PRODUCT`, `YIELDLESS_FIXTURE` against the real shapes. Confirm `WHALES_PRODUCT`'s item ids match the log ids.)

- [ ] **Step 2: Run → FAIL** (`npx vitest run test/blueprint-extraction.acid.test.ts`) — module not found.

- [ ] **Step 3: Implement `blueprint.ts`** — `ProductBlueprint`, `extractBlueprint` (process = `buildCascadeTree(spec)`; done = spec work-item itemIds that are done in `state`), `blueprintSubstance` (⋃ yields of work-items whose itemId ∈ done, dedup by (kind,id) — reuse substance.ts helpers), `blueprintCompleteness` (landed = blueprintSubstance length; declared = ⋃ all yields length; pct = declared===0 ? 0 : landed/declared). Pure.

- [ ] **Step 4: Run the acid test → PASS.** Fix the impl (not the assertions) until round-trip + completeness hold. If WHALES item ids don't match the log ids, fix `extractBlueprint`'s matching (or note the id convention).

- [ ] **Step 5: Mutation check (prove the bite), then REVERT.** Temporarily drop a yield from a done work-item before extraction (or remove an itemId from the extracted `bp.done`); confirm the round-trip substance-equality assertion goes RED; REVERT; record it.

- [ ] **Step 6: Full suite green** (`npx vitest run`) — additive, nothing else changes.

- [ ] **Step 7: Commit**

```bash
git add domains/foundry/src/metamodel/blueprint.ts domains/foundry/test/blueprint-extraction.acid.test.ts
git commit -m "feat(foundry): extractBlueprint — serializable product blueprint + round-trip acid test"
```

---

### Task 2: ADR-248 — the product blueprint (extract/generate/compile pivot) (specs repo, designer-authored)

Drafted by `substrate-architect`; reviewed by `charter-checker` (COHERENT) + `spec-auditor`.

**Files:**
- Create: `layers/specs/adr/adr-248-foundry-product-blueprint-extraction.md` (status `proposed`).
- Modify: `adr/adrs-by-tier.md` (+1 same tier as ADR-244..247) + `adr/README.md` index (next-free → 249).

- [ ] **Step 1: Confirm 248 free** (`ls adr | grep adr-248` empty; 247 latest).
- [ ] **Step 2: Author** — records: a product **blueprint** = serializable `{ process: PlanTree, done: itemId[] }` extracted from the running foundry (authored process + log-derived done-set); substance + completeness are DERIVED projections (ADR-242 upheld — never stored). The blueprint is the extract → generate (Stage 4) → compile (Stage 5) pivot. Deferred: yields-in-log for log-only/generated-product extraction. ADR-176 NOT triggered (pack-lib interface over the ratified PlanTree; pack-level derivation; single consumer). Cite ADR-242, ADR-244, ADR-127, ADR-176. Match ADR-247 frontmatter/tier. **Run `bash tools/lint-md.sh adr/adr-248-*.md` before commit — tag code fences ```text, use `-` bullets (not `+`), to pass the body-lint gate.**
- [ ] **Step 3: Validate** (`node tools/validators/frontmatter-schema.mjs adr/adr-248-*.md` + the lint-md gate); spec-auditor clean.
- [ ] **Step 4: Commit** on `foundry-v1-adr-248`.

---

## Self-Review

**Spec coverage:** §2 Slice 3A (ProductBlueprint + extractBlueprint + derived views) → Task 1 steps 3. §4 acid test (round-trip losslessness, genericity, mutation, negative control, determinism) → Task 1 steps 1/4/5. §6 ADR-248 → Task 2. §deferred (yields-in-log, hierarchical-vs-flat) → noted, no task. No gaps.

**Placeholder scan:** the test helpers + fixtures (`stateWithDone`, `FIXTURE_PRODUCT`, `YIELDLESS_FIXTURE`, `deriveSubstanceForDone`, `setOf`) are implementer-authored against real shapes (intentional fixture authoring). The `ProductBlueprint` shape + the four function signatures are concrete.

**Type consistency:** `extractBlueprint(spec, state, productKey): ProductBlueprint`, `blueprintSubstance(bp): SubstanceRef[]`, `blueprintCompleteness(bp): {landed,declared,pct}` used identically in impl/test/interfaces. `SubstanceRef`/`CascadeNodeSpec`/`PlanTree`/`DerivedState` confirmed-by-reading-source (Task 1 interfaces).
