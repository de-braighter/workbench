# Kids-Football i18n (Transloco, de + en) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Internationalize the Club Grass kids-football UI with Transloco so the language switches at runtime (German ↔ English) with **no page reload**, shipping de (hand-quality) + en (fallback) with fr/it as a trivial fast-follow.

**Architecture:** Adopt `@jsverse/transloco` (reactive, standalone `provideTransloco`, built-in localStorage persist + browser-detect). A custom TS `TranslocoLoader` serves the existing flat dotted-key Records (`KF_MESSAGES_EN` + new `KF_MESSAGES_DE`) — no JSON assets. The ~26 components migrate from the home-grown `kfMsg('kf.x')`/`{{ msg.x }}` pattern to the reactive `{{ 'kf.x' | transloco }}` pipe; a shell `<select>` calls `setActiveLang()`.

**Tech Stack:** Nx 22 + npm-workspaces, Angular 21.2 (standalone, signals, OnPush), `@jsverse/transloco` v8, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-exercir-kids-football-i18n-transloco-design.md`

**Branch / worktree:** off `origin/main` (`a274fa8` = merged slice 8) in a FRESH worktree `domains/exercir-wt-kf-i18n` on `feat/kids-football-i18n-transloco`. ALL git ops in the worktree — NEVER touch the main clone.

---

## Conventions (read once)

- **Gates without masking pipes:** `npm run ci:local > /tmp/ci.log 2>&1; echo "EXIT=$?"` then READ the log.
- **Angular unit tests:** `NX_DAEMON=false npx nx test pack-kids-football-ui` (full project; the executor rejects spec filters).
- **Commit per task.** Conventional commits, `kids-football:` scope.
- The kids-football UI is a **buildable Angular lib** (`libs/pack-kids-football-ui`) hosted by `pack-football-visual-editor`. Prod build: `npx nx build pack-football-visual-editor`.

## Migration recipe (the procedure EVERY component-migration task follows — Tasks 5–10)

For each component in the task's list:
1. Add the Transloco pipe to the standalone component's `imports`: `import { TranslocoModule } from '@jsverse/transloco';` → add `TranslocoModule` to `imports: [...]`. (For TS-side strings that can't use the pipe — aria-labels built in `.ts`, `kf-error` mapping — inject `TranslocoService` and call `translate('kf.x', params)`; for reactive TS values use `selectTranslate`.)
2. In the template, replace each `{{ msg.x }}` (or `{{ kfMsg('kf.x') }}`) with `{{ 'kf.x' | transloco }}`. Interpolated strings (previously `kfMsgN`/`kfMsgNamed`/`kfMsgSubst`): `{{ 'kf.x' | transloco: { n: count } }}` / `{ name: x }` / `{ ...subs }`. The Transloco bundle keeps the SAME `{n}`/`{name}`/`{...}` placeholder syntax, so the key strings are unchanged.
3. Plural `.one/.other` keys: keep the pick in template/TS — `{{ (count === 1 ? 'kf.x.one' : 'kf.x.other') | transloco: { n: count } }}`.
4. Remove the now-unused `protected readonly msg = {...}` object + the `kfMsg*` imports from the component.
5. Update the component's spec: provide Transloco in the TestBed via `TranslocoTestingModule.forRoot({ langs: { en: KF_MESSAGES_EN }, translocoConfig: { availableLangs: ['en'], defaultLang: 'en' }, preloadLangs: true })` (a shared test helper — see Task 2 Step 7). The spec keeps asserting the ENGLISH rendered strings (test default = en), so assertions are unchanged except the TestBed providers.
6. Run `NX_DAEMON=false npx nx test pack-kids-football-ui` (green) + `npx nx build pack-kids-football-ui` (green) after each task; commit.

> A component that builds aria/text purely in TS (e.g. `attendance-dots` status labels) uses `TranslocoService.translate()` not the pipe — note it per-component.

---

## Task 1: Worktree + Transloco install (the Angular-21.2 peer-dep GATE)

**Files:** `domains/exercir/package.json` (+ lockfile)

- [ ] **Step 1: Create the worktree off origin/main**

From `de-braighter/`:
```bash
cd domains/exercir && git fetch origin
git worktree add ../exercir-wt-kf-i18n -b feat/kids-football-i18n-transloco origin/main
cd ../exercir-wt-kf-i18n && GITHUB_TOKEN=$GITHUB_TOKEN npm ci
```
Expected: worktree at `domains/exercir-wt-kf-i18n`, install succeeds. ALL subsequent steps run here.

- [ ] **Step 2: Attempt the Transloco install (THE GATE)**

Run:
```bash
GITHUB_TOKEN=$GITHUB_TOKEN npm install @jsverse/transloco > /tmp/tl-install.log 2>&1; echo "EXIT=$?"
```
Read the log. Expected: resolves clean against Angular 21.2.
- If it FAILS on a peer-dep conflict (`ERESOLVE`, Angular `<21`): try the `@next` tag (`npm install @jsverse/transloco@next`). If still blocked, **STOP and report BLOCKED** with the peer range — the orchestrator decides the fallback (ngx-translate with the same pipe pattern, or a signal-based resolver). Do NOT force `--legacy-peer-deps` to mask an incompatibility without the orchestrator's call.

- [ ] **Step 3: Verify the version + build baseline**

```bash
grep '"@jsverse/transloco"' package.json
npx nx run-many -t build > /tmp/baseline.log 2>&1; echo "EXIT=$?"
```
Expected: transloco pinned (note the version); build EXIT=0 (slice-8 baseline still green).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(kids-football): add @jsverse/transloco (Angular 21 verified)"
```

