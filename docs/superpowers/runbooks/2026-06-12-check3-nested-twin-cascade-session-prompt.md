# Session prompt — north-star Check 3: nested-twin down-cascade (Phase 2)

Paste everything below the rule into a fresh Claude Code session launched from
`D:/development/projects/de-braighter/`.

---

Continue the north-star kernel-proof path (thesis-test ladder, specs#298) — **Check 3**.

CONTEXT (verify, don't re-derive):

- Read memory FIRST: north-star-thesis-test-arc + adr-224-inference-effects-build-state
  + substrate-inference-two-stacks + exercir-pack-football-demo-runtime.
- State as of 2026-06-12 (late): substrate 2.0.0 published (ADR-224 + full B3 survival
  train). exercir on 2.0.0 (#237) and shipping the LIVE Check-2 coach decision (#242,
  squash 63a2291): what-if overlay readiness readout, commit ⇔ P(form_index ≥ 70) ≥ 0.70
  per arm, flips on declared variance (3-tier pinned: `normal-tail-probability.spec.ts`
  → `what-if-decision-relevance.spec.ts` through the real router → real-AppModule HTTP).
  **Option A RATIFIED + EXECUTED** (specs#299, squash b7a76b9): ADR-218 amended in place —
  §"The thesis-test gate" now binds **Check 3 as the gate on ADR-218 step 2's
  (WS-9 ‖ inference-depth) completion claim**; Check 4 gates the step-3 registry; any
  FAIL/too-costly → Option-B deferral ADR with explicit re-test trigger (never silent
  continuation). Ledger current on specs#298: C1 FAIL · C2 crit-1 CLOSED · C2 crit-2
  (re-conditioning) deferred→C3 · C2.5 pro-thesis · C5 PASS · C3, C4 not run.

TASK — run **Check 3: nested-twin down-cascade** (strategy Phase 2, same host as
Check 2: exercir pack-football).

- PASS criterion (strategy §4, carried into ADR-218): a **team-level what-if produces
  per-member (per-player) assignments AND a correctly-aggregated team posterior**,
  surfaced on the result shape (EB-hierarchical "Tier 5"). This is where the deferred
  `condition()` / re-conditioning doubt (C2 criterion-2) is concentrated — the check
  must either make re-conditioning real or show the cascade doesn't need it (and say
  so explicitly on the ledger).
- FAIL / too-costly: per amended ADR-218, write the **Option-B deferral ADR** with an
  explicit re-test trigger (e.g. "first domain whose value proposition requires the
  collapse") — that outcome is a legitimate result, not a failure of the session.
- **Design first** (brainstorming → this is kernel-shaped: pull `substrate-architect`
  for any new port/result-shape surface; `designer` if it stays pack-side composition).
  Key inventory to verify before designing: ADR-198 EB-hierarchical adapter (aggregate
  subjects partial-pool via `MemberResolution`), the team-twin endpoint
  (`POST …/teams/:id/twin` — address by AGGREGATE id `a661e6a7-…fc1a55e1a661`, not team
  key), pack-side `compareMulti`, and the **known gap that likely becomes due**: the
  kernel's EB-hierarchical counterfactual paired handles do NOT share a manifest
  (ADR-165 Inv-5 — pinned by a deliberate substrate test, "fix when EB cf is promoted";
  Check 3 is exactly that promotion). `condition()`/`cohortMarginal`/`identify` return
  typed `not-implemented-phase-1` today.
- Verdict + evidence go to specs#298 (in-tree regression specs preferred over session
  artifacts — ledger discipline per ADR-218 §The thesis-test gate).

PROCESS (non-negotiable):

- Worktree-isolate EVERY repo you touch (`git -C <repo> worktree add ../<repo>-wt-<name>
  -b <branch> origin/main`); NEVER git ops in the shared main clones (other sessions use
  them; exercir carries a kids-football worktree). Fetch + verify origin/main first.
  Fresh `npm install` per worktree (main-clone node_modules can be STALE; needs
  GITHUB_TOKEN with read:packages).
- If the design needs kernel surface: substrate work follows substrate conventions
  (`substrate-coder-pro`, `Promise<Result<T,E>>` at ports, ESM `.js` imports, versioned
  publish — domains consume via registry only; additive ⇒ 2.1.0, breaking ⇒ major per
  the ratified semver rule), then bump the consumer. Any new ADR goes through
  layers/specs PR-gated (lint gate: `bash tools/lint-md.sh <file>` +
  `node tools/validators/frontmatter-schema.mjs <file>`).
- writing-plans → subagent-driven-development (always subagents, never inline).
- PR-first: open PR before the wave; ADR-086 needs `Closes #<story>` (create story issue,
  mark standalone) — `gh pr edit` is broken on this token, use
  `gh api -X PATCH repos/de-braighter/<repo>/pulls/<n> -F body=@file`.
- Verifier wave per repo: local-ci + reviewer + charter-checker + qa-engineer
  (+ exercir-charter-checker on exercir PRs). Read-only-git discipline in every prompt;
  reviewers receive the ratified contracts: ADR-224, ADR-218 (as amended — §The
  thesis-test gate), substrate `docs/migration-substrate-2.0.md`.
- Findings: `post-findings de-braighter/<repo>#<pr> file.json` BEFORE merge (omit null
  path/line; paths/lines MUST sit in PR-diff hunks or the API 422s — use path-less
  entries otherwise); `drain <repo>#<pr>` (0 for in-session agents is fine). After
  merge: `backfill de-braighter/<repo>`, `reconcile <repo>#<pr>`, `reviews` +
  `resolve-findings de-braighter/<repo>`.
- PR body: `Producer: orchestrator/<model> [skills]`, `Effort: standard|deep`,
  `Effect: cycle-time 0.01±0.01 expert` (+ `findings n±sd expert` when defensible).
- Env quirks: python3 missing (use node); /tmp = `C:\Users\stibe\AppData\Local\Temp`;
  exercir node-project tests via `npx vitest run --config <proj>/vitest.config.ts
  <filter> --coverage.enabled=false` (nx-test exit-1 quirk) but UI project via
  `npx nx test pack-football-ui --include='**/<file>.spec.ts'`; `nx build/test` do NOT
  run eslint — `npx nx lint` is a separate gate; netstat prints German ("ABHÖREN");
  chrome-devtools MCP works for browser proof (funnel route:
  `/t/fc-langgasse/p/football/player/funnel?...`).

AFTER (don't start, just tee up): Check 4 (flywheel toy) is Phase 3 and only makes sense
after Check 3 PASS — it gates the ADR-218 step-3 vendor-only registry. If Check 3
produced an Option-B deferral instead, the next move is founder review of the deferral
ADR, not Check 4.
