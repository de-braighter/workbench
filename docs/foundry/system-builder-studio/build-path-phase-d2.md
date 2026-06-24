---
product_key: system-builder-studio
build_path_date: 2026-06-24
status: build-path
charter: docs/foundry/system-builder-studio/charter.md
masterplan: docs/superpowers/specs/2026-06-24-unified-cockpit-masterplan.md
risk_tier: T0
item_count: 2
phase: Unified Cockpit — Phase D2 (cockpit drive)
---

# Build Path — Unified Cockpit Phase D2 (cockpit drive)

> Extends the read-only operating surface (A2) into a true **cockpit**: surface the workflow stages,
> **DRIVE** them (advance/authorize), and show **guardrail firings** (from the D1 model). Masterplan
> layer 2 (workflow tree) + the Studio cockpit's DRIVE verb.
>
> **Product:** `system-builder-studio` (T0 waiver). **Repo:** `de-braighter/studio` (additive).

## Safety boundary (mirrors A2)

There is no browser-reachable foundry **write** endpoint, and a browser app actuating the live foundry
queue would be a real, consequential write. So D2 drives against an **in-memory / fixture** foundry
through a **drive-port** seam (the actuation analogue of A2's `FOUNDRY_OPERATE_READ_PORT`). Live wiring
(browser → authed foundry API) is **deferred** to a later phase. This keeps D2 T0 demo-safe and
zero-kernel-change while proving the cockpit-drive UX + the port seam.

## ADR needs & gates

**None.** T0, `zero-kernel-change` (UI + a pack-level port; composes-not-authors). Gates WAIVED (T0).

## Quality battery config

| Obligation | Applies to |
|---|---|
| `wave-standard` | all items |
| `zero-kernel-change` | all items |
| `a11y-battery` | D2-2 (the cockpit UI) |
| `two-trees-discipline` | D2-2 (renders projection only) |

`yields`: omitted (in-app UI/infra).

## Work items

All scopes `repo: de-braighter/studio`; pathPrefix repo-relative. (Both in `operate/`; **D2-2 dependsOn
D2-1** → ordered → may share scope.)

| itemId | title | pathPrefix | dependsOn | lane | qualityObligations |
|---|---|---|---|---|---|
| `…/D2-1-drive-port` | Phase D2.1 — Drive-port seam: define a `FOUNDRY_DRIVE_PORT` (advance-stage + authorize-gate intents) mirroring the A2 read-port, with an **in-memory/fixture** adapter (NOT the live foundry). Extend the operate view-model to also expose the workflow stages + the current guardrail firings (read the D1 `evaluateGuardrails`/`DEFAULT_GUARDRAILS` from `spine/`, read-only). No UI in this item. | `apps/studio-ui/src/app/operate/` | — | cockpit | wave-standard, zero-kernel-change |
| `…/D2-2-cockpit-drive-ui` | Phase D2.2 — Cockpit drive UI: extend the operate page into a cockpit — render the workflow stages, add **Advance** (automation) + **Authorize** (gate) controls wired to the `FOUNDRY_DRIVE_PORT`, and a **guardrail-firings** panel. WCAG 2.2 AA; render projection only (two-trees). Drives the fixture adapter only (live wiring deferred). | `apps/studio-ui/src/app/operate/` | `…/D2-1-drive-port` | cockpit | wave-standard, zero-kernel-change, a11y-battery, two-trees-discipline |

## Disjointness proof

Both items `repo: de-braighter/studio`, scope `operate/`. **D2-2 dependsOn D2-1** → ordered → may share
scope; no unordered pairs. Cross-product: `operate/` is a non-nested sibling of the live path-builder's
`studio/**` → disjoint by path. D2-1 reads `spine/` (D1 guardrail model) read-only. Dangling check:
`D2-1-drive-port` is in the list. ✓
