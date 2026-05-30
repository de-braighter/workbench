# Substrate Layer Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Establish the substrate kernel as `de-braighter/layers/substrate/` by reclaiming the `braighter-io/substrate` repo name and cloning it into the cluster, then adding a layer CLAUDE.md. Keep the existing `@braighter-io/substrate-{contracts,runtime}` packages unchanged.

**Architecture:** The kernel already lives in a clean published repo (`braighter-io/substrate-core`, renamed from `substrate`). This is the simplest layer migration: reclaim the `substrate` name via rename, clone fresh (which excludes the discarded untracked `substrate-inference-port/` experiment), add a CLAUDE.md via PR. No code changes, no scope change, no merges.

**Tech Stack:** git, gh CLI, Nx, TypeScript. The repo is an Nx workspace publishing two npm packages to GitHub Packages.

**Decisions (from this session):**
- Discard the untracked `substrate-inference-port/` (stale experiment). A fresh clone from origin excludes it automatically.
- Keep `@braighter-io/substrate-contracts` (0.3.0) + `@braighter-io/substrate-runtime` (0.4.0) scope as-is. The `@de-braighter` scope switch is deferred to the exercir domain plan (coordinated so packs-workspace doesn't break).
- Reclaim `braighter-io/substrate` (rename `substrate-core` → `substrate`).
- Conservation's `@substrate-continuum/contracts` fork is out of scope — handled in the conservation domain plan.

**Out of scope:**
- `@de-braighter` scope migration (exercir plan)
- Conservation fork reconciliation (conservation plan)
- Any kernel code changes (this is pure infrastructure relocation)
- The inference-port divergent work (discarded)

---

## Pre-flight

- [ ] **Confirm the canonical repo + clean clone target**

Run:
```
gh repo view braighter-io/substrate-core --json name,defaultBranchRef,visibility
git -C "D:/development/projects/braighter/substrate_wb/substrate" rev-list --left-right --count origin/main...main
ls D:/development/projects/de-braighter/layers/substrate 2>&1 | head -1
```
Expected: `substrate-core` exists, default branch `main`; `0  0` (local clone in sync with origin — the only "dirty" item is the untracked inference-port we're discarding); `layers/substrate` does not exist yet.

---

## Task 1: Reclaim the `substrate` repo name

**Visible-to-others action** — controller confirms before running.

- [ ] **Step 1: Rename on GitHub**

Run: `gh repo rename substrate --repo braighter-io/substrate-core --yes`
Expected: renamed to `braighter-io/substrate`. The old `substrate-core` URL auto-redirects.

- [ ] **Step 2: Verify**

Run: `gh repo view braighter-io/substrate --json name,defaultBranchRef`
Expected: `name: "substrate"`, `defaultBranchRef.name: "main"`.

## Task 2: Clone into the cluster

- [ ] **Step 1: Clone**

Run (from `D:/development/projects/de-braighter/`):
```
git clone git@github.com:braighter-io/substrate.git layers/substrate
```
Expected: clones into `layers/substrate/`. Because it clones from origin, the untracked `substrate-inference-port/` experiment is NOT present (it only ever existed in the old working copy).

- [ ] **Step 2: Verify it's the kernel, and the stale experiment is absent**

Run:
```
cd D:/development/projects/de-braighter/layers/substrate
ls libs/                                  # expect: substrate-contracts substrate-runtime
test -e substrate-inference-port && echo "PRESENT (BAD)" || echo "absent (good)"
grep '"name"' libs/substrate-contracts/package.json | head -1   # expect @braighter-io/substrate-contracts
grep '"name"' libs/substrate-runtime/package.json | head -1     # expect @braighter-io/substrate-runtime
git rev-list --count HEAD                 # expect 14
```
Expected: two libs present; inference-port absent; package names confirm `@braighter-io/substrate-*`; ~14 commits.

- [ ] **Step 3: Confirm the workbench gitignores the clone**

Run (from `D:/development/projects/de-braighter/`): `git status --porcelain | grep -c "layers/substrate"`
Expected: `0`.

## Task 3: Verify the build

The kernel is code — confirm it still builds after the relocation (it should, since nothing changed).

- [ ] **Step 1: Install + build contracts**

Run (from `layers/substrate/`):
```
npm install
npx nx build substrate-contracts
```
Expected: build succeeds, emits `dist/libs/substrate-contracts/`. If `npm install` or the build fails, report BLOCKED with the error — do NOT attempt fixes (this is a relocation, not a code-change task; a build failure means something about the environment, not the migration).

- [ ] **Step 2: Build runtime**

Run: `npx nx build substrate-runtime`
Expected: build succeeds.

## Task 4: Add the layer CLAUDE.md (via PR)

The substrate repo predates the cluster, so it needs a CLAUDE.md describing its position. PR-gated per `policies/git.md`.

- [ ] **Step 1: Create a branch**

Run (from `layers/substrate/`): `git checkout -b docs/add-cluster-claude-md`

- [ ] **Step 2: Write `CLAUDE.md`**

Path: `D:/development/projects/de-braighter/layers/substrate/CLAUDE.md`. Exact content:
```markdown
# CLAUDE.md — substrate (kernel layer)

The typed platform kernel for the de Braighter ecosystem. Owns the substrate primitives, the inference backbone port, the pack runtime, and the reproducibility contract.

## Position in the cluster

This repo clones into `de-braighter/layers/substrate/`. Claude Code is launched from the cluster root (`de-braighter/`), not from here. Agents and skills come from the cluster root's `.claude/`.

## What ships from here

| Package | Contents | Consumers |
|---|---|---|
| `@braighter-io/substrate-contracts` | Typed primitives (Subject/Indicator/Intervention/Observation/Plan), Zod schemas, hex out-port interfaces (incl. the inference backbone port). Zero runtime deps beyond Zod. | `domains/*` packs, eyecatchers, external integrators |
| `@braighter-io/substrate-runtime` | NestJS `SubstrateModule`, `ScopedPrismaService` (RLS), `PolicyEngine`, `PackRegistry`, `TenantPackContextGuard`, inference backbone impls. | `domains/*` pack apps |

Note: the package scope is `@braighter-io/*` for now. It migrates to `@de-braighter/*` in lockstep with the exercir domain (so consumers don't break). Until then, keep `@braighter-io`.

## Dependency direction

Substrate depends on nothing else in the cluster. Domains depend on substrate (one-way). Never import a domain or a design-system package from here.

## Editing rules

- **PR-gated** per the workbench `policies/git.md`. Verifier wave includes `local-ci` (real build + test) since this is code.
- **Substrate hygiene** — Layer-1 primitives stay domain-agnostic. No domain-specific extensions in the typed vocabulary.
- **Versioned contracts** — bump semver on every breaking change to a published package, even with one consumer.
- **Hide the PPL choice behind the inference port** — no direct PPL imports outside the runtime's inference impls.

## What NOT to do

- Don't add domain logic here. Domain content lives in `domains/*`.
- Don't switch the package scope ad-hoc — the `@de-braighter` move is a coordinated change with the exercir domain.
- Don't reintroduce the `substrate-inference-port/` experiment (discarded 2026-05-25 as stale).
```

- [ ] **Step 3: Commit**

Run (from `layers/substrate/`):
```
git add CLAUDE.md
git commit -m "docs: add cluster CLAUDE.md for substrate kernel layer"
```

- [ ] **Step 4: Push + PR**

Run:
```
git push -u origin docs/add-cluster-claude-md
gh pr create --repo braighter-io/substrate --base main --head docs/add-cluster-claude-md --title "Add cluster CLAUDE.md for substrate layer" --body "Adds the kernel-layer CLAUDE.md describing substrate's position in the de-braighter cluster, its published packages, and editing rules. Doc-only; no code change. Per the clean-structure design and the 2026-05-25 substrate-layer-migration plan."
```
Expected: PR URL printed.

## Task 5: Verifier wave + merge

**Controller actions.**

- [ ] **Step 1: Verifier wave** — this is a doc-only PR to a code repo. `local-ci` build is a no-op for the doc change but confirms the repo still builds; `md-quality-review` checks the CLAUDE.md. Dispatch both (controller).

- [ ] **Step 2: Merge** (confirm first — visible action): `gh pr merge --repo braighter-io/substrate --merge --delete-branch`

- [ ] **Step 3: Sync local main**:
```
cd D:/development/projects/de-braighter/layers/substrate
git checkout main && git pull origin main
```

- [ ] **Step 4: Final verification**:
```
gh repo view braighter-io/substrate --json name,defaultBranchRef
ls layers/substrate/   # (from cluster root) CLAUDE.md present, libs/ present
```
Expected: repo `substrate`, default `main`, CLAUDE.md on main.

---

## Self-Review checklist (controller, after execution)

- [ ] Repo renamed `substrate-core` → `substrate`.
- [ ] Cloned into `layers/substrate/`; the untracked inference-port experiment is absent.
- [ ] `@braighter-io/substrate-{contracts,runtime}` intact (scope unchanged).
- [ ] Both packages build.
- [ ] CLAUDE.md added via PR + merged.
- [ ] Workbench `.gitignore` keeps the clone untracked at cluster level.

## What's next

- design-system layer (also pulls `ui-design/` out of specs)
- platform layer (also pulls `enterprise/docs/docker.md` out of specs)
- exercir domain (here is where `@braighter-io/substrate-*` → `@de-braighter/*` happens, in lockstep with packs-workspace)
- attic, conservation, cleanup
