---
product_key: whales-and-bubbles
charter_date: 2026-06-14
risk_tier: T0
greenlight_gate: 8de161e8-aede-439a-8343-3c148e7c2645
status: chartered
brief: docs/foundry/whales-and-bubbles/opportunity-brief.md
---

# Charter — Whales And Bubbles

> Authored at Gate 1 (founder greenlight, recorded via `foundry_gate_decide`,
> gate `8de161e8…` → **approved** 2026-06-14). The charter FIXES what downstream
> stages parameterize on; **changing the risk tier later is a new founder gate, not an edit.**

## Name & key

- **Name:** Whales And Bubbles — **bound here** (was founder-overridable through intake;
  the charter fixes it). Dossier working title was "Overexposed"; the founder selected
  "Whales And Bubbles" at intake.
- **Key / repo:** `whales-and-bubbles` → `de-braighter/whales-and-bubbles`,
  `domains/whales-and-bubbles`.
- **Pitch:** a digital, single-player-first economic strategy game — build a portfolio
  across crypto / gold / stocks (and later real estate / bonds / startups) while a living,
  seeded market booms and crashes; every round all players commit allocations in secret, the
  substrate resolves every flow at once deterministically, and the richest portfolio **at the
  bell** wins. The substrate is the invisible engine; the consumer game is the carrier.

## Risk tier

**T0 (prototype / demo / showcase).** Policy:

| Tier | Examples | Gates | Quality parameters |
| --- | --- | --- | --- |
| **T0** prototype/demo | markets, gridiron, **whales-and-bubbles** | greenlight + ship | wave standard, auto-merge OK |
| **T1** product | herdbook, exercir | + architecture approval | wave + `deep` effort on kernel-touching items, mutation thresholds enforced |
| **T2** regulated | oncology (MDR Class IIb) | + every kernel-touching ADR + designer-first mandatory | full battery, RLS/tenancy proofs required, no auto-merge |

**Why T0:** near-zero regulatory burden (synthetic world, **no real money** — gambling is a
non-goal — no PHI, no real market data in v1); contained blast radius (handles no real user
data, drives no regulated decision); **zero kernel change expected** (ADR-176 — pack/engine
territory). The brief's own framing is a *kernel-coverage + DX testbed with the game as the
carrier* — a prototype/showcase posture. A T1 product-grade battery would be miscalibrated
over-spend for a dogfood game with no external users.

**Promotion path (documented, not taken):** if the solo loop proves genuinely fun and a real
consumer go-to-market emerges, re-charter to **T1** — that is a **new founder gate, not an
edit to this file**. Until then, T0 holds and this charter is the tier authority.

## Scope (the wedge)

The narrowest valuable first slice — `market-engine` (slice 0) → minimal solo loop (slice 1),
collapsed into one vertical:

- **`libs/market-engine`** over **3 sectors — crypto + gold + stocks** (the cleanest bubble /
  hedge / growth triangle): sector price processes, seeded stochastic resolution. Pure
  `(state, committedOrders, seed) → (nextState, events[])`.
- **Bit-identical replay test as the acceptance gate** — the load-bearing reusable asset; it
  de-risks everything downstream (anti-cheat, tournaments, the what-if coach all ride it).
