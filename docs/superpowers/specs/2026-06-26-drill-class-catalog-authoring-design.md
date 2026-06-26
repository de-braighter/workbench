# Board-recipe authoring model — a reusable, general catalog-designer capability — design

- **Date:** 2026-06-26
- **Status:** approved (founder, brainstorm session 2026-06-26)
- **Owner repos:** `domains/studio` (`libs/board-editor`) · `layers/specs` (ADR)
- **Lineage:** [[board-recipes-single-source-arc]] · [[drill-board-recipe-defork-arc]] · [[editor-recipe-board-designer-arc]] · [[board-editor-studio-arc]] · [[studio-product-direction]]

## 1. The goal — a reusable, general board-authoring model

The founder's steer (2026-06-26): *"do whatever it needs to have a modelling capability that is
reusable and covers most needs."* So the target is **not** a kf-drill-specific feature — it is a
**reusable, general authoring model** for board-kit editors: one that can **open, edit, and round-trip
the full published `EditorRecipe` surface**, so the catalog-designer can author **any** board class
(plan-tree, drill, and future), not the one fixture. The kids-football drill board is the **hardest
proving fixture**, not the goal.

This picks up gap #3 of the single-source program ([[board-recipes-single-source-arc]]): the drill
`EditorRecipe` is now one published artifact (`@de-braighter/board-recipes@1.0.0`,
`src/kf-drill.recipe.json`, the typed `kfDrillRecipe`), but it is **not openable** in the
catalog-designer and there is **no path** from any `EditorRecipe` back into the editor's authoring
model. Today the catalog-designer (`libs/board-editor`) authors only the **plan-tree class**:
static-number `rect/circle/line/text/path/svg` primitives placed in groups, lowered by
`buildRecipeFromCatalog`. The drill recipe is almost entirely the constructs that model can't hold —
`geometry` archetypes (point/box/polyline), `{calc}`/`{bind}`, `{i18n}` a11y, `{when}` handles —
and the *general* recipe surface adds more the model has never touched (`{tpl}`, a11y `description`,
all six action ops, hit-tuning, `edges`).

**Goal (the ceiling, founder-chosen):** the catalog-designer's authoring model expresses the **whole
published recipe surface**; it can **open** any board-kit recipe (kf-drill the headline), **edit** every
construct in the GUI, and **re-save byte-identical** — guarded by a deep-equal round-trip gate, the
discipline the rest of this arc has run on. We reach it **slice by slice**; this spec defines the arc +
slice 1.

**Locked decisions (brainstorm 2026-06-26):**
1. **Direction:** pursue this (fork A), not the cross-domain recipe store (fork B — premature: one
   recipe, no save-to-store source yet, and gated behind the authoring capability this arc builds).
2. **Ceiling:** full round-trip-edit, byte-parity, over the **general** recipe surface.
3. **Slice 1:** open-+-round-trip-first (vertical) — the model holds any recipe as data; the
   per-construct *editors* light up in later slices.
4. **Architecture:** founder-delegated (*"I don't care how this looks"*) → the cleanest **general**
   model: a rich `RecipeShape`-shaped node is **the** authoring atom; the existing primitive/group
   placement is preserved as sugar that lowers into it (see §4). No publish, no kernel/brick change.
5. **Governance:** a short **ADR** + this design spec; studio-only, ADR-176-safe, **no publish**.

## 2. The target — what the model must hold and emit

The reverse-mapper's source and the forward path's target is the **published** `@de-braighter/design-system-core@2.8.0`
recipe surface (NOT the local design-system checkout, which is behind the 2.8.0 publish and lacks
`calc`/`i18n`/`geometry`). The authoritative types (`board-recipes/node_modules/.../board-kit/recipe.d.ts`):

