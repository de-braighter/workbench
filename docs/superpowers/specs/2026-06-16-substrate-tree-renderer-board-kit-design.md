---
title: "Board Kit — promoting the football board engine into a generic recursive presentation-tree renderer+editor (design)"
status: proposed
created: 2026-06-16
last_updated: 2026-06-16
authors: [stibe]
relates-to:
  - docs/superpowers/specs/2026-06-07-substrate-tree-renderer-north-star.md
  - docs/superpowers/specs/2026-06-07-football-board-runtime-design.md
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
  - layers/specs/adr/adr-168-design-system-eyecatchers-split-workshop-graduates-into-production.md
  - layers/specs/adr/adr-127-kernel-substrate-v1.md
  - layers/specs/adr/adr-154-algebraic-effect-declarations-and-composition-operators.md
ratified-by: []
---

# Board Kit — generic recursive presentation-tree renderer + editor

> **Promotion design, not yet ratified.** This document promotes the deferred
> "Thread A" of the football board runtime epic — a generic renderer+editor over
> presentation trees with a pack-registered render-definition registry — from the
> [north-star capture](2026-06-07-substrate-tree-renderer-north-star.md) (which was
> deliberately held at `proposed` pending a second consumer) into an actionable
> design. It is `status: proposed`; it graduates to a ratified
> `layers/specs/concepts/substrate/` concept + ADR(s) at landing (see §10).

---

## 1. Why now — the deferral's release condition is met

The north-star capture set exactly one condition for building cluster-level renderer
infrastructure (north-star §5, applying [ADR-176 §3](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)
*"promotion is demand-driven, never speculative"*): **a second, genuinely-different
pack** that needs to render-and-edit a tree of typed nodes.

That condition is now satisfied. Two genuinely-different packs pay the same tax:

- **`pack-football`** built a domain-free board engine (board-runtime epic #214,
  slices S0–S5): `BoardGeometry`, `BoardEditorStore`, `board-ops`, render fragments,
  a `BoardPersistencePort`. Three football surfaces converged onto it. But it lives
  inside `scope:pack-football`.
- **`pack-kids-football`** could not reuse it — the Nx tag boundary forbids a
  `scope:pack-kids-football` lib importing `scope:pack-football`. So slice 4
  **forked** the engine's architecture by hand into `drills/sketch/sketch-ops.ts`,
  whose own header documents the fork and names this extraction as its upgrade seam.

Two real, forced re-implementations of one capability is the demand signal the
deferral was waiting for. This design is therefore an **earned extraction**, not
speculative platformization.

### 1.1 Decisions taken during brainstorming (the bets)

| Axis | Decision | Consequence |
|---|---|---|
| **Generality** | Full **recursive** presentation-tree renderer (not a flat board) | The kernel-plan-tree projection becomes first-class; designs for tree shapes the boards don't have. |
| **Driver** | A **reusable platform asset** (CDK-grade primitive), on its own merits | No single committed forward consumer; the two real boards + one proving consumer keep the API honest. |
| **Proof** | Build the brick **+ a new plan-tree authoring consumer** (studio seed) | Existing boards are *not* migrated in this arc — they are prior-art; de-fork is a later arc. |
| **Edit depth** | **Full structural authoring** (insert / delete / reparent + node-property edit, auto-layout) | The engine must handle a *structural* edit modality the proven code never did. |
| **Engine architecture** | **Approach A — snapshot-undo + pure per-kind transforms** (not a command algebra) | Sidesteps the north-star's deepest risk (command inversion); generalizes the proven `*-ops` pattern. |

These are eyes-open bets. The platformization-ahead-of-strict-demand risk
([ADR-176 "Alternatives"]) is consciously accepted; §9 states it plainly.

---

## 2. The governing principle — the two-trees discipline (unchanged)

The entire coherence of this work depends on never conflating two distinct trees
(north-star §2):

