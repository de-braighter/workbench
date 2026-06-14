---
product_key: whales-and-bubbles
source: docs/ideas-inbox/overexposed-economic-strategy-game.md
intake_date: 2026-06-14
status: intake
---

# Dossier Record — Whales And Bubbles (next-gen economic strategy game)

> **Name note:** the founder bound the product name to **Whales And Bubbles**
> (key `whales-and-bubbles`) at intake, selecting from the dossier's open name set
> (Overexposed / Whale / Bull Run / Margin — §8.1). "Whales & bubbles" is the dossier's
> own term for the D3 market-impact PvP engine. The source asset retains its original
> `overexposed-` filename (the immutable inbox name); the key stays founder-overridable
> until the charter binds it.

> **Design amendment (2026-06-14) — the random "kick".** Post-intake, the founder reopened
> **D2** ("no dice") to add a random element "without making it a pure-luck game." Approved
> design: `../../superpowers/specs/2026-06-14-whales-and-bubbles-random-kick-design.md`.
> Net: **D2 amended** (sector map keeps *no random movement*, but adds layered, seeded,
> telegraphed market randomness — macro market events + a market-die reveal + per-player
> opportunity/fortune cards — all skill-counterable and luck-budget-capped, scaled by a
> **chaos dial** Tournament/Standard/Party). **D1 preserved** (low-pure-luck is enforced by
> the Tournament-mode floor + a *measurable* strong-vs-naive skill-dominance gate, ≥65% at
> Standard). Bonus: the opportunity cards as *optional* instruments are conditional plan-tree
> branches — they patch the plan-tree-depth soft spot flagged below. The randomness rides the
> existing slice ladder (die-reveal @ slice 1 · events + dial + gate @ slice 2 · fortune
> cards @ slice 4). See the design note for the input-vs-output-randomness model and §10 tuning Qs.

## Essence

**Whales And Bubbles** (dossier working title "Overexposed") is a proposed new substrate
domain (`domains/whales-and-bubbles`, working name): a digital, **single-player-first
economic strategy game** that keeps only
Monopoly's *idea* (acquire assets, accumulate wealth, push opponents) while discarding
its skeleton (dice, loop-track, elimination, real-estate-only). Players build a
**portfolio** across real estate / stocks / crypto / gold / bonds / startups while a
living, simulated market booms and crashes; every round all players **commit allocations
in secret**, the substrate **resolves every flow at once deterministically**, and the
richest portfolio **at the bell** (a fixed round count) wins. Critically, the dossier
asks for it to be judged **not as a consumer game but as a kernel-coverage + developer-
experience testbed** — a fast-feedback, known-ground-truth, dense-event domain that
exercises all four kernel concerns end-to-end where the slow regulated domains (oncology)
structurally cannot.

Core claims:

- **Clean-room legality** — Monopoly's mechanics aren't copyrightable; only Hasbro's exact
  board art, names, and trademark are. A clean-room economic game is open ground.
- **Composition, not invention** — it stitches three proven cluster assets:
  `domains/markets` (live price feed → `kernel.event_log` + inference), `domains/scenario-lab`
  (domain-agnostic known-truth stochastic world + inference), and the **#214 board-runtime**
  (domain-free spatial board with a skin system → a "markets skin").
- **Zero kernel change expected** — the market sim, instruments, rules, and AI policy are
  pack/engine territory (typed libs + `metadata` JSONB) under ADR-027 / ADR-176; promotion
  only on demonstrated multi-domain demand (markets + overexposed both needing a primitive).
- **The four kernel concerns ARE the game** — strategy = plan tree (ADR-154 effect
  declarations); market resolution = the observation/event log; the AI opponent = a planner
  under uncertainty over a known-truth world (ADR-203); seed + run-manifest = bit-identical
  replay (anti-cheat, tournaments, the what-if coach).
- **Honest soft spots are named up front** — the *plan-tree* concern gets only a light
  workout unless structured multi-step instruments + a counterfactual branch-tree are
  deliberately designed in; and a *synthetic* world validates the kernel's plumbing/DX, not
  the messy-real inference problems (bias, provenance, terminology, regulation).
- **Emergent anti-snowball** — the leader is the most invested, hence the most *exposed*;
  crashes hurt them most, so the market itself is the rubber-band (no artificial catch-up).
  This is the source of the working title.

## Domain-model hints

