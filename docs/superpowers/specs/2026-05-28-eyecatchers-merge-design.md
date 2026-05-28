# Eyecatchers → Design-System Merge — Charter

| | |
| --- | --- |
| Status | proposed |
| Date | 2026-05-28 |
| Author | Stibe Heller (with Claude Code) |
| Scope | `layers/design-system` (the two lib-pairs to merge) |
| Origin | Post-vector-ideas-adoption follow-up; the scope-wall gymnastics in PR3b / PR4a (dedup-by-generation across both cores) become unnecessary once the libs merge |

## Context

The de-braighter design-system layer currently ships **two parallel lib pairs**: `design-system-{core,angular}` (11 "brick" components, the `db-*` foundational primitives) and `eyecatchers-{core,angular}` (70 motion/viz components with a fuller spec→contract→impl→showcase pipeline). They live behind an nx scope wall: `scope:eyecatchers` libs may only depend on `scope:eyecatchers` libs — which forced the **dedup-by-generation** patterns in PR3b (TsWriter emits the dark palette into both cores from one DTCG source) and PR4a (`reduced-motion.ts` / `motion-loop.ts` hand-duplicated across both cores).

**Grounding (2026-05-28, surveyed cluster-wide):**
- **Zero external consumers** of `@de-braighter/eyecatchers-core` or `@de-braighter/eyecatchers-angular` anywhere under `layers/*` or `domains/*`.
- **Only `apps/showcase`** (~75 import sites) consumes eyecatchers internally.
- **No component-name overlap** between the 11 `db-*` bricks and the 70 eyecatcher components.
- **eyecatchers-core (94 exports) is ~4× design-system-core (22 exports)** — the bulk is 69 component contracts + duplicated math/tokens.
- **Partial graduation is already underway** — design-system-core's math/tokens are the canonical copies; eyecatchers-core's duplicates carry `@deprecated` markings ready to delete.

These facts make a clean break feasible: no back-compat layer needed.

## Decisions

### 1. Scope of "merge"

**Move content + retire `@de-braighter/eyecatchers-*` packages entirely.** No alias/shim layer (no external consumers to compensate). The two lib pairs collapse into the design-system lib pair; the eyecatchers npm scope disappears.

### 2. Conceptual unification: eyecatchers ARE bricks

Per ADR-168 (the design-system bricks charter), "bricks live in design-system" — *brick* is the canonical packaging term. The eyecatcher/brick distinction was a category label, not a structural one. Post-merge:

- **One term**: bricks. "Eyecatcher" becomes a historical category name.
- **Flat folder layout**: all 81 components live at `libs/design-system-angular/src/public/<component>/` (no `eyecatchers/` subfolder).
- **The eyecatcher per-component contract + spec pattern** (richer artifact set: spec doc + contract.ts + impl + showcase page) becomes the canonical brick authoring discipline. Existing simpler bricks (registry-only) coexist; they can level up to the contract pattern over time, or stay simpler if they don't need typed interfaces. Exposing this asymmetry is healthy, not a problem.

### 3. Selector convention: unchanged (mixed)

Existing selectors stay as they are — some `db-*`, some unprefixed, some mixed (e.g., `magnetic-cursor` already uses `db-magnetic-cursor` despite living in eyecatchers). A selector unification (rebrand-all-to-`db-*`) is **explicitly out of scope** for this merge; it's its own substantial PR worth doing on its own merits later.

### 4. End-state architecture

```
libs/design-system-css/                                     (unchanged)
   src/tokens/                  DTCG sources
   src/tokens.shell.css         utility CSS
   src/tokens.css               (generated)

libs/design-system-core/                                    (everything agnostic)
   src/public/math/             17 files (raf, reduced-motion, motion-loop, …)
   src/public/tokens/           3 files (+ .generated.ts dark-palette)
   src/public/skins/            (unchanged)
   src/public/bricks/           brick registry (unchanged)
   src/public/contracts/        ← 69 brick contracts (moved from eyecatchers-core)
   src/public/workflows/        ← 2 utilities (validation, layout, bpmn-export)

libs/design-system-angular/                                 (everything Angular)
   src/public/<component>/      81 dirs FLAT — all bricks
                                (11 existing + 70 moved from eyecatchers-angular)

DELETED: libs/eyecatchers-core/, libs/eyecatchers-angular/
RETIRED: @de-braighter/eyecatchers-core, @de-braighter/eyecatchers-angular
```

### 5. Dedup-by-generation patterns retire

- **PR3b's TsWriter into both cores** → emits only into `design-system-core` after Phase 2 (`build-ts.mjs` simplifies; the eyecatchers-core dark-palette TS copies delete).
- **PR4a's `reduced-motion.ts` + `motion-loop.ts` hand-duplicated** → eyecatchers-core copies delete; design-system-core's copy is canonical; eyecatchers-angular components repath their imports.
- The TsWriter machinery in `tools/tokens-compiler/` stays useful for future single-target token emission; just its dual-target loop simplifies.

