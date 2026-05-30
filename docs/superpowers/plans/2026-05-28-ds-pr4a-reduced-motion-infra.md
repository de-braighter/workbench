# PR4a — Reduced-motion centralization (infra) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the centralization *mechanism* for `prefers-reduced-motion`: a `prefersReducedMotion()` primitive + an RM-aware frame-loop variant (`createMotionLoop`) in both cores (mirroring `raf.ts`'s existing duplication, mandated by the nx scope wall). **No component changes** — the 15 motion components keep their working `matchMedia` checks; they migrate onto the central mechanism in **PR4b**.

**Architecture:** First (and possibly only — see Risk) sub-PR of charter #3. Decomposed at the user's call because migrating 15 animation components has no visual-regression net; landing the mechanism *first* and the migration *second* makes the behavioral risk reviewable in isolation.

**Charter deviation, recorded:** the charter said "primitive in `design-system-core`." The nx scope wall (`scope:eyecatchers` may only depend on `scope:eyecatchers`) means `eyecatchers-angular` (where 15 of the motion components live) cannot import `design-system-core`. So the primitive lives in **both cores**, mirroring the existing `raf.ts` duplication — same dedup-by-shared-source pattern PR3b used. **The shared CSS `@media` rule is deferred** (the parity-gate's CSS parser doesn't handle nested `@media` braces; current CSS motion is one rule in `button.css`; low value vs parser-upgrade cost — revisit when CSS motion grows).

**Tech Stack:** Node ESM, the existing tsc-based `*-core` lib builds, `@microsoft/api-extractor` (snapshots will deliberately update — new public exports).

**Repo/env:** `D:\development\projects\de-braighter\layers\design-system\`, branch off `main` (post-PR3b). Symlinks fragile — if a build errors `Cannot find module @de-braighter/...`, STOP + report (controller fixes); don't run `setup-dev.sh`. NEVER commit the 2 untracked scratch files (`libs/design-system-angular/tsconfig.spec.json`, `vitest.debug.config.ts`); targeted `git add` only.

---

## File Structure

Per core (`design-system-core` + `eyecatchers-core`, byte-identical pair like `raf.ts`):
- Create: `libs/<core>/src/public/math/reduced-motion.ts` — the `prefersReducedMotion()` + `onReducedMotionChange()` primitives + a test-only cache-reset.
- Create: `libs/<core>/src/public/math/motion-loop.ts` — `createMotionLoop()` (wraps `createFrameLoop`; skips tick when RM is active).
- Modify: `libs/<core>/src/index.ts` — barrel-export the new modules.
- Regenerated (committed): `libs/<core>/etc/<core>.api.md` — api-extractor snapshot updates (new public exports — expected, deliberate).

Plus:
- Create: `tools/test-reduced-motion.mjs` — a tiny Node test script that mocks `globalThis.window.matchMedia` and asserts primitive + loop behavior (no framework needed; runs as `node tools/test-reduced-motion.mjs`).

`createFrameLoop` is **not modified** — backwards-compat for the 15 components that still use it. PR4b switches them to `createMotionLoop`.

---

### Task 1: Add the primitive + RM-aware loop to both cores + tests

**Files:** as above (×2 cores) + the test script.

- [ ] **Step 1: Branch**
```bash
cd /d/development/projects/de-braighter/layers/design-system
git checkout main && git pull --ff-only
git checkout -b chore/ds-pr4a-reduced-motion-infra
```

- [ ] **Step 2: Create `libs/eyecatchers-core/src/public/math/reduced-motion.ts`** with exactly this content:
```ts
/**
 * Reduced-motion preference primitive.
 *
 * `prefersReducedMotion()` returns the user's OS-level
 * `(prefers-reduced-motion: reduce)` preference, cached on first call. The cache
 * is updated when `onReducedMotionChange()` listeners fire. Outside the browser
 * (SSR / Node tests), it defaults to `false`. Use `__setReducedMotionForTests`
 * to force a value in tests.
 */

