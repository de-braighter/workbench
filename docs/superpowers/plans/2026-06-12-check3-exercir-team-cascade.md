# Check-3 Exercir Consumer Arc — Team What-If over the ADR-225 Cascade

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Implementer agent type: **implementer** (exercir domain). Steps use checkbox syntax.

**Goal:** Adopt substrate 2.1.0 in `domains/exercir` and ship the Check-3 demonstration: a team-level what-if over the FC Länggasse aggregate that returns per-member intervention assignments (weight-proportional, conservation-exact) plus the pooled team posterior — the consumer half of the specs#298 Check-3 verdict.

**NORMATIVE CONTRACTS:** ADR-225 (ratified, incl. the 2026-06-12 touch-up — `layers/specs/adr/adr-225-tier5-down-cascade-allocation-algebra.md`) + substrate `docs/migration-substrate-2.1.md`. ADR wins over this plan.

**Design decisions (made 2026-06-12, follow the module's own follow-up note):**
1. **Roster weights become synthetic minutes** (charter-pinned POC): Studer 900, Caprez 810, Roduit 720, Camenzind 630 — and the **youth call-up joins as a 5th member with weight 0** ("in squad, no minutes yet"). This makes the weight-proportional split differential AND reproduces the kernel O4 coupling demo with the real demo characters (zero-dose member moves only through the team pool).
2. **A NEW team-scoped tree pair** (`load-block-a` / `load-block-b`) carries `allocation: 'weight-proportional'` pass_completion point effects (team-total log-odds budgets). The Check-2 drill X/Y trees are UNTOUCHED (their narrative + all existing oracles stay intact; individual calls over wp trees are the ADR's named wrong-query failure mode — we don't create that trap in the demo).
3. **No UI this slice** — Check 3's PASS criterion is the result shape; coach surfacing is a named follow-up.

---

## Environment & ground rules (every subagent)
- Workspace: `D:\development\projects\de-braighter\domains\exercir-wt-check3` (worktree, branch `feat/check3-team-cascade`, created by the orchestrator off origin/main with fresh `npm install` AFTER the dep bump task lands the lockfile). NEVER git against `domains/exercir` (main clone — other sessions share it).
- Tests: `npx vitest run --config libs/pack-football/vitest.config.ts <filter> --coverage.enabled=false` (and `apps/pack-football-api/vitest.config.ts`); `nx build/test` don't run eslint — `npx nx lint pack-football pack-football-api` is the gate. ESM `.js` extensions.
- The youth call-up id is exported from `inference-backbone.providers.ts` (`SEEDED_YOUTH_CALLUP_PLAYER_ID`); the team AGGREGATE id is `SEEDED_FC_LANGGASSE_TEAM_AGGREGATE_ID` (in `pack-football-member-resolution.ts`); address the team by AGGREGATE id, never team key.
- Commit per task; `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

### Task 1: Dep bump ^2.1.0 + fallout
- `package.json`: `@de-braighter/substrate-contracts` + `@de-braighter/substrate-runtime` → `^2.1.0`; `npm install`; verify resolved 2.1.0.
- Run FULL pack-football + pack-football-api suites. Expected fallout per the migration doc: (a) aggregate handles now carry `cascade` — any deep-equal handle assertion in team-twin specs must accommodate it; (b) EB `sample()` draw streams changed — re-pin only if a spec pinned absolute draws; (c) exhaustive switches over `InferenceErrorPhase1`?? exercir's `translate-inference-error.ts` has a `const _: never` guard — the NEW `effect-not-allocatable` kind WILL fail compilation: add the explicit arm (route → `inference-unavailable`, sibling of `effect-not-conjugable`, detail naming allocation+reason) + spec case. Report every re-pin with derivation.
- Gates green; commit.

### Task 2: Minutes weights + 5th member (member resolution)
- `pack-football-member-resolution.ts`: replace `EQUAL_POOLING_WEIGHT` with per-member synthetic minutes (900/810/720/630/0 as above; doc comment: synthetic POC minutes per the charter pin; weight 0 = called up, no minutes — the coupling demo subject). Youth call-up joins the roster mapping.
- Blast radius: team-twin posterior changes (weighted MoM + 5th member). Re-pin affected oracles BY HAND (show derivations); the youth's own individual surfaces are untouched.
- Full suites + lint green; commit.

### Task 3: Team-load seed pair (the wp trees)
- In `drill-subtrees-seed.ts` style (shared builders): add `LOAD_BLOCK_A_SUBTREE` / `LOAD_BLOCK_B_SUBTREE` — roots + intervention child each, pass_completion **point** effects via `passPointEffect` BUT with `allocation: 'weight-proportional'` (extend the shared builder with an optional `allocation` param — additive, default absent) — budget intents e.g. A = 1.1×, B = 1.4× (re-expressed log-odds team-total budgets; doc the semantics: a TEAM budget, split by minutes). New stable root ids in the `fc1a55e1` family. Seed them in BOTH the in-memory `registerTree` (derive from the spec array as Task-2-of-#242 did) and the DB-path seed array.
- Evidence-seed spec re-pins for the two new trees; full suites; commit.

### Task 4: `CompareTeamWhatIf` use-case + service
- New in-port `compare-team-what-if.use-case.ts`: input `{ tenantPackId, teamSubjectRef (aggregate), baselineTreeRootId, counterfactualTreeRootId, indicatorKey? (default pass_completion) }`; result: zod schema with per-arm `{ team: WhatIfArm-like summary, members: [{ subjectId, weight, allocatedEffect: DistributionSpec|null, mean, sd, p10, p50, p90 }] (sorted) }` + `liftMean`/`direction` (reuse polarity) + `allocation` + shared `runId`. REJECT non-aggregate subjects (mirror of the player service's individual gate).
- Service: one scoped `counterfactual()` call; map both arms' `handle.cascade` → members (fail typed if cascade absent — it's required for aggregates per ADR-225 OQ-2); `momentArmsOf` for the team summaries; reuse `translateInferenceError`.
- Specs: real-router harness (the #242 decision-relevance spec's pattern): (a) happy path over the in-memory seed — allocation echoed, members sorted, **conservation at the consumer**: Σ allocatedEffect.value across members `toBe` the declared team budget per arm; (b) **the pack-level O4 echo**: youth (weight 0) allocated exactly 0 in both arms, raw invariance not directly visible pack-side — assert his per-arm member SUMMARIES differ across arms (coupling through the pool) with a comment citing the kernel O4 spec; (c) non-aggregate subject → typed refusal; (d) decision-block: NONE (no readiness rule here — YAGNI).
- Commit.

### Task 5: HTTP endpoint + integration proof
- `POST /pack-football/teams/:id/what-if` on the existing controller (TenantContext pattern, `RequiresPermission(projectionRun)`, body schema mirroring the player what-if, subject `{kind:'aggregate', id, role:'football.team'}`); `inferenceFailureStatus` reuse.
- Controller unit specs (stub use-case: input-capture incl. derived tenantPackId + the 4 failure kinds) + REAL-AppModule integration spec: team aggregate id + the load-block trees → 201 with cascade members (5, sorted), conservation Σδᵢ = budget, youth weight-0/allocated-0, team summaries present, shared runId. Numbers hand-derived where exact (weights {900,810,720,630,0}: W=3060 — NOT power-of-two; conservation still EXACT? δ·(wᵢ/W) summed = δ·(Σwᵢ/W) — float: Σ(wᵢ/W) may not be exactly 1 → use toBeCloseTo(budget, 12) for the sum and exact toBe for each δᵢ recomputed with the same expression; document).
- Full suites + lint + `npm run ci:local`; commit.

### Orchestrator finish
Story issue (standalone, links #298 + ADR-225) → PR-first (`Producer: orchestrator/claude-fable-5 [...]`, `Effort: deep`, `Effect: cycle-time 0.01±0.01 expert`, `Effect: findings 3±2 expert`) → wave (local-ci + reviewer + charter-checker + qa-engineer + exercir-charter-checker; contracts: ADR-225 + migration-2.1 doc) → findings → merge → ritual → **Check-3 verdict comment on specs#298** (PASS criterion vs evidence: substrate in-tree specs O1–O4/Inv-5/determinism + this arc's consumer integration + Commitment-6 condition()-not-required adjudication + honest caveats: EB point-estimate under-propagation, one-level, beta-family only, UI follow-up) → memory update → worktree cleanup.
