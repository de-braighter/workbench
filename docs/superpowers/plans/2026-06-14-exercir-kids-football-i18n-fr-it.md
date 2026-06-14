# Kids-Football i18n French + Italian Locales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add French (fr) + Italian (it) to the shipped Transloco i18n so the Club Grass shell switcher offers de / en / fr / it with the same reactive no-reload live switch; fr/it ship as machine-translated drafts (de-CH + en authoritative).

**Architecture:** A pure drop-in onto the seam the de+en pass built — two new flat dotted-key Record bundles (`KF_MESSAGES_FR`/`KF_MESSAGES_IT`), a four-way loader map, two more `availableLangs` + shell `<option>`s, and two parity-spec `LOCALES` entries. Keep the 2-key `.one/.other` plural pick (no ICU). Keep all four catalogs eager (no lazy-load) and bump the host `initial` build budget to fit them. No new dependency, no schema, no API, no substrate/kernel touch.

**Tech Stack:** Nx 22 + npm-workspaces, Angular 21.2 (standalone, signals, OnPush), `@jsverse/transloco` v8 (already installed), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-14-exercir-kids-football-i18n-fr-it-design.md`

**Branch / worktree:** off `origin/main` (`b33de39` = merged i18n de+en) in a FRESH worktree `domains/exercir-wt-kf-i18n-frit` on `feat/kids-football-i18n-fr-it`. ALL git ops in the worktree — NEVER touch the main clone.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `libs/pack-kids-football-ui/src/lib/kf-i18n.en.ts` | EN source-of-keys | Modify (+2 lang-autonym keys) |
| `libs/pack-kids-football-ui/src/lib/kf-i18n.de.ts` | DE authoritative | Modify (+2 lang-autonym keys) |
| `libs/pack-kids-football-ui/src/lib/kf-i18n.fr.ts` | FR draft bundle | **Create** (458 keys) |
| `libs/pack-kids-football-ui/src/lib/kf-i18n.it.ts` | IT draft bundle | **Create** (458 keys) |
| `libs/pack-kids-football-ui/src/lib/kf-i18n.parity.spec.ts` | Parity gate | Modify (+fr,+it in LOCALES) |
| `libs/pack-kids-football-ui/src/lib/i18n/kf-transloco-loader.ts` | lang → Record | Modify (4-way map) |
| `libs/pack-kids-football-ui/src/lib/i18n/kf-transloco.providers.ts` | Transloco config | Modify (availableLangs) |
| `libs/pack-kids-football-ui/src/lib/shell/kf-shell.component.ts` | Switcher `<select>` | Modify (+2 options) |
| `libs/pack-kids-football-ui/src/lib/shell/kf-shell.component.spec.ts` | Shell spec | Modify (4-option assertions) |
| `apps/pack-football-visual-editor/project.json` | Host build budget | Modify (initial maximumError) |

---

## Conventions (read once)

- **Gates without masking pipes:** `npm run ci:local > /tmp/ci.log 2>&1; echo "EXIT=$?"` then READ the log. `cmd | tail` reports the PIPE's exit code, not the command's.
- **Angular unit tests:** `NX_DAEMON=false npx nx test pack-kids-football-ui` (full project; the `@nx/angular:unit-test` executor REJECTS spec filters / `--include` / positional args). `NX_DAEMON=false` avoids daemon-lock with the main clone's dev servers.
- **Lib build:** `npx nx build pack-kids-football-ui`. **Prod (host) build:** `npx nx build pack-football-visual-editor` (this one enforces budgets).
- **Commit per task.** Conventional commits, `kids-football:` scope.
- **Bundle format:** flat `export const KF_MESSAGES_XX: Readonly<Record<string,string>> = { 'kf.a.b': '…', … }`. Single-brace `{n}`/`{name}` placeholder tokens (NOT `{{ }}`). The de bundle (`kf-i18n.de.ts`) is the quality reference for tone + glossary.
- **Autonyms:** `kf.shell.lang.de` = "Deutsch", `.en` = "English", `.fr` = "Français", `.it` = "Italiano" — the SAME literal in ALL FOUR bundles (language names are shown in their own language).

---

## Task 1: Worktree + install + baseline

**Files:** none (setup)

- [ ] **Step 1: Create the worktree off origin/main.** From `de-braighter/`:
```bash
cd domains/exercir && git fetch origin
git worktree add ../exercir-wt-kf-i18n-frit -b feat/kids-football-i18n-fr-it origin/main
cd ../exercir-wt-kf-i18n-frit && GITHUB_TOKEN=$GITHUB_TOKEN npm ci > /tmp/frit-ci.log 2>&1; echo "EXIT=$?"
```
Expected: worktree at `domains/exercir-wt-kf-i18n-frit`, install EXIT=0. ALL subsequent steps run here.

- [ ] **Step 2: Baseline build (confirm b33de39 is green here).**
```bash
npx nx run-many -t build > /tmp/frit-baseline.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0 (the merged de+en baseline still builds).

