---
product_key: agri-ecosystem-twin
source: docs/ideas-inbox/Agricultural Ecosystem Twin.zip
intake_date: 2026-06-10
status: intake
---

# Dossier Record — Agricultural Ecosystem Twin

## Essence

A digital twin platform for farms and regenerative agriculture that models the
causal relationship between soil health, biodiversity, weather, interventions,
and long-term resilience — so farmers and advisors can plan ecological
interventions with projected effects rather than just record operations or
compliance. The "killer feature" is ecological counterfactuals: comparing
intervention options (e.g. cover crop mix A vs B) on indicators like soil
moisture, pest pressure, and yield across multiple seasons. The dossier is not
just a written spec: it ships a **working browser prototype** — an interactive
twin of a synthetic 44-hectare Mendocino estate (`Substrate.html` + a React
app) and a 14-slide investor pitch deck (`Substrate Pitch.html`) — so the
concept is already demonstrated, not merely described.

- Agriculture is a complex state-changing system; most farm software manages
  operations/compliance/yield, but few model the soil↔biodiversity↔weather↔
  intervention causal chain or long-term resilience.
- Killer feature = multi-season ecological counterfactuals ("effect of cover
  crop A vs B on soil moisture, pest pressure, and yield over three seasons"),
  realized in the prototype as a live side-by-side scenario A/B split view.
- MVP = plot map + soil indicators + intervention library + seasonal plan +
  observation logging + simple projection model + advisor report, aimed at
  regenerative specialty farms / vineyards — and the prototype already renders
  every one of these surfaces against synthetic data.
- Explicit substrate framing: nested subjects, plan recursion (year → season →
  intervention sequence), flat observations, effect declarations, catalog
  flywheel.
- MVP promise: turn regenerative practices into measurable, comparable,
  compounding intervention plans.

## Domain-model hints

Hints from the written spec (`assets/uploads/06_agricultural_ecosystem_twin.md`)
are now corroborated and sharpened by the working prototype's data model
(`assets/data.js`) and UI (`assets/*.jsx`), which give concrete shapes the
build-path designer (F4) can mine.

- **Subjects (nested):** Field, plot, soil zone, crop, herd, farm, watershed,
  cooperative — explicitly nested `plot → field → farm → watershed`
  (`uploads/06_…md` §Subjects). The prototype's `SubjectsTree`
  (`panels.jsx`) renders exactly this tree: `Navarro Watershed → Tellurian
  Estate → {vine blocks A–F, annual/trial plots G–I, preserve OAK/RIP/HEDGE}`,
  with per-plot crop + hectares (`data.js` `PLOTS`).
- **Plan structure:** Plan recursion `year → season → intervention sequence` —
  a strictly single-parent intervention tree (`uploads/06_…md`
  §Differentiation). The prototype's **plan builder** (`inspector.jsx`
  `PlanBuilder`) makes this literal: a plot's plan is an ordered list of
  `{year, interventionId}` entries dropped onto year slots Y0–Y3.
- **Interventions (plan leaves with typed effect declarations):** the spec
  lists cover crops, rotation, compost, grazing, irrigation, terracing,
  agroforestry, pest management, reduced tillage, biodiversity corridors
  (`uploads/06_…md` §Interventions). The prototype hardens this into a 16-entry
  `INTERVENTIONS` catalog (`data.js`) where **each intervention carries a typed
  effect declaration** — a numeric `effects` vector over the 7 indicators plus
  `cost`, `scope` (`annual | perennial | both`), `family`, and `season`. This
  is the substrate's effect-declaration algebra in concrete form.
- **Observations (event stream):** soil tests, satellite/drone imagery, weather
  data, field notes, yield records, irrigation, biodiversity surveys, pest
  observations, carbon measurements (`uploads/06_…md` §Observations). The
  prototype's `ObservationsLog` (`panels.jsx`) + `OBSERVATIONS` (`data.js`)
  show append-only field-log rows stamped with date, plot, observer
  (`sensor`, `drone-7`, `lab`, advisor), and a kind (`soil/pest/drone/biodiv/
  water/yield`).
- **Indicators (posteriors / twin state):** the spec names 12 indicators; the
  prototype models 7 with explicit units (`data.js` `INDICATORS`): Soil Organic
  Carbon (% SOC), Soil Moisture (% vwc), Microbial Activity (PLFA), Pest
  Pressure (index, inverse), Biodiversity (Shannon), Yield (t/ha), Water
  Retention (mm). Each is rendered with a value **and a ±1.5σ confidence band**
  (`inspector.jsx` `IndicatorBar`, `panels.jsx` `Sparkline`) — uncertainty is
  first-class.
- **Decisions / counterfactuals:** choose-between-interventions over a multi-year
  horizon — the "killer feature" query (`uploads/06_…md` §Killer feature),
  realized as the prototype's **counterfactual split** (`app.jsx` `splitMode`:
  scenario A vs scenario B on the same land, with per-indicator deltas in
  `RollupStrip`).
