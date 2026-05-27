# PR1 — Delete `design-system-react` + close tag-governance gaps — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unused `design-system-react` library from the design-system layer and add the one missing `@nx/enforce-module-boundaries` constraint (`type:css → type:core`), leaving the build, lint, and boundary enforcement green.

**Architecture:** PR1 of the four-PR "vector ideas adoption" charter (`docs/superpowers/specs/2026-05-27-design-system-vector-ideas-adoption-design.md`). The charter's #4 ("two-axis tag governance") is *already implemented and enforced* in this repo under the tags `scope:` (lib group) / `type:` (layer) / `platform:` (framework). So PR1 does only the genuinely-new work: delete the React lib (Angular-only decision; React added later if needed, recoverable from git history) and close the one open enforcement gap. No tag renames.

**Tech Stack:** Nx (npm, not pnpm), `@nx/eslint-plugin` flat config (`eslint.config.mjs`), ng-packagr Angular libs, hand-wired `node_modules/@de-braighter/*` symlinks via `scripts/setup-dev.sh`.

**Repo note:** All code changes happen in the **`design-system` git repo**, which is cloned at `D:\development\projects\de-braighter\layers\design-system\` (a separate repo from the workbench that holds this plan). Every `git` command below runs **inside that directory**, on a branch in *that* repo.

---

## File Structure

Files touched in `layers/design-system/`:

- Delete: `libs/design-system-react/` (entire directory — the lib).
- Modify: `tsconfig.base.json` — remove the `@de-braighter/design-system-react` path alias.
- Modify: `package.json` — remove `design-system-react` from the `build:libs` and `publish:libs` scripts.
- Modify: `eslint.config.mjs` — add the `type:css → type:core` dep-constraint.
- Possibly remove: `node_modules/@de-braighter/design-system-react` (stale symlink left by `setup-dev.sh`).

No `project.json` tag edits are needed: deleting the lib retires the now-memberless `platform:web-react` tag automatically, and the other libs' tags are already correct.

---

### Task 1: Create the working branch in the design-system repo

**Files:** none (git only).

- [ ] **Step 1: Move into the design-system repo and confirm clean state**

Run:
```bash
cd /d/development/projects/de-braighter/layers/design-system
git status --short
git branch --show-current
```
Expected: a clean (or only-untracked) tree; note the current branch so you can confirm you branch off the intended base. If there is uncommitted tracked work, stop and resolve it before continuing.

- [ ] **Step 2: Branch off the repo's main**

Run:
```bash
git checkout main
git checkout -b chore/ds-delete-react-and-tag-gaps
```
Expected: `Switched to a new branch 'chore/ds-delete-react-and-tag-gaps'`.

---

### Task 2: Establish the green baseline (before any change)

**Files:** none (verification only).

This captures that build + lint pass *before* the deletion, so any later failure is attributable to PR1.

- [ ] **Step 1: Build all projects (topological — required before lint/symlinks)**

Run:
```bash
npx nx run-many -t build
```
Expected: all projects build successfully (`design-system-react` still builds here — that is fine; it is removed in Task 3).

- [ ] **Step 2: Lint all projects**

Run:
```bash
npx nx run-many -t lint
```
Expected: PASS, no `@nx/enforce-module-boundaries` errors.

---

### Task 3: Delete the `design-system-react` library

**Files:**
- Delete: `libs/design-system-react/`
- Modify: `tsconfig.base.json:24` (+ trailing comma on line 23)
- Modify: `package.json` (`build:libs`, `publish:libs`)

- [ ] **Step 1: Remove the library directory**

Run:
```bash
git rm -r libs/design-system-react
```
Expected: git stages the deletion of all files under `libs/design-system-react/` (project.json, package.json, ng-package.json, tsconfig*.json, README.md, src/**).

- [ ] **Step 2: Remove the tsconfig path alias**

In `tsconfig.base.json`, the `paths` block currently ends:

```json
      "@de-braighter/design-system-css": ["libs/design-system-css/src/index.ts"],
      "@de-braighter/design-system-react": ["libs/design-system-react/src/index.ts"]
```

Edit it to (delete the react line **and** the trailing comma on the css line, since css becomes the last entry — trailing commas are not valid here):

```json
      "@de-braighter/design-system-css": ["libs/design-system-css/src/index.ts"]
