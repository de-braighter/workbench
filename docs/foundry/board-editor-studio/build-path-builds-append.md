---
product_key: board-editor-studio
build_path_date: 2026-06-25
status: build-path
charter: docs/foundry/board-editor-studio/charter.md
risk_tier: T0
item_count: 4
slice: builds-append (A/C/L build items — after the A1/C1/L1 design gates cleared + G2/S2/P1 built)
---

# Build Path — Board Editor Studio · Build items append (A2 / C2 / C3 / L-a)

Follow-up `/build-path` after the design wave (A1/C1/L1) merged and the first build chain
(G2→S2→P1) landed. Pushes the remaining feature BUILD items; decompositions taken verbatim from
the merged design docs (`docs/autosnap-grid/autosnap-grid-design.md` §7, `docs/cookbook/cookbook-design.md`
§3, `docs/connectors/connectors-design.md` §10). All T0, studio-local, ZERO kernel/brick change.

## Work items

| itemId | title (summary — full spec in the cited design doc) | scope (repo=studio) | dependsOn | lane | qualityObligations |
| --- | --- | --- | --- | --- | --- |
| `A2` | BUILD autosnap-to-grid per A1 design: `gridSize`+`autosnap` on the root-group Defaults; per-shape `snap.toGrid` opt-out on `GroupPart` (the `SnapConfig` home G2 shipped); pure `snapPoint` (round-to-nearest, g≤0 guard, idempotent, position-only); `onCommit` rounds the move intent before writing authored x/y; grid-dot render driven by `gridSize` via `--grid-dot`; grid DIMS when autosnap off; default `gridSize=20`. Resolve free-vs-tree layout + board-space↔placement-offset mapping (A1 §2.2/§4.1). Parity spec green; browser-verify each skin. | `libs/board-editor` | `P1` | autosnap | tdd, review-floor, opus-whole-branch, parity-proof, a11y-focus-recovery, browser-verify |
| `C2` | BUILD app-shell Cookbook gallery + routing + manage per cookbook §3: app shell with gallery route `/` + editor route `/recipe/:id`,`/recipe/new`; card grid over `CATALOG_STORE.list()` (name + `thumbnailSvg`-or-placeholder + open/rename/delete + New-recipe card + empty state); drive editor via public `openCatalog(id)`/`newCatalog()`; recipe/cookbook user-facing vocab; supersede the top-bar pill. ZERO lib edit. Runs PARALLEL to the lib chain. | `apps/board-editor-ui` | — | cookbook | tdd, review-floor, opus-whole-branch, a11y-focus-recovery, browser-verify |
| `C3` | BUILD thumbnail-on-save lib seam per cookbook §3: on `saveCatalog`, render the recipe to a static SVG snapshot (reuse the P1 thumbnail renderer / `buildRecipeFromCatalog`→`interpretRecipe` lowering at board scope) and persist as `StoredCatalog.thumbnailSvg`; bump stored-record schema to `version:2` with back-compat read of v1. `EditorRecipe`/live-preview byte-identical (parity). No new public export. | `libs/board-editor` | `A2` | cookbook | tdd, review-floor, opus-whole-branch, parity-proof, browser-verify |
| `L-a` | BUILD connectors Slice-L-a (studio-local) per connectors §10: connectors as additive read-only line/arrow `RecipeShape`s; per-edge anchors (4 midpoints default, corners optional) + pixel-snap fallback (absolute offset); per-compose-shape anchor/snap config EXTENDING the canonical `SnapConfig` on `GroupPart` (`toGrid` from A2; add anchor fields — one home); `CatalogModel.connectors`; snap-on-commit; reflow-at-recipe-rebuild (on-commit re-attach; in-brick-drag staleness is the documented Slice-L-b gap). Parity: empty `connectors` ⇒ `EditorRecipe` byte-identical. ZERO brick change. Slice-L-b (brick binding/live reflow) is a SEPARATE `de-braighter/design-system` item behind a founder architecture gate + publish — NOT pushed here. | `libs/board-editor` | `C3` | connectors | tdd, review-floor, opus-whole-branch, parity-proof, a11y-focus-recovery, browser-verify |

## Disjointness proof

The `libs/board-editor` items are **linearized**: `P1`(done) → `A2` → `C3` → `L-a` (each `dependsOn`
the prior ⇒ ordered, never co-claimed). `C2` (`apps/board-editor-ui`) is disjoint from every lib item
by non-nested path ⇒ runs **parallel** (the cookbook "parallel win").

| Unordered pair | Evidence | Verdict |
| --- | --- | --- |
| C2 vs A2 | `apps/board-editor-ui` vs `libs/board-editor` — neither a prefix | disjoint |
| C2 vs C3 | `apps/board-editor-ui` vs `libs/board-editor` | disjoint |
| C2 vs L-a | `apps/board-editor-ui` vs `libs/board-editor` | disjoint |
| A2 / C3 / L-a (pairwise) | all `libs/board-editor`, but linearly ordered via `dependsOn` | ordered — never co-claimed |

`dependsOn` closure: `A2→P1` (done), `C3→A2` (this push), `L-a→C3` (this push), `C2→`none. No
dangling ids. No ADR/cross-repo items in this push (Slice-L-b is deferred to its own design-system
item + architecture gate). On push, `A2` + `C2` are both immediately claimable (disjoint) → the
conductor fans them out in parallel; `C3` unblocks when `A2` merges, `L-a` when `C3` merges.
