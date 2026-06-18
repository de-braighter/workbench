# Foundry v1 Stage 5 Slice 5A — Multi-Target Compiler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add a `CompileTarget<O>` interface + 2 targets (test-harness + presentation render-tree) that cast a `ProductBlueprint` to ≥2 faithful artifacts through one agnostic compiler, with the ADR-243 agnosticism gate. Additive; zero new kernel shapes.

**Architecture:** `src/compiler/` — `compile-target.ts` (the interface), `target-test-harness.ts` (foundry-pure validation), `target-render-tree.ts` (agnostic `PlanTree → RenderNode` projection, `RenderNode` type from `@de-braighter/design-system-core` per ADR-240). One acid test proves ≥2 targets + agnosticism + mutation + two-trees.

**Tech Stack:** TypeScript (ESM, `.js` extensions), vitest.

## Global Constraints

- **Zero kernel change + zero new kernel shapes.** Consume `PlanTree` (substrate-contracts), `RenderNode` (design-system-core, TYPE import — ADR-240), `ProductBlueprint` (foundry). NO presentation type in substrate-contracts.
- **Agnosticism (ADR-243):** `src/compiler/*.ts` import ONLY `@de-braighter/substrate-contracts/*`, `@de-braighter/design-system-core` (RenderNode type, target-render-tree only), `./blueprint` / `../metamodel/*` shared types, and relative `./*` — NEVER a domain/instance module (`instances/*`, a specific productKey literal). A structural import-boundary TEST enforces this.
- **ESM `.js` extensions.** No `git add -A` (foundry untracked `extract-vocabs.mjs`). Test cmd: `cd domains/foundry && npx vitest run`.
- **Determinism:** every `compile` is pure (no `Date.now()`).
- **Branches:** foundry → `v1-stage5-compiler`; specs → `foundry-v1-adr-250`.

---

### Task 1: `CompileTarget` + test-harness + render-tree targets + agnosticism gate + acid test (foundry repo)

**Files:**
- Create: `domains/foundry/src/compiler/compile-target.ts`, `domains/foundry/src/compiler/target-test-harness.ts`, `domains/foundry/src/compiler/target-render-tree.ts`
- Create: `domains/foundry/test/compiler.acid.test.ts`
- Modify: `domains/foundry/package.json` (add `@de-braighter/design-system-core` for the `RenderNode` type — Target B).

**Interfaces:**
- Consumes (READ first): `src/metamodel/blueprint.ts` (`ProductBlueprint`, `blueprintSubstance`), `src/plan/cascade.ts` / the `PlanTree`+`PlanNode` shape (id/kind/parentId/childrenIds/metadata), `src/instances/whales-product.ts` (WHALES round-trip fixture), `@de-braighter/design-system-core` (the `RenderNode<P>` type — read its shape: `{ id, kind, props, children }` or similar; confirm the exact field names).
- Produces:
  - `interface CompileTarget<O> { readonly name: string; compile(blueprint: ProductBlueprint): O }`
  - `testHarnessTarget: CompileTarget<TestHarnessReport>` where `TestHarnessReport = { passed: boolean; checks: { name: string; ok: boolean; detail?: string }[] }`
  - `renderTreeTarget: CompileTarget<RenderNode>` (the `PlanTree → RenderNode` agnostic projection)

