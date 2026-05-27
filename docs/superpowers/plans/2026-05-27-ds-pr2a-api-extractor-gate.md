# PR2a — api-extractor public-API drift gate (+ css exports gate) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Install `@microsoft/api-extractor`, commit a `.api.md` public-surface snapshot for each of the 5 TS libs, add a CI `api-check` target that fails on public-API drift, and add an `exports`-resolution gate for the CSS lib — so no future PR can change a public surface without a reviewable diff.

**Architecture:** First of three sub-PRs decomposing charter PR2 (`docs/superpowers/specs/2026-05-27-design-system-vector-ideas-adoption-design.md`, item #2). PR2a delivers the *protection* (drift gate). PR2c (later) does the physical `public/internal` reshuffle — protected by this gate (the reshuffle is correct iff the `.api.md` snapshots don't drift). PR2b (later) builds the #5 generator. PR2a does NOT move any files or change any lib's `src/` layout.

**Tech Stack:** Nx (npm), `@microsoft/api-extractor` (CLI `api-extractor run`), TypeScript 5.9.2. Build outputs: the 3 tsc libs (`design-system-core`, `eyecatchers-core`, `design-system-css`) emit `dist/libs/<lib>/src/index.d.ts`; the 3 ng-packagr libs (`design-system-angular`, `design-system-angular-forms`, `eyecatchers-angular`) emit a flattened `dist/libs/<lib>/index.d.ts` (+ `de-braighter-<lib>.d.ts`).

**The 6 libs and their gate:**
- api-extractor `.api.md` snapshot: `design-system-core`, `eyecatchers-core`, `design-system-angular`, `design-system-angular-forms`, `eyecatchers-angular` (5 libs).
- `exports`-resolution gate (CSS, no TS surface to snapshot): `design-system-css`.

**Repo:** all code lands in `D:\development\projects\de-braighter\layers\design-system\` (the `de-braighter/design-system` git repo), on a new branch off `main`. This plan doc lives in the workbench.

**Environment note (build is fragile):** cross-lib imports resolve via hand-wired `node_modules/@de-braighter/*` symlinks from `scripts/setup-dev.sh`. If a build/api-extractor run reports `Cannot find module '@de-braighter/...'`, run `bash scripts/setup-dev.sh` (after the dep dists exist) and retry — do not improvise. There are TWO pre-existing untracked scratch files (`libs/design-system-angular/tsconfig.spec.json`, `libs/design-system-angular/vitest.debug.config.ts`) that must NEVER be committed — always stage with targeted `git add <path>` / `git add -u`, never `git add -A`.

---

## File Structure

Created/modified in `layers/design-system/`:

- Modify: `package.json` — add `@microsoft/api-extractor` devDep + an `api:update` convenience script; extend `ci:local`.
- Create (per TS lib, 5×): `libs/<lib>/api-extractor.json` — extractor config.
- Create (per TS lib, 5×): `libs/<lib>/etc/<lib>.api.md` — committed public-surface snapshot (api-extractor's default `apiReport` location is `<projectFolder>/etc/`).
- Modify (per TS lib, 5×): `libs/<lib>/project.json` — add an `api-check` target.
- Create: `tools/check-css-exports.mjs` — resolves every `exports` entrypoint in `design-system-css`.
- Modify: `libs/design-system-css/project.json` — add an `api-check` target running that script.

`api-extractor`'s `.api.md` review files conventionally live in `etc/`; we keep that default rather than the charter's illustrative `api/` path (functionally identical — the gate is what matters). Each lib owns its own config + snapshot so changes stay local.

---

### Task 1: Branch, install api-extractor, and SPIKE the riskiest lib (DECISION GATE)

**Files:**
- Modify: `package.json` (devDep)
- Create: `libs/design-system-angular/api-extractor.json`
- Create (generated): `libs/design-system-angular/etc/design-system-angular.api.md`

This task de-risks the whole PR. `design-system-angular` is the hardest case (ng-packagr partial-Ivy `.d.ts` with `ɵ`-prefixed Angular internals). If api-extractor can't produce a clean snapshot for it, STOP — we replan PR2a's Angular libs with the lighter export-list fallback.

- [ ] **Step 1: Branch off main**

```bash
cd /d/development/projects/de-braighter/layers/design-system
git checkout main && git pull --ff-only
git checkout -b chore/ds-pr2a-api-extractor-gate
```
Expected: on a fresh branch off the latest `main` (which now contains PR1).

- [ ] **Step 2: Install api-extractor**

```bash
npm install -D @microsoft/api-extractor
```
Expected: installs cleanly. Note the installed version: `npx api-extractor --help | head -1` (record it). api-extractor bundles its own TypeScript; if the repo's TS (5.9.2) is newer than api-extractor's bundled TS, api-extractor emits a NON-fatal warning ("you have not configured this project to use a TypeScript version supported by API Extractor" / "using a newer version") — that warning is acceptable; only a hard error is a spike failure.

- [ ] **Step 3: Ensure the lib's dist exists (api-extractor reads built .d.ts)**

```bash
npx nx build design-system-angular
ls dist/libs/design-system-angular/index.d.ts
```
Expected: `index.d.ts` exists. If build fails with `Cannot find module '@de-braighter/...'`, run `bash scripts/setup-dev.sh` and rebuild.

- [ ] **Step 4: Create the spike config `libs/design-system-angular/api-extractor.json`**

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "mainEntryPointFilePath": "<projectFolder>/../../dist/libs/design-system-angular/index.d.ts",
  "bundledPackages": [],
  "compiler": {
    "tsconfigFilePath": "<projectFolder>/tsconfig.lib.json",
    "overrideTsconfig": {
      "compilerOptions": { "skipLibCheck": true }
    }
  },
  "apiReport": {
    "enabled": true,
    "reportFolder": "<projectFolder>/etc/",
    "reportFileName": "<unscopedPackageName>.api.md"
  },
  "docModel": { "enabled": false },
  "dtsRollup": { "enabled": false },
  "tsdocMetadata": { "enabled": false },
  "messages": {
    "extractorMessageReporting": {
      "ae-missing-release-tag": { "logLevel": "none" },
      "ae-forgotten-export": { "logLevel": "warning" }
    }
  }
}
```
(`<unscopedPackageName>` resolves to `design-system-angular`, so the report is `etc/design-system-angular.api.md`. `ae-missing-release-tag` is silenced because we are not using `@public`/`@beta` release tags. `ae-forgotten-export` is a warning, not an error, so it won't fail the run.)

- [ ] **Step 5: Run api-extractor in local (generate) mode and inspect the result**

```bash
cd libs/design-system-angular && npx api-extractor run --local --verbose; cd ../..
```
Expected (SPIKE PASS): exits 0 (warnings OK), and `libs/design-system-angular/etc/design-system-angular.api.md` is created listing the lib's exported components/directives/types in readable form.

Then INSPECT the file:
```bash
sed -n '1,40p' libs/design-system-angular/etc/design-system-angular.api.md
```
Judge: does it list the real public exports (e.g. the button directive, icon component, etc.) in a sensible, diff-able form? Are Angular `ɵ`-internal symbols absent or clearly contained (not flooding the report)?

- [ ] **Step 6: DECISION GATE**

- **If the `.api.md` is clean and sensible** (real exports listed, no fatal error): SPIKE PASS. Record the exact final `api-extractor.json` that worked (any tsconfig/override adjustments you had to make) — it becomes the template for Tasks 2–3. Proceed.
- **If api-extractor errors hard, garbles the output, or floods it with `ɵ` internals** and reasonable config tweaks (adjusting `mainEntryPointFilePath` to `de-braighter-design-system-angular.d.ts`, toggling `skipLibCheck`, adding `bundledPackages`) don't fix it within ~30 minutes: STOP. Report status **BLOCKED** with the exact errors and what you tried. Do NOT force it. The controller will replan the Angular libs with an export-list-snapshot fallback (a script that emits a sorted list of `index.d.ts` export names + signatures and diffs it in CI).

- [ ] **Step 7: Commit the spike result (only if PASS)**

```bash
git add package.json package-lock.json libs/design-system-angular/api-extractor.json libs/design-system-angular/etc/design-system-angular.api.md
git status --short
git commit -m "chore(api): spike api-extractor on design-system-angular (ng-packagr)

Confirms api-extractor consumes the flattened ng-packagr .d.ts and emits a
clean public-API snapshot. Establishes the api-extractor.json template for
the remaining libs. Part of charter PR2a (#2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
Confirm `git status --short` does NOT stage the two untracked scratch files.

---

### Task 2: api-extractor config + snapshot for the 2 tsc libs

**Files (per lib: `design-system-core`, `eyecatchers-core`):**
- Create: `libs/<lib>/api-extractor.json`
- Create (generated): `libs/<lib>/etc/<lib>.api.md`

These are lower-risk (plain `tsc` `.d.ts`, entry at `src/index.d.ts`).

- [ ] **Step 1: Build both libs**

```bash
npx nx run-many -t build --projects=design-system-core,eyecatchers-core
ls dist/libs/design-system-core/src/index.d.ts dist/libs/eyecatchers-core/src/index.d.ts
```
Expected: both `index.d.ts` exist.

- [ ] **Step 2: Create `libs/design-system-core/api-extractor.json`**

Use the Task 1 spike-proven config, changing ONLY `mainEntryPointFilePath` to the tsc layout (note the `/src/` segment):

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/api-extractor/v7/api-extractor.schema.json",
  "mainEntryPointFilePath": "<projectFolder>/../../dist/libs/design-system-core/src/index.d.ts",
  "bundledPackages": [],
  "compiler": {
    "tsconfigFilePath": "<projectFolder>/tsconfig.lib.json",
    "overrideTsconfig": { "compilerOptions": { "skipLibCheck": true } }
  },
  "apiReport": {
    "enabled": true,
    "reportFolder": "<projectFolder>/etc/",
    "reportFileName": "<unscopedPackageName>.api.md"
  },
  "docModel": { "enabled": false },
  "dtsRollup": { "enabled": false },
  "tsdocMetadata": { "enabled": false },
  "messages": {
    "extractorMessageReporting": {
      "ae-missing-release-tag": { "logLevel": "none" },
      "ae-forgotten-export": { "logLevel": "warning" }
    }
  }
}
```
If the Task 1 spike required additional config keys to succeed, mirror those here too.

- [ ] **Step 3: Create `libs/eyecatchers-core/api-extractor.json`**

Identical to Step 2 but with `mainEntryPointFilePath` = `<projectFolder>/../../dist/libs/eyecatchers-core/src/index.d.ts`. (eyecatchers-core has ~92 exports — the snapshot will be large; that's expected and fine.)

- [ ] **Step 4: Generate both snapshots**

```bash
cd libs/design-system-core && npx api-extractor run --local; cd ../..
cd libs/eyecatchers-core && npx api-extractor run --local; cd ../..
```
Expected: each exits 0 and writes `etc/<lib>.api.md`. Inspect each with `sed -n '1,30p' libs/<lib>/etc/<lib>.api.md` to confirm sensible content.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-core/api-extractor.json libs/design-system-core/etc/design-system-core.api.md libs/eyecatchers-core/api-extractor.json libs/eyecatchers-core/etc/eyecatchers-core.api.md
git status --short
git commit -m "chore(api): api-extractor snapshots for the tsc libs (core, eyecatchers-core)

Part of charter PR2a (#2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: api-extractor config + snapshot for the remaining 2 ng-packagr libs

**Files (per lib: `design-system-angular-forms`, `eyecatchers-angular`):**
- Create: `libs/<lib>/api-extractor.json`
- Create (generated): `libs/<lib>/etc/<lib>.api.md`

(`design-system-angular` was already done in Task 1.)

- [ ] **Step 1: Build both libs**

```bash
npx nx run-many -t build --projects=design-system-angular-forms,eyecatchers-angular
ls dist/libs/design-system-angular-forms/index.d.ts dist/libs/eyecatchers-angular/index.d.ts
```
Expected: both `index.d.ts` exist. (If a `Cannot find module` error appears, run `bash scripts/setup-dev.sh` and rebuild.)

- [ ] **Step 2: Create `libs/design-system-angular-forms/api-extractor.json`**

Copy the Task 1 spike-proven `design-system-angular/api-extractor.json` verbatim, changing only `mainEntryPointFilePath` to `<projectFolder>/../../dist/libs/design-system-angular-forms/index.d.ts`.

- [ ] **Step 3: Create `libs/eyecatchers-angular/api-extractor.json`**

Same, with `mainEntryPointFilePath` = `<projectFolder>/../../dist/libs/eyecatchers-angular/index.d.ts`.

- [ ] **Step 4: Generate both snapshots**

```bash
cd libs/design-system-angular-forms && npx api-extractor run --local; cd ../..
cd libs/eyecatchers-angular && npx api-extractor run --local; cd ../..
```
Expected: each exits 0 and writes `etc/<lib>.api.md`. Inspect both for sensible content.

- [ ] **Step 5: Commit**

```bash
git add libs/design-system-angular-forms/api-extractor.json libs/design-system-angular-forms/etc/design-system-angular-forms.api.md libs/eyecatchers-angular/api-extractor.json libs/eyecatchers-angular/etc/eyecatchers-angular.api.md
git status --short
git commit -m "chore(api): api-extractor snapshots for angular-forms + eyecatchers-angular

Part of charter PR2a (#2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The `api-check` nx target + ci:local wiring + red-green

**Files:**
- Modify: `libs/<lib>/project.json` (5 TS libs) — add an `api-check` target.
- Modify: `package.json` — extend `ci:local`; add `api:update` helper.

api-extractor in CI mode (`api-extractor run` WITHOUT `--local`) compares the freshly-analyzed surface to the committed `.api.md` and exits non-zero on any difference. That is the drift gate.

- [ ] **Step 1: Add an `api-check` target to each of the 5 TS libs' `project.json`**

For each of `design-system-core`, `eyecatchers-core`, `design-system-angular`, `design-system-angular-forms`, `eyecatchers-angular`, add this target inside the `"targets": { ... }` object (use `nx:run-commands`, `dependsOn build` so the dist `.d.ts` exists, `cwd` set to the lib):

```json
"api-check": {
  "executor": "nx:run-commands",
  "dependsOn": ["build"],
  "options": {
    "cwd": "libs/<lib>",
    "command": "api-extractor run --verbose"
  }
}
```
(Replace `<lib>` with the actual lib folder name in each file. `api-extractor run` without `--local` is verify mode: it fails if the committed `etc/<lib>.api.md` is stale.)

- [ ] **Step 2: Verify the gate passes on the committed baselines**

```bash
npx nx run-many -t api-check --projects=design-system-core,eyecatchers-core,design-system-angular,design-system-angular-forms,eyecatchers-angular
```
Expected: all 5 PASS (committed snapshots match the freshly-built surface).

- [ ] **Step 3: RED — prove the gate catches a public-surface change**

Add a throwaway public export to a tsc lib. Append to `libs/design-system-core/src/index.ts`:
```ts
export const __API_GATE_PROBE__ = true;
```
Then:
```bash
npx nx build design-system-core && npx nx api-check design-system-core
```
Expected: `api-check` FAILS, reporting that `etc/design-system-core.api.md` is out of date (the new export is not in the committed snapshot).

- [ ] **Step 4: GREEN — revert the probe**

```bash
cd /d/development/projects/de-braighter/layers/design-system
git checkout -- libs/design-system-core/src/index.ts
npx nx build design-system-core && npx nx api-check design-system-core
```
Expected: PASS again. Confirm the probe line is gone (`grep __API_GATE_PROBE__ libs/design-system-core/src/index.ts` → no output).

- [ ] **Step 5: Wire `api-check` into `ci:local` + add an `api:update` helper**

In `package.json`, the current scripts are:
```json
    "ci:local": "nx run-many -t build lint typecheck && nx run-many -t vite:test --parallel=1",
```
Change `ci:local` to also run `api-check`:
```json
    "ci:local": "nx run-many -t build lint typecheck api-check && nx run-many -t vite:test --parallel=1",
```
And add (anywhere in `scripts`) a convenience updater for regenerating snapshots after an intentional API change:
```json
    "api:update": "nx run-many -t build && for d in design-system-core eyecatchers-core design-system-angular design-system-angular-forms eyecatchers-angular; do (cd libs/$d && api-extractor run --local); done",
```
(Note: `api:update` is a bash-style loop; it runs under the repo's bash-based npm scripts. If the repo's npm runs scripts via cmd on Windows CI, document that `api:update` is dev-only and meant to be run from Git-bash.)

- [ ] **Step 6: Commit**

```bash
git add libs/design-system-core/project.json libs/eyecatchers-core/project.json libs/design-system-angular/project.json libs/design-system-angular-forms/project.json libs/eyecatchers-angular/project.json package.json
git status --short
git commit -m "chore(api): add api-check drift gate to ci:local

api-extractor verify mode per lib (dependsOn build); fails on public-surface
drift. Adds api:update helper for regenerating snapshots after intentional
API changes. Part of charter PR2a (#2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: CSS exports-resolution gate

**Files:**
- Create: `tools/check-css-exports.mjs`
- Modify: `libs/design-system-css/project.json` — add an `api-check` target running the script.

`design-system-css` has no meaningful TS surface (2 constants), so its "public API" is its `package.json` `exports` map (the CSS asset entrypoints). The gate confirms every declared entrypoint resolves to a real file in the built dist.

- [ ] **Step 1: Inspect the css `exports` map to know what to resolve**

```bash
cat libs/design-system-css/package.json
```
Note the `exports` keys (e.g. `.`, `./tokens.css`, `./skins/*.css`, `./components/*.css`) and their target paths.

- [ ] **Step 2: Write `tools/check-css-exports.mjs`**

```js
// Verifies every entrypoint declared in design-system-css's package.json `exports`
// resolves to a real file in the built dist. Fails (exit 1) on any missing target.
// Run after `nx build design-system-css`.
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(repoRoot, 'dist/libs/design-system-css');
const pkg = JSON.parse(readFileSync(join(distDir, 'package.json'), 'utf8'));

const exportsMap = pkg.exports ?? {};
const targets = [];
for (const [key, value] of Object.entries(exportsMap)) {
  // value may be a string or an object ({ import, default, types, ... })
  const candidates = typeof value === 'string' ? [value] : Object.values(value);
  for (const rel of candidates) {
    if (typeof rel !== 'string') continue;
    // Skip glob patterns (e.g. "./skins/*.css") — resolve the directory instead.
    if (rel.includes('*')) {
      const dir = join(distDir, dirname(rel));
      if (!existsSync(dir)) targets.push({ key, rel, resolved: dir, ok: false });
      else targets.push({ key, rel, resolved: dir, ok: true });
      continue;
    }
    const resolved = join(distDir, rel);
    targets.push({ key, rel, resolved, ok: existsSync(resolved) });
  }
}

const missing = targets.filter((t) => !t.ok);
for (const t of targets) {
  console.log(`${t.ok ? 'OK ' : 'MISSING'}  ${t.key} -> ${t.rel}`);
}
if (missing.length > 0) {
  console.error(`\ncheck-css-exports: ${missing.length} unresolved exports entrypoint(s).`);
  process.exit(1);
}
console.log(`\ncheck-css-exports: all ${targets.length} entrypoints resolve.`);
```

- [ ] **Step 3: Build css and run the script manually**

```bash
npx nx build design-system-css
node tools/check-css-exports.mjs
```
Expected: prints `OK` for each entrypoint and exits 0 with "all N entrypoints resolve." If the script reports MISSING for a glob `dist` path that genuinely exists under a different layout, adjust the resolution logic to match the real dist structure observed in Step 1 (do NOT weaken the check to always-pass).

- [ ] **Step 4: Add the `api-check` target to `libs/design-system-css/project.json`**

Inside its `"targets"`:
```json
"api-check": {
  "executor": "nx:run-commands",
  "dependsOn": ["build"],
  "options": {
    "command": "node tools/check-css-exports.mjs"
  }
}
```
(No `cwd` — the script resolves paths from the repo root via its own `import.meta.url`.)

- [ ] **Step 5: Verify all 6 libs' api-check pass together**

```bash
npx nx run-many -t api-check
```
Expected: all 6 projects (5 api-extractor + css script) PASS.

- [ ] **Step 6: Commit**

```bash
git add tools/check-css-exports.mjs libs/design-system-css/project.json
git status --short
git commit -m "chore(api): css exports-resolution gate (design-system-css api-check)

design-system-css has no TS surface; its public API is the exports map.
Verifies every declared entrypoint resolves to a real built file.
Part of charter PR2a (#2).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Full gate + PR

**Files:** none (verification + git).

- [ ] **Step 1: Run the full local CI gate (now includes api-check)**

```bash
npm run ci:local
echo "EXIT: $?"
```
Expected: EXIT 0 — build + lint + typecheck + **api-check** (6 libs) + vite:test all green.

- [ ] **Step 2: Push**

```bash
git push -u origin chore/ds-pr2a-api-extractor-gate
```

- [ ] **Step 3: Create the story issue + PR**

```bash
gh issue create --title "PR2a: api-extractor public-API drift gate + css exports gate" --body "Story for PR2a of the vector-ideas adoption charter (#2). Installs api-extractor, commits .api.md snapshots for the 5 TS libs, adds a CI api-check drift gate, and an exports-resolution gate for design-system-css. No file moves (the physical public/internal split is PR2c). This repo has no type/story label taxonomy, so filed unlabeled."
```
Record the issue number (call it `NN`), then:
```bash
gh pr create --base main --title "chore: api-extractor public-API drift gate (charter PR2a)" --body "PR2a of the vector-ideas adoption charter (#2).

Closes #NN

## What
- Install \`@microsoft/api-extractor\`.
- Commit \`etc/<lib>.api.md\` public-surface snapshots for the 5 TS libs.
- Add a CI \`api-check\` target (api-extractor verify mode, dependsOn build) wired into \`ci:local\`; fails on public-API drift.
- Add an \`exports\`-resolution gate for \`design-system-css\` (no TS surface).
- Add an \`api:update\` helper for regenerating snapshots after intentional API changes.

## Not in this PR
- The physical \`public/internal\` reshuffle (PR2c) and the nx generator (PR2b).

## Verification
- \`npm run ci:local\` exits 0 (build + lint + typecheck + api-check + vite:test).
- Drift gate red-green confirmed (a probe export fails api-check; revert restores green).

Remote GitHub Actions is billing-blocked; gate is local ci:local + charter-checker.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: charter-checker pass** — per the controller's choice, run the charter-checker agent against `main...chore/ds-pr2a-api-extractor-gate`, pointed at the adoption charter, to confirm PR2a stays in scope (gate only; no file moves, no generator).

---

## Self-Review

**Spec coverage (against charter #2 + the PR2a decision):**
- api-extractor installed → Task 1 Step 2. ✓
- `.api.md` snapshots for the 5 TS libs → Tasks 1 (angular), 2 (core, eyecatchers-core), 3 (angular-forms, eyecatchers-angular). ✓
- CI `api-check` drift gate, wired into `ci:local` → Task 4. ✓
- css `exports`-resolution gate → Task 5. ✓
- "no file moves in PR2a" (split deferred to PR2c) → no task moves files. ✓
- Spike-first to de-risk api-extractor-on-Angular → Task 1 with explicit BLOCKED gate + fallback. ✓
- "baseline captured from current built `.d.ts`" (charter) → all snapshots generated from `dist/.../*.d.ts`. ✓

**Placeholder scan:** Config files, the css script, and commit messages are shown in full. The only deliberate deferral is "use the Task 1 spike-proven config" in Tasks 2–3 — that references concrete output of Task 1, not a placeholder. No TBD/TODO.

**Type/name consistency:** Branch `chore/ds-pr2a-api-extractor-gate` consistent across Tasks 1 and 6. Report path `etc/<lib>.api.md` consistent across all tasks. Target name `api-check` consistent (Tasks 4, 5, ci:local). The 5 TS libs vs the css lib split is consistent throughout.

**Risk:** Task 1 is the live unknown. If it returns BLOCKED, the controller replans the 3 Angular libs with an export-list-snapshot fallback while keeping Tasks 2 (tsc libs), 4 (gate wiring), and 5 (css) intact. The two tsc libs are very low risk.
