# Cross-Repo Delivery Intelligence — PR-Template Adoption Study Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a within-repo natural-experiment study that measures whether adopting a PR template changes first-review latency and cycle-time, pooled across ~150 public TypeScript repos, placebo-controlled.

**Architecture:** New `src/intel/` modules compose existing devloop primitives. Four pure, TDD'd modules do the analysis (`pr-outcomes`, `adoption-study`, `render-study`, the `detect-adoption` parser); thin gh-calling glue (`source-repos`, `detect-adoption` fetch, a CLI orchestrator) reuses the existing `backfill` + `harvestPrReviews` ingest and the `DEVLOOP_LOG` isolation knob. Public data → results are committable.

**Tech Stack:** TypeScript (ESM, `.js` import extensions), vitest. Tests in `test/`; event fixtures via the typed constructors in `src/events.ts`.

**Working directory for ALL tasks:** `D:/development/projects/de-braighter/domains/devloop`. **Before Task 1, create a feature branch off `main`** (which has Plan 1 + Plan 2 merged):

```bash
cd D:/development/projects/de-braighter/domains/devloop
git checkout main && git pull --ff-only
git checkout -b feat/intel-pr-template-adoption-study
```

**Spec:** `docs/superpowers/specs/2026-06-08-devloop-cross-repo-delivery-intelligence-design.md` (branch `docs/devloop-cross-repo-intelligence-spec`). Read it first.

**⚠️ Governance:** all tests use synthetic fixtures. No subagent runs the study against real repos — the real run (public data, committable) is a human/controller step. (Public repos only; no private/employer data anywhere in this plan.)

---

## File Structure

- `src/intel/pr-outcomes.ts` — **create** (Task 1): `prOutcomes(events, repo)` → per-PR `{pr, openedAtMs, cycleHours, firstReviewHrs?}` from the event log. Pure.
- `src/intel/adoption-study.ts` — **create** (Task 2): `studyRepo(input, k, minWithOutcome)` (count-based windows + placebo netEffect + gate) and `poolStudies(studies)`. Pure. **The heart.**
- `src/intel/render-study.ts` — **create** (Task 3): `renderStudyMarkdown(pooled, funnel)`. Pure.
- `src/intel/detect-adoption.ts` — **create** (Task 4): pure `earliestIso(dates)` + thin `detectAdoption(repo)` (gh). Parser TDD'd.
- `src/intel/source-repos.ts` — **create** (Task 5): thin `sourceRepos(language, limit)` (gh search) + snapshot. Glue.
- `src/cli.ts` — **modify** (Task 6): `intel-study` orchestration command. Coverage-excluded glue.
- Tests: `test/pr-outcomes.test.ts`, `test/adoption-study.test.ts`, `test/render-study.test.ts`, `test/detect-adoption.test.ts`.

---

## Task 1: Per-PR outcomes from the event log

Extract, per repo, the per-PR records the study needs: open time, cycle-time, and (when reviewed) time-to-first-review. Mirrors the joins `stage-decomposition.ts` does, but per-PR (not aggregated).

