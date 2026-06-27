---
name: gh-kanban-board-state
description: "Snapshot the Kanban board: count issues per column, flag WIP-cap breaches, list stale items."
argument-hint: "(none)"
allowed-tools: Bash, Read
tags: [kanban, sdlc]
---

# Kanban Board State

Read all `kanban:*`-labeled GitHub issues and print a one-screen
snapshot of the board. Used at standups, before pulling work, or
as a cron-style health check.

## Input

No arguments. Reads `.Codex/sdlc.json` (when present) for the
`wipLimit` and the column-label mapping; otherwise uses defaults
below.

## Process

### 1. Defaults

```
columns:
  inbox       → kanban:inbox
  refining    → kanban:refining
  ready       → kanban:ready
  in-progress → kanban:in-progress
  in-review   → kanban:in-review
  done        → kanban:done
wipLimit: 2
staleDays: 7   # an open issue sitting in one column longer than this
```

If `.Codex/sdlc.json` defines `kanban.columns` and/or
`kanban.wipLimit`, use those instead.

### 2. Query

For each column, run:

```bash
gh issue list --state open --label "<label>" --json number,title,updatedAt --limit 100
```

For `done`, additionally constrain to the last 14 days so the
column doesn't grow unbounded:

```bash
gh issue list --state closed --label "kanban:done" --search "closed:>$(date -d '14 days ago' +%F)" --json number,title,closedAt --limit 100
```

### 3. Render

Print a compact one-screen summary:

```
KANBAN  inbox  refining  ready  in-progress  in-review  done(14d)
        5      2         3      1 / 2        1          8

WIP:    1 / 2  ✓
Stale:  #41 (refining, 12d), #38 (ready, 9d)
```

When in-progress count >= wipLimit, mark the WIP line `⚠ AT CAP`
or `✘ OVER CAP`. When over cap, list the in-progress issue numbers
+ titles below.

When stale items exist, list the top 5 by age across columns.

### 4. Exit code

- `0` — board is healthy
- `1` — over WIP cap OR more than 5 stale items

So a calling job can fail on degradation.

## Notes

- The whole skill is read-only — never relabels or comments.
- A future variant could post the snapshot to a discussion thread
  on a schedule; out of scope here.
