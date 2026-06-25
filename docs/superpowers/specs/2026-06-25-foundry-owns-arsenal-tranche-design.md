---
title: Foundry owns the arsenal — catalog + linkage (Unified Cockpit D5.4)
status: proposed
date: 2026-06-25
scope: design-global
product: system-builder-studio
builds-on:
  - docs/superpowers/specs/2026-06-25-foundry-owns-workflows-tranche-design.md  # D5.3 (prose tranches)
  - docs/superpowers/specs/2026-06-24-unified-cockpit-masterplan.md   # layer-4 "arsenal as actuators"
  - ADR-263   # the foundry ACTION_REGISTRY (kind -> handler)
  - ADR-242   # store generators, derive graphs
arc: substrate self-application — the foundry owns the workbench's governance corpus
---

# Foundry owns the arsenal — catalog + linkage

> The prose tranches (D5/D5.2/D5.3) made `policies/` + `workflows/` foundry-**generated**. The arsenal —
> the ~48 `.claude/skills/` + 23 `.claude/agents/` — is **code/prompts, not prose to generate**. Per the
> masterplan it is **layer-4: actuators the governance nodes invoke, NOT tree nodes.** So the foundry
> "owns" it by **cataloging** it as a first-class actuator registry the governance corpus references and
> the foundry validates — never by generating skill/agent files.

## 1. Scope

- **Breadth:** all skills + agents under `.claude/` (~48 + 23 ≈ 71 actuators), cataloged in one derived
  pass (cataloging is a cheap scan, not per-artifact work).
- **Deliverable (founder-chosen): catalog + linkage.** (a) a derived actuator catalog; (b) governance
  nodes carry a typed `actuators[]` reference validated against the catalog (drift-detecting); (c) the
  cockpit surfaces the catalog + linkages + drift. Usage-observation/calibration is a **later** slice.
- **No file generation, no founder gate.** We do not rewrite/own the skill/agent `.md` files — they stay
  authored prompts. So T3 has **no founder-gated capstone** (unlike D5.2/D5.3).

## 2. Architecture (zero kernel change)

Lives in `domains/foundry/src/arsenal/` + a Studio cockpit surface.

- **`ArsenalActuator = { id: string; kind: 'skill' | 'agent'; description: string; model?: string;
  tools?: string[] }`** — a descriptor parsed from frontmatter (`name` → `id`; agents add `model` +
  `tools`).
- **`deriveArsenalCatalog(sources: ArsenalActuator[]): ReadonlyMap<string, ArsenalActuator>`** — a PURE
  fold (dedup by id, stable order); `store generators, derive graphs` (ADR-242). The catalog is a derived
  view, never stored.
- **`scanArsenal(claudeDir): ArsenalActuator[]`** — the thin I/O edge: reads `.claude/skills/*/SKILL.md`
  + `.claude/agents/*.md`, parses YAML frontmatter (`name`, `description`, `model`, `tools`). Resolves
  the cluster `.claude/` via a configured path (the foundry sits at `domains/foundry`; the cluster root's
  `.claude/` is `../../.claude` — passed in, not hard-coded). Tests run the *pure fold* over fixtures;
  one snapshot test runs `scanArsenal` over the real `.claude/` (asserts ≈71 entries, the known names).
- **Linkage (metadata only):** governance nodes gain an optional `metadata.actuators: string[]` (actuator
  ids the node invokes). **This is metadata, NOT part of the generated fragment** (the fragment is
  `authoredContent.body`), so adding it changes NO owned region — the policy/workflow files stay
  byte-identical. **`validateActuatorRefs(tree, catalog): { dangling: {nodeKey, actuatorId}[]; orphans:
  actuatorId[] }`** — a derived check: `dangling` = a node references an actuator not in the catalog
  (drift: a renamed/deleted skill); `orphans` = cataloged actuators referenced by no governance node
  (informational coverage signal). Seed `actuators[]` on the existing nodes — e.g. the `verifier-wave`
  workflow node → `[local-ci, reviewer, charter-checker, qa-engineer]`; the `review-floor` guardrail →
  `[code-review, reviewer, charter-checker, qa-engineer, local-ci]`.

