# Check-4 Flywheel Toy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pre-registered Check-4 pooled-vs-unpooled cold-start study in `domains/devloop` and pin its verdict as an in-tree regression, per the merged pre-registration `docs/superpowers/specs/2026-06-12-check4-flywheel-design.md` (workbench, merged as workbench#125).

**Architecture:** Two new pure modules in devloop's existing in-process inference layer: `check4-math.ts` (closed-form numerics: log-gamma, Student-t log-pdf/CDF, Normal-Inverse-Gamma conjugate update) and `check4-flywheel.ts` (fixture build, leave-one-repo-out folds, MoM hyperprior, scoring, the frozen PASS rule). Thin CLI glue in `cli.ts`. The verdict runs on a frozen fixture committed under `test/fixtures/` (`data/` is gitignored) and is pinned by a golden-file regression test.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, ESM with `.js` import extensions), vitest, no new dependencies. Everything closed-form — no sampling, no seed.

---

## Frozen dials (from the pre-registration — DO NOT change any of these)

| Dial | Value |
|---|---|
| Conditioning size k | 5 (chronologically first, ties by PR number) |
| Fold floor | ≥ 20 rows per repo after exclusions |
| Exclusions | `cycleHours` missing, non-finite, or ≤ 0 |
| Observation | `y = ln(cycleHours)` |
| Likelihood (both arms) | Normal, conjugate NIG: `p(μ,σ²) = N(μ\|μ₀, σ²/κ₀)·InvGamma(σ²\|shape α₀, rate β₀)` |
| Unpooled prior | `μ₀ = ȳ_k` (own k-shot mean), `κ₀ = 1`, `α₀ = 1`, `β₀ = 1` |
| Pooled prior | MoM over the **other fold repos' full rows**: `μ₀ = mean_j(ȳ_j)`, `τ̂² = max(0, Var_j(ȳ_j) − mean_j(s_j²/n_j))`, `σ̂_w² = mean_j(s_j²)`, `κ₀ = min(σ̂_w²/τ̂², 25)` (`τ̂²=0 → 25`), `α₀ = 1`, `β₀ = σ̂_w²` |
| Variances | sample variances, n−1 divisor (also for `Var_j` over the per-repo means) |
| Score | `Δ_r` = mean over held-out of `ln p_pooled(y) − ln p_unpooled(y)`; primary aggregate = **unweighted mean of Δ_r across folds** |
| PASS rule | mean `Δ_r` > 0 **∧** `Δ_r > 0` in all but at most one fold **∧** pooled-arm aggregate central-80% coverage ≥ 0.60 |
| Coverage | held-out point is "inside" iff `studentTCdf((y−μ)/s, ν) ∈ [0.10, 0.90]` on the pooled predictive |

One mechanical determinism rule named here, before fixture build (it creates no tuning freedom): if the log contains two `PrMerged` events for the same `repo#pr` (re-backfilled with an edited title), the fixture keeps the one with the **earliest** `occurredAt`.

Process discipline (design doc §3.6): Tasks 1–7 are built and reviewed **before** Task 8 builds the real fixture or computes any real score. The Swiss-Post validation log (`data/swisspost-validation.jsonl`) must never be read — only `data/events.jsonl` (the `readEnvelopes()` default).

---

### Task 1: Numeric core — `lgamma` + `studentTLogPdf`

**Files:**
- Create: `domains/devloop/src/inference/check4-math.ts`
- Create: `domains/devloop/test/check4-math.test.ts`

All commands in this plan run from `domains/devloop/`.

- [ ] **Step 1: Write the failing tests**

Create `test/check4-math.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { lgamma, studentTLogPdf } from '../src/inference/check4-math.js';

describe('lgamma (Lanczos)', () => {
  // Hand-derivable values: Γ(0.5)=√π, Γ(1)=Γ(2)=1, Γ(2.5)=0.75√π, Γ(5)=24.
  it('matches known log-gamma values', () => {
    expect(lgamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10); // 0.5723649429
    expect(lgamma(1)).toBeCloseTo(0, 10);
    expect(lgamma(2)).toBeCloseTo(0, 10);
    expect(lgamma(2.5)).toBeCloseTo(Math.log(0.75 * Math.sqrt(Math.PI)), 10); // 0.2846828705
    expect(lgamma(5)).toBeCloseTo(Math.log(24), 10); // 3.1780538303
  });
});

describe('studentTLogPdf', () => {
  it('standard Cauchy (ν=1) at 0 is ln(1/π)', () => {
    expect(studentTLogPdf(0, 1, 0, 1)).toBeCloseTo(-Math.log(Math.PI), 10); // -1.1447298858
  });

  it('location/scale Cauchy: ν=1, μ=2, s=3 at y=2 is -ln(3π)', () => {
    expect(studentTLogPdf(2, 1, 2, 3)).toBeCloseTo(-Math.log(3 * Math.PI), 10); // -2.2433422
  });

  it('NIG-predictive oracle: ν=4, μ=0, s=√(4/3) at y=0', () => {
    // Hand derivation: lnΓ(2.5) − lnΓ(2) − ½ln(4π) − ln√(4/3)
    //   = 0.2846829 − 0 − 1.2655121 − 0.1438410 = −1.1246702
    expect(studentTLogPdf(0, 4, 0, Math.sqrt(4 / 3))).toBeCloseTo(-1.1246702, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/check4-math.test.ts`
Expected: FAIL — `Cannot find module '../src/inference/check4-math.js'` (or equivalent resolve error).

- [ ] **Step 3: Implement `check4-math.ts` (lgamma + studentTLogPdf only)**

Create `src/inference/check4-math.ts`:

