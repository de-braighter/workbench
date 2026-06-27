---
name: angular-architecture-concierge
description: Single entry point that routes Angular and Nx architecture requests to the right workflow.
tags: [governance, angular]
---

# Angular Architecture Concierge

## What this skill does
- Detect intent and choose the right workflow:
  - decomposition
  - change locality
  - Nx boundaries
  - signals or standalone
  - feature generation
- Enforce a consistent output format
- Request only minimal missing context (diff first)

## Output contract
1) Detected intent
2) Key findings
3) Ordered action plan
4) Patch strategy (diff first)
5) Minimal missing context (only if required)
