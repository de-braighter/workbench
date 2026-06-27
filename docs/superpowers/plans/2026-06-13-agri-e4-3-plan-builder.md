# agri-ecosystem-twin E4.3 — Plan-builder surface

**Item:** `agri-ecosystem-twin/E4.3` (foundry, T0) · **Scope:** `apps/agri-ecosystem-twin-ui/src/app/plan-builder/` ONLY
**Worktree:** `domains/agri-ecosystem-twin/.claude/worktrees/agri-ecosystem-twin-e4-3` · **Branch:** `feat/agri-ecosystem-twin-e4-3`
**Obligations:** wave-standard, coverage-delta, seed-data-only, no-kernel-change, a11y-battery

## What this surface is

The E4 loop step 1 ("build a plan"): port of the prototype `inspector.jsx` `PlanBuilder`
(drag-drop year slots + intervention library) onto Angular reactive forms. At wedge scope
(ONE season, two arms) the Y0–Y3 year slots collapse to the season's **ordered intervention
steps per arm** (A vs B). Drag-drop becomes **click-to-add + up/down/remove buttons**
(WCAG 2.5.7 dragging alternative — the exercir D-1 "click-click" precedent).

**"Writes the plan via its own page-scoped data service":** the api deliberately exposes no
plan-write endpoint at T0 (E2.2 RLS split: `PlanTreeStore.save` full-rewrites with DELETE,
which the app role lacks — seed writes are superuser-only). The page therefore: (1) READS
the canonical seeded arm plans `GET /plan/A|B?plotId=` (kernel-persisted truth, displayed
as reference + form initial value), and (2) WRITES the user's composed draft via a
page-scoped store on `sessionStorage` (the `SubjectSelectionService` persistence precedent).
Seed-data-only holds: no live feed, no server mutation.

## Binding constraints (from arc memory + ui README — violate nothing)

- Touch ONLY files under `apps/agri-ecosystem-twin-ui/src/app/plan-builder/`. Keep
  `plan-builder-page.component.ts` file + class name (`PlanBuilderPageComponent`) — the lazy
  route points at it. Never edit shell files, `package.json`, or other page dirs.
- Data access: native `fetch` + inject `API_BASE_URL` from `../core/api-base-url` ONLY. No
  HttpClient (shell-owned specs lazy-load the page with bare `provideRouter`).
- Shell specs instantiate the page with empty sessionStorage → the **no-plot empty state must
  render a non-empty `<h2>`** and fire NO fetch. With a plot but failing fetch (Karma) → error
  state with `<h2>` + retry button ≥24px.
- Selection seam: inject `SubjectSelectionService` from `../subjects/subject-selection.service`
  (root-provided; reading a cross-page root service is the sanctioned seam, NOT a scope
  violation — its file is not edited).
- Wire DTO mirrored locally (`plan-tree.model.ts`) with a comment pointing at the api source
  of truth (`apps/agri-ecosystem-twin-api/src/plan/plan-mapping.ts` + substrate-contracts
  `plan-tree`); the ui takes no spine/pack package dep.
- Kick off loads in `ngOnInit`, never the constructor (sonarjs/no-async-constructor).
- i18n: page-scoped `plan-builder-i18n.ts` + `i18n/{de,en}/plan-builder.json` + parity spec,
  mirroring the subjects catalog. DE is source content; en bundle key-parity only. Consume
  common keys (`common.nav.planBuilder` heading, load-status family, `common.indicator.*`)
  — never re-declare them.
- a11y battery: copy `../subjects/a11y.spec.ts` shape, body-attached fixture, stub the data
  service loaded + pre-seed `sessionStorage['agri.selected-subject']` BEFORE component
  creation so form controls are in the geometry pass. `expect().nothing()` on absence-guard
  specs. All interactive targets ≥24px.
- Forms: reactive only. Submit button stays ENABLED when invalid (enabled-submit pattern);
  invalid submit surfaces an inline error + live-region announcement.

## Wire facts

- `PlanTree = { treeRootId, tenantPackId, nodes: PlanNode[] }`;
  `PlanNode = { id, parentId, treeRootId, kind, kindRef, ordinal, metadata: Record<string,unknown>, childrenIds, effectDeclarations? }`.
