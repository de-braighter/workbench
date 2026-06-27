# agri-ecosystem-twin E4.2 — Subjects-tree surface

Foundry item `agri-ecosystem-twin/E4.2` (T0, ui lane). Scope (hard boundary):
`apps/agri-ecosystem-twin-ui/src/app/subjects/` ONLY. Worktree:
`domains/agri-ecosystem-twin/.claude/worktrees/agri-ecosystem-twin-e4-2`,
branch `feat/agri-ecosystem-twin-e4-2`, base `a87f154` (E2.2 merged).

## What it is

The loop-entry surface: a plot → field → farm navigator that reads the
persisted subject registry (`GET /subjects`, shipped by E2.2) and lets the
user select the **plot** the season plan + counterfactual run on (plans hang
off plots — two arm trees per plot). Port of the dossier prototype
`panels.jsx` `SubjectsTree` (grouped plot buttons with an active state,
farm/field as structural headers) onto the E4.1 shell contract + token theme.

## Binding constraints (discovered, non-negotiable)

1. **Shell-owned specs lazy-load `/subjects` with ONLY `provideRouter`**
   (`app.routes.spec.ts`, `a11y.spec.ts`, both un-editable from this item).
   → The page must instantiate with zero extra providers: the data service
   uses **native `fetch`**, NOT HttpClient. It injects only `API_BASE_URL`
   (root factory token, `src/app/core/api-base-url.ts`, defaults `/api`).
   In those shell specs the real fetch 404s against the Karma server → the
   page's **error state** renders; it must still render a non-empty `<h2>`
   and pass the 24px battery (retry button ≥ 24px).
2. **No package.json / lockfile / shared-file edits** (out of pathPrefix).
   No design-system npm package exists in the ui app deps → "design-system
   bricks" = the E4.1 token theme (`src/tokens.css` vars only, no hardcoded
   colors). Cannot import `@de-braighter/agri-ecosystem-twin-spine` either →
   mirror the wire DTO locally.
3. **i18n per the shell contract**: page-scoped catalog
   `subjects-i18n.ts` + `i18n/{de,en}/subjects.json` mirroring
   `common-i18n.ts` (typed DE map + resolver + parity spec; DE-only resolver
   at T0). Re-use `commonMsg`/`loadingLabel`/`loadedLabel`/`loadFailedLabel`
   from the common catalog for the load-status family + the `Flächen` nav
   heading; never re-declare common keys.
4. **a11y battery**: copy `src/app/a11y.spec.ts` into the page dir, point it
   at the page (body-attached fixture, real geometry; landmark assertions
   adapted page-level: non-empty h2 + labelled tree region; 24px check
   non-vacuous on the plot buttons).

## Wire shape (from E2.2 — `GET /subjects`)

