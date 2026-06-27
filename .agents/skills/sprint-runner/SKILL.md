---
name: sprint-runner
description: "Execute an entire sprint fully autonomously — pick up approved sprint plan, implement every story in order, handle blockers, clean up tech debt, run retro."
argument-hint: "[SPRINT_NUMBER] — optional sprint number (e.g. 5). If omitted, runs the earliest open sprint plan."
tags: [autonomous, sprint]
---

# Sprint Runner

Execute **Sprint {N}** fully autonomously.

> **Human gates:** The sprint plan must be approved before this skill runs. Everything after approval is autonomous — implementation, testing, PRs, Copilot fix loops, tech debt cleanup, retrospective, and next sprint planning.

## Project Configuration

Read `.Codex/sdlc.json` at the project root. Stop if missing.
All values below reference this config via `sdlc.*` notation.

## Phase 1 — Load Sprint Plan

1. **Find the approved sprint plan:**
   ```bash
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.plan}" --state open --json number,title,body --jq '.[] | select(.title | test("Sprint [0-9]+ Plan"))'
   ```
   If a sprint number was provided, find the specific plan issue. Otherwise pick the earliest open sprint plan.

2. **Parse the sprint plan issue body:**
   - Extract the **Stories** table: story ID, issue number, epic, points
   - Extract the **Execution Order** if specified (otherwise use the table order)
   - Extract the **Tech Debt** table if present
   - Note any **Risks** and **Blocked** stories

3. **Verify sprint stories are labeled `{sdlc.sprint.labels.current}`:**
   ```bash
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.current}" --state open --json number,title,labels
   ```
   If stories are still labeled `{sdlc.sprint.labels.backlog}`, move them:
   ```bash
   gh issue edit {NUMBER} --repo {sdlc.repo} --add-label "{sdlc.sprint.labels.current},status:ready" --remove-label "{sdlc.sprint.labels.backlog}"
   ```

4. **Post sprint kickoff comment:**
   ```bash
   gh issue comment {SPRINT_PLAN_NUMBER} --repo {sdlc.repo} \
     --body "## Sprint {N} Execution Started

   Autonomous sprint runner activated. Executing {count} stories in order.

   | # | Story | Status |
   |---|-------|--------|
   | 1 | {STORY_ID} | :hourglass: Queued |
   | 2 | {STORY_ID} | :hourglass: Queued |
   | ... | ... | ... |

   Updates will be posted as each story completes."
   ```

## Phase 2 — Execute Stories (Loop)

For each story in execution order, run the full story lifecycle.

### Pre-flight check (before each story)

```bash
# Ensure we're on main and up to date
git checkout main
git pull origin main

# Verify clean working tree
git status --porcelain
```

If working tree is dirty, stash or abort.

### Story Lifecycle

For each story `{STORY_ID}` with issue `#{ISSUE_NUMBER}`:

#### Step 2a — Read the Story

1. Read the issue to get acceptance criteria:
   ```bash
   gh issue view {ISSUE_NUMBER} --repo {sdlc.repo} --json body,title,labels
   ```

2. Read the gap analysis for full story details:
   - Search `{sdlc.gapAnalysis}` for the story ID
   - Read the corresponding epic doc from `{sdlc.epics}`

3. Read implementation references:
   - Cookbook: `{sdlc.cookbook}`
   - Design system: `{sdlc.designSystem}`
   - Test infra: `{sdlc.testInfrastructure}`

#### Step 2b — Check for Blockers

- If the story has label `{sdlc.sprint.labels.blocked}`: **skip it**, update sprint plan comment, move to next story
- If the story requires an ADR (`{sdlc.sprint.labels.needsAdr}`): write the ADR first, then continue
- If the story depends on another story not yet completed in this sprint: **reorder** — do the dependency first

#### Step 2c — Create Branch

```bash
# Branch naming: feature/{STORY_ID}-{short-kebab-description}
git checkout -b feature/{STORY_ID}-{short-description}
```

#### Step 2d — Implement

Follow the implementation workflow from the story-runner skill:

1. **Identify files** that need to change — list them before coding
2. **Implement** following cookbook patterns exactly
3. **Write tests** using shared test infrastructure (minimum test count from `sdlc.test.min`)
4. **Scan for tech debt** — create debt issues for anything found (see Tech Debt Discovery below)

