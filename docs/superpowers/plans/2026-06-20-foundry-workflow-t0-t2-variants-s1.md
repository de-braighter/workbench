# T0/T2 Foundry-Workflow Variants — S1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two sibling workflow variants — a lighter `T0_WORKFLOW` and a heavier `T2_WORKFLOW` — plus a `riskTier → variant` selector (resolve-or-default), as pack data + pack code in `domains/foundry`, with ZERO kernel change.

**Architecture:** A new pack module `src/instances/workflow-variants.ts` holds the two `CascadeNodeSpec[]` specs (built from the existing `dependsOn` / `founderGated` / `metadata.action` / `effects` vocabulary), a `ReadonlyMap<RiskTier, CascadeNodeSpec[]>` (mirroring the `CompileTarget` registry), and `selectWorkflowVariant(tier)` which resolves to the variant or DEFAULTS to today's `FOUNDRY_WORKFLOW`. Nothing is wired into the conductor/cockpit (that is S3) — this slice is define + select + prove, falsified by acids over the existing `buildCascadeTree` / `workflowTree` / `planFrontier` machinery.

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), vitest, `@de-braighter/substrate-contracts` (`PlanTreeSchema`, `EffectDeclaration`).

**Design doc:** `docs/superpowers/specs/2026-06-20-foundry-workflow-t0-t2-variants-design.md` (in the workbench). This plan covers the design's **S1 + S2** (specs + selector) as ONE reviewable PR; S3 (per-product wiring) is a separate plan/ADR.

**Working tree:** Implement in the **`domains/foundry`** clone (the sibling repo), on a feature branch (e.g. `feat-workflow-t0-t2-variants`). Do NOT use `isolation: worktree` for any foundry-branch verifier/opus agents — that worktrees the *workbench*, where the sibling clone is empty; run them in the `domains/foundry` clone directly.

## Global Constraints

- **ZERO kernel change.** Touch ONLY `domains/foundry/src/instances/workflow-variants.ts` (new) + `domains/foundry/test/workflow-variants.acid.test.ts` (new). No edits to `substrate-contracts`, the kernel, the conductor, the cockpit, the frontier, or `FOUNDRY_WORKFLOW`.
- **Selector is resolve-or-DEFAULT, NEVER resolve-or-throw.** `selectWorkflowVariant` returns `WORKFLOW_VARIANTS.get(tier) ?? FOUNDRY_WORKFLOW`. An unmapped tier (T1 or unknown) MUST yield a real pipeline — "no workflow" would silently skip every founder gate (governance violation). Contrast `compile()`/`actuate()` which DO throw on unknown — there an unknown is a bug; here T1 is the common case.
- **Governance held structurally.** `T0_WORKFLOW` KEEPS exactly ONE `founderGated` stage (`stage-gate-greenlight`); `T2_WORKFLOW` has exactly TWO (`stage-gate-greenlight` + `stage-compliance-gate`). Lightness = fewer automation stages, never fewer gates. No tier auto-greenlights in this slice.
- **Risk tiers** are `RISK_TIERS = ['T0','T1','T2']` (`src/events.ts:39`); `RiskTier` is the union.
- **ESM imports** use explicit `.js` extensions on relative paths (the foundry convention).
- **Stage-key convention:** all variants reuse the `stage-*` convention; uniqueness across concurrent instances comes from the S3 per-instance namespace, not the stage keys. Each variant's stages have unique keys *within* the variant.
- **Gate:** `npm run ci:local` (= `npm run typecheck && npm run test:coverage`) must pass. Never bypass pre-push hooks.

---

### Task 1: Scaffold the variant module + the light `T0_WORKFLOW`

**Files:**
- Create: `domains/foundry/src/instances/workflow-variants.ts`
- Test: `domains/foundry/test/workflow-variants.acid.test.ts`

**Interfaces:**
- Consumes: `CascadeNodeSpec` (`src/plan/cascade.ts:21`), `buildCascadeTree` (`src/plan/cascade.ts:24`), `extractBlueprint(spec, state, productKey)` (`src/metamodel/blueprint.ts`), `fold` (`src/state.ts`), `uuidv5` (`src/scope.ts`), `RiskTier` (`src/events.ts`), `EffectDeclaration` + `PlanTreeSchema` (`@de-braighter/substrate-contracts/plan-tree`).
- Produces: `export const T0_WORKFLOW: CascadeNodeSpec[]` — root `foundry-workflow-t0` + 4 stages (`stage-intake`, `stage-gate-greenlight` [founderGated, `action: 'reprioritize-product'`, `effects`], `stage-build-path` [`action: 'build-path'`], `stage-ship`).

- [ ] **Step 1: Write the failing test** — `domains/foundry/test/workflow-variants.acid.test.ts`

