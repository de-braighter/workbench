---
product_key: system-builder-studio
build_path_date: 2026-06-24
status: build-path
charter: docs/foundry/system-builder-studio/charter.md
plan: docs/superpowers/specs/2026-06-24-face-realization-plan.md
handoff: docs/ui-design/path-builder-studio-handoff/
risk_tier: T0
item_count: 8
phase: Face Realization — Authoring side (Catalog/Editor/ItemEditor + Shell)
---

# Build Path — Face Authoring side (metamodel → surfaces → shell)

> The bulk of the face. Builds the handoff's authoring surfaces on a shared **metamodel** foundation,
> surfaces-first (each routeless + standalone, like F1/F2), then the 3-tab **Studio shell** mounts them
> all last. Cockpit side (Betrieb=operate F1, Ergebnisse=calibration F2) already done. The handoff is a
> base — recreate faithfully, extend thin spots. Apply the **F1 CSS-budget pattern** on every surface.

## Design source
- `docs/ui-design/path-builder-studio-handoff/` — `Catalog.dc.html`, `Editor.dc.html`,
  `ItemEditor.dc.html`, `Studio.dc.html`; README §"data model" (the 8 libraries + item shapes +
  derived relationships) + §§2–4 + Interactions/State. Read the logic classes (the spec).
- Tokens: published `@de-braighter/design-system` + `exercir` skin; do NOT copy `colors_and_type.css`.

## Convergence calls (documented; consistent with the founder supersede decision)
- **Editor reuses `build-path/`** — the handoff Editor is the canonical plan-tree editor; reuse the
  shipped `BuildPathDraft` model + push actuator (`build-path/core`, `build-path/actuator`) where they
  fit, presenting the handoff UI. The old `build-path/` *designer container* becomes legacy tidy-up.
- **Ergebnisse → F2 Reproduzierbarkeit** — the shell routes results to the F2 `CalibrationPage`,
  superseding the old `ResultsDashboardComponent` (tidy-up later).
- New folders only; do NOT touch the superseded `studio/**` path-builder.

## ADR needs & gates
**None.** T0, `zero-kernel-change` (UI + a pack-level in-memory metamodel store; composes-not-authors;
derived-relationships compute-not-store per ADR-176). Gates WAIVED (T0).

## Quality battery config
`wave-standard` + `zero-kernel-change` on all; `a11y-battery` + `two-trees-discipline` on all UI items
(AUTH-2..8). `yields`: omitted (UI/infra).

## Work items
All scopes `repo: de-braighter/studio`; pathPrefix repo-relative. NEW folders (avoid colliding with
recipe-designer's catalog / the superseded studio/).

| itemId | title | pathPrefix | dependsOn | lane |
|---|---|---|---|---|
| `…/AUTH-1-metamodel` | The catalog **metamodel**: the 8 libraries (systems/subjects/phases/capabilities/traits/interventions/resources/actions) + their item shapes (README §data-model) + an in-memory catalog store + **pure derived-relationship functions** (used-by, aggregated-by, cycle-protection) — compute-not-store. No UI. | `apps/studio-ui/src/app/metamodel/` | — | metamodel |
| `…/AUTH-2-catalog` | **Catalog** surface (README §2): 8-library browser — top bar + segmented tabs + search + visibility filter rail + responsive card grid; cards per the handoff; "New" + open routes (emit onNavigate). High fidelity. | `apps/studio-ui/src/app/catalog-browser/` | `…/AUTH-1-metamodel` | catalog |
| `…/AUTH-3-editor` | **Editor** (README §3): the Systems plan-tree editor — indented-outline graph pane + node inspector (work → Gaussian-prior bell curve μ±σ/confidence/basis; gate → conditions + Freigeben/Zurückweisen; epic → counts) + "In Foundry ausführen" actuation. **Reuse `build-path/` BuildPathDraft model + push actuator.** | `apps/studio-ui/src/app/system-editor/` | `…/AUTH-1-metamodel` | editor |
| `…/AUTH-4-item-editor` | **ItemEditor** shell + the SIMPLE types (README §4): the adaptive full-page container + single-column editors for trait (scale viz + measures), resource, phase (conditions), subject. Mounts the richer sub-editors (AUTH-5/6) via slots. | `apps/studio-ui/src/app/item-editor/` | `…/AUTH-1-metamodel` | item-editor |
| `…/AUTH-5-item-capability` | ItemEditor **capability** sub-editor: the two-pane read-from tree (indented inputs + per-node inspector, weight/share %, per-trait scale override, cycle protection). | `apps/studio-ui/src/app/item-editor/capability/` | `…/AUTH-4-item-editor` | item-editor |
| `…/AUTH-6-item-intervention` | ItemEditor **intervention + action** sub-editor: the merged predicted-effect editor (changes w/ magnitude-prior Gaussian SVG, confidence, basis, evidence), needs, the ordered action-chain + fail-fast; action config (webhook/integration/script). | `apps/studio-ui/src/app/item-editor/intervention/` | `…/AUTH-4-item-editor` | item-editor |
| `…/AUTH-7-studio-shell` | **Studio shell** (README §1): the 3-tab chrome (Katalog/Betreiben/Ergebnisse) + in-app screen routing that MOUNTS all surfaces — Katalog→catalog-browser, Betreiben→operate (F1), Ergebnisse→calibration (F2 Reproduzierbarkeit), editor→system-editor, item→item-editor. Skin = profile. | `apps/studio-ui/src/app/studio-shell/` | `…/AUTH-2-catalog`, `…/AUTH-3-editor`, `…/AUTH-4-item-editor` | shell |
| `…/AUTH-8-shell-route` | Route `'' → StudioShell` in `app.routes.ts` (the one shared-file edit; isolated). Keep existing routes intact. | `apps/studio-ui/src/app/app.routes.ts` | `…/AUTH-7-studio-shell` | shell |

## Disjointness proof
All `repo: de-braighter/studio`. Dependency order: `AUTH-1 ≺ {AUTH-2, AUTH-3, AUTH-4}`; `AUTH-4 ≺
{AUTH-5, AUTH-6}`; `{AUTH-2,3,4} ≺ AUTH-7 ≺ AUTH-8`. Unordered pairs are all distinct folders → disjoint
by path: `metamodel/` · `catalog-browser/` · `system-editor/` · `item-editor/` · `item-editor/capability/`
· `item-editor/intervention/` · `studio-shell/` · `app.routes.ts`. The only prefix-nesting
(`item-editor/` ⊃ `item-editor/capability|intervention/`) is ORDERED (5,6 dep 4) → safe. All new folders
are non-nested siblings of existing `operate/`, `calibration/`, `spine/`, `build-path/`,
`recipe-designer/`, `studio/**` → disjoint. Dangling check: every referenced id is in the list. ✓
No cross-repo / ADR items.
