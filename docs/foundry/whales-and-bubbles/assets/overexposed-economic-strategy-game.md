---
title: "Overexposed — a next-gen economic strategy game on the substrate (idea dossier)"
status: idea dossier — awaiting foundry intake (not yet greenlit)
kind: idea-dossier
created: 2026-06-14
author: stibe
source: brainstorming session (2026-06-14) — full design decisions captured below
intake-path: dossier-intake → opportunity-brief → founder Gate 1 → product-charter → build-path
home: domains/overexposed (proposed working name — alternates Whale / Bull Run / Margin)
relates-to:
  - layers/specs/adr/adr-176-substrate-kernel-minimality-inclusion-test.md
  - layers/specs/adr/adr-127-kernel-substrate-v1.md
  - layers/specs/adr/adr-154-effect-declaration-algebra.md
  - layers/specs/adr/adr-027-pack-architecture.md
  - layers/specs/adr/adr-203-wire-inference-to-observation-log-and-second-conjugate-family.md
  - docs/superpowers/specs/2026-06-03-markets-external-source-integration-design.md
  - docs/superpowers/specs/2026-06-07-football-board-runtime-design.md
origin: >
  The founder asked: Monopoly only focuses on real estate — why not "pimp" it with
  stocks, crypto, gold and new strategic dimensions for a genuinely next-gen version,
  built on the substrate. Monopoly's mechanics (move, acquire, charge, accumulate,
  bankrupt) are not copyrightable — only Hasbro's exact board art, names, and the
  "Monopoly" trademark are. So a clean-room economic game is fully open ground. This
  brainstorm took the *idea* of Monopoly and rebuilt it as a deep portfolio-strategy
  game whose engine is exactly the substrate's four kernel concerns.
decisions: >
  Settled in brainstorming (2026-06-14): (D1) positioning = a GENUINELY GREAT STRATEGY
  game (depth, low pure-luck, no boring elimination; substrate is the invisible engine).
  (D2) core loop = a SECTOR MAP, not a track — you allocate capital, no dice, no random
  movement. (D3) PvP engine = MARKET IMPACT ("whales & bubbles") — your flows move
  prices; piling in inflates bubbles that pop on holders; corner a sector to weaponize
  it. (D4) price engine = player flows + a STRUCTURED, READABLE STOCHASTIC simulation
  (trend, volatility, mean-reversion, cross-asset correlation) + occasional macro
  regimes. (D5) win condition = BOUNDED ROUNDS ("the bell") + HIDDEN OBJECTIVES (hidden
  leader, asymmetry, no gang-up-on-the-frontrunner). (D6) turn structure = SIMULTANEOUS
  secret commit → the substrate resolves all flows at once → reveal. (D7) risk layer =
  FULL TOOLKIT (leverage, margin calls, shorting, liquidity, margin cascades). (D8)
  primary mode = SOLO vs twin-AI first (campaign + skirmish), multiplayer later; the AI
  opponent's brain IS the substrate inference engine; a post-game what-if coach teaches
  via counterfactual replay (never an in-game oracle).
note: >
  PACK-on-platform (ADR-027), ZERO kernel change expected. The market simulation, the
  instruments, and the game rules are pack representation in typed pack/engine libs +
  `metadata` JSONB. The lineage is real: domains/markets already records a live price
  feed into kernel.event_log and runs inference over it; domains/scenario-lab proved a
  known-truth stochastic world + inference acting on it; the #214 board-runtime is a
  domain-free spatial surface this game skins. Overexposed is a NEW domain that composes
  these — not a kernel change.
---

# Overexposed — a next-gen economic strategy game on the substrate

> You don't buy tiles — you build a **portfolio** across real estate, stocks, crypto,
> gold and startups while a living market booms and crashes around the table. Your
> trades move prices: pump a bubble, short the pop, hedge the crash, weaponize a
> cornered sector — and never get eliminated. Every round, all players commit
> allocations in secret; the substrate resolves every flow at once and reveals the new
> market. The richest portfolio at the bell wins. Because the engine is fully seeded,
> every game is replayable and every crash is disputeless.

## 1. Purpose & framing

`domains/overexposed/` (working name) is a **new substrate domain**: a digital,
single-player-first economic strategy game. Two intents stack:

1. **A genuinely great strategy game in its own right** — deep, low-luck, no boring
   elimination, the kind hobbyist strategy players respect. The substrate is the
   invisible engine, not the marketing.
2. **The most consumer-legible substrate showcase yet** — the four kernel concerns map
   onto the game so tightly that "look what the substrate does" and "this is a fun game"
   are the same sentence. The AI opponent *visibly* reasons about a market via inference.

This is **not** a Monopoly clone and not Monopoly-shaped. It keeps only Monopoly's
*idea* (acquire assets, accumulate wealth, push opponents) and discards its skeleton
(dice movement, a loop track, player elimination, real-estate-only). It is closer to a
portfolio/euro strategy game with a market-microstructure engine.

**Lineage (this is composition, not invention):**

- **domains/markets** — already records a live external price feed into
  `kernel.event_log` and runs Normal-Normal inference over it. Overexposed's market is
  that idea turned into a *simulated, game-balanced* feed.
- **domains/scenario-lab** — proved a domain-agnostic, known-truth stochastic world with
  inference acting on it. The AI opponent is a *planner* in exactly that shape.
- **#214 board-runtime** — a domain-free spatial board surface with a skin system.
  Overexposed's sector map is that board with a **markets skin** (the cluster's
  "skin = profile" pattern, one more profile on the agnostic stack).

## Why build this now — the kernel-coverage bet (Gate-1 lens)

Overexposed is proposed less as a market play than as a **kernel-coverage and
developer-experience testbed**: a fast-feedback domain that exercises all four kernel
concerns end-to-end, with *known ground truth* and dense events that the slow, regulated
domains (oncology) structurally cannot provide. **This is the axis the opportunity-brief
should score it against — kernel coverage + DX value, not consumer-market moat.** Judging
it as a consumer game would mis-score it; its value is dogfooding the kernel under a
demanding, multi-agent, real-time-ish workload.

### Coverage map (honest depth — not cheerleading)

| Concern | Depth | Read |
|---|---|---|
| **Flat the observation** (event log) | **Heavy / natural** | Dense, high-frequency events every round (fills, margin calls, regime flips). Event-sources *harder* than domains where observations merely trickle in. |
| **Reproducibility** (run-manifest + replay) | **Heavy / natural** | Determinism is *intrinsic value* (anti-cheat, tournaments, the what-if coach), not a compliance checkbox. Seed + committed orders → bit-identical replay. |
| **Inference** (posteriors / twin) | **Strong as a testbed** | Known-truth world (the scenario-lab shape): because the market is generated, recovery + calibration are *measurable* against ground truth — §11 misfit gate, Brier, C-index all observable. Gold for validating the engine. Caveat: the game itself does not *require* deep Bayesian inference (a heuristic AI is still fun), so this is testbed value, not load-bearing product value. |
| **Recurse the plan** (intervention tree) | **Medium — the soft spot** | Effect-*declaration* + composition is genuine (aggregated player flows = `composeEffects` over ADR-154 declarations). But a strategy is more a *timeline* than a deep single-parent *hierarchy* — it exercises the tree deeply only if we deliberately design structured multi-step instruments (build→grow→IPO, conditional/leverage chains) and the counterfactual branch-tree for the coach. |

It also keeps two pieces of **governance machinery** in continuous use: the **ADR-176
inclusion test** (the market-sim primitives will tempt promotion; the correct answer is
pack territory + `metadata` JSONB, promoting only on genuine markets + overexposed
dual-demand), and **"store generators, derive graphs"** (the correlation/causal structure
is derived per round, never stored).

### Two honest caveats (so the brief doesn't over-claim)

1. **The plan-tree is the shallow leg.** If touching the tree *deeply* is a goal of the
   playground, it must be designed in (structured/nested instruments + the counterfactual
   branch-tree) — otherwise the tree primitive gets only a light workout. This is a design
   lever, not an inherent limit.
2. **Synthetic ≠ messy-real.** A known-truth world validates the kernel's *mechanics and
   ergonomics*, not the hard real-world inference problems (biased/missing observations,
   provenance, terminology bindings, regulatory governance). It proves the *plumbing and
   the DX*, not "the kernel for real domains" — scenario-lab already owns the
   synthetic-validation claim; this extends it to a richer, interactive, multi-agent world.

