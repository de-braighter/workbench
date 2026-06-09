# devloop PR-findings harvest — S3 (readout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the finding-level data as a readout (`devloop findings <repo>` — per-verifier × severity) and as a new `findings` indicator in the what-if engine, so `whatif <repo> findings effort` composes the two twin-ritual improvements (does deeper effort accrue fewer findings?).

**Architecture:** A pure `findingsSummary` aggregates `FindingRecorded` (from S1/S2) by `(verifier, severity)` within a repo. A `findingRatePosterior` (Gamma-Poisson on findings-per-PR, mirroring the existing `betaPosterior`) lets the what-if engine treat `findings` as a lower-is-better count indicator stratifiable by any lever (model, effort, skill).

**Tech Stack:** TypeScript (ESM, explicit `.js` imports), Zod, vitest. Pure in-process (no sidecar) — reuses `gammaStd`/`quantile` from `inference/cycle-time.ts`.

**Spec:** `docs/superpowers/specs/2026-06-09-devloop-pr-findings-harvest-design.md` (slice S3). **Builds on S1+S2** (`FindingRecorded.v1`, `SEVERITIES`) — already merged to `main`.

---

## Repo & working directory

All tasks run in `D:/development/projects/de-braighter/domains/devloop/` (its own git repo). Test runner: `npx vitest run <file>`; typecheck: `npm run typecheck`.

**Branch, before Task 1 — base off `origin/main` (NOT stale local main; S2/#66 just merged there):**

```bash
cd domains/devloop
git fetch origin
git checkout -b feat/findings-readout-s3 origin/main
# sanity: S2 present
git -C . grep -q "post-findings" -- src/cli.ts && echo "S2 present"
```

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/inference/findings.ts` | findings aggregation + the Gamma-Poisson rate posterior | **create** |
| `src/inference/whatif.ts` | add the `findings` count indicator | modify `INDICATORS`, unit type, imports |
| `src/cli.ts` | `findings` readout command + `count`-unit formatting + usage | modify |
| `docs/m2-sdlc-counterfactual-design.md` | note the `findings` indicator | modify |
| `test/findings.test.ts` | summary + rate-posterior tests | **create** |
| `test/whatif.test.ts` | findings × effort lever test | add a describe block |

---

## Task 1: the findings aggregation + rate posterior

**Files:** Create `src/inference/findings.ts`; create `test/findings.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/findings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findingsSummary, findingRatePosterior } from '../src/inference/findings.js';
import { finding } from '../src/events.js';

const TS = '2026-06-09T10:00:00.000Z';
const fe = (repo: string, pr: number, verifier: string, severity: 'blocking' | 'should-fix' | 'nit' | 'note', commentId: number) =>
  finding({ repo, pr, verifier, severity, commentId, text: 't', ts: TS });

describe('findingsSummary', () => {
  it('aggregates per-verifier × severity within a repo, busiest verifier first', () => {
    const events = [
      fe('r', 1, 'qa-engineer', 'blocking', 1),
      fe('r', 1, 'qa-engineer', 'nit', 2),
      fe('r', 2, 'reviewer', 'nit', 3),
      fe('other', 9, 'qa-engineer', 'blocking', 4), // different repo — excluded
    ];
    const s = findingsSummary(events, 'r');
    expect(s.total).toBe(3);
    expect(s.byVerifier[0]).toMatchObject({ verifier: 'qa-engineer', total: 2 });
    expect(s.byVerifier[0]!.bySeverity).toMatchObject({ blocking: 1, nit: 1, 'should-fix': 0, note: 0 });
    expect(s.byVerifier[1]).toMatchObject({ verifier: 'reviewer', total: 1 });
  });

  it('empty repo → zero total, no verifiers', () => {
    expect(findingsSummary([], 'r')).toMatchObject({ total: 0, byVerifier: [] });
  });
});