```ts
type RecipeValue =
  | number | string
  | { bind: string } | { tpl: string }
  | { when: string; then: RecipeValue; else: RecipeValue }
  | { calc: string }                               // 2.8.0 (ADR-279)
  | { i18n: string; params?: Record<string, RecipeValue> };  // 2.8.0

type PrimitiveTemplate =        // every variant gains an optional `when?` (2.8.0)
  | { p:'circle'; cx,cy,r: RecipeValue; fill?,stroke?,strokeWidth?: RecipeValue; when?: RecipeValue }
  | { p:'line';   x1,y1,x2,y2: RecipeValue; stroke?,strokeWidth?,dash?: RecipeValue; when?: RecipeValue }
  | { p:'rect';   x,y,w,h: RecipeValue; fill?,stroke?,rx?: RecipeValue; when?: RecipeValue }
  | { p:'path';   d: RecipeValue; fill?,stroke?: RecipeValue; when?: RecipeValue }
  | { p:'text';   x,y: RecipeValue; text: RecipeValue; fill?,anchor?: RecipeValue; when?: RecipeValue };

interface RecipeShape {
  kind: string;
  draw: PrimitiveTemplate[];
  bounds: { x,y,w,h: RecipeValue };
  a11y: { role: string; name: RecipeValue; description?: RecipeValue };
  actions?: RecipeAction[];                        // add-child|remove|reparent|move|resize|reshape
  hit?: { handles?, handleRadius?, body?, segmentTolerance? };
  geometry?: 'point' | 'box' | 'polyline';         // 2.8.0 — synthesizes the EDIT half
  nudge?: number; handleRadius?: number; segTol?: number; minWH?: number;
}
interface EditorRecipe { id: string; name: string; shapes: RecipeShape[]; edges?: RecipeEdge[]; }
```

The drill fixture is **lean**: each shape carries only `kind`, optional `geometry`, `draw`, `bounds`,
`a11y` — it does **not** spell out `actions`/`nudge`/`handleRadius`/etc., relying on the brick's
geometry-archetype synthesis (ADR-279: `geometry` synthesizes tools/hitTest/onGesture/onKey). So the
surface the unified model must faithfully round-trip per shape is exactly: **`kind`, `geometry?`,
`draw[]` (rich, `RecipeValue`-valued, with `when?`), `bounds` (rich), `a11y` (rich `name`, incl. nested
`{i18n,params}` and `{when,then,else}`)** — plus the recipe-level `id` / `name`.

## 3. The fixture's structural finding — why the general-shape model is safe

A full read of `kf-drill.recipe.json` (all 8 shapes) settles the two risks raised against a unified model:

1. **No offset composition.** Every draw primitive in every drill shape is authored in the shape's
   **local coordinate space** — no nested groups, no `basePosition + dx` summing. (Instance position
   lives on the board *tree node*, applied by the brick at render, not in the recipe.) So the
   compile-down forward path's offset-summing (`lowerRect`: `def.basePosition.x + dx`,
   `catalog.ts:481`) **never has to add an offset to a `{calc}`/`{bind}` value** for a drill shape.
   The "offset-vs-expression" seam is **moot** for this class — proven across all 8 shapes.
2. **One kind = N rich primitives.** A drill shape kind (e.g. `kf.pitch` = 7 primitives, `kf.zone` =
   9) is **one** `RecipeShape` with a multi-primitive `draw`. The current model's only multi-primitive
   path is a Group, which *flattens to N separate shapes* (`kind#index`, `catalog.ts:719-731`) — the
   wrong topology. So the drill class cannot be forced through the def-ref + group + flatten machinery;
   it needs a shape whose `draw` is authored **directly**.

Both findings point to the same honest unification: a directly-authored rich shape is the model's
**general** form; the compile-down primitive/group placement is **sugar that lowers into it**.

## 4. Architecture — a rich shape is the general authoring atom

The `CatalogModel` gains a first-class **shape definition** that mirrors the published `RecipeShape`
1:1: a `draw` list of `RecipeValue`-valued `PrimitiveTemplate`s (calc/bind/tpl/when/i18n), a `geometry`
archetype, a rich (`{i18n}`-capable) `a11y` (name + description), `actions` (all six ops), and the
hit/tuning fields. This **is** the general authoring atom — every board recipe is "just shapes," so a
model whose atom is a full `RecipeShape` can express the **entire** recipe surface and round-trip any
`EditorRecipe`. The existing `PrimitiveDefinition` + `Group` placement (the plan-tree compile-down) is
preserved as **sugar that lowers into the same shape output** — one `CatalogModel`, one expander, one
output type (`RecipeShape`), two authoring affordances. The fixture analysis (§3) shows this is
additive and parity-neutral: rich shapes don't compose by offset, so they never collide with the
compile-down machinery.

This is the reusable capability the founder asked for: "covers most needs" = covers the full published
recipe surface; "reusable" = any recipe (plan-tree, drill, future), not a kf-drill-shaped feature.

### 4.1 The model extension (additive, parity-neutral)

A new `ShapeDefinition` member of the `CatalogDefinition` union, carrying the published recipe types
directly:

