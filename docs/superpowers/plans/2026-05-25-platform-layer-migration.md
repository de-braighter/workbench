# Platform Layer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Establish the infrastructure layer as `de-braighter/layers/platform/` by reclaiming the `braighter-io/platform` name (rename of `exercir-platform`) and cloning it into the cluster, then refreshing its CLAUDE.md.

**Architecture:** `exercir-platform` (AWS CDK + terraform + k8s + observability) is a clean repo whose `main` already has all work (the local `feat/ops-infomaniak-k8s-deploy` branch is redundant — squash-merged via PR #1 as `72b5b87`; remote branch deleted). Simplest path: rename to reclaim `platform`, clone from `main`, refresh CLAUDE.md.

**Tech Stack:** AWS CDK (TypeScript), Terraform/OpenTofu, Kubernetes manifests (Kustomize overlays), observability config.

**Decisions (from this session's investigation):**
- Reclaim `braighter-io/platform` (rename `exercir-platform`).
- Clone from `origin/main` (the `feat/ops-infomaniak-k8s-deploy` branch is fully redundant — its tree equals main via squash `72b5b87`).
- The untracked `k8s/overlays/test/secrets.yaml` in the old checkout is NOT migrated (it's a local secret, never committed; cloning from main excludes it).
- `enterprise/docs/docker.md` (currently in `layers/specs/`) moves here in a future plan — not now.

**Out of scope:**
- Pulling `enterprise/docs/docker.md` from specs (future)
- `copilot-instructions.md` cleanup (cross-provider; the workbench is Claude-Code-optimized — flag, don't fix here)
- `workbench-next/docker/` consolidation (future; rides with fabricir teardown)
- Any infra code changes

---

## Pre-flight

- [ ] **Confirm repo + clone target**

Run:
```
gh repo view braighter-io/exercir-platform --json name,defaultBranchRef,visibility
ls D:/development/projects/de-braighter/layers/platform 2>&1 | head -1
```
Expected: `exercir-platform`, default `main`, PRIVATE; `layers/platform` does not exist yet.

---

## Task 1: Reclaim the `platform` repo name

**Visible-to-others action** — controller confirms before running.

- [ ] **Step 1: Rename**

Run: `gh repo rename platform --repo braighter-io/exercir-platform --yes`
Expected: renamed to `braighter-io/platform`; old URL auto-redirects.

- [ ] **Step 2: Verify**

Run: `gh repo view braighter-io/platform --json name,defaultBranchRef`
Expected: `name: "platform"`, default `main`.

## Task 2: Clone into the cluster (from main)

- [ ] **Step 1: Clone**

Run (from `D:/development/projects/de-braighter/`):
```
git clone git@github.com:braighter-io/platform.git layers/platform
```
Expected: clones `origin/main`. The redundant feat branch and the untracked secrets.yaml do not come along (clean main).

- [ ] **Step 2: Verify**

Run:
```
cd D:/development/projects/de-braighter/layers/platform
git branch --show-current        # main
ls -1                            # expect: AGENTS.md CLAUDE.md cdk copilot-instructions.md docs k8s launch.json observability terraform
test -e k8s/overlays/test/secrets.yaml && echo "SECRET PRESENT (BAD)" || echo "no secret (good)"
git rev-list --count HEAD
```
Expected: on main; infra dirs present; no secrets.yaml; ~13 commits (main had 12 + the squash; confirm count).

- [ ] **Step 3: Confirm secrets are gitignored (hygiene)**

Run: `grep -rn "secrets" .gitignore 2>/dev/null; grep -rn "overlays/test" .gitignore 2>/dev/null`
If `k8s/overlays/test/secrets.yaml` is NOT covered by .gitignore, note it as a follow-up (secrets should be ignored so they can't be committed). Do not fix in this plan unless trivial.

- [ ] **Step 4: Confirm workbench gitignores the clone**

Run (from `D:/development/projects/de-braighter/`): `git status --porcelain | grep -c "layers/platform"`
Expected: `0`.

## Task 3: Refresh the CLAUDE.md (via PR)

- [ ] **Step 1: Branch**

Run (from `layers/platform/`): `git checkout -b docs/refresh-cluster-claude-md`

- [ ] **Step 2: Overwrite `CLAUDE.md`**

Path: `D:/development/projects/de-braighter/layers/platform/CLAUDE.md`. Exact content:
```markdown
# CLAUDE.md — platform (infrastructure layer)

Infrastructure-as-code for the de Braighter ecosystem: AWS CDK, Terraform/OpenTofu, Kubernetes (Kustomize), and observability config. Swiss-first hosting (Infomaniak K8s).

## Position in the cluster

This repo clones into `de-braighter/layers/platform/`. Claude Code is launched from the cluster root (`de-braighter/`), not from here. Agents and skills come from the cluster root's `.claude/`.

## Layout

| Path | Purpose |
|---|---|
| `cdk/` | AWS CDK (TypeScript) stacks |
| `terraform/` | Terraform / OpenTofu modules |
| `k8s/` | Kubernetes manifests + Kustomize overlays (Infomaniak deploy) |
| `observability/` | Metrics / logging / tracing config |
| `docs/` | Infra runbooks + deploy notes |

## Editing rules

- **PR-gated** per the workbench `policies/git.md`.
- **Verify upstream provider schemas before writing IaC** — fetch the provider's `docs/resources/*.md` (Context7 / WebFetch) before writing Terraform/Helm/k8s attributes. Provider APIs decay fast; don't trust training-data recall. Use the `windows-devops-pro` agent for infra work.
- **Never commit secrets.** `k8s/overlays/*/secrets.yaml` and equivalents must be gitignored and provided out-of-band (External Secrets Operator / SOPS per the relevant ADRs). If you see a secret file tracked, stop and report.

## Dependency direction

Platform is leaf infrastructure — nothing in the cluster imports it as a package. It consumes the built artifacts of domains/layers at deploy time, not at build time.

## What NOT to do

- Don't put application code here.
- Don't bypass pre-push secret-scanner hooks.
- `copilot-instructions.md` is a legacy cross-provider artifact; the cluster is Claude-Code-optimized. It can be removed in a cleanup pass.
```

- [ ] **Step 3: Commit + push + PR**

Run (from `layers/platform/`):
```
git add CLAUDE.md
git commit -m "docs: refresh CLAUDE.md for platform cluster layer"
git push -u origin docs/refresh-cluster-claude-md
gh pr create --repo braighter-io/platform --base main --head docs/refresh-cluster-claude-md --title "Refresh CLAUDE.md for platform layer" --body "Refreshes the CLAUDE.md for the platform infra layer's position in the de-braighter cluster: layout, IaC editing rules (verify provider schemas, never commit secrets), dependency direction. Doc-only. Per the 2026-05-25 platform-layer-migration plan."
```
Expected: PR URL.

## Task 4: Merge

**Controller actions.**

- [ ] **Step 1:** `md-quality-review` on the CLAUDE.md (doc-only PR).
- [ ] **Step 2:** Merge (confirm — visible): `gh pr merge --repo braighter-io/platform --merge --delete-branch`
- [ ] **Step 3:** Sync: `git checkout main && git pull origin main` (from `layers/platform/`)
- [ ] **Step 4:** Verify: `gh repo view braighter-io/platform --json name,defaultBranchRef`; `test -f CLAUDE.md`.

---

## Self-Review checklist

- [ ] Repo renamed `exercir-platform` → `platform`.
- [ ] Cloned from `main`; no secrets.yaml, no redundant feat branch in the working tree.
- [ ] CLAUDE.md refreshed + merged.
- [ ] Workbench gitignores the clone.
- [ ] Secret-gitignore hygiene checked (follow-up filed if gap).

## What's next

- exercir domain (the `@braighter-io/substrate-*` → `@de-braighter/*` scope switch happens here, lockstep with packs-workspace)
- attic, form-controls, kanban-migration, conservation
- cleanup (incl. `enterprise/docs/docker.md` → platform, `copilot-instructions.md` removal, fabricir teardown)