```

- [ ] **Step 3: Remove react from the `build:libs` script**

In `package.json`, the `build:libs` script currently ends with ` && nx build design-system-react`. Change:

```json
    "build:libs": "nx build design-system-core && nx build design-system-css && nx build design-system-angular && node tools/post-build-design-system-angular.mjs && nx build design-system-react",
```

to:

```json
    "build:libs": "nx build design-system-core && nx build design-system-css && nx build design-system-angular && node tools/post-build-design-system-angular.mjs",
```

- [ ] **Step 4: Remove react from the `publish:libs` script**

In `package.json`, the `publish:libs` script currently ends with ` && cd ../design-system-react && npm publish --userconfig=../../../.npmrc`. Change:

```json
    "publish:libs": "npm run build:libs && cd dist/libs/design-system-core && npm publish --userconfig=../../../.npmrc && cd ../design-system-css && npm publish --userconfig=../../../.npmrc && cd ../design-system-angular && npm publish --userconfig=../../../.npmrc && cd ../design-system-react && npm publish --userconfig=../../../.npmrc",
```

to:

```json
    "publish:libs": "npm run build:libs && cd dist/libs/design-system-core && npm publish --userconfig=../../../.npmrc && cd ../design-system-css && npm publish --userconfig=../../../.npmrc && cd ../design-system-angular && npm publish --userconfig=../../../.npmrc",
```

- [ ] **Step 5: Remove the stale dev symlink if present**

Run:
```bash
rm -rf node_modules/@de-braighter/design-system-react
```
Expected: no output (removes the `setup-dev.sh`-created symlink; harmless if it does not exist).

- [ ] **Step 6: Reset the Nx graph cache (it still lists the deleted project)**

Run:
```bash
npx nx reset
```
Expected: `Successfully reset the Nx workspace.` (clears `.nx/workspace-data` which still references `design-system-react`).

- [ ] **Step 7: Verify no dangling references remain**

Run:
```bash
grep -rn "design-system-react" . \
  --include="*.json" --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.js" --include="*.md" \
  | grep -v node_modules | grep -v "/.nx/"
```
Expected: **no output**. (If anything prints, it is a missed reference — fix it before continuing.)

- [ ] **Step 8: Build everything to confirm the deletion is clean**

Run:
```bash
npx nx run-many -t build
```
Expected: all *remaining* projects build successfully; `design-system-react` is no longer in the project list.

- [ ] **Step 9: Lint everything**

Run:
```bash
npx nx run-many -t lint
```
Expected: PASS.

- [ ] **Step 10: Commit the deletion**

```bash
git add -A
git commit -m "chore: delete unused design-system-react lib

