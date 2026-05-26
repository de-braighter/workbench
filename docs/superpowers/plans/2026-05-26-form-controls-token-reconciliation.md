# Form-controls token reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all 17 ported CVA form controls' `.scss` from fabricir token names to de-braighter `tokens.css` names so they render correctly in real de-braighter apps, add the two focus-ring tokens `tokens.css` lacks, and verify with one combined gallery page.

**Architecture:** A `var()`-anchored token-name substitution governed by one mapping table, applied across 17 `.scss`; two new `color-mix`-derived accent tokens in `tokens.css`; a shared `.db-stage` themed harness + a gallery page in the showcase to verify rendering (token-only — no control `.ts`/behaviour change).

**Tech Stack:** SCSS (Angular component styles), CSS custom properties + `color-mix(oklch)`, Angular standalone/OnPush + `FormsModule`/`ngModel`, Nx (`build`/`lint`), `sed` (git-bash).

**Spec:** `docs/superpowers/specs/2026-05-26-form-controls-token-reconciliation-design.md`

---

## Repos & branches (read first)

- **Docs** (spec + this plan) → **workbench** repo (`de-braighter/`), branch `docs/form-controls-token-reconciliation` (spec already committed there). No code here.
- **Code** → **design-system** repo at `D:/development/projects/de-braighter/layers/design-system/` (remote `de-braighter/design-system`). All tasks below run there, on branch `feat/form-controls-token-reconciliation`.

**Hard boundary:** work ONLY in `layers/design-system`. Do NOT touch `domains/exercir`, `db-button`, `db-pitch`, any control's `.ts`, or the dormant `cva-wiring.spec.ts` / the Analog×vitest-4 harness. SCSS tokens + tokens.css + showcase only.