- **Projection model + uncertainty:** the spec's "simple projection model"
  appears in the prototype as `project()` / `rollup()` (`data.js`) — cumulative
  effects with diminishing returns, soft caps/floors, weather offsets, and a
  per-indicator variance that **compounds with the year horizon** (`sigmaFor`).
  A placeholder, but it pins the inference shape (continuous indicators over
  time → the substrate's Normal-Normal conjugate is the natural first engine).
- **Weather as a scenario dimension:** `typical | dry | wet` offsets
  (`data.js` `WEATHER`) — the named "weather confounding" risk modeled as an
  explicit exogenous input.
- **Causal chains:** the prototype carries `CAUSAL` chains (`data.js`,
  rendered by `inspector.jsx`) — human-readable mechanism explanations behind
  each effect declaration (e.g. cover-vetch → living roots → microbe +12 PLFA).
- **Catalog flywheel:** "learn which practices work under which conditions" — a
  versioned intervention/effect catalog reused across farms (`uploads/06_…md`
  §Differentiation; the prototype's `INTERVENTIONS` catalog is its v0).

## UI-prototype artifacts

The dossier ships a **substantial working UI prototype**, not just a spec. It
is a browser-runnable, React-based interactive twin plus a pitch deck and a
16-shot iteration trail. Overall, the prototype demonstrates the entire MVP
loop — pick a farm subject, choose/build an intervention plan across a year
timeline, and read projected multi-indicator outcomes (with uncertainty bands)
for a scenario or a counterfactual A-vs-B comparison — against a synthetic but
internally coherent 44-hectare Mendocino vineyard estate.

**Live twin app (browser-runnable React app):**

- `assets/Substrate.html` — the app host; loads React 18 + Babel-standalone and
  the 5 React sources + data file below. Open it in a browser to run the twin.
- `assets/app.jsx` — main shell: header, scenario/weather/layer bars, 3-column
  body (subjects tree · farm map · plot inspector), footer (estate rollup +
  timeline scrubber + play-4yr), and `?demo=` URL presets for deck/screenshot
  embedding.
- `assets/map.jsx` — topographic farm canvas: plot polygons, contour lines,
  creek, roads, per-indicator color ramps + overlays, compass + scale bar.
- `assets/inspector.jsx` — right panel: soil cross-section, per-indicator bars
  with ±1.5σ bands vs baseline, the drag-and-drop **plan builder**, applied/
  scheduled interventions, and the causal-chain explainer.
- `assets/panels.jsx` — scenario tabs, weather picker, indicator-layer picker,
  the nested subjects tree, the observations field-log, confidence-banded
  sparklines, the estate rollup, and the year timeline.
- `assets/data.js` — the synthetic dataset + projection engine (Tellurian
  Estate: 12 plots, 7 indicators, 16 effect-declared interventions, 3 weather
  scenarios, 4 named plans + custom, `project()`/`rollup()`, observations,
  causal chains).
- `assets/tweaks-panel.jsx` — reusable "tweaks"/edit-mode shell + form-control
  helpers (prototype tooling/host protocol, not domain content).

**Decks (HTML):**

- `assets/Substrate Pitch.html` — a 14-slide investor pitch deck (cover →
  problem → thesis → causal model → killer feature → the twin → counterfactuals
  → plan builder → why now → beachhead → differentiation → business model →
  roadmap → ask). Names the beachhead (specialty vineyards) and a per-hectare +
  per-credit business model.
- `assets/deck-stage.js` — reusable `<deck-stage>` web component powering the
  deck (slide nav, thumbnail rail, speaker notes, PPTX/PDF export); deck
  infrastructure, not domain content.

**Screenshot series (16, `assets/screenshots/`):** an iteration trail of the
plan-builder / twin UI, showing the design converging on the drag-drop
plan-builder and the counterfactual split — `initial.png` (first map render),
`v2.png`–`v5.png` (map/indicator iterations), `v6-split.png` (counterfactual
A/B split), `v7-custom.png` + `v8-custom-mode.png` (custom-plan mode),
`v8-plan-builder.png` / `v9-plan-builder.png` / `v10-builder.png` /
`v11-builder.png` (plan-builder iterations), `v12-block-I.png` /
`v13-block-I-builder.png` (plan-builder on annual Block I / East Field),
`v14-perennial-builder.png` (plan-builder on a perennial vine block).

## Market signal

Flagged as the founder's untested hypotheses (no validation, pricing, or
willingness-to-pay evidence is provided — the prototype is a demo against
synthetic data, not a market test):

- **Target customers (verbatim):** regenerative farms, vineyards, specialty
  crop farms, agricultural advisors, carbon-credit project developers,
  cooperatives, research institutions, conservation programs.
- **Beachhead (from the pitch deck):** "Specialty vineyards first — then
  everywhere a hectare has a story" (`Substrate Pitch.html`, Beachhead slide).
- **Business model (from the pitch deck):** "Software priced per hectare.
  Catalog priced by the credit." (`Substrate Pitch.html`, Business model slide)
  — still an untested pricing hypothesis.
- **Pain claim:** "Few products model the causal relationship between soil
  health, biodiversity, weather, interventions, and long-term resilience."
- **Founder's own strategic rating:** "Strong conceptual fit and attractive
  long-term market, but slower feedback loops make it less ideal than
  AI/organization verticals for fast product learning."
- **Named risks:** data sparsity, farmer software adoption barriers, long
  feedback loops, weather confounding, fragmented regional practices.

## Asset manifest

| Asset | Type | What it is |
| --- | --- | --- |
| assets/uploads/06_agricultural_ecosystem_twin.md | Markdown spec | The written idea dossier — vision, core thesis, target customers, subjects/indicators/observations/interventions, killer feature, MVP scope/promise, substrate differentiation, risks, strategic rating |
| assets/Substrate.html | HTML app host | Browser entry point for the live twin; loads React 18 + Babel-standalone + data.js + the 5 React sources; full app styling inline |
| assets/app.jsx | React source | Main app shell — header, scenario/weather/layer bars, 3-column body, footer rollup+timeline+play, `?demo=` URL presets |
| assets/map.jsx | React source | Topographic farm canvas — plot polygons, contours, creek, roads, per-indicator color ramps/overlays, compass + scale |
| assets/inspector.jsx | React source | Plot inspector — soil cross-section, ±1.5σ indicator bars vs baseline, drag-drop plan builder, applied/scheduled interventions, causal chain |
| assets/panels.jsx | React source | Scenario tabs, weather/layer pickers, nested subjects tree, observations field-log, confidence-banded sparklines, estate rollup, year timeline |
| assets/data.js | JS data + model | Synthetic Tellurian Estate dataset + projection engine — 12 plots, 7 indicators (with units), 16 effect-declared interventions, 3 weather scenarios, 4 named plans + custom, project()/rollup(), observations, causal chains |
| assets/tweaks-panel.jsx | JS prototype tooling | Reusable tweaks/edit-mode shell + form-control helpers (host edit-mode protocol); not domain content |
| assets/Substrate Pitch.html | HTML deck | 14-slide investor pitch deck (problem → thesis → model → killer feature → twin → counterfactuals → plan builder → why now → beachhead → differentiation → business model → roadmap → ask) |
| assets/deck-stage.js | JS deck infra | Reusable `<deck-stage>` web component — slide nav, thumbnail rail, speaker notes, PPTX/PDF export; deck infrastructure |
| assets/screenshots/initial.png | screenshot | First twin render — estate map with indicator overlay |
| assets/screenshots/v2.png | screenshot | Twin map/indicator iteration v2 |
| assets/screenshots/v3.png | screenshot | Twin map/indicator iteration v3 |
| assets/screenshots/v4.png | screenshot | Twin map/indicator iteration v4 |
| assets/screenshots/v5.png | screenshot | Twin map/indicator iteration v5 |
| assets/screenshots/v6-split.png | screenshot | Counterfactual split view — scenario A vs B side-by-side |
| assets/screenshots/v7-custom.png | screenshot | Custom-scenario mode iteration v7 |
| assets/screenshots/v8-custom-mode.png | screenshot | Custom-plan mode v8 |
| assets/screenshots/v8-plan-builder.png | screenshot | Plan-builder UI iteration v8 |
| assets/screenshots/v9-plan-builder.png | screenshot | Plan-builder UI iteration v9 |
| assets/screenshots/v10-builder.png | screenshot | Plan-builder UI iteration v10 |
| assets/screenshots/v11-builder.png | screenshot | Plan-builder UI iteration v11 |
| assets/screenshots/v12-block-I.png | screenshot | Plan-builder on annual Block I (East Field) v12 |
| assets/screenshots/v13-block-I-builder.png | screenshot | Plan-builder on Block I (East Field) v13 |
| assets/screenshots/v14-perennial-builder.png | screenshot | Plan-builder on a perennial vine block v14 |

## Open questions

What the dossier does NOT answer that stage 2 (opportunity brief) will need:

- **Pricing / willingness-to-pay / unit economics** — the deck asserts a
  per-hectare + per-credit model, but no validation or willingness-to-pay
  evidence exists.
- **Economic buyer** — 8 customer types are listed with no single sharp owner;
  who signs the contract? (The deck narrows the *beachhead* to specialty
  vineyards, but not the buyer role.)
- **Data feasibility** — soil tests and multi-season yield are sparse and slow;
  how does the projection model calibrate before enough observations exist? The
  prototype's `project()` is a hand-tuned placeholder, not a calibrated model.
- **Projection model validity** — the prototype pins a shape (continuous
  indicators over time, compounding variance) but the real inference engine,
  priors under data sparsity, and validation against weather confounding are
  unspecified.
- **Carbon-credit / MRV scope** — carbon-credit developers are a named buyer and
  the deck prices "per credit," but measurement-reporting-verification standards
  are untouched.
- **Counterfactual validation** — long feedback loops mean a 3-season prediction
  can't be checked for years; what is the trust/credibility story at launch
  beyond a synthetic-data demo?
- **Prototype → product gap** — the UI prototype is a client-only React demo on
  synthetic data; what carries over vs. needs rebuilding on the substrate
  (event_log persistence, inference backbone, tenancy) is an F4 question.
</content>
</invoke>