Nothing in the cluster imports it; Angular-only per the vector-ideas
adoption charter (#4). Recoverable from git history if React is needed
later. Removes the lib, its tsconfig path alias, and its build:libs /
publish:libs script entries. Retires the now-memberless platform:web-react tag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Add the `type:css → type:core` boundary constraint

**Files:**
- Modify: `eslint.config.mjs` (the `depConstraints` array)
- Temporary: `libs/design-system-css/src/__boundary_probe__.ts` (created then deleted)

> **Why this is a forward guard, not a behavior change today:** `design-system-css` is `platform:agnostic`, and every current `type:ui` lib is also `platform:web-angular`. So a css→ui import is *already* blocked by the existing `platform:agnostic → agnostic-only` rule. Adding `type:css → type:core` makes the layering rule explicit and guards any *future* `platform:agnostic` UI/app lib. The probe below confirms css→ui imports are policed and css→core imports are allowed; it does not isolate which rule fires (both do for css→ui), and that is fine.

- [ ] **Step 1: Add a probe that imports a `type:ui` lib from `design-system-css` (this should be rejected)**

Create `libs/design-system-css/src/__boundary_probe__.ts`:

```ts
// TEMPORARY boundary probe — deleted in Step 6 of this task. Do not commit.
// design-system-css is type:css; design-system-angular is type:ui.
import '@de-braighter/design-system-angular';
```

- [ ] **Step 2: Lint the css lib and confirm the import is rejected**

Run:
```bash
npx nx lint design-system-css
```
Expected: FAIL with an `@nx/enforce-module-boundaries` error reporting a disallowed dependency from `design-system-css` onto `design-system-angular`. (This confirms css→ui imports are blocked. Today the message cites the `platform` rule; after Step 4 the `type:css` rule also covers it.)

- [ ] **Step 3: Repoint the probe at a `type:core` lib (this should be allowed)**

Replace the contents of `libs/design-system-css/src/__boundary_probe__.ts` with:

```ts
// TEMPORARY boundary probe — deleted in Step 6 of this task. Do not commit.
// design-system-core is type:core + platform:agnostic — an allowed dependency for css.
import '@de-braighter/design-system-core';
```

- [ ] **Step 4: Add the explicit `type:css → type:core` constraint**

In `eslint.config.mjs`, inside the `depConstraints` array, the `type:ui` entry currently reads:

```js
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:core', 'type:ui'],
            },
```

Add a new entry immediately after it:

```js
            {
              sourceTag: 'type:css',
              onlyDependOnLibsWithTags: ['type:core'],
            },
```

- [ ] **Step 5: Lint the css lib and confirm the `type:core` import is allowed**

Run:
```bash
npx nx lint design-system-css
```
Expected: PASS (no boundary error — `design-system-core` is `type:core` + `platform:agnostic`, allowed on both axes).

- [ ] **Step 6: Delete the probe**

Run:
```bash
rm libs/design-system-css/src/__boundary_probe__.ts
```
Expected: no output. Confirm it is gone:
```bash
git status --short libs/design-system-css/src
```
Expected: no `__boundary_probe__.ts` shown (it was never committed).

- [ ] **Step 7: Final full lint to confirm no regressions from the new rule**

Run:
```bash
npx nx run-many -t lint
```
Expected: PASS for all projects (the new rule introduces no false positives).

- [ ] **Step 8: Commit the constraint**

```bash
git add eslint.config.mjs
git commit -m "chore: add type:css -> type:core enforce-module-boundaries constraint

Closes the one open gap in the tag governance: type:css previously had no
dep-constraint. Forward guard for any future platform:agnostic UI/app lib;
redundant with the platform:agnostic rule for current members.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full gate + push + PR

**Files:** none (verification + git).

- [ ] **Step 1: Run the full local CI gate**

Run:
```bash
npm run ci:local
```
Expected: PASS — this runs `nx run-many -t build lint typecheck` then `nx run-many -t vite:test --parallel=1`. All green.

- [ ] **Step 2: Push the branch**

Run:
```bash
git push -u origin chore/ds-delete-react-and-tag-gaps
```
Expected: branch pushed; a PR-create URL is printed.

- [ ] **Step 3: Open the PR**

Run:
```bash
gh pr create --fill --base main \
  --title "chore: delete unused design-system-react + close type:css tag gap (charter PR1)" \
  --body "PR1 of the vector-ideas adoption charter (docs/superpowers/specs/2026-05-27-design-system-vector-ideas-adoption-design.md).

- Delete the unused \`design-system-react\` lib (Angular-only; recoverable from history).
- Add the \`type:css -> type:core\` enforce-module-boundaries constraint (the one open tag gap).

#4's two-axis tag governance was found already implemented under \`type:\`/\`platform:\`/\`scope:\`, so this PR only does the genuinely-new work.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```
Expected: PR created against `main`.

- [ ] **Step 4: Run the verifier wave**

Per the workbench `workflows/verifier-wave.md`, dispatch `local-ci` + `reviewer` + `charter-checker` + `qa-engineer` in parallel (each with `isolation: "worktree"`) against the PR head. Address any findings before requesting merge. Do **not** bypass pre-push hooks.

---

## Self-Review

**Spec coverage (against charter #4 + PR1 success criteria):**
- "delete design-system-react from repo, tsconfig.base.json, build:libs, publish:libs" → Task 3 Steps 1–4. ✓
- "retire platform:web-react tag" → automatic on lib deletion (no member remains); noted Task 3 Step 10 commit. ✓
- "add type:css → type:core constraint" → Task 4 Step 4. ✓
- "deliberately-wrong type:css→type:ui import fails nx lint" → Task 4 Steps 1–2 (with the documented nuance that the platform rule also covers it). ✓
- "full ci:local stays green" → Task 5 Step 1. ✓

**Placeholder scan:** No TBD/TODO; every edit shows exact before/after content; every command has expected output. ✓

**Type/name consistency:** Branch name `chore/ds-delete-react-and-tag-gaps` used consistently in Tasks 1 and 5. Probe path `libs/design-system-css/src/__boundary_probe__.ts` consistent across Task 4 Steps 1/3/6. Script names `build:libs` / `publish:libs` / `ci:local` match `package.json`. ✓

**Open risk:** none specific to PR1 — this is deletion + one config line. The api-extractor/Angular risk flagged in the charter belongs to PR2, not here.
