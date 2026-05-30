# de Braighter Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `de-braighter/` cluster root and the `braighter-io/workbench` repo with canonical Claude Code content (agents, skills, settings, policies, templates, workflows, project descriptors). End-state: Claude Code launches from `de-braighter/` with all agents and skills available; the cluster's first repo exists with first commit pushed to GitHub.

**Architecture:** Cwd-model cluster pattern per spec `2026-05-24-de-braighter-clean-structure-design.md` §4. `de-braighter/` is the cluster root and is itself the workbench repo's working tree. Sibling layer/domain/attic repos (not part of this plan) live as `.gitignored` subdirs under `layers/`, `domains/`, and `attic/`. No sync mechanism — `.claude/` is canonical at the root.

**Tech Stack:** Markdown, YAML, JSON, shell scripts. No build system. `gh` CLI for GitHub repo creation. `git` for version control.

**Out of scope (handled by follow-up plans):**
- Layer repo creation (`substrate`, `design-system`, `specs`, `platform`)
- Domain repo creation (`exercir`)
- Attic repo creation + legacy pack migration
- Content migration from existing prototypes into layer/domain repos
- Cleanup of `D:/development/projects/braighter/` and `D:/development/projects/exercir/*` prototype directories
- MEMORY.md sweep

---

## Pre-flight check

Before starting, confirm:

- [ ] **`gh` CLI is installed and authenticated**

Run: `gh auth status`
Expected: confirms you're logged in as the user with access to `braighter-io` org.

- [ ] **Workbench-next source content is reachable for copying**

Run: `ls D:/development/projects/exercir/workbench-next/workbench/agents/ | wc -l`
Expected: `22` (22 agent definition files).

Run: `ls D:/development/projects/exercir/workbench-next/.agents/skills/ | wc -l`
Expected: `39` (39 skill folders).

- [ ] **`de-braighter/` target does not yet exist**

Run: `ls D:/development/projects/de-braighter/ 2>&1 | head -1`
Expected: error indicating directory does not exist. If it exists, stop and confirm with the user before proceeding.

---

## Phase A — Cluster root + workbench repo

### Task A1: Create the `braighter-io/workbench` GitHub repo

**Files:** none locally yet.

- [ ] **Step 1: Create the GitHub repo (empty)**

Run: `gh repo create braighter-io/workbench --public --description "de Braighter Claude-Code-native workbench (cluster root, canonical .claude/, policies, templates, workflows)"`
Expected: `https://github.com/braighter-io/workbench` printed.

- [ ] **Step 2: Verify the repo exists and is empty**

Run: `gh repo view braighter-io/workbench --json name,description,defaultBranchRef`
Expected: JSON with `"name":"workbench"`, default branch field is `null` (no commits yet).

### Task A2: Create the local cluster root and initialize git

**Files:**
- Create: `D:/development/projects/de-braighter/`

- [ ] **Step 1: Create the directory**

Run: `mkdir D:/development/projects/de-braighter`
Expected: directory exists.

- [ ] **Step 2: Initialize git inside it**

Run (from `D:/development/projects/de-braighter/`):
```
git init
git branch -M main
git remote add origin git@github.com:braighter-io/workbench.git
```
Expected: `Initialized empty Git repository`; remote `origin` shown by `git remote -v`.

### Task A3: Write the `.gitignore`

**Files:**
- Create: `D:/development/projects/de-braighter/.gitignore`

- [ ] **Step 1: Write the `.gitignore`**

Content:
```gitignore
# Layer sibling repos (each has its own .git)
layers/*
!layers/.gitkeep

# Domain sibling repos (each has its own .git)
domains/*
!domains/.gitkeep

# Attic is a sibling git repo (preservation only)
attic/

# Build / runtime artifacts
node_modules/
dist/
.nx/
.angular/
tmp/
*.log

# IDE
.idea/
.vscode/

# OS
.DS_Store
Thumbs.db

# Local-only settings (Claude Code)
.claude/settings.local.json
```

- [ ] **Step 2: Create placeholder dirs with `.gitkeep` so they're tracked**

Run (from `de-braighter/`):
```
mkdir layers
touch layers/.gitkeep
mkdir domains
touch domains/.gitkeep
```
Expected: `layers/` and `domains/` exist with `.gitkeep` inside each.

### Task A4: Write the initial `README.md`

**Files:**
- Create: `D:/development/projects/de-braighter/README.md`

- [ ] **Step 1: Write the README**

