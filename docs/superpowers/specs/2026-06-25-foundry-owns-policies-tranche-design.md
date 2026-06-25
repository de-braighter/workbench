---
title: Foundry owns the policies — generalization tranche 1 (Unified Cockpit D5.2)
status: proposed
date: 2026-06-25
scope: design-global
product: system-builder-studio
builds-on:
  - docs/superpowers/specs/2026-06-24-foundry-owns-workbench-instructions-design.md  # the D5 tracer (review-floor)
  - docs/superpowers/specs/2026-06-24-unified-cockpit-masterplan.md
arc: substrate self-application — the foundry owns the workbench's governance corpus
---

# Foundry owns the policies — generalization tranche 1

> D5 proved the full ownership vertical (observe → calibrate → enforce → generate) on ONE artifact
> (the review-floor rule). This tranche **generalizes the R3-generate ownership** horizontally to the
> rest of `policies/` — `coding.md`, `testing.md`, `docs.md`, `voice.md` — so the foundry owns the
> whole policy directory. It is the first increment of "generalize the ownership to the rest of the
> corpus"; the masterplan's "boil the ocean incrementally" applied.

## 1. Scope (the founder-chosen tranche)

- **Breadth:** the 4 remaining policy files (`coding.md`, `testing.md`, `docs.md`, `voice.md`).
  `git.md`'s review-floor region is already owned (D5). Workflows, the skills/agents arsenal, and
  `CLAUDE.md` are explicitly **later tranches** (§7).
- **Granularity:** **one governance node per policy FILE** — the file's body is a single foundry-owned
  region. Per-rule modeling (as the review-floor used) is a later refinement if a specific rule needs
  individual observe/calibrate.
