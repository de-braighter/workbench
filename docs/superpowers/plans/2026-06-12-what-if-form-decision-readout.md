# What-if Form-Index Decision Readout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire one coach-facing decision (readiness commit: P(form_index ≥ 70) ≥ 0.70, per arm) to the variance-aware posterior in the exercir what-if lane, flipping on declared effect variance — closing north-star Check 2 (specs#298). Folds in PR #237 follow-ups 1 (builder consolidation) and 4 (exhaustive error switch).

**Spec:** `docs/superpowers/specs/2026-06-12-what-if-form-decision-readout-design.md` (workbench root — READ IT FIRST; it carries the worked numbers and rationale).

**Architecture:** Pack-side decision rule computed in `CompareDrillWhatIfService.reduceComparison` via a new `normalTailProbability` helper; additive optional `decision` block on `WhatIfComparison` (mirrored UI-side); new compact decision-strip component on the funnel what-if overlay fed by a second `compareWhatIf(…, form_index)` call. Builder consolidation moves indicator keys to a leaf module and derives the in-memory drill seed from `DRILL_SUBTREES` (single source, closes the form-effect parity gap that currently blocks the live demo).

**Tech Stack:** Nx 22 + npm workspaces, NestJS 10 (`libs/pack-football`, `apps/pack-football-api`), Angular 21 signals (`libs/pack-football-ui`), zod, vitest, `@de-braighter/substrate-{contracts,runtime}` ^2.0.0.

---

## Environment & ground rules (every subagent MUST follow)

- **Workspace:** ALL work happens in the worktree `D:\development\projects\de-braighter\domains\exercir-wt-form-decision` (branch `feat/what-if-form-decision`, off `origin/main` = `eaf09cc`). **NEVER run git commands against `domains/exercir` (the main clone) or any other repo** — other sessions share them.
- **Install:** the worktree needs its own `npm install` (run once during setup; needs `GITHUB_TOKEN` with `read:packages` in the environment — `.npmrc` reads it). The main clone's `node_modules` is STALE (contracts 1.0.0); the worktree resolves ^2.0.0. Never copy node_modules from the main clone.
- **Test command quirk:** `npx nx test <project>` has an exit-1-no-summary quirk on this box. Run specs via
  `npx vitest run --config libs/pack-football/vitest.config.ts <pattern> --coverage.enabled=false`
  (adjust config path per project: `apps/pack-football-api/vitest.config.ts`, `libs/pack-football-ui/vitest.config.ts` — verify exact config filenames with Glob before first use; some projects use `vite.config.mts`).
- **Build-verify:** `npx nx build pack-football && npx nx build pack-football-api && npx nx build pack-football-ui`.
- **Lint is a separate gate:** `npx nx lint pack-football pack-football-ui pack-football-api` — `nx build`/`test` do NOT run eslint. `input(..., { alias })` is an ERROR in Angular code; never alias signal inputs.
- **ESM imports need explicit `.js` extensions** in this codebase (`import … from './indicator-keys.js'`).
- **Commit per task** from the worktree root with conventional-commit messages ending in:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- **python3 is missing** on this box — use `node -e` for any scripted checks. `/tmp` = `C:\Users\stibe\AppData\Local\Temp`.

### Worked numbers (the oracles — derived in the spec §2; do NOT re-tune)

Prior N(70, 10) (the production catalog), zero form observations ⇒ posterior = N(70 + Σmean, 10² + Σsd²) per arm. Target 70, confidence bar 0.70.

| Configuration | Posterior | P(form ≥ 70) | commit |
|---|---|---|---|
| point(+6) | N(76, 10) | 0.725747 → pin `toBeCloseTo(0.7257, 4)` | true |
| normal(+6, sd 10) | N(76, √200) | 0.664313 → pin `toBeCloseTo(0.6643, 4)` | false |
| normal(+1, sd 2) | N(71, √104) | 0.539057 → pin `toBeCloseTo(0.5391, 4)` | false |

