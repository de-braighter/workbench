# Whales And Bubbles — the random "kick" design

- **Date:** 2026-06-14
- **Status:** design — approved in brainstorm, awaiting spec review → implementation plan
- **Product:** `whales-and-bubbles` (foundry; T0, greenlit 2026-06-14, gate `8de161e8…`)
- **Amends:** the dossier decisions **D2** (reopened) and clarifies **D1** in
  `docs/foundry/whales-and-bubbles/dossier-record.md` (source asset
  `assets/overexposed-economic-strategy-game.md`)
- **Relates to:** ADR-127 (four kernel concerns), ADR-154 (effect-declaration algebra),
  ADR-203 (inference ← observation log), the §6 market-math model in the dossier,
  `domains/scenario-lab` (known-truth validation), `domains/markets` (feed → event_log)

## 1. Problem

The dossier's **D2** chose a sector map with *"no dice, no random movement"* and **D1**
positions the game as *"a genuinely great strategy game (depth-first; low pure-luck)."* The
founder asked to **re-add dice / a random element to give the game a kick** — and, when
asked what the kick is *for*, answered: **a mix of all of it (drama, upsets, the tactile
roll, personal fortune) — but without overusing it or making it a pure-luck game.**

The design tension is **only** with D1 (low pure-luck), **not** with reproducibility: the
§6 market engine is already a *seeded* stochastic process, and seeded randomness is
deterministic for replay (anti-cheat / tournaments / the what-if coach) while still feeling
surprising in play. So the task is to add felt randomness that **keeps skill the dominant
determinant of who wins.**

## 2. The governing idea — input vs output randomness

The lever that makes "all the layers, still skill-dominant" coherent:

- **Input randomness** happens **before** a player decides and shapes the situation they
  then play skillfully (a crash they can hedge; a tip they choose how to use). It adds drama
  *and rewards* skill.
- **Output randomness** happens **after** the decision and directly sets the result (a die
  that just hands you money). It is the swingy "pure luck" feel.

**Spine (three rules every random source obeys):**

1. **Mostly input, rarely output** — random events happen before commit far more than after.
2. **Every random hit has a skill counter** — diversify · hedge with gold · hold
   cash/liquidity · buy insurance · choose-not-to-act.
3. **A luck budget caps the swing** — per game, the aggregate magnitude of *output* luck
   (direct windfalls/penalties + unhedgeable shock beyond the regime baseline) is capped
   (≈ ≤ 15% of the typical net-worth spread at Standard); the engine tapers further output
   luck as it approaches the cap.

## 3. The four layers (all seeded → reproducible)

| Layer | Grain | Type | The kick | The skill counter |
|---|---|---|---|---|
| **Macro market events** | shared | input (telegraphed) | A news ticker raises the odds of a boom / crash / black-swan; the seeded draw resolves whether it fires; it moves *everyone's* market. | React first — hedge, de-risk, rotate to gold/cash before it lands. |
| **Market die** | shared | bounded output | The round's `σ(regime)·ε` shock shown as a visible "volatility / market-mood" reveal — the tactile ritual moment. | Position for the regime's known volatility band; hold uncorrelated assets. |
| **Fortune / opportunity cards** | per-player | mostly input | Draw an *option*: hot tip (private signal about a sector), credit-line offer (optional leverage), insurance discount, discounted asset block; plus small, rare direct windfalls/penalties as seasoning. | It is an *option* — value only if played well; a leader who draws one is tempted into more exposure (on-thesis). |
| **Upset / comeback** | — | emergent | **Not a separate mechanic.** Emerges from macro crashes punishing the *overexposed leader* (the existing anti-snowball) + trailing players' opportunity cards. | — |

**Symmetry is the key to skill-preservation:** the two big layers (events, market die) hit
the **shared** market, so the skilled/diversified/hedged player benefits and the overexposed
leader is punished — exactly the "Overexposed / whales & bubbles" thesis. Per-player luck is
confined to the **opportunity** layer, which is mostly *input* (you choose how to use it).

## 4. The chaos dial (packaging)

One selector scales the variance of all four layers at once; same engine throughout:

| Mode | Feel | Role |
|---|---|---|
| **Tournament** | minimal / seeded, near-pure-skill | The **D1 "low pure-luck" floor**; preserves the reproducible-tournament + anti-cheat thesis pristine. |
| **Standard** | moderate | The default feel. |
| **Party** | big events, more fortune cards, looser luck budget | Upsets likely; the casual/party crowd. |

The dial scales: macro-event frequency, shock `σ`, fortune-card power/frequency, and the
luck-budget cap. It is a **run-manifest parameter** (so a replay reproduces the exact mode).

## 5. The round loop with the kick

1. **Read** — current market + **news ticker** (telegraphed event odds) + your fortune-card hand.
2. **Commit** (secret, simultaneous) — allocations (buy/sell/short/hold + leverage + orders)
   **and** which fortune options you play or hold.