- [ ] **Step 1: VERIFY the design-system-core dependency resolves (DE-RISK FIRST).** Add `@de-braighter/design-system-core` to `domains/foundry/package.json` deps (match the version the cluster publishes — check `layers/design-system`'s published version, e.g. `^2.2.0`), run the install (`npm install` or the repo's package manager), and confirm `import type { RenderNode } from '@de-braighter/design-system-core'` type-checks (read the package's exported `RenderNode` shape). **If the package is genuinely NOT resolvable** (not published / not workspace-linked), STOP and report — do NOT invent a workaround silently; the orchestrator will decide (fallback: a documented local structural `RenderNode` interface conforming to the ADR-240 design-system contract). Report which path you took.

- [ ] **Step 2: Write the failing acid test** (`test/compiler.acid.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { WHALES_PRODUCT } from '../src/instances/whales-product.js';
import { fold } from '../src/state.js';
import { extractBlueprint } from '../src/metamodel/blueprint.js';
import { testHarnessTarget } from '../src/compiler/target-test-harness.js';
import { renderTreeTarget } from '../src/compiler/target-render-tree.js';

function bpOf(spec, key) { return extractBlueprint(spec, fold([]), key); }
function edges(tree) { /* parent→child id pairs from a PlanTree or RenderNode tree, as a sorted set */ }

describe('multi-target compiler — cast a blueprint to ≥2 targets', () => {
  it('TARGET A (test-harness): a well-formed blueprint passes; checks reflect real structure', () => {
    const r = testHarnessTarget.compile(bpOf(WHALES_PRODUCT, 'whales-and-bubbles'));
    expect(r.passed).toBe(true);
    expect(r.checks.every(c => c.ok)).toBe(true);
    // a check whose value is derived from the real tree (e.g. work-item count) — assert it's right
  });

  it('TARGET B (render-tree): preserves PlanTree structure (node count + parentage + ids 1:1)', () => {
    const bp = bpOf(WHALES_PRODUCT, 'whales-and-bubbles');
    const render = renderTreeTarget.compile(bp);
    expect(countNodes(render)).toBe(bp.process.nodes.length);
    expect(edges(render)).toEqual(edges(bp.process));   // same parent→child graph
  });

  it('AGNOSTICISM: same generic compile for WHALES + FIXTURE (artifacts differ by data, not code)', () => {
    // compile both through the SAME targets; assert each faithful + the two render trees differ.
  });

  it('MUTATION → RED: a dangling dependsOn / dropped node makes harness fail + render-tree change', () => {
    // corrupt the blueprint; assert testHarness.passed===false with the violation AND render differs.
  });

  it('TWO-TREES (ADR-240): RenderNode is the design-system type, not a foundry/substrate-contracts type', () => {
    // structural assertion (import source) — see the import-boundary test below.
  });

  it('determinism: each compile twice → deep-equal', () => { /* ... */ });
});

describe('agnosticism import boundary (ADR-243)', () => {
  it('no src/compiler/*.ts imports a domain/instance module', () => {
    // read src/compiler/*.ts; assert every import is substrate-contracts / design-system-core /
    // ../metamodel|../plan shared types / relative ./*; NONE import ../instances/* or a productKey literal.
  });
});
```
(Author `edges`/`countNodes`/the FIXTURE + the mutation against real shapes.)

- [ ] **Step 3: Run → FAIL.**

- [ ] **Step 4: Implement the three compiler files.** `compile-target.ts` (the interface). `target-test-harness.ts` (the validation checks — pure, substrate-contracts only). `target-render-tree.ts` (the `PlanTree → RenderNode` projection — walk `bp.process.nodes`, map each to a `RenderNode {id, kind, props, children}` preserving the tree; import `type RenderNode` from design-system-core). All pure, agnostic.

- [ ] **Step 5: Run the acid test → PASS.** Fix impl (not assertions) until both targets are faithful + the import-boundary test passes.

- [ ] **Step 6: Mutation check (prove the bite), then REVERT.** Confirm the dangling-dep mutation makes Target A fail + Target B change; revert; record it.

- [ ] **Step 7: Full suite green** (`npx vitest run`) + typecheck clean (the new dep must not break the build).

- [ ] **Step 8: Commit**

```bash
git add domains/foundry/src/compiler/ domains/foundry/test/compiler.acid.test.ts
git add -u domains/foundry/package.json
git commit -m "feat(foundry): multi-target compiler — CompileTarget + test-harness + render-tree (Stage 5)"
```

---

### Task 2: ADR-250 — multi-target product compiler (specs repo, designer-authored)

Drafted by `substrate-architect`; reviewed by `charter-checker` (COHERENT) + `spec-auditor`.

**Files:**
- Create: `layers/specs/adr/adr-250-foundry-multi-target-product-compiler.md` (status `proposed`).
- Modify: `adr/adrs-by-tier.md` (+1 same tier as ADR-244..249) + `adr/README.md` index (next-free → 251).

- [ ] **Step 1: Confirm 250 free** (`ls adr | grep adr-250` empty; 249 latest).
- [ ] **Step 2: Author** — records: the multi-target product compiler completes the extract → generate → **compile** vision. A `CompileTarget<O>` interface + ≥2 targets cast a blueprint; the two-trees binding (`PlanTree → RenderNode`, ADR-239/240 — presentation type from design-system, NOT substrate-contracts); the agnosticism gate (ADR-243 — compiler imports no domain module; cross-blueprint genericity + structural import-boundary). ADR-176 NOT triggered (pack-level; consumes ratified PlanTree + design-system RenderNode + foundry ProductBlueprint; no new kernel shape; single consumer). External positioning N/A (internal-only). Cite ADR-248/249 (blueprint), ADR-239/240 (two-trees), ADR-243 (agnosticism), ADR-176. Match ADR-249 frontmatter/tier. **BODY LINT before commit:** code fences ```text, `-` bullets; `bash tools/lint-md.sh adr/adr-250-*.md` CLEAN.
- [ ] **Step 3: Validate** (`node tools/validators/frontmatter-schema.mjs adr/adr-250-*.md` + lint-md); spec-auditor clean.
- [ ] **Step 4: Commit** on `foundry-v1-adr-250`.

---

## Self-Review

**Spec coverage:** §2 Slice 5A (CompileTarget + 2 targets + agnosticism gate) → Task 1 steps 4. §4 acid test (≥2 faithful, agnosticism, mutation, two-trees, determinism) → Task 1 steps 2/5/6. §6 ADR-250 → Task 2. §deferred (browser-runtime, emission, android/PDF) → noted, no task. The design-system-core dep risk → Task 1 step 1 (verify-first, surface if infeasible). No gaps.

**Placeholder scan:** test helpers (`edges`, `countNodes`, FIXTURE, the mutation) are implementer-authored against real shapes. The interface + both target signatures + the import-boundary test are concrete. Step 1 names the dep risk explicitly (verify-first), not a hidden gap.

**Type consistency:** `CompileTarget<O>`, `testHarnessTarget: CompileTarget<TestHarnessReport>`, `renderTreeTarget: CompileTarget<RenderNode>` used identically in impl/test. `PlanTree`/`RenderNode`/`ProductBlueprint` confirmed-by-reading-source + the design-system-core package (Task 1 interfaces).
