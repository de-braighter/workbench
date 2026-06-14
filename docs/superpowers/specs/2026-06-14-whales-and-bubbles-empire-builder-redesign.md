# Whales & Bubbles — empire-builder redesign

- **Date:** 2026-06-14
- **Status:** design — approved in brainstorm, awaiting spec review → build-path
- **Product:** `whales-and-bubbles` (foundry; T0). Repo `de-braighter/whales-and-bubbles`.
- **Supersedes the wedge's core loop** (the shipped "allocate a portfolio against a market"
  loop — verdict: *fine v1 but boring*). Builds on: the shipped 6-item wedge (substrate
  plumbing, #214 board, market-engine math core, deterministic replay) and the
  `2026-06-14-whales-and-bubbles-random-kick-design.md` (events + chaos dial slot in as the
  event layer).
- **Relates to:** ADR-127 (four kernel concerns), ADR-154 (effect-declaration algebra),
  ADR-176 (kernel minimality — still ZERO kernel change), ADR-027 (pack-on-published-substrate),
  the #214 board-runtime.

## 1. Why (the diagnosis)

The shipped wedge plays as **passive guessing**: you allocate cash against a market, but
nothing is *yours*, nothing you do *persists*, and no empire compounds under you. Monopoly is
fun despite heavy luck because you **acquire territory you own**, **develop it**, and watch an
**income engine compound**. The redesign swaps those three missing ingredients in — **agency**
(you build), **ownership** (cities are yours), **compounding** (the engine grows) — and drops
Monopoly's worst part (rent-on-landing: punished for bad luck) while keeping its best part
(developing an empire). Founder's framing: *"bring real estate in; a Monopoly-like race/luck;
no 'you pay if you come to me'; give the owner a standing income; buy a stock-market city and
build the market up in later rounds."*

## 2. The game (target design)

**One-line:** acquire iconic cities on a shared map, develop them into income engines, ride and
survive sector bubbles — richest empire at the bell wins.

### 2.1 The map (decided: shared city map, no pawn)

A shared board everyone sees of **iconic, pre-typed cities**, each belonging to a **sector**:
real-estate, stock-market, gold, crypto (later: bonds, startups). Reuses the **#214 board**
(cities = nodes, sector skins). A city has: sector, base acquisition cost, and a **development
level** (0 = undeveloped). Claiming cities = choosing your sector exposure; developing = growing
the engine. **No pawn / no movement** — the "race" is the wealth/tempo race, not positional.

### 2.2 The round (keeps secret simultaneous commit → resolve → reveal)

1. **Read** — the map (ownership + development levels), each sector's **market level + bubble
   fragility** (telegraphed), your cash, brewing events.
2. **Commit** (secret, simultaneous) — split your cash across, in **one combined commit**:
   **sealed bids** on cities you want · **develop** owned cities (level up) · optionally **sell**
   a city to de-risk. *Bid-cash is not develop-cash* — the central tension.
3. **Resolve** (substrate, deterministic, seeded):
   1. **Settle bids** — highest sealed bid wins each contested city (tiebreak rule, §5); winners
      pay + claim.
   2. **Apply developments** — owned cities level up; **aggregate development per sector inflates
      that sector's market level** (the whale/price-impact term — the deferred slice-2 mechanic,
      now the engine's inflation input).
   3. **Market + events** — each sector's market level updates (development-driven inflation +
      drift + the seeded shock/market-die); fire **event cards** (boom/crash/windfall) hitting
      sectors; **bubble-pop check** — a sector past its telegraphed fragility threshold pops →
      its market craters.
   4. **Pay income** — each owned developed city pays **standing income = base(level) +
      market-linked(sector market level × level) ± events** → cash.
4. **Reveal** — new map, market levels, who got paid what, net-worth moves (bids stayed hidden).
5. Repeat N rounds → **bell** → richest **net worth = cash + Σ city values** wins.

### 2.3 Income (decided: base + market + events)

- **Base** — a steady per-development-level yield (the "standing income" floor; the tycoon
  compounding feel).
- **Market-linked** — scaled by the city's sector market level (stock-market cities ride stocks,
  real-estate steadier, gold safe-haven, crypto wild). Driven by the shipped market-engine.
- **Events** — discrete dramatic cards (boom/crash/windfall) hitting sector types differently
  (a "crash" guts stock-market cities, barely dents real-estate). Dramatic + readable — directly
  fixes the wedge's "tiny calm wiggles." This is where the random-kick event deck + chaos dial land.

### 2.4 The bubble/pop — the soul + anti-snowball (decided: development inflates → pops)

Aggregate development in a sector **inflates its market level** (more market-linked income now)
but raises **fragility**; past a telegraphed threshold a **pop** becomes likely (seeded), and
when it pops the sector market craters → **the most-developed-there lose the most**. The leader
(most invested in the hot sector) is the most **exposed** = built-in anti-snowball, the literal
*"Whales & Bubbles / Overexposed."* No artificial catch-up needed.

