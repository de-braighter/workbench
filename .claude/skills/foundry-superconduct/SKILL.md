---
name: foundry-superconduct
description: Foundry SUPERCONDUCTOR — the TOP tier of the foundry orchestration hierarchy (superconductor → conductors → workers → wave-agents). Register THIS session as the superconductor and it drains the WHOLE foundry across every product in parallel by dispatching ONE /foundry-conduct (autonomous-mode) conductor subagent per product/lane; each conductor dispatches workers, each worker runs its own verifier wave. Run as an Agent-loop session (NOT a Workflow — only the recursive Agent tool can express superconductor → conductors → workers; a Workflow agent() node is a leaf that cannot fan out). The superconductor is PURE ORCHESTRATION — it never claims (workers do), never merges (conductors do), never requests or approves gates (workers request, the founder decides, conductors merge after approval). It partitions the claimable frontier into lanes by product, holds only per-conductor SUMMARIES (lean context at every tier), and runs the GLOBAL idle→pipeline-filler escalation ONCE at the top. Use when the founder says '/foundry-superconduct', 'superconduct the foundry', 'register me as a superconductor', 'drain the whole foundry', or 'fan out conductors across all products'. The founder's only inputs remain the masterplan (upstream, via /build-path), the gate decisions, and greenlight decisions for new-product proposals.
tags: [foundry, superconductor, orchestration, autonomous]
---

# Foundry Superconductor

Invoking this skill **registers this session as the foundry superconductor** — the top tier
of the orchestration hierarchy. Where a single `/foundry-conduct` coordinator drains ONE
frontier, the superconductor drains the WHOLE foundry across EVERY product at once:

```
superconductor  →  conductors      →  workers        →  wave-agents
(this session)     (one per lane)     (one per item)    (reviewer + qa-engineer +
                                                         charter-checker per worker)
```

Each level fans out the next. The founder registers **ONE** superconductor and it drains the
whole foundry without ever holding the leaf detail. Design:
`docs/superpowers/specs/2026-06-13-autonomous-foundry-conductor-design.md` Component C′.

