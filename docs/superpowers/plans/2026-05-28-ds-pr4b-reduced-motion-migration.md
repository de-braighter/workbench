# PR4b — Reduced-motion migration: move the 15 `matchMedia` call sites onto the central primitive — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the ~15 scattered `matchMedia('(prefers-reduced-motion: reduce)')` call sites in `libs/eyecatchers-angular/src/lib/**/*.component.ts`, replacing each with the PR4a central primitive: RAF-driven components switch `createFrameLoop` → `createMotionLoop`; setTimeout-driven components call `prefersReducedMotion()` at the action site. **Net: the preference is honored in two places (the loop + the primitive), not 15.**

**Architecture:** Final sub-PR of charter #3 — completes the centralization that PR4a's mechanism enabled. **Last adoption of the charter.** Pure consumer migration — no infra changes; the new symbols (`createMotionLoop`, `prefersReducedMotion`, `onReducedMotionChange`) are already published in `eyecatchers-core` after PR4a (#97). api-extractor snapshots **unchanged** (consumer-internal refactor, no public-API change).

**Risk + mitigation:** There's no visual-regression harness, so behavioral parity per component rests on the mechanical translation being faithful. Mitigations: (a) two migration patterns (RAF, setTimeout) covering all sites; (b) a grep verification (`matchMedia('(prefers-reduced-motion'` ⇒ zero hits in `eyecatchers-angular` after) proves no site was missed; (c) the existing component tests + the build/lint/api-check gates run as usual; (d) post-migration manual smoke (load the showcase, check a couple of motion components render — optional but recommended).

**Tech Stack:** Angular (`eyecatchers-angular`, standalone components, signals), `@de-braighter/eyecatchers-core` for the central primitives, existing nx targets.

**Current state (grounded — survey 2026-05-28):** ~15 `eyecatchers-angular` components do their own `matchMedia` check. They fall into three patterns:

1. **RAF-driven (majority — ~11 components):** start a frame loop via `createFrameLoop((_now, dtSec) => this.tick(dtSec), browserFrameHost())`; cache `reducedMotion = matchMedia(...).matches` in constructor / `ngAfterViewInit`; gate `tick()` with `if (this.reducedMotion) return;`. Examples: `heartbeat`, `heart-pulse`, `orbit-ring`, `orbit-picker`, `magnetic-tag-cloud`, `inertial-dial`, `glow-slider`, `service-map`, `magnetic-cursor`, `sparkle-hover`, `aurora-background`.
2. **setTimeout-driven (text effects — ~3 components):** `type-writer`, `text-scramble`, and similar — drive ticks via `setTimeout`/`setInterval`; the cached `reducedMotion` field gates the animation (often short-circuiting to "render final state immediately"). Some short-circuit in a `computed` rather than a `tick`.
3. **Listener-based (dynamic — 2 components):** `gravity-field`, `pressure-commit` — same RAF pattern + an `mq.addEventListener('change', …)` that updates a signal so runtime preference changes take effect immediately. Often `destroyRef.onDestroy` removes the listener.

**Repo/env:** `D:\development\projects\de-braighter\layers\design-system\`, branch off `main` (post-PR4a). If a build errors `Cannot find module '@de-braighter/...'`, STOP + report BLOCKED (controller fixes symlinks); don't run `setup-dev.sh`. NEVER commit the 2 untracked scratch files (`libs/design-system-angular/tsconfig.spec.json`, `vitest.debug.config.ts`); targeted `git add` only.

---

## Migration patterns (the three recipes the implementer applies per component)

### Pattern A — RAF-driven (most common)
**Find** in the component:
- An import of `createFrameLoop` (and `browserFrameHost`) from `@de-braighter/eyecatchers-core`.
- A field like `private reducedMotion = false;` initialized in `constructor` / `ngAfterViewInit` via `matchMedia('(prefers-reduced-motion: reduce)').matches`.
- A `tick()` (or similar) that early-returns when `this.reducedMotion` is true.

**Replace with:**
- Change the import: drop `createFrameLoop`, add `createMotionLoop` (keep `browserFrameHost`).
- Change the call site: `createMotionLoop((_now, dtSec) => this.tick(dtSec), browserFrameHost())`.
- Delete the `reducedMotion` field + its initialization + the `matchMedia` call.
- Delete the `if (this.reducedMotion) return;` line in `tick()` — `createMotionLoop` now skips the callback when reduced-motion is active.

### Pattern B — setTimeout-driven
**Find:** a `reducedMotion` field set from `matchMedia` and used inline (often in a `computed`, an `effect`, or a step function that short-circuits to render the terminal state).

**Replace with:**
- Add `import { prefersReducedMotion } from '@de-braighter/eyecatchers-core';` (once at the top of the file).
- Delete the field + its `matchMedia` initialization.
- Replace each use of `this.reducedMotion` with `prefersReducedMotion()` (same boolean shape; the primitive is cached so calling it per render is cheap).

### Pattern C — Listener-based (gravity-field, pressure-commit)
**Find:** Pattern A's RAF + a `mq.addEventListener('change', cb)` + a `reducedMotion` signal that the listener `.set()`s + the `destroyRef.onDestroy` removeListener.

**Replace with:**
- Same as Pattern A (drop matchMedia, switch to `createMotionLoop`).
- Drop the `addEventListener`/`removeEventListener` plumbing entirely — `createMotionLoop` reads the primitive on every tick, so as soon as the cache is updated, future ticks honor the new value.
- **Only** add `onReducedMotionChange` here if the component has a NON-tick UI path that depends on the live preference (e.g. a `computed` that shows an alternate-static-rendering view). Most don't — verify by grep on the file. If you find one, add a single `onReducedMotionChange((reduced) => this.reducedMotionSignal.set(reduced));` with the unsubscribe in `destroyRef.onDestroy`. If not, the `reducedMotion` signal can be deleted along with the listener.

> **Behavioral nuance:** Pattern C components currently update reactively when the user toggles the OS preference at runtime. Patterns A + B (after migration) only re-check at tick time — for RAF-driven that's per-frame (effectively reactive); for setTimeout-driven it's at the next step. The primitive's cache only updates when someone calls `onReducedMotionChange` — so post-migration, runtime preference changes are honored on the next tick / step **only if** a subscription exists somewhere. Since `createMotionLoop` re-reads the primitive every frame and the primitive consults the cache, this is fine **statically** (initial preference is honored). For **runtime updates** we accept the charter's posture (vector ADR-0015: detection at construction; reload to re-evaluate) — except for the two Pattern-C components where we explicitly preserve the runtime behavior via `onReducedMotionChange` if they used it for a non-tick UI path.

---

## File Structure

Modified per component (in `libs/eyecatchers-angular/src/lib/**/*.component.ts`): drop `matchMedia` field/init/early-return; swap `createFrameLoop`→`createMotionLoop` (Pattern A/C) or add `prefersReducedMotion()` calls (Pattern B). **No new files; no infra changes; no api-extractor changes.**

---

### Task 1: Enumerate the call sites, then migrate each by pattern

- [ ] **Step 1: Branch**
```bash
cd /d/development/projects/de-braighter/layers/design-system
git checkout main && git pull --ff-only
git checkout -b chore/ds-pr4b-reduced-motion-migration
```

- [ ] **Step 2: Enumerate the call sites:**
```bash
grep -rln "matchMedia('(prefers-reduced-motion" libs/eyecatchers-angular/src
```
Record the list. Expected: ~15 components (the survey listed: `aurora-background`, `glow-slider`, `gravity-field`, `heart-pulse`, `heartbeat`, `inertial-dial`, `magnetic-cursor`, `magnetic-tag-cloud`, `orbit-picker`, `orbit-ring`, `pressure-commit`, `segmented-control`, `service-map`, `sparkle-hover`, `text-scramble`, `type-writer`).

- [ ] **Step 3: For EACH file in the list, classify and migrate per Pattern A / B / C above.** Read the file first to confirm its pattern. Apply the recipe:
  - Pattern A: swap the import, swap the call to `createMotionLoop`, delete the `reducedMotion` field/init, delete the `if (this.reducedMotion) return;` line in tick().
  - Pattern B: add the `prefersReducedMotion` import; delete the field/init; replace `this.reducedMotion` references with `prefersReducedMotion()`.
  - Pattern C: same as A, plus only-if-needed `onReducedMotionChange` for non-tick UI.

  After each file, the file should:
  - No longer reference `matchMedia` for the reduced-motion query.
  - Build cleanly (typecheck passes).
  - Have no dead unused imports (drop `createFrameLoop` if `createMotionLoop` replaced it; keep `browserFrameHost`).

- [ ] **Step 4: GREP verification — ZERO `matchMedia` reduced-motion calls left in `eyecatchers-angular`:**
```bash
grep -rn "matchMedia('(prefers-reduced-motion" libs/eyecatchers-angular/src
```
Expected: **no output**. If anything remains, the file was missed — go back to Step 3 for it.

Also verify the `reducedMotion` field is gone where it was a private boolean from matchMedia (some components may legitimately still use `reducedMotion` as a name for something else; only the matchMedia-derived ones should be gone):
```bash
grep -rn "reducedMotion = false" libs/eyecatchers-angular/src
grep -rn "addEventListener('change'" libs/eyecatchers-angular/src
```
Expected: no remaining matchMedia-derived `reducedMotion` fields or change-listeners on a media-query.

- [ ] **Step 5: Build + lint + api-check + the design-system-angular tests:**
```bash
npx nx run-many -t build --projects=eyecatchers-angular
npx nx run-many -t lint --projects=eyecatchers-angular
npx nx run-many -t api-check --projects=eyecatchers-angular
```
Expected: all PASS. api-check **MUST stay green with snapshot UNCHANGED** — this is a consumer-internal migration, no public-API change. If a snapshot changed, something leaked into the public surface (e.g. a const renamed) — fix the migration, don't regenerate the snapshot. If build errors `Cannot find module @de-braighter/...`, STOP + report.

Confirm `etc/eyecatchers-angular.api.md` unchanged: `git diff --stat libs/eyecatchers-angular/etc` → empty.

- [ ] **Step 6: Commit (targeted)**
```bash
git add libs/eyecatchers-angular/src
git status --short
git commit -m "refactor(eyecatchers): centralize reduced-motion check via createMotionLoop/prefersReducedMotion

Migrates ~15 components from per-component matchMedia('(prefers-reduced-motion: reduce)')
checks to the central primitive published by eyecatchers-core in PR4a. RAF-driven
components use createMotionLoop (skips tick under RM); setTimeout-driven call
prefersReducedMotion() at the action site; listener-based components drop the
addEventListener boilerplate (the wrapper re-reads the primitive per frame).
api-extractor snapshot unchanged (consumer-internal). Completes charter PR4 (#3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
Confirm the 2 scratch files aren't staged.

---

### Task 2: Full gate + PR

- [ ] **Step 1: Full `ci:local`**
```bash
npm run ci:local
echo "EXIT: $?"
```
Expected: EXIT 0 — `lib:conformance` + `tokens:check` (CSS+TS) + build + lint + typecheck + api-check + vite:test all green. **`api-check` snapshots unchanged** for all 6 libs (no public API moved).

- [ ] **Step 2: (Optional) Manual smoke** — start the showcase and click through a few of the migrated motion components (e.g. `heartbeat`, `gravity-field`, `type-writer`) with reduced-motion ON and OFF in OS settings to confirm behavior. Skip if not feasible; the gates are the formal verification.

- [ ] **Step 3: Push + issue + PR**
```bash
git push -u origin chore/ds-pr4b-reduced-motion-migration
gh issue create --title "PR4b: migrate ~15 eyecatcher components onto the central reduced-motion primitive" --body "Story for PR4b of the vector-ideas adoption charter (#3, decomposed). Final adoption. Migrates the ~15 matchMedia call sites in eyecatchers-angular onto PR4a's central primitive (createMotionLoop for RAF; prefersReducedMotion() for setTimeout). Consumer-internal refactor; api-extractor snapshot unchanged. Filed unlabeled."
```
Record issue `NN`; `gh pr create --base main` with title `refactor: centralize reduced-motion check in eyecatcher components (charter PR4b)`, body covering What / pattern recipes / verification (grep zero matchMedia, ci:local exit 0, snapshot unchanged) / closes-the-charter framing, `Closes #NN`, 🤖 footer.

- [ ] **Step 4: charter-checker** against `main...chore/ds-pr4b-reduced-motion-migration`: confirms (a) `matchMedia('(prefers-reduced-motion')` ⇒ zero hits in `eyecatchers-angular`; (b) `api-check` snapshots unchanged across all libs (no public-API change); (c) only `eyecatchers-angular` files touched; (d) the primitive + `createMotionLoop` are imported from `eyecatchers-core` (scope wall respected).

---

## Self-Review

**Spec coverage (charter #3, PR4b migration slice):**
- Drop scattered `matchMedia` checks → Task 1 Step 3 (per file by pattern). ✓
- Adopt `createMotionLoop` / `prefersReducedMotion()` from `eyecatchers-core` → Task 1 Step 3. ✓
- Verify NO `matchMedia` remains in `eyecatchers-angular` → Task 1 Step 4 grep gate. ✓
- api-extractor snapshots unchanged (consumer-internal) → Task 1 Step 5 + Task 2 Step 1. ✓
- Scope-wall respected (imports only from `eyecatchers-core`) → built-in (PR4a only added the primitive to eyecatchers-core). ✓

**Placeholder scan:** Patterns are described as recipes, not file-by-file code, because the migration is mechanical and the patterns cover all 15-ish files. The grep gate + api-check-unchanged property are the verification (binary, machine-checkable). No TBD/TODO.

**Type/name consistency:** Branch `chore/ds-pr4b-reduced-motion-migration` (Tasks 1, 2). The three pattern names (A RAF / B setTimeout / C listener) consistent throughout. `createMotionLoop` / `prefersReducedMotion` / `onReducedMotionChange` consistent.

**Risk:** No visual-regression net. Mitigations applied: the migration is mechanical (no logic invented), the grep verifies no site is missed, api-check ensures the public surface is untouched (no accidental export leak), build+lint+typecheck catch structural breakage. The behavioral parity for the 2 Pattern-C components rests on the recipe's "only add `onReducedMotionChange` if needed for a non-tick UI path" guidance — Task 1 Step 3 has the implementer verify that per file.
