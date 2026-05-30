# PR3a — DTCG token source + compiler + byte-(modulo-format) parity gate for `tokens.css` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `design-system-css/src/tokens.css` a *generated* artifact compiled from an authored W3C DTCG source, with a `tokens:check` CI gate that fails if the generated CSS drifts from the committed one — eliminating the hand-maintained source-of-truth and enabling Figma/Tokens-Studio interop, while changing **zero** consumed bytes (parity).

**Architecture:** First sub-PR of charter PR3 (#1). Approach: a one-time **extractor** seeds the DTCG source *from* today's `tokens.css` (guaranteeing fidelity), the **compiler** (a pluggable-Writer Node CLI under `tools/`) regenerates `tokens.css` from the DTCG, and a **parity gate** proves the round-trip is identity (modulo whitespace/comments). Scope-narrowing decisions (vs the charter): (a) the DTCG source + generated output live **inside `design-system-css`** (the existing CSS-token home, `type:css`, api-extractor-exempt) — the standalone `design-system-tokens` lib + agnostic JS resolver are **PR3b**, where the TS outputs justify them; (b) the **TsWriter** and the **dark eyecatcher palette** (`PALETTE`/`MOTION`/`EASING`) reconciliation are **PR3b**; (c) `substrate.*` aesthetic extensions are deferred (no real tokens exist — `shadow` stays a standard DTCG type). PR3a is **CSS parity only**.

**Tech Stack:** Node ESM (no runtime deps; optionally a tiny DTCG-aware compile in plain TS/JS), Nx 22.7, the existing `check-css-exports` + `api-check` conventions in `design-system-css`.

**Current reality (grounded):** `libs/design-system-css/src/tokens.css` is 501 lines / **211 custom properties** in one `:root` block (lines ~26–228) plus **5 `[data-theme]` override blocks** (`neutral`, `sport`, `health`, `cancer`, `football`). Value shapes: dimension (`88px`), duration (`240ms`), number (`400`, `1.50`), color (`oklch(0.55 0.18 28)`), cubic-bezier (`cubic-bezier(.22,.61,.36,1)`), composite shadow (`0 2px 6px rgba(0,0,0,0.05), …`), rgb-triplet (`--halo: 255, 245, 220`), and **`var()` aliases** (`--grid-gutter: var(--s-6)`, `--shadow-hairline: 0 0 0 1px var(--rule)`). Section comments throughout (German/English). Consumed everywhere via `@import '@de-braighter/design-system-css/tokens.css'`.

**Parity definition (per charter): "byte-for-byte modulo formatting."** The gate compares the *semantic declaration set* — for each selector (`:root`, each `[data-theme]`), the map of `--property → value-string` — tolerating whitespace, comment, and ordering differences but failing on any value difference or missing/extra property. (`var(--x)` strings, `oklch(...)` strings, etc. compared verbatim after whitespace-collapse.)

**Repo/env:** `D:\development\projects\de-braighter\layers\design-system\`, branch off `main`. The compiler/extractor read & write files — no nx build needed for them. If an nx build is needed and errors `Cannot find module '@de-braighter/...'`, STOP + report (controller fixes symlinks). The 2 untracked scratch files (`libs/design-system-angular/tsconfig.spec.json`, `vitest.debug.config.ts`) must NEVER be committed — targeted `git add` only.

---

## File Structure

- Create: `tools/tokens-compiler/` — the Node CLI.
  - `parse-css.mjs` — parse a `tokens.css` into a normalized declaration model (used by both extractor and gate).
  - `writers/css.writer.mjs` — `CssWriter`: DTCG model → `tokens.css` text.
  - `writer.mjs` — the `Writer` interface contract (`{ id, write(model) }`) so future writers (TsWriter in PR3b) plug in.
  - `compile.mjs` — entry: read DTCG → resolve → run CssWriter → write `tokens.css`.
  - `extract.mjs` — **bootstrap**: read today's `tokens.css` → emit the DTCG source (run once to seed; kept for reproducibility).
  - `check-parity.mjs` — the gate: recompile, compare to committed `tokens.css` by normalized declaration set; exit 1 on drift.
- Create: `libs/design-system-css/src/tokens/` — the authored DTCG source.
  - `base.tokens.json` — the `:root` tokens (DTCG).
  - `themes/{neutral,sport,health,cancer,football}.tokens.json` — the per-theme override sets.
- Modify (becomes generated, committed): `libs/design-system-css/src/tokens.css` — header updated to mark it generated.
- Modify: `libs/design-system-css/project.json` — add a `tokens:check` target (and fold into the existing `api-check` or run alongside).
- Modify: `package.json` — add `tokens:build` + `tokens:check` scripts; wire `tokens:check` into `ci:local`.

---

### Task 1: Branch, the CSS parse model, and the parity gate (TDD — gate first)

Build the gate against the *current* file first, so it's proven before anything is generated.

**Files:** `tools/tokens-compiler/parse-css.mjs`, `tools/tokens-compiler/check-parity.mjs`.

- [ ] **Step 1: Branch**
```bash
cd /d/development/projects/de-braighter/layers/design-system
git checkout main && git pull --ff-only
git checkout -b chore/ds-pr3a-dtcg-tokens-parity
```

- [ ] **Step 2: Write `tools/tokens-compiler/parse-css.mjs`** — a function that parses a `tokens.css` string into a normalized model: an ordered list of `{ selector, declarations: Map<property, value> }`, where selector is `:root` or `[data-theme="X"]`, comments are stripped, and each `value` is whitespace-collapsed (collapse runs of spaces, trim). Export `parseCss(text)` and `normalize(model) -> string` (a canonical, sorted, comment-free serialization usable for diffing).
```js
// Parse a tokens.css into { selector, declarations: Map } blocks. Comments stripped,
// values whitespace-collapsed. normalize() produces a canonical string for diffing
// (selectors sorted, properties sorted within each) so formatting/comment/order
// differences are tolerated but value differences are not.
export function parseCss(text) {
  const noComments = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const blockRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = blockRe.exec(noComments))) {
    const selector = m[1].trim();
    const declarations = new Map();
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':');
      if (i === -1) continue;
      const prop = decl.slice(0, i).trim();
      const value = decl.slice(i + 1).trim().replace(/\s+/g, ' ');
      if (prop) declarations.set(prop, value);
    }
    blocks.push({ selector, declarations });
  }
  return blocks;
}

