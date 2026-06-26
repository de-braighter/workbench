# Drill-board recipe de-fork — design

- **Date:** 2026-06-26
- **Status:** approved (founder, brainstorm session)
- **Owner repos:** `layers/design-system` (SP1) · `domains/studio` (SP2) · `domains/exercir` (SP3)
- **Lineage:** [[editor-recipe-board-designer-arc]] · [[board-editor-studio-arc]] · [[board-kit-tree-renderer-arc]] · [[exercir-board-runtime-arc]]

## The test

The `EditorRecipe` / `interpretRecipe` system (board-kit, `@de-braighter/design-system-core`) was de-risked against the **plan-tree** board class only — auto-laid-out cards (`rect` + `text`) with `add-child | remove | reparent | move`. The kids-football **drill library board** (`kf-registry.ts`) is the hard class: a fixed-frame, free-layout pitch with selection-aware handles, resize/reshape, custom hit regions, computed arrow geometry (trig), and i18n a11y names.

The founder's decision: prove the recipe can express this board **entirely as declarative data**, then **de-fork the live production board** to render from that recipe under a byte-parity gate. This finds — and then *closes* — the boundary of "declarative is expressive enough."

## Decisions (locked in brainstorm)

1. **Full production de-fork.** Extend the published recipe schema → author the drill recipe (studio cookbook) → swap exercir's `kf-registry.ts` to `interpretRecipe(drillRecipe)` with a byte-parity gate on the live drill board.
2. **Pure-data calc language**, option **(i)**: a new `{ calc: string }` `RecipeValue` whose `+` is **overloaded** (numeric add *and* string concatenation), so even the arrowhead `path.d` string is built inside calc — `{ calc: "'M ' + tipX + ',' + tipY + ' L ' + …" }`.

## Architecture — three sub-projects, strict order

```
SP1  layers/design-system (board-kit)  ── ADR (calc lang) → impl → PUBLISH core@2.8.0
        │  (published @de-braighter/design-system-core)
        ├──────────────► SP2  domains/studio   — author drill recipe + cookbook + parity spec
        └──────────────► SP3  domains/exercir   — de-fork kf-registry → interpretRecipe + byte-parity gate
```

- SP1 carries all the risk (a new mini-language inside a **published brick API**). It is **designer-first**: a calc-language ADR in `layers/specs/adr/` precedes any code. ADR-176-safe — board-kit *composes*, it does not author kernel concepts; the kernel's four concerns are untouched.
- SP2 and SP3 consume the **published** core (no `file:` links — cluster rule), so SP1 must publish first. SP2/SP3 are then independent and may run in parallel.
- **Parity invariant** (SP3, also proven SP2): `interpretRecipe(drillRecipe)` must produce byte-identical `draw()` / `bounds()` / `describe()` / edit results to hand-written `makeKidsRegistry()` — the gate the board-kit de-fork and `plan-kinds-parity.spec.ts` already use.

## SP1 — recipe schema extensions (`libs/design-system-core/src/public/board-kit/`)

Seven additions. Only **A** is novel expressiveness; **B/C/F/G** generalize existing mechanisms; **D/E** mirror the existing action/interpret machinery.

| # | Extension | Shape change | Drill kind that forces it |
|---|---|---|---|
| **A** | `calc` value | `RecipeValue = … \| { calc: string }` | arrow back-off endpoint + arrowhead path |
| **B** | conditional primitive inclusion | `PrimitiveTemplate += { when?: RecipeValue }` (drawn only if truthy) | zone/arrow grab-handles; possibly player number |
| **C** | editor-state pseudo-vars | resolution env gains read-only `__selected` / `__focused` | zone/arrow handles (`when: { bind: '__selected' }`) |
| **D** | `resize` + `reshape` actions | `RecipeAction += { op:'resize'; handles:'corners'; minW?; minH?; pinOpposite? } \| { op:'reshape'; ends:['head','tail'] }` | zone corner-resize; arrow endpoint reshape |
| **E** | hit-region declaration | `RecipeShape += { hit?: { handles?:'corners'\|'endpoints'; handleRadius?; body?:'rect'\|'segment'; segmentTolerance? } }` | zone (corners+rect), arrow (endpoints+segment) |
| **F** | i18n a11y values | `RecipeValue += { i18n: string; params?: Record<string,RecipeValue> }`; `InterpretOptions += { translate?: (key, params?) => string }` | byte-parity on `describe()` |
| **G** | dotted-path bind | `{ bind }` accepts dotted path (`'points.0.0'`) in `resolveValue` | arrow `points: [[x1,y1],[x2,y2]]` |

**Coverage map** — every drill kind, fully as data:

| Kind | Extensions |
|---|---|
| `kf.pitch` | none (literal static primitives — fixed 860×560 frame) |
| `kf.point.player` / `opp` | maybe **B** (number text — *verify whether `n` is always present and collapse*); **F** |
| `kf.point.cone` / `ball` | **F** |
| `kf.zone` | **B**, **C**, **D**(resize), **E**, **F** |
| `kf.arrow.pass` / `run` | **A**, **B**, **C**, **D**(reshape+move), **E**, **G**, **F** |

