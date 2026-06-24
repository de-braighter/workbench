---
product_key: board-editor-studio
charter_date: 2026-06-21
amended_date: 2026-06-24
risk_tier: T0
greenlight_gate: 88363656-f862-4031-9635-b04ff8a18c52
status: amended
brief: docs/foundry/board-editor-studio/opportunity-brief.md
---

# Charter — Board Editor Studio

> **AMENDMENT 2026-06-24 (founder-gated "go").** The original 10-item build-path (E1.1–E8.1)
> shipped the catalog IDE **inside** `apps/studio-ui` (a `/catalog` route + nav link). The
> latest `(3)` design handoff + a founder decision change two things: **(1)** the studio becomes
> a **STANDALONE** product — a new `apps/board-editor-ui` app on an extracted
> `@de-braighter/board-editor` library, **decoupled** from the cockpit (the opposite of the
> original "extends `apps/studio-ui` / adds nav" repo plan); **(2)** the previously-**deferred**
> `[data-theme]` ivory/clinical/night **skin system** comes **in scope**. The Scope, "What NOT
> to build", Quality plan, and Repo plan below are updated accordingly. Design + plan:
> `docs/superpowers/specs/2026-06-24-board-editor-studio-standalone-design.md` ·
> `docs/superpowers/plans/2026-06-24-board-editor-studio-standalone.md`. ZERO kernel change is
> preserved; the divergence is purely topology (standalone) + theming (skins), not new kernel
> concepts.

## Name & key

**Board Editor Studio** (`board-editor-studio`). The visual next-generation studio for
authoring `<ds-board-kit>` board editors as declarative DATA — a **catalog IDE** where
primitives and composites are authored once as named **definitions** and placed by
**reference** as instances, with live preview, code view, and cross-reference bookkeeping.
The evolution of the shipped Editor Recipe / Recipe Designer (`domains/studio`, slices 1–3).

## Risk tier

**T0 (prototype / internal dev tool).** Per the brief: no PHI, no external data, no auth, no
regulatory burden; blast radius is contained to `domains/studio`. It composes the substrate
board-kit brick and authors no kernel concepts (substrate_fit `partial` by construction —
honest for an authoring tool; ADR-176-safe, composes-not-authors).

| Tier | Examples | Gates | Quality parameters |
| --- | --- | --- | --- |
| **T0** prototype/demo | markets, gridiron, studio | greenlight + ship | wave standard, auto-merge OK *(cluster override below)* |
| T1 product | herdbook, exercir | + architecture approval | wave + `deep` on kernel-touching items |
| T2 regulated | oncology | + every kernel ADR + designer-first | full battery, RLS proofs, no auto-merge |

**Cluster governance override (binds this T0):** the standard T0 "auto-merge OK" does NOT
apply — per cluster governance every **merge-to-main is founder-gated** (founder's own
"go"), and every PR gets the review floor (≥1 `/code-review`) with the full verifier wave on
non-trivial PRs. Additionally, **any item that requires a `design-system-core` (brick)
change escalates to an `architecture` founder gate** before implementation (cross-repo
published-package blast radius), and its publish is separately founder-gated.

## Scope (the wedge)

> **Amended scope (2026-06-24).** The wedge below (E1.1–E8.1) is **DONE**. The amendment adds a
> follow-on phase: **stand the catalog IDE up as a STANDALONE product** (`apps/board-editor-ui`
> on `@de-braighter/board-editor`, decoupled from `apps/studio-ui`; retire the legacy
> single-shape `RecipeDesignerComponent`) and **reskin it to the `(3)` three-skin chrome
> contract** (`[data-theme]` ivory/clinical/night via published `@de-braighter/design-system-css`
> + a top-bar skin switcher). New build items R1a → R1b → R1c → R2 (+ optional R3); the original
> 10 are never re-pushed.

**The catalog shell + definition/instance model, compiled DOWN to the existing `shapes[]`
at interpret time (zero `design-system-core` change).** Concretely the first build slice
delivers: a left-rail catalog navigator + a primitives library where a primitive is authored
once as a named *definition* and *placed* as instances `{ref,x,y}` into a node's layer stack,
the live preview unchanged, and a `buildRecipeFromCatalog` expander that lowers
definitions/instances into the existing flat `EditorRecipe.shapes[]` so
`interpretRecipe`/`<ds-board-kit>` need **zero change** — preserving the slices-1–3 posture
and proving the model lowers cleanly before any cross-repo work is committed.

Subsequent slices ladder on top (decomposed by `/build-path`): composites (nested groups +
cycle detection), the `svg` primitive, the detail-drawer inspector, the board-settings surface
(identity/accessible-name template/interaction toggles/bounds), cross-reference usage
analytics (derived, never stored), the richer `definitions[]`+`layers[]` serialization +
diagram↔code view, and recipe persistence (save/load/name).

## What NOT to build

