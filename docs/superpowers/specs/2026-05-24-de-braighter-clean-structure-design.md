---
title: "de Braighter — clean components + repo structure"
status: draft
created: 2026-05-24
last_updated: 2026-05-24
authors: [stibe]
domain: meta / infrastructure
---

# de Braighter — clean components + repo structure

## 1 — Why this exists

The de Braighter ecosystem has accumulated multiple prototype/POC artifacts across two parent directories (`D:/development/projects/braighter/` and `D:/development/projects/exercir/`). The artifacts include a hand-crafted multi-repo workbench (exercir-workbench), an over-engineered generic workbench with SPA+API (workbench-next / fabricir), several substrate-shaped projects with overlapping names, a multi-pack legacy NestJS+Angular application (exercir-service), several knowledge repos, and a business-concept repo.

This design defines a clean target structure that:

- folds the existing prototypes in (no greenfield throwaway);
- starts simple (~7 repos at day-1 minimum) but preserves doors open to north-star Phase 2/3 hypercomplexity (unbounded domains, external publishers);
- replaces the over-engineered fabricir workbench with a Claude-Code-native minimal workbench — declarative content only, no SPA, no API, no sync mechanism;
- narrows the product scope from the dropped "Exercir / Strategir / Operir" trinity to a single confirmed product (Exercir, team sports);
- carries through the substrate-as-internal-infrastructure posture (Option A from `north-star-vision-capture-2026-05-17.md` §19.5);
- establishes a naming strategy and a "domain" concept that unifies products and prototypes under one structural shape distinguished only by status metadata.

## 2 — Settled decisions from brainstorming

| Decision | Choice |
|---|---|
| Long-term landscape shape | Multi-layered (substrate stack) × multi-track (parallel domain experiments) |
| Migration posture | Fold existing prototypes into the new structure; nothing thrown away |
| Workbench scope | Discipline-content tier (agents + skills + slash commands + hooks + templates + policies + workflows + project descriptors). **No** UI, API, SPA, transformer. |
| Workbench operation model | **Cwd model** — `.claude/` only at the cluster root; Claude Code is always launched from there; no sync into sibling repos |
| Surviving tracks beyond Exercir | Substrate kernel (as a layer), conservation genetics, AI-Native Org Twin (deferred) |
| Trinity (Exercir / Strategir / Operir) | **Dropped.** Exercir is the only confirmed product, narrowed to team sports. |
| Naming convention | Free per item. **No `-ir` suffix requirement.** Each thing named for what it is. |
| Product / track unification | One concept: **`domain`**. Status field (`prototype` / `product` / `archived`) is metadata, not structure. |
| GitHub org | `braighter-io` (kept for now; future migration deferred) |
| Local cluster + npm scope | `de-braighter` / `@de-braighter` |
| Substrate package shape | `@de-braighter/substrate-contracts` + `@de-braighter/substrate-runtime` |
| Inference backbone (PPL substrate) | Nested in `substrate` for now; split if/when a separate release cadence emerges |
| Specs workflow | **PR-gated** like all other repos. Reverses the exercir agent-workflow §6.4 direct-to-main pattern. |
| Legacy exercir non-football packs | Move to a dedicated `attic/` preservation repo |
| `platform/` (IaC) | Own layer repo, alongside the others |

## 3 — Components inventory

### Layers (horizontal — each its own repo)

