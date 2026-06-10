# Quality-floor prove-itself — 2026-06-10 (Foundry F5, spec §8)

The deterministic battery ran against real repos BEFORE becoming a `/new-domain`
default. All numbers below are from the live runs (no projections except where
marked). Companion kit PR: `de-braighter/foundation#11` (lint-kit 0.2.0 +
test-kit 0.2.0, published).

## A. knip on `domains/devloop`

- **Tool:** knip 6.16.1 (`--no-save` in a scratch worktree at `origin/main`
  3db8d28). **Runtime:** 3.8s first run, 3.2s tuned — noise next to the ~36s
  vitest suite.
- **Entry-point reality check:** knip's npm-script parser auto-detects
  `src/cli.ts`, the MCP server entry, and `tools/install-hooks.mjs`. Three
  entry kinds it canNOT see and that must be hand-authored: external-harness
  hooks (`hooks/capture-verdict.mjs` — executed by Claude Code, imports
  `hooks/findings.mjs`), inline `tsx -e` imports in npm scripts
  (`src/knowledge-graph/index.ts` via `kg:rebuild`), and script-less manual
  utilities (`scripts/serve.mjs`). A naive config (entry = cli only) produced
  **13 false positives**.
- **Raw findings (tuned config):** 1 unused devDependency, 6 unused exports,
  20 unused exported types, 3 config hints.
- **Triage:**
  - `@prisma/client` unused devDep → **false positive**: the runtime imports
    the *generated* client via a computed-path dynamic import (statically
    invisible); `@prisma/client` is needed at generate time. Per-repo
    `ignoreDependencies: ["@prisma/client"]`.
  - 6 unused value exports (`formatPercent`, `DEFAULT_MANIFEST`, `OBSERVERS`,
    `COPILOT_LOGINS`, `commentToFinding`, `DEVLOOP_USER_ID`) → **true
    positives**: live code, needless `export` keyword. Mechanical fix.
  - 20 unused exported types → **false positives for action**: each is
    referenced by an *exported* signature; with `"declaration": true`,
    un-exporting breaks the build. Fix: `ignoreExportsUsedInFile:
    { interface: true, type: true }` — granular, so VALUE exports stay
    reportable.
  - Side finding: `scripts/serve.mjs` header references an `npm run serve`
    script that doesn't exist (doc/script drift).
- **Residual after tuning:** exactly the 6 true positives, zero false
  positives, 3.2s.
- **Verdict:** report-mode in `ci:local` + strict gate as a wave obligation is
  **workable**. Strict mode is safe only AFTER the one-time tuning pass
  (~15 min/repo); first run on a new repo must be report-mode.

## B. Stryker on `domains/devloop`

