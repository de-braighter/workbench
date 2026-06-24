# Board Editor Studio — Standalone & Reskin Implementation Plan

> **For agentic workers:** This plan feeds **`/build-path`** on the EXISTING foundry product
> `board-editor-studio`. Each Task below = one claimable foundry work item (R1a → R1b → R1c →
> R2 → optional R3), a `dependsOn` chain. Workers execute via the **`/foundry-worker`** protocol
> (atomic claim → the worker worktrees the `domains/studio` clone ITSELF → TDD via existing
> skills → tier-gated quality wave → founder-gated merge → twin ritual → release). **Do NOT
> Agent-tool-isolate the worker.** Steps use checkbox (`- [ ]`) syntax. The 10 prior items
> (E1.1–E8.1) are DONE — never re-push them.

**Goal:** Stand the Board Editor Studio catalog IDE up as a standalone app (`apps/board-editor-ui`)
on an extracted library (`@de-braighter/board-editor`), decoupled from the cockpit
(`apps/studio-ui`), and reskinned to the `(3)` handoff's three-skin (`ivory`/`clinical`/`night`)
chrome contract.

**Architecture:** Move the catalog-IDE source (import-disjoint from the legacy form) into a new
ng-packagr Angular library that is a pnpm-workspace package; build a thin new Angular-CLI app
that consumes it with a `[data-theme]` skin switcher; remove the cockpit's `/recipe-designer` +
`/catalog` routes and retire the legacy `RecipeDesignerComponent`; reskin the library's CSS from
night-only hardcoded literals to pure canonical + chrome tokens. ZERO kernel change; the
interpreter core (`@de-braighter/design-system-core` board-kit) is reused, never rebuilt.

**Tech Stack:** Angular 20 (standalone, signals, OnPush), ng-packagr, pnpm-workspace (root) +
npm (per app), `@de-braighter/design-system-{core,angular,css}` (published), `<ds-board-kit>`
brick, Vitest/`@angular/build:unit-test`.

## Global Constraints

- **Repo:** `de-braighter/studio` (`domains/studio`). EXISTING product; **no `/new-domain`**.
- **Zero `design-system-core` change.** Compose published packages; author no kernel concept
  (ADR-176). If any item is forced toward a brick change → **STOP + escalate** (architecture
  founder gate), never bundle it.
- **Package manager:** apps pin **npm** (`packageManager`, `ng`-based scripts); the **root** is
  pnpm-workspace (`pnpm -r run build/test`). **Never introduce pnpm into `apps/*`.** New lib +
  apps each expose `build`/`test` scripts so `pnpm -r` picks them up topologically.
- **Acceptance per item:** `npm test` green + `npm run build` green at the app/lib level **and**
  root `pnpm -r run build && pnpm -r run test` (`ci:local`) green.
- **Canonical token vocabulary ONLY** (forbidden retired set — never reintroduce): allowed
  `--bg --bg-elev --bg-sunken --paper --ink/-2/-3/-4 --rule/-strong --accent/-2/-soft/-rim/-on
  --glass-bg --glass-blur --rail-bg --scrim --glass-shadow --grid-dot --code-str/-num
  --color-ok/-warn/-risk(+-soft) --font-display/-ui/-mono`; forbidden `--bg-0..3 --fg-1..4
  --line-1..3 [data-skin] "Space Grotesk"`.
- **Skin tokens:** consume published `@de-braighter/design-system-css@^1.7.0`, import its
  `tokens.css` (carries `[data-theme="ivory|clinical|night"]` + chrome tokens). NOT the
  `skins/skin-*.css` exports (retired `[data-skin]` overlays).
- **knip green** after every item (no orphaned files).
- **Quality (every code item):** `tdd`, `review-floor` (≥1 `/code-review` + full verifier wave
  on non-trivial PRs, worktree-isolated), **`opus-whole-branch`** (non-negotiable),
  `parity-proof` (existing parity/persistence specs stay green — behaviour unchanged),
  `a11y-focus-recovery` (existing reorder/remove/drop/drawer focus tests stay green; fixture on
  `document.body`), **browser-verify** (serve + screenshot — "tests green ≠ renders"), WCAG 2.2
  AA. Governance skills: `architecture-concierge`, `public-api-stabilizer` (the lib),
  `reactive-forms-cva-governance`, `angular-signals-standalone-governance`.
