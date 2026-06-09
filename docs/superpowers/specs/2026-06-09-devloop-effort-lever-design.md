# devloop — the `effort` lever: "what effort buys what outcome, model held constant" (design)

> Extends the twin ritual so that, since we usually work with the **same model**, we can
> attribute outcome differences to **effort** rather than model. A self-declared,
> process-anchored `Effort:` tier rides on the existing `ProducerAttributed` event and
> becomes **one new lever** in the existing `whatIf` engine. Reuses the whole
> inference + confound-honesty path; builds no new subsystem.

## Context — what already exists (don't re-derive)

The delivery what-if engine (`domains/devloop/src/inference/whatif.ts`, M2 design
`docs/m2-sdlc-counterfactual-design.md`) already does the structural work this idea needs:

- it stratifies an **indicator** (`cycle-time`, `cleanliness`) by a **lever** within a
  **subject (repo)**, fits per-stratum posteriors, and computes the Δ;
- it is **honest by construction**: thin strata (`< MIN_N = 5` PRs) are excluded;
  non-temporally-overlapping strata return `conclusive = false` with a "confounded by TIME"
  warning; it conditions on `repo` to kill the repo-mix (Simpson's-paradox) confound.
- supported levers today: `model`, `provider`, `producer`, `skill:<name>`, `change-type`,
  `author` (`leverValues()` in `whatif.ts:84-104`).

The producer-attribution event (`ProducerAttributed.v1`, `events.ts:33`) already carries
`{ repo, pr, producer, model, skills? }`, parsed from a PR-body `Producer:` line by
`parseProducer()` (`ingest/github.ts:40-49`).

**The gap:** nothing in the log records a *dose of effort*. `skills` proxies *approach*;
`model` is held roughly constant in practice. There is no "how much process did this PR get".

## Decisions (settled in brainstorming 2026-06-09)

1. **Effort = self-declared tier**, not a harvested objective dose. A new `Effort:` line in
   the PR ritual, sibling to `Producer:` / `Effect:`. Cheapest; captures intent; works on
   any repo today; honest about being subjective.
2. **Tiers are anchored to process facts** (`light | standard | deep`), documented in
   `CLAUDE.md`, so a tier means the same thing across PRs and across time (avoids the
   era-drift that caused the `opus-4-7`/`opus-4-8` Simpson's paradox to hide).
3. **Confound defense for slice 1 = warn-only.** The lever ships with an always-on
   operator-choice warning; change-type conditioning and randomization are **named as
   deferred upgrades**, not built (mirrors M2's S1→S4 staging).

## Why this is honest, not vanity

- **"Same model often" is the control, not a limitation.** M2's central anxiety is
  confounding. Holding the model fixed removes one dominant confounder for free — this lever
  is the disciplined "vary effort with model held constant" comparison.
- **The known way it could lie — and the guardrail.** Effort is **endogenous to difficulty**:
  we spend `deep` on the scary changes, so the raw read will tend to show "deep → *more*
  findings + *longer* cycle-time" (difficulty driving both knobs, not effort). Slice 1 does
  **not** silently produce that misleading Δ — it always attaches the operator-choice warning
  and points at the deferred de-confounders. The engine's existing `repo` conditioning and
  temporal-overlap → `INCONCLUSIVE` guard apply unchanged.

## The model

| Element | Value |
|---|---|
| Subject | repo (unchanged — controls the repo-mix confound) |
| New lever | `effort` ∈ `{light, standard, deep}`, read from `ProducerAttributed.effort` |
| Indicators | `cycle-time`, `cleanliness` (unchanged; both already supported) |
| Counterfactual | within repo R, indicator Z by effort tier → per-tier posterior + Δ, **with** the operator-choice warning |

## Anchored tiers (the `CLAUDE.md` reference table)

Self-declared; pick the row matching what the PR **actually got**:

| Tier | Anchor |
|---|---|
| `light` | single pass, no verifier wave |
| `standard` | verifier wave (reviewer + qa-engineer + charter-checker) |
| `deep` | wave + designer-first spec **and/or** ≥2 review rounds |

Non-gating, exactly like `Effect:` — omit the line and the PR sits out the effort lever.

## Component changes (exact seams)

### 1. Event schema — `domains/devloop/src/events.ts`

Additive **optional** field on the existing `Producer` schema (line 33):

```ts
const Producer = z.object({
  repo: z.string(), pr: z.number().int(), producer: z.string(), model: z.string(),
  skills: z.array(z.string()).optional(),
  effort: z.enum(['light', 'standard', 'deep']).optional(),  // ← new
});
```

The `producer()` constructor already does `Producer.parse(i)`, so `effort` flows through
with no other change. **This is an additive optional field on a `.v1` event → backward-
compatible schema evolution, NOT a version bump** — old producer events and external-org PRs
parse unchanged (absent `effort` → `undefined`).

### 2. Ritual parse — `domains/devloop/src/ingest/github.ts`

Add an `EFFORT_RE` and read it inside `parseProducer()` (lines 40-49), setting `effort` on
the `producer()` call alongside `skills`. Left-anchored like `PRODUCER_RE` so substrings
can't fabricate a value:

```ts
const EFFORT_RE = /(?:^|\s)Effort:\s*(light|standard|deep)\b/i;
// inside parseProducer, after skills:
const effort = EFFORT_RE.exec(body)?.[1]?.toLowerCase() as Effort | undefined;
return producer({ repo, pr, producer: m[1]!, model: m[2]!, skills: …, effort, ts });
```

Effort is producer provenance, so it is only captured when a `Producer:` line is also
present (no producer event → nothing to attach effort to). Acceptable and consistent: the
effort lever reads `PRODUCER` events, so an effort-without-producer PR could never be placed
anyway.

### 3. The lever — `domains/devloop/src/inference/whatif.ts`

In `leverValues()` (lines 84-104), treat `effort` as a producer-derived lever that places a
PR **only when `p.effort` is defined** (undefined → PR not placed → falls into the existing
`placed < obs.size` "lack a '<by>' attribution" warning):

```ts
// recognised lever
if (by === 'effort') { if (p.effort) values.set(p.pr, p.effort); continue; }
```

Then, in `whatIf()`, an **always-on** warning whenever `by === 'effort'`:

> ⚠ effort is operator-chosen — harder changes draw deeper effort; Δ may reflect
> **difficulty**, not effort. Condition on change-type (deferred) or randomize (deferred)
> for a causal read.

Everything else is reused unchanged: `MIN_N` thin-stratum exclusion, temporal-overlap →
`INCONCLUSIVE`, best-first ordering, the Δ.

### 4. CLI help — `domains/devloop/src/cli.ts`

`showWhatIf()` already passes `by` straight through. Only the usage string (line 110) and
top-level help need `effort` added to the lever list. No structural CLI change.

## Out of scope (YAGNI — named upgrade path)

- **Change-type conditioning** (`hold: change-type` double-stratification) — the real
  de-confounder. Deferred until the single-stratified lever shows signal worth de-confounding
  (thin-strata math makes it mostly `INCONCLUSIVE` on today's PR volume).
- **Randomization habit** (M2 S4) — a *behavior* (deliberately mismatch effort to difficulty
  on comparable tasks), layered on later; the only path to a genuinely causal claim.
- **`byEffort` in `calibration.ts`** — answers a *different* question ("does effort improve my
  *prediction accuracy*?") vs this lever ("does effort improve *outcomes*?"). Out of scope.

## Slice plan (TDD, ~half a day)

1. **Schema** — `effort` on the `Producer` zod schema + `Effort` type export; the `producer()`
   constructor carries it. *Test:* validates each tier, rejects junk, optional/absent → undefined.
2. **Parse** — `EFFORT_RE` in `parseProducer()`. *Test (`effort-parse`):* parses each tier
   (case-insensitive), absent line → `effort` undefined, invalid value → undefined, no
   `Producer:` line → no event.
3. **Lever** — `effort` in `leverValues()` + operator-choice warning in `whatIf()`. *Test:*
   stratifies cycle-time/cleanliness by effort within a repo; undeclared PRs excluded (and
   counted in the existing warning); thin-stratum exclusion and temporal-overlap → INCONCLUSIVE
   still fire; the operator-choice warning is always present for `by:effort`.
4. **Docs** — anchored-tier table + `Effort:` line in the `CLAUDE.md` ritual section
   (next to `Producer:`/`Effect:`); add `effort` to the M2 design doc lever table and the
   `whatif` CLI lever-list strings.

## PR ritual example (after this ships)

```
Producer: orchestrator/claude-opus-4-8 [brainstorming]
Effort:   deep
Effect:   cycle-time 0.01±0.02 expert
```

```
$ devloop whatif de-braighter/devloop cleanliness effort
WHAT-IF — de-braighter/devloop · cleanliness · by effort   (conditioned on the repo …)
  deep      n=7  point=0.34  …
  standard  n=9  point=0.71  …
  ⚠ effort is operator-chosen — harder changes draw deeper effort; Δ may reflect
    DIFFICULTY, not effort. Condition on change-type (deferred) for a causal read.
```
