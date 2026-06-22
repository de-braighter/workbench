---
product_key: studio
charter_date: 2026-06-22
risk_tier: T0
greenlight_gate: in-session founder go (2026-06-22 — "Author charter → build-path → push")
status: chartered
brief: layers/specs/ui-design/pack-studio/README.md + layers/specs/ui-design/_prompts/path-builder-studio-*.md
---

# Charter — Path-Builder Studio (authoring)

## Name & key

**Path-Builder Studio** (`studio`). A **domain-agnostic scientific-modeling studio**: a domain
expert authors a model of how interventions move outcomes over time, then runs / validates /
reproduces it **without writing code**. The same layout + components serve any domain; a **domain
profile** supplies the vocabulary and the tracking depth. This charters the **authoring** wedge
(the unbuilt Claude Design path-builder surfaces), distinct from the already-shipped studio wedges
(`board-editor-studio` = recipe/catalog designer; `system-builder-studio` = build-path designer) —
all three live in `domains/studio/apps/studio-ui`.

## Risk tier

**T0 (prototype / internal dev tool).** No PHI, no external data, no auth, no regulatory burden;
blast radius is contained to `domains/studio`. It **composes** the `scenario-lab` engine contracts
and the `design-system` tokens/bricks and authors **no kernel concepts** (substrate_fit `partial`
by construction — honest for an authoring tool; ADR-176-safe, composes-not-authors).

| Tier | Examples | Gates | Quality parameters |
| --- | --- | --- | --- |
| **T0** prototype/demo | markets, gridiron, studio | greenlight + ship | wave standard *(cluster override below)* |
| T1 product | herdbook, exercir | + architecture approval | wave + `deep` on kernel-touching items |
| T2 regulated | oncology | + every kernel ADR + designer-first | full battery, RLS proofs, no auto-merge |