- [ ] **Step 3: Confirm transloco is present (no install needed).**
```bash
grep '"@jsverse/transloco"' package.json && grep '"@jsverse/transloco-persist-lang"' package.json
```
Expected: both pinned (installed in exercir#266). No `npm install` in this plan.

---

## Task 2: Add the two language-autonym keys to EN + DE

> This shifts the EN source key-set from 456 → 458. fr/it (Tasks 3/4) translate the full 458. Doing this first keeps every parity run green.

**Files:** Modify `kf-i18n.en.ts`, `kf-i18n.de.ts`

- [ ] **Step 1: Add the keys to `kf-i18n.en.ts`.** Find the `'kf.shell.lang.en': 'English',` line (~line 31) and add directly after it:
```ts
  'kf.shell.lang.fr': 'Français',
  'kf.shell.lang.it': 'Italiano',
```

- [ ] **Step 2: Add the SAME two keys to `kf-i18n.de.ts`** (after `'kf.shell.lang.en': 'English',`, ~line 32) — identical autonym values:
```ts
  'kf.shell.lang.fr': 'Français',
  'kf.shell.lang.it': 'Italiano',
```

- [ ] **Step 3: Run the parity spec (de still == en).**
```bash
NX_DAEMON=false npx nx test pack-kids-football-ui > /tmp/frit-t2.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0 (de bundle still has exactly the en key-set, now 458).

- [ ] **Step 4: Commit.**
```bash
git add libs/pack-kids-football-ui/src/lib/kf-i18n.en.ts libs/pack-kids-football-ui/src/lib/kf-i18n.de.ts
git commit -m "feat(kids-football): add fr/it language-autonym keys to en+de bundles"
```

---

## Task 3: French bundle (`kf-i18n.fr.ts`)

> Dispatch the **i18n-pro** agent for the translation (it carries the four-locale parity + token-fidelity discipline). The de bundle is the quality reference.

**Files:** Create `kf-i18n.fr.ts`; Modify `kf-i18n.parity.spec.ts`

- [ ] **Step 1: Create `kf-i18n.fr.ts`** with this header + ALL 458 keys translated to natural French:
```ts
/**
 * KF_MESSAGES_FR — French (fr) Club Grass UI bundle.
 *
 * MACHINE-TRANSLATED DRAFT (charter §2 D16). de-CH (kf-i18n.de.ts) + en
 * (kf-i18n.en.ts) are the quality-authoritative locales; this draft is shipped
 * live in the switcher and is pending human-native review. Every {placeholder}
 * token is preserved verbatim (gated by kf-i18n.parity.spec.ts). Glossary:
 * Drill→Exercice, Template→Modèle, Team→Équipe, Coach→Entraîneur,
 * Attendance→Présence, Match→Match, Slot→Créneau, Session→Séance, Player→Joueur·euse.
 */
export const KF_MESSAGES_FR: Readonly<Record<string, string>> = {
  // … all 458 keys, same key strings as kf-i18n.en.ts, French values …
};
```
Translation rules (HARD):
- **Same key set as `kf-i18n.en.ts`** (all 458 keys; the parity spec deep-equals the sorted key arrays).
- **Preserve every `{…}` token** verbatim and complete per key (e.g. `'kf.slots.summary': '{n} créneaux par semaine · {h} h/semaine'` keeps both `{n}` and `{h}`).
- **Status labels** `kf.player.att.present|absent|sick|holiday|school` → `Présent·e` / `Absent·e` / `Malade` / `Vacances` / `École` (the raw-enum-leak class — these MUST be translated).
- **Developmental tone** non-deficit: `kf.player.dev.notYet` → `– Pas encore`; the practice caption → a faithful non-deficit French rendering ("un relevé des présences à l'entraînement — pas une évaluation du niveau" sense).
- **Autonyms** unchanged: `kf.shell.lang.de`='Deutsch', `.en`='English', `.fr`='Français', `.it`='Italiano'.
- Glossary terms used consistently across all keys.

- [ ] **Step 2: Add `fr` to the parity `LOCALES` map** in `kf-i18n.parity.spec.ts`:
```ts
import { KF_MESSAGES_FR } from './kf-i18n.fr.js';
// …
const LOCALES: Record<string, Record<string, string>> = {
  de: KF_MESSAGES_DE,
  fr: KF_MESSAGES_FR,
};
```

- [ ] **Step 3: Run the parity spec (fr now gated).**
```bash
NX_DAEMON=false npx nx test pack-kids-football-ui > /tmp/frit-t3.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0 — fr passes key-set, placeholder-token-set, and <15%-identical. If "key set" fails, the log lists missing/extra keys (fix them). If "differs from EN" fails, too many values were left in English (translate them).

- [ ] **Step 4: Lib build (typecheck the new file).**
```bash
npx nx build pack-kids-football-ui > /tmp/frit-t3b.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0.

- [ ] **Step 5: Commit.**
```bash
git add libs/pack-kids-football-ui/src/lib/kf-i18n.fr.ts libs/pack-kids-football-ui/src/lib/kf-i18n.parity.spec.ts
git commit -m "feat(kids-football): French (fr) draft translation bundle + parity gate"
```

---

## Task 4: Italian bundle (`kf-i18n.it.ts`)

> Same procedure as Task 3, Italian. Dispatch the **i18n-pro** agent.

**Files:** Create `kf-i18n.it.ts`; Modify `kf-i18n.parity.spec.ts`

- [ ] **Step 1: Create `kf-i18n.it.ts`** with this header + ALL 458 keys translated to natural Italian:
```ts
/**
 * KF_MESSAGES_IT — Italian (it) Club Grass UI bundle.
 *
 * MACHINE-TRANSLATED DRAFT (charter §2 D16). de-CH + en are the
 * quality-authoritative locales; this draft is shipped live in the switcher and
 * is pending human-native review. Every {placeholder} token is preserved
 * verbatim (gated by kf-i18n.parity.spec.ts). Glossary: Drill→Esercizio,
 * Template→Modello, Team→Squadra, Coach→Allenatore, Attendance→Presenza,
 * Match→Partita, Slot→Fascia oraria, Session→Sessione, Player→Giocatore·trice.
 */
export const KF_MESSAGES_IT: Readonly<Record<string, string>> = {
  // … all 458 keys, same key strings as kf-i18n.en.ts, Italian values …
};
```
Translation rules (HARD) — same as Task 3 Step 1, Italian:
- Same 458 key set; preserve every `{…}` token verbatim.
- Status labels: `kf.player.att.*` → `Presente` / `Assente` / `Malato·a` / `Vacanza` / `Scuola`.
- Developmental tone non-deficit: `kf.player.dev.notYet` → `– Non ancora`; caption faithful + non-deficit ("un registro delle presenze all'allenamento — non una valutazione del livello" sense).
- Autonyms unchanged (Deutsch / English / Français / Italiano).
- Glossary consistent across all keys.

- [ ] **Step 2: Add `it` to the parity `LOCALES` map** in `kf-i18n.parity.spec.ts`:
```ts
import { KF_MESSAGES_IT } from './kf-i18n.it.js';
// …
const LOCALES: Record<string, Record<string, string>> = {
  de: KF_MESSAGES_DE,
  fr: KF_MESSAGES_FR,
  it: KF_MESSAGES_IT,
};
```

- [ ] **Step 3: Run the parity spec (it now gated).**
```bash
NX_DAEMON=false npx nx test pack-kids-football-ui > /tmp/frit-t4.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0 — it passes all three gates.

- [ ] **Step 4: Lib build.**
```bash
npx nx build pack-kids-football-ui > /tmp/frit-t4b.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0.

- [ ] **Step 5: Commit.**
```bash
git add libs/pack-kids-football-ui/src/lib/kf-i18n.it.ts libs/pack-kids-football-ui/src/lib/kf-i18n.parity.spec.ts
git commit -m "feat(kids-football): Italian (it) draft translation bundle + parity gate"
```

---

## Task 5: Wire fr/it into the loader, providers, and shell switcher

**Files:** Modify `i18n/kf-transloco-loader.ts`, `i18n/kf-transloco.providers.ts`, `shell/kf-shell.component.ts`, `shell/kf-shell.component.spec.ts`

- [ ] **Step 1: Loader → four-way map.** Replace the body of `kf-transloco-loader.ts` imports + `getTranslation`:
```ts
import { Injectable } from '@angular/core';
import type { Translation, TranslocoLoader } from '@jsverse/transloco';
import { Observable, of } from 'rxjs';

import { KF_MESSAGES_DE } from '../kf-i18n.de.js';
import { KF_MESSAGES_EN } from '../kf-i18n.en.js';
import { KF_MESSAGES_FR } from '../kf-i18n.fr.js';
import { KF_MESSAGES_IT } from '../kf-i18n.it.js';

const KF_BUNDLES: Readonly<Record<string, Translation>> = {
  de: KF_MESSAGES_DE,
  en: KF_MESSAGES_EN,
  fr: KF_MESSAGES_FR,
  it: KF_MESSAGES_IT,
};

@Injectable({ providedIn: 'root' })
export class KfTranslocoLoader implements TranslocoLoader {
  getTranslation(lang: string): Observable<Translation> {
    return of(KF_BUNDLES[lang] ?? KF_MESSAGES_EN);
  }
}
```
(All four catalogs statically imported → eager, per Decision 2. Update the file's top doc-comment to say it serves de/en/fr/it.)

- [ ] **Step 2: Providers → availableLangs.** In `kf-transloco.providers.ts`, change:
```ts
  availableLangs: ['de', 'en', 'fr', 'it'],
```
(Leave `defaultLang: kfDefaultLang()`, `fallbackLang: 'en'`, `interpolation`, persist-lang untouched. Update the doc-comment's "the two Club Grass languages" → "the four Club Grass languages".)

- [ ] **Step 3: Shell `<select>` → four options.** In `kf-shell.component.ts`, find the lang `<select>` block and add two options after the `en` option:
```html
        <option value="de">{{ 'kf.shell.lang.de' | transloco }}</option>
        <option value="en">{{ 'kf.shell.lang.en' | transloco }}</option>
        <option value="fr">{{ 'kf.shell.lang.fr' | transloco }}</option>
        <option value="it">{{ 'kf.shell.lang.it' | transloco }}</option>
```

- [ ] **Step 4: Update the shell spec's lang-option assertions.** In `kf-shell.component.spec.ts` (the `LANG: language select renders …` test, ~line 181-190), change the two assertions:
```ts
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['de', 'en', 'fr', 'it']);
    expect(options.map((o) => o.textContent?.trim())).toEqual(['Deutsch', 'English', 'Français', 'Italiano']);