```ts
export interface ShapeDefinition {
  readonly id: string;                 // catalog identity
  readonly name: string;               // human label (navigator)
  readonly kind: 'shape';              // CatalogDefinition discriminant
  readonly shapeKind: string;          // the emitted RecipeShape.kind, e.g. 'kf.zone'
  readonly geometry?: 'point' | 'box' | 'polyline';
  readonly draw: ReadonlyArray<PrimitiveTemplate>;                       // RecipeValue-valued (with when?)
  readonly bounds: { x: RecipeValue; y: RecipeValue; w: RecipeValue; h: RecipeValue };
  readonly a11y: { role: string; name: RecipeValue; description?: RecipeValue };
  readonly actions?: ReadonlyArray<RecipeAction>;
  // geometry-archetype tuning passthrough — carried only when the recipe sets them (lean by default)
  readonly hit?: RecipeShape['hit'];
  readonly nudge?: number; readonly handleRadius?: number; readonly segTol?: number; readonly minWH?: number;
}
export type CatalogDefinition = PrimitiveDefinition | SvgDefinition | Group | ShapeDefinition;
```

The `PrimitiveTemplate`/`RecipeValue`/`RecipeAction` types are **imported from
`@de-braighter/design-system-core`** (already a studio dep) — the model consumes the published types
read-only; it does not redefine them. Every new field is additive + optional on the union as a whole;
existing `PrimitiveDefinition`/`SvgDefinition`/`Group` are byte-unchanged ⇒ the plan-tree parity
fixtures (`catalog-parity.spec.ts`, `catalog-document.spec.ts`) stay green by construction.

**Recipe id/name.** `buildRecipeFromCatalog` currently hardcodes `id:'catalog-preview'`,
`name:'Catalog preview'` (`catalog.ts:662,761`). Byte-parity of `kf-drill` (id `kf-drill`,
name `Kids drill board`) requires the model to **carry** them. Add optional
`CatalogModel.recipeId?` / `recipeName?`, defaulting to the current literals when absent (plan-tree
path unchanged).

### 4.2 The forward path branch

`buildRecipeFromCatalog` iterates the root group's parts (unchanged). For a part whose `defId`
resolves to a `ShapeDefinition`, it emits the shape **directly** — `{ kind: shapeKind, ...(geometry),
draw, bounds, a11y, ...(actions), ...(tuning) }` — **bypassing** offset-summing, flatten, and the
per-part `bounds ?? root.bounds ?? DEFAULT_BOUNDS` fallback (a rich shape owns its own `bounds`). The
existing primitive/svg/group branches are untouched. (Rich-shape root parts use `x:0, y:0` — drill
shapes are local-space; the part is a registry entry, not a placement.)

### 4.3 The reverse-mapper (`buildCatalogFromRecipe`)

`EditorRecipe → CatalogModel`, the inverse, **near-identity for ANY recipe** (not drill-specific): each
`recipe.shapes[i]` → one `ShapeDefinition` (copy `shapeKind`←`kind`, `geometry`, `draw`, `bounds`,
`a11y`, `actions`, hit/tuning) + one root-group part `{ defId, x:0, y:0 }`; `recipeId`←`recipe.id`,
`recipeName`←`recipe.name`; `recipe.edges` → `CatalogModel.connectors` is folded in via the existing
connector model (the forward `buildCatalogEdges` already emits `edges`; the reverse adds the small
inverse, or — simpler for slice 1 — carries `recipe.edges` through a passthrough field until the
connector round-trip is wired). **No abstraction reconstruction** — it never tries to recover reusable
parts/groups/offsets from a flat shape; "refactor a rich shape into reusable parts" is a *separate,
optional, later, user-initiated* action, never inferred on load. Because every recipe is just shapes,
this maps **plan-tree, drill, and any future recipe** alike — that universality IS the reusable
capability.

The headline guarantee: `buildRecipeFromCatalog(buildCatalogFromRecipe(r))` **deep-equals** `r` for
every recipe `r` in the coverage suite (§6) — kf-drill, a full-surface synthetic recipe, and the
plan-tree parity recipe.

## 5. The slice ladder (to the byte-parity round-trip-edit ceiling)

The slice-1 model must hold **any** recipe as data (so the round-trip is byte-identical for the whole
coverage suite); what's deferred is the **editing GUI** per construct, lit up slice by slice.

