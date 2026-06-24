---
product_key: system-builder-studio
build_path_date: 2026-06-23
status: build-path
charter: docs/foundry/system-builder-studio/charter.md
masterplan: docs/superpowers/specs/2026-06-23-system-builder-studio-fusion-design.md
risk_tier: T0
item_count: 7
phase: fusion Phase A (+ Phase B queued, dep-blocked)
---

# Build Path — System Builder Studio (fusion Phase A + B tracer)

> Stage 4 for the **fusion** masterplan (the workbench·foundry·studio one-product vision).
> Extends the shipped slice-1 Build Path Designer (`build-path/`, 12 done). The masterplan's
> Phase A turns the existing foundry+studio into the explicit **SDLC profile** of one customizable
> tool; Phase B is the thin **oncology tracer** that forces the profile seams open before the
> spine is extracted (Phase C — NOT queued).
>
> **Repo:** `de-braighter/studio` (additive; no `/new-domain`). All Phase A/B code lands in
> **new sibling folders** under `apps/studio-ui/src/app/` — disjoint from the shipped `build-path/`,
> the live `recipe-designer/`, and the `studio/` path-builder product.

## Scaffold plan

- **Target repo:** `de-braighter/studio` (clone at `domains/studio/`). Angular + vitest. Additive.
- **`/new-domain` tiers:** none. The app ships green.
- **No new dependencies, no new ports/DB.** Items must use existing deps (Angular `HttpClient`
  for any Foundry read). A new dep would touch root `package.json`/lockfile (shared) — out of scope;
  surface it instead of bundling.
- **New feature roots (siblings of `build-path/`):** `profile/`, `operate/`, `actuator-port/`
  (Phase A); `actuator-clinical/`, `oncology-tracer/` (Phase B). The oncology profile instance lands
  inside `profile/` (shared with A1 → ordered via `dependsOn`).
- **Subtraction (exists — reuse, do not rebuild):** the slice-1 `build-path/actuator/` push (A3
  imports + wraps it, does not modify); `plan-tree/` store + projection patterns; `<ds-board-kit>`.

## Epic ladder

The ladder ends when the wedge runs: **the SAME Studio drives two profiles (SDLC + oncology) on the
shared substrate** (Phase B3) — not when the full fused product ships.

