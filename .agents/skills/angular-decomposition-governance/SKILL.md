---
name: angular-decomposition-governance
description: Enforce optimal Angular component decomposition in Nx workspaces.
tags: [governance, angular]
---

# Angular Decomposition Governance

## What this skill does
- Classify components: page, container, presentational, ui-primitive, form-control
- Detect anti-patterns: mixed responsibilities, large Inputs/Outputs, prop drilling, unnecessary CVA
- Produce a deterministic refactoring plan and target structure

## Output contract
Return sections in this order:
1) Classification table
2) Issues by severity
3) Score 0-100
4) Refactoring actions
5) Target component tree

Allowed actions:
- extract presentational component
- introduce container or facade
- merge components
- move to correct Nx library
- replace CVA with simple component
- convert to ViewModel input