```ts
// Check-4 numerics — pure, closed-form, dependency-free. Every formula here is
// frozen by the merged pre-registration (workbench
// docs/superpowers/specs/2026-06-12-check4-flywheel-design.md §3.3).
// NIG convention: p(μ,σ²) = Normal(μ | μ0, σ²/κ0) · InvGamma(σ² | shape α0, rate β0).

/** Lanczos log-gamma (g=7), accurate to ~1e-13 for x > 0. */
export function lgamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // reflection: Γ(x)Γ(1−x) = π / sin(πx)
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
  }
  const z = x - 1;
  let a = c[0]!;
  const t = z + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** ln pdf of a Student-t with df ν, location μ, scale s (scale, not variance). */
export function studentTLogPdf(y: number, nu: number, mu: number, s: number): number {
  const z = (y - mu) / s;
  return (
    lgamma((nu + 1) / 2) - lgamma(nu / 2)
    - 0.5 * Math.log(nu * Math.PI) - Math.log(s)
    - ((nu + 1) / 2) * Math.log(1 + (z * z) / nu)
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/check4-math.test.ts`
Expected: PASS (2 describe blocks, 4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/inference/check4-math.ts test/check4-math.test.ts
git commit -m "feat(check4): lgamma + Student-t log-pdf (pre-registered numerics)"
```

---

### Task 2: Student-t CDF via regularized incomplete beta

**Files:**
- Modify: `domains/devloop/src/inference/check4-math.ts`
- Modify: `domains/devloop/test/check4-math.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `test/check4-math.test.ts`; add `studentTCdf` to the import)

```ts
describe('studentTCdf', () => {
  it('is 0.5 at 0 for any df', () => {
    expect(studentTCdf(0, 1)).toBeCloseTo(0.5, 10);
    expect(studentTCdf(0, 5)).toBeCloseTo(0.5, 10);
  });

  it('matches the exact Cauchy CDF F(x) = 1/2 + atan(x)/π at ν=1', () => {
    expect(studentTCdf(1, 1)).toBeCloseTo(0.75, 8);
    expect(studentTCdf(-1, 1)).toBeCloseTo(0.25, 8);
    expect(studentTCdf(3, 1)).toBeCloseTo(0.5 + Math.atan(3) / Math.PI, 8); // 0.8975836
  });

  it('matches the closed form F(x) = 1/2 + x/(2√(2+x²)) at ν=2', () => {
    const x = Math.SQRT2;
    expect(studentTCdf(x, 2)).toBeCloseTo(0.5 + x / (2 * Math.sqrt(2 + x * x)), 8); // 0.8535534
  });

  it('is symmetric: F(−x) = 1 − F(x)', () => {
    expect(studentTCdf(-1.7, 6)).toBeCloseTo(1 - studentTCdf(1.7, 6), 10);
  });
});
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `npx vitest run test/check4-math.test.ts`
Expected: FAIL — `studentTCdf` is not exported.

- [ ] **Step 3: Implement `betai` (continued fraction) + `studentTCdf`** (append to `check4-math.ts`)

```ts
/** Regularized incomplete beta I_x(a, b) via Lentz's continued fraction. */
export function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnBt = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(lnBt);
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

