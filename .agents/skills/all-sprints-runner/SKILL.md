---
name: all-sprints-runner
description: "Execute ALL approved sprints sequentially and fully autonomously. Zero human intervention between sprints."
tags: [autonomous, sprint]
---

# All-Sprints Runner

Execute **all approved sprints** sequentially, from first to last, fully autonomously.

> **Pre-condition:** All sprint plans must be approved before running this skill. This skill removes the human gate between sprints — once started, it runs until every sprint is complete or a fatal error halts execution.

## Project Configuration

Read `.Codex/sdlc.json` at the project root. Stop if missing.
All values below reference this config via `sdlc.*` notation.

## CRITICAL EXECUTION RULES

> **NEVER STOP between sprints.** After completing a sprint, IMMEDIATELY start the next one. Do NOT:
> - Ask the user if you should continue
> - Summarize progress and wait for confirmation
> - Say "should I continue?" or "Sprint X is next in the queue"
> - Cite context limits as a reason to pause
> - Generate a "handoff state" for a new session
>
> The ONLY reasons to stop are listed in **Fatal errors** below. Everything else = keep going.
>
> After finishing Sprint N's retro, the very next action must be loading Sprint N+1's plan issue.
> If you run out of context, use `/context-minimizer` to compress, or start a sub-agent for the next sprint.
> **The user said "loop until done" — respect that.**

## Overview

Each sprint runs the full `/sprint-runner` lifecycle:
1. Load plan → 2. Execute stories → 3. Tech debt cleanup → 4. Retro → 5. Next sprint

## Execution

### Step 1 — Discover Sprint Queue

```bash
# Get all open approved sprint plan issues, sorted by sprint number
gh issue list --repo {sdlc.repo} \
  --label "{sdlc.sprint.labels.plan}" --state open \
  --json number,title --jq 'sort_by(.title | capture("Sprint (?<n>[0-9]+)").n | tonumber) | .[] | "\(.number) \(.title)"' \
  --limit 50
```

Build the ordered sprint queue from the results.

### Step 2 — Pre-flight

```bash
git checkout main
git pull origin main
git status --porcelain  # Must be empty
```

Run all verification commands from config (lint, test, build) to verify the codebase is green before starting.

If pre-flight fails: fix the issue before proceeding. The codebase must be **clean** at the start — zero errors AND zero warnings (if `sdlc.lint.zeroWarnings` is true).

### Step 3 — Sprint Loop

```
for each SPRINT_PLAN in sprint_queue:
    run_sprint(SPRINT_PLAN)
```

For each sprint, execute the **full sprint-runner lifecycle** (see `/sprint-runner`):

#### 3a — Load Sprint Plan

1. Read the sprint plan issue body
2. Parse the stories table (story ID, issue number, epic, points, execution order)
3. Move stories from `{sdlc.sprint.labels.backlog}` to `{sdlc.sprint.labels.current}`
4. Post kickoff comment on the sprint plan issue

#### 3b — Execute Each Story

For each story in execution order:

1. **Pre-flight:** `git checkout main && git pull origin main && git status --porcelain`
2. **Check blockers:** Skip if `{sdlc.sprint.labels.blocked}`, reorder if dependency not done
3. **Branch:** `git checkout -b feature/{STORY_ID}-{short-description}`
4. **Read:** Gap analysis, epic doc, cookbook, design system, test infra (all paths from sdlc.json)
5. **Implement:** Follow cookbook patterns
6. **Test:** Write tests meeting `sdlc.test.min` thresholds
7. **Verify:** Run all commands from `sdlc.lint.commands`, `sdlc.test.commands`, `sdlc.build.commands`
8. **Fix failures:** Up to `sdlc.sprint.maxFixAttempts` per step, then mark blocked and skip
9. **Scan for tech debt:** Create debt issues for anything found
10. **Commit:** `feat({scope}): {STORY_ID} — {description}`
11. **Push + PR:** Create PR with full template
12. **MANDATORY Copilot review gate (see sprint-runner Step 2g for full details):**
    - Wait for CI checks (`gh pr checks --watch`)
    - Wait `sdlc.sprint.reviewWaitSeconds`, then check BOTH `/pulls/{PR}/reviews` AND `/pulls/{PR}/comments`
    - If no Copilot review found, retry up to `sdlc.sprint.maxReviewRounds` times
    - **Read ALL review comments** — empty comments ≠ reviewed
    - Fix ALL findings before proceeding (up to `sdlc.sprint.maxFixAttempts` rounds)
    - Log Copilot review outcome in sprint plan comment
    - **NEVER merge without confirming Copilot has actually reviewed**
13. **Definition of Done — verify ALL before merge:**
    - Acceptance criteria met
    - Lint: zero errors (+ zero warnings if `sdlc.lint.zeroWarnings`)
    - Build: succeeds
    - Tests pass and meet `sdlc.test.min` thresholds
    - CHANGELOG.md updated
    - i18n: all languages from `sdlc.i18n` added
    - Copilot review: received, read, and findings resolved
    - PR description complete
