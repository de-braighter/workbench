---
product_key: board-editor-studio
build_path_date: 2026-06-25
status: build-path
charter: docs/foundry/board-editor-studio/charter.md
risk_tier: T0
item_count: 1
slice: autosnap-grid (append — design only; build appended after the A1 gate)
---

# Build Path — Board Editor Studio · Autosnap-to-grid (append slice)

**Append** to `board-editor-studio`. Adds the first item of epic **`A` — Autosnap-to-grid**: a
founder-gated **design** item (`A1`). The build is appended via a follow-up `/build-path` once `A1`
clears the gate (the build decomposition depends on the snap-implementation call below + sequences
after `S2` and the lib chain).

> Why this slice exists (founder, 2026-06-25): *"Next thing we should design: a 'do autosnap to grid'
> feature. This would bring some more sense to the board settings."* And on scope: *"or is it rather
> per shape? yes it is."*

**Founder decisions (2026-06-25):**
- **Snap scope = board grid + per-shape snapping (+ per-shape opt-out).** The grid (cell size +
  "autosnap on/off") is a **board-level Default**; each shape snaps its position to that shared grid;
  an individual shape may opt out. This gives the board-settings/Defaults surface its first genuinely
  useful control (replacing the dropped dead `Kind`).
- **Design now, building on S1's Defaults reframe** (PR `studio#79`, parallel with `C1`).

## Builds on S1 (embedded so A1 needs no merge dependency)

S1 (`board-editor-studio/S1`, PR `studio#79`, design-gate pending) reframed board settings as the
**root group's "Defaults"** in the merged Groups IA, and: drops the dead `Kind` field; makes board
`bounds` a per-node **fallback** (`inst.bounds ?? boardDefault ?? DEFAULT`) instead of a silent
override. **A1 slots the grid into that "Defaults" surface as a new board Default** — coherent with
S1, not a competing board-settings design. A1 should treat S1's reframe as the assumed substrate
(read the S1 worktree docs if reachable, but the decisions above are authoritative for A1).

## The decisive design decision (A1 must resolve) — where snapping happens

Charter boundary: **ZERO `design-system` brick change.**
- **Snap-on-drop, studio-level (recommended):** the studio rounds a shape's committed position to the
  grid on commit (the editor already receives `onCommit`), and draws the grid (the live preview
  already has a grid-dot canvas background — reuse/align it). **Zero brick change.**
- **Snap-during-drag:** live snapping with drag feedback lives in the `<ds-board-kit>` brick → a
  **published `@de-braighter/design-system` change** → architecture-gated + a separate publish "go".
  Outside the studio charter — A1 recommends against it and **escalates** if the founder wants it.

A1 must also resolve: grid **model** (where `gridSize` + `autosnap` live — on the root group's
Defaults / `boardDefaults`; per-shape `snap: boolean` opt-out on the part), the **snap math** (round
to nearest cell; interaction with the per-node bounds fallback), grid **rendering** (reuse the
grid-dot canvas; make cell size reflect `gridSize`), **parity** (snapping must not alter
`buildRecipeFromCatalog` output for shapes already on-grid / when autosnap is off — the parity spec
stays green), and the **build decomposition**: scope (likely `libs/board-editor`), dependsOn (`S2`
for the Defaults surface + the `G2→S2→P1` lib serialization), and obligations.

## ADR needs & gates

**None** (T0, studio-local) — UNLESS A1 recommends snap-during-drag, which raises a brick
architecture gate + publish "go" (surfaced, never bundled). Gate = the founder-gated merge of the
`A1` design PR.

## Quality battery config

| Obligation | Applies to |
| --- | --- |
| `review-floor` | A1 |
| `md-quality` | A1 (design doc) |

Build-item obligations (tdd, review-floor, opus-whole-branch, parity-proof, a11y, browser-verify)
land on the build item in the follow-up push.

## Lanes & parallelism

`A1` (design, no deps) runs in PARALLEL with `C1` (and alongside the gate-pending `G1`/`S1`). All
docs-scoped, mutually disjoint. The autosnap BUILD will sequence after `S2` (the Defaults surface it
extends) and within the `libs/board-editor` chain.

## Work items

| itemId | title | scope (repo=studio) | dependsOn | lane | qualityObligations |
| --- | --- | --- | --- | --- | --- |
| `board-editor-studio/A1` | DESIGN-ONLY (founder-gated): design "autosnap to grid". Scope (founder): the grid (cell size + autosnap on/off) is a BOARD-LEVEL Default slotting into S1's reframed root-group "Defaults" surface; snapping applies PER-SHAPE with a per-shape opt-out. RESOLVE: where snapping happens — snap-on-drop studio-level (round committed positions, reuse the grid-dot canvas; ZERO brick change — recommended) vs snap-during-drag (a <ds-board-kit> brick change → architecture-gated + publish → escalate, don't bundle); the grid model (gridSize/autosnap on boardDefaults; per-shape snap opt-out); snap math + interaction with S1's per-node bounds fallback; grid rendering; parity (output unchanged when on-grid / autosnap off); and the BUILD decomposition (scope libs/board-editor, dependsOn S2 + the lib chain, obligations). Build on S1's Defaults reframe (PR studio#79; decisions embedded in the build-path doc). Produce a design spec + a visual design source (grid + snap settings + snapped shapes, all 3 skins). NO code. Output to domains/studio docs/autosnap-grid/. The founder-gated merge IS the design gate; the build item is appended after it. Studio-only, ZERO kernel change. | `pathPrefix: docs/autosnap-grid` | — | autosnap | review-floor, md-quality |

## Disjointness proof

`repo: studio`, scope `docs/autosnap-grid`, no deps → claimable now. Unordered pairs:

| Pair | Evidence | Verdict |
| --- | --- | --- |
| A1 vs G1 | `docs/autosnap-grid` vs `docs/groups-merge` | disjoint |
| A1 vs S1 | `docs/autosnap-grid` vs `docs/board-settings-clarity` | disjoint |
| A1 vs C1 | `docs/autosnap-grid` vs `docs/cookbook` | disjoint |
| A1 vs G2/S2/P1 | `docs/autosnap-grid` vs `libs/board-editor` | disjoint |

No dangling deps (none declared). No cross-repo / ADR items.