**Net:** a legitimate greenlight rationale on its own terms — judge it on how much kernel
surface it exercises and how fast it lets us iterate kernel ergonomics, with the consumer
game as the carrier, not the thesis.

## 2. Brainstorming decisions (2026-06-14)

| # | Decision | Choice |
|---|---|---|
| **D1** | Positioning | A **genuinely great strategy game** (depth-first; substrate invisible) |
| **D2** | Core loop | A **sector map**, not a track — allocate capital; **no dice, no random movement** |
| **D3** | PvP engine | **Market impact** — whales & bubbles; flows move prices; corner sectors |
| **D4** | Price engine | Player flows **+ a structured, readable stochastic sim** + macro regimes |
| **D5** | Win condition | **Bounded rounds ("the bell") + hidden objectives** |
| **D6** | Turn structure | **Simultaneous secret commit → resolve all at once → reveal** |
| **D7** | Risk layer | **Full toolkit** — leverage, margin calls, shorting, liquidity, cascades |
| **D8** | Primary mode | **Solo vs twin-AI first** (AI brain = inference engine) + post-game what-if coach |

## 3. Game design

### 3.1 The board — an asset map

Nodes are **sectors/exchanges**, each with its own price process and personality:

| Sector | Personality | Strategic role |
|---|---|---|
| Real estate | Illiquid, steady yield | Cash-flow anchor; slow/discounted to exit under pressure |
| Stocks | Liquid, sector-cyclical, dividends | Growth engine; shortable |
| Crypto | High-volatility, hype/rug cycles | The bubble factory; biggest swings (thinnest depth) |
| Gold / commodities | Safe-haven, **anti-correlated** | The hedge; rises when risk assets crash |
| Bonds / cash | Low fixed yield, liquidity | The de-risk button |
| Startups | Build → grow → **IPO into stocks** | Bridges illiquid building and liquid markets |

### 3.2 The round loop (the heart)

1. **Read** — current prices, regime hints, your exposure, margin headroom, cash.
2. **Commit** (secret, simultaneous) — for each sector: buy / sell / short / hold and how
   much; set leverage; place limit/stop orders.
3. **Resolve** (substrate, deterministic) — aggregate all player flows, apply each
   sector's stochastic process, compute new prices; trigger fills, **margin calls**
   (forced liquidations that deepen the move and cascade — resolved to a fixed point),
   cornering fees, dividends/yield.
4. **Reveal** — new market + everyone's net worth move; **objectives stay hidden**.
5. Repeat for **N rounds** → **bell** → net worth **+ secret-objective bonuses** → winner.

### 3.3 Instruments (full toolkit)

- **Leverage** — borrow against assets to amplify positions.
- **Margin calls** — equity below maintenance margin forces liquidation; forced sells
  feed back into the same resolution → **cascades** (the 2008 domino as a game system,
  made fair and replayable by deterministic resolution).
- **Shorting** — profit from a pop *and* add selling pressure that deepens it; the
  instrument and the mechanic are the same thing.
- **Liquidity** — illiquid holdings (real estate) sell at a discount under pressure;
  asset-rich/cash-poor crunches are a real failure mode.
- **Cornering** — control enough of a sector to influence its swings / levy fees.

Designed in full; **introduced progressively** in the build (see §7) to manage the
learning curve.

### 3.4 Win condition, objectives, and the emergent anti-snowball

- **Bell** — a fixed round count bounds length and creates final-round
  timing-the-exit tension.
- **Hidden objectives** — each player draws secret objective(s) (e.g. *corner a sector*,
  *survive a crash solvent*, *highest CAGR*, *biggest single winning trade*). They create
  a **hidden leader** (no ganging up on an obvious frontrunner) and a **bluffing layer**:
  flows no longer reveal intent (is that crypto buyer a believer, or baiting you to dump
  on at the top?).
- **Emergent anti-snowball** — the leader is usually the most invested, hence the most
  **exposed**; crashes hurt them most. The market is a built-in rubber-band against
  runaway leaders — Monopoly's worst flaw — with *no artificial catch-up mechanic*. This
  is why the working title is **Overexposed**.