14. **Merge:** `gh pr merge --squash --delete-branch`
15. **Close issue:** Comment "Completed in PR #{PR_NUMBER}"
16. **Update progress:** Comment on sprint plan issue
17. **Return to main:** `git checkout main && git pull origin main`

#### 3c — Tech Debt Phase

After all stories in the sprint are done or skipped:

1. List all open `{sdlc.sprint.labels.techDebt}` issues
2. Triage: Critical → fix now, High → fix if capacity, Medium/Low → backlog
3. Fix critical/high items (branch, fix, test, PR, merge)
4. Post debt summary on sprint plan issue

#### 3d — Sprint Retrospective

1. Count completed vs planned points → velocity
2. Gather per-story metrics (PR size, Copilot rounds, test count)
3. Create retro issue with full analysis
4. Clean up labels: spillover → `{sdlc.sprint.labels.backlog}`, completed stays
5. Close the sprint plan issue

#### 3e — Transition to Next Sprint (IMMEDIATE — NO PAUSE)

> **DO NOT** summarize, ask the user, or generate a "handoff". Jump straight to the next sprint.

1. Post transition comment on next sprint plan issue
2. **Immediately** begin Step 3a (Load Sprint Plan) for the next sprint
3. There is NO human gate here — all plans are pre-approved

```bash
gh issue comment {NEXT_SPRINT_PLAN} --repo {sdlc.repo} \
  --body "Auto-transitioning from Sprint {N} (velocity: {Y}pts). Beginning Sprint {N+1}."
```

Then **without any pause or user message**, start executing the next sprint.

### Step 4 — Completion

After the last sprint is done:

```bash
gh issue create --repo {sdlc.repo} \
  --title "All Sprints Complete — Full Product Build Summary" \
  --label "type:refinement" \
  --body "$(cat <<'EOF'
## Full Build Complete

All {total_sprints} sprints executed autonomously.

### Overall Metrics
- Total stories: {total_stories}
- Total points: {total_points}
- Stories completed: {completed}
- Stories skipped/blocked: {skipped}
- Tech debt items created: {debt_created}
- Tech debt items resolved: {debt_resolved}
- Average velocity: {avg_velocity} pts/sprint

### Sprint-by-Sprint Summary
| Sprint | Planned | Completed | Velocity | Debt Created | Debt Fixed |
|--------|---------|-----------|----------|--------------|------------|
| 1      | ...     | ...       | ...      | ...          | ...        |

### Open Items
- Blocked stories requiring human intervention: ...
- Unresolved tech debt: ...
- Follow-up issues created: ...
EOF
)"
```

## Error Recovery

### Recoverable errors (auto-handled)

| Error | Recovery |
|-------|----------|
| Lint failure | Fix and re-run (up to `sdlc.sprint.maxFixAttempts`) |
| Test failure | Fix test or implementation, re-run |
| Build failure | Fix build error, re-run |
| Merge conflict | Pull main, rebase branch, resolve, push |
| Copilot requests changes | Apply fixes, push new commit |
| Git dirty working tree | Stash, return to main, pull, unstash if relevant |
| Network timeout on gh commands | Retry up to 3x with 10s delay |

### Non-recoverable errors (skip story, continue sprint)

| Error | Action |
|-------|--------|
| Max fix attempts failed | Mark story blocked, create investigation issue, skip |
| Max Copilot rounds exceeded | Escalate to human review, skip story |
| External dependency missing | Mark blocked, document blocker, skip |
| Story scope explosion | Implement what fits, create follow-up issue, close original |

### Fatal errors (halt execution)

| Error | Action |
|-------|--------|
| Main branch is broken (tests failing on main) | Stop all execution, create urgent issue |
| Git repository corrupted | Stop, alert |
| GitHub API consistently failing | Stop after 3 consecutive API failures |

On fatal error:
```bash
gh issue comment {CURRENT_SPRINT_PLAN} --repo {sdlc.repo} \
  --body ":rotating_light: **FATAL: Sprint execution halted**

  Error: {description}
  Last completed story: {STORY_ID}
  Stories remaining: {count}

  Manual intervention required. Resume with \`/all-sprints-runner\` after fixing."
```

## Resumability

If execution is interrupted (crash, timeout, manual stop), running `/all-sprints-runner` again will:

1. Find all open sprint plan issues (sprints not yet closed)
2. For the current sprint: check which stories are already closed → skip those
3. Continue from the first uncompleted story
4. The sprint queue handles itself — completed sprints have closed plan issues

This means the runner is **idempotent** — safe to restart at any point.

## Invocation

```
/all-sprints-runner          # Run all remaining open sprints
```

No arguments needed. It discovers the queue automatically from open sprint plan issues.
