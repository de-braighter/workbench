# `gridiron` — NFL 4th-down what-if on the substrate (design)

- **Date:** 2026-06-09
- **Status:** design (brainstormed; pending implementation plan)
- **Domain:** `de-braighter/domains/gridiron` — **new domain** (NFL analytics), scaffolded via `/new-domain` (markets reference run)
- **Tracker:** _created on plan hand-off (`de-braighter/gridiron` story issue)._
- **Governing ADRs:** [ADR-176](https://github.com/de-braighter/specs/blob/main/adr/adr-176-substrate-kernel-minimality-inclusion-test.md) (kernel minimality — this is **pure domain composition; zero kernel change**), [ADR-127](https://github.com/de-braighter/specs/blob/main/adr/adr-127-kernel-substrate-v1.md) (kernel substrate v1), [ADR-027](https://github.com/de-braighter/specs/blob/main/adr/adr-027-pack-on-platform.md) (consume published `@de-braighter/*`, never relative paths), ADR-203/204 (inference wired to `event_log`; Normal-Normal active — verify exact refs at plan time), ADR-012 (i18n de/en JSON; de=source).
- **Reference run:** `domains/markets` (external source → `event_log` → Normal-Normal → readout/UI) and the existing exercir what-if (`compare-drill-what-if.service.ts` + `player-what-if-chrome.component.ts`).

## 1. Summary

`gridiron` is a new substrate domain that ingests **open NFL play-by-play** ([nflverse](https://github.com/nflverse) / `nfl-data-py`) into the kernel `event_log`, then uses the Normal-Normal inference backbone to answer a **multi-aspect 4th-down counterfactual**:

> Given the *combination* of distance-to-go, field position, score differential, and time remaining, what is the expected value of **going for it** vs. **punting** vs. **kicking a field goal**?

The kernel produces a posterior per arm; the domain ranks them and exposes the comparison as a what-if surface — **validated against the public 4th-down / win-probability oracle** (the well-known "4th-down bot" recommendations).

This is the first showcase where the data is rich enough to **combine aspects** rather than swap a single lever — every play carries ~a dozen covariates, and the 4th-down call is inherently conditional on their *combination*. Slice 1 is league-wide and runs entirely on today's kernel; the architecture is deliberately the **seed of a real NFL-analytics product**, and it encodes its own growth trigger toward data-learned interactions.

## 2. Decisions locked (from the 2026-06-09 brainstorm)

| Decision | Choice |
|---|---|
| Purpose | **Foundation for a real sports product** (not a one-off demo) |
| Sport / data | **NFL**, new `gridiron` domain, **nflverse** play-by-play; clean separation from exercir's soccer pack |
| Decision modeled | **4th-down: go / punt / kick** (iconic; strongest public oracle; inherently multi-aspect) |
| "Combine aspects" scope | **Staged** — multi-aspect **conditioning** (#1) + light **multi-lever** intervention (#2) on Normal-Normal **now**; data-learned **interactions** (#3) **later** |
| Validation | **Approach A now** (ingest EPA → consistency-check vs the bot), **B-ready ingestion** (carry raw outcome + confounders so Approach B is a config flip) |
| Subject of inference | **Situation archetype** as an `individual` (league-wide pooled), not per-team (Approach C deferred) |
| Inference model | **Normal-Normal** conjugate only; **no inference-backbone change in slice 1** |
| Tiers | All four: source-spine + pack + NestJS api + Angular web + DB persistence |

## 3. Scope

**In:**

- `libs/gridiron-source-spine` — **batch ETL** adapter: nflverse season parquet → `gridiron:Play.v1` events (one event per 4th-down play), written via the kernel outbox under `GRIDIRON_TENANT_PACK_ID`.
- `libs/gridiron-pack` — archetype bucketing (config-driven discretization), the inference catalog (projection + plan-tree/arm definitions), and the what-if/readout application service.
- `apps/gridiron-api` — NestJS (`node dist/main.js`), the explicit 5-provider inference chain (INFERENCE_CATALOG → EVIDENCE_REPOSITORY → NUMPYRO_SIDECAR → MEMBER_RESOLUTION_PORT → INFERENCE_BACKBONE), `GET /readout`, `POST /gridiron/what-if`, `GET /health`.
- `apps/gridiron-web` — Angular 4th-down what-if surface (situation selectors → three-arm posteriors → delta strip + posterior-comparison chart + oracle-agreement badge).
- DB tier — Docker Compose + Prisma (vendored kernel `EventLog`/`Outbox`) + RLS-aware runner + seed scripts.
- A **validation harness** comparing the kernel's per-archetype arm ranking to a fixture of published 4th-down-bot recommendations.

**Out (deferred):**

- **Team personalization** (Approach C — per-team posteriors with hierarchical pooling).
- **Data-learned interactions** (#3 — regression/hierarchical inference; the in-process-first backbone step).
- **Live data polling** (slice 1 is a batch historical load; no nightly poll like markets).
- **A full multi-lever UI** — slice 1 demonstrates multi-lever only via the nested `go-run` / `go-pass` sub-tree (see §7); a rich play-call-bundle surface is future work.
- **Commercial data licensing** — nflverse/EPA are fine for prototyping; productizing needs a license review (see §11).

## 4. Architecture & tiers

Scaffolded via `/new-domain` (markets blueprint). Layout:

```
domains/gridiron/
├── apps/
│   ├── gridiron-api/            ← NestJS; inference catalog lives HERE (not the lib)
│   │   └── prisma/schema.prisma ← vendored kernel EventLog/Outbox (kernel schema)
│   └── gridiron-web/            ← Angular what-if surface
└── libs/
    ├── gridiron-source-spine/   ← batch ETL: nflverse parquet → Play.v1 events
    └── gridiron-pack/           ← archetypes, projection, what-if service
```

- **Ports (default — confirm at scaffold):** api `3400`, Postgres `5475`, web `4300`.
- **Tenant scope:** `GRIDIRON_TENANT_PACK_ID` (single demo tenant in slice 1).
- **Consumption:** published `@de-braighter/substrate-{contracts,runtime}` (ADR-027), never relative paths.
- **Runtime gotcha (from markets):** start the api with `node dist/main.js` — not tsx/esbuild, which breaks NestJS DI.

## 5. Data: ingestion + event shape

The source-spine is a **batch loader** (unlike markets' live poller). It reads nflverse season parquet, filters to 4th-down plays, and emits one event per play:

```jsonc
// gridiron:Play.v1
{
  "eventType":     "gridiron:Play.v1",
  "aggregateType": "gridiron.play",
  "aggregateId":   "<situation-archetype-id × arm composite>",  // = the inference subject (see §6, OPEN-1)
  "payload": {
    "decision":   "go" | "punt" | "kick",   // the arm actually taken
    "epa":        0.00,                       // indicator (Approach A)
    "rawOutcome": 0,                          // B-ready: next-score differential on the possession
    // conditioning aspects (also the future-#3 confounders):
    "yardsToGo":  2,
    "fieldPos":   55,                         // yards from own goal (0–100)
    "scoreDiff":  -4,
    "secondsLeft": 118,
    "qtr":        4
    // ... plus raw nflverse identifiers (game_id, play_id) for traceability
  },
  "occurredAt": "<play timestamp>",
  "tenantPackId": "<GRIDIRON_TENANT_PACK_ID>"
}
```

**Data scope (default):** regular-season 4th-down plays, **2022–2024** (3 seasons, league-wide). Enough volume for league-wide archetype posteriors; small enough to load and reason about.

## 6. Kernel mapping (the crux)

- **Subject** = a **situation archetype** as an individual: `{ kind: 'individual', id: <archetypeId>, role: 'gridiron.situation' }`. This fits Normal-Normal's individual-subject pattern (mirrors exercir's `{ kind: 'individual', id, role: 'football.player' }`). League-wide pooled — *not* per-team.
- **Archetype** = the **combined** discretized state. Default grid (config-driven):
  - distance: `≤2` / `3–6` / `7+`
  - field position: `own-deep` / `own-mid` / `midfield` / `opp-side` / `fringe`
  - score: `trail-big` / `trail` / `close` / `lead` / `lead-big`
  - time: `1st-half` / `Q3` / `Q4-early` / `2-min`
- **Arms** = `go` / `punt` / `kick`, each a plan-tree root carrying a declared effect.
- **Indicator** = `payload.epa` (slice 1, `gridiron.epa` indicator key); flipping to `payload.rawOutcome` ⇒ Approach B.
- **Projection** = `ObservationProjection` over `gridiron:Play.v1`, numerator path `payload.epa`, timestamp path `occurredAt`.

> **OPEN-1 — RESOLVED: (a) arm-in-subject.** Each arm is its own inference *subject*: `aggregateId = uuidv5(situationKey × arm)`. Confirmed against the substrate evidence repo (`prisma-evidence-log.repository.ts`): the per-subject query is `WHERE aggregate_id = subject.id AND event_type IN (projection.eventTypes)` under RLS — no `aggregate_type` filter, no payload-value filter. **Consequence:** the kernel `counterfactual()` primitive takes *one subject + two plan trees* (not two subjects), so it does **not** apply to a multi-arm decision encoded as multiple subjects. The readout/what-if therefore **composes `posterior()` calls** (one per arm-subject) and computes lift/ranking domain-side. Timestamps are read from `payload.observedAt` (the evidence repo evaluates `timestampPath` against `payload`, not the `occurred_at` column). Subject shape: `{ kind:'individual', id: archetypeArmId, role:'gridiron.situation' }`.

## 7. Inference & counterfactual surface

- `POST /gridiron/situation-readout` body = the four aspects `{ distance, field, score, time }` → builds the `situationKey`, derives the arm-subject ids, calls `posterior()` once per arm, returns the arms ranked by mean EPA (each: decision, mean, p10/p50/p90, sd) + the `recommendedArm` + the lift of the recommended arm over the status-quo (punt). Mirrors the markets `/readout` shape (3× `posterior()`), but parameterized by situation rather than enumerating all subjects.
- **No kernel `counterfactual()`** (per OPEN-1): the comparison is a domain-side reduction over the per-arm posteriors (lift = `topArm.mean − puntArm.mean`, dead-banded direction), returning a `WhatIfComparison`-shaped result the UI renders.
- **Multi-lever demonstration (#2):** widen the arm space from `{go, punt, kick}` to `{go-run, go-pass, punt, kick}` — each its own arm-subject (`armFromPlayType` already distinguishes run vs pass) — so the readout combines the *decision* aspect with the *play-type* aspect without any kernel change. (Deferred past slice 3; the encoding already supports it.)

## 8. UI

A 4th-down what-if surface mirroring exercir's `player-what-if-chrome`:

- **Situation selectors** — four controls (distance / field / score / time) that select the multi-aspect archetype; changing the *combination* re-runs the readout.
- **Three-arm result** — posteriors for go/punt/kick, ranked, with the delta strip (▲/▼/— icon + lift in **expected points** + WCAG text label + screen-reader sentence) and a posterior-comparison chart.
- **Oracle badge** — a "vs. the bot" indicator showing whether the kernel's top arm matches the published recommendation for that archetype.
- **a11y** — reuse the exercir what-if a11y patterns (24px targets, focus management on swap, live region for the recommendation, full screen-reader sentence). de/en i18n per ADR-012.

## 9. Validation harness (the oracle)

A test/asset that compares the kernel's per-archetype arm ranking against a fixture of published 4th-down-bot recommendations.

> **Honest framing:** slice 1 ingests **EPA**, so this is a **consistency check** — it proves the kernel *correctly pools a known quantity* and reproduces the established recommendation. It is **not** an independent re-derivation. The independent test arrives when the indicator flips to `rawOutcome` (Approach B), at which point the kernel infers arm values with no football knowledge baked in — and the published bot becomes a true external oracle.

## 10. Testing

TDD throughout:

- **Unit** — archetype bucketing (boundary cases on each aspect), projection extraction (JSONPath → numerator/timestamp).
- **Integration** — ETL → `event_log` → `posterior()` returns a sane, RLS-scoped ranking on a fixture season; `counterfactual()` returns a paired comparison with a shared `runId`.
- **e2e** — UI what-if renders, selectors re-run the readout, oracle badge resolves.
- **Validation** — the §9 harness (kernel ranking vs. oracle fixture) as a gating test.

## 11. Scope boundaries (YAGNI) + the staged path

**Slice 1 explicitly does NOT:** personalize by team (Approach C), learn interactions (#3), poll live data, or build a rich multi-lever UI. **Normal-Normal only; batch historical load only; zero kernel changes.**

**Designed-in growth (the staged path):**

1. **A → B:** ingestion already carries `rawOutcome` + confounders, so independent validation is a config flip on the indicator key.
2. **B → #3:** Approach B walks into **selection bias** (teams that go for it aren't a random sample of 4th downs — trailing teams go more), a confound Normal-Normal cannot resolve. That is the **motivating, multi-pack-justified case** for the next inference-backbone step: a regression/hierarchical model that conditions on the confounders jointly (in-process first; NumPyro deferred).
3. **Discretization pressure valve:** the archetype grid is config-driven. Finer conditioning grain → more archetypes → fewer plays each (the curse of dimensionality made into a design). The day finer grain is wanted *without* sparsity exploding is the day the #3 regression model is earned. **The design encodes its own growth trigger.**

### Licensing note

nflverse data and EPA are freely usable for analytics/prototyping but are not a clean commercial grant. Slice 1 is a prototype/foundation; a commercial release requires a data-license review before anything customer-facing.