```ts
// ACID tests for the deferred workflow-as-first-class follow-up: T0/T2 WORKFLOW
// VARIANTS. Each variant is a sibling CascadeNodeSpec[] reusing the ladder machinery;
// the selector maps riskTier → variant (resolve-or-default). ZERO kernel change.
// ALL fixtures use TEMP logs — NEVER the live canonical log.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { append, readEnvelopes } from '../src/log.js';
import { claim, release, type FoundryDeps } from '../src/ops.js';
import { fold } from '../src/state.js';
import { PlanTreeSchema } from '@de-braighter/substrate-contracts/plan-tree';
import { buildCascadeTree, type CascadeNodeSpec } from '../src/plan/cascade.js';
import { planFrontier } from '../src/plan/frontier.js';
import { workflowTree, workflowBootstrapEvents } from '../src/plan/workflow-frontier.js';
import { FOUNDRY_WORKFLOW } from '../src/instances/foundry-workflow.js';
import {
  T0_WORKFLOW, T2_WORKFLOW, WORKFLOW_VARIANTS, selectWorkflowVariant,
} from '../src/instances/workflow-variants.js';

const TS = '2026-06-20T12:00:00.000Z';
const NOW = Date.parse(TS);

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
});

function tempDeps(): FoundryDeps {
  const dir = mkdtempSync(join(tmpdir(), 'foundry-workflow-variants-'));
  tmpDirs.push(dir);
  let n = 0;
  return { dataDir: dir, logPath: join(dir, 'events.jsonl'), now: () => TS, newId: () => `id-${++n}` };
}

const stagesOf = (spec: CascadeNodeSpec[]) => spec.filter((n) => n.kind === 'stage');
const founderGatesOf = (spec: CascadeNodeSpec[]) =>
  stagesOf(spec).filter((s) => (s.meta as Record<string, unknown> | undefined)?.['founderGated'] === true);

/** Bootstrap a VARIANT's stages into a temp log (mirrors bootstrapWorkflow for an
 *  arbitrary spec — workflowBootstrapEvents queues each stage's work-item). */
function bootstrapVariant(deps: FoundryDeps, spec: CascadeNodeSpec[]): void {
  for (const e of workflowBootstrapEvents(fold([]), TS, spec)) append(e, deps.logPath);
}

/** The variant's READY frontier itemIds, projected via workflowTree(spec). */
function variantFrontier(deps: FoundryDeps, spec: CascadeNodeSpec[]): string[] {
  return planFrontier(workflowTree(spec), fold(readEnvelopes(deps.logPath)), NOW).map((i) => i.itemId);
}

/** Mark a stage done via the EXISTING done-event (claim → release outcome:'done'). */
function completeStage(deps: FoundryDeps, stageKey: string): void {
  const c = claim(deps, { itemId: stageKey, sessionId: `sess-${stageKey}` });
  release(deps, { claimId: c.claimId, outcome: 'done', prRef: `pr/${stageKey}` });
}

const nodeByKey = (tree: ReturnType<typeof buildCascadeTree>, key: string) =>
  tree.nodes.find((n) => (n.metadata as Record<string, unknown>)['_cascadeKey'] === key)!;

function assertValidSingleParentTree(spec: CascadeNodeSpec[]): void {
  const tree = buildCascadeTree(spec); // throws if PlanTreeSchema rejects
  expect(() => PlanTreeSchema.parse(tree)).not.toThrow();
  // exactly one root.
  expect(tree.nodes.filter((n) => n.parentId === null).length).toBe(1);
  // every stage is a SIBLING under the root (single non-null parent === the root).
  const root = tree.nodes.find((n) => n.parentId === null)!;
  for (const s of stagesOf(spec)) {
    expect(nodeByKey(tree, s.key).parentId).toBe(root.id);
  }
}

// ---- ACID 1: each variant builds to a valid single-parent PlanTree ---------------
describe('workflow-variants — ACID 1: each variant is a valid single-parent PlanTree', () => {
  it('T0_WORKFLOW builds to a kernel-valid single-parent PlanTree (flat fan-out)', () => {
    assertValidSingleParentTree(T0_WORKFLOW);
  });
});

// ---- ACID 2: governance — exact founder-gate + stage counts ----------------------
describe('workflow-variants — ACID 2: governance shape (founder-gate counts are exact)', () => {
  it('T0 (light) has EXACTLY ONE founder gate — lightness never drops the gate', () => {
    const gates = founderGatesOf(T0_WORKFLOW);
    expect(gates.length).toBe(1);
    expect(gates[0]!.key).toBe('stage-gate-greenlight');
  });
  it('T0 has 4 stages (the light contrast)', () => {
    expect(stagesOf(T0_WORKFLOW).length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `domains/foundry`): `npx vitest run test/workflow-variants.acid.test.ts`
Expected: FAIL — `Cannot find module '../src/instances/workflow-variants.js'` (the module + exports don't exist yet). `T2_WORKFLOW` / `WORKFLOW_VARIANTS` / `selectWorkflowVariant` imports are also unresolved; that is expected — later tasks add them.

- [ ] **Step 3: Write minimal implementation** — `domains/foundry/src/instances/workflow-variants.ts`

```ts
// T0/T2 workflow VARIANTS — the foundry WORKFLOW (the HOW pipeline) parameterized per
// RISK TIER. Sibling CascadeNodeSpec[] to FOUNDRY_WORKFLOW (the T1/default), reusing the
// EXISTING ladder machinery (dependsOn/founderGated/metadata.action + buildCascadeTree +
// workflowTree/workflowFrontier). A LIGHTER pipeline for a T0 product (game/throwaway,
// e.g. whales-and-bubbles); a HEAVIER one for a T2 product (regulated medical device,
// the oncology north-star). ZERO kernel change — the specs are pack DATA, the registry +
// selector are pack CODE, riskTier is the existing ProductRegistered field. ADR-176
// pack-level (both inclusion-test legs fail — the P7 precedent applied again).
//
// GOVERNANCE: "light" means FEWER automation/review stages, NEVER fewer founder gates.
// T0 KEEPS its greenlight gate founderGated (1 gate); T2 adds a SECOND founder gate
// (compliance) + a clinical-safety lane (2 gates). The selector is resolve-or-DEFAULT
// (never resolve-or-throw): an unmapped/T1 tier falls back to FOUNDRY_WORKFLOW, never to
// "no workflow" (which would silently skip every founder gate).
import type { CascadeNodeSpec } from '../plan/cascade.js';
import type { EffectDeclaration } from '@de-braighter/substrate-contracts/plan-tree';
import type { RiskTier } from '../events.js';
import { uuidv5 } from '../scope.js';
import { extractBlueprint } from '../metamodel/blueprint.js';
import { fold } from '../state.js';
import { FOUNDRY_WORKFLOW } from './foundry-workflow.js';

