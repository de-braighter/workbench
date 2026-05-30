# Exercir Domain Core Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Establish the exercir team-sports domain as `de-braighter/domains/exercir/` by reclaiming `braighter-io/exercir` (rename of `packs-workspace`, the substrate-v1-aligned codebase chosen as the future) and cloning it into the cluster, then adding a domain CLAUDE.md.

**Architecture:** `packs-workspace` (substrate-v1 shape, consumes `@braighter-io/substrate-*`) is the chosen basis for the exercir domain (the legacy `exercir-service` monolith is handled separately). Its `origin/main` is canonical and complete (both local checkouts are stale — behind main, their "ahead" commits are merged PR #78 pre-squash originals). All its packs are in team-sports scope. Simplest path: rename → clone from main → CLAUDE.md → build-verify. Same shape as the layer migrations.

**Tech Stack:** Nx, Angular 21, NestJS 10, Prisma, vitest. Consumes `@braighter-io/substrate-contracts` + `@braighter-io/substrate-runtime` (the kernel) and `@braighter-io/design-system-*`.

**Decisions (from this session):**
- Basis = `packs-workspace` (NOT exercir-service). exercir-service is legacy.
- Reclaim `braighter-io/exercir` (rename `packs-workspace`).
- Clone from `origin/main` (both stale local checkouts discarded).
- All packs in-scope: `pack-football`, `pack-football-ui`, `pack-club-mgmt`, `pack-kids-sports`, apps `pack-football-api` + `pack-football-visual-editor`. No narrowing needed (packs-workspace has no medical packs — those are only in exercir-service).
- Keep `@braighter-io/*` consumption (scope switch is a separate coordinated plan).

**Out of scope (separate follow-up plans):**
- **attic + exercir-service teardown** — move exercir-service's medical packs (oncology/physio/mental-health/care) to `attic`, archive the monolith.
- **scope switch** — coordinated `@braighter-io/*` → `@de-braighter/*` across substrate + design-system + exercir.
- **cherry-pick exercir-service unique work forward** — e.g. confirm the #1332 drill-board fix is reflected in packs-workspace's `pack-football-visual-editor`; port if not.
- Reconciling the two stale `packs-workspace` local checkouts beyond discarding them (cleanup plan).

---

## Pre-flight

- [ ] **Confirm repo + canonical state + clone target**

Run:
```
gh repo view braighter-io/packs-workspace --json name,defaultBranchRef,visibility
ls D:/development/projects/de-braighter/domains/exercir 2>&1 | head -1
```
Expected: `packs-workspace`, default `main`; `domains/exercir` does not exist yet.

---

## Task 1: Reclaim the `exercir` repo name

**Visible-to-others action** — controller confirms before running.

- [ ] **Step 1: Rename**

Run: `gh repo rename exercir --repo braighter-io/packs-workspace --yes`
Expected: renamed to `braighter-io/exercir`; old URL auto-redirects. (No conflict with `braighter-io/exercir-service`, which keeps its distinct name until the teardown plan.)

- [ ] **Step 2: Verify**

Run: `gh repo view braighter-io/exercir --json name,defaultBranchRef`
Expected: `name: "exercir"`, default `main`.

## Task 2: Clone into the cluster (from main)

- [ ] **Step 1: Clone**

Run (from `D:/development/projects/de-braighter/`):
```
git clone git@github.com:braighter-io/exercir.git domains/exercir
```
Expected: clones `origin/main` (the canonical, complete state — not the stale pr-78/detached checkouts).

- [ ] **Step 2: Verify packs + scope**

Run:
```
cd D:/development/projects/de-braighter/domains/exercir
git branch --show-current        # main
ls libs/                         # expect: pack-club-mgmt pack-football pack-football-ui pack-kids-sports
ls apps/                         # expect: pack-football-api pack-football-visual-editor
grep -r '@braighter-io/substrate' package.json | head -2   # confirms it consumes the kernel
git rev-list --count HEAD
```
Expected: on main; 4 libs + 2 apps; consumes `@braighter-io/substrate-*`; ~49 commits (45 + PR #78 squash + 4 newer).

- [ ] **Step 3: Confirm workbench gitignores the clone**

Run (from `D:/development/projects/de-braighter/`): `git status --porcelain | grep -c "domains/exercir"`
Expected: `0` (the `domains/*` gitignore rule).

## Task 3: Verify the build

Exercir is code — confirm the relocation didn't break it.

- [ ] **Step 1: Install**

Run (from `domains/exercir/`): `npm install`
Expected: completes (audit advisories OK). It will resolve `@braighter-io/substrate-*` from GitHub Packages — if that registry needs auth and fails, report BLOCKED with the error (do not attempt fixes; it's an environment/registry concern, not the relocation).

- [ ] **Step 2: Build a representative project**

Run: `npx nx show projects` then build the football lib, e.g. `npx nx build pack-football`
Expected: build succeeds. (If `pack-football` isn't a buildable target name, use the exact name from `nx show projects`.)

## Task 4: Add the domain CLAUDE.md (via PR)

- [ ] **Step 1: Branch**

Run (from `domains/exercir/`): `git checkout -b docs/add-cluster-claude-md`

- [ ] **Step 2: Write `CLAUDE.md`**

Path: `D:/development/projects/de-braighter/domains/exercir/CLAUDE.md`. Exact content:
```markdown
# CLAUDE.md — exercir (team-sports domain)

The Exercir product: a team-sports coaching + club-management platform built on the de Braighter substrate. The only confirmed product domain (status: product). Substrate-v1 architecture — packs consume the typed kernel.

## Position in the cluster

This repo clones into `de-braighter/domains/exercir/`. Claude Code is launched from the cluster root (`de-braighter/`), not from here. Agents and skills come from the cluster root's `.claude/`.

## Packs

| Pack | Purpose |
|---|---|
| `libs/pack-football` | Football domain logic — use cases, repositories, inference wiring (substrate consumer) |
| `libs/pack-football-ui` | Angular UI for the football visual editor (coach UI on the pack-football HTTP surface) |
| `libs/pack-club-mgmt` | Sport-agnostic Verein admin surfaces (theme, rosters, rights matrix, scheduling) — shared across every club |
| `libs/pack-kids-sports` | Tier-1 youth sport-cluster pack (~U6–U12), categorical effects, no NumPyro fast-path |
| `apps/pack-football-api` | NestJS HTTP boundary onto pack-football use cases |
| `apps/pack-football-visual-editor` | Visual-editor app |

## Dependencies (one-way, inward)

Consumes the cluster's layers:
- `@braighter-io/substrate-contracts` + `@braighter-io/substrate-runtime` (kernel) — see `layers/substrate/`
- `@braighter-io/design-system-*` (UI) — see `layers/design-system/`

Note: the `@braighter-io/*` scope migrates to `@de-braighter/*` in a coordinated change (lockstep across substrate + design-system + this repo). Until then, keep `@braighter-io/*`.

## Editing rules

- **PR-gated** per the workbench `policies/git.md`. Full verifier wave (`local-ci` build+test, `reviewer`, `charter-checker`, `qa-engineer`) on non-trivial PRs.
- **Substrate hygiene** — packs map domain content onto the kernel vocabulary; don't add domain-specific extensions to the kernel itself (that lives in `layers/substrate/`).
- **Recurse the plan, flat the observation** — plan-side primitives recurse; observation-side stays flat (FHIR R5 shape).
- **Browser smoke-test UI work** — type-checks aren't enough for the visual editor / UI packs; verify in a browser.

## Heritage

This repo is the substrate-v1-aligned exercir codebase (formerly `packs-workspace`). The legacy `exercir-service` monolith (medical + football packs) is being archived separately; its team-sports work is cherry-picked forward where still relevant.

## What NOT to do

- Don't reintroduce the medical packs (oncology/physio/mental-health/care) — Exercir is team-sports only now.
- Don't switch the `@braighter-io` scope ad-hoc — it's a coordinated change.
- Don't market the substrate externally — internal framing only.
```

- [ ] **Step 3: Commit + push + PR**

Run (from `domains/exercir/`):
```
git add CLAUDE.md
git commit -m "docs: add cluster CLAUDE.md for exercir domain"
git push -u origin docs/add-cluster-claude-md
gh pr create --repo braighter-io/exercir --base main --head docs/add-cluster-claude-md --title "Add cluster CLAUDE.md for exercir domain" --body "Adds the domain CLAUDE.md describing exercir's position in the de-braighter cluster, its packs (football/football-ui/club-mgmt/kids-sports + apps), inward dependency on the substrate + design-system layers, editing rules, and heritage (substrate-v1 codebase, formerly packs-workspace). Doc-only. Per the 2026-05-25 exercir-domain-core-migration plan."
```
Expected: PR URL.

## Task 5: Verifier wave + merge

**Controller actions.**

- [ ] **Step 1:** Doc-only PR. `md-quality-review` on the CLAUDE.md; `local-ci` build confirms health (already verified in Task 3).
- [ ] **Step 2:** Merge (confirm — visible): `gh pr merge --repo braighter-io/exercir --merge --delete-branch`
- [ ] **Step 3:** Sync: `git checkout main && git pull origin main` (from `domains/exercir/`)
- [ ] **Step 4:** Verify: `gh repo view braighter-io/exercir --json name,defaultBranchRef`; `test -f CLAUDE.md`; `ls libs/ apps/`.

---

## Self-Review checklist

- [ ] Repo renamed `packs-workspace` → `exercir`.
- [ ] Cloned from `main` into `domains/exercir/`; stale checkouts not used.
- [ ] 4 libs + 2 apps present; consumes `@braighter-io/substrate-*`.
- [ ] Build passes (or BLOCKED reported for a registry/auth reason, not a relocation reason).
- [ ] CLAUDE.md added via PR + merged.
- [ ] Workbench gitignores the clone (`domains/*`).

## What's next

1. **attic + exercir-service teardown** — create `braighter-io/attic`, move exercir-service's medical packs there, archive the exercir-service monolith.
2. **cherry-pick forward** — confirm exercir-service's unique recent team-sports work (e.g. #1332 drill-board) is in this repo's `pack-football-visual-editor`; port if missing.
3. **scope switch** — coordinated `@braighter-io/*` → `@de-braighter/*` across substrate + design-system + exercir.
4. **conservation** domain; **form-controls** extraction; **kanban** → GitHub Issues.
5. **cleanup** — fabricir teardown, stale local checkouts (both packs-workspace clones, exercir-workbench, workbench-next), `enterprise/docs/docker.md` → platform, MEMORY.md sweep.