**Files:** Create `src/intel/pr-outcomes.ts`; create `test/pr-outcomes.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/pr-outcomes.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { prOpened, prMerged, verdict } from '../src/events.js';
import { prOutcomes } from '../src/intel/pr-outcomes.js';

const repo = 'org/r';

describe('prOutcomes', () => {
  it('joins open/merge/first-review per PR, sorted by open time', () => {
    const events = [
      prOpened({ repo, pr: 2, title: 'b', ts: '2026-01-02T00:00:00Z' }),
      prMerged({ repo, pr: 2, title: 'b', cycleHours: 9, ts: '2026-01-02T09:00:00Z' }),
      prOpened({ repo, pr: 1, title: 'a', ts: '2026-01-01T00:00:00Z' }),
      verdict({ repo, pr: 1, verifier: 'human', verdict: 'PASS', ts: '2026-01-01T03:00:00Z' }),
      verdict({ repo, pr: 1, verifier: 'copilot', verdict: 'PASS', ts: '2026-01-01T05:00:00Z' }),
      prMerged({ repo, pr: 1, title: 'a', cycleHours: 8, ts: '2026-01-01T08:00:00Z' }),
    ];
    const out = prOutcomes(events, repo);
    expect(out.map((o) => o.pr)).toEqual([1, 2]); // sorted by openedAtMs
    expect(out[0]).toMatchObject({ pr: 1, cycleHours: 8, firstReviewHrs: 3 }); // earliest review at +3h
    expect(out[1]).toMatchObject({ pr: 2, cycleHours: 9 });
    expect(out[1]!.firstReviewHrs).toBeUndefined(); // PR 2 had no review
  });

  it('ignores other repos and PRs with no positive cycle time', () => {
    const events = [
      prOpened({ repo, pr: 1, title: 'a', ts: '2026-01-01T00:00:00Z' }),
      prMerged({ repo, pr: 1, title: 'a', cycleHours: 5, ts: '2026-01-01T05:00:00Z' }),
      prOpened({ repo: 'org/other', pr: 9, title: 'x', ts: '2026-01-01T00:00:00Z' }),
      prMerged({ repo: 'org/other', pr: 9, title: 'x', cycleHours: 5, ts: '2026-01-01T05:00:00Z' }),
    ];
    expect(prOutcomes(events, repo).map((o) => o.pr)).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run — verify it fails**: `npx vitest run test/pr-outcomes.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/intel/pr-outcomes.ts`:

```typescript
// Per-PR outcome records for one repo, derived from the event log — the raw material for
// the adoption study. Joins PrOpened (open time), PrMerged (cycle-time), and the earliest
// VerdictRecorded (first-review time). Pure; sorted by open time.
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { ofType } from '../log.js';
import { EVENT, type PrOpenedPayload, type PrMergedPayload, type VerdictPayload } from '../events.js';

const HOUR_MS = 3.6e6;

export interface PrOutcome {
  pr: number;
  openedAtMs: number;
  cycleHours: number;
  firstReviewHrs?: number; // earliest review submittedAt − openedAt, if the PR was reviewed
}

export function prOutcomes(events: DomainEventEnvelope[], repo: string): PrOutcome[] {
  const openedAt = new Map<number, number>();
  for (const e of ofType(events, EVENT.PR_OPENED)) {
    const p = e.payload as unknown as PrOpenedPayload;
    if (p.repo === repo) openedAt.set(p.pr, Date.parse(e.occurredAt));
  }
  const firstReview = new Map<number, number>();
  for (const e of ofType(events, EVENT.VERDICT)) {
    const p = e.payload as unknown as VerdictPayload;
    if (p.repo !== repo || typeof p.pr !== 'number') continue;
    const t = Date.parse(e.occurredAt);
    const cur = firstReview.get(p.pr);
    if (cur === undefined || t < cur) firstReview.set(p.pr, t);
  }
  const out: PrOutcome[] = [];
  for (const e of ofType(events, EVENT.PR_MERGED)) {
    const p = e.payload as unknown as PrMergedPayload;
    if (p.repo !== repo || !(p.cycleHours > 0)) continue;
    const opened = openedAt.get(p.pr);
    if (opened === undefined || !Number.isFinite(opened)) continue;
    const rec: PrOutcome = { pr: p.pr, openedAtMs: opened, cycleHours: p.cycleHours };
    const fr = firstReview.get(p.pr);
    if (fr !== undefined && fr >= opened) rec.firstReviewHrs = (fr - opened) / HOUR_MS;
    out.push(rec);
  }
  return out.sort((a, b) => a.openedAtMs - b.openedAtMs);
}
```

- [ ] **Step 4: Run — verify it passes**: `npx vitest run test/pr-outcomes.test.ts` → PASS (2 tests).

- [ ] **Step 5: Full suite**: `npx vitest run` → all green.

- [ ] **Step 6: Commit**:

```bash
git add src/intel/pr-outcomes.ts test/pr-outcomes.test.ts
git commit -m "feat(intel): per-PR outcome records from the event log

