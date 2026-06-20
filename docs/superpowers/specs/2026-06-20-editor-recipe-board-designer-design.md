# Editor Recipe — visual board-editor authoring (slice 1)

> Design spec — 2026-06-20. Status: proposed. Author: orchestrator/claude-opus-4-8 [brainstorming].
> Scope: design-system (`design-system-core` + `design-system-angular`) + `domains/studio`. **Zero substrate-kernel change.**

## 1. Problem

The Board Kit (`design-system-core/board-kit`) is a generic SVG tree renderer/editor. A concrete
board editor is a **`BoardRegistry`** — `ReadonlyMap<string, RenderDefinition>` — and each
`RenderDefinition` is **arbitrary TypeScript**: a DRAW half (`draw()` → `SvgPrimitive[]`,
`bounds()`, `describe()`) and an optional EDIT half (`tools`, `hitTest()`, `onGesture()`, `onKey()`).
See `layers/design-system/libs/design-system-core/src/public/board-kit/render-node.ts`.

Today, configuring the board (which shapes exist, what they look like, what you can do to them)
means **writing those functions by hand** — e.g. `football-registry.ts`, the kids `kf-draw.ts`,
and the studio's `plan-kinds.ts`. That is powerful but **non-visual**: you cannot point-and-click
a new board editor into existence.

**Goal:** make a board editor authorable as **declarative data** — a *recipe* — that a generic
interpreter compiles into a live `BoardRegistry` at runtime (no rebuild), so a visual studio can
produce board editors by editing data instead of code.

### The altitude ladder (where this sits)

| Level | What it is | Status |
|---|---|---|
| L0 | The board engine (renderer + gesture/key dispatch) | exists |
| L1 | A `BoardRegistry` of `RenderDefinition`s — hand-written TS | exists (football, kids, `plan-kinds.ts`) |
| L2 | The existing studio authors a **document/tree** *within* a fixed registry | exists (`plan-author.component.ts`) |
| **L3** | **Author the registry itself — shapes/actions/rendering — as data** | **this spec** |

This spec is **slice 1** of L3: the schema, the interpreter, and a thin authoring screen with an
interactive preview, proven by re-expressing `plan-kinds.ts` as a recipe.

## 2. Goals / non-goals

**Goals (slice 1)**

- Define the **`EditorRecipe`** schema — declarative shapes (templated SVG primitives + prop
  bindings) and actions (built-in edit ops + triggers).
- Build **`interpretRecipe(recipe, opts): BoardRegistry`** — a pure function in
  `design-system-core/board-kit`. Both DRAW and EDIT halves.
- Build a thin **Recipe Designer** studio screen (`domains/studio`): author one shape + its actions,
  with a fully **interactive** live preview.
- **Parity proof:** a `plan-kinds` recipe fixture whose interpreted registry renders + edits
  identically to the hand-written `planKindsRegistry()`.

**Non-goals (deferred to later slices)**

- Multi-shape projects / recipe libraries.
- Persistence (save / load / share) and a recipe store. Slice 1 is in-memory + a read-only JSON view.
- An "eject to TypeScript" escape hatch for shapes the schema can't express.
- End-user / tenant authoring, permissions, multi-tenancy.
- Custom (non-built-in) actions or arbitrary computed draw logic.
- Free-layout boards (football-style absolute positioning) — slice 1 targets tree-layout shapes
  like the plan tree; `move` is in the schema but its studio affordance can wait.

## 3. The `EditorRecipe` schema — the data model

Lives in `design-system-core/board-kit` as pure types. A recipe is a named set of shapes; every
draw-primitive field is a **`RecipeValue`** (literal, prop binding, interpolation, or a minimal
conditional).