describe('findingRatePosterior', () => {
  it('point = posterior mean findings/PR (1+Σ)/(1+n); interval brackets it', () => {
    const r = findingRatePosterior([0, 1, 2, 1, 0, 3]); // 7 findings over 6 PRs
    expect(r.point).toBeCloseTo((1 + 7) / (1 + 6), 5);
    expect(r.point).toBeGreaterThan(r.p10);
    expect(r.point).toBeLessThan(r.p90);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/findings.test.ts`
Expected: FAIL — module `../src/inference/findings.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/inference/findings.ts`:

```ts
// S3: the findings readout — aggregate FindingRecorded (S1/S2) into per-verifier × severity
// counts, and a Gamma-Poisson posterior on findings-per-PR so the what-if `findings` indicator
// composes with the effort lever. Pure; reuses the cycle-time MC primitives.
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { ofType } from '../log.js';
import { EVENT, SEVERITIES, type FindingPayload, type Severity } from '../events.js';
import { gammaStd, quantile } from './cycle-time.js';

export interface VerifierFindings { verifier: string; total: number; bySeverity: Record<Severity, number>; }
export interface FindingsSummary { repo: string; total: number; byVerifier: VerifierFindings[]; }

const zeroSev = (): Record<Severity, number> =>
  Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;

/** Per-verifier × severity finding counts within a repo, busiest verifier first. */
export function findingsSummary(events: DomainEventEnvelope[], repo: string): FindingsSummary {
  const byV = new Map<string, VerifierFindings>();
  let total = 0;
  for (const e of ofType(events, EVENT.FINDING)) {
    const f = e.payload as unknown as FindingPayload;
    if (f.repo !== repo) continue;
    let v = byV.get(f.verifier);
    if (!v) { v = { verifier: f.verifier, total: 0, bySeverity: zeroSev() }; byV.set(f.verifier, v); }
    v.total++; v.bySeverity[f.severity]++; total++;
  }
  return { repo, total, byVerifier: [...byV.values()].sort((a, b) => b.total - a.total) };
}

/** Gamma-Poisson posterior on the findings-per-PR rate λ (Gamma(1,1) prior): point = mean,
 *  80% interval from sampled λ. Mirrors betaPosterior; a Gamma(a,b) draw = gammaStd(a)/b. */
export function findingRatePosterior(counts: number[], draws = 20000): { point: number; p10: number; p90: number } {
  const a = 1 + counts.reduce((s, x) => s + x, 0), b = 1 + counts.length;
  const s = new Array<number>(draws);
  for (let i = 0; i < draws; i++) s[i] = gammaStd(a) / b;
  s.sort((x, y) => x - y);
  return { point: a / b, p10: quantile(s, 0.1), p90: quantile(s, 0.9) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/findings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/inference/findings.ts test/findings.test.ts
git commit -m "feat(inference): findings summary + Gamma-Poisson rate posterior

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: the `findings` CLI readout

**Files:** Modify `src/cli.ts`.

- [ ] **Step 1: Add imports**

In `src/cli.ts`, add `SEVERITIES` to the existing `./events.js` import, and add:

```ts
import { findingsSummary } from './inference/findings.js';
```

(The `./events.js` import currently destructures `{ EVENT, effectDeclared, ... }` — add `SEVERITIES` to that list.)

- [ ] **Step 2: Add the readout function**

Add near the other `show*` helpers in `src/cli.ts`:

```ts
function showFindings(repo: string): void {
  if (!repo) { console.log('usage: findings <owner/repo>'); return; }
  const s = findingsSummary(readEnvelopes(), repo);
  console.log(`FINDINGS — ${repo}   ${s.total} finding(s) across ${s.byVerifier.length} verifier(s)\n`);
  if (!s.total) { console.log('   none yet — post agent findings (`post-findings`) or harvest reviews (`reviews`).'); return; }
  for (const v of s.byVerifier)
    console.log(`   ${v.verifier.padEnd(16)} ${String(v.total).padStart(3)}   (${SEVERITIES.map((sev) => `${sev} ${v.bySeverity[sev]}`).join(', ')})`);
}
```

- [ ] **Step 3: Wire the case + usage**

In the `switch (cmd)` block, add (e.g. after the `reviews` case):

```ts
  case 'findings': showFindings(rest[0] ?? ''); break;
```

In the top-level `default:` usage string, add `findings` to the command list.

- [ ] **Step 4: Verify it runs (no data path is fine)**

Run: `npx tsx src/cli.ts findings de-braighter/devloop`
Expected: prints `FINDINGS — de-braighter/devloop   N finding(s) across M verifier(s)` then per-verifier rows (N reflects findings harvested from S1/S2 on real PRs).

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): findings readout — per-verifier × severity

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: the `findings` what-if indicator (composes with effort)

**Files:** Modify `src/inference/whatif.ts`; modify `src/cli.ts` (the `count` unit format); add a describe block to `test/whatif.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `test/whatif.test.ts` (after the last describe). NOTE: add `finding` to the top-of-file `../src/events.js` import (it currently imports `{ prMerged, producer, verdict }`).

```ts
describe('whatIf — findings indicator (composes with effort)', () => {
  const mergeF = (repo: string, pr: number, ts: string, effort: 'light' | 'standard' | 'deep', nFindings: number) => {
    const evs = [
      prMerged({ repo, pr, title: 'x', cycleHours: 0.2, ts }),
      producer({ repo, pr, producer: 'orchestrator', model: 'claude-opus-4-8', effort, ts }),
    ];
    for (let i = 0; i < nFindings; i++) evs.push(finding({ repo, pr, verifier: 'reviewer', severity: 'nit', commentId: pr * 100 + i, text: 't', ts }));
    return evs;
  };

  it('stratifies findings-per-PR by effort tier (lower is better)', () => {
    const events = [];
    for (let i = 0; i < 6; i++) events.push(...mergeF('r', i + 1, `2026-05-${10 + i}T10:00:00.000Z`, 'deep', 0));
    for (let i = 0; i < 6; i++) events.push(...mergeF('r', i + 101, `2026-05-${11 + i}T10:00:00.000Z`, 'standard', 3));
    const w = whatIf(events, { repo: 'r', indicator: 'findings', by: 'effort' });
    expect(w.unit).toBe('count');
    expect(w.higherIsBetter).toBe(false);
    expect(w.strata.map((s) => s.value).sort()).toEqual(['deep', 'standard']);
    expect(w.strata[0]!.value).toBe('deep'); // fewer findings = better → first (ascending)
    expect(w.strata[0]!.point).toBeLessThan(w.strata[1]!.point);
    expect(w.conclusive).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/whatif.test.ts`
Expected: FAIL — `indicator 'findings' not supported`.

- [ ] **Step 3: Write minimal implementation**

In `src/inference/whatif.ts`:

(a) Extend the imports — add `findingRatePosterior` and `FindingPayload`:

```ts
import { findingRatePosterior } from './findings.js';
```

and add `type FindingPayload` to the existing `../events.js` import (it imports `{ EVENT, type PrMergedPayload, type ProducerPayload, type VerdictPayload, type PrOpenedPayload }`).

(b) Widen the unit type in **both** the `IndicatorDef` interface and the `WhatIf` interface: change `unit: 'hours' | 'probability'` to `unit: 'hours' | 'probability' | 'count'` in each.

(c) Add the `findings` indicator to the `INDICATORS` record (after `cleanliness`):

```ts
  findings: {
    unit: 'count',
    higherIsBetter: false,
    observe: (events, repo) => {
      const m = new Map<number, number>();
      for (const e of prMergedIn(events, repo)) m.set((e.payload as unknown as PrMergedPayload).pr, 0); // 0-finding PRs count as 0
      for (const e of ofType(events, EVENT.FINDING)) {
        const p = e.payload as unknown as FindingPayload;
        if (p.repo === repo && m.has(p.pr)) m.set(p.pr, (m.get(p.pr) ?? 0) + 1);
      }
      return m;
    },
    fit: (v) => findingRatePosterior(v),
  },
```

- [ ] **Step 4: Add the `count` unit format in the CLI**

In `src/cli.ts`, in `showWhatIf`, the `fmt` line currently reads `const fmt = (x: number) => (w.unit === 'probability' ? pct(x) : fmtH(x));`. Change it to:

```ts
  const fmt = (x: number) => (w.unit === 'probability' ? pct(x) : w.unit === 'count' ? x.toFixed(2) : fmtH(x));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/whatif.test.ts`
Expected: PASS (all existing + the new findings × effort test).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/inference/whatif.ts src/cli.ts test/whatif.test.ts
git commit -m "feat(whatif): findings count indicator — composes with the effort lever

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: docs

**Files:** Modify `src/cli.ts` (whatif usage string); modify `docs/m2-sdlc-counterfactual-design.md`.

- [ ] **Step 1: Update the whatif usage string**

In `src/cli.ts` `showWhatIf`, the usage line lists `[indicator=cycle-time|cleanliness]`. Change it to `[indicator=cycle-time|cleanliness|findings]`.

- [ ] **Step 2: Note the indicator in the M2 design doc**

In `docs/m2-sdlc-counterfactual-design.md`, in the model table row `| **Indicators** | ... |`, ensure `findings` (per-PR finding count, lower-is-better, from `FindingRecorded`) is listed, and under **Build slices → S2/S3** append: `The S3 \`findings\` readout (per-verifier × severity) + a what-if \`findings\` count indicator (Gamma-Poisson) compose finding-volume with the effort lever (\`whatif <repo> findings effort\`).`

- [ ] **Step 3: Verify the CLI prints the new indicator + readout**

Run: `npx tsx src/cli.ts whatif && npx tsx src/cli.ts findings`
Expected: the whatif usage lists `findings`; `findings` (no repo) prints its own usage.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts docs/m2-sdlc-counterfactual-design.md
git commit -m "docs(findings): document the findings readout + indicator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done (S3)

- [ ] `npx vitest run` green; `npm run typecheck` exit 0 in `domains/devloop/`.
- [ ] `devloop findings <repo>` prints per-verifier × severity counts from `FindingRecorded` events.
- [ ] `devloop whatif <repo> findings effort` stratifies findings-per-PR by effort tier (lower-is-better, Gamma-Poisson), inheriting the engine's confound honesty (thin-stratum, temporal-overlap, operator-choice warning).

## Deferred (later)

- **Verdict-derived-from-findings** unification (so the existing `cleanliness` indicator also reflects agent findings) — distinct from the new additive `findings` indicator; only if it earns its keep.
- **S4** — resolution / precision (finding→fix linkage); harvesting no-path issue comments.
- **Structured reviewer output** — agents emitting findings JSON directly.
