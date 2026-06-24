---
product_key: board-editor-studio
build_path_date: 2026-06-21
amended_date: 2026-06-24
status: build-path
charter: docs/foundry/board-editor-studio/charter.md
risk_tier: T0
item_count: 14
---

# Build Path — Board Editor Studio

> **AMENDMENT 2026-06-24 (founder-gated).** Items E1.1–E8.1 below are **DONE**. The charter
> amendment (standalone + skin system) adds a follow-on phase **R1a → R1b → R1c → R2** (+ an
> optional R3 backlog), documented in the new **"## Amendment 2026-06-24 — Standalone & reskin"**
> section at the end of this file. The original ladder is preserved verbatim for the audit trail;
> the new items are never collisions with the done set. Design + plan:
> `docs/superpowers/specs/2026-06-24-board-editor-studio-standalone-design.md` ·
> `docs/superpowers/plans/2026-06-24-board-editor-studio-standalone.md`.

> Stage-4 decomposition of the chartered wedge + the IN-SCOPE vision into claimable
> foundry work items. This product **extends the shipped studio** (`domains/studio`,
> Recipe Designer slices 1–3) — it does NOT scaffold a new domain. The ladder is a
> **primarily sequential `dependsOn` chain** mirroring how slices 1–3 actually shipped
> (one PR each), so disjointness is trivial: ordered items may share the
> `apps/studio-ui/src/app/recipe-designer/` pathPrefix under the `dependsOn` share-scope
> exemption.

## Scaffold plan

**State: none — extends the existing app.** The repo `de-braighter/studio`
(`domains/studio`) is already a building, testing, pnpm-workspace domain with a shipped
Angular app `apps/studio-ui`. There is **NO `/new-domain` scaffold item** and **NO E1
whole-repo scaffold**. All work lands under `apps/studio-ui/src/app/recipe-designer/`
(the slices-1–3 feature area), with one early item also touching the two shared shell
files (`app.routes.ts`, `app.html`) to wire a catalog route + nav link.

- **Repo:** `de-braighter/studio` (existing).
- **Feature area (item pathPrefix):** `apps/studio-ui/src/app/recipe-designer/`.
- **Consumed package (unchanged by default):** `@de-braighter/design-system-core@^2.6.0`
  (the `board-kit` surface: `EditorRecipe`, `interpretRecipe`, `validateRecipe`,
  `<ds-board-kit>`) + `@de-braighter/design-system-angular@^1.10.0`.
- **Package manager / acceptance:** the app pins `packageManager: npm@10.9.2` and its
  scripts are `ng`-based (`npm test` → `ng test --no-watch`, `npm run build` → `ng build`).
  Acceptance per item is **`npm test` green + `npm run build` green run at the
  `apps/studio-ui` app level**, per the charter quality plan. (NOTE: the *repo root* uses
  a `pnpm-workspace.yaml` + `pnpm-lock.yaml` to orchestrate `-r` builds; this is a known
  in-repo discrepancy — see Open issues. Workers run the app-level npm scripts the charter
  names; they must NOT introduce pnpm into `apps/studio-ui`.)

## Epic ladder

| Epic | Theme | Items |
| --- | --- | --- |
| **E1 — the wedge** | catalog model + shell, compiled DOWN to `shapes[]` | E1.1, E1.2 |
| **E2 — composites** | nested reusable definition groups + cycle detection | E2 |
| **E3 — `svg` primitive** | 5th primitive (token-substituted raw markup) — **smell-flagged** | E3 |
| **E4 — detail drawer** | per-definition slide-over inspector | E4 |
| **E5 — board settings** | identity / accessible-name template / interaction toggles / bounds | E5 |
| **E6 — cross-ref analytics** | derived usage graph (`usersOf`/`usageCount`/`isUnused`) | E6 |
| **E7 — richer serialization** | `definitions[]`+`layers[]` document + diagram↔code toggle | E7 |
| **E8 — persistence** | save/load/name + recipe→catalog reverse mapper | E8.0 (design), E8.1 (impl) |

