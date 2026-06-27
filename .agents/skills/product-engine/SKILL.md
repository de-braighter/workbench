---
name: product-engine
description: "Continuous autonomous product engine — scan, triage, execute, verify, loop. Delegates to existing skills. Stops only when queue is empty or a human gate is reached."
tags: [autonomous, kanban]
---

# Product Engine

Continuous autonomous loop that unifies sprint execution, bug fixing, PR management, tech debt cleanup, quality enforcement, and feature concept generation into a single relentless chain.

> **One invocation. No timers. No cron.** This skill scans for work, triages by priority, executes the highest-priority item, verifies the result, and loops back to scan. It runs until the work queue is empty or a human gate is reached.

## Project Configuration

Read `.Codex/sdlc.json` at the project root. Stop if missing.
All values below reference this config via `sdlc.*` notation.

Load `.Codex/product-engine-state.json` if it exists (resume mode).

## CRITICAL EXECUTION RULES

> **NEVER STOP between cycles.** After completing one work item, IMMEDIATELY scan for the next. Do NOT:
> - Ask the user if you should continue
> - Summarize progress and wait for confirmation
> - Say "should I continue?" or "cycle complete, what next?"
> - Cite context limits as a reason to pause (use `/context-minimizer` first)
> - Generate a "handoff state" for a new session
>
> The ONLY reasons to stop are listed in **Human Gates** below. Everything else = keep going.
>
> After VERIFY completes, the very next action must be SCAN.
> If you run out of context, use `/context-minimizer` to compress, or save state and stop cleanly.
> **The user said "loop until done" — respect that.**

## The Loop

```
BOOT → SCAN → TRIAGE → EXECUTE → VERIFY → SCAN → ... → PAUSE | IDLE
```

---

## Phase 1 — BOOT

### Step 1.1 — Pre-flight

```bash
git checkout main
git pull origin main
git status --porcelain  # Must be empty
```

If dirty working tree: `git stash` and log a warning.

### Step 1.2 — Load Configuration

1. Read `.Codex/sdlc.json` — stop if missing
2. Read `.Codex/product-engine-state.json` if present:
   - If `status: "paused"`: log "Resuming from pause: {pauseReason}", note `pauseIssue`
   - If `status: "running"`: log "Recovering from crash at cycle {cycleCount}", continue from SCAN
   - If `status: "idle"`: fresh start, proceed normally

### Step 1.3 — Verify Codebase Health

Run all verification commands:
```bash
# Lint (from sdlc.lint.commands)
npx nx lint frontend
npx nx lint backend

# Tests (from sdlc.test.commands)
npx nx test frontend
npx nx test backend

# Build (from sdlc.build.commands)
npx nx build frontend
npx nx build backend
```

If any verification fails: this is a **P0 BROKEN MAIN** — fix it inline before proceeding to SCAN. Do not delegate to another skill since the codebase must be green to run any skill.

### Step 1.4 — Security Baseline

```bash
npm audit --audit-level=critical --json 2>/dev/null | jq '.metadata.vulnerabilities'
```

If critical vulnerabilities found: add to scan results as P0 security item.

### Step 1.5 — Initialize State

If no state file exists, create initial state:

```json
{
  "status": "running",
  "pauseReason": null,
  "pauseIssue": null,
  "cycleCount": 0,
  "currentSprint": null,
  "stats": {
    "bugsFixed": 0,
    "storiesCompleted": 0,
    "prsFixed": 0,
    "techDebtCleared": 0,
    "qualityViolationsFixed": 0,
    "depsUpdated": 0,
    "featureConceptsWritten": 0
  },
  "lastAction": null,
  "scanHistory": []
}
```

---

## Phase 2 — SCAN

Run ALL enabled detectors (controlled by `sdlc.productEngine.scanners`). Each detector produces work items with a category and priority.

### Detector 1 — MAIN HEALTH

Skip if `sdlc.productEngine.scanners.mainHealth` is false.

