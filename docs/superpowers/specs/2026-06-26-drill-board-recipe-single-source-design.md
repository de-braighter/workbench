# Drill-board recipe — single published source — design

- **Date:** 2026-06-26
- **Status:** approved (founder, brainstorm session)
- **Owner repos:** `layers/design-system` (SP1 — new package) · `layers/specs` (ADR) · `domains/exercir` (SP2) · `domains/studio` (SP3)
- **Lineage:** [[drill-board-recipe-defork-arc]] · [[editor-recipe-board-designer-arc]] · [[board-editor-studio-arc]] · [[studio-product-direction]]

## 1. The smell

The drill-board recipe de-fork ([[drill-board-recipe-defork-arc]], 2026-06-26) shipped the kids-football drill board as a declarative `EditorRecipe` and made it the **live** exercir board's source (exercir#320 — `makeKidsRegistry()` → `interpretRecipe(kfDrillRecipe, { translate })`, byte-parity-gated 26/26). The studio cookbook then needed the same recipe to render its worked-example thumbnail (studio#91), so it got a **verbatim hand-copy**.

The two files are byte-identical except their header comment and export name:

| | Canonical (exercir origin/main, #320) | Copy (studio main, #91) |
|---|---|---|
| File | `libs/pack-kids-football-ui/src/lib/drills/sketch/board-kit/kf-drill.recipe.ts` | `libs/board-editor/src/lib/cookbook/kids-drill.recipe.ts` |
| Export | `kfDrillRecipe` | `kidsDrillRecipe` |
| Loaded by | `makeKidsRegistry()` → live board | cookbook showcase → static SVG thumbnail |
| Translate | exercir transloco | studio `cookbookTranslate` stub |

They are duplicated because there is **no shared channel**: the cluster rule is "domains consume published `@de-braighter/*` **layer** packages, not each other," and a recipe authored as a `.ts` literal inside a domain is not a portable, loadable artifact.

**Goal:** ONE recipe artifact, authored/stored as portable **data**, that both consumers **load** — no second copy. The live exercir board stays byte-parity (its 26/26 gate must still pass against the single source); **zero `design-system-core`/kernel change** (ADR-176-safe — board-kit stays a brick).

**Not in scope (deferred):** making the drill board openable/**editable** in the studio's catalog-designer (extending authoring to the calc / archetype / free-layout class). That is the separate, deeper gap.

## 2. Why this shape (decisions locked in brainstorm)

The cluster rule collapses the option space:

- **(b) Backend recipe store** (studio writes → domains fetch) is the north-star ([[studio-product-direction]]; the `editor-recipe-persistence` slice-4 design), but that design is localStorage-only with the backend adapter explicitly deferred. A real cross-domain store needs a service + fetch path + deployment + remote parity gating — a multi-slice arc, over-scoped for de-duping one literal. **Deferred.**
- **(c) Checked-in JSON both load** cannot stand alone: a domain cannot import a file from another domain or the workbench root at build time, so a single JSON file only satisfies "one source, both load, no copy" **if it is published from a layer**. (c) therefore reduces to (a) with JSON as the format.
- **(a) Published layer artifact** is the only way to have one source that both genuinely **load**, today, without a backend. **Chosen.**

Within (a), the founder chose the cleanest, most store-ready point:

1. **Home — a NEW dedicated package `@de-braighter/board-recipes`** (sibling lib in the `design-system` repo), *not* an export of `design-system-core`. Rationale: `design-system-core` is the board-kit **engine** and ships zero recipe data on purpose (ADR-168 — bricks are domain-agnostic, packs consume them). A concrete `kf.*` recipe instance belongs in a **content/catalog layer**, not the engine's public API. A dedicated package also gives recipe content its own semver and future-proofs a growing catalog (the studio's whole purpose is authoring more recipes).
2. **Format — JSON asset.** The canonical committed source is `kf-drill.recipe.json` (pure data). It is the literal "boards are data" artifact and the exact payload a future store (b) can hold unchanged. A thin typed wrapper re-exports it so consumers still get an ergonomic typed import.
3. **ADR — kept.** A short ADR records the new convention (portable board recipes live in a dedicated content layer, shipped as JSON). New published package + new cluster-structure pattern ⇒ designer-first.
4. **Canonical export name — `kfDrillRecipe`** everywhere (exercir keeps its name; studio renames from `kidsDrillRecipe`).

## 3. Architecture — three sub-projects, strict order

```
SP1  layers/design-system — NEW @de-braighter/board-recipes  ── ADR → impl → PUBLISH @1.0.0
        │  ships: src/kf-drill.recipe.json (canonical data) + src/index.ts (typed loader → export const kfDrillRecipe)
        │  depends on @de-braighter/design-system-core (^2.8.0) for the EditorRecipe type ONLY
        ├──────────────► SP2  domains/exercir — kf-registry imports the published recipe;
        │                                       DELETE kf-drill.recipe.ts; 26/26 byte-parity gate stays green
        └──────────────► SP3  domains/studio  — cookbook imports the published recipe;
                                                DELETE kids-drill.recipe.ts; fidelity spec updated
```

- **SP1 carries the risk** (a brand-new published layer package + the JSON-asset distribution pattern). Designer-first: the ADR precedes the package code.
- **SP2 and SP3 consume the *published* package** (no `file:` links — cluster rule), so SP1 must publish first. The publish is done **in the main session** — npm publish is classifier/founder-gated; a subagent cannot get it authorized by relay (same as core@2.8.0). SP2 and SP3 are then independent and may run in parallel.
- **Parity invariant** (SP2): the published recipe, interpreted, must produce byte-identical `draw()` / `bounds()` / `describe()` / edit results to the pinned legacy oracle in exercir's `parity-legacy/` — the same gate `kf-registry-parity.spec.ts` already enforces. Only the recipe *source* changes; the gate is unchanged.

## 4. SP1 — `@de-braighter/board-recipes` (`layers/design-system/libs/board-recipes/`)

A **plain TS lib** — no Angular dependency, so it avoids the ng-packagr secondary-entry-point complexity and just emits a Node-ESM bundle + `.d.ts` + the raw `.json`. It mirrors `design-system-core`'s publishable-lib build toolchain and honours the Node-ESM packaging lesson ([[design-system-node-esm-packaging]]): FESM bundle, extensionless-import-safe, JSON inlined into the bundle, the raw `.json` also shipped in the package `files` for store/portability consumers.

**Files**

- `src/kf-drill.recipe.json` — the canonical recipe **data** (the fully-expanded `EditorRecipe` object as JSON).
- `src/index.ts` — the typed loader:
  ```ts
  import type { EditorRecipe } from '@de-braighter/design-system-core';
  import kfDrill from './kf-drill.recipe.json' with { type: 'json' };
  export const kfDrillRecipe: EditorRecipe = kfDrill as EditorRecipe;
  ```
  (Exact JSON-import syntax/casting to follow the repo's bundler; the contract is: consumers `import { kfDrillRecipe } from '@de-braighter/board-recipes'` and get a typed `EditorRecipe` with no JSON-loader config of their own.)
- `src/board-recipes.spec.ts` — two guards:
  - **Schema guard:** `validateRecipe(kfDrillRecipe)` returns no errors (the published board-kit validator).
  - **Round-trip guard:** `deepEqual(JSON.parse(JSON.stringify(kfDrillRecipe)), kfDrillRecipe)` — proves the data is JSON-lossless (no `undefined` / `NaN` / functions leaked).
- `package.json` — `@de-braighter/board-recipes`, `peerDependencies`/`dependencies` on `@de-braighter/design-system-core@^2.8.0`, `publishConfig.registry = https://npm.pkg.github.com`, `files` includes the bundle + `.d.ts` + `kf-drill.recipe.json`, `exports` map (`.` → types + default), `sideEffects: false`.
- Nx project wiring (`project.json` build/test/lint targets, tags) following the design-system repo's lib conventions.

**How the JSON is produced (one-time generation, parity-safe).** The JSON is generated by serializing the **already-byte-parity-proven** `kfDrillRecipe` object from exercir#320 — not hand-typed. A throwaway generator (run once, not committed as a build step):

1. imports the current `kfDrillRecipe` TS object;
2. asserts JSON-safety (`deepEqual(JSON.parse(JSON.stringify(obj)), obj)`);
3. writes `JSON.stringify(obj, null, 2)` to `src/kf-drill.recipe.json`.

The fully-expanded JSON drops the TS authoring helpers (`round2`, `ATAN`, `playerLikeShape`, `arrowShape`) — expected and acceptable: those were DRY *authoring* sugar over a plain object, and the studio GUI (not hand-editing) is the intended future authoring path. Because the JSON derives from the proven object and round-trips losslessly, exercir's parity gate re-proves the published artifact with no new oracle.

**Publish:** `@de-braighter/board-recipes@1.0.0` → GitHub Packages (main session). Then add `@de-braighter/board-recipes@1.0.0` to the `minimumReleaseAge` allowlist where each consumer enforces one (studio's pnpm `minimumReleaseAgeExclude`; exercir per its npm config) and reinstall.

## 5. SP2 — exercir de-fork (`domains/exercir/.../board-kit/kf-registry.ts`)

- Add dependency `@de-braighter/board-recipes@^1.0.0`; allowlist + reinstall.
- Replace `import { kfDrillRecipe } from './kf-drill.recipe.js'` → `import { kfDrillRecipe } from '@de-braighter/board-recipes'`.
- **Delete** `kf-drill.recipe.ts`.
- `makeKidsRegistry(translate)` body unchanged (`interpretRecipe(kfDrillRecipe, { translate })`); `KfSketcherComponent` and the public surface of `kf-registry.ts` unchanged.
- **Keep `parity-legacy/` and `kf-registry-parity.spec.ts`** — the 26/26 byte-parity gate now proves the *published* recipe matches the pinned legacy oracle. This is the critical regression guard; it must stay green.
- Update `kf-registry.spec.ts` only if it imported the local recipe path.
- **Browser-verify** the live drill editor (`drills/new`, `drills/:id`) across the club-grass skin: identical render, 0 console errors, keyboard move/resize/reshape/delete intact.

## 6. SP3 — studio de-fork (`domains/studio/libs/board-editor/src/lib/cookbook/`)

- Add dependency `@de-braighter/board-recipes@^1.0.0`; allowlist + reinstall.
- Replace the cookbook's `kidsDrillRecipe` with `kfDrillRecipe` imported from `@de-braighter/board-recipes`, updating:
  - `index.ts` — re-export `kfDrillRecipe` from the package (or stop re-exporting the local recipe).
  - `kids-drill-showcase.ts` — `interpretRecipe(kfDrillRecipe, { translate: cookbookTranslate })`.
  - `kids-drill.recipe.spec.ts` — the fidelity spec asserts the **published** recipe interprets correctly (identity/echo `translate`); it no longer owns the recipe data.
- **Delete** `kids-drill.recipe.ts`.
- `cookbook-translate.ts` (the demo `{i18n}` stub) is unchanged — the package ships data only; each consumer injects its own translate.
- **Browser-verify** the Cookbook gallery worked-example thumbnail (night / ivory / clinical) renders unchanged.

## 7. Acceptance criteria (the headline)

1. **No second copy.** Both `kf-drill.recipe.ts` (exercir) and `kids-drill.recipe.ts` (studio) are deleted; both consumers import `kfDrillRecipe` from `@de-braighter/board-recipes`.
2. **Byte-parity preserved.** exercir's `kf-registry-parity.spec.ts` is green (26/26) against the published recipe.
3. **Zero engine/kernel change.** `@de-braighter/design-system-core` and the substrate kernel are untouched; the new package only *consumes* the `EditorRecipe` type. ADR-176-safe.
4. **Both surfaces verified live.** exercir drill editor + studio cookbook thumbnail render identically to pre-change.

## 8. ADR (SP1, designer-first)

A short ADR in `layers/specs/adr/` recording the new convention:

- **Decision:** portable board-kit recipes are distributed as a dedicated **content layer** (`@de-braighter/board-recipes`), shipped as JSON data with a typed loader, consumed by domains as a published `@de-braighter/*` package — not duplicated as in-domain `.ts` literals and not embedded in the `design-system-core` engine.
- **Why a layer, not a domain:** the cluster rule forbids domain↔domain consumption; a shared artifact must be a layer. The engine package stays domain-agnostic (ADR-168), so concrete recipes live in a content package beside it.
- **ADR-176 posture:** no kernel impact — board-kit is a brick that composes; recipes are data the brick interprets. The four kernel concerns are untouched.
- **Boundaries:** `board-recipes` depends only on `design-system-core` (type); no Angular, no NestJS, no domain code. No cycles (`board-recipes` is a leaf atop `core`; domains depend on both).

## 9. Testing & verification

- **SP1:** the schema guard + round-trip guard specs (§4); `ci:local` build/test/lint of the new package green; the published package is Node-ESM-resolvable.
- **SP2:** the existing 26/26 byte-parity gate green against the published recipe; a11y unchanged (WCAG 2.4.3 / 2.5.7 keyboard / 2.5.8 target size on handles); browser proof.
- **SP3:** the fidelity spec green against the published recipe; existing cookbook specs (`kids-drill-showcase.spec.ts`, gallery) green; browser proof.
- Every non-trivial PR: verifier wave (`local-ci` + `reviewer` + `qa-engineer` + `charter-checker`; `exercir-charter-checker` on SP2) with `isolation: "worktree"`.

## 10. Execution

- **Vehicle:** subagent-driven execution; founder granted blanket auto-approve + auto-merge at all levels (standing grant; reaffirmed 2026-06-26).
- **Order:** SP1 ADR → SP1 impl → SP1 publish (main session, founder-gated) → SP2 ∥ SP3.
- **Twin ritual** (`npm run ritual:post-merge -- <owner/repo#pr>`) after every merge; `Producer:` / `Effort:` / `Effect:` lines on each PR body (declare self-observing `cycle-time` / `findings` on cross-repo PRs; pair with `Producer:`).
- **Hygiene:** the workbench carries untracked WIP — never `git add -A`; explicit paths only. Wave agents use `isolation: "worktree"` and must not run git ops in shared clones ([[wave-agents-stash-main-clone-incident]]).

## 11. Open items to verify during impl

1. **JSON-safety confirmation** — run the generator's `deepEqual(JSON.parse(JSON.stringify(obj)), obj)` assertion on the real `kfDrillRecipe`; if any non-JSON value surfaces (it should not — the object is strings/numbers/objects/arrays/booleans), resolve before emitting the JSON.
2. **JSON-import emit** — confirm the design-system repo's lib bundler inlines `import … with { type: 'json' }` into the FESM bundle and ships the raw `.json`; adjust the loader to the toolchain if import-assertions aren't supported (fallback: emit a `.ts` that holds the object literal alongside the shipped `.json`, with a spec asserting they are equal).
3. **`minimumReleaseAge` allowlist** — add `@de-braighter/board-recipes@1.0.0` to studio's pnpm exclude and exercir's equivalent, then reinstall, after the publish.
4. **Re-export surface in studio `index.ts`** — decide whether the cookbook barrel re-exports `kfDrillRecipe` from the package or consumers import it directly (keep the public surface of the cookbook barrel stable for the gallery).
