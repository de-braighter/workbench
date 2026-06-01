# design-system: Sonar cleanup + coverage — Implementation Plan

> **Status:** drafted 2026-05-28 (post-EM-merge). Replaces the aspirational reference to `docs/superpowers/specs/2026-05-27-sonarqube-zero-issues-coverage-design.md` that PR #83 (de-braighter/design-system) cited in its body but was never written. PR #83 has been closed as superseded by EM Phase 5 (#115); this plan picks up the cleanup work it deferred.

**Scope:** `layers/design-system` only. Other cluster repos get their own per-layer plans.

## Context — verified ground truth (2026-05-28, against `main` @ `cb26fe6`, post-EM Phase 5)

Fresh local Sonar scan, **no exclusions beyond the default `node_modules`/`dist`/`*.spec.ts`/`*.stories.ts`:**

| Metric | Now | Target |
|---|--:|--:|
| Violations (total issues) | **737** | 0 |
| ↳ Code smells | 730 | 0 |
| ↳ Bugs | 7 | 0 |
| ↳ Vulnerabilities | 0 | 0 (hold) |
| Security hotspots | **108** | ≤10 unreviewed |
| Coverage | **0.0 %** | per-lib (see Phase 3) |
| Duplication | 1.3 % | hold (already excellent) |
| Analyzed LOC | 47,592 | n/a |

**Why we're not chasing PR #83's "245 / 40" numbers:** the EM merge **relocated** the 70 eyecatcher bricks + 69 contracts into `design-system-*` rather than deleting them, so the issue mass survived the merge — it just lives under new paths. Path exclusion is no longer a viable shortcut; only actual fixes move the needle.

**Tooling state (verified):**