- **Per PR:** `Producer:` + `Effort:` lines; twin ritual (drain → backfill → reconcile) after
  each merge. Every merge-to-main is a founder "go".

**Reference docs:** spec `docs/superpowers/specs/2026-06-24-board-editor-studio-standalone-design.md`
· charter `docs/foundry/board-editor-studio/charter.md` (amend first) · build-path
`docs/foundry/board-editor-studio/build-path.md` · ng-packagr template
`layers/design-system/libs/design-system-angular/{ng-package.json,src/index.ts}`.

---

## GATE-0 — Charter amendment (founder-gated, docs-only; precedes `/build-path`)

Amend `docs/foundry/board-editor-studio/charter.md`:
- **Repo plan** → "Stand up a NEW `apps/board-editor-ui` (Angular-CLI app) consuming a NEW
  `libs/board-editor` (`@de-braighter/board-editor`, ng-packagr); decouple from `apps/studio-ui`.
  Supersedes the prior 'extends `apps/studio-ui` / adds `/catalog` route + nav' plan."
- **Scope** → add "the `[data-theme]` ivory/clinical/night skin system + a top-bar skin
  switcher" (was deferred in the original build-path).
- **Status** `chartered → amended`; record the founder "go".

No code. This is a foundry gate, not a build item.

---

## Task R1a: Extract `@de-braighter/board-editor` library + repoint the cockpit

**Deliverable:** the catalog IDE lives in a new ng-packagr workspace lib; `apps/studio-ui` still
builds and its `/catalog` route still works (now importing from the lib). Green, mergeable alone.

**Files:**
- Create: `domains/studio/libs/board-editor/package.json` (name `@de-braighter/board-editor`,
  `build`/`test` scripts), `ng-package.json`, `tsconfig.json`, `tsconfig.lib.json`,
  `tsconfig.spec.json`, `src/public-api.ts` — **mirror**
  `layers/design-system/libs/design-system-angular/{ng-package.json,tsconfig*.json}` (ng-packagr
  workspace-package shape; `entryFile: src/public-api.ts`, `dest: ../../dist/libs/board-editor`).
- Move (git mv, sources + specs together) from
  `domains/studio/apps/studio-ui/src/app/recipe-designer/` into
  `domains/studio/libs/board-editor/src/lib/`:
  `catalog-designer.component.ts/.css/.spec.ts`, `catalog.ts`, `catalog-document.ts`,
  `catalog-document.spec.ts`, `catalog-document-reverse.spec.ts`, `catalog-store.ts`,
  `local-storage-catalog-store.ts/.spec.ts`, `catalog-card.component.ts`,
  `instance-row.component.ts/.spec.ts`, `composite.spec.ts`,
  `composite-parts-editor.component.ts/.spec.ts`, `svg-primitive-editor.component.ts/.spec.ts`,
  `svg-primitive.spec.ts`, `definition-drawer.component.ts/.spec.ts`,
  `board-settings.component.ts/.spec.ts`, `board-settings.spec.ts`, `usage-analytics.spec.ts`,
  `usage-analytics-ui.spec.ts`, `catalog-parity.spec.ts`, `catalog-store-persistence.spec.ts`.
- Modify: `domains/studio/pnpm-workspace.yaml` (add `- "libs/*"`),
  `domains/studio/apps/studio-ui/package.json` (add `"@de-braighter/board-editor": "workspace:*"`),
  `domains/studio/apps/studio-ui/src/app/app.routes.ts:31-39` (repoint the `/catalog`
  `loadComponent` + the `CATALOG_STORE`/`LocalStorageCatalogStore` imports to
  `@de-braighter/board-editor`).

**Interfaces:**
- Produces: package `@de-braighter/board-editor` exporting `CatalogDesignerComponent`,
  `CATALOG_STORE` (InjectionToken), `LocalStorageCatalogStore`.
- Consumes: `@de-braighter/design-system-{core,angular}` (peerDeps), Angular.

**Pre-flight (the one ambiguity):**