```ts
// recipe.ts (new, design-system-core/board-kit)
export type RecipeValue =
  | number
  | string
  | { bind: string }                                   // node.props[bind]  (fallback '' / 0)
  | { tpl: string }                                    // "{kindRef} · {effectCount}"  (props interpolated)
  | { when: string; then: RecipeValue; else: RecipeValue }; // truthiness of node.props[when]

/** A draw primitive whose fields are RecipeValues — mirrors SvgPrimitive 1:1. */
export type PrimitiveTemplate =
  | { p: 'circle'; cx: RecipeValue; cy: RecipeValue; r: RecipeValue; fill?: RecipeValue; stroke?: RecipeValue; strokeWidth?: RecipeValue }
  | { p: 'line';   x1: RecipeValue; y1: RecipeValue; x2: RecipeValue; y2: RecipeValue; stroke?: RecipeValue; strokeWidth?: RecipeValue; dash?: RecipeValue }
  | { p: 'rect';   x: RecipeValue; y: RecipeValue; w: RecipeValue; h: RecipeValue; fill?: RecipeValue; stroke?: RecipeValue; rx?: RecipeValue }
  | { p: 'path';   d: RecipeValue; fill?: RecipeValue; stroke?: RecipeValue }
  | { p: 'text';   x: RecipeValue; y: RecipeValue; text: RecipeValue; fill?: RecipeValue; anchor?: RecipeValue };

export type RecipeAction =
  | { op: 'add-child'; on: { key: string[] }; childKind: string; childProps?: Record<string, unknown> }
  | { op: 'remove';    on: { key: string[] } }
  | { op: 'reparent';  on: { gesture: 'drag' } }       // uses ctx.dropTarget
  | { op: 'move';      on: { gesture: 'drag' } };       // free-layout reposition

export interface RecipeShape {
  kind: string;
  draw: PrimitiveTemplate[];
  bounds: { x: RecipeValue; y: RecipeValue; w: RecipeValue; h: RecipeValue };
  a11y: { role: string; name: RecipeValue; description?: RecipeValue };
  actions?: RecipeAction[];                             // omit => read-only kind
}

export interface EditorRecipe {
  id: string;
  name: string;
  shapes: RecipeShape[];
}
```

### Worked example — `plan.intervention` as a recipe

```jsonc
{
  "id": "plan-tree", "name": "Plan Tree Editor",
  "shapes": [{
    "kind": "plan.intervention",
    "draw": [
      { "p": "rect", "x": 0, "y": 0, "w": 186, "h": 52, "rx": 8,
        "fill": "var(--bg-2,#0f1320)", "stroke": "var(--accent,#22d39a)" },
      { "p": "text", "x": 93, "y": 23, "anchor": "middle", "text": { "bind": "label" },
        "fill": "var(--fg-1,#e8ecf7)" },
      { "p": "text", "x": 93, "y": 40, "anchor": "middle",
        "text": { "tpl": "{kindRef}{effectSuffix}" }, "fill": "var(--fg-2,#94a3d2)" }
    ],
    "bounds": { "x": 0, "y": 0, "w": 186, "h": 52 },
    "a11y": {
      "role": "img",
      "name": { "tpl": "Intervention: {label}" },
      "description": { "when": "effectCount", "then": { "tpl": "{effectCount} effect declaration(s)" }, "else": "no effects" }
    },
    "actions": [
      { "op": "add-child", "on": { "key": ["a","A","Insert"] }, "childKind": "plan.intervention" },
      { "op": "remove",   "on": { "key": ["Delete","Backspace"] } },
      { "op": "reparent", "on": { "gesture": "drag" } }
    ]
  }]
}
```

> The `{when}` conditional exists precisely so the a11y `description` (`effectCount ? "N effect(s)"
> : "no effects"` in the hand-written version) reproduces exactly. The hand-written subtitle's
> conditional `· N effect(s)` suffix is expressed by a derived `effectSuffix` prop OR a second
> `{when}` in the `{tpl}`; the spec's parity fixture will pick whichever keeps the schema smallest
> (see §8 open question O1).

## 4. The interpreter — `interpretRecipe`

