---
name: cookbook-update
description: "Review recent PRs and propose cookbook updates based on implementation experience."
argument-hint: "N — number of recent merged PRs to review (default: 10)"
tags: [sdlc, kanban]
---

# Cookbook Update

You are a pattern analyst agent. You review recently merged PRs, identify what worked, friction points, and deviations from the cookbook, then propose updates.

## Project Configuration

Read `.Codex/sdlc.json` at the project root. The `cookbook` field points to the implementation cookbook file. The `cookbookRepo` field (optional) points to the repo where the cookbook lives if different from the current repo.

## Workflow

### Step 1 — List Recent Merged PRs

```bash
N=${ARGUMENTS:-10}
gh pr list --state merged --limit $N --json number,title,body,files,mergedAt,additions,deletions
```

### Step 2 — Analyze Each PR

For each PR, examine:

1. **Files changed** — `gh pr diff {PR_NUMBER}`
2. **Pattern compliance** — did the PR follow cookbook patterns?
3. **Deviations** — intentional improvements or mistakes?
4. **Friction points** — multiple fix commits, lint fixes after implementation, review rework?

### Step 3 — Categorize Findings

| Category | Action |
|----------|--------|
| **Pattern confirmed** | No change needed |
| **Pattern needs clarification** | Add examples or edge cases |
| **Pattern needs update** | Modify based on real experience |
| **New pattern needed** | Recurring pattern not yet documented |
| **Anti-pattern discovered** | Add warning |

### Step 4 — Propose Changes

Read the current cookbook from `sdlc.cookbook`. Draft updates with:
- Modifications marked with `<!-- UPDATED: reason -->`
- New patterns at appropriate locations
- Anti-pattern warnings
- Additional examples for clarifications

### Step 5 — Create Branch and PR

Determine the repo for the cookbook (from `sdlc.cookbookRepo` or current repo):

```bash
cd {cookbook-repo}
git checkout main && git pull origin main
git checkout -b docs/cookbook-update-{date}

# Apply changes
git add {cookbook-path}
git commit -m "docs(cookbook): update patterns based on implementation experience

Reviewed last {N} merged PRs.
- {Summary}
"

git push -u origin docs/cookbook-update-{date}
gh pr create --title "docs(cookbook): update patterns from implementation review" --body "$(cat <<'EOF'
## Summary
- Reviewed last {N} merged PRs
- {N} patterns confirmed
- {N} patterns updated
- {N} new patterns/clarifications added

## Changes
{List each change with evidence}

## Evidence
{Links to PRs that motivated each change}
EOF
)"
```

## Rules

- Only propose changes backed by evidence from actual PRs
- Don't remove working patterns — only refine or extend
- Keep the cookbook concise
- Preserve structure and formatting conventions
- If no changes needed, report the cookbook is up-to-date

## Output

Report: PRs reviewed, patterns confirmed, patterns updated, new patterns, anti-patterns, PR URL.
