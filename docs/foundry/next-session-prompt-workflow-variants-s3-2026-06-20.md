# Next-session prompt — S3: per-product workflow-instance wiring (T0/T2 variants)

Build **S3 — the per-product workflow-instance wiring** — the final slice of the foundry T0/T2
workflow-variants arc. S1+S2 (the variant specs + the selector) are SHIPPED + MERGED; this wires them
into the running conductor + cockpit so each product runs the pipeline its `riskTier` selects, keyed
per product.

== READ FIRST ==
- **The S3 design doc (your spec — read it fully):**
  `docs/superpowers/specs/2026-06-20-foundry-workflow-variants-s3-per-product-wiring-design.md` (on
  workbench main). It has the instance-key model, the 4 mechanical generalizations, the resolved
  sub-decisions, the S3a/S3b/S3c decomposition, and the acid posture.
- The S1+S2 design + ADR: `docs/superpowers/specs/2026-06-20-foundry-workflow-t0-t2-variants-design.md`
  + `layers/specs/adr/adr-269-foundry-workflow-t0-t2-variants.md` (ratified).
- Memory [[foundry-substrate-self-application-arc]] (updated 2026-06-20 — the "T0/T2 WORKFLOW VARIANTS
  S1+S2 LANDED" entry has the full state, gotchas, and the S3 queue).

== WHAT'S ALREADY DONE (merged) ==
- `domains/foundry#35` (`0db04fb`) — `src/instances/workflow-variants.ts`: `T0_WORKFLOW` (4 stages/1
  founder gate), `T2_WORKFLOW` (10 stages/2 founder gates), `WORKFLOW_VARIANTS: ReadonlyMap<RiskTier,
  CascadeNodeSpec[]>` (exactly {T0,T2}), `selectWorkflowVariant(tier) = .get(tier) ?? FOUNDRY_WORKFLOW`
  (resolve-or-default). 15 acids in `test/workflow-variants.acid.test.ts`.
- `de-braighter/specs#353` — ADR-269 (ratified). Workbench docs: #190 + #191.

== THE TASK (S3 — WIRING ONLY; founder scope call) ==
Keep the demonstrator `build-path` (each instance still spawns its tier sample — the spawn-vs-advance
semantics, OQ-D, is a SEPARATE later slice). Thread an **instance key `foundry-workflow:<productKey>`**
through the machine so a T2 product walks the heavy pipeline and a T0 product the light one, many
concurrent. The cardinality (per-product instances) and the three sub-decisions (wake → flat union of
namespaced frontiers; cockpit → one panel per active instance; conductor crash-recovery → scoped to the
instance) are ALREADY RESOLVED in the design doc — implement them, don't re-litigate.

Build it in the **3 founder-gated sub-PRs** the design defines, one at a time:
- **S3a** — `workflow-keys.ts` helpers (`workflowInstanceKey`/`isWorkflowKey`/`productKeyOf`) +
  `isWorkflowStage`→`isWorkflowKey` + the 4 filter sites (`state.ts:499/511`, `status.ts:13`,
  `render.ts:157/165`) + instance-parameterized `workflowTree`/`workflowFrontier`/
  `workflowBootstrapEvents` (namespaced itemIds + rewritten `dependsOn`) + `bootstrapWorkflow(deps,
  productKey)` (reads tier → `selectWorkflowVariant` → namespaced queue). Headline acid: a T0 instance
  (`prod-a`) + a T2 instance (`prod-b`) coexist in one temp log, each advances on ITS OWN variant's
  `dependsOn` order, neither leaks into `planFrontierAll`/the product-facing views.
- **S3b** — `conductWorkflowStep(deps, instanceKey)` + `authorizeWorkflowStage(deps, instanceKey,
  stageItemId)` resolve the spec per instance (`selectWorkflowVariant(state.products.get(
  productKeyOf(instanceKey)).riskTier)`); `stageNode` strips the `<instanceKey>/` prefix; crash-recovery
  scoped to the instance (compare `productKey === instanceKey`, not just `isWorkflowStage`). Acids: a T2
  instance halts at gate-1 then gate-2; a T0 at its one gate; two instances conduct independently;
  recovery never cross-completes.
- **S3c** — `render.ts` one `<!-- WF -->` panel per active instance (group `s.items` by `isWorkflowKey`)
  + `server.ts` routes gain an `instance` body field + `mcp/tools.ts` `foundry_bootstrap_workflow({
  productKey })` / `foundry_conduct_workflow({ instance?, authorizeStage? })` + `wake` returns the flat
  union. Acids: per-instance panels with the right tier/spec; a route drives only the named instance.

**Back-compat is load-bearing:** every generalized function defaults to the legacy single instance
(`WORKFLOW_PRODUCT_KEY` / `FOUNDRY_WORKFLOW`), so the shipped `workflow-advance.acid.test.ts` +
`dashboard-cockpit.acid.test.ts` keep passing unchanged. The opus capstone should verify this.

== HARD CONSTRAINTS ==
- ZERO kernel change (pack code; the instance key rides existing `productKey`/`itemId` strings; NO new
  event type — bootstrap reuses `WorkItemQueued`, done reuses `claimAcquired`+`claimReleased(done)`).
  ADR-176 pack-level (P7 precedent again).
- GOVERNANCE held: the conductor's founder-gate halt logic stays UNCHANGED (reads `founderGated` off the
  resolved spec) → a T2 instance halts at BOTH gates, a T0 at its one; never-auto-pass holds per
  instance. Isolation-by-non-registration generalizes (every instance queues stage work-items, emits NO
  `ProductRegistered`).

