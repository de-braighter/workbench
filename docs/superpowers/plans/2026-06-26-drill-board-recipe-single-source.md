# Drill-board Recipe Single-Source Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the kids-football drill-board `EditorRecipe` a single published data artifact (`@de-braighter/board-recipes`) that both the live exercir board and the studio cookbook load, deleting the two hand-copied `.ts` literals — with zero engine/kernel change and the live board's 26/26 byte-parity gate still green.

**Architecture:** A new standalone content-layer repo `de-braighter/board-recipes` ships the recipe as a canonical JSON asset (`src/kf-drill.recipe.json`) behind a thin typed loader (`export const kfDrillRecipe: EditorRecipe`). It depends on `@de-braighter/design-system-core` for the `EditorRecipe` type only. Strict order: ADR → build + publish the package → de-fork exercir (SP2) and studio (SP3) in parallel onto the published package.

**Tech Stack:** TypeScript (ESM, `module: nodenext`, `resolveJsonModule`), `tsc` + `vitest` (no nx/Angular in the new repo), GitHub Packages (`@de-braighter/*`, restricted), npm (exercir) + pnpm (studio) consumers.

## Global Constraints

- **Canonical export name `kfDrillRecipe`** everywhere (exercir keeps it; studio renames `kidsDrillRecipe` → `kfDrillRecipe`).
- **Zero change** to `@de-braighter/design-system-core` and the substrate kernel — ADR-176-safe; board-kit stays a brick; the new package only *consumes* the `EditorRecipe` type.
- **No second copy** at completion: `kf-drill.recipe.ts` (exercir) and `kids-drill.recipe.ts` (studio) are both deleted; both consumers import from `@de-braighter/board-recipes`.
- **exercir `kf-registry-parity.spec.ts` (26/26 byte-parity gate) stays green** against the published recipe; `parity-legacy/` (the pinned oracle) is untouched.
- **Consumers use the published package only** — no `file:` links (cluster rule). SP1 must publish before SP2/SP3 install.
- **Install/publish auth:** `@de-braighter` → `https://npm.pkg.github.com`; `GITHUB_TOKEN` env var must be set (read:packages to install, write:packages to publish; classic PAT).
- **Publishing & repo-create are main-session, founder-gated** — a subagent cannot get them authorized by relay.
- **Hygiene:** in the workbench repo never `git add -A` (it carries untracked WIP) — explicit paths only. Wave agents run with `isolation: "worktree"` and must not run git ops in shared clones.
- **After every merge:** twin ritual `npm run ritual:post-merge -- <owner/repo#pr>`; PR bodies carry `Producer:` / `Effort:` / `Effect:` lines (declare self-observing `cycle-time` / `findings`; pair with `Producer:`).

---

### Task 1: ADR — board-recipes content layer + JSON-asset distribution

**Repo:** `de-braighter/specs` (clone at `layers/specs`). Designer-first; precedes SP1 impl.

**Files:**
- Create: `layers/specs/adr/adr-NNN-board-recipes-content-layer.md` (NNN = next free number)
- Modify: the ADR index the `/adr-scaffolder` skill updates

**Interfaces:**
- Produces: an `accepted`/`proposed` ADR id the SP1 PR body references; no code interface.

- [ ] **Step 1: Scaffold the ADR**

Use the `/adr-scaffolder` skill (it picks the next number and updates the index). Title: "Portable board recipes ship as a standalone content-layer package". If running manually, find the next number:

```bash
cd /d/development/projects/de-braighter/layers/specs && ls adr/ | grep -oE 'adr-[0-9]+' | sort -t- -k2 -n | tail -3
```
Expected: prints the last few ADR numbers (e.g. `adr-279`); use the next integer.

- [ ] **Step 2: Write the ADR body**

