# Drill-board skins — "make it feel like football" (design)

- **Date:** 2026-06-04
- **Status:** design (brainstormed; pending implementation plan)
- **Domain:** `de-braighter/domains/exercir` → `pack-football-ui` + `pack-football-contracts`
- **Tracker:** _created on plan hand-off (`de-braighter/exercir` story issue)._
- **Governing ADRs:** [ADR-160](https://github.com/de-braighter/specs/blob/main/adr/adr-160-pack-football-visual-editor-fourth-fifth-scenes-drill-diagram-tactical-board.md) (drill-diagram contract), [ADR-177](https://github.com/de-braighter/specs/blob/main/adr/adr-177-visual-editor-renderer-svg-canonical-reverse-konva.md) (SVG renderer), [ADR-176](https://github.com/de-braighter/specs/blob/main/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) (pack vs kernel — this is **pure pack**); ADR-012 (i18n de/en JSON catalog — verify exact ADR ref at plan time).
- **Predecessor spec:** [`2026-05-25-drill-board-v1-design.md`](./2026-05-25-drill-board-v1-design.md) (the read-only renderer this re-skins).

## 1. Summary

The drill-board renderer (`<lib-drill-board-scene>`) currently draws a **clinical schematic** — line markings on the host background, coloured circles for players, a triangle for cones. The founder's verdict: _"it all looks a bit too like technical diagrams. Hey, it's football. World Championship starts soon."_

This design makes the board **feel like football** by introducing a **skin system**: the renderer keeps its single data contract (`DrillDiagram`) and all of its accessibility, but every *visual* decision moves into a named, swappable **skin**. We ship four:

| Skin | Look | Default for |
|---|---|---|
| `schematic` | today's clinical pitch (unchanged output) | print / technical diagram types; the back-compat default |
| `matchday` | **real turf + mow stripes + white lines + mini-shirt chips (number on the chest) + real ball + 3D cones** | **the Drill Library** (hardwired) |
| `telestrator` | dark broadcast pitch, neon glow, jerseys | live-match / tactical-analysis surfaces |
| `arena` | glossy FIFA-HUD, heat glows, jerseys | gamified player-progression surfaces |

The player marker becomes a **mini jersey** with a number — the single change that makes a board read as football at a glance.

This is a **pure `pack-football-ui` re-skin** (ADR-176: zero kernel involvement; the diagram stays pack-side). The renderer stays **SVG** (ADR-177). The only contract touch is an **optional, backward-compatible** player-number field on the diagram dot.

## 2. Decisions locked (from the 2026-06-04 brainstorm)

| Decision | Choice |
|---|---|
| Visual direction | **B — "Matchday Grass"** (chosen over A Telestrator / C World-Cup-poster / D FIFA-HUD) |
| Mechanism | **Skin system** — one renderer, one data contract, four swappable skins |
| Skins shipped this pass | **All four** (`schematic`, `matchday`, `telestrator`, `arena`) |
| Player marker | **Mini jersey** (SVG path) with number on the chest; kit colour by kind |
| Player numbers | **Add** an optional `label` to the diagram dot; **auto-number fallback** when absent |
| Drill Library skin | **Hardwired `matchday`** — no user-facing switcher this pass |
| Default skin (no `skin` input) | **`schematic`** — byte-for-byte back-compat for existing callers |
| a11y | **Preserved, not weakened** — skins change pixels only; the hidden `<ul>`, `role="img"` summary, and legend logic stay shared |

## 3. Scope

**In:**
- A `DrillBoardSkin` contract + four skin definitions (`drill-board-skins.ts`).
- `<lib-drill-board-scene>` gains an optional `skin` input; resolves every visual from the active skin; renders skin-gated layers (grass, mow stripes, glow filter) and per-kind glyphs (jersey / circle / ball / cone).
- Mini-jersey glyph (pure geometry fn) + number rendering on player/defender/keeper dots.
- Optional `label` on `DrillDiagramDotSchema` (pack-football-contracts) + UI mirror re-export; **auto-number fallback** in the layout when `label` is absent.
- Per-kit number-contrast rule so chest numbers stay legible on every kit colour.
- Drill Library detail panel renders `skin="matchday"`.
- i18n: skin display names; number folded into each dot's aria label.
- Tests: skin-resolution unit tests, jersey-path geometry test, per-skin scene snapshots/DOM assertions, a11y assertions (labels + legend unchanged across skins), wire-schema parity for `label`.

**Out (deferred):**
- A **user-facing skin switcher** (skins are picked per-surface in code; a picker is future work).
- Wiring `telestrator` / `arena` onto their *target surfaces* (live-match, player-progression) — those surfaces don't exist yet; this pass **defines and ships the skins** so they're ready, and exercises each in the showcase/tests.
- An editor UI to **set** numbers per player — see §6 (a thin optional add; numbers render today via the auto-fallback regardless).
- Zoom / pan, posterior overlays, animation of runs/passes.
- Extracting a shared design-system `<fc-pitch>` brick (promote on a 2nd real consumer per ADR-176).

## 4. Architecture

Keep the established **`generation/` pattern**: pure layout fn → view-model → OnPush SVG component. The renderer stays **"data in → SVG out"** (the v1 design's core property). Skins slot in as a **resolved style object**, not a branch in the component.

```
DrillDiagram (data, unchanged)
        │
        ▼
layoutDrillBoard(diagram, viewport)         ← pure; now also threads `label` +
        │   → DrillBoardView (px-space)        auto-number fallback + number-aware aria
        ▼
<lib-drill-board-scene [diagram] [viewport] [skin]>
        │   skin = resolveSkin(skinName)      ← NEW: visuals come from the skin,
        ▼                                        not module constants
   SVG  ├─ surface layer   (skin: grass? stripes? line treatment)
        ├─ glow defs       (skin: optional filter)
        ├─ zone            (skin tokens)
        ├─ arrows          (skin: stroke/dash/width per kind)
        └─ dots            (skin: glyph + fill + stroke + number? per kind)
   +    hidden <ul> description · role="img" summary · legend   ← UNCHANGED, skin-agnostic
```

**Why a skin object, not a component per look:** the data model, layout maths, coordinate mapping, and the *entire* a11y surface are identical across looks — only fills, shapes, and a few decorative layers differ. A second component would duplicate the a11y (the expensive, correctness-critical part) four times. A resolved style object keeps one renderer and one a11y implementation.

**Why this stays out of the design-system:** skins are football-specific (jerseys, kits, pitch). They live in `pack-football-ui` next to the renderer. If a second pack ever needs a "skinned board," we extract then (ADR-176 promotion-on-demand), not now.

## 5. The skin contract

New file `libs/pack-football-ui/src/lib/generation/drill-board-skins.ts`. The current `drill-board-style.ts` constants become the `schematic` skin (preserving exact output); the file is kept as a thin re-export or folded in.

```ts
export type DrillBoardSkinName = 'schematic' | 'matchday' | 'telestrator' | 'arena';

export type DotGlyph = 'circle' | 'jersey' | 'ball' | 'cone';

export interface DotStyle {
  glyph: DotGlyph;
  fill: string;          // kit body / marker fill (may be a gradient url ref)
  stroke: string;        // trim / outline
  number: boolean;       // print the dot's number on the glyph?
  numberFill?: string;   // per-kit contrast colour for the number
}

export interface SkinSurface {
  grass: boolean;             // paint a pitch-fill rect?
  grassFill?: string;
  stripeFill?: string;        // mow-stripe band colour (alternating)
  lineColor: string;          // pitch markings
  lineOpacity: number;
  glowFilter?: string;        // optional <filter> id applied to markers/arrows
  defs?: string;              // skin-owned <defs> markup (gradients, filters)
}

export interface DrillBoardSkin {
  name: DrillBoardSkinName;
  surface: SkinSurface;
  dot: Record<DrillDotKind, DotStyle>;           // player|defender|keeper|cone|ball
  arrow: Record<DrillArrowKind, {                // pass|run|dribble|shot
    stroke: string; dash: string; width: number;
  }>;
}

export const SKINS: Record<DrillBoardSkinName, DrillBoardSkin> = { /* … */ };
export function resolveSkin(name: DrillBoardSkinName = 'schematic'): DrillBoardSkin { /* … */ }
```

**Glyph rendering.** A small pure geometry module `drill-board-glyphs.ts` exports:
- `jerseyPath(cx, cy, w): string` — the mini-shirt SVG path (body + two sleeves + collar notch), validated in the brainstorm to read clearly at marker scale.
- `conePoints(cx, cy, r): string` — moved from `drill-board-style.ts` (unchanged).

The scene component's dot loop switches on `skin.dot[kind].glyph` (`jersey` → `<path>`, `ball` → ball treatment, `cone` → `<polygon>`, `circle` → today's `<circle>`), then conditionally renders the number `<text>` when `skin.dot[kind].number`.

**The four skins, concretely** (recipes proven in the brainstorm mockups):
- `schematic` — `surface.grass=false`, `lineColor=currentColor @0.4`; all dots `glyph:'circle'`, `number:false`; arrow tokens = today's values. **Output is unchanged.**
- `matchday` — `grass=true` (`#2f9b4e` + `#36a957` stripes), white lines `@0.92`; `player` red kit, `defender` blue kit, `keeper` green kit, all `glyph:'jersey'`, `number:true`; `ball` real-ball gradient + pentagon; `cone` 3D gradient triangle; arrows white (pass) / gold dashed (run); subtle drop-shadow on markers.
- `telestrator` — dark pitch gradient + faint stripes, neon mint lines, `glowFilter` on markers/arrows; jerseys in luminous kit colours; cyan passing lanes.
- `arena` — glossy grass gradient, per-marker radial heat-glow, gradient jersey tokens with drop shadow, gradient passing lanes.

## 6. Player numbers (data-model change)

**Contract (`drill-diagram.schemas.ts`).** Add one optional field to `DrillDiagramDotSchema`:

```ts
label: z.string().max(3).optional(),   // jersey label: "7", "10", "GK", "C"
```

- **Backward-compatible:** optional → existing v1 diagrams validate unchanged; **no `schemaVersion` bump** (the `…v1` literal stays).
- A short **string** (≤3 chars), not a number — youth football uses "GK", captain "C", etc., and the keeper's old hardcoded "TW" becomes data.
- The UI mirror (`wire-schemas.ts`) re-exports the contract type unchanged (structural parity — no drift edit), and `wire-schemas-parity.spec.ts` continues to pass by construction.

**Auto-number fallback (`drill-board-layout.ts`).** When a `player`/`defender` dot has no `label`, assign one by **stable order within its kind** (1, 2, 3, …). Effect: **every existing seeded drill renders numbered immediately**, with no data migration; an explicit `label` always wins. `keeper`/`cone`/`ball` are not auto-numbered.

**Aria.** The number folds into the dot's existing aria label: _"Eigener Spieler Nr. 7 bei x, y"_ (new i18n key variant; falls back to the un-numbered phrase for cone/ball).

**Editor (deferred, thin).** Setting a custom number in the drill editor is out of scope this pass — the auto-fallback covers the visual goal. When added, it's one optional `<input maxlength="3">` per player dot in `drill-editor-panel`.

## 7. Accessibility (WCAG 2.2 AA — preserved)

The board's a11y model is **skin-independent and unchanged**:
- The SVG stays `role="img"` with the generated `summaryAriaLabel`; all decorative geometry stays `aria-hidden`.
- The visually-hidden `<ul>` remains the **canonical description** — so colour/shape are never the sole carrier of meaning (skins can restyle freely without an a11y regression).
- The visible legend stays, with swatches following the active skin (mini-shirts in `matchday`).

**New a11y obligations introduced by skins:**
1. **Number legibility** — chest numbers must stay readable on every kit colour. Per-kit `numberFill` (white on red/blue, dark on green) with a target ≥ 3:1 against the kit fill. The number is inside the `aria-hidden` SVG (semantics live in the `<ul>`), so this is a legibility rule, not a WCAG text-contrast gate — but we honour it anyway.
2. **Pitch-line contrast** — white lines on `matchday`/`arena` grass and mint lines on `telestrator` checked for visible separation.
3. **Non-colour kind distinction** — kept: keeper differs by kit *and* (optionally) "GK" label; opponent vs own differ by kit colour *and* the `<ul>` text. Glyph shape (jersey vs ball vs cone) carries kind too.

## 8. File touchpoints

**`pack-football-ui` (the bulk):**
- `generation/drill-board-skins.ts` — **new**: `DrillBoardSkin` contract + `SKINS` + `resolveSkin`.
- `generation/drill-board-glyphs.ts` — **new**: `jerseyPath`, `conePoints` (moved).
- `generation/drill-board-scene.component.ts` — `skin` input; resolve skin; render surface (grass/stripes), skin `defs`, glow, per-kind glyph + number; legend swatches per skin.
- `generation/drill-board.types.ts` — `label?` on the view dot; re-export skin types.
- `generation/drill-board-layout.ts` — thread `label`; auto-number fallback; number-aware aria.
- `generation/drill-board-style.ts` — folded into `schematic` skin (or thin re-export).
- `drills/drill-bibliothek.component.ts` — pass `skin="matchday"` to the detail board.
- `tactical-board/board-i18n.ts` — skin display names; numbered-dot aria key.
- specs: `drill-board-scene.component.spec.ts`, `drill-board-layout.spec.ts` (+ new glyph/skin specs).

**`pack-football-contracts`:**
- `lib/drill-diagram.schemas.ts` — optional `label` on the dot; `contracts.spec.ts` coverage.

**`pack-football-ui/data`:**
- `wire-schemas.ts` — structural re-export (no edit beyond the contract carrying `label`); `wire-schemas-parity.spec.ts` stays green.

**No changes:** kernel/substrate, design-system, `pack-football` domain logic, persistence, the API surface.

## 9. Sequencing (implementation-plan hint)

A natural three-PR arc (the plan refines this):
1. **Skin seam + `schematic` parity** — introduce the skin contract, port today's look into `schematic`, scene resolves from skin; **output byte-identical**, all specs green. (De-risks the refactor with zero visual change.)
2. **Numbers + Matchday** — add `label` + auto-fallback; jersey glyph; `matchday` skin; hardwire it in the Drill Library; a11y + contrast specs.
3. **Telestrator + Arena** — the two remaining skins + their showcase/test coverage.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Skin refactor silently changes `schematic` output | PR-1 asserts byte/DOM-identical schematic render before any new skin lands |
| Jersey glyph clutters at many-dot drills / small thumbnails | Validated legible in brainstorm at thumbnail scale; marker size tuned per viewport; numbers optional per skin |
| Number contrast poor on some kit (esp. green keeper) | Per-kit `numberFill` rule (§7); dark number on light kits |
| `label` field drifts UI mirror vs contract | Structural re-export (single source) + existing parity spec |
| Scope creep into a skin switcher / editor numbers | Explicitly deferred (§3); auto-fallback meets the visual goal without either |

## 11. Out of scope (explicit)

User-facing skin switcher · per-surface wiring of telestrator/arena onto live-match & progression surfaces (surfaces don't exist yet) · editor number input · zoom/pan · run/pass animation · posterior overlays · shared `<fc-pitch>` design-system brick.