### 6. Inverse api-extractor property

In PR3b/PR4b the safety property was **api-snapshots UNCHANGED** (those were pure refactors). In this merge, **api-snapshots regenerate at every phase** — content is *moving*, so `etc/*.api.md` for both `*-core` libs diffs deliberately each phase. The drift gate still does its real job (catching *unintended* changes); the implementer commits the regenerated snapshots as part of each PR. Both properties are valid uses of the gate.

## Sequencing — 7 PRs

Strictly ordered; the workspace builds green between every PR.

| # | Phase | What | Size | Risk |
| --- | --- | --- | --- | --- |
| **PR1** | scope wall | Remove the `scope:eyecatchers → only-eyecatchers` `depConstraint` in `eslint.config.mjs`; relabel both eyecatchers libs' `project.json` tags to `scope:design-system`; drop `scope:eyecatchers` from `lib-conformance.mjs`'s `SCOPE_TAGS`. | ≈5 files | Lowest |
| **PR2** | math/tokens graduation | Delete the duplicated `math/*`, `tokens/*`, `reduced-motion.ts`, `motion-loop.ts` from `eyecatchers-core` (they were already `@deprecated`). Update `build-ts.mjs` to emit the TS dark palette only into `design-system-core`. Repath eyecatchers-angular's math/tokens/RM imports to `@de-braighter/design-system-core`. | ≈25 files | Low |
| **PR3** | move contracts | `git mv libs/eyecatchers-core/src/public/contracts/*` → `libs/design-system-core/src/public/contracts/`. Likewise the 2 `workflows/` utilities. Update both barrels; repath eyecatchers-angular component imports + showcase contract imports. | ≈70 files | Low–Med |
| **PR4a** | components batch 1 | Move first ~25 of 70 components from `eyecatchers-angular/src/public/<c>/` to `design-system-angular/src/public/<c>/` (flat). Update barrels. Repath showcase imports for the moved batch. Manual smoke the moved components' showcase pages. | ≈50 files | **High** |
| **PR4b** | components batch 2 | Same procedure, next ~25 components. | ≈50 files | **High** |
| **PR4c** | components batch 3 | Same procedure, final ~20 components. | ≈40 files | **High** |
| **PR5** | retire libs + packages | Delete `libs/eyecatchers-core/`, `libs/eyecatchers-angular/`. Remove `@de-braighter/eyecatchers-*` from `tsconfig.base.json` `paths` + root `package.json` `build:libs`/`publish:libs`. Final grep gate (no remaining references in the cluster). | ≈10–20 files | Low–Med |

**Cumulative effort:** PRs 1+2+3+5 are small-to-medium and could each ship in hours; PRs 4a/4b/4c are the marathon — even split, they're the bulk of the work.

## Risks + mitigations

### The single biggest risk: Phase 4 has no visual-regression net

A moved component's runtime behavior could subtly break (e.g., a relative import resolves differently, an injected `DestroyRef` misfires post-move) without `build`/`lint`/`api-check` catching it. Mitigations:

1. **Batching into 3 sub-PRs** limits the blast radius per merge.
2. **Manual showcase smoke** of the affected components per sub-batch — ~5 minutes of clicking through the ~25 moved components' showcase pages, looking for anything visibly broken. Far better than zero coverage.
3. **Structural grep gate** per PR4 sub-batch: after the move, `grep -rn "@de-braighter/eyecatchers-*" libs/design-system-angular/src` for the moved components → zero hits (proves no missed import path).
4. **The PR2c precedent**: a 320-file `R100` rename moved cleanly with api-check as the safety net. The procedure works.

### Other risks

- **Phase 1's lint rule removal** could expose a hidden cross-lib import that was previously caught. Mitigation: ci:local catches it at PR-time; fix or revert.
- **Phase 2's TsWriter simplification** could regenerate the design-system-core dark-palette `.generated.ts` files differently than current. Mitigation: api-extractor snapshot for design-system-core gates it; values preserved (the eyecatchers-core copies were duplicates).
- **Phase 5's deletion** could miss a leftover reference in CLAUDE.md or another doc. Mitigation: final grep across the design-system repo.

## Out of scope (deliberately deferred)

- **Selector unification** to a single `db-*` prefix.
- **Brick contract/registry pattern unification** (extending the per-component contract pipeline to the 11 existing simpler bricks).
- **Dropping unused components** during the move (some of the 70 may be unconsumed; an audit + cleanup is its own PR).
- **Documentation rewrites** beyond the minimal references in CLAUDE.md or ADR mentions; can fold into PR5 or be a tail-end cleanup.

## Charter doc shape

This spec at `docs/superpowers/specs/2026-05-28-eyecatchers-merge-design.md`. Per-phase implementation plans at `docs/superpowers/plans/<date>-em-phase-<n>.md`. Mirrors the vector-ideas adoption charter pattern: one design doc, multiple sequenced implementation PRs, charter updated mid-flight if reality forces reinterpretations.