- [ ] **Step 0: Trace the exact import closure.** Run a reachability check to confirm NO
  catalog-IDE file imports the legacy chain (`recipe-form`, `shapes-editor`, `shape-editor`,
  `primitives-editor`, `sample-tree`, `plan-kinds.recipe`). Command:
  `cd domains/studio/apps/studio-ui && rg -n "from '\./(recipe-form|shapes-editor|shape-editor|primitives-editor|sample-tree|plan-kinds)" src/app/recipe-designer/{catalog-designer,catalog,catalog-document,definition-drawer,composite-parts-editor,instance-row,board-settings,svg-primitive-editor,catalog-card}*.ts`
  Expected: **no matches** (confirms the move set is self-contained). If `sample-tree` IS
  imported by a catalog file, ADD it to the move set (it is shared, not legacy).

- [ ] **Step 1: Scaffold the lib package** mirroring the design-system-angular reference
  (`package.json` with `"build": "ng-packagr -p ng-package.json"`, `"test": "<ng test runner>"`;
  `ng-package.json`; tsconfig trio; empty `src/public-api.ts`). Use `architecture-concierge` to
  validate the package shape against the repo's pnpm-workspace + npm-per-app constraints.

- [ ] **Step 2: Run the lib build to verify the empty package compiles**
  Run: `cd domains/studio/libs/board-editor && npm run build`
  Expected: ng-packagr emits `dist/libs/board-editor` (empty entry OK).

- [ ] **Step 3: `git mv` the catalog-IDE files** into `src/lib/`; fix the now-relative imports
  (the moved files import each other by `./` — paths are preserved by moving them together; only
  imports that crossed into `recipe-designer/` siblings outside the move set need fixing, of
  which there are none per Step 0).

- [ ] **Step 4: Write `src/public-api.ts`** (the stable surface):

```ts
export { CatalogDesignerComponent } from './lib/catalog-designer.component';
export { CATALOG_STORE } from './lib/catalog-store';
export { LocalStorageCatalogStore } from './lib/local-storage-catalog-store';
```

- [ ] **Step 5: Run the lib's tests** (the moved specs run in the lib now)
  Run: `cd domains/studio/libs/board-editor && npm test`
  Expected: all moved specs PASS (`catalog-parity.spec`, `catalog-store-persistence.spec`,
  `definition-drawer.spec`, `board-settings.spec`, etc.) — behaviour unchanged (parity-proof).

- [ ] **Step 6: Add the workspace dep + repoint the cockpit route.** In
  `apps/studio-ui/package.json` add `"@de-braighter/board-editor": "workspace:*"`; run
  `pnpm install` at `domains/studio` root. Edit `app.routes.ts`: change the three
  `./recipe-designer/...` catalog imports to `@de-braighter/board-editor`. **Leave the
  `/recipe-designer` route + `RecipeDesignerComponent` untouched** (R1c removes them).

