---
product_key: studio
build_path_date: 2026-06-22
status: build-path
charter: docs/foundry/studio/charter.md
risk_tier: T0
item_count: 8
---

# Build Path — Path-Builder Studio (authoring)

Decomposes the charter's authoring wedge (3 surfaces + glass, bound to the real `scenario-lab`
engine, on `[data-theme="night"]`) into 8 scope-disjoint, one-session work items in the EXISTING
`de-braighter/studio` repo (`apps/studio-ui`). IDs are namespaced `studio/PB-E*` (the bare
`studio/E*` namespace is taken by the shipped recipe-designer slices).

## Scaffold plan

No `/new-domain` — extends the shipped `apps/studio-ui` Angular app (npm; `package-lock.json`).
New code lands under `apps/studio-ui/src/app/studio/`. The one scaffold decision (PB-E1):
**`@de-braighter/scenario-lab` is `private: true` / unpublished** — studio-ui cannot `npm install`
it. PB-E1 resolves this by either (a) a local/workspace dependency to `domains/scenario-lab` (its
engine entry is `src/engine/index.ts`, exporting `ScenarioSpec`/`CohortInput`/`runScenario`/
`renderReport`/report+metrics types), or (b) vendoring the contract types into
`src/app/studio/shared/scenario-lab-contracts.ts`. Prefer the typed-contract import (T0 binds to
shapes, not the runtime); the worker picks the mechanism + documents it. No port pair (UI-only,
no api/db tier).

## Epic ladder

- **PB-E1 — Authoring shell** (sequencing): routes + nav + scenario-lab wiring + profile loader +
  shared three-pane layout. Acceptance: `/studio/{author,profiles,results}` resolve (placeholders),
  build green, both profiles load.
- **PB-E2 — /studio/author three-pane shell** (sequencing for the panes): the layout container +
  selected-node→center wiring. Acceptance: the three pane slots render; selecting an intervention
  routes it to the center slot.
- **PB-E2.1 / E2.2 / E2.3 — the three author panes** (parallel): plan-tree · effect-authoring panel
  (the make-or-break) · cohort designer. Acceptance per pane: binds 1:1 to the engine type, renders
  the prompt's states, curves drawn.
- **PB-E3 — /studio/profiles**: the two-profiles-side-by-side demonstrator + switcher. Acceptance:
  switching re-labels the whole screen + changes tracking depth; reuses the author panes.
- **PB-E4 — /studio/results**: the `ScenarioReport` dashboard. Acceptance: KM/calibration/C-index/
  counterfactual sections render from a fixture report (inline SVG).
- **PB-E5 — glass+neon treatment**: studio-local glass utilities (blur/glow/aurora/rim) in
  `styles.css`. Acceptance: surfaces opt into the glass classes; night ground unaffected for
  non-opted surfaces.

The wedge loop runs when PB-E1+E2+E2.1–3 land: a domain expert authors an intervention's effect on
`/studio/author` against a real `scenario-lab` profile, code-free.

## UI-surface plan

| Prototype surface (`pack-studio/*.dc.html`) | Verdict | Item |
| --- | --- | --- |
| Path Builder Studio / Multi Effect Author | **in** (the wedge) | PB-E2 + PB-E2.1/2.2/2.3 |
| Profile Switcher | **in** | PB-E3 |
| Results Dashboard / Studio Results | **in** | PB-E4 |
| Studio Shell | **in** (shell) | PB-E1 |
| Catalog · Path Library/Template/Instance/States · Guided Wizard/Canvas · Indicator Registry · Interventions Library · Profile Editor · System Map · Easy Mode · Coach Planner | **deferred** (outside the authoring wedge — charter §What-NOT-to-build #2) | — |

Each in-scope surface is pathPrefix'd to its own dir under `src/app/studio/`; PB-E1 owns the shared
shell (routes/nav/layout/i18n loader). German de-CH strings live page-scoped inside each surface's
dir; PB-E1 owns shared/common keys + the i18n wiring.

## ADR needs & gates

**None.** T0, pack-native: the charter forbids kernel / `scenario-lab` / `design-system` brick
changes (composes-not-authors). The glass treatment is studio-local CSS; **IF** a worker proves glass
must become shared `design-system` tokens, that's a separate architecture-gated item (charter §Gate
schedule) — surface it, do not bundle. No ADR-authoring items.

## Quality battery config

T0 battery (from the charter quality plan), applied per item:

| Obligation | Applies to |
| --- | --- |
| `tdd`, `review-floor`, `opus-whole-branch` | ALL items (universal) |
| `a11y-battery` | all UI items (PB-E2…E5) — WCAG 2.2 AA + focus-recovery |
| `reactive-forms-cva` | PB-E2.2 only (the effect-authoring form) |
| `engine-binding-fidelity` | PB-E1, E2.1, E2.2, E2.3, E3, E4 (items binding to `scenario-lab` types) |

Acceptance (every item): `npm test` + `npm run build` green. **npm only in `domains/studio`.**
Every merge founder-gated.

## Lanes & parallelism

`shell` (PB-E1) → then fan out: `author` (PB-E2 → E2.1/E2.2/E2.3), `results` (PB-E4), `theme`
(PB-E5) run in parallel after PB-E1; `profiles` (PB-E3) waits on the author panes (it reuses them).
Max parallel width after PB-E1+E2 land: 5 (E2.1, E2.2, E2.3, E4, E5).

## Work items