| Layer | GitHub repo | Local path | Role |
|---|---|---|---|
| workbench | `braighter-io/workbench` | `de-braighter/` (cluster root) | Canonical `.claude/agents`, `.claude/skills`, slash commands, hooks, templates, policies, workflows, project descriptors. Markdown + YAML + shell scripts. No app code. |
| substrate | `braighter-io/substrate` | `de-braighter/layers/substrate/` | Typed kernel — Subject/Indicator/Intervention/Observation/Plan, recursive PlanNode, algebraic effects, probabilistic semantics, registry contracts, inference port. Publishes `@de-braighter/substrate-contracts` + `@de-braighter/substrate-runtime`. Inference backbone (NumPyro sidecar interface) nested here for now. |
| design-system | `braighter-io/design-system` | `de-braighter/layers/design-system/` | Cross-platform UI: tokens, primitives (Badge/Btn/Card/etc), Reactive-Forms CVA widgets, eyecatchers (motion/viz). Today Angular impl; RN / native later. |
| specs | `braighter-io/specs` | `de-braighter/layers/specs/` | Knowledge base — ADRs, concept docs, handbook, business concept (ventures/financials), kanban. Markdown only. PR-gated. |
| platform | `braighter-io/platform` | `de-braighter/layers/platform/` | Infrastructure-as-code, CI/CD configs, Docker, deployment scripts. |

### Domains (vertical — each its own repo)

| Domain | GitHub repo | Local path | Subject | Status |
|---|---|---|---|---|
| exercir | `braighter-io/exercir` | `de-braighter/domains/exercir/` | Team sports (football today; potential other team sports) | **product** |
| conservation | `braighter-io/conservation` | `de-braighter/domains/conservation/` | Conservation genetics, biodiversity resilience | prototype |
| org-twin | `braighter-io/org-twin` | `de-braighter/domains/org-twin/` | AI-native organizational twin for software teams (dossier wedge) | prototype (deferred — not scaffolded until activated) |

Working domain names are placeholders for `conservation`, `org-twin`. Each may be renamed at scaffolding time. `exercir` is established and kept.

### Preservation

| Item | GitHub repo | Local path | Role |
|---|---|---|---|
| attic | `braighter-io/attic` | `de-braighter/attic/` | Frozen-but-preserved code that's out of scope. Initial contents: the four non-football packs from legacy exercir-service (oncology, physio, mental-health, care/Pflege) with their ~1100+ tests intact. No active maintenance. |

## 4 — Topology — the cwd model

```
de-braighter/                            ← cluster root + workbench repo (clone of braighter-io/workbench)
├── .claude/                             ← THE ONLY .claude/ in the tree
│   ├── agents/<id>.md                   ← carried forward from fabricir's 22 (curated)
│   ├── skills/<id>/                     ← carried forward from workbench-next/.agents/skills/ (39)
│   ├── commands/                        ← slash commands
│   └── settings.json                    ← base hooks, permissions
├── CLAUDE.md                            ← root claude-code instructions
├── README.md
├── templates/                           ← adr/, concept/, story/, pr/, sprint/
├── policies/                            ← coding.md, testing.md, git.md (PR-everywhere), docs.md, voice.md
├── workflows/                           ← verifier-wave.md, designer-first.md, story-tracker.md, …
├── projects/                            ← <key>/project.yaml — metadata only, not enforcement
├── docs/
│   └── superpowers/specs/               ← design docs (this file lives here)
│
├── layers/                              ← cluster dir, .gitignored at workbench level
│   ├── substrate/                       ← own git, clone of braighter-io/substrate
│   ├── design-system/                   ← own git, clone of braighter-io/design-system
│   ├── specs/                           ← own git, clone of braighter-io/specs
│   └── platform/                        ← own git, clone of braighter-io/platform
│
├── domains/                             ← cluster dir, .gitignored at workbench level
│   ├── exercir/                         ← own git, clone of braighter-io/exercir
│   ├── conservation/                    ← own git (scaffold when active)
│   └── org-twin/                        ← own git (scaffold when wedge fires)
│
└── attic/                               ← own git, clone of braighter-io/attic
```

### Key properties