Kernel cross-pins (same Abramowitz-Stegun formula as the kernel's `composed-effect-decision-relevance.spec.ts`): `normalTailProbability(1, 2, 1) → toBeCloseTo(0.841345, 6)`; `normalTailProbability(1, 2, Math.sqrt(5.5)) → toBeCloseTo(0.665061, 4)`.

---

### Task 1: Leaf indicator-keys module + shared effect builders

**Files:**
- Create: `libs/pack-football/src/inference/indicator-keys.ts`
- Create: `libs/pack-football/src/inference/effect-builders.ts`
- Create: `libs/pack-football/src/inference/effect-builders.spec.ts`
- Modify: `libs/pack-football/src/inference/inference-backbone.providers.ts` (re-export keys from the leaf; delete local definitions)
- Modify: `libs/pack-football/src/index.ts` (barrel-export the builders)

- [ ] **Step 1: Create `indicator-keys.ts`** — move the four constants out of `inference-backbone.providers.ts` verbatim (keep their doc comments):

```ts
/**
 * Leaf module for the pack's seeded indicator keys + evidence event types.
 * Extracted from `inference-backbone.providers.ts` so that effect builders and
 * seed modules can import them without creating an import cycle
 * (providers → drill-subtrees-seed → builders → keys).
 */
import type { IndicatorKey } from '@de-braighter/substrate-contracts/inference';

export const PASS_COMPLETION_INDICATOR_KEY =
  'football.indicator.pass_completion' as IndicatorKey;

export const FORM_INDEX_INDICATOR_KEY =
  'football.indicator.form_index' as IndicatorKey;

export const PASS_COMPLETION_EVENT_TYPE =
  'football:PassCompletionObserved.v1';
export const FORM_INDEX_EVENT_TYPE = 'football:FormIndexObserved.v1';
```

(Carry over the original doc comments for the event types from the providers file.)

- [ ] **Step 2: Re-export from `inference-backbone.providers.ts`** — delete the four local definitions there and add at the top:

```ts
export {
  FORM_INDEX_EVENT_TYPE,
  FORM_INDEX_INDICATOR_KEY,
  PASS_COMPLETION_EVENT_TYPE,
  PASS_COMPLETION_INDICATOR_KEY,
} from './indicator-keys.js';
import {
  FORM_INDEX_EVENT_TYPE,
  FORM_INDEX_INDICATOR_KEY,
  PASS_COMPLETION_EVENT_TYPE,
  PASS_COMPLETION_INDICATOR_KEY,
} from './indicator-keys.js';
```

Every existing consumer (e.g. `compare-drill-what-if.service.ts` importing `PASS_COMPLETION_INDICATOR_KEY` from the providers path) keeps compiling unchanged.

- [ ] **Step 3: Write the failing spec `effect-builders.spec.ts`:**

```ts
import { describe, expect, it } from 'vitest';

import {
  formNormalEffect,
  passPointEffect,
} from './effect-builders.js';
import {
  FORM_INDEX_INDICATOR_KEY,
  PASS_COMPLETION_INDICATOR_KEY,
} from './indicator-keys.js';
import { passCompletionLogOddsDelta } from './pass-completion-log-odds.js';

const DECL_A = 'ee000000-0000-4000-8000-000000000001';
const DECL_B = 'ee000000-0000-4000-8000-000000000002';

describe('shared ADR-154 effect builders (PR #237 follow-up 1)', () => {
  it('passPointEffect declares a point log-odds delta on pass_completion (OQ-1)', () => {
    const effect = passPointEffect(DECL_A, 1.3);
    expect(effect.indicatorId).toBe(PASS_COMPLETION_INDICATOR_KEY);
    expect(effect.magnitudePrior).toEqual({
      kind: 'point',
      value: passCompletionLogOddsDelta(1.3),
    });
    expect(effect.compositionOperator).toBe('sum');
    expect(effect.basis).toBe('expert');
    expect(effect.declarationId).toBe(DECL_A);
  });

  it('formNormalEffect declares a normal magnitude with an EXPLICIT sd (decision-material)', () => {
    const effect = formNormalEffect(DECL_B, 6, 10);
    expect(effect.indicatorId).toBe(FORM_INDEX_INDICATOR_KEY);
    expect(effect.magnitudePrior).toEqual({ kind: 'normal', mean: 6, sd: 10 });
  });

  it('builders produce schema-valid, deterministic declarations (fixed declaredAt)', () => {
    expect(passPointEffect(DECL_A, 1.05)).toEqual(passPointEffect(DECL_A, 1.05));
    expect(formNormalEffect(DECL_B, 1, 2).declaredAt).toBe('2026-05-31T00:00:00.000Z');
  });
});
```

- [ ] **Step 4: Run to verify failure** — `npx vitest run --config libs/pack-football/vitest.config.ts effect-builders --coverage.enabled=false` → FAIL (module not found).

- [ ] **Step 5: Create `effect-builders.ts`:**

```ts
/**
 * Shared ADR-154 EffectDeclaration builders (PR #237 follow-up 1) — the ONE
 * place full drill-effect declarations are authored. Replaces seven
 * near-identical local builders (4 spec-local copies + the seed's pair + the
 * providers' `drillEffect`).
 *
 *   - `passPointEffect`: beta-family point effect, log-odds additive with
 *     identity 0 (substrate ≥2.0, ADR-224 OQ-1). The human-readable
 *     multiplicative intent is re-expressed at declaration time via
 *     `passCompletionLogOddsDelta`.
 *   - `formNormalEffect`: normal-family mean-shift whose declared `sd`
 *     SURVIVES composition (the closed-form normal×normal cell, ADR-224
 *     1b-i) and is decision-material since the what-if readiness readout
 *     (specs#298 Check 2) — therefore `sd` is an explicit required argument,
 *     never a default: every call site must own its declared uncertainty.
 *
 * Charter pin (prototype no-real-PHI): magnitudes passed in are SYNTHETIC POC
 * values (`basis: 'expert'`, confidence 0.6), not calibrated estimates.
 */
import {
  EffectDeclarationSchema,
  type EffectDeclaration,
} from '@de-braighter/substrate-contracts/plan-tree';

import {
  FORM_INDEX_INDICATOR_KEY,
  PASS_COMPLETION_INDICATOR_KEY,
} from './indicator-keys.js';
import { passCompletionLogOddsDelta } from './pass-completion-log-odds.js';

/** Deterministic declaredAt for seeds — never wall-clock (replay stability). */
export const SEED_EFFECT_DECLARED_AT = '2026-05-31T00:00:00.000Z';

export function passPointEffect(
  declarationId: string,
  multiplicative: number,
  declaredAt: string = SEED_EFFECT_DECLARED_AT,
): EffectDeclaration {
  return EffectDeclarationSchema.parse({
    declarationId,
    indicatorId: PASS_COMPLETION_INDICATOR_KEY,
    direction: '+',
    magnitudePrior: {
      kind: 'point',
      value: passCompletionLogOddsDelta(multiplicative),
    },
    confidence: 0.6,
    horizon: 'P28D',
    compositionOperator: 'sum',
    commutative: true,
    basis: 'expert',
    declaredAt,
  });
}

export function formNormalEffect(
  declarationId: string,
  meanShift: number,
  sd: number,
  declaredAt: string = SEED_EFFECT_DECLARED_AT,
): EffectDeclaration {
  return EffectDeclarationSchema.parse({
    declarationId,
    indicatorId: FORM_INDEX_INDICATOR_KEY,
    direction: '+',
    magnitudePrior: { kind: 'normal', mean: meanShift, sd },
    confidence: 0.6,
    horizon: 'P28D',
    compositionOperator: 'sum',
    commutative: true,
    basis: 'expert',
    declaredAt,
  });
}
```

Before finalizing, DIFF these field values (confidence/horizon/direction/basis) against each of the seven local builders you are about to replace (listed in Task 3) — if any local copy deliberately differs, STOP and surface it rather than silently changing semantics. (Expected: all seven are identical in these fields.)

- [ ] **Step 6: Barrel-export** — in `libs/pack-football/src/index.ts`, add beside the other inference exports:

```ts
export {
  formNormalEffect,
  passPointEffect,
  SEED_EFFECT_DECLARED_AT,
} from './inference/effect-builders.js';
export {
  FORM_INDEX_EVENT_TYPE,
  FORM_INDEX_INDICATOR_KEY,
  PASS_COMPLETION_EVENT_TYPE,
  PASS_COMPLETION_INDICATOR_KEY,
} from './inference/indicator-keys.js';
```

(Check first whether the keys are ALREADY barrel-exported via the providers re-export — if so, keep one export path only; do not double-export the same names.)

- [ ] **Step 7: Run the new spec + full pack-football suite** — both green:
  `npx vitest run --config libs/pack-football/vitest.config.ts --coverage.enabled=false`

- [ ] **Step 8: Build + commit**

```bash
npx nx build pack-football
git add libs/pack-football/src/inference/indicator-keys.ts libs/pack-football/src/inference/effect-builders.ts libs/pack-football/src/inference/effect-builders.spec.ts libs/pack-football/src/inference/inference-backbone.providers.ts libs/pack-football/src/index.ts
git commit -m "feat(pack-football): shared ADR-154 effect builders + leaf indicator-keys module (#237 follow-up 1, part 1)"
```

---

### Task 2: Seed unification — DB seed on shared builders, Drill-X form sd 2→10, in-memory seed derives from DRILL_SUBTREES

**Files:**
- Modify: `libs/pack-football/src/inference/drill-subtrees-seed.ts`
- Modify: `libs/pack-football/src/inference/inference-backbone.providers.ts` (the `buildPackFootballEvidenceRepository` seed block)
- Modify: `libs/pack-football/src/inference/drill-subtrees-seed.spec.ts` (expectations)
- Modify: `libs/pack-football/src/inference/inference-backbone.providers.evidence-seed.spec.ts` (expectations)

- [ ] **Step 1: Switch `drill-subtrees-seed.ts` to the shared builders.** Delete its local `passCompletionEffect` + `formIndexEffect` functions and the `DECLARED_AT` const; import instead:

```ts
import { formNormalEffect, passPointEffect } from './effect-builders.js';
import {
  FORM_INDEX_INDICATOR_KEY,
  PASS_COMPLETION_INDICATOR_KEY,
} from './indicator-keys.js';
```

(The indicator-key import moves from `./inference-backbone.providers.js` to `./indicator-keys.js` — REQUIRED to avoid the import cycle once providers imports this module in Step 3. Keep the key imports only if still referenced in this file; drop if unused.)

Update the two subtree specs — Drill-X's form effect becomes **sd 10** (the decision-material declared uncertainty; spec §2), Drill-Y stays sd 2:

```ts
export const DRILL_X_SUBTREE: DrillSubtreeSpec = {
  drillKey: 'drill-x-press-2v2',
  rootId: SEED_TREE_DRILL_X_ROOT_ID,
  interventionId: DRILL_X_INTERVENTION_NODE_ID,
  title: 'Drill X — pressing 2v2',
  effects: [
    passPointEffect(DRILL_X_PASS_DECL_ID, 1.05),
    // +6.0 form shift declared HONESTLY uncertain (sd 10 ≈ the population
    // prior spread): an aggressive pressing block — big claimed upside,
    // uncertain transfer. sd 2 was cosmetic (4% of prior variance — no
    // decision could flip on it); sd 10 makes the declared variance
    // decision-material for the readiness readout (specs#298 Check 2).
    formNormalEffect(DRILL_X_FORM_DECL_ID, 6, 10),
  ],
};

export const DRILL_Y_SUBTREE: DrillSubtreeSpec = {
  drillKey: 'drill-y-rondo-4v4',
  rootId: SEED_TREE_DRILL_Y_ROOT_ID,
  interventionId: DRILL_Y_INTERVENTION_NODE_ID,
  title: 'Drill Y — rondo 4v4',
  effects: [
    passPointEffect(DRILL_Y_PASS_DECL_ID, 1.3),
    // Gentle, well-understood rondo nudge — proportionately small declared sd.
    formNormalEffect(DRILL_Y_FORM_DECL_ID, 1, 2),
  ],
};
```

Update the module doc-comment's "divergent winners" paragraph to mention the variance honesty (X = high-mean/high-variance form claim, Y = low-mean/low-variance).

- [ ] **Step 2: Update `drill-subtrees-seed.spec.ts`** — find any assertion pinning the form effect `sd: 2` for Drill-X (or generic magnitude equality) and update to `sd: 10`. Run:
  `npx vitest run --config libs/pack-football/vitest.config.ts drill-subtrees-seed --coverage.enabled=false` → green.

- [ ] **Step 3: Derive the in-memory seed from `DRILL_SUBTREES`.** In `inference-backbone.providers.ts`, inside `buildPackFootballEvidenceRepository`, DELETE the local `drillEffect` builder, the `DRILL_X_PLAN_NODE_ID`/`DRILL_Y_PLAN_NODE_ID` consts, the `DRILL_X_PASS_DECL_ID`/`DRILL_Y_PASS_DECL_ID` consts, `SEED_EFFECT_DECLARED_AT`, and the now-unused `EffectDeclarationSchema` + `passCompletionLogOddsDelta` + `SEED_TREE_DRILL_*_ROOT_ID` imports (keep `PASS_COMPLETION_PRIOR_ALPHA`/`BETA` for the catalog). Replace the `registerTree` call with:

```ts
import { DRILL_SUBTREES } from './drill-subtrees-seed.js';
// …
  // The in-memory drill trees ARE the DB seed's subtrees (single source of
  // truth — PR #237 follow-up 3 parity): root + lone effect-bearing
  // intervention child per drill, both indicators' declarations included, so
  // the live demo's form_index counterfactual answers off the same effects
  // the Prisma path reads from kernel.plan_node.
  evidence.registerTree(
    DRILL_SUBTREES.flatMap((spec) => [
      { id: spec.rootId, parentId: null, ordinal: 0, effects: [] },
      {
        id: spec.interventionId,
        parentId: spec.rootId,
        ordinal: 0,
        effects: [...spec.effects],
      },
    ]),
    DEMO_TENANT_PACK_ID,
  );
```

Update the surrounding comment block (the "Drill X: gentle uplift…" paragraph) accordingly. NOTE: this changes the in-memory declarationIds (the `1f7b6c1e-…` ids are gone; the seed's `e1e1d000-…` family is now authoritative) and ADDS form_index declarations to the in-memory trees — both intended.

- [ ] **Step 4: Update `inference-backbone.providers.evidence-seed.spec.ts`** — re-pin: effects read back per tree now contain BOTH indicators' declarations with the seed-file declarationIds; pass_completion log-odds values unchanged (δ(1.05)=0.1728428, δ(1.3)=1.4663370); form_index composed magnitudes normal(6,10) / normal(1,2). Follow the spec file's existing assertion style.

- [ ] **Step 5: Run the FULL pack-football and pack-football-api suites** — some specs may pin the old in-memory decl ids or the effect count; update any that do (they are assertions about the seed, not behavior contracts):
  `npx vitest run --config libs/pack-football/vitest.config.ts --coverage.enabled=false`
  `npx vitest run --config apps/pack-football-api/vitest.config.ts --coverage.enabled=false`
  Expected: green (the beta path ignores form declarations, so all pass_completion oracles hold).

- [ ] **Step 6: Build + commit**

```bash
npx nx build pack-football && npx nx build pack-football-api
git add -- libs/pack-football/src/inference/ 
git commit -m "feat(pack-football): unify drill seeds on shared builders; declare Drill-X form effect honestly uncertain (sd 10)"
```

---

### Task 3: Sweep the four spec-local builders

**Files:**
- Modify: `libs/pack-football/src/application/compare-drill-what-if.service.spec.ts`
- Modify: `libs/pack-football/src/application/compare-drill-grid.service.spec.ts`
- Modify: `libs/pack-football/src/application/compute-team-twin.service.spec.ts`
- Modify: `libs/pack-football/src/application/get-player-funnel.service.spec.ts`

- [ ] **Step 1:** In each file, delete the local `passPointEffect` (and `compare-drill-grid`'s local `formNormalEffect`) and import from the shared module instead:

```ts
import { formNormalEffect, passPointEffect } from '../inference/effect-builders.js';
```

`compare-drill-grid`'s local `formNormalEffect(declarationId, meanShift)` had NO sd parameter — check what sd it hardcoded (expected: 2) and pass it explicitly at each call site: `formNormalEffect('bbbbbbbb-…', 6, 2)`. **Do not change any magnitude in these specs** — they pin behavior oracles.

- [ ] **Step 2:** Run all four specs + drop now-unused imports (`EffectDeclarationSchema`, key imports) flagged by lint:
  `npx vitest run --config libs/pack-football/vitest.config.ts "application/" --coverage.enabled=false`
  `npx nx lint pack-football`

- [ ] **Step 3: Commit**

```bash
git add libs/pack-football/src/application/
git commit -m "refactor(pack-football): sweep spec-local ADR-154 builders onto shared effect-builders (#237 follow-up 1 complete)"
```

---

### Task 4: `normalTailProbability` helper (TDD)

**Files:**
- Create: `libs/pack-football/src/application/normal-tail-probability.spec.ts`
- Create: `libs/pack-football/src/application/normal-tail-probability.ts`

- [ ] **Step 1: Write the failing spec:**

```ts
import { describe, expect, it } from 'vitest';

import { normalTailProbability } from './normal-tail-probability.js';

describe('normalTailProbability — P(X ≥ target), X ~ N(mean, sd)', () => {
  // Cross-pins against the kernel's composed-effect-decision-relevance.spec.ts
  // oracles (same Abramowitz-Stegun 7.1.26 approximation, |err| < 1.5e-7).
  it('matches the kernel decision-relevance oracle (point condition): P(X≥1), N(2,1)', () => {
    expect(normalTailProbability(1, 2, 1)).toBeCloseTo(0.841345, 6);
  });

  it('matches the kernel decision-relevance oracle (normal condition): P(X≥1), N(2,√5.5)', () => {
    expect(normalTailProbability(1, 2, Math.sqrt(5.5))).toBeCloseTo(0.665061, 4);
  });

  // The readiness-decision worked numbers (design spec §2): prior N(70,10),
  // zero observations, target 70.
  it('point(+6): P(X≥70), N(76,10) ≈ 0.7257 (clears the 0.70 bar)', () => {
    expect(normalTailProbability(70, 76, 10)).toBeCloseTo(0.7257, 4);
  });

  it('normal(+6,sd 10): P(X≥70), N(76,√200) ≈ 0.6643 (misses the 0.70 bar)', () => {
    expect(normalTailProbability(70, 76, Math.sqrt(200))).toBeCloseTo(0.6643, 4);
  });

  it('normal(+1,sd 2): P(X≥70), N(71,√104) ≈ 0.5391', () => {
    expect(normalTailProbability(70, 71, Math.sqrt(104))).toBeCloseTo(0.5391, 4);
  });

  it('is symmetric around the mean: P(X≥mean) = 0.5', () => {
    expect(normalTailProbability(70, 70, 10)).toBeCloseTo(0.5, 9);
  });

  it('degenerates to a step for sd ≤ 0', () => {
    expect(normalTailProbability(70, 76, 0)).toBe(1);
    expect(normalTailProbability(70, 64, 0)).toBe(0);
    expect(normalTailProbability(70, 70, 0)).toBe(1); // mean ≥ target
  });

  it('is monotonically decreasing in sd when mean > target (widening erodes confidence)', () => {
    const tight = normalTailProbability(70, 76, 5);
    const wide = normalTailProbability(70, 76, 20);
    expect(tight).toBeGreaterThan(wide);
    expect(wide).toBeGreaterThan(0.5);
  });
});
```

- [ ] **Step 2: Verify FAIL** (module not found), then implement:

```ts
/**
 * P(X ≥ target) for X ~ Normal(mean, sd) — the pack-side decision primitive
 * for variance-aware posterior readouts (the ADR-224 consumer half of the
 * specs#298 Check-2 closure). Standard-normal CDF via Abramowitz-Stegun
 * 7.1.26 (|error| < 1.5×10⁻⁷) — the same approximation the kernel's
 * `composed-effect-decision-relevance.spec.ts` uses; substrate exports no
 * forward CDF (only `standardNormalInverseCdf`), so the pack carries its own.
 *
 * `sd ≤ 0` degenerates to the point-mass step (a composed point effect has
 * zero variance contribution but the posterior keeps the prior's sd, so this
 * arm is defensive, not a live demo path).
 */
export function normalTailProbability(
  target: number,
  mean: number,
  sd: number,
): number {
  if (sd <= 0) return mean >= target ? 1 : 0;
  return 1 - standardNormalCdf((target - mean) / sd);
}

/** Abramowitz-Stegun 7.1.26 erf-based Φ. */
function standardNormalCdf(x: number): number {
  const z = x / Math.SQRT2;
  const sign = z < 0 ? -1 : 1;
  const az = Math.abs(z);
  const p = 0.3275911;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const t = 1 / (1 + p * az);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-az * az);
  return 0.5 * (1 + sign * y);
}
```

- [ ] **Step 3: Run to green**, then commit:

```bash
git add libs/pack-football/src/application/normal-tail-probability.ts libs/pack-football/src/application/normal-tail-probability.spec.ts
git commit -m "feat(pack-football): normalTailProbability — pack-side tail-prob decision primitive"
```

---

### Task 5: Decision schema + service computation

**Files:**
- Modify: `libs/pack-football/src/in-ports/compare-drill-what-if.use-case.ts`
- Modify: `libs/pack-football/src/application/compare-drill-what-if.service.ts`
- Modify: `libs/pack-football/src/application/compare-drill-what-if.service.spec.ts`

- [ ] **Step 1: Extend the in-port schemas.** In `compare-drill-what-if.use-case.ts`, after `WhatIfDirection`:

```ts
/** Per-arm readiness verdict: P(posterior ≥ target) under this arm's tree. */
export const WhatIfArmDecisionSchema = z.object({
  probabilityAtOrAboveTarget: z.number().min(0).max(1),
  commit: z.boolean(),
});
export type WhatIfArmDecision = z.infer<typeof WhatIfArmDecisionSchema>;

/**
 * The variance-aware readiness decision (specs#298 Check 2 closure): commit ⇔
 * P(posterior ≥ target) ≥ confidenceBar, evaluated PER ARM from the arm's full
 * posterior (mean, sd). The declared effect variance (ADR-224) widens sd, so
 * two arms with IDENTICAL posterior means can carry opposite `commit`
 * verdicts — the decision the retired pre-2.0 scalar path could not express
 * (kernel mirror: substrate's `composed-effect-decision-relevance.spec.ts`).
 * Present only for indicators with a pack-side rule
 * (`WHAT_IF_DECISION_RULES` — form_index only today); absent otherwise.
 */
export const WhatIfDecisionSchema = z.object({
  /** The readiness bar on the indicator's own scale (form_index: /100). */
  target: z.number(),
  /** Minimum tail probability to commit (the kernel regression's 0.70). */
  confidenceBar: z.number().min(0).max(1),
  baseline: WhatIfArmDecisionSchema,
  counterfactual: WhatIfArmDecisionSchema,
});
export type WhatIfDecision = z.infer<typeof WhatIfDecisionSchema>;
```

and on `WhatIfComparisonSchema` (after `direction`):

```ts
  /** Variance-aware readiness decision — present only for rule-bearing indicators. */
  decision: WhatIfDecisionSchema.optional(),
```

`MultiWhatIfComparisonSchema` is deliberately NOT extended (no consumer — YAGNI; note it in the multi-arm comment block).

- [ ] **Step 2: Compute it in the service.** In `compare-drill-what-if.service.ts`:

Imports: change the providers import to also pull the form key from the leaf module, and add the helper + type:

```ts
import {
  FORM_INDEX_INDICATOR_KEY,
  PASS_COMPLETION_INDICATOR_KEY,
} from '../inference/indicator-keys.js';
import { normalTailProbability } from './normal-tail-probability.js';
import type { WhatIfDecision } from '../in-ports/compare-drill-what-if.use-case.js';
```

(Remove the old `PASS_COMPLETION_INDICATOR_KEY` import from `inference-backbone.providers.js`.)

In the helpers section (beside `INDICATOR_POLARITY`):

```ts
/**
 * Pack-local what-if decision rules (specs#298 Check 2): the ONE coach-facing
 * readiness decision — commit a player to a drill block iff
 * P(form_index ≥ target) ≥ confidenceBar.
 *
 *   - `target: 70` — the /100 readiness bar; equals the catalog's population
 *     prior mean (N(70,10)): "at or above average form".
 *   - `confidenceBar: 0.70` — the kernel decision-relevance regression's
 *     DECISION_THRESHOLD, reused verbatim.
 *
 * Declared ONLY for indicators whose moment posterior is normal-shaped (the
 * normal×normal cell, where ADR-224 propagates declared effect variance into
 * sd). pass_completion (beta×point) carries no rule: its point effects add no
 * variance and its posterior is Beta — a normal tail there would be both
 * meaningless for the flip and approximate for the math.
 */
interface WhatIfDecisionRule {
  readonly target: number;
  readonly confidenceBar: number;
}

const WHAT_IF_DECISION_RULES: Readonly<Record<string, WhatIfDecisionRule>> = {
  [FORM_INDEX_INDICATOR_KEY]: { target: 70, confidenceBar: 0.7 },
};

function decisionOf(
  indicatorKey: string,
  baseline: PosteriorSummary,
  counterfactual: PosteriorSummary,
): WhatIfDecision | undefined {
  const rule = WHAT_IF_DECISION_RULES[indicatorKey];
  if (!rule) return undefined;
  const armDecision = (summary: PosteriorSummary) => {
    const probabilityAtOrAboveTarget = normalTailProbability(
      rule.target,
      summary.mean,
      summary.sd,
    );
    return {
      probabilityAtOrAboveTarget,
      commit: probabilityAtOrAboveTarget >= rule.confidenceBar,
    };
  };
  return {
    target: rule.target,
    confidenceBar: rule.confidenceBar,
    baseline: armDecision(baseline),
    counterfactual: armDecision(counterfactual),
  };
}
```

In `reduceComparison`, add to the `WhatIfComparisonSchema.safeParse({...})` object (after `direction`):

```ts
      decision: decisionOf(indicatorKey, narrowed.baseline, narrowed.counterfactual),
```

- [ ] **Step 3: Extend the service spec** (`compare-drill-what-if.service.spec.ts`) with two cases following the file's existing harness conventions:
  1. a form_index comparison (seed trees with `formNormalEffect`) asserting `result.value.decision` is defined, `target === 70`, `confidenceBar === 0.7`, and per-arm `commit === (probabilityAtOrAboveTarget >= 0.7)`;
  2. a pass_completion comparison asserting `result.value.decision` is `undefined`.

- [ ] **Step 4: Run + commit**

```bash
npx vitest run --config libs/pack-football/vitest.config.ts compare-drill-what-if --coverage.enabled=false
git add libs/pack-football/src/in-ports/compare-drill-what-if.use-case.ts libs/pack-football/src/application/compare-drill-what-if.service.ts libs/pack-football/src/application/compare-drill-what-if.service.spec.ts
git commit -m "feat(pack-football): variance-aware readiness decision block on the what-if comparison"
```

---

### Task 6: The de-synthesizing regression — `what-if-decision-relevance.spec.ts`

**Files:**
- Create: `libs/pack-football/src/application/what-if-decision-relevance.spec.ts`

This is the pack-level mirror of the kernel's `composed-effect-decision-relevance.spec.ts` — through the REAL `CompareDrillWhatIfService` + `InferenceBackboneRouter` + the PRODUCTION catalog/seed builders. Read `compare-drill-what-if.service.spec.ts` first and reuse its router-construction harness EXACTLY (6-arg ctor: catalog, evidence, sidecar `null`, member resolution, distribution catalog, no-op recorder — mirror whatever the existing spec passes).

- [ ] **Step 1: Write the spec:**

```ts
/**
 * specs#298 Check-2 closure regression — the COACH-FACING mirror of the
 * kernel's `composed-effect-decision-relevance.spec.ts` (substrate-runtime):
 * the SAME +6 form_index mean shift, declared as a `point` on one arm and as
 * `normal(6, sd 10)` on the other, produces IDENTICAL posterior means but
 * OPPOSITE readiness verdicts through the real what-if path (production
 * catalog: prior N(70,10); zero-observation subject ⇒ posterior = shifted
 * prior exactly).
 *
 * The retired pre-2.0 scalar path (reduceMagnitude) discarded declared sd —
 * it would have committed BOTH arms. This spec pins the flip as a permanent
 * pack-level regression gate; the live seed case below pins the demo numbers
 * the funnel overlay shows.
 */
import { describe, expect, it } from 'vitest';

import {
  EffectDeclarationSchema,
} from '@de-braighter/substrate-contracts/plan-tree';

import { CompareDrillWhatIfService } from './compare-drill-what-if.service.js';
import { formNormalEffect } from '../inference/effect-builders.js';
import { FORM_INDEX_INDICATOR_KEY } from '../inference/indicator-keys.js';
import {
  buildPackFootballEvidenceRepository,
  buildPackFootballInferenceCatalog,
  DEMO_TENANT_PACK_ID,
  SEEDED_YOUTH_CALLUP_PLAYER_ID,
} from '../inference/inference-backbone.providers.js';
import {
  SEED_TREE_DRILL_X_ROOT_ID,
  SEED_TREE_DRILL_Y_ROOT_ID,
} from '../out-ports/in-memory-plan-tree.repository.js';

// ── point-vs-normal contrast fixtures (dddddddd- prefix: unique to this spec) ──
const TREE_POINT = 'dddddddd-0000-4000-8000-000000000001';
const TREE_NORMAL = 'dddddddd-0000-4000-8000-000000000002';
/** Zero observations under ANY indicator — posterior = shifted prior exactly. */
const NO_HISTORY_SUBJECT = 'dddddddd-0000-4000-8000-00000000007a';

/**
 * A `point` form effect — spec-local on purpose: the point-vs-normal contrast
 * is THIS spec's subject, not a seed shape (the shared builders deliberately
 * offer only the production families: pass=point/log-odds, form=normal).
 */
const formPointEffect = (declarationId: string, value: number) =>
  EffectDeclarationSchema.parse({
    declarationId,
    indicatorId: FORM_INDEX_INDICATOR_KEY,
    direction: '+',
    magnitudePrior: { kind: 'point', value },
    confidence: 0.6,
    horizon: 'P28D',
    compositionOperator: 'sum',
    commutative: true,
    basis: 'expert',
    declaredAt: '2026-05-31T00:00:00.000Z',
  });

// (Harness: build the router exactly as compare-drill-what-if.service.spec.ts
// does — same imports for InferenceBackboneRouter, InMemoryEvidenceRepository,
// member resolution, distribution catalog, and recorder no-op.)

describe('specs#298 Check 2 — declared effect variance flips the coach readiness decision', () => {
  it('FLIP: identical +6 mean shift — point arm commits (p≈0.7257), normal(6,10) arm does not (p≈0.6643)', async () => {
    // seed: two single-node trees, point(+6) vs normal(6,10), zero-obs subject
    // … evidence.registerTree([
    //   { id: TREE_POINT, parentId: null, ordinal: 0, effects: [formPointEffect('dddddddd-0000-4000-8000-000000000011', 6)] },
    //   { id: TREE_NORMAL, parentId: null, ordinal: 0, effects: [formNormalEffect('dddddddd-0000-4000-8000-000000000012', 6, 10)] },
    // ], DEMO_TENANT_PACK_ID);
    // service = new CompareDrillWhatIfService(router);
    const result = await service.compare({
      tenantPackId: DEMO_TENANT_PACK_ID,
      playerSubjectRef: { kind: 'individual', id: NO_HISTORY_SUBJECT, role: 'football.player' },
      baselineTreeRootId: TREE_POINT,
      counterfactualTreeRootId: TREE_NORMAL,
      indicatorKey: FORM_INDEX_INDICATOR_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const c = result.value;

    // identical posterior means — the flip is variance-only
    expect(c.baseline.mean).toBeCloseTo(76, 9);
    expect(c.counterfactual.mean).toBeCloseTo(76, 9);
    expect(c.liftMean).toBeCloseTo(0, 9);
    // the declared sd widens ONLY the normal arm: √(10²) vs √(10²+10²)
    expect(c.baseline.sd).toBeCloseTo(10, 6);
    expect(c.counterfactual.sd).toBeCloseTo(Math.sqrt(200), 6);

    const d = c.decision;
    expect(d).toBeDefined();
    if (!d) throw new Error('decision missing');
    expect(d.baseline.probabilityAtOrAboveTarget).toBeCloseTo(0.7257, 4);
    expect(d.counterfactual.probabilityAtOrAboveTarget).toBeCloseTo(0.6643, 4);
    // THE FLIP — same mean, opposite verdicts (pre-2.0 scalar path: both true)
    expect(d.baseline.commit).toBe(true);
    expect(d.counterfactual.commit).toBe(false);
  });

  it('live demo seed: youth call-up, Drill X normal(6,10) vs Drill Y normal(1,2) — neither commits (the honest readout)', async () => {
    // evidence = buildPackFootballEvidenceRepository() — the PRODUCTION seed
    const result = await service.compare({
      tenantPackId: DEMO_TENANT_PACK_ID,
      playerSubjectRef: { kind: 'individual', id: SEEDED_YOUTH_CALLUP_PLAYER_ID, role: 'football.player' },
      baselineTreeRootId: SEED_TREE_DRILL_X_ROOT_ID,
      counterfactualTreeRootId: SEED_TREE_DRILL_Y_ROOT_ID,
      indicatorKey: FORM_INDEX_INDICATOR_KEY,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    const d = result.value.decision;
    expect(d).toBeDefined();
    if (!d) throw new Error('decision missing');
    expect(result.value.baseline.mean).toBeCloseTo(76, 9);
    expect(result.value.counterfactual.mean).toBeCloseTo(71, 9);
    expect(d.baseline.probabilityAtOrAboveTarget).toBeCloseTo(0.6643, 4);
    expect(d.baseline.commit).toBe(false); // +6 claimed, but too uncertain to commit
    expect(d.counterfactual.probabilityAtOrAboveTarget).toBeCloseTo(0.5391, 4);
    expect(d.counterfactual.commit).toBe(false);
  });

  it('pass_completion carries NO decision block (no rule for the beta×point cell)', async () => {
    // evidence = buildPackFootballEvidenceRepository(); default indicator
    const result = await service.compare({
      tenantPackId: DEMO_TENANT_PACK_ID,
      playerSubjectRef: { kind: 'individual', id: SEEDED_YOUTH_CALLUP_PLAYER_ID, role: 'football.player' },
      baselineTreeRootId: SEED_TREE_DRILL_X_ROOT_ID,
      counterfactualTreeRootId: SEED_TREE_DRILL_Y_ROOT_ID,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.decision).toBeUndefined();
  });
});
```

The `// …` harness lines are the parts to fill from the existing spec's conventions (router construction, the catalog from `buildPackFootballInferenceCatalog()`, `InMemoryEvidenceRepository` for the contrast test vs `buildPackFootballEvidenceRepository()` for the live-seed tests, the subject `role` value used by sibling specs). Everything else (ids, magnitudes, oracles, assertions) is FIXED — do not re-derive.

- [ ] **Step 2: Run to green:**
  `npx vitest run --config libs/pack-football/vitest.config.ts what-if-decision-relevance --coverage.enabled=false`

- [ ] **Step 3: Commit**

```bash
git add libs/pack-football/src/application/what-if-decision-relevance.spec.ts
git commit -m "test(pack-football): decision-relevance regression — variance flips the coach readiness verdict (specs#298 Check 2)"
```

---

### Task 7: Exhaustive error switch (#237 follow-up 4)

**Files:**
- Modify: `libs/pack-football/src/application/translate-inference-error.ts`
- Modify: `libs/pack-football/src/application/translate-inference-error.spec.ts`

- [ ] **Step 1: Replace the `default` arm** with explicit routing for all 12 remaining kinds + a `never` guard. Keep the five existing arms byte-identical; append:

```ts
    // ── transient infrastructure → inference-unavailable (HTTP 503) ──────────
    case 'timeout':
      return {
        kind: 'inference-unavailable',
        detail: `substrate inference timed out after ${error.elapsedMs}ms (deadline ${error.deadlineMs}ms)`,
      };
    case 'sidecar-unavailable':
      return {
        kind: 'inference-unavailable',
        detail: `inference sidecar unavailable: ${error.detail}`,
      };
    case 'latency-budget-exceeded':
      return {
        kind: 'inference-unavailable',
        detail: `substrate latency budget exceeded: ${error.elapsedMs}ms > ${error.budgetMs}ms`,
      };
    // ── structural / caller-addressable → invalid-input (HTTP 400) ───────────
    case 'tree-not-found':
      return {
        kind: 'invalid-input',
        detail: `plan tree ${error.treeRootId} not found`,
      };
    case 'identifiability-undefined':
      return {
        kind: 'invalid-input',
        detail: `causal query not identifiable: ${error.reason}`,
      };
    case 'distribution-not-in-catalog':
      return {
        kind: 'invalid-input',
        detail: `distribution '${error.distributionName}' is not in the catalog`,
      };
    case 'curve-not-in-catalog':
      return {
        kind: 'invalid-input',
        detail: `curve '${error.curveName}' is not in the catalog`,
      };
    // ── generic runtime tail → inference-failed (HTTP 500; detail names the kind)
    case 'cancelled':
      return {
        kind: 'inference-failed',
        detail: `substrate inference cancelled: ${error.reason}`,
      };
    case 'cohort-too-small':
      return {
        kind: 'inference-failed',
        detail: `cohort too small: ${error.cohortSize} < required ${error.minRequired}`,
      };
    case 'positivity-violated':
      return {
        kind: 'inference-failed',
        detail: `positivity violated for cohort '${error.cohort}' under treatment '${error.treatment}'`,
      };
    case 'handle-expired':
      return {
        kind: 'inference-failed',
        detail: `posterior handle expired: ${error.handleId}`,
      };
    case 'internal':
      return {
        kind: 'inference-failed',
        detail: `substrate internal inference error: ${error.detail}`,
      };
    default: {
      // Compile-time exhaustiveness: a NEW substrate error kind fails the build
      // here instead of silently mislabelling as a generic failure (the exact
      // hazard the old `default` arm carried — PR #237 follow-up 4).
      const _exhaustive: never = error;
      return {
        kind: 'inference-failed',
        detail: `substrate inference error kind=${(_exhaustive as { kind: string }).kind}`,
      };
    }
```

Update the module doc-comment's "Handled arms" table to the three-bucket routing. If the field names above don't match the installed 2.0.0 d.ts exactly (`node_modules/@de-braighter/substrate-contracts/dist/primitives/error-envelope.d.ts` IN THE WORKTREE — the fresh ^2.0.0 install), adjust the detail strings to the actual fields; the kind→pack-kind routing is fixed.

- [ ] **Step 2: Extend the spec** — add one `it.each` over the 12 new kinds asserting the mapped pack kind (table: timeout/sidecar-unavailable/latency-budget-exceeded → `inference-unavailable`; tree-not-found/identifiability-undefined/distribution-not-in-catalog/curve-not-in-catalog → `invalid-input`; cancelled/cohort-too-small/positivity-violated/handle-expired/internal → `inference-failed`), each with a minimal valid error object per the union's fields. Follow the existing spec file's style.

- [ ] **Step 3: Run + commit**

```bash
npx vitest run --config libs/pack-football/vitest.config.ts translate-inference-error --coverage.enabled=false
npx nx build pack-football
git add libs/pack-football/src/application/translate-inference-error.ts libs/pack-football/src/application/translate-inference-error.spec.ts
git commit -m "fix(pack-football): exhaustive InferenceErrorPhase1 switch with never-guard (#237 follow-up 4)"
```

---

### Task 8: Controller integration proof (real AppModule)

**Files:**
- Modify: `apps/pack-football-api/src/app/pack-football.controller.spec.ts`

- [ ] **Step 1:** In the existing `describe('PackFootballHttpController — what-if against the real inference backbone (#169)')` block (real `AppModule`, no overrides), add:

```ts
  it('answers a form_index what-if for the youth call-up WITH the variance-aware readiness decision (specs#298 Check 2)', async () => {
    const response = await request(app.getHttpServer())
      .post(`/pack-football/players/${SEEDED_YOUTH_CALLUP_PLAYER_ID}/what-if`)
      .set(DEMO_HEADERS) // ← reuse whatever auth/tenant headers the sibling tests in this describe use
      .send({
        baselineTreeRootId: SEED_TREE_DRILL_X_ROOT_ID,
        counterfactualTreeRootId: SEED_TREE_DRILL_Y_ROOT_ID,
        indicatorKey: 'football.indicator.form_index',
      })
      .expect(201); // ← mirror the sibling tests' expected status

    const body = response.body;
    // zero form readings ⇒ posterior = shifted prior exactly (spec §2)
    expect(body.baseline.mean).toBeCloseTo(76, 6);
    expect(body.counterfactual.mean).toBeCloseTo(71, 6);
    expect(body.decision).toBeDefined();
    expect(body.decision.target).toBe(70);
    expect(body.decision.confidenceBar).toBeCloseTo(0.7, 9);
    expect(body.decision.baseline.probabilityAtOrAboveTarget).toBeCloseTo(0.6643, 4);
    expect(body.decision.baseline.commit).toBe(false);
    expect(body.decision.counterfactual.probabilityAtOrAboveTarget).toBeCloseTo(0.5391, 4);
    expect(body.decision.counterfactual.commit).toBe(false);
  });
```

Adapt the two `← mirror` points to the sibling tests' exact conventions (headers helper, expected status code, how tree-root ids are imported in this file).

- [ ] **Step 2: Run + commit**

```bash
npx vitest run --config apps/pack-football-api/vitest.config.ts pack-football.controller --coverage.enabled=false
git add apps/pack-football-api/src/app/pack-football.controller.spec.ts
git commit -m "test(pack-football-api): real-backbone form_index what-if returns the readiness decision end-to-end"
```

---

### Task 9: UI wire-schema mirror

**Files:**
- Modify: `libs/pack-football-ui/src/lib/data/wire-schemas.ts`
- Modify: `libs/pack-football-ui/src/lib/data/wire-schemas-parity.spec.ts`

- [ ] **Step 1: Mirror the decision schemas.** In `wire-schemas.ts`, before `WhatIfComparisonWireSchema`:

```ts
export const WhatIfArmDecisionWireSchema = z.object({
  probabilityAtOrAboveTarget: z.number().min(0).max(1),
  commit: z.boolean(),
});
export type WhatIfArmDecisionWire = z.infer<typeof WhatIfArmDecisionWireSchema>;

/** Variance-aware readiness decision (specs#298 Check 2) — see the canonical
 *  `WhatIfDecisionSchema` in `compare-drill-what-if.use-case.ts`. */
export const WhatIfDecisionWireSchema = z.object({
  target: z.number(),
  confidenceBar: z.number().min(0).max(1),
  baseline: WhatIfArmDecisionWireSchema,
  counterfactual: WhatIfArmDecisionWireSchema,
});
export type WhatIfDecisionWire = z.infer<typeof WhatIfDecisionWireSchema>;
```

and on `WhatIfComparisonWireSchema` (after `direction`):

```ts
  /** Variance-aware readiness decision — present only for rule-bearing indicators. */
  decision: WhatIfDecisionWireSchema.optional(),
```

WHY the mirror matters: `SubstrateClient.compareWhatIf` zod-parses the response — zod object schemas STRIP unknown keys, so without this mirror the server's `decision` would silently vanish client-side.

- [ ] **Step 2: Extend `wire-schemas-parity.spec.ts`** — in the `WhatIfComparison wire-schema parity` describe: (a) extend the representative fixture with a `decision` block (`target: 70, confidenceBar: 0.7, baseline: { probabilityAtOrAboveTarget: 0.6643, commit: false }, counterfactual: { probabilityAtOrAboveTarget: 0.5391, commit: false }`) and assert it survives parsing (`result.data.decision?.baseline.commit === false`); (b) keep/add a fixture WITHOUT `decision` proving back-compat parses. If the file carries source-text contains-checks against the canonical use-case file (the TeamTwin pattern at the bottom), add `'WhatIfDecisionSchema'` + `'decision: WhatIfDecisionSchema.optional()'` entries following that pattern.

- [ ] **Step 3: Run + commit**

```bash
npx vitest run --config libs/pack-football-ui/vitest.config.ts wire-schemas-parity --coverage.enabled=false
git add libs/pack-football-ui/src/lib/data/wire-schemas.ts libs/pack-football-ui/src/lib/data/wire-schemas-parity.spec.ts
git commit -m "feat(pack-football-ui): mirror the what-if decision block in the wire schemas"
```

---

### Task 10: Decision-strip component + i18n

**Files:**
- Create: `libs/pack-football-ui/src/lib/player/ui/what-if-decision-strip.component.ts`
- Create: `libs/pack-football-ui/src/lib/player/ui/what-if-decision-strip.component.spec.ts`
- Modify: `libs/pack-football-ui/src/lib/player/ui/funnel-i18n.ts`
- Modify: `libs/pack-football-ui/src/lib/i18n/de/funnel.json`
- Modify: `libs/pack-football-ui/src/lib/i18n/en/funnel.json`

- [ ] **Step 1: Add i18n keys.** In `FUNNEL_MESSAGES_DE` (and BOTH JSON bundles — `funnel-i18n.parity.spec.ts` enforces TS-map ⇄ `de/funnel.json` equality and the `en` bundle keeps key-parity):

```ts
  'funnel.decision.title': 'Einsatz-Entscheid · Form-Index',
  'funnel.decision.rule':
    'Commit, wenn P(Form ≥ {target}) mindestens {bar} erreicht.',
  'funnel.decision.arm.probability': 'P(Form ≥ {target}) = {probability}',
  'funnel.decision.verdict.commit': 'Commit',
  'funnel.decision.verdict.hold': 'Kein Commit — zu unsicher',
  'funnel.decision.computing': 'Form-Entscheid wird berechnet…',
  'funnel.decision.unavailable': 'Form-Entscheid nicht verfügbar ({reason}).',
  'funnel.decision.sr':
    'Einsatz-Entscheid für den Form-Index: {baselineLabel} {baselineVerdict} mit {baselineProbability} Prozent Konfidenz, {counterfactualLabel} {counterfactualVerdict} mit {counterfactualProbability} Prozent Konfidenz. Schwelle: {bar} Prozent für Form mindestens {target}.',
```

For `en/funnel.json`, add the same keys with English drafts (e.g. `'Deployment decision · form index'`, `'Commit when P(form ≥ {target}) reaches at least {bar}.'`, `'Commit'`, `'No commit — too uncertain'`, …). Add interpolation helpers to `funnel-i18n.ts` following the existing `chromeSrDelta` style:

```ts
/** "Commit, wenn P(Form ≥ {target}) mindestens {bar} erreicht." */
export function decisionRuleLabel(target: number, barPct: string): string {
  return funnelMsg('funnel.decision.rule')
    .replace('{target}', String(target))
    .replace('{bar}', barPct);
}

/** "P(Form ≥ {target}) = {probability}" per-arm probability line. */
export function decisionArmProbability(target: number, probabilityPct: string): string {
  return funnelMsg('funnel.decision.arm.probability')
    .replace('{target}', String(target))
    .replace('{probability}', probabilityPct);
}

/** "Form-Entscheid nicht verfügbar ({reason})." */
export function decisionUnavailableLabel(reason: string): string {
  return funnelMsg('funnel.decision.unavailable').replace('{reason}', reason);
}

/** The full screen-reader sentence for the decision strip. */
export function decisionSrSummary(args: {
  baselineLabel: string;
  baselineVerdict: string;
  baselineProbabilityPct: string;
  counterfactualLabel: string;
  counterfactualVerdict: string;
  counterfactualProbabilityPct: string;
  target: number;
  barPct: string;
}): string {
  return funnelMsg('funnel.decision.sr')
    .replace('{baselineLabel}', args.baselineLabel)
    .replace('{baselineVerdict}', args.baselineVerdict)
    .replace('{baselineProbability}', args.baselineProbabilityPct)
    .replace('{counterfactualLabel}', args.counterfactualLabel)
    .replace('{counterfactualVerdict}', args.counterfactualVerdict)
    .replace('{counterfactualProbability}', args.counterfactualProbabilityPct)
    .replace('{target}', String(args.target))
    .replace('{bar}', args.barPct);
}
```

- [ ] **Step 2: Create the component.** Presentational, OnPush, signals, NO aliased inputs (lint error). Follow `PlayerWhatIfChromeComponent`'s structural conventions (styles var palette, `data-testid`s, `.sr-only` class):

```ts
/**
 * WhatIfDecisionStripComponent — the variance-aware readiness decision
 * (specs#298 Check 2): per arm, P(form_index ≥ target) + a commit/hold
 * verdict. Verdicts are NEVER colour-only (icon + text, WCAG 1.4.1); a single
 * sr-only sentence summarizes both arms. Presentational: the host page feeds
 * it the `decision` block from the form_index `/what-if` response.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';

import type { WhatIfDecisionWire } from '../../data/wire-schemas.js';
import {
  decisionArmProbability,
  decisionRuleLabel,
  decisionSrSummary,
  funnelMsg,
} from './funnel-i18n.js';

const pct = (p: number): string => (p * 100).toFixed(1);

@Component({
  selector: 'lib-what-if-decision-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        --rule: var(--color-hair, rgba(255, 255, 255, 0.18));
        --ink: var(--color-ink, currentColor);
        --ink-3: var(--color-ink-3, color-mix(in oklab, currentColor 60%, transparent));
      }
      .strip {
        border: 1px solid var(--rule);
        border-radius: 4px;
        padding: 12px 14px;
        margin-top: 12px;
      }
      .title {
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--ink-3);
        margin: 0 0 8px;
      }
      .rule-line {
        font-size: 12px;
        color: var(--ink-3);
        margin: 0 0 10px;
      }
      .arm-row {
        display: flex;
        align-items: baseline;
        gap: 10px;
        margin: 4px 0;
        font-size: 14px;
        color: var(--ink);
      }
      .arm-label {
        font-family: var(--font-mono, monospace);
        font-size: 12px;
        min-width: 9em;
      }
      .verdict {
        font-weight: 600;
      }
      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }
    `,
  ],
  template: `
    <section class="strip" data-testid="what-if-decision-strip">
      <p class="title" data-testid="decision-title" aria-hidden="true">
        {{ titleLabel }}
      </p>
      <p class="rule-line" data-testid="decision-rule" aria-hidden="true">
        {{ ruleLabel() }}
      </p>
      @for (arm of arms(); track arm.testId) {
        <p class="arm-row" aria-hidden="true" [attr.data-testid]="arm.testId">
          <span class="arm-label">{{ arm.label }}</span>
          <span data-testid="decision-probability-{{ arm.key }}">{{ arm.probabilityLine }}</span>
          <span class="verdict" [attr.data-testid]="'decision-verdict-' + arm.key"
            >{{ arm.icon }} {{ arm.verdict }}</span
          >
        </p>
      }
      <span class="sr-only" data-testid="decision-sr">{{ srSummary() }}</span>
    </section>
  `,
})
export class WhatIfDecisionStripComponent {
  readonly decision = input.required<WhatIfDecisionWire>();
  readonly baselineLabel = input.required<string>();
  readonly counterfactualLabel = input.required<string>();

