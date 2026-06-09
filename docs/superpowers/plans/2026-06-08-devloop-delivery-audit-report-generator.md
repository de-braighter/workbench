# Delivery Audit — Report Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn devloop's external-org primitives (cycle-time baseline, bottleneck decomposition, conclusive counterfactuals) into a single buyer-facing **Delivery Audit** report — the sellable deliverable.

**Architecture:** Three pure modules under `src/audit/` compose the existing inference primitives: `rankInterventions` runs `whatIf` across every lever × indicator and ranks the conclusive ones by a unitless "lift"; `buildAuditReport` assembles baseline + bottlenecks + (team-level only) interventions into a data model; `renderAuditMarkdown` turns that model into Markdown written in plain delivery language for an engineering leader (NOT devloop's internal/agent vocabulary). A thin `audit-report` CLI command writes the file. This is Plan 2 of the Delivery Audit pilot — it consumes the primitives shipped in Plan 1 (`docs/superpowers/plans/2026-06-08-devloop-delivery-audit-external-org-foundations.md`, merged via devloop#58).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), vitest. Tests in `test/`; event fixtures built with the typed constructors from `src/events.ts`.

**Working directory for ALL tasks:** `D:/development/projects/de-braighter/domains/devloop`. **Before Task 1, create a feature branch off `main`** (which now contains Plan 1):

```bash
cd D:/development/projects/de-braighter/domains/devloop
git checkout main && git pull --ff-only
git checkout -b feat/delivery-audit-report-generator
```

**Gaps addressed (from the spike gap analysis):** #4 (ranked counterfactual interventions) and #3 (narrative reframe — buyer-facing language at the render layer).

**⚠️ Governance constraint for the whole plan:** No subagent pulls or processes private-repo data. Every test below uses **synthetic fixtures**. The actual audit deliverable for a real repo is produced by the human/controller running the new `audit-report` command against the already-local validation log (`DEVLOOP_LOG=data/private-validation.jsonl`) — never by a subagent.

---

## File Structure

- `src/audit/rank-interventions.ts` — **create** (Task 1): `rankInterventions(events, repo)` — runs `whatIf` over lever × indicator, ranks conclusive comparisons by unitless lift.
- `src/audit/audit-report.ts` — **create** (Task 2): `buildAuditReport(events, repo, generatedAt)` — composes baseline + bottlenecks + team-level interventions into an `AuditReport`. Excludes individual-ranking levers (design §5).
- `src/audit/render-markdown.ts` — **create** (Task 3): `renderAuditMarkdown(report)` — buyer-facing Markdown + its own verbose duration/percent formatters.
- `src/cli.ts` — **modify** (Task 4): `audit-report <owner/repo>` command (coverage-excluded glue).
- `test/rank-interventions.test.ts`, `test/audit-report.test.ts`, `test/render-markdown.test.ts` — **create** (Tasks 1–3).

---

## Task 1: Ranked interventions

Run `whatIf` across every external-org lever × indicator, keep the CONCLUSIVE comparisons, and rank them by a unitless "lift" so cycle-time (hours) and cleanliness (probability) rank together. This is the differentiated audit core: "this kind of work is slower/buggier than that kind, by this much."

**Files:** Create `src/audit/rank-interventions.ts`; create `test/rank-interventions.test.ts`.

- [ ] **Step 1: Write the failing test** — create `test/rank-interventions.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { prOpened, prMerged } from '../src/events.js';
import { rankInterventions } from '../src/audit/rank-interventions.js';

const repo = 'org/r';

// feature (10h) vs fix (2h), 6 each, INTERLEAVED across days so the strata overlap in
// time (whatIf marks non-overlapping strata INCONCLUSIVE).
function corpus(): ReturnType<typeof prOpened>[] {
  const out: ReturnType<typeof prOpened>[] = [];
  for (let i = 1; i <= 12; i++) {
    const day = String(i).padStart(2, '0');
    const feature = i % 2 === 0;
    const title = feature ? 'feat: a' : 'fix: b';
    const branch = feature ? 'feature/a' : 'bugfix/b';
    out.push(prOpened({ repo, pr: i, title, branch, ts: `2026-01-${day}T00:00:00Z` }));
    out.push(prMerged({ repo, pr: i, title, cycleHours: feature ? 10 : 2, ts: `2026-01-${day}T${feature ? '10' : '02'}:00:00Z` }));
  }
  return out;
}

describe('rankInterventions — ranked conclusive counterfactuals', () => {
  it('ranks the cycle-time change-type gap first, fix as the better arm', () => {
    const r = rankInterventions(corpus(), repo);
    expect(r.length).toBeGreaterThan(0);
    const top = r[0]!;
    expect(top.indicator).toBe('cycle-time');
    expect(top.by).toBe('change-type');
    expect(top.best).toBe('fix');     // lower cycle-time = better arm
    expect(top.worst).toBe('feature');
    expect(top.lift).toBeGreaterThan(0.5); // ~ (10-2)/10 = 0.8, robust to MC noise
    expect(top.unit).toBe('hours');
  });

  it('returns nothing for a repo with no data', () => {
    expect(rankInterventions([], 'nope/nope')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/rank-interventions.test.ts`
Expected: FAIL — "Cannot find module '../src/audit/rank-interventions.js'".

- [ ] **Step 3: Implement** — create `src/audit/rank-interventions.ts`:

```typescript
// Rank the highest-leverage delivery interventions for a repo: run the whatIf
// counterfactual across every external-org lever × indicator, keep the CONCLUSIVE
// comparisons, and rank by a unitless "lift" (so cycle-time hours and cleanliness
// probabilities are comparable). The differentiated core of the Delivery Audit —
// "this kind of work is slower/buggier than that, by this much." Pure (whatIf is pure).
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { whatIf } from '../inference/whatif.js';

const INDICATORS = ['cycle-time', 'cleanliness'] as const;
const LEVERS = ['change-type', 'author'] as const;

export interface RankedIntervention {
  indicator: string; // 'cycle-time' | 'cleanliness'
  by: string; // 'change-type' | 'author'
  unit: 'hours' | 'probability';
  best: string; // best-performing stratum value (e.g. 'fix')
  worst: string; // worst-performing stratum value
  bestPoint: number; // indicator value for the best arm (in `unit`)
  worstPoint: number; // indicator value for the worst arm (in `unit`)
  gap: number; // |bestPoint - worstPoint| in `unit` (for display)
  lift: number; // unitless ranking score: fractional improvement best-vs-worst
  nBest: number;
  nWorst: number;
}

/** Unitless lift so hours and probabilities rank together. cycle-time (lower better):
 *  fractional time reduction (worst-best)/worst. cleanliness (higher better): absolute
 *  clean-rate gain best-worst (already a 0..1 fraction). Both ~0..1; higher = bigger lever. */
function liftOf(unit: 'hours' | 'probability', bestPoint: number, worstPoint: number): number {
  if (unit === 'hours') return worstPoint > 0 ? (worstPoint - bestPoint) / worstPoint : 0;
  return bestPoint - worstPoint;
}

export function rankInterventions(events: DomainEventEnvelope[], repo: string): RankedIntervention[] {
  const out: RankedIntervention[] = [];
  for (const indicator of INDICATORS) {
    for (const by of LEVERS) {
      const w = whatIf(events, { repo, indicator, by });
      if (!w.conclusive || w.strata.length < 2) continue;
      const best = w.strata[0]!; // whatIf sorts strata best-first
      const worst = w.strata[w.strata.length - 1]!;
      out.push({
        indicator,
        by,
        unit: w.unit,
        best: best.value,
        worst: worst.value,
        bestPoint: best.point,
        worstPoint: worst.point,
        gap: Math.abs(best.point - worst.point),
        lift: liftOf(w.unit, best.point, worst.point),
        nBest: best.n,
        nWorst: worst.n,
      });
    }
  }
  return out.sort((a, b) => b.lift - a.lift);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/rank-interventions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all green, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/audit/rank-interventions.ts test/rank-interventions.test.ts
git commit -m "feat(audit): rank conclusive counterfactual interventions by lift

Runs whatIf across lever x indicator, keeps conclusive comparisons, ranks by a
unitless lift so cycle-time and cleanliness sort together. The differentiated
core of the Delivery Audit."
```

---

## Task 2: Audit report data model

Compose the audit's data model for a repo: delivery baseline (cycle-time posterior) + bottlenecks (stage decomposition) + ranked interventions — **excluding individual-ranking levers** (design §5: system/team-level only, never rank individuals).

**Files:** Create `src/audit/audit-report.ts`; create `test/audit-report.test.ts`.

- [ ] **Step 1: Write the failing test** — create `test/audit-report.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { prOpened, prMerged } from '../src/events.js';
import { buildAuditReport } from '../src/audit/audit-report.js';

const repo = 'org/r';

// 12 merged PRs, interleaved by parity: even = feature/alice/10h, odd = fix/bob/2h. Both
// the change-type AND author levers are conclusive — so the report can prove it EXCLUDES
// the individual (author) lever while keeping the team-level (change-type) one.
function corpus(): ReturnType<typeof prOpened>[] {
  const out: ReturnType<typeof prOpened>[] = [];
  for (let i = 1; i <= 12; i++) {
    const day = String(i).padStart(2, '0');
    const feature = i % 2 === 0;
    const title = feature ? 'feat: a' : 'fix: b';
    const branch = feature ? 'feature/a' : 'bugfix/b';
    const author = feature ? 'alice' : 'bob';
    out.push(prOpened({ repo, pr: i, title, branch, author, ts: `2026-01-${day}T00:00:00Z` }));
    out.push(prMerged({ repo, pr: i, title, cycleHours: feature ? 10 : 2, ts: `2026-01-${day}T${feature ? '10' : '02'}:00:00Z` }));
  }
  return out;
}

describe('buildAuditReport', () => {
  it('composes baseline + bottlenecks + team-level interventions', () => {
    const report = buildAuditReport(corpus(), repo, '2026-06-08T10:00:00Z');
    expect(report.repo).toBe(repo);
    expect(report.baseline).not.toBeNull();
    expect(report.baseline!.nMerged).toBe(12);
    expect(report.baseline!.medianHrs).toBeGreaterThan(0);
    expect(report.bottlenecks.nMerged).toBe(12);
    expect(report.interventions.some((i) => i.by === 'change-type')).toBe(true);
  });

  it('EXCLUDES individual-ranking (author) interventions (design §5)', () => {
    const report = buildAuditReport(corpus(), repo, '2026-06-08T10:00:00Z');
    expect(report.interventions.some((i) => i.by === 'author')).toBe(false);
  });

  it('returns a null baseline when there are too few merges to fit', () => {
    const ev = [
      prOpened({ repo, pr: 1, title: 'x', ts: '2026-01-01T00:00:00Z' }),
      prMerged({ repo, pr: 1, title: 'x', cycleHours: 3, ts: '2026-01-01T03:00:00Z' }),
    ];
    const report = buildAuditReport(ev, repo, '2026-06-08T10:00:00Z');
    expect(report.baseline).toBeNull();
    expect(report.bottlenecks.nMerged).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/audit-report.test.ts`
Expected: FAIL — "Cannot find module '../src/audit/audit-report.js'".

- [ ] **Step 3: Implement** — create `src/audit/audit-report.ts`:

```typescript
// Assemble the Delivery Audit's data model for a repo: delivery baseline (cycle-time
// posterior) + bottlenecks (stage decomposition) + ranked counterfactual interventions.
// Pure — composes the inference primitives; the renderer turns this into the deliverable.
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { ofType } from '../log.js';
import { EVENT, type PrMergedPayload } from '../events.js';
import { cycleTimePredictive } from '../inference/cycle-time.js';
import { stageBreakdown, type StageBreakdown } from '../inference/stage-decomposition.js';
import { rankInterventions, type RankedIntervention } from './rank-interventions.js';

const HOUR_MS = 3.6e6;
const MIN_FIT = 5; // need >=5 merges to fit a stable cycle-time posterior

// The Delivery Audit reports at the system/team level, NEVER ranks individuals
// (design §5: anti-surveillance posture + EU works-council reality). Author-keyed levers
// remain available for internal analysis (whatif / rankInterventions) but are excluded
// from the audit deliverable here.
const INDIVIDUAL_LEVERS = new Set(['author']);

export interface DeliveryBaseline {
  nMerged: number;
  medianHrs: number;
  p10Hrs: number;
  p90Hrs: number;
  throughputPerWeek: number;
}

export interface AuditReport {
  repo: string;
  generatedAt: string;
  baseline: DeliveryBaseline | null; // null when < MIN_FIT merges
  bottlenecks: StageBreakdown;
  interventions: RankedIntervention[];
}

export function buildAuditReport(events: DomainEventEnvelope[], repo: string, generatedAt: string): AuditReport {
  const hours: number[] = [];
  const tsMs: number[] = [];
  for (const e of ofType(events, EVENT.PR_MERGED)) {
    const p = e.payload as unknown as PrMergedPayload;
    if (p.repo !== repo || !(p.cycleHours > 0)) continue;
    hours.push(p.cycleHours);
    tsMs.push(Date.parse(e.occurredAt));
  }

  let baseline: DeliveryBaseline | null = null;
  if (hours.length >= MIN_FIT) {
    const pred = cycleTimePredictive(hours);
    const sortedTs = [...tsMs].sort((a, b) => a - b);
    const spanDays = sortedTs.length > 1 ? (sortedTs[sortedTs.length - 1]! - sortedTs[0]!) / (HOUR_MS * 24) : 0;
    baseline = {
      nMerged: hours.length,
      medianHrs: pred.median,
      p10Hrs: pred.p10,
      p90Hrs: pred.p90,
      throughputPerWeek: spanDays > 0 ? (hours.length / spanDays) * 7 : hours.length,
    };
  }

  return {
    repo,
    generatedAt,
    baseline,
    bottlenecks: stageBreakdown(events, repo),
    interventions: rankInterventions(events, repo).filter((i) => !INDIVIDUAL_LEVERS.has(i.by)),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/audit-report.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/audit/audit-report.ts test/audit-report.test.ts
git commit -m "feat(audit): buildAuditReport composes baseline + bottlenecks + interventions

Assembles the audit data model from the inference primitives. Excludes individual
(author) levers from the deliverable per the system/team-level-only principle (design
§5: anti-surveillance / works-council)."
```

---

## Task 3: Markdown renderer (buyer-facing reframe)

Render an `AuditReport` as Markdown a non-technical-vocabulary engineering leader reads — plain delivery language (cycle time, review turnaround, rework), NOT devloop's internal/agent vocabulary. This is gap #3 (the reframe).

**Files:** Create `src/audit/render-markdown.ts`; create `test/render-markdown.test.ts`.

- [ ] **Step 1: Write the failing test** — create `test/render-markdown.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { renderAuditMarkdown, formatDuration } from '../src/audit/render-markdown.js';
import type { AuditReport } from '../src/audit/audit-report.js';

const report: AuditReport = {
  repo: 'org/r',
  generatedAt: '2026-06-08T10:00:00Z',
  baseline: { nMerged: 100, medianHrs: 1.7, p10Hrs: 0.1, p90Hrs: 48, throughputPerWeek: 12.3 },
  bottlenecks: {
    repo: 'org/r', nMerged: 100, nReviewed: 70,
    waitForReviewHrs: 0.883, reviewToMergeHrs: 0.113, totalHrs: 1.7,
    unreviewedShare: 0.31, dominant: 'wait-for-review',
  },
  interventions: [
    { indicator: 'cycle-time', by: 'change-type', unit: 'hours', best: 'fix', worst: 'feature', bestPoint: 2, worstPoint: 10, gap: 8, lift: 0.8, nBest: 24, nWorst: 62 },
  ],
};

describe('formatDuration — buyer-facing', () => {
  it('renders human-friendly durations', () => {
    expect(formatDuration(0.883)).toBe('53 minutes');
    expect(formatDuration(1.7)).toBe('1.7 hours');
    expect(formatDuration(48)).toBe('2.0 days');
  });
});

describe('renderAuditMarkdown', () => {
  it('renders baseline, bottlenecks, and ranked interventions in plain language', () => {
    const md = renderAuditMarkdown(report);
    expect(md).toContain('# Delivery Audit — org/r');
    expect(md).toContain('100 merged pull requests');
    expect(md).toContain('1.7 hours');                 // baseline median
    expect(md).toContain('53 minutes');                // time to first review
    expect(md).toContain('31%');                       // unreviewed share
    expect(md).toContain('waiting for the first review'); // dominant stage, in plain words
    expect(md).toContain('80% faster');                // intervention lift
    expect(md).toContain('feature');
    expect(md).toContain('fix');
  });

  it('uses NO internal/agent vocabulary (the reframe)', () => {
    const md = renderAuditMarkdown(report).toLowerCase();
    for (const jargon of ['verifier', 'producer', 'agent', 'calibration', 'wave']) {
      expect(md).not.toContain(jargon);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/render-markdown.test.ts`
Expected: FAIL — "Cannot find module '../src/audit/render-markdown.js'".

- [ ] **Step 3: Implement** — create `src/audit/render-markdown.ts`:

```typescript
// Render an AuditReport as a buyer-facing Delivery Audit (Markdown). Deliberately uses
// the delivery language an engineering leader reads — cycle time, review turnaround,
// rework — NOT devloop's internal vocabulary ("verifier", "producer", "wave",
// "calibration"). Buyer-facing formatters here are intentionally more verbose than
// cli.ts's terse operator formatters (a different audience, not duplication).
import type { AuditReport } from './audit-report.js';
import type { RankedIntervention } from './rank-interventions.js';

/** Buyer-facing duration: "45 seconds", "53 minutes", "1.7 hours", "2.0 days". */
export function formatDuration(hours: number): string {
  if (!isFinite(hours) || hours <= 0) return 'n/a';
  if (hours < 1 / 60) return `${Math.round(hours * 3600)} seconds`;
  if (hours < 1) return `${Math.round(hours * 60)} minutes`;
  if (hours < 48) return `${hours.toFixed(1)} hours`;
  return `${(hours / 24).toFixed(1)} days`;
}

/** Buyer-facing percent: "31%". */
export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function interventionLine(i: RankedIntervention): string {
  if (i.unit === 'hours') {
    return `- **By ${i.by}:** "${i.worst}" work takes ~${formatDuration(i.worstPoint)} to merge vs ~${formatDuration(i.bestPoint)} for "${i.best}" — about ${formatPercent(i.lift)} faster (${i.nWorst} vs ${i.nBest} PRs).`;
  }
  return `- **By ${i.by}:** "${i.best}" work ships clean ${formatPercent(i.bestPoint)} of the time vs ${formatPercent(i.worstPoint)} for "${i.worst}" (${i.nBest} vs ${i.nWorst} PRs).`;
}

export function renderAuditMarkdown(report: AuditReport): string {
  const lines: string[] = [];
  lines.push(`# Delivery Audit — ${report.repo}`);
  lines.push('');
  lines.push(`_Generated ${report.generatedAt.slice(0, 10)} · based on GitHub delivery metadata only — no source code._`);
  lines.push('');

  lines.push('## 1. Delivery baseline');
  lines.push('');
  if (report.baseline) {
    const b = report.baseline;
    lines.push(
      `Across **${b.nMerged} merged pull requests**, the typical PR takes **${formatDuration(b.medianHrs)}** from open to merge ` +
        `(80% land between ${formatDuration(b.p10Hrs)} and ${formatDuration(b.p90Hrs)}). ` +
        `Throughput is about **${b.throughputPerWeek.toFixed(1)} PRs/week**.`,
    );
  } else {
    lines.push('_Not enough merged PRs (need at least 5) to establish a stable baseline._');
  }
  lines.push('');

  const bn = report.bottlenecks;
  lines.push('## 2. Where the time goes');
  lines.push('');
  if (bn.nReviewed > 0) {
    const dominantLabel = bn.dominant === 'wait-for-review' ? 'waiting for the first review' : 'the review-to-merge window';
    lines.push(`- Time to first review: **${formatDuration(bn.waitForReviewHrs)}** (median)`);
    lines.push(`- Review to merge: **${formatDuration(bn.reviewToMergeHrs)}** (median)`);
    lines.push(`- PRs merged with no recorded review: **${formatPercent(bn.unreviewedShare)}**`);
    lines.push('');
    lines.push(`**The dominant delay is ${dominantLabel}.**`);
  } else {
    lines.push(
      `No PR reviews were recorded, so open→merge time can't be split into review stages. ` +
        `PRs merged with no recorded review: **${formatPercent(bn.unreviewedShare)}**.`,
    );
  }
  lines.push('');

  lines.push('## 3. Highest-leverage interventions');
  lines.push('');
  if (report.interventions.length > 0) {
    lines.push('Ranked by the size of the delivery difference between kinds of work (conditional estimates, not proof of causation):');
    lines.push('');
    for (const i of report.interventions) lines.push(interventionLine(i));
  } else {
    lines.push('_No conclusive differences surfaced — the kinds of work compared were too few or too similar to separate._');
  }
  lines.push('');
  lines.push('---');
  lines.push('_Reported at the team and system level. No individual contributor is ranked._');
  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/render-markdown.test.ts`
Expected: PASS (formatDuration: 3 + render: 2 = via the two describes).

- [ ] **Step 5: Run the full suite**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/audit/render-markdown.ts test/render-markdown.test.ts
git commit -m "feat(audit): buyer-facing Markdown renderer for the Delivery Audit

Renders the audit in plain delivery language (cycle time / review turnaround /
rework), explicitly free of devloop's internal vocabulary, with a team-level-only
footer. Gap #3 (the reframe)."
```

---

## Task 4: CLI `audit-report` command

Surface the report generator to the operator. `src/cli.ts` is **coverage-excluded** (per `vitest.config.ts`), so this is glue verified by typecheck + the unit suite — NOT by running against real data (the human runs that separately).

**Files:** Modify `src/cli.ts`.

- [ ] **Step 1: Add the imports.** In `src/cli.ts`, after the line `import { stageBreakdown } from './inference/stage-decomposition.js';` add:

```typescript
import { buildAuditReport } from './audit/audit-report.js';
import { renderAuditMarkdown } from './audit/render-markdown.js';
```

- [ ] **Step 2: Add the `audit-report` case** to the `switch (cmd)` block, right after the `case 'bottlenecks': { … }` block:

```typescript
  case 'audit-report': {
    if (!rest[0]) { console.log('usage: audit-report <owner/repo>'); break; }
    const slug = rest[0].replace(/[^\w.-]+/g, '-');
    const out = join(DATA_DIR, `audit-${slug}.md`);
    const report = buildAuditReport(readEnvelopes(), rest[0], new Date().toISOString());
    writeFileSync(out, renderAuditMarkdown(report));
    console.log(`wrote ${out} — the Delivery Audit (${report.interventions.length} ranked intervention(s))`);
    break;
  }
```

- [ ] **Step 3: Add `audit-report` to the default usage string.** Find the `default:` case (the long `usage: devloop <…>` line) and insert `audit-report` after `bottlenecks`:

```typescript
  default: console.log('usage: devloop <backfill|seed|append|drain|declare-effect|observe-effect|retro|retros|reconcile|sonar-verdicts|calibration|qa-baseline|posterior|whatif|bottlenecks|audit-report|reliability|snapshot|dashboard|cascade|interventions|persist-cascade|publish>'); process.exit(1);
```

Read the existing default string first and merge `audit-report` in, preserving any commands already present.

- [ ] **Step 4: Verify (typecheck + unit suite ONLY — no data commands):**

```bash
npx tsc -p tsconfig.json --noEmit
npx vitest run
```
Expected: typecheck clean; full suite all green. Do NOT run `audit-report` against any external/real repo — that is the human/controller's separate step.

- [ ] **Step 5: Commit:**

```bash
git add src/cli.ts
git commit -m "feat(cli): audit-report command writes the Delivery Audit markdown

Assembles + renders the buyer-facing Delivery Audit for a repo to
data/audit-<slug>.md. Coverage-excluded CLI glue over the tested audit modules."
```

---

## Final verification

- [ ] **Run the full suite + typecheck:**

```bash
npx vitest run
npx tsc -p tsconfig.json --noEmit
```
Expected: all green, clean. Open a PR in `domains/devloop` (PR-gated; do not merge to main directly). Suggested PR body lines:

```
Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effect: cycle-time 0.1±0.1 expert
```

(Do NOT put any real-repo metrics in the PR body — the audit unit tests use synthetic fixtures; real audit output stays local.)

---

## Self-Review

**1. Spec coverage:** Gap #4 (ranked counterfactuals) → Task 1 (`rankInterventions`) + surfaced in Task 2/3/4. Gap #3 (narrative reframe) → Task 3 (buyer-facing renderer, jargon-free, with the team-level-only footer). The design §5 anti-surveillance principle → enforced in Task 2 (`INDIVIDUAL_LEVERS` exclusion) + Task 3 footer. The deliverable artifact → Task 4 (`audit-report` CLI). Baseline + bottlenecks reuse Plan 1's primitives. Covered.

**2. Placeholder scan:** No TBD/TODO; every step has complete runnable code.

**3. Type consistency:** `RankedIntervention` (Task 1) is consumed by `audit-report.ts` (Task 2) and `render-markdown.ts` (Task 3) with matching fields (`indicator`, `by`, `unit`, `best`, `worst`, `bestPoint`, `worstPoint`, `gap`, `lift`, `nBest`, `nWorst`). `AuditReport` + `DeliveryBaseline` (Task 2) are consumed by the renderer (Task 3) and CLI (Task 4) with matching fields. `StageBreakdown` is reused from Plan 1 (`src/inference/stage-decomposition.ts`) — its fields (`nMerged`, `nReviewed`, `waitForReviewHrs`, `reviewToMergeHrs`, `totalHrs`, `unreviewedShare`, `dominant`) match the render-markdown test fixture. `cycleTimePredictive` returns `{median, p10, p90, n}` (used in Task 2). `whatIf` returns `{strata (best-first), conclusive, unit, …}` (used in Task 1). Consistent.

**Note on MC determinism:** `cycleTimePredictive` / `betaPosterior` use Monte-Carlo sampling, so Task 1/2 tests assert categorical fields + ranges (`lift > 0.5`, `medianHrs > 0`), never exact MC-derived point values. Task 3 tests render a hand-built literal `AuditReport` (no MC) so its string assertions are deterministic.

---

## After this plan

The report generator completes the Delivery Audit's build delta (#1–#4 across Plans 1+2). **The payoff step (human/controller, not a subagent):** with the validation log present, run
`DEVLOOP_LOG=data/private-validation.jsonl npx tsx src/cli.ts audit-report <owner/repo>`
to produce the first real Delivery Audit markdown locally — the artifact a design partner would receive. Remaining pilot work (post-validation): buyer-facing naming, the operator runbook, pricing, and the data-processing agreement — none of which are code.
