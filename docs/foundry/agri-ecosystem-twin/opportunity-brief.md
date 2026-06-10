---
product_key: agri-ecosystem-twin
brief_date: 2026-06-10
status: brief
substrate_fit: natural
rubric_total: 34/40
recommended_tier: T0
recommendation: build
---

# Opportunity Brief — Agricultural Ecosystem Twin

## Substrate-fit decomposition

Each of the four kernel concerns is judged `natural | forced | absent` against
the dossier's actual content (`assets/uploads/06_agricultural_ecosystem_twin.md`).

- **Plan tree — `natural`.** The dossier itself states the structure: "Plan
  recursion: year → season → intervention sequence." That is a strictly
  single-parent tree (a season is the child of a year; an intervention sequence
  the child of a season), and the leaves are the 10 named interventions (cover
  crops, compost, grazing schedule, …) each carrying an explicit effect
  declaration ("expected impact of interventions"). No multi-parent or
  cross-link is needed. This is the cleanest possible map onto kernel concern 1.

- **Event log — `natural`.** The dossier lists 10 observation types — soil
  tests, satellite/drone imagery, weather data, field notes, yield records,
  irrigation data, biodiversity surveys, pest observations, carbon measurements
  — which are append-only facts about field state over time. Sources span
  sensor (satellite/drone/probe), manual (field notes/surveys), and external
  feed (weather). The shape is a textbook flat observation log. Caveat: the
  *cadence* is slow and sparse (a data-feasibility problem, scored below), but
  the *shape* is natural.

- **Inference — `natural`.** This is the most substrate-shaped concern: the
  product's "killer feature" IS an inference output — "What is the likely
  effect of adding cover crop mix A versus B on soil moisture, pest pressure,
  and yield over three seasons?" That is a counterfactual over the digital
  twin, with the 12 indicators (soil organic carbon, yield, resilience index, …)
  as the posteriors users would pay for. The value proposition is literally a
  counterfactual. Caveat: slow feedback + weather confounding make calibration
  hard, but the demand is unambiguously inference-shaped.

- **Reproducibility — `natural`.** The dossier names the "Catalog flywheel:
  learn which practices work under which conditions" — a versioned catalog of
  intervention subtrees and effect declarations reused across farms and
  conditions. Multi-season projections feeding advisor reports (and any future
  carbon MRV) demand reproducible run manifests / replay. Versioned catalogs +
  event-sourcing map directly onto kernel concern 4.

**Verdict:** all four concerns `natural`, none `absent` → `substrate_fit:
natural`. The gate rule (any `absent` → at most T0/defer) does not bind, so a
T1+ build would be *permissible*; the tier recommendation below is nonetheless
T0 on data-feasibility and feedback-loop grounds, not substrate-shape grounds.

## Reuse inventory

Concrete cluster assets this idea would compose (it authors no kernel concepts):

- **Kernel event_log** (`@de-braighter/substrate-runtime`, the append-only
  observation log read path that exercir/oncology consume) — directly hosts all
  10 observation types; no new persistence primitive required.
- **Inference backbone** (`@de-braighter/substrate-{contracts,runtime}`, the
  tenant-scoped `/inference` port with `counterfactual()`) — supplies the
  counterfactual *machinery* the cover-crop-A-vs-B query needs: the port shape,
  posterior plumbing, and reproducible run manifests. It does NOT supply an
  agronomy model — the prototype's hand-tuned `project()` is pack-domain science
  that must be rebuilt and calibrated; the backbone provides the inference
  primitive, not the effect priors. Normal-Normal conjugate is already active
  for continuous indicators (soil moisture, yield); the oncology B3 survival
  family (Weibull / log-logistic) is reusable for time-to-event indicators like
  erosion risk or time-to-resilience.
- **Herdbook lineage + registry patterns** (`domains/herdbook`, E1–E5) — the
  nested-subject registry `plot → field → farm → watershed` mirrors herdbook's
  individual/lineage tree and animal-registry CRUD; the dossier's "herd" subject
  is literally herdbook's domain. Herdbook's pack-native registry-on-published-
  kernel build is the scaffold template.
- **Markets external-source ingestion pattern** (`domains/markets`, the
  CoinGecko → event_log adapter) — the reference for pulling external feeds
  (weather data, satellite/NDVI indices, carbon measurements) into the log.
- **conservation domain** (`domains/conservation`) — biodiversity surveys and
  conservation programs overlap its cross-kingdom/biodiversity model; reusable
  prior art for the ecological subjects.
- **design-system bricks** — plot map, soil-indicator dashboards, intervention
  library, and advisor report all assemble from existing bricks (ADR-168);
  the pack consumes UI, never authors it.
- **The dossier's own React prototype** (`assets/Substrate.html` + `*.jsx` +
  `data.js`) — a candidate first surface and clickable spec for the T0 demo: the
  subjects tree, plan builder, counterfactual split, indicator bars, and
  projection shapes are an executable UX reference to port onto design-system
  bricks, not throwaway. It is a demo on synthetic data, so it informs the
  surface, not the model.

## Scorecard