Content:
```markdown
# de Braighter Workbench

The cluster root + Claude-Code-native workbench for the de Braighter ecosystem.

This repository is both:

1. **A git repo** (`braighter-io/workbench`) holding canonical `.claude/agents/`, `.claude/skills/`, policies, templates, workflows, and project descriptors.
2. **The cluster root** — sibling layer + domain + attic repos clone into `layers/`, `domains/`, and `attic/` (each with its own `.git`, ignored at this repo's level).

Claude Code is **always launched from this directory**. `.claude/` here applies to all work across the cluster.

## Layout

\`\`\`
de-braighter/                     ← this repo
├── .claude/                      ← canonical agents, skills, settings
├── policies/                     ← coding, testing, git, docs, voice
├── templates/                    ← adr, concept, story, pr, sprint
├── workflows/                    ← verifier-wave, designer-first, story-tracker
├── projects/<key>/project.yaml   ← per-domain descriptors (metadata only)
├── docs/superpowers/             ← design specs + implementation plans
├── layers/                       ← cluster dir: sibling layer repos (gitignored here)
├── domains/                      ← cluster dir: sibling domain repos (gitignored here)
└── attic/                        ← preservation repo (gitignored here)
\`\`\`

## Foundation status

This repo was scaffolded on 2026-05-24 per `docs/superpowers/specs/2026-05-24-de-braighter-clean-structure-design.md`. Layer and domain repos are not yet scaffolded — see `docs/superpowers/plans/` for the migration plans.
```

### Task A5: Write `LICENSE`

**Files:**
- Create: `D:/development/projects/de-braighter/LICENSE`

- [ ] **Step 1: Write MIT license**