`SubjectTreeNode[]`: `{ id: string (kernel uuid), kind: 'farm'|'field'|'plot',
label: string, parentId: string|null, children: SubjectTreeNode[] }`.
Demo estate: Greenacre Farm → North/South Field → 4 plots. `attrs` are NOT in
the response (dropped by the api's event→node mapping) — detail panel shows
level/label/path only.

## Files (all inside `src/app/subjects/`)

1. `subject-tree.model.ts` — local DTO mirror of the wire shape (comment
   pointing at the api source of truth: `apps/…-api/src/registry/…` +
   spine `SubjectTreeNode`). `SubjectLevel = 'farm'|'field'|'plot'`.
2. `subjects-data.service.ts` — `@Injectable({providedIn:'root'})`; injects
   `API_BASE_URL`; `loadSubjects(): Promise<readonly SubjectTreeNode[]>` via
   `fetch(`${base}/subjects`)`; throws a readable Error on `!res.ok`
   (status + statusText); JSON parse.
3. `subject-selection.service.ts` — `@Injectable({providedIn:'root'})` signal
   store: `selected: Signal<SelectedSubject|null>` where `SelectedSubject =
   { id, level, label }`; `select()` / `clear()`; persists to
   `sessionStorage['agri.selected-subject']`, rehydrates on construction,
   try/catch-guarded (corrupt JSON / storage unavailable → null). This is the
   cross-surface seam E4.3/E4.4 import to read the run subject — document in
   the class doc comment.
4. `subjects-i18n.ts` + `i18n/de/subjects.json` + `i18n/en/subjects.json` —
   typed DE map + `subjectsMsg(key)` resolver (fall-through to key), keys:
   `subjects.intro`, `subjects.dataLabel` ('Betriebsflächen' — feeds the
   common load-status helpers), `subjects.tree.label` ('Betriebsstruktur'),
   `subjects.level.farm/field/plot` ('Hof'/'Feld'/'Parzelle'),
   `subjects.empty`, `subjects.retry`, `subjects.selection.title`,
   `subjects.selection.empty`, `subjects.selection.hint`,
   `subjects.selection.clear`, `subjects.selection.announce`
   ('Parzelle {label} ausgewählt.' — interpolated helper `selectionAnnounce`).
5. `subjects-page.component.ts` — REPLACE placeholder, keep file + class name
   (`SubjectsPageComponent`, selector `app-subjects-page`), standalone,
   OnPush, signals:
   - state: `status: 'loading'|'loaded'|'error'` + `forest` + `errorReason`;
     `load()` on construction; `retry()` re-runs it.
   - template: `<section class="page">` with `<h2>{{commonMsg nav.subjects}}`
     + intro p; `role="status"` load-state line (loading/loaded/error via
     common helpers); error panel + retry `<button type="button">`; loaded →
     two-panel layout (tree + selection aside, responsive flex/grid):
     - tree: recursive `<ng-template #node>` + `ngTemplateOutlet`, nested
       `<ul>`s, ul labelled via `subjects.tree.label`. farm/field rows:
       level badge + label (plain, non-interactive). plot rows:
       `<button type="button" [attr.aria-pressed]>` with level badge + label;
       click → selection service. Selected button gets `.active` (token
       accent) + `aria-pressed="true"`.
     - selection aside: title, selected label + ancestor breadcrumb (derive
       a parent-map from the forest; farm / field / plot), hint line (plan +
       counterfactual run here), clear button. Empty state when none.
     - `aria-live="polite"` announcement of selection changes.
   - styles: tokens only (`--bg-*`, `--fg-*`, `--line-*`, `--accent-arm-a`,
     `--glass-*`); every interactive target `min-height: 2rem` (≥24px,
     SC 2.5.8); `.page` max-width + padding consistent with shell.
6. Specs (Karma/Jasmine, mirror existing house style — `withContext`,
   body-attach where geometry matters):
   - `subjects-data.service.spec.ts` — spyOn fetch: ok → parsed forest +
     correct URL from token override; !ok → throws readable error; network
     reject propagates.
   - `subject-selection.service.spec.ts` — select/clear roundtrip;
     sessionStorage persistence + rehydration (fresh TestBed injector);
     corrupt stored JSON → null (no throw). Clear sessionStorage in
     before/afterEach.
   - `subjects-i18n.spec.ts` — known key, fall-through, interpolation helper.
   - `subjects-i18n.parity.spec.ts` — map ≡ de bundle; de/en key parity; no
     empty values (mirror `common-i18n.parity.spec.ts`).
   - `subjects-page.component.spec.ts` — stub data service via TestBed
     provider override: loading first; loaded renders 1 farm + 2 fields +
     4 plot buttons; plot click → selection panel + aria-pressed + service
     state; clear resets; second click on another plot moves selection;
     error → reason shown + retry refetches (service spy called twice, page
     recovers to loaded); empty forest → `subjects.empty`.
   - `a11y.spec.ts` (page copy) — stub service (loaded state), body-attached:
     label/for, role=button is BUTTON/A, buttons have accessible names, no
     autofocus, non-empty h2 + labelled tree, 24px targets non-vacuous.
7. Do NOT touch: `app.routes.ts`, `app.config.ts`, `shell/`, `core/`,
   `i18n/`, `styles.css`, `tokens.css`, `index.html`, root `a11y.spec.ts`,
   any other page dir, any package.json/lockfile.

## Gates

- `pnpm --filter agri-ecosystem-twin-ui run test` (ChromeHeadless, coverage —
  keep page coverage ~100%, repo ships 100%).
- `pnpm --filter agri-ecosystem-twin-ui run build` + `typecheck`.
- Repo `ci:local` from the worktree root (NX_DAEMON=false if wedged).
- Scope check: `git diff --name-only origin/main...HEAD` ⊆
  `apps/agri-ecosystem-twin-ui/src/app/subjects/` (this plan file lives in
  the workbench repo, not this diff).
- Quality obligations: wave-standard, coverage-delta, seed-data-only (page
  only READS the seeded registry), no-kernel-change, a11y-battery.