// A tier-flavored sample product the build-path stage spawns when actuated — the S1
// DEMONSTRATOR shape, mirroring FOUNDRY_WORKFLOW's SAMPLE_BLUEPRINT (foundry-workflow.ts).
// Per-product build-path semantics (advance the registered product vs spawn a sample) is
// an S3 question (design doc OQ-D); S1 keeps the self-contained spawn so each variant
// builds to a valid, self-contained tree.
function sampleBlueprint(key: string, riskTier: RiskTier) {
  const spec: CascadeNodeSpec[] = [
    { key, kind: 'product', parent: null, meta: { title: `Sample ${riskTier} path`, repo: 'de-braighter/foundry', riskTier, productKey: key } },
    { key: `${key}/cap`, kind: 'capability', parent: key, meta: { title: 'Core' } },
    {
      key: `${key}/wi-1`, kind: 'work-item', parent: `${key}/cap`,
      meta: { title: 'Scaffold', itemId: `${key}/S1`, scope: { repo: 'de-braighter/foundry' }, yields: [{ kind: 'pack', id: `${key}-scaffold` }] },
    },
  ];
  return extractBlueprint(spec, fold([]), key);
}

// A representative declared effect on a variant's greenlight gate — the declaration ⊥
// actuation proof (ADR-263 D4): the gate both DECLARES a cycle-time effect AND ACTUATES
// the reprioritize action; the two ride independent fields and never interact.
function greenlightEffect(slug: string): EffectDeclaration[] {
  return [{
    declarationId: uuidv5(`effect:${slug}`),
    indicatorId: 'cycle-time',
    direction: '-',
    magnitudePrior: { kind: 'normal', mean: -2, sd: 1 },
    confidence: 0.5,
    horizon: 'P0D',
    compositionOperator: 'sum',
    commutative: true,
    basis: 'expert',
    declaredAt: '2026-06-20T00:00:00.000Z',
  }];
}

const T0_SAMPLE_KEY = 'sample-path-t0';