**Relation to the `ACTION_REGISTRY` (keep distinct):** the foundry `ACTION_REGISTRY` (ADR-263) is
`kind → handler` — how a *workflow* node actuates a foundry op (`dispatch-review` etc.). The **arsenal**
is the SDLC *tools* (skills/agents the process runs). A node may carry both an `action` (foundry
actuation) and `actuators[]` (the arsenal tools it describes). T3 adds the arsenal catalog + the
`actuators[]` linkage; it does NOT touch the `ACTION_REGISTRY`.

## 3. Build items (the `/build-path`)

- **A1 (foundry)** — `src/arsenal/`: the `ArsenalActuator` type + `deriveArsenalCatalog` pure fold +
  `scanArsenal` I/O edge; fixtures + a real-`.claude/` snapshot test; the `actuators[]` governance-node
  metadata + `validateActuatorRefs` (dangling + orphans) + seed the existing nodes' linkages; a foundry
  MCP/CLI read surface for the catalog (mirror `foundry_compile_blueprint`'s exposure if cheap, else a
  pure exported fn). Genericity acid: the fold handles skills + agents uniformly; a new actuator appears
  with zero code change. Zero kernel change.
- **A2 (studio)** — the cockpit "Arsenal" surface: list the catalog (skill/agent rows, kind chips,
  description), the linkages (which node invokes which actuators), and a **drift indicator** (dangling
  refs / orphan actuators). Reuses the `/governance` cockpit conventions; browser-verify (token trap).

**Dependencies:** A2 depends on A1 (consumes the catalog + linkage shape). Scope-disjoint: A1
`domains/foundry/src/arsenal` + `src/governance` (the `actuators[]` seed), A2 `domains/studio/.../governance`.

## 4. Boundaries

- **No generation / no file rewrite → no founder gate.** The arsenal `.md` files are untouched; the
  catalog + validation are derived views.
- **Derived, never stored** (ADR-242) — the catalog + the validation result are pure functions over the
  scanned frontmatter + the plan tree.
- **The scan is the I/O edge; the fold is pure.** Cross-repo path (`.claude/`) is configured/passed, not
  hard-coded; tests use fixtures + one real-`.claude/` snapshot.
- **`actuators[]` is metadata** — adding it changes no generated owned region (the D5.2/D5.3 policy +
  workflow fixtures + files stay byte-identical; regression-guarded).
- **Zero kernel change** (pack code + `metadata`; ADR-176 pack-level).

## 5. Testing / acid

- **Catalog genericity:** `deriveArsenalCatalog` folds skills + agents uniformly; a fixture with a new
  actuator id appears in the catalog with no code change; dedup-by-id is pinned.
- **Linkage drift (the falsifier):** `validateActuatorRefs` flags a node referencing a missing actuator
  (dangling) and a cataloged actuator referenced by no node (orphan); a mutation dropping the dangling
  check is RED.
- **Real-`.claude/` snapshot:** `scanArsenal` over the live `.claude/` yields the known ~71 actuators
  (e.g. `reviewer`, `charter-checker`, `code-review`, `build-path` present).
- **Non-regression:** the D5/D5.2/D5.3 fixtures + owned files stay byte-identical (`actuators[]` is
  metadata, not generated content).

## 6. Execution

Foundry-conducted; orchestrator hand-conducts (workers as subagents, read return-values, drive merges).
A1 + A2 both auto-merge on green waves (no founder gate). Workers read the MERGED governance engine code.

## 7. Later (named)

- **Usage-observation / calibration:** observe which actuators actually fire (foundry/twin log) → "which
  skills/agents are used vs dead weight"; needs a real firing signal wired.
- **T4 — `CLAUDE.md`:** the root orchestration file (whole-file or per-section ownership; highest blast
  radius) — the last prose tranche.
