# devloop PR-findings — S4 (resolution + precision) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each finding's resolution (addressed if a later commit touches its path/line) as a `FindingResolved` event, and surface per-verifier **precision** (addressed / resolvable) in the `findings` readout.

**Architecture:** A pure `isAddressed` matcher (parses diff hunks; compares commit date to the finding's `occurredAt`) over a `ResolutionClient` that fetches a PR's commits + diffs (gh, mock-tested). A `resolveFindings` pass emits `FindingResolved.v1` (emit-on-addressed only, idempotent). `findingsSummary` joins Recorded↔Resolved by `commentId` to compute precision.

**Tech Stack:** TypeScript (ESM, explicit `.js` imports), Zod, vitest, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-06-09-devloop-finding-resolution-s4-design.md`. **Builds on S1–S3** (`FindingRecorded.v1`, `findingsSummary`) — already merged.

---

## Repo & working directory

All tasks run in `D:/development/projects/de-braighter/domains/devloop/`. Test: `npx vitest run <file>`; typecheck: `npm run typecheck`.

**Branch, before Task 1 — off `origin/main` (NOT stale local main; S3/#67 just merged there):**

```bash
cd domains/devloop
git fetch origin
git checkout -b feat/finding-resolution-s4 origin/main
git -C . grep -q "findingsSummary" -- src/inference/findings.ts && echo "S3 present"
```

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/inference/resolution.ts` | matcher + resolveFindings pass + gh client | **create** |
| `src/events.ts` | `FindingResolved.v1` | add EVENT + schema + constructor |
| `src/inference/findings.ts` | precision join | extend `findingsSummary` + `VerifierFindings` |
| `src/cli.ts` | `resolve-findings` command + precision in readout | modify |
| `docs/m2-sdlc-counterfactual-design.md` | S4 note | modify |
| `test/resolution.test.ts` | matcher + pass tests | **create** |

---

## Task 1: the pure resolution matcher

**Files:** Create `src/inference/resolution.ts` (matcher only this task); create `test/resolution.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/resolution.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAddressed, patchTouchesLine, type CommitDiff } from '../src/inference/resolution.js';

const commit = (sha: string, date: string, files: CommitDiff['files']): CommitDiff => ({ sha, date, files });
const T0 = '2026-06-09T10:00:00.000Z';

describe('patchTouchesLine', () => {
  it('matches a line inside a hunk (new or old side)', () => {
    const patch = '@@ -10,3 +10,4 @@\n ctx\n+added\n ctx';
    expect(patchTouchesLine(patch, 11)).toBe(true);  // within +10,4
    expect(patchTouchesLine(patch, 99)).toBe(false);
  });
});

describe('isAddressed', () => {
  it('addressed when a LATER commit touches the finding line', () => {
    const commits = [commit('aaa', '2026-06-09T11:00:00.000Z', [{ filename: 'a.ts', patch: '@@ -5,2 +5,3 @@\n ctx\n+fix' }])];
    const r = isAddressed({ path: 'a.ts', line: 6, createdAt: T0 }, commits);
    expect(r).toMatchObject({ addressed: true, byCommit: 'aaa', byDate: '2026-06-09T11:00:00.000Z' });
  });

  it('NOT addressed when the only touching commit is BEFORE the finding', () => {
    const commits = [commit('old', '2026-06-09T09:00:00.000Z', [{ filename: 'a.ts', patch: '@@ -5,2 +5,3 @@\n+x' }])];
    expect(isAddressed({ path: 'a.ts', line: 6, createdAt: T0 }, commits).addressed).toBe(false);
  });

  it('file-level finding (no line): addressed if a later commit touches the file at all', () => {
    const commits = [commit('bbb', '2026-06-09T12:00:00.000Z', [{ filename: 'a.ts', patch: '@@ -1 +1 @@\n+y' }])];
    expect(isAddressed({ path: 'a.ts', createdAt: T0 }, commits).addressed).toBe(true);
  });

  it('no path → unresolvable (never addressed)', () => {
    expect(isAddressed({ createdAt: T0 }, [commit('x', '2026-06-09T12:00:00.000Z', [])]).addressed).toBe(false);
  });

  it('later commit touches a DIFFERENT file → not addressed', () => {
    const commits = [commit('ccc', '2026-06-09T12:00:00.000Z', [{ filename: 'other.ts', patch: '@@ -1 +1 @@\n+z' }])];
    expect(isAddressed({ path: 'a.ts', line: 6, createdAt: T0 }, commits).addressed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/resolution.test.ts`
Expected: FAIL — module `../src/inference/resolution.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/inference/resolution.ts`:

```ts
// S4: did a finding get addressed? Proxy = a commit dated AFTER the finding touches its
// path (and, for an inline finding, a hunk covering its line). A decision aid, NOT ground
// truth (a coincidental same-line edit also matches). Pure matcher + a gh-backed pass.
export interface CommitDiff { sha: string; date: string; files: { filename: string; patch?: string }[]; }
export interface FindingToResolve { path?: string; line?: number; createdAt: string }
export interface Resolution { addressed: boolean; byCommit?: string; byDate?: string }

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

/** Does a unified-diff patch change `line` (inside the old [a,a+b) or new [c,c+d) range)? */
export function patchTouchesLine(patch: string, line: number): boolean {
  for (const m of patch.matchAll(HUNK_RE)) {
    const oa = +m[1]!, ob = m[2] ? +m[2] : 1, na = +m[3]!, nb = m[4] ? +m[4] : 1;
    if ((line >= oa && line < oa + ob) || (line >= na && line < na + nb)) return true;
  }
  return false;
}

/** Addressed if a commit dated after the finding touches its path (+ line, if inline).
 *  ISO-8601 UTC dates compare lexicographically, so `c.date > f.createdAt` is a string compare. */
export function isAddressed(f: FindingToResolve, commits: CommitDiff[]): Resolution {
  if (!f.path) return { addressed: false }; // no path → unresolvable
  for (const c of commits) {
    if (!(c.date > f.createdAt)) continue; // only commits AFTER the finding
    const file = c.files.find((x) => x.filename === f.path);
    if (!file) continue;
    if (f.line === undefined) return { addressed: true, byCommit: c.sha, byDate: c.date }; // file-level
    if (file.patch && patchTouchesLine(file.patch, f.line)) return { addressed: true, byCommit: c.sha, byDate: c.date };
  }
  return { addressed: false };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/resolution.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/inference/resolution.ts test/resolution.test.ts
git commit -m "feat(inference): isAddressed matcher — fix-commit linkage (hunk parse + date order)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: the `FindingResolved.v1` event

**Files:** Modify `src/events.ts`; add a test to `test/resolution.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `test/resolution.test.ts` (add `findingResolved, EVENT` to the events import at the top: `import { findingResolved, EVENT } from '../src/events.js';`):

```ts
describe('FindingResolved event', () => {
  it('builds a PR-scoped resolution event keyed by commentId', () => {
    const e = findingResolved({ repo: 'r', pr: 7, commentId: 99, addressed: true, byCommit: 'aaa', ts: '2026-06-09T11:00:00.000Z' });
    expect(e.eventType).toBe(EVENT.RESOLUTION);
    expect(e.aggregateType).toBe('PullRequest');
    expect(e.payload).toMatchObject({ commentId: 99, addressed: true, byCommit: 'aaa' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/resolution.test.ts`
Expected: FAIL — `findingResolved` / `EVENT.RESOLUTION` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/events.ts`:

(a) Add to the `EVENT` object:

```ts
  RESOLUTION: 'devloop:FindingResolved.v1',
```

(b) Add the schema (near the `Finding` schema):

```ts
// A finding's observed resolution (S4) — emitted only when ADDRESSED (a later commit touched it);
// 'open' is the absence of this event. Keyed by commentId, joined to FindingRecorded.
const FindingResolved = z.object({ repo: z.string(), pr: z.number().int(), commentId: z.number().int(), addressed: z.boolean(), byCommit: z.string().optional() });
export type FindingResolvedPayload = z.infer<typeof FindingResolved>;
```

(c) Add the constructor (near `finding`):

```ts
export const findingResolved = (i: z.input<typeof FindingResolved> & { ts: string }) =>
  envelope(EVENT.RESOLUTION, i.repo, i.pr, i.ts, FindingResolved.parse(i), 'devloop:resolution');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/resolution.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/events.ts test/resolution.test.ts
git commit -m "feat(events): FindingResolved.v1 — a finding's addressed-resolution

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: the `resolveFindings` pass + gh client + CLI

**Files:** Modify `src/inference/resolution.ts` (append the pass + client); add a test; modify `src/cli.ts`.

- [ ] **Step 1: Write the failing test**

Append to `test/resolution.test.ts` (add to the resolution import: `resolveFindings, type ResolutionClient`; and add `import { finding } from '../src/events.js';` if not already importing `finding`):

```ts
describe('resolveFindings', () => {
  const TS = '2026-06-09T10:00:00.000Z';
  const fe = (repo: string, pr: number, commentId: number, path?: string, line?: number) =>
    finding({ repo, pr, verifier: 'reviewer', severity: 'nit', path, line, commentId, text: 't', ts: TS });
  const client = (byPr: Record<string, CommitDiff[]>): ResolutionClient => ({ commits: async (repo, pr) => byPr[`${repo}#${pr}`] ?? [] });

  it('emits a FindingResolved for an addressed finding, none for an open one', async () => {
    const events = [fe('r', 1, 11, 'a.ts', 6), fe('r', 1, 12, 'b.ts', 3)];
    const out = await resolveFindings(events, client({ 'r#1': [{ sha: 'aaa', date: '2026-06-09T11:00:00.000Z', files: [{ filename: 'a.ts', patch: '@@ -5,2 +5,3 @@\n+fix' }] }] }));
    expect(out).toHaveLength(1);
    expect(out[0]!.payload).toMatchObject({ commentId: 11, addressed: true, byCommit: 'aaa' });
  });

  it('skips findings already resolved (idempotent) and no-path findings', async () => {
    const events = [
      fe('r', 1, 11, 'a.ts', 6),
      finding({ repo: 'r', pr: 1, verifier: 'reviewer', severity: 'note', commentId: 13, text: 'no path', ts: TS }),
    ];
    const cl = client({ 'r#1': [{ sha: 'aaa', date: '2026-06-09T11:00:00.000Z', files: [{ filename: 'a.ts', patch: '@@ -5,2 +5,3 @@\n+fix' }] }] });
    const first = await resolveFindings(events, cl);
    expect(first).toHaveLength(1); // only the path-bearing finding
    const second = await resolveFindings([...events, ...first], cl); // its resolution now in the log
    expect(second).toHaveLength(0); // already resolved → skipped
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/resolution.test.ts`
Expected: FAIL — `resolveFindings` / `ResolutionClient` not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `src/inference/resolution.ts` (and add the imports at the TOP):

```ts
import { execSync } from 'node:child_process';
import type { DomainEventEnvelope } from '@de-braighter/substrate-contracts/events';
import { ofType, dedupKey } from '../log.js';
import { EVENT, findingResolved, type FindingPayload, type FindingResolvedPayload } from '../events.js';
```

```ts
export interface ResolutionClient { commits(repo: string, pr: number): Promise<CommitDiff[]>; }

/** For each resolvable, not-yet-resolved FindingRecorded, fetch its PR's commits and emit a
 *  FindingResolved if a later commit addresses it. Idempotent (dedupKey + already-resolved skip). */
export async function resolveFindings(events: DomainEventEnvelope[], client: ResolutionClient, seen: Set<string> = new Set()): Promise<DomainEventEnvelope[]> {
  const out: DomainEventEnvelope[] = [];
  const push = (env: DomainEventEnvelope) => { const k = dedupKey(env); if (seen.has(k)) return; seen.add(k); out.push(env); };
  const resolvedIds = new Set(ofType(events, EVENT.RESOLUTION).map((e) => (e.payload as unknown as FindingResolvedPayload).commentId));
  const byPr = new Map<string, { repo: string; pr: number; findings: (FindingToResolve & { commentId: number })[] }>();
  for (const e of ofType(events, EVENT.FINDING)) {
    const f = e.payload as unknown as FindingPayload;
    if (!f.path || resolvedIds.has(f.commentId)) continue; // no path = unresolvable; already resolved = skip
    const key = `${f.repo}#${f.pr}`;
    let g = byPr.get(key); if (!g) { g = { repo: f.repo, pr: f.pr, findings: [] }; byPr.set(key, g); }
    g.findings.push({ path: f.path, line: f.line, createdAt: e.occurredAt, commentId: f.commentId });
  }
  for (const g of byPr.values()) {
    const commits = await client.commits(g.repo, g.pr);
    for (const f of g.findings) {
      const r = isAddressed(f, commits);
      if (r.addressed) push(findingResolved({ repo: g.repo, pr: g.pr, commentId: f.commentId, addressed: true, byCommit: r.byCommit, ts: r.byDate! }));
    }
  }
  return out;
}

/** Real client: PR commits (sha+committer date) then each commit's files+patch. Read-only gh
 *  (no `--input -`); parse JSON in TS (no `--jq`). Degrades to [] on error, never throws. */
export function makeResolutionClient(): ResolutionClient {
  const gh = (args: string): string => execSync(`gh ${args}`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return {
    async commits(repo, pr) {
      try {
        const list = JSON.parse(gh(`api "repos/${repo}/pulls/${pr}/commits?per_page=100"`)) as { sha: string; commit?: { committer?: { date?: string } } }[];
        const out: CommitDiff[] = [];
        for (const c of list) {
          const detail = JSON.parse(gh(`api "repos/${repo}/commits/${c.sha}"`)) as { files?: { filename: string; patch?: string }[] };
          out.push({ sha: c.sha, date: c.commit?.committer?.date ?? '', files: detail.files ?? [] });
        }
        return out;
      } catch { return []; }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/resolution.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Wire the CLI command**

In `src/cli.ts`, add the import:

```ts
import { resolveFindings, makeResolutionClient } from './inference/resolution.js';
```

Add the handler near the other `run*` helpers:

```ts
async function runResolveFindings(): Promise<void> {
  const events = readEnvelopes();
  const seen = new Set(events.map(dedupKey));
  const out = await resolveFindings(events, makeResolutionClient(), seen);
  for (const e of out) append(e);
  console.log(`resolved ${out.length} finding(s) addressed (fix-commit linkage) -> ${DEFAULT_LOG}`);
}
```

Add the case + usage:

```ts
  case 'resolve-findings': await runResolveFindings(); break;
```

Add `resolve-findings` to the top-level `default:` usage string.

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/inference/resolution.ts src/cli.ts test/resolution.test.ts
git commit -m "feat(resolution): resolveFindings pass + gh client + resolve-findings CLI

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: per-verifier precision in the readout

**Files:** Modify `src/inference/findings.ts`; add a test to `test/findings.test.ts`; modify `src/cli.ts` (`showFindings`).

- [ ] **Step 1: Write the failing test**

Append to `test/findings.test.ts` (add `findingResolved` to the `../src/events.js` import):

```ts
describe('findingsSummary — precision (S4)', () => {
  it('joins FindingResolved by commentId → per-verifier precision over resolvable findings', () => {
    const RTS = '2026-06-09T10:00:00.000Z';
    const f1 = finding({ repo: 'r', pr: 1, verifier: 'reviewer', severity: 'nit', path: 'a.ts', line: 5, commentId: 21, text: 't', ts: RTS });
    const f2 = finding({ repo: 'r', pr: 1, verifier: 'reviewer', severity: 'nit', path: 'b.ts', line: 3, commentId: 22, text: 't', ts: RTS });
    const f3 = finding({ repo: 'r', pr: 1, verifier: 'qa-engineer', severity: 'note', commentId: 23, text: 'no path', ts: RTS }); // unresolvable (no path)
    const res = findingResolved({ repo: 'r', pr: 1, commentId: 21, addressed: true, ts: '2026-06-09T11:00:00.000Z' });
    const s = findingsSummary([f1, f2, f3, res], 'r');
    const rev = s.byVerifier.find((v) => v.verifier === 'reviewer')!;
    expect(rev).toMatchObject({ resolvable: 2, addressed: 1 });
    expect(rev.precision).toBeCloseTo(0.5, 5);
    const qa = s.byVerifier.find((v) => v.verifier === 'qa-engineer')!;
    expect(qa).toMatchObject({ resolvable: 0, addressed: 0 });
    expect(qa.precision).toBeUndefined(); // no resolvable findings → undefined precision
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/findings.test.ts`
Expected: FAIL — `resolvable`/`addressed`/`precision` are not on the summary.

- [ ] **Step 3: Write minimal implementation**

In `src/inference/findings.ts`:

(a) Add `EVENT`'s resolution payload to the import: change the `../events.js` import to include `type FindingResolvedPayload`.

(b) Extend the interface:

```ts
export interface VerifierFindings { verifier: string; total: number; bySeverity: Record<Severity, number>; resolvable: number; addressed: number; precision?: number; }
```

(c) Rewrite `findingsSummary` to join resolutions:

```ts
export function findingsSummary(events: DomainEventEnvelope[], repo: string): FindingsSummary {
  const resolvedIds = new Set(ofType(events, EVENT.RESOLUTION).map((e) => (e.payload as unknown as FindingResolvedPayload).commentId));
  const byV = new Map<string, VerifierFindings>();
  let total = 0;
  for (const e of ofType(events, EVENT.FINDING)) {
    const f = e.payload as unknown as FindingPayload;
    if (f.repo !== repo) continue;
    let v = byV.get(f.verifier);
    if (!v) { v = { verifier: f.verifier, total: 0, bySeverity: zeroSev(), resolvable: 0, addressed: 0 }; byV.set(f.verifier, v); }
    v.total++; v.bySeverity[f.severity]++; total++;
    if (f.path) { v.resolvable++; if (resolvedIds.has(f.commentId)) v.addressed++; }
  }
  const withPrecision = [...byV.values()].map((v) => ({ ...v, precision: v.resolvable ? v.addressed / v.resolvable : undefined }));
  return { repo, total, byVerifier: withPrecision.sort((a, b) => b.total - a.total) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/findings.test.ts`
Expected: PASS.

- [ ] **Step 5: Render precision in the CLI readout**

In `src/cli.ts` `showFindings`, change the header note + the per-verifier row. Replace the loop with:

```ts
  console.log(`FINDINGS — ${repo}   ${s.total} finding(s) across ${s.byVerifier.length} verifier(s)   (precision = addressed/resolvable, proxy via fix-commit linkage)\n`);
  if (!s.total) { console.log('   none yet — post agent findings (`post-findings`) or harvest reviews (`reviews`).'); return; }
  for (const v of s.byVerifier) {
    const prec = v.precision === undefined ? '—' : `${pct(v.precision)} (${v.addressed}/${v.resolvable})`;
    console.log(`   ${v.verifier.padEnd(16)} ${String(v.total).padStart(3)}   precision ${prec.padEnd(16)}   (${SEVERITIES.map((sev) => `${sev} ${v.bySeverity[sev]}`).join(', ')})`);
  }
```

(Delete the old `console.log('FINDINGS — ...')` header line and the old `for (const v of s.byVerifier) console.log(...)` loop they replace.)

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/inference/findings.ts src/cli.ts test/findings.test.ts
git commit -m "feat(findings): per-verifier precision (addressed/resolvable) in the readout

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: docs

**Files:** Modify `docs/m2-sdlc-counterfactual-design.md`.

- [ ] **Step 1: Note S4 in the M2 design doc**

In `docs/m2-sdlc-counterfactual-design.md`, under the build-slices section, append: `S4 captures finding **resolution** (fix-commit linkage: a later commit touches the finding's path/line → addressed) as \`FindingResolved.v1\`, and surfaces per-verifier **precision** (addressed/resolvable) in \`devloop findings <repo>\` — a proxy decision aid, not a verified accept-rate.`

- [ ] **Step 2: Verify the readout renders precision**

Run: `npx tsx src/cli.ts findings de-braighter/devloop`
Expected: the header includes `(precision = addressed/resolvable, …)` and rows show `precision —` (no resolutions in the log yet — the live smoke test in the handoff creates the first).

- [ ] **Step 3: Commit**

```bash
git add docs/m2-sdlc-counterfactual-design.md
git commit -m "docs(resolution): document S4 resolution + precision

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done (S4)

- [ ] `npx vitest run` green; `npm run typecheck` exit 0.
- [ ] `devloop resolve-findings` emits a `FindingResolved` per addressed finding (idempotent).
- [ ] `devloop findings <repo>` shows per-verifier precision (addressed/resolvable), labeled proxy-derived.

## Deferred (later)

- A whatif `precision`-by-lever angle; reply/reaction triage; verdict-derived-from-findings unification; a dismissed-vs-open distinction (today both read as "open").

## Orchestrator-run live smoke (handoff, OUTWARD-read — run by the orchestrator)

After merge, run `resolve-findings` on a repo whose findings sit on PRs with later commits, then `findings` — confirm a `FindingResolved` lands and a verifier's precision becomes non-`—`. (The current devloop findings are mostly on the comment's own commit with no later fix, so precision may legitimately read low/`—`; that's honest, not a bug.)
