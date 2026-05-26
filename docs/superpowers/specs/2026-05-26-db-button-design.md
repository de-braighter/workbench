# `db-button` — foundational interactive primitive (design)

- **Date:** 2026-05-26
- **Status:** design (brainstormed; pending implementation plan)
- **Layer:** `de-braighter/layers/design-system` → `design-system-angular` (directive) + `design-system-css` (styles)
- **Maturity:** `@experimental`, `@since 1.6.0`
- **Governing ADRs:** [ADR-168](https://github.com/de-braighter/specs/blob/main/adr/adr-168-design-system-eyecatchers-split-workshop-graduates-into-production.md) (bricks-everywhere — packs consume bricks, never author UI), [ADR-169](https://github.com/de-braighter/specs/blob/main/adr/adr-169-relocate-css-tokens-to-design-system-css-clean-up-exercir-residuals.md) (CSS tokens SSOT in `design-system-css`).
- **Conventions:** `de-braighter` workbench CLAUDE.md + `design-system` CLAUDE.md (standalone, signal `input()`, tokens-not-hex, pure-function-first, `.js` import extensions).

## 1. Summary

Build **`db-button`** — the first **foundational interactive primitive** in the `db-*` brick set. Every prior brick (`db-pitch`, `db-delta`, `db-sparkline`, `db-funnel-diagram`, …) is a display widget; there is no button, input, card, or tab yet. A real app screen (the exercir football UI) needs these workhorse controls, and the button is the most universal.

`db-button` is a **standalone attribute directive** applied to a native `<button>` or `<a>`, giving it design-system styling (variant / size / loading) while inheriting all native interactive semantics for free. It establishes the **interactive-brick pattern** that later primitives (input, card, tabs) will copy: a logic-pure decision module (tested without TestBed), a thin directive that binds it to host attributes, and a tokens-only stylesheet in `design-system-css`.

This is **purely additive** — no change to any existing brick or to `<db-pitch>`'s public API, so the exercir `^1.5.1` pin stays safe.

## 2. Decisions locked (from the 2026-05-26 brainstorm)

| Decision | Choice |
|---|---|
| First slice | **One brick, done well** — `db-button` end-to-end (spec → plan → TDD → PR → publish) |
| Which brick | **`db-button`** — most universal; sets the variant/size/state + token conventions later primitives reuse |
| Element model | **Attribute directive on native element** — `button[db-button], a[db-button]` (not a wrapper component) |
| Variants | **`primary` / `secondary` / `ghost` / `danger`** (complete-but-minimal; `link` deferred) |
| Sizes | **`sm` / `md` / `lg`** → `--density-{compact,default,comfortable}` (28 / 36 / 44px) |
| States | **native `disabled`** (free on `<button>`) + **`loading`** (directive-managed, CSS-only spinner) |
| Icons | **No input** — consumers project `<db-icon>`; CSS provides `gap` (YAGNI) |
| Styling home | **`design-system-css/components/button.css`** (directives can't carry styles; matches the existing `.ico`/`.t-*`/`.layer-dot` utility-class pattern) |
| Logic home | **`button-classes.ts`** co-located in `design-system-angular` (mirrors `pitch-geometry.ts`); core-promotion deferred |

## 3. Scope

**In:**
- `DbButton` directive (`button[db-button], a[db-button]`), standalone, signal inputs `variant` / `size` / `loading`.
- Pure module `button-classes.ts`: `resolveButtonHost()` + `shouldBlockActivation()` + the `DbButtonVariant` / `DbButtonSize` types.
- Unit tests for the pure module (vitest, no TestBed).
- `design-system-css/src/components/button.css` — tokens-only styling for all 4 variants × 3 sizes + disabled + loading + focus-visible, honouring `prefers-reduced-motion`.
- `components/*.css` export entry added to `design-system-css/package.json`; minor version bumps on both libs.
- Barrel `button/index.ts` + re-export from `design-system-angular/src/index.ts`.
- Showcase playground page `db-button.page.ts` + one `NAV_CATALOG` line under the `bricks` group.

**Out (deferred — additive later, no API break):**
- `link` variant; `block` / full-width input; explicit `disabled` input for anchors beyond loading.
- Button **group / toolbar** brick; icon-only **affordance sugar** (consumers already compose `<db-icon>`).
- Promotion of `button-classes.ts` into platform-agnostic `design-system-core` (do it when React needs the same logic — demand-driven).
- Other primitives (input/field, card, tabs, badge) — each its own spec → plan → build cycle.

## 4. Architecture

### 4.1 Why a directive, not a wrapper component

Applying `db-button` to a real `<button>`/`<a>` inherits, for free and correctly: `type="submit"` / form participation, native `disabled`, `:focus-visible`, Space/Enter activation, the implicit `role`, and screen-reader semantics. `(click)` binds to the real element — no event re-emission. `<a db-button href>` yields a link-button with zero extra API. A wrapper `<db-button>` would have to re-expose every one of these, and is easy to get subtly wrong for a11y. This matches Angular Material (`mat-button` is a directive) and Spartan-ui practice.

**Consequence — loading is CSS-only.** A directive must not inject DOM into the consumer's projected content. So `loading` is expressed as a host class + `aria-busy`, and the spinner is drawn by CSS (`::after`), with the label hidden via `color: transparent`. This keeps the directive logic-pure and naturally reduced-motion-aware.

### 4.2 Three-part split (mirrors `<db-pitch>`)

`<db-pitch>` delegates all geometry to a pure `pitch-geometry.ts` and stays a ~40-line shell. `db-button` follows the same shape, across the two libs the concerns naturally live in:

```
design-system-angular/src/lib/button/
  button.directive.ts     — DbButton: host bindings (class + aria-busy) + click-guard. No styling, minimal logic.
  button-classes.ts       — PURE: resolveButtonHost() + shouldBlockActivation() + types. The tested core.
  button-classes.spec.ts  — vitest unit tests (no TestBed).
  index.ts                — barrel → re-exported from src/index.ts

design-system-css/src/components/button.css   — tokens-only appearance. Consumed via the published package path.
```

Directive owns **behaviour + semantics**; CSS lib owns **appearance**; pure module owns **the decision logic** and is the only part with real tests.

> **Directive note:** `@Directive` has no `changeDetection` field — `OnPush` is a component concern. Host bindings that read `computed()` signals update via the signal graph regardless, so the directive is fully reactive without it. The "OnPush" convention in CLAUDE.md applies to component bricks; `db-button` is a directive brick.

## 5. Components

| Component | Path | Responsibility |
|---|---|---|
| Pure module | `design-system-angular/.../button/button-classes.ts` | **Pure.** `resolveButtonHost(variant, size, loading) → ButtonHost` and `shouldBlockActivation(loading) → boolean`. Exports `DbButtonVariant`, `DbButtonSize`. No Angular import. |
| Directive | `design-system-angular/.../button/button.directive.ts` | `DbButton`. Signal inputs `variant`/`size`/`loading`; one `computed()` over the pure resolver; host bindings; click-guard. |
| Stylesheet | `design-system-css/src/components/button.css` | All variants × sizes + disabled + loading + focus-visible. Tokens only. Reduced-motion guard. |
| Showcase page | `apps/showcase/.../pages/db-button.page.ts` | Playground: variant grid × size row, loading + disabled + link-button + icon-in-button demos. |

## 6. API surface

```ts
// selector: 'button[db-button], a[db-button]'
variant = input<DbButtonVariant>('primary');   // 'primary' | 'secondary' | 'ghost' | 'danger'
size    = input<DbButtonSize>('md');            // 'sm' | 'md' | 'lg'
loading = input(false, { transform: booleanAttribute });
```

Consumer usage:

```html
<button db-button variant="primary" size="md" (click)="save()">Save</button>
<button db-button variant="danger" [loading]="deleting()" (click)="remove()">Delete</button>
<button db-button variant="secondary" disabled>Can't</button>           <!-- native disabled -->
<a db-button variant="ghost" routerLink="/next">Next <db-icon name="arrow-right" /></a>
```

No `disabled` input — on `<button>` the consumer sets the native attribute (the `:disabled` selector styles it); on `<a>` the directive reflects `aria-disabled` while `loading`. No icon input — `<db-icon>` is projected and spaced by CSS `gap`.

## 7. Pure module contract

```ts
export type DbButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type DbButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonHost {
  /** Space-joined class list for the host [class] binding. */
  classes: string;        // e.g. 'db-btn db-btn--primary db-btn--md is-loading'
  /** aria-busy attr value, or null to omit. */
  ariaBusy: 'true' | null;
}

export function resolveButtonHost(
  variant: DbButtonVariant,
  size: DbButtonSize,
  loading: boolean,
): ButtonHost;

/** Click-guard: should the directive cancel activation right now? */
export function shouldBlockActivation(loading: boolean): boolean;  // === loading
```

`resolveButtonHost` always emits the base `db-btn`, then `db-btn--<variant>`, `db-btn--<size>`, and `is-loading` iff loading. Class merge-safety **(verified during implementation)**: the host `[class]` string binding compiles to Ivy `ɵɵclassMap`, which **merges** with a consumer's static `class="…"` (non-conflicting static classes always survive). Confirmed via angular.dev `guide/templates/binding` + the compiled instruction (Angular 21.2.9). The "string binding clobbers static class" belief is a pre-Ivy (ViewEngine) misconception. The `[class]` binding stays — no fallback to per-token bindings needed.

**Tests** (the TDD target): a table over all 4×3 variant×size combos asserting `classes`; `is-loading` present iff loading; `ariaBusy` is `'true'` iff loading else `null`; `shouldBlockActivation` truth table.

## 8. Styling (`button.css`) — tokens only, no hex

Per-variant foreground is captured in a local custom prop `--db-btn-fg` so the loading spinner can colour itself independently of the label (which goes `transparent` while loading).

| Token area | Mapping |
|---|---|
| Base | `inline-flex; align-items:center; justify-content:center; gap:var(--s-2); font-family:var(--font-ui); font-weight:var(--w-medium); border-radius:var(--r-md); border:1px solid transparent; transition: background/color/border-color var(--dur-fast) var(--ease); cursor:pointer; color: var(--db-btn-fg); user-select:none;` |
| `--sm` | `height:var(--density-compact); padding-inline:var(--s-3); font-size:var(--t-body-sm);` |
| `--md` | `height:var(--density-default); padding-inline:var(--s-4); font-size:var(--t-body);` |
| `--lg` | `height:var(--density-comfortable); padding-inline:var(--s-5); font-size:var(--t-body);` |
| `--primary` | `--db-btn-fg: var(--ink-50); background:var(--accent);` hover `color-mix(in oklch, var(--accent), black 8%)`; active `…14%`. |
| `--secondary` | `--db-btn-fg: var(--ink); background:transparent; border-color:var(--rule-strong);` hover `background:var(--bg-sunken)`. |
| `--ghost` | `--db-btn-fg: var(--ink-2); background:transparent;` hover `background:var(--bg-sunken)`. |
| `--danger` | `--db-btn-fg: var(--ink-50); background:var(--sem-danger);` hover/active darken via `color-mix`. |
| `:disabled` | `opacity:.5; cursor:not-allowed; pointer-events:none;` (native `<button disabled>` only — anchors have no disabled state in this API, only `loading`/busy, which is a distinct spinner state, not dimmed). WCAG 1.4.3 exempts inactive controls. |
| `.is-loading` | `cursor:progress; color:transparent;` (hides label + projected icon); `::after` = centred `1em` ring, `border:2px solid var(--db-btn-fg); border-top-color:transparent; animation: db-btn-spin .6s linear infinite;` |
| `:focus-visible` | `outline:2px solid var(--accent); outline-offset:2px;` |
| Reduced motion | `@media (prefers-reduced-motion: reduce){ .db-btn.is-loading::after{ animation:none; } }` — static ring; busy state still conveyed by `aria-busy`. |

Foreground choices verified for contrast: `--ink-50` (≈L0.985) on `--accent`/`--sem-danger` (L≈0.52–0.55), and darker still under the football skin (`--fc-blue` L≈0.42) → comfortably ≥ 4.5:1. `secondary`/`ghost` use `--ink`/`--ink-2` on the page background.

The stylesheet is a standalone file consumers opt into:

```css
@import '@de-braighter/design-system-css/components/button.css';
```

`design-system-css/package.json` gains `"./components/*.css": "./components/*.css"` (the build's `**/*.css` asset glob already copies subfolders, so `src/components/button.css` → `dist/.../components/button.css`). The showcase global stylesheet adds the import so the playground renders.

## 9. Accessibility

- Native element ⇒ correct role, keyboard (Space/Enter), focus order for free.
- `aria-busy="true"` while loading; click-guard cancels pointer **and** keyboard activation (CSS `pointer-events:none` alone would miss keyboard) via `@HostListener('click')` → `preventDefault()` + `stopImmediatePropagation()` when `shouldBlockActivation(loading())`.
- `<a db-button>` gets `aria-disabled="true"` while loading; the guard prevents navigation.
- Target size: `lg` = 44px (WCAG 2.5.5 AAA), `md` = 36px, `sm` = 28px — all clear the 2.5.8 AA 24px minimum.
- Disabled relies on native `:disabled`; contrast exemption applies.
- Focus ring is a visible 2px `--accent` outline (never `outline:none` without replacement).

## 10. Testing strategy

Per the repo's flaky TestBed reality (Analog/vitest-4), **all assertions target the pure module** — no component/directive test that needs TestBed:

- `button-classes.spec.ts`: `resolveButtonHost` class output across 4×3 combos; `is-loading`/`ariaBusy` toggling; `shouldBlockActivation` truth table.
- The directive itself is thin enough (binds the pure result; one guarded listener) that its correctness is covered by the pure tests + the showcase page for manual visual/interaction verification.
- CSS is verified visually in the showcase (variant grid, loading, disabled, focus ring, reduced-motion).

## 11. Build / publish / versioning

- **Additive only ⇒ minor bumps:** `design-system-angular` `1.5.1 → 1.6.0`; `design-system-css` `1.1.4 → 1.2.0`.
- Build: `nx build design-system-angular` + `nx build design-system-css`. Publish uses `npm run build:libs` (runs the `.js`-extension patch) then `npm publish` from each changed `dist/libs/<lib>` with `--userconfig`. Only the two changed libs publish.
- Local gate is the bar (remote Actions billing-blocked): `nx build` + `nx lint` + `nx test` green for both libs and the showcase.

## 12. Boundary safety

- Zero edits under `domains/exercir`.
- `<db-pitch>` and every existing brick are untouched; only new files + additive exports + version bumps. exercir's `@de-braighter/design-system-angular@^1.5.1` pin resolves `1.6.0` and sees no behavioural change.

## 13. Risks & open questions

| Risk | Mitigation |
|---|---|
| Host `[class]` string binding stomps a consumer's static `class` | **Resolved (verified):** Ivy `ɵɵclassMap` merges with static classes; `<button db-button class="x">` keeps `x`. Pre-Ivy misconception. No change needed. |
| `color: transparent` while loading hides a projected `<db-icon>` too | Intended — spinner replaces all content; spinner colour comes from `--db-btn-fg`, not `currentColor`. |
| Consumer forgets to import `components/button.css` | Showcase imports it; document the import in the page's docs tab + the export's TSDoc. |
| Reduced-motion static ring reads as a plain ring, not "busy" | Acceptable — `aria-busy` carries the semantic; motion is decorative per WCAG. |

## 14. Future (demand-driven, additive)

- `link` variant; `block`/full-width; explicit anchor `disabled`.
- Promote `button-classes.ts` (or a `resolveButtonHost`) into `design-system-core` when a React implementation needs the same decision logic.
- Sibling primitives: `db-card`, `db-input`/`db-field` (CVA), `db-tabs`, `db-badge` — each follows this pattern (pure module + thin Angular shell + tokens-only CSS).
