---
title: "Substrate tree renderer — one generic renderer+editor over presentation trees, with pack-registered render definitions (north-star capture)"
status: proposed
created: 2026-06-07
last_updated: 2026-06-07
authors: [stibe]
relates-to:
  - docs/superpowers/specs/2026-06-07-football-board-runtime-design.md
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
  - layers/specs/adr/adr-168-design-system-eyecatchers-split-workshop-graduates-into-production.md
  - layers/specs/adr/adr-127-kernel-substrate-v1.md
  - layers/specs/concepts/substrate/north-star-vision-capture-2026-05-17.md
ratified-by: []
---

# Substrate tree renderer — one generic renderer+editor over presentation trees

> **North-star capture, not a ratified design.** This document captures a
> generalization insight (founder, 2026-06-07) and steers a build that is already
> underway (the football board runtime epic). It is deliberately skeptical: the
> central job here is to draw the line between what is *coherent* (a generic
> renderer over a derived presentation tree) and what is *seductive but wrong* (jamming
> board geometry into the kernel plan tree). It is `proposed`, not `ratified`. It
> graduates to a ratified `layers/specs/concepts/substrate/` doc + ADR(s) **only at
> promotion** — i.e. when a second consumer demands it (see §5). Until then it
> changes nothing in the kernel, the contracts, or `design-system`.

---

## 1. Problem statement

Every domain we touch ends up reinventing the same thing: a way to **show and edit
a tree of heterogeneous, drawable nodes**. We have already paid for this several
times over inside a single pack.

pack-football alone carries **three board surfaces that grew up separately** and
duplicate each other, sharing only low-level SVG primitives — drill board, tactical
editor #1, coach matchday #2 — with **two undo/redo runtimes (`DrillEditorStore`,
`TacticalBoardStore`) that explicitly mirror each other**. That fragmentation is
documented in the board-runtime epic
([`2026-06-07-football-board-runtime-design.md`](2026-06-07-football-board-runtime-design.md) §1):
different frames (100×60 vs 100×120), different models (`DrillDiagram` vs
`TacticalBoard`), different renderers, different persistence — for what is, at root,
*one capability*: render-and-edit a tree of markers/arrows/zones.

Now widen the lens. The same capability recurs across the cluster:

- **Football boards** — markers/arrows/zones on a pitch (the epic above).
- **The kernel plan tree** — a tree of intervention nodes; we will want to *visualize
  and edit* it (a plan-tree explorer / twin cockpit).
- **The digital twin / posterior state** — plan + observations rolled up into a tree
  of node states with attached posteriors; a read-mostly explorer.
- **Herdbook / conservation** — pedigree trees, mating planners (already tree-shaped
  domain UIs built ad hoc per pack).

If each of these grows its own renderer + edit runtime, we pay the football tax N
times. The insight worth capturing: **most of these are the same generic problem —
draw and edit a tree of typed nodes — differing only in *what each kind of node
looks like and how it's edited*.** That difference is exactly the thing a *registry*
isolates.

**The thesis.** Model the content of any board (and more generally, any tree we want
to show or edit) as a **presentation tree** of `{ kind, …, children }` render-nodes,
and let packs **register render definitions** — "how a node of kind K is drawn and
edited." The output is **one globally usable renderer+editor for substrate
presentation trees**, reused across packs and domains. The renderer is generic; the
per-kind knowledge is pack-registered.

This is appealing precisely *because* it sounds like the kind of generalization that
over-reaches. The rest of this document is the discipline that keeps it honest.

---

## 2. The two-trees discipline (the central principle — get this right)

There are **two distinct trees**, and the entire coherence of this idea depends on
**never conflating them**.

### 2.1 The kernel plan tree (kernel concern #1 — "recurse the plan")

