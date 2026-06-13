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

## Autonomous mode (the full loop — Agent-loop, session-run)

### Substrate

Autonomous mode is run **BY THE SESSION** as an `Agent`-loop — NOT via the Workflow tool.
Three reasons make this mandatory:

1. **Workers must run their own verifier waves.** A Workflow `agent()` node is a leaf (no
   `Agent`/`Task` spawn primitive in its toolset — verified 2026-06-13). Regular `Agent`-tool
   subagents DO carry the `Agent` tool and CAN fan out child agents, so workers dispatched via
   `Agent(...)` can run their own `reviewer + qa-engineer + charter-checker` wave. In a
   Workflow, this is structurally impossible.
2. **Async founder-gate wait.** The conductor must poll and wait for `foundry_gate_decide`
   outcomes (which arrive out-of-band, hours later) — a Workflow cannot suspend across turns.
3. **Runs until context-critical.** The loop continues for N passes over an evolving frontier
   and must detect and react to its own context budget — a session can introspect this; a
   Workflow cannot.

The `preview` and `build` modes stay Workflow-based (bounded, deterministic, journaled,
resumable). Autonomous is Session-based (continuous, auto-merge, async-gate-aware,
workers-self-wave).

### The loop (pseudo-protocol)

```
ON STARTUP and on every fresh conductor launch:

  RECOVERY PASS — rebuild the awaiting-merge set from durable sources:
    PRIMARY: call foundry_status → read the 'BUILT (awaiting merge)' section.
      Each listed item carries { itemId, prRef } natively — no reconstruction needed.
      For each: add { itemId, prRef, waveVerdict: 'unknown'|<prior>, gate: 'ship'|'none' }
      to the awaiting-merge set. A built item is NEVER re-built.
    BACKSTOP (defense-in-depth): gh pr list --state open for each active repo
      → match open PRs on feat/<slug> branches (slug encodes the itemId)
      → for each matched PR NOT already in the set (e.g. a PR opened before the
         built-release landed): add { itemId, prRef, waveVerdict: 'unknown', gate } to set.
    This is the only pass that writes the awaiting-merge cache on startup.
    Stateless restart is TRUE: the awaiting-merge set is rebuilt from the foundry log's
    built items (exact), with gh open PRs as backstop (defense-in-depth).

loop (until context-critical OR idle-stop):

  a. POLL: foundry_status + foundry_next(limit 50) — advisory, lock-free reads.

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
       if T2 with gate pending or not approved (foundry_gate_status decision ≠ 'approved'
          OR no gate with matching payloadRef found): leave in set; re-check next pass.
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

         BOUNDED FILLER — anti-livelock rules:
           (a) REPO SUPPRESSION: green-desk (Tier 2) is suppressed for a repo within the
               current cycle if no merge has changed that repo since the last Tier 2 sweep.
               A repo only gets re-swept after a merge lands in it. This prevents infinite
               re-sweeping of already-clean repos.
           (b) PER-CYCLE BUDGET: the filler carries a per-cycle work-item cap (default 10
               items per cycle). Once the cap is hit, the filler yields and the loop
               continues dispatch/merge normally; the next IDLE CHECK issues more items if
               still needed. This prevents unbounded token burn on pure debt.

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

The conductor holds **NO durable state** — its durable state is rediscovered from two
sources on every startup via the RECOVERY PASS:
  (a) The **foundry log's `built` items** — `foundry_status`'s `BUILT (awaiting merge)`
      section lists each built item + its `prRef` natively (exact, no reconstruction).
  (b) **GitHub open PRs** (`gh pr list --state open`) — backstop for PRs opened before a
      built-release landed; feat/<slug> branch matching fills any gaps.

Both sources are durable; the in-context awaiting-merge set is just a cache the RECOVERY
PASS rebuilds. This makes stateless restart **true** in practice, not just in theory:

When context nears critical, the conductor stops cleanly and reports its surface state.
A fresh conductor (or a superconductor) runs the RECOVERY PASS on startup, rebuilds the
awaiting-merge set from the foundry's built items (exact) + gh backstop, and continues
exactly where the previous conductor left off — no coordinator handoff, no state
serialization, no leader-election. A built-but-unmerged PR is NEVER re-built (the
RECOVERY PASS finds it and routes it to the MERGE PASS).

"Store generators, derive graphs" applied to the conductor itself: the conductor IS a
generator, not a graph.

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

```js
export const meta = {
  name: 'foundry-conduct',
  description: 'Foundry conductor: fan out self-serving worker subagents over the disjoint claimable frontier, in waves',
  phases: [{ title: 'Scout' }, { title: 'Fan-out' }],
}