- **The kernel plan tree** (kernel concern #1, [ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md)):
  a strictly single-parent tree of intervention nodes carrying typed effect
  declarations, kept ADR-176-minimal — *interventions + effects, nothing about
  representation*.
- **A presentation / render tree**: a tree of `{ id, kind, props, children }`
  render-nodes. It is a **derived view** ([ADR-176 §4](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)
  *"store generators, derive graphs"*), never authoritative persisted state.

Multiple sources **project into** a render tree. The kernel plan tree projects into
one (a derived view; the kernel is untouched). A board's stored geometry projects
into one. A twin/posterior projects into one. **One renderer consumes all of them;
each source owns its projection.** Board geometry and render-tree positions never
enter the kernel — they fail the ADR-176 inclusion test as *representation*, the
verdict ADR-176 already recorded for the drill diagram.

---

## 3. Architecture & boundaries

Three layers, three owners:

```
┌─ HOST (consumer app) ───────────────────────────────────┐
│  • projection:  source → RenderNode tree (derived view)  │
│  • persistence: committed tree-delta → wire              │
│      – plan tree → kernel tree-edit verbs                │
│      – boards    → geometry writes (later migration)     │
└──────────────────────────────────────────────────────────┘
            │ feeds RenderNode tree         ▲ emits {tree, intent?}
            ▼                               │
┌─ ENGINE / BRICK (generic, domain-free) ──────────────────┐
│  render orchestration · tool+selection state · pointer/  │
│  keyboard routing · focus mgmt · SNAPSHOT undo/redo       │
│  → knows nothing about football, plans, or kernels        │
└──────────────────────────────────────────────────────────┘
            │ looks up "how to draw/edit kind K"
            ▼
┌─ REGISTRY (per-kind RenderDefinitions, consumer-authored)┐
│  draw · bounds · describe(a11y) · edit?(pure transforms)  │
└──────────────────────────────────────────────────────────┘
```

### 3.1 Where each piece lives

- **Engine + registry mechanism** → a new **design-system Angular brick**, working
  name **`board-kit`** (provisional), in `layers/design-system`, published as a
  `@de-braighter/*` package. ADR-168: *"anything that paints pixels lives in
  design-system; packs compose, do not author."* Being a published design-system
  package is precisely what dissolves the cross-pack fork problem — design-system is
  importable by every pack, so football and kids-football can both consume it without
  violating Nx boundaries.
- **`RenderNode` type + `RenderDefinition` interface** → a **framework-agnostic
  module inside the brick package** (no Angular import), **not**
  `@de-braighter/substrate-contracts`. This deliberately resolves the north-star §7
  open question *away* from substrate-contracts: a presentation type in the
  kernel-contracts package would blur the two-trees line and invite future code to
  treat render-nodes as kernel concepts. The kernel never imports this. If a
  non-UI/server-side projection ever needs the type, *that* is the trigger to promote
  it to a shared `design-system-core` — not before.
- **Projection + persistence functions** → owned by each **host**, never the brick.
  The brick never learns what a squad, a formation, or an intervention *means*.
- **Proving consumer** (plan-tree authoring, studio seed) → a new thin consumer that
  pins the published brick; home in §7.

### 3.2 Multi-repo shape

The brick is built + published from `layers/design-system`; the consumer lives in a
domain and pins the published version (ADR-027 *"domains consume layers via published
packages"* — the same shape as exercir consuming substrate). A publish step
(build + publish design-system, bump the consumer pin) sits on the critical path.

---

## 4. Core contracts (illustrative — exact signatures locked in the plan)

### 4.1 The derived presentation node

```ts
interface RenderNode<P = unknown> {
  id: string;                      // stable identity → focus, selection, snapshot diffing
  kind: string;                    // registry key: 'football.marker', 'plan.intervention'
  props: P;                        // kind-specific payload — OPAQUE to the engine
  children: readonly RenderNode[]; // depth 1 = flat board; arbitrary depth = plan tree
}
```

Engine invariants are kept thin (the north-star §7 "which invariants?" question):
**single-root, unique ids, acyclic.** Per-kind child rules (e.g. "a phase node may
only hold intervention nodes") are *not* engine invariants — the consumer's edit
transforms enforce them. The engine treats `props` as opaque; only a
`RenderDefinition` reads it.

### 4.2 The registration unit — `RenderDefinition`

```ts
interface RenderDefinition<P = unknown> {
  kind: string;

  // ── DRAW half (required) ──
  draw(node: RenderNode<P>, ctx: DrawContext): SvgPrimitive[];   // declarative
  bounds(node: RenderNode<P>, ctx: DrawContext): Bounds;          // hit-test + layout
  describe(node: RenderNode<P>): A11yDescriptor;                  // WCAG 1.1.1 / 4.1.2

  // ── EDIT half (optional — omit ⇒ read-only kind) ──
  edit?: {
    tools: readonly ToolSpec[];                                  // affordances offered
    hitTest(node: RenderNode<P>, at: Point, ctx): HitResult | null;
    onGesture(g: Gesture, target: EditTarget, tree: RenderNode, ctx): EditResult | null;
    onKey(k: KeyEvent, target: EditTarget, tree: RenderNode, ctx): EditResult | null;
  };
}

interface EditResult { tree: RenderNode; intent?: EditIntent; } // see §5.3
```

The Approach-A crux: `onGesture`/`onKey` return **a new tree** (a pure transform;
`null` = rejected). No `invert`. A reparent and a marker-move are the same kind of
return value — a different tree. `edit` is optional: omit it and the kind is
read-only (a twin/posterior node can be view-only while a plan-intervention node is
fully editable — one renderer, mixed editability).

### 4.3 Draw model — declarative primitives + a component escape hatch

`draw` returns a **declarative `SvgPrimitive[]`** (circle/line/rect/path/text +
token-driven fill/stroke) that the engine renders inside *its own* managed `<svg>`.
This is what makes it genuinely "define a shape": you describe the shape as data; the
engine owns drawing, hit-routing, and snapshotting uniformly. For rich cases a kind
may instead name an Angular component (rendered via `ngComponentOutlet` in SVG
context) while still supplying data `bounds`/`hitTest` so pointer routing stays
engine-owned. Primitives are the 90% path; the component hatch is a named seam.

This uniformity is *why* hit-testing and undo work: because `draw`, `bounds`, and
`hitTest` all emit **data**, the engine holds the whole picture as a value it can
snapshot, diff, and route pointers over — the same reason `board-ops`/`sketch-ops`
are pure today.

### 4.4 Engine public API (Angular)

```ts
<ds-board-kit
  [tree]="renderTree()"        // host's projection output
  [registry]="registry"        // kind → RenderDefinition map
  [frames]="frames"            // coordinate/layout config per subtree (§5)
  (commit)="onCommit($event)"  // emits { tree, intent? } on every committed edit
/>
// Plus an injectable BoardKitEngine exposing: activeTool, selection,
// canUndo/canRedo, undo()/redo(), revertTo(tree), so the host can drive a
// toolbar / side panel and reconcile on persistence failure.
```

---

## 5. Data flow & layout

### 5.1 Layout strategies — one engine, boards *and* trees

A `frame` declares a coordinate space plus a layout mode:

```ts
type LayoutStrategy =
  | { mode: 'free' }      // positions authoritative, read from props — BOARDS
  | { mode: 'tree'; … };  // positions COMPUTED from structure (tidy dendrogram) — TREES
```

- **`free`**: a node's `x/y` lives in its props; edits set coordinates directly —
  exactly what `board-ops`/`sketch-ops` do.
- **`tree`**: the consumer *never* sets coordinates. The engine runs a tidy-tree
  layout pass to assign render positions from the tree's shape. A reparent changes
  structure → re-layout recomputes positions → the node visibly moves to its new
  parent. This is what makes structural editing visual without hand-positioning —
  and it is why we do not need a per-modality plugin split (it is one engine with a
  per-frame layout mode).

### 5.2 The edit cycle

```
source ──project──▶ RenderNode tree ──layout──▶ positioned tree ──draw──▶ SVG
  ▲                                                                          │
  │                                                              pointer/key │
  │                                                                          ▼
  persist ◀──commit── snapshot+apply ◀── registry.onGesture ◀── digest+hitTest
```

1. **Project** (host): source → `RenderNode` tree.
2. **Layout** (engine): assign positions per the frame's strategy.
3. **Draw** (engine): `registry.draw(node)` → primitives → managed `<svg>`;
   `describe()` → a11y.
4. **Digest + route** (engine): raw events → semantic `Gesture`, routed to the hit
   node via per-kind `hitTest`.
5. **Transform** (registry): `onGesture` → `EditResult` (new tree + optional intent).
6. **Snapshot + apply** (engine): push the prior tree to the undo stack, set the
   working tree, re-layout, re-render.
7. **Commit** (engine → host): host persists.

### 5.3 The `intent` refinement — snapshot-undo *and* precise persistence

Snapshot-undo only needs the *tree* (Approach A). But persistence to kernel verbs
needs the *operation* — and you cannot reliably recover "reparent" by diffing two
trees (it looks identical to delete-then-add). So an edit transform optionally tags
what it did:

```ts
EditResult = { tree: RenderNode; intent?: EditIntent }; // e.g. { op:'reparent', nodeId, newParentId }
```

The engine **ignores `intent` for undo** (the snapshot is authoritative); it passes
it through `commit` so the host maps it to a precise kernel verb. Absent intent → the
host falls back to a tree-diff. This is how Approach A keeps undo dead-simple
(restore a tree) *and* persistence precise (a named verb) without the
command-inversion tax of Approach B.

### 5.4 Plan-tree host wiring

- **Projection**: kernel plan tree (synthetic in-memory first, behind a port) → tree
  of `{ kind:'plan.intervention', props:{ label, kindRef, effectSummary }, children }`.
- **Persistence**: `EditIntent` → kernel **tree-edit verbs** (add-child / delete /
  reparent / patch-node-metadata). Layout positions are **never** persisted —
  derived view, two-trees discipline holds.
- **Property editing**: select a node → side panel edits its effect declaration
  ([ADR-154](../../../layers/specs/adr/adr-154-algebraic-effect-declarations-and-composition-operators.md)) →
  a patch-node intent.

---

## 6. A11y boundary, error handling, testing, perf

### 6.1 A11y enforced at the registry boundary

The north-star rule (§6.4): a kind offering a drag tool without a keyboard path is a
*contract violation, not a runtime surprise*.

- **Engine owns the cross-cutting mechanics** — the big reuse win. Because the engine
  digests *both* drag *and* click-click into the **same semantic `Gesture`**, and
  routes *both* pointer and keyboard through `onGesture`/`onKey`, **WCAG 2.5.7 (drag
  alternative) is satisfied for free** the moment a kind implements a draw gesture.
  The engine also owns roving-tabindex focus, focus-restore after a structural edit
  (the "never fall to `<body>`" rule both current boards hand-roll), the focus ring,
  and ≥24px sizing on its own tool chrome (2.5.8, 2.4.3, 2.4.7).
- **Registry must supply per-kind**: `describe()` (1.1.1 / 4.1.2), `onKey` parity,
  and a keyboard equivalent declared on any drag tool.
- **`validateRegistry(registry)`** gates the contract in dev + tests: every drag tool
  must declare a keyboard path; every kind must have `describe`. A non-conformant
  registry throws in dev / fails a contract test — it cannot ship a partially
  accessible board.

### 6.2 Error handling

- **Per-node render isolation** — a `draw`/`bounds` that throws on one projected node
  renders a fallback placeholder + logs; it does not take down siblings.
- **Returned-tree validation** — the engine validates each `onGesture` result against
  its invariants (single-root, unique ids, acyclic); a violating return is rejected
  as a no-op + dev error, never applied.
- **Rejected edit** — `onGesture` → `null` = clean no-op (no snapshot, no commit, no
  announce).
- **Persistence failure** — optimistic-apply; on a kernel-verb rejection the host
  calls `engine.revertTo(prevTree)` and surfaces the error.
- **Projection failure** — host renders a load-error state, never a blank editable
  board (the kids-football `loadFailed` lesson — a spurious save must not clobber).

### 6.3 Testing (tiered, mirrors the cluster's contract-suite pattern)

- **Pure-core unit tests** — tree ops, both layout strategies, gesture digest,
  snapshot/undo, invariant validation. Deterministic; the bulk of coverage.
- **`renderDefinitionContract(def)` harness** — any kind runs against it: draw
  returns primitives, bounds finite, describe non-empty, edit transforms pure (same
  input → same output, no mutation), drag tools have keyboard paths. Same shape as
  `interventionCatalogRepositoryContract`.
- **A11y harness** — axe on the rendered board + a keyboard-only walkthrough (tab →
  activate → structural edit via keyboard → focus lands correctly).
- **Consumer e2e** — the plan-tree authoring flow, browser-verified.
- **Perf bench** — snapshot memory + layout time at realistic sizes, a gate not an
  assertion.

### 6.4 Perf

Snapshot-undo with **structural sharing** (unchanged subtrees shared by reference)
makes a snapshot O(edited-path-depth), not O(tree-size); undo depth capped (~24, like
`SKETCH_UNDO_DEPTH`). Tidy-tree layout is O(n), re-run on commit only. A spatial index
over `bounds` only if a board grows large (both real boards are ~30 elements).
Benchmarked before any large-tree consumer (twin) commits.

---

## 7. Proving consumer — plan-tree authoring (studio seed)

A thin surface where a user authors an intervention plan tree — add / delete /
reparent nodes + edit each node's effect declaration — rendered and edited *entirely*
through the brick.

- **Home**: its natural fit is the existing `domains/scenario-lab` (the agnostic
  engine the studio direction already names; stated next step "thin author → run →
  see vertical slice"). Confirmed at planning time — alternative is a fresh
  `domains/studio`.
- **Registers**: `plan.intervention` (draw = a node card: label + kindRef chip +
  effect summary; edit = add-child / delete / reparent via drag + click-click +
  select-to-edit) and a read-only `plan.root`. Layout = `tree`.
- **Projection**: a synthetic in-memory plan tree → `RenderNode` tree, behind a port.
- **Persistence**: `EditIntent` → in-memory verbs **shaped like the kernel's
  `TreeEditSchema`**, so the later swap to the live substrate runtime is a port
  implementation, not a rewrite. Layout positions never persist.

---

## 8. Slice ladder

Multi-repo; brick in `layers/design-system`, consumer in the domain.

| Slice | Repo | What ships |
|---|---|---|
| **S0 contracts** | design-system | `RenderNode`, `RenderDefinition`, `Frame`/`LayoutStrategy`, `Gesture`/`EditIntent`/`ToolSpec`/`SvgPrimitive`, `validateRegistry` — pure types + validator |
| **S1 pure core** | design-system | tree ops, both layout strategies, gesture digest, snapshot-undo w/ structural sharing — all pure, fully unit-tested (the generalized `board-ops`) |
| **S2 engine + draw** | design-system | `<ds-board-kit>` renders via registry `draw`, runs layout, a11y `describe` + focus mgmt + tool chrome — **read-only** |
| **S3 edit wiring** | design-system | pointer+keyboard → digest → `hitTest` → `onGesture`/`onKey` → snapshot/commit; click-click alt; `revertTo`; **showcase proves the SPATIAL modality** on a synthetic free-layout board |
| **S4 plan-tree projection** | scenario-lab | register `plan.*`, project synthetic tree, render with `tree` layout — **read-only explorer** (proves recursive + two-trees) |
| **S5 structural authoring** | scenario-lab | add-child / delete / reparent (drag + keyboard) + re-layout + persist via kernel-verb-shaped port + undo/redo — **the STRUCTURAL modality end-to-end** |
| **S6 node-property editing** | scenario-lab | select → side panel → minimal effect/label edit → patch intent (rich effect-algebra authoring deferred) |

The ladder front-loads the *known* (S0–S3 generalize patterns shipped twice; they
deliver a usable spatial board brick on their own) and isolates the *unknown* (the
novel structural-tree editing is quarantined to S4–S6 on a proven base). If S5 proves
harder than expected, S0–S3 still stand as a shippable asset.

---

## 9. Scope & risk (honest read)

- **Large, multi-repo arc** (brick + new consumer + 2 ADRs + doc graduation) —
  realistically several sessions, with a publish-in-the-loop step like substrate
  consumption.
- **Biggest technical risk is S4–S5** — the structural-edit + tree-layout path is
  genuinely new (no proven prior code, unlike the spatial path which *generalizes*
  `board-ops`). Mitigated by the ladder ordering (prove spatial first).
- **Platformization ahead of strictly-observed demand** — consciously chosen
  (CDK-grade asset bet). Mitigated by two real boards as prior-art + a real proving
  consumer; stated here so it is an eyes-open decision, not a drift.
- **Effect-declaration authoring is a rabbit hole** — deliberately minimal in S6;
  expansion deferred.

**Explicitly out of scope (named later arcs):** re-pointing the football +
kids-football boards onto the brick (de-fork); wiring the consumer to the live
substrate runtime; a twin/posterior read-only consumer; the component escape hatch
beyond a stub; multi-frame composition (a board embedded in a tree node).

---

## 10. Governance — ADR triggers (fire at landing)

This work fires the two ADRs the north-star §8 named as deferred until consumer #2:

- **ADR-239 — Generic substrate tree renderer + render-definition registry as a
  design-system brick.** Ratifies the renderer/registry/edit-engine living in
  design-system (ADR-168), fed by per-source projections; ratifies the two-trees
  discipline as governing (kernel plan tree ≠ presentation tree; geometry never
  enters the kernel).
- **ADR-240 — Render-tree contract home + shape.** Ratifies that the `RenderNode`
  type lives framework-agnostic inside the brick package (not substrate-contracts),
  its invariants (single-root / acyclic / unique-ids), and the `EditIntent` shape.

Because it is cross-cutting design-system work that touches the two-trees line, the
ADRs are designer-first / substrate-architect work at the **front** of the arc
(before S0 contracts). On landing, the north-star capture graduates to a ratified
`layers/specs/concepts/substrate/` concept doc with `ratified-by:` populated.

---

## 11. Open questions

| Question | Resolution / activating trigger |
|---|---|
| `RenderNode` type home | **Resolved**: framework-agnostic module inside the brick package, not substrate-contracts. Promote to `design-system-core` only when a non-UI projection needs it. |
| Draw model | **Resolved**: declarative `SvgPrimitive[]` primary; Angular-component escape hatch as a named seam. |
| Edit modality split | **Resolved**: one engine, per-frame `LayoutStrategy` (`free`/`tree`); no plugin split until a 3rd modality appears. |
| Consumer home | `scenario-lab` (likely) vs new `domains/studio` — confirm at planning time. |
| Render-tree invariants | single-root / acyclic / unique-ids (this arc). Per-kind child-rules are consumer-enforced, not engine invariants. |
| Command algebra (Approach B) | Deferred. Snapshot-undo + `intent` covers persistence; revisit only if collaborative/OT editing becomes a requirement (A→B is an internal upgrade behind the same registry interface). |
| Perf at large tree sizes | Benchmark gate (S1/S6); revisit before a twin/large-pedigree consumer commits. |

---

## Status

**proposed.** Promotes the north-star capture's deferred Thread A into an actionable,
sliced design under Approach A. Graduates to a ratified concept doc + ADR-239/240 at
landing (§10). Next step: an implementation plan (writing-plans), starting with the
designer-first ADRs and the S0 contracts.
