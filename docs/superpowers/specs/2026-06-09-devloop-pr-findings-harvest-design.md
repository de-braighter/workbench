# devloop — PR-comment findings harvest: capture agent review findings at the finding level (design)

> **Status (2026-06-09): S1–S4 all SHIPPED.** S1 capture (devloop#65) · S2 posting (#66) · S3 readout +
> whatif `findings` indicator (#67) · S4 resolution + per-verifier precision (#68, design in the
> sibling `2026-06-09-devloop-finding-resolution-s4-design.md`). The "deferred" notes below are historical.

> Let our verifier-wave agents **post their findings as tagged PR review comments**, and
> deepen the existing review harvest from comment-**counting** to finding-**recording** — so
> per-verifier, per-severity findings become durable, queryable data instead of evaporating.

## Context — what already exists (don't re-derive)

`domains/devloop/src/ingest/pr-reviews.ts` already harvests PR reviews via `gh` (the
`reviews` CLI command → `runReviews` → `harvestPrReviews` + `makeReviewClient`, cli.ts ~149):

- `reviewedPrs(repo)` — one `gh pr list --state merged --json number,reviews` per repo.
- `commentAuthors(repo, pr)` — `gh api repos/{repo}/pulls/{pr}/comments --paginate`, returns
  **only the login** of each inline review comment (the body is thrown away).
- `classifyReviewer(login)` normalizes a login → verifier id (`copilot` / `<bot>` / pooled
  `human`); `summarizeReviewers` + `reviewToVerdict` emit a per-reviewer **aggregate** verdict
  (`notes = comment count`; `CHANGES_REQUESTED → BLOCKING`). Idempotent via content dedup.

**Two gaps:**

1. **Production** — our verifier-wave agents (`reviewer`, `qa-engineer`, `charter-checker`,
   spec-compliance) report findings to the orchestrator and **evaporate**; they never post to
   the PR, so the harvest never sees them (the `dev-observation-signal-not-captured` problem).
2. **Identity-collapse trap** — GitHub attributes any comment our agents post to the
   **authenticated login** (the founder's token). `classifyReviewer` would pool every agent
   finding into the single `human` bucket, destroying the per-verifier identity that makes
   "deeper" worth anything. **Fix: encode the verifier identity in the comment body, not the
   login.**

## Decisions (settled in brainstorming 2026-06-09)

1. **Source of truth = GitHub inline PR comments; extend the existing harvest.** (Not a
   parallel direct-capture stream.) Reuses the running spine; gives a real human-visible
   review trail; gh-ingestible; stable comment IDs for dedup.
2. **One inline comment per finding**, line-attached, tagged `[verifier · severity]` with a
   hidden machine tag. Off-diff findings → a PR-level issue comment with the same tag.
3. **Centralized posting** — the orchestrator posts the reviewers' returned findings via a new
   `devloop post-findings` command (agents stay read-only-returning; one consistent gh-write
   surface; identity comes from the tag, sidestepping login-collapse).
4. **New pack-level event `FindingRecorded.v1`** as the deep grain; the existing per-reviewer
   `verdict` becomes a **derived aggregate** of findings, so `findings`/`cleanliness` keep
   working from one source.
5. **Severity normalizes to a small fixed set** `blocking | should-fix | nit | note` (`note` =
   the default for untagged external comments). Aggregate mapping: `blocking → blocking`
   bucket; the rest → `notes` bucket.
6. **Resolution / precision deferred** to a named later slice (needs finding→fix linkage; thin
   in same-session autonomous merges).

## The unifying model

Promote the harvest from comment-**counting** to finding-**recording**. Every inline review
comment becomes a `FindingRecorded` — **ours** (tagged) and **theirs** (Copilot / human,
untagged → verifier from login, severity `note`). External findings (e.g. Copilot's) become
individually tracked too. The per-reviewer aggregate `verdict` is then *derived* from grouping
findings, so the existing `findings`/`cleanliness` indicators read a single source.

## Components (exact seams)

### 1. Tag convention + parser — `src/ingest/finding-tag.ts` (new, pure)

A finding comment body:

```
[qa-engineer · BLOCKING] missing auth check on the mutation
<!-- devloop:finding v=qa-engineer s=blocking -->
```

- `formatFindingBody(verifier, severity, text): string` — human prefix + hidden HTML-comment
  machine tag (HTML comments don't render on GitHub).
- `parseFindingTag(body): { verifier: string; severity: Severity } | null` — reads the machine
  tag; `null` for an untagged (external) comment.

`Severity = 'blocking' | 'should-fix' | 'nit' | 'note'`.

### 2. Event — `src/events.ts`

Add `FINDING: 'devloop:FindingRecorded.v1'` to `EVENT`, a `Finding` zod schema, a `finding()`
constructor, and a `FindingPayload` type:

```ts
const Finding = z.object({
  repo: z.string(), pr: z.number().int(),
  verifier: z.string(), severity: z.enum(['blocking', 'should-fix', 'nit', 'note']),
  path: z.string().optional(), line: z.number().int().optional(),
  commentId: z.number().int(), // GitHub inline-comment id — the stable dedup key
  text: z.string(),
});
```

`aggregateType: 'PullRequest'`, `actorRef: 'verifier:<verifier>'`. Dedup by `commentId`
(idempotent re-harvest).

### 3. Poster — `src/post/findings.ts` + `post-findings` CLI command

`postFindings(repo, pr, findings: { verifier, severity, path?, line?, text }[], client)`:

- For a finding with `path` + `line` **in the diff**: `gh api repos/{repo}/pulls/{pr}/comments`
  POST with `body` (from `formatFindingBody`), `commit_id` (PR head SHA), `path`, `line`,
  `side: 'RIGHT'`.
- Off-diff (no path/line, or the line isn't in the diff → GitHub 422): fall back to a PR-level
  issue comment (`gh pr comment`) with the same tagged body.
- **Idempotency:** before posting, list existing `pulls/{pr}/comments`; skip any finding whose
  `(verifier, path, line, text)` already has a matching tagged comment. Re-runs are safe.

CLI: `post-findings <repo#pr> <findings.json>` — the orchestrator writes the wave's returned
findings to a temp JSON and calls this once, pre-merge.

### 4. Harvest extension — `src/ingest/pr-reviews.ts`

- Widen `ReviewClient.commentAuthors` → `comments(repo, pr): Promise<RawComment[]>` where
  `RawComment = { login, body, path?, line?, id }` (the real client already calls
  `pulls/{pr}/comments` — just stop discarding the extra fields).
- New pure `commentToFinding(repo, pr, c): FindingPayload` — `parseFindingTag(c.body)` gives
  `(verifier, severity)`; untagged → `verifier = classifyReviewer(c.login)`, `severity = 'note'`.
- `harvestPrReviews` emits a `FindingRecorded` per comment **and** the derived per-reviewer
  `verdict` (state `CHANGES_REQUESTED` or any `blocking`-severity finding → `BLOCKING` with
  `blocking` = count of blocking findings (min 1); else any findings → `NOTES`,
  `notes` = finding count; else `PASS`). Both dedup independently (finding by `commentId`,
  verdict by content) so re-harvest stays idempotent.

### 5. Readout — `devloop findings <repo>` + `src/inference/findings.ts`

Group `FindingRecorded` by `(verifier, severity)` within a repo: finding volume per verifier
by severity, and which verifier catches what. Composes with the `effort` lever
(`findings`-by-`effort`).

### 6. Workflow & timing (one behavioral change)

The harvest reads **merged** PRs, and the autonomous flow merges seconds after review.
Therefore: **open the PR → run the verifier wave → `post-findings` (pre-merge) → merge →
ritual harvest sweeps them**. This makes the flow **PR-first** (open the PR before the wave,
instead of wave-on-branch-then-PR). Posting is pre-merge; harvesting is the post-merge ritual's
`reviews` step.

## Out of scope (YAGNI — named upgrade path)

- **Resolution / precision** — each finding's fate (addressed vs dismissed → verifier
  *precision*, not just volume). Needs finding→fix linkage or a triage step. **Next slice.**
- Comment threading / replies, false-positive labels, severity sub-taxonomies — later.

## Pre-flight risk

The `gh` token is `repo + write:packages` (no `read:org`). Posting to `pulls/{pr}/comments` is a
`repo`-scoped write and should work, but **slice-1 Task 1 verifies a single round-trip post**
(post → read back → delete) before anything is built on it. If it fails, escalate (token scope)
before proceeding.

## Slice plan

- **S1 — capture pipeline (this spec's core):** the tag convention + parser; `FindingRecorded.v1`;
  the harvest extension (comments-with-bodies → findings + derived verdict); idempotent dedup.
  *Pre-flight:* the gh round-trip post check. *No posting wired into the wave yet* — seed with a
  hand-posted tagged comment to prove the harvest path.
- **S2 — posting:** `src/post/findings.ts` + `post-findings` CLI (inline + off-diff fallback +
  idempotency); the orchestrator calls it pre-merge in the verifier wave; PR-first workflow doc.
- **S3 — readout:** `devloop findings <repo>` + `src/inference/findings.ts` (per-verifier ×
  severity), composed with the `effort` lever.
- **S4 (deferred)** — resolution / precision (finding→fix linkage).

## CLAUDE.md / ritual updates

- Document the **PR-first** wave ordering + the `post-findings` step in the "Feed the SDLC twin"
  section (the orchestrator posts the wave's findings before merge).
- The post-merge ritual already runs `reviews` (via the harvest) — note it now records findings,
  not just counts.
