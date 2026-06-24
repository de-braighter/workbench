---
product_key: system-builder-studio
build_path_date: 2026-06-24
status: build-path
charter: docs/foundry/system-builder-studio/charter.md
masterplan: docs/superpowers/specs/2026-06-24-unified-cockpit-masterplan.md
risk_tier: T0
item_count: 2
phase: Unified Cockpit — Phase D3 (calibration pane)
---

# Build Path — Unified Cockpit Phase D3 (calibration pane)

> Masterplan layer 5 (calibration): wire devloop **predicted-vs-observed** onto the modeled guardrails
> so they become *measurable*. The guardrail (D1) declares an effect and emits observed firings
> (`sdlc:GuardrailFired.v1`); D3 renders the calibration — "does this guardrail actually do what it
> claims?" Same fixture-port discipline as A2/D2 (no live devloop reach from the browser; devloop-shaped
> data; live wiring deferred). Self-contained in a new `calibration/` folder; embedding the pane into the
> cockpit page (`operate/`) is a deferred cosmetic follow-up (kept out to preserve scope disjointness).
>
> **Product:** `system-builder-studio` (T0 waiver). **Repo:** `de-braighter/studio` (additive).

## ADR needs & gates

**None.** T0, `zero-kernel-change` (a pack-level calibration view + port; composes-not-authors). Gates WAIVED (T0).

## Quality battery config

| Obligation | Applies to |
|---|---|
| `wave-standard` | all items |
| `zero-kernel-change` | all items |
| `a11y-battery` | D3-2 (the calibration UI) |
| `two-trees-discipline` | D3-2 (renders projection only) |

`yields`: omitted (in-app UI/infra).

## Work items

All scopes `repo: de-braighter/studio`; pathPrefix repo-relative. (Both in `calibration/`; **D3-2 dependsOn
D3-1** → ordered → may share scope.)

| itemId | title | pathPrefix | dependsOn | lane | qualityObligations |
|---|---|---|---|---|---|
| `…/D3-1-calibration-port` | Phase D3.1 — Guardrail calibration port + view-model: define `GUARDRAIL_CALIBRATION_PORT` (per-guardrail predicted-vs-observed, **devloop-shaped**: declared effect / observed firings / a calibration score) with an **in-memory/fixture** adapter (NOT live devloop). A pure `buildCalibrationViewModel` combining the spine guardrail model (`evaluateGuardrails`/`DEFAULT_GUARDRAILS`, read-only) with the calibration data — a derived view, nothing stored. No UI. | `apps/studio-ui/src/app/calibration/` | — | calibration | wave-standard, zero-kernel-change |
| `…/D3-2-calibration-pane` | Phase D3.2 — Calibration pane UI: a standalone routeless component rendering the calibration readout per guardrail (declared effect vs observed firings, the score, an "is it working?" verdict). WCAG 2.2 AA; render projection only (two-trees). Reads the fixture-backed port only (live devloop wiring deferred). | `apps/studio-ui/src/app/calibration/` | `…/D3-1-calibration-port` | calibration | wave-standard, zero-kernel-change, a11y-battery, two-trees-discipline |

## Disjointness proof

Both items `repo: de-braighter/studio`, scope `calibration/` (new folder). **D3-2 dependsOn D3-1** →
ordered → may share scope; no unordered pairs. Cross-product: `calibration/` is a non-nested sibling of
the live path-builder's `studio/**` and of `operate/`, `spine/`, `guardrail-tracer/` → disjoint by path.
D3-1 reads `spine/` read-only. Dangling check: `D3-1-calibration-port` is in the list. ✓
