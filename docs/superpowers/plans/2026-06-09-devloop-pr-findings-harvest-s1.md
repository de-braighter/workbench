# devloop PR-findings harvest — S1 (capture pipeline) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the finding-level capture pipeline — a tagged-comment convention + parser, a new `FindingRecorded.v1` event, and a harvest extension that records a finding per inline PR comment (ours tagged, theirs untagged) — additively, leaving the existing verdict path unchanged.

**Architecture:** Extend the running `pr-reviews.ts` harvest. Verifier identity rides in the comment **body tag** (dodging GitHub login-collapse). Findings are emitted as new events alongside the existing per-reviewer verdicts; `commentId` in the payload gives free idempotency via the existing `dedupKey`.

**Tech Stack:** TypeScript (ESM, explicit `.js` imports), Zod, vitest, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-06-09-devloop-pr-findings-harvest-design.md` (slice S1).

---

## Repo & working directory

All tasks run in the **devloop domain repo**: `D:/development/projects/de-braighter/domains/devloop/` (its own git repo). Run all commands from there. Test runner: `npx vitest run <file>`; typecheck: `npm run typecheck`.

**Branch, before Task 2:**

```bash
cd domains/devloop
git checkout main && git checkout -b feat/pr-findings-harvest-s1
```

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/ingest/finding-tag.ts` | the comment-body tag convention (format + parse) | **create** |
| `src/events.ts` | events + constructors | add `SEVERITIES`/`Severity`, `FindingRecorded.v1` schema + `finding()` |
| `src/ingest/pr-reviews.ts` | review/finding harvest | widen client to `comments()`; `commentToFinding`; emit findings |
| `src/cli.ts` | CLI surface | `runReviews` message counts findings |
| `test/finding-tag.test.ts` | tag round-trip tests | **create** |
| `test/finding-event.test.ts` | event/constructor tests | **create** |
| `test/pr-findings-harvest.test.ts` | harvest tests (mock client) | **create** |

---

## Task 1: Pre-flight — verify the gh token can post/read/delete an inline comment (GATE)

**This task is outward-facing (posts to a real PR) and is run by the orchestrator, not delegated.** It de-risks the entire arc: if the token can't post inline comments, S2 is blocked and a token-scope fix is needed first. It posts to a merged PR and deletes immediately (round-trip).

- [ ] **Step 1: Get a head SHA + a changed file/line from a recent merged PR**

```bash
gh pr view 64 --repo de-braighter/devloop --json mergeCommit --jq .mergeCommit.oid
# pick any file+line that PR touched, e.g. src/events.ts near the effort field (line ~33)
```

- [ ] **Step 2: Post an inline comment, capture its id**

```bash
gh api repos/de-braighter/devloop/pulls/64/comments \
  -f body="devloop preflight (delete me) <!-- devloop:finding v=preflight s=note -->" \
  -f commit_id="<SHA>" -f path="src/events.ts" -F line=33 -f side=RIGHT --jq .id
```

Expected: prints a numeric comment id. If it 422s on the line, retry with a line known to be in #64's diff. If it 403/404s on **auth scope**, STOP — the token lacks comment-write; escalate.

- [ ] **Step 3: Read it back, then delete it**

```bash
gh api repos/de-braighter/devloop/pulls/comments/<ID> --jq '.id,.body,.path,.line'
gh api -X DELETE repos/de-braighter/devloop/pulls/comments/<ID>
```

Expected: read-back shows the body+tag; delete returns empty (204). **Gate:** all three succeed → proceed. Record the working `(path, line)` recipe for S2 + Task 5.

---

## Task 2: the tag convention + parser

**Files:** Create `src/ingest/finding-tag.ts`; create `test/finding-tag.test.ts`.

> Ordering note: `finding-tag.ts` imports `SEVERITIES`/`Severity` from `events.ts` (Task 3). Apply **Task 3 Step 3 (the events.ts additions) before Task 2 Step 3** so the import resolves; otherwise the vitest run still works (tsx strips types) but `npm run typecheck` fails until Task 3 lands.

