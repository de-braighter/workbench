# Case Study: Effort Embodied in the de-braighter Cluster

> What one founder, amplified by Claude and a maturing process layer, shipped across
> the de-braighter cluster — measured, cross-checked, and audited against its own cost.

| | |
|---|---|
| **As of** | 2026-06-24 |
| **Scope** | All 18 cluster repos (workbench + 5 layers + 12 domains) |
| **Status** | Measured artifact — reproducible (see Appendix) |
| **One-line claim** | The repos embody a **conservative floor of ~38 person-years** of effort, built in **~6 weeks** of concentrated work, at **15–150× cost efficiency** that survives a hostile audit. |

---

## 1. TL;DR

- **18 repos**, **~2,200 commits**, **~1,300 merged PRs**, **272 ADRs** (architecture decision records), **652 spec/concept docs**, **48 skills + 23 agents**.
- **~1.05M authored lines** (~658k code, ~366k prose, ~25k structured data) — plus ~181k generated lockfiles → ~1.4M tracked.
- **More than a third of everything authored is prose** — design reasoning, not code. The "not only code" claim is now a number.
- **Conservative human-effort floor: ~38 person-years.** The standard parametric model (COCOMO) puts the realistic figure at **120–360 person-years**.
- **Economics, audit-proof:** even discounting output 10× *and* charging full freight for the founder's own quarter, it lands at **15–150× cost efficiency**. The headline-grabbing 1,000×+ number needs the subscription-only framing and should not be used.

The honest framing is **not** "AI did 38 years of work for \$600." It is: **AI turned one expert into a team's worth of output**, at a cost dominated by that one expert's own time. The amplifier did its work *because* the base — the founder's expertise plus the blueprints, ADRs, and verifier-wave around the AI — was strong.

---

## 2. Method & a note on honesty

Every number here was measured from `git`, not estimated, except the effort and cost models in §6–§7, which are explicitly parametric and stated with their assumptions.

**The measurement self-corrected twice, and that is a feature, not a footnote.** The first line-count undercounted the total (a `wc -l` batching artifact: it emits a per-batch "total" line, and only the last batch was captured). The second pass undercounted the code/prose split by ~40% for the same reason. Only the third pass — after catching the artifact and switching to a `cat | wc -l` method — produced figures worth standing behind. The numbers are trustworthy *because* they survived correction, not despite it. A case study that can't show its own corrections isn't a case study; it's a brochure.