| Slice | Delivers | De-risks |
|---|---|---|
| **1 — general open + round-trip (this slice)** | `ShapeDefinition` (full `RecipeShape` surface) + `recipeId/Name`; forward branch; `buildCatalogFromRecipe` (any recipe); "Open recipe" loads a recipe into the model + renders live; **general round-trip gate** over the coverage suite (kf-drill + full-surface synthetic + plan-tree). GUI lists shapes; rich params raw/read-only. | The integration + generality: does open → model → save round-trip byte-identical for **any** recipe? |
| **2 — expression editor** | A literal-or-expression control so `{calc}`/`{bind}` draw/bounds params are GUI-editable; surface `{when}` on a primitive. | The hardest, most novel editor UX. |
| **3 — geometry + polyline editors** | point/box/polyline archetype control (edit *behavior* is free from the brick) + polyline `points`/multi-primitive `draw` editing. | New geometry/primitive authoring. |
| **4 — i18n a11y editor** | a11y `name` as `{i18n}` key (+ nested `params`, `{when/then/else}`) + role control. | Closes the a11y construct. |
| **5 — persistence + open-UX** | `catalog-document` serialize/deserialize + `CATALOG_STORE` handle `ShapeDefinition`; open-from-cookbook/catalog UX; unsupported-on-load notice for any residual gap. | The save/reopen lifecycle. |

(The ladder is the design-of-record; each slice is a go/no-go gate. We may stop early; we may reorder
2–4. Slice 1 is committed.)

## 6. Slice 1 — detail

**Scope:** `domains/studio/libs/board-editor` only. **Zero `design-system-core`/kernel change** — the
brick already interprets calc/geometry/i18n (core@2.8.0, proven by the cookbook rendering
`kfDrillRecipe` live today). **No publish, no pnpm release dance.** ADR-176-safe.

**Files**
- `catalog.ts` — add `ShapeDefinition` (mirrors the full `RecipeShape` surface) to the union (importing
  `PrimitiveTemplate`/`RecipeValue`/`RecipeAction`/`RecipeShape` from core); add `recipeId?`/`recipeName?`
  to `CatalogModel`; add the forward branch in `buildRecipeFromCatalog`. The plan-tree code paths are
  byte-unchanged.
- `catalog-from-recipe.ts` (new, + `.spec.ts`) — `buildCatalogFromRecipe(recipe): CatalogModel`, the
  general reverse-mapper (§4.3) — maps **any** `EditorRecipe`.
- `recipe-roundtrip.spec.ts` (new) — the **headline gate**, a **coverage suite** proving generality:
  `expect(buildRecipeFromCatalog(buildCatalogFromRecipe(r))).toEqual(r)` for each `r` in
  `[kfDrillRecipe, FULL_SURFACE_RECIPE, planTreeParityRecipe]` —
  - `kfDrillRecipe` from `@de-braighter/board-recipes` (already a studio dep) — the hard real fixture
    (geometry/calc/bind/i18n/when).
  - `FULL_SURFACE_RECIPE` (a new local synthetic fixture) — exercises every construct kf-drill omits:
    `{tpl}`, a11y `description`, all six `RecipeAction` ops, `hit`/`nudge`/`handleRadius`/`segTol`/`minWH`,
    and `edges`. This is what makes the capability demonstrably **general**, not kf-drill-shaped.
  - `planTreeParityRecipe` — the recipe `buildRecipeFromCatalog` already emits for the plan-tree fixture,
    proving the general model round-trips the **existing** class too.
- `catalog-designer.component.ts` (+ `.spec.ts`) — an **"Open recipe"** affordance: loads a recipe
  (kf-drill the first entry) via `buildCatalogFromRecipe` into the editor model, so the existing
  `buildRecipeFromCatalog → interpretRecipe → <ds-board-kit>` preview path renders it live. The
  navigator lists the shapes; rich params are shown raw/read-only (editors are slices 2-4).

**What slice 1 does NOT do:** edit calc/bind/geometry/polyline/i18n in the GUI (slices 2-4); persist
the opened recipe through `catalog-document`/`CATALOG_STORE` (slice 5). Slice 1's headline is the
**general** in-memory round-trip + live open, not the save/reopen lifecycle.

**Parity invariant:** `catalog-parity.spec.ts` + `catalog-document.spec.ts` stay green (additive, the
plan-tree path is byte-unchanged).

## 7. The two hard seams — resolved, on the record

- **Offset-vs-expression (forward):** does **not** arise. The forward rich-shape branch passes
  `RecipeValue`s through verbatim and never offset-sums; the plan-tree branch keeps offset-summing
  static numbers. The two branches never collide (drill shapes have no offset composition — §3.1). A
  test asserts the rich-shape branch leaves `{calc}`/`{bind}` values untouched.
- **Reverse-mapper ambiguity:** does **not** arise. `buildCatalogFromRecipe` maps each flat shape to
  the model's *general* `ShapeDefinition` form (near-identity); it never reconstructs the reusable-parts
  abstraction. The byte-parity gate (§6) is the proof.

## 8. ADR (designer-first)

A short ADR in `layers/specs/adr/` (next free number; status `proposed` → `ratified` per the validator
enum — *not* "accepted") recording the convention:

- **Decision:** the studio catalog-designer's authoring model takes a **rich shape (the full published
  `RecipeShape` surface) as its general authoring atom** — `ShapeDefinition` carrying `RecipeValue` draw
  (calc/bind/tpl/when/i18n) + `geometry` + rich a11y + actions + hit/tuning — with the existing
  primitive/group placement preserved as compile-down sugar that lowers into the same `RecipeShape`
  output. The model therefore expresses the **whole** recipe surface and can open/round-trip **any**
  board-kit recipe (plan-tree, drill, future) — a reusable, general modelling capability, not a
  fixture-specific feature.
- **Why a general shape atom (not a fixture feature):** every recipe is "just shapes," so a model whose
  atom is a full `RecipeShape` covers the entire surface with one coherent model + one expander + one
  output type; the fixture analysis proves rich shapes need no offset composition, so the path is
  additive and parity-neutral.
- **ADR-176 posture:** zero kernel/brick change — board-kit is a brick the studio composes; the model +
  reverse-mapper are studio-internal; nothing is stored in the kernel. The four concerns are untouched.
- **Relates-to:** ADR-279 (calc/geometry/i18n the model now authors), ADR-280 (the board-recipes
  content layer the fixture ships from), ADR-168/ADR-176.
- **Scope note:** studio-internal model decision (cf. ADR-280 which was a cluster-wide distribution
  convention). The founder elected an ADR anyway for the designer-first record.

## 9. Testing & verification

- **Headline:** `recipe-roundtrip.spec.ts` — the **coverage suite** (§6): deep-equal round-trip for
  kf-drill + the full-surface synthetic recipe + the plan-tree recipe. This is the load-bearing gate
  *and* the generality proof.
- **Reverse-mapper unit:** `catalog-from-recipe.spec.ts` — per-construct mapping (each geometry
  archetype; each `RecipeValue` kind — `bind`/`tpl`/`when`/`calc`/`i18n` — survives verbatim; `actions`
  carried only when present, never empty-vs-absent drift; recipe id/name + `edges` carried).
- **Forward branch:** a `ShapeDefinition` emits its shape directly with `RecipeValue`s untouched and no
  offset applied; a mixed catalog (plan-tree parts + a rich shape) emits both correctly.
- **Parity invariants:** `catalog-parity.spec.ts` + `catalog-document.spec.ts` green (plan-tree
  byte-unchanged).
- **Live open:** browser-verify the "Open recipe" affordance renders kf-drill's shapes in the preview
  across a skin (night/ivory/clinical), 0 console errors.
- Every non-trivial PR: verifier wave (`local-ci` + `reviewer` + `qa-engineer` + `charter-checker`)
  with `isolation: "worktree"`; twin ritual after merge; `Producer:`/`Effort:`/`Effect:` lines
  (self-observing `cycle-time` + `findings`).

## 10. Open questions

- **OQ-1 — rich-shape definition `kind` discriminant.** `'shape'` is proposed; confirm it doesn't
  collide with any existing `DefinitionKind` usage (`PrimitiveKind | 'svg' | 'group'` — `'shape'` is
  free). Verify at impl.
- **OQ-2 — navigator placement for rich shapes.** Where the 8 drill shapes surface in the "(3)" IA
  left rail (a new "Shapes" group vs under "Primitives"). UX detail; resolve in slice 1 build or defer
  to a slice-2 UX pass. Read-only in slice 1, so low-stakes.
- **OQ-3 — `actions` round-trip.** The drill fixture omits `actions` (relies on geometry synthesis);
  the reverse-mapper must carry `actions` only when present (omit when absent) so the round-trip is
  byte-exact. Covered by the gate; flagged so the implementer preserves absence-vs-empty.
- **OQ-4 — slice ordering 2↔3↔4.** Expression editor first (hardest) is the lean; could reorder if a
  visible win (geometry) is preferred earlier. Decide at slice-1 retro.

## 11. Execution

- **Vehicle:** brainstorm (done) → this spec → `writing-plans` (slice 1) → subagent-driven execution
  with the verifier wave. Founder standing grant: auto-approve + auto-merge at all levels.
- **Order:** ADR (proposed) → slice-1 build (TDD, bottom-up: reverse-mapper + gate → forward branch →
  open affordance) → ratify ADR on merge.
- **Hygiene:** studio pins **npm** (`npm test` / `npm run build`, not pnpm); the workbench carries
  untracked WIP — never `git add -A`, explicit paths only; wave agents use `isolation: "worktree"` and
  run no git ops in shared clones ([[wave-agents-stash-main-clone-incident]]).