// ---- T0_WORKFLOW (light): intake → gate-greenlight 🔒 → build-path → ship ---------
// 4 stages, 1 founder gate. A game/throwaway: greenlight, build, ship. Drops
// opportunity-brief / charter / conduct / review — but KEEPS the founder gate.
export const T0_WORKFLOW: CascadeNodeSpec[] = [
  { key: 'foundry-workflow-t0', kind: 'product', parent: null, meta: { productKey: 'foundry', title: 'Foundry pipeline (T0 — light)', riskTier: 'T0' } },
  { key: 'stage-intake', kind: 'stage', parent: 'foundry-workflow-t0', meta: { title: 'Intake — capture founder inputs', dependsOn: [] } },
  {
    key: 'stage-gate-greenlight', kind: 'stage', parent: 'foundry-workflow-t0',
    meta: {
      title: 'Greenlight gate — prioritise the product',
      dependsOn: ['stage-intake'],
      founderGated: true,                                  // GOVERNANCE: kept even for T0.
      action: 'reprioritize-product',
      actionArgs: { productKey: 'foundry', priority: 500 },
    },
    effects: greenlightEffect('t0-workflow-greenlight-cycle-time'),
  },
  {
    key: 'stage-build-path', kind: 'stage', parent: 'foundry-workflow-t0',
    meta: { title: 'Build path — spawn the product tree from a blueprint', dependsOn: ['stage-gate-greenlight'], action: 'build-path', actionArgs: { blueprint: sampleBlueprint(T0_SAMPLE_KEY, 'T0'), newKey: T0_SAMPLE_KEY } },
  },
  { key: 'stage-ship', kind: 'stage', parent: 'foundry-workflow-t0', meta: { title: 'Ship — release the product', dependsOn: ['stage-build-path'] } },
];
```

> Note: this step leaves `T2_WORKFLOW` / `WORKFLOW_VARIANTS` / `selectWorkflowVariant` still unexported (added in Tasks 2–3). The test file imports them, so vitest will still error on those names until Task 3. To keep Task 1 self-contained-green, temporarily comment the `T2_WORKFLOW, WORKFLOW_VARIANTS, selectWorkflowVariant` import + the ACID-2-`T2`/ACID-5 blocks, OR (preferred) implement Tasks 1–3 before the first full run. The clean path: write all three production exports (Tasks 1–3 Step 3) before running the whole suite. If executing strictly task-by-task, stub `export const T2_WORKFLOW: CascadeNodeSpec[] = [];` etc. is NOT allowed (it would mask Task 2) — instead comment the not-yet-written imports/blocks and uncomment as you go.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/workflow-variants.acid.test.ts -t "ACID 1|ACID 2"` (with the T2/selector imports+blocks commented out)
Expected: PASS (T0 builds to a valid single-parent tree with exactly 1 founder gate, 4 stages).

- [ ] **Step 5: Commit**

```bash
git add src/instances/workflow-variants.ts test/workflow-variants.acid.test.ts
git commit -m "feat(workflow-variants): T0_WORKFLOW (light, 1 founder gate) + valid-tree/gate acids"
```

---

### Task 2: Add the heavy `T2_WORKFLOW`

**Files:**
- Modify: `domains/foundry/src/instances/workflow-variants.ts`
- Test: `domains/foundry/test/workflow-variants.acid.test.ts`

**Interfaces:**
- Produces: `export const T2_WORKFLOW: CascadeNodeSpec[]` — root `foundry-workflow-t2` + 10 stages: `stage-intake`, `stage-opportunity-brief`, `stage-gate-greenlight` [founderGated, action, effects], `stage-charter`, `stage-build-path` [action], `stage-conduct`, `stage-review`, `stage-compliance-gate` [founderGated], `stage-clinical-safety`, `stage-ship`.

- [ ] **Step 1: Write the failing test** — append to `test/workflow-variants.acid.test.ts` (and re-enable the ACID-1/ACID-2 `T2` cases)

```ts
// (ACID 1, append the T2 case)
describe('workflow-variants — ACID 1b: the heavy T2 variant is a valid single-parent PlanTree', () => {
  it('T2_WORKFLOW builds to a kernel-valid single-parent PlanTree (flat fan-out, 10 siblings)', () => {
    assertValidSingleParentTree(T2_WORKFLOW);
  });
});

// (ACID 2, append the T2 cases)
describe('workflow-variants — ACID 2b: T2 governance shape', () => {
  it('T2 (heavy) has EXACTLY TWO founder gates (greenlight + compliance)', () => {
    const keys = founderGatesOf(T2_WORKFLOW).map((s) => s.key).sort();
    expect(keys).toEqual(['stage-compliance-gate', 'stage-gate-greenlight']);
  });
  it('T2 has 10 stages (the heavy contrast vs T0=4)', () => {
    expect(stagesOf(T2_WORKFLOW).length).toBe(10);
    expect(stagesOf(T0_WORKFLOW).length).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/workflow-variants.acid.test.ts -t "ACID 1b|ACID 2b"`
Expected: FAIL — `T2_WORKFLOW` is `undefined` (not yet exported) → `assertValidSingleParentTree(undefined)` throws / `stagesOf(undefined)` throws.