Joins open/merge/first-review per PR for one repo — the raw material for the
within-repo adoption study."
```

---

## Task 2: The adoption study (count-based windows + placebo) — the heart

Per repo, split PRs into count-based windows around the adoption event, compute the placebo-controlled `netEffect` per outcome, gate on window sizes, and pool across repos. This is the analysis that determines credibility.

**Files:** Create `src/intel/adoption-study.ts`; create `test/adoption-study.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/adoption-study.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { studyRepo, poolStudies, type RepoStudy } from '../src/intel/adoption-study.js';
import type { PrOutcome } from '../src/intel/pr-outcomes.js';

const mk = (pr: number, openedAtMs: number, cycleHours: number): PrOutcome => ({ pr, openedAtMs, cycleHours });

describe('studyRepo', () => {
  it('computes placebo-controlled netEffect with count-based windows (k=2)', () => {
    // placebo-pre median 10, before median 8, after median 4 (cycleHours)
    const outcomes = [mk(1, 1000, 10), mk(2, 2000, 10), mk(3, 3000, 8), mk(4, 4000, 8), mk(5, 6000, 4), mk(6, 7000, 4)];
    const s = studyRepo({ repo: 'r', outcomes, adoptedAtMs: 5000 }, 2, 1);
    expect(s.qualified).toBe(true);
    const cyc = s.effects.find((e) => e.outcome === 'cycleHours')!;
    expect(cyc).toMatchObject({ before: 8, after: 4, placeboPre: 10, effect: -4, placebo: -2, netEffect: -2 });
    expect(s.effects.find((e) => e.outcome === 'firstReviewHrs')).toBeUndefined(); // none had first-review
  });

  it('excludes a repo without enough PRs around the event', () => {
    const outcomes = [mk(1, 1000, 5), mk(2, 6000, 5)];
    const s = studyRepo({ repo: 'r', outcomes, adoptedAtMs: 5000 }, 2, 1);
    expect(s.qualified).toBe(false);
    expect(s.reason).toMatch(/need/);
    expect(s.effects).toEqual([]);
  });
});

describe('poolStudies', () => {
  it('pools per-repo netEffects into median + pctImproved', () => {
    const studies: RepoStudy[] = [
      { repo: 'a', qualified: true, effects: [{ outcome: 'cycleHours', before: 8, after: 4, placeboPre: 10, effect: -4, placebo: -2, netEffect: -2 }] },
      { repo: 'b', qualified: true, effects: [{ outcome: 'cycleHours', before: 8, after: 9, placeboPre: 8, effect: 1, placebo: 0, netEffect: 1 }] },
    ];
    const pooled = poolStudies(studies);
    const cyc = pooled.find((p) => p.outcome === 'cycleHours')!;
    expect(cyc.n).toBe(2);
    expect(cyc.medianNetEffect).toBe(-0.5); // median(-2, 1)
    expect(cyc.pctImproved).toBe(0.5); // one of two < 0
  });
});
```

- [ ] **Step 2: Run — verify it fails**: `npx vitest run test/adoption-study.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/intel/adoption-study.ts`:

```typescript
// The within-repo natural experiment. For one repo, split PRs into count-based windows
// around the adoption event — after (K nearest after), before (K nearest before),
// placebo-pre (the K before those) — and compute, per outcome, the placebo-controlled
// netEffect = (after−before) − (before−placebo-pre): the change BEYOND the repo's own
// pre-existing trend (decision §2 of the design; NOT whatIf — this is the time-confounded
// comparison whatIf refuses, made credible by the placebo). Pure; medians (long-tail-robust).
import type { PrOutcome } from './pr-outcomes.js';

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export type OutcomeKey = 'firstReviewHrs' | 'cycleHours';
const OUTCOMES: OutcomeKey[] = ['firstReviewHrs', 'cycleHours'];