1. **Multi-board / multi-recipe catalog management.** Scope to a per-board definition library
   first; defer cross-board catalog management (the "catalog" pill's bigger framing).
2. **Drag-to-reparent / free-layout authoring gesture.** Numeric-offset placement only; defer
   the drag-to-reparent / free-layout gesture (also a slices-1–3 backlog item).
3. **End-user / tenant authoring + `svg` sanitization hardening.** Build for the trusted
   internal author; the `svg` primitive ships with a documented trusted-author assumption and
   basic escaping, NOT a tenant-grade sanitizer. Defer untrusted-author hardening.
4. **eject-to-TS (`BoardRegistry` codegen).** JSON export + copy-JSON only; defer eject.
5. **A `design-system-core` brick rewrite.** No brick change until compile-down studio-side is
   proven insufficient; any brick change is a separate architecture-gated item, never bundled.

## Quality plan

Tier-derived `qualityObligations` for queue items (F4 consumes verbatim):

- `tdd` — every build item is test-first (slices 1–3 convention).
- `review-floor` — ≥1 `/code-review` pass on every PR; full **verifier wave**
  (`local-ci` + `reviewer` + `qa-engineer`; `charter-checker` on any item that touches
  design-system-core) on non-trivial PRs.
- `opus-whole-branch` — an opus whole-branch review per build slice. **Non-negotiable for
  this product** — it caught CRITICAL data-loss/focus regressions on EVERY slice 1–3 that
  per-task + jsdom tests missed.
- `a11y-focus-recovery` — any add/remove/reorder/drop interaction must carry a WCAG-2.4.3
  focus-recovery test with the fixture attached to `document.body` asserting focus lands on a
  non-disabled surviving control (the jsdom-vs-real-browser blur trap; see
  `board-kit-tree-renderer-arc`).
- `parity-proof` — the compile-down expander (`buildRecipeFromCatalog` → `shapes[]`) ships
  with a parity spec proving an authored catalog reproduces an equivalent flat recipe
  IDENTICALLY (mirrors `plan-kinds-parity.spec.ts`). For the amendment's relocation/reskin
  items, the EXISTING parity + persistence specs travelling with the moved sources prove
  behaviour is unchanged.
- **`browser-verify` (added 2026-06-24 amendment)** — every UI item serves the app
  (`apps/board-editor-ui`, `:4200`) and **screenshots the rendered face** (each skin for the
  reskin item), diffed against the `(3)` handoff screenshots. A passing test suite does NOT
  prove the UI renders — the cockpit's blank-surface regression (retired tokens → transparent
  panels that jsdom + a11y tests MISSED) is why this is a hard gate, not acceptance prose.
- Acceptance per item: `npm test` green + `npm run build` green (studio pins **npm** via
  `packageManager`; do NOT use pnpm in `domains/studio`) + root `pnpm -r` (`ci:local`) green.

## Gate schedule

- **Gate 1 — greenlight:** ✅ approved 2026-06-21 (`88363656-f862-4031-9635-b04ff8a18c52`).
- **Ship gates (per merge):** every merge-to-main is a founder "go" (cluster governance).
- **Architecture gate (conditional):** any item that needs a `design-system-core` brick change
  raises a founder `architecture` gate before implementation + a separate publish "go".

## Repo plan

> **Amended (2026-06-24).** Still EXISTING `de-braighter/studio` (`domains/studio`), still **no
> `/new-domain`**. But the studio is now **STANDALONE**: the catalog IDE moves OUT of
> `apps/studio-ui` into a new **`libs/board-editor`** ng-packagr workspace package
> (`@de-braighter/board-editor`) consumed by a new **`apps/board-editor-ui`** Angular-CLI app
> (own `[data-theme]` root + skin switcher). `apps/studio-ui` (the cockpit) **drops** the
> `/recipe-designer` + `/catalog` routes and **retires** the legacy `RecipeDesignerComponent`.
> `domains/studio` is a **pnpm-workspace** (not Nx) — `pnpm-workspace.yaml` adds `libs/*`; each
> lib/app carries `build`/`test` scripts. Skins come from published
> `@de-braighter/design-system-css@^1.7.0` (`tokens.css`). See the standalone design + plan docs.

- **Repo:** EXISTING `de-braighter/studio` (`domains/studio`). **No `/new-domain` scaffold** —
  ~~this extends the shipped `apps/studio-ui` Angular app~~ **(superseded — now standalone; see
  the amendment above)**.
- **Packages consumed:** `@de-braighter/design-system-core` (the `board-kit` surface:
  `EditorRecipe`, `interpretRecipe`, `validateRecipe`, `<ds-board-kit>`). Default posture:
  consume the PUBLISHED package unchanged; compile catalog model down to its existing schema.
- **Scaffold tiers:** none (UI-only, studio app). No DB, no inference, no api tier.
- **Conditional cross-repo:** if a slice is proven to need a brick change, that item scopes to
  `de-braighter/design-system` under an architecture gate (publish → bump studio dep), per the
  slices-1–3 cross-repo publish boundary.
