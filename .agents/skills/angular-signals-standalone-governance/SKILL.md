---
name: angular-signals-standalone-governance
description: Apply best practices for Angular Signals and standalone components.
tags: [governance, angular]
---

# Angular Signals and Standalone Governance

## Heuristics
- Write signals where decisions are made (container or facade)
- Avoid side effects in computed; use effects for IO only
- Avoid signal writes in templates
- Keep interop boundaries clear for RxJS

## Output contract
1) Issues
2) Recommended ownership map
3) Incremental refactor steps
