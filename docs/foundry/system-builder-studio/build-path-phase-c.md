---
product_key: system-builder-studio
build_path_date: 2026-06-24
status: build-path
charter: docs/foundry/system-builder-studio/charter.md
masterplan: docs/superpowers/specs/2026-06-23-system-builder-studio-fusion-design.md
risk_tier: T0
item_count: 2
phase: fusion Phase C (spine extraction)
---

# Build Path — System Builder Studio (fusion Phase C: spine extraction)

> Stage 4 for the masterplan's **Phase C**, unlocked now that B3 (the side-by-side proof,
> studio#42) proved the seams are real. Phase C makes the "one foundation, swap the profile"
> claim a **legible, importable API**: a single `spine/` module that both profiles run on.
>
> **Repo:** `de-braighter/studio` (additive). **Contained to the fusion's own folders** — Phase C
> does NOT touch the path-builder's `studio/**` (that product has live queued items; see the
> cross-product note below).

## Why now (and why lean)

B3 placed two genuinely-shared pieces — `resolveActuator` (profile.actuatorRef → Actuator) and
`driveSystem` (the domain-agnostic operating walk) — inside the **proof** folder (`oncology-tracer/`),
because that was its scope. Architecturally they belong in the **spine**, not the proof. Phase C
relocates them into a coherent `spine/` foundation that re-exports the pillars already built (the
actuator port, the canonical profile + registry, the operate read-port), so a third profile — or a
future product — plugs in against one entry point. The actuator port + profile modules are already
clean standalone homes; the only relocation is the operating core out of the proof.

## Cross-product decision (the `StudioProfile` name-clash) — DEFERRED, documented

A same-named, structurally-different `StudioProfile` exists in the **path-builder** product
(`apps/studio-ui/src/app/studio/shared/profile-loader.ts`). No build collision today (disjoint module
paths). **Decision:** the fusion's `StudioProfile` (`profile/`) is the **canonical** domain-profile
concept; the path-builder's type is unified into it **later, as its own coordinated cross-product
item** — NOT in Phase C — because the path-builder has live queued items (`studio/PB-E2.*`) and editing
`studio/` now risks colliding with active workers. Reversible; tracked as a follow-up. Phase C does not
import, edit, or depend on `studio/`.

## ADR needs & gates

**None.** T0, `zero-kernel-change` (pure in-app relocation + re-export; composes-not-authors). Gates
WAIVED per the product's existing T0 directive.

## Quality battery config

Obligations copied verbatim from the charter quality plan:

| Obligation | Applies to |
|---|---|
| `wave-standard` | all items |
| `zero-kernel-change` | all items |
| `a11y-battery` | C2 (re-touches the proof's demo harness UI) |
| `two-trees-discipline` | C2 (the harness renders projection only) |

`yields`: omitted (in-app infra; no discrete catalog substance unit).

## Work items

All scopes `repo: de-braighter/studio`; pathPrefix repo-relative.

| itemId | title | pathPrefix | dependsOn | lane | qualityObligations |
|---|---|---|---|---|---|
| `…/C1-spine-foundation` | Phase C1 — Spine foundation module: create `apps/studio-ui/src/app/spine/` as the canonical "one foundation" API. House `resolveActuator` (profile.actuatorRef → Actuator: 'foundry'→FoundryActuator, 'clinical'→ClinicalActuator) + `driveSystem` (the domain-agnostic operating walk) here, and re-export the pillars through `spine/index.ts`: the `Actuator` interface + `ACTUATOR` token (from `actuator-port/`), `StudioProfile` + the registry (from `profile/` — the CANONICAL domain-profile), and the operate read-port (from `operate/`). Document spine/ as "the foundation both profiles run on". Do NOT touch `studio/`. | `apps/studio-ui/src/app/spine/` | — | spine | wave-standard, zero-kernel-change |
| `…/C2-refound-tracer-on-spine` | Phase C2 — Re-found the proof on the spine: update `oncology-tracer/` to import `resolveActuator` + `driveSystem` from `spine/` and DELETE the local copies B3 placed there; the `side-by-side.integration.spec.ts` proof must still pass unchanged (it now exercises the spine). Edit ONLY `oncology-tracer/`. | `apps/studio-ui/src/app/oncology-tracer/` | `…/C1-spine-foundation` | spine | wave-standard, zero-kernel-change, a11y-battery, two-trees-discipline |

## Disjointness proof

Two items, `repo: de-braighter/studio`. **C2 dependsOn C1** → the pair is *ordered* → may share scope
safely; no unordered pairs to prove. (They are in any case distinct folders: `spine/` vs
`oncology-tracer/`.)

**Cross-product safety:** both scopes (`spine/`, `oncology-tracer/`) are non-nested siblings of the
path-builder's `studio/**` and `styles.css` → disjoint by path (rule 2) from every live `studio/PB-E*`
item; workers also run in isolated worktrees.

**Dangling-`dependsOn` check:** `C1-spine-foundation` (the only referenced id) is in the item list. ✓
No cross-repo / ADR items.