```
Rename the test title to `LANG: language select renders Deutsch + English + Français + Italiano options`. Leave the no-reload reactive-switch test (de) unchanged.

- [ ] **Step 5: Run the shell spec + full lib suite.**
```bash
NX_DAEMON=false npx nx test pack-kids-football-ui > /tmp/frit-t5.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0 (shell 4-option assertions pass; everything else green).

- [ ] **Step 6: Lib build.**
```bash
npx nx build pack-kids-football-ui > /tmp/frit-t5b.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0.

- [ ] **Step 7: Commit.**
```bash
git add libs/pack-kids-football-ui/src/lib/i18n/kf-transloco-loader.ts \
  libs/pack-kids-football-ui/src/lib/i18n/kf-transloco.providers.ts \
  libs/pack-kids-football-ui/src/lib/shell/kf-shell.component.ts \
  libs/pack-kids-football-ui/src/lib/shell/kf-shell.component.spec.ts
git commit -m "feat(kids-football): wire fr/it into loader + availableLangs + shell switcher"
```

---

## Task 6: Host budget bump + full gates

**Files:** Modify `apps/pack-football-visual-editor/project.json`

- [ ] **Step 1: Measure the prod build first.**
```bash
npx nx build pack-football-visual-editor > /tmp/frit-prod1.log 2>&1; echo "EXIT=$?"
grep -iE "initial|exceeded|budget|Error" /tmp/frit-prod1.log
```
Read the reported `Initial total` size. Two cases:
- **EXIT=0** (still under 1.1mb): no bump strictly needed, BUT the four catalogs likely sit very close to the cap — raise the budget anyway for headroom (Step 2) so a later string addition doesn't break the build.
- **EXIT≠0 with a budget ERROR**: note the reported Initial total (e.g. "1.14 MB").

- [ ] **Step 2: Bump the `initial` budget.** In `apps/pack-football-visual-editor/project.json`, find the `"type": "initial"` budget and raise `maximumError` from `"1.1mb"` to a value ~80–100 kB above the measured Initial total (e.g. measured 1.14 MB → set `"1.25mb"`). Set `maximumWarning` to ~50 kB under the new error. Add a one-line rationale comment alongside (if the file's style allows comments — project.json is JSON, so put the rationale in the PR body / spec, NOT inline):
```json
              "type": "initial",
              "maximumWarning": "1.2mb",
              "maximumError": "1.25mb"