- [ ] **Step 1: Write the failing test**

Create `test/finding-tag.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { formatFindingBody, parseFindingTag } from '../src/ingest/finding-tag.js';

describe('finding tag (body convention)', () => {
  it('formats a human prefix + a hidden machine tag', () => {
    const body = formatFindingBody('qa-engineer', 'blocking', 'missing auth check');
    expect(body).toContain('[qa-engineer · BLOCKING] missing auth check');
    expect(body).toContain('<!-- devloop:finding v=qa-engineer s=blocking -->');
  });

  it('round-trips: format then parse recovers verifier + severity', () => {
    const body = formatFindingBody('reviewer', 'nit', 'naming');
    expect(parseFindingTag(body)).toEqual({ verifier: 'reviewer', severity: 'nit' });
  });

  it('returns null for an untagged (external) comment', () => {
    expect(parseFindingTag('just a normal Copilot comment')).toBeNull();
  });

  it('rejects an unknown severity in the tag', () => {
    expect(parseFindingTag('x <!-- devloop:finding v=reviewer s=catastrophic -->')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/finding-tag.test.ts`
Expected: FAIL — module `finding-tag.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/ingest/finding-tag.ts`:

```ts
// The comment-body convention that carries verifier identity + severity past GitHub's
// login attribution. A human-readable prefix for the PR reader, plus a hidden HTML-comment
// machine tag (HTML comments don't render on GitHub) the harvest parses. Pure.
import { SEVERITIES, type Severity } from '../events.js';

const TAG_RE = new RegExp(`<!--\\s*devloop:finding\\s+v=([\\w-]+)\\s+s=(${SEVERITIES.join('|')})\\s*-->`, 'i');

/** verifier + severity → a comment body (human prefix + hidden machine tag). */
export function formatFindingBody(verifier: string, severity: Severity, text: string): string {
  return `[${verifier} · ${severity.toUpperCase()}] ${text}\n<!-- devloop:finding v=${verifier} s=${severity} -->`;
}

/** Parse the machine tag out of a comment body, or null if untagged / unknown severity. */
export function parseFindingTag(body: string): { verifier: string; severity: Severity } | null {
  const m = TAG_RE.exec(body);
  if (!m) return null;
  return { verifier: m[1]!, severity: m[2]!.toLowerCase() as Severity };
}
```

