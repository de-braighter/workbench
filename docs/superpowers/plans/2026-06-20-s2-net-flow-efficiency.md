# S2 net-flow-efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a derived paired delivery verdict (`net-flow-efficiency`) to the SDLC twin that composes the existing `cycle-time` and `short-term-churn` indicators into one judgement — speed-down + churn-up reads as NOT-A-PASS.

**Architecture:** A pure composition layer over `whatIf` (`src/inference/whatif.ts`). Two flavours share one core: (A) `netFlow` runs `whatIf` on both indicators for the same lever (counterfactual); (B) `netFlowTrend` injects a time-window lever (trend). `composeNetFlow` classifies each directional claim by 80%-credible-interval separation and applies the verdict matrix. No posteriors or honesty logic are re-implemented — all inherited from `whatIf`.

**Tech Stack:** TypeScript (ESM, explicit `.js` import extensions), vitest, tsx CLI. Spec: `domains/devloop/docs/s2-net-flow-efficiency-design.md`. ADR: `layers/specs/adr/adr-270-net-flow-efficiency-paired-verdict.md`.

## Global Constraints

- **Work in `domains/devloop` on branch `feat-net-flow-efficiency-s2`** (already created). Verify the branch before every commit (shared-clone safety). No git ops in any other clone.
- **TREND/WARN, never a GATE** — the verdict never blocks a merge.
- **Reuse, don't reinvent** — compose `whatIf`; re-derive NO posteriors, re-implement NO honesty logic.
- **The ONLY `whatif.ts` change is an additive, optional `lever?: Map<number,string>` parameter** — absent ⇒ behaviour byte-for-byte unchanged.
- **No `Date.now()` / `new Date()` in the analyzable core** — inject `now: Date` (S1 determinism lesson). `new Date()` is allowed ONLY at the CLI boundary.
- **Posteriors are Monte-Carlo** (`cycleTimePredictive`, `betaPosterior` use `Math.random()`) — test the composition core with hand-built synthetic `WhatIf` fixtures (deterministic); integration tests assert **verdict only** with extreme separation; never assert exact `p10`/`p90`.
- **ESM imports** end in `.js`. **Un-export** any helper used only inside its file (knip). Gate = `npm run typecheck && npm run test` (+ `npx knip`).
- **2-arm boundary** — the verdict is defined for a 2-arm comparison; >2 surviving arms ⇒ `INCONCLUSIVE`.
- **CFR is out** (no prod-deploy/incident data — deferred-aspirational).

Interval-separation rule (lower-is-better metric; both `cycle-time` and `short-term-churn` are lower-is-better): treatment `t` vs baseline `b` → `down` iff `t.p90 < b.p10`; `up` iff `t.p10 > b.p90`; else `flat`. For `cycle-time`, `down` = faster (good). For `short-term-churn`, `up` = more churn (bad).

Verdict matrix: `speed=down & churn∈{flat,down}` → **PASS**; `speed=down & churn=up` → **SPEED_FOR_CHURN** (the acid); `speed∈{flat,up}` → **NO_SPEED_GAIN**; any indicator unusable → **INCONCLUSIVE**.

---

### Task 1: `whatIf` additive `lever` override seam

**Files:**
- Modify: `src/inference/whatif.ts` (the `whatIf` function signature + lever resolution, ~lines 155–166)
- Test: `test/whatif-lever-override.test.ts` (create)

**Interfaces:**
- Produces: `whatIf(events, { repo, indicator, by, lever?: Map<number, string> }): WhatIf` — when `lever` is supplied, `whatIf` uses it directly (the `by` string becomes a display label) and skips `leverValues`; absent ⇒ unchanged.

- [ ] **Step 1: Write the failing test** — `test/whatif-lever-override.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { prMerged, producer } from '../src/events.js';
import { whatIf } from '../src/inference/whatif.js';

const repo = 'r';
const cyc = (pr: number, h: number, ts: string) => prMerged({ repo, pr, title: 'x', cycleHours: h, ts });

describe('whatIf — additive lever override (S2 seam)', () => {
  it('buckets PRs by the injected lever map, ignoring the `by` string', () => {
    const events = [];
    for (let i = 0; i < 6; i++) events.push(cyc(i + 1, 0.1, `2026-05-${10 + i}T10:00:00.000Z`));
    for (let i = 0; i < 6; i++) events.push(cyc(i + 101, 5, `2026-05-${10 + i}T10:00:00.000Z`));
    const lever = new Map<number, string>();
    for (let i = 0; i < 6; i++) lever.set(i + 1, 'A');
    for (let i = 0; i < 6; i++) lever.set(i + 101, 'B');
    const w = whatIf(events, { repo, indicator: 'cycle-time', by: 'window', lever });
    expect(w.strata.map((s) => s.value).sort()).toEqual(['A', 'B']);
    expect(w.strata.every((s) => s.n === 6)).toBe(true);
  });

  it('without an override, an unregistered `by` (window) is unsupported', () => {
    const events = [cyc(1, 0.1, '2026-05-10T10:00:00.000Z')];
    const w = whatIf(events, { repo, indicator: 'cycle-time', by: 'window' });
    expect(w.strata).toEqual([]);
    expect(w.warnings.some((x) => /not supported/.test(x))).toBe(true);
  });

  it('regression: the existing `by:model` path is unchanged', () => {
    const events = [];
    for (let i = 0; i < 6; i++) events.push(cyc(i + 1, 0.1, `2026-05-${10 + i}T10:00:00.000Z`), producer({ repo, pr: i + 1, producer: 'o', model: 'claude-opus-4-8', ts: `2026-05-${10 + i}T10:00:00.000Z` }));
    for (let i = 0; i < 6; i++) events.push(cyc(i + 101, 5, `2026-05-${10 + i}T10:00:00.000Z`), producer({ repo, pr: i + 101, producer: 'o', model: 'claude-sonnet-4-6', ts: `2026-05-${10 + i}T10:00:00.000Z` }));
    const w = whatIf(events, { repo, indicator: 'cycle-time', by: 'model' });
    expect(w.strata.map((s) => s.value).sort()).toEqual(['claude-opus-4-8', 'claude-sonnet-4-6']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/whatif-lever-override.test.ts`