```ts
// interpret-recipe.ts (new, design-system-core/board-kit)
export interface InterpretOptions { idFactory?: () => string; }
export function interpretRecipe(recipe: EditorRecipe, opts?: InterpretOptions): BoardRegistry;
export function validateRecipe(recipe: EditorRecipe): RecipeValidationError[];
```

For each `RecipeShape` the interpreter produces a `RenderDefinition`:

- **`draw(node, ctx)`** — resolve each `PrimitiveTemplate`'s `RecipeValue` fields against
  `node.props` → `SvgPrimitive[]`. Value resolution: literal → itself; `{bind}` → `props[bind]`
  (fallback `''`/`0` by field type); `{tpl}` → interpolate `{name}` tokens from props; `{when}` →
  truthiness branch.
- **`bounds(node, ctx)`** — resolve the bounds `RecipeValue`s.
- **`describe(node)`** — resolve `a11y.role` / `name` / `description`.
- **`edit`** (only if `actions` present):
  - `tools` — **derived** from the declared actions (one `ToolSpec` per action; gesture/keyboard
    flags follow the trigger).
  - `hitTest` — slice 1: the bounds rect (a `rectHit` over resolved bounds). Pluggable later.
  - `onKey(k, target, tree)` — dispatch to the `key`-triggered actions: `add-child` →
    `insertChild(tree, target, makeNode(childKind, childProps))`; `remove` → `removeNode`.
  - `onGesture(g, target, tree, ctx)` — dispatch to the `gesture`-triggered actions: `reparent` →
    `reparentNode(tree, target, ctx.dropTarget)`; `move` → `{op:'move'}` patch.
  - All dispatch reuses the existing `tree-ops` (`insertChild`/`removeNode`/`reparentNode`/
    `patchNodeProps`) and returns the right `EditIntent` so the host persists precisely.

