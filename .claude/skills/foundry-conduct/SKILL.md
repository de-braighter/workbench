---
name: foundry-conduct
description: Foundry CONDUCTOR — register a session as a coordinator that drives the queue autonomously. It polls foundry_next, fans out self-serving worker subagents over the disjoint claimable frontier in waves (parallel, lean main context via the Workflow tool), and surfaces founder gates. Use when the founder says '/foundry-conduct', 'register me as a coordinator', 'conduct the foundry', or 'drain/build the queue'. The founder's only inputs are the masterplan (upstream, via /build-path) and the gate decisions — everything between is automatic. Two modes: PREVIEW (default, safe — show the fan-out plan, dispatch nothing) and BUILD (fan out workers that build items to PRs).
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
  `blocked` (pending the founder gate); the conductor surfaces the gate. T2 ships only on a founder gate.
- **One item per worker subagent.** Fresh context per item is a quality feature. Pool capacity
  = the conductor's fan-out width, bounded by the disjoint claimable frontier.
- **Multi-coordinator safe.** Several sessions may each register as a coordinator; the foundry
  store-lock arbitrates all their fan-outs (a lost claim is an expected race → the worker
  re-fetches; redundant dispatch is harmless). Never reclaim/clean another coordinator's work.

## Modes

- **`preview`** (DEFAULT — safe, dispatches NOTHING): scout `foundry_next`, compute + report
  the wave plan (which mutually-disjoint items, how many workers, what's gate-blocked), then
  stop. Use this first to see what the coordinator *would* do.
- **`build`**: fan out one worker subagent per disjoint claimable item; each builds the item to
  a PR (claim → worktree → build → `ci:local` → push → open PR → release
  `blocked` (pending review+merge)) and surfaces the PR ref. **v1 does NOT auto-merge** — the verifier
  wave + merge (and every T2 ship gate) stay with the founder/orchestrator. After a wave it
  re-polls (newly-unblocked items surface as deps release `done`) up to `maxWaves`, stopping on
  an unchanged frontier (no-progress) or an empty frontier.

## Protocol

1. Mint a coordinator id once: `cond-<yyyyMMdd-HHmmss>-<4hex>` (reuse in logs).
2. Sanity: `foundry_status` (board view).
3. Run the conductor **Workflow** below via the Workflow tool, passing
   `args: { mode, maxWaves, maxWorkers }`. Default `mode: 'preview'`. The founder graduates to
   `mode: 'build'` once the preview looks right.
4. Report: the wave plan (preview) or the built PR refs + any surfaced gates (build). Then STOP
   — a coordinator session ends when the frontier is drained or only gate-blocked items remain;
   it never polls idly.

## The conductor Workflow (run via the Workflow tool)

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
    outcome: { type: 'string' },              // built-pr | skipped-race | blocked | error
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
5. DO NOT MERGE. Release foundry_release { claimId, outcome: "blocked", note: "built; awaiting conductor/founder review+merge" + (T2 ? "; ship gate required" : "") } and report.
6. RETURN { itemId: "${it.itemId}", outcome: "built-pr", prRef: "<owner>/<repo>#<pr>", gate: "${it.riskTier === 'T2' ? 'ship' : ''}" }. On a build dead-end, foundry_release blocked with the reason and return { itemId, outcome: "blocked", note }.
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
- **Gates stay inviolable.** v1 surfaces every built PR for review+merge. The next increment
  (slice 2.1) adds an in-Workflow review stage (wave agents as a later pipeline stage) +
  auto-merge for T0/T1 on a green wave; **T2 always pauses at its `ship` gate** and is never
  auto-merged. Gates are non-blocking across products — a parked gate never stalls other lanes.

## Why workers don't run their own wave (a Workflow constraint — verified 2026-06-13)

A Workflow `agent()` node is a **leaf**: its toolset carries no `Agent`/`Task` spawn primitive
(verified empirically — a Workflow agent has Bash/Edit/Read/Skill/ToolSearch/Write/… but no
subagent-spawn tool), so a worker **cannot dispatch its own verifier-wave sub-agents**. Therefore
review is NEVER an in-worker wave — it is a **sibling pipeline stage** the conductor Workflow runs
itself: `pipeline(items, buildWorker, reviewWave, mergeOrGate)` (buildWorker and the wave-agents
are sibling leaf nodes at the top level). v1 keeps review/merge out-of-band (workers build to a PR;
the founder/orchestrator reviews + merges). The slice-2.1 increment adds the review stage as a
sibling pipeline stage — never inside a worker. *(Regular `Agent`-tool subagents CAN fan out — so
if self-waving workers were ever required, the conductor would instead be a regular `Agent`-loop
session, not a Workflow. That is the trade-off behind the Workflow substrate choice, now grounded.)*

## Concurrency guards (every worker subagent enforces — from the design §C.2)

unique worktree per claim + **forbid git ops in the shared root clone** · `NX_DAEMON=false` ·
heartbeat the whole build under TTL (a lapsed claim's revival re-runs the overlap scan and
throws if the scope was taken) · pin `model:` (model-inheritance death orphans a claim) ·
orphan cleanup on release · keep one `FOUNDRY_DATA_DIR` · treat a store-lock timeout as
transient (bounded backoff), never delete `.lock`.

## Deferred to the next increment (named)

In-Workflow review stage + auto-merge T0/T1 (pipeline: build → wave → merge); the warm
worktree pool (design §C.4, slice 2.5); a lightweight `ConductorRegistered` presence record;
the external-daemon substrate for 24/7 unattended running (design v2).
