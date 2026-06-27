# short-term-churn (S1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `short-term-churn` (fraction of a PR's authored lines a later PR rewrites/deletes within 14 days) to the SDLC twin as a self-observing `whatif`/`reconcile` indicator, fed by a new git-history ingester.

**Architecture:** A new `churn [repos]` CLI command runs a pure-git forward pass (`git log` + blame-on-the-deletion) over each repo's `main`, emitting one window-closed-gated `ChurnObserved` event per PR. Both the `whatif` lever engine and the `reconcile` calibration loop then read those events from the canonical log synchronously — churn is "self-observing in the same sense as cycle-time."

**Tech Stack:** TypeScript (ESM, `.js` import extensions), Node `child_process` (`execFileSync` for `git`), zod (event schemas), vitest (tests on a real temp git repo). All in `domains/devloop`.

**Spec:** `domains/devloop/docs/s1-short-term-churn-design.md` · **ADR:** `layers/specs/adr/adr-268-short-term-churn-indicator.md`

## Global Constraints

- **ESM imports use explicit `.js` extensions** (e.g. `import { ofType } from '../log.js'`).
- **Work on branch `feat-short-term-churn-s1`** in `domains/devloop` (already created; the design doc is its first commit). Never commit to `main`. Never `git add -A` at the repo root — add explicit paths.
- **Indicator id is the literal string `short-term-churn`** everywhere (whatif, reconcile, `Effect:` lines).
- **`now` is injected** into `computeChurn`/`runChurn` as `nowMs` — tests pass a fixed value; only the CLI wrapper uses `Date.now()`. Never read the clock inside the analyzer.
- **Honesty:** churn is TREND/WARN, never a gate. No code path may turn it into a merge gate.
- **Run the gate locally** (from inside `domains/devloop`): `npm run typecheck` + `npm run test` are the core gate (no `lint` script exists; `npm run ci:local` additionally runs `sonar:scan` which needs SonarQube on `localhost:9000` — optional). `npx knip` checks dead exports (`knip.json` is configured). Remote CI is billing-frozen. Never bypass pre-push hooks.
- **The canonical log** is `domains/foundry/data/events.jsonl` (devloop's `DEFAULT_LOG`). Tests use a temp log path, never the canonical one.

## File Structure

- **Create** `src/ingest/churn.ts` — the analyzer (pure helpers + git-touching functions + `runChurn` orchestration).
- **Modify** `src/events.ts` — add `EVENT.CHURN_OBSERVED`, the `ChurnObserved` schema, `ChurnObservedPayload`, the `churnObserved` constructor.
- **Modify** `src/inference/whatif.ts` — extend `IndicatorDef` (`weight?`, `fitWeighted?`), register `short-term-churn`, teach the accumulator to carry weights.
- **Modify** `src/ingest/observe.ts` — register `OBSERVERS['short-term-churn']`.
- **Modify** `src/cli.ts` — wire the `churn [repos]` command + usage string.
- **Create** `test/helpers/temp-git.ts` — temp-git-repo fixture helper.
- **Create** `test/churn-event.test.ts`, `test/churn.test.ts` — event + analyzer tests.
- **Modify** `test/whatif.test.ts`, `test/observe.test.ts` — indicator + observer tests (or create `test/churn-indicator.test.ts` if those files don't exist; check first).

---

### Task 1: `ChurnObserved` event

**Files:**
- Modify: `src/events.ts`
- Test: `test/churn-event.test.ts` (create)

**Interfaces:**
- Produces: `EVENT.CHURN_OBSERVED: 'devloop:ChurnObserved.v1'`; `type ChurnObservedPayload = { repo: string; pr: number; mergedAt: string; authored: number; churned: number; ratio: number; windowDays: number; windowClosed: true; rewrittenBy: number[] }`; `churnObserved(i: z.input<typeof ChurnObserved> & { ts: string }) => DomainEventEnvelope`.

- [ ] **Step 1: Write the failing test**

```ts
// test/churn-event.test.ts
import { describe, it, expect } from 'vitest';
import { DomainEventEnvelopeSchema } from '@de-braighter/substrate-contracts/events';
import { churnObserved, EVENT, type ChurnObservedPayload } from '../src/events.js';
import { prAggregateId, DEVLOOP_TENANT_PACK_ID } from '../src/scope.js';

const TS = '2026-06-20T12:00:00.000Z';

describe('ChurnObserved event', () => {
  it('builds a valid envelope with the churn payload', () => {
    const env = churnObserved({
      repo: 'de-braighter/devloop', pr: 42, mergedAt: '2026-06-01T00:00:00.000Z',
      authored: 10, churned: 4, ratio: 0.4, rewrittenBy: [43, 44], ts: TS,
    });
    expect(() => DomainEventEnvelopeSchema.parse(env)).not.toThrow();
    expect(env.eventType).toBe(EVENT.CHURN_OBSERVED);
    expect(env.tenantPackId).toBe(DEVLOOP_TENANT_PACK_ID);
    expect(env.aggregateId).toBe(prAggregateId('de-braighter/devloop', 42));
    const p = env.payload as unknown as ChurnObservedPayload;
    expect(p.ratio).toBe(0.4);
    expect(p.windowDays).toBe(14);
    expect(p.windowClosed).toBe(true);
    expect(p.rewrittenBy).toEqual([43, 44]);
  });

  it('defaults windowDays to 14 and rewrittenBy to []', () => {
    const env = churnObserved({ repo: 'r', pr: 1, mergedAt: TS, authored: 5, churned: 0, ratio: 0, ts: TS });
    const p = env.payload as unknown as ChurnObservedPayload;
    expect(p.windowDays).toBe(14);
    expect(p.rewrittenBy).toEqual([]);
  });

  it('rejects churned > authored', () => {
    expect(() => churnObserved({ repo: 'r', pr: 1, mergedAt: TS, authored: 3, churned: 5, ratio: 1, ts: TS })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/churn-event.test.ts`
Expected: FAIL — `churnObserved` / `EVENT.CHURN_OBSERVED` not exported.

- [ ] **Step 3: Add the event to `src/events.ts`**

Add `CHURN_OBSERVED: 'devloop:ChurnObserved.v1',` to the `EVENT` object (after `RESOLUTION`).

Add the schema + type near the other payload schemas (after `FindingResolved`):

```ts
// A measured short-term-churn observation for one merged PR (window CLOSED = final). The
// ingester (src/ingest/churn.ts) computes it from git history; whatif + reconcile read it back.
// rewrittenBy = the later PRs (same repo) that rewrote/deleted this PR's lines — the S3 linkage;
// producer is DERIVED at query-time by joining to ProducerAttributed (store generators).
const ChurnObserved = z
  .object({
    repo: z.string(),
    pr: z.number().int(),
    mergedAt: z.string(),
    authored: z.number().int().nonnegative(),
    churned: z.number().int().nonnegative(),
    ratio: z.number().min(0).max(1),
    windowDays: z.number().int().positive().default(14),
    windowClosed: z.literal(true).default(true),
    rewrittenBy: z.array(z.number().int()).default([]),
  })
  .refine((v) => v.churned <= v.authored, { message: 'churned cannot exceed authored' });
export type ChurnObservedPayload = z.infer<typeof ChurnObserved>;
```

Add the constructor near the other constructors (after `findingResolved`):

```ts
export const churnObserved = (i: z.input<typeof ChurnObserved> & { ts: string }) =>
  envelope(EVENT.CHURN_OBSERVED, i.repo, i.pr, i.ts, ChurnObserved.parse(i), 'devloop:ingest');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/churn-event.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git -C domains/devloop add src/events.ts test/churn-event.test.ts
git -C domains/devloop commit -m "feat(devloop): ChurnObserved event (S1 short-term-churn)"
```

---

### Task 2: pure git-text helpers in `churn.ts`

**Files:**
- Create: `src/ingest/churn.ts`
- Test: `test/churn.test.ts` (create)

**Interfaces:**
- Produces: `parsePrNumber(subject: string): number | undefined`; `isExcluded(path: string): boolean`; `type NumstatRow = { added: number; deleted: number; path: string }`; `parseNumstat(out: string): NumstatRow[]`; `authoredCount(rows: NumstatRow[]): number`; `type Deletion = { file: string; preLine: number }`; `parseDeletions(unifiedDiff: string): Deletion[]`.

- [ ] **Step 1: Write the failing test**

```ts
// test/churn.test.ts
import { describe, it, expect } from 'vitest';
import { parsePrNumber, isExcluded, parseNumstat, authoredCount, parseDeletions } from '../src/ingest/churn.js';

describe('churn pure helpers', () => {
  it('parsePrNumber reads the (#N) suffix', () => {
    expect(parsePrNumber('feat: thing (#123)')).toBe(123);
    expect(parsePrNumber('chore: no pr here')).toBeUndefined();
    expect(parsePrNumber('fix (#5) mid-subject (#9)')).toBe(9); // trailing wins
  });

  it('isExcluded matches lockfiles / *.lock / dist, NOT test files', () => {
    expect(isExcluded('package-lock.json')).toBe(true);
    expect(isExcluded('domains/x/package-lock.json')).toBe(true);
    expect(isExcluded('pnpm-lock.yaml')).toBe(false); // not in the spec set
    expect(isExcluded('foo.lock')).toBe(true);
    expect(isExcluded('dist/main.js')).toBe(true);
    expect(isExcluded('src/a.spec.ts')).toBe(false); // tests COUNT
    expect(isExcluded('src/a.ts')).toBe(false);
  });

  it('parseNumstat + authoredCount sum added lines over non-excluded paths', () => {
    const rows = parseNumstat('10\t2\tsrc/a.ts\n5\t0\tpackage-lock.json\n-\t-\timg.png\n');
    expect(rows).toEqual([
      { added: 10, deleted: 2, path: 'src/a.ts' },
      { added: 5, deleted: 0, path: 'package-lock.json' },
      { added: 0, deleted: 0, path: 'img.png' },
    ]);
    expect(authoredCount(rows)).toBe(10); // package-lock excluded, binary 0
  });

  it('parseDeletions reads preimage line numbers from unified=0 hunk headers', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,4 +0,0 @@',
      '-line0', '-line1', '-line2', '-line3',
      '@@ -10 +6,2 @@',
      '-old', '+new1', '+new2',
    ].join('\n');
    expect(parseDeletions(diff)).toEqual([
      { file: 'src/a.ts', preLine: 1 }, { file: 'src/a.ts', preLine: 2 },
      { file: 'src/a.ts', preLine: 3 }, { file: 'src/a.ts', preLine: 4 },
      { file: 'src/a.ts', preLine: 10 },
    ]);
  });

  it('parseDeletions skips added (/dev/null preimage) files', () => {
    const diff = ['--- /dev/null', '+++ b/new.ts', '@@ -0,0 +1,3 @@', '+a', '+b', '+c'].join('\n');
    expect(parseDeletions(diff)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/churn.test.ts`
Expected: FAIL — module `../src/ingest/churn.js` not found.

- [ ] **Step 3: Create `src/ingest/churn.ts` with the pure helpers**

```ts
// short-term-churn (S1) — a git-history ingester. PURE git: reads `main`'s committed
// history + blame, never the working tree, never the event log. Emits ChurnObserved events
// that whatif + reconcile read back. See docs/s1-short-term-churn-design.md / ADR-268.

/** PR number from a squash-commit subject's trailing `(#N)`, or undefined. Matches the
 *  cluster convention (same regex as github.ts attributeFromCommits). */
export function parsePrNumber(subject: string): number | undefined {
  const m = /\(#(\d+)\)\s*$/.exec(subject);
  return m ? Number(m[1]) : undefined;
}

/** Generated / non-authored paths excluded from churn (both numerator + denominator).
 *  Test files are deliberately NOT excluded — test churn is real rework signal. */
export function isExcluded(path: string): boolean {
  const base = path.split('/').pop() ?? path;
  return base === 'package-lock.json' || base.endsWith('.lock') || path.split('/').includes('dist');
}

export interface NumstatRow { added: number; deleted: number; path: string }

/** Parse `git show --numstat --format=` output. Binary files show `-` for added/deleted. */
export function parseNumstat(out: string): NumstatRow[] {
  const rows: NumstatRow[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [a, d, ...rest] = parts;
    rows.push({ added: a === '-' ? 0 : Number(a), deleted: d === '-' ? 0 : Number(d), path: rest.join('\t') });
  }
  return rows;
}

/** Added lines over non-excluded paths = a PR's `authored` count. */
export function authoredCount(rows: NumstatRow[]): number {
  return rows.reduce((s, r) => (isExcluded(r.path) ? s : s + r.added), 0);
}

export interface Deletion { file: string; preLine: number }

/** Parse `git show --unified=0 --format=` into the preimage line numbers it deletes.
 *  At unified=0 a hunk header `@@ -a,b +c,d @@` removes b lines starting at preimage line a. */
export function parseDeletions(unifiedDiff: string): Deletion[] {
  const out: Deletion[] = [];
  let file: string | undefined;
  for (const line of unifiedDiff.split('\n')) {
    if (line.startsWith('--- ')) {
      file = line === '--- /dev/null' ? undefined : line.slice(6); // strip "--- a/"
      continue;
    }
    if (file && line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,(\d+))? \+/.exec(line);
      if (!m) continue;
      const a = Number(m[1]);
      const b = m[2] === undefined ? 1 : Number(m[2]);
      for (let i = 0; i < b; i++) out.push({ file, preLine: a + i });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/churn.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git -C domains/devloop add src/ingest/churn.ts test/churn.test.ts
git -C domains/devloop commit -m "feat(devloop): churn pure git-text helpers (parse/exclude/numstat/deletions)"
```

---

### Task 3: temp-git fixture + commit lister

**Files:**
- Create: `test/helpers/temp-git.ts`
- Modify: `src/ingest/churn.ts`
- Test: `test/churn.test.ts` (add a describe block)

**Interfaces:**
- Produces (helper): `initRepo(): string`; `commitAt(dir: string, iso: string, files: Record<string,string>, message: string): void`; `cleanup(dir: string): void`.
- Produces (churn): `runGit(cwd: string, args: string[]): string`; `type MainCommit = { sha: string; dateMs: number; subject: string; pr?: number }`; `listMainCommits(cwd: string, mainRef?: string): MainCommit[]`.

- [ ] **Step 1: Write the temp-git helper**

```ts
// test/helpers/temp-git.ts — a throwaway git repo with controlled commit timestamps.
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

export function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'churn-'));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 't@t.dev'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

/** Write files (overwriting), then commit them at a fixed author+committer date. */
export function commitAt(dir: string, iso: string, files: Record<string, string>, message: string): void {
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], {
    cwd: dir,
    env: { ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso },
  });
}

export function cleanup(dir: string): void { rmSync(dir, { recursive: true, force: true }); }
```

- [ ] **Step 2: Write the failing test**

```ts
// append to test/churn.test.ts
import { afterEach, beforeEach } from 'vitest';
import { initRepo, commitAt, cleanup } from './helpers/temp-git.js';
import { listMainCommits } from '../src/ingest/churn.js';

describe('listMainCommits', () => {
  let dir: string;
  beforeEach(() => { dir = initRepo(); });
  afterEach(() => cleanup(dir));

  it('lists main commits with parsed PR numbers and ms dates', () => {
    commitAt(dir, '2026-01-01T00:00:00Z', { 'a.ts': 'x\n' }, 'feat: a (#1)');
    commitAt(dir, '2026-01-02T00:00:00Z', { 'b.ts': 'y\n' }, 'chore: no-pr commit');
    const commits = listMainCommits(dir);
    expect(commits).toHaveLength(2);
    const byPr = commits.map((c) => c.pr);
    expect(byPr).toContain(1);
    expect(byPr).toContain(undefined);
    const a = commits.find((c) => c.pr === 1)!;
    expect(a.dateMs).toBe(Date.parse('2026-01-01T00:00:00Z'));
    expect(a.sha).toMatch(/^[0-9a-f]{40}$/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/churn.test.ts`
Expected: FAIL — `listMainCommits` / `runGit` not exported.

- [ ] **Step 4: Add `runGit` + `listMainCommits` to `src/ingest/churn.ts`**

Add at the top (after the file comment):

```ts
import { execFileSync } from 'node:child_process';
```

Add:

```ts
/** Run git in a repo, returning stdout. Throws if git fails (caller decides skip vs fail). */
export function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

export interface MainCommit { sha: string; dateMs: number; subject: string; pr?: number }

/** Squash commits on `mainRef`'s first-parent line, newest first. Reads committed history
 *  only (ref + objects) — independent of the working-tree checkout state. */
export function listMainCommits(cwd: string, mainRef = 'main'): MainCommit[] {
  const out = runGit(cwd, ['log', '--first-parent', '--no-merges', mainRef, '--pretty=format:%H%x1f%cI%x1f%s']);
  const commits: MainCommit[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const [sha, iso, subject = ''] = line.split('\x1f');
    commits.push({ sha: sha!, dateMs: Date.parse(iso!), subject, pr: parsePrNumber(subject) });
  }
  return commits;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/churn.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git -C domains/devloop add src/ingest/churn.ts test/helpers/temp-git.ts test/churn.test.ts
git -C domains/devloop commit -m "feat(devloop): temp-git fixture + listMainCommits"
```

---

### Task 4: blame origin map

**Files:**
- Modify: `src/ingest/churn.ts`
- Test: `test/churn.test.ts` (add a describe block)

**Interfaces:**
- Produces: `blameOriginMap(cwd: string, sha: string, file: string): Map<number, string>` — maps each preimage line number in `sha^` to the 40-hex sha that authored it.

- [ ] **Step 1: Write the failing test**

```ts
// append to test/churn.test.ts
import { blameOriginMap, listMainCommits as listCommits2 } from '../src/ingest/churn.js';

describe('blameOriginMap', () => {
  let dir: string;
  beforeEach(() => { dir = initRepo(); });
  afterEach(() => cleanup(dir));

  it('attributes a deleted line to its true origin across an intervening edit', () => {
    // A adds X; B inserts a line ABOVE X (shifts it); C will delete X.
    commitAt(dir, '2026-01-01T00:00:00Z', { 'a.ts': 'X\n' }, 'feat: a (#1)');
    commitAt(dir, '2026-01-02T00:00:00Z', { 'a.ts': 'ABOVE\nX\n' }, 'feat: b (#2)');
    commitAt(dir, '2026-01-03T00:00:00Z', { 'a.ts': 'ABOVE\n' }, 'fix: c (#3)'); // deletes X (now line 2)
    const commits = listCommits2(dir);
    const c = commits.find((k) => k.pr === 3)!;
    const a = commits.find((k) => k.pr === 1)!;
    const map = blameOriginMap(dir, c.sha, 'a.ts'); // blames c^ (the B revision: ABOVE\nX)
    expect(map.get(2)).toBe(a.sha); // line 2 ('X') originated in A, not B
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/churn.test.ts`
Expected: FAIL — `blameOriginMap` not exported.

- [ ] **Step 3: Add `blameOriginMap` to `src/ingest/churn.ts`**

```ts
/** Blame `sha^`'s version of `file`: map each line number (in sha^) to the commit that
 *  authored it. Porcelain header lines are `<40-hex> <srcLine> <resultLine> [groupSize]`;
 *  resultLine is the line number in the blamed revision. */
export function blameOriginMap(cwd: string, sha: string, file: string): Map<number, string> {
  const out = runGit(cwd, ['blame', `${sha}^`, '--porcelain', '--', file]);
  const map = new Map<number, string>();
  for (const line of out.split('\n')) {
    const m = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line);
    if (m) map.set(Number(m[2]), m[1]!);
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/churn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C domains/devloop add src/ingest/churn.ts test/churn.test.ts
git -C domains/devloop commit -m "feat(devloop): blameOriginMap — attribute a deleted line to its true origin"
```

---

### Task 5: `computeChurn` — the forward pass (the core acid)

**Files:**
- Modify: `src/ingest/churn.ts`
- Test: `test/churn.test.ts` (add a describe block)

**Interfaces:**
- Produces: `type ChurnRow = { pr: number; mergedAtMs: number; authored: number; churned: number; ratio: number; rewrittenBy: number[] }`; `computeChurn(cwd: string, nowMs: number, opts?: { windowDays?: number; mainRef?: string }): ChurnRow[]` — rows for PR-tagged, window-CLOSED commits with `authored > 0`.

- [ ] **Step 1: Write the failing tests (the biting acids)**

```ts
// append to test/churn.test.ts
import { computeChurn } from '../src/ingest/churn.js';

const DAY = 24 * 60 * 60 * 1000;
const lines = (n: number, start = 0) => Array.from({ length: n }, (_, i) => `line${i + start}`).join('\n') + '\n';

describe('computeChurn', () => {
  let dir: string;
  beforeEach(() => { dir = initRepo(); });
  afterEach(() => cleanup(dir));

  it('basic: 4 of 10 lines deleted within window => ratio 0.4, rewrittenBy [2]', () => {
    commitAt(dir, '2026-01-01T00:00:00Z', { 'a.ts': lines(10) }, 'feat: a (#1)');
    commitAt(dir, '2026-01-04T00:00:00Z', { 'a.ts': lines(6, 4) }, 'fix: trim (#2)'); // drops line0..3
    const rows = computeChurn(dir, Date.parse('2026-03-01T00:00:00Z'));
    const a = rows.find((r) => r.pr === 1)!;
    expect(a.authored).toBe(10);
    expect(a.churned).toBe(4);
    expect(a.ratio).toBeCloseTo(0.4);
    expect(a.rewrittenBy).toEqual([2]);
  });

  it('window boundary: a deletion at exactly +14d counts; +14d+1s does not', () => {
    commitAt(dir, '2026-01-01T00:00:00Z', { 'a.ts': lines(4) }, 'feat: a (#1)'); // 4 lines
    commitAt(dir, '2026-01-15T00:00:00Z', { 'a.ts': lines(3, 1) }, 'fix: b (#2)'); // exactly +14d, drops line0
    const within = computeChurn(dir, Date.parse('2026-03-01T00:00:00Z')).find((r) => r.pr === 1)!;
    expect(within.churned).toBe(1);

    const dir2 = initRepo();
    commitAt(dir2, '2026-01-01T00:00:00Z', { 'a.ts': lines(4) }, 'feat: a (#1)');
    commitAt(dir2, '2026-01-15T00:00:01Z', { 'a.ts': lines(3, 1) }, 'fix: b (#2)'); // +14d+1s
    const outside = computeChurn(dir2, Date.parse('2026-03-01T00:00:00Z')).find((r) => r.pr === 1)!;
    expect(outside.churned).toBe(0);
    cleanup(dir2);
  });

  it('window-open skip: a PR whose 14d window has not closed yields no row', () => {
    commitAt(dir, '2026-01-01T00:00:00Z', { 'a.ts': lines(4) }, 'feat: a (#1)');
    const rows = computeChurn(dir, Date.parse('2026-01-10T00:00:00Z')); // only +9d
    expect(rows.find((r) => r.pr === 1)).toBeUndefined();
  });

  it('excludes lockfiles from authored + churn; counts test files', () => {
    commitAt(dir, '2026-01-01T00:00:00Z',
      { 'a.ts': lines(10), 'a.spec.ts': lines(4), 'package-lock.json': lines(20) }, 'feat: a (#1)');
    commitAt(dir, '2026-01-03T00:00:00Z',
      { 'a.ts': lines(8, 2), 'package-lock.json': lines(5) }, 'fix: b (#2)'); // drops 2 a.ts + 15 lock lines
    const a = computeChurn(dir, Date.parse('2026-03-01T00:00:00Z')).find((r) => r.pr === 1)!;
    expect(a.authored).toBe(14); // 10 a.ts + 4 a.spec.ts; lockfile excluded
    expect(a.churned).toBe(2);   // only the 2 a.ts deletions; lockfile churn ignored
  });

  it('authored=0 (lockfile-only PR) yields no row', () => {
    commitAt(dir, '2026-01-01T00:00:00Z', { 'package-lock.json': lines(5) }, 'chore: deps (#1)');
    const rows = computeChurn(dir, Date.parse('2026-03-01T00:00:00Z'));
    expect(rows.find((r) => r.pr === 1)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/churn.test.ts`
Expected: FAIL — `computeChurn` not exported.

- [ ] **Step 3: Add `computeChurn` to `src/ingest/churn.ts`**

```ts
export interface ChurnRow { pr: number; mergedAtMs: number; authored: number; churned: number; ratio: number; rewrittenBy: number[] }

/** One forward pass over `main`: accumulate each PR's authored lines + the churn against it
 *  (lines a later commit deletes within the window, blamed back to their true origin). Returns
 *  rows for PR-tagged commits whose window has CLOSED (now − merged ≥ windowDays) and authored > 0. */
export function computeChurn(cwd: string, nowMs: number, opts: { windowDays?: number; mainRef?: string } = {}): ChurnRow[] {
  const windowMs = (opts.windowDays ?? 14) * 24 * 60 * 60 * 1000;
  const commits = listMainCommits(cwd, opts.mainRef ?? 'main');
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const authored = new Map<string, number>();
  const churned = new Map<string, number>();
  const rewrittenBy = new Map<string, Set<number>>();

  for (const b of commits) {
    authored.set(b.sha, authoredCount(parseNumstat(runGit(cwd, ['show', b.sha, '--numstat', '--format=', '--first-parent']))));
    const dels = parseDeletions(runGit(cwd, ['show', b.sha, '--unified=0', '--format=', '--first-parent']));
    const byFile = new Map<string, number[]>();
    for (const d of dels) {
      if (isExcluded(d.file)) continue;
      const arr = byFile.get(d.file) ?? [];
      arr.push(d.preLine);
      byFile.set(d.file, arr);
    }
    for (const [file, preLines] of byFile) {
      let blame: Map<number, string>;
      try { blame = blameOriginMap(cwd, b.sha, file); } catch { continue; } // file new in b => no preimage
      for (const pl of preLines) {
        const originSha = blame.get(pl);
        if (!originSha) continue;
        const o = bySha.get(originSha);
        if (!o) continue;                       // origin not a tracked main commit (pre-policy etc.)
        if (b.dateMs <= o.dateMs) continue;     // only later deletions
        if (b.dateMs - o.dateMs > windowMs) continue; // outside the window
        churned.set(originSha, (churned.get(originSha) ?? 0) + 1);
        if (b.pr !== undefined) {
          const s = rewrittenBy.get(originSha) ?? new Set<number>();
          s.add(b.pr);
          rewrittenBy.set(originSha, s);
        }
      }
    }
  }

  const rows: ChurnRow[] = [];
  for (const c of commits) {
    if (c.pr === undefined) continue;
    if (nowMs - c.dateMs < windowMs) continue;  // window still open
    const a = authored.get(c.sha) ?? 0;
    if (a <= 0) continue;
    const ch = churned.get(c.sha) ?? 0;
    rows.push({ pr: c.pr, mergedAtMs: c.dateMs, authored: a, churned: ch, ratio: ch / a, rewrittenBy: [...(rewrittenBy.get(c.sha) ?? [])].sort((x, y) => x - y) });
  }
  return rows;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/churn.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git -C domains/devloop add src/ingest/churn.ts test/churn.test.ts
git -C domains/devloop commit -m "feat(devloop): computeChurn forward pass (window-gated, blame-attributed)"
```

---

### Task 6: `runChurn` — emit events idempotently

**Files:**
- Modify: `src/ingest/churn.ts`
- Test: `test/churn.test.ts` (add a describe block)

**Interfaces:**
- Consumes: `churnObserved` (Task 1); `append`, `appendUnique`, `readEnvelopes`, `dedupKey` from `../log.js`.
- Produces: `runChurn(repos: { repo: string; dir: string }[], logPath: string, nowMs: number): number` — appends new `ChurnObserved` events, returns the count appended.

- [ ] **Step 1: Write the failing test**

```ts
// append to test/churn.test.ts
import { runChurn } from '../src/ingest/churn.js';
import { readEnvelopes, ofType } from '../src/log.js';
import { EVENT, type ChurnObservedPayload } from '../src/events.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('runChurn', () => {
  let dir: string; let logPath: string;
  beforeEach(() => {
    dir = initRepo();
    logPath = join(mkdtempSync(join(tmpdir(), 'churnlog-')), 'events.jsonl');
  });
  afterEach(() => cleanup(dir));

  it('emits ChurnObserved events and is idempotent on a second run', () => {
    commitAt(dir, '2026-01-01T00:00:00Z', { 'a.ts': lines(10) }, 'feat: a (#1)');
    commitAt(dir, '2026-01-04T00:00:00Z', { 'a.ts': lines(6, 4) }, 'fix: b (#2)');
    const now = Date.parse('2026-03-01T00:00:00Z');
    const repos = [{ repo: 'de-braighter/devloop', dir }];

    const n1 = runChurn(repos, logPath, now);
    expect(n1).toBe(1); // only #1 has authored>0 (#2 is delete-only)
    const events = ofType(readEnvelopes(logPath), EVENT.CHURN_OBSERVED);
    expect(events).toHaveLength(1);
    const p = events[0]!.payload as unknown as ChurnObservedPayload;
    expect(p).toMatchObject({ repo: 'de-braighter/devloop', pr: 1, authored: 10, churned: 4, windowClosed: true });

    const n2 = runChurn(repos, logPath, now); // re-run
    expect(n2).toBe(0); // idempotent
    expect(ofType(readEnvelopes(logPath), EVENT.CHURN_OBSERVED)).toHaveLength(1);
  });

  it('skips a repo with no `main` (not a git repo) without throwing', () => {
    const empty = mkdtempSync(join(tmpdir(), 'nogit-'));
    const n = runChurn([{ repo: 'de-braighter/x', dir: empty }], logPath, Date.now());
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/churn.test.ts`
Expected: FAIL — `runChurn` not exported.

- [ ] **Step 3: Add `runChurn` to `src/ingest/churn.ts`**

Add imports at the top:

```ts
import { appendUnique, readEnvelopes, dedupKey } from '../log.js';
import { churnObserved } from '../events.js';
```

Add:

```ts
/** Compute churn for each repo and append new (window-closed) ChurnObserved events to the log.
 *  Idempotent: dedup is by event content (payload), so a re-run adds only newly-closed windows.
 *  A repo with no `main` / not a git repo is skipped, never fatal. */
export function runChurn(repos: { repo: string; dir: string }[], logPath: string, nowMs: number): number {
  const seen = new Set(readEnvelopes(logPath).map(dedupKey));
  const ts = new Date(nowMs).toISOString();
  let n = 0;
  for (const { repo, dir } of repos) {
    let rows: ChurnRow[];
    try { rows = computeChurn(dir, nowMs); } catch { continue; }
    for (const r of rows) {
      const env = churnObserved({
        repo, pr: r.pr, mergedAt: new Date(r.mergedAtMs).toISOString(),
        authored: r.authored, churned: r.churned, ratio: r.ratio, rewrittenBy: r.rewrittenBy, ts,
      });
      if (appendUnique(env, seen, logPath)) n++;
    }
  }
  return n;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/churn.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C domains/devloop add src/ingest/churn.ts test/churn.test.ts
git -C domains/devloop commit -m "feat(devloop): runChurn — idempotent ChurnObserved emission"
```

---

### Task 7: `whatif` line-weighted `short-term-churn` indicator

**Files:**
- Modify: `src/inference/whatif.ts`
- Test: `test/churn-indicator.test.ts` (create)

**Interfaces:**
- Consumes: `EVENT.CHURN_OBSERVED`, `ChurnObservedPayload` (Task 1); `betaPosterior` from `./reliability.js`.
- Produces: `INDICATORS['short-term-churn']`; extended `IndicatorDef` with optional `weight?(events, repo): Map<number, number>` and `fitWeighted?(pairs: [number, number][]): Posterior`.

- [ ] **Step 1: Write the failing test**

```ts
// test/churn-indicator.test.ts
import { describe, it, expect } from 'vitest';
import { whatIf } from '../src/inference/whatif.js';
import { churnObserved, producer } from '../src/events.js';

const TS = '2026-06-20T00:00:00.000Z';
const repo = 'de-braighter/devloop';
// helper: a PR with a churn ratio realised by `authored`/`churned`, attributed to a model.
const churn = (pr: number, authored: number, churnedN: number) =>
  churnObserved({ repo, pr, mergedAt: TS, authored, churned: churnedN, ratio: churnedN / authored, ts: TS });
const prod = (pr: number, model: string) => producer({ repo, pr, producer: 'orchestrator', model, ts: TS });

describe('whatif short-term-churn (line-weighted)', () => {
  it('line-weights so a 1-line fully-churned PR does not dominate a big clean PR', () => {
    // model A: a 100-line PR with 5 churned (5%) + a 1-line PR fully churned (100%).
    // PR-weighted mean would be ~52%; line-weighted is 6/101 ≈ 6%.
    const events = [
      prod(1, 'claude-opus-4-8'), churn(1, 100, 5),
      prod(2, 'claude-opus-4-8'), churn(2, 1, 1),
      prod(3, 'claude-opus-4-8'), churn(3, 100, 6),
      prod(4, 'claude-opus-4-8'), churn(4, 100, 0),
      prod(5, 'claude-opus-4-8'), churn(5, 100, 0),
      // model B: 6 PRs, uniformly ~20% churn
      ...[6, 7, 8, 9, 10, 11].flatMap((pr) => [prod(pr, 'claude-sonnet-4-6'), churn(pr, 50, 10)]),
    ];
    const w = whatIf(events, { repo, indicator: 'short-term-churn', by: 'model' });
    expect(w.unit).toBe('probability');
    expect(w.higherIsBetter).toBe(false);
    const opus = w.strata.find((s) => s.value === 'claude-opus-4-8')!;
    expect(opus.point).toBeLessThan(0.12); // line-weighted ≈ 11/401, NOT the ~40% PR-weighted mean
    const sonnet = w.strata.find((s) => s.value === 'claude-sonnet-4-6')!;
    expect(sonnet.point).toBeCloseTo(10 / 50, 1); // ≈ 0.2
  });

  it('excludes a thin stratum (<5 PRs)', () => {
    const events = [
      ...[1, 2, 3, 4, 5].flatMap((pr) => [prod(pr, 'claude-opus-4-8'), churn(pr, 10, 1)]),
      prod(6, 'claude-sonnet-4-6'), churn(6, 10, 1), // lone sonnet PR
    ];
    const w = whatIf(events, { repo, indicator: 'short-term-churn', by: 'model' });
    expect(w.strata.map((s) => s.value)).toEqual(['claude-opus-4-8']);
    expect(w.warnings.some((x) => x.includes('too thin'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/churn-indicator.test.ts`
Expected: FAIL — indicator `short-term-churn` not supported.

- [ ] **Step 3: Extend `IndicatorDef` + accumulator + register the indicator in `src/inference/whatif.ts`**

Add imports (top of file):

```ts
import { EVENT, /* …existing… */ type ChurnObservedPayload } from '../events.js';
import { betaPosterior } from './reliability.js';
```
(Merge `type ChurnObservedPayload` into the existing `../events.js` import; `betaPosterior` is a new import line.)

Extend the `IndicatorDef` interface (add two optional members):

```ts
interface IndicatorDef {
  unit: 'hours' | 'probability' | 'count';
  higherIsBetter: boolean;
  observe(events: DomainEventEnvelope[], repo: string): Map<number, number>;
  /** per-PR weight (e.g. authored lines) for a line-weighted fit; absent ⇒ unweighted. */
  weight?(events: DomainEventEnvelope[], repo: string): Map<number, number>;
  fit(values: number[]): Posterior;
  /** line-weighted fit over [value, weight] pairs; preferred over `fit` when present. */
  fitWeighted?(pairs: [number, number][]): Posterior;
}
```

Register the indicator inside `INDICATORS` (after `findings`):

```ts
  'short-term-churn': {
    unit: 'probability',
    higherIsBetter: false,
    observe: (events, repo) => {
      const m = new Map<number, number>();
      for (const e of ofType(events, EVENT.CHURN_OBSERVED)) {
        const p = e.payload as unknown as ChurnObservedPayload;
        if (p.repo === repo) m.set(p.pr, p.ratio);
      }
      return m;
    },
    weight: (events, repo) => {
      const m = new Map<number, number>();
      for (const e of ofType(events, EVENT.CHURN_OBSERVED)) {
        const p = e.payload as unknown as ChurnObservedPayload;
        if (p.repo === repo) m.set(p.pr, p.authored);
      }
      return m;
    },
    // unweighted fallback (PR-weighted) — never used while fitWeighted is present.
    fit: (v) => { let s = 0, f = 0; for (const r of v) { s += r; f += 1 - r; } const b = betaPosterior(s, f); return { point: b.mean, p10: b.p10, p90: b.p90 }; },
    // line-weighted: Beta(Σ churned, Σ (authored − churned)) — the benchmark's Σchurned/Σauthored.
    fitWeighted: (pairs) => {
      let succ = 0, fail = 0;
      for (const [ratio, authored] of pairs) { const c = Math.round(ratio * authored); succ += c; fail += authored - c; }
      const b = betaPosterior(succ, fail);
      return { point: b.mean, p10: b.p10, p90: b.p90 };
    },
  },
```

Teach the accumulator to carry weights. Replace the `acc` declaration + population loop + the per-stratum fit:

```ts
  const weightMap = ind.weight?.(events, repo);
  const acc = new Map<string, { vals: number[]; weights: number[]; first: string; last: string }>();
  let placed = 0;
  for (const [pr, value] of obs) {
    const v = lever.get(pr);
    if (v === undefined) continue;
    placed++;
    const at = prTime.get(pr) ?? '';
    let g = acc.get(v);
    if (!g) { g = { vals: [], weights: [], first: at, last: at }; acc.set(v, g); }
    g.vals.push(value);
    g.weights.push(weightMap?.get(pr) ?? 1);
    if (at && at < g.first) g.first = at;
    if (at > g.last) g.last = at;
  }
```

And in the strata-building loop, replace the `fit` call:

```ts
    const f = ind.fitWeighted ? ind.fitWeighted(g.vals.map((v, i) => [v, g.weights[i]!])) : ind.fit(g.vals);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/churn-indicator.test.ts test/whatif.test.ts`
Expected: PASS (new tests pass; existing whatif tests still pass — the accumulator change is backward-compatible because `weight` is absent for other indicators so weights default to 1 and `fitWeighted` is absent so `fit` is used).

- [ ] **Step 5: Commit**

```bash
git -C domains/devloop add src/inference/whatif.ts test/churn-indicator.test.ts
git -C domains/devloop commit -m "feat(devloop): whatif short-term-churn indicator (line-weighted Beta)"
```

---

### Task 8: `reconcile` observer for `short-term-churn`

**Files:**
- Modify: `src/ingest/observe.ts`
- Test: `test/observe.test.ts` (add tests; check the file exists — if not, create it following the events.test.ts style)

**Interfaces:**
- Consumes: `EVENT.CHURN_OBSERVED`, `ChurnObservedPayload`.
- Produces: `OBSERVERS['short-term-churn']` — reads the PR's `ChurnObserved.ratio`, else `undefined` (→ `deferred`).

- [ ] **Step 1: Write the failing test**

```ts
// test/observe.test.ts (add)
import { describe, it, expect } from 'vitest';
import { reconcileObservations } from '../src/ingest/observe.js';
import { effectDeclared, churnObserved, EVENT, type EffectObservedPayload } from '../src/events.js';
import { ofType } from '../src/log.js';

const TS = '2026-06-20T00:00:00.000Z';
const repo = 'de-braighter/devloop';

describe('reconcile short-term-churn observer', () => {
  it('observes the declared churn from a ChurnObserved event', async () => {
    const events = [
      effectDeclared({ repo, pr: 7, indicatorId: 'short-term-churn', predicted: 0.05, sd: 0.03, ts: TS }),
      churnObserved({ repo, pr: 7, mergedAt: TS, authored: 20, churned: 1, ratio: 0.05, ts: TS }),
    ];
    const { observed, deferred } = await reconcileObservations(events, TS);
    expect(observed).toHaveLength(1);
    const p = observed[0]!.payload as unknown as EffectObservedPayload;
    expect(p).toMatchObject({ repo, pr: 7, indicatorId: 'short-term-churn', observed: 0.05 });
    expect(deferred).toHaveLength(0);
  });

  it('defers when the churn window has not closed (no ChurnObserved yet)', async () => {
    const events = [effectDeclared({ repo, pr: 8, indicatorId: 'short-term-churn', predicted: 0.05, sd: 0.03, ts: TS })];
    const { observed, deferred, unobservable } = await reconcileObservations(events, TS);
    expect(observed).toHaveLength(0);
    expect(deferred).toContain('short-term-churn@de-braighter/devloop#8');
    expect(unobservable).toHaveLength(0); // handled (an observer exists), just not measurable yet
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/observe.test.ts`
Expected: FAIL — `short-term-churn` has no observer ⇒ it lands in `unobservable`, so the `deferred` assertion fails.

- [ ] **Step 3: Add the observer in `src/ingest/observe.ts`**

Extend the events import to include `EVENT` and `ChurnObservedPayload`:

```ts
import {
  EVENT,
  effectObserved,
  type EffectDeclaredPayload,
  type EffectObservedPayload,
  type PrMergedPayload,
  type ChurnObservedPayload,
} from '../events.js';
```

Add the observer (after `observeFindings`):

```ts
/** short-term-churn is self-observing once the `churn` ingester has emitted a (window-closed)
 *  ChurnObserved for the PR. Absent one (window still open) ⇒ undefined ⇒ deferred. */
const observeShortTermChurn: Observer = (decl, events) =>
  ofType(events, EVENT.CHURN_OBSERVED)
    .map((e) => e.payload as unknown as ChurnObservedPayload)
    .find((p) => p.repo === decl.repo && p.pr === decl.pr)?.ratio;
```

Register it:

```ts
const OBSERVERS: Record<string, Observer> = {
  'cycle-time': observeCycleTime,
  findings: observeFindings,
  'short-term-churn': observeShortTermChurn,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/observe.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git -C domains/devloop add src/ingest/observe.ts test/observe.test.ts
git -C domains/devloop commit -m "feat(devloop): reconcile observer for short-term-churn (deferred until window closes)"
```

---

### Task 9: CLI `churn [repos]` command

**Files:**
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `runChurn` (Task 6); `clusterRepos` (existing); `DEFAULT_LOG` (existing).

- [ ] **Step 1: Add the command wiring to `src/cli.ts`**

Add the import (with the other `./ingest/*` imports):

```ts
import { runChurn } from './ingest/churn.js';
```

Add a resolver + handler (near the other `function`/`async function` handlers, e.g. after `runReviews`):

```ts
/** Resolve a cluster repo name (`de-braighter/<name>`) to its local clone dir, or undefined
 *  if not cloned. Layers → layers/<name>, domains → domains/<name>, workbench IS the root. */
function resolveRepoDir(root: string, repoName: string): string | undefined {
  const name = repoName.replace(/^de-braighter\//, '');
  if (name === 'workbench') return existsSync(join(root, '.git')) ? root : undefined;
  for (const sub of ['domains', 'layers']) {
    const d = join(root, sub, name);
    if (existsSync(join(d, '.git'))) return d;
  }
  return undefined;
}

function runChurnCli(rest: string[]): void {
  // domains/devloop/src/cli.ts → ../../.. = the cluster root (de-braighter/workbench).
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const names = rest.length ? rest : clusterRepos();
  const repos = names
    .map((repo) => ({ repo, dir: resolveRepoDir(root, repo) }))
    .filter((r): r is { repo: string; dir: string } => !!r.dir);
  const skipped = names.length - repos.length;
  const n = runChurn(repos, DEFAULT_LOG, Date.now());
  console.log(`churn: emitted ${n} window-closed ChurnObserved event(s) across ${repos.length} repo(s)${skipped ? `, skipped ${skipped} (no local clone)` : ''} -> ${DEFAULT_LOG}`);
}
```

Add the case (in the `switch (cmd)`):

```ts
  case 'churn': runChurnCli(rest); break;
```

Add `churn` to the `default:` usage string (insert it near `backfill`/`attribute`):

```ts
  default: console.log('usage: devloop <backfill|attribute|churn|seed|append|drain|…>'); process.exit(1);
```
(Keep the rest of the existing usage list; just add `churn`.)

Also add a one-line doc to the top-of-file command comment block:

```ts
//   devloop churn [repos...]      ingest <14d short-term churn (git history) -> ChurnObserved
```

- [ ] **Step 2: Typecheck**

Run: `npm --prefix domains/devloop run typecheck` (or `npx tsc -p domains/devloop/tsconfig.json --noEmit`)
Expected: no errors.

- [ ] **Step 3: Smoke-run the command on the real cluster**

Run: `node --import tsx domains/devloop/src/cli.ts churn de-braighter/devloop`
Expected: prints `churn: emitted N window-closed ChurnObserved event(s) across 1 repo(s) -> …/foundry/data/events.jsonl` (N ≥ 0; deterministic on a second run → 0 new). Verify a second run prints `emitted 0`.

- [ ] **Step 4: Commit**

```bash
git -C domains/devloop add src/cli.ts
git -C domains/devloop commit -m "feat(devloop): churn CLI command (resolve clones, emit ChurnObserved)"
```

---

### Task 10: full gate + plan/spec coherence

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run` (in `domains/devloop`)
Expected: all tests green (including the new churn/event/indicator/observe tests and all pre-existing tests).

- [ ] **Step 2: Typecheck + knip**

Run (inside `domains/devloop`): `npm run typecheck` then `npx knip`
Expected: typecheck green. If knip flags a new export as unused, confirm it is consumed (the CLI imports `runChurn`; the indicator/observer/event are consumed by the registries) — do NOT delete a genuinely-used export; if knip needs an entry-point hint, follow the existing `knip.json` pattern. (`npm run ci:local` also runs `sonar:scan`, which needs SonarQube on `localhost:9000` — run it only if the server is up.)

- [ ] **Step 3: Verify the honesty surface**

Grep the diff for any gate behaviour on churn. Confirm `short-term-churn` is only ever read by `whatif` (a decision-aid readout) and `reconcile` (calibration) — never wired into a merge gate or a non-zero exit.

Run: `git -C domains/devloop diff main...feat-short-term-churn-s1 --stat`
Expected: only the files in this plan changed.

- [ ] **Step 4: Final commit (if any verification fixups were needed)**

```bash
git -C domains/devloop add -u src/ test/
git -C domains/devloop commit -m "chore(devloop): S1 short-term-churn gate fixups"
```
(Skip if nothing changed.)

---

## Self-Review

**Spec coverage** (against `s1-short-term-churn-design.md`):
- §2 definition + exclusions + test-files-counted → Task 2 (`isExcluded`), Task 5 (acids).
- §2.1 autonomous = count uniformly, `rewrittenBy: number[]` → Task 5 (`rewrittenBy`), Task 1 (schema).
- §2.2 honesty (TREND/WARN, never gate) → Task 10 Step 3.
- §3 ingester (blame forward pass, window-closed gating, edges) → Tasks 3–6.
- §4 `ChurnObserved` event → Task 1.
- §5 whatif line-weighted indicator + IndicatorDef extension → Task 7.
- §6 reconcile observer (deferred until window closes) → Task 8.
- §7 CLI standalone command → Task 9.
- §8 TDD acids (every bullet) → Tasks 2,4,5,6,7,8.
- §9 scope boundaries → nothing in the plan builds S2/S3/diff-coverage/gates. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `ChurnObservedPayload` (Task 1) is consumed verbatim in Tasks 6/7/8. `ChurnRow` (Task 5) is consumed in Task 6. `runChurn` signature (Task 6) is consumed in Task 9. `IndicatorDef.weight`/`fitWeighted` (Task 7) match the accumulator usage. `betaPosterior(successes, failures)` matches `reliability.ts`. ✓
