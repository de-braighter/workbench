# Drill-board recipe — single published source — design

- **Date:** 2026-06-26
- **Status:** approved (founder, brainstorm session)
- **Owner repos:** **NEW** `de-braighter/board-recipes` (SP1 — standalone layer repo, cloned at `layers/board-recipes`) · `layers/specs` (ADR) · `domains/exercir` (SP2) · `domains/studio` (SP3)
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

1. **Home — a NEW dedicated standalone layer repo `de-braighter/board-recipes`** (cloned as a sibling under `layers/board-recipes`, gitignored in the workbench like every other layer repo), published as `@de-braighter/board-recipes`. **Not** an export of `design-system-core`, and **not** a lib inside the `design-system` repo. Rationale: `design-system-core` is the board-kit **engine** and ships zero recipe data on purpose (ADR-168 — bricks are domain-agnostic, packs consume them); and the `design-system` repo's own governance actively forbids domain content (`check-lib-conformance.mjs` allows only `type:{core,ui,css}` + an `api-check`; its `CLAUDE.md` says "Don't add domain logic. Domain content lives in `domains/*`" and "cores stay domain-agnostic"). A `kf.*` recipe is domain-flavored content by those rules. A standalone content-layer repo keeps the design-system layer pure, gives recipe content its own semver, and future-proofs a growing catalog (the studio's whole purpose is authoring more recipes). Cost accepted: a new GitHub repo + minimal local build/publish + clone wiring (remote GHA is billing-blocked → local gate only).
2. **Format — JSON asset.** The canonical committed source is `kf-drill.recipe.json` (pure data). It is the literal "boards are data" artifact and the exact payload a future store (b) can hold unchanged. A thin typed wrapper re-exports it so consumers still get an ergonomic typed import.
3. **ADR — kept.** A short ADR records the new convention (portable board recipes live in a dedicated content layer, shipped as JSON). New published package + new cluster-structure pattern ⇒ designer-first.
4. **Canonical export name — `kfDrillRecipe`** everywhere (exercir keeps its name; studio renames from `kidsDrillRecipe`).

## 3. Architecture — three sub-projects, strict order

```
SP1  NEW repo de-braighter/board-recipes (clone at layers/board-recipes)  ── ADR → impl → PUBLISH @1.0.0
        │  ships: src/kf-drill.recipe.json (canonical data) + src/index.ts (typed loader → export const kfDrillRecipe)
        │  depends on @de-braighter/design-system-core (^2.8.0) for the EditorRecipe type ONLY
        ├──────────────► SP2  domains/exercir — kf-registry + kf-registry.spec import the published recipe;
        │                                       DELETE kf-drill.recipe.ts; 26/26 byte-parity gate stays green
        └──────────────► SP3  domains/studio  — cookbook (showcase + barrel + fidelity spec) import the published recipe;
                                                DELETE kids-drill.recipe.ts; rename kidsDrillRecipe → kfDrillRecipe
```

- **SP1 carries the risk** (a brand-new published layer package + the JSON-asset distribution pattern). Designer-first: the ADR precedes the package code.
- **SP2 and SP3 consume the *published* package** (no `file:` links — cluster rule), so SP1 must publish first. The publish is done **in the main session** — npm publish is classifier/founder-gated; a subagent cannot get it authorized by relay (same as core@2.8.0). SP2 and SP3 are then independent and may run in parallel.
- **Parity invariant** (SP2): the published recipe, interpreted, must produce byte-identical `draw()` / `bounds()` / `describe()` / edit results to the pinned legacy oracle in exercir's `parity-legacy/` — the same gate `kf-registry-parity.spec.ts` already enforces. Only the recipe *source* changes; the gate is unchanged.

## 4. SP1 — the new repo `de-braighter/board-recipes` (clone at `layers/board-recipes/`)

A **minimal standalone TS package** — plain npm + `tsc` + `vitest`, **no nx, no Angular, no ng-packagr**, so it sidesteps the design-system repo's lib-conformance entirely. It builds to ESM `dist/` + `.d.ts` and ships the raw `.json` (honours the Node-ESM packaging lesson [[design-system-node-esm-packaging]]: ESM, extensionless-safe, `.json` resolvable next to `index.js`).

