---
product_key: board-editor-studio
source: docs/ideas-inbox/Board Editor Studio (1).zip
intake_date: 2026-06-21
status: intake
---

# Dossier Record — Board Editor Studio

## Essence

Board Editor Studio is the **next-generation studio UI** for authoring `<ds-board-kit>` board editors as declarative DATA — the visual evolution of the already-shipped "Editor Recipe" / Recipe Designer (`domains/studio`, slices 1–3). Where the shipped slices are essentially a single-form-per-shape editor with a JSON mirror, this prototype reframes the same authoring job as a **catalog IDE**: a navigable library of reusable primitive- and composite-**definitions**, placed by **reference** into a node's draw stack, with a persistent live preview, a code view, and full cross-reference / unused-definition bookkeeping. The prototype is a single self-contained `DCLogic` component (`Board Editor Studio.dc.html`) rendering a 3-pane studio (left rail · catalog main · right live-preview) over the de-braighter design-system bundle. (`Board Editor Studio.dc.html`, `screenshots/prims.png`)

Core claims the prototype makes concrete:

- **Definitions vs instances** — a primitive/composite is authored ONCE as a *definition*; it is then *placed* (as an instance, carrying its own `{x,y}` offset + own id) into composites or onto the node's layer stack. Editing the definition updates every instance everywhere ("Edit a definition once and every instance across composites and nodes updates"). This is a DRY/component-reuse model that slices 1–3 do not have. (`Board Editor Studio.dc.html` lines 377–404, 577)
- **Composites** — a new first-class definition kind: a reusable *group* of other definitions (primitives or nested composites), with cycle-prevention (`wouldCycle`/`defContains`) and recursive draw. (`Board Editor Studio.dc.html` lines 358–359, 480–484)
- **A catalog / library navigator** — a left rail grouped Build · Compose · Primitives, each library a filterable card grid with live mini-previews, per-kind counts, and a "+ New" affordance. (`Board Editor Studio.dc.html` lines 600–604, 86–119)
- **Cross-reference intelligence** — every definition tracks "Used in N places", a "Used in" back-reference list with click-to-navigate, an "unused" flag, and a guarded drop ("remove those uses to drop it"). (`Board Editor Studio.dc.html` lines 362–374, 522–544)
- **A new `svg` primitive** — raw SVG markup with `{label}/{kind}/{meta}` token substitution, alongside rectangle/text/circle/line. (`Board Editor Studio.dc.html` lines 344, 424, 471)
- **Board-level settings as a dedicated surface** — `kind`, accessible-name template (token-bearing), per-interaction toggles (add-child/remove/re-parent), and a `{x,y,w,h}` bounds box every node is drawn within. (`Board Editor Studio.dc.html` lines 140–170, 631–636)
- **Persistent live preview wired to a representative tree** — a 6-node Workspace→Servers/Tools→leaf sample tree, an `auto-render` indicator, "N nodes · M drawn" stats, and a diagram↔code toggle with copy-JSON. (`Board Editor Studio.dc.html` lines 290–297, 492–501, 264–276; `screenshots/prims.png`)

## Vision delta vs shipped Editor Recipe (slices 1–3)

Each bullet is a NEW surface / capability / interaction the prototype shows that is NOT in shipped slices 1–3. (Shipped today: single-shape recipe designer → per-primitive add/edit/remove/reorder/change-type → multi-shape recipes with cross-kind add-child; flat `shapes[]` of templated primitives, form ↔ board ↔ JSON.)

