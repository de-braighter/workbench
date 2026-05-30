# Design-System Layer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Establish the org design-system as `de-braighter/layers/design-system/` by reclaiming the `braighter-io/design-system` name (rename of `braighter-design-system`) and cloning it into the cluster, then refreshing its stale CLAUDE.md.

**Architecture:** `braighter-design-system` is already a coherent Nx workspace (6 libs: `design-system-{core,css,angular,react}` + `eyecatchers-{core,angular}` + a showcase app, `@de-braighter/*` scope already). Simplest path: rename to reclaim the clean `design-system` name, clone fresh from `origin/main` (the local checkout is parked on a stale `pr-65-review` branch — PR #65 is already merged; main is canonical), refresh the CLAUDE.md (currently describes only eyecatchers, pre-dating the design-system-* libs).

**Tech Stack:** Nx, Angular 21, TypeScript, SCSS. Publishes `@de-braighter/design-system-*` + `@de-braighter/eyecatchers-*` libs.

**Decisions (from this session):**
- Reclaim `braighter-io/design-system` (rename `braighter-design-system`).
- Clone from `origin/main` (ignore the stale local `pr-65-review` branch).
- `eyecatchers-*` and `design-system-*` libs both stay (distinct families, not duplicates).
- Scope is already `@de-braighter/*` — no scope change needed.
- **form-controls extraction is a SEPARATE follow-up plan** (extract from fabricir, wire into this workspace, fix `@fabricir/*` refs). Not in this plan.
- The fabricir Badge/Btn/Card primitives are NOT migrated (fabricir-app-specific).

**Out of scope:**
- form-controls extraction + integration (own follow-up)
- The fabricir UI primitives (not migrated)
- Pulling `ui-design/` out of specs into design-system (future; noted in specs plan)
- Any component code changes

---

## Pre-flight

- [ ] **Confirm repo + canonical branch + clone target**

Run:
```
gh repo view braighter-io/braighter-design-system --json name,defaultBranchRef,visibility
ls D:/development/projects/de-braighter/layers/design-system 2>&1 | head -1
```
Expected: repo exists, default branch `main`; `layers/design-system` does not exist yet.

---

## Task 1: Reclaim the `design-system` repo name

**Visible-to-others action** — controller confirms before running.

- [ ] **Step 1: Rename on GitHub**

Run: `gh repo rename design-system --repo braighter-io/braighter-design-system --yes`
Expected: renamed to `braighter-io/design-system`. Old URL auto-redirects.

- [ ] **Step 2: Verify**

Run: `gh repo view braighter-io/design-system --json name,defaultBranchRef`
Expected: `name: "design-system"`, default branch `main`.

## Task 2: Clone into the cluster (from main)

- [ ] **Step 1: Clone**

Run (from `D:/development/projects/de-braighter/`):
```
git clone git@github.com:braighter-io/design-system.git layers/design-system
```
Expected: clones `origin/main` (the canonical state — NOT the stale pr-65-review branch, which only existed in the old working copy).

- [ ] **Step 2: Verify libs + branch**

Run:
```
cd D:/development/projects/de-braighter/layers/design-system
git branch --show-current          # expect main
ls libs/                           # expect design-system-angular design-system-core design-system-css design-system-react eyecatchers-angular eyecatchers-core
grep '"name"' package.json | head -1   # expect @de-braighter/eyecatchers (the umbrella root name)
```
Expected: on `main`; 6 libs present; `@de-braighter/*` scope.

- [ ] **Step 3: Confirm workbench gitignores the clone**

Run (from `D:/development/projects/de-braighter/`): `git status --porcelain | grep -c "layers/design-system"`
Expected: `0`.

## Task 3: Verify the build

Design-system is code — confirm the relocation didn't break it. Build a representative lib (full showcase build may be slow; building core is sufficient to confirm health).

- [ ] **Step 1: Install**

Run (from `layers/design-system/`): `npm install`
Expected: completes (audit advisories OK). If it fails, report BLOCKED — do not attempt fixes (relocation, not code change).

- [ ] **Step 2: Build a core lib**

Run: `npx nx build design-system-core`
Expected: build succeeds. (If the project name differs, run `npx nx show projects` first to find the core lib's exact name, then build it.)

## Task 4: Refresh the CLAUDE.md (via PR)

The existing CLAUDE.md describes only the old "eyecatchers" scope and predates the design-system-* libs + the cluster. Replace it.

- [ ] **Step 1: Branch**

Run (from `layers/design-system/`): `git checkout -b docs/refresh-cluster-claude-md`

- [ ] **Step 2: Overwrite `CLAUDE.md`**

Path: `D:/development/projects/de-braighter/layers/design-system/CLAUDE.md`. Exact content:
```markdown
# CLAUDE.md — design-system (UI layer)

The org-wide cross-platform visual foundation for the de Braighter ecosystem: tokens, skins, UI primitives ("bricks"), and the "eyecatchers" motion/viz component family. Angular today; native/RN planned.

## Position in the cluster

This repo clones into `de-braighter/layers/design-system/`. Claude Code is launched from the cluster root (`de-braighter/`), not from here. Agents and skills come from the cluster root's `.claude/`.

## Libraries

| Lib | Purpose |
|---|---|
| `design-system-core` | Platform-agnostic core — tokens, skins, bricks, math. Zero platform deps. |
| `design-system-css` | CSS/SCSS token + skin emission. |
| `design-system-angular` | Angular implementation of the bricks + skins. |
| `design-system-react` | React implementation (e.g. react-leaf shim for Angular-host embedding). |
| `eyecatchers-core` | Platform-agnostic motion/viz contracts, math, tokens. |
| `eyecatchers-angular` | Angular implementation of the eyecatcher components. |

`apps/showcase/` is the live demo with per-component playgrounds.

Scope: `@de-braighter/*` (already aligned with the cluster's npm scope).

## Conventions

- Angular: standalone components, signal `input()`/`output()` (no `@Input()`/`@Output()` decorators), `OnPush`.
- Platform-agnostic cores (`*-core`) must stay free of DOM / Angular / RN deps. Tag governance enforces this.
- Tokens originate in `design-system-core` and are emitted via `design-system-css`; prefer CSS custom properties over hard-coded values.
- Reduced motion: every motion-driven eyecatcher honors `prefers-reduced-motion`.

## Dependency direction

Design-system depends on nothing else in the cluster. Domains depend on design-system (one-way). Never import a domain or the substrate from here.

## Editing rules

- **PR-gated** per the workbench `policies/git.md`. Verifier wave includes `local-ci` (build) since this is code.
- Apply the Angular governance skills (reactive-forms-cva-governance, angular-signals-standalone-governance, angular-decomposition-governance) when working here.

## Roadmap notes

- **form-controls** (Reactive-Forms CVA widgets) will be extracted from the legacy fabricir repo into this design-system in a dedicated follow-up.
- `ui-design/` (UI design drop zone) currently lives in `layers/specs/`; it moves here in a future plan.

## What NOT to do

- Don't add domain logic. Domain content lives in `domains/*`.
- Don't break the platform-agnostic boundary of the `*-core` libs.
```

- [ ] **Step 3: Commit + push + PR**

Run (from `layers/design-system/`):
```
git add CLAUDE.md
git commit -m "docs: refresh CLAUDE.md for design-system cluster layer"
git push -u origin docs/refresh-cluster-claude-md
gh pr create --repo braighter-io/design-system --base main --head docs/refresh-cluster-claude-md --title "Refresh CLAUDE.md for design-system layer" --body "Replaces the stale eyecatchers-only CLAUDE.md with one describing the consolidated design-system (6 libs), the cluster position, conventions, and dependency direction. Doc-only. Per the 2026-05-25 design-system-layer-migration plan."
```
Expected: PR URL.

## Task 5: Verifier wave + merge

**Controller actions.**

- [ ] **Step 1:** Doc-only PR to a code repo. `md-quality-review` on the CLAUDE.md; `local-ci` build confirms health (already verified in Task 3). Dispatch as appropriate.

- [ ] **Step 2:** Merge (confirm — visible): `gh pr merge --repo braighter-io/design-system --merge --delete-branch`

- [ ] **Step 3:** Sync local main:
```
cd D:/development/projects/de-braighter/layers/design-system
git checkout main && git pull origin main
```

- [ ] **Step 4:** Final verification:
```
gh repo view braighter-io/design-system --json name,defaultBranchRef
test -f CLAUDE.md && echo "CLAUDE.md present"
ls libs/
```
Expected: repo `design-system`, default `main`, CLAUDE.md on main, 6 libs.

---

## Self-Review checklist (controller, after execution)

- [ ] Repo renamed `braighter-design-system` → `design-system`.
- [ ] Cloned into `layers/design-system/` from `main` (not the stale pr-65-review branch).
- [ ] 6 libs intact, `@de-braighter/*` scope.
- [ ] Representative build passes.
- [ ] CLAUDE.md refreshed via PR + merged.
- [ ] Workbench gitignores the clone.

## What's next

- **form-controls extraction** (own follow-up): extract from `workbench-next/packages/form-controls`, wire into this Nx workspace, fix `@fabricir/*` → `@de-braighter/*` refs.
- platform layer (also pulls `enterprise/docs/docker.md` out of specs)
- exercir domain (`@braighter-io/substrate-*` → `@de-braighter/*` scope switch happens here, lockstep with packs-workspace)
- attic, conservation, kanban-migration, cleanup