let cached: boolean | undefined;
let testOverride: boolean | undefined;

export function prefersReducedMotion(): boolean {
  if (testOverride !== undefined) return testOverride;
  if (cached !== undefined) return cached;
  if (typeof globalThis === 'undefined') { cached = false; return cached; }
  const w = (globalThis as { window?: Window }).window;
  if (!w || typeof w.matchMedia !== 'function') { cached = false; return cached; }
  cached = w.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return cached;
}

/**
 * Subscribe to runtime changes of the preference. Returns an unsubscribe.
 * No-op (returns a no-op unsubscribe) outside the browser. Updates the internal
 * cache so subsequent `prefersReducedMotion()` calls reflect the new value.
 */
export function onReducedMotionChange(cb: (reduced: boolean) => void): () => void {
  if (typeof globalThis === 'undefined') return () => {};
  const w = (globalThis as { window?: Window }).window;
  if (!w || typeof w.matchMedia !== 'function') return () => {};
  const mq = w.matchMedia('(prefers-reduced-motion: reduce)');
  const handler = (e: MediaQueryListEvent) => { cached = e.matches; cb(e.matches); };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

/**
 * TEST-ONLY: forces the primitive to return a fixed value (pass `undefined` to
 * clear the override and force re-evaluation on the next call). Do not call
 * from production code.
 */
export function __setReducedMotionForTests(value: boolean | undefined): void {
  testOverride = value;
  cached = undefined;
}
```

- [ ] **Step 3: Create `libs/eyecatchers-core/src/public/math/motion-loop.ts`** with:
```ts
/**
 * Reduced-motion-aware frame loop. Wraps `createFrameLoop`; when the user's
 * `prefers-reduced-motion` preference is set, the wrapped tick callback is
 * skipped (the host RAF still drives the wrapper so `stop()` works promptly).
 * Use this instead of `createFrameLoop` for any motion that should be silenced
 * under reduced-motion. The existing `createFrameLoop` is unchanged.
 */
import { createFrameLoop, type FrameCallback, type FrameLoop, type FrameLoopHost } from './raf.js';
import { prefersReducedMotion } from './reduced-motion.js';

export function createMotionLoop(cb: FrameCallback, host: FrameLoopHost): FrameLoop {
  return createFrameLoop((now, dtSec) => {
    if (prefersReducedMotion()) return;
    cb(now, dtSec);
  }, host);
}
```

- [ ] **Step 4: Barrel-export from `libs/eyecatchers-core/src/index.ts`** — append:
```ts
export * from './public/math/reduced-motion.js';
export * from './public/math/motion-loop.js';
```
(Match the existing `export * from './public/math/...'` style; place near the existing `raf` export.)

- [ ] **Step 5: Mirror Steps 2–4 into `design-system-core`.** Create the same two files at `libs/design-system-core/src/public/math/{reduced-motion.ts,motion-loop.ts}` (byte-identical to eyecatchers-core's copies), and add the same two barrel exports to `libs/design-system-core/src/index.ts`. Confirm pairwise identity:
```bash
diff libs/design-system-core/src/public/math/reduced-motion.ts libs/eyecatchers-core/src/public/math/reduced-motion.ts
diff libs/design-system-core/src/public/math/motion-loop.ts libs/eyecatchers-core/src/public/math/motion-loop.ts
```
Both diffs must be empty.

- [ ] **Step 6: Build both cores + regenerate api-extractor snapshots** (deliberately — new exports):
```bash
npx nx run-many -t build --projects=design-system-core,eyecatchers-core
npm run api:update    # regenerates etc/*.api.md
git diff --stat libs/design-system-core/etc libs/eyecatchers-core/etc
```
Expected: each `etc/*.api.md` shows ADDED lines for `prefersReducedMotion`, `onReducedMotionChange`, `__setReducedMotionForTests`, `createMotionLoop` — nothing removed or changed (existing exports preserved). Spot-read the diffs to confirm the surface change is exactly the additions.

- [ ] **Step 7: Confirm `api-check` now passes against the updated snapshots:**
```bash
npx nx run-many -t api-check --projects=design-system-core,eyecatchers-core
```
Expected: PASS.

- [ ] **Step 8: Write `tools/test-reduced-motion.mjs`** — a tiny no-framework test that mocks `globalThis.window.matchMedia` and asserts both primitive + loop behavior. (Imports from the BUILT eyecatchers-core dist so it tests the compiled output; alternatively imports the .ts via tsx — use built dist for portability.) Skeleton:
```js
// Test the reduced-motion primitive + motion-loop without a test framework.
// Runs against the built eyecatchers-core dist (build first).
import assert from 'node:assert';

// Mock matchMedia BEFORE importing the modules.
const listeners = new Set();
const mq = {
  matches: false,
  addEventListener: (_: string, h: any) => listeners.add(h),
  removeEventListener: (_: string, h: any) => listeners.delete(h),
};
globalThis.window = { matchMedia: () => mq };

const { prefersReducedMotion, onReducedMotionChange, __setReducedMotionForTests } =
  await import('../dist/libs/eyecatchers-core/src/public/math/reduced-motion.js');
const { createMotionLoop } = await import('../dist/libs/eyecatchers-core/src/public/math/motion-loop.js');

// 1. Default: false (matchMedia.matches=false)
__setReducedMotionForTests(undefined);
assert.strictEqual(prefersReducedMotion(), false, 'default false');

// 2. matchMedia true => true
mq.matches = true;
__setReducedMotionForTests(undefined);  // clear cache
assert.strictEqual(prefersReducedMotion(), true, 'matchMedia true reflected');

// 3. Listener updates cache
mq.matches = false;
const seen = [];
const unsub = onReducedMotionChange((r) => seen.push(r));
for (const h of listeners) h({ matches: false }); // emit
assert.deepStrictEqual(seen, [false], 'listener fired');
assert.strictEqual(prefersReducedMotion(), false, 'cache updated on listener');
unsub();
assert.strictEqual(listeners.size, 0, 'unsubscribe removed listener');

// 4. createMotionLoop skips tick when RM is active
__setReducedMotionForTests(true);
let ticks = 0;
const fakeHost = { request: (cb) => { setTimeout(() => cb(performance.now()), 0); return 1; }, cancel: () => {}, now: () => performance.now() };
const loop = createMotionLoop(() => { ticks++; }, fakeHost);
loop.start();
await new Promise((r) => setTimeout(r, 50));
loop.stop();
assert.strictEqual(ticks, 0, 'motion-loop skipped tick under RM');

// 5. createMotionLoop ticks when RM is off
__setReducedMotionForTests(false);
ticks = 0;
const loop2 = createMotionLoop(() => { ticks++; }, fakeHost);
loop2.start();
await new Promise((r) => setTimeout(r, 50));
loop2.stop();
assert.ok(ticks > 0, 'motion-loop ticks when RM off');

__setReducedMotionForTests(undefined);
console.log('reduced-motion tests: 5/5 PASS');
```
(Adjust import paths to match the actual dist output structure; the file shown above assumes the tsc dist path.)

- [ ] **Step 9: Build + run the test**
```bash
npx nx build eyecatchers-core
node tools/test-reduced-motion.mjs
```
Expected: `reduced-motion tests: 5/5 PASS` exit 0.

- [ ] **Step 10: Commit** (targeted; confirm scratch files unstaged):
```bash
git add libs/design-system-core/src/public/math/reduced-motion.ts libs/design-system-core/src/public/math/motion-loop.ts libs/design-system-core/src/index.ts libs/design-system-core/etc/design-system-core.api.md libs/eyecatchers-core/src/public/math/reduced-motion.ts libs/eyecatchers-core/src/public/math/motion-loop.ts libs/eyecatchers-core/src/index.ts libs/eyecatchers-core/etc/eyecatchers-core.api.md tools/test-reduced-motion.mjs
git status --short
git commit -m "feat(motion): central prefersReducedMotion() + RM-aware frame loop

Adds prefersReducedMotion(), onReducedMotionChange(), and createMotionLoop()
to both eyecatchers-core and design-system-core (mirroring raf.ts's existing
scope-wall duplication). Pure infra — no component changes (PR4b migrates the
15 matchMedia call sites). New exports; api-extractor snapshots updated
deliberately. 5/5 unit tests pass. Part of charter PR4a (#3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Full gate + PR

- [ ] **Step 1: Full `ci:local`**
```bash
npm run ci:local
echo "EXIT: $?"
```
Expected: EXIT 0 — `lib:conformance` + `tokens:check` (CSS+TS parity) + build + lint + typecheck + `api-check` (passes against the new snapshots) + vite:test.

- [ ] **Step 2: Push + issue + PR**
```bash
git push -u origin chore/ds-pr4a-reduced-motion-infra
gh issue create --title "PR4a: central reduced-motion primitive + RM-aware frame loop (infra)" --body "Story for PR4a of the design-system adoption charter (#3, decomposed). Adds prefersReducedMotion(), onReducedMotionChange(), createMotionLoop() to both eyecatchers-core and design-system-core (scope-wall duplication, mirroring raf.ts). No component changes — PR4b migrates the 15 matchMedia call sites. CSS @media rule deferred (parser limitation; revisit when CSS motion grows). Filed unlabeled."
```
Record issue `NN`; `gh pr create --base main` with title `feat: central prefersReducedMotion + RM-aware frame loop (charter PR4a)`, body covering What / scope-wall rationale (primitive in both cores) / deferrals (CSS rule, component migration → PR4b) / verification (`ci:local` exit 0, 5/5 unit tests, api-snapshots deliberately updated for new exports), `Closes #NN`, 🤖 footer.

- [ ] **Step 3: charter-checker** against `main...chore/ds-pr4a-reduced-motion-infra`: confirms it delivers #3's mechanism in both cores (scope-wall handled), no component migrations, no CSS @media yet (deferred with rationale), api-snapshot updates are limited to the new exports (nothing else changed), scope clean.

---

## Self-Review

**Spec coverage (charter #3, PR4a infra slice):**
- `prefersReducedMotion()` primitive cached + env-guarded + test override → Task 1 Step 2. ✓
- RM-aware frame loop (a `createMotionLoop` that skips ticks; `createFrameLoop` unchanged) → Task 1 Step 3. ✓
- Both cores (scope-wall duplication mirroring `raf.ts`) → Task 1 Steps 2–5. ✓
- Tests (no framework, mocks `matchMedia`, asserts primitive + loop) → Task 1 Steps 8–9. ✓
- Deferred + recorded: shared CSS `@media` rule (parser limitation), component migration → PR4b. ✓

**Placeholder scan:** Full file contents given for both new modules; the test skeleton specifies exact behavior (5 assertions); the commit message template is verbatim. The api-extractor snapshot diffs aren't pasted (they're regenerated outputs whose content depends on the import-rollup); Task 1 Step 6 spot-reads them as the verification.

**Type/name consistency:** Branch `chore/ds-pr4a-reduced-motion-infra` (Tasks 1, 2). `prefersReducedMotion` / `onReducedMotionChange` / `__setReducedMotionForTests` / `createMotionLoop` names consistent. The two cores' files are byte-identical (Task 1 Step 5 enforces).

**Risk:** Low. No component changes (15 components keep their working `matchMedia` — they migrate in PR4b). api-snapshot updates are limited to the new exports (the existing surface is preserved; api-check's snapshot diff is the proof). The duplicated `reduced-motion.ts` + `motion-loop.ts` between the two cores follows the established `raf.ts` pattern; future drift between them is a hand-write risk (the same risk `raf.ts` already carries; could be solved later by generating from one source like PR3b did for tokens).