Where a choice had to be made, it was made **conservatively** — every dial in §6–§7 is set in the direction that *minimises* the AI advantage (humans assumed fast, human labour priced low, output discounted, the founder's full time charged).

---

## 3. What was shipped

| Repo | Commits | Merges | PR #refs | Tracked files | First | Last |
|---|--:|--:|--:|--:|---|---|
| workbench | 231 | 20 | 198 | 498 | 2026-05-24 | 2026-06-24 |
| layers/design-system | 324 | 93 | 135 | 913 | 2025-09-08 | 2026-06-24 |
| layers/foundation | 28 | 7 | 12 | 71 | 2026-05-27 | 2026-06-10 |
| layers/platform | 15 | 1 | 5 | 112 | 2026-03-27 | 2026-05-31 |
| layers/specs | 606 | 43 | 323 | 908 | 2026-03-26 | 2026-06-24 |
| layers/substrate | 180 | 18 | 147 | 564 | 2026-05-15 | 2026-06-21 |
| domains/agri-ecosystem-twin | 2 | 0 | 1 | 82 | 2026-06-10 | 2026-06-10 |
| domains/conservation | 37 | 0 | 22 | 252 | 2026-05-24 | 2026-06-22 |
| domains/devloop | 83 | 0 | 79 | 205 | 2026-05-29 | 2026-06-21 |
| domains/exercir | 333 | 30 | 238 | 1215 | 2026-05-15 | 2026-06-22 |
| domains/foundry | 38 | 0 | 37 | 293 | 2026-06-10 | 2026-06-21 |
| domains/gridiron | 47 | 0 | 0 | 110 | 2026-06-09 | 2026-06-09 |
| domains/health | 4 | 0 | 4 | 71 | 2026-06-06 | 2026-06-07 |
| domains/herdbook | 168 | 13 | 32 | 403 | 2026-05-30 | 2026-06-22 |
| domains/markets | 14 | 0 | 7 | 87 | 2026-06-03 | 2026-06-22 |
| domains/scenario-lab | 2 | 0 | 1 | 24 | 2026-06-13 | 2026-06-17 |
| domains/studio | 68 | 0 | 66 | 213 | 2026-06-17 | 2026-06-24 |
| domains/whales-and-bubbles | 12 | 0 | 7 | 151 | 2026-06-14 | 2026-06-22 |
| **TOTAL** | **2,192** | **225** | **1,314** | **6,172** | | |

**Process layer (the factory, shipped alongside the products):**

- **272 ADRs** (ADR-001 → ADR-273) — architectural decisions with tradeoff analysis.
- **652 concept/spec docs** — the externalised-knowledge corpus.
- **48 skills + 23 agents** — the reusable, machine-readable process machine.

> Note: PR `#refs` is a proxy and undercounts squash-merges without a `#` in the
> subject (e.g. `gridiron` shows 0 PR refs against 47 commits).

---

## 4. Not only code

Re-measured cleanly (`cat | wc -l`, lockfiles excluded from "authored"):

| Category | Lines | Share of authored |
|---|--:|--:|
| Code (`ts/tsx/js/html/css/scss/sh/sql`) | ~658,240 | ~63% |
| Prose (markdown: ADRs, concepts, docs) | ~365,638 | ~35% |
| Structured data (json/yaml: ledgers, fixtures, config) | ~24,680 | ~2% |
| **Authored total** | **~1,048,558** | **100%** |
| Generated lockfiles (excluded above) | ~181,178 | — |
| **Total tracked** | **~1,400,362** | — |

> Authored + lockfiles (~1.23M) is less than total tracked (~1.40M): the ~171k
> remainder is other tracked files outside these three buckets — SVGs, test
> snapshots, `.txt`, and miscellaneous config — counted by `cat | wc -l`.

**For every two lines of code there is more than one line of authored design reasoning.** That is the standardisation-infrastructure thesis made literal: the products and the standards that govern them were built in the same window.

---

## 5. Timeline

- **Concentrated cluster build:** ~mid-May 2026 → 2026-06-24 — roughly **six weeks**.
- `layers/specs` reaches back to late March 2026; `layers/design-system` carries older roots (Sept 2025) and is therefore not all "the last months."
- Twelve domains stood up in the window, several taken to a live/deployed state (e.g. kids-football deployed over HTTPS).

---

## 6. Effort embodied (conservative floor)

LOC-to-effort is the least reliable estimator in software. It is used here because it is what is measurable, and it is triangulated against an independent parametric model. Every assumption below is set to **minimise** the resulting person-years.

### 6.1 The floor — every dial set to "humans are fast"

| Parameter | Conservative choice | Why it favours the human side |
|---|---|---|
| Net output rate | **60 SLOC / dev-day** (source lines of code) | Industry full-lifecycle figures are 10–50/day (design + test + review + debug, not typing). 60 is top-decile. |
| Reuse discount | **−30% on code** | 12 domains share the substrate + design-system patterns; a team would abstract, not retype 658k independent lines. |
| Design corpus | **0.75 day / document** | 272 ADRs + 652 specs = 924 decision-grade docs at well under a day each. |
| Working year | **220 days** | Standard. |

```text
Code:   658,240 × 0.70  = 460,768 effective lines
        460,768 ÷ 60    = 7,679 dev-days
        7,679 ÷ 220     ≈ 35 person-years

Docs:   924 documents × 0.75 day = 693 days ÷ 220 ≈ 3 person-years
                                   ─────────────────────────────────
        CONSERVATIVE FLOOR        ≈ 38 person-years
```

### 6.2 Cross-check — COCOMO (textbook parametric, code only)

```text
Organic mode:        2.4 × 658^1.05  = 2,185 person-months ≈ 182 person-years
Semi-detached mode:  3.0 × 658^1.12  = 4,311 person-months ≈ 359 person-years
```

Substrate is kernel R&D (event-sourcing, Bayesian inference, RLS, FHIR, reproducibility) — squarely *semi-detached*. But even the **organic (easiest) mode says ~180 person-years for the code alone**, before a single ADR. The §6.1 floor of 38 is deliberately ~⅕ of the gentlest standard estimate.

### 6.3 Compression

```text
38 person-years ÷ 0.115 years (6 weeks) ≈ 330× compression (at the floor)

A 10-person team at the floor rate would need ~3.8 calendar years.
Against the COCOMO-realistic 180 PY, the same team is at ~18 years (~1,500×).
```

---

## 7. Economics (audit-proof)

Conservative human side — loaded cost of **\$150k / person-year** (already low; Swiss/EU day-rates imply \$200–300k):

| Effort basis | Person-years | Market cost of that effort |
|---|--:|--:|
| Conservative floor | 38 PY | ~\$5.7M |
| Output discounted 10× | 3.8 PY | ~\$570k |

Actual cost of the ~3-month build:

```text
Claude subscription              $200 × 3            =     $600
Founder's own time (¼ yr @ $150k loaded)            ≈  $37,500
                                                    ─────────────
Actual all-in cost                                  ≈  $38,000
   (≈98% of it is the founder's own time, not the AI)
```

| Comparison | Ratio |
|---|--:|
| Subscription-only (\$600) vs floor (\$5.7M) | ~9,500× *(do not use — collapses under scrutiny)* |
| Subscription-only (\$600) vs ÷10 (\$570k) | ~950× *(do not use)* |
| **All-in (\$38k) vs ÷10 (\$570k)** | **~15×** |
| **All-in (\$38k) vs floor (\$5.7M)** | **~150×** |

The eye-popping 1,000×+ figure needs the subscription-only framing and dies to one objection ("you spent a quarter of your own expert time"). The **15–150× figure survives that objection** — discount the output 10×, price labour low, *and* charge the founder's full quarter, and it still wins by an order of magnitude or two. Use the number that survives the audit.

---

## 8. Caveats (so the numbers stay honest)

1. **LOC → effort is the worst metric in the field.** Used only because it is measurable, and triangulated with COCOMO.
2. **AI code can be more verbose than hand-written** → inflates LOC → hence the 30% reuse discount. At 50% the floor drops to ~28 PY — still decades.
3. **Effort embodied ≠ value delivered — but the value model decides how much.** 38 person-years *sit in the repos*. Through a **product-sales lens** (selling Substrate/Foundry to customers), whether that is worth \$5.7M depends on whether the products sell. Through an **enterprise internal-delivery lens** (a funded org with a backlog longer than it can ever staff), the value is realised at *delivery*, not at sale — \$5.7M of output for \$38k is direct cost-avoidance and freed capacity against work already on the roadmap, and needs no downstream revenue to be real. The honest qualifier in either lens: it counts only for output the org actually needed — twelve domains exploring shared patterns is partly research. "150× cheaper to **build**" is proven; how much converts to **value** depends on which lens you are in, and on demand.
4. **Not a true counterfactual.** Much of this scope a solo founder would never have *attempted* without AI. The comparison is real for the *output*, hypothetical for the *alternative*.
5. **It was not autonomous.** Every gate, the charter, the founder-gated governance, the architecture — that was the founder. The \$200 bought amplification of a skilled operator, not replacement of one.
6. **The largest value here is the one these numbers cannot see.** Everything above measures *amplification* — known work done faster and cheaper. It is structurally blind to *capability expansion*: that a single founder reached domains (cure-fraction survival models, Kolmogorov–Smirnov goodness-of-fit, Swiss-EPD/FHIR, breeding genetics, NFL decision value) that no one person commands, and that knowing such methods *exist* changed which products were even conceived. Person-years and lines-of-code cannot price options that would otherwise never have been generated. This is almost certainly the most valuable dimension — and the one this case study cannot quantify.

---

## 9. Interpretation — the thesis, measured on ourselves

This cluster is the clearest evidence available for the amplifier thesis we argue elsewhere: **AI multiplies process maturity; it does not substitute for it.** The speed shows in the volume (§3–§5); the quality shows separately in the record of the verifier-wave and whole-branch review catching critical bugs a single fast pass would have shipped (data-loss regressions, "tests green but the surface renders blank" token divergence, dependency-rekey bugs). Speed × a net that catches is the only thing that produces a million *trustworthy* lines.

Framed as the controlled experiment we would otherwise have to run: this corpus is the **"agent pool, with shared blueprints"** arm — team-scale volume at AI speed, kept coherent by the standardisation layer. What is missing is only the cold-start baseline (a pool with *no* shared standards) to price the delta directly.

And the thesis itself is **two-part**, not one. The numbers above prove *amplification* — process maturity multiplied by AI throughput. But the larger mechanism the metrics miss is **capability expansion**: AI does not only do the work faster, it makes reachable the work that was otherwise *impossible for this actor* — instant expert-level breadth across dozens of specialised domains that no individual could acquire in a lifetime, let alone six weeks. Amplification has a measurable ceiling (you can only speed up work you would have done anyway). Capability expansion has none: **you cannot select from options you never knew existed.** For a solo or small venture, that breadth is close to *non-substitutable at any price* — you cannot assemble or afford the rare cross-domain expert team that twelve domains demand — which is the precise economic meaning of "priceless."

The strongest line in the case study is therefore not the \$600 and not the 1,000×. It is this: **the amplifier thesis, measured on its own authors, surviving its own skeptic** — at 15–150× efficiency, with the corrections shown in public — *and* the admission that its most valuable dimension sits entirely outside what the numbers could measure.

---

## Appendix — reproduce it

Run from the cluster root (`de-braighter/`). All figures are tracked-file-only (lockfiles isolated, `node_modules` excluded by `git ls-files`).

```bash
repos=$(for d in . layers/* domains/* attic/*; do [ -d "$d/.git" ] && echo "$d"; done)

# §3 — commits / merges / PR refs / files / dates
for d in $repos; do
  c=$(git -C "$d" rev-list --count HEAD)
  m=$(git -C "$d" rev-list --count --merges HEAD)
  pr=$(git -C "$d" log --format=%s | grep -oE '#[0-9]+' | sort -u | wc -l)
  f=$(git -C "$d" ls-files | wc -l)
  echo "$d $c $m $pr $f"
done

# §4 — clean line split (cat avoids the wc-l batching artifact)
for d in $repos; do
  fl=$(git -C "$d" ls-files)
  m=$(echo "$fl" | grep -iE '\.md$' | (cd "$d" && xargs cat 2>/dev/null) | wc -l)
  c=$(echo "$fl" | grep -iE '\.(ts|tsx|js|jsx|html|css|scss|sh|py|sql)$' | grep -viE 'lock' | (cd "$d" && xargs cat 2>/dev/null) | wc -l)
  echo "$d md=$m code=$c"
done
```

COCOMO: `effort_PM = a × KLOC^b` — organic `(2.4, 1.05)`, semi-detached `(3.0, 1.12)`; `KLOC = 658`.