The chain is strictly sequential **E1.1 → E1.2 → E2 → E3 → E4 → E5 → E6 → E7 → E8.0 →
E8.1**. Each builds on the catalog model + shell the previous item established; this
mirrors the proven slices-1–3 one-PR-per-slice cadence and keeps the catalog model a
single evolving surface rather than fanning concurrent edits across it.

## UI-surface plan

Every dossier UI surface mapped to **in-scope (which item)** or **deferred (why)**:

| Dossier UI surface | In / Deferred | Item |
| --- | --- | --- |
| Top bar (product mark, `catalog` pill, search, +New, Reset) | in | E1.2 |
| Left rail catalog navigator (Build / Compose / Primitives, counts) | in | E1.2 (Build+Primitives), E2 adds Compose/Composites |
| Node-layers surface (placed Instance Rows: reorder/dup/del/offset + place-picker) | in | E1.2 |
| Card library surface (per-kind card grid, filter, count, mini-preview, empty-state) | in | E1.2 (primitives), E2 (composites) |
| Instance Row sub-component (reorder/dup/del + x/y offset) | in | E1.2 |
| Composites surface + cycle detection | in | E2 |
| `svg` primitive (raw markup + `{label}/{kind}/{meta}` tokens) | in (smell-flagged) | E3 |
| Detail drawer / slide-over inspector | in | E4 |
| Board-settings surface (identity `kind`, accessible-name template, interactions, bounds) | in | E5 |
| Cross-reference / usage analytics ("Used in N", unused flag, guarded drop) | in (derived) | E6 |
| Right live-preview pane — diagram view (sample tree + counts) | in | E1.2 (already wired via `<ds-board-kit>`) |
| Right live-preview pane — diagram↔code segmented toggle + copy-JSON | in | E7 |
| Richer `{kind,name,interactions,bounds,definitions[],layers[]}` serialization | in | E7 |
| Recipe persistence (save/load/name) + reverse mapper | in | E8.0 (design) + E8.1 (impl) |
| Skin switcher (exercir/strategir/operir) | **deferred** | — (nice-to-have prop; not load-bearing for the catalog model; out of the wedge ladder) |
| Multi-board / multi-recipe catalog management | **deferred** | — (charter what-NOT #1) |
| Drag-to-reparent / free-layout gesture | **deferred** | — (charter what-NOT #2; numeric-offset only) |
| `svg` tenant-grade sanitization | **deferred** | — (charter what-NOT #3; trusted-author + basic escaping only in E3) |
| eject-to-TS (`BoardRegistry` codegen) | **deferred** | — (charter what-NOT #4; copy-JSON only in E7) |
| a11y *role* authoring (vs accessible *name*) | **deferred** | — (dossier OQ; only the accessible-NAME template is authored, in E5) |

## ADR needs & gates

**Expected: NONE.** This is T0 brick/studio territory — the studio *composes* the
`<ds-board-kit>` brick and authors `EditorRecipe` DATA; it authors no kernel concept, no
contract, no schema. The default posture is **compile-down studio-side, zero
`design-system-core` change** (preserving the slices-1–3 "zero core change" posture).

**One charter-smell flagged for the founder (NOT an ADR — a smell to surface):**

- **E3 (`svg` primitive) cannot compile down to the existing typed primitives.** The
  published `PrimitiveTemplate` union (`design-system-core@2.6.0`) is exactly
  `circle | line | rect | path | text` (verified in
  `node_modules/@de-braighter/design-system-core/src/public/board-kit/recipe.d.ts`).
  Raw SVG markup with `{label}/{kind}/{meta}` token substitution is **not expressible**
  as those typed primitives. Two resolutions, both surfaced to the founder:
  1. **Studio-only (preferred, default):** the `svg` primitive lives only in the catalog
     model; `buildRecipeFromCatalog` lowers each `svg` definition into a small set of the
     EXISTING typed primitives where it can, OR the studio renders the raw-SVG preview
     itself (studio-side) and the lowered `shapes[]` carries an approximating/`path`
     fallback. If a faithful lowering is impossible, E3 ships the `svg` primitive as a
     **studio-preview-only** authoring affordance that does not round-trip through
     `interpretRecipe` — documented as such.
  2. **Brick change (escalates):** if the founder wants `svg` to be a first-class 6th
     `interpretRecipe` primitive, that is a **separate, architecture-gated item scoped to
     `de-braighter/design-system`** (published-package blast radius) per charter §"What
     NOT to build" #5 + the conditional architecture gate — **NOT bundled into E3**.

  **The build-path default is resolution (1) (studio-only).** E3's worker MUST attempt
  compile-down first and treat a forced brick change as a stop-and-escalate, not an
  in-item decision. See Open issues for the founder.

No other item is expected to need a brick change: composites (E2), instance-references,
bounds, cross-ref analytics, serialization, and persistence all lower to or operate over
the existing flat `shapes[]` / studio-side document model.

## Quality battery config

Tier T0 obligations from the charter quality plan, applied per item (the worker runs the
applicable subset — no obligation the charter lacks; **no mutation threshold at T0**):

| Obligation | Applies to | Rationale |
| --- | --- | --- |
| `tdd` | **every** item | slices-1–3 test-first convention. |
| `review-floor` | **every** item | ≥1 `/code-review`; full verifier wave on non-trivial PRs. |
| `opus-whole-branch` | **every** item | non-negotiable for this product — caught CRITICAL data-loss/focus regressions on EVERY slice 1–3. |
| `parity-proof` | items that CHANGE the compile-down expander `buildRecipeFromCatalog`→`shapes[]` (E1.1, E2, E7 — and E3 IF it lowers) | proves an authored catalog reproduces an equivalent flat recipe IDENTICALLY, mirroring `plan-kinds-parity.spec.ts`. |
| `a11y-focus-recovery` | items with add/remove/reorder/drop/drawer interactions (E1.2, E2, E4, E6) | WCAG-2.4.3 focus-recovery test, fixture on `document.body`, asserts focus lands on a surviving non-disabled control (the jsdom-vs-real-browser blur trap). |

**Per-item obligation assignment** (see the Work-items table for the exact arrays):

- **E1.1** (catalog model + expander + parity spec): `tdd, review-floor, opus-whole-branch, parity-proof`. Pure-model — no `a11y-focus-recovery`.
- **E1.2** (catalog-shell UI: navigator + card grid + place-as-instance + Instance Row): `tdd, review-floor, opus-whole-branch, a11y-focus-recovery`. Consumes the unchanged expander — no `parity-proof`.
- **E2** (composites + cycle detection + recursive expansion): `tdd, review-floor, opus-whole-branch, a11y-focus-recovery, parity-proof` (touches both the expander AND the composites parts-editor interactions).
- **E3** (`svg` primitive): `tdd, review-floor, opus-whole-branch, parity-proof` (parity ONLY if it lowers; if it ships preview-only, the parity slug still guards the no-regression of the existing expander). No interaction surface beyond a textarea → no `a11y-focus-recovery`.
- **E4** (detail-drawer inspector): `tdd, review-floor, opus-whole-branch, a11y-focus-recovery` (slide-over open/close focus management + guarded drop).
- **E5** (board-settings surface): `tdd, review-floor, opus-whole-branch`. Form fields/toggles, no add/remove/reorder/drop → no `a11y-focus-recovery`; doesn't touch the expander shape beyond authoring fields already lowered → no `parity-proof`.
- **E6** (cross-ref analytics, DERIVED): `tdd, review-floor, opus-whole-branch, a11y-focus-recovery` (guarded drop + click-to-navigate back-refs). No expander change → no `parity-proof`.
- **E7** (richer serialization + diagram↔code toggle + copy-JSON): `tdd, review-floor, opus-whole-branch, parity-proof` (the document↔`shapes[]` compile-down path is load-bearing). Segmented toggle is not an add/remove/reorder → no `a11y-focus-recovery`.
- **E8.0** (persistence design note, docs-only): `review-floor` only (a design spec, not code — `tdd`/build acceptance N/A).
- **E8.1** (persistence impl + reverse mapper): `tdd, review-floor, opus-whole-branch, parity-proof` (the recipe→catalog reverse mapper must round-trip identically — a parity/round-trip proof).

## Lanes & parallelism

**One lane: `studio-ui`. Pure sequential chain.** This is incremental UI on a single
shared feature area (the catalog model + shell evolves item-by-item); concurrent edits
would collide on the same model files. Each item `dependsOn` the previous, so the foundry
claims them one at a time in order. There are **no genuinely-parallel pairs** — even items
that touch nominally different surfaces (E5 board-settings vs E6 analytics) both read/extend
the catalog model E1.1 established and are safest serialized. The sequential shape also
makes disjointness trivial (all pairs ordered → share-scope exemption).

**Shared-shell file handling:** the catalog needs a route (`app.routes.ts`) + a nav link
(`app.html`), both OUTSIDE `recipe-designer/`. Per the build-path guidance, the
shared-file edit goes in the **earliest item that needs it (E1.2, the shell)**, whose
pathPrefix is widened to `apps/studio-ui/src/` to cover both the feature dir and the two
shell files. Every later item (E2…E8.1) `dependsOn` E1.2 (transitively), so under the
`dependsOn` share-scope exemption they may share scope with E1.2's wider prefix — no
disjointness violation. E1.1 keeps the narrow `recipe-designer/` prefix (pure model, no
shell touch) and E1.2 depends on it (ordered) so the E1.1↔E1.2 nesting is exempt too.

## Work items

| itemId | title | scope (repo · pathPrefix) | dependsOn | lane | qualityObligations | yields |
| --- | --- | --- | --- | --- | --- | --- |
| `board-editor-studio/E1.1` | Catalog data model (`Definition`/`Instance` types) + `buildRecipeFromCatalog` expander lowering definitions/instances → existing flat `EditorRecipe.shapes[]`, with a parity spec (mirroring `plan-kinds-parity.spec.ts`) proving an authored catalog reproduces an equivalent flat recipe IDENTICALLY through `interpretRecipe`; zero `design-system-core` change | studio · `apps/studio-ui/src/app/recipe-designer/` | — | studio-ui | `tdd, review-floor, opus-whole-branch, parity-proof` | — |
| `board-editor-studio/E1.2` | Catalog-shell UI: left-rail navigator (Build / Primitives sections w/ counts) + per-primitive-kind card-grid library (filter, count, mini-preview, empty-state) + node-layers surface with the reusable Instance Row (reorder/dup/del + x/y offset) + "place definition as instance" picker, wired to the UNCHANGED live `<ds-board-kit>` preview via `buildRecipeFromCatalog`; adds the `/catalog` route in `app.routes.ts` + nav link in `app.html` (WCAG-2.4.3 focus recovery on reorder/remove) | studio · `apps/studio-ui/src/` | `board-editor-studio/E1.1` | studio-ui | `tdd, review-floor, opus-whole-branch, a11y-focus-recovery` | `board: board-editor-studio-catalog` |
| `board-editor-studio/E2` | Composites: a first-class `composite` definition kind (a reusable group of instances of other definitions), the Compose/Composites navigator section + card library, a parts editor, cycle prevention (`wouldCycle`/`defContains`), and RECURSIVE expansion in `buildRecipeFromCatalog` (composites flatten into `shapes[]` draw primitives); extend the parity spec to cover a nested composite; WCAG-2.4.3 focus recovery on parts add/remove/reorder | studio · `apps/studio-ui/src/app/recipe-designer/` | `board-editor-studio/E1.2` | studio-ui | `tdd, review-floor, opus-whole-branch, a11y-focus-recovery, parity-proof` | — |
| `board-editor-studio/E3` | `svg` primitive — a 5th catalog primitive kind: raw SVG markup with `{label}/{kind}/{meta}` token substitution + basic escaping and a DOCUMENTED trusted-author assumption (NOT a tenant-grade sanitizer, charter what-NOT #3). DEFAULT = compile-down studio-side; if a faithful lowering to the existing typed primitives is impossible, ship `svg` as a studio-preview-only affordance and document it — and STOP+escalate rather than change `design-system-core` (any brick change is a separate architecture-gated `de-braighter/design-system` item) | studio · `apps/studio-ui/src/app/recipe-designer/` | `board-editor-studio/E2` | studio-ui | `tdd, review-floor, opus-whole-branch, parity-proof` | — |
| `board-editor-studio/E4` | Detail-drawer inspector: a per-definition slide-over (rename, 130px live preview, typed primitive field grid OR composite parts editor, "Used in" placeholder row, "place in node →", guarded "Drop definition"); proper focus management on open/close and after a guarded drop (WCAG-2.4.3 focus recovery, fixture on `document.body`) | studio · `apps/studio-ui/src/app/recipe-designer/` | `board-editor-studio/E3` | studio-ui | `tdd, review-floor, opus-whole-branch, a11y-focus-recovery` | — |
| `board-editor-studio/E5` | Board-settings surface: Identity (`kind` `#`-prefixed input + accessible-NAME token template authoring the a11y name), Interactions (Add-child / Remove / Re-parent toggles as authorable data lowered to recipe `actions`), and a `{x,y,w,h}` bounds box every node draws within; lowered through the existing expander (no expander signature change) | studio · `apps/studio-ui/src/app/recipe-designer/` | `board-editor-studio/E4` | studio-ui | `tdd, review-floor, opus-whole-branch` | — |
| `board-editor-studio/E6` | Cross-reference usage analytics — `usersOf`/`usageCount`/`isUnused` computed ON THE FLY from definitions+layers (DERIVED, NEVER stored — "store generators, derive graphs"): "Used in N places" back-refs with click-to-navigate, an unused-definition flag on cards, and a guarded drop (can't drop a referenced definition). WCAG-2.4.3 focus recovery on the guarded drop + back-ref navigation | studio · `apps/studio-ui/src/app/recipe-designer/` | `board-editor-studio/E5` | studio-ui | `tdd, review-floor, opus-whole-branch, a11y-focus-recovery` | — |
| `board-editor-studio/E7` | Richer serialization + diagram↔code view: emit the `{kind,name,interactions,bounds,definitions[],layers[]}` document (layers reference definitions by name via `use`) alongside the diagram/code segmented toggle + copy-JSON; KEEP `buildRecipeFromCatalog`→`shapes[]` as the brick-facing path (decide & document in the item: new recipe schema version vs compile-down — DEFAULT compile-down). Parity spec proves the document lowers to the same `shapes[]` | studio · `apps/studio-ui/src/app/recipe-designer/` | `board-editor-studio/E6` | studio-ui | `tdd, review-floor, opus-whole-branch, parity-proof` | — |
| `board-editor-studio/E8.0` | Persistence DESIGN note (docs-only): choose the studio-only store (localStorage / IndexedDB / injectable port), the save/load/name UX, and the recipe→catalog reverse-mapping contract (id-vs-name reference integrity, rename/collision handling); reference the sibling `studio` product's `studio-recipe-s4-persistence-design` item. Output is a markdown design note under `domains/studio/docs/` — no code | studio · `apps/studio-ui/src/app/recipe-designer/` | `board-editor-studio/E7` | studio-ui | `review-floor` | — |
| `board-editor-studio/E8.1` | Recipe persistence impl: save/load/name authored catalogs via the E8.0-chosen studio-only store + the recipe→catalog REVERSE mapper (load an existing flat recipe back into the catalog definition/instance model) with a round-trip/parity proof (catalog → `shapes[]` → catalog is identity-stable on names) | studio · `apps/studio-ui/src/app/recipe-designer/` | `board-editor-studio/E8.0` | studio-ui | `tdd, review-floor, opus-whole-branch, parity-proof` | — |

## Disjointness proof

The ladder is a **pure `dependsOn` chain**:
`E1.1 → E1.2 → E2 → E3 → E4 → E5 → E6 → E7 → E8.0 → E8.1`.

Every item transitively depends on every earlier item, so **all pairs are ordered by
`dependsOn` → the share-scope exemption applies; there are ZERO unordered pairs** that
must be pairwise path-disjoint. This holds even though most items share the
`apps/studio-ui/src/app/recipe-designer/` pathPrefix and E1.2 widens to the nesting parent
`apps/studio-ui/src/`: the nesting (E1.2's `apps/studio-ui/src/` ⊃ every other item's
`apps/studio-ui/src/app/recipe-designer/`) would OVERLAP under rule 2, but because the pair
is ordered (every item depends on E1.2, and E1.2 depends on E1.1), they can never be
claimed simultaneously — the foundry `scopesDisjoint` exemption covers it.

| Pair class | Ordered? | Resolution |
| --- | --- | --- |
| every pair `(Ei, Ej)` in the chain | yes (transitive `dependsOn`) | share-scope exemption — no disjointness check required |
| (no genuinely-parallel / unordered pair exists) | — | — |

**Dangling-dependency check:** every `dependsOn` id —
`E1.1, E1.2, E2, E3, E4, E5, E6, E7, E8.0` — appears as an `itemId` in the table above.
No dangling deps.

## Open issues for the founder

1. **E3 `svg` primitive — potential `design-system-core` change (charter-smell, surfaced
   per stage-4 protocol).** The published `PrimitiveTemplate` union has no raw-`svg` kind;
   raw markup + token substitution does not lower to the existing `circle/line/rect/path/
   text` primitives. The build-path DEFAULTS E3 to studio-only (preview-only if no faithful
   lowering exists) and forbids bundling a brick change. **If the founder wants `svg` as a
   first-class `interpretRecipe` primitive, that is a separate architecture-gated item
   scoped to `de-braighter/design-system`** — decide before E3 is claimed.
2. **Package-manager discrepancy in `domains/studio`.** The repo root carries
   `pnpm-workspace.yaml` + `pnpm-lock.yaml`, but `apps/studio-ui` pins
   `packageManager: npm@10.9.2` with `ng`-based scripts. The charter mandates npm
   acceptance (`npm test` / `npm run build`) at the app level — workers follow that and
   must NOT introduce pnpm into the app. Flagging the inconsistency for cleanup.
3. **E8.0 design dependency.** E8.1 (persistence impl) is gated behind E8.0 (a small
   in-product design note) so the reverse-mapper / reference-integrity contract is decided
   before code. E8.0 also references the sibling `studio` product's existing DESIGN-ONLY
   `studio-recipe-s4-persistence-design` item; if the founder prefers to fold the design
   into E8.1 directly, E8.0 can be dropped and E8.1 re-pointed at E7.

---

## Amendment 2026-06-24 — Standalone & reskin (R-items)

### Scaffold plan (amended)

Still **no `/new-domain`**, still `de-braighter/studio`. `domains/studio` is a **pnpm-workspace**
(`packages: ["apps/*"]`; **not Nx**) whose `apps/studio-ui` is a self-contained Angular-CLI
workspace. The amendment:

- adds `libs/*` to `pnpm-workspace.yaml`;
- creates **`libs/board-editor`** — an ng-packagr Angular library workspace package
  `@de-braighter/board-editor` (mirrors the `design-system-angular` lib packaging;
  `entryFile: src/public-api.ts`) carrying its own `build`/`test` scripts;
- creates **`apps/board-editor-ui`** — a thin Angular-CLI app (own `index.html`
  `[data-theme=night]` root + top-bar skin switcher) consuming the lib + published
  `@de-braighter/design-system-{core,angular,css@^1.7.0}`;
- the cockpit `apps/studio-ui` drops `/recipe-designer` + `/catalog` and retires the legacy
  `RecipeDesignerComponent` chain.

The catalog IDE source moves OUT of `apps/studio-ui/src/app/recipe-designer/` (import-disjoint
from the legacy form — verified: no catalog file imports `recipe-form`/`shapes-editor`/
`shape-editor`/`primitives-editor`/`sample-tree`/`plan-kinds`).

### Epic ladder (amended)

| Epic | Theme | Items |
| --- | --- | --- |
| **R1 — Decouple & stand alone** | extract lib → new app → cockpit removal (green at each step) | R1a, R1b, R1c |
| **R2 — Reskin** | canonical + chrome tokens; 3 skins (`ivory`/`clinical`/`night`); browser-verify | R2 |
| **R3 — a11y polish** (optional backlog, NOT pushed) | Instance Row roving-tabindex toolbar | R3 |

Strictly sequential `R1a → R1b → R1c → R2 (→ R3)`. R1 is split green-at-each-step per founder
decision (the interim repoint of the cockpit `/catalog` to the lib keeps `studio-ui` green
between R1a and R1c — no broken intermediate, no knip-orphan).

### UI-surface plan (amended)

The `(3)` handoff is structurally the SAME catalog IDE already shipped (E1.2). No new surface;
the deltas are **chrome** (glass top bar/rail/drawer/code panel, grid-dot canvas, the three
`[data-theme]` skins + switcher) + **standalone shell**. Surface→disposition map: see spec §3.
The only NEW UI is the app shell top bar + skin switcher (R1b), reskinned to glass in R2.

### ADR needs & gates (amended)

**NONE.** Pure topology (standalone packaging) + theming (consume published CSS tokens). Zero
`design-system-core` change; authors no kernel concept, contract, or schema. No architecture
gate expected (a forced brick change would be a stop-and-escalate, not an in-item decision).

### Quality battery config (amended)

Obligations are the charter quality plan (incl. the 2026-06-24 `browser-verify` addition):

| Obligation | Applies to | Rationale |
| --- | --- | --- |
| `tdd` | every R-item | test-first. |
| `review-floor` | every R-item | ≥1 `/code-review`; full wave on non-trivial PRs. |
| `opus-whole-branch` | every R-item | non-negotiable for this product. |
| `parity-proof` | R1a, R2 | moved/reskinned sources prove behaviour unchanged via the existing parity + persistence specs. |
| `a11y-focus-recovery` | R1b, R2, R3 | the IDE's reorder/remove/drop/drawer focus tests stay green (fixture on `document.body`); R3 adds roving-tabindex. |
| `browser-verify` | R1b, R2 | serve + screenshot — R1b verifies night renders; R2 verifies all three skins vs the handoff screenshots. |

### Work items (amended)

| itemId | title | scope (repo · pathPrefix) | dependsOn | lane | qualityObligations |
| --- | --- | --- | --- | --- | --- |
| `board-editor-studio/R1a` | Extract the catalog IDE into a NEW ng-packagr workspace lib `@de-braighter/board-editor` (move the import-disjoint catalog-IDE sources + specs out of `apps/studio-ui/src/app/recipe-designer/`; add `libs/*` to `pnpm-workspace.yaml`; `src/public-api.ts` exports `CatalogDesignerComponent`/`CATALOG_STORE`/`LocalStorageCatalogStore`) AND repoint the cockpit `/catalog` route to import from the lib (add `@de-braighter/board-editor: workspace:*`). `studio-ui` stays GREEN + `/catalog` still works; lib + root `pnpm -r` build/test green; knip green. Pure move — existing parity/persistence specs prove behaviour unchanged | studio · *(whole repo — sequencing item: touches `pnpm-workspace.yaml` + `apps/studio-ui/` + new `libs/board-editor/`)* | — | studio | `tdd, review-floor, opus-whole-branch, parity-proof` |
| `board-editor-studio/R1b` | Scaffold the STANDALONE app `apps/board-editor-ui` (Angular-CLI, npm-pinned): `index.html` `<html data-theme="night">` + import published `@de-braighter/design-system-css@^1.7.0` `tokens.css`; app shell = the `(3)` top bar (product mark + `catalog` pill + a `[data-theme]` skin switcher writing `ivory\|clinical\|night` on the root + Reset) wrapping the route `'/'` → `CatalogDesignerComponent` (from the lib) with the `CATALOG_STORE`/`LocalStorageCatalogStore` provider. App + root build/test green; BROWSER-VERIFY the app serves + the IDE renders under `night` (screenshot) | studio · `apps/board-editor-ui/` | `board-editor-studio/R1a` | studio | `tdd, review-floor, opus-whole-branch, a11y-focus-recovery, browser-verify` |
| `board-editor-studio/R1c` | Decouple the cockpit + RETIRE the legacy form: remove the `/recipe-designer` + `/catalog` routes + their imports + the `CATALOG_STORE` provider + the `@de-braighter/board-editor` dep from `apps/studio-ui`; update BOTH route specs (`app.spec.ts` line-29 smoke test → asserts the route is GONE; `app.routes.spec.ts` → new exact table `['', '**', 'operate']`, drop the component assertions); delete the legacy `RecipeDesignerComponent` chain (files reachable ONLY from it: `recipe-designer`/`shapes-editor`/`shape-editor`/`primitives-editor`/`recipe-form`/`sample-tree`†/`plan-kinds.recipe` + specs). knip GREEN (no orphans); cockpit build/test green; cockpit still renders (shell + operate). †`sample-tree` deleted only if R1a confirmed it is NOT shared with the catalog IDE | studio · `apps/studio-ui/` | `board-editor-studio/R1b` | studio | `tdd, review-floor, opus-whole-branch` |
| `board-editor-studio/R2` | Reskin to the `(3)` chrome contract: rewrite `libs/board-editor` CSS + component inline styles from night-only hardcoded literals (`#22d39a`/`rgba(34,211,154…)`/`#0a0d14`/`#0f1320`/`#7c6dfa`/`#f87171`/`#fbbf24` + the `:host` dark-fallback alias block) to PURE canonical + chrome tokens per spec §4.1 (`--accent\|-soft\|-rim\|-on`, `--bg\|-elev\|-sunken`, `--paper`, `--ink/-2/-3/-4`, `--rule\|-strong`, `--glass-bg\|-blur`, `--rail-bg`, `--scrim`, `--glass-shadow`, `--grid-dot`, `--code-str\|-num`, status `--color-*`); add a token-hygiene test asserting NO retired/literal tokens remain; resolve the `anyComponentStyle` 8 kB budget (raise it or globalize the catalog CSS — document). BROWSER-VERIFY ALL THREE skins (`night`/`ivory`/`clinical`) render (no blank panels) + diff vs `screenshots/{migrated,ivory,clinical}.png`. Do NOT token-swap authored node-card `fill`s. Existing parity/focus specs stay green | studio · *(whole repo — touches `libs/board-editor/src/` + `apps/board-editor-ui/`)* | `board-editor-studio/R1c` | studio | `tdd, review-floor, opus-whole-branch, parity-proof, a11y-focus-recovery, browser-verify` |

**R3 (optional backlog — NOT pushed):** `board-editor-studio/R3` — adopt `DbRovingToolbar`/
`DbRovingItem` (APG roving-tabindex) on the Instance Row ↑↓/dup/del toolbar (scope
`libs/board-editor/src/lib/instance-row.component.ts`; dependsOn R2; `tdd, review-floor,
opus-whole-branch, a11y-focus-recovery`). Queue on founder request after R2.

### Disjointness proof (amended)

The new items are a **pure `dependsOn` chain** `R1a → R1b → R1c → R2`: every pair is ordered by
transitive `dependsOn`, so the foundry `scopesDisjoint` **share-scope exemption** applies and
there are **ZERO unordered pairs** to pairwise-check — even though R1a and R2 claim the whole
`studio` repo and R1b (`apps/board-editor-ui/`) / R1c (`apps/studio-ui/`) nest under it. R1a is
the **sequencing item** (it mutates the shared shell files `pnpm-workspace.yaml` +
`apps/studio-ui/app.routes.ts` + `package.json`), and every later item transitively depends on
it, so none can be claimed concurrently with it.

| Pair class | Ordered? | Resolution |
| --- | --- | --- |
| every pair in `R1a → R1b → R1c → R2` | yes (transitive `dependsOn`) | share-scope exemption — no disjointness check required |
| R-items vs the DONE E-items | n/a | done items hold no claims; never re-claimed |
| (no unordered R-pair exists) | — | — |

**Dangling-dependency check:** `R1a` deps `—`; `R1b` deps `R1a`; `R1c` deps `R1b`; `R2` deps
`R1c` — all referenced ids are emitted in this table. No dangling deps. (No ADR items — none
needed.)
