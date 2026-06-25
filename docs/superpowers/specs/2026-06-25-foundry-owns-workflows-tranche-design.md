---
title: Foundry owns the workflows — generalization tranche 2 (Unified Cockpit D5.3)
status: proposed
date: 2026-06-25
scope: design-global
product: system-builder-studio
builds-on:
  - docs/superpowers/specs/2026-06-25-foundry-owns-policies-tranche-design.md  # D5.2 (the proven shape)
  - docs/superpowers/specs/2026-06-24-foundry-owns-workbench-instructions-design.md  # D5 tracer
arc: substrate self-application — the foundry owns the workbench's governance corpus
---

# Foundry owns the workflows — generalization tranche 2

> D5.2 made all of `policies/` foundry-owned. This tranche extends the **same R3-generate ownership**
> to `workflows/` — `verifier-wave.md`, `designer-first.md`, `story-tracker.md` — the workbench's
> process descriptions. Identical whole-file shape to D5.2; the engine already supports it.

## 1. Scope

- **Breadth:** the 3 workflow files (`workflows/{verifier-wave,designer-first,story-tracker}.md`).
- **Granularity:** one governance node per file (whole-file region), as in D5.2.
- **Depth:** R3-generate ownership only (workflows are process prose with no per-PR firing signal).
- **Later tranches unchanged:** T3 the arsenal (skills/agents — *catalog as actuators*, different shape),
  T4 `CLAUDE.md` (last).

## 2. Architecture — one engine generalization + 3 nodes

The D5/D5.2 engine already handles any `governanceKind`, multi-file grouping, and body-only whole-file
fragments. Two minimal changes:

1. **Introduce `governanceKind: 'workflow'`** (alongside `'guardrail'`, `'policy'`). Workflow nodes carry
   `sourceArtifact: 'workflows/<name>.md'`, `authoredContent` = the file's verbatim body, no action/effects.
2. **Generalize the heading gate** from D5.2's narrow `headed: kind !== 'policy'` to **`headed: kind ===
   'guardrail'`** — i.e. only the section-style guardrail gets a `## <title>` heading; *every* whole-file
   kind (policy, workflow, and any future whole-file kind) is **body-only**, so each file keeps its own
   `# Title` h1 above the owned region. This is the correct, future-proof generalization of the G1.1 fix
   (foundry#47) — it decouples "headed" from a per-kind allowlist.

Everything else (the markdown `CompileTarget`, `governanceFragmentsByFile`, the cockpit list) is reused
unchanged. Zero kernel change (metadata + pack code; ADR-176 pack-level).

## 3. Build items (the `/build-path`)

- **W1 (foundry)** — add `'workflow'` to `GovernanceKind`; tighten the heading gate to `kind ===
  'guardrail'`; author the 3 workflow governance nodes (`authoredContent` = verbatim current bodies);
  per-file fixtures `__fixtures__/workflow-{verifier-wave,designer-first,story-tracker}.md` + drift
  tripwires; extend the genericity acid to 3 kinds (guardrail headed; policy + workflow body-only) in one
  multi-file pass. **Verify the D5 review-floor + D5.2 policy outputs stay byte-identical.**
- **W2 (workbench, FOUNDER-GATED)** — the capstone: sentinel-wrap each of the 3 workflow files body-only
  (content = verbatim body; `# Title` h1 untouched), each with the "edit via Studio, not this file" note.
  Purely additive (the D5.2 non-destructive proof).
- **W3 (studio)** — extend the `/governance` cockpit's owned-artifact list to include the 3 workflows
  (now 8 artifacts: review-floor + 4 policies + 3 workflows). The list machinery (G3) is generic; this is
  a fixture/snapshot extension. Browser-verify.

**Dependencies:** W2 + W3 depend on W1. W2/W3 are independent (different repos).

## 4. Boundaries

Same as D5.2: non-destructive (W2 changes no prose/headings — only sentinels + note); zero kernel change;
**W2 founder-gated** (rewrites workbench instruction files); drift fidelity pinned by per-file fixtures;
the heading-gate generalization keeps D5 + D5.2 outputs byte-identical (regression-guarded).

## 5. Testing / acid

- **3-kind genericity (the falsifier):** one pass generates the guardrail (headed `## Review floor`) +
  the policy nodes (body-only) + the workflow nodes (body-only), grouped to their distinct files; a
  mutation flipping the heading gate (`kind === 'guardrail'` → `true`/`false`) reddens the guardrail or
  the whole-file outputs respectively.
- **Regression:** the D5 review-floor fixture + the 4 D5.2 policy fixtures stay byte-identical.
- **Round-trip fidelity (per workflow file):** generated fragment equals the committed fixture equals the
  current file body (non-destructive proof).

## 6. Execution

Foundry-conducted; orchestrator hand-conducts (workers as subagents, read return-values, drive merges).
W1/W3 auto-merge on green waves; **W2 is the founder-gated capstone** (landed under the founder's
"generalize the ownership to the rest of the corpus" directive). Workers read the MERGED D5.2 engine code.
