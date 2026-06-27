---
product_key: board-editor-studio
build_path_date: 2026-06-25
status: build-path
charter: docs/foundry/board-editor-studio/charter.md
risk_tier: T0
item_count: 2
slice: board-settings-clarity (append)
---

# Build Path — Board Editor Studio · Board-settings clarity (append slice)

**Append** to the existing `board-editor-studio` product. Adds ONE epic, **`S` — Board-settings
clarity**, decomposed into a founder-gated **design** item (`S1`) and the **build** that depends on
it (`S2`). Does NOT re-push any prior item (`E*`, `R*`, `G*`).

> Why this slice exists (founder, 2026-06-25): *"Board settings — no user will understand what he
> can manage here."* Confirmed in code: the panel (`board-settings.component.ts`) is a raw 1:1 dump
> of the internal `BoardSettings` engine model with no purpose framing, plus two broken affordances:
>
> 1. **"Kind" is a dead field.** `buildRecipeFromCatalog` never reads `boardSettings.kind` (add-child
>    uses each shape's OWN kind; a11y from the template; bounds from `bs.bounds`; interactions from
>    `bs.interactions`). The most prominent control changes nothing observable.
> 2. **"Bounds" is a silent global override.** `const shapeBounds = bs ? bs.bounds : inst.bounds` —
>    once `boardSettings` exists (set the instant ANY control here is touched), every node's bounds
>    snap to the board box, discarding per-node bounds. Toggling one interaction silently resets all
>    node sizes. No warning.
>
> Root cause: an **altitude mismatch** — recipe/engine vocabulary (`kind`, accessible-name template,
> reparent, an everything-overriding bounds box) shown at the author's altitude, where it's
> meaningless, and never stating the one thing that matters: *these apply to every node on the board.*

Founder decisions (2026-06-25):
- **Fix depth = the design step recommends** — `S1` evaluates *reframe* (drop dead 'Kind';
  bounds-override opt-in/explicit/removed; plain-language + effect-preview; touches `catalog.ts`,
  parity-relevant) vs *clarity-pass-only* (component-only copy/affordances) and recommends; the
  founder decides at the gate.
- **Separate design-first task, aligned with the Groups merge** — `S1` is its own item; its design
  ASSUMES `node = root group` (the G-slice direction) and decides where board-settings live in the
  merged "Groups" IA. `S2` (build) `dependsOn` **G2** (shared `libs/board-editor` scope; can't run
  concurrently) **and** `S1`.

## Scope reminder (charter authority)

- **Tier:** T0. Blast radius contained to `domains/studio`.
- **Cluster governance:** every merge-to-main founder-gated; review floor on every PR.
- **ZERO kernel / `design-system` brick change.** All surfaces in `libs/board-editor` (studio-local).
- **The (3) hard lesson, encoded:** if the design recommends an IA/layout change, `S1` MUST produce
  a concrete **visual design source**; `S2` MUST build from it and browser-verify each skin.

## Scaffold plan

No `/new-domain`. Extends `@de-braighter/board-editor` (`libs/board-editor`). `S1` writes docs only.
No port pair.

## Epic ladder

- **S1 — Board-settings clarity design** (DESIGN-ONLY, founder-gated; no deps → runs in parallel
  with `G1`). Deliverable: a design spec (+ a visual design source IF an IA/layout change is
  recommended) under `docs/board-settings-clarity/`. Acceptance: resolves the four decisions below;
  founder approves at the gate (the founder-gated merge of the design PR IS the gate).
- **S2 — Board-settings clarity build** (dependsOn `S1` + `G2`). Deliverable: the approved fix
  implemented in `libs/board-editor`, behind a green parity proof (if the model/expander changes).
  Acceptance: every control's purpose + effect is comprehensible to a non-technical author; the
  dead/dangerous affordances are resolved per S1; parity spec green; `npm test` + lib `build` green;
  each skin/view browser-verified against the S1 design source (if a visual one exists).

### The four decisions S1 must resolve (S2 implements)

1. **Reframe vs clarity-pass** — recommend the depth, with rationale anchored on the two findings.
2. **The dead 'Kind' field** — drop it, or give it a real effect, or relabel it honestly. (Dropping
   it is a model change → parity-relevant; spell out the migration.)
3. **The bounds-override** — make it explicit/opt-in (so it stops silently wiping per-node sizes),
   or remove board-level bounds entirely, or keep + warn. Whichever — the surprising silent reset
   must be designed away. (Changing `shapeBounds` selection is an expander change → parity-relevant.)