- **Definition/instance separation (reuse-by-reference).** Slices 1–3 inline every primitive into a shape; here a primitive/composite is a named *definition* placed as *instances* that carry only `{ref,x,y,id}`. One edit propagates everywhere. This is the single biggest model change. (`Board Editor Studio.dc.html` lines 322–332, 377–404)
- **Composites — nested reusable primitive groups** as a first-class kind, with recursive rendering and **cycle detection**. Slices 1–3 have no grouping/nesting concept. (`Board Editor Studio.dc.html` lines 327–330, 358–359, 480–484)
- **A catalog/library IDE shell**: left-rail navigator (Build / Compose / Primitives sections) switching the main pane between Node-layers, Board-settings, Composites, and per-primitive-kind card libraries — vs the single editing form of the shipped studio. (`Board Editor Studio.dc.html` lines 600–604; `Board Editor Studio.html`)
- **Card-grid library browser** per kind: filterable search ("Search composites…"), result count ("N of M"), live mini-preview thumbnails, per-card meta summary, and an "Unused/Used in N places" relation footer. (`Board Editor Studio.dc.html` lines 86–107, 549–564, 583)
- **Detail drawer (slide-over editor)** per definition: rename, live preview, typed field grid, composite "Parts · references" editor, "Used in" back-references, "place in node →", and a guarded "Drop definition". A focused inspector surface absent from slices 1–3. (`Board Editor Studio.dc.html` lines 174–247, 518–547)
- **Cross-reference graph + usage analytics**: `usersOf` / `usageCount` / `isUnused`, "Used in N places", click-to-navigate back-refs, and dead-definition cleanup ("Drop — unused" trash on cards). Slices 1–3 track no usage. (`Board Editor Studio.dc.html` lines 362–374, 522, 558–560)
- **`svg` raw-markup primitive** (token-substituted) — a 5th primitive beyond the rect/text/circle/line the shipped engine has, explicitly an escape hatch for arbitrary SVG. (`Board Editor Studio.dc.html` lines 300, 344, 424, 471, 513)
- **Board-level Identity + accessible-name templating**: an `accessible name` template field with `{label}/{kind}/{meta}` tokens — i.e. authoring the **a11yRole/aria-name** (a known slices-1–3 backlog item) directly in the UI. (`Board Editor Studio.dc.html` lines 147, 319; `screenshots/prims.png` "ACCESSIBLE NAME · {label}, a {kind}")
- **Interaction toggles as board config**: explicit on/off switches for Add-child / Remove / **Re-parent (drag)** — surfacing the board's supported interactions (incl. drag-reparent) as authorable data. (`Board Editor Studio.dc.html` lines 631–635; `screenshots/prims.png` INTERACTIONS panel)
- **Bounds box authoring** (`{x,y,w,h}`) — an explicit per-node bounding box that every node draws within, used to seed primitive defaults; no bounds concept in slices 1–3. (`Board Editor Studio.dc.html` lines 162–168, 338–345)
- **Persistent live-preview against a representative multi-node tree** (Workspace→Servers/Tools→leaves) with edges, node/drawn counts, and `auto-render` — vs the single-board preview of one shape. The authored shape is stamped across a *real tree of nodes*. (`Board Editor Studio.dc.html` lines 290–297, 492–501; `screenshots/prims.png`)
- **diagram ↔ code view toggle + copy-JSON** in the preview pane, emitting an authored-document shape (`{kind,name,interactions,bounds,definitions[],layers[]}`) where `definitions` use `parts:[{use,x,y}]` and layers reference by name (`use`). A different/richer serialization than the shipped flat `shapes[]`. (`Board Editor Studio.dc.html` lines 257–276, 448–452)
- **Per-instance offset editing + reorder/duplicate** via the "Instance Row" component (↑/↓ reorder, duplicate, delete, x/y offset inputs) used uniformly for node-layers and composite-parts. (`Instance Row.dc.html`; `Board Editor Studio.dc.html` lines 429–443)
- **Skin switcher across three ship skins** (exercir / strategir / operir) as a prop on the studio itself. (`Board Editor Studio.dc.html` line 284)

## Domain-model hints

This product is **BRICK / STUDIO territory** — it composes the substrate's `<ds-board-kit>` tree-renderer brick and authors EditorRecipe DATA; it does **not** author kernel concepts (no plan tree, no event log, no inference). Nothing here touches the four kernel concerns. The entities below are studio-side document/recipe model, not kernel primitives.