Content (replace `<YEAR>` with `2026` and `<HOLDER>` with `de Braighter`):
```
MIT License

Copyright (c) 2026 de Braighter

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Task A6: First commit + push

- [ ] **Step 1: Stage all files**

Run (from `de-braighter/`):
```
git add .gitignore README.md LICENSE layers/.gitkeep domains/.gitkeep
git status
```
Expected: 5 new files staged.

- [ ] **Step 2: Commit**

Run:
```
git commit -m "chore: scaffold cluster root and workbench repo"
```
Expected: commit created on `main`.

- [ ] **Step 3: Push**

Run:
```
git push -u origin main
```
Expected: branch `main` set up to track `origin/main`; push succeeds.

- [ ] **Step 4: Verify on GitHub**

Run: `gh repo view braighter-io/workbench --web`
Expected: opens the repo in browser; default branch is `main`; the 3 files are visible.

---

## Phase B — Canonical Claude Code content

### Task B1: Create `.claude/` structure

**Files:**
- Create: `D:/development/projects/de-braighter/.claude/agents/`
- Create: `D:/development/projects/de-braighter/.claude/skills/`
- Create: `D:/development/projects/de-braighter/.claude/commands/`
- Create: `D:/development/projects/de-braighter/.claude/settings.json`

- [ ] **Step 1: Create the directories**

Run (from `de-braighter/`):
```
mkdir -p .claude/agents .claude/skills .claude/commands
```
Expected: all three directories exist.

### Task B2: Copy the 22 canonical agents

**Files:**
- Create: `D:/development/projects/de-braighter/.claude/agents/<each>.md` (22 files)

Source: `D:/development/projects/exercir/workbench-next/workbench/agents/`

- [ ] **Step 1: Copy all 22 agent files**

Run (from `de-braighter/`):
```
cp D:/development/projects/exercir/workbench-next/workbench/agents/*.md .claude/agents/
ls .claude/agents/ | wc -l
```
Expected: `22`.

- [ ] **Step 2: Verify expected names are present**

Run: `ls .claude/agents/`
Expected output contains: `a11y-pro.md charter-checker.md design-prompter.md designer.md fhir-pro.md i18n-pro.md implementer.md local-ci.md observability-pro.md prisma-pro.md product-strategist.md qa-engineer.md reviewer.md spec-auditor.md substrate-architect.md substrate-coder-pro.md swiss-pro.md test-pro.md triage.md tuning-watcher.md ui-pro.md windows-devops-pro.md`

### Task B3: Copy the 39 canonical skills

**Files:**
- Create: `D:/development/projects/de-braighter/.claude/skills/<each>/...` (39 skill folders)

Source: `D:/development/projects/exercir/workbench-next/.agents/skills/`

- [ ] **Step 1: Copy all 39 skill folders**

Run (from `de-braighter/`):
```
cp -r D:/development/projects/exercir/workbench-next/.agents/skills/* .claude/skills/
ls .claude/skills/ | wc -l
```
Expected: `39`.

- [ ] **Step 2: Spot-check a skill folder has the expected SKILL.md or equivalent**

Run: `ls .claude/skills/architecture-concierge/`
Expected: at least one `.md` file (SKILL definition).

### Task B4: Write `.claude/settings.json`

**Files:**
- Create: `D:/development/projects/de-braighter/.claude/settings.json`

- [ ] **Step 1: Write minimal settings**

Content:
```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git branch:*)",
      "Bash(gh repo view:*)",
      "Bash(gh issue list:*)",
      "Bash(gh pr list:*)"
    ]
  }
}
```

The `permissions.allow` list is the minimum for read-only git/gh operations; expand as needed via the `/fewer-permission-prompts` skill once usage patterns emerge.

### Task B5: Commit + push the .claude/ canonical content

- [ ] **Step 1: Stage**

Run (from `de-braighter/`):
```
git add .claude/
git status
```
Expected: `.claude/agents/` (22 files), `.claude/skills/` (39 folders), `.claude/settings.json` all staged.

- [ ] **Step 2: Commit**

Run:
```
git commit -m "chore: import canonical .claude/agents, .claude/skills, and base settings"
```

- [ ] **Step 3: Push**

Run: `git push`

---

## Phase C — Workbench supporting content

### Task C1: Write `policies/` (5 files)

**Files:**
- Create: `de-braighter/policies/coding.md`
- Create: `de-braighter/policies/testing.md`
- Create: `de-braighter/policies/git.md`
- Create: `de-braighter/policies/docs.md`
- Create: `de-braighter/policies/voice.md`

- [ ] **Step 1: Create the directory**

Run (from `de-braighter/`): `mkdir policies`

- [ ] **Step 2: Write `policies/coding.md`**

Content:
```markdown
---
title: Coding standards
last_updated: 2026-05-24
---

# Coding standards

Detailed standards are maintained in `layers/specs/instructions/` (once the specs layer is scaffolded). This file is the stub that points there.

## Principles (foundational)

- **YAGNI** — build what's needed, not what might be needed.
- **DRY** — share code via clear, well-named units; don't duplicate logic, but don't over-abstract three similar lines into a framework.
- **Composition over inheritance.**
- **Substrate hygiene** — primitives that touch Layer 1 (Subject / Indicator / Intervention / Observation / Plan) must be substrate-shape; no domain-specific extensions in the typed vocabulary itself.
- **Effect-algebra shape even before effect-algebra** — declared effects on plan-node primitives must be structured values (indicator + direction + magnitude + confidence + horizon), not free text.

## Per-language conventions

- TypeScript: strict mode; explicit return types on exported functions; no `any` without justification.
- Angular: standalone components; signal-based inputs; OnPush change detection; no `@Input()`/`@Output()` decorators (use `input()` / `output()` signals).
- NestJS: hexagonal architecture; `inAdapters/`, `outAdapters/`, `outPorts/`, `useCases/`.
- Prisma: row-level security on every table holding tenant data; two-role pattern (superuser for migrations, runtime role for app).

## Related

- `policies/testing.md` for test discipline
- `policies/git.md` for commit + PR discipline
- `policies/docs.md` for documentation discipline
```

- [ ] **Step 3: Write `policies/testing.md`**

Content:
```markdown
---
title: Testing discipline
last_updated: 2026-05-24
---

# Testing discipline

## Principles

- **TDD by default.** Write the failing test first, then the implementation.
- **Test what changes, not what stays.** Integration tests are higher leverage than unit tests for code that crosses repo boundaries (e.g., substrate consumers).
- **Never mock the database in integration tests.** Mock/prod divergence has masked broken migrations in the past.
- **Run the verifier wave** (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`) on every non-trivial PR per `workflows/verifier-wave.md`.

## Per-project runners

- TypeScript projects with Nx: prefer `nx test <project>` over invoking jest/vitest directly.
- Mixed jest + vitest workspaces: always go through Nx so the right runner is selected.

## What blocks merge

- Any failing test in `local-ci`.
- Any BLOCKING-severity finding from `reviewer` or `qa-engineer`.
- A charter-check fail from `charter-checker`.
```

- [ ] **Step 4: Write `policies/git.md`**

Content:
```markdown
---
title: Git + PR discipline
last_updated: 2026-05-24
---

# Git + PR discipline

## PR-everywhere

**All repos go through PRs**, including `specs/` (ADRs, concept docs). No direct-to-main pushes. This reverses the previous "Specs/main workflow vs services PR workflow" split documented in the legacy `exercir-workbench/.claude/agent-workflow.md` §6.4.

## Verifier wave

Every non-trivial PR (new endpoint, schema migration, multi-component UI feature, cross-pack contract change) gets the four-agent verifier wave **in parallel** before merging:

- `local-ci` — build + test + lint + PHI scan
- `reviewer` — adversarial code review
- `charter-checker` — charter compliance
- `qa-engineer` — cross-cutting (coverage, a11y, perf, observability, contract drift, doc completeness)

All four dispatched in one message with multiple tool calls. All four use `isolation: "worktree"`. Disagreement escalates to the founder. See `workflows/verifier-wave.md` for details.

## Hard rules

- **Never `--no-verify`.** Pre-push hooks (PHI scanner, secret scanner) are the only gates between work and the remote when GHA is frozen. Fix the underlying issue if a hook fails; do not bypass.
- **Never force-push to `main`/`master`.** Force-push to feature branches is OK only when explicitly authorized.
- **Never amend a commit after a hook failed.** The hook failure means the commit didn't happen; `--amend` modifies the PREVIOUS commit and can destroy work. Re-stage and create a NEW commit.
- **Don't bundle unrelated changes** in one commit or PR.

## Commit messages

- Imperative mood ("add X", "fix Y", not "added X", "fixed Y").
- First line ≤ 72 characters.
- Body explains *why*, not *what* (the diff shows what).
- Co-authored-by trailers for AI-assisted commits per the team convention.

## Branches

- Feature branches off `main`. Squash-merge to `main` via PR.
- Per-story branches named `feat/<short-slug>` or `fix/<short-slug>`.
```

- [ ] **Step 5: Write `policies/docs.md`**

Content:
```markdown
---
title: Documentation discipline
last_updated: 2026-05-24
---

# Documentation discipline

## Where docs live

- **Per-repo CLAUDE.md** — Claude Code instructions specific to that repo.
- **Per-repo README.md** — human onboarding + 30-second pitch.
- **`layers/specs/`** — cross-repo knowledge: ADRs, concept docs, handbook, business concept, kanban.
- **`docs/superpowers/specs/`** in the workbench — design docs produced by the brainstorming skill.
- **`docs/superpowers/plans/`** in the workbench — implementation plans produced by the writing-plans skill.

## Quality bar

- Run the `md-quality-review` skill before merging non-trivial markdown changes.
- ISO dates everywhere (YYYY-MM-DD).
- Mermaid for diagrams (use the `mermaid-converter` skill to upgrade ASCII diagrams).
- One source of truth — if a fact appears in two places, pick one and link from the other.

## Frontmatter

Markdown documents with metadata use YAML frontmatter:

\`\`\`yaml
---
title: ...
last_updated: YYYY-MM-DD
status: draft | accepted | superseded | archived
---
\`\`\`
```

- [ ] **Step 6: Write `policies/voice.md`**

Content:
```markdown
---
title: Writing voice
last_updated: 2026-05-24
---

# Writing voice

## For all docs (specs, ADRs, READMEs, concept docs)

- **Direct.** Lead with the fact or the decision; explain after.
- **Terse but complete.** No filler; no "as we discussed previously" hedges.
- **Concrete over abstract.** A file path beats a category name; a count beats "several".
- **Honest about uncertainty.** Use "I don't know" and "this is a guess" where they apply.
- **No emojis** in code, specs, or commits unless explicitly requested.

## For commit messages + PR descriptions

- Imperative mood.
- The *why* belongs in the body, not the title.
- Reference issues by `#N` or the full `owner/repo#N` form across repos.

## For inline code comments

- Default: no comments. Well-named identifiers are documentation.
- Add a comment only when the *why* is non-obvious — a hidden constraint, a subtle invariant, a workaround for a specific bug.
- Don't reference the current task or the PR ("added for ticket-123", "used by Y") — that rot s fast and lives in PR descriptions, not in code.
```

- [ ] **Step 7: Verify all 5 files exist**

Run: `ls policies/`
Expected: `coding.md  docs.md  git.md  testing.md  voice.md`

### Task C2: Write `templates/` (5 subdir structures)

**Files:**
- Create: `de-braighter/templates/adr/template.md`
- Create: `de-braighter/templates/concept/template.md`
- Create: `de-braighter/templates/story/template.md`
- Create: `de-braighter/templates/pr/template.md`
- Create: `de-braighter/templates/sprint/template.md`

- [ ] **Step 1: Create the directories**

Run (from `de-braighter/`):
```
mkdir -p templates/adr templates/concept templates/story templates/pr templates/sprint
```

- [ ] **Step 2: Write `templates/adr/template.md`**

Content:
```markdown
---
title: "ADR-NNN — <short title>"
status: proposed   # proposed | accepted | superseded | deprecated
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
authors: [<github-handle>]
domain: <layer or domain>
implements-enterprise-adr: E-NNN   # optional
supersedes: NNN                     # optional
superseded-by: NNN                  # optional
ratified-by:                         # optional
  - concept-doc-name.md
---

# ADR-NNN — <short title>

## Context

What forces this decision? What constraints are load-bearing? Cite relevant concept docs, prior ADRs, or external standards.

## Decision

The decision itself, stated as a single sentence first, then elaborated.

## Consequences

- What does this enable?
- What does this make harder?
- What invariants must hold for the decision to remain correct?

## Alternatives considered

| Option | Why not chosen |
|---|---|

## References

- Related ADRs: [ADR-NNN](./adr-NNN-...md)
- Related concept docs: [<name>](../concepts/<name>.md)
```

- [ ] **Step 3: Write `templates/concept/template.md`**

Content:
```markdown
---
title: <concept title>
status: draft   # draft | accepted | superseded
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
authors: [<github-handle>]
domain: <layer or domain>
relates-to:
  - <other-doc>.md
---

# <Concept title>

## Purpose

One paragraph: what is this concept and why does it exist?

## Definitions

Key terms used in this doc.

## The concept

Body of the doc — the actual concept. Use sections, tables, Mermaid diagrams as needed.

## Open questions

Numbered for citation in cascade work.

### Q1 — <question>

What's the question and what does the answer affect?

## Related

- ADRs: [ADR-NNN](../adr/adr-NNN-...md)
- Concept docs: [<name>](./<name>.md)
```

- [ ] **Step 4: Write `templates/story/template.md`**

Content (this is for the GitHub issue body, used by the `story-tracker` workflow):
```markdown
## Goal

One sentence: what does "done" look like for this stream-of-work?

## Scope

What's in / what's out.

## Acceptance criteria

- [ ] criterion 1
- [ ] criterion 2

## Related

- Spec: [link]
- Plan: [link]
- ADRs touched: [links]

## Status

Current state of the work. Rewrite this section as the stream evolves.

---

(Session log lives in comments below — append-only.)
```

- [ ] **Step 5: Write `templates/pr/template.md`**

Content:
```markdown
## Summary

<1-3 bullets describing the change>

## Why

Link to the story tracker (e.g. `Closes #N` or `Refs #N`) and explain the motivation.

## Test plan

- [ ] What was tested manually
- [ ] What automated tests cover the change
- [ ] What's deliberately not tested and why

## Verifier wave

- [ ] local-ci passed
- [ ] reviewer passed (or BLOCK findings addressed)
- [ ] charter-checker passed
- [ ] qa-engineer passed

## Related

- Closes #N
- Implements ADR-NNN
```

- [ ] **Step 6: Write `templates/sprint/template.md`**

Content:
```markdown
---
title: Sprint <N> — <theme>
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: planned   # planned | in-progress | completed
duration: <N> days
---

# Sprint <N> — <theme>

## Sprint goal

One sentence describing what shipping this sprint accomplishes.

## Capacity

Computed by the `plan-sprint` skill from recent velocity.

## Stories

| # | Title | Estimate | Status |
|---|---|---|---|
| 1 | ... | ... | pending |

## Risks + blockers

What might stop this sprint from completing? What's the mitigation?

## Retro link

(Filled in by `sprint-retro` skill at sprint close.)
```

- [ ] **Step 7: Verify the templates exist**

Run: `find templates -name "template.md"`
Expected: 5 paths, one per subdir.

### Task C3: Write `workflows/` (initial set)

**Files:**
- Create: `de-braighter/workflows/verifier-wave.md`
- Create: `de-braighter/workflows/designer-first.md`
- Create: `de-braighter/workflows/story-tracker.md`

- [ ] **Step 1: Create the directory**

Run (from `de-braighter/`): `mkdir workflows`

- [ ] **Step 2: Write `workflows/verifier-wave.md`**

Content:
```markdown
---
title: Verifier wave
last_updated: 2026-05-24
---

# Verifier wave

The merge gate for every non-trivial PR.

## When it applies

Every PR that touches code, schema, or contract surface. Includes:

- New endpoints
- Schema migrations
- Multi-component UI features
- Cross-pack contract changes
- Cross-layer dependency changes

## When to skip

- Pure doc PRs (no code path touched)
- Single-line bug fixes with obvious test coverage
- Pure rename refactors

## The four agents

| Agent | Verifies | Read-only? |
|---|---|---|
| `local-ci` | Build + test + lint + PHI scan on PR head in an isolated worktree | Yes (uses temp worktree) |
| `reviewer` | Adversarial code review of the diff. Severity-tagged: must-fix / should-fix / nit | Yes |
| `charter-checker` | Compliance with the project charter (constraints document) | Yes |
| `qa-engineer` | Cross-cutting: test coverage, accessibility, performance budgets, observability, contract drift, doc completeness | Yes |

## How to dispatch

All four fire **in parallel** — single message with four `Agent` tool calls. Every spawn carries `isolation: "worktree"`.

## Verdict matrix

| State | Action |
|---|---|
| All 4 PASS | Squash-merge |
| Any 1 BLOCK | Fix in PR (if ~3-5 tool calls), then re-wave. Otherwise file follow-up tracker |
| Disagreement between agents | Escalate to founder via `AskUserQuestion` |

## SHOULD-FIX findings

In-PR fix preferred. ~3-5 tool calls beats ~15-20 for a follow-up ticket (~5× cost multiplier).

Defer to a follow-up only when the fix needs infrastructure outside PR scope, is a design decision the founder must weigh, or would explode the diff.
```

- [ ] **Step 3: Write `workflows/designer-first.md`**

Content:
```markdown
---
title: Designer-first for risky changes
last_updated: 2026-05-24
---

# Designer-first

Default flow:

\`\`\`
founder direction → implementer → verifier wave → merge
\`\`\`

For risky / architecturally-load-bearing work, insert a designer step:

\`\`\`
founder direction → designer (spec/ADR) → founder approves → implementer → verifier wave → merge
\`\`\`

## Triggers

- New port shape or kernel primitive
- Cross-cutting concern (touches >2 packs / >2 layers)
- Migration with non-obvious rollback or data-shape impact
- Anything where the implementer would otherwise be guessing at scope

## Agent selection

- Generic architecture → `designer` (markdown only; no code)
- Kernel-level / cross-cutting substrate → `substrate-architect`
- "What should we build next?" → `product-strategist` (reads roadmap/issues/retros; never auto-creates issues)

## Constraints in every designer brief

- Output is markdown only; do not write or modify any code files
- Single commit; no while-here cleanup; force-push never authorized

## Output

Designer produces either:

- A new ADR under `layers/specs/adr/`
- A new concept doc under `layers/specs/concepts/`
- An amendment to an existing ADR or concept doc

After founder approval of the spec, dispatch the `implementer` (or domain-specific implementer like `substrate-coder-pro`, `prisma-pro`, `ui-pro`, `swiss-pro`).
```

- [ ] **Step 4: Write `workflows/story-tracker.md`**

Content:
```markdown
---
title: Story tracker
last_updated: 2026-05-24
---

# Story tracker

A coarse `type/story` GitHub issue per stream-of-work. Replaces local handoff files.

## Shape

- One issue per stream, not per PR
- Body = current state (rewrite as the stream evolves)
- Comments = append-only session log
- PRs link to the tracker via `Refs #N` (or `Closes #N` in the merge commit that retires the stream)

## When the stream closes

When the original goal is met, a PR retires the tracker via `Closes #N`. If new related-but-distinct work emerges, spawn a fresh tracker rather than reopening the old one.

## Where issues file

All issues file to ONE repo per project regardless of which code repo holds the change. For de Braighter projects:

- TBD — founder to confirm at the first tracker creation. Likely `braighter-io/exercir` for everything until a meta-tracker repo is set up.

## Story body template

See `templates/story/template.md`.

## Examples

- A coarse story "drill-board-preview rendering completion" had Phase 1 (PR #1332) + Phase 2 (deferred follow-up). When Phase 1 merged, Phase 2 spawned a fresh tracker.
```

- [ ] **Step 5: Verify**

Run: `ls workflows/`
Expected: `designer-first.md  story-tracker.md  verifier-wave.md`

### Task C4: Write `projects/exercir/project.yaml`

**Files:**
- Create: `de-braighter/projects/exercir/project.yaml`

- [ ] **Step 1: Create the directory**

Run (from `de-braighter/`): `mkdir -p projects/exercir`

- [ ] **Step 2: Write `projects/exercir/project.yaml`**

Content:
```yaml
# Exercir — team-sports domain
# Status: product (only confirmed product as of 2026-05-24)
# Spec reference: docs/superpowers/specs/2026-05-24-de-braighter-clean-structure-design.md §3

name: exercir
domain: team-sports
status: product
repo: github.com/braighter-io/exercir
local: domains/exercir/

# Hints for orchestrator judgment, not enforcement. All agents and skills
# remain available; these lists describe the typical curation.
enabled:
  agents:
    suggested:
      - designer
      - implementer
      - reviewer
      - charter-checker
      - qa-engineer
      - local-ci
      - ui-pro
      - test-pro
      - prisma-pro
      - swiss-pro
  skills:
    suggested:
      - architecture-concierge
      - diff-refactor-engine
      - story-runner
      - md-quality-review
      - reactive-forms-cva-governance
      - nx-tag-architecture-governance
```

### Task C5: Migrate the design spec into the new workbench

**Files:**
- Create: `de-braighter/docs/superpowers/specs/2026-05-24-de-braighter-clean-structure-design.md`
- Create: `de-braighter/docs/superpowers/plans/2026-05-24-de-braighter-foundation.md`

- [ ] **Step 1: Create directories**

Run (from `de-braighter/`):
```
mkdir -p docs/superpowers/specs docs/superpowers/plans
```

- [ ] **Step 2: Copy the design spec**

Run:
```
cp D:/development/projects/braighter/docs/superpowers/specs/2026-05-24-de-braighter-clean-structure-design.md docs/superpowers/specs/
```

- [ ] **Step 3: Copy this implementation plan**

Run:
```
cp D:/development/projects/braighter/docs/superpowers/plans/2026-05-24-de-braighter-foundation.md docs/superpowers/plans/
```

- [ ] **Step 4: Verify both files are present**

Run: `ls docs/superpowers/specs/ docs/superpowers/plans/`
Expected: the two `.md` files exist at their respective paths.

### Task C6: Commit + push Phase C

- [ ] **Step 1: Stage**

Run (from `de-braighter/`):
```
git add policies/ templates/ workflows/ projects/ docs/
git status
```
Expected: many new files staged.

- [ ] **Step 2: Commit**

Run:
```
git commit -m "chore: add policies, templates, workflows, project descriptors, and design spec"
```

- [ ] **Step 3: Push**

Run: `git push`

---

## Phase D — Root CLAUDE.md + verify foundation

### Task D1: Write the cluster root `CLAUDE.md`

**Files:**
- Create: `de-braighter/CLAUDE.md`

- [ ] **Step 1: Write CLAUDE.md**

Content:
```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this directory is

`D:/development/projects/de-braighter/` is **both**:

1. The git repo `braighter-io/workbench` — canonical `.claude/agents/`, `.claude/skills/`, settings, policies, templates, workflows, project descriptors, and design docs.
2. The cluster root — sibling layer + domain + attic repos clone into `layers/`, `domains/`, and `attic/`.

**Claude Code is always launched from this directory.** `.claude/` here applies to all work across the cluster. Do not launch Claude Code from inside a sibling repo (you would lose access to the agents and skills).

## Layout

\`\`\`
de-braighter/                     ← this repo (braighter-io/workbench)
├── .claude/
│   ├── agents/                   ← 22 canonical agent definitions
│   ├── skills/                   ← 39 canonical skill folders
│   ├── commands/                 ← slash commands (when added)
│   └── settings.json
├── policies/                     ← coding.md, testing.md, git.md, docs.md, voice.md
├── templates/                    ← adr/, concept/, story/, pr/, sprint/
├── workflows/                    ← verifier-wave.md, designer-first.md, story-tracker.md
├── projects/<key>/project.yaml   ← per-domain descriptors (metadata only)
├── docs/superpowers/             ← design specs + implementation plans
├── layers/                       ← cluster: sibling layer repos (gitignored here)
│   ├── substrate/
│   ├── design-system/
│   ├── specs/
│   └── platform/
├── domains/                      ← cluster: sibling domain repos (gitignored here)
│   ├── exercir/
│   ├── conservation/
│   └── org-twin/
└── attic/                        ← preservation repo (gitignored here)
\`\`\`

## What's scaffolded today (2026-05-24 foundation)

- The workbench repo itself (this repo) with canonical `.claude/`, policies, templates, workflows, project descriptors, and design docs.
- **Not yet scaffolded:** any layer or domain repo. They come via follow-up plans in `docs/superpowers/plans/`.

The current Exercir / substrate / design-system / specs / platform code still lives in the prototype directories at `D:/development/projects/braighter/` and `D:/development/projects/exercir/`. Migration is incremental, per follow-up plans.

## Workflow rules

- **PR-gated everywhere**, including specs/ADRs. No direct-to-main. See `policies/git.md`.
- **Verifier wave** (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`, in parallel, all with `isolation: "worktree"`) on every non-trivial PR. See `workflows/verifier-wave.md`.
- **Designer-first** for risky changes — new ports, kernel primitives, cross-cutting concerns. See `workflows/designer-first.md`.
- **Story trackers** as coarse GitHub issues, not local handoff files. See `workflows/story-tracker.md`.
- **Auto-mode default** — make mechanical calls without asking; escalate only on architectural / scope / convention-contradiction / visible-to-others decisions.
- **Substrate hygiene without substrate ambition** — primitives are substrate-shape; don't market the substrate externally.

## Naming

- GitHub org: `braighter-io` (kept for now; future migration TBD).
- Local cluster + npm scope: `de-braighter` / `@de-braighter`.
- Substrate packages: `@de-braighter/substrate-contracts`, `@de-braighter/substrate-runtime`.
- Domain names: freely chosen per domain. `exercir` (team sports). Working names for prototypes: `conservation`, `org-twin`.

## Design references

- **Topology design**: `docs/superpowers/specs/2026-05-24-de-braighter-clean-structure-design.md`
- **Foundation plan** (what scaffolded this): `docs/superpowers/plans/2026-05-24-de-braighter-foundation.md`
- **North-star vision** (substrate framing): see the existing copy at `D:/development/projects/exercir/exercir-workbench/specs/exercir-specs/concepts/substrate/north-star-vision-capture-2026-05-17.md` until specs is scaffolded.

## What NOT to do

- Don't launch Claude Code from inside `layers/*` or `domains/*` — launch from `de-braighter/` root.
- Don't add code (TypeScript, scripts that build, etc.) to this workbench repo. It's declarative content + design docs only. Code lives in sibling layer/domain repos.
- Don't bypass pre-push hooks (`--no-verify`, sign-bypass).
- Don't market "digital twin platform" or "AWS for systems modeling" externally — the substrate is internal infrastructure per Option A.
```

### Task D2: Final commit + push

- [ ] **Step 1: Stage**

Run (from `de-braighter/`):
```
git add CLAUDE.md
```

- [ ] **Step 2: Commit**

Run:
```
git commit -m "docs: add cluster root CLAUDE.md"
```

- [ ] **Step 3: Push**

Run: `git push`

### Task D3: Verify the foundation

- [ ] **Step 1: Confirm directory structure**

Run (from `de-braighter/`):
```
ls -1
```
Expected: `.claude  .gitignore  CLAUDE.md  LICENSE  README.md  docs  domains  layers  policies  projects  templates  workflows`

- [ ] **Step 2: Confirm agent count**

Run: `ls .claude/agents/ | wc -l`
Expected: `22`

- [ ] **Step 3: Confirm skill count**

Run: `ls .claude/skills/ | wc -l`
Expected: `39`

- [ ] **Step 4: Confirm policies, templates, workflows, projects**

Run:
```
ls policies/ | wc -l       # 5
ls templates/ | wc -l      # 5
ls workflows/ | wc -l      # 3
ls projects/ | wc -l       # 1 (exercir/)
```

- [ ] **Step 5: Confirm design spec + plan are in place**

Run:
```
ls docs/superpowers/specs/   # 2026-05-24-de-braighter-clean-structure-design.md
ls docs/superpowers/plans/   # 2026-05-24-de-braighter-foundation.md
```

- [ ] **Step 6: Launch Claude Code from de-braighter/ and confirm**

Outside this plan (manual verification by the founder):

1. Open a terminal at `D:/development/projects/de-braighter/`.
2. Launch Claude Code.
3. Confirm that listing available agents shows the 22 canonical agents (designer, implementer, reviewer, charter-checker, qa-engineer, local-ci, ui-pro, test-pro, prisma-pro, swiss-pro, etc.).
4. Confirm that the brainstorming, writing-plans, architecture-concierge, diff-refactor-engine, md-quality-review skills are available via the Skill tool.
5. Open `CLAUDE.md` and confirm it loads as project context.

If any of the above fails, the foundation is broken. Stop and report; do not proceed to follow-up migration plans.

- [ ] **Step 7: Confirm GitHub state**

Run:
```
gh repo view braighter-io/workbench
gh repo view braighter-io/workbench --json defaultBranchRef,name,description
```
Expected: repo exists, default branch `main`, description matches, 4 commits on `main`.

---

## Self-review checklist

After the engineer finishes the plan:

- [ ] **Coverage:** every section of the design spec §2-§8 either landed here OR is explicitly deferred to a follow-up plan listed in §10 of the spec.
- [ ] **Placeholder scan:** the only "TBD" in the new content is `workflows/story-tracker.md`'s "Where issues file: TBD — founder to confirm" — that's a deliberate deferred decision, not a plan gap.
- [ ] **Type consistency:** `domain` (not `track`/`product`), `status: prototype | product | archived`, `@de-braighter/*` scope, all consistent across files.
- [ ] **Verifier-wave content matches:** the policy reference and the workflow doc both name the same 4 agents and the same dispatch rules.

---

## What's next (out of scope for this plan)

Follow-up plans, each producing a working end-state on its own:

1. **`braighter-io/specs`** — knowledge layer. Merge `the-braighter-specs`, `exercir-specs`, and `the-braighter-business-concept` into one PR-gated specs repo.
2. **`braighter-io/substrate`** — kernel layer. Absorb `substrate_wb/substrate/`. Publish `@de-braighter/substrate-contracts` + `@de-braighter/substrate-runtime`.
3. **`braighter-io/design-system`** — UI layer. Merge `braighter-design-system/` + `workbench-next/packages/{design-system,form-controls}`.
4. **`braighter-io/platform`** — IaC layer. Carry forward `exercir-platform`.
5. **`braighter-io/exercir`** — team-sports domain. Migrate `pack-football` from legacy exercir-service; team-sports narrowing applied.
6. **`braighter-io/attic`** — preservation repo. Move the 4 non-football packs (oncology, physio, mental-health, care/Pflege) with their tests intact.
7. **`braighter-io/conservation`** — domain prototype. Scaffold only when next active.
8. **Cleanup plan** — remove redundant local checkouts at `D:/development/projects/braighter/` and `D:/development/projects/exercir/exercir-workbench/` and `D:/development/projects/exercir/workbench-next/`. Sweep MEMORY.md.

Each is its own plan written when the work becomes active.
