# Exercir substrate-2.0 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `domains/exercir` from `@de-braighter/substrate-{contracts,runtime}` `^1.2.0` to the published `2.0.0`, adopting the three breaking surfaces (router 6th ctor arg, `registerTree` seeding, OQ-1 log-odds re-expression of `pass_completion` Beta magnitudes) so exercir's declared effect variance propagates live through the kernel (north-star Check-2 wiring precondition).

**Architecture:** Pure consumer-side adaptation — no new features. The dep bump breaks compilation at exactly three seams; each task closes one seam with its tests updated to the 2.0 semantics. The multiplicative *intent* of all seeded pass-completion magnitudes (1.05× / 1.3× on prior p₀ = 0.7) is preserved by converting through a shared `passCompletionLogOddsDelta()` helper rather than hard-coding decimals.

**Tech Stack:** Nx + npm workspace (NOT pnpm), vitest, NestJS, `@de-braighter/substrate-{contracts,runtime}@2.0.0` from GitHub Packages (`.npmrc` needs `GITHUB_TOKEN` in env).

**Worktree:** all work happens in a fresh git worktree of `domains/exercir` at `origin/main` (`ad440eb`), branch `feat/substrate-2.0-migration`, directory `D:\development\projects\de-braighter\domains\exercir-wt-sub2`. NEVER run git commands in the main `domains/exercir` clone (a parallel session uses it).

---

## Verified migration facts (recon against origin/main of both repos — do not re-derive)

- exercir is **5-arg** on the router today (`catalog, evidence, sidecar, members, distributions`) at `libs/pack-football/src/inference/inference-backbone.providers.ts:411`. 2.0 adds a **required 6th param** `recorder: InferenceRunRecorder` (token `INFERENCE_RUN_RECORDER`, both exported from `@de-braighter/substrate-runtime`). `SubstrateModule.forRoot` default-binds the token; the pack only threads it.
- `InMemoryEvidenceRepository.registerEffects` is **removed** in 2.0; `registerTree(nodes, tenantPackId)` is the only effect-seeding path. Node shape: `{ id, parentId, ordinal, effects: EffectDeclaration[] }`. `registerObservations` **survives unchanged**.
- `InMemoryInferenceBackbone.withEffects(treeRoot, _indicatorKey, effects, tenantPackId?)` survives with the **same call shape** but `effects` is now **full ADR-154 `EffectDeclaration[]`** (it wraps `registerTree` with a one-node tree).
- `EvidenceRepository.findEffectsForTree` now returns `Promise<Result<ComposedEffect[], CompositionError>>`. `ComposedEffect = { indicatorId, operator, magnitude: DistributionSpec, direction, contributingDeclarationIds }` — **no `planNodeId`**.
- OQ-1: point effects on `beta`-family indicators are **log-odds additive, identity 0** (was proportion-multiplicative, identity 1). Re-expression: `δ = logit(p₀·m) − logit(p₀)` with `p₀ = 14/(14+6) = 0.7` (the seeded Beta(14,6) prior in `buildPackFootballInferenceCatalog`). Precomputed oracles: δ(1.05) ≈ **0.1729295**, δ(1.2) = ln(2.25) ≈ **0.8109302**, δ(1.3) ≈ **1.4663370**, δ(1.0) = 0.
- The DB-path seed (`drill-subtrees-seed.ts`) declares pass-completion effects as `{ kind:'lognormal', meanLog: ln(m), sdLog: 0.1 }` with operator `'multiplicative'`. Under 2.0 a lognormal composed prior on a beta likelihood is a **deferred matrix cell** (`effect-not-conjugable`) — the live what-if would 5xx. Must re-express to `{ kind:'point', value: δ }` + operator `'sum'`. The form_index effects (`{kind:'normal', mean, sd:2}`, `'sum'`) are the closed-form NN cell — **keep unchanged**.
- `InferenceErrorPhase1` still exists in 2.0 contracts. The union gains `effect-not-conjugable` (fields: `indicatorKey, composedPriorKind, operator, conjugateFamily, deferTrigger, deferredAdrPointer`) and `effect-composition-failed` (fields: `indicatorKey, compositionError`). exercir's `translateInferenceError` has a `default` arm, so the compiler will NOT force these — they must be added by hand.
- exercir binds `EVIDENCE_REPOSITORY` only with substrate-provided impls (`InMemoryEvidenceRepository`, `PrismaEvidenceLogRepository`) — **no custom adapter to migrate**.
- Local gate: `npm run ci:local` (= `nx run-many -t build lint && nx run-many -t test --parallel=1`).

