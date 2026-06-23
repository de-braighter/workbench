---
product_key: system-builder-studio
build_path_date: 2026-06-24
status: build-path
charter: docs/foundry/system-builder-studio/charter.md
masterplan: docs/superpowers/specs/2026-06-24-unified-cockpit-masterplan.md
risk_tier: T0
item_count: 2
phase: Unified Cockpit — Phase D1 (guardrail tracer)
---

# Build Path — Unified Cockpit Phase D1 (guardrail tracer)

> First phase of the Unified Cockpit arc (masterplan: the four-layer frame). D1 is the **B3-analogue
> for guardrails**: model ONE real, already-live SDLC guardrail — the **disjointness gate** — as a
> declared **Axis-2 conditional intervention** in the spine, prove it fires/observes end-to-end, before
> generalizing (D4) or wiring it into the live cockpit flow (D2). Face-first, prove on one.
>
> **Product:** continues under `system-builder-studio` (the cockpit IS System Builder Studio growing up;
> D1 is studio-app work under the existing T0 charter + waiver). A dedicated product/charter is spun
> only when the arc reaches cross-repo work (devloop calibration, foundry-governance modeling).
> **Repo:** `de-braighter/studio` (additive). New code in `spine/` (extend) + a new `guardrail-tracer/`.

## Why this first

The disjointness gate already exists and is *live*: `computeScopeDisjointness` (the derived boundary
predicate, in `build-path/core/`) + the actuator's push-block (enforcement, in `build-path/actuator/`).
D1 does NOT rewire that live flow — it **models** the gate as a declared guardrail and proves the
machinery (declare → evaluate boundary → enforce → observe the firing) on this one case. Lowest-risk
possible tracer: a real guardrail, reusing existing derived views, zero rewiring, zero kernel change.

## ADR needs & gates

**None.** T0, `zero-kernel-change`: a `Guardrail` is a pack/spine-level Axis-2 conditional intervention
composed from kernel-generic pieces (conditioned effect + derived predicate + actuator); ADR-176
inclusion test deliberately not met. Gates WAIVED per the product's existing T0 directive.

## Quality battery config

| Obligation | Applies to |
|---|---|
| `wave-standard` | all items |
| `zero-kernel-change` | all items |

`yields`: omitted (in-app infra; no discrete catalog substance unit).

## Work items

All scopes `repo: de-braighter/studio`; pathPrefix repo-relative.

| itemId | title | pathPrefix | dependsOn | lane | qualityObligations |
|---|---|---|---|---|---|
| `…/D1-1-guardrail-model` | Phase D1.1 — Guardrail model in the spine: a `Guardrail` type modeling an **Axis-2 conditional intervention** — `{ id, kind: 'always-running' \| 'triggered', boundary (a predicate over draft/observation state), response (an enforcement/actuator ref) }` — plus an `evaluateGuardrails(state)` deriving which guardrails fire (a derived view, NOT stored), and the **disjointness guardrail INSTANCE** (boundary = `computeScopeDisjointness` reports conflicts, imported read-only from `build-path/core/`; response = block-push ref; kind = 'triggered'). When it fires, emit an observed `DomainEventEnvelope` (reuse the B2 UUIDv5 id-derivation). Re-export from `spine/index.ts`. Do NOT rewire the live `build-path/` push flow (that's D2). | `apps/studio-ui/src/app/spine/` | — | guardrail | wave-standard, zero-kernel-change |
| `…/D1-2-guardrail-tracer` | Phase D1.2 — Guardrail tracer proof: an integration spec proving the disjointness guardrail — modeled as a declared Axis-2 intervention — fires (blocks) on overlapping work-item scopes and passes on disjoint scopes, and emits the observed firing event. Drive a tiny `BuildPathDraft` fixture both ways; assert the guardrail machinery works end-to-end on a real live SDLC guardrail (the generalization-readiness proof). Demo harness, no route. | `apps/studio-ui/src/app/guardrail-tracer/` | `…/D1-1-guardrail-model` | guardrail | wave-standard, zero-kernel-change |

## Disjointness proof

Two items, `repo: de-braighter/studio`. **D1-2 dependsOn D1-1** → ordered → may share scope; no unordered
pairs to prove. (Distinct folders anyway: `spine/` vs `guardrail-tracer/`.)

**Cross-product safety:** both scopes are non-nested siblings of the live path-builder's `studio/**` and
`styles.css` → disjoint by path (rule 2) from every queued `studio/PB-E*` item; workers run in isolated
worktrees. D1-1 imports (read-only) from `build-path/core/` + `actuator-clinical/` (the UUIDv5 helper)
but edits only `spine/`.

**Dangling-`dependsOn` check:** `D1-1-guardrail-model` (the only referenced id) is in the item list. ✓
No cross-repo / ADR items.
