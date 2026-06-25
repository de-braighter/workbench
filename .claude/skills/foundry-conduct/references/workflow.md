# The conductor Workflow (preview + build modes)

> Load this when running the conductor in **`preview`** or **`build`** mode — these run via
> the **Workflow tool** with this exact program. (Autonomous mode does NOT use this — it runs
> the Agent-loop in the core SKILL.md.) Pass `args: { mode, maxWaves, maxWorkers }`.

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

1. CLAIM: mint sess-<ts>-<4hex>; foundry_claim { itemId: "${it.itemId}", sessionId, worktree: "<repo>/.claude/worktrees/<slug>", branch: "feat/<slug>", ttlMinutes: ${it.riskTier === 'T2' ? 360 : 180} } (D6: a finite, build-appropriate TTL by tier — longer for T2's designer-first builds, shorter for T0/T1 — so a dead worker frees the item, and you heartbeat well within it). If rejected as already-claimed/scope-overlap, that is an EXPECTED race with a sibling worker/coordinator — return { itemId, outcome: "skipped-race" } and STOP (never work unclaimed).
2. ISOLATE (per the skill, AUTO-engaging the warm pool): after CLAIM, self-lease your slot index — foundry_lease_slot { claimId } → reset-on-lease the warm slot (preserves node_modules); on ANY lease failure fall back to a cold \`git worktree add\` off origin/main. NEVER git-op in the shared root clone; set NX_DAEMON=false; install deps if cold. Distinct workers get distinct slots by the store-lock — no conductor-side slot math.
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