- [ ] **Step 3: Write minimal implementation** — add to `workflow-variants.ts` (after `T0_WORKFLOW`)

```ts
const T2_SAMPLE_KEY = 'sample-path-t2';

// ---- T2_WORKFLOW (heavy): intake → opportunity-brief → gate-greenlight 🔒 →
//      charter → build-path → conduct → review → compliance-gate 🔒 →
//      clinical-safety → ship ---------------------------------------------------------
// 10 stages, 2 founder gates. A regulated medical device (the oncology north-star):
// adds opportunity-brief, charter, review, a SECOND founder gate (compliance / clinical
// sign-off) + a clinical-safety lane.
export const T2_WORKFLOW: CascadeNodeSpec[] = [
  { key: 'foundry-workflow-t2', kind: 'product', parent: null, meta: { productKey: 'foundry', title: 'Foundry pipeline (T2 — heavy)', riskTier: 'T2' } },
  { key: 'stage-intake', kind: 'stage', parent: 'foundry-workflow-t2', meta: { title: 'Intake — capture founder inputs', dependsOn: [] } },
  { key: 'stage-opportunity-brief', kind: 'stage', parent: 'foundry-workflow-t2', meta: { title: 'Opportunity brief — score substrate fit + recommend tier', dependsOn: ['stage-intake'] } },
  {
    key: 'stage-gate-greenlight', kind: 'stage', parent: 'foundry-workflow-t2',
    meta: {
      title: 'Greenlight gate — prioritise the product',
      dependsOn: ['stage-opportunity-brief'],
      founderGated: true,                                  // GATE 1.
      action: 'reprioritize-product',
      actionArgs: { productKey: 'foundry', priority: 500 },
    },
    effects: greenlightEffect('t2-workflow-greenlight-cycle-time'),
  },
  { key: 'stage-charter', kind: 'stage', parent: 'foundry-workflow-t2', meta: { title: 'Charter — author the product charter', dependsOn: ['stage-gate-greenlight'] } },
  {
    key: 'stage-build-path', kind: 'stage', parent: 'foundry-workflow-t2',
    meta: { title: 'Build path — spawn the product tree from a blueprint', dependsOn: ['stage-charter'], action: 'build-path', actionArgs: { blueprint: sampleBlueprint(T2_SAMPLE_KEY, 'T2'), newKey: T2_SAMPLE_KEY } },
  },
  { key: 'stage-conduct', kind: 'stage', parent: 'foundry-workflow-t2', meta: { title: 'Conduct — autonomous build loop', dependsOn: ['stage-build-path'] } },
  { key: 'stage-review', kind: 'stage', parent: 'foundry-workflow-t2', meta: { title: 'Review — verifier wave / quality battery', dependsOn: ['stage-conduct'] } },
  { key: 'stage-compliance-gate', kind: 'stage', parent: 'foundry-workflow-t2', meta: { title: 'Compliance gate — regulatory / clinical sign-off', dependsOn: ['stage-review'], founderGated: true } }, // GATE 2.
  { key: 'stage-clinical-safety', kind: 'stage', parent: 'foundry-workflow-t2', meta: { title: 'Clinical safety — clinical-safety review', dependsOn: ['stage-compliance-gate'] } },
  { key: 'stage-ship', kind: 'stage', parent: 'foundry-workflow-t2', meta: { title: 'Ship — release the product', dependsOn: ['stage-clinical-safety'] } },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/workflow-variants.acid.test.ts -t "ACID 1b|ACID 2b"`
Expected: PASS (T2 builds to a valid single-parent tree, 2 founder gates, 10 stages).

- [ ] **Step 5: Commit**

```bash
git add src/instances/workflow-variants.ts test/workflow-variants.acid.test.ts
git commit -m "feat(workflow-variants): T2_WORKFLOW (heavy, 2 founder gates + clinical lane)"
```

---

### Task 3: The variant registry + the resolve-or-default selector (resolves ADR-265 OQ-3)

**Files:**
- Modify: `domains/foundry/src/instances/workflow-variants.ts`
- Test: `domains/foundry/test/workflow-variants.acid.test.ts`

**Interfaces:**
- Produces: `export const WORKFLOW_VARIANTS: ReadonlyMap<RiskTier, CascadeNodeSpec[]>` (exactly `{T0, T2}`), `export function selectWorkflowVariant(tier: RiskTier): CascadeNodeSpec[]` (resolve-or-default → `FOUNDRY_WORKFLOW`).

- [ ] **Step 1: Write the failing test** — append to `test/workflow-variants.acid.test.ts` (and re-enable the `WORKFLOW_VARIANTS, selectWorkflowVariant` import)