```
(Use the actual measured number; the values above are illustrative.)

- [ ] **Step 3: Re-run the prod build (must pass).**
```bash
npx nx build pack-football-visual-editor > /tmp/frit-prod2.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0, no budget ERROR, no per-component 8kb style ERROR.

- [ ] **Step 4: Full ci:local.**
```bash
npm run ci:local > /tmp/frit-cilocal.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0. READ the log (do not trust a pipe). If it fails, fix and re-run.

- [ ] **Step 5: test:db (unchanged, confirm green).**
```bash
npm run test:db > /tmp/frit-testdb.log 2>&1; echo "EXIT=$?"
```
Expected: EXIT=0 (UI-only change; no DB shape touched).

- [ ] **Step 6: Commit.**
```bash
git add apps/pack-football-visual-editor/project.json
git commit -m "chore(kids-football): bump host initial budget for four eager i18n catalogs"
```

---

## Task 7: Browser run-through + screenshot

**Files:** none (verification; commit only if a fix is needed)

- [ ] **Step 1: Kill orphan ports + serve the worktree.** Kill any stale :3150/:4200 (PowerShell `Get-NetTCPConnection -LocalPort 3150,4200 | … Stop-Process -Force`). From the worktree, `&`-detach (redirect to logs, never pipe a long-running serve):
  - API: `PORT=3150 <the kids-football api serve cmd>` (in-memory mode auto-seeds the 2 stub clubs).
  - Host: `npx nx serve pack-football-visual-editor` (:4200).
  Wait for "bundle generation complete"/listening via a background `until`-loop grep (NOT foreground `sleep`).

- [ ] **Step 2: Drive via Playwright MCP.** Navigate to the club-picker → sign in to a stub club as a coach. Then:
  - Flip the shell language `<select>` through **all four**: de → en → fr → it. After each, confirm via `browser_snapshot` that nav/labels rendered in that language **with no navigation/reload** (same URL).
  - **Run a session** (or open the team roster + a player modal) under `fr`, then `it`, and confirm the **attendance-status chips show translated labels** (Présent·e/Malade… and Presente/Malato·a…) — NOT raw English `present`/`sick` (the leak class).
  - Reload the page on `fr` → confirm it stays French (localStorage `cg.lang`).

- [ ] **Step 3: Screenshot.** Capture the French (or Italian) UI to `de-braighter/docs/club-grass-i18n-fr-it-proof.png` via `browser_take_screenshot` (full-page).

- [ ] **Step 4: If the run-through surfaces a leak/bug** (e.g. an untranslated status, a dropped placeholder rendering as `{n}`), fix the bundle, re-run the parity spec + the relevant check, and commit: `fix(kids-football): <what> found in fr/it run-through`.

---

## After the plan (orchestrator)
1. Create the `type/story` issue (`de-braighter/exercir`) + `Closes #NN` in the PR body.
2. Open the PR FIRST (before the wave) with `Producer: orchestrator/claude-opus-4-8 [brainstorming, writing-plans, subagent-driven-development]`, `Effort: standard`, `Effect: cycle-time …±… expert`, `Effect: findings …±… expert`.
3. Verifier wave (reviewer + qa-engineer + exercir-charter-checker + i18n-pro; local-ci) read-only on the worktree (no `isolation:worktree`; forbid git-writes + main-clone access). Ask i18n-pro to check fr/it quality, placeholder fidelity, the plural pick (French-0 limitation acknowledged), the status-label coverage, and the non-deficit dev tone.
4. PUSH the branch FIRST, then post-findings (`de-braighter/exercir#NN`, full form; run from `domains/devloop`) → fix blockers/should-fixes → squash-merge → twin ritual (drain pre-merge; backfill + reviews + resolve-findings + reconcile post-merge).
5. Update the `exercir-kids-football-mvp-arc` memory (fr/it shipped; ICU still deferred; club.locale seam; standalone-app Piece B next). Keep the index entry to ONE line.

