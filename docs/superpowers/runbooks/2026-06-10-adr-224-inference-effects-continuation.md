# Continuation prompt — ADR-224 inference-effects (finish + land)

Paste the block below into a fresh Claude Code session launched from the cluster root (`D:/development/projects/de-braighter/`). It drives ADR-224 (inference-side distribution-aware effect consumption) to landing, via subagent-driven execution + the verifier wave + the twin ritual.

---

```text
Continue and LAND ADR-224 — inference-side distribution-aware consumption of composed plan-tree effects.

GOAL: get the ratified ADR-224 implementation merged to substrate main (coordinated with the staged 2.0 major bump), with the verifier wave green and the twin ritual run. Use subagent-driven-development for the build; do not grind inline.

READ FIRST (establish ground truth before touching code):
- ADR (ratified, charter-tier): layers/specs/adr/adr-224-inference-side-distribution-aware-effect-consumption.md — esp. the Decision (consume whole DistributionSpec incl. variance; honor compositionOperator; conjugate-now + typed-deferral), the six numbered Commitments, and "the tractability matrix is the contract" (operator × kind × likelihood — closed-form ✓ cells vs typed `deferred` cells, no silent fallback).
- Memory: adr-224-inference-effects-build-state.md — BUT TREAT ITS "5/15, NEXT=C2" AS STALE. The branch is much further along: HEAD cd4cff2 has the breaking port shape landed, all six adapters migrated, the KNOWN-GAP(ADR-154) flat-multiply "reconciliation closed", and Normal-Normal variance propagation (σ_E², ADR-224 1b-i). Do NOT redo finished work.
- Memory: north-star-thesis-test-arc.md + GH issue de-braighter/specs#298 — landing ADR-224 is ALSO the unlock for Check 2 of the north-star thesis-test (it makes exercir's already-declared normal/lognormal/beta effect variance propagate live instead of being discarded by reduceMagnitude). Note this second payoff on the PR and as a #298 comment after merge.

BRANCH / WORKTREE:
- Branch feat/adr-224-inference-effects, HEAD cd4cff2, 6 commits ahead of origin/main, +1410/-831 across 29 files. NO open PR yet.
- An existing worktree is checked out at layers/substrate-wt-adr224 (on this branch). Work THERE. There is ALSO a leftover spike file in it: libs/substrate-runtime/src/inference/adr224-thesis-gate.spike.spec.ts — see step 5.

STEP 1 — Establish the real delta (do not trust the stale count):
Reconcile the ADR's tractability matrix + six Commitments against what's actually on the branch. Produce an accurate remaining-work list: which matrix cells have closed-form math + tests, which have the typed `deferred` envelope (effect-not-conjugable / effect-composition-failed) + tests, and whether all four resolved OQs are implemented. Closed-form cells per the ADR: every `point` composed prior (all 3 likelihoods), `normal`-on-`normal` (variance propagation), `beta`-on-`beta`. Deferred cells: `normal`-on-`beta`, `lognormal`-on-`normal`, random-log-HR-on-AFT. If the branch already covers all of these with tests, the delta is just "land it" — go to step 3.

STEP 2 — Finish any remaining ADR-224 items (only if step 1 found gaps):
Implement remaining cells / typed-deferred envelopes / tests via subagent-driven-development in the worktree. Keep to the ADR-176-minimal cut (deferred cells stay deferred — demand-driven graduation only). No invented math; an unlisted cell is `deferred`, never approximated.

STEP 3 — Land it (BREAKING change — coordinate the release):
- `findEffectsForTree` now returns Result<ComposedEffect[], CompositionError> and InferenceError widened — this is a BREAKING port-shape change. It must ride the staged substrate 2.0 major bump (substrate#162 major-bump policy; main is staged 2.0.0). Confirm whether ADR-224 joins that train or drives its own major; bump semver accordingly (P5 — versioned contracts).
- Migrate every consumer of the changed port (exercir at minimum; grep the cluster for findEffectsForTree / the widened InferenceError variants). Build + test each consumer against the new shape.
- Open the PR FIRST (before the wave), so verdicts are harvestable. PR body carries: Producer: line, Effort: tier, and (if defensible) Effect: cycle-time/findings. Note the #298 / Check-2 payoff in the body.
- Run the verifier wave with isolation:worktree: local-ci + reviewer + charter-checker + qa-engineer (substrate is kernel code, so local-ci runs the real build+test). Address findings.

STEP 4 — Twin ritual (MANDATORY, after merge):
drain <repo#pr> → backfill OWNER/REPO#pr → reconcile <repo#pr> (+ retro per cadence). Post-findings before merge if the wave surfaced any.

STEP 5 — Handle the leftover spike file:
libs/substrate-runtime/src/inference/adr224-thesis-gate.spike.spec.ts (in the worktree) is a thesis-gate probe left from the north-star Check 2 run. Decide: either (a) promote it into a proper, named decision-relevance regression test (variance-aware effects change a decision the flat-scalar path can't), or (b) remove it. Do NOT let it ride the ADR-224 PR unintentionally.

GOTCHAS (this machine / cluster):
- In the worktree, run tests via vitest DIRECTLY (e.g. `node node_modules/vitest/vitest.mjs run <path>` or `npx vitest run <path>`), NOT `nx test` — worktree nx daemons lock the main clone's nx db (EBUSY).
- NEVER run git stash/checkout/add/reset in any shared clone; worktree-isolate all agents. Don't bypass pre-push hooks.
- Published-vs-main trap: published @de-braighter/* on npm can lag main by a major arg — verify against the actual published shape when migrating consumers, not just main.
- Don't add domain logic to substrate; keep Layer-1 primitives domain-agnostic.

DELIVERABLE: ADR-224 merged to substrate main on the 2.0 train, consumers migrated + green, wave green, twin ritual run, spike file resolved, and a #298 comment noting Check 2 is now de-synthesized (exercir effects propagate variance live).
```

---

## Notes for the operator (not part of the paste)

- **Why "verify, don't trust the count":** the build-state memory predates this session's branch inspection. At HEAD cd4cff2 the breaking port shape, all six adapter migrations, and the Normal-Normal variance propagation are already committed — the KNOWN-GAP is closed. The likely-real remaining work is small (cell/test completeness + the consumer migration + the release coordination), so step 1 exists to avoid re-doing done work.
- **The release coupling is the real decision:** ADR-224 is breaking and the substrate is already staged at 2.0.0. The continuation session must confirm whether ADR-224 lands *as part of* that 2.0 cut or triggers it — that's the one genuinely founder-shaped call in the sequence.
- **Second payoff:** this is the highest-leverage move for the north-star thesis-test — it turns Check 2's PARTIAL PASS from synthetic into real-for-a-shipped-domain, because exercir already declares the variance (Check 2.5).