### 2.5 PvP (decided: sealed bids)

Contested cities go to **sealed bids** committed secretly each round; highest bid wins
(tiebreak §5). Adds a bluffing/poker layer (overpay for the hot sector?) and a real opportunity
cost (bid-cash ≠ develop-cash). Skill-driven, fits the secret-simultaneous rhythm.

### 2.6 Skill vs luck (so it stays skill-dominant — D1 still holds)

Skill counters: diversify across sectors · sell/divest before a pop · read the telegraphed
fragility · don't overpay in bids · time developments. Luck: event cards + pop timing (seeded) +
rivals' hidden bids. The measurable **skill-dominance gate** from the random-kick design
(strong-vs-naive win-rate, seeded known-truth) carries over.

## 3. What survives vs changes (this is an EVOLUTION, not a rebuild)

**Survives wholesale:**
- Substrate plumbing — `SubstrateModule.forRoot`, RLS per game/owner, `kernel.event_log`,
  plan-tree, the derived-on-read net-worth pattern.
- The **#214 board** — cities as nodes + sector skins.
- The **market-engine math core** — the seeded shocks, regime, and **mean-reversion** survive
  (the **pop is a mean-reversion snap** over the existing math). NOTE: the **price-impact term
  was *deferred*, NOT built in the wedge** (E3 shipped with no price-impact); the redesign
  *activates* it as the development-driven inflation — so that term is **new engine work** (see
  Changes), not surviving code.
- The deterministic resolve + **bit-identical replay gate**.
- Zero kernel change (ADR-176) — all new representation is pack/engine + `metadata` JSONB.

**Changes:**
- **Data model** — `Order/Holding` → `City / Ownership / Development / Bid` (+ `SectorMarket`,
  `EventCard`). Long-only buy/sell of units → claim/develop/sell of cities.
- **api game loop** — submit-orders/resolve → submit-commit (bids+develop+sell)/resolve.
- **Engine — new work** — the **development-driven inflation term** (aggregate per-sector
  development → sector market level: the long-deferred price-impact mechanic) and the
  **fragility → pop** check. New engine inputs, built across R2/R3 — not carried from the wedge.
- **UI** — the allocation panel → a **city-map + bid/develop/sell panel + sector
  fragility/market gauges + the event reveal**.

## 4. Build path — incremental swap on the live domain (decided)

Each slice is one always-playable increment (a foundry work item / PR), evolving the shipped
domain. Founder's ordering:

| Slice | Swaps in | Always-playable result | Fun bet |
|---|---|---|---|
| **R1** | allocation panel → **city map + claim + develop**; cities for the 4 sectors incl. **real estate**; income = **base only** (steady, per level); uncontested claim (fixed/first-available, no bids yet) | A clean tycoon: claim cities, develop them, compound steady income, richest at the bell | Restores **ownership + building + compounding** — the biggest single jump |
| **R2** | **income layers** — market-linked yield (sector market level) + a few **event cards** | Income now swings with the market + dramatic events | Adds drama + the market-engine reconnects to income |
| **R3** | **bubbles** — development inflates the sector market → fragility → **pop**; telegraph + sell-to-de-risk | The Overexposed soul + anti-snowball | The identity mechanic; the strategic depth |
| **R4** | **sealed bids** — contested-city PvP | Real multiplayer-shaped contention (still solo-vs-AI, AI bids too) | The PvP tension |
| **Later** | full event deck + **chaos dial**, more sectors (bonds, startups), regime-aware AI, the what-if coach | — | breadth + replayability |

Each slice keeps `wave-standard` + `replay-determinism`; UI slices keep `a11y-AA`; the
skill-dominance gate attaches from R3 (once bubbles create the luck). Real estate ships in **R1**.

## 5. Open tuning questions (for the plan / playtest — not blockers)

1. **Pop trigger + telegraph** — threshold vs probabilistic-rising-with-fragility; how many
   rounds of telegraph; whether an event can force/delay a pop.
2. **Base vs market vs event weights** — the income mix per sector (real-estate heavy-base /
   low-swing ↔ crypto low-base / high-swing) and the chaos-dial scaling.
3. **Development curve** — cost + income per level; diminishing returns; a level cap.
4. **Bid tiebreak** — cash-on-hand, fewer-cities (catch-up), or a seeded coin (with reveal).
5. **City count + map** — how many cities per sector; are some cities better than others.
6. **Sell mechanics** — sale price (discount under a popping sector — the liquidity squeeze).
7. **Win/score** — city value formula = f(development level, sector market level) at the bell.

## 6. Non-goals (reaffirmed)

No rent-on-landing (the line the founder drew); no pawn/movement; no real-money/gambling; no
kernel change (ADR-176 — pack/engine + `metadata`); no multiplayer infra before the solo loop
is proven fun (async-by-cloud later). The substrate stays internal (Option A).