export function normalize(blocks) {
  return blocks
    .map((b) => {
      const decls = [...b.declarations.entries()].sort(([a], [c]) => a.localeCompare(c));
      return `${b.selector.replace(/\s+/g, ' ')} {\n${decls.map(([p, v]) => `  ${p}: ${v};`).join('\n')}\n}`;
    })
    .sort()
    .join('\n\n');
}
```

- [ ] **Step 3: Write `tools/tokens-compiler/check-parity.mjs`** — compares the committed `tokens.css` against a freshly compiled one. For Task 1 (before the compiler exists) it self-compares the committed file (normalize(parse(file)) === normalize(parse(file)) → trivially true) to prove the parser is stable; the real comparison (committed vs `compile()` output) is wired in Task 2 Step 4.
```js
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCss, normalize } from './parse-css.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const committedPath = join(repoRoot, 'libs/design-system-css/src/tokens.css');

export function checkParity(generatedText) {
  const committed = normalize(parseCss(readFileSync(committedPath, 'utf8')));
  const generated = normalize(parseCss(generatedText));
  if (committed === generated) return { ok: true };
  // produce a minimal first-difference report
  const a = committed.split('\n');
  const b = generated.split('\n');
  const firstDiff = a.findIndex((line, idx) => line !== b[idx]);
  return {
    ok: false,
    detail: `tokens.css parity drift at normalized line ${firstDiff}:\n  committed:  ${a[firstDiff] ?? '(none)'}\n  generated:  ${b[firstDiff] ?? '(none)'}`,
  };
}
```

- [ ] **Step 4: Stability check** — confirm the parser sees all 211 properties + 6 selectors:
```bash
node -e "import('./tools/tokens-compiler/parse-css.mjs').then(m=>{const fs=require('fs');const b=m.parseCss(fs.readFileSync('libs/design-system-css/src/tokens.css','utf8'));console.log('selectors:',b.map(x=>x.selector).join(' | '));console.log('root decls:',b.find(x=>x.selector===':root').declarations.size);console.log('total decls:',b.reduce((n,x)=>n+x.declarations.size,0));})"
```
Expected: selectors include `:root` and the 5 `[data-theme="…"]`; root decls ≈ 211 (the inventory count — if the number differs, the parser is missing something; investigate before continuing — e.g. an `@media` block or nested rule the simple block regex mishandles). Total decls = root + theme overrides. **Record the exact counts** — they are the contract Task 2 must reproduce.

- [ ] **Step 5: Commit the parse model + gate scaffolding**
```bash
git add tools/tokens-compiler/parse-css.mjs tools/tokens-compiler/check-parity.mjs
git commit -m "chore(tokens): css parse model + parity-check scaffolding