Expected: the override test FAILS (the `lever` option is ignored → `by:'window'` is unsupported → empty strata).

- [ ] **Step 3: Implement the minimal change** in `src/inference/whatif.ts`. Change the signature and lever resolution:

```ts
export function whatIf(events: DomainEventEnvelope[], opts: { repo: string; indicator: string; by: string; lever?: Map<number, string> }): WhatIf {
  const { repo, indicator, by, lever: leverOverride } = opts;
```

Then replace the lever-resolution block (currently `const { values: lever, ok } = leverValues(events, repo, by); if (!ok) return empty(...); if (by === 'effort') warnings.push(...);`) with:

```ts
  const { values: lever, ok } = leverOverride ? { values: leverOverride, ok: true } : leverValues(events, repo, by);
  if (!ok) return empty(`lever '${by}' not supported (try: change-type | author | model | provider | producer | effort | skill:<name>)`);
  if (!leverOverride && by === 'effort') warnings.push('effort is operator-chosen — harder changes draw deeper effort; Δ may reflect DIFFICULTY, not effort. Condition on change-type (deferred) or randomize (deferred) for a causal read.');
```

(Keep the existing `empty(...)` text for the `!ind` branch unchanged; only the lever block changes.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/whatif-lever-override.test.ts` → all 3 PASS.
Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/inference/whatif.ts test/whatif-lever-override.test.ts
git commit -m "feat(devloop): whatIf additive lever override seam (S2 net-flow)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The composition core (`composeNetFlow`)

**Files:**
- Create: `src/inference/net-flow.ts` (types + `separation` + `classify` + `composeNetFlow`)
- Test: `test/net-flow.test.ts` (create — the biting acids)

**Interfaces:**
- Consumes: `WhatIf`, `WhatIfStratum` from `./whatif.js`.
- Produces:
  - `type Direction = 'down' | 'flat' | 'up'`
  - `type Verdict = 'PASS' | 'SPEED_FOR_CHURN' | 'NO_SPEED_GAIN' | 'INCONCLUSIVE'`
  - `interface ComposeOpts { treatmentArm: string; baselineArm: string; requireTemporalOverlap: boolean }`
  - `interface ComposeResult { speed?: Direction; churn?: Direction; verdict: Verdict; warnings: string[] }`
  - `composeNetFlow(cycle: WhatIf, churn: WhatIf, opts: ComposeOpts): ComposeResult`
  - `interface NetFlow { repo; by; mode: 'counterfactual'|'trend'; treatmentArm?; baselineArm?; speed?: Direction; churn?: Direction; verdict: Verdict; cycle: WhatIf; churnWhatIf: WhatIf; warnings: string[] }` (declared here; consumed by Task 3 + Task 4)

- [ ] **Step 1: Write the failing tests** — `test/net-flow.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { composeNetFlow } from '../src/inference/net-flow.js';
import type { WhatIf, WhatIfStratum } from '../src/inference/whatif.js';

const s = (value: string, point: number, p10: number, p90: number): WhatIfStratum =>
  ({ value, n: 6, point, p10, p90, firstAt: '2026-02-01T00:00:00.000Z', lastAt: '2026-02-20T00:00:00.000Z' });

const wi = (indicator: string, strata: WhatIfStratum[], conclusive = true, warnings: string[] = []): WhatIf => ({
  repo: 'r', indicator, by: 'model', unit: indicator === 'cycle-time' ? 'hours' : 'probability',
  higherIsBetter: false, strata, conclusive, warnings,
});

const opts = (requireTemporalOverlap: boolean) => ({ treatmentArm: 'T', baselineArm: 'B', requireTemporalOverlap });

describe('composeNetFlow — verdict matrix', () => {
  it('THE ACID: speed down + churn up = SPEED_FOR_CHURN (a regression masquerading as improvement)', () => {
    const cycle = wi('cycle-time', [s('T', 0.1, 0.05, 0.3), s('B', 5, 3, 10)]);   // T.p90 0.3 < B.p10 3 → speed down
    const churn = wi('short-term-churn', [s('T', 0.4, 0.35, 0.45), s('B', 0.05, 0.02, 0.08)]); // T.p10 0.35 > B.p90 0.08 → churn up
    const r = composeNetFlow(cycle, churn, opts(true));
    expect(r.speed).toBe('down');
    expect(r.churn).toBe('up');
    expect(r.verdict).toBe('SPEED_FOR_CHURN');
  });

  it('PASS: speed down + churn flat (bands overlap)', () => {
    const cycle = wi('cycle-time', [s('T', 0.1, 0.05, 0.3), s('B', 5, 3, 10)]);
    const churn = wi('short-term-churn', [s('T', 0.2, 0.1, 0.3), s('B', 0.18, 0.1, 0.3)]); // overlap → flat
    const r = composeNetFlow(cycle, churn, opts(true));
    expect(r.speed).toBe('down');
    expect(r.churn).toBe('flat');
    expect(r.verdict).toBe('PASS');
  });

  it('PASS: speed down + churn down (the dream — faster AND cleaner)', () => {
    const cycle = wi('cycle-time', [s('T', 0.1, 0.05, 0.3), s('B', 5, 3, 10)]);
    const churn = wi('short-term-churn', [s('T', 0.05, 0.02, 0.08), s('B', 0.4, 0.35, 0.45)]); // T.p90 0.08 < B.p10 0.35 → churn down
    const r = composeNetFlow(cycle, churn, opts(true));
    expect(r.verdict).toBe('PASS');
  });

  it('NO_SPEED_GAIN: speed flat even when churn is down (speed alone is not a pass)', () => {
    const cycle = wi('cycle-time', [s('T', 0.2, 0.1, 0.3), s('B', 0.22, 0.1, 0.3)]); // overlap → flat
    const churn = wi('short-term-churn', [s('T', 0.05, 0.02, 0.08), s('B', 0.4, 0.35, 0.45)]); // churn down
    const r = composeNetFlow(cycle, churn, opts(true));
    expect(r.speed).toBe('flat');
    expect(r.verdict).toBe('NO_SPEED_GAIN');
  });

  it('flat (not a false direction): points differ but bands overlap → flat', () => {
    const cycle = wi('cycle-time', [s('T', 0.1, 0.05, 0.5), s('B', 0.2, 0.05, 0.5)]);
    const churn = wi('short-term-churn', [s('T', 0.2, 0.1, 0.3), s('B', 0.2, 0.1, 0.3)]);
    const r = composeNetFlow(cycle, churn, opts(true));
    expect(r.speed).toBe('flat');
    expect(r.churn).toBe('flat');
  });
});

describe('composeNetFlow — INCONCLUSIVE propagation', () => {
  it('churn arm missing (open 14d window) → INCONCLUSIVE naming the arm + the lag', () => {
    const cycle = wi('cycle-time', [s('T', 0.1, 0.05, 0.3), s('B', 5, 3, 10)]);
    const churn = wi('short-term-churn', [s('B', 0.05, 0.02, 0.08)]); // T absent
    const r = composeNetFlow(cycle, churn, opts(false));
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.warnings.some((w) => /no closed-window churn data yet/.test(w) && /'T'/.test(w))).toBe(true);
  });

  it('cycle arm missing → INCONCLUSIVE', () => {
    const cycle = wi('cycle-time', [s('B', 5, 3, 10)]); // T absent
    const churn = wi('short-term-churn', [s('T', 0.2, 0.1, 0.3), s('B', 0.2, 0.1, 0.3)]);
    const r = composeNetFlow(cycle, churn, opts(false));
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.warnings.some((w) => /cycle-time: arm 'T'/.test(w))).toBe(true);
  });

  it('A vs B divergence: identical NON-overlapping inputs → A INCONCLUSIVE, B reports a verdict', () => {
    const warn = ['strata do NOT temporally overlap — confounded by TIME (the repo/tasks evolved), not just the lever.'];
    const cycle = wi('cycle-time', [s('T', 0.1, 0.05, 0.3), s('B', 5, 3, 10)], false, warn);
    const churn = wi('short-term-churn', [s('T', 0.05, 0.02, 0.08), s('B', 0.4, 0.35, 0.45)], false, warn);
    const a = composeNetFlow(cycle, churn, opts(true));   // counterfactual: overlap required
    const b = composeNetFlow(cycle, churn, opts(false));  // trend: overlap not required
    expect(a.verdict).toBe('INCONCLUSIVE');
    expect(b.verdict).toBe('PASS'); // speed down + churn down
  });

  it('>2 surviving arms → INCONCLUSIVE (verdict is 2-arm)', () => {
    const cycle = wi('cycle-time', [s('T', 0.1, 0.05, 0.3), s('B', 5, 3, 10), s('C', 1, 0.5, 2)]);
    const churn = wi('short-term-churn', [s('T', 0.2, 0.1, 0.3), s('B', 0.2, 0.1, 0.3)]);
    const r = composeNetFlow(cycle, churn, opts(false));
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.warnings.some((w) => /2-arm/.test(w))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/net-flow.test.ts`
Expected: FAIL — `composeNetFlow` not exported / module not found.

- [ ] **Step 3: Implement `src/inference/net-flow.ts`** (this task adds everything except `windowLever`/`netFlow`/`netFlowTrend`, which Task 3 appends):

```ts
// net-flow-efficiency (S2): a derived PAIRED delivery verdict that composes cycle-time
// + short-term-churn (S1) over whatIf. Speed-down + churn-up = NOT-A-PASS. TREND/WARN,
// never a gate. Pure composition — no posteriors re-derived; all honesty machinery is
// inherited from whatIf. Design: docs/s2-net-flow-efficiency-design.md (ADR-270).
import type { WhatIf, WhatIfStratum } from './whatif.js';

export type Direction = 'down' | 'flat' | 'up';
export type Verdict = 'PASS' | 'SPEED_FOR_CHURN' | 'NO_SPEED_GAIN' | 'INCONCLUSIVE';

export interface NetFlow {
  repo: string;
  by: string;
  mode: 'counterfactual' | 'trend';
  treatmentArm?: string;
  baselineArm?: string;
  speed?: Direction;
  churn?: Direction;
  verdict: Verdict;
  cycle: WhatIf;
  churnWhatIf: WhatIf;
  warnings: string[];
}

export interface ComposeOpts {
  treatmentArm: string;
  baselineArm: string;
  requireTemporalOverlap: boolean;
}

export interface ComposeResult {
  speed?: Direction;
  churn?: Direction;
  verdict: Verdict;
  warnings: string[];
}

const armOf = (w: WhatIf, value: string): WhatIfStratum | undefined => w.strata.find((x) => x.value === value);

/** Interval-separation of treatment `t` vs baseline `b` on a LOWER-IS-BETTER metric:
 *  'down' = t band entirely BELOW b (t.p90 < b.p10); 'up' = t band entirely ABOVE b
 *  (t.p10 > b.p90); else 'flat' (80% bands overlap — not point-noise). */
function separation(t: WhatIfStratum, b: WhatIfStratum): Direction {
  if (t.p90 < b.p10) return 'down';
  if (t.p10 > b.p90) return 'up';
  return 'flat';
}

/** speed down + churn flat-or-down = PASS; speed down + churn up = the acid;
 *  speed flat/up = NO_SPEED_GAIN (speed alone is not a pass). */
function classify(speed: Direction, churn: Direction): Verdict {
  if (speed === 'down') return churn === 'up' ? 'SPEED_FOR_CHURN' : 'PASS';
  return 'NO_SPEED_GAIN';
}

/** Compose two WhatIf results into one paired verdict. Pure; re-derives no posteriors. */
export function composeNetFlow(cycle: WhatIf, churn: WhatIf, opts: ComposeOpts): ComposeResult {
  const warnings = [...cycle.warnings, ...churn.warnings];
  if (cycle.strata.length > 2 || churn.strata.length > 2)
    return { verdict: 'INCONCLUSIVE', warnings: [...warnings, `net-flow verdict is 2-arm; got cycle=${cycle.strata.length}/churn=${churn.strata.length} surviving arms — use \`whatif\` per indicator`] };
  const tc = armOf(cycle, opts.treatmentArm), bc = armOf(cycle, opts.baselineArm);
  if (!tc || !bc)
    return { verdict: 'INCONCLUSIVE', warnings: [...warnings, `cycle-time: arm '${tc ? opts.baselineArm : opts.treatmentArm}' missing or too thin (< MIN_N)`] };
  const th = armOf(churn, opts.treatmentArm), bh = armOf(churn, opts.baselineArm);
  if (!th || !bh)
    return { verdict: 'INCONCLUSIVE', warnings: [...warnings, `short-term-churn: arm '${th ? opts.baselineArm : opts.treatmentArm}' has no closed-window churn data yet (churn lags 14d) or too thin (< MIN_N)`] };
  if (opts.requireTemporalOverlap && (!cycle.conclusive || !churn.conclusive))
    return { verdict: 'INCONCLUSIVE', warnings: [...warnings, 'counterfactual needs temporally-overlapping strata in BOTH indicators (a causal claim refuses time-confounded arms)'] };
  const speed = separation(tc, bc);
  const churnDir = separation(th, bh);
  return { speed, churn: churnDir, verdict: classify(speed, churnDir), warnings };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/net-flow.test.ts` → all PASS.
Then `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/inference/net-flow.ts test/net-flow.test.ts
git commit -m "feat(devloop): net-flow composition core + verdict matrix (S2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Public entry points — `netFlow` (A), `netFlowTrend` (B), `windowLever`

**Files:**
- Modify: `src/inference/net-flow.ts` (append `windowLever`, `netFlow`, `netFlowTrend`)
- Test: `test/net-flow.test.ts` (append the integration + window-bucketing acids)

**Interfaces:**
- Consumes: `composeNetFlow`, `NetFlow` (Task 2); `whatIf` + the `lever` override (Task 1); `ofType` from `../log.js`; `EVENT`, `PrMergedPayload` from `../events.js`; event constructors `prMerged`, `producer`, `churnObserved` (tests).
- Produces:
  - `windowLever(events, repo, { now: Date; baselineWeeks: number; recentWeeks: number }): Map<number, string>`
  - `netFlow(events, { repo: string; by: string }): NetFlow`
  - `netFlowTrend(events, { repo: string; now: Date; baselineWeeks?: number; recentWeeks?: number }): NetFlow`

- [ ] **Step 1: Write the failing tests** — append to `test/net-flow.test.ts`:

```ts
import { windowLever, netFlow, netFlowTrend } from '../src/inference/net-flow.js';
import { prMerged, producer, churnObserved } from '../src/events.js';

const WEEK = 7 * 24 * 3600 * 1000;

describe('windowLever — deterministic bucketing (now injected)', () => {
  const now = new Date('2026-06-20T00:00:00.000Z');
  const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  const pm = (pr: number, ts: string) => prMerged({ repo: 'r', pr, title: 'x', cycleHours: 1, ts });

  it('buckets recent / baseline / omitted around now', () => {
    const events = [pm(1, at(1 * WEEK)), pm(2, at(12 * WEEK)), pm(3, at(20 * WEEK))];
    const m = windowLever(events, 'r', { now, baselineWeeks: 8, recentWeeks: 8 });
    expect(m.get(1)).toBe('recent');
    expect(m.get(2)).toBe('baseline');
    expect(m.has(3)).toBe(false);
  });

  it('pins the boundaries: recentStart→recent, baselineStart→baseline, 1ms older→omitted', () => {
    const events = [pm(1, at(8 * WEEK)), pm(2, at(16 * WEEK)), pm(3, at(16 * WEEK + 1))];
    const m = windowLever(events, 'r', { now, baselineWeeks: 8, recentWeeks: 8 });
    expect(m.get(1)).toBe('recent');
    expect(m.get(2)).toBe('baseline');
    expect(m.has(3)).toBe(false);
  });

  it('ignores other repos', () => {
    const events = [prMerged({ repo: 'other', pr: 9, title: 'x', cycleHours: 1, ts: at(1 * WEEK) })];
    expect(windowLever(events, 'r', { now, baselineWeeks: 8, recentWeeks: 8 }).size).toBe(0);
  });
});

describe('netFlow (A) — integration (verdict only; extreme separation = MC-robust)', () => {
  const repo = 'r';
  // model A = fast + clean; model B = slow + churny. A is the faster arm (treatment).
  const ts = (i: number) => `2026-05-${10 + i}T10:00:00.000Z`;
  const arm = (prBase: number, model: string, h: number, churned: number) =>
    Array.from({ length: 6 }, (_, i) => [
      prMerged({ repo, pr: prBase + i, title: 'x', cycleHours: h, ts: ts(i) }),
      producer({ repo, pr: prBase + i, producer: 'o', model, ts: ts(i) }),
      churnObserved({ repo, pr: prBase + i, mergedAt: ts(i), authored: 100, churned, ratio: churned / 100, ts: ts(i) }),
    ]).flat();

  it('faster + cleaner arm → PASS', () => {
    const events = [...arm(1, 'claude-opus-4-8', 0.05, 2), ...arm(101, 'claude-sonnet-4-6', 50, 2)];
    const nf = netFlow(events, { repo, by: 'model' });
    expect(nf.treatmentArm).toBe('claude-opus-4-8'); // fastest = treatment
    expect(nf.verdict).toBe('PASS');
  });

  it('faster BUT churnier arm → SPEED_FOR_CHURN (the acid, end-to-end)', () => {
    const events = [...arm(1, 'claude-opus-4-8', 0.05, 45), ...arm(101, 'claude-sonnet-4-6', 50, 2)];
    const nf = netFlow(events, { repo, by: 'model' });
    expect(nf.treatmentArm).toBe('claude-opus-4-8');
    expect(nf.verdict).toBe('SPEED_FOR_CHURN');
  });

  it('churn arm absent (no ChurnObserved) → INCONCLUSIVE with the 14d-lag reason', () => {
    const noChurn = (prBase: number, model: string, h: number) =>
      Array.from({ length: 6 }, (_, i) => [
        prMerged({ repo, pr: prBase + i, title: 'x', cycleHours: h, ts: ts(i) }),
        producer({ repo, pr: prBase + i, producer: 'o', model, ts: ts(i) }),
      ]).flat();
    const events = [...noChurn(1, 'claude-opus-4-8', 0.05), ...noChurn(101, 'claude-sonnet-4-6', 50)];
    const nf = netFlow(events, { repo, by: 'model' });
    expect(nf.verdict).toBe('INCONCLUSIVE');
    expect(nf.warnings.some((w) => /churn lags 14d/.test(w))).toBe(true);
  });
});

describe('netFlowTrend (B) — surfaces-and-reframes the non-overlap warning (never suppresses)', () => {
  const repo = 'r';
  const now = new Date('2026-06-20T00:00:00.000Z');
  const at = (msAgo: number) => new Date(now.getTime() - msAgo).toISOString();
  // baseline window ~12wk ago, recent window ~3wk ago — disjoint by construction.
  const window6 = (prBase: number, weeksAgo: number, h: number, churned: number) =>
    Array.from({ length: 6 }, (_, i) => {
      const t = at(weeksAgo * WEEK + i * 12 * 3600 * 1000);
      return [
        prMerged({ repo, pr: prBase + i, title: 'x', cycleHours: h, ts: t }),
        churnObserved({ repo, pr: prBase + i, mergedAt: t, authored: 100, churned, ratio: churned / 100, ts: t }),
      ];
    }).flat();

  it('reports a verdict (not INCONCLUSIVE-on-overlap) AND shows the reframed caveat', () => {
    const events = [...window6(1, 3, 0.05, 2), ...window6(101, 12, 50, 2)]; // recent fast+clean, baseline slow+clean
    const nf = netFlowTrend(events, { repo, now });
    expect(nf.mode).toBe('trend');
    expect(nf.verdict).not.toBe('INCONCLUSIVE'); // overlap is NOT a disqualifier for a trend
    expect(nf.warnings.some((w) => /EXPECTED for a trend/.test(w))).toBe(true); // reframed, not suppressed
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/net-flow.test.ts`
Expected: the new tests FAIL — `windowLever`/`netFlow`/`netFlowTrend` not exported.

- [ ] **Step 3: Append the implementation** to `src/inference/net-flow.ts`. First extend the imports at the top of the file:

```ts
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { ofType } from '../log.js';
import { EVENT, type PrMergedPayload } from '../events.js';
import { whatIf } from './whatif.js';
```

(Keep the existing `import type { WhatIf, WhatIfStratum } from './whatif.js';` — merge the `whatIf` value import alongside it or add the line above.)

Then append:

```ts
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Bucket each repo PR into 'recent' (trailing recentWeeks) or 'baseline' (the prior
 *  baselineWeeks); PRs outside both windows are omitted. `now` is injected (no Date.now
 *  in the core). recentStart is inclusive of 'recent'; baselineStart inclusive of 'baseline'. */
export function windowLever(
  events: DomainEventEnvelope[],
  repo: string,
  opts: { now: Date; baselineWeeks: number; recentWeeks: number },
): Map<number, string> {
  const nowMs = opts.now.getTime();
  const recentStart = nowMs - opts.recentWeeks * WEEK_MS;
  const baselineStart = recentStart - opts.baselineWeeks * WEEK_MS;
  const m = new Map<number, string>();
  for (const e of ofType(events, EVENT.PR_MERGED)) {
    const p = e.payload as unknown as PrMergedPayload;
    if (p.repo !== repo) continue;
    const t = Date.parse(e.occurredAt);
    if (t > nowMs) continue;
    if (t >= recentStart) m.set(p.pr, 'recent');
    else if (t >= baselineStart) m.set(p.pr, 'baseline');
  }
  return m;
}

/** (A) paired-LEVER counterfactual: treatment = the faster cycle-time arm. */
export function netFlow(events: DomainEventEnvelope[], opts: { repo: string; by: string }): NetFlow {
  const { repo, by } = opts;
  const cycle = whatIf(events, { repo, indicator: 'cycle-time', by });
  const churnWhatIf = whatIf(events, { repo, indicator: 'short-term-churn', by });
  const base = { repo, by, mode: 'counterfactual' as const, cycle, churnWhatIf };
  if (cycle.strata.length < 2)
    return { ...base, verdict: 'INCONCLUSIVE', warnings: [...cycle.warnings, ...churnWhatIf.warnings, `cycle-time: need ≥2 arms to identify the faster; got ${cycle.strata.length}`] };
  const treatmentArm = cycle.strata[0]!.value; // best-first → fastest
  const baselineArm = cycle.strata[1]!.value;
  const r = composeNetFlow(cycle, churnWhatIf, { treatmentArm, baselineArm, requireTemporalOverlap: true });
  return { ...base, treatmentArm, baselineArm, speed: r.speed, churn: r.churn, verdict: r.verdict, warnings: r.warnings };
}

/** (B) paired-TREND: time IS the lever (trailing recent vs prior baseline window). */
export function netFlowTrend(
  events: DomainEventEnvelope[],
  opts: { repo: string; now: Date; baselineWeeks?: number; recentWeeks?: number },
): NetFlow {
  const { repo, now, baselineWeeks = 8, recentWeeks = 8 } = opts;
  const lever = windowLever(events, repo, { now, baselineWeeks, recentWeeks });
  const cycle = whatIf(events, { repo, indicator: 'cycle-time', by: 'window', lever });
  const churnWhatIf = whatIf(events, { repo, indicator: 'short-term-churn', by: 'window', lever });
  const r = composeNetFlow(cycle, churnWhatIf, { treatmentArm: 'recent', baselineArm: 'baseline', requireTemporalOverlap: false });
  // Surface-and-reframe (NEVER suppress) the temporal-non-overlap warning: a trend IS a
  // comparison of two time windows, so non-overlap is its definition, not a disqualifier.
  const warnings = r.warnings.map((w) =>
    /temporally overlap/i.test(w) ? `${w}  [EXPECTED for a trend — time IS the lever; monitoring only, never causal]` : w,
  );
  return { repo, by: 'window', mode: 'trend', treatmentArm: 'recent', baselineArm: 'baseline', cycle, churnWhatIf, speed: r.speed, churn: r.churn, verdict: r.verdict, warnings };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/net-flow.test.ts` → all PASS.
Then `npm run typecheck` → clean. Then `npx knip` → no NEW unused exports from `net-flow.ts` (all of `composeNetFlow`/`windowLever`/`netFlow`/`netFlowTrend` are used in-file or by Task 4 + tests; if knip flags `ComposeOpts`/`ComposeResult`/`Direction`/`Verdict` as unused, leave them — they are consumed by tests and Task 4; only un-export something genuinely unreferenced anywhere).

- [ ] **Step 5: Commit**

```bash
git add src/inference/net-flow.ts test/net-flow.test.ts
git commit -m "feat(devloop): netFlow (A) + netFlowTrend (B) + windowLever (S2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: CLI `net-flow` command + readout

**Files:**
- Modify: `src/cli.ts` (import; `showNetFlow` + `netFlowTable`; `case 'net-flow'`; usage strings)
- Test: `test/net-flow-cli.test.ts` (create — a thin render smoke that asserts the verdict line + honesty footer)

**Interfaces:**
- Consumes: `netFlow`, `netFlowTrend`, `NetFlow` from `./inference/net-flow.js`; `WhatIf` from `./inference/whatif.js`; existing `readEnvelopes`, `pct`, `fmtH` helpers in `cli.ts`.
- Produces: a `net-flow <owner/repo> [by=model | window [recentWeeks] [baselineWeeks]]` CLI command.

- [ ] **Step 1: Write the failing test** — `test/net-flow-cli.test.ts`. The render lives in `cli.ts` which runs commands on import; to keep the test pure, this task extracts the rendering into an exported pure `renderNetFlow(nf: NetFlow): string[]` in `net-flow.ts` and the test targets that. Write:

```ts
import { describe, it, expect } from 'vitest';
import { renderNetFlow, type NetFlow } from '../src/inference/net-flow.js';
import type { WhatIf } from '../src/inference/whatif.js';

const wi = (indicator: string): WhatIf => ({
  repo: 'r', indicator, by: 'model', unit: indicator === 'cycle-time' ? 'hours' : 'probability',
  higherIsBetter: false, strata: [
    { value: 'T', n: 6, point: 0.1, p10: 0.05, p90: 0.3, firstAt: '', lastAt: '' },
    { value: 'B', n: 6, point: 5, p10: 3, p90: 10, firstAt: '', lastAt: '' },
  ], conclusive: true, warnings: [],
});

describe('renderNetFlow', () => {
  it('renders the SPEED_FOR_CHURN verdict line and the honesty footer', () => {
    const nf: NetFlow = { repo: 'r', by: 'model', mode: 'counterfactual', treatmentArm: 'T', baselineArm: 'B', speed: 'down', churn: 'up', verdict: 'SPEED_FOR_CHURN', cycle: wi('cycle-time'), churnWhatIf: wi('short-term-churn'), warnings: [] };
    const out = renderNetFlow(nf).join('\n');
    expect(out).toMatch(/NOT A PASS — speed bought with churn/);
    expect(out).toMatch(/Goodhart/);
    expect(out).toMatch(/never a gate/i);
  });

  it('labels trend mode distinctly', () => {
    const nf: NetFlow = { repo: 'r', by: 'window', mode: 'trend', treatmentArm: 'recent', baselineArm: 'baseline', speed: 'down', churn: 'flat', verdict: 'PASS', cycle: wi('cycle-time'), churnWhatIf: wi('short-term-churn'), warnings: [] };
    const out = renderNetFlow(nf).join('\n');
    expect(out).toMatch(/TREND — time is the lever/);
    expect(out).toMatch(/✅ PASS/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/net-flow-cli.test.ts`
Expected: FAIL — `renderNetFlow` not exported.

- [ ] **Step 3: Implement.** Append `renderNetFlow` to `src/inference/net-flow.ts` (pure — returns lines; the CLI just prints them):

```ts
const pctOrH = (w: WhatIf, x: number): string => (w.unit === 'probability' ? `${(x * 100).toFixed(1)}%` : w.unit === 'count' ? x.toFixed(2) : `${x.toFixed(2)}h`);

function table(w: WhatIf): string[] {
  return [`   ${w.indicator}:`, ...w.strata.map((s) => `      ${s.value.padEnd(20)} ${String(s.n).padStart(3)} PRs   ${pctOrH(w, s.point).padStart(8)}  [${pctOrH(w, s.p10)} .. ${pctOrH(w, s.p90)}]`)];
}

/** Pure readout (lines) for a NetFlow result — the CLI prints these verbatim. */
export function renderNetFlow(nf: NetFlow): string[] {
  const header = nf.mode === 'trend'
    ? `NET FLOW — ${nf.repo} · recent vs baseline   (TREND — time is the lever; inherently time-confounded, monitoring only)`
    : `NET FLOW — ${nf.repo} · by ${nf.by}   (counterfactual, conditioned on the repo)`;
  const t = nf.treatmentArm ?? '?', b = nf.baselineArm ?? '?';
  const verdict =
    nf.verdict === 'PASS' ? `✅ PASS — net flow improved: '${t}' is meaningfully faster AND churn flat-or-down vs '${b}'.`
    : nf.verdict === 'SPEED_FOR_CHURN' ? `❌ NOT A PASS — speed bought with churn: '${t}' is faster BUT churns meaningfully more than '${b}'. A regression masquerading as improvement.`
    : nf.verdict === 'NO_SPEED_GAIN' ? `⚪ NO PASS — no speed gain: '${t}' is not meaningfully faster than '${b}' ('speed alone is not a pass')${nf.churn === 'up' ? ', and churn rose — a regression.' : '.'}`
    : `⚠ INCONCLUSIVE — see warnings.`;
  return [
    header, '',
    ...table(nf.cycle),
    ...table(nf.churnWhatIf),
    '',
    `   ${verdict}`,
    ...nf.warnings.map((w) => `   ⚠ ${w}`),
    '',
    "   TREND/WARN — never a gate. Observational ≠ causal (a decision aid). Never optimize the metric (Goodhart):",
    "   score predictions, don't chase the number — a same-session autonomous merge has cycle-time ≈ 0.005–0.01h",
    '   (an attribution artifact, not a real speed-up).',
  ];
}
```

Then wire `src/cli.ts`. Add the import near the other inference imports:

```ts
import { netFlow, netFlowTrend, renderNetFlow } from './inference/net-flow.js';
```

Add the dispatcher function near `showWhatIf`:

```ts
function showNetFlow(repo: string, arg2: string | undefined, a3: string | undefined, a4: string | undefined): void {
  if (!repo) { console.log('usage: net-flow <owner/repo> [by=model | window [recentWeeks] [baselineWeeks]]'); return; }
  const events = readEnvelopes();
  const nf = arg2 === 'window'
    ? netFlowTrend(events, { repo, now: new Date(), recentWeeks: a3 ? Number(a3) : 8, baselineWeeks: a4 ? Number(a4) : 8 })
    : netFlow(events, { repo, by: arg2 || 'model' });
  console.log(renderNetFlow(nf).join('\n'));
}
```

Add the case in the command switch (next to `case 'whatif':`):

```ts
  case 'net-flow': showNetFlow(rest[0] ?? '', rest[1], rest[2], rest[3]); break;
```

Add `net-flow` to the usage comment block at the top (the `// devloop whatif ...` neighbourhood) and to the `default:` usage string (insert `net-flow|` next to `whatif|`).

- [ ] **Step 4: Run the test + the full suite**

Run: `npx vitest run test/net-flow-cli.test.ts` → PASS.
Run: `npm run typecheck && npm run test` → all green.
Run: `npx knip` → clean (no new unused exports).
Smoke (optional, real log): `npm run dev -- net-flow de-braighter/devloop` and `npm run dev -- net-flow de-braighter/devloop window` — expect a readout (often INCONCLUSIVE on the live log, which is correct).

- [ ] **Step 5: Commit**

```bash
git add src/inference/net-flow.ts src/cli.ts test/net-flow-cli.test.ts
git commit -m "feat(devloop): net-flow CLI command + readout (S2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** §3 composition core → Task 2. §4.1 netFlow (A) → Task 3. §4.2 netFlowTrend (B) + windowLever → Task 3. §4.3 whatIf lever override → Task 1. §5 INCONCLUSIVE propagation → Tasks 2+3 (arm-missing, churn-lag, A-temporal-gate, >2-arm, A/B divergence). §6 CLI + readout + honesty footer → Task 4. §7 acids → Tasks 2+3+4. §8 scope (CFR out, no new event, 2-arm) → enforced by absence + the >2 guard. All covered.

**Placeholder scan:** none — every step has real code/commands.

**Type consistency:** `NetFlow`/`Direction`/`Verdict`/`ComposeOpts`/`ComposeResult` defined in Task 2, consumed identically in Tasks 3+4. `whatIf`'s `lever?` (Task 1) matches `netFlowTrend`'s call (Task 3). `WhatIfStratum` fields (`value,n,point,p10,p90,firstAt,lastAt`) match the synthetic fixtures. `renderNetFlow` returns `string[]`, consumed via `.join('\n')` in both the CLI and the test.
