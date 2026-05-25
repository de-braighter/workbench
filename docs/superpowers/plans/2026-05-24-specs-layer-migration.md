# Specs Layer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the three knowledge repos (`exercir-specs`, `the-braighter-specs`, `the-braighter-business-concept`) into a single `braighter-io/specs` repo, cloned at `de-braighter/layers/specs/`, with git history preserved from all three sources.

**Architecture:** Rename the largest source (`exercir-specs`, 353 commits) to `braighter-io/specs` — its history and structure carry over for free. Fold the two small sources in via `git subtree add` (preserves their history under a prefix): `the-braighter-specs` → `enterprise/`, `the-braighter-business-concept` → `business/`. The merge work lands on a branch, goes through a PR with a doc-appropriate verifier wave (spec-auditor + md-quality-review), then merges to main.

**Tech Stack:** git (subtree), gh CLI, markdown. No build system.

**Key decisions (from brainstorming):**
- Rename + merge histories (not greenfield).
- Enterprise content under `enterprise/` (preserves E-NNN vs NNN ADR distinction — see Insight in the design discussion).
- `kanban.md` rides along untouched; a SEPARATE follow-up plan handles kanban → GitHub Issues with relevance triage (drop the 4 archived packs' items).
- `ui-design/` rides along into `specs/ui-design/`; moves to the design-system layer in a future plan.
- PR-gated per `policies/git.md`. The rename + clone is setup (no PR); the content merge is a PR.

**Out of scope (separate follow-up plans):**
- kanban → GitHub Issues migration + relevance triage
- Moving `ui-design/` to the design-system layer
- Moving `enterprise/docs/docker.md` to the platform layer
- Updating every external reference to the old `exercir-specs` repo name (cleanup plan)
- Deleting the old local checkouts

---

## Pre-flight check

- [ ] **Confirm gh auth + the three remotes**

Run:
```
gh auth status
git -C "D:/development/projects/exercir/exercir-workbench/specs/exercir-specs" remote get-url origin
git -C "D:/development/projects/braighter/the-braighter-specs" remote get-url origin
git -C "D:/development/projects/braighter/the-braighter-business-concept" remote get-url origin
```
Expected:
- gh logged in as `stibos` (or the user's account with `braighter-io` access)
- `https://github.com/braighter-io/exercir-specs.git`
- `https://github.com/braighter-io/the-braighter-specs.git`
- `https://github.com/braighter-io/the-braighter-business-concept.git`

- [ ] **Confirm `de-braighter/layers/specs/` does not yet exist**

Run: `ls D:/development/projects/de-braighter/layers/specs 2>&1 | head -1`
Expected: error / does not exist. If it exists, STOP and confirm with the founder.

---

## Phase 0 — Get source repos clean + pushed

The history-preserving merge pulls from the remotes, so all valuable work must be committed and pushed first.

### Task 0.1: Push the exercir-specs ADR-175 amendment

**Files:** none (push only).

- [ ] **Step 1: Confirm the unpushed commit exists**

Run: `git -C "D:/development/projects/exercir/exercir-workbench/specs/exercir-specs" log --oneline origin/main..main`
Expected: shows `ab2d90d docs(adr-175): amendment 1 — re-spec to use out-adapters/ + out-ports/ per codebase precedent` (one commit).

- [ ] **Step 2: Push it**

Run: `git -C "D:/development/projects/exercir/exercir-workbench/specs/exercir-specs" push origin main`
Expected: `ab2d90d` pushed; `origin/main..main` now empty.

- [ ] **Step 3: Confirm clean (ignore the untracked .claude/)**

Run: `git -C "D:/development/projects/exercir/exercir-workbench/specs/exercir-specs" status --porcelain`
Expected: only `?? .claude/` remains (untracked junk — do NOT commit it; it is not spec content).

### Task 0.2: Commit + push the business-concept cookbook

**Files:**
- Commit: `ventures/exercir/design/implementation-cookbook.md` in `D:/development/projects/braighter/the-braighter-business-concept/`

- [ ] **Step 1: Confirm the uncommitted file**

Run: `git -C "D:/development/projects/braighter/the-braighter-business-concept" status --porcelain`
Expected: ` M ventures/exercir/design/implementation-cookbook.md` and `?? ventures/.idea/`.

- [ ] **Step 2: Stage ONLY the cookbook (not the .idea junk)**

Run: `git -C "D:/development/projects/braighter/the-braighter-business-concept" add ventures/exercir/design/implementation-cookbook.md`
Then: `git -C "D:/development/projects/braighter/the-braighter-business-concept" status --porcelain`
Expected: `M  ventures/exercir/design/implementation-cookbook.md` staged; `?? ventures/.idea/` still untracked (not staged).

- [ ] **Step 3: Commit**

Run:
```
git -C "D:/development/projects/braighter/the-braighter-business-concept" commit -m "docs: add exercir implementation cookbook"
```
Expected: 1 file changed, ~162 insertions.

- [ ] **Step 4: Push**

Run: `git -C "D:/development/projects/braighter/the-braighter-business-concept" push origin main`
Expected: push succeeds.

---

## Phase 1 — Rename + clone

### Task 1.1: Rename `braighter-io/exercir-specs` → `braighter-io/specs`

**Visible-to-others action** — confirm with the founder before running (the controller handles this confirmation; do not run blind if the harness blocks it).

- [ ] **Step 1: Rename on GitHub**

Run: `gh repo rename specs --repo braighter-io/exercir-specs --yes`
Expected: confirms rename to `braighter-io/specs`. GitHub auto-redirects the old URL.

- [ ] **Step 2: Verify**

Run: `gh repo view braighter-io/specs --json name,description`
Expected: `name: "specs"`. (Description still says whatever exercir-specs had — that's fine; we'll set it in a later step or leave it.)

### Task 1.2: Clone the renamed repo into the cluster

**Files:**
- Create: `D:/development/projects/de-braighter/layers/specs/` (clone)

- [ ] **Step 1: Clone**

Run (from `D:/development/projects/de-braighter/`):
```
git clone git@github.com:braighter-io/specs.git layers/specs
```
Expected: clones into `layers/specs/` with full history.

- [ ] **Step 2: Verify content + history carried over**

Run:
```
cd D:/development/projects/de-braighter/layers/specs
git log --oneline | wc -l        # expect 353+ (includes the pushed ADR-175 commit → 354)
ls -1                            # expect: 01-vision.md 02-charter.md 03-strategy.md 04-plan.md README.md _archive _brand _diagrams _inputs adr concepts cookbook glossary.md governance.md handbook kanban.md ui-design
```
Expected: ~354 commits; the exercir-specs directory structure present.

- [ ] **Step 3: Confirm the layers/specs clone is gitignored by the workbench**

Run (from `D:/development/projects/de-braighter/`): `git status --porcelain | grep -c "layers/specs"`
Expected: `0` (the workbench's `.gitignore` rule `layers/*` keeps the clone out of the workbench repo's tracking).

---

## Phase 2 — Merge enterprise + business sources (on a branch)

### Task 2.1: Create the merge branch

- [ ] **Step 1: Branch off main**

Run (from `D:/development/projects/de-braighter/layers/specs/`):
```
git checkout -b feat/merge-knowledge-sources
```
Expected: switched to new branch.

### Task 2.2: Subtree-merge `the-braighter-specs` under `enterprise/`

**Files:**
- Create: `enterprise/` (subtree: adr/, instructions/, docs/, HANDBOOK.md, README.md from the-braighter-specs)

- [ ] **Step 1: Subtree-add with history (from the local checkout — it equals origin after Phase 0, and avoids ssh/https auth mismatch)**

Run (from `layers/specs/`):
```
git subtree add --prefix=enterprise "D:/development/projects/braighter/the-braighter-specs" main
```
Expected: a merge commit; `enterprise/` now contains the-braighter-specs content (adr/ with E001/E002, instructions/, docs/docker.md, HANDBOOK.md, README.md). Note: `the-braighter-specs` was clean and fully pushed (verified pre-flight), so its local `main` equals `origin/main`.

- [ ] **Step 2: Verify enterprise history is preserved**

Run: `git log --oneline -- enterprise/adr/adr-E001-cloud-provider-policy.md`
Expected: shows the original commit(s) from the-braighter-specs (history preserved through the subtree).

- [ ] **Step 3: Verify structure**

Run: `ls -1 enterprise/`
Expected: `HANDBOOK.md  README.md  adr  docs  instructions`

### Task 2.3: Subtree-merge `the-braighter-business-concept` under `business/`

**Files:**
- Create: `business/` (subtree: braighter/, ventures/, templates/, README.md, CLAUDE.md from business-concept)

- [ ] **Step 1: Subtree-add with history (from the local checkout — it equals origin after Task 0.2 push)**

Run (from `layers/specs/`):
```
git subtree add --prefix=business "D:/development/projects/braighter/the-braighter-business-concept" main
```
Expected: a merge commit; `business/` now contains business-concept content including the just-committed `ventures/exercir/design/implementation-cookbook.md`. Note: Task 0.2 committed + pushed the cookbook, so the local `main` is complete.

- [ ] **Step 2: Verify the cookbook came across**

Run: `ls business/ventures/exercir/design/implementation-cookbook.md`
Expected: file exists.

- [ ] **Step 3: Verify business history is preserved**

Run: `git log --oneline -- business/README.md | head -3`
Expected: shows commits originating from the-braighter-business-concept.

- [ ] **Step 4: Remove the nested business/CLAUDE.md (avoids confusion — specs gets its own at root)**

Run (from `layers/specs/`):
```
git rm business/CLAUDE.md
git commit -m "chore: drop business-concept's CLAUDE.md (specs repo has its own root CLAUDE.md)"
```
Expected: 1 file removed, committed. (If `business/CLAUDE.md` does not exist, skip this step and note it.)

### Task 2.4: Verify the merged tree

- [ ] **Step 1: Confirm top-level structure**

Run (from `layers/specs/`): `ls -1`
Expected: the original exercir-specs entries PLUS `business/` and `enterprise/`:
`01-vision.md 02-charter.md 03-strategy.md 04-plan.md README.md _archive _brand _diagrams _inputs adr business concepts cookbook enterprise glossary.md governance.md handbook kanban.md ui-design`

- [ ] **Step 2: Confirm git history depth grew**

Run: `git log --oneline | wc -l`
Expected: 354 (exercir-specs) + 4 (the-braighter-specs) + 20 (business-concept) + the subtree merge commits + the CLAUDE.md removal ≈ 380+ commits reachable.

---

## Phase 3 — specs README + CLAUDE.md

### Task 3.1: Write the new `README.md` (overwrite the exercir-specs one)

**Files:**
- Modify: `D:/development/projects/de-braighter/layers/specs/README.md`

- [ ] **Step 1: Overwrite README.md with the consolidated knowledge-layer overview**

Exact content:
```markdown
# specs — de Braighter knowledge layer

The consolidated knowledge base for the de Braighter ecosystem: architecture decisions, concept docs, the handbook, conventions, and business strategy. Markdown only — no application code.

Consolidated 2026-05-24 from three sources (history preserved):

| Source repo | Now at | Content |
|---|---|---|
| `braighter-io/exercir-specs` (renamed to this repo) | repo root | Project ADRs (NNN), concepts, handbook, kanban, vision/charter/strategy/plan, cookbook, diagrams |
| `braighter-io/the-braighter-specs` | `enterprise/` | Enterprise ADRs (E-NNN), coding-standard instructions, infra docs |
| `braighter-io/the-braighter-business-concept` | `business/` | Venture strategy, marketing, financials |

## Layout

| Path | Purpose |
|---|---|
| `adr/` | Project-level ADRs (NNN format) |
| `enterprise/adr/` | Enterprise-wide ADRs (E-NNN format) |
| `enterprise/instructions/` | Coding standards, conventions, agent-behavior rules (auto-assembled `AGENTS.md`) |
| `concepts/` | Domain + substrate concept docs |
| `handbook/` | Layered onboarding handbook |
| `business/` | Venture strategy + marketing + financials |
| `kanban.md` | Work board (migration to GitHub Issues is a separate planned follow-up) |
| `cookbook/` | Implementation recipes |
| `_archive/`, `_brand/`, `_diagrams/`, `_inputs/` | Supporting assets |
| `ui-design/` | UI design drop zone (will move to the design-system layer in a future plan) |
| `glossary.md`, `governance.md` | Cross-cutting references |

## ADR numbering

| Prefix | Scope | Location |
|---|---|---|
| `E-NNN` | Enterprise-wide | `enterprise/adr/` |
| `NNN` | Project-specific | `adr/` |

Project ADRs may implement or extend an enterprise ADR via `implements-enterprise-adr: E-NNN` in frontmatter.

## Workflow

PR-gated — including this repo. No direct-to-main. See the workbench `policies/git.md`. The doc-appropriate verifier wave is `spec-auditor` + `md-quality-review`.
```

### Task 3.2: Write `CLAUDE.md`

**Files:**
- Create: `D:/development/projects/de-braighter/layers/specs/CLAUDE.md`

- [ ] **Step 1: Write CLAUDE.md**

Exact content:
```markdown
# CLAUDE.md — specs (knowledge layer)

Project-local guidance for the de Braighter knowledge layer. This repo holds **knowledge only** — ADRs, concept docs, handbook, conventions, business strategy. No application code.

## Position in the cluster

This repo clones into `de-braighter/layers/specs/`. Claude Code is launched from the cluster root (`de-braighter/`), not from here. Agents and skills come from the cluster root's `.claude/`.

## What lives here

- `adr/` — project ADRs (NNN). `enterprise/adr/` — enterprise ADRs (E-NNN).
- `enterprise/instructions/` — coding standards + conventions (the auto-assembled `AGENTS.md` and its fragments).
- `concepts/` — substrate + domain concept docs. The north-star vision lives at `concepts/substrate/north-star-vision-capture-2026-05-17.md`.
- `handbook/` — layered onboarding.
- `business/` — venture strategy (Exercir is the only active product; Strategir/Operir drafts retained for reference).
- `kanban.md` — work board (GitHub Issues migration planned separately).

## Editing rules

- **PR-gated.** No direct-to-main. Verifier wave for doc PRs = `spec-auditor` (cross-refs, numbering, dependency closure) + `md-quality-review`.
- **ISO dates** (YYYY-MM-DD) everywhere.
- **Cross-references are load-bearing** — every claim that depends on another doc carries a path + section. Broken cross-refs surface in `spec-auditor`.
- **ADR lifecycle:** `proposed` → `accepted` → `deprecated`/`superseded`. Use `templates/adr/template.md` from the workbench.
- **Don't edit `enterprise/instructions/AGENTS.md` directly** — it is auto-generated from `enterprise/instructions/fragments/`.

## What NOT to do

- Don't add application code here. Code lives in `layers/*` (substrate, design-system, platform) and `domains/*`.
- Don't market the substrate externally — internal framing only (per the north-star Option A).
```

### Task 3.3: Commit Phase 3

- [ ] **Step 1: Stage + commit**

Run (from `layers/specs/`):
```
git add README.md CLAUDE.md
git commit -m "docs: add consolidated specs README and CLAUDE.md"
```
Expected: 2 files changed (README modified, CLAUDE.md created).

---

## Phase 4 — PR + verifier wave + merge

### Task 4.1: Push the branch + open the PR

- [ ] **Step 1: Push the branch**

Run (from `layers/specs/`):
```
git push -u origin feat/merge-knowledge-sources
```
Expected: branch pushed; tracking set.

- [ ] **Step 2: Open the PR**

Run:
```
gh pr create --repo braighter-io/specs --base main --head feat/merge-knowledge-sources --title "Consolidate knowledge repos into specs" --body "$(cat <<'EOF'
## Summary
- Fold `the-braighter-specs` into `enterprise/` (history preserved via subtree)
- Fold `the-braighter-business-concept` into `business/` (history preserved via subtree)
- Add consolidated README + CLAUDE.md

## Why
Knowledge-layer consolidation per the de Braighter clean-structure design (`docs/superpowers/specs/2026-05-24-de-braighter-clean-structure-design.md` §7). This repo is the renamed `exercir-specs`.

## Verifier wave (doc-appropriate)
- [ ] spec-auditor (cross-refs, ADR numbering, dependency closure)
- [ ] md-quality-review

## Notes
- `kanban.md` rides along untouched; GitHub Issues migration is a separate planned follow-up.
- `ui-design/` rides along; moves to design-system layer in a future plan.
EOF
)"
```
Expected: PR URL printed.

### Task 4.2: Run the doc-appropriate verifier wave

**This is a controller action** (the orchestrator dispatches the verifier agents). The implementer subagent should STOP here and report the PR URL so the controller can run the wave.

- [ ] **Step 1: Controller dispatches `spec-auditor`** against the PR head — verify cross-references resolve, ADR numbering has no collisions (E-NNN under enterprise/, NNN under adr/), dependency closure intact after the merge.

- [ ] **Step 2: Controller dispatches `md-quality-review`** against the changed/added markdown (README.md, CLAUDE.md, and a sampling of the merged content) — structure, frontmatter, link integrity.

- [ ] **Step 3: Address any BLOCK findings** in the PR branch (in-PR fix preferred), then re-run the relevant check.

### Task 4.3: Merge the PR

**Visible-to-others action** — controller confirms before merging.

- [ ] **Step 1: Squash-merge**

Run: `gh pr merge --repo braighter-io/specs --squash --delete-branch`
Expected: PR merged to main; branch deleted.

- [ ] **Step 2: Sync local main**

Run (from `layers/specs/`):
```
git checkout main
git pull origin main
```
Expected: local main has the merge.

### Task 4.4: Final verification

- [ ] **Step 1: Confirm consolidated structure on main**

Run (from `layers/specs/`):
```
git checkout main && ls -1
```
Expected: includes `adr/`, `enterprise/`, `business/`, `concepts/`, `handbook/`, `kanban.md`, `README.md`, `CLAUDE.md`, `ui-design/`, etc.

- [ ] **Step 2: Confirm history from all three sources is reachable**

Run:
```
git log --oneline -- enterprise/adr/adr-E001-cloud-provider-policy.md | head -1
git log --oneline -- business/ventures/exercir/design/implementation-cookbook.md | head -1
git log --oneline -- adr/adr-001-multi-tenant-architecture.md | head -1
```
Expected: each returns at least one commit (history preserved for all three origins).

- [ ] **Step 3: Confirm GitHub repo name + default branch**

Run: `gh repo view braighter-io/specs --json name,defaultBranchRef`
Expected: `name: "specs"`, `defaultBranchRef.name: "main"`.

---

## Self-Review checklist (controller runs after execution)

- [ ] All three sources' history reachable in the merged repo (Task 4.4 Step 2).
- [ ] `enterprise/` and `business/` present with their content.
- [ ] The ADR-175 amendment (Task 0.1) and the cookbook (Task 0.2) are present in the merged tree.
- [ ] `kanban.md` present and unmodified.
- [ ] README + CLAUDE.md reflect the consolidated structure.
- [ ] PR went through `spec-auditor` + `md-quality-review` before merge.
- [ ] Repo renamed; default branch `main`.

---

## What's next (out of scope for this plan)

1. **kanban → GitHub Issues** — relevance triage first (drop the 4 archived packs' items + done items), then migrate survivors with `type/` labels, then retire `kanban.md`.
2. **`substrate` layer migration** — absorb `substrate_wb/substrate/`, publish `@de-braighter/substrate-{contracts,runtime}`.
3. **`design-system` layer migration** — also pulls `ui-design/` out of specs into the design-system repo.
4. **`platform` layer migration** — also pulls `enterprise/docs/docker.md` into platform.
5. **Reference-update sweep** — anything still pointing at `braighter-io/exercir-specs` (now redirected, but worth updating).