- **Versions:** `@stryker-mutator/core@9.6.1` + `vitest-runner@9.6.1`
  (vitest peer `>=2.0.0` — devloop's vitest 2.1 and the template's vitest 4
  both satisfy it). Config mirrored `defineStrykerConfig({ tier: 't1' })`
  (kit unpublished at run time) + `vitest: { configFile: 'vitest.config.ts' }`
  — the hint was REQUIRED (devloop's config carries a load-bearing
  `exclude: '**/.claude/**'`); accepted without warnings. (Post-wave: the pnpm plugin-discovery gap below also dates this run's layout-specificity — see the addendum.)
- **Modules mutated (3 best-covered pure-logic modules, 486 LOC ≈ 10% of src):**
  `src/inference/calibration.ts`, `src/inference/whatif.ts`, `src/events.ts`.
- **Raw results:** 417 mutants, **score 75.54** (covered 78.16) — passes
  break=60. 304 killed / 11 timeout / 88 survived / 14 no-coverage / 0 errors.
  **Runtime 1m47s** (23 workers, perTest coverage analysis). Per file:
  events 87.63 · calibration 84.29 · whatif 68.40.
- **Survivor classes:**
  - *Missing assertion* (~35): e.g. `whatif.ts:180` `deltaPoint` `-`→`+`
    survived — the headline counterfactual delta's SIGN is only asserted
    `not.toBe(0)`. A user-facing sign flip would ship.
  - *Untested branch / weak fixture* (~30): dropping the repo filter in
    `prMergedIn` survived because every whatif fixture is single-repo — yet
    repo-conditioning is the module's stated confound control.
  - *Equivalent/near-equivalent* (~8, ~2%): float/timestamp boundary mutants;
    a break above ~90 would force contrived fixtures.
  - *Test-theater* (~12): warning/refusal paths are EXECUTED by tests (lines
    covered) but returned warning content is never inspected —
    `["Stryker was here"]` and `[]` both survived. Exactly the
    coverage-without-verification failure mode mutation testing exists to
    expose.
- **Verdicts:** t1 `break=60` is **realistic and well-calibrated** — strong
  files clear high=80; the deceptive one (whatif: ordinal-only assertions)
  lands in the warn band. Thresholds confirmed, no change. Full-repo
  extrapolation ≈ 12–40 min → **nightly/weekly cadence**; the per-PR shape is
  a targeted `mutate` on touched modules (~2 min for 3 files) or
  `--incremental`.

## C. `assertNonSuperuser` on conservation's role posture

- **Setup honesty:** conservation's literal container could not be started
  (host port 5432 occupied by an unrelated opted-out stack; old-project-name
  container conflict). Substitution: an isolated throwaway stack on port 5599
  with the **byte-identical** init SQL (sha256 `fb5c388d…` matched
  `docker/postgres-init/01-create-app-role.sql`) on the same image
  `postgres:16-alpine`. The guard reads only `pg_roles` attributes, which come
  entirely from that SQL — the proof carries. Conservation's container +
  volume untouched; the throwaway stack fully removed.
- **Postgres:** 16.13. Role rows: `substrate` rolsuper=t rolbypassrls=t;
  `substrate_app` rolsuper=f rolbypassrls=f.
- **Verbatim outcomes:**
  - superuser connection → `REJECTED by guard (SuperuserConnectionError:
    tests are connected as a superuser/BYPASSRLS role — FORCE RLS is bypassed
    and the suite proves nothing; connect with the NOBYPASSRLS app role)`
    *(expected)*
  - substrate_app connection → `PASSED guard` *(expected)*
- **Verdict:** the guard **discriminates** on a real RLS role posture. (The
  wave hardened it further post-run: case-folded + numeric-aware `truthy` so
  uppercase/numeric driver booleans cannot fail open — foundation#11.)

## What changed because of this

- knip preset now bakes in `ignoreExportsUsedInFile: { interface: true,
  type: true }` (granular).
- `defineStrykerConfig` gained the `vitestConfigFile` passthrough.
- Mutation tier thresholds **confirmed unchanged** (t0 report-only / t1
  break 60 / t2 break 75).
- ci:local posture confirmed: knip report-mode in the local gate, strict knip
  + mutation as tier obligations at wave time; mutation never in `ci:local`.

## Post-wave addendum (the wave extended the prove-itself)

The #115 verifier wave ran the battery against a REAL pnpm scaffold probe and
caught a layout-specific failure the devloop run structurally could not:
Stryker's plugin auto-discovery (a directory scan from @stryker-mutator/core's
own location) finds the vitest runner on npm's FLAT node_modules (devloop) but
NOT under pnpm's isolated layout (what `/new-domain` ships) — `stryker run`
died with "no TestRunner plugins were loaded" on first scaffold use; an
explicit `plugins: ['@stryker-mutator/vitest-runner']` fixes it. Fixed at kit
level in foundation 0.2.1 (`defineStrykerConfig` now emits the plugins entry
for the vitest runner) and re-proven on a pnpm scaffold. Also from the same
probe: `.stryker-tmp/` must be lint-ignored (0.2.1 preset) and gitignored, or
a mutation run breaks the next `ci:local` lint. Lesson for spec §8: prove-itself
runs must match the TARGET layout (pnpm), not just a convenient repo.

## What this does NOT prove

- No Angular-repo knip run (preset's UI-workspace shape unproven in anger).
- No T2-scale mutation run; no full-repo Stryker run (cost extrapolated, not
  measured).
- The guard is not yet wired into any existing repo's suite (newborn domains
  get it via `/new-domain`; retrofits are deliberate follow-ups per spec §5).
- knip strict-gate ergonomics on a repo with churn (only the tuned steady
  state was measured).
