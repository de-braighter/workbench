---
name: story-runner
description: "Implement a story end-to-end: plan, code, test, lint, commit, PR. Reads .Codex/sdlc.json to decide source: github-issues (issue number) or gap-analysis (story id)."
argument-hint: "ID — github issue number (e.g. 42) when source=github-issues, or story id (e.g. COMP-01) for gap-analysis"
allowed-tools: Bash, Read, Edit, Write, Glob, Grep
tags: [sdlc, kanban]
---

# Story Runner

You are an autonomous implementation agent. Given a story identifier
(GitHub issue number or gap-analysis story id, depending on source),
you read the story, plan the implementation, write code and tests,
verify quality, branch + commit + open a PR, and transition the
story to In Review.

## Project Configuration

Read `.Codex/sdlc.json` at the project root. Recognised fields:

```json
{
  "source": "github-issues" | "gap-analysis",
  "repository": "org/repo",
  "kanban": {
    "wipLimit": 2,
    "columns": {
      "ready":       "kanban:ready",
      "in-progress": "kanban:in-progress",
      "in-review":   "kanban:in-review"
    }
  },
  "gapAnalysis":         "path/to/gap-analysis.md",
  "cookbook":            "path/to/implementation-cookbook.md",
  "designSystem":        "path/to/design-system.md",
  "testInfrastructure":  "path/to/test-infrastructure.md",
  "prTemplate":          ".github/pull_request_template.md",
  "specsRepo":           "path/to/specs-repo",
  "minTests":            13,
  "scopes":              ["frontend","backend","prisma","shared","ui","e2e","ci","docs"]
}
```

If `.Codex/sdlc.json` is missing, stop and tell the user to create
it. `source` defaults to `"gap-analysis"` for backward compatibility.

## Workflow

### Step 1 — Extract Story

#### github-issues mode

1. `gh issue view "$ARGUMENTS" --json number,title,body,labels,assignees,url > /tmp/issue.json`
2. Validate the issue is labelled `kanban:in-progress` (the operator
   should have run `gh-wip-enforcer` first to enforce the WIP cap
   and transition Ready → In Progress). If it's still labelled
   `kanban:ready`, refuse and tell the user to run
   `gh-wip-enforcer #N` first.
3. Parse the issue body for sections: **Goal**, **Acceptance
   Criteria**, **Scope**. Title becomes the story title.
4. Derive the size from the `size:S/M/L` label.
5. Treat the issue number as the story id for branch naming +
   commit messages: `STORY_ID = issue#N`.

#### gap-analysis mode

1. Read the gap analysis file (from `sdlc.gapAnalysis`) and find
   the row matching `$ARGUMENTS`.
2. Extract: **Description**, **Acceptance Criteria**, **Size**,
   **Epic name**, and **Phase**.
3. If not found, stop and tell the user.
4. If status is already `DONE` or `IN_REVIEW`, warn and ask whether
   to proceed.

### Step 2 — Plan Implementation

Read the cookbook (from `sdlc.cookbook`) to understand project
patterns. Based on the story, list:

- **Files to create** (new components, services, routes, tests)
- **Files to modify**
- **Database changes** (schema additions, if any)
- **Patterns to follow** (reference cookbook pattern numbers)

Present the plan to the user and wait for approval before proceeding.

### Step 3 — Create Feature Branch

```bash
git checkout main
git pull origin main
git checkout -b feature/{STORY_ID}-{kebab-description}
```

For github-issues mode, `STORY_ID` is the bare issue number
(e.g. `42`) so branches become `feature/42-add-login`.

### Step 4 — Implement Code

Follow cookbook patterns. Mandatory rules:

- Follow all patterns documented in the cookbook — don't deviate
  without justification.
- Use the design system tokens (from `sdlc.designSystem`) — no
  hardcoded visual values.
- Use the shared test infrastructure (from `sdlc.testInfrastructure`)
  — no inline mocks.
- Ensure zero lint errors — fix pre-existing errors in a separate
  commit if needed.
- Scope all database queries by tenant when the project is
  multi-tenant.
- Add both EN and DE translations for new i18n keys (when the
  project has i18n).

### Step 5 — Write Tests

Use the shared test infrastructure. Minimum test count is
`sdlc.minTests` (default `13`).

**Test layers:**
- Frontend component tests — shared harness, mock factories.
- Backend service tests — shared mock DB, mock auth context.
- E2E tests — page objects, navigation helpers.

**Never:**
- Inline mock objects — use shared factories.
- Make real HTTP calls — mock all services.
- Copy-paste mock setup — use shared utilities.

### Step 6 — Verify Quality

```bash
# Lint (zero errors required)
npx nx lint frontend
npx nx lint backend

# Tests
npx nx test frontend
npx nx test backend

# Build
npx nx build frontend
npx nx build backend
```

If lint fails, fix errors immediately. **Never use `--no-verify`.**

### Step 7 — Commit

```bash
git add -A
git commit -m "feat({scope}): {STORY_ID} — {description}"
```

Use scopes from `sdlc.scopes`. For github-issues mode, the body of
the commit message should include `Refs #N` so GitHub links it back.

### Step 8 — Create PR

```bash
git push -u origin feature/{STORY_ID}-{kebab-description}
```

Read the PR template from `sdlc.prTemplate` (if present) and fill
it in. For github-issues mode, the PR body **must** include
`Closes #N` so merging the PR auto-closes the issue.

```bash
gh pr create --title "feat({scope}): #{N} — {short description}" --body "$(cat <<'EOF'
## Summary
- {1-3 bullet points}

## Story
{Closes #N}    ← github-issues mode
{or: STORY_ID — story title} ← gap-analysis mode

## Changes
- [x] Frontend: {files}
- [x] Backend: {files}
- [ ] Database: {Y/N}

## Test Plan
{Acceptance criteria as checklist}

## Tests Added
- [x] Frontend component tests ({count})
- [x] Backend service tests ({count})
- [x] E2E tests ({count})

## Checklist
- [x] Builds pass
- [x] Lint passes (zero errors)
- [x] Tests pass
- [x] Design tokens used
EOF
)"
```

### Step 9 — Transition story to In Review

#### github-issues mode

```bash
gh issue edit "$N" \
  --remove-label "kanban:in-progress" \
  --add-label "kanban:in-review"
```

Optionally comment on the issue with the PR URL so the linkback is
visible without leaving the issue.

#### gap-analysis mode

Update the story status in the gap analysis file:
- Set `Status` to `IN_REVIEW`
- Set `Branch` to the feature branch name

Commit this to the specs repo (from `sdlc.specsRepo`):

```bash
cd {sdlc.specsRepo}
git add gap-analysis.md
git commit -m "docs: mark {STORY_ID} as IN_REVIEW"
```

## Error Recovery

- Lint fails → fix errors, re-run, continue.
- Tests fail → fix test or code, re-run, continue.
- Build fails → fix compilation errors, re-run, continue.
- PR creation fails → check `gh auth status`, retry.
- Branch exists → checkout existing branch and continue.
- Issue not in `kanban:in-progress` (github mode) → run
  `gh-wip-enforcer #N` first, then re-invoke.

## Output

Report: Story ID (or issue #N), files created/modified, test count,
PR URL, label transitions performed.
