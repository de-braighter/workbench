---
title: Designer-first for risky changes
last_updated: 2026-05-24
---

# Designer-first

Default flow:

```
founder direction → implementer → verifier wave → merge
```

For risky / architecturally-load-bearing work, insert a designer step:

```
founder direction → designer (spec/ADR) → founder approves → implementer → verifier wave → merge
```

## Triggers

- New port shape or kernel primitive
- Cross-cutting concern (touches >2 packs / >2 layers)
- Migration with non-obvious rollback or data-shape impact
- Anything where the implementer would otherwise be guessing at scope

## Agent selection

- Generic architecture → `designer` (markdown only; no code)
- Kernel-level / cross-cutting substrate → `substrate-architect`
- "What should we build next?" → `product-strategist` (reads roadmap/issues/retros; never auto-creates issues)

## Constraints in every designer brief

- Output is markdown only; do not write or modify any code files
- Single commit; no while-here cleanup; force-push never authorized

## Output

Designer produces either:

- A new ADR under `layers/specs/adr/`
- A new concept doc under `layers/specs/concepts/`
- An amendment to an existing ADR or concept doc

After founder approval of the spec, dispatch the `implementer` (or domain-specific implementer like `substrate-coder-pro`, `prisma-pro`, `ui-pro`, `swiss-pro`).
