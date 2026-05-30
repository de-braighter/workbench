# PR3b — Reconcile the dark eyecatcher palette into DTCG (TsWriter) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dark eyecatcher palette (`PALETTE` / `MOTION` / `EASING`) — today byte-identically duplicated in `design-system-core` and `eyecatchers-core`, unconsumed — single-sourced in DTCG and emitted into both libs by a `TsWriter`, so the two copies are generated-from-one-source (drift-proof) rather than hand-maintained. Public API and api-extractor snapshots unchanged (values preserved).

**Architecture:** Second sub-PR of charter PR3 (#1 + #6 TsWriter). Realizes the user's "reconcile the dark palette into DTCG" decision, **minimally**: one DTCG source → `TsWriter` generates a **const-only** module into each lib; the existing `color.ts`/`motion.ts`/`easing.ts` become thin hand-written wrappers that re-export the generated const and keep their types + the `toCssBezier` function. The nx scope wall (`scope:eyecatchers` may only depend on `scope:eyecatchers`) forbids a shared tokens lib, so dedup is **by shared source-of-truth, not shared module** — no cross-lib import, **no new lib, no JS resolver** (deferred; unconsumed). `substrate.*` extensions remain deferred.

**Tech Stack:** Node ESM, the existing `tools/tokens-compiler/` (extends PR3a's Writer architecture with a `TsWriter`), Nx 22.7.

**Current reality (grounded):** `libs/{design-system-core,eyecatchers-core}/src/public/tokens/{color,motion,easing}.ts` are **byte-identical** across the two libs and exported via each lib's public barrel but **imported by nothing** (eyecatcher components define local palettes inline). Each file mixes data + code:
- `color.ts`: `export const PALETTE = {bg0:'#07070b', …9 keys} as const;` + `export type PaletteKey = keyof typeof PALETTE;`
- `motion.ts`: `export const MOTION = {quick:120, base:220, slow:480, ambient:8000} as const;` (with an inline comment) + `export type MotionDurationKey`.
- `easing.ts`: `export const EASING = {out:[…], inOut:[…], spring:[…], linear:[…]} as const;` (per-key JSDoc) + `export type EasingKey`, `export type Bezier`, and `export const toCssBezier = (e: Bezier) => \`cubic-bezier(...)\``.

**Approach: generated-const + wrapper split.**
- DTCG source carries the **values** (+ per-key `$description` for the doc comments).
- `TsWriter` emits `<set>.generated.ts` containing **only** the `export const X = {…} as const;` (with doc comments from `$description`). Generic — no bespoke code in the writer.
- The existing `<set>.ts` is rewritten to a thin wrapper: `export { X } from './<set>.generated.js';` + the existing type aliases + (easing only) `Bezier` + `toCssBezier`. Hand-written, stays put.
- A gate regenerates the `.generated.ts` files and fails if they drift from the DTCG. **Values preserved ⇒ the public surface is unchanged ⇒ api-extractor `.api.md` snapshots do not change** (verified by `api-check` staying green).

**Repo/env:** `D:\development\projects\de-braighter\layers\design-system\`, branch off `main` (has PR3a). The generator/gate read+write files (no nx build); `api-check` (Task 1 verification) needs the libs built — if it errors `Cannot find module '@de-braighter/...'`, STOP + report (controller fixes symlinks). The 2 untracked scratch files must NEVER be committed — targeted `git add` only.

---

## File Structure
- Create: `libs/design-system-css/src/tokens/dark/{palette,motion,easing}.tokens.json` — the DTCG dark source (values + `$description`s). (Lives in design-system-css alongside PR3a's DTCG; it's data the compiler reads, not an import — no boundary issue.)
- Create: `tools/tokens-compiler/writers/ts.writer.mjs` — `TsWriter` (DTCG set → const-only `.ts` text).
- Create (generated, committed, ×2 libs): `libs/design-system-core/src/public/tokens/{color,motion,easing}.generated.ts` and the same under `libs/eyecatchers-core/src/public/tokens/`.
- Modify (×2 libs): `libs/{design-system-core,eyecatchers-core}/src/public/tokens/{color,motion,easing}.ts` → thin wrappers re-exporting the generated const + keeping types/function.
- Create: `tools/tokens-compiler/build-ts.mjs` + `check-ts.mjs` — emit + parity-gate the generated TS.
- Modify: `package.json` — `tokens:build`/`tokens:check` also drive the TS; `ci:local` already runs `tokens:check`.

---

### Task 1: DTCG dark source + TsWriter + generated consts + wrappers + parity

**Files:** as above.

- [ ] **Step 1: Branch**
```bash
cd /d/development/projects/de-braighter/layers/design-system
git checkout main && git pull --ff-only
git checkout -b chore/ds-pr3b-dark-palette-dtcg
```

- [ ] **Step 2: Author the DTCG dark source** at `libs/design-system-css/src/tokens/dark/`. Transcribe the current values EXACTLY (this is the one-time seed; the gate will prove fidelity):
  - `palette.tokens.json` — group with 9 color tokens (`bg0`…`lime`), `$type: "color"`, `$value` the exact hex, `$description` from the file's header where useful.
  - `motion.tokens.json` — 4 `duration`-ish tokens as `number` (`quick:120`, `base:220`, `slow:480`, `ambient:8000`); put the "for slow ambient animations…" note in `ambient`'s `$description`.
  - `easing.tokens.json` — 4 tokens, `$type: "cubicBezier"`, `$value` the 4-number arrays; per-key `$description` (the JSDoc lines: "Snappy out…", "Standard in/out…", "Spring-ish overshoot…", "Linear…").

- [ ] **Step 3: Write `tools/tokens-compiler/writers/ts.writer.mjs`** — `TsWriter` (`id: 'ts'`). Given a token set + the const name (`PALETTE`/`MOTION`/`EASING`) + a file doc-comment, emit a `.generated.ts` string: the leading `/** … */` doc comment, then `export const <NAME> = {` with one entry per token (`  <key>: <value>,` — strings quoted, numbers bare, bezier arrays as `[a, b, c, d] as const` to match easing's current shape; per-key `$description` as a preceding `/** … */` or trailing `//` comment matching the original) then `} as const;`. The writer emits ONLY the const (+ its doc comments). It does NOT emit types or functions.

- [ ] **Step 4: Write `tools/tokens-compiler/build-ts.mjs`** — reads the DTCG dark source, runs `TsWriter` per set, and writes the generated const module into BOTH libs:
  - `libs/design-system-core/src/public/tokens/<set>.generated.ts`
  - `libs/eyecatchers-core/src/public/tokens/<set>.generated.ts`
  (where `<set>` maps palette→color, motion→motion, easing→easing). With `--write` it writes; else prints.

- [ ] **Step 5: Rewrite the 6 wrapper files.** For each of `{color,motion,easing}.ts` in BOTH libs, replace the inline `export const X = {…}` with a re-export from the generated module, keeping everything else:
  - `color.ts`: `export { PALETTE } from './color.generated.js';\nexport type PaletteKey = keyof typeof PALETTE;` (import PALETTE for the keyof — or `import { PALETTE } from './color.generated.js'; export { PALETTE }; export type PaletteKey = keyof typeof PALETTE;`). Keep the file's doc comment or move it to the generated file.
  - `motion.ts`: re-export `MOTION` + keep `export type MotionDurationKey`.
  - `easing.ts`: re-export `EASING` + keep `export type EasingKey`, `export type Bezier = readonly [number, number, number, number];`, and `export const toCssBezier = (e: Bezier): string => \`cubic-bezier(${e[0]}, ${e[1]}, ${e[2]}, ${e[3]})\`;`.
  Ensure the wrappers compile (the `keyof typeof X` needs `X` in scope — import it).

- [ ] **Step 6: Generate + verify the consts are byte-faithful.**
```bash
node tools/tokens-compiler/build-ts.mjs --write
git diff --stat libs/design-system-core/src/public/tokens libs/eyecatchers-core/src/public/tokens
```
The generated `.generated.ts` should hold exactly the consts that were inline before. Confirm the two libs' generated files are identical: `diff libs/design-system-core/src/public/tokens/color.generated.ts libs/eyecatchers-core/src/public/tokens/color.generated.ts` (and motion, easing) → no diff.

- [ ] **Step 7: Write `tools/tokens-compiler/check-ts.mjs`** — the gate: regenerate each `.generated.ts` in-memory from the DTCG and compare (whitespace-tolerant) to the committed `.generated.ts` in both libs; exit 1 on any drift. (Guard `process.argv[1]` like PR3a's scripts.)
```bash
node tools/tokens-compiler/check-ts.mjs   # PASS
```

- [ ] **Step 8: Build both libs + confirm api-extractor snapshots UNCHANGED.** This is the key safety check — values preserved means the public surface is identical:
```bash
npx nx run-many -t build --projects=design-system-core,eyecatchers-core
npx nx run-many -t api-check --projects=design-system-core,eyecatchers-core
git status --short libs/design-system-core/etc libs/eyecatchers-core/etc
```
Expected: `api-check` PASSES and the `etc/*.api.md` snapshots are UNCHANGED (no diff). If a snapshot changed, the wrapper altered the public surface — fix the wrapper so the exported symbols/types are identical to before (do NOT regenerate the snapshot to hide it). If build errors `Cannot find module '@de-braighter/...'`, STOP + report.

- [ ] **Step 9: Commit**
```bash
git add tools/tokens-compiler libs/design-system-css/src/tokens/dark libs/design-system-core/src/public/tokens libs/eyecatchers-core/src/public/tokens
git status --short
git commit -m "feat(tokens): single-source the dark eyecatcher palette via DTCG + TsWriter

PALETTE/MOTION/EASING authored once in DTCG; TsWriter generates a const-only
module into design-system-core AND eyecatchers-core (dedup-by-generation — the
scope wall forbids a shared module). The .ts files become thin wrappers
re-exporting the generated const + keeping their types/toCssBezier. Values
preserved (api-check snapshots unchanged). Part of charter PR3b (#1/#6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
(Confirm scratch files not staged.)

---

### Task 2: Wire the TS gate into `tokens:check` + red-green

**Files:** `package.json` (+ `tools/tokens-compiler/check-parity.mjs` if folding).

- [ ] **Step 1: Fold the TS gate into the token gate.** Make `tokens:check` run BOTH the CSS parity and the TS parity. Simplest: change the `tokens:check` script to run both checkers:
```json
    "tokens:check": "node tools/tokens-compiler/check-parity.mjs && node tools/tokens-compiler/check-ts.mjs",
    "tokens:build": "node tools/tokens-compiler/compile.mjs --write && node tools/tokens-compiler/build-ts.mjs --write",
```
(`ci:local` already calls `npm run tokens:check`, so the TS gate is now in CI.)

- [ ] **Step 2: RED-GREEN.** Edit one DTCG dark value (e.g. `palette.tokens.json` `violet` `#8b5cf6`→`#000000`), run `npm run tokens:check` → expect FAIL from `check-ts.mjs` (the committed `.generated.ts` no longer matches). Revert, re-run → PASS. Also confirm `check-ts` would catch a hand-edit to a `.generated.ts` (edit one, run, see fail, revert).

- [ ] **Step 3: Commit**
```bash
git add package.json
git commit -m "chore(tokens): run the dark-palette TS parity gate in tokens:check

Part of charter PR3b (#1/#6).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Full gate + PR

- [ ] **Step 1: Full local CI gate**
```bash
npm run ci:local
echo "EXIT: $?"
```
Expected: EXIT 0 — `tokens:check` (CSS + TS parity) + conformance + build + lint + typecheck + api-check (snapshots unchanged) + vite:test all green.

- [ ] **Step 2: Push + issue + PR**
```bash
git push -u origin chore/ds-pr3b-dark-palette-dtcg
gh issue create --title "PR3b: reconcile dark eyecatcher palette into DTCG (TsWriter)" --body "Story for PR3b of the design-system adoption charter (#1/#6). Single-sources the duplicated, unconsumed dark palette (PALETTE/MOTION/EASING) in DTCG; TsWriter generates a const-only module into both design-system-core and eyecatchers-core (dedup-by-generation — the nx scope wall forbids a shared module); the .ts files become thin wrappers keeping types + toCssBezier. Values preserved (api-check snapshots unchanged). No new lib / JS resolver (deferred, unconsumed); substrate.* still deferred. Filed unlabeled."
```
Record issue `NN`; `gh pr create --base main` with title `feat: reconcile dark eyecatcher palette into DTCG via TsWriter (charter PR3b)`, body covering What / dedup-by-generation (scope-wall rationale) / values-preserved (api-check snapshots unchanged) / no-new-lib-or-resolver deferral / verification (`ci:local` exit 0, TS red-green), `Closes #NN`, 🤖 footer.

- [ ] **Step 3: charter-checker** against `main...chore/ds-pr3b-dark-palette-dtcg`: confirms it single-sources the dark palette via DTCG+TsWriter, generated into both libs (no cross-lib import), api-extractor snapshots unchanged, NO new design-system-tokens lib / NO JS resolver, NO substrate.* types.

---

## Self-Review

**Spec coverage (PR3b scope decision):**
- Dark palette authored once in DTCG → Task 1 Step 2. ✓
- `TsWriter` (#6) → Task 1 Step 3. ✓
- Generated into BOTH libs (dedup-by-generation, no cross-lib import) → Task 1 Step 4. ✓
- Wrappers keep public API (types + `toCssBezier`) → Task 1 Step 5; api-check snapshots unchanged → Task 1 Step 8. ✓
- TS parity gate in `tokens:check`/`ci:local` + red-green → Task 2. ✓
- NO new lib / NO JS resolver / NO `substrate.*` (deferred) → nothing in the plan creates them. ✓

**Placeholder scan:** The TsWriter + gate contracts are specified by behavior with the exact target file shapes given (the current const definitions are transcribed in the grounding); correctness is verified by TS parity + api-check-unchanged, not asserted. No TBD/TODO.

**Type/name consistency:** Branch `chore/ds-pr3b-dark-palette-dtcg` (Tasks 1, 3). `.generated.ts` naming consistent. `tokens:check` extended (Task 2) — consistent with PR3a's gate. The 6 wrapper files (3 sets × 2 libs) consistent throughout.

**Risk:** Low. Values preserved ⇒ no public-API change (api-check is the proof). The one thing to get right is the wrapper re-exports producing an identical public surface (Task 1 Step 8 gate). The palette is unconsumed, so no runtime consumer can break.