**Files (repo root + `src/`)**

- `package.json` — `@de-braighter/board-recipes`, `type: module`, `main`/`module`/`types` → `./dist/index.js` + `./dist/index.d.ts`, `exports` map (`.` → types + default; `./kf-drill.recipe.json` → the raw asset), `files: ["dist"]`, `sideEffects: false`, `peerDependencies` + `devDependencies` on `@de-braighter/design-system-core@^2.8.0`, `publishConfig.registry = https://npm.pkg.github.com` + `access: restricted`, scripts: `build` (`tsc -p tsconfig.json && node scripts/copy-assets.mjs`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`), `ci:local` (`npm run build && npm run typecheck && npm test`).
- `tsconfig.json` — `target es2022`, `module nodenext`, `moduleResolution nodenext`, `declaration true`, `resolveJsonModule true`, `strict true`, `outDir dist`, `rootDir src`, `include ["src/**/*.ts"]`, `exclude ["**/*.spec.ts"]`.
- `.npmrc` — `@de-braighter:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}` + `always-auth=true` (verbatim from exercir's `.npmrc`).
- `.gitignore` — `node_modules`, `dist`.
- `README.md` — one paragraph: what the package is (portable board-kit recipe catalog, data-only), why it's a standalone content layer, how to consume.
- `scripts/copy-assets.mjs` — copies `src/*.json` → `dist/` (so `dist/index.js`'s JSON import resolves at consume time).
- `src/kf-drill.recipe.json` — the canonical recipe **data** (the fully-expanded `EditorRecipe` object as JSON; 719 lines, pre-generated and verified JSON-lossless — see below).
- `src/index.ts` — the typed loader:
  ```ts
  import type { EditorRecipe } from '@de-braighter/design-system-core';
  import kfDrill from './kf-drill.recipe.json' with { type: 'json' };
  // Cast through unknown: the JSON's inferred literal type is narrower/wider than
  // EditorRecipe in places (e.g. p:'rect' inferred as string); runtime correctness
  // is guarded by validateRecipe in the spec, so the value-level cast is safe.
  export const kfDrillRecipe = kfDrill as unknown as EditorRecipe;
  ```
  Contract: consumers `import { kfDrillRecipe } from '@de-braighter/board-recipes'` and get a typed `EditorRecipe` with no JSON-loader config of their own.
- `src/index.spec.ts` — two guards (vitest):
  - **Schema guard:** `expect(validateRecipe(kfDrillRecipe)).toEqual([])` (the published board-kit validator).
  - **Round-trip guard:** `expect(JSON.parse(JSON.stringify(kfDrillRecipe))).toEqual(kfDrillRecipe)` — proves the data is JSON-lossless (no `undefined` / `NaN` / functions leaked).

**Contingency (JSON-import emit).** If `tsc` under `module: nodenext` does not emit the `import … with { type: 'json' }` attribute cleanly for Node ESM, the fallback (concrete, no behavior change): keep `src/kf-drill.recipe.json` as the shipped asset, but have `src/index.ts` hold the recipe as a TS object literal (generated from the same JSON), with `src/index.spec.ts` adding a third guard asserting `expect(kfDrillRecipe).toEqual(<the parsed json>)`. The `.json` stays the canonical artifact; the literal is a build convenience. Decide by running `npm run build` + a Node ESM import smoke-test before consuming.

**How the JSON was produced (parity-safe).** The JSON is the serialization of the **already-byte-parity-proven** `kfDrillRecipe` object from exercir#320 — not hand-typed. It was generated in the planning session by Node type-stripping the canonical `kf-drill.recipe.ts` from `exercir origin/main` and `JSON.stringify(obj, null, 2)`-ing it, asserting `JSON.parse(JSON.stringify(obj))` deep-equals `obj` (passed: 719 lines, 16687 chars, JSON-lossless). The plan ships this exact file. The fully-expanded JSON drops the TS authoring helpers (`round2`, `ATAN`, `playerLikeShape`, `arrowShape`) — expected: those were DRY *authoring* sugar over a plain object, and the studio GUI (not hand-editing) is the future authoring path. Because the JSON derives from the proven object and round-trips losslessly, exercir's parity gate re-proves the published artifact with no new oracle.

**Repo creation + publish (main session, founder-gated).** `gh repo create de-braighter/board-recipes`, push, then `npm publish` → `@de-braighter/board-recipes@1.0.0` on GitHub Packages — done in the main session (repo-create + publish are credential/founder-gated; a subagent cannot get them authorized by relay, same as core@2.8.0). Then add `@de-braighter/board-recipes@1.0.0` to studio's pnpm `minimumReleaseAgeExclude` and reinstall; exercir uses npm (no release-age gate) → just install.

## 5. SP2 — exercir de-fork (`domains/exercir/.../board-kit/kf-registry.ts`)

- Add dependency `@de-braighter/board-recipes@^1.0.0`; allowlist + reinstall.
- Replace `import { kfDrillRecipe } from './kf-drill.recipe.js'` → `import { kfDrillRecipe } from '@de-braighter/board-recipes'`.
- **Delete** `kf-drill.recipe.ts`.
- `makeKidsRegistry(translate)` body unchanged (`interpretRecipe(kfDrillRecipe, { translate })`); `KfSketcherComponent` and the public surface of `kf-registry.ts` unchanged.
- **Keep `parity-legacy/` and `kf-registry-parity.spec.ts`** — the 26/26 byte-parity gate now proves the *published* recipe matches the pinned legacy oracle. This is the critical regression guard; it must stay green.
- Update `kf-registry.spec.ts` — it imports `kfDrillRecipe` directly (`import { kfDrillRecipe } from './kf-drill.recipe.js'`, used in `validateRecipe(kfDrillRecipe)`); redirect that import to `@de-braighter/board-recipes`.
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

- **Decision:** portable board-kit recipes are distributed as a dedicated **content-layer repo** (`de-braighter/board-recipes` → `@de-braighter/board-recipes`), shipped as JSON data with a typed loader, consumed by domains as a published `@de-braighter/*` package — not duplicated as in-domain `.ts` literals, not embedded in the `design-system-core` engine, and not placed inside the `design-system` repo (whose conformance + CLAUDE.md forbid domain content).
- **Why a standalone layer repo, not a domain and not a design-system lib:** the cluster rule forbids domain↔domain consumption, so a shared artifact must be a layer; and the design-system layer is governed domain-agnostic (ADR-168 + its lib-conformance `type:{core,ui,css}` + "no domain content" CLAUDE.md rule), so domain-flavored recipe content gets its own content-layer repo rather than diluting the engine's home.
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

1. **JSON-safety** — ✅ confirmed in the planning session: `JSON.parse(JSON.stringify(kfDrillRecipe))` deep-equals the canonical object (719 lines, 16687 chars, lossless). The repo's `src/index.spec.ts` round-trip guard re-asserts it permanently.
2. **JSON-import emit** — run `npm run build` + a Node ESM import smoke-test in the new repo to confirm `tsc` (`module: nodenext`, `resolveJsonModule`) emits `import … with { type: 'json' }` cleanly and `dist/kf-drill.recipe.json` is copied; if not, apply the §4 contingency (TS object literal + `.json` asset + equality guard).
3. **`minimumReleaseAge` allowlist** — add `@de-braighter/board-recipes@1.0.0` to studio's pnpm `minimumReleaseAgeExclude` and reinstall after publish; exercir uses npm (no age gate) → just install.
4. **Re-export surface in studio `index.ts`** — keep the cookbook barrel re-exporting under the canonical name (`export { kfDrillRecipe } from '@de-braighter/board-recipes'`) and update every `kidsDrillRecipe` reference in studio to `kfDrillRecipe` (grep-driven) so the gallery + showcase + fidelity spec stay green.
5. **Cluster wiring** — clone `de-braighter/board-recipes` at `layers/board-recipes` (gitignored sibling); register it in any cluster manifest the workbench-doctor checks for manifest-vs-disk drift, if one tracks layer repos.
