# Skin System Coherence (ADR-234) — E1–E4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the de Braighter skin system coherent per ADR-234 — ship a real `:root` token floor + a skin-lint guard, move skins to `[data-skin="X"]` subtree overlays, define a pack token contract, and reconcile the kids-football `--cg-*` deviation onto it — so kids-football is themed by the *published* Club Grass skin (accent renders **green, not blue**) instead of a disconnected literal projection.

**Architecture:** Four sequenced PRs across three repos. **E1** (`layers/design-system`, `design-system-css`) adds the `--color-*`/`--tone-*` semantic floor at the token-generator source and ships a vitest skin-lint. **E2** (`layers/design-system`, `design-system-css` + `-core`) rewrites the skin files `:root{}` → `[data-skin="X"]{}` and rewrites `SkinApplier` to load-once + flip `document.documentElement.dataset.skin` (never swap the global `<link>`). **E3** (`domains/exercir`) adds a global, `[data-skin]`-scoped `--kf-*` pack-extension partial + loads the published skin + marks the kids-football subtree with `data-skin="club-grass"`. **E4** (`domains/exercir`) migrates every `--cg-*` site onto `var(--color-*)`/`var(--tone-*)`/`var(--kf-*)`, retires the `:host` projection + parity spec, and browser-verifies green. Each design-system PR publishes a package minor and bumps exercir's pin.

**Out of scope (explicitly excluded):** **Piece B** — the standalone deployable kids-football app + its Docker demo + removing kids-football from the shared `pack-football-visual-editor` host. This plan stops at E4 (kids-football themed by the published skin, transitionally inside the shared host). Piece B is a separate spec + plan.

**Tech Stack:** DTCG JSON token sources → `tools/tokens-compiler/compile.mjs` (Node ESM) → `tokens.css`; vitest (node + jsdom envs); Nx 22; Angular 21 standalone + signals + OnPush; `@microsoft/api-extractor` public-API gate on `design-system-core`; published `@de-braighter/design-system-{css,core,angular}` packages consumed by exercir via GitHub Packages.

---

## Cross-cutting conventions (READ FIRST — apply to every slice)

These are non-negotiable for every slice. Re-read them before each PR.

### Worktree-only git, always off `origin/main`
- The local sibling clones can be **stale** — at plan time `domains/exercir` was **6 commits behind `origin/main`**. **Never edit or branch from the live clone.** For each slice:
  ```bash
  # design-system slices (run from the cluster root D:/development/projects/de-braighter):
  git -C layers/design-system fetch origin
  git -C layers/design-system worktree add ../../design-system-wt-<slug> -b <branch> origin/main
  # exercir slices:
  git -C domains/exercir fetch origin
  git -C domains/exercir worktree add ../../exercir-wt-<slug> -b <branch> origin/main
  ```
  (`../../<name>` resolves to `D:/development/projects/<name>` — a sibling of the cluster root, short path to avoid Windows MAX_PATH on `node_modules`.) ALL git ops (add/commit/push) happen **in the worktree**.
- Cleanup after merge: `git -C <repo> worktree remove --force ../../<wt>`; if Nx `.db` locks leave the dir, `git -C <repo> worktree prune` then `rm -rf` it.

### Gates without masking pipes
- A pipe returns the **pipe's** exit code, not the command's. Run gates as `npm run ci:local > /tmp/ci.log 2>&1; echo "EXIT=$?"` and READ the log. Never `… | tail`.
- `@nx/angular:unit-test` / `@angular/build:unit-test` reject spec filters (`--include`, positional) — run the **full project** with `NX_DAEMON=false npx nx test <project>` (the env avoids daemon-lock against the running main-clone dev servers).
- Prod build enforces a **per-component-style budget (6 kB warn / 8 kB ERROR)** in `pack-football-visual-editor`. Keep migrated component inline styles under 8 kB.
- design-system: build deps topologically first (`npx nx run-many -t build`) — cross-lib imports resolve via hand-wired symlinks that need each dep's `dist/` (see `layers/design-system/CLAUDE.md`).

### Per-slice process (the full ritual)
For **each** of E1–E4:
1. `superpowers:subagent-driven-development` on a fresh worktree (fresh subagent per task; two-stage review — spec + code-quality — on substantive tasks).
2. Create the `type/story` GitHub issue up front; the PR body carries `Closes #NN` + `Producer:` + `Effort:` + (where defensible) `Effect:` lines.
3. **Open the PR before the verifier wave.** Run the wave read-only on the worktree:
   - **design-system PRs:** `reviewer` + `qa-engineer` + `charter-checker` (+ the **api-extractor gate** check for any `-core` public-API change), all `isolation: "worktree"`, in parallel.
   - **exercir PRs:** `reviewer` + `qa-engineer` + `exercir-charter-checker` + `a11y-pro` (E4 changes visible UI tokens — focus rings, contrast — so a11y-pro is mandatory there).
4. **PUSH the branch FIRST**, then the devloop twin ritual from `domains/devloop`: `drain de-braighter/<repo>#NN` → write wave findings to a temp JSON → `post-findings de-braighter/<repo>#NN findings.json` (PR must be pushed or paths 422). Fix blockers.
5. Squash-merge. Post-merge from `domains/devloop`: `backfill de-braighter/<repo>` → `reviews` → `resolve-findings` → `reconcile de-braighter/<repo>#NN`.
6. **design-system PRs additionally:** publish the package minor (`npm run publish:libs` from `layers/design-system` — needs the `@de-braighter` `.npmrc`/`GITHUB_TOKEN`; `guard-version` blocks re-publishing an existing version, so bump `package.json` `version` IN the PR), then in the NEXT exercir slice bump exercir's pin to the new range.
7. Update memory (`skin-system-concept-adr234.md` progress + the MEMORY.md one-liner) after each merge.

### The `--cg-*` → token mapping (authoritative — used in E3 + E4)
The published Club Grass skin covers only the **colour subset**; tones cover danger/amber; everything else is the `--kf-*` pack-extension.