```bash
# Check CI on main
gh api repos/{sdlc.repo}/commits/main/check-runs \
  --jq '.check_runs[] | select(.conclusion != "success" and .conclusion != null) | {name: .name, conclusion: .conclusion}'

# Security audit
npm audit --audit-level=high --json 2>/dev/null | jq '.metadata.vulnerabilities'
```

| Finding | Priority |
|---------|----------|
| CI failure on main | P0 |
| Critical npm vulnerability | P0 |
| High npm vulnerability | P5 |

### Detector 2 — PR LANDSCAPE

Skip if `sdlc.productEngine.scanners.prLandscape` is false.

```bash
# Open PRs with their check status
gh pr list --repo {sdlc.repo} --state open \
  --json number,title,labels,reviewDecision,statusCheckRollup,updatedAt

# For each open PR — check for false greens
for PR in $(gh pr list --repo {sdlc.repo} --state open --json number --jq '.[].number'); do
  # Check if any check run failed but PR overall shows as passing
  FAILED_CHECKS=$(gh api repos/{sdlc.repo}/commits/$(gh pr view $PR --repo {sdlc.repo} --json headRefOid --jq '.headRefOid')/check-runs \
    --jq '[.check_runs[] | select(.conclusion == "failure")] | length')

  # Check for unaddressed review comments
  PENDING_COMMENTS=$(gh api repos/{sdlc.repo}/pulls/$PR/comments \
    --jq '[.[] | select(.in_reply_to_id == null)] | length')

  # Check for changes-requested reviews
  CHANGES_REQUESTED=$(gh api repos/{sdlc.repo}/pulls/$PR/reviews \
    --jq '[.[] | select(.state == "CHANGES_REQUESTED")] | length')
done

# Stale PRs (no activity in sdlc.productEngine.stalePrHours)
```

| Finding | Priority |
|---------|----------|
| False green (check failed but PR passes) | P1 |
| Unaddressed review comments | P1 |
| Changes requested but not addressed | P1 |
| Stale PR (no activity > stalePrHours) | P3 |

### Detector 3 — SPRINT STATE

Skip if `sdlc.productEngine.scanners.sprintState` is false.

```bash
# Approved sprint plans
gh issue list --repo {sdlc.repo} \
  --label "{sdlc.sprint.labels.plan}" --state open \
  --json number,title,body

# In-progress stories (sprint:current label, still open)
CURRENT_OPEN=$(gh issue list --repo {sdlc.repo} \
  --label "{sdlc.sprint.labels.current}" --state open \
  --json number --jq 'length')

# Completed stories (sprint:current label, closed)
CURRENT_CLOSED=$(gh issue list --repo {sdlc.repo} \
  --label "{sdlc.sprint.labels.current}" --state closed \
  --json number --jq 'length')

# Check if last closed sprint has a retro
gh issue list --repo {sdlc.repo} \
  --label "type:refinement" --state open \
  --json number,title --jq '.[] | select(.title | test("Retrospective"))'
```

| Finding | Priority |
|---------|----------|
| In-progress sprint with open stories | P2 |
| Approved plan, no current stories started | P2 |
| All current stories closed, no retro | P3 |
| No approved plan exists | P4 |

### Detector 4 — DEFECTS

Skip if `sdlc.productEngine.scanners.defects` is false.

```bash
gh issue list --repo {sdlc.repo} \
  --label "type:bug" --state open \
  --json number,title,labels,createdAt \
  --jq 'sort_by(.createdAt) | .[]'
```

| Finding | Priority |
|---------|----------|
| Each open bug issue | P3 |

### Detector 5 — TECH DEBT & QUALITY

Skip if `sdlc.productEngine.scanners.techDebtQuality` is false.

```bash
# Open tech debt issues
gh issue list --repo {sdlc.repo} \
  --label "{sdlc.sprint.labels.techDebt}" --state open \
  --json number,title,labels,body

# Outdated dependencies
npm outdated --json 2>/dev/null
```