| itemId | title | scope (repo=studio) | dependsOn | lane | qualityObligations |
| --- | --- | --- | --- | --- | --- |
| `studio/PB-E1` | Path-Builder Studio shell: register `/studio/{author,profiles,results}` routes + nav, wire `@de-braighter/scenario-lab` (private — local dep or vendor `engine/index.ts` contracts into `shared/`), add a ProfileLoader exposing the oncology + predictive-maintenance profiles + shared three-pane layout + i18n loader | `pathPrefix: apps/studio-ui` | — | shell | tdd, review-floor, opus-whole-branch, engine-binding-fidelity |
| `studio/PB-E2` | `/studio/author` three-pane shell: layout container + selected-intervention→center wiring (panes filled by PB-E2.1/2.2/2.3) | `pathPrefix: apps/studio-ui/src/app/studio/author` | studio/PB-E1 | author | tdd, review-floor, opus-whole-branch, a11y-battery |
| `studio/PB-E2.1` | author plan-tree pane: single-parent stage/intervention/decision tree; selecting an intervention emits to the shell | `pathPrefix: apps/studio-ui/src/app/studio/author/plan-tree` | studio/PB-E2 | author | tdd, review-floor, opus-whole-branch, a11y-battery, engine-binding-fidelity |
| `studio/PB-E2.2` | author effect-authoring panel (the make-or-break): `EffectDeclaration` reactive form — indicator, direction −/+/?, magnitude-prior distribution-picker (Punkt/Normal/Beta, live inline-SVG curve), confidence slider, basis/provenance, horizon, plain-language declaration footer, 5 states; distribution-picker + slider + direction-toggle as reusable CVA controls | `pathPrefix: apps/studio-ui/src/app/studio/author/effect-panel` | studio/PB-E2 | author | tdd, review-floor, opus-whole-branch, a11y-battery, reactive-forms-cva, engine-binding-fidelity |
| `studio/PB-E2.3` | author cohort/synthetic-world strip: `CohortInput` — n, Weibull(shape,scale) baseline with a live inline-SVG survival-curve preview, subgroups, censoring | `pathPrefix: apps/studio-ui/src/app/studio/author/cohort` | studio/PB-E2 | author | tdd, review-floor, opus-whole-branch, a11y-battery, engine-binding-fidelity |
| `studio/PB-E3` | `/studio/profiles` domain-invariance demonstrator: the author screen rendered for TWO profiles side-by-side + a profile switcher that re-labels the screen + changes tracking depth (heavy provenance/governance ↔ light note) | `pathPrefix: apps/studio-ui/src/app/studio/profiles` | studio/PB-E1, studio/PB-E2.1, studio/PB-E2.2, studio/PB-E2.3 | profiles | tdd, review-floor, opus-whole-branch, a11y-battery, engine-binding-fidelity |
| `studio/PB-E4` | `/studio/results` dashboard from `ScenarioReport`: KM survival curves, calibration, C-index, counterfactual deltas — hand-drawn inline SVG, no charting lib; binds a fixture `ScenarioReport` | `pathPrefix: apps/studio-ui/src/app/studio/results` | studio/PB-E1 | results | tdd, review-floor, opus-whole-branch, a11y-battery, engine-binding-fidelity |
| `studio/PB-E5` | glass+neon treatment: studio-local glass utility classes/vars (backdrop-blur, glow, aurora, rim-light) in `styles.css`; surfaces opt in; do NOT modify design-system tokens (promotion is a separate architecture-gated item) | `pathPrefix: apps/studio-ui/src/styles.css` | studio/PB-E1 | theme | tdd, review-floor, opus-whole-branch, a11y-battery |

## Disjointness proof

All items same `repo: studio`; disjointness by pathPrefix (rule 2: disjoint iff neither normalized
prefix is a prefix of the other). Only **unordered** pairs (neither transitively dependsOn the other)
need proof — ordered pairs (any item vs an ancestor it dependsOn, transitively) may share scope.

Ordered (no proof): everything → PB-E1; PB-E2.{1,2,3} → PB-E2; PB-E3 → PB-E2.{1,2,3} → PB-E2. The
PB-E1 prefix `apps/studio-ui` is a prefix of every other item's path, but every other item
transitively dependsOn PB-E1 → never co-claimed. Likewise PB-E2 (`…/studio/author`) is a prefix of
PB-E2.{1,2,3}, which dependsOn it.

Unordered pairs:

| Pair | Evidence | Verdict |
| --- | --- | --- |
| PB-E2.1 vs PB-E2.2 | `…/author/plan-tree` vs `…/author/effect-panel` — neither a prefix | disjoint |
| PB-E2.1 vs PB-E2.3 | `…/author/plan-tree` vs `…/author/cohort` | disjoint |
| PB-E2.2 vs PB-E2.3 | `…/author/effect-panel` vs `…/author/cohort` | disjoint |
| PB-E2.{1,2,3} vs PB-E4 | `…/author/*` vs `…/studio/results` | disjoint |
| PB-E2.{1,2,3} vs PB-E5 | `…/author/*` vs `…/src/styles.css` | disjoint |
| PB-E2 vs PB-E4 | `…/studio/author` vs `…/studio/results` | disjoint |
| PB-E2 vs PB-E5 | `…/studio/author` vs `…/src/styles.css` | disjoint |
| PB-E3 vs PB-E4 | `…/studio/profiles` vs `…/studio/results` | disjoint |
| PB-E3 vs PB-E5 | `…/studio/profiles` vs `…/src/styles.css` | disjoint |
| PB-E4 vs PB-E5 | `…/studio/results` vs `…/src/styles.css` | disjoint |

Every `dependsOn` id appears in the item list (no dangling deps). No cross-repo / ADR items.
PB-E1's broad `apps/studio-ui` prefix is intentional (it owns the shared shell + root wiring); it
is the sole no-dependency item, so it is the only one claimable first and serializes correctly
ahead of the fan-out.