  protected readonly titleLabel = funnelMsg('funnel.decision.title');

  protected readonly ruleLabel = computed(() =>
    decisionRuleLabel(this.decision().target, pct(this.decision().confidenceBar)),
  );

  protected readonly arms = computed(() => {
    const d = this.decision();
    const arm = (
      key: 'baseline' | 'counterfactual',
      label: string,
      a: WhatIfDecisionWire['baseline'],
    ) => ({
      key,
      testId: `decision-arm-${key}`,
      label,
      probabilityLine: decisionArmProbability(d.target, pct(a.probabilityAtOrAboveTarget)),
      icon: a.commit ? '✓' : '✕',
      verdict: funnelMsg(a.commit ? 'funnel.decision.verdict.commit' : 'funnel.decision.verdict.hold'),
    });
    return [
      arm('baseline', this.baselineLabel(), d.baseline),
      arm('counterfactual', this.counterfactualLabel(), d.counterfactual),
    ];
  });

  protected readonly srSummary = computed(() => {
    const d = this.decision();
    const verdict = (commit: boolean) =>
      funnelMsg(commit ? 'funnel.decision.verdict.commit' : 'funnel.decision.verdict.hold');
    return decisionSrSummary({
      baselineLabel: this.baselineLabel(),
      baselineVerdict: verdict(d.baseline.commit),
      baselineProbabilityPct: pct(d.baseline.probabilityAtOrAboveTarget),
      counterfactualLabel: this.counterfactualLabel(),
      counterfactualVerdict: verdict(d.counterfactual.commit),
      counterfactualProbabilityPct: pct(d.counterfactual.probabilityAtOrAboveTarget),
      target: d.target,
      barPct: pct(d.confidenceBar),
    });
  });
}
```

(If the Angular version rejects `data-testid="decision-probability-{{ arm.key }}"` interpolation in a plain attribute, use `[attr.data-testid]="'decision-probability-' + arm.key"` — match the binding style used elsewhere.)

- [ ] **Step 3: Component spec** (`what-if-decision-strip.component.spec.ts`) — follow `player-what-if-chrome.component.spec.ts` harness conventions. Fixture: `{ target: 70, confidenceBar: 0.7, baseline: { probabilityAtOrAboveTarget: 0.6643, commit: false }, counterfactual: { probabilityAtOrAboveTarget: 0.5391, commit: false } }`, labels `'drill-x-press-2v2'`/`'drill-y-rondo-4v4'`. Assert: (1) both verdicts render the HOLD text ('Kein Commit — zu unsicher') with the ✕ icon; (2) probability lines contain '66.4' and '53.9'; (3) the sr-only sentence exists and contains both labels + the bar; (4) a commit=true fixture renders '✓ Commit'.

- [ ] **Step 4: Run the component spec + the funnel-i18n parity spec; fix JSON key drift if parity fails. Commit:**

```bash
npx vitest run --config libs/pack-football-ui/vitest.config.ts "what-if-decision-strip|funnel-i18n" --coverage.enabled=false
git add libs/pack-football-ui/src/lib/player/ui/what-if-decision-strip.component.ts libs/pack-football-ui/src/lib/player/ui/what-if-decision-strip.component.spec.ts libs/pack-football-ui/src/lib/player/ui/funnel-i18n.ts libs/pack-football-ui/src/lib/i18n/de/funnel.json libs/pack-football-ui/src/lib/i18n/en/funnel.json
git commit -m "feat(pack-football-ui): what-if decision strip — variance-aware readiness verdict (de/en i18n, sr summary)"
```

---

### Task 11: Funnel-page form lane wiring

**Files:**
- Modify: `libs/pack-football-ui/src/lib/player/data/player-seeds.ts`
- Modify: `libs/pack-football-ui/src/lib/player/fc-player-funnel-page.component.ts`
- Modify: `libs/pack-football-ui/src/lib/player/fc-player-funnel-page.component.spec.ts`

- [ ] **Step 1:** In `player-seeds.ts`, beside `PASS_COMPLETION_INDICATOR_KEY` (UI-side mirror), add:

```ts
export const FORM_INDEX_INDICATOR_KEY = 'football.indicator.form_index' as const;
```

- [ ] **Step 2: Page wiring.** In `fc-player-funnel-page.component.ts`:

1. New state type + signal mirroring `WhatIfState` (reuse the union, adding a variant carrying the decision):

```ts
type FormDecisionState =
  | { kind: 'none' }
  | { kind: 'loading' }
  | {
      kind: 'loaded';
      decision: WhatIfDecisionWire;
      baselineLabel: string;
      counterfactualLabel: string;
    }
  | { kind: 'failed'; reason: string };