**Cluster governance override (binds this T0):** the standard T0 "auto-merge OK" does NOT apply —
every **merge-to-main is founder-gated** (founder's own "go"), and every PR gets the review floor
(≥1 `/code-review`) with the full verifier wave on non-trivial PRs. **Any item needing a
`design-system` token/brick change** (e.g. promoting the glass treatment into shared tokens)
escalates to an `architecture` founder gate + a separate publish "go" (cross-repo published-package
blast radius).

## Scope (the wedge)

**The three authoring surfaces, bound to the real `scenario-lab` engine contracts, rendered on the
canonical `[data-theme="night"]` theme — `/studio/author` first, end-to-end, as the wedge loop.**

1. **`/studio/author`** (THE WEDGE) — a three-pane dark-glass studio:
   - LEFT: a single-parent plan-tree (stage → intervention → decision); selecting an *intervention*
     loads it center.
   - CENTER: the **Effect-Authoring panel** — fields map 1:1 to the engine's `EffectDeclaration`
     (indicator · direction −/+/? · magnitude-prior distribution-picker Punkt/Normal/Beta with a
     **live inline-SVG curve** · confidence slider · basis/provenance · horizon); a plain-language
     declaration footer; the 5 states from the prompt.
   - RIGHT: the **cohort / synthetic-world designer** (`CohortInput`; Weibull baseline with a live
     survival-curve SVG).
2. **`/studio/profiles`** — the domain-invariance demonstrator: the same author screen for TWO
   profiles side-by-side (`oncology-breast-survivorship` ·klinisch vs `predictive-maintenance`
   ·leicht); a profile switcher re-labels the screen + changes tracking depth.
3. **`/studio/results`** — the results dashboard from `ScenarioReport` (KM curves, calibration,
   C-index, counterfactual deltas; hand-drawn inline SVG).

Plus a **glass+neon treatment** (backdrop-blur / glow / aurora on the night theme — current studio
CSS is flat-dark; the mockups want glass) as a sequenced shared-CSS item.

The wedge loop **demonstrably runs** when a domain expert authors an intervention's effect on
`/studio/author` against a real `scenario-lab` profile and the declaration footer + live curves
reflect the engine's `EffectDeclaration` — code-free authoring, profile-agnostic.

## What NOT to build

1. **Real model execution / runs / persistence.** Author + preview against in-memory
   `scenario-lab` fixtures; do NOT wire a run backend, job queue, or saved-model persistence
   (the `Modell ausführen` button is present but does not navigate; results bind to fixture
   `ScenarioReport`s). Defer execution + persistence.
2. **The full 23-screen vision.** Build only the 3 authoring surfaces (+ glass). DEFER the catalog,
   path-library/template/instance/states, guided-wizard/canvas, indicator-registry, interventions-
   library, profile-editor, system-map, easy-mode, coach-planner screens (they're in the artifact
   but outside the authoring wedge).
3. **A charting library.** Hand-draw the prior / survival / KM curves as inline SVG (the prompt
   forbids a charting lib).
4. **Tenant / end-user authoring + auth.** Build for the trusted internal author; no auth, no
   tenant scoping, no multi-user.
5. **Kernel or `scenario-lab` engine changes.** Consume the engine's contracts as-is; bind to the
   real types (do not invent fields, do not modify the engine). An apparent engine gap is a charter
   smell to surface, not to build.
6. **`design-system` brick changes.** Consume the published `@de-braighter/design-system-css@1.7.0`
   tokens (`[data-theme="night"]`). The glass treatment ships as **studio-local CSS**; promoting
   `--glass-*`/`--glow` into shared design-system tokens is a separate architecture-gated item, never
   bundled.

## Quality plan

Tier-derived `qualityObligations` for queue items (copied verbatim onto applicable items):

- `tdd` — every build item is test-first.
- `review-floor` — ≥1 `/code-review` on every PR; full **verifier wave** (`local-ci` + `reviewer`
  + `qa-engineer`) on non-trivial PRs.
- `opus-whole-branch` — an opus whole-branch review per build slice. **Non-negotiable** for studio
  (it caught CRITICAL data-loss/focus regressions on every board-editor-studio slice).
- `a11y-battery` (UI items) — WCAG 2.2 AA: focus-visible rings via `--accent-rim`; the
  `a11y-focus-recovery` test (fixture on `document.body`, asserts focus lands on a non-disabled
  surviving control — the jsdom-vs-real-browser blur trap) on any add/remove/reorder interaction;
  target-size + contrast on the night ground.
- `reactive-forms-cva` (the effect-authoring FORM) — reactive forms + reusable CVA controls (the
  distribution-picker, confidence slider, direction toggle are CVA candidates).
- `engine-binding-fidelity` — authoring fields map 1:1 to the real `scenario-lab` types
  (`EffectDeclaration`/`CohortInput`/`ScenarioReport`); a binding test asserts no invented fields.
- Acceptance per item: `npm test` green + `npm run build` green. **studio pins `npm` — do NOT use
  pnpm in `domains/studio`.**

## Gate schedule

- **Gate 1 — greenlight:** ✅ in-session founder go (2026-06-22): "Author charter → build-path → push".
- **Ship gates (per merge):** every merge-to-main is a founder "go" (cluster governance).
- **Architecture gate (conditional):** any item that needs a `design-system` token/brick change
  (glass-token promotion) raises a founder `architecture` gate before implementation + a separate
  publish "go".

## Repo plan

- **Repo:** EXISTING `de-braighter/studio` (`domains/studio`). **No `/new-domain` scaffold** — extends
  the shipped `apps/studio-ui` Angular app with new routes/components under `src/app/studio/`.
- **Packages consumed:** `@de-braighter/design-system-css@1.7.0` (tokens + `[data-theme="night"]`),
  `@de-braighter/design-system-angular`/`-core` (bricks). The **`scenario-lab` engine contracts**
  (`ScenarioSpec`, `EffectDeclaration`, `CohortInput`, `ScenarioRunResult`, `ScenarioReport`,
  metrics) — build-path must resolve the dependency mechanism (published package vs typed-contract
  import; studio-ui does not currently depend on scenario-lab).
- **Scaffold tiers:** none (UI-only, studio app). No DB, no inference, no api tier.
- **Conventions:** Angular standalone + signal `input()`/`output()` + OnPush, no NgModules; German
  de-CH user copy; inline SVG for curves; `npm` (not pnpm).