- **Single `.claude/`** at the cluster root. Claude Code is always launched from `de-braighter/`. All agents and skills are visible to every task regardless of which sibling code you're editing.
- **Cluster subdirs are `.gitignored`** at the workbench level. Each layer/domain/attic is its own git repo with its own remote.
- **One-way dependency direction**:
  ```
  domains/* ──depends on──>  @de-braighter/substrate-contracts
                              @de-braighter/substrate-runtime
                              @de-braighter/design-system
                              (cite specs/ via URL; no package dep)
                              (no .claude/ — uses the root's)
  ```
- **No sync mechanism.** No `scripts/sync-*.sh`. Editing `.claude/agents/<id>.md` at the root immediately applies to all work, no propagation step.

### Project descriptor (metadata only)

```yaml
# de-braighter/projects/exercir/project.yaml
name: exercir
domain: team-sports
status: product            # prototype | product | archived
repo: github.com/braighter-io/exercir
local: domains/exercir/

# Hints for orchestrator judgment, not enforcement:
enabled:
  agents:
    suggested: [designer, implementer, reviewer, charter-checker, qa-engineer,
                local-ci, ui-pro, test-pro, prisma-pro, swiss-pro]
  skills:
    suggested: [architecture-concierge, diff-refactor-engine, story-runner,
                md-quality-review]
```

The `enabled.agents.suggested` and `enabled.skills.suggested` lists are *hints* the orchestrator can read to inform agent selection — they don't gate availability. All agents and skills are always available; the orchestrator picks per task.

## 5 — Day-1 counts

| Category | Day-1 minimum | Day-1 if all known prototypes scaffolded | Full hypercomplex |
|---|---:|---:|---:|
| Layer repos | 5 (workbench, substrate, design-system, specs, platform) | 5 | 5–6 (+ inference if split) |
| Preservation | 1 (attic) | 1 | 1 |
| Domain repos | 1 (exercir) | 2 (exercir + conservation) | unbounded |
| Deferred (not scaffolded) | 1 (org-twin) | 1 | n/a |
| **Total day-1** | **7** | **8** | unbounded |

Recommendation: scaffold the 5 layers + attic + exercir at day-1 (7 repos). Migrate conservation when active work next happens on it. Skip org-twin entirely until the dossier wedge fires.

## 6 — Naming strategy

| Concern | Choice | Rationale |
|---|---|---|
| GitHub org | `braighter-io` (kept) | Existing; future migration to a `de-braighter` org deferred. |
| Local cluster name | `de-braighter` | Matches the company name; clean to read in shell prompts. |
| npm scope | `@de-braighter` | Matches the company name; unifies all published packages under one scope. |
| Repo names | bare nouns | The GitHub org provides the namespace; no prefix needed. `workbench`, `substrate`, `design-system`, etc. |
| Substrate packages | `@de-braighter/substrate-contracts`, `@de-braighter/substrate-runtime` | Keeps the `substrate-` prefix inside the scope so packages read clearly even in isolation. |
| Domain names | freely chosen per domain | No suffix convention. `-ir` is dropped. Each domain gets the name that best matches its subject. `exercir` keeps its name because it's established. |
| Domain status values | `prototype` / `product` / `archived` | Metadata in `project.yaml`. |

### Names retired

- **`fabricir`** retires. Its identity carried the SPA/API connotation that's being explicitly removed. The new workbench is just `workbench`.
- **`exercir-workbench`** retires. The cluster pattern it pioneered survives; the name does not. Replaced by `de-braighter/` (the new cluster root).
- **`substrate-continuum`** retires (in its top-level conservation-genetics form). Conservation gets `conservation`.
- **`the-braighter-`** prefix retires. `the-braighter-specs` → `specs`; `the-braighter-business-concept` folds into `specs`.

## 7 — Migration map — every existing artifact's destination

### Existing artifacts under `D:/development/projects/braighter/`