### 3.5 The twin / AI — three honest roles

1. **Opponent brain** — AI players use the substrate inference engine to estimate the
   market regime from the observation log, then choose allocations. Difficulty tiers:
   naive momentum bot → regime-aware → flow-anticipating (models other players). This is
   the **solo-first** experience and the most visible proof the substrate does real work.
2. **Fair resolver** — invisible, deterministic, seeded.
3. **Post-game what-if coach** — *after* the bell, replay the game with one decision
   changed: *"hedge with gold here and you'd have survived the March crash."* The exercir
   what-if/counterfactual lane, repurposed as a teacher. **Never an in-game oracle** —
   telling a player the optimal live move would solve the game and kill the strategy. This
   is also the bridge to a secondary **financial-literacy** opportunity (not the primary
   positioning, but a real adjacency: the game secretly teaches portfolio thinking).

## 4. Substrate mapping (why this is the showcase)

The game *is* the four kernel concerns ([ADR-127](../../layers/specs/adr/adr-127-kernel-substrate-v1.md)):

- **Recurse the plan** — a player's strategy is a single-parent tree of typed
  capital-deployment decisions over rounds (`deploy capital → sector S`, `lever 2×`,
  `short S`) — effect declarations in the [ADR-154](../../layers/specs/adr/adr-154-effect-declaration-algebra.md)
  sense.
- **Flat the observation** — market resolution per round (price moves, fills, margin
  calls, regime flips, cornering fees) is the append-only event log. Direct descendant of
  domains/markets recording into `kernel.event_log`.
- **Inference** — the AI opponent is a *planner under uncertainty* over a known-truth
  stochastic world — exactly the scenario-lab shape, wired to the log per
  [ADR-203](../../layers/specs/adr/adr-203-wire-inference-to-observation-log-and-second-conjugate-family.md).
- **Reproducibility** — seed + run-manifest → bit-identical replay = anti-cheat,
  tournaments, and the what-if coach for free.

**ADR-176 posture:** zero kernel change is the expectation. The market simulation, the
instruments, the rules, and the AI policy are **pack/engine territory** (typed libs +
`metadata` JSONB). Nothing here is shared infrastructure ≥2 packs need the kernel to
validate/version, so nothing is promoted. If a market-sim primitive later proves
multi-domain demand (markets + overexposed both needing it), *then* the ADR-176 promotion
rule applies — demand-driven, never speculative.

## 5. Architecture sketch (pre-scaffold)

A new domain via the `/new-domain` scaffolder, consuming **published**
`@de-braighter/substrate-{contracts,runtime}` (ADR-027 — packages, not relative paths):

- **`libs/market-engine`** (the crown jewel, domain-pure, zero NestJS) — the deterministic
  market simulator: sector price processes, player-flow price impact, correlation, regime
  model, margin-cascade fixed-point resolver. Pure function `(state, committedOrders, seed)
  → (nextState, events[])`. **Seeded and replayable by construction.** This is the reusable
  asset and the hardest engineering.
- **`libs/game-contracts`** — typed entities + Zod schemas (Sector, Holding, Order,
  Player, RoundState, Objective, GameConfig), shared API ↔ UI ↔ engine.
- **`libs/ai-opponent`** — the policy(ies); consumes the inference backbone to read the
  regime, then selects allocations. Difficulty as a strategy seam.
- **api** (NestJS on `SubstrateModule.forRoot`) — game lifecycle, round resolution
  orchestration, persistence of state + the event log; RLS-scoped per game/owner.
- **`libs/game-ui`** (Angular standalone + signals) — the **sector-map board** (#214 board
  with a markets skin), the secret-commit allocation panel, the reveal/animation of price
  moves and cascades, net-worth + (own) objective HUD, the post-game what-if view. Reactive
  forms + CVA; design-system bricks + tokens.

## 6. The market math (the real engineering core — proposed starting model, to validate)

This is the genuinely open, balance-critical piece. A concrete, credible starting model
(not final — to be tuned against playtests):

For each sector `s`, log-price evolves per round:

```
Δlog P_s  =  μ(regime)                         # regime drift (bull/bear/crash/recovery)
           + θ_s · (log P̄_s − log P_s)         # mean-reversion toward a fundamental P̄_s
           + impact(F_s)                        # player price-impact (the whale term)
           + σ(regime) · ε_s                    # stochastic shock, ε ~ N(0, Σ), seeded
```

- **Price impact** `impact(F_s) = λ · sign(F_s) · (|F_s| / depth_s)^α` with `α ∈ (0,1)`
  (concave, square-root-law-style). `F_s` = net capital flow into `s` this round (buys −
  sells − new shorts). **Thin sectors** (crypto: small `depth_s`) move more → bigger
  bubbles; deep sectors (real estate/bonds) are sluggish.
- **Bubble fragility** — `θ_s` (mean-reversion pull) strengthens with deviation from
  `P̄_s`, so the further a bubble inflates, the harder the eventual snap, and a large net
  sell can trigger it early.
- **Correlation** — `Σ` couples the shocks: gold negatively correlated with crypto/stocks;
  stocks/crypto positively in risk-on regimes. Drawn from a multivariate normal, seeded.
- **Regime** — a hidden state (bull/bear/crash/recovery) shifting `μ`, `σ`, and possibly
  `Σ`; transitions are seeded events appended to the log (and a *readable* signal skilled
  players learn to anticipate).
- **Margin-cascade resolution** — after the price update, force-liquidate any player below
  maintenance margin; their forced sells re-enter `F_s` for a second-order kick; iterate to
  a fixed point. Fully deterministic given seed + committed orders.

Open sub-questions to settle in the spec/plan: parameter ranges for fun-vs-realism;
whether `P̄_s` (fundamentals) drift; how cornering modifies `depth_s`/fees; the exact
objective deck; how the AI estimates regime cheaply.

## 7. Scope — slice ladder (first playable → full)

| Slice | Ships | Question it answers |
|---|---|---|
| **0** | `market-engine` lib: 3 sectors (stocks/gold/crypto), deterministic resolution, **replay test** (bit-identical) | Is the engine sound and reproducible? |
| **1** | 1 human + 1 naive AI, **long-only** allocation, bell + net-worth, minimal sector-map UI | Does allocating against a living, readable market *feel good*? |
| **2** | **Shorting** + the **whale price-impact** (flows move prices), 2–3 AI | Do bubbles/crashes create the intended drama? |
| **3** | **Leverage + margin calls + cascades** + liquidity crunches | Does the risk layer deepen without overwhelming? |
| **4** | **Hidden objectives** + objective deck + cornering | Does the bluffing/hidden-leader layer land? |
| **5** | **Post-game what-if coach** (counterfactual replay) | Is the teaching moment compelling? |
| **6** | Regime-aware AI difficulty; richer sectors (real estate, bonds, startups/IPO) | Is there a skill ceiling worth climbing? |
| **Later** | Multiplayer: **async play-by-cloud** first (fits simultaneous-commit), then live | Does it hold up human-vs-human? |

Each slice is a vertical UI + API + engine increment, gated by the repo's verifier wave.

## 8. Open questions (to nail in the spec / first plan)

1. **Name** — Overexposed vs Whale / Bull Run / Margin (and the final `domains/<name>`).
2. **First sectors** — recommend **crypto + gold + stocks** (the cleanest bubble / hedge /
   growth triangle) for slices 0–2.
3. **Market math parameters** — the §6 model's constants and the fun-vs-realism balance.
4. **Objective deck** — the starting set of secret objectives and their scoring.
5. **AI difficulty seam** — how the three tiers are expressed and selected.
6. **Build vehicle** — hand-built slices vs a foundry `/build-path` (this is a clean,
   well-scoped new domain — a strong foundry candidate).

## 9. Non-goals (v1)

- A physical/cardboard edition (the simultaneous stochastic resolution + margin cascades
  cannot run on cardboard).
- Real-money play / gambling — explicitly out.
- A **live real-market-data mode** — a later *optional* mode, not v1 (markets domain has
  the plumbing when wanted).
- Full multiplayer infrastructure before the solo loop is proven fun.
- Marketing the substrate externally (Option A holds — the substrate stays internal
  infrastructure; what ships is a game).