```

with `private formWhatIfAbort?: AbortController;` and `protected readonly formDecisionState = signal<FormDecisionState>({ kind: 'none' });` plus the matching `computed`s (`formDecision`, `formDecisionFailure`) following the existing what-if computed style. Import `WhatIfDecisionWire` from `../data/wire-schemas.js`, `FORM_INDEX_INDICATOR_KEY` from `./data/player-seeds.js`, `decisionUnavailableLabel` + `funnelMsg` keys from `./ui/funnel-i18n.js`, and `WhatIfDecisionStripComponent` (add to `imports: […]`).

2. In `onQueryParams`, fire the form lane alongside the pass lane:

```ts
    if (counterfactualRaw !== null && isCounterfactualShorthand(counterfactualRaw)) {
      void this.loadWhatIf(playerId, COUNTERFACTUAL_SHORTHAND[counterfactualRaw]);
      void this.loadFormDecision(playerId, COUNTERFACTUAL_SHORTHAND[counterfactualRaw]);
    } else {
      this.whatIfState.set({ kind: 'none' });
      this.formDecisionState.set({ kind: 'none' });
    }
```

3. New loader mirroring `loadWhatIf` (independent lifecycle + abort; failure isolated — the pass lane survives a form-lane failure and vice versa):

```ts
  /**
   * The form_index lane of the overlay (specs#298 Check 2): a SECOND pairwise
   * what-if over the same two drill trees, keyed to the variance-propagating
   * normal×normal indicator. Independent of the pass lane — its failure shows
   * an unavailable note for the decision strip only.
   */
  private async loadFormDecision(
    playerId: string,
    entry: (typeof COUNTERFACTUAL_SHORTHAND)[CounterfactualShorthand],
  ): Promise<void> {
    this.formWhatIfAbort?.abort();
    const abort = new AbortController();
    this.formWhatIfAbort = abort;
    this.formDecisionState.set({ kind: 'loading' });
    try {
      const { comparison } = await this.client.compareWhatIf(
        playerId,
        {
          baselineTreeRootId: entry.baselineTreeRootId,
          counterfactualTreeRootId: entry.counterfactualTreeRootId,
          indicatorKey: FORM_INDEX_INDICATOR_KEY,
        },
        abort.signal,
      );
      if (abort.signal.aborted) return;
      if (!comparison.decision) {
        this.formDecisionState.set({
          kind: 'failed',
          reason: 'decision-missing',
        });
        return;
      }
      this.formDecisionState.set({
        kind: 'loaded',
        decision: comparison.decision,
        baselineLabel: entry.drillX,
        counterfactualLabel: entry.drillY,
      });
    } catch (err) {
      if (abort.signal.aborted) return;
      const reason =
        err instanceof SubstrateClientError
          ? err.failure.kind
          : err instanceof Error
            ? err.message
            : String(err);
      console.error('[player-funnel] form-decision what-if failed', { playerId, reason });
      this.formDecisionState.set({ kind: 'failed', reason });
    }
  }
