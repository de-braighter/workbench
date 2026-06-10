---
product_key: agri-ecosystem-twin
charter_date: 2026-06-10
risk_tier: T0
greenlight_gate: 0f123534-989e-4ed9-bec5-a9edb7176c76
status: chartered
brief: docs/foundry/agri-ecosystem-twin/opportunity-brief.md
---

# Charter — Agricultural Ecosystem Twin

## Name & key

- **Name:** Agricultural Ecosystem Twin
- **product_key:** `agri-ecosystem-twin`
- **Repo:** `de-braighter/agri-ecosystem-twin`
- **Pitch:** A digital twin for regenerative farms that answers "what is the
  likely effect of intervention A versus B on my land over the next seasons?" —
  multi-season ecological counterfactuals over nested farm subjects, built
  pack-native on the substrate.

## Risk tier

**T0 (prototype/demo).** Chosen because:

- **No mandatory regulatory regime** — unlike oncology (MDR Class IIb → T2),
  there is no device/medical/clinical gate. Carbon-credit MRV is opt-in
  positioning, deliberately out of scope (below), so nothing forces T1+ gates.
- **Binding uncertainty is data feasibility + projection-model credibility, not
  substrate shape** — substrate fit is `natural` on all four concerns, so the
  risk to retire first is "is the counterfactual readout credible on real sparse
  data?", which a demo answers cheaply. The UI surfaces are already de-risked by
  the dossier's runnable React prototype (MVP feasibility 4/5).
- **Founder signal** — the brief records the founder's own caution that slower
  agricultural feedback loops make this less ideal than the AI/org verticals for
  fast product learning; a T0 demo validates the core loop before any T1
  commitment.

T1 graduation is a **separate future founder gate** (see Gate schedule),
conditioned on the T0 demo proving a calibrated readout (not the prototype's
hand-tuned placeholder) and a single confirmed economic buyer.

The tier policy this charter binds to (spec §3):

| Tier | Examples | Gates | Quality parameters |
| --- | --- | --- | --- |
| **T0** prototype/demo | markets, gridiron | greenlight + ship | wave standard, auto-merge OK |
| **T1** product | herdbook, exercir | + architecture approval | wave + `deep` effort on kernel-touching items, mutation thresholds enforced |
| **T2** regulated | oncology (MDR Class IIb) | + every kernel-touching ADR + designer-first mandatory | full battery, RLS/tenancy proofs required, no auto-merge |

## Scope (the wedge)

**One farm, one season, one counterfactual, on seeded data.**

- One regenerative vineyard or specialty farm, one growing season.
- **One** counterfactual: cover crop mix A vs B.
- **2–3** indicators only: soil moisture, pest pressure, yield.
- Subjects nested `plot → field → farm` (herdbook-style registry).
- A plan tree: `season → intervention sequence`, leaves = the cover-crop
  interventions carrying effect declarations.
- Observations are **historical / synthetic seed data** in the substrate
  event_log — no live collection.
- The end-to-end loop the demo must show: build a plan → run the A-vs-B
  counterfactual via the inference backbone → read indicator posteriors with
  uncertainty → produce an advisor-report view.
- UX is **ported from the dossier's React prototype** onto design-system bricks
  (the prototype is the clickable spec, not throwaway), wired to a real
  event_log + inference backbone.

## What NOT to build

1. **No live IoT / sensor pipelines** — no real-time soil-probe, drone, or
   satellite ingestion; seed historical/synthetic observations only.
2. **No carbon-credit MRV / certification tooling** — defer the carbon-credit
   buyer until the core counterfactual is proven credible.
3. **No full 8-subject nesting** — `plot → field → farm` only; herd, watershed,
   cooperative aggregation come later.
4. **Not all 12 indicators / 10 interventions** — 2–3 indicators, 1–2
   cover-crop interventions; the rest is scope creep.
5. **No bespoke agronomy simulator** — reuse the substrate's conjugate /
   survival inference; do not build domain-specific ecological simulation
   science for the demo.
6. **No kernel changes** — pack-native on the published kernel (herdbook/markets
   prove this is possible); any apparent need for a kernel concept is a design
   smell to escalate, not to build.

## Quality plan

T0 floor (these become `qualityObligations` on the F4 work items, consumed
verbatim by the F4 build-path designer):

- `wave-standard` — the standard verifier wave (reviewer + qa-engineer +
  charter-checker; local-ci where the repo has a build) on every non-trivial PR.
- `coverage-delta` — coverage must not regress; local Sonar where wired.
- `a11y-battery` — on every UI surface (canonical patterns from the
  player-surfaces arc), since the wedge is UI-heavy (ported prototype).
- `seed-data-only` — a build-time assertion / review check that no live external
  feed is wired (enforces What-NOT-to-build #1).
- `no-kernel-change` — charter-checker confirms each PR authors no kernel
  concept (enforces What-NOT-to-build #6).

No mutation-threshold or RLS/tenancy-proof obligations at T0 (those are T1/T2
floor items); revisit at the T1 graduation gate.

## Gate schedule

Per the T0 row (greenlight + ship):

- **Gate 1 — greenlight** ✅ approved 2026-06-10 (`0f123534-989e-4ed9-bec5-a9edb7176c76`).
- **Ship gate** — before any outward-facing action (public demo, announce,
  deploy beyond local). T0 auto-merges PRs on a green wave; the ship gate is the
  founder touchpoint for exposure, not per-PR.
- **T1 graduation (future, conditional)** — a new `architecture` founder gate if
  and when the demo argues for product scope; entry condition: a calibrated
  projection model (not the placeholder) + one confirmed economic buyer.

## Repo plan

- **Repo:** `de-braighter/agri-ecosystem-twin` — a new standalone domain in the
  cluster, scaffolded via `/new-domain`.
- **`/new-domain` tiers needed:** spine (reusable domain lib) + pack (the
  agri-twin pack) + api (NestJS) + db-persistence (event_log-backed) +
  inference-backbone (the `counterfactual()` consumer) + Angular UI (the ported
  prototype surfaces). All six tiers — this is a full vertical demo, not a
  library-only slice.
- **Packages consumed:** `@de-braighter/substrate-{contracts,runtime}` (kernel
  event_log + inference port), `@de-braighter/design-system-*` bricks,
  `@de-braighter/{std,test-kit,lint-kit}`. Patterns referenced (not imported):
  herdbook nested-subject registry, markets external-feed adapter shape (for the
  seed-loader), conservation biodiversity prior art.