Also read `{sdlc.specsRepo}/parkdeck/000-parkdeck.md` and parse for items with priority `Immediate` or `High` and status not `Done`.

| Finding | Priority |
|---------|----------|
| Parkdeck Immediate/High items (not Done) | P5 |
| Open tech-debt issues (Critical/High) | P5 |
| Safe dependency updates available | P6 |

### Detector 6 — FEATURE PIPELINE

Skip if `sdlc.productEngine.scanners.featurePipeline` is false.

1. Read `{sdlc.gapAnalysis}` — identify next unimplemented phase/epic
2. Check if feature concepts already exist in `{sdlc.productEngine.featureConcepts.targetDir}` for that epic
3. If no concept exists for the next-priority epic: add to queue

| Finding | Priority |
|---------|----------|
| Missing concept for next-phase epic | P7 |

---

## Phase 3 — TRIAGE

Collect all items from all detectors into a single queue. Sort by:
1. **Priority** (P0 first, P7 last)
2. **Age** within same priority (oldest first, by issue creation date or detection order)

```
P0  BROKEN MAIN / SECURITY CRITICAL
P1  FALSE-GREEN CI / PR FIXES REQUESTED
P2  SPRINT IN PROGRESS / SPRINT READY
P3  SPRINT RETRO DUE / OPEN BUGS
P4  SPRINT PLANNING (needs plan → PAUSE after)
P5  CRITICAL TECH DEBT / QUALITY VIOLATIONS
P6  DEPENDENCY UPGRADES
P7  FEATURE CONCEPTS (write spec → PAUSE after)
```

**Selection rule:** Pick the single highest-priority item.

If the queue is **empty**: write state `{ "status": "idle" }` and stop with:

```
Product engine idle — no work detected. All clear.
Cycles completed: {cycleCount}
Stats: {stats summary}
```

---

## Phase 4 — EXECUTE

Take the top item from the triage queue and dispatch to the correct handler.

### P0 — Broken Main

1. Download failure logs:
   ```bash
   gh run list --repo {sdlc.repo} --branch main --status failure --json databaseId,name --limit 3
   gh run view {RUN_ID} --repo {sdlc.repo} --log-failed
   ```
2. Diagnose root cause from logs
3. Fix inline (do NOT delegate — main is broken, skills may not work):
   ```bash
   git checkout -b fix/main-broken-$(date +%Y%m%d-%H%M)
   ```
4. Apply fix, run full verification suite
5. Commit: `fix({scope}): repair broken main — {description}`
6. Push, create PR, merge when CI passes
7. Return to main: `git checkout main && git pull origin main`

### P0 — Security Critical

1. Attempt targeted fix:
   ```bash
   npm audit fix
   ```
2. Run full verification suite
3. If tests pass: branch `fix/security-audit-$(date +%Y%m%d)`, commit, PR, merge
4. If fix is breaking (major version bump required):
   - Create issue with label `{sdlc.productEngine.labels.security}`
   - Write state: `{ "status": "paused", "pauseReason": "security-breaking-fix-decision", "pauseIssue": ISSUE_NUMBER }`
   - **PAUSE** — human must decide approach

### P1 — False-Green CI

1. Read workflow YAML: `.github/workflows/pr-check.yml`
2. Identify: `continue-on-error` masking failures, skipped jobs not caught by summary, branch protection not requiring the summary check
3. Fix the workflow YAML
4. Branch `fix/ci-false-green-{description}`, commit, PR
5. Update stats: `prsFixed++`

### P1 — PR Fixes Requested

1. Identify the PR with unaddressed comments:
   ```bash
   gh pr checkout {PR_NUMBER} --repo {sdlc.repo}
   ```
2. Read all review comments:
   ```bash
   gh api repos/{sdlc.repo}/pulls/{PR_NUMBER}/reviews \
     --jq '.[] | select(.body != "") | "Review by \(.user.login): \(.state)\n\(.body)"'
   gh api repos/{sdlc.repo}/pulls/{PR_NUMBER}/comments \
     --jq '.[] | "File: \(.path):\(.line)\n\(.body)"'
   ```
