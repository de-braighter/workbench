# Board Editor Studio — standalone, reconciled to the `(3)` handoff

**Date:** 2026-06-24
**Product:** `board-editor-studio` (T0) — extends `domains/studio`, **does not** scaffold a new domain.
**Status:** design (founder-approved 2026-06-24; supersedes the chartered "extends `apps/studio-ui` / adds nav" repo plan — charter amendment is the first gated step). **Amended 2026-06-25 — see §0.**
**Charter:** `docs/foundry/board-editor-studio/charter.md` (amended) · **Build-path:** `docs/foundry/board-editor-studio/build-path.md` (E1.1–E8.1 + R1a–R4 all done; 16 total).

---

## 0. CORRECTION (2026-06-25) — the `(3)` handoff is a REDESIGN, not a reskin

> **The reconciliation in §4 below was wrong, and this is the load-bearing lesson of the arc.**
> §4 reconciled the `(3)` handoff as a **reskin** ("same surfaces → KEEP structure, RE-SKIN
> tokens"). That verdict came from **grepping `Board Editor Studio.dc.html` for surface
> inventory** (railSections, cards, drawer, settings) and matching those *concepts* to existing
> components — without **building from the design and comparing rendered views to the
> screenshots**. R1–R3 therefore re-themed the original `(1)`-built **dense, all-stacked**
> layout; the founder served the live app (R2/R3) and said it looked **"completely different
> than (3)"**. They were right.
>
> **What the `(3)` handoff actually is:** a single-pane, **`lib`-driven VIEW-SWITCHED** app
> (`lib ∈ {node, settings, composites, k:<kind>}`) — the LEFT RAIL is a **navigator** (Build →
> Node layers / Board settings; Compose → Composites; Primitives → per-kind, each with a count +
> accent indicator), the CENTER shows **one focused view** at a time, the RIGHT is a
> **persistent** live preview, and a **slide-over drawer** edits definitions. The live app had
> none of that `lib`-switch — it stacked every surface on one scroll.
>
> **The fix — `board-editor-studio/R4`** (studio#77, shipped 2026-06-25): rebuilt the
> `libs/board-editor` catalog-designer SHELL to the `(3)` view-switched IA, **built directly from
> `docs/ui-design/board-editor-studio-handoff/Board Editor Studio.dc.html`** (whose
> `renderVals()` defines the rail / `lib` switch / per-view labels), reusing the model +
> interpreter + every sub-component byte-identical (parity green), and **browser-verifying each
> view against the screenshots**. Persistence (E8.1) is tucked behind the top-bar "catalog" pill.
>
> **RULE (carry forward):** for a UI design handoff, **BUILD FROM the design source and
> browser-verify each view against the screenshots before declaring a match.** "The same
> components exist" ≠ "the same layout." A grep of a `.dc.html` proves inventory, not IA. Treat
> §3–§4 below as the *standalone + token* reconciliation (correct), NOT the *layout*
> reconciliation (which §0/R4 supersede).

---

## 1. Goal & founder constraints

Make the Board Editor Studio (the catalog IDE shipped as `domains/studio` Recipe Designer
slices 1–3 + foundry items E1.1–E8.1) a **standalone product**, **off the cockpit shell**,
and **reconciled to its latest `(3)` design handoff** (the three-skin chrome system).

Founder decisions (constraints — not relitigated):

1. **Standalone.** Explicitly **not** part of the unified cockpit / System Builder Studio
   fusion (per the "Out of scope — recipe-builder" note in
   `docs/superpowers/specs/2026-06-24-unified-cockpit-masterplan.md`, wb#201). "We do not
   integrate it yet."
2. **Zero kernel change.** Composes published `@de-braighter/*` packages; authors no kernel
   concept (ADR-176, packs-compose-not-author). The interpreter core
   (`@de-braighter/design-system-core` board-kit: `interpretRecipe`/`validateRecipe`/
   `EditorRecipe`/`<ds-board-kit>`) is **reused, never rebuilt**.
3. **T0 product**, existing greenlight gate (`88363656-…`). Every merge-to-main is
   founder-gated (cluster governance); architecture gate only if a `design-system-core`
   brick change is forced (not expected here).

Founder calls settled in brainstorming (2026-06-24):

- **(a) Standalone form:** new app `apps/board-editor-ui` + extracted lib `libs/board-editor`.
- **Charter:** amend (founder-gated) — the `(3)` scope reverses the chartered repo plan and
  un-defers the skin system.
- **Carry-over scope:** the **catalog IDE only** (`CatalogDesignerComponent`); **retire** the
  legacy single-shape `RecipeDesignerComponent` + `/recipe-designer` route.
- **R1 atomicity:** **split green-at-each-step** (R1a → R1b → R1c), not one mega-PR.
- **Skin tokens:** consume the published `@de-braighter/design-system-css@^1.7.0` (`tokens.css`
  export) — it's an installable package; no vendored fallback.

---

## 2. What already exists (subtract, don't rebuild)

- **Foundry product `board-editor-studio`** — full pipeline on disk
  (`docs/foundry/board-editor-studio/`); `foundry_status` shows **10/10 done**. The catalog
  IDE *logic* is built and parity-proven (mirrors `plan-kinds-parity.spec.ts`).
- **Implementation** — `domains/studio/apps/studio-ui/src/app/recipe-designer/` (~40 files):
  `catalog-designer` (shell), `catalog`/`catalog-document`(+reverse), `catalog-store`/
  `local-storage-catalog-store`, `catalog-card`, `instance-row`, `composite`/
  `composite-parts-editor`, `svg-primitive-editor`, `definition-drawer`, `board-settings`,
  `usage-analytics`, `catalog-designer.component.css`, plus the legacy slice-1–3 chain
  (`recipe-designer.component`, `shapes-editor`, `shape-editor`, `primitives-editor`,
  `recipe-form`, `sample-tree`, `plan-kinds.recipe`).
- **Cockpit wiring (to remove):** `app.routes.ts` mounts `{ path: 'recipe-designer',
  component: RecipeDesignerComponent }` and a lazy `{ path: 'catalog', … CatalogDesignerComponent }`
  with a `CATALOG_STORE` route provider, plus 3 head imports. **Two** route tests pin this:
  `app.spec.ts:29` (`'should declare the recipe-designer route'`) and `app.routes.spec.ts`
  (component assertions + exact table `['', '**', 'catalog', 'operate', 'recipe-designer']`).
- **Skins shipped** in `@de-braighter/design-system-css` (`ivory`/`clinical`/`night` + chrome
  tokens, design-system#215). The studio app **vendored a stale `src/theme/tokens.css`** that
  omits `ivory`/`clinical` and the chrome tokens, plus a `handoff-token-compat.css` shim.

### 2.1 Import-graph fact (why retire + extract is surgical)

The legacy form and the catalog IDE are **import-disjoint**:

```
RecipeDesignerComponent
  → shapes-editor → shape-editor → primitives-editor
  → recipe-form (ShapeRow/PrimRow, buildRecipeFromForm)
  → sample-tree, plan-kinds.recipe
```

**No catalog-IDE file imports any node of that chain** (`recipe-form`/`PrimRow` is imported
only by the legacy chain). The catalog IDE has its **own** `svg-primitive-editor` (E3) and
the `definition-drawer` field grid; it does not reuse `primitives-editor`. So "retire the
legacy form" and "extract the catalog IDE to a lib" are cleanly separable. The exact retire
set = files reachable **only** from `RecipeDesignerComponent`; the worker traces reachability
at build time (notably `sample-tree` — retire only if the catalog preview does not reuse it).

---

## 3. The `(3)` handoff is structurally the same IDE

`docs/ui-design/board-editor-studio-handoff/Board Editor Studio.dc.html` (+ `Instance Row.dc.html`,
screenshots `ivory/clinical/migrated/prims.png`) depicts the **same** catalog IDE already
built — every surface maps 1:1 to an existing component:

| `(3)` surface | Built component |
|---|---|
| Top bar (`railSections` host, search, `+New`, Reset) | app shell (cockpit's `StudioShell` today) |
| BUILD/COMPOSE/PRIMITIVES rail + counts | `catalog-designer` |
| Node-layers + "+ place definition" | `catalog-designer` |
| Card library (filter/count/mini-preview/empty/`unused`) | `catalog-designer` + `catalog-card` |
| Instance Row (↑↓/dup/del + x/y offset) | `instance-row` |
| Composites + cycle detection | `composite-parts-editor` |
| `svg` primitive | `svg-primitive-editor` |
| Detail drawer (primitive/composite/used-in) | `definition-drawer` |
| Board settings (identity/interactions/bounds) | `board-settings` |
| Cross-ref usage analytics | `usage-analytics` (derived) |
| Live preview + diagram↔code + copy-JSON | `catalog-designer` + `<ds-board-kit>` |

**The `(3)` delta is the skin layer, not the surfaces.** The current
`catalog-designer.component.css` is hardcoded **night-only** (`--bg,#0a0d14` dark fallbacks; a
**teal** accent baked in as `#22d39a`/`rgba(34,211,154,…)`, plus `#7c6dfa`/`#f87171`/`#fbbf24`
literals) and uses **none** of the `(3)` chrome tokens. Under `ivory`/`clinical` it renders
with the wrong accent and flat (non-glass) chrome.

---

## 4. Reconciliation verdict — KEEP / RE-SKIN / REBUILD

- **KEEP (logic, untouched):** the catalog model, `buildRecipeFromCatalog` expander, every
  interactive component, and **all existing tests + parity/persistence specs**. Zero
  `design-system-core` change (preserves the slices-1–3 / E1–E8 posture).
- **RE-SKIN (the real work):** `catalog-designer.component.css` + component inline styles →
  drop the night-only fallbacks + the hardcoded `#22d39a`/`rgba(34,211,154…)`/`#7c6dfa`/
  `#f87171`/`#fbbf24` literals → pure canonical tokens + the chrome tokens.
- **REBUILD:** ~nothing structural. New **additions** only: the standalone app shell + the
  `[data-theme]` skin switcher.

### 4.1 Canonical token vocabulary (the ONLY allowed names)

Use: `--bg`, `--bg-elev`, `--bg-sunken`, `--paper`; `--ink`/`--ink-2`/`--ink-3`/`--ink-4`;
`--rule`/`--rule-strong`; `--accent`/`--accent-2`/`--accent-soft`/`--accent-rim`/`--accent-on`;
`--glass-bg`, `--glass-blur`, `--rail-bg`, `--scrim`, `--glass-shadow`, `--grid-dot`,
`--code-str`/`--code-num`; status `--color-ok|-warn|-risk` (+ `-soft`); fonts
`--font-display` (Newsreader serif), `--font-ui` (Inter Tight), `--font-mono`.

**Forbidden (retired) — never reintroduce:** `--bg-0..3`, `--fg-1..4`, `--line-1..3`,
`[data-skin]`, Space Grotesk. (The Claude-Design `colors_and_type.css` export may still carry
retired names — fold its **intent** into the canonical tokens; never paste its CSS verbatim.)

Literal → token remap for the reskin:

| Current literal | Role | Canonical token |
|---|---|---|
| `#22d39a`, `var(--accent,#22d39a)` | accent | `var(--accent)` |
| `rgba(34,211,154,.1/.12)` | accent fill/active | `var(--accent-soft)` |
| accent outline | focus ring | `var(--accent-rim)` / `var(--accent-soft)` |
| `#0a0d14` (`--b1`) | canvas/board bg | `var(--bg)` |
| `#0f1320` (`--b2`) | card/panel bg | `var(--paper)` / `var(--bg-elev)` |
| `#7c6dfa` | composite badge | `var(--accent-2)` (or a documented composite token) |
| `#f87171` / `#fbbf24` | delete / warn | `var(--color-risk)` / `var(--color-warn)` (+ `-soft`) |
| (none today) | top bar/drawer/code glass | `var(--glass-bg)` + `var(--glass-blur)` |
| (none today) | left rail | `var(--rail-bg)` |
| (none today) | drawer scrim/shadow | `var(--scrim)` / `var(--glass-shadow)` |
| (none today) | preview grid dots | `var(--grid-dot)` |
| (none today) | code view string/number | `var(--code-str)` / `var(--code-num)` |
| `--accent` text on a button fill | button label | `var(--accent-on)` |

Node cards drawn on the preview canvas are **authored content** (a shape's own `fill`), not
chrome — intentionally theme-independent; do **not** token-swap them.

---

## 5. Standalone topology

```
domains/studio/
  apps/
    studio-ui/         ← cockpit (drops /recipe-designer + /catalog; retires legacy form)
    board-editor-ui/   ← NEW thin app: index.html [data-theme=night], shell + skin switcher
  libs/
    board-editor/      ← catalog-IDE sources (public API; nx-tagged)
```

### 5.1 `libs/board-editor` (new Angular library, ng-packagr, pnpm-workspace package)

**Mechanism (corrected from "Nx" — `domains/studio` is NOT Nx):** `domains/studio` is a
**pnpm-workspace** (`packages: ["apps/*"]`) whose `apps/studio-ui` is a self-contained
**Angular-CLI** workspace (its own `angular.json`, npm-pinned). There is no `libs/` dir yet.
The cluster-idiomatic "extracted lib" is therefore an **Angular library built with ng-packagr,
published as a workspace package** — exactly the `design-system` libs pattern — not an Nx lib.

- **Add `libs/*`** to `domains/studio/pnpm-workspace.yaml` packages.
- **`libs/board-editor`** = a new pnpm-workspace package `@de-braighter/board-editor`: an
  Angular library (ng-packagr) with `build` + `test` scripts (so root `pnpm -r run build/test`
  picks it up, topologically before the apps that depend on it).
- **Moves in:** `catalog-designer`(+css/spec), `catalog`/`catalog-document`(+reverse spec),
  `catalog-store`/`local-storage-catalog-store`(+spec), `catalog-card`, `instance-row`(+spec),
  `composite`(+spec)/`composite-parts-editor`(+spec), `svg-primitive-editor`(+spec)/
  `svg-primitive.spec`, `definition-drawer`(+spec), `board-settings`(+spec), `usage-analytics`
  specs, `catalog-parity.spec`, `catalog-store-persistence.spec`. Pure **move** — no behaviour
  change; tests move with sources and stay green.
- **Public API** (`src/public-api.ts`): `CatalogDesignerComponent`, `CATALOG_STORE`,
  `LocalStorageCatalogStore`. `public-api-stabilizer` ViewModel contract; everything else stays
  internal (not re-exported).
- **Dependency boundary:** depends only on `@de-braighter/design-system-{core,angular}` +
  Angular; nothing app-specific. The boundary is enforced by the **ng-packagr public-api entry
  + the pnpm-workspace package edge** (+ eslint import rules) — **not** Nx tags (N/A here).
- **Consumers:** `apps/board-editor-ui` (primary) and, *transiently* during the green split,
  `apps/studio-ui` (R1a repoints `/catalog` to `@de-braighter/board-editor`; R1c drops the dep).

### 5.2 `apps/board-editor-ui` (new thin app)

- `index.html`: `<html lang="en" data-theme="night">`; loads the **published**
  `@de-braighter/design-system-css` tokens (ivory/clinical/night + chrome).
- **App shell** = the `(3)` top bar: product mark + `catalog` pill + **skin switcher**
  (ivory/clinical/night, writes `data-theme` on the root) + Reset wiring; glass chrome via
  `--glass-bg`/`--glass-blur`. Standalone-component, signals, no cockpit `StudioShell`.
- **Route** `'/'` → `CatalogDesignerComponent` (from the lib) + the `CATALOG_STORE` provider
  (`LocalStorageCatalogStore`). No `handoff-token-compat.css` shim.
- Consumes published `@de-braighter/design-system-core`, `@de-braighter/design-system-angular`,
  and `@de-braighter/design-system-css@^1.7.0` (imports `tokens.css`); pins **npm** like
  `studio-ui` (`packageManager`; never pnpm in the app).

### 5.3 Cockpit `apps/studio-ui` decouple (atomic with the above)

- Remove the `/recipe-designer` + `/catalog` routes, the 3 head imports, and the
  `CATALOG_STORE` route provider from `app.routes.ts` → new table `['', '**', 'operate']`.
- Update **`app.spec.ts`** (drop/replace the line-29 smoke test) **and `app.routes.spec.ts`**
  (drop the `RecipeDesignerComponent`/`CatalogDesignerComponent` assertions; new expected
  table). The "recipe-designer route trap" *comments* elsewhere (`operate.page.ts`,
  `catalog-browser/*`, `calibration.page.ts`) are non-blocking; refresh opportunistically.
- **Retire** the legacy `RecipeDesignerComponent` chain (files reachable only from it).
- **knip green** in `studio-ui` (no orphaned files) — guaranteed because the catalog IDE now
  lives in the lib consumed by the new app, and the legacy chain is deleted.

---

## 6. Skin wiring (the `(3)` + skins handoff)

- **Source of tokens:** consume the **published `@de-braighter/design-system-css@^1.7.0`**
  (confirmed published in the GH registry + already consumed by `domains/exercir@^1.7.0` and
  `herdbook/apps/web`) and import its **`tokens.css`** export. Verified 2026-06-24: the emitted
  `tokens.css` carries `[data-theme="ivory|clinical|night"]` blocks **including** the chrome
  tokens (`--glass-*`, `--rail-bg`, `--scrim`, `--glass-shadow`, `--grid-dot`, `--accent-on`,
  `--code-str/num`) per design-system#215. **Use `tokens.css`, not the `skins/skin-*.css`
  exports** — those are the **retired `[data-skin]` overlays** (`skin-club-grass`,
  `skin-warmlight-fcl`), out of scope. Do **not** copy the stale studio `theme/tokens.css`.
- **Theming model:** base color + chrome tokens are defined **only** inside each `[data-theme]`
  block (no `:root` fallback) — a theme **must** be set on the root or the UI renders
  unstyled. `index.html` sets `data-theme="night"` by default; the switcher rebinds it.
- **Switcher:** a top-bar control writing `ivory|clinical|night`. (This is the `[data-theme]`
  skin switcher; distinct from the deferred `[data-skin]` exercir/strategir switcher, which
  stays out of scope.)
- **Verify each skin** against `screenshots/{ivory,clinical,migrated}.png`: text contrast
  (`--ink` on `--bg`), accent affordances (`--accent`/`--accent-soft`/`--accent-rim`), glass
  chrome, and the code panel (`--code-*` tuned light on ivory/clinical, dark on night).

---

## 7. Build-path shape (appended to the EXISTING product)

The 10 done items (E1.1–E8.1) are **never re-pushed**. New itemIds only.

**Gate-0 — Charter amendment (founder-gated, docs-only):** amend `charter.md` — Repo plan →
"NEW `apps/board-editor-ui` + `libs/board-editor`, decoupled from the cockpit"; Scope → "+ the
`[data-theme]` ivory/clinical/night skin system"; status `chartered → amended`. Then `/build-path`.

**R1 — Decouple & stand alone** (the first epic; **founder decision 2026-06-24: split
green-at-each-step**, NOT one mega-PR — each sub-item builds + tests green and never
knip-orphans the folder). Sub-item sequence:
- **R1a — extract `libs/board-editor`:** move the catalog-IDE sources (traced closure) into a
  new Nx lib + public API (`index.ts`) + nx-tags, **and repoint the cockpit `/catalog` route's
  import to the lib**. `studio-ui` stays green; `/catalog` still works; knip green (lib
  consumed by the cockpit).
- **R1b — scaffold `apps/board-editor-ui`:** thin shell (top bar + skin switcher, night
  default) + route `'/'` → `CatalogDesignerComponent` from the lib + published deps.
  **Browser-verify** the new app serves.
- **R1c — decouple the cockpit:** remove `/recipe-designer` + `/catalog` routes + imports +
  provider from `app.routes.ts`; update **`app.spec.ts`** + **`app.routes.spec.ts`** (new
  table `['', '**', 'operate']`); **retire** the legacy `RecipeDesignerComponent` chain. knip
  green (the lib is now consumed only by the new app).

**R2 — Reskin to the `(3)` chrome contract:**
- rewrite `catalog-designer.component.css` + component inline styles to pure canonical tokens
  + chrome tokens (§4.1 remap);
- consume published `@de-braighter/design-system-css`; wire the skin switcher;
- **browser-verify all three skins** (`ivory`/`clinical`/`night`) against the handoff
  screenshots — the "tests green ≠ renders" gate.

**(Optional) R3 — a11y polish:** adopt `DbRovingToolbar`/`DbRovingItem` on the Instance Row
toolbar; re-confirm existing WCAG-2.4.3 focus-recovery tests under the new app.

### 7.1 Quality obligations (per item, from the charter quality plan + this task)

- `tdd` — test-first (R1 is mostly a move/repoint, but new app-shell + switcher are TDD).
- `review-floor` — ≥1 `/code-review`; full verifier wave (`local-ci` + `reviewer` +
  `qa-engineer`; `charter-checker` if any brick change is forced) on non-trivial PRs,
  worktree-isolated.
- **`opus-whole-branch`** — non-negotiable per product history (caught CRITICAL
  data-loss/focus regressions on every slice 1–3).
- `parity-proof` — the move/reskin must **not** change behaviour; the existing parity +
  persistence specs guard it (a reskin that alters rendered structure must keep them green).
- `a11y-focus-recovery` — the existing reorder/remove/drop/drawer focus tests must stay green
  (fixture on `document.body`, asserts focus lands on a surviving non-disabled control — the
  jsdom-vs-real-browser blur trap).
- **browser-verify** — serve `apps/board-editor-ui` (`:4200`) + screenshot each skin; a
  passing suite does not prove the UI renders.
- **a11y battery (WCAG 2.2 AA)** on UI items.
- **Zero kernel change** — `charter-checker` enforces.
- Governance skills: `architecture-concierge` (validate the plan), `public-api-stabilizer` (the
  lib's `public-api.ts`), `reactive-forms-cva-governance` (board-settings / instance-row stay
  CVA), `angular-signals-standalone-governance`. (`nx-tag-architecture-governance` is **N/A** —
  non-Nx repo; the boundary is the ng-packagr public-api + the pnpm-workspace package edge.)
- Acceptance per item: `npm test` green + `npm run build` green at the app/lib level (the app
  pins npm; **never pnpm** in `apps/*`).

### 7.2 Conduct

`/build-path` registers the new items on the existing `board-editor-studio` product (DISJOINT
scopes; `dependsOn` chain R1 → R2 → R3). Then conduct opus-pinned `/foundry-worker`s,
hand-conducted on completion notifications (the foundry-worker skill worktrees the studio
clone itself — do **not** Agent-tool-isolate the worker). Per-PR `Producer:` / `Effort:` lines
+ the twin ritual (drain → backfill → reconcile) after each merge. Every merge-to-main is a
founder "go".

---

## 8. Risks & open issues

1. **`sample-tree` reachability.** If the catalog preview reuses `sample-tree.ts`, it is
   **shared** → moves to the lib (not retired). The R1 worker traces the exact import closure
   from `RecipeDesignerComponent` before deleting anything.
2. **~~Published `@de-braighter/design-system-css` consumability.~~ RESOLVED 2026-06-24.**
   It is published (`1.7.0`, GH registry) and already consumed by `domains/exercir`/`herdbook`;
   its `tokens.css` export carries the `[data-theme="ivory|clinical|night"]` blocks + chrome
   tokens (verified). The new app consumes `@de-braighter/design-system-css@^1.7.0` and imports
   `tokens.css`. No vendored fallback; no `design-system` republish needed.
3. **`pnpm` vs `npm` discrepancy** in `domains/studio` (root `pnpm-workspace.yaml`; apps pin
   npm). Workers run app/lib-level npm scripts; must not introduce pnpm into `apps/*`. The new
   lib must build under the repo's `-r` orchestration without breaking the app's npm acceptance.
4. **~~Atomicity vs PR size.~~ RESOLVED 2026-06-24: split green-at-each-step** (R1a → R1b →
   R1c per §7), each sub-PR green and never knip-orphaning the folder (the
   repoint-cockpit-`/catalog`-to-lib trick keeps `studio-ui` green between steps).
5. **Search / `+New` top-bar affordances** are `showSearch`/`showNew`-gated in the `(3)` HTML
   (`+New` default off). Scope them to the existing catalog behaviour; do not invent new
   catalog-management surfaces (charter what-NOT #1 still binds).
6. **`anyComponentStyle` 8 kB budget.** `studio-ui`'s `angular.json` sets
   `anyComponentStyle maximumError: 8kB`; `catalog-designer.component.css` is ~11 kB raw.
   Adding the chrome-token rules in R2 grows it further. The new app's `angular.json` must
   either raise that budget for this component **or** the big catalog CSS moves to a global
   stylesheet / is split (the "8KB-style-budget → inline-static + global-utils" lesson). The
   R2 worker decides + documents; browser-verify must still pass.
7. **ng-packagr build ordering.** The lib must build before its consumers under
   `pnpm -r run build` (pnpm runs workspace deps topologically). The new lib + both apps need
   `build`/`test` scripts; a fresh-clone first build may need the lib's `dist/` before the apps
   resolve it (the `design-system` `setup-dev.sh`/symlink precedent).
