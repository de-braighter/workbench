---
product_key: system-builder-studio
build_path_date: 2026-06-24
status: build-path
charter: docs/foundry/system-builder-studio/charter.md
plan: docs/superpowers/specs/2026-06-24-face-realization-plan.md
handoff: docs/ui-design/path-builder-studio-handoff/
risk_tier: T0
item_count: 1
phase: Face Realization — F2 (Reproduzierbarkeit / results, high fidelity)
---

# Build Path — Face F2 (Reproduzierbarkeit: results, high fidelity)

> The second cockpit-side surface. Recreates the handoff **Reproduzierbarkeit** (run manifest +
> predicted-vs-observed ±2σ bands) at high fidelity in `calibration/`, upgrading the D3 calibration pane
> and binding to the existing D3 `buildCalibrationViewModel` + a fixture run-manifest. Non-overlapping
> (own folder). The handoff is a base — recreate faithfully, extend thin spots.

## Design source
- `docs/ui-design/path-builder-studio-handoff/Reproduzierbarkeit.dc.html` (read the logic class = spec).
- `README.md` §6 + Design Tokens + Interactions.
- Tokens: published `@de-braighter/design-system` + `exercir` skin; do NOT copy `colors_and_type.css`.
- **Apply the F1 CSS-budget pattern:** static layout as inline `style=`; stateful rules in a small
  component stylesheet; glass+neon via global utilities (avoids the 8KB `anyComponentStyle` error).

## ADR needs & gates
**None.** T0, `zero-kernel-change`. Gates WAIVED (T0).

## Quality battery config
| Obligation | Applies to |
|---|---|
| `wave-standard` | the item |
| `zero-kernel-change` | the item |
| `a11y-battery` | the item (WCAG 2.2 AA) |
| `two-trees-discipline` | the item (render projection only) |

`yields`: omitted (UI surface).

## Work items
| itemId | title | pathPrefix | dependsOn | lane | qualityObligations |
|---|---|---|---|---|---|
| `…/FACE-2-reproduzierbarkeit` | Face F2 — Recreate the **Reproduzierbarkeit** (results) surface at high fidelity in `calibration/`: run manifest + predicted-vs-observed ±2σ bands (hand-drawn inline SVG, no charting lib), honest verdicts (no flattering of weak/awaiting-data). Bind to the EXISTING D3 `buildCalibrationViewModel` + a fixture run-manifest; glass+neon, de-braighter tokens, exercir skin. Recreate from the handoff `Reproduzierbarkeit.dc.html` + README §6; extend thin spots. Apply the F1 CSS-budget pattern. WCAG 2.2 AA; render projection only. | `apps/studio-ui/src/app/calibration/` | — | face | wave-standard, zero-kernel-change, a11y-battery, two-trees-discipline |

## Disjointness proof
One item, scope `calibration/`. No unordered pairs. Cross-product: `calibration/` is a non-nested
sibling of `operate/`, `spine/`, `guardrail-tracer/`, and the (now-superseded) `studio/**` → disjoint by
path. Reads `spine/` read-only. No dangling deps; no cross-repo / ADR items.