| `--cg-*` (old) | → target | family | note |
|---|---|---|---|
| `--cg-paper` | `var(--color-bg)` | color (skin) | page bg / warm chalk |
| `--cg-card` | `var(--color-bg-raised)` | color (skin) | card / panel |
| `--cg-ink` | `var(--color-ink-strong)` | color (skin) | near-black text |
| `--cg-muted` | `var(--color-ink-muted)` | color (skin) | secondary text |
| `--cg-hairline` | `var(--color-border)` | color (skin) | hairline divider |
| `--cg-input-border` | `var(--color-border-strong)` | color (skin) | input border |
| `--cg-accent` | `var(--color-accent)` | color (skin) | **grass green** |
| `--cg-accent-text` | `var(--color-accent-on)` | color (skin) | text on accent |
| `--cg-danger` | `var(--tone-risk)` | **tone (skin)** | #B3402E — already in the skin as `--tone-risk` |
| `--cg-amber` | `var(--tone-warn)` | **tone (skin)** | #E8A93C — already in the skin as `--tone-warn` |
| `--cg-font-display` | `var(--kf-font-display)` | kf (pack) | Archivo Black |
| `--cg-font-body` | `var(--kf-font-body)` | kf (pack) | Archivo |
| `--cg-btn-height` | `var(--kf-btn-height)` | kf (pack) | 42px |
| `--cg-btn-radius` | `var(--kf-btn-radius)` | kf (pack) | 10px |
| `--cg-card-radius` | `var(--kf-card-radius)` | kf (pack) | 14px |
| `--cg-input-height` | `var(--kf-input-height)` | kf (pack) | 40px |
| `--cg-input-radius` | `var(--kf-input-radius)` | kf (pack) | 9px |
| `--cg-avatar-size` | `var(--kf-avatar-size)` | kf (pack) | 38px |
| `--cg-nav-height` | `var(--kf-nav-height)` | kf (pack) | 56px |
| `--cg-focus-ring` | `var(--kf-focus-ring)` | kf (pack) | green focus shadow |
| `--cg-absent` | `var(--kf-absent)` | kf (pack) | #C25441 attendance "absent" (added in slice 8) |

