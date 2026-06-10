---
product_key: agri-ecosystem-twin
build_path_date: 2026-06-10
status: build-path
charter: docs/foundry/agri-ecosystem-twin/charter.md
risk_tier: T0
item_count: 10
---

# Build Path — Agricultural Ecosystem Twin

The machine-executable path from the approved **T0 charter**
(`docs/foundry/agri-ecosystem-twin/charter.md`) to a running demo of the charter
wedge: **one farm, one season, ONE counterfactual (cover-crop mix A vs B), 2–3
indicators**, on seeded data, with the React prototype ported onto design-system
bricks. The ladder ends when the charter loop runs end-to-end — *build a plan →
run the A-vs-B counterfactual via the inference backbone → read indicator
posteriors with uncertainty → advisor-report view* — and not one rung further
(the dossier's full vision is explicitly out, see What-NOT-to-build below).

The load-bearing output of this stage is **scope disjointness**: the 10 items
are decomposed so unordered worker sessions touch provably non-overlapping
files. The proof table at the end runs the foundry `scopesDisjoint` algorithm by
hand on every unordered pair.

## Scaffold plan

`de-braighter/agri-ecosystem-twin` **does not exist yet** → the path opens with a
greenfield `/new-domain` scaffold (the markets reference run, codified).

- **Target repo:** `de-braighter/agri-ecosystem-twin` — a new standalone domain
  repo in the cluster (sibling under `domains/`, gitignored at the root).
- **`/new-domain` tiers — all six** (per the charter Repo plan, "a full vertical
  demo, not a library-only slice"):
  1. **foundation/spine** — `libs/agri-ecosystem-twin-spine`
     (`@de-braighter/agri-ecosystem-twin-spine`): reusable, substrate-free domain
     types.
  2. **foundation/pack** — `libs/agri-ecosystem-twin-pack`
     (`@de-braighter/agri-ecosystem-twin-pack`): the agri-twin pack (effect
     declarations, plan-tree + catalog builders).
  3. **foundation/api** — `apps/agri-ecosystem-twin-api` (NestJS, `GET /health`).
  4. **db-persistence** — `kernel.event_log` + `Outbox` vendored models, dockerized
     Postgres, `tools/db/{setup,seed}.mjs`, RLS GUC wiring.
  5. **inference-backbone** — the 5-provider `INFERENCE_BACKBONE` chain +
     `GET /readout` (the `counterfactual()` consumer seam).
  6. **Angular UI** — `apps/agri-ecosystem-twin-ui` (standalone, dev-proxied to the
     api).
- **Suggested port pair (next free):** **api `3500` / Postgres `5475`.** Cluster
  scan of `repos.yaml` + `domains/*/docker-compose.yml` + each `apps/*/src/main.ts`:
  conservation `3000/5432`, exercir `3100/5545`, herdbook `3200/5433`, markets
  `3300/5455`, gridiron `3400/5465`, health (lib-only, db `5546`). `3500` continues
  the api `+100` cadence; `5475` continues the markets/gridiron `54xx +10` cadence;
  both verified unused. UI dev-server: `4250` (Angular serve port; outside the
  reserved api/pg ranges).
- **Packages consumed:** `@de-braighter/substrate-{contracts,runtime}` (kernel
  event_log + inference port), `@de-braighter/design-system-*` bricks,
  `@de-braighter/{std,test-kit,lint-kit}`. Patterns referenced (not imported):
  herdbook nested-subject registry, markets seed-loader, conservation biodiversity
  prior art.
- **As a work item:** the scaffold is **E1**, scope = **whole repo** (no
  `pathPrefix`, no `issue` → claims the repo). Every other item transitively
  `dependsOn` E1; nothing else is claimable until E1 is released `done`.

## Epic ladder

Five epics. Each is a user-facing capability with a one-line deliverable + an
acceptance statement, decomposed to the one-session/one-PR grain. The ladder ends
when the charter loop demonstrably runs (E5) — not when the dossier's full vision
ships.

### E1 — Domain scaffold

- **Deliverable:** a building, testing, registered `de-braighter/agri-ecosystem-twin`
  repo with all six `/new-domain` tiers, green `ci:local`, `GET /health` +
  `GET /readout` stub on `:3500`, dockerized Postgres on `:5475`, workbench
  registration (`repos.yaml` + `projects/agri-ecosystem-twin/project.yaml`).
- **Acceptance:** `pnpm run ci:local` green; `node dist/main.js` answers
  `GET /health` `{"status":"ok","pack":"agri-ecosystem-twin"}`; the empty Angular
  app builds and dev-proxies to the api.
- **Items:** E1.

### E2 — Domain model + seeded twin

- **Deliverable:** the wedge's substrate state — the 3 indicators, the
  `plot → field → farm` subject registry, the `season → intervention sequence`
  plan tree with effect-declared cover-crop leaves, and synthetic historical
  observations seeded into `kernel.event_log`.
- **Acceptance:** a seed run persists one farm → its fields → its plots, a season
  plan tree per plot with cover-crop mix A (`cover-vetch`: Vetch+Rye) and mix B
  (`cover-phacelia`: Phacelia+Clover) leaves carrying typed effect declarations,
  and a season of soil-moisture / pest-pressure / yield observation events keyed
  by subject; all reproducible (versioned catalog + run manifest).
- **Reuse:** the **herdbook nested-subject registry** (E1–E5, lineage tree +
  CRUD-on-published-kernel) is the registry template; the **markets seed-loader**
  (`CoinGecko → event_log` adapter) is the observation-seed shape (synthetic
  source, not a live feed — `seed-data-only`).
- **Items:** E2.1 (domain-model libs), E2.2 (registry + plan-tree persistence),
  E2.3 (synthetic observation seed-loader).

### E3 — Counterfactual readout API

- **Deliverable:** the A-vs-B counterfactual endpoint — Normal-Normal conjugate
  over the seeded event_log, `counterfactual()` with a cover-crop-A arm and a
  cover-crop-B arm, returning per-indicator posteriors with uncertainty.
- **Acceptance:** `GET /counterfactual` (cover-crop mix A vs B, the 3 indicators)
  returns posterior mean + credible interval per indicator per arm, plus the
  A→B delta; reproducible from the seed (seed-pinned, run manifest emitted).
- **Reuse:** the **exercir what-if lane** (multi-arm `counterfactual()` endpoint +
  overlay UI, exercir#119/#120) is the prior-art shape for the multi-arm endpoint
  and the posterior-readout contract.
- **Items:** E3.1.

### E4 — Ported twin UI

- **Deliverable:** the prototype surfaces that serve the wedge loop, ported onto
  design-system bricks — a UI shell that owns routing/layout/config, then the
  subjects tree, the plan builder, and the counterfactual A/B + posterior readout.
- **Acceptance:** from the running app a user picks a plot in the subjects tree,
  builds a season intervention plan (mix A vs mix B) in the plan builder, and reads
  the live A-vs-B counterfactual with per-indicator posterior bands — all wired to
  the real api (E2/E3), no synthetic client-side `project()`.
- **Items:** E4.1 (UI shell — sequencing), E4.2 (subjects tree), E4.3 (plan
  builder), E4.4 (counterfactual + posterior readout).

### E5 — Advisor report (loop closure)

- **Deliverable:** the advisor-report view that assembles the full loop output —
  plan summary, A-vs-B counterfactual deltas, indicator posteriors with
  uncertainty, and effect-declaration provenance — into one readable report.
- **Acceptance:** the charter loop runs end-to-end and the advisor report renders
  the recommendation (which cover-crop mix, on which indicators, with what
  confidence) for one farm / one season from substrate-persisted data.
- **Items:** E5.1.

## UI-surface plan

Every surface in the dossier's React prototype (`app.jsx`, `panels.jsx`,
`inspector.jsx`, `map.jsx`, `data.js`) judged against the wedge loop. `in`
surfaces map onto a design-system-brick page directory under
`apps/agri-ecosystem-twin-ui/src/app/<page>/`; the **UI shell (E4.1)** is the
sequencing item that owns routing, `app.config`, shared layout, and
`provideHttpClient()` + an API base-URL token — each surface owns its own
feature-scoped data service inside its page directory (no shared `api.service.ts`),
so the surface items stay path-disjoint.

| Surface | Prototype source | Verdict | Justification | Item |
| --- | --- | --- | --- | --- |
| Subjects tree (`plot → field → farm` nav) | `panels.jsx` `SubjectsTree` | **in** | Loop entry — the user picks the subject the plan + counterfactual run on. | E4.2 |
| Plan builder (season → intervention sequence) | `inspector.jsx` `PlanBuilder` | **in** | Loop step 1 "build a plan"; the drag-drop year slots port to a reactive-forms/brick sequence editor (mix A vs mix B). | E4.3 |
| Counterfactual A/B split + indicator posterior bars | `app.jsx` `splitMode`, `panels.jsx` `RollupStrip`, `inspector.jsx` `IndicatorBar` | **in** | Loop steps 2+3 "run the counterfactual" + "read posteriors with uncertainty" — the ±1.5σ bars become real posterior credible intervals. | E4.4 |
| Advisor report view | MVP scope "advisor report" (assembled; no single prototype component) | **in** | Loop close "produce an advisor-report view" — the deliverable the charter names. | E5.1 |
| Topographic farm map canvas | `map.jsx` `FarmMap` (polygons, contours, creek, color ramps, compass) | **deferred** | Bespoke hand-tuned SVG for one synthetic estate; display-only, no loop step depends on it, and the subjects tree already provides selection. High-effort eye-candy = scope creep for a T0 demo. | — |
| Observations field-log | `panels.jsx` `ObservationsLog` | **deferred** | Observations are seeded into `event_log` (E2.3) and consumed by inference; the wedge reads *posteriors*, not the raw log. A log viewer is supporting context, not a loop step. | — |
| Weather picker (typical/dry/wet) | `panels.jsx` `WeatherPicker`, `data.js` `WEATHER` | **deferred** | Charter wedge is "one season"; weather scenarios are the dossier's full-vision exogenous dimension — the plan explicitly excludes them. | — |
| Indicator layer picker | `panels.jsx` `LayerPicker` | **deferred** | Drives the deferred map overlay; the wedge shows 3 indicators as posterior bars, not a toggled map layer. | — |
| Year timeline / scrubber | `panels.jsx` `Timeline` | **deferred** | Multi-year (Y0–Y4) horizon; the charter wedge is a single season — the multi-season projection is post-wedge. | — |
| Soil cross-section | `inspector.jsx` `SoilCrossSection` | **deferred** | Decorative soil-profile SVG; not a loop step. | — |
| Causal-chain explainer | `inspector.jsx` `CAUSAL` | **deferred** | Effect-declaration provenance is enrichment; E5.1's advisor report may surface effect declarations inline, but a standalone explainer is not loop-critical. | — |

In-scope: **4 surfaces** (subjects tree, plan builder, counterfactual + posterior
readout, advisor report) + the shell. The full topographic map (`map.jsx`) is
**deferred** as expected — it serves no wedge-loop step and is the single highest
build cost in the prototype.

## ADR needs & gates

- **ADRs required: none.** T0 / pack-native on the published kernel
  (`@de-braighter/substrate-{contracts,runtime}`), zero kernel change — the
  charter's What-NOT-to-build #6. herdbook + markets prove the
  registry/seed/inference/UI stack is buildable with no kernel concept authored.
- **Per the skill (step 5):** any item that *appears* to need a kernel concept is a
  charter design smell to **escalate to the founder**, not to build — surface it
  via `foundry_handoff`, do not widen the wedge.
- **Gate 2 (architecture approval):** **not applicable at T0** (T0 = greenlight +
  ship only). No `designer-first` items. The T1-graduation gate (a calibrated
  projection model + a confirmed economic buyer) is a separate future founder gate,
  out of this build path.

## Quality battery config

Obligations are copied **verbatim from the charter quality plan** (T0 floor) onto
the items they apply to. T0 carries **no** mutation-threshold and **no**
RLS/tenancy-proof obligations (those are T1/T2 floor items — adding them here would
contradict the charter).

| Obligation | Source | Applies to | Gate shape |
| --- | --- | --- | --- |
| `wave-standard` | charter | **all 10 items** | reviewer + qa-engineer + charter-checker (+ local-ci where the repo builds) on every non-trivial PR |
| `coverage-delta` | charter | **all 10 items** | coverage must not regress; local Sonar where wired |
| `seed-data-only` | charter (enforces What-NOT-to-build #1) | **all 10 items** | build-time/review assertion that no live external feed is wired — observations are synthetic/historical seed only |
| `no-kernel-change` | charter (enforces What-NOT-to-build #6) | **all 10 items** | charter-checker confirms each PR authors no kernel concept |
| `a11y-battery` | charter ("on every UI surface") | **UI-scoped items: E4.1, E4.2, E4.3, E4.4, E5.1** | canonical a11y patterns from the player-surfaces arc (24px targets, focus-mgmt-on-swap, enabled-submit, live regions) |

`a11y-battery` lands on the five `apps/agri-ecosystem-twin-ui/` items only. It is
**not** on E1 (the scaffold ships no bespoke UI surface — the default Angular page
is replaced by E4.1) nor on the api/lib items (E2.1, E2.2, E2.3, E3.1).

## Lanes & parallelism

`lane` is informational labelling — the real parallelism contract is `dependsOn`
+ disjoint scopes. Three lanes:

- **scaffold** — E1 (whole repo; blocks everything until released `done`).
- **domain-core** — E2.1 → E2.2 → E2.3 → E3.1. A deliberately **serial chain**:
  the three api items (E2.2, E2.3, E3.1) share `apps/agri-ecosystem-twin-api/`
  (the kernel runner wiring + `app.module.ts` provider registration), so they are
  ordered rather than path-split — the skill's "shared files → sequencing" handled
  via the dependency chain. They never hold claims simultaneously.
- **ui** — E4.1 (shell) → { E4.2, E4.3, E4.4 } (parallel surfaces) → E5.1 (report).

Parallel frontier (genuine 2–3-wide concurrency):

1. After **E1** `done`: **E2.1** (`libs/`) ∥ **E4.1** (`apps/…-ui/`) — disjoint apps.
2. After **E2.1** + **E2.2** `done` (E4.1 done): **E2.3** (api) ∥ **E4.2** (subjects) ∥ **E4.3** (plan-builder) — api vs two non-nested page dirs.
3. After **E3.1** + **E4.1** `done`: **E4.4** (counterfactual) ∥ **E5.1** (advisor-report) — two non-nested page dirs, plus any still-running E4.2/E4.3.

**Post-E1 containment rule (binding on every non-E1 item):** E1 installs the
full consumed-package set, so non-E1 items must NOT add root-level dependencies
(root `package.json`/`pnpm-lock.yaml` sit outside every non-E1 pathPrefix) and
must NOT extend the root `tools/db/*` scripts — E2.3's seed-loader lives in-app
under `apps/agri-ecosystem-twin-api/src/` (the markets ingestion-adapter shape),
not in root tools. An item that genuinely needs either is a disjointness
violation in the making: hand back via `foundry_handoff` and fix the lane map
here.

## Work items

`scope` is `repo` (= `de-braighter/agri-ecosystem-twin` for every item) plus a
`pathPrefix` (or none, for the whole-repo scaffold). `issue` is left empty — story
issues are created by the worker sessions per the story-tracker workflow once the
repo exists (the repo does not exist yet, so there is no issue to reference).

| itemId | title | scope (pathPrefix) | dependsOn | lane | qualityObligations |
| --- | --- | --- | --- | --- | --- |
| `agri-ecosystem-twin/E1` | `/new-domain` scaffold: stand up `de-braighter/agri-ecosystem-twin` with all six tiers (spine + pack + NestJS api + db-persistence + inference-backbone + Angular UI), api `:3500` / pg `:5475`, green `ci:local`, `GET /health`, workbench registration | _whole repo (no pathPrefix)_ | — | scaffold | wave-standard, coverage-delta, seed-data-only, no-kernel-change |
| `agri-ecosystem-twin/E2.1` | Domain-model libs: define the 3 wedge indicators (soil moisture, pest pressure [inverse], yield), the `plot/field/farm` subject types, the cover-crop A/B intervention catalog with typed effect declarations, and the `season → intervention-sequence` plan-tree builder types | `libs/` | `agri-ecosystem-twin/E1` | domain-core | wave-standard, coverage-delta, seed-data-only, no-kernel-change |
| `agri-ecosystem-twin/E2.2` | Persist the nested-subject registry (`plot → field → farm`, herdbook-style) and the season plan tree (`season → intervention sequence`, effect-declared cover-crop leaves) to the kernel via the api | `apps/agri-ecosystem-twin-api/` | `agri-ecosystem-twin/E2.1` | domain-core | wave-standard, coverage-delta, seed-data-only, no-kernel-change |
| `agri-ecosystem-twin/E2.3` | Synthetic observation seed-loader: seed one season of historical/synthetic soil-moisture, pest-pressure, and yield observation events into `kernel.event_log` keyed by subject (markets seed-loader shape; no live feed) | `apps/agri-ecosystem-twin-api/` | `agri-ecosystem-twin/E2.2` | domain-core | wave-standard, coverage-delta, seed-data-only, no-kernel-change |
| `agri-ecosystem-twin/E3.1` | Counterfactual readout endpoint: wire the Normal-Normal inference catalog + `counterfactual()` over the seeded event_log; `GET /counterfactual` returns per-indicator posteriors with uncertainty for cover-crop mix A vs B (exercir what-if lane shape), seed-pinned + run-manifest reproducible | `apps/agri-ecosystem-twin-api/` | `agri-ecosystem-twin/E2.3` | domain-core | wave-standard, coverage-delta, seed-data-only, no-kernel-change |
| `agri-ecosystem-twin/E4.1` | UI shell (sequencing): routing with pre-declared lazy routes for subjects / plan-builder / counterfactual / advisor-report, `app.config` (`provideHttpClient` + dev proxy + tenant headers), shared layout (header + indicator legend), design-system theme, API base-URL token — surfaces own their own feature data services | `apps/agri-ecosystem-twin-ui/` | `agri-ecosystem-twin/E1` | ui | wave-standard, coverage-delta, seed-data-only, no-kernel-change, a11y-battery |
| `agri-ecosystem-twin/E4.2` | Subjects-tree surface: `plot → field → farm` navigator on design-system bricks, selecting the subject the plan + counterfactual run on; reads the registry api via its own page-scoped data service | `apps/agri-ecosystem-twin-ui/src/app/subjects/` | `agri-ecosystem-twin/E4.1`, `agri-ecosystem-twin/E2.2` | ui | wave-standard, coverage-delta, seed-data-only, no-kernel-change, a11y-battery |
| `agri-ecosystem-twin/E4.3` | Plan-builder surface: build a season intervention sequence (cover-crop mix A vs mix B) on reactive-forms/brick controls ported from the prototype drag-drop year slots; writes the plan via its own page-scoped data service | `apps/agri-ecosystem-twin-ui/src/app/plan-builder/` | `agri-ecosystem-twin/E4.1`, `agri-ecosystem-twin/E2.2` | ui | wave-standard, coverage-delta, seed-data-only, no-kernel-change, a11y-battery |
| `agri-ecosystem-twin/E4.4` | Counterfactual + posterior-readout surface: A-vs-B split view with per-indicator posterior bars (mean + credible interval) reading `GET /counterfactual`; the prototype ±1.5σ bands become real posteriors | `apps/agri-ecosystem-twin-ui/src/app/counterfactual/` | `agri-ecosystem-twin/E4.1`, `agri-ecosystem-twin/E3.1` | ui | wave-standard, coverage-delta, seed-data-only, no-kernel-change, a11y-battery |
| `agri-ecosystem-twin/E5.1` | Advisor-report surface (loop closure): assemble plan summary + A-vs-B counterfactual deltas + indicator posteriors with uncertainty + effect-declaration provenance into one report view; verify the charter loop runs end-to-end | `apps/agri-ecosystem-twin-ui/src/app/advisor-report/` | `agri-ecosystem-twin/E4.1`, `agri-ecosystem-twin/E3.1` | ui | wave-standard, coverage-delta, seed-data-only, no-kernel-change, a11y-battery |

**Dangling-dependency check:** every `dependsOn` id (`E1`, `E2.1`, `E2.2`, `E2.3`,
`E3.1`, `E4.1`) appears in the item list above. No dangling references.

## Disjointness proof

Two scopes are disjoint per the foundry `scopesDisjoint` algorithm: (1) different
`repo` → disjoint; (2) same repo, both `pathPrefix` → disjoint iff neither
normalized prefix (trailing `/`) is a prefix of the other; (3) same repo, ≥1
without `pathPrefix` → disjoint iff both have distinct `issue` (else overlap);
(4) else overlap. Every item here is the **same repo**
(`de-braighter/agri-ecosystem-twin`) with no `issue`, so disjointness rests
entirely on **rule 2** (non-nested `pathPrefix`).

**Ordered pairs need no proof** (they can never hold claims simultaneously).
E1 is a transitive ancestor of all 9 other items → every E1 pair is ordered.
Within the api chain E2.1 → E2.2 → E2.3 → E3.1 and the ui chain
E4.1 → {E4.2,E4.3,E4.4,E5.1} the dependency edges make most cross-pairs ordered.
The table below enumerates **every UNORDERED pair** (14 of the 45 total) and runs
rule 2 on each.

| # | Unordered pair | pathPrefix A | pathPrefix B | Evidence (rule 2) | Verdict |
| ---:| --- | --- | --- | --- | --- |
| 1 | E2.1 ↔ E4.1 | `libs/` | `apps/agri-ecosystem-twin-ui/` | non-nested: neither is a prefix of the other | disjoint |
| 2 | E2.2 ↔ E4.1 | `apps/agri-ecosystem-twin-api/` | `apps/agri-ecosystem-twin-ui/` | non-nested: `…-api/` vs `…-ui/` diverge at the app segment | disjoint |
| 3 | E2.3 ↔ E4.1 | `apps/agri-ecosystem-twin-api/` | `apps/agri-ecosystem-twin-ui/` | non-nested (different app) | disjoint |
| 4 | E2.3 ↔ E4.2 | `apps/agri-ecosystem-twin-api/` | `apps/agri-ecosystem-twin-ui/src/app/subjects/` | non-nested (different app) | disjoint |
| 5 | E2.3 ↔ E4.3 | `apps/agri-ecosystem-twin-api/` | `apps/agri-ecosystem-twin-ui/src/app/plan-builder/` | non-nested (different app) | disjoint |
| 6 | E3.1 ↔ E4.1 | `apps/agri-ecosystem-twin-api/` | `apps/agri-ecosystem-twin-ui/` | non-nested (different app) | disjoint |
| 7 | E3.1 ↔ E4.2 | `apps/agri-ecosystem-twin-api/` | `apps/agri-ecosystem-twin-ui/src/app/subjects/` | non-nested (different app) | disjoint |
| 8 | E3.1 ↔ E4.3 | `apps/agri-ecosystem-twin-api/` | `apps/agri-ecosystem-twin-ui/src/app/plan-builder/` | non-nested (different app) | disjoint |
| 9 | E4.2 ↔ E4.3 | `…-ui/src/app/subjects/` | `…-ui/src/app/plan-builder/` | non-nested: diverge at the page segment | disjoint |
| 10 | E4.2 ↔ E4.4 | `…-ui/src/app/subjects/` | `…-ui/src/app/counterfactual/` | non-nested (page segment) | disjoint |
| 11 | E4.2 ↔ E5.1 | `…-ui/src/app/subjects/` | `…-ui/src/app/advisor-report/` | non-nested (page segment) | disjoint |
| 12 | E4.3 ↔ E4.4 | `…-ui/src/app/plan-builder/` | `…-ui/src/app/counterfactual/` | non-nested (page segment) | disjoint |
| 13 | E4.3 ↔ E5.1 | `…-ui/src/app/plan-builder/` | `…-ui/src/app/advisor-report/` | non-nested (page segment) | disjoint |
| 14 | E4.4 ↔ E5.1 | `…-ui/src/app/counterfactual/` | `…-ui/src/app/advisor-report/` | non-nested (page segment) | disjoint |

All 14 unordered pairs are **disjoint**. Two design choices make this hold:

1. **The api lane is a serial chain, not a path split.** E2.2, E2.3, E3.1 all
   carry `apps/agri-ecosystem-twin-api/` because they share `app.module.ts` +
   the kernel runner wiring. They are ordered (E2.2 → E2.3 → E3.1), so they never
   appear as an unordered pair — the shared api files are safe by sequencing.
2. **Each UI surface owns its page directory only.** The shell (E4.1) pre-declares
   the lazy routes and provides `HttpClient`; each surface owns its components
   *and* its feature-scoped data service inside `src/app/<page>/`, so no two
   surfaces ever edit a shared `app.routes.ts` / `app.config.ts` / `api.service.ts`.
   A surface's `pathPrefix` therefore contains every file it writes.

## Nothing from What-NOT-to-build appears as an item

Cross-check against the charter exclusions: no live IoT/sensor ingestion (E2.3 is
synthetic seed only, `seed-data-only`); no carbon-credit MRV; no full 8-subject
nesting (`plot → field → farm` only); not all 12 indicators / 10 interventions
(3 indicators, cover-crop mix A vs B only); no bespoke agronomy simulator (reuse
the substrate Normal-Normal conjugate); no kernel change (`no-kernel-change`, zero
ADRs). The deferred prototype surfaces (map, weather, timeline, field-log, layer
picker, soil cross-section, causal explainer) are recorded as `deferred`, not
queued.