export interface OutcomeNetEffect {
  outcome: OutcomeKey;
  before: number; // median before-window
  after: number; // median after-window
  placeboPre: number; // median placebo-pre-window
  effect: number; // after − before
  placebo: number; // before − placeboPre
  netEffect: number; // effect − placebo  ← the claim (negative = improved; lower is better)
}

export interface RepoStudy {
  repo: string;
  qualified: boolean;
  reason?: string;
  effects: OutcomeNetEffect[];
}

export interface RepoStudyInput {
  repo: string;
  outcomes: PrOutcome[];
  adoptedAtMs: number;
}

export function studyRepo(input: RepoStudyInput, k = 20, minWithOutcome = 5): RepoStudy {
  const { repo, outcomes, adoptedAtMs } = input;
  const sorted = [...outcomes].sort((a, b) => a.openedAtMs - b.openedAtMs);
  const before = sorted.filter((o) => o.openedAtMs < adoptedAtMs);
  const after = sorted.filter((o) => o.openedAtMs >= adoptedAtMs);
  if (after.length < k || before.length < 2 * k) {
    return {
      repo,
      qualified: false,
      reason: `need >=${k} PRs after and >=${2 * k} before the event (got ${after.length} after, ${before.length} before)`,
      effects: [],
    };
  }
  const afterW = after.slice(0, k);
  const beforeW = before.slice(before.length - k);
  const placeboW = before.slice(before.length - 2 * k, before.length - k);
  const effects: OutcomeNetEffect[] = [];
  for (const outcome of OUTCOMES) {
    const vals = (w: PrOutcome[]) => w.map((o) => o[outcome]).filter((v): v is number => typeof v === 'number');
    const a = vals(afterW);
    const b = vals(beforeW);
    const p = vals(placeboW);
    if (a.length < minWithOutcome || b.length < minWithOutcome || p.length < minWithOutcome) continue;
    const mAfter = median(a);
    const mBefore = median(b);
    const mPlacebo = median(p);
    const effect = mAfter - mBefore;
    const placebo = mBefore - mPlacebo;
    effects.push({ outcome, before: mBefore, after: mAfter, placeboPre: mPlacebo, effect, placebo, netEffect: effect - placebo });
  }
  return { repo, qualified: true, effects };
}

export interface PooledOutcome {
  outcome: OutcomeKey;
  n: number;
  medianNetEffect: number;
  p10: number;
  p90: number;
  pctImproved: number; // fraction with netEffect < 0 (lower is better)
}

