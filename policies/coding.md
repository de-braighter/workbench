---
title: Coding standards
last_updated: 2026-05-24
---

# Coding standards

Detailed standards are maintained in `layers/specs/instructions/` (once the specs layer is scaffolded). This file is the stub that points there.

## Principles (foundational)

- **YAGNI** — build what's needed, not what might be needed.
- **DRY** — share code via clear, well-named units; don't duplicate logic, but don't over-abstract three similar lines into a framework.
- **Composition over inheritance.**
- **Substrate hygiene** — primitives that touch Layer 1 (Subject / Indicator / Intervention / Observation / Plan) must be substrate-shape; no domain-specific extensions in the typed vocabulary itself.
- **Effect-algebra shape even before effect-algebra** — declared effects on plan-node primitives must be structured values (indicator + direction + magnitude + confidence + horizon), not free text.

## Per-language conventions

- TypeScript: strict mode; explicit return types on exported functions; no `any` without justification.
- Angular: standalone components; signal-based inputs; OnPush change detection; no `@Input()`/`@Output()` decorators (use `input()` / `output()` signals).
- NestJS: hexagonal architecture; `inAdapters/`, `outAdapters/`, `outPorts/`, `useCases/`.
- Prisma: row-level security on every table holding tenant data; two-role pattern (superuser for migrations, runtime role for app).

## Related

- `policies/testing.md` for test discipline
- `policies/git.md` for commit + PR discipline
- `policies/docs.md` for documentation discipline
