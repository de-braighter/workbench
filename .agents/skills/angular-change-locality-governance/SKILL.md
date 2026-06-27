---
name: angular-change-locality-governance
description: Optimize Angular and Nx code for fast localized updates with minimal ripple changes.
tags: [governance, angular]
---

# Angular Change Locality Governance

## Core rule
- Target: 1-3 files per typical change
- Smell: more than 5 files for a normal update

## What this skill does
- Find root causes of multi-file ripple changes
- Recommend collocation, slicing, merges, and stable contracts

## Output contract
1) Locality score 0-100
2) Root causes
3) Actions
4) Target folder structure