function betacf(a: number, b: number, x: number): number {
  const EPS = 1e-14;
  const FPMIN = 1e-300;
  const MAXIT = 200;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** CDF of the standardized Student-t with df ν. */
export function studentTCdf(x: number, nu: number): number {
  const p = 0.5 * betai(nu / 2, 0.5, nu / (nu + x * x));
  return x >= 0 ? 1 - p : p;
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run test/check4-math.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/inference/check4-math.ts test/check4-math.test.ts
git commit -m "feat(check4): Student-t CDF via incomplete beta (coverage criterion numerics)"
```

---

### Task 3: NIG conjugate update + posterior predictive

**Files:**
- Modify: `domains/devloop/src/inference/check4-math.ts`
- Modify: `domains/devloop/test/check4-math.test.ts`

- [ ] **Step 1: Write the failing tests** (append; extend the import with `nigUpdate, nigPredictive, type Nig`)

```ts
describe('NIG conjugate update + predictive', () => {
  // Hand derivation 1: prior {μ0:0, κ0:1, α0:1, β0:1}, ys=[1, −1]:
  //   ȳ=0, SS=2, κn=1+2=3, μn=(1·0+2·0)/3=0, αn=1+1=2,
  //   βn = 1 + 2/2 + 1·2·(0−0)²/(2·3) = 2.
  // Predictive: ν=2αn=4, μ=0, s=√(βn(κn+1)/(αn·κn))=√(2·4/(2·3))=√(4/3).
  it('updates a symmetric two-point cohort correctly', () => {
    const post = nigUpdate({ mu0: 0, kappa0: 1, alpha0: 1, beta0: 1 }, [1, -1]);
    expect(post.mu0).toBeCloseTo(0, 12);
    expect(post.kappa0).toBeCloseTo(3, 12);
    expect(post.alpha0).toBeCloseTo(2, 12);
    expect(post.beta0).toBeCloseTo(2, 12);
    const pred = nigPredictive(post);
    expect(pred.nu).toBeCloseTo(4, 12);
    expect(pred.mu).toBeCloseTo(0, 12);
    expect(pred.s).toBeCloseTo(Math.sqrt(4 / 3), 12);
  });

  // Hand derivation 2 (mean-shift term exercised): same prior, ys=[2]:
  //   ȳ=2, SS=0, κn=2, μn=(0+2)/2=1, αn=1.5,
  //   βn = 1 + 0 + 1·1·(2−0)²/(2·2) = 2.
  // Predictive: ν=3, μ=1, s=√(2·3/(1.5·2))=√2.
  it('applies the κ0·n·(ȳ−μ0)²/(2κn) mean-shift term', () => {
    const post = nigUpdate({ mu0: 0, kappa0: 1, alpha0: 1, beta0: 1 }, [2]);
    expect(post.mu0).toBeCloseTo(1, 12);
    expect(post.kappa0).toBeCloseTo(2, 12);
    expect(post.alpha0).toBeCloseTo(1.5, 12);
    expect(post.beta0).toBeCloseTo(2, 12);
    const pred = nigPredictive(post);
    expect(pred.nu).toBeCloseTo(3, 12);
    expect(pred.mu).toBeCloseTo(1, 12);
    expect(pred.s).toBeCloseTo(Math.SQRT2, 12);
  });

  it('n=0 returns the prior unchanged', () => {
    const prior: Nig = { mu0: 0.5, kappa0: 2, alpha0: 1, beta0: 3 };
    expect(nigUpdate(prior, [])).toEqual(prior);
  });

  it('end-to-end predictive density matches the Task-1 oracle', () => {
    const post = nigUpdate({ mu0: 0, kappa0: 1, alpha0: 1, beta0: 1 }, [1, -1]);
    const pred = nigPredictive(post);
    expect(studentTLogPdf(0, pred.nu, pred.mu, pred.s)).toBeCloseTo(-1.1246702, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `npx vitest run test/check4-math.test.ts`
Expected: FAIL — `nigUpdate` is not exported.

- [ ] **Step 3: Implement NIG types + update + predictive** (append to `check4-math.ts`)

```ts
export interface Nig {
  mu0: number;
  kappa0: number;
  alpha0: number;
  beta0: number;
}

export interface StudentT {
  nu: number;
  mu: number;
  s: number;
}

/** Standard conjugate NIG update with observations ys. */
export function nigUpdate(prior: Nig, ys: number[]): Nig {
  const n = ys.length;
  if (n === 0) return { ...prior };
  const mean = ys.reduce((a, y) => a + y, 0) / n;
  const ss = ys.reduce((a, y) => a + (y - mean) * (y - mean), 0);
  const kappaN = prior.kappa0 + n;
  return {
    mu0: (prior.kappa0 * prior.mu0 + n * mean) / kappaN,
    kappa0: kappaN,
    alpha0: prior.alpha0 + n / 2,
    beta0: prior.beta0 + ss / 2 + (prior.kappa0 * n * (mean - prior.mu0) ** 2) / (2 * kappaN),
  };
}

/** Posterior predictive of an NIG state: Student-t(2α, μ, √(β(κ+1)/(ακ))). */
export function nigPredictive(p: Nig): StudentT {
  return {
    nu: 2 * p.alpha0,
    mu: p.mu0,
    s: Math.sqrt((p.beta0 * (p.kappa0 + 1)) / (p.alpha0 * p.kappa0)),
  };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run test/check4-math.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/inference/check4-math.ts test/check4-math.test.ts
git commit -m "feat(check4): NIG conjugate update + Student-t predictive (both arms' engine)"
```

---

### Task 4: MoM hyperprior (the pooled arm's flywheel input)

**Files:**
- Create: `domains/devloop/src/inference/check4-flywheel.ts`
- Create: `domains/devloop/test/check4-flywheel.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `test/check4-flywheel.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { momHyperprior, KAPPA_CAP } from '../src/inference/check4-flywheel.js';

describe('momHyperprior (one-way random-effects method of moments)', () => {
  // Hand derivation: groups [0,2], [2,4], [4,6] →
  //   means {1,3,5} → μ0 = 3; Var_j (n−1 divisor over 3 means) = (4+0+4)/2 = 4;
  //   s_j² = 2 each (n−1 divisor) → mean(s_j²/n_j) = 1 → τ̂² = max(0, 4−1) = 3;
  //   σ̂_w² = 2 → κ0 = min(2/3, 25) = 2/3; α0 = 1; β0 = σ̂_w² = 2.
  it('matches the hand-derived hyperprior', () => {
    const { nig, tau2, sigmaW2 } = momHyperprior([[0, 2], [2, 4], [4, 6]]);
    expect(nig.mu0).toBeCloseTo(3, 12);
    expect(tau2).toBeCloseTo(3, 12);
    expect(sigmaW2).toBeCloseTo(2, 12);
    expect(nig.kappa0).toBeCloseTo(2 / 3, 12);
    expect(nig.alpha0).toBe(1);
    expect(nig.beta0).toBeCloseTo(2, 12);
  });

  // Identical group means → Var_j = 0 → τ̂² = 0 → κ0 hits the cap.
  it('caps κ0 at 25 when between-group variance vanishes', () => {
    const { nig, tau2 } = momHyperprior([[2, 4], [2, 4], [2, 4]]);
    expect(tau2).toBe(0);
    expect(nig.kappa0).toBe(KAPPA_CAP);
    expect(KAPPA_CAP).toBe(25); // frozen dial
  });

  // Within-noise exceeds between-spread → the max(0, ·) clamp fires → cap.
  // groups [0,4],[1,5],[2,6]: means {2,3,4} → Var_j = 1; s_j² = 8 each, n_j = 2
  //   → mean(s_j²/n_j) = 4 → τ̂² = max(0, 1−4) = 0 → κ0 = 25.
  it('clamps a negative moment estimate to 0 (then caps)', () => {
    const { nig, tau2 } = momHyperprior([[0, 4], [1, 5], [2, 6]]);
    expect(tau2).toBe(0);
    expect(nig.kappa0).toBe(KAPPA_CAP);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/check4-flywheel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module skeleton + `momHyperprior`**

Create `src/inference/check4-flywheel.ts`:

```ts
// Check 4 — flywheel toy: pooled-vs-unpooled cold-start study over the cluster
// delivery log. Every dial in this module is FROZEN by the merged
// pre-registration (workbench docs/superpowers/specs/
// 2026-06-12-check4-flywheel-design.md §3); changing any of them voids the run.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Nig } from './check4-math.js';

// ---- frozen dials (pre-registration §3) ----
export const K_CONDITIONING = 5;
export const FOLD_FLOOR = 20;
export const KAPPA_CAP = 25;
export const COVERAGE_FLOOR = 0.6;

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CHECK4_FIXTURE_PATH = join(PKG_ROOT, 'test', 'fixtures', 'check4-cycle-times.json');
export const CHECK4_GOLDEN_PATH = join(PKG_ROOT, 'test', 'fixtures', 'check4-result.json');

const mean = (xs: number[]): number => xs.reduce((a, x) => a + x, 0) / xs.length;
const sampleVariance = (xs: number[]): number => {
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) * (x - m), 0) / (xs.length - 1);
};

export interface Hyperprior {
  nig: Nig;
  tau2: number;
  sigmaW2: number;
}

/** One-way random-effects MoM hyperprior from the other fold repos' y-groups. */
export function momHyperprior(groups: number[][]): Hyperprior {
  const groupMeans = groups.map(mean);
  const groupVars = groups.map(sampleVariance);
  const mu0 = mean(groupMeans);
  const sigmaW2 = mean(groupVars);
  const meanSe2 = mean(groups.map((g, j) => (groupVars[j] ?? 0) / g.length));
  const tau2 = Math.max(0, sampleVariance(groupMeans) - meanSe2);
  const kappa0 = tau2 > 0 ? Math.min(sigmaW2 / tau2, KAPPA_CAP) : KAPPA_CAP;
  return { nig: { mu0, kappa0, alpha0: 1, beta0: sigmaW2 }, tau2, sigmaW2 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/check4-flywheel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/inference/check4-flywheel.ts test/check4-flywheel.test.ts
git commit -m "feat(check4): MoM random-effects hyperprior (pooled arm, frozen dials)"
```

---

### Task 5: Fixture build, fold selection, conditioning split

**Files:**
- Modify: `domains/devloop/src/inference/check4-flywheel.ts`
- Modify: `domains/devloop/test/check4-flywheel.test.ts`

- [ ] **Step 1: Write the failing tests** (append to `test/check4-flywheel.test.ts`; extend imports)

Add to the import block at the top:

```ts
import {
  buildFixture,
  foldRepos,
  splitFold,
  K_CONDITIONING,
  FOLD_FLOOR,
  type FixtureRow,
} from '../src/inference/check4-flywheel.js';
import { prMerged } from '../src/events.js';
```

(keep the existing `momHyperprior, KAPPA_CAP` import — merge into one import statement from `check4-flywheel.js`.)

Append:

```ts
const mk = (repo: string, pr: number, ts: string, cycleHours: number) =>
  prMerged({ repo, pr, title: `t${pr}`, cycleHours, ts });

describe('buildFixture', () => {
  it('extracts PrMerged rows, excludes cycleHours ≤ 0, sorts by repo/time/pr', () => {
    const fx = buildFixture([
      mk('o/b', 2, '2026-01-02T00:00:00Z', 1.5),
      mk('o/a', 9, '2026-01-03T00:00:00Z', 2),
      mk('o/a', 1, '2026-01-01T00:00:00Z', 0), // excluded: ≤ 0
      mk('o/a', 3, '2026-01-02T00:00:00Z', 4),
    ]);
    expect(fx.rows).toEqual([
      { repo: 'o/a', pr: 3, occurredAt: '2026-01-02T00:00:00Z', cycleHours: 4 },
      { repo: 'o/a', pr: 9, occurredAt: '2026-01-03T00:00:00Z', cycleHours: 2 },
      { repo: 'o/b', pr: 2, occurredAt: '2026-01-02T00:00:00Z', cycleHours: 1.5 },
    ]);
  });

  it('breaks same-timestamp ties by PR number', () => {
    const fx = buildFixture([
      mk('o/a', 7, '2026-01-01T00:00:00Z', 1),
      mk('o/a', 2, '2026-01-01T00:00:00Z', 1.1),
    ]);
    expect(fx.rows.map((r) => r.pr)).toEqual([2, 7]);
  });

  it('dedups same repo#pr keeping the earliest occurredAt', () => {
    const fx = buildFixture([
      mk('o/a', 5, '2026-01-02T00:00:00Z', 9),
      mk('o/a', 5, '2026-01-01T00:00:00Z', 3),
    ]);
    expect(fx.rows).toEqual([
      { repo: 'o/a', pr: 5, occurredAt: '2026-01-01T00:00:00Z', cycleHours: 3 },
    ]);
  });

  it('ignores non-PrMerged envelopes', () => {
    const fx = buildFixture([mk('o/a', 1, '2026-01-01T00:00:00Z', 1)]);
    expect(fx.rows).toHaveLength(1);
  });
});

const rows = (repo: string, n: number): FixtureRow[] =>
  Array.from({ length: n }, (_, i) => ({
    repo,
    pr: i + 1,
    occurredAt: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:0${i % 10}Z`,
    cycleHours: 1 + i,
  }));

describe('foldRepos', () => {
  it('selects repos with ≥ FOLD_FLOOR rows, alphabetically', () => {
    const fx = { rows: [...rows('o/b', 20), ...rows('o/a', 25), ...rows('o/c', 19)] };
    expect(FOLD_FLOOR).toBe(20); // frozen dial
    expect(foldRepos(fx)).toEqual(['o/a', 'o/b']);
  });
});

describe('splitFold', () => {
  it('takes the chronologically first k=5 as conditioning, rest held out', () => {
    const fx = buildFixture(
      Array.from({ length: 22 }, (_, i) =>
        mk('o/a', i + 1, `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`, 1 + i),
      ),
    );
    const { conditioning, heldOut } = splitFold(fx, 'o/a');
    expect(K_CONDITIONING).toBe(5); // frozen dial
    expect(conditioning.map((r) => r.pr)).toEqual([1, 2, 3, 4, 5]);
    expect(heldOut).toHaveLength(17);
    expect(heldOut[0]?.pr).toBe(6);
  });
});
```

- [ ] **Step 2: Run tests to verify the new blocks fail**

Run: `npx vitest run test/check4-flywheel.test.ts`
Expected: FAIL — `buildFixture` is not exported.

- [ ] **Step 3: Implement fixture types + build + folds + split** (append to `check4-flywheel.ts`)

First extend the module's import block with what this task needs:

```ts
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { ofType } from '../log.js';
import { EVENT, type PrMergedPayload } from '../events.js';
```

Then append:

```ts
export interface FixtureRow {
  repo: string;
  pr: number;
  occurredAt: string;
  cycleHours: number;
}

export interface Check4Fixture {
  rows: FixtureRow[];
}

/** Extract the frozen-fixture rows from the event log (pre-registration §3.1):
 *  PrMerged only; exclude cycleHours ≤ 0 / non-finite; dedup repo#pr keeping the
 *  earliest occurredAt; sort by repo, then occurredAt (epoch), then pr. */
export function buildFixture(events: DomainEventEnvelope[]): Check4Fixture {
  const byKey = new Map<string, FixtureRow>();
  for (const e of ofType(events, EVENT.PR_MERGED)) {
    const p = e.payload as PrMergedPayload;
    if (!Number.isFinite(p.cycleHours) || p.cycleHours <= 0) continue;
    const row: FixtureRow = {
      repo: p.repo, pr: p.pr, occurredAt: e.occurredAt, cycleHours: p.cycleHours,
    };
    const key = `${p.repo}#${p.pr}`;
    const prev = byKey.get(key);
    if (!prev || Date.parse(row.occurredAt) < Date.parse(prev.occurredAt)) byKey.set(key, row);
  }
  const all = [...byKey.values()].sort(
    (a, b) =>
      a.repo.localeCompare(b.repo) ||
      Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
      a.pr - b.pr,
  );
  return { rows: all };
}

/** Fold units: repos with ≥ FOLD_FLOOR rows, alphabetical (pre-registration §3.2). */
export function foldRepos(fx: Check4Fixture): string[] {
  const counts = new Map<string, number>();
  for (const r of fx.rows) counts.set(r.repo, (counts.get(r.repo) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n >= FOLD_FLOOR)
    .map(([repo]) => repo)
    .sort((a, b) => a.localeCompare(b));
}

/** Cold-start split for one fold: first k rows conditioning, rest held out. */
export function splitFold(
  fx: Check4Fixture,
  repo: string,
): { conditioning: FixtureRow[]; heldOut: FixtureRow[] } {
  const mine = fx.rows.filter((r) => r.repo === repo); // already sorted by build
  return { conditioning: mine.slice(0, K_CONDITIONING), heldOut: mine.slice(K_CONDITIONING) };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run test/check4-flywheel.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/inference/check4-flywheel.ts test/check4-flywheel.test.ts
git commit -m "feat(check4): fixture build + LORO fold selection + k=5 cold-start split"
```

---

### Task 6: Fold scoring + the frozen PASS rule

**Files:**
- Modify: `domains/devloop/src/inference/check4-flywheel.ts`
- Modify: `domains/devloop/test/check4-flywheel.test.ts`

- [ ] **Step 1: Write the failing tests** (append; extend the `check4-flywheel.js` import with `runStudy, verdictFrom, COVERAGE_FLOOR, type Check4Result`)

```ts
describe('verdictFrom (the frozen PASS rule, pre-registration §3.5)', () => {
  const deltas = (xs: number[]) => xs.map((delta, i) => ({ repo: `r${i}`, delta }));

  it('PASS: mean > 0, exactly one negative fold, coverage ≥ 0.60', () => {
    const v = verdictFrom(deltas([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, -0.05]), 0.8);
    expect(v.criteria).toEqual({ meanDeltaPositive: true, signRule: true, coverageFloor: true });
    expect(v.pass).toBe(true);
  });

  it('FAIL on sign rule: two negative folds', () => {
    const v = verdictFrom(deltas([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, -0.05, -0.01]), 0.8);
    expect(v.criteria.signRule).toBe(false);
    expect(v.pass).toBe(false);
  });

  it('FAIL on mean: 7/8 positive but one dominating negative fold', () => {
    const v = verdictFrom(deltas([0.01, 0.01, 0.01, 0.01, 0.01, 0.01, 0.01, -1]), 0.8);
    expect(v.criteria.signRule).toBe(true);
    expect(v.criteria.meanDeltaPositive).toBe(false);
    expect(v.pass).toBe(false);
  });

  it('FAIL on coverage floor', () => {
    expect(COVERAGE_FLOOR).toBe(0.6); // frozen dial
    const v = verdictFrom(deltas([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]), 0.59);
    expect(v.criteria.coverageFloor).toBe(false);
    expect(v.pass).toBe(false);
  });

  it('generalizes all-but-at-most-one to any fold count', () => {
    expect(verdictFrom(deltas([0.1, 0.1, -0.01]), 0.8).criteria.signRule).toBe(true);
    expect(verdictFrom(deltas([0.1, -0.1, -0.01]), 0.8).criteria.signRule).toBe(false);
  });
});

describe('runStudy (end-to-end on synthetic envelopes)', () => {
  // 3 repos × 25 rows. Deterministic synthetic cycle times; the per-component
  // oracles above carry correctness — here we assert structure + internal
  // consistency of the aggregation.
  const synthetic = () => {
    const evs = [];
    for (const [r, repo] of ['o/a', 'o/b', 'o/c'].entries()) {
      for (let i = 0; i < 25; i++) {
        evs.push(
          mk(repo, i + 1, `2026-0${r + 1}-01T00:00:${String(i).padStart(2, '0')}Z`,
             Math.exp(r * 0.5 + (i % 5) * 0.1)),
        );
      }
    }
    return buildFixture(evs);
  };

  it('produces one fold per qualifying repo with consistent aggregates', () => {
    const result = runStudy(synthetic());
    expect(result.folds.map((f) => f.repo)).toEqual(['o/a', 'o/b', 'o/c']);
    for (const f of result.folds) {
      expect(f.nConditioning).toBe(5);
      expect(f.nHeldOut).toBe(20);
      expect(Number.isFinite(f.delta)).toBe(true);
      expect(f.hyperprior.kappa0).toBeGreaterThan(0);
      expect(f.hyperprior.kappa0).toBeLessThanOrEqual(25);
      expect(f.pooledInside).toBeGreaterThanOrEqual(0);
      expect(f.pooledInside).toBeLessThanOrEqual(f.nHeldOut);
    }
    const meanDelta = result.folds.reduce((a, f) => a + f.delta, 0) / result.folds.length;
    expect(result.meanDelta).toBeCloseTo(meanDelta, 12);
    const inside = result.folds.reduce((a, f) => a + f.pooledInside, 0);
    const total = result.folds.reduce((a, f) => a + f.nHeldOut, 0);
    expect(result.pooledCoverage).toBeCloseTo(inside / total, 12);
    expect(result.positiveFolds).toBe(result.folds.filter((f) => f.delta > 0).length);
    expect(result.pass).toBe(
      result.criteria.meanDeltaPositive && result.criteria.signRule && result.criteria.coverageFloor,
    );
  });

  it('is deterministic (two runs, identical JSON)', () => {
    const fx = synthetic();
    expect(JSON.stringify(runStudy(fx))).toBe(JSON.stringify(runStudy(fx)));
  });
});
```

- [ ] **Step 2: Run tests to verify the new blocks fail**

Run: `npx vitest run test/check4-flywheel.test.ts`
Expected: FAIL — `verdictFrom` is not exported.

- [ ] **Step 3: Implement scoring + verdict** (append to `check4-flywheel.ts`)

First extend the `./check4-math.js` import to:

```ts
import {
  nigPredictive,
  nigUpdate,
  studentTCdf,
  studentTLogPdf,
  type Nig,
} from './check4-math.js';
```

Then append:

```ts
export interface FoldResult {
  repo: string;
  nConditioning: number;
  nHeldOut: number;
  /** Δ_r: mean (ln p_pooled − ln p_unpooled) over held-out, nats per PR. */
  delta: number;
  pooledInside: number;
  unpooledInside: number;
  hyperprior: { mu0: number; kappa0: number; tau2: number; sigmaW2: number };
}

export interface Check4Criteria {
  meanDeltaPositive: boolean;
  signRule: boolean;
  coverageFloor: boolean;
}

export interface Check4Result {
  folds: FoldResult[];
  meanDelta: number;
  positiveFolds: number;
  pooledCoverage: number;
  unpooledCoverage: number;
  criteria: Check4Criteria;
  pass: boolean;
}

/** The frozen PASS rule over per-fold deltas + aggregate pooled coverage. */
export function verdictFrom(
  folds: { delta: number }[],
  pooledCoverage: number,
): { criteria: Check4Criteria; pass: boolean } {
  const meanDelta = folds.reduce((a, f) => a + f.delta, 0) / folds.length;
  const positives = folds.filter((f) => f.delta > 0).length;
  const criteria: Check4Criteria = {
    meanDeltaPositive: meanDelta > 0,
    signRule: positives >= folds.length - 1,
    coverageFloor: pooledCoverage >= COVERAGE_FLOOR,
  };
  return { criteria, pass: criteria.meanDeltaPositive && criteria.signRule && criteria.coverageFloor };
}

const insideCentral80 = (y: number, pred: { nu: number; mu: number; s: number }): boolean => {
  const f = studentTCdf((y - pred.mu) / pred.s, pred.nu);
  return f >= 0.1 && f <= 0.9;
};

/** The pre-registered study: LORO cold-start, both arms, frozen PASS rule. */
export function runStudy(fx: Check4Fixture): Check4Result {
  const repos = foldRepos(fx);
  const ysByRepo = new Map<string, number[]>();
  for (const repo of repos) {
    ysByRepo.set(repo, fx.rows.filter((r) => r.repo === repo).map((r) => Math.log(r.cycleHours)));
  }

  const folds: FoldResult[] = repos.map((repo) => {
    const { conditioning, heldOut } = splitFold(fx, repo);
    const condYs = conditioning.map((r) => Math.log(r.cycleHours));
    const heldYs = heldOut.map((r) => Math.log(r.cycleHours));

    const others = repos.filter((r) => r !== repo).map((r) => ysByRepo.get(r) ?? []);
    const hyper = momHyperprior(others);

    const condMean = condYs.reduce((a, y) => a + y, 0) / condYs.length;
    const unpooledPrior: Nig = { mu0: condMean, kappa0: 1, alpha0: 1, beta0: 1 };

    const pooledPred = nigPredictive(nigUpdate(hyper.nig, condYs));
    const unpooledPred = nigPredictive(nigUpdate(unpooledPrior, condYs));

    let sumDelta = 0;
    let pooledInside = 0;
    let unpooledInside = 0;
    for (const y of heldYs) {
      sumDelta +=
        studentTLogPdf(y, pooledPred.nu, pooledPred.mu, pooledPred.s) -
        studentTLogPdf(y, unpooledPred.nu, unpooledPred.mu, unpooledPred.s);
      if (insideCentral80(y, pooledPred)) pooledInside++;
      if (insideCentral80(y, unpooledPred)) unpooledInside++;
    }
    return {
      repo,
      nConditioning: condYs.length,
      nHeldOut: heldYs.length,
      delta: sumDelta / heldYs.length,
      pooledInside,
      unpooledInside,
      hyperprior: {
        mu0: hyper.nig.mu0, kappa0: hyper.nig.kappa0, tau2: hyper.tau2, sigmaW2: hyper.sigmaW2,
      },
    };
  });

  const totalHeld = folds.reduce((a, f) => a + f.nHeldOut, 0);
  const meanDelta = folds.reduce((a, f) => a + f.delta, 0) / folds.length;
  const { criteria, pass } = verdictFrom(folds, folds.reduce((a, f) => a + f.pooledInside, 0) / totalHeld);
  return {
    folds,
    meanDelta,
    positiveFolds: folds.filter((f) => f.delta > 0).length,
    pooledCoverage: folds.reduce((a, f) => a + f.pooledInside, 0) / totalHeld,
    unpooledCoverage: folds.reduce((a, f) => a + f.unpooledInside, 0) / totalHeld,
    criteria,
    pass,
  };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run test/check4-flywheel.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

```bash
git add src/inference/check4-flywheel.ts test/check4-flywheel.test.ts
git commit -m "feat(check4): LORO study runner + frozen PASS rule (mean>0, all-but-one, coverage 0.60)"
```

---

### Task 7: Fixture load + render + CLI commands

**Files:**
- Modify: `domains/devloop/src/inference/check4-flywheel.ts`
- Modify: `domains/devloop/test/check4-flywheel.test.ts`
- Modify: `domains/devloop/src/cli.ts` (the command `switch` near line 199 and the `default:` usage string near line 446)

- [ ] **Step 1: Write the failing tests** (append; extend the `check4-flywheel.js` import with `loadFixture, renderCheck4`; the three `node:*` imports below go at the top of the test file with the other imports)

```ts
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('loadFixture', () => {
  it('round-trips a saved fixture', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check4-'));
    const path = join(dir, 'fx.json');
    const fx = buildFixture([mk('o/a', 1, '2026-01-01T00:00:00Z', 2)]);
    writeFileSync(path, JSON.stringify(fx, null, 2));
    expect(loadFixture(path)).toEqual(fx);
  });

  it('fails loud on a malformed file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check4-'));
    const path = join(dir, 'bad.json');
    writeFileSync(path, '{"nope": true}');
    expect(() => loadFixture(path)).toThrow(/fixture/i);
  });
});

describe('renderCheck4', () => {
  it('renders verdict, criteria, and per-fold diagnostics', () => {
    const result = runStudy(synthetic());
    const out = renderCheck4(result);
    expect(out).toContain('Check 4 — flywheel');
    expect(out).toContain(result.pass ? 'PASS' : 'FAIL');
    expect(out).toContain('o/a');
    expect(out).toContain('mean Δ');
    expect(out).toContain('coverage');
  });
});
```

Note: `synthetic` is defined inside the Task-6 `describe` — hoist it to module level of the test file (move the `const synthetic = () => {...}` definition out of the `describe` block so both use it).

- [ ] **Step 2: Run tests to verify the new blocks fail**

Run: `npx vitest run test/check4-flywheel.test.ts`
Expected: FAIL — `loadFixture` is not exported.

- [ ] **Step 3: Implement `loadFixture` + `renderCheck4`** (append to `check4-flywheel.ts`)

First add `import { readFileSync } from 'node:fs';` to the module's import block. Then append:

```ts
/** Read + minimally validate a frozen fixture. Fail loud — never a silent []. */
export function loadFixture(path: string = CHECK4_FIXTURE_PATH): Check4Fixture {
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const rows = (raw as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) throw new Error(`not a check4 fixture (missing rows[]): ${path}`);
  for (const r of rows as FixtureRow[]) {
    if (typeof r.repo !== 'string' || !Number.isFinite(r.cycleHours) || r.cycleHours <= 0) {
      throw new Error(`corrupt fixture row in ${path}: ${JSON.stringify(r)}`);
    }
  }
  return { rows: rows as FixtureRow[] };
}

/** Human-readable verdict + diagnostics (the CLI output; the ledger quotes it). */
export function renderCheck4(r: Check4Result): string {
  const lines = [
    `Check 4 — flywheel super-linearity (pre-registered; workbench 2026-06-12-check4-flywheel-design.md)`,
    ``,
    `fold repo                          n(cond/held)   Δ (nats/PR)   pooled-in   μ₀       κ₀      τ̂²`,
    ...r.folds.map((f) =>
      `${f.repo.padEnd(34)} ${String(f.nConditioning).padStart(2)}/${String(f.nHeldOut).padEnd(10)} ${f.delta.toFixed(6).padStart(11)}   ${String(f.pooledInside).padStart(4)}/${f.nHeldOut}   ${f.hyperprior.mu0.toFixed(4)}  ${f.hyperprior.kappa0.toFixed(3).padStart(6)}  ${f.hyperprior.tau2.toFixed(4)}`,
    ),
    ``,
    `mean Δ (unweighted over folds): ${r.meanDelta.toFixed(6)} nats/PR  → ${r.criteria.meanDeltaPositive ? 'OK (> 0)' : 'MISS (≤ 0)'}`,
    `positive folds: ${r.positiveFolds}/${r.folds.length} (need ≥ ${r.folds.length - 1})  → ${r.criteria.signRule ? 'OK' : 'MISS'}`,
    `pooled 80%-interval coverage: ${r.pooledCoverage.toFixed(4)} (floor 0.60; unpooled ${r.unpooledCoverage.toFixed(4)})  → ${r.criteria.coverageFloor ? 'OK' : 'MISS'}`,
    ``,
    `VERDICT: ${r.pass ? 'PASS' : 'FAIL'}`,
  ];
  return lines.join('\n');
}
```

- [ ] **Step 4: Wire the CLI commands**

In `src/cli.ts`, add to the import section (near the other inference imports):

```ts
import {
  buildFixture as check4BuildFixture,
  loadFixture as check4LoadFixture,
  renderCheck4,
  runStudy as check4RunStudy,
  CHECK4_FIXTURE_PATH,
  CHECK4_GOLDEN_PATH,
} from './inference/check4-flywheel.js';
```

Add two cases to the command `switch` (before `default:`):

```ts
  case 'check4-fixture': {
    const fx = check4BuildFixture(readEnvelopes());
    mkdirSync(dirname(CHECK4_FIXTURE_PATH), { recursive: true });
    writeFileSync(CHECK4_FIXTURE_PATH, JSON.stringify(fx, null, 2) + '\n');
    console.log(`froze ${fx.rows.length} rows -> ${CHECK4_FIXTURE_PATH}`);
    break;
  }
  case 'check4': {
    const result = check4RunStudy(check4LoadFixture());
    console.log(renderCheck4(result));
    if (rest[0] === '--pin') {
      writeFileSync(CHECK4_GOLDEN_PATH, JSON.stringify(result, null, 2) + '\n');
      console.log(`\npinned golden -> ${CHECK4_GOLDEN_PATH}`);
    }
    break;
  }
```

`readEnvelopes` is already imported in cli.ts; check whether `mkdirSync`, `writeFileSync`, and `dirname` are already imported — add them to the existing `node:fs` / `node:path` imports if not.

Add `check4-fixture|check4` to the `default:` usage string (the `<backfill|seed|...>` list).

- [ ] **Step 5: Run the full check4 test files + typecheck**

Run: `npx vitest run test/check4-math.test.ts test/check4-flywheel.test.ts && npm run typecheck`
Expected: all tests PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/inference/check4-flywheel.ts test/check4-flywheel.test.ts src/cli.ts
git commit -m "feat(check4): fixture IO + verdict rendering + check4/check4-fixture CLI"
```

---

### Task 8: THE REAL RUN — freeze the fixture, pin the verdict regression

**Precondition: Tasks 1–7 are implemented and review-clean (design doc §3.6 — the real-fixture computation runs only after the module is reviewed). Do not reorder this task earlier.**

**Files:**
- Create: `domains/devloop/test/fixtures/check4-cycle-times.json` (generated, committed)
- Create: `domains/devloop/test/fixtures/check4-result.json` (generated, committed)
- Create: `domains/devloop/test/check4-verdict.test.ts`

- [ ] **Step 1: Build + freeze the fixture from the live cluster log**

Run: `npm run dev -- check4-fixture`
Expected output: `froze <N> rows -> .../test/fixtures/check4-cycle-times.json` with N in the high 800s (882 PrMerged events were in the log at framing time; exclusions and dedup may reduce slightly; the log accrues, so N may also be a little higher).

Sanity-check the fold set before proceeding: the design doc §3.2 expects 8 fold repos (specs, exercir, workbench, design-system, substrate, devloop, herdbook, conservation). If the snapshot yields a different qualifying set, that is fine — the ≥20 rule is what is binding — but note the actual F in the PR body.

- [ ] **Step 2: Run the study once and pin the golden**

Run: `npm run dev -- check4 --pin`
Expected: the rendered verdict block (per-fold table + three criteria + `VERDICT: PASS` or `VERDICT: FAIL`) and `pinned golden -> .../test/fixtures/check4-result.json`.

**Transcribe the full rendered output into the PR body and keep it for the specs#298 ledger comment.** Whatever the verdict is, it stands — the rule is frozen; do not adjust anything and re-run.

- [ ] **Step 3: Write the verdict regression test**

Create `test/check4-verdict.test.ts`:

```ts
// Check-4 in-tree regression (the Check-2/3 evidence standard): recompute the
// pre-registered study on the FROZEN fixture and require it to match the pinned
// golden result. Correctness is carried by the hand-derived oracles in
// check4-math.test.ts / check4-flywheel.test.ts; this spec pins the verdict so
// any drift (code, numerics, accidental fixture edit) fails loudly.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CHECK4_FIXTURE_PATH,
  CHECK4_GOLDEN_PATH,
  loadFixture,
  runStudy,
  type Check4Result,
} from '../src/inference/check4-flywheel.js';

describe('Check 4 — pinned verdict on the frozen fixture', () => {
  const golden = JSON.parse(readFileSync(CHECK4_GOLDEN_PATH, 'utf8')) as Check4Result;
  const result = runStudy(loadFixture(CHECK4_FIXTURE_PATH));

  it('reproduces the pinned per-fold deltas and diagnostics', () => {
    expect(result.folds.map((f) => f.repo)).toEqual(golden.folds.map((f) => f.repo));
    result.folds.forEach((f, i) => {
      const g = golden.folds[i]!;
      expect(f.nConditioning).toBe(g.nConditioning);
      expect(f.nHeldOut).toBe(g.nHeldOut);
      expect(f.delta).toBeCloseTo(g.delta, 8);
      expect(f.pooledInside).toBe(g.pooledInside);
      expect(f.unpooledInside).toBe(g.unpooledInside);
      expect(f.hyperprior.mu0).toBeCloseTo(g.hyperprior.mu0, 8);
      expect(f.hyperprior.kappa0).toBeCloseTo(g.hyperprior.kappa0, 8);
    });
  });

  it('reproduces the pinned aggregates and the verdict', () => {
    expect(result.meanDelta).toBeCloseTo(golden.meanDelta, 8);
    expect(result.positiveFolds).toBe(golden.positiveFolds);
    expect(result.pooledCoverage).toBeCloseTo(golden.pooledCoverage, 8);
    expect(result.criteria).toEqual(golden.criteria);
    expect(result.pass).toBe(golden.pass);
  });

  it('re-derives the verdict from the pinned criteria (no stale pass flag)', () => {
    expect(golden.pass).toBe(
      golden.criteria.meanDeltaPositive && golden.criteria.signRule && golden.criteria.coverageFloor,
    );
  });

  it('the fixture has a sane shape (multi-fold, frozen floor respected)', () => {
    expect(result.folds.length).toBeGreaterThanOrEqual(2);
    for (const f of result.folds) expect(f.nConditioning).toBe(5);
  });
});
```

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run && npm run typecheck`
Expected: full devloop suite PASS (≈290 tests incl. the ~30 new ones), tsc clean.

- [ ] **Step 5: Commit (fixture + golden + regression together)**

```bash
git add test/fixtures/check4-cycle-times.json test/fixtures/check4-result.json test/check4-verdict.test.ts
git commit -m "feat(check4): freeze fixture + pin the pre-registered verdict regression"
```

---

### Task 9: Full local gate + PR

- [ ] **Step 1: Run the local CI gate**

Run: `npm run ci:local`
Expected: typecheck + coverage suite green. (The sonar:scan step needs local SonarQube on :9000; if it is down, run `npm run typecheck && npm run test:coverage` and note the skipped scan in the PR body.)

- [ ] **Step 2: Push and open the PR (PR-first — before the verifier wave)**

```bash
git push -u origin feat/check4-flywheel-toy
gh pr create --repo de-braighter/devloop \
  --title "feat(check4): pre-registered flywheel cold-start study + pinned verdict" \
  --body "$(cat <<'EOF'
## What

Implements the pre-registered Check-4 study (workbench docs/superpowers/specs/2026-06-12-check4-flywheel-design.md, merged before this build): leave-one-repo-out cold-start, pooled (MoM random-effects hyperprior from the other fold repos) vs unpooled (unit-information per-repo baseline), scored by held-out log predictive density, frozen PASS rule (mean Δ > 0 ∧ all-but-at-most-one fold positive ∧ pooled 80%-coverage ≥ 0.60).

- `src/inference/check4-math.ts` — lgamma / Student-t log-pdf + CDF / NIG conjugate (hand-derived oracles)
- `src/inference/check4-flywheel.ts` — fixture build, folds, hyperprior, study, frozen rule
- `test/fixtures/check4-cycle-times.json` — frozen snapshot (cluster repos only; no external data)
- `test/check4-verdict.test.ts` — in-tree regression pinning the verdict

## The verdict (rule frozen before the run)

<paste the full rendered `check4` output here>

Producer: orchestrator/claude-fable-5 [writing-plans, subagent-driven-development, test-driven-development]
Effort: standard
Effect: cycle-time 0.5±1 expert
Effect: findings 3±3 expert

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Hand back to the orchestrator**

The verifier wave (local-ci + reviewer + qa-engineer, `isolation: worktree`), post-findings, merge, twin ritual, and the specs#298 ledger verdict comment are orchestrator-level steps after this plan — see the design doc §5.

---

## Self-review notes (spec coverage)

- §3.1 data/fixture → Task 5 (build) + Task 8 (freeze). Exclusions + dedup tested.
- §3.2 folds/k → Task 5 (`FOLD_FLOOR`, `K_CONDITIONING` asserted as frozen dials in tests).
- §3.3 arms → Task 3 (NIG + predictive), Task 4 (MoM hyperprior incl. cap + clamp), Task 6 (unpooled unit-information prior inside `runStudy`).
- §3.4 score → Task 6 (`delta` per fold, unweighted mean across folds).
- §3.5 PASS rule → Task 6 (`verdictFrom`, all four failure modes tested) + coverage via Task 2's `studentTCdf`.
- §3.6 discipline → Task 8 precondition (review-clean before real run), golden pinned once, no dial re-tuning.
- §5 deliverables → Tasks 8–9 (fixture + regression + PR); ledger comment is post-plan.