**Commit convention:** message via a temp file OUTSIDE the repo, `git commit -F`, then delete. Never `--no-verify`, never force-push. End every message with `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.

A dev server may be running on port 4300 from this working tree; switching branches will trigger a rebuild — that's expected.

### Pre-flight: branch the design-system repo

- [ ] **Step 1: Branch off main**

Run (from `D:/development/projects/de-braighter/layers/design-system`):

```bash
git checkout main && git pull --ff-only && git checkout -b feat/form-controls-token-reconciliation
```

Expected: `Switched to a new branch 'feat/form-controls-token-reconciliation'`. (If `git pull` fails on the billing-blocked remote, branch off local `main`.) This `main` already contains the merged `db-button` work.

---

## Task 1: Add focus-ring tokens to tokens.css (design-system-css 1.3.0)

**Files:**
- Modify: `libs/design-system-css/src/tokens.css`
- Modify: `libs/design-system-css/package.json` (`1.2.0` → `1.3.0`)

- [ ] **Step 1: Add `--accent-soft` + `--accent-rim`**

In `libs/design-system-css/src/tokens.css`, find the existing one-line alias block:

```css
:root { --line: var(--rule); }
```

Replace it with:

```css
:root {
  --line: var(--rule);
  /* Accent focus-ring derivatives (used by form controls' :focus-within ring).
     Derived from the theme-scoped --accent via color-mix, so they adapt per
     theme. A theme may override them. */
  --accent-soft: color-mix(in oklch, var(--accent) 22%, transparent);
  --accent-rim:  color-mix(in oklch, var(--accent) 45%, transparent);
}
```

- [ ] **Step 2: Bump the version**

In `libs/design-system-css/package.json`, change `"version": "1.2.0"` to `"version": "1.3.0"`.

- [ ] **Step 3: Build to verify the token file is valid**

Run: `npx nx build design-system-css`
Expected: `Successfully ran target build for project design-system-css`. Then confirm the token is emitted:

Run: `grep -c "accent-soft" dist/libs/design-system-css/tokens.css`
Expected: `1` (or more).

- [ ] **Step 4: Commit**

```bash
git add libs/design-system-css/src/tokens.css libs/design-system-css/package.json
MSG=$(mktemp); printf '%s\n' "feat(css): add --accent-soft / --accent-rim focus-ring tokens (v1.3.0)" "" "color-mix-derived from the theme-scoped --accent so they adapt per" "theme. Needed by the form controls' :focus-within ring during the" "fabricir->de-braighter token reconciliation." "" "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" > "$MSG"
git commit -F "$MSG"; rm -f "$MSG"
```

---

## Task 2: Migrate the 17 controls' SCSS (the token reconciliation)

**Files:**
- Modify: every `libs/design-system-angular-forms/src/lib/*/*.scss` (17 files)
- Modify: `libs/design-system-angular-forms/package.json` (`0.0.1` → `0.1.0`)

- [ ] **Step 1: Write the mapping as a sed script (outside the repo)**

The substitutions are `var()`-anchored (match only token *usages*, never definitions/substrings) and govern the whole migration. Write them to a temp file:

```bash
SED=$(mktemp)
cat > "$SED" <<'EOF'
s/var(--fg-1)/var(--ink)/g
s/var(--fg-2)/var(--ink-2)/g
s/var(--fg-3)/var(--ink-3)/g
s/var(--fg-4)/var(--ink-4)/g
s/var(--line-1)/var(--rule)/g
s/var(--line-2)/var(--rule-strong)/g
s/var(--bg-inset)/var(--bg-sunken)/g
s/var(--bg-1)/var(--bg)/g
s/var(--bg-2)/var(--bg-elev)/g
s/var(--bg-3)/var(--paper)/g
s/var(--fs-body-sm)/var(--t-body-sm)/g
s/var(--fs-meta)/var(--t-meta)/g
s/var(--fs-overline)/var(--t-eyebrow)/g
s/var(--r-1)/var(--r-sm)/g
s/var(--r-2)/var(--r-md)/g
s/var(--r-3)/var(--r-lg)/g
s/var(--dur-1)/var(--dur-fast)/g
s/var(--dur-2)/var(--dur-base)/g
s/var(--dur-3)/var(--dur-slow)/g
s/var(--ok)/var(--sem-success)/g
s/var(--err)/var(--sem-danger)/g
s/var(--warn)/var(--sem-warning)/g
s/var(--info)/var(--sem-info)/g
s/var(--font-body)/var(--font-ui)/g
s/var(--tracking-caps)/var(--tr-caps)/g
s/var(--tracking-tight)/var(--tr-title)/g
s/var(--tracking-loose)/var(--tr-eyebrow)/g
EOF
echo "wrote $SED"
```

Tokens left untouched on purpose (already correct de-braighter names, or component-local): `--accent`, `--accent-soft`, `--accent-rim`, `--ease-out`, `--font-mono`, `--font-display`, `--lh-body`, `--r-pill`, `--s-1/2/3/4/6/8`, `--fc-seg-count`.

- [ ] **Step 2: Apply it to all 17 control SCSS files**

```bash
find libs/design-system-angular-forms/src/lib -name "*.scss" -exec sed -i -f "$SED" {} +
rm -f "$SED"
echo "migrated $(find libs/design-system-angular-forms/src/lib -name '*.scss' | wc -l) files"
```

Expected: `migrated 17 files`.

- [ ] **Step 3: Verify NO fabricir token names remain**

```bash
grep -rnE "var\(--(fg-[1-4]|line-[12]|bg-(inset|[123])|fs-(body-sm|meta|overline)|r-[123]|dur-[123]|ok|err|warn|info|font-body|tracking-(caps|tight|loose))\)" libs/design-system-angular-forms/src/lib
```

Expected: **no output** (exit 1). Any match means a usage was missed — STOP and report it. (If a stray match is a token NOT in the mapping, report it as a NEEDS_CONTEXT — the table may be incomplete.)

- [ ] **Step 4: Bump the version + build**

In `libs/design-system-angular-forms/package.json`, change `"version": "0.0.1"` to `"version": "0.1.0"`.

Run: `npx nx build design-system-angular-forms`
Expected: `Successfully ran target build`. (Build proves the SCSS still compiles; rendering is verified in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-angular-forms/src/lib libs/design-system-angular-forms/package.json
MSG=$(mktemp); printf '%s\n' "feat(forms): reconcile 17 controls' SCSS to de-braighter tokens (v0.1.0)" "" "var()-anchored migration off the fabricir token vocabulary (--fg-*," "--bg-*, --line-*, --fs-*, --r-*, --dur-*, --ok/err/warn/info, --font-body," "--tracking-*) onto de-braighter tokens.css names (--ink*, --bg*/--paper," "--rule*, --t-*, --r-sm/md/lg, --dur-*, --sem-*, --font-ui, --tr-*). Focus" "ring uses the new --accent-soft/--accent-rim. No .ts/behaviour change." "" "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" > "$MSG"
git commit -F "$MSG"; rm -f "$MSG"
```

---

## Task 3: Shared `.db-stage` themed harness

**Files:**
- Create: `apps/showcase/src/styles/_db-stage.scss`
- Modify: `apps/showcase/src/styles.scss` (add the `@import`)

- [ ] **Step 1: Create the partial**

Create `apps/showcase/src/styles/_db-stage.scss` (values mirror `design-system-css/src/tokens.css` `[data-theme="football"]` + `:root` scales):

```scss
// Shared de-braighter-themed harness for db-* showcase demos.
// The showcase's styles.scss declares fabricir token names; db-* bricks
// reference de-braighter tokens.css names. This scopes the de-braighter
// FOOTBALL theme token set under .db-stage so bricks render truthfully
// WITHOUT loading tokens.css globally (which would hijack the showcase via
// its body/* base rules). Mirrors tokens.css [data-theme="football"] + :root.
.db-stage {
  --bg: oklch(0.97 0.005 250);
  --bg-elev: oklch(0.99 0.004 250);
  --bg-sunken: oklch(0.94 0.010 250);
  --paper: oklch(0.99 0.003 250);
  --ink: oklch(0.18 0.02 260);
  --ink-2: oklch(0.32 0.018 260);
  --ink-3: oklch(0.50 0.014 260);
  --ink-4: oklch(0.70 0.010 260);
  --rule: oklch(0.88 0.012 260);
  --rule-strong: oklch(0.78 0.016 260);
  --accent: oklch(0.42 0.18 260); // --fc-blue
  --accent-soft: color-mix(in oklch, var(--accent) 22%, transparent);
  --accent-rim: color-mix(in oklch, var(--accent) 45%, transparent);

  --sem-success: oklch(0.55 0.13 145);
  --sem-danger: oklch(0.52 0.16 25);
  --sem-warning: oklch(0.62 0.14 75);
  --sem-info: oklch(0.50 0.11 230);

  --font-ui: "Inter Tight", Inter, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --font-display: "Newsreader", serif;
  --t-body-sm: 13px;
  --t-meta: 12px;
  --t-eyebrow: 10px;
  --lh-body: 1.50;
  --tr-caps: 0.120em;
  --tr-title: -0.015em;
  --tr-eyebrow: 0.080em;

  --r-sm: 4px;
  --r-md: 6px;
  --r-lg: 10px;
  --r-pill: 999px;
  --s-1: 4px;
  --s-2: 8px;
  --s-3: 12px;
  --s-4: 16px;
  --s-6: 24px;
  --s-8: 32px;
  --dur-fast: 160ms;
  --dur-base: 240ms;
  --dur-slow: 400ms;
  --ease-out: cubic-bezier(0, 0, .2, 1);

  background: var(--paper);
  color: var(--ink);
}
```

- [ ] **Step 2: Import it into the global stylesheet**

In `apps/showcase/src/styles.scss`, immediately AFTER the existing `@import '../../../libs/design-system-css/src/components/button';` line (added during the db-button work), add:

```scss
@import './styles/db-stage';
```

- [ ] **Step 3: Build to verify the partial compiles + is bundled**

Run: `npx nx build showcase`
Expected: `Successfully ran target build`. (A Sass `@import` deprecation warning is expected and acceptable, as with the button import.)

- [ ] **Step 4: Commit**

```bash
git add apps/showcase/src/styles/_db-stage.scss apps/showcase/src/styles.scss
MSG=$(mktemp); printf '%s\n' "feat(showcase): shared .db-stage de-braighter-themed harness" "" "Scopes the de-braighter football-theme token set under .db-stage so db-*" "bricks (form controls, db-button) render against real design-system tokens" "in the showcase without loading tokens.css globally." "" "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" > "$MSG"
git commit -F "$MSG"; rm -f "$MSG"
```

---

## Task 4: Form-controls verification gallery page

**Files:**
- Create: `apps/showcase/src/app/pages/form-controls.page.ts`
- Modify: `apps/showcase/src/app/nav.catalog.ts` (new "Form Controls" group)

- [ ] **Step 1: Create the gallery page**

Create `apps/showcase/src/app/pages/form-controls.page.ts` (control usages mirror the lib's `cva-wiring.spec.ts` Host — the authoritative reference for each control's required inputs):

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  DbInput, DbArea, DbNumber, DbToggle, DbSegment, DbCheck, DbSelect, DbMulti,
  DbSlider, DbRange, DbColor, DbOtp, DbDrop, DbSearch, DbToken, DbDate, DbCombo,
} from '@de-braighter/design-system-angular-forms';

@Component({
  selector: 'show-form-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule, DbInput, DbArea, DbNumber, DbToggle, DbSegment, DbCheck,
    DbSelect, DbMulti, DbSlider, DbRange, DbColor, DbOtp, DbDrop, DbSearch,
    DbToken, DbDate, DbCombo,
  ],
  styles: [`
    .wrap { max-width: 1100px; margin: 48px auto; padding: 0 24px; }
    h1 { font-size: 2.2rem; margin: 0 0 8px; font-family: var(--font-display); }
    .subtitle { color: var(--fg-3); margin: 0 0 24px; }
    .stage { padding: 28px; border-radius: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 22px; }
    .cell { display: flex; flex-direction: column; gap: 6px; }
    .cell > .lbl { font-family: var(--font-mono); font-size: 11px; color: var(--ink-3); }
  `],
  template: `
    <div class="wrap">
      <h1>Form Controls</h1>
      <p class="subtitle">17 reactive-forms CVA controls rendered against de-braighter tokens (football theme) — token-reconciliation verification gallery.</p>
      <div class="stage db-stage">
        <div class="grid">
          <div class="cell"><span class="lbl">db-input</span><db-input placeholder="Text…" [(ngModel)]="text" /></div>
          <div class="cell"><span class="lbl">db-search</span><db-search [(ngModel)]="text" /></div>
          <div class="cell"><span class="lbl">db-area</span><db-area [(ngModel)]="text" /></div>
          <div class="cell"><span class="lbl">db-number</span><db-number [(ngModel)]="num" /></div>
          <div class="cell"><span class="lbl">db-otp</span><db-otp [length]="4" [(ngModel)]="text" /></div>
          <div class="cell"><span class="lbl">db-select</span><db-select [options]="opts" [(ngModel)]="text" /></div>
          <div class="cell"><span class="lbl">db-combo</span><db-combo [(ngModel)]="text" /></div>
          <div class="cell"><span class="lbl">db-multi</span><db-multi [(ngModel)]="list" /></div>
          <div class="cell"><span class="lbl">db-segment</span><db-segment [options]="opts" [(ngModel)]="text" /></div>
          <div class="cell"><span class="lbl">db-check</span><db-check label="Enabled" [(ngModel)]="bool" /></div>
          <div class="cell"><span class="lbl">db-toggle</span><db-toggle [(ngModel)]="bool" /></div>
          <div class="cell"><span class="lbl">db-slider</span><db-slider [min]="0" [max]="100" [(ngModel)]="num" /></div>
          <div class="cell"><span class="lbl">db-range</span><db-range [min]="0" [max]="100" [(ngModel)]="range" /></div>
          <div class="cell"><span class="lbl">db-color</span><db-color [options]="colors" [(ngModel)]="text" /></div>
          <div class="cell"><span class="lbl">db-date</span><db-date [(ngModel)]="date" /></div>
          <div class="cell"><span class="lbl">db-token</span><db-token [(ngModel)]="text" /></div>
          <div class="cell"><span class="lbl">db-drop</span><db-drop [(ngModel)]="file" /></div>
        </div>
      </div>
    </div>
  `,
})
export class FormControlsPage {
  protected text = 'hello';
  protected num = 42;
  protected bool = true;
  protected list: readonly string[] = ['alpha', 'beta'];
  protected range = { lo: 20, hi: 80 };
  protected date: string | null = '2026-04-14';
  protected file: File | null = null;
  protected opts = [
    { value: 'hello', label: 'Hello' },
    { value: 'world', label: 'World' },
  ];
  protected colors = ['#6dd2ff', '#7be3a3', '#f5b544'];
}
```

