---
product_key: system-builder-studio
build_path_date: 2026-06-24
status: build-path
charter: docs/foundry/system-builder-studio/charter.md
masterplan: docs/superpowers/specs/2026-06-24-unified-cockpit-masterplan.md
risk_tier: T0
item_count: 1
phase: Unified Cockpit — Phase D4 (generalize the guardrails)
---

# Build Path — Unified Cockpit Phase D4 (generalize the guardrails)

> Masterplan D4: model the REST of the dev-process guardrails on the D1 machinery, proving it
> generalizes beyond the one disjointness tracer — and that the cockpit (D2) + calibration (D3) panes
> surface them with **zero UI change** (they read `DEFAULT_GUARDRAILS` via derived views).
>
> **One lean item** — a spine model-extension. **Product:** `system-builder-studio` (T0 waiver).
> **Repo:** `de-braighter/studio` (additive).

## Scope of generalization

Add representative guardrails to the spine set, covering BOTH kinds + multiple boundaries:
- **charter-checker** — `always-running` ("no kernel change without an ADR"): proves the always-running
  kind (continuously in effect, not boundary-triggered).
- **verifier-wave** — `triggered` ("merge blocked until the wave is green").
- **quality-obligation / review-floor** — `triggered` ("a required obligation unmet → block").

Boundaries are predicates over available draft/observation state (representative where the real signal —
e.g. a git diff or a live wave verdict — is not reachable in-app; the real-signal wiring is the
enforcement/actuator side, deferred like the live foundry/devloop adapters). The VALUE is proving the
model generalizes: many guardrails, both kinds, evaluated together by the one `evaluateGuardrails`.

## ADR needs & gates

**None.** T0, `zero-kernel-change` (more instances of the existing pack-level guardrail model; ADR-176
inclusion test still not met). Gates WAIVED (T0).

## Quality battery config

| Obligation | Applies to |
|---|---|
| `wave-standard` | the item |
| `zero-kernel-change` | the item |

`yields`: omitted (in-app model extension).

## Work items

| itemId | title | pathPrefix | dependsOn | lane | qualityObligations |
|---|---|---|---|---|---|
| `…/D4-generalize-guardrails` | Phase D4 — Generalize the guardrail set in the spine: add `charter-checker` (always-running), `verifier-wave` (triggered), and a `quality-obligation`/`review-floor` (triggered) guardrail instances + add them to `DEFAULT_GUARDRAILS`; specs proving `evaluateGuardrails` correctly handles MULTIPLE guardrails + BOTH kinds together (always-running always active; triggered fire only on boundary). Confirm (via the existing derived-view design) the cockpit + calibration panes auto-surface them with no UI change. | `apps/studio-ui/src/app/spine/` | — | guardrail | wave-standard, zero-kernel-change |

## Disjointness proof

One item, scope `spine/`. No unordered pairs. Cross-product: `spine/` is a non-nested sibling of the
live path-builder's `studio/**` → disjoint by path. No dangling deps; no cross-repo / ADR items.
