# Foundry v1 Stage 4 Slice 4A — Blueprint Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add `blueprintToSpec(bp, newKey)` + `blueprintToEvents(spec, newKey)` + a thin `foundry_generate_from_blueprint` MCP tool, and prove `generate ∘ extract == identity` (a generated product re-expresses an existing one). Additive; zero new shapes.

**Architecture:** `blueprintToSpec` inverts `buildCascadeTree` (PlanTree → re-keyed CascadeNodeSpec[]); `blueprintToEvents` emits `ProductRegistered` + `WorkItemQueued` to instantiate it live; the MCP tool wires them to `queuePush`.

**Tech Stack:** TypeScript (ESM, `.js` extensions), vitest.

## Global Constraints

- **Zero kernel change + zero new shapes.** Reuse `CascadeNodeSpec`, `PlanTree`, `ProductBlueprint`, `ProductRegistered`/`WorkItemQueued` constructors. Do NOT introduce a `GenerationRequest`/`GenerationResult`/`ReKeyingRule` shape — return `spec[]` and `events[]` directly (or as a plain tuple).
- **ESM `.js` extensions.** No `git add -A` (foundry has untracked `extract-vocabs.mjs`). Test cmd: `cd domains/foundry && npx vitest run`.
- **Determinism:** `blueprintToSpec`/`blueprintToEvents` are pure (no `Date.now()` — events take a `ts` arg if needed; pass a fixed ts in tests).
- **The identity is THE gate:** `buildCascadeTree(blueprintToSpec(bp, k)) ≡ bp.process` (same key → exact). Do NOT weaken the round-trip assertion.
- **Branches:** foundry → `v1-stage4-blueprint-generation`; specs → `foundry-v1-adr-249`.

---

### Task 1: `blueprintToSpec` + `blueprintToEvents` + MCP tool + round-trip acid test (foundry repo)

**Files:**
- Create: `domains/foundry/src/metamodel/generate.ts`
- Create: `domains/foundry/test/blueprint-generation.acid.test.ts`
- Modify: `domains/foundry/src/mcp/tools.ts` (+ `src/mcp/server.ts` schema) — add `foundry_generate_from_blueprint`.

**Interfaces:**
- Consumes (READ first): `src/metamodel/blueprint.ts` (`ProductBlueprint`, `extractBlueprint`), `src/plan/cascade.ts` (`buildCascadeTree`, `CascadeNodeSpec` — the `{key, kind, parent, meta?, effects?}` shape), the `PlanTree`/`PlanNode` shape (id/parentId/kind/metadata/childrenIds/effectDeclarations — from substrate-contracts), `src/scope.ts` (the `uuidv5('cascade:'+key)` / id derivation, `FOUNDRY_TENANT_PACK_ID`), `src/events.ts` (`productRegistered`, `itemQueued` constructors + their payload fields), `src/ops.ts` (`queuePush(deps, product, items)`), `src/mcp/tools.ts` + `server.ts` (the `foundry_queue_push` tool pattern to mirror), `src/instances/whales-product.ts` (WHALES_PRODUCT — the round-trip fixture).
- Produces:
  - `blueprintToSpec(bp: ProductBlueprint, newKey: string): CascadeNodeSpec[]` — walk `bp.process.nodes`, emit one `CascadeNodeSpec` per node (`key` = the node's key re-derived under `newKey`; `kind`; `parent` = the parent node's re-keyed key or null; `meta` = node.metadata; `effects` = node.effectDeclarations). Re-key: the original productKey prefix in keys + work-item `itemId`s → `newKey`.
  - `blueprintToEvents(spec: CascadeNodeSpec[], newKey: string, ts?: string): (ReturnType<typeof productRegistered> | ReturnType<typeof itemQueued>)[]` — one `productRegistered` (from the product-root node + its scope/repo) + one `itemQueued` per work-item node (itemId/scope/dependsOn/title/qualityObligations from node.meta).
  - MCP `foundry_generate_from_blueprint({ blueprint, newKey })` → `blueprintToSpec` → `blueprintToEvents` → `queuePush` (emit). Returns `{ productRegistered, queued }` like `foundry_queue_push`.

