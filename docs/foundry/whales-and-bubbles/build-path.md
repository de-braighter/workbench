---
product_key: whales-and-bubbles
build_path_date: 2026-06-14
status: build-path
charter: docs/foundry/whales-and-bubbles/charter.md
risk_tier: T0
item_count: 6
---

# Build Path — Whales And Bubbles

Decomposes the **wedge** from `charter.md` (T0) into 6 scope-disjoint, single-session
work items. The ladder ends when the charter's end-to-end loop runs — *a human plays a
full solo game vs a naive AI through the browser* — **not** the dossier's full slice 0→6
vision (slices 2–6: shorting, leverage, cascades, hidden objectives, the what-if coach,
regime AI, the chaos dial + macro events + fortune cards — are all post-wedge and NOT
queued here).

## Scaffold plan

- **Repo:** `de-braighter/whales-and-bubbles` (greenfield).
- **`/new-domain` tiers:** spine + pack + api + inference + ui. Target layout (markets
  convention — `apps/<key>-{api,ui}`, `libs/<name>`):
  - `libs/market-engine/` — domain-pure spine (zero NestJS): the deterministic simulator.
  - `libs/game-contracts/` — typed entities + Zod (the pack-contracts lib).
  - `libs/ai-opponent/` — the AI policy lib (the inference tier consumer).
  - `apps/whales-and-bubbles-api/` — NestJS on `SubstrateModule.forRoot` (+ `prisma/`).
  - `apps/whales-and-bubbles-ui/` — Angular standalone + signals.
- **Ports (suggested; scaffold confirms):** Postgres host **5485** (next free in the
  markets family — 5432/5455/5465/5475/5545/5546 taken); api **3105**, ui **4205**.
- **Packages consumed (published, ADR-027):** `@de-braighter/substrate-contracts`,
  `@de-braighter/substrate-runtime`, design-system bricks + tokens. Reuses the
  `domains/markets` (feed→`event_log`), `domains/scenario-lab` (known-truth validation),
  and #214 board-runtime (board + markets skin) patterns.
- **Scaffold note:** add the `MAX_PATH`-workaround `.npmrc` (long Windows paths) per the
  markets/agri reference runs.
- **E1 is the scaffold** — scope = **whole repo** (no `pathPrefix`, no `issue`); every
  other item transitively `dependsOn` it. E1 creates all five projects *wired and green*
  (workspace config, tsconfig path mappings, deps, `SubstrateModule.forRoot`, a routing
  skeleton with a placeholder board route, i18n loader wiring) with placeholder content, so
  E2–E6 fill each project's `src/` without touching shared root surfaces.

## Epic ladder

