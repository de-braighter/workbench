# Green-desk cleanup items (Phase 3 EXECUTE)

> Load this when the claimed item is a green-desk debt item
> (`green-desk-<repo-slug>/debt-<area>-<sha7>`). The core SKILL.md routing table
> names the route; this is the detail on staying in scope and on `/tech-debt` reuse.

A green-desk item's title names the exact dimensions + locations to fix — the
worker reads it for the work and stays on the foundry `feat/<slug>` branch; do
not widen the diff beyond the area `pathPrefix`, and `git add` only paths under
it. `/tech-debt` expects a per-repo `.claude/sdlc.json` that may be absent, so it
is optional convenience, never a hard dependency.

Fix the offenses the title names DIRECTLY under the quality floor (lint `--fix`,
`tsc` errors, Sonar smells, dead exports via knip, cognitive-complexity via
`/clean-decompose-optimizer`, TODO/FIXME); diff confined to the area `pathPrefix`.
`/tech-debt`'s detection/fix LOGIC is an optional reference for the scopes it covers
— but NOT its branch/commit/PR mechanics (it cuts its own branch + `git add -A`,
breaking the foundry worktree + scope confinement).
