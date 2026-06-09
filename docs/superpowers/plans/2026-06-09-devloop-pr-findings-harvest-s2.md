# devloop PR-findings harvest — S2 (posting) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the orchestrator post the verifier wave's findings to a PR as tagged inline review comments via a new `devloop post-findings <repo#pr> <findings.json>` command, so the S1 harvest records them — idempotently, with off-diff fallbacks.

**Architecture:** A pure `postFindings` routing function (inline → file-level → issue) over a `PostClient` interface that isolates the `gh` calls (unit-tested against a mock). The real client shells out with `execFileSync` (args array — safe for arbitrary comment bodies). Centralized: agents stay read-only-returning; the orchestrator writes the wave's findings to a JSON file and calls `post-findings` pre-merge (PR-first).

**Tech Stack:** TypeScript (ESM, explicit `.js` imports), Zod, vitest, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-06-09-devloop-pr-findings-harvest-design.md` (slice S2). **Builds on S1** (`FindingRecorded.v1`, `formatFindingBody`/`parseFindingTag`, the harvest) — already merged to `main`.

---

## Repo & working directory

All tasks (except the Task 5 smoke test) run in `D:/development/projects/de-braighter/domains/devloop/` (its own git repo). Test runner: `npx vitest run <file>`; typecheck: `npm run typecheck`.

**Branch, before Task 1 — base off `origin/main` (NOT stale local main; #65 just merged there):**

```bash
cd domains/devloop
git fetch origin
git checkout -b feat/pr-findings-post-s2 origin/main
```

## Design decisions baked into this plan (mechanical)

- **Idempotency key = `verifier|path|line`** (re-read existing tagged comments; skip a finding whose signature is already present). No change to the S1 tag.
- **Routing:** `path`+`line` → inline review comment; if GitHub rejects the position (422) **or** `path` but no `line` → **file-level** review comment (`subject_type=file` — still in `pulls/{pr}/comments`, so still harvested); **no `path`** → PR-level **issue** comment (human-visible, NOT harvested by S1 — the rare whole-PR concern).
- **`commit_id`** = the PR's last commit SHA via `gh api pulls/{pr}/commits` (works for open AND merged PRs).
- **Input JSON** = an array of `{ verifier, severity, path?, line?, text }`, validated by Zod.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/post/findings.ts` | the poster: routing logic + `PostClient` + real gh client + input schema | **create** |
| `src/cli.ts` | the `post-findings` command | add command + usage |
| `CLAUDE.md` (workbench) | PR-first + post-findings ritual step | add (Task 4) |
| `test/post-findings.test.ts` | routing/idempotency tests (mock client) | **create** |

---

## Task 1: the poster routing logic + `PostClient` interface

**Files:** Create `src/post/findings.ts` (logic only this task); create `test/post-findings.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `test/post-findings.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { postFindings, findingSignature, type PostClient, type FindingToPost } from '../src/post/findings.js';
import { parseFindingTag } from '../src/ingest/finding-tag.js';

interface Recorder { inline: { commitId: string; path: string; line: number; body: string }[]; file: { path: string; body: string }[]; issue: string[]; }
function mockClient(opts: { existing?: string[]; rejectInline?: boolean } = {}): PostClient & Recorder {
  const inline: Recorder['inline'] = [], file: Recorder['file'] = [], issue: string[] = [];
  return {
    inline, file, issue,
    headSha: async () => 'SHA123',
    existingSignatures: async () => new Set(opts.existing ?? []),
    postInline: async (_r, _p, x) => { if (opts.rejectInline) return false; inline.push(x); return true; },
    postFileLevel: async (_r, _p, x) => { file.push(x); },
    postIssue: async (_r, _p, body) => { issue.push(body); },
  };
}
const f = (o: Partial<FindingToPost>): FindingToPost => ({ verifier: 'reviewer', severity: 'nit', text: 't', ...o });

