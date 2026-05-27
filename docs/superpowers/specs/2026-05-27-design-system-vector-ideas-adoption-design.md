# Design-System Adoption Charter — Six Ideas Salvaged from `vector`

| | |
| --- | --- |
| Status | in progress — PR1, PR2a, PR2c, PR2b shipped (2026-05-27/28); PR3, PR4 remain |
| Date | 2026-05-27 (updated 2026-05-28) |
| Author | Stibe Heller (with Claude Code) |
| Scope | `layers/design-system` (all libs) |
| Origin | Analysis of the isolated `domains/vector` repo ("substrate-continuum") |

> **Mid-execution reinterpretations (recorded 2026-05-28):** two charter decisions changed once grounding revealed reality:
> - **#2 / PR2c — no empty `internal/` dirs.** All 6 libs were found 100% public (zero internal-only code), so the "physical split" became a `src/lib` → `src/public` rename + a deep-import ESLint guard, with **`internal/` created only on demand** (not as empty scaffolding) — honoring "demand-driven, never speculative".
> - **#5 / PR2b — conformance check, not a generator.** New libs are rare and dual-flavor (tsc + ng-packagr), so #5's *end* (every lib conforms; no divergent hand-created lib) is delivered by a continuous `check-lib-conformance` CI gate + an "adding a lib" doc, rather than an nx generator.
>
> PR2 was decomposed into three sub-PRs: **PR2a** (api-extractor drift gate), **PR2c** (rename + guard), **PR2b** (conformance gate). See the per-PR plans in `docs/superpowers/plans/`.

## Context

`domains/vector` is an ambitious "SVG-as-spatial-medium" visual operating system
that reached Phase C (primitives, compound widgets, data grid, a task-tracker app)
and is **consumed by nothing in the cluster** — no layer or domain imports any of its
nine `@de-braighter/vector-*` packages. The grand vision (a retained-mode scene graph
with pluggable SVG/Canvas/WebGL/React-Native/Flutter renderers) stays an idea; it is
not what design-system needs.

What *is* worth salvaging are the engineering disciplines vector was forced to invent
to stay coherent at scale. Six of them are genuinely better than what `design-system`
has today and cheap to adopt. This charter fixes **what we adopt, in what order, and
the success criterion for each**. Each numbered item below is implemented in a focused,
independently-reviewable PR with its own short plan and verifier wave.

### Current design-system baseline (confirmed 2026-05-27)

- 7 libs: `design-system-core`, `-css`, `-angular`, `-angular-forms`, `-react`,
  `eyecatchers-core`, `eyecatchers-angular`.
- npm + Nx; publishes to GitHub Packages; `ci:local = nx run-many -t build lint typecheck` + `vite:test`.
- Tokens are **hand-written** `tokens.css` (~400 lines) + 5 `data-theme` skins **plus**
  hand-kept TS mirrors (`motion.ts`, `easing.ts`, `color.ts`) — two sources that can drift.
- Public API: barrel exports + TSDoc `@internal` discipline only — **no api-extractor, no enforcement**.
- Motion: shared RAF frame-loop + `damp()` in `design-system-core`; `prefers-reduced-motion`
  checked ad-hoc in 15+ eyecatchers and scattered CSS media queries.
- **nx tag governance already exists and is enforced** (corrected 2026-05-27 — see #4). Three
  axes in `project.json` tags, all wired into `@nx/enforce-module-boundaries` in `eslint.config.mjs`:
  `scope:` (lib group — `design-system` / `eyecatchers` / `showcase`), `type:` (layer —
  `core` / `ui` / `css` / `app`), `platform:` (framework — `agnostic` / `web-angular` / `web-react`).
- **No nx generator infrastructure, no visual-regression baselines.**

The absence of visual-regression baselines is the key risk driver: a token change that
alters rendered output has **no automated tripwire** in design-system today (only `vector`
has a Playwright screenshot harness). Parity must therefore be *built in*, not assumed.

## The six adoptions

### #4 — Two-axis tag governance (PR1, foundation)

> **Reconciliation (2026-05-27):** vector's two-axis model is **already implemented** in
> design-system under different names, and already enforced by `@nx/enforce-module-boundaries`.
> We keep the established vocabulary rather than rename to vector's `layer:`/`scope:` (which would
> collide — `scope:` already means the lib group here, and `platform:` already does framework
> isolation). The charter's conceptual axes map onto the existing tags:
>
> | Charter concept | Existing tag axis |
> | --- | --- |
> | "layer" (dependency direction) | **`type:`** — `core` / `ui` / `css` / `app` |
> | "scope" (framework isolation) | **`platform:`** — `agnostic` / `web-angular` (`web-react` retired) |
> | (lib grouping, no vector equivalent) | **`scope:`** — `design-system` / `eyecatchers` / `showcase` |

