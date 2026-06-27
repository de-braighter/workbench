---
product_key: board-editor-studio
build_path_date: 2026-06-25
status: build-path
charter: docs/foundry/board-editor-studio/charter.md
risk_tier: T0
item_count: 2
slice: groups-merge (append)
---

# Build Path — Board Editor Studio · "Groups" unification (append slice)

**Append** to the existing `board-editor-studio` product (16 items done; standalone +
3-skin + (3)-IA rebuild arc closed). This slice does NOT re-push any prior item
(`E1.1`–`E8.1`, `R1a`–`R4`). It adds ONE epic, **`G` — Groups unification**, decomposed
into two ordered items: a founder-gated **design** item (`G1`) and the **build** that
depends on it (`G2`).

> Why this slice exists (the founder's observation, confirmed in code): "Node layers" and
> "Composites" are the **same underlying concept** modelled twice. `Instance` (a node layer)
> is structurally `CompositePart` (a composite part) **plus** the drawn-node extras
> (`instanceKind`, `bounds`, `svgTokens`). The node IS the special, drawn, non-reusable **root
> group**; a composite is a named, reusable, nestable group of the same shape. The studio
> carries two parallel models (`catalog.layers` vs `CompositeDefinition.parts`) and two parallel
> row-editors (`instance-row.component.ts` vs `composite-parts-editor.component.ts`) for it.
> Founder decision (2026-06-25): **full merge into one "Groups" concept** (IA + model + editor),
> conducted **design-first** (spec → founder gate → build).

## Scope reminder (charter authority)

- **Tier:** T0 (prototype / internal dev tool). Blast radius contained to `domains/studio`.
- **Cluster governance override:** every **merge-to-main is founder-gated**; review floor (≥1
  `/code-review`) on every PR + full verifier wave on non-trivial PRs.
- **ZERO kernel / `design-system` brick change.** `EditorRecipe` / `interpretRecipe` /
  `validateRecipe` are consumed as-is. The model (`catalog.ts`), expander
  (`buildRecipeFromCatalog`), serializer (`catalog-document.ts`), shell + editors all live in
  `libs/board-editor` (studio-local) — the merge is entirely studio-side. An apparent need for a
  brick change is a charter smell to surface, not to build.
- **The (3) hard lesson, encoded:** a full IA merge is a **layout/IA redesign**, not a reskin.
  `G1` MUST produce a concrete **design source** (visual mockup) the founder reviews at the gate;
  `G2` MUST **build from that design source** and **browser-verify each rendered view against it**
  per skin (night / ivory / clinical). "The same components exist" ≠ "the same layout."

## Scaffold plan

No `/new-domain`. Extends the shipped `domains/studio` lib `@de-braighter/board-editor`
(`libs/board-editor`) + its standalone host `apps/board-editor-ui`. `npm` in apps; the lib is an
ng-packagr workspace package built via `pnpm --filter @de-braighter/board-editor run build`. No
port pair (UI lib + standalone app; no api/db tier).

## Epic ladder

- **G1 — Groups-unification design** (DESIGN-ONLY, sequencing, founder-gated). Deliverable: a
  design spec + a **visual design source** (HTML/annotated mockup) for the full "Groups" merge.
  Acceptance: the spec resolves all five decisions below and the founder approves the design source
  (the founder-gated merge of the design PR IS the design gate).
- **G2 — Groups-unification build** (depends on G1). Deliverable: the implemented unified model +
  single shared group-editor + the merged "Groups" IA, behind a green parity proof. Acceptance:
  `EditorRecipe` output is byte-identical (parity spec green), every skin/view browser-verified
  against the G1 design source, `npm test` + lib `build` green.

The slice is **done** when a user authors the root node group AND a reusable group through **one**
editor under **one** "Groups" rail concept, the live preview is unchanged (parity), and all three
skins render the merged IA without regression.

### The five decisions G1 must resolve (and G2 implements)

1. **Unified model.** Collapse `Instance` + `CompositePart` into one part shape and `catalog.layers`
   + `CompositeDefinition.parts` into one **`Group`** type. The node becomes the distinguished
   **root group** (drawn → carries `bounds` / `instanceKind`; non-reusable); reusable groups are
   named + nestable (keep the `wouldCycle` DAG guard). Decide the exact `CatalogModel` shape
   (e.g. `{ definitions, groups, rootGroupId }` vs root-group-in-`definitions` + a marker).
2. **Single shared group-editor component.** One component replacing `InstanceRowComponent` +
   `CompositePartsEditorComponent` — edits a list of parts (defId ref + x/y offset + reorder/
   delete), parameterized for root-vs-reusable (root adds bounds/kind affordances). Define its
   public API (inputs/outputs) so both the rail's root-group view and the per-group drawer use it.
3. **IA / rail redesign.** How "Build › Node layers" + "Compose › Composites" merge into one
   **"Groups"** rail concept (root group pinned + drawn; reusable groups listed). Primitives
   section unchanged. This is the part requiring the visual design source.
4. **Serialized-catalog back-compat.** `catalog-document.ts` `serializeCatalog` /
   `deserializeCatalogWithReport` migrate old `{ definitions, layers }` documents (incl.
   localStorage-saved catalogs from E8.1) to the new shape on load — a versioned migration so
   existing saved catalogs still open (dropped-refs reporting preserved).
5. **Parity preservation.** `buildRecipeFromCatalog` keeps producing byte-identical `EditorRecipe`
   output; `catalog-parity.spec.ts` (+ any plan-kinds parity proof) stays green through the merge.

## UI-surface plan

| Surface | Verdict | Item |
| --- | --- | --- |
| Catalog IDE shell rail (Build/Compose merge → "Groups") | **in** | G1 (design) → G2 (build) |
| Shared group-editor (replaces instance-row + composite-parts-editor) | **in** | G1 (design) → G2 (build) |
| Live preview / code view / persistence popover | **unchanged** (parity) | — |
| Primitives section (rect/text/circle/line/svg/path libraries) | **unchanged** | — |

The merged IA must be browser-verified against the G1 design source on each skin
(`night` / `ivory` / `clinical`) per the `browser-verify` obligation.

## ADR needs & gates

**None.** T0, studio-local, zero kernel / brick change (composes-not-authors, ADR-176-safe). No
ADR-authoring items. The only gate is the per-item **founder-gated merge** (cluster governance) —
on `G1` it doubles as the **design gate** (founder approves the design source before `G2` is
claimable, structurally enforced by `G2 dependsOn G1`).

## Quality battery config

board-editor-studio T0 floor (per the arc's standing quality floor):

| Obligation | Applies to |
| --- | --- |
| `review-floor` | G1, G2 |
| `md-quality` | G1 (design spec doc) |
| `tdd` | G2 |
| `opus-whole-branch` | G2 (non-negotiable — caught a real regression on EVERY board-editor-studio slice) |
| `parity-proof` | G2 (`EditorRecipe` output byte-identical; parity spec green) |
| `a11y-focus-recovery` | G2 (fixture on `document.body`; focus lands on a non-disabled surviving control after add/remove/reorder in the unified editor) |
| `browser-verify` | G2 (screenshot + verify each skin/view against the G1 design source) |

Acceptance (G2): `npm test` green + lib `build` green. **npm in `apps/`; pnpm only for the lib
build in `domains/studio`.** Every merge founder-gated.

`G1` is DESIGN-ONLY: no `tdd` / `parity-proof` / `browser-verify` (no code); its quality is the
spec review (`review-floor`, `md-quality`) + the founder design gate.

## Lanes & parallelism

Strictly sequential: `G1` (design, no deps) → founder approves → `G2` (build, dependsOn G1). Max
parallel width 1 (this slice intentionally serializes design ahead of the parity-critical build).

## Work items

| itemId | title | scope (repo=studio) | dependsOn | lane | qualityObligations |
| --- | --- | --- | --- | --- | --- |
| `board-editor-studio/G1` | DESIGN-ONLY (founder-gated): unify "Node layers" + "Composites" into ONE "Groups" concept. Author a design spec + a visual design source (HTML/annotated mockup) resolving: (1) unified `Group` model with node = drawn root group, reusable groups named+nestable (keep `wouldCycle` DAG guard); (2) single shared group-editor component API replacing instance-row + composite-parts-editor; (3) merged "Groups" rail/IA; (4) versioned `catalog-document` back-compat migration for old `{definitions,layers}` + localStorage-saved catalogs; (5) parity: `buildRecipeFromCatalog` output stays byte-identical. NO code. Output to `docs/groups-merge/`. The founder-gated merge of this PR IS the design gate. | `pathPrefix: docs/groups-merge` | — | groups | review-floor, md-quality |
| `board-editor-studio/G2` | BUILD (dependsOn G1): implement the approved unified "Groups" model + single shared group-editor + merged "Groups" IA in `libs/board-editor`. Migrate `catalog.ts` model + `buildRecipeFromCatalog` expander + `catalog-document` serialize/deserialize (with the versioned back-compat migration) + the `catalog-designer` shell rail + replace `instance-row` & `composite-parts-editor` with the single group-editor. Keep `EditorRecipe`/`interpretRecipe` consumption unchanged (ZERO brick/kernel change). BUILD FROM the G1 design source; browser-verify each rendered view per skin (night/ivory/clinical) against it. Parity spec green; a11y focus-recovery on add/remove/reorder. | `pathPrefix: libs/board-editor` | board-editor-studio/G1 | groups | tdd, review-floor, opus-whole-branch, parity-proof, a11y-focus-recovery, browser-verify |

## Disjointness proof

Both items same `repo: studio`. The only pair (`G1`, `G2`) is **ordered** — `G2 dependsOn G1` —
so it needs no disjointness proof (an item and an ancestor it dependsOn may share scope and can
never be co-claimed). Their scopes do not even overlap regardless: `docs/groups-merge` (G1) vs
`libs/board-editor` (G2) — neither is a prefix of the other (rule 2). No other `board-editor-studio`
items are queued (16 done, 0 queued). No cross-repo / ADR items. Every `dependsOn` id
(`board-editor-studio/G1`) appears in this item list — no dangling deps.

Cross-product check: the live claims at push time (`system-builder-studio/TE1`, `/TE2`) are in
repos `devloop` / `workbench`, not `studio` → no live-claim conflict with `G1`/`G2`.