- [ ] **Step 7: Run the cockpit build + tests**
  Run: `cd domains/studio/apps/studio-ui && npm run build && npm test`
  Expected: PASS. `app.routes.spec.ts` still asserts `/catalog` → `CatalogDesignerComponent`
  (now the lib's export — identity holds). knip green.

- [ ] **Step 8: Root workspace gate**
  Run: `cd domains/studio && pnpm -r run build && pnpm -r run test`
  Expected: lib builds before studio-ui (topological); all green.

- [ ] **Step 9: Commit** (`feat(board-editor): extract @de-braighter/board-editor lib; repoint cockpit /catalog`).

**Acceptance:** lib builds + tests green; studio-ui builds + tests green + `/catalog` works via
the lib; knip green; `ci:local` green; `public-api-stabilizer` clean; `opus-whole-branch` Yes.

---

## Task R1b: Scaffold `apps/board-editor-ui` consuming the lib (skin switcher; night-verified)

**Deliverable:** a standalone Angular app whose `/` route is the catalog IDE, with the `(3)`
top-bar shell + skin switcher, rendering correctly under `night`.

**Files:**
- Create the Angular-CLI app `domains/studio/apps/board-editor-ui/` mirroring
  `apps/studio-ui` structure: `angular.json` (project `board-editor-ui`, builder
  `@angular/build:application`, `styles: ["src/styles.css"]`, npm `packageManager`),
  `package.json` (deps: `@de-braighter/board-editor: workspace:*`,
  `@de-braighter/design-system-{core,angular,css}`, Angular; scripts `build`/`test`/`start`),
  `src/index.html` (`<html lang="en" data-theme="night">`), `src/main.ts`, `src/styles.css`
  (imports the design-system-css tokens — see Step 3), `src/app/app.ts`,
  `src/app/app.routes.ts`, `src/app/shell/board-editor-shell.component.ts`,
  `src/app/shell/skin-switcher.component.ts`, plus spec files.
- Modify: `domains/studio/pnpm-workspace.yaml` already includes `apps/*` — the new app is
  picked up automatically.

**Interfaces:**
- Consumes: `@de-braighter/board-editor` (`CatalogDesignerComponent`, `CATALOG_STORE`,
  `LocalStorageCatalogStore`), `@de-braighter/design-system-css/tokens.css`.
- Produces: a served app at `:4200`; `data-theme` on the root toggled by the switcher.

- [ ] **Step 1: Write the failing route test** `src/app/app.routes.spec.ts`:

```ts
import { routes } from './app.routes';
it("mounts the catalog IDE at '/'", () => {
  const root = routes.find((r) => r.path === '');
  expect(root).toBeDefined();
  expect(root!.providers).toBeDefined(); // CATALOG_STORE provided
});
```

- [ ] **Step 2: Run it — FAIL** (`app.routes.ts` not created).
  Run: `cd domains/studio/apps/board-editor-ui && npm test`

- [ ] **Step 3: Scaffold the app + styles.** `src/styles.css` first line:
  `@import '@de-braighter/design-system-css/tokens.css';` (the `[data-theme]` skin blocks +
  chrome tokens). `src/app/app.routes.ts`:

```ts
import { Routes } from '@angular/router';
import { CATALOG_STORE, LocalStorageCatalogStore, CatalogDesignerComponent } from '@de-braighter/board-editor';

export const routes: Routes = [
  {
    path: '',
    providers: [{ provide: CATALOG_STORE, useFactory: () => new LocalStorageCatalogStore() }],
    component: CatalogDesignerComponent, // mounted inside the shell via app.ts template
  },
];
```

- [ ] **Step 4: Write the shell + switcher.** `board-editor-shell.component.ts` = the `(3)`
  top bar (product mark + `catalog` pill + `<board-editor-skin-switcher>` + `↺ Reset`) wrapping
  `<router-outlet>`; standalone, OnPush, signals. `skin-switcher.component.ts`:

```ts
@Component({
  selector: 'board-editor-skin-switcher',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="sr-only" for="skin">Skin</label>
    <select id="skin" [value]="skin()" (change)="pick($any($event.target).value)">
      @for (s of skins; track s) { <option [value]="s">{{ s }}</option> }
    </select>`,
})
export class SkinSwitcherComponent {
  readonly skins = ['night', 'ivory', 'clinical'] as const;
  readonly skin = signal<(typeof this.skins)[number]>('night');
  pick(v: (typeof this.skins)[number]) {
    this.skin.set(v);
    document.documentElement.setAttribute('data-theme', v); // root [data-theme] drives all tokens
  }
}
```

- [ ] **Step 5: a11y test for the switcher** (WCAG: labelled control, keyboard-operable;
  reflect `data-theme` on the root). Assert `setAttribute('data-theme', 'ivory')` on change.

- [ ] **Step 6: Run app tests — PASS.**
  Run: `cd domains/studio/apps/board-editor-ui && npm test`

- [ ] **Step 7: BROWSER-VERIFY (night).** Serve + screenshot.
  Run: `cd domains/studio/apps/board-editor-ui && npm start` (`:4200`); use the browser tools to
  load `/`, confirm the catalog IDE **renders** (rail + node-layers + live `<ds-board-kit>`
  preview + diagram/code), single header, no console errors; screenshot
  `docs/board-editor-standalone-night-proof.png`. (night = parity with today's look.)

- [ ] **Step 8: Root workspace gate** `cd domains/studio && pnpm -r run build && pnpm -r run test` — green.

- [ ] **Step 9: Commit** (`feat(board-editor-ui): standalone app shell + skin switcher (night)`).

**Acceptance:** app builds + tests green; **renders under night** (screenshot attached); switcher
toggles `data-theme`; `ci:local` green; `opus-whole-branch` Yes. (ivory/clinical render-correctness
is R2.)

---

## Task R1c: Decouple the cockpit + retire the legacy form

**Deliverable:** `apps/studio-ui` no longer references the catalog IDE or the legacy recipe
designer; both routes gone; the legacy chain deleted; both route specs updated; knip green.

**Files:**
- Modify: `apps/studio-ui/src/app/app.routes.ts` (remove the `/recipe-designer` route + its
  head import; remove the `/catalog` route + its `@de-braighter/board-editor` imports +
  provider), `apps/studio-ui/src/app/app.spec.ts` (replace the line-29 smoke test),
  `apps/studio-ui/src/app/app.routes.spec.ts` (drop the `RecipeDesignerComponent`/
  `CatalogDesignerComponent` assertions; new exact table), `apps/studio-ui/package.json`
  (remove the `@de-braighter/board-editor` dep).
- Delete (legacy chain — exclusively reachable from `RecipeDesignerComponent`, confirmed
  import-disjoint in R1a Step 0): `recipe-designer.component.ts/.spec.ts`,
  `shapes-editor.component.ts/.spec.ts`, `shape-editor.component.ts/.spec.ts`,
  `primitives-editor.component.ts/.spec.ts`, `recipe-form.ts/.spec.ts`,
  `sample-tree.ts/.spec.ts` *(unless R1a Step 0 found it shared → then it's already in the lib)*,
  `plan-kinds.recipe.ts`, `plan-kinds-parity.spec.ts`. The now-empty
  `src/app/recipe-designer/` dir is removed.

- [ ] **Step 1: Update `app.routes.spec.ts` (failing first).** New expected table:

```ts
it('declares exactly the kept route table (shell + operate + catch-all)', () => {
  const declared = routes.map((r) => r.path).sort();
  expect(declared).toEqual(['', '**', 'operate']);
});
```
  Remove the `RecipeDesignerComponent` + `CatalogDesignerComponent` import lines + their
  component/loadComponent assertions.

- [ ] **Step 2: Update `app.spec.ts`.** Replace the line-29 `'should declare the
  recipe-designer route'` test with its inverse:

```ts
it('no longer declares the recipe-designer route (moved to the standalone Board Editor app)', () => {
  expect(routes.find((r) => r.path === 'recipe-designer')).toBeUndefined();
});
```

- [ ] **Step 3: Run the specs — FAIL** (routes still present).
  Run: `cd domains/studio/apps/studio-ui && npm test -- app.routes.spec app.spec`

- [ ] **Step 4: Edit `app.routes.ts`** to the kept table:

```ts
import { Routes } from '@angular/router';
export const routes: Routes = [
  { path: '', loadComponent: () => import('./studio-shell').then((m) => m.StudioShellComponent) },
  { path: 'operate', loadComponent: () => import('./operate').then((m) => m.OperatePage) },
  { path: '**', redirectTo: '' },
];
```

- [ ] **Step 5: Delete the legacy chain files** (git rm) + remove the
  `@de-braighter/board-editor` dep from `package.json`; `pnpm install`.

- [ ] **Step 6: Run cockpit build + tests + knip — PASS / clean.**
  Run: `cd domains/studio/apps/studio-ui && npm run build && npm test && npx knip`
  Expected: green; **knip reports no orphans** (legacy gone; catalog IDE in the lib, consumed
  only by `board-editor-ui` now).

- [ ] **Step 7: Root workspace gate** `cd domains/studio && pnpm -r run build && pnpm -r run test` — green.

- [ ] **Step 8: BROWSER-VERIFY the cockpit still renders** (regression guard): serve studio-ui,
  confirm `/` (shell) + `/operate` load with no console errors; `/recipe-designer` + `/catalog`
  now redirect to `/` (the `**` catch-all).

- [ ] **Step 9: Commit** (`refactor(studio-ui): decouple board editor; retire legacy recipe designer`).

**Acceptance:** cockpit builds + tests green; both route specs updated; legacy deleted; knip
clean; the standalone app + cockpit both render; `ci:local` green; `opus-whole-branch` Yes.

---

## Task R2: Reskin to the canonical + chrome token contract (all three skins)

**Deliverable:** the library's CSS uses only canonical + chrome tokens (no night-only fallbacks,
no hardcoded accent/status literals); `ivory`/`clinical`/`night` all render correctly, verified
against the handoff screenshots.

**Files:**
- Modify: `libs/board-editor/src/lib/catalog-designer.component.css` (the bulk),
  `instance-row.component.ts`, `definition-drawer.component.ts`, `composite-parts-editor.component.ts`,
  `board-settings.component.ts`, `svg-primitive-editor.component.ts`, `catalog-card.component.ts`
  (inline-style token swaps), and the `apps/board-editor-ui` shell glass chrome.