> If `nx build showcase` reports a template type error on any control's inputs (the spec Host is the source of truth, but a control's public input names may differ), read that control's `.ts` `input()` signatures under `libs/design-system-angular-forms/src/lib/<name>/` and correct the binding. Report it if unclear.

- [ ] **Step 2: Register a "Form Controls" group in the catalog**

In `apps/showcase/src/app/nav.catalog.ts`, add a new group object to the `NAV_CATALOG` array (after the `bricks` group, before `interaction`):

```ts
  {
    id: 'form-controls',
    title: 'Form Controls',
    items: [
      { id: 'gallery', label: 'Gallery', load: () => import('./pages/form-controls.page').then((m) => m.FormControlsPage) },
    ],
  },
```

- [ ] **Step 3: Build the showcase**

Run: `npx nx build showcase`
Expected: `Successfully ran target build for project showcase and N tasks it depends on`. (Nx rebuilds `design-system-angular-forms` first via `^build`, so the control imports + the new `0.1.0` resolve.)

- [ ] **Step 4: Commit**

```bash
git add apps/showcase/src/app/pages/form-controls.page.ts apps/showcase/src/app/nav.catalog.ts
MSG=$(mktemp); printf '%s\n' "feat(showcase): form-controls verification gallery (all 17)" "" "Renders every CVA control inside .db-stage (de-braighter tokens) to verify" "the token reconciliation renders correctly. New 'Form Controls' nav group;" "control usages mirror the lib's cva-wiring spec Host." "" "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>" > "$MSG"
git commit -F "$MSG"; rm -f "$MSG"
```