- **Definition** (entity) — `{ id, name, kind, ...fields }` where `kind ∈ {rectangle, text, circle, line, svg, composite}`. Primitive defs carry geometry/style fields; composite defs carry `children: Instance[]`. (`Board Editor Studio.dc.html` lines 322–331)
- **Instance** (entity) — a placement `{ id, ref, x, y }` pointing at a Definition by id; carries its own offset. Appears in composite `children` and in the node `root` layer stack. (`Board Editor Studio.dc.html` lines 327–332, 354)
- **Board/recipe document** (aggregate) — `{ kind, name(aria template), interactions{addChild,remove,reparent}, bounds{x,y,w,h}, definitions[], layers[] }` — the authored artifact, serialized to `shape.json`. (`Board Editor Studio.dc.html` lines 448–452, 271)
- **Interactions** (config) — add-child / remove / re-parent(drag) booleans = the board editor's supported gestures. (`Board Editor Studio.dc.html` line 631)
- **Usage / cross-reference** (derived graph) — "used-in" edges + counts are *computed on the fly* from definitions+layers, never stored — this is a natural fit for the "store generators, derive graphs" principle and should stay derived. (`Board Editor Studio.dc.html` lines 362–374)
- **Sample node tree** — the preview's `NODES` (Workspace/Servers/Tools/stripe-prod/github/vector-db with `meta` like "healthy"/"degraded") is illustrative seed data, NOT a model entity; flags that the studio needs a "preview against a sample tree" fixture. (`Board Editor Studio.dc.html` lines 290–297)

**Flag — possible design-system-core (brick) deltas to investigate at stage 4** (vs studio-only): (a) the `svg` raw-markup primitive and (b) composites/instance-references and (c) the `bounds` box may require the *interpreter* and/or `<ds-board-kit>` to understand reference-resolution and a 5th primitive kind. Slices 1–3 explicitly added multi-shape "zero core change"; whether definition/instance + svg + composites are also studio-only or need core/interpreter changes is the key stage-2/stage-4 open question. (charter note: brick changes live in `design-system`, not authored by this product.)

## UI surfaces inventory

- **Top bar** — product mark "Board editor / STUDIO", a `catalog` pill, optional search box ("Search {lib}…"), optional "+ New {kind}" primary button, and a "↺ Reset" ghost button. (`Board Editor Studio.dc.html` lines 30–55)
- **Left rail (catalog navigator)** — sectioned list: **Build** (Node layers [count], Board settings), **Compose** (Composites [count]), **Primitives** (Rectangles/Text/Circles/Lines/SVG, each with a count). Active-row indicator + per-kind icon. (`Board Editor Studio.dc.html` lines 60–72, 600–604)
- **Node-layers surface** — the node's draw stack: a list of placed Instance Rows (reorder/dup/del/offset) + a "+ place definition" picker that fans out all definitions to choose from. "top = front" draw-order semantics. (`Board Editor Studio.dc.html` lines 122–138, 573, 609–614)
- **Board-settings surface** — Identity (`kind` `#`-prefixed input + accessible-name token template), Interactions (Add-child / Remove / Re-parent toggles), Bounds (x/y/w/h number grid). (`Board Editor Studio.dc.html` lines 140–170)
- **Card library surface (per primitive-kind & Composites)** — heading + intro, result count, responsive card grid (mini-preview, kind label, name, meta summary, "Used in / Unused" footer, hover trash for unused), and a dashed "+ New {kind}" card. Empty-state ("No {lib} match '{query}'"). (`Board Editor Studio.dc.html` lines 75–119)
- **Detail drawer (slide-over)** — opens on a definition: icon+kind+unused badge, editable name, 130px live preview, then EITHER a typed primitive field grid (x/y/w/h/radius/fill/stroke/text/align/cx/cy/r/line coords/svg textarea) OR composite "Parts · references" (instance rows + "+ add part" type picker, cycle-filtered), a "Used in" back-ref chip row, sticky footer "place in node →" + guarded "Drop definition"/lock note. (`Board Editor Studio.dc.html` lines 173–247)
- **Right live-preview pane** — "live preview" status pill, diagram/code segmented toggle; **diagram** = the sample node-tree rendered with edges + "N nodes · M drawn" stats over a dotted grid; **code** = a `shape.json` card with traffic-light chrome, syntax-highlighted JSON, and a copy button. The `screenshots/prims.png` header also shows an "auto-render" pill and "6 nodes · 2 primitives / node" counters. (`Board Editor Studio.dc.html` lines 250–278; `screenshots/prims.png`)
- **Instance Row (sub-component)** — reusable row: type dot/composite glyph, ref name + kind label, ↑/↓ reorder, duplicate, delete (✕), and an offset x/y editor. Used in node-layers and composite parts. (`Instance Row.dc.html`)

