---
product_key: board-editor-studio
build_path_date: 2026-06-25
status: build-path
charter: docs/foundry/board-editor-studio/charter.md
risk_tier: T0
item_count: 1
slice: card-item-preview (append)
---

# Build Path — Board Editor Studio · Card item-preview (append slice)

**Append** to the existing `board-editor-studio` product. Adds ONE epic, **`P` — Card item-preview**,
a single direct **build** item (`P1`). Does NOT re-push any prior item (`E*`, `R*`, `G*`, `S*`).

> Why this slice exists (founder, 2026-06-25): *"I don't like the cards used in the primitives
> overview — this button-like colored bar is ugly. Why don't we just render the item?"* Confirmed in
> code: `catalog-card.component.ts` renders a fake `.mini-preview` — a 32px solid `KIND_COLORS`
> swatch with the kind's initial letter (R/C/T/L/S), identical for every definition of a kind
> regardless of its real geometry/fill/stroke — plus a second loud colored `.badge` chip. It shows
> NOTHING about the actual shape.

**Decision (founder, 2026-06-25):** replace the fake colored bar with a **real rendered thumbnail of
the actual item**, for **all card kinds** (primitive · svg · composite/group), routed as a
**separate build task sequenced after G2**. Direct build (the direction is clear); the founder-gated
merge + per-skin browser-verify are the visual review — no separate design item.

The studio already lowers any definition to a real draw template (`lowerPrimitive` /
`buildRecipeFromCatalog` in `catalog.ts`) and draws it via `interpretRecipe` → `<ds-board-kit>`. The
thumbnail must **reuse that same lowering** (derive the view from the generator — never invent a
second representation that can drift from the live preview).

## Scope reminder (charter authority)

- **Tier:** T0. Blast radius contained to `domains/studio`. Every merge founder-gated; review floor.
- **ZERO kernel / `design-system` brick change.** All in `libs/board-editor` (studio-local).
- **The (3) hard lesson:** a visual change → browser-verify each rendered skin against reality; do
  not declare done off a jsdom test. Real fills/strokes must read on night / ivory / clinical
  grounds.

## Scaffold plan

No `/new-domain`. Extends `@de-braighter/board-editor` (`libs/board-editor`). No port pair.

## Epic ladder

- **P1 — Render real item thumbnails in catalog cards** (build; dependsOn `G2` + `S2`). Deliverable:
  `catalog-card.component.ts` (and the merged-IA card library it feeds) renders the ACTUAL primitive
  /svg/composite — its real geometry/fill/stroke/text/`d` — as a small SVG thumbnail in a fixed
  viewBox, reusing `lowerPrimitive`/the existing lowering. Drop the fake `.mini-preview` colored bar;
  reconsider the loud colored `.badge` for a subtler kind/name label (worker's call, founder gate
  decides). Acceptance: each primitive kind (rect/text/circle/line/svg/path) + composite/group
  renders a recognizable real thumbnail; the live-board preview output is unchanged (parity);
  per-skin browser-verified; `npm test` + lib `build` green.

## UI-surface plan

| Surface | Verdict | Item |
| --- | --- | --- |
| Primitives card library thumbnails (`k:<kind>`) | **in** (the origin of the complaint) | P1 |
| Composites/groups card thumbnails (same shared `catalog-card`) | **in** (same component, same principle) | P1 |
| Live board preview / node composition | **unchanged** (parity) | — |

## ADR needs & gates

**None.** T0, studio-local, zero kernel/brick change. Only gate = the founder-gated merge (the
visual review of the rendered result).

## Quality battery config

| Obligation | Applies to |
| --- | --- |
| `tdd` | P1 |
| `review-floor` | P1 |
| `opus-whole-branch` | P1 (non-negotiable — caught a real regression on every prior slice) |
| `parity-proof` | P1 (`EditorRecipe` / live-preview output byte-identical; the thumbnail is an additive VIEW that reuses lowering, not a new generator) |
| `browser-verify` | P1 (each card kind, each skin night/ivory/clinical — real fills/strokes must read on every ground) |

a11y note: the thumbnail is decorative (`aria-hidden`) with the kind + name still announced via the
card label; no add/remove/reorder is introduced in the card itself, so `a11y-focus-recovery` is not
applicable (same exemption as the board-settings form panel). The a11y check that DOES apply:
non-decorative text/affordances keep their accessible names + contrast on every skin.

Acceptance: `npm test` + lib `build` green. **npm in apps/; pnpm only for the lib build.**

## Lanes & parallelism

`P1` is the tail of the `libs/board-editor` build chain: `G2 → S2 → P1`. It is claimable only after
both `G2` (Groups build) and `S2` (Board-settings build) are done — they all rework overlapping
parts of the lib and must serialize. The design items (`G1`, `S1`) run in parallel up front; they do
not gate each other.

## Work items

| itemId | title | scope (repo=studio) | dependsOn | lane | qualityObligations |
| --- | --- | --- | --- | --- | --- |
| `board-editor-studio/P1` | BUILD (dependsOn G2 + S2): in catalog-card.component.ts (and the merged-IA card library), replace the fake `.mini-preview` colored-bar-with-letter with a REAL SVG thumbnail of the actual item — rect/text/circle/line/svg/path + composite/group — reusing lowerPrimitive/the existing lowering into a fixed viewBox so the thumbnail can't drift from the live preview. Drop the fake colored bar; reconsider the loud colored kind badge for a subtler label. Applies to ALL card kinds (primitives + svg + composites/groups). Keep EditorRecipe/interpretRecipe + the live-board output unchanged (ZERO brick/kernel change; parity green). Browser-verify each kind on each skin (night/ivory/clinical). | `pathPrefix: libs/board-editor` | board-editor-studio/G2, board-editor-studio/S2 | preview | tdd, review-floor, opus-whole-branch, parity-proof, browser-verify |

## Disjointness proof

`repo: studio`. `P1` transitively dependsOn every other queued item in this product:
`P1 → G2 → G1` and `P1 → S2 → {S1, G2}`. So `P1` is **ordered after all of them** — no unordered
pair exists, no path-disjointness proof required (an item and any ancestor it dependsOn may share
scope and can never be co-claimed). The `libs/board-editor` build serialization `G2 → S2 → P1` is
intentional: three overlapping rewrites of the same lib must not run concurrently. Every `dependsOn`
id resolves (`G2`, `S2` already queued) — no dangling deps. No cross-repo / ADR items. Live foreign
claims (`system-builder-studio/*` if any) are other repos → no conflict.
