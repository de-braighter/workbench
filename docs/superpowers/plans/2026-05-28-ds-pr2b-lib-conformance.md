# PR2b — lib-conformance CI gate + "adding a lib" doc — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `check-lib-conformance` script (wired into `ci:local`) that fails if any lib drifts from the conforming shape — correct tags, `src/public` + barrel, `api-extractor.json` + committed `.api.md`, `api-check` target, tsconfig path alias — plus a short "how to add a lib" doc. This delivers charter #5's *end* (libs conform; no divergent hand-created libs) via continuous enforcement rather than a code generator.

**Architecture:** Final sub-PR of charter PR2 (`docs/superpowers/specs/2026-05-27-design-system-vector-ideas-adoption-design.md`, #5). **Reinterprets #5's means:** the charter proposed an nx generator (`nx g ds:lib`); grounding showed new libs are rare and there are two build flavors (tsc-agnostic + ng-packagr-Angular), so a continuous *conformance check* — which catches drift across ALL libs, not just at creation — is the higher-value, lower-maintenance, more demand-driven enforcement. No code generator is built. (Builds on PR2a's api-extractor gate + PR2c's `public/` split, both merged to `main`.)

**Tech Stack:** Node ESM script (no deps), Nx 22.7 (npm), JSON/JSONC config parsing.

**The conforming shape a lib must satisfy** (post-PR2a/PR2c reality):
- `project.json` carries exactly one `scope:` (design-system|eyecatchers), one `type:` (core|ui|css), one `platform:` (agnostic|web-angular) tag, and an `api-check` target.
- `tsconfig.base.json` maps `@de-braighter/<lib>` → `libs/<lib>/src/index.ts`.
- `src/index.ts` exists and references `./public/` (NOT `./lib/`).
- **TS libs** (type != css): `src/public/` dir exists, `api-extractor.json` exists, `etc/<lib>.api.md` snapshot exists, barrel imports from `./public/`.
- **CSS lib** (type:css = design-system-css): exempt from public/api-extractor; its `api-check` target runs `check-css-exports`.

**Repo:** `D:\development\projects\de-braighter\layers\design-system\` on a branch off `main`. **Env:** symlinks fragile — if a build errors `Cannot find module '@de-braighter/...'`, STOP + report (controller fixes); the conformance script itself needs NO build (reads source/config). Two untracked scratch files (`libs/design-system-angular/tsconfig.spec.json`, `vitest.debug.config.ts`) must NEVER be committed — targeted `git add` only.

---

## File Structure
- Create: `tools/check-lib-conformance.mjs` — the check (reads `libs/*` + `tsconfig.base.json`; exit 1 on any violation).
- Modify: `package.json` — add `lib:conformance` script + insert it into `ci:local`.
- Create: `docs/adding-a-lib.md` — the conforming-shape checklist + copy-from-existing-lib guidance.

---

### Task 1: Write `check-lib-conformance.mjs` + verify all libs pass + red-green

**Files:** create `tools/check-lib-conformance.mjs`.

- [ ] **Step 1: Branch**
```bash
cd /d/development/projects/de-braighter/layers/design-system
git checkout main && git pull --ff-only
git checkout -b chore/ds-pr2b-lib-conformance
```

- [ ] **Step 2: Write `tools/check-lib-conformance.mjs`** with exactly this content:
```js
// Verifies every lib under libs/ matches the conforming shape established by
// charter PR2a (api-extractor gate) + PR2c (src/public split). Exit 1 on any
// violation. Reads source/config only — no build required.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Tolerant JSONC parse (configs may carry // comments and trailing commas).
function parseJsonc(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/(^|[^:"'])\/\/.*$/gm, '$1');
  const noTrailingCommas = noLine.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(noTrailingCommas);
}

const SCOPE_TAGS = ['scope:design-system', 'scope:eyecatchers'];
const TYPE_TAGS = ['type:core', 'type:ui', 'type:css'];
const PLATFORM_TAGS = ['platform:agnostic', 'platform:web-angular'];

const tsbase = parseJsonc(readFileSync(join(repoRoot, 'tsconfig.base.json'), 'utf8'));
const paths = tsbase.compilerOptions?.paths ?? {};

const libsDir = join(repoRoot, 'libs');
const libs = readdirSync(libsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(libsDir, d.name, 'package.json')))
  .map((d) => d.name);

const errors = [];
const ok = (cond, lib, msg) => { if (!cond) errors.push(`[${lib}] ${msg}`); };

for (const lib of libs) {
  const libDir = join(libsDir, lib);
  const pkg = parseJsonc(readFileSync(join(libDir, 'package.json'), 'utf8'));
  if (!String(pkg.name || '').startsWith('@de-braighter/')) continue; // not a published lib

  const projPath = join(libDir, 'project.json');
  if (!existsSync(projPath)) { ok(false, lib, 'missing project.json'); continue; }
  const proj = parseJsonc(readFileSync(projPath, 'utf8'));
  const tags = Array.isArray(proj.tags) ? proj.tags : [];

  ok(tags.filter((t) => SCOPE_TAGS.includes(t)).length === 1, lib,
    `must have exactly one scope: tag from {${SCOPE_TAGS.join(', ')}} (got ${JSON.stringify(tags.filter((t) => t.startsWith('scope:')))})`);
  ok(tags.filter((t) => TYPE_TAGS.includes(t)).length === 1, lib,
    `must have exactly one type: tag from {${TYPE_TAGS.join(', ')}} (got ${JSON.stringify(tags.filter((t) => t.startsWith('type:')))})`);
  ok(tags.filter((t) => PLATFORM_TAGS.includes(t)).length === 1, lib,
    `must have exactly one platform: tag from {${PLATFORM_TAGS.join(', ')}} (got ${JSON.stringify(tags.filter((t) => t.startsWith('platform:')))})`);

  ok(!!proj.targets?.['api-check'], lib, 'missing "api-check" target in project.json');

  const aliasKey = pkg.name;
  ok(!!paths[aliasKey], lib, `missing tsconfig.base.json path alias for "${aliasKey}"`);
  if (paths[aliasKey]) {
    ok(paths[aliasKey][0] === `libs/${lib}/src/index.ts`, lib,
      `path alias should map to "libs/${lib}/src/index.ts" (got ${JSON.stringify(paths[aliasKey])})`);
  }

  const indexPath = join(libDir, 'src', 'index.ts');
  ok(existsSync(indexPath), lib, 'missing src/index.ts');
  const idx = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  ok(!/['"]\.\/lib(\/|['"])/.test(idx), lib, 'src/index.ts still references "./lib" (should be "./public")');

  if (tags.includes('type:css')) {
    const apiCheckCmd = JSON.stringify(proj.targets?.['api-check']?.options ?? {});
    ok(/check-css-exports/.test(apiCheckCmd), lib, 'css lib "api-check" should run check-css-exports');
  } else {
    ok(existsSync(join(libDir, 'src', 'public')), lib, 'missing src/public/ directory');
    ok(existsSync(join(libDir, 'api-extractor.json')), lib, 'missing api-extractor.json');
    ok(existsSync(join(libDir, 'etc', `${lib}.api.md`)), lib, `missing etc/${lib}.api.md snapshot`);
    ok(/['"]\.\/public\//.test(idx), lib, 'src/index.ts should barrel from "./public/"');
  }
}

if (errors.length) {
  console.error(`Lib conformance FAILED (${errors.length}):\n` + errors.map((e) => '  - ' + e).join('\n'));
  process.exit(1);
}
console.log(`Lib conformance: all ${libs.length} libs conform.`);
```

- [ ] **Step 3: Run it — all current libs must pass**
```bash
node tools/check-lib-conformance.mjs
```
Expected: `Lib conformance: all 6 libs conform.` exit 0. (The 6 libs: design-system-core, design-system-css, design-system-angular, design-system-angular-forms, eyecatchers-core, eyecatchers-angular.) If it reports a violation for a lib that is actually fine, the script's expectation doesn't match the real structure — FIX THE SCRIPT to match reality (e.g. adjust an allowed tag value or path shape), but NEVER weaken a check so a genuinely non-conforming lib would pass. Report any script adjustment you make and why.

- [ ] **Step 4: RED — prove it catches a tag violation.** Temporarily remove the `type:` tag from one lib. In `libs/design-system-core/project.json`, change its `"tags"` array to drop `"type:core"` (keep the others). Then:
```bash
node tools/check-lib-conformance.mjs; echo "exit: $?"
```
Expected: FAILS (exit 1) with `[design-system-core] must have exactly one type: tag ...`. Capture the line.

- [ ] **Step 5: RED #2 — prove it catches a stray ./lib reference.** Restore the tag (`git checkout -- libs/design-system-core/project.json`), then temporarily edit `libs/design-system-core/src/index.ts` to add a line `export * from './lib/bogus.js';` and run the check again — expect FAIL with the `./lib` message. Then revert: `git checkout -- libs/design-system-core/src/index.ts`.

- [ ] **Step 6: GREEN — confirm clean again**
```bash
git checkout -- libs/design-system-core/project.json libs/design-system-core/src/index.ts
node tools/check-lib-conformance.mjs
```
Expected: all 6 conform, exit 0. Confirm no stray edits remain: `git status --short` shows only the new `tools/check-lib-conformance.mjs` (untracked) + the 2 scratch files.

- [ ] **Step 7: Commit**
```bash
git add tools/check-lib-conformance.mjs
git status --short
git commit -m "chore(conformance): add check-lib-conformance script

Validates every lib matches the conforming shape (tags, src/public + barrel,
api-extractor.json + etc/*.api.md, api-check target, tsconfig path alias);
css lib checked for its check-css-exports gate. Exit 1 on drift. Delivers
charter #5's end (libs conform) via continuous check, not a generator.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Wire into `ci:local` + the "adding a lib" doc

**Files:** modify `package.json`; create `docs/adding-a-lib.md`.

- [ ] **Step 1: Add a `lib:conformance` script + insert into `ci:local`.** In `package.json` `scripts`, the current `ci:local` is:
```json
    "ci:local": "nx run-many -t build lint typecheck api-check && nx run-many -t vite:test --parallel=1",
```
Add a new script and insert the conformance check before the test phase:
```json
    "lib:conformance": "node tools/check-lib-conformance.mjs",
    "ci:local": "nx run-many -t build lint typecheck api-check && npm run lib:conformance && nx run-many -t vite:test --parallel=1",
```

- [ ] **Step 2: Verify the wired gate runs**
```bash
npm run lib:conformance
```
Expected: `Lib conformance: all 6 libs conform.` exit 0.

- [ ] **Step 3: Write `docs/adding-a-lib.md`** with this content:
```markdown
# Adding a new lib

New libs must match the conforming shape enforced by `npm run lib:conformance`
(part of `ci:local`). Don't hand-roll a divergent lib — copy the closest existing
one and adjust.

## Shape (what the conformance check enforces)

- **Tags** (`project.json` `tags`): exactly one of each axis —
  - `scope:` — `design-system` | `eyecatchers`
  - `type:` — `core` | `ui` | `css`
  - `platform:` — `agnostic` | `web-angular`
- **`api-check` target** in `project.json` (api-extractor verify mode for TS libs; `check-css-exports` for the css lib).
- **tsconfig path alias** in `tsconfig.base.json`: `@de-braighter/<lib>` → `libs/<lib>/src/index.ts`.
- **`src/index.ts`** barrels from `./public/` (never `./lib/`).
- **TS libs**: `src/public/` (public API), `src/internal/` only if/when you have lib-private code, `api-extractor.json`, committed `etc/<lib>.api.md`.
- **css lib**: no `public/`/api-extractor; the `exports` map is gated by `check-css-exports`.

## Steps

1. Copy the closest existing lib (e.g. `eyecatchers-core` for an agnostic tsc lib,
   `design-system-angular` for an Angular lib). Rename the dir + all internal references.
2. Set the three tags in `project.json` and add the `api-check` target.
3. Add the `@de-braighter/<lib>` path alias to `tsconfig.base.json`.
4. Put public code under `src/public/`; barrel it from `src/index.ts`.
5. Build, then generate the api-extractor baseline: `npm run api:update` (review + commit the new `etc/<lib>.api.md`).
6. For an Angular lib, add `ng-package.json` and the lib's `build:libs`/`publish:libs` entries in `package.json`.
7. Run `npm run lib:conformance` and `npm run ci:local` — both must pass before PR.
```

- [ ] **Step 4: Commit**
```bash
git add package.json docs/adding-a-lib.md
git status --short
git commit -m "chore(conformance): wire lib:conformance into ci:local + adding-a-lib doc

Part of charter PR2b (#5).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Full gate + PR

- [ ] **Step 1: Full local CI gate**
```bash
npm run ci:local
echo "EXIT: $?"
```
Expected: EXIT 0 — build + lint + typecheck + api-check + **lib:conformance** + vite:test all green.

- [ ] **Step 2: Push**
```bash
git push -u origin chore/ds-pr2b-lib-conformance
```

- [ ] **Step 3: Story issue + PR**
```bash
gh issue create --title "PR2b: lib-conformance CI gate + adding-a-lib doc" --body "Story for PR2b of the vector-ideas adoption charter (#5). Reinterprets #5's means: instead of an nx generator, a continuous check-lib-conformance gate (wired into ci:local) that validates EVERY lib matches the conforming shape (tags, src/public + barrel, api-extractor.json + etc/*.api.md, api-check target, tsconfig path alias; css lib checked for its check-css-exports gate), plus a docs/adding-a-lib.md template. New libs are rare + dual-flavor, so a continuous check is higher-value/lower-maintenance than a generator and catches drift across all libs. This repo has no type/story label taxonomy, so filed unlabeled."
```
Record the issue number `NN`, then:
```bash
gh pr create --base main --title "chore: lib-conformance CI gate + adding-a-lib doc (charter PR2b)" --body "PR2b of the vector-ideas adoption charter (#5) — the conformance-check interpretation.

Closes #NN

## What
- \`tools/check-lib-conformance.mjs\`: fails if any lib drifts from the conforming shape (tags on all 3 axes, src/public + barrel, api-extractor.json + etc/*.api.md, api-check target, tsconfig path alias; css lib checked for its check-css-exports gate).
- Wired into \`ci:local\` as \`lib:conformance\`.
- \`docs/adding-a-lib.md\`: the conforming-shape checklist + copy-from-existing guidance.

## Why a check, not a generator (#5 reinterpreted)
The charter proposed an nx generator. New libs are rare and dual-flavor (tsc + ng-packagr); a continuous conformance check enforces the shape across ALL libs (not just at creation) with far less machinery — serving #5's end ('libs conform; never hand-create a divergent lib') better than generation. A generator can be added later if scaffolding convenience is missed.

## Verification
- \`npm run ci:local\` exits 0 (incl. lib:conformance: all 6 libs conform).
- Red-green confirmed (drops a tag / adds a ./lib ref -> check fails; revert -> passes).

Remote GitHub Actions is billing-blocked; gate is local ci:local + charter-checker.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: charter-checker** — run the charter-checker agent against `main...chore/ds-pr2b-lib-conformance`, pointed at the charter, noting PR2b reinterprets #5 (conformance check, not generator) — confirm it delivers #5's end (continuous conformance enforcement), stays in scope (no generator built, no lib changes beyond the check + doc + ci:local wiring), and the check's rules match the PR2a/PR2c shape.

---

## Self-Review

**Spec coverage (charter #5, conformance-check interpretation):**
- Enforce the conforming shape for all libs → `check-lib-conformance.mjs` (Task 1). ✓
- Wired into the gate → `ci:local` (Task 2). ✓
- "Adding a lib" guidance (the template half of the decision) → `docs/adding-a-lib.md` (Task 2). ✓
- Red-green that the check actually catches drift → Task 1 Steps 4–6. ✓
- No code generator built (the decision) → no task builds one. ✓

**Placeholder scan:** The full script, the package.json edit, the doc, and commit messages are all shown verbatim. No TBD/TODO. Task 1 Step 3 allows the implementer to adjust the script to match real structure — bounded by "never weaken a check," not a placeholder.

**Type/name consistency:** Branch `chore/ds-pr2b-lib-conformance` (Tasks 1, 3). Script path `tools/check-lib-conformance.mjs` consistent. `lib:conformance` npm script consistent (Task 2, 3). Tag value sets match those established in PR1 (`scope:design-system|eyecatchers`, `type:core|ui|css`, `platform:agnostic|web-angular`).

**Risk:** Low — the check reads files, no build needed, no lib content changes. Main risk is the script's expectations not matching a real lib's structure (false positive) — caught by Task 1 Step 3 (all 6 must pass) and fixable by tightening the script to reality. The css carve-out (type:css → check-css-exports instead of public/api-extractor) is the one branch to get right; Step 3 validates it against the real design-system-css.
