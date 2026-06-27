---
name: story-picker
description: "Find the next story ready to start. Reads .Codex/sdlc.json to decide source: github-issues (kanban:ready labelled) or gap-analysis.md BACKLOG rows."
argument-hint: "[--phase PHASE] [--epic EPIC] [--list] [--json] — optional filters"
allowed-tools: Bash, Read
tags: [sdlc, kanban]
---

# Story Picker

Find the next story to implement, respecting the project's source of
truth and any priority order.

## Project Configuration

Read `.Codex/sdlc.json` at the project root. Relevant fields:

| Field | Mode | Default |
|---|---|---|
| `source` | both | `"gap-analysis"` |
| `gapAnalysis` | file mode | (required when file mode) |
| `phaseOrder` | file mode | `["0a","0b","1","2","3","3b","4","5","6"]` |
| `kanban.columns.ready` | github mode | `"kanban:ready"` |
| `repository` | github mode | inferred from `gh repo view` |

Source is `"github-issues"` or `"gap-analysis"`. If unset, fall back
to `"gap-analysis"` for backward compatibility.

## Workflow — github-issues mode

When `source: "github-issues"`:

1. Resolve the Ready label from `kanban.columns.ready` (default
   `kanban:ready`).
2. Run:
   ```bash
   gh issue list \
     --label "$READY_LABEL" \
     --state open \
     --json number,title,body,labels,createdAt,url \
     --limit 100
   ```
3. Apply optional argument filters:
   - `--phase X` → keep issues with label `phase:X`
   - `--epic NAME` → keep issues with label `epic:NAME` or whose
     title contains `NAME` (case-insensitive)
4. Sort by `createdAt` ascending (FIFO — oldest Ready picked first).
   This is intentional: items refined earliest get picked first
   without needing an explicit priority field.
5. Return the first match (or list all when `--list`).

## Workflow — gap-analysis mode

When `source: "gap-analysis"`:

1. Read the gap analysis file from `sdlc.gapAnalysis`.
2. Parse all story tables (format:
   `| Story | Description | Acceptance Criteria | Size | Status | Branch |`).
3. Filter to stories with `Status = BACKLOG`.
4. Apply optional filters from arguments: `--phase` (e.g., `0a`,
   `1`, `2`), `--epic` (partial match).
5. Sort by phase priority (using `sdlc.phaseOrder` or the default),
   then by story ID (natural sort).
6. Return the first match.

## Output Modes

**Default** — Human-readable summary:
- Story ID (or issue `#N` for github mode), Phase/Epic if set, Size
- Description and Acceptance Criteria
- Suggested next step: `/story-runner {ID}` (story id or issue number)

**`--list`** — All ready candidates grouped by phase (file mode) or
sorted by FIFO (github mode).

**`--json`** — Machine-readable JSON for automation:

```json
{
  "found": true,
  "source": "github-issues",
  "issueNumber": 42,
  "url": "https://github.com/org/repo/issues/42",
  "title": "...",
  "description": "...",
  "acceptanceCriteria": "...",
  "size": "M",
  "epic": "...",
  "phase": null
}
```

For `gap-analysis` mode, `issueNumber`/`url` are omitted and
`storyId` is included instead.

## Notes

- This skill is read-only — never relabels issues or edits files.
  Use `gh-wip-enforcer` to actually start (Ready → In Progress).
- For github-issues mode, FIFO ordering trumps explicit priority on
  purpose: discipline the board by labelling things Ready in the
  order you want them done.
- If no candidates remain, report it clearly and suggest looking at
  Refining (`gh issue list --label kanban:refining`) or topping up
  the backlog.
