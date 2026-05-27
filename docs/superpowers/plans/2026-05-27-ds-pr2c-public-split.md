# PR2c — `src/lib` → `src/public` rename + deep-import ESLint guard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename each TS lib's `src/lib/` directory to `src/public/`, repoint its `src/index.ts` barrel, and add an ESLint guard banning deep imports into a sibling lib's internals — establishing the public-surface convention (uniform with the future PR2b generator) while the PR2a `.api.md` gate proves the move changes no public API.

**Architecture:** Third sub-PR of charter PR2 (`docs/superpowers/specs/2026-05-27-design-system-vector-ideas-adoption-design.md`, #2). Grounding confirmed all libs are 100% public — there is no internal-only code — so PR2c is a mechanical `lib/ → public/` rename + a deep-import guard. **No `internal/` directories are created** (demand-driven: the PR2b generator scaffolds `internal/` for new libs; existing libs add it only when a real internal first appears). The `.api.md` snapshots from PR2a MUST stay byte-identical after each move — that is the proof the public surface is unchanged.

**Tech Stack:** Nx (npm), ng-packagr (3 libs) + `@nx/js:tsc` (2 libs), `@microsoft/api-extractor` verify-mode gate (`nx api-check`), `@nx/eslint-plugin` flat config.

**Scope — 5 TS libs** (move `src/lib` → `src/public`): `design-system-core`, `eyecatchers-core`, `design-system-angular`, `design-system-angular-forms`, `eyecatchers-angular`. **`design-system-css` is excluded** — it has no `src/lib` (CSS assets only).

**Why it's surface-neutral (verified during planning):**
- `src/index.ts` stays at `src/index.ts`; only its re-export paths change (`./lib/` → `./public/`).
- ng-packagr `entryFile` is `src/index.ts`; `tsconfig.lib.json` includes `src/**/*.ts`; **no config references `src/lib`**. So only `index.ts` needs editing.
- Intra-lib sibling imports are relative (`../number-flow/...`) and move together under `public/`, so they stay valid with NO rewrite (confirmed incl. eyecatchers-angular's 6 sibling composition imports).
- api-extractor `mainEntryPointFilePath` resolves from the dist entry (`.../src/index.d.ts` for tsc, `.../index.d.ts` for ng-packagr) — unchanged by the move. So `etc/<lib>.api.md` must regenerate byte-identical; `api-check` enforces it.

**Repo:** `D:\development\projects\de-braighter\layers\design-system\` on a new branch off `main`. **Environment note:** dev symlinks (`node_modules/@de-braighter/*`) are fragile; if any build reports `Cannot find module '@de-braighter/...'`, STOP and report (controller runs `scripts/setup-dev.sh` + rebuilds) — do not improvise. Two pre-existing untracked scratch files (`libs/design-system-angular/tsconfig.spec.json`, `vitest.debug.config.ts`) must NEVER be committed — use targeted `git add`, never `git add -A`.

---

## File Structure

Per the 5 TS libs:
- Move: `libs/<lib>/src/lib/` → `libs/<lib>/src/public/` (whole subtree, via `git mv`).
- Modify: `libs/<lib>/src/index.ts` — re-export paths `./lib/` → `./public/`.
- Unchanged: `api-extractor.json`, `etc/<lib>.api.md` (must stay byte-identical), `ng-package.json`, `tsconfig*.json`, `project.json`.

Repo-level:
- Modify: `eslint.config.mjs` — add a `no-restricted-imports` deep-import guard.

---

### Task 1: Branch + green baseline

- [ ] **Step 1: Branch off main**
```bash
cd /d/development/projects/de-braighter/layers/design-system
git checkout main && git pull --ff-only
git checkout -b chore/ds-pr2c-public-split
```

- [ ] **Step 2: Establish the green baseline (build + api-check + lint all pass BEFORE the move)**
```bash
npx nx run-many -t build
npx nx run-many -t api-check
npx nx run-many -t lint
```
Expected: all green (api-check passes for 6 libs; lint 0 errors). If a build errors `Cannot find module '@de-braighter/...'`, STOP and report (controller fixes symlinks). This baseline is what every later `api-check` must continue to satisfy.

---

### Task 2: Rename `src/lib` → `src/public` in the 5 TS libs (one commit per lib)

**Files (per lib):** move `libs/<lib>/src/lib` → `libs/<lib>/src/public`; edit `libs/<lib>/src/index.ts`.

The operation is identical for every lib. Do the 5 libs **in this order** (smallest/simplest first to surface any surprise early): `design-system-core`, `design-system-angular`, `design-system-angular-forms`, `eyecatchers-core`, `eyecatchers-angular`. For EACH lib, run this exact sub-procedure, then commit before moving to the next.

**Per-lib sub-procedure** (example shown for `design-system-core`; substitute the lib name for the others):

- [ ] **Step A: Move the directory**
```bash
git mv libs/design-system-core/src/lib libs/design-system-core/src/public
```

- [ ] **Step B: Repoint the barrel.** In `libs/design-system-core/src/index.ts`, replace every occurrence of `./lib/` with `./public/`. (These are the re-export specifiers, e.g. `export * from './lib/tokens/motion.js';` becomes `export * from './public/tokens/motion.js';`. The `.js` extensions stay. Also catch any bare `'./lib'` / `"./lib"` without a trailing slash, replacing with `./public`.) Use a precise find-replace; do not touch anything else in the file.

- [ ] **Step C: Verify no stale `./lib` references remain in this lib's source**
```bash
grep -rn "\./lib\b\|\.\./lib\b\|src/lib\b" libs/design-system-core/src
```
Expected: NO output. (Intra-lib sibling imports use `../<sibling>` and are unaffected; only `index.ts` referenced `./lib`.) If anything prints, it is a missed reference inside `index.ts` or a nested barrel — fix it to `./public` / `../public` as appropriate.

- [ ] **Step D: Rebuild the lib**
```bash
npx nx build design-system-core
```
Expected: builds clean. (`nx reset` is NOT needed; the move is within `src/`.)

- [ ] **Step E: GATE — api-check must stay green (proves surface unchanged)**
```bash
npx nx api-check design-system-core
```
Expected: PASS. This is the safety net: if the rename accidentally changed the public surface, `etc/design-system-core.api.md` would drift and this FAILS. **If it fails, STOP for this lib, inspect the reported diff, and fix the move — do NOT regenerate the snapshot to make it pass** (regenerating would mask a real surface change).

- [ ] **Step F: Commit this lib** (targeted staging; `git mv` already staged the move, stage the index.ts edit too)
```bash
git add libs/design-system-core/src/index.ts
git status --short
git commit -m "refactor(core): rename src/lib -> src/public (design-system-core)

Mechanical move; barrel repointed. Public surface unchanged (api-check green,
etc/design-system-core.api.md byte-identical). Part of charter PR2c (#2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
Confirm `git status --short` shows only this lib's moved files + its `index.ts` staged, and the two scratch files remain untracked (not staged).

- [ ] **Step G: Repeat A–F for the remaining libs**, in order, substituting the lib name and tailoring the commit `scope`/message:
  - `design-system-angular` — commit scope `angular`.
  - `design-system-angular-forms` — commit scope `forms`. (Note: it has a `src/lib/cva-wiring.spec.ts` that imports `from '../index'`; that path is unaffected by the move — verify with Step C.)
  - `eyecatchers-core` — commit scope `eyecatchers-core` (~92 files move; large diff, same mechanical op).
  - `eyecatchers-angular` — commit scope `eyecatchers-angular` (~72 files; the 6 sibling composition imports `../number-flow/...` and `../segmented-control/...` move together and stay valid — confirm Step C is clean and Step E passes).

- [ ] **Step H: Whole-workspace re-verify after all 5 moves**
```bash
npx nx run-many -t build
npx nx run-many -t api-check
```
Expected: all 6 libs build + api-check green (css api-check unaffected; 5 renamed libs surface-identical).

---

### Task 3: Deep-import ESLint guard + red-green

**Files:** `eslint.config.mjs`.

Bans importing a sibling lib's internals by deep path (the published packages now expose `public/` files, so a consumer *could* deep-import them — this forbids it; consumers must use the package barrel `@de-braighter/<lib>`).

- [ ] **Step 1: Add the guard to `eslint.config.mjs`.** In the existing rules block (the one that already defines `@nx/enforce-module-boundaries`, for files `**/*.ts` etc.), add a `no-restricted-imports` rule alongside it:
```js
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@de-braighter/*/src/*',
                '@de-braighter/*/public/*',
                '@de-braighter/*/internal/*',
              ],
              message:
                'Import from the package barrel (@de-braighter/<lib>), not its internals. Deep paths into src/public/internal are not part of the public API.',
            },
          ],
        },
      ],
```
(Cross-lib *relative* climbing is already caught by `@nx/enforce-module-boundaries`; this rule adds the package-deep-path ban.)

- [ ] **Step 2: RED — prove the guard fires.** Create a temporary probe `libs/design-system-angular/src/__guard_probe__.ts`:
```ts
// TEMPORARY guard probe — deleted in Step 4. Do not commit.
import '@de-braighter/design-system-core/public/tokens/motion.js';
```
Then:
```bash
npx nx lint design-system-angular
```
Expected: FAIL with the `no-restricted-imports` message about importing internals (matches the `@de-braighter/*/public/*` pattern). Capture the failure line.

- [ ] **Step 3: Confirm legitimate barrel imports still pass.** Verify the rule does NOT flag normal barrel usage: `grep -rn "from '@de-braighter/design-system-core'" libs/design-system-angular/src | head` — these bare-barrel imports must remain allowed (they don't match the deep-path patterns).

- [ ] **Step 4: GREEN — remove the probe**
```bash
rm libs/design-system-angular/src/__guard_probe__.ts
npx nx lint design-system-angular
```
Expected: PASS. Confirm probe gone: `git status --short libs/design-system-angular/src` shows nothing.

- [ ] **Step 5: Full lint (no false positives across the workspace)**
```bash
npx nx run-many -t lint
```
Expected: PASS, 0 errors (pre-existing warnings unchanged). If the new rule flags any EXISTING import, that import was a deep-path violation — report it; it likely needs rerouting through the barrel (do not weaken the rule).

- [ ] **Step 6: Commit**
```bash
git add eslint.config.mjs
git status --short
git commit -m "chore(lint): ban deep imports into sibling lib internals

no-restricted-imports forbids @de-braighter/*/src|public|internal/* deep paths;
consumers must use the package barrel. Complements @nx/enforce-module-boundaries
(which already bans relative cross-lib climbing). Part of charter PR2c (#2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Full gate + PR

- [ ] **Step 1: Full local CI gate**
```bash
npm run ci:local
echo "EXIT: $?"
```
Expected: EXIT 0 — build + lint + typecheck + api-check (6 libs, all surface-identical) + vite:test all green.

- [ ] **Step 2: Push**
```bash
git push -u origin chore/ds-pr2c-public-split
```

- [ ] **Step 3: Story issue + PR**
```bash
gh issue create --title "PR2c: rename src/lib -> src/public + deep-import guard" --body "Story for PR2c of the vector-ideas adoption charter (#2). Mechanical src/lib -> src/public rename across the 5 TS libs (all 100% public; no internal/ created) + a no-restricted-imports deep-import guard. Public surface unchanged — proven by the PR2a api-check gate staying green (etc/*.api.md byte-identical). This repo has no type/story label taxonomy, so filed unlabeled."
```
Record the issue number `NN`, then:
```bash
gh pr create --base main --title "refactor: rename src/lib -> src/public + deep-import guard (charter PR2c)" --body "PR2c of the vector-ideas adoption charter (#2).

Closes #NN

## What
- Rename \`src/lib/\` -> \`src/public/\` in the 5 TS libs (core, eyecatchers-core, angular, angular-forms, eyecatchers-angular); barrels repointed. design-system-css excluded (no src/lib).
- Add a \`no-restricted-imports\` ESLint guard banning deep imports into a sibling lib's \`src|public|internal/*\` (consumers must use the package barrel).

## Surface-neutral by construction
All libs were 100% public (grounding found zero internal-only code), so this is a mechanical rename — NOT a public-API change. Proven: every lib's \`api-check\` (PR2a's gate) stays green, i.e. \`etc/<lib>.api.md\` regenerates byte-identical. No \`internal/\` dirs created (demand-driven; the PR2b generator will scaffold them for new libs).

## Verification
- \`npm run ci:local\` exits 0 (build + lint + typecheck + api-check + vite:test).
- Deep-import guard red-green confirmed.

Remote GitHub Actions is billing-blocked; gate is local ci:local + charter-checker.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: charter-checker** — run the charter-checker agent against `main...chore/ds-pr2c-public-split`, pointed at the adoption charter, to confirm PR2c scope (rename + guard only; NO internal/ dirs created, NO api-extractor/snapshot changes, NO generator, public surface unchanged).

---

## Self-Review

**Spec coverage (charter #2 + the PR2c decision "rename to public/ + guard, no empty internal/"):**
- `src/lib` → `src/public` for the 5 TS libs → Task 2. ✓
- Barrel repointed, surface unchanged (api-check green) → Task 2 Steps B, E, H. ✓
- NO `internal/` dirs created → no task creates them. ✓
- Deep-import ESLint guard + red-green → Task 3. ✓
- css excluded → stated in scope; Task 2 omits it. ✓
- `.api.md` snapshots byte-identical → enforced by the per-lib api-check gate (Step E). ✓

**Placeholder scan:** The per-lib procedure is shown in full for `design-system-core` and explicitly "repeat A–F" for the others — this is a genuinely uniform mechanical operation (identical `git mv` + `./lib/`→`./public/` edit), not a placeholder. Commit messages, the ESLint rule, and the probe are shown in full. No TBD/TODO.

**Type/name consistency:** Branch `chore/ds-pr2c-public-split` consistent (Tasks 1, 4). The 5 TS libs vs css exclusion consistent throughout. `api-check` (the PR2a gate) is the surface-neutrality proof in every move.

**Risk:** Low surface risk (api-check gate catches any accidental change per lib). Main risk is mechanical (a missed `./lib` reference) — caught by Step C grep + Step D build + Step E api-check. The eyecatchers-angular 72-file / eyecatchers-core 92-file moves are large diffs but single `git mv` operations. If a lib's api-check drifts unexpectedly, STOP and inspect rather than regenerate.