---

### Task 1: Worktree, dependency bump, install, lockfile proof

**Files:**
- Modify: `package.json:49-50` (workspace root)
- Modify: `libs/pack-football/package.json:21-22`
- Modify: `apps/pack-football-api/package.json:17-18`
- Modify: `libs/pack-football-ui/package.json:10`
- Modify: `package-lock.json` (regenerated)

- [ ] **Step 1: Create the worktree** (run from `D:\development\projects\de-braighter\domains\exercir`)

```bash
git worktree add ../exercir-wt-sub2 -b feat/substrate-2.0-migration origin/main
cd ../exercir-wt-sub2 && git log --oneline -1   # expect: ad440eb docs(exercir): carry over the kids-football-club MVP design handoff (#236)
```

- [ ] **Step 2: Bump the four version ranges** — in each file listed above replace `"@de-braighter/substrate-contracts": "^1.2.0"` with `"^2.0.0"` and `"@de-braighter/substrate-runtime": "^1.2.0"` with `"^2.0.0"` (the ui package declares contracts only).

- [ ] **Step 3: Install and prove the lockfile resolved 2.0.0**

```bash
npm install
grep -A1 '"node_modules/@de-braighter/substrate-runtime"' package-lock.json | head -3
grep -A1 '"node_modules/@de-braighter/substrate-contracts"' package-lock.json | head -3
```
Expected: both show `"version": "2.0.0"`. If `npm install` fails with 401: `GITHUB_TOKEN` is missing from the shell env — STOP and report, do not improvise registry config.

- [ ] **Step 4: Capture the breakage list (expected RED)**

```bash
npx nx run-many -t build 2>&1 | tail -40
```
Expected failures: router ctor arity at `inference-backbone.providers.ts`, missing `registerEffects` on `InMemoryEvidenceRepository`, type errors in the two service specs + drill-subtrees spec. No OTHER categories should appear — if something else breaks, report it before proceeding.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json libs/pack-football/package.json apps/pack-football-api/package.json libs/pack-football-ui/package.json
git commit -m "chore(deps): bump substrate contracts+runtime to ^2.0.0 (build red until migration lands)"
```

---

### Task 2: Router 6th ctor arg (recorder)

**Files:**
- Modify: `libs/pack-football/src/inference/inference-backbone.providers.ts` (~lines 399–419 + imports)
- Modify: `apps/pack-football-api/src/app/pack-football-drill-grid.spec.ts:166-172`

- [ ] **Step 1: Extend the provider factory.** In `inference-backbone.providers.ts`, add to the existing `@de-braighter/substrate-runtime` import block: `INFERENCE_RUN_RECORDER` and `type InferenceRunRecorder`. Then change the factory (currently 5-arg):

```ts
{
  provide: INFERENCE_BACKBONE,
  useFactory: (
    catalog: InferenceCatalog,
    evidence: EvidenceRepository,
    sidecar: ConstructorParameters<typeof InferenceBackboneRouter>[2],
    members: MemberResolution,
    // Substrate ≥1.1 5th ctor arg: the vendor DistributionCatalog feeding
    // ... (keep the existing comment lines)
    distributions: DistributionCatalog,
    // Substrate ≥2.0 6th ctor arg (B3-S4a / ADR-220): the run recorder the
    // router calls on manifest:'event' successes. forRoot default-binds the
    // token — the pack only threads it.
    recorder: InferenceRunRecorder,
  ) =>
    new InferenceBackboneRouter(catalog, evidence, sidecar, members, distributions, recorder),
  inject: [
    INFERENCE_CATALOG,
    EVIDENCE_REPOSITORY,
    NUMPYRO_SIDECAR,
    MEMBER_RESOLUTION_PORT,
    DISTRIBUTION_CATALOG,
    INFERENCE_RUN_RECORDER,
  ],
},
```

- [ ] **Step 2: Fix the direct construction in the drill-grid spec** (`pack-football-drill-grid.spec.ts:166`):

```ts
const backbone = new InferenceBackboneRouter(
  catalog,
  evidence,
  null,
  new PackFootballMemberResolution(),
  new InMemoryDistributionCatalog(),
  { record: async () => { /* no-op recorder: this spec never passes manifest:'event' */ } },
);
```

- [ ] **Step 3: Verify the arity errors are gone**

```bash
npx nx run-many -t build 2>&1 | tail -20
```
Expected: remaining errors are ONLY the `registerEffects` / effect-shape ones (Tasks 3–5).

- [ ] **Step 4: Commit**

```bash
git add libs/pack-football/src/inference/inference-backbone.providers.ts apps/pack-football-api/src/app/pack-football-drill-grid.spec.ts
git commit -m "feat(pack-football): thread INFERENCE_RUN_RECORDER as the router's 6th ctor arg (substrate 2.0 / ADR-220)"
```

---

### Task 3: Shared log-odds helper (TDD) + in-memory seed → `registerTree`

**Files:**
- Create: `libs/pack-football/src/inference/pass-completion-log-odds.ts`
- Test: `libs/pack-football/src/inference/pass-completion-log-odds.spec.ts`
- Modify: `libs/pack-football/src/inference/inference-backbone.providers.ts` (`buildPackFootballEvidenceRepository`, ~lines 279–310)

- [ ] **Step 1: Write the failing helper spec** (`pass-completion-log-odds.spec.ts`):

```ts
import { describe, expect, it } from 'vitest';
import {
  PASS_COMPLETION_PRIOR_MEAN,
  passCompletionLogOddsDelta,
} from './pass-completion-log-odds.js';

