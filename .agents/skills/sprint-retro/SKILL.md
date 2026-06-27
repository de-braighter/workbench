---
name: sprint-retro
description: Run the retrospective for the current sprint — measure velocity, analyze patterns, create retro report, handle tech debt, trigger next sprint planning.
tags: [sdlc, sprint]
---

# Sprint Retrospective

Run the retrospective for the current sprint.

## Project Configuration

Read `.Codex/sdlc.json` at the project root. Stop if missing.
All values below reference this config via `sdlc.*` notation.

## Workflow

1. **List completed stories:**
   ```bash
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.current}" --state closed --json number,title,labels
   ```

2. **List incomplete stories (spillover):**
   ```bash
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.current}" --state open --json number,title,labels
   ```

3. **For each completed story, gather metrics:**
   - PR link: `gh pr list --repo {sdlc.repo} --search "STORY-ID" --json number,additions,deletions,reviews`
   - Copilot review rounds: count reviews from `copilot[bot]`
   - Test count: count test files in PR diff

4. **Calculate velocity:**
   - Sum points of completed stories using `sdlc.sprint.points` mapping
   - Compare planned vs completed points
   - Update rolling average over `sdlc.sprint.velocity.lookback + 1` sprints

5. **Create retro issue:**
   ```bash
   gh issue create --repo {sdlc.repo} \
     --title "Sprint {N} Retrospective" \
     --label "type:refinement" \
     --body "..."
   ```

   Use this template:
   ```
   ## Sprint {N} Retrospective

   ### Velocity
   - Planned: {X} points
   - Completed: {Y} points ({percentage}%)
   - Velocity trend: {increasing/stable/decreasing}

   ### Stories
   | Story | Planned Points | Actual Effort | Copilot Rounds | Notes |
   |-------|---------------|---------------|----------------|-------|
   | ... | ... | ... | ... | ... |

   ### Spillover
   | Story | Points | Reason |
   |-------|--------|--------|
   | ... | ... | ... |

   ### Learnings
   - {Pattern that worked well}
   - {Pattern that caused friction}
   - {Estimation miss}

   ### Actions
   - [ ] {Specific improvement action}
   ```

6. **Tech Debt Phase (mandatory before sprint close):**

   No sprint is complete until tech debt is addressed.

   a. **Inventory all debt from this sprint:**
      ```bash
      gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.techDebt}" --state open --json number,title,labels,createdAt
      ```

   b. **Triage debt items:**
      | Severity | Action | Criteria |
      |----------|--------|----------|
      | **Critical** | Fix now, in this sprint | Blocks other work, security risk, data corruption risk |
      | **High** | Fix now if capacity remains | Causes recurring bugs, degrades performance noticeably |
      | **Medium** | Schedule for next sprint | Code smell, missing tests, minor pattern violations |
      | **Low** | Add to backlog | Nice-to-have cleanup, cosmetic issues |

   c. **Fix critical and high debt:**
      - For each critical/high item: implement the fix using `/tech-debt #{ISSUE_NUMBER}`
      - This uses remaining sprint capacity (the buffer is partly for this)
      - If no capacity remains: flag in retro report, escalate to next sprint

   d. **Add debt summary to retro report:**
      ```
      ### Tech Debt
      - Discovered this sprint: {count} items ({total estimated points})
      - Fixed this sprint: {count} items
      - Carried to backlog: {count} items

      | # | Debt Item | Severity | Status | Source Story |
      |---|-----------|----------|--------|-------------|
      | 1 | DEBT: {desc} (#{N}) | Critical | Fixed | {STORY_ID} |
      | 2 | DEBT: {desc} (#{N}) | Medium | Backlog | {STORY_ID} |
      ```

   e. **If debt is accumulating sprint over sprint:**
      - Flag in retro: "Tech debt velocity is negative — creating more debt than we resolve"
      - Recommend: allocate 1-2 dedicated debt stories in next sprint plan
      - If > `{sdlc.sprint.capacity.debtEscalationThreshold}` open debt items: recommend a Tech Debt Sprint
      - If > `{sdlc.sprint.capacity.debtFullSprintThreshold}` open debt items: strongly recommend a full Tech Debt Sprint

7. **Execute actions:**
   - Create issues for action items
   - Update cookbook if learning is clear
   - Adjust estimates on similar backlog stories

8. **Clean up sprint labels:**
   - Spillover stories: remove `{sdlc.sprint.labels.current}`, add back `{sdlc.sprint.labels.backlog}`
   - Completed stories: `{sdlc.sprint.labels.current}` label stays (historical)

9. **Close the sprint plan issue:**
   ```bash
   gh issue close {SPRINT_PLAN_NUMBER} --repo {sdlc.repo} \
     --comment "Sprint {N} complete. Velocity: {Y}/{X} points ({percentage}%). See retro: #{RETRO_ISSUE}."
   ```

10. **Trigger next sprint planning:** `/plan-sprint`

## Invocation

```
/sprint-retro              # Run retro for the current sprint
```