| Existing path | Destination | Notes |
|---|---|---|
| `braighter-design-system/` | `layers/design-system/` (`braighter-io/design-system`) | Carry forward as-is. Eyecatchers, tokens, primitives. |
| `packs-workspace/` (substrate-v1 shape; pack-football) | merge into `domains/exercir/` | The substrate-shape *pattern* (how packs consume the kernel) moves to `layers/substrate/` as scaffold + docs. The concrete pack-football code moves into exercir as `domains/exercir/libs/pack-football/`. |
| `substrate-continuum/` (conservation genetics, top-level) | `domains/conservation/` (`braighter-io/conservation`) | Rename. The substrate innovations it pioneered (lineage DAG primitive, NumPyro sidecar interface) move into `layers/substrate/`; conservation consumes them. |
| `substrate_wb/substrate/` (substrate workbench libs + prisma + inference port) | `layers/substrate/` (`braighter-io/substrate`) | This is closest to what `substrate/` should be — absorb its libs and inference-port scaffolding. |
| `substrate_wb/` (parent, now empty) | delete | Once contents move, the parent dir is empty. |
| `the-braighter-specs/` | `layers/specs/` (`braighter-io/specs`) | Merge with exercir-specs and business-concept. |
| `the-braighter-business-concept/` | `layers/specs/business/` | Fold into specs as a subtree. |
| `CLAUDE.md` (current root) | `CLAUDE.md` (new cluster root) | Rewrite for the new structure. |
| `docs/superpowers/specs/` | `docs/superpowers/specs/` (same path; survives in workbench repo) | This document lives here. |
| Cleaned snapshot folders (none remaining as of 2026-05-24 cleanup) | — | Already gone. |

### Existing artifacts under `D:/development/projects/exercir/`

| Existing path | Destination | Notes |
|---|---|---|
| `exercir-workbench/` (multi-repo workbench shell) | dissolves | Role replaced by the new `de-braighter/` cluster root + the per-layer/per-domain repos. The cluster-folder pattern is preserved; the name is retired. |
| `exercir-workbench/.claude/agent-workflow.md` | `workbench/workflows/` (split into one markdown per workflow) | Carry forward content; restructure as separate workflow files (verifier-wave.md, designer-first.md, etc.). |
| `exercir-workbench/.claude/agents/` (21 synced agents) | `de-braighter/.claude/agents/` | Carry forward; curate. The full 22 (including `windows-devops-pro`) come from fabricir's canonical set. |
| `exercir-workbench/tools/` (briefs, devserver, hooks, prompts, scaffolders, story, validators) | `workbench/` (sorted by role) into `templates/`, `scripts/`, `workflows/` | Carry forward; reorganize by role rather than by tool name. |
| `exercir-workbench/services/exercir-service/` (NestJS API + Angular web + 5 packs) | `domains/exercir/` (`braighter-io/exercir`) — football only | **Team-sports narrowing applies.** Keep `libs/pack-football/` + its API/UI surface. Branch the four non-football packs off to attic (see below). |
| `exercir-workbench/services/exercir-service/libs/pack-oncology/` | `attic/pack-oncology/` | Real working code with tests; preserved frozen. |
| `exercir-workbench/services/exercir-service/libs/pack-physio/` | `attic/pack-physio/` | Same. |
| `exercir-workbench/services/exercir-service/libs/pack-mental-health/` | `attic/pack-mental-health/` | Same. |
| `exercir-workbench/services/exercir-service/libs/pack-care/` (Pflege) | `attic/pack-care/` | Same. |
| `exercir-workbench/services/packs-workspace/` | same destination as `braighter/packs-workspace/` (merge) | Same upstream repo, two checkouts; consolidate. |
| `exercir-workbench/specs/exercir-specs/` (113 concepts + 172 ADRs + handbook + kanban) | `layers/specs/` | Absorbed. The kanban migrates to GitHub issues per the story-tracker pattern. |
| `exercir-workbench/platform/exercir-platform/` | `layers/platform/` (`braighter-io/platform`) | Carry forward as the foundation of the new platform layer. |

### Existing artifacts under `D:/development/projects/exercir/workbench-next/` (fabricir)

