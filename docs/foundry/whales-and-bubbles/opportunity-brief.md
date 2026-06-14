---
product_key: whales-and-bubbles
brief_date: 2026-06-14
status: brief
substrate_fit: natural
rubric_total: 31/40
recommended_tier: T0
recommendation: build
---

# Opportunity Brief — Whales And Bubbles (next-gen economic strategy game)

> Scoring axis note (the dossier's own demand): this idea is positioned **not as a
> consumer-market play but as a kernel-coverage + developer-experience testbed** with the
> game as the *carrier*. The rubric below scores all eight dimensions honestly — which
> makes the market-facing dimensions deliberately weak — but the recommendation weights
> **Strategic fit · Platform leverage · Data/MVP feasibility · Regulatory ease**, where
> this idea is exceptionally strong. Judging it as a consumer game would mis-score it.
> Rubric provenance: `docs/ideas-inbox/substrate_saas_opportunity_dossier/substrate_saas_opportunity_dossier/01_overview_and_scoring.md`.

## Substrate-fit decomposition

| Kernel concern | What it concretely is here | Verdict |
|---|---|---|
| **Plan tree** | A player's strategy = a single-parent tree of typed capital-deployment decisions over rounds (`deploy → sector S`, `lever 2×`, `short S`) as ADR-154 effect declarations; aggregated player flows = `composeEffects` over those declarations. Structured instruments (build→grow→IPO, leverage/conditional chains) and the coach's counterfactual branch-tree give genuine hierarchy. | **natural** (shallow leg) |
| **Event log** | Per-round market resolution — price moves, fills, **margin calls**, regime flips, cornering fees, dividends — is the append-only observation stream. Direct descendant of `domains/markets` recording a price feed into `kernel.event_log`. Dense + high-frequency (event-sources *harder* than domains where observations trickle). | **natural** (strong) |
| **Inference** | The AI opponent is a planner under uncertainty estimating the hidden market regime from the observation log → allocations (ADR-203 wiring). Post-game what-if coach = counterfactual replay. Known-truth world → recovery/calibration measurable against ground truth (§11 misfit gate, Brier, C-index). | **natural** (testbed-strong) |
| **Reproducibility** | Seed + committed orders + run-manifest → **bit-identical replay**. Here determinism is *intrinsic product value* (anti-cheat, tournaments, the what-if coach), not a compliance checkbox — arguably the cleanest reproducibility fit in the cluster. | **natural** (strong) |

**Aggregate: `substrate_fit: natural`** (all four concerns natural). This is among the
cleanest four-concern decompositions in the cluster — unsurprising, since the game was
*reverse-engineered from the four concerns*.

**Two honesty caveats (carried from the dossier, not papered over):**

1. **Plan-tree is the shallow leg.** The per-round allocation maps naturally onto a tree,
   but a flat allocation is more *timeline* than deep *hierarchy*; the primitive gets a
   deep workout only if structured/nested instruments + the counterfactual branch-tree are
   **deliberately designed in**. This is a design lever, not a fit failure — but it means
   the tree's testbed value is opt-in, and the build-path must choose whether to spend on it.
   **Update (2026-06-14, post-brief):** the approved random-kick design *pulls this lever* —
   its optional fortune/opportunity instruments + conditional "play if X" decisions are
   genuine nested/conditional plan branches. The shallow-leg caveat is now substantially
   addressed by design. See
   `../../superpowers/specs/2026-06-14-whales-and-bubbles-random-kick-design.md`.
2. **Synthetic ≠ messy-real.** A known-truth world validates the kernel's *plumbing and
   DX*, not the hard real-world inference problems (biased/missing observations, provenance,
   terminology, regulation). `scenario-lab` already owns the synthetic-validation claim;
   this *extends* it to a richer, interactive, multi-agent world — it does not prove "the
   kernel for real domains."

> Gate-rule status: no core concern is `absent`, so a T1+ build is permissible (the gate
> only bars T1+ when a concern is absent). The tier recommendation below lands at **T0**
> for *blast-radius/regulatory* reasons, not for any substrate-fit deficiency.

## Reuse inventory

Concrete cluster assets this composes (the dossier is explicit that this is composition,
not invention):

- **`kernel.event_log` + the tenant-scoped `INFERENCE_BACKBONE` port** (`counterfactual()`,
  Normal-Normal active per **ADR-203**) — regime estimation + the what-if coach ride this.
- **`domains/markets`** — the external-source → `event_log` → Normal-Normal → Angular
  pattern (5-arg router, summary narrowing, lockfile-proof on substrate 1.2.0). Its
  price-feed-into-log mechanic is exactly the simulated market's shape.
- **`domains/scenario-lab`** — the domain-agnostic known-truth stochastic world + inference
  + the **§11 misfit / GoF gate** harness. Directly reusable to *validate the market-engine*
  (generate truth → infer → score against truth: Brier / C-index / KM-divergence).
- **#214 board-runtime** — domain-free spatial board + **skin system**; the sector map is
  that board with a "markets skin" (the cluster's skin-as-profile pattern, one more profile
  on the agnostic stack — feeds the **studio "agnostic surfaces"** direction).
- **`/new-domain` scaffolder** (markets reference run, agri-refreshed to substrate 1.2.0) —
  spine lib + pack lib + NestJS api + optional DB/inference/UI tiers, building/testing/registered.
- **`SubstrateModule.forRoot` + `GucPrismaRunner`** (ADR-197) — RLS scoped per game/owner.
- **Reproducibility: `run_manifest` / replay** (shipped in the substrate-coherence
  remediation) — the bit-identical-replay acceptance test rides this.
- **The what-if / counterfactual lane** (exercir #119/#120) — repurposed as the post-game coach.
- **design-system bricks + tokens** (ADR-168), **reactive forms + CVA** for the UI.

The only genuinely *new* engineering is **`libs/market-engine`** (sector price processes,
square-root-law price impact, correlated seeded shocks, the **margin-cascade fixed-point
resolver**) — the crown jewel and the hardest piece. Everything else is wiring proven parts.

## Scorecard

| # | Dimension | Score | Justification |
|---|---|---|---|
| 1 | **Strategic fit** | **4/5** | A kernel-coverage + DX testbed exercising all four concerns with *known ground truth* + *dense events* + *fast feedback* — exactly what the slow regulated domains (oncology) can't provide; also a consumer-legible showcase and another skin/profile feeding the studio flagship. Not 5: it's a carrier/dogfood play, not a revenue line, and the studio is the actual flagship. |
| 2 | **Market pain** | **2/5** | Entertainment is a *want*, not an acute pain; the strategy-game market is crowded. By the founder's own framing this is not the value axis. A mild financial-literacy adjacency exists but is secondary. |
| 3 | **Buyer clarity** | **2/5** | No pricing, no named external segment beyond "hobbyist strategy players." The *real* first "buyer" is internal (us, dogfooding the kernel) — which is clear, but not a market buyer. |
| 4 | **Data feasibility** | **5/5** | The data is **synthetic** — we generate the market. Zero acquisition, zero provenance/bias risk, no terminology bindings. (The flip side — synthetic ≠ messy-real — is a *validity* caveat, not a feasibility one.) |
| 5 | **MVP feasibility** | **4/5** | Slices 0–1 (3-sector deterministic engine + replay test → 1 human vs 1 naive AI long-only loop) are crisp vertical increments leaning on `markets` + `board` + `/new-domain`. Not 5: the market-math *balance* is genuinely open and the cascade resolver is real engineering (deferred to slices 2–3, but the wedge still needs a sound base engine). |
| 6 | **Differentiation** | **4/5** | Market-impact-as-PvP + deterministic replayable cascades + hidden-objective anti-snowball is a fresh combination in economic strategy games; clean-room-legal (only Monopoly's *idea*, not its skeleton). As a substrate showcase, "the AI *visibly* reasons about a market" is uniquely legible. |
| 7 | **Regulatory ease** | **5/5** | Synthetic, single-player-first, **no real money** (gambling explicitly out), no PHI, no real market data in v1. Near-zero burden. Watch-outs are only clean-room IP discipline (avoid Hasbro trademark/art/names) and the *deferred* gambling exposure if real-money were ever added (a non-goal). |
| 8 | **Platform leverage** | **5/5** | Pure composition of markets + scenario-lab + board-runtime + inference backbone + new-domain scaffolder; **zero kernel change expected**. Also *stress-tests* the kernel (dense events, reproducibility-as-feature, multi-agent inference) and keeps the **ADR-176 inclusion test** + **"store generators, derive graphs"** in continuous exercise. |

**Total: 31/40.** The shape — low market dimensions (2,3), maxed platform/feasibility/reg
(4,7,8) — is the expected signature of an internal dogfooding + showcase play, not a defect.

## Risk tier

**Recommended: `T0` (prototype / demo / showcase).**

Justification against regulatory burden + blast radius:

- **Regulatory burden: near-zero** — no PHI, no real money, no real market data, synthetic
  world. Nothing here resembles the regulated-device burden that makes oncology a T2.
- **Blast radius: contained** — it handles no real user data and drives no regulated
  decision; zero kernel change means no risk to shared infrastructure. Its failure mode is
  "the game isn't fun yet," not "we mishandled someone's data."
- **Founder framing** — explicitly a "kernel-coverage and DX testbed," "consumer game as
  the carrier, not the thesis." That is a T0 posture: prove a point, validate ergonomics,
  showcase. A T1 product-grade quality battery would be **miscalibrated over-spend** for a
  dogfood game with no external users.

**Promotion path (documented, not taken now):** if the solo loop proves genuinely fun and a
real consumer go-to-market emerges, re-charter to **T1** at that point — the charter remains
the tier authority and can override. Do not pre-pay T1 quality on a T0 thesis.

## Recommendation & wedge

**Recommendation: `build` — as a `T0`.** This is a legitimate greenlight on its own terms:
the cleanest four-concern substrate fit in the cluster, maximal platform leverage, near-zero
regulatory/data risk, crisp vertical slices, and a strong, well-scoped `/build-path`
candidate (§8.6). It directly serves the substrate-dogfooding + studio-agnostic-surfaces
direction. The weak market dimensions are expected and acceptable for a T0 dogfood/showcase.

**Wedge (narrowest valuable first slice):** **`libs/market-engine` (slice 0) → minimal solo
loop (slice 1)**, collapsed into one vertical:

- 3 sectors only — **crypto + gold + stocks** (the cleanest bubble / hedge / growth triangle).
- Deterministic resolution with a **bit-identical replay test as the acceptance gate** (this
  is the load-bearing reusable asset and de-risks everything downstream).
- 1 human + 1 **naive** AI, **long-only** allocation, bell + net-worth scoring, minimal
  sector-map board UI (the #214 board with a markets skin).
- Answers the make-or-break question: **"does allocating against a living, readable market
  feel good?"** — narrower than this loses the playable signal; wider pulls in the hard
  cascade resolver prematurely.

## What NOT to build (charter candidates)

1. **No deep instruments in the wedge** — leverage, margin calls, cascades, shorting,
   cornering are slices 2–4, introduced *progressively*; the wedge is long-only.
2. **No kernel changes** — market-sim primitives stay pack/engine + `metadata` JSONB;
   promote to the kernel **only** on demonstrated `markets` + `whales-and-bubbles`
   dual-demand (ADR-176 inclusion test, demand-driven).
3. **No real-money / gambling** — explicitly out; this is the line that keeps regulatory
   ease at 5/5.
4. **No live real-market-data mode in v1** — a later optional mode; `markets` has the
   plumbing when wanted.
5. **No multiplayer infrastructure before the solo loop is proven fun** — async
   play-by-cloud is the eventual *first* MP step, still post-wedge.
6. **No cardboard/physical edition** — simultaneous stochastic resolution + margin cascades
   can't run on cardboard.
7. **No external substrate marketing** — Option A holds; what ships is a game, the substrate
   stays internal infrastructure.