**Totality / errors.** `validateRecipe` is the author-time gate (unknown `childKind`, malformed
template, duplicate `kind`, empty `draw`) — it reuses `validateRegistry` on the interpreted output.
At **render time** the interpreter never throws: an unresolved `{bind}` yields a typed fallback,
an unhandled key/gesture is a clean no-op (the engine's existing contract). `add-child` needs an
id — `idFactory` is injected (defaults to a monotonic counter for tests; the studio passes a real
one).

**Placement rationale.** Pure, platform-agnostic, zero DOM/Angular → `design-system-core`, so
football / kids / studio can all consume it. This is a board-kit (brick) capability, not a kernel
concern — ADR-176-safe, "composes not authors."

New public exports from `design-system-core/board-kit/index.ts`: the recipe types,
`interpretRecipe`, `validateRecipe`, `RecipeValidationError`.

## 5. The Recipe Designer studio screen

New component `domains/studio/apps/studio-ui/src/app/recipe-designer/recipe-designer.component.ts`,
routed separately from the existing `plan-author`. Reactive-Forms-driven (per the forms-CVA
governance skill). Two panes:

```
┌─ Recipe Designer ───────────────────────────────────────┐
│  SHAPE                          │   LIVE PREVIEW          │
│  kind: [plan.intervention   ]   │  ┌───────────────────┐  │
│  ─ Primitives ─                 │  │   <ds-board-kit>  │  │
│   • rect  x0 y0 w186 h52 …      │  │  ┌────────────┐   │  │
│   • text  bind:label            │  │  │ My Label   │   │  │
│   • text  tpl:{kindRef}    [+]  │  │  │ plan.…     │   │  │
│  ─ Actions ─                    │  │  └────────────┘   │  │
│   [x] add-child  [x] delete     │  │  interactive:     │  │
│   [x] drag→reparent             │  │  A / Del / drag    │  │
│  ▸ Recipe JSON (read-only)      │  └───────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

- The in-progress recipe is a **signal**. Every form edit → `interpretRecipe(recipe())` →
  `registry` → the preview's `[registry]` updates **live**.
- The preview is a real `<ds-board-kit>` over a small **sample tree** (a root + a couple of nodes of
  the authored kind) and is **fully interactive** — you exercise the exact actions you just declared
  (press `A` to add, `Delete` to remove, drag to reparent), the magic moment of "I drew this with
  data."
- A read-only **Recipe JSON** panel shows the artifact being produced (the thing later slices will
  persist / ship).
- `validateRecipe` errors render inline next to the form (non-blocking — the preview shows the last
  valid interpretation).

## 6. Data flow

```
form edits ─▶ recipe (signal) ─▶ interpretRecipe() ─▶ registry ─▶ <ds-board-kit>
                                                                      │
                          preview-local sample tree (in-memory) ◀─ gestures/keys
```

No persistence and no kernel round-trip in slice 1 — the preview tree is local component state. This
keeps the slice about the **schema ⇄ interpreter ⇄ render** loop, which is the whole risk.

## 7. Testing

1. **Interpreter unit tests** (`design-system-core`): `RecipeValue` resolution (each variant +
   fallbacks); each action op produces the right tree mutation + `EditIntent`; `tools` derivation;
   `validateRecipe` catches each error class.
2. **Parity proof** (the de-risking test): a `plan-kinds` recipe fixture; assert interpreted
   `draw`/`bounds`/`describe`/`edit` outputs match the hand-written `planKindsRegistry()` for
   representative nodes + a delete / add-child / drag-reparent gesture. *This is the proof that
   "declarative" is expressive enough.*
3. **Component tests** (`domains/studio`): authoring loop — add a primitive, bind a prop, toggle an
   action, assert the preview registry + a simulated gesture behave as declared.

## 8. Known limits & open questions

- **L1 — expressiveness is bounded by the schema.** Anything the four `RecipeValue` variants +
  built-in ops can't express needs the (deferred) eject hatch. Slice 1 deliberately targets
  tree-style shapes; the `plan-kinds` parity proof is where we learn the next gaps.
- **O1 — the subtitle conditional.** The hand-written intervention subtitle is
  `kindRef + (effectCount ? " · N effect(s)" : "")`. Resolve in the spec→plan step by either a
  derived `effectSuffix` prop on the sample node or nesting `{when}` inside `{tpl}`; pick the
  smaller schema change.
- **O2 — `hitTest` beyond the bounds rect.** Football arrows hit-test along a line, not a box.
  Slice 1 ships rect-only hit; richer hit regions are a later schema addition (flagged, not built).
- **O3 — free-layout / `move`.** In the schema for completeness but the studio's drag-to-move
  affordance and a free-layout preview are deferred (slice targets tree layout).

## 9. Slice roadmap (context only — later slices get their own specs)

- **Slice 1 (this spec):** schema + interpreter (both halves) + thin Recipe Designer + parity proof.
- **Slice 2:** multi-shape recipes; persistence (recipe store, save/load); richer primitive editor.
- **Slice 3:** free-layout + richer hit regions (football-class shapes); "eject to TS" hatch.
- **Slice 4+:** sharing; end-user/tenant authoring; the studio-as-product surface.

## 10. Boundaries / governance

- Touches **design-system** (interpreter + types; `design-system-core` pure, `design-system-angular`
  unchanged in slice 1 — the preview reuses the existing `<ds-board-kit>`) and **domains/studio**
  (the new screen). **No substrate-kernel change.**
- Brick territory (ADR-168 — packs/studio consume bricks; the board kit is a brick). ADR-176-safe:
  this is a design-system capability, not one of the four kernel concerns.
- PR-gated in both repos → verifier wave (`local-ci` + `reviewer` + `charter-checker` + `qa-engineer`).
- `Producer: orchestrator/claude-opus-4-8 [brainstorming]` · `Effort: standard`.

## 11. Next

On approval → `writing-plans` to produce the slice-1 implementation plan (interpreter-first,
TDD: parity proof drives the interpreter; studio screen last).
