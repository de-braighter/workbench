# Session prompt — north-star Check 4: flywheel framing discussion (Phase 3)

Paste everything below the rule into a fresh Claude Code session launched from
`D:/development/projects/de-braighter/`. This is a **founder-present framing
discussion**, not an execution runbook — the deliverable is a decision, not code.

---

Frame north-star **Check 4 (the flywheel toy)** with me — discussion first, nothing gets
built until we've decided what the check even is.

CONTEXT (verify, don't re-derive):

- Read memory FIRST: north-star-thesis-test-arc (current through 2026-06-13) +
  second-brick-oncology-direction + self-improving-sdlc-arc + devloop-product-pilot-arc.
- Ledger state (specs#298): C1 FAIL · **C2 CLOSED** (ex#242 + ADR-225 Commitment-6
  adjudication) · C2.5 pro-thesis · **C3 PASS** (ADR-225 ratified · substrate 2.1.0
  published · exercir#252 team-cascade endpoint; 5 carried caveats) · C5 PASS ·
  **C4 not run — the last open check.**
- Governance: per the Option-A amendment to ADR-218 (§The thesis-test gate, specs#299),
  **Check 4 gates the step-3 vendor-only registry** — "a real, calibrated super-linear
  (cross-tenant / reuse) effect at our scale — the registry's raison d'être — before
  registry build is justified by the moat claim." On FAIL/too-costly: an **Option-B
  deferral ADR with an explicit re-test trigger** (never silent continuation). The
  strategy doc itself calls Check 4 "last because it is the fuzziest" and notes a
  flywheel over a per-tenant twin only makes sense once 2+3 prove the twin real — which
  they now have.

THE DISCUSSION (one question at a time, founder decides; my job is to make the decision
space concrete, not to advocate):

1. **What is the flywheel claim, operationally?** The north-star's moat is
   cross-tenant/cross-domain compounding. Candidate operationalizations to put on the
   table (each with cost + what a PASS/FAIL would actually prove):
   (a) **Cross-tenant calibration toy** — EB pooling across ≥2 (synthetic or real)
       tenants measurably improves a held-out proper score vs per-tenant-only fits
       (the substrate's EB machinery already exists; cheapest credible).
   (b) **Dogfood flywheel on devloop** — the SDLC twin is the ONLY place with real
       longitudinal multi-repo data today; does pooling across repos improve
       per-repo calibration (ties into the existing per-producer calibration loop)?
   (c) **Subtree-reuse cold-start** — a versioned subtree from one domain measurably
       improves a second domain's cold start (closest to the registry's actual value
       proposition, but presupposes registry-shaped plumbing — partially circular
       with what the check gates).
2. **What does "at our scale" honestly permit?** n domains but ~1 real-ish data stream
   (devloop). Is a synthetic-tenant toy evidence or theater? Where is the line between
   "calibrated super-linear effect" and "only-in-toy" (the strategy's named FAIL)?
3. **Is deferral the right call anyway?** The ACTIVE north-star is the oncology brick;
   nothing on its critical path needs the registry soon. A deliberate Option-B deferral
   ADR with a sharp re-test trigger (e.g. "first second tenant in one vertical" or
   "first pack requesting a published subtree") might be the *strongest* move — it's
   ADR-218-compliant and keeps the ladder honest. Treat deferral as a first-class
   option, not a failure.
4. **If we run it: smallest credible scope** — one effect, one pooling level, one
   pre-registered success metric (a proper score with the threshold named BEFORE the
   run; the Check-2/3 standard: hand-derivable oracles, in-tree regressions, no
   tolerance-padding). And the FAIL criteria written down first.

PROCESS:

- brainstorming skill, founder present, ONE question at a time (AskUserQuestion with
  recommendations where the options are crisp).
- Output: a short Check-4 framing doc (workbench `docs/superpowers/specs/`) capturing
  the decision — either the check's design (operationalization, metric, threshold,
  FAIL criteria, scope) or the Option-B deferral decision (then: draft the deferral
  ADR, specs PR-gated, next-free ADR number per `adr/README.md`).
- Whatever is decided lands on the **specs#298 ledger** (ledger discipline per amended
  ADR-218).
- If the discussion greenlights a build: writing-plans → subagent-driven-development,
  worktree isolation everywhere, PR-first + verifier wave + twin ritual (the standard
  block — see the Check-3 runbook for the full quirks list if needed; key ones:
  never git ops in shared main clones; fresh npm install per worktree; specs lint
  gates = `tools/lint-md.sh` + `tools/validators/frontmatter-schema.mjs`; devloop
  ritual args: post-findings/drain/reconcile take `repo#pr`, backfill takes
  `OWNER/REPO`).

ADJACENT BUT NOT THIS SESSION'S SCOPE (park unless the founder pulls them in):
coach UI for the team cascade (INV-8 no-bare-labels binds there); substrate
tsconfig.spec.json zero-files fix; nested-aggregate recursion (≥3-level trigger);
quadrature engine (deferred-cell graduation trigger).
