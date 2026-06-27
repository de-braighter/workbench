---
product_key: board-editor-studio
build_path_date: 2026-06-25
status: build-path
charter: docs/foundry/board-editor-studio/charter.md
risk_tier: T0
item_count: 1
slice: cookbook (append — design only; build items appended after the C1 gate)
---

# Build Path — Board Editor Studio · Cookbook (append slice)

**Append** to the existing `board-editor-studio` product. Adds the first item of a new epic,
**`C` — Cookbook**: a founder-gated **design** item (`C1`). The **build** items are intentionally
NOT pushed yet — the build decomposition depends on how `C1` resolves the thumbnail seam (below), so
they are appended via a follow-up `/build-path` once `C1` clears the design gate.

> Why this slice exists (founder, 2026-06-25): *"With those changes we should have all in place to
> let it manage multiple recipes — a cookbook that collects them. We could start with a page of cards
> with a card per recipe."* The pieces largely exist: E8.1 shipped a full multi-recipe store
> (`LocalStorageCatalogStore`: list/save/load/rename/delete), but it's buried in a cramped top-bar
> "catalog" pill popover. The **cookbook = that store promoted into a first-class page**: a grid of
> cards, one per saved recipe, with open/new/rename/delete and a **live recipe thumbnail**.

**Altitude ladder this completes** (each rung is something we're already building):

```
Cookbook   ← collection of recipes   (NEW — this epic; promotes the hidden pill)
  └ Recipe ← one board editor         (today's "catalog"; what the editor edits)
      └ Group   ← composition         (G-slice: node = root group)
          └ Primitive / svg           (P-slice renders them for real)
```

Founder decisions (2026-06-25): first slice = **gallery WITH live recipe thumbnails** + manage +
routing; **build to run in parallel** with the `G/S/P` chain wherever physically possible.

## The decisive design problem (C1 must resolve)

`libs/board-editor/src/public-api.ts` exports exactly THREE symbols (`CatalogDesignerComponent`,
`CATALOG_STORE`, `LocalStorageCatalogStore`). Consequences C1 must design against:

- **Gallery + routing + manage** is achievable **app-side, parallel, zero lib edit**: consume
  `CATALOG_STORE` (list/save/rename/delete) and drive the editor via its existing **public**
  `openCatalog(id)` / `newCatalog()` from an app wrapper component (the app currently routes `/`
  straight to the editor; the design introduces an app shell with a gallery route + an editor route
  that hosts `<studio-catalog-designer>` and calls `openCatalog` after navigation).
- **Live recipe thumbnails** need to turn a *saved* recipe into a render. Today that path
  (`deserializeCatalogWithReport` → `buildRecipeFromCatalog` → `interpretRecipe` → `<ds-board-kit>`)
  is lib-internal except `interpretRecipe` (published in `@de-braighter/design-system-core`). So
  thumbnails require a **thin lib affordance**, and `libs/board-editor` is serialized by the
  `G2→S2→P1` chain → a lib change there cannot be parallel.

**C1 must pick the thinnest thumbnail approach and define the build decomposition + sequencing:**
candidate approaches —
1. **Stored thumbnail SVG (recommended to evaluate first):** the editor renders + writes a small SVG
   snapshot into each saved record on `saveCatalog`; the cookbook is **pure-display** (reads the
   stored SVG via `CATALOG_STORE`). Lib touch = the editor's save + the stored-record schema
   (sequences into the chain), but the cookbook gallery stays app-side/parallel and lights up
   thumbnails as records gain snapshots.
2. **Additive public exports:** export `buildRecipeFromCatalog` + deserialize + types; the app
   renders thumbnails itself. Lib touch = `public-api.ts` (additive) — still inside the chained lib.
3. **A lib thumbnail component/function** (`renderRecipeThumbnail`) — same chained-lib constraint.

C1 decides which, names the resulting build items (likely: `C2` = app-shell gallery+routing+manage,
app-scoped/parallel; plus a thin lib-seam item sequenced into the `libs/board-editor` chain that the
thumbnail wiring depends on), and states each item's scope + dependsOn so the follow-up push is
clean and the disjointness proof holds.

## Other C1 decisions

- **Vocabulary reconciliation:** user-facing language = **recipe / cookbook**; the internal model
  name (`catalog`) may stay. Define the mapping so copy + routes read "recipe"/"cookbook" while the
  store/types keep their names (low-risk).
- **Supersede the pill popover:** the cookbook page replaces the hidden top-bar "catalog" popover as
  the primary save/load/manage surface; decide what (if anything) the top bar keeps.
- **Gallery IA:** the card (name + live thumbnail + open + rename/delete + "new recipe" card), empty
  state, and the gallery↔editor routing/back affordance — rendered to fit all three skins
  (night/ivory/clinical) with canonical tokens (no skin literals). Produce a **visual design source**.
- **a11y:** card grid semantics, the "new recipe" affordance, focus handling on delete (the same
  WCAG-2.4.3 recovery pattern used elsewhere), thumbnail decorative + recipe name announced.

## ADR needs & gates

**None.** T0, studio-local, zero kernel/brick change. Gate = the founder-gated merge of the `C1`
design PR (doubles as the design gate; the build items are pushed only after it).

## Quality battery config

| Obligation | Applies to |
| --- | --- |
| `review-floor` | C1 |
| `md-quality` | C1 (design doc) |

`C1` is DESIGN-ONLY (no tdd/parity/browser-verify). Build-item obligations (tdd, review-floor,
opus-whole-branch, parity-proof where lib-touching, a11y, browser-verify) land on the build items in
the follow-up push.

## Lanes & parallelism

`C1` (design, no deps) runs in PARALLEL with `G1` + `S1` (all docs-scoped, mutually disjoint). Max
design width now: 3 (`G1` + `S1` + `C1`). The cookbook BUILD will be split so its app-shell portion
runs parallel to the `G2→S2→P1` lib chain; only the thumbnail lib-seam sequences into that chain.

## Work items

| itemId | title | scope (repo=studio) | dependsOn | lane | qualityObligations |
| --- | --- | --- | --- | --- | --- |
| `board-editor-studio/C1` | DESIGN-ONLY (founder-gated): design the "Cookbook" — a first-class page collecting multiple recipes, promoting the hidden E8.1 catalog-store pill popover into a gallery of cards (one per saved recipe) with name + LIVE recipe thumbnail + open/new/rename/delete + gallery↔editor routing. RESOLVE the thumbnail seam: the lib exports only 3 symbols, so rendering a saved recipe needs a thin lib affordance and libs/board-editor is locked by the G2→S2→P1 chain — pick the thinnest approach (evaluate stored-thumbnail-SVG-on-save first, vs additive exports, vs a lib thumbnail helper) and DEFINE the build decomposition + per-item scope/dependsOn so the app-shell gallery builds in PARALLEL (apps/board-editor-ui) and only the thumbnail lib-seam sequences into the chain. Also resolve: recipe/cookbook vocab vs internal 'catalog'; supersede the pill; gallery IA + a11y. Produce a design spec + a visual design source. NO code. Output to domains/studio docs/cookbook/. The founder-gated merge IS the design gate; build items are appended after it. Studio-only, ZERO kernel/brick change. | `pathPrefix: docs/cookbook` | — | cookbook | review-floor, md-quality |

## Disjointness proof

`repo: studio`, scope `docs/cookbook`. No deps → claimable now. Unordered pairs needing proof
(against currently active/queued items):

| Pair | Evidence | Verdict |
| --- | --- | --- |
| C1 vs G1 | `docs/cookbook` vs `docs/groups-merge` — neither a prefix | disjoint |
| C1 vs S1 | `docs/cookbook` vs `docs/board-settings-clarity` | disjoint |
| C1 vs G2 / S2 / P1 | `docs/cookbook` vs `libs/board-editor` | disjoint |

No dangling deps (none declared). No cross-repo / ADR items. Three docs-scoped designers
(`G1`/`S1`/`C1`) are mutually disjoint and run in parallel.
