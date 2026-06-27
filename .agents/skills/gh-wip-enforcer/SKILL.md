---
name: gh-wip-enforcer
description: "Refuse to start a new story when the in-progress count is at or over the WIP cap. Either allow + relabel, or block with reasoning."
argument-hint: "ISSUE_NUMBER — the GitHub issue to move into in-progress (e.g. 42)"
allowed-tools: Bash, Read
tags: [kanban, sdlc, governance]
---

# WIP Enforcer

Gate for the **Ready → In Progress** transition. Reads the current
in-progress count, compares to the cap, and either allows the move
(by relabeling) or refuses with a list of what's already in flight.

## Input

`$ARGUMENTS` is the GitHub issue number to start (e.g. `42`).

## Process

### 1. Resolve cap

Read `.Codex/sdlc.json` for `kanban.wipLimit`. Default to `2` when
the file or key is missing.

### 2. Read the issue

```bash
gh issue view "$ARGUMENTS" --json number,title,labels > /tmp/issue.json
```

Validate:
- Issue has label `kanban:ready` (else: refuse — the issue isn't in
  the column we're moving from).
- Issue isn't already labeled `kanban:in-progress` (idempotent).

### 3. Count current WIP

```bash
gh issue list --state open --label kanban:in-progress --json number,title
```

### 4. Decide

**Allow** (count + 1 ≤ cap):
1. Relabel: `gh issue edit "$ARGUMENTS" --remove-label kanban:ready --add-label kanban:in-progress`
2. Print: `STARTED: #$ARGUMENTS — wip now <new>/<cap>`

**Block** (count + 1 > cap):
1. Comment on `$ARGUMENTS` with the current WIP issues + suggest
   finishing one before starting this.
2. Print:
   ```
   BLOCKED: #$ARGUMENTS — wip cap <cap> reached
   In progress:
     #N1  <title>
     #N2  <title>
   Finish one (move to in-review or done) and re-run.
   ```
3. Exit non-zero.

## Notes

- Keep the cap small for a solo workshop (1–3). Higher caps reward
  multitasking, which Kanban deliberately discourages.
- This skill writes one label edit on success; it doesn't create
  branches, PRs, or commits — that's `story-runner`'s job.
