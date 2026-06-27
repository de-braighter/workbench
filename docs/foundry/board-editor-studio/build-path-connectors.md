---
product_key: board-editor-studio
build_path_date: 2026-06-25
status: build-path
charter: docs/foundry/board-editor-studio/charter.md
risk_tier: T0
item_count: 1
slice: connectors (append — design only; build appended after the L1 gate)
---

# Build Path — Board Editor Studio · Connectors / links (append slice)

**Append** to `board-editor-studio`. Adds the first item of epic **`L` — Links/connectors**: a
founder-gated **design** item (`L1`). The build is appended via a follow-up `/build-path` once `L1`
clears the gate — its decomposition depends on the brick-boundary call below.

> Why this slice exists (founder, 2026-06-25): *"Another snap thing. A default feature is to link
> shapes with lines or arrows. Most editors offer one or multiple points to snap per edge. I would
> love it to have a pixel-snappable. The final idea is of course to let then move lines and arrows
> with the shape if this is moved in the editor."* And: *"so a per-compose-shape config on that snap
> behaviour we need."*

## What this is (distinct from A1)

- **A1 (autosnap-to-grid):** snaps a shape's POSITION to a board grid (studio-local, zero-brick).
- **L1 (connectors):** lines/arrows that LINK two shapes, snapping to **per-edge anchor points**
  (one or multiple per edge) **+ a pixel-snap** fallback (arbitrary pixel positions, not only fixed
  anchors), with the end-goal that connectors **reflow/move with a shape when it is moved** in the
  editor (connector binding). The anchor + snap behavior is a **per-compose-shape config** (per
  group — see G1).

The two share a concept: a **per-compose-shape snap config**. A1 contributes the per-shape grid-snap
opt-out; L1 contributes per-shape anchor points + connector-snap behavior. L1 must define where that
shared per-shape snap config lives (on the group/`GroupPart` model from G1) so A1 and L1 don't author
two competing config homes — coordinate (read G1's PR studio#78 model; decisions embedded below).

## The decisive design decision (L1 must resolve) — the brick boundary

Charter boundary: **ZERO `design-system` brick change** is the studio default; any brick change is
**architecture-gated + a separate publish "go"** (cross-repo published-package blast radius).

- **Authoring + static connectors** (define anchor points per compose-shape; draw a line/arrow
  between two shapes; snap to anchors or pixel) MIGHT be expressible studio-side using existing
  `line`/`path` primitives + studio connector model — assess feasibility.
- **Reflow-on-move (the end goal)** almost certainly needs the **`<ds-board-kit>` renderer** to know
  a connector is bound to two shapes and recompute its endpoints when a node moves/resizes (move +
  drag live in the brick). That is a **published design-system change** → escalate to a founder
  **architecture gate + publish**, never bundle into the studio.

L1 MUST: assess what's studio-local vs brick; **recommend a sliced build path** (e.g. Slice-L-a =
studio-local connector authoring + anchors + pixel-snap as line/arrow primitives, zero-brick;
Slice-L-b = the brick connector-binding/reflow, architecture-gated); and isolate the brick work as
its own escalation item so the studio-local slice can proceed under the existing charter.

## Other L1 decisions

- **Connector model:** how a connector lives in the model (source/target shape refs + per-end anchor;
  pixel-offset fallback; arrow vs line). NOTE: the board is a **tree of shapes** today; connectors
  make it a **graph (shapes + edges)** — L1 must resolve how edges sit over the tree without
  breaking `buildRecipeFromCatalog`/`EditorRecipe` (the recipe schema is in `design-system-core`; a
  connector concept there is likely the brick/core part of the escalation).
- **Anchor model (per compose-shape):** one or multiple connection points per edge, authored per
  group; the pixel-snap fallback; how anchors are defined in the group editor (G1's `studio-group-editor`).
- **Binding semantics:** what "moves with the shape" means (re-anchor to the nearest point? keep the
  same anchor and translate? reflow routing?).
- **Coordination:** build on G1's group model (node=root group; `Group`/`GroupPart`) and A1's
  per-shape snap config; align with S1's "Defaults" surface for any board-level connector defaults.

## ADR / gates

Likely a **design-system architecture gate + publish "go"** for the brick connector-binding part
(L1 surfaces it; the founder decides). The studio-local slice stays T0. Gate for L1 itself = the
founder-gated merge of the design PR.

## Quality battery config

| Obligation | Applies to |
| --- | --- |
| `review-floor` | L1 |
| `md-quality` | L1 (design doc) |

Build obligations land on the build items in the follow-up push (the studio-local slice: tdd,
review-floor, opus-whole-branch, parity-proof, a11y, browser-verify; the brick slice carries the
design-system battery + architecture gate + publish).

## Lanes & parallelism

`L1` (design, no deps) runs in PARALLEL with `C1` + `A1` (and alongside gate-pending `G1`/`S1`). All
docs-scoped, mutually disjoint. The connector BUILD sequences after the relevant lib/brick work the
design identifies.

## Work items

| itemId | title | scope (repo=studio) | dependsOn | lane | qualityObligations |
| --- | --- | --- | --- | --- | --- |
| `board-editor-studio/L1` | DESIGN-ONLY (founder-gated): design "connectors / links" — lines/arrows that link two shapes, snapping to per-edge anchor points (one or multiple) + a pixel-snap fallback, configured PER-COMPOSE-SHAPE (per group), with the end-goal that connectors reflow/move WITH a shape when it is moved. RESOLVE the brick boundary: what is studio-local (authoring + anchors + static connectors via line/path primitives, zero-brick) vs what needs a <ds-board-kit> brick change (binding/reflow-on-move — architecture-gated + publish; escalate, do not bundle). Define: the connector model (source/target shape refs + per-end anchor + pixel offset; arrow vs line; how edges sit over the shape TREE without breaking buildRecipeFromCatalog/EditorRecipe — the recipe schema lives in design-system-core); the per-compose-shape anchor + snap config home (shared with A1's per-shape snap config; on G1's Group/GroupPart model); binding semantics; and a SLICED build path that isolates the brick escalation. Build on G1's group model (PR studio#78) + coordinate with A1/S1. Produce a design spec + a visual design source (linked shapes, anchor points, an arrow, snap). NO code. Output to domains/studio docs/connectors/. The founder-gated merge IS the design gate; build items appended after it. | `pathPrefix: docs/connectors` | — | connectors | review-floor, md-quality |

## Disjointness proof

`repo: studio`, scope `docs/connectors`, no deps → claimable now. Unordered pairs:

| Pair | Evidence | Verdict |
| --- | --- | --- |
| L1 vs G1 | `docs/connectors` vs `docs/groups-merge` | disjoint |
| L1 vs S1 | `docs/connectors` vs `docs/board-settings-clarity` | disjoint |
| L1 vs C1 | `docs/connectors` vs `docs/cookbook` | disjoint |
| L1 vs A1 | `docs/connectors` vs `docs/autosnap-grid` | disjoint |
| L1 vs G2/S2/P1 | `docs/connectors` vs `libs/board-editor` | disjoint |

No dangling deps (none declared). The board-kit brick escalation, IF L1 recommends it, becomes a
SEPARATE item in the design-system repo (different repo → trivially disjoint) at the follow-up push.