3. Apply fixes for each comment
4. Verify: lint, test, build
5. Commit: `fix: address review findings on PR #{PR_NUMBER}`
6. Push (never force-push)
7. Return to main: `git checkout main && git pull origin main`
8. Update stats: `prsFixed++`

### P2 — Sprint In Progress / Sprint Ready

Delegate to `/sprint-runner`:

```
/sprint-runner {SPRINT_NUMBER}
```

The sprint-runner is self-contained — it handles the full story loop (implement → test → PR → Copilot review → merge), tech debt phase, and returns when done.

After sprint-runner completes:
- Update stats: `storiesCompleted += completed_count`
- Set `currentSprint` in state
- Continue to VERIFY → SCAN (sprint-retro will be detected as P3 in next scan)

### P3 — Sprint Retro Due

Delegate to `/sprint-retro`.

After retro completes: continue to VERIFY → SCAN (which may detect P4 planning needed).

### P3 — Open Bugs

Pick the **oldest** open bug (by creation date). Delegate to `/bug-fixer`:

```
/bug-fixer {ISSUE_NUMBER}
```

Fix **one bug per cycle**, then re-scan. This ensures higher-priority work that appeared during the fix gets handled first.

After fix: update stats `bugsFixed++`.

### P4 — Sprint Planning

Delegate to `/plan-sprint`.

After the plan issue is created:

```bash
# Add pause label to the plan issue
gh issue edit {PLAN_ISSUE_NUMBER} --repo {sdlc.repo} \
  --add-label "{sdlc.productEngine.labels.pause}"
```

Write state:
```json
{
  "status": "paused",
  "pauseReason": "sprint-plan-approval",
  "pauseIssue": PLAN_ISSUE_NUMBER
}
```

**PAUSE.** Print:
```
Product engine paused — sprint plan #{PLAN_ISSUE_NUMBER} created and awaiting approval.
Label the issue "approved" and re-invoke /product-engine to resume.
Cycles completed: {cycleCount} | Stats: {summary}
```

### P5 — Critical Tech Debt

For tech-debt issues that match a scope (`dead-code`, `test-migration`, `token-cleanup`):

```
/tech-debt {SCOPE}
```

For parkdeck items or issues without a matching scope: implement inline following the item's description.

Fix **one item per cycle**, then re-scan. Update stats: `techDebtCleared++`.

### P5 — Quality Violations

Run governance and review skills on affected areas:

```
/expert-code-review {affected-path}
```

The review skill's check-fix loop handles resolution autonomously. After it completes, update stats: `qualityViolationsFixed++`.

### P6 — Dependency Upgrades

```bash
# Non-breaking updates only (patch + minor per sdlc.productEngine.depUpdateStrategy)
npm update

# Verify nothing broke
npx nx lint frontend && npx nx lint backend
npx nx test frontend && npx nx test backend
npx nx build frontend && npx nx build backend
```

If tests pass:
```bash
git checkout -b chore/dep-update-$(date +%Y%m%d)
git add package.json package-lock.json
git commit -m "chore(deps): update dependencies (minor/patch)"
git push -u origin chore/dep-update-$(date +%Y%m%d)
gh pr create --repo {sdlc.repo} \
  --title "chore(deps): update dependencies" \
  --body "Automated dependency update (minor/patch only). Full test suite passes."
```

If tests fail: revert with `git checkout -- package.json package-lock.json && npm ci`, log which deps caused failure, skip.

Update stats: `depsUpdated++`.

### P7 — Feature Concepts

