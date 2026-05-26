# Form-controls token reconciliation (fabricir → de-braighter) — design

- **Date:** 2026-05-26
- **Status:** design (brainstormed + approved; pending implementation plan)
- **Layer:** `de-braighter/layers/design-system` → `design-system-angular-forms` (17 control `.scss`) + `design-system-css` (2 new tokens) + `apps/showcase` (verification gallery)
- **Maturity touched:** `design-system-angular-forms` (17 ported CVA controls, currently `0.0.1`)
- **Governing ADRs / context:** [ADR-168](https://github.com/de-braighter/specs/blob/main/adr/adr-168-design-system-eyecatchers-split-workshop-graduates-into-production.md) (bricks-everywhere), [ADR-169](https://github.com/de-braighter/specs/blob/main/adr/adr-169-relocate-css-tokens-to-design-system-css-clean-up-exercir-residuals.md) (CSS tokens SSOT). Builds on the `db-button` token discipline (tokens-not-hex).

## 1. Summary

The 17 ported CVA form controls (`db-input`, `db-select`, …) still reference **fabricir's token vocabulary** in their `.scss` (`--fg-1`, `--bg-inset`, `--line-1`, `--accent-soft`, `--font-body`, `--fs-body-sm`, …). de-braighter's `tokens.css` does **not** define those names — it uses `--ink`, `--paper`, `--rule`, `--accent`, `--font-ui`, `--t-body-sm`, …. So the controls would render **broken in a real de-braighter app** (exercir, which loads `tokens.css`); they only *appear* to work in the showcase because the showcase's own `styles.scss` happens to declare the fabricir names. The dormant CVA spec flagged this as "the scss token layer is reconciled separately."

This slice does that reconciliation: **migrate all 17 controls' `.scss` from fabricir tokens to de-braighter `tokens.css` names**, add the two focus-ring tokens `tokens.css` is missing, and verify the result with **one combined gallery page** rendered in a de-braighter theme. It establishes the mapping every future form-control task reuses.

**Token-only.** No control behaviour, API, or `.ts` changes. No per-control polish, `@maturity` tags, or CVA-governance pass — those are the *next* slice (polished per-control showcase).

## 2. Decisions locked (from the 2026-05-26 brainstorm)

| Decision | Choice |
|---|---|
| Scope | **Reconcile all 17 controls at once** (cross-cutting token migration), not per-control |
| Missing focus-ring tokens | **Add `--accent-soft` + `--accent-rim` to `tokens.css`** (theme-adaptive via `color-mix(var(--accent))`) |
| Verification | **One combined gallery page** (all 17 in a de-braighter-themed stage), not 17 polished pages, not build-only |
| Themed harness | **Shared `_db-stage.scss`** partial (de-braighter tokens scoped under `.db-stage`), reusable by future demos |
| Boundary | **SCSS tokens only** — control `.ts`, CVA wiring, the dormant test spec, `db-button`/`db-pitch`, and `domains/exercir` all untouched |

## 3. Scope

**In:**
- The fabricir→de-braighter token **mapping table** (§4), applied across all 17 `*.scss` in `design-system-angular-forms/src/lib/`.
- `--accent-soft` + `--accent-rim` added to `design-system-css/tokens.css` (§5).
- Shared showcase `_db-stage.scss` harness + a `form-controls.page.ts` gallery rendering all 17 controls; one `NAV_CATALOG` entry (§6).
- Version bumps (§7); local gate green.

**Out (deferred — later slices):**
- Polished per-control playground pages (the "then showcase" effort).
- `@maturity` tags on the controls; reactive-forms-cva-governance pass; per-control pure-logic tests (e.g. `db-number`/`db-date`/`db-otp`/`db-range` parsing).
- Reactivating the dormant `cva-wiring.spec.ts` / fixing the Analog×vitest-4 harness (the known tooling trap).
- Any control `.ts` / behaviour / template change.
- Retrofitting `db-button`'s inline shim onto `_db-stage.scss` (nice-to-have follow-up).
- The 2 quarantined markdown controls (not ported).

## 4. The mapping table (the reusable artifact)

Derived from the full inventory of `var(--…)` across the 17 `.scss` (~40 distinct tokens). **Clean** = de-braighter `tokens.css` already defines that exact name.

| Fabricir token(s) | → de-braighter | Confidence |
|---|---|---|
| `--fg-1` / `--fg-2` / `--fg-3` / `--fg-4` | `--ink` / `--ink-2` / `--ink-3` / `--ink-4` | high |
| `--line-1` / `--line-2` | `--rule` / `--rule-strong` | high |
| `--bg-inset` | `--bg-sunken` | high (recessed wells) |
| `--bg-1` / `--bg-2` / `--bg-3` | `--bg` / `--bg-elev` / `--paper` | **judgment — verify via gallery** (monotonic elevation; a `--bg-3` popover panel that reads too light → `--bg-elev`) |
| `--fs-body-sm` / `--fs-meta` / `--fs-overline` | `--t-body-sm` / `--t-meta` / `--t-eyebrow` | high |
| `--r-1` / `--r-2` / `--r-3` | `--r-sm` / `--r-md` / `--r-lg` | **judgment — verify via gallery** |
| `--dur-1` / `--dur-2` / `--dur-3` | `--dur-fast` / `--dur-base` / `--dur-slow` | medium |
| `--ok` / `--err` / `--warn` / `--info` | `--sem-success` / `--sem-danger` / `--sem-warning` / `--sem-info` | high |
| `--font-body` | `--font-ui` | high |
| `--tracking-caps` / `--tracking-tight` / `--tracking-loose` | `--tr-caps` / `--tr-title` / `--tr-eyebrow` | high (tight/loose are 1 use each) |
| `--accent-soft` / `--accent-rim` | **new in `tokens.css`** (§5) | — |
| `--accent`, `--ease-out`, `--font-mono`, `--font-display`, `--lh-body`, `--r-pill`, `--s-1/2/3/4/6/8` | *same name* | clean (no change) |
| `--fc-seg-count` | *leave as-is* | component-local prop (db-segment grid), not a theme token |

The table is reproduced as a comment block at the top of the migration (and in this spec) so the mapping is auditable and reusable by the per-control work later.

## 5. `tokens.css` change — `design-system-css` 1.2.0 → 1.3.0

Add the two focus-ring tokens once at `:root`, derived from the theme-scoped `--accent` so they adapt to whichever theme is active (and a theme may override them):

```css
/* Accent focus-ring derivatives — used by form controls' :focus-within ring.
   Defined via color-mix on the theme-scoped --accent so they adapt per theme. */
--accent-soft: color-mix(in oklch, var(--accent) 22%, transparent);
--accent-rim:  color-mix(in oklch, var(--accent) 45%, transparent);
```

Custom-property substitution is lazy/per-element, so a `:root` declaration referencing `var(--accent)` resolves to each element's active theme accent — no per-theme duplication. (No control renders outside a `[data-theme]`, matching how every other color token in `tokens.css` is theme-scoped.)

## 6. Verification — shared themed stage + combined gallery

**Why a shim at all:** after reconciliation the controls reference de-braighter tokens (`--ink`, `--paper`, `--accent`, …); the showcase's own `styles.scss` only declares *fabricir* names, and importing the full `tokens.css` globally would hijack the showcase via its `body{}`/`*{}` base rules (the db-button finding). So the de-braighter token set is supplied **scoped**.

- **`apps/showcase/src/styles/_db-stage.scss`** (new): the de-braighter **football** theme block + the scales the controls use (`--ink*`, `--rule*`, `--bg*`, `--paper`, `--sem-*`, `--t-*`, `--r-*`, `--dur-*`, `--ease-out`, `--font-*`, `--s-*`, `--lh-body`, `--tr-*`, `--accent`, `--accent-soft`, `--accent-rim`), scoped under `.db-stage`. `@import`ed into `styles.scss`. Reusable de-braighter-themed harness for any `db-*` demo.
- **`apps/showcase/src/app/pages/form-controls.page.ts`** (new): a standalone OnPush page rendering all 17 controls inside a `.db-stage` wrapper, each bound to a `signal`/`ngModel` so it visibly works. Grouped by family (text / choice / range / specialized) with labels.
- **`nav.catalog.ts`**: one new **"Form Controls"** group with this gallery page (route derives automatically).

## 7. Components / files

| File | Change |
|---|---|
| `libs/design-system-css/tokens.css` | add `--accent-soft` + `--accent-rim` |
| `libs/design-system-css/package.json` | `1.2.0 → 1.3.0` |
| `libs/design-system-angular-forms/src/lib/*/*.scss` (17) | apply the §4 mapping table |
| `libs/design-system-angular-forms/package.json` | `0.0.1 → 0.1.0` |
| `apps/showcase/src/styles/_db-stage.scss` | new shared themed-stage partial |
| `apps/showcase/src/styles.scss` | `@import` the partial |
| `apps/showcase/src/app/pages/form-controls.page.ts` | new gallery page |
| `apps/showcase/src/app/nav.catalog.ts` | new "Form Controls" group entry |

## 8. Versioning / build / boundary

- `design-system-css` **1.3.0** (additive tokens); `design-system-angular-forms` **0.1.0** (internal SCSS migration, no API change).
- Local gate: `nx build design-system-css` + `nx build design-system-angular-forms` + `nx build showcase` + `nx lint` for each, all green.
- No `.ts` / API / behaviour change to any control. `db-button`, `db-pitch`, every other brick, and `domains/exercir` untouched. The dormant CVA spec + the Analog/vitest-4 harness are left exactly as-is.

## 9. Testing

The migration is `.scss`-only — no logic to unit-test, and the forms lib has no runnable test target (CVA spec blocked on Analog×vitest-4). Verification is therefore **the gallery rendering correctly under de-braighter tokens** + green builds. No new unit tests; the TestBed harness is **not** touched (known trap). Visual verification uses the live showcase + screenshots (the db-button workflow).

## 10. Risks

| Risk | Mitigation |
|---|---|
| 40-token migration across 17 files — a wrong mapping propagates everywhere | One governing table (§4); the gallery is the render-time safety net (build-green ≠ renders-right, the db-button lesson) |
| Judgment-call maps (surfaces `--bg-*`, radii `--r-*`, motion `--dur-*`) look off | Flagged in §4; adjusted by eye against the gallery before merge |
| `color-mix` focus-ring tokens unsupported | Already the project baseline (oklch + color-mix used throughout `tokens.css` and `button.css`) |
| Hand-authored `_db-stage.scss` token block drifts from `tokens.css` | It's the single shared harness (authored once); values transcribed from the `[data-theme="football"]` block; gallery surfaces any wrong value |

## 11. Future (next slices, demand-driven)

- Polished per-control playground pages + `@maturity` tags + reactive-forms-cva-governance pass + per-control pure-logic tests.
- Reactivate `cva-wiring.spec.ts` once Analog supports vitest 4 (or vitest pinned to 3.x) — test-infra effort, not here.
- Retrofit `db-button`'s inline shim onto `_db-stage.scss`.
- Wire controls onto `db-button`/`db-form-ring` where they have buttons/validation affordances.