A **strictly single-parent tree of intervention nodes carrying typed effect
declarations** ([ADR-127](../../../layers/specs/adr/adr-127-kernel-substrate-v1.md);
the four concerns, north-star §20 P3). Per
[ADR-176](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)
this tree is kept *minimal*: it is interventions + effects, and **nothing about
representation**. The kernel must validate, query, and version it; reproducibility
(concern #4) depends on it.

Board geometry — markers, arrows, zones, coordinates, skins — is **not an
intervention-with-an-effect-declaration**. A pass-arrow on a board does not declare
a typed effect on an indicator. Therefore pushing board geometry into the kernel
plan tree **fails the ADR-176 inclusion test** (worked out explicitly in §2.3). The
plan tree is *not* the presentation tree, and we must resist the gravitational pull
to make it one just because both are "trees."

### 2.2 A presentation / render tree (a derived view — pack/infra territory)

A **render tree** is a tree of `{ kind, …props, children }` render-nodes. It is a
**derived view**, not authoritative persisted state. This is the embodiment of
ADR-176 §4 *"store generators, derive graphs"*
([ADR-176 §4](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)):
the renderer consumes a derived projection; nobody stores a second authoritative
tree.

The crucial move: **multiple sources PROJECT into a render tree.**

- The kernel plan tree **projects into** a render tree (a derived view — the kernel
  is untouched; no geometry is jammed into it).
- A football board's stored geometry **projects into** a render tree.
- A twin/posterior state **projects into** a render tree.

One renderer consumes all of them. Each source owns its own projection function. The
kernel keeps its single, minimal, single-parent plan tree; a *separate*, derived,
pack-or-infra-level presentation tree is what gets drawn.

### 2.3 ADR-176 inclusion test, run out loud

The test ([ADR-176 §1](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)):
something enters the kernel **only if both** (a) it is one of the four concerns,
**and** (b) it is needed by ≥2 packs *and* the kernel must validate/query/version it
(not merely store it).

**Candidate 1 — "board geometry as kernel plan-tree nodes."**

- (a) Core-concern? **No.** Geometry is *representation*. It is not "recurse the
  plan" (it declares no effect), not "flat the observation," not inference, not
  reproducibility. This is the exact verdict ADR-176 already recorded for the drill
  diagram in its worked precedent table: *"Drill diagram (dots/arrows/zone) — Fails
  (a): representation, not a core concern → pack-private payload in `metadata`."*
  ([ADR-176, "Worked precedent — the five probes"](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md)).
- **Verdict: FAILS.** Board geometry stays out of the kernel — pack territory, in the
  pack's own tables / `metadata` JSONB. There is no ambiguity here; the precedent is
  already ratified.

**Candidate 2 — "a generic render-tree shape + render-definition registry as a kernel
contract."**

- (a) Core-concern? **No.** A renderer is a *presentation* concern. It paints pixels
  and handles pointer events. By [ADR-168](../../../layers/specs/adr/adr-168-design-system-eyecatchers-split-workshop-graduates-into-production.md)
  ("anything that paints pixels lives in `braighter-design-system`"), this is
  design-system territory, not kernel territory.
- **Verdict: FAILS the kernel test — and that is the correct outcome.** The renderer
  is **infrastructure**, but it is *UI* infrastructure (design-system), not *kernel*
  infrastructure. The kernel never learns it exists. (Whether a small *render-tree
  type* belongs in `@de-braighter/substrate-contracts` vs `design-system` is a real
  open question — §5, §7 — but it is **not** a "grow the kernel runtime/schema"
  question.)

**Net:** the sound, kernel-coherent thing is **a generic renderer over a
presentation/render tree + a pack-registered `kind → render-definition` registry**,
living in `design-system` (per ADR-168), fed by per-source projection functions.
**Not** "geometry as kernel nodes." The two-trees discipline is what makes the
generalization safe: it lets us reuse a renderer everywhere *without* the kernel ever
touching representation.

---

## 3. The render-definition contract (the hard part)

A read-only visualization registry is easy. The real ambition — and the real
difficulty — is an **editor** registry: each `kind → render-definition` must carry
**both** "how to draw" **and** "how to edit." This section sketches the contract at a
north-star level and is honest about what is hard.

### 3.1 Shape sketch (illustrative, not ratified)

```ts
// A presentation/render node. Derived view; never authoritative kernel state.
interface RenderNode<P = unknown> {
  id: string;
  kind: string;           // registry key, e.g. 'football.marker', 'plan.intervention'
  props: P;               // kind-specific payload (geometry, label, posterior, …)
  children: readonly RenderNode[];
}

// What a pack registers for a kind. Two halves: DRAW and EDIT.
interface RenderDefinition<P = unknown> {
  kind: string;

  // --- DRAW half (the easy half) ---
  draw(node: RenderNode<P>, ctx: DrawContext): RenderOutput;   // SVG/canvas description
  bounds(node: RenderNode<P>, ctx: DrawContext): Bounds;       // for hit-testing + layout
  // a11y: accessible name/role/description for the node (WCAG 1.1.1, 4.1.2)
  describe(node: RenderNode<P>): AccessibleDescriptor;

  // --- EDIT half (the hard half) — OPTIONAL: omit ⇒ read-only kind ---
  edit?: {
    // affordances this kind offers and the commands they emit
    tools: readonly EditTool[];                 // e.g. 'move', 'draw-arrow', 'delete'
    hitTest(node: RenderNode<P>, at: Point, ctx: DrawContext): HitResult | null;
    // gesture → command. Commands are pure data; the host applies + persists.
    onGesture(g: Gesture, node: RenderNode<P>, ctx: EditContext): EditCommand[];
    // WCAG 2.1.1 keyboard parity: every pointer affordance has a keyboard path
    onKey(k: KeyEvent, node: RenderNode<P>, ctx: EditContext): EditCommand[];
    // for undo over heterogeneous nodes: invert a command this kind produced
    invert(cmd: EditCommand): EditCommand;
  };
}
```

The editor engine (generic, domain-free) owns: tool state, the undo/redo stack,
pointer/keyboard event routing, focus management, and applying `EditCommand`s. The
render-definition owns: what a kind looks like, how to hit-test it, which gestures it
accepts, and how to invert its commands. The host owns: projection (source →
RenderNode tree) and persistence (commands → wire shape).

### 3.2 What is genuinely hard (flag, do not hand-wave)

- **Hit-testing across heterogeneous kinds.** A generic engine cannot hit-test a node
  it does not understand. `hitTest` must be delegated per kind, and the engine needs
  a spatial index over `bounds()` to keep pointer routing tractable. Z-order across
  kinds is undefined unless the render tree imposes one.
- **Undo over heterogeneous nodes.** A single undo stack spanning marker-moves,
  arrow-draws, and (hypothetically) plan-node edits requires every kind to produce
  *invertible* commands of a common command algebra. If one kind's command cannot be
  cleanly inverted, the whole stack's guarantee weakens. This is the deepest design
  risk in the editor half.
- **Coordinate frames per node-kind ("frame dualism").** The football epic already
  hit 100×60 vs 100×120 (board-runtime §4, §12). A *generic* renderer multiplies
  this: a pitch frame, a pedigree layout frame, a plan-tree dendrogram frame are all
  different coordinate systems. The render tree must declare a frame/transform per
  subtree, and hit-testing must compose transforms correctly down the tree.
- **Focus management.** WCAG 2.4.3 (focus order) and 2.4.7 (focus visible) across a
  heterogeneous, dynamically-mutating tree is non-trivial. When a node is deleted or a
  panel swaps, focus must land somewhere sensible — a recurring a11y MUST-FIX in this
  cluster's UI slices.
- **Accessibility of editing, not just viewing.** The football work already commits
  to WCAG **2.5.7** (drag has a non-drag alternative), **2.1.1** (full keyboard), and
  **2.5.8** (24px targets) (board-runtime §8). A generic editor must enforce these
  *at the registry boundary* — a kind that offers a drag tool without a keyboard path
  is a contract violation, not a runtime surprise.

The honest read: the **draw** registry is a well-understood pattern (any design
system has component variants by type). The **edit** registry is the ambitious,
unproven part, and it is where this generalization could fail to pay for itself
(§7).

---

## 4. Sources that project into render trees

The payoff of the two-trees discipline: **one renderer, many projections.** Each
source contributes a projection function `source → RenderNode tree` and a render
definition per kind it introduces. None of them touch the kernel's representation.

| Source | Projection (derived view) | Kinds it registers | Edit? |
|---|---|---|---|
| **Football board** | board geometry → render tree of markers/arrows/zones | `football.marker`, `football.arrow`, `football.zone` | yes (the full drill/tactical editor) |
| **Kernel plan tree** | plan nodes (by `kindRef`) → render tree of intervention nodes | `plan.intervention.<kindRef>` | viz first; edit later via the existing `TreeEditSchema` verbs (ADR-176 §4) |
| **Digital twin / posterior state** | plan + observations rollup → render tree of node-states with attached posteriors | `twin.node`, `twin.posterior` | read-mostly |
| **Herdbook / conservation** (future) | pedigree / mating tree → render tree | pack-registered | pack's call |

The kernel plan tree row is the load-bearing one for the discipline: it projects
*into* a render tree (a derived view), so the plan-tree explorer reuses the same
renderer **without** representation ever entering the kernel. The plan tree stays
single-parent and minimal; its *picture* is a projection.

---

## 5. Where it lives + the promote path (ADR-176 demand-driven)

**Build it in the first consumer, now: the football board runtime.** The board-runtime
epic ([`2026-06-07-football-board-runtime-design.md`](2026-06-07-football-board-runtime-design.md))
is already building the generic engine + geometry model + renderer in
`pack-football-ui` / `pack-football-contracts` (epic §10, §11 slice ladder S0–S5).
That is the right place: co-located with the boards being unified, where the
requirements are concrete and the duplication is real today.

**Do NOT build cluster-level renderer infrastructure before consumer #2.** This is
the ADR-176 promotion rule applied directly
([ADR-176 §3](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md):
*"Promotion is demand-driven, never speculative"*). A generic renderer with no second
consumer is speculative platformization — exactly what the inclusion test exists to
prevent. The football board is consumer #1; one consumer does not justify shared
infra.

**Promotion to shared infra is earned at consumer #2** — the second pack (or the
plan-tree explorer, or another domain) that genuinely needs to render-and-edit a
tree. At that point:

- The **renderer + render-definition registry + edit engine** promote to a
  `design-system` brick — *"anything that paints pixels lives in
  `braighter-design-system`"*
  ([ADR-168](../../../layers/specs/adr/adr-168-design-system-eyecatchers-split-workshop-graduates-into-production.md),
  invariant: bricks live in design-system; packs compose, do not author).
- The **render-tree TYPE** (`RenderNode`) *may* warrant a contract home so that
  non-UI code (projections, possibly server-side) can speak it without depending on
  Angular. Whether that is `@de-braighter/substrate-contracts` or
  `design-system-core` is an **open question** (§7). It is a *contract* question, not
  a *kernel runtime/schema* question — the kernel never imports it.

This staging is the whole point of capturing it as a north-star now: it tells the
football build *what seam to keep clean* (§6) so promotion is an extraction, not a
rewrite — while explicitly forbidding building the shared layer before the demand
exists.

---

## 6. The generalization seam the football board runtime must preserve

For the football engine/render-layer (board-runtime epic S1–S3) to extract cleanly
into the generic renderer later, the build must keep specific boundaries clean
*now*, even though it ships football-only. Concretely:

1. **Render-node shape stays generic-ready.** The epic's `BoardGeometry`
   (`{ frame, markers, arrows, zones }`, board-runtime §4) is a *flat* geometry
   model, not yet a recursive `{ kind, props, children }` render tree. Keep
   `BoardMarker.kind` / `BoardArrow.kind` as **palette-scoped string tokens** (epic
   §4 already does this) — those `kind` tokens are the seed of the render-definition
   registry keys. The flat-vs-recursive gap is the main reshaping promotion will
   require; name it now so S0's contracts don't bake in flatness as a hard
   assumption.
