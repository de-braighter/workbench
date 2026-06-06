# WS-3 — Retire the legacy INFERENCE_BACKBONE_PORT — Design

- **Status:** proposed (awaiting user review)
- **Date:** 2026-06-06
- **Author:** orchestrator session (founder-directed)
- **Implements:** [ADR-212](../../../layers/specs/adr/adr-212-retire-legacy-inference-backbone-port.md) (proposed) — the consumer sweep + removal it scopes to "the WS-3 epic."
- **Sequenced by:** [ADR-218](../../../layers/specs/adr/adr-218-north-star-critical-path-sequencing.md) — sibling of WS-8 in the coordinated `substrate@1.0` batch.
- **Rides:** the `substrate@1.0` breaking batch — epic [substrate#92](https://github.com/de-braighter/substrate/issues/92) / WS-3 epic [substrate#93](https://github.com/de-braighter/substrate/issues/93).
- **Successor artifact:** `docs/superpowers/plans/2026-06-06-ws3-legacy-inference-port-retirement-plan.md`.

---

## 1. Why this exists

Two inference-port stacks live side by side on substrate `origin/main` (the `substrate-inference-two-stacks` working note):

- **Legacy** — `libs/substrate-contracts/src/out-ports/inference.port.ts` exports `INFERENCE_BACKBONE_PORT` (a `Symbol.for(...)` DI token) + `InferenceBackbone` / `PosteriorInput` shapes, re-exported from the root barrel. Its `PosteriorInputSchema` has **no `tenantPackId`**. Bound in the composition root to a separate `InMemoryInferenceBackbone`. The barrel comment already scopes it "legacy compatibility until it migrates or is retired."
- **Scoped** — `libs/substrate-contracts/src/inference/` `INFERENCE_BACKBONE` (the singleton `InferenceBackboneRouter`), with **required** `tenantPackId` on every evidence-reading input (ADR-205) + the `counterfactual()` method + conjugate-fast-path routing. The live, RLS-correct stack.

The legacy port is a **cross-tenant read hazard** (inference with no `tenantPackId` — exactly the silent RLS-bypass ADR-205 made impossible) and a **duplicate-shape footgun** (two `InferenceBackbone`/`PosteriorInput` types, same names, different shapes). ADR-212 retires it; `1.0` is the single migration point.

## 2. Live surface (what changes)

**Substrate (`layers/substrate`):**

| File | Role | WS-3 action |
|---|---|---|
| `libs/substrate-contracts/src/out-ports/inference.port.ts` | defines `INFERENCE_BACKBONE_PORT` (`:323`) + legacy `InferenceBackbone`/`PosteriorInput`/`SubjectRef`-using shapes | **delete the file** |
| `libs/substrate-contracts/src/index.ts` | root-barrel re-export of the legacy port (+ the "legacy compatibility until retired" comment) | **drop the re-export** |
| `libs/substrate-runtime/src/composition-root/substrate.module.ts` | binds `INFERENCE_BACKBONE_PORT` (default `InMemoryInferenceBackbone`) at `:1203`, `:1377`; import at `:40`; override method at `:172` | **remove the bindings + the `InMemoryInferenceBackbone` provider + the override method + the import** |

**Consumer (exactly one — verified):**

| File | Today | WS-3 action |
|---|---|---|
| `domains/exercir/libs/pack-football/src/application/engine-player-projection.service.ts` | `@Inject(INFERENCE_BACKBONE_PORT)` (`:50`) typed `InferenceBackbone` (`:51`); calls `inference.posterior({…policy:{strategy:'conjugate-fast-path'}})` (`:71`) + `inference.sample({handleId, replicas, horizonDays, seed})` (`:81`) | re-point to the scoped `INFERENCE_BACKBONE`; add `tenantPackId` to the posterior input; verify `sample` signature |

`conservation` / `herdbook` / `markets` do **not** bind the legacy token (verified). So the entire consumer migration is one exercir service.

## 3. Decision

Per ADR-212, two phases collapsed into the `1.0` train:

1. **`@deprecated` tagging on the `release/1.0` branch** (TSDoc pointer to the scoped surface) — *but skip a standalone "deprecate-now" patch publish.* ADR-212's separate deprecation release buys a migration runway for **external** consumers; there are none (one in-house consumer), and the `1.0` migration guide covers it. **Confirmed sub-decision** (auto-mode; founder may override).
2. **Remove at `1.0`** — delete the legacy port file, the barrel re-export, and the `InMemoryInferenceBackbone` binding. From `1.0` there is exactly one inference contract: the tenant-scoped `INFERENCE_BACKBONE` (required `tenantPackId`, ADR-205).

The exercir consumer migrates **in lockstep** on the consumer side of the `1.0` batch (it builds against the published `1.0`, so its green-gate is at the cut — same Part-2 pattern as WS-8).

## 4. Invariants preserved

The retained scoped `INFERENCE_BACKBONE` + its `RunManifest.apiVersion` replay contract are unchanged (ADR-205). Router + adapters stay singleton — no `Scope.REQUEST` cascade (ADR-197/205). Inference stays kernel concern #3 (ADR-127/176). **No new kernel surface** — net *fewer* published surfaces (ADR-176 passes by removal).

## 5. Release mechanics

Implemented on the substrate `release/1.0` branch (the **same** branch WS-8 + WS-6 target — created off `origin/main` by whichever workstream runs first). Do **not** publish in isolation. The exercir re-point lands on the consumer side at the `1.0` cut (substrate#92).

## 6. Testing

- **Substrate:** the scoped `INFERENCE_BACKBONE` suite stays green; a test asserts the legacy token + `InMemoryInferenceBackbone` are gone (no export from the barrel; composition root no longer provides the token). `nx affected -t lint` clean (no dangling imports).
- **Consumer (at the cut):** exercir builds green on `1.0`; `engine-player-projection.service` runs a posterior+sample through the scoped port with a real `tenantPackId`; no remaining `INFERENCE_BACKBONE_PORT` import in exercir.

## 7. Ownership

`substrate-coder-pro` (contracts + runtime removal) → `implementer` (exercir re-point) → verifier wave. fhir/inference internals untouched.