The 8 demonstrated dimensions (`…/01_overview_and_scoring.md`), each re-derived
from this dossier with a one-sentence justification. The scores were derived
from the dossier material (now including the working prototype); they coincide
with the prior scorecard on 7 of 8 dimensions, differing only on **MVP
feasibility (3 → 4)**, which the full material — a runnable end-to-end prototype
of every MVP surface — raises (see that row).

| Dimension | Score | Justification |
| --- | ---:| --- |
| Strategic fit | 5 | The dossier's own "Differentiation via Substrate" section maps one-to-one onto nested subjects, plan recursion, flat observations, effect declarations, and the catalog flywheel — a textbook state-evolution system. |
| Market pain | 4 | Regenerative-ag advisory and resilience planning are real, funded pains, but the dossier itself flags "long feedback loops" and adoption barriers, so the pain is genuine yet not acutely urgent. |
| Buyer clarity | 4 | Agricultural advisors and carbon-credit developers are identifiable paying buyers, but the 8-way customer list (farms, coops, research, conservation) dilutes a single sharp economic owner. |
| Data feasibility | 3 | The observation types exist, yet the dossier names "data sparsity," "long feedback loops," and "weather confounding" as risks, so collecting calibration-grade multi-season data is genuinely hard. |
| MVP feasibility | 4 | A runnable React prototype already renders every MVP surface end-to-end — plot map, indicator layers, drag-drop plan builder, counterfactual A/B split, observations log, projection + uncertainty bands — so the UI/UX and data-model build is largely de-risked (a clickable spec exists); it lifts from 3 to 4. It stays short of 5 because the prototype runs on synthetic data with a hand-tuned placeholder `project()`: the genuinely hard part, a *credible* projection model calibrated on real sparse multi-season data, is not de-risked by the demo. |
| Differentiation | 5 | Multi-season ecological counterfactuals across nested subjects are exactly what generic farm-ops/compliance software cannot do and what the substrate's plan+effect+inference stack uniquely enables. |
| Regulatory ease | 4 | No medical/device regime; the only regulatory surface is voluntary carbon-credit MRV standards, which are a positioning choice rather than a mandatory gate, so burden is light. |
| Platform leverage | 5 | It exercises all four kernel concerns plus nested-subject registries, external-feed ingestion, and the catalog flywheel — proving more of the substrate than a single-surface vertical. |

**Total: 34/40.**

## Risk tier

**Recommended tier: T0 (prototype/demo).**

- **Regulatory burden:** none mandatory — unlike oncology (MDR Class IIb → T2),
  there is no device/medical regime. Carbon MRV is opt-in positioning, so
  nothing forces T1+ gates on regulatory grounds.
- **Blast radius:** a standalone domain repo (`de-braighter/agri-ecosystem-twin`)
  built pack-native on the published kernel (herdbook/markets prove this needs
  zero kernel change), so a demo is safe and auto-mergeable.
- **De-risking argument:** the binding uncertainty is data feasibility (3) and
  projection-model credibility, not substrate shape and not the UI build — the
  existing prototype already de-risks the surfaces (MVP feasibility 4). The
  founder's own strategic rating — "slower feedback loops make it less ideal
  than AI/organization verticals for fast product learning" — argues directly
  against a heavy T1 commitment now. A T0 demo on seeded/historical data
  validates the counterfactual UX before any product investment. T1 graduation
  should be a separate founder gate, conditioned on the T0 demo proving the
  readout is credible (a calibrated model, not the hand-tuned placeholder) and a
  single economic buyer is confirmed.

## Recommendation & wedge

**Recommendation: build — as a T0 prototype**, not a full product. Substrate fit
is natural across all four concerns and the rubric is a respectable 34/40, so the
idea earns a build; the existing UI prototype already proves the surfaces, but
data feasibility and projection-model credibility caution against committing T1
product scope before a demo proves the core loop on substrate-persisted data.

**Wedge (narrowest valuable first slice):** one regenerative vineyard or
specialty farm, one season, **one** counterfactual — cover crop mix A vs B — on
**2–3** indicators (soil moisture, pest pressure, yield), driven by historical /
synthetic seed observations rather than live multi-season collection. This
proves the counterfactual readout + advisor report UX end-to-end while
sidestepping the data-sparsity blocker. It reuses the inference backbone's
`counterfactual()` primitive, a herdbook-style plot/field registry, and a
markets-style weather-feed adapter — minimal new code, maximal substrate proof.
The dossier's React prototype is the concrete candidate first surface: port its
subjects tree / plan builder / counterfactual split onto design-system bricks
and wire them to a real substrate event_log + inference backbone, rather than
designing the UX from scratch.

## What NOT to build (charter candidates)

1. **No live IoT / sensor pipelines** — no real-time soil-probe, drone, or
   satellite ingestion in the wedge; seed historical/synthetic observations.
2. **No carbon-credit MRV / certification tooling** — defer the carbon-credit-
   developer buyer until the core counterfactual is proven credible.
3. **No full 8-subject nesting** — wedge is `plot → field → farm` only; herd,
   watershed, and cooperative aggregation come later.
4. **Not all 12 indicators / 10 interventions** — wedge covers 2–3 indicators
   and 1–2 cover-crop interventions; the rest is scope creep.
5. **No bespoke agronomy simulator** — reuse the substrate's conjugate /
   survival inference; do not build domain-specific ecological simulation
   science for the demo.