2. **The render-definition boundary already exists in disguise.** The epic's
   per-kind **palette** (which marker/arrow kinds exist + which tools are enabled,
   §4, §5 `BoardPalette`) is a proto render-definition (the "edit affordances"
   half). Keep "what a kind is + how it's drawn + how it's edited" co-located per
   kind, not smeared across the engine. When this generalizes, a `BoardPalette`
   entry becomes a `RenderDefinition`.
3. **The engine stays domain-free.** The epic's Approach B already mandates this: the
   runtime + model are *pure geometry*; "tactical-ness" lives in a thin binding
   adapter (board-runtime §2, §6). Preserve that ruthlessly — the engine must never
   learn what a squad, formation, or pass *means*. A domain-free engine is the
   precondition for it ever being generic. The binding adapter is the football
   analogue of "the host owns projection + persistence" (§3.1).
4. **Skins generalize, but skin-conditional a11y gates at the skin boundary.** The
   epic lifts skins to engine level (§7). Keep skin logic out of the shared layout
   path — a hard-won lesson from the drill-board skins work (gate skin-conditional
   a11y at the skin boundary, not the shared layout, or screen-reader artifacts leak).
5. **Persistence stays behind a port.** The epic's `BoardPersistencePort` (§9) is
   the football analogue of "the host owns persistence." A generic renderer must
   never know whether geometry lands in a drill catalog, plan-tree `metadata`, or a
   pedigree table. Keep that port narrow and domain-agnostic.