- Possibly modify: `apps/board-editor-ui/angular.json` (`anyComponentStyle` budget — see Step 6).

**The remap (apply verbatim from the spec §4.1):**

| Current literal | → canonical token |
|---|---|
| `#22d39a` / `var(--accent,#22d39a)` | `var(--accent)` |
| `rgba(34,211,154,.1/.12)` | `var(--accent-soft)` |
| accent outline/focus ring | `var(--accent-rim)` / `var(--accent-soft)` |
| `#0a0d14` (`--b1`) | `var(--bg)` |
| `#0f1320` (`--b2`) | `var(--paper)` / `var(--bg-elev)` |
| `#7c6dfa` | `var(--accent-2)` |
| `#f87171` / `#fbbf24` | `var(--color-risk)` / `var(--color-warn)` (+ `-soft`) |
| button label on accent fill | `var(--accent-on)` |
| top bar / drawer / code-panel surface | `background: var(--glass-bg); backdrop-filter: var(--glass-blur);` |
| left rail | `var(--rail-bg)` |
| drawer backdrop / shadow | `var(--scrim)` / `var(--glass-shadow)` |
| preview canvas dots | `var(--grid-dot)` |
| code view string / number | `var(--code-str)` / `var(--code-num)` |

Drop the `:host` night-only alias block (`--l/--f1/--f2/--ac/--b1/--b2` with dark fallbacks) —
reference canonical tokens directly. **Do NOT token-swap node-card `fill`s drawn on the preview
canvas** (authored content, theme-independent).

- [ ] **Step 1: Write the failing token-hygiene test** `libs/board-editor/src/lib/token-hygiene.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { globSync } from 'glob';
it('uses no retired tokens or hardcoded skin literals', () => {
  const files = globSync('src/lib/**/*.{ts,css}', { cwd: __dirname + '/..' });
  const forbidden = /--bg-[0-3]|--fg-[1-4]|--line-[1-3]|\[data-skin\]|Space Grotesk|#22d39a|rgba\(34,\s*211,\s*154|#0a0d14|#0f1320|#7c6dfa|#f87171|#fbbf24/;
  const offenders = files.filter((f) => forbidden.test(readFileSync(f, 'utf8')));
  expect(offenders).toEqual([]);
});
```

- [ ] **Step 2: Run it — FAIL** (the literals are still there).

- [ ] **Step 3: Apply the remap** across the CSS + inline styles (table above). Add the chrome
  tokens for the glass top bar (app shell), the `--rail-bg` rail, the drawer `--scrim`/
  `--glass-shadow`, the `--grid-dot` canvas, and the `--code-str/-num` code view.

- [ ] **Step 4: Run the hygiene test + all lib tests — PASS** (parity/persistence/focus specs
  still green: structure unchanged, only token references swapped → `parity-proof` holds).
  Run: `cd domains/studio/libs/board-editor && npm test`

- [ ] **Step 5: Run the app + root build.**
  Run: `cd domains/studio && pnpm -r run build`
  Expected: green. **If `anyComponentStyle` budget errors (catalog CSS ~11 kB > 8 kB):**

- [ ] **Step 6: Resolve the style budget** — EITHER raise `anyComponentStyle` for
  `board-editor-ui` in `angular.json` to a documented ceiling, OR move the large catalog CSS to
  a global stylesheet imported in `styles.css`. Document the choice in the PR. Re-run build → green.

- [ ] **Step 7: BROWSER-VERIFY ALL THREE SKINS** — the hard gate. Serve `board-editor-ui`; for
  each of `night` / `ivory` / `clinical` (via the switcher): confirm the surface **renders**
  (no blank/transparent panels), accent affordances match (`--accent` indigo on ivory, clinical
  blue on clinical), glass chrome + grid dots present, code view legible. Screenshot each and
  diff against `docs/ui-design/board-editor-studio-handoff/screenshots/{ivory,clinical,migrated}.png`.
  Save `docs/board-editor-standalone-{night,ivory,clinical}-proof.png`. A passing test suite does
  NOT substitute for this.