#### Step 2e — Verify

> **Clean desk policy:** If `sdlc.lint.zeroWarnings` is true, lint must produce **zero errors AND zero warnings**. Do not accept "0 errors, N warnings" — fix all warnings before proceeding.

Run all verification commands from the config:

```bash
# Lint commands from sdlc.lint.commands
# Test commands from sdlc.test.commands
# Build commands from sdlc.build.commands
```

If any step fails:
- **Lint error:** Fix the lint error, re-run
- **Lint warning:** Fix the warning too (if zero-warnings policy is active)
- **Test failure:** Fix the test or implementation, re-run
- **Build failure:** Fix the build error, re-run
- **Max `{sdlc.sprint.maxFixAttempts}` fix attempts per verification step.** If still failing:
  - Label the story `{sdlc.sprint.labels.blocked}`
  - Comment on the issue: "Build/test failing after {sdlc.sprint.maxFixAttempts} fix attempts. Needs human investigation."
  - Skip to next story

#### Step 2f — Commit and PR

```bash
# Stage and commit
git add -A
git commit -m "feat({scope}): {STORY_ID} — {description}"

# Push branch
git push -u origin feature/{STORY_ID}-{short-description}

# Create PR
gh pr create --repo {sdlc.repo} \
  --title "{STORY_ID}: {description}" \
  --body "$(cat <<'PRBODY'
## Summary
{1-3 bullet points}

## Story
{STORY_ID}: {title} (#{ISSUE_NUMBER})

## Changes
- Frontend: {files changed}
- Backend: {files changed}
- Database: migration needed? Y/N
- i18n: new keys? Y/N

## Test Plan
{Acceptance criteria as checklist}

## Tests Added
- Frontend component tests: {count}
- Backend service tests: {count}
- E2E/BDD tests: {count}

## Tech Debt Discovered
{list of DEBT issues created, or "No tech debt discovered"}

## Checklist
- [x] Builds pass
- [x] Lint passes (zero errors)
- [x] Tests pass
- [ ] i18n translations added
- [ ] Design tokens used
- [ ] Responsive
- [ ] Keyboard accessible
PRBODY
)"
```

Use scopes from `sdlc.scopes`. Mention i18n languages from `sdlc.i18n` and responsive breakpoints from `sdlc.responsiveBreakpoints` in the checklist.

#### Step 2g — Wait for CI + Copilot Review (MANDATORY)

> **BLOCKING GATE:** NEVER merge a PR without completing ALL of the following steps. Skipping this gate produces unfixed review findings that accumulate as hidden debt.

1. **Wait for CI checks to complete:**
   ```bash
   gh pr checks {PR_NUMBER} --repo {sdlc.repo} --watch
   ```

2. **Wait for Copilot review — check BOTH reviews AND comments:**
   ```bash
   # Wait initial {sdlc.sprint.reviewWaitSeconds}s
   sleep {sdlc.sprint.reviewWaitSeconds}

   # Check for Copilot review (reviews endpoint)
   COPILOT_REVIEW=$(gh api repos/{sdlc.repo}/pulls/{PR_NUMBER}/reviews \
     --jq '[.[] | select(.user.login | test("copilot|bot"; "i"))] | length')

   # Check for inline comments
   COPILOT_COMMENTS=$(gh api repos/{sdlc.repo}/pulls/{PR_NUMBER}/comments \
     --jq 'length')
   ```

3. **If no Copilot review found, retry up to `{sdlc.sprint.maxReviewRounds}` times:**
   ```bash
   for attempt in $(seq 1 {sdlc.sprint.maxReviewRounds}); do
     if [ "$COPILOT_REVIEW" = "0" ]; then
       echo "Attempt $attempt: No Copilot review yet, waiting..."
       sleep {sdlc.sprint.reviewWaitSeconds}
       # Re-check reviews and comments
     fi
   done
   ```

4. **Read ALL review comments — this step is NOT optional:**
   ```bash
   # Read review-level comments
   gh api repos/{sdlc.repo}/pulls/{PR_NUMBER}/reviews \
     --jq '.[] | select(.body != "") | "Review by \(.user.login): \(.state)\n\(.body)\n---"'

   # Read inline comments
   gh api repos/{sdlc.repo}/pulls/{PR_NUMBER}/comments \
     --jq '.[] | "File: \(.path):\(.line)\n\(.body)\n---"'
   ```

