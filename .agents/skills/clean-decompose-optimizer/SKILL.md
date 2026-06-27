---
name: clean-decompose-optimizer
description: Decompose complex code into cohesive units and optimize cleanness with safe incremental refactors and patch-first output.
tags: [governance]
---

# Clean Decompose Optimizer

## Purpose
Decompose complex code into smaller cohesive units and improve cleanness without over-fragmentation.

Optimizes for:
- readability and maintainability
- stable minimal public APIs
- localized changes (avoid ripple edits)
- deterministic review-ready output

## Use when
- a file or component has mixed responsibilities
- functions or classes are long and hard to reason about
- changes routinely require touching many unrelated parts
- you want a clean refactor plan with minimal risk

Do NOT use for:
- pure formatting-only changes
- trivial one-line edits

## Inputs
Provide one of:
- a file (preferred) or a focused excerpt
- a PR diff
- a folder listing plus the key file(s)

Optional constraints:
- diff-only (no rewrites)
- no public API breaks
- max files changed
- target style (functional, OO, Angular patterns)

## Decomposition rules
Split along these boundaries:
1) Responsibility boundary (single reason to change)
2) Change frequency boundary (often-changed vs stable)
3) State ownership boundary (state where decisions are made)
4) Interface boundary (stable contracts vs volatile internals)

Avoid:
- micro-units that only forward data (plumbing)
- generic flag explosions
- over-abstraction without reuse

## Cleanness rules
Prefer:
- clear naming and single level of abstraction per function
- small functions with explicit inputs and outputs
- pure functions where possible; isolate side effects
- stable public surface; hide internals
- consistent error handling

## Method
1) Identify responsibilities and seams
2) Propose target structure (units and contracts)
3) Produce incremental refactor steps
4) Output patches (diff-first) and migration notes if needed
5) Provide a short verification checklist

## Output contract (strict)
Return exactly these sections in order:

1) Diagnosis
- complexity hotspots
- mixed responsibilities
- cleanness issues

2) Target decomposition
- proposed units (files, classes, functions)
- responsibilities per unit
- public contracts (types, interfaces, exports)

3) Refactor plan (incremental)
- ordered steps (low risk first)
- how to keep behavior stable

4) Patch set
- unified diffs per file
- minimize touched files
- no unrelated formatting

5) Verification checklist
- build/test commands (generic)
- edge cases to re-check

## Safeguards
- If context is insufficient to produce safe patches, request only the minimal missing snippet.
- Do not suggest breaking public APIs without a migration path.
- Prefer merging over-fragmented units over creating more files.