---

## Task 2: Provider wiring + TS loader + EN bundle split + shell pilot + switcher

> This is the vertical that proves the whole reactive mechanism on ONE surface (the shell) before the bulk migration.

**Files:**
- Create: `libs/pack-kids-football-ui/src/lib/kf-i18n.en.ts`, `…/i18n/kf-transloco-loader.ts`, `…/i18n/kf-transloco.providers.ts`, `…/i18n/kf-transloco-testing.ts`
- Modify: `libs/pack-kids-football-ui/src/lib/kf-i18n.ts`, `…/shell/kf-shell.component.ts` (+ spec), the host app providers (`apps/pack-football-visual-editor/src/.../app.config.ts` or wherever `KIDS_FOOTBALL_ROUTES` mount their providers)
- Test: `…/i18n/kf-transloco-loader.spec.ts`, `…/shell/kf-shell.component.spec.ts`

- [ ] **Step 1: Move the EN bundle.** Create `kf-i18n.en.ts` exporting `export const KF_MESSAGES_EN: Readonly<Record<string,string>> = { ...the existing 446 keys verbatim... }` (cut from `kf-i18n.ts`). Keep `kf-i18n.ts` re-exporting `KF_MESSAGES_EN` (+ the existing `kfMsg*` fns reading EN for now, so nothing breaks mid-migration).

- [ ] **Step 2: Write the loader + its failing test.** `kf-transloco-loader.spec.ts`:
```ts
import { KfTranslocoLoader } from './kf-transloco-loader.js';
import { KF_MESSAGES_EN } from '../kf-i18n.en.js';
import { firstValueFrom, isObservable, of } from 'rxjs';
it('returns the EN record for en', async () => {
  const out = new KfTranslocoLoader().getTranslation('en');
  const res = isObservable(out) ? await firstValueFrom(out) : out;
  expect(res['kf.shell.nav.team']).toBe('Team');
});
```
Run → FAIL.

- [ ] **Step 3: Implement the loader.**
```ts
import { Injectable } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { of, Observable } from 'rxjs';
import { KF_MESSAGES_EN } from '../kf-i18n.en.js';
import { KF_MESSAGES_DE } from '../kf-i18n.de.js'; // created in Task 3 — until then, fall back to EN

@Injectable({ providedIn: 'root' })
export class KfTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(lang === 'de' ? KF_MESSAGES_DE : KF_MESSAGES_EN);
  }
}
```
NOTE: `kf-i18n.de.ts` is created in Task 3. To keep Task 2 self-contained + green, temporarily import `KF_MESSAGES_EN as KF_MESSAGES_DE` (alias) OR create a stub `kf-i18n.de.ts = { ...KF_MESSAGES_EN }` placeholder; Task 3 replaces it with real German. Pick the stub-file approach so the import path is stable.