The founder's entire loop is unchanged — **drop inputs (masterplan) · register the
superconductor · decide gates**. The superconductor owns everything in between, by delegating
each product lane to a `/foundry-conduct`-autonomous conductor (it does NOT re-derive the
conductor's merge rule — that boundary lives in exactly one place, one tier down).

## Hard rules (inherit from foundry-conduct + propagate — fail closed)

- **The superconductor itself NEVER claims, NEVER merges, NEVER requests/approves gates.** It
  only *reads* (`foundry_status` / `foundry_next` / `foundry_gate_status` — advisory, lock-free)
  and *dispatches conductor subagents*. Every claim happens at a worker leaf; every merge happens
  at a conductor leaf; every gate is *requested* by a worker, *decided* by the founder, and
  *checked* (`foundry_gate_status`) by a conductor before it merges. The superconductor is **pure
  orchestration** — it touches no work product at any depth.
- **One conductor subagent per product/lane.** Lanes = products (see "## Substrate" → lane
  partition). One conductor per `productKey` is a clean, non-overlapping lane. The superconductor
  holds only per-conductor SUMMARIES (`{ productKey, built, merged, awaitingGate, idle,
  stopReason }`), NEVER per-item / per-worker detail — that is the lean-context guarantee.
- **The inviolable boundaries are enforced at the conductor LEAVES and NEVER relaxed by the
  superconductor.** Each conductor enforces, unchanged from `/foundry-conduct`: a T2 item NEVER
  auto-merges without `foundry_gate_status` showing an `approved` gate whose `payloadRef`
  references THAT item; T0/T1 merge on a green wave alone; a new product is NEVER auto-built. The
  superconductor does not weaken, widen, or short-circuit any of this — its Tier-3 filler (a new
  product) ALWAYS STOP-FOR-FOUNDER. Because the superconductor reuses `/foundry-conduct` rather
  than re-deriving the merge rule, the boundary stays in exactly one place.
- **The pipeline-filler runs ONCE at the top, never per-conductor.** The superconductor owns the
  GLOBAL IDLE → filler escalation. If each conductor ran its own filler, N conductors would each
  run `product-strategist` N times. The conductor lanes never invoke the filler; only the
  superconductor does, and only when ALL lanes are idle.
- **Multi-superconductor / multi-conductor safe by construction.** The single foundry store-lock
  arbitrates every claim at any depth (a lost claim is an expected race → the worker re-fetches;
  redundant dispatch is harmless). The superconductor needs ZERO collision logic. Never reclaim,
  re-merge, or "clean up" another superconductor's or conductor's lane.

## Substrate — why an Agent-loop session, not a Workflow

The superconductor MUST be an **Agent-loop session** (like autonomous-mode `/foundry-conduct`),
and the conductor subagents it spawns MUST be regular `Agent` subagents. This is forced by the
fan-out capability matrix, **not** a stylistic choice.

### Fan-out capability matrix (empirically verified 2026-06-13)

| Execution context | Can fan out sub-agents? |
|---|---|
| **Regular `Agent`-tool subagent** | **YES** — the `Agent` tool is in its own toolset; spawns children freely (recursively) |
| **Workflow `agent()` node** | **NO** — a leaf; its toolset carries no `Agent`/`Task` spawn primitive |

The hierarchy `superconductor → conductors → workers → wave-agents` is **three levels of
fan-out**. Each level must hand the level below the ability to fan out the *next* level:

- The **superconductor** must spawn conductors that can themselves spawn workers → conductors
  must be regular `Agent` subagents (they keep the `Agent` tool), NOT Workflow `agent()` leaves.
- The **conductors** must spawn workers that can themselves spawn a verifier wave → workers must
  be regular `Agent` subagents too (the same matrix one tier down — see `/foundry-conduct`'s
  "## Why workers don't run their own wave").

A Workflow `agent()` node is a leaf and cannot fan out, so a Workflow can express AT MOST one
level of dispatch. Therefore the whole hierarchy is expressible **ONLY** via the recursive
`Agent` tool — the superconductor is an Agent-loop **session**, dispatching conductors via
`Agent({ ... })`, each of which runs the `/foundry-conduct` autonomous-mode loop (itself an
Agent-loop). The slice-2 Workflow conductor (`preview`/`build`) is a bounded leaf-unit; the
superconductor reuses the **autonomous** conductor, never the Workflow one.

### Lane partition — lanes are products

`build-path` designs **intra-product** disjointness + `dependsOn` edges; **cross-product** items
are disjoint by different repo or distinct scope. So one conductor per `productKey` is a clean,
non-overlapping lane:

- Each greenlit product is a lane.
- Each synthetic `green-desk-<repo-slug>` debt product (emitted by `/green-desk`) is a lane.

The superconductor does NOT re-scope items or re-derive disjointness — that is build-path's job.
It trusts `foundry_next` and the fail-closed `scopesDisjoint` backstop in the store-lock. Even if
two lanes somehow overlapped, the single store-lock arbitrates the claim → redundant dispatch is
harmless. Correctness lives at the leaves; the hierarchy is pure orchestration + context
isolation.

## Protocol

1. **Mint a superconductor id once:** `super-<yyyyMMdd-HHmmss>-<4hex>` (reuse in logs).
2. **RECOVERY PASS** (the superconductor holds NO durable state): call `foundry_status` → read
   the board (active products, `BUILT (awaiting merge)`, pending gates). The superconductor does
   NOT rebuild the awaiting-merge set — that set is owned **per-lane** by each conductor's OWN
   RECOVERY PASS (a built-but-unmerged PR is found and routed by the conductor that owns its
   product). The superconductor only **re-partitions lanes** from the board. Stateless restart is
   TRUE: a fresh superconductor re-partitions from `foundry_status` and continues — no handoff, no
   state serialization, no leader election.
3. **Run "## The loop"** below directly in this session as an Agent-loop. Do NOT use the Workflow
   tool (the matrix forbids it).
4. **Report** the per-lane summaries + every pending founder gate (lane, itemId, gate type, prRef)
   + the stop reason. Then STOP. A fresh superconductor resumes by re-partitioning from
   `foundry_status`.

## The loop (Agent-loop, session-run)

```
loop (until ALL lanes idle OR context-critical):

  a. POLL: foundry_status + foundry_next(limit 50) — advisory, lock-free reads.

  b. PARTITION into lanes by product: group the claimable frontier + active products by
     productKey. **`productKey` is a field on each `foundry_next` item** (`ops.ts` `toNextItem`
     returns it) — equivalently the itemId prefix before the first `/` (`<key>/E<n>`,
     `<key>/ADR-<n>`, `green-desk-<repo-slug>/debt-…`). Each distinct product (including each
     green-desk-<repo-slug> debt product) is one lane. Cross-product items are disjoint by
     repo/scope; intra-product disjointness + dependsOn is build-path's contract — trust it +
     the fail-closed scopesDisjoint backstop.

  c. DISPATCH one conductor subagent per lane (cap = maxConductors, default 4; excess lanes
     wait for the next pass). Track which lanes you dispatched THIS pass (transient,
     in-context — NOT durable state) and do not double-dispatch the same lane within one
     pass; across passes, a redundant conductor is harmless (the store-lock arbitrates — a
     lost claim re-fetches). For each lane:
       Agent({
         subagent_type: <general-purpose>,
         model: <pinned>,                       // pin — inheritance death orphans a whole lane
         prompt: conductorPrompt(productKey)     // see "## The conductor-subagent prompt"
       })
     Conductors run CONCURRENTLY: min(N, maxConductors) lanes × M workers-per-lane concurrent.
     **GLOBAL WORKER BUDGET (resource bound, not correctness):** the box runs up to
     `maxConductors × maxWorkers` worktrees + `ci:local`/nx builds at once — keep the product
     `≈ a sane single-box budget` (default 4×4≈16, NOT 4×8) so concurrent nx daemons don't
     thrash (the nx EBUSY / `.lock` contention class). The store-lock keeps correctness at any
     count; the cap just keeps the machine alive. A **gate-parked lane** (only remaining work =
     a T2 PR awaiting a founder gate) re-dispatches each pass and returns idle — correct (no
     double-merge; store-lock arbitrates), but not free: a wasted conductor dispatch per pass,
     bounded by the founder-gate latency. Each returns ONE lane summary.

  d. COLLECT summaries (barrier or rolling): hold ONLY
       { productKey, built, merged, awaitingGate, idle, stopReason }
     per conductor — NEVER per-item / per-worker detail. This is the lean-context guarantee:
     the superconductor never grows with the number of items, only with the number of lanes.

  e. AGGREGATE + re-poll: newly-unblocked items (deps released `done`) and NEW lanes (a Tier-1
     filler emitted a new product's items, or /green-desk emitted a debt product) surface on the
     next foundry_status. Re-partition + re-dispatch. Stop a lane that reported idle with nothing
     new; keep dispatching lanes that still have claimable or awaiting-merge work.

  f. GLOBAL IDLE → pipeline-filler (ONCE at the top, NEVER per-conductor): GLOBAL IDLE fires
     ONLY when **every partitioned lane has been dispatched at least once in the current drain
     epoch AND returned `idle:true`** (no claimable item, no awaiting-merge PR). A lane deferred
     by the `maxConductors` cap is **pending, not idle** — it must be dispatched on a later pass
     before GLOBAL IDLE can fire (else the filler, incl. Tier-3 STOP-FOR-FOUNDER, could fire
     while cap-deferred lanes still hold work). When that holds, invoke the pipeline-filler
     ladder ONCE (the same Component-E ladder /foundry-conduct documents, hoisted to the top):
       TIER 1 (auto): for each greenlit product with unbuilt epics, run /build-path to emit the
                      next work items. Greenlit predicate (machine-checkable):
                      foundry_gate_status { productKey } → a gate with gateType:'greenlight' AND
                      decision:'approved'. NEVER widen the mandate to a non-greenlit product.
       TIER 2 (auto): invoke the /green-desk skill with --all → emit disjoint debt-cleanup items
                      (new green-desk-<repo-slug> lanes). The skill OWNS the anti-livelock
                      mechanism (git-HEAD repo-suppression + per-cycle cap + no-new-progress stop);
                      do NOT re-implement any of it here.
       TIER 3 (founder-gated): run product-strategist to surface 2–3 ranked proposals → SURFACE to
                      the founder → STOP-FOR-FOUNDER. A new product is NEVER auto-built; the
                      superconductor's Tier-3 always stops for a founder greenlight.
     If a tier produced new work, re-partition + continue the loop. TRUE IDLE = all three tiers
     dry in one complete pass → STOP CLEANLY:
       "Superconductor idle — every lane drained; no unbuilt epics, no repo debt, no greenlit
        proposals. Re-launch after a masterplan input or greenlight."

  g. CONTEXT CHECK (after each complete pass): near context-critical → STOP; report all lane
     summaries + every pending founder gate (lane, itemId, gate type, gateId, prRef — the
     founder decides via `foundry_gate_decide { gateId }`). Stop reason:
     "context-critical — foundry state is durable; re-launch a fresh superconductor to resume
      (it re-partitions from foundry_status; no handoff needed)." A fresh superconductor
      re-partitions from foundry_status and continues. Context-critical is the BACKSTOP; true
      idle fires first.
```

## The conductor-subagent prompt

The exact prompt the superconductor passes to each conductor subagent. It scopes a full
`/foundry-conduct` AUTONOMOUS conductor to ONE product and reuses the conductor's merge rule
verbatim — it does NOT re-derive it:

```
You are a foundry CONDUCTOR subagent dispatched by the superconductor, in AUTONOMOUS mode,
SCOPED to product `<productKey>`. Follow the workbench `/foundry-conduct` skill's
autonomous-mode loop's claim→build→wave→merge cycle — **EXCEPT its IDLE-CHECK pipeline-filler
step (d): the superconductor owns the GLOBAL filler; on lane-idle you return `idle:true`
instead of invoking any filler tier.** Operate ONLY within this one lane:

  - Dispatch worker subagents ONLY for items whose product is `<productKey>`.
  - Merge ONLY this product's PRs; read ONLY this product's gates
    (foundry_gate_status { productKey: "<productKey>" }).
  - Run the conductor's OWN RECOVERY PASS for `<productKey>` (rebuild THIS lane's
    awaiting-merge set from foundry_status's BUILT items + the gh open-PR backstop). A
    built-but-unmerged PR in this lane is NEVER re-built.

INVIOLABLE BOUNDARIES (reuse the `/foundry-conduct` merge rule — do NOT re-derive it):
  - A T2 item is NEVER merged without foundry_gate_status showing an `approved` gate whose
    `payloadRef` references THAT item (a sibling item's approved gate is NOT sufficient — match
    by payloadRef first, THEN check decision; fail closed on pending/rejected/absent/unmatched).
    The WORKER issues foundry_gate_request{ship} (+ {adr} if a new port/kernel primitive); YOU
    only call foundry_gate_status to read approval, merge after approval + a green wave, then
    call foundry_record_merge to terminalize. NEVER request or approve a gate yourself.
  - T0/T1 items carry no per-item gate → merge on a green wave alone.
  - NEVER auto-build a new product. If this lane is idle, return idle:true with nothing new — the
    superconductor (NOT you) owns the global IDLE→pipeline-filler escalation. Do NOT run
    product-strategist, /build-path continuation, or /green-desk yourself.

DISPATCH WORKERS via the `Agent` tool (you keep the `Agent` tool — fan-out matrix). Each worker
runs the `/foundry-worker` protocol (claim → worktree → build → ci:local) + its OWN verifier
wave (reviewer + qa-engineer + charter-checker as sibling Agent subagents; + exercir-charter-
checker if repo = domains/exercir) and returns a structured summary. You hold only per-worker
summaries (lean context).

CONCURRENCY GUARDS (every worker enforces): unique worktree per claim + FORBID any git op in the
shared root clone; set NX_DAEMON=false; pin model: at every dispatch (inheritance death orphans a
claim); use ONE FOUNDRY_DATA_DIR; treat a store-lock timeout as transient (bounded backoff, never
delete .lock); heartbeat under TTL; orphan cleanup on release.

RETURN a structured lane summary (and NOTHING heavier):
  {
    productKey:   "<productKey>",
    built:        ["<itemId>", …],                                  // built to a PR this run
    merged:       ["<itemId>", …],                                  // merged this run
    awaitingGate: [{ itemId, gate: "ship"|"adr", gateId, prRef }, …], // built, gate pending; gateId = founder decides via foundry_gate_decide
    idle:         <bool>,                                           // lane has no claimable + nothing awaiting merge
    stopReason:   "idle" | "context-critical" | "<other>"
  }
```

## Lean context at every tier

The superconductor holds per-conductor SUMMARIES; each conductor holds per-worker summaries; each
worker holds its own build. Context does NOT grow with the number of *items* — only with the
number of *lanes* (superconductor) or *items in a lane* (conductor) or *files in an item*
(worker). The founder registers ONE superconductor and it drains the whole foundry without ever
holding the leaf detail. This is "store generators, derive graphs" applied to the orchestration
hierarchy: every tier is a generator over the foundry log, not a graph it persists.

## Multi-superconductor safety

Several superconductors are SAFE (the single foundry store-lock arbitrates every claim at any
depth — the same arbitration that makes multi-coordinator and multi-conductor safe) but WASTEFUL.
v1 assumes ONE superconductor — the founder registers one. No leader election, no presence
record, no extra machinery is needed for correctness; redundancy only wastes dispatch.

## Concurrency guards (propagate to every tier)

The superconductor itself runs no git ops and holds no worktree, but it requires every conductor
and worker it transitively spawns to enforce, unchanged:

- unique worktree per claim + **forbid any git op in the shared root clone**
- `NX_DAEMON=false` in every worktree
- heartbeat the whole build under TTL
- **pin `model:` at every dispatch** — model-inheritance death orphans a whole lane (conductor)
  or a claim (worker)
- orphan cleanup on release
- one `FOUNDRY_DATA_DIR`
- store-lock timeout = transient bounded backoff, **never delete `.lock`**

## Deferred (named)

- A lightweight `SuperconductorRegistered` / `ConductorRegistered` presence record for
  `foundry_status` observability (v1 = the skill invocation is the registration).
- An external OS daemon for 24/7 cross-session running (v2 — the Agent-loop session already
  covers the unattended case within one session's context budget; a fresh superconductor resumes
  by re-partitioning from `foundry_status`).
- The **warm worktree pool** (design §C.4, item B / slice 2.5) composes ORTHOGONALLY — once it
  lands, conductors lease pool slots for their workers; the superconductor needs no change.
