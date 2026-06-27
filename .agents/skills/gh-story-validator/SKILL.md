---
name: gh-story-validator
description: "Validate a GitHub issue is Ready: scoped, sized, criteria written, dependencies clear. Relabel kanban:refining → kanban:ready on pass."
argument-hint: "ISSUE_NUMBER — the GitHub issue to validate (e.g. 42)"
allowed-tools: Bash, Read
tags: [kanban, sdlc, governance]
---

# Story Validator

Quality gate for the **Refining → Ready** transition in the Kanban
flow. Runs against a GitHub issue and decides whether it's
well-formed enough for an engineer to pull from Ready.

## Input

`$ARGUMENTS` is the GitHub issue number (e.g. `42`).

## Process

### 1. Read the issue

```bash
gh issue view "$ARGUMENTS" --json number,title,body,labels,assignees > /tmp/issue.json
```

### 2. Run checks

A story passes when **all** of the following hold. Comment on the
issue with a checklist of what was checked, ticked or unticked.

- [ ] Has label `kanban:refining` (else it isn't being validated for
      this transition; refuse and explain).
- [ ] Has a `size:S`, `size:M`, or `size:L` label (no `size:XL`,
      no missing — XL stories should be split first).
- [ ] Body contains a `## Goal` section with at least one sentence.
- [ ] Body contains a `## Acceptance Criteria` section with at
      least one item (line starts with `- ` or `* ` or numbered).
- [ ] Body contains a `## Scope` section (what's in; what's out
      may be a subsection or omitted).
- [ ] Every issue referenced in the body via `depends on #N` is
      either closed OR labeled `kanban:done`. Use
      `gh issue view N --json state,labels` per dependency.

### 3. Decide

**On pass:**
1. Relabel: `gh issue edit "$ARGUMENTS" --remove-label kanban:refining --add-label kanban:ready`
2. Comment: a one-line confirmation plus the ticked checklist.
3. Print: `READY: #$ARGUMENTS`

**On fail:**
1. Comment with the unticked items and what they need.
2. Leave the `kanban:refining` label intact — the owner edits and re-runs.
3. Print: `BLOCKED: #$ARGUMENTS — <count> issue(s)`.
4. Exit with non-zero so a calling pipeline knows.

## Notes

- This skill is read-mostly + one label edit; no branch creation, no
  code changes. It's safe to run repeatedly.
- The size taxonomy (`size:S/M/L`) and label names are conventions
  this skill enforces. Adjust the labels list in `.Codex/sdlc.json`
  (`labels.size`, `labels.refining`, `labels.ready`) if your repo
  uses different names.
