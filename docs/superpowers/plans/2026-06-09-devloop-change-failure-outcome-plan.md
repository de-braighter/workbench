# Change-Failure (Rework) Outcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a change-failure (rework) outcome to the cross-repo study — the **risk** metric the AI Delivery Audit needs — measuring whether a practice/rollout increased the rate of corrective work (reverts + fix-follows), placebo-controlled and diff-in-diff'd.

**Architecture:** Change-failure is a **rate** (fraction of merges that are corrective), not a per-PR median — so it gets a parallel rate-based analysis mirroring the windowing/placebo/DiD *structure* of `studyRepo`, not `studyRepo` itself. Detection (reverts by title; fix-follows = a corrective PR referencing a PR merged within the prior 30 days) runs **at ingest** (where PR bodies are available) and rides on `PrMerged` as an optional `corrective` boolean — so bodies are never stored.

**Tech Stack:** TypeScript (ESM, `.js` extensions), vitest. Tests in `test/`.

**Working directory:** `D:/development/projects/de-braighter/domains/devloop`. **Branch off `main`** (has the merged study + diff-in-diff #58–#62):

```bash
cd D:/development/projects/de-braighter/domains/devloop
git checkout main && git pull --ff-only
git checkout -b feat/intel-change-failure
```

**Spec/positioning:** `docs/superpowers/specs/2026-06-09-devloop-ai-delivery-audit-positioning.md` §3/§7. The revert signal was empirically validated (~0.7–1.5%, real + varying). **Governance:** public-repo data only; the human runs the real scan.

---

## File Structure

- `src/intel/change-failure.ts` — **create** (Task 1, 3): detection (`isRevert`, `isFixFollow`, `flagCorrective`) + rate analysis (`changeFailureRepo`, `poolChangeFailure`, `changeFailureDiD`).
- `src/events.ts` — **modify** (Task 2): add optional `corrective` to the `PrMerged` schema.
- `src/intel/ingest-window.ts` — **modify** (Task 2): capture PR `title`+`body`, flag correctives, emit `corrective` on `PrMerged`.
- `src/intel/pr-outcomes.ts` — **modify** (Task 3): add `corrective` to `PrOutcome`.
- `src/intel/render-study.ts` — **modify** (Task 4): a change-failure section.
- `src/cli.ts` — **modify** (Task 4): compute change-failure for treatment + control, render it.
- Tests: `test/change-failure.test.ts` (Tasks 1, 3), extend `test/pr-outcomes.test.ts` (Task 3).

---

## Task 1: Change-failure detection (pure)

**Files:** Create `src/intel/change-failure.ts`; create `test/change-failure.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/change-failure.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isRevert, isFixFollow, flagCorrective, type PrMeta } from '../src/intel/change-failure.js';

const DAY = 86_400_000;
const pr = (over: Partial<PrMeta> & { number: number }): PrMeta => ({
  number: over.number, title: over.title ?? '', body: over.body ?? '',
  createdAtMs: over.createdAtMs ?? 0, mergedAtMs: over.mergedAtMs ?? 0,
});

describe('isRevert', () => {
  it('matches Revert-titled PRs only', () => {
    expect(isRevert('Revert "feat: x" (#812)')).toBe(true);
    expect(isRevert('revert: drop the cache')).toBe(true);
    expect(isRevert('feat: add caching')).toBe(false);
    expect(isRevert('we should revert this someday')).toBe(false); // not at start
  });
});

describe('isFixFollow', () => {
  // merged-PR index: #10 merged at day 100, #20 merged at day 5
  const merged = new Map<number, number>([[10, 100 * DAY], [20, 5 * DAY]]);
  it('flags a corrective PR referencing a PR merged within the prior 30 days', () => {
    const p = pr({ number: 11, title: 'fix: regression from #10', createdAtMs: 110 * DAY });
    expect(isFixFollow(p, merged)).toBe(true); // #10 merged 10d before
  });
  it('rejects when the referenced PR merged too long ago', () => {
    const p = pr({ number: 21, title: 'fix: late fix', body: 'addresses #20', createdAtMs: 110 * DAY });
    expect(isFixFollow(p, merged)).toBe(false); // #20 merged 105d before
  });
  it('rejects when there is no corrective keyword', () => {
    const p = pr({ number: 12, title: 'feat: builds on #10', createdAtMs: 110 * DAY });
    expect(isFixFollow(p, merged)).toBe(false);
  });
  it('ignores a self-reference and unknown PR numbers', () => {
    expect(isFixFollow(pr({ number: 10, title: 'fix #10', createdAtMs: 110 * DAY }), merged)).toBe(false);
    expect(isFixFollow(pr({ number: 30, title: 'fix #999', createdAtMs: 110 * DAY }), merged)).toBe(false);
  });
});

describe('flagCorrective', () => {
  it('returns the set of corrective PR numbers (reverts ∪ fix-follows)', () => {
    const prs: PrMeta[] = [
      pr({ number: 1, title: 'feat: a', mergedAtMs: 10 * DAY, createdAtMs: 9 * DAY }),
      pr({ number: 2, title: 'Revert "feat: a" (#1)', mergedAtMs: 11 * DAY, createdAtMs: 10 * DAY }),
      pr({ number: 3, title: 'fix: regression in #1', mergedAtMs: 12 * DAY, createdAtMs: 11 * DAY }),
      pr({ number: 4, title: 'docs: tidy', mergedAtMs: 13 * DAY, createdAtMs: 12 * DAY }),
    ];
    expect([...flagCorrective(prs)].sort((a, b) => a - b)).toEqual([2, 3]);
  });
});
```

- [ ] **Step 2: Run — verify it fails**: `npx vitest run test/change-failure.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/intel/change-failure.ts`:

```typescript
// Change-failure detection from PR metadata — the "did it increase breakage?" risk signal.
// Two corrective signals: REVERTS (title starts with "Revert", the clean validated subset) and
// FIX-FOLLOWS (a corrective PR — fix/hotfix/regression/revert in title or body — that references
// a `#N` merged within the prior 30 days, i.e. it fixes a RECENT change, not a generic old bug).
// Runs at ingest where bodies are available; only a boolean flag is persisted. Pure.

export interface PrMeta {
  number: number;
  title: string;
  body: string;
  createdAtMs: number;
  mergedAtMs: number;
}

const REVERT_RE = /^\s*revert[\s":]/i; // "Revert \"...\"", "revert: ..."
const CORRECTIVE_RE = /\b(fix|fixes|fixed|hotfix|regression|revert)\b/i;
const FIX_FOLLOW_WINDOW_MS = 30 * 86_400_000; // references a PR merged within the prior 30 days

/** A revert PR — title starts with "Revert". The cleanest change-failure signal. */
export function isRevert(title: string): boolean {
  return REVERT_RE.test(title ?? '');
}

/** A fix-follow — a corrective PR that references a `#N` merged within the prior 30 days
 *  (fixes a RECENT change). `mergedAtByNumber` maps known merged PR# → mergedAtMs. */
export function isFixFollow(p: PrMeta, mergedAtByNumber: Map<number, number>): boolean {
  const text = `${p.title ?? ''}\n${p.body ?? ''}`;
  if (!CORRECTIVE_RE.test(text)) return false;
  for (const m of text.matchAll(/#(\d+)/g)) {
    const n = Number(m[1]);
    if (n === p.number) continue;
    const targetMs = mergedAtByNumber.get(n);
    if (targetMs === undefined) continue;
    if (targetMs <= p.createdAtMs && targetMs >= p.createdAtMs - FIX_FOLLOW_WINDOW_MS) return true;
  }
  return false;
}

/** PR numbers in `prs` that are change-failures (revert ∪ fix-follow). Pure. */
export function flagCorrective(prs: PrMeta[]): Set<number> {
  const mergedAtByNumber = new Map<number, number>();
  for (const p of prs) mergedAtByNumber.set(p.number, p.mergedAtMs);
  const out = new Set<number>();
  for (const p of prs) {
    if (isRevert(p.title) || isFixFollow(p, mergedAtByNumber)) out.add(p.number);
  }
  return out;
}
```

- [ ] **Step 4: Run — verify it passes**: `npx vitest run test/change-failure.test.ts` → PASS.
- [ ] **Step 5: Full suite**: `npx vitest run` → green.
- [ ] **Step 6: Commit**:

```bash
git add src/intel/change-failure.ts test/change-failure.test.ts
git commit -m "feat(intel): change-failure detection — reverts + recency-bounded fix-follows

isRevert (title) + isFixFollow (corrective PR referencing a #N merged within 30d) + flagCorrective.
The risk-outcome numerator for the AI Delivery Audit. Pure."
```

---

## Task 2: Capture title+body at ingest, flag + persist `corrective`

**Files:** Modify `src/events.ts`; modify `src/intel/ingest-window.ts`.

- [ ] **Step 1: Add `corrective` to the `PrMerged` schema.** In `src/events.ts`, find:
```typescript
const PrMerged = z.object({ repo: z.string(), pr: z.number().int(), title: z.string(), cycleHours: z.number().nonnegative() });
```
Replace with:
```typescript
const PrMerged = z.object({ repo: z.string(), pr: z.number().int(), title: z.string(), cycleHours: z.number().nonnegative(), corrective: z.boolean().optional() });
```
(Optional → backward-compatible with existing logs.)

- [ ] **Step 2: Capture title+body, flag correctives, emit them.** In `src/intel/ingest-window.ts`:

(a) Import the detector + the PrMeta type at the top (after the existing imports):
```typescript
import { flagCorrective, type PrMeta } from './change-failure.js';
```

(b) Extend the gh JSON fields + the row interface. Find:
```typescript
interface GhPrWindow {
  number: number;
  createdAt: string;
  mergedAt: string;
  reviews?: { submittedAt?: string }[];
}
```
Replace with:
```typescript
interface GhPrWindow {
  number: number;
  title?: string;
  body?: string;
  createdAt: string;
  mergedAt: string;
  reviews?: { submittedAt?: string }[];
}
```

(c) Rewrite the body of `ingestWindowed` (the part after `windowDates`) to a two-pass: parse + filter to positive-cycle PRs, flag correctives over that set, then emit. Find:
```typescript
  let raw: string;
  try {
    raw = execSync(
      `gh pr list --repo ${repo} --state merged --search "created:${from}..${to}" --limit 600 --json number,createdAt,mergedAt,reviews`,
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return 0;
  }
  let n = 0;
  for (const p of JSON.parse(raw) as GhPrWindow[]) {
    const cycleHours = (Date.parse(p.mergedAt) - Date.parse(p.createdAt)) / 3.6e6;
    if (!(cycleHours > 0)) continue;
    append(prOpened({ repo, pr: p.number, title: '', ts: p.createdAt }));
    n++;
    append(prMerged({ repo, pr: p.number, title: '', cycleHours, ts: p.mergedAt }));
    n++;
    const firstReview = earliestIso((p.reviews ?? []).map((r) => r.submittedAt));
    if (firstReview) {
      append(verdict({ repo, pr: p.number, verifier: 'reviewer', verdict: 'PASS', ts: firstReview }));
      n++;
    }
  }
  return n;
```
Replace with:
```typescript
  let raw: string;
  try {
    raw = execSync(
      `gh pr list --repo ${repo} --state merged --search "created:${from}..${to}" --limit 600 --json number,title,body,createdAt,mergedAt,reviews`,
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  } catch {
    return 0;
  }
  const rows = (JSON.parse(raw) as GhPrWindow[]).filter(
    (p) => (Date.parse(p.mergedAt) - Date.parse(p.createdAt)) / 3.6e6 > 0,
  );
  // Flag change-failures over the whole window (fix-follow recency needs the full set).
  const meta: PrMeta[] = rows.map((p) => ({
    number: p.number,
    title: p.title ?? '',
    body: p.body ?? '',
    createdAtMs: Date.parse(p.createdAt),
    mergedAtMs: Date.parse(p.mergedAt),
  }));
  const corrective = flagCorrective(meta);
  let n = 0;
  for (const p of rows) {
    const cycleHours = (Date.parse(p.mergedAt) - Date.parse(p.createdAt)) / 3.6e6;
    append(prOpened({ repo, pr: p.number, title: p.title ?? '', ts: p.createdAt }));
    n++;
    append(prMerged({ repo, pr: p.number, title: p.title ?? '', cycleHours, corrective: corrective.has(p.number), ts: p.mergedAt }));
    n++;
    const firstReview = earliestIso((p.reviews ?? []).map((r) => r.submittedAt));
    if (firstReview) {
      append(verdict({ repo, pr: p.number, verifier: 'reviewer', verdict: 'PASS', ts: firstReview }));
      n++;
    }
  }
  return n;
```

- [ ] **Step 3: Verify (no unit test — ingest is coverage-excluded glue):**
```bash
npx tsc -p tsconfig.json --noEmit
npx vitest run
```
Expected: typecheck clean (the `prMerged` constructor accepts `corrective` via the schema); suite green.

- [ ] **Step 4: Commit:**
```bash
git add src/events.ts src/intel/ingest-window.ts
git commit -m "feat(intel): capture PR title+body at ingest, flag + persist corrective on PrMerged

Detects reverts + fix-follows over each repo's window (bodies used transiently, not stored);
PrMerged gains an optional corrective boolean."
```

---

## Task 3: Change-failure rate analysis (pure)

**Files:** Modify `src/intel/pr-outcomes.ts`; modify `src/intel/change-failure.ts`; extend `test/change-failure.test.ts` + `test/pr-outcomes.test.ts`.

- [ ] **Step 1: Add `corrective` to `PrOutcome`.** In `src/intel/pr-outcomes.ts`:

(a) Find the interface:
```typescript
export interface PrOutcome {
  pr: number;
  openedAtMs: number;
  cycleHours: number;
  firstReviewHrs?: number; // earliest review occurredAt − openedAt, if the PR was reviewed
}
```
Replace with:
```typescript
export interface PrOutcome {
  pr: number;
  openedAtMs: number;
  cycleHours: number;
  corrective: boolean; // PrMerged.corrective — was this a revert/fix-follow (change-failure)
  firstReviewHrs?: number; // earliest review occurredAt − openedAt, if the PR was reviewed
}
```

(b) Set it when building the record. Find:
```typescript
    const rec: PrOutcome = { pr: p.pr, openedAtMs: opened, cycleHours: p.cycleHours };
```
Replace with:
```typescript
    const rec: PrOutcome = { pr: p.pr, openedAtMs: opened, cycleHours: p.cycleHours, corrective: p.corrective === true };
```
(Note: `PrMergedPayload` already has `corrective?: boolean` from Task 2's schema change, so `p.corrective` typechecks.)

- [ ] **Step 2: Extend the pr-outcomes test.** In `test/pr-outcomes.test.ts`, the first test builds `events` with `prMerged(...)`. Add one corrective PR and assert the flag flows through. Append inside the existing `describe('prOutcomes', ...)`:
```typescript
  it('carries the corrective flag from PrMerged', () => {
    const events = [
      prOpened({ repo, pr: 1, title: 'x', ts: '2026-01-01T00:00:00Z' }),
      prMerged({ repo, pr: 1, title: 'x', cycleHours: 5, corrective: true, ts: '2026-01-01T05:00:00Z' }),
      prOpened({ repo, pr: 2, title: 'y', ts: '2026-01-02T00:00:00Z' }),
      prMerged({ repo, pr: 2, title: 'y', cycleHours: 5, ts: '2026-01-02T05:00:00Z' }),
    ];
    const out = prOutcomes(events, repo);
    expect(out.find((o) => o.pr === 1)!.corrective).toBe(true);
    expect(out.find((o) => o.pr === 2)!.corrective).toBe(false); // default when absent
  });
```

- [ ] **Step 3: Write the failing rate-analysis test.** Append to `test/change-failure.test.ts`:
```typescript
import { changeFailureRepo, poolChangeFailure, changeFailureDiD, type ChangeFailureStudy } from '../src/intel/change-failure.js';

const o = (openedAtMs: number, corrective: boolean) => ({ openedAtMs, corrective });

describe('changeFailureRepo', () => {
  it('computes placebo-controlled net change-failure RATE with count-based windows (k=2)', () => {
    // placebo-pre 0/2=0, before 0/2=0, after 2/2=1.0 (corrective)
    const outcomes = [o(1000, false), o(2000, false), o(3000, false), o(4000, false), o(6000, true), o(7000, true)];
    const s = changeFailureRepo(outcomes, 5000, 2);
    expect(s.qualified).toBe(true);
    expect(s.beforeRate).toBe(0);
    expect(s.afterRate).toBe(1);
    expect(s.placeboRate).toBe(0);
    expect(s.netRateEffect).toBe(1); // (1−0) − (0−0)
  });
  it('excludes a repo without enough PRs around the event', () => {
    const s = changeFailureRepo([o(1000, false), o(6000, true)], 5000, 2);
    expect(s.qualified).toBe(false);
  });
});

describe('poolChangeFailure / changeFailureDiD', () => {
  const mk = (repo: string, net: number): ChangeFailureStudy => ({ repo, qualified: true, beforeRate: 0, afterRate: net, placeboRate: 0, netRateEffect: net });
  it('pools net rate-effects and computes treatment − control diff-in-diff', () => {
    const pooled = poolChangeFailure([mk('a', 0.1), mk('b', 0.3)]);
    expect(pooled.n).toBe(2);
    expect(pooled.medianNetRate).toBeCloseTo(0.2, 6);
    const did = changeFailureDiD([mk('a', 0.2)], [mk('c', 0.05)]);
    expect(did.treatmentMedian).toBeCloseTo(0.2, 6);
    expect(did.controlMedian).toBeCloseTo(0.05, 6);
    expect(did.diffInDiff).toBeCloseTo(0.15, 6);
  });
});
```

- [ ] **Step 4: Run — verify it fails**: `npx vitest run test/change-failure.test.ts` → FAIL (functions not exported).

- [ ] **Step 5: Implement** — append to `src/intel/change-failure.ts`:
```typescript
// --- rate-based analysis (change-failure is a RATE, not a median; mirrors studyRepo's
// count-based windows + placebo, but computes correctives/window). ---

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export interface ChangeFailureStudy {
  repo: string;
  qualified: boolean;
  reason?: string;
  beforeRate: number;
  afterRate: number;
  placeboRate: number;
  netRateEffect: number; // (after−before) − (before−placebo); positive = MORE breakage after
}

interface CFOutcome { openedAtMs: number; corrective: boolean }

/** Placebo-controlled change-failure RATE for one repo around an event, count-based windows. */
export function changeFailureRepo(outcomes: CFOutcome[], eventMs: number, k = 20): ChangeFailureStudy {
  const sorted = [...outcomes].sort((a, b) => a.openedAtMs - b.openedAtMs);
  const before = sorted.filter((o) => o.openedAtMs < eventMs);
  const after = sorted.filter((o) => o.openedAtMs >= eventMs);
  if (after.length < k || before.length < 2 * k) {
    return { repo: '', qualified: false, reason: `need >=${k} after and >=${2 * k} before (got ${after.length}/${before.length})`, beforeRate: 0, afterRate: 0, placeboRate: 0, netRateEffect: 0 };
  }
  const rate = (w: CFOutcome[]) => w.filter((o) => o.corrective).length / w.length;
  const afterRate = rate(after.slice(0, k));
  const beforeRate = rate(before.slice(before.length - k));
  const placeboRate = rate(before.slice(before.length - 2 * k, before.length - k));
  return { repo: '', qualified: true, beforeRate, afterRate, placeboRate, netRateEffect: (afterRate - beforeRate) - (beforeRate - placeboRate) };
}

export interface PooledChangeFailure { n: number; medianNetRate: number; p10: number; p90: number; pctWorse: number }

export function poolChangeFailure(studies: ChangeFailureStudy[]): PooledChangeFailure {
  const nets = studies.filter((s) => s.qualified).map((s) => s.netRateEffect);
  const sorted = [...nets].sort((a, b) => a - b);
  const q = (frac: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * frac)))]! : NaN);
  return { n: nets.length, medianNetRate: median(nets), p10: q(0.1), p90: q(0.9), pctWorse: nets.length ? nets.filter((v) => v > 0).length / nets.length : NaN };
}

export interface ChangeFailureDiD { treatmentMedian: number; controlMedian: number; diffInDiff: number; nTreat: number; nControl: number }

export function changeFailureDiD(treatment: ChangeFailureStudy[], control: ChangeFailureStudy[]): ChangeFailureDiD {
  const nets = (studies: ChangeFailureStudy[]) => studies.filter((s) => s.qualified).map((s) => s.netRateEffect);
  const t = nets(treatment);
  const c = nets(control);
  const tMed = median(t);
  const cMed = c.length ? median(c) : NaN;
  return { treatmentMedian: tMed, controlMedian: cMed, diffInDiff: c.length ? tMed - cMed : NaN, nTreat: t.length, nControl: c.length };
}
```

(Note: `repo` is set by the caller via spread when it builds the study — see Task 4; `changeFailureRepo` leaves it `''` since it receives only outcomes. The caller does `{ ...changeFailureRepo(...), repo }`.)

- [ ] **Step 6: Run — verify it passes**: `npx vitest run test/change-failure.test.ts test/pr-outcomes.test.ts` → PASS.
- [ ] **Step 7: Full suite**: `npx vitest run` → green.
- [ ] **Step 8: Commit**:
```bash
git add src/intel/change-failure.ts src/intel/pr-outcomes.ts test/change-failure.test.ts test/pr-outcomes.test.ts
git commit -m "feat(intel): change-failure rate analysis — placebo-controlled net rate + pooling + DiD

Rate-based (correctives/window) mirror of the median study; PrOutcome carries the corrective flag."
```

---

## Task 4: Render + CLI wiring

`cli.ts` is coverage-excluded; verified by typecheck + suite. No data run by the implementer.

**Files:** Modify `src/intel/render-study.ts`; modify `src/cli.ts`.

- [ ] **Step 1: Render test** — append to `test/render-study.test.ts` (import the type):
```typescript
import type { PooledChangeFailure, ChangeFailureDiD } from '../src/intel/change-failure.js';

describe('renderStudyMarkdown — change-failure section', () => {
  const pooled = [{ outcome: 'cycleHours' as const, n: 35, medianNetEffect: 2.8, p10: -5, p90: 4, pctImproved: 0.37 }];
  const funnel = { practice: 'PR template', language: 'TypeScript', scanned: 200, withEvent: 126, qualified: 35 };
  const cf = { pooled: { n: 30, medianNetRate: 0.004, p10: -0.01, p90: 0.02, pctWorse: 0.55 } as PooledChangeFailure,
               did: { treatmentMedian: 0.004, controlMedian: 0.002, diffInDiff: 0.002, nTreat: 30, nControl: 12 } as ChangeFailureDiD };
  it('renders the change-failure (breakage) section when present', () => {
    const md = renderStudyMarkdown(pooled, funnel, [], cf);
    expect(md).toContain('Change failure');
    expect(md).toMatch(/revert|fix-follow|corrective|breakage/i);
    expect(md).toContain('nControl=12');
  });
  it('omits change-failure when not provided', () => {
    expect(renderStudyMarkdown(pooled, funnel)).not.toContain('Change failure');
  });
});
```

- [ ] **Step 2: Implement render.** In `src/intel/render-study.ts`:

(a) Add the import:
```typescript
import type { PooledChangeFailure, ChangeFailureDiD } from './change-failure.js';
```

(b) Add an optional 4th param. Find:
```typescript
export function renderStudyMarkdown(pooled: PooledOutcome[], funnel: StudyFunnel, dd: DiffInDiff[] = []): string {
```
Replace with:
```typescript
export function renderStudyMarkdown(
  pooled: PooledOutcome[],
  funnel: StudyFunnel,
  dd: DiffInDiff[] = [],
  cf?: { pooled: PooledChangeFailure; did: ChangeFailureDiD },
): string {
```

(c) Insert the change-failure section just before the final `lines.push('---');` footer:
```typescript
  if (cf && cf.pooled.n > 0) {
    const pct = (x: number) => `${(x * 100).toFixed(2)}%`;
    const dir = (x: number) => (Number.isNaN(x) ? 'n/a' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)} pp`);
    lines.push('## Change failure (breakage / rework)');
    lines.push('');
    lines.push('Rate of corrective PRs (reverts + fix-follows referencing a recent merge) — did the change increase breakage?');
    lines.push('');
    lines.push(`- Net change-failure rate after the event: **${dir(cf.pooled.medianNetRate)}** (median; **${pct(cf.pooled.pctWorse)}** of repos got worse; n=${cf.pooled.n}).`);
    lines.push(`- Net of cohort drift (diff-in-diff): **${dir(cf.did.diffInDiff)}** (nTreat=${cf.did.nTreat}, nControl=${cf.did.nControl}).`);
    lines.push('');
    lines.push('_Change-failure = title-detected reverts + fix-follows (a corrective PR referencing a PR merged within 30 days). A lower bound; low base rate (~1%) means it needs volume to be conclusive._');
    lines.push('');
  }
  lines.push('---');
```
(IMPORTANT: insert immediately before the EXISTING `lines.push('---');` — do not duplicate the footer.)

- [ ] **Step 3: Wire the CLI.** In `src/cli.ts` `intel-study` case:

(a) Extend the change-failure import. Add near the other `./intel/` imports:
```typescript
import { changeFailureRepo, poolChangeFailure, changeFailureDiD } from './intel/change-failure.js';
```

(b) After the existing `const dd = diffInDiff(studies, controlStudies);` line, add the change-failure computation (reuses `prOutcomes` records which now carry `corrective`):
```typescript
    const cfRepo = (repo: string, evMs: number) => ({ ...changeFailureRepo(prOutcomes(events, repo), evMs, 20), repo });
    const cfTreatment = [...adopted.entries()].map(([repo, evMs]) => cfRepo(repo, evMs));
    const cfControl = pseudo.map(({ repo, pseudoEventMs }) => cfRepo(repo, pseudoEventMs));
    const cf = { pooled: poolChangeFailure(cfTreatment), did: changeFailureDiD(cfTreatment, cfControl) };
```
(`prOutcomes` returns `PrOutcome[]` with `openedAtMs` + `corrective`, which `changeFailureRepo`'s `CFOutcome[]` structurally accepts.)

(c) Pass `cf` to the renderer. Find:
```typescript
    writeFileSync(out, renderStudyMarkdown(pooled, funnel, dd));
```
Replace with:
```typescript
    writeFileSync(out, renderStudyMarkdown(pooled, funnel, dd, cf));
```

- [ ] **Step 4: Verify (typecheck + suite ONLY — no data run):**
```bash
npx tsc -p tsconfig.json --noEmit
npx vitest run
```
Expected: typecheck clean; suite all green.

- [ ] **Step 5: Commit:**
```bash
git add src/intel/render-study.ts src/cli.ts
git commit -m "feat(intel): render change-failure section + wire into intel-study

Reports net change-failure rate (reverts + fix-follows) + diff-in-diff vs the control cohort —
the AI Delivery Audit's risk outcome."
```

---

## Final verification + run

- [ ] `npx vitest run && npx tsc -p tsconfig.json --noEmit` → green/clean. PR in `domains/devloop` (body: `Producer:`/`Effect:` lines).
- [ ] **The run (human, public data):** `DEVLOOP_LOG=data/intel-pr-template-ts.jsonl npx tsx src/cli.ts intel-study typescript 200` → the finding now includes the **change-failure (breakage) outcome** alongside speed.

---

## Self-Review

**1. Spec coverage:** §3 risk outcome → change-failure rate (Tasks 1–4). §7 reverts (`isRevert`) + fix-follows (`isFixFollow`, recency-bounded) → Task 1. Rate-not-median (positioning's design note) → Task 3 (`changeFailureRepo` rate windows). Diff-in-diff (cohort control) → `changeFailureDiD` (Task 3) + CLI control studies (Task 4). Render → Task 4. Lower-bound + low-base-rate caveat → rendered footer (Task 4).

**2. Placeholder scan:** No TBD/TODO; complete code throughout. The `repo: ''`-then-spread pattern in `changeFailureRepo` is explained inline (Task 3 note + Task 4 `cfRepo` spread).

**3. Type consistency:** `PrMeta` (Task 1) consumed by `flagCorrective` (Task 1) + ingest (Task 2). `PrMerged.corrective` (Task 2) → `PrOutcome.corrective` (Task 3) → `changeFailureRepo`'s `CFOutcome` (structural: `{openedAtMs, corrective}` — `PrOutcome` is assignable). `ChangeFailureStudy`/`PooledChangeFailure`/`ChangeFailureDiD` (Task 3) consumed by render + CLI (Task 4) with matching fields. No MC — deterministic tests. The `changeFailureRepo` returns `repo:''` and the CLI sets it via spread (`{...changeFailureRepo(...), repo}`) — consistent in Task 3 note + Task 4 code.

---

## After this

The AI Delivery Audit's risk metric is real + reusable. Remaining = the GTM gate (validate the AI-ROI/quality fear with a real prospect — founder's, not code) + optional larger scan for power on the low-base-rate change-failure signal.