4. **Comprehensibility + IA placement** — plain-language labels, a "these apply to every node on the
   board" frame, per-control help, units, and ideally a live effect-preview; AND where board-settings
   live in the merged "Groups" IA (node = root group → likely the root group's own settings).

## UI-surface plan

| Surface | Verdict | Item |
| --- | --- | --- |
| Board-settings panel (`board-settings.component.ts`) | **in** | S1 (design) → S2 (build) |
| Its placement in the merged "Groups" rail/IA | **in** (aligned with G-slice) | S1 → S2 |
| Live preview / node composition | **unchanged** (parity) | — |

## ADR needs & gates

**None.** T0, studio-local, zero kernel/brick change. Only gate = the per-item founder-gated merge;
on `S1` it doubles as the design gate.

## Quality battery config

| Obligation | Applies to |
| --- | --- |
| `review-floor` | S1, S2 |
| `md-quality` | S1 (design doc) |
| `tdd` | S2 |
| `opus-whole-branch` | S2 (non-negotiable — caught a real regression on every prior slice) |
| `parity-proof` | S2 (IF the model/expander changes — `EditorRecipe` output byte-identical for the unchanged paths; new behavior covered) |
| `a11y-focus-recovery` | S2 (only if the rework adds add/remove/reorder; the current panel is form-fields-only and is exempt — re-evaluate per the S1 design) |
| `browser-verify` | S2 (each skin/view vs the S1 design source, if visual) |

Acceptance (S2): `npm test` + lib `build` green. **npm in apps/; pnpm only for the lib build.**

`S1` is DESIGN-ONLY: no `tdd`/`parity-proof`/`browser-verify`; quality = `review-floor` + `md-quality`
+ the founder design gate.

## Lanes & parallelism

`S1` (design, no deps) runs in PARALLEL with `G1` (disjoint docs scopes). `S2` is strictly
sequenced: after BOTH `S1` (its design) and `G2` (the Groups build it shares `libs/board-editor`
with). Max parallel design width with the G-slice: 2 (`G1` + `S1`).

## Work items

| itemId | title | scope (repo=studio) | dependsOn | lane | qualityObligations |
| --- | --- | --- | --- | --- | --- |
| `board-editor-studio/S1` | DESIGN-ONLY (founder-gated): make the Board-settings surface comprehensible. Diagnose-confirmed problems: 'Kind' is a dead field (buildRecipeFromCatalog never reads boardSettings.kind), and board 'Bounds' silently overrides every node's per-instance bounds the instant any control is touched. Recommend reframe-vs-clarity-pass and resolve: (1) the depth recommendation; (2) drop/relabel/empower 'Kind'; (3) make bounds-override explicit/opt-in or remove it (kill the silent reset); (4) plain-language labels + 'applies to every node' framing + per-control help + units + ideally a live effect-preview, AND where board-settings live in the merged 'Groups' IA (assume node = root group). Produce a design spec (+ a visual design source IF recommending an IA/layout change). NO code. Output to domains/studio docs/board-settings-clarity/. The founder-gated merge IS the design gate. Studio-only, ZERO kernel/brick change. | `pathPrefix: docs/board-settings-clarity` | — | settings | review-floor, md-quality |
| `board-editor-studio/S2` | BUILD (dependsOn S1 + G2): implement the approved Board-settings clarity design in libs/board-editor. Likely touches board-settings.component.ts, and (if reframe) catalog.ts (BoardSettings model + buildRecipeFromCatalog: the dead 'kind' field + the bounds-override selection) + the catalog-designer shell placement of the settings surface within the merged 'Groups' IA. Keep EditorRecipe/interpretRecipe consumption unchanged (ZERO brick/kernel change). If the model/expander changes, keep the parity spec green for unchanged paths + cover the new behavior. Build from the S1 design source; browser-verify each skin (night/ivory/clinical) if a visual source exists. | `pathPrefix: libs/board-editor` | board-editor-studio/S1, board-editor-studio/G2 | settings | tdd, review-floor, opus-whole-branch, parity-proof, a11y-focus-recovery, browser-verify |

## Disjointness proof

Both new items same `repo: studio`. Existing queued items in this product at push time: `G1`
(`docs/groups-merge`), `G2` (`libs/board-editor`).

Ordered (no proof): `S2 → S1`, `S2 → G2` (S2 dependsOn both). Unordered pairs needing proof:

| Pair | Evidence | Verdict |
| --- | --- | --- |
| S1 vs S2 | `docs/board-settings-clarity` vs `libs/board-editor` — neither a prefix (also ordered) | disjoint |
| S1 vs G1 | `docs/board-settings-clarity` vs `docs/groups-merge` — neither a prefix | disjoint |
| S1 vs G2 | `docs/board-settings-clarity` vs `libs/board-editor` | disjoint |
| S2 vs G1 | `libs/board-editor` vs `docs/groups-merge` | disjoint |

`S2` vs `G2` share `libs/board-editor` but are **ordered** (`S2 dependsOn G2`) → never co-claimed.
Every `dependsOn` id resolves: `S1` (this list), `G2` (already queued) — no dangling deps. No
cross-repo / ADR items. Live foreign claims at push time (`system-builder-studio/TE1`, `/TE2`) are
in repos `devloop` / `workbench`, not `studio` → no conflict.