export function poolStudies(studies: RepoStudy[]): PooledOutcome[] {
  const out: PooledOutcome[] = [];
  for (const outcome of OUTCOMES) {
    const nets = studies
      .filter((s) => s.qualified)
      .flatMap((s) => s.effects.filter((e) => e.outcome === outcome).map((e) => e.netEffect));
    if (!nets.length) continue;
    const sorted = [...nets].sort((a, b) => a - b);
    const q = (frac: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * frac)))]!;
    out.push({
      outcome,
      n: nets.length,
      medianNetEffect: median(nets),
      p10: q(0.1),
      p90: q(0.9),
      pctImproved: nets.filter((v) => v < 0).length / nets.length,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run — verify it passes**: `npx vitest run test/adoption-study.test.ts` → PASS.

- [ ] **Step 5: Full suite**: `npx vitest run` → all green.

- [ ] **Step 6: Commit**:

```bash
git add src/intel/adoption-study.ts test/adoption-study.test.ts
git commit -m "feat(intel): placebo-controlled within-repo adoption study + pooling

Count-based before/after/placebo-pre windows; per-repo netEffect = the change beyond
the repo's own pre-trend; pooled into median + pctImproved. The credibility core."
```

---

## Task 3: Render the study finding

Turn the pooled result into a plain-language Markdown finding with the funnel and honest caveats.

**Files:** Create `src/intel/render-study.ts`; create `test/render-study.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/render-study.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderStudyMarkdown } from '../src/intel/render-study.js';
import type { PooledOutcome } from '../src/intel/adoption-study.js';

const pooled: PooledOutcome[] = [
  { outcome: 'firstReviewHrs', n: 40, medianNetEffect: -1.5, p10: -6, p90: 2, pctImproved: 0.65 },
  { outcome: 'cycleHours', n: 38, medianNetEffect: -0.4, p10: -5, p90: 4, pctImproved: 0.55 },
];
const funnel = { practice: 'PR template', language: 'TypeScript', scanned: 200, withEvent: 70, qualified: 40 };

describe('renderStudyMarkdown', () => {
  it('renders the funnel, per-outcome net effect, and caveats', () => {
    const md = renderStudyMarkdown(pooled, funnel);
    expect(md).toContain('PR template');
    expect(md).toContain('200'); // scanned
    expect(md).toContain('40'); // qualified n
    expect(md).toContain('first review'); // outcome label, plain language
    expect(md).toContain('65%'); // pctImproved
    expect(md).toContain('placebo'); // method honesty
    expect(md).toMatch(/not an? RCT|observational/i); // caveat
  });

  it('handles an empty result without crashing', () => {
    const md = renderStudyMarkdown([], { ...funnel, qualified: 0 });
    expect(md).toContain('No repos');
  });
});
```

- [ ] **Step 2: Run — verify it fails**: `npx vitest run test/render-study.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/intel/render-study.ts`:

```typescript
// Render the adoption study as a plain-language Markdown finding — for an engineering
// audience, honest about method and limits. Net effects are in hours; negative = the
// outcome got faster after adoption, beyond the repo's pre-trend.
import type { PooledOutcome, OutcomeKey } from './adoption-study.js';

export interface StudyFunnel {
  practice: string;
  language: string;
  scanned: number;
  withEvent: number;
  qualified: number;
}

const LABEL: Record<OutcomeKey, string> = {
  firstReviewHrs: 'time to first review',
  cycleHours: 'cycle time (open → merge)',
};

function signedHours(h: number): string {
  const mag = Math.abs(h) < 1 ? `${Math.round(Math.abs(h) * 60)} min` : `${Math.abs(h).toFixed(1)} h`;
  return h <= 0 ? `${mag} faster` : `${mag} slower`;
}

export function renderStudyMarkdown(pooled: PooledOutcome[], funnel: StudyFunnel): string {
  const lines: string[] = [];
  lines.push(`# Does adopting a ${funnel.practice} change delivery? (${funnel.language})`);
  lines.push('');
  lines.push(
    `Scanned **${funnel.scanned}** ${funnel.language} repos → **${funnel.withEvent}** adopted a ${funnel.practice} mid-history → ` +
      `**${funnel.qualified}** had enough PRs around the event to measure. Within-repo natural experiment, **placebo-controlled** ` +
      `(each repo's pre-adoption trend subtracted).`,
  );
  lines.push('');
  if (pooled.length === 0) {
    lines.push('_No repos qualified — too few mid-history adoptions with enough PRs around the event to measure._');
    lines.push('');
    return lines.join('\n');
  }
  lines.push('## Findings (median net effect, beyond pre-trend)');
  lines.push('');
  for (const o of pooled) {
    lines.push(
      `- **${LABEL[o.outcome]}:** ${signedHours(o.medianNetEffect)} after adoption ` +
        `(**${Math.round(o.pctImproved * 100)}%** of repos improved; 80% between ${signedHours(o.p10)} and ${signedHours(o.p90)}; n=${o.n}).`,
    );
  }
  lines.push('');
  lines.push('---');
  lines.push(
    '_Observational, placebo-controlled — **not a randomized trial**. Count-based windows; ' +
      'open-source cohort (may not generalize to private/enterprise teams); repos that adopt a template may differ systematically._',
  );
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run — verify it passes**: `npx vitest run test/render-study.test.ts` → PASS.

- [ ] **Step 5: Full suite**: `npx vitest run` → all green.

- [ ] **Step 6: Commit**:

```bash
git add src/intel/render-study.ts test/render-study.test.ts
git commit -m "feat(intel): render the adoption-study finding as plain-language markdown

Funnel + per-outcome net effect + honest caveats (observational, placebo-controlled,
OSS cohort)."
```

---

## Task 4: Adoption-event detection

Find when a repo adopted the PR template (the oldest commit touching any candidate template path). The pure date-picking is TDD'd; the gh fetch is thin glue.

**Files:** Create `src/intel/detect-adoption.ts`; create `test/detect-adoption.test.ts`.

- [ ] **Step 1: Write the failing test** — `test/detect-adoption.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { earliestIso } from '../src/intel/detect-adoption.js';

describe('earliestIso', () => {
  it('returns the earliest non-null ISO date', () => {
    expect(earliestIso(['2026-03-01T00:00:00Z', '2025-11-15T00:00:00Z', '2026-01-01T00:00:00Z'])).toBe('2025-11-15T00:00:00Z');
  });
  it('skips null/undefined and returns null when nothing valid', () => {
    expect(earliestIso([null, undefined, ''])).toBeNull();
    expect(earliestIso([null, '2026-02-02T00:00:00Z'])).toBe('2026-02-02T00:00:00Z');
  });
});
```

- [ ] **Step 2: Run — verify it fails**: `npx vitest run test/detect-adoption.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/intel/detect-adoption.ts`:

```typescript
// Detect when a repo adopted the PR template = the OLDEST commit touching any candidate
// template path (its creation; we treat the earliest add as the event). ISO-8601 strings
// compare lexicographically = chronologically, so "earliest" is a string min over non-null.
// `earliestIso` is pure + tested; `detectAdoption` is thin gh glue (coverage-excluded like
// the ingest layer). No explicit "mid-history" check is needed: a template added at repo
// creation leaves an empty before-window, so the study's window gate excludes it naturally.
import { execSync } from 'node:child_process';

const TEMPLATE_PATHS = [
  '.github/pull_request_template.md',
  '.github/PULL_REQUEST_TEMPLATE.md',
  'PULL_REQUEST_TEMPLATE.md',
  'docs/pull_request_template.md',
];

/** Earliest non-empty ISO date in the list, or null. */
export function earliestIso(dates: (string | null | undefined)[]): string | null {
  let earliest: string | null = null;
  for (const d of dates) {
    if (d && (earliest === null || d < earliest)) earliest = d;
  }
  return earliest;
}

/** Oldest commit date touching `repo` at `path`, or null. Thin gh wrapper. */
function oldestCommitDateForPath(repo: string, path: string): string | null {
  try {
    const raw = execSync(
      `gh api "repos/${repo}/commits?path=${encodeURIComponent(path)}&per_page=100" --paginate --jq ".[].commit.committer.date"`,
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    const dates = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    return earliestIso(dates);
  } catch {
    return null; // path absent / repo unreachable / rate-limited
  }
}

/** Adoption timestamp (ISO) for the PR template across candidate paths, or null if never adopted. */
export function detectAdoption(repo: string): string | null {
  return earliestIso(TEMPLATE_PATHS.map((p) => oldestCommitDateForPath(repo, p)));
}
```

- [ ] **Step 4: Run — verify it passes**: `npx vitest run test/detect-adoption.test.ts` → PASS.

- [ ] **Step 5: Full suite + typecheck**: `npx vitest run` → green; `npx tsc -p tsconfig.json --noEmit` → clean.

- [ ] **Step 6: Commit**:

```bash
git add src/intel/detect-adoption.ts test/detect-adoption.test.ts
git commit -m "feat(intel): PR-template adoption-event detection

Pure earliestIso date-picker (TDD'd) + thin gh wrapper finding the oldest commit on any
candidate template path. Mid-history filtering falls out of the study's window gate."
```

---

## Task 5: Repo sourcing (thin glue)

Source the candidate repo list and snapshot it for reproducibility. Thin gh wrapper; no unit test (coverage-excluded, same boundary as `src/ingest/`).

**Files:** Create `src/intel/source-repos.ts`.

- [ ] **Step 1: Implement** — `src/intel/source-repos.ts`:

```typescript
// Source candidate public repos for a study (top-by-stars in one language) and return the
// owner/repo list. Thin gh wrapper — public data, no auth-sensitive content. The caller
// snapshots the returned list to a file for reproducibility.
import { execSync } from 'node:child_process';

export function sourceRepos(language: string, limit = 200): string[] {
  const raw = execSync(
    `gh search repos --language ${language} --sort stars --order desc --limit ${limit} --json fullName --jq ".[].fullName"`,
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return raw.split('\n').map((s) => s.trim()).filter(Boolean);
}
```

- [ ] **Step 2: Verify it compiles**: `npx tsc -p tsconfig.json --noEmit` → clean. (No data call in CI; the real `sourceRepos` run is a human step.)

- [ ] **Step 3: Commit**:

```bash
git add src/intel/source-repos.ts
git commit -m "feat(intel): source top public repos by stars for a study (thin gh wrapper)"
```

---

## Task 6: `intel-study` CLI orchestration

Wire the stages into one command. Coverage-excluded glue (`cli.ts`); verified by typecheck + the unit suite. The real run is a human/controller step against public repos.

**Files:** Modify `src/cli.ts`.

- [ ] **Step 1: Add imports.** After the existing `audit` imports (near `import { renderAuditMarkdown } from './audit/render-markdown.js';`) add:

```typescript
import { sourceRepos } from './intel/source-repos.js';
import { detectAdoption } from './intel/detect-adoption.js';
import { prOutcomes } from './intel/pr-outcomes.js';
import { studyRepo, poolStudies, type RepoStudy } from './intel/adoption-study.js';
import { renderStudyMarkdown } from './intel/render-study.js';
import { backfill } from './ingest/github.js';
import { harvestPrReviews, makeReviewClient } from './ingest/pr-reviews.js';
```

(Some of these may already be imported — if so, do not duplicate; reuse the existing import.)

- [ ] **Step 2: Add the `intel-study` case** to the `switch (cmd)` block (e.g. after the `audit-report` case):

```typescript
  case 'intel-study': {
    // usage: intel-study <language> [limit]   (set DEVLOOP_LOG to an isolated study log)
    const language = rest[0] ?? 'typescript';
    const limit = Number(rest[1] ?? '200');
    const repos = sourceRepos(language, limit);
    console.log(`sourced ${repos.length} ${language} repos`);
    const adopted = new Map<string, number>();
    let withEvent = 0;
    for (const repo of repos) {
      const at = detectAdoption(repo);
      if (!at) continue;
      adopted.set(repo, Date.parse(at));
      withEvent++;
      backfill([repo]); // PrOpened/PrMerged into the (isolated) log
      const seen = new Set(readEnvelopes().map((e) => e.eventType + JSON.stringify(e.payload)));
      for (const v of await harvestPrReviews([repo], makeReviewClient(), seen)) append(v);
    }
    const events = readEnvelopes();
    const studies: RepoStudy[] = [...adopted.entries()].map(([repo, adoptedAtMs]) =>
      studyRepo({ repo, outcomes: prOutcomes(events, repo), adoptedAtMs }),
    );
    const pooled = poolStudies(studies);
    const funnel = { practice: 'PR template', language, scanned: repos.length, withEvent, qualified: studies.filter((s) => s.qualified).length };
    const out = join(DATA_DIR, `intel-study-pr-template-${language}.md`);
    writeFileSync(out, renderStudyMarkdown(pooled, funnel));
    console.log(`wrote ${out} — ${funnel.qualified}/${withEvent} repos qualified`);
    break;
  }
```

(Note: `append`, `readEnvelopes`, `join`, `DATA_DIR`, `writeFileSync` are already imported in `cli.ts`. The dedup `seen` set mirrors `dedupKey` usage; if a `dedupKey` import is already present, prefer it.)

- [ ] **Step 3: Add `intel-study` to the default usage string.** Insert `intel-study` after `audit-report` in the long `usage: devloop <…>` line.

- [ ] **Step 4: Verify (typecheck + unit suite ONLY — no data run):**

```bash
npx tsc -p tsconfig.json --noEmit
npx vitest run
```

Expected: typecheck clean; suite all green. Do NOT run `intel-study` against real repos here — that is the human/controller step.

- [ ] **Step 5: Commit:**

```bash
git add src/cli.ts
git commit -m "feat(cli): intel-study orchestration — PR-template adoption study across public repos

Sources repos, detects adoption events, ingests PR + review metadata into an isolated
log, runs the placebo-controlled study, writes the finding. Coverage-excluded glue."
```

---

## Final verification + the real run

- [ ] **Suite + typecheck green:** `npx vitest run && npx tsc -p tsconfig.json --noEmit`.
- [ ] **Open a PR** in `domains/devloop` (PR-gated). Suggested body lines:

```
Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effect: cycle-time 0.1±0.1 expert
```

- [ ] **The payoff (human/controller, public data — committable):**

```bash
DEVLOOP_LOG=data/intel-pr-template-ts.jsonl npx tsx src/cli.ts intel-study typescript 200
# → data/intel-study-pr-template-typescript.md : does adopting a PR template move delivery?
```

This produces the first real cross-repo finding. If `pctImproved` + the net-effect distribution show a defensible signal → green-light scaling (more practices, the matched-cohort control, the benchmark/cold-outreach motions). If not → abandon cheaply, method disproven at low cost.

---

## Self-Review

**1. Spec coverage:** Pipeline §1 → Tasks 5 (source), 4 (detect), 6 (measure-orchestration), 1 (outcomes); analysis §2 → Task 2 (count-based windows + placebo netEffect + gate + pooling); output §3 → Task 3 (render, with funnel + caveats). The "can't reuse `whatIf`" crux is honored — Task 2 is a purpose-built, placebo-controlled analysis, not `whatIf`. Components §4 map 1:1 to the task files. Scope §5 respected (one practice, one language, ~150–200 repos, two outcomes; nothing deferred is built).

**2. Placeholder scan:** No TBD/TODO; every code step is complete. The `intel-study` glue is fully written (Task 6) though coverage-excluded.

**3. Type consistency:** `PrOutcome` (Task 1) is consumed by `studyRepo` (Task 2). `RepoStudy`/`OutcomeNetEffect`/`PooledOutcome`/`OutcomeKey` (Task 2) are consumed by `poolStudies`, `renderStudyMarkdown` (Task 3), and the CLI (Task 6) with matching fields. `earliestIso`/`detectAdoption` (Task 4) feed the CLI. Outcome keys `'firstReviewHrs'`/`'cycleHours'` are identical across `pr-outcomes`, `adoption-study`, and `render-study` (the `LABEL` map). `medianNetEffect`/`pctImproved`/`p10`/`p90`/`n` match between `poolStudies` and the renderer.

**Determinism note:** no Monte-Carlo anywhere (medians + percentiles only) — all tests assert exact values on synthetic fixtures.

---

## After this plan

If the signal is real, the deferred work (design §5) becomes the roadmap: a second practice (CI / CODEOWNERS), the matched-cohort difference-in-differences control, multi-language, and then the benchmark-comparator + cold-outreach motions — all building on this same corpus + pipeline. All subordinate to the oncology north-star.
