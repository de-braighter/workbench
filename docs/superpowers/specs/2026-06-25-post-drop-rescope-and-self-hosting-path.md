---
title: Post-drop re-scope — the fusion product replaces the workbench (the D6 path)
status: decision
date: 2026-06-25
scope: design-global
decided-by: founder
builds-on:
  - docs/superpowers/specs/2026-06-24-unified-cockpit-masterplan.md   # D6 "foundry+workbench fully self-hosted"
  - docs/token-consumption-audit-2026-06-25.md                       # "you're about to drop the workbench"
  - docs/superpowers/specs/2026-06-24-foundry-owns-workbench-instructions-design.md  # D5 (the ownership arc)
arc: substrate self-application — the foundry generates the workbench, then the workbench is dropped
---

# Post-drop re-scope — the fusion product replaces the workbench

> **Founder decision (2026-06-25):** the corpus-ownership arc (D5–D5.4, all shipped this session) does
> NOT end with **T4 (own the current `CLAUDE.md`)**. T4 is superseded by the planned **workbench drop**:
> once the workbench↔foundry fusion is fully done, the hand-maintained `de-braighter/workbench` repo is
> no longer needed — the **fusion product** (Studio cockpit + foundry-owned governance) becomes the
> authoring home, and you work in *it*. So we **skip T4** and re-aim the remaining instruction-surface
> work at the real finale: the **D6 self-hosting capstone**, reached via a migration.

## The decision

- **SKIP T4** (sentinel-wrap the current `CLAUDE.md`). Owning a *region* of a hand-maintained file is a
  half-measure the drop supersedes.
- **SKIP the audit's current-workbench trims** — W3 (trim agent descriptions), W5 (de-dup `CLAUDE.md`),
  W8 (generate `AGENTS.md`). Throwaway against the drop; the audit itself flagged them "defer until the
  fusioned structure is settled."
- **Re-aim at the D6 self-hosting capstone** (below). That subsumes T4.

## The generate / assemble boundary (load-bearing)

"Fully self-hosted" does **not** mean the foundry generates *everything* — it respects one boundary:

- **Governance PROSE is GENERATED** from the foundry-owned model — `policies/` + `workflows/` (proven in
  D5.2/D5.3) and the `CLAUDE.md` *doctrine* (the 4 kernel concerns, the ring boundaries, the workflow
  rules). These are structured rules a model can emit.
- **Prompt BODIES are AUTHORED, not generated** — the 23 agent + ~71 skill `.md` bodies are rich,
  hand-written prompts. The foundry **catalogs** them (D5.4 arsenal catalog) and **assembles** them into
  the launch environment; it does **not** synthesize their prose.

So the fusion product is the **authoring + assembly home**: it *generates* the governance prose and
*catalogs + assembles* the authored bodies into the runtime `.claude/` launch environment. The thing
that gets dropped is the **hand-maintained standalone workbench repo**, not the authored content itself.

## The path to the drop (sequenced)

1. **✅ Own the governance corpus (D5–D5.4, DONE 2026-06-25).** `policies/` + `workflows/` foundry-
   *generated*; the arsenal (skills+agents) *cataloged* + linked; the Studio `/governance` cockpit
   surfaces all of it. The foundry now owns the governance content.
2. **D6 self-hosting capstone (the finale — NOT yet built).** The fusion product *generates + assembles
   the launch environment*: the `CLAUDE.md` root + `policies/` + `workflows/` generated from the model;
   the agent + skill bodies cataloged + assembled. The masterplan's D6 ("the foundry builds the model of
   the foundry; the guardrails governing that build are nodes in the tree being built"), made concrete.
3. **Migration ("we have to migrate some stuff first" — founder).** Move the authored content — the
   agent/skill bodies, the design docs, the foundry-owned governance — into the fusion product's
   authoring home, so it can author + assemble the launch env. The migration is the precursor to the drop.
4. **Drop.** Retire the standalone hand-maintained `de-braighter/workbench`; launch/work from the fusion
   product. The founder's loop becomes: author in the cockpit → it assembles the launch env.

## Gating

The drop is gated on **(2) D6 self-hosting + (3) the migration** — and the fusion is **not yet "fully
done"** (D6, the generate-the-launch-env machinery, is unbuilt; only the *owning* + the cockpit shipped).
So the drop is **not actionable today**; D6 is its own big arc, best started in a fresh, focused session.

## Carry-over (owed, not blocked by this decision)

- **Night-theme `--color-*-soft` a11y fix** — in flight (design-system PR, dispatched 2026-06-25).
- **Twin ritual** — done this session (backfill ×4 repos + reconcile; 14 cycle-time obs).
- **Re-run the token-audit's static layer post-drop** against the new fusion-product structure (the
  audit's durable items W2/W7 shipped this session; W1 fixed; W6 deferred; W4/W9 unbuilt + may be mooted).

## Next session

Start the **D6 self-hosting capstone** with a focused brainstorm. Recommended first steps:
1. **Verify "fusion fully done"** — audit the masterplan D1–D6 against what shipped (gap-list) since the
   drop is gated on it.
2. **Scope the migration** — inventory what authored content moves into the fusion product + how.
3. **Design the generate/assemble machinery** — extend the markdown `CompileTarget` to emit the
   `CLAUDE.md` root + assemble the cataloged bodies into a launch env; respect the prose/bodies boundary.