== DISCIPLINE (the established cluster SDLC) ==
Per sub-slice: implementer TDD with biting acids → verifier wave (charter-checker — governance invariant
+ ADR-176 — + reviewer + qa-engineer + local-ci) → opus WHOLE-BRANCH capstone (it caught a real defect
EVERY ladder slice; for S3 probe the namespaced-dependsOn rewrite, the per-instance crash-recovery
scoping, and the back-compat defaults hardest) → founder-gated PR-per-repo with Producer:/Effort:/Effect:
lines → twin ritual after merge. **RUN foundry-branch verifier/opus agents WITHOUT `isolation:
worktree`** (it worktrees the workbench, where the foundry sibling clone is empty — run in the
`domains/foundry` clone). Reconcile the ADR to the FINAL code at ratify. **MERGES ARE FOUNDER-GATED —
open PRs, present, wait for "go".**

== CONCURRENCY GOTCHAS (bit this arc) ==
- **ADR numbers race** — concurrent sessions reserve them; 268 was taken mid-flight, 269 used. Re-verify
  next free at MERGE time (`ls layers/specs/adr/ | grep -oE 'adr-[0-9]+' | sort -t- -k2 -n | tail`).
  Likely ≥270.
- **Shared sibling clones** — `layers/specs` and `domains/devloop` may be checked out on a concurrent
  session's branch. Do NOT switch their branches. Write the S3 ADR via a **git worktree off specs
  `origin/main`** (`git worktree add -b <adr-branch> <path> origin/main`, write+push+PR, then
  `git worktree remove`), exactly as ADR-269 was done.
- **Workbench branch slips** — this session committed the S3 design to an off-branch commit because the
  workbench HEAD had drifted. VERIFY the workbench branch (`git rev-parse --abbrev-ref HEAD`) before
  committing workbench docs; never `git add -A` (untracked WIP everywhere); add explicit paths.

== OWED (do when the devloop clone is free) ==
The twin ritual for the S1+S2 merges was DEFERRED (devloop held by the concurrent `feat-short-term-churn`
session). Run once free, from `domains/devloop`:
`npm run dev -- drain de-braighter/foundry#35` · `npm run dev -- backfill de-braighter/foundry` ·
`npm run dev -- reconcile` (repeat drain/backfill for `de-braighter/specs#353`). Then the same for the
S3 PRs after they merge.

Start by reading the S3 design doc + the merged `workflow-variants.ts`, then build S3a (TDD), one
sub-slice at a time.