**The model that already exists and is enforced** (`eslint.config.mjs` `depConstraints`):

```
type:core        → may depend on: type:core                         (agnostic foundation)
type:ui          → may depend on: type:core, type:ui
platform:agnostic   → may depend on: platform:agnostic              (no framework dep, ever)
platform:web-angular → may depend on: platform:agnostic, web-angular
scope:eyecatchers   → may depend on: scope:eyecatchers
scope:showcase      → may depend on: scope:design-system, eyecatchers, showcase
```

The `platform:agnostic → agnostic-only` rule is exactly the load-bearing wall the charter wanted —
it keeps `design-system-core` / `eyecatchers-core` honestly framework-free and portable. It is
**already in place**; #4 does not need to build it.

**What #4 actually does in PR1 (the genuinely-new work):**

1. **Delete `design-system-react`.** Unused by the cluster (nothing in any `src/` imports it).
   Removes: `libs/design-system-react/`, its `tsconfig.base.json` path alias, and its entries in
   the `build:libs` + `publish:libs` scripts. Retires the now-memberless `platform:web-react` tag.
   Git history preserves it for the "add React later" day. "Angular it is; React added later if
   needed" — the explicit decision. Drops the #2 retrofit from 7 libs to 6.
2. **Close two enforcement gaps** surfaced while reading the config:
   - `type:css` currently has **no** `depConstraint` (the css lib could import a UI lib). Add
     `type:css → may depend on: type:core` (css is foundation-tier, like core).
   - `platform:web-react` had a tag but never a rule; deleting the React lib removes the loose end.

Aligns with the `nx-tag-architecture-governance` skill.

### #2 — Public-API discipline (PR2)

Vector's ADR-0003 shape, applied to all 6 remaining libs:

```
libs/<name>/src/
├── index.ts             barrel ONLY — re-exports from public/, nothing else
├── public/              everything the package exposes
└── internal/            private; deep-imports forbidden by lint
api/<name>.api.md        committed rolled-up public-type snapshot
```

**Three enforcement mechanisms:**

1. **`@microsoft/api-extractor`** rolls each lib's public types into a committed
   `api/<name>.api.md`. A new CI target `api-check` recompiles and **fails on any drift**,
   so no PR can change a public surface without a reviewable diff to the `.api.md` file.
   Serves the `public-api-stabilizer` skill's ripple-reduction goal.
2. **ESLint `no-restricted-imports`** forbids `@de-braighter/design-system-*/internal/*`,
   `.../src/*` deep paths, and relative climbing across lib boundaries. With #4's tag rules,
   the boundary is closed from both directions.
