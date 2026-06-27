---
name: plan-sprint
description: Plan the next sprint — read board state, calculate velocity and capacity, select stories, create sprint plan issue for approval.
tags: [sdlc, sprint]
---

# Sprint Planning

Plan the next sprint autonomously.

## Project Configuration

Read `.Codex/sdlc.json` at the project root. Stop if missing.
All values below reference this config via `sdlc.*` notation.

## Workflow

1. **Read the current board state:**
   ```bash
   # Closed in current sprint (velocity)
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.current}" --state closed --json number,title,labels
   # Open in current sprint (spillover)
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.current}" --state open --json number,title,labels
   # Backlog
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.backlog}" --state open --json number,title,labels --limit 300
   # Open tech debt
   gh issue list --repo {sdlc.repo} --label "{sdlc.sprint.labels.techDebt}" --state open --json number,title,labels,createdAt
   ```

2. **Read the gap analysis for phase/epic ordering:**
   - Source: `{sdlc.gapAnalysis}` (IMPLEMENTATION ROADMAP section)
   - Phase order: from `sdlc.sprint.phaseOrder`

3. **Calculate velocity:**
   - Map size labels to points using `sdlc.sprint.points` (e.g., S=1, M=3, L=5, XL=8)
   - Sum points of closed `{sdlc.sprint.labels.current}` issues
   - Average with previous `{sdlc.sprint.velocity.lookback}` sprints (read from past sprint plan issues)
   - First sprint: use `sdlc.sprint.velocity.default` points

4. **Determine capacity:**
   - `capacity = velocity * {sdlc.sprint.capacity.buffer}`
   - Adjust for known interruptions
   - **Tech debt budget:** Reserve `{sdlc.sprint.capacity.debtBudget}` of capacity for debt cleanup
     - `debt_budget = capacity * {sdlc.sprint.capacity.debtBudget}`
     - `feature_budget = capacity - debt_budget`
   - If > `{sdlc.sprint.capacity.debtEscalationThreshold}` open debt items: escalate to `{sdlc.sprint.capacity.debtEscalation}` debt budget
   - If > `{sdlc.sprint.capacity.debtFullSprintThreshold}` open debt items: consider a full "Tech Debt Sprint" (100% debt)

5. **Select stories following this algorithm:**
   a. Start with phase order from `sdlc.sprint.phaseOrder`
   b. Within phase, respect epic order from roadmap
   c. Within epic, respect story dependencies
   d. Check `{sdlc.sprint.labels.blocked}` label — skip blocked stories
   e. Check if ADR is needed (`{sdlc.sprint.labels.needsAdr}`) — include ADR as first task
   f. **Include critical/high tech debt items** (from `{sdlc.sprint.labels.techDebt}` label) up to debt_budget
   g. Fill remaining sprint capacity with feature stories
   h. Don't split stories — if next exceeds remaining capacity, skip to smaller
   i. Interleave polish stories per sprint from `{sdlc.sprint.labels.polish}` (every `{sdlc.sprint.polishInterleave}` feature stories)

6. **Validate sprint:**
   - No circular dependencies
   - ADRs included for triggered stories
   - Mix of sizes (not all XL)
   - Polish stories interleaved
   - Tech debt items included if any are open

7. **Create sprint plan issue:**
   ```bash
   gh issue create --repo {sdlc.repo} \
     --title "Sprint {N} Plan" \
     --label "{sdlc.sprint.labels.plan}" \
     --body "..."
   ```

   Use this template for the body:
   ```
   ## Sprint {N} Plan — {Start Date} to {End Date}

   ### Sprint Goal
   {1-sentence focus}

   ### Capacity
   - Velocity ({sdlc.sprint.velocity.lookback + 1}-sprint avg): {X} points
   - Available capacity: {Y} points
   - Allocated: {Z} points

   ### Stories
   | # | Story | Epic | Points | ADR? | Blocked? |
   |---|-------|------|--------|------|----------|
   | 1 | ... | ... | ... | ... | ... |

   ### Tech Debt
   | # | Debt Item | Issue | Severity | Source |
   |---|-----------|-------|----------|--------|
   | 1 | ... | #... | Critical/High | {story} |
   _(or "No open tech debt items" if backlog is clean)_

   ### Risks
   - ...

   ### Approval
   - [ ] Sprint plan approved by human
   ```

8. **Comment:** "Sprint {N} planned with {Z} points across {count} stories. Awaiting approval."

9. **After human approval:**
   - Move stories to sprint: `gh issue edit {N} --repo {sdlc.repo} --add-label "{sdlc.sprint.labels.current}" --remove-label "{sdlc.sprint.labels.backlog}"`
   - Start first story: `/story-runner {FIRST_STORY_ID}`

## Invocation

```
/plan-sprint              # Plan the next sprint
```
