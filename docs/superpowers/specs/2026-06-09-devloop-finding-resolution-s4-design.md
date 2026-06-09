# devloop PR-findings — S4: finding resolution + verifier precision (design)

> The deferred prize of the findings arc: not just *how many* findings a verifier raises (S3
> volume), but *how many were real* — addressed vs left open — giving **per-verifier precision**.
> Companion to the parent spec `2026-06-09-devloop-pr-findings-harvest-design.md` (S4 slice).

## The signal: fix-commit linkage (and its honesty)

A finding is **addressed** if a commit on its PR, **dated after** the finding was posted,
**touches its `path`** — and, for an inline finding, a diff hunk covering its `line`. A finding
with no later-touching commit is **open**. A finding with no `path` (a PR-level issue comment)
is **unresolvable** and excluded from precision.

**This is a decision aid, not ground truth.** "A later commit touched the line" ≠ "fixed
*because of* this finding" — a coincidental edit also matches; and timestamp ordering is
vulnerable to clock-skew / rebase date rewrites (rare). Same honesty discipline as the effort
lever's operator-choice warning: the readout labels precision as proxy-derived.

**Why fix-commit linkage over GitHub's "outdated" flag:** review-thread `isResolved` is
unavailable (the token's GraphQL returns 401), and fix-commit linkage additionally resolves
**file-level** findings (no line) that the `position: null` "outdated" signal can't.

## Decisions (settled in brainstorming 2026-06-09)

1. **Signal = fix-commit linkage** (a later commit touches the finding's path[:line]).
2. **Ordering = timestamp** — `commit.committer.date > finding.occurredAt`. No schema add: the
   `FindingRecorded` envelope's `occurredAt` already holds the comment's `createdAt`.
3. **Scope = all findings** (ours + external Copilot/human) — bounded cost, and Copilot precision
   ("is its nit-flagging actionable?") is itself interesting.

## Components

### 1. `src/inference/resolution.ts` — the pure matcher (testable core)

```ts
export interface CommitDiff { sha: string; date: string; files: { filename: string; patch?: string }[]; }
export interface FindingToResolve { path?: string; line?: number; createdAt: string; }

// "@@ -a,b +c,d @@" — line touched if within the old [a,a+b) or new [c,c+d) hunk range.
function patchTouchesLine(patch: string, line: number): boolean { /* matchAll the hunk headers */ }

/** Addressed if a commit dated AFTER the finding touches its path (and line, if inline). */
export function isAddressed(f: FindingToResolve, commits: CommitDiff[]): { addressed: boolean; byCommit?: string };
```

`isAddressed` returns `{addressed:false}` for a finding with no `path` (unresolvable). ISO-8601
UTC date strings compare lexicographically, so `c.date > f.createdAt` is a plain string compare.

### 2. `FindingResolved.v1` event (`src/events.ts`)

`{repo, pr, commentId, addressed: true, byCommit?}` — keyed by `commentId`, idempotent. Resolution
is *observed after* the finding, so it's a separate append-only event joined to `FindingRecorded`
by `commentId`. **Only emitted on `addressed:true`** — "open" is the absence of a resolved event,
which keeps the log append-only and re-runs idempotent (a frozen merged PR re-resolves identically).

### 3. The resolution pass (`src/inference/resolution.ts` + a CLI command)

`resolveFindings(events, client, seen)` — for each `FindingRecorded` envelope with a `path`, group
by PR, fetch the PR's commits + diffs once per PR via the client, run `isAddressed`, emit a
`FindingResolved` per addressed finding (deduped by the existing `dedupKey`/`seen` mechanism).

`ResolutionClient.commits(repo, pr): Promise<CommitDiff[]>` — the real gh client fetches
`pulls/{pr}/commits?per_page=100` (SHA + committer date) then each commit's `files`+`patch` via
`repos/{repo}/commits/{sha}` (parse JSON in TS; bodies are read-only here so no `--input -`
needed). Degrades to `[]` on error (never throws the ingest). Unit-tested via a mock client.

CLI: `devloop resolve-findings <owner/repo>` — appends the resolution events. Run **post-merge in
the ritual** (after `reviews`), when the PR's commits are frozen.

### 4. Per-verifier precision in the readout (`src/inference/findings.ts` + CLI)

Extend `findingsSummary` to join `FindingRecorded` ↔ `FindingResolved` by `commentId`:
per verifier add `resolvable` (findings with a path), `addressed` (resolvable + has a
`FindingResolved`), and `precision = addressed / resolvable` (undefined when `resolvable = 0`).
The `devloop findings <repo>` readout gains a precision column; rows render
`precision NN% (addressed/resolvable)` or `— (no resolvable)`.

## Out of scope (YAGNI)

- A whatif `precision`-by-lever angle (precision is per-verifier, not a per-PR indicator).
- Reply/reaction triage (ground-truth intent) — only if a triage habit emerges.
- The verdict-derived-from-findings unification (the existing `cleanliness` path stays unchanged).
- Dismissed-vs-open distinction (we only positively detect addressed; both non-addressed states
  read as "open").

## Build slices

- **T1** — the pure matcher (`isAddressed` + `patchTouchesLine`) with hunk-parse + ordering tests.
- **T2** — `FindingResolved.v1` event.
- **T3** — `resolveFindings` pass + `ResolutionClient` (mock-tested) + real gh client + the
  `resolve-findings` CLI command.
- **T4** — precision join in `findingsSummary` + the readout column.
- **T5** — docs: ritual step (`resolve-findings` post-merge), m2 doc note; orchestrator-run live
  smoke (`resolve-findings de-braighter/devloop`, confirm a `FindingResolved` lands + precision shows).

## Honesty the readout must carry

The `findings` readout's precision column header notes it is **proxy-derived (fix-commit linkage)**
— a real fix elsewhere, or a coincidental same-line edit, both bias it. It ranks/compares verifier
actionability; it is not a verified accept/reject rate.