// args: { mode: 'preview'|'build', maxWaves?: number, maxWorkers?: number }
const mode = (args && args.mode) === 'build' ? 'build' : 'preview'
const maxWaves = (args && args.maxWaves) || (mode === 'build' ? 3 : 1)
const maxWorkers = (args && args.maxWorkers) || 8
if (args && args.mode && args.mode !== mode) log(`unrecognized mode '${args.mode}' — defaulting to preview`)

const FRONTIER = {
  type: 'object', additionalProperties: false,
  required: ['items'],
  properties: {
    error: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['itemId', 'repo', 'riskTier'],
        properties: {
          itemId: { type: 'string' }, title: { type: 'string' }, repo: { type: 'string' },
          pathPrefix: { type: 'string' }, riskTier: { type: 'string' },
          priority: { type: 'number' }, qualityObligations: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
}
const WORKER = {
  type: 'object', additionalProperties: false,
  required: ['itemId', 'outcome'],
  properties: {
    itemId: { type: 'string' },
    outcome: { type: 'string' },              // built-pr | skipped-race | built | error
    prRef: { type: 'string' }, gate: { type: 'string' }, note: { type: 'string' },
  },
}

const workerPrompt = (it) => `You are a Foundry worker subagent dispatched by a conductor. Work EXACTLY this one item, then stop. Follow the workbench 'foundry-worker' skill end-to-end in BUILD-ONLY mode (do NOT merge).

Item: ${it.itemId} · Repo: de-braighter/${it.repo.replace(/^de-braighter\\//, '')} · Scope: ${it.pathPrefix || it.repo} · riskTier: ${it.riskTier}
Title: ${it.title || it.itemId}

1. CLAIM: mint sess-<ts>-<4hex>; foundry_claim { itemId: "${it.itemId}", sessionId, worktree: "<repo>/.claude/worktrees/<slug>", branch: "feat/<slug>" }. If rejected as already-claimed/scope-overlap, that is an EXPECTED race with a sibling worker/coordinator — return { itemId, outcome: "skipped-race" } and STOP (never work unclaimed).
2. ISOLATE: git worktree add the claimed path off origin/main; NEVER git-op in the shared root clone; set NX_DAEMON=false; install deps in the worktree.
3. EXECUTE: route via existing skills per tier (designer-first FIRST for T2 — and if your itemId is `<key>/ADR-<n>`, CONSUME that number directly, do NOT read next-free-adr). Honor qualityObligations.
4. QUALITY: green 'ci:local' in the worktree; confine the diff to the scope pathPrefix; push the branch; open the PR (Producer:/Effort:/Effect: lines). Heartbeat foundry_heartbeat at phase boundaries.
5. DO NOT MERGE. Release foundry_release { claimId, outcome: "built", prRef: "<owner>/<repo>#<pr>", note: "built; awaiting conductor/founder review+merge" + (T2 ? "; ship gate required" : "") } and report.
6. RETURN { itemId: "${it.itemId}", outcome: "built-pr", prRef: "<owner>/<repo>#<pr>", gate: "${it.riskTier === 'T2' ? 'ship' : ''}" }. On a build dead-end, foundry_release with outcome: "error" + the reason and return { itemId, outcome: "error", note }.
Pin your model; keep the whole build under one TTL with heartbeats; on any release, schedule worktree teardown.`

const allResults = []
let lastKey = ''
for (let wave = 0; wave < maxWaves; wave++) {
  phase('Scout')
  const frontier = await agent(
    `You are the foundry conductor SCOUT. Call the foundry MCP tool foundry_next with limit 50 and return the claimable frontier as JSON. For each item include itemId, title (<=120 chars), repo, pathPrefix (from scope, if any), riskTier, priority, qualityObligations. Claim NOTHING. If foundry_next errors or the foundry MCP is unavailable, return { items: [], error: "<reason>" }.`,
    { label: `scout-w${wave}`, phase: 'Scout', schema: FRONTIER }
  )
  if (frontier && frontier.error) { log(`scout error: ${frontier.error} — stopping`); break }
  const items = (frontier && frontier.items) || []
  if (!items.length) { log(`wave ${wave}: nothing claimable — stopping`); break }

  const key = items.map((i) => i.itemId).sort().join(',')
  if (key === lastKey) { log('frontier unchanged — no progress, stopping'); break }
  lastKey = key

  if (mode === 'preview') {
    log(`PREVIEW: ${items.length} claimable disjoint item(s): ${items.map((i) => `${i.itemId}[${i.riskTier}]`).join(', ')}`)
    return { mode: 'preview', wavePlan: items }
  }

  // BUILD: fan out one worker per item, capped at maxWorkers (excess queue behind the concurrency cap)
  phase('Fan-out')
  const batch = items.slice(0, maxWorkers)
  log(`BUILD wave ${wave}: dispatching ${batch.length} worker(s): ${batch.map((i) => i.itemId).join(', ')}`)
  const results = await parallel(batch.map((it) => () =>
    agent(workerPrompt(it), { label: `build:${it.itemId}`, phase: 'Fan-out', schema: WORKER, isolation: 'worktree' })))
  allResults.push(...results.filter(Boolean))
  // loop: re-scout (deps may have unblocked); stop conditions handled at top
}

const built = allResults.filter((r) => r.outcome === 'built-pr')
const gates = built.filter((r) => r.gate).map((r) => ({ itemId: r.itemId, gate: r.gate, prRef: r.prRef }))
return { mode, waves: maxWaves, built, gatesAwaitingFounder: gates, all: allResults }
```

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

This depends on which conductor mode is active:

**In `preview` / `build` modes (Workflow substrate):** A Workflow `agent()` node is a **leaf**
— its toolset carries no `Agent`/`Task` spawn primitive (verified empirically 2026-06-13:
a Workflow agent has Bash/Edit/Read/Skill/ToolSearch/Write/… but no subagent-spawn tool).
Therefore a Workflow worker **cannot** dispatch its own verifier-wave sub-agents. Review is
a **sibling pipeline stage** the conductor Workflow runs itself:
`pipeline(items, buildWorker, reviewWave, mergeOrGate)` — buildWorker and the wave-agents are
sibling leaf nodes at the top level. In `build` mode v1, review/merge stay out-of-band
(workers build to a PR; the founder/orchestrator reviews + merges). The slice-2.1 increment
adds the review stage as a sibling Workflow pipeline stage — never inside a worker node.

**In `autonomous` mode (Agent-loop substrate):** Workers ARE regular `Agent`-tool subagents,
dispatched via `Agent({ ... })` in the session loop — **not** via the Workflow `agent()` primitive.
Regular `Agent` subagents carry the `Agent` tool and CAN fan out children. Therefore autonomous
workers **DO run their own verifier wave** (reviewer + qa-engineer + charter-checker as sibling
`Agent` sub-calls inside the worker). This self-wave is the prerequisite for the conductor's
merge rule: the conductor merges on `waveVerdict = 'green'` returned by the worker, not on
a separate sibling pass.

**The capability matrix (empirically verified 2026-06-13):**

| Execution context | Can fan out sub-agents? | Wave inside worker? |
|---|---|---|
| Regular `Agent`-tool subagent | **YES** — `Agent` tool is in its toolset | **YES** (autonomous workers) |
| Workflow `agent()` node | **NO** — leaf; no spawn primitive | **NO** (preview/build workers) |

This is the substrate trade-off that makes autonomous mode an Agent-loop, not a Workflow.

## Concurrency guards (every worker subagent enforces — from the design §C.2)

unique worktree per claim + **forbid git ops in the shared root clone** · `NX_DAEMON=false` ·
heartbeat the whole build under TTL (a lapsed claim's revival re-runs the overlap scan and
throws if the scope was taken) · pin `model:` (model-inheritance death orphans a claim) ·
orphan cleanup on release · keep one `FOUNDRY_DATA_DIR` · treat a store-lock timeout as
transient (bounded backoff), never delete `.lock`.

## Pipeline-filler (Component E — never idle)

When the autonomous conductor finds the pipeline empty (nothing claimable AND nothing
awaiting merge), it does **not** stop — it invokes the pipeline-filler to replenish work.
The filler runs a **priority ladder** that respects the founder's "drop inputs · decide
gates" boundary:

### Tier 1 — Continuation (AUTO — no new gate required)
For each already-**greenlit** product whose charter has unbuilt epics, run `/build-path`
to decompose and emit the next work items into the foundry queue (including ADR-reservation
via Component A). This is within the existing greenlight: the product was already approved;
`/build-path` only emits NEW itemIds (idempotent on existing items). **No founder gate.**

**Greenlit predicate (machine-checkable):** A product is greenlit when
`foundry_gate_status { productKey: <product> }` returns a gate with
`gateType: 'greenlight'` AND `decision: 'approved'` (or the product's charter status is
`approved` in the charter file). Use `foundry_gate_status` — NOT an event-log grep. A
filler MUST NEVER widen its mandate to a non-greenlit product.

→ If new items appear: continue the main loop immediately.

### Tier 2 — Green-desk maintenance (AUTO — within standing mandate)
Invoke the **`/green-desk` skill** (Component D — implemented): it scans every active repo
across every debt dimension, drops false-positives via the audit ledger, and emits disjoint
path-area cleanup items (`green-desk-<repo>/debt-<area>`) under a synthetic
`green-desk-<repo>` T0 product. Driving repos to a clean desk is part of the standing build
mandate. The skill owns the anti-livelock mechanism (git-HEAD repo-suppression + per-cycle
cap + no-new-progress stop); this filler simply invokes it and continues if items appear
within budget. **No founder gate.**

**Anti-livelock rule (mechanism now lives in the skill):** Tier 2 is suppressed for a
specific repo within a cycle if no merge has changed that repo since the last sweep of it —
`/green-desk` derives this from `git rev-parse origin/main` vs the `lastSweptCommit` in its
per-repo ledger (no foundry event; ADR-176). A per-cycle work-item cap (default 10 items)
and a no-new-progress stop further bound it; the filler yields when the cap is hit and
continues on the next IDLE CHECK.

→ If cleanup items appear (within cap): continue the main loop immediately.

### Tier 3 — New-product / new-feature proposals (FOUNDER-GREENLIGHT-GATED)
Run the **`product-strategist` agent** to surface 2–3 ranked candidate next-features or
new products from the masterplan, product-ideas backlog, and retros. These proposals **DO
NOT auto-build.** They hit **Gate 1 (greenlight)**: the conductor SURFACES them to the
founder and enters a **STOP-FOR-FOUNDER** state. It never auto-charters or auto-builds a
new product. On a founder greenlight, the dossier→brief→charter→`/build-path` pipeline
fills the queue, and the conductor resumes from Tier 1.

### Gate boundary (inviolable)
- **Tiers 1 and 2 are fully autonomous** — they operate within already-granted mandates
  (greenlit products, standing green-desk obligation) and require zero founder interaction.
- **Tier 3 ALWAYS requires a founder greenlight** — a new product or out-of-masterplan
  feature is NEVER auto-built. The conductor surfaces, explains, and waits.
- **True idle (real, reachable termination) when all three tiers are exhausted:** no
  unbuilt epic on any greenlit product, no unsuppressed repo debt, and no founder-greenlit
  proposal. Context-critical stop is the backstop — true idle fires first.
  Clean stop message: "Conductor idle — no unbuilt epics, no repo debt, no greenlit
  proposals. Re-launch after a masterplan input or greenlight."

Reuses existing skills: `/build-path` (Tier 1), the Component-D green-desk debt-path
generator (Tier 2), and the `product-strategist` agent (Tier 3).

## Deferred to the next increment (named)

In-**Workflow** review stage + auto-merge T0/T1 as a **sibling pipeline stage** (pipeline:
build → wave → merge; slice 2.1 — distinct from autonomous mode which already self-waves inside
each worker subagent); the warm worktree pool (design §C.4, slice 2.5); a lightweight
`ConductorRegistered` presence record; the external-daemon substrate for 24/7 unattended running
(design v2 — autonomous Agent-loop mode already covers the unattended case within a single
session's context budget).