describe('postFindings', () => {
  it('posts an on-diff finding as a tagged inline comment', async () => {
    const c = mockClient();
    const res = await postFindings('r', 1, [f({ path: 'a.ts', line: 5, severity: 'blocking', verifier: 'qa-engineer', text: 'no auth' })], c);
    expect(res.posted).toBe(1);
    expect(c.inline[0]).toMatchObject({ commitId: 'SHA123', path: 'a.ts', line: 5 });
    expect(parseFindingTag(c.inline[0]!.body)).toEqual({ verifier: 'qa-engineer', severity: 'blocking' });
  });

  it('skips a finding already posted (idempotent by signature)', async () => {
    const c = mockClient({ existing: [findingSignature({ verifier: 'reviewer', path: 'a.ts', line: 5 })] });
    const res = await postFindings('r', 1, [f({ path: 'a.ts', line: 5 })], c);
    expect(res).toMatchObject({ posted: 0, skipped: 1 });
    expect(c.inline).toHaveLength(0);
  });

  it('falls back to a file-level comment when the inline position is rejected', async () => {
    const c = mockClient({ rejectInline: true });
    const res = await postFindings('r', 1, [f({ path: 'a.ts', line: 999 })], c);
    expect(res).toMatchObject({ posted: 0, fileLevel: 1 });
    expect(c.file[0]).toMatchObject({ path: 'a.ts' });
  });

  it('posts a no-path finding as a PR-level issue comment', async () => {
    const c = mockClient();
    const res = await postFindings('r', 1, [f({ text: 'whole-PR concern' })], c);
    expect(res).toMatchObject({ issue: 1 });
    expect(c.issue[0]).toContain('whole-PR concern');
  });

  it('de-dups within one batch — same verifier+line posts once', async () => {
    const c = mockClient();
    const res = await postFindings('r', 1, [f({ path: 'a.ts', line: 5 }), f({ path: 'a.ts', line: 5, text: 'dupe' })], c);
    expect(res).toMatchObject({ posted: 1, skipped: 1 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/post-findings.test.ts`
Expected: FAIL — module `../src/post/findings.js` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `src/post/findings.ts` (logic + interface + signature; the real client + schema come in later tasks):

```ts
// S2: post verifier-wave findings to a PR as tagged inline review comments so the S1 harvest
// records them per-verifier. Centralized (orchestrator calls `post-findings`), idempotent,
// with off-diff fallbacks. PostClient isolates the gh calls so the routing is unit-tested.
import { formatFindingBody } from '../ingest/finding-tag.js';
import type { Severity } from '../events.js';

export interface FindingToPost { verifier: string; severity: Severity; path?: string; line?: number; text: string; }

export interface PostClient {
  /** PR head commit SHA (the commit_id for an inline review comment). */
  headSha(repo: string, pr: number): Promise<string>;
  /** Signatures (`verifier|path|line`) of devloop findings ALREADY posted on the PR. */
  existingSignatures(repo: string, pr: number): Promise<Set<string>>;
  /** Post a line-attached review comment; resolves false if GitHub rejects the position (422). */
  postInline(repo: string, pr: number, p: { commitId: string; path: string; line: number; body: string }): Promise<boolean>;
  /** Post a file-level review comment (off-diff but still harvested — it has a path). */
  postFileLevel(repo: string, pr: number, p: { commitId: string; path: string; body: string }): Promise<void>;
  /** Post a PR-level issue comment (no path — human-visible, NOT harvested by S1). */
  postIssue(repo: string, pr: number, body: string): Promise<void>;
}

export interface PostResult { posted: number; skipped: number; fileLevel: number; issue: number; }

/** `verifier|path|line` — the idempotency key (matches existingSignatures). */
export function findingSignature(f: { verifier: string; path?: string; line?: number }): string {
  return `${f.verifier}|${f.path ?? ''}|${f.line ?? ''}`;
}

export async function postFindings(repo: string, pr: number, findings: FindingToPost[], client: PostClient): Promise<PostResult> {
  const sha = await client.headSha(repo, pr);
  const seen = await client.existingSignatures(repo, pr);
  const res: PostResult = { posted: 0, skipped: 0, fileLevel: 0, issue: 0 };
  for (const f of findings) {
    const sig = findingSignature(f);
    if (seen.has(sig)) { res.skipped++; continue; }
    seen.add(sig); // also de-dups within the batch
    const body = formatFindingBody(f.verifier, f.severity, f.text);
    if (f.path && f.line !== undefined) {
      if (await client.postInline(repo, pr, { commitId: sha, path: f.path, line: f.line, body })) { res.posted++; continue; }
      await client.postFileLevel(repo, pr, { commitId: sha, path: f.path, body }); res.fileLevel++; // position rejected → file-level
    } else if (f.path) {
      await client.postFileLevel(repo, pr, { commitId: sha, path: f.path, body }); res.fileLevel++;
    } else {
      await client.postIssue(repo, pr, body); res.issue++;
    }
  }
  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/post-findings.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/post/findings.ts test/post-findings.test.ts
git commit -m "feat(post): findings posting routing logic (inline/file-level/issue, idempotent)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: the real `gh` PostClient + input schema

**Files:** Modify `src/post/findings.ts` (append the real client + the Zod input schema).

- [ ] **Step 1: Append the input schema + real client**

Add to the TOP imports of `src/post/findings.ts`:

```ts
import { execSync } from 'node:child_process';
import { z } from 'zod';
import { SEVERITIES } from '../events.js';
import { parseFindingTag } from '../ingest/finding-tag.js';
```

Append at the END of `src/post/findings.ts`:

```ts
/** The JSON the orchestrator writes from the verifier wave's returned findings. */
export const FindingsInput = z.array(z.object({
  verifier: z.string(),
  severity: z.enum(SEVERITIES),
  path: z.string().optional(),
  line: z.number().int().optional(),
  text: z.string(),
}));

/** Real PostClient via `gh`. Shell-based execSync (so a bare `gh` resolves to gh.exe on
 *  Windows), but every arbitrary comment BODY is sent as a JSON object on stdin via
 *  `--input -` — so JSON.stringify does all escaping and nothing arbitrary touches the shell.
 *  No `--jq` in the shelled command (cmd.exe mangles quotes) — parse JSON in TS. */
export function makePostClient(): PostClient {
  const gh = (args: string, input?: string): string =>
    execSync(`gh ${args}`, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 });
  const is422 = (e: unknown): boolean => /\b422\b|Unprocessable/i.test(String((e as { stderr?: string })?.stderr ?? e));
  const post = (repo: string, pr: number, payload: Record<string, unknown>, sub: 'pulls' | 'issues') =>
    gh(`api repos/${repo}/${sub}/${pr}/comments --method POST --input -`, JSON.stringify(payload));
  return {
    async headSha(repo, pr) {
      const commits = JSON.parse(gh(`api repos/${repo}/pulls/${pr}/commits --paginate`)) as { sha: string }[];
      return commits.at(-1)!.sha;
    },
    async existingSignatures(repo, pr) {
      const sigs = new Set<string>();
      try {
        const raw = gh(`api repos/${repo}/pulls/${pr}/comments --paginate`);
        for (const c of JSON.parse(raw) as { body?: string; path?: string; line?: number | null }[]) {
          const tag = parseFindingTag(c.body ?? '');
          if (tag) sigs.add(`${tag.verifier}|${c.path ?? ''}|${c.line ?? ''}`);
        }
      } catch { /* none */ }
      return sigs;
    },
    async postInline(repo, pr, p) {
      try {
        post(repo, pr, { body: p.body, commit_id: p.commitId, path: p.path, line: p.line, side: 'RIGHT' }, 'pulls');
        return true;
      } catch (e) {
        if (is422(e)) return false; // position not in the diff → caller falls back to file-level
        throw e;
      }
    },
    async postFileLevel(repo, pr, p) {
      post(repo, pr, { body: p.body, commit_id: p.commitId, path: p.path, subject_type: 'file' }, 'pulls');
    },
    async postIssue(repo, pr, body) {
      post(repo, pr, { body }, 'issues');
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exit 0. (The real client isn't unit-tested — it shells out — so typecheck is the gate; Task 5 exercises it live.)

- [ ] **Step 3: Run the full poster test file (unchanged, still green)**

Run: `npx vitest run test/post-findings.test.ts`
Expected: PASS (5 tests — the mock-client tests are unaffected by the real client).

- [ ] **Step 4: Commit**

```bash
git add src/post/findings.ts
git commit -m "feat(post): real gh PostClient (execFileSync) + findings input schema

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: the `post-findings` CLI command

**Files:** Modify `src/cli.ts`.

- [ ] **Step 1: Add imports**

In `src/cli.ts`, ensure `readFileSync` is imported (add `import { readFileSync } from 'node:fs';` near the top if not already present), and add:

```ts
import { postFindings, makePostClient, FindingsInput } from './post/findings.js';
```

- [ ] **Step 2: Add the command handler function**

Add this function near the other `run*` helpers in `src/cli.ts`:

```ts
async function runPostFindings(rest: string[]): Promise<void> {
  const ref = parsePrRef(rest[0]);
  if (!ref || !rest[1]) { console.log('usage: post-findings <owner/repo#pr> <findings.json>'); return; }
  const findings = FindingsInput.parse(JSON.parse(readFileSync(rest[1], 'utf8')));
  const res = await postFindings(ref.repo, ref.pr, findings, makePostClient());
  console.log(`posted ${res.posted} inline + ${res.fileLevel} file-level + ${res.issue} issue; skipped ${res.skipped} (already present) -> ${ref.repo}#${ref.pr}`);
}
```

(`parsePrRef` is already imported in cli.ts from `./events.js`.)

- [ ] **Step 3: Wire the case + usage string**

In the `switch (cmd)` block, add the case (e.g. after the `reviews` case):

```ts
  case 'post-findings': await runPostFindings(rest); break;
```

In the top-level `default:` usage string, add `post-findings` to the command list.

- [ ] **Step 4: Verify the command parses + validates (no network)**

Run: `npx tsx src/cli.ts post-findings`
Expected: prints `usage: post-findings <owner/repo#pr> <findings.json>` (missing args → usage, no throw).

- [ ] **Step 5: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS, exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): post-findings command — post wave findings to a PR

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: the PR-first + post-findings ritual step (WORKBENCH repo)

**This task is in the workbench repo root** (`D:/development/projects/de-braighter/`), not `domains/devloop/`.

**Files:** Modify `CLAUDE.md` (the "Feed the SDLC twin on PRs" ritual bullet).

- [ ] **Step 1: Add the post-findings step to the ritual**

In `CLAUDE.md`, in the bullet that begins `**The ritual** (from \`domains/devloop\`):`, append after the existing sentence:

```markdown
 **Findings (PR-first):** open the PR *before* the verifier wave; after the wave, write its findings to a temp JSON (`[{verifier, severity, path?, line?, text}]`) and run `… post-findings <repo#pr> findings.json` **before merge** — the post-merge `… reviews` harvest then records them per-verifier as `FindingRecorded` events (an inline comment is enough to make the PR harvestable). Idempotent, so a re-run is safe.
```

- [ ] **Step 2: Verify it renders**

Run: `git -C D:/development/projects/de-braighter diff CLAUDE.md` and confirm the sentence is inside the ritual bullet.

- [ ] **Step 3: Commit (on the workbench branch carrying the S2 spec/plan)**

```bash
# from the workbench root D:/development/projects/de-braighter/
git add CLAUDE.md
git commit -m "docs(claude): PR-first + post-findings ritual step (S2)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: live smoke test (orchestrator-run, OUTWARD-FACING)

**Run by the orchestrator, not delegated.** Proves the real client posts + the harvest records it, end-to-end. Posts to a real PR and cleans up.

- [ ] **Step 1: Build a findings.json with an on-diff + a no-path finding**

Pick a recent merged PR (e.g. #65) and a line in its diff (use `gh api repos/de-braighter/devloop/pulls/65/files --jq '.[0].filename'` + read the patch for an added RIGHT line). Write `/tmp/findings.json`:

```json
[
  { "verifier": "reviewer", "severity": "nit", "path": "<a-changed-file>", "line": <an-added-line>, "text": "smoke: inline finding" },
  { "verifier": "qa-engineer", "severity": "should-fix", "text": "smoke: whole-PR concern (no path)" }
]
```

- [ ] **Step 2: Post + harvest + confirm**

```bash
cd D:/development/projects/de-braighter/domains/devloop
npx tsx src/cli.ts post-findings de-braighter/devloop#65 /tmp/findings.json
npx tsx src/cli.ts reviews de-braighter/devloop
grep -o '"verifier":"reviewer","severity":"nit"[^}]*"commentId":[0-9]*' data/events.jsonl | tail -1
```
Expected: `posted 1 inline + 0 file-level + 1 issue; skipped 0`; the harvest records the `reviewer·nit` finding (the issue comment is not harvested — expected).

- [ ] **Step 3: Idempotency re-run**

```bash
npx tsx src/cli.ts post-findings de-braighter/devloop#65 /tmp/findings.json
```
Expected: `posted 0 inline + 0 file-level + 0 issue; skipped 1 (already present) -> …` (the inline one is now de-duped; the issue comment has no path/line signature, so it would re-post — acceptable, note it).

- [ ] **Step 4: Clean up the posted comments**

Delete the smoke comments (capture ids from the post output or list them):

```bash
gh api repos/de-braighter/devloop/pulls/65/comments --jq '.[] | select(.body | contains("smoke:")) | .id' | while read id; do gh api -X DELETE repos/de-braighter/devloop/pulls/comments/$id; done
gh api repos/de-braighter/devloop/issues/65/comments --jq '.[] | select(.body | contains("smoke:")) | .id' | while read id; do gh api -X DELETE repos/de-braighter/devloop/issues/comments/$id; done
```

---

## Definition of done (S2)

- [ ] `npx vitest run` green; `npm run typecheck` exit 0 in `domains/devloop/`.
- [ ] `post-findings <repo#pr> <findings.json>` posts on-diff findings as tagged inline comments, off-diff (path) as file-level, no-path as issue comments — idempotently.
- [ ] Live smoke: a posted inline finding harvests into a `FindingRecorded` with verifier from the tag.
- [ ] `CLAUDE.md` documents the PR-first + post-findings ritual step.

## Deferred (later slices)

- **Verdict-derived-from-findings** unification (so `findings`/`cleanliness` reflect agent findings) — folds in with S3.
- **S3** — `devloop findings <repo>` readout (per-verifier × severity), composed with the `effort` lever.
- **S4** — resolution / precision (finding→fix linkage); harvesting issue comments (the no-path findings) if it earns its keep.
- **Structured reviewer output** — agents emitting findings JSON directly (today the orchestrator hand-builds it from the wave reports).
