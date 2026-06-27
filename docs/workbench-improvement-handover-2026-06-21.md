# Workbench Improvement Handover

This handover is for Claude or another architecture/product agent continuing the
conversation about how to improve the `de-braighter/workbench`.

The previous user question was: "How could we improve our workbench?" The answer
framed the workbench as a governance and Foundry control room, then proposed a
small set of improvements that make it more self-checking, more operational, and
less dependent on session memory.

## Current Context

The workbench at `D:/development/projects/de-braighter/` is both:

- The `de-braighter/workbench` repository: canonical agents, skills, policies,
  templates, workflows, project descriptors, and design docs.
- The cluster root: sibling layer, domain, and attic repositories live under
  `layers/`, `domains/`, and `attic/`.

Claude should always be launched from the workbench root. Do not launch from
inside sibling repositories, because the canonical agent and skill context lives
at the root.

Important references:

- `AGENTS.md`
- `CLAUDE.md`
- `repos.yaml`
- `policies/git.md`
- `workflows/verifier-wave.md`
- `docs/compare-workbenches-analysis.md`
- `docs/foundry/`
- `docs/superpowers/specs/`

## Core Diagnosis

The workbench is already strong as a single-source control plane for:

- Cluster topology
- Agent and skill governance
- ADR and policy discipline
- Foundry execution workflows
- SDLC twin rituals
- Substrate kernel minimality governance

The next improvement should not add more process prose. The best next step is to
turn existing conventions into operational checks and entry points that reduce
session-start friction and prevent drift.

The workbench should become less of a handbook and more of a self-checking
operating room.

## Highest-Value Improvement Themes

### 1. Workbench Health Dashboard

Create a local "workbench doctor" or dashboard that summarizes cluster health.

It should answer:

- Does `repos.yaml` match the actual sibling repositories on disk?
- Which sibling repositories are dirty?
- Which sibling repositories are on non-main branches?
- Which branches are stale against `origin/main`?
- Which Foundry gates or claims are active?
- Which devloop rituals are owed?
- Which PRs are open across the cluster?
- Are canonical skills, agents, policies, and workflows present?

This is probably the highest immediate ergonomics win because it replaces repeated
manual "where are we?" exploration at the start of each session.

### 2. Manifest Drift Elimination

Make `repos.yaml` a hard source of truth for the cluster. Add a local check that
compares the manifest with the filesystem.

The check should fail when:

- A listed repository is missing on disk.
- A sibling repository exists on disk but is missing from `repos.yaml`.
- A repository is under the wrong top-level group.
- Required metadata such as role, package scope, or repo URL is missing.

This should start as a local script/check, then later become part of local CI.

### 3. Start-of-Session Command

Add a single command for Claude/operator orientation, for example:

```text
workbench wake
```

or:

```text
npm run workbench:wake
```

The command should print a concise operational briefing:

- Current workbench branch and dirty status
- Sibling repo branch and dirty summary
- Top Foundry next item
- Pending founder gates
- Active or stale claims
- Owed devloop rituals
- Any branch-slip or worktree risks

This does not need to implement automation at first. A deterministic read-only
briefing would already be useful.

### 4. Mechanized Governance Before LLM Governance

Keep the LLM charter-checker for semantic architecture questions. Move every
mechanizable rule into cheap deterministic checks.

Candidate deterministic checks:

- ADR frontmatter shape
- PR body contains `Producer:` and `Effort:`
- Optional `Effect:` lines are well-formed
- No forbidden relative imports across pack/package boundaries
- No direct kernel expansion without ADR-176 inclusion-test evidence
- No workbench direct-to-main workflow drift
- No stale generated docs if the source fragments changed

The principle: if a rule can be grepped, parsed, or schema-validated, do that
before spending an LLM review pass.

### 5. PR Body Composer

Build a PR body generator for de-braighter conventions.

It should produce:

- `Producer:` line
- `Effort:` line
- Optional defensible `Effect:` suggestions
- Verification checklist
- Verifier wave summary placeholder
- Devloop ritual reminder
- Links to relevant ADRs or design docs

This lowers the cost of feeding the SDLC twin and reduces malformed PR metadata.

### 6. Version Matrix and Auto-Bump Loop

Add a version matrix for `@de-braighter/*` packages and their consumers.

The matrix should show:

- Published package version
- Consumer package range
- Whether the consumer is current, compatible, stale, or blocked
- Suggested bump PRs

This is the main structural fix for published-package skew between layers and
domains.

### 7. Foundry Mission Control Entry Point

Foundry already has observability and workflow machinery. The workbench should
make it more prominent as an operator entry point.

Mission Control should show:

- Next claimable items
- Active products
- Per-product workflow state
- Pending founder gates
- Active and stale claims
- Wake schedule/frontier state
- Review and merge status
- Deferred rituals

This should answer "what should the agent do next?" rather than only "what
happened?"

## Recommended First Slice

Start with a read-only `workbench doctor` design and implementation.

Suggested scope:

- Workbench repository only for the first design doc.
- Script may inspect sibling repositories, but should not mutate them.
- No Foundry kernel or substrate kernel changes.
- No branch switching.
- No network requirement in the first slice unless explicitly added later.

Suggested first output:

```text
Workbench Doctor

Workbench:
  branch: main
  dirty: no

Manifest:
  repos.yaml: ok
  missing on disk: none
  unlisted on disk: domains/herdbook

Sibling Repos:
  layers/substrate: main, clean
  domains/foundry: feature/foo, dirty

Foundry:
  next item: ...
  active claims: ...
  pending gates: ...

Rituals:
  owed devloop drains: ...
```

The first slice should be boring, read-only, and immediately useful.

## Key Design Questions for Claude

Claude should resolve these before proposing implementation:

- Is the first improvement aimed primarily at operator ergonomics or Foundry
  autonomy?
- Should the first artifact be a design doc only, or a design doc plus a small
  read-only script?
- Should `workbench doctor` live in the workbench repo, or should executable code
  live in a sibling domain/layer because the workbench repo is mostly declarative?
- Should `repos.yaml` become the only manifest, or should derived views be
  generated elsewhere?
- Which checks are safe to run without network access?
- Which checks may call `gh`, npm registries, or Foundry MCP tools?

## Architecture Guardrails

- Do not add substrate kernel concepts for this. The workbench improvement is
  control-plane and tooling work.
- Keep the first slice read-only unless the user explicitly asks for mutation.
- Do not bypass PR rules.
- Do not use `git add -A` in the workbench; there are often unrelated untracked
  artifacts.
- Do not switch branches in sibling repositories casually. Inspect first.
- Prefer deterministic checks over LLM-only reviews for mechanizable rules.
- Preserve the workbench as the single launch point.
- Keep executable implementation out of the workbench repo if current policy
  interpretation says code belongs in sibling repos. If in doubt, propose the
  placement decision explicitly.

## Suggested Next Prompt for Claude

Use this prompt in a fresh Claude session:

```text
We want to improve the de-braighter workbench. Read
docs/workbench-improvement-handover-2026-06-21.md, AGENTS.md, CLAUDE.md,
repos.yaml, and docs/compare-workbenches-analysis.md.

Propose the first thin slice for a read-only Workbench Doctor: what it should
check, where it should live, what it should not do, and how we verify it. Keep
the design conservative and aligned with the workbench rule that this repo is
mostly declarative content while code lives in sibling repos.
```

## Success Criteria

The next pass is successful if it produces a concrete, slice-sized design that:

- Reduces start-of-session orientation cost.
- Detects at least one real class of drift.
- Is read-only by default.
- Respects the workbench/sibling repo boundary.
- Can be verified locally without relying on remote CI.
- Does not expand the substrate kernel or Foundry product model.