> **Resolved decisions baked into this table** (refinements within ADR-234's locked decisions, not re-litigations):
> 1. **danger/amber map to the existing `--tone-risk`/`--tone-warn`** (which the club-grass skin already defines at exactly #B3402E / #E8A93C) — NOT to new `--kf-*` or a floor promotion. This consumes the semantic tone contract (ADR-234 D3) and needs **no floor-promotion** (so no `≥2-pack` audit is triggered).
> 2. **Floor default palette = a neutral light "system default"** (see E1 Task 1). ADR-234 D1 says "the cyan-dark / system-default palette," but no `skin-cyan-dark.css` exists (cyan/violet/mint are unbuilt scaffolds). The floor therefore ships concrete neutral-light defaults (promoting the football theme's resolved semantic values, plus skin-convention defaults for the `bg/border/ink-strong/tone-*` names). Every real consumer overrides the floor via a skin or its own `:root`, so the default only shows on un-skinned surfaces — it is a safety net, not a brand statement.
> 3. **`--cg-*` definition set must be re-derived off `origin/main` at E4 execution** — the local clone is 6 commits behind and is missing post-slice-2 additions (e.g. `--cg-absent`). Treat this table as the mapping *rules*; re-grep the authoritative site list on the worktree.

---

## E1 — Real `:root` floor + skin-lint (`design-system-css`)

**Repo:** `layers/design-system`. **Branch:** `feat/skin-floor-and-lint`. **Worktree:** `../../design-system-wt-skin-floor`.

**Outcome:** `tokens.css` `:root` defines the complete `--color-*` + `--tone-*` semantic contract with neutral-light defaults; a vitest `skin-lint` asserts every `skin-*.css` overrides only floor names. **No behaviour change** (skins still target `:root` in this slice — E2 moves them). Publish `design-system-css` minor → **1.5.0**.

### File structure
- **Modify:** `libs/design-system-css/src/tokens/base.tokens.json` — add the 34 floor tokens.
- **Regenerate (do not hand-edit):** `libs/design-system-css/src/tokens.css` (+ any generated TS tokens under `libs/design-system-css/src/`) via `npm run tokens:build`.
- **Create:** `libs/design-system-css/src/skins/skin-lint.spec.ts` — the lint.
- **Create:** `libs/design-system-css/vitest.config.ts` — node-env vitest (mirror `design-system-core/vitest.config.ts`).
- **Modify:** `libs/design-system-css/project.json` — add a `vite:test` target.
- **Modify:** `libs/design-system-css/package.json` — bump `version` 1.4.0 → 1.5.0.

### Task 1: Add the `--color-*`/`--tone-*` floor to the token source

**Files:** Modify `libs/design-system-css/src/tokens/base.tokens.json`

Context: the generator reads `base.tokens.json` → `:root{}`. DTCG `"$value": "{foo}"` emits `var(--foo)`; a literal emits verbatim. The floor must be the **union** of every `--color-*`/`--tone-*` name any skin (club-grass, warmlight-fcl) or `[data-theme]` block uses, so skin-lint passes and football keeps working.

- [ ] **Step 1: Add the floor token block** to `base.tokens.json` (insert before the final `}`, after `db-pitch-chip-text`; add a comma to the preceding entry). JSON key order does not affect CSS resolution.

```json
  "color-bg":            { "$type": "color",  "$value": "oklch(0.97 0.005 250)" },
  "color-bg-raised":     { "$type": "color",  "$value": "oklch(0.99 0.004 250)" },
  "color-bg-sunken":     { "$type": "color",  "$value": "oklch(0.94 0.010 250)" },
  "color-paper":         { "$type": "color",  "$value": "oklch(0.99 0.003 250)" },
  "color-paper-2":       { "$type": "color",  "$value": "oklch(0.94 0.010 250)" },
  "color-paper-3":       { "$type": "color",  "$value": "oklch(0.99 0.004 250)" },
  "color-paper-sunk":    { "$type": "color",  "$value": "oklch(0.94 0.010 250)" },
  "color-border":        { "$type": "color",  "$value": "oklch(0.88 0.012 260)" },
  "color-border-strong": { "$type": "color",  "$value": "oklch(0.78 0.016 260)" },
  "color-hair":          { "$type": "color",  "$value": "oklch(0.88 0.012 260)" },
  "color-hair-strong":   { "$type": "color",  "$value": "oklch(0.78 0.016 260)" },
  "color-ink-strong":    { "$type": "color",  "$value": "oklch(0.18 0.020 260)" },
  "color-ink":           { "$type": "color",  "$value": "oklch(0.32 0.018 260)" },
  "color-ink-muted":     { "$type": "color",  "$value": "oklch(0.50 0.014 260)" },
  "color-ink-2":         { "$type": "color",  "$value": "oklch(0.32 0.018 260)" },
  "color-ink-3":         { "$type": "color",  "$value": "oklch(0.50 0.014 260)" },
  "color-ink-4":         { "$type": "color",  "$value": "oklch(0.70 0.010 260)" },
  "color-accent":        { "$type": "color",  "$value": "oklch(0.45 0.13 250)" },
  "color-accent-on":     { "$type": "color",  "$value": "oklch(0.99 0.003 250)" },
  "color-accent-ink":    { "$type": "color",  "$value": "oklch(0.36 0.10 25)" },
  "color-accent-soft":   { "$type": "color",  "$value": "oklch(0.92 0.04 25)" },
  "color-ok":            { "$type": "color",  "$value": "oklch(0.52 0.09 145)" },
  "color-ok-soft":       { "$type": "color",  "$value": "oklch(0.93 0.04 145)" },
  "color-warn":          { "$type": "color",  "$value": "oklch(0.62 0.10 70)" },
  "color-warn-soft":     { "$type": "color",  "$value": "oklch(0.93 0.05 75)" },
  "color-risk":          { "$type": "color",  "$value": "oklch(0.50 0.13 30)" },
  "color-risk-soft":     { "$type": "color",  "$value": "oklch(0.93 0.05 30)" },
  "color-rest":          { "$type": "color",  "$value": "oklch(0.55 0.05 245)" },
  "color-rest-soft":     { "$type": "color",  "$value": "oklch(0.93 0.025 245)" },
  "tone-accent":         { "$type": "string", "$value": "{color-accent}" },
  "tone-neutral":        { "$type": "string", "$value": "{color-ink-muted}" },
  "tone-ok":             { "$type": "color",  "$value": "oklch(0.52 0.09 145)" },
  "tone-warn":           { "$type": "color",  "$value": "oklch(0.62 0.10 70)" },
  "tone-risk":           { "$type": "color",  "$value": "oklch(0.50 0.13 30)" },
  "tone-rest":           { "$type": "color",  "$value": "oklch(0.55 0.05 245)" }
```

- [ ] **Step 2: Validate the JSON parses** — `node -e "JSON.parse(require('fs').readFileSync('libs/design-system-css/src/tokens/base.tokens.json','utf8')); console.log('ok')"`. Expected: `ok`.

- [ ] **Step 3: Commit** — `git add libs/design-system-css/src/tokens/base.tokens.json && git commit -m "feat(design-system-css): add --color-*/--tone-* semantic floor to base tokens (ADR-234 D1)"`

### Task 2: Regenerate `tokens.css` from source

**Files:** Regenerate `libs/design-system-css/src/tokens.css` (+ generated TS tokens)

- [ ] **Step 1: Regenerate** — from `layers/design-system`: `npm run tokens:build`. Expected: `Wrote libs/design-system-css/src/tokens.css`.
- [ ] **Step 2: Verify the floor emitted** — `grep -E '^\s*--color-accent:|^\s*--tone-risk:' libs/design-system-css/src/tokens.css | head`. Expected: both names appear inside the `:root {` block.
- [ ] **Step 3: Confirm `tokens-check` is green** — `npx nx run design-system-css:tokens-check` (the generated-file-freshness gate). Expected: PASS (tokens.css matches source).
- [ ] **Step 4: If `build-ts` changed a TS tokens export in `-css`'s public API**, run the `-css` api update (`npx nx run design-system-css:api-check` — if it fails on the new names, run the repo's `api:update`) and include the regenerated `etc/*.api.md`. Expected: api-check green.
- [ ] **Step 5: Commit** — `git add libs/design-system-css/src/tokens.css libs/design-system-css/src && git commit -m "chore(design-system-css): regenerate tokens.css with semantic floor"`

### Task 3: Skin-lint vitest — write the failing test first

**Files:** Create `libs/design-system-css/src/skins/skin-lint.spec.ts`, `libs/design-system-css/vitest.config.ts`; Modify `libs/design-system-css/project.json`

- [ ] **Step 1: Add the vitest config** (mirror `design-system-core/vitest.config.ts`).

```ts
// libs/design-system-css/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 2: Add a `vite:test` target** to `libs/design-system-css/project.json` (mirror the core lib's target shape — executor `@nx/vite:test`, `configFile` pointing at the new config). Example:

```jsonc
"vite:test": {
  "executor": "@nx/vite:test",
  "outputs": ["{options.reportsDirectory}"],
  "options": { "configFile": "libs/design-system-css/vitest.config.ts" }
}
```

> **Build must NOT compile the spec.** `design-system-css` was a CSS-only lib; adding a `*.spec.ts` that imports `vitest` will break the `@nx/js:tsc` `build` target unless specs are excluded. Mirror `design-system-core`: ensure the lib's **build** tsconfig (`tsconfig.lib.json` or the `build` target's tsconfig) has `"exclude": ["src/**/*.spec.ts", "vitest.config.ts"]` (and add `vitest`/`vite` types only to the test tsconfig, not the lib build). Verify `npx nx run design-system-css:build` stays green after adding the spec.

- [ ] **Step 3: Write the lint spec.**

```ts
// libs/design-system-css/src/skins/skin-lint.spec.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // .../src/skins
const tokensCss = readFileSync(join(here, '..', 'tokens.css'), 'utf8');

/**
 * Names declared in a `:root { … }` block. We deliberately do NOT anchor on a
 * preceding `}`/string-start: the first `:root` block in tokens.css is preceded
 * by the generated header *comment* (`*/`), so an anchor would miss it. The
 * bare `:root\s*\{` already excludes `[data-theme="…"] {` (no `:root` substring)
 * and `:root[data-skin='…'] {` (a `[` follows `:root`, not `\s*{`).
 */
function floorNames(css: string): Set<string> {
  const names = new Set<string>();
  const re = /:root\s*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    for (const d of m[1].matchAll(/(--[a-z0-9-]+)\s*:/gi)) names.add(d[1]);
  }
  return names;
}

/** Names *defined* (left-hand side, after `{` or `;`) in a skin file. */
function definedNames(css: string): Set<string> {
  const names = new Set<string>();
  for (const d of css.matchAll(/[{;]\s*(--[a-z0-9-]+)\s*:/gi)) names.add(d[1]);
  return names;
}

const FLOOR = floorNames(tokensCss);
const skinFiles = readdirSync(here).filter((f) => /^skin-.*\.css$/.test(f));

describe('skin-lint', () => {
  it('the :root floor carries the core semantic contract', () => {
    for (const n of ['--color-bg', '--color-accent', '--color-accent-on', '--tone-risk', '--tone-warn']) {
      expect(FLOOR.has(n), `floor is missing ${n}`).toBe(true);
    }
  });

  it('finds the built skins', () => {
    expect(skinFiles).toContain('skin-club-grass.css');
    expect(skinFiles).toContain('skin-warmlight-fcl.css');
  });

  it.each(skinFiles)('%s introduces no token absent from the floor', (file) => {
    const css = readFileSync(join(here, file), 'utf8');
    const strays = [...definedNames(css)].filter((n) => !FLOOR.has(n));
    expect(strays, `${file} declares non-floor tokens: ${strays.join(', ')}`).toEqual([]);
  });

  it.each(skinFiles)('%s sets a sensible accent + surface subset (advisory)', (file) => {
    const css = readFileSync(join(here, file), 'utf8');
    const defined = definedNames(css);
    expect(defined.has('--color-accent'), `${file} should set --color-accent`).toBe(true);
    expect(defined.has('--color-bg'), `${file} should set --color-bg`).toBe(true);
  });
});
```

- [ ] **Step 4: Run the lint** — `NX_DAEMON=false npx nx run design-system-css:vite:test`. Expected: **PASS** (Task 1 already added the floor names the skins use). If a skin shows a stray name, the floor is missing that name — add it to `base.tokens.json` (back to Task 1) rather than weakening the lint.

> Note: this spec passes immediately because the floor (Task 1) was authored to be a superset of skin names. To prove the lint *bites*, temporarily rename one skin token to a bogus name locally and confirm a failure, then revert (do not commit the bogus edit).

- [ ] **Step 5: Commit** — `git add libs/design-system-css/src/skins/skin-lint.spec.ts libs/design-system-css/vitest.config.ts libs/design-system-css/project.json && git commit -m "test(design-system-css): skin-lint — skins override only floor names (ADR-234 D4)"`

### Task 4: Bump version, full gate, publish

- [ ] **Step 1: Bump** `libs/design-system-css/package.json` `version` to `1.5.0`. Commit: `chore(release): design-system-css 1.5.0 — semantic floor + skin-lint`.
- [ ] **Step 2: Full local gate** — from `layers/design-system`: `npm run ci:local > /tmp/e1.log 2>&1; echo "EXIT=$?"`. Read the log; expect build + lint + tests green (incl. the new skin-lint).
- [ ] **Step 3: Open PR + story, run the design-system verifier wave** (reviewer + qa-engineer + charter-checker, worktree-isolated). charter-checker note: this is design-system territory, no kernel touch — the floor is shared UI infra (ADR-176 honoured).
- [ ] **Step 4: Twin ritual** (drain → post-findings pre-merge), fix blockers, squash-merge.
- [ ] **Step 5: Publish** — `npm run publish:libs` from `layers/design-system` (publishes `design-system-css@1.5.0`). Verify `npm view @de-braighter/design-system-css version` → `1.5.0`.
- [ ] **Step 6: Post-merge ritual** (backfill → reviews → resolve-findings → reconcile). Update memory.

---

## E2 — `[data-skin]` subtree scoping + applier rewrite (`design-system`)

**Repo:** `layers/design-system`. **Branch:** `feat/data-skin-scoping`. **Worktree:** `../../design-system-wt-data-skin`.

**Outcome:** Skin files scope to `[data-skin="X"]` instead of `:root`; `SkinApplier` loads-once + sets `document.documentElement.dataset.skin = key` (never removes a `<link>`); the showcase demonstrates a live subtree skin swap. Publish `design-system-css` **1.6.0** + `design-system-core` **1.3.0**.

### File structure
- **Modify:** `libs/design-system-css/src/skins/skin-club-grass.css`, `skin-warmlight-fcl.css` — `:root{}` → `[data-skin="X"]{}`.
- **Modify:** `libs/design-system-core/src/public/skins/skin-applier.ts` — new apply mechanism + API.
- **Modify:** `libs/design-system-core/src/public/skins/skin-applier.spec.ts` — rewrite for new behaviour.
- **Regenerate:** `libs/design-system-core/etc/design-system-core.api.md` via api:update (public-API change).
- **Modify:** `apps/showcase/src/app/pages/db-skin-switcher.page.ts` + `apps/showcase/project.json` (or `apps/showcase/.../angular`-style config) — static-load the skins + flip a scoped `data-skin`.
- **Modify:** both `package.json` versions.

### Task 1: Rewrite the skin files to `[data-skin]` scope

**Files:** Modify `libs/design-system-css/src/skins/skin-club-grass.css`, `skin-warmlight-fcl.css`

- [ ] **Step 1: club-grass** — change the token block selector `:root {` → `[data-skin="club-grass"] {` (keep every `--color-*`/`--tone-*` declaration verbatim). Merge the existing `:root[data-skin='club-grass'] { color-scheme: light; }` rule INTO the same `[data-skin="club-grass"]` block (add `color-scheme: light;`), and delete the now-redundant `:root[data-skin=...]` rule.
- [ ] **Step 2: warmlight-fcl** — same transformation with `[data-skin="warmlight-fcl"]`; fold its `color-scheme: light;` in; keep the `--font-ui`/`--font-mono` overrides.
- [ ] **Step 3: Skin-lint still green** — `NX_DAEMON=false npx nx run design-system-css:vite:test` (the lint matches `:root` selectors for the floor and `[{;]--name:` for skin definitions, so the `[data-skin]` selector change does not affect which *names* are flagged). Expected: PASS.
- [ ] **Step 4: Commit** — `feat(design-system-css): scope skins to [data-skin="X"] subtree overlays (ADR-234 D2)`.

### Task 2: Rewrite `SkinApplier` (TDD — spec first)

**Files:** Modify `libs/design-system-core/src/public/skins/skin-applier.spec.ts` then `skin-applier.ts`

- [ ] **Step 1: Rewrite the spec** for load-once + attribute-flip + never-remove.

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SkinApplier } from './skin-applier.js';

const ORIGINAL_APPEND = HTMLHeadElement.prototype.appendChild;
function patchAppend(succeed = true) {
  vi.spyOn(HTMLHeadElement.prototype, 'appendChild').mockImplementation(function (
    this: HTMLHeadElement,
    node: Node,
  ) {
    const res = ORIGINAL_APPEND.call(this, node);
    const link = node as HTMLLinkElement;
    if (link.rel === 'stylesheet') {
      queueMicrotask(() => (succeed ? link.onload?.(new Event('load')) : link.onerror?.(new Event('error'))));
    }
    return res as Node;
  } as typeof HTMLHeadElement.prototype.appendChild);
}

beforeEach(() => {
  for (const l of [...document.head.querySelectorAll('link')]) l.remove();
  delete document.documentElement.dataset.skin;
  patchAppend(true);
});
afterEach(() => vi.restoreAllMocks());

describe('SkinApplier', () => {
  it('starts with no active skin', () => {
    expect(new SkinApplier().activeSkin).toBeNull();
  });

  it('apply() loads the skin <link> once and sets data-skin', async () => {
    const a = new SkinApplier();
    await a.apply('club-grass', '/skins/skin-club-grass.css');
    expect(a.activeSkin).toBe('club-grass');
    expect(document.documentElement.dataset.skin).toBe('club-grass');
    expect(document.head.querySelectorAll('link[rel="stylesheet"]').length).toBe(1);
  });

  it('never removes a previously loaded skin — both coexist, only the attribute flips', async () => {
    const a = new SkinApplier();
    await a.apply('club-grass', '/skins/skin-club-grass.css');
    await a.apply('warmlight-fcl', '/skins/skin-warmlight-fcl.css');
    expect(document.head.querySelectorAll('link[rel="stylesheet"]').length).toBe(2);
    expect(document.documentElement.dataset.skin).toBe('warmlight-fcl');
    expect(a.activeSkin).toBe('warmlight-fcl');
  });

  it('does not re-add an already-loaded stylesheet', async () => {
    const a = new SkinApplier();
    await a.apply('club-grass', '/skins/skin-club-grass.css');
    await a.apply('club-grass', '/skins/skin-club-grass.css');
    expect(document.head.querySelectorAll('link[rel="stylesheet"]').length).toBe(1);
  });

  it('dispatches a "skin-changed" CustomEvent carrying the key', async () => {
    const a = new SkinApplier();
    const detail = new Promise<{ key: string; cssPath: string }>((resolve) =>
      globalThis.addEventListener('skin-changed', (e) => resolve((e as CustomEvent).detail), { once: true }),
    );
    await a.apply('mint-dark', '/skins/skin-mint-dark.css');
    expect((await detail).key).toBe('mint-dark');
  });

  it('rejects when the stylesheet fails to load', async () => {
    vi.restoreAllMocks();
    patchAppend(false);
    await expect(new SkinApplier().apply('broken', '/skins/broken.css')).rejects.toThrow(/failed to load/i);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`activeCssPath`/old signature). `NX_DAEMON=false npx nx run design-system-core:vite:test`. Expected: FAIL.

- [ ] **Step 3: Rewrite the applier.**

```ts
// libs/design-system-core/src/public/skins/skin-applier.ts
import type { SkinKey } from './skin-registry.js';

/** Event detail dispatched on a successful apply. */
export interface SkinChangedEventDetail {
  readonly key: SkinKey;
  readonly cssPath: string;
}

/**
 * Vanilla-DOM skin applier — ADR-170 Layer 3, revised by ADR-234 D2.
 *
 * Skins are `[data-skin="X"]` subtree overlays backed by the `:root` token
 * floor. Applying a skin is two idempotent steps:
 *   1. ensure the skin's stylesheet is present in <head> (load-once; NEVER
 *      removed — every loaded skin coexists, inert until its `[data-skin]`
 *      attribute selects it, so there is no `:root` cascade war and no swap
 *      flicker);
 *   2. set `document.documentElement.dataset.skin = key`, activating that
 *      skin's `[data-skin]` block for the document subtree.
 *
 * Dispatches a `skin-changed` window CustomEvent so non-Angular leaves can
 * react. Browser env required; `.apply()` throws in a non-DOM context.
 */
export class SkinApplier {
  private readonly loaded = new Set<string>();
  private current: SkinKey | null = null;

  async apply(key: SkinKey, cssPath: string): Promise<void> {
    await this.ensureLoaded(cssPath);
    document.documentElement.dataset.skin = key;
    this.current = key;
    globalThis.dispatchEvent(
      new CustomEvent<SkinChangedEventDetail>('skin-changed', { detail: { key, cssPath } }),
    );
  }

  /** The active skin key, or null if none applied yet. */
  get activeSkin(): SkinKey | null {
    return this.current;
  }

  private ensureLoaded(cssPath: string): Promise<void> {
    if (this.loaded.has(cssPath)) return Promise.resolve();
    const present = [...document.head.querySelectorAll('link[rel="stylesheet"]')].some((l) =>
      (l as HTMLLinkElement).href.endsWith(cssPath),
    );
    if (present) {
      this.loaded.add(cssPath);
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = cssPath;
      link.onload = () => {
        this.loaded.add(cssPath);
        resolve();
      };
      link.onerror = () => reject(new Error(`SkinApplier: failed to load ${cssPath}`));
      document.head.appendChild(link);
    });
  }
}
```

- [ ] **Step 4: Run — expect PASS.** `NX_DAEMON=false npx nx run design-system-core:vite:test`.
- [ ] **Step 5: Commit** — `feat(design-system-core): SkinApplier loads-once + flips data-skin (ADR-234 D2)`.

### Task 3: Update the api-extractor report

**Files:** Regenerate `libs/design-system-core/etc/design-system-core.api.md`

- [ ] **Step 1: Build then api-check** — `npx nx run design-system-core:build && npx nx run design-system-core:api-check`. Expected: FAIL with a report mismatch (`apply(cssPath)` → `apply(key, cssPath)`; `activeCssPath` → `activeSkin`; `SkinChangedEventDetail.cssPath` → `{ key, cssPath }`).
- [ ] **Step 2: Update the report** — run the repo's api update (`npm run api:update` from `layers/design-system`, i.e. `nx run-many -t build && node tools/api-update.mjs`).
- [ ] **Step 3: Re-run api-check** — expect PASS. Inspect the diff in `etc/design-system-core.api.md` to confirm only the intended `SkinApplier`/`SkinChangedEventDetail` lines changed.
- [ ] **Step 4: Commit** — `chore(design-system-core): api:update for SkinApplier signature change`.

### Task 4: Update the showcase to demonstrate subtree scoping

**Files:** Modify `apps/showcase/src/app/pages/db-skin-switcher.page.ts` + the showcase styles config

Context: the showcase page currently only sets a signal. Make it demonstrate the real `[data-skin]` mechanism on a scoped subtree (cleaner than mutating `documentElement`; shows multi-skin-on-page capability).

- [ ] **Step 1: Static-load the skins** — add the two published skin CSS to the showcase's global styles array (in `apps/showcase/project.json` build `styles`, or the equivalent Angular config): `libs/design-system-css/src/skins/skin-club-grass.css` and `skin-warmlight-fcl.css` (workspace-relative; the showcase consumes the local lib source). This makes the `[data-skin]` rules exist globally, inert until the attribute is set.
- [ ] **Step 2: Scope the demo stage** — bind `data-skin` to the active key on the `.stage` element and add a few `var(--color-*)` swatches so the skin visibly changes:

```html
<div class="stage" [attr.data-skin]="active()">
  <db-skin-switcher [skins]="skins" [active]="active()" (skinSelected)="active.set($event)" />
  <div class="swatches">
    <span class="sw" style="background: var(--color-accent); color: var(--color-accent-on)">accent</span>
    <span class="sw" style="background: var(--color-bg-raised); color: var(--color-ink-strong)">surface</span>
    <span class="sw" style="background: var(--tone-risk); color: #fff">risk</span>
  </div>
  <p class="feedback">Active skin: <strong>{{ active() }}</strong></p>
</div>
```

- [ ] **Step 3: Update the docs blurb** to say the brick now drives a scoped `[data-skin]` overlay (mention `SkinApplier` is the vanilla primitive for the runtime composer). Keep the page OnPush + standalone.
- [ ] **Step 4: Build the showcase** — `npx nx run showcase:build > /tmp/show.log 2>&1; echo "EXIT=$?"`. Expected: success.
- [ ] **Step 5: Commit** — `feat(showcase): live [data-skin] subtree skin swap demo`.

### Task 5: Bump versions, gate, publish both packages

- [ ] **Step 1: Bump** `design-system-css` → `1.6.0` (the `[data-skin]` rewrite) and `design-system-core` → `1.3.0` (new applier API). Commit.
- [ ] **Step 2: Full gate** — `npm run ci:local > /tmp/e2.log 2>&1; echo "EXIT=$?"`. Read log.
- [ ] **Step 3: PR + story + verifier wave** (reviewer + qa-engineer + charter-checker + **confirm api-extractor green**).
- [ ] **Step 4: Twin ritual, fix blockers, squash-merge.**
- [ ] **Step 5: Publish** both (`npm run publish:libs`). Verify `npm view @de-braighter/design-system-css version` → `1.6.0` and `…/design-system-core version` → `1.3.0`.
- [ ] **Step 6: Post-merge ritual + memory update.**

---

## E3 — Pack token contract + Club Grass pack-extension (`exercir`)

**Repo:** `domains/exercir`. **Branch:** `feat/kf-skin-contract`. **Worktree:** `../../exercir-wt-kf-contract`.

**Outcome:** kids-football gains a **global**, `[data-skin="club-grass"]`-scoped `--kf-*` pack-extension partial; the published `skin-club-grass.css` (1.6.0, `[data-skin]`-scoped) loads globally in the shared host; every kids-football top-level component host carries `data-skin="club-grass"`. **Additive / no visual change** — components still read `--cg-*` (migration is E4). Bump exercir's design-system pins.

### File structure
- **Create:** `libs/pack-kids-football-ui/src/lib/club-grass-pack-tokens.css` — `@font-face`/`@import` (Archivo) + reduced-motion + `[data-skin="club-grass"] { --kf-* }`.
- **Modify:** `apps/pack-football-visual-editor/project.json` (or its Angular build config) — add two global stylesheets to the `styles` array: the published `skin-club-grass.css` + the new pack-tokens partial.
- **Modify:** the kids-football top-level routed components — add a `host: { '[attr.data-skin]': "'club-grass'" }` binding. (Authoritative set re-derived off `origin/main`; at plan time: `shell/kf-shell.component.ts`, `landing/club-picker-page.component.ts`, `auth/sign-in-page.component.ts`, `onboarding/onboarding-wizard.component.ts`.)
- **Modify:** `domains/exercir/package.json` — bump `@de-braighter/design-system-css` → `^1.6.0`, `@de-braighter/design-system-core` → `^1.3.0`.

### Task 1: Bump pins + install

- [ ] **Step 1:** In the worktree (off `origin/main`), set `domains/exercir/package.json`: `"@de-braighter/design-system-css": "^1.6.0"`, `"@de-braighter/design-system-core": "^1.3.0"`. Leave `design-system-angular` as is.
- [ ] **Step 2:** `export GITHUB_TOKEN=…; npm install` (needs `read:packages`). Verify the published skin file now contains `[data-skin="club-grass"]`: `grep -l 'data-skin' node_modules/@de-braighter/design-system-css/skins/skin-club-grass.css`.
- [ ] **Step 3: Commit** — `chore(exercir): bump design-system-css ^1.6.0 + core ^1.3.0 (data-skin skins)`.

### Task 2: The `--kf-*` pack-extension partial

**Files:** Create `libs/pack-kids-football-ui/src/lib/club-grass-pack-tokens.css`

Context: this is a **global** stylesheet (NOT a component style — emulated encapsulation would rewrite `[data-skin]` and break it). It carries the irreducibly pack-specific tokens + the webfont + the reduced-motion override, all scoped to the club-grass subtree.

- [ ] **Step 1: Author the partial.**

```css
/**
 * Club Grass pack-extension tokens (ADR-234 D3).
 *
 * Loaded GLOBALLY (host styles array) — NOT a component style — so the
 * [data-skin="club-grass"] selector is a true global selector that matches the
 * kids-football subtree's host element (which sets data-skin="club-grass").
 * The semantic --color-*/--tone-* contract comes from the published skin
 * (@de-braighter/design-system-css skins/skin-club-grass.css). These --kf-*
 * tokens are the pack-specific extension the semantic contract does not cover:
 * the Archivo type family, component sizing, the accent focus ring, and the
 * attendance "absent" colour.
 */
@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Archivo:wght@400;500;600&display=swap');

[data-skin='club-grass'] {
  --kf-font-display: 'Archivo Black', sans-serif;
  --kf-font-body: 'Archivo', sans-serif;

  --kf-btn-height: 42px;
  --kf-btn-radius: 10px;
  --kf-card-radius: 14px;
  --kf-input-height: 40px;
  --kf-input-radius: 9px;
  --kf-avatar-size: 38px;
  --kf-nav-height: 56px;

  /* Accent green focus ring (matches --color-accent #2F8A4E). */
  --kf-focus-ring: 0 0 0 3px rgba(47, 138, 78, 0.45);

  /* Attendance "absent" — pack-specific status colour (slice 8). */
  --kf-absent: #c25441;
}

/* Honour reduced motion within the club-grass subtree (was club-grass.css). */
@media (prefers-reduced-motion: reduce) {
  [data-skin='club-grass'],
  [data-skin='club-grass'] *,
  [data-skin='club-grass'] *::before,
  [data-skin='club-grass'] *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

> Re-derive the exact `--kf-*` set + values from the **origin/main** `club-grass.css` `:host` block at execution (the local clone is stale — confirm `--cg-absent` and any post-slice-2 additions exist and carry their authoritative values).

- [ ] **Step 2: Commit** — `feat(kids-football): club-grass --kf-* pack-extension partial, [data-skin] scoped (ADR-234 D3)`.

### Task 3: Load the global stylesheets in the shared host

**Files:** Modify `apps/pack-football-visual-editor/project.json` (build `styles`)

- [ ] **Step 1:** Add to the `build.options.styles` array (after the existing entries):
  - `node_modules/@de-braighter/design-system-css/skins/skin-club-grass.css`
  - `libs/pack-kids-football-ui/src/lib/club-grass-pack-tokens.css`
  Both are global + `[data-skin]`-scoped, so they are inert on football-editor routes (no `data-skin` there) — verified by E4's browser run-through. This host change is transitional (Piece B removes it).
- [ ] **Step 2: Budget check** — the `styles` additions count toward the app's `initial` budget. Build prod: `npx nx run pack-football-visual-editor:build > /tmp/host.log 2>&1; echo "EXIT=$?"`. If the `initial` maximumError trips, bump it in `project.json` (the i18n work already set it to 1.2 mb) — note the new ceiling in the PR.
- [ ] **Step 3: Commit** — `feat(exercir): load published club-grass skin + pack tokens globally (transitional host)`.

### Task 4: Mark the kids-football subtree with `data-skin`

**Files:** Modify each kids-football top-level routed component

- [ ] **Step 1: Re-derive the component set** — on the worktree: `git grep -l "styleUrls:.*club-grass.css"` plus the top-level routed components (picker/sign-in/onboarding/shell). Each must carry the attribute so its subtree resolves the `[data-skin]` overlay.
- [ ] **Step 2: Add the host binding** to each (do NOT remove `styleUrls: ['../club-grass.css']` yet — that retires in E4):

```ts
@Component({
  // …existing…
  host: { '[attr.data-skin]': "'club-grass'" },
})
```
  If a component already declares `host`, merge the key in. (KfShellComponent's subtree covers all admin/drills/templates/calendar/team/run routes via `<router-outlet>`; the standalone picker/sign-in/onboarding each need their own.)

- [ ] **Step 3: Verify no visual change yet** — `npx nx test pack-kids-football-ui` (full project, `NX_DAEMON=false`). Components still read `--cg-*` (unchanged); the new `--color-*`/`--kf-*` are now *available* on the same hosts but unused. Expected: green (no behaviour change).
- [ ] **Step 4: Commit** — `feat(kids-football): set data-skin="club-grass" on subtree hosts (ADR-234 D2)`.

### Task 5: Gate, wave, merge

- [ ] **Step 1: Full gate** — `npm run ci:local > /tmp/e3.log 2>&1; echo "EXIT=$?"` from `domains/exercir`. Read log.
- [ ] **Step 2: PR + story + wave** (reviewer + qa-engineer + exercir-charter-checker + a11y-pro). exercir-charter note: no PHI, no demo-mode change; transitional host change is reversible (Piece B seam pinned).
- [ ] **Step 3: Twin ritual, fix blockers, squash-merge, post-merge ritual, memory update.**

---

## E4 — Reconcile kids-football off `--cg-*` (`exercir`)

**Repo:** `domains/exercir`. **Branch:** `refactor/kf-retire-cg-tokens`. **Worktree:** `../../exercir-wt-kf-retire-cg`.

**Outcome:** every `--cg-*` site migrates to `var(--color-*)`/`var(--tone-*)`/`var(--kf-*)`; the `:host --cg-*` projection in `club-grass.css` is deleted, the `styleUrls: ['../club-grass.css']` token import is removed from each component (replaced by the global skin + pack-tokens from E3), and `club-grass-skin-parity.spec.ts` is deleted (skin-lint guards parity now). Browser-verify the **accent renders green via the published skin**, in the shared host transitionally.

### File structure
- **Modify:** ~16 component files under `libs/pack-kids-football-ui/src/lib/**` — replace all `var(--cg-*)` per the mapping table; drop the `styleUrls: ['../club-grass.css']` entry.
- **Delete:** `libs/pack-kids-football-ui/src/lib/club-grass.css` (its fonts/reduced-motion/tokens now live in E3's global partial; confirm nothing else references it).
- **Delete:** `libs/pack-kids-football-ui/src/lib/club-grass-skin-parity.spec.ts`.

### Task 1: Re-derive the authoritative `--cg-*` inventory (off origin/main)

**Files:** none (discovery)

- [ ] **Step 1: List definitions + usages on the worktree** —
  ```bash
  git grep -n -- '--cg-[a-z0-9-]*:' libs/pack-kids-football-ui   # definitions
  git grep -h -o -- '--cg-[a-z0-9-]*' libs/pack-kids-football-ui | sort | uniq -c   # all names + counts
  git grep -c 'var(--cg-' libs/pack-kids-football-ui              # per-file usage counts
  ```
- [ ] **Step 2: Reconcile against the mapping table.** Every distinct name must map. For names that appear in `var(--cg-X, fallback)` usages but are NOT defined (at plan time: `--cg-border`, `--cg-grass`, `--cg-accent-bright`), inspect each call site and map to the nearest semantic/pack equivalent (`--cg-border`→`--color-border`; `--cg-grass`→`--color-accent`; `--cg-accent-bright`→a new `--kf-accent-bright` added to the E3 partial via a follow-up commit, OR `color-mix(in oklch, var(--color-accent) 80%, white)`). Record the final per-name decision in the PR description.

### Task 2: Migrate the call sites file-by-file

**Files:** Modify each component under `libs/pack-kids-football-ui/src/lib/**` that uses `--cg-*`

Process per file (commit after each 2–3 files to keep diffs reviewable):
- [ ] **Step 1:** Apply the mapping table as exact-string replacements of `var(--cg-NAME` → `var(--TARGET` (and any bare `--cg-NAME:` definition sites — there should be none left outside `club-grass.css`). Preserve any fallback args (`var(--cg-x, #hex)` → `var(--target, #hex)`).
- [ ] **Step 2:** In the SAME file, if it has `styleUrls: ['../club-grass.css']`, remove that entry (keep any other styleUrls/inline `styles`). The tokens now arrive globally via E3.
- [ ] **Step 3:** Watch the **8 kB per-component-style budget** — migration shouldn't grow inline styles, but verify the prod build stays green at Task 4.
- [ ] **Step 4:** After each batch, `NX_DAEMON=false npx nx test pack-kids-football-ui` (full project). Expected: green. Commit: `refactor(kids-football): migrate <area> off --cg-* onto --color-*/--kf-*`.

### Task 3: Retire the projection + parity spec

**Files:** Delete `club-grass.css` + `club-grass-skin-parity.spec.ts`

- [ ] **Step 1:** Confirm zero remaining references: `git grep -n 'club-grass.css' libs/pack-kids-football-ui` returns nothing (all `styleUrls` entries removed in Task 2). If `club-grass.css` held anything still needed (it should not — fonts/reduced-motion/tokens are in E3's global partial), move it to the partial first.
- [ ] **Step 2:** `git rm libs/pack-kids-football-ui/src/lib/club-grass.css libs/pack-kids-football-ui/src/lib/club-grass-skin-parity.spec.ts`.
- [ ] **Step 3:** `git grep -n 'var(--cg-' libs/pack-kids-football-ui` returns **nothing** (the migration is complete). If anything remains, return to Task 2.
- [ ] **Step 4: Commit** — `refactor(kids-football): retire :host --cg-* projection + parity spec (skin-lint guards parity now)`.

### Task 4: Gate + browser-verify GREEN

- [ ] **Step 1: Full gate** — `npm run ci:local > /tmp/e4.log 2>&1; echo "EXIT=$?"` from `domains/exercir`. Read log (build + lint + tests + prod budget). Expected green.
- [ ] **Step 2: Browser run-through.** Kill stale ports (`Get-NetTCPConnection -LocalPort 3150,4200 | Stop-Process -Force` via PowerShell). Serve the worktree api (`PORT=3150`, in-memory → 2 stub clubs) + the shared host (`:4200`) detached-to-log. Drive via Playwright MCP: club-picker → coach sign-in → Drills/Templates/Calendar/Team. **Assert the accent renders grass-green (#2F8A4E / `oklch(0.555 0.120 148)`), NOT blue (#2563eb).** Verify a danger element (delete confirm) is red via `--tone-risk`, the focus ring is green, and the four-locale switcher still works. Confirm a football-editor route is UNCHANGED (no `data-skin`, still its own theme).
- [ ] **Step 3:** Screenshot to `de-braighter/docs/club-grass-skin-reconciled-proof.png`.
- [ ] **Step 4: PR + story + wave** (reviewer + qa-engineer + exercir-charter-checker + **a11y-pro** — verify contrast of the published-skin colours on the migrated surfaces + focus-ring visibility meet WCAG 2.2 AA; the published skin is oklch vs the old hex literals, expect negligible drift on the mapped 8 but confirm in-browser).
- [ ] **Step 5: Twin ritual, fix blockers, squash-merge, post-merge ritual.**
- [ ] **Step 6: Memory update** — mark E1–E4 done; note kids-football is now themed by the published skin (Piece B remains the only open item to make it standalone-deployable).

---

## Self-review (run against ADR-234 before executing)

**Spec coverage:**
- D1 (real `:root` floor) → E1 Task 1–2. ✓
- D2 (`[data-skin]` scoping + applier shrinks to attribute-flip/load-once) → E2 Task 1–2, applier never-removes. ✓
- D3 (pack contract: consume `--color-*`/`--tone-*` + scoped `--kf-*` extension; danger/amber via existing tones, no speculative floor promotion) → E3 Task 2 + E4 mapping table. ✓
- D4 (skin-lint replaces the hand-rolled parity spec) → E1 Task 3 + E4 Task 3 (delete parity spec). ✓
- ADR-176 honoured (design-system/pack territory, no kernel touch; promotion demand-driven and NOT triggered) → noted in E1/E3 wave briefs. ✓
- Invariants: floor is the only place names are introduced (E1); no skin introduces a non-floor name (skin-lint, E1/E2); packs never declare `--color-*` themselves (E4 retires the projection; `--kf-*` are namespaced). ✓

**Placeholder scan:** the only deliberate "re-derive at execution" steps (E3 Task 4 Step 1, E4 Task 1) are *because* the local clone is 6 commits stale — the mapping rules + component patterns are fully specified; only the exact site list is re-grepped on `origin/main`. No TBD/TODO/"add error handling".

**Type/name consistency:** floor token names in E1 Task 1 == skin-lint sanity names (E1 Task 3) == mapping-table targets (E4) == `--kf-*` partial names (E3 Task 2). `SkinApplier.apply(key, cssPath)` + `activeSkin` + `SkinChangedEventDetail { key, cssPath }` are consistent across the applier (E2 Task 2), its spec (E2 Task 2 Step 1), and the api-extractor update (E2 Task 3).

**Versions:** css 1.4.0 → 1.5.0 (E1) → 1.6.0 (E2); core 1.2.0 → 1.3.0 (E2). exercir pin bumps land in E3 (css ^1.6.0, core ^1.3.0). ✓