1. Read `{sdlc.gapAnalysis}` to find the next unimplemented epic by phase order (`sdlc.sprint.phaseOrder`)
2. Read the corresponding epic doc from `{sdlc.epics}`
3. Read related domain docs from `{sdlc.specsRepo}/domain/06-features/`
4. Read existing concepts in `{sdlc.productEngine.featureConcepts.targetDir}` to understand format
5. Write a feature concept spec to `{sdlc.productEngine.featureConcepts.targetDir}/{epic-slug}.md`
6. Create GitHub issue:
   ```bash
   gh issue create --repo {sdlc.repo} \
     --title "Feature Concept: {Epic Title}" \
     --label "{sdlc.productEngine.labels.featureConcept}" \
     --body "$(cat <<'EOF'
   ## Feature Concept
   
   Concept spec written to: {path}
   Epic: {epic ID and title}
   Phase: {phase}
   
   ### Summary
   {1-3 bullet points}
   
   ### Stories Identified
   {count} stories, {total points estimate}
   
   ### Review Requested
   Please review the concept spec and comment with approval or feedback.
   Re-invoke /product-engine after review.
   EOF
   )"
   ```
7. Write state:
   ```json
   {
     "status": "paused",
     "pauseReason": "feature-concept-review",
     "pauseIssue": CONCEPT_ISSUE_NUMBER
   }
   ```

**PAUSE.** Print:
```
Product engine paused — feature concept for {epic} written and awaiting review.
Review issue #{CONCEPT_ISSUE_NUMBER} and re-invoke /product-engine to resume.
```

Update stats: `featureConceptsWritten++`.

---

## Phase 5 — VERIFY

Run after EVERY execution, regardless of priority level.

### Step 5.1 — Return to Clean State

```bash
git checkout main
git pull origin main
git status --porcelain  # Must be empty
```

If dirty: stash or clean up before proceeding.

### Step 5.2 — Full Verification Suite

```bash
# Lint
npx nx lint frontend
npx nx lint backend

# Tests
npx nx test frontend
npx nx test backend

# Build
npx nx build frontend
npx nx build backend
```

If any step fails after execution: attempt inline fix (up to `sdlc.sprint.maxFixAttempts`). If still failing: create an issue describing the failure and add it as P0 for next SCAN cycle.

### Step 5.3 — Update State

```bash
# Update product-engine-state.json
```

Update the state file with:
- Increment `cycleCount`
- Update `lastAction`: `{ "type": "{action-type}", "issue": {number}, "result": "success|failure", "timestamp": "{ISO}" }`
- Update relevant `stats` counter
- Append to `scanHistory` (keep last 10 entries):
  ```json
  {
    "cycle": N,
    "timestamp": "ISO",
    "itemsFound": N,
    "highestPriority": "P{N}",
    "executed": "{action-type} #{issue}"
  }
  ```

### Step 5.4 — Context Management

After every cycle, assess context usage:

1. If `cycleCount` is a multiple of `sdlc.productEngine.maxCyclesBeforeContextCheck` (default 15): run `/context-minimizer` to compress context proactively
2. If response generation feels slow or truncating: save state with `pauseReason: "context-exhaustion"` and stop cleanly

```
Context limit approaching. State saved at cycle {cycleCount}.
Re-invoke /product-engine to continue from where you left off.
```

### Step 5.5 — Loop

Continue to **Phase 2 — SCAN**. Do NOT pause, summarize, or ask for confirmation.

---

## State File

Path: `.Codex/product-engine-state.json`

```json
{
  "status": "running | paused | idle",
  "pauseReason": "sprint-plan-approval | feature-concept-review | security-breaking-fix-decision | context-exhaustion | null",
  "pauseIssue": 123,
  "cycleCount": 17,
  "currentSprint": 8,
  "stats": {
    "bugsFixed": 3,
    "storiesCompleted": 12,
    "prsFixed": 2,
    "techDebtCleared": 5,
    "qualityViolationsFixed": 7,
    "depsUpdated": 2,
    "featureConceptsWritten": 1
  },
  "lastAction": {
    "type": "bug-fix",
    "issue": 137,
    "result": "success",
    "timestamp": "2026-04-07T14:32:00Z"
  },
  "scanHistory": [
    {
      "cycle": 17,
      "timestamp": "2026-04-07T14:32:00Z",
      "itemsFound": 3,
      "highestPriority": "P3",
      "executed": "bug-fix #137"
    }
  ]
}
```

