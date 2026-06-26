# Shape editor — editing the drill class in the catalog-designer (slices 2–5) — design

- **Date:** 2026-06-27
- **Status:** approved (founder — "drive all slices autonomously, gates pre-greenlit")
- **Owner:** `domains/studio/libs/board-editor` (+ `apps/board-editor-ui` for serve-verify)
- **Lineage:** [[board-recipe-authoring-model-arc]] (slice 1 — the model + read-only open)

## 1. Goal

Slice 1 shipped the general authoring **model** (a `ShapeDefinition` mirroring `RecipeShape`) and a read-only open. Slices 2–5 build the **shape editor**: select a loaded `ShapeDefinition` → edit every construct in the GUI → the recipe updates → byte-parity round-trip preserved. This reaches the arc's ceiling (open kf-drill, edit every construct, re-save byte-identical).

## 2. Established pattern (grounded in the current catalog-designer)

- **Editing is signal-based, not Reactive Forms / CVA.** A sub-editor takes `@Input() x` + `@Output() xChange`, and on edit **emits the whole updated object**; the host does `definitions.update(defs => defs.map(d => d.id === id ? updated : d))` (`definition-drawer.component.ts` + `catalog-designer.component.ts:1196-1199`). New editors follow this exactly.
- **Center pane is driven by `LibView`** (`catalog-designer.component.ts:66-68`): `{sel:'group',id} | {sel:'prim',kind}`. We **add `{sel:'shape',id}`** → the center pane renders `<studio-shape-editor>` for that shape.
- **`buildRecipeFromCatalog` lowers a `ShapeDefinition` verbatim** — so editing a `ShapeDefinition` and updating `definitions` flows to the recipe with **no forward-path change**. The round-trip gate stays green (it round-trips *unedited* recipes); a new test proves an *edit* survives forward→reverse→forward.
- **Closest analog:** `definition-drawer.component.ts` (edits one definition's fields + a live preview). The shape editor is an **inline center-pane** editor (cleaner than a drawer for a multi-section form).

## 3. The two new components

### 3a. `recipe-value-editor.component.ts` (the core reusable control)

Edits a published `RecipeValue` union (`number | string | {bind} | {tpl} | {calc} | {when,then,else} | {i18n}`):
- `@Input({required:true}) value: RecipeValue; @Input() label = ''; @Output() valueChange = EventEmitter<RecipeValue>;`
- A **kind `<select>`** + a kind-specific payload input. `kind()` derives the current kind from `value` (typeof number → `number`; string → `string`; `{calc}` → `calc`; `{bind}` → `bind`; `{tpl}` → `tpl`; `{i18n}` → `i18n`; `{when}` → `when`).
- **Slice 2 authors:** `number`, `string`, `calc`, `bind`, `tpl`. **Slice 4 authors:** `i18n`, `when` (nested). Until then, an `i18n`/`when` value renders **read-only** ("advanced — edit in a later slice") and **passes through unedited** (never dropped).
- Kind-change converts to a sensible default (`number`→`0`, `string`→`''`, `calc`→`{calc:''}`, `bind`→`{bind:''}`, `tpl`→`{tpl:''}`). Payload-change emits the new value of the current kind.

### 3b. `shape-editor.component.ts` (the inline center-pane editor)

Edits one `ShapeDefinition`:
- `@Input({required:true}) shape: ShapeDefinition; @Output() shapeChange = EventEmitter<ShapeDefinition>;`
- **Sections, lit up slice by slice:**
  - **Header** (slice 2): `shapeKind` (read-only) + `name` (editable text → `{...shape, name}`).
  - **Draw** (slice 2): a list of `shape.draw` primitives; each shows its `p` kind + a `<studio-recipe-value-editor>` per RecipeValue field (per-`p` field list: rect→x/y/w/h/fill?/stroke?/rx?/when?; circle→cx/cy/r/fill?/stroke?/strokeWidth?/when?; line→x1/y1/x2/y2/stroke?/strokeWidth?/dash?/when?; text→x/y/text/fill?/anchor?/when?; path→d/fill?/stroke?/when?). Editing field F of primitive i → `{...shape, draw: shape.draw.map((p,j)=>j===i?{...p,[F]:v}:p)}`.
  - **Bounds** (slice 2): x/y/w/h, each a `<studio-recipe-value-editor>`.
  - **Geometry + draw add/remove + polyline points** (slice 3).
  - **A11y** (slice 4): role + name (RecipeValue, i18n) + description; plus the `i18n`/`when` value kinds in the value editor.
  - **Actions / hit-tuning** (slice 5 or as needed).

## 4. The slice ladder (each: design-decided → plan → subagent-driven + wave → auto-merge → twin ritual → serve-verify)

| Slice | Delivers |
|---|---|
| **2 (this)** | model hardening (`ShapeDefinition extends Omit<RecipeShape,'kind'>`); `recipe-value-editor` (number/string/calc/bind/tpl); `shape-editor` (header + draw params + bounds); `LibView {sel:'shape',id}` + select-a-shape-part→edit wiring + host update on `shapeChange`. Editing a value updates the recipe; a round-trip-after-edit test. |
| **3** | geometry archetype control (none/point/box/polyline); add/remove/reorder draw primitives; polyline `points` editing; new draw-primitive creation. |
| **4** | a11y editor (role + `{i18n}` name with nested params + `{when,then,else}`); the `i18n`/`when` kinds in the value editor. |
| **5** | persistence: `catalog-document` serialize/deserialize + `CATALOG_STORE` handle `ShapeDefinition` (retire the deferral guards); the **meaningful preview render** (supply sample props per geometry archetype so opened recipes render, retiring the diagram placeholder); unsupported-on-load notice for any residual gap. |

## 5. Invariants (every slice)

- **Studio-only**, `libs/board-editor` (+ `apps/board-editor-ui`). Zero design-system-core/kernel/brick change. No publish. ADR-176-safe.
- **Additive + parity-neutral**: plan-tree authoring (primitive/svg/group) untouched; `catalog-parity.spec.ts` + `catalog-document.spec.ts` stay green; the slice-1 round-trip coverage gate stays green.
- **Pattern adherence**: signal `@Input/@Output` + emit-whole-object + host `definitions.update(map)`; standalone, OnPush; a11y (labels, keyboard, WCAG 2.4.3 focus on remove/reorder).
- **Serve-verify mandatory** before "done" (slice 1's lesson — tests+build green ≠ works; lib↔app wiring + host render only show up live).

## 6. Execution

Per slice: a focused plan in `docs/superpowers/plans/`, subagent-driven (per-task implementer + reviewer), verifier wave (local-ci + reviewer + qa-engineer; charter-checker on model-touching slices), auto-merge (standing grant), twin ritual, serve-verify. Producer/Effort/Effect on each PR.