- [ ] **Step 8: a11y battery** — run the WCAG 2.2 AA checks (contrast `--ink` on `--bg` per skin,
  focus rings via `--accent-rim`/`--accent-soft`, target sizes) with `a11y-pro`.

- [ ] **Step 9: Commit** (`feat(board-editor): reskin to canonical + chrome tokens; 3-skin contract`).

**Acceptance:** token-hygiene test green; all lib + app tests green; **all three skins render**
(three screenshots attached, diffed vs handoff); a11y battery clean; `ci:local` green;
`opus-whole-branch` Yes.

---

## Task R3 (optional): Instance Row roving-toolbar a11y polish

**Deliverable:** the Instance Row's ↑↓/dup/del toolbar adopts `DbRovingToolbar`/`DbRovingItem`
(APG roving-tabindex, `@de-braighter/design-system-angular`), matching the board-kit precedent.

**Files:** Modify `libs/board-editor/src/lib/instance-row.component.ts` (+ spec).

- [ ] **Step 1:** Write the roving-tabindex test (one tab stop for the toolbar; arrow keys move
  between buttons; the existing WCAG-2.4.3 focus-recovery on delete still holds, fixture on
  `document.body`).
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Apply `DbRovingToolbar`/`DbRovingItem` to the toolbar row.
- [ ] **Step 4:** Run lib tests — PASS (focus-recovery + roving both green).
- [ ] **Step 5:** Browser-verify keyboard nav on the Instance Row toolbar.
- [ ] **Step 6:** Commit (`feat(board-editor): APG roving-tabindex on the Instance Row toolbar`).

**Acceptance:** roving + focus-recovery tests green; keyboard nav verified; `opus-whole-branch` Yes.

---

## Self-review (spec coverage)

- **(a) standalone form** → R1a (lib) + R1b (app) + R1c (cockpit decouple). ✓
- **(b) reconciliation KEEP/RE-SKIN/REBUILD** → KEEP = R1a move (tests prove parity); RE-SKIN =
  R2; REBUILD additions = R1b shell + switcher. ✓
- **(c) surface map** → every surface KEEP+reskin (R1a move, R2 reskin); shell built in R1b;
  `<ds-board-kit>` unchanged; optional roving in R3. ✓
- **(d) skin wiring** → R1b imports `@de-braighter/design-system-css/tokens.css` + `[data-theme]`
  root + switcher; R2 makes all three render + browser-verify vs screenshots. ✓
- **Decouple-first requirement** → R1a/R1b/R1c are the first items; reskin (R2) follows. ✓
- **Retire legacy / fix both spec files / knip green** → R1c. ✓
- **Zero kernel change / brick-change-escalates** → Global Constraints + every Acceptance. ✓
- **Quality gates (wave, a11y, browser-verify, opus-whole-branch, twin ritual)** → Global
  Constraints + per-task Acceptance. ✓

## Build-path mapping (for `/build-path`)

Append to product `board-editor-studio` (never re-push E1.1–E8.1). New items, `dependsOn` chain:

| itemId | scope (repo · pathPrefix) | dependsOn | qualityObligations |
|---|---|---|---|
| `board-editor-studio/R1a` | studio · `domains/studio/libs/board-editor/` + `apps/studio-ui/src/app/app.routes.ts` + `pnpm-workspace.yaml` | — | `tdd, review-floor, opus-whole-branch, parity-proof` |
| `board-editor-studio/R1b` | studio · `domains/studio/apps/board-editor-ui/` | `R1a` | `tdd, review-floor, opus-whole-branch, a11y-focus-recovery, browser-verify` |
| `board-editor-studio/R1c` | studio · `apps/studio-ui/src/app/` | `R1b` | `tdd, review-floor, opus-whole-branch` |
| `board-editor-studio/R2` | studio · `libs/board-editor/src/` + `apps/board-editor-ui/` | `R1c` | `tdd, review-floor, opus-whole-branch, parity-proof, a11y-focus-recovery, browser-verify` |
| `board-editor-studio/R3` (optional) | studio · `libs/board-editor/src/lib/instance-row.component.ts` | `R2` | `tdd, review-floor, opus-whole-branch, a11y-focus-recovery` |

Scopes are disjoint where unordered; the chain is `dependsOn`-ordered so the share-scope
exemption covers the `apps/studio-ui/src/` overlaps (R1a touches `app.routes.ts`, R1c touches the
wider `src/app/`).
