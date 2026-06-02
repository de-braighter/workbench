# What-If Comparison-Overlay UI Implementation Plan

> **For agentic workers:** execute task-by-task with TDD. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Connect the existing `posterior-comparison-chart` to the real `/players/:id/what-if` endpoint (#119) via a schema mirror + client, and add a WCAG-complete `PlayerWhatIfChrome` overlay (toggle + delta strip + arm labels).

**Architecture:** `pack-football-ui` mirrors wire shapes (no `pack-football` import). The chrome is presentational; the funnel page is the smart container that fetches + falls back to demo data. Design: `docs/superpowers/specs/2026-06-02-pack-football-what-if-comparison-overlay-ui-design.md`.

**Tech Stack:** Angular 21 standalone + signals (OnPush), Zod wire mirrors, vitest (`@nx/angular:unit-test`).

---

### Task 1: Mirror the WhatIf wire schemas + parity

**Files:** Modify `libs/pack-football-ui/src/lib/data/wire-schemas.ts`; modify `libs/pack-football-ui/src/lib/data/wire-schemas-parity.spec.ts` (or the existing parity spec).

- [ ] **Step 1:** Read the existing `wire-schemas.ts` (the `PlayerProjectionWireSchema` mirror pattern) + the parity spec (how it source-text-guards against the canonical pack-football file).
- [ ] **Step 2 (test):** Extend the parity spec — assert the canonical `compare-drill-what-if.use-case.ts` text contains each mirrored field (`treeRootId`, `liftMean`, `liftP50`, `direction`, `runId`, the arm quantiles). Run → fails (schema not added).
- [ ] **Step 3 (impl):** Add `WhatIfArmSchema` + `WhatIfComparisonSchema` (+ `WhatIfComparison`/`WhatIfArm` types) per spec §D1. Run parity spec → green.

### Task 2: `compareWhatIf()` client method

**Files:** Modify `libs/pack-football-ui/src/lib/data/substrate-client.ts`; modify its spec.

- [ ] **Step 1:** Read `substrate-client.ts` `getPlayerProjection()` (POST + headers + Zod parse + `SubstrateClientError` wrapping).
- [ ] **Step 2 (test):** Spec — mock fetch returns a valid `WhatIfComparison` body → `compareWhatIf()` resolves the parsed object; a non-2xx → `SubstrateClientError('http-error')`; a malformed body → `schema-mismatch`. Run → fails.
- [ ] **Step 3 (impl):** Add `compareWhatIf(playerId, { baselineTreeRootId, counterfactualTreeRootId, indicatorKey? }, signal?)` → `POST /pack-football/players/:id/what-if`, validate with `WhatIfComparisonSchema`. Run → green.

### Task 3: `WhatIfComparison → PosteriorComparison` mapper + `PlayerWhatIfChrome`

**Files:** Create `libs/pack-football-ui/src/lib/player/ui/player-what-if-chrome.component.ts`; create its `.spec.ts`. (Mapper lives in the same file as an exported pure fn.)

- [ ] **Step 1 (test, mapper):** Spec — `toPosteriorComparison(comparison, labels)` renames fields per spec §D4 (arms→summaries, `runId`→`inputHash`). Run → fails.
- [ ] **Step 2 (impl, mapper):** Implement the pure mapper. Run → green.
- [ ] **Step 3 (test, chrome):** Spec — given a `WhatIfComparison` input: the toggle `<button>` has `aria-expanded=false` initially + flips on click (body shows/hides via `aria-controls` target); the three `direction` values render `▲`/`▼`/`—` (aria-hidden) + the correct sr-only sentence ("verbessert/verschlechtert/unverändert") + the `pp` lift text; the embedded `lib-posterior-comparison-chart` receives the mapped comparison. Run → fails.
- [ ] **Step 4 (impl, chrome):** Implement `PlayerWhatIfChrome` per spec §D3 (standalone OnPush, `comparison` required input + optional labels, `expanded` signal, delta strip, embedded chart). Run → green.
- [ ] **Step 5:** Commit.

### Task 4: Wire the chrome into the funnel page

**Files:** Modify `libs/pack-football-ui/src/lib/player/fc-player-funnel-page.component.ts`; modify its spec.

- [ ] **Step 1:** Read `player-seeds.ts` (`DRILL_X_KEY`/`DRILL_Y_KEY`) + the plan-tree shape from `substrate-client.getPlanTree`. Determine whether plan-nodes expose intervention keys + UUID ids resolvable to baseline/counterfactual tree-roots.
- [ ] **Step 2 (test):** Page spec — when the loaded view has a comparison, the page renders `lib-player-what-if-chrome` (replacing the bare chart + meta-row). When `compareWhatIf` resolves a real comparison (mock the client), the chrome shows real data; when tree-roots don't resolve, the demo fallback note renders. Run → fails.
- [ ] **Step 3 (impl):** Render `PlayerWhatIfChrome` in the `@if (comparison)` branch. Add the resolution: match `DRILL_X_KEY`/`DRILL_Y_KEY` against the loaded plan-tree nodes → tree-root UUIDs; when both resolve, `compareWhatIf(...)` and map to the chrome; else fall back to the port comparison (mapped) + a "Demo-Daten" note. **If the seed exposes no resolvable roots, keep the fallback as the live path + add a `// TODO(#120-seed)` + note in the PR.** Run → green.
- [ ] **Step 4:** Commit.

### Task 5: Build verify + full lib suite

- [ ] **Step 1:** `npx nx build pack-football-ui` → green.
- [ ] **Step 2:** `npx vitest run --config libs/pack-football-ui/vitest.config.ts` (or the lib's test target) → green; no regressions in the funnel-page / chart specs.
- [ ] **Step 3:** Final commit + verifier wave.