---

## Self-Review (completed)

- **Spec coverage:** §4.1 fr/it bundles → Tasks 3+4; §4.1 status labels + dev tone + glossary → Tasks 3/4 Step 1 rules; §4.2 loader 4-way map → Task 5 Step 1; §4.3 availableLangs → Task 5 Step 2; §4.4 switcher + lang keys → Task 2 (keys) + Task 5 Step 3; §4.5 parity LOCALES → Tasks 3/4 Step 2; §4.6 host budget → Task 6; §5 testing (parity, shell spec, ci:local, prod build, browser run-through, screenshot) → Tasks 3-7; §3.1 keep 2-key plurals → no ICU task (correctly absent); §3.2 all-eager → loader keeps static imports (Task 5 Step 1). All covered.
- **Placeholder scan:** the budget value in Task 6 Step 2 is explicitly "use the actual measured number" with an illustrative example — a measured fact the implementer sets, not a vague requirement. The translation content can't be inlined (912 strings) but the RULES (key-set parity, token fidelity, status labels, dev tone, glossary, autonyms) + the GATE (parity spec) are fully specified. No TBD/TODO.
- **Type/name consistency:** `KF_MESSAGES_FR`/`KF_MESSAGES_IT`, `KF_BUNDLES`, `KfTranslocoLoader`, `availableLangs`, `LOCALES`, `kf.shell.lang.fr/.it`, autonym literals (Deutsch/English/Français/Italiano) used consistently across Tasks 2–6. Key count 456→458 handled coherently (Task 2 adds the 2 keys before fr/it translate 458).
</content>