---

## Human Gates

The ONLY reasons the engine pauses:

| Gate | Trigger | Label Applied | Resume Action |
|------|---------|---------------|---------------|
| Sprint plan approval | P4: plan created, needs review | `{sdlc.productEngine.labels.pause}` | Label issue `approved`, re-invoke `/product-engine` |
| Feature concept review | P7: concept written, needs review | `{sdlc.productEngine.labels.featureConcept}` | Comment on issue, re-invoke `/product-engine` |
| Security breaking fix | P0: fix could break things | `{sdlc.productEngine.labels.security}` | Comment with decision, re-invoke `/product-engine` |
| Context exhaustion | Context window approaching limit | None | Re-invoke `/product-engine` in new session |

---

## Safety Guardrails

| Guard | Rule |
|-------|------|
| **Never force-push** | Always new commits, squash on merge |
| **Never skip hooks** | All commits through commitlint + lint-staged |
| **Max fix attempts** | `sdlc.sprint.maxFixAttempts` per verification step — escalate after |
| **One item at a time** | Complete (or skip) current item before scanning for next |
| **Always return to main** | After each execution, checkout main and pull |
| **Dirty tree = stop** | Never start an execution with uncommitted changes |
| **Delegate, don't reimplement** | Use existing skills for sprint/story/bug/debt work |
| **State persistence** | Write state after every cycle for crash recovery |
| **No silent failures** | Every error creates an issue or updates state |
| **One bug/debt per cycle** | For P3+ items, fix one then re-scan to catch priority shifts |

---

## Error Recovery

### Recoverable errors (auto-handled)

| Error | Recovery |
|-------|----------|
| Lint failure | Fix and re-run (up to `sdlc.sprint.maxFixAttempts`) |
| Test failure | Fix test or implementation, re-run |
| Build failure | Fix build error, re-run |
| Merge conflict | Pull main, rebase branch, resolve, push |
| Git dirty working tree | Stash, return to main, pull |
| Network timeout on gh commands | Retry up to 3x with 10s delay |
| Delegated skill fails | Log failure, create issue, skip to next item |
| npm audit fix breaks tests | Revert, log, skip to next item |

### Fatal errors (halt execution)

| Error | Action |
|-------|--------|
| Main branch broken AND inline fix fails after max attempts | Save state, create urgent issue, stop |
| Git repository corrupted | Save state, stop, alert |
| GitHub API consistently failing (3 consecutive) | Save state, stop |
| sdlc.json missing or invalid | Stop immediately |

On fatal error: save state with `status: "paused"` and `pauseReason` describing the failure. Create an issue if possible.

---

## Resumability

Running `/product-engine` is **idempotent**:

1. If state shows `paused`: log resume context, start from SCAN
2. If state shows `running`: assume crash, log recovery, start from SCAN
3. If state shows `idle` or no state file: fresh start from BOOT
4. Scan detects current state of everything (GitHub issues, PRs, main health) — no stale data

---

## Skill Delegation Map

```
/product-engine (this skill — the loop)
  ├── /sprint-runner      — P2: execute sprints (stories, tests, PRs, Copilot review)
  │   ├── /story-runner   — individual story implementation
  │   └── /story-picker   — select next story
  ├── /plan-sprint        — P4: create sprint plan → PAUSE
  ├── /sprint-retro       — P3: sprint retrospective
  ├── /bug-fixer          — P3: TDD bug fixes (one per cycle)
  ├── /tech-debt          — P5: cleanup by scope
  ├── /expert-code-review — P5: quality violation fix loop
  └── /context-minimizer  — context management (every N cycles)
```

---

## Invocation

```
/product-engine
```

No arguments. Discovers work automatically from GitHub state, codebase health, and specs. If a state file exists, resumes from where it left off.