If S0–S3 honor these five, the later extraction to a generic renderer is a *move*,
not a *redesign*. If they don't, the generalization quietly becomes impossible and
this north-star is dead on arrival.

---

## 7. Honest assessment / open questions

This is a north-star, and north-stars over-promise. The skeptical view:

**Where this might NOT be worth generalizing.**

- **One real consumer is not a pattern.** Today there is exactly one consumer
  (football boards), and even *that* is one pack unifying its own internal
  duplication. The generalization to "any tree, any domain" is *projected* demand,
  not observed demand. If consumer #2 never materializes, the right outcome is: the
  football board runtime is a great pack-internal engine and this document expires
  unredeemed. That is an acceptable outcome — building the seam clean (§6) costs
  little; building the shared layer speculatively costs a lot.
- **The edit registry might be a bridge too far.** A read-only viz registry would
  almost certainly pay off (low risk, clear reuse). The *editor* registry — heterogeneous
  undo, per-kind hit-testing, command inversion (§3.2) — is where the complexity
  concentrates. It is entirely possible that the *draw* half generalizes cleanly and
  the *edit* half is better left per-pack. A defensible fallback: promote a
  read-only render-tree viewer first; let editors stay pack-specific until a second
  pack needs a *generic editor* specifically.

**Risks.**

- **Over-abstraction.** A generic renderer is a classic premature-platform trap (the
  failure mode ADR-176 §"Alternatives 1" names). The mitigation is the promote-on-2nd-consumer
  rule (§5) — held strictly.
- **Frame dualism at scale.** §3.2 — multiple coordinate systems across kinds is real
  recurring work, already visible at N=2 in football.
- **Perf on large trees.** A pitch with ~30 markers is trivial; a deep plan-tree or a
  large pedigree projected into a render tree, with per-kind hit-testing and a spatial
  index, is not. Perf is unvalidated and must be benchmarked at the real tree sizes
  before the plan-tree/twin consumers commit. (This is an `implementer`-scaffolded
  bench, not something to assert here.)