- [ ] **Step 4: Run test to verify it passes** (after Task 3's events additions exist)

Run: `npx vitest run test/finding-tag.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ingest/finding-tag.ts test/finding-tag.test.ts
git commit -m "feat(ingest): finding tag convention — verifier+severity in the comment body

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: the `FindingRecorded.v1` event

**Files:** Modify `src/events.ts`; create `test/finding-event.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/finding-event.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { finding, EVENT, SEVERITIES } from '../src/events.js';
import { dedupKey } from '../src/log.js';

const TS = '2026-06-09T12:00:00.000Z';
const base = { repo: 'r', pr: 7, verifier: 'qa-engineer', commentId: 555, text: 'missing auth' } as const;

describe('FindingRecorded event', () => {
  it('exposes the severity ladder', () => {
    expect([...SEVERITIES]).toEqual(['blocking', 'should-fix', 'nit', 'note']);
  });

  it('builds a PR-scoped finding event with verifier provenance', () => {
    const e = finding({ ...base, severity: 'blocking', path: 'src/x.ts', line: 42, ts: TS });
    expect(e.eventType).toBe(EVENT.FINDING);
    expect(e.aggregateType).toBe('PullRequest');
    expect(e.metadata.actorRef).toBe('verifier:qa-engineer');
    expect(e.payload).toMatchObject({ severity: 'blocking', path: 'src/x.ts', line: 42, commentId: 555 });
  });

  it('path/line are optional (off-diff finding)', () => {
    const e = finding({ ...base, severity: 'note', ts: TS });
    expect((e.payload as { path?: unknown }).path).toBeUndefined();
  });

  it('rejects an unknown severity', () => {
    // @ts-expect-error invalid severity
    expect(() => finding({ ...base, severity: 'huge', ts: TS })).toThrow();
  });

  it('is idempotent by commentId — identical payload dedups', () => {
    const a = finding({ ...base, severity: 'nit', ts: TS });
    const b = finding({ ...base, severity: 'nit', ts: TS });
    expect(dedupKey(a)).toBe(dedupKey(b));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/finding-event.test.ts`
Expected: FAIL — `finding` / `SEVERITIES` / `EVENT.FINDING` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/events.ts`:

(a) Add `FINDING` to the `EVENT` object:

```ts
  FINDING: 'devloop:FindingRecorded.v1',
```

(b) After `export const VERDICT_VALUES = [...] as const;`, add:

```ts
// Severity ladder for a single finding (a tagged inline PR comment). 'note' is the default
// bucket for an untagged (external) comment. blocking → blocking; the rest → notes (aggregate).
export const SEVERITIES = ['blocking', 'should-fix', 'nit', 'note'] as const;
export type Severity = (typeof SEVERITIES)[number];
```

(c) Add the schema (near the other pack-local schemas, e.g. after `Verdict`):

```ts
// One finding = one inline PR review comment. The deep grain under the per-reviewer Verdict.
const Finding = z.object({
  repo: z.string(), pr: z.number().int(),
  verifier: z.string(), severity: z.enum(SEVERITIES),
  path: z.string().optional(), line: z.number().int().optional(),
  commentId: z.number().int(), // GitHub inline-comment id — the stable dedup key
  text: z.string(),
});
export type FindingPayload = z.infer<typeof Finding>;
```

(d) Add the constructor (near the other constructors, e.g. after `verdict`):

```ts
export const finding = (i: z.input<typeof Finding> & { ts: string }) =>
  envelope(EVENT.FINDING, i.repo, i.pr, i.ts, Finding.parse(i), `verifier:${i.verifier}`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/finding-event.test.ts test/finding-tag.test.ts`
Expected: PASS (both files).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: exit 0 (the `@ts-expect-error` in finding-event.test.ts is satisfied).

- [ ] **Step 6: Commit**

```bash
git add src/events.ts test/finding-event.test.ts
git commit -m "feat(events): FindingRecorded.v1 — finding-level grain under the verdict

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: harvest a finding per inline comment (additive)

**Files:** Modify `src/ingest/pr-reviews.ts`; create `test/pr-findings-harvest.test.ts`.

The existing verdict path stays unchanged: widen the client from `commentAuthors(): string[]` to `comments(): RawComment[]`, and feed `summarizeReviewers` with `comments.map(c => c.login)`. Findings are emitted additively from the same comments.

- [ ] **Step 1: Write the failing test**

Create `test/pr-findings-harvest.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { harvestPrReviews, type ReviewClient, type RawComment } from '../src/ingest/pr-reviews.js';
import { formatFindingBody } from '../src/ingest/finding-tag.js';
import { EVENT, type FindingPayload } from '../src/events.js';
import { dedupKey } from '../src/log.js';

const TS = '2026-06-09T10:00:00.000Z';
const c = (o: Partial<RawComment>): RawComment => ({ login: 'octocat', body: 'x', id: 1, createdAt: TS, ...o });

const client = (comments: RawComment[]): ReviewClient => ({
  reviewedPrs: async () => [{ pr: 7, reviews: [{ author: 'Copilot', state: 'COMMENTED', submittedAt: TS }] }],
  comments: async () => comments,
});

const findingsOf = (out: { eventType: string; payload: unknown }[]) =>
  out.filter((e) => e.eventType === EVENT.FINDING).map((e) => e.payload as FindingPayload);

describe('harvest — finding per inline comment (additive)', () => {
  it('emits a tagged finding with verifier+severity FROM THE TAG (not the login)', async () => {
    const body = formatFindingBody('qa-engineer', 'blocking', 'no auth');
    const out = await harvestPrReviews(['de-braighter/devloop'], client([c({ login: 'someuser', body, id: 99, path: 'a.ts', line: 5 })]));
    const f = findingsOf(out);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ verifier: 'qa-engineer', severity: 'blocking', path: 'a.ts', line: 5, commentId: 99 });
  });

  it('emits an untagged external comment as verifier=classified-login, severity=note', async () => {
    const out = await harvestPrReviews(['de-braighter/devloop'], client([c({ login: 'Copilot', body: 'nit: rename', id: 12 })]));
    expect(findingsOf(out)[0]).toMatchObject({ verifier: 'copilot', severity: 'note', commentId: 12 });
  });

  it('still emits the per-reviewer verdict (verdict path unchanged)', async () => {
    const out = await harvestPrReviews(['de-braighter/devloop'], client([c({ login: 'Copilot', body: 'a comment', id: 3 })]));
    expect(out.some((e) => e.eventType === EVENT.VERDICT)).toBe(true);
  });

  it('is idempotent — re-harvest with seen adds nothing', async () => {
    const cl = client([c({ login: 'Copilot', body: 'a comment', id: 3 })]);
    const first = await harvestPrReviews(['de-braighter/devloop'], cl);
    const seen = new Set(first.map(dedupKey)); // seed with the harvest's OWN dedup key
    const second = await harvestPrReviews(['de-braighter/devloop'], cl, seen);
    expect(second).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/pr-findings-harvest.test.ts`
Expected: FAIL — `RawComment` / `comments` not exported; no `FINDING` events emitted.

- [ ] **Step 3: Write minimal implementation**

In `src/ingest/pr-reviews.ts`:

(a) Extend imports:

```ts
import { verdict, finding } from '../events.js';
import { parseFindingTag } from './finding-tag.js';
```

(b) Add the `RawComment` type and change the `ReviewClient` interface:

```ts
export interface RawComment { login: string; body: string; path?: string; line?: number; id: number; createdAt: string; }

export interface ReviewClient {
  reviewedPrs(repo: string): Promise<PrWithReviews[]>;
  /** Every inline review comment on a PR (login + body + position + id). */
  comments(repo: string, pr: number): Promise<RawComment[]>;
}
```

(c) Add the pure comment→finding mapper (after `reviewToVerdict`):

```ts
/** An inline comment → a FindingRecorded. Verifier+severity from the body tag (our agents);
 *  untagged (external) → verifier from the login classification, severity 'note'. Pure. */
export function commentToFinding(repo: string, pr: number, cmt: RawComment): DomainEventEnvelope {
  const tag = parseFindingTag(cmt.body);
  return finding({
    repo, pr,
    verifier: tag?.verifier ?? classifyReviewer(cmt.login),
    severity: tag?.severity ?? 'note',
    path: cmt.path, line: cmt.line, commentId: cmt.id, text: cmt.body, ts: cmt.createdAt,
  });
}
```

(d) Rewrite `harvestPrReviews` to fetch comments once, then emit BOTH findings and the (unchanged) verdicts:

```ts
export async function harvestPrReviews(
  repos: string[],
  client: ReviewClient,
  seen: Set<string> = new Set(),
): Promise<DomainEventEnvelope[]> {
  const out: DomainEventEnvelope[] = [];
  const push = (env: DomainEventEnvelope) => {
    const k = dedupKey(env);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(env);
  };
  for (const repo of repos) {
    for (const { pr, reviews } of await client.reviewedPrs(repo)) {
      const comments = await client.comments(repo, pr);
      // additive: one finding per inline comment (ours tagged, theirs untagged)
      for (const cmt of comments) push(commentToFinding(repo, pr, cmt));
      // unchanged: per-reviewer aggregate verdict (only for reviewers who submitted a review)
      if (!reviews.length) continue;
      for (const r of summarizeReviewers(reviews, comments.map((cmt) => cmt.login))) {
        if (!r.submittedAt) continue;
        push(reviewToVerdict(repo, pr, r));
      }
    }
  }
  return out;
}
```

(e) Update the real client: replace `commentAuthors` with `comments`:

```ts
    async comments(repo, pr) {
      try {
        const raw = gh(`api repos/${repo}/pulls/${pr}/comments --paginate`);
        return (JSON.parse(raw) as GhComment[]).map((cmt) => ({
          login: cmt.user?.login ?? '',
          body: cmt.body ?? '',
          path: cmt.path,
          line: cmt.line ?? undefined,
          id: cmt.id,
          createdAt: cmt.created_at ?? '',
        }));
      } catch {
        return [];
      }
    },
```

(f) Widen the `GhComment` interface:

```ts
interface GhComment { user?: { login?: string }; body?: string; path?: string; line?: number; id: number; created_at?: string; }
```

(`dedupKey` is already imported at the top of the file — it was used by the prior implementation.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/pr-findings-harvest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Full suite + typecheck (no regressions — the client signature changed)**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, exit 0. If a pre-existing test referenced `commentAuthors`, update it to `comments` (return `RawComment[]`); report if found.

- [ ] **Step 6: Commit**

```bash
git add src/ingest/pr-reviews.ts test/pr-findings-harvest.test.ts
git commit -m "feat(ingest): record a finding per inline PR comment (additive to verdicts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: report findings in the `reviews` CLI

**Files:** Modify `src/cli.ts` (the `runReviews` function, ~143-152).

- [ ] **Step 1: Update the message to count findings**

`runReviews` already appends everything `harvestPrReviews` returns (findings + verdicts). Update only the summary line. In `runReviews`, after the append loop, replace the `console.log(...)` with:

```ts
  const findingCount = verdicts.filter((e) => e.eventType === EVENT.FINDING).length;
  const reviewVerdicts = verdicts.length - findingCount;
  console.log(`harvested ${reviewVerdicts} review verdict(s) + ${findingCount} finding(s) -> ${DEFAULT_LOG}`);
```

(`EVENT` is already imported in cli.ts, line 11.)

- [ ] **Step 2: Verify the command runs end-to-end on the live log**

Run: `npx tsx src/cli.ts reviews de-braighter/devloop 2>&1 | tail -3`
Expected: prints `harvested N review verdict(s) + M finding(s) -> ...` without error (M reflects external Copilot/human inline comments already on merged PRs — proving the harvest records findings now).

- [ ] **Step 3: Manual end-to-end seed (proves a TAGGED finding round-trips) — orchestrator-run, outward-facing**

Post one tagged finding to a merged PR (reuse Task 1's working SHA + path/line), then harvest and confirm it lands as a `reviewer · nit` finding:

```bash
gh api repos/de-braighter/devloop/pulls/64/comments \
  -f body="[reviewer · NIT] seed: naming
<!-- devloop:finding v=reviewer s=nit -->" \
  -f commit_id="<SHA>" -f path="src/events.ts" -F line=33 -f side=RIGHT --jq .id
npx tsx src/cli.ts reviews de-braighter/devloop
grep -o '"verifier":"reviewer","severity":"nit"[^}]*"commentId":[0-9]*' data/events.jsonl | tail -1
```

Expected: the grep prints the tagged finding (`verifier:reviewer, severity:nit`). Delete or keep the seed comment as preferred.

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): reviews command reports findings harvested

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Definition of done (S1)

- [ ] Pre-flight gh round-trip passed (token can post/read/delete inline comments).
- [ ] `npx vitest run` green; `npm run typecheck` exit 0 in `domains/devloop/`.
- [ ] `devloop reviews <repo>` records a `FindingRecorded` per inline comment (tagged → verifier+severity from the tag; untagged → classified login + `note`), additively, with the verdict path unchanged.
- [ ] A hand-posted tagged comment harvests into a finding with the correct verifier+severity.

## Deferred within the arc (NOT in S1)

- **S2** — `post-findings` CLI + the orchestrator posting the wave's findings pre-merge (PR-first workflow).
- **Verdict-derived-from-findings** unification (so `findings`/`cleanliness` reflect agent findings) — folds in with S3's readout.
- **S3** — `devloop findings <repo>` readout (per-verifier × severity), composed with the `effort` lever.
- **S4** — resolution / precision (finding→fix linkage).