Raw ore for the build-path designer (F4). All citations are to the single asset
`assets/overexposed-economic-strategy-game.md` (section refs are that file's headings).

**Entities** (§5 architecture sketch + §3 game design):

- `Sector` / exchange node — has a price process and "personality"; the six proposed:
  real estate (illiquid, steady yield), stocks (liquid, cyclical, dividends, shortable),
  crypto (high-vol, hype/rug, thinnest depth), gold/commodities (safe-haven,
  anti-correlated), bonds/cash (low fixed yield, liquidity), startups (build→grow→IPO into
  stocks). (§3.1)
- `Holding` — a player's position in a sector (incl. short positions, leveraged positions).
- `Order` — per-sector commit: buy / sell / short / hold + size + leverage + limit/stop. (§3.2)
- `Player` — human or AI; carries cash, exposure, margin headroom, hidden objective(s).
- `RoundState` — prices, regime, exposures, margin headroom per round. (§5 `game-contracts`)
- `Objective` — secret objective card drawn per player (corner a sector, survive a crash
  solvent, highest CAGR, biggest single winning trade). (§3.4)
- `GameConfig` — round count (bell), sector set, parameters. (§5)
- `Regime` — hidden market state (bull / bear / crash / recovery) shifting μ, σ, Σ. (§6)
- `MacroEvent` / event deck — *random-kick design*: telegraphed shared shock (boom / crash /
  black-swan / sector-news); the news ticker raises its odds, the seeded draw fires it; moves
  everyone's market. (kick design §3)
- `MarketDie` — *random-kick design*: the per-round `σ(regime)·ε` shock surfaced as a visible
  "volatility / market-mood" reveal (the tactile ritual); shared, bounded. (kick design §3)
- `FortuneCard` / `OpportunityCard` — *random-kick design*: per-player draw, mostly an *option*
  (hot tip = private signal, credit-line = optional leverage, insurance discount, discounted
  asset block) + small rare direct windfalls. (kick design §3)
- `ChaosMode` (Tournament / Standard / Party) + `luckBudget` cap — *random-kick design*:
  run-manifest parameters scaling event frequency, shock σ, fortune-card power, and the
  output-luck cap across all layers at once. (kick design §4)

**Events** (append-only log — "flat the observation", §4):

- Per-round market resolution: price moves, fills, **margin calls** (forced liquidations),
  regime flips, cornering fees, dividends/yield. (§3.2, §4)
- Regime transitions are themselves seeded events appended to the log. (§6)
- *random-kick design*: macro-event draws/fires, market-die reveals, and fortune-card
  draws/plays are all seeded observations appended to the log → a denser event stream. (kick design §6)

**Interventions** (the plan tree — "recurse the plan", §4):

- Typed capital-deployment decisions over rounds: `deploy capital → sector S`, `lever 2×`,
  `short S` — modeled as ADR-154 **effect declarations**; aggregated player flows = a
  `composeEffects` over those declarations. (§4)
- Structured/nested instruments (build→grow→IPO, conditional/leverage chains) are the
  *design lever* that turns the shallow plan-tree leg into a deep one. (§1 caveats, §3.3)
- *random-kick design*: **optional** fortune/opportunity instruments + conditional "play if X"
  decisions are genuine nested/conditional plan-tree branches — the kick design **pulls the
  design lever**, deepening the tree the dossier flagged as shallow. (kick design §6)

**Decisions / mechanics** (the engine core, §6 + §3.3):

- Market math: `Δlog P_s = μ(regime) + θ_s·(log P̄_s − log P_s) + impact(F_s) + σ(regime)·ε_s`,
  with concave square-root-law price impact `impact(F_s)=λ·sign(F_s)·(|F_s|/depth_s)^α`,
  α∈(0,1); seeded multivariate-normal shocks with cross-asset correlation Σ. (§6)
- **Margin-cascade fixed-point resolver** — forced sells re-enter the flow for a second-order
  kick; iterate to a fixed point; deterministic given seed + committed orders. (§3.3, §6)
- Turn structure (§3.2): Read → secret simultaneous Commit → deterministic Resolve →
  Reveal → repeat N rounds → bell → net worth + secret-objective bonuses → winner.
- AI opponent difficulty seam: naive momentum → regime-aware → flow-anticipating (models
  other players); the AI's "brain" is the substrate inference engine. (§3.5, §5 `ai-opponent`)
- Post-game **what-if coach** — counterfactual replay (the exercir what-if/counterfactual
  lane repurposed as a teacher); **never an in-game oracle**. (§3.5)

## UI-prototype artifacts

**None.** The dossier is a single text/markdown design capture — no mockups, SVGs, decks,
or frontend prototypes are attached. §5 *describes* a planned `libs/game-ui` (Angular
standalone + signals): the sector-map board (the #214 board with a markets skin), a
secret-commit allocation panel, reveal/animation of price moves and cascades, a net-worth +
own-objective HUD, and the post-game what-if view — but these are written intentions, not
artifacts the UI-surface planner can mine directly. The build-path UI plan will be derived
from these prose descriptions, not from existing mockups.

## Market signal

All claims below are the **founder's untested hypotheses**, recorded verbatim-ish from the
dossier — not validated demand. Notably, the dossier **deliberately disclaims a
consumer-market thesis** and asks the opportunity-brief to score it on a different axis:

- **Primary value axis (explicit):** "judge it on how much kernel surface it exercises and
  how fast it lets us iterate kernel ergonomics, with the consumer game as the carrier, not
  the thesis." Positioned as a **kernel-coverage + DX testbed**, not a market play. ("Why
  build this now — the kernel-coverage bet")
- **Buyer / consumer framing (carrier only):** aimed at "hobbyist strategy players" who
  "respect" a deep, low-luck, no-elimination strategy game; explicitly "not a Monopoly
  clone," closer to a portfolio/euro strategy game with a market-microstructure engine. (§1)
- **Secondary adjacency:** a real but non-primary **financial-literacy** opportunity — "the
  game secretly teaches portfolio thinking" via the what-if coach. (§3.5)
- **Pricing / buyers / willingness-to-pay:** **not addressed.** No pricing, no named buyer
  segment, no competitor/market-size analysis is offered.
- **Explicit non-goals (v1):** physical/cardboard edition; real-money play/gambling;
  live real-market-data mode; full multiplayer before the solo loop is proven fun; marketing
  the substrate externally (Option A — substrate stays internal; what ships is a game). (§9)

## Asset manifest

| Asset | Type | What it is |
| --- | --- | --- |
| `assets/overexposed-economic-strategy-game.md` | Markdown (idea dossier, ~21 KB) | The complete brainstorm capture: framing, the Gate-1 kernel-coverage bet + honest coverage map, the 8 brainstorming decisions (D1–D8), full game design (board/sectors, round loop, instruments, win condition/objectives, the three AI roles), substrate mapping to the four kernel concerns, architecture sketch (5 libs + api), the proposed market-math model (§6), the slice ladder (0→6→later), 6 open questions, and v1 non-goals. |

**Nothing-lost check:** manifest rows = **1**; source files = **1**. ✅ Match.

## Open questions

Carried from the dossier's own §8 "Open questions" plus gaps stage 2 (opportunity-brief)
will need to resolve:

1. **Name binding** — ~~Overexposed vs Whale / Bull Run / Margin~~ → **resolved at intake:
   founder chose "Whales And Bubbles"** (key `whales-and-bubbles`). Remaining: the final
   `domains/<name>` binds at the charter; the key stays founder-overridable until then
   (§8.1). The source asset keeps its original `overexposed-` filename (immutable inbox).
2. **First sectors** — dossier recommends crypto + gold + stocks (bubble / hedge / growth
   triangle) for slices 0–2; to confirm. (§8.2)
3. **Market-math parameters** — the §6 model's constants and the fun-vs-realism balance
   (parameter ranges; whether fundamentals `P̄_s` drift; how cornering modifies
   `depth_s`/fees). Open and balance-critical. (§6, §8.3)
4. **Objective deck** — the starting set of secret objectives and their scoring. (§8.4)
5. **AI difficulty seam** — how the three tiers (naive → regime-aware → flow-anticipating)
   are expressed and selected; how the AI estimates regime cheaply. (§3.5, §6, §8.5)
6. **Build vehicle** — hand-built slices vs a foundry `/build-path`; the dossier flags it as
   a strong foundry candidate (clean, well-scoped new domain). (§8.6)
7. **Opportunity-brief scoring axis** — the dossier explicitly argues it must be scored on
   kernel-coverage + DX value, **not** consumer-market moat; stage 2 should confirm which
   rubric posture applies and how the "synthetic ≠ messy-real" caveat is weighed.
8. **Plan-tree depth decision** — ~~whether deep plan-tree exercise is a goal~~ → **leaning
   resolved by the random-kick design**: the optional fortune/opportunity instruments +
   conditional "play if X" decisions deepen the tree on purpose; the counterfactual branch-tree
   still rides the what-if coach (slice 5). (§1 caveats; kick design §6)
9. **Random-kick tuning** (*new, from the kick design*) — luck-budget cap value, macro-event
   deck + telegraph lead-times, fortune-card deck + draw cadence, the skill-dominance gate
   thresholds (strong-vs-naive policy pair), and the telegraph/market-die readability UI. See
   `../../superpowers/specs/2026-06-14-whales-and-bubbles-random-kick-design.md` §10.
