---
name: foundry-conduct
description: Foundry CONDUCTOR — register a session as a coordinator that drives the queue autonomously and never idles. It polls foundry_next, fans out self-serving worker subagents over the disjoint claimable frontier, surfaces founder gates, and — when the frontier empties — invokes the pipeline-filler (Component E) to replenish work: continuation via /build-path (auto), green-desk sweep (auto), and new-product proposals via product-strategist (founder-greenlight-gated). Three modes: PREVIEW (default, safe — show the fan-out plan, dispatch nothing); BUILD (fan out workers that build items to PRs, no auto-merge); AUTONOMOUS (full loop — workers build + run their own verifier waves, conductor auto-merges when review is done + all founder gates are green, stops when all 3 filler tiers exhausted OR context-critical; T2 NEVER merges without foundry_gate_status showing its ship gate approved). Use when the founder says '/foundry-conduct', 'register me as a coordinator', 'conduct the foundry', or 'drain/build the queue'. The founder's only inputs are the masterplan (upstream, via /build-path), the gate decisions, and greenlight decisions for new-product proposals.
---

# Foundry Conductor

Invoking this skill **registers this session as a foundry coordinator**. A coordinator is
the auto-spawn layer over the existing hybrid-spawn MCP surface (foundry spec §9: "the
hybrid-spawn MCP surface is conductor-ready") — it replaces *the founder hand-launching
every worker session* with autonomous fan-out. Design:
`docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md` §C.

The founder's entire loop is **drop inputs (masterplan) · register coordinators · decide
gates**. The conductor owns everything in between.

## Hard rules (inherit from foundry-worker — fail closed)

- **The conductor itself NEVER claims or writes.** It only *reads* `foundry_next` (advisory,
  lock-free) and *dispatches* workers. Every claim/write happens inside a worker subagent
  under `foundry_claim` (the store-lock arbitrates; the conductor needs zero collision logic).
- **The conductor NEVER auto-merges a T2 item.** Workers build T2 to its PR and release
  `built` (prRef persisted natively); the **WORKER** issues `foundry_gate_request{ship}`
  (+ `{adr}` if a new port/kernel primitive) at build time. The **CONDUCTOR** calls
  `foundry_gate_status` to check approval and merges only when every required gate is
  `approved`, then calls `foundry_record_merge` to terminalize. T2 ships only on a
  founder gate.
- **One item per worker subagent.** Fresh context per item is a quality feature. Pool capacity
  = the conductor's fan-out width, bounded by the disjoint claimable frontier.
- **Multi-coordinator safe.** Several sessions may each register as a coordinator; the foundry
  store-lock arbitrates all their fan-outs (a lost claim is an expected race → the worker
  re-fetches; redundant dispatch is harmless). Never reclaim/clean another coordinator's work.

## Modes

Three modes form a safety ladder — start at `preview`, graduate to `build`, then `autonomous`:

- **`preview`** (DEFAULT — safe, dispatches NOTHING): scout `foundry_next`, compute + report
  the wave plan (which mutually-disjoint items, how many workers, what's gate-blocked), then
  stop. Use this first to see what the coordinator *would* do.
- **`build`**: fan out one worker subagent per disjoint claimable item; each builds the item to
  a PR (claim → worktree → build → `ci:local` → push → open PR → release
  `built` (prRef persisted natively)) and surfaces the PR ref. **Does NOT auto-merge** — the verifier
  wave + merge (and every T2 ship gate) stay with the founder/orchestrator. After a wave it
  re-polls (newly-unblocked items surface as deps release `done`) up to `maxWaves`, stopping on
  an unchanged frontier (no-progress) or an empty frontier. Run via the **Workflow tool**.
- **`autonomous`** (the full loop — auto-merge when review is done + gates are green; stops at
  context-critical): fan out workers that build AND run their own verifier waves; the conductor
  then auto-merges any PR whose wave passed with zero blocking findings AND all required founder
  gates are green. Runs **continuously** until context-critical or the frontier is idle. **T2
  NEVER merges without an approved founder gate.** See "## Autonomous mode" below. Run as an
  **Agent-loop session** (NOT via the Workflow tool — see the substrate rationale in that section).

## Protocol

1. Mint a coordinator id once: `cond-<yyyyMMdd-HHmmss>-<4hex>` (reuse in logs).
2. Sanity: `foundry_status` (board view).
3. **For `preview` or `build` mode:** run the conductor **Workflow** below via the Workflow
   tool, passing `args: { mode, maxWaves, maxWorkers }`. Default `mode: 'preview'`. The founder
   graduates to `mode: 'build'` once the preview looks right.
4. **For `autonomous` mode:** run the **Agent-loop** directly in this session — do NOT use the
   Workflow tool. See "## Autonomous mode" below for the full loop.
5. Report: the wave plan (preview), the built PR refs + surfaced gates (build), or the
   merged-set + pending gates + stop reason (autonomous). Then STOP — a non-autonomous
   coordinator ends when the frontier is drained or only gate-blocked items remain.
   **When this autonomous-mode session is dispatched as a lane conductor by a superconductor
   (`/foundry-superconduct`), its terminal report is a structured lane summary —
   `{ productKey, built: [itemId…], merged: [itemId…], awaitingGate: [{ itemId, gate: 'ship'|'adr', gateId, prRef }…], idle: bool, stopReason }` —
   so the superconductor holds only per-conductor summaries (lean context). Run free-standing,
   the same fields render as a human-readable report.**

## Autonomous mode (the full loop — Agent-loop, session-run)

### Substrate

Autonomous mode is run **BY THE SESSION** as an `Agent`-loop — NOT via the Workflow tool
(workers must run their own verifier waves, the conductor must wait async on founder gates,
and the loop runs until context-critical — none of which a Workflow can do). `preview` /
`build` stay Workflow-based. Full rationale + the empirical capability matrix →
`references/substrate-rationale.md`.

### The loop (pseudo-protocol)

```
ON STARTUP and on every fresh conductor launch:

  REGISTER PRESENCE (observability, §C.3): foundry_register_coordinator { kind: 'conductor',
    sessionId } → keep the returned coordinatorId. Call foundry_coordinator_heartbeat
    { coordinatorId } once per loop iteration so foundry_status's ACTIVE COORDINATORS section
    shows you live. Presence is observability-ONLY — it is never a correctness input (the
    store-lock arbitrates; never read activeCoordinators to make a claim/gate/merge decision).

  RECOVERY PASS — rebuild the awaiting-merge set from durable sources:
    foundry_status's 'BUILT (awaiting merge)' section (PRIMARY — each item carries
    { itemId, prRef } natively; a built item is NEVER re-built), backstopped by
    gh pr list --state open matched on feat/<slug> branches, plus ORPHAN ADOPTION of
    stranded PRs on stale claims (foundry_reconcile_claim). This is the only pass that
    writes the awaiting-merge cache on startup and is what makes stateless restart TRUE.
    Full recovery procedure (orphan-adoption rules, re-wave requirement) →
    `references/recovery.md`.

loop (until context-critical OR idle-stop):

  a. POLL: foundry_status + foundry_next(limit 50) — advisory, lock-free reads.
     PRESENCE: foundry_coordinator_heartbeat { coordinatorId } (the id from the startup
     REGISTER PRESENCE step) — emit it HERE every iteration so you stay on the ACTIVE
     COORDINATORS board (a missed beat drops you after the 10-min presence window).

  b. MERGE PASS — for every PR in the awaiting-merge set (tracked from prior dispatches
     OR discovered by the RECOVERY PASS above):
       check: did the worker's verifier wave return waveVerdict == 'green' (0 blocking)?
              AND are all founder gates for this item 'approved'?

       HOW TO CHECK GATE APPROVAL (fail-closed — item-bound):
         Call foundry_gate_status { productKey: <item's productKey> }.
         Find the gate(s) the item requires: 'ship' (always for T2); 'adr' (if a new
         port or kernel primitive is introduced).
         A gate is APPROVED for THIS ITEM iff its returned record has
           decision === 'approved'
           AND its payloadRef references THIS item (contains the itemId or the prRef).
         FAIL CLOSED: any required gate that is pending, rejected, absent, or whose
         payloadRef does NOT reference this item → the gate is NOT approved → DO NOT MERGE.
         INVARIANT: two T2 items in the same product each open their own ship gate; a
         sibling item's approved gate NEVER authorizes merging this item — match by
         payloadRef first, THEN check decision.
         foundry_status lists only *pending* gates; a gate's absence from pending means
         decided OR never-requested — NOT proof of approval. foundry_gate_status is
         the authoritative check.

       if BOTH (wave green AND foundry_gate_status shows every required gate approved
                with payloadRef matching THIS item — or T0/T1 with no per-item gate required):
         gh pr merge --admin (squash)
         → VERIFY MERGED: gh pr view <pr> --json state → must equal MERGED before
           proceeding (a transient mergeable:UNKNOWN can fail the merge silently;
           verify, then proceed)
         → twin ritual: drain <repo#pr> → backfill → reconcile
         → foundry_record_merge { itemId, prRef }   ← terminalizes built → done
         → worktree cleanup (git worktree remove + branch -D after VERIFIED-merged)
         → remove from awaiting-merge set
       if foundry_gate_status shows decision === 'rejected' for ANY of THIS item's required
          gates (ship OR adr, matched by payloadRef): the founder DECLINED this build — it
          will never merge. A rejection is TERMINAL even if the wave is still pending/red — do
          NOT gate the retire on a green wave, and do NOT keep re-checking. Terminally abandon
          it: foundry_retire_item { itemId, reason: '<gateType> gate rejected by founder
          (<gateId>)' } (use the actually-rejected gate's type; terminal, NO re-queue), remove
          from the awaiting-merge set, then clean up the worktree (after confirming the item
          shows 'retired' on the board). The open PR is left for the
          founder to close/repurpose.
       if T2 with gate still PENDING / not-yet-decided (foundry_gate_status decision absent
          OR no gate with matching payloadRef yet): leave in set; re-check next pass.
       INVARIANT: NEVER merge a T2 item without foundry_gate_status showing decision:'approved'
                  for its 'ship' gate (+ 'adr' gate if a new port/kernel primitive is
                  introduced) AND whose payloadRef references THIS item — a sibling item's
                  approval is NOT sufficient. NEVER proceed with cleanup before gh pr view
                  confirms MERGED.

  c. DISPATCH PASS — poll foundry_next for claimable items; for each (cap = maxWorkers):
       if already in awaiting-merge set: skip (still live)
       Agent({
         subagent_type: <worker>,
         model: <pinned>,          // pin model — inheritance death orphans a claim
         isolation: 'worktree',
         prompt: <autonomousWorkerPrompt(item)>
                 // The full foundry-worker protocol IN FULL (see "## Autonomous mode worker prompt"
                 // below for the complete prompt string):
                 //   claim → worktree → build → ci:local
                 //   → ITS OWN verifier wave
                 //     (reviewer + qa-engineer + charter-checker
                 //      as sibling Agent subagents inside the worker)
                 //   → post-findings → open PR
                 //   → T2: WORKER issues foundry_gate_request{ship}
                 //         (+ {adr} if new port/kernel primitive) — WORKER OWNS THIS STEP
                 //         release built (prRef persisted natively)
                 //   → T0/T1: release built (prRef persisted natively)
                 //   → RETURN { itemId, prRef,
                 //              waveVerdict: 'green'|'findings',
                 //              blockingCount: number,
                 //              gate: 'ship'|'adr'|'none',
                 //              outcome: 'built-pr'|'skipped-race'|'built'|'error' }
                 // NOTE: the CONDUCTOR never issues gate requests — it only calls
                 // foundry_gate_status to read approval, merges after approval + green wave,
                 // then calls foundry_record_merge to terminalize (built → done).
       })
       on return: add { itemId, prRef, waveVerdict, blockingCount, gate } to awaiting-merge set

  d. IDLE CHECK — if nothing was dispatched AND awaiting-merge set is empty:
       bounded idle backoff (poll foundry_next a few more times, brief sleep between)
       if still empty: INVOKE PIPELINE-FILLER (Component E — see "## Pipeline-filler" below):

         BOUNDED FILLER — anti-livelock: the `/green-desk` skill (Tier 2) OWNS the bounds
           — git-HEAD repo-suppression (a clean/unchanged repo is never re-swept), the
           per-cycle item cap (default 10), and the no-new-progress stop. The filler simply
           invokes the skill and continues if items appear within budget; it NEVER
           re-implements the mechanism here. Tiers 1 + 3 carry no debt-loop risk.

         TIER 1 (auto): for each greenlit product with unbuilt epics, run /build-path
                        to emit next work items → re-poll foundry_next; if new items: continue loop
                        Greenlit predicate (machine-checkable): call
                          foundry_gate_status { productKey: <product> }
                          → find a gate with gateType:'greenlight' AND decision:'approved'.
                        A filler MUST NEVER widen its own mandate to a non-greenlit product.
         TIER 2 (auto): invoke the /green-desk skill (Component D — implemented) with --all
                        → emit debt cleanup items. The skill OWNS the anti-livelock mechanism
                        internally — git-HEAD repo-suppression (lastSweptCommit vs origin/main),
                        the per-cycle item cap, and the no-new-progress stop; do NOT re-implement
                        any of it here. If it emits new items within budget: continue loop
         TIER 3 (founder-gated): run product-strategist agent to surface 2–3 ranked proposals
                        → SURFACE proposals to founder → STOP-FOR-FOUNDER (never auto-build)
                        "Conductor awaiting a masterplan input — proposals surfaced above."
       TRUE IDLE (real, reachable termination): all three tiers produced NO NEW WORK in
         a complete pass (no new items from Tier 1, no unsuppressed debt from Tier 2, Tier 3
         gated). STOP CLEANLY with message:
         "Conductor idle — no unbuilt epics, no repo debt, no greenlit proposals.
          Re-launch a coordinator after a masterplan input or greenlight."
       Context-critical stop is the BACKSTOP, not the only stop. True idle fires first.

  e. CONTEXT CHECK — after each complete pass, assess own context budget:
       if near context-critical: STOP immediately; report:
         - awaiting-merge set (itemId, prRef, waveVerdict, gate status for each)
         - any pending founder gates (itemId, gate type, prRef)
         - stop reason: "context-critical — foundry state is durable; re-launch a fresh
           conductor to resume (it re-polls foundry_next; no handoff needed)"
       A FRESH CONDUCTOR continues seamlessly — the foundry event log is the only
       authority; the conductor holds zero durable state of its own.
```

### The merge rule (inviolable boundary)

The conductor merges a PR if and only if **BOTH** conditions hold:

1. **Review is done** — the worker's verifier wave returned `waveVerdict = 'green'`
   (zero blocking findings; `nit`/`note` are non-blocking).
2. **All gates are green (item-bound)** — call `foundry_gate_status { productKey: <item's productKey> }`;
   every gate the item requires must have `decision === 'approved'` in the response AND its
   `payloadRef` must reference THIS item (contains the itemId or the prRef). **A sibling
   item's approved gate NEVER authorizes merging this item.**
   **FAIL CLOSED: any required gate that is `pending`, `rejected`, absent, or whose
   `payloadRef` does not reference this item → the gate is NOT approved — DO NOT MERGE.**
   `foundry_status` lists only *pending* gates; a gate's absence from the pending list means
   decided OR never-requested — NOT proof of approval. `foundry_gate_status` is the
   authoritative source.

After a successful `gh pr merge --admin` (squash), the conductor:
  - **Verifies the merge** — `gh pr view <pr> --json state` must return `MERGED` before
    proceeding (a transient `mergeable: UNKNOWN` can fail the merge silently; verify first).
  - **Runs the twin ritual** — drain → backfill → reconcile.
  - **Calls `foundry_record_merge { itemId, prRef }`** — terminalizes the built item to done.
  - **Cleans up the worktree** — `git worktree remove` + `branch -D` AFTER verified-merged.

**T0 / T1** items carry no per-item founder gate → merge on a green wave alone.

**T2** items REQUIRE the founder `ship` gate (mandatory) plus the `adr` gate whenever
the item introduces a new port or kernel primitive. The **WORKER** issues
`foundry_gate_request { productKey: '<item's productKey>', gateType: 'ship', payloadRef: '<itemId> | <prRef>' }`
(and a second call with `gateType: 'adr'` where applicable) at build time and releases
`built` (prRef persisted natively). The **CONDUCTOR** calls `foundry_gate_status` to check
approval — finding gates by `payloadRef` matching THIS item — and performs the merge after
every required item-bound gate is `approved`, then calls `foundry_record_merge` to
terminalize. **A T2 PR is NEVER merged without `foundry_gate_status` showing
`decision:'approved'` for a gate whose `payloadRef` references THIS item's `ship` gate
(+ `adr` gate if a new port/kernel primitive is introduced).** A sibling item's approved gate
is NOT sufficient. This is the founder's inviolable control point; the conductor only
automates the mechanical merge that follows it.

Gates are **non-blocking across products** — a parked T2 gate never stalls other lanes;
the conductor keeps fanning out and merging eligible items in parallel.

### Context-critical stop and stateless restart (TRUE — proven by the RECOVERY PASS)

The conductor holds **NO durable state** — it is a generator, not a graph. When context
nears critical it stops cleanly and reports its surface state; a fresh conductor reruns the
RECOVERY PASS on startup (foundry `built` items, exact, + gh open-PR backstop) and continues
exactly where the previous one left off — no handoff, no serialization, no leader-election.
A built-but-unmerged PR is NEVER re-built. Full detail (the two durable sources, the
context-critical report contents) → `references/recovery.md`.

### Autonomous mode worker prompt

The full autonomous worker prompt string (= the build-mode `workerPrompt` + the
autonomous addendum below, concatenated). The addendum is:

```
AUTONOMOUS MODE — additional instructions AFTER ci:local passes:

1. RUN YOUR OWN VERIFIER WAVE:
   Dispatch reviewer, qa-engineer, and charter-checker as sibling Agent subagents
   (+ exercir-charter-checker if repo = domains/exercir).
   All four run IN PARALLEL under Agent({ isolation: 'worktree' }).
   Collect all verdicts.
   blockingCount = count of findings with severity 'blocking' or 'critical'.
   waveVerdict = blockingCount === 0 ? 'green' : 'findings'

2. POST FINDINGS:
   Write all verifier findings to a temp JSON array
   [{ verifier, severity, path?, line?, text }]
   Run: npm run dev -- post-findings <repo#pr> findings.json
   Do this even if waveVerdict = 'green' (empty array is fine and idempotent).

3. GATE REQUEST (T2 ONLY — WORKER OWNS THIS STEP):
   If riskTier === 'T2': call foundry_gate_request{ productKey: '<item's productKey>',
     gateType: 'ship', payloadRef: '<itemId> | <prRef>' }
   If the item also introduces a new port or kernel primitive: call
     foundry_gate_request{ productKey: '<item's productKey>',
     gateType: 'adr', payloadRef: '<itemId> | <prRef>' }
   payloadRef is what binds the gate to THIS item — the conductor matches by it.
   Do NOT pass itemId or prRef as top-level op params — only productKey, gateType,
   and payloadRef are op parameters.
   The CONDUCTOR will call foundry_gate_status + match by payloadRef — do NOT merge.

4. RELEASE:
   T2: foundry_release { claimId, outcome: 'built', prRef: '<owner>/<repo>#<pr>',
         note: 'built; gate requested; awaiting founder gate approval' }
   T0/T1: foundry_release { claimId, outcome: 'built', prRef: '<owner>/<repo>#<pr>',
           note: 'built; wave complete; awaiting conductor merge' }

5. RETURN (structured):
   {
     itemId: "<itemId>",
     prRef:  "<owner>/<repo>#<pr>",
     waveVerdict: 'green' | 'findings',
     blockingCount: <number>,
     gate: 'ship' | 'adr' | 'none',
     outcome: 'built-pr' | 'skipped-race' | 'built' | 'error'
   }

DO NOT MERGE — the conductor calls foundry_gate_status + merges after gate approval + wave green,
then calls foundry_record_merge to terminalize.
```

## The conductor Workflow (run via the Workflow tool — preview + build modes only)

`preview` and `build` modes run via the **Workflow tool** with a fixed program (the SCOUT →
Fan-out wave loop, the `FRONTIER`/`WORKER` schemas, and the build-only `workerPrompt`). The
full Workflow source to run is in **`references/workflow.md`** — load it when launching
`preview` or `build` mode. (Autonomous mode does NOT use it — it runs the Agent-loop above.)

## Autonomy boundary (the founder's control surface)

- **T2-launch-only is DROPPED** — workers self-serve / are dispatched T2 *build* work; control
  moved to the gates (see foundry-worker + foundry-pool eligibility).
- **Gates stay inviolable.**
  - **`build` mode (BUILD-MODE-ONLY):** v1 surfaces every built PR for review+merge out-of-band.
    The next increment (slice 2.1) adds an in-Workflow review stage (wave agents as a later
    pipeline stage) + auto-merge for T0/T1 on a green wave.
  - **`autonomous` mode:** workers run their own verifier waves; the conductor auto-merges T0/T1
    on `waveVerdict='green'` and merges T2 only after `foundry_gate_status` shows `approved`.
  - **T2 always pauses at its `ship` gate** and is NEVER auto-merged in any mode.
    Gates are non-blocking across products — a parked gate never stalls other lanes.

## Why workers don't run their own wave — and when they do (substrate matrix)

Whether a worker self-waves depends on the mode's execution substrate: **preview/build**
workers are Workflow `agent()` leaves (no spawn primitive → review is a sibling pipeline
stage, out-of-band in build-v1); **autonomous** workers are regular `Agent`-tool subagents
that CAN and DO fan out their own `reviewer + qa-engineer + charter-checker` wave (the
prerequisite for the conductor's `waveVerdict='green'` merge rule). Full explanation +
the empirically-verified capability matrix → `references/substrate-rationale.md`.

## Concurrency guards (every worker subagent enforces — from the design §C.2)

unique worktree per claim + **forbid git ops in the shared root clone** · `NX_DAEMON=false` ·
heartbeat the whole build under TTL (a lapsed claim's revival re-runs the overlap scan and
throws if the scope was taken) · pin `model:` (model-inheritance death orphans a claim) ·
orphan cleanup on release · keep one `FOUNDRY_DATA_DIR` · treat a store-lock timeout as
transient (bounded backoff), never delete `.lock`.

Every worker self-leases a warm pool slot (`foundry_lease_slot { claimId }` in `foundry-worker`
ISOLATE) instead of a cold `git worktree add` — distinct slots are collision-free by
construction (the store-lock arbitrates), and the pool is throughput-only (a lease failure
falls back to a cold worktree-add, so no correctness dependency). There is nothing for the
conductor to thread — no conductor-side slot math. Full warm-pool mechanism →
`foundry-worker` skill `references/warm-pool.md`.

## Pipeline-filler (Component E — never idle)

When the autonomous conductor finds the pipeline empty (nothing claimable AND nothing
awaiting merge), it does **not** stop — it invokes the pipeline-filler, a **priority ladder**
that respects the founder's "drop inputs · decide gates" boundary:

- **Tier 1 — Continuation (AUTO):** for each already-greenlit product with unbuilt epics, run
  `/build-path` to emit the next work items (idempotent; within the existing greenlight — no
  new gate). Greenlit = `foundry_gate_status` shows `gateType:'greenlight'` + `decision:'approved'`.
- **Tier 2 — Green-desk maintenance (AUTO):** invoke the `/green-desk` skill to emit disjoint
  debt-cleanup items; the skill OWNS the anti-livelock bounds (git-HEAD repo-suppression +
  per-cycle cap + no-new-progress stop) — never re-implement them here. No new gate.
- **Tier 3 — New-product / feature proposals (FOUNDER-GREENLIGHT-GATED):** run
  `product-strategist` to surface 2–3 ranked proposals, SURFACE to the founder, and
  STOP-FOR-FOUNDER. NEVER auto-charter or auto-build a new/out-of-masterplan product.
- **True idle** = all three tiers produced no new work in a complete pass → stop cleanly
  ("Conductor idle — no unbuilt epics, no repo debt, no greenlit proposals. Re-launch after
  a masterplan input or greenlight."). Context-critical stop is the backstop; true idle fires first.

Full per-tier detail (greenlit predicate, green-desk anti-livelock mechanism, the inviolable
gate boundary) + the named deferred-to-next-increment items → `references/pipeline-filler.md`.