```

4. Template: directly AFTER the existing what-if `@switch` block (sibling, NOT nested — failure isolation), add:

```html
          @switch (formDecisionState().kind) {
            @case ('loading') {
              <p class="status" data-testid="form-decision-loading" aria-live="polite">
                {{ formDecisionComputingLabel }}
              </p>
            }
            @case ('failed') {
              <p class="status failed" data-testid="form-decision-failed" aria-live="polite">
                {{ formDecisionUnavailableLabel() }}
              </p>
            }
            @case ('loaded') {
              @if (formDecision(); as fd) {
                <section
                  class="section"
                  aria-labelledby="form-decision-title"
                  data-testid="form-decision-section"
                >
                  <h2 class="section-title" id="form-decision-title">
                    {{ formDecisionSectionTitle }}
                  </h2>
                  <lib-what-if-decision-strip
                    [decision]="fd.decision"
                    [baselineLabel]="fd.baselineLabel"
                    [counterfactualLabel]="fd.counterfactualLabel"
                  />
                </section>
              }
            }
          }
```

with the labels:

```ts
  protected readonly formDecisionSectionTitle = funnelMsg('funnel.decision.title');
  protected readonly formDecisionComputingLabel = funnelMsg('funnel.decision.computing');
  protected readonly formDecisionUnavailableLabel = computed(() =>
    decisionUnavailableLabel(this.formDecisionFailure()),
  );