5. **If Copilot left comments or requested changes:** fix each finding before merging.
   - Create a fix commit: `fix: address copilot review findings`
   - Push (never force-push)
   - Re-read reviews + comments after push to verify they're resolved
   - Repeat until no new comments appear or `{sdlc.sprint.maxFixAttempts}` iterations reached

6. **Log the Copilot review outcome in the sprint plan comment:**
   - `:white_check_mark: Copilot reviewed — {N} comments, all resolved`
   - `:white_check_mark: Copilot reviewed — zero findings`
   - `:warning: Copilot review not received after {sdlc.sprint.maxReviewRounds} attempts`

7. **Only proceed to merge when:**
   - CI checks pass
   - Copilot review has been **confirmed received** with all findings addressed
   - OR Copilot review confirmed not received after retry cycles (log this)

#### Step 2h — Merge

```bash
gh pr merge {PR_NUMBER} --repo {sdlc.repo} --squash --delete-branch
```

#### Step 2i — Post-Story Cleanup

```bash
# Close the issue
gh issue close {ISSUE_NUMBER} --repo {sdlc.repo} \
  --comment "Completed in PR #{PR_NUMBER}. Merged to main."

# Return to main
git checkout main
git pull origin main

# Update sprint plan with progress
gh issue comment {SPRINT_PLAN_NUMBER} --repo {sdlc.repo} \
  --body "**{STORY_ID}** completed :white_check_mark: (PR #{PR_NUMBER}, {points} pts)

  Progress: {completed_count}/{total_count} stories, {completed_points}/{total_points} points"
```

### Blocker Handling

| Situation | Action |
|-----------|--------|
| Story has `{sdlc.sprint.labels.blocked}` label | Skip, log in sprint plan, continue to next |
| Dependency not yet done in this sprint | Reorder: do dependency first |
| Build/test failing after max fix attempts | Mark blocked, create investigation issue, skip |
| Copilot fix loop exceeds max iterations | Escalate: comment on PR, create issue, skip story |
| External blocker (API key, service access) | Mark blocked, add comment with blocker, skip |
| Story scope larger than estimated | Implement what fits, create follow-up issue for remainder |

When a story is skipped:
```bash
gh issue comment {SPRINT_PLAN_NUMBER} --repo {sdlc.repo} \
  --body "**{STORY_ID}** skipped :warning: — Reason: {reason}. Will spill to next sprint."
```

## Phase 3 — Tech Debt Cleanup

After all feature stories are done (or skipped), run the tech debt phase.

1. **Inventory debt created during this sprint:**
   ```bash
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.techDebt}" --state open --json number,title,body,createdAt
   ```

2. **Triage each debt item:**
   - **Critical** (security, data corruption, blocks work): fix now
   - **High** (recurring bugs, perf degradation): fix if capacity remains
   - **Medium/Low**: leave in backlog for next sprint's debt budget

3. **Fix critical/high items:**
   For each item to fix:
   ```bash
   git checkout main && git pull origin main
   git checkout -b chore/debt-{ISSUE_NUMBER}-{short-description}
   ```
   - Apply the fix
   - Run full verification (all lint, test, and build commands from config)
   - Commit: `refactor({scope}): {description} (closes #{ISSUE_NUMBER})`
   - Push and create PR
   - Merge when CI passes
   - Close the debt issue

4. **Update sprint plan with debt summary:**
   ```bash
   gh issue comment {SPRINT_PLAN_NUMBER} --repo {sdlc.repo} \
     --body "## Tech Debt Phase Complete

   - Discovered: {count} items
   - Fixed: {count} items (critical/high)
   - Carried to backlog: {count} items (medium/low)

   | Debt Item | Severity | Status |
   |-----------|----------|--------|
   | #{N}: {desc} | Critical | Fixed in PR #{PR} |
   | #{N}: {desc} | Medium | Backlog |"
   ```

## Phase 4 — Sprint Retrospective

After all stories and tech debt are handled, run the retrospective.

1. **Gather metrics:**
   ```bash
   # Completed stories
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.current}" --state closed --json number,title,labels

   # Spillover
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.current}" --state open --json number,title,labels
   ```