- [ ] **Step 1: Write the failing round-trip acid test** (`test/blueprint-generation.acid.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { WHALES_PRODUCT } from '../src/instances/whales-product.js';
import { fold } from '../src/state.js';
import { buildCascadeTree } from '../src/plan/cascade.js';
import { extractBlueprint } from '../src/metamodel/blueprint.js';
import { blueprintToSpec, blueprintToEvents } from '../src/metamodel/generate.js';

const NOW = '2026-06-18T00:00:00.000Z';

function roundTrip(spec, doneIds, key) {
  const bp = extractBlueprint(spec, stateWithDone(doneIds), key);     // Stage-3 extractor
  const spec2 = blueprintToSpec(bp, key);                              // INVERSE
  const events = blueprintToEvents(spec2, key, NOW);
  const state2 = fold(events);
  const bp2 = extractBlueprint(spec2, state2, key);
  return { bp, bp2 };
}

describe('generate ∘ extract == identity', () => {
  it('SAME-KEY round-trip (exact): re-generated process deep-equals the source', () => {
    const { bp, bp2 } = roundTrip(WHALES_PRODUCT, ['whales/E1','whales/E3'], 'whales-and-bubbles');
    expect(bp2.process).toEqual(bp.process);   // same key → same uuidv5 ids → exact
    expect(bp2.done).toEqual([]);              // freshly generated → nothing merged
    // and buildCascadeTree(blueprintToSpec(bp,key)) ≡ bp.process directly:
    expect(buildCascadeTree(blueprintToSpec(bp, 'whales-and-bubbles'))).toEqual(bp.process);
  });

  it('NEW-KEY generation: re-expresses a distinct product (structurally isomorphic)', () => {
    const bp = extractBlueprint(WHALES_PRODUCT, stateWithDone([]), 'whales-and-bubbles');
    const cloneProcess = buildCascadeTree(blueprintToSpec(bp, 'whales-clone'));
    // re-key bp.process to 'whales-clone' and deep-equal, OR structural compare (same node count/kinds/
    // parent-structure/metadata-minus-key-derived/yields). The clone is a DISTINCT product (different ids).
    expect(reKeyProcess(bp.process, 'whales-and-bubbles', 'whales-clone')).toEqual(cloneProcess);
    expect(cloneProcess.treeRootId).not.toEqual(bp.process.treeRootId); // genuinely distinct
  });

  it('GENERICITY: same generic functions for WHALES + FIXTURE (no product-specific branch)', () => {
    // round-trip both; assert each reconstructs ITS OWN source + the two produce different specs.
  });

  it('MUTATION → RED (guard): a node-dropping blueprintToSpec diverges from bp.process', () => {
    // build a "lossy" spec (drop one work-item node) and assert buildCascadeTree(lossy) != bp.process
  });

  it('builds valid: blueprintToEvents output folds without throwing + queues all items', () => { /* ... */ });
});
```
(Author `stateWithDone`, `reKeyProcess`, the FIXTURE_PRODUCT against real shapes. Confirm WHALES itemIds = `whales/E*`.)

- [ ] **Step 2: Run → FAIL** (`npx vitest run test/blueprint-generation.acid.test.ts`).

- [ ] **Step 3: Implement `generate.ts`** — `blueprintToSpec` (PlanTree walk → re-keyed CascadeNodeSpec[]; map each node's id back to its key via the metadata or by inverting the parent structure — note buildCascadeTree derives id from key, so blueprintToSpec must recover the key: if the PlanNode metadata carries the original key/itemId, use it; else reconstruct from the productKey + the node's position. READ buildCascadeTree to see what's preserved). `blueprintToEvents` (productRegistered + itemQueued per work-item). PURE.

- [ ] **Step 4: Run the acid test → PASS.** Fix the impl (not the assertions) until the same-key round-trip is EXACT. If the PlanNode doesn't preserve the original key (only the uuidv5 id), `blueprintToSpec` must carry the key in metadata at extraction time OR reconstruct it — resolve this faithfully (it's the crux of round-trippability; if the key isn't recoverable, that's a real finding — surface it).

- [ ] **Step 5: Add the MCP tool** `foundry_generate_from_blueprint` (tools.ts + server.ts schema) wiring blueprintToSpec → blueprintToEvents → queuePush. Add a small test that the tool emits the right events / returns `{ productRegistered, queued }`.

- [ ] **Step 6: Mutation check (prove the bite), then REVERT.** Confirm the node-dropping mutation makes the round-trip assertion RED; revert; record it.

- [ ] **Step 7: Full suite green** (`npx vitest run`).

- [ ] **Step 8: Commit**

```bash
git add domains/foundry/src/metamodel/generate.ts domains/foundry/test/blueprint-generation.acid.test.ts
git add -u domains/foundry/src/mcp/tools.ts domains/foundry/src/mcp/server.ts
git commit -m "feat(foundry): blueprint generation — blueprintToSpec/Events + generate∘extract identity"
```

---

### Task 2: ADR-249 — blueprint generation (the inverse) (specs repo, designer-authored)

Drafted by `substrate-architect`; reviewed by `charter-checker` (COHERENT) + `spec-auditor`.

**Files:**
- Create: `layers/specs/adr/adr-249-foundry-blueprint-generation.md` (status `proposed`).
- Modify: `adr/adrs-by-tier.md` (+1 same tier as ADR-244..248) + `adr/README.md` index (next-free → 250).

- [ ] **Step 1: Confirm 249 free** (`ls adr | grep adr-249` empty; 248 latest).
- [ ] **Step 2: Author** — records: blueprint GENERATION is the inverse of extraction — `blueprintToSpec` faithfully inverts `buildCascadeTree`, `blueprintToEvents` instantiates the product via the existing `ProductRegistered`/`WorkItemQueued` events; `generate ∘ extract == identity` (modulo product key). Completes the extract↔generate pivot (Stage 5 compiles). ADR-176 NOT triggered (pack-level; reuses ratified PlanTree + existing pack events + CascadeNodeSpec/ProductBlueprint; explicitly NO new wrapper shapes; single consumer). Cite ADR-248 (extraction), ADR-244 (plan-tree), ADR-127, ADR-176. Match ADR-248 frontmatter/tier. **BODY LINT before commit:** tag code fences ```text, use `-` bullets; run `bash tools/lint-md.sh adr/adr-249-*.md` — must be CLEAN.
- [ ] **Step 3: Validate** (`node tools/validators/frontmatter-schema.mjs adr/adr-249-*.md` + lint-md); spec-auditor clean.
- [ ] **Step 4: Commit** on `foundry-v1-adr-249`.

---

## Self-Review

**Spec coverage:** §2 Slice 4A (blueprintToSpec + blueprintToEvents + MCP tool) → Task 1 steps 3/5. §4 acid test (same-key exact, new-key, mutation, genericity, builds-green) → Task 1 steps 1/4/6. §6 ADR-249 → Task 2. §deferred (new-domain, yields-in-log) → noted, no task. No gaps.

**Placeholder scan:** test helpers (`stateWithDone`, `reKeyProcess`, FIXTURE_PRODUCT) are implementer-authored against real shapes. The three function signatures + the MCP tool are concrete. Step 4 names the key-recoverability crux explicitly as a thing to resolve/surface (not a hidden gap).

**Type consistency:** `blueprintToSpec(bp, newKey): CascadeNodeSpec[]`, `blueprintToEvents(spec, newKey, ts?)`, the MCP tool used identically in impl/test. `CascadeNodeSpec`/`PlanTree`/`ProductBlueprint`/event constructors confirmed-by-reading-source (Task 1 interfaces).