```

- [ ] **Step 3: Page spec extensions** (`fc-player-funnel-page.component.spec.ts`, follow its existing client-stub harness): (1) activating `?counterfactual=drill-x-vs-y` fires TWO `compareWhatIf` calls — one with the pass key, one with `football.indicator.form_index`; (2) when the form call resolves with a `decision` block the strip renders (`[data-testid="form-decision-section"]` exists, verdict text present); (3) when the form call REJECTS but the pass call resolves, the pass overlay still renders and `[data-testid="form-decision-failed"]` shows (isolation, both directions if cheap).

- [ ] **Step 4: Run, lint, build, commit:**

```bash
npx vitest run --config libs/pack-football-ui/vitest.config.ts fc-player-funnel-page --coverage.enabled=false
npx nx lint pack-football-ui
npx nx build pack-football-ui
git add libs/pack-football-ui/src/lib/player/
git commit -m "feat(pack-football-ui): form_index decision lane on the funnel what-if overlay"
```

---

### Task 12: Full gates

- [ ] **Step 1:** `npm run ci:local` from the worktree root → ALL projects build + lint + test green. Fix any fallout (typical: unused imports, i18n parity, lint).
- [ ] **Step 2:** If anything was fixed, commit as `chore: ci:local fallout fixes`.

---

## Orchestrator-level finish (NOT subagent tasks)

1. **Story issue** (`gh issue create -R de-braighter/exercir`) — title "Story: variance-aware coach readiness decision on the what-if overlay (specs#298 Check-2 closure)"; body marks `standalone` (ADR-086) + links specs#298 and the design doc.
2. **Push + PR-first** (before the wave): `Closes #<story>` + `Producer: orchestrator/claude-fable-5 [brainstorming, writing-plans, subagent-driven-development]` + `Effort: standard` + `Effect: cycle-time 0.01±0.01 expert` + `Effect: findings 3±2 expert`. `gh pr edit` is broken on this token — patch via `gh api -X PATCH repos/de-braighter/exercir/pulls/<n> -F body=@file`.
3. **Verifier wave** (parallel, all `isolation: "worktree"`, read-only-git discipline in prompts): `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` + `exercir-charter-checker`. Reviewers receive the RATIFIED contracts: ADR-224 (`layers/specs/adr/`) + substrate `docs/migration-substrate-2.0.md` + the design doc.
4. **Findings BEFORE merge:** `npm run dev -- post-findings de-braighter/exercir#<pr> findings.json` (omit null path/line fields); `drain exercir#<pr>` (0 findings for in-session agents is fine).
5. **Live browser proof:** API :3100 + UI :4200, deep link `/p/football/player/funnel?playerId=00000077-0000-4000-8000-fc1a55e10077&counterfactual=drill-x-vs-y` (verify exact route from the router config), screenshot the decision strip (66.4% / hold vs 53.9% / hold) for the #298 comment.
6. **Merge + twin ritual:** `backfill de-braighter/exercir` → `reconcile exercir#<pr>` → `reviews` + `resolve-findings de-braighter/exercir` (or `npm run ritual:post-merge`).
7. **#298 Check-2 closure comment** on de-braighter/specs: the synthetic-decision-rule caveat is closed — production coach surface decides on P(form ≥ 70) ≥ 0.70 from the variance-aware posterior; point-vs-normal flip pinned at pack level (`what-if-decision-relevance.spec.ts`) + controller integration + live screenshot; note the deliberate seed-honesty change (sd 2→10) and that criterion-2 re-conditioning remains deferred (Check 3).
8. **Worktree cleanup** after merge (`git -C domains/exercir worktree remove ../exercir-wt-form-decision`, branch delete after verifying the PR LANDED via squash).