| Existing path | Destination | Notes |
|---|---|---|
| `workbench-next/workbench/` (agents/, workflows/, policies/, mcp/, templates/, scripts/) | `de-braighter/` root (canonical) | The declarative content survives and becomes the workbench root. Some reorganization to fit the cwd-model layout. |
| `workbench-next/.agents/skills/` (39 skills) | `de-braighter/.claude/skills/` | Carry forward; curate. Skills are now at `.claude/skills/` per Claude Code's standard location. |
| `workbench-next/apps/fabricir-web/` (React 19 SPA) | **drop** | The over-engineered piece being removed. Not migrated. |
| `workbench-next/apps/fabricir-api/` (Node Express API) | **drop** | Same. |
| `workbench-next/packages/design-system/` (Angular UI primitives) | `layers/design-system/` | Merge with `braighter-design-system/`. |
| `workbench-next/packages/form-controls/` (Reactive-Forms CVA widgets) | `layers/design-system/` | Same — folds into the unified design-system. |
| `workbench-next/projects/exercir/project.yaml` | `de-braighter/projects/exercir/project.yaml` | Carry forward as the descriptor pattern. |
| `workbench-next/projects/fabricir/project.yaml` | **drop** | Self-referential descriptor for a thing that no longer exists. |
| `workbench-next/docker/` | `layers/platform/docker/` | Folds into the new platform layer. |
| `workbench-next/instructions/` (AI-instructions transformer for cross-provider) | **drop** | Out of scope per "Claude-Code-optimized" decision. |

## 8 — Workbench mechanics (cwd model)

### What the workbench is

A git repo (`braighter-io/workbench`) cloned into `D:/development/projects/de-braighter/` that holds:

- `.claude/` — the only Claude Code config in the cluster
- `templates/` — markdown templates (ADR, concept, story, PR, sprint)
- `policies/` — markdown policies (coding, testing, git, docs, voice)
- `workflows/` — markdown workflow definitions (verifier-wave, designer-first, story-tracker, etc.)
- `projects/` — `<key>/project.yaml` per domain (metadata only)
- `docs/` — design notes and superpowers/specs

No `apps/`, no `packages/`, no `scripts/sync-*.sh`.

### What the workbench is NOT