- `@de-braighter/lint-kit` v0.1.6 ships **8 codemods** + ESLint preset. Covers Sonar rules already:
  - S3863 (`merge-duplicate-imports`), S7735 (`simplify-negated-condition`), S7773 (`prefer-number-namespace`), S7748 (`remove-zero-fraction`), S7778 (`combine-array-push`), S7781 (`prefer-replace-all`), `remove-unused-imports`, `window-to-global-this`.
  - **Not yet shipped:** S4325 (useless type assertions — PR #83 mentioned this as "via type-aware autofix"). Belongs in lint-kit, not in this plan; tracked as a foundation backlog item.
- **Design-system does NOT yet consume `@de-braighter/lint-kit`.** Its `eslint.config.mjs` uses its own rules. Adoption is the Phase 0 precondition for anything else.
- `vitest.config.ts` in `design-system-angular` currently runs with `passWithNoTests: true` — the retired Konva visual-editor brick (ADR-177) was its only spec carrier. Coverage tooling is wired (`@vitest/coverage-v8` v4.0.9 in devDependencies) but no `coverage:check` target exists.
- `sonar-project.properties` has a commented placeholder: `# sonar.javascript.lcov.reportPaths=coverage/lcov.info`. Uncommenting it is on the Phase 3 critical path.

## Goal + sequencing rationale

Bring the `de-braighter-design-system` project on local SonarQube to **quality-gate-clean** state. Three sequenced phases — strictly serial because each enables the next:

1. **Phase 0 — Adopt lint-kit** in design-system. One small PR; precondition for Phase 1.
2. **Phase 1 — Codemod sweep** of the 737 violations via lint-kit autofix + ESLint preset migration. Mechanical, no behavioral change. Several per-rule PRs.
3. **Phase 2 — Hotspot triage.** Most of the 108 hotspots in a UI lib are intrinsic (e.g., `Math.random()` for visual jitter) → mark *Reviewed* in the UI rather than churning code.
4. **Phase 3 — Coverage campaign.** From 0 % → per-lib targets. Multi-PR per-brick spec batches with ratcheting coverage thresholds.

**Why issue cleanup BEFORE coverage:** codemods rewrite AST shapes; tests written against pre-codemod code would force rewrites after every Phase 1 PR. Cleanup-first keeps the test-writing target stable.

**Tech stack:** `@de-braighter/lint-kit`, eslint flat config, vitest + `@analogjs/vitest-angular` + `@vitest/coverage-v8`, sonar-scanner (local via `npm run sonar:scan`).

**Repo/env:** `D:\development\projects\de-braighter\layers\design-system\`. Each PR branches off `main`. Local SonarQube at `localhost:9000` (`npm run sonar:up` if not running). Branch-recheck before every commit per the shared-working-tree concurrency rule.

---

## Phase 0 — Adopt `@de-braighter/lint-kit`

**Outcome:** design-system's `eslint.config.mjs` extends the lint-kit preset; `db-codemod` bin is reachable via `npm exec`. No code rewrites yet; this PR is purely tooling adoption.

**One PR.**

### Tasks

1. **Add dependency.** `package.json` (workspace root): `"@de-braighter/lint-kit": "^0.1.6"` under `devDependencies`. `npm install`.
2. **Extend the ESLint preset.** In `eslint.config.mjs`, import the lint-kit preset and spread it into the flat config:
   ```js
   import lintKit from '@de-braighter/lint-kit/eslint';
   export default [...lintKit, /* existing rules */];
   ```
   Verify `nx run-many -t lint` still passes (preset rules layer on; if any new rule fires on existing code, **don't** suppress here — log the count and let Phase 1 absorb it).
3. **Baseline scan.** `npm run sonar:scan`; record total issue count. Expected delta from 737: small (the preset surfaces a few new rules, but doesn't move codemod-addressable counts yet).
4. **Verify `db-codemod`.** The bin has no `--help` (foundation backlog item — see below); the reachability check is a dry-run against the workspace tsconfig:
   ```
   npm exec db-codemod -- --tsconfig tsconfig.base.json --dry --only window-to-global-this
   ```
   Exit 0 + a summary line like `0 edit(s) across N file(s) (dry run).` confirms the bin loads the project and a known codemod resolves.

### Exit criteria

- `lint-kit` in `devDependencies`, lockfile updated.
- `nx run-many -t lint` exit 0 (with new sonarjs/tseslint rules downgraded to `warn` in design-system if needed — see Phase 1 for the escalation path).
- `npm exec db-codemod -- --tsconfig tsconfig.base.json --dry --only window-to-global-this` exit 0.
- Sonar baseline recorded in PR description.

### Foundation backlog items surfaced during Phase 0

- `db-codemod` bin: add a `--help` flag that prints usage without loading a project.
- `db-codemod` bin: auto-detect `tsconfig.base.json` if no `tsconfig.json` exists (nx-workspace convention).
- Both belong in `foundation/packages/lint-kit/src/bin/apply-codemods.ts` + `src/codemods/run.ts` — not in scope for this plan.

---

## Phase 1 — Codemod sweep

**Goal:** reduce 737 violations toward 0 via mechanical autofix.

### Pre-flight (gates the whole phase)

- **Prettier story.** Lint-kit codemods assume prettier-clean files (per PR #83's note: "the active libs aren't prettier-clean"). Run `npx prettier --check 'libs/**/*.{ts,tsx,scss,css}'` first. If anything is dirty, **PR 1a:** `prettier --write` the whole `libs/` tree as its own commit, separately mergeable, before any codemod runs. This makes downstream codemod diffs reviewable.

### Per-rule sweep PRs

Run one PR per Sonar rule the toolkit can autofix. Pattern per PR:

1. `npm exec db-codemod -- --rule <name> libs/`
2. Spot-check ~5 rewritten files manually (look for obvious wrongness).
3. `npm run ci:local` → exit 0.
4. Scan; record before/after issue count in PR description.
5. Merge.

**Rule order (rough; do the highest-volume ones first to maximize signal):**

| Rule | Codemod | Expected volume |
|---|---|---|
| S1128 | `remove-unused-imports` | high (likely the biggest single hit) |
| S3863 | `merge-duplicate-imports` | medium |
| S7773 | `prefer-number-namespace` | medium |
| S7735 | `simplify-negated-condition` | low-medium |
| S7748 | `remove-zero-fraction` | low |
| S7778 | `combine-array-push` | low |
| S7781 | `prefer-replace-all` | low |
| n/a (window→globalThis) | `window-to-global-this` | low (UI lib, may be ~0) |

Plus a final PR for the **ESLint preset's auto-fixable residue** — `npx eslint --fix libs/`.

### Exit criteria

- Sonar issue count drops below **50** (or as low as autofixers can take it).
- The remaining issues are non-autofixable (typed S4325 or S-codes lacking codemods) — each one gets a `// TODO(sonar:S<rule>): <reason>` comment OR an issue in the foundation backlog for a new codemod.
- The 7 bugs are individually inspected; trivial ones fixed in a tail-end PR.

### Estimated PRs

4–8 (prettier-write + per-rule + cleanup).

---

## Phase 2 — Hotspot triage

**Goal:** 108 → ≤10 *unreviewed* security hotspots. Most reductions via *Reviewed-Safe* marking in the Sonar UI, not code changes.

This is a UI lib; expected hotspot rules:

- **S2245** (`Math.random()` in security context) — used for visual jitter in components like `magnetic-cursor`, `aurora-background`. **Mark Safe** with reason: "drives visual effect, no security context".
- **S5247** (`innerHTML` / `bypassSecurityTrustHtml`) — may appear in showcase mocks or markdown-rendering bricks. **Inspect each**; fix if user-data-bearing, mark Safe if known-static.
- **S4502** (CSRF protection disabled) — unlikely in a lib.
- **S5122** (CORS misconfig) — unlikely in a lib.

### Per-rule triage PRs

1. **Export hotspots** grouped by rule key via Sonar UI or API (`/api/hotspots/search?projectKey=de-braighter-design-system`).
2. **Group:**
   - **Safe → mark Reviewed/Safe in UI** (no PR, just a comment trail on each hotspot citing the rationale). This is acceptable per Sonar conventions; it persists with the project.
   - **Needs fix → PR per cluster** (e.g., "fix S5247 in markdown-renderer brick").
3. **Burn-down report** in the umbrella issue.

### Exit criteria

≤10 *unreviewed* hotspots remain. The rest are either fixed or marked Safe with rationale.

### Estimated PRs

1–3 (mostly review-marking; only ~1 code-change PR expected).

---

## Phase 3 — Coverage campaign

**Goal:** from 0.0 % → per-lib targets, with a ratcheting threshold gate.

### Per-lib targets

| Lib | Target | Reason |
|---|--:|---|
| `design-system-core` | ≥ 80 % | pure TS — math, tokens, contracts, workflows; cheapest LOC/test ratio |
| `design-system-angular-forms` | ≥ 70 % | small surface; CVA contracts are unit-testable |
| `design-system-angular` | ≥ 50 % | 81 bricks; ≥80 % is its own multi-month follow-up |
| `design-system-css` | n/a | no TS source — skip; Sonar coverage metric inapplicable |

Cluster-level target (lib-weighted): **≥ 60 %**.

### PR 3a — vitest revival + coverage wiring

**One PR; precondition for the rest.**

- Drop `passWithNoTests: true` from `vitest.config.ts` once the first real spec lands (in this PR).
- Add `coverage: { reporter: ['text', 'lcov'], reportsDirectory: '../../coverage/<lib>' }` to each lib's `vitest.config.ts`.
- Add `coverage:check` target via nx that runs `vitest run --coverage --coverage.thresholds.lines=X` with X starting at **current+5 %** of each lib.
- Wire `sonar-project.properties`: uncomment `sonar.javascript.lcov.reportPaths=coverage/**/lcov.info` (glob across the per-lib reports).
- Land **one canonical brick spec** (e.g., for `design-system-core`'s `math/raf.ts`) so the coverage value is non-zero and the threshold gate is real.
- Update `CLAUDE.md` (the design-system one) — drop the ADR-177-era stopgap note about `passWithNoTests`.

### PR 3b–N — per-brick spec batches

Pattern: **~5 bricks per PR**, each spec covering:

- **Contract test** — the brick's exported contract type (`design-system-core/contracts/<brick>.ts`) round-trips a fixture.
- **Render test** — the brick mounts under `@analogjs/vitest-angular` and emits its template.
- **Key-behavior test** — one or two interaction behaviors (click, signal write, lifecycle).

Ratchet the `coverage.thresholds.lines` in `vitest.config.ts` by ~5 % after each batch PR; never DEcrease.

**Suggested brick batching order:**

1. `design-system-core` math + tokens — fastest LOC/test ratio.
2. `design-system-core` contracts + workflows — pure TS, no Angular harness needed.
3. `design-system-angular-forms` CVA components — small set, finite.
4. `design-system-angular` bricks in alphabetical batches of 5.

### Exit criteria

- Per-lib coverage at or above the targets above.
- Sonar quality gate passes on `new code` and `overall`.
- `CLAUDE.md` reflects the spec discipline (each new brick lands with a spec).

### Estimated PRs

12–20 (revival + ~15 batch PRs + a few threshold-ratchet PRs).

---

## Risks + mitigations

- **Lint-kit codemod regressions on edge cases** — even mechanical AST rewrites mis-handle some shapes. Mitigation: per-rule PR, `ci:local` gate, manual spot-check of 5 rewrites per rule. The `lint-kit` package has unit tests per codemod (`*.spec.ts`); rely on them as the trust foundation.
- **The 7 bugs may not be trivial.** Mitigation: inspect them after Phase 1; if any are actual UI bugs (not Sonar false positives), promote them out of this plan into their own bugfix issues. Don't block Phase 1 completion on them.
- **Coverage campaign exposes pre-existing bugs in moved bricks.** The post-EM bricks have never been unit-tested. Mitigation: when a spec uncovers a behavior issue, log it as a new bug issue and ship the spec with a `.skip` + comment; don't entangle the coverage-PR with bugfix work.
- **Sonar quality gate too strict on day 1.** Default gate may fail on `coverage on new code` or other thresholds. Mitigation: tune the project's gate to ratchet alongside the campaign — don't try to pass the default gate before Phase 3 lands.
- **Branch concurrency (shared-working-tree memory).** Verify branch before every commit; use ref-based git operations (`branch -f`, `gh pr merge`, `push --delete`); avoid `--delete-branch` in `gh pr merge`.
- **Foundation backlog dependency (S4325 codemod).** Phase 1 won't fully clear S4325 violations until `@de-braighter/lint-kit` ships a codemod for it. Mitigation: leave S4325 as a long-tail TODO in Phase 1 exit; raise a foundation issue tracking the codemod; revisit Phase 1 once it lands.

---

## Out of scope (deliberately deferred)

- **Cluster-wide sonar cleanup.** Each layer + domain repo gets its own plan; this one is design-system only.
- **Visual regression test infra** (open issue #55 in `de-braighter/design-system`) — orthogonal, doesn't move sonar numbers.
- **Showcase app coverage** (`apps/showcase`) — consumer code; its sonar issues stay in scope (Phase 1) but its coverage is not load-bearing for the lib-quality gate.
- **Migrating off SonarQube.** Tool choice is settled.
- **`@de-braighter/lint-kit` S4325 codemod.** Belongs to the foundation repo's backlog.
- **Adoption of lint-kit in other cluster repos.** Each repo's plan handles its own adoption.

## Tracker

- Umbrella tracking issue: TBD — open one on `de-braighter/design-system` with phase checkboxes once Phase 0 PR ships.
- Per-phase PR labels: `area:sonar` + `phase:0` / `phase:1` / `phase:2` / `phase:3` (label set TBD on the repo).