### Calc language (the ADR)

A pure **expression** evaluator — not a scripting language.

- **Grammar:** number + string literals; variable refs (props, dotted paths, `__selected`/`__focused`); `+ - * / %`, unary minus, parentheses; **closed** function set `sin cos tan atan2 sqrt hypot abs min max round floor ceil` (radians). `+` overloaded: number+number → number; otherwise string-concat with number→string coercion. **No** assignment, control flow, loops, or user functions (conditionals stay at value level via `{when}`).
- **Evaluator — non-negotiable:**
  - Hand-written tokenizer + recursive-descent parser → AST → tree-walk. **Never** `eval` / `new Function` (recipes are *data*, eventually possibly tenant-authored → injection + reproducibility hazard).
  - **Total + deterministic** — no `Date`/`Math.random`/locale; matches `resolveValue`'s "never throws" contract. Parse/ref errors caught at author time by `validateRecipe`; at runtime a bad ref resolves to a defined fallback.
  - **Compile-once** at `interpretRecipe()`; walk per `draw()` (ε-budget — `draw` runs every frame).
  - **Bounded** — parser depth cap (no loops ⇒ cannot hang).
  - **New `validateRecipe` codes:** `calc-parse-error`, `calc-unknown-fn`, `calc-unknown-var`.
- **api-extractor:** new public types/codes → `api:update`; pin the report to the ci:local build with a warm nx cache (the union-literal ordering flake from L-b).

### SP1 publish
Bump `@de-braighter/design-system-core` → `2.8.0`, publish (GitHub Packages). **Done in the main session** — npm publish is classifier-gated to the founder's hand; a subagent cannot get it authorized by relay. Then add `2.8.0` to the `minimumReleaseAgeExclude` allowlist in `domains/studio` and `domains/exercir` and reinstall.

## SP2 — studio cookbook recipe (`domains/studio/libs/board-editor`)

- Author the drill board as recipe data (hand-authored `EditorRecipe` and/or a `CatalogModel` lowered via `buildRecipeFromCatalog`, whichever expresses the free-layout shapes cleanly — arrows likely hand-authored recipe given calc).
- A **cookbook entry** in `apps/board-editor-ui` so the drill board joins the gallery as a worked example of a football-class recipe.
- A **studio-side parity spec** proving the authored recipe interprets to the same draw/describe/edit as a reference — uses an identity/echo `translate`.

## SP3 — exercir de-fork (`domains/exercir/libs/pack-kids-football-ui/.../board-kit`)

- Replace `makeKidsRegistry()` internals: build the registry via `interpretRecipe(drillRecipe, { translate: (k,p) => transloco.translate(k,p) })`.
- Keep the public surface of `kf-registry.ts` stable for `KfSketcherComponent` (`registry` input unchanged).
- `projectSketch` prop shapes stay compatible with the recipe binds (dotted-path for arrow `points`); confirm player/opp `n` presence.
- **Byte-parity gate:** a spec feeds the same projected `RenderNode` tree to both `makeKidsRegistry()` (old) and the recipe registry and asserts identical `draw()` / `bounds()` / `describe()` / `edit` (`hitTest`, `onKey`, `onGesture`) results across player/opp/cone/ball/zone/arrow-pass/arrow-run/pitch.
- **Browser-verify** the live drill editor (`drills/new`, `drills/:id`) renders identically across the club-grass skin; 0 console errors; keyboard move/resize/reshape/delete still work.

## Testing & verification

- **SP1:** unit tests for the calc tokenizer/parser/evaluator (arithmetic, trig, string-concat, errors, depth cap, determinism); `validateRecipe` tests for the 3 new codes; interpret tests for `when`-gated primitives, `__selected`, resize/reshape actions, hit regions, `{i18n}`, dotted-path bind.
- **SP2:** studio parity spec + existing `catalog-parity` / `catalog-document` stay green.
- **SP3:** byte-parity spec (the gate) + a11y unchanged (WCAG 2.4.3 focus recovery, 2.5.7 dragging alternatives via keyboard, 2.5.8 target size on handles) + browser proof.
- Every non-trivial PR: verifier wave (`local-ci` + `reviewer` + `qa-engineer` + `charter-checker`; `exercir-charter-checker` on SP3) with `isolation: "worktree"`.

## Execution

- **Vehicle:** subagent-driven execution; founder granted blanket auto-approve + auto-merge at all levels (2026-06-26).
- **Order:** SP1 ADR → SP1 impl → SP1 publish (main session) → SP2 ∥ SP3.
- **Twin ritual** (`npm run ritual:post-merge -- <owner/repo#pr>`) after every merge; `Producer:`/`Effort:`/`Effect:` lines on each PR body.
- **Hygiene:** workbench carries untracked WIP — never `git add -A`; explicit paths only. Wave agents use `isolation: "worktree"`; forbid git ops in shared clones.

## Open items to verify during impl

1. Does `projectSketch` always assign `n` to player/opp (⇒ collapse the conditional number text, drop **B** for points)?
2. Exact parity-harness shape (two registries on one shared projected node tree).
3. `minimumReleaseAge` allowlist bumps + reinstall in studio and exercir after the 2.8.0 publish.