- [ ] **Step 4: Browser-default resolver.** In `kf-transloco.providers.ts`, a helper:
```ts
export function kfDefaultLang(getBrowser: () => string | undefined = () => navigator.language): 'de' | 'en' {
  return (getBrowser() ?? '').toLowerCase().startsWith('de') ? 'de' : 'en';
}
```
+ a spec: `de-CH`→`de`, `fr-FR`→`en`, `undefined`→`en`.

- [ ] **Step 5: Provider factory.** In `kf-transloco.providers.ts`:
```ts
import { provideTransloco, TranslocoConfig } from '@jsverse/transloco';
import { provideTranslocoPersistLang } from '@jsverse/transloco-persist-lang';
import { KfTranslocoLoader } from './kf-transloco-loader.js';
import { kfDefaultLang } from './kf-default-lang.js';

export function provideKidsFootballI18n() {
  return [
    provideTransloco({
      config: { availableLangs: ['de', 'en'], defaultLang: kfDefaultLang(), fallbackLang: 'en', reRenderOnLangChange: true, missingHandler: { useFallbackTranslation: true } },
      loader: KfTranslocoLoader,
    }),
    provideTranslocoPersistLang({ storageKey: 'cg.lang', storage: { useValue: localStorage } }),
  ];
}
```
(Verify the exact `provideTranslocoPersistLang` import path + options against the installed version — adjust if the API differs; the intent is localStorage persistence under `cg.lang`. If the persist-lang plugin is a separate package, `npm install @jsverse/transloco-persist-lang` in Task 1's follow-up + note it.)

- [ ] **Step 6: Wire into the host app.** Add `...provideKidsFootballI18n()` to the host app's providers (find where `pack-football-visual-editor` registers app-level providers / where `KIDS_FOOTBALL_ROUTES` mount). If a global provider would affect the sibling pack-football surfaces undesirably, scope it to the kids-football route subtree via `providers: [...]` on the route. Pick the narrowest placement; note the choice.

- [ ] **Step 7: Shared test helper.** `kf-transloco-testing.ts`:
```ts
import { TranslocoTestingModule, TranslocoTestingOptions } from '@jsverse/transloco';
import { KF_MESSAGES_EN } from '../kf-i18n.en.js';
export function kfTranslocoTesting(options: TranslocoTestingOptions = {}) {
  return TranslocoTestingModule.forRoot({
    langs: { en: KF_MESSAGES_EN },
    translocoConfig: { availableLangs: ['en'], defaultLang: 'en' },
    preloadLangs: true,
    ...options,
  });
}
```

- [ ] **Step 8: Migrate the shell (pilot) + add the switcher.** Apply the Migration recipe to `kf-shell.component.ts` (nav links, aria, sign-out, team-switcher labels → pipe). Add the language `<select>`:
```html
<select [attr.aria-label]="'kf.shell.langSwitcher.aria' | transloco" data-testid="kf-lang-select"
        [value]="transloco.getActiveLang()" (change)="onLangChange($event)">
  <option value="de">Deutsch</option><option value="en">English</option>
</select>
```
```ts
constructor(protected transloco: TranslocoService) {}
onLangChange(e: Event) { this.transloco.setActiveLang((e.target as HTMLSelectElement).value); }
```
Add the new keys `kf.shell.langSwitcher.aria` (+ `kf.shell.lang.de`/`.en` if labels are translated) to `kf-i18n.en.ts` (+ the DE stub).

- [ ] **Step 9: Shell spec.** Use `kfTranslocoTesting()`; assert the nav renders English; assert the lang select renders both options; assert `(change)` calls `setActiveLang`. Add a **reactive-switch test**: `transloco.setActiveLang('de')` then `fixture.detectChanges()` → a nav label shows the DE value (seed the test module with both `en` + a tiny `de` map for this one assertion) WITHOUT re-creating the component (proves no-reload).

- [ ] **Step 10: Verify + commit.** `NX_DAEMON=false npx nx test pack-kids-football-ui` + `npx nx build pack-football-visual-editor` green. Commit: `feat(kids-football): wire Transloco (TS loader + persist + browser-detect) + migrate shell + language switcher`.

---

## Task 3: German bundle + key-parity spec

**Files:** Create/replace `libs/pack-kids-football-ui/src/lib/kf-i18n.de.ts`; Test `…/kf-i18n.parity.spec.ts`

- [ ] **Step 1: Parity spec (failing until DE is complete).**
```ts
import { KF_MESSAGES_EN } from './kf-i18n.en.js';
import { KF_MESSAGES_DE } from './kf-i18n.de.js';
it('DE has exactly the EN key set', () => {
  expect(Object.keys(KF_MESSAGES_DE).sort()).toEqual(Object.keys(KF_MESSAGES_EN).sort());
});
it('DE preserves every {placeholder} token of EN', () => {
  for (const k of Object.keys(KF_MESSAGES_EN)) {
    const toks = (s: string) => (s.match(/\{[^}]+\}/g) ?? []).sort();
    expect(toks(KF_MESSAGES_DE[k])).toEqual(toks(KF_MESSAGES_EN[k]));
  }
});
```

- [ ] **Step 2: Translate all 446 keys → German (de-CH, hand-quality).** Replace the stub `kf-i18n.de.ts` with `export const KF_MESSAGES_DE: Readonly<Record<string,string>> = { ... }` — every EN key, translated to natural German UI copy (`ss` not `ß`; preserve `{n}`/`{name}`/`{...}` + the `.one/.other` keys; keep the developmental-ethics tone non-deficit, e.g. `kf.player.dev.notYet` → "– Noch nicht", the practice caption → a faithful German rendering). Use the design handoff German sense where applicable; keep football terms natural (Drill → "Übung", Template → "Vorlage", Slot → "Trainingszeit"/"Zeitfenster", Match → "Spiel", Attendance → "Anwesenheit", Coach → "Trainer", Team manager → "Teammanager"). The orchestrator may dispatch a dedicated translation subagent for this; quality matters (it's the primary user-facing locale).

- [ ] **Step 3: Verify + commit.** Parity spec green; `NX_DAEMON=false npx nx test pack-kids-football-ui`. Commit: `feat(kids-football): German (de-CH) translation bundle + EN/DE key-parity spec`.

---

## Tasks 4–9: Component migration by area (follow the Migration recipe)

Each task migrates its components' templates to the `transloco` pipe + updates specs with `kfTranslocoTesting()`, runs the suite + lib build green, commits. (The shell is already done in Task 2.)

### Task 4: Landing + auth + onboarding
**Components:** `landing/club-picker-page.component.ts`, `auth/sign-in-page.component.ts`, `onboarding/onboarding-wizard.component.ts` (+ specs). Commit: `feat(kids-football): migrate landing/auth/onboarding to transloco pipe`.

### Task 5: Club admin
**Components:** `admin/club-admin-shell.component.ts`, `admin/members-page.component.ts`, `admin/teams-page.component.ts`, `admin/resources-page.component.ts`, `admin/slots-page.component.ts` (+ specs). Commit: `feat(kids-football): migrate club-admin pages to transloco pipe`.

### Task 6: Drills
**Components:** `drills/drill-library-page.component.ts`, `drills/drill-editor-page.component.ts`, `drills/kf-intensity-dots.component.ts`, `drills/sketch/kf-sketcher.component.ts` (+ specs). Commit: `feat(kids-football): migrate drills surfaces to transloco pipe`.

### Task 7: Templates + calendar
**Components:** `templates/template-list-page.component.ts`, `templates/template-builder-page.component.ts`, `calendar/calendar-page.component.ts`, `calendar/calendar-week-grid.component.ts`, `calendar/event-detail-modal.component.ts`, `calendar/match-modal.component.ts`, `calendar/schedule-training-modal.component.ts`, `calendar/upcoming-rail.component.ts` (+ specs). Commit: `feat(kids-football): migrate templates + calendar to transloco pipe`.

### Task 8: Run-session + team
**Components:** `run/run-session-page.component.ts`, `team/team-page.component.ts`, `team/player-modal.component.ts`, `team/attendance-dots.component.ts` (+ specs). NOTE `attendance-dots` builds status text/aria in TS → inject `TranslocoService` + `translate()` (no pipe). Commit: `feat(kids-football): migrate run-session + team to transloco pipe`.

### Task 9: kf-error + retire the home-grown resolvers
**Files:** `data/kf-error.ts` (+ spec), `kf-i18n.ts`
- `kf-error.ts` maps an `HttpErrorResponse` → an i18n key OUTSIDE a template → inject `TranslocoService` and return `translate(key, params)` (it currently calls `kfMsg`). Update its spec to provide Transloco.
- Once `git grep "kfMsg\|kfMsgN\|kfMsgNamed\|kfMsgSubst" libs/pack-kids-football-ui/src` returns only `kf-i18n.ts` itself, **remove the four `kfMsg*` functions** from `kf-i18n.ts` (keep the `KF_MESSAGES_EN` re-export if anything imports it; the loader imports from `kf-i18n.en.ts`). Commit: `refactor(kids-football): route kf-error through TranslocoService + retire kfMsg resolvers`.

> After each of Tasks 4–9: `NX_DAEMON=false npx nx test pack-kids-football-ui` + `npx nx build pack-kids-football-ui` MUST be green before commit. If a component used a `kfMsg*` form not covered by the recipe, handle it with the `TranslocoService` equivalent.

---

## Task 10: Finishing — gates, browser run-through, screenshot

- [ ] **Step 1: Full gates.** `npm run ci:local > /tmp/ci.log 2>&1; echo "EXIT=$?"` (read it; EXIT=0); `npm run test:db > /tmp/db.log 2>&1; echo "EXIT=$?"` (unchanged UI-only, confirm green); `npx nx build pack-football-visual-editor > /tmp/prod.log 2>&1; echo "EXIT=$?"` (no new 8kB ERROR).
- [ ] **Step 2: Confirm no stragglers.** `git grep -nE "kfMsg\b|\\bmsg\\.[a-z]" libs/pack-kids-football-ui/src/lib --include=*.html` and the component templates — every user-facing string goes through the pipe (or `translate()`); no `{{ msg.x }}` remain. Fix any missed.
- [ ] **Step 3: Browser run-through (Playwright MCP).** Kill orphan :3150/:4200; serve the worktree api (PORT=3150 in-memory) + host (:4200). Sign in → **flip the shell language to Deutsch → the whole UI (nav, roster, modals, run-session) renders in German with NO reload** → flip back to English → reload the page → German/English persists (localStorage `cg.lang`). Screenshot the German UI to `de-braighter/docs/club-grass-i18n-de-proof.png`.
- [ ] **Step 4: Commit any run-through fixes.**

---

## After the plan (orchestrator)
1. Create the `type/story` issue (`de-braighter/exercir`) + `Closes #NN` in the PR body.
2. PR with `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`, `Effort: standard`, `Effect: cycle-time …±… expert`, `Effect: findings …±… expert`.
3. Verifier wave (reviewer + qa-engineer + exercir-charter-checker + i18n-pro if available; local-ci) read-only on the worktree (no isolation:worktree; forbid git-writes + main-clone access). Ask i18n-pro/qa to check the parity, the no-reload reactive switch, and that the German copy is non-deficit + placeholder-faithful.
4. post-findings (`de-braighter/exercir#NN`, push the branch FIRST so paths resolve) → fix blockers/should-fixes → merge (squash) → twin ritual (drain pre-merge; backfill + reviews + resolve-findings + reconcile post-merge).
5. Update the `exercir-kids-football-mvp-arc` memory (i18n shipped; fr/it fast-follow seam; club.locale seam).

---

## Self-Review (completed)

- **Spec coverage:** §3.1 Transloco → Task 1+2; §3.2 de+en scope → Task 3 (de) + Task 2 (en); §3.3 TS loader → Task 2; §3.4 browser-detect+switcher+persist → Task 2 (providers + shell); §3.5 component pipe migration → Tasks 2,4–9 + the recipe; §3.6 reRenderOnLangChange → Task 2 Step 5/9; §4.1 peer-dep gate → Task 1; §4.2 bundles → Task 2/3; §4.3 kf-error → Task 9; §4.4 switcher → Task 2; §5 testing → each task + Task 10 (parity, reactive-switch, browser run-through). All covered.
- **Placeholder scan:** the host-provider location (Task 2 Step 6) + the exact persist-lang import (Step 5) are deliberately "verify against installed version" — these are install-version facts the implementer confirms, not vague requirements; the intent (localStorage `cg.lang`, narrowest placement) is explicit. No TBD/TODO.
- **Type consistency:** `KF_MESSAGES_EN`/`KF_MESSAGES_DE`, `KfTranslocoLoader`, `provideKidsFootballI18n`, `kfTranslocoTesting`, `kfDefaultLang`, storageKey `cg.lang` used consistently across tasks.