3. **Resolve** (substrate, deterministic, seeded) — fire macro events → apply the market die
   → aggregate player flows + price impact → margin-cascade fixed point → apply fortune-card
   effects; everything bounded by the luck-budget cap.
4. **Reveal** — new market + the event/die outcomes + everyone's net-worth move; objectives
   stay hidden.
5. Repeat for N rounds → bell → net worth + secret-objective bonuses → winner.

## 6. Substrate mapping — the kick *strengthens* the showcase

- **Flat the observation (event log)** — every event draw, die roll, and fortune card is an
  appended observation → a denser, richer log (more event-sourcing pressure, the good kind).
- **Reproducibility** — all draws come from the seeded RNG stream; replay stays bit-identical;
  the chaos mode + seed are run-manifest parameters.
- **Recurse the plan (the brief's identified weak leg)** — optional fortune instruments and
  conditional "play if X" decisions are genuine **nested / conditional branches** in a
  player's plan tree (ADR-154 effect declarations that may or may not be added). This is the
  structured-instrument depth the opportunity-brief flagged as the *shallow* concern — **the
  kick patches it.**
- **Inference** — macro events are regime signals the AI opponent and the what-if coach reason
  over (ADR-203); the coach sharpens ("you ate a crash here — a hedged line survives it").

## 7. The "not pure luck" guarantee is *measurable* (the real guardrail)

Because the market is **generated + seeded** (the `scenario-lab` known-truth shape), we do
not *hope* the game is skill-dominant — we **measure** it and gate on it:

- Run a **strong policy vs a naive policy** head-to-head across many seeds.
- Require the strong policy's win-rate to stay **above a threshold** (target ≈ **≥ 65% at
  Standard**) — a **standing engine test / gate**.
- Party mode's floor is **still > 50% skilled-wins** (luck may upset, but skill is never a
  coin-flip).

This turns "without making it a pure-luck game" from a vibe into a tested property per chaos
setting — and is itself another substrate-showcase win (known-truth validation, the §11-gate
lineage).

## 8. Slice-ladder impact (progressive, rides the existing ladder)

| Slice | Random layer added | Rationale |
|---|---|---|
| **1** (the wedge) | **Market-die reveal** only | Nearly free — dramatizes the `σ·ε` already in the engine; gives the wedge a pulse without new outcome-luck. Still answers "does allocating against a living, readable market feel good?" |
| **2** | **Macro market events** + the **chaos dial** + the **skill-dominance gate** | Events amplify the bubble/crash drama already being tested here (alongside shorting + price-impact); the dial + gate go live once there are ≥ 2 layers to scale. |
| **4** | **Fortune / opportunity cards** | Same hidden-info / bluffing layer as the hidden objectives landing in slice 4. |

## 9. Decision deltas

- **D2 — amended (not reverted).** The sector map keeps **no random *movement*** (Monopoly's
  pure-luck "where do I land" stays gone). It **adds layered, seeded market randomness + visible
  reveals**: telegraphed macro events, a market-die reveal, and per-player opportunity cards —
  all skill-counterable and luck-budget-capped. New phrasing: *"sector map; no random movement;
  structured, telegraphed, seeded random markets + events with a market-die reveal; skill-
  counterable and luck-budget-capped."*
- **D1 — preserved and made enforceable.** Low-pure-luck is now *protected by construction*:
  the Tournament-mode floor + the measurable skill-dominance gate (§7). D1 is not softened.

## 10. Open questions (tuning — for the plan / playtest, not blockers)

1. **Luck-budget cap value** — the ≈15% (Standard) figure and how the dial scales it across
   Tournament/Party.
2. **Macro-event deck** — the starting set (boom/crash/black-swan/sector-news), their telegraph
   lead-time, and probabilities per regime.
3. **Fortune-card deck** — the starting opportunity set, draw cadence, and how "small rare direct
   windfalls" are bounded inside the luck budget.
4. **Skill-dominance thresholds** — the exact ≥65%/>50% gates and the strong-vs-naive policy pair
   used to measure them.
5. **Telegraph UI** — how the news ticker communicates rising event odds readably (a later
   `game-ui` concern; candidate for the visual companion at UI-design time).
6. **Market-die readability** — how the die/mood reveal maps to the regime's `σ` band so skilled
   players can anticipate without it being deterministic.

## 11. Non-goals (unchanged from the dossier, reaffirmed)

Real-money/gambling stays out (the line that keeps regulatory-ease at 5/5); no per-player luck
that bypasses the skill counters; no random *movement*; no kernel changes (the market-sim,
event decks, and fortune decks are pack/engine territory + `metadata` JSONB, promoted to the
kernel only on demonstrated `markets` + `whales-and-bubbles` dual-demand, per ADR-176).