- **1 human + 1 naive AI**, **long-only** allocation, **bell + net-worth** scoring.
- **Minimal sector-map board UI** (the #214 board with a markets skin) including the
  **market-die reveal** (the random-kick's slice-1 layer — dramatizes the existing `σ·ε`
  shock; nearly free, adds a pulse without new outcome-luck).
- **Answers:** *"does allocating against a living, readable market feel good?"* — narrower
  loses the playable signal; wider pulls in the hard margin-cascade resolver prematurely.

## What NOT to build

Each line saves a future session from scope creep:

1. **No deep instruments in the wedge** — leverage, margin calls, cascades, shorting,
   cornering are slices 2–4, introduced *progressively*; the wedge is long-only.
2. **No kernel changes** — market-sim primitives, event decks, and fortune decks stay
   pack/engine + `metadata` JSONB; promote to the kernel **only** on demonstrated `markets` +
   `whales-and-bubbles` dual-demand (ADR-176 inclusion test, demand-driven, never speculative).
3. **No real-money / gambling** — explicitly out; this is the line that keeps regulatory ease
   at 5/5 and the tier at T0.
4. **No live real-market-data mode in v1** — a later optional mode; `markets` has the plumbing.
5. **No multiplayer infrastructure before the solo loop is proven fun** — async
   play-by-cloud is the eventual *first* MP step, still post-wedge.
6. **No cardboard / physical edition** — simultaneous stochastic resolution + margin cascades
   can't run on cardboard.
7. **No external substrate marketing** — Option A holds; what ships is a game.
8. **No pure-luck randomness** (random-kick design) — no random *movement*; no per-player luck
   that bypasses the skill counters; output randomness stays bounded by the luck-budget cap.

## Quality plan

Tier-derived obligations that become `qualityObligations` on queue items (F4 / `/build-path`
consumes these verbatim). T0 baseline + domain-specific gates:

- **`wave-standard`** — the standard verifier wave (`reviewer` + `qa-engineer` +
  `charter-checker`); auto-merge OK for individual items (T0 policy).
- **`replay-determinism`** *(the seeded-deterministic chain — `market-engine` + `ai-opponent`)*
  — the bit-identical seeded-replay test is a hard acceptance gate on every change in that chain
  (a non-deterministic AI breaks replay just as an engine change would); reproducibility is a
  *product feature* here.
- **`skill-dominance-gate>=65`** *(engine items, slice ≥ 2)* — a standing test: a strong policy
  beats a naive policy across many seeds with win-rate **≥ 65% at Standard** (and **> 50% at
  Party**). This is the *measurable* "not pure luck" guarantee from the random-kick design.
- **`a11y-AA`** *(game-ui items)* — WCAG 2.2 AA (design-system default; no AAA mandate — that's
  reserved for login/payment/booking, none of which the wedge has).
- **`rls-scoped-per-game`** *(api / persistence items)* — game state + event log scoped per
  game/owner via `SubstrateModule.forRoot` + `GucPrismaRunner` (defense-in-depth; cheap, not
  the heavy T2 RLS-proof battery).
- **Designer-first (internal discipline, not a founder gate)** — the `market-engine` (sector
  processes, price-impact, the margin-cascade fixed-point resolver, the §6 math) is the crown
  jewel and the hardest engineering. The margin-cascade resolver itself lands in the
  **slice-2+ engine item, not the wedge** (see Scope + What-NOT-to-build); the engine items
  should carry a designer-first spec + `deep` effort even though T0 does not mandate a founder
  architecture gate.

## Gate schedule

Per the T0 row (**greenlight + ship**):

- **Greenlight gate** — ✅ **approved** 2026-06-14 (`8de161e8…`).
- **No architecture gate** — T0 does not require one (it attaches only on a future T1+
  promotion). The market-engine's complexity is handled by the designer-first discipline above,
  not a founder gate.
- **Ship gate** — a founder ship gate at the end of the **wedge** (slice 0 + slice 1 playable:
  deterministic engine + replay test green + the minimal solo loop) before it is considered
  shippable/showable. Individual work items within the wedge auto-merge under `wave-standard`.
- **Re-charter gate** — a T0→T1 promotion (if a consumer GTM emerges) is a *new* founder gate.

## Repo plan

- **Repo:** `de-braighter/whales-and-bubbles` (new domain).
- **`/new-domain` scaffold tiers:** spine + pack + api + inference + ui —
  - `libs/market-engine` (domain-pure spine, zero NestJS — the deterministic simulator),
  - `libs/game-contracts` (typed entities + Zod: Sector, Holding, Order, Player, RoundState,
    Objective, GameConfig, MacroEvent, FortuneCard, ChaosMode),
  - `libs/ai-opponent` (policy(ies) consuming the inference backbone — the **inference** tier),
  - `api` (NestJS on `SubstrateModule.forRoot` — game lifecycle, round resolution, persistence
    + event log; the **db** tier),
  - `libs/game-ui` (Angular standalone + signals — the **ui** tier; #214 board + markets skin).
- **Packages consumed (published, ADR-027 — not relative paths):**
  `@de-braighter/substrate-contracts`, `@de-braighter/substrate-runtime`, design-system
  bricks + tokens. Reuses the `domains/markets` (feed → `event_log`), `domains/scenario-lab`
  (known-truth validation + §11-style gate), and #214 board-runtime patterns.
- **Build vehicle:** foundry `/build-path` (this charter → claimable, scope-disjoint work
  items; the random-kick layers ride the slice ladder as slice-1/2/4 items).
- **Scaffold note:** new domains need the `MAX_PATH`-workaround `.npmrc` (long Windows paths);
  carry it from the markets/agri reference runs.
