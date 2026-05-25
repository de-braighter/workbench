# Runbook — `db-` element prefix unification (design-system)

**Decision (2026-05-25):** unify ALL de Braighter design-system component element
prefixes under **`db-`**. Collapses both existing prefixes:

- `bds-` (9 design-system bricks, `design-system-angular`) → `db-`
- `eye-` (70 eyecatchers, `eyecatchers-angular`/`-core`) → `db-`

Class names follow: `Bds*` / `Eye*` → `Db*`.

**Confirmed safe:** zero selector collisions and zero class-name collisions
between the `bds-` and `eye-` sets (checked 2026-05-25), even though the
showcase consumes both — so the merge into one `db-` namespace is clean.

**Why it precedes form-controls (step 5):** the prefix had to be settled before
porting the remaining 18 fc-* controls, otherwise they'd be ported under
`bds-icon`/`fc-` and immediately re-renamed. The fc-input spike (design-system
**PR #71**) is **superseded** by this rename — see disposition below.

## This is a coordinated rename + republish (the scope-switch pattern)

Selectors and class names are **frozen into the published compiled templates**
(same frozen-artifact rule that bit the `@braighter-io`→`@de-braighter` scope
switch). So consumers break on the dead names until packages are republished and
re-pointed. Sequence accordingly.

## Scope

| Lib | Rename |
|---|---|
| `design-system-angular` | 9 `bds-*` selectors → `db-*`; `Bds*` classes → `Db*`; `index.ts` exports; internal template refs; element-selector SCSS |
| `eyecatchers-angular` | 70 `eye-*` selectors → `db-*`; `Eye*` classes → `Db*`; exports; templates; SCSS |
| `design-system-react` | React wrappers referencing the Angular class/selector names |
| `eyecatchers-core` / `design-system-core` | any selector/class refs (mostly types — check) |

**Consumers (lockstep):** showcase **269** `<bds-/<eye-` refs (+ `bds-*.page.ts`
file names), exercir **5** refs.

## Execution sequence

1. **Branch in `design-system`.** Mechanical rename across the 3 libs:
   - Selectors: `selector: 'bds-X'` / `'eye-X'` → `'db-X'`.
   - Class names: `BdsX` / `EyeX` → `DbX` (declarations, exports, imports, React wrappers).
   - In-template element tags: `<bds-X`/`<eye-X` → `<db-X` (incl. showcase).
   - SCSS element selectors (most styles are class-based, but check `:host`/tag selectors).
   - Rename `bds-*.page.ts` showcase files if desired (cosmetic).
2. **Build + lint green** (use the `npm install ./dist/libs/<lib> --no-save`
   approach for cross-lib resolution — the `setup-dev.sh` MSYS dangling-symlink
   bug bites on Windows; see [[clean-structure-migration]] step-4 notes).
3. **Bump + republish ALL affected DS packages** (patch bump; frozen-template
   rule): `npm run publish:libs` (design-system-*) + `bash scripts/publish-libs.sh`
   (eyecatchers). Verify dist is free of `bds-`/`eye-`.
4. **Update consumers in lockstep:**
   - showcase (in-repo) — same PR.
   - exercir (separate repo) — bump DS dep versions + swap the 5 selector refs; its own PR.
5. **PR-gated** each repo; merge design-system first, then exercir.

## PR #71 (fc-input spike) disposition

Parked/superseded. The new `@de-braighter/design-system-angular-forms` lib +
`fc-input` + the `check` icon are good, but `fc-input` uses `bds-icon`. Rather
than merge then immediately rename, **fold it into the form-controls batch that
runs AFTER this rename**: re-land `fc-input` (and the other 17) using `db-icon`.
Close PR #71 or rebase it post-rename. The spike's findings stand regardless.

## Form-controls batch (follows this rename)

Per [[clean-structure-migration]] step 5: port the 19 `fc-*` controls into
`design-system-angular-forms`, using `db-` primitives. Outstanding sub-tasks
from the spike: (a) port N icon paths into `ICON_PATHS`; (b) verify
`fc-input.scss` token vocabulary against `design-system-css`; (c) stand up an
Angular component-test harness (`@analogjs/vite-plugin-angular`) if CVA
behaviour tests are wanted (repo currently has none); (d) quarantine
`marked`/`@codemirror` controls.

## Open question for next session

Form-control selectors: keep functional `fc-` (e.g. `fc-input`) or brand them
`db-` (`db-input`)? "db- everywhere" implies the latter, but `fc-` is a common
functional convention. Decide at batch start.