parseCss/normalize give a formatting-tolerant declaration model; checkParity
compares committed tokens.css against a generated one. Part of charter PR3a (#1)."
```
(Add the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.)

> **If Step 4 reveals the simple block-regex parser can't faithfully model `tokens.css`** (e.g. `@media`, nested selectors, or a value containing `{`/`}`): STOP and report. The parser fidelity is load-bearing for the whole PR; we'd switch to a real CSS parser (e.g. `postcss`, add as a devDep) before proceeding.

---

### Task 2: Extract DTCG, implement the compiler + CssWriter, achieve round-trip parity

**Files:** `tools/tokens-compiler/{writer.mjs,writers/css.writer.mjs,compile.mjs,extract.mjs}`, `libs/design-system-css/src/tokens/**`.

- [ ] **Step 1: Define the DTCG model + the `Writer` contract.** Write `tools/tokens-compiler/writer.mjs`:
```js
// A Writer turns the resolved token model into an output artifact.
// model = { base: TokenSet, themes: { [name]: TokenSet } } where a TokenSet is an
// ordered array of { cssProp, type, value, alias } (alias = referenced cssProp name
// when the source used {ref}/var(--x); value is the literal otherwise).
// @typedef {{ id: string, write(model): string }} Writer
export {};
```
The DTCG source uses standard `$type`s (`color`, `dimension`, `duration`, `number`, `cubicBezier`, `shadow`, `fontFamily`, `fontWeight`) plus a fallback raw `string` type for values that don't map cleanly (e.g. the `--halo` rgb-triplet, composite shadow strings) — preserving the exact value string. Aliases (`var(--s-6)`) are DTCG `{s.6}`-style references that the CssWriter re-emits as `var(--s-6)`.

- [ ] **Step 2: Write `tools/tokens-compiler/extract.mjs`** — the bootstrap: parse today's `tokens.css` (via `parse-css.mjs`), and for each block emit a DTCG JSON file. Each declaration becomes a DTCG token: infer `$type` from the value (px→dimension, ms→duration, `oklch(`/`#`→color, `cubic-bezier(`→cubicBezier, bare number→number, `var(--x)`→an alias token, else→`string`); `$value` preserves the exact value string (for alias, store the referenced name). Group tokens by the section-comment headers where feasible (else a flat group). Write `base.tokens.json` (from `:root`) and `themes/<name>.tokens.json` (from each `[data-theme]`). Run it:
```bash
node tools/tokens-compiler/extract.mjs
ls libs/design-system-css/src/tokens/ libs/design-system-css/src/tokens/themes/
```
Expected: `base.tokens.json` + 5 theme files created, together capturing all the counts recorded in Task 1 Step 4.

- [ ] **Step 3: Write `tools/tokens-compiler/writers/css.writer.mjs` + `compile.mjs`.** `CssWriter` renders `:root { … }` from the base set and `[data-theme="<name>"] { … }` from each theme set, emitting `--<prop>: <value>;` (alias tokens → `var(--<ref>)`). `compile.mjs` reads the DTCG json, builds the model, runs CssWriter, and (with `--write`) overwrites `libs/design-system-css/src/tokens.css` (prepending a "GENERATED — edit src/tokens/*.json, run npm run tokens:build" header), or (default) prints to stdout.
```bash
node tools/tokens-compiler/compile.mjs > /tmp/generated-tokens.css
```

- [ ] **Step 4: Wire the real parity comparison + iterate to green.** Update `check-parity.mjs`'s CLI tail to compile and compare:
```js
// appended to check-parity.mjs
import { compile } from './compile.mjs'; // compile() returns the generated CSS string
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = checkParity(compile());
  if (!res.ok) { console.error(res.detail); process.exit(1); }
  console.log('tokens.css parity: generated matches committed (modulo formatting).');
}
```
Then:
```bash
node tools/tokens-compiler/check-parity.mjs
```
Expected eventually: PASS. **Iterate:** the first run will likely show value mismatches (type-inference or alias edge cases — e.g. composite shadows, the rgb-triplet `--halo`, multi-value `transition` shorthands). For each: fix `extract.mjs`'s type inference and/or `css.writer.mjs`'s rendering so the round-trip is exact, re-run `extract` + `check-parity`, until the normalized declaration sets are identical. Do NOT edit `tokens.css` by hand to force a match — the DTCG must reproduce it.

- [ ] **Step 5: Regenerate `tokens.css` from DTCG (now provably identical) + commit everything.**
```bash
node tools/tokens-compiler/compile.mjs --write
node tools/tokens-compiler/check-parity.mjs   # PASS
git diff --stat libs/design-system-css/src/tokens.css   # only the generated-header comment changes semantically
```
Confirm via the gate that the rewritten `tokens.css` still parity-matches (it must, it's the compiler output). Then:
```bash
git add tools/tokens-compiler libs/design-system-css/src/tokens libs/design-system-css/src/tokens.css
git status --short
git commit -m "feat(tokens): author tokens.css in DTCG; compiler + round-trip parity

Bootstrap-extracted the DTCG source (base + 5 theme sets) from tokens.css; the
tokens-compiler (pluggable Writer + CssWriter) regenerates tokens.css and the
parity gate proves the round-trip is identity (modulo formatting). tokens.css is
now a generated artifact. Part of charter PR3a (#1)."
```
(Add the Co-Authored-By trailer. Confirm the 2 scratch files are not staged.)

---

### Task 3: Wire the gate into CI + mark the source-of-truth

**Files:** `package.json`, `libs/design-system-css/project.json`.

- [ ] **Step 1: Add scripts to `package.json`:**
```json
    "tokens:build": "node tools/tokens-compiler/compile.mjs --write",
    "tokens:check": "node tools/tokens-compiler/check-parity.mjs",
```
And insert `tokens:check` into `ci:local` right after the conformance check:
```json
    "ci:local": "npm run lib:conformance && npm run tokens:check && nx run-many -t build lint typecheck api-check && nx run-many -t vite:test --parallel=1",
```

- [ ] **Step 2: Add a `tokens-check` target to `libs/design-system-css/project.json`** (so `nx`-aware tooling sees it too), running the same script:
```json
"tokens-check": {
  "executor": "nx:run-commands",
  "options": { "command": "node tools/tokens-compiler/check-parity.mjs" }
}
```

- [ ] **Step 3: RED — prove the gate catches drift.** Temporarily change one DTCG value (e.g. in `base.tokens.json`, change `--t-body` from `14px` to `15px`), run `npm run tokens:check` → expect FAIL naming the drift. Revert the change (`git checkout -- libs/design-system-css/src/tokens/base.tokens.json`), re-run → PASS.

- [ ] **Step 4: Update the `tokens.css` header note** (in the DTCG → ensure the compiler emits it; or confirm Task 2 Step 3's header is present) so future editors know to edit `src/tokens/*.json` and run `npm run tokens:build`, not the CSS directly.

- [ ] **Step 5: Commit**
```bash
git add package.json libs/design-system-css/project.json
git commit -m "chore(tokens): wire tokens:check into ci:local + tokens-check target

Part of charter PR3a (#1)."
```
(Co-Authored-By trailer.)

---

### Task 4: Full gate + PR

- [ ] **Step 1: Full local CI gate**
```bash
npm run ci:local
echo "EXIT: $?"
```
Expected: EXIT 0 — `lib:conformance` + **`tokens:check`** + build + lint + typecheck + api-check + vite:test all green. (Crucially, the design-system-css build still publishes the same `tokens.css` bytes-modulo-format; nothing downstream changed.)

- [ ] **Step 2: Push + issue + PR**
```bash
git push -u origin chore/ds-pr3a-dtcg-tokens-parity
gh issue create --title "PR3a: DTCG token source + compiler + tokens.css parity gate" --body "Story for PR3a of the design-system adoption charter (#1). Authors tokens.css (211 props + 5 data-theme blocks) in W3C DTCG, compiled by a pluggable-Writer Node compiler, behind a tokens:check parity gate (round-trip identity, modulo formatting). DTCG source + generated tokens.css live in design-system-css for this slice; the standalone design-system-tokens lib + JS resolver + TsWriter + dark-palette reconciliation are PR3b; substrate.* extensions deferred (no real tokens). Filed unlabeled (no type/story taxonomy)."
```
Record the issue `NN`, then `gh pr create --base main` with title `feat: DTCG token source + compiler + tokens.css parity gate (charter PR3a)`, body summarizing What / parity-by-construction (extractor→DTCG→compiler→round-trip gate) / scope-narrowing (CSS only; PR3b for TS + tokens lib + dark palette; substrate.* deferred) / verification (`ci:local` exit 0, parity red-green), `Closes #NN`, and the 🤖 footer.

- [ ] **Step 3: charter-checker** against `main...chore/ds-pr3a-dtcg-tokens-parity`, pointed at the charter, confirming: delivers #1's parity-gated DTCG migration; tokens.css bytes unchanged (modulo format); NO substrate.* extensions added; NO new lib yet (deferred to PR3b — note this deviation is recorded in the plan); consumers unchanged.

---

## Self-Review

**Spec coverage (charter #1, CSS-parity slice):**
- DTCG source authored from tokens.css → Task 2 (extractor). ✓
- Pluggable Writer + CssWriter compiler → Task 2 Steps 1, 3. ✓
- Committed generated tokens.css → Task 2 Step 5. ✓
- `tokens:check` parity gate in `ci:local`, fails on drift → Task 1 + Task 3 (with red-green). ✓
- "byte-for-byte modulo formatting" → the normalized declaration-set comparison. ✓
- Deferred (recorded): TsWriter, design-system-tokens lib + JS resolver, dark-palette reconciliation → PR3b; substrate.* → later. ✓

**Placeholder scan:** The parser, gate, and writer *contracts* are given in full; the extractor + CssWriter bodies are specified by behavior (value-type inference + alias handling) rather than pasted in full because they depend on the exact value shapes — Task 2 Step 4 makes correctness *verifiable* (round-trip parity) rather than asserted. This is the right shape for a parity migration: the gate is the spec. No TBD/TODO.

**Type/name consistency:** Branch `chore/ds-pr3a-dtcg-tokens-parity` (Tasks 1, 4). `tokens:check` / `tokens:build` consistent (Tasks 2–4). `parse-css.mjs` / `compile.mjs` / `check-parity.mjs` consistent.

**Risk:** (1) **Parser fidelity** — Task 1 Step 4 gate-checks the count before any migration; if the simple regex can't model the file, we switch to postcss (flagged). (2) **Round-trip edge cases** (composite shadows, rgb-triplet, aliases) — Task 2 Step 4 iterates against the gate until exact; the gate makes drift impossible to merge. (3) **No consumer impact** — tokens.css stays at the same published path with the same values; consumers `@import` unchanged.