2. **Calculate velocity:**
   - Sum points of completed stories using `sdlc.sprint.points` mapping
   - Completed vs planned percentage
   - Compare to previous sprints for trend

3. **Gather per-story metrics:**
   - For each completed story: find its PR, count Copilot review rounds, count test files added
   ```bash
   gh pr list --repo {sdlc.repo} --state merged --search "{STORY_ID}" --json number,additions,deletions
   ```

4. **Create retrospective issue:**
   ```bash
   gh issue create --repo {sdlc.repo} \
     --title "Sprint {N} Retrospective" \
     --label "type:refinement" \
     --body "$(cat <<'RETRO'
   ## Sprint {N} Retrospective

   ### Velocity
   - Planned: {X} points ({planned_count} stories)
   - Completed: {Y} points ({completed_count} stories) — {percentage}%
   - Skipped/Blocked: {skipped_count} stories ({skipped_points} points)
   - Velocity trend: {trend}

   ### Stories
   | Story | Points | Copilot Rounds | Tests Added | Notes |
   |-------|--------|----------------|-------------|-------|
   | {STORY_ID} | {pts} | {rounds} | {tests} | {notes} |

   ### Spillover
   | Story | Points | Reason |
   |-------|--------|--------|
   | {STORY_ID} | {pts} | {reason} |

   ### Tech Debt
   - Discovered: {debt_created} items
   - Fixed: {debt_fixed} items
   - Backlog: {debt_backlog} items
   - Debt trend: {accumulating/stable/decreasing}

   ### Learnings
   - {pattern that worked well}
   - {pattern that caused friction}
   - {estimation accuracy notes}

   ### Actions
   - [ ] {specific improvement for next sprint}
   RETRO
   )"
   ```

5. **Clean up sprint labels:**
   ```bash
   # Spillover: move back to backlog
   for issue in {spillover_issues}; do
     gh issue edit $issue --repo {sdlc.repo} \
       --remove-label "{sdlc.sprint.labels.current}" --add-label "{sdlc.sprint.labels.backlog}"
   done
   ```

6. **Close the sprint plan issue:**
   ```bash
   gh issue close {SPRINT_PLAN_NUMBER} --repo {sdlc.repo} \
     --comment "Sprint {N} complete. Velocity: {Y}/{X} points ({percentage}%). See retro: #{RETRO_ISSUE}."
   ```

## Phase 5 — Trigger Next Sprint

After the retro, check for the next sprint:

1. **Check if next sprint plan exists:**
   ```bash
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.plan}" --state open --json number,title \
     --jq '.[] | select(.title | test("Sprint [0-9]+ Plan"))'
   ```

2. **If called from `/all-sprints-runner`:** Skip the human gate — all plans are pre-approved. Immediately transition to the next sprint.

3. **If running as standalone `/sprint-runner`:**
   - If a pre-planned sprint exists: Comment "Sprint {N+1} Plan ready for approval." and **stop for human approval**.
   - If no pre-planned sprint exists: Run `/plan-sprint` and wait for human approval.

## Safety Guardrails

| Guard | Rule |
|-------|------|
| **Never force-push** | Always new commits, squash on merge |
| **Never skip hooks** | All commits go through commitlint + lint-staged |
| **Max fix attempts** | `sdlc.sprint.maxFixAttempts` per verification step — escalate after |
| **Max review rounds** | `sdlc.sprint.maxReviewRounds` per PR — escalate to human after |
| **Branch protection** | main requires PR + CI passing — never direct push |
| **One story at a time** | Complete (or skip) current story before starting next |
| **Always return to main** | After each story, checkout main and pull |
| **Dirty tree = stop** | Never start a story with uncommitted changes |
| **Sprint plan is source of truth** | Only implement stories listed in the approved plan |

## Progress Tracking

The sprint runner maintains progress via comments on the sprint plan issue. At any time, checking the sprint plan issue shows:
- Which stories are complete (with PR links)
- Which are skipped (with reasons)
- Current story being worked on
- Tech debt discovered and resolved
- Final retro summary

## Invocation

```
/sprint-runner              # Run the current (earliest open) sprint
/sprint-runner 5            # Run Sprint 5 specifically
```
