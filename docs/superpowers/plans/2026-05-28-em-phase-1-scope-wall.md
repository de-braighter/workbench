# Eyecatchers Merge — Phase 1: Drop the scope wall — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the `scope:eyecatchers` nx tag axis so `eyecatchers-core` / `eyecatchers-angular` can depend on `design-system-*` libs without the boundary block. Unblocks the math/tokens graduation (Phase 2), contracts move (Phase 3), and component move (Phase 4a/b/c).

**Architecture:** Pure config change — 4 files. Remove one `@nx/enforce-module-boundaries` `depConstraint`, relabel both eyecatchers libs' `project.json` tags to `scope:design-system`, drop `scope:eyecatchers` from the lib-conformance check's allowed set. **No content moves; no api-extractor changes; api-snapshots unchanged.**

**Tech Stack:** `@nx/eslint-plugin` flat config (`eslint.config.mjs`), nx project tags, the existing `check-lib-conformance.mjs` (PR2b).

**Repo/env:** `D:\development\projects\de-braighter\layers\design-system\`, branch off `main`. **CRITICAL: verify branch immediately before commit** — this repo has had branches switch under controllers. If a build/lint errors `Cannot find module '@de-braighter/...'`, STOP + report BLOCKED (controller fixes symlinks); do not run `setup-dev.sh`. NEVER commit the 2 untracked scratch files (`libs/design-system-angular/tsconfig.spec.json`, `vitest.debug.config.ts`); targeted `git add` only.

---

## File Structure

Exactly 4 files modified:

- **Modify:** `eslint.config.mjs` — remove the `scope:eyecatchers` `depConstraint` block (lines around 24–27 in the depConstraints array).
- **Modify:** `libs/eyecatchers-core/project.json` — change the `"tags"` array: replace `"scope:eyecatchers"` with `"scope:design-system"`.
- **Modify:** `libs/eyecatchers-angular/project.json` — same tag change.
- **Modify:** `tools/check-lib-conformance.mjs` — change `SCOPE_TAGS` from `['scope:design-system', 'scope:eyecatchers']` to `['scope:design-system']`.

---

### Task 1: Branch + green baseline

- [ ] **Step 1: Branch off main**
```bash
cd /d/development/projects/de-braighter/layers/design-system
git checkout main && git pull --ff-only
git checkout -b chore/em-phase-1-scope-wall
git branch --show-current   # MUST print: chore/em-phase-1-scope-wall
```

- [ ] **Step 2: Baseline `ci:local` is green**
```bash
npm run ci:local
echo "EXIT: $?"
```
Expected: EXIT 0. If a build errors `Cannot find module '@de-braighter/...'`, STOP and report BLOCKED.

---

### Task 2: Apply the 4 edits

- [ ] **Step 1: Remove the scope:eyecatchers depConstraint from `eslint.config.mjs`.**

Find this block inside the `depConstraints: [ ... ]` array (the current `@nx/enforce-module-boundaries` configuration):
```js
            {
              sourceTag: 'scope:eyecatchers',
              onlyDependOnLibsWithTags: ['scope:eyecatchers'],
            },
