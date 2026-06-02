# Pack-football what-if comparison-overlay UI — technical design

- **Date:** 2026-06-02
- **Domain:** exercir / pack-football-ui
- **Issue:** [exercir#120](https://github.com/de-braighter/exercir/issues/120) — what-if comparison-overlay UI
- **Builds on:** #119 (the `POST /players/:id/what-if` endpoint, PR #168) + the existing `posterior-comparison-chart` component
- **Status:** approved scope (founder chose "wire real endpoint + PlayerWhatIfChrome"), pending plan

## 1. Problem + the stale-issue correction

#120 as written asks to "port the comparison-overlay UI from `twin-what-if-endpoint.md` §4" onto three "player surfaces" (phase scrubber / system-map cells / indicator timeline). **Those surfaces are retired-stack concepts** (the oncology KAN-051 pathway-player; `libs/kernel-twin`, `apps/web`) — they do not exist in the current `pack-football-ui` and were deferred. The concept doc is historical.

What exists today: `posterior-comparison-chart.component.ts` already renders two posterior arms (baseline vs counterfactual) as WCAG-grade SVG (aria-label, off-screen data table), fed by **hardcoded demo data** from `InMemoryPlayerFunnelAdapter`, not the real `/what-if` endpoint shipped in #119.

**Achievable #120 (founder-approved):** connect the existing chart to the real endpoint via a real client + schema mirror, and add the `PlayerWhatIfChrome` affordance (toggle + WCAG-complete delta strip + arm labels). Drop the retired surfaces.

## 2. The four deliverables

### D1 — Schema mirror + parity (`libs/pack-football-ui/src/lib/data/`)

`pack-football-ui` mirrors wire shapes rather than importing `pack-football` (browser-bundle boundary; `wire-schemas.ts` + `wire-schemas-parity.spec.ts`). Add:

- `WhatIfArmSchema` = `{ treeRootId: uuid, mean, p10, p50, p90, sd: number }`.
- `WhatIfComparisonSchema` = `{ playerId: uuid, indicatorKey: string, baseline: WhatIfArm, counterfactual: WhatIfArm, liftMean, liftP50: number, direction: 'improves'|'worsens'|'flat', runId: string }`.
- Mirror the failure shape used by the client (`WhatIfFailure` kinds: `subject-not-supported`/`invalid-input`/`inference-unavailable`/`inference-failed`).
- **Parity spec:** source-text guard asserting the mirrored field set matches `libs/pack-football/src/in-ports/compare-drill-what-if.use-case.ts` (the existing parity-spec pattern reads the canonical file text and checks each field name is present — keeps the mirror honest without importing).

### D2 — Client method (`substrate-client.ts`)

Add `compareWhatIf(playerId, { baselineTreeRootId, counterfactualTreeRootId, indicatorKey? }, signal?)` mirroring `getPlayerProjection`:
- `POST /pack-football/players/:id/what-if` with the context headers (`x-tenant-id`/`x-pack-id`/`x-user-id`/`x-request-id`) the client already attaches.
- Validate the 2xx body with `WhatIfComparisonSchema`; wrap non-2xx / network / schema-mismatch / abort in the existing `SubstrateClientError`.

### D3 — `PlayerWhatIfChrome` component (`libs/pack-football-ui/src/lib/player/ui/`)

A **presentational** standalone OnPush component. Input: `comparison: WhatIfComparison` (+ optional `baselineLabel`/`counterfactualLabel` strings, default to short tree-root ids). Internal signal: `expanded` (toggle). Renders:

1. **Header + toggle** — a `<button>` (`aria-expanded`, `aria-controls`) toggling the overlay body; arm labels ("Baseline · {baselineLabel}" / "Counterfactual · {counterfactualLabel}").
2. **Delta strip (the WCAG fix)** — the existing chart encodes direction by **colour only**. The strip pairs the lift with **iconography + text + SR label**:
   - icon by `direction`: `improves → ▲`, `worsens → ▼`, `flat → —` (a `<span aria-hidden="true">`).
   - visible text: `{+/−}{liftMean*100} pp` (matching the chart's `pp` convention).
   - `aria-label` / sr-only: e.g. `"Pass-Vollendung verbessert sich um 5.00 Prozentpunkte (Drill Y gegenüber Drill X)"` driven by `direction` (improves→„verbessert sich"/worsens→„verschlechtert sich"/flat→„unverändert"). **Direction is never colour-only** (WCAG 1.4.1 Use of Color).
3. **The embedded chart** — when `expanded`, render `lib-posterior-comparison-chart` mapping the comparison via D4. The `runId` shows as a trace handle (mirrors the page's existing `inputHash` meta).

Add `player-what-if-chrome.component.spec.ts`: toggle behaviour (aria-expanded flips, body shows/hides), the three direction → icon/label cases, the SR label text, and that the embedded chart receives the mapped comparison.

### D4 — `WhatIfComparison → PosteriorComparison` mapper (pure fn, colocated with the chrome)

The chart consumes the funnel-port `PosteriorComparison` shape. Map (no chart change):
```
{ drillX: baselineLabel, drillY: counterfactualLabel,
  baseline:   { mean,p10,p50,p90,sd } from comparison.baseline,
  counterfactual: { … } from comparison.counterfactual,
  indicatorKey: comparison.indicatorKey,
  inputHash: comparison.runId }
```
Unit-test the mapper directly (1 case is enough — it's a field rename).

## 3. Funnel-page wiring + the drill-key→tree-root decision (D5)

The page's `?counterfactual=drill-x-vs-y` shorthand resolves to drill **keys** (`COUNTERFACTUAL_SHORTHAND` → `tac_buildup`/`tac_press`); the endpoint needs tree-root **UUIDs**. Decision:

- **Render the chrome in place of the bare chart + meta-row.** When the loaded `PlayerFunnelView` carries a comparison, wrap it in `PlayerWhatIfChrome`. This keeps the in-memory demo path working (the chrome is presentational; it renders whatever comparison shape it's mapped from) — *no demo regression*.
- **Add the real path as the source when tree-roots are resolvable.** The page already loads the plan-tree (`getPlanTree`); resolve `baselineTreeRootId` + `counterfactualTreeRootId` by matching `DRILL_X_KEY`/`DRILL_Y_KEY` against plan-node intervention keys. When both resolve, call `compareWhatIf(...)` and feed the chrome the real `WhatIfComparison`; otherwise fall back to the existing port comparison (mapped) and show a small "Demo-Daten" note.
- **Risk flagged for implementation:** whether the seeded plan-tree (S7 POC Drill-X/Drill-Y subtrees) actually exposes resolvable UUID roots for those keys is verified during the implementer's first integration step. If the seed lacks them, ship the chrome on the existing (demo) comparison data + file a seed follow-up to expose the tree-roots — the chrome + client + schema are still real and the WCAG affordance still lands. **Do not block the chrome on the seed.**

## 4. Out of scope

- The retired surfaces (phase scrubber, system-map cells, indicator-timeline ghost) — non-existent; not built.
- Indicator-polarity (#121) — the `direction` already comes from the endpoint; the chrome just renders it (the hardcoded higher-is-better convention lives server-side and is #121's concern).
- Multi-arm / SSE (#122).
- Promoting the chart/chrome to a design-system brick — separate (#126-class).

## 5. Testing + a11y

- Vitest component specs (the lib's `@nx/angular:unit-test` executor): chrome (toggle + 3 directions + SR label + embedded-chart input), the mapper, the client method (mock fetch → schema parse + error wrapping), the parity spec.
- a11y: the delta strip satisfies WCAG 1.4.1 (icon+text, not colour-only) + 4.1.2 (`aria-expanded`/`aria-controls` on the toggle) + an sr-only direction sentence. No new axe harness is introduced (the lib has none today); assertions are explicit DOM checks.
- Build: `npx nx build pack-football-ui`.

## 6. Acceptance criteria

- [ ] `WhatIfArmSchema`/`WhatIfComparisonSchema` mirrored in `wire-schemas.ts` + parity spec green.
- [ ] `compareWhatIf()` on `substrate-client.ts` (POST + headers + schema-validated + error-wrapped) with a spec.
- [ ] `PlayerWhatIfChrome` (toggle + WCAG delta strip ▲/▼/— + SR label + arm labels) embedding the chart via the mapper; spec green.
- [ ] `fc-player-funnel-page` renders the chrome; resolves real tree-roots + calls `compareWhatIf` when available, graceful demo fallback otherwise; page spec green.
- [ ] `npx nx build pack-football-ui` green; no demo-runtime regression.