3. The **generator (#5)** makes the shape structural rather than vigilance-based.

**`design-system-css` exception:** it is CSS, not TS, so it has no `.api.md`. Its public-API
gate is the granular `exports` map already in its `package.json`, locked with a check that all
declared entrypoints resolve. So: 5 TS libs get api-extractor + public/internal; `css` gets the
exports-resolution gate.

**Baseline capture:** the `.api.md` snapshots are generated from today's built `.d.ts` so the
baseline captures the *current real surface*; the public/internal reshuffle must then reproduce
it exactly (empty `api-check` diff).

### #5 — Generator-enforced package shape (PR2, with #2)

```
nx g @de-braighter/ds-generators:lib <name> \
  --group=<design-system|eyecatchers> \
  --type=<core|ui|css> \
  --platform=<agnostic|web-angular> \
  --purpose="<one sentence>"
```

Flags map to the existing tag axes (#4): `--group` → `scope:`, `--type` → `type:`, `--platform`
→ `platform:`. Scaffolds the entire conforming shape: `public/`, `internal/`, barrel,
`api-extractor.json`, the three tags wired into `project.json`, tsconfig path alias, README stub. After PR2 the rule is vector's
rule: **never hand-create a lib.** The generator cannot emit a non-conforming package, so the
discipline is enforced by construction. The generator lives in the design-system repo (a layer
repo — code is allowed there, unlike the workbench).

### #1 — DTCG token pipeline (PR3)

Two-package split (vector ADR-0004, adapted):

```
libs/design-system-tokens/          tags: scope:design-system, type:core, platform:agnostic   ← NEW lib (born via #5 generator)
   src/themes/*.json                DTCG source of truth (authored)
   src/resolver/                    JS alias resolver (runtime, platform-agnostic, no DOM/Node dep)
   generated/                       COMMITTED compiled outputs
      tokens.css                    ← must equal today's hand-written file
      tokens.ts                     ← TS-constant mirror (replaces motion.ts/easing.ts/color.ts)
   api/design-system-tokens.api.md

tools/tokens-compiler/              tooling, NOT layer-tagged (Node-only build CLI)   ← see #6
```

The split keeps the `tokens` lib free of Node-only build deps so the JS resolver stays
honestly `scope:agnostic` (runs in browser, worker, SSR).

**Parity strategy — proving the migration changes nothing (per the "exact parity, gated" decision):**

1. **Reverse-engineer, don't redesign.** Author the DTCG JSON *from* today's `tokens.css`,
   the 5 `data-theme` skins, and the TS mirrors — capturing current values exactly.
2. **Gate it.** A new `tokens:check` CI target compiles fresh and **fails on any non-whitespace
   diff** against the committed `tokens.css`. Today's file is the golden fixture; the migration
   is correct iff the diff is empty.
3. **Migrate in parity-checkable steps within PR3:** (a) land generated `tokens.css` identical
   (consumers `@import` the same path); (b) swap consumers of the TS mirrors onto `generated/tokens.ts`;
   (c) delete the original mirror files. Each step independently parity-checked.

**Value changes are explicitly out of scope** — they come later as separate, deliberate PRs.

### #6 — Pluggable Writers + substrate aesthetic extensions (PR3, with #1)

The compiler exposes a `Writer` interface (`{ id, write(theme, outputDir) }`) so output targets
are swappable:

```
tools/tokens-compiler/writers/
   css.writer.ts        emits generated/tokens.css
   ts.writer.ts         emits generated/tokens.ts
   (swift/kotlin/flutter writers = interface honored, NO code now)
```

**DTCG schema with all four substrate `$type` extensions** (full #6, per explicit decision):

Standard DTCG types — `color, dimension, duration, cubicBezier, number, shadow, strokeStyle` —
plus four first-class substrate extensions:

```
substrate.glow         glass/neon glow primitives (design-system's existing visual language)
substrate.lighting     directional/ambient lighting
substrate.atmospheric  backdrop depth/haze
substrate.energy       energy-level aesthetic
```

These validate as DTCG (validators ignore unknown `$type`), so Figma / Tokens Studio can still
read the files.

> **Deliberate decision recorded against CLAUDE.md's "demand-driven, never speculative" principle:**
> All four `$type`s are modeled now as a conscious brand-language decision — design-system's
> glass/neon vocabulary should be first-class, not squeezed into generic `shadow`/`color`.
> To honor "no speculative *values*": during parity authoring, today's real glass/neon/glow CSS
> is mapped into `substrate.glow` (and the others where real tokens exist). Where a category has
> **zero** current tokens, the `$type` definition + writer support are scaffolded but the token set
> is left **empty** — the type and taxonomy exist; no values are invented.

### #3 — Reduced-motion at the framework layer (PR4)

Honest adaptation: vector centralizes on one chokepoint (`MotionSystem.bind()`), but design-system
has **two** motion mechanisms — the JS RAF frame-loop and raw CSS transitions — so there are two
centralization points, replacing 15+ ad-hoc checks.

1. **One source of truth in `design-system-core`:** a `prefersReducedMotion()` primitive
   (cached `matchMedia` read, guarded by `typeof window !== 'undefined'` for SSR/vitest, with an
   explicit override arg for testing — vector ADR-0015 detection model). Replaces all scattered calls.
2. **The shared RAF frame-loop honors it at the loop boundary:** when reduced, an animation primes
   and settles straight to its terminal value (vector's instant-settle), writes once, and stops.
   Every component on the shared loop is covered for free, including future ones.
3. **CSS-driven motion gets one shared rule:** a single `@media (prefers-reduced-motion: reduce)`
   block in `design-system-css` driving motion-duration tokens → 0, inherited through the token cascade.
4. **Migrate** the 15+ components off bespoke `matchMedia` onto the primitive / shared loop.

**Explicitly NOT ported:** vector's channel runtime, spring solver, and `tween/sequence` API.
design-system's `damp()` + frame-loop is simpler and sufficient. #3 is purely about *where the
preference is honored*.

## Sequencing

Strictly ordered; each PR is its own plan + verifier wave + green `ci:local` before the next.

| PR | Lands | Depends on | Rationale |
| --- | --- | --- | --- |
| **PR1** ✅ | #4 tag-governance gaps + delete `design-system-react` | — | Tag governance already existed; PR1 deleted the React lib + closed the `type:css` gap. (shipped #85) |
| **PR2a** ✅ | #2 api-extractor public-API drift gate + css exports gate | PR1 | `.api.md` snapshots for the 5 TS libs + `api-check` in `ci:local`. (shipped #87) |
| **PR2c** ✅ | #2 `src/lib`→`src/public` rename + deep-import ESLint guard | PR2a | Surface-neutral (gate-proven); no empty `internal/`. (shipped #89) |
| **PR2b** ✅ | #5 lib-conformance CI gate + "adding a lib" doc | PR2a, PR2c | Continuous conformance check, not a generator. (shipped #91) |
| **PR3** | #1 DTCG pipeline + #6 Writers & extensions | PR1, PR2a, PR2c, PR2b | New `design-system-tokens` lib must satisfy the conformance gate; parity-gated against today's `tokens.css`. |
| **PR4** | #3 reduced-motion centralization | PR3 | Shared CSS rule drives motion-duration tokens (exist after PR3); primitive lands in an already-disciplined `core`. |

## Success criteria

Each becomes a binary gate added to `ci:local`.

- **#4** — `design-system-react` gone from repo, `tsconfig.base.json`, `build:libs`, and
  `publish:libs`; the `type:css → type:core` constraint is added and a deliberately-wrong
  `type:css → type:ui` import *fails* `nx lint`; full `ci:local` stays green.
- **#2** — `api-check` fails on any public-surface drift; 5 TS libs have committed `api/*.api.md`;
  `css` passes the exports-resolution gate.
- **#5** — `nx g ds-generators:lib …` yields a lib passing `api-check` + boundary lint with **zero hand-edits**.
- **#1** — `tokens:check` produces `tokens.css` byte-identical to today's (empty diff); all consumers
  build green off `generated/`.
- **#6** — `Writer` interface with working CSS + TS writers; four `substrate.*` `$type`s defined and
  DTCG-valid; native writers stubbed by interface only.
- **#3** — `prefersReducedMotion()` is the **only** `matchMedia` call in the codebase (grep proves it);
  15+ components migrated; shared loop + shared CSS rule honor the preference.

## Risks and mitigations

1. **Token parity without a visual net.** Mitigated by the `tokens:check` byte-diff gate + a manual
   showcase spot-check in PR3. Deferred option remains: port vector's Playwright visual-regression
   harness later as a backstop.
2. **⚠️ api-extractor on Angular ng-packagr output (the one genuine integration unknown).**
   api-extractor consumes `.d.ts` rollups; Angular partial-Ivy `.d.ts` emit can be awkward, and this
   repo already has known ng-packagr / stale-`node_modules` fragility. **Mitigation: PR2 begins with a
   throwaway spike on one Angular lib to confirm api-extractor works before retrofitting all of them.**
   Fallback if it fights us: a lighter public-API gate for the Angular libs (a generated export-list
   snapshot rather than full api-extractor).
3. **public/internal reshuffle breaking import paths.** The api-extractor baseline (captured from
   today's built `.d.ts`) catches surface changes; the build catches path breaks.

## Rollback

Each PR reverts independently. This charter records the order, so re-entry after a revert is clean.

## What we are explicitly NOT doing

- The retained-mode scene graph / multi-renderer "visual OS" core.
- Vector's spring-physics channel runtime, solver, and `tween/sequence/delay` API.
- Canvas / WebGL / React-Native / Flutter renderers.
- Speculative *values* for empty `substrate.*` token categories.
- Token value changes during the #1 migration (deferred to separate PRs).