```
DELETE that whole 4-line object (including the trailing comma if it's the only thing on that line — keep the surrounding array commas valid). The other depConstraints (`scope:showcase`, `platform:*`, `type:*`, `type:css`) MUST remain untouched.

- [ ] **Step 2: Update `libs/eyecatchers-core/project.json` tags.**

Read the file's `"tags"` line; it currently includes `"scope:eyecatchers"`. Change to `"scope:design-system"`. The full `tags` array should end up as:
```json
"tags": ["scope:design-system", "type:core", "platform:agnostic"]
```
(Keep `type:core` and `platform:agnostic` exactly as they were.)

- [ ] **Step 3: Update `libs/eyecatchers-angular/project.json` tags.**

Same change pattern; result:
```json
"tags": ["scope:design-system", "type:ui", "platform:web-angular"]
```

- [ ] **Step 4: Update `SCOPE_TAGS` in `tools/check-lib-conformance.mjs`.**

The current line reads:
```js
const SCOPE_TAGS = ['scope:design-system', 'scope:eyecatchers'];
```
Change to:
```js
const SCOPE_TAGS = ['scope:design-system'];
```

- [ ] **Step 5: Verify `lib-conformance` accepts the new tag layout.**
```bash
node tools/check-lib-conformance.mjs
```
Expected: `Lib conformance: all 6 libs conform.` exit 0. (The two eyecatchers libs now carry `scope:design-system` and the conformance check accepts that as its sole allowed scope value.)

- [ ] **Step 6: Verify lint passes — no surprise boundary regressions.**
```bash
npx nx run-many -t lint
```
Expected: 0 errors. If a previously-hidden cross-lib import is now allowed (good, that's what we wanted) OR if any other rule fires (unlikely — we only removed a constraint, never added one), inspect; should remain green.

---

### Task 3: Prove the wall is down — boundary red-green

The wall used to forbid eyecatchers-angular from importing anything other than scope:eyecatchers. Confirm it no longer fires:

- [ ] **Step 1: Create a probe import in eyecatchers-angular pointing at design-system-core.**

Create `libs/eyecatchers-angular/src/__scope_probe__.ts`:
```ts
// TEMPORARY probe — deleted in Step 3. Verifies the scope wall is down.
// Before Phase 1, this import would have failed @nx/enforce-module-boundaries.
import { damp } from '@de-braighter/design-system-core';
void damp;
```

- [ ] **Step 2: Lint eyecatchers-angular — the probe must NOT trigger a boundary error.**
```bash
npx nx lint eyecatchers-angular
```
Expected: PASS (0 errors related to the probe). The new import is allowed because both libs are now `scope:design-system`. If a `@nx/enforce-module-boundaries` error appears for the probe, the configuration didn't take effect — investigate before continuing.

- [ ] **Step 3: Remove the probe.**
```bash
rm libs/eyecatchers-angular/src/__scope_probe__.ts
```
Confirm: `git status --short libs/eyecatchers-angular/src` shows nothing.

---

### Task 4: Full gate + commit

- [ ] **Step 1: Full `ci:local`**
```bash
npm run ci:local
echo "EXIT: $?"
```
Expected: EXIT 0. All gates (lib:conformance, tokens:check, build, lint, typecheck, api-check, vite:test) green.

- [ ] **Step 2: Confirm api-snapshots unchanged.**
```bash
git diff --stat libs/*/etc/*.api.md
```
Expected: empty (no content moved; api-snapshots are untouched).

- [ ] **Step 3: Branch-recheck immediately before commit.**
```bash
[ "$(git branch --show-current)" = "chore/em-phase-1-scope-wall" ] || { echo "WRONG BRANCH — abort"; exit 1; }
```

- [ ] **Step 4: Targeted commit.**
```bash
git add eslint.config.mjs libs/eyecatchers-core/project.json libs/eyecatchers-angular/project.json tools/check-lib-conformance.mjs
git status --short
```
Confirm only the 4 expected files are staged + the 2 scratch files remain untracked (not staged). Then:
```bash
git commit -m "chore(merge): drop scope:eyecatchers wall (Phase 1 of em-charter)

Retires the scope:eyecatchers nx tag axis so eyecatchers libs can depend on
design-system libs without the boundary block. Pure config: removes one
@nx/enforce-module-boundaries depConstraint, relabels both eyecatchers libs'
project.json tags to scope:design-system, drops scope:eyecatchers from the
lib-conformance check's allowed set. No content moves; api-snapshots
unchanged. Unblocks Phase 2 (math/tokens graduation) and beyond.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: PR + charter-checker

- [ ] **Step 1: Push + issue + PR**
```bash
git push -u origin chore/em-phase-1-scope-wall
gh issue create --title "EM Phase 1: drop the scope:eyecatchers wall" --body "Story for Phase 1 of the eyecatchers-merge charter (docs/superpowers/specs/2026-05-28-eyecatchers-merge-design.md in the workbench). Pure config — removes one nx depConstraint, relabels two project.json tags, narrows the lib-conformance allowed scope set. Unblocks Phase 2 onward. Filed unlabeled."
```
Record issue `NN`; `gh pr create --base main` with title `chore: drop scope:eyecatchers wall (EM Phase 1)`, body covering What / motivation (unblock subsequent phases) / verification (ci:local exit 0, boundary red-green confirmed, api-snapshots unchanged), `Closes #NN`, 🤖 footer.

- [ ] **Step 2: charter-checker** against `main...chore/em-phase-1-scope-wall`, pointed at the eyecatchers-merge charter — confirms: only the 4 declared files changed, no content moves, no api-snapshot drift, the scope:eyecatchers references are removed across all three loci (eslint depConstraint + both project.json tags + lib-conformance script).

---

## Self-Review

**Spec coverage (charter Phase 1):**
- Remove `scope:eyecatchers → only-eyecatchers` depConstraint → Task 2 Step 1. ✓
- Relabel both eyecatchers libs' project.json tags to `scope:design-system` → Task 2 Steps 2–3. ✓
- Drop `scope:eyecatchers` from `SCOPE_TAGS` in lib-conformance → Task 2 Step 4. ✓
- No content moves → no task moves files. ✓
- api-snapshots unchanged → verified Task 4 Step 2. ✓

**Placeholder scan:** Exact file edits shown verbatim; commands have expected outputs; no TBD/TODO. The boundary red-green probe is shown in full (Task 3).

**Type/name consistency:** Branch `chore/em-phase-1-scope-wall` consistent (Tasks 1, 4, 5). `SCOPE_TAGS` variable name matches the existing constant in `check-lib-conformance.mjs`. Tag values (`scope:design-system`, `type:core`, `type:ui`, `platform:agnostic`, `platform:web-angular`) match PR1's established taxonomy.

**Risk:** Lowest in the whole charter. The change only *removes* a constraint; the only thing that could go wrong is if a pre-existing cross-lib import was already hidden by the scope wall (it would now be allowed — which is fine, that's the point). The verifier wave catches any other regression.