- Season root: `kind 'agri.season'`, `kindRef 'agri.season:<season>'` (season e.g. `'2026'` —
  read it from kindRef, don't hardcode). Intervention leaf: `kind 'agri.intervention'`,
  `kindRef 'agri.intervention:<mixId>'`, `metadata.title` = mix label, ordered by `ordinal`.
- Effect declaration (subset the UI shows): `{ indicatorId, direction: '+'|'-',
  magnitudePrior: { kind: 'normal', mean, sd } }`. Indicator ids `soil-moisture`,
  `pest-pressure`, `yield` map to `common.indicator.{soilMoisture,pestPressure,yield}`.
- Seeded arm plans: A = `[cover-vetch]`, B = `[cover-phacelia]` (single step each).

## Files (all in `src/app/plan-builder/`)

1. `plan-tree.model.ts` — local wire mirror: `PlanTreeDto`, `PlanNodeDto`,
   `EffectDeclarationDto` (display subset), plus derived view-model types:
   `MixOption { id, label, effects }`, helpers `mixOptionsOf(trees)` (union of intervention
   leaves across fetched arms, by kindRef suffix), `seededSequenceOf(tree)` (ordinal-ordered
   mixIds), `seasonOf(tree)` (kindRef suffix). Pure functions, unit-tested.
2. `plan-data.service.ts` — `loadArmPlans(plotId): Promise<{ a: PlanTreeDto; b: PlanTreeDto }>`
   via two fetches (`/plan/A`, `/plan/B`), non-ok → throw with status text (subjects pattern).
3. `plan-draft.store.ts` — page-scoped draft persistence: `PlanDraft { plotId, season,
   a: string[], b: string[], savedAt }`, sessionStorage key `agri.plan-draft`, type-guarded
   `load(plotId, season)`, `save(draft)`, `clear(plotId, season)`; try/catch degrade like
   `SubjectSelectionService` (never throws).
4. `arm-sequence-editor.component.ts` — reusable **ControlValueAccessor** custom control over
   `readonly string[]` (the mix-id sequence). Inputs: `options: MixOption[]`, `armLabel`,
   `idPrefix` (unique DOM ids per instance). Renders: ordered step list (step number, mix
   label, per-effect chips "indicator +mean ±sd", buttons remove / move-up / move-down —
   each ≥24px with accessible names), library buttons "add <mix>" per option (click-to-add),
   empty-slot hint when sequence empty. Implements disabled state; marks touched on any
   mutation. OnPush; signal for value; NO_ERRORS_SCHEMA forbidden.
5. `plan-builder-page.component.ts` — replaces placeholder (same class/file name). States:
   `no-plot` (empty state + hint, no fetch) / `loading` / `error` (+retry) / `loaded`.
   Loaded: seeded-reference panel (per arm: seeded sequence + season), reactive
   `FormGroup { a, b }` with the CVA editor twice (labels "Mix A …" / "Mix B …"), validators
   min-1-step + ids∈catalog, save button (always enabled → invalid shows inline error),
   reset-to-seeded button, saved-draft summary when a draft exists, polite live region
   announcing save/reset/validation outcomes. Form initial value: draft if present (same
   plot+season), else seeded sequences. statusLine via common load-status family
   (dataLabel from page catalog).
6. `plan-builder-i18n.ts` + `i18n/de/plan-builder.json` + `i18n/en/plan-builder.json` —
   keys: intro, dataLabel, noPlot family, seeded panel labels, arm labels, step/library
   labels (add/remove/up/down with `{label}`/`{index}` interpolation), save/reset/saved/
   invalid messages, announce templates. Resolver + interpolation helpers mirroring
   `subjects-i18n.ts`.
7. Specs: `plan-tree.model.spec.ts`, `plan-data.service.spec.ts` (fetch spied),
   `plan-draft.store.spec.ts` (persist/rehydrate/corrupt/unavailable),
   `arm-sequence-editor.component.spec.ts` (CVA contract: writeValue, onChange, touched,
   disabled; add/remove/move semantics incl. boundary moves), `plan-builder-page.component.spec.ts`
   (all four states; draft-over-seeded init; save → store written + announced; invalid save
   announced, control marked; reset), `plan-builder-i18n.spec.ts` + parity spec,
   `a11y.spec.ts` battery copy. Keep ui coverage at 100% (repo holds 100% — coverage-delta).

## Gates

`pnpm run ci:local` green in the worktree (capture exit code explicitly — never pipe through
`tail`). Scope check: `git diff --name-only origin/main...HEAD` all under the pathPrefix.
Then story issue, PR, twin-advisory wave (T0 standard: local-ci + reviewer + qa-engineer +
charter-checker, worktree-isolated), post-findings BEFORE fixes, fix, squash-merge with
`Closes #<story>`, twin ritual, memory update, release.