## UI-prototype artifacts

- **`Board Editor Studio.dc.html`** — the canonical design-content source: a full `DCLogic` React-style component (template + 360-line `<script>` logic) implementing the entire 3-pane studio, definition/instance model, composites, cross-refs, preview, and JSON export. The most readable + complete structural view.
- **`Board Editor Studio.html`** (749KB) — the full self-bundling rendered prototype (Babel/React loader shell that hydrates the same DC component); interactive but adds no UI text beyond the `.dc.html`.
- **`Instance Row.dc.html`** — design-content for the reusable instance-row component (reorder/dup/del + offset editor).
- **`screenshots/prims.png`** — screenshot of the studio in its Board-settings/Identity state: left form (IDENTITY kind `card-node`, ACCESSIBLE NAME `{label}, a {kind}`, INTERACTIONS Add-child/Remove/Re-parent toggles) + right live-preview tree (Workspace→Servers/Tools→stripe-prod/github/vector-db), header "6 nodes · 2 primitives / node · auto-render".
- **`.thumbnail`** — prototype thumbnail image.
- **`_ds/…` bundle (15 files)** — the de-braighter design-system handoff the prototype renders on: `_ds_manifest.json` (tokens/skins/components inventory), `_ds_bundle.js`, `colors_and_type.css`, exercir UI-kit + forms CSS, README, oxlint adherence config. Inventory-only; the design tokens (3 skins exercir/strategir/operir, glass/neon language) confirm this targets the de-braighter design system.
- **`support.js`** — generic DC-runtime (parses `<x-dc>` templates, resolves `{{ }}` bindings, React-renders). Framework, not feature code.

## Market signal

None stated in dossier. The material is a pure UI/UX design prototype with no buyer, pain, pricing, or go-to-market claims. (The only product framing is internal: it is positioned as a "studio" for the de-braighter board-kit, consistent with the existing "studio product direction" — sell the path-BUILDER, not the paths.) Any market thesis must be supplied at stage 2 (opportunity-brief).

## Asset manifest

| Asset | Type | What it is |
| --- | --- | --- |
| `assets/Board Editor Studio.dc.html` | design-content (HTML+JS) | Canonical studio source — full DCLogic component (template + 360-line logic): 3-pane catalog IDE, definition/instance model, composites, cross-refs, live preview, JSON export. |
| `assets/Board Editor Studio.html` | rendered prototype (HTML, 749KB) | Self-bundling interactive build that hydrates the same DC component; no extra UI text. |
| `assets/Instance Row.dc.html` | design-content (HTML) | Reusable instance-row component (reorder/dup/del + x/y offset editor). |
| `assets/screenshots/prims.png` | screenshot (PNG) | Studio in Board-settings/Identity state + live preview tree; header counters + auto-render. |
| `assets/.thumbnail` | image | Prototype thumbnail. |
| `assets/support.js` | runtime (JS, 54KB) | Generic DC template-runtime/React renderer; framework not feature code. |
| `assets/_ds/.../README.md` | doc | Design-system bundle README. |
| `assets/_ds/.../_adherence.oxlintrc.json` | config | oxlint adherence ruleset for the DS bundle. |
| `assets/_ds/.../_ds_bundle.js` | JS | Design-system runtime bundle. |
| `assets/_ds/.../_ds_manifest.json` | JSON | DS inventory: tokens, 3 skins (exercir/strategir/operir), component cards, fonts. |
| `assets/_ds/.../colors_and_type.css` | CSS | Root color + type tokens. |
| `assets/_ds/.../design_handoff_exercir/colors_and_type.css` | CSS | Exercir handoff color/type tokens (full token set + skin scopes). |
| `assets/_ds/.../design_handoff_exercir/exercir/app.css` | CSS | Exercir app styles. |
| `assets/_ds/.../design_handoff_exercir/exercir/forms-dev.css` | CSS | Exercir forms (dev) styles. |
| `assets/_ds/.../design_handoff_exercir/exercir/forms.css` | CSS | Exercir forms styles. |
| `assets/_ds/.../design_handoff_exercir/exercir/welcome.css` | CSS | Exercir welcome-page styles. |
| `assets/_ds/.../preview/_card.css` | CSS | DS preview card styles. |
| `assets/_ds/.../ui_kits/exercir/app.css` | CSS | Exercir UI-kit app styles. |
| `assets/_ds/.../ui_kits/exercir/forms-dev.css` | CSS | Exercir UI-kit forms (dev) styles. |
| `assets/_ds/.../ui_kits/exercir/forms.css` | CSS | Exercir UI-kit forms styles. |
| `assets/_ds/.../ui_kits/exercir/welcome.css` | CSS | Exercir UI-kit welcome styles. |