- Not a build target (nothing to `nx build`).
- Not a runtime service (no SPA, no API, no SSE).
- Not a sync hub (consumer repos don't pull from it; everything is right there at the root).
- Not a multi-tool harness (no instructions transformer for non-Claude tools).

### How code in sibling repos consumes workbench content

It doesn't — directly. Agents and skills are loaded by Claude Code from `de-braighter/.claude/` based on cwd. Sibling repos under `layers/*` and `domains/*` don't carry any Claude Code config themselves. When you `cd` to work on `domains/exercir/`, the agents and skills available are the ones rooted at `de-braighter/`.

Policies, templates, and workflows in `de-braighter/policies/`, `de-braighter/templates/`, `de-braighter/workflows/` are referenced via stable workbench-relative paths. Sibling repos can cite them in their own docs (e.g. `domains/exercir/CONTRIBUTING.md` can say "follow `policies/git.md`" with a relative link).

### When this model breaks (and the optionality preserved)

If you ever `cd domains/exercir && claude` (launch Claude Code inside a sibling instead of at the root), you lose `.claude/`. Solution: don't; always launch from `de-braighter/`.

When the Phase 2 trigger fires (first external pack publisher, per north-star doc §19.5), this model needs sync — external publishers don't have access to your local cluster root. At that point, add `scripts/sync-*.sh` that pushes the canonical content into per-repo `.claude/` directories. The topology survives; the workbench grows a new responsibility. No architectural rewrite needed.

## 9 — Doors-open properties (what scales without rewrite)

| Future growth | What changes | What doesn't |
|---|---|---|
| Add a new domain (e.g. activate org-twin) | New repo `braighter-io/<name>` cloned into `domains/<name>/`; new `projects/<name>/project.yaml`; entry in CLAUDE.md | Layers, workbench, attic |
| Add a new layer (e.g. observability or telemetry as its own concern) | New repo cloned into `layers/<name>/`; downstream domains add it as a dependency | Existing layers, all domains |
| Split inference out of substrate | New `braighter-io/inference` repo cloned into `layers/inference/`; substrate retires its inference code; domains update their dependency lists | Topology shape (just one more layer slot) |
| Promote a domain from prototype → product | Edit `project.yaml.status` from `prototype` to `product`. That's it. | Repo structure, code, anything else |
| External pack publishers (Phase 2 from north-star §19) | Add `scripts/sync-*.sh`; sibling repos start carrying `.claude/`; substrate's registry gains semver/signing | The cluster pattern, layer count, naming |
| Archive a domain | Edit `project.yaml.status` to `archived`; optionally move the repo to attic; no other changes | Everything else |

## 10 — Open items deferred to the implementation plan

These are decisions for the writing-plans phase, not blocking design approval:

1. **Day-1 scaffolding order.** Recommend: workbench → specs (so docs land somewhere) → substrate → design-system → platform → exercir → attic. Then conservation when next active.
2. **In-place rename vs new-repo creation.** Some existing GitHub repos can be renamed (`braighter-io/the-braighter-specs` → `braighter-io/specs`); others need new repos (workbench is new; the current exercir-workbench is a different shape). The plan decides per-repo.
3. **Content carry-over diffs.** Per-repo: what content moves verbatim, what gets restructured, what gets dropped. Mostly mechanical but per-repo specific.
4. **CLAUDE.md rewrite at the new cluster root.** Replaces the current `D:/development/projects/braighter/CLAUDE.md`. Will reflect the cwd model + the new structure.
5. **MEMORY.md sweep.** Several saved memories reference paths that change in the migration (e.g. `feedback-specs-pr-required` cites the exercir-workbench agent-workflow doc that's being retired). Plan updates the memory index after migration.
6. **Curation of the 22 agents and 39 skills.** Some may be dropped or merged. The plan decides per item.
7. **What's in `attic/`'s README.** It should be clear from a glance that this is preservation, not active code, and how to consult it without risk of confusion.
8. **Existing local checkouts cleanup.** After migration, `D:/development/projects/braighter/` and `D:/development/projects/exercir/exercir-workbench/` and `D:/development/projects/exercir/workbench-next/` are all redundant. The plan describes what to delete and when.

## 11 — Out of scope for this design

- Detailed substrate kernel architecture (lives in the `specs/` knowledge base, sourced from existing `north-star-vision-capture-2026-05-17.md` and the ratified concept docs).
- Per-pack design for pack-football or any other domain content.
- The decision between Option A (substrate emerges by observation through Exercir) vs Option C (open the substrate when external interest appears) — that's a strategic decision tracked separately; this design supports both.
- The dossier wedge (AI-Native Org Twin) detailed product design — this design only reserves the slot.
- Any UI work for the workbench itself — the design explicitly rejects UI for the workbench.

## 12 — Verification

This design is considered correct if, on day-1 minimum scaffolding (7 repos), the following all hold:

- A single Claude Code launch from `de-braighter/` exposes all canonical agents and skills.
- Editing `de-braighter/.claude/agents/designer.md` immediately changes the designer agent's behavior in any sibling-repo work; no sync step needed.
- A PR landed in `layers/specs/` requires the verifier wave to pass.
- A PR landed in `domains/exercir/` can depend on `@de-braighter/substrate-contracts` published from `layers/substrate/`.
- The four legacy non-football packs are restorable from `attic/` if ever needed.
- Adding a new domain (`domains/<new>/`) requires only: clone the new repo, write a `projects/<new>/project.yaml`, update CLAUDE.md. No layer changes.