| Item | Deliverable | Acceptance |
|---|---|---|
| **E1 Scaffold** | The building/testing/registered domain skeleton (all 5 projects wired). | `nx run-many` build + test green; api boots on `SubstrateModule.forRoot`; ui serves the placeholder board route. |
| **E2 Game contracts** | Typed entities + Zod for the wedge subset. | Sector / Holding / Order(long-only) / Player / RoundState / GameConfig / MarketDie-value exported with schemas + unit tests; importable by engine/api/ui. |
| **E3 Market engine** | Deterministic 3-sector simulator + bit-identical replay test. | `(state, orders, seed) → (nextState, events[])` resolves crypto/gold/stocks via regime-drift + mean-reversion + seeded `σ·ε` shock (the market-die value emitted as an event); **replay test is bit-identical**; NO price-impact/cascade/shorting. |
| **E4 Naive AI opponent** | A deterministic naive momentum policy. | Reads `RoundState` → emits a valid long-only allocation; identical output given the same seed (replayable). |
| **E5 Game API** | NestJS game lifecycle + round resolution + persistence. | A full solo game runs end-to-end via the API (create → submit orders → resolve round: human+AI orders → `market-engine` → persist new state + append events → repeat to the bell → net-worth winner); events land in `event_log`; replay reproduces; RLS-scoped per game/owner. |
| **E6 Game board UI** | The minimal solo-loop board. | A human plays a full game vs the naive AI in the browser: sector-map board (#214 + markets skin), secret-commit long-only allocation panel, round reveal **incl. the market-die reveal**, net-worth + bell HUD; WCAG 2.2 AA. |

## UI-surface plan

The dossier manifests **no UI-prototype artifacts** (text-only design capture), so there is
nothing to port; the wedge UI is derived from the dossier §5 prose. The wedge has a
**single surface** — the solo-game board page (board + allocation panel + reveal + HUD) —
so it is one item (**E6**); the app shell (routing, app config, shared layout, i18n loader)
is owned by the scaffold (E1), not a separate sequencing item. UI strings are i18n'd
page-scoped inside `apps/whales-and-bubbles-ui/` (working-language English for this game
prototype); with one surface, the scaffold's i18n wiring suffices — no shell-i18n split.

| Surface | Verdict | Why |
|---|---|---|
| Solo-game board (board + allocation + reveal + HUD) | **in** | The wedge loop itself. → E6 |
| What-if coach view | **deferred** | Slice 5; post-wedge (charter What-NOT). |
| Hidden-objective HUD / fortune-card hand / news ticker / chaos-dial control | **deferred** | Slices 2/4; post-wedge. |

## ADR needs & gates

- **ADRs: none.** T0, pack-native — the charter expects **zero kernel change**, and the
  market-sim/event/fortune primitives stay pack/engine + `metadata` JSONB (ADR-176; promote
  only on `markets` + `whales-and-bubbles` dual-demand). The §6 market-math model is captured
  in **E3's designer-first spec**, promotable to a domain-local ADR later only if it proves
  load-bearing — not required to build. No ADR-authoring items are emitted.
- **Gates:** T0 → **no Gate 2 (architecture)**. The next founder gate is the **ship gate at
  wedge completion** (E6 green = the playable solo loop), per the charter gate schedule.

## Quality battery config

Deterministic gates (T0 standard): the lint audit set, `knip`, `coverage-delta` (standard),
**no mutation threshold** (T0 carries none — not added), and the a11y battery on UI items.
Obligations are copied verbatim from the charter quality plan; applicability:

| Obligation | Applies to |
|---|---|
| `wave-standard` | E1, E2, E3, E4, E5, E6 (all) |
| `replay-determinism` | E3, E4 (the seeded-deterministic resolution chain) |
| `rls-scoped-per-game` | E5 |
| `a11y-AA` | E6 |
| `designer-first` | E3 |
| `skill-dominance-gate>=65` | **none in the wedge** — slice ≥ 2 only (no `strong` policy or chaos layers exist yet); deferred to post-wedge engine items. |

## Lanes & parallelism

- **Critical path:** E1 → E2 → E3 → E5 → E6.
- **Parallel pair:** after E2 lands, **E3 (engine) ∥ E4 (ai-opponent)** run concurrently
  (disjoint libs). E4 then joins the path at E5.
- `lane` is informational only (parallelism is `dependsOn` + disjoint scopes): `scaffold`,
  `contracts`, `engine`, `ai`, `api`, `ui`.

## Work items

| itemId | title | scope (repo `de-braighter/whales-and-bubbles`) | dependsOn | lane | qualityObligations |
|---|---|---|---|---|---|
| `whales-and-bubbles/E1` | Scaffold the whales-and-bubbles domain via `/new-domain` (spine `market-engine` + pack `game-contracts` + `ai-opponent` lib + NestJS api + Angular ui), all projects wired & green | whole repo (no pathPrefix, no issue) | — | scaffold | `wave-standard` |
| `whales-and-bubbles/E2` | `game-contracts`: typed entities + Zod for the wedge — Sector, Holding, Order (long-only), Player, RoundState, GameConfig, MarketDie value | `libs/game-contracts/` | E1 | contracts | `wave-standard` |
| `whales-and-bubbles/E3` | `market-engine`: deterministic 3-sector (crypto/gold/stocks) simulator — regime drift + mean-reversion + seeded σ·ε shock (the market-die value emitted as an event); pure `(state,orders,seed)→(nextState,events[])`; **bit-identical replay test**; NO impact/cascade/shorting | `libs/market-engine/` | E2 | engine | `wave-standard`, `replay-determinism`, `designer-first` |
| `whales-and-bubbles/E4` | `ai-opponent`: deterministic naive momentum policy (RoundState → long-only allocation), seeded/replayable | `libs/ai-opponent/` | E2 | ai | `wave-standard`, `replay-determinism` |
| `whales-and-bubbles/E5` | `whales-and-bubbles-api`: NestJS on `SubstrateModule.forRoot` — create game / submit orders / resolve round (human+AI → market-engine → persist state + append events) / get state / bell + net-worth; RLS-scoped per game/owner | `apps/whales-and-bubbles-api/` | E3, E4 | api | `wave-standard`, `rls-scoped-per-game` |
| `whales-and-bubbles/E6` | `whales-and-bubbles-ui`: solo-game board (#214 board + markets skin) — secret-commit long-only allocation panel + round reveal incl. the **market-die reveal** + net-worth/bell HUD; full human-vs-naive-AI game playable in browser | `apps/whales-and-bubbles-ui/` | E2, E5 | ui | `wave-standard`, `a11y-AA` |

## Disjointness proof

Only **one** unordered pair exists (every other pair is transitively ordered by `dependsOn`,
so the two items can never hold claims simultaneously):

| Unordered pair | Evidence | Verdict |
|---|---|---|
| E3 ↔ E4 | non-nested paths: `libs/market-engine/` vs `libs/ai-opponent/` (neither is a prefix of the other) | **disjoint** ✓ |

Ordered pairs (no disjointness needed): E1≺all; E2≺E3,E4,E5,E6; E3≺E5≺E6; E4≺E5≺E6.
E1 claims the whole repo (no pathPrefix/issue) but every other item `dependsOn` E1, so it
is never concurrent with them. **Dangling-`dependsOn` check:** every referenced id (E1, E2,
E3, E4, E5) appears in the item list above; no ADR items referenced. ✓