**Nothing-lost check: 21 manifest rows == 21 copied files == 21 source files. PASS.**

## Open questions

- **Studio-only vs design-system-core changes** — does the definition/instance reference model, the `svg` raw-markup primitive, and composites require changes to `interpretRecipe` and/or the `<ds-board-kit>` brick (reference resolution, a 5th primitive kind), or can they be lowered entirely studio-side into the existing `shapes[]` recipe at export time? Slices 1–3 were "zero core change"; this must be re-decided. (stage 2 + 4)
- **Document/recipe schema migration** — the prototype emits a richer document (`{kind,name,interactions,bounds,definitions[],layers[]}` with `parts:[{use}]` name-references) than the shipped flat `shapes[]`. Is this a new recipe schema version, or does it compile down to the existing one? Migration/compatibility path is unspecified. (stage 4)
- **Persistence** — the prototype is purely in-memory (Reset wipes state; copy-JSON is the only export). The shipped backlog already lists recipe persistence (save/load/name); the catalog model raises the bar (named library of definitions). Where do definitions/composites live — same recipe doc, or a shared library across recipes? (stage 2 + 4)
- **Reference integrity by name vs id** — internally instances reference definitions by **id**, but the exported JSON references by **name** (`use: <defName>`). Round-trip/rename safety and collision handling are unspecified. (stage 4)
- **Drag/free-layout & re-parent gesture** — "Re-parent (drag)" is a toggle and instances carry x/y offsets, but the prototype edits offsets numerically only; the actual drag-to-reparent / free-layout authoring gesture (a known slices-1–3 backlog item: "free-layout / richer hit-regions") is declared but not demonstrated. Scope unclear. (stage 2)
- **`svg` primitive safety** — raw user SVG markup is injected via `dangerouslySetInnerHTML`; sanitization/escaping posture for an end-user/tenant-authoring scenario is unaddressed. (stage 4)
- **Sample-tree fixture** — the live preview needs a representative node tree to stamp the shape across; is the sample tree fixed, user-supplied, or pulled from a real board? Not specified. (stage 2)
- **a11yRole vs accessible-name** — the prototype authors the accessible *name* template but not the a11y *role* (a separate slices-1–3 backlog item); whether role authoring is in scope here is unclear. (stage 2)
- **Scope of "catalog" framing** — the "catalog" pill + library navigator hint at managing many shapes/boards, but the prototype only ever edits ONE board's definitions. Is multi-board/multi-recipe catalog management in scope, or is "catalog" just the per-board definition library? (stage 2)
- **eject-to-TS** — the shipped backlog includes eject-to-TS (`BoardRegistry`); the prototype only emits JSON. Whether eject is part of this vision is unstated. (stage 4)