Record, in the repo's ADR template:
- **Context:** the drill-board recipe de-fork (ADR-279, exercir#320) left the `EditorRecipe` duplicated as byte-identical `.ts` literals in exercir (`kf-drill.recipe.ts`) and studio (`kids-drill.recipe.ts`); the cluster rule forbids domain↔domain consumption, so there is no shared channel for an in-domain literal.
- **Decision:** portable board-kit recipes are distributed as a dedicated **content-layer repo** `de-braighter/board-recipes` (`@de-braighter/board-recipes`), shipped as JSON data behind a typed loader, consumed by domains as a published `@de-braighter/*` package.
- **Why not a design-system lib:** `design-system-core` is the domain-agnostic board-kit engine (ADR-168); the `design-system` repo's `check-lib-conformance.mjs` allows only `type:{core,ui,css}` + requires `api-check`, and its CLAUDE.md forbids domain content. A `kf.*` recipe is domain-flavored content, so it gets its own content-layer repo rather than diluting the engine's home.
- **Why not a domain:** the cluster rule forbids domain↔domain consumption; a shared artifact must be a layer.
- **ADR-176 posture:** no kernel impact — board-kit is a brick that composes; recipes are data the brick interprets. The four kernel concerns are untouched.
- **Boundaries:** `board-recipes` depends only on `design-system-core` (type); no Angular, NestJS, or domain code; no cycles (leaf atop core; domains depend on both).
- **Consequences:** a growing recipe catalog has a home; a future recipe **store** (the deferred north-star) persists the same JSON payload unchanged.

- [ ] **Step 3: Commit + PR**

```bash
cd /d/development/projects/de-braighter/layers/specs
git checkout -b adr-board-recipes-content-layer
git add adr/adr-NNN-board-recipes-content-layer.md   # + the index file the skill touched
git commit -m "docs(adr): ADR-NNN board-recipes content layer + JSON-asset recipe distribution"
gh pr create --fill --title "docs(adr): board-recipes content layer (single-source drill recipe)"
```
Run `spec-auditor` (cross-refs/numbering/frontmatter). Auto-merge per standing grant. Run the twin ritual after merge.

---

### Prerequisite A (MAIN SESSION, founder-gated): create + clone the new repo

Not a subagent task — the new repo must exist and be cloned before Task 2's subagent runs.

- [ ] **Step 1: Create the GitHub repo with an initial README on `main`**

```bash
cd /d/development/projects/de-braighter
gh repo create de-braighter/board-recipes --private \
  --description "Portable board-kit EditorRecipe catalog (data-only) — consumed by domains; published @de-braighter/board-recipes." \
  --add-readme --clone=false
```

- [ ] **Step 2: Clone it as a sibling layer repo (gitignored in the workbench)**

```bash
cd /d/development/projects/de-braighter/layers
git clone git@github.com:de-braighter/board-recipes.git
ls board-recipes   # expect: README.md
```
Confirm `layers/board-recipes` is covered by the workbench `.gitignore` (`layers/*` siblings are ignored).

---

### Task 2: SP1 — build the `@de-braighter/board-recipes` package

**Repo:** `de-braighter/board-recipes` (clone at `layers/board-recipes`). All paths below are relative to that repo root.

**Interfaces:**
- Consumes: `EditorRecipe`, `validateRecipe` from `@de-braighter/design-system-core` (^2.8.0).
- Produces: `export const kfDrillRecipe: EditorRecipe` from the package entry `@de-braighter/board-recipes`; raw asset subpath `@de-braighter/board-recipes/kf-drill.recipe.json`.

- [ ] **Step 1: Branch**

```bash
cd /d/development/projects/de-braighter/layers/board-recipes
git checkout -b feat-kf-drill-recipe-package
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "@de-braighter/board-recipes",
  "version": "1.0.0",
  "description": "Portable board-kit EditorRecipe catalog (data-only). Consumed by domains as a published layer package; authors no kernel concept.",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./kf-drill.recipe.json": "./dist/kf-drill.recipe.json"
  },
  "files": ["dist"],
  "sideEffects": false,
  "scripts": {
    "build": "tsc -p tsconfig.json && node scripts/copy-assets.mjs",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "ci:local": "npm run build && npm run typecheck && npm run test"
  },
  "peerDependencies": { "@de-braighter/design-system-core": "^2.8.0" },
  "devDependencies": {
    "@de-braighter/design-system-core": "^2.8.0",
    "typescript": "~5.9.2",
    "vitest": "^4.0.8"
  },
  "publishConfig": { "registry": "https://npm.pkg.github.com", "access": "restricted" },
  "repository": { "type": "git", "url": "https://github.com/de-braighter/board-recipes.git" }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "lib": ["es2022"],
    "declaration": true,
    "resolveJsonModule": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["**/*.spec.ts", "dist", "node_modules"]
}
```

- [ ] **Step 4: Write `.npmrc`, `.gitignore`, `scripts/copy-assets.mjs`, `README.md`**

`.npmrc`:
```
@de-braighter:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
always-auth=true
```
`.gitignore`:
```
node_modules
dist
```
`scripts/copy-assets.mjs`:
```js
// Copy JSON data assets into dist/ next to the emitted index.js so the
// `import './kf-drill.recipe.json'` in dist/index.js resolves at consume time.
import { readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
mkdirSync('dist', { recursive: true });
for (const f of readdirSync('src').filter((n) => n.endsWith('.json'))) {
  copyFileSync(join('src', f), join('dist', f));
}
```
`README.md`: one paragraph — "Portable board-kit recipe catalog (data-only). A standalone content layer (kept out of the domain-agnostic design-system) so domains consume one published recipe artifact instead of hand-copied literals. First entry: the kids-football drill board. Consume: `import { kfDrillRecipe } from '@de-braighter/board-recipes'`."

- [ ] **Step 5: Generate the canonical `src/kf-drill.recipe.json` from the proven object**

Deterministic generation from `exercir origin/main` (the byte-parity-proven source). Run from the cluster root:

```bash
cd /d/development/projects/de-braighter/domains/exercir && git fetch origin main -q
git show origin/main:libs/pack-kids-football-ui/src/lib/drills/sketch/board-kit/kf-drill.recipe.ts > /tmp/kf-canonical.ts
cd /tmp && sed 's/^export const kfDrillRecipe/const kfDrillRecipe/' kf-canonical.ts > gen.mts
cat >> gen.mts <<'GEN'

import { writeFileSync } from 'node:fs';
const json = JSON.stringify(kfDrillRecipe, null, 2);
if (JSON.stringify(JSON.parse(json)) !== JSON.stringify(kfDrillRecipe)) { console.error('NOT JSON-LOSSLESS'); process.exit(2); }
writeFileSync(process.argv[2], json + '\n');
console.log('lines=', json.split('\n').length);
GEN
mkdir -p /d/development/projects/de-braighter/layers/board-recipes/src
node --experimental-strip-types /tmp/gen.mts /d/development/projects/de-braighter/layers/board-recipes/src/kf-drill.recipe.json
```
Expected: `lines= 719` (a verified-lossless 16687-char file), no `NOT JSON-LOSSLESS`. Sanity:
```bash
head -3 /d/development/projects/de-braighter/layers/board-recipes/src/kf-drill.recipe.json
```
Expected first lines: `{`, `  "id": "kf-drill",`, `  "name": "Kids drill board",`.

- [ ] **Step 6: Write `src/index.ts` (typed loader)**

```ts
import type { EditorRecipe } from '@de-braighter/design-system-core';
import kfDrill from './kf-drill.recipe.json' with { type: 'json' };

/**
 * The kids-football drill board as a declarative EditorRecipe — the single
 * canonical source loaded by the live exercir board and the studio cookbook.
 * Cast through `unknown`: the JSON's inferred type is narrower than EditorRecipe
 * in places (e.g. `p: "rect"` inferred as `string`); runtime validity is guarded
 * by validateRecipe in index.spec.ts, so the value-level cast is safe.
 */
export const kfDrillRecipe = kfDrill as unknown as EditorRecipe;
```

- [ ] **Step 7: Write the failing guard spec `src/index.spec.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { validateRecipe } from '@de-braighter/design-system-core';
import { kfDrillRecipe } from './index.js';

describe('kfDrillRecipe — published board recipe', () => {
  it('is the kf-drill recipe', () => {
    expect(kfDrillRecipe.id).toBe('kf-drill');
  });
  it('validates clean against the published board-kit schema', () => {
    expect(validateRecipe(kfDrillRecipe)).toEqual([]);
  });
  it('is JSON-lossless (no undefined/NaN/functions leaked)', () => {
    expect(JSON.parse(JSON.stringify(kfDrillRecipe))).toEqual(kfDrillRecipe);
  });
});
```

- [ ] **Step 8: Install deps**

```bash
cd /d/development/projects/de-braighter/layers/board-recipes
# GITHUB_TOKEN must be set in the environment (read:packages).
npm install
```
Expected: installs `@de-braighter/design-system-core@^2.8.0` from GitHub Packages, no 401.

- [ ] **Step 9: Build, then run the spec — verify it passes**

```bash
npm run build && npm test
```
Expected: `tsc` emits `dist/index.js` + `dist/index.d.ts`; `copy-assets` places `dist/kf-drill.recipe.json`; all three specs PASS. If the build/test fails on the JSON import attribute, apply the contingency (Step 9a).

- [ ] **Step 9a (CONTINGENCY — only if Step 9's JSON-import emit fails): TS-literal loader**

Replace `src/index.ts` with a generated object literal and keep the JSON as a shipped asset + add an equality guard. Regenerate the literal from the same proven object:
```bash
cd /tmp && sed 's/^export const kfDrillRecipe: EditorRecipe/export const kfDrillRecipe: EditorRecipe/' kf-canonical.ts | sed '1d' > /tmp/_body.ts
# _body.ts now holds the helper fns + `export const kfDrillRecipe: EditorRecipe = {...}` (type import dropped).
```
Author `src/index.ts` as: `import type { EditorRecipe } from '@de-braighter/design-system-core';` followed by the generated body (helpers + `export const kfDrillRecipe`). Keep `src/kf-drill.recipe.json` (Step 5) shipped via `copy-assets` + the `./kf-drill.recipe.json` export. Add to `src/index.spec.ts`:
```ts
import kfDrillJson from './kf-drill.recipe.json' with { type: 'json' };
it('the shipped JSON asset equals the exported recipe', () => {
  expect(JSON.parse(JSON.stringify(kfDrillRecipe))).toEqual(kfDrillJson);
});
```
Re-run `npm run build && npm test` → PASS.

- [ ] **Step 10: ESM import smoke test (proves consumers can load it)**

```bash
cd /d/development/projects/de-braighter/layers/board-recipes
node -e "import('./dist/index.js').then(m => console.log('id=' + m.kfDrillRecipe.id + ' shapes=' + m.kfDrillRecipe.shapes.length))"
```
Expected: `id=kf-drill shapes=8`.

- [ ] **Step 11: Commit + PR (PR #1 in the new repo)**

```bash
git add package.json tsconfig.json .npmrc .gitignore README.md scripts/copy-assets.mjs src/kf-drill.recipe.json src/index.ts src/index.spec.ts
git commit -m "feat: kf-drill board recipe as a published JSON data artifact"
gh pr create --fill --title "feat(board-recipes): kf-drill recipe as a single published JSON artifact"
```
PR body: reference ADR-NNN; `Producer:`/`Effort: standard`/`Effect: cycle-time …±… expert` + `Effect: findings …`. Run the verifier wave (`local-ci` runs `npm run ci:local`; `reviewer` + `qa-engineer` + `charter-checker`) with `isolation: "worktree"`. Auto-merge per standing grant. Twin ritual after merge.

---

### Prerequisite B (MAIN SESSION, founder-gated): publish + allowlists

Not a subagent task — publish is credential-gated.

- [ ] **Step 1: Publish `@de-braighter/board-recipes@1.0.0`**

```bash
cd /d/development/projects/de-braighter/layers/board-recipes
git checkout main && git pull
npm run build
npm publish    # GITHUB_TOKEN needs write:packages
```
Expected: `+ @de-braighter/board-recipes@1.0.0`. Verify it resolves:
```bash
npm view @de-braighter/board-recipes version
```

- [ ] **Step 2: Allowlist in studio (pnpm release-age gate)**

Add to `domains/studio/pnpm-workspace.yaml` under `minimumReleaseAgeExclude:`:
```yaml
  - '@de-braighter/board-recipes@1.0.0'
```
(exercir is npm — no release-age gate, no allowlist needed.)

---

### Task 3: SP2 — exercir de-fork onto the published recipe

**Repo:** `de-braighter/exercir` (clone at `domains/exercir`). Parallel-eligible with Task 4.

**Files:**
- Modify: `libs/pack-kids-football-ui/src/lib/drills/sketch/board-kit/kf-registry.ts` (import)
- Modify: `libs/pack-kids-football-ui/src/lib/drills/sketch/board-kit/kf-registry.spec.ts` (import)
- Modify: root `package.json` (add dependency)
- Delete: `libs/pack-kids-football-ui/src/lib/drills/sketch/board-kit/kf-drill.recipe.ts`
- Unchanged (gate + oracle): `kf-registry-parity.spec.ts`, `parity-legacy/**`

**Interfaces:**
- Consumes: `kfDrillRecipe` from `@de-braighter/board-recipes`.
- Produces: `makeKidsRegistry(translate)` unchanged signature — `interpretRecipe(kfDrillRecipe, { translate })`.

- [ ] **Step 1: Branch from up-to-date main**

```bash
cd /d/development/projects/de-braighter/domains/exercir
git fetch origin main -q && git checkout -B feat-board-recipes-defork origin/main
```

- [ ] **Step 2: Add the dependency + install**

Add to root `package.json` `dependencies`:
```json
    "@de-braighter/board-recipes": "^1.0.0",
```
Then:
```bash
npm install   # GITHUB_TOKEN set
```
Expected: `@de-braighter/board-recipes@1.0.0` resolved from GitHub Packages.

- [ ] **Step 3: Redirect the two imports**

In `kf-registry.ts`, replace:
```ts
import { kfDrillRecipe } from './kf-drill.recipe.js';
```
with:
```ts
import { kfDrillRecipe } from '@de-braighter/board-recipes';
```
In `kf-registry.spec.ts`, replace the same `import { kfDrillRecipe } from './kf-drill.recipe.js';` line with `import { kfDrillRecipe } from '@de-braighter/board-recipes';`.

- [ ] **Step 4: Delete the local literal**

```bash
git rm libs/pack-kids-football-ui/src/lib/drills/sketch/board-kit/kf-drill.recipe.ts
```

- [ ] **Step 5: Run the byte-parity gate + registry spec — verify still green**

```bash
npx nx test pack-kids-football-ui -- --run kf-registry-parity kf-registry
```
Expected: PASS — the 26/26 byte-parity gate (`kf-registry-parity.spec.ts`) and `kf-registry.spec.ts` both green against the published recipe. (If a "cannot find module '@de-braighter/board-recipes'" error appears, the package didn't install — recheck Step 2 + GITHUB_TOKEN.)

- [ ] **Step 6: Build the UI lib — verify it compiles**

```bash
npx nx build pack-kids-football-ui
```
Expected: build succeeds (the new import resolves, no dangling reference to the deleted file).

- [ ] **Step 7: Commit + PR**

```bash
git add libs/pack-kids-football-ui/src/lib/drills/sketch/board-kit/kf-registry.ts \
        libs/pack-kids-football-ui/src/lib/drills/sketch/board-kit/kf-registry.spec.ts \
        package.json package-lock.json
git commit -m "feat(kids-football): load the drill recipe from @de-braighter/board-recipes (de-dup, byte-parity preserved)"
gh pr create --fill --title "feat(kids-football): single-source drill recipe via @de-braighter/board-recipes"
```
PR body: `Producer:` / `Effort: standard` / `Effect: cycle-time …` / `Effect: findings …`. Verifier wave (`local-ci` + `reviewer` + `qa-engineer` + `charter-checker` + **`exercir-charter-checker`**) with `isolation: "worktree"`. Auto-merge per standing grant.

- [ ] **Step 8: Browser-verify the live drill editor**

After merge (or in the worktree via `preview_start`), open `drills/new` and an existing `drills/:id` under the club-grass skin. Confirm: identical render; 0 console errors; keyboard move / resize (zone) / reshape (arrow) / delete still work. Twin ritual after merge.

---

### Task 4: SP3 — studio cookbook de-fork onto the published recipe

**Repo:** `de-braighter/studio` (clone at `domains/studio`). Parallel-eligible with Task 3.

**Files:**
- Modify: `libs/board-editor/src/lib/cookbook/index.ts` (re-export)
- Modify: `libs/board-editor/src/lib/cookbook/kids-drill-showcase.ts` (import + var)
- Modify: `libs/board-editor/src/lib/cookbook/kids-drill.recipe.spec.ts` (import + var → fidelity spec on the published recipe)
- Modify: `libs/board-editor/package.json` (peer + dev dependency)
- Modify: `pnpm-workspace.yaml` (allowlist — if not already done in Prereq B Step 2)
- Delete: `libs/board-editor/src/lib/cookbook/kids-drill.recipe.ts`
- Unchanged: `cookbook-translate.ts`

**Interfaces:**
- Consumes: `kfDrillRecipe` from `@de-braighter/board-recipes`.
- Produces: cookbook barrel re-exports `kfDrillRecipe` (renamed from `kidsDrillRecipe`).

- [ ] **Step 1: Branch from up-to-date main**

```bash
cd /d/development/projects/de-braighter/domains/studio
git fetch origin main -q && git checkout -B feat-board-recipes-defork origin/main
```

- [ ] **Step 2: Add the dependency + install**

Add `@de-braighter/board-recipes` to `libs/board-editor/package.json` in **both** `peerDependencies` and `devDependencies`:
```json
    "@de-braighter/board-recipes": "^1.0.0",
```
Ensure `pnpm-workspace.yaml` `minimumReleaseAgeExclude` has `- '@de-braighter/board-recipes@1.0.0'` (Prereq B Step 2). Then:
```bash
pnpm install   # GITHUB_TOKEN set
```

- [ ] **Step 3: Find every `kidsDrillRecipe` reference**

```bash
cd /d/development/projects/de-braighter/domains/studio
grep -rn "kidsDrillRecipe\|kids-drill.recipe'" libs apps --include=*.ts | grep -v node_modules
```
Expected hits: `cookbook/index.ts`, `cookbook/kids-drill-showcase.ts`, `cookbook/kids-drill.recipe.spec.ts` (and possibly the gallery app). Update them all in the next steps.

- [ ] **Step 4: Rewire the barrel `cookbook/index.ts`**

Replace:
```ts
export { kidsDrillRecipe } from './kids-drill.recipe';
```
with:
```ts
export { kfDrillRecipe } from '@de-braighter/board-recipes';
```
(Keep the other re-exports — `cookbookTranslate`, the showcase exports — as they are.)

- [ ] **Step 5: Rewire `kids-drill-showcase.ts`**

Replace `import { kidsDrillRecipe } from './kids-drill.recipe';` with `import { kfDrillRecipe } from '@de-braighter/board-recipes';`, and replace the `interpretRecipe(kidsDrillRecipe, …)` call's argument with `kfDrillRecipe`.

- [ ] **Step 6: Rewire the fidelity spec `kids-drill.recipe.spec.ts`**

Replace `import { kidsDrillRecipe } from './kids-drill.recipe';` with `import { kfDrillRecipe } from '@de-braighter/board-recipes';`, and replace every `kidsDrillRecipe` usage in the body (`validateRecipe(kidsDrillRecipe)`, `interpretRecipe(kidsDrillRecipe, …)`) with `kfDrillRecipe`. The assertions (validates clean, 8 kinds, calc/handles/i18n primitives) are unchanged — they now prove the **published** recipe.

- [ ] **Step 7: Update any remaining hit from Step 3** (e.g. the gallery app importing `kidsDrillRecipe`) to `kfDrillRecipe` from the barrel or the package.

- [ ] **Step 8: Delete the local literal**

```bash
git rm libs/board-editor/src/lib/cookbook/kids-drill.recipe.ts
```

- [ ] **Step 9: Run the cookbook specs — verify green**

```bash
cd /d/development/projects/de-braighter/domains/studio
pnpm --filter @de-braighter/board-editor test
```
Expected: PASS — `kids-drill.recipe.spec.ts` (fidelity), `kids-drill-showcase.spec.ts`, and the gallery specs green against the published recipe. (Module-not-found ⇒ recheck Step 2 install.)

- [ ] **Step 10: Build the board-editor lib — verify it compiles**

```bash
pnpm --filter @de-braighter/board-editor build
```
Expected: build succeeds; no dangling reference to the deleted file.

- [ ] **Step 11: Commit + PR**

```bash
git add libs/board-editor/src/lib/cookbook/index.ts \
        libs/board-editor/src/lib/cookbook/kids-drill-showcase.ts \
        libs/board-editor/src/lib/cookbook/kids-drill.recipe.spec.ts \
        libs/board-editor/package.json pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "feat(board-editor): cookbook loads the drill recipe from @de-braighter/board-recipes (de-dup)"
gh pr create --fill --title "feat(board-editor): single-source drill recipe via @de-braighter/board-recipes"
```
PR body: `Producer:` / `Effort: standard` / `Effect: cycle-time …` / `Effect: findings …`. Verifier wave (`local-ci` + `reviewer` + `qa-engineer` + `charter-checker`) with `isolation: "worktree"`. Auto-merge per standing grant.

- [ ] **Step 12: Browser-verify the cookbook thumbnail**

Open the Cookbook gallery (`apps/board-editor-ui`) and confirm the kids-drill worked-example thumbnail renders unchanged across night / ivory / clinical themes; 0 console errors. Twin ritual after merge.

---

## Completion check (the headline acceptance)

- [ ] `find domains/exercir domains/studio -name "kf-drill.recipe.ts" -o -name "kids-drill.recipe.ts"` returns nothing tracked (both deleted).
- [ ] Both consumers import `kfDrillRecipe` from `@de-braighter/board-recipes`.
- [ ] exercir `kf-registry-parity.spec.ts` green (26/26).
- [ ] `@de-braighter/design-system-core` + substrate kernel diff = empty (zero engine/kernel change).
- [ ] exercir drill editor + studio cookbook thumbnail render identically to pre-change.