| Epic | Capability (deliverable) | Acceptance | Items |
|---|---|---|---|
| **A1 Profile** | `StudioProfile` is a first-class concept; the SDLC profile is explicit. | A `StudioProfile` type (vocabulary, skin id, actuator binding by ref) + the SDLC instance + a registry; unit-tested; kernel-shaped. | A1-profile |
| **A2 Operate** | The operating surface: observe Foundry state in the one face. | A routed-ready `/operate` page OBSERVES queue/claim/gate/review state read-only via a read adapter; WCAG 2.2 AA. | A2-operate |
| **A3 Actuator port** | The seam Phase B plugs into. | An `Actuator` interface (`actuate(node)`) + a `FoundryActuator` wrapping the slice-1 push behind it; the irreversible-push wiring reviewed. | A3-actuator-port |
| **A4 Route** | `/operate` reachable. | Lazy `/operate` route in `app.routes.ts` → A2 page; recipe-designer + build-path routes intact. | A4-operate-route |
| **B1 Oncology profile** | A second profile exists (the tracer's data). | A thin oncology `StudioProfile` (vocabulary, units, 1–2 care-path templates, clinical skin id) in the registry; DEMO only, NO real PHI; binds the clinical actuator by ref. | B1-oncology-profile |
| **B2 Clinical actuator** | The actuator port proven domain-pluggable. | A stub clinical actuator implementing A3's port; `schedule/record/flag-tumor-board` emit substrate events only (no real integration, no PHI). | B2-clinical-actuator |
| **B3 Side-by-side proof** | The generalization proof. | An integration spec drives one tiny care path through the SAME Studio with the oncology profile + clinical actuator, asserting SDLC and oncology run on the shared substrate unchanged. | B3-side-by-side-proof |

## UI-surface plan

| Surface | Verdict | Item | pathPrefix |
|---|---|---|---|
| Operating surface (observe Foundry state) | **in** | A2-operate | `…/operate/` |
| `/operate` route (shared file) | **in** (sequencing) | A4-operate-route | `…/app.routes.ts` |
| Side-by-side tracer demo/proof | **in** | B3-side-by-side-proof | `…/oncology-tracer/` |
| Profile switcher UI, full operating *drive* (advance/authorize), read-back loop | **deferred** (masterplan Phase C / charter §What-NOT-to-build) | — | — |

i18n: page-scoped string constants inside each surface folder (i18n-ready); no four-locale parity
obligation for this T0 internal tool (matches slice-1).

## ADR needs & gates

**None.** T0 + `zero-kernel-change`: profile + actuator are pack territory; operational fields ride as
metadata + derived views (ADR-176 inclusion test deliberately not met). ADR-176/239/240 govern. An
apparent kernel need is a charter design smell to escalate, not a build-path edit.

**Gates:** Gate 1 greenlight ✅ (historical). No Gate 2 (T0). Downstream founder gates **WAIVED**
(founder directive 2026-06-21, fully-autonomous T0) — items auto-merge/auto-ship on green waves.
`push-actuator-review` stays an *engineering* review focus on A3. **Waiver scoped to this T0 product
only** — the Phase B oncology tracer is a DEMO (no PHI); it does NOT inherit, extend, or imply any
T2/regulated oncology waiver.

## Quality battery config

T0 row: wave standard, auto-merge OK. Obligations copied verbatim from the charter quality plan:

| Obligation | Applies to |
|---|---|
| `wave-standard` (reviewer + qa-engineer + charter-checker) | all items |
| `zero-kernel-change` (charter-checker confirms no kernel/contract change) | all items |
| `a11y-battery` (WCAG 2.2 AA) | A2-operate, B3-side-by-side-proof (UI surfaces) |
| `two-trees-discipline` (draft=truth, RenderNode=projection, geometry never persisted) | A2-operate, B3-side-by-side-proof (if board-kit used) |
| `push-actuator-review` (idempotent `foundry_queue_push`; disjointness gate blocks push) | A3-actuator-port (wraps the real push) |

`yields`: omitted on every item — UI/infra feature, no discrete catalog substance unit.

## Lanes & parallelism

`lane` is informational; the contract is `dependsOn` + disjoint scopes.

- **Phase A fans out immediately:** A1, A2, A3 are independent (3-wide parallel). A4 waits on A2.
- **Phase B is dep-blocked on A3** (founder directive): B1 waits on A1+A3; B2 waits on A3; B3 waits on
  B1+B2+A2. Max width once A3 lands: B1 ∥ B2.

## Work items

All scopes `repo: de-braighter/studio`; pathPrefix repo-relative.

| itemId | title | pathPrefix | dependsOn | lane | qualityObligations |
|---|---|---|---|---|---|
| `…/A1-profile` | Phase A1 — Profile as a first-class concept: a `StudioProfile` type (vocabulary, skin id, actuator binding **by ref**) + the explicit **SDLC** profile instance + a small profile registry. Pure lib, kernel-shaped, no route, no new deps. | `apps/studio-ui/src/app/profile/` | — | profile | wave-standard, zero-kernel-change |
| `…/A2-operate` | Phase A2 — Operating surface (read-only): a standalone `/operate` page that OBSERVES Foundry queue/claim/gate/review state via a read adapter (Angular `HttpClient` against the Foundry read endpoint, else a fixture — document the choice). Render-only this slice (NO drive). WCAG 2.2 AA. Does NOT edit `app.routes.ts` (A4 wires the route). No new deps. | `apps/studio-ui/src/app/operate/` | — | operate | wave-standard, zero-kernel-change, a11y-battery, two-trees-discipline |
| `…/A3-actuator-port` | Phase A3 — Actuator port: define the `Actuator` interface (`actuate(node)`) + a `FoundryActuator` that wraps the slice-1 `build-path/actuator/` push **behind** it (import + delegate; do NOT modify `build-path/`). The seam Phase B plugs into. Review the irreversible push wiring (idempotency, disjointness-blocks-push). | `apps/studio-ui/src/app/actuator-port/` | — | actuator | wave-standard, zero-kernel-change, push-actuator-review |
| `…/A4-operate-route` | Phase A4 — Route: register the lazy `/operate` route in `app.routes.ts` → the A2 operate page. The ONLY shared-file edit, isolated as a sequencing item; keep recipe-designer + build-path routes intact. | `apps/studio-ui/src/app/app.routes.ts` | `…/A2-operate` | shell | wave-standard, zero-kernel-change |
| `…/B1-oncology-profile` | Phase B1 — Thin **oncology** `StudioProfile` instance (vocabulary, units, 1–2 care-path templates, clinical skin id) added to the registry; binds the clinical actuator **by ref**. **DEMO only — NO real PHI, no real clinical claim.** | `apps/studio-ui/src/app/profile/` | `…/A1-profile`, `…/A3-actuator-port` | oncology-tracer | wave-standard, zero-kernel-change |
| `…/B2-clinical-actuator` | Phase B2 — Stub clinical actuator implementing the A3 `Actuator` port: `schedule/record/flag-tumor-board` emit **substrate events only** (no real integration, no PHI). Proves the port is domain-pluggable. | `apps/studio-ui/src/app/actuator-clinical/` | `…/A3-actuator-port` | oncology-tracer | wave-standard, zero-kernel-change |
| `…/B3-side-by-side-proof` | Phase B3 — Side-by-side proof: an integration spec that drives ONE tiny care path through the SAME Studio with the oncology profile + clinical actuator, asserting the SDLC and oncology profiles run on the shared substrate **unchanged**. The generalization proof; demo harness, no route. | `apps/studio-ui/src/app/oncology-tracer/` | `…/B1-oncology-profile`, `…/B2-clinical-actuator`, `…/A2-operate` | oncology-tracer | wave-standard, zero-kernel-change, a11y-battery, two-trees-discipline |

## Disjointness proof

**Dependency order:** `A1 ≺ B1`; `A3 ≺ {B1, B2}`; `A2 ≺ {A4, B3}`; `{B1,B2} ≺ B3`.
All scopes `repo: de-braighter/studio` → path comparison (rule 2). Ordered pairs (transitive
dependency) may share scope and need no proof. The one **shared-path** pair is `A1-profile` ↔
`B1-oncology-profile` (both `profile/`) — and it is **ordered** (B1 dependsOn A1) → safe.

Unordered pairs (both carry pathPrefix; disjoint iff neither normalized prefix is a prefix of the other):

| Unordered pair | Evidence | Verdict |
|---|---|---|
| A1-profile ↔ A2-operate | `profile/` vs `operate/` — non-nested | disjoint |
| A1-profile ↔ A3-actuator-port | `profile/` vs `actuator-port/` | disjoint |
| A1-profile ↔ A4-operate-route | `profile/` vs `app.routes.ts` | disjoint |
| A1-profile ↔ B2-clinical-actuator | `profile/` vs `actuator-clinical/` | disjoint |
| A1-profile ↔ B3-side-by-side-proof | `profile/` vs `oncology-tracer/` | disjoint |
| A2-operate ↔ A3-actuator-port | `operate/` vs `actuator-port/` | disjoint |
| A2-operate ↔ B1-oncology-profile | `operate/` vs `profile/` | disjoint |
| A2-operate ↔ B2-clinical-actuator | `operate/` vs `actuator-clinical/` | disjoint |
| A3-actuator-port ↔ A4-operate-route | `actuator-port/` vs `app.routes.ts` | disjoint |
| A3-actuator-port ↔ B3-side-by-side-proof | `actuator-port/` vs `oncology-tracer/` | disjoint |
| A4-operate-route ↔ B1-oncology-profile | `app.routes.ts` vs `profile/` | disjoint |
| A4-operate-route ↔ B2-clinical-actuator | `app.routes.ts` vs `actuator-clinical/` | disjoint |
| A4-operate-route ↔ B3-side-by-side-proof | `app.routes.ts` vs `oncology-tracer/` | disjoint |
| B1-oncology-profile ↔ B2-clinical-actuator | `profile/` vs `actuator-clinical/` | disjoint |

(A4 ↔ A2 ordered; B3 ↔ {A2,B1,B2} ordered; B1 ↔ {A1,A3} ordered; B2 ↔ A3 ordered — no proof needed.)

**Cross-product safety:** the live `studio` path-builder product carries `scope.repo:
de-braighter/studio` on its items too (verified via `foundry_next`; only its *product-level* repo
label is the bare `studio`). So Foundry **path-checks** its items against these — NOT auto-disjoint by
repo string. Every Phase A/B folder (`profile/`, `operate/`, `actuator-port/`, `actuator-clinical/`,
`oncology-tracer/`, `app.routes.ts`) is a non-nested sibling of the path-builder's `studio/**` and
`styles.css` → disjoint by path; workers also run in isolated worktrees. **Note:** because the
`scope.repo` matches, Foundry WILL correctly serialize any future `app.routes.ts` edit across the two
products — currently moot (no queued path-builder item touches `app.routes.ts`).

**Dangling-`dependsOn` check:** every referenced id (`A1-profile`, `A2-operate`, `A3-actuator-port`,
`B1-oncology-profile`, `B2-clinical-actuator`) appears in the item list. ✓ No dangling deps. No
cross-repo / ADR items.