---

## Task 5: Local gate + visual verification

- [ ] **Step 1: Builds + lint green**

```bash
npx nx build design-system-css && npx nx build design-system-angular-forms && npx nx build showcase
npx nx lint design-system-css && npx nx lint design-system-angular-forms && npx nx lint showcase
```
Expected: all `Successfully ran target …`. (Pre-existing showcase warnings in unrelated pages are fine; no NEW errors.)

- [ ] **Step 2: Visual verification of the gallery (the real safety net)**

Serve the showcase (`npx nx serve showcase --port 4300` if not already running) and open `http://localhost:4300/form-controls/gallery`. Confirm **every one of the 17 controls renders correctly** under de-braighter tokens: inputs have a visible recessed background + border, focus shows the accent ring (`--accent-soft`/`--accent-rim`), text uses the de-braighter font, status/semantic colors are right, no control is unstyled or mis-coloured. Pay special attention to the **judgment-call mappings**: surfaces (`--bg-*`), radii (`--r-*`), motion (`--dur-*`). If a control looks wrong, adjust that token's mapping in its `.scss` (or the relevant rule), rebuild, re-check, and commit the fix with a `fix(forms):` message.

- [ ] **Step 3: Confirm the boundary held**

```bash
git diff --stat main..feat/form-controls-token-reconciliation
```
Expected: only files under `libs/design-system-css/`, `libs/design-system-angular-forms/src/lib/*/*.scss` + its `package.json`, and `apps/showcase/`. NO control `.ts`, NO `db-button`/`db-pitch`, NO `domains/` paths, NO change to `cva-wiring.spec.ts`.

---

## Post-merge publish runbook (manual — NOT subagent tasks)

After merge: `npm run build:libs`, then publish only the two changed libs from their `dist/` folders — `design-system-css@1.3.0` and `design-system-angular-forms@0.1.0` — with `npm publish --userconfig=../../../.npmrc`. (Forms `0.1.0` is the first publish that's actually consumable by a de-braighter app.)

---

## Self-review notes

- **Spec coverage:** mapping table → Task 2 (`var()`-anchored sed + verify grep) · `--accent-soft/-rim` → Task 1 · `_db-stage.scss` harness → Task 3 · gallery + nav → Task 4 · version bumps → Tasks 1,2 · gate + visual verification + boundary → Task 5 · publish runbook included. All spec §3 In-scope items mapped.
- **Token-name consistency:** every fabricir LHS in the Task 2 sed maps to a de-braighter token that the Task 3 `_db-stage.scss` defines (so the gallery resolves them); the verify grep (Task 2 Step 3) enumerates the exact same LHS set.
- **Scope guard:** no control `.ts`, no `@maturity`/CVA-governance/per-control polish, no test-harness reactivation — all deferred per the spec.