```ts
// ---- ACID 5: the variant map + the resolve-or-default selector --------------------
describe('workflow-variants — ACID 5: the selector resolves tier → variant (resolve-or-default)', () => {
  it('the map holds EXACTLY {T0, T2} (T1 is the default, not a map entry)', () => {
    expect([...WORKFLOW_VARIANTS.keys()].sort()).toEqual(['T0', 'T2']);
    expect(WORKFLOW_VARIANTS.get('T0')).toBe(T0_WORKFLOW);
    expect(WORKFLOW_VARIANTS.get('T2')).toBe(T2_WORKFLOW);
  });
  it('selectWorkflowVariant returns the variant for T0/T2 and the DEFAULT for T1/unknown', () => {
    expect(selectWorkflowVariant('T0')).toBe(T0_WORKFLOW);
    expect(selectWorkflowVariant('T2')).toBe(T2_WORKFLOW);
    // T1 → FOUNDRY_WORKFLOW (today's pipeline), NEVER undefined / no-workflow.
    expect(selectWorkflowVariant('T1')).toBe(FOUNDRY_WORKFLOW);
    // An unknown tier ALSO resolves to the default (governance-safe — never no-workflow).
    // @ts-expect-error — 'T9' is not a RiskTier; the runtime still defaults.
    expect(selectWorkflowVariant('T9')).toBe(FOUNDRY_WORKFLOW);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/workflow-variants.acid.test.ts -t "ACID 5"`
Expected: FAIL — `WORKFLOW_VARIANTS` / `selectWorkflowVariant` are `undefined` (not exported).

- [ ] **Step 3: Write minimal implementation** — add to the END of `workflow-variants.ts`

```ts
// ---- the registry + selector (resolves ADR-265 OQ-3) ------------------------------
// Tier → variant. T1 is deliberately ABSENT — it is the DEFAULT (→ FOUNDRY_WORKFLOW).
// Mirrors the CompileTarget / ACTION_REGISTRY ReadonlyMap shape.
export const WORKFLOW_VARIANTS: ReadonlyMap<RiskTier, CascadeNodeSpec[]> = new Map<RiskTier, CascadeNodeSpec[]>([
  ['T0', T0_WORKFLOW],
  ['T2', T2_WORKFLOW],
]);

/** Pick the workflow variant for a product's risk tier. RESOLVE-OR-DEFAULT: an unmapped
 *  or T1 tier falls back to FOUNDRY_WORKFLOW (today's pipeline), NEVER to "no workflow"
 *  — the governance-safe shape (the default keeps the founder gate). Contrast the
 *  resolve-or-THROW discipline of compile()/actuate(): there an unknown kind is a bug;
 *  here an unmapped tier (T1) is the COMMON case and must yield a real pipeline. */
export function selectWorkflowVariant(tier: RiskTier): CascadeNodeSpec[] {
  return WORKFLOW_VARIANTS.get(tier) ?? FOUNDRY_WORKFLOW;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/workflow-variants.acid.test.ts -t "ACID 5"`
Expected: PASS (map is exactly `{T0,T2}`; selector resolves T0/T2 and defaults T1/unknown to `FOUNDRY_WORKFLOW`).

- [ ] **Step 5: Commit**

```bash
git add src/instances/workflow-variants.ts test/workflow-variants.acid.test.ts
git commit -m "feat(workflow-variants): tier->variant registry + resolve-or-default selector (ADR-265 OQ-3)"
```

---

### Task 4: Behavioral acids — T2 advances in `dependsOn` order; the actions ride each variant

**Files:**
- Test: `domains/foundry/test/workflow-variants.acid.test.ts`

These acids exercise the specs from Tasks 1–2 over the existing `workflowTree`/`planFrontier` machinery. They PASS on first run (the specs are already correct) — their value is the embedded BITE (a simulated `dependsOn`-drop must produce the premature-exposure the bug would cause), the same falsification pattern `test/workflow-advance.acid.test.ts` uses.