- **Depth:** **R3-generate ownership only.** Most policy rules have no firing signal (you cannot
  observe "write in active voice" firing on a PR), so R1 observe / R1 calibrate / R2 enforce do **not**
  apply to these nodes. The review-floor keeps the R1/R2 it already has; firing-capable policy rules
  (e.g. `testing.md`'s merge-blockers) can become observe-nodes in a later tranche.

## 2. Architecture — generalize the D5 engine (two small, principled extensions)

The D5 governance-node machinery already exists (`domains/foundry/src/governance/node.ts`,
`src/compiler/target-markdown.ts`). Generalizing it needs exactly two changes — both **zero kernel
change** (metadata + pack code), and both *strengthen* the genericity the D5-7 acid asserted:

1. **`governanceFields` accepts any non-empty `governanceKind`** — not just `'guardrail'`. A policy node
   carries `governanceKind: 'policy'`, no `action`, no `effectDeclarations`. The engine stops caring
   what *kind* of governance an artifact is — it owns governance generically. (D5-7's acid proved a
   2nd artifact re-expresses with zero new vocabulary; this makes that a structural guarantee.)
2. **The markdown `CompileTarget` groups governance nodes by `sourceArtifact` FILE** → emits a
   `Map<filePath, fragment>` (or equivalent) rather than one joined string. The `sourceArtifact` field
   (e.g. `policies/coding.md`) already carries the file mapping; this is grouping, not new plumbing.

**The policy governance node (one per file):**
```
governanceKind:  'policy'
sourceArtifact:  'policies/coding.md'            ← the target file (whole-file region)
authoredContent: { title: 'Coding standards', body: '<the file body verbatim>' }
                                                   ← R3 generate source = CURRENT content (non-destructive)
(no action, no effectDeclarations — no firing signal)
```

**Where code lives** (honoring "no code in the workbench"): the model + generate generalization in
`domains/foundry`; the cockpit in `domains/studio`; the **workbench** receives only the
sentinel-wrapped (content-identical) policy files + the per-file fixtures' analogue.

## 3. Build items (the `/build-path`)

- **G1 · Generalize the governance engine + author the 4 policy nodes** *(domains/foundry)* —
  broaden `governanceFields` to any `governanceKind`; generalize `markdownTarget.compile` to
  group-by-`sourceArtifact`-file → multi-file output; author the 4 policy governance nodes
  (`coding`/`testing`/`docs`/`voice`, `governanceKind: 'policy'`, `authoredContent` = each file's
  current body); commit per-file generated fixtures (`src/compiler/__fixtures__/policy-*.md`) + the
  drift tripwire per file. Extend the **genericity acid** (D5-7) to assert a `policy`-kind node
  generates its file region AND the review-floor `guardrail` node still generates correctly (mixed
  kinds, multi-file). *Zero kernel change.*
- **G2 · The capstone — own the 4 policy files** *(de-braighter/workbench, **FOUNDER-GATED**)* —
  sentinel-wrap each of `coding.md`/`testing.md`/`docs.md`/`voice.md` so the file body is a
  foundry-owned region (`<!-- governance:<key>:start/end -->`), content = the generated fragment =
  the **current** body (non-destructive — no policy text changes), each with the "edit the node's
  `authoredContent` via the Studio `/governance` cockpit, not this file" note. Rewrites 4 of the
  workbench's own instruction files → founder-gated even under any T0 waiver.
- **G3 · Cockpit — list all owned governance artifacts** *(domains/studio)* — extend the `/governance`
  surface from one node to a **list/table** of every governance node (the 4 policies + review-floor),
  each row showing `sourceArtifact`, `governanceKind`, and a founder-gated regenerate **stub** (no
  file mutation). Keep the review-floor's firings/calibration detail reachable; policy rows show only
  the ownership + source (no firing data — they don't fire). Browser-verify (the token-divergence
  trap).

**Dependencies:** G2 depends on G1 (needs the generated fixtures); G3 depends on G1 (lists the nodes).
G2 and G3 are independent of each other. Scope-disjoint: G1 `src/governance` + `src/compiler`
(foundry), G2 `policies/*.md` (workbench), G3 `apps/studio-ui/src/app/governance` (studio).

## 4. Boundaries (the traps)

- **Non-destructive.** G2 changes **no policy text** — it only sentinel-wraps existing bodies and
  asserts the generated fragment equals the current content. A regenerate is a no-op on content.
- **Zero kernel change (ADR-176 pack-level).** `governanceKind: 'policy'` is a metadata string value,
  not a kernel type; the generalized generate is pack code. No new node-kind, no contract change.
- **G2 is founder-gated.** It rewrites the workbench's own instruction files. The founder's
  "generalize the ownership to the rest of the corpus" directive authorizes the arc; the G2 act is
  surfaced explicitly (a workbench PR) for the founder to land, or under a fresh standing "go".
- **Drift fidelity.** Each policy file's generated fragment is pinned by a committed fixture +
  tripwire test in the foundry (the cross-repo live-drift check stays a documented manual/CI step,
  as in D5).
- **Two-trees discipline.** The policy file becomes a generated region (content owned by the
  governance node) — the foundry log stays authoritative for *state*; the node's `authoredContent`
  is the source for the *generated text*. Same split as D5.

## 5. Testing / acid (kill-criteria)

- **Generalized genericity (the falsifier):** the engine generates BOTH a `policy`-kind node (whole
  file) AND the `guardrail`-kind review-floor node (region) in one pass, grouped to their distinct
  files — and a hypothetical 5th artifact of a new `governanceKind` re-expresses with **zero mechanism
  change** (the `governanceFields`-accepts-any-kind guarantee). A mutation re-narrowing
  `governanceFields` to `=== 'guardrail'` turns the policy-generation tests RED.
- **Round-trip fidelity (per file):** `generate(policyNode) → fragment` equals the committed fixture,
  and the fixture equals the policy file's current body (non-destructive proof).
- **Multi-file grouping:** two nodes with different `sourceArtifact` files emit to two distinct file
  keys (not one joined blob); a mutation collapsing the grouping is RED.

## 6. Execution

Foundry-conducted (orchestrator hand-conducts, per the D5 lesson — dispatch workers as subagents,
read their return-values, drive merges off `foundry_status`/`gh`). G1/G3 auto-merge on green waves;
**G2 is the founder-gated capstone**. Workers read the MERGED D5 governance code (not illustrative
signatures) — the recurring drift lesson.

## 7. Later tranches (named, not in scope)

- **Tranche 2 — workflows:** `workflows/{verifier-wave,designer-first,story-tracker}.md` (same
  whole-file policy-node shape).
- **Tranche 3 — the arsenal (skills + agents):** *different shape* — skills/agents are **actuators/
  code + prompts, not policy prose**. "Owning" them means **cataloging them as the actuator
  registry** the governance nodes invoke (the masterplan's layer-4 "arsenal as actuators"), NOT
  generating their prose. A distinct design.
- **Tranche 4 — `CLAUDE.md`:** the root orchestration file (highest blast radius) — last, once the
  pattern is proven across policies + workflows.
- **Deferred R1/R2 on firing policy rules:** `testing.md` merge-blockers, `git.md` Sonar gate, the
  verifier-wave — promote to observe/enforce nodes when a measurable firing signal is wired.
