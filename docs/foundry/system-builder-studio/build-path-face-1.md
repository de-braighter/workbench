---
product_key: system-builder-studio
build_path_date: 2026-06-24
status: build-path
charter: docs/foundry/system-builder-studio/charter.md
plan: docs/superpowers/specs/2026-06-24-face-realization-plan.md
handoff: docs/ui-design/path-builder-studio-handoff/
risk_tier: T0
item_count: 1
phase: Face Realization — F1 (Betrieb / operate cockpit, high fidelity)
---

# Build Path — Face F1 (Betrieb: the operate cockpit, high fidelity)

> First surface of the face realization. Upgrades the D2 operate cockpit (`operate/`) to the
> high-fidelity **Betrieb** design from the handoff — story-ticket queue (same node ids), claim chips,
> observe feed, prominent **gate-decide** — on the SAME engine we built (D2 `FOUNDRY_DRIVE_PORT` +
> `buildCockpitViewModel`, D1 guardrail firings). Non-overlapping with the in-flight path-builder.
> Proves the recreate-from-handoff approach. **The handoff is a base** — recreate Betrieb faithfully;
> extend thin spots sensibly.

## Design source

- `docs/ui-design/path-builder-studio-handoff/Betrieb.dc.html` (the surface) — read the `class
  Component` logic block (the spec) + the markup (look/layout).
- `docs/ui-design/path-builder-studio-handoff/README.md` §5 (Betrieb) + Design Tokens + Interactions.
- Tokens: use the published `@de-braighter/design-system` + the `exercir` skin (`data-skin`); the
  handoff `colors_and_type.css` gives intended VALUES — do NOT copy it; reconcile vocabulary with what
  `studio-ui` already uses. Do NOT port `support.js`/`.dc.html`.

## ADR needs & gates

**None.** T0, `zero-kernel-change` (UI upgrade on existing pack-level ports; composes-not-authors).
Gates WAIVED (T0).

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
| `…/FACE-1-betrieb-cockpit` | Face F1 — Recreate the **Betrieb** operate-cockpit surface at high fidelity in `operate/`: story-ticket queue (node ids), claim chips, observe feed, prominent gate-decide (Freigeben/Zurückweisen) — glass+neon, de-braighter tokens, exercir skin. Bind to the EXISTING `FOUNDRY_DRIVE_PORT` + `buildCockpitViewModel` (D2) + guardrail firings (D1); fixture-backed (no live foundry). Recreate from the handoff `Betrieb.dc.html` + README §5; extend thin spots sensibly. WCAG 2.2 AA; render projection only. | `apps/studio-ui/src/app/operate/` | — | face | wave-standard, zero-kernel-change, a11y-battery, two-trees-discipline |

## Disjointness proof

One item, scope `operate/`. No unordered pairs. Cross-product: `operate/` is a non-nested sibling of the
live path-builder's `studio/**`, of `spine/` (D-phases), `calibration/`, `guardrail-tracer/` → disjoint
by path. Reads `spine/` (guardrail firings) read-only. No dangling deps; no cross-repo / ADR items.