- **Generality that drops guarantees is more complexity, not less** (ADR-176
  "Alternatives 2"). A render tree that is "any `{kind, children}`" with no invariants
  relocates structure-handling into every render-definition. We should decide which
  invariants the render tree keeps (single-root? acyclic? typed-children rules per
  kind?) rather than shipping an unconstrained property-graph-of-render-nodes.

**Relationship to existing decisions.**

- **vs. ADR-168 bricks.** This *is* a brick at maturity — it paints pixels, so it
  belongs in design-system, and packs compose it
  ([ADR-168](../../../layers/specs/adr/adr-168-design-system-eyecatchers-split-workshop-graduates-into-production.md)).
  Nothing here contradicts ADR-168; it is an unusually ambitious brick (a brick that
  takes a *registry* as input).
- **vs. eyecatcher / showcase-as-IDE.** A generic tree renderer+editor is plausibly
  the natural substrate for a showcase-as-IDE surface (edit any registered tree in
  one tool). That is a *consequence to watch*, not a requirement to design for now.
- **vs. the existing visual-editor renderer choices.** ADR-176 explicitly notes
  pack-side renderer choices are *orthogonal* to kernel governance ("Does not re-open
  renderer/representation choices"). This document lives entirely on the pack/design-system
  side of that line and does not reopen anything kernel.

**Open questions.**

| Question | Activating trigger |
|---|---|
| Does the **render-tree TYPE** belong in `@de-braighter/substrate-contracts` or `design-system-core`? | A non-UI projection (e.g. server-side or a contract test) needs to speak `RenderNode` without an Angular dependency. |
| Read-only viz registry **first**, or commit to the editor registry from the start? | Consumer #2's actual need — is it "show me this tree" or "let me edit this tree"? |
| Which **invariants** does the render tree keep (single-root / acyclic / per-kind child rules)? | The first non-football projection (plan tree or pedigree) whose structure stresses an unconstrained render tree. |
| What is the **command algebra** for heterogeneous undo, and can every kind produce invertible commands? | The first consumer that needs a *generic* multi-kind editor (vs football's homogeneous-geometry undo). |
| Does it survive **perf at real tree sizes** (deep plan tree, large pedigree)? | Plan-tree or twin consumer commits to using the generic renderer. |
| Is the **edit half** worth generalizing at all, or do editors stay per-pack? | After the draw half ships to consumer #2 and we see whether the edit affordances actually share. |

---

## 8. ADR triggers (at promotion, not now)

These do **not** fire while this is a north-star capture. They are named so the
promotion path is legible.

- **ADR-Lxx — Generic substrate tree renderer + render-definition registry as a
  design-system brick.** Ratifies the renderer/registry/edit-engine living in
  `design-system` (per ADR-168), fed by per-source projections; ratifies the
  two-trees discipline as the governing principle (kernel plan tree ≠ presentation
  tree; geometry never enters the kernel). Fires at **consumer #2**.
- **ADR-Lyy — Render-tree contract home + shape.** Ratifies where the `RenderNode`
  type lives (`substrate-contracts` vs `design-system-core`), its invariants, and the
  edit-command algebra. Fires when a non-UI consumer needs the type, or the editor
  registry is committed to.

When (if) these land, this capture graduates: a ratified
`layers/specs/concepts/substrate/` concept doc + the ADR(s) above, with
`ratified-by:` populated and `status:` bumped. **Not before consumer #2.**

---

## Status

**proposed (north-star capture).** Steers the football board runtime build (keep the
§6 seam clean). Changes nothing in the kernel, contracts, or design-system today.
Graduates to a ratified `layers/specs/concepts/substrate/` doc + ADR(s) at promotion,
which is **demand-driven** (consumer #2), per
[ADR-176 §3](../../../layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md).
