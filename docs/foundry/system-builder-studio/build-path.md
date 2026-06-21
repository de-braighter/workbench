---
product_key: system-builder-studio
renamed_from: studio-foundry-build-path-designer
build_path_date: 2026-06-21
status: build-path
charter: docs/foundry/system-builder-studio/charter.md
risk_tier: T0
item_count: 10
---

# Build Path — System Builder Studio (slice 1: Build Path Designer)

> Stage 4. Turns the T0 charter into 10 claimable, scope-disjoint work items.
> The load-bearing output is the **disjointness proof** (§ Disjointness proof):
> the six authoring/validation/actuation surfaces are pairwise-disjoint sibling
> folders under `apps/studio-ui/src/app/build-path/`; the one shared file (the
> route table) is isolated in its own sequencing item (E1.3). Repo:
> **`de-braighter/studio`** (existing — additive, no `/new-domain` scaffold).

## Scaffold plan

- **Target repo:** `de-braighter/studio` (clone at `domains/studio/`). Angular 21 + vitest + pnpm.
- **`/new-domain` tiers:** **none.** The `studio` domain + `studio-ui` app already
  ship green (S4–S6, studio#1). This build path is **purely additive UI work**
  inside the existing app — there is no greenfield E1 whole-repo scaffold item.
- **No new ports / DB / NestJS.** The app composes published packages only.
- **New feature root:** `apps/studio-ui/src/app/build-path/` — a sibling of the
  existing `plan-tree/` and `recipe-designer/` features.
- **Subtraction (what already exists — DO NOT rebuild):**
  - `plan-tree/in-memory-plan-tree-store.ts` — the kernel-shaped store (E1.1 *adapts*, does not rebuild).
  - `plan-tree/project.ts` — `projectPlanTree()` RenderNode projection (E3.1 reuses the pattern).
  - `plan-tree/edit-mapping.ts` — `editIntentToPlanEdits()` (E3.1 reuses the pattern).
  - `plan-tree/plan-kinds.ts` — node-kind taxonomy (E1.1 reuses the pattern for `BuildNode.kind`).
  - `plan-author.component.ts` — existing container pattern (E1.2 models the build-path container on it).
  - `<ds-board-kit>` (design-system, core 2.5.0 / angular 1.14.0) + the gesture-native
    tree editor — already published & consumed; not rebuilt.

## Epic ladder

The ladder ends when the **wedge loop runs end-to-end** (charter → visual draft →
disjointness-validated → push), not when the full fusion ships.

| Epic | Capability (deliverable) | Acceptance | Items |
|---|---|---|---|
| **E1 Foundation** | The feature scaffolded: kernel-shaped `BuildPathDraft` store + the two shared derived views; container shell with stub surfaces; the `/build-path` route. Everything compiles, route reachable. | `/build-path` renders the container with stub regions; `BuildPathDraftStore.applyEdit()` round-trips; `computeScopeDisjointness()` + `projectDraftToQueueItems()` unit-tested. | E1.1, E1.2, E1.3 |
| **E2 Charter import** | A charter-shaped input loads into a `BuildPathDraft`. | `projectCharterToDraft(charter)` yields a single-parent tree of typed `BuildNode`s; "Load charter" populates the canvas. | E2 |
| **E3 Authoring surfaces** | Visually author the build path: canvas (board-kit) + node inspector. | Add/delete/reparent nodes via the two-trees loop; gate nodes render distinctly; inspector edits label/kind/dependsOn/scope + a compact quality summary + gate metadata. | E3.1, E3.2 |
| **E4 Validation & preview** | Scope conflicts + the generated session prompts are surfaced before push. | Disjointness panel flags overlapping work-items with clash badges; prompt-preview renders the worker-session prompts Foundry would generate. | E4.1, E4.2 |
| **E5 Push actuation** | The one-way door to the Foundry queue, blocked while conflicts exist. | "Push" calls `foundry_queue_push`; the button is disabled while `computeScopeDisjointness()` reports conflicts; push is idempotent. | E5 |
| **E6 Wedge proof** | The bridge proven end-to-end. | An integration test drives charter → draft → conflict-resolution → push (mocked actuation), asserting the queue payload; documented manual run for the ship gate. | E6 |

## UI-surface plan

From the dossier's UX surfaces (textual; no mockups carried). All map onto the
existing `<ds-board-kit>` + Angular-component idiom. Every in-scope surface is a
**standalone component filling a stub** created by the shell (E1.2), so each edits
only its own folder.

| Surface (dossier) | Verdict | Item | Page directory (pathPrefix) |
|---|---|---|---|
| Tree canvas (`<ds-board-kit>`), gate nodes distinct | **in** (the authoring core) | E3.1 | `build-path/canvas/` |
| Node inspector (label/kind/dependsOn/scope/gate) | **in** | E3.2 | `build-path/inspector/` |
| Quality-obligations summary (compact + one effort knob) | **in** — folded into the inspector (design note #5), not a separate page | E3.2 | `build-path/inspector/` |
| Disjointness panel (clash badges, blocks push) | **in** | E4.1 | `build-path/disjointness/` |
| Prompt-preview panel | **in** | E4.2 | `build-path/prompt-preview/` |
| Push action (the one-way door) | **in** | E5 | `build-path/actuator/` |
| Charter load (an action, not a standalone page) | **in** — projector + a shell button | E2 | `build-path/charter-import/` |

- **UI shell (sequencing):** E1.2 owns the container layout + the stub surfaces;
  E1.3 owns the one shared file (the `/build-path` route in `app.routes.ts`). The
  surface items `dependsOn` E1.2.
- **i18n:** UI strings authored as **page-scoped constants inside each surface folder**
  (i18n-ready structure). A formal i18n loader and four-locale parity are **NOT in scope**
  for this T0 internal tool — the charter carries no i18n obligation; deferred.

## ADR needs & gates

**None.** T0 + the charter's `zero-kernel-change` obligation: structure reuses the
kernel `PlanTree`; all operational fields ride as per-node metadata + derived views
(ADR-176 inclusion test deliberately *not* met). The existing ADR-176 / ADR-239 /
ADR-240 govern; no new ADR is reserved. An apparent kernel need surfacing mid-build
is a **charter design smell to escalate to the founder**, not a build-path edit.

**Gates:** Gate 1 greenlight ✅ (`d2d3f338-d7f6-4316-be57-330cf4d28f55`). No Gate 2
(T0). A **founder checkpoint** precedes wiring E5 to the live Foundry queue (the
one-way door — carried as the `push-actuator-review` obligation). A **ship gate**
(`foundry_gate_request gateType: "ship"`) closes the slice on E6.

## Quality battery config

T0 row: wave **standard**, auto-merge OK. Deterministic gates: lint audit set + knip +
coverage-delta + **a11y battery on UI items**. **No** mutation threshold, **no**
RLS/tenancy proofs (no DB). Obligations are copied **verbatim** from the charter:

| Obligation | Applies to |
|---|---|
| `wave-standard` (reviewer + qa-engineer + charter-checker) | all items |
| `zero-kernel-change` (charter-checker confirms no kernel/contract change) | all items |
| `two-trees-discipline` (draft=truth, RenderNode=projection, geometry never persisted) | E1.1, E1.2, E3.1 |
| `a11y-battery` (WCAG 2.2 AA; no regression of board-kit a11y) | E1.2, E3.1, E3.2, E4.1, E4.2, E5 |
| `push-actuator-review` (idempotent `foundry_queue_push`; disjointness gate blocks push BEFORE any write) | E5 |

**`yields`:** omitted on every item — this is a Studio UI feature, not a catalog
substance unit (pack/board/policy/indicator); there is no discrete substance to
declare into the log.

## Lanes & parallelism

`lane` is informational only; the real contract is `dependsOn` + disjoint scopes.

- **foundation** — E1.1 → E1.2 → E1.3 (the critical path; the surfaces wait on E1.2,
  the route on E1.2).
- After E1.2 lands, **seven items become claimable in parallel**: E1.3 (route), E2
  (import), E3.1 + E3.2 (authoring), E4.1 + E4.2 (validation), E5 (actuation).
- **proof** — E6 waits on E1.3 + all six surfaces.
- The two shared derived views live in `build-path/core/` (E1.1) so the disjointness
  panel/actuator and the prompt-preview/actuator don't duplicate logic or collide.

## Work items

All scopes: `repo: de-braighter/studio`. pathPrefix is repo-relative.

| itemId | title | pathPrefix | dependsOn | lane | qualityObligations |
|---|---|---|---|---|---|
| `…/E1.1` | Core: `BuildPathDraft`/`BuildNode` model + in-memory kernel-shaped `BuildPathDraftStore` (adapt `plan-tree/` store) + the two pure derived views `computeScopeDisjointness()` and `projectDraftToQueueItems()`, with unit tests | `apps/studio-ui/src/app/build-path/core/` | — | foundation | wave-standard, zero-kernel-change, two-trees-discipline |
| `…/E1.2` | Shell: build the `BuildPathDesignerContainer` (modelled on `plan-author.component.ts`) + create stub standalone components in each surface folder (canvas/inspector/disjointness/prompt-preview/actuator) + a stub `projectCharterToDraft` in charter-import, so the container compiles and the surfaces fill in place. Does NOT edit `app.routes.ts`. | `apps/studio-ui/src/app/build-path/` | `…/E1.1` | foundation | wave-standard, zero-kernel-change, two-trees-discipline, a11y-battery |
| `…/E1.3` | Route: register the lazy `/build-path` route in `app.routes.ts` pointing at `BuildPathDesignerContainer`. The ONLY shared-file edit — isolated as a sequencing item so no surface item touches `app.routes.ts`. | `apps/studio-ui/src/app/app.routes.ts` | `…/E1.2` | foundation | wave-standard, zero-kernel-change |
| `…/E2` | Charter import: implement `projectCharterToDraft(charter)` — charter-shaped input → single-parent `BuildPathDraft` of typed `BuildNode`s; wire the shell's "Load charter" action | `apps/studio-ui/src/app/build-path/charter-import/` | `…/E1.2` | import | wave-standard, zero-kernel-change |
| `…/E3.1` | Canvas: implement the board-kit binding (reuse `plan-tree/project.ts` + `edit-mapping.ts` patterns) — draft→RenderNode projection, EditIntent→BuildPathEdits, gate nodes render distinctly; `move` maps to no edit | `apps/studio-ui/src/app/build-path/canvas/` | `…/E1.2` | authoring | wave-standard, zero-kernel-change, two-trees-discipline, a11y-battery |
| `…/E3.2` | Node inspector: edit label/kind/`dependsOn`; for work-items add `scope` + a compact quality summary with one effort knob (light/standard/deep); for gate nodes the gate metadata — not a form-heavy admin surface | `apps/studio-ui/src/app/build-path/inspector/` | `…/E1.2` | authoring | wave-standard, zero-kernel-change, a11y-battery |
| `…/E4.1` | Disjointness panel: consume `computeScopeDisjointness()`; list scope overlaps across work-items; clash badges on conflicting nodes; expose a `hasConflicts` signal the actuator gates on | `apps/studio-ui/src/app/build-path/disjointness/` | `…/E1.2` | validation | wave-standard, zero-kernel-change, a11y-battery |
| `…/E4.2` | Prompt-preview panel: consume `projectDraftToQueueItems()`; render the worker-session prompts Foundry would generate, before commit | `apps/studio-ui/src/app/build-path/prompt-preview/` | `…/E1.2` | validation | wave-standard, zero-kernel-change, a11y-battery |
| `…/E5` | Push actuator: the one-way door — call `foundry_queue_push` with `projectDraftToQueueItems()`; disable while `computeScopeDisjointness()` reports conflicts; idempotent; founder checkpoint before live actuation | `apps/studio-ui/src/app/build-path/actuator/` | `…/E1.2` | actuation | wave-standard, zero-kernel-change, a11y-battery, push-actuator-review |
| `…/E6` | Wedge proof: integration test driving charter → draft → resolve conflicts → push (mocked actuation), asserting the queue payload; document a manual run for the ship gate | `apps/studio-ui/src/app/build-path/` | `…/E1.3`, `…/E2`, `…/E3.1`, `…/E3.2`, `…/E4.1`, `…/E4.2`, `…/E5` | proof | wave-standard, zero-kernel-change |

## Disjointness proof

**Dependency order:** `E1.1 ≺ E1.2 ≺ {E1.3, E2, E3.1, E3.2, E4.1, E4.2, E5} ≺ E6`.
All pairs involving E1.1, E1.2, or E6 are **ordered** (transitively dependent) and
may share scope safely — no proof needed. The **only** unordered pairs are within the
middle layer of seven items (the route item + six surfaces), each of which only
`dependsOn` E1.2.

- **E1.3** (`app.routes.ts`, a single file) vs each surface (`build-path/<x>/`):
  non-nested → disjoint by **rule 2** (normalize `app.routes.ts/` vs `build-path/…/`).
- **surface ↔ surface** (`build-path/` sibling folders): non-nested → disjoint by **rule 2**.

Middle-layer scopes: `app.routes.ts` (E1.3) · `charter-import/` (E2) · `canvas/`
(E3.1) · `inspector/` (E3.2) · `disjointness/` (E4.1) · `prompt-preview/` (E4.2) ·
`actuator/` (E5). C(7,2) = 21 unordered pairs, all disjoint:

| Unordered pair | Evidence | Verdict |
|---|---|---|
| E1.3 ↔ E2 | `app.routes.ts` vs `build-path/charter-import/` — non-nested | disjoint |
| E1.3 ↔ E3.1 | `app.routes.ts` vs `build-path/canvas/` — non-nested | disjoint |
| E1.3 ↔ E3.2 | `app.routes.ts` vs `build-path/inspector/` — non-nested | disjoint |
| E1.3 ↔ E4.1 | `app.routes.ts` vs `build-path/disjointness/` — non-nested | disjoint |
| E1.3 ↔ E4.2 | `app.routes.ts` vs `build-path/prompt-preview/` — non-nested | disjoint |
| E1.3 ↔ E5 | `app.routes.ts` vs `build-path/actuator/` — non-nested | disjoint |
| E2 ↔ E3.1 | `charter-import/` vs `canvas/` — non-nested | disjoint |
| E2 ↔ E3.2 | `charter-import/` vs `inspector/` — non-nested | disjoint |
| E2 ↔ E4.1 | `charter-import/` vs `disjointness/` — non-nested | disjoint |
| E2 ↔ E4.2 | `charter-import/` vs `prompt-preview/` — non-nested | disjoint |
| E2 ↔ E5 | `charter-import/` vs `actuator/` — non-nested | disjoint |
| E3.1 ↔ E3.2 | `canvas/` vs `inspector/` — non-nested | disjoint |
| E3.1 ↔ E4.1 | `canvas/` vs `disjointness/` — non-nested | disjoint |
| E3.1 ↔ E4.2 | `canvas/` vs `prompt-preview/` — non-nested | disjoint |
| E3.1 ↔ E5 | `canvas/` vs `actuator/` — non-nested | disjoint |
| E3.2 ↔ E4.1 | `inspector/` vs `disjointness/` — non-nested | disjoint |
| E3.2 ↔ E4.2 | `inspector/` vs `prompt-preview/` — non-nested | disjoint |
| E3.2 ↔ E5 | `inspector/` vs `actuator/` — non-nested | disjoint |
| E4.1 ↔ E4.2 | `disjointness/` vs `prompt-preview/` — non-nested | disjoint |
| E4.1 ↔ E5 | `disjointness/` vs `actuator/` — non-nested | disjoint |
| E4.2 ↔ E5 | `prompt-preview/` vs `actuator/` — non-nested | disjoint |

**Shared-file safety:** the one shared mutation (the `/build-path` route line in
`app.routes.ts`) lives only in E1.3 (its own sequencing item) — every surface
`dependsOn` E1.2 and touches only its own folder. The two shared pure derived views
live in `build-path/core/` (E1.1) — read by E4.1/E4.2/E5 via imports (read-only;
writes stay in `core/`).

**Cross-product disjointness** (the live `studio` Foundry product has queued items):
`studio-recipe-s3-fastfollows` is scoped to `apps/studio-ui/src/app/recipe-designer/`
and `studio-recipe-s4-persistence-design` to `domains/studio/docs/superpowers/specs/`.
Every System Builder Studio item is under `apps/studio-ui/src/app/build-path/…` or is
the single file `apps/studio-ui/src/app/app.routes.ts` — **all non-nested vs
`recipe-designer/` and the specs path** → disjoint. (This is why E1.2 was tightened
to `build-path/` and the route isolated in E1.3 — a broad `…/src/app/` shell scope
would have nested over `recipe-designer/` and serialized against live recipe work.)

**Dangling-`dependsOn` check:** every referenced id (`E1.1`, `E1.2`, `E1.3`, `E2`,
`E3.1`, `E3.2`, `E4.1`, `E4.2`, `E5`) appears in the item list. ✓ No dangling
dependencies.