**Interfaces:**
- Consumes: `bootstrapVariant`, `variantFrontier`, `completeStage`, `nodeByKey`, `buildCascadeTree` (all defined in Task 1's test file).

- [ ] **Step 1: Write the test** — append to `test/workflow-variants.acid.test.ts`

```ts
// ---- ACID 3: the heavy T2 pipeline advances in dependsOn order --------------------
describe('workflow-variants — ACID 3: T2 advances in dependsOn order, no out-of-order ungate', () => {
  const T2_ORDER = [
    'stage-intake', 'stage-opportunity-brief', 'stage-gate-greenlight', 'stage-charter',
    'stage-build-path', 'stage-conduct', 'stage-review', 'stage-compliance-gate',
    'stage-clinical-safety', 'stage-ship',
  ];

  it('walks all 10 stages in order as each predecessor completes, then exhausts', () => {
    const deps = tempDeps();
    bootstrapVariant(deps, T2_WORKFLOW);
    for (const stage of T2_ORDER) {
      expect(variantFrontier(deps, T2_WORKFLOW)).toEqual([stage]);
      completeStage(deps, stage);
    }
    expect(variantFrontier(deps, T2_WORKFLOW)).toEqual([]); // pipeline exhausted
  });

  it('BITE (dependsOn-drop): a stage whose edge is dropped is exposed PREMATURELY → RED', () => {
    const deps = tempDeps();
    bootstrapVariant(deps, T2_WORKFLOW);
    // Healthy: with nothing done, only intake is ready; clinical-safety is gated.
    expect(variantFrontier(deps, T2_WORKFLOW)).toEqual(['stage-intake']);
    expect(variantFrontier(deps, T2_WORKFLOW)).not.toContain('stage-clinical-safety');

    // SIMULATE dropping stage-clinical-safety's dependsOn edge → it is exposed
    // immediately (the bug a real dropped edge would introduce).
    const dropped = T2_WORKFLOW.map((n) =>
      n.key === 'stage-clinical-safety'
        ? { ...n, meta: { ...(n.meta as Record<string, unknown>), dependsOn: [] } }
        : n);
    const droppedFrontier = planFrontier(workflowTree(dropped), fold(readEnvelopes(deps.logPath)), NOW).map((i) => i.itemId);
    expect(droppedFrontier).toContain('stage-clinical-safety'); // RED a real drop causes
    // Restore-confirm: the real spec still gates it behind its chain.
    expect(variantFrontier(deps, T2_WORKFLOW)).not.toContain('stage-clinical-safety');
  });
});

// ---- ACID 4: build-path actuation + the declaration ⊥ actuation gate rides each variant
describe('workflow-variants — ACID 4: build-path action + greenlight effect ride the variants', () => {
  it('each variant build-path node carries metadata.action === build-path through buildCascadeTree', () => {
    for (const spec of [T0_WORKFLOW, T2_WORKFLOW]) {
      const node = nodeByKey(buildCascadeTree(spec), 'stage-build-path');
      expect((node.metadata as Record<string, unknown>)['action']).toBe('build-path');
    }
  });
  it('the greenlight gate carries BOTH an action AND an effect (declaration ⊥ actuation)', () => {
    for (const spec of [T0_WORKFLOW, T2_WORKFLOW]) {
      const gate = nodeByKey(buildCascadeTree(spec), 'stage-gate-greenlight');
      expect((gate.metadata as Record<string, unknown>)['action']).toBe('reprioritize-product');
      expect(gate.effectDeclarations?.[0]?.indicatorId).toBe('cycle-time');
      // independence: no effect field in metadata, no action kind inside the effect.
      expect((gate.metadata as Record<string, unknown>)['effects']).toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run test/workflow-variants.acid.test.ts`
Expected: PASS (all acids — the full file). If the T2 walk test fails, a `dependsOn` edge in `T2_WORKFLOW` is mis-wired — fix the spec (Task 2) so the chain is `intake → opportunity-brief → gate → charter → build-path → conduct → review → compliance-gate → clinical-safety → ship`.

- [ ] **Step 3: Verify the BITE bites (manual falsification)**

Temporarily edit `T2_WORKFLOW` in `workflow-variants.ts` — remove `'stage-review'` from `stage-compliance-gate`'s `dependsOn` (set it to `[]`). Run the suite: the ACID 3 "walks all 10 in order" test goes RED (compliance-gate is exposed before review is done). Restore the edge. Re-run: GREEN. (This confirms the order acid is load-bearing, not a tautology.)

- [ ] **Step 4: Commit**

```bash
git add test/workflow-variants.acid.test.ts
git commit -m "test(workflow-variants): T2 dependsOn-order walk + build-path/effect ride acids (with BITE)"
```

---

### Task 5: Full local gate (typecheck + coverage) green

**Files:** none (verification + any fixups surfaced).

- [ ] **Step 1: Run the full local CI gate**

Run (from `domains/foundry`): `npm run ci:local`
Expected: `typecheck` clean (no `tsc` errors) AND `test:coverage` PASS (the full vitest suite, including the new `workflow-variants.acid.test.ts` and every pre-existing test, e.g. `workflow-advance.acid.test.ts` unaffected). Confirm the `@ts-expect-error` line typechecks (it must — `'T9'` is genuinely not a `RiskTier`).

- [ ] **Step 2: If anything is red, fix it minimally and re-run**

Common fixups: a missing `.js` extension on a relative import; the `EffectDeclaration` shape (match `foundry-workflow.ts`'s greenlight effect exactly); coverage of the new module (the acids exercise `sampleBlueprint`, `greenlightEffect`, both specs, the map, and the selector — confirm no uncovered branch). Do NOT touch any file outside `workflow-variants.ts` / `workflow-variants.acid.test.ts`.

- [ ] **Step 3: Commit any fixups**

```bash
git add -u
git commit -m "chore(workflow-variants): ci:local green (typecheck + coverage)"
```

---

### Task 6: ADR — reconciled to the shipped code (separate `layers/specs` PR)

**Files:**
- Create: `layers/specs/adr/adr-268-foundry-workflow-t0-t2-variants.md` (VERIFY 268 is still free at reserve-time — concurrent foundry sessions race ADR numbers; use `foundry_reserve_adr` or re-check `ls layers/specs/adr/ | grep -oE 'adr-[0-9]+' | sort -t- -k2 -n | tail`).
- Modify: `layers/specs/adr/adrs-by-tier.md` (add the new ADR under Design-local).

- [ ] **Step 1: Reserve the ADR number** — run `ls layers/specs/adr/ | grep -oE 'adr-[0-9]+' | sort -t- -k2 -n | tail -3` (or `foundry_reserve_adr`); use the next free (≥268).

- [ ] **Step 2: Write the ADR** reconciled to the FINAL shipped code (not the plan). Frontmatter: `tier: design-local`, `scope: foundry`, `status: ratified` (set after merge; `proposed` before), `decision-makers: [stibe]`, `relates-to: [adr-263, adr-265, adr-266, adr-267, adr-176, adr-127]`. Body must cover: the two forks settled (per-product cardinality; the T0/T2 stage-sets), the resolve-or-default selector (resolving ADR-263/265 OQ-3), the governance-held-structurally argument, the ADR-176 inclusion-test NOT-triggered verdict (both legs fail → pack territory, the P7 precedent a fourth time), the acid battery, reversibility, and OQ-A..D (auto-greenlight T0, T1 explicit variant, S3 instance-key format, build-path per-product semantics). Cite the shipped `src/instances/workflow-variants.ts` symbols verbatim in a provenance note. Reuse the structure of ADR-265/267.

- [ ] **Step 3: Validate + commit**

Run the spec gate locally (`tools/lint-md.sh` if present) and ensure cross-refs resolve. Commit on a `layers/specs` branch:

```bash
git add layers/specs/adr/adr-268-foundry-workflow-t0-t2-variants.md layers/specs/adr/adrs-by-tier.md
git commit -m "docs(adr): ADR-268 foundry workflow T0/T2 variants (resolves ADR-263/265 OQ-3)"
```

---

## After implementation — verification & landing

1. **Verifier wave** (per the cluster SDLC, run in the `domains/foundry` clone, NO `isolation: worktree`): `charter-checker` (esp. the governance invariant — T0 keeps its gate, resolve-or-default never yields no-workflow — + ADR-176 pack-level), `reviewer`, `qa-engineer`, `local-ci`, in parallel.
2. **Opus whole-branch capstone** — review the entire branch diff (it caught a real defect every ladder slice). Likely risk areas: the `dependsOn` chain wiring in T2 (10 stages), the resolve-or-default vs resolve-or-throw distinction, and the `@ts-expect-error` test line.
3. **PR-per-repo**, founder-gated merge: a `domains/foundry` PR (the code) + a `layers/specs` PR (the ADR). PR body carries `Producer: orchestrator/claude-opus-4-8 [...]`, `Effort: standard`, and `Effect: cycle-time 0.005±0.01 expert` / `findings ...` lines.
4. **Twin ritual after each merge** (`drain` the wave → `backfill` → `reconcile`; `post-findings` before merge).
5. **Reconcile the ADR to the FINAL code** at ratify (after the code settles).

## Self-review (run against the design doc)

- **Spec coverage:** the design's S1 (define specs) + S2 (selector) are both implemented (Tasks 1–3); the S1 acid battery's 5 acids map to Tasks 1–4 (valid tree → ACID 1; gate counts → ACID 2; T2 order → ACID 3; action rides → ACID 4; map+selector → ACID 5). S3 (per-product wiring) is correctly OUT of this plan (its own plan/ADR). ✓
- **Placeholder scan:** every step has concrete code/commands; no TBD/TODO. ✓
- **Type consistency:** `T0_WORKFLOW`/`T2_WORKFLOW`/`WORKFLOW_VARIANTS`/`selectWorkflowVariant` names + signatures are identical across the production file, the test imports, and the interfaces blocks. `CascadeNodeSpec` / `RiskTier` / `EffectDeclaration` import paths match the existing foundry sources. ✓