describe('passCompletionLogOddsDelta (OQ-1 re-expression, migration-substrate-2.0 §ADR-224)', () => {
  it('mirrors the seeded Beta(14,6) prior mean', () => {
    expect(PASS_COMPLETION_PRIOR_MEAN).toBeCloseTo(0.7, 10);
  });

  it('maps the identity multiplier to the log-odds identity 0', () => {
    expect(passCompletionLogOddsDelta(1.0)).toBeCloseTo(0, 10);
  });

  it('re-expresses the seeded demo multipliers (hand-computed oracles)', () => {
    expect(passCompletionLogOddsDelta(1.05)).toBeCloseTo(0.1729295, 5); // logit(0.735) − logit(0.7)
    expect(passCompletionLogOddsDelta(1.2)).toBeCloseTo(Math.log(2.25), 10); // logit(0.84) − logit(0.7) = ln 2.25
    expect(passCompletionLogOddsDelta(1.3)).toBeCloseTo(1.466337, 5); // logit(0.91) − logit(0.7)
  });

  it('is strictly increasing in the multiplier (preserves drill ordering)', () => {
    expect(passCompletionLogOddsDelta(1.3)).toBeGreaterThan(passCompletionLogOddsDelta(1.05));
    expect(passCompletionLogOddsDelta(0.9)).toBeLessThan(0);
  });

  it('rejects multipliers whose target proportion leaves (0,1)', () => {
    expect(() => passCompletionLogOddsDelta(1.5)).toThrow(RangeError); // 0.7·1.5 = 1.05 ≥ 1
    expect(() => passCompletionLogOddsDelta(0)).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails** — `npx nx test pack-football --testPathPattern=pass-completion-log-odds` (or the workspace's vitest filter syntax: `npx nx test pack-football -- pass-completion-log-odds`). Expected: FAIL, module not found.

- [ ] **Step 3: Implement the helper** (`pass-completion-log-odds.ts`):

```ts
/**
 * OQ-1 (ADR-224 / docs/migration-substrate-2.0.md §2): point effects on
 * beta-family indicators are log-odds additive (identity 0), replacing the
 * pre-2.0 proportion-multiplicative convention (identity 1). A multiplicative
 * intent `m` against the indicator prior p₀ re-expresses as
 * δ = logit(p₀·m) − logit(p₀). This module is the ONE place that conversion
 * lives so seeds and specs keep declaring the human-readable multiplier.
 */

/** Mirrors the Beta(14,6) prior in `buildPackFootballInferenceCatalog`. */
export const PASS_COMPLETION_PRIOR_MEAN = 14 / (14 + 6);

const logit = (p: number): number => Math.log(p / (1 - p));

export function passCompletionLogOddsDelta(multiplicative: number): number {
  const target = PASS_COMPLETION_PRIOR_MEAN * multiplicative;
  if (!(target > 0 && target < 1)) {
    throw new RangeError(
      `multiplicative intent ${multiplicative} maps prior ${PASS_COMPLETION_PRIOR_MEAN} to ${target}, outside (0,1)`,
    );
  }
  return logit(target) - logit(PASS_COMPLETION_PRIOR_MEAN);
}
```

- [ ] **Step 4: Run the spec to verify it passes.**

- [ ] **Step 5: Rewrite the in-memory effect seeding.** In `buildPackFootballEvidenceRepository` (providers.ts), replace the two `registerEffects` calls (and their "Beta-Binomial fold multiplies" comments) with one `registerTree`. Full ADR-154 declarations are required — mirror the shape `drill-subtrees-seed.ts` already uses (validate via `EffectDeclarationSchema.parse`, imported from `@de-braighter/substrate-contracts/plan-tree`):

```ts
// Drill X: gentle uplift (multiplicative intent 1.05× on the Beta(14,6)
// prior), Drill Y: stronger 1.30×. Substrate ≥2.0 (ADR-224 OQ-1): beta-family
// point effects are log-odds additive (identity 0), so the multiplicative
// intents are re-expressed as log-odds deltas at declaration time.
const drillEffect = (declarationId: string, multiplicative: number) =>
  EffectDeclarationSchema.parse({
    declarationId,
    indicatorId: PASS_COMPLETION_INDICATOR_KEY,
    direction: '+',
    magnitudePrior: { kind: 'point', value: passCompletionLogOddsDelta(multiplicative) },
    confidence: 0.6,
    horizon: 'P28D',
    compositionOperator: 'sum',
    commutative: true,
    basis: 'expert',
    declaredAt: '2026-05-31T00:00:00.000Z',
  });
evidence.registerTree(
  [
    { id: SEED_TREE_DRILL_X_ROOT_ID, parentId: null, ordinal: 0, effects: [] },
    {
      id: DRILL_X_PLAN_NODE_ID,
      parentId: SEED_TREE_DRILL_X_ROOT_ID,
      ordinal: 0,
      effects: [drillEffect('1f7b6c1e-9d0a-4f3b-8e2a-aaaaaaaaaa01', 1.05)],
    },
    { id: SEED_TREE_DRILL_Y_ROOT_ID, parentId: null, ordinal: 0, effects: [] },
    {
      id: DRILL_Y_PLAN_NODE_ID,
      parentId: SEED_TREE_DRILL_Y_ROOT_ID,
      ordinal: 0,
      effects: [drillEffect('1f7b6c1e-9d0a-4f3b-8e2a-aaaaaaaaaa02', 1.3)],
    },
  ],
  DEMO_TENANT_PACK_ID,
);
```
Import `passCompletionLogOddsDelta` from `./pass-completion-log-odds.js` and `EffectDeclarationSchema` from `@de-braighter/substrate-contracts/plan-tree` (check the file's existing import blocks first — extend, don't duplicate). If TypeScript reports the node literal type isn't assignable, check what `registerTree` exports for the node type in `node_modules/@de-braighter/substrate-runtime` and use exactly that.

- [ ] **Step 6: Build the lib** — `npx nx build pack-football`. Expected: providers.ts compiles; remaining workspace errors live in seed + specs (Tasks 4–5).

- [ ] **Step 7: Commit**

```bash
git add libs/pack-football/src/inference/pass-completion-log-odds.ts libs/pack-football/src/inference/pass-completion-log-odds.spec.ts libs/pack-football/src/inference/inference-backbone.providers.ts
git commit -m "feat(pack-football): registerTree in-memory effect seeding with OQ-1 log-odds point magnitudes (substrate 2.0)"
```

---

### Task 4: DB-path seed re-expression + drill-subtrees DB spec

**Files:**
- Modify: `libs/pack-football/src/inference/drill-subtrees-seed.ts` (~lines 103–126: `lnMag`, `passCompletionEffect`)
- Modify: `apps/pack-football-api/src/app/pack-football-drill-subtrees.spec.ts` (~lines 156–197: read-back assertions)

- [ ] **Step 1: Update the spec FIRST (red).** `findEffectsForTree` now returns `Result<ComposedEffect[], CompositionError>` and `ComposedEffect` has no `planNodeId` — provenance is `contributingDeclarationIds`. Rewrite the two read-back tests:

```ts
it('reads the pass_completion effect for both drills from plan_node.effects', async () => {
  const xRes = await repo.findEffectsForTree(TENANT_A, SEED_TREE_DRILL_X_ROOT_ID, PASS_COMPLETION_INDICATOR_KEY);
  const yRes = await repo.findEffectsForTree(TENANT_A, SEED_TREE_DRILL_Y_ROOT_ID, PASS_COMPLETION_INDICATOR_KEY);
  if (!xRes.ok || !yRes.ok) throw new Error('composition failed');
  const [x] = xRes.value;
  const [y] = yRes.value;
  expect(xRes.value).toHaveLength(1);
  expect(yRes.value).toHaveLength(1);
  // OQ-1 log-odds additive (identity 0): δ = logit(0.7·m) − logit(0.7).
  expect(x.magnitude).toEqual({ kind: 'point', value: expect.closeTo(0.1729295, 5) });
  expect(y.magnitude).toEqual({ kind: 'point', value: expect.closeTo(1.466337, 5) });
  expect((y.magnitude as { value: number }).value).toBeGreaterThan((x.magnitude as { value: number }).value);
});
```
(Keep the existing `DRILL_X_INTERVENTION_NODE_ID` provenance idea via `x.contributingDeclarationIds` — assert it has length 1 and equals the declarationId constants the seed uses. Read the seed file for the declarationId values; they are existing constants like `'…decl…'` — quote them exactly.) Similarly the form_index test becomes:

```ts
expect(x.magnitude).toEqual({ kind: 'normal', mean: 6, sd: 2 });
expect(y.magnitude).toEqual({ kind: 'normal', mean: 1, sd: 2 });
```
Adjust surrounding `expect(...)` lines to the Result-unwrapped variables. If the suite's vitest version lacks `expect.closeTo`, fall back to `expect(x.magnitude.kind).toBe('point')` + `toBeCloseTo` on the value.

- [ ] **Step 2: Run the spec to see it fail for the RIGHT reason** (old seed still lognormal): the pass_completion assertions report `kind: 'lognormal'`. Note: this spec needs the local PG (it is a DB integration spec) — if the DB tier is skipped in this environment, rely on `npx nx run-many -t build` type errors instead and say so in the report.

- [ ] **Step 3: Re-express the seed.** In `drill-subtrees-seed.ts`: delete `lnMag`, import `passCompletionLogOddsDelta` from `./pass-completion-log-odds.js`, and change `passCompletionEffect` to:

```ts
function passCompletionEffect(
  declarationId: string,
  multiplicative: number,
): EffectDeclaration {
  // Beta-family point effect, substrate ≥2.0 (ADR-224 OQ-1): log-odds
  // additive with identity 0. The human-readable multiplicative intent is
  // re-expressed at declaration time; the kernel no longer reduces
  // distributions to scalars, so the old lognormal-median encoding is gone.
  return EffectDeclarationSchema.parse({
    declarationId,
    indicatorId: PASS_COMPLETION_INDICATOR_KEY,
    direction: '+',
    magnitudePrior: { kind: 'point', value: passCompletionLogOddsDelta(multiplicative) },
    confidence: 0.6,
    horizon: 'P28D',
    compositionOperator: 'sum',
    commutative: true,
    basis: 'expert',
    declaredAt: DECLARED_AT,
  });
}
```
Keep `formIndexEffect` byte-identical (it is the closed-form normal×normal cell — the variance-aware payoff). Update the file-header comment that references `reduceMagnitude`/`registerEffects` fixtures to name `registerTree` + composed effects instead. Check `drill-subtrees-seed.spec.ts` (same dir) for assertions on the lognormal shape and update them to the point/log-odds shape with the same oracles as Task 3's helper spec.

- [ ] **Step 4: Run the affected specs** (`drill-subtrees-seed.spec.ts`; the DB spec if PG is up). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add libs/pack-football/src/inference/drill-subtrees-seed.ts libs/pack-football/src/inference/drill-subtrees-seed.spec.ts apps/pack-football-api/src/app/pack-football-drill-subtrees.spec.ts
git commit -m "feat(pack-football): re-express pass_completion DB-seed magnitudes proportion→log-odds (OQ-1) + 2.0 composed-effect read-back"
```

---

### Task 5: Service-spec helpers → full ADR-154 declarations

**Files:**
- Modify: `libs/pack-football/src/application/compare-drill-what-if.service.spec.ts` (~lines 53–103: `seededBackboneWith`, `seededMultiArmBackbone`)
- Modify: `libs/pack-football/src/application/compare-drill-grid.service.spec.ts` (~lines 70–95: effect seeding)
- Possibly modify: any other spec the build flags calling `withEffects` with the old reduced shape (find with `git grep -n "withEffects" libs apps`).

- [ ] **Step 1: Migrate `seededBackboneWith`.** `withEffects` keeps its call shape but takes full declarations. Add a local builder at the top of each affected spec (specs may not import from `../inference` internals freely — if the import path `../inference/pass-completion-log-odds.js` resolves, use it; otherwise inline the same two-line logit conversion with a comment pointing at the helper):

```ts
import { passCompletionLogOddsDelta } from '../inference/pass-completion-log-odds.js';
import { EffectDeclarationSchema } from '@de-braighter/substrate-contracts/plan-tree';

/** Full ADR-154 declaration carrying a multiplicative intent as an OQ-1 log-odds point magnitude. */
function passPointEffect(declarationId: string, multiplicative: number) {
  return EffectDeclarationSchema.parse({
    declarationId,
    indicatorId: INDICATOR,
    direction: '+',
    magnitudePrior: { kind: 'point', value: passCompletionLogOddsDelta(multiplicative) },
    confidence: 0.6,
    horizon: 'P28D',
    compositionOperator: 'sum',
    commutative: true,
    basis: 'expert',
    declaredAt: '2026-05-31T00:00:00.000Z',
  });
}
```
Then each `.withEffects(TREE, INDICATOR, [{ planNodeId: …, ordinal: 0, indicatorKey: INDICATOR, magnitudePrior: m }])` becomes `.withEffects(TREE, INDICATOR, [passPointEffect('<a fixed uuid per arm>', m)])`. Keep `seededBackboneWith(baselineMagnitude, counterfactualMagnitude)` and the multi-arm values (1.05 / 1.2 / 1.3) — the conversion is strictly monotone, so every directional assertion (improves / worsens / flat for equal arms) is preserved by construction.

- [ ] **Step 2: Same treatment in `compare-drill-grid.service.spec.ts`** — its pass effects (1.05 / 1.3) convert via `passPointEffect`; its form_index effects (mean shifts 6 / 1) become full declarations with `magnitudePrior: { kind: 'normal', mean: m, sd: 2 }`, `compositionOperator: 'sum'` (mirror `formIndexEffect` in `drill-subtrees-seed.ts`).

- [ ] **Step 3: Run both spec files** — `npx nx test pack-football -- compare-drill`. Expected: PASS. If a numeric `toBeCloseTo` fails, recompute the oracle by hand from the new semantics (posterior log-odds shift δ, then `p' = sigmoid(logit(p̂) + δ)`) — do NOT pad tolerances to make it pass; report if a number cannot be hand-derived.

- [ ] **Step 4: Commit**

```bash
git add libs/pack-football/src/application/compare-drill-what-if.service.spec.ts libs/pack-football/src/application/compare-drill-grid.service.spec.ts
git commit -m "test(pack-football): migrate spec effect fixtures to full ADR-154 declarations (substrate 2.0)"
```

---

### Task 6: `translateInferenceError` — the two new 2.0 arms (TDD)

**Files:**
- Modify: `libs/pack-football/src/application/translate-inference-error.ts`
- Test: extend the spec that drives the translation arms (`compare-drill-what-if.service.spec.ts` uses `stubBackboneFailing(error)` — add two cases there, or in a dedicated `translate-inference-error.spec.ts` if one exists; check first).

- [ ] **Step 1: Write the two failing tests** (using the existing `stubBackboneFailing` pattern):

```ts
it('maps effect-not-conjugable (deferred matrix cell) to inference-unavailable', async () => {
  const service = serviceWith(stubBackboneFailing({
    kind: 'effect-not-conjugable',
    indicatorKey: INDICATOR,
    composedPriorKind: 'lognormal',
    operator: 'multiplicative',
    conjugateFamily: 'beta',
    deferTrigger: 'numerical-quadrature-engine',
    deferredAdrPointer: 'ADR-224#OQ-3',
  } as InferenceErrorPhase1));
  const result = await service.execute(validInput());
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe('inference-unavailable');
  expect(result.error.detail).toContain('numerical-quadrature-engine');
});

it('maps effect-composition-failed to invalid-input carrying the composition kind', async () => {
  const service = serviceWith(stubBackboneFailing({
    kind: 'effect-composition-failed',
    indicatorKey: INDICATOR,
    compositionError: { kind: 'operator-disagreement', indicatorId: INDICATOR, operators: ['sum', 'multiplicative'] },
  } as InferenceErrorPhase1));
  const result = await service.execute(validInput());
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.kind).toBe('invalid-input');
  expect(result.error.detail).toContain('operator-disagreement');
});
```
Adapt `serviceWith` / `validInput` to whatever the surrounding spec actually names its harness helpers — read the existing not-implemented-phase-1 / internal test cases and mirror them exactly.

- [ ] **Step 2: Run to verify both fail** — today both fall through `default` to `inference-failed`.

- [ ] **Step 3: Add the arms** in `translate-inference-error.ts` before `default`:

```ts
case 'effect-not-conjugable':
  return {
    kind: 'inference-unavailable',
    detail: `substrate deferred composed-effect cell ${error.composedPriorKind}×${error.conjugateFamily} under ${error.operator} (trigger=${error.deferTrigger}); see ${error.deferredAdrPointer}`,
  };
case 'effect-composition-failed':
  return {
    kind: 'invalid-input',
    detail: `effect declarations for ${error.indicatorKey} are not composable: ${error.compositionError.kind}`,
  };
```

- [ ] **Step 4: Run the tests — PASS. Then commit**

```bash
git add libs/pack-football/src/application/translate-inference-error.ts libs/pack-football/src/application/compare-drill-what-if.service.spec.ts
git commit -m "feat(pack-football): translate the two ADR-224 inference-error arms (deferred cell → unavailable, composition failure → invalid input)"
```

---

### Task 7: Full local gate + residue sweep

- [ ] **Step 1: Sweep for leftovers**

```bash
git grep -n "registerEffects\|reduceMagnitude\|lnMag" -- '*.ts' || echo CLEAN
```
Expected: CLEAN (or only comments that should then be updated).

- [ ] **Step 2: Run the full gate**

```bash
npm run ci:local
```
Expected: build + lint + test all green. Fix any straggler the same way the tasks above did (full declarations, Result unwrapping, log-odds oracles); commit each fix with a descriptive message. If a failure is NOT obviously migration-shaped, STOP and report rather than patching blind.

- [ ] **Step 3: Commit any stragglers** (if none, skip).

---

### Task 8: Push + PR

- [ ] **Step 1: Push** — `git push -u origin feat/substrate-2.0-migration`

- [ ] **Step 2: Open the PR** against `main` of `de-braighter/exercir`, title `feat: adopt substrate 2.0.0 — recorder arg, registerTree seeding, OQ-1 log-odds re-expression`. Body must include:
  - the three breaking surfaces adopted + the unchanged ones (posterior/sample/counterfactual call sites, EVIDENCE_REPOSITORY bindings are substrate-provided impls);
  - the OQ-1 math: p₀ = 0.7 from Beta(14,6); δ(1.05) ≈ 0.17293, δ(1.3) ≈ 1.46634; multiplicative intent preserved via `passCompletionLogOddsDelta`;
  - the form_index effects untouched (the closed-form variance-propagating normal×normal cell — the Check-2 wiring target of the NEXT PR);
  - note for the parallel kids-football session: the workspace now resolves substrate 2.0.0 (`pack-kids-sports` declares no substrate deps, so no code impact expected);
  - note: live DB demos need a re-seed (`npm run db:seed` equivalent) so `kernel.plan_node.effects` carries the re-expressed declarations;
  - `Producer: orchestrator/claude-fable-5 [writing-plans, subagent-driven-development]`
  - `Effort: standard`
  - `Effect: cycle-time 0.01±0.01 expert`
  - `Effect: findings 3±2 expert`
  - the Claude Code attribution footer.

---

## Self-review checklist (done at planning time)

- Spec coverage: all three migration-doc surfaces (recorder arg §1, registerTree+findEffectsForTree §1, log-odds §2, error arms §3) map to Tasks 2/3+5/3+4/6 respectively. The §1 "custom EvidenceRepository implementor" surface is N/A (verified: substrate-provided impls only).
- Oracles hand-computed and cross-checked: δ(1.2) = ln(2.25) confirms the formula algebraically (logit(0.84)−logit(0.7) = ln(5.25)−ln(7/3) = ln(2.25)).
- Type consistency: `passCompletionLogOddsDelta` named identically in Tasks 3/4/5; `EffectDeclarationSchema.parse` used consistently; ComposedEffect field is `magnitude` (NOT `magnitudePrior`) in read-back assertions.
