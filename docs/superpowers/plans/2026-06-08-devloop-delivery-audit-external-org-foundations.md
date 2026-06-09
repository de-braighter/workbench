# Delivery Audit — External-Org Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make devloop's counterfactual + bottleneck analysis work on a *normal human team's* GitHub history (no `Producer:`/`Effect:` conventions), so the Delivery Audit deliverable can run on an external org.

**Architecture:** devloop's `whatif` counterfactual currently strata-fies PRs only by `PRODUCER` events (model/provider/producer/skill), which exist only on the cluster's own AI-authored PRs — so on an external repo every stratum is empty and `whatif` is INCONCLUSIVE (proven in the 2026-06-08 spike against `<org>/<repo>`: "every stratum empty (no attribution)"). This plan adds **PR-derived levers** (`change-type` from branch/title, `author` from the GitHub PR author) that need no special conventions, plus a **cycle-time stage decomposition** (open→first-review→merge) that powers the audit's "where does the time go" section. All new logic is pure functions, TDD'd; the CLI wiring is glue (coverage-excluded per the repo's existing convention).

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Zod payload schemas, vitest. Tests live in `test/*.test.ts`; event fixtures are built with the typed constructors in `src/events.ts`.

**Working directory for ALL tasks:** `D:/development/projects/de-braighter/domains/devloop` (a sibling repo, separate git from the workbench). **Before Task 0, create a feature branch there** (the cluster is PR-gated):

```bash
cd D:/development/projects/de-braighter/domains/devloop
git checkout -b feat/delivery-audit-external-org-foundations
git status   # confirm src/log.ts shows the uncommitted DEVLOOP_LOG one-liner from the spike
```

**Source spec / context:** `docs/superpowers/specs/2026-06-07-devloop-delivery-audit-concierge-pilot-design.md` (§4 build delta) + the spike runbook `docs/superpowers/runbooks/2026-06-08-devloop-private-validation-spike.md`. Gaps addressed: #1 (external-org attribution) and #2 (cycle-time decomposition). Gaps #3 (narrative reframe) and #4 (ranked counterfactual report) are a **follow-on plan** that consumes these primitives — see "Scope & Follow-on" at the end.

---

## File Structure

- `src/log.ts` — **modify** (Task 0): the `DEVLOOP_LOG` env knob (one line, already applied in the spike — this task adds its test).
- `src/change-type.ts` — **create** (Task 1): pure `changeTypeOf(branch, title)` — the external-org analog of model/producer attribution.
- `src/events.ts` — **modify** (Tasks 1, 2): export `PrOpenedPayload`; add optional `author` to the `PrOpened` schema.
- `src/inference/whatif.ts` — **modify** (Tasks 1, 2): add PR-derived levers (`change-type`, `author`) to `leverValues`.
- `src/ingest/github.ts` — **modify** (Task 2): capture the PR `author` login in `backfill`.
- `src/inference/stage-decomposition.ts` — **create** (Task 3): `stageBreakdown(events, repo)` — open→first-review→merge medians.
- `src/cli.ts` — **modify** (Task 4): `bottlenecks` command + updated `whatif` lever help (coverage-excluded glue; verified by hand).
- `test/log-env.test.ts`, `test/change-type.test.ts`, `test/whatif-pr-levers.test.ts`, `test/stage-decomposition.test.ts` — **create** (Tasks 0–3).

---

## Task 0: Harden the `DEVLOOP_LOG` log-isolation knob

The spike added `process.env['DEVLOOP_LOG'] ?? …` to `src/log.ts:14` to isolate the private-repo dataset, but it is **uncommitted and untested**. This task locks it down (it is also the product capability "isolated dataset per customer").

**Files:**
- Modify: `src/log.ts:14` (already changed in the spike — confirm it reads as below)
- Test: `test/log-env.test.ts`

- [ ] **Step 1: Confirm the implementation is present**

`src/log.ts:14` must already read:

```typescript
export const DEFAULT_LOG = process.env['DEVLOOP_LOG'] ?? join(PKG_ROOT, 'data', 'events.jsonl');
```

If it instead reads `export const DEFAULT_LOG = join(PKG_ROOT, 'data', 'events.jsonl');`, apply the change above.

- [ ] **Step 2: Write the failing test**

Create `test/log-env.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { join } from 'node:path';

afterEach(() => {
  delete process.env['DEVLOOP_LOG'];
  vi.resetModules();
});

describe('DEFAULT_LOG — DEVLOOP_LOG env override', () => {
  it('uses DEVLOOP_LOG when set (isolated per-target dataset)', async () => {
    const custom = join('data', 'private-validation.jsonl');
    process.env['DEVLOOP_LOG'] = custom;
    vi.resetModules();
    const { DEFAULT_LOG } = await import('../src/log.js');
    expect(DEFAULT_LOG).toBe(custom);
  });

  it('falls back to data/events.jsonl when DEVLOOP_LOG is unset', async () => {
    delete process.env['DEVLOOP_LOG'];
    vi.resetModules();
    const { DEFAULT_LOG } = await import('../src/log.js');
    expect(DEFAULT_LOG.replace(/\\/g, '/')).toMatch(/\/data\/events\.jsonl$/);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes (impl already present)**

Run: `npx vitest run test/log-env.test.ts`
Expected: PASS (2 tests). If the first test FAILS, the Step-1 change is missing — apply it, re-run.

- [ ] **Step 4: Commit**

```bash
git add src/log.ts test/log-env.test.ts
git commit -m "feat(log): DEVLOOP_LOG env knob for isolated per-target datasets

Enables running devloop against an external org's metadata in a separate
log file, leaving the cluster's own events.jsonl untouched. Foundation for
the Delivery Audit pilot (private-validation isolation)."
```

---

## Task 1: `change-type` lever (branch/title-derived attribution)

The cheapest unblocker — needs **zero new ingestion**. Strata-fy PRs by feature/fix/chore derived from the branch name (`feature/…`, `Bugfix/…`) or the conventional-commit title prefix (`feat(...)`, `fix(...)`). On the private-repo data this immediately makes `whatif` CONCLUSIVE (feature vs fix arms).

**Files:**
- Create: `src/change-type.ts`
- Modify: `src/events.ts` (add `export type PrOpenedPayload`)
- Modify: `src/inference/whatif.ts` (PR-derived lever path)
- Test: `test/change-type.test.ts`, `test/whatif-pr-levers.test.ts`

- [ ] **Step 1: Write the failing test for `changeTypeOf`**

Create `test/change-type.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { changeTypeOf } from '../src/change-type.js';

describe('changeTypeOf — external-org change classification', () => {
  it('classifies from the branch prefix (real private-repo shapes)', () => {
    expect(changeTypeOf('feature/miro/Tapas-796-new-orgIds', 'feat(TAPAS-796): new org ids')).toBe('feature');
    expect(changeTypeOf('Bugfix/houd/tapas-847', 'Bugfix/houd/tapas 847')).toBe('fix');
    expect(changeTypeOf('renovate/aws-sdk', 'chore(deps): bump aws-sdk')).toBe('bot');
  });

  it('falls back to the conventional-commit title prefix when the branch is noise', () => {
    expect(changeTypeOf('tapas-810-remove-script', 'fix(TAPAS-810): remove script')).toBe('fix');
    expect(changeTypeOf(undefined, 'feat(TAPAS-796): new organisation id')).toBe('feature');
    expect(changeTypeOf('miroslav/wip', 'refactor: tidy sync')).toBe('refactor');
  });

  it("returns 'other' when nothing matches, and never throws on empty input", () => {
    expect(changeTypeOf(undefined, undefined)).toBe('other');
    expect(changeTypeOf('', 'random title')).toBe('other');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/change-type.test.ts`
Expected: FAIL — "Cannot find module '../src/change-type.js'".

- [ ] **Step 3: Implement `changeTypeOf`**

Create `src/change-type.ts`:

```typescript
// Derive a change-type stratum from a PR's branch + title — the external-org analog of
// producer/model attribution (which a normal human team's PRs don't carry). Pure, prefix-
// based: the branch's first path segment wins (feature/, bugfix/, chore/…); a renovate/
// dependabot branch is a bot PR; otherwise fall back to the conventional-commit title
// prefix (feat:, fix(scope):, …). Unknown → 'other'. Never throws. Mirrors provider.ts.
const BOT_BRANCH = /^(renovate|dependabot)\b/;
const SEG_FEATURE = /^(feature|feat)$/;
const SEG_FIX = /^(bugfix|hotfix|bug|fix)$/;
const SEG_KNOWN = /^(chore|refactor|docs|test|ci|build|perf)$/;
const TITLE_PREFIX = /^(feat|feature|fix|bugfix|chore|refactor|docs|test|ci|build|perf)\b/;

export function changeTypeOf(branch: string | undefined, title: string | undefined): string {
  const b = (branch ?? '').trim().toLowerCase();
  if (BOT_BRANCH.test(b)) return 'bot';
  const seg = b.split('/')[0] ?? '';
  if (SEG_FEATURE.test(seg)) return 'feature';
  if (SEG_FIX.test(seg)) return 'fix';
  if (SEG_KNOWN.test(seg)) return seg;
  const m = TITLE_PREFIX.exec((title ?? '').trim().toLowerCase());
  if (m) {
    const k = m[1]!;
    if (k === 'feat' || k === 'feature') return 'feature';
    if (k === 'fix' || k === 'bugfix') return 'fix';
    return k;
  }
  return 'other';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/change-type.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Export `PrOpenedPayload` from events.ts**

In `src/events.ts`, find the payload-types block (around line 48, after `export type PrMergedPayload = z.infer<typeof PrMerged>;`) and add:

```typescript
export type PrOpenedPayload = z.infer<typeof PrOpened>;
```

- [ ] **Step 6: Write the failing test for the `change-type` whatif lever**

Create `test/whatif-pr-levers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { prOpened, prMerged } from '../src/events.js';
import { whatIf } from '../src/inference/whatif.js';

const repo = 'org/r';

// Two arms (feature vs fix), 6 PRs each, INTERLEAVED across the same date range so the
// strata temporally overlap — else whatif's anti-time-confounding guard (whatif.ts:138)
// flags them non-overlapping → INCONCLUSIVE.
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

describe('whatIf — change-type lever (external-org, no PRODUCER events)', () => {
  it('produces conclusive feature-vs-fix strata from branch/title alone', () => {
    const w = whatIf(corpus(), { repo, indicator: 'cycle-time', by: 'change-type' });
    expect(w.strata.map((s) => s.value).sort()).toEqual(['feature', 'fix']);
    expect(w.strata.every((s) => s.n === 6)).toBe(true);
    expect(w.conclusive).toBe(true);
    // fix arm (2h) is the better (lower) cycle-time → sorted first
    expect(w.strata[0]?.value).toBe('fix');
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx vitest run test/whatif-pr-levers.test.ts`
Expected: FAIL — lever `change-type` unsupported → `w.strata` is empty, assertions fail.

- [ ] **Step 8: Wire the PR-derived lever path into whatif**

In `src/inference/whatif.ts`:

(a) Extend the imports — change the events import line to add `PrOpenedPayload`, and add the change-type import below it:

```typescript
import { EVENT, type PrMergedPayload, type ProducerPayload, type VerdictPayload, type PrOpenedPayload } from '../events.js';
import { changeTypeOf } from '../change-type.js';
```

(b) Below `const CATEGORICAL = new Set(['model', 'provider', 'producer']);` add:

```typescript
// Levers derived from the PR itself (PrOpened), not from PRODUCER events — these work on
// an external org with no `Producer:`/`Effect:` conventions. (#1 external-org attribution)
const PR_DERIVED = new Set(['change-type']);
```

(c) Replace the body of `leverValues` so the gate admits PR-derived levers and a new branch handles them. The function becomes:

```typescript
function leverValues(events: DomainEventEnvelope[], repo: string, by: string): { values: Map<number, string>; ok: boolean } {
  const values = new Map<number, string>();
  const skill = /^skill:(.+)$/.exec(by)?.[1];
  if (!CATEGORICAL.has(by) && !skill && !PR_DERIVED.has(by)) return { values, ok: false };
  if (PR_DERIVED.has(by)) {
    for (const e of ofType(events, EVENT.PR_OPENED)) {
      const p = e.payload as unknown as PrOpenedPayload;
      if (p.repo !== repo) continue;
      if (by === 'change-type') values.set(p.pr, changeTypeOf(p.branch, p.title));
    }
    return { values, ok: true };
  }
  for (const e of ofType(events, EVENT.PRODUCER)) {
    const p = e.payload as unknown as ProducerPayload;
    if (p.repo !== repo) continue;
    if (skill) values.set(p.pr, (p.skills ?? []).includes(skill) ? `with ${skill}` : `without ${skill}`);
    else values.set(p.pr, by === 'model' ? p.model : by === 'provider' ? providerOf(p.model) : p.producer);
  }
  return { values, ok: true };
}
```

(d) Update the "not supported" message to list the new lever. Find this line in `whatIf`:

```typescript
  if (!ok) return empty(`lever '${by}' not supported (try: model | provider | producer | skill:<name>)`);
```

and change it to:

```typescript
  if (!ok) return empty(`lever '${by}' not supported (try: change-type | author | model | provider | producer | skill:<name>)`);
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx vitest run test/whatif-pr-levers.test.ts test/change-type.test.ts`
Expected: PASS.

- [ ] **Step 10: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: PASS (all existing tests still green).

- [ ] **Step 11: Commit**

```bash
git add src/change-type.ts src/events.ts src/inference/whatif.ts test/change-type.test.ts test/whatif-pr-levers.test.ts
git commit -m "feat(whatif): change-type lever for external-org counterfactuals

Strata-fy PRs by feature/fix/chore derived from branch+title, so whatif is
conclusive on a normal team's history (no Producer:/Effect: conventions).
Resolves the spike's '111/111 PRs lack attribution' INCONCLUSIVE result."
```

---

## Task 2: Ingest PR `author` + `author` lever

Adds the second external-org lever — strata by the GitHub PR author. Requires capturing the author login in `backfill` (one extra `gh` field).

**Files:**
- Modify: `src/events.ts` (add `author` to `PrOpened` schema)
- Modify: `src/ingest/github.ts` (capture `author` in `backfill`)
- Modify: `src/inference/whatif.ts` (add `author` to `PR_DERIVED` + the lever branch)
- Test: `test/whatif-pr-levers.test.ts` (extend)

- [ ] **Step 1: Add `author` to the `PrOpened` schema**

In `src/events.ts`, find:

```typescript
const PrOpened = z.object({ repo: z.string(), pr: z.number().int(), title: z.string(), branch: z.string().optional() });
```

and change it to:

```typescript
const PrOpened = z.object({ repo: z.string(), pr: z.number().int(), title: z.string(), branch: z.string().optional(), author: z.string().optional() });
```

(Optional field → backward-compatible: existing logs without `author` still validate.)

- [ ] **Step 2: Write the failing test for the `author` lever**

Append to `test/whatif-pr-levers.test.ts`:

```typescript
describe('whatIf — author lever', () => {
  it('strata-fies PRs by author (interleaved so arms temporally overlap)', () => {
    const ev: ReturnType<typeof prOpened>[] = [];
    for (let i = 1; i <= 10; i++) {
      const day = String(i).padStart(2, '0');
      const alice = i % 2 === 0;
      ev.push(prOpened({ repo, pr: i, title: 't', branch: 'feature/x', author: alice ? 'alice' : 'bob', ts: `2026-02-${day}T00:00:00Z` }));
      ev.push(prMerged({ repo, pr: i, title: 't', cycleHours: alice ? 4 : 8, ts: `2026-02-${day}T0${alice ? '4' : '8'}:00:00Z` }));
    }
    const w = whatIf(ev, { repo, indicator: 'cycle-time', by: 'author' });
    expect(w.strata.map((s) => s.value).sort()).toEqual(['alice', 'bob']);
    expect(w.conclusive).toBe(true);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run test/whatif-pr-levers.test.ts`
Expected: FAIL on the new test — `author` lever unsupported, strata empty.

- [ ] **Step 4: Add `author` to the PR-derived lever path**

In `src/inference/whatif.ts`:

(a) Change `const PR_DERIVED = new Set(['change-type']);` to:

```typescript
const PR_DERIVED = new Set(['change-type', 'author']);
```

(b) In the PR-derived branch of `leverValues`, change the inner assignment line:

```typescript
      if (by === 'change-type') values.set(p.pr, changeTypeOf(p.branch, p.title));
```

to:

```typescript
      if (by === 'change-type') values.set(p.pr, changeTypeOf(p.branch, p.title));
      else if (by === 'author') values.set(p.pr, p.author ?? 'unknown');
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/whatif-pr-levers.test.ts`
Expected: PASS (all describes).

- [ ] **Step 6: Capture `author` in backfill**

In `src/ingest/github.ts`:

(a) Extend the `GhPr` interface (line 9) to include the author shape:

```typescript
interface GhPr { number: number; createdAt: string; mergedAt: string; title: string; headRefName?: string; body?: string; author?: { login?: string }; }
```

(b) Add `author` to the `gh pr list --json` field list (line ~149). Change:

```typescript
      `gh pr list --repo ${repo} --state merged --limit 200 --json number,createdAt,mergedAt,title,headRefName,body`,
```

to:

```typescript
      `gh pr list --repo ${repo} --state merged --limit 200 --json number,createdAt,mergedAt,title,headRefName,body,author`,
```

(c) Pass the author into the `prOpened` constructor (line ~155). Change:

```typescript
      add(prOpened({ repo, pr: p.number, title: p.title, branch: p.headRefName, ts: p.createdAt }));
```

to:

```typescript
      add(prOpened({ repo, pr: p.number, title: p.title, branch: p.headRefName, author: p.author?.login, ts: p.createdAt }));
```

- [ ] **Step 7: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/events.ts src/ingest/github.ts src/inference/whatif.ts test/whatif-pr-levers.test.ts
git commit -m "feat(ingest,whatif): capture PR author + author lever

backfill now records the GitHub PR author login (PrOpened.author, optional),
and whatif can strata-fy by author — the second external-org lever for the
Delivery Audit."
```

---

## Task 3: Cycle-time stage decomposition

Powers the audit's "where does the time go" / top-bottleneck section: split each PR's lifetime into **open → first review** and **first review → merge**, using `PrOpened.occurredAt`, the earliest `VerdictRecorded.occurredAt` (review time), and `PrMerged.occurredAt`. Spike data confirmed reviews carry the submission time (PR #156: opened 14:58, reviewed 15:04).

**Files:**
- Create: `src/inference/stage-decomposition.ts`
- Test: `test/stage-decomposition.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/stage-decomposition.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { prOpened, prMerged, verdict } from '../src/events.js';
import { stageBreakdown } from '../src/inference/stage-decomposition.js';

const repo = 'org/r';

describe('stageBreakdown — where the PR time goes', () => {
  it('splits open->first-review and review->merge and picks the dominant stage', () => {
    const events = [
      // PR1: open 00:00, first review 08:00 (8h wait), merged 10:00 (2h review->merge)
      prOpened({ repo, pr: 1, title: 'feat: a', ts: '2026-01-01T00:00:00Z' }),
      verdict({ repo, pr: 1, verifier: 'human', verdict: 'PASS', ts: '2026-01-01T08:00:00Z' }),
      prMerged({ repo, pr: 1, title: 'feat: a', cycleHours: 10, ts: '2026-01-01T10:00:00Z' }),
      // PR2: open 00:00, first review 06:00 (6h), merged 09:00 (3h)
      prOpened({ repo, pr: 2, title: 'fix: b', ts: '2026-01-02T00:00:00Z' }),
      verdict({ repo, pr: 2, verifier: 'human', verdict: 'NOTES', notes: 1, ts: '2026-01-02T06:00:00Z' }),
      prMerged({ repo, pr: 2, title: 'fix: b', cycleHours: 9, ts: '2026-01-02T09:00:00Z' }),
    ];
    const b = stageBreakdown(events, repo);
    expect(b.nMerged).toBe(2);
    expect(b.nReviewed).toBe(2);
    expect(b.waitForReviewHrs).toBe(7);    // median(8,6)
    expect(b.reviewToMergeHrs).toBe(2.5);  // median(2,3)
    expect(b.dominant).toBe('wait-for-review');
    expect(b.unreviewedShare).toBe(0);
  });

  it('counts merged PRs with no recorded review in unreviewedShare', () => {
    const events = [
      prOpened({ repo, pr: 1, title: 'x', ts: '2026-01-01T00:00:00Z' }),
      prMerged({ repo, pr: 1, title: 'x', cycleHours: 5, ts: '2026-01-01T05:00:00Z' }),
    ];
    const b = stageBreakdown(events, repo);
    expect(b.nMerged).toBe(1);
    expect(b.nReviewed).toBe(0);
    expect(b.unreviewedShare).toBe(1);
    expect(b.dominant).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/stage-decomposition.test.ts`
Expected: FAIL — "Cannot find module '../src/inference/stage-decomposition.js'".

- [ ] **Step 3: Implement `stageBreakdown`**

Create `src/inference/stage-decomposition.ts`:

```typescript
// Cycle-time stage decomposition — split a PR's open→merge lifetime into 'open → first
// review' and 'first review → merge', so the audit can say WHERE the time goes (the
// top-bottleneck section), not just the total. Open time = PrOpened.occurredAt; first
// review = earliest VerdictRecorded.occurredAt (reviews carry their submission time);
// merge = PrMerged.occurredAt. Pure; medians (robust to the long tail the posterior
// showed). PRs with no recorded review contribute to total + unreviewedShare only.
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { ofType } from '../log.js';
import { EVENT, type PrMergedPayload, type PrOpenedPayload, type VerdictPayload } from '../events.js';

const HOUR_MS = 3.6e6;

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export interface StageBreakdown {
  repo: string;
  nMerged: number; // merged PRs that also have a recorded open event
  nReviewed: number; // of those, with ≥1 recorded review before merge
  waitForReviewHrs: number; // median open → first review (reviewed PRs)
  reviewToMergeHrs: number; // median first review → merge (reviewed PRs)
  totalHrs: number; // median open → merge (all merged PRs)
  unreviewedShare: number; // fraction of merged PRs with NO recorded review
  dominant: 'wait-for-review' | 'review-to-merge' | 'unknown';
}

export function stageBreakdown(events: DomainEventEnvelope[], repo: string): StageBreakdown {
  const openAt = new Map<number, number>();
  for (const e of ofType(events, EVENT.PR_OPENED)) {
    const p = e.payload as unknown as PrOpenedPayload;
    if (p.repo === repo) openAt.set(p.pr, Date.parse(e.occurredAt));
  }
  const mergeAt = new Map<number, number>();
  for (const e of ofType(events, EVENT.PR_MERGED)) {
    const p = e.payload as unknown as PrMergedPayload;
    if (p.repo === repo) mergeAt.set(p.pr, Date.parse(e.occurredAt));
  }
  const firstReviewAt = new Map<number, number>();
  for (const e of ofType(events, EVENT.VERDICT)) {
    const p = e.payload as unknown as VerdictPayload;
    if (p.repo !== repo || typeof p.pr !== 'number') continue;
    const t = Date.parse(e.occurredAt);
    const cur = firstReviewAt.get(p.pr);
    if (cur === undefined || t < cur) firstReviewAt.set(p.pr, t);
  }

  const totals: number[] = [];
  const waits: number[] = [];
  const reviewToMerge: number[] = [];
  for (const [pr, open] of openAt) {
    const merge = mergeAt.get(pr);
    if (merge === undefined || merge <= open) continue; // only merged PRs with a positive lifetime
    totals.push((merge - open) / HOUR_MS);
    const fr = firstReviewAt.get(pr);
    if (fr !== undefined && fr >= open && fr <= merge) {
      waits.push((fr - open) / HOUR_MS);
      reviewToMerge.push((merge - fr) / HOUR_MS);
    }
  }
  const nMerged = totals.length;
  const nReviewed = waits.length;
  const waitMed = median(waits);
  const r2mMed = median(reviewToMerge);
  return {
    repo,
    nMerged,
    nReviewed,
    waitForReviewHrs: waitMed,
    reviewToMergeHrs: r2mMed,
    totalHrs: median(totals),
    unreviewedShare: nMerged ? (nMerged - nReviewed) / nMerged : 0,
    dominant: nReviewed === 0 ? 'unknown' : waitMed >= r2mMed ? 'wait-for-review' : 'review-to-merge',
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/stage-decomposition.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/inference/stage-decomposition.ts test/stage-decomposition.test.ts
git commit -m "feat(inference): cycle-time stage decomposition (open->review->merge)

Splits PR lifetime into wait-for-review and review-to-merge medians + the
dominant stage, powering the Delivery Audit 'where does the time go' section."
```

---

## Task 4: CLI `bottlenecks` command + whatif lever help

Surfaces the new primitives to the operator. `cli.ts` is **coverage-excluded** (per `vitest.config.ts` — it is the side-effectful entry), so this task is glue verified by hand against the real private-repo log, not a unit test.

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Import `stageBreakdown`**

In `src/cli.ts`, after the existing inference imports (near line 23, by `import { reliability } from './inference/reliability.js';`) add:

```typescript
import { stageBreakdown } from './inference/stage-decomposition.js';
```

- [ ] **Step 2: Add the `bottlenecks` case**

In the `switch (cmd)` block, add a case next to `case 'posterior':` (around line 223):

```typescript
  case 'bottlenecks': {
    if (!rest[0]) { console.log('usage: bottlenecks <owner/repo>'); break; }
    const b = stageBreakdown(readEnvelopes(), rest[0]);
    console.log(`BOTTLENECKS — ${b.repo}  (${b.nMerged} merged PR(s), ${b.nReviewed} reviewed)\n`);
    console.log(`   open → first review : median ${fmtH(b.waitForReviewHrs)}`);
    console.log(`   first review → merge: median ${fmtH(b.reviewToMergeHrs)}`);
    console.log(`   total open → merge  : median ${fmtH(b.totalHrs)}`);
    console.log(`   unreviewed PRs      : ${pct(b.unreviewedShare)}`);
    console.log(`\n   dominant stage: ${b.dominant}`);
    break;
  }
```

- [ ] **Step 3: Update the `whatif` usage hint + the default usage line**

(a) In `showWhatIf` (around line 100), update the usage string to list the new levers:

```typescript
  if (!repo) { console.log('usage: whatif <owner/repo> [indicator=cycle-time|cleanliness] [by=change-type|author|model|provider|producer|skill:<name>]'); return; }
```

(b) In the final `default:` case (around line 299), add `bottlenecks` to the command list:

```typescript
  default: console.log('usage: devloop <backfill|seed|append|drain|declare-effect|observe-effect|retro|retros|reconcile|sonar-verdicts|calibration|qa-baseline|posterior|whatif|bottlenecks|reliability|snapshot|dashboard|cascade|interventions|persist-cascade|publish>'); process.exit(1);
```

- [ ] **Step 4: Verify by hand against the real private-repo log**

Run (PowerShell, from `domains/devloop`):

```powershell
$env:DEVLOOP_LOG = "data\private-validation.jsonl"
npx tsx src/cli.ts bottlenecks <org>/<repo>
npx tsx src/cli.ts whatif <org>/<repo> cycle-time change-type
Remove-Item Env:\DEVLOOP_LOG
```

Expected:
- `bottlenecks` prints non-zero medians for open→first-review and review→merge, a dominant stage, and an unreviewed-PR percentage (the spike showed 79 of 111 PRs reviewed → ~29% unreviewed).
- `whatif … change-type` now prints **feature vs fix strata** and a `✓ CONCLUSIVE` or a temporal-overlap note — **not** the old "INCONCLUSIVE … 111/111 lack attribution".

If the the private-repo log was deleted after the spike, re-create it first: `npx tsx src/cli.ts backfill <org>/<repo>` (with `GH_TOKEN`/`GITHUB_TOKEN` unset and `$env:DEVLOOP_LOG` set), then `npx tsx src/cli.ts reviews <org>/<repo>`.

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): bottlenecks command + change-type/author whatif levers in help

Surfaces the stage decomposition and external-org levers to the operator —
the Delivery Audit's descriptive bottleneck read and conclusive counterfactual."
```

---

## Final verification

- [ ] **Run the full suite + the local gate**

```bash
npx vitest run
npm run ci:local   # if defined; otherwise: npx vitest run && npm run build
```

Expected: all green. Then open a PR in `domains/devloop` (PR-gated; do not merge to main directly). Suggested PR body lines for the twin:

```
Producer: orchestrator/claude-opus-4-8 [writing-plans, subagent-driven-development]
Effect: cycle-time 0.01±0.02 expert
```

---

## Scope & Follow-on (NOT in this plan)

This plan delivers the **primitives** (gaps #1, #2). The **audit report generator** (gaps #3 narrative reframe, #4 ranked counterfactuals) is a separate plan that consumes them:

- A `audit-report` command that assembles: delivery baseline (`posterior`) + bottlenecks (`stageBreakdown`) + a ranked list of conclusive counterfactuals (run `whatIf` over every available lever × indicator, keep the conclusive ones, sort by |delta| with uncertainty) + plain-language framing.
- Reframe the cluster-centric labels ("verifier wave", "agent reliability", "findings that would otherwise have shipped") into external-buyer language ("review load/latency", "rework rate") — at the report/dashboard layer, not the engine.

Author that plan after this one lands, using the same spike log as the live fixture.
```
