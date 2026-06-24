---
title: Face Realization — Path Builder Studio (the Unified Cockpit face)
status: proposed
date: 2026-06-24
scope: design-global
tier: charter
source: docs/ui-design/path-builder-studio-handoff/   # the Claude Design handoff (canonical reference)
masterplan: docs/superpowers/specs/2026-06-24-unified-cockpit-masterplan.md
---

# Face Realization — Path Builder Studio (System Builder Studio)

> The masterplan's **Studio layer** (the cockpit face) now has a concrete, high-fidelity design: the
> Path Builder Studio handoff (`docs/ui-design/path-builder-studio-handoff/`). This plan realizes it in
> the Angular `studio-ui` app, on top of the engine we already built (D1–D4: spine, guardrails, drive
> port, calibration). **It is a BASE, not a frozen spec** — recreate faithfully where specified, extend
> sensibly where thin (Betrieb + Reproduzierbarkeit are "reference as-is"; the authoring side is the
> recently-polished part).

## Principles (from the handoff README)

- **Recreate in Angular `studio-ui`** — do NOT port `support.js` or the `.dc.html` template syntax. The
  README + the `.dc.html` logic-classes are the spec; the markup shows look/layout/behavior.
- **High fidelity** — glass + neon, exact de-braighter tokens. **Use the published
  `@de-braighter/design-system` tokens + the `exercir` (cyan) skin** (`data-skin`), NOT a copy of
  `colors_and_type.css`. Reconcile the token vocabulary with what `studio-ui` already uses (see the
  token-divergence note); the handoff CSS gives the intended VALUES.
- **Skins = profiles** — exercir (cyan, light) / strategir (violet, heavy/clinical) / operir (emerald).
  The skin-switcher IS the profile-switcher (studio-product-direction).
- **Substrate-shaped** — "derived relationships (compute, don't store)" = ADR-176; the node inspector
  renders the effect-declaration algebra (Gaussian prior μ±σ, confidence, basis, horizon).
- **a11y (WCAG 2.2 AA) + two-trees-discipline** on every surface.

## Surfaces → our engine

| Handoff surface | Realize in | Sits on |
|---|---|---|
| **Betrieb** (operate: story-ticket queue, claim chips, observe feed, gate-decide) | `operate/` (upgrade D2) | D2 drive port + D1 guardrails |
| **Reproduzierbarkeit** (results: run manifest + predicted-vs-observed ±2σ) | `calibration/` (upgrade D3) | D3 calibration view-model |
| **Studio shell** (3 tabs Katalog/Betreiben/Ergebnisse + editor routes) | app shell | the convergence (see below) |
| **Catalog** (8 libraries) | new `catalog/` | the metamodel |
| **Editor** (plan-tree + node inspector + "In Foundry ausführen") | new `editor/` (or converge w/ build-path/) | the push actuator + plan-tree |
| **ItemEditor** (7 building-block types) | new `item-editor/` | the metamodel |

## Convergence (the one decision to settle before the authoring side)

This face **unifies two foundry products**: `system-builder-studio` (the cockpit: build-path designer,
operate, spine, guardrails, calibration) and `studio` (the path-builder, queued `PB-E2.x` items under
`apps/studio-ui/src/app/studio/`, bound to scenario-lab). The handoff's **Editor/ItemEditor/Catalog
overlap the queued `PB-E2.x`** authoring panes.

**DECIDED (founder, 2026-06-24): SUPERSEDE.** The queued path-builder authoring items are retired in
favor of the unified handoff authoring — `PB-E2.1/2.2/2.3` (panes) + `PB-E3` (the "two profiles
side-by-side" demonstrator) released `done` with supersede notes (not re-queued). **No side-by-side
demonstrator** is in scope — profile/skin switching is handled by the unified shell (skin = profile).
The `studio` path-builder product is fully drained. The authoring side (Catalog/Editor/ItemEditor + the
3-tab Shell) is therefore **unblocked**. Follow-up (deferred, non-urgent): clean up the already-merged
legacy path-builder code under `apps/studio-ui/src/app/studio/` (PB-E1 shell + PB-E2 container) once the
handoff authoring lands — it does not conflict with the new face folders (`catalog/`, `editor/`,
`item-editor/`, the new shell), so removal is a tidy-up, not a blocker.

## Build sequence (face-first, prove on one)

- **F1 — Betrieb** (operate cockpit, high fidelity, on the D2/D1 engine) — the first proof of the
  recreate-from-handoff approach. Non-overlapping. ← starting now.
- **F2 — Reproduzierbarkeit** (results/calibration, high fidelity, on the D3 engine). Non-overlapping.
- **[convergence decision]**
- **F3 — Studio shell** (3 tabs + routing; converges the app frame).
- **F4 — Catalog** · **F5 — Editor** · **F6 — ItemEditor** (the authoring side; reconcile with `PB-E2.x`).

Tier T0, zero-kernel-change, additive in `de-braighter/studio`. Each surface is its own scope-disjoint
foundry phase referencing the handoff file + README section.
